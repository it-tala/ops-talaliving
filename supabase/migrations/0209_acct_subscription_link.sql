-- 0209_acct_subscription_link.sql — a subscription billing can be settled by a
-- ledger row, as a calendar component can.
--
-- `0208` settles a billing by a payment recorded on the subscription. When the
-- money did go through an account that is in the ledger, that row exists
-- already, and recording the figure a second time would have the same payment
-- twice: once in the ledger (and so in the opening cash, and under *Tidak ada di
-- rencana*) and once on the subscription.
--
-- So the payment can instead **point at the ledger row**: `trx_no`. The amount
-- and the day are the row's own, the row is spoken for (it is not a second
-- payment, and the plan stops listing it as one that nobody planned), and the
-- status is the same PAID whichever way it was settled. One ledger row settles
-- one billing, here or on a component, never both (D112).
--
--   link_subscription_payment   point a billing at a ledger row
--   record_subscription_payment now refuses to overwrite a linked payment —
--                               its figures are the ledger's, not ours; remove
--                               the link first
--   remove_subscription_payment unchanged, and is also how a link is undone

alter table ops_acct.subscription_payments add column trx_no text;
create unique index subscription_payments_trx_uq
  on ops_acct.subscription_payments (trx_no) where trx_no is not null;

create or replace function ops_acct.link_subscription_payment(
  p_id uuid, p_period text, p_trx_no text)
returns jsonb
language plpgsql security definer set search_path = ops_acct, ops_core, pg_temp as $$
declare s ops_acct.subscriptions; t ops_acct.transactions; v_before jsonb;
begin
  if not ops_core.has_permission('accounting.update') then
    return ops_core.refused('accounting','subscription', p_id::text,'link',
      'not_permitted','Linking a payment needs accounting access.');
  end if;
  select * into s from ops_acct.subscriptions where id = p_id;
  if not found then
    return ops_core.not_found('accounting','subscription', p_id::text,'link','No such subscription.');
  end if;
  if p_period is null or p_period !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    return ops_core.invalid('accounting','subscription', s.sub_no,'link',
      'period_invalid','The month it was billed for, as YYYY-MM.', jsonb_build_object('field','period'));
  end if;
  select * into t from ops_acct.transactions where trx_no = p_trx_no;
  if not found then
    return ops_core.not_found('accounting','subscription', s.sub_no,'link',
      format('There is no ledger row %s.', p_trx_no));
  end if;
  if t.status = 'VOID' then
    return ops_core.invalid('accounting','subscription', s.sub_no,'link',
      'transaction_void','That row was voided. A voided payment settles nothing.',
      jsonb_build_object('field','trx_no'));
  end if;
  if t.direction <> 'OUT' then
    return ops_core.invalid('accounting','subscription', s.sub_no,'link',
      'not_a_payment','That row is money coming in. A subscription is paid out.',
      jsonb_build_object('field','trx_no'));
  end if;
  if exists (select 1 from ops_acct.cash_settlements where trx_no = p_trx_no)
     or exists (select 1 from ops_acct.subscription_payments
                 where trx_no = p_trx_no and not (subscription_id = p_id and period = p_period)) then
    return ops_core.conflict('accounting','subscription', s.sub_no,'link',
      'already_linked',
      'That payment is already on the calendar against another line. One row, one bill.',
      jsonb_build_object('field','trx_no'));
  end if;

  select to_jsonb(p) into v_before from ops_acct.subscription_payments p
   where p.subscription_id = p_id and p.period = p_period;

  insert into ops_acct.subscription_payments
    (subscription_id, period, paid_on, amount_idr, amount_usd, fx_rate, trx_no, recorded_by)
  values (p_id, p_period, t.trx_date, t.amount_idr, null, null, p_trx_no, auth.uid())
  on conflict (subscription_id, period) do update set
    paid_on = excluded.paid_on, amount_idr = excluded.amount_idr, amount_usd = null,
    fx_rate = null, trx_no = excluded.trx_no, recorded_by = excluded.recorded_by, recorded_at = now();

  return ops_core.ok('accounting','subscription', s.sub_no,'link',
    jsonb_build_object('id', p_id, 'period', p_period, 'trx_no', p_trx_no, 'amount_idr', t.amount_idr),
    v_before, jsonb_build_object('trx_no', p_trx_no, 'paid_on', t.trx_date, 'amount_idr', t.amount_idr));
end $$;

-- `0208`'s body with one guard: a payment that is a ledger row is not ours to
-- retype.
create or replace function ops_acct.record_subscription_payment(
  p_id uuid, p_period text, p_paid_on date, p_amount_idr numeric,
  p_amount_usd numeric default null, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = ops_acct, ops_core, pg_temp as $$
declare s ops_acct.subscriptions; v_rate numeric; v_before jsonb; v_linked text;
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

  select trx_no into v_linked from ops_acct.subscription_payments
   where subscription_id = p_id and period = p_period;
  if v_linked is not null then
    return ops_core.conflict('accounting','subscription', s.sub_no,'pay',
      'linked_to_ledger',
      format('That billing is settled by ledger row %s, whose figures are the ledger''s. Remove the link first to record it by hand.', v_linked),
      jsonb_build_object('trx_no', v_linked));
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

-- A ledger row that is already on a subscription is not on a component either.
-- `link_cash_payment` (0022) only knew its own table; this is the other half.
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
  if existing is not null
     or exists (select 1 from ops_acct.subscription_payments where trx_no = p_trx_no) then
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

revoke execute on function ops_acct.link_subscription_payment(uuid, text, text) from public;
grant execute on function ops_acct.link_subscription_payment(uuid, text, text) to authenticated;
