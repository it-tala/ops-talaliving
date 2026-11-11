-- acct — the date of a ledger row corrected with Edit (0288, D446).
--
--   a row on the wrong day -> edit(p_trx_date, remark) -> ok; the number is
--     kept, the running balance re-orders by the new day, the audit carries
--     trx_date before/after and trx_no_kept
--   a transfer leg -> every live leg moves with it, each with its own trail
--   REFUSALS  no remark; a day after today; a row matched to a bank statement
--             line (also when only the other leg is matched)
--   noop      the same date again
--   positional  the twelve-argument call means what it meant before 0288

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-00000000e288','rina-date@talaliving.com','{"full_name":"Rina Date"}');
insert into ops_core.user_authorities (user_id, authority) values
  ('ffffffff-0000-0000-0000-00000000e288','post_ledger');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-00000000e288','accounting','write');

insert into ops_acct.accounts (code, name, custody, is_paying, currency, opening_balance, opened_on) values
  ('SMOKE DATE A', 'date a', 'accounting', true, 'IDR', 1000000, '2026-09-01'),
  ('SMOKE DATE B', 'date b', 'accounting', true, 'IDR', 0, '2026-09-01');

insert into ops_acct.transactions (id, trx_no, trx_date, account_id, direction, amount_idr,
                                   type_code, description, source_ref, posted_by, transfer_id)
select v.id::uuid, v.no, v.d::date, a.id, v.dir::ops_acct.direction_t, v.amt, v.ty, v.no, v.no,
       'ffffffff-0000-0000-0000-00000000e288', v.tf::uuid
  from (values
    -- trx-date-1 was typed 14 Oct; the money moved 2 Nov (the transfer proof's day).
    -- Every date is after ledger_balance_from() (12 Oct), where balances start.
    ('55550000-0000-0000-0000-000000028801','trx-date-1','2026-10-14','SMOKE DATE A','OUT', 100000,'SUPPLIERS', null),
    ('55550000-0000-0000-0000-000000028802','trx-date-2','2026-10-15','SMOKE DATE A','OUT', 200000,'SUPPLIERS', null),
    ('55550000-0000-0000-0000-000000028803','trx-date-3','2026-10-16','SMOKE DATE A','OUT',  50000,'SUPPLIERS', null),
    -- a transfer A -> B with its fee, one act (0282)
    ('55550000-0000-0000-0000-000000028804','trx-date-4','2026-10-20','SMOKE DATE A','OUT', 300000,'OTHERS','77770000-0000-0000-0000-000000028801'),
    ('55550000-0000-0000-0000-000000028805','trx-date-5','2026-10-20','SMOKE DATE B','IN',  300000,'OTHERS','77770000-0000-0000-0000-000000028801'),
    ('55550000-0000-0000-0000-000000028806','trx-date-6','2026-10-20','SMOKE DATE A','OUT',   2500,'BANK CHARGES','77770000-0000-0000-0000-000000028801'),
    -- a second transfer whose IN leg the bank statement already matched
    ('55550000-0000-0000-0000-000000028807','trx-date-7','2026-10-25','SMOKE DATE A','OUT', 400000,'OTHERS','77770000-0000-0000-0000-000000028802'),
    ('55550000-0000-0000-0000-000000028808','trx-date-8','2026-10-25','SMOKE DATE B','IN',  400000,'OTHERS','77770000-0000-0000-0000-000000028802')
  ) v(id, no, d, acct, dir, amt, ty, tf)
  join ops_acct.accounts a on a.code = v.acct;

insert into ops_acct.bank_statements (id, account_id, period_start, period_end, opening_balance,
                                      closing_balance, filename, uploaded_by, statement_no)
select '66660000-0000-0000-0000-000000028801', a.id, '2026-10-01', '2026-10-31', 0, 0, 'rk.pdf',
       'ffffffff-0000-0000-0000-00000000e288', 'st-date-1'
  from ops_acct.accounts a where a.code = 'SMOKE DATE A';
insert into ops_acct.bank_statements (id, account_id, period_start, period_end, opening_balance,
                                      closing_balance, filename, uploaded_by, statement_no)
select '66660000-0000-0000-0000-000000028802', a.id, '2026-10-01', '2026-10-31', 0, 0, 'rk-b.pdf',
       'ffffffff-0000-0000-0000-00000000e288', 'st-date-2'
  from ops_acct.accounts a where a.code = 'SMOKE DATE B';
insert into ops_acct.statement_lines (statement_id, line_no, value_date, direction, amount, amount_idr,
                                      raw_description, status, trx_no) values
  ('66660000-0000-0000-0000-000000028801', 1, '2026-10-16', 'OUT', 50000, 50000, 'TRSF', 'matched', 'trx-date-3'),
  ('66660000-0000-0000-0000-000000028802', 1, '2026-10-25', 'IN', 400000, 400000, 'TRSF', 'matched', 'trx-date-8');

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-00000000e288';

do $$
declare r jsonb; b record;
begin
  -- Before: trx-date-1 is the first row on A, 1.000.000 → 900.000.
  assert (select balance_after from ops_acct.v_transaction where trx_no = 'trx-date-1') = 900000, 'starting balance';

  r := ops_acct.edit_transaction('trx-date-1', p_trx_date => '2026-11-02');
  assert r -> 'error' ->> 'code' = 'reason_required', 'a date change needs a remark, got ' || r::text;
  assert r -> 'error' -> 'detail' ->> 'field' = 'reason', 'pointing at the remark';

  r := ops_acct.edit_transaction('trx-date-1', p_reason => 'x', p_trx_date => ops_core.office_day() + 1);
  assert r -> 'error' ->> 'code' = 'date_in_future', 'tomorrow has not happened, got ' || r::text;
  assert r -> 'error' -> 'detail' ->> 'field' = 'trx_date', 'pointing at the date';

  r := ops_acct.edit_transaction('trx-date-3', p_reason => 'x', p_trx_date => '2026-10-18');
  assert r -> 'error' ->> 'code' = 'statement_matched', 'the bank says which day, got ' || r::text;

  r := ops_acct.edit_transaction('trx-date-7', p_reason => 'x', p_trx_date => '2026-10-26');
  assert r -> 'error' ->> 'code' = 'statement_matched', 'the other leg is matched, got ' || r::text;
  assert (select trx_date from ops_acct.transactions where trx_no = 'trx-date-7') = '2026-10-25', 'nothing moved';

  r := ops_acct.edit_transaction('trx-date-1', p_trx_date => '2026-10-14');
  assert r ->> 'outcome' = 'noop', 'the same day again is a noop, got ' || r::text;

  r := ops_acct.edit_transaction('trx-date-1',
         p_reason => 'Bukti transfer 2 Nov, bukan tanggal nota', p_trx_date => '2026-11-02');
  assert r ->> 'outcome' = 'ok', 'the date should land, got ' || r::text;
  assert r -> 'data' ->> 'trx_date' = '2026-11-02', 'answered with the new day';
  assert r -> 'data' ->> 'trx_no' = 'trx-date-1', 'the number is kept';
  assert (select trx_date from ops_acct.transactions where trx_no = 'trx-date-1') = '2026-11-02', 'the row moved';
  assert (select count(*) from ops_acct.transactions where trx_no like 'trx-date-%') = 8, 'no row added';

  -- The balance re-orders: trx-date-2 is now A's first row (1.000.000 → 800.000).
  assert (select balance_after from ops_acct.v_transaction where trx_no = 'trx-date-2') = 800000,
    'the row after it is now first';
  select balance_before, balance_after into b from ops_acct.v_transaction where trx_no = 'trx-date-1';
  assert b.balance_before = 1000000 - 200000 - 50000 - 300000 - 2500 - 400000,
    format('trx-date-1 now after both transfers, got %s', b.balance_before);

  -- A transfer leg: all three legs move together.
  r := ops_acct.edit_transaction('trx-date-5', p_reason => 'Masuk di rekening B tgl 21 Okt', p_trx_date => '2026-10-21');
  assert r ->> 'outcome' = 'ok', 'got ' || r::text;
  assert (select count(*) from ops_acct.transactions
           where transfer_id = '77770000-0000-0000-0000-000000028801' and trx_date = '2026-10-21') = 3,
    'the OUT, the IN and the fee on one day';
end $$;

/* Positional, twelve arguments, as every caller wrote it before 0288: the
   twelfth is still the billed amount and the date is untouched. */
do $$
declare r jsonb;
begin
  r := ops_acct.edit_transaction('trx-date-2', null, 'deskripsi baru', null, null, null, null, null, null, null, null, null);
  assert r ->> 'outcome' = 'ok', 'positional call, got ' || r::text;
  assert (select description from ops_acct.transactions where trx_no = 'trx-date-2') = 'deskripsi baru', 'description by position';
  assert (select trx_date from ops_acct.transactions where trx_no = 'trx-date-2') = '2026-10-15', 'date untouched';
end $$;

set local role postgres;
do $$
declare a record; n int;
begin
  select * into a from ops_core.audit_log
   where entity_no = 'trx-date-1' and action = 'edit' and outcome = 'ok' order by id desc limit 1;
  assert a.before ->> 'trx_date' = '2026-10-14' and a.after ->> 'trx_date' = '2026-11-02', 'the trail has the two days';
  assert (a.detail ->> 'trx_no_kept')::boolean, 'and says the number was kept';
  assert a.reason = 'Bukti transfer 2 Nov, bukan tanggal nota', 'and the remark';

  select * into a from ops_core.audit_log
   where entity_no = 'trx-date-5' and action = 'edit' and outcome = 'ok' order by id desc limit 1;
  assert a.detail -> 'legs_moved' = '["trx-date-4","trx-date-6"]'::jsonb, format('the legs named, got %s', a.detail);

  select count(*) into n from ops_core.audit_log
   where entity_no in ('trx-date-4','trx-date-6') and action = 'edit' and outcome = 'ok'
     and detail ->> 'moved_with' = 'trx-date-5';
  assert n = 2, format('each leg its own trail row, got %s', n);
end $$;

rollback;
