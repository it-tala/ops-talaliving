# `supabase/import/` — reading the legacy system

Not `supabase/migrations/`, and that is enforced. `check_schema_isolation.sh`
refuses any migration naming a schema outside `ops_*`, because the whole safety
of putting both systems in one database rests on the ladder touching nothing of
the old one. An import reads `public.*` by definition, so it cannot be a
migration. It lives here, and the ladder keeps replaying from nothing with no
legacy database present.

## How to run it

```bash
export PGPASSWORD='…'
psql -h aws-0-ap-northeast-1.pooler.supabase.com -p 5432 \
     -U postgres.hhphmfqbtwcxpvubmwbq -d postgres \
     -v ON_ERROR_STOP=1 -f supabase/import/01_reference.sql
```

Every file is **idempotent**: running it twice imports nothing the second time
and changes no row it imported the first. That is `ops_core.legacy_map`'s whole
job (`0030`), and it is not a nicety — an import against a database somebody is
still using is run, reconciled, corrected, and run again. Without it the second
run is a duplicate, and what gets duplicated is money.

Each file ends by printing what it did. Read that, not the exit code.

## What is here, and what is deliberately not

| step | source → target | rows | state |
|---|---|---:|---|
| 1 | `chat_users` → `ops_core.users` | 9 | **held** — needs auth accounts, see below |
| 2 | `accounts` → `ops_acct.accounts` | 6 | `01_reference.sql` |
| 3 | `projects` → `ops_procure.projects` | 5 | `01_reference.sql` |
| 4 | `vendors` → `ops_procure.vendors` | 296 | `01_reference.sql` |
| 5 | `items` → `ops_procure.items` | 1.020 | `02_items.sql` |
| 6 | `transactions` → `ops_acct.transactions` | 3.235 | `03_ledger.sql` |

### Step 1 is not an `insert … select`

`04-data-migration.md` lists it as one. It is not, and the reason is a
constraint rather than an oversight: `ops_core.users.id` is a foreign key to
`auth.users(id)`. A profile row cannot exist for somebody GoTrue has never
heard of.

So importing the nine `chat_users` means **creating nine authentication
accounts**, which is not a SQL insert — it is GoTrue's admin API, or nine
invitations. It is also a decision about people rather than data: who among the
nine should be able to sign in at all. `0029` made the second half harmless —
an account that signs in for the first time provisions its own profile — so the
honest order is *invite, then they arrive*, not *insert, then hope*.

Held out of `01_reference.sql` rather than half-done.

### Step 5 — answered, 2026-09-18

`04-data-migration.md` said steps 1–5 "resolve cleanly". Measured against the
live database, items did not: **587 of 1.020 had no unit at all**, 288 matched
only after a case fold, and 145 used 32 names the new vocabulary did not have —
and most of those were not typos but units this business genuinely uses.

The owner answered both halves:

> *import semuanya, tanpa satuan biarkan apa adanya*
> *tambahkan satuan dalam bahasa inggris*

`0031` carries them. Twelve units were added in English — `person`, `pail`,
`lot`, `carton`, `gallon`, `can`, `bottle`, `ream`, `drum`, `bale`, `bag`,
`ml` — plus `day`, `week` and `month`, which needed a **time** dimension the
type did not have: calling a day a `count` would let a conversion one day be
asked how many days are in a kilogram.

Six legacy names fold onto units that already existed (`liter`→`ltr`,
`btg`→`batang`, `cbm`→`m3`, `pak`→`pack`, `dz`→`lusin`, `m`→`meter`), because
two codes for one thing is a catalogue that disagrees with itself.

And **`base_uom` is now nullable**, which is what *leave them as they are*
requires: `not null` left only two options, inventing a unit for 587 things
somebody buys or leaving 58% of the catalogue unimported. A null means nobody
wrote one down — a question somebody can answer. A defaulted `pcs` would mean
*one piece*, indistinguishable from the items that really are counted that way.

Nine items keep no unit for a different reason: `fil`, `gendel`, `ltrset`,
`roll/pcs` and `pail/drum`. The last two name two units at once, which is not a
unit. Their original text is kept in `legacy_map.note`.

### Step 6 — the ledger, and why it cannot be done in halves

Reference data can. A vendor that did not come across is one somebody notices
is missing.

A ledger cannot. **Every opening balance in `ops_acct.accounts` is 0 as of
2026-01-01 and the legacy data begins 2026-01-01**, so a balance in the new
system is exactly the sum of what `03_ledger.sql` imported. A row left out does
not show as a gap — it shows as a balance that is wrong, on a screen that looks
identical to one that is right.

That is why `0042` had to land first. Five transaction types existed in the old
system and not the new one, covering 473 rows and **Rp 1,26 miliar**; an import
may not invent a category, so the codes had to be added deliberately (owner,
2026-09-21) before anything could run.

It is also why the file ends with a reconciliation rather than a summary: net
movement per account, ours against theirs, which must agree to the rupiah.
**Read that, not the exit code.** A difference is not a rounding question — it
is a row the import did not carry.

Three things it resolves that the old schema kept as text:

- **the author.** 706 of the 3.235 have one, recoverable through
  `event_id → raw_events.sender → chat_users.email`, and it is carried. The
  other 2.529 have none anywhere, and `posted_by` is `not null`. Owner,
  2026-09-21: **`shared@talaliving.com`** — put to them with the cost attached,
  that it is an account people sign in to and the trail will read as though it
  posted them, and chosen anyway. Every such row is marked in `legacy_map`, so
  *which ones had a real author* stays answerable.
- **the vendor**, by name. 276 of 281 distinct names resolve.
- **the project**, by **name** and not by code — `transactions.project` holds
  `BABY ISLAND`, not `25007`. 655 of 666 rows resolve. Among the eleven that do
  not is `CHAIR PHILIPPINES`, which the project table spells
  `CHAIR PHILIPHINES`: two live systems disagreeing about a name, which must
  surface as a refusal rather than be matched away by a fuzzy comparison.

Booking the money twice is guarded three times over, and each layer was proved
by removing the one above it: the `legacy_map` gate, `source_ref` unique, and
`trx_no` unique.

`trx_no` carries the legacy number across unchanged. The old id is
`trx-26-01-02_001` and `ops_acct.transactions.trx_no` is documented as
`trx-26-09-11_014` — the same format, because the new numbering was written
from the old. So the number people already quote keeps working, and a
screenshot from January still finds its row.

## What the import must never do

**Never invent a reference silently.** A vendor created from a typo is a
duplicate nobody will ever find. Where a name does not resolve, the row lands
with the reference null and the original text preserved, and the legacy row is
recorded `refused` with the reason — which is what makes the reconciliation a
list somebody can work through rather than a discrepancy somebody discovers.

**Never import derived state.** `item_status` and `qty_lacking` are stored in
the old system and computed in the new one (A3). If the view disagrees with the
stored value, that disagreement is the new system finding a row the old one got
wrong — and writing the legacy value across would destroy exactly the signal
the design exists to produce.

**Never write to `public.*`.** Every statement here reads the legacy schema and
writes only `ops_*`. The old system is still running.
