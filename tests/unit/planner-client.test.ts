// The planner call with Claude's API replaced by canned responses.
import Anthropic from "@anthropic-ai/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PlannerError, requestPlan } from "@/lib/planner/client";
import { mockPlan } from "@/lib/planner/mock";
import { validatePlan } from "@/lib/planner/validate";

const request = {
  employeeName: "Test Person (Demo)",
  familySize: 3,
  origin: "Bengaluru, India",
  destination: "Dubai, UAE",
  moveDate: "2026-11-15",
  budget: 1500000,
};

function fakeClient(create: ReturnType<typeof vi.fn>) {
  return { beta: { messages: { create } } } as unknown as Pick<Anthropic, "beta">;
}

function message(text: string, stop_reason = "end_turn") {
  return { model: "claude-opus-5", stop_reason, content: [{ type: "text", text }] };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("requestPlan with a mocked API", () => {
  it("sends the request and policy, and returns JSON that passes validation", async () => {
    const create = vi.fn().mockResolvedValue(message(JSON.stringify(mockPlan(request))));
    const result = await requestPlan(request, { services: {} }, fakeClient(create));

    const params = create.mock.calls[0][0];
    expect(params.model).toBe("claude-opus-5");
    expect(params.fallbacks).toBe("default");
    expect(params.output_config.format.type).toBe("json_schema");
    expect(params.messages[0].content).toContain("Dubai, UAE");
    expect(params.messages[0].content).toContain("1500000");

    expect(result.model).toBe("claude-opus-5");
    expect(validatePlan(result.text, request).ok).toBe(true);
  });

  it("uses a different model when PLANNER_MODEL is set, without the Opus-only fallback", async () => {
    vi.stubEnv("PLANNER_MODEL", "claude-sonnet-5");
    const create = vi.fn().mockResolvedValue(message("{}"));
    await requestPlan(request, {}, fakeClient(create));
    expect(create.mock.calls[0][0].model).toBe("claude-sonnet-5");
    expect(create.mock.calls[0][0].fallbacks).toBeUndefined();
  });

  it("turns a refusal into a plain message", async () => {
    const create = vi.fn().mockResolvedValue(message("", "refusal"));
    await expect(requestPlan(request, {}, fakeClient(create))).rejects.toThrow(/declined/);
  });

  it("turns a cut-off answer into a plain message", async () => {
    const create = vi.fn().mockResolvedValue(message('{"summary": "Six serv', "max_tokens"));
    await expect(requestPlan(request, {}, fakeClient(create))).rejects.toThrow(/cut off/);
  });

  it("explains a rejected API key", async () => {
    const create = vi.fn().mockRejectedValue(new Anthropic.AuthenticationError(401, undefined, "invalid x-api-key", new Headers()));
    await expect(requestPlan(request, {}, fakeClient(create))).rejects.toThrow(/API key was rejected/);
  });

  it("explains an outage or network failure", async () => {
    const outage = vi.fn().mockRejectedValue(new Anthropic.InternalServerError(529, undefined, "overloaded", new Headers()));
    await expect(requestPlan(request, {}, fakeClient(outage))).rejects.toBeInstanceOf(PlannerError);
    const offline = vi.fn().mockRejectedValue(new Anthropic.APIConnectionError({ message: "ECONNRESET" }));
    await expect(requestPlan(request, {}, fakeClient(offline))).rejects.toThrow(/busy or unreachable/);
  });

  it("says planning is off when no API key is configured", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("PLANNER_MODE", "");
    await expect(requestPlan(request, {})).rejects.toThrow(/isn't switched on yet/);
  });

  it("mock mode fails once for the failure marker, then succeeds", async () => {
    vi.stubEnv("PLANNER_MODE", "mock");
    const flaky = { ...request, employeeName: "Flaky [simulate-ai-failure] (Demo)" };
    await expect(requestPlan(flaky, {})).rejects.toBeInstanceOf(PlannerError);
    const second = await requestPlan(flaky, {});
    expect(validatePlan(second.text, flaky).ok).toBe(true);
  });
});
