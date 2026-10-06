-- procure — a project read from first contact to handover, and the pipeline's
-- numbers (0229, P7, kajian F224 §4.6).
--
-- DERIVATIONS  every kind of event recorded P1–P6 and after the deal shows on
--              the project's timeline with its day and its person: status,
--              contact, meeting, a meeting line closed, a quotation sent and
--              accepted, a file, a design item added and dropped, an
--              approval, a drawing released, a Job Order, a delivery and its
--              receipt, an installation, the BAST; a project that reached the
--              deal is won with its days to the deal, one that closed LOST is
--              lost with its reason
-- REFUSALS     a drafter reads the design and the floor but not the sales log;
--              somebody with neither reads nothing; the outcome is the
--              sellers' only

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('aaaa0000-0000-0000-0000-0000000c5001','mkt-tl@talaliving.com','{"full_name":"Rina Timeline"}'),
  ('aaaa0000-0000-0000-0000-0000000c5002','drafter-tl@talaliving.com','{"full_name":"Ayu Drafter"}'),
  ('aaaa0000-0000-0000-0000-0000000c5003','gudang-tl@talaliving.com','{"full_name":"Gudang"}'),
  ('aaaa0000-0000-0000-0000-0000000c5004','pimpinan-tl@talaliving.com','{"full_name":"Pimpinan"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('aaaa0000-0000-0000-0000-0000000c5004','project','write'),
  ('aaaa0000-0000-0000-0000-0000000c5001','marketing','write'),
  ('aaaa0000-0000-0000-0000-0000000c5002','production','write'),
  ('aaaa0000-0000-0000-0000-0000000c5003','inventory','write');

insert into ops_procure.clients (id, code, name) values
  ('c5000000-0000-0000-0000-0000000000c1','CL-0957','PT Contoh Timeline');
insert into ops_procure.projects (id, code, name, client_id, created_at, status, sales_pic, source_note, expected_value) values
  ('c5000000-0000-0000-0000-0000000000d1','26957','Villa Timeline','c5000000-0000-0000-0000-0000000000c1',
   now() - interval '30 days', 'INQUIRY', 'aaaa0000-0000-0000-0000-0000000c5001', 'Instagram', 100000000),
  ('c5000000-0000-0000-0000-0000000000d2','26958','Villa Kalah','c5000000-0000-0000-0000-0000000000c1',
   now() - interval '20 days', 'INQUIRY', 'aaaa0000-0000-0000-0000-0000000c5001', 'Instagram', 50000000);

update ops_core.drive_folders set folder_id = coalesce(folder_id, 'OPS_' || slug)
 where slug in ('drafting','project-manager','production');

set local role authenticated;
set local request.jwt.claim.sub = 'aaaa0000-0000-0000-0000-0000000c5001';

-- the sale and the design, through the seams
do $$
declare r jsonb; qt text; v_act uuid; v_pt uuid;
begin
  r := ops_procure.log_meeting(null, 'meeting', 'Presentasi konsep', '26957', null, ops_core.office_day() - 25, null, null,
         jsonb_build_array(jsonb_build_object('side','client','name','Ibu Sari')),
         jsonb_build_array(jsonb_build_object('kind','action','body','Kirim penawaran')));
  v_act := (r->'data'->>'id')::uuid;
  perform ops_procure.log_client_activity(null, 'call', 'Tanya keputusan', '26957', null, ops_core.office_day() - 10);

  perform ops_procure.save_design_collection('26957', 'A', 'Type 2BR');
  perform ops_procure.save_design_room('26957', 'A', 'LR', 'Living room');
  perform ops_procure.save_design_item('26957', 'A', 'LR', 'Sofa', 2, 'tala');
  perform ops_procure.save_design_item('26957', 'A', 'LR', 'Rak', 1, 'tala');
  perform ops_procure.set_design_item_dropped('26957-A-LR-02', true, 'Tidak jadi');
  perform ops_procure.record_design_approval('26957-A-LR-01', 'approved', ops_core.office_day() - 12, 'meeting', 'Ibu Sari');

  r := ops_core.attach_file('DRV_TL_1', 'brief.pdf', 'application/pdf', 100, null, 'web', null, 'brief', 'project',
                            null, null, '26957', 'client');
  perform ops_core.attach_link((r->'data'->>'attachment_id')::uuid, 'project', '26957', 'Client Brief');

  r := ops_procure.save_quotation(null, '26957', ops_core.office_day() + 14, 0, 0, 20);
  qt := r->'data'->>'quote_no';
  perform ops_procure.add_quotation_lines_from_design(qt, array['26957-A-LR-01']);
  perform ops_procure.save_quotation_line(qt, (select id from ops_procure.quotation_lines where description like 'Sofa%'),
                                          null, 'Sofa', 2, 'unit', null, null, null, null, null, 5000000);
  r := ops_procure.send_quotation(qt);
  assert ops_core.said_ok(r), 'sent: ' || r::text;
  r := ops_procure.decide_quotation(qt, true);
  assert ops_core.said_ok(r), 'accepted: ' || r::text;

  select id into v_pt from ops_procure.meeting_points where activity_id = v_act;
  perform ops_procure.close_meeting_point(v_pt, 'Terkirim');

  -- the other one is lost
  r := ops_procure.set_project_status('26958', 'LOST', 'Klien memilih vendor lain', 'PRICE');
  assert ops_core.said_ok(r), 'lost: ' || r::text;
end $$;

-- the drafter releases the sofa's drawing
set local request.jwt.claim.sub = 'aaaa0000-0000-0000-0000-0000000c5002';
do $$
declare r jsonb; tno text; f uuid;
begin
  r := ops_prod.create_design_task('gambar_kerja', '26957-A-LR-01');
  tno := r->'data'->>'task_no';
  r := ops_core.attach_file('DRV_TL_2', 'sofa-gk.pdf', 'application/pdf', 100, null, 'web', null, 'gambar_kerja',
                            'design_item', null, null, '26957-A-LR-01', 'tala');
  f := (r->'data'->>'attachment_id')::uuid;
  perform ops_core.attach_link(f, 'design_item', '26957-A-LR-01', 'Gambar Kerja');
  r := ops_prod.add_design_revision(tno, 'A', f, null, true);
  assert ops_core.said_ok(r), 'released: ' || r::text;
end $$;

-- the floor and the site (written directly: their own seams are tested elsewhere)
reset role;
insert into ops_prod.work_orders (item_name, product_code, qty, uom, route, due_date, project_code, created_by) values
  ('Sofa', null, 2, 'unit', 'IN_HOUSE', ops_core.office_day() + 10, '26957', 'aaaa0000-0000-0000-0000-0000000c5002');
insert into ops_core.attachments (id, storage_path, filename, sha256, mime, bytes, uploaded_by, source)
values ('c5000000-0000-0000-0000-00000000aa01', 'x/sj.pdf', 'sj.pdf', 'c5sj', 'application/pdf', 1,
        'aaaa0000-0000-0000-0000-0000000c5002', 'web'),
       ('c5000000-0000-0000-0000-00000000aa02', 'x/bast.pdf', 'bast.pdf', 'c5bast', 'application/pdf', 1,
        'aaaa0000-0000-0000-0000-0000000c5002', 'web');
insert into ops_dlv.deliveries (project_code, dispatched_on, status, received_by, received_at, surat_jalan_attachment_id, created_by)
values ('26957', ops_core.office_day() - 2, 'ARRIVED', 'Pak Satpam', now() - interval '1 day',
        'c5000000-0000-0000-0000-00000000aa01', 'aaaa0000-0000-0000-0000-0000000c5004');
insert into ops_dlv.installations (project_code, visit_date, crew, created_by)
values ('26957', ops_core.office_day() - 1, 'Tim A', 'aaaa0000-0000-0000-0000-0000000c5004');
insert into ops_dlv.handovers (project_code, handed_on, client_rep, our_rep, bast_attachment_id, created_by)
values ('26957', ops_core.office_day(), 'Ibu Sari', 'Rina', 'c5000000-0000-0000-0000-00000000aa02',
        'aaaa0000-0000-0000-0000-0000000c5004');
set local role authenticated;
-- leadership reads the whole road
set local request.jwt.claim.sub = 'aaaa0000-0000-0000-0000-0000000c5004';

do $$
declare v_kinds text; v jsonb;
begin
  select string_agg(distinct kind, ',' order by kind) into v_kinds
    from ops_procure.v_project_timeline where project_code = '26957';
  assert v_kinds = 'approval,contact,delivery,delivery_received,design_dropped,design_item,drawing_released,file,handover,'
                || 'installation,job_order,meeting,point_closed,quote_accepted,quote_sent,status',
    'every kind of event is on the timeline: ' || v_kinds;
  assert not exists (select 1 from ops_procure.v_project_timeline where project_code = '26957' and actor_name is null
                      and kind not in ('delivery_received')),
    'every event names its person';
  select to_jsonb(x) into v from ops_procure.v_project_timeline x where project_code = '26957' and kind = 'meeting';
  assert (v->>'day')::date = ops_core.office_day() - 25 and v->>'detail' = 'Presentasi konsep',
    'a meeting on its own day: ' || v::text;
  assert (select count(*) from ops_procure.v_project_timeline where project_code = '26957' and kind = 'file') = 2,
    'the brief and the drawing are both its files';

  select to_jsonb(x) into v from ops_procure.v_project_outcome x where project_code = '26957';
  assert v->>'outcome' = 'won' and (v->>'days_to_deal')::int = 30 and v->>'sales_pic_name' = 'Rina Timeline'
     and (v->>'value')::numeric = 10000000, 'won, 30 days to the deal, at the accepted offer: ' || v::text;
  select to_jsonb(x) into v from ops_procure.v_project_outcome x where project_code = '26958';
  assert v->>'outcome' = 'lost' and v->>'closing_reason_code' = 'PRICE' and (v->>'value')::numeric = 50000000,
    'lost, on price, at its estimate: ' || v::text;
end $$;

-- marketing alone: the sale and the design, not the site — the timeline is
-- read with each reader's own access (delivery is project or delivery's)
set local request.jwt.claim.sub = 'aaaa0000-0000-0000-0000-0000000c5001';
do $$
begin
  assert exists (select 1 from ops_procure.v_project_timeline where project_code = '26957' and kind = 'quote_accepted'),
    'the seller reads the sale';
  assert not exists (select 1 from ops_procure.v_project_timeline where project_code = '26957' and kind in ('delivery','handover')),
    'and not the site''s rows, which their access does not read';
end $$;

-- the drafter: design and floor, not the sales log
set local request.jwt.claim.sub = 'aaaa0000-0000-0000-0000-0000000c5002';
do $$
begin
  assert exists (select 1 from ops_procure.v_project_timeline where project_code = '26957' and kind = 'drawing_released'),
    'a drafter reads the drawings';
  assert not exists (select 1 from ops_procure.v_project_timeline where project_code = '26957' and kind in ('contact','meeting')),
    'and not the sales log';
  assert (select count(*) from ops_procure.v_project_outcome) = 0, 'nor the pipeline''s numbers';
end $$;

set local request.jwt.claim.sub = 'aaaa0000-0000-0000-0000-0000000c5003';
do $$
begin
  assert (select count(*) from ops_procure.v_project_timeline) = 0, 'an outsider reads no timeline';
end $$;

rollback;
