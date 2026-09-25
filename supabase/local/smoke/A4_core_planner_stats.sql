-- core — the planner has numbers for every table in the ladder.
--
-- ── The bug this is the guard for ────────────────────────────────────────
--
-- `pg_class.reltuples = -1` does not mean "no rows". It means **nobody has ever
-- looked**, and the planner then substitutes a default guess. On production,
-- 2026-09-24, that was true of 94 of 115 `ops_*` tables, 34 of them holding
-- rows, and it was costing a money screen HTTP 500:
--
--   ops_acct.cash_settlements    guessed 550    actually 3
--   ops_acct.cash_components     guessed 190    actually 8
--
-- Believing a 3-row table holds 550 makes a hash join over every one of 3,221
-- transactions look cheaper than three index probes. One join, cost 121.59 → 6.41
-- after `analyze`.
--
-- ── Why it has to be a guard and not just `0156` ─────────────────────────
--
-- Autoanalyze fires at `50 + 10% × reltuples` modifications. A lookup table
-- somebody edits twice a year never reaches fifty, so **the small tables are
-- exactly the ones autovacuum cannot help** — and exactly the ones whose
-- misestimates flip a plan. Nothing in Postgres will ever fix this on its own,
-- and `0156` fixes only the tables that existed when it ran.
--
-- So the rule is stated here instead: a migration that creates a table ends by
-- analysing it. One line, `analyze ops_x.the_table;`, and this file names the
-- table if it is forgotten. That is cheaper than finding out from a 500.
--
-- Read as: the ladder leaves no table the planner has to guess about.

begin;

do $$
declare
  blind text;
  n     int;
begin
  select count(*), string_agg(sig, E'\n  ' order by sig)
    into n, blind
    from (
      select c.oid::regclass::text || ' (' || c.reltuples::bigint || ')' as sig
        from pg_class c
        join pg_namespace ns on ns.oid = c.relnamespace
       where ns.nspname like 'ops\_%'
         and c.relkind in ('r', 'p')
         and not exists (select 1 from pg_depend d
                          where d.objid = c.oid and d.deptype = 'e')
         and c.reltuples = -1
    ) x;

  assert n = 0,
    n || ' table(s) in ops_* have never been analysed, so the planner is guessing '
    || 'their size:' || E'\n  ' || coalesce(blind, '') || E'\n'
    || 'Autovacuum will not reach them — a small lookup table never accumulates the '
    || '50 modifications that trigger autoanalyze. End the migration that creates a '
    || 'table with `analyze ops_x.the_table;` (0156 did this for the ladder as it '
    || 'stood). A 3-row table the planner thinks holds 550 is how a nested loop '
    || 'becomes a hash join over the whole ledger.';
end $$;

rollback;
