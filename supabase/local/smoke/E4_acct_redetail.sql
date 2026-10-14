-- acct — re-detailing a lumped row (0273, L12, D434).
--
--   set_transaction_lines: one line of 1.002.500 becomes item 1.000.000 +
--     fee 2.500; the amount does not move; the old detail is in the trail;
--     lines_reviewed_at is stamped and the row leaves the queue
--   p_lines null: confirmed as is — stamped, lines untouched
--   REFUSALS  lines that do not add up to the amount; a negative amount; an
--             unknown kind; a VOID row; a statement-matched row; without
--             post_ledger
--   READS     v_redetail_queue lists the lumped rows and not the reviewed;
--             v_transaction_line carries trx_no and item names

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-00000000e273','rina-rd@talaliving.com','{"full_name":"Rina Rd"}'),
  ('ffffffff-0000-0000-0000-00000000e27c','andi-rd@talaliving.com','{"full_name":"Andi Rd"}');
insert into ops_core.user_authorities (user_id, authority) values
  ('ffffffff-0000-0000-0000-00000000e273','post_ledger');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-00000000e273','accounting','write'),
  ('ffffffff-0000-0000-0000-00000000e27c','accounting','read');

insert into ops_procure.vendors (id, code, name, is_curated) values
  ('11110000-0000-0000-0000-00000000e273','V-7273','TOKO RD UJI', true);
insert into ops_procure.items (id, code, name, category_code, base_uom) values
  ('22220000-0000-0000-0000-00000000e274','I-7274','Engsel uji','finishing','pcs');
insert into ops_core.attachments (id, storage_path, filename, uploaded_by) values
  ('44440000-0000-0000-0000-00000000e273','a/nota-rd.jpg','nota-rd.jpg','ffffffff-0000-0000-0000-00000000e273');
insert into ops_core.attachment_links (attachment_id, entity, entity_no, kind, linked_by) values
  ('44440000-0000-0000-0000-00000000e273','transaction','trx-rd-1','nota','ffffffff-0000-0000-0000-00000000e273'),
  ('44440000-0000-0000-0000-00000000e273','transaction','trx-rd-2','nota','ffffffff-0000-0000-0000-00000000e273'),
  ('44440000-0000-0000-0000-00000000e273','transaction','trx-rd-4','nota','ffffffff-0000-0000-0000-00000000e273');

insert into ops_acct.transactions (id, trx_no, trx_date, account_id, direction, amount_idr,
                                   type_code, vendor_id, description, source_ref, posted_by)
select v.id::uuid, v.no, v.d::date, a.id, 'OUT', v.amt, v.ty,
       '11110000-0000-0000-0000-00000000e273', v.no, v.no, 'ffffffff-0000-0000-0000-00000000e273'
  from ops_acct.accounts a,
       (values ('55550000-0000-0000-0000-000000027301','trx-rd-1','2026-10-10', 1002500, 'SUPPLIERS'),  -- one line, fee tail
               ('55550000-0000-0000-0000-000000027302','trx-rd-2','2026-10-11',  450000, 'SUPPLIERS'),  -- one line, purchase
               ('55550000-0000-0000-0000-000000027303','trx-rd-3','2026-10-12',  300000, 'SUPPLIERS'),  -- no document: not queued
               ('55550000-0000-0000-0000-000000027304','trx-rd-4','2025-12-30',  200000, 'SUPPLIERS')   -- 2025: not queued
       ) v(id, no, d, amt, ty)
 where a.code = 'BCA 271';
insert into ops_acct.transaction_lines (trx_id, line_no, description, qty, uom, unit_price, amount) values
  ('55550000-0000-0000-0000-000000027301', 1, 'ENGSEL 100 PCS', 1, 'pcs', 1002500, 1002500),
  ('55550000-0000-0000-0000-000000027302', 1, 'KAYU', 1, 'pcs', 450000, 450000);

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-00000000e27c';
do $$
declare r jsonb;
begin
  r := ops_acct.set_transaction_lines('trx-rd-1');
  assert r -> 'error' ->> 'code' = 'authority_required', format('reading is not rewriting, got %s', r);
end $$;

set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-00000000e273';
do $$
declare r jsonb; q text[]; k text[]; a record;
begin
  -- the queue: the two documented 2026 rows, the undocumented and the 2025 one not
  select array_agg(trx_no order by trx_no) into q from ops_acct.v_redetail_queue where trx_no like 'trx-rd-%';
  assert q = array['trx-rd-1','trx-rd-2'], format('queue, got %s', q);
  assert (select fee_tail from ops_acct.v_redetail_queue where trx_no = 'trx-rd-1'), '…2.500 is a fee tail';
  assert (select single_line and is_purchase from ops_acct.v_redetail_queue where trx_no = 'trx-rd-2'), 'one line of a purchase';

  -- refusals
  r := ops_acct.set_transaction_lines('trx-rd-1', jsonb_build_array(
         jsonb_build_object('kind','item','description','Engsel','qty',100,'unit_price',10000,'amount',1000000)));
  assert r -> 'error' ->> 'code' = 'lines_do_not_add_up', format('got %s', r);
  r := ops_acct.set_transaction_lines('trx-rd-1', jsonb_build_array(
         jsonb_build_object('kind','item','description','Engsel','qty',100,'unit_price',10000,'amount',1005000),
         jsonb_build_object('kind','other','description','x','amount',-2500)));
  assert r -> 'error' ->> 'code' = 'line_amount_negative', format('got %s', r);
  r := ops_acct.set_transaction_lines('trx-rd-1', jsonb_build_array(
         jsonb_build_object('kind','bonus','description','Engsel','amount',1002500)));
  assert r -> 'error' ->> 'code' = 'unknown_line_kind', format('got %s', r);
  r := ops_acct.set_transaction_lines('trx-rd-1', '[]'::jsonb);
  assert r -> 'error' ->> 'code' = 'detail_required', format('got %s', r);
  r := ops_acct.set_transaction_lines('trx-rd-1', jsonb_build_array(
         jsonb_build_object('kind','item','description','Engsel','amount',1000000),
         jsonb_build_object('kind','fee','description','Transfer admin fee','amount',2500)));
  assert r -> 'error' ->> 'code' = 'line_detail_required', format('a purchase item still needs qty and price, got %s', r);

  -- the split
  r := ops_acct.set_transaction_lines('trx-rd-1', jsonb_build_array(
         jsonb_build_object('kind','item','item_id','22220000-0000-0000-0000-00000000e274',
                            'description','Engsel','qty',100,'uom','pcs','unit_price',10000,'amount',1000000),
         jsonb_build_object('description','Transfer admin fee','amount',2500)),
       'biaya admin terlipat');
  assert r ->> 'outcome' = 'ok', format('split, got %s', r);
  assert (select amount_idr from ops_acct.transactions where trx_no = 'trx-rd-1') = 1002500, 'the money did not move';
  select array_agg(kind::text order by line_no) into k from ops_acct.v_transaction_line where trx_no = 'trx-rd-1';
  assert k = array['item','fee'], format('kinds, got %s', k);
  assert (select item_code from ops_acct.v_transaction_line where trx_no = 'trx-rd-1' and line_no = 1) = 'I-7274', 'the item rides along';
  assert (select lines_reviewed_at is not null from ops_acct.transactions where trx_no = 'trx-rd-1'), 'stamped';
  assert (select lines_reviewed_by_name from ops_acct.v_transaction_detail where trx_no = 'trx-rd-1') = 'Rina Rd', 'by whom';
  assert not exists (select 1 from ops_acct.v_redetail_queue where trx_no = 'trx-rd-1'), 'and it left the queue';

  -- sudah benar
  r := ops_acct.set_transaction_lines('trx-rd-2');
  assert r ->> 'outcome' = 'ok' and not (r -> 'data' ->> 'changed')::boolean, format('confirm, got %s', r);
  assert (select count(*) from ops_acct.transaction_lines where trx_id = '55550000-0000-0000-0000-000000027302') = 1, 'untouched';
  assert not exists (select 1 from ops_acct.v_redetail_queue where trx_no like 'trx-rd-%'), 'queue empty';
end $$;

set local role postgres;
do $$
declare a record;
begin
  select * into a from ops_core.audit_log
   where entity_no = 'trx-rd-1' and action = 'set_lines' and outcome = 'ok' order by at desc limit 1;
  assert jsonb_array_length(a.before) = 1 and jsonb_array_length(a.after) = 2, format('old and new detail in the trail: %s / %s', a.before, a.after);
  assert a.before -> 0 ->> 'amount' = '1002500', 'the lump is remembered';
  assert a.reason = 'biaya admin terlipat', 'and the remark';
end $$;

-- a void row and a statement-matched row are refused
set local role postgres;
update ops_acct.transactions set status = 'VOID', void_reason = 'x', void_at = now(),
       void_by = 'ffffffff-0000-0000-0000-00000000e273' where trx_no = 'trx-rd-3';
set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-00000000e273';
do $$
declare r jsonb;
begin
  r := ops_acct.set_transaction_lines('trx-rd-3');
  assert r -> 'error' ->> 'code' = 'transaction_void', format('got %s', r);
end $$;

rollback;
