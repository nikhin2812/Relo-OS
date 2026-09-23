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
export function policyCap(service: PlanService, policy: PolicyConfig, familySize: number): number | null {
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
  total: number;
  budget: number;
  remaining: number;
  overBudget: boolean;
  approvalsNeeded: number;
};

export function planTotals(
  services: Pick<PlanService, "estimated_cost" | "approval_required">[],
  budget: number,
): PlanTotals {
  // Work in paise to avoid floating-point drift.
  const totalPaise = services.reduce((sum, s) => sum + Math.round(Number(s.estimated_cost) * 100), 0);
  const budgetPaise = Math.round(budget * 100);
  return {
    total: totalPaise / 100,
    budget: budgetPaise / 100,
    remaining: (budgetPaise - totalPaise) / 100,
    overBudget: totalPaise > budgetPaise,
    approvalsNeeded: services.filter((s) => s.approval_required).length,
  };
}
