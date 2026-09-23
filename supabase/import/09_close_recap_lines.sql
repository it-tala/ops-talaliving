-- 09_close_recap_lines.sql — close what import 08 carried, and reopen ten.
--
-- Owner's instruction, 2026-09-23 (it@talaliving.com): every purchase request
-- from the PR recap sheet is complete, **except ten** that are to read as newly
-- entered and waiting for approval.
--
-- ── The ten ─────────────────────────────────────────────────────────────
--
-- Import 08 gave each an approval row from the sheet's EJO APPROVAL tick. The
-- owner says they have not been decided, so those rows are removed — not
-- countered with an `approved = false` row, which would read as EJO taking a
-- yes back. Each removal is an audit row carrying the row it removed. Nothing
-- else on the ten is touched: they keep their numbers, amounts and notes.
--
-- ── The rest ────────────────────────────────────────────────────────────
--
-- COMPLETED is reached through `ops_procure.line_closures` (0122), not by
-- writing receiving reports or proofs that do not exist. A line whose money
-- falls short of what was approved is also **settled** first, with the
-- shortfall frozen and the same reason, so its coverage stops reading as owed.
-- The removed line (the PSU marked CANCEL) stays REMOVED.
--
-- `decided_by` is it@talaliving.com, who gave the instruction. `actor_id` on
-- the audit rows is null: a script wrote them, and `detail` says which (D190).
--
-- Idempotent by shape: a line already closed, settled or without an approval
-- is left alone, so a second run changes nothing.

\set ON_ERROR_STOP on

begin;

create temp table _reopen (line_no_full text primary key) on commit drop;
insert into _reopen values
  ('pr-26-09-10_01-L19'),  -- LISTRIK LANGON - OFFICE
  ('pr-26-09-10_01-L20'),  -- LISTRIK SARIPAN
  ('pr-26-09-17_01-L05'),  -- KARTU HALO EJO
  ('pr-26-09-17_01-L06'),  -- INDIHOME GUDANG
  ('pr-26-09-17_01-L07'),  -- RENTAL GRAN MAX
  ('pr-26-09-17_01-L08'),  -- BPJS TENAGA KERJA
  ('pr-26-09-23_01-L01'),  -- PO MARTONO JOK
  ('pr-26-09-23_01-L02'),  -- PO DUL ROTAN
  ('pr-26-09-23_01-L03'),  -- BELANJA SARIPAN
  ('pr-26-09-23_01-L04');  -- SUPPORT DOCUMENT CONTAINER 3 + 4

do $$ begin
  if (select count(*) from ops_procure.pr_lines l join _reopen r using (line_no_full)) <> 10 then
    raise exception 'expected the ten lines to exist';
  end if;
  if exists (select 1 from ops_acct.payment_allocations a join _reopen r on r.line_no_full = a.pr_line_no
              where a.superseded_by is null) then
    raise exception 'one of the ten has money against it; reopening it is not this script''s call';
  end if;
end $$;

-- ── 1. the ten: back to waiting for approval ────────────────────────────
with gone as (
  delete from ops_procure.pr_approvals a
   using ops_procure.pr_lines l, _reopen r
   where a.line_id = l.id and l.line_no_full = r.line_no_full
  returning a.*, l.line_no_full
)
insert into ops_core.audit_log (service, entity, entity_no, action, outcome, reason, before, detail)
select 'procurement', 'pr_line', g.line_no_full, 'unapprove', 'ok',
       'Approval came from the sheet''s EJO APPROVAL tick via import 08; the owner'
       || ' says this line is newly entered and not yet decided. Removed rather than'
       || ' countered, so the trail does not read as EJO withdrawing a yes.',
       to_jsonb(g) - 'line_no_full',
       jsonb_build_object('by', 'supabase/import/09_close_recap_lines.sql',
                          'requested_by', 'it@talaliving.com')
  from gone g;

-- ── 2. everything else from import 08 ───────────────────────────────────
create temp table _close on commit drop as
select l.id as line_id, l.line_no_full, cov.approved, cov.covered, cov.remaining, cov.settled
  from ops_procure.pr_lines l
  join ops_core.legacy_map m on m.target_id = l.id and m.source_table = 'sheet.pr_recap'
                            and m.outcome = 'imported'
  join ops_procure.v_line_coverage cov on cov.line_id = l.id
 where l.removed_at is null
   and l.line_no_full not in (select line_no_full from _reopen)
   and not exists (select 1 from ops_procure.line_closures c where c.line_id = l.id);

insert into ops_procure.line_settlements (line_id, shortfall, reason, decided_by)
select c.line_id, c.remaining,
       'Closed on the owner''s instruction (2026-09-23): the PR recap sheet treats this'
       || ' line as finished. Rp ' || round(c.covered) || ' reached it against Rp '
       || round(c.approved) || ' approved.',
       (select id from ops_core.users where email = 'it@talaliving.com')
  from _close c
 where not c.settled
   and not exists (select 1 from ops_procure.line_settlements s where s.line_id = c.line_id);

insert into ops_procure.line_closures (line_id, reason, decided_by)
select c.line_id,
       'Historical line from the PR recap sheet (import 08), closed as complete on the'
       || ' owner''s instruction (2026-09-23). No receiving report or proof was created'
       || ' for it; those it has are the ones it had.',
       (select id from ops_core.users where email = 'it@talaliving.com')
  from _close c;

insert into ops_core.audit_log (service, entity, entity_no, action, outcome, reason, after, detail)
select 'procurement', 'pr_line', null, 'close_batch', 'ok',
       'PR recap lines closed as complete on the owner''s instruction; short ones settled first.',
       jsonb_build_object('closed', count(*), 'settled', count(*) filter (where not settled),
                          'shortfall', round(sum(remaining) filter (where not settled))),
       jsonb_build_object('by', 'supabase/import/09_close_recap_lines.sql',
                          'requested_by', 'it@talaliving.com',
                          'lines', jsonb_agg(line_no_full order by line_no_full))
  from _close
having count(*) > 0;

commit;

\echo ''
\echo '── status of the PR recap lines ────────────────────────────────────'
select s.status, count(*)
  from ops_procure.v_pr_line_status s
  join ops_core.legacy_map m on m.target_id = s.line_id and m.source_table = 'sheet.pr_recap'
                            and m.outcome = 'imported'
 group by 1 order by 1;
