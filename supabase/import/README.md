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
| 1 | `chat_users` → `ops_core.users` | 9 | `03_chat_users.sql` — 7 stand, 2 removed by decision |
| 2 | `accounts` → `ops_acct.accounts` | 6 | `01_reference.sql` |
| 3 | `projects` → `ops_procure.projects` | 5 | `01_reference.sql` |
| 4 | `vendors` → `ops_procure.vendors` | 296 | `01_reference.sql` |
| 5 | `items` → `ops_procure.items` | 1.020 | `02_items.sql` |
| 6 | `transactions` → `ops_acct.transactions` | 3.287 | `03_ledger.sql` |
| 7 | `item_purchases` → `ops_acct.transaction_lines` | 1.194 | `04_lines.sql` |
| 8 | `transaction_docs` → `ops_core.attachments` + `attachment_links` | 237 | `05_evidence.sql` |
| 9 | `products` → `ops_prod.products` (+ drawing links) | 27 | `06_products.sql` — needs `0060`–`0066`, `0108`–`0110` — **applied 2026-09-23: 27 products, 27 drawing links** |
| 10 | corrections to what the import carried faithfully | 2 | `07_corrections.sql` — **applied 2026-09-23** |

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

It was held out of `01_reference.sql` rather than half-done, and the owner
answered on 2026-09-21: **finish all nine.** `03_chat_users.sql` does it.

What makes that safe to run as a script, when the decision it encodes is about
people, is that **it grants nothing**. `provision_user()` lands a profile with
no modules and no authorities (D24), and the legacy `core.fn_sync_auth_user()`
— which fires off the same insert, because both systems hang a trigger on
`auth.users` — lands one with no role. Nine people can sign in and see nothing
until somebody holding `it.manage_roles` decides what they may open. Being
known and being allowed stay separate, which is the whole reason provisioning
is not a grant.

No password is set by anybody: each account gets 32 random bytes, hashed and
discarded in the same expression, recorded nowhere. The way in is
`requestPasswordReset` from the sign-in screen, then `/set-password` —
`email_confirmed_at` is set so that road is open immediately. The script sends
no invitation, which is the correct order: an invitation that arrives before
the grant is an invitation to an empty app.

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

### Step 7 — what the money was spent on

`03_ledger.sql` carried 3.221 transactions and every one of them says *Rp
250.000 to UD SUMBER REJEKI* without saying what was bought. D86 is that a
purchase is itemised, and the reason is not tidiness: it is what lets a
catalogue learn a real last-paid price from its own rows rather than from a
number somebody copied.

Five of the 1.194 are refused — their transaction is one of the fourteen
`03_ledger.sql` refused for `idr_amount = 0` — and the refusal names that
transaction, so the two lists join up instead of each looking like an
unexplained gap.

Two things it deliberately does not do. It does not touch
`ops_procure.items.last_price`, which is derived state the new system computes
(A3); writing the legacy value across would destroy the disagreement that is
the whole signal. And it does not reconcile a line total against its
transaction: **1.182 of 1.188 sum exactly, three sum over and three sum
under**, and a line adjusted to make an arithmetic check pass is a fact
replaced by a preference. The six are printed so somebody asks.

### Step 8 — 237 documents over 148 files

Only 148 of the 237 links are distinct: **28 files are cited by more than one
transaction**. That is not duplication to clean up — `guide.pay_line` says it
in the office's own words, *satu bukti transfer boleh menutup beberapa
pembelian*. So the import writes 148 attachments and 237 links, and the
separation is the reason `ops_core` has two tables: an attachment is a file, a
link is a claim about what that file evidences.

`transaction_docs` carries a link and nothing else, so the file's name,
checksum, size and type come from `public.blobs` — joined on the **link**, not
on `event_id`, because 63 events have more than one blob and one has eleven.
All 237 join exactly one blob, measured.

A file cited only by a document on a refused transaction is not imported
either. An attachment nothing points at reads as filed on an evidence screen.

**982 transactions carry a `drive_link` of their own with no `transaction_docs`
row, and this import leaves every one alone.** 702 have a file behind the link
and 280 have nothing but a URL. Most of them are already moving through
`ops_acct.evidence_inbox`, where a person looks at each and files it; an import
racing that pipeline would reach the same file from two directions. And a row
built from a bare URL claims a document exists while knowing nothing about it,
which is worse than no row.

### The gap step 8 compensates for rather than fixes

**`ops_core.attachments` has no unique key on `url` or `sha256`.** Nothing in
the schema stops one Drive file existing twice under two ids, and there are now
two writers: this import and `ops_acct.file_evidence()`, the live capture door
that has already produced 38 attachments from `ledger_review_queue`.

None of those 38 is one of these 148 today — checked, not assumed — so
`05_evidence.sql` resolves each file against an existing `url` before creating
anything. That is a compensation. The fix is a constraint, and adding one would
change how `file_evidence()` behaves on a retry, which belongs in a migration
with its own reasoning rather than in an import.

## What has actually been run

A table, because *is the ledger in yet* is a question somebody asks from a
phone and should not have to answer by reading SQL. The commit that added
`03_ledger.sql` says *nothing has been run against production yet*, which was
true when it was written and stopped being true an hour later — a sentence in
a commit message cannot be corrected, so the record lives here.

| file | against `john-lau-v01` | result |
|---|---|---|
| `01_reference.sql` | yes | 296 vendors, 4 projects, 6 accounts mapped |
| `02_items.sql` | yes | 1.020 items |
| `03_ledger.sql` | **2026-09-21** | 3.221 imported, 14 refused, all five accounts reconciled |
| `04_lines.sql` | **2026-09-22** | 1.189 lines on 1.188 transactions, 5 refused |
| `05_evidence.sql` | **2026-09-22** | 148 files, 226 claims over 197 transactions, 0 refused |
| `06_products.sql` | **2026-09-23** | 27 products, 27 drawing links |
| `03_ledger.sql` (again) | **2026-09-23** | 0 imported, **52 map rows repaired** — see below |
| `07_corrections.sql` | **2026-09-23** | 1 line re-filed, 59 transactions given their vendor |

`03_ledger.sql` was run as a **dry run first** — the whole file inside a
transaction that was rolled back — and the numbers it printed were the numbers
the real run produced. That is worth doing again for anything that touches
money: it costs one minute and it is the only way to see a reconciliation
before committing to it.

These are the figures as of **2026-09-23**, not as of the first run. The old
system is still live and still writing, so this table is a snapshot with a date
on it; an undated balance in a document is a balance somebody will quote next
month.

```
account      ours           legacy         verdict
BCA 064      21.259.068     21.259.068     agrees
BCA 271       4.285.326      4.285.326     agrees
BNI 325         148.132        148.132     agrees
JAGO         10.473.352     10.473.352     agrees
PETTY CASH      858.298        858.298     agrees
```

**3.273 transactions against the legacy table's 3.287.** The fourteen that did
not come across are all `idr_amount = 0`, three of them described `void`, so
refusing them moved no balance — which is why the five accounts still agree to
the rupiah. 699 carry the author the old system recorded; the rest are posted
as `shared@talaliving.com`. A second run stages **0 rows**, checked against
production rather than assumed.

### The manual ledger, checked against both

The owner's `2026 TALAHOME LEDGERS` workbook keeps its own running balance per
account, in the summary row above the header of the main 2026 tab. Against it:

```
account      this system    manual sheet   verdict
BCA 064      21.259.068     21.259.068     agrees
BNI 325         148.132        148.132     agrees
PETTY CASH      858.298        858.298     agrees
BCA 271       4.285.326      4.008.544     differs by 276.782
JAGO         10.473.352     —              the sheet has no column for it
```

Three of four to the rupiah, against a sheet kept by hand, by different people,
in a different tool. The fourth is **Rp 276.782 on BCA 271**, and the honest
reading is that it is the sheet's: both systems agree with each other on that
account, no transaction of that amount exists on either side, and no run of
recent rows sums to it, so it is not simply a sheet that is a few days behind.
Somebody with the bank statement settles it; nothing here should be changed to
make it close.

**What could not be checked.** The workbook has 83 tabs and the export
truncates each one to about 95 rows, so the sheet's own arithmetic — how that
summary row is reached from its ledger — was not verified, only its result. One
of those tabs is an `AI LEDGER — LIVE SUMMARY` written by the old Apps Script
system; it is not an independent witness and was not used.

### The 52 rows that had no map entry

Found on 2026-09-23 and worth recording, because it is the failure
`ops_core.legacy_map` exists to prevent. Fifty-two transactions the old system
wrote after the first run were in `ops_acct.transactions` with their
`source_ref`, and had **no row in the map at all** — imported by hand rather
than by the script.

No money was duplicated, and the reason is worth keeping: the insert is
`on conflict (source_ref) do nothing` against a unique index, so a re-run could
not have doubled them even though the map's guard would have staged them.
Belt and braces, and the braces held.

What was lost was the map's notes — which of those 52 had a borrowed author,
an unresolved vendor, a missing type. Re-running `03_ledger.sql` restored
them: **0 transactions inserted, 52 map rows written.** Every legacy table now
maps row for row — transactions 3.287, item_purchases 1.194, transaction_docs
237, vendors 296, items 1.020, products 27.

### What steps 7 and 8 found

**Six transactions whose lines do not add up**, and they are two different
problems wearing the same shape:

| transaction | says | its lines say | difference | lines |
|---|---:|---:|---:|---:|
| `trx-26-07-27_061` — **fixed** | 2.500 | 15.850.000 | **+15.847.500** | **2** |
| `trx-26-07-15_020` | 55.000 | 85.000 | +30.000 | 1 |
| `trx-26-07-13_093` | 21.001.514 | 21.011.514 | +10.000 | 1 |
| `trx-26-07-21_020` | 36.000 | 35.000 | −1.000 | 1 |
| `trx-26-08-26_091` | 5.217.500 | 5.217.000 | −500 | 1 |
| `trx-26-08-19_040` | 1.970.674 | 1.970.670 | −4 | 1 |

**Five are one line disagreeing with its own row** — a receipt says one thing
and the ledger another, by between Rp 4 and Rp 30.000. Accounting settles each
from the document, on the ledger screen. Proved as Anggun against production
(rolled back): raising 55.000 to 85.000 and lowering 36.000 to 35.000 both land
and both reconcile.

**The sixth is not a mistyped amount, and reading it as one is the trap.** It
was described that way here before anybody looked at its lines:

```
transaction : 2026-07-24  OUT  2.500  BANK CHARGES — "Transfer admin fee"
its lines   : 2.500       — Transfer admin fee
              15.847.500  — Transfer funding for pay-26-07-27_01
```

**The Rp 2.500 is correct.** It is a bank admin fee. The second line is a
funding transfer that belongs elsewhere — `trx-26-07-27_900` exists on the same
date for exactly Rp 15.847.500 with the same description. A line was filed
against the wrong transaction in the old system, and the import carried it
across faithfully, which is what it is supposed to do.

So the fix is **not** `edit_transaction`. Raising the amount to make the
arithmetic pass would turn a Rp 2.500 bank charge into Rp 15,85 juta — and that
correction was demonstrated in a rolled-back session before the lines were
read, which is how this was caught. What it needs is a line moved, and nothing
in the web app can do that: `transaction_lines` carries an insert policy and no
update or delete policy at all, so no grant in the system lets anyone re-file a
line from a screen. That is deliberate — moving money between rows is not an
edit — and it makes this SQL or nothing.

**Done, 2026-09-23**, by `07_corrections.sql`: the line moved to
`trx-26-07-27_900`, neither transaction's amount touched, one `refile` row in
`ops_core.audit_log` carrying the before and the after, and the map annotated.
Both transactions now agree with their own lines. `actor_id` on that audit row
is null on purpose — a script did it, and `detail` says which script; naming a
person there would be the audit trail telling its first lie.

The general shape, worth keeping: **a total that does not add up says which
number to distrust only when there is one line.** With two, the disagreement
may be about which row a line belongs to, and the totals say nothing about
that.

**Eleven documents repeat a claim another already made** — same file, same
transaction, same kind — so 237 documents produced 226 links.
`links_live_idx` collapses them, which is right: two identical claims are one
claim. Each repeat is recorded in the map pointing at the link that exists.

**One transfer proof evidences nine transactions.** That is the arrangement
this import was shaped around, and the largest instance of it in the data.

Of the 148 files, **128 carry the uploader the old system recorded** and 20 are
`shared@talaliving.com`. All 148 have a checksum.

The 38 attachments that the capture pipeline had already filed have no links of
their own — they came in through `ops_acct.evidence_inbox`, where filing and
linking are separate acts. None of them was one of these 148.

Left for a person, all of it queryable from `ops_core.legacy_map`:

- **460 transactions with no vendor**, 59 of which name one that resolves to
  nothing. The name is kept; the vendor was never created.
- **2.570 with no project**, including the `CHAIR PHILIPPINES` /
  `CHAIR PHILIPHINES` disagreement.
- **10 filed `OTHERS`** because the legacy row had no type, each one noted.

There is no screen for that list yet. It is the obvious next thing, alongside
`item_purchases` (1.194 rows → `ops_acct.transaction_lines`) and
`transaction_docs` (237 → evidence).

### Vendors that did not resolve, and the eight that did on 2026-09-23

`03_ledger.sql` matches a vendor by the name as written, or leaves it null.
Eleven legacy names did not match. Eight were the **same name with different
punctuation**, and `07_corrections.sql` resolved them — 59 transactions:

```
ALMART                    AL MART                  V-0002   39 trx
ALRIZKY JAYANA            AL RIZKY JAYANA          V-0059    6
MR DIY                    MR D.I.Y.                V-0028    7
GRAN MAX-SUNARNO          GRAN MAX - SUNARNO       V-0094    2
GRAN MAX-ANDI             GRAN MAX - ANDI          V-0071    2
MOJO INDAH,               MOJO INDAH               V-0097    1
FAHRUL JATI-  JAMALLUDIN  FAHRUL JATI- JAMALLUDIN  V-0199    1
FAFA KONVEKSI-SUNARNO     FAFA KONVEKSI - SUNARNO  V-0110    1
```

**This is canonicalisation, not fuzzy matching**, and insisting on the
difference is the point. Strip everything that is not a letter or a digit and
the two strings are byte-for-byte equal — no threshold, no edit distance, no
judgement. The rule also refuses to act unless exactly one vendor canonicalises
to that form, which matters: `TALA HOME PT` and `TALAHOME PT` both become
`TALAHOMEPT`, and a name that becomes ambiguous when the punctuation goes has
to resolve to nothing rather than to a coin toss.

The import itself still must not do this. It carries what the old system wrote.
Deciding that two spellings are one vendor is a *reading* of the data, and a
reading belongs in a correction somebody can argue with, not in a join that
runs silently over 3.287 rows.

### What is left, and who decides it

Nothing below is a bug. Each one is a question a script must not answer.

| | what it is | who |
|---|---|---|
| 3 vendors | `GOLDEN SWALAYAN`, `TOKO SRC ZURIYAH`, `UD. SENGON LAUT CILACAP` — one transaction each, Rp 2.888.500 together. No vendor of that name exists; creating one is a decision. | owner |
| `CHAIR PHILIPPINES` | 6 transactions, Rp 7.512.200. The project table spells it `CHAIR PHILIPHINES` — **PP against PH**, a different spelling, not different punctuation. Canonicalising does not make them equal and it must not be made to. | owner |
| `FAIRMONT` | 5 transactions, Rp 37.087.500. No project row at all — it is the row `01_reference.sql` refused, for having no code. | owner |
| 5 transactions | lines disagreeing with their own row by Rp 4 to Rp 30.000. Settled from the document, on the ledger screen, with `edit_transaction`. | accounting |
| 75 `OTHERS` | the legacy row named no type. Indistinguishable on screen from a type somebody chose, which is the actual problem. | accounting |
| Rp 276.782 | BCA 271, this system against the manual sheet. Both systems agree with each other; the bank statement settles it. | accounting |

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
