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
      invoiced: 0,
      variance: 0,
      flaggedInvoices: 0,
      forecast: 1200000,
      remaining: 300000,
      overBudget: 1,
    });
  });
});

describe("summaries with invoices", () => {
  it("counts invoiced amounts, the difference and flagged invoices per relocation and overall", () => {
    const s = summarizeRelocation({
      assignment: base,
      budget: 1500000,
      services: [svc("f", 114000, 108000), svc("g", 380000, 365000)],
      workOrderStatusByService: new Map([["f", "booked"], ["g", "booked"]]),
      tasks: [],
      invoices: [
        { service_id: "f", amount: "116640.00", status: "flagged" },
        { service_id: "g", amount: "365000.00", status: "matched" },
        { service_id: "g", amount: "999.00", status: "disputed" },
      ],
    });
    expect(s.totals?.invoiced).toBe(481640);
    expect(s.totals?.variance).toBe(8640);
    expect(s.totals?.flaggedInvoices).toBe(1);
    const p = portfolioTotals([s]);
    expect([p.invoiced, p.variance, p.flaggedInvoices]).toEqual([481640, 8640, 1]);
  });
});
