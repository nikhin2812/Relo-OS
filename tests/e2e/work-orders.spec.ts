// MVP items 8 and 9, spec section 7: one transaction end to end — request, plan,
// provider, approval, work order, provider portal booking — then HR's progress and
// budget view and CSV export/import. Runs in the test-only RMC.
import { expect, test, type Page } from "@playwright/test";

import { TEST_ADMIN_EMAIL, TEST_EMPLOYEE_EMAIL, TEST_HR_EMAIL } from "../demo-users";
import { signInWithEmail } from "./helpers";

test.describe.configure({ mode: "serial" });

function inDays(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const step = (page: Page, title: RegExp) =>
  page.getByTestId("service-row").filter({ has: page.getByRole("heading", { name: title }) });

const employeeName = `Transaction Test ${Date.now()} (Demo)`;
let relocationPath = "";
let flightsLink = "";

test("HR requests a relocation and gets a plan", async ({ page }) => {
  await signInWithEmail(page, TEST_HR_EMAIL);
  await page.goto("/requests/new");
  await page.getByLabel("Employee name").fill(employeeName);
  await page.getByLabel("Employee's login email (optional)").fill(TEST_EMPLOYEE_EMAIL);
  await page.getByLabel("Family size (including the employee)").fill("3");
  await page.getByLabel("Moving from").fill("Bengaluru, India");
  await page.getByLabel("Moving to").fill("Dubai, UAE");
  await page.getByLabel("Move date").fill(inDays(60));
  await page.getByLabel("Budget (₹)").fill("1500000");
  await page.getByRole("button", { name: "Create request and generate plan" }).click();
  await expect(page.getByTestId("service-row")).toHaveCount(6, { timeout: 15_000 });
  relocationPath = new URL(page.url()).pathname;
});

test("RMC admin picks providers, approves where needed and sends work orders", async ({ page }) => {
  await signInWithEmail(page, TEST_ADMIN_EMAIL);
  await page.goto(relocationPath);

  // Flights: within policy, so it can be sent straight away
  const flights = step(page, /^One-way flights$/);
  await flights.getByLabel("Provider for One-way flights").selectOption({ index: 1 }); // Skyline, ₹1,08,000
  await flights.getByRole("button", { name: "Choose provider" }).click();
  await expect(flights.getByTestId("agreed-cost")).toHaveText("₹1,08,000");
  await flights.getByRole("button", { name: "Send work order for One-way flights" }).click();
  const notice = flights.getByTestId("portal-link-notice");
  await expect(notice).toContainText("sent");
  await expect(notice).toContainText("shown only once");
  flightsLink = await flights.getByTestId("portal-link").inputValue();
  expect(flightsLink).toMatch(/\/portal\/[A-Za-z0-9_-]{40,}$/);
  await expect(page.getByTestId("committed")).toHaveText("₹1,08,000");

  // Temporary housing: the plan flagged it, so a person must approve before it can go out
  const housing = step(page, /^Temporary housing/);
  await housing.getByLabel(/^Provider for Temporary housing/).selectOption({ index: 1 }); // Palm Stay, ₹3,30,000
  await housing.getByRole("button", { name: "Choose provider" }).click();
  await expect(housing.getByTestId("approval-required")).toBeVisible();
  await expect(housing.getByRole("button", { name: /Send work order/ })).toHaveCount(0);
  await housing.getByRole("button", { name: /^Approve/ }).click();
  await expect(housing.getByTestId("approved")).toBeVisible();
  await housing.getByRole("button", { name: /Send work order for Temporary housing/ }).click();
  await expect(housing.getByTestId("portal-link-notice")).toBeVisible();
  await expect(page.getByTestId("committed")).toHaveText("₹4,38,000");

  // After sending, the provider is locked in
  await page.reload();
  await expect(flights.getByTestId("work-order-status")).toContainText("Work order sent");
  await expect(flights.locator('select[name="vendorId"]')).toHaveCount(0);
});

test("the provider opens the link without an account, accepts, books and uploads a confirmation", async ({ browser }) => {
  const context = await browser.newContext(); // no login cookies at all
  const page = await context.newPage();
  await page.goto(flightsLink);

  await expect(page.getByRole("heading", { name: /One-way flights/ })).toBeVisible();
  await expect(page.getByText("Skyline Moves & Travel (Test)")).toBeVisible();
  await expect(page.getByTestId("portal-price")).toHaveText("₹1,08,000");
  await expect(page.getByText(`${employeeName}, family of 3`)).toBeVisible();

  await page.getByRole("button", { name: "Accept work order" }).click();
  await expect(page.getByTestId("portal-status")).toContainText("Accepted by provider");

  await page.getByLabel("Booking reference").fill("SKY-E2E-1");
  await page.getByLabel("Booked date").fill(inDays(58));
  await page.getByLabel("Note to the relocation team (optional)").fill("Window seats together");
  await page.getByRole("button", { name: "Mark as booked" }).click();
  await expect(page.getByTestId("portal-status")).toContainText("Booked · booking ref SKY-E2E-1");

  await page.locator('input[name="file"]').setInputFiles({
    name: "e-ticket.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n% fictional e-ticket\n%%EOF\n"),
  });
  await page.getByRole("button", { name: "Upload document" }).click();
  await expect(page.getByTestId("portal-documents")).toContainText("e-ticket.pdf");
  await context.close();
});

test("a wrong or tampered link shows nothing", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(flightsLink.slice(0, -2) + "xx");
  await expect(page.getByRole("heading", { name: "This link is not valid or has expired" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Skyline");
  await context.close();
});

test("staff see the booking and the provider's document", async ({ page }) => {
  await signInWithEmail(page, TEST_ADMIN_EMAIL);
  await page.goto(relocationPath);
  const flights = step(page, /^One-way flights$/);
  await expect(flights.getByTestId("work-order-status")).toContainText("Booked · booking ref SKY-E2E-1");
  await expect(flights.getByTestId("work-order-status")).toContainText("Window seats together");
  await expect(page.getByTestId("document-row").filter({ hasText: "e-ticket.pdf" })).toBeVisible();
});

test("the employee sees 'Booked' on their journey, but no price and not the provider's document", async ({ page }) => {
  await signInWithEmail(page, TEST_EMPLOYEE_EMAIL);
  await page.goto(relocationPath);
  const flights = page.getByTestId("journey-service").filter({ hasText: "One-way flights" });
  await expect(flights.getByTestId("journey-service-status")).toHaveText(/^Booked · ref SKY-E2E-1 · /);
  await expect(page.getByText("e-ticket.pdf")).toHaveCount(0);
  const text = await page.locator("body").innerText();
  expect(text).not.toContain("₹");
  expect(text).not.toMatch(/\b(cost|budget|price|agreed|committed)\b/i);
});

test("HR sees progress and committed budget across relocations", async ({ page }) => {
  await signInWithEmail(page, TEST_HR_EMAIL);
  await page.getByRole("link", { name: "Progress and budget" }).click();
  await expect(page.getByRole("heading", { name: "Progress and budget" })).toBeVisible();
  const row = page.getByTestId("overview-row").filter({ hasText: employeeName });
  await expect(row.getByTestId("overview-booked")).toHaveText("1 of 6");
  await expect(row.getByTestId("overview-committed")).toHaveText("₹4,38,000");
  // Forecast: flights 1,08,000 + housing 3,30,000 + remaining estimates 7,19,000 = 11,57,000
  await expect(row.getByTestId("overview-remaining")).toHaveText("₹3,43,000");
  await expect(page.getByTestId("portfolio-committed")).toContainText("₹");
});

test("HR downloads relocations and costs as CSV", async ({ page }) => {
  await signInWithEmail(page, TEST_HR_EMAIL);
  const res = await page.request.get("/exports/relocations");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("text/csv");
  const csv = await res.text();
  expect(csv.split("\r\n")[0]).toContain("employee_name,origin,destination,move_date");
  const flightsRow = csv.split("\r\n").find((l) => l.includes(employeeName) && l.includes("One-way flights"));
  expect(flightsRow).toContain("Skyline Moves & Travel (Test)");
  expect(flightsRow).toContain("108000");
  expect(flightsRow).toContain("booked");
  expect(flightsRow).toContain("SKY-E2E-1");
});

test("the employee and vendors cannot download the CSV", async ({ page }) => {
  await signInWithEmail(page, TEST_EMPLOYEE_EMAIL);
  expect((await page.request.get("/exports/relocations")).status()).toBe(404);
});

test("HR imports relocation requests from CSV and sees which rows had problems", async ({ page }) => {
  await signInWithEmail(page, TEST_HR_EMAIL);
  await page.goto("/requests/import");
  const csv = [
    "employee_name,family_size,origin,destination,move_date,budget",
    `Import One ${Date.now()} (Demo),2,Pune,Singapore,${inDays(90)},900000`,
    `Import Two ${Date.now()} (Demo),1,Chennai,London,${inDays(120)},1200000`,
    `Import Bad ${Date.now()} (Demo),0,Delhi,Delhi,${inDays(30)},100`,
  ].join("\n");
  await page.locator('input[name="file"]').setInputFiles({ name: "relocations.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByRole("button", { name: "Import relocations" }).click();
  await expect(page.getByTestId("import-summary")).toHaveText("2 created, 1 with problems.");
  await expect(page.getByTestId("import-row").nth(2)).toContainText("Line 4");
  await expect(page.getByTestId("import-row").nth(2)).toContainText("Family size must be at least 1");

  await page.goto("/dashboard");
  await expect(page.getByTestId("assignment-card").filter({ hasText: "Pune → Singapore" }).first()).toBeVisible();
});
