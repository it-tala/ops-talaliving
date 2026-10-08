-- 242_hr_presence_confirm.sql — a working day with no tap is checked (0242, D394).
--
--   • a salaried person's past working day with no tap and no mark is open:
--     it holds the line (`open_days`), pays neither the salary's share nor the
--     allowance, and says so;
--   • HRD's *hadir tanpa tap* makes it a paid day again, one day or many;
--     withdrawing it opens it again;
--   • a mark answers it too (alpa: unpaid, not open);
--   • a person exempt from attendance is present on it, as before (F72);
--   • a day still to come is never open; day wages are untouched;
--   • only HRD confirms, exempts, or reads either.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-000000024201','hrd242@talaliving.com','{"full_name":"HRD"}'),
  ('ffffffff-0000-0000-0000-000000024202','pekerja242@talaliving.com','{"full_name":"Pekerja"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-000000024201','payroll','admin'),
  ('ffffffff-0000-0000-0000-000000024201','hrd','admin');

insert into ops_hr.pay_rule_sets (version, effective_from, note, rules, created_by) values
 (1, '2026-08-01', 'uji D394', '{
   "week_pattern":"5day","late_grace_minutes":15,"late_mode":"manual","undertime_mode":"off",
   "day_reading":"in_out","hours_rounding_minutes":15,
   "overtime_mode":"tiered","workday_tiers":[{"after_hours":0,"multiplier":1.5}],
   "restday_tiers":[{"after_hours":0,"multiplier":2}],
   "hourly_basis":"company","hourly_includes_allowance":true,"effective_days_per_year":240,
   "schedules":[{"code":"KANTOR","name":"Kantor","start_minutes":480,"end_minutes":1020,
                 "break_minutes":60,"note":null}],
   "schedule_by_unit":{"Kantor":"KANTOR","Workshop":"KANTOR"}
 }'::jsonb, 'ffffffff-0000-0000-0000-000000024201');

-- September 2026 has 22 working days Monday–Friday: 100.000 a day of each.
insert into ops_hr.employees
  (id, employee_no, full_name, position, unit, pay_basis, base_rate, allowance_rate,
   daily_hours, joined_on, active, paid_leave_days)
values
  ('aaaa2420-0000-0000-0000-000000000001','K-2421','Rian','Admin','Kantor','monthly', 2200000, 2200000, 8, '2025-01-01', true, 12),
  ('aaaa2420-0000-0000-0000-000000000002','K-2422','Evin','Pimpinan','Kantor','monthly', 2200000, 2200000, 8, '2025-01-01', true, 12),
  ('aaaa2420-0000-0000-0000-000000000003','B-2423','Harian','Tukang','Workshop','daily', 100000, 0, 8, '2025-01-01', true, 0);

-- Rian taps in and out on every working day of September but 14, 15 and 16.
insert into ops_hr.attendance_scans (employee_id, work_date, at, source, reason, recorded_by)
select 'aaaa2420-0000-0000-0000-000000000001', g::date,
       (g::date + t) at time zone 'Asia/Jakarta',
       'manual','uji 242','ffffffff-0000-0000-0000-000000024201'
  from generate_series('2026-09-01'::date, '2026-09-30'::date, interval '1 day') g
 cross join (values (time '07:55'), (time '17:05')) v(t)
 where extract(isodow from g) < 6
   and g::date not in ('2026-09-14','2026-09-15','2026-09-16');

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000024201';

do $$
declare a jsonb; l ops_hr.payroll_figures;
begin
  /* three days nobody accounted for */
  l := ops_hr.payroll_line_for('aaaa2420-0000-0000-0000-000000000001','2026-09-01','2026-09-30');
  assert l.days_unconfirmed = 3, 'three days without a tap, got ' || l.days_unconfirmed;
  assert l.open_days = 3, 'they hold the line, got ' || l.open_days;
  assert l.allowance_days = 19, 'allowance for 19 days, got ' || l.allowance_days;
  assert l.allowance_pay = 1900000, 'allowance 1.900.000, got ' || l.allowance_pay;
  assert l.base_pay = 1900000, 'salary for 19 of 22, got ' || l.base_pay;
  assert exists (select 1 from unnest(l.warnings) w where w like '3 hari kerja tanpa tap%'), l.warnings::text;
  assert (select count(*) from jsonb_array_elements(l.days) d where (d ->> 'unconfirmed')::boolean) = 3, 'three days say so';

  /* HRD confirms two of them at once */
  a := ops_hr.confirm_presence('K-2421', array['2026-09-14','2026-09-15']::date[], '');
  assert a -> 'error' ->> 'code' = 'reason_required', a::text;
  a := ops_hr.confirm_presence('K-2421', array[ops_core.office_day() + 1], 'besok');
  assert a -> 'error' ->> 'code' = 'future_date', a::text;
  a := ops_hr.confirm_presence('K-2421', array['2026-09-14','2026-09-15']::date[], 'Mesin mati, hadir menurut atasan');
  assert ops_core.said_ok(a) and (a -> 'data' ->> 'confirmed')::int = 2, a::text;
  a := ops_hr.confirm_presence('K-2421', array['2026-09-14']::date[], 'lagi');
  assert ops_core.said_ok(a) and (a -> 'data' ->> 'confirmed')::int = 0, 'a confirmed day is not confirmed twice';

  /* and marks the third alpa */
  insert into ops_hr.day_marks (work_date, employee_id, kind, reason, marked_by)
  values ('2026-09-16','aaaa2420-0000-0000-0000-000000000001','absent','Tidak masuk','ffffffff-0000-0000-0000-000000024201');

  l := ops_hr.payroll_line_for('aaaa2420-0000-0000-0000-000000000001','2026-09-01','2026-09-30');
  assert l.days_unconfirmed = 0 and l.open_days = 0, 'nothing left open';
  assert l.allowance_days = 21, 'allowance for 21 days, got ' || l.allowance_days;
  assert l.base_pay = 2100000, 'salary for 21 of 22, got ' || l.base_pay;
  assert (select count(*) from jsonb_array_elements(l.days) d where (d ->> 'confirmed')::boolean) = 2, 'two confirmed days say so';

  /* withdrawing opens the day again */
  a := ops_hr.withdraw_presence('K-2421', '2026-09-15', 'salah orang');
  assert ops_core.said_ok(a), a::text;
  a := ops_hr.withdraw_presence('K-2421', '2026-09-15', 'lagi');
  assert a -> 'error' ->> 'code' = 'not_found', a::text;
  l := ops_hr.payroll_line_for('aaaa2420-0000-0000-0000-000000000001','2026-09-01','2026-09-30');
  assert l.days_unconfirmed = 1, 'withdrawn is open again, got ' || l.days_unconfirmed;

  /* a leader who does not tap: open until exempted, then paid the month */
  l := ops_hr.payroll_line_for('aaaa2420-0000-0000-0000-000000000002','2026-09-01','2026-09-30');
  assert l.days_unconfirmed = 22 and not l.attendance_exempt, 'no taps at all: every day open';
  a := ops_hr.set_attendance_exempt('K-2422', true, '');
  assert a -> 'error' ->> 'code' = 'reason_required', a::text;
  a := ops_hr.set_attendance_exempt('K-2422', true, 'Pimpinan — tidak wajib absensi');
  assert ops_core.said_ok(a), a::text;
  a := ops_hr.set_attendance_exempt('K-2422', true, 'lagi');
  assert a -> 'error' ->> 'code' = 'already_exempt', a::text;
  l := ops_hr.payroll_line_for('aaaa2420-0000-0000-0000-000000000002','2026-09-01','2026-09-30');
  assert l.days_unconfirmed = 0 and l.open_days = 0 and l.attendance_exempt, 'exempt: nothing open';
  assert l.base_pay = 2200000 and l.allowance_pay = 2200000, 'exempt: the month, as before';
  assert (select count(*) from ops_hr.attendance_exemptions_list()) = 1, 'HRD sees the list';

  /* ending it holds the days from today on, not September */
  a := ops_hr.set_attendance_exempt('K-2422', false, 'Mulai pakai mesin');
  assert ops_core.said_ok(a), a::text;
  l := ops_hr.payroll_line_for('aaaa2420-0000-0000-0000-000000000002','2026-09-01','2026-09-30');
  assert l.days_unconfirmed = 0, 'September stays as it was read';
  assert not exists (select 1 from ops_hr.attendance_exemptions_list()), 'nobody exempt now';

  /* a day wage never had this: no tap was never paid */
  l := ops_hr.payroll_line_for('aaaa2420-0000-0000-0000-000000000003','2026-09-01','2026-09-30');
  assert l.days_unconfirmed = 0 and l.open_days = 0, 'day wage untouched';

  /* a day still to come is not open */
  l := ops_hr.payroll_line_for('aaaa2420-0000-0000-0000-000000000001',
         ops_core.office_day() + 1, ops_core.office_day() + 14);
  assert l.days_unconfirmed = 0, 'the future is not unconfirmed';
end $$;

/* not HRD: no writes, nothing read */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000024202';
do $$
declare a jsonb;
begin
  a := ops_hr.confirm_presence('K-2421', array['2026-09-16']::date[], 'saya hadir');
  assert a -> 'error' ->> 'code' = 'not_permitted', a::text;
  a := ops_hr.set_attendance_exempt('K-2421', true, 'saya pimpinan');
  assert a -> 'error' ->> 'code' = 'not_permitted', a::text;
  assert not exists (select 1 from ops_hr.presence_confirmations), 'confirmations are HRD''s';
  assert not exists (select 1 from ops_hr.attendance_exemptions), 'exemptions are HRD''s';
end $$;

rollback;
