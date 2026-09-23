# Relo OS — progress

## Done

### Session 1 — Foundation (22 Sep 2026)
- Next.js 16 + TypeScript + Tailwind, with shadcn/ui components (button, input, label, card).
- Supabase project "Relo OS" (`kevwftukmiwpekbuoera`) connected.
- Database tables: `rmc_tenants`, `client_companies`, `profiles` (one role per user),
  `assignments`, `assignment_budgets`, `assignment_consultants`.
  Budgets live in their own table so employees and vendors can never read them.
- Row level security on every table. App users can only read, and only their own rows;
  logged-out visitors can read nothing. Writes arrive with the features that need them.
- Email + password login, role-aware home page (`/dashboard`), sign out.
- Demo data (spec section 9): Demo Mobility Partners, Fictional Tech Pvt Ltd (Demo),
  family of 3 Bengaluru → Dubai on 15 Nov 2026, budget ₹15,00,000, one login per role.
- Tests:
  - `supabase/tests/rls_role_access.sql` — 50 database checks across all 5 roles plus a
    second RMC and logged-out visitors. **All 50 pass** (run against the live project).
  - `tests/unit` — 11 unit tests. **All pass.**
  - `tests/integration/role-access.test.ts` — same role checks through the real API. **Pass in CI.**
  - `tests/e2e` — Playwright: login, wrong password, logged-out redirect, each role's screen,
    employee/vendor see no ₹ figures, sign out. **All 8 pass in CI.**
- GitHub Actions (`.github/workflows/ci.yml`): lint, types, unit + role tests, `npm audit`,
  then Playwright.

### Session 2 — Relocation request and AI plan (23 Sep 2026)
- New tables (RLS on all): `rmc_policies`, `relocation_plans`, `plan_services`,
  `plan_milestones`. Costs, policy and plan status are visible only to the RMC admin, the
  allocated consultant and HR at the client company. Employees see their own milestones only.
- Write paths are three checked database functions: `create_relocation_request` (HR only,
  always into HR's own company), `save_relocation_plan` (all-or-nothing, never overwrites a
  ready plan), `record_plan_failure`. Plus `reset_test_tenant_data`, which only works inside
  the "Automated Test RMC" (a separate test-only tenant; the demo is never touched by tests).
- HR form at `/requests/new`; plan page at `/assignments/[id]` with steps, dependencies,
  dates, cost per service, policy badge, "Needs approval", totals against budget, milestones.
- AI planner (`src/lib/planner/`): Claude Opus 5 via the Anthropic SDK with structured output
  and automatic refusal fallback. Model can be changed with `PLANNER_MODEL`. Every answer is
  checked (JSON shape, dates, costs, dependency order) before saving, and policy caps are
  re-checked in code. Failures keep the request and show a "Try again" button.
- Demo policy for Demo Mobility Partners (caps per service, 30-day housing limit).
- Tests: 112 database checks (all pass), 50 unit tests (all pass), API role tests for all new
  tables, Playwright flow tests (request → plan, failure → retry, validation, HR-only form,
  employee sees no costs). Browser tests use a stand-in planner (`PLANNER_MODE=mock`).
- CI green on GitHub (all unit, API role and 13 Playwright tests). Live AI check skipped
  until the `ANTHROPIC_API_KEY` secret is added.

### Session 3 — Services, policy and providers (23 Sep 2026)
- New tables (RLS on both): `vendors` (the RMC's vendor network) and `vendor_rates` (agreed
  rate per vendor per service type, per family or per person). Vendor logins are linked to
  their vendor company (`profiles.vendor_id`).
- Who sees what: RMC admin and consultants see the network and rate cards; HR sees only the
  names of vendors chosen for its own relocations and never rate cards; vendors see only their
  own company; employees see none of it.
- `plan_services` now stores the chosen provider, the agreed cost and whether that cost is
  above the policy cap. Written only through `select_service_provider` (RMC admin or allocated
  consultant; price always comes from the rate card, never from the caller).
- Plan page: per-service provider picker (cheapest first, "over policy cap" marked), chosen
  provider and agreed cost, totals now show estimate, committed and forecast remaining.
- Demo data: three fictional vendors (Falcon Relocation Services, Skyline Moves & Travel,
  Palm Stay Apartments) with rates; demo vendor login = Skyline. The demo relocation has the
  fixed sample plan (labelled "Sample plan") so providers can be picked before the AI key is in.
- Tests: 139 database checks (all pass), 61 unit tests (all pass), API role tests for vendors
  and rate cards, Playwright provider-picking flow in the test-only RMC. CI green (18 browser
  tests). Fixed on the way: form ID check rejected the demo's fixed IDs.

### Session 4 — Employee journey and documents (23 Sep 2026)
- New tables (RLS on both): `journey_tasks` (employee to-dos, created automatically from the
  plan's services) and `documents`. New private storage bucket `relocation-documents`
  (PDF/JPG/PNG, 4 MB max) with storage policies: only the employee, RMC admin, allocated
  consultant and HR at that company can read or upload a relocation's files.
- `journey_services()` gives the journey's services with dates and provider name only — no
  cost, rate, policy or approval fields. Employees still cannot read `plan_services`.
- `set_journey_task_done()` and `register_document()` are the write paths (caller checked;
  a document can only be registered by the person who uploaded that file, under that relocation).
- Relocation page: "Your journey" timeline (services, key dates, to-dos in date order, overdue
  marked, progress count) and a Documents section (upload, list, download via one-minute link).
- HR request form: optional "Employee's login email" links the relocation to the employee
  (must be an employee at HR's own company).
- Upload checks decide the file type from its content, not its name; names are cleaned.
- Tests: 185 database checks (all pass), 78 unit tests (all pass), API tests for the journey
  and file access, Playwright journey/document flow and a strict "employee never sees money"
  test (visible text and page data) for both the test employee and the demo employee.
- CI green (26 browser tests, no retries). Fixed on the way: a brief clock difference between
  Supabase's login and database servers ("JWT issued at future") made one API test flaky, and
  the request-and-plan step now has 15 s in browser tests.

### Session 5 — Work orders, provider portal, HR progress and budget, CSV (23 Sep 2026)
- Approvals: services the plan flagged, or whose agreed price is over the policy cap, need the
  RMC admin to click "Approve" before a work order can go out. Changing provider clears it.
- New tables (RLS on both): `work_orders` (one live order per service; details copied at send
  time; the link's SHA-256 hash is stored, never the link, and no user can read the hash
  column) and `work_order_events` (audit trail).
- Provider portal `/portal/<link>`: no account. The provider sees only that job and its agreed
  price, can accept, decline, book (reference + date), complete, and upload documents. Every
  action goes through `portal_*` database functions that check the link (60-day expiry).
  Portal uploads live in a separate folder only RMC staff and HR can open; employees never see
  them (a booking confirmation may show prices).
- Email: sent through Resend when `RESEND_API_KEY` and `EMAIL_FROM` are set; otherwise (and
  always for the demo's made-up .test vendor addresses) the link is shown once on screen.
  "New provider link" issues a fresh link and kills the old one.
- The employee's journey shows "Being arranged / Confirmed / Booked · ref … / Done", no prices.
- HR "Progress and budget" page (`/overview`): per relocation — services booked, to-dos done,
  approvals waiting, budget, committed (live work orders), forecast remaining — plus totals.
- CSV export (`/exports/relocations`, one row per service, spreadsheet-formula safe) and CSV
  import for HR (`/requests/import`, up to 200 rows, each checked like the form).
- The logged-in vendor sees a list of the work orders sent to its company.
- Tests: `supabase/tests/work_orders_access.sql` (69 checks, all pass) alongside the earlier
  185; 97 unit tests; API tests for work orders and the portal; Playwright end-to-end
  transaction test (request → plan → provider → approval → work order → portal booking →
  employee sees "Booked" → HR overview → CSV export/import).
- CI green (36 browser tests, no retries). Fixed on the way: the growing browser suite hit
  Supabase's sign-in limit (~30 per 5 minutes), so each test user now signs in once per run
  and tests reuse that session; sign-out now ends only the current browser's session; the
  one-time work order link now stays on screen after the page refreshes; a test's expected
  figure was mis-added. Security Advisor: fixed a missing search_path on a new helper.

### Session 6 — Reconciliation (24 Sep 2026)
- New table `invoices` (RLS): each invoice is tied to a work order, and through it to the
  service, the relocation and the budget. Nobody can write it directly.
- Matching happens in the database the moment an invoice arrives (`private.record_invoice`):
  - price: everything invoiced on the work order (not disputed) against the agreed price;
    flagged when more than the RMC's tolerance over (`invoice_tolerance_pct`, demo 2%)
  - budget: what's left once this invoice counts (invoices where they exist, otherwise the
    agreed price of live work orders); flagged when the relocation would go over
  - duplicate invoice numbers from the same vendor are flagged
  - only booked or completed work can be invoiced
  The result (agreed, invoiced to date, difference ₹ and %, tolerance, budget left, flags) is
  stored with the invoice.
- Ways in: the provider sends the invoice with its PDF through the work order link
  (`portal_submit_invoice`), or RMC staff record one that arrived by email (`record_invoice`).
- Decisions: only the RMC admin can Approve anyway or Dispute a flagged invoice, and must add
  a note; decisions go into the work order history. Disputed invoices stop counting.
- Money trail on every service: Estimate → Agreed → Work order → Booking → Invoiced →
  Difference. Totals: Invoiced, Difference vs agreed, Invoices to review. HR's overview and
  the CSV export include invoices and the difference. The vendor sees its own invoices
  ("Under review" rather than internal reasons); the employee sees none.
- Demo data (spec section 9): flights and the shipment booked with Skyline; shipment invoice
  INV-SKY-2292 matches; flights invoice INV-SKY-2291 is ₹1,16,640 against ₹1,08,000 — 8% over,
  flagged.
- Tests: `supabase/tests/invoices_access.sql` (48 checks, all pass); 108 unit tests; API tests
  for invoices; Playwright: demo flag check, and in the test RMC the provider invoices 8% over
  → flagged → admin disputes with a note → corrected invoice matches → staff record an emailed
  invoice inside the tolerance → HR overview and CSV.
- CI green (44 browser tests). Fixed on the way: the flag list in the matching function was
  built wrongly (caught while loading the demo; fixed in a follow-up migration); tests updated
  for the demo vendor now having work orders and the portal's second upload box. One browser
  step ("HR creates a request") has passed only on retry twice across all runs; it now reports
  the page state if it fails again so the cause can be found.

### Session 7 — Pre-launch pass (23 Sep 2026)
- `npm audit`: 0 vulnerabilities. Supabase Security Advisor: only the intended warnings
  (portal functions callable without an account; checked write functions for signed-in
  users; leaked password protection needs a paid plan).
- Database checks re-run against the live database: 185 + 69 + 48 = **302, all pass**.
  CI green: unit, API and 47 browser tests.
- Secret scan of the code and the full git history: clean. A test build with fake "canary"
  secrets confirmed no server-only key ends up in the browser bundle.
- Hardening: security headers on every page (no framing, no sniffing, strict referrer,
  HTTPS-only, a content security policy in production); login cookies are httpOnly,
  SameSite=Lax and Secure in production; the site refuses to build links without
  `NEXT_PUBLIC_APP_URL` on Vercel. Browser test `security.spec.ts` checks these.
- `vercel.json` pins the server region to Tokyo (next to the database). `DEPLOY.md` has the
  click-by-click Vercel steps. `LAUNCH_REPORT.md` is the plain-language launch report with
  the demo logins.

### Session 7b — Plan signing and a separate test database (23 Sep 2026)
- **Plan signing** (migration `20260925000001_plan_signing.sql`): `save_relocation_plan` now
  takes the plan as text plus a timestamp and an HMAC-SHA256 signature. The secret lives in
  `private.plan_signing_key` (no user can read it) and in the server's `PLAN_SIGNING_SECRET`.
  Unsigned, altered or 10+ minute-old plans are refused with "not allowed". The owner makes
  the secret with `select private.new_plan_signing_secret();` in the SQL editor.
  Code: `src/lib/planner/signing.ts`; `generate.ts` signs before saving and records a clear
  failure if the secret is missing.
- **Separate test database**: new Supabase project **Relo OS Test** (`ueztyqcsztfcvavnrbst`,
  Tokyo) with all 9 migrations and the same demo + test seed. ARRIVO was paused (owner's
  choice) to stay within the free plan's 2 active projects. CI refuses to run against the
  live demo database.
- Tests: role checks 185 → 198 (unsigned/altered/old plans refused; no role can read or
  make the signing secret). All 315 database checks pass on the test database; 185-check
  suite's plan checks updated. 113 unit tests (5 new for signing); API test: every role's
  hand-written plan refused, and an old real signature refused.

## Next
- Owner: GitHub secrets → point CI at Relo OS Test and add `PLAN_SIGNING_SECRET` (see chat).
- Owner: deploy on Vercel with DEPLOY.md (now includes the signing secret step), send the URL.
- Later: remove the old test-only RMC and its three test logins from the demo database.

## Known issues / to do
- **Waiting on owner:** `ANTHROPIC_API_KEY` GitHub secret (enables the live AI check in CI)
  and later in Vercel (Session 7). Until then "Generate plan" in the real app shows
  "AI planning isn't switched on yet" and keeps the request.
- Security Advisor also lists the four `portal_*` functions as callable without signing in.
  Intended: they are the account-free provider portal and each one checks the link.
- Real email needs a Resend account: add `RESEND_API_KEY` and `EMAIL_FROM` (Session 7).
- Security Advisor warns that signed-in users can run several database functions
  (`create_relocation_request`, `save_relocation_plan`, `record_plan_failure`,
  `reset_test_tenant_data`, `select_service_provider`, `set_journey_task_done`,
  `journey_services`, `register_document`). Intended: they are the only write paths and each checks the
  caller; the database tests prove it.
- Leaked password protection needs a paid Supabase plan — deferred by owner.
- Uploads are capped at 4 MB because they pass through the app (Vercel's request limit).
  Larger files would need direct-to-storage uploads.
- Files uploaded by automated tests stay in storage after the test RMC is cleared (their
  database records are removed). Small; tidy up before launch.
- The cloud workspace's network blocks Supabase, so login tests only run in GitHub
  Actions, now against the Relo OS Test project.
- Public sign-ups turned off by owner (23 Sep).

- Demo invoice INV-SKY-2291 is meant to stay "Flagged" for the demo recording. Approving or
  disputing it in the demo changes that (the tests allow for it, but the recording won't show
  the review buttons).
