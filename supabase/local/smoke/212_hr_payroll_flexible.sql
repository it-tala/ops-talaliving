-- 212_hr_payroll_flexible.sql — who is on a run, what it pays, and a salary
-- that is a month only when the month was worked (0212, D370).
--
-- September and October 2026 both have 22 working days on a five-day week.
--
--   • a salary is prorated by working days: 28–30 September is 3/22 of it,
--     somebody who joins on the 28th is paid 3/22 of September, somebody who
--     joins on 1 October is not on a September run at all, and a whole month
--     is exactly the salary;
--   • a working day HRD marked alpa is taken off; the `absence` switch puts
--     it back;
--   • a weekly run holds the day wages and a monthly run the salaries, over
--     the same days, side by side; the same group over the same days is still
--     `period_overlaps`, and so is a run whose people are all paid elsewhere;
--     an `all` draft that still holds somebody writes them off a new run;
--   • taking somebody off needs a sentence, puts them off `run_lines`, and
--     putting them on a run that overlaps one that already pays them is
--     `paid_elsewhere`;
--   • a component switched off for the run is zero and listed with what it
--     would have been; a person's own switch overrides the run's;
--   • a read grant changes nothing, and a signed run does not move.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-000000021001','payroll210@talaliving.com','{"full_name":"Payroll"}'),
  ('ffffffff-0000-0000-0000-000000021002','baca210@talaliving.com','{"full_name":"Pembaca"}'),
  ('ffffffff-0000-0000-0000-000000021003','ceo210@talaliving.com','{"full_name":"Pimpinan"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-000000021001','payroll','admin'),
  ('ffffffff-0000-0000-0000-000000021001','hrd','admin'),
  ('ffffffff-0000-0000-0000-000000021002','payroll','read'),
  ('ffffffff-0000-0000-0000-000000021003','payroll','read');
insert into ops_core.user_authorities (user_id, authority) values
  ('ffffffff-0000-0000-0000-000000021003','approve_funds');

insert into ops_hr.pay_rule_sets (version, effective_from, note, rules, created_by) values
 (1, '2026-08-01', 'uji D370', '{
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
 }'::jsonb, 'ffffffff-0000-0000-0000-000000021001');

insert into ops_hr.employees
  (id, employee_no, full_name, position, unit, pay_basis, base_rate, allowance_rate,
   daily_hours, joined_on, left_on, active, paid_leave_days)
values
  ('aaaa2100-0000-0000-0000-000000000001','K-2101','Bulanan penuh','Admin','Kantor',
   'monthly', 4400000, 0, 8, '2025-01-01', null, true, 12),
  ('aaaa2100-0000-0000-0000-000000000002','K-2102','Masuk 28 Sep','Admin','Kantor',
   'monthly', 4400000, 10000, 8, '2026-09-28', null, true, 12),
  ('aaaa2100-0000-0000-0000-000000000003','K-2103','Masuk 1 Okt','Admin','Kantor',
   'monthly', 4400000, 0, 8, '2026-10-01', null, true, 12),
  ('aaaa2100-0000-0000-0000-000000000004','K-2104','Alpa sehari','Admin','Kantor',
   'monthly', 2200000, 0, 8, '2025-01-01', null, true, 12),
  ('aaaa2100-0000-0000-0000-000000000005','B-2105','Harian','Tukang','Workshop',
   'daily', 100000, 0, 8, '2025-01-01', null, true, 0);

-- Alpa on Tuesday 15 September.
insert into ops_hr.day_marks (work_date, employee_id, kind, reason, marked_by)
values ('2026-09-15','aaaa2100-0000-0000-0000-000000000004','absent','Tidak masuk (uji)',
        'ffffffff-0000-0000-0000-000000021001');

-- The day worker: Monday 28 and Tuesday 29 September, in and out.
insert into ops_hr.attendance_scans (employee_id, work_date, at, verify, source, reason)
select 'aaaa2100-0000-0000-0000-000000000005', ops_core.office_day(t), t, 'FP', 'manual', 'uji D370'
  from unnest(array['2026-09-28 07:55','2026-09-28 17:05',
                    '2026-09-29 07:55','2026-09-29 17:05']::timestamp[]) s(ts)
  cross join lateral (select s.ts at time zone ops_core.office_tz() as t) x;

-- Two signed overtime hours on the Tuesday.
do $$
declare s uuid;
begin
  insert into ops_hr.overtime_sheets (kind, work_date, purpose, created_by,
      hrd_checked_by, hrd_checked_at, leader_approved_by, leader_approved_at)
  values ('production', '2026-09-29', 'Kejar kiriman', 'ffffffff-0000-0000-0000-000000021001',
      'ffffffff-0000-0000-0000-000000021001', now(), 'ffffffff-0000-0000-0000-000000021003', now())
  returning id into s;
  insert into ops_hr.overtime_lines (sheet_id, employee_id, hours, task)
  values (s, 'aaaa2100-0000-0000-0000-000000000005', 2, 'Kejar kiriman');
end $$;

-- 0242 (D394): these salaries have no taps and are paid the month, which
-- since D394 is somebody exempt from attendance (F72's rule, kept for them).
insert into ops_hr.attendance_exemptions (employee_id, reason, "by")
select e.id, 'uji: tanpa tap, dibayar sebulan', 'ffffffff-0000-0000-0000-000000021001'
  from ops_hr.employees e where e.pay_basis = 'monthly';

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000021001';

/* ── DERIVATION: a salary by working days ──────────────────────────────── */
do $$
declare p ops_hr.payroll_figures; m jsonb;
begin
  select * into p from ops_hr.payroll_line_for('aaaa2100-0000-0000-0000-000000000001','2026-09-01','2026-09-30');
  assert p.base_pay = 4400000, 'a whole month is the salary, got ' || p.base_pay;
  assert p.base_full = 4400000, 'base_full ' || p.base_full;
  m := p.proration -> 0;
  assert (m ->> 'workdays')::int = 22 and (m ->> 'paid_days')::int = 22, 'September: ' || m::text;
  assert not exists (select 1 from unnest(p.warnings) w where w like 'Gaji bulanan diprorata%'),
    'no proration sentence on a whole month: ' || array_to_string(p.warnings, ' | ');

  -- Three days of it.
  select * into p from ops_hr.payroll_line_for('aaaa2100-0000-0000-0000-000000000001','2026-09-28','2026-09-30');
  assert p.base_pay = 600000, '3/22 of 4.400.000, got ' || p.base_pay;
  assert p.base_full = 4400000, 'and what a month would be beside it, got ' || p.base_full;

  -- Across two months: 3/22 of September and 2/22 of October.
  select * into p from ops_hr.payroll_line_for('aaaa2100-0000-0000-0000-000000000001','2026-09-28','2026-10-02');
  assert p.base_pay = 600000 + 400000, '3/22 + 2/22, got ' || p.base_pay;
  assert jsonb_array_length(p.proration) = 2, 'one row per month, got ' || p.proration::text;

  -- Joined on the 28th: the days before are outside employment.
  select * into p from ops_hr.payroll_line_for('aaaa2100-0000-0000-0000-000000000002','2026-09-01','2026-09-30');
  assert p.base_pay = 600000, 'joined 28/09 = 3/22, got ' || p.base_pay;
  assert (p.proration -> 0 ->> 'outside_days')::int = 19, 'outside ' || p.proration::text;
  assert p.allowance_days = 3, 'tunjangan only from the day they started, got ' || p.allowance_days;
  assert exists (select 1 from unnest(p.warnings) w where w like 'Gaji bulanan diprorata: 3 dari 22 hari kerja 2026-09 (19 hari di luar masa kerja)%'),
    'the slip says why: ' || array_to_string(p.warnings, ' | ');

  -- Joined on 1 October: nothing of September.
  select * into p from ops_hr.payroll_line_for('aaaa2100-0000-0000-0000-000000000003','2026-09-28','2026-09-30');
  assert p.base_pay = 0, 'not employed yet, got ' || p.base_pay;

  -- One alpa: 21/22.
  select * into p from ops_hr.payroll_line_for('aaaa2100-0000-0000-0000-000000000004','2026-09-01','2026-09-30');
  assert p.base_pay = 2100000, '21/22 of 2.200.000, got ' || p.base_pay;
  assert (p.proration -> 0 ->> 'absent_days')::int = 1, 'absent ' || p.proration::text;

  -- A period nobody opened lists the group asked for, employed in it.
  assert (select count(*) from ops_hr.period_lines('2026-09-28','2026-09-30', null, 'weekly')) = 1,
    'weekly = the day worker only';
  assert not exists (select 1 from ops_hr.period_lines('2026-09-28','2026-09-30', null, 'monthly') l
                      where l.employee_no = 'K-2103'),
    'somebody who starts in October is not on September';
end $$;

/* ── DERIVATION and REFUSAL: groups side by side ───────────────────────── */
do $$
declare a jsonb; v_week text; v_month text; n int;
begin
  a := ops_hr.open_payroll_run('2026-09-25','2026-10-01', null, 'k-210-week', 'weekly');
  assert ops_core.said_ok(a), 'weekly: ' || a::text;
  v_week := a -> 'data' ->> 'run_no';
  assert (a -> 'data' ->> 'members')::int = 1, 'the day worker only, got ' || a::text;

  a := ops_hr.open_payroll_run('2026-09-01','2026-09-30', null, null, 'monthly');
  assert ops_core.said_ok(a), 'a monthly run over the same days: ' || a::text;
  v_month := a -> 'data' ->> 'run_no';
  select count(*) into n from ops_hr.run_lines(v_month);
  assert n = 3, 'K-2101, K-2102, K-2104 — not K-2103, got ' || n;
  assert (select sum(base_pay) from ops_hr.run_lines(v_month)) = 4400000 + 600000 + 2100000,
    'the run pays what the lines say';
  assert (select people from ops_hr.payroll_totals('2026-09-01','2026-09-30', v_month)) = 3,
    'the header counts the run';

  a := ops_hr.open_payroll_run('2026-09-28','2026-10-04', null, null, 'weekly');
  assert a -> 'error' ->> 'code' = 'period_overlaps', 'same group, same days: ' || a::text;
  assert a -> 'error' ->> 'message' like '%' || v_week || '%', 'names the run';

  -- `all` over both: everybody it would hold is already paid, so it is the
  -- overlap by another road.
  a := ops_hr.open_payroll_run('2026-09-28','2026-09-30');
  assert a -> 'error' ->> 'code' = 'period_overlaps', 'everybody paid elsewhere: ' || a::text;
  assert not exists (select 1 from ops_hr.payroll_runs where pay_group = 'all' and period_start = '2026-09-28'),
    'and nothing was left behind';

  a := ops_hr.open_payroll_run('2026-09-01','2026-09-30', null, null, 'tahunan');
  assert a -> 'error' ->> 'code' = 'group_invalid', 'got ' || a::text;
  a := ops_hr.open_payroll_run('2026-11-01','2026-11-30', null, null, 'monthly', '{"lembur":false}');
  assert a -> 'error' ->> 'code' = 'components_invalid', 'a key nobody knows: ' || a::text;
  a := ops_hr.open_payroll_run('2026-11-01','2026-11-30', null, null, 'monthly', '{"overtime":false}');
  assert a -> 'error' ->> 'code' = 'reason_required', 'off needs a sentence: ' || a::text;
end $$;

/* ── who is on it ──────────────────────────────────────────────────────── */
do $$
declare a jsonb; v_week text; v_month text;
begin
  select run_no into v_week from ops_hr.payroll_runs where pay_group = 'weekly';
  select run_no into v_month from ops_hr.payroll_runs where pay_group = 'monthly';

  a := ops_hr.set_payroll_member(v_month, 'K-2104', false);
  assert a -> 'error' ->> 'code' = 'reason_required', 'off needs a sentence: ' || a::text;
  a := ops_hr.set_payroll_member(v_month, 'K-2104', false, '{}', 'Dibayar terpisah', 'k-210-off');
  assert ops_core.said_ok(a), a::text;
  assert not exists (select 1 from ops_hr.run_lines(v_month) where employee_no = 'K-2104'),
    'off the run is off the lines';
  assert (select note from ops_hr.run_members(v_month) where employee_no = 'K-2104') = 'Dibayar terpisah',
    'and the list says why';
  a := ops_hr.set_payroll_member(v_month, 'K-2104', false, '{}', 'Dibayar terpisah', 'k-210-off');
  assert a ->> 'outcome' = 'duplicate', 'a retry is one change';
  a := ops_hr.set_payroll_member(v_month, 'K-2104', true);
  assert ops_core.said_ok(a), a::text;

  -- The day worker is on the weekly run for 25/09–01/10.
  a := ops_hr.set_payroll_member(v_month, 'B-2105', true);
  assert a -> 'error' ->> 'code' = 'paid_elsewhere', 'the same day twice: ' || a::text;
  assert a -> 'error' ->> 'message' like '%' || v_week || '%', 'names the run';

  a := ops_hr.set_payroll_member(v_month, 'X-404', true);
  assert a -> 'error' ->> 'code' = 'not_found', a::text;
end $$;

/* ── what it pays ──────────────────────────────────────────────────────── */
do $$
declare a jsonb; v_week text; v_month text; p ops_hr.payroll_figures; off jsonb;
begin
  select run_no into v_week from ops_hr.payroll_runs where pay_group = 'weekly';
  select run_no into v_month from ops_hr.payroll_runs where pay_group = 'monthly';

  select * into p from ops_hr.run_lines(v_week) where employee_no = 'B-2105';
  assert p.overtime_pay > 0 and p.base_pay = 200000, 'two days and the overtime: ' || p.base_pay || ' / ' || p.overtime_pay;

  a := ops_hr.set_payroll_components(v_week, '{"overtime":false}');
  assert a -> 'error' ->> 'code' = 'reason_required', a::text;
  a := ops_hr.set_payroll_components(v_week, '{"overtime":false}', 'Lembur dibayar akhir bulan');
  assert ops_core.said_ok(a), a::text;

  select * into p from ops_hr.run_lines(v_week) where employee_no = 'B-2105';
  assert p.overtime_pay = 0, 'off for the run, got ' || p.overtime_pay;
  assert p.gross = 200000, 'gross without it, got ' || p.gross;
  off := p.components_off -> 0;
  assert off ->> 'component' = 'overtime' and (off ->> 'amount')::bigint > 0
     and off ->> 'scope' = 'run' and off ->> 'reason' = 'Lembur dibayar akhir bulan',
    'listed with what it would have been: ' || p.components_off::text;

  -- The person's own switch over the run's.
  a := ops_hr.set_payroll_member(v_week, 'B-2105', true, '{"overtime":true}', 'Kasus khusus');
  assert ops_core.said_ok(a), a::text;
  select * into p from ops_hr.run_lines(v_week) where employee_no = 'B-2105';
  assert p.overtime_pay > 0, 'paid for this person, got ' || p.overtime_pay;
  assert jsonb_array_length(p.components_off) = 0, 'nothing off: ' || p.components_off::text;

  -- The alpa back, for one person.
  a := ops_hr.set_payroll_member(v_month, 'K-2104', true, '{"absence":false}', 'Alpa diganti hari Sabtu');
  assert ops_core.said_ok(a), a::text;
  select * into p from ops_hr.run_lines(v_month) where employee_no = 'K-2104';
  assert p.base_pay = 2200000, 'the alpa not taken off, got ' || p.base_pay;
  off := p.components_off -> 0;
  assert off ->> 'component' = 'absence' and (off ->> 'amount')::bigint = 100000
     and off ->> 'scope' = 'person',
    'the deduction not taken: ' || p.components_off::text;

  a := ops_hr.set_payroll_member(v_month, 'K-2104', true, '{"bonus":false}', 'x');
  assert a -> 'error' ->> 'code' = 'components_invalid', a::text;
end $$;

/* ── REFUSAL: a read grant changes nothing ─────────────────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000021002';
do $$
declare a jsonb; v_month text; failed boolean := false;
begin
  select run_no into v_month from ops_hr.payroll_runs where pay_group = 'monthly';
  a := ops_hr.set_payroll_member(v_month, 'K-2101', false, '{}', 'coba');
  assert a -> 'error' ->> 'code' = 'not_permitted', a::text;
  a := ops_hr.set_payroll_components(v_month, '{"base":false}', 'coba');
  assert a -> 'error' ->> 'code' = 'not_permitted', a::text;
  a := ops_hr.open_payroll_run('2026-12-01','2026-12-31', null, null, 'monthly');
  assert a -> 'error' ->> 'code' = 'not_permitted', a::text;
  begin
    update ops_hr.payroll_run_members set included = false, note = 'coba' where run_no = v_month;
    get diagnostics failed = row_count;
  end;
  assert not exists (select 1 from ops_hr.payroll_run_members where run_no = v_month and not included),
    'the table refuses it too';
end $$;

/* ── a signed run does not move ────────────────────────────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000021003';
do $$
declare a jsonb; v_month text;
begin
  select run_no into v_month from ops_hr.payroll_runs where pay_group = 'monthly';
  a := ops_hr.approve_payroll_run(v_month);
  assert ops_core.said_ok(a), 'approve: ' || a::text;
  assert (a -> 'data' ->> 'people')::int = 3, 'signed for its members, got ' || a::text;
end $$;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000021001';
do $$
declare a jsonb; v_month text;
begin
  select run_no into v_month from ops_hr.payroll_runs where pay_group = 'monthly';
  a := ops_hr.set_payroll_member(v_month, 'K-2101', false, '{}', 'terlambat');
  assert a -> 'error' ->> 'code' = 'run_not_draft', a::text;
  a := ops_hr.set_payroll_components(v_month, '{}');
  assert a -> 'error' ->> 'code' = 'run_not_draft', a::text;
end $$;

/* ── custom: nobody until HRD adds them ────────────────────────────────── */
do $$
declare a jsonb; v_no text; p ops_hr.payroll_figures;
begin
  a := ops_hr.open_payroll_run('2026-10-01','2026-10-31', 'Gaji Oktober K-2103', null, 'custom');
  assert ops_core.said_ok(a) and (a -> 'data' ->> 'members')::int = 0, a::text;
  v_no := a -> 'data' ->> 'run_no';
  a := ops_hr.set_payroll_member(v_no, 'K-2103', true);
  assert ops_core.said_ok(a), a::text;
  select * into p from ops_hr.run_lines(v_no);
  assert p.employee_no = 'K-2103' and p.base_pay = 4400000, 'a whole October: ' || coalesce(p.base_pay::text, '(none)');
end $$;

/* ── an `all` draft does not block another group ───────────────────────── */
do $$
declare a jsonb; v_all text; v_mon text; failed boolean := false;
begin
  a := ops_hr.open_payroll_run('2026-11-02','2026-11-06');
  assert ops_core.said_ok(a), 'all: ' || a::text;
  v_all := a -> 'data' ->> 'run_no';
  -- Every salary is on it: a monthly run over it would pay nobody.
  a := ops_hr.open_payroll_run('2026-11-01','2026-11-30', null, null, 'monthly');
  assert a -> 'error' ->> 'code' = 'period_overlaps', 'nobody left to pay: ' || a::text;
  -- HRD takes one salary off the draft; now the monthly run opens, with him
  -- on it and everybody the draft still pays written off, the draft named.
  a := ops_hr.set_payroll_member(v_all, 'K-2103', false, '{}', 'Gaji lewat run bulanan');
  assert ops_core.said_ok(a), a::text;
  a := ops_hr.open_payroll_run('2026-11-01','2026-11-30', null, null, 'monthly');
  assert ops_core.said_ok(a), 'monthly over an all draft opens: ' || a::text;
  v_mon := a -> 'data' ->> 'run_no';
  assert (select m.included from ops_hr.run_members(v_mon) m where m.employee_no = 'K-2103'),
    'the one taken off the draft is on the monthly run';
  assert (select m.note from ops_hr.run_members(v_mon) m where m.employee_no = 'K-2101') like '%' || v_all || '%',
    'whoever the draft still pays is off the new run, with the draft named';

  -- Moving a run's dates is held to the same rule.
  begin
    update ops_hr.payroll_runs set period_start = '2026-12-07', period_end = '2026-12-11'
     where run_no = v_all;
    update ops_hr.payroll_run_members set included = true, note = null
     where run_no = v_all and employee_id = 'aaaa2100-0000-0000-0000-000000000003';
    update ops_hr.payroll_runs set period_start = '2026-11-02', period_end = '2026-11-06'
     where run_no = v_all;
  exception when exclusion_violation then
    failed := sqlerrm like 'run % would pay somebody%';
  end;
  assert failed, 'a run moved onto days its people are paid for elsewhere is refused by its own guard';
end $$;

rollback;
