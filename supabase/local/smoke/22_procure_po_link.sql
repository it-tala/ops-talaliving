-- procure — an order that knows its request line, and money that reads on
-- both sides (0127, B7, B8).
--
-- Refusals: an unapproved line (409), a line already on a live order (409),
-- a line in another unit (422), one line named twice (422), paying a draft
-- (409), paying past the contract (422), paying without post_ledger (403).
-- Derivations: an arrival on the order moves the request line; a line paid
-- before it was ordered restamps onto the order; paying the order reaches the
-- linked lines in proportion, and the rest names the order alone; one payment
-- is counted once on each side, never twice on either.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('22220000-0000-0000-0000-00000000a11d','andi@talaliving.com','{"full_name":"Andi"}'),
  ('22220000-0000-0000-0000-00000000ce00','evin@talaliving.com','{"full_name":"Evin"}'),
  ('22220000-0000-0000-0000-00000000f11a','rina@talaliving.com','{"full_name":"Rina"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('22220000-0000-0000-0000-00000000a11d','procurement','write'),
  ('22220000-0000-0000-0000-00000000ce00','procurement','write'),
  ('22220000-0000-0000-0000-00000000f11a','procurement','write'),
  ('22220000-0000-0000-0000-00000000f11a','accounting','write');
insert into ops_core.user_authorities (user_id, authority) values
  ('22220000-0000-0000-0000-00000000ce00','approve_goods'),
  ('22220000-0000-0000-0000-00000000f11a','post_ledger');

set local role authenticated;
set local request.jwt.claim.sub = '22220000-0000-0000-0000-00000000a11d';

create temp table t_ctx (k text primary key, v text) on commit drop;
grant all on t_ctx to authenticated;

-- A request with three lines, each with a quotation so it can be approved.
do $$
declare r jsonb; doc text; v uuid; att jsonb; n int;
begin
  r := ops_procure.create_vendor('CV LINK UJI'); v := (select id from ops_procure.vendors where name = 'CV LINK UJI');
  insert into t_ctx values ('vendor', r->'data'->>'code');
  r := ops_procure.create_pr(jsonb_build_array(
        jsonb_build_object('description','Plywood A','qty',10,'uom','lembar','unit_price',100000,'vendor_id',v),
        jsonb_build_object('description','Plywood B','qty',5,'uom','lembar','unit_price',200000,'vendor_id',v),
        jsonb_build_object('description','Lem','qty',4,'uom','can','unit_price',50000,'vendor_id',v),
        jsonb_build_object('description','DP 30%','item_total',500000,'vendor_id',v)));
  doc := r->'data'->>'doc_no';
  insert into t_ctx values ('doc', doc);
  perform ops_procure.submit_pr(doc);
  for n in 1..4 loop
    att := ops_core.attach_url('https://toko.example/q' || n, 'q' || n);
    perform ops_core.attach_link((att->'data'->>'attachment_id')::uuid, 'pr_line', doc || '-L0' || n, 'quotation');
  end loop;
end $$;

-- ── B7 refusals ───────────────────────────────────────────────────────────
do $$
declare r jsonb; doc text := (select v from t_ctx where k='doc'); ven text := (select v from t_ctx where k='vendor');
begin
  r := ops_procure.create_po(ven, jsonb_build_array(jsonb_build_object(
        'description','Plywood A','qty',10,'uom','lembar','unit_price',100000,'pr_line_no', doc || '-L01')));
  assert r->'error'->>'code' = 'line_not_approved', format('ordering before approval, got %s', r);
end $$;

set local request.jwt.claim.sub = '22220000-0000-0000-0000-00000000ce00';
do $$
declare doc text := (select v from t_ctx where k='doc'); n int;
begin
  for n in 1..4 loop
    assert ops_core.said_ok(ops_procure.approve_line(doc || '-L0' || n, true, null, null, null, null)), 'approve';
  end loop;
end $$;

-- Rina pays L01 before any order exists — it happens (D94).
set local request.jwt.claim.sub = '22220000-0000-0000-0000-00000000f11a';
do $$
declare r jsonb; doc text := (select v from t_ctx where k='doc'); att uuid;
begin
  r := ops_core.attach_file('t/bukti.jpg','bukti.jpg','image/jpeg',1000,null,'upload');
  att := (r->'data'->>'attachment_id')::uuid;
  insert into t_ctx values ('proof', att::text);
  r := ops_acct.post_from_line(p_line_no => doc || '-L01', p_amount => 300000,
        p_account_code => 'BCA 271', p_type_code => 'SUPPLIERS', p_attachment_id => att);
  assert ops_core.said_ok(r), format('pay L01 early: %s', r);
  assert (select po_no from ops_acct.payment_allocations where pr_line_no = doc || '-L01' and superseded_by is null) is null,
    'no order yet, so the money names the line alone';
end $$;

set local request.jwt.claim.sub = '22220000-0000-0000-0000-00000000a11d';
do $$
declare r jsonb; doc text := (select v from t_ctx where k='doc'); ven text := (select v from t_ctx where k='vendor');
begin
  r := ops_procure.create_po(ven, jsonb_build_array(
        jsonb_build_object('description','A','qty',10,'uom','lembar','unit_price',100000,'pr_line_no', doc || '-L01'),
        jsonb_build_object('description','A again','qty',1,'uom','lembar','unit_price',100000,'pr_line_no', doc || '-L01')));
  assert r->'error'->>'code' = 'line_named_twice', format('%s', r);

  r := ops_procure.create_po(ven, jsonb_build_array(jsonb_build_object(
        'description','Lem','qty',1,'uom','gallon','unit_price',200000,'pr_line_no', doc || '-L03')));
  assert r->'error'->>'code' = 'uom_differs', format('another unit would move the line by the wrong number, got %s', r);

  r := ops_procure.create_po(ven, jsonb_build_array(jsonb_build_object(
        'description','DP','qty',1,'uom','unit','unit_price',500000,'pr_line_no', doc || '-L04')));
  assert r->'error'->>'code' = 'lump_sum_line', format('a deposit line is money, not goods (A1), got %s', r);

  -- The order: L01 and L02 linked, plus an unlinked delivery charge.
  r := ops_procure.create_po(ven, jsonb_build_array(
        jsonb_build_object('description','Plywood A','qty',10,'uom','lembar','unit_price',100000,'pr_line_no', doc || '-L01'),
        jsonb_build_object('description','Plywood B','qty',5,'uom','lembar','unit_price',200000,'pr_line_no', doc || '-L02'),
        jsonb_build_object('description','Ongkir','qty',1,'uom','unit','unit_price',500000)), 30);
  assert ops_core.said_ok(r), format('linked order: %s', r);
  insert into t_ctx values ('po', r->'data'->>'po_no');

  r := ops_procure.create_po(ven, jsonb_build_array(jsonb_build_object(
        'description','Plywood A','qty',10,'uom','lembar','unit_price',100000,'pr_line_no', doc || '-L01')));
  assert r->'error'->>'code' = 'line_already_ordered', format('one live order per line, got %s', r);
  assert r->'error'->'detail'->>'po_no' = (select v from t_ctx where k='po'), 'and it names the order';
end $$;

-- ── B8: money paid before the order now reads on the order ────────────────
-- Read as Rina: money is accounting's to see, and under RLS a procurement-only
-- reader sees no allocations at all — on this order or any other.
set local request.jwt.claim.sub = '22220000-0000-0000-0000-00000000f11a';
do $$
declare po text := (select v from t_ctx where k='po'); doc text := (select v from t_ctx where k='doc'); s record;
begin
  select * into s from ops_procure.v_po_status where po_no = po;
  assert s.paid_to_date = 300000, format('L01''s early payment is the order''s too, got %s', s.paid_to_date);
  assert (select covered from ops_procure.v_line_coverage where line_no_full = doc || '-L01') = 300000,
    'and still exactly once on the line';
  assert (select count(*) from ops_acct.payment_allocations where pr_line_no = doc || '-L01' and superseded_by is not null) = 1,
    'restated by superseding, not by editing (A5)';

  assert (select jsonb_agg(l->>'pr_line_no' order by (l->>'line_no')::int) from ops_procure.v_po_detail d, jsonb_array_elements(d.lines) l where d.po_no = po)
       = jsonb_build_array(doc || '-L01', doc || '-L02', null),
    'the drawer names each line''s request';
end $$;

-- Paying a draft, and paying without the authority.
set local request.jwt.claim.sub = '22220000-0000-0000-0000-00000000f11a';
do $$
declare r jsonb; po text := (select v from t_ctx where k='po'); att uuid := (select v::uuid from t_ctx where k='proof');
begin
  r := ops_acct.post_to_po(po, 100000, 'BCA 271', 'SUPPLIERS', att);
  assert r->'error'->>'code' = 'not_issued', format('nothing is owed on a draft, got %s', r);
end $$;

set local request.jwt.claim.sub = '22220000-0000-0000-0000-00000000ce00';
select ops_procure.approve_po(p_po_no => (select v from t_ctx where k='po'));
set local request.jwt.claim.sub = '22220000-0000-0000-0000-00000000a11d';
select ops_procure.issue_po((select v from t_ctx where k='po'));
do $$
declare r jsonb; po text := (select v from t_ctx where k='po'); att uuid := (select v::uuid from t_ctx where k='proof');
begin
  r := ops_acct.post_to_po(po, 100000, 'BCA 271', 'SUPPLIERS', att);
  assert r->'error'->>'code' = 'authority_required', format('procurement does not post, got %s', r);
end $$;

-- ── B8: paying the order from its screen ──────────────────────────────────
set local request.jwt.claim.sub = '22220000-0000-0000-0000-00000000f11a';
do $$
declare r jsonb; po text := (select v from t_ctx where k='po'); doc text := (select v from t_ctx where k='doc');
        att uuid := (select v::uuid from t_ctx where k='proof'); s record; bal0 numeric; bal1 numeric;
begin
  -- Contract 1.000.000 + 1.000.000 + 500.000 = 2.500.000; 300.000 already paid.
  r := ops_acct.post_to_po(po, 2300000, 'BCA 271', 'SUPPLIERS', att);
  assert r->'error'->>'code' = 'over_contract', format('only 2.200.000 is outstanding, got %s', r);

  r := ops_acct.post_to_po(po, 1000000, 'BCA 271', 'SUPPLIERS', null);
  assert r->'error'->>'code' = 'evidence_required', format('%s', r);

  select balance into bal0 from ops_acct.v_account_balance where code = 'BCA 271';
  r := ops_acct.post_to_po(po, 1000000, 'BCA 271', 'SUPPLIERS', att);
  assert ops_core.said_ok(r), format('pay the order: %s', r);
  select balance into bal1 from ops_acct.v_account_balance where code = 'BCA 271';
  assert bal0 - bal1 = 1000000, 'one ledger row, the whole amount';

  -- 1.000.000 split 40/40/20 by line value.
  assert (select sum(amount) from ops_acct.payment_allocations
           where trx_id = (select id from ops_acct.transactions where trx_no = r->'data'->>'trx_no')) = 1000000,
    'the shares add up to what left the bank';
  assert (select covered from ops_procure.v_line_coverage where line_no_full = doc || '-L01') = 700000,
    'L01: 300.000 before + 400.000 share';
  assert (select covered from ops_procure.v_line_coverage where line_no_full = doc || '-L02') = 400000, 'L02: its share';
  assert (select covered from ops_procure.v_line_coverage where line_no_full = doc || '-L03') = 0, 'L03 is not on the order';

  select * into s from ops_procure.v_po_status where po_no = po;
  assert s.paid_to_date = 1300000, format('the order counts every rupiah once, got %s', s.paid_to_date);
  assert s.payment_state = 'PARTIAL', s.payment_state::text;

  -- Paying a linked line directly reaches the order too.
  r := ops_acct.post_from_line(p_line_no => doc || '-L02', p_amount => 600000,
        p_account_code => 'BCA 271', p_type_code => 'SUPPLIERS', p_attachment_id => att);
  assert ops_core.said_ok(r), format('%s', r);
  assert (select paid_to_date from ops_procure.v_po_status where po_no = po) = 1900000, 'line money is order money';
  assert (select status::text from ops_procure.v_pr_line_status where line_no_full = doc || '-L02') = 'PAID', 'and L02 is settled';
end $$;

-- ── B7: goods arriving on the order move the request line ─────────────────
set local request.jwt.claim.sub = '22220000-0000-0000-0000-00000000a11d';
do $$
declare r jsonb; po text := (select v from t_ctx where k='po'); doc text := (select v from t_ctx where k='doc');
        pol uuid; photo uuid; st text;
begin
  select o.id into pol from ops_procure.po_lines o join ops_procure.purchase_orders p on p.id = o.po_id
   where p.po_no = po and o.line_no = 2 and o.superseded_by is null;
  r := ops_core.attach_file('t/foto.jpg','foto.jpg','image/jpeg',1000,null,'upload');
  photo := (r->'data'->>'attachment_id')::uuid;
  r := ops_procure.create_receipt(2, 'GOOD', jsonb_build_array(jsonb_build_object('attachment_id', photo, 'kind','Receiving Item')), null, pol);
  assert ops_core.said_ok(r) and r->'data'->>'status' = 'REPORTED', format('%s', r);
  r := ops_procure.confirm_receipt(r->'data'->>'receipt_no');
  assert ops_core.said_ok(r), format('%s', r);

  select status::text into st from ops_procure.v_pr_line_status where line_no_full = doc || '-L02';
  assert st = 'PARTIAL', format('two of five sheets arrived on the order, so the request line is partial, got %s', st);

  -- An amendment keeps the link, and the old line's receipt still counts.
  r := ops_procure.amend_po_line(po, 2, 'vendor short on stock', 4);
  assert ops_core.said_ok(r), format('%s', r);
  assert (select pr_line_id from ops_procure.po_lines where id = (select superseded_by from ops_procure.po_lines where id = pol))
       = (select id from ops_procure.pr_lines where line_no_full = doc || '-L02'), 'the new line carries the link';
  assert (select received_qty from ops_procure.v_line_receiving
           where line_id = (select id from ops_procure.pr_lines where line_no_full = doc || '-L02')) = 2,
    'and the receipt on the superseded line still counts';
end $$;

-- ── B11: a line whose supplier was decided on the order is paid from its row ──
set local request.jwt.claim.sub = '22220000-0000-0000-0000-00000000a11d';
do $$
declare r jsonb; doc text; ven text := (select v from t_ctx where k='vendor'); att jsonb;
begin
  -- No vendor on the request: the room decides it later.
  r := ops_procure.create_pr(jsonb_build_array(
        jsonb_build_object('description','Engsel','qty',20,'uom','pcs','unit_price',15000)));
  doc := r->'data'->>'doc_no';
  insert into t_ctx values ('doc_b11', doc);
  perform ops_procure.submit_pr(doc);
  att := ops_core.attach_url('https://toko.example/engsel', 'engsel');
  perform ops_core.attach_link((att->'data'->>'attachment_id')::uuid, 'pr_line', doc || '-L01', 'quotation');
end $$;
set local request.jwt.claim.sub = '22220000-0000-0000-0000-00000000ce00';
select ops_procure.approve_line((select v from t_ctx where k='doc_b11') || '-L01', true, null, null, null, null);
set local request.jwt.claim.sub = '22220000-0000-0000-0000-00000000f11a';
do $$
declare r jsonb; doc text := (select v from t_ctx where k='doc_b11'); att uuid := (select v::uuid from t_ctx where k='proof');
begin
  r := ops_acct.post_from_line(p_line_no => doc || '-L01', p_amount => 300000,
        p_account_code => 'BCA 271', p_type_code => 'SUPPLIERS', p_attachment_id => att);
  assert r->'error'->>'code' = 'vendor_required', format('not ordered and no vendor: still nobody it was bought from, got %s', r);
end $$;
set local request.jwt.claim.sub = '22220000-0000-0000-0000-00000000a11d';
select ops_procure.create_po((select v from t_ctx where k='vendor'), jsonb_build_array(jsonb_build_object(
  'description','Engsel','qty',20,'uom','pcs','unit_price',15000,'pr_line_no', (select v from t_ctx where k='doc_b11') || '-L01')));
set local request.jwt.claim.sub = '22220000-0000-0000-0000-00000000f11a';
do $$
declare r jsonb; doc text := (select v from t_ctx where k='doc_b11'); att uuid := (select v::uuid from t_ctx where k='proof');
begin
  r := ops_acct.post_from_line(p_line_no => doc || '-L01', p_amount => 300000,
        p_account_code => 'BCA 271', p_type_code => 'SUPPLIERS', p_attachment_id => att, p_trx_date => ops_core.office_day() + 1);
  assert ops_core.said_ok(r), format('ordered on a PO, so the order names the supplier (B11), got %s', r);
  assert (select v.name from ops_acct.transactions t join ops_procure.vendors v on v.id = t.vendor_id
           where t.trx_no = r->'data'->>'trx_no') = 'CV LINK UJI', 'and the ledger row names it';
end $$;

rollback;
