// Clicks through the real login as each of the five roles and checks the
// screen shows only what spec section 3 allows.
import { expect, test, type Page } from "@playwright/test";

import { DEMO_USERS } from "../demo-users";
import { loginThroughForm, signInAs } from "./helpers";

const DEMO_TRIP = "Bengaluru, India → Dubai, UAE";
// Demo HR may have created more relocations, so admin/HR checks look at the demo card.
const demoCard = (page: Page) => page.getByTestId("assignment-card").filter({ hasText: "Eshan Employee (Demo)" });

test("RMC admin sees the demo relocation with its budget", async ({ page }) => {
  await signInAs(page, "rmc_admin");
  await expect(page.getByTestId("role")).toHaveText("RMC admin");
  await expect(page.getByText("Demo Mobility Partners")).toBeVisible();
  await expect(demoCard(page)).toHaveCount(1);
  await expect(demoCard(page)).toContainText(DEMO_TRIP);
  await expect(demoCard(page).getByTestId("budget")).toHaveText("₹15,00,000");
});

test("consultant sees only the relocation allocated to them", async ({ page }) => {
  await signInAs(page, "consultant");
  await expect(page.getByTestId("role")).toHaveText("Consultant");
  await expect(page.getByTestId("assignment-card")).toHaveCount(1);
  await expect(page.getByText(DEMO_TRIP)).toBeVisible();
  await expect(page.getByTestId("budget")).toHaveText("₹15,00,000");
});

test("HR sees their company's relocation and budget", async ({ page }) => {
  await signInAs(page, "hr_user");
  await expect(page.getByTestId("role")).toHaveText("HR");
  await expect(demoCard(page)).toHaveCount(1);
  await expect(demoCard(page)).toContainText("Fictional Tech Pvt Ltd (Demo)");
  await expect(demoCard(page).getByTestId("budget")).toHaveText("₹15,00,000");
});

test("employee sees their own relocation and no money figures", async ({ page }) => {
  await signInAs(page, "employee");
  await expect(page.getByTestId("role")).toHaveText("Employee");
  await expect(page.getByRole("heading", { name: "My relocation" })).toBeVisible();
  await expect(page.getByTestId("assignment-card")).toHaveCount(1);
  await expect(page.getByText(DEMO_TRIP)).toBeVisible();
  await expect(page.getByTestId("budget")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("₹");
  await expect(page.locator("body")).not.toContainText(/budget/i);
});

test("vendor sees only its own work orders and invoices, never a relocation or budget", async ({ page }) => {
  await signInAs(page, "vendor"); // Skyline Moves & Travel (Demo)
  await expect(page.getByTestId("role")).toHaveText("Vendor");
  await expect(page.getByTestId("assignment-card")).toHaveCount(0);
  // The demo has Skyline booked for flights and the shipment
  const orders = page.getByTestId("vendor-work-order");
  await expect(orders.filter({ hasText: "One-way flights" })).toBeVisible();
  await expect(orders.filter({ hasText: "Household goods shipment" })).toBeVisible();
  await expect(page.getByTestId("vendor-invoices")).toContainText("INV-SKY-2291");
  // Its own prices only: no budgets, no other vendors, no internal review reasons
  const body = page.locator("body");
  await expect(body).not.toContainText("₹15,00,000");
  await expect(body).not.toContainText("Palm Stay");
  await expect(body).not.toContainText("Falcon");
  await expect(body).not.toContainText("agreed price of");
});

test("signing out returns to the login page", async ({ page }) => {
  // A real login, so signing out doesn't end the session other tests share.
  await loginThroughForm(page, DEMO_USERS.hr_user);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login$/);
});
