-- inv — the fuller category tree, and one location list for material stock,
-- finished goods and assets (0197, D346, D347).
--
-- REFUSALS     an asset placed somewhere not on the list; a new type under a
--              counted group is not left off the rack
-- DERIVATIONS  the tree is filled in and every type under a counted group is
--              counted; services and the holding pen stay off the rack; an
--              item registered at the rack keeps the catalogue's own number
--              (the location-category code was cancelled, D347) and needs no
--              location unless counted; stock moves, finished goods and assets
--              all point at the same list; an asset given a location's name
--              stores its code; the label prints that location's name

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-000000019701','gudang-197@talaliving.com','{"full_name":"Gudang 197"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-000000019701','inventory','write');
insert into ops_core.attachments (id, storage_path, filename, uploaded_by)
select ('19700000-0000-0000-0000-00000000000' || n)::uuid, 'a/f' || n || '.jpg', 'f' || n || '.jpg',
       'ffffffff-0000-0000-0000-000000019701'
  from generate_series(1, 3) n;
insert into ops_inv.stock_locations (code, name) values ('RAK-A1','Rak A1');

/* ── the tree ─────────────────────────────────────────────────────────────── */
do $$
begin
  assert (select count(*) from ops_procure.item_categories where parent_code is not null) >= 45,
    'the tree is filled in, got ' || (select count(*) from ops_procure.item_categories where parent_code is not null);
  assert not exists (
    select 1 from ops_procure.item_categories c
     where c.parent_code in (select category_code from ops_inv.stocked_categories)
       and c.code not in (select category_code from ops_inv.stocked_categories)),
    'every type under a counted group is counted';
  assert exists (select 1 from ops_procure.item_categories where code = 'sanding-sheets' and parent_code = 'sanding'),
    'a seeded type under its group';
  assert (select count(*) from ops_procure.item_categories where parent_code is null and code in ('safety','maintenance')) = 2,
    'the two new groups';
  assert not exists (select 1 from ops_inv.stocked_categories where category_code in ('service','uncurated')),
    'services and the holding pen stay off the rack';
end $$;

/* ── one list: stock moves, finished goods and assets point at it ─────────── */
do $$
declare t text;
begin
  foreach t in array array['stock_moves','product_moves','assets'] loop
    assert exists (
      select 1 from pg_constraint k
        join pg_class c on c.oid = k.conrelid
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'ops_inv' and c.relname = t and k.contype = 'f'
         and k.confrelid = 'ops_inv.stock_locations'::regclass),
      format('ops_inv.%s references stock_locations', t);
  end loop;
end $$;

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000019701';

/* ── registering keeps the catalogue's number (D347) ───────────────────────── */
do $$
declare r jsonb;
begin
  r := ops_inv.register_item('Sandpaper 400 (197)', 'Amplas 400', 'sanding-sheets', 'pcs',
         array['19700000-0000-0000-0000-000000000001'::uuid]);
  assert r->>'outcome' = 'ok', 'a seeded type registers without a location, got ' || r::text;
  assert r->'data'->>'code' ~ '^I-[0-9]{5}$', 'the catalogue''s own number, got ' || (r->'data'->>'code');
  assert (select count(*) from ops_inv.v_stock_item where item_code = r->'data'->>'code') = 1,
    'on the rack view under its seeded type';
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
