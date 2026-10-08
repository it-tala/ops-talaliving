-- 243_hr_payroll_day_overtime.sql — lembur disetujui dari payroll (0243, D395).
--
--   • HRD approves a night's overtime with a reason: a checked staff sheet,
--     payable, priced on the ladder, in Penambahan;
--   • never twice for one night: a live line elsewhere (a production sheet
--     still waiting) refuses it;
--   • withdrawing turns it off with the reason, and the night can be approved
--     again;
--   • the drawer reads each night's sheet, stage and reason;
--   • only HRD.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-000000024301','hrd243@talaliving.com','{"full_name":"HRD"}'),
  ('ffffffff-0000-0000-0000-000000024302','pekerja243@talaliving.com','{"full_name":"Pekerja"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-000000024301','payroll','admin'),
  ('ffffffff-0000-0000-0000-000000024301','hrd','admin');

insert into ops_hr.pay_rule_sets (version, effective_from, note, rules, created_by) values
 (1, '2026-08-01', 'uji D395', '{
   "week_pattern":"5day","late_grace_minutes":15,"late_mode":"manual","undertime_mode":"off",
   "day_reading":"in_out","hours_rounding_minutes":15,
   "overtime_mode":"flat","flat_multiplier":1.5,
   "hourly_basis":"company","hourly_includes_allowance":false,"effective_days_per_year":240,
   "schedules":[{"code":"KANTOR","name":"Kantor","start_minutes":480,"end_minutes":1020,
                 "break_minutes":60,"note":null}],
   "schedule_by_unit":{"Kantor":"KANTOR","Workshop":"KANTOR"}
 }'::jsonb, 'ffffffff-0000-0000-0000-000000024301');

-- 160.000 a day, 8 hours: 20.000 an hour, 30.000 an hour of overtime.
insert into ops_hr.employees
  (id, employee_no, full_name, position, unit, pay_basis, base_rate, allowance_rate,
   daily_hours, joined_on, active, paid_leave_days)
values
  ('aaaa2430-0000-0000-0000-000000000001','B-2431','Tukang','Tukang','Workshop','daily', 160000, 0, 8, '2025-01-01', true, 0),
  ('aaaa2430-0000-0000-0000-000000000002','B-2432','Tukang dua','Tukang','Workshop','daily', 160000, 0, 8, '2025-01-01', true, 0);

insert into ops_hr.attendance_scans (employee_id, work_date, at, source, reason, recorded_by)
select e, '2026-09-21', ('2026-09-21'::date + t) at time zone 'Asia/Jakarta',
       'manual','uji 243','ffffffff-0000-0000-0000-000000024301'
  from (values ('aaaa2430-0000-0000-0000-000000000001'::uuid), ('aaaa2430-0000-0000-0000-000000000002'::uuid)) p(e)
 cross join (values (time '07:51'), (time '20:57')) v(t);

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000024301';

do $$
declare a jsonb; l ops_hr.payroll_figures; v_sheet text; v_prod text;
begin
  l := ops_hr.payroll_line_for('aaaa2430-0000-0000-0000-000000000001','2026-09-21','2026-09-21');
  assert l.overtime_pay = 0, 'nothing approved yet';

  a := ops_hr.approve_day_overtime('B-2431', '2026-09-21', 3.75, '');
  assert a -> 'error' ->> 'code' = 'reason_required', a::text;
  a := ops_hr.approve_day_overtime('B-2431', '2026-09-21', 0, 'x');
  assert a -> 'error' ->> 'code' = 'hours_out_of_range', a::text;
  a := ops_hr.approve_day_overtime('B-2431', ops_core.office_day() + 1, 2, 'besok');
  assert a -> 'error' ->> 'code' = 'date_in_future', a::text;

  a := ops_hr.approve_day_overtime('B-2431', '2026-09-21', 3.75, 'Kejar kirim lemari Pak Budi');
  assert ops_core.said_ok(a), a::text;
  v_sheet := a -> 'data' ->> 'sheet_no';
  assert (select stage from ops_hr.v_overtime_stage where sheet_no = v_sheet) = 'paid_checked', 'checked by HRD';

  l := ops_hr.payroll_line_for('aaaa2430-0000-0000-0000-000000000001','2026-09-21','2026-09-21');
  assert l.overtime_hours = 3.75, 'hours on the line, got ' || l.overtime_hours;
  assert l.overtime_pay = 112500, '3,75 × 1,5 × 20.000, got ' || l.overtime_pay;
  assert l.additions_total = l.base_pay + l.allowance_pay + 112500, 'in Penambahan';

  a := ops_hr.approve_day_overtime('B-2431', '2026-09-21', 1, 'lagi');
  assert a -> 'error' ->> 'code' = 'already_claimed', a::text;

  assert (select reason from ops_hr.person_day_overtime('B-2431','2026-09-01','2026-09-30')
           where sheet_no = v_sheet) = 'Kejar kirim lemari Pak Budi', 'the drawer reads the reason';

  /* taken back, then approved again */
  a := ops_hr.withdraw_day_overtime(v_sheet, 'Salah orang');
  assert ops_core.said_ok(a), a::text;
  l := ops_hr.payroll_line_for('aaaa2430-0000-0000-0000-000000000001','2026-09-21','2026-09-21');
  assert l.overtime_pay = 0, 'withdrawn is not paid';
  assert (select stage from ops_hr.person_day_overtime('B-2431','2026-09-01','2026-09-30')
           where sheet_no = v_sheet) = 'unpaid', 'kept, unpaid';
  a := ops_hr.approve_day_overtime('B-2431', '2026-09-21', 2, 'Jam yang benar 2');
  assert ops_core.said_ok(a), a::text;

  /* a production night still waiting for its signatures is decided there */
  a := ops_hr.create_overtime_sheet('production', '2026-09-21', 'Lembur produksi');
  v_prod := a -> 'data' ->> 'sheet_no';
  a := ops_hr.add_overtime_line(v_prod, 'B-2432', 3, 'Rakit');
  assert ops_core.said_ok(a), a::text;
  a := ops_hr.approve_day_overtime('B-2432', '2026-09-21', 3, 'dari payroll');
  assert a -> 'error' ->> 'code' = 'already_claimed', a::text;
  a := ops_hr.withdraw_day_overtime(v_prod, 'bukan');
  assert a -> 'error' ->> 'code' = 'not_hrd_session', a::text;
end $$;

set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000024302';
do $$
declare a jsonb;
begin
  a := ops_hr.approve_day_overtime('B-2432', '2026-09-21', 3, 'saya lembur');
  assert a -> 'error' ->> 'code' = 'not_permitted', a::text;
  assert not exists (select 1 from ops_hr.person_day_overtime('B-2431','2026-09-01','2026-09-30')), 'HRD''s only';
end $$;

rollback;
