import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";

import { mockPlan, shouldSimulateFailure } from "./mock";
import { PLANNER_SYSTEM_PROMPT, buildPlannerUserMessage } from "./prompt";
import { plannerOutputSchema, type PlanningRequest, type PolicyConfig } from "./schema";

export const DEFAULT_PLANNER_MODEL = "claude-opus-5";

// A failure we can show to HR in plain words.
export class PlannerError extends Error {}

export type PlannerResponse = { text: string; model: string };

export function plannerModel(): string {
  return process.env.PLANNER_MODEL || DEFAULT_PLANNER_MODEL;
}

// Asks Claude for a relocation plan and returns its raw JSON text.
// Nothing is trusted yet — the caller validates before saving.
// `client` can be swapped in tests.
export async function requestPlan(
  request: PlanningRequest,
  policy: PolicyConfig,
  client?: Pick<Anthropic, "beta">,
): Promise<PlannerResponse> {
  if (process.env.PLANNER_MODE === "mock") {
    if (shouldSimulateFailure(request.employeeName)) {
      throw new PlannerError("The AI planner is busy or unreachable right now. Please try again in a minute.");
    }
    return { text: JSON.stringify(mockPlan(request)), model: "mock-planner" };
  }

  if (!client && !process.env.ANTHROPIC_API_KEY) {
    throw new PlannerError("AI planning isn't switched on yet (no API key configured). Your request is saved.");
  }

  const api = client ?? new Anthropic({ timeout: 120_000, maxRetries: 2 });
  const model = plannerModel();
  // Server-side refusal fallback is only offered for the default model.
  const fallback = model === DEFAULT_PLANNER_MODEL
    ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
    : {};

  let response: Anthropic.Beta.BetaMessage;
  try {
    response = await api.beta.messages.create({
      model,
      max_tokens: 16000,
      ...fallback,
      output_config: { effort: "medium", format: betaZodOutputFormat(plannerOutputSchema) },
      system: PLANNER_SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildPlannerUserMessage(request, policy) }],
    });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
      throw new PlannerError("The AI planner's API key was rejected. Ask an admin to check it.");
    }
    if (error instanceof Anthropic.BadRequestError) {
      throw new PlannerError("The AI planner could not process this request.");
    }
    if (error instanceof Anthropic.APIError || error instanceof Anthropic.APIConnectionError) {
      throw new PlannerError("The AI planner is busy or unreachable right now. Please try again in a minute.");
    }
    throw error;
  }

  if (response.stop_reason === "refusal") {
    throw new PlannerError("The AI planner declined this request.");
  }
  if (response.stop_reason === "max_tokens") {
    throw new PlannerError("The AI planner's answer was cut off. Please try again.");
  }
  const text = response.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  return { text, model: response.model };
}
