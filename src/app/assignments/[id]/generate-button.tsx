"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";

import { generatePlanAction } from "./actions";

export function GeneratePlanButton({ assignmentId, label }: { assignmentId: string; label: string }) {
  const [state, action, pending] = useActionState(generatePlanAction, undefined);
  return (
    <form action={action} className="flex flex-col items-start gap-2">
      <input type="hidden" name="assignmentId" value={assignmentId} />
      <Button type="submit" disabled={pending}>
        {pending ? "Generating plan… (up to a minute)" : label}
      </Button>
      {state?.error && (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      )}
    </form>
  );
}
