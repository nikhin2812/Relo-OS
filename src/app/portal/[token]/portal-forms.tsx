"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { PortalAction } from "@/lib/work-orders";

import { portalInvoiceAction, portalUpdateAction, portalUploadAction } from "./actions";

const LABELS: Record<PortalAction, string> = {
  accept: "Accept work order",
  book: "Mark as booked",
  decline: "Decline",
  complete: "Mark as completed",
};

export function PortalUpdateForm({ token, actions }: { token: string; actions: PortalAction[] }) {
  const [state, action, pending] = useActionState(portalUpdateAction, undefined);
  if (actions.length === 0) return null;
  const canBook = actions.includes("book");

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="token" value={token} />
      {canBook && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="bookingReference">Booking reference</Label>
            <Input id="bookingReference" name="bookingReference" maxLength={100} placeholder="Needed to mark as booked" />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="bookedFor">Booked date</Label>
            <Input id="bookedFor" name="bookedFor" type="date" />
          </div>
        </div>
      )}
      <div className="flex flex-col gap-2">
        <Label htmlFor="note">Note to the relocation team (optional)</Label>
        <Input id="note" name="note" maxLength={1000} />
      </div>
      <div className="flex flex-wrap gap-2">
        {actions.map((a) => (
          <Button key={a} type="submit" name="action" value={a} variant={a === "decline" ? "outline" : "default"} disabled={pending}>
            {LABELS[a]}
          </Button>
        ))}
      </div>
      {state?.error && (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      )}
    </form>
  );
}

export function PortalUploadForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(portalUploadAction, undefined);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="token" value={token} />
      <label className="flex flex-col gap-1 text-sm">
        Booking confirmation or other document (PDF, JPG or PNG, up to 4 MB)
        <input name="file" type="file" accept="application/pdf,image/jpeg,image/png" required className="text-sm" />
      </label>
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Uploading…" : "Upload document"}
        </Button>
        {state?.error && (
          <p role="alert" className="text-sm text-red-600">
            {state.error}
          </p>
        )}
        {state?.done && <p className="text-sm text-green-700">Uploaded {state.done}</p>}
      </div>
    </form>
  );
}

export function PortalInvoiceForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(portalInvoiceAction, undefined);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="token" value={token} />
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="invoiceNumber">Invoice number</Label>
          <Input id="invoiceNumber" name="invoiceNumber" maxLength={60} required />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="invoiceDate">Invoice date</Label>
          <Input id="invoiceDate" name="invoiceDate" type="date" required />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="amount">Amount (₹)</Label>
          <Input id="amount" name="amount" type="number" min={1} step="0.01" required />
        </div>
      </div>
      <label className="flex flex-col gap-1 text-sm">
        Invoice file (PDF, JPG or PNG, up to 4 MB)
        <input name="file" type="file" accept="application/pdf,image/jpeg,image/png" required className="text-sm" />
      </label>
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Sending…" : "Send invoice"}
        </Button>
        {state?.error && (
          <p role="alert" className="text-sm text-red-600">
            {state.error}
          </p>
        )}
        {state?.done && <p className="text-sm text-green-700" data-testid="invoice-sent">{state.done}</p>}
      </div>
    </form>
  );
}
