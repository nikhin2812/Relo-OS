import { describe, expect, it } from "vitest";

import { portfolioTotals, summarizeRelocation } from "@/lib/overview";

const base = { id: "a1", employee_name: "Eshan (Demo)", origin: "Bengaluru", destination: "Dubai", move_date: "2026-11-15", status: "in_progress" };
const svc = (id: string, estimate: number, agreed: number | null, extra = {}) => ({
  id,
  estimated_cost: estimate,
  approval_required: false,
  agreed_cost: agreed,
  agreed_over_cap: false,
  approved_at: null,
  ...extra,
});

describe("summarizeRelocation", () => {
  it("counts bookings and to-dos and splits committed from forecast", () => {
    const s = summarizeRelocation({
      assignment: base,
      budget: 1500000,
      services: [svc("f", 114000, 108000), svc("h", 420000, 330000), svc("s", 70000, null)],
      workOrderStatusByService: new Map([["f", "booked"], ["h", "sent"]]),
      tasks: [{ status: "done" }, { status: "todo" }, { status: "done" }],
    });
    expect(s.title).toBe("Bengaluru → Dubai");
    expect(s.totals?.booked).toBe(1);
    expect(s.totals?.services).toBe(3);
    expect(s.totals?.committed).toBe(438000);
    expect(s.totals?.forecast).toBe(508000);
    expect(s.totals?.remaining).toBe(992000);
    expect([s.tasksDone, s.tasksTotal]).toEqual([2, 3]);
  });
});

describe("portfolioTotals", () => {
  const planned = summarizeRelocation({
    assignment: base,
    budget: 1000000,
    services: [svc("x", 1200000, null)],
    workOrderStatusByService: new Map(),
    tasks: [],
  });
  const unplanned = summarizeRelocation({
    assignment: { ...base, id: "a2" },
    budget: 500000,
    services: [],
    workOrderStatusByService: new Map(),
    tasks: [],
  });
  const hidden = { ...unplanned, id: "a3", totals: null };

  it("adds budgets and counts over-budget relocations; unplanned ones forecast nothing", () => {
    expect(portfolioTotals([planned, unplanned, hidden])).toEqual({
      relocations: 3,
      budget: 1500000,
      committed: 0,
      forecast: 1200000,
      remaining: 300000,
      overBudget: 1,
    });
  });
});
