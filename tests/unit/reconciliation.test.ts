import { describe, expect, it } from "vitest";

import { planTotals } from "@/lib/planner/policy";
import { flagMessages, moneyTrail, varianceLabel, type InvoiceMatch } from "@/lib/reconciliation";

// The spec's demo invoice, exactly as the database stores it (numbers arrive as text).
const eightPercentOver: InvoiceMatch = {
  invoice_number: "INV-SKY-2291",
  amount: "116640.00",
  agreed_amount: "108000.00",
  invoiced_to_date: "116640.00",
  variance_amount: "8640.00",
  variance_pct: "8.00",
  tolerance_pct: "2.00",
  budget_remaining_after: "1383360.00",
  flags: ["over_agreed_rate"],
  status: "flagged",
};

describe("varianceLabel", () => {
  it("describes over, under and exact", () => {
    expect(varianceLabel(8640, 8)).toBe("₹8,640 over (8.0%)");
    expect(varianceLabel("-5000.00", "-2.34")).toBe("₹5,000 under (2.3%)");
    expect(varianceLabel(0, 0)).toBe("Exactly as agreed");
  });
});

describe("flagMessages", () => {
  it("explains the 8%-over invoice in plain words", () => {
    expect(flagMessages(eightPercentOver)).toEqual([
      "₹8,640 (8.0%) above the agreed price of ₹1,08,000 — more than the 2% allowed.",
    ]);
  });

  it("mentions earlier invoices when they add up past the agreed price", () => {
    const second = { ...eightPercentOver, amount: "20000.00", invoiced_to_date: "116640.00" };
    expect(flagMessages(second)[0]).toContain("counting ₹96,640 already invoiced");
  });

  it("explains budget and duplicate flags", () => {
    const inv = { ...eightPercentOver, flags: ["over_budget", "duplicate_number"], budget_remaining_after: "-460000.00" };
    expect(flagMessages(inv)).toEqual([
      "Takes the relocation ₹4,60,000 over budget.",
      "Invoice number INV-SKY-2291 has been used before by this provider.",
    ]);
  });

  it("says nothing for a matched invoice", () => {
    expect(flagMessages({ ...eightPercentOver, flags: [], status: "matched" })).toEqual([]);
  });
});

describe("moneyTrail", () => {
  const workOrder = { reference: "WO-1A2B3C4D", status: "booked", booking_reference: "SKY-DEMO-1042" };

  it("runs estimate → agreed → work order → booking → invoiced → difference", () => {
    const trail = moneyTrail({ estimate: 114000, agreed: 108000, provider: "Skyline", workOrder, invoices: [eightPercentOver] });
    expect(trail.map((s) => `${s.label}: ${s.value}`)).toEqual([
      "Estimate: ₹1,14,000",
      "Agreed: ₹1,08,000 with Skyline",
      "Work order: WO-1A2B3C4D (booked)",
      "Booking: SKY-DEMO-1042",
      "Invoiced: ₹1,16,640",
      "Difference: ₹8,640 over (8.0%)",
    ]);
    expect(trail.at(-1)?.tone).toBe("warn");
  });

  it("leaves disputed invoices out of the invoiced total", () => {
    const disputed = { ...eightPercentOver, status: "disputed" as const };
    const corrected = { ...eightPercentOver, amount: "108000.00", flags: [], status: "matched" as const };
    const trail = moneyTrail({ estimate: 114000, agreed: 108000, provider: null, workOrder, invoices: [disputed, corrected] });
    expect(trail.at(-2)?.value).toBe("₹1,08,000");
    expect(trail.at(-1)).toEqual({ label: "Difference", value: "Exactly as agreed", tone: "ok" });
  });

  it("stops where the service has got to", () => {
    expect(moneyTrail({ estimate: 55000, agreed: null, provider: null, workOrder: null, invoices: [] }).map((s) => s.label)).toEqual([
      "Estimate",
      "Agreed",
    ]);
    const waiting = moneyTrail({ estimate: 1, agreed: 1, provider: null, workOrder: { ...workOrder, booking_reference: null }, invoices: [] });
    expect(waiting.map((s) => s.value).slice(-2)).toEqual(["Not booked yet", "No invoice yet"]);
  });
});

describe("planTotals with invoices", () => {
  const services = [
    // flights: agreed 1,08,000, invoiced 8% over
    { estimated_cost: 114000, approval_required: false, agreed_cost: 108000, work_order_status: "booked", invoiced_amount: 116640, flagged_invoices: 1 },
    // shipment: invoiced exactly
    { estimated_cost: 380000, approval_required: false, agreed_cost: 365000, work_order_status: "booked", invoiced_amount: 365000 },
    // housing: nothing chosen yet
    { estimated_cost: 420000, approval_required: true, agreed_cost: null },
  ];

  it("totals invoiced, the difference against agreed, and invoices waiting for review", () => {
    const t = planTotals(services, 1500000);
    expect(t.invoiced).toBe(481640);
    expect(t.variance).toBe(8640);
    expect(t.flaggedInvoices).toBe(1);
  });

  it("forecasts with invoices where they have arrived", () => {
    const t = planTotals(services, 1500000);
    expect(t.forecast).toBe(116640 + 365000 + 420000);
    expect(t.remaining).toBe(1500000 - 901640);
  });
});
