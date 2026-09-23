"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";

import { approveServiceAction, renewWorkOrderLinkAction, sendWorkOrderAction, type WorkOrderState } from "./actions";

function LinkNotice({ state }: { state: WorkOrderState }) {
  if (!state?.link) return null;
  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm" data-testid="portal-link-notice">
      <p className="font-medium">
        {state.reference ? `Work order ${state.reference} sent. ` : "New link created. "}
        {state.emailed
          ? "The provider has been emailed this secure link."
          : "Email isn't set up for this provider, so share this secure link with them. It is shown only once."}
      </p>
      <input
        readOnly
        value={state.link}
        aria-label="Secure provider link"
        className="mt-2 w-full rounded border border-amber-300 bg-white px-2 py-1 font-mono text-xs"
        onFocus={(e) => e.currentTarget.select()}
        data-testid="portal-link"
      />
    </div>
  );
}

function ErrorText({ state }: { state: WorkOrderState }) {
  return state?.error ? (
    <p role="alert" className="text-sm text-red-600">
      {state.error}
    </p>
  ) : null;
}

export function ApproveButton({ assignmentId, serviceId, title }: { assignmentId: string; serviceId: string; title: string }) {
  const [state, action, pending] = useActionState(approveServiceAction, undefined);
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="assignmentId" value={assignmentId} />
      <input type="hidden" name="serviceId" value={serviceId} />
      <Button type="submit" size="sm" disabled={pending} aria-label={`Approve ${title}`}>
        {pending ? "Approving…" : "Approve"}
      </Button>
      <ErrorText state={state} />
    </form>
  );
}

// One panel per service, always mounted, so the one-time link survives the page
// refreshing to show the new work order status.
export function WorkOrderPanel({
  assignmentId,
  serviceId,
  title,
  canSend,
  workOrderId,
  reference,
  canRenew,
}: {
  assignmentId: string;
  serviceId: string;
  title: string;
  canSend: boolean;
  workOrderId: string | null;
  reference: string | null;
  canRenew: boolean;
}) {
  const [sendState, sendAction, sending] = useActionState(sendWorkOrderAction, undefined);
  const [renewState, renewAction, renewing] = useActionState(renewWorkOrderLinkAction, undefined);
  const notice = renewState?.link ? renewState : sendState;

  return (
    <div className="flex flex-col gap-2">
      {canSend && (
        <form action={sendAction} className="flex items-center gap-2">
          <input type="hidden" name="assignmentId" value={assignmentId} />
          <input type="hidden" name="serviceId" value={serviceId} />
          <Button type="submit" size="sm" disabled={sending} aria-label={`Send work order for ${title}`}>
            {sending ? "Sending…" : "Send work order"}
          </Button>
          <ErrorText state={sendState} />
        </form>
      )}
      {canRenew && workOrderId && reference && (
        <form action={renewAction}>
          <input type="hidden" name="assignmentId" value={assignmentId} />
          <input type="hidden" name="workOrderId" value={workOrderId} />
          <Button type="submit" size="sm" variant="ghost" disabled={renewing} aria-label={`New provider link for ${reference}`}>
            {renewing ? "Creating…" : "New provider link"}
          </Button>
          <ErrorText state={renewState} />
        </form>
      )}
      <LinkNotice state={notice} />
    </div>
  );
}
