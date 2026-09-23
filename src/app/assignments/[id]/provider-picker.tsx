"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { formatINR } from "@/lib/format";
import type { ProviderOption } from "@/lib/providers";

import { selectProviderAction } from "./actions";

export function ProviderPicker({
  assignmentId,
  serviceId,
  serviceTitle,
  options,
  selectedVendorId,
}: {
  assignmentId: string;
  serviceId: string;
  serviceTitle: string;
  options: ProviderOption[];
  selectedVendorId: string | null;
}) {
  const [state, action, pending] = useActionState(selectProviderAction, undefined);

  if (options.length === 0) {
    return <p className="text-sm text-neutral-500">No vendor in your network offers this service yet.</p>;
  }

  return (
    <form action={action} className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <input type="hidden" name="assignmentId" value={assignmentId} />
      <input type="hidden" name="serviceId" value={serviceId} />
      <label className="sr-only" htmlFor={`vendor-${serviceId}`}>
        Provider for {serviceTitle}
      </label>
      <select
        id={`vendor-${serviceId}`}
        name="vendorId"
        defaultValue={selectedVendorId ?? ""}
        className="h-9 min-w-0 flex-1 rounded-md border border-neutral-300 bg-white px-2 text-sm"
        required
      >
        <option value="" disabled>
          Choose a provider…
        </option>
        {options.map((o) => (
          <option key={o.vendorId} value={o.vendorId}>
            {o.vendorName} — {formatINR(o.cost)}
            {o.overCap ? " (over policy cap)" : ""} · {o.description}
          </option>
        ))}
      </select>
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {pending ? "Saving…" : selectedVendorId ? "Change provider" : "Choose provider"}
      </Button>
      {state?.error && (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      )}
    </form>
  );
}
