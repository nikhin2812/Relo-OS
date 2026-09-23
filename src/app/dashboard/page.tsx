import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { formatDate, formatINR } from "@/lib/format";
import { ROLE_LABELS, canSeeBudgets } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { STAFF_STATUS_LABELS, type WorkOrderStatus } from "@/lib/work-orders";
import { INVOICE_STATUS_LABELS, type InvoiceStatus } from "@/lib/reconciliation";

import { logout } from "../login/actions";

type AssignmentRow = {
  id: string;
  employee_name: string;
  family_size: number;
  origin: string;
  destination: string;
  move_date: string;
  status: string;
  client_companies: { name: string } | null;
};

export default async function DashboardPage() {
  const user = await requireUser();
  const supabase = await createClient();

  // Row level security decides which rows come back for this user.
  const { data: assignments } = await supabase
    .from("assignments")
    .select("id, employee_name, family_size, origin, destination, move_date, status, client_companies(name)")
    .order("move_date")
    .returns<AssignmentRow[]>();

  const showBudgets = canSeeBudgets(user.role);
  const budgets = new Map<string, number>();
  if (showBudgets) {
    const { data } = await supabase.from("assignment_budgets").select("assignment_id, amount");
    data?.forEach((b) => budgets.set(b.assignment_id, Number(b.amount)));
  }

  const heading = user.role === "employee" ? "My relocation" : "Relocations";
  const vendorOrders =
    user.role === "vendor"
      ? ((
          await supabase
            .from("work_orders")
            .select("reference, status, agreed_cost, details")
            .order("sent_at", { ascending: false })
        ).data ?? []) as {
          reference: string;
          status: WorkOrderStatus;
          agreed_cost: number;
          details: { service_title: string; origin: string; destination: string };
        }[]
      : [];
  const vendorInvoices =
    user.role === "vendor"
      ? ((await supabase.from("invoices").select("invoice_number, invoice_date, amount, status").order("created_at", { ascending: false }))
          .data ?? []) as { invoice_number: string; invoice_date: string; amount: number; status: InvoiceStatus }[]
      : [];

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 p-4 sm:p-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm text-neutral-500">{user.tenantName}</p>
          <h1 className="text-2xl font-semibold">{heading}</h1>
          <p className="text-sm text-neutral-600">
            Signed in as {user.fullName} · <span data-testid="role">{ROLE_LABELS[user.role]}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canSeeBudgets(user.role) && (
            <Button asChild variant="outline">
              <Link href="/overview">Progress and budget</Link>
            </Button>
          )}
          {user.role === "hr_user" && (
            <Button asChild>
              <Link href="/requests/new">New relocation request</Link>
            </Button>
          )}
          <form action={logout}>
            <Button variant="outline" type="submit">
              Sign out
            </Button>
          </form>
        </div>
      </header>

      {user.role === "vendor" && (
        <Card>
          <CardHeader>
            <CardTitle>Work orders</CardTitle>
            <CardDescription>
              {vendorOrders.length === 0
                ? "No work orders have been sent to you yet."
                : "Work orders sent to your company. Use the secure link in each work order email to update it."}
            </CardDescription>
          </CardHeader>
          {vendorInvoices.length > 0 && (
            <CardContent>
              <h3 className="mb-2 font-medium">Your invoices</h3>
              <ul className="flex flex-col divide-y divide-neutral-100 text-sm" data-testid="vendor-invoices">
                {vendorInvoices.map((inv) => (
                  <li key={inv.invoice_number + inv.invoice_date} className="flex flex-wrap justify-between gap-2 py-2">
                    <span>
                      {inv.invoice_number} · {formatDate(inv.invoice_date)}
                    </span>
                    <span>
                      {formatINR(Number(inv.amount))} ·{" "}
                      {inv.status === "matched" || inv.status === "approved" ? INVOICE_STATUS_LABELS[inv.status] : "Under review"}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          )}
          {vendorOrders.length > 0 && (
            <CardContent>
              <ul className="flex flex-col divide-y divide-neutral-100 text-sm" data-testid="vendor-work-orders">
                {vendorOrders.map((wo) => (
                  <li key={wo.reference} className="flex flex-wrap justify-between gap-2 py-2" data-testid="vendor-work-order">
                    <span>
                      <span className="font-medium">{wo.reference}</span> · {wo.details.service_title} · {wo.details.origin} →{" "}
                      {wo.details.destination}
                    </span>
                    <span>
                      {STAFF_STATUS_LABELS[wo.status]} · {formatINR(wo.agreed_cost)}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          )}
        </Card>
      )}

      {user.role !== "vendor" && (!assignments || assignments.length === 0) && (
        <p className="text-neutral-600">No relocations to show.</p>
      )}

      <ul className="flex flex-col gap-4" data-testid="assignment-list">
        {assignments?.map((a) => (
          <li key={a.id}>
            <Card data-testid="assignment-card">
              <CardHeader>
                <CardTitle>
                  <Link href={`/assignments/${a.id}`} className="hover:underline">
                    {a.origin} → {a.destination}
                  </Link>
                </CardTitle>
                <CardDescription>
                  {a.employee_name} · family of {a.family_size}
                  {a.client_companies && user.role !== "employee" ? ` · ${a.client_companies.name}` : ""}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
                  <div>
                    <dt className="text-neutral-500">Move date</dt>
                    <dd>{formatDate(a.move_date)}</dd>
                  </div>
                  <div>
                    <dt className="text-neutral-500">Status</dt>
                    <dd className="capitalize" data-testid="status">{a.status.replace("_", " ")}</dd>
                  </div>
                  {showBudgets && budgets.has(a.id) && (
                    <div>
                      <dt className="text-neutral-500">Budget</dt>
                      <dd data-testid="budget">{formatINR(budgets.get(a.id)!)}</dd>
                    </div>
                  )}
                </dl>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
    </main>
  );
}
