import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { PlannerError, requestPlan } from "./client";
import { applyPolicy } from "./policy";
import type { PlanningRequest, PolicyConfig } from "./schema";
import { planSigningSecret, signPlan } from "./signing";
import { validatePlan } from "./validate";

export type GenerateResult = { ok: true } | { ok: false; message: string };

// Loads the request (as the signed-in user, so RLS applies), asks the planner,
// checks the answer, applies policy rules and saves it — or records why not.
export async function generatePlan(supabase: SupabaseClient, assignmentId: string): Promise<GenerateResult> {
  const { data: assignment } = await supabase
    .from("assignments")
    .select("id, rmc_tenant_id, employee_name, family_size, origin, destination, move_date, assignment_budgets(amount)")
    .eq("id", assignmentId)
    .maybeSingle();
  if (!assignment) return { ok: false, message: "Relocation not found." };

  const budgetRow = (assignment.assignment_budgets as unknown as { amount: number } | null) ?? null;
  const { data: policyRow } = await supabase
    .from("rmc_policies")
    .select("config")
    .eq("rmc_tenant_id", assignment.rmc_tenant_id)
    .maybeSingle();
  if (!budgetRow || !policyRow) return { ok: false, message: "You don't have access to plan this relocation." };

  const request: PlanningRequest = {
    employeeName: assignment.employee_name,
    familySize: assignment.family_size,
    origin: assignment.origin,
    destination: assignment.destination,
    moveDate: assignment.move_date,
    budget: Number(budgetRow.amount),
  };
  const policy = policyRow.config as PolicyConfig;

  const secret = planSigningSecret();
  if (!secret) {
    console.error("PLAN_SIGNING_SECRET is not set; plans cannot be saved.");
    const message = "Plan saving isn't switched on yet. Please contact your administrator.";
    await supabase.rpc("record_plan_failure", { p_assignment_id: assignmentId, p_message: message });
    return { ok: false, message };
  }

  let message: string;
  try {
    const response = await requestPlan(request, policy);
    const checked = validatePlan(response.text, request);
    if (checked.ok) {
      const planText = JSON.stringify(applyPolicy(checked.plan, policy, request.familySize));
      const { signedAt, signature } = signPlan(secret, assignmentId, planText, response.model);
      const { error } = await supabase.rpc("save_relocation_plan", {
        p_assignment_id: assignmentId,
        p_plan: planText,
        p_model: response.model,
        p_signed_at: signedAt,
        p_signature: signature,
      });
      if (!error) return { ok: true };
      message = error.code === "55000" ? "This relocation already has a plan." : "The plan could not be saved. Please try again.";
      console.error("save_relocation_plan failed", error.code, error.message);
    } else {
      console.error("Planner output rejected:", checked.error);
      message = "The AI planner returned an incomplete plan. Please try again.";
    }
  } catch (error) {
    if (!(error instanceof PlannerError)) console.error("Planner call failed", error);
    message = error instanceof PlannerError ? error.message : "Something went wrong while planning. Please try again.";
  }

  await supabase.rpc("record_plan_failure", { p_assignment_id: assignmentId, p_message: message });
  return { ok: false, message };
}
