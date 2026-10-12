-- qc — the field QC team and who watches which factory order (0260/0261,
-- O6, kajian F255 §5.7, Q88, D418).
--
-- DERIVATIONS  linking an account grants it qc: write once; a QC reads only
--              their own live assignments, and through them the order's
--              number, factory, project and lines with the working drawing,
--              never a price; leadership and procurement read every one; a
--              second QC on an order is named, not refused; an assignment
--              starting later is PLANNED, one past its end ENDED; switching
--              somebody off with live work is said, not refused
-- REFUSALS     keeping the team without qc.coordinate (marketing, project
--              editors); a person with no name; an account that does not
--              exist, or is linked to somebody else; assigning an unknown
--              person or order, a supplier PO, no start, an end before the
--              start, the same person twice, somebody switched off; switching
--              off without a reason; ending before the start; cancelling
--              without a reason, or twice

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('aaaa0000-0000-0000-0000-0000000d4001','koord-qc@talaliving.com','{"full_name":"Koordinator QC"}'),
  ('aaaa0000-0000-0000-0000-0000000d4002','yudi-qc@gmail.com','{"full_name":"Yudi QC"}'),
  ('aaaa0000-0000-0000-0000-0000000d4003','sari-qc@gmail.com','{"full_name":"Sari QC"}'),
  ('aaaa0000-0000-0000-0000-0000000d4004','proc-qc@talaliving.com','{"full_name":"Andi QC"}'),
  ('aaaa0000-0000-0000-0000-0000000d4005','mkt-qc@talaliving.com','{"full_name":"Rina QC"}'),
  ('aaaa0000-0000-0000-0000-0000000d4006','pm-qc@talaliving.com','{"full_name":"PM QC"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('aaaa0000-0000-0000-0000-0000000d4001','qc','admin'),
  ('aaaa0000-0000-0000-0000-0000000d4003','qc','write'),
  ('aaaa0000-0000-0000-0000-0000000d4004','procurement','write'),
  ('aaaa0000-0000-0000-0000-0000000d4005','marketing','write'),
  ('aaaa0000-0000-0000-0000-0000000d4006','project','write');

insert into ops_procure.clients (id, code, name) values
  ('d4000000-0000-0000-0000-0000000000c1','CL-0991','PT Contoh QC');
insert into ops_procure.projects (id, code, name, client_id, status) values
  ('d4000000-0000-0000-0000-0000000000d1','26991','Resort QC','d4000000-0000-0000-0000-0000000000c1','IN_PRODUCTION');
insert into ops_procure.vendors (id, code, name, kind) values
  ('d4000000-0000-0000-0000-0000000000f1','V-QC1','PT Pabrik QC','factory'),
  ('d4000000-0000-0000-0000-0000000000f2','V-QC2','Toko Bahan QC','supplier');

set local role authenticated;
set local request.jwt.claim.sub = 'aaaa0000-0000-0000-0000-0000000d4006';
do $$
begin
  perform ops_procure.save_design_collection('26991', 'A', 'Villa');
  perform ops_procure.save_design_room('26991', 'A', 'LR', 'Living room');
  perform ops_procure.save_design_item('26991', 'A', 'LR', 'Sofa', 10, 'tala');
end $$;
reset role;
insert into ops_procure.project_lines (id, project_id, line_no, description, qty, uom, route, design_item_id) values
  ('d4000000-0000-0000-0000-0000000001a1','d4000000-0000-0000-0000-0000000000d1',1,'Sofa',10,'pcs','FACTORY',
   (select id from ops_procure.design_items where item_no = '26991-A-LR-01')),
  ('d4000000-0000-0000-0000-0000000001a2','d4000000-0000-0000-0000-0000000000d1',2,'Table',5,'pcs','FACTORY',null);
insert into ops_core.attachments (id, storage_path, filename, uploaded_by) values
  ('d4000000-0000-0000-0000-0000000000a1','drive-gk-1','sofa-gambar-kerja.pdf','aaaa0000-0000-0000-0000-0000000d4006');
insert into ops_core.attachment_links (attachment_id, entity, entity_no, kind, linked_by) values
  ('d4000000-0000-0000-0000-0000000000a1','design_item','26991-A-LR-01','gambar_kerja','aaaa0000-0000-0000-0000-0000000d4006');
set local role authenticated;

-- Two orders: a factory order for the project, and a supplier PO.
do $$
declare r jsonb;
begin
  perform set_config('request.jwt.claim.sub', 'aaaa0000-0000-0000-0000-0000000d4004', true);
  r := ops_procure.create_factory_order('26991', 'V-QC1',
         '[{"line_no":1,"unit_price":2000000},{"line_no":2,"unit_price":900000}]');
  assert r->>'outcome' = 'ok', 'factory order: ' || r::text;
  perform set_config('test.po1', r->'data'->>'po_no', true);
  r := ops_procure.create_po('V-QC2', '[{"description":"Lem","qty":1,"uom":"pcs","unit_price":10000}]');
  assert r->>'outcome' = 'ok', 'supplier po: ' || r::text;
  perform set_config('test.po2', r->'data'->>'po_no', true);
end $$;

do $$
declare r jsonb; po1 text := current_setting('test.po1'); po2 text := current_setting('test.po2');
        a1 text; a2 text; a3 text;
begin
  -- ── keeping the team is the coordinator's ───────────────────────────────
  perform set_config('request.jwt.claim.sub', 'aaaa0000-0000-0000-0000-0000000d4005', true);
  r := ops_qc.save_qc_person(null, 'Yudi');
  assert r->'error'->>'code' = 'not_permitted', 'marketing keeps no team: ' || r::text;
  perform set_config('request.jwt.claim.sub', 'aaaa0000-0000-0000-0000-0000000d4006', true);
  r := ops_qc.save_qc_person(null, 'Yudi');
  assert r->'error'->>'code' = 'not_permitted', 'nor a project editor: ' || r::text;

  perform set_config('request.jwt.claim.sub', 'aaaa0000-0000-0000-0000-0000000d4001', true);
  r := ops_qc.save_qc_person(null, '  ');
  assert r->'error'->>'code' = 'name_required', 'a name: ' || r::text;
  r := ops_qc.save_qc_person(null, 'Yudi', null, null, null, 'nobody@nowhere.com');
  assert r->'error'->>'code' = 'account_unknown', 'an account that exists: ' || r::text;
  assert (select count(*) from ops_qc.qc_people) = 0, 'nothing written by a refusal';

  r := ops_qc.save_qc_person(null, 'Yudi Santoso', '0812-1111', 'Jepara', null, 'YUDI-QC@gmail.com');
  assert r->>'outcome' = 'ok' and (r->'data'->>'granted_qc_write')::boolean, 'Yudi, with his account: ' || r::text;
  perform set_config('test.yudi', r->'data'->>'code', true);
  assert (select account_email || '/' || account_qc_level from ops_qc.v_qc_person where code = current_setting('test.yudi'))
         = 'yudi-qc@gmail.com/write', 'his account now opens QC';
  r := ops_qc.save_qc_person(null, 'Sari Dewi', null, 'Cirebon');
  assert r->>'outcome' = 'ok', 'Sari, no account yet: ' || r::text;
  perform set_config('test.sari', r->'data'->>'code', true);
  r := ops_qc.save_qc_person(current_setting('test.sari'), 'Sari Dewi', null, 'Cirebon', null, 'yudi-qc@gmail.com');
  assert r->'error'->>'code' = 'account_taken', 'one account, one person: ' || r::text;
  r := ops_qc.save_qc_person(current_setting('test.sari'), 'Sari Dewi', null, 'Cirebon', null, 'sari-qc@gmail.com');
  assert r->>'outcome' = 'ok' and not (r->'data'->>'granted_qc_write')::boolean, 'Sari already held qc: ' || r::text;

  -- ── assignments ─────────────────────────────────────────────────────────
  r := ops_qc.assign_qc('QC-999', po1, ops_core.office_day());
  assert r->'error'->>'code' = 'person_unknown', 'a person on the team: ' || r::text;
  r := ops_qc.assign_qc(current_setting('test.yudi'), 'po-nope', ops_core.office_day());
  assert r->'error'->>'code' = 'order_unknown', 'an order that exists: ' || r::text;
  r := ops_qc.assign_qc(current_setting('test.yudi'), po2, ops_core.office_day());
  assert r->'error'->>'code' = 'not_factory_order', 'QC watches factory orders: ' || r::text;
  r := ops_qc.assign_qc(current_setting('test.yudi'), po1, null);
  assert r->'error'->>'code' = 'start_required', 'a start: ' || r::text;
  r := ops_qc.assign_qc(current_setting('test.yudi'), po1, ops_core.office_day(), ops_core.office_day() - 1);
  assert r->'error'->>'code' = 'end_before_start', 'ends after it starts: ' || r::text;

  r := ops_qc.assign_qc(current_setting('test.yudi'), po1, ops_core.office_day() - 3, null, 'Kontainer 1–5');
  assert r->>'outcome' = 'ok' and r->'data'->>'others_on_order' is null, 'Yudi on the order: ' || r::text;
  a1 := r->'data'->>'assign_no';
  r := ops_qc.assign_qc(current_setting('test.yudi'), po1, ops_core.office_day());
  assert r->'error'->>'code' = 'already_assigned', 'once per order: ' || r::text;
  r := ops_qc.assign_qc(current_setting('test.sari'), po1, ops_core.office_day() + 7);
  assert r->>'outcome' = 'ok' and r->'data'->>'others_on_order' = 'Yudi Santoso', 'a second QC is named: ' || r::text;
  a2 := r->'data'->>'assign_no';
  assert (select state from ops_qc.v_qc_assignment where assign_no = a2) = 'PLANNED', 'starts next week';
  assert (select state from ops_qc.v_qc_assignment where assign_no = a1) = 'ACTIVE', 'started three days ago';

  -- ── switched off ────────────────────────────────────────────────────────
  r := ops_qc.set_qc_person_active(current_setting('test.sari'), false);
  assert r->'error'->>'code' = 'reason_required', 'why: ' || r::text;
  r := ops_qc.set_qc_person_active(current_setting('test.sari'), false, 'Pindah kota');
  assert r->>'outcome' = 'ok' and jsonb_array_length(r->'data'->'warnings') = 1, 'said, not refused: ' || r::text;
  r := ops_qc.assign_qc(current_setting('test.sari'), po1, ops_core.office_day());
  assert r->'error'->>'code' = 'person_inactive', 'nobody switched off is sent: ' || r::text;

  -- ── what each reader sees ───────────────────────────────────────────────
  perform set_config('request.jwt.claim.sub', 'aaaa0000-0000-0000-0000-0000000d4002', true);
  assert (select count(*) from ops_qc.v_qc_assignment) = 1, 'Yudi sees his own assignment only';
  assert (select po_no || '/' || vendor_name || '/' || project_code || '/' || line_count from ops_qc.v_qc_assignment)
         = po1 || '/PT Pabrik QC/26991/2', 'the order, its factory, its project';
  assert (select is_mine from ops_qc.v_qc_assignment), 'marked his';
  assert (select count(*) from ops_procure.purchase_orders) = 0, 'but he reads no purchase orders';
  assert (select count(*) from ops_qc.v_qc_person) = 1, 'and only himself on the team';
  assert (select string_agg(line_no || ':' || description || ':' || qty || ':' || coalesce(drawing_filename, '-'), ' ' order by line_no)
            from ops_qc.assignment_lines(a1)) = '1:26991-A-LR-01 · Sofa:10:sofa-gambar-kerja.pdf 2:Table:5:-'
         or (select string_agg(line_no || ':' || coalesce(drawing_filename, '-'), ' ' order by line_no) from ops_qc.assignment_lines(a1)) = '1:sofa-gambar-kerja.pdf 2:-',
    'the lines and the working drawing: ' || coalesce((select string_agg(line_no || ':' || description || ':' || coalesce(drawing_filename, '-'), ' ') from ops_qc.assignment_lines(a1)), 'none');
  assert (select count(*) from ops_qc.assignment_lines(a2)) = 0, 'not Sari''s';

  perform set_config('request.jwt.claim.sub', 'aaaa0000-0000-0000-0000-0000000d4003', true);
  assert (select count(*) from ops_qc.v_qc_assignment) = 0, 'Sari, switched off, sees nothing';

  perform set_config('request.jwt.claim.sub', 'aaaa0000-0000-0000-0000-0000000d4005', true);
  assert (select count(*) from ops_qc.v_qc_assignment) = 0, 'marketing sees no assignments';

  assert (select count(*) from ops_qc.assignable_orders()) = 0, 'nor the orders to send people to';

  perform set_config('request.jwt.claim.sub', 'aaaa0000-0000-0000-0000-0000000d4004', true);
  assert (select count(*) from ops_qc.v_qc_assignment) = 2, 'procurement sees every one';

  perform set_config('request.jwt.claim.sub', 'aaaa0000-0000-0000-0000-0000000d4001', true);
  assert (select po_no || '/' || qc_names from ops_qc.assignable_orders()) = po1 || '/Sari Dewi, Yudi Santoso',
    'the coordinator picks from factory orders only, and sees who is on each';

  -- ── ended, cancelled ────────────────────────────────────────────────────
  perform set_config('request.jwt.claim.sub', 'aaaa0000-0000-0000-0000-0000000d4001', true);
  r := ops_qc.end_qc_assignment(a1, ops_core.office_day() - 10);
  assert r->'error'->>'code' = 'end_before_start', 'not before the start: ' || r::text;
  r := ops_qc.end_qc_assignment(a1, ops_core.office_day() - 1);
  assert r->>'outcome' = 'ok', 'ended yesterday: ' || r::text;
  assert (select state from ops_qc.v_qc_assignment where assign_no = a1) = 'ENDED', 'ENDED';
  r := ops_qc.end_qc_assignment(a1, ops_core.office_day() - 1);
  assert r->>'outcome' = 'noop', 'same date: ' || r::text;
  r := ops_qc.cancel_qc_assignment(a2, ' ');
  assert r->'error'->>'code' = 'reason_required', 'why: ' || r::text;
  r := ops_qc.cancel_qc_assignment(a2, 'Salah orang');
  assert r->>'outcome' = 'ok', 'cancelled: ' || r::text;
  r := ops_qc.cancel_qc_assignment(a2, 'lagi');
  assert r->'error'->>'code' = 'already_cancelled', 'once: ' || r::text;
  assert (select state || '/' || cancel_reason from ops_qc.v_qc_assignment where assign_no = a2) = 'CANCELLED/Salah orang',
    'kept, with its reason';
end $$;

rollback;
