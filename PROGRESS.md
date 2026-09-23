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

## Next
- Session 3: services, policy and providers (MVP items 3, 4, 5).

## Known issues / to do
- **Waiting on owner:** `ANTHROPIC_API_KEY` GitHub secret (enables the live AI check in CI)
  and later in Vercel (Session 7). Until then "Generate plan" in the real app shows
  "AI planning isn't switched on yet" and keeps the request.
- Security Advisor warns that signed-in users can run 4 database functions
  (`create_relocation_request`, `save_relocation_plan`, `record_plan_failure`,
  `reset_test_tenant_data`). Intended: they are the only write paths and each checks the
  caller; the database tests prove it.
- `save_relocation_plan` is callable by HR directly through the API, so a technically skilled
  HR user could submit a hand-written plan for their own company's relocation (not anyone
  else's). Before real clients: move plan saving behind a server-only key.
- Leaked password protection needs a paid Supabase plan — deferred by owner.
- The cloud workspace's network blocks Supabase, so login tests only run in GitHub
  Actions (repo secrets are set). CI is green as of commit after 0951f55.
- Public sign-ups turned off by owner (23 Sep).
