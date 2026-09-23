// MVP items 1 and 2: HR creates a relocation request and gets an AI plan.
// Runs as the HR user of a separate test-only RMC, with the AI planner
// replaced by a stand-in (PLANNER_MODE=mock), so the demo data is untouched.
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

import { TEST_HR_EMAIL, demoPassword } from "../demo-users";
import { signInAs, signInWithEmail } from "./helpers";

test.describe.configure({ mode: "serial" });

async function clearTestRmc() {
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false },
  });
  const { error: signInError } = await client.auth.signInWithPassword({ email: TEST_HR_EMAIL, password: demoPassword() });
  if (signInError) throw signInError;
  const { error } = await client.rpc("reset_test_tenant_data");
  if (error) throw error;
}

test.beforeAll(clearTestRmc);
test.afterAll(clearTestRmc);

function inDays(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function fillRequest(page: Page, name: string, overrides: Partial<Record<string, string>> = {}) {
  const values = {
    "Employee name": name,
    "Family size (including the employee)": "3",
    "Moving from": "Bengaluru, India",
    "Moving to": "Dubai, UAE",
    "Move date": inDays(60),
    "Budget (₹)": "1500000",
    ...overrides,
  };
  for (const [label, value] of Object.entries(values)) {
    await page.getByLabel(label).fill(value!);
  }
}

test("HR creates a request and sees the generated plan with costs, policy flags and approvals", async ({ page }) => {
  await signInWithEmail(page, TEST_HR_EMAIL);
  await page.getByRole("link", { name: "New relocation request" }).click();
  await expect(page.getByRole("heading", { name: "New relocation request" })).toBeVisible();

  const name = `Asha Testperson ${Date.now()} (Demo)`;
  await fillRequest(page, name);
  await page.getByRole("button", { name: "Create request and generate plan" }).click();

  await expect(page).toHaveURL(/\/assignments\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: "Bengaluru, India → Dubai, UAE" })).toBeVisible();
  await expect(page.getByTestId("plan-summary")).toContainText("Six services");

  // Services, in order, with costs and policy results
  const rows = page.getByTestId("service-row");
  await expect(rows).toHaveCount(6);
  await expect(rows.first()).toContainText("Step 1");
  // Match on each step's title; other steps mention it in "after …".
  const step = (title: RegExp) => rows.filter({ has: page.getByRole("heading", { name: title }) });
  const housing = step(/^Temporary housing/);
  await expect(housing).toContainText("Out of policy");
  await expect(housing).toContainText("Needs approval");
  await expect(housing).toContainText("₹4,20,000");
  await expect(housing).toContainText("after One-way flights");
  await expect(step(/^Work and family visas$/)).toContainText("Within policy");

  // Budget maths: ₹11,59,000 of ₹15,00,000
  await expect(page.getByTestId("budget")).toHaveText("₹15,00,000");
  await expect(page.getByTestId("estimated-total")).toHaveText("₹11,59,000");
  await expect(page.getByTestId("remaining")).toHaveText("₹3,41,000");
  await expect(page.getByTestId("approvals-needed")).toHaveText("1");

  // Milestones
  await expect(page.getByTestId("milestone-list").getByRole("listitem")).toHaveCount(4);

  // The dashboard shows the new relocation as planned
  await page.getByRole("link", { name: "← Back to relocations" }).click();
  const card = page.getByTestId("assignment-card").filter({ hasText: name });
  await expect(card.getByTestId("status")).toHaveText("planned");
});

test("if the AI planner fails, the request is kept and HR can try again", async ({ page }) => {
  await signInWithEmail(page, TEST_HR_EMAIL);
  await page.goto("/requests/new");
  await fillRequest(page, `Flaky ${Date.now()} [simulate-ai-failure] (Demo)`);
  await page.getByRole("button", { name: "Create request and generate plan" }).click();

  await expect(page).toHaveURL(/\/assignments\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId("plan-error")).toContainText("busy or unreachable");
  await expect(page.getByTestId("service-row")).toHaveCount(0);

  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByTestId("service-row")).toHaveCount(6);
  await expect(page.getByTestId("plan-error")).toHaveCount(0);
});

test("the server rejects a request with the same origin and destination", async ({ page }) => {
  await signInWithEmail(page, TEST_HR_EMAIL);
  await page.goto("/requests/new");
  await fillRequest(page, `Same Place ${Date.now()} (Demo)`, { "Moving to": "bengaluru, india" });
  await page.getByRole("button", { name: "Create request and generate plan" }).click();
  await expect(page.getByText("Origin and destination must be different")).toBeVisible();
  await expect(page).toHaveURL(/\/requests\/new$/);
});

test("only HR can open the request form", async ({ page }) => {
  for (const role of ["employee", "consultant", "vendor", "rmc_admin"] as const) {
    await signInAs(page, role);
    await expect(page.getByRole("link", { name: "New relocation request" })).toHaveCount(0);
    const response = await page.goto("/requests/new");
    expect(response?.status(), role).toBe(404);
    await page.context().clearCookies();
  }
});

test("employee sees no plan costs on their relocation page", async ({ page }) => {
  await signInAs(page, "employee");
  await page.getByRole("link", { name: "Bengaluru, India → Dubai, UAE" }).click();
  await expect(page).toHaveURL(/\/assignments\/40000000-0000-0000-0000-000000000001$/);
  await expect(page.getByRole("heading", { name: "Relocation plan" })).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("₹");
});
