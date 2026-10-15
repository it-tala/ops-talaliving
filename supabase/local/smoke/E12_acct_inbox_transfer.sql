-- acct — the seventh road: a transfer proof from Chat books as a transfer
-- between our own accounts (0283, L16), one act, the inbox closed.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-00000000f283','rina@talaliving.com','{"full_name":"Rina Kartika"}'),
  ('ffffffff-0000-0000-0000-00000000e283','half@talaliving.com','{"full_name":"Half Way"}');
insert into ops_core.user_authorities (user_id, authority) values
  ('ffffffff-0000-0000-0000-00000000f283','post_ledger'),
  ('ffffffff-0000-0000-0000-00000000f283','resolve_inbox'),
  ('ffffffff-0000-0000-0000-00000000e283','post_ledger');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-00000000f283','accounting','write'),
  ('ffffffff-0000-0000-0000-00000000e283','accounting','write');
insert into ops_core.attachments (id, storage_path, filename, source, uploaded_by) values
  ('44440000-0000-0000-0000-000000000283','drive-283-a','bukti-tf-jenius.jpg','chat','ffffffff-0000-0000-0000-00000000f283'),
  ('44440000-0000-0000-0000-000000000284','drive-283-b','bukti-tf-lain.jpg','chat','ffffffff-0000-0000-0000-00000000f283');
insert into ops_acct.evidence_inbox (ref_id, origin, status, attachment_id, reported_by, extracted) values
  ('inb-283-a','chat','PENDING','44440000-0000-0000-0000-000000000283','ffffffff-0000-0000-0000-00000000f283',
   '{"doc_type":"Payment Proof","amount_idr":5000000,"note":"Transfer BCA 271 ke BNI 325",
     "lines":[{"money_direction":"OUT","account":"BCA 271","amount_idr":5000000},
              {"money_direction":"IN","account":"BNI 325","amount_idr":5000000},
              {"money_direction":"OUT","account":"BCA 271","amount_idr":2500,"transaction_type":"BANK CHARGES"}]}'::jsonb),
  ('inb-283-b','chat','PENDING','44440000-0000-0000-0000-000000000284','ffffffff-0000-0000-0000-00000000f283',
   '{"doc_type":"Payment Proof","amount_idr":1000000}'::jsonb);

set local role authenticated;

/* ── REFUSAL: one of the two authorities is not enough ─────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-00000000e283';
do $$
declare r jsonb; n int;
begin
  r := ops_acct.book_evidence_to_transfer('inb-283-a','BCA 271','BNI 325', 5000000);
  assert r ->> 'outcome' = 'refused' and r -> 'error' -> 'detail' ->> 'required' = 'resolve_inbox', format('got %s', r);
  select count(*) into n from ops_acct.transactions;
  assert n = 0, 'nothing moved';
end $$;

/* ── the transfer from the inbox ───────────────────────────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-00000000f283';
do $$
declare r jsonb; i record; o record; n int;
begin
  r := ops_acct.book_evidence_to_transfer('inb-283-a','BCA 271','BNI 325', 5000000, '2026-10-15', 2500, null, null, null, null, 'k-283');
  assert ops_core.said_ok(r), format('got %s', r);
  assert r -> 'data' ->> 'out_trx_no' is not null and r -> 'data' ->> 'in_trx_no' is not null
     and r -> 'data' ->> 'fee_trx_no' is not null, format('three rows, got %s', r -> 'data');

  select * into i from ops_acct.evidence_inbox where ref_id = 'inb-283-a';
  assert i.status = 'CONFIRMED', format('closed, got %s', i.status);
  assert i.produced_trx_no = r -> 'data' ->> 'out_trx_no', 'pointing at the OUT leg';
  assert i.resolved_by = 'ffffffff-0000-0000-0000-00000000f283', 'signed';

  -- The document is the proof on every row of the transfer.
  select count(*) into n from ops_core.attachment_links k
   where k.attachment_id = '44440000-0000-0000-0000-000000000283' and k.entity = 'transaction' and k.unlinked_at is null;
  assert n = 3, format('the proof on all three rows, got %s', n);
  select * into o from ops_acct.v_transaction_detail where trx_no = r -> 'data' ->> 'out_trx_no';
  assert o.account_code = 'BCA 271' and o.direction = 'OUT' and o.amount_idr = 5000000, 'the OUT leg';
  assert o.has_payment_proof, 'kind from the reading: a transfer proof';
  assert jsonb_array_length(o.transfer_legs) = 2, format('the IN and the fee beside it, got %s', o.transfer_legs);

  -- A replay answers what it answered; a second booking of the same
  -- document is refused and writes nothing.
  r := ops_acct.book_evidence_to_transfer('inb-283-a','BCA 271','BNI 325', 5000000, '2026-10-15', 2500, null, null, null, null, 'k-283');
  assert r ->> 'outcome' = 'duplicate', format('got %s', r);
  r := ops_acct.book_evidence_to_transfer('inb-283-a','BCA 271','BNI 325', 5000000);
  assert r -> 'error' ->> 'code' = 'already_resolved', format('got %s', r);
  select count(*) into n from ops_acct.transactions;
  assert n = 3, format('three rows, got %s', n);

  -- post_transfer's refusals relayed, the inbox untouched.
  r := ops_acct.book_evidence_to_transfer('inb-283-b','BCA 271','BCA 271', 1000000);
  assert r -> 'error' ->> 'code' = 'same_account', format('got %s', r);
  select count(*) into n from ops_acct.evidence_inbox where ref_id = 'inb-283-b' and status = 'PENDING';
  assert n = 1, 'a refused booking moves nothing';
end $$;

rollback;
