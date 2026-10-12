-- acct — IN/OUT corrected with Edit (0269, D430).
--
--   a row typed OUT that was money in -> edit(direction IN, remark) -> ok;
--     the balance after it moves by twice its amount (0268), the audit
--     carries direction before/after
--   REFUSALS  no remark; not IN or OUT; a row paying a request line; a row
--             matched to a bank statement line

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-00000000e268','rina-dir@talaliving.com','{"full_name":"Rina Dir"}');
insert into ops_core.user_authorities (user_id, authority) values
  ('ffffffff-0000-0000-0000-00000000e268','post_ledger');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-00000000e268','accounting','write');

insert into ops_acct.accounts (code, name, custody, is_paying, currency, opening_balance, opened_on)
values ('SMOKE DIR', 'direction', 'accounting', true, 'IDR', 1000000, '2026-10-01');

insert into ops_acct.transactions (id, trx_no, trx_date, account_id, direction, amount_idr,
                                   type_code, description, source_ref, posted_by)
select v.id::uuid, v.no, v.d::date, a.id, 'OUT', v.amt, 'SUPPLIERS', v.no, v.no,
       'ffffffff-0000-0000-0000-00000000e268'
  from ops_acct.accounts a,
       (values ('55550000-0000-0000-0000-000000026901','trx-dir-1','2026-10-12', 200000),
               ('55550000-0000-0000-0000-000000026902','trx-dir-2','2026-10-13', 100000),
               ('55550000-0000-0000-0000-000000026903','trx-dir-3','2026-10-13', 300000),
               ('55550000-0000-0000-0000-000000026904','trx-dir-4','2026-10-13',  50000)) v(id, no, d, amt)
 where a.code = 'SMOKE DIR';

insert into ops_acct.payment_allocations (trx_id, pr_line_no, amount, allocated_by) values
  ('55550000-0000-0000-0000-000000026903','pr-26-10-13_01-L01', 300000,'ffffffff-0000-0000-0000-00000000e268');

insert into ops_acct.bank_statements (id, account_id, period_start, period_end, opening_balance,
                                      closing_balance, filename, uploaded_by, statement_no)
select '66660000-0000-0000-0000-000000026901', a.id, '2026-10-01', '2026-10-31', 0, 0, 'rk.pdf',
       'ffffffff-0000-0000-0000-00000000e268', 'st-dir-1'
  from ops_acct.accounts a where a.code = 'SMOKE DIR';
insert into ops_acct.statement_lines (statement_id, line_no, value_date, direction, amount, amount_idr,
                                      raw_description, status, trx_no)
values ('66660000-0000-0000-0000-000000026901', 1, '2026-10-13', 'OUT', 50000, 50000,
        'TRSF', 'matched', 'trx-dir-4');

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-00000000e268';

do $$
declare r jsonb; b record;
begin
  -- 1.000.000 − 200.000 = 800.000; trx-dir-2 takes it to 700.000.
  assert (select balance_after from ops_acct.v_transaction where trx_no = 'trx-dir-2') = 700000,
    'starting balance';

  r := ops_acct.edit_transaction('trx-dir-1', p_direction => 'IN');
  assert r -> 'error' ->> 'code' = 'reason_required', 'IN/OUT needs a remark, got ' || coalesce(r -> 'error' ->> 'code', r ->> 'outcome');

  r := ops_acct.edit_transaction('trx-dir-1', p_reason => 'x', p_direction => 'MASUK');
  assert r -> 'error' ->> 'code' = 'no_such_direction', 'got ' || coalesce(r -> 'error' ->> 'code', r ->> 'outcome');

  r := ops_acct.edit_transaction('trx-dir-3', p_reason => 'x', p_direction => 'IN');
  assert r -> 'error' ->> 'code' = 'direction_allocated', 'a row paying a line stays OUT, got ' || coalesce(r -> 'error' ->> 'code', r ->> 'outcome');

  r := ops_acct.edit_transaction('trx-dir-4', p_reason => 'x', p_direction => 'IN');
  assert r -> 'error' ->> 'code' = 'statement_matched', 'the bank says which way, got ' || coalesce(r -> 'error' ->> 'code', r ->> 'outcome');

  r := ops_acct.edit_transaction('trx-dir-1', p_reason => 'uang masuk, salah pilih OUT', p_direction => 'in');
  assert r ->> 'outcome' = 'ok', 'flip should land, got ' || r::text;
  assert (select direction from ops_acct.transactions where trx_no = 'trx-dir-1') = 'IN', 'the row is IN';

  select balance_before, balance_after into b from ops_acct.v_transaction where trx_no = 'trx-dir-1';
  assert b.balance_before = 1000000 and b.balance_after = 1200000, 'the row itself now adds';
  assert (select balance_after from ops_acct.v_transaction where trx_no = 'trx-dir-2') = 1100000,
    'the row after it moves by twice the amount';

  r := ops_acct.edit_transaction('trx-dir-1', p_direction => 'IN');
  assert r ->> 'outcome' = 'noop', 'the same direction again is a noop, got ' || (r ->> 'outcome');
end $$;

set local role postgres;
do $$
declare a record;
begin
  select * into a from ops_core.audit_log
   where entity_no = 'trx-dir-1' and action = 'edit' and outcome = 'ok' order by at desc limit 1;
  assert a.before ->> 'direction' = 'OUT' and a.after ->> 'direction' = 'IN', 'the trail has OUT → IN';
  assert a.reason = 'uang masuk, salah pilih OUT', 'and the remark';
end $$;

rollback;
