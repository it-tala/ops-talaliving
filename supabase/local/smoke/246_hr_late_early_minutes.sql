-- 246_hr_late_early_minutes.sql — hadir sehari penuh; terlambat dan pulang
-- cepat dipotong per menit (0246, D398).
--
--   • a day present is a whole day, whatever its hours;
--   • the hour is (pokok + tunjangan) ÷ 160 — the rule book's 8 hours a day,
--     not the person's own 12;
--   • late and early minutes, no tolerance, priced per minute of that hour;
--   • *istirahat tidak dipotong* keeps the overtime break and a rest day's
--     lunch; a rest day's overtime loses the lunch after four hours;
--   • a tap HRD typed can be voided (moved out, with why); the machine's not.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-000000024601','hrd246@talaliving.com','{"full_name":"HRD"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-000000024601','payroll','admin'),
  ('ffffffff-0000-0000-0000-000000024601','hrd','admin');

-- Office 08.00–17.15 with an hour's break. 22 working days in September.
insert into ops_hr.pay_rule_sets (version, effective_from, note, rules, created_by) values
 (1, '2026-08-01', 'uji D398', '{
   "week_pattern":"5day","late_grace_minutes":0,"late_mode":"pro_rata","early_leave_mode":"pro_rata",
   "undertime_mode":"off","day_reading":"in_out","hours_rounding_minutes":15,
   "overtime_mode":"statutory","workday_tiers":[{"after_hours":0,"multiplier":1.5}],
   "restday_tiers":[{"after_hours":0,"multiplier":2}],
   "overtime_night_after_minutes":1320,"overtime_night_multiplier":2,
   "overtime_break_from_minutes":1050,"overtime_break_to_minutes":1110,
   "overtime_rounding_minutes":15,
   "hourly_basis":"company","hourly_includes_allowance":true,"effective_days_per_year":240,
   "hourly_day_hours":8,
   "schedules":[{"code":"KANTOR","name":"Kantor","start_minutes":480,"end_minutes":1035,
                 "break_minutes":60,"note":null}],
   "schedule_by_unit":{"Kantor":"KANTOR","Workshop":"KANTOR"}
 }'::jsonb, 'ffffffff-0000-0000-0000-000000024601');

-- (2.200.000 + 2.200.000) ÷ 160 = 27.500 an hour, though her own day says 12.
insert into ops_hr.employees
  (id, employee_no, full_name, position, unit, pay_basis, base_rate, allowance_rate,
   daily_hours, joined_on, active, paid_leave_days)
values
  ('aaaa2460-0000-0000-0000-000000000001','K-2461','Dewi','HRD','Kantor','monthly', 2200000, 2200000, 12, '2025-01-01', true, 12),
  ('aaaa2460-0000-0000-0000-000000000002','B-2462','Harian','Tukang','Workshop','daily', 160000, 0, 8, '2025-01-01', true, 0);
insert into ops_hr.attendance_exemptions (employee_id, reason, "by")
values ('aaaa2460-0000-0000-0000-000000000001','uji: hari lain tanpa tap','ffffffff-0000-0000-0000-000000024601');

insert into ops_hr.attendance_scans (employee_id, work_date, at, source, reason, recorded_by)
select e, d, (d + t) at time zone ops_core.office_tz(), 'manual','uji 246','ffffffff-0000-0000-0000-000000024601'
  from (values
    ('aaaa2460-0000-0000-0000-000000000001'::uuid, '2026-09-16'::date, time '08:00'),
    ('aaaa2460-0000-0000-0000-000000000001', '2026-09-16', time '12:00'),   -- pulang 5 jam 15 menit lebih awal
    ('aaaa2460-0000-0000-0000-000000000001', '2026-09-17', time '08:07'),   -- telat 7 menit
    ('aaaa2460-0000-0000-0000-000000000001', '2026-09-17', time '17:15'),
    ('aaaa2460-0000-0000-0000-000000000002', '2026-09-17', time '08:00'),
    ('aaaa2460-0000-0000-0000-000000000002', '2026-09-17', time '14:00')) v(e, d, t);

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000024601';

do $$
declare a jsonb; l ops_hr.payroll_figures; v_scan uuid;
begin
  assert (ops_hr.hourly_rate((select e from ops_hr.employees e where employee_no = 'K-2461'),
                             ops_hr.rules_on('2026-09-01'))).hourly = 27500, 'the hour is ÷ 160';

  /* a day present is a whole day */
  l := ops_hr.payroll_line_for('aaaa2460-0000-0000-0000-000000000001','2026-09-01','2026-09-30');
  assert l.base_pay = 2200000 and l.allowance_pay = 2200000, format('the month whole: %s / %s', l.base_pay, l.allowance_pay);
  /* late and early by the minute, no tolerance */
  assert l.late_minutes = 7 and l.late_deduction = 3208, format('late %s → %s', l.late_minutes, l.late_deduction);
  assert l.early_minutes = 315 and l.early_days = 1 and l.early_deduction = 144375,
    format('early %s / %s days → %s', l.early_minutes, l.early_days, l.early_deduction);
  assert l.deductions_total >= 3208 + 144375, 'both in Pengurangan';
  assert l.gross = 4400000 - 3208 - 144375, 'and out of the gross, got ' || l.gross;
  assert (select (x ->> 'early_minutes')::int from jsonb_array_elements(l.days) x where x ->> 'work_date' = '2026-09-16') = 315,
    'the day says so';

  /* a day wage: the whole day, less 3 hours 15 minutes at 20.000 */
  l := ops_hr.payroll_line_for('aaaa2460-0000-0000-0000-000000000002','2026-09-17','2026-09-17');
  assert l.base_pay = 160000 and l.early_minutes = 195 and l.early_deduction = 65000,
    format('day wage %s, early %s → %s', l.base_pay, l.early_minutes, l.early_deduction);

  /* the break kept: the day shows it, overtime keeps its breaks */
  a := ops_hr.keep_break('K-2461', '2026-09-16', true, '');
  assert a -> 'error' ->> 'code' = 'reason_required', a::text;
  a := ops_hr.keep_break('K-2461', '2026-09-16', true, 'Pulang sebelum istirahat');
  assert ops_core.said_ok(a), a::text;
  l := ops_hr.payroll_line_for('aaaa2460-0000-0000-0000-000000000001','2026-09-01','2026-09-30');
  assert (select (x ->> 'work_hours')::numeric from jsonb_array_elements(l.days) x where x ->> 'work_date' = '2026-09-16') = 4,
    '16/09 now 4 jam';
  assert (select (x ->> 'break_kept')::boolean from jsonb_array_elements(l.days) x where x ->> 'work_date' = '2026-09-16'),
    'the day says so';
  a := ops_hr.keep_break('K-2461', '2026-09-16', true, 'lagi');
  assert a -> 'error' ->> 'code' = 'already_kept', a::text;

  assert (select sum(hours) from ops_hr.ot_segments(ops_hr.ot_rules_for(ops_hr.rules_on('2026-09-18'),
            'aaaa2460-0000-0000-0000-000000000001', '2026-09-18'), false, 1035, 1200)) = 1.75,
    '17.15–20.00 less the overtime break';
  a := ops_hr.keep_break('K-2461', '2026-09-18', true, 'Lembur tanpa istirahat');
  assert (select sum(hours) from ops_hr.ot_segments(ops_hr.ot_rules_for(ops_hr.rules_on('2026-09-18'),
            'aaaa2460-0000-0000-0000-000000000001', '2026-09-18'), false, 1035, 1200)) = 2.75,
    'kept: the whole evening';
  assert (select sum(hours) from ops_hr.ot_segments(ops_hr.ot_rules_for(ops_hr.rules_on('2026-09-19'),
            'aaaa2460-0000-0000-0000-000000000001', '2026-09-19'), true, 480, 960)) = 7,
    'Sabtu 08.00–16.00 less lunch';
  a := ops_hr.keep_break('K-2461', '2026-09-19', true, 'Kerja terus');
  assert (select sum(hours) from ops_hr.ot_segments(ops_hr.ot_rules_for(ops_hr.rules_on('2026-09-19'),
            'aaaa2460-0000-0000-0000-000000000001', '2026-09-19'), true, 480, 960)) = 8,
    'kept: 8 jam';
  a := ops_hr.keep_break('K-2461', '2026-09-19', false, 'Salah centang');
  assert ops_core.said_ok(a), a::text;

  /* a tap HRD typed wrong */
  select id into v_scan from ops_hr.attendance_scans
   where employee_id = 'aaaa2460-0000-0000-0000-000000000001' and work_date = '2026-09-16'
     and at = ('2026-09-16'::date + time '12:00') at time zone ops_core.office_tz();
  assert (select count(*) from ops_hr.person_day_extras('K-2461','2026-09-16','2026-09-16') where kind = 'manual_scan') = 2,
    'the drawer lists the typed taps';
  a := ops_hr.void_scan(v_scan, '');
  assert a -> 'error' ->> 'code' = 'reason_required', a::text;
  a := ops_hr.void_scan(v_scan, 'Salah ketik, pulang 16.00');
  assert ops_core.said_ok(a), a::text;
  assert not exists (select 1 from ops_hr.attendance_scans where id = v_scan), 'out of the record';
  assert (select void_reason from ops_hr.voided_scans where id = v_scan) = 'Salah ketik, pulang 16.00', 'kept with why';
  assert (select state from ops_hr.read_day('aaaa2460-0000-0000-0000-000000000001','2026-09-16')) = 'review',
    'one tap left: the day is read again';
end $$;

/* the machine's taps are not HRD's to remove */
do $$
declare a jsonb; v_id uuid;
begin
  reset role;
  insert into ops_hr.attendance_imports (id, filename, imported_by)
  values ('bbbb2460-0000-0000-0000-000000000001','m.csv','ffffffff-0000-0000-0000-000000024601');
  insert into ops_hr.attendance_scans (employee_id, work_date, at, source, import_id)
  values ('aaaa2460-0000-0000-0000-000000000001','2026-09-18', ('2026-09-18'::date + time '08:00') at time zone ops_core.office_tz(),
          'import','bbbb2460-0000-0000-0000-000000000001')
  returning id into v_id;
  set local role authenticated;
  a := ops_hr.void_scan(v_id, 'coba');
  assert a -> 'error' ->> 'code' = 'not_manual', a::text;
end $$;

rollback;
