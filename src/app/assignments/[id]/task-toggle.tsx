"use client";

import { useActionState } from "react";

import { setTaskDoneAction } from "./actions";

export function TaskToggle({ assignmentId, taskId, title, done }: { assignmentId: string; taskId: string; title: string; done: boolean }) {
  const [state, action, pending] = useActionState(setTaskDoneAction, undefined);
  return (
    <form action={action} className="inline">
      <input type="hidden" name="assignmentId" value={assignmentId} />
      <input type="hidden" name="taskId" value={taskId} />
      <input type="hidden" name="done" value={done ? "false" : "true"} />
      <button
        type="submit"
        disabled={pending}
        aria-label={done ? `Mark "${title}" as not done` : `Mark "${title}" as done`}
        className="rounded border border-neutral-300 px-2 py-0.5 text-xs hover:bg-neutral-100 disabled:opacity-50"
      >
        {pending ? "Saving…" : done ? "Undo" : "Mark done"}
      </button>
      {state?.error && <span role="alert" className="ml-2 text-xs text-red-600">{state.error}</span>}
    </form>
  );
}
