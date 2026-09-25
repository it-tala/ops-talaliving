-- 0156_core_analyze.sql — give the planner the numbers it has never had.
--
-- ── Ninety-four tables the planner was guessing about ────────────────────
--
-- Measured on production, 2026-09-24: **94 of 115 `ops_*` tables had
-- `reltuples = -1`** — never analysed, not once, since the ladder created them.
-- Thirty-four of those held rows. `-1` is not "zero rows", it is *"nobody has
-- ever looked"*, and the planner then substitutes a default guess.
--
-- The guesses are not close:
--
--   ops_acct.cash_settlements    planner thought 550    actually 3
--   ops_acct.cash_components     planner thought 190    actually 8
--
-- ── What that costs, measured rather than assumed ────────────────────────
--
-- The same three-table join, before and after `analyze`:
--
--   BEFORE  Hash Right Join  (cost=36.93..121.59 rows=550)
--             Hash Cond: (s.component_id = c.id)
--             -> Index Only Scan on transactions  (rows=3221)   ← all of it
--             -> Seq Scan on cash_settlements     (rows=550)
--
--   AFTER   Hash Right Join  (cost=1.46..6.41 rows=8)
--             -> Nested Loop Left Join  (rows=3)
--                  -> Seq Scan on cash_settlements  (rows=3)
--                  -> Index Only Scan on transactions (rows=1)  ← three probes
--
-- Believing a 3-row table has 550 rows makes a hash join over **every one of
-- 3,221 transactions** look cheaper than three index probes. Cost 121.59 → 6.41,
-- about nineteen times, on one join out of several that `ops_acct.cash_plan()`
-- performs.
--
-- ── Why autovacuum was never going to do this ────────────────────────────
--
-- Autoanalyze fires when modifications since the last analyse exceed
-- `autovacuum_analyze_threshold + autovacuum_analyze_scale_factor × reltuples`
-- — 50 + 10% by default. An eight-row table of cash components that somebody
-- edits twice a year will not reach fifty modifications in this decade. **The
-- small tables are precisely the ones autovacuum cannot help**, and they are
-- also the ones whose misestimates flip a join from a nested loop to a hash of
-- the largest table in the schema.
--
-- `ops_acct.transactions` had statistics, because 3,274 rows arriving got it
-- past the threshold on its own. Every lookup table beside it did not. That is
-- the shape of this bug: it hides in exactly the tables nobody worries about.
--
-- ── What this fixes and what it does not ─────────────────────────────────
--
-- This is one `analyze` over the schemas, and it is cheap — these are small
-- tables and the big one is already covered. It is not a substitute for
-- autovacuum on tables that grow; those reach the threshold by themselves.
--
-- It also cannot fix the future on its own, which is why
-- `supabase/local/smoke/A4_core_planner_stats.sql` asserts the property instead
-- of trusting this file. A migration that creates a table after this one must
-- analyse it, and the guard names it if it does not.
--
-- ── The honest note about how this was found ─────────────────────────────
--
-- Looking for something else. `/accounting/tagihan` was answering HTTP 500 on
-- `rpc/cash_plan` (`57014`, statement timeout at 8s), and the first explanation
-- written down was that RLS makes the projection eighteen times slower for a
-- signed-in reader. That was wrong, and it was wrong in the most ordinary way:
-- a cold first call as `authenticated` was compared against a warm second call
-- as the owner. Measured properly, same session, alternating: 193–248ms as
-- `postgres`, 256–298ms as `authenticated`. **RLS costs about a quarter, not
-- eighteen times.** The nineteen was real and it was this — the planner, not
-- the policy.

do $$
declare
  rel     text;
  n       int := 0;
  started timestamptz := clock_timestamp();
begin
  for rel in
    select c.oid::regclass::text
      from pg_class c
      join pg_namespace ns on ns.oid = c.relnamespace
     where ns.nspname like 'ops\_%'
       and c.relkind in ('r', 'p')          -- tables and partitioned parents
       and not exists (select 1 from pg_depend d
                        where d.objid = c.oid and d.deptype = 'e')
     order by 1
  loop
    execute format('analyze %s', rel);
    n := n + 1;
  end loop;

  raise notice 'analysed % table(s) in ops_* in %',
    n, clock_timestamp() - started;
end $$;
