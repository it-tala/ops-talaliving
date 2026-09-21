# `supabase/legacy/` — retiring `john-lau`, without taking it down

Both systems live in one Supabase project (`hhphmfqbtwcxpvubmwbq`). Ours is the
six `ops_*` schemas; the one being replaced is `public`, `core`, `hr`, `ops` and
`po_import`. `check_schema_isolation.sh` refuses any **migration** that names
those five, which is what makes sharing a project safe — so the scripts that
*do* name them live here, outside the ladder, and `rebuild.sh` still replays
from nothing with no legacy database present.

```
01_mark_legacy.sql      COMMENT ON every legacy schema, table and view
02_check_ops_prefix.sql the isolation rule, asked of the running database
```

Neither writes a data row. `01` writes catalogue comments; `02` writes nothing
at all.

## `ops` is legacy. `ops_*` is ours

The trap is one underscore. `ops` — no suffix — is the **old** system's schema
and holds `sheet_events`, `docs`, `pay_allocations` and the `adapter_health`
row the capture worker touches every few minutes. Ours are `ops_core`,
`ops_procure`, `ops_acct`, `ops_hr`, `ops_inv`, `ops_prod`.

Every pattern in this folder therefore matches `ops\_%`, with the underscore
escaped, and never `ops%`. A guard written the sloppy way would call the legacy
schema ours and fall silent on exactly the schema it exists to watch.

## Marked now, renamed later — and the order matters

The obvious way to archive a schema is `alter schema ops rename to legacy_ops`.
It is also the way to take the business down: `john-lau` is still running, still
the system of record for 3.235 transactions, and its queries break the instant
that commits. Nothing in this repository would notice.

So the mark is metadata — a comment changes no row, no plan, no permission and
no name, and cannot break a running query. What it does is answer *is this one
still real?* in the table browser, at the moment somebody asks.

The rename is the last step of the cutover, not the first:

1. **mark** — `01_mark_legacy.sql` (done, 2026-09-21: 5 schemas, 158 objects)
2. **import** — `supabase/import/`, reconciled through `ops_core.legacy_map`
3. **repoint** — every writer still aimed at `public.*`, the GCP capture worker
   above all (see below), writes to `ops_*` instead
4. **observe** — the legacy tables stop receiving rows, and stay readable
5. **rename** — only then, and only with the worker already repointed

Skipping to 5 is the mistake this file exists to prevent.

## Running them

Egress to port 5432 is blocked from Claude Code web sessions, so these were
applied through the Supabase MCP `execute_sql`. From a machine that can reach
the pooler, the ordinary way still works:

```bash
export PGPASSWORD='…'
psql -h aws-0-ap-northeast-1.pooler.supabase.com -p 5432 \
     -U postgres.hhphmfqbtwcxpvubmwbq -d postgres \
     -v ON_ERROR_STOP=1 -f supabase/legacy/01_mark_legacy.sql
```

`01` is idempotent twice over: an object already carrying the marker is skipped,
and an object that already had a comment keeps it — the original text is
preserved after the marker rather than overwritten. 35 of the 158 objects had
one, some of them the only explanation of a column anybody wrote down.

`02` raises on the first category with rows and names every offender. Read what
it prints; an exit code does not tell you which object.

## What `02` checks, and why file-level checking is not enough

`check_schema_isolation.sh` greps `supabase/migrations/*.sql`. It is the right
guard and it cannot see a table somebody created in `public` from the SQL
editor at 11pm, a name assembled inside `execute format(...)`, or a foreign key
added by hand. Those are the ways the two halves actually get tangled. So `02`
asks the catalogue instead:

| # | violation |
|---|---|
| 1 | a relation outside `ops_*`, outside Supabase's own schemas, with no legacy marker |
| 2 | a foreign key leaving `ops_*` — except `ops_core.users → auth.users`, which is how a profile is tied to a GoTrue account (0002) |
| 3 | a function in `ops_*` naming a legacy schema |
| 4 | a function in a legacy schema naming `ops_*` |

Categories 3 and 4 are the pair that decides whether step 5 above is safe. Both
were empty on 2026-09-21: the two systems share a database and touch nothing of
each other's.

## The capture worker, and why the review queue does not arrive

Measured 2026-09-21, because it is the question the marking makes obvious.

The GCP capture worker is **alive** — `ops.adapter_health` shows `sheet_poller`
last OK minutes ago. (`digest_0730` last succeeded 2026-08-02 and is worth a
separate look.) It writes, as it always has, entirely into the legacy schema:

```
chat → public.raw_events → public.interpretations → public.ledger_review_queue
                        ↘ public.blobs (the file itself lives in Drive)
```

`public.ledger_review_queue` holds 483 rows, **29 of them PENDING**, the newest
created today. `ops_acct.evidence_inbox` — the new system's same idea — holds
**0**. Nothing moves rows between them: `02` confirms no function in either
schema names the other, and `supabase/import/` covers accounts, projects,
vendors and items only.

So the review queue does not reach `ops.talaliving.com`, and there are two
independent reasons, both of which have to be fixed:

**No bridge.** The inbox has an exit and no entrance. `ops_acct.resolve_inbox()`
exists; there is no seam that *files* evidence, so a worker would be inserting
directly. Three things block a straight `insert … select`:

- `evidence_inbox.attachment_id` is `not null` into `ops_core.attachments`,
  which is empty. The Drive links do fit — `attachments.url` with
  `source = 'chat'` satisfies the `file_or_link` constraint — so this is work,
  not a redesign.
- `attachments.uploaded_by` is `not null` into `ops_core.users`, which has 3
  rows. The queue records a name in text (`Putri Tala`); the legacy system has
  9 `chat_users`. **This is step 1 of the import, still held** — it needs
  authentication accounts, which is a decision about people, not a select.
- `service_role` has no grant on `evidence_inbox` (only `authenticated` and
  `postgres` do), so a worker authenticating that way is refused before RLS is
  even consulted.

The statuses line up, which is the easy half: `PENDING`, `CONFIRMED`,
`ATTACHED` and `REJECTED` exist on both sides, and `inbox_origin_t` has `chat`.

**The screen is not live.** `/accounting/verifikasi` is not in `LIVE_ROUTES`
(`src/lib/live.ts`) — 9 routes are, and it is not one. Bridging the data today
would fill a table no deployed screen opens.

A one-off import would also be the wrong shape here: the worker is still
producing, so anything copied on Monday is stale on Tuesday. The honest options
are to repoint the worker at `ops_acct` (step 3 above) or to run a continuous
sync until it is repointed — and only the first of those ever ends.
