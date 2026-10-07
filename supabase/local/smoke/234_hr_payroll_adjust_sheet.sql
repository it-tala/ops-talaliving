-- 234_hr_payroll_adjust_sheet.sql — bonus, retensi and lain-lain typed on the
-- sheet; retensi's balance is HRD's (0234, D388).
--
--   • generating with `p_adjust` writes the run and its adjustments together,
--     and the line shows them in its two columns;
--   • retensi only takes, a release only gives back and never more than held;
--   • one bad adjustment undoes the whole run; so does one for somebody the
--     run does not pay;
--   • the balance and the standing are refused to an employee's own account.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-000000023401','payroll234@talaliving.com','{"full_name":"Payroll"}'),
  ('ffffffff-0000-0000-0000-000000023402','pekerja234@talaliving.com','{"full_name":"Pekerja"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-000000023401','payroll','admin'),
  ('ffffffff-0000-0000-0000-000000023401','hrd','admin');

insert into ops_hr.pay_rule_sets (version, effective_from, note, rules, created_by) values
 (1, '2026-08-01', 'uji D388', '{
   "week_pattern":"5day","late_grace_minutes":15,"late_mode":"manual","undertime_mode":"off",
   "day_reading":"in_out","hours_rounding_minutes":15,
   "overtime_mode":"tiered","workday_tiers":[{"after_hours":0,"multiplier":1.5}],
   "restday_tiers":[{"after_hours":0,"multiplier":2}],
   "hourly_basis":"company","hourly_includes_allowance":true,"effective_days_per_year":240,
   "schedules":[{"code":"KANTOR","name":"Kantor","start_minutes":480,"end_minutes":1020,
                 "break_minutes":60,"note":null}],
   "schedule_by_unit":{"Kantor":"KANTOR"}
 }'::jsonb, 'ffffffff-0000-0000-0000-000000023401');

insert into ops_hr.employees
  (id, employee_no, full_name, position, unit, pay_basis, base_rate, allowance_rate,
   daily_hours, joined_on, active, paid_leave_days)
values
  ('aaaa2340-0000-0000-0000-000000000001','K-2341','Staf satu','Admin','Kantor',
   'monthly', 3150000, 1350000, 8, '2025-01-01', true, 12),
  ('aaaa2340-0000-0000-0000-000000000002','K-2342','Staf dua','Admin','Kantor',
   'monthly', 3000000, 0, 8, '2025-01-01', true, 12);

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000023401';

/* ── REFUSAL: a bad adjustment, or one for somebody held, undoes the run ── */
do $$
declare a jsonb;
begin
  a := ops_hr.generate_payroll('2026-09-01','2026-09-30','monthly', '[]', null, null,
         '[{"employee_no":"K-2341","kind":"retention","amount":500000,"reason":"retensi"}]');
  assert a -> 'error' ->> 'code' = 'retention_is_deduction', 'retensi only takes: ' || a::text;
  assert not exists (select 1 from ops_hr.payroll_runs), 'and the run went with it';

  a := ops_hr.generate_payroll('2026-09-01','2026-09-30','monthly',
         '[{"employee_no":"K-2342","note":"bulan depan"}]', null, null,
         '[{"employee_no":"K-2342","kind":"bonus","amount":100000,"reason":"x"}]');
  assert a -> 'error' ->> 'code' = 'adjust_not_on_run', 'not for somebody held: ' || a::text;
  assert not exists (select 1 from ops_hr.payroll_runs), 'nothing opened';

  a := ops_hr.generate_payroll('2026-09-01','2026-09-30','monthly', '[]', null, null,
         '[{"employee_no":"K-2341","kind":"tip","amount":1,"reason":"x"}]');
  assert a -> 'error' ->> 'code' = 'adjust_invalid', 'a kind nobody knows: ' || a::text;

  a := ops_hr.generate_payroll('2026-09-01','2026-09-30','monthly', '[]', null, null,
         '[{"employee_no":"K-2341","kind":"bonus","amount":100000,"reason":""}]');
  assert a -> 'error' ->> 'code' = 'reason_required', 'the sentence is printed: ' || a::text;
end $$;

/* ── DERIVATION: generated together, read in the two columns ───────────── */
do $$
declare a jsonb; v_no text; p ops_hr.payroll_figures;
begin
  a := ops_hr.generate_payroll('2026-09-01','2026-09-30','monthly', '[]', null, 'k-234', '[
    {"employee_no":"K-2341","kind":"bonus","amount":250000,"reason":"Target tercapai"},
    {"employee_no":"K-2341","kind":"other","amount":100000,"reason":"Uang transport proyek"},
    {"employee_no":"K-2341","kind":"retention","amount":-500000,"reason":"Retensi kontrak"},
    {"employee_no":"K-2341","kind":"other","amount":-50000,"reason":"Seragam"}]');
  assert ops_core.said_ok(a), a::text;
  assert (a -> 'data' ->> 'adjustments')::int = 4, a::text;
  v_no := a -> 'data' ->> 'run_no';

  select * into p from ops_hr.run_lines(v_no) where employee_no = 'K-2341';
  assert p.additions_total = 3150000 + 1350000 + 250000 + 100000, 'additions, got ' || p.additions_total;
  assert p.deductions_total = 500000 + 50000, 'deductions, got ' || p.deductions_total;
  assert p.take_home = 4850000 - 550000, 'take-home, got ' || p.take_home;
  assert jsonb_array_length(p.adjustments) = 4, 'each with its sentence';

  -- a retry is the same run
  a := ops_hr.generate_payroll('2026-09-01','2026-09-30','monthly', '[]', null, 'k-234', '[]');
  assert a -> 'data' ->> 'run_no' = v_no, 'idempotent';

  /* ── the balance: a draft's retensi is on its way, not yet held ── */
  assert (select in_draft from ops_hr.retention_balances('K-2341')) = 500000, 'in a draft';
  assert (select balance from ops_hr.retention_balances('K-2341')) = 0, 'nothing signed yet';

  /* ── a release never exceeds what is held ── */
  a := ops_hr.add_adjustment(v_no, 'K-2341', 'retention_release', 600000, 'kembali');
  assert a -> 'error' ->> 'code' = 'release_exceeds_balance', a::text;
  a := ops_hr.add_adjustment(v_no, 'K-2341', 'retention_release', -100000, 'kembali');
  assert a -> 'error' ->> 'code' = 'release_is_addition', a::text;
  a := ops_hr.add_adjustment(v_no, 'K-2341', 'retention_release', 200000, 'Sebagian dikembalikan');
  assert ops_core.said_ok(a), a::text;
  assert (select in_draft from ops_hr.retention_balances('K-2341')) = 300000, 'net of the release';

  /* ── HRD's view of one person ── */
  assert (select retention_in_draft from ops_hr.employee_standing('K-2341','2026-09-01','2026-09-30')) = 300000,
    'standing carries the retensi';
  assert (select days_present from ops_hr.employee_standing('K-2341','2026-09-01','2026-09-30')) is not null,
    'and the period''s attendance';
end $$;

/* ── REFUSAL: the employee's own account is told nothing ───────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000023402';
do $$
begin
  assert not exists (select 1 from ops_hr.retention_balances()), 'no balance for a worker';
  assert not exists (select 1 from ops_hr.employee_standing('K-2341','2026-09-01','2026-09-30')),
    'no standing for a worker';
end $$;

rollback;
