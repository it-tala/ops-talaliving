# 00 — What we carry over, and what we deliberately drop

Source: `Rekap Aturan Bisnis & Workflow — John Lau + ops.talaliving.com`
(2026-09-09), sections cited as §. That document is a mirror of the running
system; this file is the decision about which parts survive into ops v2.

---

## A. Rules that bind (carried over whole)

These were paid for with real incidents. They are not up for redesign.

| # | Rule | Where it must live in v2 |
|---|---|---|
| A1 | **Approval ≠ payment. Money ≠ goods. PO ≠ approval of its money.** Never collapsed, on any screen (§2.2, §9.4) | separate tables, separate axes, separate screens |
| A2 | **Append-only + supersession.** Approvals, allocations, receipts, stock moves are never mutated or deleted; corrections are new rows with `superseded_by` (§2.2) | table design + `REVOKE DELETE` |
| A3 | **Derived state is a VIEW, never a stored column.** Balance, coverage, line status, PO status (§2.2, §3.8) | `v_*` views |
| A4 | **Idempotency by UNIQUE claim.** Double delivery, replay, double click = no-op. Never a blind insert (§2.1 r1, §3.4) | `UNIQUE(source_ref)`, `UNIQUE(idempotency_key)` |
| A5 | **Corrections are VOID, never DELETE.** Amount → 0 plus a reason; the row stays (§2.1 r8) | `status='VOID'` + `void_reason`, DELETE not granted |
| A6 | **Warn, do not block**, on duplicates, receipt-total mismatches, similar transactions. "A second identical payment to the same vendor really can happen; refusing it automatically hides the legitimate one" (§2.2) | advisory banners, never a hard stop |
| A7 | **Refusal must be visible.** Explicit outcome (`refused`/`duplicate`/`done`), real status codes 403/409/422, never a button that reports success it did not perform (§2.2) | API envelope + toast |
| A8 | **Money can only shrink through approval.** approved ≤ requested; excess is never written (§3.8, §6.1) | CHECK constraint |
| A9 | **A transaction never funds more than it moved.** `Σ allocations ≤ transaction amount` (§3.8) | CHECK / trigger |
| A10 | **`paid` means the money exists**, not that a stamp points at it. Round TRANSFERRED ≠ vendor paid (§3.8) | coverage view over real allocation rows |
| A11 | **COMPLETED means the full chain exists**: request + approval + round + payment proof + receiving report with photos. Missing a piece → not COMPLETED. This is the anti-fraud line (§3.8 US-7.2) | status view predicate |
| A12 | **Short settlement is a named human decision** with a mandatory reason, never a silent tolerance (§3.8) | `settlements` table with `reason NOT NULL` |
| A13 | **Every action carries a verified identity** (§6.1) | `actor_id` from session, on every write, in audit |
| A14 | **Bank charges are never coverage** — their own ledger row (§3.8) | transaction type flag |
| A15 | **Secrets only in the secret store → env var.** Never in the repo (§2.1 r4) | `.env.example` with names only |
| A16 | **Nothing is silently discarded.** Broken input is quarantined, unknown documents are shown with an explicit "ignore" button (§2.1 r6, §3.13) | quarantine table + review surface |
| A17 | **Vendor credit is never netted silently** — refunded or applied, explicitly (§3.8) | `vendor_credits` |
| A18 | **A problem delivery never auto-closes.** WRONG ITEM / RETURN TO SENDER leave the line open and notify (§3.8) | receiving condition rules |

## B. Vocabulary carried verbatim

Copied from §7. These strings are data. Do not translate, re-spell, or
"tidy" them — including `RECCURING` with the doubled C.

- **Accounts** (§3.4): `PETTY CASH` · `BNI 325` · `BCA 271` · `BCA 064` ·
  `BCA USD 081`. Custody: accounting holds the first three (these pay
  vendors); leadership holds `BCA 064` and `BCA USD 081` (these never pay a
  vendor directly and enter only via uploaded statements).
- **Transaction types** (13): `RECCURING - UTILITIES` · `CREDIT CARD` ·
  `PREPAID VENDOR` · `SUPPLIERS` · `BANK CHARGES` · `ONLINE` · `CHINA` ·
  `RECCURING - PAYROLL` · `CASHFLOW` · `OTHERS` · `PRODUCTION` · `OFFICE` ·
  `WAREHOUSE`. (`EJO` exists in data and is unclassified — open question.)
- **Line status ladder** (view, 8 values, owner 2026-09-11): `DRAFT` ·
  `WAITING FOR APPROVAL` · `APPROVED` · ~~`WAITING FOR PAYMENT`~~ (merged into
  `APPROVED` on D126 — it claimed the cash was reserved for that line, and it
  never was) · `PAID` ·
  `PARTIAL` · `COMPLETED` · `REMOVED`.
  `HELD` and `REJECTED` are gone, and nothing is lost by it: an unchecked line
  stays in the queue exactly as `HELD` did, and a line nobody wants is
  **removed** rather than rejected — softly, with a name and a timestamp, and
  it can never be paid. The middle state existed only because the spreadsheet
  had both a checkbox *and* a status column.
- **Payment round**: `OPEN` → `APPROVED` → `TRANSFERRED` → `CLOSED`.
  Only `CLOSED` settles.
- **PO**: `DRAFT` · `ISSUED` · `CLOSED` · `CANCELLED`; two independent axes
  `payment_state` (`UNPAID`/`PARTIAL`/`SETTLED`) and `delivery_state`
  (`PENDING`/`PARTIAL`/`COMPLETE`).
- **Receiving conditions** (7): `GOOD` · `DAMAGED` · `PARTIALLY DAMAGED` ·
  `MISSING PARTS` · `WRONG ITEM` · `RETURN TO SENDER` ·
  `WAITING FOR CONFIRMATION`. Only `GOOD` and the received part of
  `PARTIALLY DAMAGED` count toward completion.
- **Document types** (4): `Receipt / Invoice / Nota` · `Payment Proof` ·
  `Receiving Item` · `Others`. `Others` never touches the ledger.
- **Review queue**: `PENDING` · `CONFIRMED` · `ATTACHED` · `REJECTED` ·
  `CANCELLED` · `NOTED`. `CONFIRMED` means this row *produced* a transaction;
  `ATTACHED` means it hangs on one that already existed.
- **Approval**: step `GOODS` (CEO) · `FUNDS` (finance) — **the IT gate is
  gone**. The decision is a **checkbox**, not a vocabulary: approved or not
  yet (owner, 2026-09-11). Every toggle is an append-only row carrying the
  metadata the owner named — **timestamp, name, email** — plus `channel`
  (`web` · `chat` · `api`).
- **Units** (18): pcs · buah · kg · gr · meter · m2 · m3 · cm · sak · box ·
  roll · set · pack · ltr · lembar · batang · unit · lusin.
- **Id formats** (§7.2): `trx-YY-MM-DD_NNN` · `pr-YY-MM-DD_NN` ·
  `fund-YY-MM-DD_NN` · `<doc>-LNN` · `pay-YY-MM-DD_NN` · `po-YY-MM-DD_NN`
  (+ `-LNN` line, `-ANN` amendment, `-MNN` schedule term, `-vN` document
  version). **In v2 all of these are minted by Postgres, always.**
- **Tolerances**: Rp1.000 for payment coverage; 0 for statement balancing;
  0,01 for approval asymmetry. One definition each, in `core.settings`.

## C. The eleven things we deliberately do differently

Each fixes a specific finding in §9.3. This table is the answer to "improve
what already exists".

| # | john-lau today | ops v2 | Why |
|---|---|---|---|
| D1 | Sheet geometry mirrored in 11 schema places (`sheet_ref` A1 notation, `sheet_row`, `sheet_gid`, `accounts.sheet_balance_column` whose NULL changes runtime behaviour) | **No spreadsheet concept in the schema at all.** Sheets become a one-way export, generated from the database, never read back | §9.3.1 — a column named after a spreadsheet header is a column another app cannot understand |
| D2 | Status values live only in SQL comments; 10 columns have no CHECK | **Postgres ENUM types**, and TypeScript types generated from the database | §9.3.2 — one definition, a mirror that cannot drift |
| D3 | Reference lists hand-copied across Python/TypeScript/Sheets (accounts in nine copies, `UNITS`, `TOLERANCE` in three places, two number parsers with different behaviour) | **One language (TypeScript), one place per list, generated types** | §9.3.6 |
| D4 | Vendor is free text in every table; no FK to `vendors`. Same for account, item, project | **Real foreign keys**, plus a `*_name_at_time` snapshot column where history must not move when a name is later corrected | §9.3.3 |
| D5 | `public` has zero RLS; until 2026-08-26 the anon key could write the entire approval chain in production. Web protects *screens*, not *data* | **RLS on every table in the same migration that creates it.** Permissions checked in the database via `core.has_permission()`. The API uses the caller's session, not a service role | §9.3.9 — "if there is ever a public API, RLS has to be the guard again". There is now going to be a public API |
| D6 | Four status ladders for one PR line (canonical view, stored projection, a Python function, a sheet painter with 11 differing strings) plus a fifth in `ops.doc_lines` | **One ladder, one view.** Everything else reads it | §9.3.4 |
| D7 | Two parallel universes for the same chain: `public.pr_*` and `ops.*`; three settlement tables; six audit trails | **One store per concept.** One audit log | §9.3.5 |
| D8 | Structured data hidden in JSON/arrays/comma-separated text (`approver_ids`, `attached_trx_id`, `interpretations.output.rows` as the only home for statement lines) | **Rows and columns.** JSONB only for genuinely open payloads (raw capture, audit before/after) | §9.3.7 |
| D9 | The spreadsheet owns the balance; row order defines the balance; two writers per row reconcile every 5 minutes | **The database owns every number.** A balance is a view. This is the owner's own 2026-08-28 direction, now with no legacy to reverse | §9.3.8, §9.4 |
| D10 | Zero triggers or functions in `public`; every money rule lives in a client | **Money rules in Postgres** — constraints, views, and a small number of `SECURITY INVOKER` functions | §9.3.10 |
| D11 | No API of its own; web renders straight from PostgREST, and writing money means calling a Python bridge on the office PC | **A versioned REST API per service**, so a third system attaches to a contract instead of to the schema | the owner's question that started this: "the database would be easier to connect to another application" |

## D. What was already right and stays

From §9.3.12, the rekap's own list of what deserves to survive:

- views as derived status; UNIQUE as idempotency; append-only + supersession
- `evidence.py`'s idea: **one path from money to document** — transaction →
  allocation → PR line → PO, so a receiving photo reaches every ledger row
  that funded its line
- `Loaded<T>` — a load failure carried as a value with a visible source badge,
  never a blank screen pretending to be an empty list
- the activity recorder wrapper around writes
- atomic decision functions exposed as RPC
- id generation with collisions resolved by the database
- "one write seam" — exactly one function may post to the ledger

## E. Doors, and what v2 does about them

`john-lau` has three doors: Google Chat, web, spreadsheet (§1.3), bound by
"one fact, two doors" — an approval from the web writes the same row as an
approval from a Chat card, differing only in `channel`.

**v2 keeps the principle and gives each door a job** (owner, 2026-09-10).
The spreadsheet is an export and stops being a door at all. The other two
split by what they are actually good at:

| Door | What it is for |
|---|---|
| **Web** | the record. Evidence is attached *from* the PR line or the ledger row it belongs to (ADR-010). Accounting works here |
| **Google Chat** | **narrowed by D291 (2026-09-23): ingest and notification only.** Messages and their file uploads come in from the channel and land in the accounting inbox; the web app sends notifications out. Approving, confirming receipt and acknowledging are **not** done here — they stay on the web app, because answering in Chat would need the answerer's own session and a signed webhook has none |

`channel` still exists on every decision row, because an approval from a Chat
card and an approval from the web are the same fact through different doors.
Chat does **not** get its own write path: the bot calls the same API the
browser calls, as the identified person, and permission is checked the same
way. A reader bot already exists; integrating it is a later decision.

`john-lau` and its Chat pipeline keep running on their own Supabase project
throughout. **No migration of live data is in scope this fortnight.** When
v2 carries real work, a one-way import is written as its own milestone.
