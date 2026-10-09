-- 253_hr_daily_deductions_attendance.sql — a day wage's monthly deductions
-- and *tidak wajib absensi* (0253, D410).
--
--   • a day wage owes a monthly deduction only when HRD wrote one for them —
--     the defaults stay the salaries' — once, in the period holding the
--     month's last day;
--   • a day wage exempt from attendance is paid each working day of their
--     pattern with no tap and no mark as a whole day (rate and allowance),
--     never late, early or short on it; a mark still wins;
--   • a day wage who is not exempt is paid the days they tapped, as before.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-000000025301','hrd253@talaliving.com','{"full_name":"HRD"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-000000025301','payroll','admin'),
  ('ffffffff-0000-0000-0000-000000025301','hrd','admin');

insert into ops_hr.pay_rule_sets (version, effective_from, note, rules, created_by) values
 (1, '2026-08-01', 'uji D410', '{
   "week_pattern":"5day","late_grace_minutes":15,"late_mode":"manual","undertime_mode":"off",
   "day_reading":"in_out","hours_rounding_minutes":15,
   "overtime_mode":"tiered","workday_tiers":[{"after_hours":0,"multiplier":1.5}],
   "restday_tiers":[{"after_hours":0,"multiplier":2}],
   "hourly_basis":"company","hourly_includes_allowance":true,"effective_days_per_year":240,
   "schedules":[{"code":"KANTOR","name":"Kantor","start_minutes":480,"end_minutes":1020,
                 "break_minutes":60,"note":null}],
   "schedule_by_unit":{"Kantor":"KANTOR","Workshop":"KANTOR"}
 }'::jsonb, 'ffffffff-0000-0000-0000-000000025301');

-- September 2026: 22 working days Monday–Friday.
insert into ops_hr.employees
  (id, employee_no, full_name, position, unit, pay_basis, base_rate, allowance_rate,
   daily_hours, joined_on, active, paid_leave_days)
values
  ('aaaa2530-0000-0000-0000-000000000001','B-2531','Mandor','Mandor','Workshop','daily', 100000, 20000, 8, '2025-01-01', true, 0),
  ('aaaa2530-0000-0000-0000-000000000002','B-2532','Tukang','Tukang','Workshop','daily', 100000, 20000, 8, '2025-01-01', true, 0),
  ('aaaa2530-0000-0000-0000-000000000003','K-2533','Admin','Admin','Kantor','monthly', 2200000, 0, 8, '2025-01-01', true, 12);

-- Both day wages tap the first nine working days of September (1–4, 7–11).
insert into ops_hr.attendance_scans (employee_id, work_date, at, source, reason, recorded_by)
select e.id, g::date, (g::date + t) at time zone 'Asia/Jakarta',
       'manual','uji 253','ffffffff-0000-0000-0000-000000025301'
  from (values ('aaaa2530-0000-0000-0000-000000000001'::uuid),
               ('aaaa2530-0000-0000-0000-000000000002'::uuid)) e(id)
 cross join generate_series('2026-09-01'::date, '2026-09-11'::date, interval '1 day') g
 cross join (values (time '07:55'), (time '17:05')) v(t)
 where extract(isodow from g) < 6;

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000025301';

do $$
declare a jsonb; l ops_hr.payroll_figures; n int;
begin
  /* ── potongan per bulan ── */
  assert not exists (select 1 from ops_hr.deduction_defaults_for('2026-09-01','2026-09-30')
           where employee_no like 'B-253%'), 'a day wage owes no default';
  assert (select amount from ops_hr.deduction_defaults_for('2026-09-01','2026-09-30')
           where employee_no = 'K-2533' and kind = 'retention') = 500000, 'the salary keeps its default';

  a := ops_hr.set_employee_deduction('B-2531', 'retention', 100000);
  assert ops_core.said_ok(a), a::text;
  a := ops_hr.set_employee_deduction('B-2531', 'bpjs_tk', 0);
  assert ops_core.said_ok(a), a::text;

  assert (select amount from ops_hr.deduction_defaults_for('2026-09-01','2026-09-30')
           where employee_no = 'B-2531' and kind = 'retention') = 100000, 'the person''s own amount';
  assert (select source from ops_hr.deduction_defaults_for('2026-09-01','2026-09-30')
           where employee_no = 'B-2531' and kind = 'retention') = 'person', 'said as the person''s';
  select count(*) into n from ops_hr.deduction_defaults_for('2026-09-01','2026-09-30')
   where employee_no = 'B-2531';
  assert n = 1, 'zero is no line, and no default fills the others; got ' || n;
  -- The pay week that holds 30 September takes it; the week before does not.
  assert exists (select 1 from ops_hr.deduction_defaults_for('2026-09-24','2026-09-30')
           where employee_no = 'B-2531'), 'the week with the month''s last day';
  assert not exists (select 1 from ops_hr.deduction_defaults_for('2026-09-17','2026-09-23')
           where employee_no = 'B-2531'), 'not the week before';

  /* ── tidak wajib absensi ── */
  l := ops_hr.payroll_line_for('aaaa2530-0000-0000-0000-000000000001','2026-09-01','2026-09-30');
  assert l.worked_days = 9 and l.base_pay = 900000, 'before: the tapped days, got ' || l.worked_days;

  a := ops_hr.set_attendance_exempt('B-2531', true, 'Mandor lapangan — tidak absen di mesin');
  assert ops_core.said_ok(a), a::text;

  l := ops_hr.payroll_line_for('aaaa2530-0000-0000-0000-000000000001','2026-09-01','2026-09-30');
  assert l.attendance_exempt, 'the line says so';
  assert l.worked_days = 22, 'every working day, got ' || l.worked_days;
  assert l.base_pay = 2200000, '22 days of 100.000, got ' || l.base_pay;
  assert l.allowance_days = 22 and l.allowance_pay = 440000, 'and the allowance, got ' || l.allowance_pay;
  assert l.days_present = 22, 'present 22, got ' || l.days_present;
  assert l.late_minutes = 0 and l.open_days = 0, 'nothing late, nothing open';
  assert (select count(*) from jsonb_array_elements(l.days) d
           where (d ->> 'day_value')::numeric = 1 and d ->> 'in_at' is null) = 13,
    'thirteen untapped days paid whole';
  assert not exists (select 1 from jsonb_array_elements(l.days) d
           where extract(isodow from (d ->> 'work_date')::date) > 5 and (d ->> 'day_value')::numeric > 0),
    'never a weekend';

  -- A mark still wins: alpa on the 21st is unpaid.
  insert into ops_hr.day_marks (work_date, employee_id, kind, reason, marked_by)
  values ('2026-09-21', 'aaaa2530-0000-0000-0000-000000000001', 'absent', 'tidak datang',
          'ffffffff-0000-0000-0000-000000025301');
  l := ops_hr.payroll_line_for('aaaa2530-0000-0000-0000-000000000001','2026-09-01','2026-09-30');
  assert l.worked_days = 21 and l.base_pay = 2100000, 'alpa is alpa, got ' || l.worked_days;

  -- Never a day still to come.
  l := ops_hr.payroll_line_for('aaaa2530-0000-0000-0000-000000000001',
         ops_core.office_day() + 1, ops_core.office_day() + 14);
  assert l.worked_days = 0, 'the future is not worked, got ' || l.worked_days;

  /* the other day wage is paid what they tapped, as before */
  l := ops_hr.payroll_line_for('aaaa2530-0000-0000-0000-000000000002','2026-09-01','2026-09-30');
  assert l.worked_days = 9 and l.base_pay = 900000 and not l.attendance_exempt, 'untouched';
end $$;

rollback;
