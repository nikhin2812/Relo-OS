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

## Next
- Session 2: HR relocation request + AI plan (MVP items 1 and 2).

## Known issues / to do
- The cloud workspace's network blocks Supabase, so login tests only run in GitHub
  Actions (repo secrets are set). CI is green as of commit after 0951f55.
- Supabase Security Advisor: "Leaked password protection disabled" (warning). Turn on in
  Supabase → Authentication → Settings before launch (may need a paid plan).
- Turn off public sign-ups in Supabase → Authentication → Sign In / Providers
  (accounts are created by the RMC, not self-registered). A self-registered user
  currently gets no profile and therefore sees nothing, but should not exist at all.
