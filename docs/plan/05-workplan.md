# 05 — Workplan, day by day (Phase 1)

Two weeks, D1–D14. **The whole workflow as a working frontend on demo data,
live on Vercel from day one.** No database, no backend, nothing that needs a
PC. Every day can be driven from the Claude app on a phone.

Each day lists the **prompt to send**. Copy it as-is. Every prompt ends the
same way, because that is what keeps the plan alive.

| Day | Date | Milestone | Ships to the URL |
|---|---|---|---|
| D1 | Thu 10 Sep | M1 demo layer + Vercel live | ✓ |
| D2 | Fri 11 Sep | M2 demo session + permissions | ✓ |
| D3 | Sat 12 Sep | M3 vendors, items, projects | ✓ |
| D4 | Sun 13 Sep | M4 PR list, create, drawer | ✓ |
| D5 | Mon 14 Sep | M5 approval chain + trail | ✓ |
| D6 | Tue 15 Sep | M6 payment rounds | ✓ |
| D7 | Wed 16 Sep | M7 checkpoint — walk Flow B with the team | — |
| D8 | Thu 17 Sep | M8 ledger + attach from a row | ✓ |
| D9 | Fri 18 Sep | M9 evidence, the main road | ✓ |
| D10 | Sat 19 Sep | M10 the exception inbox | ✓ |
| D11 | Sun 20 Sep | M11 PO + receiving | ✓ |
| D12 | Mon 21 Sep | M12 meeting board, cashflow, dashboard | ✓ |
| D13 | Tue 22 Sep | M13 polish, phone, demo reset | ✓ |
| D14 | Wed 23 Sep | M14 walkthrough + findings → Phase 2 schema | — |

---

## The demo layer, once, on D1

Everything after D1 depends on getting this right, so it gets its own section.

```
src/demo/
  fixtures/            vendors.ts items.ts pr.ts transactions.ts users.ts …
  store.ts             the reducer: every state transition in one place
  provider.tsx         React context + localStorage persistence + reset
  api/
    identity.ts        implements 03-api.md /identity
    procurement.ts     implements 03-api.md /procurement
    accounting.ts      implements 03-api.md /accounting
    documents.ts       implements 03-api.md /documents
  derive.ts            the views: coverage, line status, balances, PO axes
```

Rules for it:

1. **Same shape as the real API.** Async functions returning the
   `{ data, meta }` / `{ error: { code, message, outcome }, meta }` envelope
   from `03-api.md`. A screen calls `procurement.approveLine(...)` and handles
   403 / 409 / 422 today, so nothing changes when the call becomes a fetch.
2. **Types in `src/services/*/contracts.ts`**, cut to `02-database.md`. In
   Phase 2 these are replaced by generated database types, and the names must
   already match.
3. **Refusals are real.** The demo layer actually refuses: approving above
   requested returns 422, approving a step that is not your role returns 403,
   a double submit returns 409 `duplicate`. Otherwise the demo teaches the UI
   to be optimistic, and the real API breaks it.
4. **Derived state is derived on read** — `derive.ts` computes coverage,
   the nine-value line status, balances, and the two PO axes from the stored
   rows. Never a stored status field (A3). This is also where the rules get
   written down in code for the first time, so it is the most valuable file
   in Phase 1.
5. **Latency simulated**, 150–400 ms, so pending states and disabled buttons
   get exercised.
6. **Persisted in `localStorage`, per browser.** Everyone who opens the URL
   gets their own sandbox. A "Reset demo data" item in the topbar restores
   the fixtures.
7. **Fixtures look like the real business** — Indonesian vendor names, real
   unit vocabulary, rupiah amounts of a plausible size, the five real account
   names. A demo with `Vendor A` and `Rp 100` teaches nothing.

---

## D1 — Thu 10 Sep · M1 demo layer + live on Vercel

The goal of day one is a URL. Everything else on day one serves that.

- `src/services/*/contracts.ts` — types for identity, procurement,
  accounting, documents, cut to `02-database.md`
- `src/demo/` as above, with fixtures rich enough to be worth looking at:
  ~12 vendors, ~40 items, 6 PR documents across every status, 2 POs,
  ~30 transactions, 5 accounts
- `derive.ts` with coverage and the nine-value ladder
- deploy to Vercel, note the URL in `06-decisions.md`

> Read `docs/plan/README.md` and `05-workplan.md`. Do M1: build
> `src/services/*/contracts.ts` from `02-database.md` and the whole
> `src/demo/` layer described in `05-workplan.md`, implementing the envelope
> and refusal codes from `03-api.md`. Make the fixtures realistic. Deploy to
> Vercel and give me the URL. Update the milestone board and commit.

## D2 — Fri 11 Sep · M2 demo session + permissions

The existing dev role dropdown stops being a crutch and becomes the point:
in a demo, switching role is how you show that permissions work.

- session from the demo identity API, not from local state
- **a user holds several module accesses at once** (D23) — the topbar control
  is a grant picker, not a single-choice dropdown: toggle procurement,
  accounting, HRD, and toggle the authorities separately (D24; five since D145)
- `can()` becomes the union of what the grants allow
- `/masuk` and `/tanpa-akses` in the existing design system
- a user with no modules lands on `/tanpa-akses`, and the menu is genuinely
  empty rather than disabled
- the ledger is visible only with accounting access (D22) — demonstrable by
  toggling it off and watching the menu entry disappear

> Read `docs/plan/README.md` and decisions 22–24 in `06-decisions.md`. Do M2:
> wire `src/store/session.tsx` to the demo identity API with the two-part
> access model — several module grants plus four separate authorities. Make
> the topbar control a grant picker showing what each grant unlocks. Add
> `/masuk` and `/tanpa-akses`. Prove that turning off accounting removes the
> ledger from the menu entirely, and that an unpermitted item is not rendered
> at all. Update the board and commit.

## D3 — Sat 12 Sep · M3 reference data

`/procurement/supplier` and an item catalog screen, both real.

Rules that must be visible in the result: a new vendor typed by a human is
always accepted and is born uncurated; uncurated things are shown and marked
but do not appear in dropdowns; `standard_price` is never auto-written, and
`last_price` only moves forward in time.

> Read `docs/plan/README.md`. Do M3: the vendor and item screens against the
> demo procurement API, using the existing table, drawer and combobox. Show
> uncurated rows, marked, never hidden. Append what this taught you to
> `docs/plan/findings.md`. Update the board and commit.

## D4 — Sun 13 Sep · M4 PR list, create, drawer

- `/procurement/pr` — filter bar, table, row → drawer
- `/procurement/pr/baru` — multi-line create, the one place people type for
  ten minutes, so it is a full page and not a drawer
- item combobox showing last price and unit; vendor type-ahead that accepts
  a name it has never seen; running total
- add `<Loaded>`, `<SourceBadge>`, `<StatusPill>`, `<MoneyInput>` from
  `04-frontend.md`

> Read `docs/plan/README.md` and `04-frontend.md`. Do M4: the PR list, the
> multi-line create page, and the line drawer. Only the components listed in
> `04-frontend.md`. Check it at phone width. Append to `findings.md`. Update
> the board and commit.

## D5 — Mon 14 Sep · M5 approval chain

One gate: the CEO decides goods. No IT step (D20), no urgency (D21).

- `/procurement/persetujuan` — a **standing queue**: every requested line that
  is neither approved, rejected, nor withdrawn. A `HOLD` keeps it in the list
- per line: **a checkbox** — approved, or not yet (D28). No hold, no reject,
  no reason field
- an approved amount that starts at requested and may only be **reduced**
- removal lives on the PR drawer, not here, and is refused once money has
  reached the line (D29)
- `<ApprovalTrail>` — who, when, through which door, append-only
- `<RefusalToast>` — a user without `approve_goods` does not see the control,
  and is refused readably if they call the API anyway

> Read `docs/plan/README.md` and the approval screen in `04-frontend.md`. Do
> M5: the standing approval queue and the approval trail. The decision is a
> checkbox; the approved amount may only be reduced. Only `approve_goods` may
> toggle it. Every toggle writes an append-only row with time, name, email and
> channel. The demo API must actually refuse — 422 above requested, 403
> without the authority, 409 removing a line that money has reached. Approval
> and payment never share a card. Append to `findings.md`. Update the board
> and commit.

## D6 — Tue 15 Sep · M6 payment rounds

- `/procurement/ronde` — the single OPEN round: requested, paying-account
  balances, TO TRANSFER, remaining after payment
- approve round · record transfer · **close round**, with the list of what
  closing releases
- prove on screen that a TRANSFERRED round makes no line PAID

> Read `docs/plan/README.md`. Do M6: the payment round screen and the four
> state transitions. Recording a transfer must not change any line to PAID —
> money reaching the accounting account is not a vendor being paid. Closing
> shows exactly what is still owed. Append to `findings.md`. Update the board
> and commit.

## D7 — Wed 16 Sep · M7 checkpoint — no new features

Open the URL on a phone. Walk **Flow B** from `00-context.md` end to end:
request → CEO approval → round → transfer → receiving. Do it with
whoever will actually use it.

Write `docs/plan/checkpoints/2026-09-16.md`: what worked, what confused
someone, what the screen could not answer, what we now know about the rules
that we did not know on D1. Fix what is cheap; add the rest to the board.

> Read `docs/plan/README.md`. Do M7: walk Flow B end to end on the deployed
> demo and write `docs/plan/checkpoints/2026-09-16.md` with what worked, what
> is wrong, and what it revealed about the business rules. Fix anything cheap
> now and add the rest to the board as new rows. Update the board and commit.

## D8 — Thu 17 Sep · M8 ledger, and attaching from a row

- `/accounting/ledger` — filter bar, table, drawer with lines, evidence,
  allocations, and the path to the PR and PO
- **the attach block in the ledger drawer** (ADR-010): attach a document to
  this transaction, from here, with the kind and the agreement check
- VOID with a mandatory reason; mark COMPLETED (§10.1 item 15 — never built
  in the old web app, built here)
- the five accounts with their exact spellings

> Read `docs/plan/README.md` and `04-frontend.md`. Do M8: the ledger list and
> drawer against the demo accounting API, including the attach block from
> ADR-010 — a document is attached from the transaction it belongs to, and
> the agreement check only warns. Void sets the amount to zero with a reason
> and keeps the row — never a delete. Append to `findings.md`. Update the
> board and commit.

## D9 — Fri 18 Sep · M9 evidence — the main road

The interaction the whole system turns on (ADR-010). It has to be two taps.

- the documents demo layer: file → object URL + a fake sha256, so the
  duplicate check is demonstrable
- `<EvidenceStrip>` in **both** the PR line drawer and the ledger row drawer —
  one component used twice, because it is the same road
- *juga mencakup…* — one document covering several lines or transactions, as
  a first-class action, each link recording who declared it
- the money-to-document path: a receiving photo reaching every ledger row that
  funded its line
- `/accounting/bukti` — browse by entity, month, type
- camera capture on a phone, because half of these are photographed

> Read `docs/plan/README.md` and `04-frontend.md`. Do M9: the documents demo
> API and the attach-from-the-record flow in both drawers, per ADR-010. Show
> one document covering several transactions, and a receiving photo reaching
> every ledger row that funded its line. Every link records who declared it
> and when. Test capture from a phone-sized viewport. Append to `findings.md`.
> Update the board and commit.

## D10 — Sat 19 Sep · M10 the exception inbox

The narrow road: documents whose parent is genuinely unknown, because someone
bought first and the approval came later.

- `/accounting/verifikasi` — photo left, form right, five resolutions:
  jadikan transaksi · buat baris PR retroaktif · tautkan · catatan · tolak
- ~~`Others` branches to notes before anything else is touched~~ — retired by D441
- duplicate warnings are advisory and point at *Tautkan*
- `/accounting/catatan` for the notes
- **the inbox health number** — how many arrived this way this week

> Read `docs/plan/README.md` and `04-frontend.md`. Do M10: the exception inbox
> at `/accounting/verifikasi` with the five resolutions from `04-frontend.md`.
> It carries only documents with no known parent — everything else is attached
> from the record. Nothing is ever discarded. Show the weekly inbox count.
> Append to `findings.md`. Update the board and commit.

## D11 — Sun 20 Sep · M11 PO + receiving

- `/procurement/po` — list and drawer with **two separate progress bars**,
  payment and delivery, never merged; exposure stated in words
- DRAFT → ISSUED when the first PR line pointing at it is approved
- one DP and one FINAL guard, with the refusal naming the first one
- `/procurement/penerimaan` — pick a live line, qty, condition, **photo
  required**; a problem condition leaves the line open and says who was told
- **built as `/procurement/tracker`** (owner, 2026-09-11): obligations across
  every supplier at the top, settled vendors split off (D102), a full-width
  page per supplier (D103), `Add new PO` from the list (D100), and receiving
  that takes both documents, the receiver and the QC (D101)

> Read `docs/plan/README.md`. Do M11: the PO screens and receiving. Payment
> state and delivery state are separate on screen and in the data. A problem
> condition never auto-closes a line. Append to `findings.md`. Update the
> board and commit.

## D12 — Mon 21 Sep · M12 boards

- `/procurement/rapat` — four columns: ✅ lunas · ⏳ disetujui belum bayar ·
  ⚠️ dibayar belum disetujui · • belum keduanya
- `/accounting/cashflow` — five balances, movement chart, tie-out
- **`/accounting/liquidation` — money in against where it went** (owner,
  2026-09-11). Per period: what came in (client payments, transfers between
  our own accounts excluded, because moving money is not receiving it), and
  what left, broken down the way the business already thinks — by transaction
  type, by project, by vendor, and by what carries a PR line behind it against
  what does not. The last split is the one no spreadsheet gives today: it is
  the difference between spending that went through a decision and spending
  that simply happened
- the dashboard rewired from its sample constants to the demo store

> Read `docs/plan/README.md`. Do M12: the meeting board, cashflow, and the
> dashboard on demo data. A number that cannot be computed shows `—` and a
> source badge, never a substitute. Append to `findings.md`. Update the board
> and commit.

## D13 — Tue 22 Sep · M13 polish

- every table at phone width; drawer full-screen with a pinned action bar
- empty states, loading states, failure states — all three, everywhere
- "Reset demo data", and a small "DEMO — data is not real" marker that cannot
  be mistaken for production
- a guided tour: a `?tour=flow-b` parameter that walks the screens in order

> Read `docs/plan/README.md` and `04-frontend.md`. Do M13: phone polish,
> the three states on every screen, demo reset, the demo marker, and the
> guided tour. Update the board and commit.

## D14 — Wed 23 Sep · M14 the payoff

Not code. This is where Phase 1 pays for itself.

1. Record a walkthrough of the whole workflow on the deployed URL
2. Consolidate `findings.md` into **the schema we actually need** — every
   place the demo revealed a missing field, a missing state, a rule nobody had
   written down, or a screen that could not answer a question
3. Rewrite `02-database.md` against those findings. It was written before we
   walked anything; by D14 we will know better
4. Answer or re-default everything in `06-decisions.md` that the walk settled
5. Schedule Phase 2

> Read `docs/plan/README.md` and every entry in `docs/plan/findings.md`. Do
> M14: consolidate the findings, rewrite `02-database.md` to match what we
> learned, update `06-decisions.md` with everything the walkthrough settled,
> and propose the Phase 2 milestone list with dates. Update the board and
> commit.

---

## Deployment

Vercel, from this branch, on every push. Preview deployments per PR — which
means **a link to look at from the phone before merging**, which is the whole
review mechanism for the next fortnight.

- Framework preset: Next.js. No environment variables in Phase 1 — there are
  no secrets, because there is no backend.
- `dev-ops.talaliving.com` can point at the Vercel deployment as a custom
  domain whenever you want it. That is a DNS record, not a tunnel, and it
  needs no PC. Ask when you want it; it is not on the critical path.
- Phase 2 decides whether the real thing stays on Vercel or moves to the
  office PC — that is a Phase 2 question and this plan does not pre-empt it.

## Definition of done, per milestone

1. the screen works, on the deployed URL, at phone width
2. **every field is reachable** — created, edited and refused, not merely
   displayed. A field that only reads is not built (F9)
3. every refusal path is demonstrable — not just the happy one
4. derived state is derived, never stored
5. what it taught us is appended to `findings.md`
6. the milestone board is updated **in the same commit**
7. anything decided along the way is appended to `06-decisions.md`
