"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth";
import { readImportRows } from "@/lib/csv";
import { createClient } from "@/lib/supabase/server";
import { relocationRequestSchema } from "@/lib/validation";

export type ImportResult = { line: number; employee: string; ok: boolean; message: string; id?: string };
export type ImportState = { error?: string; results?: ImportResult[] } | undefined;

const MAX_BYTES = 200 * 1024;

// Spec section 7: import relocation requests from a CSV. Each row goes through
// the same checks as the form; plans are generated per relocation afterwards.
export async function importRequestsAction(_prev: ImportState, formData: FormData): Promise<ImportState> {
  const user = await requireUser();
  if (user.role !== "hr_user") return { error: "Only HR users can import relocation requests." };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a CSV file." };
  if (file.size > MAX_BYTES) return { error: "The file is too large (200 KB maximum)." };

  const parsed = readImportRows(await file.text());
  if ("error" in parsed) return { error: parsed.error };

  const supabase = await createClient();
  const schema = relocationRequestSchema();
  const results: ImportResult[] = [];
  for (const { line, values } of parsed.rows) {
    const check = schema.safeParse({
      employeeName: values.employee_name,
      familySize: values.family_size,
      origin: values.origin,
      destination: values.destination,
      moveDate: values.move_date,
      budget: values.budget,
      employeeEmail: values.employee_email,
    });
    if (!check.success) {
      results.push({ line, employee: values.employee_name, ok: false, message: check.error.issues[0]?.message ?? "Invalid row" });
      continue;
    }
    const r = check.data;
    const { data, error } = await supabase.rpc("create_relocation_request", {
      p_employee_name: r.employeeName,
      p_family_size: r.familySize,
      p_origin: r.origin,
      p_destination: r.destination,
      p_move_date: r.moveDate,
      p_budget: r.budget,
      p_employee_email: r.employeeEmail || null,
    });
    results.push(
      error
        ? { line, employee: r.employeeName, ok: false, message: error.code === "22023" ? error.message : "Could not be saved" }
        : { line, employee: r.employeeName, ok: true, message: "Created — open it to generate the plan", id: data as string },
    );
  }
  revalidatePath("/dashboard");
  return { results };
}
