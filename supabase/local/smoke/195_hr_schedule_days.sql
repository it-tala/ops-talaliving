-- 195_hr_schedule_days.sql — jadwal per hari, hari dibaca sesuai jadwal, dan
--                             Sabtu/Minggu/tanggal merah dibayar 2× (D340).
--
-- Yang dibuktikan, dengan tap minggu 29 Agu – 4 Sep dari payroll sheet:
--   • `schedule_day` memakai jam pola, jam Jumat, lalu jam per hari;
--   • bacaan `schedule`: tap lebih atau kurang tidak membuat hari `review`;
--     jam normal Senin 8,25, Jumat 7, Sabtu 8 menurut jadwal hari itu;
--     pulang yang tidak ada dibaca sesuai jadwal; lembur dari tap terakhir,
--     dibulatkan 15 menit, tidak dibayar dari mesin;
--   • pengali hari: Sabtu 2× dari jadwal, tanggal merah 2× dari buku aturan,
--     dan setengah hari tetap setengah;
--   • upah harian = Σ nilai hari × pengali × tarif; tunjangan hanya hari ×1;
--   • terlambat dihitung dari jam masuk hari itu (Sabtu 08.00);
--   • lembur 1,5× rata dari tarif harian/8 yang tidak dibulatkan, dan bagian
--     lewat 22.00 dibayar 2×;
--   • buku tanpa kunci baru membaca seperti dulu (`slots`);
--   • `set_schedule_days`: izin, catatan, bentuk, dan versi baru yang ditulis.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-000000019501','hrd195@talaliving.com','{"full_name":"HRD"}'),
  ('ffffffff-0000-0000-0000-000000019502','ceo195@talaliving.com','{"full_name":"Pimpinan"}'),
  ('ffffffff-0000-0000-0000-000000019503','lain195@talaliving.com','{"full_name":"Orang lain"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-000000019501','hrd','admin'),
  ('ffffffff-0000-0000-0000-000000019503','procurement','admin');

-- v1: buku lama, tanpa kunci baru. v2 (29 Agu): buku pemilik.
insert into ops_hr.pay_rule_sets (version, effective_from, note, rules, created_by) values
 (1, '2026-01-01', 'uji lama', '{
   "week_pattern":"5day","day_starts_minutes":480,
   "late_grace_minutes":15,"late_mode":"manual","undertime_mode":"off",
   "schedules":[
     {"code":"PRODUKSI","name":"Produksi","start_minutes":450,"end_minutes":990,
      "break_minutes":45,"friday_break_minutes":90,"friday_end_minutes":960,"note":null}],
   "schedule_by_unit":{"Workshop":"PRODUKSI"}
 }'::jsonb, 'ffffffff-0000-0000-0000-000000019501'),
 (2, '2026-08-29', 'uji D340', '{
   "week_pattern":"5day","day_starts_minutes":480,
   "late_grace_minutes":15,"late_mode":"manual","undertime_mode":"off",
   "day_reading":"schedule","hours_rounding_minutes":15,"out_window_minutes":30,
   "holiday_pay_multiplier":2,"allowance_on_premium_days":false,"allowance_by_day_value":true,
   "overtime_mode":"tiered","workday_tiers":[{"after_hours":0,"multiplier":1.5}],
   "restday_tiers":[{"after_hours":0,"multiplier":2}],
   "overtime_night_after_minutes":1320,"overtime_night_multiplier":2,
   "overtime_exact_hourly":true,"hourly_includes_allowance":false,
   "effective_days_per_year":240,
   "schedules":[
     {"code":"PRODUKSI","name":"Produksi","start_minutes":450,"end_minutes":990,
      "break_minutes":45,"friday_break_minutes":90,"friday_end_minutes":960,"note":null,
      "days":{"6":{"start_minutes":480,"end_minutes":960,"break_minutes":0,"pay_multiplier":2},
              "7":{"start_minutes":480,"end_minutes":960,"break_minutes":0,"pay_multiplier":2}}}],
   "schedule_by_unit":{"Workshop":"PRODUKSI"}
 }'::jsonb, 'ffffffff-0000-0000-0000-000000019501');

insert into ops_hr.employees
  (id, employee_no, full_name, position, unit, pay_basis, base_rate, allowance_rate,
   daily_hours, joined_on, user_id, paid_leave_days, schedule_code)
values
  ('aaaa1950-0000-0000-0000-000000000001','B-1951','Karjo uji','Sample maker','Workshop',
   'daily', 170500, 10000, 8, '2025-01-01', null, 12, null);

/* ── schedule_day ──────────────────────────────────────────────────────── */
do $$
declare sc jsonb := ops_hr.schedule_of(ops_hr.rules_on('2026-08-31'), null, 'Workshop');
begin
  assert (ops_hr.schedule_day(sc, '2026-08-31') ->> 'end_minutes')::int = 990, 'Senin pulang 16.30';
  assert (ops_hr.schedule_day(sc, '2026-09-04') ->> 'end_minutes')::int = 960, 'Jumat pulang 16.00';
  assert (ops_hr.schedule_day(sc, '2026-09-04') ->> 'break_minutes')::int = 90, 'Jumat istirahat 90';
  assert (ops_hr.schedule_day(sc, '2026-08-29') ->> 'start_minutes')::int = 480, 'Sabtu masuk 08.00';
  assert (ops_hr.schedule_day(sc, '2026-08-29') ->> 'pay_multiplier')::numeric = 2, 'Sabtu 2x';
  assert (ops_hr.schedule_day(sc, '2026-08-31') ->> 'pay_multiplier')::numeric = 1, 'Senin 1x';
  assert ops_hr.break_allowance(ops_hr.rules_on('2026-08-29'), null, 'Workshop', '2026-08-29') = 0,
    'istirahat Sabtu 0';
end $$;

/* ── taps: the week, straight from the machine ─────────────────────────── */
insert into ops_hr.attendance_scans (employee_id, work_date, at, verify, source, reason)
select 'aaaa1950-0000-0000-0000-000000000001', ops_core.office_day(t), t, 'FP', 'manual', 'uji D340'
  from unnest(array[
    -- Sabtu: 07.34 masuk, 16.03 pulang
    '2026-08-29 07:34','2026-08-29 12:25','2026-08-29 12:38','2026-08-29 16:03',
    -- Senin: tap lebih (12.48), pulang 17.32, lembur sampai 19.59
    '2026-08-31 07:21','2026-08-31 12:02','2026-08-31 12:33','2026-08-31 12:48',
    '2026-08-31 17:32','2026-08-31 17:58','2026-08-31 19:59',
    -- Rabu: satu tap saja
    '2026-09-02 07:28',
    -- Kamis: tanggal merah, tetap masuk
    '2026-09-03 07:55','2026-09-03 16:31',
    -- Jumat: telat 20 menit (lewat toleransi 5), pulang 16.05
    '2026-09-04 07:50','2026-09-04 16:05'
  ]::timestamp[]) s(ts)
  cross join lateral (select s.ts at time zone ops_core.office_tz() as t) x;

insert into ops_hr.day_marks (work_date, kind, reason, marked_by)
values ('2026-09-03','holiday','Maulid Nabi (uji)','ffffffff-0000-0000-0000-000000019501');

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000019501';

do $$
declare d ops_hr.day_reading;
begin
  select * into d from ops_hr.read_day('aaaa1950-0000-0000-0000-000000000001','2026-08-29');
  assert d.state = 'complete' and d.day_value = 1, 'Sabtu hadir: ' || d.state;
  assert d.work_hours = 8, 'Sabtu 8 jam, got ' || d.work_hours;
  assert d.pay_multiplier = 2, 'Sabtu 2x, got ' || d.pay_multiplier;
  assert d.scheduled_hours = 8, 'Sabtu terjadwal 8';

  select * into d from ops_hr.read_day('aaaa1950-0000-0000-0000-000000000001','2026-08-31');
  assert d.state = 'complete', 'tap lebih tidak membuat review: ' || d.state || ' ' || coalesce(array_to_string(d.issues, '; '), '');
  assert d.work_hours = 8.25, 'Senin 8,25 jam, got ' || d.work_hours;
  assert d.overtime_hours = 3.5, 'lembur 16.30–19.59 dibulatkan 3,5, got ' || d.overtime_hours;
  assert d.pay_multiplier = 1;

  select * into d from ops_hr.read_day('aaaa1950-0000-0000-0000-000000000001','2026-09-02');
  assert d.state = 'complete' and d.day_value = 1, 'satu tap tetap hadir';
  assert d.work_hours = 8.25, 'satu tap: pulang sesuai jadwal, got ' || d.work_hours;
  assert array_length(d.notes, 1) = 1, 'satu tap dicatat sebagai catatan';

  select * into d from ops_hr.read_day('aaaa1950-0000-0000-0000-000000000001','2026-09-03');
  assert d.state = 'marked' and d.day_value = 1 and d.pay_multiplier = 2,
    'tanggal merah masuk: 1 hari x2, got ' || d.day_value || ' x' || d.pay_multiplier;

  select * into d from ops_hr.read_day('aaaa1950-0000-0000-0000-000000000001','2026-09-04');
  assert d.work_hours = 6.75, 'Jumat masuk 07.50: 16.00-07.50-1.30 = 6j40m -> 6,75, got ' || d.work_hours;

  select * into d from ops_hr.read_day('aaaa1950-0000-0000-0000-000000000001','2026-09-01');
  assert d.state = 'off' and d.day_value = 0, 'Selasa tanpa tap: off';
end $$;

/* ── the old book still reads the old way ──────────────────────────────── */
do $$
declare d ops_hr.day_reading;
begin
  reset role;
  insert into ops_hr.attendance_scans (employee_id, work_date, at, verify, source, reason)
  select 'aaaa1950-0000-0000-0000-000000000001', ops_core.office_day(t), t, 'FP', 'manual', 'uji D340'
    from unnest(array['2026-08-10 07:21','2026-08-10 12:02','2026-08-10 12:33',
                      '2026-08-10 12:48','2026-08-10 16:35']::timestamp[]) s(ts)
    cross join lateral (select s.ts at time zone ops_core.office_tz() as t) x;
  select * into d from ops_hr.read_day('aaaa1950-0000-0000-0000-000000000001','2026-08-10');
  assert d.state = 'review', 'buku lama: tap lebih tetap review, got ' || d.state;
  assert d.pay_multiplier = 1, 'buku lama: pengali 1';
end $$;

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000019501';

/* ── overtime: a production sheet the leader signed ────────────────────── */
do $$
declare s1 uuid; s2 uuid;
begin
  reset role;
  insert into ops_hr.overtime_sheets (kind, work_date, purpose, created_by,
      hrd_checked_by, hrd_checked_at, leader_approved_by, leader_approved_at)
  values ('production','2026-08-31','Buat alat','ffffffff-0000-0000-0000-000000019501',
      'ffffffff-0000-0000-0000-000000019501', now(), 'ffffffff-0000-0000-0000-000000019502', now())
  returning id into s1;
  insert into ops_hr.overtime_lines (sheet_id, employee_id, hours, task, until_minutes)
  values (s1, 'aaaa1950-0000-0000-0000-000000000001', 3.5, 'Buat alat', 1200);

  insert into ops_hr.overtime_sheets (kind, work_date, purpose, created_by,
      hrd_checked_by, hrd_checked_at, leader_approved_by, leader_approved_at)
  values ('production','2026-09-02','Rakit kursi','ffffffff-0000-0000-0000-000000019501',
      'ffffffff-0000-0000-0000-000000019501', now(), 'ffffffff-0000-0000-0000-000000019502', now())
  returning id into s2;
  insert into ops_hr.overtime_lines (sheet_id, employee_id, hours, task, until_minutes)
  values (s2, 'aaaa1950-0000-0000-0000-000000000001', 6, 'Rakit kursi', 1350);
end $$;

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000019501';

do $$
declare p ops_hr.payroll_figures; n int; night bigint;
begin
  -- 3,5 × 1,5 × 21.312,5 = 111.890,625 → 111.891 (tarif tidak dibulatkan dulu).
  -- Rabu: 5,5 × 1,5 × 21.312,5 = 175.828,125 → 175.828; 0,5 × 2 × 21.312,5 → 21.313.
  select count(*), sum(amount) filter (where multiplier = 2) into n, night
    from ops_hr.overtime_parts('aaaa1950-0000-0000-0000-000000000001','2026-08-29','2026-09-04');
  assert n = 3, 'tiga bagian lembur, got ' || n;
  assert night = 21313, 'lewat 22.00 dibayar 2x, got ' || night;

  select * into p from ops_hr.payroll_line_for('aaaa1950-0000-0000-0000-000000000001','2026-08-29','2026-09-04');
  -- Sab 2 + Sen 1 + Rab 1 + Kam (merah) 2 + Jum 1 = 7 hari upah.
  assert p.base_pay = 7 * 170500, 'upah 7 hari upah, got ' || p.base_pay;
  assert p.worked_days = 5, 'lima hari hadir, got ' || p.worked_days;
  -- Tunjangan hanya Sen, Rab, Jum (hari x1).
  assert p.allowance_days = 3, 'tunjangan 3 hari, got ' || p.allowance_days;
  assert p.allowance_pay = 30000, 'tunjangan 3 x 10.000, got ' || p.allowance_pay;
  assert p.overtime_pay = 111891 + 175828 + 21313, 'lembur, got ' || p.overtime_pay;
  -- Jumat 07.50: 20 menit, toleransi 15 → 5. Sabtu 07.34 terhadap 08.00: tidak telat.
  assert p.late_minutes = 5, 'telat dari jam masuk hari itu, got ' || p.late_minutes;
  assert p.open_days = 0, 'tidak ada hari review';
  assert exists (select 1 from jsonb_array_elements(p.days) x
                  where x ->> 'work_date' = '2026-08-29' and (x ->> 'multiplier')::numeric = 2),
    'slip menyebut pengali Sabtu';
end $$;

/* ── setengah hari: upahnya setengah, tunjangannya setengah ────────────── */
do $$
declare p ops_hr.payroll_figures;
begin
  reset role;
  insert into ops_hr.day_marks (employee_id, work_date, kind, reason, marked_by)
  values ('aaaa1950-0000-0000-0000-000000000001','2026-09-02','half_day','uji','ffffffff-0000-0000-0000-000000019501');
  select * into p from ops_hr.payroll_line_for('aaaa1950-0000-0000-0000-000000000001','2026-08-29','2026-09-04');
  assert p.base_pay = round(6.5 * 170500), 'Rabu setengah: 6,5 hari upah, got ' || p.base_pay;
  assert p.allowance_pay = 25000, 'tunjangan 2,5 x 10.000, got ' || p.allowance_pay;
end $$;

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000019501';

/* ── set_schedule_days ─────────────────────────────────────────────────── */
do $$
declare r jsonb;
begin
  r := ops_hr.set_schedule_days('PRODUKSI',
         '{"7":{"off":true}}'::jsonb, '2026-10-03', '', null);
  assert r -> 'error' ->> 'code' = 'note_required', 'catatan wajib: ' || r::text;

  r := ops_hr.set_schedule_days('PRODUKSI',
         '{"6":{"pay_multiplier":0}}'::jsonb, '2026-10-03', 'uji', null);
  assert r -> 'error' ->> 'code' = 'day_multiplier', 'bentuk ditolak: ' || r::text;

  r := ops_hr.set_schedule_days('PRODUKSI',
         '{"6":{"start_minutes":480,"end_minutes":960,"break_minutes":0,"pay_multiplier":2},"7":{"off":true}}'::jsonb,
         '2026-10-03', 'Minggu libur mulai Oktober', null);
  assert r ->> 'outcome' = 'ok', 'disimpan: ' || r::text;
  assert (ops_hr.schedule_day(ops_hr.schedule_of(ops_hr.rules_on('2026-10-04'), null, 'Workshop'), '2026-10-04') ->> 'off')::boolean,
    'Minggu libur sejak versi baru';
  assert (ops_hr.schedule_day(ops_hr.schedule_of(ops_hr.rules_on('2026-08-30'), null, 'Workshop'), '2026-08-30') ->> 'pay_multiplier')::numeric = 2,
    'versi lama tidak berubah';
end $$;

set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000019503';
do $$
declare r jsonb;
begin
  r := ops_hr.set_schedule_days('PRODUKSI', '{}'::jsonb, '2026-10-10', 'uji', null);
  assert r -> 'error' ->> 'code' = 'not_permitted', 'bukan HRD ditolak: ' || r::text;
end $$;

rollback;
