-- 0154 — every permission check in a policy runs once per query, not once
--        per row.
--
-- ── what was slow ─────────────────────────────────────────────────────────
--
-- The payment calendar took 4–5 s to open. `cash_plan()` itself needs about
-- 0.3 s as the table owner; as a signed-in accountant it needed 3.9 s. The
-- difference was entirely row-level security.
--
-- Every policy in the `ops_*` schemas is written the plain way:
--
--     using (ops_core.has_permission('accounting.read'))
--
-- Postgres can hoist a constant call like that into a one-time filter, and on
-- a bare `select … from transactions` it does. But under a join, an index
-- scan or an aggregate — which is where a view puts it — the call stays a
-- **per-row filter**: `v_account_balance` checked `has_permission` 3,274
-- times, once per ledger row, at ~30 µs each. `cash_plan()` asks the ledger
-- a few dozen times inside its loop, and 3,274 × a few dozen is the 3.6 s.
--
-- Written as a scalar subquery the same call is planned as an InitPlan and
-- runs once per statement:
--
--     using ((select ops_core.has_permission('accounting.read')))
--
-- This is Supabase's own advice (the `auth_rls_initplan` advisor), and the
-- answer is unchanged: none of these calls read a column of the row, so
-- evaluating them once or 3,274 times gives the same value every time.
--
-- ── what this touches ─────────────────────────────────────────────────────
--
-- Every policy in an `ops_*` schema, rewritten in place with `alter policy`,
-- and only these calls — each takes no argument from the row:
--
--     ops_core.has_permission('<literal>')
--     ops_core.has_authority('<literal>')
--     auth.uid()
--     ops_dlv.can_read()
--     ops_hr.my_employee_id()
--
-- A call already inside `(select …)` is left alone. Nothing about who can see
-- or write what changes; only when the question is asked.
--
-- Done by reading `pg_policies` rather than by restating ~180 policies, so it
-- rewrites whatever the ladder has built, and running it twice is a no-op.
-- A policy created **after** this in the plain form is slow again — write new
-- ones as `(select ops_core.has_permission('…'))`.

do $$
declare
  p record;
  v_pattern constant text :=
    '(?<!SELECT )('
    || 'ops_core\.has_permission\(''[^'']*''::[a-z_.]+\)'
    || '|ops_core\.has_authority\(''[^'']*''::[a-z_.]+\)'
    || '|auth\.uid\(\)'
    || '|ops_dlv\.can_read\(\)'
    || '|ops_hr\.my_employee_id\(\)'
    || ')';
  v_qual text;
  v_check text;
  v_n int := 0;
begin
  for p in
    select schemaname, tablename, policyname, qual, with_check
      from pg_policies
     where schemaname like 'ops\_%'
  loop
    v_qual  := regexp_replace(p.qual,       v_pattern, '(SELECT \1)', 'g');
    v_check := regexp_replace(p.with_check, v_pattern, '(SELECT \1)', 'g');

    if v_qual is distinct from p.qual then
      execute format('alter policy %I on %I.%I using (%s)',
                     p.policyname, p.schemaname, p.tablename, v_qual);
    end if;
    if v_check is distinct from p.with_check then
      execute format('alter policy %I on %I.%I with check (%s)',
                     p.policyname, p.schemaname, p.tablename, v_check);
    end if;
    if v_qual is distinct from p.qual or v_check is distinct from p.with_check then
      v_n := v_n + 1;
    end if;
  end loop;

  raise notice '0154: % policies now ask once per query', v_n;
end $$;
