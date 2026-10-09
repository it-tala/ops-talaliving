-- 252_hr_presence_pay.sql — dibayar per kehadiran (0252, D409).
--
--   • a seven-day period pays a day wage for every day in it somebody came
--     (F251 — it always did);
--   • somebody HRD set *dibayar per kehadiran* is paid a whole day for any
--     tap: one unpaired tap is not held, late and early are not counted;
--   • a day with no tap is still nothing;
--   • a salary is not offered it; on and off need a reason.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-000000025201','hrd252@talaliving.com','{"full_name":"HRD"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-000000025201','payroll','admin'),
  ('ffffffff-0000-0000-0000-000000025201','hrd','admin');

-- Office 08.00–17.15 with an hour's break; late and early by the minute.
insert into ops_hr.pay_rule_sets (version, effective_from, note, rules, created_by) values
 (1, '2026-09-01', 'uji D409', '{
   "week_pattern":"5day","late_grace_minutes":0,"late_mode":"pro_rata","early_leave_mode":"pro_rata",
   "undertime_mode":"off","day_reading":"in_out","hours_rounding_minutes":15,
   "overtime_mode":"statutory","workday_tiers":[{"after_hours":0,"multiplier":1.5}],
   "restday_tiers":[{"after_hours":0,"multiplier":2}],
   "hourly_basis":"company","hourly_includes_allowance":true,"effective_days_per_year":240,
   "hourly_day_hours":8,
   "schedules":[{"code":"KANTOR","name":"Kantor","start_minutes":480,"end_minutes":1035,
                 "break_minutes":60,"note":null}],
   "schedule_by_unit":{"Kantor":"KANTOR","Workshop":"KANTOR"}
 }'::jsonb, 'ffffffff-0000-0000-0000-000000025201');

insert into ops_hr.employees
  (id, employee_no, full_name, position, unit, pay_basis, base_rate, allowance_rate,
   daily_hours, joined_on, active, paid_leave_days)
values
  ('aaaa2520-0000-0000-0000-000000000001','H-2521','Nur','HELPER','Workshop','daily', 70000, 30000, 8, '2026-10-01', true, 0),
  ('aaaa2520-0000-0000-0000-000000000002','H-2522','Tukang','Tukang','Workshop','daily', 100000, 0, 8, '2026-01-01', true, 0),
  ('aaaa2520-0000-0000-0000-000000000003','K-2523','Kantor','Admin','Kantor','monthly', 4000000, 0, 8, '2026-01-01', true, 12);

-- Thursday 1 to Wednesday 7 October: seven days.
insert into ops_hr.attendance_scans (employee_id, work_date, at, source, reason, recorded_by)
select e, d, (d + t) at time zone ops_core.office_tz(), 'manual','uji 252','ffffffff-0000-0000-0000-000000025201'
  from (values
    ('aaaa2520-0000-0000-0000-000000000001'::uuid, '2026-10-01'::date, time '22:28'),  -- one tap, at night
    ('aaaa2520-0000-0000-0000-000000000001', '2026-10-02', time '09:00'),              -- an hour late
    ('aaaa2520-0000-0000-0000-000000000001', '2026-10-02', time '12:00'),              -- and gone at noon
    ('aaaa2520-0000-0000-0000-000000000001', '2026-10-03', time '10:00'),              -- Saturday, one tap
    ('aaaa2520-0000-0000-0000-000000000001', '2026-10-06', time '08:00'),
    ('aaaa2520-0000-0000-0000-000000000001', '2026-10-06', time '17:15'),
    ('aaaa2520-0000-0000-0000-000000000002', '2026-10-01', time '08:00'),
    ('aaaa2520-0000-0000-0000-000000000002', '2026-10-01', time '17:15'),
    ('aaaa2520-0000-0000-0000-000000000002', '2026-10-02', time '08:00'),
    ('aaaa2520-0000-0000-0000-000000000002', '2026-10-02', time '17:15'),
    ('aaaa2520-0000-0000-0000-000000000002', '2026-10-03', time '08:00'),
    ('aaaa2520-0000-0000-0000-000000000002', '2026-10-03', time '17:15'),
    ('aaaa2520-0000-0000-0000-000000000002', '2026-10-06', time '08:00'),
    ('aaaa2520-0000-0000-0000-000000000002', '2026-10-06', time '17:15')) v(e, d, t);

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000025201';

do $$
declare a jsonb; l ops_hr.payroll_figures;
begin
  /* F251: seven days, paid for the four days he came — Saturday too */
  l := ops_hr.payroll_line_for('aaaa2520-0000-0000-0000-000000000002','2026-10-01','2026-10-07');
  assert l.worked_days = 4 and l.base_pay = 400000 and l.gross = 400000,
    format('day wage over seven days: %s days, %s, gross %s', l.worked_days, l.base_pay, l.gross);

  /* before: hours counted, an unpaired tap held */
  l := ops_hr.payroll_line_for('aaaa2520-0000-0000-0000-000000000001','2026-10-01','2026-10-07');
  assert not l.presence_paid, 'not yet';
  assert l.open_days > 0, 'one tap is held until read, got ' || l.open_days;
  -- 22.28, 09.00 and Saturday's 10.00 are all late against 08.00.
  assert l.late_minutes = 868 + 60 + 120 and l.early_deduction > 0, format('late %s, early %s', l.late_minutes, l.early_deduction);

  /* the seam */
  a := ops_hr.set_presence_pay('H-2521', true, ' ');
  assert a -> 'error' ->> 'code' = 'reason_required', a::text;
  a := ops_hr.set_presence_pay('K-2523', true, 'gaji bulanan');
  assert a -> 'error' ->> 'code' = 'monthly', a::text;
  a := ops_hr.set_presence_pay('H-2521', true, 'Household — asal ada bukti hadir', '2026-10-01');
  assert ops_core.said_ok(a), a::text;
  a := ops_hr.set_presence_pay('H-2521', true, 'lagi');
  assert a -> 'error' ->> 'code' = 'already_on', a::text;
  assert (select count(*) from ops_hr.presence_pay_list() where employee_no = 'H-2521') = 1, 'listed';

  /* after: any tap is a whole day, nothing taken for the clock */
  l := ops_hr.payroll_line_for('aaaa2520-0000-0000-0000-000000000001','2026-10-01','2026-10-07');
  assert l.presence_paid, 'the line says so';
  assert l.open_days = 0, 'nothing held, got ' || l.open_days;
  assert l.worked_days = 4 and l.base_pay = 280000 and l.allowance_pay = 120000,
    format('four days: %s, %s + %s', l.worked_days, l.base_pay, l.allowance_pay);
  assert l.late_minutes = 0 and l.late_deduction = 0 and l.early_minutes = 0 and l.early_deduction = 0,
    format('no minutes: late %s/%s early %s/%s', l.late_minutes, l.late_deduction, l.early_minutes, l.early_deduction);
  assert l.gross = 400000, 'gross ' || l.gross;
  assert (select (x ->> 'presence_paid')::boolean and (x ->> 'day_value')::numeric = 1
            from jsonb_array_elements(l.days) x where x ->> 'work_date' = '2026-10-01'),
    'the night tap is a day';
  assert not (select (x ->> 'presence_paid')::boolean
                from jsonb_array_elements(l.days) x where x ->> 'work_date' = '2026-10-05'),
    'no tap, no day';
  assert exists (select 1 from unnest(l.warnings) s where s like '4 hari dibayar per kehadiran%'), l.warnings::text;

  /* off, from today on */
  a := ops_hr.set_presence_pay('H-2521', false, '');
  assert a -> 'error' ->> 'code' = 'reason_required', a::text;
  a := ops_hr.set_presence_pay('H-2521', false, 'Kembali dihitung per jam');
  assert ops_core.said_ok(a), a::text;
  assert (select count(*) from ops_hr.presence_pay_list() where employee_no = 'H-2521') = 0, 'off the list';
  a := ops_hr.set_presence_pay('H-2521', false, 'lagi');
  assert a -> 'error' ->> 'code' = 'not_on', a::text;
end $$;

/* nobody without hrd.update sets it */
do $$
declare a jsonb;
begin
  reset role;
  insert into auth.users (id, email, raw_user_meta_data) values
    ('ffffffff-0000-0000-0000-000000025202','staf252@talaliving.com','{"full_name":"Staf"}');
  set local role authenticated;
  set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000025202';
  a := ops_hr.set_presence_pay('H-2521', true, 'coba');
  assert a -> 'error' ->> 'code' = 'not_permitted', a::text;
  assert (select count(*) from ops_hr.presence_pay_list()) = 0, 'and reads nothing';
end $$;

rollback;
