"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { DOCUMENT_KINDS, DOCUMENT_KIND_LABELS } from "@/lib/documents";

import { uploadDocumentAction } from "./actions";

export function DocumentUpload({ assignmentId, services }: { assignmentId: string; services: { id: string; title: string }[] }) {
  const [state, action, pending] = useActionState(uploadDocumentAction, undefined);
  const selectClass = "h-9 rounded-md border border-neutral-300 bg-white px-2 text-sm";

  return (
    <form action={action} className="flex flex-col gap-3 rounded-md border border-dashed border-neutral-300 p-4">
      <input type="hidden" name="assignmentId" value={assignmentId} />
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm">
          File (PDF, JPG or PNG, up to 4 MB)
          <input name="file" type="file" accept="application/pdf,image/jpeg,image/png" required className="text-sm" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Kind of document
          <select name="kind" required defaultValue="" className={selectClass}>
            <option value="" disabled>
              Choose…
            </option>
            {DOCUMENT_KINDS.map((k) => (
              <option key={k} value={k}>
                {DOCUMENT_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Related service (optional)
          <select name="serviceId" defaultValue="" className={selectClass}>
            <option value="">Whole relocation</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Uploading…" : "Upload document"}
        </Button>
        {state?.error && (
          <p role="alert" className="text-sm text-red-600">
            {state.error}
          </p>
        )}
        {state?.saved && <p className="text-sm text-green-700">Uploaded {state.saved}</p>}
      </div>
    </form>
  );
}
