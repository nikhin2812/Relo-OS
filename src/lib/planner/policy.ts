import { formatINR } from "@/lib/format";

import type { PlannerOutput, PlanService, PolicyConfig, PolicyStatus } from "./schema";

const SEVERITY: Record<PolicyStatus, number> = { within_policy: 0, needs_review: 1, out_of_policy: 2 };

function stricter(a: PolicyStatus, b: PolicyStatus): PolicyStatus {
  return SEVERITY[a] >= SEVERITY[b] ? a : b;
}

function join(existing: string, extra: string): string {
  if (!existing.trim()) return extra;
  if (existing.includes(extra)) return existing;
  return `${existing} ${extra}`.slice(0, 1000);
}

// The cap that applies to a service, or null when the policy sets none.
export function policyCap(service: Pick<PlanService, "category"> | { category: string }, policy: PolicyConfig, familySize: number): number | null {
  const rule = policy.services?.[service.category as keyof NonNullable<PolicyConfig["services"]>];
  if (!rule) return null;
  if (typeof rule.max_cost_per_person === "number") return rule.max_cost_per_person * familySize;
  if (typeof rule.max_cost === "number") return rule.max_cost;
  return null;
}

// Re-checks every service against the RMC's policy in code, so a policy breach
// is flagged even if the AI missed it. The AI's flags are never made weaker.
export function applyPolicy(plan: PlannerOutput, policy: PolicyConfig, familySize: number): PlannerOutput {
  const services = plan.services.map((service) => {
    const s = { ...service };
    const rule = policy.services?.[s.category as keyof NonNullable<PolicyConfig["services"]>];

    if (s.category === "other" || !rule || rule.covered === false) {
      s.policy_status = stricter(s.policy_status, "needs_review");
      s.approval_required = true;
      s.approval_reason = join(s.approval_reason, "This service is not covered by the relocation policy.");
      return s;
    }

    const cap = policyCap(s, policy, familySize);
    if (cap !== null && s.estimated_cost > cap) {
      s.policy_status = "out_of_policy";
      s.approval_required = true;
      const msg = `Estimated ${formatINR(s.estimated_cost)} is above the policy cap of ${formatINR(cap)}.`;
      s.policy_note = join(s.policy_note, msg);
      s.approval_reason = join(s.approval_reason, msg);
    }
    return s;
  });

  return { ...plan, services };
}

export type PlanTotals = {
  /** Sum of the AI's estimates for every service. */
  total: number;
  /** Sum of agreed costs for services with a provider chosen (ordered or not). */
  agreed: number;
  /** Sum of agreed costs for services with a live work order: money the RMC has committed. */
  committed: number;
  /** Sum of invoices received (not disputed). */
  invoiced: number;
  /** Invoiced minus agreed, for services that have invoices. Positive = over. */
  variance: number;
  /** Invoiced where invoiced, agreed cost where a provider is chosen, estimate otherwise. */
  forecast: number;
  budget: number;
  /** Budget minus forecast. Negative when over budget. */
  remaining: number;
  overBudget: boolean;
  /** Services that need approval and haven't had it yet. */
  approvalsNeeded: number;
  /** Invoices waiting for a decision because they were flagged. */
  flaggedInvoices: number;
  booked: number;
  services: number;
};

type TotalsInput = Pick<PlanService, "estimated_cost" | "approval_required"> & {
  agreed_cost?: number | null;
  agreed_over_cap?: boolean;
  approved_at?: string | null;
  work_order_status?: string | null;
  /** Invoices received for this service, excluding disputed ones. */
  invoiced_amount?: number | null;
  flagged_invoices?: number;
};

const LIVE = new Set(["sent", "accepted", "booked", "completed"]);

export function planTotals(services: TotalsInput[], budget: number): PlanTotals {
  // Work in paise to avoid floating-point drift.
  const paise = (n: number | null | undefined) => Math.round(Number(n ?? 0) * 100);
  let total = 0;
  let agreed = 0;
  let committed = 0;
  let forecast = 0;
  let invoiced = 0;
  let variance = 0;
  for (const s of services) {
    const chosen = s.agreed_cost !== null && s.agreed_cost !== undefined;
    const billed = s.invoiced_amount !== null && s.invoiced_amount !== undefined && Number(s.invoiced_amount) > 0;
    total += paise(s.estimated_cost);
    if (chosen) agreed += paise(s.agreed_cost);
    if (chosen && LIVE.has(s.work_order_status ?? "")) committed += paise(s.agreed_cost);
    if (billed) {
      invoiced += paise(s.invoiced_amount);
      variance += paise(s.invoiced_amount) - paise(chosen ? s.agreed_cost : s.estimated_cost);
    }
    forecast += billed ? paise(s.invoiced_amount) : chosen ? paise(s.agreed_cost) : paise(s.estimated_cost);
  }
  const budgetPaise = paise(budget);
  return {
    total: total / 100,
    agreed: agreed / 100,
    committed: committed / 100,
    invoiced: invoiced / 100,
    variance: variance / 100,
    forecast: forecast / 100,
    budget: budgetPaise / 100,
    remaining: (budgetPaise - forecast) / 100,
    overBudget: forecast > budgetPaise,
    approvalsNeeded: services.filter((s) => (s.approval_required || s.agreed_over_cap) && !s.approved_at).length,
    flaggedInvoices: services.reduce((n, s) => n + (s.flagged_invoices ?? 0), 0),
    booked: services.filter((s) => s.work_order_status === "booked" || s.work_order_status === "completed").length,
    services: services.length,
  };
}
