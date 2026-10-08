-- 215_hr_allowance_monthly.sql — a monthly allowance is a month (0230, D386).
--
--   • HR types pokok and tunjangan a month, as agreed; a month with nothing
--     marked pays exactly both;
--   • a day of the allowance is the month over that month's working days, and
--     an alpa or a withheld day costs that, no more;
--   • the hour is (pokok + tunjangan) × 12 over the year's days and the day's
--     hours, and BPJS is measured on pokok + tunjangan;
--   • a day wage's allowance is still a day;
--   • the form's preview says the same figures before anything is saved.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-000000021501','hr215@talaliving.com','{"full_name":"HR"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-000000021501','payroll','admin'),
  ('ffffffff-0000-0000-0000-000000021501','hrd','admin');

insert into ops_hr.pay_rule_sets (version, effective_from, note, rules, created_by) values
 (1, '2026-08-01', 'uji D386', '{
   "week_pattern":"5day","late_grace_minutes":15,"late_mode":"manual","undertime_mode":"off",
   "day_reading":"in_out","hours_rounding_minutes":15,
   "overtime_mode":"tiered","workday_tiers":[{"after_hours":0,"multiplier":1.5}],
   "restday_tiers":[{"after_hours":0,"multiplier":2}],
   "hourly_basis":"company","hourly_includes_allowance":true,
   "effective_days_per_year":240,
   "schedules":[{"code":"KANTOR","name":"Kantor","start_minutes":480,"end_minutes":1020,
                 "break_minutes":60,"note":null}],
   "schedule_by_unit":{"Kantor":"KANTOR","Workshop":"KANTOR"}
 }'::jsonb, 'ffffffff-0000-0000-0000-000000021501');

-- ADZKIA's terms as HR typed them: 3.150.000 + 1.350.000 = 4.500.000 a month.
insert into ops_hr.employees
  (id, employee_no, full_name, position, unit, pay_basis, base_rate, allowance_rate,
   daily_hours, joined_on, active, paid_leave_days)
values
  ('aaaa2150-0000-0000-0000-000000000001','K-2151','Bulanan','IT','Kantor',
   'monthly', 3150000, 1350000, 8, '2025-01-01', true, 12),
  ('aaaa2150-0000-0000-0000-000000000002','B-2152','Harian','Helper','Workshop',
   'daily', 70000, 30000, 8, '2025-01-01', true, 0);

-- 0242 (D394): these salaries have no taps and are paid the month, which
-- since D394 is somebody exempt from attendance (F72's rule, kept for them).
insert into ops_hr.attendance_exemptions (employee_id, reason, "by")
select e.id, 'uji: tanpa tap, dibayar sebulan', 'ffffffff-0000-0000-0000-000000021501'
  from ops_hr.employees e where e.pay_basis = 'monthly';

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000021501';

/* ── DERIVATION: a whole month pays the month ───────────────────────────── */
do $$
declare p ops_hr.payroll_figures;
begin
  -- September 2026 has 22 working days Monday–Friday.
  assert ops_hr.month_workdays(ops_hr.rules_on('2026-09-01'),
           ops_hr.schedule_of(ops_hr.rules_on('2026-09-01'), null, 'Kantor'), '2026-09-15') = 22,
    'twenty-two working days in September';
  select * into p from ops_hr.payroll_line_for('aaaa2150-0000-0000-0000-000000000001','2026-09-01','2026-09-30');
  assert p.base_pay = 3150000, 'pokok, got ' || p.base_pay;
  assert p.allowance_pay = 1350000, 'the month''s allowance, not 22 of it, got ' || p.allowance_pay;
  assert p.allowance_days = 22, 'paid over 22 days, got ' || p.allowance_days;
  assert p.allowance_daily = 61364, '1.350.000 ÷ 22, got ' || p.allowance_daily;
  assert p.daily_rate = 143182, '3.150.000 ÷ 22, got ' || p.daily_rate;
  assert p.hourly = 28125, '4.500.000 × 12 ÷ 240 ÷ 8, got ' || p.hourly;
end $$;

/* ── DERIVATION: an alpa and a withheld day each cost a day ─────────────── */
do $$
declare p ops_hr.payroll_figures; a jsonb;
begin
  insert into ops_hr.day_marks (work_date, employee_id, kind, reason, marked_by)
  values ('2026-09-15','aaaa2150-0000-0000-0000-000000000001','absent','Tidak masuk (uji)',
          'ffffffff-0000-0000-0000-000000021501');
  a := ops_hr.withhold_allowance('K-2151','2026-09-16','uji potong tunjangan');
  assert ops_core.said_ok(a), a::text;

  select * into p from ops_hr.payroll_line_for('aaaa2150-0000-0000-0000-000000000001','2026-09-01','2026-09-30');
  assert p.allowance_days = 20, 'two days fewer, got ' || p.allowance_days;
  assert p.allowance_pay = 1227273, '1.350.000 × 20 ÷ 22, got ' || p.allowance_pay;
  assert p.allowance_withheld_amount = 61364, 'the withheld day, priced, got ' || p.allowance_withheld_amount;
  assert (select amount from ops_hr.v_allowance_withholding where employee_no = 'K-2151') = 61364,
    'and the list prices it the same way';
end $$;

/* ── DERIVATION: a day wage's allowance is still a day ───────────────────── */
do $$
declare p ops_hr.payroll_figures;
begin
  insert into ops_hr.attendance_scans (employee_id, work_date, at, verify, source, reason)
  select 'aaaa2150-0000-0000-0000-000000000002', ops_core.office_day(t), t, 'FP', 'manual', 'uji D386'
    from (values ('2026-09-28 07:55'::timestamp), ('2026-09-28 17:05'),
                 ('2026-09-29 07:55'), ('2026-09-29 17:05')) x(ts)
    cross join lateral (select x.ts at time zone ops_core.office_tz() as t) y;
  select * into p from ops_hr.payroll_line_for('aaaa2150-0000-0000-0000-000000000002','2026-09-28','2026-09-29');
  assert p.allowance_pay = 60000, '30.000 × 2 days, got ' || p.allowance_pay;
  assert p.allowance_daily = 30000, 'a day is a day, got ' || p.allowance_daily;
end $$;

/* ── DERIVATION: BPJS on pokok + tunjangan, and the form's preview ──────── */
do $$
declare e ops_hr.employees; v record;
begin
  select * into e from ops_hr.employees where employee_no = 'K-2151';
  assert ops_hr.contribution_base(e, '2026-09-01') = 4500000,
    'pokok + tunjangan a month, got ' || ops_hr.contribution_base(e, '2026-09-01');

  select * into v from ops_hr.pay_preview('monthly', 3150000, 1350000, 8, null, 'Kantor', '2026-09-10');
  assert v.workdays = 22 and v.daily_rate = 143182 and v.allowance_daily = 61364
     and v.hourly = 28125 and v.monthly_total = 4500000,
    'the preview is payroll''s own arithmetic: ' || row_to_json(v)::text;

  select * into v from ops_hr.pay_preview('daily', 70000, 30000, 8, null, 'Workshop', '2026-09-10');
  assert v.daily_rate = 70000 and v.allowance_daily = 30000 and v.monthly_total = 2200000,
    'a day wage over a 22-day month: ' || row_to_json(v)::text;
end $$;

rollback;
