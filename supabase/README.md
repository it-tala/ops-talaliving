# `supabase/` — the database, in migrations

The brief this folder is built from is **`docs/plan/phase-2/`**: the readiness
verdict, the full migration ladder, the API inventory and the estimate. Read
`docs/plan/phase-2/README.md` first — it also carries the rules the build
session inherits and does not relitigate (nothing is deleted, derived state is
never stored, every mutation writes its audit row, Supabase is production).

```
migrations/   applied in filename order, forward only
local/        NEVER applied to Supabase
  00_shim.sql   the auth schema, auth.uid() and the three roles, so the real
                migrations run unchanged on a bare Postgres
  rebuild.sh    drop everything, apply the ladder from nothing
  smoke.sh      the static check, then every smoke file, reported per file
  smoke/        one per schema: each proves a refusal and a derivation
  check_shadowing.sh
                PL/pgSQL locals that share a name with a column
  check_schema_isolation.sh
                any migration reaching outside `ops_*` — the guard that lets
                this system share a database with the one it replaces
import/       reading the legacy system, once, into ours
legacy/       marking the old half as retired, and the same isolation rule
              asked of the running database rather than of the files
```

## Running the whole stack locally — free, and nothing touches production

`supabase start` runs Postgres **plus GoTrue, PostgREST and Storage** in Docker
on your machine. That is what `src/lib/api/*` actually needs: it speaks HTTP to
PostgREST through `supabase-js`, not the Postgres wire protocol, so a bare
Postgres is not enough to run the app against.

```bash
npx supabase start                  # first run pulls ~6 images
PGHOST=127.0.0.1 PGPORT=54322 PGPASSWORD=postgres supabase/local/rebuild.sh
PGHOST=127.0.0.1 PGPORT=54322 PGPASSWORD=postgres supabase/local/smoke.sh

npx supabase status                 # prints the anon key and the API URL
```

Then, in `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<the anon key from `supabase status`>
NEXT_PUBLIC_USE_SUPABASE=1
```

`config.toml` carries one change from the stock file and it is load-bearing:
**the six schemas are added to `[api] schemas`.** This project keeps nothing in
`public`, and PostgREST cannot see a table it has not been told about — with the
default, every call returns "relation does not exist" for a reason that looks
nothing like the cause. The same setting exists on a hosted project under
Settings → API → Exposed schemas.

> **Not verified in the session that wrote this.** `supabase start` needs to
> pull its images from Docker Hub and ghcr, and this session's egress policy
> answers 403 for both, so the stack has never actually been up here. The
> migrations, the views, the seams and all six smoke files are proved against a
> throwaway Postgres 16; what is *unproved* is the GoTrue half — the
> provisioning trigger firing on a real sign-up, and RLS applying through a real
> JWT rather than a session GUC. Expect to debug that on first run rather than
> trusting this block.
>
> What *was* checked here, with a hand-built GoTrue-shaped `auth` schema: the
> whole ladder applies unchanged when `auth` already exists and is somebody
> else's, and `rebuild.sh` leaves it alone.

## Running it locally

```bash
initdb -D /tmp/pg && pg_ctl -D /tmp/pg -o "-p 5433 -k /tmp" start
PGHOST=/tmp PGPORT=5433 supabase/local/rebuild.sh
PGHOST=/tmp PGPORT=5433 supabase/local/smoke.sh
PGHOST=/tmp PGPORT=5433 supabase/local/smoke.sh procure   # just one
```

`rebuild.sh` drops and re-applies everything on purpose: a migration that only
works against yesterday's database is one that will fail on a fresh one. The
shim drops and recreates its own `auth` schema for the same reason — while it
used `create if not exists`, an edit to it did nothing on a cluster that had
already run once, which made the shim the one part of the ladder that only
worked against yesterday's database.

### The three things `rebuild.sh` refuses

It opens with six `drop schema … cascade`, and the shim adds a seventh on
`auth`. Against the wrong database any of them is unrecoverable, and the wrong
database is one environment variable away. So it refuses:

| | |
|---|---|
| a non-local `PGHOST` | `db.xxx.supabase.co` is not a mistake worth allowing at 7pm. A real project is reached one reviewed migration at a time, never by a script whose first act is to drop six schemas |
| running the shim where Supabase is real | `supabase_auth_admin` existing means GoTrue owns `auth` and it holds the passwords. The shim would drop it and every account with it. It is skipped, and the schema is left untouched |
| wiping a database with accounts in it | `auth.users` non-empty means somebody is using this. `REBUILD_OVER_ACCOUNTS=1` says otherwise, out loud |

Each file in `smoke/` wraps itself in `begin`/`rollback`, so it leaves nothing
behind, the order cannot matter, and any one of them runs on its own with plain
`psql -f` — which is what you want when only one of them is failing.

## One convention, enforced rather than remembered

**Every PL/pgSQL local is prefixed `v_`; every argument is prefixed `p_`.**

Not style. A local sharing a name with a column makes every query below it
ambiguous, and Postgres refuses — correctly, and **at run time**. The migration
applies, the function is created, and the failure waits for whichever branch
reaches that line. It happened five times in one session before anybody noticed
it was a pattern, so `check_shadowing.sh` now reads the `declare` blocks out of
the migrations and fails on any local that collides. `smoke.sh` runs it first.

## Before anything reaches the real project

Additive migrations may be applied after a clean run of `rebuild.sh`.
**Destructive DDL asks the owner first** — never wipe, never bulk-delete. The
production database holds the business's own records, and a correction there
is a VOID with a reason, not a deletion.

**Nothing in this folder has been applied to Supabase yet** — but the reason
this file used to give for *why it never could be* is no longer true.

It said the ladder would collide with `john-lau-v01`, the running legacy system,
because both wanted `core` and `hr`. D265 renamed our six schemas `ops_*`, and
the collision went with it: the live project holds `public`, `hr`, `core`, `ops`
and `po_import`, and not one of those is a name we create. The owner's decision
(2026-09-17) is **one project, both systems, separate schemas** — which also
turns the data import from a network transfer into a join.

What keeps that safe is `check_schema_isolation.sh`, beside this file. It reads
every migration with comments blanked and refuses any that names a legacy
schema, whether qualified (`public.vendors`) or bare (`drop schema ops`). It runs
first in `smoke.sh` and again in CI, because the whole arrangement rests on one
sentence — *our migrations touch nothing outside `ops_\*`* — and a sentence
nobody checks is a sentence that has already drifted.

The legacy system is **still live**: a Google Chat event landed at 03:21 UTC on
2026-09-17, and 3.235 transactions sit behind it. Applying the ladder is a
reviewed step in the cutover runbook, never something a session does because it
happened to be nearby.
