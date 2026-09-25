-- prod — one number, the whole purchase→production story (0171).
--
--   semua   production + procurement + inventory + delivery read — sees it all
--   beli    procurement write only — sees the purchase side, told the rest is hidden
--
-- REFUSALS     a PR line naming a JO that does not exist; one naming a
--              cancelled JO; a stock issue whose ref reads like a JO and names
--              none; nobody at all reads the trail without a module; an
--              unknown number
-- DERIVATIONS  the same story opens from the project code, the JO, the PR,
--              the PO, the receiving report and the surat jalan; every stage
--              from request to BAST appears, in time order; a request with no
--              JO is counted as unlinked; an opname ref that is not a JO is
--              not held to naming one

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-000000171001','semua-trail@talaliving.com','{"full_name":"Semua"}'),
  ('ffffffff-0000-0000-0000-000000171002','beli-trail@talaliving.com','{"full_name":"Beli"}'),
  ('ffffffff-0000-0000-0000-000000171003','luar-trail@talaliving.com','{"full_name":"Luar"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-000000171001','production','read'),
  ('ffffffff-0000-0000-0000-000000171001','procurement','read'),
  ('ffffffff-0000-0000-0000-000000171001','inventory','read'),
  ('ffffffff-0000-0000-0000-000000171001','delivery','read'),
  ('ffffffff-0000-0000-0000-000000171002','procurement','write');

insert into ops_core.attachments (id, storage_path, filename, uploaded_by) values
  ('17100000-0000-0000-0000-00000000f001','drive/bast-trail.pdf','bast.pdf','ffffffff-0000-0000-0000-000000171001');

insert into ops_procure.vendors (id, code, name) values
  ('17100000-0000-0000-0000-0000000000a1','V-8171','Toko Kayu Jejak');
insert into ops_procure.items (id, code, name, category_code, base_uom, kind) values
  ('17100000-0000-0000-0000-0000000000e1','I-8171','Plywood 18mm','production','pcs','goods');
insert into ops_prod.products (product_code, name, category, uom) values ('TR-LMR','Lemari jejak','Lemari','unit');
insert into ops_procure.projects (id, code, name, is_active) values
  ('17100000-0000-0000-0000-0000000000b1','TR-P1','Villa Jejak', true);
insert into ops_procure.project_lines (id, project_id, line_no, product_code, description, qty, uom) values
  ('17100000-0000-0000-0000-0000000000c1','17100000-0000-0000-0000-0000000000b1', 1, 'TR-LMR','Lemari', 2,'unit');
insert into ops_prod.work_orders (wo_no, product_code, item_name, qty, uom, route, due_date, project_code, project_line_id, created_by) values
  ('spk-tr-1','TR-LMR','Lemari jejak', 2,'unit','IN_HOUSE', current_date + 9, 'TR-P1',
   '17100000-0000-0000-0000-0000000000c1','ffffffff-0000-0000-0000-000000171001');
insert into ops_prod.work_orders (wo_no, product_code, item_name, qty, uom, route, due_date, status, cancelled_reason, created_by) values
  ('spk-tr-x','TR-LMR','Lemari batal', 1,'unit','IN_HOUSE', current_date + 9, 'CANCELLED','klien mundur',
   'ffffffff-0000-0000-0000-000000171001');

insert into ops_procure.pr_documents (id, doc_no, status, requested_by, project_id, submitted_at) values
  ('17100000-0000-0000-0000-0000000000d1','pr-tr-1','SUBMITTED','ffffffff-0000-0000-0000-000000171002',
   '17100000-0000-0000-0000-0000000000b1', now() - interval '5 days');

/* ── REFUSALS at the write ── */
do $$
begin
  begin
    insert into ops_procure.pr_lines (doc_id, doc_no, line_no, item_id, description, qty, uom, unit_price, item_total, source_wo_no)
    values ('17100000-0000-0000-0000-0000000000d1','pr-tr-1', 9, null,'x', 1,'pcs', 1, 1,'spk-tr-typo');
    raise exception 'a JO that does not exist must be refused';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into ops_procure.pr_lines (doc_id, doc_no, line_no, item_id, description, qty, uom, unit_price, item_total, source_wo_no)
    values ('17100000-0000-0000-0000-0000000000d1','pr-tr-1', 9, null,'x', 1,'pcs', 1, 1,'spk-tr-x');
    raise exception 'a cancelled JO must be refused';
  exception when check_violation then null;
  end;
  begin
    insert into ops_inv.stock_moves (item_code, location, kind, qty, uom, ref_no, moved_by)
    values ('I-8171','GUDANG','issue', -1,'pcs','spk-tr-nope','ffffffff-0000-0000-0000-000000171001');
    raise exception 'an issue against a JO that does not exist must be refused';
  exception when foreign_key_violation then null;
  end;
end $$;

-- An opname sheet reference is not a JO and is not held to naming one.
insert into ops_inv.stock_moves (item_code, location, kind, qty, uom, ref_no, reason, moved_by)
values ('I-8171','GUDANG','adjust', 1,'pcs','OPN-TR-1','Opname awal','ffffffff-0000-0000-0000-000000171001');

/* ── the chain ── */
insert into ops_procure.pr_lines (id, doc_id, doc_no, line_no, item_id, description, qty, uom, unit_price, item_total, vendor_id, source_wo_no) values
  ('17100000-0000-0000-0000-0000000000f1','17100000-0000-0000-0000-0000000000d1','pr-tr-1', 1,
   '17100000-0000-0000-0000-0000000000e1','Plywood 18mm', 4,'pcs', 250000, 1000000,'17100000-0000-0000-0000-0000000000a1','spk-tr-1'),
  -- on the project's request but for no JO: counted as unlinked
  ('17100000-0000-0000-0000-0000000000f2','17100000-0000-0000-0000-0000000000d1','pr-tr-1', 2,
   null,'Ongkos angkut', 1,'pcs', 50000, 50000,'17100000-0000-0000-0000-0000000000a1', null);

insert into ops_procure.purchase_orders (id, po_no, vendor_id, status, created_by, created_at) values
  ('17100000-0000-0000-0000-000000000011','po-tr-1','17100000-0000-0000-0000-0000000000a1','DRAFT',
   'ffffffff-0000-0000-0000-000000171002', now() - interval '4 days');
insert into ops_procure.po_lines (id, po_id, line_no, item_id, description, qty, uom, unit_price, line_total, pr_line_id) values
  ('17100000-0000-0000-0000-000000000012','17100000-0000-0000-0000-000000000011', 1,
   '17100000-0000-0000-0000-0000000000e1','Plywood 18mm', 4,'pcs', 250000, 1000000,'17100000-0000-0000-0000-0000000000f1');

insert into ops_procure.receipts (receipt_no, po_line_id, qty_received, condition, received_by, received_at) values
  ('rcv-tr-1','17100000-0000-0000-0000-000000000012', 4,'GOOD','ffffffff-0000-0000-0000-000000171002', now() - interval '3 days');
update ops_procure.receipts set status = 'CONFIRMED', confirmed_by = 'ffffffff-0000-0000-0000-000000171002', confirmed_at = now()
 where receipt_no = 'rcv-tr-1';

insert into ops_inv.stock_moves (item_code, location, kind, qty, uom, ref_no, moved_by, moved_at)
values ('I-8171','GUDANG','issue', -4,'pcs','spk-tr-1','ffffffff-0000-0000-0000-000000171001', now() - interval '2 days');
insert into ops_inv.product_moves (product_code, location, kind, qty, wo_no, project_line_id, moved_by, moved_at)
values ('TR-LMR','GUDANG','produced', 2,'spk-tr-1','17100000-0000-0000-0000-0000000000c1',
        'ffffffff-0000-0000-0000-000000171001', now() - interval '1 day');

insert into ops_dlv.deliveries (id, delivery_no, project_code, dispatched_on, status) values
  ('17100000-0000-0000-0000-000000000021','krm-tr-1','TR-P1', current_date, 'IN_TRANSIT');
insert into ops_dlv.delivery_lines (delivery_id, project_line_id, description, qty, uom) values
  ('17100000-0000-0000-0000-000000000021','17100000-0000-0000-0000-0000000000c1','Lemari', 2,'unit');
insert into ops_dlv.handovers (project_code, handed_on, client_rep, our_rep, bast_attachment_id) values
  ('TR-P1', current_date, 'Pak Klien', 'Rian', '17100000-0000-0000-0000-00000000f001');

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000171001';

do $$
declare r jsonb; n text; stages text[]; ev jsonb;
begin
  foreach n in array array['TR-P1','spk-tr-1','pr-tr-1','po-tr-1','rcv-tr-1','krm-tr-1'] loop
    r := ops_prod.job_trail(n);
    assert r->>'outcome' = 'ok', n || ' opens, got ' || r::text;
    assert r->'data'->'project'->>'code' = 'TR-P1', n || ' finds the project, got ' || (r->'data'->'project')::text;
    assert (r->'data'->'job_orders') @> '[{"wo_no":"spk-tr-1"}]', n || ' finds the JO';
    select array_agg(distinct e->>'stage') into stages from jsonb_array_elements(r->'data'->'events') e;
    assert stages @> array['job_order','purchase_request','purchase_order','receipt','stock_in','issue',
                           'finished','delivery','handover'], n || ' tells every stage, got ' || stages::text;
    assert jsonb_array_length(r->'data'->'hidden') = 0, 'nothing hidden from somebody who reads it all';
    assert (r->'data'->>'unlinked_purchase_lines')::int = 1, 'the freight line has no JO';
  end loop;

  r := ops_prod.job_trail('rcv-tr-1');
  assert r->'data'->>'resolved_as' = 'receipt', 'says what the number was';
  -- in time order: the request before the order before the receipt before the BAST
  select jsonb_agg(e->>'stage') into ev from jsonb_array_elements(r->'data'->'events') e
   where e->>'stage' in ('purchase_request','purchase_order','receipt','handover')
     and (e->>'wo_no' = 'spk-tr-1' or e->>'stage' = 'handover');
  assert ev = '["purchase_request","purchase_order","receipt","handover"]'::jsonb, 'in order, got ' || ev::text;
  -- the stock came in against the receipt, the issue went out against the JO
  assert exists (select 1 from jsonb_array_elements(r->'data'->'events') e
                  where e->>'stage' = 'stock_in' and e->>'doc_no' = 'rcv-tr-1' and (e->>'qty')::numeric = 4),
    'receipt → stock';
  assert exists (select 1 from jsonb_array_elements(r->'data'->'events') e
                  where e->>'stage' = 'issue' and e->>'wo_no' = 'spk-tr-1' and e->>'item_code' = 'I-8171'),
    'stock → JO, by item code';

  r := ops_prod.job_trail('nope-123');
  assert r->'error'->>'code' = 'not_found', 'unknown number, got ' || r::text;
  r := ops_prod.job_trail('  ');
  assert r->'error'->>'code' = 'number_required', 'blank, got ' || r::text;
end $$;

reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000171002';

do $$
declare r jsonb; stages text[];
begin
  r := ops_prod.job_trail('po-tr-1');
  assert r->>'outcome' = 'ok', 'procurement opens its own PO, got ' || r::text;
  select array_agg(distinct e->>'stage') into stages from jsonb_array_elements(r->'data'->'events') e;
  assert stages <@ array['purchase_request','purchase_order','receipt'], 'only the purchase side, got ' || stages::text;
  assert (r->'data'->'hidden') @> '["job_order","issue","delivery"]', 'and told what is hidden, got ' || (r->'data'->'hidden')::text;
end $$;

reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000171003';

do $$
begin
  assert (ops_prod.job_trail('TR-P1'))->'error'->>'code' = 'not_permitted', 'no module, no trail';
end $$;

rollback;
