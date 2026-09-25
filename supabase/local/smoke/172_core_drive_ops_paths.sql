-- core — every file in a task folder under the drive's OPS folder (0172, D313).
--
-- DERIVATIONS  an item photo goes to INVENTORY/ITEMS and a finished-goods
--              photo to INVENTORY/FINISHED GOODS — same kind, different record;
--              a receiving report to the owner's own RECEIVING REPORT; a kind
--              with no row goes to its own name; the drive does not move with
--              the path (a KTP is HRD whatever it is filed against)
-- REFUSALS     a record kind nobody has heard of; a path with an empty
--              segment; somebody who is not IT editing the paths

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('aaaa0000-0000-0000-0000-000000172001','it-paths@talaliving.com','{"full_name":"IT"}'),
  ('aaaa0000-0000-0000-0000-000000172002','proc-paths@talaliving.com','{"full_name":"Procurement"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('aaaa0000-0000-0000-0000-000000172001','it','admin'),
  ('aaaa0000-0000-0000-0000-000000172002','procurement','write');

set local role authenticated;
set local request.jwt.claim.sub = 'aaaa0000-0000-0000-0000-000000172002';

do $$
declare r jsonb;
begin
  r := ops_core.drive_folder_for('Foto', 'item');
  assert r->'data'->>'slug' = 'procurement' and r->'data'->>'path' = 'INVENTORY/ITEMS', 'item photo, got ' || r::text;
  r := ops_core.drive_folder_for('foto', 'product');
  assert r->'data'->>'path' = 'INVENTORY/FINISHED GOODS', 'finished goods photo, got ' || r::text;
  r := ops_core.drive_folder_for('foto');
  assert r->'data'->>'path' = 'FOTO', 'a photo of nothing in particular, got ' || r::text;
  r := ops_core.drive_folder_for('receiving_report', 'receipt');
  assert r->'data'->>'path' = 'RECEIVING REPORT', 'the owner''s example, got ' || r::text;
  r := ops_core.drive_folder_for('purchase_order');
  assert r->'data'->>'path' = 'PURCHASE ORDER', 'the kind''s own name, got ' || r::text;
  r := ops_core.drive_folder_for('ktp', 'item');
  assert r->'data'->>'slug' = 'hrd', 'the path never moves the drive, got ' || r::text;
  r := ops_core.drive_folder_for('foto', 'kapal');
  assert r->'error'->>'code' = 'unknown_entity', 'unknown record, got ' || r::text;

  begin
    insert into ops_core.drive_paths (kind, path) values ('invoice', 'X');
    raise exception 'procurement must not edit the folder map';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'aaaa0000-0000-0000-0000-000000172001';

do $$
begin
  insert into ops_core.drive_paths (kind, path) values ('invoice', 'TAGIHAN/VENDOR');
  assert (ops_core.drive_folder_for('invoice'))->'data'->>'path' = 'TAGIHAN/VENDOR', 'IT sets a path';
  begin
    insert into ops_core.drive_paths (kind, entity, path) values ('nota', 'receipt', 'NOTA//X');
    raise exception 'an empty segment must be refused';
  exception when check_violation then null;
  end;
  begin
    insert into ops_core.drive_paths (kind, path) values ('receiving_report', 'LAIN');
    raise exception 'a second catch-all for one kind must be refused';
  exception when unique_violation then null;
  end;
end $$;

rollback;
