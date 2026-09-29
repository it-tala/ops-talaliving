-- 0194 — a week's payroll computes each person once, not once per column.
--
-- ── what was wrong ────────────────────────────────────────────────────────
--
-- `/hrd/payroll/minggu` failed on 2026-09-29 with *canceling statement due to
-- statement timeout* (57014). `previewPayroll` reads `period_lines` and then
-- `payroll_totals`, which reads `period_lines` again. In production one call
-- of `period_lines` for 21–27 Sep (45 people) took **24.8 s**; the
-- `authenticated` role's statement timeout is 8 s.
--
-- `payroll_line_for` itself was never slow: called directly, the slowest
-- person was 38 ms and all 45 came to about half a second. The time went into
-- how `period_lines` (0057) calls it:
--
--   cross join lateral (select (ops_hr.payroll_line_for(...)).*) l
--
-- Postgres expands `(f(x)).*` into `(f(x)).col1, (f(x)).col2, …` and
-- evaluates `f` **once for every column**. `payroll_figures` has grown to 47
-- columns (0119 added most of them), so every person's whole payroll —
-- timesheet, overtime rungs, allowance, BPJS — was worked out 47 times.
-- The page got slower with every column the payslip gained, and crossed the
-- timeout without any single change looking like the cause (F195).
--
-- ── the change ────────────────────────────────────────────────────────────
--
-- The function goes in `FROM`, where it is called once per row. Same rows,
-- same order, same columns. The body is otherwise 0057's, word for word. On
-- production data the same week reads in 0.54 s.
--
-- `payroll_totals` and `run_lines` read `period_lines`, so both are fixed by
-- this. `v_kpi_run` (0064) has the same `(kpi(...)).*` shape and is left for
-- its own change: it is a different screen, and nobody has reported it slow.

create or replace function ops_hr.period_lines(
  p_from date, p_to date, p_run_no text default null)
returns setof ops_hr.payroll_figures
language sql stable set search_path = ops_hr, pg_temp as $$
  select l.*
    from ops_hr.employees e
    cross join lateral ops_hr.payroll_line_for(e.id, p_from, p_to, p_run_no) l
   where e.active or e.left_on >= p_from
   order by l.employee_no
$$;

grant execute on function ops_hr.period_lines(date, date, text) to authenticated;
