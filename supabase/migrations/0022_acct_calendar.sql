-- 0022_acct_calendar.sql — twelve months, planned against actual.
--
-- Three tables and **no projection stored** (D109–D115). The twelve months are
-- computed on every read, from the lines somebody typed, the months somebody
-- changed, and the ledger as it stands. A stored projection is one that
-- disagrees with the ledger the moment a payment lands.
--
-- The hard part is not the arithmetic, it is the **claiming**. A ledger row may
-- only be counted once, and which planned line gets it depends on how specific
-- that line is: a dated one-off takes its own payment before the standing line
-- for that category sweeps it up (D110). Without that order, *pelunasan kartu
-- kredit* in November is swallowed by the monthly card bill and the plan shows
-- the routine amount twice.
--
-- Claiming in order is sequential by nature, so the engine is a set-returning
-- function rather than a plain view. It is still **computed on read** — A3 is
-- about not storing a derived figure, not about which language derives it.

create table ops_acct.cash_components (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) > 0),
  direction   ops_acct.direction_t not null default 'OUT',
  -- **Per occurrence, not per month.** A weekly line of 30 juta is 120 in a
  -- four-payday month and 150 in a five-payday one, and pretending otherwise
  -- is how a month gets underestimated by a whole run (D113).
  amount      numeric not null check (amount > 0),
  frequency   ops_acct.cash_frequency_t not null,

  -- `monthly`: 1–31, clamped to the length of each month, so 31 in February is
  -- the 28th rather than a date that does not exist.
  due_day     int check (due_day between 1 and 31),
  -- `weekly`: 0 Sunday … 6 Saturday, matching `extract(dow …)`.
  due_weekday int check (due_weekday between 0 and 6),
  -- `once`: the actual date. It exists in that month and no other.
  due_date    date,

  -- How the plan finds what actually happened. `type_code` alone is a
  -- category; with `vendor_id` it narrows, and narrower claims go first.
  type_code   text references ops_acct.transaction_types(code),
  vendor_id   uuid references ops_procure.vendors(id),
  account_id  uuid references ops_acct.accounts(id),

  starts_on   text not null,                -- YYYY-MM, inclusive
  ends_on     text,                         -- null keeps going
  note        text,
  active      boolean not null default true,
  created_by  uuid not null references ops_core.users(id),
  created_at  timestamptz not null default now(),

  -- Each shape needs exactly the field that dates it, and a line that cannot
  -- be dated can never fall due — which reads on screen as "planned" for ever.
  constraint shape_is_dated check (
    case frequency
      when 'monthly' then due_day is not null
      when 'weekly'  then due_weekday is not null
      when 'once'    then due_date is not null
    end),
  -- `\d{2}` is not enough: `2026-13` passes it, matches no month the plan ever
  -- generates, and so reads as saved while changing nothing — which is worse
  -- than being refused. Found by a smoke test that expected the refusal.
  constraint month_keys_look_right check (
    starts_on ~ '^\d{4}-(0[1-9]|1[0-2])$'
    and (ends_on is null or ends_on ~ '^\d{4}-(0[1-9]|1[0-2])$'))
);

create index cash_components_active_idx on ops_acct.cash_components (active, frequency);

-- One month of one component, changed. **`amount` null means *not this
-- month*** — a bill that skips a month is a fact, not a deletion.
--
-- For a weekly line the amount is **the month's total**, and the difference
-- lands on the last run: December's payroll carries the THR, and the THR is
-- paid with one run rather than spread across four (D114).
create table ops_acct.cash_overrides (
  id           uuid primary key default gen_random_uuid(),
  component_id uuid not null references ops_acct.cash_components(id) on delete restrict,
  month        text not null check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  amount       numeric check (amount is null or amount >= 0),
  due_day      int check (due_day between 1 and 31),
  reason       text,
  recorded_by  uuid not null references ops_core.users(id),
  recorded_at  timestamptz not null default now(),
  unique (component_id, month)
);

-- A person saying *this ledger row is that bill*. Matching by category is a
-- guess the screen is honest about; this is somebody deciding, and it always
-- wins over the guess.
create table ops_acct.cash_settlements (
  id           uuid primary key default gen_random_uuid(),
  component_id uuid not null references ops_acct.cash_components(id) on delete restrict,
  month        text not null check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  trx_no       text not null,
  recorded_by  uuid not null references ops_core.users(id),
  recorded_at  timestamptz not null default now(),
  -- One row, one bill. The same payment settling two lines would double-count
  -- it in the plan, which is the exact failure the claiming order prevents
  -- everywhere else.
  unique (trx_no)
);

create index cash_settlements_cm_idx on ops_acct.cash_settlements (component_id, month);

-- ── the dates a line falls due ────────────────────────────────────────────
-- `least(day, days in month)`: the 31st in February is the 28th, rather than a
-- date that does not exist and an occurrence that silently disappears.
create or replace function ops_acct.due_date_of(p_month text, p_day int)
returns date language sql immutable as $$
  select make_date(split_part(p_month,'-',1)::int, split_part(p_month,'-',2)::int,
                   least(p_day, extract(day from
                     (make_date(split_part(p_month,'-',1)::int,
                                split_part(p_month,'-',2)::int, 1)
                      + interval '1 month - 1 day'))::int))
$$;

-- Scalars rather than the composite row: the loop in `cash_events` yields a
-- `record` (it selects extra columns), and a record cannot be cast to a table
-- type. Taking the four fields that actually date a line is also honest about
-- what this depends on.
create or replace function ops_acct.cash_occurrences(
  p_frequency ops_acct.cash_frequency_t,
  p_due_day int, p_due_weekday int, p_due_date date,
  p_month text)
returns setof date
language sql stable as $$
  select d::date from (
    select case p_frequency
      when 'once'    then (select array[p_due_date]
                            where to_char(p_due_date,'YYYY-MM') = p_month)
      when 'monthly' then array[ops_acct.due_date_of(p_month, p_due_day)]
      -- Every matching weekday in the month: four in most, five in some, and
      -- that difference is real money (D113).
      else (select array_agg(g::date order by g)
              from generate_series(
                     ops_acct.due_date_of(p_month, 1),
                     ops_acct.due_date_of(p_month, 31),
                     interval '1 day') g
             where extract(dow from g) = p_due_weekday)
    end as arr
  ) x, unnest(coalesce(x.arr, '{}')) d
$$;

-- ── the engine ────────────────────────────────────────────────────────────
-- One row per dated movement: this line, on this day, planned against what the
-- ledger shows. Twelve months from `p_from`, defaulting to the office day.
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
            when v_actual > 0 and v_actual >= v_planned - v_tol then 'PAID'
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
           when sum(actual) > 0 and sum(actual) >= sum(planned) - ops_core.money_tolerance()
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

create or replace view ops_acct.v_cash_row as
  select c.id as component_id, c.name, c.direction, c.frequency, c.amount,
         c.due_day, c.due_weekday, c.due_date, c.type_code, c.note, c.active,
         v.name as vendor_name, a.code as account_code,
         coalesce(sum(cell.planned), 0) as planned_total,
         coalesce(sum(cell.actual), 0)  as actual_total
    from ops_acct.cash_components c
    left join ops_procure.vendors v on v.id = c.vendor_id
    left join ops_acct.accounts   a on a.id = c.account_id
    left join ops_acct.v_cash_cell cell on cell.component_id = c.id
   group by c.id, c.name, c.direction, c.frequency, c.amount, c.due_day,
            c.due_weekday, c.due_date, c.type_code, c.note, c.active,
            v.name, a.code;

-- Cash as it stands, across the accounts that actually pay people.
--
-- **Leadership's accounts are not among them**: money sitting there has not
-- been given to operations yet, and counting it would make every month look
-- survivable.
create or replace view ops_acct.v_cash_position as
  select coalesce(sum(b.balance), 0) as opening_cash,
         ops_core.office_day()           as as_of
    from ops_acct.v_account_balance b
    join ops_acct.accounts a on a.id = b.account_id
   where a.custody = 'accounting' and a.is_active;

-- What left the paying accounts and no planned line claimed. Not an error —
-- most spending is not on the calendar — but the figure a month is short by
-- when the plan looked fine.
create or replace view ops_acct.v_cash_unplanned as
  select to_char(t.trx_date, 'YYYY-MM') as month,
         sum(t.amount_idr) filter (where t.direction = 'OUT') as out_unplanned,
         sum(t.amount_idr) filter (where t.direction = 'IN')  as in_unplanned,
         count(*) as rows_unplanned
    from ops_acct.transactions t
    join ops_acct.accounts a on a.id = t.account_id
   where t.status <> 'VOID' and a.custody = 'accounting'
     and not exists (
       select 1 from ops_acct.v_cash_event e where t.trx_no = any(e.trx_nos))
   group by 1;

-- ── writing ───────────────────────────────────────────────────────────────
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
  p_id uuid default null)
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
  -- An estimate of zero plans nothing. Better a rough number than a blank one:
  -- the whole point is to see the month before it happens.
  if p_amount is null or p_amount <= 0 then
    return ops_core.invalid('accounting','cash_component', p_name,'save',
      'amount_required','An estimate of zero plans nothing. Put the number you expect, even roughly.',
      jsonb_build_object('field','amount'));
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
       type_code, vendor_id, account_id, starts_on, note, created_by)
    values (btrim(p_name), p_direction, p_amount, p_frequency,
            p_due_day, p_due_weekday, p_due_date, p_type_code, v_vendor, v_account,
            coalesce(p_starts_on, to_char(ops_core.office_day(), 'YYYY-MM')),
            nullif(btrim(p_note), ''), auth.uid())
    returning id into v_id;
  else
    update ops_acct.cash_components set
      name = btrim(p_name), direction = p_direction, amount = p_amount,
      frequency = p_frequency, due_day = p_due_day, due_weekday = p_due_weekday,
      due_date = p_due_date, type_code = p_type_code,
      vendor_id = v_vendor, account_id = v_account,
      note = nullif(btrim(p_note), '')
    where id = p_id
    returning id into v_id;
    if v_id is null then
      return ops_core.not_found('accounting','cash_component', p_id::text,'save','No such line.');
    end if;
  end if;

  return ops_core.ok('accounting','cash_component', btrim(p_name),'save',
    jsonb_build_object('component_id', v_id, 'name', btrim(p_name),
                       'frequency', p_frequency, 'amount', p_amount));
end $$;

-- A month changed. `p_amount` null with `p_skip` means *not this month* — a
-- bill that skips is a fact, not a deletion, and the reason is what makes it
-- readable a quarter later.
create or replace function ops_acct.set_cash_override(
  p_component_id uuid, p_month text,
  p_amount numeric default null, p_reason text default null,
  p_skip boolean default false)
returns jsonb
language plpgsql security definer set search_path = ops_acct, ops_core, pg_temp as $$
declare v_before numeric;
begin
  if not ops_core.has_permission('accounting.update') then
    return ops_core.refused('accounting','cash_override', p_month,'override',
      'not_permitted','Changing a month needs accounting access.');
  end if;
  if p_month !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    return ops_core.invalid('accounting','cash_override', p_month,'override',
      'month_invalid','A month reads as YYYY-MM.', jsonb_build_object('field','month'));
  end if;
  if not exists (select 1 from ops_acct.cash_components where id = p_component_id) then
    return ops_core.not_found('accounting','cash_override', p_month,'override','No such line.');
  end if;
  if not p_skip and (p_amount is null or p_amount < 0) then
    return ops_core.invalid('accounting','cash_override', p_month,'override',
      'amount_required','Give the amount for this month, or say it is skipped.',
      jsonb_build_object('field','amount'));
  end if;

  select amount into v_before from ops_acct.cash_overrides
   where component_id = p_component_id and month = p_month;

  insert into ops_acct.cash_overrides (component_id, month, amount, reason, recorded_by)
  values (p_component_id, p_month, case when p_skip then null else p_amount end,
          nullif(btrim(p_reason), ''), auth.uid())
  on conflict (component_id, month) do update
    set amount = excluded.amount, reason = excluded.reason,
        recorded_by = excluded.recorded_by, recorded_at = now();

  return ops_core.ok('accounting','cash_override', p_month,'override',
    jsonb_build_object('component_id', p_component_id, 'month', p_month,
                       'amount', case when p_skip then null else p_amount end,
                       'skipped', p_skip),
    to_jsonb(v_before), to_jsonb(case when p_skip then null else p_amount end));
end $$;

-- Somebody saying *this ledger row is that bill*. It always beats the category
-- guess, which is the point: the guess is the fallback, not the answer.
create or replace function ops_acct.link_cash_payment(
  p_component_id uuid, p_month text, p_trx_no text)
returns jsonb
language plpgsql security definer set search_path = ops_acct, ops_core, pg_temp as $$
declare t ops_acct.transactions; existing uuid;
begin
  if not ops_core.has_permission('accounting.update') then
    return ops_core.refused('accounting','cash_settlement', p_trx_no,'link',
      'not_permitted','Linking a payment needs accounting access.');
  end if;

  select * into t from ops_acct.transactions where trx_no = p_trx_no;
  if not found then
    return ops_core.not_found('accounting','cash_settlement', p_trx_no,'link',
      format('There is no ledger row %s.', p_trx_no));
  end if;
  if t.status = 'VOID' then
    return ops_core.invalid('accounting','cash_settlement', p_trx_no,'link',
      'transaction_void','That row was voided. A voided payment settles nothing.',
      jsonb_build_object('field','trx_no'));
  end if;

  select component_id into existing from ops_acct.cash_settlements where trx_no = p_trx_no;
  if existing is not null then
    return ops_core.conflict('accounting','cash_settlement', p_trx_no,'link',
      'already_linked',
      'That payment is already on the calendar against another line. One row, one bill.',
      jsonb_build_object('component_id', existing));
  end if;

  insert into ops_acct.cash_settlements (component_id, month, trx_no, recorded_by)
  values (p_component_id, p_month, p_trx_no, auth.uid());

  return ops_core.ok('accounting','cash_settlement', p_trx_no,'link',
    jsonb_build_object('component_id', p_component_id, 'month', p_month,
                       'trx_no', p_trx_no));
end $$;

alter table ops_acct.cash_components  enable row level security;
alter table ops_acct.cash_overrides   enable row level security;
alter table ops_acct.cash_settlements enable row level security;

create policy cash_components_read on ops_acct.cash_components
  for select to authenticated using (ops_core.has_permission('accounting.read'));
create policy cash_overrides_read on ops_acct.cash_overrides
  for select to authenticated using (ops_core.has_permission('accounting.read'));
create policy cash_settlements_read on ops_acct.cash_settlements
  for select to authenticated using (ops_core.has_permission('accounting.read'));

create policy cash_components_write on ops_acct.cash_components
  for all to authenticated
  using (ops_core.has_permission('accounting.update'))
  with check (ops_core.has_permission('accounting.update'));
create policy cash_overrides_write on ops_acct.cash_overrides
  for all to authenticated
  using (ops_core.has_permission('accounting.update'))
  with check (ops_core.has_permission('accounting.update'));
create policy cash_settlements_write on ops_acct.cash_settlements
  for all to authenticated
  using (ops_core.has_permission('accounting.update'))
  with check (ops_core.has_permission('accounting.update'));

alter view ops_acct.v_cash_event    set (security_invoker = on);
alter view ops_acct.v_cash_cell     set (security_invoker = on);
alter view ops_acct.v_cash_row      set (security_invoker = on);
alter view ops_acct.v_cash_position set (security_invoker = on);
alter view ops_acct.v_cash_unplanned set (security_invoker = on);

grant select on ops_acct.cash_components, ops_acct.cash_overrides, ops_acct.cash_settlements,
                ops_acct.v_cash_event, ops_acct.v_cash_cell, ops_acct.v_cash_row,
                ops_acct.v_cash_position, ops_acct.v_cash_unplanned
  to authenticated;
grant insert, update on ops_acct.cash_components, ops_acct.cash_overrides,
                        ops_acct.cash_settlements to authenticated;
grant execute on function
  ops_acct.due_date_of(text, int),
  ops_acct.cash_occurrences(ops_acct.cash_frequency_t, int, int, date, text),
  ops_acct.cash_events(date),
  ops_acct.save_cash_component(text, numeric, ops_acct.cash_frequency_t, ops_acct.direction_t,
                           int, int, date, text, text, text, text, text, uuid),
  ops_acct.set_cash_override(uuid, text, numeric, text, boolean),
  ops_acct.link_cash_payment(uuid, text, text)
  to authenticated;
