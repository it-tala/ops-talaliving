-- 199_hr_day_in_out.sql — tap datang dan pulang saja; jam sesuai jadwal;
--                          kurang dari jadwal dicatat (D353).
--
-- Yang dibuktikan, pola PRODUKSI 07.30–16.30 istirahat 45 (8,25 jam),
-- Jumat 07.30–16.00 istirahat 90 (7 jam):
--   • dua tap tepat waktu = 8,25 jam, bukan 8,89 — tidak pernah lebih dari
--     jadwal; tap istirahat tidak diperlukan dan tidak mengubah apa pun;
--   • pulang = tap terakhir: pulang cepat 15.00 = hari kurang, dengan
--     catatan *Kurang … jam dari jadwal*; tetap hadir (nilai 1);
--   • telat masuk juga mengurangi jam;
--   • satu tap = tidak ada pulang → review, dengan alasannya;
--   • lewat jam pulang tampil sebagai lembur, jamnya tetap 8,25;
--   • Jumat memakai jam Jumat (7);
--   • bacaan `schedule` (0195) tidak berubah: satu tap tetap hadir penuh.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-000000019901','hrd199@talaliving.com','{"full_name":"HRD"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-000000019901','hrd','admin');

-- v1 (1 Sep): tap datang dan pulang. v2 (1 Okt): bacaan `schedule` 0195.
insert into ops_hr.pay_rule_sets (version, effective_from, note, rules, created_by) values
 (1, '2026-09-01', 'uji D353', '{
   "week_pattern":"5day","late_grace_minutes":15,"late_mode":"manual","undertime_mode":"off",
   "day_reading":"in_out","hours_rounding_minutes":15,
   "schedules":[
     {"code":"PRODUKSI","name":"Produksi","start_minutes":450,"end_minutes":990,
      "break_minutes":45,"friday_break_minutes":90,"friday_end_minutes":960,"note":null}],
   "schedule_by_unit":{"Workshop":"PRODUKSI"}
 }'::jsonb, 'ffffffff-0000-0000-0000-000000019901'),
 (2, '2026-10-01', 'uji D340', '{
   "week_pattern":"5day","late_grace_minutes":15,"late_mode":"manual","undertime_mode":"off",
   "day_reading":"schedule","hours_rounding_minutes":15,"out_window_minutes":30,
   "schedules":[
     {"code":"PRODUKSI","name":"Produksi","start_minutes":450,"end_minutes":990,
      "break_minutes":45,"friday_break_minutes":90,"friday_end_minutes":960,"note":null}],
   "schedule_by_unit":{"Workshop":"PRODUKSI"}
 }'::jsonb, 'ffffffff-0000-0000-0000-000000019901');

insert into ops_hr.employees
  (id, employee_no, full_name, position, unit, pay_basis, base_rate, allowance_rate,
   daily_hours, joined_on, paid_leave_days)
values
  ('aaaa1990-0000-0000-0000-000000000001','B-1991','Sutrisno uji','Tukang','Workshop',
   'daily', 130000, 0, 8, '2025-01-01', 0);

insert into ops_hr.attendance_scans (employee_id, work_date, at, verify, source, reason)
select 'aaaa1990-0000-0000-0000-000000000001', ops_core.office_day(t), t, 'FP', 'manual', 'uji D353'
  from unnest(array[
    -- Senin 28/9: datang 07.12, pulang 16.45 — dulu terbaca 8,89
    '2026-09-28 07:12','2026-09-28 16:45',
    -- Selasa 29/9: tap istirahat ikut, pulang cepat 15.00
    '2026-09-29 07:25','2026-09-29 12:01','2026-09-29 12:40','2026-09-29 15:00',
    -- Rabu 30/9: satu tap saja
    '2026-09-30 07:20',
    -- Kamis 1/10 dibaca buku v2: satu tap saja
    '2026-10-01 07:20',
    -- Jumat 25/9: telat 08.10, pulang 16.02
    '2026-09-25 08:10','2026-09-25 16:02',
    -- Kamis 24/9: pulang 19.05 — lembur tampil, jam tetap 8,25
    '2026-09-24 07:29','2026-09-24 19:05'
  ]::timestamp[]) s(ts)
  cross join lateral (select s.ts at time zone ops_core.office_tz() as t) x;

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000019901';

do $$
declare d ops_hr.day_reading; e uuid := 'aaaa1990-0000-0000-0000-000000000001';
begin
  select * into d from ops_hr.read_day(e, '2026-09-28');
  assert d.state = 'complete' and d.day_value = 1, 'dua tap = hadir: ' || d.state || ' ' || coalesce(array_to_string(d.issues,'; '),'');
  assert d.work_hours = 8.25, 'tepat waktu = kuota jadwal, bukan 8,89; got ' || d.work_hours;
  assert d.scheduled_hours = 8.25, 'terjadwal 8,25';
  assert coalesce(array_length(d.notes, 1), 0) = 0, 'tidak kurang, tanpa catatan: ' || coalesce(array_to_string(d.notes,'; '),'');
  assert d.overtime_hours = 0.25, 'lewat 16.30 sampai 16.45 tampil 0,25 lembur, got ' || d.overtime_hours;

  select * into d from ops_hr.read_day(e, '2026-09-29');
  assert d.state = 'complete' and d.day_value = 1, 'pulang cepat tetap hadir: ' || d.state;
  assert d.work_hours = 6.75, '07.30–15.00 − 45 menit = 6,75; got ' || d.work_hours;
  assert d.notes[1] like 'Kurang 1.50 jam dari jadwal 8.25 jam%', 'catatan kurang: ' || coalesce(array_to_string(d.notes,'; '),'');
  assert d.break_hours = 0.75, 'istirahat jadwal, bukan tap';

  select * into d from ops_hr.read_day(e, '2026-09-30');
  assert d.state = 'review' and d.day_value = 0, 'satu tap = belum dibaca: ' || d.state;
  assert d.issues[1] = 'Tidak ada tap pulang — tap datang dan pulang wajib', 'alasannya: ' || coalesce(array_to_string(d.issues,'; '),'');

  select * into d from ops_hr.read_day(e, '2026-09-25');
  assert d.scheduled_hours = 7, 'Jumat 7 jam';
  -- 08.10–16.00 − 90 menit = 6h20m → dibulatkan 6,25
  assert d.work_hours = 6.25, 'telat mengurangi jam, got ' || d.work_hours;
  assert d.notes[1] like 'Kurang%', 'dan dicatat';

  select * into d from ops_hr.read_day(e, '2026-09-24');
  assert d.work_hours = 8.25, 'tidak pernah lebih dari jadwal, got ' || d.work_hours;
  assert d.overtime_hours = 2.5, '16.30–19.05 dibulatkan 2,5 lembur, got ' || d.overtime_hours;

  -- Buku v2 membaca `schedule` seperti 0195: satu tap tetap hadir penuh.
  select * into d from ops_hr.read_day(e, '2026-10-01');
  assert d.state = 'complete' and d.work_hours = 8.25, 'schedule tidak berubah: ' || d.state || ' ' || d.work_hours;
end $$;

rollback;
