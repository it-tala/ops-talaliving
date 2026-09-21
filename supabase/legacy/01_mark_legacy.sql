-- 01_mark_legacy.sql — say, in the database itself, which half is being retired.
--
-- ── Why this is not a migration ──────────────────────────────────────────
--
-- It names `public`, `core`, `hr`, `ops` and `po_import`, and
-- `check_schema_isolation.sh` refuses any migration that does. That refusal is
-- the whole reason both systems can share one project, so this lives outside
-- the ladder — `rebuild.sh` still replays from nothing with no legacy database
-- present.
--
-- ── Why a comment and not a rename ───────────────────────────────────────
--
-- The obvious way to archive a schema is `alter schema ops rename to
-- legacy_ops`. It is also the way to take the business down at 9am: `john-lau`
-- is still running, still receiving Google Chat events, and still the system of
-- record for 3.235 transactions. A rename breaks every one of its queries the
-- instant it commits, and nothing in this repository would even notice.
--
-- So the mark is metadata. `COMMENT ON` changes no row, no plan, no permission
-- and no name; it cannot break a running query. What it does is answer the
-- question somebody opens the table browser to ask — *is this one still real?*
-- — at the moment they ask it, rather than in a document they have not read.
--
-- The rename belongs after cutover, and `README.md` beside this file carries
-- the order it has to happen in.
--
-- ── Idempotent, and it never destroys what is already written ────────────
--
-- 35 of the 158 legacy objects already carry a comment, some of them the only
-- explanation of a column anybody wrote down. Overwriting those to say "this is
-- old" would trade a fact for a label. The original is kept, after the marker,
-- and an object already marked is skipped — so running this twice changes
-- nothing and running it after the legacy system gains a table marks only the
-- new one.

\set ON_ERROR_STOP on

begin;

do $mark$
declare
  r        record;
  marker   constant text := '[LEGACY john-lau]';
  banner   constant text :=
    marker || ' Retired by ops-talaliving; the replacement lives in the ops_* schemas. '
           || 'Read it for reconciliation, do not build on it, and write nothing new here. '
           || 'See supabase/legacy/README.md and ops_core.legacy_map.';
  existing text;
  n_marked int := 0;
  n_kept   int := 0;
begin
  -- The schemas themselves first: a person browsing sees the schema before any
  -- table in it, and that is the cheapest place to stop somebody.
  for r in
    select oid, nspname from pg_namespace
     where nspname in ('public','core','hr','ops','po_import')
     order by nspname
  loop
    existing := obj_description(r.oid, 'pg_namespace');
    if existing is not null and left(existing, length(marker)) = marker then
      continue;
    end if;
    execute format('comment on schema %I is %L', r.nspname,
      banner || coalesce(' — original note: ' || existing, ''));
    n_marked := n_marked + 1;
  end loop;

  -- Then every table, view and matview in them. Driven off the catalogue rather
  -- than a list, so a table the legacy system adds next week is marked by the
  -- next run instead of being quietly missed.
  for r in
    select c.oid, n.nspname, c.relname, c.relkind
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname in ('public','core','hr','ops','po_import')
       and c.relkind in ('r','p','v','m')
     order by n.nspname, c.relname
  loop
    existing := obj_description(r.oid, 'pg_class');
    if existing is not null and left(existing, length(marker)) = marker then
      n_kept := n_kept + 1;
      continue;
    end if;
    execute format('comment on %s %I.%I is %L',
      case r.relkind
        when 'v' then 'view'
        when 'm' then 'materialized view'
        else 'table'
      end,
      r.nspname, r.relname,
      banner || coalesce(' — original note: ' || existing, ''));
    n_marked := n_marked + 1;
  end loop;

  raise notice 'marked % object(s); % already carried the marker', n_marked, n_kept;
end
$mark$;

commit;

\echo ''
\echo '── legacy objects, and how many now carry the marker ───────────────'
select n.nspname as schema,
       count(*) as objects,
       count(*) filter (
         where left(coalesce(obj_description(c.oid,'pg_class'),''), 17) = '[LEGACY john-lau]'
       ) as marked
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname in ('public','core','hr','ops','po_import')
   and c.relkind in ('r','p','v','m')
 group by n.nspname
 order by n.nspname;
