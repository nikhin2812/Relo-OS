import Link from "next/link";
import { notFound } from "next/navigation";

import { PolicyBadge } from "@/components/policy-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { formatDate, formatINR } from "@/lib/format";
import { planTotals, policyCap } from "@/lib/planner/policy";
import type { PolicyConfig } from "@/lib/planner/schema";
import { providerOptions, type Vendor, type VendorRate } from "@/lib/providers";
import { canSeeBudgets } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";

import { DOCUMENT_KIND_LABELS, type DocumentKind } from "@/lib/documents";
import { buildJourney, taskProgress, type JourneyService, type JourneyTask } from "@/lib/journey";

import { DocumentUpload } from "./document-upload";
import { GeneratePlanButton } from "./generate-button";
import { TaskToggle } from "./task-toggle";
import { ApproveButton, WorkOrderPanel } from "./work-order-controls";
import { DecideInvoiceForm, RecordInvoiceForm } from "./invoice-forms";
import { INVOICE_STATUS_LABELS, flagMessages, moneyTrail, varianceLabel, type InvoiceMatch } from "@/lib/reconciliation";
import { EMPLOYEE_STATUS_LABELS, STAFF_STATUS_LABELS, isLiveWorkOrder, type WorkOrderStatus } from "@/lib/work-orders";
import { ProviderPicker } from "./provider-picker";

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
  selected_vendor_id: string | null;
  agreed_cost: number | null;
  agreed_over_cap: boolean;
  approved_at: string | null;
};

type InvoiceRow = InvoiceMatch & {
  id: string;
  service_id: string;
  invoice_date: string;
  source: "portal" | "staff";
  decision_note: string | null;
};

type WorkOrderRow = {
  id: string;
  reference: string;
  service_id: string;
  status: WorkOrderStatus;
  booking_reference: string | null;
  booked_for: string | null;
  vendor_note: string | null;
  sent_at: string;
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
  const picksProviders = user.role === "rmc_admin" || user.role === "consultant";
  const [budgetRes, planRes, servicesRes, milestonesRes, vendorsRes, ratesRes, policyRes, journeyRes, tasksRes, docsRes, workOrdersRes, invoicesRes] = await Promise.all([
    costed ? supabase.from("assignment_budgets").select("amount").eq("assignment_id", id).maybeSingle() : null,
    costed ? supabase.from("relocation_plans").select("status, summary, error_message, model").eq("assignment_id", id).maybeSingle() : null,
    costed
      ? supabase.from("plan_services").select("*").eq("assignment_id", id).order("sequence").order("start_date").returns<ServiceRow[]>()
      : null,
    supabase.from("plan_milestones").select("id, title, due_date, sequence").eq("assignment_id", id).order("sequence"),
    // RLS: RMC staff see the whole network; HR sees only vendors chosen for its company.
    costed ? supabase.from("vendors").select("id, name, city").returns<Vendor[]>() : null,
    picksProviders ? supabase.from("vendor_rates").select("vendor_id, category, rate, rate_basis, description").returns<VendorRate[]>() : null,
    picksProviders ? supabase.from("rmc_policies").select("config").maybeSingle() : null,
    // The journey: services without money, to-dos and documents (everyone who can see the relocation except vendors)
    supabase.rpc("journey_services", { p_assignment_id: id }),
    supabase.from("journey_tasks").select("id, title, due_date, status, service_key").eq("assignment_id", id).order("due_date").returns<JourneyTask[]>(),
    supabase.from("documents").select("id, kind, file_name, created_at, service_id, source").eq("assignment_id", id).order("created_at", { ascending: false }),
    costed
      ? supabase
          .from("work_orders")
          .select("id, reference, service_id, status, booking_reference, booked_for, vendor_note, sent_at")
          .eq("assignment_id", id)
          .order("sent_at", { ascending: false })
          .returns<WorkOrderRow[]>()
      : null,
    costed
      ? supabase
          .from("invoices")
          .select("id, service_id, invoice_number, invoice_date, amount, agreed_amount, invoiced_to_date, variance_amount, variance_pct, tolerance_pct, budget_remaining_after, flags, status, source, decision_note")
          .eq("assignment_id", id)
          .order("created_at")
          .returns<InvoiceRow[]>()
      : null,
  ]);

  const budget = budgetRes?.data ? Number(budgetRes.data.amount) : null;
  const plan = planRes?.data ?? null;
  const services = servicesRes?.data ?? [];
  const milestones = milestonesRes.data ?? [];
  const titles = new Map(services.map((s) => [s.service_key, s.title]));
  // The latest work order per service (a declined one can be followed by a new one).
  const latestWorkOrder = new Map<string, WorkOrderRow>();
  for (const wo of workOrdersRes?.data ?? []) if (!latestWorkOrder.has(wo.service_id)) latestWorkOrder.set(wo.service_id, wo);
  const invoicesByService = new Map<string, InvoiceRow[]>();
  for (const inv of invoicesRes?.data ?? []) invoicesByService.set(inv.service_id, [...(invoicesByService.get(inv.service_id) ?? []), inv]);
  const invoicedFor = (serviceId: string) =>
    (invoicesByService.get(serviceId) ?? []).filter((i) => i.status !== "disputed").reduce((n, i) => n + Number(i.amount), 0);
  const totals =
    budget !== null && services.length > 0
      ? planTotals(
          services.map((s) => ({
            ...s,
            work_order_status: latestWorkOrder.get(s.id)?.status ?? null,
            invoiced_amount: invoicedFor(s.id) || null,
            flagged_invoices: (invoicesByService.get(s.id) ?? []).filter((i) => i.status === "flagged").length,
          })),
          budget,
        )
      : null;
  const company = assignment.client_companies as unknown as { name: string } | null;
  const vendors = vendorsRes?.data ?? [];
  const vendorNames = new Map(vendors.map((v) => [v.id, v.name]));
  const rates = ratesRes?.data ?? [];
  const policy = (policyRes?.data?.config ?? {}) as PolicyConfig;
  const journeyServices = (journeyRes.data ?? []) as JourneyService[];
  const tasks = tasksRes.data ?? [];
  const documents = docsRes.data ?? [];
  const today = new Date().toISOString().slice(0, 10);
  const journey = buildJourney(journeyServices, milestones, tasks, today);
  const progress = taskProgress(tasks);
  const serviceTitles = new Map(journeyServices.map((s) => [s.id, s.title]));

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
              <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3 lg:grid-cols-5" data-testid="plan-totals">
                <div>
                  <dt className="text-neutral-500">Budget</dt>
                  <dd className="text-lg font-semibold" data-testid="budget">{formatINR(totals.budget)}</dd>
                </div>
                <div>
                  <dt className="text-neutral-500">Estimated total</dt>
                  <dd className="text-lg font-semibold" data-testid="estimated-total">{formatINR(totals.total)}</dd>
                </div>
                <div>
                  <dt className="text-neutral-500">Agreed with providers</dt>
                  <dd className="text-lg font-semibold" data-testid="agreed">{formatINR(totals.agreed)}</dd>
                </div>
                <div>
                  <dt className="text-neutral-500">Committed (work orders)</dt>
                  <dd className="text-lg font-semibold" data-testid="committed">{formatINR(totals.committed)}</dd>
                </div>
                <div>
                  <dt className="text-neutral-500">{totals.overBudget ? "Forecast over budget by" : "Forecast remaining"}</dt>
                  <dd className={totals.overBudget ? "text-lg font-semibold text-red-700" : "text-lg font-semibold"} data-testid="remaining">
                    {formatINR(Math.abs(totals.remaining))}
                  </dd>
                </div>
                <div>
                  <dt className="text-neutral-500">Approvals needed</dt>
                  <dd className="text-lg font-semibold" data-testid="approvals-needed">{totals.approvalsNeeded}</dd>
                </div>
                <div>
                  <dt className="text-neutral-500">Invoiced</dt>
                  <dd className="text-lg font-semibold" data-testid="invoiced">{formatINR(totals.invoiced)}</dd>
                </div>
                <div>
                  <dt className="text-neutral-500">Difference vs agreed</dt>
                  <dd className={`text-lg font-semibold ${totals.variance > 0 ? "text-red-700" : ""}`} data-testid="variance">
                    {varianceLabel(totals.variance, totals.agreed > 0 ? (totals.variance * 100) / totals.agreed : 0)}
                  </dd>
                </div>
                <div>
                  <dt className="text-neutral-500">Invoices to review</dt>
                  <dd className="text-lg font-semibold" data-testid="invoices-to-review">{totals.flaggedInvoices}</dd>
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
                        {(s.approval_required || s.agreed_over_cap) && !s.approved_at && (
                          <span className="inline-flex rounded-full border border-neutral-300 px-2 py-0.5 text-xs font-medium" data-testid="approval-required">
                            Needs approval
                          </span>
                        )}
                        {(s.approval_required || s.agreed_over_cap) && s.approved_at && (
                          <span className="inline-flex rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-xs font-medium text-green-800" data-testid="approved">
                            Approved
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
                    {(() => {
                      const wo = latestWorkOrder.get(s.id) ?? null;
                      const invoices = invoicesByService.get(s.id) ?? [];
                      const trail = moneyTrail({
                        estimate: Number(s.estimated_cost),
                        agreed: s.agreed_cost === null ? null : Number(s.agreed_cost),
                        provider: s.selected_vendor_id ? (vendorNames.get(s.selected_vendor_id) ?? null) : null,
                        workOrder: wo,
                        invoices,
                      });
                      return (
                        <div className="mt-3 flex flex-col gap-2">
                          <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs" data-testid="money-trail" aria-label={`Money trail for ${s.title}`}>
                            {trail.map((step, i) => (
                              <li key={step.label} className="flex items-center gap-2">
                                {i > 0 && <span aria-hidden className="text-neutral-400">→</span>}
                                <span
                                  className={
                                    step.tone === "warn"
                                      ? "font-semibold text-red-700"
                                      : step.tone === "ok"
                                        ? "font-semibold text-green-800"
                                        : step.tone === "muted"
                                          ? "text-neutral-500"
                                          : ""
                                  }
                                  data-testid={`trail-${step.label.toLowerCase().replace(" ", "-")}`}
                                >
                                  {step.label}: {step.value}
                                </span>
                              </li>
                            ))}
                          </ol>
                          {invoices.map((inv) => (
                            <div key={inv.id} className="rounded-md bg-neutral-50 p-2 text-sm" data-testid="invoice">
                              <p>
                                <span className="font-medium">Invoice {inv.invoice_number}</span> · {formatINR(Number(inv.amount))} ·{" "}
                                {formatDate(inv.invoice_date)} · {inv.source === "portal" ? "from provider" : "recorded by staff"} ·{" "}
                                <span
                                  className={inv.status === "flagged" || inv.status === "disputed" ? "font-semibold text-red-700" : "font-semibold text-green-800"}
                                  data-testid="invoice-status"
                                >
                                  {INVOICE_STATUS_LABELS[inv.status]}
                                </span>
                              </p>
                              {flagMessages(inv).map((m) => (
                                <p key={m} className="text-red-700" data-testid="invoice-flag">
                                  ⚠ {m}
                                </p>
                              ))}
                              {inv.decision_note && <p className="text-neutral-600">Decision note: {inv.decision_note}</p>}
                              {user.role === "rmc_admin" && inv.status === "flagged" && (
                                <DecideInvoiceForm assignmentId={assignment.id} invoiceId={inv.id} invoiceNumber={inv.invoice_number} />
                              )}
                            </div>
                          ))}
                          {picksProviders && wo && (wo.status === "booked" || wo.status === "completed") && (
                            <RecordInvoiceForm assignmentId={assignment.id} workOrderId={wo.id} reference={wo.reference} />
                          )}
                        </div>
                      );
                    })()}
                    <div className="mt-3 flex flex-col gap-2 border-t border-neutral-100 pt-3" data-testid="provider">
                      {s.selected_vendor_id && s.agreed_cost !== null && (
                        <p className="text-sm" data-testid="selected-provider">
                          Provider: <span className="font-medium">{vendorNames.get(s.selected_vendor_id) ?? "Chosen vendor"}</span> · agreed{" "}
                          <span className="font-medium" data-testid="agreed-cost">{formatINR(s.agreed_cost)}</span>
                          {s.agreed_over_cap && (
                            <span className="text-red-700" data-testid="agreed-over-cap">
                              {" "}· agreed rate is above the policy cap, needs approval
                            </span>
                          )}
                        </p>
                      )}
                      {!s.selected_vendor_id && !picksProviders && (
                        <p className="text-sm text-neutral-500">Provider not chosen yet.</p>
                      )}
                      {(() => {
                        const wo = latestWorkOrder.get(s.id);
                        const live = wo && isLiveWorkOrder(wo.status);
                        const needsApproval = (s.approval_required || s.agreed_over_cap) && !s.approved_at;
                        return (
                          <div className="flex flex-col gap-2" data-testid="work-order">
                            {wo && (
                              <p className="text-sm" data-testid="work-order-status">
                                <span className="font-medium">{wo.reference}</span> · {STAFF_STATUS_LABELS[wo.status]}
                                {wo.booking_reference ? ` · booking ref ${wo.booking_reference}` : ""}
                                {wo.booked_for ? ` for ${formatDate(wo.booked_for)}` : ""}
                                {wo.vendor_note ? ` · “${wo.vendor_note}”` : ""}
                              </p>
                            )}
                            {picksProviders && s.selected_vendor_id && needsApproval && (
                              user.role === "rmc_admin" ? (
                                <ApproveButton assignmentId={assignment.id} serviceId={s.id} title={s.title} />
                              ) : (
                                <p className="text-sm text-amber-700">Waiting for RMC admin approval before the work order can go out.</p>
                              )
                            )}
                            {picksProviders && (
                              <WorkOrderPanel
                                assignmentId={assignment.id}
                                serviceId={s.id}
                                title={s.title}
                                canSend={!!s.selected_vendor_id && !needsApproval && !live}
                                workOrderId={wo?.id ?? null}
                                reference={wo?.reference ?? null}
                                canRenew={!!wo && !!live && wo.status !== "completed"}
                              />
                            )}
                          </div>
                        );
                      })()}
                      {picksProviders && !isLiveWorkOrder(latestWorkOrder.get(s.id)?.status) && (
                        <ProviderPicker
                          assignmentId={assignment.id}
                          serviceId={s.id}
                          serviceTitle={s.title}
                          selectedVendorId={s.selected_vendor_id}
                          options={providerOptions(s.category, rates, vendors, assignment.family_size, policyCap(s, policy, assignment.family_size))}
                        />
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{user.role === "employee" ? "Your journey" : "Employee journey"}</CardTitle>
          <CardDescription>
            {journey.length === 0
              ? "The journey appears here once the relocation plan is ready."
              : `Every step, key date and to-do in one place. To-dos done: ${progress.done} of ${progress.total}.`}
          </CardDescription>
        </CardHeader>
        {journey.length > 0 && (
          <CardContent>
            <ol className="flex flex-col divide-y divide-neutral-100" data-testid="journey">
              {journey.map((item) => (
                <li key={`${item.kind}-${item.id}`} className="flex flex-wrap items-start gap-x-4 gap-y-1 py-3" data-testid={`journey-${item.kind}`}>
                  <span className="w-28 shrink-0 text-sm text-neutral-500">{formatDate(item.date)}</span>
                  <div className="min-w-0 flex-1">
                    {item.kind === "milestone" && <p className="font-semibold">★ {item.title}</p>}
                    {item.kind === "service" && (
                      <>
                        <p className="font-medium">{item.title}</p>
                        <p className="text-sm text-neutral-600">
                          {item.endDate ? `Until ${formatDate(item.endDate)}` : null}
                          {item.provider ? `${item.endDate ? " · " : ""}With ${item.provider}` : null}
                        </p>
                        <p className="text-sm" data-testid="journey-service-status">
                          {EMPLOYEE_STATUS_LABELS[item.workStatus] ?? "Being arranged"}
                          {item.bookingReference ? ` · ref ${item.bookingReference}` : ""}
                          {item.bookedFor ? ` · ${formatDate(item.bookedFor)}` : ""}
                        </p>
                      </>
                    )}
                    {item.kind === "task" && (
                      <p className={item.done ? "text-neutral-500 line-through" : ""}>
                        To-do: {item.title}
                        {item.overdue && <span className="ml-2 text-xs font-medium text-red-700">Overdue</span>}
                      </p>
                    )}
                  </div>
                  {item.kind === "task" && (
                    <TaskToggle assignmentId={assignment.id} taskId={item.id} title={item.title} done={item.done} />
                  )}
                </li>
              ))}
            </ol>
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Documents</CardTitle>
          <CardDescription>Bookings, visas and other paperwork for this relocation, kept in one place.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {documents.length === 0 ? (
            <p className="text-sm text-neutral-600">No documents yet.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-neutral-100" data-testid="document-list">
              {documents.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm" data-testid="document-row">
                  <div>
                    <a href={`/documents/${d.id}`} className="font-medium hover:underline">
                      {d.file_name}
                    </a>
                    <p className="text-neutral-500">
                      {DOCUMENT_KIND_LABELS[d.kind as DocumentKind] ?? d.kind}
                      {d.service_id && serviceTitles.get(d.service_id) ? ` · ${serviceTitles.get(d.service_id)}` : ""}
                      {` · added ${formatDate(d.created_at.slice(0, 10))}`}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <DocumentUpload assignmentId={assignment.id} services={journeyServices.map((s) => ({ id: s.id, title: s.title }))} />
        </CardContent>
      </Card>
    </main>
  );
}
