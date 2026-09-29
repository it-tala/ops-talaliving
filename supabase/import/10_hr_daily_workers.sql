-- 10_hr_daily_workers.sql — the workshop's daily workers onto ops_hr.employees (D337).
--
-- Source: `ops_hr_employees_daily_workers.xlsx`, built from the 30 weekly
-- payroll sheets 2 March – 25 September 2026 (6–10 April missing). HRD had
-- typed 15 of the daily workers in by hand on 23 and 28 September; the
-- September biometric upload named 17 machine numbers nobody was registered
-- under. This file registers everybody the payroll knows **with a machine
-- number**, so the next upload files their taps.
--
-- Not `supabase/migrations/`: this is data, not schema, and the ladder is
-- replayed from nothing on every CI run (see README.md). Run it like the
-- others, after migration `0192_hr_offboard.sql`.
--
-- ── What it writes ─────────────────────────────────────────────────────
--
--   1. **20 people working now**, active, on PRODUKSI.
--   2. **17 who have left**, written already offboarded: `active = false` and
--      `left_on` = the last day of their last week on the payroll. They are
--      here because historical files carry their taps and a payroll period
--      they worked must still resolve them (A5); from the day after, the
--      import sets their taps aside and names them (0192).
--   3. **joined_on for the 15 HRD entered**, where HRD's date is later than
--      the first payroll week they appear in. The form used the day they were
--      typed in (F154). The date written is the **earliest week on record**,
--      not necessarily the hire date — the sheets start on 2 March.
--
-- ── What it deliberately does not write ────────────────────────────────
--
--   - **12 people with no machine number** (never printed on any payroll
--     sheet): AGUS (FINISHING, active since 14 Sep), NUR (HELPER, active),
--     and ten who have left. `employee_no` *is* the machine number and the
--     only key the file carries; a made-up one would match nobody, or worse,
--     somebody. HRD enrols them on the machine and adds them on
--     HRD → Karyawan with the number it gives.
--   - **Position, rate and pay basis of the 15 already there.** The sheet
--     flags differences (SITI and NUR AISAH are PACKING here and SANDING on
--     the payroll; HENDI is FINISHING here and PU on the payroll) and pending
--     rates for SUKARJO, SITI, NUR AISAH, THOHARI and HENDI. Those are HRD's
--     to confirm, on the employee screen, where the audit row keeps the
--     before and after.
--   - **The sheet's allowance and incentive columns.** `allowance_rate` is 0,
--     following the 15 rows HRD entered; the payroll's per-day figures are
--     helper columns in the sheet, not a decision.
--   - Sanding is written as **AMPLAS**, the sheet's own mapping — to confirm
--     with HRD.
--
-- **Idempotent**: an employee number already present is left alone, and the
-- joined_on correction only ever moves a date earlier. Run twice, the second
-- run writes nothing.

\set ON_ERROR_STOP on

begin;

create temp table _dw (
  employee_no text primary key, full_name text, position text, base_rate bigint,
  daily_hours numeric, joined_on date, active boolean, left_on date,
  schedule_code text, note text
) on commit drop;

insert into _dw values
  ('114', 'SOLEKHAN', 'TUKANG KAYU', 120000, 8, date '2026-05-18', true, null, 'PRODUKSI', null),
  ('15', 'PRANOWO', 'TUKANG KAYU', 120000, 8, date '2026-06-22', true, null, 'PRODUKSI', null),
  ('26', 'PADI', 'TUKANG KAYU', 140000, 8, date '2026-06-22', false, date '2026-09-11', 'PRODUKSI', null),
  ('115', 'RUKAN', 'TUKANG KAYU', 120000, 8, date '2026-05-18', false, date '2026-06-26', 'PRODUKSI', null),
  ('20', 'UTAMI', 'AMPLAS', 132250, 8, date '2026-03-02', true, null, 'PRODUKSI', null),
  ('112', 'SUMI', 'AMPLAS', 65000, 8, date '2026-05-11', true, null, 'PRODUKSI', null),
  ('116', 'ROFIATI', 'AMPLAS', 60000, 8, date '2026-05-18', true, null, 'PRODUKSI', null),
  ('117', 'SITI AMSAH', 'AMPLAS', 65000, 8, date '2026-05-18', true, null, 'PRODUKSI', null),
  ('127', 'MUSLIKATUN', 'AMPLAS', 60000, 8, date '2026-06-02', true, null, 'PRODUKSI', null),
  ('131', 'FITRIA', 'AMPLAS', 60000, 8, date '2026-06-08', true, null, 'PRODUKSI', null),
  ('123', 'ISTIFAKYAH', 'AMPLAS', 60000, 8, date '2026-05-18', false, date '2026-08-28', 'PRODUKSI', null),
  ('130', 'RONDIYAH', 'AMPLAS', 60000, 8, date '2026-06-08', false, date '2026-09-11', 'PRODUKSI', null),
  ('137', 'MUSAMAH', 'AMPLAS', 60000, 8, date '2026-07-20', true, null, 'PRODUKSI', null),
  ('136', 'NURSIH', 'AMPLAS', 60000, 8, date '2026-07-20', true, null, 'PRODUKSI', null),
  ('138', 'PAINAH', 'AMPLAS', 60000, 8, date '2026-07-20', true, null, 'PRODUKSI', null),
  ('6', 'SUMIATI', 'AMPLAS', 60000, 8, date '2026-08-03', true, null, 'PRODUKSI', null),
  ('21', 'ISMIYAH', 'AMPLAS', 75000, 8, date '2026-03-02', false, date '2026-04-02', 'PRODUKSI', null),
  ('52', 'SRIWANTI', 'AMPLAS', 60000, 8, date '2026-06-22', false, date '2026-07-24', 'PRODUKSI', null),
  ('133', 'YULI', 'AMPLAS', 60000, 8, date '2026-06-22', false, date '2026-07-24', 'PRODUKSI', null),
  ('5', 'MASLIKA', 'AMPLAS', 60000, 8, date '2026-07-20', false, date '2026-08-14', 'PRODUKSI', null),
  ('72', 'SENIPAH', 'AMPLAS', 60000, 8, date '2026-07-13', false, date '2026-07-24', 'PRODUKSI', null),
  ('132', 'SRI WAHYUNI', 'AMPLAS', 60000, 8, date '2026-06-22', false, date '2026-07-03', 'PRODUKSI', null),
  ('31', 'NIAM', 'FINISHING', 100000, 8, date '2026-05-11', true, null, 'PRODUKSI', null),
  ('110', 'ADIT', 'PU', 75000, 8, date '2026-05-11', true, null, 'PRODUKSI', null),
  ('126', 'RADHIT', 'PU', 75000, 8, date '2026-06-02', true, null, 'PRODUKSI', null),
  ('128', 'YOGA', 'PU', 75000, 8, date '2026-06-08', true, null, 'PRODUKSI', null),
  ('129', 'FIRMANSYAH', 'PU', 75000, 8, date '2026-06-08', false, date '2026-09-11', 'PRODUKSI', null),
  ('124', 'TAUFIK', 'PU', 75000, 8, date '2026-06-02', false, date '2026-08-28', 'PRODUKSI', null),
  ('60', 'PUTRA', 'PU', 75000, 8, date '2026-07-06', true, null, 'PRODUKSI', null),
  ('74', 'DENI', 'PU', 75000, 8, date '2026-07-13', true, null, 'PRODUKSI', null),
  ('113', 'MIFTAH', 'PU', 75000, 8, date '2026-05-11', false, date '2026-07-03', 'PRODUKSI', null),
  ('76', 'RONI', 'PU', 75000, 8, date '2026-07-13', false, date '2026-08-28', 'PRODUKSI', 'Nomor mesin tercetak 74/76 di slip — 74 milik Deni, dipakai 76. Kecelakaan kerja 18 Agustus, kompensasi upah.'),
  ('119', 'KIKI', 'PU', 75000, 8, date '2026-05-25', false, date '2026-06-12', 'PRODUKSI', null),
  ('120', 'FIRMAN', 'PU', 75000, 8, date '2026-05-25', false, date '2026-06-05', 'PRODUKSI', null),
  ('125', 'KHOSIUN', 'GRINDA', 80000, 8, date '2026-06-02', true, null, 'PRODUKSI', null),
  ('75', 'IRFAN', 'GRINDA', 80000, 8, date '2026-07-13', true, null, 'PRODUKSI', null),
  ('82', 'YUSUF', 'GRINDA', 80000, 8, date '2026-07-13', false, date '2026-07-17', 'PRODUKSI', null);

-- The one pattern the sheet names must exist in the book in force, or the
-- rows would carry a code nothing can measure a day against (D279).
do $$
begin
  if not exists (
    select 1 from jsonb_array_elements(ops_hr.rules_on(ops_core.office_day()) -> 'schedules') s
     where s ->> 'code' = 'PRODUKSI') then
    raise exception 'PRODUKSI is not in the rule book in force — stop.';
  end if;
end $$;

create temp table _written on commit drop as
with ins as (
  insert into ops_hr.employees
    (employee_no, full_name, position, unit, pay_basis, base_rate, allowance_rate,
     daily_hours, joined_on, paid_leave_days, active, left_on, schedule_code, note)
  select d.employee_no, d.full_name, d.position, 'Workshop', 'daily', d.base_rate, 0,
         d.daily_hours, d.joined_on, 0, d.active, d.left_on, d.schedule_code, d.note
    from _dw d
   where not exists (select 1 from ops_hr.employees e
                      where ops_hr.machine_no(e.employee_no) = ops_hr.machine_no(d.employee_no))
  returning employee_no, active
)
select * from ins;

create temp table _joined on commit drop as
with v(employee_no, full_name, joined_on) as (values
  ('9', 'SUKARJO', date '2026-03-02'),
  ('11', 'SYAHRONI', date '2026-05-18'),
  ('36', 'ANDI', date '2026-03-02'),
  ('16', 'SAKIRIN', date '2026-03-02'),
  ('12', 'SUTRISNO', date '2026-03-02'),
  ('106', 'MUNTOLIB', date '2026-04-27'),
  ('19', 'SITI', date '2026-03-02'),
  ('99', 'NUR AISAH', date '2026-04-13'),
  ('27', 'THOHARI', date '2026-03-02'),
  ('61', 'HENDY', date '2026-03-02'),
  ('109', 'SANDI', date '2026-05-11'),
  ('122', 'SYAHRUL', date '2026-05-25'),
  ('8', 'IRWAN', date '2026-03-02'),
  ('88', 'JAMI', date '2026-03-02'),
  ('139', 'KIDO', date '2026-07-27')
),
upd as (
  update ops_hr.employees e
     set joined_on = v.joined_on, updated_at = now()
    from v
   where e.employee_no = v.employee_no
     and (e.joined_on is null or e.joined_on > v.joined_on)
  returning e.employee_no
)
select * from upd;

select
  (select count(*) from _written where active)      as inserted_active,
  (select count(*) from _written where not active)  as inserted_already_left,
  (select count(*) from _joined)                    as joined_on_corrected,
  (select count(*) from ops_hr.employees where active)     as employees_active_now,
  (select count(*) from ops_hr.employees where not active) as employees_left_now;

commit;
