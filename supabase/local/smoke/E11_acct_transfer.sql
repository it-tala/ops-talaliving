-- acct — one input, two legs: a transfer between our own accounts (0282, L15).
--
-- Owner 2026-10-15: name the source and the destination once; the OUT and
-- the IN are written together. What is proved: the legs share one id and one
-- proof; the fee is its own BANK CHARGES row; a refusal writes nothing; a
-- leadership account gets its leg and keeps it hidden from whoever may not
-- read that account; a leg on a dollar account is written in dollars (0285).

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-00000000f282','rina@talaliving.com','{"full_name":"Rina Kartika"}'),
  ('ffffffff-0000-0000-0000-00000000c282','dewi@talaliving.com','{"full_name":"Dewi Lestari"}'),
  ('ffffffff-0000-0000-0000-00000000e282','evin@talaliving.com','{"full_name":"Evin Jonathan"}');
insert into ops_core.user_authorities (user_id, authority) values
  ('ffffffff-0000-0000-0000-00000000f282','post_ledger'),
  ('ffffffff-0000-0000-0000-00000000e282','approve_funds');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-00000000f282','accounting','write'),
  ('ffffffff-0000-0000-0000-00000000c282','accounting','admin'),
  ('ffffffff-0000-0000-0000-00000000e282','accounting','read');
insert into ops_core.attachments (id, storage_path, filename, uploaded_by) values
  ('44440000-0000-0000-0000-000000000282','a/bukti-tf.jpg','bukti-transfer.jpg','ffffffff-0000-0000-0000-00000000f282');

set local role authenticated;

/* ── REFUSAL: an authority, not a module level (D24) ───────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-00000000c282';
do $$
declare r jsonb; n int;
begin
  r := ops_acct.post_transfer('BCA 271','BNI 325', 10000000,
        jsonb_build_array(jsonb_build_object('attachment_id','44440000-0000-0000-0000-000000000282','kind','Payment Proof')));
  assert r ->> 'outcome' = 'refused' and r -> 'error' ->> 'code' = 'authority_required', format('got %s', r);
  select count(*) into n from ops_acct.transactions;
  assert n = 0, 'nothing moved';
end $$;

/* ── the transfer, with its fee ────────────────────────────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-00000000f282';
do $$
declare r jsonb; o record; i record; f record; d record; n int;
begin
  r := ops_acct.post_transfer('BCA 271','BNI 325', 10000000,
        jsonb_build_array(jsonb_build_object('attachment_id','44440000-0000-0000-0000-000000000282','kind','Payment Proof')),
        '2026-10-15', null, 2500, null, null, 'k-282-1');
  assert ops_core.said_ok(r), format('got %s', r);
  assert r -> 'data' ->> 'out_trx_no' is not null and r -> 'data' ->> 'in_trx_no' is not null
     and r -> 'data' ->> 'fee_trx_no' is not null, format('three rows named, got %s', r -> 'data');

  select * into o from ops_acct.v_transaction where trx_no = r -> 'data' ->> 'out_trx_no';
  select * into i from ops_acct.v_transaction where trx_no = r -> 'data' ->> 'in_trx_no';
  select * into f from ops_acct.v_transaction where trx_no = r -> 'data' ->> 'fee_trx_no';
  assert o.account_code = 'BCA 271' and o.direction = 'OUT' and o.amount_idr = 10000000 and o.type_code = 'CASHFLOW',
    format('the OUT leg, got %s %s %s %s', o.account_code, o.direction, o.amount_idr, o.type_code);
  assert i.account_code = 'BNI 325' and i.direction = 'IN' and i.amount_idr = 10000000 and i.type_code = 'CASHFLOW',
    format('the IN leg, got %s %s %s', i.account_code, i.direction, i.amount_idr);
  assert f.account_code = 'BCA 271' and f.direction = 'OUT' and f.amount_idr = 2500 and f.type_code = 'BANK CHARGES',
    format('the fee as its own row, got %s %s %s', f.account_code, f.amount_idr, f.type_code);
  assert o.transfer_id is not null and o.transfer_id = i.transfer_id and i.transfer_id = f.transfer_id, 'one id on all three';
  assert o.category = 'transfer' and i.category = 'transfer' and f.category = 'bank', 'counted as transfer and bank';
  assert o.description = 'Transfer BCA 271 → BNI 325', format('named by itself, got %s', o.description);
  assert o.evidence_count = 1 and i.evidence_count = 1 and f.evidence_count = 1 and o.has_payment_proof,
    'the same proof on every row';
  assert o.trx_date = '2026-10-15' and i.trx_date = o.trx_date, 'on the day the money moved';

  -- The drawer reads the other legs from either side.
  select * into d from ops_acct.v_transaction_detail where trx_no = o.trx_no;
  assert jsonb_array_length(d.transfer_legs) = 2, format('two other legs, got %s', d.transfer_legs);
  assert d.transfer_legs -> 0 ->> 'trx_no' = i.trx_no, format('the IN first, got %s', d.transfer_legs);
  select * into d from ops_acct.v_transaction_detail where trx_no = i.trx_no;
  assert jsonb_array_length(d.transfer_legs) = 2 and d.transfer_legs -> 0 ->> 'account_code' = 'BCA 271', 'and back';

  -- A replay answers what it answered; no fourth row.
  r := ops_acct.post_transfer('BCA 271','BNI 325', 10000000,
        jsonb_build_array(jsonb_build_object('attachment_id','44440000-0000-0000-0000-000000000282','kind','Payment Proof')),
        '2026-10-15', null, 2500, null, null, 'k-282-1');
  assert r ->> 'outcome' = 'duplicate', format('got %s', r);
  select count(*) into n from ops_acct.transactions;
  assert n = 3, format('three rows, got %s', n);
end $$;

/* ── REFUSALS write nothing ────────────────────────────────────────────── */
do $$
declare r jsonb; n int;
  docs jsonb := jsonb_build_array(jsonb_build_object('attachment_id','44440000-0000-0000-0000-000000000282','kind','Payment Proof'));
begin
  r := ops_acct.post_transfer('BCA 271','BCA 271', 1000, docs);
  assert r -> 'error' ->> 'code' = 'same_account', format('got %s', r);
  r := ops_acct.post_transfer('BCA 271','MANDIRI 999', 1000, docs);
  assert r -> 'error' ->> 'code' = 'no_such_account', format('got %s', r);
  r := ops_acct.post_transfer('BCA 271','BNI 325', 0, docs);
  assert r -> 'error' ->> 'code' = 'amount_positive', format('got %s', r);
  r := ops_acct.post_transfer('BCA 271','BNI 325', 1000, docs, null, null, -1);
  assert r -> 'error' ->> 'code' = 'fee_negative', format('got %s', r);
  -- No proof, no transfer (D85): post_transaction's own refusal, relayed.
  r := ops_acct.post_transfer('BCA 271','BNI 325', 1000, '[]'::jsonb);
  assert r -> 'error' ->> 'code' = 'evidence_required', format('got %s', r);
  select count(*) into n from ops_acct.transactions;
  assert n = 3, format('a refusal writes nothing, got %s rows', n);
end $$;

/* ── a leadership account: both legs, the hidden one stays hidden ──────── */
do $$
declare r jsonb; n int; d record;
begin
  -- Funding from leadership (D106): the bookkeeper records it from BCA 271's
  -- side and the 064 leg is written with it.
  r := ops_acct.post_transfer('BCA 064','BCA 271', 100000000,
        jsonb_build_array(jsonb_build_object('attachment_id','44440000-0000-0000-0000-000000000282','kind','Payment Proof')),
        '2026-10-15');
  assert ops_core.said_ok(r), format('got %s', r);
  -- Rina reads the ledger as accounting: the IN on 271, not the OUT on 064.
  select count(*) into n from ops_acct.v_transaction where transfer_id = (r -> 'data' ->> 'transfer_id')::uuid;
  assert n = 1, format('accounting sees one leg of a leadership transfer, got %s', n);
  select * into d from ops_acct.v_transaction_detail where trx_no = r -> 'data' ->> 'in_trx_no';
  assert d.transfer_legs = '[]'::jsonb, format('and no hidden leg leaks through the detail, got %s', d.transfer_legs);
  -- Liquidation still counts it: money arrived on an accounting account.
  select count(*) into n from ops_acct.v_funding where trx_no = r -> 'data' ->> 'in_trx_no';
  assert n = 1, 'the arrival is funding';
end $$;

set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-00000000e282';
do $$
declare n int; d record;
begin
  -- approve_funds sees both legs, as it sees every row on 064 (D391).
  select count(*) into n from ops_acct.v_transaction where account_code = 'BCA 064' and transfer_id is not null;
  assert n = 1, format('the 064 leg exists for approve_funds, got %s', n);
  select * into d from ops_acct.v_transaction_detail where account_code = 'BCA 064' and transfer_id is not null;
  assert jsonb_array_length(d.transfer_legs) = 1 and d.transfer_legs -> 0 ->> 'account_code' = 'BCA 271', 'and its pair';
end $$;

/* ── a dollar source: the dollar leg is in dollars (0285, D444) ─────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-00000000f282';
do $$
declare r jsonb;
begin
  -- Without the dollar amount the transfer is refused, not written in rupiah.
  r := ops_acct.post_transfer('BCA USD 081','BCA 064', 16500000,
        jsonb_build_array(jsonb_build_object('attachment_id','44440000-0000-0000-0000-000000000282','kind','Payment Proof')),
        '2026-10-15', 'Konversi tanpa USD');
  assert (r ->> 'status')::int = 422 and r -> 'error' ->> 'code' = 'billed_required', format('got %s', r);
  -- A wrong currency on the foreign leg is refused too.
  r := ops_acct.post_transfer('BCA USD 081','BCA 064', 16500000,
        jsonb_build_array(jsonb_build_object('attachment_id','44440000-0000-0000-0000-000000000282','kind','Payment Proof')),
        '2026-10-15', 'Konversi salah mata uang', null, 'SGD', 1000);
  assert (r ->> 'status')::int = 422 and r -> 'error' ->> 'code' = 'billed_currency', format('got %s', r);

  r := ops_acct.post_transfer('BCA USD 081','BCA 064', 16500000,
        jsonb_build_array(jsonb_build_object('attachment_id','44440000-0000-0000-0000-000000000282','kind','Payment Proof')),
        '2026-10-15', 'Konversi USD → IDR', null, 'USD', 1000);
  assert ops_core.said_ok(r), format('got %s', r);
  assert (r -> 'data' ->> 'out_amount')::numeric = 1000 and (r -> 'data' ->> 'in_amount')::numeric = 16500000,
    format('the answer names each leg''s own amount, got %s', r -> 'data');
end $$;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-00000000e282';
do $$
declare o record; i record; b record;
begin
  select * into o from ops_acct.v_transaction_detail where account_code = 'BCA USD 081' and direction = 'OUT';
  assert o.amount_idr = 1000, format('the dollar leg is in dollars, got %s', o.amount_idr);
  assert o.billed_currency is null, 'and says nothing twice';
  assert o.transfer_legs -> 0 ->> 'account_code' = 'BCA 064', 'paired with 064';
  select * into i from ops_acct.v_transaction_detail where account_code = 'BCA 064' and direction = 'IN' and transfer_id = o.transfer_id;
  assert i.amount_idr = 16500000, format('the rupiah leg is what arrived, got %s', i.amount_idr);
  assert i.billed_currency = 'USD' and i.billed_amount = 1000, format('and remembers the dollars it came from, got %s %s', i.billed_currency, i.billed_amount);
  select * into b from ops_acct.v_account_balance where code = 'BCA USD 081';
  assert b.balance = -1000, format('the dollar account moved by dollars, got %s', b.balance);
end $$;

/* ── buying dollars: the dollar leg is the IN ─────────────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-00000000f282';
do $$
declare r jsonb;
begin
  r := ops_acct.post_transfer('BCA 064','BCA USD 081', 8300000,
        jsonb_build_array(jsonb_build_object('attachment_id','44440000-0000-0000-0000-000000000282','kind','Payment Proof')),
        '2026-10-16', 'Beli USD', null, 'USD', 500);
  assert ops_core.said_ok(r), format('got %s', r);
  assert (r -> 'data' ->> 'out_amount')::numeric = 8300000 and (r -> 'data' ->> 'in_amount')::numeric = 500, format('got %s', r -> 'data');
end $$;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-00000000e282';
do $$
declare i record; o record; b record;
begin
  select * into i from ops_acct.v_transaction_detail where account_code = 'BCA USD 081' and direction = 'IN';
  assert i.amount_idr = 500 and i.billed_currency is null, format('dollars arrived as dollars, got %s %s', i.amount_idr, i.billed_currency);
  select * into o from ops_acct.v_transaction_detail where account_code = 'BCA 064' and direction = 'OUT' and transfer_id = i.transfer_id;
  assert o.amount_idr = 8300000 and o.billed_currency = 'USD' and o.billed_amount = 500, format('the rupiah left with the dollars noted, got %s %s %s', o.amount_idr, o.billed_currency, o.billed_amount);
  select * into b from ops_acct.v_account_balance where code = 'BCA USD 081';
  assert b.balance = -500, format('-1000 + 500, got %s', b.balance);
end $$;

rollback;
