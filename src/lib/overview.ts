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
  const { assignment, budget, services, workOrderStatusByService, tasks } = input;
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
            services.map((s) => ({ ...s, work_order_status: workOrderStatusByService.get(s.id) ?? null })),
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
  for (const s of summaries) {
    if (!s.totals) continue;
    budget += paise(s.totals.budget);
    committed += paise(s.totals.committed);
    // A relocation with no plan yet is forecast at nothing spent.
    forecast += s.totals.services > 0 ? paise(s.totals.forecast) : 0;
    if (s.totals.services > 0 && s.totals.overBudget) overBudget++;
  }
  return {
    relocations: summaries.length,
    budget: budget / 100,
    committed: committed / 100,
    forecast: forecast / 100,
    remaining: (budget - forecast) / 100,
    overBudget,
  };
}
