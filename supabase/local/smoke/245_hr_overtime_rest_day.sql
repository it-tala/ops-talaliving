-- 245_hr_overtime_rest_day.sql — lembur hari libur (0245, D397).
--
-- PUTRI's Saturdays: 12/09 08.00–16.00 and 19/09 09.19–14.17, office
-- pattern whose Saturday is not `off` but a five-day rule book. Overtime
-- starts at the first tap and the rest-day ladder pays 2× for hours 1–8.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-000000024501','hrd245@talaliving.com','{"full_name":"HRD"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-000000024501','payroll','admin'),
  ('ffffffff-0000-0000-0000-000000024501','hrd','admin');

insert into ops_hr.pay_rule_sets (version, effective_from, note, rules, created_by) values
 (1, '2026-08-01', 'uji D397', '{
   "week_pattern":"5day","late_grace_minutes":15,"late_mode":"manual","undertime_mode":"off",
   "day_reading":"in_out","hours_rounding_minutes":15,
   "overtime_mode":"statutory","workday_tiers":[{"after_hours":0,"multiplier":1.5}],
   "restday_tiers":[{"after_hours":0,"multiplier":2},{"after_hours":8,"multiplier":3},{"after_hours":9,"multiplier":4}],
   "overtime_night_after_minutes":1320,"overtime_night_multiplier":2,
   "overtime_break_from_minutes":1050,"overtime_break_to_minutes":1110,
   "overtime_rounding_minutes":15,
   "hourly_basis":"company","hourly_includes_allowance":true,"effective_days_per_year":240,
   "schedules":[{"code":"KANTOR","name":"Kantor","start_minutes":480,"end_minutes":1035,
                 "break_minutes":60,"note":null}],
   "schedule_by_unit":{"Kantor":"KANTOR","Workshop":"KANTOR"}
 }'::jsonb, 'ffffffff-0000-0000-0000-000000024501');

-- (2.250.000 + 750.000) × 12 ÷ 240 ÷ 8 = 18.750 an hour.
insert into ops_hr.employees
  (id, employee_no, full_name, position, unit, pay_basis, base_rate, allowance_rate,
   daily_hours, joined_on, active, paid_leave_days)
values
  ('aaaa2450-0000-0000-0000-000000000001','K-2451','Putri','Accounting','Kantor','monthly', 2250000, 750000, 8, '2025-01-01', true, 12);
insert into ops_hr.attendance_exemptions (employee_id, reason, "by")
values ('aaaa2450-0000-0000-0000-000000000001','uji: hari lain tanpa tap','ffffffff-0000-0000-0000-000000024501');

insert into ops_hr.attendance_scans (employee_id, work_date, at, source, reason, recorded_by)
select 'aaaa2450-0000-0000-0000-000000000001', d, (d + t) at time zone 'Asia/Jakarta',
       'manual','uji 245','ffffffff-0000-0000-0000-000000024501'
  from (values ('2026-09-12'::date, time '08:00'), ('2026-09-12', time '16:00'),
               ('2026-09-19', time '09:19'), ('2026-09-19', time '14:17')) v(d, t);

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000024501';

do $$
declare a jsonb; l ops_hr.payroll_figures; w record;
begin
  select * into w from ops_hr.day_overtime_window('aaaa2450-0000-0000-0000-000000000001', '2026-09-12');
  assert w.from_minutes = 480 and w.until_minutes = 960, format('a Saturday from the first tap, got %s–%s', w.from_minutes, w.until_minutes);

  -- 0246 (D398): less the pattern's lunch after four hours — 7 jam.
  assert (select sum(amount) from ops_hr.overtime_preview('K-2451','2026-09-12')) = 262500, '7 jam × 2 × 18.750';

  a := ops_hr.approve_day_overtime('K-2451', '2026-09-12', null, 'Tutup buku');
  assert ops_core.said_ok(a) and (a -> 'data' ->> 'hours')::numeric = 7, a::text;
  a := ops_hr.approve_day_overtime('K-2451', '2026-09-19', null, 'Tutup buku');
  assert ops_core.said_ok(a) and (a -> 'data' ->> 'hours')::numeric = 4, '09.19–14.17 less lunch from 13.19 = 4 jam: ' || a::text;

  l := ops_hr.payroll_line_for('aaaa2450-0000-0000-0000-000000000001','2026-09-01','2026-09-30');
  assert l.overtime_pay = 262500 + 150000, 'both Saturdays at 2×, got ' || l.overtime_pay;

  /* a finish before the start in the afternoon is no overtime, not a night */
  assert not exists (select 1 from ops_hr.ot_segments('{"workday_tiers":[{"after_hours":0,"multiplier":1.5}]}'::jsonb, false, 1035, 960)),
    '17.15 → 16.00 is nothing';
  assert (select sum(hours) from ops_hr.ot_segments('{"workday_tiers":[{"after_hours":0,"multiplier":1.5}]}'::jsonb, false, 1260, 60)) = 4,
    '21.00 → 01.00 is still a night';
end $$;

rollback;
