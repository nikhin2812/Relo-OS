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

## Next
- Session 6: reconciliation — invoice matched to relocation, service and budget (MVP item 10).

## Known issues / to do
- **Waiting on owner:** `ANTHROPIC_API_KEY` GitHub secret (enables the live AI check in CI)
  and later in Vercel (Session 7). Until then "Generate plan" in the real app shows
  "AI planning isn't switched on yet" and keeps the request.
- Security Advisor also lists the three `portal_*` functions as callable without signing in.
  Intended: they are the account-free provider portal and each one checks the link.
- Real email needs a Resend account: add `RESEND_API_KEY` and `EMAIL_FROM` (Session 7).
- Security Advisor warns that signed-in users can run several database functions
  (`create_relocation_request`, `save_relocation_plan`, `record_plan_failure`,
  `reset_test_tenant_data`, `select_service_provider`, `set_journey_task_done`,
  `journey_services`, `register_document`). Intended: they are the only write paths and each checks the
  caller; the database tests prove it.
- `save_relocation_plan` is callable by HR directly through the API, so a technically skilled
  HR user could submit a hand-written plan for their own company's relocation (not anyone
  else's). Before real clients: move plan saving behind a server-only key.
- Leaked password protection needs a paid Supabase plan — deferred by owner.
- Uploads are capped at 4 MB because they pass through the app (Vercel's request limit).
  Larger files would need direct-to-storage uploads.
- Files uploaded by automated tests stay in storage after the test RMC is cleared (their
  database records are removed). Small; tidy up before launch.
- The cloud workspace's network blocks Supabase, so login tests only run in GitHub
  Actions (repo secrets are set). CI is green as of commit after 0951f55.
- Public sign-ups turned off by owner (23 Sep).
