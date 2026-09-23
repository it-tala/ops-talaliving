-- procure — master data (0099): renaming, archiving and deleting a vendor, and
-- maintaining units and their conversions.
--
--   V-9901 "CV Lama"    referenced (an item was last bought from it)
--   V-9902 "Toko Kosong" referenced by nothing
--   V-9903 "CV Lain"    a second live name, to collide with
--
--   REFUSALS     a read grant renaming; a name another live vendor holds;
--                deleting a vendor something points at; a unit code with a
--                space; a unit that already exists; a conversion whose
--                reverse is already defined; deleting a unit in use
--   DERIVATIONS  the old name kept as an alias; archive out and back; an
--                unreferenced vendor actually gone; a conversion saved twice
--                is one row, updated

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-000000009901','rina-md@talaliving.com','{"full_name":"Rina MD"}'),
  ('ffffffff-0000-0000-0000-000000009902','tamu-md@talaliving.com','{"full_name":"Tamu MD"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-000000009901','procurement','write'),
  ('ffffffff-0000-0000-0000-000000009902','procurement','read');

insert into ops_procure.vendors (id, code, name, is_curated) values
  ('99010000-0000-0000-0000-000000000001','V-9901','CV Lama', true),
  ('99010000-0000-0000-0000-000000000002','V-9902','Toko Kosong', false),
  ('99010000-0000-0000-0000-000000000003','V-9903','CV Lain', true);
insert into ops_procure.items (code, name, category_code, base_uom, last_vendor_id) values
  ('ITM-9901','Amplas 240','finishing','pcs','99010000-0000-0000-0000-000000000001');

set local role authenticated;

/* ── REFUSAL: a read grant does not rename ─────────────────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000009902';
do $$
declare r jsonb;
begin
  r := ops_procure.rename_vendor('V-9901', 'CV Baru');
  assert r -> 'error' ->> 'code' = 'not_permitted', 'read grant should be refused, got ' || r::text;
end $$;

set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000009901';

/* ── rename: the old name becomes an alias ─────────────────────────────── */
do $$
declare r jsonb; v ops_procure.vendors;
begin
  r := ops_procure.rename_vendor('V-9901', '  CV Baru  ');
  assert r ->> 'outcome' = 'ok', 'rename should succeed, got ' || r::text;
  select * into v from ops_procure.vendors where code = 'V-9901';
  assert v.name = 'CV Baru', 'trimmed new name, got ' || v.name;
  assert 'CV Lama' = any(v.aka), 'old name kept as alias, got ' || v.aka::text;

  r := ops_procure.rename_vendor('V-9901', 'CV Baru');
  assert r ->> 'outcome' = 'noop', 'same name is a noop, got ' || r::text;

  r := ops_procure.rename_vendor('V-9901', 'cv lain');
  assert r -> 'error' ->> 'code' = 'name_taken', 'a live vendor already holds it, got ' || r::text;

  -- Renaming back to the old spelling takes it out of aka again.
  r := ops_procure.rename_vendor('V-9901', 'CV Lama');
  select * into v from ops_procure.vendors where code = 'V-9901';
  assert not ('CV Lama' = any(v.aka)), 'a name is never its own alias, got ' || v.aka::text;
  assert 'CV Baru' = any(v.aka), 'and the name it left is kept, got ' || v.aka::text;
end $$;

/* ── archive, and back ─────────────────────────────────────────────────── */
do $$
declare r jsonb; a timestamptz;
begin
  r := ops_procure.archive_vendor('V-9901', true);
  assert r ->> 'outcome' = 'ok', 'archive should succeed, got ' || r::text;
  select archived_at into a from ops_procure.vendors where code = 'V-9901';
  assert a is not null, 'archived_at set';
  assert (select archived_at is not null from ops_procure.v_vendor_view where code = 'V-9901'),
    'the view carries archived_at';

  r := ops_procure.archive_vendor('V-9901', true);
  assert r ->> 'outcome' = 'noop', 'archiving twice is a noop, got ' || r::text;

  r := ops_procure.archive_vendor('V-9901', false);
  assert r ->> 'outcome' = 'ok', 'unarchive should succeed, got ' || r::text;
  select archived_at into a from ops_procure.vendors where code = 'V-9901';
  assert a is null, 'archived_at cleared';
end $$;

/* ── delete: refused while anything remembers it ───────────────────────── */
do $$
declare r jsonb;
begin
  r := ops_procure.delete_vendor('V-9901');
  assert r -> 'error' ->> 'code' = 'vendor_in_use', 'referenced vendor refused, got ' || r::text;
  assert (r -> 'error' -> 'detail' -> 'uses' ->> 'items_last_bought')::int = 1,
    'and says what holds it, got ' || r::text;
  assert exists (select 1 from ops_procure.vendors where code = 'V-9901'), 'still there';

  r := ops_procure.delete_vendor('V-9902');
  assert r ->> 'outcome' = 'ok', 'unreferenced vendor deleted, got ' || r::text;
  assert not exists (select 1 from ops_procure.vendors where code = 'V-9902'), 'actually gone';
end $$;

/* ── units ─────────────────────────────────────────────────────────────── */
do $$
declare r jsonb;
begin
  r := ops_procure.create_uom('bad code', 'Bad', 'count');
  assert r -> 'error' ->> 'code' = 'code_invalid', 'a code with a space is refused, got ' || r::text;

  r := ops_procure.create_uom(' Tube ', 'Tube', 'count');
  assert r ->> 'outcome' = 'ok', 'create should succeed, got ' || r::text;
  assert exists (select 1 from ops_procure.uom where code = 'tube'), 'stored lower-case and trimmed';

  r := ops_procure.create_uom('tube', 'Tube again', 'count');
  assert r -> 'error' ->> 'code' = 'uom_exists', 'duplicate refused, got ' || r::text;

  r := ops_procure.update_uom('tube', 'Tube (paint)', 'count');
  assert r ->> 'outcome' = 'ok', 'rename should succeed, got ' || r::text;
  r := ops_procure.update_uom('tube', 'Tube (paint)', 'count');
  assert r ->> 'outcome' = 'noop', 'same values are a noop, got ' || r::text;
end $$;

/* ── conversions ───────────────────────────────────────────────────────── */
do $$
declare r jsonb; n int; f numeric;
begin
  r := ops_procure.save_uom_conversion('tube', 'pcs', 10, null, 'box of ten');
  assert r ->> 'outcome' = 'ok', 'create conversion, got ' || r::text;

  r := ops_procure.save_uom_conversion('pcs', 'tube', 0.1);
  assert r -> 'error' ->> 'code' = 'reverse_exists', 'the reverse is the same fact, got ' || r::text;

  r := ops_procure.save_uom_conversion('tube', 'pcs', 12);
  assert r ->> 'outcome' = 'ok', 'update conversion, got ' || r::text;
  select count(*), max(factor) into n, f from ops_procure.uom_conversions where from_uom = 'tube';
  assert n = 1 and f = 12, 'saved twice is one row, updated — got ' || n || ' rows, factor ' || f;

  r := ops_procure.save_uom_conversion('tube', 'pcs', 12, 1.5);
  assert r -> 'error' ->> 'code' = 'yield_invalid', 'yield above 1 refused, got ' || r::text;

  r := ops_procure.delete_uom('tube');
  assert r -> 'error' ->> 'code' = 'uom_in_use', 'a unit with a conversion stays, got ' || r::text;

  r := ops_procure.delete_uom_conversion('tube', 'pcs');
  assert r ->> 'outcome' = 'ok', 'delete conversion, got ' || r::text;
  r := ops_procure.delete_uom('tube');
  assert r ->> 'outcome' = 'ok', 'now it can go, got ' || r::text;

  r := ops_procure.delete_uom('pcs');
  assert r -> 'error' ->> 'code' = 'uom_in_use', 'pcs is used by an item, got ' || r::text;
end $$;

rollback;
