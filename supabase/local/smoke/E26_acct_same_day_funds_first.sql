-- acct — a day's money in comes before that day's money out (0301, D459).
--
-- A row's number is minted when it is recorded, so a transfer recorded late
-- carries a higher number than the payments it paid for on the same day. The
-- running balance, a fund's window and the GL OPS sheet all count the day's
-- IN rows first:
--   * the payments on the fund's day never dip below zero
--   * they belong to that fund's window, not to the fund before it
--   * two funds on one day leave the first with an empty window
--   * an anchored account keeps (date, number): its readings name a row

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-00000000e301','acc-sd@talaliving.com','{"full_name":"Acc SD"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-00000000e301','accounting','read');

insert into ops_acct.accounts (code, name, custody, is_paying, currency, opening_balance, opened_on)
values ('SMOKE SD', 'same day', 'accounting', true, 'IDR', 100000, '2026-10-01');

update ops_core.settings set value = '"2026-10-01"' where key = 'ledger_balance_from';

-- Fund A on the 2nd. On the 5th three payments are recorded first (numbers
-- 001–003), and the fund that paid for them only afterwards (009). On the
-- 7th two funds land on one day, then one payment.
insert into ops_acct.transactions (trx_no, trx_date, account_id, direction, amount_idr,
                                   type_code, description, source_ref, posted_by, category_override)
select v.trx_no, v.trx_date::date, a.id, v.direction::ops_acct.direction_t, v.amount,
       'CASHFLOW', v.trx_no, v.trx_no, 'ffffffff-0000-0000-0000-00000000e301',
       case when v.direction = 'IN' then 'transfer'::ops_acct.category_t end
  from ops_acct.accounts a,
       (values ('trx-sd-02_001', '2026-10-02', 'IN',  1000000),
               ('trx-sd-02_002', '2026-10-02', 'OUT',  900000),
               ('trx-sd-05_001', '2026-10-05', 'OUT', 3000000),
               ('trx-sd-05_002', '2026-10-05', 'OUT',  500000),
               ('trx-sd-05_003', '2026-10-05', 'OUT',    2500),
               ('trx-sd-05_009', '2026-10-05', 'IN',  5000000),
               ('trx-sd-07_001', '2026-10-07', 'IN',   200000),
               ('trx-sd-07_002', '2026-10-07', 'IN',   300000),
               ('trx-sd-07_003', '2026-10-07', 'OUT',  400000)) v(trx_no, trx_date, direction, amount)
 where a.code = 'SMOKE SD';

-- the running balance
do $$
declare b record;
begin
  select balance_before, balance_after into b from ops_acct.v_transaction where trx_no = 'trx-sd-05_009';
  assert b.balance_before = 200000 and b.balance_after = 5200000,
    format('the late-recorded fund counts before the day''s payments, got %s → %s', b.balance_before, b.balance_after);
  select balance_before, balance_after into b from ops_acct.v_transaction where trx_no = 'trx-sd-05_001';
  assert b.balance_before = 5200000 and b.balance_after = 2200000, format('first payment of the 5th, got %s', b.balance_after);
  assert not exists (select 1 from ops_acct.v_transaction v join ops_acct.accounts a on a.id = v.account_id
                      where a.code = 'SMOKE SD' and v.balance_after < 0),
    'no row on the account dips below zero';
  select balance_after into b from ops_acct.v_transaction where trx_no = 'trx-sd-05_003';
  assert b.balance_after = 1697500, format('within a side, number order still holds, got %s', b.balance_after);
  assert (select balance from ops_acct.v_account_balance v join ops_acct.accounts a on a.id = v.account_id where a.code = 'SMOKE SD')
       = (select balance_after from ops_acct.v_transaction where trx_no = 'trx-sd-07_003'),
    'the last row still agrees with v_account_balance';
end $$;

-- a fund's window
do $$
declare r record;
begin
  select * into r from ops_acct.v_funding where trx_no = 'trx-sd-02_001';
  assert r.next_funding_no = 'trx-sd-05_009' and r.window_end = '2026-10-05', format('window of A, got %s %s', r.next_funding_no, r.window_end);
  assert r.spent_total = 900000, format('A paid only its own day''s 900k, not the 5th''s payments, got %s', r.spent_total);
  assert r.balance_before = 100000, format('A landed on the opening balance, got %s', r.balance_before);

  select * into r from ops_acct.v_funding where trx_no = 'trx-sd-05_009';
  assert r.spent_total = 3502500, format('the late-recorded fund paid the 5th''s payments, got %s', r.spent_total);
  assert r.balance_before = 200000 and r.remaining = 5000000 - 3502500, format('B before/remaining, got %s %s', r.balance_before, r.remaining);

  select * into r from ops_acct.v_funding where trx_no = 'trx-sd-07_001';
  assert r.next_funding_no = 'trx-sd-07_002' and r.spent_total = 0, format('first of two funds on one day: empty window, got %s', r.spent_total);
  select * into r from ops_acct.v_funding where trx_no = 'trx-sd-07_002';
  assert r.spent_total = 400000 and r.is_open, format('second fund of the day pays the day, got %s', r.spent_total);
end $$;

-- as a reader, through RLS, the same answer
set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-00000000e301';
do $$
begin
  assert (select balance_after from ops_acct.v_transaction where trx_no = 'trx-sd-05_001') = 2200000,
    'a reader sees the same balance';
end $$;

rollback;
