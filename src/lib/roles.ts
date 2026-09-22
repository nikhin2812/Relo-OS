export const ROLES = ["rmc_admin", "consultant", "hr_user", "employee", "vendor"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  rmc_admin: "RMC admin",
  consultant: "Consultant",
  hr_user: "HR",
  employee: "Employee",
  vendor: "Vendor",
};

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

// Employees and vendors never see budget or cost figures.
export function canSeeBudgets(role: Role): boolean {
  return role === "rmc_admin" || role === "consultant" || role === "hr_user";
}
