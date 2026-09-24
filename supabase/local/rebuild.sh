#!/usr/bin/env bash
# Apply the whole migration ladder, from nothing, to a database that is safe to
# destroy.
#
# Not a deployment script — it exists so a change to a migration can be proved
# to apply before anybody points it at Supabase. Everything is dropped first,
# because a migration that only works against yesterday's database is a
# migration that will fail on a fresh one.
#
#   supabase/local/rebuild.sh                     # the scratch cluster
#   PGHOST=/tmp PGPORT=5433 supabase/local/rebuild.sh
#   PGHOST=127.0.0.1 PGPORT=54322 PGPASSWORD=postgres supabase/local/rebuild.sh
#                                                 # the local Supabase stack
#
# ── The two guards, and why they are not paranoia ─────────────────────────
#
# This script begins with eight `drop schema … cascade`, and `00_shim.sql` begins
# with a ninth: `drop schema auth cascade`. Against the wrong database either
# one is unrecoverable, and the wrong database is one environment variable away.
# So:
#
#   1. **It refuses any host that is not local.** `PGHOST=db.xxx.supabase.co`
#      is not a mistake this script is willing to let somebody make at 7pm. A
#      remote database is reached by a migration tool, reviewed, one file at a
#      time — never by a thing whose first act is to drop eight schemas.
#
#   2. **It never runs the shim where a real `auth` schema exists.** The shim
#      fakes just enough of Supabase for the migrations to run on a bare
#      Postgres. Where Supabase is actually present — the local stack, or a
#      hosted project — `auth` belongs to GoTrue and holds the passwords. The
#      shim would drop it, and every account with it.
set -euo pipefail

HOST="${PGHOST:-/tmp}"
PORT="${PGPORT:-5433}"
USER="${PGUSER:-postgres}"
HERE="$(cd "$(dirname "$0")" && pwd)"

# ── guard 1: local only ───────────────────────────────────────────────────
case "$HOST" in
  /*|localhost|127.0.0.1|::1|host.docker.internal) ;;
  *)
    echo "refusing: PGHOST=$HOST is not local." >&2
    echo "This script drops eight schemas before it does anything else. It is for a" >&2
    echo "throwaway cluster or the local Supabase stack, never for a real project." >&2
    exit 2 ;;
esac

q() { psql -h "$HOST" -p "$PORT" -U "$USER" "$@"; }

# ── guard 2: is Supabase itself already here? ─────────────────────────────
# `supabase_auth_admin` is GoTrue's own role. It exists on the local stack and
# on every hosted project, and on nothing else — which makes it the honest test
# for "somebody else owns the auth schema, leave it alone".
REAL_SUPABASE=$(q -Atc "select count(*) from pg_roles where rolname = 'supabase_auth_admin'" 2>/dev/null || echo 0)

if [ "$REAL_SUPABASE" = "0" ]; then
  echo "auth: shimmed (bare Postgres)"
else
  echo "auth: real (GoTrue) — shim skipped, its schema left untouched"
  # One more refusal, and it is the one that matters most. A hosted project has
  # tables under `auth` with rows in them. Dropping our eight schemas next to real
  # accounts is not something to do by running a script called "rebuild".
  USERS=$(q -Atc "select count(*) from auth.users" 2>/dev/null || echo 0)
  if [ "${REBUILD_OVER_ACCOUNTS:-0}" != "1" ] && [ "$USERS" != "0" ]; then
    echo "refusing: this database already has $USERS authenticated accounts." >&2
    echo "That is a database somebody is using. If this really is a local stack you" >&2
    echo "want to wipe, say so explicitly: REBUILD_OVER_ACCOUNTS=1" >&2
    exit 2
  fi
fi

# The extension goes too, and that is not tidiness. `0001` installs `citext`
# **into `ops_core`**, and `create extension if not exists` matches on the
# extension's NAME, not on where it lives — so an earlier run that left it in
# `public` makes the new line a silent no-op, and the ladder then fails four
# files later with *type ops_core.citext does not exist*. Worse, it could
# succeed against a citext sitting in the wrong schema, which is the failure
# that returns a wrong answer rather than an error (see `0001`). A replay
# "from nothing" has to mean from nothing.
q -q -c "
  drop schema if exists ops_dlv cascade;
  drop schema if exists ops_asst cascade;
  drop schema if exists ops_mkt cascade;
  drop schema if exists ops_inv cascade;
  drop schema if exists ops_prod cascade;
  drop schema if exists ops_hr cascade;
  drop schema if exists ops_acct cascade;
  drop schema if exists ops_procure cascade;
  drop schema if exists ops_core cascade;
  drop extension if exists citext cascade;" >/dev/null

if [ "$REAL_SUPABASE" = "0" ]; then
  q -q -v ON_ERROR_STOP=1 -f "$HERE/00_shim.sql" 2>&1 | grep -v NOTICE || true
fi

# A migration that fails stops the run. An earlier version of this script piped
# psql through grep and reported "ok" over the top of an ERROR — exactly the
# kind of green tick this project exists to distrust.
for f in "$HERE"/../migrations/*.sql; do
  printf '%-44s' "$(basename "$f")"
  if out=$(q -q -v ON_ERROR_STOP=1 -f "$f" 2>&1); then
    echo "ok"
  else
    echo "FAILED"
    echo "$out" | grep -v NOTICE
    exit 1
  fi
done

q -Atc "
  select table_schema || ': ' || count(*)
    from information_schema.tables
   where table_schema in ('ops_core','ops_procure','ops_acct','ops_hr','ops_prod','ops_inv','ops_mkt','ops_asst','ops_dlv')
   group by table_schema order by 1;"
