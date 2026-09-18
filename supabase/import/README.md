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
| 5 | `items` → `ops_procure.items` | 1.020 | **held** — needs a decision, see below |

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

### Step 5 needs a decision, and it is the owner's

`04-data-migration.md` says steps 1–5 "resolve cleanly". Measured against the
live database on 2026-09-18, items do not:

| | items |
|---|---:|
| **`unit` blank** | **587** |
| matches an `ops_procure.uom` code after lowercasing | 288 |
| still unmatched, across 32 distinct values | 145 |

`ops_procure.items.base_uom` is `not null` and references `ops_procure.uom`, so
none of the 732 can land without an answer. The 288 are free — a case fold.
The other two groups are questions:

**The 587 blanks.** There is no unit in the old system. Picking one here would
be inventing a fact about a thing somebody buys.

**The 32 unmatched values**, and most are not typos — they are units this
business genuinely uses and the new vocabulary does not have:

```
liter 25 · dus 24 · orang 22 · pail 16 · lot 10 · galon 5 · kaleng 4
pail/drum 4 · dos 3 · pak 3 · botol 2 · ds 2 · l 2 · pax 2 · person 2
rim 2 · roll/pcs 2 · and 15 more with one item each
```

Some fold (`l`, `liter` → `ltr`; `btg` → `batang`; `ds`, `dos` → `dus`). Some
do not exist in `ops_procure.uom` at all — `orang`, `lot`, `galon`, `pail`,
`drum`, `rim`, `botol`, `kaleng` — and forcing them into `pcs` would record a
measurement the business does not use. `uom` is a table; adding rows to it is
cheaper than losing the distinction.

Neither question is one an import should answer on its own, so it does not.

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
