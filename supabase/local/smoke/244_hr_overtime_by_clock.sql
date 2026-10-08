-- 244_hr_overtime_by_clock.sql — lembur dibayar menurut jam (0244, D396).
--
-- The owner's example, RIAN 21/09: taps 07.51 and 22.44, office schedule to
-- 17.15, overtime break 17.30–18.30, 1,5× until 22.00 and 2× after, rounded
-- to 15 minutes. Expected:
--   17.15–17.30  0,25 × 1,5 × 34.375 =  12.891
--   18.30–22.00  3,5  × 1,5 × 34.375 = 180.469
--   22.00–22.44  0,75 × 2   × 34.375 =  51.563
-- and the statutory ladder still climbs by the clock when that is the rule.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-000000024401','hrd244@talaliving.com','{"full_name":"HRD"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-000000024401','payroll','admin'),
  ('ffffffff-0000-0000-0000-000000024401','hrd','admin');

insert into ops_hr.pay_rule_sets (version, effective_from, note, rules, created_by) values
 (1, '2026-08-01', 'uji D396', '{
   "week_pattern":"5day","late_grace_minutes":15,"late_mode":"manual","undertime_mode":"off",
   "day_reading":"in_out","hours_rounding_minutes":15,
   "overtime_mode":"statutory","workday_tiers":[{"after_hours":0,"multiplier":1.5}],
   "restday_tiers":[{"after_hours":0,"multiplier":2}],
   "overtime_night_after_minutes":1320,"overtime_night_multiplier":2,
   "overtime_break_from_minutes":1050,"overtime_break_to_minutes":1110,
   "overtime_rounding_minutes":15,
   "hourly_basis":"company","hourly_includes_allowance":true,"effective_days_per_year":240,
   "schedules":[{"code":"KANTOR","name":"Kantor","start_minutes":480,"end_minutes":1035,
                 "break_minutes":60,"note":null}],
   "schedule_by_unit":{"Kantor":"KANTOR","Workshop":"KANTOR"}
 }'::jsonb, 'ffffffff-0000-0000-0000-000000024401');

-- (3.850.000 + 1.650.000) × 12 ÷ 240 ÷ 8 = 34.375 an hour.
insert into ops_hr.employees
  (id, employee_no, full_name, position, unit, pay_basis, base_rate, allowance_rate,
   daily_hours, joined_on, active, paid_leave_days)
values
  ('aaaa2440-0000-0000-0000-000000000001','K-2441','Rian','Admin','Kantor','monthly', 3850000, 1650000, 8, '2025-01-01', true, 12),
  ('aaaa2440-0000-0000-0000-000000000002','K-2442','Tanpa tap','Admin','Kantor','monthly', 3850000, 1650000, 8, '2025-01-01', true, 12);
insert into ops_hr.attendance_exemptions (employee_id, reason, "by")
values ('aaaa2440-0000-0000-0000-000000000001','uji: hari lain tanpa tap','ffffffff-0000-0000-0000-000000024401');

insert into ops_hr.attendance_scans (employee_id, work_date, at, source, reason, recorded_by)
select 'aaaa2440-0000-0000-0000-000000000001', '2026-09-21', ('2026-09-21'::date + t) at time zone 'Asia/Jakarta',
       'manual','uji 244','ffffffff-0000-0000-0000-000000024401'
  from (values (time '07:51'), (time '22:44')) v(t);

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000024401';

do $$
declare a jsonb; l ops_hr.payroll_figures; n int; v_sum bigint;
begin
  /* the evening the machine saw */
  assert (select from_minutes from ops_hr.day_overtime_window('aaaa2440-0000-0000-0000-000000000001','2026-09-21')) = 1035,
    'starts at the schedule''s end';
  assert (select until_minutes from ops_hr.day_overtime_window('aaaa2440-0000-0000-0000-000000000001','2026-09-21')) = 1364,
    'ends at the last tap';

  /* what approving would pay */
  select count(*), sum(amount) into n, v_sum from ops_hr.overtime_preview('K-2441','2026-09-21');
  assert n = 3 and v_sum = 244923, format('three ranges, Rp 244.923 — got %s, %s', n, v_sum);

  /* approved with no times: the clock's defaults */
  a := ops_hr.approve_day_overtime('K-2441', '2026-09-21', null, 'LOADING CONTAINER STD 4');
  assert ops_core.said_ok(a), a::text;
  assert (a -> 'data' ->> 'hours')::numeric = 4.5, '4,5 jam, not 5,5: ' || a::text;

  l := ops_hr.payroll_line_for('aaaa2440-0000-0000-0000-000000000001','2026-09-01','2026-09-30');
  assert l.overtime_hours = 4.5, 'hours ' || l.overtime_hours;
  assert l.overtime_pay = 244923, 'pay ' || l.overtime_pay;
  assert (select string_agg(p ->> 'label' || ' ' || (p ->> 'hours') || ' ' || (p ->> 'multiplier'), '; '
                              order by p ->> 'label')
            from jsonb_array_elements(l.overtime_parts) p)
         = '17.15–17.30 0.25 1.5; 18.30–22.00 3.50 1.5; 22.00–22.44 0.75 2',
    'the ranges: ' || l.overtime_parts::text;

  /* a day with no taps needs the times typed */
  a := ops_hr.approve_day_overtime('K-2442', '2026-09-22', null, 'x');
  assert a -> 'error' ->> 'code' = 'time_required', a::text;
  a := ops_hr.approve_day_overtime('K-2442', '2026-09-22', null, 'Kirim barang', null, 1035, 1140);
  assert ops_core.said_ok(a) and (a -> 'data' ->> 'hours')::numeric = 0.75, 'typed: 17.15–19.00 less the break = 0,75 — ' || a::text;
end $$;

/* the statutory ladder, by the clock, when that is the rule */
do $$
begin
  assert (select string_agg(ops_hr.clock_face(seg_from) || '-' || ops_hr.clock_face(seg_until) || ' ' || multiplier, '; ')
            from ops_hr.ot_segments('{"workday_tiers":[{"after_hours":0,"multiplier":1.5},{"after_hours":1,"multiplier":2}],
                                     "overtime_break_from_minutes":1050,"overtime_break_to_minutes":1110}'::jsonb,
                                    false, 1035, 1364))
         = '17.15-17.30 1.5; 18.30-19.15 1.5; 19.15-22.44 2', 'the ladder climbs across the break';
  -- Past midnight, the night rate holds.
  assert (select sum(hours) from ops_hr.ot_segments('{"workday_tiers":[{"after_hours":0,"multiplier":1.5}],
            "overtime_night_after_minutes":1320,"overtime_night_multiplier":2}'::jsonb, false, 1260, 60)) = 4,
    '21.00–01.00 is four hours';
end $$;

rollback;
