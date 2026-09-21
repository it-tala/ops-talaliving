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

## Still open

**One refusal, and it needs a person.** `public.projects` `FAIRMONT` has no
code, and `ops_procure.projects.code` is a public identifier somebody chooses —
`25008` is the obvious next number and an import may not invent it (ADR-004).
Four of five projects are in; this is the fifth.

```sql
select source_id, note from ops_core.legacy_map
 where source_table = 'public.projects' and outcome = 'refused';
```

**The grants have not been made, and they are the next decision.** Nine people
can sign in; none of them can open anything. The legacy roles are recorded in
`legacy_map.note` — Accounting, CEO, CO-CEO, IT Developer, Payment Approver,
and two people with no role recorded at all — but a legacy role is a note, not
a mapping: this system grants *modules* and *authorities*, and which of those
each person should hold is the owner's call, made on the IT screen where it is
audited.

```sql
select target_id, note from ops_core.legacy_map
 where source_table = 'public.chat_users' order by note;
```

Two of the nine, Rifki and Winda, carry `pending:` placeholder ids and no role
— they never signed in to the old chat. Worth confirming they should have
accounts at all before anybody is told they do.
