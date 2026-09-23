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

[ "$V1" = "5" ]  || fail "five vendors land"             "saw $V1"
[ "$P1" = "2" ]  || fail "two projects land, not three"  "saw $P1 — the one with no code must be refused"
[ "$R1" = "2" ]  || fail "two refusals"                  "saw $R1 — expected FAIRMONT and BRI 900"
pass "5 vendors, 2 projects, 2 refusals"

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

# Sixteen legacy rows, four of them unimportable for four different reasons.
T1=$(q -Atc "select count(*) from ops_acct.transactions")
[ "$T1" = "12" ] || fail "twelve of sixteen transactions land" "saw $T1"
TR=$(q -Atc "select count(*) from ops_core.legacy_map
              where source_table='public.transactions' and outcome='refused'")
[ "$TR" = "4" ] || fail "four refusals, one per shape" "saw $TR"
pass "12 imported, 4 refused"

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


echo
echo "── lines ───────────────────────────────────────────────────────────"
q -q -f "$HERE/04_lines.sql" >/dev/null
pass "04_lines (first run)"

L1=$(q -Atc "select count(*) from ops_acct.transaction_lines")
[ "$L1" = "6" ] || fail "six of seven purchase lines land" "saw $L1"
LR=$(q -Atc "select count(*) from ops_core.legacy_map
              where source_table='public.item_purchases' and outcome='refused'")
[ "$LR" = "1" ] || fail "the line on a refused transaction is refused" "saw $LR"
# And the refusal points at the transaction's own row, so the two lists join up
# rather than each looking like an unexplained gap.
q -Atc "select note from ops_core.legacy_map
         where source_table='public.item_purchases' and outcome='refused'" \
  | grep -q "trx-26-01-06_005" || fail "the refusal names its transaction" "note does not"
pass "6 lines imported, 1 refused naming its transaction"

# Two lines on one transaction, numbered in the order they were recorded.
NOS=$(q -Atc "select string_agg(l.line_no::text, ',' order by l.line_no)
                from ops_acct.transaction_lines l join ops_acct.transactions t on t.id=l.trx_id
               where t.trx_no='trx-26-01-04_003'")
[ "$NOS" = "1,2" ] || fail "lines on one transaction are numbered from 1" "saw $NOS"
pass "line_no runs 1,2 within a transaction"

# `item_raw` is what somebody typed; the item name is where it was filed. The
# line carries the first, and falls back to the second only when it is blank.
D=$(q -Atc "select l.description from ops_acct.transaction_lines l join ops_acct.transactions t on t.id=l.trx_id
             where t.trx_no='trx-26-01-02_001'")
[ "$D" = 'SEKRUP 3" GALVANIS' ] || fail "the line says what was written on it" "saw '$D'"
D=$(q -Atc "select description from ops_acct.transaction_lines where amount = 90000")
[ "$D" = "CAT DASAR" ] || fail "a blank item_raw falls back to the item name" "saw '$D'"
pass "description is what was typed, or the item's name"

# The shared unit map, reached from a second file. `hari` and `duss` were added
# for these rows; `liter` and `PCS` already worked for 02.
for pair in "100000:pcs" "160000:ltr" "30000:day"; do
  amt="${pair%%:*}"; want="${pair##*:}"
  got=$(q -Atc "select coalesce(uom,'(none)') from ops_acct.transaction_lines where amount=$amt")
  [ "$got" = "$want" ] || fail "the line of $amt takes unit $want" "saw '$got'"
done
# And one nobody here can read arrives with none rather than a guess.
U=$(q -Atc "select coalesce(uom,'(none)') from ops_acct.transaction_lines where amount=90000")
[ "$U" = "(none)" ] || fail "an unreadable unit is not guessed" "saw '$U'"
q -Atc "select note from ops_core.legacy_map
         where source_id='ccc00000-0000-0000-0000-000000000003'" \
  | grep -q "slop" || fail "and its text is kept" "note lost it"
pass "units folded through _units.sql, unknown ones left null"

# A line that does not sum to its transaction is imported as it stands. Six of
# the 1.188 real ones do not add up, and a line adjusted so an arithmetic check
# passes is a fact replaced by a preference.
MISMATCH=$(q -Atc "select count(*) from (
    select t.id from ops_acct.transactions t join ops_acct.transaction_lines l on l.trx_id=t.id
     group by t.id, t.amount_idr having sum(l.amount) <> t.amount_idr) x")
[ "$MISMATCH" = "2" ] || fail "a line that does not add up is kept, not adjusted" "saw $MISMATCH"
pass "the two that do not add up are kept and reported"

# Nothing derived was written. `last_price` is the catalogue's own arithmetic
# (A3) and a line is not licence to overwrite it.
LP=$(q -Atc "select coalesce(last_price::text,'(null)') from ops_procure.items where name='SEKRUP 3 INCI'")
[ "$LP" = "(null)" ] || [ "$LP" != "1000" ] || fail "the import does not rewrite last_price" "saw $LP"
pass "no derived state written"


echo
echo "── evidence ────────────────────────────────────────────────────────"
q -q -f "$HERE/05_evidence.sql" >/dev/null
pass "05_evidence (first run)"

# **Five doc rows over four files, and only three files land.** The counts are
# the assertion: an import that made one attachment per doc row would produce
# five, and would have erased the fact that one transfer proof covered two
# purchases.
A1=$(q -Atc "select count(*) from ops_core.attachments")
K1=$(q -Atc "select count(*) from ops_core.attachment_links")
[ "$A1" = "3" ] || fail "three files, not six doc rows" "saw $A1 attachments"
# Six documents, four claims: one is refused, and one repeats another exactly.
[ "$K1" = "4" ] || fail "six documents make four distinct claims" "saw $K1 links"
pass "3 files, 4 claims from 6 documents"

# Two identical claims are one claim, and the map says so — otherwise *fewer
# links than documents* is a discrepancy somebody finds later with no
# explanation attached.
q -Atc "select note from ops_core.legacy_map where source_id='d0c00000-0000-0000-0000-000000000006'" \
  | grep -q "repeats a claim" || fail "a repeated claim says it repeats one" "note does not"
MAPPED=$(q -Atc "select count(*) from ops_core.legacy_map where source_table='public.transaction_docs'")
[ "$MAPPED" = "6" ] || fail "every document is accounted for either way" "saw $MAPPED of 6"
pass "the repeat is recorded, not lost"

# The one that matters: one file, two transactions.
SHARED=$(q -Atc "select count(*) from ops_core.attachment_links k
                   join ops_core.attachments a on a.id=k.attachment_id
                  where a.filename='1SharedProofAAA.jpg'")
[ "$SHARED" = "2" ] || fail "one transfer proof covers two purchases" "saw $SHARED links"
DUP=$(q -Atc "select count(*) from ops_core.attachments where filename='1SharedProofAAA.jpg'")
[ "$DUP" = "1" ] || fail "and it is one file, not two" "saw $DUP copies"
pass "one proof, two transactions, one file"

# A file whose only mention is on a refused transaction must not arrive either.
# An attachment nothing points at reads as filed on an evidence screen.
ORPH=$(q -Atc "select count(*) from ops_core.attachments a
                where not exists (select 1 from ops_core.attachment_links k where k.attachment_id=a.id)")
[ "$ORPH" = "0" ] || fail "no attachment arrives with nothing pointing at it" "saw $ORPH"
Q=$(q -Atc "select count(*) from ops_core.attachments where filename like '1OrphanDDD%'")
[ "$Q" = "0" ] || fail "the file behind a refused document stays out" "it was imported"
pass "no orphan files"

# `filename` is not null and Drive gave none, so it is the file's own id plus an
# extension from its mime — the way the live capture pipeline already spells it.
F=$(q -Atc "select filename from ops_core.attachments where sha256='d4e5f6'")
[ "$F" = "1NotaBBB.pdf" ] || fail "the filename is the drive id and its type" "saw '$F'"
pass "filename built from the file's own identity"

# The old vocabulary is the new one: these labels resolve verbatim, and a blank
# type is filed Others rather than guessed.
KINDS=$(q -Atc "select string_agg(kind::text, ',' order by kind::text) from (
    select distinct kind from ops_core.attachment_links) x")
[ "$KINDS" = "nota,other,transfer_proof" ] || fail "document types resolve verbatim" "saw $KINDS"
q -Atc "select note from ops_core.legacy_map where source_id='d0c00000-0000-0000-0000-000000000004'" \
  | grep -q "indistinguishable" || fail "a blank type is noted as such" "note does not say"
pass "types resolve, blank ones noted"

# The uploader the old system recorded is recovered; the rest fall back, and the
# map says which is which.
UP=$(q -Atc "select u.email::text from ops_core.attachments a join ops_core.users u on u.id=a.uploaded_by
              where a.filename='1SharedProofAAA.jpg'")
[ "$UP" = "evin@talaliving.com" ] || fail "a recorded uploader is recovered" "saw '$UP'"
UP=$(q -Atc "select u.email::text from ops_core.attachments a join ops_core.users u on u.id=a.uploaded_by
              where a.filename='1NotaBBB.pdf'")
[ "$UP" = "shared@talaliving.com" ] || fail "and one with no event falls back" "saw '$UP'"
pass "uploader recovered where recorded"

# A blob nothing cites is not evidence. Most of the 1.442 real ones are like it.
q -Atc "select count(*) from ops_core.legacy_map where source_id='b10b0000-0000-0000-0000-000000000004'" \
  | grep -q "^0$" || fail "a blob nothing points at is not imported" "it was"
pass "an uncited blob is left alone"

echo
echo "── corrections ─────────────────────────────────────────────────────"
q -q -f "$HERE/07_corrections.sql" >/dev/null
pass "07_corrections (first run)"

# ── 1. the line that was filed against the wrong transaction ─────────────
#
# `trx-26-01-20_020` says 2.500 and its lines say 1.502.500. Read as a
# totalling error that is a mistyped amount, and the "fix" turns a bank charge
# into Rp 1,5 juta. It is not: the 1.500.000 line belongs to
# `trx-26-01-20_900`, which sits on the same date for exactly that amount with
# that description and has no lines of its own.
MOVED=$(q -Atc "select t.trx_no from ops_acct.transaction_lines l
                  join ops_acct.transactions t on t.id = l.trx_id
                 where l.amount = 1500000")
[ "$MOVED" = "trx-26-01-20_900" ] \
  || fail "the misfiled line moves to the transaction it belongs to" "it is on '$MOVED'"

# **Neither amount is touched.** This is the assertion that would have caught
# the wrong fix, so it is written as the amount rather than as a comparison.
A=$(q -Atc "select amount_idr::text from ops_acct.transactions where trx_no='trx-26-01-20_020'")
[ "$A" = "2500" ] || fail "the bank charge is still a bank charge" "it became $A"
A=$(q -Atc "select amount_idr::text from ops_acct.transactions where trx_no='trx-26-01-20_900'")
[ "$A" = "1500000" ] || fail "and the transfer is unchanged" "it became $A"

# Nothing was deleted (A2/A5): the line count is what it was.
L3=$(q -Atc "select count(*) from ops_acct.transaction_lines")
[ "$L3" = "$L1" ] || fail "the line is moved, never deleted" "$L1 became $L3"

# Both now agree with their own lines, and the one-line mismatch is untouched —
# that one is accounting's, from the document, and a script must not settle it.
MISMATCH=$(q -Atc "select count(*) from (
    select t.id from ops_acct.transactions t join ops_acct.transaction_lines l on l.trx_id=t.id
     group by t.id, t.amount_idr having sum(l.amount) <> t.amount_idr) x")
[ "$MISMATCH" = "1" ] || fail "only the one-line disagreement is left" "saw $MISMATCH"
pass "line re-filed, both amounts untouched, nothing deleted"

# ── 2. vendors that differ only in punctuation ───────────────────────────
V=$(q -Atc "select coalesce(v.name,'(null)') from ops_acct.transactions t
              left join ops_procure.vendors v on v.id = t.vendor_id
             where t.trx_no = 'trx-26-01-21_021'")
[ "$V" = "UD SUMBER REJEKI" ] \
  || fail "'UD. SUMBER-REJEKI' resolves to the vendor it is" "saw '$V'"

# **The one that must not resolve.** `PT TALA-HOME` canonicalises to the same
# string as both `PT TALA HOME` and `PT TALAHOME`. A rule that picks one of
# them is a rule that will quietly pick the wrong one on real data.
V=$(q -Atc "select coalesce(v.name,'(null)') from ops_acct.transactions t
              left join ops_procure.vendors v on v.id = t.vendor_id
             where t.trx_no = 'trx-26-01-22_022'")
[ "$V" = "(null)" ] || fail "an ambiguous name resolves to nothing" "it chose '$V'"

# And no vendor was created to make either of them work.
VC=$(q -Atc "select count(*) from ops_procure.vendors")
[ "$VC" = "$V1" ] || fail "no vendor is created by a correction" "$V1 became $VC"
pass "punctuation resolved, ambiguity refused, nothing created"

# Every change carries its own audit row, with `actor_id` null — a script did
# this, and the trail must not name a person who did not.
AU=$(q -Atc "select count(*) from ops_core.audit_log
              where detail->>'by' = 'supabase/import/07_corrections.sql'")
[ "$AU" = "2" ] || fail "one audit row per change" "saw $AU"
NA=$(q -Atc "select count(*) from ops_core.audit_log
              where detail->>'by' = 'supabase/import/07_corrections.sql' and actor_id is not null")
[ "$NA" = "0" ] || fail "and none of them names an actor" "$NA do"
pass "2 audit rows, no actor claimed"

# Idempotent **by shape, not by flag**. A second run finds nothing in that
# arrangement, so it writes nothing — which is what lets this file be re-run
# beside the import instead of once, by hand, and remembered.
q -q -f "$HERE/07_corrections.sql" >/dev/null
AU2=$(q -Atc "select count(*) from ops_core.audit_log
               where detail->>'by' = 'supabase/import/07_corrections.sql'")
[ "$AU2" = "2" ] || fail "a second run corrects nothing again" "$AU became $AU2"
pass "07_corrections (second run) changed nothing"

# Re-read the map now that every file has run. Taken earlier it would be a
# count from a different moment, and comparing it with the second run would
# report a failure that is only the measurement moving.
M1=$(q -Atc "select count(*) from ops_core.legacy_map")

echo
echo "── second run — the one that matters ───────────────────────────────"
q -q -f "$HERE/01_reference.sql" >/dev/null
q -q -f "$HERE/02_items.sql" >/dev/null
q -q -f "$HERE/03_ledger.sql" >/dev/null
q -q -f "$HERE/04_lines.sql" >/dev/null
q -q -f "$HERE/05_evidence.sql" >/dev/null
q -q -f "$HERE/07_corrections.sql" >/dev/null
pass "all six files (second run)"

V2=$(q -Atc "select count(*) from ops_procure.vendors")
P2=$(q -Atc "select count(*) from ops_procure.projects")
M2=$(q -Atc "select count(*) from ops_core.legacy_map")
A2=$(q -Atc "select count(*) from ops_acct.accounts")
I2=$(q -Atc "select count(*) from ops_procure.items")
T2=$(q -Atc "select count(*) from ops_acct.transactions")
L2=$(q -Atc "select count(*) from ops_acct.transaction_lines")
A2=$(q -Atc "select count(*) from ops_core.attachments")
K2=$(q -Atc "select count(*) from ops_core.attachment_links")
RUNS=$(q -Atc "select count(distinct run_id) from ops_core.legacy_map")

[ "$V2" = "$V1" ] || fail "re-running imports no vendor twice"  "$V1 then $V2"
[ "$P2" = "$P1" ] || fail "re-running imports no project twice" "$P1 then $P2"
[ "$A2" = "$A1" ] || fail "re-running inserts no account"       "$A1 then $A2"
[ "$I2" = "$I1" ] || fail "re-running imports no item twice"    "$I1 then $I2"
# The one that would be a duplicate of money rather than of a reference row.
[ "$T2" = "$T1" ] || fail "re-running books no transaction twice" "$T1 then $T2"
[ "$L2" = "$L1" ] || fail "re-running lines no purchase twice"   "$L1 then $L2"
[ "$A2" = "$A1" ] || fail "re-running files no document twice"   "$A1 then $A2"
[ "$K2" = "$K1" ] || fail "re-running claims nothing twice"      "$K1 then $K2"
[ "$M2" = "$M1" ] || fail "the map does not grow on a re-run"   "$M1 then $M2"
[ "$RUNS" = "5" ] || fail "five files, five run ids on the first pass" "saw $RUNS"
pass "second run changed nothing"

echo
echo "──"
echo "import  ok (idempotent over two runs, $M1 legacy rows accounted for)"
