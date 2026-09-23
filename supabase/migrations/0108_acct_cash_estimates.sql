-- 0108_acct_cash_estimates.sql — a planned payment is either a fixed amount
-- or an estimate.
--
-- The owner's question (2026-09-23): how does accounting enter recurring
-- payments whose amount is fixed — rent, instalments, base pay — beside the
-- ones that are only estimated — electricity, water, internet, fuel? Until now
-- every line was read as a promise: the electricity bill estimated at
-- Rp 4,2 juta and paid at Rp 3,9 juta showed as PARTIAL, as though Rp 300
-- ribu were still owed.
--
--   fixed      a payment below the amount is PARTIAL, as before.
--   estimate   any matched payment settles the occurrence (PAID); what it
--              came to against the guess is the difference the screens show,
--              and the rest of the month's estimate is not forecast again.
--
-- The rule is applied everywhere the state is decided: `cash_plan()` (`0091`,
-- what the screens read), `cash_events()`/`v_cash_cell` (`0022`), and the
-- demo's `cashPlan()`. Each function is restated whole with only the state
-- rule changed, so nothing else can drift.
--
-- `cash_plan()` also takes an optional month to anchor its twelve-month
-- window (`p_from`): Monthly bills compares a month with the one before it,
-- which is never inside a window that starts today. `source_ref` names what
-- created a line when it was not typed by hand — `asset:AST-0004` for an
-- asset's rent (`0110`). Its temp tables are dropped on entry, so it can
-- be called twice in one transaction.

alter table ops_acct.cash_components
  add column if not exists amount_kind text not null default 'fixed',
  add column if not exists source_ref  text;
alter table ops_acct.cash_components drop constraint if exists amount_kind_known;
alter table ops_acct.cash_components add constraint amount_kind_known
  check (amount_kind in ('fixed','estimate'));

-- ── 1. the seam that saves a line ────────────────────────────────────────
-- `0092`'s body with one parameter appended: null keeps what an existing line
-- has and makes a new line fixed. The old fifteen-argument form is dropped
-- first so exactly one `save_cash_component` remains.
drop function if exists ops_acct.save_cash_component(
  text, numeric, ops_acct.cash_frequency_t, ops_acct.direction_t, int, int, date,
  text, text, text, text, text, uuid, text, boolean);

create or replace function ops_acct.save_cash_component(
  p_name text,
  p_amount numeric,
  p_frequency ops_acct.cash_frequency_t,
  p_direction ops_acct.direction_t default 'OUT',
  p_due_day int default null,
  p_due_weekday int default null,
  p_due_date date default null,
  p_type_code text default null,
  p_vendor_code text default null,
  p_account_code text default null,
  p_starts_on text default null,
  p_note text default null,
  p_id uuid default null,
  p_ends_on text default null,
  p_active boolean default true,
  p_amount_kind text default null)
returns jsonb
language plpgsql security definer set search_path = ops_acct, ops_core, ops_procure, pg_temp as $$
declare v_id uuid; v_vendor uuid; v_account uuid;
begin
  if not ops_core.has_permission('accounting.update') then
    return ops_core.refused('accounting','cash_component', p_name,'save',
      'not_permitted','Editing the payment calendar needs accounting access.');
  end if;
  if coalesce(btrim(p_name), '') = '' then
    return ops_core.invalid('accounting','cash_component', null,'save',
      'name_required','A line on the calendar needs a name somebody will recognise.',
      jsonb_build_object('field','name'));
  end if;
  if p_amount is null or p_amount <= 0 then
    return ops_core.invalid('accounting','cash_component', p_name,'save',
      'amount_required','An estimate of zero plans nothing. Put the number you expect, even roughly.',
      jsonb_build_object('field','amount'));
  end if;
  if p_amount_kind is not null and p_amount_kind not in ('fixed','estimate') then
    return ops_core.invalid('accounting','cash_component', p_name,'save',
      'amount_kind_invalid','The amount is either fixed or an estimate.',
      jsonb_build_object('field','amount_kind'));
  end if;
  if p_frequency = 'monthly' and (p_due_day is null or p_due_day not between 1 and 31) then
    return ops_core.invalid('accounting','cash_component', p_name,'save',
      'due_day_out_of_range','The day of the month it is due, between 1 and 31.',
      jsonb_build_object('field','due_day'));
  end if;
  if p_frequency = 'weekly' and (p_due_weekday is null or p_due_weekday not between 0 and 6) then
    return ops_core.invalid('accounting','cash_component', p_name,'save',
      'weekday_required','Which day of the week it goes out.',
      jsonb_build_object('field','due_weekday'));
  end if;
  if p_frequency = 'once' and p_due_date is null then
    return ops_core.invalid('accounting','cash_component', p_name,'save',
      'date_required','A one-off needs the date it falls on.',
      jsonb_build_object('field','due_date'));
  end if;

  if p_vendor_code is not null then
    select id into v_vendor from ops_procure.vendors where code = p_vendor_code;
    if not found then
      return ops_core.invalid('accounting','cash_component', p_name,'save',
        'no_such_vendor', format('There is no vendor %s.', p_vendor_code));
    end if;
  end if;
  if p_account_code is not null then
    select id into v_account from ops_acct.accounts where code = p_account_code;
    if not found then
      return ops_core.invalid('accounting','cash_component', p_name,'save',
        'no_such_account', format('There is no account %s.', p_account_code));
    end if;
  end if;

  if p_id is null then
    insert into ops_acct.cash_components
      (name, direction, amount, frequency, due_day, due_weekday, due_date,
       type_code, vendor_id, account_id, starts_on, ends_on, note, active, created_by, amount_kind)
    values (btrim(p_name), p_direction, p_amount, p_frequency,
            p_due_day, p_due_weekday, p_due_date, p_type_code, v_vendor, v_account,
            coalesce(p_starts_on, to_char(ops_core.office_day(), 'YYYY-MM')),
            p_ends_on, nullif(btrim(p_note), ''), coalesce(p_active, true), auth.uid(),
            coalesce(p_amount_kind, 'fixed'))
    returning id into v_id;
  else
    update ops_acct.cash_components set
      name = btrim(p_name), direction = p_direction, amount = p_amount,
      frequency = p_frequency, due_day = p_due_day, due_weekday = p_due_weekday,
      due_date = p_due_date, type_code = p_type_code,
      vendor_id = v_vendor, account_id = v_account,
      ends_on = p_ends_on, active = coalesce(p_active, true),
      amount_kind = coalesce(p_amount_kind, amount_kind),
      note = nullif(btrim(p_note), '')
    where id = p_id
    returning id into v_id;
    if v_id is null then
      return ops_core.not_found('accounting','cash_component', p_id::text,'save','No such line.');
    end if;
  end if;

  return ops_core.ok('accounting','cash_component', btrim(p_name),'save',
    jsonb_build_object('component_id', v_id, 'name', btrim(p_name),
                       'frequency', p_frequency, 'amount', p_amount,
                       'amount_kind', coalesce(p_amount_kind, 'fixed')));
end $$;

grant execute on function
  ops_acct.save_cash_component(
    text, numeric, ops_acct.cash_frequency_t, ops_acct.direction_t, int, int, date,
    text, text, text, text, text, uuid, text, boolean, text)
  to authenticated;

-- ── 2. the plan the screens read ─────────────────────────────────────────
-- `0091`'s function with the estimate rule and the optional anchor month.
drop function if exists ops_acct.cash_plan(timestamptz);

create or replace function ops_acct.cash_plan(p_now timestamptz default now(), p_from date default null)
returns jsonb
language plpgsql security invoker set search_path = ops_acct, ops_core, ops_procure, pg_temp as $$
declare
  v_today       date := ops_core.office_day(p_now);
  v_current     text := to_char(v_today, 'YYYY-MM');
  v_months      text[];
  v_opening     numeric;
  v_running     numeric;
  v_comp        record;
  v_month       text;
  v_month_idx   int;
  v_dates       date[];
  v_override    record;
  v_planned_arr numeric[];
  v_skipped     boolean;
  v_date        date;
  v_occ_idx     int;
  v_planned     numeric;
  v_linked_trx  record;
  v_hit_trxnos  text[];
  v_hit_amount  numeric;
  v_matched_by  text;
  v_window_days int;
  v_state       text;
  v_carries_ov  boolean;
  v_rows        jsonb;
  v_months_out  jsonb;
  v_short_month text;
  v_short_by    numeric := 0;
  v_undated     numeric;
  v_paying_ids  uuid[];
begin
  -- `p_from` anchors the twelve-month window somewhere other than this
  -- month (`0108`): Monthly bills compares a month against the one before it,
  -- and last month is never in a window that starts today. Today — what is
  -- overdue, what is still ahead — stays today either way.
  select array_agg(to_char(date_trunc('month', coalesce(p_from, v_today)) + (n || ' months')::interval, 'YYYY-MM') order by n)
    into v_months
  from generate_series(0, 11) n;

  -- The accounts the business actually pays out of. Leadership's account is
  -- not one of them: money sitting there has not been given to operations
  -- yet, and counting it would make every month look survivable. Read once —
  -- this is asked for on every occurrence match below.
  select coalesce(array_agg(account_id), array[]::uuid[]), coalesce(sum(balance), 0)
    into v_paying_ids, v_opening
    from ops_acct.v_account_balance
   where custody = 'accounting' and is_active;

  -- `on commit drop` alone lets a second call in the same transaction trip
  -- over the first call's tables (Monthly bills reads two windows).
  drop table if exists _cp_claimed, _cp_events, _cp_cells, _cp_unplanned;
  create temporary table _cp_claimed (trx_no text primary key) on commit drop;
  create temporary table _cp_events (
    component_id uuid, month text, occ_idx int, date date,
    planned numeric, actual numeric, matched_by text, trx_nos text[], state text,
    carries_override boolean, reason text
  ) on commit drop;
  create temporary table _cp_cells (
    component_id uuid, month text, due_date date, planned numeric, actual numeric,
    matched_by text, trx_nos text[], state text, overridden boolean, reason text
  ) on commit drop;

  -- ── one component at a time, in claim order (D110): a dated one-off first,
  --    then anything naming a vendor, then a plain category — so a one-off
  --    settlement takes its own payment before a standing line for the same
  --    category sweeps it up. ─────────────────────────────────────────────
  for v_comp in
    select * from ops_acct.cash_components
     where active
     order by (case when frequency = 'once' then 0 when vendor_id is not null then 1 else 2 end), id
  loop
    foreach v_month in array v_months loop
      -- occurrence dates: every day this line falls due inside this month.
      v_dates := array[]::date[];
      if v_comp.frequency = 'once' then
        if v_comp.due_date is not null and to_char(v_comp.due_date, 'YYYY-MM') = v_month then
          v_dates := array[v_comp.due_date];
        end if;
      elsif v_month >= v_comp.starts_on and (v_comp.ends_on is null or v_month <= v_comp.ends_on) then
        if v_comp.frequency = 'monthly' then
          -- The 31st of a 30-day month is the 30th (dueDateOf).
          v_dates := array[least(
            (date_trunc('month', to_date(v_month, 'YYYY-MM'))::date + (v_comp.due_day - 1))::date,
            (date_trunc('month', to_date(v_month, 'YYYY-MM')) + interval '1 month' - interval '1 day')::date
          )];
        elsif v_comp.frequency = 'weekly' then
          select array_agg(d order by d) into v_dates
            from generate_series(
              date_trunc('month', to_date(v_month, 'YYYY-MM'))::date,
              (date_trunc('month', to_date(v_month, 'YYYY-MM')) + interval '1 month' - interval '1 day')::date,
              interval '1 day'
            ) d
           where extract(dow from d) = coalesce(v_comp.due_weekday, 5);
        end if;
      end if;

      select * into v_override from ops_acct.cash_overrides
       where component_id = v_comp.id and month = v_month;

      v_skipped := (coalesce(array_length(v_dates, 1), 0) = 0)
        or (v_override.id is not null and v_override.amount is null);

      -- perOccurrence: an override on a weekly line is the month's total,
      -- and the difference lands on the last run — December's THR is paid
      -- with one payday, not spread across four (D114).
      v_planned_arr := array[]::numeric[];
      if not v_skipped then
        for v_occ_idx in 1 .. array_length(v_dates, 1) loop
          if v_override.id is null or v_override.amount is null then
            v_planned_arr := v_planned_arr || v_comp.amount;
          elsif v_comp.frequency <> 'weekly' then
            v_planned_arr := v_planned_arr || v_override.amount;
          else
            if v_occ_idx = array_length(v_dates, 1) then
              v_planned_arr := v_planned_arr
                || (v_override.amount - v_comp.amount * (array_length(v_dates, 1) - 1));
            else
              v_planned_arr := v_planned_arr || v_comp.amount;
            end if;
          end if;
        end loop;
      else
        for v_occ_idx in 1 .. greatest(coalesce(array_length(v_dates, 1), 0), 0) loop
          v_planned_arr := v_planned_arr || 0::numeric;
        end loop;
      end if;

      -- one event per occurrence date
      for v_occ_idx in 1 .. coalesce(array_length(v_dates, 1), 0) loop
        v_date := v_dates[v_occ_idx];
        v_planned := v_planned_arr[v_occ_idx];
        v_hit_trxnos := array[]::text[];
        v_hit_amount := 0;
        v_matched_by := null;

        -- A settlement always wins over a guess. With several runs in one
        -- month, a linked row belongs to the occurrence it is nearest to.
        -- Deliberately not filtered against `_cp_claimed`: a human's link is
        -- a decision, and it beats a guess even when a category sweep
        -- elsewhere already claimed the same row — the demo's own
        -- `linkedRows` does not check `claimed` either.
        select t.trx_no, t.amount_idr into v_linked_trx
          from ops_acct.cash_settlements st
          join ops_acct.transactions t on t.trx_no = st.trx_no
         where st.component_id = v_comp.id and st.month = v_month
           and t.status <> 'VOID' and t.account_id in (select unnest(v_paying_ids))
           and (array_length(v_dates, 1) = 1
             or abs(t.trx_date - v_date) <= all (
               select abs(t.trx_date - d) from unnest(v_dates) d))
         limit 1;

        if found then
          v_hit_trxnos := array[v_linked_trx.trx_no];
          v_hit_amount := v_linked_trx.amount_idr;
          v_matched_by := 'linked';
        else
          v_window_days := case v_comp.frequency when 'weekly' then 3 when 'once' then 10 else 31 end;
          if v_comp.frequency = 'monthly' then
            select coalesce(array_agg(t.trx_no), array[]::text[]), coalesce(sum(t.amount_idr), 0)
              into v_hit_trxnos, v_hit_amount
              from ops_acct.transactions t
             where t.status <> 'VOID' and t.direction = v_comp.direction
               and (v_comp.type_code is null or t.type_code = v_comp.type_code)
               and (v_comp.vendor_id is null or t.vendor_id = v_comp.vendor_id)
               and t.account_id in (select unnest(v_paying_ids))
               and to_char(t.trx_date, 'YYYY-MM') = v_month
               and not exists (select 1 from _cp_claimed c where c.trx_no = t.trx_no);
          else
            -- One payment per occurrence: the nearest row, and where two are
            -- equally near, the one closest to what was expected.
            select t.trx_no, t.amount_idr into v_linked_trx
              from ops_acct.transactions t
             where t.status <> 'VOID' and t.direction = v_comp.direction
               and (v_comp.type_code is null or t.type_code = v_comp.type_code)
               and (v_comp.vendor_id is null or t.vendor_id = v_comp.vendor_id)
               and t.account_id in (select unnest(v_paying_ids))
               and abs(t.trx_date - v_date) <= v_window_days
               and not exists (select 1 from _cp_claimed c where c.trx_no = t.trx_no)
             order by abs(t.trx_date - v_date), abs(t.amount_idr - v_planned)
             limit 1;
            if found then
              v_hit_trxnos := array[v_linked_trx.trx_no];
              v_hit_amount := v_linked_trx.amount_idr;
            end if;
          end if;
          if array_length(v_hit_trxnos, 1) > 0 then v_matched_by := 'category'; end if;
        end if;

        insert into _cp_claimed select unnest(v_hit_trxnos) on conflict do nothing;

        if v_skipped then v_state := 'SKIPPED';
        -- An estimate is settled by its payment, whatever the payment was:
        -- the electricity bill that came in under the guess is paid, not
        -- part-paid (`0108`). A fixed amount still has to be met.
        elsif v_hit_amount > 0 and (v_comp.amount_kind = 'estimate' or v_hit_amount >= v_planned - 1000) then v_state := 'PAID';
        elsif v_hit_amount > 0 then v_state := 'PARTIAL';
        elsif v_date < v_today then v_state := 'OVERDUE';
        elsif (v_date - v_today) <= 7 then v_state := 'DUE';
        else v_state := 'PLANNED';
        end if;

        v_carries_ov := v_override.id is not null and v_comp.frequency = 'weekly'
          and v_occ_idx = array_length(v_dates, 1);

        insert into _cp_events values (
          v_comp.id, v_month, v_occ_idx, v_date, v_planned, v_hit_amount,
          v_matched_by, v_hit_trxnos, v_state, v_carries_ov, v_override.reason
        );
      end loop;

      -- the cell for this component x month, even when nothing occurs in it
      insert into _cp_cells
      select
        v_comp.id, v_month,
        coalesce(v_dates[1], case when v_comp.frequency = 'monthly' then
          least((date_trunc('month', to_date(v_month,'YYYY-MM'))::date + (v_comp.due_day - 1))::date,
                (date_trunc('month', to_date(v_month,'YYYY-MM')) + interval '1 month' - interval '1 day')::date)
          else date_trunc('month', to_date(v_month,'YYYY-MM'))::date end),
        coalesce((select sum(planned) from _cp_events e where e.component_id = v_comp.id and e.month = v_month), 0),
        coalesce((select sum(actual) from _cp_events e where e.component_id = v_comp.id and e.month = v_month), 0),
        (select case when count(*) filter (where matched_by = 'linked') > 0 then 'linked'
                     when count(*) filter (where matched_by is not null) > 0 then 'category' else null end
           from _cp_events e where e.component_id = v_comp.id and e.month = v_month),
        coalesce((select array_agg(x) from (select unnest(trx_nos) x from _cp_events e
           where e.component_id = v_comp.id and e.month = v_month) s), array[]::text[]),
        case
          when v_skipped then 'SKIPPED'
          when exists (select 1 from _cp_events e where e.component_id=v_comp.id and e.month=v_month and e.state='OVERDUE') then 'OVERDUE'
          when exists (select 1 from _cp_events e where e.component_id=v_comp.id and e.month=v_month and e.state='DUE') then 'DUE'
          when coalesce((select sum(actual) from _cp_events e where e.component_id=v_comp.id and e.month=v_month),0) > 0
           and (v_comp.amount_kind = 'estimate'
                or coalesce((select sum(actual) from _cp_events e where e.component_id=v_comp.id and e.month=v_month),0)
                   >= coalesce((select sum(planned) from _cp_events e where e.component_id=v_comp.id and e.month=v_month),0) - 1000)
            then 'PAID'
          when coalesce((select sum(actual) from _cp_events e where e.component_id=v_comp.id and e.month=v_month),0) > 0 then 'PARTIAL'
          else 'PLANNED'
        end,
        v_override.id is not null,
        v_override.reason;
    end loop;
  end loop;

  -- ── rows: one per active component, in the order they were created (not
  --    claim order — that ordering is for claiming, not for display), each
  --    with its twelve cells in month order and each cell's events nested
  --    inside it. ──────────────────────────────────────────────────────────
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'component', to_jsonb(c),
      'vendor_name', v.name,
      'account_code', a.code,
      'cells', cl.cells,
      'planned_total', cl.planned_total,
      'actual_total', cl.actual_total
    ) order by c.created_at, c.id
  ), '[]'::jsonb)
    into v_rows
    from ops_acct.cash_components c
    left join ops_procure.vendors v on v.id = c.vendor_id
    left join ops_acct.accounts a on a.id = c.account_id
    join lateral (
      select
        coalesce(jsonb_agg(
          jsonb_build_object(
            'month', mo.month, 'due_date', cc.due_date, 'planned', cc.planned, 'actual', cc.actual,
            'matched_by', cc.matched_by, 'trx_nos', to_jsonb(cc.trx_nos), 'state', cc.state,
            'overridden', cc.overridden, 'reason', cc.reason,
            'events', coalesce(ev.events, '[]'::jsonb)
          ) order by mo.ord
        ), '[]'::jsonb) as cells,
        coalesce(sum(cc.planned), 0) as planned_total,
        coalesce(sum(cc.actual), 0) as actual_total
      from unnest(v_months) with ordinality as mo(month, ord)
      join _cp_cells cc on cc.component_id = c.id and cc.month = mo.month
      left join lateral (
        select jsonb_agg(
          jsonb_build_object(
            'component_id', e.component_id, 'name', c.name, 'direction', c.direction,
            'frequency', c.frequency, 'amount_kind', c.amount_kind, 'month', e.month, 'date', e.date,
            'planned', e.planned, 'actual', e.actual, 'matched_by', e.matched_by,
            'trx_nos', to_jsonb(e.trx_nos), 'state', e.state,
            'vendor_name', v.name, 'account_code', a.code,
            'carries_override', e.carries_override, 'reason', e.reason
          ) order by e.occ_idx
        ) as events
        from _cp_events e where e.component_id = cc.component_id and e.month = cc.month
      ) ev on true
    ) cl on true
   where c.active;

  -- ── unplanned: every OUT ledger row this window, not claimed by anything,
  --    grouped by month, with the three biggest categories named. A plan
  --    that does not reconcile to the ledger is fiction (D111). ────────────
  create temporary table _cp_unplanned (month text, amount numeric, trx_nos text[], top_types jsonb)
    on commit drop;
  insert into _cp_unplanned
  select mo.month,
         coalesce(sum(t.amount_idr), 0),
         coalesce(array_remove(array_agg(t.trx_no order by t.trx_no), null), array[]::text[]),
         coalesce((
           select jsonb_agg(jsonb_build_object('type_code', tc, 'amount', amt) order by amt desc)
             from (
               select t2.type_code as tc, sum(t2.amount_idr) as amt
                 from ops_acct.transactions t2
                where t2.status <> 'VOID' and t2.direction = 'OUT'
                  and t2.account_id in (select unnest(v_paying_ids))
                  and to_char(t2.trx_date, 'YYYY-MM') = mo.month
                  and not exists (select 1 from _cp_claimed c where c.trx_no = t2.trx_no)
                group by t2.type_code order by sum(t2.amount_idr) desc limit 3
             ) top
         ), '[]'::jsonb)
    from unnest(v_months) with ordinality as mo(month, ord)
    left join ops_acct.transactions t
      on t.status <> 'VOID' and t.direction = 'OUT'
     and t.account_id in (select unnest(v_paying_ids))
     and to_char(t.trx_date, 'YYYY-MM') = mo.month
     and not exists (select 1 from _cp_claimed c where c.trx_no = t.trx_no)
   group by mo.month, mo.ord;

  -- ── undated obligations: what every vendor is still owed, outside this
  --    calendar entirely — money with no date to be on the plan with. ──────
  select coalesce(sum(outstanding), 0) into v_undated from ops_procure.v_vendor_journey;

  -- ── twelve months, planned against actual, the balance running through
  --    them. The month we are in counts only what is still ahead of today —
  --    what already happened already moved the opening figure. ────────────
  v_running := v_opening;
  v_months_out := '[]'::jsonb;
  for v_month_idx in 1 .. array_length(v_months, 1) loop
    v_month := v_months[v_month_idx];
    declare
      v_planned_in numeric; v_planned_out numeric;
      v_actual_in numeric; v_actual_out numeric; v_unplanned_out numeric;
    begin
      -- A part-paid bill keeps its remainder: dropping a whole line because
      -- half of it went out would forecast a month that cannot happen.
      select coalesce(sum(
        case when v_month = v_current and c.amount_kind = 'estimate' and cc.actual > 0 then 0
             when v_month = v_current then greatest(cc.planned - cc.actual, 0) else cc.planned end
      ), 0) into v_planned_in
        from _cp_cells cc join ops_acct.cash_components c on c.id = cc.component_id
       where cc.month = v_month and c.direction = 'IN' and c.active;

      select coalesce(sum(
        case when v_month = v_current and c.amount_kind = 'estimate' and cc.actual > 0 then 0
             when v_month = v_current then greatest(cc.planned - cc.actual, 0) else cc.planned end
      ), 0) into v_planned_out
        from _cp_cells cc join ops_acct.cash_components c on c.id = cc.component_id
       where cc.month = v_month and c.direction = 'OUT' and c.active;

      select coalesce(sum(amount_idr) filter (where direction = 'IN'), 0),
             coalesce(sum(amount_idr) filter (where direction = 'OUT'), 0)
        into v_actual_in, v_actual_out
        from ops_acct.transactions
       where status <> 'VOID'
         and account_id in (select unnest(v_paying_ids))
         and to_char(trx_date, 'YYYY-MM') = v_month;

      select amount into v_unplanned_out from _cp_unplanned where month = v_month;

      v_running := v_running + v_planned_in - v_planned_out;

      if v_short_month is null and v_running < 0 then
        v_short_month := v_month;
        v_short_by := abs(v_running);
      end if;

      v_months_out := v_months_out || jsonb_build_array(jsonb_build_object(
        'month', v_month, 'is_past', v_month < v_current, 'is_current', v_month = v_current,
        'planned_in', v_planned_in, 'planned_out', v_planned_out,
        'actual_in', v_actual_in, 'actual_out', v_actual_out,
        'unplanned_out', coalesce(v_unplanned_out, 0), 'closing', v_running
      ));
    end;
  end loop;

  return jsonb_build_object(
    'generated_for', v_today,
    'opening_cash', v_opening,
    'months', v_months_out,
    'rows', v_rows,
    'unplanned', (select coalesce(jsonb_agg(
        jsonb_build_object('month', month, 'amount', amount, 'trx_nos', to_jsonb(trx_nos), 'top_types', top_types)
        order by month), '[]'::jsonb) from _cp_unplanned),
    'short_month', v_short_month,
    'short_by', v_short_by,
    'undated_obligations', v_undated
  );
end $$;

grant execute on function ops_acct.cash_plan(timestamptz, date) to authenticated;

-- ── 3. the per-occurrence events and cells ───────────────────────────────
-- `0022`'s function and view with the same rule. Same result columns, so the
-- views built on them are replaced in place.
create or replace function ops_acct.cash_events(p_from date default null)
returns table (
  component_id uuid,
  name text,
  direction ops_acct.direction_t,
  frequency ops_acct.cash_frequency_t,
  month text,
  due_date date,
  planned numeric,
  actual numeric,
  matched_by ops_acct.cash_match_t,
  trx_nos text[],
  state ops_acct.cash_cell_state_t,
  vendor_name text,
  account_code text,
  carries_override boolean,
  overridden boolean,
  reason text)
language plpgsql stable security definer set search_path = ops_acct, ops_core, ops_procure, pg_temp as $$
declare
  v_today date := coalesce(p_from, ops_core.office_day());
  v_first date := date_trunc('month', v_today)::date;
  v_months text[];
  v_claimed text[] := '{}';       -- every trx_no already spoken for
  c record; v_month text; v_ovr record;
  v_dates date[]; v_n int; v_i int; v_date date;
  v_skipped boolean; v_planned numeric; v_actual numeric;
  v_hits text[]; v_linked boolean; v_window int; v_best text;
  v_tol numeric := ops_core.money_tolerance();
begin
  select array_agg(to_char(v_first + (n || ' month')::interval, 'YYYY-MM') order by n)
    into v_months from generate_series(0, 11) n;

  -- **Most specific claim first** (D110): a dated one-off is the narrowest
  -- claim there is; then a line naming a vendor; then a plain category.
  for c in
    select cc.*,
           case when cc.frequency = 'once' then 0
                when cc.vendor_id is not null then 1
                else 2 end as claim_order,
           v.name as vendor_name,
           a.code as account_code
      from ops_acct.cash_components cc
      left join ops_procure.vendors  v on v.id = cc.vendor_id
      left join ops_acct.accounts    a on a.id = cc.account_id
     where cc.active
     order by claim_order, cc.created_at
  loop
    foreach v_month in array v_months loop
      select * into v_ovr from ops_acct.cash_overrides o
       where o.component_id = c.id and o.month = v_month;

      -- Outside its own window a line has no occurrences at all.
      if (c.frequency <> 'once' and (v_month < c.starts_on
            or (c.ends_on is not null and v_month > c.ends_on))) then
        v_dates := '{}';
      else
        select coalesce(array_agg(d order by d), '{}') into v_dates
          from ops_acct.cash_occurrences(c.frequency, c.due_day, c.due_weekday,
                                     c.due_date, v_month) d;
      end if;

      v_n := coalesce(array_length(v_dates, 1), 0);
      v_skipped := v_n = 0 or (v_ovr.id is not null and v_ovr.amount is null);
      continue when v_n = 0;

      for v_i in 1 .. v_n loop
        v_date := v_dates[v_i];

        -- What this occurrence is expected to cost. An override on a weekly
        -- line is the MONTH's total and the difference lands on the last run —
        -- the THR is paid with one payday, not spread across four (D114).
        if v_skipped then
          v_planned := 0;
        elsif v_ovr.id is null or v_ovr.amount is null then
          v_planned := c.amount;
        elsif c.frequency <> 'weekly' then
          v_planned := v_ovr.amount;
        elsif v_i = v_n then
          v_planned := v_ovr.amount - c.amount * (v_n - 1);
        else
          v_planned := c.amount;
        end if;

        -- Somebody's link always beats a guess. With several runs in one
        -- month, a linked row belongs to the occurrence it is nearest to.
        select coalesce(array_agg(t.trx_no), '{}') into v_hits
          from ops_acct.cash_settlements st
          join ops_acct.transactions t on t.trx_no = st.trx_no and t.status <> 'VOID'
         where st.component_id = c.id and st.month = v_month
           and (v_n = 1 or not exists (
                 select 1 from unnest(v_dates) d
                  where abs(t.trx_date - d) < abs(t.trx_date - v_date)));
        v_linked := coalesce(array_length(v_hits, 1), 0) > 0;

        if not v_linked then
          v_window := case c.frequency when 'weekly' then 3
                                       when 'once'   then 10
                                       else 31 end;
          if c.frequency = 'monthly' then
            -- A monthly line sweeps everything in its category that month.
            select coalesce(array_agg(t.trx_no), '{}') into v_hits
              from ops_acct.transactions t
              join ops_acct.accounts a on a.id = t.account_id
             where t.status <> 'VOID' and a.custody = 'accounting'
               and t.direction = c.direction
               and (c.type_code is null or t.type_code = c.type_code)
               and (c.vendor_id is null or t.vendor_id = c.vendor_id)
               and to_char(t.trx_date, 'YYYY-MM') = v_month
               and not (t.trx_no = any(v_claimed));
          else
            -- One payment per occurrence: the nearest row, and where two are
            -- equally near, the one closest to what was expected.
            select t.trx_no into v_best
              from ops_acct.transactions t
              join ops_acct.accounts a on a.id = t.account_id
             where t.status <> 'VOID' and a.custody = 'accounting'
               and t.direction = c.direction
               and (c.type_code is null or t.type_code = c.type_code)
               and (c.vendor_id is null or t.vendor_id = c.vendor_id)
               and abs(t.trx_date - v_date) <= v_window
               and not (t.trx_no = any(v_claimed))
             order by abs(t.trx_date - v_date), abs(t.amount_idr - v_planned)
             limit 1;
            v_hits := case when v_best is null then '{}' else array[v_best] end;
            v_best := null;
          end if;
        end if;

        v_claimed := v_claimed || v_hits;

        select coalesce(sum(t.amount_idr), 0) into v_actual
          from ops_acct.transactions t where t.trx_no = any(v_hits);

        return query select
          c.id, c.name, c.direction, c.frequency, v_month, v_date,
          v_planned, v_actual,
          case when coalesce(array_length(v_hits,1),0) = 0 then null
               when v_linked then 'linked'::ops_acct.cash_match_t
               else 'category'::ops_acct.cash_match_t end,
          v_hits,
          case
            when v_skipped then 'SKIPPED'
            when v_actual > 0 and (c.amount_kind = 'estimate' or v_actual >= v_planned - v_tol) then 'PAID'
            when v_actual > 0 then 'PARTIAL'
            when v_date < v_today then 'OVERDUE'
            when v_date - v_today <= 7 then 'DUE'
            else 'PLANNED'
          end::ops_acct.cash_cell_state_t,
          c.vendor_name, c.account_code,
          (v_ovr.id is not null and c.frequency = 'weekly' and v_i = v_n),
          (v_ovr.id is not null),
          v_ovr.reason;
      end loop;
    end loop;
  end loop;
end $$;

create or replace view ops_acct.v_cash_event as
  select * from ops_acct.cash_events();

-- One line, one month: the cell a calendar draws. The state is the **worst**
-- of its occurrences, because a month with one overdue payday is an overdue
-- month however well the other three went.
create or replace view ops_acct.v_cash_cell as
  select component_id, name, direction, frequency, month,
         min(due_date) as due_date,
         sum(planned)  as planned,
         sum(actual)   as actual,
         array_remove(array_agg(distinct u.trx_no), null) as trx_nos,
         case when bool_or(matched_by = 'linked') then 'linked'
              when bool_or(matched_by = 'category') then 'category'
              else null end::ops_acct.cash_match_t as matched_by,
         case
           when bool_and(state = 'SKIPPED') then 'SKIPPED'
           when bool_or(state = 'OVERDUE')  then 'OVERDUE'
           when bool_or(state = 'DUE')      then 'DUE'
           when sum(actual) > 0 and ((select k.amount_kind from ops_acct.cash_components k
                                       where k.id = component_id) = 'estimate'
                                     or sum(actual) >= sum(planned) - ops_core.money_tolerance())
                then 'PAID'
           when sum(actual) > 0 then 'PARTIAL'
           else 'PLANNED'
         end::ops_acct.cash_cell_state_t as state,
         bool_or(overridden) as overridden,
         max(reason) as reason,
         count(*) as occurrences
    from ops_acct.v_cash_event e
    left join lateral unnest(e.trx_nos) as u(trx_no) on true
   group by component_id, name, direction, frequency, month;

-- `create or replace view` drops a view's options; both views run with the
-- reader's rights, as `0020`/`0022` set them (`smoke/17_core_view_invoker`).
alter view ops_acct.v_cash_event set (security_invoker = on);
alter view ops_acct.v_cash_cell  set (security_invoker = on);

-- The threshold Monthly bills flags a line at (D229) — the demo has carried it
-- as a setting since the screen was built; the live reader falls back to 25.
insert into ops_core.settings (key, value, note) values
  ('ops.bill_anomaly_percent', '25'::jsonb,
   'Monthly bills: a line is unusual when its month differs from last month by this many per cent or more.')
on conflict (key) do nothing;
