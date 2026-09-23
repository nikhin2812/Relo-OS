"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { decideInvoiceAction, recordInvoiceAction } from "./actions";

export function RecordInvoiceForm({ assignmentId, workOrderId, reference }: { assignmentId: string; workOrderId: string; reference: string }) {
  const [state, action, pending] = useActionState(recordInvoiceAction, undefined);
  const id = (f: string) => `${f}-${workOrderId}`;
  return (
    <details className="rounded-md border border-neutral-200 p-3 text-sm">
      <summary className="cursor-pointer font-medium">Record an invoice received for {reference}</summary>
      <form action={action} className="mt-3 grid gap-3 sm:grid-cols-4 sm:items-end">
        <input type="hidden" name="assignmentId" value={assignmentId} />
        <input type="hidden" name="workOrderId" value={workOrderId} />
        <div className="flex flex-col gap-1">
          <Label htmlFor={id("invoiceNumber")}>Invoice number</Label>
          <Input id={id("invoiceNumber")} name="invoiceNumber" maxLength={60} required />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={id("invoiceDate")}>Invoice date</Label>
          <Input id={id("invoiceDate")} name="invoiceDate" type="date" required />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={id("amount")}>Amount (₹)</Label>
          <Input id={id("amount")} name="amount" type="number" min={1} step="0.01" required />
        </div>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Checking…" : "Record and check invoice"}
        </Button>
      </form>
      {state?.error && (
        <p role="alert" className="mt-2 text-red-600">
          {state.error}
        </p>
      )}
    </details>
  );
}

export function DecideInvoiceForm({ assignmentId, invoiceId, invoiceNumber }: { assignmentId: string; invoiceId: string; invoiceNumber: string }) {
  const [state, action, pending] = useActionState(decideInvoiceAction, undefined);
  return (
    <form action={action} className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
      <input type="hidden" name="assignmentId" value={assignmentId} />
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <label className="sr-only" htmlFor={`note-${invoiceId}`}>
        Decision note for {invoiceNumber}
      </label>
      <Input id={`note-${invoiceId}`} name="note" placeholder="Why? (required)" maxLength={1000} className="sm:max-w-xs" />
      <div className="flex gap-2">
        <Button type="submit" name="decision" value="approve" size="sm" disabled={pending} aria-label={`Approve invoice ${invoiceNumber}`}>
          Approve anyway
        </Button>
        <Button type="submit" name="decision" value="dispute" size="sm" variant="outline" disabled={pending} aria-label={`Dispute invoice ${invoiceNumber}`}>
          Dispute
        </Button>
      </div>
      {state?.error && (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      )}
    </form>
  );
}
