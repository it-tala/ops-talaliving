-- 0091_acct_cash_plan.sql — the twelve-month cash projection, ported to SQL
-- rather than approximated.
--
-- `accounting.getCashPlan` is the last name on `PENDING_PARITY` (`_pending.ts`)
-- and the reason it stayed there through 0086–0090 while everything else came
-- off: `CashPlan` is not a row shape a view can redraw, it is ~150 lines of
-- `src/demo/derive.ts`'s `cashPlan()` — occurrence dates per frequency, an
-- override on a weekly line spread across its runs with the remainder on the
-- last one (D114), fuzzy matching of ledger rows to planned occurrences within
-- a tolerance window, a running balance, the first month it goes negative and
-- by how much, and undated obligations held apart rather than spread to make
-- the chart look even. Every other derivation in this ladder lives behind a
-- view precisely so the real and the demo client cannot compute it two
-- different ways and disagree (A3) — this is that principle applied to
-- something too stateful for `select`.
--
-- This function is the algorithm, read top to bottom against `cashPlan()`,
-- with nothing added and nothing approximated:
--
--   opening_cash   — sum of `v_account_balance` where `custody = 'accounting'`
--                    and `is_active` (payingAccountIds; leadership's balance
--                    is deliberately not counted, same reasoning as `0087`'s
--                    `paying_balance` but a different test — see below)
--   claim order    — a dated one-off first, then a line naming a vendor, then
--                    a plain category (D110), so a one-off settlement takes
--                    its own payment before a standing line for the same
--                    category sweeps it up
--   occurrence     — `once`: the due date, if it falls in this month. `monthly`:
--   dates            the due day, clamped to the month's length. `weekly`:
--                    every day in the month matching the due weekday
--   matching       — a `cash_settlements` link always wins, nearest occurrence
--                    first; failing that, a `monthly` line claims every
--                    unclaimed matching row in the month, a `weekly`/`once`
--                    line claims the single nearest one inside its window
--                    (3 / 10 days) breaking ties by amount. Matched rows go
--                    into a session-local claimed set so nothing is counted
--                    twice — this is why the function is procedural rather
--                    than a view: the claiming is stateful and order-dependent
--   the state      — PAID / PARTIAL / OVERDUE / DUE / PLANNED / SKIPPED, the
--   machine          same six-way read as the demo, in the same order
--   unplanned      — every OUT row this window that nothing claimed, by month,
--                    top three categories named
--   undated        — every vendor's outstanding balance
--   obligations      (`ops_procure.v_vendor_journey`) — money owed with no
--                    date to be on this calendar with at all
--
-- `paying_balance` (`0087`, on `v_round_summary`) and `opening_cash` here read
-- the same underlying fact — cash in the accounts that actually pay people —
-- through two different filters the demo itself uses two different ways:
-- `roundSummary()` reads `is_paying` on one named account, `cashPlan()` reads
-- `custody = 'accounting' AND is_active` across all of them. Both are real
-- columns; this keeps each function reading the one the demo it mirrors
-- actually reads, rather than picking one and asserting they must agree.
--
-- Not in this function, on purpose:
--
--   `label`   — a locale-formatted month name (`Jan 2026`). Locale is a
--               per-request concern the database does not have; the client
--               fills it in with `getActiveLocale()`, the same way every
--               other screen formats a date.
--   `verdict` — a sentence built from `short_month` / `short_by` /
--               `months[last].closing`. Formatting a Rupiah figure into
--               prose is presentation, not derivation, and the client already
--               owns `formatIDRCompact` for it.
--
-- Both are data this function returns (`short_month`, `short_by`, every
-- month's `closing`); only the formatting is left to the caller, the same
-- boundary `formatShort` sits on in the demo.
--
-- `security invoker`, not `security definer`: every write seam in this ladder
-- is `security definer` because it has to write audit/outbox rows the caller
-- cannot write directly and enforce a specific business rule beyond plain
-- RLS. This function does neither — it only reads — and reading is what
-- `security_invoker = on` views already do throughout this schema. A
-- `security definer` version would run as this function's owner and bypass
-- every RLS policy on every table it touches, handing the whole company's
-- cash position to anyone who could call it; invoker rights mean the actual
-- caller's grants decide what `cash_components`, `transactions` and
-- `v_vendor_journey` answer, exactly as if the client had queried each of
-- them directly.
create or replace function ops_acct.cash_plan(p_now timestamptz default now())
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
  select array_agg(to_char(date_trunc('month', v_today) + (n || ' months')::interval, 'YYYY-MM') order by n)
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
        elsif v_hit_amount > 0 and v_hit_amount >= v_planned - 1000 then v_state := 'PAID';
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
           and coalesce((select sum(actual) from _cp_events e where e.component_id=v_comp.id and e.month=v_month),0)
             >= coalesce((select sum(planned) from _cp_events e where e.component_id=v_comp.id and e.month=v_month),0) - 1000
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
            'frequency', c.frequency, 'month', e.month, 'date', e.date,
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
        case when v_month = v_current then greatest(cc.planned - cc.actual, 0) else cc.planned end
      ), 0) into v_planned_in
        from _cp_cells cc join ops_acct.cash_components c on c.id = cc.component_id
       where cc.month = v_month and c.direction = 'IN' and c.active;

      select coalesce(sum(
        case when v_month = v_current then greatest(cc.planned - cc.actual, 0) else cc.planned end
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

grant execute on function ops_acct.cash_plan(timestamptz) to authenticated;
