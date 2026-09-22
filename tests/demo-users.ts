import type { Role } from "@/lib/roles";

export const DEMO_USERS: Record<Role, string> = {
  rmc_admin: "admin@demo.relo-os.test",
  consultant: "consultant@demo.relo-os.test",
  hr_user: "hr@demo.relo-os.test",
  employee: "employee@demo.relo-os.test",
  vendor: "vendor@demo.relo-os.test",
};

export function demoPassword(): string {
  const pw = process.env.DEMO_PASSWORD;
  if (!pw) throw new Error("DEMO_PASSWORD must be set to run these tests");
  return pw;
}
