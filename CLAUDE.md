# CLAUDE.md — Relo OS project rules

Read this file and `RELO_OS_SPEC.md` at the start of every session.
Build only what the spec allows. If a request falls outside the MVP
scope list, say so and ask before building it.

## What this project is

Relo OS is a mobility operating layer that relocation management
companies (RMCs) run their clients' relocations on. It is not an RMC,
not a chatbot, not a marketplace. The first customer is a mid-tier RMC,
not an enterprise HR team.

Launch target: **21 October 2026**, as a public preview with demo data.

## Stack (do not change without asking)

- Next.js (App Router) + TypeScript
- Supabase — Postgres, Auth, Row Level Security, Storage
- Tailwind CSS + shadcn/ui
- Vercel for hosting
- Anthropic API for the AI planning layer
- Playwright for end-to-end tests, Vitest for unit tests
- GitHub Actions for CI

## How I work with you

The owner is not a developer and will not test by hand. That means:

1. **You write the tests.** Every feature ships with Playwright tests
   that click through it as a real user would, plus unit tests for any
   business logic (policy checks, cost maths, budget totals).
2. **You run the tests** before telling me a feature is done. Never
   report something as working if you have not seen it pass.
3. **Every role gets an access test.** For each new table, write tests
   proving that each role sees only its own rows: rmc_admin,
   consultant, hr_user, employee, vendor.
4. **You fix your own failures.** If CI is red, fix it before starting
   the next task.
5. **Explain in plain language.** No jargon in your summaries. Tell me
   what changed, what I should click to see it, and what is still
   missing.

## Security rules (non-negotiable)

- RLS enabled on every table. No table ships without policies.
- No secrets in the repo. Use environment variables only.
- No service-role key in any client-side code.
- Validate every input server-side, not just in the browser.
- No real personal data ever. Demo data only, clearly fake names.
- Run `npm audit` and the Supabase Security Advisor before each deploy
  and report anything it finds.
- Before any destructive migration, tell me first and wait.

## Working style

- Small commits, one feature at a time.
- Before starting a task, state your plan in 3–5 bullets and wait for
  a yes if the task touches the schema or auth.
- Keep `PROGRESS.md` updated: what is done, what is next, known issues.
- Use Sonnet for routine work; the owner is on a limited plan, so do
  not re-read the whole codebase when a targeted search will do.

## Out of scope for the 21 Oct release

Do not build these even if they seem useful: consolidated client
billing, margin concealment, gross-up or tax engines, employee expense
claims, multi-currency, chart of accounts, real provider API
integrations, mobile apps, payment processing.
