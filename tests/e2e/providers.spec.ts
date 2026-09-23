// MVP items 3-5: services with costs and policy, and picking a provider per service.
// Changes happen in the test-only RMC; demo checks below only read.
import { expect, test, type Page } from "@playwright/test";

import { TEST_ADMIN_EMAIL, TEST_HR_EMAIL } from "../demo-users";
import { signInAs, signInWithEmail } from "./helpers";

test.describe.configure({ mode: "serial" });

const step = (page: Page, title: RegExp) =>
  page.getByTestId("service-row").filter({ has: page.getByRole("heading", { name: title }) });

function inDays(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

let assignmentUrl = "";
const employeeName = `Provider Test ${Date.now()} (Demo)`;

test("HR creates a relocation in the test RMC", async ({ page }) => {
  await signInWithEmail(page, TEST_HR_EMAIL);
  await page.goto("/requests/new");
  await page.getByLabel("Employee name").fill(employeeName);
  await page.getByLabel("Family size (including the employee)").fill("3");
  await page.getByLabel("Moving from").fill("Bengaluru, India");
  await page.getByLabel("Moving to").fill("Dubai, UAE");
  await page.getByLabel("Move date").fill(inDays(60));
  await page.getByLabel("Budget (₹)").fill("1500000");
  await page.getByRole("button", { name: "Create request and generate plan" }).click();
  await expect(page.getByTestId("service-row")).toHaveCount(6);
  assignmentUrl = new URL(page.url()).pathname;
});

test("RMC admin sees provider options with prices and picks providers", async ({ page }) => {
  await signInWithEmail(page, TEST_ADMIN_EMAIL);
  await page.goto(assignmentUrl);

  // Flights: two vendors, cheapest first, priced per person x 3
  const flights = step(page, /^One-way flights$/);
  const flightOptions = flights.getByLabel("Provider for One-way flights").locator("option");
  await expect(flightOptions).toHaveCount(3); // placeholder + 2 vendors
  await expect(flightOptions.nth(1)).toContainText("Skyline Moves & Travel (Test) — ₹1,08,000");
  await expect(flightOptions.nth(2)).toContainText("Falcon Relocation Services (Test) — ₹1,23,000");

  await flights.getByLabel("Provider for One-way flights").selectOption({ index: 1 });
  await flights.getByRole("button", { name: "Choose provider" }).click();
  await expect(flights.getByTestId("selected-provider")).toContainText("Skyline Moves & Travel (Test)");
  await expect(flights.getByTestId("agreed-cost")).toHaveText("₹1,08,000");
  await expect(flights.getByRole("button", { name: "Change provider" })).toBeVisible();

  // Totals: committed ₹1,08,000; forecast = 11,59,000 - 1,14,000 + 1,08,000 = 11,53,000
  await expect(page.getByTestId("committed")).toHaveText("₹1,08,000");
  await expect(page.getByTestId("remaining")).toHaveText("₹3,47,000");

  // Temporary housing: the pricier vendor is above the ₹3,50,000 policy cap
  const housing = step(page, /^Temporary housing/);
  const housingSelect = housing.getByLabel(/^Provider for Temporary housing/);
  await expect(housingSelect.locator("option").nth(2)).toContainText("(over policy cap)");
  await housingSelect.selectOption({ index: 2 });
  await housing.getByRole("button", { name: "Choose provider" }).click();
  await expect(housing.getByTestId("agreed-cost")).toHaveText("₹3,90,000");
  await expect(housing.getByTestId("agreed-over-cap")).toBeVisible();
  await expect(page.getByTestId("committed")).toHaveText("₹4,98,000");

  // Changing to the cheaper vendor clears the over-cap warning
  await housingSelect.selectOption({ index: 1 });
  await housing.getByRole("button", { name: "Change provider" }).click();
  await expect(housing.getByTestId("agreed-cost")).toHaveText("₹3,30,000");
  await expect(housing.getByTestId("agreed-over-cap")).toHaveCount(0);
  await expect(page.getByTestId("committed")).toHaveText("₹4,38,000");

  // A service no vendor offers says so
  await expect(step(page, /^Work and family visas$/)).not.toContainText("No vendor in your network");
});

test("HR sees the chosen providers but cannot pick or see rate cards", async ({ page }) => {
  await signInWithEmail(page, TEST_HR_EMAIL);
  await page.goto(assignmentUrl);
  await expect(step(page, /^One-way flights$/).getByTestId("selected-provider")).toContainText("Skyline Moves & Travel (Test)");
  await expect(step(page, /^Settling-in support$/)).toContainText("Provider not chosen yet.");
  await expect(page.getByRole("button", { name: /Choose provider|Change provider/ })).toHaveCount(0);
  await expect(page.locator('select[name="vendorId"]')).toHaveCount(0);
  // Vendors that weren't chosen stay hidden from HR
  await expect(page.locator("body")).not.toContainText("Falcon Relocation Services");
});

test("consultant sees provider options on the demo relocation (read only check)", async ({ page }) => {
  await signInAs(page, "consultant");
  await page.getByRole("link", { name: "Bengaluru, India → Dubai, UAE" }).click();
  const flights = step(page, /^One-way flights$/);
  await expect(flights.getByLabel("Provider for One-way flights").locator("option")).toContainText([
    "Choose a provider…",
    "Skyline Moves & Travel (Demo)",
    "Falcon Relocation Services (Demo)",
  ]);
});

test("vendor and employee see no money on the demo relocation", async ({ page }) => {
  for (const role of ["vendor", "employee"] as const) {
    await signInAs(page, role);
    const res = await page.goto("/assignments/40000000-0000-0000-0000-000000000001");
    if (role === "vendor") expect(res?.status()).toBe(404);
    await expect(page.locator("body")).not.toContainText("₹");
    await page.context().clearCookies();
  }
});
