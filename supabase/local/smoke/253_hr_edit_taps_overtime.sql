-- 253_hr_edit_taps_overtime.sql — ubah tap yang sudah masuk; ubah jam lembur
-- yang sudah disetujui (0253, D410).
--
--   • any tap — the machine's, the phone's, HRD's — gets a new time and/or
--     kind with a reason; what it was is kept in `scan_edits`;
--   • the day reads the new time;
--   • any tap can be taken out;
--   • an approved evening gets new times in one step, and a refused change
--     leaves the old one paid.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-000000025301','hrd253@talaliving.com','{"full_name":"HRD"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-000000025301','payroll','admin'),
  ('ffffffff-0000-0000-0000-000000025301','hrd','admin');

-- Office 08.00–17.15 with an hour's break; overtime 1,5×, the 17.30–18.30
-- break left out, by the quarter hour.
insert into ops_hr.pay_rule_sets (version, effective_from, note, rules, created_by) values
 (1, '2026-09-01', 'uji D410', '{
   "week_pattern":"5day","late_grace_minutes":0,"late_mode":"pro_rata","early_leave_mode":"pro_rata",
   "undertime_mode":"off","day_reading":"in_out","hours_rounding_minutes":15,
   "overtime_mode":"statutory","workday_tiers":[{"after_hours":0,"multiplier":1.5}],
   "restday_tiers":[{"after_hours":0,"multiplier":2}],
   "overtime_break_from_minutes":1050,"overtime_break_to_minutes":1110,
   "overtime_rounding_minutes":15,
   "hourly_basis":"company","hourly_includes_allowance":true,"effective_days_per_year":240,
   "hourly_day_hours":8,
   "schedules":[{"code":"KANTOR","name":"Kantor","start_minutes":480,"end_minutes":1035,
                 "break_minutes":60,"note":null}],
   "schedule_by_unit":{"Kantor":"KANTOR","Workshop":"KANTOR"}
 }'::jsonb, 'ffffffff-0000-0000-0000-000000025301');

insert into ops_hr.employees
  (id, employee_no, full_name, position, unit, pay_basis, base_rate, allowance_rate,
   daily_hours, joined_on, active, paid_leave_days)
values
  ('aaaa2530-0000-0000-0000-000000000001','K-2531','Rian','Staf','Kantor','monthly', 2200000, 2200000, 8, '2026-01-01', true, 12);

-- The machine read 09.10 for a morning that began at 08.00; a phone tap at
-- 22.28 that was a test.
insert into ops_hr.attendance_imports (id, filename, imported_by)
values ('bbbb2530-0000-0000-0000-000000000001','m.csv','ffffffff-0000-0000-0000-000000025301');
insert into ops_hr.attendance_scans (id, employee_id, work_date, at, source, import_id)
values
  ('cccc2530-0000-0000-0000-000000000001','aaaa2530-0000-0000-0000-000000000001','2026-09-14',
   ('2026-09-14'::date + time '09:10') at time zone ops_core.office_tz(), 'import','bbbb2530-0000-0000-0000-000000000001'),
  ('cccc2530-0000-0000-0000-000000000002','aaaa2530-0000-0000-0000-000000000001','2026-09-14',
   ('2026-09-14'::date + time '17:15') at time zone ops_core.office_tz(), 'import','bbbb2530-0000-0000-0000-000000000001');
insert into ops_hr.attendance_scans (id, employee_id, work_date, at, source, kind, recorded_by)
values
  ('cccc2530-0000-0000-0000-000000000003','aaaa2530-0000-0000-0000-000000000001','2026-09-15',
   ('2026-09-15'::date + time '22:28') at time zone ops_core.office_tz(), 'self','in','ffffffff-0000-0000-0000-000000025301');

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000025301';

do $$
declare a jsonb; l ops_hr.payroll_figures; v_new text; v_old text;
  t0800 timestamptz := ('2026-09-14'::date + time '08:00') at time zone ops_core.office_tz();
begin
  l := ops_hr.payroll_line_for('aaaa2530-0000-0000-0000-000000000001','2026-09-14','2026-09-14');
  assert l.late_minutes = 70, 'the machine said 09.10, got ' || l.late_minutes;

  /* a machine tap, a new time */
  a := ops_hr.edit_scan('cccc2530-0000-0000-0000-000000000001', t0800, null, '');
  assert a -> 'error' ->> 'code' = 'reason_required', a::text;
  a := ops_hr.edit_scan('cccc2530-0000-0000-0000-000000000001', null, null, 'x');
  assert a -> 'error' ->> 'code' = 'time_required', a::text;
  a := ops_hr.edit_scan('cccc2530-0000-0000-0000-000000000001', t0800, 'lunch', 'x');
  assert a -> 'error' ->> 'code' = 'bad_kind', a::text;
  a := ops_hr.edit_scan('cccc2530-0000-0000-0000-000000000001',
         ('2026-09-14'::date + time '17:15') at time zone ops_core.office_tz(), null, 'x');
  assert a -> 'error' ->> 'code' = 'already_recorded', a::text;
  a := ops_hr.edit_scan('cccc2530-0000-0000-0000-000000000001', t0800, null, 'Mesin telat, datang 08.00 (CCTV)');
  assert ops_core.said_ok(a), a::text;
  a := ops_hr.edit_scan('cccc2530-0000-0000-0000-000000000001', t0800, null, 'lagi');
  assert a -> 'error' ->> 'code' = 'unchanged', a::text;

  assert (select source from ops_hr.attendance_scans where id = 'cccc2530-0000-0000-0000-000000000001') = 'manual',
    'now HRD''s';
  assert (select old_source = 'import' and old_at = ('2026-09-14'::date + time '09:10') at time zone ops_core.office_tz()
            from ops_hr.scan_edits where scan_id = 'cccc2530-0000-0000-0000-000000000001'), 'what it was is kept';
  assert (select edited_from from ops_hr.person_day_scans('K-2531','2026-09-14','2026-09-14')
           where id = 'cccc2530-0000-0000-0000-000000000001')
         = ('2026-09-14'::date + time '09:10') at time zone ops_core.office_tz(), 'the drawer shows the old time';
  l := ops_hr.payroll_line_for('aaaa2530-0000-0000-0000-000000000001','2026-09-14','2026-09-14');
  assert l.late_minutes = 0, 'the day reads 08.00, got ' || l.late_minutes;

  /* the phone's test tap, taken out */
  a := ops_hr.void_scan('cccc2530-0000-0000-0000-000000000003', 'Tes aplikasi');
  assert ops_core.said_ok(a), a::text;
  assert (select source from ops_hr.voided_scans where id = 'cccc2530-0000-0000-0000-000000000003') = 'self', 'kept';
  assert (select count(*) from ops_hr.person_day_scans('K-2531','2026-09-15','2026-09-15')) = 0, 'gone from the day';

  /* an evening approved 17.15–21.00, changed to 17.15–20.00 */
  a := ops_hr.approve_day_overtime('K-2531', '2026-09-14', null, 'Stock opname', null, 1035, 1260);
  assert ops_core.said_ok(a), a::text;
  v_old := a -> 'data' ->> 'sheet_no';
  assert (a -> 'data' ->> 'hours')::numeric = 2.75, a::text;

  a := ops_hr.revise_day_overtime(v_old, 1035, 1200, '');
  assert a -> 'error' ->> 'code' = 'reason_required', a::text;
  a := ops_hr.revise_day_overtime(v_old, null, 1200, 'x');
  assert a -> 'error' ->> 'code' = 'time_required', a::text;
  /* refused inside: nothing changes */
  a := ops_hr.revise_day_overtime(v_old, 1035, 1036, 'salah');
  assert a -> 'error' ->> 'code' = 'hours_out_of_range', a::text;
  assert (select paid from ops_hr.overtime_sheets where sheet_no = v_old), 'the old one is still paid';

  a := ops_hr.revise_day_overtime(v_old, 1035, 1200, 'Selesai 20.00, bukan 21.00');
  assert ops_core.said_ok(a), a::text;
  v_new := a -> 'data' ->> 'sheet_no';
  assert v_new <> v_old and a ->> 'replaced' = v_old, a::text;
  assert (a -> 'data' ->> 'hours')::numeric = 1.75, a::text;
  assert (select not paid and unpaid_reason = 'Diubah: Selesai 20.00, bukan 21.00'
            from ops_hr.overtime_sheets where sheet_no = v_old), 'the old one off, with why';
  assert (select from_minutes = 1035 and until_minutes = 1200
            from ops_hr.person_day_overtime_times('K-2531','2026-09-14','2026-09-14') where sheet_no = v_new),
    'the drawer reads the new times';
  a := ops_hr.revise_day_overtime(v_old, 1035, 1200, 'lagi');
  assert a -> 'error' ->> 'code' = 'already_unpaid', a::text;
end $$;

/* nobody without hrd.update changes a tap or an evening */
do $$
declare a jsonb;
begin
  reset role;
  insert into auth.users (id, email, raw_user_meta_data) values
    ('ffffffff-0000-0000-0000-000000025302','staf253@talaliving.com','{"full_name":"Staf"}');
  set local role authenticated;
  set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000025302';
  a := ops_hr.edit_scan('cccc2530-0000-0000-0000-000000000002', now(), null, 'coba');
  assert a -> 'error' ->> 'code' = 'not_permitted', a::text;
  a := ops_hr.revise_day_overtime('x', 1035, 1200, 'coba');
  assert a -> 'error' ->> 'code' = 'not_permitted', a::text;
  assert (select count(*) from ops_hr.person_day_scans('K-2531','2026-09-01','2026-09-30')) = 0, 'and reads nothing';
end $$;

rollback;
