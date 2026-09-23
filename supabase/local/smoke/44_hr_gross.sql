-- hr — the gross, and every figure it is made of.
--
-- The numbers below were worked out on paper before the view was run, which is
-- the only way an assertion tests arithmetic rather than mirroring it:
--
--   hourly   (180.000 + 25.000) × 300 hari ÷ 300 ÷ 8 jam   = 25.625
--   base     3 hari × 180.000                              = 540.000
--   tunjangan 3 hari × 25.000                              =  75.000
--   lembur   jam ke-1 × 1,5 + 2 jam × 2, atas 25.625        = 140.938
--   gross    540.000 + 75.000 + 140.938                    = 755.938
--
--   REFUSALS     restoring a withheld allowance says who, when and why;
--                one withholding per person per day
--   DERIVATIONS  the hourly rate; base by pay_basis; the tier ladder per
--                night; the paper beating the ladder (D154); a withheld day
--                removing itself from the allowance and saying so; lateness
--                priced and NOT deducted while the rule is manual (D251)

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-0000000000f1','wulan@talaliving.com','{"full_name":"Wulan Sari"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-0000000000f1','hrd','write'),
  ('ffffffff-0000-0000-0000-0000000000f1','payroll','admin'),
  ('ffffffff-0000-0000-0000-0000000000f1','it','write');

insert into ops_hr.employees
  (id, employee_no, full_name, unit, schedule_code, pay_basis, base_rate, allowance_rate, daily_hours)
values ('aaaa0000-0000-0000-0000-0000000000b1','B-401','Joko Susilo','Produksi','PRODUKSI',
        'daily', 180000, 25000, 8);

insert into ops_hr.pay_rule_sets (version, effective_from, note, rules, created_by) values
 (1, current_date, 'versi uji gross', '{
   "week_pattern": "6day",
   "day_starts_minutes": 480,
   "late_grace_minutes": 15,
   "late_mode": "manual",
   "undertime_mode": "off",
   "undertime_grace_minutes": 0,
   "overtime_mode": "tiered",
   "overtime_rounding_minutes": 0,
   "flat_multiplier": 1.5,
   "workday_tiers": [{"after_hours":0,"multiplier":1.5},{"after_hours":1,"multiplier":2}],
   "restday_tiers": [{"after_hours":0,"multiplier":2}],
   "monthly_divisor": 173,
   "hourly_basis": "company",
   "effective_days_per_year": 300,
   "hourly_includes_allowance": true,
   "schedules": [{"code":"PRODUKSI","name":"Produksi","start_minutes":450,"end_minutes":990,
                  "break_minutes":45,"friday_break_minutes":90,"note":null}],
   "schedule_by_unit": {"Produksi":"PRODUKSI"}
 }'::jsonb, 'ffffffff-0000-0000-0000-0000000000f1');

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-0000000000f1';

-- Two days on time, one fifteen minutes late past the schedule's 07.30.
insert into ops_hr.attendance_scans (employee_id, work_date, at, source, reason, recorded_by)
select 'aaaa0000-0000-0000-0000-0000000000b1', ops_core.office_day(t), t, 'manual','uji gross',
       'ffffffff-0000-0000-0000-0000000000f1'
  from unnest(array[
    '2026-08-24 07:30+08','2026-08-24 12:00+08','2026-08-24 12:45+08','2026-08-24 17:00+08',
    '2026-08-25 07:30+08','2026-08-25 12:00+08','2026-08-25 12:45+08','2026-08-25 17:00+08',
    '2026-08-26 08:00+08','2026-08-26 12:00+08','2026-08-26 12:45+08','2026-08-26 17:00+08'
  ]::timestamptz[]) t;

/* ── DERIVATION: an hour of this person's time ─────────────────────────── */
do $$
declare e ops_hr.employees%rowtype; r ops_hr.hourly_rate_t;
begin
  select * into e from ops_hr.employees where employee_no = 'B-401';
  r := ops_hr.hourly_rate(e, ops_hr.rules_on('2026-08-24'));
  assert r.company = 25625, 'setahun 61,5 juta dibagi 300 hari dibagi 8 jam, got ' || r.company;
  -- There is no month to divide for somebody paid by the day, so the statutory
  -- answer is the same answer rather than a coincidence.
  assert r.statutory = r.company, 'no month to divide, got ' || r.statutory;
  assert r.hourly = 25625, 'and the book says company, got ' || r.hourly;
end $$;

/* ── DERIVATION: the ladder, per night ─────────────────────────────────── */
do $$
declare sheet uuid; n int; total bigint;
begin
  insert into ops_hr.overtime_sheets (kind, work_date, purpose, created_by)
  values ('staff','2026-08-25','kejar kirim','ffffffff-0000-0000-0000-0000000000f1')
  returning id into sheet;
  insert into ops_hr.overtime_lines (sheet_id, employee_id, hours, task)
  values (sheet,'aaaa0000-0000-0000-0000-0000000000b1', 3, 'packing');

  select count(*), sum(amount) into n, total
    from ops_hr.overtime_parts('aaaa0000-0000-0000-0000-0000000000b1','2026-08-24','2026-08-26');
  assert n = 2,            'three hours cross two rungs, got ' || n;
  assert total = 140938,   'jam ke-1 x1,5 + 2 jam x2 atas 25.625, got ' || total;

  -- The parts are returned rather than a total, because a total is the thing
  -- nobody can check (D173).
  assert (select label from ops_hr.overtime_parts('aaaa0000-0000-0000-0000-0000000000b1','2026-08-24','2026-08-26')
           order by multiplier limit 1) = 'Hari kerja · jam ke-1',
         'the first rung names itself';
end $$;

/* ── DERIVATION: the whole line ────────────────────────────────────────── */
do $$
declare run text; l ops_hr.payroll_figures;
begin
  insert into ops_hr.payroll_runs (period_start, period_end, created_by)
  values ('2026-08-24','2026-08-26','ffffffff-0000-0000-0000-0000000000f1')
  returning run_no into run;

  l := ops_hr.payroll_line('aaaa0000-0000-0000-0000-0000000000b1', run);
  assert l.worked_days = 3,      'three days counted, got ' || l.worked_days;
  assert l.open_days = 0,        'none of them needs reading, got ' || l.open_days;
  assert l.normal_hours = 25.75, '8,75 + 8,75 + 8,25, got ' || l.normal_hours;
  assert l.base_pay = 540000,    'three days at 180.000, got ' || l.base_pay;
  assert l.allowance_days = 3,   'tunjangan is paid for coming in, got ' || l.allowance_days;
  assert l.allowance_pay = 75000,'three days at 25.000, got ' || l.allowance_pay;
  assert l.overtime_pay = 140938,'the ladder, got ' || l.overtime_pay;
  assert l.gross = 755938,       '540.000 + 75.000 + 140.938, got ' || l.gross;

  /* Lateness is priced and not taken, while the rule book says manual (D251).
     The figure exists so the slip can show what is NOT being deducted rather
     than leaving the minutes looking free. */
  assert l.late_minutes = 15,    'fifteen minutes past 07.30 plus grace, got ' || l.late_minutes;
  assert l.late_priced = 6406,   'and what they would cost, got ' || l.late_priced;
  assert l.late_deduction = 0,   'but nothing is deducted, got ' || l.late_deduction;
  assert exists (select 1 from unnest(l.warnings) x where x like '%belum dipotong%'),
         'and the slip says so: ' || array_to_string(l.warnings, ' | ');
end $$;

/* ── DERIVATION + REFUSAL: a day HRD took the tunjangan off ────────────── */
do $$
declare run text; l ops_hr.payroll_figures;
begin
  select run_no into run from ops_hr.payroll_runs where period_start = '2026-08-24';

  /* REFUSAL: restoring it is a second decision and says who, when and why */
  begin
    insert into ops_hr.allowance_withholdings (employee_id, work_date, reason, by, restored_by)
    values ('aaaa0000-0000-0000-0000-0000000000b1','2026-08-26','telat tanpa kabar',
            'ffffffff-0000-0000-0000-0000000000f1','ffffffff-0000-0000-0000-0000000000f1');
    raise exception 'a half-written restore should be refused';
  exception when check_violation then null;
  end;

  insert into ops_hr.allowance_withholdings (employee_id, work_date, reason, by)
  values ('aaaa0000-0000-0000-0000-0000000000b1','2026-08-26','telat tanpa kabar',
          'ffffffff-0000-0000-0000-0000000000f1');

  /* REFUSAL: one decision per person per day */
  begin
    insert into ops_hr.allowance_withholdings (employee_id, work_date, reason, by)
    values ('aaaa0000-0000-0000-0000-0000000000b1','2026-08-26','dobel',
            'ffffffff-0000-0000-0000-0000000000f1');
    raise exception 'a second withholding on one day should be refused';
  exception when unique_violation then null;
  end;

  l := ops_hr.payroll_line('aaaa0000-0000-0000-0000-0000000000b1', run);
  assert l.allowance_days = 2,          'the withheld day drops out, got ' || l.allowance_days;
  assert l.allowance_withheld_days = 1, 'and is counted as withheld, got ' || l.allowance_withheld_days;
  assert l.allowance_pay = 50000,       'two days of tunjangan, got ' || l.allowance_pay;
  assert l.worked_days = 3,             'he was still here — only the allowance moved, got ' || l.worked_days;
  assert l.gross = 730938,              '25.000 off the gross, got ' || l.gross;
  assert exists (select 1 from unnest(l.warnings) x where x like '%tanpa tunjangan%'),
         'and the slip prints the reason: ' || array_to_string(l.warnings, ' | ');
end $$;

/* ── DERIVATION: the paper wins where it speaks (D154) ─────────────────── */
do $$
declare run text; l ops_hr.payroll_figures;
begin
  select run_no into run from ops_hr.payroll_runs where period_start = '2026-08-24';
  -- The GAJI column of the form says 100.000. That is what the man signed for,
  -- and it is paid as written — no ladder, no recomputation.
  update ops_hr.overtime_lines set form_amount = 100000
   where employee_id = 'aaaa0000-0000-0000-0000-0000000000b1';

  l := ops_hr.payroll_line('aaaa0000-0000-0000-0000-0000000000b1', run);
  assert l.overtime_pay = 100000,
    'the form is paid as written, not as our multiplication came out, got ' || l.overtime_pay;
  assert l.gross = 690000, '540.000 + 50.000 + 100.000, got ' || l.gross;
end $$;

rollback;
