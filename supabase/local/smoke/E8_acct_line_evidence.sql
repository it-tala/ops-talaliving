-- acct — the document a line was read from (0279, L11, kajian §6.7).
--
--   set_line_evidence points lines at the row's own documents; refuses a
--     document that is not attached to the row, a line that is not there,
--     a VOID row, a reader; null clears; v_transaction_line and
--     v_transaction_detail.lines[] carry it
--   book_evidence fills it: the lines of a captured document point at it

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-00000000e279','rina-le@talaliving.com','{"full_name":"Rina Le"}'),
  ('ffffffff-0000-0000-0000-00000000e27e','andi-le@talaliving.com','{"full_name":"Andi Le"}');
insert into ops_core.user_authorities (user_id, authority) values
  ('ffffffff-0000-0000-0000-00000000e279','post_ledger'),
  ('ffffffff-0000-0000-0000-00000000e279','resolve_inbox');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-00000000e279','accounting','write'),
  ('ffffffff-0000-0000-0000-00000000e27e','accounting','read');

insert into ops_procure.vendors (id, code, name, is_curated) values
  ('11110000-0000-0000-0000-00000000e279','V-7279','TOKO LE UJI', true);
insert into ops_core.attachments (id, storage_path, filename, source, uploaded_by) values
  ('aaaa0000-0000-0000-0000-00000000e279','1LeLeLeLeLeLeLeLeLeLeLeLeLeLeLe01','nota-le.jpg','web','ffffffff-0000-0000-0000-00000000e279'),
  ('aaaa0000-0000-0000-0000-00000000e27a','1LeLeLeLeLeLeLeLeLeLeLeLeLeLeLe02','bukti-le.jpg','web','ffffffff-0000-0000-0000-00000000e279'),
  ('aaaa0000-0000-0000-0000-00000000e27b','1LeLeLeLeLeLeLeLeLeLeLeLeLeLeLe03','lain.jpg','web','ffffffff-0000-0000-0000-00000000e279');
insert into ops_acct.transactions (id, trx_no, trx_date, account_id, direction, amount_idr, type_code, description, source_ref, posted_by)
select '55550000-0000-0000-0000-000000027901', 'trx-le-1', '2026-10-10', a.id, 'OUT', 300000, 'SUPPLIERS', 'ENGSEL DAN CAT', 'trx-le-1', 'ffffffff-0000-0000-0000-00000000e279'
  from ops_acct.accounts a where a.code = 'PETTY CASH';
insert into ops_acct.transaction_lines (trx_id, line_no, kind, description, qty, uom, unit_price, amount) values
  ('55550000-0000-0000-0000-000000027901', 1, 'item', 'ENGSEL', 10, 'pcs', 20000, 200000),
  ('55550000-0000-0000-0000-000000027901', 2, 'item', 'CAT', 1, 'pcs', 100000, 100000);
insert into ops_core.attachment_links (attachment_id, entity, entity_no, kind, linked_by) values
  ('aaaa0000-0000-0000-0000-00000000e279','transaction','trx-le-1','nota','ffffffff-0000-0000-0000-00000000e279'),
  ('aaaa0000-0000-0000-0000-00000000e27a','transaction','trx-le-1','transfer_proof','ffffffff-0000-0000-0000-00000000e279');

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-00000000e279';
do $$
declare r jsonb;
begin
  r := ops_acct.set_line_evidence('trx-le-1', '[{"line_no":1,"attachment_id":"aaaa0000-0000-0000-0000-00000000e279"},{"line_no":2,"attachment_id":"aaaa0000-0000-0000-0000-00000000e279"}]');
  assert r ->> 'outcome' = 'ok' and (r -> 'data' ->> 'changed')::int = 2, format('point two lines, got %s', r);
  assert (select attachment_id from ops_acct.v_transaction_line where trx_no = 'trx-le-1' and line_no = 1) = 'aaaa0000-0000-0000-0000-00000000e279', 'the line view carries it';
  assert (select lines -> 1 ->> 'attachment_id' from ops_acct.v_transaction_detail where trx_no = 'trx-le-1') = 'aaaa0000-0000-0000-0000-00000000e279', 'the detail carries it';

  r := ops_acct.set_line_evidence('trx-le-1', '[{"line_no":2,"attachment_id":"aaaa0000-0000-0000-0000-00000000e27b"}]');
  assert r -> 'error' ->> 'code' = 'document_not_attached', format('a file not on the row, got %s', r);
  r := ops_acct.set_line_evidence('trx-le-1', '[{"line_no":9,"attachment_id":"aaaa0000-0000-0000-0000-00000000e279"}]');
  assert r -> 'error' ->> 'code' = 'no_such_line', format('a line that is not there, got %s', r);
  r := ops_acct.set_line_evidence('trx-le-1', '[]');
  assert r -> 'error' ->> 'code' = 'pointers_required', format('nothing said, got %s', r);

  r := ops_acct.set_line_evidence('trx-le-1', '[{"line_no":2,"attachment_id":null}]');
  assert r ->> 'outcome' = 'ok', format('clear, got %s', r);
  assert (select attachment_id from ops_acct.transaction_lines where trx_id = '55550000-0000-0000-0000-000000027901' and line_no = 2) is null, 'cleared';
  r := ops_acct.set_line_evidence('trx-le-1', '[{"line_no":2,"attachment_id":null}]');
  assert r ->> 'outcome' = 'noop', format('same again, got %s', r);
end $$;

set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-00000000e27e';
do $$
declare r jsonb;
begin
  r := ops_acct.set_line_evidence('trx-le-1', '[{"line_no":1,"attachment_id":null}]');
  assert r -> 'error' ->> 'code' = 'authority_required', format('a reader, got %s', r);
end $$;

-- booking from the inbox: the lines point at the captured document
set local role postgres;
insert into ops_acct.evidence_inbox (ref_id, origin, status, attachment_id, reported_by, extracted) values
  ('inb-le-1','chat','PENDING','aaaa0000-0000-0000-0000-00000000e27b','ffffffff-0000-0000-0000-00000000e279','{"doc_type":"Receipt / Invoice / Nota"}'::jsonb);
set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-00000000e279';
do $$
declare r jsonb; v_trx text;
begin
  r := ops_acct.book_evidence('inb-le-1','PETTY CASH','OUT', 50000, 'SUPPLIERS','PAKU', '2026-10-11', 'V-7279', null,
    '[{"description":"PAKU 5CM","qty":5,"unit_price":10000,"amount":50000}]'::jsonb);
  assert r ->> 'outcome' = 'ok', format('book, got %s', r);
  v_trx := r -> 'data' ->> 'trx_no';
  assert (select attachment_id from ops_acct.v_transaction_line where trx_no = v_trx and line_no = 1) = 'aaaa0000-0000-0000-0000-00000000e27b', 'the line points at the document it came from';
end $$;

-- a void row keeps its pointers
set local role postgres;
update ops_acct.transactions set status = 'VOID', void_reason = 'x', void_at = now(), void_by = 'ffffffff-0000-0000-0000-00000000e279' where trx_no = 'trx-le-1';
set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-00000000e279';
do $$
declare r jsonb;
begin
  r := ops_acct.set_line_evidence('trx-le-1', '[{"line_no":1,"attachment_id":null}]');
  assert r -> 'error' ->> 'code' = 'transaction_void', format('got %s', r);
end $$;

rollback;
