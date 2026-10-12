-- dlv — a container is a delivery of its own kind (0258/0259, O5, kajian F255
-- §5.6, D417).
--
-- DERIVATIONS  a container loaded from a factory order carries that order's
--              lines, moves the project to SHIPPED like any consignment, and
--              reads as a container with its order's number to logistics,
--              who do not read orders; a number typed with spaces and lower
--              case is cleaned; a wrong ISO check digit is warned, not
--              refused; details are corrected until it arrives, the same
--              values twice is noop; its packing list is filed against it in
--              PENGIRIMAN/{CLIENT}/{PROJECT}; past its ETA it says by how
--              much; once arrived its number may sail again
-- REFUSALS     loading without delivery access; no container number, a number
--              of the wrong shape, an unknown size, ETA before ETD; an order
--              of another project; a line not on the order it came from; a
--              container still at sea loaded again; correcting a lorry, or a
--              container that has arrived; a paper of the wrong kind, or one
--              never uploaded

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('aaaa0000-0000-0000-0000-0000000d3001','log-ct@talaliving.com','{"full_name":"Logistik Kontainer"}'),
  ('aaaa0000-0000-0000-0000-0000000d3002','proc-ct@talaliving.com','{"full_name":"Andi Kontainer"}'),
  ('aaaa0000-0000-0000-0000-0000000d3003','prod-ct@talaliving.com','{"full_name":"Made Kontainer"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('aaaa0000-0000-0000-0000-0000000d3001','delivery','write'),
  ('aaaa0000-0000-0000-0000-0000000d3002','procurement','write'),
  ('aaaa0000-0000-0000-0000-0000000d3003','production','write');

insert into ops_procure.clients (id, code, name) values
  ('d3000000-0000-0000-0000-0000000000c1','CL-0981','PT Contoh Kontainer');
insert into ops_procure.projects (id, code, name, client_id, status) values
  ('d3000000-0000-0000-0000-0000000000d1','26981','Resort Kontainer','d3000000-0000-0000-0000-0000000000c1','IN_PRODUCTION'),
  ('d3000000-0000-0000-0000-0000000000d2','26982','Resort Lain','d3000000-0000-0000-0000-0000000000c1','IN_PRODUCTION');
insert into ops_procure.vendors (id, code, name, kind) values
  ('d3000000-0000-0000-0000-0000000000f1','V-CT1','PT Pabrik Kontainer','factory');
insert into ops_procure.project_lines (id, project_id, line_no, description, qty, uom, route) values
  ('d3000000-0000-0000-0000-0000000001a1','d3000000-0000-0000-0000-0000000000d1',1,'Sofa',40,'pcs','FACTORY'),
  ('d3000000-0000-0000-0000-0000000001a2','d3000000-0000-0000-0000-0000000000d1',2,'Table',20,'pcs','FACTORY'),
  ('d3000000-0000-0000-0000-0000000001a3','d3000000-0000-0000-0000-0000000000d1',3,'Lamp',10,'pcs','FACTORY'),
  ('d3000000-0000-0000-0000-0000000001b1','d3000000-0000-0000-0000-0000000000d2',1,'Bench',5,'pcs','FACTORY');
insert into ops_core.attachments (id, storage_path, filename, uploaded_by) values
  ('d3000000-0000-0000-0000-0000000000a1','drive-pl-1','packing-list.pdf','aaaa0000-0000-0000-0000-0000000d3001');

set local role authenticated;

-- The factory order: lines 1 and 2 at one factory.
do $$
declare r jsonb;
begin
  perform set_config('request.jwt.claim.sub', 'aaaa0000-0000-0000-0000-0000000d3002', true);
  r := ops_procure.create_factory_order('26981', 'V-CT1',
         '[{"line_no":1,"unit_price":1000000},{"line_no":2,"unit_price":500000}]');
  assert r->>'outcome' = 'ok', 'factory order: ' || r::text;
  perform set_config('test.po1', r->'data'->>'po_no', true);
  r := ops_procure.create_factory_order('26982', 'V-CT1', '[{"line_no":1,"unit_price":700000}]');
  assert r->>'outcome' = 'ok', 'other project''s order: ' || r::text;
  perform set_config('test.po2', r->'data'->>'po_no', true);
end $$;

do $$
declare r jsonb; po1 text := current_setting('test.po1'); po2 text := current_setting('test.po2');
        l1 text := 'd3000000-0000-0000-0000-0000000001a1'; l2 text := 'd3000000-0000-0000-0000-0000000001a2';
        l3 text := 'd3000000-0000-0000-0000-0000000001a3';
        dno text; dno2 text;
begin
  -- ── refusals, nothing written by any of them ────────────────────────────
  perform set_config('request.jwt.claim.sub', 'aaaa0000-0000-0000-0000-0000000d3003', true);
  r := ops_dlv.create_container('26981', ops_core.office_day(), format('[{"project_line_id":"%s","qty":10}]', l1)::jsonb, 'MSKU1234565');
  assert r->'error'->>'code' = 'not_permitted', 'production loads no containers: ' || r::text;

  perform set_config('request.jwt.claim.sub', 'aaaa0000-0000-0000-0000-0000000d3001', true);
  r := ops_dlv.create_container('26981', ops_core.office_day(), format('[{"project_line_id":"%s","qty":10}]', l1)::jsonb, '  ');
  assert r->'error'->>'code' = 'container_no_required', 'a number: ' || r::text;
  r := ops_dlv.create_container('26981', ops_core.office_day(), format('[{"project_line_id":"%s","qty":10}]', l1)::jsonb, 'MSK1234565');
  assert r->'error'->>'code' = 'bad_container_no', 'four letters, seven digits: ' || r::text;
  r := ops_dlv.create_container('26981', ops_core.office_day(), format('[{"project_line_id":"%s","qty":10}]', l1)::jsonb, 'MSKU1234565', null, '45');
  assert r->'error'->>'code' = 'bad_size', '20, 40 or 40HC: ' || r::text;
  r := ops_dlv.create_container('26981', ops_core.office_day(), format('[{"project_line_id":"%s","qty":10}]', l1)::jsonb, 'MSKU1234565',
         null, '40HC', null, ops_core.office_day() + 10, ops_core.office_day() + 5);
  assert r->'error'->>'code' = 'eta_before_etd', 'arrives after it leaves: ' || r::text;
  r := ops_dlv.create_container('26981', ops_core.office_day(), format('[{"project_line_id":"%s","qty":10}]', l1)::jsonb, 'MSKU1234565',
         null, '40HC', po2);
  assert r->'error'->>'code' = 'po_not_this_project', 'this project''s order: ' || r::text;
  r := ops_dlv.create_container('26981', ops_core.office_day(), format('[{"project_line_id":"%s","qty":10}]', l3)::jsonb, 'MSKU1234565',
         null, '40HC', po1);
  assert r->'error'->>'code' = 'line_not_on_order', 'the order''s lines only: ' || r::text;
  assert (select count(*) from ops_dlv.deliveries where project_code = '26981') = 0, 'nothing written by a refusal';

  -- ── loaded ──────────────────────────────────────────────────────────────
  r := ops_dlv.create_container('26981', ops_core.office_day() - 20,
         format('[{"project_line_id":"%s","qty":30},{"project_line_id":"%s","qty":20}]', l1, l2)::jsonb,
         'msku 123456-5', 'sl-778', '40hc', po1, ops_core.office_day() - 18, ops_core.office_day() - 2, null, 'Kontainer pertama');
  assert r->>'outcome' = 'ok' and jsonb_array_length(r->'data'->'warnings') = 0, 'loaded: ' || r::text;
  dno := r->'data'->>'delivery_no';
  assert (r->'data'->>'project_moved')::boolean, 'the project moved';
  assert (select status from ops_procure.projects where code = '26981') = 'SHIPPED', 'to SHIPPED';
  assert (select delivery_mode || '/' || container_no || '/' || seal_no || '/' || container_size || '/' || po_no || '/' || total_qty
            from ops_dlv.v_delivery where delivery_no = dno) = 'container/MSKU1234565/SL-778/40HC/' || po1 || '/50',
    'cleaned, sized, from its order, 50 pieces';
  assert (select days_past_eta from ops_dlv.v_delivery where delivery_no = dno) = 2, 'two days past its ETA';

  r := ops_dlv.create_container('26981', ops_core.office_day(), format('[{"project_line_id":"%s","qty":5}]', l3)::jsonb, 'MSKU1234565');
  assert r->'error'->>'code' = 'container_in_use' and r->'error'->'detail'->>'delivery_no' = dno,
    'one container, one ship: ' || r::text;

  -- A wrong check digit is said, not refused.
  r := ops_dlv.create_container('26981', ops_core.office_day(), format('[{"project_line_id":"%s","qty":5}]', l3)::jsonb, 'TGHU9876543', null, '20');
  assert r->>'outcome' = 'ok' and jsonb_array_length(r->'data'->'warnings') = 1, 'warned: ' || r::text;
  dno2 := r->'data'->>'delivery_no';

  -- ── corrected while at sea ──────────────────────────────────────────────
  r := ops_dlv.update_container(dno, 'MSKU1234565', 'SL-778', '40HC', ops_core.office_day() - 18, ops_core.office_day() + 3, 'mae123');
  assert r->>'outcome' = 'ok', 'B/L and a later ETA: ' || r::text;
  assert (select bl_no || '/' || coalesce(days_past_eta::text, 'on time') from ops_dlv.v_delivery where delivery_no = dno) = 'MAE123/on time',
    'the B/L, and no longer late';
  r := ops_dlv.update_container(dno, 'MSKU1234565', 'SL-778', '40HC', ops_core.office_day() - 18, ops_core.office_day() + 3, 'MAE123');
  assert r->>'outcome' = 'noop', 'same values: ' || r::text;
  r := ops_dlv.update_container(dno, 'TGHU9876543', 'SL-778', '40HC', ops_core.office_day() - 18, ops_core.office_day() + 3, 'MAE123');
  assert r->'error'->>'code' = 'container_in_use', 'not onto another live container: ' || r::text;

  -- ── its papers ──────────────────────────────────────────────────────────
  r := ops_dlv.file_container_doc(dno, 'invoice', 'd3000000-0000-0000-0000-0000000000a1');
  assert r->'error'->>'code' = 'unknown_kind', 'packing list or B/L: ' || r::text;
  r := ops_dlv.file_container_doc(dno, 'packing_list', gen_random_uuid());
  assert r->'error'->>'code' = 'no_such_file', 'uploaded first: ' || r::text;
  r := ops_dlv.file_container_doc(dno, 'Packing List', 'd3000000-0000-0000-0000-0000000000a1');
  assert r->>'outcome' = 'ok', 'filed: ' || r::text;
  assert (select container_docs->0->>'kind' from ops_dlv.v_delivery where delivery_no = dno) = 'packing_list', 'on the container';
  assert ops_core.drive_path_for_record('packing_list', 'delivery', dno)
         = 'PENGIRIMAN/CL-0981 PT CONTOH KONTAINER/26981 RESORT KONTAINER', 'in the project''s shipping folder';

  -- ── arrived: a record of a voyage, and its number free again ────────────
  r := ops_dlv.mark_arrived(dno, 'Pak Site', 'd3000000-0000-0000-0000-0000000000a1');
  assert r->>'outcome' = 'ok', 'arrived: ' || r::text;
  r := ops_dlv.update_container(dno, 'MSKU1234565', 'SL-778', '40HC', ops_core.office_day() - 18, ops_core.office_day() + 3, 'MAE999');
  assert r->'error'->>'code' = 'closed', 'an arrived container is not corrected: ' || r::text;
  r := ops_dlv.create_container('26981', ops_core.office_day(), format('[{"project_line_id":"%s","qty":10}]', l1)::jsonb, 'MSKU1234565', null, null, po1);
  assert r->>'outcome' = 'ok', 'the same box sails again: ' || r::text;

  -- A lorry is not a container.
  r := ops_dlv.create_delivery('26981', ops_core.office_day(), format('[{"project_line_id":"%s","qty":1}]', l3)::jsonb, 'B 1234 CD', 'Budi');
  assert r->>'outcome' = 'ok', 'a truck: ' || r::text;
  r := ops_dlv.update_container(r->'data'->>'delivery_no', 'MSKU1234565', null, null, null, null, null);
  assert r->'error'->>'code' = 'not_a_container', 'not a container: ' || r::text;

  -- Logistics reads the order's number without reading orders.
  assert (select count(*) from ops_procure.purchase_orders where po_no = po1) = 0, 'logistics reads no orders';
  assert (select count(*) from ops_dlv.v_delivery where po_no = po1) = 2, 'but sees which order each container is from';
end $$;

rollback;
