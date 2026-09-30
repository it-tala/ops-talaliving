-- 0201_prod_daily_targets.sql — how many a Job Order should get through a
-- stage today, set by the people who plan it, with every change kept (D356).
--
-- The owner, on the admin's fifth gap (*belum ada target*): *pimpinan dan HRD
-- dan admin produksi yang bisa input target*, and on the three open points,
-- *pakai bawaan*:
--
--   1. a target is **per Job Order, per office day, per stage** — *AA-02,
--      1 Okt, Amplas 15* — so it reads beside the count it is measured by,
--      which is already per order and stage (F74: never across stages);
--   2. **who**: leadership (`approve_funds` or `approve_goods`, the two
--      authorities leadership holds), HRD (`hrd.update`) and production
--      (`production.update`);
--   3. **a change keeps its history**: who, when, and why. So the table is
--      append-only and the target in force is the latest row; a change to a
--      target already set says why, because *the target was 15* is exactly
--      the sentence somebody quotes after the day went badly.
--
-- A day that has already ended is not re-targeted: moving the goal after the
-- result is known turns every day into one that met its target. Today and
-- later are open. A target of 0 is a statement (*nothing planned at this stage
-- today*), not a deletion.

create table ops_prod.daily_targets (
  id          uuid primary key default gen_random_uuid(),
  -- The order rows were written in. `set_at` is `now()`, which is the same
  -- for every row of one transaction, so it cannot say which of two changes
  -- came last; this can.
  seq         bigint generated always as identity,
  wo_id       uuid not null references ops_prod.work_orders(id),
  work_date   date not null,
  stage       text not null references ops_prod.process_stages(code),
  qty         numeric not null check (qty >= 0),
  reason      text,
  set_by      uuid references ops_core.users(id),
  set_at      timestamptz not null default now()
);

create index daily_targets_day_idx on ops_prod.daily_targets (work_date, wo_id, stage, seq desc);

-- ── the target in force, beside what was actually done ────────────────────
--
-- `actual` is the day's net count at that stage from `progress_entries` — the
-- same rows the board sums — so a target and its result can never be two
-- readings of two different things.
create or replace view ops_prod.v_daily_target as
with latest as (
  select distinct on (t.wo_id, t.work_date, t.stage)
         t.wo_id, t.work_date, t.stage, t.qty, t.reason, t.set_by, t.set_at
    from ops_prod.daily_targets t
   order by t.wo_id, t.work_date, t.stage, t.seq desc
),
revs as (
  select wo_id, work_date, stage, count(*)::int as revisions, min(set_at) as first_set_at
    from ops_prod.daily_targets group by wo_id, work_date, stage
)
select
  w.wo_no,
  w.item_name,
  w.uom,
  w.qty                                     as wo_qty,
  l.work_date,
  l.stage,
  ps.name                                   as stage_name,
  l.qty                                     as target,
  coalesce((select sum(e.qty) from ops_prod.progress_entries e
             where e.wo_id = l.wo_id and e.stage = l.stage and e.work_date = l.work_date), 0) as actual,
  l.reason,
  l.set_at,
  coalesce(u.full_name, u.email)           as set_by_name,
  r.revisions,
  r.first_set_at
from latest l
join ops_prod.work_orders w on w.id = l.wo_id
join ops_prod.process_stages ps on ps.code = l.stage
join revs r on r.wo_id = l.wo_id and r.work_date = l.work_date and r.stage = l.stage
left join ops_core.users u on u.id = l.set_by;

-- ── setting one ───────────────────────────────────────────────────────────
create or replace function ops_prod.set_daily_target(
  p_wo_no text, p_work_date date, p_stage text, p_qty numeric, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path = ops_prod, ops_core, pg_temp as $$
declare
  w        ops_prod.work_orders;
  v_stages text[];
  v_cur    ops_prod.daily_targets;
  v_day    date := coalesce(p_work_date, ops_core.office_day());
begin
  if not (ops_core.has_permission('production.update')
          or ops_core.has_permission('hrd.update')
          or ops_core.has_authority('approve_funds')
          or ops_core.has_authority('approve_goods')) then
    return ops_core.refused('production','daily_target', p_wo_no,'set',
      'not_permitted','Target harian diisi pimpinan, HRD, atau admin produksi.');
  end if;

  select * into w from ops_prod.work_orders where wo_no = p_wo_no;
  if not found then
    return ops_core.not_found('production','daily_target', p_wo_no,'set', format('Tidak ada Job Order %s.', p_wo_no));
  end if;

  select array_agg(stage_code order by seq) into v_stages
    from ops_prod.v_work_order_stage where wo_id = w.id;
  if not (p_stage = any(coalesce(v_stages, '{}'))) then
    return ops_core.invalid('production','daily_target', p_wo_no,'set', 'stage_not_on_product',
      format('Tahap %s tidak dilalui %s. Tahapnya: %s.', p_stage, coalesce(w.product_code, w.wo_no),
             array_to_string(v_stages, ' → ')),
      jsonb_build_object('field','stage','stages', to_jsonb(v_stages)));
  end if;

  if p_qty is null or p_qty < 0 then
    return ops_core.invalid('production','daily_target', p_wo_no,'set', 'qty_required',
      'Berapa targetnya? Nol berarti tidak ada yang direncanakan di tahap ini hari itu.',
      jsonb_build_object('field','qty'));
  end if;
  if p_qty > w.qty then
    return ops_core.invalid('production','daily_target', p_wo_no,'set', 'over_order',
      format('%s hanya %s %s; target %s dalam sehari melebihi seluruh order.', w.wo_no, w.qty, w.uom, p_qty),
      jsonb_build_object('field','qty','ordered', w.qty));
  end if;
  if v_day < ops_core.office_day() then
    return ops_core.invalid('production','daily_target', p_wo_no,'set', 'day_passed',
      format('%s sudah lewat. Target hari yang sudah selesai tidak diubah — hasilnya sudah diketahui.', v_day),
      jsonb_build_object('field','work_date'));
  end if;
  if w.status <> 'OPEN' then
    return ops_core.conflict('production','daily_target', p_wo_no,'set',
      'wo_not_open', format('%s sudah %s.', w.wo_no, w.status));
  end if;

  select * into v_cur from ops_prod.daily_targets
   where wo_id = w.id and work_date = v_day and stage = p_stage
   order by seq desc limit 1;
  if v_cur.id is not null then
    if v_cur.qty = p_qty then
      return ops_core.noop('production','daily_target', p_wo_no,'set', 'Targetnya sudah itu.',
        jsonb_build_object('wo_no', w.wo_no, 'work_date', v_day, 'stage', p_stage, 'target', p_qty));
    end if;
    if coalesce(btrim(p_reason), '') = '' then
      return ops_core.invalid('production','daily_target', p_wo_no,'set', 'reason_required',
        format('Target %s %s hari itu sudah %s. Mengubahnya menyebut alasannya.', w.wo_no, p_stage, v_cur.qty),
        jsonb_build_object('field','reason','current', v_cur.qty));
    end if;
  end if;

  insert into ops_prod.daily_targets (wo_id, work_date, stage, qty, reason, set_by)
  values (w.id, v_day, p_stage, p_qty, nullif(btrim(p_reason), ''), auth.uid());

  return ops_core.ok('production','daily_target', p_wo_no,'set',
    jsonb_build_object('wo_no', w.wo_no, 'work_date', v_day, 'stage', p_stage, 'target', p_qty,
                       'before', v_cur.qty));
end $$;

-- ── access ────────────────────────────────────────────────────────────────
alter table ops_prod.daily_targets enable row level security;
create policy daily_targets_read on ops_prod.daily_targets for select to authenticated using (true);
-- No insert/update/delete policy: written only through the seam, never edited.
grant select on ops_prod.daily_targets to authenticated;

alter view ops_prod.v_daily_target set (security_invoker = on);
grant select on ops_prod.v_daily_target to authenticated;

grant execute on function ops_prod.set_daily_target(text, date, text, numeric, text) to authenticated;
revoke execute on function ops_prod.set_daily_target(text, date, text, numeric, text) from public;

analyze ops_prod.daily_targets;
