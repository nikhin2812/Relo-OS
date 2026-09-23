"use server";

import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { generatePlan } from "@/lib/planner/generate";
import { createClient } from "@/lib/supabase/server";
import { relocationRequestSchema } from "@/lib/validation";

export type RequestFormState =
  | { error?: string; fieldErrors?: Record<string, string>; values?: Record<string, string> }
  | undefined;

const FIELDS = ["employeeName", "familySize", "origin", "destination", "moveDate", "budget"] as const;

export async function createRelocationRequest(_prev: RequestFormState, formData: FormData): Promise<RequestFormState> {
  const user = await requireUser();
  const values = Object.fromEntries(FIELDS.map((f) => [f, String(formData.get(f) ?? "")]));
  if (user.role !== "hr_user") return { error: "Only HR users can create relocation requests.", values };

  const parsed = relocationRequestSchema().safeParse(values);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "form");
      fieldErrors[key] ??= issue.message;
    }
    return { fieldErrors, values };
  }

  const r = parsed.data;
  const supabase = await createClient();
  const { data: assignmentId, error } = await supabase.rpc("create_relocation_request", {
    p_employee_name: r.employeeName,
    p_family_size: r.familySize,
    p_origin: r.origin,
    p_destination: r.destination,
    p_move_date: r.moveDate,
    p_budget: r.budget,
  });
  if (error || !assignmentId) {
    console.error("create_relocation_request failed", error?.code, error?.message);
    return { error: error?.code === "22023" ? error.message : "The request could not be saved. Please try again.", values };
  }

  // The request is saved either way; the plan page shows the result or a retry button.
  await generatePlan(supabase, assignmentId as string);
  redirect(`/assignments/${assignmentId}`);
}
