import { createHmac } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { planSigningSecret, signPlan } from "@/lib/planner/signing";

const SECRET = "a".repeat(64);
const ID = "40000000-0000-0000-0000-000000000001";

describe("plan signing", () => {
  afterEach(() => {
    delete process.env.PLAN_SIGNING_SECRET;
  });

  it("signs <assignment>.<time>.<model>.<plan> with HMAC-SHA256, as the database expects", () => {
    const { signedAt, signature } = signPlan(SECRET, ID, '{"summary":"x"}', "claude-opus-5", 1700000000000);
    expect(signedAt).toBe(1700000000000);
    const expected = createHmac("sha256", SECRET)
      .update(`${ID}.1700000000000.claude-opus-5.{"summary":"x"}`)
      .digest("hex");
    expect(signature).toBe(expected);
    expect(signature).toMatch(/^[0-9a-f]{64}$/);
  });

  it("uses the lower-case relocation id, as the database prints it", () => {
    const a = signPlan(SECRET, ID.toUpperCase(), "{}", "m", 1);
    const b = signPlan(SECRET, ID, "{}", "m", 1);
    expect(a.signature).toBe(b.signature);
  });

  it("changes when anything in the plan changes", () => {
    const a = signPlan(SECRET, ID, '{"cost":100}', "m", 1);
    const b = signPlan(SECRET, ID, '{"cost":101}', "m", 1);
    const c = signPlan("b".repeat(64), ID, '{"cost":100}', "m", 1);
    expect(a.signature).not.toBe(b.signature);
    expect(a.signature).not.toBe(c.signature);
  });

  it("uses the current time by default", () => {
    const before = Date.now();
    const { signedAt } = signPlan(SECRET, ID, "{}", "m");
    expect(signedAt).toBeGreaterThanOrEqual(before);
  });

  it("treats a missing or too-short secret as not set up", () => {
    expect(planSigningSecret()).toBeNull();
    process.env.PLAN_SIGNING_SECRET = "short";
    expect(planSigningSecret()).toBeNull();
    process.env.PLAN_SIGNING_SECRET = ` ${SECRET} `;
    expect(planSigningSecret()).toBe(SECRET);
  });
});
