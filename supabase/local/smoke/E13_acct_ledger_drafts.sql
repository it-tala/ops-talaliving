-- acct — ledger drafts (0286, D445): the documents of one transaction booked
-- as one act from the ledger, dismissed with a reason, or taken apart.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-00000000f286','evin@talaliving.com','{"full_name":"Evin Draft"}'),
  ('ffffffff-0000-0000-0000-00000000e286','lihat@talaliving.com','{"full_name":"Lihat Saja"}');
insert into ops_core.user_authorities (user_id, authority) values
  ('ffffffff-0000-0000-0000-00000000f286','post_ledger'),
  ('ffffffff-0000-0000-0000-00000000f286','resolve_inbox');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-00000000f286','accounting','write'),
  ('ffffffff-0000-0000-0000-00000000e286','accounting','read');
insert into ops_core.attachments (id, storage_path, filename, source, uploaded_by) values
  ('44440000-0000-0000-0000-000000000286','drive-286-t','bukti-tf-martono.jpg','chat','ffffffff-0000-0000-0000-00000000f286'),
  ('44440000-0000-0000-0000-000000000287','drive-286-n','nota-martono.jpg','chat','ffffffff-0000-0000-0000-00000000f286'),
  ('44440000-0000-0000-0000-000000000288','drive-286-n','nota-martono.jpg','chat','ffffffff-0000-0000-0000-00000000f286'),
  ('44440000-0000-0000-0000-000000000289','drive-286-p','foto-sofa.jpg','chat','ffffffff-0000-0000-0000-00000000f286'),
  ('44440000-0000-0000-0000-000000000290','drive-286-s','saldo-rekening.jpg','chat','ffffffff-0000-0000-0000-00000000f286'),
  ('44440000-0000-0000-0000-000000000291','drive-286-a','nota-a.jpg','chat','ffffffff-0000-0000-0000-00000000f286'),
  ('44440000-0000-0000-0000-000000000292','drive-286-b','bukti-b.jpg','chat','ffffffff-0000-0000-0000-00000000f286');
insert into ops_procure.vendors (id, code, name) values
  ('55550000-0000-0000-0000-000000000286','V-MARTONO','MARTONO');
insert into ops_acct.evidence_inbox (ref_id, origin, status, attachment_id, reported_by, extracted) values
  ('ev286t~x0','chat','PENDING','44440000-0000-0000-0000-000000000286','ffffffff-0000-0000-0000-00000000f286',
   '{"doc_type":"Payment Proof","amount_idr":1360000,"vendor_name":"MARTONO","account":"BCA 271"}'::jsonb),
  ('ev286n~x0','chat','PENDING','44440000-0000-0000-0000-000000000287','ffffffff-0000-0000-0000-00000000f286',
   '{"doc_type":"Receipt / Invoice / Nota","amount_idr":1000000,"vendor_name":"MARTONO","note":"JASA JOK SOFA"}'::jsonb),
  ('ev286n~x1','chat','PENDING','44440000-0000-0000-0000-000000000288','ffffffff-0000-0000-0000-00000000f286',
   '{"doc_type":"Receipt / Invoice / Nota","amount_idr":360000,"vendor_name":"MARTONO","note":"BUSA"}'::jsonb),
  ('ev286p~x0','chat','PENDING','44440000-0000-0000-0000-000000000289','ffffffff-0000-0000-0000-00000000f286',
   '{"doc_type":"Receiving Item"}'::jsonb),
  ('ev286s~x0','chat','PENDING','44440000-0000-0000-0000-000000000290','ffffffff-0000-0000-0000-00000000f286',
   '{"doc_type":"Others"}'::jsonb),
  ('ev286a~x0','chat','PENDING','44440000-0000-0000-0000-000000000291','ffffffff-0000-0000-0000-00000000f286',
   '{"doc_type":"Receipt / Invoice / Nota","amount_idr":500000}'::jsonb),
  ('ev286b~x0','chat','PENDING','44440000-0000-0000-0000-000000000292','ffffffff-0000-0000-0000-00000000f286',
   '{"doc_type":"Payment Proof","amount_idr":500000}'::jsonb);

set local role authenticated;

/* ── REFUSAL: reading accounting is not booking it ─────────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-00000000e286';
do $$
declare r jsonb; n int;
begin
  r := ops_acct.confirm_draft('ev286t~x0', '[["ev286t~x0"],["ev286n~x0","ev286n~x1"]]', 'transaction', 'BCA 271', 1360000);
  assert r ->> 'outcome' = 'refused', format('got %s', r);
  r := ops_acct.dismiss_draft('ev286s~x0', '[["ev286s~x0"]]', 'note', 'tangkapan saldo');
  assert r ->> 'outcome' = 'refused', format('got %s', r);
  r := ops_acct.split_draft('ev286a~x0', '[["ev286a~x0"],["ev286b~x0"]]');
  assert r ->> 'outcome' = 'refused', format('got %s', r);
  select count(*) into n from ops_acct.draft_decisions;
  assert n = 0, 'nothing decided';
end $$;

set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-00000000f286';

/* ── a document that is two files is refused before anything moves ────── */
do $$
declare r jsonb; n int;
begin
  r := ops_acct.confirm_draft('ev286t~x0', '[["ev286t~x0","ev286p~x0"]]', 'transaction', 'BCA 271', 1360000);
  assert r -> 'error' ->> 'code' = 'not_one_document', format('got %s', r);
  r := ops_acct.confirm_draft('ev286t~x0', '[["ev286t~x0"]]', 'sideways', 'BCA 271', 1360000);
  assert r -> 'error' ->> 'code' = 'road_required', format('got %s', r);
  -- The link road to a row that does not exist: nothing linked, nothing decided.
  r := ops_acct.confirm_draft('ev286a~x0', '[["ev286a~x0"]]', 'link', null, null, p_link_trx_no => 'trx-00-00-00_999');
  assert r -> 'error' ->> 'code' = 'no_such_transaction', format('got %s', r);
  select count(*) into n from ops_acct.evidence_inbox where status <> 'PENDING';
  assert n = 0, 'still all pending';
end $$;

/* ── ✓: transfer + nota (two rows of one photo) + goods photo, one row ─── */
do $$
declare r jsonb; t record; n int; v_nota_lines int; d record;
begin
  r := ops_acct.confirm_draft(
    p_draft_key => 'ev286t~x0',
    p_docs      => '[["ev286t~x0"],["ev286n~x0","ev286n~x1"],["ev286p~x0"]]',
    p_road      => 'transaction',
    p_account_code => 'BCA 271',
    p_amount    => 1360000,
    p_trx_date  => '2026-10-18',
    p_description => 'MARTONO jasa jok sofa',
    p_vendor_code => 'V-MARTONO',
    p_lines     => '[{"kind":"item","description":"JASA JOK SOFA","qty":2,"uom":"unit","unit_price":500000,"amount":1000000,"doc":1},
                     {"kind":"item","description":"BUSA","qty":1,"uom":"lembar","unit_price":360000,"amount":360000,"doc":1}]',
    p_shown     => '{"level":"hi","score":94,"reasons":[{"tone":"ok","text":"nota = transfer"}],"proposed":{"amount":1360000,"account":"BCA 271"}}',
    p_key       => 'k-286');
  assert ops_core.said_ok(r), format('got %s', r);
  assert (r -> 'data' ->> 'documents')::int = 3, format('three documents, got %s', r -> 'data');

  select * into t from ops_acct.v_transaction_detail where trx_no = r -> 'data' ->> 'trx_no';
  assert t.amount_idr = 1360000 and t.account_code = 'BCA 271' and t.direction = 'OUT', 'the row';
  assert t.source_ref = 'inbox:ev286t~x0', format('the head is the transfer proof, got %s', t.source_ref);
  assert t.evidence_count = 3, format('three documents on the row, got %s', t.evidence_count);
  assert t.has_payment_proof, 'the proof is a transfer proof';

  -- Every inbox row closed against the same row.
  select count(*) into n from ops_acct.evidence_inbox
   where ref_id like 'ev286%' and ref_id not in ('ev286s~x0','ev286a~x0','ev286b~x0')
     and status in ('CONFIRMED','ATTACHED') and produced_trx_no = t.trx_no;
  assert n = 4, format('four inbox rows closed, got %s', n);

  -- The nota's items point at the nota, not at the transfer.
  select count(*) into v_nota_lines from ops_acct.transaction_lines l
   where l.trx_id = t.id and l.attachment_id in ('44440000-0000-0000-0000-000000000287');
  assert v_nota_lines = 2, format('lines point at the nota, got %s', v_nota_lines);

  select * into d from ops_acct.draft_decisions where draft_key = 'ev286t~x0';
  assert d.decision = 'confirmed' and d.road = 'transaction' and d.level = 'hi' and d.score = 94, 'decision';
  assert d.trx_no = t.trx_no and cardinality(d.ref_ids) = 4, format('decision refs %s', d.ref_ids);
  assert (d.proposed ->> 'amount')::numeric = 1360000 and (d.booked ->> 'amount')::numeric = 1360000, 'proposed and booked';

  -- A replay answers what it answered; a second confirm is refused.
  r := ops_acct.confirm_draft('ev286t~x0', '[["ev286t~x0"],["ev286n~x0","ev286n~x1"],["ev286p~x0"]]',
                              'transaction', 'BCA 271', 1360000, p_key => 'k-286');
  assert r ->> 'outcome' = 'duplicate', format('got %s', r);
  r := ops_acct.confirm_draft('ev286t~x0', '[["ev286t~x0"]]', 'transaction', 'BCA 271', 1360000);
  assert r -> 'error' ->> 'code' = 'already_resolved', format('got %s', r);
  select count(*) into n from ops_acct.transactions where source_ref like 'inbox:ev286%';
  assert n = 1, format('one row, got %s', n);
end $$;

/* ── a refusal inside the booking rolls everything back ───────────────── */
do $$
declare r jsonb; n int;
begin
  -- The lines do not add up: book_evidence refuses, the photo stays loose.
  r := ops_acct.confirm_draft('ev286b~x0', '[["ev286b~x0"],["ev286a~x0"]]', 'transaction', 'BCA 271', 500000,
                              p_lines => '[{"kind":"item","description":"BAUT","amount":400000}]');
  assert r -> 'error' ->> 'code' = 'lines_do_not_add_up', format('got %s', r);
  select count(*) into n from ops_acct.evidence_inbox where ref_id in ('ev286a~x0','ev286b~x0') and status = 'PENDING';
  assert n = 2, 'both still pending';
end $$;

/* ── ✕ pengelompokan salah: the pair is apart, nothing resolved ────────── */
do $$
declare r jsonb; n int;
begin
  r := ops_acct.split_draft('ev286a~x0', '[["ev286a~x0"]]');
  assert r -> 'error' ->> 'code' = 'nothing_to_split', format('got %s', r);
  r := ops_acct.split_draft('ev286b~x0', '[["ev286b~x0"],["ev286a~x0"]]', null, 'beda vendor');
  assert ops_core.said_ok(r) and (r -> 'data' ->> 'pairs')::int = 1, format('got %s', r);
  select count(*) into n from ops_acct.draft_apart where file_a = 'drive-286-a' and file_b = 'drive-286-b';
  assert n = 1, 'the pair, ordered';
  r := ops_acct.split_draft('ev286b~x0', '[["ev286b~x0"],["ev286a~x0"]]', 0);
  assert ops_core.said_ok(r) and (r -> 'data' ->> 'pairs')::int = 0, format('stored once, got %s', r);
  select count(*) into n from ops_acct.evidence_inbox where ref_id in ('ev286a~x0','ev286b~x0') and status = 'PENDING';
  assert n = 2, 'taking apart decides nothing about the documents';
end $$;

/* ── ✕ bukan transaksi: noted with the reason ─────────────────────────── */
do $$
declare r jsonb; i record;
begin
  r := ops_acct.dismiss_draft('ev286s~x0', '[["ev286s~x0"]]', 'note', '  ');
  assert r -> 'error' ->> 'code' = 'reason_required', format('got %s', r);
  r := ops_acct.dismiss_draft('ev286s~x0', '[["ev286s~x0"]]', 'note', 'tangkapan saldo rekening',
                              '{"level":"loose"}');
  assert ops_core.said_ok(r), format('got %s', r);
  select * into i from ops_acct.evidence_inbox where ref_id = 'ev286s~x0';
  assert i.status = 'NOTED' and i.resolve_note = 'tangkapan saldo rekening', format('got %s', i.status);
  assert exists (select 1 from ops_acct.draft_decisions where draft_key = 'ev286s~x0' and decision = 'noted' and level = 'loose'),
    'the decision';
end $$;

/* ── ✓ link: a late document filed on the row that already exists ────── */
do $$
declare r jsonb; v_trx text; n int;
begin
  select trx_no into v_trx from ops_acct.transactions where source_ref = 'inbox:ev286t~x0';
  r := ops_acct.confirm_draft('ev286a~x0', '[["ev286a~x0"]]', 'link', null, null, p_link_trx_no => v_trx);
  assert ops_core.said_ok(r) and r -> 'data' ->> 'trx_no' = v_trx, format('got %s', r);
  select count(*) into n from ops_acct.evidence_inbox where ref_id = 'ev286a~x0' and status = 'ATTACHED' and produced_trx_no = v_trx;
  assert n = 1, 'attached';
  assert exists (select 1 from ops_acct.draft_decisions where draft_key = 'ev286a~x0' and decision = 'linked' and trx_no = v_trx),
    'the decision';
end $$;

/* ── the person who reads accounting reads the decisions ──────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-00000000e286';
do $$
declare n int;
begin
  select count(*) into n from ops_acct.draft_decisions;
  assert n = 5, format('confirmed, split, detached, noted, linked; got %s', n);
  select count(*) into n from ops_acct.draft_apart;
  assert n = 1, format('one pair, got %s', n);
end $$;

rollback;
