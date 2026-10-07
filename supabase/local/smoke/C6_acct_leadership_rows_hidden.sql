-- acct — a leadership account's rows are `approve_funds`' to read (0237, D390).
--
-- D87 locked the balance; the owner then found the rows still listed under
-- it. Two readers with accounting write, one of them holding approve_funds:
-- the ledger, the drawer, the allocations, a vendor's payments and the
-- rekening koran all show BCA 064 to the one and not the other — while the
-- procurement board keeps counting the payment, because a line leadership
-- paid is still paid.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-00000000e237','acc-staff@talaliving.com','{"full_name":"Acc Staff"}'),
  ('ffffffff-0000-0000-0000-00000000e238','acc-boss@talaliving.com','{"full_name":"Acc Boss"}');
insert into ops_core.user_authorities (user_id, authority) values
  ('ffffffff-0000-0000-0000-00000000e237','post_ledger'),
  ('ffffffff-0000-0000-0000-00000000e238','post_ledger'),
  ('ffffffff-0000-0000-0000-00000000e238','approve_funds');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-00000000e237','accounting','write'),
  ('ffffffff-0000-0000-0000-00000000e237','procurement','read'),
  ('ffffffff-0000-0000-0000-00000000e238','accounting','write'),
  ('ffffffff-0000-0000-0000-00000000e238','procurement','read');

insert into ops_procure.vendors (code, name) values ('V-LEAD-1', 'Kayu Jati Lead');

-- One row on leadership's account, paid to a vendor; one on accounting's.
insert into ops_acct.transactions (trx_no, trx_date, account_id, direction, amount_idr,
                                   type_code, vendor_id, description, source_ref, posted_by)
select 'trx-lead-1', '2026-10-01', a.id, 'OUT', 9000000, 'OFFICE',
       (select id from ops_procure.vendors where code = 'V-LEAD-1'),
       'kayu jati langsung dari pimpinan', 'trx-lead-1', 'ffffffff-0000-0000-0000-00000000e238'
  from ops_acct.accounts a where a.code = 'BCA 064';
insert into ops_acct.transactions (trx_no, trx_date, account_id, direction, amount_idr,
                                   type_code, vendor_id, description, source_ref, posted_by)
select 'trx-lead-2', '2026-10-01', a.id, 'OUT', 150000, 'OFFICE',
       (select id from ops_procure.vendors where code = 'V-LEAD-1'),
       'ongkir', 'trx-lead-2', 'ffffffff-0000-0000-0000-00000000e237'
  from ops_acct.accounts a where a.code = 'BCA 271';

-- A request line, paid from the leadership row.
insert into ops_acct.payment_allocations (trx_id, pr_line_no, amount, method, allocated_by)
select t.id, 'PR-LEAD-1', 9000000, 'transfer', 'ffffffff-0000-0000-0000-00000000e238'
  from ops_acct.transactions t where t.trx_no = 'trx-lead-1';

-- BCA 064's statement, with the line the row was booked from.
insert into ops_acct.bank_statements (id, statement_no, account_id, period_start, period_end,
                                      opening_balance, closing_balance, filename, uploaded_by)
select '55550000-0000-0000-0000-000000023701', 'stm-lead-1', a.id, '2026-10-01', '2026-10-31',
       50000000, 41000000, 'bca064-okt.pdf', 'ffffffff-0000-0000-0000-00000000e238'
  from ops_acct.accounts a where a.code = 'BCA 064';
insert into ops_acct.statement_lines (statement_id, line_no, value_date, direction, amount,
                                      amount_idr, raw_description, status, trx_no,
                                      decided_by, decided_at)
values ('55550000-0000-0000-0000-000000023701', 1, '2026-10-01', 'OUT', 9000000, 9000000,
        'TRSF KAYU JATI', 'booked', 'trx-lead-1', 'ffffffff-0000-0000-0000-00000000e238', now());

set local role authenticated;

/* ── staff: accounting's row, not leadership's ─────────────────────────── */

set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-00000000e237';
do $$
begin
  assert exists (select 1 from ops_acct.v_transaction where trx_no = 'trx-lead-2'),
    'accounting''s row stays in the ledger';
  assert not exists (select 1 from ops_acct.v_transaction where trx_no = 'trx-lead-1'),
    'a BCA 064 row is not in the ledger without approve_funds';
  assert not exists (select 1 from ops_acct.v_transaction_detail where trx_no = 'trx-lead-1'),
    'nor in the drawer';
  assert not exists (select 1 from ops_acct.v_allocation where trx_no = 'trx-lead-1'),
    'nor what it paid for';
  assert not exists (select 1 from ops_acct.v_vendor_payment where trx_no = 'trx-lead-1'),
    'nor on the vendor''s payments';
  assert exists (select 1 from ops_acct.v_vendor_payment where trx_no = 'trx-lead-2'),
    'the vendor''s other payment is still there';
  assert not exists (select 1 from ops_acct.v_bank_statement where statement_no = 'stm-lead-1'),
    'nor BCA 064''s rekening koran';
  assert not exists (select 1 from ops_acct.v_statement_line where statement_no = 'stm-lead-1'),
    'nor its lines';

  -- The board keeps counting it: a line leadership paid is paid.
  assert (select covered from ops_procure.v_line_funding where pr_line_no = 'PR-LEAD-1') = 9000000,
    'coverage still counts the leadership payment';

  -- And the balance is still locked, not recomputed from what this reader sees.
  assert (select balance_locked from ops_acct.v_account_balance where code = 'BCA 064'),
    'the figure stays locked (D87)';
end $$;

/* ── approve_funds: everything ─────────────────────────────────────────── */

set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-00000000e238';
do $$
begin
  assert exists (select 1 from ops_acct.v_transaction where trx_no = 'trx-lead-1'),
    'approve_funds reads the BCA 064 row';
  assert exists (select 1 from ops_acct.v_transaction_detail where trx_no = 'trx-lead-1'),
    'and its drawer';
  assert exists (select 1 from ops_acct.v_allocation where trx_no = 'trx-lead-1'),
    'and what it paid for';
  assert exists (select 1 from ops_acct.v_vendor_payment where trx_no = 'trx-lead-1'),
    'and the vendor''s payment';
  assert exists (select 1 from ops_acct.v_bank_statement where statement_no = 'stm-lead-1'),
    'and the rekening koran';
  assert (select count(*) from ops_acct.v_statement_line where statement_no = 'stm-lead-1') = 1,
    'with its line';
  assert not (select balance_locked from ops_acct.v_account_balance where code = 'BCA 064'),
    'and the figure';
end $$;

/* ── a staff post onto leadership's account still lands ────────────────── */
-- D78: recording a round's funding is post_ledger. The row is written; the
-- poster gets its number back from the seam and nothing else.

set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-00000000e237';
do $$
declare r jsonb; att uuid := gen_random_uuid();
begin
  set local role postgres;
  insert into ops_core.attachments (id, storage_path, filename, uploaded_by)
  values (att, 'a/lead-proof.jpg', 'lead-proof.jpg', 'ffffffff-0000-0000-0000-00000000e237');
  set local role authenticated;

  r := ops_acct.post_transaction(
    p_account_code => 'BCA 064', p_direction => 'OUT', p_amount => 25000000,
    p_type_code => 'CASHFLOW', p_description => 'Round funding — transfer to BCA 271',
    p_documents => jsonb_build_array(jsonb_build_object('attachment_id', att, 'kind', 'transfer_proof')),
    p_source_ref => 'round:lead:out:1');
  assert ops_core.said_ok(r), format('staff still record the out leg, got %s', r);
  assert not exists (select 1 from ops_acct.v_transaction where trx_no = r -> 'data' ->> 'trx_no'),
    'and then cannot read it back';
end $$;

rollback;
