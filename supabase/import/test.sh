#!/usr/bin/env bash
# Prove the import on a throwaway cluster, twice.
#
# ── Why twice ─────────────────────────────────────────────────────────────
#
# Because idempotence is the property the whole design rests on, and it is the
# one that is never true by accident. An import against a database somebody is
# still using is run, reconciled, corrected and run again. The second run has to
# import nothing and change nothing, and the only way to know that is to do it.
#
# Run once, this script proves the SQL parses. Run twice, it proves the thing
# that matters.
#
#   supabase/import/test.sh
#   PGHOST=/tmp PGPORT=5433 supabase/import/test.sh
#
# ── The guard ─────────────────────────────────────────────────────────────
#
# `_fixture.sql` creates tables in `public`. On `john-lau-v01` that schema is
# the running legacy system — 65 tables, a live Google Chat pipeline — and
# `drop table if exists public.vendors cascade` against it is not a mistake
# anybody recovers from. So this refuses any host that is not local, the same
# way `rebuild.sh` does and for a worse reason.
set -euo pipefail

HOST="${PGHOST:-/tmp}"
PORT="${PGPORT:-5433}"
USER="${PGUSER:-postgres}"
HERE="$(cd "$(dirname "$0")" && pwd)"

case "$HOST" in
  /*|localhost|127.0.0.1|::1|host.docker.internal) ;;
  *)
    echo "refusing: PGHOST=$HOST is not local." >&2
    echo "This drops and recreates tables in \`public\`. On the real project that" >&2
    echo "schema is the legacy system that is still running." >&2
    exit 2 ;;
esac

q() { psql -h "$HOST" -p "$PORT" -U "$USER" -v ON_ERROR_STOP=1 "$@"; }

pass() { printf '%-44s %s\n' "$1" "ok"; }
fail() { printf '%-44s %s\n' "$1" "FAILED"; echo "    $2" >&2; exit 1; }

echo "staging a legacy system…"
q -q -f "$HERE/_fixture.sql" >/dev/null
pass "fixture"

echo
echo "── first run ───────────────────────────────────────────────────────"
q -q -f "$HERE/01_reference.sql" >/dev/null
pass "01_reference (first run)"

V1=$(q -Atc "select count(*) from ops_procure.vendors")
P1=$(q -Atc "select count(*) from ops_procure.projects")
M1=$(q -Atc "select count(*) from ops_core.legacy_map")
R1=$(q -Atc "select count(*) from ops_core.legacy_map where outcome = 'refused'")

[ "$V1" = "3" ]  || fail "three vendors land"            "saw $V1"
[ "$P1" = "2" ]  || fail "two projects land, not three"  "saw $P1 — the one with no code must be refused"
[ "$R1" = "2" ]  || fail "two refusals"                  "saw $R1 — expected FAIRMONT and BRI 900"
pass "3 vendors, 2 projects, 2 refusals"

# The refusals are the deliverable, so their reasons are asserted, not just
# their count: a refusal with no usable reason is a row somebody has to
# re-investigate from scratch.
q -Atc "select note from ops_core.legacy_map
         where outcome='refused' and source_table='public.projects'" \
  | grep -q "invent" || fail "the project refusal says why" "note does not explain it"
q -Atc "select note from ops_core.legacy_map
         where outcome='refused' and source_table='public.accounts'" \
  | grep -q "no account with this code" || fail "the account refusal says why" "note is unhelpful"
pass "refusals carry a reason"

# Blank contact text must arrive as null, not ''. An empty string renders as a
# phone number nobody can ring.
BLANK=$(q -Atc "select count(*) from ops_procure.vendors
                 where phone = '' or address = '' or bank_account = ''")
[ "$BLANK" = "0" ] || fail "blank contact text becomes null" "saw $BLANK empty strings"
pass "'' becomes null"

# `aka` crosses from jsonb to text[] intact — it is how the 68 unresolved ledger
# names get matched later, so losing it makes later work harder.
AKA=$(q -Atc "select array_length(aka,1) from ops_procure.vendors where name='UD SUMBER REJEKI'")
[ "$AKA" = "2" ] || fail "aka survives jsonb → text[]" "saw ${AKA:-null}"
pass "aka survives the type change"

# Whitespace in the legacy name is trimmed, or the same vendor arrives twice
# the day somebody types it without the spaces.
TRIM=$(q -Atc "select count(*) from ops_procure.vendors where name = 'CV ANUGERAH'")
[ "$TRIM" = "1" ] || fail "names are trimmed" "'  CV ANUGERAH  ' did not land trimmed"
pass "names are trimmed"

# The accounts step maps and inserts nothing. Six seeded by 0013 stay six.
A1=$(q -Atc "select count(*) from ops_acct.accounts")
[ "$A1" = "6" ] || fail "accounts are mapped, not inserted" "saw $A1, expected the 6 seeded by 0013"
pass "accounts mapped, none inserted"

echo
echo "── second run — the one that matters ───────────────────────────────"
q -q -f "$HERE/01_reference.sql" >/dev/null
pass "01_reference (second run)"

V2=$(q -Atc "select count(*) from ops_procure.vendors")
P2=$(q -Atc "select count(*) from ops_procure.projects")
M2=$(q -Atc "select count(*) from ops_core.legacy_map")
A2=$(q -Atc "select count(*) from ops_acct.accounts")
RUNS=$(q -Atc "select count(distinct run_id) from ops_core.legacy_map")

[ "$V2" = "$V1" ] || fail "re-running imports no vendor twice"  "$V1 then $V2"
[ "$P2" = "$P1" ] || fail "re-running imports no project twice" "$P1 then $P2"
[ "$A2" = "$A1" ] || fail "re-running inserts no account"       "$A1 then $A2"
[ "$M2" = "$M1" ] || fail "the map does not grow on a re-run"   "$M1 then $M2"
[ "$RUNS" = "1" ] || fail "a no-op run records no second run"   "saw $RUNS run ids"
pass "second run changed nothing"

echo
echo "──"
echo "import  ok (idempotent over two runs, $M1 legacy rows accounted for)"
