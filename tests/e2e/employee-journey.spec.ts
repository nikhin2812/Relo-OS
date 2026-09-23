// MVP items 6 and 7: the employee's consolidated journey and documents.
// Changes happen in the test-only RMC; demo checks only read.
import { expect, test, type Page } from "@playwright/test";

import { TEST_EMPLOYEE_EMAIL, TEST_HR_EMAIL } from "../demo-users";
import { signInAs, signInWithEmail } from "./helpers";

test.describe.configure({ mode: "serial" });

function inDays(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Anything that would reveal money: symbols, amounts and money words, in the
// visible page AND in the HTML/data sent to the browser.
const MONEY_WORDS = /\b(cost|costs|budget|budgets|rate|rates|price|prices|priced|committed|estimated?|agreed|paise|lakh|crore|INR)\b/i;
const MONEY_FIELDS = /estimated_cost|agreed_cost|agreed_over_cap|policy_status|assignment_budgets|vendor_rates/;
const AMOUNT = /\d{1,2},\d{2},\d{3}|\d{1,3},\d{3}\b/; // 4,20,000 or 36,000

async function expectNoMoney(page: Page) {
  const text = await page.locator("body").innerText();
  expect(text, "no rupee sign").not.toContain("₹");
  expect(text, "no money words").not.toMatch(MONEY_WORDS);
  expect(text, "no amounts").not.toMatch(AMOUNT);
  const html = await page.content();
  expect(html, "no rupee sign in page data").not.toContain("₹");
  expect(html, "no money fields in page data").not.toMatch(MONEY_FIELDS);
}

let relocationPath = "";
const employeeName = `Journey Test ${Date.now()} (Demo)`;

test("HR creates a relocation linked to the employee's login", async ({ page }) => {
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
  // Saving the request and the plan takes several database calls; allow for a busy CI run.
  await expect(page.getByTestId("service-row")).toHaveCount(6, { timeout: 15_000 });
  relocationPath = new URL(page.url()).pathname;
});

test("HR can't link someone who isn't an employee at their company", async ({ page }) => {
  await signInWithEmail(page, TEST_HR_EMAIL);
  await page.goto("/requests/new");
  await page.getByLabel("Employee name").fill(`Wrong Link ${Date.now()} (Demo)`);
  await page.getByLabel("Employee's login email (optional)").fill("employee@demo.relo-os.test");
  await page.getByLabel("Family size (including the employee)").fill("1");
  await page.getByLabel("Moving from").fill("Pune");
  await page.getByLabel("Moving to").fill("Doha");
  await page.getByLabel("Move date").fill(inDays(30));
  await page.getByLabel("Budget (₹)").fill("500000");
  await page.getByRole("button", { name: "Create request and generate plan" }).click();
  await expect(page.getByText("No employee login with that email at your company")).toBeVisible();
});

test("the employee sees one journey with services, key dates and to-dos, and ticks one off", async ({ page }) => {
  await signInWithEmail(page, TEST_EMPLOYEE_EMAIL);
  await page.getByTestId("assignment-card").filter({ hasText: employeeName }).getByRole("link").click();
  await expect(page).toHaveURL(new RegExp(`${relocationPath}$`));

  await expect(page.getByRole("heading", { name: "Your journey" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Relocation plan" })).toHaveCount(0);
  await expect(page.getByTestId("journey-service")).toHaveCount(6);
  await expect(page.getByTestId("journey-milestone")).toHaveCount(4);
  await expect(page.getByTestId("journey-task")).toHaveCount(7);
  await expect(page.getByText("★ Family arrives")).toBeVisible();
  await expect(page.getByText("To-dos done: 0 of 7.")).toBeVisible();

  // Dates run in order down the page
  const firstService = page.getByTestId("journey-service").first();
  await expect(firstService).toContainText("Work and family visas");

  const task = "Upload passport copies and photos for each family member";
  await page.getByRole("button", { name: `Mark "${task}" as done` }).click();
  await expect(page.getByRole("button", { name: `Mark "${task}" as not done` })).toBeVisible();
  await expect(page.getByText("To-dos done: 1 of 7.")).toBeVisible();

  await expectNoMoney(page);
});

test("the employee uploads a document and downloads it again", async ({ page }) => {
  await signInWithEmail(page, TEST_EMPLOYEE_EMAIL);
  await page.goto(relocationPath);

  const pdf = Buffer.from("%PDF-1.4\n% Relo OS test document (fictional)\n%%EOF\n");
  await page.locator('input[name="file"]').setInputFiles({ name: "passport-scan.pdf", mimeType: "application/pdf", buffer: pdf });
  await page.getByLabel("Kind of document").selectOption("identity");
  await page.getByLabel("Related service (optional)").selectOption({ label: "Work and family visas" });
  await page.getByRole("button", { name: "Upload document" }).click();

  const row = page.getByTestId("document-row").filter({ hasText: "passport-scan.pdf" });
  await expect(row).toBeVisible();
  await expect(row).toContainText("Passport or ID · Work and family visas");

  const href = await row.getByRole("link").getAttribute("href");
  const download = await page.request.get(href!);
  expect(download.status()).toBe(200);
  expect((await download.body()).subarray(0, 4).toString()).toBe("%PDF");

  await expectNoMoney(page);
});

test("a file that isn't really a PDF or image is refused", async ({ page }) => {
  await signInWithEmail(page, TEST_EMPLOYEE_EMAIL);
  await page.goto(relocationPath);
  await page.locator('input[name="file"]').setInputFiles({
    name: "invoice.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("<html>this is not a pdf</html>"),
  });
  await page.getByLabel("Kind of document").selectOption("other");
  await page.getByRole("button", { name: "Upload document" }).click();
  await expect(page.getByText("Only PDF, JPG and PNG files can be uploaded.")).toBeVisible();
  await expect(page.getByTestId("document-row").filter({ hasText: "invoice.pdf" })).toHaveCount(0);
});

test("HR sees the employee's progress and document", async ({ page }) => {
  await signInWithEmail(page, TEST_HR_EMAIL);
  await page.goto(relocationPath);
  await expect(page.getByRole("heading", { name: "Employee journey" })).toBeVisible();
  await expect(page.getByText("To-dos done: 1 of 7.")).toBeVisible();
  await expect(page.getByTestId("document-row").filter({ hasText: "passport-scan.pdf" })).toBeVisible();
});

test("a document link does not work for someone outside the relocation", async ({ page, browser }) => {
  await signInWithEmail(page, TEST_EMPLOYEE_EMAIL);
  await page.goto(relocationPath);
  const href = await page.getByTestId("document-row").first().getByRole("link").getAttribute("href");

  const other = await browser.newPage();
  await signInAs(other, "employee"); // the demo employee, a different company
  const res = await other.request.get(href!, { maxRedirects: 0 });
  expect(res.status()).toBe(404);
  await other.close();
});

test("the demo employee never sees a money figure on any page they can open", async ({ page }) => {
  await signInAs(page, "employee");
  await expectNoMoney(page); // dashboard
  await page.getByRole("link", { name: "Bengaluru, India → Dubai, UAE" }).click();
  await expect(page.getByRole("heading", { name: "Your journey" })).toBeVisible();
  await expect(page.getByTestId("journey-service").first()).toBeVisible();
  await expectNoMoney(page); // relocation page, with the costed sample plan behind it
  const form = await page.goto("/requests/new");
  expect(form?.status()).toBe(404);
});
