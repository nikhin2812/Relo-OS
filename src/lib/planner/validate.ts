import { plannerOutputSchema, type PlannerOutput } from "./schema";

export type ValidationResult = { ok: true; plan: PlannerOutput } | { ok: false; error: string };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const KEY = /^[a-z0-9_]{1,40}$/;
const MAX_COST = 100_000_000; // ₹10 crore — anything larger is nonsense for one service
const DAY_MS = 86_400_000;

function toDay(iso: string): number | null {
  if (!ISO_DATE.test(iso)) return null;
  const [y, m, d] = iso.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d);
  const back = new Date(t);
  // Rejects impossible dates such as 2026-02-30.
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) return null;
  return t;
}

// Checks everything the planner returned before any of it is saved.
// `raw` is the model's text; it must be JSON matching plannerOutputSchema.
export function validatePlan(raw: string, request: { moveDate: string }): ValidationResult {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, error: "The planner did not return valid JSON" };
  }

  const parsed = plannerOutputSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: `Plan is missing or has a wrong field: ${issue.path.join(".") || "(root)"}` };
  }
  const plan = parsed.data;

  if (plan.summary.trim().length === 0 || plan.summary.length > 2000) {
    return { ok: false, error: "Plan summary is empty or too long" };
  }
  if (plan.services.length < 1 || plan.services.length > 20) {
    return { ok: false, error: "Plan must contain between 1 and 20 services" };
  }
  if (plan.milestones.length > 30) {
    return { ok: false, error: "Plan has too many milestones" };
  }

  const moveDay = toDay(request.moveDate);
  if (moveDay === null) return { ok: false, error: "Request move date is invalid" };
  const earliest = moveDay - 365 * DAY_MS;
  const latest = moveDay + 365 * DAY_MS;

  const keys = new Set<string>();
  for (const s of plan.services) {
    if (!KEY.test(s.key)) return { ok: false, error: `Service key "${s.key}" is not allowed` };
    if (keys.has(s.key)) return { ok: false, error: `Service key "${s.key}" appears twice` };
    keys.add(s.key);

    if (s.title.trim().length === 0 || s.title.length > 200) return { ok: false, error: `Service "${s.key}" has a bad title` };
    if (s.description.length > 2000) return { ok: false, error: `Service "${s.key}" description is too long` };
    if (s.policy_note.length > 1000 || s.approval_reason.length > 1000) {
      return { ok: false, error: `Service "${s.key}" notes are too long` };
    }
    if (!Number.isFinite(s.estimated_cost) || s.estimated_cost < 0 || s.estimated_cost > MAX_COST) {
      return { ok: false, error: `Service "${s.key}" has an impossible cost` };
    }
    if (s.sequence < 1 || s.sequence > 50) return { ok: false, error: `Service "${s.key}" has a bad sequence number` };

    const start = toDay(s.start_date);
    const due = toDay(s.due_date);
    if (start === null || due === null) return { ok: false, error: `Service "${s.key}" has an invalid date` };
    if (start > due) return { ok: false, error: `Service "${s.key}" ends before it starts` };
    if (start < earliest || due > latest) return { ok: false, error: `Service "${s.key}" dates are too far from the move date` };
  }

  const byKey = new Map(plan.services.map((s) => [s.key, s]));
  for (const s of plan.services) {
    for (const dep of s.depends_on) {
      const target = byKey.get(dep);
      if (!target) return { ok: false, error: `Service "${s.key}" depends on unknown service "${dep}"` };
      if (dep === s.key) return { ok: false, error: `Service "${s.key}" depends on itself` };
      if (target.sequence >= s.sequence) {
        return { ok: false, error: `Service "${s.key}" must come after "${dep}", which it depends on` };
      }
    }
  }

  for (const m of plan.milestones) {
    if (m.title.trim().length === 0 || m.title.length > 200) return { ok: false, error: "A milestone has a bad title" };
    const due = toDay(m.due_date);
    if (due === null) return { ok: false, error: `Milestone "${m.title}" has an invalid date` };
    if (due < earliest || due > latest) return { ok: false, error: `Milestone "${m.title}" is too far from the move date` };
    if (m.sequence < 1 || m.sequence > 50) return { ok: false, error: `Milestone "${m.title}" has a bad sequence number` };
    for (const k of m.related_service_keys) {
      if (!keys.has(k)) return { ok: false, error: `Milestone "${m.title}" refers to unknown service "${k}"` };
    }
  }

  return {
    ok: true,
    plan: {
      summary: plan.summary.trim(),
      services: [...plan.services].sort((a, b) => a.sequence - b.sequence),
      milestones: [...plan.milestones].sort((a, b) => a.sequence - b.sequence),
    },
  };
}
