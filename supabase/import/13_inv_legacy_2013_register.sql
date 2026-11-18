-- 13_inv_legacy_2013_register.sql — the 2013 machine register, as assets.
--
-- "MACHINE INVENTORY 2013" (an Excel export, 21 pages, photos dated Nov 2012)
-- is the only list of the factory's machines anybody has. It was extracted
-- row by row into `data/legacy_2013_register.csv` (163 rows; how, and what
-- each column means: `docs/handoff/inventory-verification/REFERENCE.md`).
-- Production has stopped and the company is recapping what it owns (D447):
-- these become assets so the verify screens have something on record to
-- check against.
--
-- Not a legacy-table read, like steps 10 and 12 before it: here because it is
-- data, not schema (D337), and because it must be run twice and change
-- nothing the second time.
--
-- ── What one row becomes ─────────────────────────────────────────────────
--
--   ops_inv.assets, one per physical unit — `qty` 2 is two assets (only C1-07)
--     name               suggested_name (title case; the 2013 typos stay in
--                        legacy_notes, not in the name)
--     category_code      machine          (owner, step 1 answer 1)
--     status             in_storage       (production stopped; answer 3)
--     brand / model      brand_clean / model (empty → null)
--     location           null — the 2013 floor grid is the old layout, and
--                        the checker places each machine in a 2024 zone
--     legacy_code/area/department  as cleaned
--     legacy_notes       data_issue · photo_issue · "Unit n of N"
--   ops_core.legacy_map  one per unit: `file.legacy_2013_register`,
--                        `<legacy_code>` or `<legacy_code>#<unit>`
--
-- Asset numbers are the register's own `AST-` series, handed out in the
-- 2013 row order; nothing in the number means anything (D347).
--
-- The photos are not here: they go through the app's Drive upload path, as
-- the person running it (`scripts/import/upload-2013-photos.mjs`).
--
-- Run from the repo root:
--
--   psql … -v ON_ERROR_STOP=1 -f supabase/import/13_inv_legacy_2013_register.sql

set client_encoding = 'UTF8';

begin;

create temp table _reg (
  row_no int, legacy_code text, item_name_2013 text, suggested_name text, qty int,
  legacy_area text, legacy_area_raw text, legacy_department text, legacy_department_raw text,
  brand_raw text, brand_clean text, model text, model_raw text, catalogue_page text,
  photo_file text, photo_issue text, data_issue text);

\copy _reg from 'supabase/import/data/legacy_2013_register.csv' with (format csv, header true)

do $$
declare
  r       record;
  v_id    uuid;
  v_src   text;
  v_run   constant uuid := '2013a55e-0000-4c0d-9e61-20261118a001';
  n_new   int := 0;
begin
  if not exists (select 1 from ops_inv.asset_categories where code = 'machine') then
    raise exception 'the machine category is missing: apply 0290 first';
  end if;
  if (select count(*) from _reg) <> 163 or exists (select 1 from _reg where qty is null or qty < 1) then
    raise exception 'the register is not the 163-row file this step was written for (saw % rows)',
      (select count(*) from _reg);
  end if;

  for r in
    select g.*, u.unit
      from _reg g
      cross join lateral generate_series(1, g.qty) u(unit)
     order by g.row_no, u.unit
  loop
    v_src := r.legacy_code || case when r.qty > 1 then '#' || r.unit else '' end;
    continue when exists (select 1 from ops_core.legacy_map
                           where source_table = 'file.legacy_2013_register' and source_id = v_src);

    insert into ops_inv.assets (name, category_code, brand, model, status,
                                legacy_code, legacy_area, legacy_department, legacy_notes)
    values (btrim(r.suggested_name), 'machine',
            nullif(btrim(r.brand_clean), ''), nullif(btrim(r.model), ''), 'in_storage',
            btrim(r.legacy_code), nullif(btrim(r.legacy_area), ''), nullif(btrim(r.legacy_department), ''),
            nullif(concat_ws(' · ',
              nullif(btrim(r.data_issue), ''),
              nullif(btrim(r.photo_issue), ''),
              case when r.qty > 1 then format('Unit %s of %s under one 2013 line', r.unit, r.qty) end), ''))
    returning id into v_id;

    insert into ops_core.legacy_map (source_table, source_id, target_table, target_id, outcome, note, run_id)
    values ('file.legacy_2013_register', v_src, 'ops_inv.assets', v_id, 'imported',
            format('row %s of MACHINE INVENTORY 2013%s', r.row_no,
                   case when r.qty > 1 then format(', unit %s of %s', r.unit, r.qty) else '' end),
            v_run);
    n_new := n_new + 1;
  end loop;

  raise notice 'imported % new asset(s) this run', n_new;
end $$;

select (select count(*) from _reg)                                                  as staged_rows,
       (select sum(qty) from _reg)                                                  as staged_units,
       (select count(*) from ops_core.legacy_map
         where source_table = 'file.legacy_2013_register' and outcome = 'imported') as mapped,
       (select count(*) from ops_inv.assets a
          join ops_core.legacy_map m on m.target_id = a.id
         where m.source_table = 'file.legacy_2013_register')                        as assets,
       (select count(*) from ops_inv.assets a
          join ops_core.legacy_map m on m.target_id = a.id
         where m.source_table = 'file.legacy_2013_register' and a.brand is null)    as without_brand,
       (select count(*) from ops_inv.assets a
          join ops_core.legacy_map m on m.target_id = a.id
         where m.source_table = 'file.legacy_2013_register' and a.model is null)    as without_model;

commit;
