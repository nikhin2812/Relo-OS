# Relo OS — pre-launch report (public preview, demo data)

*Prepared 24 September 2026 for the 21 October 2026 preview. Plain language, no jargon.*

## Short version
The app is safe to show with **made-up demo data**. It is **not ready for real
clients' data** yet — the list at the end says what that needs.

## What is secure, and how we know
- **Everyone sees only their own slice.** All 17 tables have database-level rules
  (row level security). RMC admin sees their RMC; consultant only relocations given to
  them; HR only their company; the employee only their own journey (never money); a
  vendor only its own work orders and invoices. **315 database checks** prove this, role by
  role, including a second made-up RMC that must stay invisible.
- **Nobody can change data directly.** Every change goes through a small number of
  checked database routines (create request, save plan, pick provider, approve, send work
  order, record/decide invoice, tick a to-do, register a document). Each one checks who is
  calling. Prices always come from the rate card; invoice matching happens in the database.
- **Only the app's server can save AI plans.** Each plan carries a signature made with a
  secret held only by the server and the database; hand-written, altered or old (10+ minute)
  plans are refused, whoever sends them.
- **People approve before money moves.** Flagged services need the RMC admin's approval
  before a work order goes out; flagged invoices need the admin's decision with a reason.
- **Provider links are safe.** Each link is 256-bit random, expires after 60 days, can be
  replaced, and only a scrambled form (hash) is stored. A wrong or expired link shows
  nothing. Providers never need an account.
- **Files are private.** Uploads are checked by their content (PDF/JPG/PNG only, 4 MB),
  stored privately and opened through one-minute links. Provider documents and invoices
  are hidden from employees (they can show prices).
- **No secrets in the code or browser.** No passwords or keys in the repository or its
  history; no master database key used anywhere; a build with planted fake secrets showed
  none reaching the browser. `npm audit`: 0 vulnerabilities.
- **Browser protections** on every page (content security policy, no embedding in other
  sites, login cookies unreadable by scripts). Public sign-up is switched off.
- **Tests:** 113 code tests, 50+ API tests, 47 browser tests — all running on GitHub on
  every change, against a **separate test database** ("Relo OS Test"), never the live demo.
  Plus 315 database checks run at each session.

## Security Advisor findings (Supabase)
- *Signed-in users can run 17 database routines; 4 portal routines work without signing
  in.* **Intended** — these are the checked routines above; each checks the caller or link.
- *Leaked password protection is off.* Needs a paid Supabase plan. **Open.**
- Everything else it raised during the build (a missing search-path setting) was fixed.

## Not production-ready yet (fine for a demo, not for real clients)
1. *(Fixed 23 Sep)* ~~HR could save a hand-written plan~~ — plans are now signed by the server.
2. *(Fixed 23 Sep)* ~~Tests ran against the demo database~~ — they now use "Relo OS Test".
   The old test-only RMC and its three test logins are still in the demo database; they can
   be removed once the new setup has run green for a while.
3. **No admin screens** to add users, vendors or rate cards, allocate consultants, or edit
   the policy — today these are loaded by script.
4. **Logins:** password only, no two-step login, no "forgot password", leaked-password
   check off. Demo accounts share one password, so anyone with it can change demo data
   (there's no one-click demo reset yet).
5. **Email and AI** are switched off until the keys are added (the app says so politely).
   The live AI planner has not yet been tested with a real key.
6. **Uploads** are limited to 4 MB and are not virus-scanned. A few small test files are
   left in storage after test runs (to tidy up).
7. **Hosting limits:** free Supabase projects pause after a week without use (the demo would
   go to sleep); Vercel's free plan is for non-commercial use; the free Supabase plan has
   limited backups. The flaky "HR creates a request" test step has recurred twice
   (passes on retry); it now reports what went wrong if it happens again.
8. **Scope** (by design for 21 Oct): one currency (₹), policy per RMC not per client, no
   billing, payments or real provider integrations.

## What a real client needs before real data goes in
- A **separate production Supabase project** on a paid plan with backups, in a region the
  client's contract allows (the current project is in Tokyo; Indian clients may require India).
- **Delete all demo and test accounts and data** from that project; create real accounts
  through a proper admin screen.
- **Two-step login** for RMC staff and HR, a password-reset flow, and leaked-password protection.
- A full **activity log** of who changed what.
- A **privacy policy, terms and data processing agreement** with each RMC (India's DPDP Act;
  GDPR if EU employees), plus rules for how long data is kept and how it is deleted.
- **Virus scanning** for uploads, **error monitoring and alerts**, and paid hosting plans.
- An **independent security review / penetration test** before the first client.

## Demo logins (all fictional)
| Role | Email | Password |
|---|---|---|
| RMC admin | admin@demo.relo-os.test | `Demo-edc82cc0b106!` |
| Consultant | consultant@demo.relo-os.test | same |
| HR | hr@demo.relo-os.test | same |
| Employee | employee@demo.relo-os.test | same |
| Vendor (Skyline Moves & Travel) | vendor@demo.relo-os.test | same |

Suggested demo path (≈2 min): HR → *Progress and budget* → the Bengaluru → Dubai relocation →
flights money trail with the **8%-over invoice flagged** → sign in as the employee to show the
journey with no money → the admin's approve/dispute buttons.
