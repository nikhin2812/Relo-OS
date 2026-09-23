// MVP item 10 / spec section 8: explaining an invoice match in plain words and
// laying out the money trail budget → estimate → agreed → work order → booking → invoice → variance.
import { formatINR } from "@/lib/format";

export const INVOICE_FLAGS = ["over_agreed_rate", "over_budget", "duplicate_number"] as const;
export type InvoiceFlag = (typeof INVOICE_FLAGS)[number];
export type InvoiceStatus = "matched" | "flagged" | "approved" | "disputed";

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  matched: "Matched",
  flagged: "Flagged",
  approved: "Approved",
  disputed: "Disputed",
};

// Values come from the database, where numeric columns arrive as strings.
export type InvoiceMatch = {
  invoice_number: string;
  amount: number | string;
  agreed_amount: number | string;
  invoiced_to_date: number | string;
  variance_amount: number | string;
  variance_pct: number | string;
  tolerance_pct: number | string;
  budget_remaining_after: number | string;
  flags: string[];
  status: InvoiceStatus;
};

const pct = (n: number) => `${Math.abs(n).toFixed(1)}%`;

// "₹8,640 over (8.0%)", "₹5,000 under (2.3%)" or "Exactly as agreed".
export function varianceLabel(amount: number | string, percent: number | string): string {
  const a = Number(amount);
  const p = Number(percent);
  if (a === 0) return "Exactly as agreed";
  return `${formatINR(Math.abs(a))} ${a > 0 ? "over" : "under"} (${pct(p)})`;
}

export function flagMessages(inv: InvoiceMatch): string[] {
  const messages: string[] = [];
  for (const flag of inv.flags) {
    if (flag === "over_agreed_rate") {
      const earlier = Number(inv.invoiced_to_date) - Number(inv.amount);
      messages.push(
        `${formatINR(Number(inv.variance_amount))} (${pct(Number(inv.variance_pct))}) above the agreed price of ` +
          `${formatINR(Number(inv.agreed_amount))}` +
          (earlier > 0 ? `, counting ${formatINR(earlier)} already invoiced` : "") +
          ` — more than the ${Number(inv.tolerance_pct)}% allowed.`,
      );
    } else if (flag === "over_budget") {
      messages.push(`Takes the relocation ${formatINR(-Number(inv.budget_remaining_after))} over budget.`);
    } else if (flag === "duplicate_number") {
      messages.push(`Invoice number ${inv.invoice_number} has been used before by this provider.`);
    }
  }
  return messages;
}

export type TrailStep = { label: string; value: string; tone?: "ok" | "warn" | "muted" };

// One line per service, left to right, from plan to payment.
export function moneyTrail(input: {
  estimate: number;
  agreed: number | null;
  provider: string | null;
  workOrder: { reference: string; status: string; booking_reference: string | null } | null;
  invoices: InvoiceMatch[];
}): TrailStep[] {
  const steps: TrailStep[] = [{ label: "Estimate", value: formatINR(input.estimate), tone: "muted" }];
  steps.push(
    input.agreed === null
      ? { label: "Agreed", value: "No provider yet", tone: "muted" }
      : { label: "Agreed", value: `${formatINR(input.agreed)}${input.provider ? ` with ${input.provider}` : ""}` },
  );
  if (input.workOrder) {
    steps.push({ label: "Work order", value: `${input.workOrder.reference} (${input.workOrder.status})` });
    steps.push(
      input.workOrder.booking_reference
        ? { label: "Booking", value: input.workOrder.booking_reference }
        : { label: "Booking", value: "Not booked yet", tone: "muted" },
    );
  }
  const counted = input.invoices.filter((i) => i.status !== "disputed");
  if (counted.length > 0 && input.agreed !== null) {
    const invoiced = counted.reduce((sum, i) => sum + Math.round(Number(i.amount) * 100), 0) / 100;
    const variance = Math.round((invoiced - input.agreed) * 100) / 100;
    const percent = input.agreed > 0 ? (variance * 100) / input.agreed : 0;
    steps.push({ label: "Invoiced", value: formatINR(invoiced) });
    steps.push({
      label: "Difference",
      value: varianceLabel(variance, percent),
      tone: counted.some((i) => i.status === "flagged") ? "warn" : "ok",
    });
  } else if (input.workOrder) {
    steps.push({ label: "Invoiced", value: "No invoice yet", tone: "muted" });
  }
  return steps;
}
