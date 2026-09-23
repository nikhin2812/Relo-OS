"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { MAX_UPLOAD_BYTES, checkUpload } from "@/lib/documents";
import { createAnonClient } from "@/lib/supabase/anon";
import { DOCUMENTS_BUCKET } from "@/lib/supabase/buckets";
import { hashToken } from "@/lib/work-orders";

// Everything here runs without a login. The database checks the link on every call.

const tokenSchema = z.string().min(20).max(200);

export type PortalState = { error?: string; done?: string } | undefined;

export async function portalUpdateAction(_prev: PortalState, formData: FormData): Promise<PortalState> {
  const parsed = z
    .object({
      token: tokenSchema,
      action: z.enum(["accept", "decline", "book", "complete"]),
      bookingReference: z.string().trim().max(100).optional().default(""),
      bookedFor: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).optional().default(""),
      note: z.string().trim().max(1000, "Note is too long").optional().default(""),
    })
    .safeParse({
      token: formData.get("token"),
      action: formData.get("action"),
      bookingReference: formData.get("bookingReference") ?? undefined,
      bookedFor: formData.get("bookedFor") ?? undefined,
      note: formData.get("note") ?? undefined,
    });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  const p = parsed.data;
  if (p.action === "book" && (!p.bookingReference || !p.bookedFor)) {
    return { error: "Enter the booking reference and the booked date." };
  }

  const supabase = createAnonClient();
  const { data, error } = await supabase.rpc("portal_update_work_order", {
    p_token: p.token,
    p_action: p.action,
    p_booking_reference: p.bookingReference || null,
    p_booked_for: p.bookedFor || null,
    p_note: p.note || null,
  });
  if (error) {
    return { error: error.code === "P0002" ? "This link is not valid or has expired." : error.message };
  }
  revalidatePath(`/portal/${p.token}`);
  return { done: String(data) };
}

export async function portalUploadAction(_prev: PortalState, formData: FormData): Promise<PortalState> {
  const token = tokenSchema.safeParse(formData.get("token"));
  if (!token.success) return { error: "This link is not valid." };
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a file to upload." };
  if (file.size > MAX_UPLOAD_BYTES) return { error: "Files can be up to 4 MB." };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const check = checkUpload(file.name, file.size, bytes.subarray(0, 16));
  if (!check.ok) return { error: check.error };

  const supabase = createAnonClient();
  const { data: wo, error: woError } = await supabase.rpc("portal_get_work_order", { p_token: token.data });
  if (woError || !wo) return { error: "This link is not valid or has expired." };

  const path = `${(wo as { assignment_id: string }).assignment_id}/portal/${hashToken(token.data)}/${crypto.randomUUID()}.${check.ext}`;
  const upload = await supabase.storage.from(DOCUMENTS_BUCKET).upload(path, bytes, { contentType: check.mime, upsert: false });
  if (upload.error) {
    console.error("portal upload failed", upload.error.message);
    return { error: "The upload failed. This work order may be closed." };
  }
  const { error } = await supabase.rpc("portal_register_document", {
    p_token: token.data,
    p_storage_path: path,
    p_file_name: check.fileName,
    p_mime_type: check.mime,
    p_size_bytes: file.size,
  });
  if (error) {
    console.error("portal_register_document failed", error.code, error.message);
    return { error: "The document could not be saved." };
  }
  revalidatePath(`/portal/${token.data}`);
  return { done: check.fileName };
}
