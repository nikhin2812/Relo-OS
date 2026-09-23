import type { PlannerOutput, PlanningRequest } from "./schema";

// A stand-in for Claude used by automated tests (PLANNER_MODE=mock), so the
// end-to-end tests are free and give the same result every run.
// A name containing this fails on the first attempt and succeeds on retry.
export const SIMULATE_FAILURE_MARKER = "[simulate-ai-failure]";
const failedOnce = new Set<string>();

export function shouldSimulateFailure(employeeName: string): boolean {
  if (!employeeName.includes(SIMULATE_FAILURE_MARKER) || failedOnce.has(employeeName)) return false;
  failedOnce.add(employeeName);
  return true;
}

function shift(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function mockPlan(request: PlanningRequest): PlannerOutput {
  const move = request.moveDate;
  const people = request.familySize;
  const services: PlannerOutput["services"] = [
    {
      key: "immigration", category: "immigration", title: "Work and family visas",
      description: `Employment visa for ${request.employeeName} and dependant visas for the family.`,
      sequence: 1, depends_on: [], start_date: shift(move, -60), due_date: shift(move, -14),
      estimated_cost: 120000, policy_status: "within_policy", policy_note: "Within the immigration cap.",
      approval_required: false, approval_reason: "",
    },
    {
      key: "flights", category: "flights", title: "One-way flights",
      description: `Economy flights ${request.origin} to ${request.destination} for ${people}.`,
      sequence: 2, depends_on: ["immigration"], start_date: shift(move, -14), due_date: move,
      estimated_cost: 38000 * people, policy_status: "within_policy", policy_note: "Economy fares within the per-person cap.",
      approval_required: false, approval_reason: "",
    },
    {
      key: "household_goods", category: "household_goods", title: "Household goods shipment",
      description: "Door-to-door sea freight of household goods.",
      sequence: 2, depends_on: ["immigration"], start_date: shift(move, -21), due_date: shift(move, 30),
      estimated_cost: 380000, policy_status: "within_policy", policy_note: "Within the shipment cap.",
      approval_required: false, approval_reason: "",
    },
    {
      key: "temp_housing", category: "temporary_housing", title: "Temporary housing (45 days)",
      description: "Serviced apartment while the family finds a long-term home.",
      sequence: 3, depends_on: ["flights"], start_date: move, due_date: shift(move, 45),
      estimated_cost: 420000, policy_status: "out_of_policy", policy_note: "45 days is longer than the 30-day policy limit.",
      approval_required: true, approval_reason: "Stay exceeds the 30-day temporary housing limit.",
    },
    {
      key: "school_search", category: "school_search", title: "School search",
      description: "Shortlist and applications for schools near the new home.",
      sequence: 1, depends_on: [], start_date: shift(move, -45), due_date: shift(move, 21),
      estimated_cost: 55000, policy_status: "within_policy", policy_note: "Within the school search cap.",
      approval_required: false, approval_reason: "",
    },
    {
      key: "settling_in", category: "settling_in", title: "Settling-in support",
      description: "Orientation, bank account, utilities and local registration.",
      sequence: 4, depends_on: ["temp_housing"], start_date: shift(move, 3), due_date: shift(move, 40),
      estimated_cost: 70000, policy_status: "within_policy", policy_note: "Within the settling-in cap.",
      approval_required: false, approval_reason: "",
    },
  ];

  return {
    summary: `Six services to move ${request.employeeName}'s family of ${people} from ${request.origin} to ${request.destination}. Temporary housing is above the 30-day policy limit and needs approval.`,
    services: people >= 3 ? services : services.filter((s) => s.key !== "school_search"),
    milestones: [
      { title: "Visas approved", due_date: shift(move, -14), sequence: 1, related_service_keys: ["immigration"] },
      { title: "Household goods collected", due_date: shift(move, -7), sequence: 2, related_service_keys: ["household_goods"] },
      { title: "Family arrives", due_date: move, sequence: 3, related_service_keys: ["flights", "temp_housing"] },
      { title: "Settled in", due_date: shift(move, 40), sequence: 4, related_service_keys: ["settling_in"] },
    ],
  };
}
