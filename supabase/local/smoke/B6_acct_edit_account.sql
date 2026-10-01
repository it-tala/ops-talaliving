-- acct — edit_transaction (0204): correcting which account the money moved
-- through (D359).
--
-- Before `0204` a row booked on BCA 271 that was really paid from JAGO could
-- only be VOIDed and posted again. The account is now correctable like the
-- vendor — but unlike the vendor it **moves money** from one balance to
-- another, so it carries three guards the vendor does not: a bank statement
-- that already confirmed the row, a leadership account on either side, and a
-- different currency.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-00000000e204','acc-edit@talaliving.com','{"full_name":"Acc Edit"}'),
  ('ffffffff-0000-0000-0000-00000000e205','acc-lead@talaliving.com','{"full_name":"Acc Lead"}');
insert into ops_core.user_authorities (user_id, authority) values
  ('ffffffff-0000-0000-0000-00000000e204','post_ledger'),
  ('ffffffff-0000-0000-0000-00000000e205','post_ledger'),
  ('ffffffff-0000-0000-0000-00000000e205','approve_funds');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-00000000e204','accounting','write'),
  ('ffffffff-0000-0000-0000-00000000e205','accounting','write');

-- Booked on BCA 271; the transfer proof says JAGO.
insert into ops_acct.transactions (trx_no, trx_date, account_id, direction, amount_idr,
                                   type_code, description, source_ref, posted_by)
select 'trx-acc-1', '2026-09-30', a.id, 'OUT', 415000,
       'OFFICE', 'beli tinta printer', 'trx-acc-1', 'ffffffff-0000-0000-0000-00000000e204'
  from ops_acct.accounts a where a.code = 'BCA 271';

-- A second row, already confirmed by a BNI 325 statement.
insert into ops_acct.transactions (trx_no, trx_date, account_id, direction, amount_idr,
                                   type_code, description, source_ref, posted_by)
select 'trx-acc-2', '2026-09-30', a.id, 'OUT', 75000,
       'BANK CHARGES', 'biaya admin', 'trx-acc-2', 'ffffffff-0000-0000-0000-00000000e204'
  from ops_acct.accounts a where a.code = 'BNI 325';
insert into ops_acct.bank_statements (id, statement_no, account_id, period_start, period_end,
                                      opening_balance, closing_balance, filename, uploaded_by)
select '55550000-0000-0000-0000-000000020401', 'stm-acc-1', a.id, '2026-09-01', '2026-09-30',
       1000000, 925000, 'bni-sep.pdf', 'ffffffff-0000-0000-0000-00000000e204'
  from ops_acct.accounts a where a.code = 'BNI 325';
insert into ops_acct.statement_lines (statement_id, line_no, value_date, direction, amount,
                                      amount_idr, raw_description, status, trx_no,
                                      decided_by, decided_at)
values ('55550000-0000-0000-0000-000000020401', 1, '2026-09-30', 'OUT', 75000, 75000,
        'BIAYA ADM', 'matched', 'trx-acc-2', 'ffffffff-0000-0000-0000-00000000e204', now());

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-00000000e204';

/* ── the correction the owner asked for: BCA 271 → JAGO ────────────────── */

do $$
declare r jsonb; code text;
begin
  -- No remark: the remark is owed for the amount (0101), and the account is
  -- held to the vendor's line (0105), not a new one.
  r := ops_acct.edit_transaction('trx-acc-1', p_account_code => 'JAGO');
  assert ops_core.said_ok(r), format('an account is corrected by code, got %s', r);
  select a.code into code from ops_acct.transactions t
    join ops_acct.accounts a on a.id = t.account_id where t.trx_no = 'trx-acc-1';
  assert code = 'JAGO', format('the row moved, got %s', code);
end $$;

-- By code in the trail. Read as postgres: the audit log is IT's (D190).
set local role postgres;
do $$
declare a ops_core.audit_log;
begin
  select * into a from ops_core.audit_log
   where entity_no = 'trx-acc-1' and action = 'edit' order by id desc limit 1;
  assert a.before ->> 'account' = 'BCA 271', format('got %s', a.before);
  assert a.after  ->> 'account' = 'JAGO',    format('got %s', a.after);
end $$;
set local role authenticated;

/* ── null keeps: a description edit never moves the money ──────────────── */

do $$
declare r jsonb; code text;
begin
  r := ops_acct.edit_transaction('trx-acc-1', p_description => 'beli tinta printer kantor');
  assert ops_core.said_ok(r), format('got %s', r);
  select a.code into code from ops_acct.transactions t
    join ops_acct.accounts a on a.id = t.account_id where t.trx_no = 'trx-acc-1';
  assert code = 'JAGO', format('the account stayed, got %s', code);

  -- and the same account said again is nothing
  r := ops_acct.edit_transaction('trx-acc-1', p_account_code => 'JAGO');
  assert r ->> 'outcome' = 'noop', format('got %s', r);
end $$;

/* ── REFUSALS ──────────────────────────────────────────────────────────── */

do $$
declare r jsonb; code text;
begin
  r := ops_acct.edit_transaction('trx-acc-1', p_account_code => 'BRI 999');
  assert r -> 'error' ->> 'code' = 'no_such_account', format('got %s', r);

  -- A rupiah amount on the dollar account has no rate behind it.
  r := ops_acct.edit_transaction('trx-acc-1', p_account_code => 'BCA USD 081');
  assert r -> 'error' ->> 'code' = 'account_currency', format('got %s', r);

  -- BCA 064 is leadership's (D87): without approve_funds, not onto it…
  r := ops_acct.edit_transaction('trx-acc-1', p_account_code => 'BCA 064');
  assert r -> 'error' ->> 'code' = 'authority_required', format('got %s', r);

  -- The bank already said BNI 325. Unmatch first.
  r := ops_acct.edit_transaction('trx-acc-2', p_account_code => 'JAGO');
  assert r -> 'error' ->> 'code' = 'statement_matched', format('got %s', r);

  -- Nothing written by any of them, and nothing half written when the
  -- account refuses beside a change that would have been fine.
  r := ops_acct.edit_transaction('trx-acc-1', p_description => 'x berubah',
        p_account_code => 'BRI 999');
  assert r -> 'error' ->> 'code' = 'no_such_account', format('got %s', r);
  select a.code into code from ops_acct.transactions t
    join ops_acct.accounts a on a.id = t.account_id where t.trx_no = 'trx-acc-1';
  assert code = 'JAGO', format('still JAGO, got %s', code);
  assert (select description from ops_acct.transactions where trx_no = 'trx-acc-1')
         = 'beli tinta printer kantor', 'the description did not move either';
end $$;

/* ── leadership may, and back off again ────────────────────────────────── */

do $$
declare r jsonb;
begin
  set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-00000000e205';
  r := ops_acct.edit_transaction('trx-acc-1', p_account_code => 'BCA 064');
  assert ops_core.said_ok(r), format('approve_funds may move a row onto 064, got %s', r);

  -- …and off it is guarded the same way for somebody without it
  set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-00000000e204';
  r := ops_acct.edit_transaction('trx-acc-1', p_account_code => 'JAGO');
  assert r -> 'error' ->> 'code' = 'authority_required', format('got %s', r);
end $$;

/* ── an inactive account is not somewhere to move a row to ─────────────── */

set local role postgres;
update ops_acct.accounts set is_active = false where code = 'PETTY CASH';
set local role authenticated;
do $$
declare r jsonb;
begin
  set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-00000000e205';
  r := ops_acct.edit_transaction('trx-acc-1', p_account_code => 'PETTY CASH');
  assert r -> 'error' ->> 'code' = 'account_inactive', format('got %s', r);
end $$;

rollback;
