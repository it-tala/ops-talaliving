-- procure × hr — a design room or item given out from Design as an HRD task
-- that closes itself when every box is filled (0249, 0250, S2, D402, D403).
--
-- DERIVATIONS  a room task is an ops_hr.tasks row with ref_kind design_room,
--              titled with the room and its item count, and the drafter gets
--              the bell; giving the same room again with another date moves
--              the open task rather than making a second; the Design screen
--              and HRD read filled / total; filling the last box closes it,
--              signed and with a delivered note — by a spec, by *not needed*,
--              by dropping the room's last empty item, and by a BOM revision
--              on the item's product
-- REFUSALS     a scope nobody knows; a room or item that is not there; a
--              drafter who is not an active employee; a due date before today;
--              a room with no items; a room already complete; closing a design
--              task by hand, by the drafter or by HRD; somebody with neither
--              sales nor production access (and they read nothing)

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('aaaa0000-0000-0000-0000-0000000c8001','koordinator-c8@talaliving.com','{"full_name":"Koordinator C8"}'),
  ('aaaa0000-0000-0000-0000-0000000c8002','drafter-c8@talaliving.com','{"full_name":"Made C8"}'),
  ('aaaa0000-0000-0000-0000-0000000c8003','hrd-c8@talaliving.com','{"full_name":"Wulan C8"}'),
  ('aaaa0000-0000-0000-0000-0000000c8004','gudang-c8@talaliving.com','{"full_name":"Gudang C8"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('aaaa0000-0000-0000-0000-0000000c8001','production','write'),
  ('aaaa0000-0000-0000-0000-0000000c8002','production','write'),
  ('aaaa0000-0000-0000-0000-0000000c8003','hrd','write'),
  ('aaaa0000-0000-0000-0000-0000000c8004','inventory','write');
insert into ops_hr.employees (id, employee_no, full_name, position, unit, pay_basis, base_rate,
                              allowance_rate, daily_hours, joined_on, user_id)
values ('c8000000-0000-0000-0000-0000000000e1','K-0981','Made C8','Drafter','Kantor',
        'monthly', 5000000, 0, 8, '2026-01-01','aaaa0000-0000-0000-0000-0000000c8002');

insert into ops_procure.clients (id, code, name) values
  ('c8000000-0000-0000-0000-0000000000c1','CL-0981','PT Contoh Tugas');
insert into ops_procure.projects (id, code, name, client_id) values
  ('c8000000-0000-0000-0000-0000000000d1','26981','Villa Tugas','c8000000-0000-0000-0000-0000000000c1');

set local role authenticated;
set local request.jwt.claim.sub = 'aaaa0000-0000-0000-0000-0000000c8001';

do $$
declare r jsonb; v_task text; t ops_hr.tasks; k text;
begin
  perform ops_procure.save_design_collection('26981', 'A', 'Type 2BR');
  perform ops_procure.save_design_room('26981', 'A', 'LR', 'Living room');
  perform ops_procure.save_design_room('26981', 'A', 'BR', 'Bedroom');
  perform ops_procure.save_design_room('26981', 'A', 'KT', 'Kitchen');
  perform ops_procure.save_design_room('26981', 'A', 'EM', 'Empty');
  perform ops_procure.save_design_item('26981', 'A', 'LR', 'Sofa', 1, 'tala');
  perform ops_procure.save_design_item('26981', 'A', 'LR', 'Meja', 1, 'tala');

  -- refusals
  r := ops_procure.assign_design_task('lantai', '26981-A-LR', 'K-0981', ops_core.office_day() + 5);
  assert r->'error'->>'code' = 'unknown_scope', 'a known scope: ' || r::text;
  r := ops_procure.assign_design_task('room', '26981-A-ZZ', 'K-0981', ops_core.office_day() + 5);
  assert r->'error'->>'code' = 'not_found', 'no such room: ' || r::text;
  r := ops_procure.assign_design_task('room', '26981-A-LR', 'K-9999', ops_core.office_day() + 5);
  assert r->'error'->>'code' = 'assignee_unknown', 'an active employee: ' || r::text;
  r := ops_procure.assign_design_task('room', '26981-A-LR', 'K-0981', ops_core.office_day() - 1);
  assert r->'error'->>'code' = 'due_in_past', 'not yesterday: ' || r::text;
  r := ops_procure.assign_design_task('room', '26981-A-EM', 'K-0981', ops_core.office_day() + 5);
  assert r->'error'->>'code' = 'nothing_to_do', 'an empty room: ' || r::text;

  -- the room, to Made
  r := ops_procure.assign_design_task('room', '26981-a-lr', 'K-0981', ops_core.office_day() + 5, 'Mulai dari sofa');
  assert ops_core.said_ok(r) and (r->'data'->>'total')::int = 12, 'assigned: ' || r::text;
  v_task := r->'data'->>'task_no';
  -- The coordinator gave it, but does not read HRD's table (RLS): it reads
  -- the design's own view of it.
  assert (select count(*) from ops_hr.tasks) = 0, 'a drafter coordinator does not read ops_hr.tasks';

  -- the same room again: the open task moves, no second one
  r := ops_procure.assign_design_task('room', '26981-A-LR', 'K-0981', ops_core.office_day() + 5);
  assert r->>'outcome' = 'noop', 'same person, same date: ' || r::text;
  r := ops_procure.assign_design_task('room', '26981-A-LR', 'K-0981', ops_core.office_day() + 7);
  assert ops_core.said_ok(r) and r->'data'->>'task_no' = v_task, 'moved: ' || r::text;
  assert (select count(*) from ops_procure.design_assignments('26981') where ref_no = '26981-A-LR') = 1, 'still one task';

  assert (select filled || '/' || total || '/' || assignee_name from ops_procure.design_assignments('26981')
           where ref_no = '26981-A-LR') = '0/12/Made C8', 'the Design screen reads it';
end $$;

-- the row in HRD's table, as HRD's table holds it
reset role;
do $$
declare t ops_hr.tasks := (select x from ops_hr.tasks x where ref_no = '26981-A-LR');
begin
  assert t.ref_kind = 'design_room' and t.status = 'OPEN' and t.due_date = ops_core.office_day() + 7
     and t.title = 'Desain 26981-A-LR Living room — 2 item' and t.detail = 'Mulai dari sofa'
     and t.assigned_by = 'aaaa0000-0000-0000-0000-0000000c8001',
    'an HRD task for the room: ' || to_jsonb(t)::text;
  assert exists (select 1 from ops_core.notifications n
                  where n.user_id = 'aaaa0000-0000-0000-0000-0000000c8002' and n.entity_no = t.task_no),
    'the drafter got the bell';
end $$;
set local role authenticated;

-- the drafter sees its progress, and cannot close it by hand
set local request.jwt.claim.sub = 'aaaa0000-0000-0000-0000-0000000c8002';
do $$
declare v_task text := (select task_no from ops_procure.design_assignments('26981') where ref_no = '26981-A-LR');
begin
  assert (select filled || '/' || total from ops_hr.design_task_progress() where task_no = v_task) = '0/12',
    'the drafter reads the progress';
  begin
    perform ops_hr.update_task(v_task, 'done', null, 'Sudah', null);
    assert false, 'a design task closed by hand';
  exception when check_violation then
    assert sqlerrm like 'Tugas desain selesai sendiri%', 'the reason is said: ' || sqlerrm;
  end;
end $$;

-- HRD monitors, and cannot close it either
set local request.jwt.claim.sub = 'aaaa0000-0000-0000-0000-0000000c8003';
do $$
declare v_task text := (select task_no from ops_hr.tasks where ref_no = '26981-A-LR');
begin
  assert (select filled || '/' || total from ops_hr.design_task_progress() where task_no = v_task) = '0/12',
    'HRD reads the progress';
  begin
    perform ops_hr.update_task(v_task, 'done', null, 'Sudah', null);
    assert false, 'HRD closed a design task by hand';
  exception when check_violation then null;
  end;
end $$;

-- filling the boxes closes it: the last one is a spec
set local request.jwt.claim.sub = 'aaaa0000-0000-0000-0000-0000000c8002';
do $$
declare k text; t ops_hr.tasks; r jsonb;
begin
  foreach k in array array['pdf','dwg','render','foto','bom'] loop
    perform ops_procure.set_design_box_skip('26981-A-LR-01', k, true);
    perform ops_procure.set_design_box_skip('26981-A-LR-02', k, true);
  end loop;
  perform ops_procure.save_design_spec('26981-A-LR-01', 'Mahoni');
  select * into t from ops_hr.tasks where ref_no = '26981-A-LR';
  assert t.status = 'OPEN', 'eleven of twelve is still open';
  perform ops_procure.save_design_spec('26981-A-LR-02', 'Jati');
  select * into t from ops_hr.tasks where ref_no = '26981-A-LR';
  assert t.status = 'DONE' and t.done_by = 'aaaa0000-0000-0000-0000-0000000c8002'
     and t.delivered_note like 'Semua kotak terisi (12/12)%', 'closed by the last box: ' || to_jsonb(t)::text;
  -- a new version afterwards does not reopen it (D403)
  perform ops_procure.save_design_spec('26981-A-LR-02', 'Jati, finishing natural');
  assert (select status from ops_hr.tasks where ref_no = '26981-A-LR') = 'DONE', 'not reopened';
end $$;

set local request.jwt.claim.sub = 'aaaa0000-0000-0000-0000-0000000c8001';
do $$
declare r jsonb; k text;
begin
  r := ops_procure.assign_design_task('room', '26981-A-LR', 'K-0981', ops_core.office_day() + 3);
  assert r->'error'->>'code' = 'already_complete', 'a complete room: ' || r::text;

  -- dropping the room's last empty item closes the room
  perform ops_procure.save_design_item('26981', 'A', 'BR', 'Ranjang', 1, 'tala');
  perform ops_procure.save_design_item('26981', 'A', 'BR', 'Nakas', 2, 'tala');
  foreach k in array array['pdf','dwg','render','foto','spec','bom'] loop
    perform ops_procure.set_design_box_skip('26981-A-BR-01', k, true);
  end loop;
  r := ops_procure.assign_design_task('room', '26981-A-BR', 'K-0981', ops_core.office_day() + 3);
  assert ops_core.said_ok(r), 'bedroom: ' || r::text;
  perform ops_procure.set_design_item_dropped('26981-A-BR-02', true, 'Klien pakai nakas lama');
  assert (select status from ops_procure.design_assignments('26981') where ref_no = '26981-A-BR') = 'DONE',
    'dropping the empty item completes the room';

  -- an item's own task, closed by its BOM
  perform ops_procure.save_design_item('26981', 'A', 'KT', 'Kabinet', 1, 'tala');
  foreach k in array array['pdf','dwg','render','foto','spec'] loop
    perform ops_procure.set_design_box_skip('26981-A-KT-01', k, true);
  end loop;
  r := ops_procure.product_from_design_item('26981-A-KT-01');
  assert ops_core.said_ok(r), 'product: ' || r::text;
  r := ops_procure.assign_design_task('item', '26981-A-KT-01', 'K-0981', ops_core.office_day() + 2);
  assert ops_core.said_ok(r) and (r->'data'->>'filled')::int = 5, 'item task: ' || r::text;
  assert (select scope || '/' || item_no from ops_procure.design_assignments('26981') where ref_no = '26981-A-KT-01')
       = 'item/26981-A-KT-01', 'an item task';
end $$;

reset role;
insert into ops_prod.bom_revisions (product_id, rev)
  select id, 1 from ops_prod.products where product_code = '26981-A-KT-01';
do $$
begin
  assert (select status from ops_hr.tasks where ref_no = '26981-A-KT-01') = 'DONE', 'the BOM closes the item task';
end $$;
set local role authenticated;

-- somebody with neither
set local request.jwt.claim.sub = 'aaaa0000-0000-0000-0000-0000000c8004';
do $$
declare r jsonb;
begin
  r := ops_procure.assign_design_task('room', '26981-A-KT', 'K-0981', ops_core.office_day() + 2);
  assert r->'error'->>'code' = 'not_permitted', 'outsider: ' || r::text;
  assert (select count(*) from ops_procure.design_assignments()) = 0, 'outsider reads no task';
  assert (select count(*) from ops_hr.design_task_progress()) = 0, 'and no progress';
end $$;

rollback;
