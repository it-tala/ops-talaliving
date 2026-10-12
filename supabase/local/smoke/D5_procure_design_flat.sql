-- procure — a design is collection → item: the collection's one room, the
-- client's own item code, and removing an item typed by mistake (0262, D419).
--
-- DERIVATIONS  a new collection comes with its room (code 00, named after it)
--              and renaming the collection renames the room; an item saved
--              with no room goes into it and is numbered
--              <project>-<collection>-NN; a client's item carries the code
--              typed for it, which names its Drive folder (no room level) and
--              can be corrected; an item with nothing on it is removed
-- REFUSALS     a client's item with no code; a code another item in the
--              project already has (in any case); removing an item that has a
--              file, an approval or a quotation line, naming what it has; an
--              outsider removing

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('aaaa0000-0000-0000-0000-0000000d4001','mkt-flat@talaliving.com','{"full_name":"Rina Flat"}'),
  ('aaaa0000-0000-0000-0000-0000000d4003','gudang-flat@talaliving.com','{"full_name":"Gudang"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('aaaa0000-0000-0000-0000-0000000d4001','marketing','write'),
  ('aaaa0000-0000-0000-0000-0000000d4003','inventory','write');

insert into ops_procure.clients (id, code, name) values
  ('d4000000-0000-0000-0000-0000000000c1','CL-0954','Living Contoh');
insert into ops_procure.projects (id, code, name, client_id) values
  ('d4000000-0000-0000-0000-0000000000d1','26954','Mindi Contoh','d4000000-0000-0000-0000-0000000000c1'),
  ('d4000000-0000-0000-0000-0000000000d2','26955','Mindi Lagi','d4000000-0000-0000-0000-0000000000c1');

update ops_core.drive_folders set folder_id = coalesce(folder_id, 'OPS_' || slug) where slug = 'drafting';

set local role authenticated;
set local request.jwt.claim.sub = 'aaaa0000-0000-0000-0000-0000000d4001';

do $$
declare r jsonb; v jsonb; v_file text;
begin
  r := ops_procure.save_design_collection('26954', 'LV232', 'LEXI');
  assert ops_core.said_ok(r), 'collection: ' || r::text;
  assert (select count(*) from ops_procure.v_design_room where project_code = '26954' and code = '00' and name = 'LEXI') = 1,
    'a collection comes with its one room';
  r := ops_procure.save_design_collection('26954', 'LV232', 'LEXI COLLECTION');
  assert (select name from ops_procure.v_design_room where project_code = '26954' and code = '00') = 'LEXI COLLECTION',
    'renaming the collection renames its room';

  -- a client's item: the client's code, never one we make up
  r := ops_procure.save_design_item('26954', 'LV232', null, 'Queen Bed', 1, 'client', 2130, 1600, 1170);
  assert r->'error'->>'code' = 'client_code_required', 'a client''s item needs its code: ' || r::text;
  r := ops_procure.save_design_item('26954', 'LV232', null, 'Queen Bed', 1, 'client', 2130, 1600, 1170,
                                    p_client_item_code => 'LV232-B01');
  assert ops_core.said_ok(r) and r->'data'->>'item_no' = '26954-LV232-01', 'numbered in the collection: ' || r::text;
  r := ops_procure.save_design_item('26954', 'LV232', '', 'King Bed', 1, 'client', p_client_item_code => 'lv232-b01');
  assert r->'error'->>'code' = 'client_code_taken', 'one code, one item, in any case: ' || r::text;
  r := ops_procure.save_design_item('26954', 'LV232', '', 'King Bed', 1, 'client', p_client_item_code => 'LV232-B2');
  assert r->'data'->>'item_no' = '26954-LV232-02', 'second: ' || r::text;
  r := ops_procure.save_design_item('26954', 'LV232', '', 'King Bed', 2, 'client', 2130, 1900, 1170,
                                    null, '26954-LV232-02', 'LV232-B02');
  assert ops_core.said_ok(r), 'a typo corrected: ' || r::text;
  r := ops_procure.save_design_item('26954', 'LV232', '', 'Sofa', 1, 'tala');
  assert r->'data'->>'item_no' = '26954-LV232-03', 'ours needs no client code: ' || r::text;

  -- the same code in another project is another item
  r := ops_procure.save_design_collection('26955', 'LV232', 'LEXI');
  r := ops_procure.save_design_item('26955', 'LV232', null, 'Queen Bed', 1, 'client', p_client_item_code => 'LV232-B01');
  assert ops_core.said_ok(r), 'a repeat order uses the client''s code again: ' || r::text;

  select to_jsonb(x) into v from ops_procure.v_design_item x where item_no = '26954-LV232-02';
  assert v->>'client_item_code' = 'LV232-B02' and (v->>'qty')::numeric = 2 and v->>'room_code' = '00', 'read back: ' || v::text;

  assert ops_core.drive_path_for_record('gambar_klien', 'design_item', '26954-LV232-01')
       = 'CL-0954 LIVING CONTOH/26954 MINDI CONTOH/KOLEKSI LV232 LEXI COLLECTION/LV232-B01 QUEEN BED',
    'folder by the client''s code, no room, got ' || ops_core.drive_path_for_record('gambar_klien', 'design_item', '26954-LV232-01');

  -- removing what was typed by mistake
  r := ops_core.attach_file('DRV_LV232', 'queen.pdf', 'application/pdf', 100, null, 'web', null, 'gambar_klien', 'design_item',
                            null, null, '26954-LV232-01', 'client');
  v_file := r->'data'->>'attachment_id';
  r := ops_core.attach_link(v_file::uuid, 'design_item', '26954-LV232-01', 'Client Drawing');
  assert ops_core.said_ok(r), 'a file on the item: ' || r::text;
  r := ops_procure.remove_design_item('26954-LV232-01');
  assert r->'error'->>'code' = 'item_in_use' and r->'error'->>'message' like '%file%', 'an item with a file stays: ' || r::text;
  r := ops_procure.record_design_approval('26954-LV232-03', 'approved', ops_core.office_day(), 'whatsapp', 'David');
  assert ops_core.said_ok(r), 'approved: ' || r::text;
  r := ops_procure.remove_design_item('26954-LV232-03');
  assert r->'error'->>'code' = 'item_in_use' and r->'error'->>'message' like '%persetujuan%', 'an approved item stays: ' || r::text;
  r := ops_procure.remove_design_item('26954-LV232-02');
  assert ops_core.said_ok(r), 'removed: ' || r::text;
  assert not exists (select 1 from ops_procure.design_items where item_no = '26954-LV232-02'), 'gone';
  r := ops_procure.remove_design_item('26954-LV232-02');
  assert r->'error'->>'code' = 'not_found', 'twice: ' || r::text;
  r := ops_procure.save_design_item('26954', 'LV232', null, 'King Bed', 1, 'client', p_client_item_code => 'LV232-B02');
  assert r->'data'->>'item_no' = '26954-LV232-04', 'its code is free again (the number is not reused): ' || r::text;
end $$;

set local request.jwt.claim.sub = 'aaaa0000-0000-0000-0000-0000000d4003';
do $$
declare r jsonb;
begin
  r := ops_procure.remove_design_item('26954-LV232-02');
  assert r->'error'->>'code' = 'not_permitted', 'outsider: ' || r::text;
end $$;

rollback;
