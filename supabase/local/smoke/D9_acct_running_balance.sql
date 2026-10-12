-- acct — every ledger row carries the account's balance before and after it
-- (0267, D428).
--
-- Computed, never stored: a row posted late with an earlier date, an amount
-- corrected with Edit and a VOID each move every balance below them, and the
-- last row always agrees with `v_account_balance`.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-00000000e267','acc-rb@talaliving.com','{"full_name":"Acc RB"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-00000000e267','accounting','read');

insert into ops_acct.accounts (code, name, custody, is_paying, currency, opening_balance, opened_on)
values ('SMOKE RB', 'running balance', 'accounting', true, 'IDR', 1000000, '2026-10-01');

insert into ops_acct.transactions (trx_no, trx_date, account_id, direction, amount_idr,
                                   type_code, description, source_ref, posted_by)
select v.trx_no, v.trx_date::date, a.id, v.direction::ops_acct.direction_t, v.amount,
       'OFFICE', v.trx_no, v.trx_no, 'ffffffff-0000-0000-0000-00000000e267'
  from ops_acct.accounts a,
       (values ('trx-rb-1', '2026-10-02', 'IN',  500000),
               ('trx-rb-2', '2026-10-02', 'OUT', 200000),
               ('trx-rb-3', '2026-10-05', 'OUT', 300000),
               ('trx-rb-4', '2026-10-03', 'OUT', 999999)) v(trx_no, trx_date, direction, amount)
 where a.code = 'SMOKE RB';
update ops_acct.transactions
   set status = 'VOID', void_reason = 'salah input', void_by = 'ffffffff-0000-0000-0000-00000000e267', void_at = now()
 where trx_no = 'trx-rb-4';

do $$
declare b record;
begin
  select balance_before, balance_after into b from ops_acct.v_transaction where trx_no = 'trx-rb-1';
  assert b.balance_before = 1000000 and b.balance_after = 1500000, 'first row starts from the opening balance';
  select balance_before, balance_after into b from ops_acct.v_transaction where trx_no = 'trx-rb-2';
  assert b.balance_before = 1500000 and b.balance_after = 1300000, 'same day: posting order';
  select balance_before, balance_after into b from ops_acct.v_transaction where trx_no = 'trx-rb-4';
  assert b.balance_before is null and b.balance_after is null, 'a VOID row has no balance';
  select balance_before, balance_after into b from ops_acct.v_transaction where trx_no = 'trx-rb-3';
  assert b.balance_before = 1300000 and b.balance_after = 1000000, 'the void counts for nothing';
end $$;

-- Posted late with an earlier date, and an amount corrected afterwards.
insert into ops_acct.transactions (trx_no, trx_date, account_id, direction, amount_idr,
                                   type_code, description, source_ref, posted_by)
select 'trx-rb-9', '2026-10-01', a.id, 'OUT', 100000, 'OFFICE', 'telat dicatat', 'trx-rb-9',
       'ffffffff-0000-0000-0000-00000000e267'
  from ops_acct.accounts a where a.code = 'SMOKE RB';
update ops_acct.transactions set amount_idr = 250000 where trx_no = 'trx-rb-2';

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-00000000e267';

do $$
declare b record;
begin
  select balance_before, balance_after into b from ops_acct.v_transaction where trx_no = 'trx-rb-9';
  assert b.balance_before = 1000000 and b.balance_after = 900000, 'the backdated row goes first';
  select balance_before, balance_after into b from ops_acct.v_transaction where trx_no = 'trx-rb-1';
  assert b.balance_before = 900000 and b.balance_after = 1400000, 'and moves every row after it';
  select balance_before, balance_after into b from ops_acct.v_transaction where trx_no = 'trx-rb-3';
  assert b.balance_before = 1150000 and b.balance_after = 850000, 'the edited amount moves the rest';
  assert (select balance_after from ops_acct.v_transaction_detail where trx_no = 'trx-rb-3') = 850000,
    'the drawer carries it';
  assert (select balance from ops_acct.v_account_balance where code = 'SMOKE RB') = 850000,
    'the last row is the account''s balance';
end $$;

rollback;
