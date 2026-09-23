import { describe, expect, it } from "vitest";

import { mockPlan } from "@/lib/planner/mock";
import { applyPolicy, planTotals, policyCap } from "@/lib/planner/policy";
import type { PlannerOutput, PolicyConfig } from "@/lib/planner/schema";

const policy: PolicyConfig = {
  services: {
    immigration: { covered: true, max_cost: 150000 },
    flights: { covered: true, max_cost_per_person: 45000 },
    temporary_housing: { covered: true, max_cost: 350000, max_days: 30 },
    household_goods: { covered: true, max_cost: 400000 },
    school_search: { covered: true, max_cost: 60000 },
    settling_in: { covered: true, max_cost: 80000 },
  },
};

const request = {
  employeeName: "Test Person (Demo)",
  familySize: 3,
  origin: "Bengaluru",
  destination: "Dubai",
  moveDate: "2026-11-15",
  budget: 1500000,
};

function planWith(change: (p: PlannerOutput) => void): PlannerOutput {
  const plan = structuredClone(mockPlan(request));
  // Start from a plan the AI marked entirely within policy.
  for (const s of plan.services) {
    s.policy_status = "within_policy";
    s.approval_required = false;
    s.approval_reason = "";
    s.policy_note = "";
  }
  change(plan);
  return plan;
}

const byKey = (p: PlannerOutput, key: string) => p.services.find((s) => s.key === key)!;

describe("policyCap", () => {
  it("multiplies per-person caps by family size", () => {
    const flights = byKey(mockPlan(request), "flights");
    expect(policyCap(flights, policy, 3)).toBe(135000);
  });
});

describe("applyPolicy", () => {
  it("flags a service over its cap even when the AI said it was fine", () => {
    const result = applyPolicy(planWith(() => {}), policy, 3);
    const housing = byKey(result, "temp_housing"); // ₹4,20,000 against a ₹3,50,000 cap
    expect(housing.policy_status).toBe("out_of_policy");
    expect(housing.approval_required).toBe(true);
    expect(housing.approval_reason).toContain("₹3,50,000");
  });

  it("leaves services within their caps alone", () => {
    const result = applyPolicy(planWith(() => {}), policy, 3);
    expect(byKey(result, "immigration").policy_status).toBe("within_policy");
    expect(byKey(result, "immigration").approval_required).toBe(false);
  });

  it("checks flights per person", () => {
    const over = applyPolicy(planWith((p) => (byKey(p, "flights").estimated_cost = 140000)), policy, 3);
    expect(byKey(over, "flights").policy_status).toBe("out_of_policy");
    const under = applyPolicy(planWith((p) => (byKey(p, "flights").estimated_cost = 130000)), policy, 3);
    expect(byKey(under, "flights").policy_status).toBe("within_policy");
  });

  it("sends services the policy doesn't cover for approval", () => {
    const result = applyPolicy(
      planWith((p) => {
        p.services[0].category = "other";
      }),
      policy,
      3,
    );
    expect(result.services[0].policy_status).toBe("needs_review");
    expect(result.services[0].approval_required).toBe(true);
  });

  it("never weakens a flag the AI raised", () => {
    const result = applyPolicy(
      planWith((p) => {
        const s = byKey(p, "immigration");
        s.policy_status = "out_of_policy";
        s.approval_required = true;
        s.approval_reason = "Premium processing requested";
      }),
      policy,
      3,
    );
    const s = byKey(result, "immigration");
    expect(s.policy_status).toBe("out_of_policy");
    expect(s.approval_required).toBe(true);
    expect(s.approval_reason).toBe("Premium processing requested");
  });
});

describe("planTotals", () => {
  it("adds up the demo plan against the ₹15 lakh budget", () => {
    const totals = planTotals(mockPlan(request).services, 1500000);
    expect(totals.total).toBe(1159000);
    expect(totals.remaining).toBe(341000);
    expect(totals.overBudget).toBe(false);
  });

  it("detects an over-budget plan", () => {
    const totals = planTotals(mockPlan(request).services, 1000000);
    expect(totals.overBudget).toBe(true);
    expect(totals.remaining).toBe(-159000);
  });

  it("adds paise without floating-point drift", () => {
    const totals = planTotals(
      [
        { estimated_cost: 0.1, approval_required: false },
        { estimated_cost: 0.2, approval_required: true },
      ],
      1,
    );
    expect(totals.total).toBe(0.3);
    expect(totals.approvalsNeeded).toBe(1);
  });
});
