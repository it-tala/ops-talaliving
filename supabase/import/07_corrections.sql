-- 07_corrections.sql — the corrections the import deliberately did not make.
--
-- The import's job is to carry the old system across **faithfully**, including
-- what is wrong in it. That rule is why `03_ledger.sql` and `04_lines.sql` have
-- no "fix it while we're here" branch: a row that arrives changed is a row
-- nobody can trace back. So the wrongness lands, gets read, and is corrected
-- here — once, on the record, with the before and after both kept.
--
-- Everything in this file is **idempotent by shape, not by flag**: each
-- correction looks for the exact arrangement it is meant to repair and does
-- nothing when it is not there. Run it twice, run it after a re-import, run it
-- against a database where accounting already fixed it by hand — it is a no-op
-- every time but the first.
--
-- Run it like the others (see README.md), after `04_lines.sql`.
--
-- ── What is NOT here ────────────────────────────────────────────────────
--
-- The five transactions whose single line disagrees with its own row by
-- between Rp 4 and Rp 30.000. Those are settled from the document, by
-- Accounting, on the ledger screen — `edit_transaction` exists for exactly
-- that and the person doing it has the receipt in front of them. A script
-- that guesses which of two numbers the paper says would be inventing a
-- figure, and this system does not do that (D217).

\set ON_ERROR_STOP on

begin;

-- ── 1. trx-26-07-27_061: a line filed against the wrong transaction ─────
--
--   transaction : 2026-07-24  OUT  2.500  BANK CHARGES — "Transfer admin fee"
--   its lines   :        2.500  — Transfer admin fee
--               : 15.847.500  — Transfer funding for pay-26-07-27_01
--
-- The Rp 2.500 is correct. It is a bank admin fee, and the second line is a
-- funding transfer: `trx-26-07-27_900` exists on the same date, for exactly
-- Rp 15.847.500, with that same description. Two pushes eleven minutes apart
-- in the old system (08:15 and 08:36); the second filed its purchase row under
-- the first one's `trx_id`.
--
-- **The trap, recorded because it nearly happened.** Read as a totalling
-- error, this looks like a mistyped amount, and the fix looks like raising
-- 2.500 to 15.850.000 — turning a bank charge into Rp 15,85 juta. That
-- correction was demonstrated against production in a rolled-back session
-- before anybody read the lines. A total that does not add up says which
-- number to distrust **only when there is one line**. With two, the
-- disagreement may be about which row a line belongs to, and the totals say
-- nothing about that.
--
-- So the line is **moved, not deleted** (A2/A5) and the amounts of both
-- transactions are left alone. Afterwards each one's lines add up to its own
-- total, which is the whole point.
--
-- There is no seam for this. `transaction_lines` carries an insert policy and
-- no update or delete policy at all, so no grant in the system lets anyone
-- move a line from the web app — deliberately, because moving money between
-- rows is not an edit, it is a re-filing. It is SQL or it is nothing, and the
-- owner asked for SQL.

-- ── The rule, and why it is a rule and not two transaction numbers ──────
--
-- Hard-coding `trx-26-07-27_061` would make this file true once, in one
-- database, and untestable anywhere. The arrangement is what identifies it,
-- and all five conditions have to hold together:
--
--   1. the transaction has **two or more** lines — with one line a total that
--      does not add up says which number to distrust, and that is a different
--      problem with a different fix;
--   2. its lines do not sum to its own amount;
--   3. one of those lines matches another transaction **exactly** — same date,
--      same amount to the rupiah, same description after trimming;
--   4. that other transaction has **no lines at all**, so nothing is being
--      merged into an itemisation somebody built;
--   5. and it is not the transaction we are moving away from.
--
-- Two rows agreeing on date, amount and description by coincidence is not
-- something this data does. Against production the rule matched exactly one
-- line, the one read by hand first — and matches none now.

create temp table _refiled on commit drop as
with unbalanced as (
  select t.id, t.trx_no, t.trx_date, t.amount_idr
    from ops_acct.transactions t
    join ops_acct.transaction_lines l on l.trx_id = t.id
   group by t.id, t.trx_no, t.trx_date, t.amount_idr
  having count(*) >= 2
     and sum(l.amount) <> t.amount_idr)
select l.id        as line_id,
       b.id        as from_trx,
       b.trx_no    as from_trx_no,
       l.line_no   as from_line_no,
       d.id        as to_trx,
       d.trx_no    as to_trx_no,
       l.amount,
       l.description,
       1           as to_line_no   -- it has no lines; condition 4
  from unbalanced b
  join ops_acct.transaction_lines l on l.trx_id = b.id
  join ops_acct.transactions d
       on  d.id         <> b.id
       and d.trx_date    = b.trx_date
       and d.amount_idr  = l.amount
       and btrim(d.description) = btrim(l.description)
       and not exists (select 1 from ops_acct.transaction_lines y
                        where y.trx_id = d.id);

update ops_acct.transaction_lines l
   set trx_id  = f.to_trx,
       line_no = f.to_line_no
  from _refiled f
 where l.id = f.line_id;

-- The audit row. `actor_id` stays null on purpose: nobody typed this into the
-- application, a script did, and `detail` says which script. Naming a person
-- here would be the audit trail telling its first lie (D190).
insert into ops_core.audit_log
  (service, entity, entity_no, action, outcome, reason, before, after, detail)
select 'accounting',
       'transaction_line',
       f.from_trx_no,
       'refile',
       'ok',
       'Line was filed against the wrong transaction in the legacy system and'
       || ' the import carried it across unchanged. Moved to ' || f.to_trx_no
       || ', which is the same date, the same amount and the same description,'
       || ' and had no lines of its own. Neither transaction amount was'
       || ' touched — what was wrong was which row the line sat on.',
       jsonb_build_object('trx_no', f.from_trx_no, 'line_no', f.from_line_no,
                          'amount', f.amount, 'description', f.description),
       jsonb_build_object('trx_no', f.to_trx_no,   'line_no', f.to_line_no,
                          'amount', f.amount, 'description', f.description),
       jsonb_build_object('by', 'supabase/import/07_corrections.sql',
                          'line_id', f.line_id,
                          'legacy_source', 'public.item_purchases')
  from _refiled f;

-- The map is the record of which legacy row became which of ours, so it has to
-- say that this one moved. `on conflict` is not needed — the row is already
-- there; it is the note that was missing.
update ops_core.legacy_map m
   set note = concat_ws(' ', nullif(m.note, ''),
                        'Re-filed from ' || f.from_trx_no || ' to '
                        || f.to_trx_no || ' by 07_corrections.sql — the legacy'
                        || ' push named the wrong trx_id.')
  from _refiled f
 where m.target_table = 'ops_acct.transaction_lines'
   and m.target_id    = f.line_id;

\echo ''
\echo '── 1. lines filed against the wrong transaction ────────────────────'
select case when count(*) = 0
            then 'nothing to do — no line is in that arrangement'
            else count(*)::text end as lines_moved
  from _refiled;
select from_trx_no, from_line_no, amount, description, to_trx_no
  from _refiled order by from_trx_no, from_line_no;

commit;

\echo ''
\echo '── what still does not add up (all one-line, for accounting) ───────'
select t.trx_no,
       t.amount_idr               as says,
       sum(l.amount)              as its_lines_say,
       count(l.id)                as lines
  from ops_acct.transactions t
  join ops_acct.transaction_lines l on l.trx_id = t.id
 group by t.trx_no, t.amount_idr
having sum(l.amount) <> t.amount_idr
 order by abs(sum(l.amount) - t.amount_idr) desc;

-- ── 2. Vendors that did not resolve because of punctuation ──────────────
--
-- `03_ledger.sql` resolves a vendor by name or leaves it null, and it matches
-- on the name as written. Eleven legacy names did not resolve. Eight of them
-- are the **same name with different punctuation**:
--
--   ALMART                    AL MART                  V-0002
--   ALRIZKY JAYANA            AL RIZKY JAYANA          V-0059
--   FAFA KONVEKSI-SUNARNO     FAFA KONVEKSI - SUNARNO  V-0110
--   FAHRUL JATI-  JAMALLUDIN  FAHRUL JATI- JAMALLUDIN  V-0199
--   GRAN MAX-ANDI             GRAN MAX - ANDI          V-0071
--   GRAN MAX-SUNARNO          GRAN MAX - SUNARNO       V-0094
--   MOJO INDAH,               MOJO INDAH               V-0097
--   MR DIY                    MR D.I.Y.                V-0028
--
-- This is **canonicalisation, not fuzzy matching**, and the difference
-- matters. Strip everything that is not a letter or a digit and the two
-- strings are byte-for-byte equal — there is no threshold, no distance, no
-- judgement. The join below also refuses to act unless exactly one vendor
-- canonicalises to that form, so a name that becomes ambiguous when the
-- punctuation goes (`TALA HOME PT` and `TALAHOME PT` both become
-- `TALAHOMEPT`) resolves to nothing rather than to a coin toss.
--
-- The import itself still must not do this. It carries what the old system
-- wrote; deciding that two spellings are one vendor is a reading of the data,
-- and a reading belongs here, where it is one statement somebody can argue
-- with, not buried in a join that runs over 3.287 rows.
--
-- ── What this deliberately leaves alone ──────────────────────────────────
--
--   GOLDEN SWALAYAN · TOKO SRC ZURIYAH · UD. SENGON LAUT CILACAP
--       Three transactions, no vendor of that name in the system at all.
--       Creating one is the owner's decision, not a script's.
--
--   Projects. `CHAIR PHILIPPINES` (6 transactions) against the project table's
--       `CHAIR PHILIPHINES` is **PP against PH** — a different spelling, not
--       different punctuation, and canonicalising does not make them equal.
--       `FAIRMONT` (5 transactions) has no project row at all; it was the one
--       row `01_reference.sql` refused. Both stay null until somebody says so.

begin;

create temp table _fix_vendor on commit drop as
select t.id              as trx_id,
       t.trx_no,
       btrim(p.vendor)   as legacy_text,
       v.id              as vendor_id,
       v.code            as vendor_code,
       v.name            as vendor_name
  from ops_acct.transactions t
  join public.transactions p on 'legacy:' || p.trx_id = t.source_ref
  join lateral (
        select v2.id, v2.code, v2.name
          from ops_procure.vendors v2
         where upper(regexp_replace(v2.name, '[^A-Za-z0-9]', '', 'g'))
             = upper(regexp_replace(btrim(p.vendor), '[^A-Za-z0-9]', '', 'g'))
       ) v on true
 where t.vendor_id is null
   and coalesce(btrim(p.vendor), '') <> ''
   -- exactly one, or nothing
   and (select count(*) from ops_procure.vendors v3
         where upper(regexp_replace(v3.name, '[^A-Za-z0-9]', '', 'g'))
             = upper(regexp_replace(btrim(p.vendor), '[^A-Za-z0-9]', '', 'g'))) = 1;

update ops_acct.transactions t
   set vendor_id = f.vendor_id
  from _fix_vendor f
 where t.id = f.trx_id;

insert into ops_core.audit_log
  (service, entity, entity_no, action, outcome, reason, before, after, detail)
select 'accounting', 'transaction', f.trx_no, 'attribute_vendor', 'ok',
       'The legacy row named a vendor the import could not resolve: '
       || quote_literal(f.legacy_text) || '. It is ' || f.vendor_name
       || ' with different punctuation — the two names are identical once'
       || ' everything but letters and digits is removed, and exactly one'
       || ' vendor matches.',
       jsonb_build_object('vendor', null, 'legacy_text', f.legacy_text),
       jsonb_build_object('vendor_code', f.vendor_code, 'vendor_name', f.vendor_name),
       jsonb_build_object('by', 'supabase/import/07_corrections.sql',
                          'rule', 'exact match after stripping non-alphanumerics')
  from _fix_vendor f;

update ops_core.legacy_map m
   set note = concat_ws(' ', nullif(m.note, ''),
               'Vendor resolved to ' || f.vendor_code || ' (' || f.vendor_name
               || ') by 07_corrections.sql — same name, different punctuation.')
  from _fix_vendor f
 where m.source_table = 'public.transactions'
   and m.target_table = 'ops_acct.transactions'
   and m.target_id    = f.trx_id;

\echo ''
\echo '── 2. vendors resolved by punctuation ──────────────────────────────'
select legacy_text, vendor_code, vendor_name, count(*) as transactions
  from _fix_vendor group by 1,2,3 order by 1;

commit;

\echo ''
\echo '── still unresolved, for a person ──────────────────────────────────'
select btrim(p.vendor) as legacy_vendor, count(*) as transactions,
       sum(t.amount_idr) as total
  from ops_acct.transactions t
  join public.transactions p on 'legacy:' || p.trx_id = t.source_ref
 where t.vendor_id is null and coalesce(btrim(p.vendor), '') <> ''
 group by 1 order by 3 desc;
