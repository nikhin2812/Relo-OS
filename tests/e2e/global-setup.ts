import fs from "node:fs";
import path from "node:path";

import { chromium, type FullConfig } from "@playwright/test";

import { ALL_TEST_LOGINS, demoPassword } from "../demo-users";
import clearTestRmc from "./test-rmc";

export const AUTH_DIR = path.join(__dirname, ".auth");
export const authFile = (email: string) => path.join(AUTH_DIR, `${email}.json`);

// Runs once before all browser tests: empties the test-only RMC, then signs each
// test user in once through the real login page and saves the session. Tests
// reuse these sessions instead of logging in again and again (Supabase limits
// sign-ins to about 30 per 5 minutes).
export default async function globalSetup(config: FullConfig) {
  await clearTestRmc();

  const baseURL = config.projects[0].use.baseURL!;
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  const browser = await chromium.launch(
    process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  );
  try {
    for (const email of ALL_TEST_LOGINS) {
      const context = await browser.newContext({ baseURL });
      const page = await context.newPage();
      await page.goto("/login");
      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Password").fill(demoPassword());
      await page.getByRole("button", { name: "Sign in" }).click();
      await page.waitForURL(/\/dashboard$/, { timeout: 30_000 });
      await context.storageState({ path: authFile(email) });
      await context.close();
    }
  } finally {
    await browser.close();
  }
}
