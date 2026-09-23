import { describe, expect, it } from "vitest";

import { loginSchema } from "@/lib/validation";

describe("loginSchema", () => {
  it("accepts a normal login and tidies the email", () => {
    const result = loginSchema.parse({ email: "  HR@Demo.relo-os.test ", password: "secret" });
    expect(result.email).toBe("hr@demo.relo-os.test");
  });

  it("rejects a bad email", () => {
    expect(loginSchema.safeParse({ email: "not-an-email", password: "x" }).success).toBe(false);
  });

  it("rejects a missing password", () => {
    expect(loginSchema.safeParse({ email: "a@b.co", password: "" }).success).toBe(false);
  });

  it("rejects missing fields entirely", () => {
    expect(loginSchema.safeParse({ email: null, password: null }).success).toBe(false);
  });
});

import { recordId } from "@/lib/validation";

describe("recordId", () => {
  it("accepts the fixed demo IDs and random IDs", () => {
    for (const id of [
      "40000000-0000-0000-0000-000000000001",
      "5e000000-0000-0000-0000-000000000002",
      "3f1c2a9e-8b7d-4c1e-9a2b-1d2e3f4a5b6c",
    ]) {
      expect(recordId.safeParse(id).success, id).toBe(true);
    }
  });

  it("rejects anything that isn't an ID", () => {
    for (const bad of ["", "42", "not-an-id", "'; drop table assignments; --"]) {
      expect(recordId.safeParse(bad).success, bad).toBe(false);
    }
  });
});
