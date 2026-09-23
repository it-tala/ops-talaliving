# Import runs, and what each one decided

One row per run of the scripts beside this file. The database's own record is
`ops_core.legacy_map` and the view over it, `ops_core.v_legacy_reconciliation`;
this file is the part a person reads first — which run, why, and what still
needs a decision.

## 2026-09-23 — step 11, the PO TRACKER sheet (`08_po_tracker.sql`)

Source: the `PO TRACKER` Google Sheet on the shared drive, read the same day
as an .xlsx export (the text export truncates tabs). 29 tabs: 25 vendor tabs
that are PO documents, two tracker summaries, a budget worksheet, a 2025
FAIRMONT order and a drop-down list. Run id
`e8d4c1a7-3b52-4f0e-9a61-5c2f7d08b913`. Dry run first (rolled back), then the
real run; the numbers matched.

| | |
|---|---:|
| orders (46 from the sheet, 1 only in the old app) | 47 |
| order lines | 114 |
| DP/balance terms, where the tab states a DP % | 22 |
| allocations written | 86 |
| … carrying a PR line **and** a PO | 42 |
| PR RECAP allocations superseded by those | 39 |
| PR lines given `po_line_id` | 26 |
| ledger rows given the vendor they paid | 8 |
| vendors created from the PO header (URECEL V-0298, INOCYCLE V-0297) | 2 |
| contract value / paid, all 47 | Rp 871.685.811 / 817.417.531 |

After it: **0** transactions allocated beyond their amount, **0** allocations
pointing at a PO or PR line that does not exist, and the five account
balances unchanged to the rupiah (BCA 064 21.259.068, BCA 271 4.285.326,
BNI 325 148.132, JAGO 10.473.352, PETTY CASH 858.298). The live run's last
statement printed only the total row; the file prints one row per order.

### The PR RECAP import ran the same afternoon, on the same transfers

It finished at 07:00, while this file's first dry run was being built, and it
had allocated 39 of the transfers this file matched to `pr-…` lines ("BALANCE
PAYMENT HADI GLASS"). The first dry run was refused by its own guard —
*trx-26-08-26_015 would be allocated twice* — which is the guard doing its
job. Owner, 2026-09-23: **match the PR and the transaction and make them
reference each other.** So the order goes onto the request's allocation:
each request allocation is superseded by row(s) carrying both numbers, split
in order where one transfer paid several orders. The money is counted once;
the request, the order and the transfer all name each other. Remainders stay
honest: Mandiri's 132.000 stays on its request alone, Jawul's 8.000 that the
recap left out goes to the order alone.

### Where the sheet and the ledger disagree

The ledger won on money every time. None of these was "fixed"; each is here
so somebody can.

| order | sheet says | ledger says | reading |
|---|---|---|---|
| MARTONO 19082026-01 | DP 5.711.850 | 5.505.000 | 30% of the four jasa-jok lines (18.350.000), before the four TAMBAHAN lines were added. Balance is 6.534.500, not 6.327.650 |
| DUL ROTAN 06102026 | 122 pcs, 54.900.000 | paid 54.630.000 | payments were sized on 120 pcs; **270.000 owed** for the two extra |
| DUL ROTAN 06302026 | tab 103.175.000, tracker 101.700.000 | 65.510.000 paid | the tab has paku + staples (1.475.000) the tracker does not; **37.665.000 owed** |
| NURYANTO 15092026-01 | paid 12.900.000, no date, no proof | one transfer, 5.340.000 (powder coating kanopi) | **7.560.000 not in the ledger** — `legacy_map` `refused` |
| CHYNTIA BOX 08132026 | 725.900 | 724.768 | the owner confirmed the BI-FAST proof on 19/08; 1.132 short |
| KSA po-26-08-12_01 (old app) | 6.726.639 | 8.670.957 across four lines | **1.944.318 more than the order** — quantities/prices on the invoice differ from the order the app holds |
| KSA 18092026-01 | 1.883.089 + binder 1.386.771 | binder paid | top coat + blocking (1.883.089) unpaid |
| URECEL 280826-02 | 2.298.376 | nothing | unpaid |
| INOCYCLE, ZENCHEN PO 2, ALBERTO, URECEL PO 1 | tab shows unpaid | paid | the sheet was not updated |
| KUSAIRI, RUBIATI | "balance to pay" 2.550.000 / 525.000 | fully paid | the tab's TOTAL PAID formula stops one row short |
| PUTRA TAN | tracker: DP 900.000 on 29/04, 13.065.000 on 10/07 | the other way round | the vendor tab and the ledger agree; the tracker swapped them |
| HADI GLASS | PO1 40/41 pcs, PO2 21/22 pcs | 13.810.000 = PO2 12.680.000 + PO3 850.000 + PO1 280.000 | the vendor tab (41, 21) adds up to what was paid |

### Ledger rows to a PO vendor with no order on the sheet

Left unlinked. Either there was no PO, or its tab was never made.

| transaction | amount | what |
|---|---:|---|
| trx-26-07-14_092 | 3.143.986 | CV CYNTHIA BOX — "PO BOX MIRROR AA-04A" |
| trx-26-08-19_019 | 4.522.000 | ALUMUNIUM MANDIRI — baby island (on pr-26-08-14_01) |
| trx-26-08-26_022 | 2.040.000 | "MATA BOR — PT ZENITH", the day after ALBERTO's identical 2.040.000 — **possible double payment** |
| trx-26-07-14_121 | 13.650.000 | KEMIRAN — jasa bubut AA-40A & LT-02 |
| trx-26-07-10_003 | 3.450.000 | KEMIRAN — lathe services |
| trx-26-03-30_002 | 39.025.380 | ZHANCHEN — before the sheet begins |
| trx-26-07-14_128, trx-26-06-18_006 | 3.660.000, 1.180.000 | ZHANCHEN — NC clear |
| trx-26-08-10_020, trx-26-04-21_007 | 443.766, 1.085.663 | KSA |
| trx-26-08-31_030, trx-26-08-31_041 | 238.634, 210.312 | ZHANCHEN freight |

### What was deliberately not done

- **Receipts.** The tabs carry delivery dates, quantities and TTB files. A
  receipt needs a receiver and, to count, a confirmer (0012); naming people
  who were not asked is the thing this import does not do. Needs a decision:
  who signs, and whether history is recorded as REPORTED or CONFIRMED.
- **Approvals.** `approved_*`/`issued_*` are null on all 47 orders; status
  alone says ISSUED or CLOSED.
- **Vendor duplicates.** The orders use one row each, but the master still
  has CYNTHIA BOX ×3 (V-0104, V-0070, V-0086), EFENDI ×3, DUL ROTAN ×2,
  JAWUL ×2, KUSAIRI ×2, ZHANCHEN / ASIAN NEW MATERIALS ×3, PUTRA TAN ×2,
  KSA ×2, MARTONO ×2, RUBIATI ×2, MANDIRI / FAHRUDIN ×2. Merging is the
  owner's call.

## 2026-09-23 — step 10, and the map repair that preceded it

Applied through the Supabase MCP `execute_sql`, as every run since 2026-09-21
has been: outbound TCP to port 5432 is blocked from Claude Code web sessions.
The psql-only parts (`\set`, `\echo`, the `_run` temp table) were replaced by
their effect — the run id below is a literal, so the rows are still findable.

### First: 52 transactions with no map row

Found while answering *what is left in accounting*, and it is the failure the
map exists to prevent. Fifty-two rows the old system wrote after the first run
were in `ops_acct.transactions` with their `source_ref` and **no
`legacy_map` row at all** — imported by hand at some point rather than by the
script. Rp 207.576.530 across 2026-09-16 to 2026-09-21.

No money was duplicated, and the reason is worth writing down rather than
being relieved about: the insert is `on conflict (source_ref) do nothing`
against a unique index, so even though the map's guard would have staged all
52 again, the insert could not have doubled them. The map is the first line
and the constraint is the second; the second held.

What was lost was the map's *notes* — which of the 52 had a borrowed author,
an unresolved vendor, no type. Re-running `03_ledger.sql`'s staging and map
inserts restored them:

| | |
|---|---:|
| staged (no map row) | 52 |
| transactions inserted | **0** |
| map rows written | **52** |
| run id | `9b2f4c1a-6d83-4e57-9f20-7c5a1e0b3d44` |

Afterwards every legacy table maps row for row, checked not assumed:
transactions 3.287 ↔ 3.287, item_purchases 1.194 ↔ 1.194, transaction_docs
237 ↔ 237, vendors 296 ↔ 296, items 1.020 ↔ 1.020, products 27 ↔ 27.

**The lesson is about the hand-run, not the script.** A statement typed into a
SQL console to catch up 52 rows does the visible half of the job and skips the
half that has no visible effect until months later. If it is worth importing,
it is worth running the file.

### Then: `07_corrections.sql`

| correction | outcome |
|---|---|
| `trx-26-07-27_061` — line filed against the wrong transaction | 1 line moved to `trx-26-07-27_900`; neither amount touched; both now agree with their own lines |
| vendors unresolved through punctuation | 59 transactions across 8 names |

Both are idempotent **by shape, not by flag** — each looks for the exact
arrangement it repairs. Proved by running each a second time against
production: 0 rows matched, 0 audit rows written. That is the property that
lets this file sit beside the import and be re-run with it.

60 rows in `ops_core.audit_log` carry `detail->>'by' =
'supabase/import/07_corrections.sql'`. Every one has `actor_id` null, on
purpose: nobody typed these into the application.

### The balances, as of this run

Both systems, to the rupiah, on all five accounts — BCA 064 21.259.068 ·
BCA 271 4.285.326 · BNI 325 148.132 · JAGO 10.473.352 · PETTY CASH 858.298.
Against the owner's manual `2026 TALAHOME LEDGERS` workbook, three of four
agree exactly and BCA 271 differs by Rp 276.782. **The owner answered the same
day: new transactions, not yet entered in the sheet** — a timing difference,
entered when accounting gets to it. `README.md` has the comparison and what
could not be checked in it.

## 2026-09-21 — steps 2–5

Applied through the Supabase MCP `execute_sql` rather than `psql`: outbound TCP
to port 5432 is blocked from Claude Code web sessions. The scripts were run as
written apart from the psql-only parts — `\set`, `\echo` and the `_run` temp
table, whose `gen_random_uuid()` was replaced by the literal run id below so the
run is still identifiable in `legacy_map`.

| script | run id | outcome |
|---|---|---|
| `01_reference.sql` | `8656bcf6-fdc5-4c66-b0bb-4727120537ac` | accounts 6 mapped · projects 4 imported, 1 refused · vendors 296 imported |
| `02_items.sql` | `c46f01f5-b871-4745-aade-7b9b38c614f6` | items 1.020 imported |

`legacy_map` holds 1.327 rows, which is 6 + 5 + 296 + 1.020 — every legacy row
seen, including the one that was refused.

**Idempotency was proved, not assumed.** Steps 3 and 4 were run a second time
against the same data: nothing inserted, nothing changed, counts identical.
That is `legacy_map`'s whole job and it is cheaper to verify once than to
discover from a duplicate vendor.

### What the items import found, against what `README.md` predicted

Exactly what it said, which is worth recording because the prediction was made
on 2026-09-18 and the database has been live since:

| | predicted | actual |
|---|---:|---:|
| items | 1.020 | 1.020 |
| with a unit | 424 | 424 |
| with no unit | 596 | 596 |

852 landed in the `uncurated` category and 431 resolved a last vendor. The 596
without a unit carry their original text in `legacy_map.note`, per the owner's
ruling — *import semuanya, tanpa satuan biarkan apa adanya*.

## 2026-09-21 — step 1, the one that was held

The owner's answer was *selesaikan dulu 9 akun auth itu*. `03_chat_users.sql`
created the **eight** accounts that did not exist; Putri's dates from August
and was mapped rather than recreated. `ops_core.users` now holds 11 rows — the
nine chat users plus `shared` and `superadmin`, which were never chat users.

All nine are recorded `imported` in `legacy_map`, with the legacy role kept in
the note. Re-running finds nothing to do.

**Every new account has 0 modules and 0 authorities.** That is not an oversight
to correct later; it is the design (D24), and it is what made this safe to run
as a script at all. The eight can authenticate and see nothing.

Two things the first attempt taught, both worth keeping:

- `auth.identities.email` is a **generated** column. Naming it in the insert is
  an error, not a redundancy — the address goes inside `identity_data`, which
  is where GoTrue reads it. The whole `do` block is one statement, so the
  failure rolled back cleanly and created nobody; verified before retrying.
- Two triggers fire on `auth.users`: ours and the legacy `core.fn_sync_auth_user`.
  Both were read before writing. Neither assigns a role, so creating an account
  grants nothing in *either* system — which is the only reason this could be
  done without a second decision.

### How people get in

No password exists. Each account was created with 32 random bytes, hashed and
discarded in the same expression and recorded nowhere, so there is no shared
secret and no "temporary password" living in a chat thread. The road in is the
one the application already has: **Lupa password** on the sign-in screen →
`/set-password`. `email_confirmed_at` is set, so it is open now.

Unverified from here, and worth checking before telling eight people to try:
whether the project has SMTP configured. Supabase's built-in mailer is rate
limited to a handful of messages an hour, which is fine for eight people spread
over a day and not fine for eight in one minute.

### The two decisions the owner made after the run

**No grants, for anybody.** All nine stand at 0 modules and 0 authorities, and
that is now a choice rather than a default. Grants will be made on the IT
screen, where they are audited, when somebody decides them.

**Rifki and Winda were removed.** No role in the legacy system, `pending:`
placeholder ids, and never a sign-in to the old chat — so the accounts created
a few minutes earlier were deleted the same day. `ops_core.users` holds 9.

This is not the A5 "nothing is deleted" rule being bent. A5 protects business
records; these two rows were created by this session's own run, carried no
history, and removing them reverts a provisioning step rather than destroying
anything anybody wrote. The decision itself survives in `legacy_map`, which is
where import decisions are supposed to live:

```sql
select source_id, outcome, note from ops_core.legacy_map
 where source_table = 'public.chat_users' and outcome = 'skipped';
```

Their map rows are kept deliberately: the `(source_table, source_id)` gate means
`03_chat_users.sql` now passes over them, so a later run cannot quietly bring
back an account somebody decided against. Verified — the guard reports 0 rows to
process.

The delete was run behind three assertions, not on faith: exactly two rows
matched, neither had ever signed in, and no audit row pointed at either. The
order matters and is recorded in the script, because
`ops_core.users → auth.users` is **RESTRICT**: profile first, then the legacy
`core.users` row, then the account.

## Still open

**One refusal, and it needs a person.** `public.projects` `FAIRMONT` has no
code, and `ops_procure.projects.code` is a public identifier somebody chooses —
`25008` is the obvious next number and an import may not invent it (ADR-004).
Four of five projects are in; this is the fifth.

```sql
select source_id, note from ops_core.legacy_map
 where source_table = 'public.projects' and outcome = 'refused';
```

**Module access was set on 2026-09-21**, for the three modules that have live
screens: `it`, `procurement`, `accounting`.

| person | legacy role | modules | authorities |
|---|---|---|---|
| Tala IT | IT Developer | `it:admin` `procurement:admin` `accounting:admin` | — |
| Ryan Tala | IT Developer | `it:admin` `procurement:read` `accounting:read` | — |
| Anggun Tala | Accounting | `procurement:read` `accounting:write` | `post_ledger` `resolve_inbox` |
| putri | Accounting | `procurement:read` `accounting:write` | `post_ledger` `resolve_inbox` |
| Geryle Lao | Payment Approver | `procurement:read` `accounting:read` | `approve_funds` |
| Evin Oshima | CEO | `procurement:read` `accounting:read` | — |
| Alika Oshima | CO-CEO | `procurement:read` `accounting:read` | — |

**Evin and Alika deliberately hold no `approve_funds`.** Geryle's legacy role
says *Payment Approver* in so many words; CEO and CO-CEO are job titles, and
reading a signature on money out of a job title is exactly the guess this
system is built not to make. It is two clicks on the IT screen the day somebody
says otherwise.

The derived permissions were checked against `permission_catalog` rather than
assumed — a level is not a permission until the catalog says so. `it:admin`
does yield `it.read` and `it.manage_roles`, which is the part that matters:
**the next change happens on the IT screen, not in SQL.**

### Applied out-of-band, and the audit says so

`ops_core.set_modules` and `set_authorities` both require
`has_permission('it.manage_roles')`, read from `auth.uid()`. An MCP session has
no session, so the seams refuse — correctly. The rows were therefore written
directly, with `granted_by` left **null**: nobody clicked this, and a name in
that column would claim a click that never happened. One `audit_log` row per
person records what changed, that SQL applied it, and who asked.

This was a bootstrap, not a pattern. Two people now hold `it.manage_roles`, so
there is no reason to do it this way again. The legacy roles are recorded in
`legacy_map.note` — Accounting, CEO, CO-CEO, IT Developer, Payment Approver,
and two people with no role recorded at all — but a legacy role is a note, not
a mapping: this system grants *modules* and *authorities*, and which of those
each person should hold is the owner's call, made on the IT screen where it is
audited.

```sql
select target_id, note from ops_core.legacy_map
 where source_table = 'public.chat_users' order by note;
```

**SMTP: answered 2026-09-21, and the answer was no.** Custom SMTP is not
enabled, and the built-in mailer cannot be made to do this job. Supabase's own
documentation is unambiguous:

> Unless you configure a custom SMTP server for your project, Supabase Auth
> will refuse to deliver messages to addresses that are not part of the
> project's team.

There is no setting to change. The only way to make the built-in mailer reach
Anggun, Evin, Alika, Geryle and Ryan is to add each of them as a **team member
of the Supabase organization** — which hands accounting staff dashboard access
to the production database. That is a worse problem than the one being solved,
so it was not done.

### What was done instead: temporary passwords, no email at all

The six accounts that had never signed in were given a 14-character random
password each, set directly with `crypt(…, gen_salt('bf'))`. Putri, `shared`
and `superadmin` were not touched — their passwords work and are in use. People
sign in and change it on `/set-password`, which the app already has.

Each hash was then verified the way GoTrue verifies it —
`encrypted_password = crypt(<plaintext>, encrypted_password)` — rather than
assumed, because a password that does not work is indistinguishable from a
wrong email address at the sign-in screen.

**One bug, caught and fixed before anybody was told.** The first attempt
generated the password in a scalar subquery, which Postgres evaluated **once**
— all six accounts got the *same* password. The fix is `gen_random_bytes()`
referenced per row, which is volatile and therefore re-evaluated. Confirmed
afterwards that the shared value matches zero accounts. If you are generating
per-row secrets in SQL, this is the trap: an uncorrelated subquery is a
constant.

### Why custom SMTP is still needed

Nothing above gives the business a password reset. There is no "must change
password" flag in the app, so an unchanged temporary password stays valid
indefinitely, and every future *I forgot my password* becomes a ticket that
needs SQL access. Ten minutes with any free provider (Resend, Brevo, SES) ends
that permanently. From the docs, it can be done without the dashboard:

```bash
export SUPABASE_ACCESS_TOKEN="…"   # supabase.com/dashboard/account/tokens
curl -X PATCH "https://api.supabase.com/v1/projects/hhphmfqbtwcxpvubmwbq/config/auth" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "external_email_enabled": true, "smtp_host": "…", "smtp_port": 587,
        "smtp_user": "…", "smtp_pass": "…", "smtp_admin_email": "…",
        "smtp_sender_name": "Tala Living Ops" }'
```

Custom SMTP also lifts the send limit to 30 new users per hour and lets the
address be one people recognise, rather than a Supabase default that looks like
phishing to anybody careful.

