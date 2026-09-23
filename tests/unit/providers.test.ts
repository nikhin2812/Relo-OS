import { describe, expect, it } from "vitest";

import { planTotals } from "@/lib/planner/policy";
import { agreedCost, providerOptions, type Vendor, type VendorRate } from "@/lib/providers";

const vendors: Vendor[] = [
  { id: "falcon", name: "Falcon Relocation Services (Demo)", city: "Dubai" },
  { id: "skyline", name: "Skyline Moves & Travel (Demo)", city: "Bengaluru" },
  { id: "palm", name: "Palm Stay Apartments (Demo)", city: "Dubai" },
];

const rates: VendorRate[] = [
  { vendor_id: "falcon", category: "flights", rate: 41000, rate_basis: "per_person", description: "Flexible" },
  { vendor_id: "skyline", category: "flights", rate: 36000, rate_basis: "per_person", description: "Standard" },
  { vendor_id: "falcon", category: "temporary_housing", rate: 390000, rate_basis: "per_family", description: "45 nights" },
  { vendor_id: "palm", category: "temporary_housing", rate: 330000, rate_basis: "per_family", description: "30 nights" },
  { vendor_id: "unknown", category: "flights", rate: 1, rate_basis: "per_family", description: "Not in network" },
];

describe("agreedCost", () => {
  it("multiplies per-person rates by family size", () => {
    expect(agreedCost(36000, "per_person", 3)).toBe(108000);
  });
  it("uses per-family rates as they are", () => {
    expect(agreedCost(330000, "per_family", 3)).toBe(330000);
  });
  it("handles paise exactly", () => {
    expect(agreedCost(0.1, "per_person", 3)).toBe(0.3);
  });
});

describe("providerOptions", () => {
  it("lists only vendors offering the service, cheapest first", () => {
    const options = providerOptions("flights", rates, vendors, 3, 135000);
    expect(options.map((o) => [o.vendorName, o.cost])).toEqual([
      ["Skyline Moves & Travel (Demo)", 108000],
      ["Falcon Relocation Services (Demo)", 123000],
    ]);
  });

  it("ignores rates from vendors that aren't in the RMC's network", () => {
    expect(providerOptions("flights", rates, vendors, 3, null).some((o) => o.vendorId === "unknown")).toBe(false);
  });

  it("flags options above the policy cap", () => {
    const options = providerOptions("temporary_housing", rates, vendors, 3, 350000);
    expect(options.find((o) => o.vendorId === "palm")?.overCap).toBe(false);
    expect(options.find((o) => o.vendorId === "falcon")?.overCap).toBe(true);
  });

  it("never flags when the policy sets no cap", () => {
    expect(providerOptions("temporary_housing", rates, vendors, 3, null).every((o) => !o.overCap)).toBe(true);
  });

  it("returns nothing for a service no vendor offers", () => {
    expect(providerOptions("school_search", rates, vendors, 3, 60000)).toEqual([]);
  });
});

describe("planTotals with chosen providers and work orders", () => {
  const services = [
    { estimated_cost: 114000, approval_required: false, agreed_cost: 108000, agreed_over_cap: false, work_order_status: "booked" },
    { estimated_cost: 420000, approval_required: true, agreed_cost: 390000, agreed_over_cap: true, work_order_status: null },
    { estimated_cost: 70000, approval_required: false, agreed_cost: null, agreed_over_cap: false },
    { estimated_cost: 55000, approval_required: false, agreed_cost: 65000, agreed_over_cap: true, work_order_status: "sent" },
    { estimated_cost: 20000, approval_required: false, agreed_cost: 25000, agreed_over_cap: false, work_order_status: "declined" },
  ];

  it("separates estimates, agreed prices, committed spend and the forecast", () => {
    const t = planTotals(services, 1500000);
    expect(t.total).toBe(679000);
    expect(t.agreed).toBe(588000); // every chosen provider
    expect(t.committed).toBe(173000); // only live work orders: booked 108,000 + sent 65,000
    expect(t.forecast).toBe(658000); // agreed where chosen, estimate otherwise
    expect(t.remaining).toBe(842000);
    expect(t.overBudget).toBe(false);
    expect(t.booked).toBe(1);
    expect(t.services).toBe(5);
  });

  it("a declined work order is not committed spend", () => {
    const t = planTotals([services[4]], 100000);
    expect(t.committed).toBe(0);
    expect(t.agreed).toBe(25000);
  });

  it("counts services still waiting for approval, once each", () => {
    expect(planTotals(services, 1500000).approvalsNeeded).toBe(2);
    const approved = services.map((s) => ({ ...s, approved_at: "2026-09-23T10:00:00Z" }));
    expect(planTotals(approved, 1500000).approvalsNeeded).toBe(0);
  });

  it("uses the forecast, not the estimate, to decide if the plan is over budget", () => {
    expect(planTotals(services, 670000).overBudget).toBe(false); // estimates 679,000 but forecast 658,000
    expect(planTotals(services, 650000).overBudget).toBe(true);
  });
});
