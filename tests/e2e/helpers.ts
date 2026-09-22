import { expect, type Page } from "@playwright/test";

import type { Role } from "@/lib/roles";

import { DEMO_USERS, demoPassword } from "../demo-users";

export async function signInAs(page: Page, role: Role) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(DEMO_USERS[role]);
  await page.getByLabel("Password").fill(demoPassword());
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}
