// MVP item 8: HR's view of progress and committed budget across relocations.
import { planTotals, type PlanTotals } from "@/lib/planner/policy";

export type OverviewInput = {
  assignment: { id: string; employee_name: string; origin: string; destination: string; move_date: string; status: string };
  budget: number | null;
  services: {
    id: string;
    estimated_cost: number;
    approval_required: boolean;
    agreed_cost: number | null;
    agreed_over_cap: boolean;
    approved_at: string | null;
  }[];
  workOrderStatusByService: Map<string, string>;
  tasks: { status: string }[];
  /** Invoices on this relocation's services. */
  invoices?: { service_id: string; amount: number | string; status: string }[];
};

export type RelocationSummary = {
  id: string;
  title: string;
  employee: string;
  moveDate: string;
  status: string;
  totals: PlanTotals | null;
  tasksDone: number;
  tasksTotal: number;
};

export function summarizeRelocation(input: OverviewInput): RelocationSummary {
  const { assignment, budget, services, workOrderStatusByService, tasks, invoices = [] } = input;
  const billed = (id: string) =>
    invoices.filter((i) => i.service_id === id && i.status !== "disputed").reduce((n, i) => n + Number(i.amount), 0);
  return {
    id: assignment.id,
    title: `${assignment.origin} → ${assignment.destination}`,
    employee: assignment.employee_name,
    moveDate: assignment.move_date,
    status: assignment.status,
    totals:
      budget === null
        ? null
        : planTotals(
            services.map((s) => ({
              ...s,
              work_order_status: workOrderStatusByService.get(s.id) ?? null,
              invoiced_amount: billed(s.id) || null,
              flagged_invoices: invoices.filter((i) => i.service_id === s.id && i.status === "flagged").length,
            })),
            budget,
          ),
    tasksDone: tasks.filter((t) => t.status === "done").length,
    tasksTotal: tasks.length,
  };
}

export type PortfolioTotals = {
  relocations: number;
  budget: number;
  committed: number;
  invoiced: number;
  variance: number;
  flaggedInvoices: number;
  forecast: number;
  remaining: number;
  overBudget: number;
};

export function portfolioTotals(summaries: RelocationSummary[]): PortfolioTotals {
  const paise = (n: number) => Math.round(n * 100);
  let budget = 0;
  let committed = 0;
  let forecast = 0;
  let overBudget = 0;
  let invoiced = 0;
  let variance = 0;
  let flaggedInvoices = 0;
  for (const s of summaries) {
    if (!s.totals) continue;
    budget += paise(s.totals.budget);
    committed += paise(s.totals.committed);
    invoiced += paise(s.totals.invoiced);
    variance += paise(s.totals.variance);
    flaggedInvoices += s.totals.flaggedInvoices;
    // A relocation with no plan yet is forecast at nothing spent.
    forecast += s.totals.services > 0 ? paise(s.totals.forecast) : 0;
    if (s.totals.services > 0 && s.totals.overBudget) overBudget++;
  }
  return {
    relocations: summaries.length,
    budget: budget / 100,
    committed: committed / 100,
    invoiced: invoiced / 100,
    variance: variance / 100,
    flaggedInvoices,
    forecast: forecast / 100,
    remaining: (budget - forecast) / 100,
    overBudget,
  };
}
