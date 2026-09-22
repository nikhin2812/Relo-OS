# Relo OS

The mobility operating layer relocation management companies run their clients' relocations on.
See `RELO_OS_SPEC.md` for scope and `PROGRESS.md` for status.

## Run locally

1. `cp .env.example .env.local` and fill in the values.
2. `npm install`
3. `npm run dev` → http://localhost:3000

## Database

- Schema: `supabase/migrations/`
- Demo data: `DEMO_PASSWORD=... node scripts/render-seed.mjs | psql "$DATABASE_URL"`
- Database role tests: run `supabase/tests/rls_role_access.sql`; every row must show `pass = true`.

## Tests

- `npm test` — unit tests and role access tests (needs `.env.local`)
- `npm run test:e2e` — Playwright end-to-end tests
