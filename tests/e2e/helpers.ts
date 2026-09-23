import { expect, type Page } from "@playwright/test";

import type { Role } from "@/lib/roles";

import { DEMO_USERS, demoPassword } from "../demo-users";

export async function signInWithEmail(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(demoPassword());
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

export async function signInAs(page: Page, role: Role) {
  await signInWithEmail(page, DEMO_USERS[role]);
}
