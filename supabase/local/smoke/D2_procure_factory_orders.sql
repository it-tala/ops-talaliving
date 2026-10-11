-- procure — the production route per order line, and the factory order
-- (0257, O3, kajian F255 §5.1/§5.4, D413, D414, D416).
--
-- DERIVATIONS  lines go to the factory and back; a factory order takes this
--              factory's price per design item (chosen first, else newest)
--              and the line's quantity and unit; a supplier given an order
--              becomes a factory; a USD order's figures are read in rupiah at
--              its kurs, its own total kept; issuing moves the project to
--              IN_PRODUCTION with a reason; an amendment keeps the order line
--              it makes and rounds to the cent; leadership writing an order
--              confirms it; a second order to the same factory is named, not
--              refused; somebody who may not read orders still sees which
--              order a line is on; the board per project says how far each
--              line is
-- REFUSALS     routing without project or procurement access; an unknown
--              route or line; a factory line back to the workshop while it is
--              ordered; a workshop line with a live Job Order to the factory;
--              a factory order without procurement access, to QC, for a
--              workshop line, in EUR, naming a line twice, with no price, with
--              an offer in the other currency and no kurs, for a line already
--              ordered; issuing a USD order without its kurs; the kurs of an
--              issued order, of a rupiah order

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('aaaa0000-0000-0000-0000-0000000d2001','proc-fo@talaliving.com','{"full_name":"Andi Order"}'),
  ('aaaa0000-0000-0000-0000-0000000d2002','pm-fo@talaliving.com','{"full_name":"Pimpinan Proyek"}'),
  ('aaaa0000-0000-0000-0000-0000000d2003','prod-fo@talaliving.com','{"full_name":"Made Order"}'),
  ('aaaa0000-0000-0000-0000-0000000d2004','dir-fo@talaliving.com','{"full_name":"Direktur Order"}'),
  ('aaaa0000-0000-0000-0000-0000000d2005','mkt-fo@talaliving.com','{"full_name":"Rina Order"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('aaaa0000-0000-0000-0000-0000000d2001','procurement','write'),
  ('aaaa0000-0000-0000-0000-0000000d2002','project','write'),
  ('aaaa0000-0000-0000-0000-0000000d2003','production','write'),
  ('aaaa0000-0000-0000-0000-0000000d2004','procurement','write'),
  ('aaaa0000-0000-0000-0000-0000000d2005','marketing','write');
insert into ops_core.user_authorities (user_id, authority) values
  ('aaaa0000-0000-0000-0000-0000000d2004','approve_goods');

insert into ops_procure.clients (id, code, name) values
  ('d2000000-0000-0000-0000-0000000000c1','CL-0971','PT Contoh Order');
insert into ops_procure.projects (id, code, name, client_id, status) values
  ('d2000000-0000-0000-0000-0000000000d1','26971','Resort Agen','d2000000-0000-0000-0000-0000000000c1','DEAL');
insert into ops_procure.vendors (id, code, name, kind) values
  ('d2000000-0000-0000-0000-0000000000f1','V-FO1','CV Pabrik Dolar','supplier'),
  ('d2000000-0000-0000-0000-0000000000f2','V-FO2','PT Pabrik Rupiah','factory'),
  ('d2000000-0000-0000-0000-0000000000f3','V-FO3','QC Order','qc');

set local role authenticated;
set local request.jwt.claim.sub = 'aaaa0000-0000-0000-0000-0000000d2005';
do $$
begin
  perform ops_procure.save_design_collection('26971', 'A', 'Villa');
  perform ops_procure.save_design_room('26971', 'A', 'LR', 'Living room');
  perform ops_procure.save_design_item('26971', 'A', 'LR', 'Sofa', 2, 'tala');
  perform ops_procure.save_design_item('26971', 'A', 'LR', 'Table', 3, 'tala');
  perform ops_procure.save_design_item('26971', 'A', 'LR', 'Lamp', 4, 'tala');
end $$;

-- Two factories quote: one in dollars, one in rupiah.
set local request.jwt.claim.sub = 'aaaa0000-0000-0000-0000-0000000d2001';
do $$
declare r jsonb;
begin
  r := ops_procure.record_factory_quote('26971', 'V-FO1', 'USD',
         '[{"item_no":"26971-A-LR-01","unit_price":150},{"item_no":"26971-A-LR-02","unit_price":80}]');
  assert r->>'outcome' = 'ok', 'USD offer: ' || r::text;
  r := ops_procure.record_factory_quote('26971', 'V-FO2', 'IDR', '[{"item_no":"26971-A-LR-01","unit_price":2000000}]');
  assert r->>'outcome' = 'ok', 'IDR offer: ' || r::text;
end $$;

-- The client's order, as an accepted quotation would have written it.
reset role;
insert into ops_procure.project_lines (id, project_id, line_no, product_code, description, qty, uom, design_item_id) values
  ('d2000000-0000-0000-0000-0000000001a1','d2000000-0000-0000-0000-0000000000d1',1,null,'Sofa',2,'pcs',
   (select id from ops_procure.design_items where item_no = '26971-A-LR-01')),
  ('d2000000-0000-0000-0000-0000000001a2','d2000000-0000-0000-0000-0000000000d1',2,null,'Table',3,'pcs',
   (select id from ops_procure.design_items where item_no = '26971-A-LR-02')),
  ('d2000000-0000-0000-0000-0000000001a3','d2000000-0000-0000-0000-0000000000d1',3,null,'Lamp',4,'pcs',
   (select id from ops_procure.design_items where item_no = '26971-A-LR-03')),
  ('d2000000-0000-0000-0000-0000000001a4','d2000000-0000-0000-0000-0000000000d1',4,null,'Bench',1,'pcs',null),
  ('d2000000-0000-0000-0000-0000000001a5','d2000000-0000-0000-0000-0000000000d1',5,null,'Chair',6,'pcs',null),
  ('d2000000-0000-0000-0000-0000000001a6','d2000000-0000-0000-0000-0000000000d1',6,null,'Mirror',2,'pcs',null);
insert into ops_prod.work_orders (item_name, qty, uom, project_code, due_date, route, project_line_id)
values ('Bench', 1, 'pcs', '26971', current_date + 30, 'IN_HOUSE', 'd2000000-0000-0000-0000-0000000001a4');
set local role authenticated;

-- ── the route ─────────────────────────────────────────────────────────────
do $$
declare r jsonb;
begin
  perform set_config('request.jwt.claim.sub', 'aaaa0000-0000-0000-0000-0000000d2003', true);
  r := ops_procure.set_line_route('26971', array[1], 'FACTORY');
  assert r->'error'->>'code' = 'not_permitted', 'production does not route: ' || r::text;

  perform set_config('request.jwt.claim.sub', 'aaaa0000-0000-0000-0000-0000000d2002', true);
  r := ops_procure.set_line_route('26971', array[1], 'PABRIK');
  assert r->'error'->>'code' = 'unknown_route', 'a route that exists: ' || r::text;
  r := ops_procure.set_line_route('26971', array[1, 9], 'FACTORY');
  assert r->'error'->>'code' = 'line_unknown', 'a line of this project: ' || r::text;
  r := ops_procure.set_line_route('26971', array[4], 'FACTORY');
  assert r->'error'->>'code' = 'has_job_orders', 'a line with a live Job Order stays: ' || r::text;
  assert (select count(*) from ops_procure.project_lines where route = 'FACTORY'
           and project_id = 'd2000000-0000-0000-0000-0000000000d1') = 0, 'nothing moved by a refusal';

  r := ops_procure.set_line_route('26971', array[1, 2, 3, 5, 6], 'factory');
  assert r->>'outcome' = 'ok' and (r->'data'->>'changed')::int = 5, 'five lines to the factory: ' || r::text;
  r := ops_procure.set_line_route('26971', array[1], 'FACTORY');
  assert r->>'outcome' = 'noop', 'again changes nothing: ' || r::text;
  assert (select route from ops_procure.v_project_line where project_code = '26971' and line_no = 4) = 'WORKSHOP',
    'the workshop line stays';
end $$;

-- ── the factory order ─────────────────────────────────────────────────────
do $$
declare r jsonb; po1 text; po2 text; po3 text;
begin
  perform set_config('request.jwt.claim.sub', 'aaaa0000-0000-0000-0000-0000000d2002', true);
  r := ops_procure.create_factory_order('26971', 'V-FO1', '[{"line_no":1}]', 'USD');
  assert r->'error'->>'code' = 'not_permitted', 'the order is procurement''s: ' || r::text;

  perform set_config('request.jwt.claim.sub', 'aaaa0000-0000-0000-0000-0000000d2001', true);
  r := ops_procure.create_factory_order('26971', 'V-FO3', '[{"line_no":1}]', 'USD');
  assert r->'error'->>'code' = 'not_factory', 'QC makes nothing: ' || r::text;
  r := ops_procure.create_factory_order('26971', 'V-FO1', '[{"line_no":4}]', 'USD');
  assert r->'error'->>'code' = 'not_factory_route', 'a workshop line: ' || r::text;
  r := ops_procure.create_factory_order('26971', 'V-FO1', '[{"line_no":1}]', 'EUR');
  assert r->'error'->>'code' = 'unknown_currency', 'IDR or USD: ' || r::text;
  r := ops_procure.create_factory_order('26971', 'V-FO1', '[{"line_no":1},{"line_no":1}]', 'USD');
  assert r->'error'->>'code' = 'line_named_twice', 'a line once: ' || r::text;
  r := ops_procure.create_factory_order('26971', 'V-FO1', '[{"line_no":3}]', 'USD');
  assert r->'error'->>'code' = 'price_required', 'no offer, no typed price: ' || r::text;
  r := ops_procure.create_factory_order('26971', 'V-FO1', '[{"line_no":2}]', 'IDR');
  assert r->'error'->>'code' = 'price_required' and r->'error'->>'message' like '%USD%',
    'a dollar offer on a rupiah order needs the kurs: ' || r::text;
  r := ops_procure.create_factory_order('26971', 'V-FO1', '[{"line_no":2,"qty":0}]', 'USD');
  assert r->'error'->>'code' = 'bad_qty', 'more than nothing: ' || r::text;
  assert (select count(*) from ops_procure.purchase_orders
           where project_id = 'd2000000-0000-0000-0000-0000000000d1') = 0, 'nothing written by a refusal';

  -- Dollars, no kurs yet: the factory's prices, the lines' quantities.
  r := ops_procure.create_factory_order('26971', 'V-FO1', '[{"line_no":1},{"line_no":2}]', 'USD',
         null, current_date + 60, 'Kontainer pertama');
  assert r->>'outcome' = 'ok' and (r->'data'->>'needs_rate')::boolean and r->'data'->>'same_factory_order' is null,
    'a USD factory order: ' || r::text;
  po1 := r->'data'->>'po_no';
  assert (select kind from ops_procure.vendors where code = 'V-FO1') = 'factory', 'the supplier is a factory now';
  assert (select string_agg(unit_price::text || '/' || line_total::text || '/' || qty::text, ' ' order by line_no)
            from ops_procure.po_lines o join ops_procure.purchase_orders p on p.id = o.po_id where p.po_no = po1)
         = '150/300.00/2 80/240.00/3', 'this factory''s prices × the lines'' quantities';
  assert (select count(*) from ops_procure.po_lines o join ops_procure.purchase_orders p on p.id = o.po_id
           where p.po_no = po1 and o.project_line_id is not null) = 2, 'each PO line names its order line';
  assert (select contract_value = 0 and contract_value_own = 540 and needs_rate
            from ops_procure.v_po_status where po_no = po1),
    'no kurs, no rupiah figure — never a guess';
  assert (select currency || '/' || project_code from ops_procure.v_po_board where po_no = po1) = 'USD/26971',
    'the board names currency and project';

  r := ops_procure.create_factory_order('26971', 'V-FO2', '[{"line_no":1}]', 'IDR');
  assert r->'error'->>'code' = 'line_already_ordered' and r->'error'->'detail'->>'po_no' = po1,
    'a line is ordered once: ' || r::text;

  perform set_config('request.jwt.claim.sub', 'aaaa0000-0000-0000-0000-0000000d2002', true);
  r := ops_procure.set_line_route('26971', array[1], 'WORKSHOP');
  assert r->'error'->>'code' = 'on_factory_order', 'an ordered line stays at the factory: ' || r::text;

  -- Somebody who may not read orders still sees which order a line is on.
  perform set_config('request.jwt.claim.sub', 'aaaa0000-0000-0000-0000-0000000d2003', true);
  assert (select count(*) from ops_procure.purchase_orders where po_no = po1) = 0, 'production reads no orders';
  assert (select factory_po_no || '/' || factory_vendor_name || '/' || factory_po_status
            from ops_procure.v_project_line where project_code = '26971' and line_no = 1)
         = po1 || '/CV Pabrik Dolar/DRAFT', 'but the order card names it';

  -- Issue: confirmed, then the kurs, then the project moves.
  perform set_config('request.jwt.claim.sub', 'aaaa0000-0000-0000-0000-0000000d2001', true);
  r := ops_procure.issue_po(po1);
  assert r->'error'->>'code' = 'not_approved', 'leadership first: ' || r::text;
  perform set_config('request.jwt.claim.sub', 'aaaa0000-0000-0000-0000-0000000d2004', true);
  r := ops_procure.approve_po(po1, true, null);
  assert r->>'outcome' = 'ok', 'confirmed: ' || r::text;
  perform set_config('request.jwt.claim.sub', 'aaaa0000-0000-0000-0000-0000000d2001', true);
  r := ops_procure.issue_po(po1);
  assert r->'error'->>'code' = 'fx_rate_required', 'a USD order needs its kurs: ' || r::text;
  r := ops_procure.set_po_fx_rate(po1, 0);
  assert r->'error'->>'code' = 'bad_fx_rate', 'a kurs above zero: ' || r::text;
  r := ops_procure.set_po_fx_rate(po1, 16000);
  assert r->>'outcome' = 'ok', 'the kurs: ' || r::text;
  assert (select contract_value from ops_procure.v_po_status where po_no = po1) = 8640000,
    'read in rupiah at the order''s kurs';
  r := ops_procure.issue_po(po1);
  assert r->>'outcome' = 'ok' and (r->'data'->>'project_moved')::boolean, 'issued: ' || r::text;
  assert (select status from ops_procure.projects where code = '26971') = 'IN_PRODUCTION', 'the project is in production';
  assert exists (select 1 from ops_procure.project_status_log l join ops_procure.projects p on p.id = l.project_id
                  where p.code = '26971' and l.to_status = 'IN_PRODUCTION' and l.reason = format('Order pabrik %s diterbitkan', po1)),
    'with the order as its reason';
  r := ops_procure.set_po_fx_rate(po1, 16500);
  assert r->'error'->>'code' = 'already_issued', 'the kurs is the one it was issued at: ' || r::text;

  -- An amendment keeps the order line, to the cent.
  r := ops_procure.amend_po_line(po1, 1, 'harga naik', null, 155.5);
  assert r->>'outcome' = 'ok', 'amended: ' || r::text;
  assert (select line_total::text || '/' || (project_line_id = 'd2000000-0000-0000-0000-0000000001a1')::text
            from ops_procure.po_lines o join ops_procure.purchase_orders p on p.id = o.po_id
           where p.po_no = po1 and o.line_no = 1 and o.superseded_by is null) = '311.00/true',
    'the new line still makes the sofa';

  -- Leadership writes one: confirmed in the same act. A typed price, rupiah.
  perform set_config('request.jwt.claim.sub', 'aaaa0000-0000-0000-0000-0000000d2004', true);
  r := ops_procure.create_factory_order('26971', 'V-FO2', '[{"line_no":3,"unit_price":500000}]', 'IDR', 99);
  assert r->>'outcome' = 'ok' and (r->'data'->>'self_confirmed')::boolean, 'self-confirmed: ' || r::text;
  po2 := r->'data'->>'po_no';
  assert (select fx_rate is null from ops_procure.purchase_orders where po_no = po2), 'a rupiah order has no kurs';
  r := ops_procure.set_po_fx_rate(po2, 16000);
  assert r->'error'->>'code' = 'not_foreign', 'nor gets one: ' || r::text;

  -- A second order to the same factory is named, not refused (Q84).
  r := ops_procure.create_factory_order('26971', 'V-FO2', '[{"line_no":5,"unit_price":100000}]', 'IDR');
  assert r->>'outcome' = 'ok' and r->'data'->>'same_factory_order' = po2, 'the earlier order named: ' || r::text;
  po3 := r->'data'->>'po_no';
end $$;

-- ── the board per project ─────────────────────────────────────────────────
do $$
declare got text;
begin
  perform set_config('request.jwt.claim.sub', 'aaaa0000-0000-0000-0000-0000000d2003', true);
  select string_agg(line_no || ':' || route || ':' || stage, ' ' order by line_no) into got
    from ops_procure.v_project_production where project_code = '26971';
  assert got = '1:FACTORY:AT_FACTORY 2:FACTORY:AT_FACTORY 3:FACTORY:ORDER_DRAFT 4:WORKSHOP:IN_WORK 5:FACTORY:ORDER_DRAFT 6:FACTORY:NO_FACTORY_ORDER',
    'how far each line is: ' || got;
  assert (select made is null from ops_procure.v_project_production where project_code = '26971' and line_no = 1),
    'what a factory finished is QC''s number (O7), not a guess';
end $$;

rollback;
