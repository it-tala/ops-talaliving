-- No function in `ops_*` may have two signatures.
--
-- ── The change that looks safest in SQL ───────────────────────────────────
--
-- `create or replace function` matches on name **and argument types**. Adding
-- an optional parameter therefore replaces nothing: it creates a second
-- function, and every existing call then matches both — the old one exactly,
-- the new one through its default. Postgres will not choose:
--
--     ERROR:  function ops_procure.curate_item(unknown, boolean) is not unique
--     HINT:   Could not choose a best candidate function.
--
-- So *adding an optional parameter*, the most obviously backward-compatible
-- edit available, breaks every existing caller — at run time, through
-- PostgREST, with an error that names types and says nothing about what
-- happened. `0032` did exactly this to `curate_item` and
-- `update_vendor_contact`, and it reached the project before it was caught.
--
-- ── Why a blanket rule rather than a list of exceptions ───────────────────
--
-- Overloading is a real Postgres feature and nothing here is wrong with it in
-- principle. But every function in this schema is a **seam** — reached from a
-- browser by name, through PostgREST, with named arguments and no casts. That
-- caller cannot disambiguate: it has no types to give. So an overload in
-- `ops_*` is never useful and always a trap, and the cheapest correct rule is
-- that there are none.
--
-- The fix when this fails is one line, and it belongs in the migration that
-- added the new signature:
--
--     drop function if exists ops_x.thing(<the old argument types>);
--
-- Spelled out in full rather than `cascade`, so the statement fails loudly if
-- the old signature is not what the migration thinks it is.

begin;

do $$
declare r record; v_found text := '';
begin
  for r in
    select n.nspname as schema, p.proname as name, count(*) as n,
           string_agg(pg_get_function_identity_arguments(p.oid), E'\n      | ') as sigs
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname like 'ops\_%'
       -- `citext` is installed **into** `ops_core` (0001, so its operators are
       -- visible to functions that pin their search_path), and an extension
       -- overloads on purpose: `regexp_replace(citext, citext, text, text)`
       -- beside the three-argument form is the feature working. This rule is
       -- about seams we wrote, so anything a `create extension` owns is not
       -- ours to judge.
       and not exists (
         select 1 from pg_depend d
          where d.objid = p.oid and d.classid = 'pg_proc'::regclass
            and d.deptype = 'e')
     group by n.nspname, p.proname
    having count(*) > 1
     order by 1, 2
  loop
    v_found := v_found || format(E'\n  %s.%s has %s signatures:\n      | %s',
                                 r.schema, r.name, r.n, r.sigs);
  end loop;

  assert v_found = '', format(
    E'a seam has more than one signature, so PostgREST cannot call it:%s\n\n'
    'Drop the superseded one in the migration that added the new one.', v_found);
end $$;

rollback;
