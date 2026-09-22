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
