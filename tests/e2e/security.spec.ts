// Session 7: browser protections on every page and safe login cookies.
import { expect, test } from "@playwright/test";

import { DEMO_USERS } from "../demo-users";
import { loginThroughForm } from "./helpers";

test("every page is sent with browser protections", async ({ request }) => {
  for (const path of ["/login", "/portal/not-a-real-link-0123456789abcdef"]) {
    const res = await request.get(path);
    const h = res.headers();
    expect(h["x-frame-options"], path).toBe("DENY");
    expect(h["x-content-type-options"], path).toBe("nosniff");
    expect(h["content-security-policy"], path).toContain("frame-ancestors 'none'");
    expect(h["content-security-policy"], path).toContain("object-src 'none'");
    expect(h["x-powered-by"], path).toBeUndefined();
  }
});

test("login cookies can't be read by page scripts", async ({ page }) => {
  await loginThroughForm(page, DEMO_USERS.rmc_admin);
  const authCookies = (await page.context().cookies()).filter((c) => c.name.includes("auth-token"));
  expect(authCookies.length).toBeGreaterThan(0);
  for (const c of authCookies) {
    expect(c.httpOnly, c.name).toBe(true);
    expect(c.sameSite, c.name).toBe("Lax");
  }
  expect(await page.evaluate(() => document.cookie)).not.toContain("auth-token");
});

test("the provider portal keeps its link out of referrer headers", async ({ page }) => {
  await page.goto("/portal/not-a-real-link-0123456789abcdef");
  await expect(page.locator('meta[name="referrer"]')).toHaveAttribute("content", "no-referrer");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
});
