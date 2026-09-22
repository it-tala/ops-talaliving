-- ops_acct.cash_plan() — the twelve-month projection, proved against a
-- scenario built to exercise every branch cashPlan() has: a monthly line
-- caught by category matching, a weekly line with a THR override spread
-- across its runs, a one-off naming a vendor, a skipped month, a settlement
-- link that wins over a category guess, an unplanned ledger row, and the
-- running balance actually going negative.
--
--   psql -h /tmp -p 5433 -U postgres -f supabase/local/smoke/86_acct_cash_plan.sql

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('cafe0001-0000-0000-0000-000000000001','tester@talaliving.com', '{"full_name":"Tester"}');

insert into ops_core.user_modules (user_id, module, level) values
  ('cafe0001-0000-0000-0000-000000000001','accounting','admin'),
  ('cafe0001-0000-0000-0000-000000000001','procurement','admin');

insert into ops_core.user_authorities (user_id, authority, granted_by) values
  ('cafe0001-0000-0000-0000-000000000001','post_ledger', 'cafe0001-0000-0000-0000-000000000001'),
  ('cafe0001-0000-0000-0000-000000000001','approve_funds', 'cafe0001-0000-0000-0000-000000000001');

set local role authenticated;
set local request.jwt.claim.sub = 'cafe0001-0000-0000-0000-000000000001';

insert into ops_procure.vendors (id, code, name, is_curated) values
  ('cafe0002-0000-0000-0000-000000000001','v-test','Vendor Test', true),
  ('cafe0002-0000-0000-0000-000000000002','v-other','Vendor Lain', true);

insert into ops_core.attachments (id, storage_path, filename, uploaded_by)
values ('cafe0004-0000-0000-0000-000000000001', 'f/dummy.jpg', 'dummy.jpg',
        'cafe0001-0000-0000-0000-000000000001');

select ops_acct.post_transaction(
  p_account_code => 'BCA 271', p_direction => 'IN', p_amount => 100000000,
  p_type_code => 'CASHFLOW', p_description => 'Modal awal',
  p_documents => jsonb_build_array(jsonb_build_object(
    'attachment_id', 'cafe0004-0000-0000-0000-000000000001', 'kind', 'nota')),
  p_trx_date => current_date - 90);

-- Monthly: office rent, due the 5th.
insert into ops_acct.cash_components
  (id, name, direction, amount, frequency, due_day, type_code, account_id, starts_on, active, created_by)
select 'cafe0003-0000-0000-0000-000000000001', 'Sewa kantor', 'OUT', 5000000, 'monthly', 5,
       'OFFICE', (select id from ops_acct.accounts where code = 'BCA 271'),
       to_char(current_date - interval '3 months', 'YYYY-MM'), true,
       'cafe0001-0000-0000-0000-000000000001';

-- Weekly: production payroll, Fridays.
insert into ops_acct.cash_components
  (id, name, direction, amount, frequency, due_weekday, type_code, starts_on, active, created_by)
select 'cafe0003-0000-0000-0000-000000000002', 'Payroll produksi', 'OUT', 2000000, 'weekly', 5,
       'RECCURING - PAYROLL WEEKLY', to_char(current_date - interval '3 months', 'YYYY-MM'), true,
       'cafe0001-0000-0000-0000-000000000001';

-- Once: a one-off this month, naming a vendor.
insert into ops_acct.cash_components
  (id, name, direction, amount, frequency, due_date, vendor_id, starts_on, active, created_by)
select 'cafe0003-0000-0000-0000-000000000003', 'Bonus proyek', 'OUT', 10000000, 'once',
       date_trunc('month', current_date)::date + 14,
       'cafe0002-0000-0000-0000-000000000001',
       to_char(current_date, 'YYYY-MM'), true,
       'cafe0001-0000-0000-0000-000000000001';

-- This month's rent, paid on the due date — a different vendor than "Bonus
-- proyek" names, so only the category match (type_code = OFFICE) can find
-- it, proving claim order does not let the one-off steal a plain category's
-- row just because it runs first.
select ops_acct.post_transaction(
  p_account_code => 'BCA 271', p_direction => 'OUT', p_amount => 5000000,
  p_type_code => 'OFFICE', p_description => 'Sewa kantor bulan ini', p_vendor_code => 'v-other',
  p_documents => jsonb_build_array(jsonb_build_object(
    'attachment_id', 'cafe0004-0000-0000-0000-000000000001', 'kind', 'nota')),
  p_lines => jsonb_build_array(jsonb_build_object(
    'description', 'Sewa bulanan', 'qty', 1, 'unit_price', 5000000, 'amount', 5000000)),
  p_trx_date => date_trunc('month', current_date)::date + 4);

-- An unplanned OUT: a different vendor and type from every component above.
select ops_acct.post_transaction(
  p_account_code => 'BCA 271', p_direction => 'OUT', p_amount => 750000,
  p_type_code => 'TRANSPORT', p_description => 'Ongkos kirim mendadak', p_vendor_code => 'v-other',
  p_documents => jsonb_build_array(jsonb_build_object(
    'attachment_id', 'cafe0004-0000-0000-0000-000000000001', 'kind', 'nota')),
  p_lines => jsonb_build_array(jsonb_build_object(
    'description', 'Ojek kirim dokumen', 'qty', 1, 'unit_price', 750000, 'amount', 750000)),
  p_trx_date => current_date);

-- Skip next month's rent (renovation) — SKIPPED, not OVERDUE or PLANNED.
insert into ops_acct.cash_overrides (component_id, month, amount, reason, recorded_by)
values ('cafe0003-0000-0000-0000-000000000001', to_char(current_date + interval '1 month', 'YYYY-MM'),
        null, 'Dibebaskan sewa bulan ini (renovasi)', 'cafe0001-0000-0000-0000-000000000001');

-- Pay the month-after-next's rent early, and link it by settlement rather
-- than letting the category matcher find it — proves a linked match beats
-- distance-based guessing and is labelled 'linked', not 'category'. Posted
-- as OTHERS, not OFFICE: the settlement link does not filter by category at
-- all (it names a trx_no directly), and OFFICE would additionally let
-- September's monthly sweep claim it before the link ever gets a say,
-- muddying exactly the branch this fixture means to isolate.
select ops_acct.post_transaction(
  p_account_code => 'BCA 271', p_direction => 'OUT', p_amount => 5000000,
  p_type_code => 'OTHERS', p_description => 'Sewa kantor - dibayar lebih awal', p_vendor_code => 'v-other',
  p_documents => jsonb_build_array(jsonb_build_object(
    'attachment_id', 'cafe0004-0000-0000-0000-000000000001', 'kind', 'nota')),
  p_lines => jsonb_build_array(jsonb_build_object(
    'description', 'Sewa bulanan', 'qty', 1, 'unit_price', 5000000, 'amount', 5000000)),
  p_trx_date => current_date);

insert into ops_acct.cash_settlements (component_id, month, trx_no, recorded_by)
select 'cafe0003-0000-0000-0000-000000000001', to_char(current_date + interval '2 months', 'YYYY-MM'),
       trx_no, 'cafe0001-0000-0000-0000-000000000001'
  from ops_acct.transactions
 where description = 'Sewa kantor - dibayar lebih awal';

-- December carries the THR: four Fridays at 2,000,000 would be 8,000,000;
-- the override says the month totals 16,000,000, so the difference
-- (8,000,000) lands entirely on the last Friday (D114).
insert into ops_acct.cash_overrides (component_id, month, amount, reason, recorded_by)
values ('cafe0003-0000-0000-0000-000000000002', to_char(current_date + interval '3 months', 'YYYY-MM'),
        16000000, 'THR', 'cafe0001-0000-0000-0000-000000000001');

do $$
declare
  plan jsonb; months jsonb; rows_ jsonb; unplanned jsonb;
  sewa jsonb; payroll jsonb; bonus jsonb;
  this_month text := to_char(current_date, 'YYYY-MM');
  next_month text := to_char(current_date + interval '1 month', 'YYYY-MM');
  month_after text := to_char(current_date + interval '2 months', 'YYYY-MM');
  december text := to_char(current_date + interval '3 months', 'YYYY-MM');
begin
  plan := ops_acct.cash_plan();

  assert (plan ->> 'generated_for') = current_date::text, format('got %s', plan ->> 'generated_for');
  -- 100,000,000 funded, less this month's rent (5,000,000), the unplanned
  -- transport row (750,000), and the early rent paid against next-next
  -- month (5,000,000).
  assert (plan ->> 'opening_cash')::numeric = 89250000, format('got %s', plan ->> 'opening_cash');
  assert jsonb_array_length(plan -> 'months') = 12, format('got %s months', jsonb_array_length(plan -> 'months'));

  rows_ := plan -> 'rows';
  assert jsonb_array_length(rows_) = 3, format('three active components, got %s', jsonb_array_length(rows_));

  select r into sewa from jsonb_array_elements(rows_) r where r -> 'component' ->> 'name' = 'Sewa kantor';
  select r into payroll from jsonb_array_elements(rows_) r where r -> 'component' ->> 'name' = 'Payroll produksi';
  select r into bonus from jsonb_array_elements(rows_) r where r -> 'component' ->> 'name' = 'Bonus proyek';

  -- This month's rent: paid by category, not stolen by the one-off that
  -- runs first in claim order.
  declare c jsonb; begin
    select cell into c from jsonb_array_elements(sewa -> 'cells') cell where cell ->> 'month' = this_month;
    assert (c ->> 'state') = 'PAID', format('got %s', c ->> 'state');
    assert (c ->> 'actual')::numeric = 5000000, format('got %s', c ->> 'actual');
    assert (c -> 'events' -> 0 ->> 'matched_by') = 'category', format('got %s', c -> 'events' -> 0 ->> 'matched_by');
  end;

  -- Next month's rent: skipped, with the reason carried through.
  declare c jsonb; begin
    select cell into c from jsonb_array_elements(sewa -> 'cells') cell where cell ->> 'month' = next_month;
    assert (c ->> 'state') = 'SKIPPED', format('got %s', c ->> 'state');
    assert (c ->> 'planned')::numeric = 0, format('got %s', c ->> 'planned');
    assert (c ->> 'reason') = 'Dibebaskan sewa bulan ini (renovasi)', format('got %s', c ->> 'reason');
  end;

  -- The month after: paid early, found by the settlement link rather than
  -- distance, and labelled accordingly.
  declare c jsonb; begin
    select cell into c from jsonb_array_elements(sewa -> 'cells') cell where cell ->> 'month' = month_after;
    assert (c ->> 'state') = 'PAID', format('got %s', c ->> 'state');
    assert (c ->> 'matched_by') = 'linked', format('got %s', c ->> 'matched_by');
  end;

  -- December's payroll: the THR spread, remainder on the last Friday.
  declare c jsonb; evs jsonb; last_ev jsonb; begin
    select cell into c from jsonb_array_elements(payroll -> 'cells') cell where cell ->> 'month' = december;
    assert (c ->> 'planned')::numeric = 16000000, format('got %s', c ->> 'planned');
    evs := c -> 'events';
    assert jsonb_array_length(evs) = 4, format('four Fridays in this December, got %s', jsonb_array_length(evs));
    last_ev := evs -> (jsonb_array_length(evs) - 1);
    assert (last_ev ->> 'planned')::numeric = 10000000,
      format('base 2,000,000 plus the 8,000,000 difference, got %s', last_ev ->> 'planned');
    assert (last_ev ->> 'carries_override')::boolean, 'the run carrying the override should say so';
    assert not (evs -> 0 ->> 'carries_override')::boolean, 'only the last run carries it';
  end;

  -- The one-off, still unpaid, does not appear in the unplanned money —
  -- unplanned is only for ledger rows nothing claimed.
  assert (bonus -> 'cells' -> 0 ->> 'state') = 'OVERDUE', format('got %s', bonus -> 'cells' -> 0 ->> 'state');

  -- The transport row: nothing claims it, so it shows up as unplanned money
  -- this month and nowhere in `_claimed`.
  select u into unplanned from jsonb_array_elements(plan -> 'unplanned') u where u ->> 'month' = this_month;
  assert (unplanned ->> 'amount')::numeric = 750000,
    format('only the transport row is unclaimed this month — a higher figure means the rent leaked in too, got %s',
           unplanned ->> 'amount');
  assert jsonb_array_length(unplanned -> 'trx_nos') = 1, format('got %s', unplanned -> 'trx_nos');

  -- The plan runs out of money on this fixture — no income planned against a
  -- monthly rent, a weekly payroll and a one-off bonus.
  assert (plan ->> 'short_month') is not null, 'this fixture spends without ever earning; the plan should go negative';
  assert (plan ->> 'short_by')::numeric > 0, format('got %s', plan ->> 'short_by');

  assert (plan ->> 'undated_obligations')::numeric = 0, 'no procurement orders in this fixture, so nothing owed';
end $$;

rollback;
