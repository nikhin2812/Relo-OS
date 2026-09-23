// MVP item 10 / spec section 8 on the demo data: the invoice 8% over the agreed
// rate is flagged and traced back to its service and budget. Read-only. The owner
// may approve or dispute the demo invoice while trying things out, so these checks
// accept any decision but always require the flag and its explanation.
import { expect, test, type Page } from "@playwright/test";

import { signInAs } from "./helpers";

const DEMO = "/assignments/40000000-0000-0000-0000-000000000001";
const step = (page: Page, title: RegExp) =>
  page.getByTestId("service-row").filter({ has: page.getByRole("heading", { name: title }) });

test("RMC admin sees the 8%-over flights invoice flagged, traced to its service and budget", async ({ page }) => {
  await signInAs(page, "rmc_admin");
  await page.goto(DEMO);

  const flights = step(page, /^One-way flights$/);
  const trail = flights.getByTestId("money-trail");
  await expect(trail).toContainText("Agreed: ₹1,08,000 with Skyline Moves & Travel (Demo)");
  await expect(trail).toContainText("Booking: SKY-DEMO-1042");

  const invoice = flights.getByTestId("invoice").filter({ hasText: "INV-SKY-2291" });
  await expect(invoice.getByTestId("invoice-flag")).toHaveText(
    "⚠ ₹8,640 (8.0%) above the agreed price of ₹1,08,000 — more than the 2% allowed.",
  );
  const status = await invoice.getByTestId("invoice-status").innerText();
  expect(["Flagged", "Approved", "Disputed"]).toContain(status);
  if (status === "Disputed") {
    // A disputed invoice stops counting towards what has been invoiced
    await expect(trail).toContainText("Invoiced: No invoice yet");
  } else {
    await expect(trail).toContainText("Invoiced: ₹1,16,640");
    await expect(flights.getByTestId("trail-difference")).toHaveText("Difference: ₹8,640 over (8.0%)");
  }
  if (status === "Flagged") {
    await expect(invoice.getByRole("button", { name: "Dispute invoice INV-SKY-2291" })).toBeVisible();
  }

  const shipment = step(page, /^Household goods shipment$/);
  await expect(shipment.getByTestId("invoice").filter({ hasText: "INV-SKY-2292" }).getByTestId("invoice-status")).toHaveText("Matched");
  await expect(shipment.getByTestId("trail-difference")).toHaveText("Difference: Exactly as agreed");

  // Relocation totals against the ₹15,00,000 budget (₹3,65,000 if the flights invoice was disputed)
  await expect(page.getByTestId("invoiced")).toHaveText(/^₹(4,81,640|3,65,000)$/);
  await expect(page.getByTestId("invoices-to-review")).toHaveText(/^[01]$/);
});

test("HR sees the flag and the difference, but cannot decide", async ({ page }) => {
  await signInAs(page, "hr_user");
  await page.goto(DEMO);
  const invoice = step(page, /^One-way flights$/).getByTestId("invoice").filter({ hasText: "INV-SKY-2291" });
  await expect(invoice.getByTestId("invoice-flag")).toContainText("₹8,640 (8.0%) above the agreed price");
  await expect(page.getByRole("button", { name: /Approve invoice|Dispute invoice/ })).toHaveCount(0);
  await expect(page.getByText(/Record an invoice received/)).toHaveCount(0);

  await page.goto("/overview");
  const row = page.getByTestId("overview-row").filter({ hasText: "Eshan Employee (Demo)" });
  await expect(row.getByTestId("overview-invoiced")).toHaveText(/^₹(4,81,640|3,65,000)$/);
  await expect(row.getByTestId("overview-variance")).toHaveText(/^(\+₹8,640( · 1 to review)?|₹0)$/);
});

test("the employee sees none of it", async ({ page }) => {
  await signInAs(page, "employee");
  await page.goto(DEMO);
  await expect(page.getByTestId("invoice")).toHaveCount(0);
  const text = await page.locator("body").innerText();
  expect(text).not.toContain("INV-SKY");
  expect(text).not.toContain("₹");
});
