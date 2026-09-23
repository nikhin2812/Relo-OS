import { describe, expect, it } from "vitest";

import { mockPlan } from "@/lib/planner/mock";
import type { PlannerOutput } from "@/lib/planner/schema";
import { validatePlan } from "@/lib/planner/validate";

const request = {
  employeeName: "Test Person (Demo)",
  familySize: 3,
  origin: "Bengaluru, India",
  destination: "Dubai, UAE",
  moveDate: "2026-11-15",
  budget: 1500000,
};

function withChange(change: (p: PlannerOutput) => void): string {
  const plan = structuredClone(mockPlan(request));
  change(plan);
  return JSON.stringify(plan);
}

function expectRejected(raw: string, pattern: RegExp) {
  const result = validatePlan(raw, request);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error).toMatch(pattern);
}

describe("validatePlan", () => {
  it("accepts a well-formed plan and sorts services by step", () => {
    const result = validatePlan(JSON.stringify(mockPlan(request)), request);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plan.services).toHaveLength(6);
      const steps = result.plan.services.map((s) => s.sequence);
      expect(steps).toEqual([...steps].sort((a, b) => a - b));
    }
  });

  it("rejects text that is not JSON", () => {
    expectRejected("Sure! Here is your plan: ...", /valid JSON/);
  });

  it("rejects a plan with a missing field", () => {
    expectRejected(withChange((p) => delete (p.services[0] as Partial<typeof p.services[0]>).estimated_cost), /services\.0\.estimated_cost/);
  });

  it("rejects an unknown service category", () => {
    expectRejected(withChange((p) => ((p.services[0] as { category: string }).category = "yacht_charter")), /category/);
  });

  it("rejects a plan with no services", () => {
    expectRejected(withChange((p) => (p.services = [])), /between 1 and 20/);
  });

  it("rejects negative and absurd costs", () => {
    expectRejected(withChange((p) => (p.services[0].estimated_cost = -5)), /impossible cost/);
    expectRejected(withChange((p) => (p.services[0].estimated_cost = 5_000_000_000)), /impossible cost/);
  });

  it("rejects impossible and badly formatted dates", () => {
    expectRejected(withChange((p) => (p.services[0].due_date = "2026-02-30")), /invalid date/);
    expectRejected(withChange((p) => (p.services[0].start_date = "15/11/2026")), /invalid date/);
  });

  it("rejects a service that ends before it starts", () => {
    expectRejected(withChange((p) => {
      p.services[0].start_date = "2026-10-10";
      p.services[0].due_date = "2026-10-01";
    }), /ends before it starts/);
  });

  it("rejects dates far from the move date", () => {
    expectRejected(withChange((p) => (p.services[0].due_date = "2029-01-01")), /too far/);
  });

  it("rejects duplicate service keys and unsafe keys", () => {
    expectRejected(withChange((p) => (p.services[1].key = p.services[0].key)), /appears twice/);
    expectRejected(withChange((p) => (p.services[0].key = "Robert'); DROP TABLE")), /not allowed/);
  });

  it("rejects a dependency on a service that isn't in the plan", () => {
    expectRejected(withChange((p) => (p.services[1].depends_on = ["pet_transport"])), /unknown service "pet_transport"/);
  });

  it("rejects a service scheduled before the service it depends on", () => {
    expectRejected(withChange((p) => {
      const flights = p.services.find((s) => s.key === "flights")!;
      flights.sequence = 1; // same step as immigration, which it depends on
    }), /must come after "immigration"/);
  });

  it("rejects a milestone linked to an unknown service", () => {
    expectRejected(withChange((p) => (p.milestones[0].related_service_keys = ["nope"])), /unknown service "nope"/);
  });

  it("rejects an empty summary", () => {
    expectRejected(withChange((p) => (p.summary = "  ")), /summary/);
  });
});
