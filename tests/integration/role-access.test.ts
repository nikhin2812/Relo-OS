// Logs in as each demo role through the real Supabase API and checks that row
// level security returns only what spec section 3 allows. Uses the public
// (anon) key only — exactly what a browser would have.
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import type { Role } from "@/lib/roles";

import { DEMO_USERS, demoPassword } from "../demo-users";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const configured = Boolean(url && anonKey && process.env.DEMO_PASSWORD);
// In CI these tests must run; locally they skip if Supabase isn't configured.
const suite = configured || process.env.CI ? describe : describe.skip;

const TABLES = [
  "rmc_tenants",
  "client_companies",
  "profiles",
  "assignments",
  "assignment_budgets",
  "assignment_consultants",
] as const;

// Rows each role should see in the seeded demo data.
const EXPECTED: Record<Role, Record<(typeof TABLES)[number], number>> = {
  rmc_admin:  { rmc_tenants: 1, client_companies: 1, profiles: 5, assignments: 1, assignment_budgets: 1, assignment_consultants: 1 },
  consultant: { rmc_tenants: 1, client_companies: 1, profiles: 1, assignments: 1, assignment_budgets: 1, assignment_consultants: 1 },
  hr_user:    { rmc_tenants: 1, client_companies: 1, profiles: 1, assignments: 1, assignment_budgets: 1, assignment_consultants: 0 },
  employee:   { rmc_tenants: 1, client_companies: 1, profiles: 1, assignments: 1, assignment_budgets: 0, assignment_consultants: 0 },
  vendor:     { rmc_tenants: 1, client_companies: 0, profiles: 1, assignments: 0, assignment_budgets: 0, assignment_consultants: 0 },
};

async function signIn(role: Role) {
  const client = createClient(url!, anonKey!, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email: DEMO_USERS[role], password: demoPassword() });
  if (error) throw new Error(`${role} could not sign in: ${error.message}`);
  return client;
}

suite("role access through the API", () => {
  for (const role of Object.keys(EXPECTED) as Role[]) {
    describe(role, () => {
      for (const table of TABLES) {
        it(`sees ${EXPECTED[role][table]} row(s) in ${table}`, async () => {
          const client = await signIn(role);
          const { count, error } = await client.from(table).select("*", { count: "exact", head: true });
          expect(error).toBeNull();
          expect(count).toBe(EXPECTED[role][table]);
        });
      }

      it("cannot change assignments directly", async () => {
        const client = await signIn(role);
        const { error } = await client
          .from("assignments")
          .update({ status: "cancelled" })
          .eq("id", "40000000-0000-0000-0000-000000000001");
        expect(error).not.toBeNull();
      });
    });
  }

  it("a logged-out visitor can read nothing", async () => {
    const client = createClient(url!, anonKey!, { auth: { persistSession: false } });
    for (const table of TABLES) {
      const { error } = await client.from(table).select("*");
      expect(error?.code).toBe("42501"); // permission denied
    }
  });
});
