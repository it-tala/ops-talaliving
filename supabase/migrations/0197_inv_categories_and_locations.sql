-- 0197_inv_categories_and_locations.sql — a fuller category tree, and one
-- location list for everything inventory keeps.
--
-- The owner (2026-09-30): *generate items category lebih lengkap dan rinci,
-- lalu pastikan bisa tampil sebagai dropdown ketika masuk inventory baru.
-- lokasi di inventory masih free text - buat dropdown yang terhubung* (D346),
-- and then: *daftar lokasi berlaku general untuk aset, stok material dan
-- bahan, dan produk jadi, perabotan, mesin, dsb* (D347). The item code that
-- named its location and category was built and then **cancelled** by the
-- owner — a wrong pick at registration would have been a wrong code for ever
-- — so item codes stay the catalogue's own `I-00001` series (0112/0168) and
-- `register_item` is unchanged.
--
--   1. **The tree, two levels deep and filled in** (D169's rule unchanged: the
--      parent is what a report groups by, the child is what a storeman looks
--      for, the item is the third level). Every seeded type sits under a
--      category that is counted, so *Register an item* offers it. The seed is
--      additive and idempotent: a code that already exists keeps its name and
--      parent, and a type whose name already exists under the same parent is
--      not inserted twice — production grew its own types through the screen
--      (`production-metal-stock` is one of them, 0178).
--   2. **One location list** (`ops_inv.stock_locations`) for material stock,
--      finished goods (0170 already references it) and assets — furniture,
--      machines, vehicles. `assets.location` was the last free text in
--      inventory; it now references the list. Every distinct place already
--      typed becomes a location of its own (or matches one by code or name),
--      so nothing typed is lost. A trigger accepts a code or a location's name
--      and stores the code, so the asset seams (0107/0116) keep their
--      signatures and John Lau's drafts keep working; an unknown place is
--      refused with the way to add it.

-- ── 1. the tree ─────────────────────────────────────────────────────────────
drop table if exists pg_temp.seed_categories;
create temp table seed_categories (code text, parent_code text, name text, ord int);
insert into seed_categories (code, parent_code, name, ord) values
  -- the groups (0006, plus two the floor buys for and nobody counted)
  ('production',  null, 'Production', 1),
  ('sanding',     null, 'Sanding', 2),
  ('finishing',   null, 'Finishing', 3),
  ('packing',     null, 'Packing', 4),
  ('machining',   null, 'Machining', 5),
  ('office',      null, 'Office', 6),
  ('safety',      null, 'Safety & PPE', 7),
  ('maintenance', null, 'Building & electrical', 8),
  ('service',     null, 'Services', 9),
  ('uncurated',   null, 'Not yet curated', 10),
  -- Production: what a piece is made from and what holds it together
  ('raw-wood',                    'production', 'Timber & panels', 11),
  ('production-veneer-edging',    'production', 'Veneer & edge banding', 12),
  ('production-metal-stock',      'production', 'Metal stock', 13),
  ('production-rattan-weaving',   'production', 'Rattan, rope & weaving', 14),
  ('production-upholstery',       'production', 'Upholstery: foam, fabric & leather', 15),
  ('production-glass-stone',      'production', 'Glass, mirror & stone', 16),
  ('production-glue-adhesives',   'production', 'Glue & adhesives', 17),
  ('production-dowels-joinery',   'production', 'Dowels, biscuits & joinery', 18),
  ('hardware',                    'production', 'Hardware', 19),
  ('production-hinges-slides',    'production', 'Hinges, slides & mechanisms', 20),
  ('production-handles-knobs',    'production', 'Handles & knobs', 21),
  ('production-fasteners',        'production', 'Screws, bolts & nails', 22),
  ('production-legs-fittings',    'production', 'Legs, glides & fittings', 23),
  -- Sanding
  ('sanding-sheets',              'sanding',    'Sandpaper sheets', 31),
  ('sanding-rolls',               'sanding',    'Sandpaper rolls', 32),
  ('sanding-discs-belts',         'sanding',    'Sanding discs & belts', 33),
  ('sanding-pads-sponges',        'sanding',    'Sanding pads, sponges & steel wool', 34),
  -- Finishing
  ('finishing-stain-colour',      'finishing',  'Stain & colourant', 41),
  ('finishing-sealer-primer',     'finishing',  'Sealer & primer', 42),
  ('finishing-top-coat',          'finishing',  'Top coat: lacquer, melamine, PU, duco', 43),
  ('finishing-oil-wax',           'finishing',  'Oil & wax', 44),
  ('finishing-thinner-solvent',   'finishing',  'Thinner & solvent', 45),
  ('finishing-filler-putty',      'finishing',  'Wood filler & putty', 46),
  ('finishing-spray-supplies',    'finishing',  'Spray & masking supplies', 47),
  -- Packing
  ('packing-cartons',             'packing',    'Cartons & boxes', 51),
  ('packing-wrap-film',           'packing',    'Bubble wrap & stretch film', 52),
  ('packing-foam-protectors',     'packing',    'Foam, styrofoam & corner guards', 53),
  ('packing-tape-strapping',      'packing',    'Tape & strapping', 54),
  ('packing-pallets-crates',      'packing',    'Pallets & crates', 55),
  ('packing-bags-labels',         'packing',    'Plastic bags, dust covers & labels', 56),
  -- Machining
  ('machining-blades-bits',       'machining',  'Saw blades, bits & cutters', 61),
  ('machining-grinding-discs',    'machining',  'Grinding & cutting discs', 62),
  ('machining-spare-parts',       'machining',  'Machine spare parts', 63),
  ('machining-lubricants',        'machining',  'Oil, grease & lubricants', 64),
  ('machining-hand-tools',        'machining',  'Hand tools & small tools', 65),
  ('machining-compressed-air',    'machining',  'Compressor & air-tool parts', 66),
  -- Office
  ('office-stationery',           'office',     'Stationery', 71),
  ('office-printing',             'office',     'Paper, ink & toner', 72),
  ('office-pantry',               'office',     'Pantry & drinking water', 73),
  ('office-cleaning',             'office',     'Cleaning supplies', 74),
  -- Safety & PPE
  ('safety-respiratory',          'safety',     'Masks & respirators', 81),
  ('safety-gloves',               'safety',     'Gloves', 82),
  ('safety-eye-ear',              'safety',     'Eye & ear protection', 83),
  ('safety-workwear-first-aid',   'safety',     'Workwear, boots & first aid', 84),
  -- Building & electrical
  ('maintenance-electrical',      'maintenance','Electrical: cables, lamps & sockets', 91),
  ('maintenance-plumbing',        'maintenance','Plumbing', 92),
  ('maintenance-building',        'maintenance','Building materials', 93);

-- A code that already exists keeps its name and parent. Groups first, then types, so a type's parent is there when it lands.
insert into ops_procure.item_categories (code, parent_code, name)
select s.code, s.parent_code, s.name
  from seed_categories s
 where s.parent_code is null
   and not exists (select 1 from ops_procure.item_categories c where c.code = s.code)
   and not exists (select 1 from ops_procure.item_categories c
                    where c.parent_code is null and lower(c.name) = lower(s.name))
 order by s.ord;

insert into ops_procure.item_categories (code, parent_code, name)
select s.code, s.parent_code, s.name
  from seed_categories s
 where s.parent_code is not null
   and exists (select 1 from ops_procure.item_categories p where p.code = s.parent_code)
   and not exists (select 1 from ops_procure.item_categories c where c.code = s.code)
   and not exists (select 1 from ops_procure.item_categories c
                    where c.parent_code = s.parent_code and lower(c.name) = lower(s.name))
 order by s.ord;

-- The two new groups sit on a rack, and so does every type under a group
-- that does (0104's rule for a type made on the screen, applied to the seed).
insert into ops_inv.stocked_categories (category_code)
select c.code from ops_procure.item_categories c where c.code in ('safety','maintenance')
on conflict do nothing;
insert into ops_inv.stocked_categories (category_code)
select c.code from ops_procure.item_categories c
 where c.parent_code is not null
   and exists (select 1 from ops_inv.stocked_categories s where s.category_code = c.parent_code)
on conflict do nothing;

drop table seed_categories;

-- ── 2. an asset's location is a location ────────────────────────────────────
-- Every place already typed on an asset becomes a location, unless it already
-- is one by code or by name. The code is the text in capitals and dashes.
do $$
declare r record; v_code text; v_base text; n int;
begin
  for r in
    select distinct btrim(a.location) as place
      from ops_inv.assets a
     where nullif(btrim(a.location), '') is not null
       and not exists (select 1 from ops_inv.stock_locations l
                        where l.code = upper(btrim(a.location))
                           or lower(l.name) = lower(btrim(a.location)))
     order by 1
  loop
    v_base := left(trim(both '-' from regexp_replace(upper(r.place), '[^A-Z0-9]+', '-', 'g')), 24);
    if v_base = '' then v_base := 'LOKASI'; end if;
    v_code := v_base; n := 1;
    while exists (select 1 from ops_inv.stock_locations where code = v_code) loop
      n := n + 1; v_code := v_base || '-' || n;
    end loop;
    insert into ops_inv.stock_locations (code, name) values (v_code, r.place);
  end loop;
end $$;

update ops_inv.assets a set location = l.code
  from ops_inv.stock_locations l
 where nullif(btrim(a.location), '') is not null
   and a.location is distinct from l.code
   and (l.code = upper(btrim(a.location)) or lower(l.name) = lower(btrim(a.location)))
   and not exists (select 1 from ops_inv.stock_locations x where x.code = a.location);
update ops_inv.assets set location = null where location is not null and btrim(location) = '';

-- A code or a location's name in, the code stored. Anything else is refused
-- with the way to add it, so a typo never makes a new place.
create or replace function ops_inv.asset_location_resolve()
returns trigger
language plpgsql set search_path = ops_inv, pg_temp as $$
declare v_code text;
begin
  if tg_op = 'UPDATE' and new.location is not distinct from old.location then
    return new;
  end if;
  new.location := nullif(btrim(new.location), '');
  if new.location is null then return new; end if;
  select l.code into v_code from ops_inv.stock_locations l
   where l.code = upper(new.location) or lower(l.name) = lower(new.location)
   order by (l.code = upper(new.location)) desc, l.is_active desc
   limit 1;
  if v_code is null then
    raise exception using errcode = 'check_violation',
      message = format('Lokasi "%s" tidak ada di daftar lokasi. Tambahkan dulu di Inventory → Penyesuaian → Kelola lokasi.', new.location);
  end if;
  new.location := v_code;
  return new;
end $$;

drop trigger if exists asset_location_resolve on ops_inv.assets;
create trigger asset_location_resolve
  before insert or update of location on ops_inv.assets
  for each row execute function ops_inv.asset_location_resolve();

do $$ begin
  alter table ops_inv.assets add constraint assets_location_fk
    foreign key (location) references ops_inv.stock_locations(code);
exception when duplicate_object then null; end $$;

create index if not exists assets_location_idx on ops_inv.assets (location);

comment on column ops_inv.assets.location is
  'Where the asset is: a stock_locations code (0197). A location name is accepted and stored as its code.';

-- The label prints the location's name for an asset, as it does for an item.
-- 0179's body, with the asset's location joined to its name.
create or replace function ops_inv.label_rows(
  p_kind  text,
  p_since date   default null,
  p_codes text[] default null,
  p_q     text   default null)
returns jsonb
language plpgsql stable set search_path = ops_inv, ops_procure, ops_prod, ops_core, pg_temp as $$
declare v_rows jsonb; v_q text := nullif(btrim(p_q), '');
begin
  if p_kind = 'item' then
    select coalesce(jsonb_agg(r order by r.registered_at desc nulls last, r.code), '[]'::jsonb) into v_rows
      from (
        select 'item' as kind, i.code, i.name, i.name_local,
               c.name as category, i.base_uom as uom, i.created_at as registered_at,
               coalesce(
                 (select jsonb_agg(jsonb_build_object('code', b.location, 'name', b.location_name, 'qty', b.qty)
                                   order by b.qty desc, b.location)
                    from ops_inv.v_stock_by_location b
                   where b.item_code = i.code and b.qty > 0),
                 case when s.home_location is not null then
                   jsonb_build_array(jsonb_build_object('code', s.home_location,
                     'name', (select l.name from ops_inv.stock_locations l where l.code = s.home_location),
                     'qty', null)) end,
                 '[]'::jsonb) as locations,
               exists (select 1 from ops_inv.label_categories lc where lc.category_code = i.category_code) as labelled,
               jsonb_build_object('category_code', i.category_code) as extra
          from ops_procure.items i
          join ops_procure.item_categories c on c.code = i.category_code
          join ops_inv.stocked_categories sc on sc.category_code = i.category_code
          left join ops_inv.stock_settings s on s.item_code = i.code
         where i.merged_into is null and i.archived_at is null and i.kind = 'goods'
           and (p_since is null or i.created_at >= p_since)
           and (p_codes is null or i.code = any(p_codes))
           and (v_q is null or i.code ilike '%' || v_q || '%' or i.name ilike '%' || v_q || '%'
                or coalesce(i.name_local, '') ilike '%' || v_q || '%')
         order by i.created_at desc, i.code
         limit 500
      ) r;

  elsif p_kind = 'asset' then
    select coalesce(jsonb_agg(r order by r.registered_at desc nulls last, r.code), '[]'::jsonb) into v_rows
      from (
        select 'asset' as kind, a.asset_no as code, a.name, null::text as name_local,
               ac.name as category, null::text as uom, a.created_at as registered_at,
               case when a.location is not null
                 then jsonb_build_array(jsonb_build_object('code', a.location, 'name', coalesce(al.name, a.location), 'qty', null))
                 else '[]'::jsonb end as locations,
               true as labelled,
               jsonb_strip_nulls(jsonb_build_object(
                 'ownership', a.ownership, 'holder', a.holder, 'identifier', a.identifier,
                 'brand', a.brand, 'model', a.model, 'status', a.status,
                 'acquired_on', a.acquired_on, 'contract_end', a.contract_end)) as extra
          from ops_inv.assets a
          join ops_inv.asset_categories ac on ac.code = a.category_code
          left join ops_inv.stock_locations al on al.code = a.location
         where a.status::text not in ('disposed','lost','returned')
           and (p_since is null or a.created_at >= p_since)
           and (p_codes is null or a.asset_no = any(p_codes))
           and (v_q is null or a.asset_no ilike '%' || v_q || '%' or a.name ilike '%' || v_q || '%'
                or coalesce(a.identifier, '') ilike '%' || v_q || '%')
         order by a.created_at desc, a.asset_no
         limit 500
      ) r;

  elsif p_kind = 'product' then
    with led as (
      select l.product_code, l.location, sum(l.qty) as q
        from ops_inv.product_ledger(null) l
       group by 1, 2 having sum(l.qty) > 0
    )
    select coalesce(jsonb_agg(r order by r.registered_at desc nulls last, r.code), '[]'::jsonb) into v_rows
      from (
        select 'product' as kind, p.product_code as code, p.name, null::text as name_local,
               p.category, p.uom, p.created_at as registered_at,
               coalesce(
                 (select jsonb_agg(jsonb_build_object('code', led.location, 'name', sl.name, 'qty', led.q)
                                   order by led.q desc, led.location)
                    from led left join ops_inv.stock_locations sl on sl.code = led.location
                   where led.product_code = p.product_code),
                 '[]'::jsonb) as locations,
               true as labelled,
               jsonb_strip_nulls(jsonb_build_object(
                 'length_mm', p.length_mm, 'width_mm', p.width_mm, 'height_mm', p.height_mm,
                 'dimension_note', p.dimension_note)) as extra
          from ops_prod.products p
         where p.active
           and (p_since is null or p.created_at >= p_since)
           and (p_codes is null or p.product_code = any(p_codes))
           and (v_q is null or p.product_code ilike '%' || v_q || '%' or p.name ilike '%' || v_q || '%')
         order by p.created_at desc, p.product_code
         limit 500
      ) r;
  end if;

  return v_rows;
end $$;

revoke all on function ops_inv.label_rows(text, date, text[], text) from public;

comment on table ops_inv.stock_locations is
  'Every place inventory keeps something: racks for material stock, finished goods (0170) '
  'and assets (0197) — furniture, machines, vehicles. Addable/renameable/retireable by '
  'inventory.update (0157). No delete — is_active retires a place without breaking what '
  'was ever recorded there.';

analyze ops_procure.item_categories;
analyze ops_inv.stock_locations;
analyze ops_inv.stocked_categories;
analyze ops_inv.assets;
