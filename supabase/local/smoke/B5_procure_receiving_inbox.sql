-- procure — the RECEIVING REPORT space, matched to the ledger or to an order,
-- and the order's payment request paid on the order (0203, D358).
--
--   REFUSALS     filing with no file, a file with no source id, nobody to
--                record it against; reading or matching without procurement;
--                money coming IN, a match with no photo, a file from another
--                message, one file as two things, an item that is not counted,
--                an asset in an unknown category; an order not open, a line
--                from another order; a second match; dismissing with no reason;
--                asking for more than is billable, asking twice
--   DERIVATIONS  a second filing merges (files, then the AI's reading) and a
--                third adds nothing; an unknown sender is kept by name; the
--                ledger row gets its item photo and receiving report, the rack
--                its material, the register its assets; the order gets a
--                CONFIRMED receipt per line and billable moves; the request is
--                raised against the order and submitted; paying it reaches the
--                order (PARTIAL), once

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('b5000000-0000-0000-0000-0000000000a1','buyer-rcv@talaliving.com','{"full_name":"Andi Uji"}'),
  ('b5000000-0000-0000-0000-0000000000a2','boss-rcv@talaliving.com','{"full_name":"Bos Uji"}'),
  ('b5000000-0000-0000-0000-0000000000a3','fin-rcv@talaliving.com','{"full_name":"Rina Uji"}'),
  ('b5000000-0000-0000-0000-0000000000a4','view-rcv@talaliving.com','{"full_name":"Lihat Saja"}'),
  ('b5000000-0000-0000-0000-0000000000a5','luar-rcv@talaliving.com','{"full_name":"Orang Luar"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('b5000000-0000-0000-0000-0000000000a1','procurement','write'),
  ('b5000000-0000-0000-0000-0000000000a2','procurement','write'),
  ('b5000000-0000-0000-0000-0000000000a3','procurement','read'),
  ('b5000000-0000-0000-0000-0000000000a3','accounting','write'),
  ('b5000000-0000-0000-0000-0000000000a4','procurement','read');
insert into ops_core.user_authorities (user_id, authority) values
  ('b5000000-0000-0000-0000-0000000000a2','approve_goods'),
  ('b5000000-0000-0000-0000-0000000000a3','post_ledger');

insert into ops_procure.item_categories (code, name) values ('rcv-uji','Bahan (uji)')
  on conflict (code) do nothing;
insert into ops_inv.stocked_categories (category_code) values ('rcv-uji') on conflict do nothing;
insert into ops_procure.items (code, name, category_code, base_uom) values
  ('ITM-RCV1','Lem kuning uji','rcv-uji','lembar');
insert into ops_procure.vendors (id, code, name, is_curated) values
  ('b5000000-0000-0000-0000-00000000ee01','V-RCV1','TOKO TERIMA', true);

-- Two ledger rows: a purchase, and money coming in.
insert into ops_acct.transactions
  (trx_no, trx_date, account_id, direction, amount_idr, type_code, vendor_id, description, source_ref, posted_by)
select x.no, ops_core.office_day(), (select id from ops_acct.accounts where code = 'BCA 271'), x.dir::ops_acct.direction_t,
       x.amt, 'SUPPLIERS', 'b5000000-0000-0000-0000-00000000ee01', x.d, 'smoke-b5-' || x.no,
       'b5000000-0000-0000-0000-0000000000a3'
  from (values ('trx-b5-out', 'OUT', 3000000, 'Beli lem dan bor'),
               ('trx-b5-in',  'IN',  1000000, 'Setoran')) x(no, dir, amt, d);

create temp table t_ctx (k text primary key, v text) on commit drop;
grant all on t_ctx to authenticated;

/* ── 1. filing: the worker has no session ─────────────────────────────── */
do $$
declare r jsonb; rr text; n int;
begin
  r := ops_procure.file_receiving('ev-b5-0', '[]'::jsonb);
  assert r->'error'->>'code' = 'files_required', format('a message with no file: %s', r);
  r := ops_procure.file_receiving('ev-b5-0', '[{"url":"https://drive/x","filename":"x.jpg"}]'::jsonb);
  assert r->'error'->>'code' = 'file_incomplete', format('a file with no source id: %s', r);
  r := ops_procure.file_receiving('ev-b5-0', '[{"url":"https://drive/x","filename":"x.jpg","source_ref":"b0"}]'::jsonb,
         'siapa ini', 'Siapa Saja');
  assert r->'error'->>'code' = 'uploader_unresolved' or ops_core.said_ok(r), format('nobody to record it against: %s', r);

  r := ops_procure.file_receiving('ev-b5-1',
         '[{"url":"https://drive/a","filename":"barang.jpg","source_ref":"blob-a","mime":"image/jpeg"},
           {"url":"https://drive/b","filename":"sheet.jpg","source_ref":"blob-b","mime":"image/jpeg"}]'::jsonb,
         'Lem 5 lembar + bor 2', 'Andi Uji', now() - interval '1 hour');
  assert ops_core.said_ok(r) and (r->'data'->>'files_added')::int = 2, format('filed: %s', r);
  rr := r->'data'->>'rr_no';
  assert rr like 'rr-%', rr;
  insert into t_ctx values ('rr1', rr);
  assert (select reported_by from ops_procure.receiving_inbox where rr_no = rr) = 'b5000000-0000-0000-0000-0000000000a1',
    'the sender resolved by name';

  -- The reading arrives a few seconds later, and one more photo.
  r := ops_procure.file_receiving('ev-b5-1',
         '[{"url":"https://drive/b","filename":"sheet.jpg","source_ref":"blob-b"},
           {"url":"https://drive/c","filename":"lagi.jpg","source_ref":"blob-c"}]'::jsonb,
         null, null, null, '{"doc_kind":"RECEIVING SHEET","vendor":"TOKO TERIMA","lines":[]}'::jsonb);
  assert ops_core.said_ok(r) and (r->'data'->>'files_added')::int = 1 and r->'data'->>'rr_no' = rr,
    format('merged, not duplicated: %s', r);
  select count(*) into n from ops_procure.receiving_inbox_files f join ops_procure.receiving_inbox i on i.id = f.inbox_id
   where i.rr_no = rr;
  assert n = 3, format('three files, got %s', n);
  assert (select extracted->>'vendor' from ops_procure.receiving_inbox where rr_no = rr) = 'TOKO TERIMA', 'reading kept';
  assert (select message from ops_procure.receiving_inbox where rr_no = rr) = 'Lem 5 lembar + bor 2', 'message kept';

  r := ops_procure.file_receiving('ev-b5-1', '[{"url":"https://drive/c","filename":"lagi.jpg","source_ref":"blob-c"}]'::jsonb);
  assert ops_core.said_ok(r) and (r->'data'->>'files_added')::int = 0, format('a third time adds nothing: %s', r);

  r := ops_procure.file_receiving('ev-b5-2',
         '[{"url":"https://drive/d","filename":"po-barang.jpg","source_ref":"blob-d"},
           {"url":"https://drive/e","filename":"tanda-terima.jpg","source_ref":"blob-e"}]'::jsonb, 'Plywood PO', 'buyer-rcv@talaliving.com');
  assert ops_core.said_ok(r), format('%s', r);
  insert into t_ctx values ('rr2', r->'data'->>'rr_no');
  r := ops_procure.file_receiving('ev-b5-3', '[{"url":"https://drive/f","filename":"ok.jpg","source_ref":"blob-f"}]'::jsonb, 'Baik mas', 'Andi Uji');
  insert into t_ctx values ('rr3', r->'data'->>'rr_no');
end $$;

set local role authenticated;

/* ── 2. who may read and act ─────────────────────────────────────────────── */
set local request.jwt.claim.sub = 'b5000000-0000-0000-0000-0000000000a5';
do $$
declare r jsonb;
begin
  r := ops_procure.receiving_candidates((select v from t_ctx where k = 'rr1'));
  assert r->'error'->>'code' = 'not_permitted', format('outsider: %s', r);
  assert (select count(*) from ops_procure.v_receiving_inbox) = 0, 'RLS: nothing to read';
  r := ops_procure.file_receiving('ev-b5-x', '[{"url":"u","filename":"f","source_ref":"s"}]'::jsonb);
  assert r->'error'->>'code' = 'not_permitted', format('a person filing needs procurement: %s', r);
end $$;

set local request.jwt.claim.sub = 'b5000000-0000-0000-0000-0000000000a4';
do $$
declare r jsonb; rr text := (select v from t_ctx where k = 'rr1'); v record;
begin
  r := ops_procure.receiving_candidates(rr);
  assert ops_core.said_ok(r), format('procurement reads: %s', r);
  assert exists (select 1 from jsonb_array_elements(r->'data'->'transactions') t where t->>'trx_no' = 'trx-b5-out'),
    format('the purchase is a candidate: %s', r);
  assert not exists (select 1 from jsonb_array_elements(r->'data'->'transactions') t where t->>'trx_no' = 'trx-b5-in'),
    'money coming in is not';
  assert (r->'data'->'transactions'->0->>'vendor_hit')::boolean, 'the vendor the AI read comes first';

  select * into v from ops_procure.v_receiving_inbox where rr_no = rr;
  assert v.status = 'PENDING' and jsonb_array_length(v.files) = 3 and v.sender_name = 'Andi Uji',
    format('the screen''s row: %s', to_jsonb(v));

  r := ops_procure.match_receiving_to_trx(rr, 'trx-b5-out',
         array[(v.files->0->>'attachment_id')::uuid]);
  assert r->'error'->>'code' = 'not_permitted', format('read is not write: %s', r);
  r := ops_procure.dismiss_receiving(rr, 'x');
  assert r->'error'->>'code' = 'not_permitted', format('%s', r);
end $$;

/* ── 3. road 1: to a ledger transaction ─────────────────────────────────── */
set local request.jwt.claim.sub = 'b5000000-0000-0000-0000-0000000000a1';
do $$
declare r jsonb; rr text := (select v from t_ctx where k = 'rr1'); rr2 text := (select v from t_ctx where k = 'rr2');
        fa uuid; fb uuid; fc uuid; other uuid; n int;
begin
  select (files->0->>'attachment_id')::uuid, (files->1->>'attachment_id')::uuid, (files->2->>'attachment_id')::uuid
    into fa, fb, fc from ops_procure.v_receiving_inbox where rr_no = rr;
  select (files->0->>'attachment_id')::uuid into other from ops_procure.v_receiving_inbox where rr_no = rr2;

  r := ops_procure.match_receiving_to_trx(rr, 'trx-b5-in', array[fa]);
  assert r->'error'->>'code' = 'not_a_purchase', format('%s', r);
  r := ops_procure.match_receiving_to_trx(rr, 'trx-tidak-ada', array[fa]);
  assert r->>'status' = '404', format('%s', r);
  r := ops_procure.match_receiving_to_trx(rr, 'trx-b5-out', '{}'::uuid[]);
  assert r->'error'->>'code' = 'photo_required', format('%s', r);
  r := ops_procure.match_receiving_to_trx(rr, 'trx-b5-out', array[other]);
  assert r->'error'->>'code' = 'file_not_on_report', format('%s', r);
  r := ops_procure.match_receiving_to_trx(rr, 'trx-b5-out', array[fa], array[fa]);
  assert r->'error'->>'code' = 'file_twice', format('%s', r);
  r := ops_procure.match_receiving_to_trx(rr, 'trx-b5-out', array[fa], '{}',
         '[{"kind":"material","item_code":"ITM-TIDAK-ADA","qty":1}]');
  assert r->'error'->>'code' = 'item_not_stocked', format('%s', r);
  r := ops_procure.match_receiving_to_trx(rr, 'trx-b5-out', array[fa], '{}',
         '[{"kind":"material","item_code":"ITM-RCV1","qty":1},{"kind":"material","item_code":"ITM-RCV1","qty":2}]');
  assert r->'error'->>'code' = 'item_twice', format('%s', r);
  r := ops_procure.match_receiving_to_trx(rr, 'trx-b5-out', array[fa], '{}',
         '[{"kind":"asset","name":"Bor","category_code":"tidak-ada"}]');
  assert r->'error'->>'code' = 'category_unknown', format('%s', r);
  assert (select status from ops_procure.receiving_inbox where rr_no = rr) = 'PENDING', 'refusals wrote nothing';
  assert not exists (select 1 from ops_inv.stock_moves where ref_no = rr), 'and stocked nothing';

  r := ops_procure.match_receiving_to_trx(rr, 'trx-b5-out', array[fa, fc], array[fb],
         '[{"kind":"material","item_code":"ITM-RCV1","qty":5},
           {"kind":"asset","name":"Bor listrik","category_code":"computer","count":2,"unit_cost":750000}]',
         'cocok dengan nota');
  assert ops_core.said_ok(r), format('matched: %s', r);
  assert jsonb_array_length(r->'data'->'asset_nos') = 2 and jsonb_array_length(r->'data'->'move_nos') = 1, format('%s', r);

  select count(*) into n from ops_core.attachment_links
   where entity = 'transaction' and entity_no = 'trx-b5-out' and kind = 'goods_photo' and unlinked_at is null;
  assert n = 2, format('the ledger row has its item photos, got %s', n);
  select count(*) into n from ops_core.attachment_links
   where entity = 'transaction' and entity_no = 'trx-b5-out' and kind = 'receiving_report' and unlinked_at is null;
  assert n = 1, format('and its receiving report, got %s', n);

  assert (select status::text || matched_to || trx_no from ops_procure.receiving_inbox where rr_no = rr)
       = 'MATCHEDtransactiontrx-b5-out', 'the row is matched';

  r := ops_procure.match_receiving_to_trx(rr, 'trx-b5-out', array[fa]);
  assert r->'error'->>'code' = 'already_resolved', format('once: %s', r);
end $$;

-- The rack and the register are inventory's to read; checked as the owner.
reset role;
do $$
declare rr text := (select v from t_ctx where k = 'rr1');
begin
  assert (select qty from ops_inv.stock_moves where ref_no = rr and item_code = 'ITM-RCV1' and kind = 'receipt') = 5,
    'the material is on the rack';
  assert (select count(*) from ops_inv.assets where trx_no = 'trx-b5-out' and name = 'Bor listrik'
           and purchase_cost = 750000 and vendor_code = 'V-RCV1') = 2, 'two assets carry the purchase';
  assert (select count(*) from ops_core.attachment_links k join ops_inv.assets a on a.asset_no = k.entity_no
           where k.entity = 'asset' and a.trx_no = 'trx-b5-out') = 2, 'each with its photo';

end $$;
set local role authenticated;
set local request.jwt.claim.sub = 'b5000000-0000-0000-0000-0000000000a1';

/* ── 4. road 2: to a purchase order ─────────────────────────────────────── */
do $$
declare r jsonb;
begin
  r := ops_procure.create_po('V-RCV1', jsonb_build_array(
        jsonb_build_object('description','Plywood 18mm','qty',10,'uom','lembar','unit_price',100000),
        jsonb_build_object('description','Ongkir','qty',1,'uom','unit','unit_price',200000)));
  assert ops_core.said_ok(r), format('po: %s', r);
  insert into t_ctx values ('po', r->'data'->>'po_no');
  r := ops_procure.create_po('V-RCV1', jsonb_build_array(
        jsonb_build_object('description','Draft','qty',1,'uom','unit','unit_price',1000)));
  insert into t_ctx values ('draft', r->'data'->>'po_no');
end $$;

set local request.jwt.claim.sub = 'b5000000-0000-0000-0000-0000000000a2';
select ops_procure.approve_po(p_po_no => (select v from t_ctx where k = 'po'));
set local request.jwt.claim.sub = 'b5000000-0000-0000-0000-0000000000a1';
select ops_procure.issue_po((select v from t_ctx where k = 'po'));

do $$
declare r jsonb; rr text := (select v from t_ctx where k = 'rr2'); po text := (select v from t_ctx where k = 'po');
        fd uuid; fe uuid; l1 uuid; foreign_line uuid; c jsonb;
begin
  select (files->0->>'attachment_id')::uuid, (files->1->>'attachment_id')::uuid into fd, fe
    from ops_procure.v_receiving_inbox where rr_no = rr;
  select o.id into l1 from ops_procure.po_lines o join ops_procure.purchase_orders p on p.id = o.po_id
   where p.po_no = po and o.line_no = 1;
  select o.id into foreign_line from ops_procure.po_lines o join ops_procure.purchase_orders p on p.id = o.po_id
   where p.po_no = (select v from t_ctx where k = 'draft');
  insert into t_ctx values ('l1', l1::text);

  c := ops_procure.receiving_candidates(rr, 'TERIMA');
  assert exists (select 1 from jsonb_array_elements(c->'data'->'orders') o where o->>'po_no' = po),
    format('the issued order is offered: %s', c);
  assert not exists (select 1 from jsonb_array_elements(c->'data'->'orders') o
                      where o->>'po_no' = (select v from t_ctx where k = 'draft')), 'a draft is not';

  r := ops_procure.match_receiving_to_po(rr, (select v from t_ctx where k = 'draft'),
         jsonb_build_array(jsonb_build_object('po_line_id', foreign_line, 'qty', 1)), array[fd]);
  assert r->'error'->>'code' = 'order_not_open', format('%s', r);
  r := ops_procure.match_receiving_to_po(rr, po,
         jsonb_build_array(jsonb_build_object('po_line_id', foreign_line, 'qty', 1)), array[fd]);
  assert r->'error'->>'code' = 'line_not_on_order', format('%s', r);
  r := ops_procure.match_receiving_to_po(rr, po,
         jsonb_build_array(jsonb_build_object('po_line_id', l1, 'qty', 0)), array[fd]);
  assert r->'error'->>'code' = 'line_not_on_order', format('zero: %s', r);
  r := ops_procure.match_receiving_to_po(rr, po,
         jsonb_build_array(jsonb_build_object('po_line_id', l1, 'qty', 4, 'condition', 'BAGUS')), array[fd]);
  assert r->'error'->>'code' = 'condition_unknown', format('%s', r);
  r := ops_procure.match_receiving_to_po(rr, po, '[]'::jsonb, array[fd]);
  assert r->'error'->>'code' = 'lines_required', format('%s', r);
  r := ops_procure.match_receiving_to_po(rr, po,
         jsonb_build_array(jsonb_build_object('po_line_id', l1, 'qty', 4)), '{}'::uuid[]);
  assert r->'error'->>'code' = 'photo_required', format('%s', r);

  -- Nothing billable before anything arrived.
  r := ops_procure.request_po_payment(po);
  assert r->'error'->>'code' = 'nothing_billable', format('%s', r);

  r := ops_procure.match_receiving_to_po(rr, po,
         jsonb_build_array(jsonb_build_object('po_line_id', l1, 'qty', 4)), array[fd], array[fe]);
  assert ops_core.said_ok(r) and r->'data'->>'status' = 'CONFIRMED', format('matched to the order: %s', r);
  assert (r->'data'->>'billable_now')::numeric = 400000, format('4 of 10 at 100.000 is billable: %s', r);
  assert (select count(*) from ops_procure.receipts where po_line_id = l1 and status = 'CONFIRMED' and qty_received = 4) = 1,
    'one confirmed receipt on the line';
  assert (select count(*) from ops_core.attachment_links k
           where k.entity = 'receipt' and k.entity_no = r->'data'->'receipt_nos'->>0
             and k.kind in ('goods_photo','delivery_note')) = 2, 'carrying the photo and the tanda terima';
  assert (select po_no from ops_procure.receiving_inbox where rr_no = rr) = po, 'the row names the order';
end $$;

/* ── 5. the payment request, and the money reaching the order ──────────── */
set local request.jwt.claim.sub = 'b5000000-0000-0000-0000-0000000000a4';
do $$
declare r jsonb;
begin
  r := ops_procure.request_po_payment((select v from t_ctx where k = 'po'));
  assert r->'error'->>'code' = 'not_permitted', format('%s', r);
end $$;

set local request.jwt.claim.sub = 'b5000000-0000-0000-0000-0000000000a1';
do $$
declare r jsonb; po text := (select v from t_ctx where k = 'po'); ln text;
begin
  r := ops_procure.request_po_payment(po, 500000);
  assert r->'error'->>'code' = 'over_billable' and (r->'error'->'detail'->>'available')::numeric = 400000,
    format('%s', r);
  r := ops_procure.request_po_payment(po, null, 'termin 1');
  assert ops_core.said_ok(r) and (r->'data'->>'amount')::numeric = 400000, format('requested: %s', r);
  ln := r->'data'->>'line_no';
  insert into t_ctx values ('line', ln);
  assert (select p.po_no from ops_procure.pr_lines l join ops_procure.purchase_orders p on p.id = l.against_po_id
           where l.line_no_full = ln) = po, 'raised against the order';
  assert (select d.status::text from ops_procure.pr_documents d join ops_procure.pr_lines l on l.doc_id = d.id
           where l.line_no_full = ln) <> 'DRAFT', 'and submitted, so it reaches the meeting';

  r := ops_procure.request_po_payment(po);
  assert r->'error'->>'code' = 'nothing_billable', format('asked for once: %s', r);
end $$;

set local request.jwt.claim.sub = 'b5000000-0000-0000-0000-0000000000a2';
select ops_procure.approve_line((select v from t_ctx where k = 'line'), true, null, null, null, null);

set local request.jwt.claim.sub = 'b5000000-0000-0000-0000-0000000000a3';
do $$
declare r jsonb; po text := (select v from t_ctx where k = 'po'); ln text := (select v from t_ctx where k = 'line');
        att uuid; s record;
begin
  r := ops_core.attach_file('t/bukti-b5.jpg','bukti.jpg','image/jpeg',1000,null,'upload');
  att := (r->'data'->>'attachment_id')::uuid;
  r := ops_acct.post_from_line(p_line_no => ln, p_amount => 400000,
        p_account_code => 'BCA 271', p_type_code => 'SUPPLIERS', p_attachment_id => att);
  assert ops_core.said_ok(r), format('paid: %s', r);

  assert (select po_no from ops_acct.payment_allocations where pr_line_no = ln and superseded_by is null) = po,
    'a line against an order is paid on the order';
  select * into s from ops_procure.v_po_status where po_no = po;
  assert s.paid_to_date = 400000 and s.payment_state = 'PARTIAL',
    format('the order reads the payment once: %s %s', s.paid_to_date, s.payment_state);
  assert (select covered from ops_procure.v_line_coverage where line_no_full = ln) = 400000, 'and so does the line';
end $$;

set local request.jwt.claim.sub = 'b5000000-0000-0000-0000-0000000000a1';
do $$
declare r jsonb;
begin
  r := ops_procure.request_po_payment((select v from t_ctx where k = 'po'));
  assert r->'error'->>'code' = 'nothing_billable', format('paid is not billable again: %s', r);
end $$;

/* ── 6. the aside ───────────────────────────────────────────────────────── */
do $$
declare r jsonb; rr text := (select v from t_ctx where k = 'rr3');
begin
  r := ops_procure.dismiss_receiving(rr, '  ');
  assert r->'error'->>'code' = 'reason_required', format('%s', r);
  r := ops_procure.dismiss_receiving(rr, 'balasan chat, bukan kiriman');
  assert ops_core.said_ok(r), format('%s', r);
  assert (select status::text from ops_procure.v_receiving_inbox where rr_no = rr) = 'DISMISSED', 'set aside';
  r := ops_procure.dismiss_receiving(rr, 'lagi');
  assert r->'error'->>'code' = 'already_resolved', format('%s', r);
end $$;

rollback;
