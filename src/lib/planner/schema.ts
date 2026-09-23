import { z } from "zod";

export const SERVICE_CATEGORIES = [
  "immigration",
  "flights",
  "temporary_housing",
  "household_goods",
  "school_search",
  "settling_in",
  "other",
] as const;
export type ServiceCategory = (typeof SERVICE_CATEGORIES)[number];

export const POLICY_STATUSES = ["within_policy", "needs_review", "out_of_policy"] as const;
export type PolicyStatus = (typeof POLICY_STATUSES)[number];

// The shape we ask Claude to return. Kept simple so it converts cleanly to a
// JSON schema for structured outputs; the real checks live in validate.ts.
export const plannerOutputSchema = z.object({
  summary: z.string(),
  services: z.array(
    z.object({
      key: z.string(),
      category: z.enum(SERVICE_CATEGORIES),
      title: z.string(),
      description: z.string(),
      sequence: z.number().int(),
      depends_on: z.array(z.string()),
      start_date: z.string(),
      due_date: z.string(),
      estimated_cost: z.number(),
      policy_status: z.enum(POLICY_STATUSES),
      policy_note: z.string(),
      approval_required: z.boolean(),
      approval_reason: z.string(),
    }),
  ),
  milestones: z.array(
    z.object({
      title: z.string(),
      due_date: z.string(),
      sequence: z.number().int(),
      related_service_keys: z.array(z.string()),
    }),
  ),
});

export type PlannerOutput = z.infer<typeof plannerOutputSchema>;
export type PlanService = PlannerOutput["services"][number];
export type PlanMilestone = PlannerOutput["milestones"][number];

// The HR request as the planner sees it.
export type PlanningRequest = {
  employeeName: string;
  familySize: number;
  origin: string;
  destination: string;
  moveDate: string; // YYYY-MM-DD
  budget: number; // INR
};

export type ServicePolicy = {
  covered?: boolean;
  max_cost?: number;
  max_cost_per_person?: number;
  max_days?: number;
  note?: string;
  [key: string]: unknown;
};

export type PolicyConfig = {
  currency?: string;
  services?: Partial<Record<ServiceCategory, ServicePolicy>>;
  approval_rules?: string[];
};
