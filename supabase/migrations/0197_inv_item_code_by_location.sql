-- 0197_inv_item_code_by_location.sql — a fuller category tree, a location
-- picked from the list everywhere in inventory, and an item code that says
-- where the item lives and what it is.
--
-- The owner (2026-09-30): *generate items category lebih lengkap dan rinci,
-- lalu pastikan bisa tampil sebagai dropdown ketika masuk inventory baru.
-- lokasi di inventory masih free text - buat dropdown yang terhubung. update
-- kode item untuk bisa mereferensikan lokasi - item kategory - nomor urut.*
-- (D346). Four pieces:
--
--   1. **A short code on every category and every location** (`abbr`, 2–4
--      capitals or digits, unique). The item code is built from them, and a
--      category's `code` (`production-metal-stock`) or a location's
--      (`FINISHING`) is too long for a sticker. A trigger fills it for a row
--      that arrives without one — `create_category` (0104), the location
--      panel (0157) and the smoke fixtures all insert without it — so no
--      existing write path has to learn about it.
--   2. **The tree, two levels deep and filled in** (D169's rule unchanged: the
--      parent is what a report groups by, the child is what a storeman looks
--      for, the item is the third level). Every seeded type sits under a
--      category that is counted, so it is offered by *Register an item*. The
--      seed is additive and idempotent: a code that already exists keeps its
--      name and parent, and a type whose name already exists under the same
--      parent is not inserted twice — production grew its own types through
--      the screen (`production-metal-stock` is one of them, 0178).
--   3. **An item registered at the rack is numbered `LOC-CAT-NNNN`** —
--      `GDG-AMS-0001` is the first sandpaper-sheet item registered in the main
--      warehouse. The number runs per location and type
--      (`ops_inv.item_code_counters`), so two storemen in two racks never
--      wait on each other's series. **The location is now required** when
--      registering: the code names it, and it becomes the item's home rack
--      (`stock_settings.home_location`), counted or not. The code is issued
--      once and never rewritten when the item later moves — it says where the
--      item was registered, the rack columns say where it is. Items already
--      in the catalogue (`I-00001` …) and items added from Procurement keep
--      their codes: they are referenced by code from stock moves, BOMs,
--      labels already printed and QR tokens, and Procurement has no location
--      to put in one.
--   4. **An asset's location is a location** — the last free-text location in
--      inventory. `assets.location` now references `stock_locations(code)`.
--      Every distinct text already typed becomes a location of its own (or
--      matches one by code or name), so nothing typed is lost. A trigger
--      accepts a code or a location's name and stores the code, so the asset
--      seams (0107/0116) keep their signatures and John Lau's drafts keep
--      working; an unknown place is refused with the way to add it.

-- ── 1. short codes ──────────────────────────────────────────────────────────
alter table ops_procure.item_categories add column if not exists abbr text;
alter table ops_inv.stock_locations     add column if not exists abbr text;

do $$ begin
  alter table ops_procure.item_categories add constraint item_category_abbr_shape
    check (abbr is null or abbr ~ '^[A-Z0-9]{2,4}$');
exception when duplicate_object then null; end $$;
do $$ begin
  alter table ops_inv.stock_locations add constraint stock_location_abbr_shape
    check (abbr is null or abbr ~ '^[A-Z0-9]{2,4}$');
exception when duplicate_object then null; end $$;

create unique index if not exists item_categories_abbr_key on ops_procure.item_categories (abbr);
create unique index if not exists stock_locations_abbr_key on ops_inv.stock_locations (abbr);

comment on column ops_procure.item_categories.abbr is
  'Short code (2–4 capitals/digits) used in item codes LOC-CAT-NNNN. Filled by a trigger when not given (0197).';
comment on column ops_inv.stock_locations.abbr is
  'Short code (2–4 capitals/digits) used in item codes LOC-CAT-NNNN. Filled by a trigger when not given (0197).';

-- The candidates for a short code, best first. Pure text work, no table: the
-- caller skips the ones already taken.
--   `RAK-A1`          → RAKA1 is 5 long → RAK, RKA1, RA2 …
--   `Sandpaper sheets`→ SAN, SS, SNDS …
create or replace function ops_core.abbr_candidates(p_text text)
returns setof text
language plpgsql immutable set search_path = pg_catalog, pg_temp as $$
declare
  v_all   text := upper(regexp_replace(coalesce(p_text, ''), '[^A-Za-z0-9]', '', 'g'));
  v_words text[] := array_remove(regexp_split_to_array(upper(coalesce(p_text, '')), '[^A-Za-z0-9]+'), '');
  v_init  text := '';
  v_cons  text;
  w       text;
  n       int;
begin
  if v_all = '' then v_all := 'X'; end if;
  if length(v_all) between 2 and 4 then return next v_all; end if;
  if length(v_all) > 4 then return next left(v_all, 3); end if;
  -- A rack numbered at the end (`RAK-A2`): keep the number, RKA2.
  if length(v_all) > 4 and v_all ~ '[0-9]$' then return next left(v_all, 1) || right(v_all, 3); end if;
  if coalesce(array_length(v_words, 1), 0) >= 2 then
    foreach w in array v_words[1:4] loop v_init := v_init || left(w, 1); end loop;
    if length(v_init) >= 2 then return next v_init; end if;
  end if;
  -- First letter and the consonants after it: GUDANG → GDN, BENGKEL → BNG.
  v_cons := left(v_all, 1) || regexp_replace(substr(v_all, 2), '[AEIOU]', '', 'g');
  if length(v_cons) >= 3 then return next left(v_cons, 3); end if;
  if length(v_all) > 4 then return next left(v_all, 1) || right(v_all, 3); end if;
  for n in 2..99 loop
    return next left(rpad(v_all, 2, 'X'), 2) || n::text;
  end loop;
end $$;

create or replace function ops_procure.category_abbr_fill()
returns trigger
language plpgsql set search_path = ops_procure, ops_core, pg_temp as $$
declare c text;
begin
  if new.abbr is not null then
    new.abbr := upper(btrim(new.abbr));
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtext('item-category-abbr'));
  for c in select * from ops_core.abbr_candidates(new.name) loop
    if not exists (select 1 from ops_procure.item_categories x where x.abbr = c and x.code <> new.code) then
      new.abbr := c;
      return new;
    end if;
  end loop;
  return new;
end $$;

drop trigger if exists category_abbr_fill on ops_procure.item_categories;
create trigger category_abbr_fill
  before insert or update of abbr on ops_procure.item_categories
  for each row execute function ops_procure.category_abbr_fill();

create or replace function ops_inv.location_abbr_fill()
returns trigger
language plpgsql set search_path = ops_inv, ops_core, pg_temp as $$
declare c text;
begin
  if new.abbr is not null then
    new.abbr := upper(btrim(new.abbr));
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtext('stock-location-abbr'));
  -- From the code first (it is already short and in capitals), then the name.
  for c in select * from ops_core.abbr_candidates(new.code)
           union all select * from ops_core.abbr_candidates(new.name) loop
    if not exists (select 1 from ops_inv.stock_locations x where x.abbr = c and x.code <> new.code) then
      new.abbr := c;
      return new;
    end if;
  end loop;
  return new;
end $$;

drop trigger if exists location_abbr_fill on ops_inv.stock_locations;
create trigger location_abbr_fill
  before insert or update of abbr on ops_inv.stock_locations
  for each row execute function ops_inv.location_abbr_fill();

-- The seeded locations get the short codes people would say.
update ops_inv.stock_locations l set abbr = x.abbr
  from (values ('GUDANG','GDG'), ('BENGKEL','BKL'), ('FINISHING','FNS'), ('WORKSHOP','WSP')) x(code, abbr)
 where l.code = x.code and l.abbr is null
   and not exists (select 1 from ops_inv.stock_locations y where y.abbr = x.abbr);

-- ── 2. the tree ─────────────────────────────────────────────────────────────
drop table if exists pg_temp.seed_categories;
create temp table seed_categories (code text, parent_code text, name text, abbr text, ord int);
insert into seed_categories (code, parent_code, name, abbr, ord) values
  -- the groups (0006, plus two the floor buys for and nobody counted)
  ('production',  null, 'Production',            'PRD', 1),
  ('sanding',     null, 'Sanding',               'AMP', 2),
  ('finishing',   null, 'Finishing',             'FIN', 3),
  ('packing',     null, 'Packing',               'PAK', 4),
  ('machining',   null, 'Machining',             'MSN', 5),
  ('office',      null, 'Office',                'KTR', 6),
  ('safety',      null, 'Safety & PPE',          'APD', 7),
  ('maintenance', null, 'Building & electrical', 'MNT', 8),
  ('service',     null, 'Services',              'JSA', 9),
  ('uncurated',   null, 'Not yet curated',       'UNC', 10),
  -- Production: what a piece is made from and what holds it together
  ('raw-wood',                    'production', 'Timber & panels',                     'KYU', 11),
  ('production-veneer-edging',    'production', 'Veneer & edge banding',               'VNR', 12),
  ('production-metal-stock',      'production', 'Metal stock',                         'MTL', 13),
  ('production-rattan-weaving',   'production', 'Rattan, rope & weaving',              'RTN', 14),
  ('production-upholstery',       'production', 'Upholstery: foam, fabric & leather',  'UPH', 15),
  ('production-glass-stone',      'production', 'Glass, mirror & stone',               'KCA', 16),
  ('production-glue-adhesives',   'production', 'Glue & adhesives',                    'LEM', 17),
  ('production-dowels-joinery',   'production', 'Dowels, biscuits & joinery',          'DWL', 18),
  ('hardware',                    'production', 'Hardware',                            'HDW', 19),
  ('production-hinges-slides',    'production', 'Hinges, slides & mechanisms',         'ENG', 20),
  ('production-handles-knobs',    'production', 'Handles & knobs',                     'HDL', 21),
  ('production-fasteners',        'production', 'Screws, bolts & nails',               'BAU', 22),
  ('production-legs-fittings',    'production', 'Legs, glides & fittings',             'FIT', 23),
  -- Sanding
  ('sanding-sheets',              'sanding',    'Sandpaper sheets',                    'AMS', 31),
  ('sanding-rolls',               'sanding',    'Sandpaper rolls',                     'AMR', 32),
  ('sanding-discs-belts',         'sanding',    'Sanding discs & belts',               'DSC', 33),
  ('sanding-pads-sponges',        'sanding',    'Sanding pads, sponges & steel wool',  'SPN', 34),
  -- Finishing
  ('finishing-stain-colour',      'finishing',  'Stain & colourant',                   'STN', 41),
  ('finishing-sealer-primer',     'finishing',  'Sealer & primer',                     'SLR', 42),
  ('finishing-top-coat',          'finishing',  'Top coat: lacquer, melamine, PU, duco','TOP', 43),
  ('finishing-oil-wax',           'finishing',  'Oil & wax',                           'OIL', 44),
  ('finishing-thinner-solvent',   'finishing',  'Thinner & solvent',                   'THN', 45),
  ('finishing-filler-putty',      'finishing',  'Wood filler & putty',                 'DMP', 46),
  ('finishing-spray-supplies',    'finishing',  'Spray & masking supplies',            'SPR', 47),
  -- Packing
  ('packing-cartons',             'packing',    'Cartons & boxes',                     'KRD', 51),
  ('packing-wrap-film',           'packing',    'Bubble wrap & stretch film',          'WRP', 52),
  ('packing-foam-protectors',     'packing',    'Foam, styrofoam & corner guards',     'FOM', 53),
  ('packing-tape-strapping',      'packing',    'Tape & strapping',                    'TAP', 54),
  ('packing-pallets-crates',      'packing',    'Pallets & crates',                    'PLT', 55),
  ('packing-bags-labels',         'packing',    'Plastic bags, dust covers & labels',  'PLS', 56),
  -- Machining
  ('machining-blades-bits',       'machining',  'Saw blades, bits & cutters',          'BLD', 61),
  ('machining-grinding-discs',    'machining',  'Grinding & cutting discs',            'GRD', 62),
  ('machining-spare-parts',       'machining',  'Machine spare parts',                 'SPT', 63),
  ('machining-lubricants',        'machining',  'Oil, grease & lubricants',            'LUB', 64),
  ('machining-hand-tools',        'machining',  'Hand tools & small tools',            'TLS', 65),
  ('machining-compressed-air',    'machining',  'Compressor & air-tool parts',         'ANG', 66),
  -- Office
  ('office-stationery',           'office',     'Stationery',                          'ATK', 71),
  ('office-printing',             'office',     'Paper, ink & toner',                  'PRN', 72),
  ('office-pantry',               'office',     'Pantry & drinking water',             'PTY', 73),
  ('office-cleaning',             'office',     'Cleaning supplies',                   'CLN', 74),
  -- Safety & PPE
  ('safety-respiratory',          'safety',     'Masks & respirators',                 'MSK', 81),
  ('safety-gloves',               'safety',     'Gloves',                              'GLV', 82),
  ('safety-eye-ear',              'safety',     'Eye & ear protection',                'EYE', 83),
  ('safety-workwear-first-aid',   'safety',     'Workwear, boots & first aid',         'SFT', 84),
  -- Building & electrical
  ('maintenance-electrical',      'maintenance','Electrical: cables, lamps & sockets', 'LST', 91),
  ('maintenance-plumbing',        'maintenance','Plumbing',                            'PIP', 92),
  ('maintenance-building',        'maintenance','Building materials',                  'BGN', 93);

-- A code that already exists keeps its name and parent; it only gets its
-- short code, when that short code is still free.
update ops_procure.item_categories c set abbr = s.abbr
  from seed_categories s
 where c.code = s.code and c.abbr is null
   and not exists (select 1 from ops_procure.item_categories y where y.abbr = s.abbr);

-- Groups first, then types, so a type's parent is there when it lands.
insert into ops_procure.item_categories (code, parent_code, name, abbr)
select s.code, s.parent_code, s.name,
       case when exists (select 1 from ops_procure.item_categories y where y.abbr = s.abbr) then null else s.abbr end
  from seed_categories s
 where s.parent_code is null
   and not exists (select 1 from ops_procure.item_categories c where c.code = s.code)
   and not exists (select 1 from ops_procure.item_categories c
                    where c.parent_code is null and lower(c.name) = lower(s.name))
 order by s.ord;

insert into ops_procure.item_categories (code, parent_code, name, abbr)
select s.code, s.parent_code, s.name,
       case when exists (select 1 from ops_procure.item_categories y where y.abbr = s.abbr) then null else s.abbr end
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

-- Whatever is left without a short code — types production made on the
-- screen — gets one from its name, through the trigger.
update ops_procure.item_categories set abbr = null where abbr is null;
update ops_inv.stock_locations     set abbr = null where abbr is null;

-- ── 3. numbering by location and type ───────────────────────────────────────
create table if not exists ops_inv.item_code_counters (
  location_abbr text not null,
  category_abbr text not null,
  last_no       int  not null check (last_no > 0),
  primary key (location_abbr, category_abbr)
);
alter table ops_inv.item_code_counters enable row level security;
-- No policy: only `register_item` (definer) reads or writes it.
comment on table ops_inv.item_code_counters is
  'Last number issued per location and category short code, for item codes LOC-CAT-NNNN (0197).';

create or replace function ops_inv.register_item(
  p_name          text,
  p_name_local    text,
  p_category_code text,
  p_base_uom      text,
  p_photo_ids     uuid[],
  p_location      text    default null,
  p_counted       numeric default null,
  p_reason        text    default null,
  p_key           text    default null)
returns jsonb
language plpgsql security definer set search_path = ops_inv, ops_procure, ops_core, pg_temp as $$
declare
  v_code     text;
  v_n        int;
  v_photos   int := coalesce(array_length(p_photo_ids, 1), 0);
  v_existing text;
  v_photo    uuid;
  v_loc_abbr text;
  v_cat_abbr text;
  res        jsonb;
  replayed   jsonb;
begin
  replayed := ops_core.idem_replay('inventory', 'register_item', p_key);
  if replayed is not null then return replayed; end if;

  if not ops_core.has_permission('inventory.create') then
    return ops_core.refused('inventory','item', null,'register',
      'not_permitted','Mendaftarkan barang butuh akses tulis inventory.');
  end if;
  if coalesce(btrim(p_name), '') = '' then
    return ops_core.invalid('inventory','item', null,'register',
      'name_required','Barang butuh nama katalog.', jsonb_build_object('field','name'));
  end if;
  if v_photos < 1 then
    return ops_core.invalid('inventory','item', null,'register',
      'photo_required','Barang butuh minimal satu foto.', jsonb_build_object('field','photos'));
  end if;
  if v_photos > 4 then
    return ops_core.invalid('inventory','item', null,'register',
      'too_many_photos','Paling banyak empat foto per barang.',
      jsonb_build_object('field','photos','given', v_photos));
  end if;
  if (select count(distinct x) from unnest(p_photo_ids) x) <> v_photos then
    return ops_core.invalid('inventory','item', null,'register',
      'duplicate_photo','Foto yang sama dikirim dua kali.', jsonb_build_object('field','photos'));
  end if;
  if exists (select 1 from unnest(p_photo_ids) x
              where not exists (select 1 from ops_core.attachments a where a.id = x)) then
    return ops_core.not_found('inventory','item', null,'register','Salah satu foto tidak ditemukan.');
  end if;
  select c.abbr into v_cat_abbr from ops_procure.item_categories c where c.code = p_category_code;
  if not found then
    return ops_core.invalid('inventory','item', null,'register',
      'no_such_category', format('Tidak ada kategori %s.', p_category_code),
      jsonb_build_object('field','category_code'));
  end if;
  -- Registered at a rack means counted on a rack. A category nobody stocks
  -- would make the item vanish from the very screen it was entered on.
  if not exists (select 1 from ops_inv.stocked_categories s where s.category_code = p_category_code) then
    return ops_core.invalid('inventory','item', null,'register',
      'not_stocked', format('Kategori %s tidak dihitung di gudang.', p_category_code),
      jsonb_build_object('field','category_code'));
  end if;
  if not exists (select 1 from ops_procure.uom u where u.code = p_base_uom) then
    return ops_core.invalid('inventory','item', null,'register',
      'no_such_uom', format('Tidak ada satuan %s.', p_base_uom), jsonb_build_object('field','base_uom'));
  end if;
  if p_counted is not null then
    if p_counted <= 0 then
      return ops_core.invalid('inventory','item', null,'register',
        'counted_invalid','Jumlah hasil hitung harus lebih dari nol — kosongkan kalau belum dihitung.',
        jsonb_build_object('field','counted'));
    end if;
    if not ops_core.has_permission('inventory.adjust') then
      return ops_core.refused('inventory','item', null,'register',
        'not_permitted','Mencatat hasil hitung butuh izin penyesuaian stok.');
    end if;
  end if;

  -- An exact name already in the catalogue is the same item, not a new one:
  -- count it there. Asked before the location, because the answer does not
  -- depend on where the counter is standing.
  select i.code into v_existing from ops_procure.items i
   where i.merged_into is null and i.archived_at is null
     and (lower(btrim(i.name)) = lower(btrim(p_name))
          or (p_name_local is not null
              and lower(btrim(i.name_local)) = lower(btrim(p_name_local))))
   limit 1;
  if v_existing is not null then
    return ops_core.conflict('inventory','item', v_existing,'register',
      'already_catalogued', format('Barang ini sudah ada sebagai %s — hitung di sana.', v_existing),
      jsonb_build_object('existing_code', v_existing));
  end if;

  -- The code names the rack, so the rack is required — counted or not (0197).
  select l.abbr into v_loc_abbr from ops_inv.stock_locations l where l.code = p_location and l.is_active;
  if not found then
    return ops_core.invalid('inventory','item', null,'register',
      'location_required','Pilih lokasi rak yang aktif — kode barang memakai lokasinya.',
      jsonb_build_object('field','location'));
  end if;
  if v_loc_abbr is null or v_cat_abbr is null then
    return ops_core.invalid('inventory','item', null,'register',
      'abbr_missing','Lokasi atau kategori ini belum punya kode singkat.',
      jsonb_build_object('location', p_location, 'category_code', p_category_code));
  end if;

  -- LOC-CAT-NNNN, the number per location and type. The upsert takes the row
  -- lock, so two registrations at the same rack and type queue on it.
  insert into ops_inv.item_code_counters as k (location_abbr, category_abbr, last_no)
  values (v_loc_abbr, v_cat_abbr, 1)
  on conflict (location_abbr, category_abbr) do update set last_no = k.last_no + 1
  returning last_no into v_n;
  v_code := v_loc_abbr || '-' || v_cat_abbr || '-' || lpad(v_n::text, 4, '0');
  while exists (select 1 from ops_procure.items i where i.code = v_code) loop
    v_n := v_n + 1;
    v_code := v_loc_abbr || '-' || v_cat_abbr || '-' || lpad(v_n::text, 4, '0');
  end loop;
  update ops_inv.item_code_counters set last_no = v_n
   where location_abbr = v_loc_abbr and category_abbr = v_cat_abbr;

  insert into ops_procure.items (code, name, name_local, category_code, base_uom, kind, is_curated, created_by)
  values (v_code, btrim(p_name), nullif(btrim(p_name_local), ''), p_category_code, p_base_uom,
          'goods', false, auth.uid());

  insert into ops_inv.stock_settings (item_code, home_location)
  values (v_code, p_location)
  on conflict (item_code) do update set home_location = excluded.home_location;

  foreach v_photo in array p_photo_ids loop
    insert into ops_core.attachment_links (attachment_id, entity, entity_no, kind, linked_by)
    values (v_photo, 'item', v_code, 'foto', auth.uid());
  end loop;

  if p_counted is not null then
    insert into ops_inv.stock_moves (item_code, location, kind, qty, uom, reason, ref_no, moved_by)
    values (v_code, p_location, 'adjust', p_counted, p_base_uom,
            coalesce(nullif(btrim(p_reason), ''), 'Opname: barang baru didaftarkan, dihitung saat didaftarkan'),
            null, auth.uid());
  end if;

  perform ops_core.emit('inventory','inventory.item.registered', v_code,
    jsonb_build_object('code', v_code, 'photos', v_photos, 'counted', p_counted, 'location', p_location));

  res := ops_core.ok('inventory','item', v_code,'register',
    jsonb_build_object('code', v_code, 'photos', v_photos, 'counted', p_counted, 'location', p_location));
  return ops_core.idem_remember('inventory','register_item', p_key, res);
end $$;

revoke all on function ops_inv.register_item(text, text, text, text, uuid[], text, numeric, text, text) from public;
grant execute on function ops_inv.register_item(text, text, text, text, uuid[], text, numeric, text, text) to authenticated;

-- ── 4. an asset's location is a location ────────────────────────────────────
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

analyze ops_procure.item_categories;
analyze ops_inv.stock_locations;
analyze ops_inv.stocked_categories;
analyze ops_inv.item_code_counters;
analyze ops_inv.assets;
