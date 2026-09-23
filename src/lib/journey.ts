// MVP item 6: one consolidated journey for the employee — services, key dates
// and to-dos on a single timeline. No money fields exist on any of these types.

export type JourneyService = {
  id: string;
  title: string;
  description: string;
  start_date: string | null;
  due_date: string | null;
  provider_name: string | null;
};

export type JourneyMilestone = { id: string; title: string; due_date: string };

export type JourneyTask = {
  id: string;
  title: string;
  due_date: string;
  status: "todo" | "done";
  service_key: string | null;
};

export type JourneyItem =
  | { kind: "milestone"; id: string; date: string; title: string }
  | { kind: "service"; id: string; date: string; endDate: string | null; title: string; detail: string; provider: string | null }
  | { kind: "task"; id: string; date: string; title: string; done: boolean; overdue: boolean };

// Same-day order: key dates first, then services starting, then to-dos.
const KIND_ORDER = { milestone: 0, service: 1, task: 2 } as const;

export function buildJourney(
  services: JourneyService[],
  milestones: JourneyMilestone[],
  tasks: JourneyTask[],
  today: string,
): JourneyItem[] {
  const items: JourneyItem[] = [
    ...milestones.map((m) => ({ kind: "milestone" as const, id: m.id, date: m.due_date, title: m.title })),
    ...services
      .filter((s) => s.start_date || s.due_date)
      .map((s) => ({
        kind: "service" as const,
        id: s.id,
        date: (s.start_date ?? s.due_date)!,
        endDate: s.start_date ? s.due_date : null,
        title: s.title,
        detail: s.description,
        provider: s.provider_name,
      })),
    ...tasks.map((t) => ({
      kind: "task" as const,
      id: t.id,
      date: t.due_date,
      title: t.title,
      done: t.status === "done",
      overdue: t.status !== "done" && t.due_date < today,
    })),
  ];
  return items.sort(
    (a, b) => a.date.localeCompare(b.date) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.title.localeCompare(b.title),
  );
}

export function taskProgress(tasks: Pick<JourneyTask, "status">[]): { done: number; total: number } {
  return { done: tasks.filter((t) => t.status === "done").length, total: tasks.length };
}
