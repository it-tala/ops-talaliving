# 01 — Architecture

> **Phase note.** Phase 1 builds the whole workflow as a frontend on demo
> data, deployed to Vercel — see ADR-009 below and `05-workplan.md`. Everything
> else in this document describes the **target** architecture that Phase 1 is
> built against: the demo layer implements the same service boundaries, the
> same contracts and the same refusal codes, so Phase 2 replaces a module
> rather than rewriting screens.

## The shape

```
                    dev-ops.talaliving.com  (Cloudflare tunnel)
                                 │
                        ┌────────┴────────┐
                        │   Next.js 14    │   one process, one deploy
                        │  ─────────────  │
   browser / phone ───▶ │  app/  (RSC+UI) │   the design system in this repo
                        │  api/v1/<svc>/  │   ← the seam
                        └────────┬────────┘
                                 │  each service = its own folder,
                                 │  its own schema, its own DB role,
                                 │  its own OpenAPI, no cross-imports
        ┌───────────┬────────────┼────────────┬───────────┐
     identity   procurement  accounting   documents    events
     core.*      procure.*      acct.*      docs.*      core.outbox
        └───────────┴────────────┴────────────┴───────────┘
                                 │
                         Supabase (new project)
                   Postgres + Auth + Storage + RLS
```

Eight services in v1 — the five below plus `hr` (D136), `production` (D148)
and `inventory` (D153). Each one is
addressed only through
`/api/v1/<service>/…`, configured by a per-service base URL, and reachable
from anything that speaks HTTP.

## ADR-001 — One Next.js process now, separable services

**Decision.** Build the services as strictly separated code and data, all
running inside one Next.js process today. Five at the time of this decision,
seven since `hr` (D136) and `production` (D148) — the count is not the point,
the separation is.

**Why not five processes today.** The whole system has to be driven from a
phone this week and then run on one office PC. Five containers means five
logs, five restarts, five things that can be half-up when the owner is not at
a keyboard. That cost buys nothing yet.

**Why separation is real anyway.** Each service has:

- its own folder `src/services/<name>/` — routes, service, repo, contracts
- its own Postgres schema and its own database role
- its own OpenAPI document at `/api/v1/<name>/openapi.json`
- **no imports from another service.** Only `src/services/_shared/`
- a base URL from env: `SERVICE_URL_ACCOUNTING`, default `/api/v1/accounting`

**The escape hatch, tested not assumed.** Moving `accounting` to its own host
is: deploy the folder, point `SERVICE_URL_ACCOUNTING` at it, grant its role.
Nothing else changes, because nothing else ever imported it. **A lint rule
enforces the no-cross-import boundary** (`eslint no-restricted-imports`),
added in M1 — a boundary nobody checks is a boundary that is already broken.

**Cost accepted.** Cross-service calls are in-process function calls behind
an HTTP-shaped interface today. That is a real difference from a network
call: no timeouts, no partial failure. Where a service crosses a boundary it
must go through the contract module, so the failure modes can be added later
without rewriting callers.

## ADR-002 — Enforcement lives in the database

**Decision.** RLS on every table, on every schema, from the migration that
creates it. The API calls Postgres **as the signed-in user**, not with a
service role. Permission checks are a SQL function, `core.has_permission()`.

**Why.** §9.3.9: `public` in `john-lau` has no RLS, and the web protects
screens rather than data. That was survivable while the only client was the
web app. We are about to publish an API, and the rekap says so itself: "if
there is ever a public API, RLS has to be the guard again."

**Consequence.** The frontend `can()` still hides menus (it is good
housekeeping), but it is not a guard, and we never rely on it. A request
that should be refused is refused by Postgres even if every layer above it
has a bug.

**The service role** is used only by system jobs (outbox delivery, integrity
audit, scheduled sweeps) and never in a request triggered by a user, and
never in anything with a `NEXT_PUBLIC_` name.

## ADR-003 — TypeScript everywhere

**Decision.** One language for API and UI. Types for the database are
generated (`supabase gen types typescript`), never hand-written.

**Why.** §9.3.6 is a list of the same fact maintained by hand in two or
three languages: accounts in nine copies, `UNITS` in Python and TypeScript,
`TOLERANCE 1000` in three places, three Indonesian number parsers that
behave differently. Every one of those is a two-language tax. `john-lau` has
to pay it because its money rules are in Python and its screens are in
TypeScript. A greenfield project does not.

**What we give up.** Reusing `john-lau`'s Python money code directly. We are
not reusing its schema either, so that reuse was mostly illusory — what we
reuse is its *rules*, and those are in `00-context.md`.

## ADR-004 — Cross-service data crosses through a published view or the API

**Decision.** A service may read another service's data in exactly two ways:

1. a **published view** the other service owns and grants — named `v_*_public`
2. its **HTTP API**

Never a direct read of another schema's tables. Never a join across service
tables inside a query the owning service did not write.

**The one place this bites in v1.** Payment coverage: procurement needs to
know how much money reached a PR line, and the money lives in accounting.

The seam: `acct.payment_allocations` is owned by accounting, holds a real FK
to `acct.transactions(id)`, and references the PR line by its **public id**
(`pr-26-09-10_01-L03`), validated at write time against procurement's API.
Accounting publishes `acct.v_allocations_public`. Procurement's coverage view
reads that view and nothing else.

If accounting ever moves out, the view is replaced by a nightly sync or a
call, and the integrity job (below) is what tells us if the two ever disagree.

**Integrity job.** A read-only check, run nightly and on demand, that walks
every cross-service reference and exits non-zero on a mismatch — the
descendant of `audit_integrity.py`, which §2.3 credits with keeping 2.852
ledger rows honest. It ships with the accounting service in Phase 2, not "later".

## ADR-005 — The database mints every identifier

**Decision.** `core.next_doc_number(prefix)` is the only source of
`trx-`, `pr-`, `po-`, `pay-`, `fund-` numbers.

```sql
insert into core.doc_numbers (prefix, day, seq) values ($1, $2, 1)
on conflict (prefix, day) do update set seq = core.doc_numbers.seq + 1
returning seq;
```

**Why.** §3.4 describes a reservation table, a collision loop of up to 200
attempts, and an open question #13 about who owns the number, because the
sheet and the database both had a claim. There is no sheet now. One writer,
one atomic statement, no loop.

**Office day.** The day in the number is the **WITA** office day
(`Asia/Makassar`), as today. All stored timestamps are `timestamptz`.

## ADR-006 — One write seam per money concept

**Decision.** Exactly one function may create a ledger transaction:
`acct.post_transaction()`. Exactly one may record coverage:
`acct.allocate_payment()`. They are the only grantees of INSERT on their
tables; everything else calls them.

**Why.** `pusher.post_ledger_row` is described in §3.4 as "the one write
seam", and it is the reason double-posting is impossible at the database
level. The three-step claim→append→confirm protocol existed because a
spreadsheet append could succeed after the claim and before the confirm.
**With no spreadsheet, that window closes: the whole post is one transaction.**
The `UNIQUE(source_ref)` claim stays — it is what makes a retry a no-op.

## ADR-007 — Attachments in object storage, referenced by id

**Decision.** Supabase Storage, one bucket, private. `core.attachments` holds
`storage_path`, `sha256`, `mime`, `bytes`, uploader, and source.
`core.attachment_links` links an attachment to any entity, with a `kind`
matching the four document types.

**Why.** §3.6: files are linked by file id and never by name, so renaming is
safe; and 674 evidence files are parked because a file supporting several
unrelated ledger rows cannot honestly be named after one of them. A link
table makes many-to-many the normal case instead of the parked one. Naming
becomes presentation, not identity.

**Deduplication is advisory.** An identical sha256 raises
`duplicate_suspect`; it never blocks (A6).

## ADR-008 — The outbox is the third-party seam, and Chat's way in

**Decision.** Every service writes domain events to `core.outbox`
(`service`, `event_type`, `payload`, `occurred_at`, `delivered_at`). A single
worker delivers them. Nothing calls an external system inline.

**Why.** This is what "re-attach and add connection to a third service later"
actually needs. A Google Chat bot, a WhatsApp notifier, an accounting export,
a Sheets mirror — each becomes a subscriber, and none of them can slow down
or fail a money write.

> **Narrowed by D288 (owner, 2026-09-23):** *google chat hanya dipakai untuk
> ingest chat + file upload dari channel dan notifikasi web app.* Chat carries
> material **in** and notifications **out**, and decides nothing. The "In, via
> the API" list below — approve, hold, reject, confirm receiving, acknowledge —
> is superseded; those stay on the web app. The "exception road" is no longer an
> exception but the ordinary way files arrive, through
> `POST /api/chat/events` → `ops_acct.file_evidence` (D289, `0038`).
>
> The original statement is kept below because the reasoning still holds for
> the half that survived, and because a decision quietly deleted is a decision
> somebody re-argues from scratch.

**Google Chat's role, stated** (owner, 2026-09-10). Chat is **notification,
confirmation, and the interface for people who do not have web access**. It is
no longer the intake door for evidence. Concretely:

- **Out, via the outbox**: a line needs your approval; a round is waiting to
  be closed; goods have been sitting unreceived for three days; a payment
  landed. These are what the bot exists to deliver, and the existing reader
  bot already has the connection.
- **In, via the API**: approve · hold · reject a line; confirm receiving with
  a photo; acknowledge. A field worker or a warehouse hand does these from
  their phone in Chat because they will never log into the web app.
- **The exception road only**: a context-free photo — bought first, no PR —
  still enters through Chat, because the person who bought it is exactly the
  person without web access. It lands in the exception inbox (ADR-010).

**What does not change: channel membership is not authorization.** A Chat
action is a real action, so the bot calls the same API a browser calls, as the
identified person, and permission is checked the same way. The rule the rekap
states — "AI proposes, never posts; otherwise chat channel membership becomes
the authorization boundary to the ledger" — survives intact, and gets sharper:
a *person* in Chat may act within their role, and the *bot* may not act at all.

**In Phase 1** the outbox is written to and has one subscriber: the audit view.
The bot is integrated later, by the owner's decision.

## ADR-010 — Evidence is attached from the record, never matched to it

**Decision.** The normal way a document enters the system is that somebody
opens the thing it belongs to — a PR line, a ledger row — and attaches it
there. The linkage is **declared at upload time**, because the person is
standing on the parent.

A context-free upload, where the document arrives first and its parent is
unknown, is the **exception road**: purchase-first-approval-later. It keeps
its own inbox and stays narrow.

**Why** (owner, 2026-09-10). Today every document is an orphan looking for a
parent. A photo lands in Chat with no context, an extraction guesses at a
vendor and an amount, and a human reconstructs the linkage afterwards from
name similarity and amount proximity. That is the "unordered" problem, and it
is why tracing is hard: nothing recorded *who decided* that this receipt
belongs to that line, only that someone once picked it off a list.

Reversing the direction removes the guess rather than improving it.

**What this deletes.** Most of §3.3's machinery exists only to support the
guess: slot naming for AI rows versus human rows, a candidate line picker
capped at 25, the rule that the selected line is *always* offered even when
it is not a candidate, the empty-candidate-list workaround that made a slot
vanish. None of it is needed when the parent is already known.

**What survives, because it is real and not an artefact of the guess:**

| The question | Old model | New model |
|---|---|---|
| Which PR does this belong to? | AI matches by name and amount; a human confirms from a capped list | answered by construction |
| Is it a supporting document for a transaction already booked? | the third button, added because Confirm double-books and Reject loses the evidence | answered by construction |
| **One document, many transactions?** | all-or-nothing across targets, or the file is parked as unnameable | real, and now first-class: attach from one, then "also covers…" adds the others. `attachment_links` is many-to-many from the first migration |
| **One PR line, many transactions?** | coverage over allocations | unchanged — two transfers settling one line already works |

**What it does to the AI.** Its job shrinks from classification to
verification. Attaching a receipt to a line means the vendor, the expected
amount and the line are already known, so the only question is whether the
document agrees with them. A disagreement is an **advisory warning** (A6),
never a block — the receipt total and the approved amount differing is
information, not an error.

**The health check.** The exception inbox should shrink as people learn to
attach from the record. If it does not, something is wrong with the normal
road and the inbox is being used to route around it. Unlike the old queue it
is never retired — buying first and approving later is a real thing that will
keep happening — but its size is a signal worth watching.

## ADR-009 — Phase 1 is a frontend on demo data, deployed from day one

**Decision.** Build the entire workflow — procurement and accounting, every
screen, every state transition — as a frontend running on demo data held in
the browser, deployed to Vercel on day one. No database, no backend, no
Supabase project until Phase 1 has been walked and signed off.

**Why.** The requirements and business rules were never specified up front.
That is the actual starting condition, and it is not fixed by designing a
schema harder. A schema written before the workflow is walked encodes guesses,
and guesses in a schema are expensive: they arrive with migrations, seeds and
backfills attached. A guess in a demo fixture costs one edit.

Walking a working screen is also the only way to get the people who do the
work to tell you what is missing. `john-lau` learned its rules from incidents;
this is the cheaper way to learn the same things.

**What we get.** A shareable URL on day one that updates on every push, and a
preview link per pull request — which is the entire review mechanism while the
owner is away from a computer. The schema stays free to change until D14.

**What it costs.** Nothing is persisted across browsers, and no real data can
be entered. Phase 1 is a specification you can click, not a system of record,
and every screen carries a marker saying so.

**How the cost is contained.** The demo layer is not a mock — it implements
`03-api.md` exactly: the same function signatures, the same `{data, meta}` /
`{error, meta}` envelope, the same 403 / 409 / 422 refusals, the same
idempotency behaviour, simulated latency. The rules live in `src/demo/derive.ts`
as real computations over real rows. Screens never reach around it. Phase 2
replaces `src/demo/api/*` with `fetch` and leaves everything above it alone.

**What Phase 1 produces besides the app.** `findings.md` — what each screen
taught us about the rules — and, on D14, a rewrite of `02-database.md` against
those findings. That document is the deliverable that makes Phase 2 short.

---

## What runs where

**Phase 1** runs entirely on Vercel: a Next.js app, no environment variables,
no secrets, no backend. The table below is Phase 2.

| Piece | Where | If the office PC is off |
|---|---|---|
| Next.js app + every service | Docker on the office PC, port 8092 | **down** |
| Postgres, Auth, Storage | Supabase (managed) | fine |
| `dev-ops.talaliving.com` | Cloudflare tunnel → office PC | down |
| Outbox worker, integrity job | same container, cron inside | down (catches up on restart) |
| `john-lau` capture + pipeline | untouched, Cloud Run | fine |

`ops.talaliving.com` (v1) stays on port 8091 and is not touched. Two apps,
two ports, two Supabase projects, no shared state. That is deliberate: it
means v2 can be wrong without costing anyone a day's accounting.

## Environments

| Env | Supabase project | URL |
|---|---|---|
| **Phase 1 demo** | none — data lives in the browser | Vercel, plus a preview URL per PR |
| local | the new dev project | `http://localhost:3000` |
| dev | the new dev project | `https://dev-ops.talaliving.com` |
| prod | a separate project, later | `ops.talaliving.com` when v2 replaces v1 |

Local and dev deliberately share one Supabase project for now — one project
to keep straight while working from a phone. The moment real money is
entered, dev gets its own and this line changes.

## Repository layout (target)

```
src/
  app/                      # unchanged: shell, design system, routes
    api/v1/
      identity/[...route]/route.ts
      procurement/[...route]/route.ts
      accounting/[...route]/route.ts
      documents/[...route]/route.ts
      events/[...route]/route.ts
  demo/                     # PHASE 1: fixtures, store, derive, api/ per service
  services/
    _shared/                # envelope, errors, auth context, audit, idempotency
    identity/               # contracts.ts now; routes/service/repo in Phase 2
    procurement/
    accounting/
    documents/
    events/
  components/               # unchanged
  lib/                      # unchanged + db/ (generated types, clients)
supabase/
  migrations/               # every table ships with its RLS here
  seed.sql
docs/plan/                  # this
```
