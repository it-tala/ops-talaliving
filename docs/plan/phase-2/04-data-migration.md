# B8 — the data migration, measured

**Status: the inventory exists now. It did not before, and that absence was the
largest unknown in Phase 2.**

`README.md` named the gap plainly: *"Nothing has been written down about what
has to come across from Google Sheets and `john-lau`, in what state, and who
decides when a messy row is good enough to import."* `03-estimate.md` priced
the consequence — B8 is **2–8 sessions**, the only open-ended range in the
plan, and the item that decides whether the total is 20 sessions or 33.

This file closes the measuring half of that. Every number below was read from
the live `john-lau-v01` database on **2026-09-18**, not estimated. What it does
not close is the deciding half: four questions at the end need a person, and
they are now questions with numbers attached rather than questions in the
abstract.

Nothing here has been applied. No migration has run against `john-lau-v01`,
and this document does not change that — applying the ladder is a reviewed step
in the cutover runbook (`README.md`), not a side effect of writing an inventory.

---

## What is actually there

Counted, not guessed. Totals are the whole table; the qualifiers underneath are
what makes a row hard rather than easy.

| legacy table | rows | what makes it hard |
|---|---:|---|
| `public.transactions` | 3.235 | 1.804 `UNTRACKED` + 605 `null` status — **74% are not `COMPLETED`** |
| `public.item_purchases` | 1.194 | line-level detail hanging off `trx_id` |
| `public.pr_lines` | 264 | 41 columns; one row carries request, approval, receipt, payment and PO state |
| `public.pr_approvals` | 562 | already a trail, maps almost directly |
| `public.pay_allocations` | 229 | supersession already modelled |
| `public.items` | 1.020 | 3 normalised name collisions |
| `public.vendors` | 296 | **1** normalised name collision |
| `public.po_lines` | 38 | |
| `public.po_payments` | 29 | |
| `public.pr_documents` | 22 | |
| `public.receiving_reports` | 16 | |
| `public.po_schedule` | 16 | |
| `public.purchase_orders` | 15 | |
| `public.payment_requests` | 11 | |
| `public.chat_users` | 9 | the only user directory that exists |
| `public.accounts` | 6 | |
| `public.projects` | 5 | |

**The ledger is one financial year.** Every one of the 3.235 transactions falls
in **2026**, totalling **Rp 15.068.740.826**, and **none** has a null
`trx_date`. The question `03-estimate.md` asked — *"opening balances plus this
financial year, or every transaction since 2023?"* — turns out not to be a
choice: there is only this year. That removes the largest branch in B8's range.

**Vendors and items are already clean enough to import blunt.** D30 says the
system takes them uncurated, so the worry was volume of duplicates. There is
1 collision in 296 vendors and 3 in 1.020 items. Curation is ordinary work
afterwards, exactly as designed — it is not a blocking clean-up, and it does
not belong on the critical path.

---

## The three structural problems

These are the work. Everything else is `insert … select`.

### 1. `legacy_ref` does not exist

`README.md` states the arrangement's safety rests partly on: *"The import is
idempotent by `legacy_ref`."*

**There is no `legacy_ref` column anywhere** — not in `supabase/migrations/`,
not in `src/`. The only target table that can currently recognise a row it has
already imported is `ops_acct.transactions`, via `source_ref text not null
unique` (`0013_acct_ledger.sql:94`). Every other target table would happily
insert the same legacy row twice.

That matters more than it looks. An import against a database that is *still
being written to* is not run once — it is run, reconciled, corrected and run
again. Without a legacy identity column the second run is not a no-op, it is a
duplicate, and the thing being duplicated is money.

**This is a migration to write before B8 starts, not a detail to handle inside
it.** Either a `legacy_ref text unique` on each imported table, or a single
`ops_core.legacy_map(source_table, source_id, target_table, target_id)`. The
second keeps the domain tables clean and gives the reconciliation report a
place to live; the first is fewer joins. That choice is open.

### 2. Every reference is text, and the target is a foreign key

The legacy schema points at things by name. The new schema points at them by
id, with the constraint that earns it.

| legacy | new | resolution needed |
|---|---|---|
| `transactions.vendor` (text) | `ops_acct.transactions.vendor_id` | name → `ops_procure.vendors.id` |
| `transactions.project` (text) | `.project_id` | name → `ops_procure.projects.id` |
| `transactions.account` (text) | `.account_id` | code → `ops_acct.accounts.id` |
| `pr_lines.vendor` (text) | `ops_procure.pr_lines.vendor_id` | name → vendors |
| `item_purchases.item_raw` | `ops_procure.pr_lines.item_id` | free text → items |

Measured, so the size is known rather than feared:

- `account`: **0 of 3.235** transactions name an account that is not in
  `accounts.code`. This resolves perfectly and needs no human.
- `vendor`: **68 of 3.235** transactions name a vendor that does not exist in
  `public.vendors`. Those 68 are the real work — each is either a vendor to
  create, a spelling to fold into an existing one, or a row that should carry
  no vendor at all.

68 rows is a morning's decisions, not a project. But it is 68 decisions
somebody has to make, and the import has to have a defined behaviour for a name
it cannot resolve. **Proposed: never invent a vendor silently.** Import the
transaction with `vendor_id` null and the original text preserved in `remark`,
and emit the 68 as a reconciliation list. A silently-created vendor named after
a typo is a duplicate nobody will ever notice.

### 3. `pr_lines` is one row that becomes five

`public.pr_lines` has 41 columns because it is the whole procurement lifecycle
flattened: `approve`, `approved_qty`, `finance_approval`, `date_received`,
`qty_received`, `proof_link`, `pay_id`, `po_id`, `moved_from`, `release_on`.

The new schema splits that deliberately — it is ADR-002 and A3 applied: derived
state is computed, never stored. One legacy row fans out to:

| legacy columns | target |
|---|---|
| description, qty, unit, price, vendor, category, due_date | `ops_procure.pr_lines` |
| `approve`, `approved_qty`, `approved_amount`, `ejo_*`, `finance_*` | `ops_procure.pr_approvals` |
| `date_received`, `qty_received`, `received_by`, `receiving_link` | `ops_procure.receipts` |
| `pay_id`, `proof_link`, `trx_id` | `ops_procure.payment_round_lines` / `ops_acct.payment_allocations` |
| `po_id`, `po_link`, `po_payment_kind` | `ops_procure.po_lines` linkage |
| `item_status`, `qty_lacking` | **nothing** — derived by view |

The last row is the one to be careful about. `item_status` and `qty_lacking`
are stored in the legacy system and computed in the new one. **They must not be
imported.** If the derived view disagrees with the stored legacy value, that
disagreement is information — it is the system finding a row the old one got
wrong — and writing the legacy value across would destroy exactly the signal
the design exists to produce. Reconcile them, report the differences, import
neither.

---

## Import order

Forced by the foreign keys, and it is also the order in which a failure is
cheapest.

```
1  ops_core.users          ← public.chat_users (9) + app_roles
2  ops_acct.accounts       ← public.accounts (6)          — resolves 100%
3  ops_procure.projects    ← public.projects (5)
4  ops_procure.vendors     ← public.vendors (296)
5  ops_procure.items       ← public.items (1.020)
   ── reference data complete; everything below can resolve its keys ──
6  ops_acct.transactions   ← public.transactions (3.235)  — 68 unresolved vendors
7  ops_procure.pr_documents / pr_lines / pr_approvals
8  ops_procure.purchase_orders / po_lines / po_schedule
9  ops_procure.receipts    ← public.receiving_reports
10 payment rounds, allocations, settlements
```

Steps 1–5 are 1.336 rows and resolve cleanly. They are worth running first on
their own, because they make every later step's key resolution a join rather
than a guess.

Per `check_schema_isolation.sh`, none of this belongs in
`supabase/migrations/`: an import reading the legacy tables lives in
**`supabase/import/`**, which does not exist yet and is the next thing to
build. The ladder must keep replaying from nothing without a legacy database
present.

---

## The four questions that still need a person

`03-estimate.md` said these gate B8. Three now have measurements attached; the
fourth is unchanged because it is not a measurable question.

| question | what the measurement says | still needed |
|---|---|---|
| How much ledger history? | Only 2026 exists — 3.235 rows, Rp 15,07 mrd, no null dates | **Answered by the data.** All of it. |
| How many duplicate vendors/items? | 1 of 296, 3 of 1.020 | **Answered.** Import blunt per D30. |
| Attendance history? | Out of scope here — no HR tables in `john-lau-v01` | Confirm the biometric machine starts fresh at cutover |
| **Who decides when a messy row is good enough?** | The concrete queue is **68 unresolved vendor names** and **2.409 non-`COMPLETED` transactions** | **A named person.** This is the one that stalls the session if it is unanswered when B8 starts. |

The last row is the real gate. 2.409 transactions carry `UNTRACKED` or no
status at all — that is 74% of the ledger, and the import needs a ruling on
whether they come across as-is, come across flagged, or wait. That is a
business judgement about money, and it is not one this repository can make.

---

## What this does not cover

Google Sheets. `03-estimate.md` names Sheets alongside `john-lau` as a source,
and everything above is the database only. The sheets are reachable from the
legacy system's own pipeline (`sheet_ref`, `sheet_gid`, `sheet_row` appear
throughout), so the question is whether anything lives *only* there and never
landed in Postgres. Answering that needs access this session does not have.
