-- 0208_acct_subscriptions.sql — the register of subscriptions, and the rate
-- the dollar ones are converted at.
--
-- The owner's question (2026-10-02): software and services are billed in USD
-- and paid in rupiah, by several people on several cards, some every month,
-- some every year or every two years, some a fixed price and some pay-as-you-go.
-- A spreadsheet carried it. Nothing carried *will the money last*.
--
--   subscriptions          one row per service: how often (monthly · yearly ·
--                          every two years), whether the price is fixed or
--                          pay-as-you-go, in which currency, and the date it
--                          is billed. The payment method is an account from
--                          `ops_acct.accounts` — a label, nothing more.
--   subscription_payments  what was actually charged for one billing period:
--                          the rupiah that left, and the dollars if there were
--                          any, so the rate it really went at is a fact.
--   subscription_settings  one row: the USD → IDR rate the *plan* uses (19.000,
--                          editable). Only `accounting.plan_cash` changes it —
--                          an estimate belongs to leadership (D233).
--
-- **No card management and no ledger rows.** A subscription never posts a
-- transaction (D112: the calendar never posts one either) and the accounts are
-- only a picklist for *how it is paid*. The charge is recorded here, against
-- the subscription, with its own rupiah figure.
--
-- **What the dates are computed from is TypeScript, not SQL**
-- (`src/services/accounting/subscriptions.ts`, shared by both API layers): the
-- calendar draws a subscription as a line of its own and the arithmetic that
-- puts it on the months lives in one place. These tables only store, validate
-- and audit.

create sequence ops_acct.subscription_seq;

create table ops_acct.subscriptions (
  id           uuid primary key default gen_random_uuid(),
  sub_no       text not null unique
                 default 'SUB-' || lpad(nextval('ops_acct.subscription_seq')::text, 4, '0'),
  name         text not null check (length(btrim(name)) > 0),
  provider     text,
  -- Who the service is registered to: when a person leaves, this is where
  -- the access is lost.
  login_email  text,
  cycle        text not null check (cycle in ('monthly','yearly','biennial')),
  -- `fixed` is a price somebody quoted. `payg` is billed on use — the figure
  -- here is the expectation, and whatever is charged settles it.
  amount_kind  text not null check (amount_kind in ('fixed','payg')),
  currency     text not null check (currency in ('USD','IDR')),
  -- Per billing, in `currency`.
  amount       numeric not null check (amount > 0),
  -- A billing date: monthly repeats its day, yearly its day and month, every
  -- two years its day and month in every second year.
  start_on     date not null,
  ends_on      date,
  account_id   uuid references ops_acct.accounts(id),
  status       text not null default 'active' check (status in ('active','paused','cancelled')),
  note         text,
  created_by   uuid not null references ops_core.users(id),
  created_at   timestamptz not null default now(),
  constraint subscription_dates check (ends_on is null or ends_on >= start_on)
);

create index subscriptions_status_idx on ops_acct.subscriptions (status);

create table ops_acct.subscription_payments (
  id              uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references ops_acct.subscriptions(id) on delete restrict,
  -- The billing period it settles, `YYYY-MM` of the date it fell due.
  period          text not null check (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  paid_on         date not null,
  amount_idr      numeric not null check (amount_idr > 0),
  -- Null for a rupiah subscription.
  amount_usd      numeric check (amount_usd is null or amount_usd > 0),
  -- Derived at the seam, never typed: rupiah ÷ dollars, which is the rate
  -- the card really went at, bank margin included.
  fx_rate         numeric,
  note            text,
  recorded_by     uuid not null references ops_core.users(id),
  recorded_at     timestamptz not null default now(),
  unique (subscription_id, period)
);

create table ops_acct.subscription_settings (
  id          boolean primary key default true check (id),
  usd_idr     numeric not null default 19000 check (usd_idr > 0),
  updated_by  uuid references ops_core.users(id),
  updated_at  timestamptz not null default now()
);
insert into ops_acct.subscription_settings (id) values (true);

alter table ops_acct.subscriptions         enable row level security;
alter table ops_acct.subscription_payments enable row level security;
alter table ops_acct.subscription_settings enable row level security;

create policy subscriptions_read on ops_acct.subscriptions
  for select to authenticated using ((select ops_core.has_permission('accounting.read')));
create policy subscription_payments_read on ops_acct.subscription_payments
  for select to authenticated using ((select ops_core.has_permission('accounting.read')));
create policy subscription_settings_read on ops_acct.subscription_settings
  for select to authenticated using ((select ops_core.has_permission('accounting.read')));

-- Read-only to everybody: every write is a seam below.
grant select on ops_acct.subscriptions, ops_acct.subscription_payments,
                ops_acct.subscription_settings to authenticated;

-- ── save ─────────────────────────────────────────────────────────────────
create or replace function ops_acct.save_subscription(
  p_name text,
  p_cycle text,
  p_amount_kind text,
  p_currency text,
  p_amount numeric,
  p_start_on date,
  p_account_code text default null,
  p_login_email text default null,
  p_provider text default null,
  p_ends_on date default null,
  p_note text default null,
  p_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = ops_acct, ops_core, pg_temp as $$
declare v_account uuid; v_id uuid; v_no text;
begin
  if not ops_core.has_permission('accounting.update') then
    return ops_core.refused('accounting','subscription', p_name,'save',
      'not_permitted','Editing the subscription register needs accounting access.');
  end if;
  if coalesce(btrim(p_name), '') = '' then
    return ops_core.invalid('accounting','subscription', null,'save',
      'name_required','Name the service so somebody will recognise it.',
      jsonb_build_object('field','name'));
  end if;
  if p_cycle is null or p_cycle not in ('monthly','yearly','biennial') then
    return ops_core.invalid('accounting','subscription', p_name,'save',
      'cycle_invalid','Billed monthly, yearly or every two years.',
      jsonb_build_object('field','cycle'));
  end if;
  if p_amount_kind is null or p_amount_kind not in ('fixed','payg') then
    return ops_core.invalid('accounting','subscription', p_name,'save',
      'amount_kind_invalid','The price is either fixed or pay as you go.',
      jsonb_build_object('field','amount_kind'));
  end if;
  if p_currency is null or p_currency not in ('USD','IDR') then
    return ops_core.invalid('accounting','subscription', p_name,'save',
      'currency_invalid','Billed in USD or in IDR.',
      jsonb_build_object('field','currency'));
  end if;
  if p_amount is null or p_amount <= 0 then
    return ops_core.invalid('accounting','subscription', p_name,'save',
      'amount_required','Put the amount per billing — for pay as you go, the amount you expect.',
      jsonb_build_object('field','amount'));
  end if;
  if p_start_on is null then
    return ops_core.invalid('accounting','subscription', p_name,'save',
      'start_required','The date it is billed — its first billing, or the next one.',
      jsonb_build_object('field','start_on'));
  end if;
  if p_ends_on is not null and p_ends_on < p_start_on then
    return ops_core.invalid('accounting','subscription', p_name,'save',
      'end_before_start','It ends before it starts.',
      jsonb_build_object('field','ends_on'));
  end if;
  if p_account_code is not null then
    select id into v_account from ops_acct.accounts where code = p_account_code;
    if not found then
      return ops_core.invalid('accounting','subscription', p_name,'save',
        'no_such_account', format('There is no account %s.', p_account_code),
        jsonb_build_object('field','account_code'));
    end if;
  end if;

  if p_id is null then
    insert into ops_acct.subscriptions
      (name, provider, login_email, cycle, amount_kind, currency, amount, start_on,
       ends_on, account_id, note, created_by)
    values (btrim(p_name), nullif(btrim(p_provider), ''), nullif(btrim(p_login_email), ''),
            p_cycle, p_amount_kind, p_currency, p_amount, p_start_on, p_ends_on,
            v_account, nullif(btrim(p_note), ''), auth.uid())
    returning id, sub_no into v_id, v_no;
  else
    update ops_acct.subscriptions set
      name = btrim(p_name), provider = nullif(btrim(p_provider), ''),
      login_email = nullif(btrim(p_login_email), ''), cycle = p_cycle,
      amount_kind = p_amount_kind, currency = p_currency, amount = p_amount,
      start_on = p_start_on, ends_on = p_ends_on, account_id = v_account,
      note = nullif(btrim(p_note), '')
    where id = p_id
    returning id, sub_no into v_id, v_no;
    if v_id is null then
      return ops_core.not_found('accounting','subscription', p_id::text,'save','No such subscription.');
    end if;
  end if;

  return ops_core.ok('accounting','subscription', v_no,'save',
    jsonb_build_object('id', v_id, 'sub_no', v_no));
end $$;

-- ── pause, resume, cancel ────────────────────────────────────────────────
create or replace function ops_acct.set_subscription_status(p_id uuid, p_status text)
returns jsonb
language plpgsql security definer set search_path = ops_acct, ops_core, pg_temp as $$
declare v_no text; v_was text;
begin
  if not ops_core.has_permission('accounting.update') then
    return ops_core.refused('accounting','subscription', p_id::text,'status',
      'not_permitted','Editing the subscription register needs accounting access.');
  end if;
  if p_status is null or p_status not in ('active','paused','cancelled') then
    return ops_core.invalid('accounting','subscription', p_id::text,'status',
      'status_invalid','Active, paused or cancelled.', jsonb_build_object('field','status'));
  end if;
  select sub_no, status into v_no, v_was from ops_acct.subscriptions where id = p_id;
  if not found then
    return ops_core.not_found('accounting','subscription', p_id::text,'status','No such subscription.');
  end if;
  update ops_acct.subscriptions set status = p_status where id = p_id;
  return ops_core.ok('accounting','subscription', v_no,'status',
    jsonb_build_object('id', p_id, 'status', p_status), jsonb_build_object('status', v_was),
    jsonb_build_object('status', p_status));
end $$;

-- ── what was charged ─────────────────────────────────────────────────────
-- One per subscription per period: recording again for the same period
-- corrects it. The rate is rupiah ÷ dollars — what the card really charged.
create or replace function ops_acct.record_subscription_payment(
  p_id uuid, p_period text, p_paid_on date, p_amount_idr numeric,
  p_amount_usd numeric default null, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = ops_acct, ops_core, pg_temp as $$
declare s ops_acct.subscriptions; v_rate numeric; v_before jsonb;
begin
  if not ops_core.has_permission('accounting.update') then
    return ops_core.refused('accounting','subscription', p_id::text,'pay',
      'not_permitted','Recording a subscription payment needs accounting access.');
  end if;
  select * into s from ops_acct.subscriptions where id = p_id;
  if not found then
    return ops_core.not_found('accounting','subscription', p_id::text,'pay','No such subscription.');
  end if;
  if p_period is null or p_period !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    return ops_core.invalid('accounting','subscription', s.sub_no,'pay',
      'period_invalid','The month it was billed for, as YYYY-MM.', jsonb_build_object('field','period'));
  end if;
  if p_paid_on is null then
    return ops_core.invalid('accounting','subscription', s.sub_no,'pay',
      'paid_on_required','The day it was charged.', jsonb_build_object('field','paid_on'));
  end if;
  if p_amount_idr is null or p_amount_idr <= 0 then
    return ops_core.invalid('accounting','subscription', s.sub_no,'pay',
      'amount_required','The rupiah that actually left.', jsonb_build_object('field','amount_idr'));
  end if;
  if p_amount_usd is not null and p_amount_usd <= 0 then
    return ops_core.invalid('accounting','subscription', s.sub_no,'pay',
      'usd_invalid','The dollars charged must be more than zero.', jsonb_build_object('field','amount_usd'));
  end if;
  if s.currency = 'IDR' and p_amount_usd is not null then
    return ops_core.invalid('accounting','subscription', s.sub_no,'pay',
      'usd_on_idr','This one is billed in rupiah — there are no dollars to record.',
      jsonb_build_object('field','amount_usd'));
  end if;

  v_rate := case when p_amount_usd is null then null else round(p_amount_idr / p_amount_usd, 2) end;

  select to_jsonb(p) into v_before from ops_acct.subscription_payments p
   where p.subscription_id = p_id and p.period = p_period;

  insert into ops_acct.subscription_payments
    (subscription_id, period, paid_on, amount_idr, amount_usd, fx_rate, note, recorded_by)
  values (p_id, p_period, p_paid_on, p_amount_idr, p_amount_usd, v_rate,
          nullif(btrim(p_note), ''), auth.uid())
  on conflict (subscription_id, period) do update set
    paid_on = excluded.paid_on, amount_idr = excluded.amount_idr,
    amount_usd = excluded.amount_usd, fx_rate = excluded.fx_rate,
    note = excluded.note, recorded_by = excluded.recorded_by, recorded_at = now();

  return ops_core.ok('accounting','subscription', s.sub_no,'pay',
    jsonb_build_object('id', p_id, 'period', p_period, 'amount_idr', p_amount_idr,
                       'amount_usd', p_amount_usd, 'fx_rate', v_rate),
    v_before, jsonb_build_object('paid_on', p_paid_on, 'amount_idr', p_amount_idr,
                                 'amount_usd', p_amount_usd, 'fx_rate', v_rate));
end $$;

create or replace function ops_acct.remove_subscription_payment(p_id uuid, p_period text)
returns jsonb
language plpgsql security definer set search_path = ops_acct, ops_core, pg_temp as $$
declare v_no text; v_before jsonb;
begin
  if not ops_core.has_permission('accounting.update') then
    return ops_core.refused('accounting','subscription', p_id::text,'unpay',
      'not_permitted','Editing the subscription register needs accounting access.');
  end if;
  select sub_no into v_no from ops_acct.subscriptions where id = p_id;
  if not found then
    return ops_core.not_found('accounting','subscription', p_id::text,'unpay','No such subscription.');
  end if;
  select to_jsonb(p) into v_before from ops_acct.subscription_payments p
   where p.subscription_id = p_id and p.period = p_period;
  if v_before is null then
    return ops_core.not_found('accounting','subscription', v_no,'unpay','No payment recorded for that month.');
  end if;
  delete from ops_acct.subscription_payments where subscription_id = p_id and period = p_period;
  return ops_core.ok('accounting','subscription', v_no,'unpay',
    jsonb_build_object('id', p_id, 'period', p_period), v_before, null);
end $$;

-- ── the rate the plan uses ───────────────────────────────────────────────
create or replace function ops_acct.set_subscription_fx(p_rate numeric)
returns jsonb
language plpgsql security definer set search_path = ops_acct, ops_core, pg_temp as $$
declare v_was numeric;
begin
  if not ops_core.has_permission('accounting.plan_cash') then
    return ops_core.refused('accounting','subscription_fx', 'USD','set_rate',
      'not_permitted','The rate the plan converts dollars at is set by leadership.');
  end if;
  if p_rate is null or p_rate <= 0 then
    return ops_core.invalid('accounting','subscription_fx', 'USD','set_rate',
      'rate_invalid','Rupiah per dollar, more than zero.', jsonb_build_object('field','usd_idr'));
  end if;
  select usd_idr into v_was from ops_acct.subscription_settings where id;
  update ops_acct.subscription_settings
     set usd_idr = p_rate, updated_by = auth.uid(), updated_at = now() where id;
  return ops_core.ok('accounting','subscription_fx', 'USD','set_rate',
    jsonb_build_object('usd_idr', p_rate), jsonb_build_object('usd_idr', v_was),
    jsonb_build_object('usd_idr', p_rate));
end $$;

revoke execute on function
  ops_acct.save_subscription(text, text, text, text, numeric, date, text, text, text, date, text, uuid),
  ops_acct.set_subscription_status(uuid, text),
  ops_acct.record_subscription_payment(uuid, text, date, numeric, numeric, text),
  ops_acct.remove_subscription_payment(uuid, text),
  ops_acct.set_subscription_fx(numeric)
  from public;
grant execute on function
  ops_acct.save_subscription(text, text, text, text, numeric, date, text, text, text, date, text, uuid),
  ops_acct.set_subscription_status(uuid, text),
  ops_acct.record_subscription_payment(uuid, text, date, numeric, numeric, text),
  ops_acct.remove_subscription_payment(uuid, text),
  ops_acct.set_subscription_fx(numeric)
  to authenticated;

analyze ops_acct.subscriptions;
analyze ops_acct.subscription_payments;
analyze ops_acct.subscription_settings;
