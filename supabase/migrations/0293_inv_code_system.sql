-- 0293_inv_code_system.sql — one code system for everything inventory keeps.
--
-- The 2013 register coded machines `L#-##`: type letter, family within the
-- letter, unit (LEGACY-CODES.md, D450). The owner (2026-11-18, D451): every
-- inventory follows the same system — machines, tools and materials — the old
-- code kept for matching the 2013 photos, and anything new properly named,
-- numbered, said what it is and where.
--
-- Decided with the owner:
--   1. **The code is the visible code, not the key.** `S2-29` is what people see,
--      search and print. `AST-0001` and `I-00001` stay underneath as the
--      permanent keys every link, photo, audit row and printed QR uses, so
--      nothing breaks; D347's worry — a wrong pick at registration being a
--      wrong code for ever — is answered by recoding, with every old code kept
--      in `code_history`.
--   2. **One registry of families for everything.** No family code means two
--      things: `S1` sander, `S2` saw (machines), `S3` sandpaper (a material).
--      `unit` families number each physical thing, two digits (`S2-29`);
--      `counted` families number each catalogue item, three digits (`S3-001`).
--      A letter with more than nine families goes to two digits (`S10`).
--   3. **Codes are assigned when a record is made**, by triggers, so every road
--      that registers something (the asset form, a find during the recap,
--      `register_item`, the receiving report, an import) gives it a code
--      without changing its signature. A 2013 machine's code is its 2013 code,
--      the three breaks corrected (C3-03 → C2-03, C4-04 → C2-04, U-11 → U1-11);
--      a second unit under one code (C1-07) takes the family's next number.
--      `legacy_code` is never touched: it is what the photos are labelled.
--   4. Services are not inventory: their categories get no family, their items
--      no code.
--
-- The families for the records already here are assigned by rule in
-- `supabase/import/15_inv_code_backfill.sql` (data, not schema).

-- ── 1. the registry ─────────────────────────────────────────────────────
create table if not exists ops_inv.code_families (
  code                text primary key check (code ~ '^[A-Z][0-9]{1,2}$'),
  letter              text not null check (letter ~ '^[A-Z]$'),
  digit               int  not null check (digit >= 1),
  -- The type word(s) a name in the 2013 format starts with: `SAW`, `SANDPAPER`.
  type_name           text not null check (type_name = upper(btrim(type_name)) and type_name <> ''),
  label_en            text not null,
  label_id            text,
  kind                text not null check (kind in ('unit','counted')),
  -- A unit family can be the default for an asset category (an asset entered
  -- without a family lands there); a counted family is one catalogue category.
  asset_category_code text references ops_inv.asset_categories(code),
  category_default    boolean not null default false,
  item_category_code  text references ops_procure.item_categories(code),
  -- Held so a 2013 photo label is never read as a new family (C3, C4).
  reserved            boolean not null default false,
  note                text,
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  constraint code_family_is_letter_digit check (code = letter || digit),
  constraint code_family_unique_slot unique (letter, digit),
  constraint code_family_counted_has_category check (kind = 'unit' or item_category_code is not null)
);
create unique index if not exists code_families_item_category_idx
  on ops_inv.code_families (item_category_code) where item_category_code is not null;
create unique index if not exists code_families_category_default_idx
  on ops_inv.code_families (asset_category_code) where category_default;

comment on table ops_inv.code_families is
  'The one code system (0293, D451): type letter + family number; unit families number each thing (S2-29), '
  'counted families each catalogue item (S3-001).';

alter table ops_inv.code_families enable row level security;
drop policy if exists code_families_read on ops_inv.code_families;
create policy code_families_read on ops_inv.code_families for select to authenticated using (true);
grant select on ops_inv.code_families to authenticated;

-- The 2013 families, as the register numbered them (LEGACY-CODES.md §1).
insert into ops_inv.code_families (code, letter, digit, type_name, label_en, label_id, kind, reserved, note) values
  ('A1','A',1,'AIR COMPRESSOR','Air compressor','Kompresor udara','unit',false,'2013'),
  ('A2','A',2,'AIR DRYER','Air dryer','Pengering udara','unit',false,'2013'),
  ('A3','A',3,'AIR TANK','Air tank','Tangki udara','unit',false,'2013'),
  ('B1','B',1,'BORING','Boring','Bor (boring)','unit',false,'2013'),
  ('C1','C',1,'CLAMP','Clamp','Klem','unit',false,'2013'),
  ('C2','C',2,'CONSTRUCTION','Construction equipment','Alat konstruksi','unit',false,'2013'),
  ('C3','C',3,'CONSTRUCTION','Reserved: 2013 label C3-03','Dicadangkan: label 2013 C3-03','unit',true,'2013 break, read as C2'),
  ('C4','C',4,'CONSTRUCTION','Reserved: 2013 label C4-04','Dicadangkan: label 2013 C4-04','unit',true,'2013 break, read as C2'),
  ('D1','D',1,'DOVETAILING MACHINE','Dovetailing','Dovetail','unit',false,'2013'),
  ('D2','D',2,'DRILL','Drill press','Bor duduk','unit',false,'2013'),
  ('D3','D',3,'DEHUMIDIFIER','Dehumidifier','Dehumidifier','unit',false,'2013'),
  ('E1','E',1,'EDGEBANDER','Edgebander','Edgebander','unit',false,'2013'),
  ('F1','F',1,'FINISHING','Spray booth','Spray booth','unit',false,'2013'),
  ('G1','G',1,'GLUE','Glue roller','Roller lem','unit',false,'2013'),
  ('J1','J',1,'JOINTER','Jointer','Jointer','unit',false,'2013'),
  ('L1','L',1,'LATHE MACHINE','Lathe','Bubut','unit',false,'2013'),
  ('M1','M',1,'METAL','Metal working','Pengerjaan logam','unit',false,'2013'),
  ('M2','M',2,'MOULDER','Moulder','Moulder','unit',false,'2013'),
  ('P1','P',1,'PLANER','Planer','Serut (planer)','unit',false,'2013'),
  ('P2','P',2,'PRESS','Press','Press','unit',false,'2013'),
  ('R1','R',1,'ROUTER','Router','Router','unit',false,'2013'),
  ('S1','S',1,'SANDER','Sander','Amplas (sander)','unit',false,'2013'),
  ('S2','S',2,'SAW','Saw','Gergaji','unit',false,'2013'),
  ('T1','T',1,'TOOLROOM','Toolroom','Toolroom','unit',false,'2013'),
  ('U1','U',1,'UPHOLSTERY','Upholstery','Jok (upholstery)','unit',false,'2013'),
  ('V1','V',1,'VENEER','Veneer','Veneer','unit',false,'2013')
on conflict (code) do nothing;
update ops_inv.code_families set asset_category_code = 'machine' where note = '2013' and not reserved;

-- ── 2. codes on the records, and their history ──────────────────────────
alter table ops_inv.assets
  add column if not exists code        text unique,
  add column if not exists family_code text references ops_inv.code_families(code),
  add column if not exists description text;
comment on column ops_inv.assets.code is
  'The visible code in the one system (S2-29, 0293, D451). asset_no stays the permanent key.';
comment on column ops_inv.assets.description is
  'One plain sentence on what it is and what it is used for (0293, D451).';

create table if not exists ops_inv.item_codes (
  item_code   text primary key references ops_procure.items(code),
  code        text not null unique,
  family_code text not null references ops_inv.code_families(code),
  description text,
  assigned_at timestamptz not null default now()
);
comment on table ops_inv.item_codes is
  'A catalogue item''s visible code in the one system (S3-001, 0293, D451). The item code (I-00001) stays the key.';
alter table ops_inv.item_codes enable row level security;
drop policy if exists item_codes_read on ops_inv.item_codes;
create policy item_codes_read on ops_inv.item_codes for select to authenticated using (true);
grant select on ops_inv.item_codes to authenticated;

create table if not exists ops_inv.code_history (
  id         bigserial primary key,
  entity     text not null check (entity in ('asset','item')),
  key        text not null,
  old_code   text not null,
  new_code   text not null,
  reason     text not null,
  changed_by uuid references ops_core.users(id),
  changed_at timestamptz not null default now()
);
create index if not exists code_history_old_idx on ops_inv.code_history (old_code);
comment on table ops_inv.code_history is
  'Every code a record had before it was recoded, so an old label still finds it (0293, D451). Append-only.';
alter table ops_inv.code_history enable row level security;
drop policy if exists code_history_read on ops_inv.code_history;
create policy code_history_read on ops_inv.code_history for select to authenticated
  using ((select ops_core.has_permission('inventory.read')));
grant select on ops_inv.code_history to authenticated;

create or replace function ops_inv.code_history_append_only()
returns trigger language plpgsql set search_path = ops_inv, pg_temp as $$
begin
  raise exception using errcode = 'check_violation', message = 'Code history is not changed or deleted.';
end $$;
drop trigger if exists code_history_append_only on ops_inv.code_history;
create trigger code_history_append_only before update or delete on ops_inv.code_history
  for each row execute function ops_inv.code_history_append_only();

-- ── 3. numbering ────────────────────────────────────────────────────────
-- The next number in a family: one past the highest code already in it (on an
-- asset or a catalogue item), two digits for a unit family and three for a
-- counted one — wider only when a family outgrows them. Serialised per family.
create or replace function ops_inv.next_code(p_family text)
returns text
language plpgsql volatile set search_path = ops_inv, pg_temp as $$
declare f ops_inv.code_families; v_max int; v_width int;
begin
  select * into f from ops_inv.code_families where code = p_family;
  if not found then raise exception 'no code family %', p_family; end if;
  perform pg_advisory_xact_lock(hashtext('code-family:' || p_family));
  select coalesce(max(substring(c from '-(\d+)$')::int), 0) into v_max
    from (select code as c from ops_inv.assets where family_code = p_family and code is not null
          union all
          select code from ops_inv.item_codes where family_code = p_family) x;
  v_width := case when f.kind = 'counted' then 3 else 2 end;
  return p_family || '-' || lpad((v_max + 1)::text, greatest(v_width, length((v_max + 1)::text)), '0');
end $$;
revoke all on function ops_inv.next_code(text) from public;

-- The first free family number for a letter, reserved ones skipped.
create or replace function ops_inv.next_family_digit(p_letter text)
returns int
language sql stable set search_path = ops_inv, pg_temp as $$
  select min(d) from generate_series(1, 99) d
   where not exists (select 1 from ops_inv.code_families f where f.letter = p_letter and f.digit = d)
$$;
revoke all on function ops_inv.next_family_digit(text) from public;

-- A family, found by its type and kind or made with the letter's next number.
-- Internal: the backfill and the seam below call it.
create or replace function ops_inv.ensure_code_family(
  p_type_name text, p_label_en text, p_label_id text, p_kind text,
  p_asset_category text default null, p_item_category text default null, p_category_default boolean default false)
returns text
language plpgsql volatile set search_path = ops_inv, pg_temp as $$
declare v_type text := upper(btrim(p_type_name)); v_letter text; v_digit int; v_code text;
begin
  if p_item_category is not null then
    select code into v_code from ops_inv.code_families where item_category_code = p_item_category;
  else
    select code into v_code from ops_inv.code_families
     where type_name = v_type and kind = p_kind and not reserved order by letter, digit limit 1;
  end if;
  if v_code is not null then return v_code; end if;
  v_letter := substring(regexp_replace(v_type, '[^A-Z]', '', 'g') from 1 for 1);
  if v_letter is null or v_letter = '' then raise exception 'a family type must start with a letter: %', p_type_name; end if;
  perform pg_advisory_xact_lock(hashtext('code-letter:' || v_letter));
  v_digit := ops_inv.next_family_digit(v_letter);
  v_code := v_letter || v_digit;
  insert into ops_inv.code_families (code, letter, digit, type_name, label_en, label_id, kind,
                                     asset_category_code, category_default, item_category_code)
  values (v_code, v_letter, v_digit, v_type, btrim(p_label_en), nullif(btrim(p_label_id), ''), p_kind,
          p_asset_category, coalesce(p_category_default, false), p_item_category);
  return v_code;
end $$;
revoke all on function ops_inv.ensure_code_family(text, text, text, text, text, text, boolean) from public;

-- A 2013 code as the one system reads it: the three breaks corrected.
create or replace function ops_inv.legacy_code_corrected(p_legacy text)
returns text
language sql immutable as $$
  select case upper(btrim(p_legacy)) when 'C3-03' then 'C2-03' when 'C4-04' then 'C2-04' when 'U-11' then 'U1-11'
              else upper(btrim(p_legacy)) end
$$;

-- ── 4. the default family of each asset category ───────────────────────
-- So an asset registered without a family still gets a code. Machines have
-- none: a machine is always a family of its own kind.
select ops_inv.ensure_code_family(t.type_name, t.label_en, t.label_id, 'unit', t.cat, null, true)
  from (values
    (1, 'CCTV',           'CCTV & security',  'CCTV & keamanan', 'cctv'),
    (2, 'COMPUTER',       'Computer',         'Komputer',        'computer'),
    (3, 'PRINTER',        'Printer & scanner','Printer & scanner','printer'),
    (4, 'NETWORK DEVICE', 'Network device',   'Perangkat jaringan','network'),
    (5, 'PHONE',          'Phone & tablet',   'HP & tablet',     'phone'),
    (6, 'VEHICLE',        'Vehicle',          'Kendaraan',       'vehicle'),
    (7, 'TOOL',           'Tool & equipment', 'Alat & perlengkapan','tool'),
    (8, 'FURNITURE',      'Office furniture', 'Mebel kantor',    'furniture'),
    (9, 'OTHER',          'Other',            'Lainnya',         'other')
  ) as t(ord, type_name, label_en, label_id, cat)
 where exists (select 1 from ops_inv.asset_categories c where c.code = t.cat)
 order by t.ord;

-- ── 5. one counted family per catalogue category ────────────────────────
-- Every category that is not a service, groups before their types, by name.
do $$
declare c record;
begin
  for c in
    select t.code, t.name, t.parent_code
      from ops_procure.item_categories t
     where t.code <> 'service' and coalesce(t.parent_code, '') <> 'service'
     order by (t.parent_code is not null), t.name, t.code
  loop
    perform ops_inv.ensure_code_family(upper(c.name), c.name, null, 'counted', null, c.code, false);
  end loop;
end $$;

-- ── 6. codes given when a record is made ────────────────────────────────
create or replace function ops_inv.asset_code_on_insert()
returns trigger
language plpgsql set search_path = ops_inv, pg_temp as $$
declare v_code text; v_family text;
begin
  if new.code is not null then return new; end if;
  if new.legacy_code is not null then
    v_code := ops_inv.legacy_code_corrected(new.legacy_code);
    v_family := split_part(v_code, '-', 1);
    if exists (select 1 from ops_inv.code_families f where f.code = v_family) then
      new.family_code := v_family;
      new.code := case when exists (select 1 from ops_inv.assets a where a.code = v_code)
                       then ops_inv.next_code(v_family) else v_code end;
      return new;
    end if;
  end if;
  if new.family_code is null then
    select f.code into new.family_code from ops_inv.code_families f
     where f.asset_category_code = new.category_code and f.category_default;
  end if;
  if new.family_code is not null then
    new.code := ops_inv.next_code(new.family_code);
  end if;
  return new;
end $$;
drop trigger if exists asset_code_on_insert on ops_inv.assets;
create trigger asset_code_on_insert before insert on ops_inv.assets
  for each row execute function ops_inv.asset_code_on_insert();

create or replace function ops_inv.item_code_on_insert()
returns trigger
language plpgsql set search_path = ops_inv, ops_procure, pg_temp as $$
declare v_family text;
begin
  select f.code into v_family from ops_inv.code_families f where f.item_category_code = new.category_code;
  if v_family is not null and not exists (select 1 from ops_inv.item_codes where item_code = new.code) then
    insert into ops_inv.item_codes (item_code, code, family_code) values (new.code, ops_inv.next_code(v_family), v_family);
  end if;
  return new;
end $$;
drop trigger if exists item_code_on_insert on ops_procure.items;
create trigger item_code_on_insert after insert on ops_procure.items
  for each row execute function ops_inv.item_code_on_insert();

-- ── 7. the seams ────────────────────────────────────────────────────────
-- A new family: its type word and labels, unit or counted. The letter is the
-- type's first letter, the number the letter's next free one.
create or replace function ops_inv.save_code_family(
  p_type_name text, p_label_en text, p_label_id text default null, p_kind text default 'unit',
  p_asset_category text default null)
returns jsonb
language plpgsql security definer set search_path = ops_inv, ops_core, pg_temp as $$
declare v_code text; v_type text := upper(btrim(coalesce(p_type_name, '')));
begin
  if not ops_core.has_permission('inventory.update') then
    return ops_core.refused('inventory','code_family', null,'create','not_permitted',
      'Adding a code family needs inventory write access.');
  end if;
  if v_type !~ '^[A-Z]' then
    return ops_core.invalid('inventory','code_family', null,'create','type_required',
      'Say what kind of thing it is, starting with a letter: SAW, TROLLEY, SANDPAPER.', jsonb_build_object('field','type_name'));
  end if;
  if coalesce(btrim(p_label_en), '') = '' then
    return ops_core.invalid('inventory','code_family', null,'create','label_required',
      'Give the family a name people read.', jsonb_build_object('field','label_en'));
  end if;
  if p_kind not in ('unit','counted') or p_kind = 'counted' then
    return ops_core.invalid('inventory','code_family', null,'create','kind_invalid',
      'A new family here is for things counted one by one; a material''s family comes with its catalogue category.',
      jsonb_build_object('field','kind'));
  end if;
  if p_asset_category is not null and not exists (select 1 from ops_inv.asset_categories where code = p_asset_category) then
    return ops_core.invalid('inventory','code_family', null,'create','category_unknown',
      format('No asset category %s.', p_asset_category), jsonb_build_object('field','asset_category'));
  end if;
  if exists (select 1 from ops_inv.code_families where type_name = v_type and kind = 'unit' and not reserved) then
    select code into v_code from ops_inv.code_families where type_name = v_type and kind = 'unit' and not reserved order by digit limit 1;
    return ops_core.conflict('inventory','code_family', v_code,'create','family_exists',
      format('%s is already the family %s.', v_type, v_code), jsonb_build_object('code', v_code));
  end if;
  v_code := ops_inv.ensure_code_family(v_type, p_label_en, p_label_id, 'unit', p_asset_category, null, false);
  return ops_core.ok('inventory','code_family', v_code,'create',
    jsonb_build_object('code', v_code, 'type_name', v_type), null,
    jsonb_build_object('type_name', v_type, 'label_en', btrim(p_label_en), 'asset_category', p_asset_category));
end $$;

-- An asset moved to another family: the next number there, the old code kept.
create or replace function ops_inv.recode_asset(p_asset_no text, p_family_code text, p_reason text)
returns jsonb
language plpgsql security definer set search_path = ops_inv, ops_core, pg_temp as $$
declare a ops_inv.assets; v_new text; v_reason text := nullif(btrim(p_reason), '');
begin
  if not ops_core.has_permission('inventory.update') then
    return ops_core.refused('inventory','asset', p_asset_no,'recode','not_permitted',
      'Recoding an asset needs inventory write access.');
  end if;
  select * into a from ops_inv.assets where asset_no = btrim(p_asset_no) for update;
  if not found then return ops_core.not_found('inventory','asset', p_asset_no,'recode','No such asset.'); end if;
  if not exists (select 1 from ops_inv.code_families where code = p_family_code and kind = 'unit' and not reserved and is_active) then
    return ops_core.invalid('inventory','asset', a.asset_no,'recode','family_unknown',
      format('No family %s for things counted one by one.', coalesce(p_family_code, '(none)')), jsonb_build_object('field','family_code'));
  end if;
  if v_reason is null then
    return ops_core.invalid('inventory','asset', a.asset_no,'recode','reason_required',
      'Say why the code changes; the old one stays findable.', jsonb_build_object('field','reason'));
  end if;
  if a.family_code = p_family_code then
    return ops_core.noop('inventory','asset', a.asset_no,'recode','Already in that family.',
      jsonb_build_object('asset_no', a.asset_no, 'code', a.code));
  end if;
  v_new := ops_inv.next_code(p_family_code);
  update ops_inv.assets set code = v_new, family_code = p_family_code, updated_at = now() where id = a.id;
  if a.code is not null then
    insert into ops_inv.code_history (entity, key, old_code, new_code, reason, changed_by)
    values ('asset', a.asset_no, a.code, v_new, v_reason, auth.uid());
  end if;
  return ops_core.say('inventory','asset', a.asset_no,'recode','ok', 200, null, v_reason,
    jsonb_build_object('asset_no', a.asset_no, 'code', v_new, 'old_code', a.code),
    jsonb_build_object('code', jsonb_build_object('from', a.code, 'to', v_new)),
    jsonb_build_object('code', a.code, 'family_code', a.family_code),
    jsonb_build_object('code', v_new, 'family_code', p_family_code));
end $$;

-- A find during the recap, now with its family and a sentence on what it is.
drop function if exists ops_inv.register_found_asset(text, text, text, text, uuid[], text, text, text, text, text);
create or replace function ops_inv.register_found_asset(
  p_name          text,
  p_family_code   text,
  p_location      text,
  p_condition     text,
  p_photo_ids     uuid[],
  p_description   text,
  p_brand         text default null,
  p_model         text default null,
  p_note          text default null,
  p_status        text default 'in_storage',
  p_key           text default null)
returns jsonb
language plpgsql security definer set search_path = ops_inv, ops_core, pg_temp as $$
declare
  f          ops_inv.code_families;
  v_photos   uuid[] := coalesce(p_photo_ids, '{}');
  v_n        int;
  v_loc      text   := nullif(btrim(p_location), '');
  v_name     text   := upper(nullif(btrim(p_name), ''));
  v_desc     text   := nullif(btrim(p_description), '');
  v_category text;
  v_id       uuid;
  v_no       text;
  v_code     text;
  v_vrf      text;
  v_photo    uuid;
  res        jsonb;
  replayed   jsonb;
begin
  replayed := ops_core.idem_replay('inventory','register_found_asset', p_key);
  if replayed is not null then return replayed; end if;

  if not ops_core.has_permission('inventory.create') then
    return ops_core.refused('inventory','asset', null,'register_found',
      'not_permitted','Registering an asset needs inventory write access.');
  end if;
  select * into f from ops_inv.code_families where code = p_family_code;
  if not found or f.kind <> 'unit' or f.reserved or not f.is_active then
    return ops_core.invalid('inventory','asset', null,'register_found',
      'family_required','Pick what kind of thing it is (its family) first.', jsonb_build_object('field','family_code'));
  end if;
  if v_name is null then
    return ops_core.invalid('inventory','asset', null,'register_found',
      'name_required','Say what it is.', jsonb_build_object('field','name'));
  end if;
  if v_desc is null then
    return ops_core.invalid('inventory','asset', null,'register_found',
      'description_required','One sentence on what it is and what it is used for.', jsonb_build_object('field','description'));
  end if;
  if v_loc is null or not exists (select 1 from ops_inv.stock_locations l where l.code = v_loc and l.is_active) then
    return ops_core.invalid('inventory','asset', null,'register_found',
      'location_required','Pick where it is from the location list.', jsonb_build_object('field','location'));
  end if;
  if p_condition is null or p_condition not in ('working','broken','untested') then
    return ops_core.invalid('inventory','asset', null,'register_found',
      'condition_required','Say whether it works, is broken, or could not be tested.',
      jsonb_build_object('field','condition'));
  end if;
  if coalesce(p_status, 'in_storage') not in ('in_use','in_storage','under_repair') then
    return ops_core.invalid('inventory','asset', null,'register_found',
      'status_invalid','A found asset is in use, in storage or under repair.', jsonb_build_object('field','status'));
  end if;
  v_n := coalesce(array_length(v_photos, 1), 0);
  if v_n < 1 then
    return ops_core.invalid('inventory','asset', null,'register_found',
      'photo_required','A photo of the whole thing is required.', jsonb_build_object('field','photos'));
  end if;
  if v_n > 4 then
    return ops_core.invalid('inventory','asset', null,'register_found',
      'too_many_photos','At most four photos.', jsonb_build_object('field','photos','given', v_n));
  end if;
  if (select count(distinct x) from unnest(v_photos) x) <> v_n then
    return ops_core.invalid('inventory','asset', null,'register_found',
      'duplicate_photo','The same photo was sent twice.', jsonb_build_object('field','photos'));
  end if;
  if exists (select 1 from unnest(v_photos) x
              where not exists (select 1 from ops_core.attachments t where t.id = x)) then
    return ops_core.not_found('inventory','asset', null,'register_found','One of the photos was not found.');
  end if;

  -- The family says which category it sits in; a family with none is a machine.
  v_category := coalesce(f.asset_category_code, 'machine');

  insert into ops_inv.assets (name, category_code, family_code, description, brand, model, location, status, notes, created_by)
  values (v_name, v_category, f.code, v_desc, nullif(btrim(p_brand), ''), nullif(btrim(p_model), ''), v_loc,
          coalesce(p_status, 'in_storage')::ops_inv.asset_status_t,
          'Found during the inventory recap' || coalesce(' — ' || nullif(btrim(p_note), ''), ''),
          auth.uid())
  returning id, asset_no, code into v_id, v_no, v_code;

  insert into ops_inv.asset_verifications (asset_id, result, condition, location, checks, note, verified_by, found_new)
  values (v_id, 'match', p_condition::ops_inv.asset_condition_t, v_loc,
          '{"name":{"ok":true},"brand":{"ok":true},"model":{"ok":true},"qty":{"ok":true}}'::jsonb,
          nullif(btrim(p_note), ''), auth.uid(), true)
  returning verification_no into v_vrf;

  foreach v_photo in array v_photos loop
    insert into ops_core.attachment_links (attachment_id, entity, entity_no, kind, linked_by)
    values (v_photo, 'asset', v_no, 'foto', auth.uid());
    insert into ops_core.attachment_links (attachment_id, entity, entity_no, kind, linked_by)
    values (v_photo, 'asset_verification', v_vrf, 'foto', auth.uid());
  end loop;

  res := ops_core.ok('inventory','asset', v_no,'register_found',
    jsonb_build_object('asset_no', v_no, 'code', v_code, 'verification_no', v_vrf, 'photos', v_n),
    null,
    jsonb_build_object('name', v_name, 'code', v_code, 'family_code', f.code, 'description', v_desc,
                       'location', v_loc, 'condition', p_condition, 'verification_no', v_vrf));
  return ops_core.idem_remember('inventory','register_found_asset', p_key, res);
end $$;

revoke execute on function
  ops_inv.save_code_family(text, text, text, text, text),
  ops_inv.recode_asset(text, text, text),
  ops_inv.register_found_asset(text, text, text, text, uuid[], text, text, text, text, text, text)
  from public;
grant execute on function
  ops_inv.save_code_family(text, text, text, text, text),
  ops_inv.recode_asset(text, text, text),
  ops_inv.register_found_asset(text, text, text, text, uuid[], text, text, text, text, text, text)
  to authenticated;

-- ── 8. codes for what is already here ───────────────────────────────────
-- 2013 machines from their codes; every catalogue item from its category.
-- Other assets get theirs by rule in import step 15 (it knows the names).
do $$
declare a record; v_code text; v_family text;
begin
  for a in select id, legacy_code from ops_inv.assets where code is null and legacy_code is not null order by asset_no loop
    v_code := ops_inv.legacy_code_corrected(a.legacy_code);
    v_family := split_part(v_code, '-', 1);
    if exists (select 1 from ops_inv.assets x where x.code = v_code) then v_code := ops_inv.next_code(v_family); end if;
    update ops_inv.assets set code = v_code, family_code = v_family where id = a.id;
  end loop;
end $$;

insert into ops_inv.item_codes (item_code, code, family_code)
select i.code, f.code || '-' || lpad(row_number() over (partition by f.code order by i.code)::text, 3, '0'), f.code
  from ops_procure.items i
  join ops_inv.code_families f on f.item_category_code = i.category_code
 where not exists (select 1 from ops_inv.item_codes c where c.item_code = i.code)
on conflict (item_code) do nothing;

-- ── 9. the verify view carries the code ─────────────────────────────────
create or replace view ops_inv.v_asset_verification as
  select a.asset_no,
         a.name,
         a.category_code,
         c.name                                     as category_name,
         a.brand,
         a.model,
         a.status                                   as asset_status,
         a.location                                 as asset_location,
         a.legacy_code,
         a.legacy_area,
         a.legacy_department,
         a.legacy_notes,
         case when lv.found_new then 'new' else coalesce(lv.result::text, 'unverified') end as status,
         lv.verification_no,
         lv.condition,
         lv.location                                as verified_location,
         coalesce(lv.location, a.location)          as location,
         l.name                                     as location_name,
         lv.checks,
         lv.note,
         lv.verified_by,
         u.full_name                                as verified_by_name,
         lv.verified_at,
         lv.applied_at,
         lv.applied_by,
         (select count(*) from ops_inv.asset_verifications x where x.asset_id = a.id)::int as verification_count,
         rp.attachment_id                           as record_photo_id,
         (select count(*) from ops_core.attachment_links k
           where k.entity = 'asset' and k.entity_no = a.asset_no
             and k.kind = 'foto' and k.unlinked_at is null)::int          as record_photo_count,
         coalesce((select count(*) from ops_core.attachment_links k
           where k.entity = 'asset_verification' and k.entity_no = lv.verification_no
             and k.unlinked_at is null), 0)::int                          as verification_photo_count,
         coalesce(lv.found_new, false)              as found_new,
         a.code,
         a.family_code,
         fam.label_en                               as family_label,
         a.description
    from ops_inv.assets a
    join ops_inv.asset_categories c on c.code = a.category_code
    left join ops_inv.code_families fam on fam.code = a.family_code
    left join lateral (
      select x.* from ops_inv.asset_verifications x
       where x.asset_id = a.id
       order by x.verified_at desc, x.verification_no desc
       limit 1) lv on true
    left join ops_inv.stock_locations l on l.code = coalesce(lv.location, a.location)
    left join ops_core.users u on u.id = lv.verified_by
    left join lateral (
      select k.attachment_id from ops_core.attachment_links k
       where k.entity = 'asset' and k.entity_no = a.asset_no
         and k.kind = 'foto' and k.unlinked_at is null
       order by k.linked_at, k.id
       limit 1) rp on true
   where a.ended_on is null
      or lv.result = 'not_found';

alter view ops_inv.v_asset_verification set (security_invoker = on);
grant select on ops_inv.v_asset_verification to authenticated;

analyze ops_inv.code_families;
analyze ops_inv.item_codes;
analyze ops_inv.code_history;
analyze ops_inv.assets;
