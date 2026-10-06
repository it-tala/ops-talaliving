-- procure — a project's design: collections, rooms, items, their files and
-- the client's approval (0221, 0222, P4, D378, D379).
--
-- DERIVATIONS  marketing and the drafters build the design; items are
--              numbered <project>-<collection>-<room>-NN inside their room and
--              keep the number when corrected; status reads CONCEPT → DRAWN
--              (a render on the item) → APPROVED (the latest approval) and back
--              when the approval is withdrawn, DROPPED when taken out; an
--              item's files go to <client>/<project>/<collection>/<room>/<item>
--              in DRAFTING and a collection's to its 00 KOLEKSI folder; the
--              collection counts its items and approvals
-- REFUSALS     a code that is not a short code; an item with no name or qty
--              or a size of zero; an origin nobody knows; approving a file
--              that is not on the item; an approval dated tomorrow or with
--              nobody on the client's side; dropping without a reason;
--              somebody with neither sales nor production access (and they
--              read nothing)

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('aaaa0000-0000-0000-0000-0000000c1001','mkt-design@talaliving.com','{"full_name":"Rina Design"}'),
  ('aaaa0000-0000-0000-0000-0000000c1002','drafter-design@talaliving.com','{"full_name":"Ayu Drafter"}'),
  ('aaaa0000-0000-0000-0000-0000000c1003','gudang-design@talaliving.com','{"full_name":"Gudang"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('aaaa0000-0000-0000-0000-0000000c1001','marketing','write'),
  ('aaaa0000-0000-0000-0000-0000000c1002','production','write'),
  ('aaaa0000-0000-0000-0000-0000000c1003','inventory','write');

insert into ops_procure.clients (id, code, name) values
  ('c1000000-0000-0000-0000-0000000000c1','CL-0951','PT Contoh Design');
insert into ops_procure.projects (id, code, name, client_id) values
  ('c1000000-0000-0000-0000-0000000000d1','26951','Residence Design','c1000000-0000-0000-0000-0000000000c1');

update ops_core.drive_folders set folder_id = coalesce(folder_id, 'OPS_' || slug) where slug = 'drafting';

set local role authenticated;
set local request.jwt.claim.sub = 'aaaa0000-0000-0000-0000-0000000c1001';

do $$
declare r jsonb; v jsonb; v_render text; v_other text; v_proof text;
begin
  -- the tree
  r := ops_procure.save_design_collection('26951', 'a/b', 'Type 2BR');
  assert r->'error'->>'code' = 'bad_code', 'a collection code is a short code: ' || r::text;
  r := ops_procure.save_design_collection('26951', 'a', 'Type 2BR');
  assert ops_core.said_ok(r), 'collection: ' || r::text;
  r := ops_procure.save_design_collection('26951', 'A', 'Type 2BR · 24 unit');
  assert ops_core.said_ok(r) and r->>'action' is distinct from 'create', 'the same code renames: ' || r::text;
  r := ops_procure.save_design_room('26951', 'A', 'lr', 'Living room');
  assert ops_core.said_ok(r), 'room: ' || r::text;
  r := ops_procure.save_design_room('26951', 'Z', 'LR', 'Living room');
  assert r->'error'->>'code' = 'not_found', 'no such collection: ' || r::text;

  -- items, numbered in their room
  r := ops_procure.save_design_item('26951', 'A', 'LR', '', 1, 'tala');
  assert r->'error'->>'code' = 'name_required', 'an item has a name: ' || r::text;
  r := ops_procure.save_design_item('26951', 'A', 'LR', 'Sofa', 0, 'tala');
  assert r->'error'->>'code' = 'qty_required', 'an item has a quantity: ' || r::text;
  r := ops_procure.save_design_item('26951', 'A', 'LR', 'Sofa', 24, 'ours');
  assert r->'error'->>'code' = 'unknown_origin', 'a known origin: ' || r::text;
  r := ops_procure.save_design_item('26951', 'A', 'LR', 'Sofa', 24, 'tala', 0, 900, 780);
  assert r->'error'->>'code' = 'bad_size', 'a size is more than zero: ' || r::text;
  r := ops_procure.save_design_item('26951', 'A', 'LR', 'Sofa 3 seater', 24, 'tala', 2100, 900, 780);
  assert ops_core.said_ok(r) and r->'data'->>'item_no' = '26951-A-LR-01', 'first item: ' || r::text;
  r := ops_procure.save_design_item('26951', 'A', 'LR', 'Coffee table', 24, 'adapted');
  assert r->'data'->>'item_no' = '26951-A-LR-02', 'second item: ' || r::text;
  r := ops_procure.save_design_item('26951', 'A', 'LR', 'Coffee table 380', 24, 'adapted', 1100, 600, 380, null, '26951-A-LR-02');
  assert r->'data'->>'item_no' = '26951-A-LR-02', 'corrected, same number: ' || r::text;

  select to_jsonb(x) into v from ops_procure.v_design_item x where item_no = '26951-A-LR-01';
  assert v->>'status' = 'CONCEPT' and v->>'collection_name' = 'Type 2BR · 24 unit' and v->>'client_code' = 'CL-0951',
    'a new item is a concept: ' || v::text;

  -- its files, in its folder
  assert ops_core.drive_path_for_record('render', 'design_item', '26951-A-LR-01')
       = 'CL-0951 PT CONTOH DESIGN/26951 RESIDENCE DESIGN/KOLEKSI A TYPE 2BR · 24 UNIT/LIVING ROOM/26951-A-LR-01 SOFA 3 SEATER',
    'an item''s folder, got ' || ops_core.drive_path_for_record('render', 'design_item', '26951-A-LR-01');
  assert ops_core.drive_path_for_record('moodboard', 'design_collection', '26951-A')
       = 'CL-0951 PT CONTOH DESIGN/26951 RESIDENCE DESIGN/KOLEKSI A TYPE 2BR · 24 UNIT/00 KOLEKSI',
    'a collection''s folder, got ' || ops_core.drive_path_for_record('moodboard', 'design_collection', '26951-A');
  assert ops_core.drive_path_for_record('persetujuan_klien', 'design_item', 'nope') like 'TANPA KLIEN/TANPA PROYEK/TANPA KOLEKSI/%',
    'an item that is not there still lands somewhere';
  assert ops_core.drive_path_for_record('render', 'project', '26951') = 'CL-0951 PT CONTOH DESIGN/26951 RESIDENCE DESIGN/00 KONSEP',
    'a project''s render keeps its folder';

  r := ops_core.attach_file('DRV_RENDER', 'sofa-b.jpg', 'image/jpeg', 100, null, 'web', null, 'render', 'design_item',
                            null, null, '26951-A-LR-01', 'tala');
  v_render := r->'data'->>'attachment_id';
  r := ops_core.attach_link(v_render::uuid, 'design_item', '26951-A-LR-01', 'Render');
  assert ops_core.said_ok(r), 'render on the item: ' || r::text;
  r := ops_core.attach_file('DRV_OTHER', 'meja.jpg', 'image/jpeg', 100, null, 'web', null, 'render', 'design_item',
                            null, null, '26951-A-LR-02', 'tala');
  v_other := r->'data'->>'attachment_id';
  perform ops_core.attach_link(v_other::uuid, 'design_item', '26951-A-LR-02', 'Render');
  r := ops_core.attach_file('DRV_PROOF', 'wa.png', 'image/png', 100, null, 'web', null, 'persetujuan_klien', 'design_item',
                            null, null, '26951-A-LR-01', 'client');
  v_proof := r->'data'->>'attachment_id';
  assert (select drive_slug from ops_core.attachments where id = v_proof::uuid) = 'drafting', 'an approval is filed in DRAFTING';

  select to_jsonb(x) into v from ops_procure.v_design_item x where item_no = '26951-A-LR-01';
  assert v->>'status' = 'DRAWN' and (v->>'design_files')::int = 1, 'a render makes it drawn: ' || v::text;

  -- the client's approval (D378)
  r := ops_procure.record_design_approval('26951-A-LR-01', 'approved', ops_core.office_day(), 'whatsapp', 'Ibu Lina', v_other::uuid);
  assert r->'error'->>'code' = 'file_not_on_item', 'the approved file is this item''s: ' || r::text;
  r := ops_procure.record_design_approval('26951-A-LR-01', 'approved', ops_core.office_day() + 1, 'whatsapp', 'Ibu Lina');
  assert r->'error'->>'code' = 'bad_date', 'not tomorrow: ' || r::text;
  r := ops_procure.record_design_approval('26951-A-LR-01', 'approved', ops_core.office_day(), 'whatsapp', ' ');
  assert r->'error'->>'code' = 'client_person_required', 'somebody said yes: ' || r::text;
  r := ops_procure.record_design_approval('26951-A-LR-01', 'approved', ops_core.office_day(), 'pigeon', 'Ibu Lina');
  assert r->'error'->>'code' = 'unknown_channel', 'a known channel: ' || r::text;
  r := ops_procure.record_design_approval('26951-A-LR-01', 'approved', ops_core.office_day(), 'WhatsApp', 'Ibu Lina',
                                          v_render::uuid, v_proof::uuid, 'Render rev B');
  assert ops_core.said_ok(r), 'approved: ' || r::text;
  select to_jsonb(x) into v from ops_procure.v_design_item x where item_no = '26951-A-LR-01';
  assert v->>'status' = 'APPROVED' and v->>'approval_by' = 'Ibu Lina', 'approved reads: ' || v::text;
  assert (select attachment_filename || '/' || evidence_filename from ops_procure.v_design_approval
           where item_no = '26951-A-LR-01') = 'sofa-b.jpg/wa.png', 'the approval names its files';

  r := ops_procure.record_design_approval('26951-A-LR-01', 'withdrawn', ops_core.office_day(), 'meeting', 'Bp. Agus');
  assert ops_core.said_ok(r), 'withdrawn: ' || r::text;
  assert (select status from ops_procure.v_design_item where item_no = '26951-A-LR-01') = 'DRAWN', 'withdrawn is drawn again';
  assert (select count(*) from ops_procure.design_approvals) = 2, 'both decisions are kept';

  -- taken out, and back
  r := ops_procure.set_design_item_dropped('26951-A-LR-02', true);
  assert r->'error'->>'code' = 'reason_required', 'taken out says why: ' || r::text;
  r := ops_procure.set_design_item_dropped('26951-A-LR-02', true, 'Klien pakai meja lama');
  assert ops_core.said_ok(r), 'dropped: ' || r::text;
  assert (select status from ops_procure.v_design_item where item_no = '26951-A-LR-02') = 'DROPPED', 'dropped reads';
  select to_jsonb(x) into v from ops_procure.v_design_collection x where project_code = '26951' and code = 'A';
  assert (v->>'item_count')::int = 1 and (v->>'room_count')::int = 1 and (v->>'approved_count')::int = 0,
    'the collection counts what is in it: ' || v::text;
  r := ops_procure.set_design_item_dropped('26951-A-LR-02', false);
  assert ops_core.said_ok(r) and (select status from ops_procure.v_design_item where item_no = '26951-A-LR-02') = 'DRAWN',
    'restored: ' || r::text;
end $$;

-- the drafters build it too
set local request.jwt.claim.sub = 'aaaa0000-0000-0000-0000-0000000c1002';
do $$
declare r jsonb;
begin
  r := ops_procure.save_design_room('26951', 'A', 'MB', 'Master bedroom');
  assert ops_core.said_ok(r), 'a drafter adds a room: ' || r::text;
  r := ops_procure.save_design_item('26951', 'A', 'MB', 'Bed 160', 24, 'client');
  assert r->'data'->>'item_no' = '26951-A-MB-01', 'and an item: ' || r::text;
  assert (select count(*) from ops_procure.v_design_item where project_code = '26951') = 3, 'and reads the design';
end $$;

-- somebody with neither
set local request.jwt.claim.sub = 'aaaa0000-0000-0000-0000-0000000c1003';
do $$
declare r jsonb;
begin
  r := ops_procure.save_design_item('26951', 'A', 'LR', 'Diam-diam', 1, 'tala');
  assert r->'error'->>'code' = 'not_permitted', 'outsider: ' || r::text;
  r := ops_procure.record_design_approval('26951-A-LR-01', 'approved', ops_core.office_day(), 'whatsapp', 'X');
  assert r->'error'->>'code' = 'not_permitted', 'outsider approval: ' || r::text;
  assert (select count(*) from ops_procure.v_design_item) = 0, 'outsider reads no design';
end $$;

rollback;
