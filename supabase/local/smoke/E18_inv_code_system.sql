-- inv — one code system for everything inventory keeps (0293, D451).
--
--   the registry: the 2013 families, C3/C4 held back, a default family per
--     asset category, one counted family per catalogue category, none for a
--     service
--   codes on insert: an asset by its category's family (two digits); a 2013
--     machine by its corrected 2013 code (C3-03 → C2-03, U-11 → U1-11), a
--     second unit under one code taking the family's next number; a catalogue
--     item by its category's family (three digits)
--   save_code_family: a new unit family takes its letter's next number
--   recode_asset: the next number in the new family, the old code kept in
--     history; the same family again is a noop
--   REFUSALS  no permission (family, recode); a type not starting with a
--             letter; a counted family made by hand; a family that exists;
--             recode without a reason or to an unknown / reserved family;
--             history edited or deleted

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-0000000e1801','coder-e18@talaliving.com','{"full_name":"Coder E18"}'),
  ('ffffffff-0000-0000-0000-0000000e1802','reader-e18@talaliving.com','{"full_name":"Reader E18"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-0000000e1801','inventory','write'),
  ('ffffffff-0000-0000-0000-0000000e1802','inventory','read');

/* ── the registry ─────────────────────────────────────────────────────────── */
do $$
begin
  assert (select count(*) from ops_inv.code_families where note = '2013' and not reserved) = 24, 'the 24 families of 2013';
  assert (select count(*) from ops_inv.code_families where code in ('C3','C4') and reserved) = 2, 'C3 and C4 held back';
  assert (select count(*) from ops_inv.code_families where category_default) = 9, 'a default for each asset category but machines';
  assert not exists (select 1 from ops_inv.code_families where category_default and asset_category_code = 'machine'),
    'a machine is always a family of its own kind';
  assert not exists (
    select 1 from ops_procure.item_categories t
     where t.code <> 'service' and coalesce(t.parent_code, '') <> 'service'
       and not exists (select 1 from ops_inv.code_families f where f.item_category_code = t.code)),
    'every category that is not a service has a counted family';
  assert not exists (
    select 1 from ops_inv.code_families f join ops_procure.item_categories t on t.code = f.item_category_code
     where t.code = 'service' or t.parent_code = 'service'), 'no family for a service';
  assert not exists (select 1 from ops_inv.code_families where code <> letter || digit), 'a code is its letter and number';
end $$;

/* ── codes given on insert ───────────────────────────────────────────────── */
insert into ops_inv.assets (asset_no, name, category_code) values ('AST-E181', 'PC accounting', 'computer');
insert into ops_inv.assets (asset_no, name, category_code, legacy_code) values
  ('AST-E182', 'CONSTRUCTION, SCARIFIER', 'machine', 'C3-03'),
  ('AST-E183', 'UPHOLSTERY, HOTWIRE MACHINE', 'machine', 'U-11');
insert into ops_inv.assets (asset_no, name, category_code, legacy_code) values ('AST-E184', 'CLAMP, CASE (DOUBLE)', 'machine', 'C1-07');
insert into ops_inv.assets (asset_no, name, category_code, legacy_code) values ('AST-E185', 'CLAMP, CASE (DOUBLE)', 'machine', 'C1-07');
insert into ops_procure.items (code, name, category_code, base_uom, kind)
values ('I-E1801', 'Sandpaper E18 #240', 'sanding-sandpaper', 'pcs', 'goods');

do $$
declare v_fam text;
begin
  select code into v_fam from ops_inv.code_families where category_default and asset_category_code = 'computer';
  assert (select code ~ ('^' || v_fam || '-\d{2}$') and family_code = v_fam from ops_inv.assets where asset_no = 'AST-E181'),
    'an asset without a family: its category''s, two digits';
  assert (select code from ops_inv.assets where asset_no = 'AST-E182') = 'C2-03', 'C3-03 read as C2-03';
  assert (select code from ops_inv.assets where asset_no = 'AST-E183') = 'U1-11', 'U-11 read as U1-11';
  assert (select legacy_code from ops_inv.assets where asset_no = 'AST-E182') = 'C3-03', 'the 2013 label stays for the photo';
  assert (select code from ops_inv.assets where asset_no = 'AST-E184') = 'C1-07', 'the first unit keeps C1-07';
  assert (select code from ops_inv.assets where asset_no = 'AST-E185') ~ '^C1-\d{2}$'
     and (select code from ops_inv.assets where asset_no = 'AST-E185') <> 'C1-07', 'the second unit takes the next number';
  select code into v_fam from ops_inv.code_families where item_category_code = 'sanding-sandpaper';
  assert (select code ~ ('^' || v_fam || '-\d{3}$') from ops_inv.item_codes where item_code = 'I-E1801'),
    'a catalogue item: its category''s counted family, three digits';
end $$;

set local role authenticated;

/* ── families and recoding, as people ────────────────────────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-0000000e1802';
do $$
declare r jsonb;
begin
  r := ops_inv.save_code_family('TROLLEY', 'Trolley', 'Troli');
  assert r -> 'error' ->> 'code' = 'not_permitted', 'a reader cannot add a family, got ' || r::text;
  r := ops_inv.recode_asset('AST-E181', 'S2', 'wrong family');
  assert r -> 'error' ->> 'code' = 'not_permitted', 'a reader cannot recode, got ' || r::text;
end $$;

set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-0000000e1801';
do $$
declare r jsonb; v_old text; v_new text; v_trolley text;
begin
  r := ops_inv.save_code_family('9 ROLLER', 'x');
  assert r -> 'error' ->> 'code' = 'type_required', 'a type starts with a letter, got ' || r::text;
  r := ops_inv.save_code_family('TAPE E18', 'Tape', null, 'counted');
  assert r -> 'error' ->> 'code' = 'kind_invalid', 'a counted family comes with its category, got ' || r::text;
  r := ops_inv.save_code_family('saw', 'Saw again');
  assert r -> 'error' ->> 'code' = 'family_exists' and r -> 'error' -> 'detail' ->> 'code' = 'S2', 'SAW is S2, got ' || r::text;

  r := ops_inv.save_code_family('Trolley', 'Trolley', 'Troli', 'unit', 'tool');
  assert r ->> 'outcome' = 'ok', 'a new family, got ' || r::text;
  v_trolley := r -> 'data' ->> 'code';
  assert v_trolley ~ '^T\d{1,2}$' and v_trolley <> 'T1', 'T and the letter''s next number, got ' || v_trolley;

  select code into v_old from ops_inv.assets where asset_no = 'AST-E181';
  r := ops_inv.recode_asset('AST-E181', v_trolley, '  ');
  assert r -> 'error' ->> 'code' = 'reason_required', 'say why, got ' || r::text;
  r := ops_inv.recode_asset('AST-E181', 'C3', 'x');
  assert r -> 'error' ->> 'code' = 'family_unknown', 'not a reserved family, got ' || r::text;
  r := ops_inv.recode_asset('AST-E181', 'ZZ', 'x');
  assert r -> 'error' ->> 'code' = 'family_unknown', 'not an unknown family, got ' || r::text;

  r := ops_inv.recode_asset('AST-E181', v_trolley, 'It is a trolley, not a computer');
  assert r ->> 'outcome' = 'ok', 'recoded, got ' || r::text;
  v_new := r -> 'data' ->> 'code';
  assert v_new = v_trolley || '-01', 'the first number in the new family, got ' || v_new;
  assert (select code = v_new and family_code = v_trolley from ops_inv.assets where asset_no = 'AST-E181'), 'the asset carries it';
  assert exists (select 1 from ops_inv.code_history where key = 'AST-E181' and old_code = v_old and new_code = v_new),
    'the old code stays findable';
  r := ops_inv.recode_asset('AST-E181', v_trolley, 'again');
  assert r ->> 'outcome' = 'noop', 'the same family again, got ' || r::text;
end $$;

reset role;
do $$
begin
  begin
    update ops_inv.code_history set reason = 'rewritten' where key = 'AST-E181';
    raise exception 'history was edited';
  exception when check_violation then null;
  end;
  begin
    delete from ops_inv.code_history where key = 'AST-E181';
    raise exception 'history was deleted';
  exception when check_violation then null;
  end;
end $$;

rollback;
