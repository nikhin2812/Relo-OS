import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { toCsv } from "@/lib/csv";
import { loadOverview } from "@/lib/overview-data";
import { canSeeBudgets } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";

// Spec section 7: export relocations and costs, one row per service.
export async function GET() {
  const user = await requireUser();
  if (!canSeeBudgets(user.role)) return new NextResponse("Not found", { status: 404 });

  const supabase = await createClient();
  const data = await loadOverview(supabase);
  const latestWorkOrder = new Map<string, OverviewWorkOrder>();
  for (const wo of data.workOrders) if (!latestWorkOrder.has(wo.service_id)) latestWorkOrder.set(wo.service_id, wo);

  const rows: unknown[][] = [
    ["relocation_id", "company", "employee_name", "origin", "destination", "move_date", "relocation_status", "budget_inr",
     "service", "category", "estimated_cost_inr", "provider", "agreed_cost_inr", "approval_needed", "approved",
     "work_order", "work_order_status", "booking_reference"],
  ];
  for (const a of data.assignments) {
    const services = data.services.filter((s) => s.assignment_id === a.id);
    const base = [a.id, a.client_companies?.name ?? "", a.employee_name, a.origin, a.destination, a.move_date, a.status, data.budgets.get(a.id) ?? ""];
    if (services.length === 0) rows.push([...base, "", "", "", "", "", "", "", "", "", ""]);
    for (const s of services) {
      const wo = latestWorkOrder.get(s.id);
      rows.push([
        ...base,
        s.title,
        s.category,
        s.estimated_cost,
        s.selected_vendor_id ? (data.vendors.get(s.selected_vendor_id) ?? "") : "",
        s.agreed_cost ?? "",
        s.approval_required || s.agreed_over_cap ? "yes" : "no",
        s.approved_at ? "yes" : "no",
        wo?.reference ?? "",
        wo?.status ?? "",
        wo?.booking_reference ?? "",
      ]);
    }
  }

  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(toCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="relocations-${date}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

type OverviewWorkOrder = Awaited<ReturnType<typeof loadOverview>>["workOrders"][number];
