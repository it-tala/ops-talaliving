-- 236_hr_monthly_deductions.sql — potongan default per bulan (0236, D389).
--
--   • the defaults reach every salaried person once per month, in the period
--     that holds the month's last day; never a day wage;
--   • a person's own amount wins, zero included;
--   • a BPJS default steps aside for somebody enrolled in that scheme;
--   • generating with them writes ordinary adjustments, retensi on the balance;
--   • BPJS kinds only take; only HRD sets or reads any of it.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-000000023601','hrd236@talaliving.com','{"full_name":"HRD"}'),
  ('ffffffff-0000-0000-0000-000000023602','pekerja236@talaliving.com','{"full_name":"Pekerja"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-000000023601','payroll','admin'),
  ('ffffffff-0000-0000-0000-000000023601','hrd','admin');

insert into ops_hr.pay_rule_sets (version, effective_from, note, rules, created_by) values
 (1, '2026-08-01', 'uji D389', '{
   "week_pattern":"5day","late_grace_minutes":15,"late_mode":"manual","undertime_mode":"off",
   "day_reading":"in_out","hours_rounding_minutes":15,
   "overtime_mode":"tiered","workday_tiers":[{"after_hours":0,"multiplier":1.5}],
   "restday_tiers":[{"after_hours":0,"multiplier":2}],
   "hourly_basis":"company","hourly_includes_allowance":true,"effective_days_per_year":240,
   "schedules":[{"code":"KANTOR","name":"Kantor","start_minutes":480,"end_minutes":1020,
                 "break_minutes":60,"note":null}],
   "schedule_by_unit":{"Kantor":"KANTOR","Workshop":"KANTOR"}
 }'::jsonb, 'ffffffff-0000-0000-0000-000000023601');

insert into ops_hr.employees
  (id, employee_no, full_name, position, unit, pay_basis, base_rate, allowance_rate,
   daily_hours, joined_on, active, paid_leave_days)
values
  ('aaaa2360-0000-0000-0000-000000000001','K-2361','Staf biasa','Admin','Kantor','monthly', 4000000, 0, 8, '2025-01-01', true, 12),
  ('aaaa2360-0000-0000-0000-000000000002','K-2362','Staf tanpa retensi','Admin','Kantor','monthly', 4000000, 0, 8, '2025-01-01', true, 12),
  ('aaaa2360-0000-0000-0000-000000000003','K-2363','Staf ikut JHT','Admin','Kantor','monthly', 4000000, 0, 8, '2025-01-01', true, 12),
  ('aaaa2360-0000-0000-0000-000000000004','B-2364','Harian','Tukang','Workshop','daily', 120000, 0, 8, '2025-01-01', true, 0);
insert into ops_hr.enrolments (employee_id, scheme, enrolled_on)
values ('aaaa2360-0000-0000-0000-000000000003','JHT','2025-01-01');

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000023601';

do $$
declare a jsonb; v_no text; n int; adj jsonb;
begin
  /* the defaults, as HRD sets them */
  a := ops_hr.set_deduction_default('bpjs_tk', 120000);
  assert ops_core.said_ok(a), a::text;
  a := ops_hr.set_deduction_default('bpjs_tk', -1);
  assert a -> 'error' ->> 'code' = 'amount_invalid', a::text;
  a := ops_hr.set_deduction_default('bonus', 1);
  assert a -> 'error' ->> 'code' = 'kind_not_default', a::text;
  a := ops_hr.set_employee_deduction('K-2362', 'retention', 0);
  assert ops_core.said_ok(a), a::text;

  /* who owes what in September */
  assert (select amount from ops_hr.deduction_defaults_for('2026-09-01','2026-09-30')
           where employee_no = 'K-2361' and kind = 'retention') = 500000, 'retensi by default';
  assert (select amount from ops_hr.deduction_defaults_for('2026-09-01','2026-09-30')
           where employee_no = 'K-2361' and kind = 'bpjs_tk') = 120000, 'BPJS TK by default';
  assert not exists (select 1 from ops_hr.deduction_defaults_for('2026-09-01','2026-09-30')
           where kind = 'bpjs_kes'), 'BPJS Kesehatan 0 is not a line';
  assert not exists (select 1 from ops_hr.deduction_defaults_for('2026-09-01','2026-09-30')
           where employee_no = 'K-2362' and kind = 'retention'), 'a person''s own zero wins';
  assert not exists (select 1 from ops_hr.deduction_defaults_for('2026-09-01','2026-09-30')
           where employee_no = 'K-2363' and kind = 'bpjs_tk'), 'enrolled in JHT: 0051 computes it';
  assert not exists (select 1 from ops_hr.deduction_defaults_for('2026-09-01','2026-09-30')
           where employee_no = 'B-2364'), 'never a day wage';
  assert not exists (select 1 from ops_hr.deduction_defaults_for('2026-09-01','2026-09-29')),
    'a period without the month''s last day takes nothing';
  select count(*) into n from ops_hr.deduction_defaults_for('2026-08-01','2026-09-30')
   where employee_no = 'K-2361' and kind = 'retention';
  assert n = 2, 'two months, two retensi, got ' || n;

  /* the BPJS kinds only take */
  a := ops_hr.generate_payroll('2026-09-01','2026-09-30','monthly','[]',null,null,
         '[{"employee_no":"K-2361","kind":"bpjs_tk","amount":120000,"reason":"x"}]');
  assert a -> 'error' ->> 'code' = 'kind_is_deduction', a::text;

  /* generating with them: ordinary adjustments, retensi on its way to the balance */
  select jsonb_agg(jsonb_build_object('employee_no', d.employee_no, 'kind', d.kind,
                                      'amount', -d.amount, 'reason', d.reason))
    into adj from ops_hr.deduction_defaults_for('2026-09-01','2026-09-30') d;
  a := ops_hr.generate_payroll('2026-09-01','2026-09-30','monthly','[]',null,null, adj);
  assert ops_core.said_ok(a), a::text;
  v_no := a -> 'data' ->> 'run_no';
  assert (select deductions_total from ops_hr.run_lines(v_no) where employee_no = 'K-2361') = 620000,
    'retensi + BPJS TK on the line';
  assert (select in_draft from ops_hr.retention_balances('K-2361')) = 500000, 'and retensi on the balance';
end $$;

/* only HRD */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000023602';
do $$
declare a jsonb;
begin
  assert not exists (select 1 from ops_hr.deduction_defaults_for('2026-09-01','2026-09-30')), 'nothing for a worker';
  a := ops_hr.set_deduction_default('retention', 0);
  assert a -> 'error' ->> 'code' = 'not_permitted', a::text;
  assert not exists (select 1 from ops_hr.deduction_defaults), 'the table is HRD''s to read';
end $$;

rollback;
