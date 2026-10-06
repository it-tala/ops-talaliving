-- prod — the drafters' queue, live: tasks per design item or product,
-- revisions that are files, and questions that hold a release (0226, P6,
-- D179, D379).
--
-- DERIVATIONS  a task's status is read — BELUM, DIGAMBAR once held or drawn,
--              TANYA while a question is open, RILIS once released; a newer
--              revision than the released one is `ahead_of_release`; the
--              task is needed by the live project's target date or the open
--              work order's; an item task reads its client, project,
--              collection and room; an approved item with no working-drawing
--              task is a gap, and stops being one when a task is raised;
--              a product on an open work order with no task is a gap per kind
-- REFUSALS     a task for nothing, a dropped item, a second task for the same
--              drawing; a revision with no file, with a file not on the item,
--              with a number used before; releasing over an open question;
--              answering twice; a seller taking a task on or uploading; an
--              outsider reading or writing anything

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('aaaa0000-0000-0000-0000-0000000c4001','mkt-dsn@talaliving.com','{"full_name":"Rina Desain"}'),
  ('aaaa0000-0000-0000-0000-0000000c4002','drafter-dsn@talaliving.com','{"full_name":"Ayu Drafter"}'),
  ('aaaa0000-0000-0000-0000-0000000c4003','gudang-dsn@talaliving.com','{"full_name":"Gudang"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('aaaa0000-0000-0000-0000-0000000c4001','marketing','write'),
  ('aaaa0000-0000-0000-0000-0000000c4002','production','write'),
  ('aaaa0000-0000-0000-0000-0000000c4003','inventory','write');

insert into ops_procure.clients (id, code, name) values
  ('c4000000-0000-0000-0000-0000000000c1','CL-0956','PT Contoh Drafter');
insert into ops_procure.projects (id, code, name, client_id, target_date) values
  ('c4000000-0000-0000-0000-0000000000d1','26956','Villa Drafter','c4000000-0000-0000-0000-0000000000c1',
   ops_core.office_day() + 20);
insert into ops_prod.products (product_code, name, category, uom) values ('DSN-RAK', 'Rak dinding', 'Rak', 'unit');
insert into ops_prod.work_orders (item_name, product_code, qty, uom, route, due_date) values
  ('Rak dinding', 'DSN-RAK', 4, 'unit', 'IN_HOUSE', ops_core.office_day() + 5);

update ops_core.drive_folders set folder_id = coalesce(folder_id, 'OPS_' || slug) where slug in ('drafting','production');

set local role authenticated;
set local request.jwt.claim.sub = 'aaaa0000-0000-0000-0000-0000000c4001';

-- the seller raises tasks for items
do $$
declare r jsonb; v jsonb;
begin
  perform ops_procure.save_design_collection('26956', 'A', 'Type 2BR');
  perform ops_procure.save_design_room('26956', 'A', 'LR', 'Living room');
  perform ops_procure.save_design_item('26956', 'A', 'LR', 'Sofa 3 seater', 2, 'tala', 2100, 900, 780);
  perform ops_procure.save_design_item('26956', 'A', 'LR', 'Coffee table', 2, 'tala');
  perform ops_procure.save_design_item('26956', 'A', 'LR', 'Rak lama', 1, 'tala');
  perform ops_procure.set_design_item_dropped('26956-A-LR-03', true, 'Tidak jadi');
  perform ops_procure.record_design_approval('26956-A-LR-02', 'approved', ops_core.office_day(), 'meeting', 'Ibu Sari');

  assert exists (select 1 from ops_prod.v_design_gap where item_no = '26956-A-LR-02' and kind = 'gambar_kerja'),
    'an approved item with no working drawing is a gap';
  assert (select count(*) from ops_prod.v_design_gap where product_code = 'DSN-RAK') = 2,
    'a product on an open work order with no task is a gap per kind';

  r := ops_prod.create_design_task('gambar_kerja');
  assert r->'error'->>'code' = 'nothing_to_draw', 'a task draws something: ' || r::text;
  r := ops_prod.create_design_task('gambar_kerja', '26956-A-LR-03');
  assert r->'error'->>'code' = 'item_dropped', 'not a dropped item: ' || r::text;
  r := ops_prod.create_design_task('gambar_kerja', '26956-A-LR-01', null, null, null, 'Ukuran dari survei', 'dsn-1');
  assert ops_core.said_ok(r), 'item task: ' || r::text;
  assert (ops_prod.create_design_task('gambar_kerja', '26956-A-LR-01', null, null, null, null, 'dsn-1'))->'data'->>'task_no'
         = r->'data'->>'task_no', 'the same key is the same task';
  r := ops_prod.create_design_task('gambar_kerja', '26956-A-LR-01');
  assert r->'error'->>'code' = 'task_exists', 'one task per drawing: ' || r::text;
  r := ops_prod.create_design_task('gambar_kerja', '26956-A-LR-02');
  assert ops_core.said_ok(r), 'second item: ' || r::text;
  assert not exists (select 1 from ops_prod.v_design_gap where item_no = '26956-A-LR-02'), 'raised, no longer a gap';

  select to_jsonb(x) into v from ops_prod.v_design_task x where item_no = '26956-A-LR-01';
  assert v->>'status' = 'BELUM' and v->>'client_code' = 'CL-0956' and v->>'room_name' = 'Living room'
     and v->>'collection_code' = 'A' and v->>'product_name' = 'Sofa 3 seater'
     and v->>'dimension' = '2100 × 900 × 780 mm' and (v->>'needed_by')::date = ops_core.office_day() + 20
     and (v->>'days_left')::int = 20 and not (v->>'item_approved')::boolean,
    'an item task reads its place, its date, and that the client has not approved it: ' || v::text;
  assert (select item_approved from ops_prod.v_design_task where item_no = '26956-A-LR-02'), 'the approved item reads approved';

  r := ops_prod.assign_design_task((v->>'task_no'), 'Ayu');
  assert r->'error'->>'code' = 'not_permitted', 'a seller does not take a task on: ' || r::text;
end $$;

-- the drafter
set local request.jwt.claim.sub = 'aaaa0000-0000-0000-0000-0000000c4002';
do $$
declare r jsonb; v jsonb; tno text; f_a uuid; f_b uuid; f_other uuid; q uuid;
begin
  select task_no into tno from ops_prod.v_design_task where item_no = '26956-A-LR-01';
  r := ops_prod.assign_design_task(tno, 'Ayu Drafter', ops_core.office_day() + 3, false);
  assert ops_core.said_ok(r), 'assigned: ' || r::text;
  select to_jsonb(x) into v from ops_prod.v_design_task x where task_no = tno;
  assert v->>'status' = 'DIGAMBAR' and (v->>'needed_by')::date = ops_core.office_day() + 3,
    'held, and its own date comes first: ' || v::text;

  r := ops_core.attach_file('DRV_DSN_A', 'sofa-gk-a.pdf', 'application/pdf', 100, null, 'web', null, 'gambar_kerja',
                            'design_item', null, null, '26956-A-LR-01', 'tala');
  f_a := (r->'data'->>'attachment_id')::uuid;
  perform ops_core.attach_link(f_a, 'design_item', '26956-A-LR-01', 'Gambar Kerja');
  r := ops_core.attach_file('DRV_DSN_X', 'meja.pdf', 'application/pdf', 100, null, 'web', null, 'gambar_kerja',
                            'design_item', null, null, '26956-A-LR-02', 'tala');
  f_other := (r->'data'->>'attachment_id')::uuid;
  perform ops_core.attach_link(f_other, 'design_item', '26956-A-LR-02', 'Gambar Kerja');

  r := ops_prod.add_design_revision(tno, 'A', null);
  assert r->'error'->>'code' = 'file_required', 'a revision is a file: ' || r::text;
  r := ops_prod.add_design_revision(tno, 'A', f_other);
  assert r->'error'->>'code' = 'file_not_on_task', 'the item''s own file: ' || r::text;
  r := ops_prod.add_design_revision(tno, 'a', f_a, 'Rev pertama');
  assert ops_core.said_ok(r) and r->'data'->>'rev' = 'A', 'revision A: ' || r::text;
  r := ops_prod.add_design_revision(tno, 'A', f_a);
  assert r->'error'->>'code' = 'rev_exists', 'one A: ' || r::text;

  -- a question holds the release
  r := ops_prod.ask_design_question(tno, 'klien', 'Tinggi dudukan 42 atau 45 cm?');
  assert ops_core.said_ok(r), 'asked: ' || r::text;
  q := (r->'data'->>'question_id')::uuid;
  select to_jsonb(x) into v from ops_prod.v_design_task x where task_no = tno;
  assert v->>'status' = 'TANYA' and (v->>'is_blocked')::boolean, 'blocked: ' || v::text;
  r := ops_prod.release_design_revision(tno, 'A');
  assert r->'error'->>'code' = 'question_open', 'no release over a question: ' || r::text;
  assert (select waiting_days from ops_prod.v_design_question where id = q) = 0, 'waiting since today';
end $$;

-- the seller answers for the client
set local request.jwt.claim.sub = 'aaaa0000-0000-0000-0000-0000000c4001';
do $$
declare r jsonb; q uuid;
begin
  select id into q from ops_prod.v_design_question where answer is null;
  r := ops_prod.answer_design_question(q, '45 cm, sesuai meeting');
  assert ops_core.said_ok(r), 'answered: ' || r::text;
  r := ops_prod.answer_design_question(q, 'lain');
  assert r->'error'->>'code' = 'already_answered', 'once: ' || r::text;
  r := ops_prod.add_design_revision((select task_no from ops_prod.v_design_task where item_no = '26956-A-LR-01'),
                                    'B', (select attachment_id from ops_prod.design_revisions limit 1));
  assert r->'error'->>'code' = 'not_permitted', 'a seller does not upload revisions: ' || r::text;
end $$;

-- released, then drawn again
set local request.jwt.claim.sub = 'aaaa0000-0000-0000-0000-0000000c4002';
do $$
declare r jsonb; v jsonb; tno text; f_b uuid; ptno text; fp uuid;
begin
  select task_no into tno from ops_prod.v_design_task where item_no = '26956-A-LR-01';
  r := ops_prod.release_design_revision(tno, 'A');
  assert ops_core.said_ok(r), 'released: ' || r::text;
  r := ops_prod.release_design_revision(tno, 'A');
  assert r->'error'->>'code' = 'already_released', 'once: ' || r::text;
  r := ops_core.attach_file('DRV_DSN_B', 'sofa-gk-b.pdf', 'application/pdf', 100, null, 'web', null, 'gambar_kerja',
                            'design_item', null, null, '26956-A-LR-01', 'tala');
  f_b := (r->'data'->>'attachment_id')::uuid;
  perform ops_core.attach_link(f_b, 'design_item', '26956-A-LR-01', 'Gambar Kerja');
  perform ops_prod.add_design_revision(tno, 'B', f_b, 'Dudukan 45');
  select to_jsonb(x) into v from ops_prod.v_design_task x where task_no = tno;
  assert v->>'status' = 'RILIS' and v->>'released_rev' = 'A' and v->>'latest_rev' = 'B'
     and (v->>'ahead_of_release')::boolean and (v->>'revision_count')::int = 2,
    'the floor still cuts from A: ' || v::text;
  assert (select string_agg(rev || ':' || filename, ',' order by uploaded_at) from ops_prod.v_design_revision where task_no = tno)
       = 'A:sofa-gk-a.pdf,B:sofa-gk-b.pdf', 'revisions name their files';

  -- a catalogue product with no project
  r := ops_prod.create_design_task('gambar_kerja', null, 'dsn-rak');
  assert ops_core.said_ok(r), 'product task: ' || r::text;
  ptno := r->'data'->>'task_no';
  select to_jsonb(x) into v from ops_prod.v_design_task x where task_no = ptno;
  assert v->>'product_name' = 'Rak dinding' and v->>'project_code' is null
     and (v->>'needed_by')::date = ops_core.office_day() + 5 and jsonb_array_length(v->'work_orders') = 1,
    'a product task is needed by its open work order: ' || v::text;
  assert (select count(*) from ops_prod.v_design_gap where product_code = 'DSN-RAK') = 1, 'one kind left as a gap';
  r := ops_core.attach_file('DRV_DSN_P', 'rak.pdf', 'application/pdf', 100, null, 'web', null, 'gambar_kerja',
                            'product', null, null, 'DSN-RAK', 'tala');
  fp := (r->'data'->>'attachment_id')::uuid;
  perform ops_core.attach_link(fp, 'product', 'DSN-RAK', 'Gambar Kerja');
  r := ops_prod.add_design_revision(ptno, 'A', fp, null, true);
  assert ops_core.said_ok(r) and (select status from ops_prod.v_design_task where task_no = ptno) = 'RILIS',
    'uploaded and released at once: ' || r::text;
end $$;

-- somebody with neither
set local request.jwt.claim.sub = 'aaaa0000-0000-0000-0000-0000000c4003';
do $$
declare r jsonb;
begin
  assert (select count(*) from ops_prod.v_design_task) = 0, 'outsider reads no tasks';
  assert (select count(*) from ops_prod.v_design_gap) = 0, 'nor gaps';
  r := ops_prod.create_design_task('gambar_kerja', '26956-A-LR-02');
  assert r->'error'->>'code' = 'not_permitted', 'outsider: ' || r::text;
  r := ops_prod.ask_design_question('dsn-x', 'klien', 'x');
  assert r->'error'->>'code' = 'not_permitted', 'outsider asks nothing: ' || r::text;
end $$;

rollback;
