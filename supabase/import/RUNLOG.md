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

## Still open

**One refusal, and it needs a person.** `public.projects` `FAIRMONT` has no
code, and `ops_procure.projects.code` is a public identifier somebody chooses —
`25008` is the obvious next number and an import may not invent it (ADR-004).
Four of five projects are in; this is the fifth.

```sql
select source_id, note from ops_core.legacy_map
 where source_table = 'public.projects' and outcome = 'refused';
```

**Step 1 — the nine `chat_users` — is still held**, and it now blocks more than
itself. `ops_core.users.id` is a foreign key to `auth.users(id)`, so importing
them means creating authentication accounts, which is a decision about who may
sign in rather than an insert. `0029` made the second half harmless: an account
that signs in for the first time provisions its own profile. So the order is
*invite, then they arrive*.

What it blocks: `ops_core.attachments.uploaded_by` is `not null` into
`ops_core.users`, and every route from the capture worker's review queue into
`ops_acct.evidence_inbox` goes through an attachment. See
`supabase/legacy/README.md` for the rest of that chain.
