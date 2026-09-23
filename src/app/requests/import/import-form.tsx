"use client";

import Link from "next/link";
import { useActionState } from "react";

import { Button } from "@/components/ui/button";

import { importRequestsAction } from "./actions";

export function ImportForm() {
  const [state, action, pending] = useActionState(importRequestsAction, undefined);
  const created = state?.results?.filter((r) => r.ok).length ?? 0;
  const failed = state?.results?.filter((r) => !r.ok).length ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <form action={action} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          CSV file
          <input name="file" type="file" accept=".csv,text/csv" required className="text-sm" />
        </label>
        <Button type="submit" disabled={pending} className="self-start">
          {pending ? "Importing…" : "Import relocations"}
        </Button>
      </form>
      {state?.error && (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      )}
      {state?.results && (
        <div className="flex flex-col gap-2" data-testid="import-results">
          <p className="font-medium" data-testid="import-summary">
            {created} created, {failed} with problems.
          </p>
          <ul className="flex flex-col gap-1 text-sm">
            {state.results.map((r) => (
              <li key={r.line} className={r.ok ? "text-green-800" : "text-red-700"} data-testid="import-row">
                Line {r.line} · {r.employee || "(no name)"}: {r.ok && r.id ? <Link href={`/assignments/${r.id}`} className="underline">{r.message}</Link> : r.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
