-- 0063_prod_vendor_legs.sql — which vendor had which pieces, and when.
--
-- W6, and the shape the owner's Q48 answer asked for (D280). The work order
-- carried four columns — one vendor, one sent date, one promise, one return —
-- and they could describe **exactly one trip**. The business has several
-- vendors each doing one process, and a piece can visit more than one of them,
-- so four columns could not say which vendor had it for which process, let
-- alone hold two legs at once.
--
-- This is the row that completes `v_work_order`: `at_vendor`,
-- `at_vendor_qty`, `days_at_vendor` and `subcon_overdue` were left out of 0062
-- rather than stubbed, because a `false` meaning *not built yet* reads
-- identically to *the goods are here*.

-- **Not the same vocabulary as the four stages**, and that is the point. The
-- owner's list is *barang mentah, jok, amplas, packing*: two of those are
-- stages of ours, `JOK` is not a stage at all, and `BARANG_MENTAH` is the
-- rough making that happens **before** our first stage. Forcing them onto
-- `process_stages` would bend one of the two lists out of shape — they are
-- related and they are not the same thing.
create type ops_prod.vendor_process_t as enum
  ('BARANG_MENTAH','JOK','AMPLAS','FINISHING','PACKING');

create table ops_prod.vendor_processes (
  code  ops_prod.vendor_process_t primary key,
  name  text not null,
  note  text
);

insert into ops_prod.vendor_processes (code, name, note) values
  ('BARANG_MENTAH','Barang mentah','Dibuat kasar oleh vendor, masuk bengkel untuk diamplas.'),
  ('JOK',          'Jok',          'Bukan salah satu dari empat tahap — pekerjaan sendiri.'),
  ('AMPLAS',       'Amplas',       'Tahap yang sama dengan di bengkel, dikerjakan di luar.'),
  ('FINISHING',    'Finishing',    null),
  ('PACKING',      'Packing',      null);

insert into ops_core.doc_prefixes (prefix, what) values ('leg', 'vendor leg');

-- One trip, to one vendor, for one process.
create table ops_prod.vendor_legs (
  id             uuid primary key default gen_random_uuid(),
  leg_no         text not null unique default ops_core.next_doc_number('leg'),
  wo_id          uuid not null references ops_prod.work_orders(id),
  process        ops_prod.vendor_process_t not null references ops_prod.vendor_processes(code),
  -- The vendor's **code**, at the seam (ADR-004). The contract calls this
  -- `vendor_id` and describes it as *a public vendor id* — in the demo an id
  -- is both, and against a database they come apart. See C12; it is C11 again.
  vendor_code    text not null,
  qty            numeric not null check (qty > 0),
  sent_on        date not null,
  -- The vendor's promise, and marked as a promise wherever it is printed —
  -- the same shape as a PO's expected delivery (D234). Null where none was
  -- given, which is a different thing from *not yet due*: late is only
  -- meaningful against a date somebody agreed (D134).
  expected_back  date,
  returned_on    date,
  -- How many came back. **Less than `qty` is a legitimate, closed answer** —
  -- six going out and four coming back is the ordinary case, and the two that
  -- stayed are the question somebody has to ask the vendor. That is the whole
  -- reason this is a number and not a tick.
  returned_qty   numeric check (returned_qty is null or returned_qty >= 0),
  note           text,
  created_by     uuid references ops_core.users(id),
  created_at     timestamptz not null default now(),

  constraint promise_after_sending check (expected_back is null or expected_back >= sent_on),
  constraint return_after_sending  check (returned_on   is null or returned_on   >= sent_on),
  -- A closed leg says how many came back; an open one has not been asked yet.
  constraint closed_leg_counts check ((returned_on is null) = (returned_qty is null)),
  constraint cannot_return_more_than_went check (returned_qty is null or returned_qty <= qty)
);

create index legs_wo_idx on ops_prod.vendor_legs (wo_id);
create index legs_open_idx on ops_prod.vendor_legs (expected_back) where returned_on is null;

-- More pieces out than the order has cannot be true. Counted over the **open**
-- legs, because a piece that came back can be sent again — to the next vendor,
-- which is the case W6 exists for.
create or replace function ops_prod.legs_within_the_order()
returns trigger
language plpgsql set search_path = ops_prod, pg_temp as $$
declare v_out numeric; v_qty numeric; v_no text;
begin
  select w.qty, w.wo_no into v_qty, v_no from ops_prod.work_orders w where w.id = new.wo_id;
  select coalesce(sum(l.qty - coalesce(l.returned_qty, 0)), 0) into v_out
    from ops_prod.vendor_legs l
   where l.wo_id = new.wo_id and l.returned_on is null and l.id <> new.id;
  v_out := v_out + case when new.returned_on is null then new.qty - coalesce(new.returned_qty, 0) else 0 end;

  if v_out > v_qty then
    raise exception '% would have % pieces at vendors, of an order for %', v_no, v_out, v_qty
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger legs_within_the_order
  before insert or update on ops_prod.vendor_legs
  for each row execute function ops_prod.legs_within_the_order();

-- ── one leg, as somebody reads it ─────────────────────────────────────────
create or replace view ops_prod.v_vendor_leg as
select
  l.*,
  vp.name                                   as process_name,
  v.name                                    as vendor_name,
  w.wo_no,
  w.item_name,
  -- Still out, and zero once the leg is closed — whatever did not come back is
  -- answered by `returned_qty`, not by leaving this number hanging.
  case when l.returned_on is not null then 0
       else l.qty - coalesce(l.returned_qty, 0) end            as outstanding,
  (coalesce(l.returned_on, ops_core.office_day()) - l.sent_on)::int as days_out,
  -- **Late against a promise, never against silence** (D134). A leg with no
  -- agreed return date cannot be early or late; it is absent, and counting it
  -- as on-time would flatter whoever never promises anything.
  case when l.returned_on is not null or l.expected_back is null then null
       when ops_core.office_day() > l.expected_back
         then (ops_core.office_day() - l.expected_back)::int
       else null end                                           as overdue_days
from ops_prod.vendor_legs l
join ops_prod.vendor_processes vp on vp.code = l.process
join ops_prod.work_orders w on w.id = l.wo_id
-- By code, at the seam. Null where procurement has never heard of the vendor,
-- reported rather than refused (A6) — the same treatment a BOM's `ref_code`
-- gets in 0060.
left join ops_procure.vendors v on v.code = l.vendor_code;

-- ── the three fields 0062 left out ────────────────────────────────────────
create or replace view ops_prod.v_work_order as
select
  w.*,
  p.stages_unset,
  p.stage_count,
  p.current_stage,
  p.current_stage_name,
  p.completed,
  p.percent,
  (w.due_date - ops_core.office_day())::int as days_left,
  (w.status = 'OPEN' and w.due_date < ops_core.office_day()) as late,
  r.done is not null as has_retired_work,
  -- Derived from the legs, not stored beside them: one fact written twice is
  -- one fact that drifts (F73, F75).
  coalesce(g.at_vendor, false)  as at_vendor,
  coalesce(g.at_vendor_qty, 0)  as at_vendor_qty,
  g.days_at_vendor,
  coalesce(g.subcon_overdue, false) as subcon_overdue,
  -- **One predicate, read by the API and the screen.** The rule written twice
  -- was F75. And it is no longer all-or-nothing: six of twelve chairs at the
  -- upholsterer leaves six on the bench, and work reported on those six is
  -- legitimate. An in-house order is always on site — there is nowhere else
  -- for it to be.
  (w.route <> 'SUBCON' or w.qty - coalesce(g.at_vendor_qty, 0) > 0) as goods_on_site
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
) r on true
left join lateral (
  select
    bool_or(l.returned_on is null)                                        as at_vendor,
    coalesce(sum(l.qty - coalesce(l.returned_qty, 0))
             filter (where l.returned_on is null), 0)                     as at_vendor_qty,
    -- From the first thing that went out to the last thing that came back —
    -- or to today, while anything is still away.
    case when min(l.sent_on) is null then null
         when bool_and(l.returned_on is not null)
           then (max(l.returned_on) - min(l.sent_on))::int
         else (ops_core.office_day() - min(l.sent_on))::int end           as days_at_vendor,
    bool_or(l.returned_on is null and l.expected_back is not null
            and l.expected_back < ops_core.office_day())                  as subcon_overdue
  from ops_prod.vendor_legs l where l.wo_id = w.id
) g on true;

-- ── D255, now that it can be asked ────────────────────────────────────────
--
-- Reporting work on goods that are not in the building. 0062 could not enforce
-- it because there was nothing to ask, and stubbing the question would have
-- been worse than leaving it: a guard that always passes is a guard nobody
-- notices is gone.
--
-- Only **positive** entries. A correction is how somebody fixes a figure
-- recorded before the pieces left, and refusing it would trap the error in
-- place while the goods are away.
create or replace function ops_prod.progress_within_the_order()
returns trigger
language plpgsql set search_path = ops_prod, pg_temp as $$
declare v_total numeric; v_qty numeric; v_no text; v_route ops_prod.route_t;
        v_away numeric; v_where text;
begin
  select w.qty, w.wo_no, w.route into v_qty, v_no, v_route
    from ops_prod.work_orders w where w.id = new.wo_id;

  if new.qty > 0 and v_route = 'SUBCON' then
    select coalesce(sum(l.qty - coalesce(l.returned_qty, 0)), 0) into v_away
      from ops_prod.vendor_legs l where l.wo_id = new.wo_id and l.returned_on is null;
    if v_qty - v_away <= 0 then
      select string_agg(format('%s (%s)', coalesce(v.name, l.vendor_code), l.leg_no), ', ')
        into v_where
        from ops_prod.vendor_legs l
        left join ops_procure.vendors v on v.code = l.vendor_code
       where l.wo_id = new.wo_id and l.returned_on is null;
      raise exception 'every piece of % is still at a vendor — %', v_no, coalesce(v_where, 'no leg named')
        using errcode = 'check_violation';
    end if;
  end if;

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

-- ── access ────────────────────────────────────────────────────────────────
--
-- The second half of F104, and expected this time: `v_vendor_leg` names the
-- vendor out of `ops_procure.vendors`, which a workshop user cannot read. The
-- same additive, scoped policy as `items_read_production` in 0060 — a leg
-- whose vendor cannot be named makes *where is my chair* unanswerable, which
-- is the question W6 exists for.
create policy vendors_read_production on ops_procure.vendors for select to authenticated
  using (ops_core.has_permission('production.read'));

alter table ops_prod.vendor_processes enable row level security;
alter table ops_prod.vendor_legs      enable row level security;

create policy vprocess_read on ops_prod.vendor_processes for select to authenticated using (true);

-- Read by the floor, and by the project screens asking where the goods are.
create policy legs_read on ops_prod.vendor_legs for select to authenticated using (true);
create policy legs_new  on ops_prod.vendor_legs for insert to authenticated
  with check (ops_core.has_permission('production.update'));
create policy legs_edit on ops_prod.vendor_legs for update to authenticated
  using (ops_core.has_permission('production.update'))
  with check (ops_core.has_permission('production.update'));
-- No delete: a trip that happened is a fact about where the goods were (A5).

alter view ops_prod.v_vendor_leg set (security_invoker = on);
alter view ops_prod.v_work_order set (security_invoker = on);

grant select on all tables in schema ops_prod to authenticated;
grant insert, update on ops_prod.vendor_legs to authenticated;
