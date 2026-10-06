-- 213_hr_payroll_sheet.sql — payroll generated as a sheet (0213, D371).
--
--   • each day of a line carries its own lateness;
--   • a line carries a day's rate for each pay basis, what the alpa took from
--     a salary, and the sheet's two columns, whose difference is take_home;
--   • the header sums them;
--   • `paid_elsewhere` names the run that already pays somebody;
--   • `generate_payroll` holds the unticked with a sentence, all or nothing;
--     the held person is paid by a second run of the same group over the same
--     week, and nobody is paid twice;
--   • a read grant generates nothing.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-000000021301','payroll213@talaliving.com','{"full_name":"Payroll"}'),
  ('ffffffff-0000-0000-0000-000000021302','baca213@talaliving.com','{"full_name":"Pembaca"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-000000021301','payroll','admin'),
  ('ffffffff-0000-0000-0000-000000021301','hrd','admin'),
  ('ffffffff-0000-0000-0000-000000021302','payroll','read');

insert into ops_hr.pay_rule_sets (version, effective_from, note, rules, created_by) values
 (1, '2026-08-01', 'uji D371', '{
   "week_pattern":"5day","late_grace_minutes":15,"late_mode":"manual","undertime_mode":"off",
   "day_reading":"in_out","hours_rounding_minutes":15,
   "overtime_mode":"tiered","workday_tiers":[{"after_hours":0,"multiplier":1.5}],
   "restday_tiers":[{"after_hours":0,"multiplier":2}],
   "overtime_exact_hourly":true,"hourly_includes_allowance":false,
   "effective_days_per_year":240,
   "schedules":[
     {"code":"KANTOR","name":"Kantor","start_minutes":480,"end_minutes":1020,
      "break_minutes":60,"note":null}],
   "schedule_by_unit":{"Kantor":"KANTOR","Workshop":"KANTOR"}
 }'::jsonb, 'ffffffff-0000-0000-0000-000000021301');

insert into ops_hr.employees
  (id, employee_no, full_name, position, unit, pay_basis, base_rate, allowance_rate,
   daily_hours, joined_on, left_on, active, paid_leave_days)
values
  ('aaaa2130-0000-0000-0000-000000000001','K-2131','Bulanan alpa','Admin','Kantor',
   'monthly', 2200000, 0, 8, '2025-01-01', null, true, 12),
  ('aaaa2130-0000-0000-0000-000000000002','B-2132','Harian telat','Tukang','Workshop',
   'daily', 100000, 10000, 8, '2025-01-01', null, true, 0),
  ('aaaa2130-0000-0000-0000-000000000003','B-2133','Harian ditahan','Tukang','Workshop',
   'daily', 120000, 0, 8, '2025-01-01', null, true, 0),
  ('aaaa2130-0000-0000-0000-000000000004','J-2134','Per jam','Helper','Workshop',
   'hourly', 15000, 0, 8, '2025-01-01', null, true, 0);

insert into ops_hr.day_marks (work_date, employee_id, kind, reason, marked_by)
values ('2026-09-15','aaaa2130-0000-0000-0000-000000000001','absent','Tidak masuk (uji)',
        'ffffffff-0000-0000-0000-000000021301');

-- Monday 28 September: B-2132 in at 08.40 (25 minutes past the grace), out 17.05.
-- Tuesday 29: on time. B-2133 both days on time.
insert into ops_hr.attendance_scans (employee_id, work_date, at, verify, source, reason)
select e.id, ops_core.office_day(t), t, 'FP', 'manual', 'uji D371'
  from (values ('aaaa2130-0000-0000-0000-000000000002'::uuid, '2026-09-28 08:40'::timestamp),
               ('aaaa2130-0000-0000-0000-000000000002', '2026-09-28 17:05'),
               ('aaaa2130-0000-0000-0000-000000000002', '2026-09-29 07:55'),
               ('aaaa2130-0000-0000-0000-000000000002', '2026-09-29 17:05'),
               ('aaaa2130-0000-0000-0000-000000000003', '2026-09-28 07:55'),
               ('aaaa2130-0000-0000-0000-000000000003', '2026-09-28 17:05'),
               ('aaaa2130-0000-0000-0000-000000000003', '2026-09-29 07:55'),
               ('aaaa2130-0000-0000-0000-000000000003', '2026-09-29 17:05')) e(id, ts)
  cross join lateral (select e.ts at time zone ops_core.office_tz() as t) x;

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000021301';

/* ── DERIVATION: the line ──────────────────────────────────────────────── */
do $$
declare p ops_hr.payroll_figures; mon jsonb;
begin
  select * into p from ops_hr.payroll_line_for('aaaa2130-0000-0000-0000-000000000002','2026-09-28','2026-09-30');
  select x into mon from jsonb_array_elements(p.days) x where x ->> 'work_date' = '2026-09-28';
  assert (mon ->> 'late_minutes')::int = 25, 'Monday late on its own line: ' || mon::text;
  assert (select (x ->> 'late_minutes')::int from jsonb_array_elements(p.days) x
           where x ->> 'work_date' = '2026-09-29') = 0, 'Tuesday on time';
  assert p.late_minutes = 25, 'and the total agrees, got ' || p.late_minutes;
  assert p.daily_rate = 100000, 'a day wage is its own day rate, got ' || p.daily_rate;
  assert p.additions_total = p.base_pay + p.allowance_pay + p.overtime_pay,
    'additions with no adjustment: ' || p.additions_total;
  assert p.take_home = p.additions_total - p.deductions_total,
    'take_home is additions less deductions';

  select * into p from ops_hr.payroll_line_for('aaaa2130-0000-0000-0000-000000000001','2026-09-01','2026-09-30');
  assert p.daily_rate = 100000, '2.200.000 over 22 working days, got ' || p.daily_rate;
  assert p.absence_deduction = 100000, 'one alpa, got ' || p.absence_deduction;
  assert p.base_pay = 2100000, 'and it is inside the pokok, got ' || p.base_pay;
  assert p.deductions_total = 0, 'not taken a second time, got ' || p.deductions_total;

  select * into p from ops_hr.payroll_line_for('aaaa2130-0000-0000-0000-000000000004','2026-09-28','2026-09-30');
  assert p.daily_rate = 120000, '15.000 an hour over an 8-hour day, got ' || p.daily_rate;
end $$;

/* ── DERIVATION: a hand-typed addition and deduction land in their columns ── */
do $$
declare a jsonb; v_no text; p ops_hr.payroll_figures; t ops_hr.payroll_totals_t;
begin
  a := ops_hr.generate_payroll('2026-09-01','2026-09-30','monthly');
  assert ops_core.said_ok(a), 'monthly: ' || a::text;
  v_no := a -> 'data' ->> 'run_no';
  a := ops_hr.add_adjustment(v_no, 'K-2131', 'bonus', 250000, 'Target tercapai');
  assert ops_core.said_ok(a), a::text;
  a := ops_hr.add_adjustment(v_no, 'K-2131', 'advance', -50000, 'Kasbon');
  assert ops_core.said_ok(a), a::text;
  select * into p from ops_hr.run_lines(v_no) where employee_no = 'K-2131';
  assert p.additions_total = 2100000 + 250000, 'pokok + bonus, got ' || p.additions_total;
  assert p.deductions_total = 50000, 'kasbon, got ' || p.deductions_total;
  assert p.take_home = 2300000, 'got ' || p.take_home;
  select * into t from ops_hr.payroll_totals('2026-09-01','2026-09-30', v_no);
  assert t.additions_total = 2350000 and t.deductions_total = 50000 and t.take_home_total = 2300000,
    'the header sums the sheet: ' || row_to_json(t)::text;
end $$;

/* ── REFUSAL and DERIVATION: generating with people held ───────────────── */
do $$
declare a jsonb; v_first text; v_second text; n int;
begin
  a := ops_hr.generate_payroll('2026-09-28','2026-10-02','weekly',
         '[{"employee_no":"B-2133"}]');
  assert a -> 'error' ->> 'code' = 'reason_required', 'a hold needs its sentence: ' || a::text;
  assert not exists (select 1 from ops_hr.payroll_runs where pay_group = 'weekly'),
    'and nothing was opened';

  a := ops_hr.generate_payroll('2026-09-28','2026-10-02','weekly',
         '[{"employee_no":"B-2132","note":"x"},{"employee_no":"B-2133","note":"x"},{"employee_no":"J-2134","note":"x"}]');
  assert a -> 'error' ->> 'code' = 'nobody_selected', 'everybody held is no run: ' || a::text;
  assert not exists (select 1 from ops_hr.payroll_runs where pay_group = 'weekly'),
    'and the run it opened was undone';

  a := ops_hr.generate_payroll('2026-09-28','2026-10-02','weekly',
         '[{"employee_no":"B-2133","note":"Rekening belum ada"}]', 'Minggu 40', 'k-213-gen');
  assert ops_core.said_ok(a), a::text;
  v_first := a -> 'data' ->> 'run_no';
  assert (a -> 'data' ->> 'members')::int = 2 and (a -> 'data' ->> 'held')::int = 1, a::text;
  assert not exists (select 1 from ops_hr.run_lines(v_first) where employee_no = 'B-2133'),
    'held is off the lines';
  assert (select note from ops_hr.run_members(v_first) where employee_no = 'B-2133') = 'Rekening belum ada',
    'with its sentence';
  a := ops_hr.generate_payroll('2026-09-28','2026-10-02','weekly',
         '[{"employee_no":"B-2133","note":"Rekening belum ada"}]', 'Minggu 40', 'k-213-gen');
  assert a ->> 'outcome' = 'duplicate' and a -> 'data' ->> 'run_no' = v_first, 'a retry is one run';

  assert (select run_no from ops_hr.paid_elsewhere('2026-09-28','2026-10-02') where employee_no = 'B-2132') = v_first,
    'the sheet can name who pays B-2132';
  assert not exists (select 1 from ops_hr.paid_elsewhere('2026-09-28','2026-10-02') where employee_no = 'B-2133'),
    'and that nobody pays B-2133 yet';

  -- The held one, the same week, the same group: a second run that pays only him.
  a := ops_hr.generate_payroll('2026-09-28','2026-10-02','weekly');
  assert ops_core.said_ok(a), 'the rest later: ' || a::text;
  v_second := a -> 'data' ->> 'run_no';
  select count(*) into n from ops_hr.run_lines(v_second);
  assert n = 1 and (select employee_no from ops_hr.run_lines(v_second)) = 'B-2133',
    'only the one nobody pays yet';

  -- And once everybody is paid, a third is the overlap, named.
  a := ops_hr.generate_payroll('2026-09-28','2026-10-02','weekly');
  assert a -> 'error' ->> 'code' = 'period_overlaps', a::text;
  assert a -> 'error' ->> 'message' like '%' || v_first || '%', 'names the run: ' || a::text;
end $$;

/* ── REFUSAL: a read grant generates nothing ───────────────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000021302';
do $$
declare a jsonb;
begin
  a := ops_hr.generate_payroll('2026-11-02','2026-11-06','weekly');
  assert a -> 'error' ->> 'code' = 'not_permitted', a::text;
end $$;

rollback;
