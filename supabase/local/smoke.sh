#!/usr/bin/env bash
# Run every smoke file against the throwaway cluster.
#
# The definition of done in `docs/plan/phase-2/README.md` asks each schema for a
# smoke that proves at least one **refusal** and one **derivation** — a policy
# that says no, and a view that computes what the demo computed. Refusals are
# the half that rots silently: a view that breaks returns a wrong number
# somebody eventually notices, a policy that stops refusing returns the right
# number to the wrong person and nothing looks unusual at all.
#
# So they are files, one per schema, run together:
#
#   supabase/local/smoke.sh
#   PGHOST=/tmp PGPORT=5433 supabase/local/smoke.sh
#   PGHOST=/tmp PGPORT=5433 supabase/local/smoke.sh 02_core_auth
#
# Every file wraps itself in begin/rollback, so the cluster is unchanged
# afterwards and the order they run in cannot matter. Each one is also runnable
# on its own with plain `psql -f`, which is what you want at 7pm when only one
# of them is failing.
set -euo pipefail

HOST="${PGHOST:-/tmp}"
PORT="${PGPORT:-5433}"
USER="${PGUSER:-postgres}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ONLY="${1:-}"

failed=0
ran=0

# Before any assertion: the static check.
#
# A PL/pgSQL local sharing a name with a column makes every query below it
# ambiguous, and Postgres refuses **at run time** — so the migration applies,
# the function is created, and the failure waits for whichever branch reaches
# that line. Five of those in one session is not five mistakes, it is a missing
# check, so it runs here where nobody has to remember it.
#
# The second static check is about a different kind of blast radius. The new
# system shares one Supabase project with the running legacy one, which is only
# safe while our migrations stay inside `ops_*` — see
# `check_schema_isolation.sh` for why that sentence carries the whole
# arrangement.
if [ -z "$ONLY" ]; then
  for check in check_shadowing check_schema_isolation; do
    printf '%-44s' "$check"
    if out=$("$HERE/$check.sh" 2>&1); then
      echo "ok"
    else
      echo "FAILED"
      echo "$out" | sed 's/^/    /'
      failed=$((failed + 1))
    fi
  done
fi

for f in "$HERE"/smoke/*.sql; do
  name="$(basename "$f" .sql)"
  [ -n "$ONLY" ] && [[ "$name" != *"$ONLY"* ]] && continue
  ran=$((ran + 1))
  printf '%-44s' "$name"
  # `ON_ERROR_STOP` plus the exit code, never a grep for the word ERROR: an
  # earlier version of rebuild.sh piped psql through grep and printed "ok" over
  # the top of a failure, which is exactly the kind of green tick this project
  # exists to distrust. A failed assertion raises, psql exits non-zero, and the
  # message is printed in full.
  if out=$(psql -h "$HOST" -p "$PORT" -U "$USER" -q -v ON_ERROR_STOP=1 -f "$f" 2>&1); then
    echo "ok"
  else
    echo "FAILED"
    echo "$out" | grep -v '^NOTICE' | sed 's/^/    /'
    failed=$((failed + 1))
  fi
done

if [ "$ran" -eq 0 ] && [ -n "$ONLY" ]; then
  echo "no smoke files matched '${ONLY}'"
  exit 1
fi

echo "──"
if [ "$failed" -gt 0 ]; then
  echo "$failed of $ran failed"
  exit 1
fi
echo "$ran ok"
