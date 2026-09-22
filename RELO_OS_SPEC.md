# RELO OS — Build Spec v1 (21 October 2026 release)

## 1. Positioning

Relo OS is the operating layer above the relocation ecosystem. RMCs,
specialist providers and enterprise systems connect into it; an AI
layer decides what needs to happen, who does it, when, at what cost,
and whether it is within policy.

**Who buys it:** mid-tier regional RMCs. They run their clients'
relocations on Relo OS under their own branding, using their own
vendor network. Not the top-five RMCs, who will not switch.

**What it is not:** another employee relocation app, an AI chatbot, an
RMC that owns every service, or a manual marketplace.

## 2. Tenancy model

```
RMC tenant → client companies → assignments (relocations) → services
                                                          → work orders
                                                          → invoices
```

Every row belongs to exactly one RMC tenant. An RMC sees only its own
data. A client company sees only its own assignments. An employee sees
only their own relocation. A vendor sees only work orders sent to them.

## 3. Roles

| Role | Sees |
|---|---|
| `rmc_admin` | Everything inside their RMC tenant |
| `consultant` | Only assignments allocated to them |
| `hr_user` | Only their own company's assignments and budgets |
| `employee` | Only their own journey — no cost figures |
| `vendor` | Only work orders sent to them, and their own invoices |

## 4. Mobility object model

The common language of the platform. Build the schema around these:

`Employee → Assignment → Relocation → Service → Provider → Work Order →
Booking → Expense → Invoice → Payment → Outcome`

## 5. MVP scope — the ten things that must work

1. HR creates a relocation request (employee, family size, origin,
   destination, dates, budget).
2. AI generates the relocation plan: journey, milestones,
   dependencies, required services.
3. Services and estimated costs are generated from the plan.
4. Policy and approval requirements are shown against each service.
5. Provider or booking options are shown per service.
6. The employee sees one consolidated journey with tasks and dates.
7. Bookings and documents are stored in one place.
8. HR sees progress and committed budget.
9. One end-to-end transaction runs from request through to booking.
10. A sample invoice is matched back to relocation, service and budget.

Nothing else ships on 21 October.

## 6. The AI layer

One planning agent, called with the Anthropic API, that takes the HR
request plus the RMC's policy config and returns structured JSON:
services, sequence, dependencies, estimated cost per service, policy
flags, approval requirements. It writes into the same tables the UI
reads. It is not a chat window bolted onto a database.

A human always approves before a work order goes out. The AI proposes;
people confirm.

## 7. "Connectors" for this release

No live third-party APIs. A connector means:

- A work order emailed to a provider with a secure portal link.
- The provider updating status and uploading documents through that
  link, without needing an account.
- CSV import and export of assignments and costs.

Real API connectors come after the first paying RMC asks for one.

## 8. Reconciliation (the differentiator — build it properly)

Every financial event traces back: budget → committed cost → work
order → booking → invoice → variance. When an invoice arrives, the
system checks it against the agreed service, the agreed rate and the
remaining budget, and flags the difference. This is the piece the
market does badly and it should be visible in the demo.

## 9. Demo scenario (seed data)

One RMC tenant ("Demo Mobility Partners"), one client company, one
relocation: a family of three from Bengaluru to Dubai on 15 November,
budget ₹15 lakh. Services: immigration, flights, temporary housing,
household goods shipment, school search, settling-in. Three demo
vendors. One invoice that is 8% over the agreed rate, so the variance
flag is visible in the demo.

## 10. Definition of done for the release

- All ten MVP items work end to end with demo data.
- All Playwright tests pass in CI.
- Role access tests pass for all five roles.
- No high-severity findings in Supabase Security Advisor or npm audit.
- Deployed on a real domain with a login for demo accounts.
- A 2-minute screen recording of the full flow exists.
