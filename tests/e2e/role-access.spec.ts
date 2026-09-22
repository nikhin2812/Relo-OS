// Clicks through the real login as each of the five roles and checks the
// screen shows only what spec section 3 allows.
import { expect, test } from "@playwright/test";

import { signInAs } from "./helpers";

const DEMO_TRIP = "Bengaluru, India → Dubai, UAE";

test("RMC admin sees the demo relocation with its budget", async ({ page }) => {
  await signInAs(page, "rmc_admin");
  await expect(page.getByTestId("role")).toHaveText("RMC admin");
  await expect(page.getByText("Demo Mobility Partners")).toBeVisible();
  await expect(page.getByTestId("assignment-card")).toHaveCount(1);
  await expect(page.getByText(DEMO_TRIP)).toBeVisible();
  await expect(page.getByTestId("budget")).toHaveText("₹15,00,000");
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
  await expect(page.getByTestId("assignment-card")).toHaveCount(1);
  await expect(page.getByText("Fictional Tech Pvt Ltd (Demo)")).toBeVisible();
  await expect(page.getByTestId("budget")).toHaveText("₹15,00,000");
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

test("vendor sees no relocations and no money figures", async ({ page }) => {
  await signInAs(page, "vendor");
  await expect(page.getByTestId("role")).toHaveText("Vendor");
  await expect(page.getByText("No work orders have been sent to you yet.")).toBeVisible();
  await expect(page.getByTestId("assignment-card")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("₹");
});

test("signing out returns to the login page", async ({ page }) => {
  await signInAs(page, "hr_user");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login$/);
});
