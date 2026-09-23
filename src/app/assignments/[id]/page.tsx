import Link from "next/link";
import { notFound } from "next/navigation";

import { PolicyBadge } from "@/components/policy-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { formatDate, formatINR } from "@/lib/format";
import { planTotals } from "@/lib/planner/policy";
import { canSeeBudgets } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";

import { GeneratePlanButton } from "./generate-button";

export const maxDuration = 180;

type ServiceRow = {
  id: string;
  service_key: string;
  category: string;
  title: string;
  description: string;
  sequence: number;
  depends_on: string[];
  start_date: string | null;
  due_date: string | null;
  estimated_cost: number;
  policy_status: "within_policy" | "needs_review" | "out_of_policy";
  policy_note: string;
  approval_required: boolean;
  approval_reason: string;
};

export default async function AssignmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const user = await requireUser();
  const supabase = await createClient();

  const { data: assignment } = await supabase
    .from("assignments")
    .select("id, employee_name, family_size, origin, destination, move_date, status, client_companies(name)")
    .eq("id", id)
    .maybeSingle();
  if (!assignment) notFound();

  const costed = canSeeBudgets(user.role);
  const [budgetRes, planRes, servicesRes, milestonesRes] = await Promise.all([
    costed ? supabase.from("assignment_budgets").select("amount").eq("assignment_id", id).maybeSingle() : null,
    costed ? supabase.from("relocation_plans").select("status, summary, error_message, model").eq("assignment_id", id).maybeSingle() : null,
    costed
      ? supabase.from("plan_services").select("*").eq("assignment_id", id).order("sequence").order("start_date").returns<ServiceRow[]>()
      : null,
    supabase.from("plan_milestones").select("id, title, due_date, sequence").eq("assignment_id", id).order("sequence"),
  ]);

  const budget = budgetRes?.data ? Number(budgetRes.data.amount) : null;
  const plan = planRes?.data ?? null;
  const services = servicesRes?.data ?? [];
  const milestones = milestonesRes.data ?? [];
  const titles = new Map(services.map((s) => [s.service_key, s.title]));
  const totals = budget !== null && services.length > 0 ? planTotals(services, budget) : null;
  const company = assignment.client_companies as unknown as { name: string } | null;

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 sm:p-8">
      <Link href="/dashboard" className="text-sm text-neutral-600 hover:underline">
        ← Back to relocations
      </Link>

      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">
          {assignment.origin} → {assignment.destination}
        </h1>
        <p className="text-neutral-600">
          {assignment.employee_name} · family of {assignment.family_size} · moving {formatDate(assignment.move_date)}
          {company && user.role !== "employee" ? ` · ${company.name}` : ""}
        </p>
      </header>

      {costed && (
        <Card>
          <CardHeader>
            <CardTitle>Relocation plan</CardTitle>
            {plan?.status === "ready" && plan.summary && <CardDescription data-testid="plan-summary">{plan.summary}</CardDescription>}
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            {plan?.status !== "ready" && (
              <div className="flex flex-col gap-3" data-testid="plan-not-ready">
                {plan?.status === "failed" ? (
                  <p className="text-sm text-red-700" data-testid="plan-error">
                    The plan couldn&apos;t be generated: {plan.error_message}
                  </p>
                ) : (
                  <p className="text-sm text-neutral-600">No plan has been generated yet.</p>
                )}
                <GeneratePlanButton assignmentId={assignment.id} label={plan?.status === "failed" ? "Try again" : "Generate plan"} />
              </div>
            )}

            {totals && (
              <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4" data-testid="plan-totals">
                <div>
                  <dt className="text-neutral-500">Budget</dt>
                  <dd className="text-lg font-semibold" data-testid="budget">{formatINR(totals.budget)}</dd>
                </div>
                <div>
                  <dt className="text-neutral-500">Estimated total</dt>
                  <dd className="text-lg font-semibold" data-testid="estimated-total">{formatINR(totals.total)}</dd>
                </div>
                <div>
                  <dt className="text-neutral-500">{totals.overBudget ? "Over budget by" : "Remaining"}</dt>
                  <dd className={totals.overBudget ? "text-lg font-semibold text-red-700" : "text-lg font-semibold"} data-testid="remaining">
                    {formatINR(Math.abs(totals.remaining))}
                  </dd>
                </div>
                <div>
                  <dt className="text-neutral-500">Approvals needed</dt>
                  <dd className="text-lg font-semibold" data-testid="approvals-needed">{totals.approvalsNeeded}</dd>
                </div>
              </dl>
            )}

            {services.length > 0 && (
              <ol className="flex flex-col gap-3" data-testid="service-list">
                {services.map((s) => (
                  <li key={s.id} className="rounded-md border border-neutral-200 p-4" data-testid="service-row">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-xs uppercase tracking-wide text-neutral-500">Step {s.sequence}</p>
                        <h3 className="font-medium">{s.title}</h3>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <PolicyBadge status={s.policy_status} />
                        {s.approval_required && (
                          <span className="inline-flex rounded-full border border-neutral-300 px-2 py-0.5 text-xs font-medium" data-testid="approval-required">
                            Needs approval
                          </span>
                        )}
                        <span className="font-semibold" data-testid="service-cost">{formatINR(s.estimated_cost)}</span>
                      </div>
                    </div>
                    {s.description && <p className="mt-2 text-sm text-neutral-700">{s.description}</p>}
                    <p className="mt-2 text-sm text-neutral-600">
                      {s.start_date && s.due_date ? `${formatDate(s.start_date)} – ${formatDate(s.due_date)}` : null}
                      {s.depends_on.length > 0 && ` · after ${s.depends_on.map((k) => titles.get(k) ?? k).join(", ")}`}
                    </p>
                    {(s.policy_note || s.approval_reason) && (
                      <p className="mt-1 text-sm text-neutral-600">
                        {s.policy_note}
                        {s.approval_required && s.approval_reason && s.approval_reason !== s.policy_note ? ` ${s.approval_reason}` : ""}
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      )}

      {milestones.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Key dates</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="flex flex-col gap-2 text-sm" data-testid="milestone-list">
              {milestones.map((m) => (
                <li key={m.id} className="flex justify-between gap-4">
                  <span>{m.title}</span>
                  <span className="text-neutral-600">{formatDate(m.due_date)}</span>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
