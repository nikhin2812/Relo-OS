"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { createRelocationRequest } from "./actions";

function Field({
  name,
  label,
  error,
  ...props
}: { name: string; label: string; error?: string } & React.ComponentProps<typeof Input>) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} aria-invalid={!!error} aria-describedby={error ? `${name}-error` : undefined} {...props} />
      {error && (
        <p id={`${name}-error`} className="text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

export function RequestForm({ minDate }: { minDate: string }) {
  const [state, action, pending] = useActionState(createRelocationRequest, undefined);
  const v = state?.values ?? {};
  const e = state?.fieldErrors ?? {};

  return (
    <form action={action} className="flex flex-col gap-4">
      <Field name="employeeName" label="Employee name" defaultValue={v.employeeName} error={e.employeeName} required maxLength={200} />
      <Field name="familySize" label="Family size (including the employee)" type="number" min={1} max={20} defaultValue={v.familySize} error={e.familySize} required />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field name="origin" label="Moving from" placeholder="e.g. Bengaluru, India" defaultValue={v.origin} error={e.origin} required maxLength={200} />
        <Field name="destination" label="Moving to" placeholder="e.g. Dubai, UAE" defaultValue={v.destination} error={e.destination} required maxLength={200} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field name="moveDate" label="Move date" type="date" min={minDate} defaultValue={v.moveDate} error={e.moveDate} required />
        <Field name="budget" label="Budget (₹)" type="number" min={1} step={1} defaultValue={v.budget} error={e.budget} required />
      </div>
      {state?.error && (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving and generating the plan… (up to a minute)" : "Create request and generate plan"}
      </Button>
    </form>
  );
}
