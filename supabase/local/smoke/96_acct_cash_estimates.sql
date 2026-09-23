-- ops_acct — fixed amounts and estimates on the payment calendar (0114).
--
--   REFUSALS     an amount kind that is neither fixed nor an estimate
--   DERIVATIONS  a new line is fixed unless it says otherwise; an update with
--                no kind keeps the one it has; an estimate paid below its
--                guess is PAID in cash_plan(), cash_events() and v_cash_cell,
--                where a fixed line paid short is PARTIAL; the events carry
--                the kind; cash_plan() anchors its window at p_from

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('cafe9601-0000-0000-0000-000000000001','est-tester@talaliving.com','{"full_name":"Est Tester"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('cafe9601-0000-0000-0000-000000000001','accounting','admin');
insert into ops_core.user_authorities (user_id, authority, granted_by) values
  ('cafe9601-0000-0000-0000-000000000001','post_ledger','cafe9601-0000-0000-0000-000000000001');
insert into ops_core.attachments (id, storage_path, filename, uploaded_by) values
  ('cafe9604-0000-0000-0000-000000000001','f/nota.jpg','nota.jpg','cafe9601-0000-0000-0000-000000000001');

insert into ops_procure.vendors (id, code, name, is_curated) values
  ('cafe9602-0000-0000-0000-000000000001','v-gudang','Pemilik Gudang', true);

set local role authenticated;
set local request.jwt.claim.sub = 'cafe9601-0000-0000-0000-000000000001';

do $$
declare r jsonb; v_est uuid; v_fix uuid; this_month text := to_char(current_date, 'YYYY-MM');
begin
  r := ops_acct.save_cash_component('Listrik', 4200000, 'monthly', 'OUT', 1, p_amount_kind => 'guess');
  assert r -> 'error' ->> 'code' = 'amount_kind_invalid', 'bad kind refused, got ' || r::text;

  r := ops_acct.save_cash_component('Listrik bengkel', 4200000, 'monthly', 'OUT', 1,
         p_type_code => 'RECCURING - UTILITIES', p_account_code => 'BCA 271',
         p_starts_on => this_month, p_amount_kind => 'estimate');
  assert r ->> 'outcome' = 'ok' and r -> 'data' ->> 'amount_kind' = 'estimate', 'estimate saved, got ' || r::text;
  v_est := (r -> 'data' ->> 'component_id')::uuid;

  r := ops_acct.save_cash_component('Sewa gudang', 5000000, 'monthly', 'OUT', 1,
         p_type_code => 'OFFICE', p_account_code => 'BCA 271', p_starts_on => this_month);
  assert r ->> 'outcome' = 'ok' and r -> 'data' ->> 'amount_kind' = 'fixed', 'fixed by default, got ' || r::text;
  v_fix := (r -> 'data' ->> 'component_id')::uuid;

  -- An update that says nothing about the kind keeps it.
  r := ops_acct.save_cash_component('Listrik bengkel', 4300000, 'monthly', 'OUT', 1,
         p_type_code => 'RECCURING - UTILITIES', p_account_code => 'BCA 271',
         p_starts_on => this_month, p_id => v_est);
  assert r ->> 'outcome' = 'ok', 'update, got ' || r::text;
  assert (select amount_kind from ops_acct.cash_components where id = v_est) = 'estimate', 'kind kept on update';
  r := ops_acct.save_cash_component('Listrik bengkel', 4200000, 'monthly', 'OUT', 1,
         p_type_code => 'RECCURING - UTILITIES', p_account_code => 'BCA 271',
         p_starts_on => this_month, p_id => v_est);
  assert r ->> 'outcome' = 'ok', 'back to the guess, got ' || r::text;
end $$;

-- Both bills paid short this month.
select ops_acct.post_transaction(
  p_account_code => 'BCA 271', p_direction => 'IN', p_amount => 50000000,
  p_type_code => 'CASHFLOW', p_description => 'Modal',
  p_documents => jsonb_build_array(jsonb_build_object(
    'attachment_id', 'cafe9604-0000-0000-0000-000000000001', 'kind', 'nota')),
  p_trx_date => date_trunc('month', current_date)::date);
select ops_acct.post_transaction(
  p_account_code => 'BCA 271', p_direction => 'OUT', p_amount => 3900000,
  p_type_code => 'RECCURING - UTILITIES', p_description => 'PLN bulan ini',
  p_documents => jsonb_build_array(jsonb_build_object(
    'attachment_id', 'cafe9604-0000-0000-0000-000000000001', 'kind', 'nota')),
  p_trx_date => date_trunc('month', current_date)::date);
select ops_acct.post_transaction(
  p_account_code => 'BCA 271', p_direction => 'OUT', p_amount => 4000000,
  p_type_code => 'OFFICE', p_description => 'Sewa gudang sebagian', p_vendor_code => 'v-gudang',
  p_documents => jsonb_build_array(jsonb_build_object(
    'attachment_id', 'cafe9604-0000-0000-0000-000000000001', 'kind', 'nota')),
  p_lines => jsonb_build_array(jsonb_build_object(
    'description', 'Sewa gudang', 'qty', 1, 'unit_price', 4000000, 'amount', 4000000)),
  p_trx_date => date_trunc('month', current_date)::date);

do $$
declare
  plan jsonb; est jsonb; fix jsonb; ev jsonb;
  this_month text := to_char(current_date, 'YYYY-MM');
  prev_month text := to_char(current_date - interval '1 month', 'YYYY-MM');
  s text;
begin
  plan := ops_acct.cash_plan();
  select c into est from jsonb_array_elements(
    (select r -> 'cells' from jsonb_array_elements(plan -> 'rows') r where r -> 'component' ->> 'name' = 'Listrik bengkel')) c
   where c ->> 'month' = this_month;
  select c into fix from jsonb_array_elements(
    (select r -> 'cells' from jsonb_array_elements(plan -> 'rows') r where r -> 'component' ->> 'name' = 'Sewa gudang')) c
   where c ->> 'month' = this_month;

  assert est ->> 'state' = 'PAID' and (est ->> 'actual')::numeric = 3900000,
    'estimate paid under its guess is PAID, got ' || est::text;
  assert fix ->> 'state' = 'PARTIAL', 'fixed paid short is PARTIAL, got ' || fix::text;
  ev := est -> 'events' -> 0;
  assert ev ->> 'amount_kind' = 'estimate' and ev ->> 'state' = 'PAID', 'event carries the kind, got ' || ev::text;
  assert (select r -> 'component' ->> 'amount_kind' from jsonb_array_elements(plan -> 'rows') r
           where r -> 'component' ->> 'name' = 'Sewa gudang') = 'fixed', 'component carries the kind';

  -- Anchored a month back, the window starts there.
  plan := ops_acct.cash_plan(now(), (date_trunc('month', current_date) - interval '1 month')::date);
  assert plan -> 'months' -> 0 ->> 'month' = prev_month, 'window from p_from, got ' || (plan -> 'months' -> 0)::text;
  assert jsonb_array_length(plan -> 'months') = 12, 'still twelve months';

  -- The older readers agree.
  select state::text into s from ops_acct.v_cash_cell where name = 'Listrik bengkel' and month = this_month;
  assert s = 'PAID', 'v_cash_cell estimate PAID, got ' || coalesce(s, 'null');
  select state::text into s from ops_acct.v_cash_cell where name = 'Sewa gudang' and month = this_month;
  assert s = 'PARTIAL', 'v_cash_cell fixed PARTIAL, got ' || coalesce(s, 'null');
end $$;

rollback;
