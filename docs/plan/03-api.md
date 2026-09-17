# 03 — Backend API structure

> **Phase note.** The HTTP endpoints are Phase 2. **The contract in this
> document is Phase 1** — the demo layer in `src/demo/api/` implements these
> exact function signatures, this envelope, these outcome codes and these
> status codes, so screens are written once. When Phase 2 arrives, the demo
> module is replaced by `fetch` and no screen changes.

Eight services — five from D5, plus `hr` (D136), `production` (D148) and `inventory` (D153). Each is independently
addressable, independently documented, and could be moved to its own host by
changing one environment variable (ADR-001). None of them imports another.

```
/api/v1/identity/…        core.*      who you are, what you may do
/api/v1/procurement/…     procure.*   vendors, items, PR, rounds, PO, receiving
/api/v1/accounting/…      acct.*      accounts, ledger, allocations, review
/api/v1/documents/…       core files  upload, link, fetch evidence
/api/v1/events/…          core.outbox subscribe, replay — the third-party seam
/api/v1/hr/…              hr.*        people, attendance, overtime, payroll
/api/v1/production/…      prod.*      work orders, stages, progress, deadlines
/api/v1/inventory/…       inv.*       timber: logs, boards, kubikasi, cost per m³
/api/v1/delivery/…        dlv.*       consignments, site visits, snags, handover
/api/v1/assistant/…       asst.*      John Lau: tool catalogue, turns, drafts
```

## Service contract — the same for all eight

### Envelope

```jsonc
// success
{ "data": …, "meta": { "request_id": "req_…", "service": "procurement", "version": "1" } }

// list
{ "data": [ … ], "meta": { …, "page": { "limit": 50, "cursor": "…", "has_more": true } } }

// failure
{ "error": { "code": "line_already_approved", "message": "…",
             "outcome": "refused", "detail": { … } },
  "meta": { "request_id": "req_…", "service": "procurement", "version": "1" } }
```

`outcome` is one of `ok` · `refused` · `duplicate` · `noop`, and it is
**always** present on a failure. This is A7 made mechanical: §2.2 records a
run of incidents on 2026-08-28 where a refused button reported success, a
stuck claim made a row unbookable, and a sweep discarded documents with no
message. The rule that came out of it was an explicit `_outcome`; here it is
part of the envelope, so it cannot be forgotten.

### Status codes

| Code | Meaning | Client behaviour |
|---|---|---|
| 200 / 201 | done | show the result |
| 400 | malformed | developer error, show raw |
| 401 | not signed in | to `/masuk` |
| 403 | **refused** — signed in, not permitted, decision belongs to someone else | toast naming the role that may do it. The action is logged and not applied |
| 409 | **duplicate / conflict** — already decided, already posted, slot taken | toast "already recorded — nothing changed". **Never release the idempotency claim on 409** |
| 422 | validation | field-level errors in `detail`. Release the claim |
| 429 / 5xx | try again | release the claim, offer retry |

The claim rules (release on 422 and 5xx, hold on 409) are carried over from
`john-lau` unchanged — they are what makes a retried button safe.

### Idempotency

Every mutating request takes `Idempotency-Key`. The service stores
`(service, endpoint, key)` with the response. A repeat returns the first
response with `outcome: "duplicate"` and changes nothing.

The UI generates the key when the form is opened, not when it is submitted —
so a double tap on a slow phone connection is one decision, not two. This is
`card_clicks` dedupe (§3.8, three real twin-card incidents) in API form.

### Auth

`Authorization: Bearer <supabase access token>`, or the session cookie for
same-origin calls from the app. The service opens Postgres **as that user**;
RLS decides (ADR-002). There is no API key that bypasses a permission check.

### Every mutation writes

1. the business rows, in one Postgres transaction
2. one `core.audit_log` row: actor, entity, action, before, after, outcome
3. one `core.outbox` row for the domain event

All three or none. Never a business row without its audit row.

---

## `identity`

| Method | Path | Notes |
|---|---|---|
| GET | `/me` | user, **module grants**, **authorities**, resolved permission list. The frontend `can()` is the union of these (D23, D24) |
| GET | `/users` | `it.manage_users` |
| POST | `/users` | invite; Supabase Auth handles the credential |
| PUT | `/users/{id}/modules` | grant or revoke a module and its level. **`it` at `admin`**; append-only history in audit. In Phase 1 this had no guard at all until M35 — anybody acting could grant themselves anything |
| PUT | `/users/{id}/authorities` | grant or revoke `approve_goods` · `approve_funds` · `approve_overtime` · `post_ledger` · `resolve_inbox`. **Separate from modules, deliberately** (D24). **`it` at `admin`** |
| GET | `/modules`, `/authorities` | the catalogs, read from the database |

### Settings

| Method | Path | Notes |
|---|---|---|
| GET | `/settings` | every setting, each carrying its **reach** — `display`, `forward`, or `retroactive` — plus what it would move and where it is really changed (D214). `settings` at `read` |
| PUT | `/settings/{key}` | **403 `setting_locked`** for anything retroactive, with the reason about the data rather than about permissions (D215) — refused at the API, because a disabled input is a suggestion. 422 on a value of the wrong kind or outside the choices; `noop` when the value is unchanged. The audit row carries **before and after**, always: a settings change is the kind of thing nobody remembers making and everybody notices the effect of. `settings` at `write` |

### The two trails

| Method | Path | Notes |
|---|---|---|
**Who may open any of this: IT and leadership, and nobody else** (owner,
Q22 → D190). The verb the owner used is the one enforced — *baca*. Leadership
holds `it: read` and can open both trails; every write below needs more than
that. There is no `is_leadership` field: deriving leadership from
`approve_goods` or `approve_funds` would hand a week-long stand-in the right to
read everyone's activity log, which is the fusion D24 exists to prevent.

Levels are checked with `requireLevel`, not `requireModule` — the older guard
asked only whether a door was open, which would have let a read grant call the
purge (D191). Its refusal names the level held as well as the level needed.

| GET | `/audit` | the change trail. Filters: actor, entity, action, `outcome` (`ok` · `refused` · `duplicate` · `noop`), date range. **`it` at `read`.** **Refusals are listed beside successes**, not hidden — a trail of only what worked is missing the half people argue about. **No delete route exists at any level** |
| GET | `/activity` | the read trail, detail. Last `DETAIL_DAYS` (30) only; older days answer from `/activity/daily`, and the endpoint says which it is answering from rather than returning an empty list. **`it` at `read`** — and *only* that: the owner named two groups, and a person reading their own log is neither (D190) |
| GET | `/activity/daily` | the recap, last `RECAP_MONTHS` (6). One row per person per day: events, modules touched, changes and refusals taken from the audit trail, first and last activity, a one-line headline. **`it` at `read`** |
| GET | `/activity/retention` | the two edges as dates, the days holding detail, the days holding a recap, and **the days that have detail but no recap yet** — the number both buttons below depend on. **`it` at `read`** |
| POST | `/activity/roll-up` | **`it` at `write`.** `{day}` → writes the recap for that day. Idempotent: a second call is `duplicate`, not a second row. This is a nightly job in Phase 2; the button exists so the rule is visible rather than magic |
| POST | `/activity/purge` | **`it` at `admin`** — the only deleting endpoint in the API sits at the top level of the only module that has one. `{before}` → deletes detail rows older than the retention edge. **422 `blocked_days`** naming every day in the range that has no recap yet — it refuses the whole call rather than purging around them (D189) |

`POST /activity/roll-up` is a **precondition** of the purge, not a convenience:
purging first would destroy the day and leave the system answering *0
aktivitas* about it forever.

**Note on `src/lib/roles.ts`.** Today the catalog lives in code, which the
existing README defends well: a fresh database can be bootstrapped without
anyone guessing what roles should exist. We keep that — the file stays the
**seed source**, generated into `0002_core_identity.sql`. The database is what
gets *enforced*; the file is what gets *reviewed*. One direction, no drift.

## `procurement`

Reference data:

| Method | Path | Notes |
|---|---|---|
| GET | `/vendors` | `?q=` type-ahead, `?curated=` |
| POST | `/vendors` | a new vendor is always accepted, born `is_curated=false` |
| PUT | `/vendors/{id}/curate` | promote, merge (absorbed spelling → `aka`) |
| GET | `/items` | `?q=`, returns `standard_price ?? last_price` as a *hint* |
| POST | `/items` | born uncurated |
| GET | `/uom`, `/categories`, `/projects` | closed lists, from the database |

PR chain:

| Method | Path | Notes |
|---|---|---|
| POST | `/pr` | create draft; `doc_no` minted by Postgres |
| GET | `/pr` | `?status=&requester=&project=&from=&to=` |
| GET | `/pr/{doc_no}` | document + lines + coverage + status, one call |
| PUT | `/pr/{doc_no}/lines` | edit while DRAFT; after submit → supersede |
| POST | `/pr/{doc_no}/submit` | DRAFT → SUBMITTED, lines get `-LNN` |
| POST | `/pr/{doc_no}/reopen` | only while no gate has decided |
| PUT | `/pr/lines/{line_no}` | edit an item **while nobody has approved it** (D66). `item_total` may be sent explicitly: the amount is quantity × price only when the line has both, so a service line keeps the figure somebody typed instead of being recomputed to zero (D75) — not merely while the document is a draft. **409** once approved, once money has been allocated, or once removed. The previous values go into the audit row |
| POST | `/pr/lines/{line_no}/note` | `{instructions?, remark?}` — leadership's optional words, on a line decided or not (D64). Append-only; **422** when both are empty |
| POST | `/documents/links` | `{url, title?}` — filing an address as evidence (D125). **422** on anything that is not http(s). A link is supporting, never primary: a shop page does not say money moved |
| POST | `/pr/approval-requests` | `{line_nos[], to?, notes?}` — `notes` carries what the room said about each item, per line (D127); it reaches the approver as context and prefills their instruction field, never as a recorded instruction of its own — ask the approver in chat (D69), as **one batch** (D70). Anyone in procurement may ask. Skips lines already decided or already asked; **409 when that leaves nothing**. Returns the batch with its three totals. Emits one `procurement.approval.requested` carrying the list — a worker turns that into a single chat card |
| GET | `/pr/approval-batches` | `?for_email=&pending=1` — the lists waiting on one person, each with `requested_total`, `approved_total`, `to_pay_total` |
| POST | `/pr/approval-batches/{token}/approve-rest` | yes to everything still open in the batch, at the amounts asked. Same identity rule: **403 unless the answerer is the addressee**, 409 when nothing is left open |
| POST | `/pr/approval-requests/{token}/answer` | the answer coming back from chat. **The identity is taken from the platform's signed request, never from the body or the session** — that is the whole reason the round trip exists. **403 when the answerer is not the addressee**, 409 when already answered. Writes the approval with `channel: chat` and the approver's own name |
| POST | `/pr/lines/{line_no}/approve` | `{approved: true\|false, approved_qty?, approved_amount?, instructions?, remark?}` — a **checkbox**, not a vocabulary (D28). The quantity may be cut as well as the amount, and cutting the quantity recomputes the amount at the unit price (D65). `step` ∈ `GOODS` · `FUNDS`; there is no IT step (D20). The approved figures are **not capped at what was requested** (D76): a price can move between the request and the meeting, and the gap is reported rather than refused. Answers any chat card still open on the line. **403 without the matching authority** — `approve_goods` is the CEO's alone (D19). Each toggle writes an append-only row carrying timestamp, name, email and channel |
| GET | `/pr/queue` | the standing approval queue: every submitted line not approved and not removed (D21). Nothing ages out |
| POST | `/pr/lines/{line_no}/remove` | no longer needed (D29). Soft — the row stays with who and when. **409 once any money has been allocated to the line**: that is a return or a credit, not a removal |
| GET | `/pr/lines/{line_no}/history` | approvals, revisions, allocations, receipts — the full trail |
| GET | `/pr/lines/{line_no}/for-posting` | the seam accounting calls before writing a payment against a line (ADR-004): description, approved amount, vendor, project, already-covered, removed. Never a table read across services |
| POST | `/pr/lines/{line_no}/variance` | explain why paid ≠ approved. `{reason, note?}`, reason from a closed list of seven (D55). **409 when there is nothing to explain** — inside the Rp 1.000 tolerance, or nothing paid. **422 when `reason = other` without a note.** Append-only: a different explanation is a new row. An underpayment explained as anything but `partial_payment` also writes the `line_settlements` row that closes the line (D56) |
| GET | `/pr/variances` | every line where paid ≠ approved by more than the tolerance, open or finished, worst first. Not filtered to open lines — a difference does not stop being one because the line closed |

Rounds:

| Method | Path | Notes |
|---|---|---|
| POST | `/rounds/sync` | roll every approved-and-still-owed line into the single OPEN round. Idempotent; safe to call on every page load |
| GET | `/rounds/{round_no}` | requested, balances, TO TRANSFER, funded-by |
| POST | `/rounds/{round_no}/approve` | `procurement.approve_funds`. Freezes the numbers |
| POST | `/rounds/{round_no}/transfer` | records **one instalment** — amount + transaction + **the proof** (D82); a round takes as many as it needs and reports what is still short. **409 when the same `trx_no` is counted twice** against one round. `post_ledger`, not `approve_funds` (D78) — the funds decision was approving the round. **422 without `proof_attachment_id`** (D80): a round is funded when there is proof it was funded. **Does not make any line PAID** (A10) |
| POST | `/rounds/{round_no}/close` | the step everyone forgets. Response lists what is still owed and is being released |

PO and receiving:

| Method | Path | Notes |
|---|---|---|
| POST | `/po` | `{vendor_id, lines[{description, qty, uom, unit_price}], dp_percent?, note?, issue?}`. **Issued by default** and born DRAFT only when `issue: false` (D100) — a PO nobody sent is a document, not an obligation. **422** without a vendor, without lines, or with a line carrying no unit price; a `dp_percent` writes the DP and FINAL terms |
| GET | `/po/{po_no}` | two axes, exposure, schedule with each term's state, what may be paid now, amendments, payments and documents — one call, because a screen that needs three renders in three stages |
| POST | `/po/{po_no}/approval-requests` | asks leadership to confirm the order. **409** unless it is a draft nobody has confirmed. Emits `procurement.po.approval_requested` — the seam, not a second write path |
| POST | `/po/{po_no}/resend` | records that the vendor has been given the current revision. **409** when they already have it |
| POST | `/po/{po_no}/approve` | `{approved, note?}`, `approve_goods` only. **422** to decline without a sentence — somebody has to tell the supplier something |
| PUT | `/po/{po_no}/expected-delivery` | `{expected_delivery, reason?}`. **422** without a reason once the order is issued and a date was already agreed (D134) |
| POST | `/po/{po_no}/issue` | DRAFT → ISSUED, its own act with its own audit row. **409** if it is not a draft, **422** if it has no lines. Before it nothing is owed; after it the deposit is payable (D99) |
| POST | `/po/{po_no}/amend` | `{line_no, qty?, unit_price?, description?, reason}` — the only way an issued obligation moves (D129). Supersession, never an edit: the old line stays and points at the new one, receipts follow the live line, and **422 without a reason**. **409** on a closed order. Amending a **confirmed draft** clears the confirmation; amending an **issued** order bumps `revision` and never asks leadership again (D135) |
| GET | `/vendors/{vendor_id}/journey` | one supplier's whole story: contract value, paid, outstanding, value received (capped at ordered — D98), *billable now* (D99), the vendor credit, and every order with its lines, receipts and evidence |
| GET | `/vendors/journeys` | every supplier we have issued an order to, most billable first. The tracker's list and its obligations strip (D102) |
| POST | `/po/{po_no}/close` | **422** listing what is unfinished — unpaid balance, goods not arrived, nothing filed — unless `settle_reason` is given, which goes on the audit row (D130). **409** on an order that is already closed or was never issued |
| POST | `/receipts` | `{line_no | po_line_no, qty, condition, qc_by?, documents[{attachment_id, kind}], note?}`. **422 without the photograph** — it is the one thing whoever is standing there can always produce. With the signed tanda terima it is `CONFIRMED`; without it, `REPORTED` (D131). A problem condition returns `outcome: ok` plus a `notified` flag and leaves the line open (A18) |
| POST | `/receipts/{receipt_no}/confirm` | `{delivery_note_attachment_id, qc_by?, qty_received?, condition?}` — procurement completing a reported arrival. **Only a confirmed receipt counts as value received.** The audit row carries `hours_after_arrival` |
| GET | `/receipts/reported` | arrivals waiting for their tanda terima, oldest first — the morning queue |

### Projects — master data

| Method | Path | Notes |
|---|---|---|
| GET | `/projects` | newest code first |
| GET | `/projects/{code}` | |
| GET | `/pr/lines?source_wo_no=` | every request line raised from one work order's BOM — the actual side of *proyeksi vs aktual* (D151) |
| GET | `/projects/{code}/lines` | what the client ordered, line by line |
| POST | `/projects/{code}/lines` | add or change a line: `{product_code?, description, qty, uom, unit_price?}`. The product code is **not** validated against the catalogue — an order is typed the day it is signed, often before anybody has drawn the thing (A6, D150) |
| DELETE | `/projects/{code}/lines/{id}` | |
| POST | `/projects` | create or update: `{code, name, client_name?, location?, pic?, started_on?, target_date?, contract_value?, is_active?}`. The **code is never edited** — request lines, work orders and ledger rows all reference it as text at the seam (D149). 422 when the target date is before the start |

`POST /pr` accepts `project_code` as well as `project_id`: another service
knows the public code, never the internal id (ADR-004). A request created from
a bill of material arrives as a **draft** with `source_wo_no` on every line —
it is a requirement, not a decision to spend (D151).

`contract_value` is the agreed order value. It is **not** an invoice and not a
quotation, and nothing in this system produces either yet (Q37).

## `accounting`

| Method | Path | Notes |
|---|---|---|
| GET | `/accounts` | with balances from `v_account_balance` |
| GET | `/transactions` | `?account=&type=&from=&to=&vendor=&status=&q=&include_void=&limit=&offset=`. Paged at the service — the meta carries `total`, so a screen can say "page 2 of 9" rather than "next" into the dark. Voided rows are excluded unless asked for, so the page count matches what the reader sees |
| POST | `/transactions` | the **one write seam**. Requires `source_ref`; a repeat is `duplicate`, never a second row. **422 without at least one primary document** — nota, transfer proof or photo of what arrived (D85); supporting documents may ride along but cannot stand alone. **422 when a purchase type carries no lines, no quantity, no unit price or no vendor** (D86), and when the lines do not add up to the amount. The files are linked in the same act, so an undocumented row never exists |
| GET | `/transaction-types` | the thirteen, with `is_purchase` — which decides whether a row is expected to name what it bought and who from |
| GET | `/transactions/{trx_no}/history` | the audit trail of one row, with what changed field by field (D84) |
| GET | `/transactions/{trx_no}` | one call: the row, its lines, its allocations (each naming the request line it settled), and the PR/PO path. A drawer that needs three calls renders in three stages |
| POST | `/transactions/{trx_no}/void` | amount → 0, reason mandatory. Reversible |
| POST | `/transactions/{trx_no}/complete` | mark COMPLETED. §10.1 item 15 — never built in v1, built here |
| POST | `/allocations` | `{trx_no, pr_line_no, amount, method}`. **422 if Σ allocations would exceed the transaction** (A9) |
| POST | `/allocations/{id}/supersede` | corrections are new rows |
| POST | `/transactions/from-line` | **paying a request line is one act** (D53): writes the transaction, the allocation to the line, and the document link, with the PR line number in the ledger description. Requires the `post_ledger` authority. `source_ref = pr-line:<line_no>:<date>:<amount>`, so a retry is `duplicate` — never a second payment. **422** when the line does not exist, **409** when it was removed or the same payment is already posted |
| GET | `/documents/{attachment_id}/coverage` | **what one document is already holding up** — every ledger row it stands behind, every request line those rows reach, and **every payment against each line, including the halves paid against other documents** (D206). `gap` is `document_amount − covered_total`, and it is **null, not zero, when the document's own value was never read**: a gap measured against an unknown is the whole amount wearing a different name |
| GET | `/transactions/{trx_no}/coverage` | the same three questions asked of the **row being linked to** — the paper already on it, what it already pays, and how much of it is allocated to nothing yet (D207). This is the one that decides whether *link* is the right road; the document's own coverage is empty while it sits in the queue and decides nothing |
| GET | `/review` | the PENDING queue |
| GET | `/review?direction=in` | the same queue, filtered to money coming IN — a transfer proof leadership dropped in chat, waiting to be booked (D81) |
| POST | `/review/{ref_id}/confirm-in` | book one as an IN transaction: writes the row, files the photo against it, closes the inbox row with `produced_trx_id`. The amount is confirmed by a person, never taken from the extraction (A13). `post_ledger` |
| GET | `/incoming` | money already booked into a paying account, with the proof on each row — what the payment-round screen offers instead of asking somebody to retype an amount the ledger already holds |
| POST | `/review/{ref_id}/confirm` | → a transaction. `Others` goes to notes, not the ledger |
| POST | `/review/{ref_id}/attach` | → links to existing transactions, creates no money |
| POST | `/review/{ref_id}/reject` | recorded, never discarded |
| POST | `/review/{ref_id}/rows` | add an item the extraction missed |
| GET | `/statements` · `/statements/{no}` | every uploaded rekening koran, with each line's status and the ledger rows that look like it — suggestions, never applied (D180) |
| POST | `/statements` | upload one. **409** re-uploading the same account and period. The two balances are typed from the statement header and checked against the sum of the lines (D182) |
| PUT | `/statements/{no}/lines/{id}/rate` | the rate the bank gave that day, for a foreign line. Typed, never looked up (D181) |
| POST | `/statements/{no}/lines/{id}/match` | tie the line to a ledger row that already exists. **409** if that row is already tied to another line |
| POST | `/statements/{no}/lines/{id}/book` | **creates** the ledger row, with the statement as its evidence. `post_ledger`; **422** on a foreign line with no rate |
| POST | `/statements/{no}/lines/{id}/ignore` | left out, with a reason. Never deleted |
| GET | `/reports/cashflow`, `/reports/liquidation` | |

**Validation at the seam** (ADR-004): `POST /allocations` calls
`procurement.GET /pr/lines/{line_no}` before writing. A line that does not
exist is a 422 with the line number echoed — not a text field written
hopefully and validated by a sweep three hours later.

Liquidation:

| Method | Path | Notes |
|---|---|---|
| GET | `/fundings` | every transfer of operating money into an account that pays people, newest first, with how long each one lasted (D106) |
| GET | `/fundings/{trx_no}` | one transfer: the balance before it, every row that left before the next transfer arrived with the transfer counting down, and the split by type, vendor and project |

Payment calendar:

| Method | Path | Notes |
|---|---|---|
| GET | `/cash/plan` | twelve months from the current one: every recurring line, planned against actual, the *not in the plan* row, and the month the money runs out. Computed, never stored (A3) |
| GET | `/cash/due` | the next three weeks and anything already late, by date — the same events the month expansion uses (D116) |
| GET | `/cash/bills/{month}` | **accounting's monthly bills list** (D228). One month of `/cash/plan` re-cut: per line the planned figure, what has actually been paid, what is still outstanding, how many days away it is, **last month's figure** and the percentage between them, and whether that gap is unusual by `ops.bill_anomaly_percent` (D229). `last_month` is null where no comparable line existed — never zero, and a new line is never an anomaly. Reads through `cashPlan()` rather than beside it, so the two screens cannot disagree |
| GET | `/cash/plan/{month}` | one month opened up: every dated movement in order with the balance running down, the first day it goes under, the lowest point, and the undated obligations no day can hold (D115) |
| POST | `/cash/components` | **`accounting: admin` only** — the estimates belong to leadership (D233). `{name, direction, amount, frequency, due_day \| due_weekday \| due_date, type_code?, vendor_id?, account_id?}`. `frequency` is `weekly`, `monthly` or `once`, and `amount` is **per occurrence** (D113). **422** without the date a one-off needs. **409 when another *standing* line already claims that category** (D110) — a one-off may share one, because it is dated and claims first |
| PATCH | `/cash/components/{id}` | **`accounting: admin` only** (D233). Estimate, day, name, or `active: false` to take it off the calendar. The audit row carries before and after |
| PUT | `/cash/components/{id}/months/{month}` | **`accounting: admin` only** (D233). One month that differs. **422 without a reason** — in three months nobody remembers why one cell is bigger |
| POST | `/cash/settlements` | `{component_id, month, trx_no}` — naming the ledger row that paid a bill. **409 if that row is already named by another line.** The calendar never posts a transaction: money is recorded in the ledger, with its evidence, and named here afterwards (D112) |

## `documents`

| Method | Path | Notes |
|---|---|---|
| POST | `/upload` | multipart, ≤15 MB. Returns `attachment_id` + `sha256` + `duplicate_suspect` |
| POST | `/links` | link an attachment to an entity with a `kind` |
| GET | `/{id}` | signed URL, short TTL |
| GET | `/{id}/thumb?size=220\|400\|800` | server-side, cached |
| GET | `/by-entity/{entity}/{entity_no}` | everything attached to a thing |

The size limit sits **below** the framework's body limit deliberately, so a
too-large file gets a 413 that names the limit instead of a connection that
dies — the same reason `john-lau` set 15 MB under Next's 16 MB.

## `hr`

| Method | Path | Notes |
|---|---|---|
| GET | `/employees` | `?include_left=1` to see people who have gone. Sorted by `employee_no` |
| GET | `/employees/{employee_no}` | |
| POST | `/employees` | create or update by `employee_no`. Carries **pokok** (`base_rate`) and **tunjangan harian** (`allowance_rate`) as separate fields (D250); `allowance_rate` omitted means **unchanged**, never zero, so a save that forgot the field cannot quietly stop paying somebody's allowance. A change to either puts the figure **before and after** on the audit row — "when did his rate go up, and who said so" is the question a payroll dispute turns on |
| GET | `/timesheet?from=&to=&unit=` | the grid: every person × every office day, plus `needs_review` and `marked` counts |
| GET | `/timesheet/{employee_no}/{work_date}` | one day: every tap, the slot the rule gave it, the issues |
| POST | `/attendance/import` | `{filename, rows[]}` from the reader's export. Returns `{import_id, added, duplicates, unknown[]}`. **Never creates a person** — an unrecognised machine number comes back with its tap count (D143). Idempotent on `(employee, at)`, so re-uploading a file adds nothing |
| POST | `/attendance/scan` | a tap the machine missed. `reason` required (D137) |
| POST | `/day-marks` | `{work_date, kind, reason, employee_no?}` — omit the employee and it covers the whole office. 409 if that day is already marked for that scope |
| GET | `/tasks` | `?assignee_no=&status=`. **Overdue first, then blocked, then by date** — the board's job is to put what somebody has to deal with at the top |
| POST | `/tasks` | `{assignee_no, title, due_date, detail?, ref_kind?, ref_no?}`. Both the owner and the date are **required**: a task with no owner is a note, and one with no date is one nobody can tell is late (D260). 409 for somebody who has left |
| POST | `/tasks/{task_no}` | `{action: "done" \| "block" \| "unblock" \| "cancel", reason?, done_on?}`. **422 without a reason** on `block` and `cancel` — blocking lifts the task out of the assignee's score, and something that removes a penalty has to say why; cancelling leaves no other trace. `done_on` records the day it was finished rather than the day it was typed (D148's rule). `noop` on unblocking something that is not blocked |
| GET | `/kpi?period_start=&period_end=&employee_no=` | **`payroll` level** — the most personal reading this system produces about anybody. Each measure carries `value: null` with a **reason** where it could not be measured, its `source`, and the `basis` it was computed over. `score` is null below `kpi.min_measures`, and the weights run over the **measured** measures only, so a person whose data does not exist is not penalised for it (D261) |
| GET | `/contributions/rolls?month=` | every computed scheme for a month, name by name — **readable by HRD, payroll and accounting**, because auditing the invoice against the roll is accounting's job (owner, D259). Member numbers come back **masked**; revealing one is a separate, logged act (D196) |
| GET | `/contributions/rolls/{scheme}?month=` | one scheme: the roll, the rate in force, last month's total, and who joined or left. `rate: null` where no version covers the month — and the screens print no figure rather than an invoice of nil |
| GET | `/enrolments` | `?employee_no=&scheme=`. Ended rows included: *was he covered in July* is the question the register exists to answer |
| POST | `/enrolments` | `{employee_no, scheme, member_no?, enrolled_on, declared_base?, note?}` — **HRD's act**. 422 without a date, or before the person joined. **409 `already_enrolled`** on a second open row for the same person and scheme: two would make *is he covered* ambiguous. `declared_base` is the wage BPJS was registered against where it differs from what is actually paid, which is common and is the gap the field exists to make visible |
| POST | `/enrolments/{id}/end` | `{ended_on, reason}`. The row **stays**. **422 without a reason** — that sentence is what accounting reads next month when the name is still on the invoice |
| GET | `/contribution-rates` | the dated percentages, newest first, each carrying `confirmed`: false marks a figure this system chose as a stand-in rather than one somebody checked (Q49) |
| POST | `/contribution-rates` | a new dated version. **`it` at `write`, not `payroll`** — the same split as the pay rule book (D193): one number here moves every payslip and every invoice at once. 409 unless it starts after the current version — last month's contribution is computed with last month's rate |
| GET | `/contributions/audit?month=` | **accounting's** side: the invoices, each with the schemes it pays, what the roll says they should come to, and what actually left. Grouped by **invoice, not by scheme** — one BPJS TK bill covers JHT, JP, JKK and JKM, and auditing per scheme produced four red rows describing one healthy payment (F80). `expected: null` where any scheme on the invoice has no rate: a sum missing one of its parts is worse than no sum |
| POST | `/day-marks/{id}/surat-dokter` | link an uploaded letter to a day marked `sick`. **This is what makes the day paid** (D144), and it may arrive days later — nothing is recomputed, because nothing was stored |
| DELETE | `/day-marks/{id}` | the holiday was the Tuesday, not the Monday. Audited like any other act |
| GET | `/allowance-withholdings` | `?employee_no=&from=&to=`. Restored rows included — the list is the record |
| POST | `/allowance-withholdings` | `{employee_no, work_date, reason}` — HRD saying one person does not get one day's tunjangan (D250). **422 without a reason.** **409 inside an APPROVED run**: that figure has been signed, and the correction is an adjustment on the next run. Deliberately **not** a day mark: a mark says what the day *was*, and WFH is a worked day with a right timesheet and no allowance |
| POST | `/allowance-withholdings/{id}/restore` | puts it back. The row **stays**, with `restored_by` and its own reason — restoring is a second decision, not an erasure, so *why was this not paid* survives somebody changing their mind (A5). `noop` when it is already restored |
| GET | `/files` · `/files/{employee_no}` | Berkas 201 as a **checklist**: every required kind listed whether or not anything is filed, with what is missing and what expires (D177) |
| POST | `/files/{employee_no}/documents` | 422 when neither a scan nor a number is given — a number with no scan is still a record. **422 `extracted_without_file`** when the number claims to have been read from a scan that is not attached (D199) |
| POST | `/files/documents/{id}/reveal` | the real identity number, for one document, for one person, once. `hrd` module. **Writes an audit row** — actor, whose document, which kind, never the number (D197). The list never carries the number at all, so this is the only road to it (D196); there is no batch form, deliberately — *reveal every KTP* is not a request this API knows how to make |

**Masking.** `GET /files` and `GET /files/{employee_no}` return
`doc_no_masked`, `doc_no_length` and `doc_no_length_ok` for the kinds in
`SENSITIVE_DOC_KINDS` (KTP, KK, NPWP, BPJS) and **omit `doc_no` entirely**;
every other kind carries its number in the clear (D195, D198). The mask is
server-side: a payload that carried the number and a screen that hid it would
make the reveal log record a click.
| GET | `/leave/balances` | entitlement − marked − approved-not-yet-taken, computed on read |
| GET | `/leave` · POST `/leave` | asking. 409 on an overlapping request for the same person; never refused for exceeding the entitlement (D144) |
| POST | `/leave/{request_no}/decide` | approving **writes the day marks** and reports which days were skipped because they already carried one; rejecting without a reason is 422 (D178) |
| GET | `/overtime` | waiting claims first |
| POST | `/overtime` | claim hours against a day. 409 if a live claim already exists for it |
| GET | `/overtime` | every sheet with its lines, its stage and the paper behind it. Anything still waiting comes first |
| GET | `/overtime/{sheet_no}` | one sheet in full |
| POST | `/overtime` | open a sheet: `{kind: "production" \| "staff", work_date, purpose}`. The kind decides who has to sign, which is not a detail to discover at the end (D146) |
| POST | `/overtime/{sheet_no}/lines` | add a name: `{employee_no, hours, task}` plus, on a production sheet, `{wo_no, stage, qty_done}` — the production report for that night (D147). 409 once the sheet has been checked: a new name belongs on a new sheet, or the signature no longer points at what was signed |
| POST | `/overtime/{sheet_no}/document` | link the paper — `Surat Lembur` for production, `Laporan Lembur` (the screenshot) for staff |
| POST | `/overtime/{sheet_no}/decide` | `{step: "hrd" \| "leader", approved, reason?}`. **Production** takes both: `hrd` needs `hrd.update`, `leader` needs `approve_overtime`, is 409 before HRD, and **422 while no surat lembur is attached**. **Staff** takes `hrd` alone — `leader` on a staff sheet is 422 — and the sheet is already paid, so `approved: false` is what HRD's decision actually does, and it needs a sentence (D146) |
| GET | `/payroll` | runs, newest period first |
| GET | `/payroll/{run_no}` | the run with every line computed on read |
| POST | `/payroll` | open a run for a period. 409 if a run already covers those dates |
| POST | `/payroll/{run_no}/approve` | requires `approve_funds`. **422 while any day in the period is still unread** (D139) |
| GET | `/payroll/period?from=&to=` | the same figures for **any** period, run or no run — the week slider reads this (D158). `opened:false` and an empty `run_no` where nothing has been opened |
| GET | `/pay-rules` | every dated version, newest first, with the one in force marked. **`payroll` at `read`** — HRD reads the book. Since M46 a version also carries `hourly_basis` (company or statutory), `effective_days_per_year`, `hourly_includes_allowance`, `day_starts_minutes`, `late_grace_minutes` and `late_forfeits_allowance` (D249–D251) |
| POST | `/pay-rules` | writes the **next** version. **`it` at `write`, not `payroll`** — HRD reads the rules, IT changes them (owner, D193), so the people whose pay these rules compute are not the people who can change them alone. 422 in the past or before the latest version; 409 inside an existing run's period (D173) |
| POST | `/pay-rules/preview` | applies a proposed book to a real period and returns only the lines that move. Nothing is saved (D175) |
| GET | `/payroll/{run_no}/adjustments` | what was added or taken off by hand, each with its reason (D155) |
| POST | `/payroll/{run_no}/adjustments` | 422 without a reason; **403 once the run leaves `DRAFT`** |
| DELETE | `/payroll/{run_no}/adjustments/{id}` | same rule — an approved run is not edited |
| POST | `/overtime/{sheet_no}/import-form` | reads the company's own *FORM LEMBUR* export: `NO · NAMA · DESCRIPTION · GAJI · JAM · TTD` (D154) |

A payroll line now says what the paid days are made of — `days_present`,
`days_sick_paid`, `days_leave_paid`, `days_unpaid` — because a single total is
the one an employee argues with (D144). It also carries `days[]`: one entry per
day of the period with in, out, hours, overtime, the mark and **whether the day
was counted**, which is what the payslip's weekly recap prints (D156), plus
`late_minutes` as evidence — never as a deduction, because what a minute costs
has not been stated (Q41).

Writes need `hrd.create` / `hrd.update`; payroll needs `payroll.read` /
`payroll.run`; the two decisions need authorities, which no module level
implies (D24).

Three refusals are the point of this service:

```jsonc
// POST /payroll/pyr-26-09-11_01/approve
{ "error": { "code": "open_days", "status": 422,
  "message": "25 day(s) in this period are still unread — the machine left them
              incomplete and nobody has said what happened." } }

// POST /overtime/lbr-26-09-11_01/decide  {"step":"leader","approved":true}
{ "error": { "code": "surat_required", "status": 422,
  "message": "Surat lembur belum dilampirkan. Pimpinan menandatangani suratnya
              — tanpa itu yang disetujui hanya angka." } }

// POST /attendance/import  →  200, with a question attached
{ "data": { "added": 4, "duplicates": 1, "unknown": [ { "ref": "999", "count": 1 } ] } }

// POST /overtime/lbr-26-09-11_01/import-form  →  200, same shape, by name
{ "data": { "added": 3, "skipped": 1, "unknown": [ "Wahyu Pratama" ] } }

// POST /payroll/pyr-26-09-06_01/adjustments  {"kind":"late","amount":-45000}
{ "error": { "code": "reason_required", "status": 422,
  "message": "Potongan harus punya alasan — kalimatnya dicetak di slip gaji." } }
```

Events: `hr.payroll.approved`, `hr.overtime.approved` (emitted on the second
signature, not the first), and in Phase 2 `hr.attendance.imported`
(so the workshop supervisor's chat gets the day's unreadable list without
anybody opening the app).

## `marketing` — the Package programme

The ninth service (D183). Two funnels joined where an agent agrees.

| Method | Path | Notes |
|---|---|---|
| GET | `/markets` | country → region → city → local label, with each market's currency, time zone and language (D187) |
| GET | `/properties?scope=` | `scope` is a **prefix of the market code**: `AU`, `AU-QLD-GOLDCOAST`, or one district |
| GET | `/pipeline/metrics?scope=&level=` | the funnel by **property**; the scrape → enrichment gap grouped at `country`, `city` or `area`, with the currencies each group spans |
| GET | `/pipeline/queue?scope=` | past the seven-day line first, then due today — both **derived** from the sent date (D183) — each row carrying the agent's local time |
| PUT | `/properties/{ref}/agents/{id}/stage` | stamps the sent date on the first message and the reply date on any answer. **422 on `DEAL` without an onboarded rep** (D185) |
| POST | `/properties/{ref}/agents/{id}/move-on` | recycle this agent **and** message the next, in one act. Reason required |
| POST | `/properties/{ref}/agents/{id}/onboard` | the agent said yes: creates the representative with a commission rate. 409 if already onboarded; 422 outside 0–20% |
| PUT | `/properties/{ref}/validate` | a person agrees with the enrichment's score (D184) |
| GET | `/reps` | each with their referrals, the value won, and commission earned vs unpaid |
| POST | `/reps/{rep_no}/referrals` | an owner they introduced |
| PUT | `/referrals/{no}/status` | **422 on `WON`** without a project code and a contract value (D186) |
| GET | `/scrape` · POST `/scrape/import` | what the map scrape found. A row already here is skipped; a row naming a market nobody has defined is **reported, not created** (D187) |
| POST | `/scrape/{id}/promote` | becomes a property, `validated: false` until a person says otherwise |

Events: `marketing.agent.deal`, `marketing.rep.onboarded` — the two moments
somebody outside the module needs to know about.

## `production`

| Method | Path | Notes |
|---|---|---|
| GET | `/stages` | the seven, seeded and ordered (Q35) |
| GET | `/products` | `?include_inactive=1`. Each with its components priced and a material cost per unit — computed on read (D149) |
| GET | `/products/{product_code}` | one product with its bill of material — **at the draft revision where one is open, otherwise the newest released one**. Carries `viewing_rev`, `current_rev`, `draft_rev`, the revision history, and `draft_diff`: what the draft changes, **derived from the same component list** rather than fetched beside it (D256, F77) |
| POST | `/products/{product_code}/drawings` | link a `Gambar Kerja` or `Gambar Jadi`. A revision is a new file against the same product, never an edit (D150) |
| POST | `/products` | create or update by code, including `length_mm`/`width_mm`/`height_mm`. The **code is set once**: it is on the drawing, the work order and every BOM that references it |
| POST | `/products/{product_code}/components` | add or change a component: `{kind: "material" \| "product", ref_code, qty, uom, waste_percent}`. Lands on the **draft**, and **opens one as a copy of the released revision** if none exists (D256). **409 `revision_released`** on a line belonging to a released revision — refused rather than silently redirected, because somebody who opened rev 1 and typed into it means rev 1. **422 `bom_cycle`** where the component would close a loop **anywhere in the chain**, not only against itself, with the message naming where it closes (D257). 409 on a duplicate ref — change the quantity rather than adding a second row. The ref is **not** validated against the catalogue: a workshop knows it needs a steel frame before procurement has a code for one, and the screen shows unresolved codes plainly (A6) |
| DELETE | `/products/{product_code}/components/{id}` | audited like any other act — the BOM is what a purchase request gets built from. **409 `revision_released`** on a released line |
| POST | `/products/{product_code}/bom/release` | `{note}` — freezes the open draft. **422** without a note, on an empty revision, or on one identical to its predecessor: a version number for nothing is noise in a history somebody later has to read. 409 when no draft is open |
| GET | `/products/{product_code}/bom/revisions` | every revision, newest first, each with its component count, who released it, and how many work orders are pinned to it |
| GET | `/products/{product_code}/bom/diff?from=&to=` | what changed, line by line, computed from the two component lists rather than from an edit log (A3). Defaults to *the open draft against the newest released revision* |
| GET | `/products/{product_code}/materials?qty=12&rev=2` | what a run of that size needs, **walked through the sub-assemblies** down to purchasable things (D257) — waste compounding at every level, one line per material with every route it arrived by, the sub-assemblies it passed through listed apart, and the ones with no released BOM named as `unexploded` rather than dropped. Carries the typed `labour_cost` and `labour_total` (D239), and `cycle` where a product contains itself. A work order passes **its own pinned revision**; without `rev` the answer comes from the draft or the current released one (D256) |
| POST | `/products/{product_code}/labour` | `{labour_cost, note}` — the workshop's own time on one unit, **typed by a person**. **422 without a note**: a labour cost with no working behind it cannot be checked or updated, and it is the figure that reaches a quoted price. Null clears it back to *nobody has worked this out*, which is not the same as zero (D239) |
| POST | `/work-orders/{wo_no}/bom/repin` | `{reason}` — move an open order onto the newest released revision. A decision, not a refresh: it changes what the job's real spend is measured against, so it carries a reason and an audit row. **409 `already_started`** once anything has been built, because at that point the old list is what was actually consumed; `noop` when it is already there |
| GET | `/work-orders` | `?include_done=1`. **Late first, then by due date** — the board's job is to put the thing somebody has to deal with at the top |
| GET | `/work-orders/{wo_no}` | the order with per-stage progress, `current_stage`, `percent`, `days_left`, `late`, and the warnings in words. `stages` holds **only the stages on this order's route** — a stage the route does not contain is absent, not zero (D254). Also `at_vendor`, `days_at_vendor`, `subcon_overdue` and `goods_on_site`, all derived |
| POST | `/work-orders/{wo_no}/subcon/send` | `{vendor_id, expected_back?, note?}` — the goods go out to the vendor who builds them. 422 on an `IN_HOUSE` order (change the route, do not bolt a send date onto an order that says it is built here); 409 if it is already there. `expected_back` is the vendor's **promise** and prints with a `±` |
| POST | `/work-orders/{wo_no}/subcon/receive` | `{returned_on?, note?}` — the goods are back, and the stages on the route open up. 409 if it was never sent; `noop` if it is already back; 422 if the return date precedes the send date |
| POST | `/work-orders` | `{item_name, qty, uom, due_date, project_code?, route?}`. **422 with no due date**: an order that cannot be late is one nobody can tell is late. `route` is `IN_HOUSE` (default) or `SUBCON` — chosen, never inferred (D254) |
| GET | `/work-orders/{wo_no}/materials` | what the whole run needs, waste included — the list a PR gets built from (D151) |
| GET | `/work-orders/{wo_no}/progress` | every entry, newest first — including the ones a signed lembur sheet posted |
| POST | `/work-orders/{wo_no}/progress` | `{stage, qty, work_date, worked_by?, note?, source?, source_ref?}`. Append-only; a correction is a **negative qty with a note**. 422 over the ordered quantity; a stage ahead of the previous one is accepted and **warned about** (A6). **422 `stage_not_on_route`** for a stage this order's route does not contain, and **409 `still_at_vendor` / `not_sent_yet`** when the goods are not in the building — the one place production refuses rather than warns, because that refusal is about a place rather than a number (D255). Idempotent on `(source_ref, wo, stage)` |
| POST | `/work-orders/{wo_no}/close` | 422 with no reason when the quantity is not finished |

Writes need `production.update` — **except** an entry whose `source` is
`overtime_sheet`, which the `approve_overtime` authority may write, because
that posting is the consequence of the signature on the sheet and the signature
is its authority (D147).

Events: `production.work_order.closed`.

## `inventory` — stock and timber

Stock, added M27:

| Method | Path | Notes |
|---|---|---|
| GET | `/stock` | every counted item, whether or not it has ever moved — *we have none* and *nobody ever bought this* lead to opposite actions (D170) |
| GET | `/stock/{item_code}` | movements, which BOMs call for it, what is approved and not yet arrived |
| POST | `/stock/issue` | 200 **with `went_negative: true`** rather than a refusal — the wood is there or it is not (A6, D170) |
| POST | `/stock/return` | material coming back unused |
| POST | `/stock/adjust` | takes the **counted** quantity and a location; stores the difference. 422 without a reason; `outcome: noop` when the count matches (D171) |
| POST | `/stock/transfer` | writes two moves, one per location |
| PUT | `/stock/{item_code}/minimum` | null clears it — *belum ditetapkan* is not zero |

`procurement.receipt.confirmed` is consumed here: a confirmed delivery becomes
a `receipt` move at the item's home location, priced from the line where the
line carries a price and `null` where it does not (D172). A receipt whose line
names no catalogue item stocks nothing and says so.

## `inventory` — timber

| Method | Path | Notes |
|---|---|---|
| GET | `/timber/purchases` | every load, newest first, with volumes, yield and both prices per m³ |
| GET | `/timber/purchases/{purchase_no}` | one load: each log measured, each board reported |
| GET | `/timber/by-vendor` | **per vendor and species**: log m³, board m³, yield, rupiah per log m³ and **per board m³** — the last column is the one that decides (D153) |
| POST | `/timber/nota/read` | **a read that writes nothing.** Returns `is_timber`, the signals for and against **in words**, the species and total it found, the rows it made sense of, and the rows it could not. Nothing is filed from this — the routing decision is a proposal a person accepts (D200) |
| POST | `/timber/purchases` | a load arriving, **from its nota** (D201). Board and log rows read off the paper are filed here as timber and **never as transaction lines** — the nota contributes exactly one figure to accounting, its total. **422 with no invoice value**: without it there is no price per m³, which is the only reason the record exists. The seller's claimed m³ is stored beside our own measurement, never instead of it |
| POST | `/timber/purchases/{no}/logs` | one log: tag, Ø in cm, length in cm. 409 on a duplicate tag |
| POST | `/timber/purchases/{no}/boards` | boards off the saw: t × w × l in mm, and how many. Naming the log is optional — a day's sawing is usually one pile — and reporting boards off a log also marks that log sawn |
| POST | `/timber/purchases/{no}/logs/{tag}/sawn` | for the log that split and yielded nothing. It still counts against the yield, which is the point |
| GET | `/timber/boards` | **the rack**: one row per species and size, with what is on it, what was sawn, what was issued, m³, rupiah per m³ of board and a value. Computed from the sawing reports and the movements — no quantity is stored (A3, D203) |
| GET | `/timber/boards/moves` | one timeline, sawing included. The `sawn` rows are derived from the sawing reports rather than stored twice, so the rack cannot disagree with the rendemen |
| POST | `/timber/boards/moves` | `issue` · `return` · `scrap` · `adjust`. **409 `not_enough_boards`** on an issue or scrap larger than the rack — one of the few places this system blocks rather than warns, because a stack reading −4 is a count nobody can use again (D205); the message names the way through, an opname with a reason. **422** on an issue with no work order, on an adjust or scrap with no reason, and on `sawn`, which is reported through the sawing endpoint so the two can never differ. `purchase_no` is optional and **left null rather than guessed** — it decides what the issue cost (D204) |

Volumes are computed on read: `bulat` is π/4 × d² × L, `persegi` is d² × L, and
the purchase records which convention produced its number (Q39). Yield and
rupiah per board m³ use **only the logs actually sawn** and their share of the
invoice — dividing a whole invoice by the boards off half a load prices the
wood half again too high.

## `events` — the seam for a third service

| Method | Path | Notes |
|---|---|---|
| GET | `/outbox` | `?service=&type=&since=&undelivered=1` |
| POST | `/subscriptions` | `{url, event_types[], secret}` — a webhook |
| POST | `/outbox/{id}/replay` | redeliver |
| GET | `/openapi.json` | every service publishes one |

This is how Google Chat comes back, how a Sheets export is fed, and how any
future system attaches — by subscribing to events and calling the same
endpoints a person's browser calls. **No second write path** (§1.3: "we are
not building a second system").

Event names are `<service>.<entity>.<past tense>`:
`procurement.pr.submitted`, `procurement.approval.requested`, `procurement.line.approved`,
`procurement.round.closed`, `accounting.transaction.posted`,
`accounting.transaction.voided`, `accounting.allocation.recorded`,
`hr.payroll.approved`, `hr.overtime.approved`,
`production.work_order.closed`.

---

## Testing, so a contract is a promise

Each service ships with:

1. **contract tests** — every endpoint, happy path plus every refusal code
2. **RLS tests** — the same call as `finance`, as `employee`, as anon.
   The rekap warns that testing permissions with a service role "answers the
   wrong question" (§6.4); these tests run as a real signed-in user
3. **rule tests** — one per rule in `00-context.md` §A that the service owns.
   A18 is a test, not a paragraph
4. **the integrity job** (ADR-004) in CI against seeded data

A milestone is not DONE until its rule tests are green.


---

## `delivery`

The last leg (D209). Procurement owns what the client ordered and production
owns what came off the floor; this owns what happened to it afterwards.

| Method | Path | Notes |
|---|---|---|
| GET | `/fulfilment` | the board: per project, per order line — **ordered · made · left the yard · arrived · installed**, with the gaps. `made` is **null, not zero**, where no work order exists for that line (F60); `delivered` and `arrived` are different figures and both are shown, because goods on a truck have left the yard and are not on site (F62) |
| GET | `/fulfilment/{project_code}` | one project |
| GET | `/deliveries`, `/installations`, `/snags` | filterable by project; snags by open |
| POST | `/deliveries` | a consignment. **409 `not_enough_made`** when a line asks for more than has been finished and not already shipped, naming made, delivered and available (D210) |
| POST | `/deliveries/{no}/arrive` | **422** without a named receiver and the signed surat jalan — the same two halves receiving requires (D101). **409** on one already arrived or cancelled |
| POST | `/installations` | a visit and what was fitted. **409 `not_enough_on_site`** against `arrived − installed`, never against what merely left the yard |
| POST | `/snags`, `/snags/{no}/close` | raised by whoever saw it, client included; **422** without a description, a raiser, or — on closing — what was actually done |
| GET | `/po/approvals?for_email=&pending=` | purchase orders waiting for leadership's yes, as the chat card reads them (D267). Mirrors the approval-batch shape deliberately: same question, same road, and a second shape for it would be a second thing to keep right |
| POST | `/po/approvals/answer` | the answer, arriving from chat rather than the app. Deliberately **not** `requireAuthority` — the acting session is the chat worker, not the approver; what stands in for it is the token plus **403 `not_the_addressee`**, which is the stronger claim because it names the one person the card went to. **422 `reason_required`** on a decline with no sentence, **409** on one already answered or no longer a draft. The decision is recorded against the account that answered, never the acting session (D69) |
| GET | `/work-orders/{wo_no}/material` | what the run should take against what left the rack, from the order's **own pinned BOM revision** (D256). `expected` is **null**, never zero, for an item the BOM does not name — it comes back as `off_bom` instead. `variance_readable` is false until the run is finished, because half a run has taken half its material |
| POST | `/work-orders/{wo_no}/issue` | the trip that happened, not the trip the list called for. **422 `nothing_to_issue`** when every line is zero — the BOM's list is a proposal and an issue of nothing is a trip nobody made. **422 `not_stocked`** naming every offending line, checked **before any move is written**, because half an issue posted and half refused leaves the rack describing a trip that did not happen. **422 `location_required`**, **404** on an unknown SPK, **409** on a cancelled one. Going below zero is **allowed and flagged** (A6), with the negative lines named in the response — and warned in the form before the confirm as well |
| GET | `/work-names?from=&to=` | the names on production entries that nobody has resolved yet, **grouped by name** — with how many entries and pieces ride on each, where it appears, and a `suggestion` where exactly one active employee matches. `suggestion` is null when **none** matches and also when **several** do; the second case carries `ambiguous` instead, because *we could not tell which* and *we found nobody* are different answers needing different actions (D264). Returns the period's `attribution` beside it: linked, not-a-person, unresolved, and coverage |
| POST | `/work-names/resolve` | one answer for one name, applied to every unresolved entry carrying it in the window. **422 `one_answer_only`** when a name is declared both an employee and not-a-person — refused rather than silently preferring one, because either preference would be the software deciding. **422 `answer_required`** when neither is given: unresolved is a state somebody leaves on purpose, not by submitting. Already-resolved entries are never touched, and `noop` when nothing matched. **409** on an employee who has left, which is a sentence rather than a wall |
| POST | `/work-names/unresolve` | undoing one. Returns the entries to **unresolved**, never to *not a person*: *we were wrong* is not the same answer as *it is a team* |
| GET | `/boxes`, `/boxes/{box_no}` | packed crates, filterable by project, consignment or status. `{box_no}` is what the QR resolves to; **404 is an ordinary answer** here — a label from another job, or a code typed with a digit wrong. Each view carries `position` (*3 dari 5*), derived from the consignment, and `warnings` where the box record and the consignment record disagree |
| POST | `/boxes` | packing one crate. **422 `destination_required`** — where it goes *inside the building* is the one thing a delivery note cannot say and the whole reason this record exists (D262). **422 `contents_required`** on an empty box, because a label with no contents just moves the job of opening the crate to the site. **409 `wrong_project`** when the named consignment belongs to another project |
| POST | `/boxes/load` | attaching packed boxes to a consignment that is going out. **404** on any unknown code, **409** on a box already riding another lorry or on a cancelled consignment |
| POST | `/boxes/{box_no}/scan` | *it is here.* Deliberately has **no refusals**: a box the record says never left is standing in somebody's hands, and refusing the scan would mean it is never recorded at all — the disagreement surfaces as a `warning` on the view instead. Already on site, fitted or flagged returns **`noop`**, so a second tap never undoes the more specific fact already recorded |
| POST | `/boxes/{box_no}/install` | **409 `not_on_site`** when nobody has scanned it — the same rule `/installations` holds one level up, and the only refusal in the whole box flow |
| POST | `/boxes/{box_no}/problem` | **422 `problem_note_required`**. The person holding the box is the only one who will ever know what was wrong, and a red flag with no sentence on it cannot be acted on by anybody in the workshop. Flagging also counts as a sighting: it stamps the scan if there is not one already |
| POST | `/handovers` | the BAST. **422 `bast_required`** without the signed document (D211) — the one refusal here that is about a claim rather than about money. **409** when the project is already handed over, or when nothing has been recorded as delivered or installed at all. Open snags do **not** block it; their count and numbers are **frozen onto the record** (D212) |

`project` module at `write` for every POST above. Building these screens found
that nobody in the seed held it (F61).


---

## `assistant` — John Lau

Turns a sentence into **named calls against the endpoints above**. It owns no
data of its own beyond the conversation, and it is **not a module anybody can
be granted**: it acts with the grants of the person typing (D219).

| Method | Path | Notes |
|---|---|---|
| GET | `/assistant/tools` | the whole catalogue, **including the closed entries**, each with its reason in full. The boundary is a page anybody can read, because a boundary nobody can check is not one (D218) |
| GET | `/assistant/turns` | your own conversation only. Somebody else's questions are a record about them |
| POST | `/assistant/ask` | `{prompt}`. Three gates in order: **is the tool reachable from a prompt at all** (blocked ones refuse here, before permissions, so the refusal reads the same for the CEO as for a new hire); **does this person hold the grant**; **is it a write** (then it is a draft). The reply separates `text` from `facts`, and every fact carries the tool that produced it and the screen showing the same number (D217) |
| POST | `/assistant/drafts/{turn_id}/confirm` | `{fields}` — the payload **as shown and edited**, not as originally parsed. The grant is re-checked here: a draft is not a licence. Idempotent on the draft's key |
| POST | `/assistant/drafts/{turn_id}/abandon` | nothing was written, and the turn says so |

**Closed at every grant level** (D218): `hr.employee_files`, `hr.payroll`,
`hr.attendance`, `it.audit`, `it.settings_write`. The first and the fourth are
the owner's answer; the middle three are a default taken and marked as such in
the catalogue, so reversing one is a single line.

**A read through the prompt is a read.** It writes an `activity_events` row
exactly as opening the screen would (D188). A *refused* ask writes an audit row
recording that the boundary held — **without the prompt text**: asking for a
salary is not misconduct, and a permanent record of the question would be a
worse trail than none.
