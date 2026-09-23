"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { appBaseUrl } from "@/lib/app-url";
import { requireUser } from "@/lib/auth";
import { sendEmail } from "@/lib/email";
import { generateToken, hashToken, portalUrl } from "@/lib/work-orders";
import { canSeeBudgets } from "@/lib/roles";
import { generatePlan } from "@/lib/planner/generate";
import { createClient } from "@/lib/supabase/server";
import { DOCUMENTS_BUCKET } from "@/lib/supabase/buckets";
import { recordId } from "@/lib/validation";
import { DOCUMENT_KINDS, MAX_UPLOAD_BYTES, checkUpload, storagePath } from "@/lib/documents";

export type GenerateState = { error?: string } | undefined;

export async function generatePlanAction(_prev: GenerateState, formData: FormData): Promise<GenerateState> {
  const user = await requireUser();
  if (!canSeeBudgets(user.role)) return { error: "You can't generate plans." };

  const id = recordId.safeParse(formData.get("assignmentId"));
  if (!id.success) return { error: "Unknown relocation." };

  const supabase = await createClient();
  const result = await generatePlan(supabase, id.data);
  revalidatePath(`/assignments/${id.data}`);
  return result.ok ? undefined : { error: result.message };
}

export type ProviderState = { error?: string; saved?: boolean } | undefined;

// MVP item 5: the RMC admin or allocated consultant picks a provider for a service.
export async function selectProviderAction(_prev: ProviderState, formData: FormData): Promise<ProviderState> {
  const user = await requireUser();
  if (user.role !== "rmc_admin" && user.role !== "consultant") return { error: "You can't choose providers." };

  const ids = z
    .object({ serviceId: recordId, vendorId: z.string().min(1, "Choose a provider").pipe(recordId), assignmentId: recordId })
    .safeParse({
      serviceId: formData.get("serviceId"),
      vendorId: formData.get("vendorId"),
      assignmentId: formData.get("assignmentId"),
    });
  if (!ids.success) return { error: ids.error.issues[0]?.message ?? "Choose a provider" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("select_service_provider", {
    p_service_id: ids.data.serviceId,
    p_vendor_id: ids.data.vendorId,
  });
  if (error) {
    console.error("select_service_provider failed", error.code, error.message);
    return { error: error.code === "42501" ? "You can't choose providers for this relocation." : "That provider could not be saved." };
  }
  revalidatePath(`/assignments/${ids.data.assignmentId}`);
  return { saved: true };
}

export type TaskState = { error?: string } | undefined;

// MVP item 6: tick a to-do off (or reopen it).
export async function setTaskDoneAction(_prev: TaskState, formData: FormData): Promise<TaskState> {
  await requireUser();
  const parsed = z
    .object({ taskId: recordId, assignmentId: recordId, done: z.enum(["true", "false"]) })
    .safeParse({ taskId: formData.get("taskId"), assignmentId: formData.get("assignmentId"), done: formData.get("done") });
  if (!parsed.success) return { error: "Unknown task." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_journey_task_done", {
    p_task_id: parsed.data.taskId,
    p_done: parsed.data.done === "true",
  });
  if (error) {
    console.error("set_journey_task_done failed", error.code, error.message);
    return { error: "That task could not be updated." };
  }
  revalidatePath(`/assignments/${parsed.data.assignmentId}`);
  return undefined;
}

export type UploadState = { error?: string; saved?: string } | undefined;

// MVP item 7: upload a document. The file type is decided from its content,
// storage policies check access, then the database records it.
export async function uploadDocumentAction(_prev: UploadState, formData: FormData): Promise<UploadState> {
  await requireUser();
  const parsed = z
    .object({
      assignmentId: recordId,
      kind: z.enum(DOCUMENT_KINDS, { error: "Choose what kind of document this is" }),
      serviceId: z.union([z.literal(""), recordId]),
    })
    .safeParse({
      assignmentId: formData.get("assignmentId"),
      kind: formData.get("kind"),
      serviceId: formData.get("serviceId") ?? "",
    });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form." };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a file to upload." };
  if (file.size > MAX_UPLOAD_BYTES) return { error: "Files can be up to 4 MB." };

  const bytes = new Uint8Array(await file.arrayBuffer());
  const check = checkUpload(file.name, file.size, bytes.subarray(0, 16));
  if (!check.ok) return { error: check.error };

  const { assignmentId, kind, serviceId } = parsed.data;
  const path = storagePath(assignmentId, crypto.randomUUID(), check.ext);
  const supabase = await createClient();
  const bucket = supabase.storage.from(DOCUMENTS_BUCKET);

  const upload = await bucket.upload(path, bytes, { contentType: check.mime, upsert: false });
  if (upload.error) {
    console.error("document upload failed", upload.error.message);
    return { error: "You can't add documents to this relocation, or the upload failed." };
  }

  const { error } = await supabase.rpc("register_document", {
    p_assignment_id: assignmentId,
    p_service_id: serviceId || null,
    p_kind: kind,
    p_file_name: check.fileName,
    p_storage_path: path,
    p_mime_type: check.mime,
    p_size_bytes: file.size,
  });
  if (error) {
    console.error("register_document failed", error.code, error.message);
    await bucket.remove([path]);
    return { error: "The document could not be saved." };
  }

  revalidatePath(`/assignments/${assignmentId}`);
  return { saved: check.fileName };
}

export type WorkOrderState = { error?: string; link?: string; reference?: string; emailed?: boolean } | undefined;

// A person approves a service that needs approval (RMC admin only; the database checks).
export async function approveServiceAction(_prev: WorkOrderState, formData: FormData): Promise<WorkOrderState> {
  await requireUser();
  const parsed = z.object({ serviceId: recordId, assignmentId: recordId }).safeParse({
    serviceId: formData.get("serviceId"),
    assignmentId: formData.get("assignmentId"),
  });
  if (!parsed.success) return { error: "Unknown service." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("approve_service", { p_service_id: parsed.data.serviceId });
  if (error) return { error: error.code === "42501" ? "Only the RMC admin can approve." : error.message };
  revalidatePath(`/assignments/${parsed.data.assignmentId}`);
  return undefined;
}

// MVP item 9: send the work order. The link is shown once here and emailed when email is set up.
export async function sendWorkOrderAction(_prev: WorkOrderState, formData: FormData): Promise<WorkOrderState> {
  await requireUser();
  const parsed = z.object({ serviceId: recordId, assignmentId: recordId }).safeParse({
    serviceId: formData.get("serviceId"),
    assignmentId: formData.get("assignmentId"),
  });
  if (!parsed.success) return { error: "Unknown service." };

  const supabase = await createClient();
  const token = generateToken();
  const { data: reference, error } = await supabase.rpc("create_work_order", {
    p_service_id: parsed.data.serviceId,
    p_token_hash: hashToken(token),
  });
  if (error || !reference) {
    console.error("create_work_order failed", error?.code, error?.message);
    return { error: error?.code === "55000" || error?.code === "42501" ? error.message : "The work order could not be sent." };
  }

  const link = portalUrl(await appBaseUrl(), token);
  const { data: wo } = await supabase
    .from("work_orders")
    .select("details, vendor_id, vendors(name, contact_email)")
    .eq("reference", reference as string)
    .maybeSingle();
  const vendor = wo?.vendors as unknown as { name: string; contact_email: string } | null;
  const details = (wo?.details ?? {}) as Record<string, string>;
  const email = vendor
    ? await sendEmail(
        vendor.contact_email,
        `Work order ${reference}: ${details.service_title ?? "relocation service"}`,
        [
          `Hello ${vendor.name},`,
          "",
          `You have a new work order (${reference}) for ${details.service_title ?? "a relocation service"}:`,
          `${details.origin} to ${details.destination}, move date ${details.move_date}, family of ${details.family_size}.`,
          "",
          "Open it, accept it, add your booking reference and upload documents here (no account needed):",
          link,
          "",
          "This link is personal to this work order. Please don't forward it.",
        ].join("\n"),
      )
    : { sent: false as const, reason: "failed" as const };

  revalidatePath(`/assignments/${parsed.data.assignmentId}`);
  return { link, reference: reference as string, emailed: email.sent };
}

// Issues a fresh link; the old one stops working.
export async function renewWorkOrderLinkAction(_prev: WorkOrderState, formData: FormData): Promise<WorkOrderState> {
  await requireUser();
  const parsed = z.object({ workOrderId: recordId, assignmentId: recordId }).safeParse({
    workOrderId: formData.get("workOrderId"),
    assignmentId: formData.get("assignmentId"),
  });
  if (!parsed.success) return { error: "Unknown work order." };
  const supabase = await createClient();
  const token = generateToken();
  const { error } = await supabase.rpc("renew_work_order_link", {
    p_work_order_id: parsed.data.workOrderId,
    p_token_hash: hashToken(token),
  });
  if (error) return { error: error.code === "42501" ? "You can't renew this link." : error.message };
  revalidatePath(`/assignments/${parsed.data.assignmentId}`);
  return { link: portalUrl(await appBaseUrl(), token) };
}

export type InvoiceState = { error?: string; saved?: string } | undefined;

// RMC staff record an invoice that arrived by email; the database matches it.
export async function recordInvoiceAction(_prev: InvoiceState, formData: FormData): Promise<InvoiceState> {
  await requireUser();
  const parsed = z
    .object({
      workOrderId: recordId,
      assignmentId: recordId,
      invoiceNumber: z.string().trim().min(1, "Enter the invoice number").max(60, "Invoice number is too long"),
      invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the invoice date"),
      amount: z.coerce.number({ error: "Enter the amount" }).positive("Amount must be more than ₹0").max(100_000_000),
    })
    .safeParse({
      workOrderId: formData.get("workOrderId"),
      assignmentId: formData.get("assignmentId"),
      invoiceNumber: formData.get("invoiceNumber"),
      invoiceDate: formData.get("invoiceDate"),
      amount: formData.get("amount"),
    });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("record_invoice", {
    p_work_order_id: parsed.data.workOrderId,
    p_invoice_number: parsed.data.invoiceNumber,
    p_invoice_date: parsed.data.invoiceDate,
    p_amount: parsed.data.amount,
  });
  if (error) {
    return { error: ["42501", "22023", "55000"].includes(error.code) ? error.message : "The invoice could not be saved." };
  }
  revalidatePath(`/assignments/${parsed.data.assignmentId}`);
  return { saved: parsed.data.invoiceNumber };
}

// A person decides on an invoice (RMC admin only; the database checks and requires a note).
export async function decideInvoiceAction(_prev: InvoiceState, formData: FormData): Promise<InvoiceState> {
  await requireUser();
  const parsed = z
    .object({
      invoiceId: recordId,
      assignmentId: recordId,
      decision: z.enum(["approve", "dispute"]),
      note: z.string().trim().min(3, "Add a short note explaining the decision").max(1000),
    })
    .safeParse({
      invoiceId: formData.get("invoiceId"),
      assignmentId: formData.get("assignmentId"),
      decision: formData.get("decision"),
      note: formData.get("note"),
    });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("decide_invoice", {
    p_invoice_id: parsed.data.invoiceId,
    p_decision: parsed.data.decision,
    p_note: parsed.data.note,
  });
  if (error) return { error: error.code === "42501" ? "Only the RMC admin can decide on invoices." : error.message };
  revalidatePath(`/assignments/${parsed.data.assignmentId}`);
  return { saved: parsed.data.decision };
}
