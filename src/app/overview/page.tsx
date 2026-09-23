import Link from "next/link";
import { notFound } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { formatDate, formatINR } from "@/lib/format";
import { portfolioTotals } from "@/lib/overview";
import { loadOverview } from "@/lib/overview-data";
import { canSeeBudgets } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";

// MVP item 8: progress and committed budget for every relocation the user can see.
export default async function OverviewPage() {
  const user = await requireUser();
  if (!canSeeBudgets(user.role)) notFound();

  const supabase = await createClient();
  const { summaries } = await loadOverview(supabase);
  const portfolio = portfolioTotals(summaries);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 sm:p-8">
      <Link href="/dashboard" className="text-sm text-neutral-600 hover:underline">
        ← Back to relocations
      </Link>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-neutral-500">{user.tenantName}</p>
          <h1 className="text-2xl font-semibold">Progress and budget</h1>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <a href="/exports/relocations">Download CSV</a>
          </Button>
          {user.role === "hr_user" && (
            <Button asChild variant="outline">
              <Link href="/requests/import">Import CSV</Link>
            </Button>
          )}
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>All relocations</CardTitle>
          <CardDescription>
            Committed means work orders sent to providers. Forecast uses invoices where they have arrived, agreed prices
            where a provider is chosen, and the plan&apos;s estimate otherwise.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4 lg:grid-cols-7" data-testid="portfolio">
            <div>
              <dt className="text-neutral-500">Relocations</dt>
              <dd className="text-lg font-semibold" data-testid="portfolio-count">{portfolio.relocations}</dd>
            </div>
            <div>
              <dt className="text-neutral-500">Total budget</dt>
              <dd className="text-lg font-semibold" data-testid="portfolio-budget">{formatINR(portfolio.budget)}</dd>
            </div>
            <div>
              <dt className="text-neutral-500">Committed</dt>
              <dd className="text-lg font-semibold" data-testid="portfolio-committed">{formatINR(portfolio.committed)}</dd>
            </div>
            <div>
              <dt className="text-neutral-500">Invoiced</dt>
              <dd className="text-lg font-semibold" data-testid="portfolio-invoiced">{formatINR(portfolio.invoiced)}</dd>
            </div>
            <div>
              <dt className="text-neutral-500">Invoices to review</dt>
              <dd className="text-lg font-semibold" data-testid="portfolio-flagged">{portfolio.flaggedInvoices}</dd>
            </div>
            <div>
              <dt className="text-neutral-500">Forecast</dt>
              <dd className="text-lg font-semibold" data-testid="portfolio-forecast">{formatINR(portfolio.forecast)}</dd>
            </div>
            <div>
              <dt className="text-neutral-500">Over budget</dt>
              <dd className="text-lg font-semibold" data-testid="portfolio-over">{portfolio.overBudget}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className="w-full min-w-[1000px] text-sm" data-testid="overview-table">
          <thead className="bg-neutral-50 text-left text-neutral-600">
            <tr>
              <th className="p-3 font-medium">Relocation</th>
              <th className="p-3 font-medium">Move date</th>
              <th className="p-3 font-medium">Services booked</th>
              <th className="p-3 font-medium">To-dos done</th>
              <th className="p-3 font-medium">Approvals waiting</th>
              <th className="p-3 text-right font-medium">Budget</th>
              <th className="p-3 text-right font-medium">Committed</th>
              <th className="p-3 text-right font-medium">Invoiced</th>
              <th className="p-3 text-right font-medium">Difference</th>
              <th className="p-3 text-right font-medium">Forecast remaining</th>
            </tr>
          </thead>
          <tbody>
            {summaries.map((s) => (
              <tr key={s.id} className="border-t border-neutral-100" data-testid="overview-row">
                <td className="p-3">
                  <Link href={`/assignments/${s.id}`} className="font-medium hover:underline">
                    {s.title}
                  </Link>
                  <p className="text-neutral-500">{s.employee}</p>
                </td>
                <td className="p-3">{formatDate(s.moveDate)}</td>
                <td className="p-3" data-testid="overview-booked">
                  {s.totals && s.totals.services > 0 ? `${s.totals.booked} of ${s.totals.services}` : "No plan yet"}
                </td>
                <td className="p-3" data-testid="overview-tasks">{s.tasksTotal > 0 ? `${s.tasksDone} of ${s.tasksTotal}` : "—"}</td>
                <td className="p-3">{s.totals?.approvalsNeeded ?? 0}</td>
                <td className="p-3 text-right">{s.totals ? formatINR(s.totals.budget) : "—"}</td>
                <td className="p-3 text-right" data-testid="overview-committed">{s.totals ? formatINR(s.totals.committed) : "—"}</td>
                <td className="p-3 text-right" data-testid="overview-invoiced">{s.totals ? formatINR(s.totals.invoiced) : "—"}</td>
                <td className={`p-3 text-right ${s.totals && s.totals.variance > 0 ? "font-semibold text-red-700" : ""}`} data-testid="overview-variance">
                  {s.totals && s.totals.invoiced > 0 ? `${s.totals.variance > 0 ? "+" : ""}${formatINR(s.totals.variance)}` : "—"}
                  {s.totals && s.totals.flaggedInvoices > 0 ? ` · ${s.totals.flaggedInvoices} to review` : ""}
                </td>
                <td
                  className={`p-3 text-right ${s.totals?.overBudget && s.totals.services > 0 ? "font-semibold text-red-700" : ""}`}
                  data-testid="overview-remaining"
                >
                  {s.totals && s.totals.services > 0 ? formatINR(s.totals.remaining) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
