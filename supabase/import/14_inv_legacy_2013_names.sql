-- 14_inv_legacy_2013_names.sql — the 2013 machines named in the register's own format.
--
-- Step 13 named the imported machines in title case (`Saw, Band`). The owner
-- chose the 2013 register's own format instead (D450, 2026-11-18): uppercase,
-- `TYPE, DESCRIPTOR (SIZE/VARIANT)`, the words on the 2013 placards — with the
-- spelling and the broken patterns corrected. Every correction, and the rule
-- behind it, is a row of `data/legacy_2013_names.csv` (`rules` column), built
-- from `docs/handoff/inventory-verification/LEGACY-CODES.md` §4–5:
--
--   spacing                PRESS , HF → PRESS, HF · BORING,3 → BORING, 3
--   spelling               DIHUMIDIFIER, MAHINE, SHARPING, TENNONER, MOLDER, HORT
--   type first             SINGLE CLAMP, CASE → CLAMP, CASE (SINGLE);
--                          METAL / TOOLROOM / UPHOLSTERY X → METAL, X …
--   size in brackets       (LRG) → (LARGE) · SINGLE RIP LRG → SINGLE RIP (LARGE)
--
-- Not corrected here: the codes, areas and departments (`legacy_*`) stay as the
-- register recorded them and are flagged on screen (D450); U1-24 / U1-26, whose
-- descriptions look swapped, keep their own.
--
-- **Only an untouched name is renamed**: one still equal to what step 13 wrote
-- (`suggested_name`). A name already corrected from a verification
-- (`apply_verification`) is what the floor found, and is left and reported.
-- Every rename writes its own audit row on the asset (before/after), with no
-- actor — a script did this, as `07_corrections.sql` records its changes. A
-- second run finds nothing to rename and writes nothing.
--
-- Run from the repo root, after 13:
--
--   psql … -v ON_ERROR_STOP=1 -f supabase/import/14_inv_legacy_2013_names.sql

set client_encoding = 'UTF8';

begin;

create temp table _names (legacy_code text, item_name_2013 text, suggested_name text, name text, rules text);

\copy _names from 'supabase/import/data/legacy_2013_names.csv' with (format csv, header true)

do $$
declare
  r        record;
  n_done   int := 0;
  n_kept   int := 0;
begin
  if (select count(*) from _names) <> 163 then
    raise exception 'the names file is not the 163-row file this step was written for (saw % rows)',
      (select count(*) from _names);
  end if;

  for r in
    select a.id, a.asset_no, a.name as current_name, n.suggested_name, n.name as new_name, n.rules, n.legacy_code
      from ops_inv.assets a
      join ops_core.legacy_map m on m.target_id = a.id and m.source_table = 'file.legacy_2013_register'
      join _names n on n.legacy_code = a.legacy_code
     order by a.asset_no
  loop
    continue when r.current_name = r.new_name;
    if r.current_name <> r.suggested_name then
      n_kept := n_kept + 1;
      raise notice '% kept as "%": changed since the import, not by it', r.asset_no, r.current_name;
      continue;
    end if;
    update ops_inv.assets set name = r.new_name, updated_at = now() where id = r.id;
    perform ops_core.write_audit('inventory', 'asset', r.asset_no, 'rename_2013', 'ok',
      'Named in the 2013 register format (D450)',
      jsonb_build_object('name', r.current_name), jsonb_build_object('name', r.new_name),
      jsonb_build_object('by', 'supabase/import/14_inv_legacy_2013_names.sql', 'legacy_code', r.legacy_code,
                         'rules', nullif(r.rules, '')));
    n_done := n_done + 1;
  end loop;

  raise notice 'renamed % asset(s); % kept because they changed after the import', n_done, n_kept;
end $$;

select (select count(*) from ops_inv.assets a join _names n on n.legacy_code = a.legacy_code
         where a.name = n.name)                                                      as in_2013_format,
       (select count(*) from ops_inv.assets a join _names n on n.legacy_code = a.legacy_code
         where a.name <> n.name)                                                     as other_name,
       (select count(*) from ops_core.audit_log
         where action = 'rename_2013' and detail->>'by' = 'supabase/import/14_inv_legacy_2013_names.sql') as audit_rows;

commit;
