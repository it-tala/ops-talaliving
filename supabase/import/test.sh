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
echo "── items ───────────────────────────────────────────────────────────"
q -q -f "$HERE/02_items.sql" >/dev/null
pass "02_items (first run)"

I1=$(q -Atc "select count(*) from ops_procure.items")
[ "$I1" = "5" ] || fail "every item lands, unit or no unit" "saw $I1 of 5"
pass "all 5 items imported"

# The owner's ruling, made literal: an item with no unit is imported with none.
# Getting this wrong is not a crash — it is a `pcs` nobody chose, which reads
# exactly like a unit somebody did.
U=$(q -Atc "select coalesce(base_uom,'(none)') from ops_procure.items where name='PAKU BETON'")
[ "$U" = "(none)" ] || fail "no unit stays no unit" "saw '$U' — a unit was invented"
pass "no unit stays no unit"

# `pail/drum` names two units, which is not a unit. It must not silently become
# one of the two.
U=$(q -Atc "select coalesce(base_uom,'(none)') from ops_procure.items where name='CAT DASAR'")
[ "$U" = "(none)" ] || fail "an ambiguous unit is not guessed" "saw '$U'"
q -Atc "select note from ops_core.legacy_map
         where source_table='public.items'
           and target_id=(select id from ops_procure.items where name='CAT DASAR')" \
  | grep -q "pail/drum" || fail "the original unit text is kept" "note lost it"
pass "'pail/drum' refused, original kept"

# Case fold, fold-onto-existing, and a code 0031 added.
for pair in "SEKRUP 3 INCI:pcs" "TINER SUPER:ltr" "TUKANG AMPLAS:person"; do
  n="${pair%%:*}"; want="${pair##*:}"
  got=$(q -Atc "select coalesce(base_uom,'(none)') from ops_procure.items where name='$n'")
  [ "$got" = "$want" ] || fail "$n maps to $want" "saw '$got'"
done
pass "PCS→pcs, Liter→ltr, orang→person"

# `non-item` is not one of ours. It lands uncurated rather than guessed at.
C=$(q -Atc "select category_code from ops_procure.items where name='CAT DASAR'")
[ "$C" = "uncurated" ] || fail "an unmapped category lands uncurated" "saw '$C'"
pass "unmapped category → uncurated"

# A last-vendor name that resolves becomes a key; one that does not stays null
# rather than creating a vendor from a name nobody checked.
LV=$(q -Atc "select (last_vendor_id is not null)::text from ops_procure.items where name='SEKRUP 3 INCI'")
[ "$LV" = "true" ] || fail "a known last vendor resolves" "saw $LV"
LV=$(q -Atc "select (last_vendor_id is null)::text from ops_procure.items where name='CAT DASAR'")
[ "$LV" = "true" ] || fail "an unknown last vendor stays null" "a vendor was invented"
pass "last vendor resolved, never invented"


echo
echo "── ledger ──────────────────────────────────────────────────────────"
q -q -f "$HERE/03_ledger.sql" >/dev/null
pass "03_ledger (first run)"

# Twelve legacy rows, four of them unimportable for four different reasons.
T1=$(q -Atc "select count(*) from ops_acct.transactions")
[ "$T1" = "8" ] || fail "eight of twelve transactions land" "saw $T1"
TR=$(q -Atc "select count(*) from ops_core.legacy_map
              where source_table='public.transactions' and outcome='refused'")
[ "$TR" = "4" ] || fail "four refusals, one per shape" "saw $TR"
pass "8 imported, 4 refused"

# Each refusal names its own reason. Four rows refused under one message would
# be a list nobody can work through — which is what the refusals are for.
for want in "amount is 0" "no direction" "is not an account" "has no code"; do
  q -Atc "select note from ops_core.legacy_map
           where source_table='public.transactions' and outcome='refused'" \
    | grep -q "$want" || fail "a refusal says '$want'" "no refusal mentions it"
done
pass "four refusals, four distinct reasons"

# **The number people already quote.** `trx-26-01-02_001` in the old system is
# `trx-26-01-02_001` here, because the two numbering schemes are the same one.
# A screenshot from January still finds its row.
N=$(q -Atc "select count(*) from ops_acct.transactions where trx_no = 'trx-26-01-02_001'")
[ "$N" = "1" ] || fail "the legacy transaction number is carried across" "saw $N"
pass "trx_no survives the move"

# The author the old system recorded is recovered, not flattened onto the
# fallback. One of the twelve has a chat event from somebody this system knows.
AUTHOR=$(q -Atc "select u.email::text from ops_acct.transactions t
                   join ops_core.users u on u.id = t.posted_by
                  where t.trx_no = 'trx-26-01-02_001'")
[ "$AUTHOR" = "evin@talaliving.com" ] \
  || fail "a recorded author is recovered" "saw '$AUTHOR' — it was flattened onto the fallback"

# And the one whose sender chat knows but this system does not falls back,
# rather than failing or inventing a user.
AUTHOR=$(q -Atc "select u.email::text from ops_acct.transactions t
                   join ops_core.users u on u.id = t.posted_by
                  where t.trx_no = 'trx-26-01-12_011'")
[ "$AUTHOR" = "shared@talaliving.com" ] \
  || fail "an unknown sender falls back" "saw '$AUTHOR'"
pass "author recovered where recorded, shared@ where not"

# A vendor name that resolves becomes a key; one that does not stays null with
# its text kept. Never created — a vendor made from a ledger line is a
# duplicate nobody will ever find.
VOK=$(q -Atc "select (vendor_id is not null)::text from ops_acct.transactions where trx_no='trx-26-01-02_001'")
[ "$VOK" = "true" ] || fail "a known vendor resolves" "saw $VOK"
VNO=$(q -Atc "select (vendor_id is null)::text from ops_acct.transactions where trx_no='trx-26-01-04_003'")
[ "$VNO" = "true" ] || fail "an unknown vendor stays null" "a vendor was invented"
VC=$(q -Atc "select count(*) from ops_procure.vendors where name like '%TIDAK ADA%'")
[ "$VC" = "0" ] || fail "and is not created" "the import made a vendor from a ledger line"
pass "vendor resolved, never invented"

# `CHAIR PHILIPPINES` on the transaction against `CHAIR PHILIPHINES` in the
# project table. Two live systems disagreeing about a name, and the import must
# leave it null rather than match it away — a fuzzy comparison here is how a
# cost lands on the wrong project.
POK=$(q -Atc "select (project_id is not null)::text from ops_acct.transactions where trx_no='trx-26-01-02_001'")
[ "$POK" = "true" ] || fail "a project name that matches resolves" "saw $POK"
PNO=$(q -Atc "select (project_id is null)::text from ops_acct.transactions where trx_no='trx-26-01-05_004'")
[ "$PNO" = "true" ] || fail "a misspelled project stays null" "it was matched away"
q -Atc "select note from ops_core.legacy_map where source_id='trx-26-01-05_004'" \
  | grep -q "CHAIR PHILIPPINES" || fail "the original project text is kept" "note lost it"
pass "project resolved by name, spelling difference refused"

# No type at all is filed OTHERS, because `type_code` is not null — and the map
# says so, which is what keeps those rows findable among the ones somebody
# deliberately filed that way.
TY=$(q -Atc "select type_code from ops_acct.transactions where trx_no='trx-26-01-10_009'")
[ "$TY" = "OTHERS" ] || fail "a blank type is filed OTHERS" "saw '$TY'"
q -Atc "select note from ops_core.legacy_map where source_id='trx-26-01-10_009'" \
  | grep -q "indistinguishable" || fail "and the map says the original was blank" "note does not"
pass "no type → OTHERS, and noted"

# A blank status is posted, not left to a default nobody chose.
ST=$(q -Atc "select status::text from ops_acct.transactions where trx_no='trx-26-01-11_010'")
[ "$ST" = "POSTED" ] || fail "a blank status is posted" "saw '$ST'"
pass "no status → POSTED"

# `posted_at` carries the legacy moment. A ledger whose rows all claim to have
# been posted on the afternoon of the import cannot answer *what did we know in
# March*.
PA=$(q -Atc "select (posted_at::date = '2026-01-02')::text from ops_acct.transactions where trx_no='trx-26-01-02_001'")
[ "$PA" = "true" ] || fail "posted_at is the legacy moment" "it defaulted to now()"
pass "posted_at is when it happened"

# ── the reconciliation, which is why this file exists ─────────────────────
#
# Openings are 0 on both sides, so a balance here is exactly the sum of what
# was imported. Three accounts have no refused rows and must agree to the
# rupiah. The two that differ must differ by **exactly** the refused amount —
# any other number is a row the import lost without saying so.
AGREE=$(q -Atc "with ours as (
    select a.code, sum(case when t.direction='IN' then t.amount_idr else -t.amount_idr end) net
      from ops_acct.transactions t join ops_acct.accounts a on a.id=t.account_id
     where t.status <> 'VOID' group by a.code),
  theirs as (
    select btrim(account) code, sum(case when in_out='IN' then idr_amount else -idr_amount end) net
      from public.transactions
     where account is not null and idr_amount > 0 and in_out in ('IN','OUT') group by 1)
  select count(*) from ours o join theirs x on x.code=o.code where o.net = x.net")
[ "$AGREE" = "3" ] || fail "the untouched accounts reconcile to the rupiah" "only $AGREE of 3 agree"
pass "3 accounts reconcile exactly"

DIFF=$(q -Atc "with ours as (
    select a.code, sum(case when t.direction='IN' then t.amount_idr else -t.amount_idr end) net
      from ops_acct.transactions t join ops_acct.accounts a on a.id=t.account_id
     where t.status <> 'VOID' group by a.code),
  theirs as (
    select btrim(account) code, sum(case when in_out='IN' then idr_amount else -idr_amount end) net
      from public.transactions
     where account is not null and idr_amount > 0 and in_out in ('IN','OUT') group by 1)
  select string_agg(coalesce(o.code,x.code) || '=' || (coalesce(o.net,0)-coalesce(x.net,0))::text, ',' order by coalesce(o.code,x.code))
    from ours o full join theirs x on x.code=o.code
   where coalesce(o.net,0) <> coalesce(x.net,0)")
[ "$DIFF" = "BNI 325=42000,BRI 900=123000" ] \
  || fail "and the differences are exactly the refused rows" "saw $DIFF"
pass "the two gaps are exactly the four refusals"

# Re-read the map now that every file has run. Taken earlier it would be a
# count from a different moment, and comparing it with the second run would
# report a failure that is only the measurement moving.
M1=$(q -Atc "select count(*) from ops_core.legacy_map")

echo
echo "── second run — the one that matters ───────────────────────────────"
q -q -f "$HERE/01_reference.sql" >/dev/null
q -q -f "$HERE/02_items.sql" >/dev/null
q -q -f "$HERE/03_ledger.sql" >/dev/null
pass "01_reference + 02_items + 03_ledger (second run)"

V2=$(q -Atc "select count(*) from ops_procure.vendors")
P2=$(q -Atc "select count(*) from ops_procure.projects")
M2=$(q -Atc "select count(*) from ops_core.legacy_map")
A2=$(q -Atc "select count(*) from ops_acct.accounts")
I2=$(q -Atc "select count(*) from ops_procure.items")
T2=$(q -Atc "select count(*) from ops_acct.transactions")
RUNS=$(q -Atc "select count(distinct run_id) from ops_core.legacy_map")

[ "$V2" = "$V1" ] || fail "re-running imports no vendor twice"  "$V1 then $V2"
[ "$P2" = "$P1" ] || fail "re-running imports no project twice" "$P1 then $P2"
[ "$A2" = "$A1" ] || fail "re-running inserts no account"       "$A1 then $A2"
[ "$I2" = "$I1" ] || fail "re-running imports no item twice"    "$I1 then $I2"
# The one that would be a duplicate of money rather than of a reference row.
[ "$T2" = "$T1" ] || fail "re-running books no transaction twice" "$T1 then $T2"
[ "$M2" = "$M1" ] || fail "the map does not grow on a re-run"   "$M1 then $M2"
[ "$RUNS" = "3" ] || fail "three files, three run ids on the first pass" "saw $RUNS"
pass "second run changed nothing"

echo
echo "──"
echo "import  ok (idempotent over two runs, $M1 legacy rows accounted for)"
