-- 0239_acct_cashflow.sql — leadership's cashflow (D392).
--
-- The owner (2026-10-07): *siapkan module cashflow untuk pimpinan dan
-- superadmin … rekap semua estimasi pendapatan dan pengeluaran perusahaan,
-- actual vs projected dan selisihnya … kapan kita kehabisan dana … mingguan …
-- hubungkan ke monthly bills tapi buat lebih fleksibel supaya amount nya bisa
-- diubah tergantung pertumbuhan perusahaan.*
--
-- D108 had dropped a cashflow screen because the ledger already shows the cash
-- position. That was true of the past; it is not an answer about the future,
-- and the payment calendar (D109) answers the future for accounting's paying
-- accounts and bills only. The cashflow is the company's: every account, the
-- money expected from clients, week by week.
--
--   cashflow_lines      the cashflow's own lines (a client's termin, tax, an
--                       instalment) **and** its change to a monthly bill,
--                       told apart by `source_ref` (`component:<uuid>` /
--                       `sub:<uuid>`). A bill's dates, figure and payments
--                       stay on the calendar and the subscription register —
--                       this row only replaces the amount *for the
--                       projection*, grows it per month, or leaves it out.
--   cashflow_overrides  one week of one line, changed, with a reason.
--   cashflow_receipts   money that actually moved against an own line, typed
--                       by leadership; with `trx_no` it is that ledger row.
--   cashflow_openings   a month's starting balance, typed when the ledger is
--                       behind (leadership's accounts are not always booked).
--   cashflow_settings   the safe minimum, and the ledger categories that are
--                       transfers between our own accounts.
--
-- **Who.** *Pimpinan dan superadmin* are exactly the holders of
-- `approve_funds` (production, 2026-10-07: evin@ and superadmin@) — the door
-- D87 and D391 already put on the leadership accounts' balances and rows,
-- which this adds up. Not `accounting.plan_cash`: accounting's staff hold
-- `accounting: admin` and leadership holds `accounting: read`, so the module
-- level would let the wrong people in and keep the right one out.
--
-- **What is computed is TypeScript, not SQL** (`src/services/accounting/
-- cashflow.ts`, shared by both API layers, as `subscriptions.ts` is for
-- 0208): the weeks, growth, the matching of ledger rows to lines, the walk.
-- The bills come from `cash_plan()` as it already computes them (D228). This
-- migration stores, validates and audits, and gives one read seam,
-- `cashflow_ledger`, for the two things the client cannot read cheaply: every
-- account's balance on a past day, and every ledger row of a window in one
-- answer rather than PostgREST pages.
--
-- **Nothing is deleted.** Clearing a week, removing a realisation and going
-- back to the ledger's opening mark the row (`active`, `removed_at`) and keep
-- it: the trail of what leadership once assumed is part of reading why a
-- projection moved. (It is also what the Supabase migration road needs — a
-- statement it reads as destructive waits on a confirmation that road cannot
-- give, F240.)

create table ops_acct.cashflow_lines (
  id           uuid primary key default gen_random_uuid(),
  -- `component:<uuid>` or `sub:<uuid>` when it is the cashflow's change to a
  -- monthly bill; null for the cashflow's own line.
  source_ref   text unique check (source_ref is null or source_ref ~ '^(component|sub):[0-9a-f-]{36}$'),
  name         text not null check (length(btrim(name)) > 0),
  direction    ops_acct.direction_t not null,
  category     text not null check (category in (
                 'client','capital','other_in',
                 'payroll','bills','subscription','vendor','tax','loan','other_out')),
  frequency    ops_acct.cash_frequency_t,
  -- Per occurrence. On a bill, null follows the calendar's figure.
  amount       numeric check (amount is null or amount > 0),
  due_day      int check (due_day between 1 and 31),
  due_weekday  int check (due_weekday between 0 and 6),
  due_date     date,
  starts_on    text check (starts_on is null or starts_on ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  ends_on      text check (ends_on is null or ends_on ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  -- Percent per month, compounding from `growth_from`.
  growth_pct   numeric not null default 0 check (growth_pct > -100 and growth_pct <= 100),
  growth_from  text check (growth_from is null or growth_from ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  type_code    text references ops_acct.transaction_types(code),
  vendor_id    uuid references ops_procure.vendors(id),
  project_id   uuid references ops_procure.projects(id),
  hidden       boolean not null default false,
  note         text,
  active       boolean not null default true,
  created_by   uuid not null references ops_core.users(id),
  created_at   timestamptz not null default now(),
  -- The two kinds keep their own shape: a bill is always money out and never
  -- carries a schedule of its own; an own line always carries one.
  constraint cashflow_line_shape check (
    case when source_ref is not null
      then direction = 'OUT' and frequency is null
      else frequency is not null and amount is not null and not hidden
           and (frequency <> 'once'    or due_date is not null)
           and (frequency <> 'monthly' or (due_day is not null and starts_on is not null))
           and (frequency <> 'weekly'  or (due_weekday is not null and starts_on is not null))
    end),
  constraint cashflow_line_dates check (ends_on is null or starts_on is null or ends_on >= starts_on),
  constraint cashflow_line_side check (
    (direction = 'IN'  and category in ('client','capital','other_in')) or
    (direction = 'OUT' and category in ('payroll','bills','subscription','vendor','tax','loan','other_out')))
);

create table ops_acct.cashflow_overrides (
  id           uuid primary key default gen_random_uuid(),
  line_id      uuid not null references ops_acct.cashflow_lines(id) on delete cascade,
  -- Weeks are cut inside the month: the 1st, 8th, 15th, 22nd (D392).
  week_start   date not null check (extract(day from week_start) in (1, 8, 15, 22)),
  -- That week's total for the line; null is *not this week*.
  amount       numeric check (amount is null or amount >= 0),
  reason       text not null check (length(btrim(reason)) > 0),
  -- Cleared is not deleted: false puts the week back on its schedule.
  active       boolean not null default true,
  recorded_by  uuid not null references ops_core.users(id),
  recorded_at  timestamptz not null default now(),
  unique (line_id, week_start)
);

create table ops_acct.cashflow_receipts (
  id           uuid primary key default gen_random_uuid(),
  line_id      uuid not null references ops_acct.cashflow_lines(id) on delete restrict,
  on_date      date not null,
  amount       numeric not null check (amount > 0),
  -- One ledger row is one realisation, never two (D112's rule, again).
  trx_no       text unique references ops_acct.transactions(trx_no),
  note         text,
  recorded_by  uuid not null references ops_core.users(id),
  recorded_at  timestamptz not null default now(),
  -- Removed, not deleted. A removed realisation lets go of its ledger row
  -- (`trx_no` null) so the row can be used again; the audit keeps which.
  removed_at   timestamptz,
  removed_by   uuid references ops_core.users(id)
);
create index cashflow_receipts_line_idx on ops_acct.cashflow_receipts (line_id);

create table ops_acct.cashflow_openings (
  month        text primary key check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  amount       numeric not null,
  note         text,
  -- False: back to the ledger's figure. The typed one stays on record.
  active       boolean not null default true,
  recorded_by  uuid not null references ops_core.users(id),
  recorded_at  timestamptz not null default now()
);

create table ops_acct.cashflow_settings (
  id              boolean primary key default true check (id),
  min_balance     numeric not null default 0 check (min_balance >= 0),
  transfer_types  text[] not null default array['CASHFLOW'],
  updated_by      uuid references ops_core.users(id),
  updated_at      timestamptz not null default now()
);
insert into ops_acct.cashflow_settings (id) values (true);

alter table ops_acct.cashflow_lines     enable row level security;
alter table ops_acct.cashflow_overrides enable row level security;
alter table ops_acct.cashflow_receipts  enable row level security;
alter table ops_acct.cashflow_openings  enable row level security;
alter table ops_acct.cashflow_settings  enable row level security;

create policy cashflow_lines_read on ops_acct.cashflow_lines
  for select to authenticated using ((select ops_core.has_authority('approve_funds')));
create policy cashflow_overrides_read on ops_acct.cashflow_overrides
  for select to authenticated using ((select ops_core.has_authority('approve_funds')));
create policy cashflow_receipts_read on ops_acct.cashflow_receipts
  for select to authenticated using ((select ops_core.has_authority('approve_funds')));
create policy cashflow_openings_read on ops_acct.cashflow_openings
  for select to authenticated using ((select ops_core.has_authority('approve_funds')));
create policy cashflow_settings_read on ops_acct.cashflow_settings
  for select to authenticated using ((select ops_core.has_authority('approve_funds')));

-- Read-only to everybody: every write is a seam below.
grant select on ops_acct.cashflow_lines, ops_acct.cashflow_overrides, ops_acct.cashflow_receipts,
                ops_acct.cashflow_openings, ops_acct.cashflow_settings to authenticated;

-- ── the one refusal every seam shares ───────────────────────────────────
-- Invoker, not definer: it only builds the envelope, and `ops_core.refused`
-- (definer, granted to everybody signed in) writes the trail.
create or replace function ops_acct.cashflow_refusal(p_entity text, p_no text, p_action text)
returns jsonb
language sql security invoker set search_path = ops_acct, ops_core, pg_temp as $$
  select ops_core.refused('accounting', p_entity, p_no, p_action, 'authority_required',
    'The cashflow is leadership''s — it needs the authority to approve funds.',
    jsonb_build_object('required', 'approve_funds'))
$$;

-- ── read: balances on a day, and the ledger of a window ─────────────────
-- Every active account, the leadership ones included (the caller holds
-- `approve_funds`, which is what unlocks them, D87), and every row that is
-- not void. One answer, not PostgREST pages: a quarter of the ledger is more
-- than one page.
create or replace function ops_acct.cashflow_ledger(p_from date, p_to date)
returns jsonb
language plpgsql security definer set search_path = ops_acct, ops_core, pg_temp as $$
begin
  if not ops_core.has_authority('approve_funds') then
    return ops_acct.cashflow_refusal('cashflow', null, 'read');
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 800 then
    return ops_core.invalid('accounting','cashflow', null,'read',
      'window_invalid','A window of at most two years, from before to.');
  end if;
  return jsonb_build_object('outcome', 'ok', 'status', 200, 'data', jsonb_build_object(
    'accounts', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'code', a.code, 'custody', a.custody, 'currency', a.currency,
               'balance', a.opening_balance + coalesce(m.net, 0)) order by a.code), '[]'::jsonb)
        from ops_acct.accounts a
        left join (
          select account_id,
                 sum(case when direction = 'IN' then amount_idr else -amount_idr end) as net
            from ops_acct.transactions
           where status <> 'VOID' and trx_date < p_from
           group by account_id) m on m.account_id = a.id
       where a.is_active),
    'rows', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'trx_no', t.trx_no, 'trx_date', t.trx_date, 'direction', t.direction,
               'amount_idr', t.amount_idr, 'type_code', t.type_code,
               'vendor_id', t.vendor_id, 'project_id', t.project_id) order by t.trx_date, t.trx_no), '[]'::jsonb)
        from ops_acct.transactions t
       where t.status <> 'VOID' and t.trx_date between p_from and p_to)));
end $$;

-- ── own lines ───────────────────────────────────────────────────────────
create or replace function ops_acct.save_cashflow_line(
  p_name text,
  p_direction text,
  p_category text,
  p_frequency text,
  p_amount numeric,
  p_due_day int default null,
  p_due_weekday int default null,
  p_due_date date default null,
  p_starts_on text default null,
  p_ends_on text default null,
  p_growth_pct numeric default 0,
  p_growth_from text default null,
  p_type_code text default null,
  p_vendor_id uuid default null,
  p_project_id uuid default null,
  p_note text default null,
  p_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = ops_acct, ops_core, pg_temp as $$
declare
  v_id uuid; v_was jsonb; v_starts text; v_ends text;
  v_month_re constant text := '^\d{4}-(0[1-9]|1[0-2])$';
begin
  if not ops_core.has_authority('approve_funds') then
    return ops_acct.cashflow_refusal('cashflow_line', p_name, 'save');
  end if;
  if coalesce(btrim(p_name), '') = '' then
    return ops_core.invalid('accounting','cashflow_line', null,'save',
      'name_required','Name the line so it can be recognised.', jsonb_build_object('field','name'));
  end if;
  if p_direction is null or p_direction not in ('IN','OUT') then
    return ops_core.invalid('accounting','cashflow_line', p_name,'save',
      'direction_invalid','Money in or money out.', jsonb_build_object('field','direction'));
  end if;
  if p_category is null or not (
       (p_direction = 'IN'  and p_category in ('client','capital','other_in')) or
       (p_direction = 'OUT' and p_category in ('payroll','bills','subscription','vendor','tax','loan','other_out'))) then
    return ops_core.invalid('accounting','cashflow_line', p_name,'save',
      'category_invalid','That group does not belong on this side.', jsonb_build_object('field','category'));
  end if;
  if p_frequency is null or p_frequency not in ('weekly','monthly','once') then
    return ops_core.invalid('accounting','cashflow_line', p_name,'save',
      'frequency_invalid','Weekly, monthly or once.', jsonb_build_object('field','frequency'));
  end if;
  if p_amount is null or p_amount <= 0 then
    return ops_core.invalid('accounting','cashflow_line', p_name,'save',
      'amount_required','The amount each time, more than zero.', jsonb_build_object('field','amount'));
  end if;
  if p_frequency = 'once' and p_due_date is null then
    return ops_core.invalid('accounting','cashflow_line', p_name,'save',
      'date_required','A one-off needs its date.', jsonb_build_object('field','due_date'));
  end if;
  if p_frequency = 'monthly' and (p_due_day is null or p_due_day not between 1 and 31) then
    return ops_core.invalid('accounting','cashflow_line', p_name,'save',
      'day_invalid','A day of the month, 1 to 31.', jsonb_build_object('field','due_day'));
  end if;
  if p_frequency = 'weekly' and (p_due_weekday is null or p_due_weekday not between 0 and 6) then
    return ops_core.invalid('accounting','cashflow_line', p_name,'save',
      'weekday_invalid','A day of the week.', jsonb_build_object('field','due_weekday'));
  end if;
  v_starts := case when p_frequency = 'once' then to_char(p_due_date, 'YYYY-MM') else p_starts_on end;
  v_ends   := case when p_frequency = 'once' then null else nullif(p_ends_on, '') end;
  if p_frequency <> 'once' and (v_starts is null or v_starts !~ v_month_re) then
    return ops_core.invalid('accounting','cashflow_line', p_name,'save',
      'start_required','The month it starts.', jsonb_build_object('field','starts_on'));
  end if;
  if v_ends is not null and (v_ends !~ v_month_re or v_ends < v_starts) then
    return ops_core.invalid('accounting','cashflow_line', p_name,'save',
      'end_before_start','It ends before it starts.', jsonb_build_object('field','ends_on'));
  end if;
  if coalesce(p_growth_pct, 0) <= -100 or coalesce(p_growth_pct, 0) > 100 then
    return ops_core.invalid('accounting','cashflow_line', p_name,'save',
      'growth_invalid','Growth is a percentage per month, between −99 and 100.', jsonb_build_object('field','growth_pct'));
  end if;
  if p_growth_from is not null and p_growth_from !~ v_month_re then
    return ops_core.invalid('accounting','cashflow_line', p_name,'save',
      'growth_from_invalid','The month growth starts from.', jsonb_build_object('field','growth_from'));
  end if;
  if p_type_code is not null and not exists (select 1 from ops_acct.transaction_types where code = p_type_code) then
    return ops_core.invalid('accounting','cashflow_line', p_name,'save',
      'no_such_type', format('There is no ledger category %s.', p_type_code), jsonb_build_object('field','type_code'));
  end if;
  if p_vendor_id is not null and not exists (select 1 from ops_procure.vendors where id = p_vendor_id) then
    return ops_core.invalid('accounting','cashflow_line', p_name,'save',
      'no_such_vendor','No such vendor.', jsonb_build_object('field','vendor_id'));
  end if;
  if p_project_id is not null and not exists (select 1 from ops_procure.projects where id = p_project_id) then
    return ops_core.invalid('accounting','cashflow_line', p_name,'save',
      'no_such_project','No such project.', jsonb_build_object('field','project_id'));
  end if;

  if p_id is null then
    insert into ops_acct.cashflow_lines
      (name, direction, category, frequency, amount, due_day, due_weekday, due_date,
       starts_on, ends_on, growth_pct, growth_from, type_code, vendor_id, project_id, note, created_by)
    values (btrim(p_name), p_direction::ops_acct.direction_t, p_category, p_frequency::ops_acct.cash_frequency_t, p_amount,
            case when p_frequency = 'monthly' then p_due_day end,
            case when p_frequency = 'weekly' then p_due_weekday end,
            case when p_frequency = 'once' then p_due_date end,
            v_starts, v_ends,
            case when p_frequency = 'once' then 0 else coalesce(p_growth_pct, 0) end,
            case when p_frequency = 'once' then null else p_growth_from end,
            p_type_code, p_vendor_id, p_project_id, nullif(btrim(p_note), ''), auth.uid())
    returning id into v_id;
  else
    select to_jsonb(l) into v_was from ops_acct.cashflow_lines l where id = p_id and source_ref is null;
    if v_was is null then
      return ops_core.not_found('accounting','cashflow_line', p_id::text,'save','No such cashflow line.');
    end if;
    update ops_acct.cashflow_lines set
      name = btrim(p_name), direction = p_direction::ops_acct.direction_t, category = p_category,
      frequency = p_frequency::ops_acct.cash_frequency_t, amount = p_amount,
      due_day = case when p_frequency = 'monthly' then p_due_day end,
      due_weekday = case when p_frequency = 'weekly' then p_due_weekday end,
      due_date = case when p_frequency = 'once' then p_due_date end,
      starts_on = v_starts, ends_on = v_ends,
      growth_pct = case when p_frequency = 'once' then 0 else coalesce(p_growth_pct, 0) end,
      growth_from = case when p_frequency = 'once' then null else p_growth_from end,
      type_code = p_type_code, vendor_id = p_vendor_id, project_id = p_project_id,
      note = nullif(btrim(p_note), ''), active = true
    where id = p_id
    returning id into v_id;
  end if;

  return ops_core.ok('accounting','cashflow_line', btrim(p_name),
    case when p_id is null then 'create' else 'update' end,
    jsonb_build_object('id', v_id), v_was,
    (select to_jsonb(l) from ops_acct.cashflow_lines l where id = v_id));
end $$;

-- ── the cashflow's change to a monthly bill ─────────────────────────────
create or replace function ops_acct.save_cashflow_bill(
  p_source_ref text,
  p_name text,
  p_category text,
  p_amount numeric default null,
  p_growth_pct numeric default 0,
  p_growth_from text default null,
  p_hidden boolean default false,
  p_note text default null)
returns jsonb
language plpgsql security definer set search_path = ops_acct, ops_core, pg_temp as $$
declare v_id uuid; v_was jsonb; v_ref uuid;
begin
  if not ops_core.has_authority('approve_funds') then
    return ops_acct.cashflow_refusal('cashflow_line', p_name, 'adjust_bill');
  end if;
  if p_source_ref is null or p_source_ref !~ '^(component|sub):[0-9a-f-]{36}$' then
    return ops_core.invalid('accounting','cashflow_line', p_name,'adjust_bill',
      'source_invalid','Not a monthly bill.', jsonb_build_object('field','source_ref'));
  end if;
  v_ref := split_part(p_source_ref, ':', 2)::uuid;
  if (p_source_ref like 'component:%' and not exists (select 1 from ops_acct.cash_components where id = v_ref))
     or (p_source_ref like 'sub:%' and not exists (select 1 from ops_acct.subscriptions where id = v_ref)) then
    return ops_core.not_found('accounting','cashflow_line', p_source_ref,'adjust_bill','No such monthly bill.');
  end if;
  if p_category is null or p_category not in ('payroll','bills','subscription','vendor','tax','loan','other_out') then
    return ops_core.invalid('accounting','cashflow_line', p_name,'adjust_bill',
      'category_invalid','That group does not belong on this side.', jsonb_build_object('field','category'));
  end if;
  if p_amount is not null and p_amount <= 0 then
    return ops_core.invalid('accounting','cashflow_line', p_name,'adjust_bill',
      'amount_required','The amount each time, more than zero — or empty to follow the calendar.', jsonb_build_object('field','amount'));
  end if;
  if coalesce(p_growth_pct, 0) <= -100 or coalesce(p_growth_pct, 0) > 100 then
    return ops_core.invalid('accounting','cashflow_line', p_name,'adjust_bill',
      'growth_invalid','Growth is a percentage per month, between −99 and 100.', jsonb_build_object('field','growth_pct'));
  end if;
  if p_growth_from is not null and p_growth_from !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    return ops_core.invalid('accounting','cashflow_line', p_name,'adjust_bill',
      'growth_from_invalid','The month growth starts from.', jsonb_build_object('field','growth_from'));
  end if;

  select to_jsonb(l) into v_was from ops_acct.cashflow_lines l where source_ref = p_source_ref;
  insert into ops_acct.cashflow_lines (source_ref, name, direction, category, amount, growth_pct, growth_from, hidden, note, created_by)
  values (p_source_ref, coalesce(nullif(btrim(p_name), ''), p_source_ref), 'OUT', p_category, p_amount,
          coalesce(p_growth_pct, 0), p_growth_from, coalesce(p_hidden, false), nullif(btrim(p_note), ''), auth.uid())
  on conflict (source_ref) do update set
    name = excluded.name, category = excluded.category, amount = excluded.amount,
    growth_pct = excluded.growth_pct, growth_from = excluded.growth_from,
    hidden = excluded.hidden, note = excluded.note, active = true
  returning id into v_id;

  return ops_core.ok('accounting','cashflow_line', p_name,'adjust_bill',
    jsonb_build_object('id', v_id), v_was,
    (select to_jsonb(l) from ops_acct.cashflow_lines l where id = v_id));
end $$;

create or replace function ops_acct.remove_cashflow_line(p_id uuid)
returns jsonb
language plpgsql security definer set search_path = ops_acct, ops_core, pg_temp as $$
declare v_name text;
begin
  if not ops_core.has_authority('approve_funds') then
    return ops_acct.cashflow_refusal('cashflow_line', p_id::text, 'remove');
  end if;
  -- Taken off, not deleted: its realisations stay on record.
  update ops_acct.cashflow_lines set active = false
   where id = p_id and source_ref is null and active
  returning name into v_name;
  if v_name is null then
    return ops_core.not_found('accounting','cashflow_line', p_id::text,'remove','No such cashflow line.');
  end if;
  return ops_core.ok('accounting','cashflow_line', v_name,'remove', jsonb_build_object('id', p_id));
end $$;

-- ── one week, changed ───────────────────────────────────────────────────
create or replace function ops_acct.set_cashflow_week(
  p_week_start date,
  p_amount numeric,
  p_reason text,
  p_line_id uuid default null,
  p_source_ref text default null,
  p_name text default null)
returns jsonb
language plpgsql security definer set search_path = ops_acct, ops_core, pg_temp as $$
declare v_line uuid; v_r jsonb;
begin
  if not ops_core.has_authority('approve_funds') then
    return ops_acct.cashflow_refusal('cashflow_week', p_week_start::text, 'set');
  end if;
  if p_week_start is null or extract(day from p_week_start) not in (1, 8, 15, 22) then
    return ops_core.invalid('accounting','cashflow_week', p_week_start::text,'set',
      'week_invalid','A week starts on the 1st, 8th, 15th or 22nd.', jsonb_build_object('field','week_start'));
  end if;
  if p_amount is not null and p_amount < 0 then
    return ops_core.invalid('accounting','cashflow_week', p_week_start::text,'set',
      'amount_invalid','Zero or more — or not this week.', jsonb_build_object('field','amount'));
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    return ops_core.invalid('accounting','cashflow_week', p_week_start::text,'set',
      'reason_required','Say why this week is different.', jsonb_build_object('field','reason'));
  end if;

  v_line := p_line_id;
  if v_line is null and p_source_ref is not null then
    select id into v_line from ops_acct.cashflow_lines where source_ref = p_source_ref;
    if v_line is null then
      -- A bill nobody adjusted yet is given its cashflow row on the way.
      v_r := ops_acct.save_cashflow_bill(p_source_ref, coalesce(p_name, p_source_ref),
               case when p_source_ref like 'sub:%' then 'subscription' else 'bills' end);
      if v_r ->> 'outcome' <> 'ok' then return v_r; end if;
      v_line := (v_r -> 'data' ->> 'id')::uuid;
    end if;
  end if;
  if v_line is null or not exists (select 1 from ops_acct.cashflow_lines where id = v_line and active) then
    return ops_core.not_found('accounting','cashflow_week', p_week_start::text,'set','No such cashflow line.');
  end if;

  insert into ops_acct.cashflow_overrides (line_id, week_start, amount, reason, recorded_by)
  values (v_line, p_week_start, p_amount, btrim(p_reason), auth.uid())
  on conflict (line_id, week_start) do update set
    amount = excluded.amount, reason = excluded.reason, active = true,
    recorded_by = excluded.recorded_by, recorded_at = now();

  return ops_core.ok('accounting','cashflow_week', p_week_start::text,'set',
    jsonb_build_object('line_id', v_line, 'week_start', p_week_start),
    null, jsonb_build_object('amount', p_amount, 'reason', btrim(p_reason)));
end $$;

create or replace function ops_acct.clear_cashflow_week(p_line_id uuid, p_week_start date)
returns jsonb
language plpgsql security definer set search_path = ops_acct, ops_core, pg_temp as $$
begin
  if not ops_core.has_authority('approve_funds') then
    return ops_acct.cashflow_refusal('cashflow_week', p_week_start::text, 'clear');
  end if;
  update ops_acct.cashflow_overrides set active = false, recorded_by = auth.uid(), recorded_at = now()
   where line_id = p_line_id and week_start = p_week_start and active;
  if not found then
    return ops_core.noop('accounting','cashflow_week', p_week_start::text,'clear',
      'That week was not changed.', jsonb_build_object('line_id', p_line_id, 'week_start', p_week_start));
  end if;
  return ops_core.ok('accounting','cashflow_week', p_week_start::text,'clear',
    jsonb_build_object('line_id', p_line_id, 'week_start', p_week_start));
end $$;

-- ── realisations on own lines ───────────────────────────────────────────
create or replace function ops_acct.record_cashflow_receipt(
  p_line_id uuid,
  p_on_date date,
  p_amount numeric,
  p_trx_no text default null,
  p_note text default null)
returns jsonb
language plpgsql security definer set search_path = ops_acct, ops_core, pg_temp as $$
declare v_id uuid; v_trx text := nullif(btrim(p_trx_no), '');
begin
  if not ops_core.has_authority('approve_funds') then
    return ops_acct.cashflow_refusal('cashflow_receipt', p_on_date::text, 'record');
  end if;
  if not exists (select 1 from ops_acct.cashflow_lines where id = p_line_id and source_ref is null) then
    return ops_core.not_found('accounting','cashflow_receipt', p_line_id::text,'record',
      'Realisations are recorded on the cashflow''s own lines; a bill is settled on the calendar.');
  end if;
  if p_on_date is null then
    return ops_core.invalid('accounting','cashflow_receipt', null,'record',
      'date_required','The day the money moved.', jsonb_build_object('field','on_date'));
  end if;
  if p_on_date > ops_core.office_day() then
    return ops_core.invalid('accounting','cashflow_receipt', p_on_date::text,'record',
      'date_in_future','A realisation has already happened.', jsonb_build_object('field','on_date'));
  end if;
  if p_amount is null or p_amount <= 0 then
    return ops_core.invalid('accounting','cashflow_receipt', p_on_date::text,'record',
      'amount_required','The amount, more than zero.', jsonb_build_object('field','amount'));
  end if;
  if v_trx is not null then
    if not exists (select 1 from ops_acct.transactions where trx_no = v_trx and status <> 'VOID') then
      return ops_core.invalid('accounting','cashflow_receipt', v_trx,'record',
        'no_such_trx', format('There is no ledger row %s.', v_trx), jsonb_build_object('field','trx_no'));
    end if;
    if exists (select 1 from ops_acct.cashflow_receipts where trx_no = v_trx) then
      return ops_core.conflict('accounting','cashflow_receipt', v_trx,'record',
        'trx_already_used', format('%s is already a realisation on another line.', v_trx));
    end if;
  end if;

  insert into ops_acct.cashflow_receipts (line_id, on_date, amount, trx_no, note, recorded_by)
  values (p_line_id, p_on_date, p_amount, v_trx, nullif(btrim(p_note), ''), auth.uid())
  returning id into v_id;
  return ops_core.ok('accounting','cashflow_receipt', p_on_date::text,'record',
    jsonb_build_object('id', v_id), null,
    jsonb_build_object('line_id', p_line_id, 'amount', p_amount, 'trx_no', v_trx));
end $$;

create or replace function ops_acct.remove_cashflow_receipt(p_id uuid)
returns jsonb
language plpgsql security definer set search_path = ops_acct, ops_core, pg_temp as $$
declare v_was jsonb;
begin
  if not ops_core.has_authority('approve_funds') then
    return ops_acct.cashflow_refusal('cashflow_receipt', p_id::text, 'remove');
  end if;
  select to_jsonb(r) into v_was from ops_acct.cashflow_receipts r where id = p_id and removed_at is null;
  if v_was is null then
    return ops_core.not_found('accounting','cashflow_receipt', p_id::text,'remove','No such realisation.');
  end if;
  update ops_acct.cashflow_receipts
     set removed_at = now(), removed_by = auth.uid(), trx_no = null
   where id = p_id;
  return ops_core.ok('accounting','cashflow_receipt', p_id::text,'remove', jsonb_build_object('id', p_id), v_was, null);
end $$;

-- ── where the walk starts, and the two settings ─────────────────────────
create or replace function ops_acct.set_cashflow_opening(p_month text, p_amount numeric, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = ops_acct, ops_core, pg_temp as $$
declare v_was jsonb;
begin
  if not ops_core.has_authority('approve_funds') then
    return ops_acct.cashflow_refusal('cashflow_opening', p_month, 'set');
  end if;
  if p_month is null or p_month !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    return ops_core.invalid('accounting','cashflow_opening', p_month,'set',
      'month_invalid','A month, YYYY-MM.', jsonb_build_object('field','month'));
  end if;
  select to_jsonb(o) into v_was from ops_acct.cashflow_openings o where month = p_month;
  if p_amount is null then
    update ops_acct.cashflow_openings set active = false, recorded_by = auth.uid(), recorded_at = now()
     where month = p_month;
  else
    insert into ops_acct.cashflow_openings (month, amount, note, recorded_by)
    values (p_month, p_amount, nullif(btrim(p_note), ''), auth.uid())
    on conflict (month) do update set
      amount = excluded.amount, note = excluded.note, active = true,
      recorded_by = excluded.recorded_by, recorded_at = now();
  end if;
  return ops_core.ok('accounting','cashflow_opening', p_month,'set',
    jsonb_build_object('month', p_month), v_was,
    jsonb_build_object('amount', p_amount, 'note', p_note));
end $$;

create or replace function ops_acct.set_cashflow_settings(p_min_balance numeric, p_transfer_types text[])
returns jsonb
language plpgsql security definer set search_path = ops_acct, ops_core, pg_temp as $$
declare v_was jsonb; v_types text[];
begin
  if not ops_core.has_authority('approve_funds') then
    return ops_acct.cashflow_refusal('cashflow_settings', 'settings', 'set');
  end if;
  if p_min_balance is null or p_min_balance < 0 then
    return ops_core.invalid('accounting','cashflow_settings', 'settings','set',
      'min_balance_invalid','The safe minimum is zero or more.', jsonb_build_object('field','min_balance'));
  end if;
  select coalesce(array_agg(distinct btrim(t)) filter (where btrim(t) <> ''), '{}')
    into v_types from unnest(coalesce(p_transfer_types, '{}')) t;
  if exists (select 1 from unnest(v_types) t where not exists (select 1 from ops_acct.transaction_types where code = t)) then
    return ops_core.invalid('accounting','cashflow_settings', 'settings','set',
      'no_such_type','Every transfer category must be a ledger category.', jsonb_build_object('field','transfer_types'));
  end if;
  select to_jsonb(s) into v_was from ops_acct.cashflow_settings s where id;
  update ops_acct.cashflow_settings
     set min_balance = p_min_balance, transfer_types = v_types, updated_by = auth.uid(), updated_at = now()
   where id;
  return ops_core.ok('accounting','cashflow_settings', 'settings','set',
    jsonb_build_object('min_balance', p_min_balance, 'transfer_types', to_jsonb(v_types)), v_was,
    jsonb_build_object('min_balance', p_min_balance, 'transfer_types', to_jsonb(v_types)));
end $$;

revoke execute on function
  ops_acct.cashflow_ledger(date, date),
  ops_acct.save_cashflow_line(text, text, text, text, numeric, int, int, date, text, text, numeric, text, text, uuid, uuid, text, uuid),
  ops_acct.save_cashflow_bill(text, text, text, numeric, numeric, text, boolean, text),
  ops_acct.remove_cashflow_line(uuid),
  ops_acct.set_cashflow_week(date, numeric, text, uuid, text, text),
  ops_acct.clear_cashflow_week(uuid, date),
  ops_acct.record_cashflow_receipt(uuid, date, numeric, text, text),
  ops_acct.remove_cashflow_receipt(uuid),
  ops_acct.set_cashflow_opening(text, numeric, text),
  ops_acct.set_cashflow_settings(numeric, text[])
  from public;
grant execute on function
  ops_acct.cashflow_ledger(date, date),
  ops_acct.save_cashflow_line(text, text, text, text, numeric, int, int, date, text, text, numeric, text, text, uuid, uuid, text, uuid),
  ops_acct.save_cashflow_bill(text, text, text, numeric, numeric, text, boolean, text),
  ops_acct.remove_cashflow_line(uuid),
  ops_acct.set_cashflow_week(date, numeric, text, uuid, text, text),
  ops_acct.clear_cashflow_week(uuid, date),
  ops_acct.record_cashflow_receipt(uuid, date, numeric, text, text),
  ops_acct.remove_cashflow_receipt(uuid),
  ops_acct.set_cashflow_opening(text, numeric, text),
  ops_acct.set_cashflow_settings(numeric, text[])
  to authenticated;

analyze ops_acct.cashflow_lines;
analyze ops_acct.cashflow_overrides;
analyze ops_acct.cashflow_receipts;
analyze ops_acct.cashflow_openings;
analyze ops_acct.cashflow_settings;
