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
const DEMO_VENDOR_IDS = [
  "50000000-0000-0000-0000-000000000001",
  "50000000-0000-0000-0000-000000000002",
  "50000000-0000-0000-0000-000000000003",
];
const SKYLINE = "50000000-0000-0000-0000-000000000002";

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
  "vendors",
  "vendor_rates",
  "journey_tasks",
  "documents",
  "work_orders",
  "work_order_events",
] as const;

// work_orders hides its link-hash column, so "*" is not allowed there.
const COLUMNS: Partial<Record<(typeof TABLES)[number], string>> = {
  work_orders: "id, reference, service_id, assignment_id, rmc_tenant_id, vendor_id, agreed_cost, status",
};
type Table = (typeof TABLES)[number];

async function signIn(email: string): Promise<SupabaseClient> {
  const client = createClient(url!, anonKey!, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email, password: demoPassword() });
  if (error) throw new Error(`${email} could not sign in: ${error.message}`);
  // Supabase's auth and database servers can disagree by a moment, so a brand-new
  // login token is briefly "issued in the future". Wait until the database accepts it.
  for (let attempt = 0; attempt < 10; attempt++) {
    const probe = await client.from("profiles").select("id").limit(1);
    if (!probe.error?.message.includes("issued at future")) break;
    await new Promise((r) => setTimeout(r, 500));
  }
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
            const { data, error } = await client.from(table).select(COLUMNS[table] ?? "*");
            if (error) throw new Error(`${role} reading ${table}: ${error.message}`);
            return [table, data ?? []] as const;
          }),
        );
        rows[role] = Object.fromEntries(entries) as unknown as Record<Table, Record<string, unknown>[]>;
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

  it("RMC staff see the whole vendor network and rate cards", () => {
    for (const role of ["rmc_admin", "consultant"] as Role[]) {
      const ids = rows[role].vendors.map((v) => v.id);
      for (const id of DEMO_VENDOR_IDS) expect(ids, role).toContain(id);
      expect(rows[role].vendor_rates.length, role).toBeGreaterThanOrEqual(9);
      expect(rows[role].vendors.every((v) => v.rmc_tenant_id === DEMO_TENANT), role).toBe(true);
    }
  });

  it("HR sees only vendors chosen for its relocations, and no rate cards", () => {
    const chosen = new Set(rows.hr_user.plan_services.map((s) => s.selected_vendor_id).filter(Boolean));
    expect(rows.hr_user.vendors.every((v) => chosen.has(v.id))).toBe(true);
    expect(rows.hr_user.vendor_rates).toHaveLength(0);
  });

  it("the vendor sees only its own company and no rate cards", () => {
    expect(rows.vendor.vendors.map((v) => v.id)).toEqual([SKYLINE]);
    expect(rows.vendor.vendor_rates).toHaveLength(0);
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
    expect(r.vendors).toHaveLength(0);
    expect(r.vendor_rates).toHaveLength(0);
    expect(r.plan_milestones.every((m) => m.assignment_id === DEMO_ASSIGNMENT)).toBe(true);
    expect(r.journey_tasks.length).toBeGreaterThan(0);
    expect(r.journey_tasks.every((t) => t.assignment_id === DEMO_ASSIGNMENT)).toBe(true);
    expect(r.documents.every((d) => d.assignment_id === DEMO_ASSIGNMENT)).toBe(true);
  });

  it("vendor sees no relocations, money or plans", () => {
    const r = rows.vendor;
    for (const table of TABLES.filter((t) => t !== "rmc_tenants" && t !== "profiles" && t !== "vendors")) {
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

  for (const role of ["hr_user", "employee", "vendor"] as Role[]) {
    it(`${role} cannot choose providers`, async () => {
      const service = rows.rmc_admin.plan_services.find((s) => s.assignment_id === DEMO_ASSIGNMENT);
      expect(service).toBeDefined();
      const { error } = await clients[role].rpc("select_service_provider", {
        p_service_id: service!.id,
        p_vendor_id: SKYLINE,
      });
      expect(error?.code).toBe("42501");
    });
  }

  it("nobody can read work order link hashes", async () => {
    for (const role of Object.keys(DEMO_USERS) as Role[]) {
      const { error } = await clients[role].from("work_orders").select("token_hash").limit(1);
      expect(error?.code, role).toBe("42501");
    }
  });

  it("work orders: employee sees none, vendor only its own, HR only its company's", () => {
    expect(rows.employee.work_orders).toHaveLength(0);
    expect(rows.employee.work_order_events).toHaveLength(0);
    expect(rows.vendor.work_orders.every((w) => w.vendor_id === SKYLINE)).toBe(true);
    expect(rows.vendor.work_order_events).toHaveLength(0);
    const hrRelocations = new Set(rows.hr_user.assignments.map((a) => a.id));
    expect(rows.hr_user.work_orders.every((w) => hrRelocations.has(w.assignment_id as string))).toBe(true);
    expect(rows.test_hr.work_orders.every((w) => w.rmc_tenant_id !== DEMO_TENANT)).toBe(true);
  });

  it("the portal refuses made-up links, even for logged-out visitors", async () => {
    const anon = createClient(url!, anonKey!, { auth: { persistSession: false } });
    const { error } = await anon.rpc("portal_get_work_order", { p_token: "made-up-link-0123456789abcdefghijklmnop" });
    expect(error?.code).toBe("P0002");
    const update = await anon.rpc("portal_update_work_order", { p_token: "made-up-link-0123456789abcdefghijklmnop", p_action: "book" });
    expect(update.error?.code).toBe("P0002");
  });

  for (const role of ["hr_user", "employee", "vendor"] as Role[]) {
    it(`${role} cannot send work orders or approve`, async () => {
      const service = rows.rmc_admin.plan_services.find((s) => s.assignment_id === DEMO_ASSIGNMENT);
      const send = await clients[role].rpc("create_work_order", { p_service_id: service!.id, p_token_hash: "a".repeat(64) });
      expect(send.error?.code).toBe("42501");
      const approve = await clients[role].rpc("approve_service", { p_service_id: service!.id });
      expect(approve.error?.code).toBe("42501");
    });
  }

  it("the employee's journey services carry no money or policy fields", async () => {
    const { data, error } = await clients.employee.rpc("journey_services", { p_assignment_id: DEMO_ASSIGNMENT });
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThan(0);
    for (const row of data as Record<string, unknown>[]) {
      expect(Object.keys(row).join(",")).not.toMatch(/cost|budget|rate|price|policy|approval/i);
    }
  });

  it("vendor and other-RMC users cannot read the demo journey", async () => {
    for (const role of ["vendor", "test_hr"] as const) {
      const { error } = await clients[role as Role].rpc("journey_services", { p_assignment_id: DEMO_ASSIGNMENT });
      expect(error?.code, role).toBe("42501");
    }
  });

  it("the employee can upload a file to their relocation and remove it before it is registered", async () => {
    const path = `${DEMO_ASSIGNMENT}/api-test-${Date.now()}.pdf`;
    const bucket = clients.employee.storage.from("relocation-documents");
    const up = await bucket.upload(path, new Blob(["%PDF-1.4 test"], { type: "application/pdf" }));
    expect(up.error).toBeNull();
    const signed = await bucket.createSignedUrl(path, 30);
    expect(signed.error).toBeNull();
    const removed = await bucket.remove([path]);
    expect(removed.error).toBeNull();
    expect(removed.data).toHaveLength(1);
  });

  for (const role of ["vendor", "test_hr"] as const) {
    it(`${role} cannot upload files to the demo relocation`, async () => {
      const path = `${DEMO_ASSIGNMENT}/should-fail-${Date.now()}.pdf`;
      const up = await clients[role as Role].storage
        .from("relocation-documents")
        .upload(path, new Blob(["%PDF-1.4"], { type: "application/pdf" }));
      expect(up.error).not.toBeNull();
    });
  }

  it("files the employee cannot see are not listed or signed for them", async () => {
    const list = await clients.vendor.storage.from("relocation-documents").list(DEMO_ASSIGNMENT);
    expect(list.data ?? []).toHaveLength(0);
  });

  it("demo HR cannot wipe data (only the test RMC allows that)", async () => {
    const { error } = await clients.hr_user.rpc("reset_test_tenant_data");
    expect(error?.code).toBe("42501");
  });

  it("a logged-out visitor can read nothing", async () => {
    const client = createClient(url!, anonKey!, { auth: { persistSession: false } });
    const results = await Promise.all(TABLES.map((table) => client.from(table).select("id").limit(1)));
    results.forEach(({ error }, i) => expect(error?.code, TABLES[i]).toBe("42501")); // permission denied
  });
});
