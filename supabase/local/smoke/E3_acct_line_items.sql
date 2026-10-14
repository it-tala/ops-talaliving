-- acct — the item travels with the payment (0272, L5, D86).
--
--   post_from_line: the ledger line carries the request line's item_id,
--     kind item; the catalogue's purchase history (item_purchases) shows it
--   post_to_po, the whole contract on an unpaid order: one ledger line per
--     order line with its item; the lines add up to the money
--   post_to_po, a term payment: one `other` line, no items invented
--   v_transaction_detail.lines[] name the item (item_code, item_name)

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-00000000e272','rina-item@talaliving.com','{"full_name":"Rina Item"}'),
  ('ffffffff-0000-0000-0000-00000000e27a','andi-item@talaliving.com','{"full_name":"Andi Item"}'),
  ('ffffffff-0000-0000-0000-00000000e27b','evin-item@talaliving.com','{"full_name":"Evin Item"}');
insert into ops_core.user_authorities (user_id, authority) values
  ('ffffffff-0000-0000-0000-00000000e272','post_ledger'),
  ('ffffffff-0000-0000-0000-00000000e27b','approve_goods');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-00000000e272','accounting','write'),
  ('ffffffff-0000-0000-0000-00000000e272','procurement','write'),
  ('ffffffff-0000-0000-0000-00000000e27a','procurement','write'),
  ('ffffffff-0000-0000-0000-00000000e27b','procurement','write');

insert into ops_procure.items (id, code, name, category_code, base_uom) values
  ('22220000-0000-0000-0000-00000000e272','I-7272','Plywood 18mm uji','finishing','lembar'),
  ('22220000-0000-0000-0000-00000000e273','I-7273','Lem kuning uji','finishing','can');

set local role authenticated;
create temp table t_ctx (k text primary key, v text) on commit drop;
grant all on t_ctx to authenticated;

-- Andi raises two requests with catalogue items; Evin approves them all.
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-00000000e27a';
do $$
declare r jsonb; v uuid; doc text; doc2 text; att jsonb; n int;
begin
  r := ops_procure.create_vendor('TOKO ITEM UJI'); v := (select id from ops_procure.vendors where name = 'TOKO ITEM UJI');
  insert into t_ctx values ('vendor', r->'data'->>'code');
  r := ops_procure.create_pr(jsonb_build_array(
        jsonb_build_object('description','Plywood 18mm','qty',10,'uom','lembar','unit_price',100000,'vendor_id',v,
                           'item_id','22220000-0000-0000-0000-00000000e272'),
        jsonb_build_object('description','Lem kuning','qty',4,'uom','can','unit_price',50000,'vendor_id',v,
                           'item_id','22220000-0000-0000-0000-00000000e273')));
  doc := r->'data'->>'doc_no'; insert into t_ctx values ('doc', doc);
  perform ops_procure.submit_pr(doc);
  r := ops_procure.create_pr(jsonb_build_array(
        jsonb_build_object('description','Plywood 18mm lagi','qty',2,'uom','lembar','unit_price',100000,'vendor_id',v,
                           'item_id','22220000-0000-0000-0000-00000000e272')));
  doc2 := r->'data'->>'doc_no'; insert into t_ctx values ('doc2', doc2);
  perform ops_procure.submit_pr(doc2);
  for n in 1..2 loop
    att := ops_core.attach_url('https://toko.example/i' || n, 'i' || n);
    perform ops_core.attach_link((att->'data'->>'attachment_id')::uuid, 'pr_line', doc || '-L0' || n, 'quotation');
  end loop;
  att := ops_core.attach_url('https://toko.example/i3', 'i3');
  perform ops_core.attach_link((att->'data'->>'attachment_id')::uuid, 'pr_line', doc2 || '-L01', 'quotation');
end $$;

set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-00000000e27b';
do $$
declare doc text := (select v from t_ctx where k='doc'); doc2 text := (select v from t_ctx where k='doc2');
begin
  assert ops_core.said_ok(ops_procure.approve_line(doc || '-L01', true, null, null, null, null)), 'approve L01';
  assert ops_core.said_ok(ops_procure.approve_line(doc || '-L02', true, null, null, null, null)), 'approve L02';
  assert ops_core.said_ok(ops_procure.approve_line(doc2 || '-L01', true, null, null, null, null)), 'approve doc2 L01';
end $$;

-- ── post_from_line carries the item ──────────────────────────────────────
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-00000000e272';
do $$
declare r jsonb; doc2 text := (select v from t_ctx where k='doc2'); att uuid; l record; d record;
begin
  r := ops_core.attach_file('t/bukti-item.jpg','bukti-item.jpg','image/jpeg',1000,null,'upload');
  att := (r->'data'->>'attachment_id')::uuid;
  insert into t_ctx values ('proof', att::text);

  r := ops_acct.post_from_line(p_line_no => doc2 || '-L01', p_amount => 200000,
        p_account_code => 'BCA 271', p_type_code => 'SUPPLIERS', p_attachment_id => att);
  assert ops_core.said_ok(r), format('pay the line: %s', r);
  select tl.* into l from ops_acct.transaction_lines tl join ops_acct.transactions t on t.id = tl.trx_id
   where t.trx_no = r->'data'->>'trx_no';
  assert l.item_id = '22220000-0000-0000-0000-00000000e272' and l.kind = 'item',
    format('the request line''s item rides along, got %s / %s', l.item_id, l.kind);

  select * into d from ops_acct.v_transaction_detail where trx_no = r->'data'->>'trx_no';
  assert d.lines -> 0 ->> 'item_code' = 'I-7272' and d.lines -> 0 ->> 'item_name' = 'Plywood 18mm uji',
    format('the detail names the item, got %s', d.lines -> 0);

  r := ops_procure.item_purchases('I-7272');
  assert jsonb_array_length(r -> 'data') = 1 and r -> 'data' -> 0 ->> 'unit_price' = '100000',
    format('the catalogue learns the price paid, got %s', r);
end $$;

-- ── the order ────────────────────────────────────────────────────────────
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-00000000e27a';
do $$
declare r jsonb; doc text := (select v from t_ctx where k='doc'); ven text := (select v from t_ctx where k='vendor');
begin
  r := ops_procure.create_po(ven, jsonb_build_array(
        jsonb_build_object('description','Plywood 18mm','qty',10,'uom','lembar','unit_price',100000,'pr_line_no', doc || '-L01',
                           'item_id','22220000-0000-0000-0000-00000000e272'),
        jsonb_build_object('description','Lem kuning','qty',4,'uom','can','unit_price',50000,'pr_line_no', doc || '-L02',
                           'item_id','22220000-0000-0000-0000-00000000e273'),
        jsonb_build_object('description','Ongkir','qty',1,'uom','unit','unit_price',75000)), 30);
  assert ops_core.said_ok(r), format('order: %s', r);
  insert into t_ctx values ('po', r->'data'->>'po_no');
end $$;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-00000000e27b';
select ops_procure.approve_po(p_po_no => (select v from t_ctx where k='po'));
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-00000000e27a';
select ops_procure.issue_po((select v from t_ctx where k='po'));

-- ── the whole contract at once: one line per order line ──────────────────
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-00000000e272';
do $$
declare r jsonb; po text := (select v from t_ctx where k='po'); att uuid := (select v::uuid from t_ctx where k='proof');
        k text[]; items text[]; total numeric; n int;
begin
  -- 1.000.000 + 200.000 + 75.000 = 1.275.000, nothing paid yet.
  r := ops_acct.post_to_po(po, 1275000, 'BCA 271', 'SUPPLIERS', att);
  assert ops_core.said_ok(r), format('pay the order whole: %s', r);
  assert (r -> 'data' ->> 'itemised')::boolean, 'says it itemised';

  select array_agg(kind::text order by line_no), array_agg(coalesce(item_id::text, '-') order by line_no),
         sum(case when kind = 'discount' then -amount else amount end), count(*)
    into k, items, total, n
    from ops_acct.transaction_lines tl join ops_acct.transactions t on t.id = tl.trx_id
   where t.trx_no = r->'data'->>'trx_no';
  assert n = 3, format('three lines, got %s', n);
  assert k = array['item','item','item'], format('kinds, got %s', k);
  assert items[1] = '22220000-0000-0000-0000-00000000e272' and items[2] = '22220000-0000-0000-0000-00000000e273' and items[3] = '-',
    format('items ride along, the courier has none, got %s', items);
  assert total = 1275000, 'the lines add up to the money';

  r := ops_procure.item_purchases('I-7273');
  assert jsonb_array_length(r -> 'data') = 1 and r -> 'data' -> 0 ->> 'qty' = '4', format('the glue''s price is learned, got %s', r);
  r := ops_procure.item_purchases('I-7272');
  assert jsonb_array_length(r -> 'data') = 2, format('plywood now twice, got %s', r);
end $$;

-- ── a term payment on a second order stays one generic line ───────────────
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-00000000e27a';
do $$
declare r jsonb; v uuid; doc text; att jsonb; ven text := (select v from t_ctx where k='vendor');
begin
  v := (select id from ops_procure.vendors where name = 'TOKO ITEM UJI');
  r := ops_procure.create_pr(jsonb_build_array(
        jsonb_build_object('description','Plywood 18mm termin','qty',20,'uom','lembar','unit_price',100000,'vendor_id',v,
                           'item_id','22220000-0000-0000-0000-00000000e272')));
  doc := r->'data'->>'doc_no'; insert into t_ctx values ('doc3', doc);
  perform ops_procure.submit_pr(doc);
  att := ops_core.attach_url('https://toko.example/i4', 'i4');
  perform ops_core.attach_link((att->'data'->>'attachment_id')::uuid, 'pr_line', doc || '-L01', 'quotation');
end $$;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-00000000e27b';
select ops_procure.approve_line((select v from t_ctx where k='doc3') || '-L01', true, null, null, null, null);
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-00000000e27a';
do $$
declare r jsonb; doc text := (select v from t_ctx where k='doc3'); ven text := (select v from t_ctx where k='vendor');
begin
  r := ops_procure.create_po(ven, jsonb_build_array(
        jsonb_build_object('description','Plywood 18mm termin','qty',20,'uom','lembar','unit_price',100000,'pr_line_no', doc || '-L01',
                           'item_id','22220000-0000-0000-0000-00000000e272')), 30);
  assert ops_core.said_ok(r), format('order 2: %s', r);
  insert into t_ctx values ('po2', r->'data'->>'po_no');
end $$;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-00000000e27b';
select ops_procure.approve_po(p_po_no => (select v from t_ctx where k='po2'));
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-00000000e27a';
select ops_procure.issue_po((select v from t_ctx where k='po2'));
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-00000000e272';
do $$
declare r jsonb; po text := (select v from t_ctx where k='po2'); att uuid := (select v::uuid from t_ctx where k='proof'); l record;
begin
  r := ops_acct.post_to_po(po, 600000, 'BCA 271', 'SUPPLIERS', att);   -- 30% of 2.000.000
  assert ops_core.said_ok(r), format('term payment: %s', r);
  assert not (r -> 'data' ->> 'itemised')::boolean, 'a deposit is not itemised';
  select tl.* into l from ops_acct.transaction_lines tl join ops_acct.transactions t on t.id = tl.trx_id
   where t.trx_no = r->'data'->>'trx_no';
  assert l.kind = 'other' and l.item_id is null and l.amount = 600000, format('one generic line, got %s', row_to_json(l));

  r := ops_procure.item_purchases('I-7272');
  assert jsonb_array_length(r -> 'data') = 2, 'no price invented from a deposit';
end $$;

rollback;
