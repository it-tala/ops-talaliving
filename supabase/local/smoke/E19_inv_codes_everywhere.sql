-- inv — the one code where people look, and at registration (0294, D451).
--
--   reads: v_asset and v_stock_item carry the code, family and sentence
--   create_asset: a picked family numbers the code and uppercases the name;
--     none picked, the category's default family, the name as typed
--   register_item: the sentence goes with the item's code
--   describe_record: an asset's or item's sentence written later; the same
--     again is a noop
--   labels: label_rows carries the code and finds by it and by the 2013
--     code; the public card shows it
--   REFUSALS  an unknown or reserved family; describe without permission,
--             of an unknown kind, of a record that does not exist

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-0000000e1901','coder-e19@talaliving.com','{"full_name":"Coder E19"}'),
  ('ffffffff-0000-0000-0000-0000000e1902','reader-e19@talaliving.com','{"full_name":"Reader E19"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-0000000e1901','inventory','write'),
  ('ffffffff-0000-0000-0000-0000000e1902','inventory','read');
insert into ops_core.attachments (id, storage_path, filename, uploaded_by)
values ('55550000-0000-0000-0000-0000000e1901', 'a/e19.jpg', 'e19.jpg', 'ffffffff-0000-0000-0000-0000000e1901');
insert into ops_inv.stocked_categories (category_code) values ('sanding-sandpaper') on conflict do nothing;
insert into ops_inv.assets (asset_no, name, category_code, legacy_code) values ('AST-E190', 'SAW, PANEL', 'machine', 'S2-90');

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-0000000e1901';

do $$
declare r jsonb; v_no text; v_item text; v_fam text; v_token text;
begin
  -- a family picked: its code, the name uppercase, the sentence kept
  r := ops_inv.create_asset('saw, radial arm (large)', 'machine',
         p_family_code => 'S2', p_description => '  Cuts long boards across the grain.  ');
  assert r->>'outcome' = 'ok', 'create with a family: ' || r::text;
  v_no := r->'data'->>'asset_no';
  assert r->'data'->>'code' ~ '^S2-\d{2}$', 'the code is a saw''s: ' || r::text;
  assert (select name from ops_inv.assets where asset_no = v_no) = 'SAW, RADIAL ARM (LARGE)', 'the 2013 uppercase';
  assert (select code = r->'data'->>'code' and family_code = 'S2' and family_label = 'Saw'
                 and description = 'Cuts long boards across the grain.'
            from ops_inv.v_asset where asset_no = v_no), 'v_asset carries code, family and sentence';

  -- none picked: the category's default, the name as typed
  r := ops_inv.create_asset('PC accounting E19', 'computer');
  assert r->>'outcome' = 'ok', r::text;
  select code into v_fam from ops_inv.code_families where category_default and asset_category_code = 'computer';
  assert r->'data'->>'code' like v_fam || '-%', 'the category default numbers it';
  assert (select name from ops_inv.assets where asset_no = r->'data'->>'asset_no') = 'PC accounting E19', 'name as typed';

  r := ops_inv.create_asset('X', 'machine', p_family_code => 'C3');
  assert r->'error'->>'code' = 'family_unknown', 'a reserved family: ' || r::text;
  r := ops_inv.create_asset('X', 'machine', p_family_code => 'ZZ9');
  assert r->'error'->>'code' = 'family_unknown', 'an unknown family';

  -- register_item: the sentence goes with the code
  r := ops_inv.register_item('Sandpaper E19 #400', null, 'sanding-sandpaper', 'pcs',
         array['55550000-0000-0000-0000-0000000e1901']::uuid[], p_description => 'Fine paper for the last pass before lacquer.');
  assert r->>'outcome' = 'ok', 'register_item: ' || r::text;
  v_item := r->'data'->>'code';
  assert r->'data'->>'display_code' ~ '^S\d-\d{3}$', 'the item''s code comes back: ' || r::text;
  assert (select code = r->'data'->>'display_code' and description = 'Fine paper for the last pass before lacquer.'
            from ops_inv.v_stock_item where item_code = v_item), 'v_stock_item carries code and sentence';

  -- describe_record
  r := ops_inv.describe_record('asset', 'AST-E190', 'Rips sheets of plywood to width.');
  assert r->>'outcome' = 'ok', r::text;
  assert (select description from ops_inv.assets where asset_no = 'AST-E190') = 'Rips sheets of plywood to width.', 'asset described';
  r := ops_inv.describe_record('asset', 'AST-E190', 'Rips sheets of plywood to width.');
  assert r->>'outcome' = 'noop', 'the same sentence again: ' || r::text;
  r := ops_inv.describe_record('item', v_item, 'Grit 400 sanding sheet.');
  assert r->>'outcome' = 'ok' and (select description from ops_inv.item_codes where item_code = v_item) = 'Grit 400 sanding sheet.', 'item described';
  r := ops_inv.describe_record('product', 'P-1', 'x');
  assert r->'error'->>'code' = 'unknown_kind', 'a product is not described here';
  r := ops_inv.describe_record('asset', 'AST-NONE', 'x');
  assert (r->>'status')::int = 404, 'no such asset';

  -- labels: the code printed, found by it and by the 2013 code
  r := ops_inv.label_sources('asset', null, array['AST-E190'], null);
  assert r->'data'->0->>'display_code' = (select code from ops_inv.assets where asset_no = 'AST-E190'), 'label carries the code: ' || r::text;
  assert r->'data'->0->>'description' = 'Rips sheets of plywood to width.', 'and the sentence';
  v_token := r->'data'->0->>'token';
  r := ops_inv.label_sources('asset', null, null, 'S2-90');
  assert exists (select 1 from jsonb_array_elements(r->'data') e where e->>'code' = 'AST-E190'), 'found by its 2013 code';
  r := ops_inv.label_sources('item', null, null, (select code from ops_inv.item_codes where item_code = v_item));
  assert exists (select 1 from jsonb_array_elements(r->'data') e where e->>'code' = v_item), 'an item found by its code';
  r := ops_inv.label_card(v_token);
  assert r->'data'->>'display_code' is not null, 'the public card shows the code: ' || r::text;
end $$;

set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-0000000e1902';
do $$
declare r jsonb;
begin
  r := ops_inv.describe_record('asset', 'AST-E190', 'Something else.');
  assert r->>'outcome' = 'refused', 'a reader cannot describe: ' || r::text;
end $$;

rollback;
