-- acct — the kind of paper a Chat capture is (0276, L3, F272).
--
--   doc_kind_from_reading: explicit doc_kind wins; doc_type words map
--     Payment Proof → transfer_proof, Receiving Item → goods_photo,
--     Others → other; anything else → nota
--   book_evidence files the link with that kind; link_evidence the same

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-00000000e276','rina-dk@talaliving.com','{"full_name":"Rina Dk"}');
insert into ops_core.user_authorities (user_id, authority) values
  ('ffffffff-0000-0000-0000-00000000e276','post_ledger'),
  ('ffffffff-0000-0000-0000-00000000e276','resolve_inbox');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-00000000e276','accounting','write');

do $$
begin
  assert ops_core.doc_kind_from_reading('{"doc_type":"Payment Proof"}') = 'transfer_proof', 'payment proof';
  assert ops_core.doc_kind_from_reading('{"doc_type":"Receiving Item"}') = 'goods_photo', 'receiving item';
  assert ops_core.doc_kind_from_reading('{"doc_type":"Receipt / Invoice / Nota"}') = 'nota', 'nota';
  assert ops_core.doc_kind_from_reading('{"doc_type":"Others"}') = 'other', 'others';
  assert ops_core.doc_kind_from_reading('{"doc_type":"Payment Proof","doc_kind":"rekening_koran"}') = 'rekening_koran', 'an explicit kind wins';
  assert ops_core.doc_kind_from_reading('{"doc_kind":"not-a-kind"}') = 'nota', 'an unknown explicit kind is ignored';
  assert ops_core.doc_kind_from_reading('{}') = 'nota', 'nothing said = nota';
end $$;

insert into ops_core.attachments (id, storage_path, filename, source, uploaded_by) values
  ('aaaa0000-0000-0000-0000-00000000d001','1DkDkDkDkDkDkDkDkDkDkDkDkDkDkDk01','bukti-tf.jpg','chat','ffffffff-0000-0000-0000-00000000e276'),
  ('aaaa0000-0000-0000-0000-00000000d002','1DkDkDkDkDkDkDkDkDkDkDkDkDkDkDk02','foto-barang.jpg','chat','ffffffff-0000-0000-0000-00000000e276');
insert into ops_acct.evidence_inbox (ref_id, origin, status, attachment_id, reported_by, extracted) values
  ('inb-dk-1','chat','PENDING','aaaa0000-0000-0000-0000-00000000d001','ffffffff-0000-0000-0000-00000000e276','{"doc_type":"Payment Proof"}'::jsonb),
  ('inb-dk-2','chat','PENDING','aaaa0000-0000-0000-0000-00000000d002','ffffffff-0000-0000-0000-00000000e276','{"doc_type":"Receiving Item"}'::jsonb);
insert into ops_acct.transactions (id, trx_no, trx_date, account_id, direction, amount_idr, type_code, description, source_ref, posted_by)
select '55550000-0000-0000-0000-000000027601', 'trx-dk-0', '2026-10-10', a.id, 'OUT', 250000, 'SUPPLIERS', 'ENGSEL', 'trx-dk-0', 'ffffffff-0000-0000-0000-00000000e276'
  from ops_acct.accounts a where a.code = 'PETTY CASH';

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-00000000e276';
do $$
declare r jsonb; v_trx text; k text;
begin
  r := ops_acct.book_evidence('inb-dk-1','PETTY CASH','OUT', 150000, 'BANK CHARGES','ADMIN FEE', '2026-10-10');
  assert r ->> 'outcome' = 'ok', format('book, got %s', r);
  v_trx := r -> 'data' ->> 'trx_no';
  select kind::text into k from ops_core.attachment_links where entity = 'transaction' and entity_no = v_trx and unlinked_at is null;
  assert k = 'transfer_proof', format('a payment proof is filed as one, got %s', k);

  r := ops_acct.link_evidence(array['inb-dk-2'], array['trx-dk-0']);
  assert r ->> 'outcome' = 'ok', format('link, got %s', r);
  select kind::text into k from ops_core.attachment_links where entity = 'transaction' and entity_no = 'trx-dk-0' and unlinked_at is null;
  assert k = 'goods_photo', format('a goods photo is filed as one, got %s', k);
end $$;

rollback;
