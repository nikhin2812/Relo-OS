import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { formatDate, formatINR } from "@/lib/format";
import { ROLE_LABELS, canSeeBudgets } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";

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
        <form action={logout}>
          <Button variant="outline" type="submit">
            Sign out
          </Button>
        </form>
      </header>

      {user.role === "vendor" && (
        <Card>
          <CardHeader>
            <CardTitle>Work orders</CardTitle>
            <CardDescription>No work orders have been sent to you yet.</CardDescription>
          </CardHeader>
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
                  {a.origin} → {a.destination}
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
                    <dd className="capitalize">{a.status.replace("_", " ")}</dd>
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
