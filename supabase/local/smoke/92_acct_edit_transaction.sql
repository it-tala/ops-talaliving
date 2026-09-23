-- acct — edit_transaction (0101): correcting a ledger row in place.
--
-- Worked out first:
--
--   a POSTED row, Rp 500.000, one line 2 × 250.000
--   edit(amount 600.000, remark "nota says 600") -> ok; row reads 600.000;
--     its single line moves with it, unit price re-derived to 300.000;
--     the audit row carries the remark as reason and before/after in detail
--   edit(description only, no remark)            -> ok; remark not needed
--   the same values again                         -> noop
--
--   edit below what is already allocated -> ok (0102, owner: it happens),
--     with `allocated` and `over_allocated` in the audit detail
--
--   REFUSALS     post_ledger required; an amount change with no remark; an
--                amount <= 0; an empty description; a VOID row; a row
--                matched to a statement line
--   DERIVATIONS  attach_link / attach_unlink now say which file and kind

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-00000000e001','rina-edit@talaliving.com','{"full_name":"Rina Edit"}'),
  ('ffffffff-0000-0000-0000-00000000e002','dewi-edit@talaliving.com','{"full_name":"Dewi Edit"}');

insert into ops_core.user_authorities (user_id, authority) values
  ('ffffffff-0000-0000-0000-00000000e001','post_ledger');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-00000000e001','accounting','write'),
  ('ffffffff-0000-0000-0000-00000000e002','accounting','admin');

insert into ops_acct.transactions (id, trx_no, trx_date, account_id, direction, amount_idr,
                                   type_code, description, source_ref, posted_by)
select v.id::uuid, v.no, '2026-09-20', a.id, 'OUT', v.amt, 'SUPPLIERS', v.descr, v.no,
       'ffffffff-0000-0000-0000-00000000e001'
  from ops_acct.accounts a,
       (values ('55550000-0000-0000-0000-0000000000e1','trx-edit-1', 500000, 'bayar foam'),
               ('55550000-0000-0000-0000-0000000000e2','trx-edit-2', 900000, 'bayar cat'),
               ('55550000-0000-0000-0000-0000000000e3','trx-edit-3', 100000, 'bayar paku')) v(id, no, amt, descr)
 where a.code = 'BCA 271';

insert into ops_acct.transaction_lines (trx_id, line_no, description, qty, unit_price, amount) values
  ('55550000-0000-0000-0000-0000000000e1', 1, 'Foam sheet 2mm', 2, 250000, 500000);

insert into ops_acct.payment_allocations (trx_id, pr_line_no, amount, allocated_by) values
  ('55550000-0000-0000-0000-0000000000e2','pr-26-09-20_01-L01', 800000,'ffffffff-0000-0000-0000-00000000e001');

insert into ops_core.attachments (id, storage_path, filename, uploaded_by) values
  ('44440000-0000-0000-0000-0000000000e1','a/rr.jpg','receiving-report.jpg','ffffffff-0000-0000-0000-00000000e001');

-- trx-edit-4 is matched to a bank statement line, so its amount is the bank's.
insert into ops_acct.transactions (trx_no, trx_date, account_id, direction, amount_idr,
                                   type_code, description, source_ref, posted_by)
select 'trx-edit-4', '2026-09-20', a.id, 'OUT', 250000, 'SUPPLIERS', 'bayar lem', 'trx-edit-4',
       'ffffffff-0000-0000-0000-00000000e001'
  from ops_acct.accounts a where a.code = 'BCA 271';
insert into ops_acct.bank_statements (id, account_id, period_start, period_end, opening_balance,
                                      closing_balance, filename, uploaded_by, statement_no)
select '66660000-0000-0000-0000-0000000000e1', a.id, '2026-09-01', '2026-09-30', 0, 0, 'rk.pdf',
       'ffffffff-0000-0000-0000-00000000e001', 'st-edit-1'
  from ops_acct.accounts a where a.code = 'BCA 271';
insert into ops_acct.statement_lines (statement_id, line_no, value_date, direction, amount, amount_idr,
                                      raw_description, status, trx_no)
values ('66660000-0000-0000-0000-0000000000e1', 1, '2026-09-20', 'OUT', 250000, 250000,
        'TRSF LEM', 'matched', 'trx-edit-4');

set local role authenticated;

/* ── REFUSAL: accounting.admin is not post_ledger (D24) ────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-00000000e002';
do $$
declare r jsonb;
begin
  r := ops_acct.edit_transaction('trx-edit-1', 600000, null, 'nota says 600');
  assert r ->> 'outcome' = 'refused', 'admin without post_ledger should be refused, got ' || (r ->> 'outcome');
  assert r -> 'error' ->> 'code' = 'authority_required', 'wrong code: ' || (r -> 'error' ->> 'code');
end $$;

set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-00000000e001';

/* ── REFUSALS on the input itself ──────────────────────────────────────── */
do $$
declare r jsonb;
begin
  r := ops_acct.edit_transaction('trx-edit-1', 600000, null, '  ');
  assert r -> 'error' ->> 'code' = 'reason_required', 'an amount change needs a remark, got ' || coalesce(r -> 'error' ->> 'code', r ->> 'outcome');

  r := ops_acct.edit_transaction('trx-edit-1', 0, null, 'x');
  assert r -> 'error' ->> 'code' = 'amount_positive', 'wrong code: ' || coalesce(r -> 'error' ->> 'code', r ->> 'outcome');

  r := ops_acct.edit_transaction('trx-edit-1', null, '   ', null);
  assert r -> 'error' ->> 'code' = 'description_required', 'wrong code: ' || coalesce(r -> 'error' ->> 'code', r ->> 'outcome');

  r := ops_acct.edit_transaction('no-such-trx', 1, null, 'x');
  assert r ->> 'outcome' = 'refused' and (r ->> 'status')::int = 404, 'unknown row should be 404';
end $$;

/* ── DERIVATION: the amount moves, the single line moves with it ──────── */
do $$
declare r jsonb; amt numeric; l record;
begin
  r := ops_acct.edit_transaction('trx-edit-1', 600000, null, 'nota says 600', 'k1');
  assert r ->> 'outcome' = 'ok', 'expected ok, got ' || (r ->> 'outcome') || ' / ' || coalesce(r -> 'error' ->> 'message', '');
  assert (r -> 'data' ->> 'amount_idr')::numeric = 600000, 'wrong amount back';

  select amount_idr into amt from ops_acct.transactions where trx_no = 'trx-edit-1';
  assert amt = 600000, 'row should read 600000, got ' || amt;
  select amount, unit_price into l from ops_acct.transaction_lines
   where trx_id = '55550000-0000-0000-0000-0000000000e1';
  assert l.amount = 600000 and l.unit_price = 300000,
    'line should follow: 600000 @ 300000, got ' || l.amount || ' @ ' || l.unit_price;

  -- Same key: the first answer back, nothing written twice.
  r := ops_acct.edit_transaction('trx-edit-1', 600000, null, 'nota says 600', 'k1');
  assert r ->> 'outcome' = 'duplicate' and (r ->> 'status')::int = 200
     and (r -> 'data' ->> 'amount_idr')::numeric = 600000, 'replay should answer the first result, got ' || r::text;

  -- Description only: no remark needed.
  r := ops_acct.edit_transaction('trx-edit-1', null, 'Foam sheet 2mm — 2 lembar', null);
  assert r ->> 'outcome' = 'ok', 'description edit needs no remark, got ' || (r ->> 'outcome');

  -- The same values again.
  r := ops_acct.edit_transaction('trx-edit-1', 600000, 'Foam sheet 2mm — 2 lembar', null);
  assert r ->> 'outcome' = 'noop', 'nothing to change should be a noop, got ' || (r ->> 'outcome');

  -- Below the allocations is allowed too (0102), and flagged.
  r := ops_acct.edit_transaction('trx-edit-2', 700000, null, 'discount after payment');
  assert r ->> 'outcome' = 'ok', 'below allocated is allowed, got ' || (r ->> 'outcome') || ' / ' || coalesce(r -> 'error' ->> 'message', '');

  -- The receiving report is a kind the seam accepts, by label.
  r := ops_core.attach_link('44440000-0000-0000-0000-0000000000e1','transaction','trx-edit-1','Receiving Report');
  assert r ->> 'outcome' = 'ok', 'Receiving Report should attach, got ' || (r ->> 'outcome') || ' / ' || coalesce(r -> 'error' ->> 'message', '');
  r := ops_core.attach_unlink((r -> 'data' ->> 'link_id')::uuid);
  assert r ->> 'outcome' = 'ok', 'unlink should work, got ' || (r ->> 'outcome');
end $$;

/* ── REFUSALS on the row's state ───────────────────────────────────────── */
do $$
declare r jsonb;
begin
  r := ops_acct.void_transaction('trx-edit-3', 'entered twice');
  assert r ->> 'outcome' = 'ok', 'void setup failed';
  r := ops_acct.edit_transaction('trx-edit-3', 200000, null, 'x');
  assert r -> 'error' ->> 'code' = 'transaction_void', 'a void row is not edited, got ' || coalesce(r -> 'error' ->> 'code', r ->> 'outcome');

  r := ops_acct.edit_transaction('trx-edit-4', 260000, null, 'x');
  assert r -> 'error' ->> 'code' = 'statement_matched', 'a matched row keeps the bank''s amount, got ' || coalesce(r -> 'error' ->> 'code', r ->> 'outcome');
  r := ops_acct.edit_transaction('trx-edit-4', null, 'bayar lem kayu', null);
  assert r ->> 'outcome' = 'ok', 'but its description can still be fixed, got ' || (r ->> 'outcome');
end $$;

reset role;

do $$
declare n int; a record; d jsonb;
begin
  select reason, detail, before, after into a from ops_core.audit_log
   where entity = 'transaction' and entity_no = 'trx-edit-1' and action = 'edit' and outcome = 'ok'
     and detail ? 'amount_before';
  assert a.reason = 'nota says 600', 'the remark is the audit reason, got ' || coalesce(a.reason, 'null');
  assert (a.detail ->> 'amount_before')::numeric = 500000 and (a.detail ->> 'amount_after')::numeric = 600000,
    'detail should carry before and after, got ' || a.detail::text;
  assert a.detail ->> 'lines' = 'updated', 'detail should say the line moved';
  assert (a.before ->> 'amount_idr')::numeric = 500000, 'before should carry the old amount';

  select count(*) into n from ops_core.audit_log
   where entity = 'transaction' and entity_no = 'trx-edit-1' and action = 'edit' and outcome = 'ok';
  assert n = 2, 'two real edits (the replay writes nothing), got ' || n;

  select detail into d from ops_core.audit_log
   where entity = 'transaction' and entity_no = 'trx-edit-2' and action = 'edit' and outcome = 'ok';
  assert (d ->> 'allocated')::numeric = 800000 and (d ->> 'over_allocated')::numeric = 100000,
    'a below-allocated edit is flagged in the detail, got ' || d::text;

  select count(*) into n from ops_core.audit_log
   where entity = 'attachment' and entity_no = 'trx-edit-1'
     and action in ('attach_link','attach_unlink')
     and detail ->> 'kind' = 'receiving_report' and detail ->> 'file' = 'receiving-report.jpg';
  assert n = 2, 'link and unlink should both say which file and kind, got ' || n;
end $$;

-- Every kind still has a label and a drive (0005, 0035).
do $$
declare missing text;
begin
  select string_agg(e.enumlabel, ', ') into missing
    from pg_enum e join pg_type t on t.oid = e.enumtypid
    join pg_namespace n on n.oid = t.typnamespace
   where n.nspname = 'ops_core' and t.typname = 'doc_kind_t'
     and (not exists (select 1 from ops_core.doc_kind_labels l where l.kind::text = e.enumlabel)
          or not exists (select 1 from ops_core.doc_kind_drive d where d.kind::text = e.enumlabel));
  assert missing is null, 'kinds without a label or drive: ' || missing;
end $$;

rollback;
