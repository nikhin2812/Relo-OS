import type { Metadata } from "next";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate, formatINR } from "@/lib/format";
import { createAnonClient } from "@/lib/supabase/anon";
import { STAFF_STATUS_LABELS, allowedPortalActions, type WorkOrderStatus } from "@/lib/work-orders";

import { PortalInvoiceForm, PortalUpdateForm, PortalUploadForm } from "./portal-forms";
import { INVOICE_STATUS_LABELS, type InvoiceStatus } from "@/lib/reconciliation";

// The link is a secret: keep it out of Referer headers and search engines.
export const metadata: Metadata = {
  title: "Work order · Relo OS",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

type PortalWorkOrder = {
  reference: string;
  vendor_name: string;
  rmc_name: string;
  status: WorkOrderStatus;
  details: {
    service_title: string;
    description: string;
    start_date: string | null;
    due_date: string | null;
    employee_name: string;
    family_size: number;
    origin: string;
    destination: string;
    move_date: string;
  };
  agreed_cost: number;
  booking_reference: string | null;
  booked_for: string | null;
  vendor_note: string | null;
  expires_at: string;
  documents: { file_name: string; created_at: string }[];
  invoices: { invoice_number: string; amount: number; invoice_date: string; status: InvoiceStatus }[];
};

export default async function PortalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = createAnonClient();
  const { data, error } = await supabase.rpc("portal_get_work_order", { p_token: decodeURIComponent(token) });

  if (error || !data) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-xl items-center p-4">
        <Card className="w-full">
          <CardHeader>
            <CardTitle>This link is not valid or has expired</CardTitle>
            <CardDescription>Please ask the relocation team to send you a new work order link.</CardDescription>
          </CardHeader>
        </Card>
      </main>
    );
  }

  const wo = data as PortalWorkOrder;
  const d = wo.details;
  const actions = allowedPortalActions(wo.status);
  const open = wo.status === "sent" || wo.status === "accepted" || wo.status === "booked";

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 sm:p-8">
      <header>
        <p className="text-sm text-neutral-500">
          {wo.rmc_name} · work order for {wo.vendor_name}
        </p>
        <h1 className="text-2xl font-semibold">
          {wo.reference}: {d.service_title}
        </h1>
        <p className="text-neutral-600" data-testid="portal-status">
          Status: {STAFF_STATUS_LABELS[wo.status]}
          {wo.booking_reference ? ` · booking ref ${wo.booking_reference}` : ""}
          {wo.booked_for ? ` for ${formatDate(wo.booked_for)}` : ""}
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>The job</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-neutral-500">Route</dt>
              <dd>
                {d.origin} → {d.destination}
              </dd>
            </div>
            <div>
              <dt className="text-neutral-500">Traveller</dt>
              <dd>
                {d.employee_name}, family of {d.family_size}
              </dd>
            </div>
            <div>
              <dt className="text-neutral-500">Move date</dt>
              <dd>{formatDate(d.move_date)}</dd>
            </div>
            <div>
              <dt className="text-neutral-500">Service window</dt>
              <dd>{d.start_date && d.due_date ? `${formatDate(d.start_date)} – ${formatDate(d.due_date)}` : "To be agreed"}</dd>
            </div>
            <div>
              <dt className="text-neutral-500">Agreed price</dt>
              <dd className="font-semibold" data-testid="portal-price">{formatINR(wo.agreed_cost)}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-neutral-500">Details</dt>
              <dd>{d.description}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      {actions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Update this work order</CardTitle>
          </CardHeader>
          <CardContent>
            <PortalUpdateForm token={decodeURIComponent(token)} actions={actions} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Documents</CardTitle>
          <CardDescription>Only the relocation team can see these.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {wo.documents.length === 0 ? (
            <p className="text-sm text-neutral-600">No documents uploaded yet.</p>
          ) : (
            <ul className="text-sm" data-testid="portal-documents">
              {wo.documents.map((doc, i) => (
                <li key={i}>
                  {doc.file_name} · {formatDate(doc.created_at.slice(0, 10))}
                </li>
              ))}
            </ul>
          )}
          {open && <PortalUploadForm token={decodeURIComponent(token)} />}
        </CardContent>
      </Card>

      {(wo.status === "booked" || wo.status === "completed" || wo.invoices.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle>Invoices</CardTitle>
            <CardDescription>
              Invoices are checked against the agreed price of {formatINR(wo.agreed_cost)} as soon as they arrive.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {wo.invoices.length > 0 && (
              <ul className="text-sm" data-testid="portal-invoices">
                {wo.invoices.map((inv) => (
                  <li key={inv.invoice_number + inv.invoice_date}>
                    {inv.invoice_number} · {formatINR(inv.amount)} · {formatDate(inv.invoice_date)} ·{" "}
                    {inv.status === "matched" || inv.status === "approved" ? INVOICE_STATUS_LABELS[inv.status] : "Under review"}
                  </li>
                ))}
              </ul>
            )}
            {(wo.status === "booked" || wo.status === "completed") && <PortalInvoiceForm token={decodeURIComponent(token)} />}
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-neutral-500">
        This link is personal to this work order and works until {formatDate(wo.expires_at.slice(0, 10))}. Please don&apos;t forward it.
      </p>
    </main>
  );
}
