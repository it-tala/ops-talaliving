-- 202_hr_pay_week_thursday.sql — minggu gaji Jumat–Kamis, disetujui Kamis
-- dengan Kamis diasumsikan penuh; lembur Kamis dibayar minggu depan (D357).
--
-- Yang dibuktikan, minggu Jum 25/09 – Kam 01/10, tarif harian 160.000
-- (jam lembur 20.000 × 1,5):
--   • Kamis yang baru punya satu tap dihitung penuh sesuai jadwal: nilai 1,
--     8,25 jam, tidak *open*, slip menandainya `assumed`, dengan peringatan;
--   • lembur yang dibayar = Kam 24/09 s.d. Rab 30/09: lembur Kamis lalu
--     masuk, lembur Kamis ini tidak — ia masuk minggu berikutnya;
--   • Kamis yang ditandai HRD (sakit) tidak diasumsikan;
--   • orang yang keluar Rabu tidak dibayar Kamis;
--   • gaji bulanan dan periode yang bukan minggu gaji tidak diproyeksikan;
--   • tanpa kunci di buku aturan, tidak ada yang berubah.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-000000020201','hrd202@talaliving.com','{"full_name":"HRD"}'),
  ('ffffffff-0000-0000-0000-000000020202','ceo202@talaliving.com','{"full_name":"Pimpinan"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-000000020201','hrd','admin');

insert into ops_hr.pay_rule_sets (version, effective_from, note, rules, created_by) values
 (1, '2026-09-01', 'uji D357', '{
   "week_pattern":"5day","late_grace_minutes":15,"late_mode":"manual","undertime_mode":"off",
   "day_reading":"in_out","hours_rounding_minutes":15,
   "pay_week_starts_isodow":5,"pay_week_assume_last_day":true,
   "overtime_mode":"tiered","workday_tiers":[{"after_hours":0,"multiplier":1.5}],
   "restday_tiers":[{"after_hours":0,"multiplier":2}],
   "overtime_exact_hourly":true,"hourly_includes_allowance":false,
   "effective_days_per_year":240,
   "schedules":[
     {"code":"PRODUKSI","name":"Produksi","start_minutes":450,"end_minutes":990,
      "break_minutes":45,"friday_break_minutes":90,"friday_end_minutes":960,"note":null}],
   "schedule_by_unit":{"Workshop":"PRODUKSI","Kantor":"PRODUKSI"}
 }'::jsonb, 'ffffffff-0000-0000-0000-000000020201');

insert into ops_hr.employees
  (id, employee_no, full_name, position, unit, pay_basis, base_rate, allowance_rate,
   daily_hours, joined_on, left_on, active, paid_leave_days)
values
  ('aaaa2020-0000-0000-0000-000000000001','B-2021','Harian uji','Tukang','Workshop',
   'daily', 160000, 0, 8, '2025-01-01', null, true, 0),
  ('aaaa2020-0000-0000-0000-000000000002','B-2022','Sakit Kamis','Tukang','Workshop',
   'daily', 160000, 0, 8, '2025-01-01', null, true, 0),
  ('aaaa2020-0000-0000-0000-000000000003','B-2023','Keluar Rabu','Tukang','Workshop',
   'daily', 160000, 0, 8, '2025-01-01', '2026-09-30', false, 0),
  ('aaaa2020-0000-0000-0000-000000000004','K-2024','Bulanan uji','Admin','Kantor',
   'monthly', 4000000, 0, 8, '2025-01-01', null, true, 0);

-- Jum 25, Sen 28, Sel 29, Rab 30: datang dan pulang. Kam 01/10: baru tap datang.
insert into ops_hr.attendance_scans (employee_id, work_date, at, verify, source, reason)
select e.id, ops_core.office_day(t), t, 'FP', 'manual', 'uji D357'
  from (values ('aaaa2020-0000-0000-0000-000000000001'::uuid),
               ('aaaa2020-0000-0000-0000-000000000002'::uuid),
               ('aaaa2020-0000-0000-0000-000000000003'::uuid),
               ('aaaa2020-0000-0000-0000-000000000004'::uuid)) e(id)
  cross join unnest(array[
    '2026-09-25 07:25','2026-09-25 16:05',
    '2026-09-28 07:25','2026-09-28 16:35',
    '2026-09-29 07:25','2026-09-29 16:35',
    '2026-09-30 07:25','2026-09-30 16:35',
    '2026-10-01 07:20'
  ]::timestamp[]) s(ts)
  cross join lateral (select s.ts at time zone ops_core.office_tz() as t) x
 where not (e.id = 'aaaa2020-0000-0000-0000-000000000003' and s.ts >= '2026-10-01');

insert into ops_hr.day_marks (work_date, employee_id, kind, reason, marked_by)
values ('2026-10-01','aaaa2020-0000-0000-0000-000000000002','sick','Demam (uji)',
        'ffffffff-0000-0000-0000-000000020201');

-- Lembur yang sudah ditandatangani: Kam 24/09 2 jam, Rab 30/09 1 jam, Kam 01/10 3 jam.
do $$
declare s uuid; r record;
begin
  for r in select * from (values ('2026-09-24'::date, 2::numeric), ('2026-09-30', 1), ('2026-10-01', 3)) v(d, h) loop
    insert into ops_hr.overtime_sheets (kind, work_date, purpose, created_by,
        hrd_checked_by, hrd_checked_at, leader_approved_by, leader_approved_at)
    values ('production', r.d, 'Kejar kiriman', 'ffffffff-0000-0000-0000-000000020201',
        'ffffffff-0000-0000-0000-000000020201', now(), 'ffffffff-0000-0000-0000-000000020202', now())
    returning id into s;
    insert into ops_hr.overtime_lines (sheet_id, employee_id, hours, task)
    values (s, 'aaaa2020-0000-0000-0000-000000000001', r.h, 'Kejar kiriman');
  end loop;
end $$;

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000020201';

do $$
declare p ops_hr.payroll_figures; thu jsonb;
begin
  assert ops_hr.pay_week_projected(ops_hr.rules_on('2026-09-25'), '2026-09-25', '2026-10-01'),
    'Jum–Kam adalah minggu gaji yang diproyeksikan';
  assert not ops_hr.pay_week_projected(ops_hr.rules_on('2026-09-25'), '2026-09-26', '2026-10-02'),
    'Sab–Jum bukan';
  assert not ops_hr.pay_week_projected('{"pay_week_starts_isodow":5}'::jsonb, '2026-09-25', '2026-10-01'),
    'tanpa kunci, tidak diproyeksikan';

  select * into p from ops_hr.payroll_line_for('aaaa2020-0000-0000-0000-000000000001','2026-09-25','2026-10-01');
  assert p.open_days = 0, 'Kamis tidak menahan persetujuan, open ' || p.open_days;
  assert p.worked_days = 5, 'Jum, Sen, Sel, Rab + Kamis diasumsikan = 5, got ' || p.worked_days;
  assert p.base_pay = 5 * 160000, 'upah 5 hari, got ' || p.base_pay;
  select x into thu from jsonb_array_elements(p.days) x where x ->> 'work_date' = '2026-10-01';
  assert (thu ->> 'assumed')::boolean and (thu ->> 'work_hours')::numeric = 8.25
     and (thu ->> 'open')::boolean = false, 'Kamis di slip: ' || thu::text;
  assert p.overtime_hours = 3, 'lembur Kam 24/09 (2) + Rab 30/09 (1), bukan Kam 01/10, got ' || p.overtime_hours;
  assert p.overtime_pay = 90000, '3 × 1,5 × 20.000, got ' || p.overtime_pay;
  assert exists (select 1 from unnest(p.warnings) w where w like '01/10 dihitung hadir penuh%'),
    'peringatan asumsi: ' || array_to_string(p.warnings, ' | ');
  assert exists (select 1 from unnest(p.warnings) w where w = 'Lembur yang dibayar di sini: 24/09 s.d. 30/09'),
    'peringatan jendela lembur: ' || array_to_string(p.warnings, ' | ');

  -- Minggu berikutnya membayar lembur Kamis 01/10.
  select * into p from ops_hr.payroll_line_for('aaaa2020-0000-0000-0000-000000000001','2026-10-02','2026-10-08');
  assert p.overtime_hours = 3, 'lembur Kam 01/10 dibayar minggu depan, got ' || p.overtime_hours;

  -- Kamis yang ditandai HRD tidak diasumsikan.
  select * into p from ops_hr.payroll_line_for('aaaa2020-0000-0000-0000-000000000002','2026-09-25','2026-10-01');
  assert p.worked_days = 4, 'sakit tanpa surat = tidak dibayar, got ' || p.worked_days;

  -- Keluar Rabu: Kamis bukan harinya.
  select * into p from ops_hr.payroll_line_for('aaaa2020-0000-0000-0000-000000000003','2026-09-25','2026-10-01');
  assert p.worked_days = 4, 'tidak dibayar Kamis setelah keluar, got ' || p.worked_days;

  -- Gaji bulanan tidak diproyeksikan: Kamis satu tap tetap belum dibaca.
  select * into p from ops_hr.payroll_line_for('aaaa2020-0000-0000-0000-000000000004','2026-09-25','2026-10-01');
  assert p.open_days = 1, 'bulanan tidak diasumsikan, open ' || p.open_days;

  -- Periode yang bukan minggu gaji tidak diproyeksikan.
  select * into p from ops_hr.payroll_line_for('aaaa2020-0000-0000-0000-000000000001','2026-09-28','2026-10-01');
  assert p.open_days = 1, 'Sen–Kam bukan minggu gaji, open ' || p.open_days;
end $$;

rollback;
