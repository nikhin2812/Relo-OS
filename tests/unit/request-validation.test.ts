import { describe, expect, it } from "vitest";

import { relocationRequestSchema } from "@/lib/validation";

const TODAY = "2026-09-23";
const valid = {
  employeeName: "  Priya Example (Demo) ",
  familySize: "3",
  origin: "Bengaluru, India",
  destination: "Dubai, UAE",
  moveDate: "2026-11-15",
  budget: "1500000",
};

const check = (overrides: Partial<typeof valid>) => relocationRequestSchema(TODAY).safeParse({ ...valid, ...overrides });
const firstError = (overrides: Partial<typeof valid>) => {
  const r = check(overrides);
  return r.success ? null : r.error.issues[0].message;
};

describe("relocationRequestSchema", () => {
  it("accepts the demo request and converts form text to numbers", () => {
    const r = check({});
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.employeeName).toBe("Priya Example (Demo)");
      expect(r.data.familySize).toBe(3);
      expect(r.data.budget).toBe(1500000);
    }
  });

  it("requires a name", () => expect(firstError({ employeeName: "  " })).toMatch(/name/));
  it("rejects family sizes outside 1–20", () => {
    expect(firstError({ familySize: "0" })).toMatch(/at least 1/);
    expect(firstError({ familySize: "21" })).toMatch(/20 or fewer/);
    expect(firstError({ familySize: "2.5" })).toMatch(/whole number/);
  });
  it("rejects a past move date", () => expect(firstError({ moveDate: "2026-09-01" })).toMatch(/past/));
  it("rejects a move date more than two years away", () => expect(firstError({ moveDate: "2029-01-01" })).toMatch(/two years/));
  it("rejects a badly formatted date", () => expect(firstError({ moveDate: "15/11/2026" })).toMatch(/move date/));
  it("rejects zero, negative and huge budgets", () => {
    expect(firstError({ budget: "0" })).toMatch(/more than/);
    expect(firstError({ budget: "-100" })).toMatch(/more than/);
    expect(firstError({ budget: "1000000000" })).toMatch(/10 crore/);
    expect(firstError({ budget: "abc" })).toBeTruthy();
  });
  it("rejects the same origin and destination", () => {
    expect(firstError({ destination: "bengaluru, india" })).toMatch(/different/);
  });
});

describe("employee login email (optional)", () => {
  it("is optional", () => {
    const r = check({});
    expect(r.success && r.data.employeeEmail).toBe("");
  });
  it("accepts and tidies a valid email", () => {
    const r = relocationRequestSchema(TODAY).safeParse({ ...valid, employeeEmail: "  Eshan@Demo.Relo-OS.test " });
    expect(r.success && r.data.employeeEmail).toBe("eshan@demo.relo-os.test");
  });
  it("rejects a malformed email", () => {
    const r = relocationRequestSchema(TODAY).safeParse({ ...valid, employeeEmail: "not-an-email" });
    expect(r.success).toBe(false);
  });
});
