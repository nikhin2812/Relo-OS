import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { summarizeRelocation, type RelocationSummary } from "@/lib/overview";

type ServiceRow = {
  id: string;
  assignment_id: string;
  title: string;
  category: string;
  estimated_cost: number;
  approval_required: boolean;
  agreed_cost: number | null;
  agreed_over_cap: boolean;
  approved_at: string | null;
  selected_vendor_id: string | null;
};

export type OverviewData = {
  summaries: RelocationSummary[];
  services: ServiceRow[];
  workOrders: { service_id: string; status: string; reference: string; booking_reference: string | null; sent_at: string }[];
  vendors: Map<string, string>;
  assignments: { id: string; employee_name: string; origin: string; destination: string; move_date: string; status: string; client_companies: { name: string } | null }[];
  budgets: Map<string, number>;
};

// Loads everything the overview and the CSV export need. Row level security
// decides which relocations come back for this user.
export async function loadOverview(supabase: SupabaseClient): Promise<OverviewData> {
  const [assignmentsRes, budgetsRes, servicesRes, workOrdersRes, tasksRes, vendorsRes] = await Promise.all([
    supabase.from("assignments").select("id, employee_name, origin, destination, move_date, status, client_companies(name)").order("move_date"),
    supabase.from("assignment_budgets").select("assignment_id, amount"),
    supabase
      .from("plan_services")
      .select("id, assignment_id, title, category, estimated_cost, approval_required, agreed_cost, agreed_over_cap, approved_at, selected_vendor_id")
      .order("sequence"),
    supabase.from("work_orders").select("service_id, status, reference, booking_reference, sent_at").order("sent_at", { ascending: false }),
    supabase.from("journey_tasks").select("assignment_id, status"),
    supabase.from("vendors").select("id, name"),
  ]);

  const assignments = (assignmentsRes.data ?? []) as unknown as OverviewData["assignments"];
  const budgets = new Map((budgetsRes.data ?? []).map((b) => [b.assignment_id as string, Number(b.amount)]));
  const services = ((servicesRes.data ?? []) as ServiceRow[]).map((s) => ({
    ...s,
    estimated_cost: Number(s.estimated_cost),
    agreed_cost: s.agreed_cost === null ? null : Number(s.agreed_cost),
  }));
  const workOrders = (workOrdersRes.data ?? []) as OverviewData["workOrders"];
  const latestStatus = new Map<string, string>();
  for (const wo of workOrders) if (!latestStatus.has(wo.service_id)) latestStatus.set(wo.service_id, wo.status);
  const tasks = (tasksRes.data ?? []) as { assignment_id: string; status: string }[];

  const summaries = assignments.map((a) =>
    summarizeRelocation({
      assignment: a,
      budget: budgets.get(a.id) ?? null,
      services: services.filter((s) => s.assignment_id === a.id),
      workOrderStatusByService: latestStatus,
      tasks: tasks.filter((t) => t.assignment_id === a.id),
    }),
  );

  return {
    summaries,
    services,
    workOrders,
    vendors: new Map((vendorsRes.data ?? []).map((v) => [v.id as string, v.name as string])),
    assignments,
    budgets,
  };
}
