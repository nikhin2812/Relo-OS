// One real call to Claude with the demo relocation, to prove the live planner
// returns a plan that passes every check. Runs only when ANTHROPIC_API_KEY is
// set (a GitHub secret in CI). Nothing is saved.
import { describe, expect, it } from "vitest";

import { requestPlan } from "@/lib/planner/client";
import { applyPolicy, planTotals } from "@/lib/planner/policy";
import type { PolicyConfig } from "@/lib/planner/schema";
import { validatePlan } from "@/lib/planner/validate";

const hasKey = Boolean(process.env.ANTHROPIC_API_KEY) && process.env.PLANNER_MODE !== "mock";

const policy: PolicyConfig = {
  currency: "INR",
  services: {
    immigration: { covered: true, max_cost: 150000 },
    flights: { covered: true, max_cost_per_person: 45000, cabin: "economy" },
    temporary_housing: { covered: true, max_days: 30, max_cost: 350000 },
    household_goods: { covered: true, max_cost: 400000, max_volume_cbm: 20 },
    school_search: { covered: true, max_cost: 60000 },
    settling_in: { covered: true, max_cost: 80000 },
  },
  approval_rules: ["Any service estimated above its policy cap needs RMC admin approval"],
};

describe.skipIf(!hasKey)("live AI planner", () => {
  it("plans the demo relocation (family of 3, Bengaluru to Dubai, ₹15 lakh)", { timeout: 300_000 }, async () => {
    const request = {
      employeeName: "Eshan Employee (Demo)",
      familySize: 3,
      origin: "Bengaluru, India",
      destination: "Dubai, UAE",
      moveDate: "2026-11-15",
      budget: 1500000,
    };
    const response = await requestPlan(request, policy);
    const checked = validatePlan(response.text, request);
    if (!checked.ok) throw new Error(`Live plan failed validation: ${checked.error}`);

    const plan = applyPolicy(checked.plan, policy, request.familySize);
    const categories = new Set(plan.services.map((s) => s.category));
    for (const c of ["immigration", "flights", "temporary_housing", "household_goods", "school_search"]) {
      expect(categories, `plan should include ${c}`).toContain(c);
    }
    const totals = planTotals(plan.services, request.budget);
    expect(totals.total).toBeGreaterThan(0);
    console.log(`Live plan from ${response.model}: ${plan.services.length} services, total ₹${totals.total}`);
  });
});
