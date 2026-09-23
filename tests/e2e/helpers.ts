import fs from "node:fs";

import { expect, type Page } from "@playwright/test";

import type { Role } from "@/lib/roles";

import { DEMO_USERS, demoPassword } from "../demo-users";
import { authFile } from "./global-setup";

// Switches the page to this user's saved session (signed in once in global setup).
export async function signInWithEmail(page: Page, email: string) {
  const state = JSON.parse(fs.readFileSync(authFile(email), "utf8")) as {
    cookies: Awaited<ReturnType<ReturnType<Page["context"]>["cookies"]>>;
  };
  await page.context().clearCookies();
  await page.context().addCookies(state.cookies);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/dashboard$/);
}

export async function signInAs(page: Page, role: Role) {
  await signInWithEmail(page, DEMO_USERS[role]);
}

// Signs in through the login form itself, for tests about logging in and out.
export async function loginThroughForm(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(demoPassword());
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

// Waits for a newly created request's plan to appear. If it doesn't, fails with
// what the page actually shows (URL, alerts, plan status) so flaky runs can be diagnosed.
export async function expectPlanReady(page: Page, services = 6) {
  try {
    await expect(page.getByTestId("service-row")).toHaveCount(services, { timeout: 20_000 });
  } catch (error) {
    const alerts = await page.getByRole("alert").allInnerTexts().catch(() => []);
    const planState = await page.getByTestId("plan-not-ready").innerText().catch(() => "(no plan status shown)");
    const heading = await page.locator("h1").first().innerText().catch(() => "(no heading)");
    throw new Error(
      `Plan did not appear. URL: ${page.url()} | heading: ${heading} | alerts: ${JSON.stringify(alerts.filter(Boolean))} | plan: ${planState}\n${String(error)}`,
    );
  }
}
