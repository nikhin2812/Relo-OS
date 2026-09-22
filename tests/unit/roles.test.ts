import { describe, expect, it } from "vitest";

import { ROLES, canSeeBudgets, isRole } from "@/lib/roles";

describe("roles", () => {
  it("has exactly the five roles from the spec", () => {
    expect([...ROLES].sort()).toEqual(["consultant", "employee", "hr_user", "rmc_admin", "vendor"]);
  });

  it("recognises valid roles and rejects anything else", () => {
    expect(isRole("hr_user")).toBe(true);
    expect(isRole("superuser")).toBe(false);
    expect(isRole(undefined)).toBe(false);
  });

  it("hides budgets from employees and vendors only", () => {
    expect(canSeeBudgets("rmc_admin")).toBe(true);
    expect(canSeeBudgets("consultant")).toBe(true);
    expect(canSeeBudgets("hr_user")).toBe(true);
    expect(canSeeBudgets("employee")).toBe(false);
    expect(canSeeBudgets("vendor")).toBe(false);
  });
});
