// Logs in as each demo role through the real Supabase API and checks that row
// level security returns only what spec section 3 allows. Uses the public
// (anon) key only — exactly what a browser would have.
//
// People can use the demo (e.g. HR creating requests), so these tests compare
// roles with each other rather than relying on fixed totals. Exact counts are
// covered by supabase/tests/rls_role_access.sql, which uses its own fixtures.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

import type { Role } from "@/lib/roles";

import { DEMO_USERS, TEST_HR_EMAIL, demoPassword } from "../demo-users";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const configured = Boolean(url && anonKey && process.env.DEMO_PASSWORD);
// In CI these tests must run; locally they skip if Supabase isn't configured.
const suite = configured || process.env.CI ? describe : describe.skip;

const DEMO_ASSIGNMENT = "40000000-0000-0000-0000-000000000001";
const DEMO_TENANT = "10000000-0000-0000-0000-000000000001";

const TABLES = [
  "rmc_tenants",
  "client_companies",
  "profiles",
  "assignments",
  "assignment_budgets",
  "assignment_consultants",
  "rmc_policies",
  "relocation_plans",
  "plan_services",
  "plan_milestones",
] as const;
type Table = (typeof TABLES)[number];

async function signIn(email: string): Promise<SupabaseClient> {
  const client = createClient(url!, anonKey!, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email, password: demoPassword() });
  if (error) throw new Error(`${email} could not sign in: ${error.message}`);
  return client;
}

suite("role access through the API", () => {
  const clients = {} as Record<Role | "test_hr", SupabaseClient>;
  const rows = {} as Record<Role | "test_hr", Record<Table, Record<string, unknown>[]>>;

  // Signs in as every user and reads every table once, in parallel.
  beforeAll(async () => {
    const people = [...Object.entries(DEMO_USERS), ["test_hr", TEST_HR_EMAIL]] as [Role, string][];
    await Promise.all(
      people.map(async ([role, email]) => {
        const client = await signIn(email);
        clients[role] = client;
        const entries = await Promise.all(
          TABLES.map(async (table) => {
            const { data, error } = await client.from(table).select("*");
            if (error) throw new Error(`${role} reading ${table}: ${error.message}`);
            return [table, data ?? []] as const;
          }),
        );
        rows[role] = Object.fromEntries(entries) as Record<Table, Record<string, unknown>[]>;
      }),
    );
  }, 60_000);

  it("everyone sees only their own RMC", () => {
    for (const role of Object.keys(DEMO_USERS) as Role[]) {
      expect(rows[role].rmc_tenants.map((t) => t.id)).toEqual([DEMO_TENANT]);
    }
  });

  it("RMC admin sees every relocation, budget, plan and profile in the RMC", () => {
    const r = rows.rmc_admin;
    expect(r.assignments.length).toBeGreaterThanOrEqual(1);
    expect(r.assignments.every((a) => a.rmc_tenant_id === DEMO_TENANT)).toBe(true);
    expect(r.assignment_budgets).toHaveLength(r.assignments.length);
    expect(r.relocation_plans).toHaveLength(r.assignments.length);
    expect(r.profiles).toHaveLength(5);
    expect(r.rmc_policies).toHaveLength(1);
  });

  it("consultant sees only the relocation allocated to them", () => {
    const r = rows.consultant;
    expect(r.assignments.map((a) => a.id)).toEqual([DEMO_ASSIGNMENT]);
    expect(r.assignment_budgets.map((b) => b.assignment_id)).toEqual([DEMO_ASSIGNMENT]);
    expect(r.relocation_plans.map((p) => p.assignment_id)).toEqual([DEMO_ASSIGNMENT]);
    expect(r.plan_services.every((s) => s.assignment_id === DEMO_ASSIGNMENT)).toBe(true);
    expect(r.profiles).toHaveLength(1);
  });

  it("HR sees their own company's relocations with budgets and plans", () => {
    const r = rows.hr_user;
    // The demo RMC has one client company, so HR sees what the admin sees.
    expect(r.assignments.map((a) => a.id).sort()).toEqual(rows.rmc_admin.assignments.map((a) => a.id).sort());
    expect(r.assignment_budgets).toHaveLength(r.assignments.length);
    expect(r.relocation_plans).toHaveLength(r.assignments.length);
    expect(r.assignment_consultants).toHaveLength(0);
    expect(r.profiles).toHaveLength(1);
  });

  it("employee sees only their own relocation and no money, policy or plan details", () => {
    const r = rows.employee;
    expect(r.assignments.map((a) => a.id)).toEqual([DEMO_ASSIGNMENT]);
    expect(r.assignment_budgets).toHaveLength(0);
    expect(r.rmc_policies).toHaveLength(0);
    expect(r.relocation_plans).toHaveLength(0);
    expect(r.plan_services).toHaveLength(0);
    expect(r.plan_milestones.every((m) => m.assignment_id === DEMO_ASSIGNMENT)).toBe(true);
  });

  it("vendor sees no relocations, money or plans", () => {
    const r = rows.vendor;
    for (const table of TABLES.filter((t) => t !== "rmc_tenants" && t !== "profiles")) {
      expect(r[table], table).toHaveLength(0);
    }
    expect(r.profiles).toHaveLength(1);
  });

  it("the automated-test HR user can't see anything from the demo RMC", () => {
    const r = rows.test_hr;
    for (const table of TABLES) {
      expect(r[table].some((row) => row.rmc_tenant_id === DEMO_TENANT || row.id === DEMO_TENANT), table).toBe(false);
    }
  });

  for (const role of Object.keys(DEMO_USERS) as Role[]) {
    it(`${role} cannot change relocations or plans directly`, async () => {
      const client = clients[role];
      const update = await client.from("assignments").update({ status: "cancelled" }).eq("id", DEMO_ASSIGNMENT);
      expect(update.error).not.toBeNull();
      const insert = await client.from("plan_services").insert({ assignment_id: DEMO_ASSIGNMENT, service_key: "x" });
      expect(insert.error).not.toBeNull();
    });
  }

  for (const role of ["rmc_admin", "consultant", "employee", "vendor"] as Role[]) {
    it(`${role} cannot create a relocation request`, async () => {
      const { error } = await clients[role].rpc("create_relocation_request", {
        p_employee_name: "Should Fail (Demo)",
        p_family_size: 1,
        p_origin: "A",
        p_destination: "B",
        p_move_date: "2027-01-01",
        p_budget: 1000,
      });
      expect(error?.code).toBe("42501");
    });
  }

  for (const role of ["employee", "vendor"] as Role[]) {
    it(`${role} cannot save a plan`, async () => {
      const { error } = await clients[role].rpc("save_relocation_plan", {
        p_assignment_id: DEMO_ASSIGNMENT,
        p_plan: { summary: "x", services: [], milestones: [] },
        p_model: "x",
      });
      expect(error?.code).toBe("42501");
    });
  }

  it("demo HR cannot wipe data (only the test RMC allows that)", async () => {
    const { error } = await clients.hr_user.rpc("reset_test_tenant_data");
    expect(error?.code).toBe("42501");
  });

  it("a logged-out visitor can read nothing", async () => {
    const client = createClient(url!, anonKey!, { auth: { persistSession: false } });
    for (const table of TABLES) {
      const { error } = await client.from(table).select("*");
      expect(error?.code, table).toBe("42501"); // permission denied
    }
  });
});
