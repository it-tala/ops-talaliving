-- inv — the asset register (0106, 0107): CCTV, PCs, vehicles and the rest.
--
--   rina  inventory write   — registers, edits, retires
--   tamu  inventory read    — reads only
--
--   REFUSALS     a read grant registering; no name; an unknown category,
--                supplier or ledger row; a new asset born disposed; disposing
--                with no note; deleting an asset with a document on it;
--                deleting a category in use; a bad category code
--   DERIVATIONS  the AST- tag; edits recorded field by field; a text field
--                cleared with ''; a date cleared by name; disposed dates the
--                end and back in use clears it; a document attaches to an
--                asset; categories saved, retired and deleted

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-000000009951','rina-as@talaliving.com','{"full_name":"Rina AS"}'),
  ('ffffffff-0000-0000-0000-000000009952','tamu-as@talaliving.com','{"full_name":"Tamu AS"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-000000009951','inventory','write'),
  ('ffffffff-0000-0000-0000-000000009952','inventory','read');

insert into ops_procure.vendors (id, code, name) values
  ('99510000-0000-0000-0000-000000000001','V-9951','Toko CCTV Jaya');
insert into ops_core.attachments (id, storage_path, filename, uploaded_by) values
  ('99510000-0000-0000-0000-0000000000f1','a/cam.jpg','cam-gate.jpg','ffffffff-0000-0000-0000-000000009951');

set local role authenticated;

set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000009952';
do $$
declare r jsonb;
begin
  r := ops_inv.create_asset('Camera gate', 'cctv');
  assert r -> 'error' ->> 'code' = 'not_permitted', 'read grant refused, got ' || r::text;
end $$;

set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000009951';

do $$
declare r jsonb; v_no text; v_pc text; a ops_inv.assets;
begin
  r := ops_inv.create_asset('  ', 'cctv');
  assert r -> 'error' ->> 'code' = 'name_required', 'no name, got ' || r::text;
  r := ops_inv.create_asset('Camera gate', 'nope');
  assert r -> 'error' ->> 'code' = 'category_unknown', 'bad category, got ' || r::text;
  r := ops_inv.create_asset('Camera gate', 'cctv', p_vendor_code => 'V-NOPE');
  assert r -> 'error' ->> 'code' = 'vendor_unknown', 'bad supplier, got ' || r::text;
  r := ops_inv.create_asset('Camera gate', 'cctv', p_trx_no => 'trx-nope');
  assert r -> 'error' ->> 'code' = 'trx_unknown', 'bad ledger row, got ' || r::text;
  r := ops_inv.create_asset('Camera gate', 'cctv', p_status => 'disposed');
  assert r -> 'error' ->> 'code' = 'status_invalid', 'born disposed, got ' || r::text;

  r := ops_inv.create_asset('Camera gate', 'cctv', 'Hikvision', 'DS-2CD1023', 'SN-778812',
                            'Workshop gate', 'Security', 'in_use', '2026-01-15', 850000, 'V-9951',
                            null, '2027-01-15', 'Night vision', 'k-cam');
  assert r ->> 'outcome' = 'ok', 'create, got ' || r::text;
  v_no := r -> 'data' ->> 'asset_no';
  assert v_no ~ '^AST-\d{4}$', 'AST- tag, got ' || v_no;

  r := ops_inv.create_asset('Camera gate', 'cctv', p_key => 'k-cam');
  assert r ->> 'outcome' = 'duplicate' and r -> 'data' ->> 'asset_no' = v_no, 'replay returns the first, got ' || r::text;

  r := ops_inv.create_asset('PC admin', 'computer', p_holder => 'Anggun');
  v_pc := r -> 'data' ->> 'asset_no';
  assert v_pc <> v_no, 'a second tag';

  -- Edit: move it, clear the model, clear the warranty date.
  r := ops_inv.update_asset(v_no, p_location => 'Office front door', p_model => '', p_clear => array['warranty_until']);
  assert r ->> 'outcome' = 'ok', 'update, got ' || r::text;
  select * into a from ops_inv.assets where asset_no = v_no;
  assert a.location = 'Office front door' and a.model is null and a.warranty_until is null
     and a.brand = 'Hikvision', 'fields written, got ' || row_to_json(a)::text;
  r := ops_inv.update_asset(v_no, p_location => 'Office front door');
  assert r ->> 'outcome' = 'noop', 'same value is a noop, got ' || r::text;

  -- Status: gone needs a note, and dates the end.
  r := ops_inv.set_asset_status(v_pc, 'disposed');
  assert r -> 'error' ->> 'code' = 'note_required', 'dispose needs a note, got ' || r::text;
  r := ops_inv.set_asset_status(v_pc, 'disposed', 'Sold to staff, motherboard dead');
  assert r ->> 'outcome' = 'ok' and (select ended_on from ops_inv.assets where asset_no = v_pc) = current_date,
    'disposed with an end date, got ' || r::text;
  r := ops_inv.set_asset_status(v_pc, 'in_storage');
  assert r ->> 'outcome' = 'ok' and (select ended_on from ops_inv.assets where asset_no = v_pc) is null,
    'back from disposed clears the end, got ' || r::text;

  -- Documents attach to an asset.
  r := ops_core.attach_link('99510000-0000-0000-0000-0000000000f1', 'asset', v_no, 'Foto');
  assert r ->> 'outcome' = 'ok', 'photo on the asset, got ' || r::text;
  r := ops_inv.delete_asset(v_no);
  assert r -> 'error' ->> 'code' = 'asset_has_documents', 'documented asset is kept, got ' || r::text;
  r := ops_inv.delete_asset(v_pc);
  assert r ->> 'outcome' = 'ok', 'a mistaken entry deletes, got ' || r::text;

  -- Categories.
  r := ops_inv.save_asset_category('AC', 'Air conditioners');
  assert r -> 'error' ->> 'code' is null and r ->> 'outcome' = 'ok', 'category created (lower-cased), got ' || r::text;
  assert exists (select 1 from ops_inv.asset_categories where code = 'ac'), 'code lower-cased';
  r := ops_inv.save_asset_category('a', 'x');
  assert r -> 'error' ->> 'code' = 'code_invalid', 'bad code, got ' || r::text;
  r := ops_inv.save_asset_category('ac', 'Air conditioners', 'Split units', false);
  assert r ->> 'outcome' = 'ok' and not (select is_active from ops_inv.asset_categories where code = 'ac'),
    'retired, got ' || r::text;
  r := ops_inv.delete_asset_category('cctv');
  assert r -> 'error' ->> 'code' = 'category_in_use', 'in use, got ' || r::text;
  r := ops_inv.delete_asset_category('ac');
  assert r ->> 'outcome' = 'ok', 'unused deletes, got ' || r::text;
end $$;

-- The view, read by the inventory user.
do $$
declare v record;
begin
  select * into v from ops_inv.v_asset where name = 'Camera gate';
  assert v.category_name = 'CCTV & security' and v.document_count = 1 and not v.warranty_expired,
    'view reads, got ' || row_to_json(v)::text;
end $$;

reset role;

do $$
declare d jsonb;
begin
  select detail into d from ops_core.audit_log
   where entity = 'asset' and action = 'update' and outcome = 'ok'
   order by at desc, id desc limit 1;
  assert d ? 'location' and d -> 'location' ->> 'to' = 'Office front door' and d ? 'model',
    'only the changed fields, from/to, got ' || d::text;
  assert not (d ? 'brand'), 'unchanged fields left out';
end $$;

rollback;
