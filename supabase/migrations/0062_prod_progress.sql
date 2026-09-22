-- 0062_prod_progress.sql — what was actually finished, and the arithmetic that
-- turns it into a percentage without lying.
--
-- Append-only. "How many were finished on Thursday" is a question asked
-- **after** the argument starts, so an entry is never edited and never
-- removed; a correction is a negative entry with a sentence (A5).
--
-- `v_work_order` here is deliberately **incomplete in one named way**: it
-- carries no `at_vendor`, `days_at_vendor` or `subcon_overdue`. Those are
-- derived from `vendor_legs` (W6, D280), which does not exist yet — the four
-- `subcon_*` columns it replaced could describe exactly one trip, and this
-- business sends a piece to several vendors for several processes. It is 0063,
-- and the fields are absent rather than stubbed: a `false` that means *we have
-- not built this* reads identically to *the goods are here*.

create type ops_prod.progress_source_t as enum ('manual','overtime_sheet');

create table ops_prod.progress_entries (
  id                      uuid primary key default gen_random_uuid(),
  wo_id                   uuid not null references ops_prod.work_orders(id),
  -- The stage as it was reported. **Not normalised on the way in**: an entry
  -- keeps its own code for ever and is rolled up on read (A5, F74). A code
  -- that rolls into nothing — `POTONG` since D275 — is still a fact about work
  -- somebody did.
  stage                   text not null,
  -- May be negative: a correction is an entry, not an edit.
  qty                     numeric not null,
  -- The office day it happened, in WITA (F17, F39).
  work_date               date not null,
  -- A name. **A subcontractor is a valid answer to *who did it***, which is
  -- why this is text and why the link below sits beside it rather than
  -- replacing it (D264).
  worked_by               text,
  -- The link, never instead of the name. A record that rewrites itself when
  -- somebody is later matched answers the wrong question in an argument.
  worked_by_employee_id   uuid references ops_hr.employees(id),
  -- Confirmed *not one person* — a crew, a vendor's team. Three states and
  -- genuinely three: linked, confirmed-not-a-person, and nobody has been asked
  -- yet. The third is not a worse version of the second; it is the only one
  -- that is somebody's to resolve.
  worked_by_not_a_person  boolean not null default false,
  source                  ops_prod.progress_source_t not null default 'manual',
  -- The lembur sheet number, and the idempotency claim with it (D147).
  source_ref              text,
  note                    text,
  recorded_by             uuid references ops_core.users(id),
  recorded_at             timestamptz not null default now(),

  -- A zero entry says nothing and still prints a line.
  constraint qty_says_something check (qty <> 0),
  -- A negative number with no sentence is worse than the wrong one.
  constraint correction_says_why check (
    qty > 0 or (note is not null and length(btrim(note)) > 0)),
  -- A name cannot be both a person and confirmed not one.
  constraint attribution_is_coherent check (
    not (worked_by_not_a_person and worked_by_employee_id is not null)),
  constraint sheet_entry_names_its_sheet check (
    source <> 'overtime_sheet' or (source_ref is not null and length(btrim(source_ref)) > 0))
);

-- A signed lembur sheet posted twice adds nothing (D147). Partial, because
-- `source_ref` is null for everything typed by hand and those are not
-- duplicates of each other.
create unique index progress_sheet_once_idx
  on ops_prod.progress_entries (source_ref, wo_id, stage)
  where source_ref is not null;

create index progress_wo_idx on ops_prod.progress_entries (wo_id, stage);
create index progress_person_idx on ops_prod.progress_entries (worked_by_employee_id, work_date);

-- A stage code is one the business still has, one that rolls into one of
-- those, or one it has retired. Three tables, so not a foreign key — the
-- alternative was one table with a nullable `rolls_into`, and a null meaning
-- *retired* in a column that otherwise means *which of the four* is one column
-- answering two questions, which is the shape this project keeps paying for
-- (F62, F92).
create or replace function ops_prod.stage_code_is_known()
returns trigger
language plpgsql set search_path = ops_prod, pg_temp as $$
begin
  if not exists (select 1 from ops_prod.stage_sources  where source_code = new.stage)
  and not exists (select 1 from ops_prod.retired_stages where code        = new.stage) then
    raise exception 'stage % is not a stage this business has ever had', new.stage
      using errcode = 'foreign_key_violation';
  end if;
  return new;
end $$;

create trigger stage_code_is_known
  before insert on ops_prod.progress_entries
  for each row execute function ops_prod.stage_code_is_known();

-- More of a stage than the order has pieces cannot be true, so it is refused
-- rather than warned about. The floor below it is the same argument: a stage
-- corrected past zero has been over-corrected, and neither number describes
-- anything that happened.
create or replace function ops_prod.progress_within_the_order()
returns trigger
language plpgsql set search_path = ops_prod, pg_temp as $$
declare v_total numeric; v_qty numeric; v_no text;
begin
  select w.qty, w.wo_no into v_qty, v_no from ops_prod.work_orders w where w.id = new.wo_id;
  select coalesce(sum(e.qty), 0) into v_total
    from ops_prod.progress_entries e
   where e.wo_id = new.wo_id and e.stage = new.stage;
  v_total := v_total + new.qty;

  if v_total > v_qty then
    raise exception '% at % would reach % of an order for %', v_no, new.stage, v_total, v_qty
      using errcode = 'check_violation';
  end if;
  if v_total < 0 then
    raise exception '% at % would reach %, which is behind nothing', v_no, new.stage, v_total
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger progress_within_the_order
  before insert on ops_prod.progress_entries
  for each row execute function ops_prod.progress_within_the_order();

-- ── what has passed each stage ────────────────────────────────────────────
--
-- **A minimum over every source that carried a figure, never a sum.** Four
-- chairs cut, four planed and four assembled is four chairs made, not twelve;
-- four sanded and three finished is three finished, not seven. A piece has
-- passed the stage when it has passed every step inside it, so the count is
-- the smallest of the steps **actually recorded** — a step nobody reported is
-- a step this order never used, and it does not drag the stage to zero.
--
-- The stage's own code is one of the sources (F74): `FINISHING` names one of
-- the four *and* one of the seven that collapsed into it, so "direct" and
-- "rolled up" cannot be told apart and must not be added together.
create or replace view ops_prod.v_wo_stage_progress as
with per_source as (
  select e.wo_id, ss.stage_code, e.stage as source_code, sum(e.qty) as done
    from ops_prod.progress_entries e
    join ops_prod.stage_sources ss on ss.source_code = e.stage
   group by e.wo_id, ss.stage_code, e.stage
  having sum(e.qty) <> 0
),
rolled as (
  select wo_id, stage_code, min(done) as done, count(*)::int as sources
    from per_source group by wo_id, stage_code
)
select
  s.wo_id,
  s.wo_no,
  s.stage_code,
  s.stage_name,
  s.seq,
  s.stages_from,
  coalesce(r.done, 0)                     as done,
  -- **Nobody has reported anything against this stage** is not the same fact
  -- as *nothing has passed it* (D275). A dining table has no lamps in it, so
  -- Machinery sits empty on almost every order, and reading that empty as a
  -- zero made every later stage look like it had jumped a step. An unknown
  -- cannot be overtaken (F92).
  (r.wo_id is not null)                   as recorded,
  case when w.qty > 0 then round(coalesce(r.done, 0) / w.qty * 100)::int else 0 end as percent,
  coalesce(r.sources, 0)                  as sources
from ops_prod.v_work_order_stage s
join ops_prod.work_orders w on w.id = s.wo_id
left join rolled r on r.wo_id = s.wo_id and r.stage_code = s.stage_code;

-- Work recorded against steps the business no longer has. `POTONG`, `SERUT`
-- and `RAKIT` are bought in as barang mentah now, so they belong to none of
-- the four and are deliberately not folded into Sanding — six pieces cut is
-- not six pieces sanded. The work still happened, and a process change must
-- never make past work disappear (A5), so it is carried apart and named.
create or replace view ops_prod.v_wo_retired_work as
select e.wo_id, w.wo_no, e.stage as code, rs.name, sum(e.qty) as done
  from ops_prod.progress_entries e
  join ops_prod.retired_stages rs on rs.code = e.stage
  join ops_prod.work_orders w on w.id = e.wo_id
 group by e.wo_id, w.wo_no, e.stage, rs.name
having sum(e.qty) <> 0;

-- ── the order, as a board reads it ────────────────────────────────────────
create or replace view ops_prod.v_work_order as
select
  w.*,
  p.stages_unset,
  p.stage_count,
  p.current_stage,
  p.current_stage_name,
  -- Through the last stage of this order's own list: the pieces that are
  -- actually finished.
  p.completed,
  -- **Stages finished across the quantity**, not the furthest stage reached:
  -- eleven doors sanded and one packed is not "packing", it is a quarter of
  -- the way through.
  p.percent,
  (w.due_date - ops_core.office_day())::int as days_left,
  (w.status = 'OPEN' and w.due_date < ops_core.office_day()) as late,
  r.done is not null as has_retired_work
from ops_prod.work_orders w
left join lateral (
  select
    bool_or(s.stages_from = 'route')                                   as stages_unset,
    count(*)::int                                                      as stage_count,
    (array_agg(s.stage_code order by s.seq) filter (where s.done > 0))[
      count(*) filter (where s.done > 0)]                              as current_stage,
    (array_agg(s.stage_name order by s.seq) filter (where s.done > 0))[
      count(*) filter (where s.done > 0)]                              as current_stage_name,
    (array_agg(s.done order by s.seq))[count(*)]                       as completed,
    case when count(*) * w.qty > 0
      then round(sum(least(greatest(s.done, 0), w.qty)) / (count(*) * w.qty) * 100)::int
      else 0 end                                                       as percent
  from ops_prod.v_wo_stage_progress s
  where s.wo_id = w.id
) p on true
left join lateral (
  select sum(done) as done from ops_prod.v_wo_retired_work rw where rw.wo_id = w.id
) r on true;

-- ── access ────────────────────────────────────────────────────────────────
alter table ops_prod.progress_entries enable row level security;

create policy progress_read on ops_prod.progress_entries for select to authenticated using (true);

-- Two doors, and the second is the point of D147. The workshop reports its own
-- work on `production.update`. An entry whose source is a signed overtime
-- sheet is the **consequence of a signature**, and the signature is its
-- authority — so `approve_overtime` may post one without holding the
-- production module at all.
create policy progress_new on ops_prod.progress_entries for insert to authenticated
  with check (
    (source = 'manual'         and ops_core.has_permission('production.update'))
    or (source = 'overtime_sheet' and (ops_core.has_authority('approve_overtime')
                                       or ops_core.has_permission('production.update'))));
-- No update policy and no delete policy: append-only is the whole design (A5).

alter view ops_prod.v_wo_stage_progress set (security_invoker = on);
alter view ops_prod.v_wo_retired_work   set (security_invoker = on);
alter view ops_prod.v_work_order        set (security_invoker = on);

grant select on all tables in schema ops_prod to authenticated;
grant insert on ops_prod.progress_entries to authenticated;
