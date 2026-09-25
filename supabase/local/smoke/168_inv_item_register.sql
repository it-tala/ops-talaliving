-- inv — an item registered at the rack: floor name, 1–4 photos, opening count (0168).
--
-- REFUSALS     no photo; five photos; a category nobody stocks; a read-level
--              user; a counted quantity without adjust permission; the exact
--              name already in the catalogue; a fifth photo through the
--              generic evidence road; taking the last photo off
-- DERIVATIONS  the item, its photos and its opening count land together;
--              v_stock_item carries the floor name and photo count; a sixth
--              attempt after removing one fits again; item_purchases opens to
--              an inventory reader

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-000000002501','reader@talaliving.com','{"full_name":"Pembaca"}'),
  ('ffffffff-0000-0000-0000-000000002502','putri@talaliving.com','{"full_name":"Putri"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-000000002501','inventory','read'),
  ('ffffffff-0000-0000-0000-000000002502','inventory','write');

-- Categories and photos are set up as the connecting role: nobody writes
-- `stocked_categories` from a screen, and the upload route is not SQL.
insert into ops_procure.item_categories (code, name) values
  ('sanding-uji','Amplas (uji)'), ('service-uji','Jasa (uji)')
  on conflict (code) do nothing;
insert into ops_inv.stocked_categories (category_code) values ('sanding-uji') on conflict do nothing;
insert into ops_core.attachments (id, storage_path, filename, uploaded_by)
select ('55550000-0000-0000-0000-00000000250' || n)::uuid, 'a/foto' || n || '.jpg', 'foto' || n || '.jpg',
       'ffffffff-0000-0000-0000-000000002502'
  from generate_series(1, 7) n;

set local role authenticated;

/* ── REFUSALS as a reader ─────────────────────────────────────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000002501';
do $$
declare r jsonb;
begin
  r := ops_inv.register_item('Sandpaper 240','Amplas 240','sanding-uji','pcs',
         array['55550000-0000-0000-0000-000000002501'::uuid]);
  assert r->>'outcome' = 'refused', 'a reader cannot register, got ' || r::text;
end $$;

/* ── REFUSALS and the happy path as a writer ──────────────────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000002502';
do $$
declare r jsonb;
begin
  r := ops_inv.register_item('Sandpaper 240','Amplas 240','sanding-uji','pcs', array[]::uuid[]);
  assert r->'error'->>'code' = 'photo_required', 'no photo, got ' || r::text;

  r := ops_inv.register_item('Sandpaper 240','Amplas 240','sanding-uji','pcs',
         array['55550000-0000-0000-0000-000000002501','55550000-0000-0000-0000-000000002502',
               '55550000-0000-0000-0000-000000002503','55550000-0000-0000-0000-000000002504',
               '55550000-0000-0000-0000-000000002505']::uuid[]);
  assert r->'error'->>'code' = 'too_many_photos', 'five photos, got ' || r::text;

  r := ops_inv.register_item('Sandpaper 240','Amplas 240','service-uji','pcs',
         array['55550000-0000-0000-0000-000000002501'::uuid]);
  assert r->'error'->>'code' = 'not_stocked', 'unstocked category, got ' || r::text;

  r := ops_inv.register_item('Sandpaper 240','Amplas 240','sanding-uji','pcs',
         array['55550000-0000-0000-0000-000000002501'::uuid], 'NOWHERE', 10);
  assert r->'error'->>'code' = 'location_required', 'count with no real rack, got ' || r::text;

  -- the happy path: three photos and a count of 40 on the main rack
  r := ops_inv.register_item('Sandpaper 240','Amplas 240','sanding-uji','pcs',
         array['55550000-0000-0000-0000-000000002501','55550000-0000-0000-0000-000000002502',
               '55550000-0000-0000-0000-000000002503']::uuid[], 'GUDANG', 40, null, 'uji-key-1');
  assert r->>'outcome' = 'ok', 'register, got ' || r::text;
  perform set_config('uji.code', r->'data'->>'code', true);

  -- a replay with the same key is the same answer, not a second item
  r := ops_inv.register_item('Sandpaper 240','Amplas 240','sanding-uji','pcs',
         array['55550000-0000-0000-0000-000000002501'::uuid], 'GUDANG', 40, null, 'uji-key-1');
  assert r->'data'->>'code' = current_setting('uji.code'), 'idempotent replay, got ' || r::text;

  -- the same name again, without the key, is refused and named
  r := ops_inv.register_item('sandpaper 240', null,'sanding-uji','pcs',
         array['55550000-0000-0000-0000-000000002504'::uuid]);
  assert r->'error'->>'code' = 'already_catalogued', 'exact duplicate, got ' || r::text;
end $$;

do $$
declare v record; v_code text := current_setting('uji.code');
begin
  select * into v from ops_inv.v_stock_item where item_code = v_code;
  assert v.item_name_local = 'Amplas 240', 'floor name on the rack view';
  assert v.photo_count = 3,               'three photos, got ' || v.photo_count;
  assert v.on_hand = 40,                  'counted 40, got ' || v.on_hand;
  assert (select kind from ops_inv.stock_moves where item_code = v_code) = 'adjust',
    'the opening count is an opname adjustment (D171)';
end $$;

/* ── the cap, through the generic evidence road ───────────────────────────── */
do $$
declare v_code text := current_setting('uji.code'); r jsonb; lnk uuid;
begin
  r := ops_core.attach_link('55550000-0000-0000-0000-000000002504', 'item', v_code, 'Foto');
  assert r->>'outcome' = 'ok', 'fourth photo fits, got ' || r::text;
  begin
    perform ops_core.attach_link('55550000-0000-0000-0000-000000002505', 'item', v_code, 'Foto');
    raise exception 'a fifth photo should be refused';
  exception when check_violation then null;
  end;

  -- remove one, and a new one fits again
  select id into lnk from ops_core.attachment_links
   where entity = 'item' and entity_no = v_code and kind = 'foto' and unlinked_at is null
   order by linked_at limit 1;
  r := ops_core.attach_unlink(lnk);
  assert r->>'outcome' = 'ok', 'unlink one of four, got ' || r::text;
  r := ops_core.attach_link('55550000-0000-0000-0000-000000002505', 'item', v_code, 'Foto');
  assert r->>'outcome' = 'ok', 'back to four, got ' || r::text;
end $$;

/* ── the floor: the last photo cannot come off ───────────────────────────── */
do $$
declare r jsonb; code2 text; lnk uuid;
begin
  r := ops_inv.register_item('Wood glue','Lem kayu','sanding-uji','pcs',
         array['55550000-0000-0000-0000-000000002506'::uuid]);
  code2 := r->'data'->>'code';
  select id into lnk from ops_core.attachment_links
   where entity = 'item' and entity_no = code2 and kind = 'foto' and unlinked_at is null;
  begin
    perform ops_core.attach_unlink(lnk);
    raise exception 'the only photo should not come off';
  exception when check_violation then null;
  end;
end $$;

/* ── a count without adjust permission is refused, not half-written ──────── */
reset role;
update ops_core.permission_catalog set admin_only = true
 where module = 'inventory' and action = 'adjust';
set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000002502';
do $$
declare r jsonb;
begin
  r := ops_inv.register_item('Hinge 3 inch','Engsel 3 inci','sanding-uji','pcs',
         array['55550000-0000-0000-0000-000000002507'::uuid], 'GUDANG', 5);
  assert r->>'outcome' = 'refused', 'count without adjust, got ' || r::text;
  assert not exists (select 1 from ops_procure.items where name = 'Hinge 3 inch'),
    'a refused registration writes no item';
end $$;

/* ── the floor name on an existing item, and purchases for inventory ─────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000002501';
do $$
declare r jsonb;
begin
  r := ops_inv.set_item_local_name(current_setting('uji.code'), 'Amplas');
  assert r->>'outcome' = 'refused', 'a reader cannot rename, got ' || r::text;
  r := ops_procure.item_purchases(current_setting('uji.code'));
  assert r->>'outcome' = 'ok', 'an inventory reader sees the purchases, got ' || r::text;
end $$;

reset role;
rollback;
