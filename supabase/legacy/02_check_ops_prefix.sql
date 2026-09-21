-- 02_check_ops_prefix.sql — the same rule as check_schema_isolation.sh, asked
-- of the running database instead of the files.
--
-- ── Why both ─────────────────────────────────────────────────────────────
--
-- `check_schema_isolation.sh` reads `supabase/migrations/*.sql` and refuses any
-- migration that names a legacy schema. It is the right guard and it is not
-- enough, because it can only see what the ladder says. It cannot see a table
-- somebody created in `public` from the SQL editor at 11pm, a function that
-- built its target name inside `execute format(...)`, or a foreign key added by
-- hand. Those are exactly the ways the two halves get tangled, and all three
-- are invisible to a grep over files.
--
-- So this asks the catalogue. Run it after a deploy, after any manual change,
-- and before the rename in `README.md`. It writes nothing.
--
-- ── What counts as a violation ───────────────────────────────────────────
--
-- 1. an unmarked relation outside `ops_*` and outside the schemas Supabase
--    itself owns — something new that did not get the prefix, or a legacy
--    table that `01_mark_legacy.sql` has not been re-run over
-- 2. a foreign key from `ops_*` to anything outside it, except the one that is
--    supposed to exist: `ops_core.users.id → auth.users.id`, which is how a
--    profile is tied to a GoTrue account (0002)
-- 3. a function in `ops_*` naming a legacy schema — the ladder reaching into
--    the old system
-- 4. a function in a legacy schema naming `ops_*` — the old system reaching
--    into ours, which would make the rename after cutover a breaking change
--
-- It raises on the first category that has rows, and names every offender.
-- Exit code alone is not the report: read what it prints.

\set ON_ERROR_STOP on

do $check$
declare
  r     record;
  found text[] := '{}';
begin
  -- 1 · anything outside ops_* that nobody has accounted for
  for r in
    select n.nspname || '.' || c.relname as obj
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where c.relkind in ('r','p','v','m')
       and n.nspname not like 'ops\_%'
       and n.nspname not in ('pg_catalog','information_schema','auth','storage','extensions',
                             'graphql','graphql_public','realtime','vault','cron',
                             'supabase_migrations','pgsodium','pgsodium_masks','net')
       and left(coalesce(obj_description(c.oid,'pg_class'),''), 17) <> '[LEGACY john-lau]'
     order by 1
  loop
    found := found || ('unprefixed and unmarked relation: ' || r.obj);
  end loop;

  -- 2 · ops_* depending on something that is not ops_*
  for r in
    select con.conrelid::regclass::text || ' → ' || con.confrelid::regclass::text as obj
      from pg_constraint con
      join pg_namespace n on n.oid = con.connamespace
     where con.contype = 'f'
       and n.nspname like 'ops\_%'
       and (select x.nspname from pg_namespace x
             join pg_class rc on rc.relnamespace = x.oid
            where rc.oid = con.confrelid) not like 'ops\_%'
       and con.conrelid::regclass::text || ' → ' || con.confrelid::regclass::text
           <> 'ops_core.users → auth.users'
     order by 1
  loop
    found := found || ('foreign key leaves ops_*: ' || r.obj);
  end loop;

  -- 3 · the ladder reaching into the old system
  for r in
    select n.nspname || '.' || p.proname as obj
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname like 'ops\_%'
       and p.prosrc ~* '(^|[^A-Za-z0-9_.])(public|core|hr|po_import)\.[a-z_]'
     order by 1
  loop
    found := found || ('ops_* function names a legacy schema: ' || r.obj);
  end loop;

  -- 4 · the old system reaching into ours
  for r in
    select n.nspname || '.' || p.proname as obj
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public','core','hr','ops','po_import')
       and p.prosrc ~* 'ops_(core|procure|acct|hr|inv|prod)\.'
     order by 1
  loop
    found := found || ('legacy function names ops_*: ' || r.obj);
  end loop;

  if array_length(found, 1) is not null then
    raise exception E'ops_ prefix check failed — % problem(s):\n  %',
      array_length(found, 1), array_to_string(found, E'\n  ');
  end if;

  raise notice 'ops_ prefix                                 ok';
end
$check$;
