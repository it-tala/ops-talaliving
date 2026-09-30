-- inv — item codes LOC-CAT-NNNN, the fuller category tree, an asset's location
-- picked from the list (0197, D346).
--
-- REFUSALS     registering without a location; with an inactive one; an
--              asset placed somewhere not on the list; the counter table is
--              not writable from the browser
-- DERIVATIONS  every category and location has a short code, including ones
--              added without one; every type under a counted group is counted;
--              the number runs per location and type; the item's home rack is
--              the location it was registered at; an asset given a location's
--              name stores its code; the label prints that location's name

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-000000019701','gudang-197@talaliving.com','{"full_name":"Gudang 197"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-000000019701','inventory','write');
insert into ops_core.attachments (id, storage_path, filename, uploaded_by)
select ('19700000-0000-0000-0000-00000000000' || n)::uuid, 'a/f' || n || '.jpg', 'f' || n || '.jpg',
       'ffffffff-0000-0000-0000-000000019701'
  from generate_series(1, 6) n;

/* ── the tree and the short codes ─────────────────────────────────────────── */
do $$
begin
  assert not exists (select 1 from ops_procure.item_categories where abbr is null),
    'every category has a short code';
  assert not exists (select 1 from ops_inv.stock_locations where abbr is null),
    'every location has a short code';
  assert (select count(*) from ops_procure.item_categories where parent_code is not null) >= 45,
    'the tree is filled in, got ' || (select count(*) from ops_procure.item_categories where parent_code is not null);
  assert not exists (
    select 1 from ops_procure.item_categories c
     where c.parent_code in (select category_code from ops_inv.stocked_categories)
       and c.code not in (select category_code from ops_inv.stocked_categories)),
    'every type under a counted group is counted';
  assert (select abbr from ops_procure.item_categories where code = 'sanding-sheets') = 'AMS', 'seeded abbr';
  assert (select abbr from ops_inv.stock_locations where code = 'GUDANG') = 'GDG', 'seeded location abbr';
  assert not exists (select 1 from ops_procure.item_categories where code in ('service','uncurated')
                        and code in (select category_code from ops_inv.stocked_categories)),
    'services and the holding pen stay off the rack';
end $$;

-- Rows added without a short code get one: the screen's category and
-- location writes do not know the column exists.
insert into ops_procure.item_categories (code, parent_code, name) values ('sanding-uji-197', 'sanding', 'Scotch pads');
insert into ops_inv.stock_locations (code, name) values ('RAK-A1','Rak A1'), ('RAK-A2','Rak A2'), ('LAMA-197','Rak lama');
update ops_inv.stock_locations set is_active = false where code = 'LAMA-197';
insert into ops_inv.stocked_categories (category_code) values ('sanding-uji-197');

do $$
begin
  assert (select abbr from ops_procure.item_categories where code = 'sanding-uji-197') = 'SCO',
    'from the name, got ' || coalesce((select abbr from ops_procure.item_categories where code = 'sanding-uji-197'), 'null');
  assert (select abbr from ops_inv.stock_locations where code = 'RAK-A1') = 'RAK', 'RAK-A1 → RAK';
  assert (select abbr from ops_inv.stock_locations where code = 'RAK-A2') = 'RKA2',
    'RAK-A2 keeps its number, got ' || (select abbr from ops_inv.stock_locations where code = 'RAK-A2');
end $$;

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000019701';

/* ── REFUSALS ─────────────────────────────────────────────────────────────── */
do $$
declare r jsonb;
begin
  r := ops_inv.register_item('Sandpaper 400 (197)', 'Amplas 400', 'sanding-sheets', 'pcs',
         array['19700000-0000-0000-0000-000000000001'::uuid]);
  assert r->'error'->>'code' = 'location_required', 'no location, got ' || r::text;
  r := ops_inv.register_item('Sandpaper 400 (197)', 'Amplas 400', 'sanding-sheets', 'pcs',
         array['19700000-0000-0000-0000-000000000001'::uuid], 'LAMA-197');
  assert r->'error'->>'code' = 'location_required', 'inactive location, got ' || r::text;
  assert not exists (select 1 from ops_procure.items where name = 'Sandpaper 400 (197)'), 'nothing written';

  begin
    insert into ops_inv.item_code_counters values ('GDG', 'AMS', 900);
    raise exception 'the counter should not be writable from the browser';
  exception when insufficient_privilege then null;
  end;
end $$;

/* ── DERIVATIONS: the number per location and type ────────────────────────── */
do $$
declare r jsonb; c1 text; c2 text; c3 text;
begin
  r := ops_inv.register_item('Sandpaper 400 (197)', 'Amplas 400', 'sanding-sheets', 'pcs',
         array['19700000-0000-0000-0000-000000000001'::uuid], 'GUDANG');
  assert r->>'outcome' = 'ok', 'register, got ' || r::text;
  c1 := r->'data'->>'code';
  r := ops_inv.register_item('Sandpaper 600 (197)', 'Amplas 600', 'sanding-sheets', 'pcs',
         array['19700000-0000-0000-0000-000000000002'::uuid], 'GUDANG', 25);
  c2 := r->'data'->>'code';
  r := ops_inv.register_item('Sandpaper 800 (197)', null, 'sanding-sheets', 'pcs',
         array['19700000-0000-0000-0000-000000000003'::uuid], 'RAK-A2');
  c3 := r->'data'->>'code';

  assert c1 ~ '^GDG-AMS-[0-9]{4}$', 'LOC-CAT-NNNN, got ' || c1;
  assert right(c2, 4)::int = right(c1, 4)::int + 1, format('next in the series: %s then %s', c1, c2);
  assert c3 = 'RKA2-AMS-0001', 'another rack, its own series, got ' || c3;

  assert (select home_location from ops_inv.stock_settings where item_code = c1) = 'GUDANG', 'home rack, uncounted';
  assert (select home_location from ops_inv.stock_settings where item_code = c2) = 'GUDANG', 'home rack, counted';
  assert (select on_hand from ops_inv.v_stock_item where item_code = c2) = 25, 'counted at the rack';
  assert (select on_hand from ops_inv.v_stock_item where item_code = c1) = 0, 'uncounted is zero, not missing';

  -- a twin is named before the rack is asked for
  r := ops_inv.register_item('sandpaper 400 (197)', null, 'sanding-sheets', 'pcs',
         array['19700000-0000-0000-0000-000000000004'::uuid]);
  assert r->'error'->>'code' = 'already_catalogued', 'twin, got ' || r::text;
end $$;

/* ── an asset's location ──────────────────────────────────────────────────── */
do $$
declare r jsonb; v_no text;
begin
  r := ops_inv.create_asset('Kamera gudang (197)', 'cctv', p_location => 'rak a1');
  assert r->>'outcome' = 'ok', 'asset by location name, got ' || r::text;
  v_no := r->'data'->>'asset_no';
  assert (select location from ops_inv.assets where asset_no = v_no) = 'RAK-A1', 'name stored as its code';

  r := ops_inv.update_asset(v_no, p_location => 'GUDANG');
  assert (select location from ops_inv.assets where asset_no = v_no) = 'GUDANG', 'moved by code';

  begin
    r := ops_inv.update_asset(v_no, p_location => 'Di bawah meja');
    raise exception 'an unknown place should be refused';
  exception when check_violation then null;
  end;
  assert (select location from ops_inv.assets where asset_no = v_no) = 'GUDANG', 'unchanged after the refusal';

  assert (select l->>'name' from jsonb_array_elements(ops_inv.label_sources('asset', null, array[v_no], null) -> 'data' -> 0 -> 'locations') l)
         = 'Gudang utama', 'the label prints the location''s name';
end $$;

rollback;
