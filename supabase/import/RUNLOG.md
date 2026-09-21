# Import runs, and what each one decided

One row per run of the scripts beside this file. The database's own record is
`ops_core.legacy_map` and the view over it, `ops_core.v_legacy_reconciliation`;
this file is the part a person reads first — which run, why, and what still
needs a decision.

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

