-- 206_hr_shift_reading.sql — shift Satpam dibaca dari tap; HRD memilih
-- shift bila tap tidak cukup (D364).
--
-- Pola SATPAM: Shift 1 07.00–17.00, Shift 2 17.00–07.00, tanpa istirahat;
-- 1 shift = 1 hari upah. Yang dibuktikan:
--   • Shift 2 terbaca dari 17.02 sampai 07.01 esok paginya — hari Senin,
--     14 jam, bukan dua hari pendek;
--   • Shift 1 dan Shift 2 berganti tanpa pola — tiap hari terbaca sendiri;
--   • tap yang tidak berpasangan (lupa tap pulang) = review, dengan alasan;
--     dan tidak merusak pembacaan hari sesudahnya;
--   • tap terakhir yang shift-nya belum selesai = sedang berjalan;
--   • HRD memilih shift untuk hari yang terbaca salah; hari di sekitarnya
--     ikut terbaca ulang; pilihan bisa dicabut;
--   • terlambat dihitung dari jam masuk shift-nya (17.00 untuk Shift 2);
--   • pola tanpa shift tidak berubah; kesalahan bentuk shift ditolak.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-000000020601','hrd206@talaliving.com','{"full_name":"HRD"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-000000020601','hrd','admin');

insert into ops_hr.pay_rule_sets (version, effective_from, note, rules, created_by) values
 (1, '2026-08-01', 'uji D364', '{
   "week_pattern":"6day","late_grace_minutes":0,"late_mode":"manual","undertime_mode":"off",
   "day_reading":"in_out","hours_rounding_minutes":15,
   "schedules":[
     {"code":"PRODUKSI","name":"Produksi","start_minutes":450,"end_minutes":990,"break_minutes":45,
      "friday_break_minutes":null,"friday_end_minutes":null,"note":null},
     {"code":"SATPAM","name":"Satpam","start_minutes":420,"end_minutes":1020,"break_minutes":0,
      "friday_break_minutes":null,"friday_end_minutes":null,"note":null,
      "shifts":[{"code":"S1","name":"Shift 1","start_minutes":420,"end_minutes":1020},
                {"code":"S2","name":"Shift 2","start_minutes":1020,"end_minutes":420}]}],
   "schedule_by_unit":{"Workshop":"PRODUKSI","Security":"SATPAM"}
 }'::jsonb, 'ffffffff-0000-0000-0000-000000020601');

insert into ops_hr.employees
  (id, employee_no, full_name, position, unit, pay_basis, base_rate, allowance_rate,
   daily_hours, joined_on, paid_leave_days)
values
  ('aaaa2060-0000-0000-0000-000000000001','S-2061','Kido uji','Satpam','Security','daily',150000,0,12,'2025-01-01',0),
  ('aaaa2060-0000-0000-0000-000000000002','S-2062','Jami uji','Satpam','Security','daily',150000,0,12,'2025-01-01',0),
  ('aaaa2060-0000-0000-0000-000000000003','S-2063','Guntur uji','Satpam','Security','daily',150000,0,12,'2025-01-01',0),
  ('aaaa2060-0000-0000-0000-000000000004','S-2064','Malam nanti','Satpam','Security','daily',150000,0,12,'2025-01-01',0),
  ('aaaa2060-0000-0000-0000-000000000005','B-2065','Tukang uji','Tukang','Workshop','daily',130000,0,8,'2025-01-01',0);

insert into ops_hr.attendance_scans (employee_id, work_date, at, verify, source, reason)
select e::uuid, ops_core.office_day(t), t, 'FP', 'manual', 'uji D364'
  from (values
    -- Kido: Shift 2 tiga malam berturut-turut; tap dobel 17.02/17.04 = satu.
    ('aaaa2060-0000-0000-0000-000000000001','2026-09-14 17:02'),
    ('aaaa2060-0000-0000-0000-000000000001','2026-09-14 17:04'),
    ('aaaa2060-0000-0000-0000-000000000001','2026-09-15 07:01'),
    ('aaaa2060-0000-0000-0000-000000000001','2026-09-15 17:20'),
    ('aaaa2060-0000-0000-0000-000000000001','2026-09-16 07:00'),
    ('aaaa2060-0000-0000-0000-000000000001','2026-09-16 17:03'),
    ('aaaa2060-0000-0000-0000-000000000001','2026-09-17 06:30'),
    -- Jami: lupa pulang 14/09, lalu Shift 1, Shift 1, lalu Shift 2.
    ('aaaa2060-0000-0000-0000-000000000002','2026-09-14 07:07'),
    ('aaaa2060-0000-0000-0000-000000000002','2026-09-15 07:03'),
    ('aaaa2060-0000-0000-0000-000000000002','2026-09-15 17:11'),
    ('aaaa2060-0000-0000-0000-000000000002','2026-09-16 06:59'),
    ('aaaa2060-0000-0000-0000-000000000002','2026-09-16 17:10'),
    ('aaaa2060-0000-0000-0000-000000000002','2026-09-17 16:58'),
    ('aaaa2060-0000-0000-0000-000000000002','2026-09-18 07:05'),
    -- Guntur: masuk Shift 2 tanggal 13 tidak tercatat, jadi rantai 07/17
    -- terbaca dari ujung yang salah sampai HRD memilih.
    ('aaaa2060-0000-0000-0000-000000000003','2026-09-14 07:00'),
    ('aaaa2060-0000-0000-0000-000000000003','2026-09-14 17:00'),
    ('aaaa2060-0000-0000-0000-000000000003','2026-09-15 07:00'),
    -- Malam nanti: Shift 1 hari ini masih berjalan (tanggal jauh di depan).
    ('aaaa2060-0000-0000-0000-000000000004','2099-01-05 07:02'),
    -- Tukang: pola tanpa shift.
    ('aaaa2060-0000-0000-0000-000000000005','2026-09-14 07:25'),
    ('aaaa2060-0000-0000-0000-000000000005','2026-09-14 16:35')
  ) v(e, ts)
  cross join lateral (select v.ts::timestamp at time zone ops_core.office_tz() as t) x;

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000020601';

do $$
declare d ops_hr.day_reading; a jsonb; p ops_hr.payroll_figures;
  kido uuid := 'aaaa2060-0000-0000-0000-000000000001';
  jami uuid := 'aaaa2060-0000-0000-0000-000000000002';
  gun  uuid := 'aaaa2060-0000-0000-0000-000000000003';
begin
  /* ── Kido: Shift 2, three nights ── */
  select * into d from ops_hr.read_day(kido, '2026-09-14');
  assert d.shift_code = 'S2' and d.shift_name = 'Shift 2', 'Senin malam = Shift 2, got ' || coalesce(d.shift_code,'(null)');
  assert d.state = 'complete' and d.day_value = 1, 'satu shift = satu hari: ' || d.state || ' ' || coalesce(array_to_string(d.issues,'; '),'');
  assert d.work_hours = 14 and d.scheduled_hours = 14, '17.02–07.01 = 14 jam, got ' || d.work_hours || ' / ' || d.scheduled_hours;
  assert d.in_at = '2026-09-14 17:02'::timestamp at time zone ops_core.office_tz()
     and d.out_at = '2026-09-15 07:01'::timestamp at time zone ops_core.office_tz(), 'masuk dan pulang';
  assert d.overnight, 'Shift 2 melewati tengah malam';
  assert d.window_from <= d.in_at and d.window_to > d.out_at, 'jendela memuat tap-nya';
  assert d.notes @> array['1 tap lain di shift ini tidak dihitung'] is false, 'tap dobel 2 menit sudah satu: ' || coalesce(array_to_string(d.notes,'; '),'');

  select * into d from ops_hr.read_day(kido, '2026-09-15');
  assert d.shift_code = 'S2' and d.state = 'complete', 'Selasa malam: ' || coalesce(d.shift_code,'-') || ' ' || d.state;
  -- 17.20–07.00 = 13 j 40 m → 13,75; terlambat 20 menit
  assert d.work_hours = 13.75, 'masuk 17.20 mengurangi jam, got ' || d.work_hours;
  assert d.notes[1] like 'Kurang 0.25 jam dari jadwal 14.00 jam%', 'kurang dicatat: ' || coalesce(array_to_string(d.notes,'; '),'');

  select * into d from ops_hr.read_day(kido, '2026-09-16');
  -- pulang 06.30 = 13 j 27 m → 13,5
  assert d.shift_code = 'S2' and d.work_hours = 13.5, 'pulang cepat 06.30, got ' || d.work_hours;

  select * into d from ops_hr.read_day(kido, '2026-09-17');
  assert d.state = 'off' and d.taps = 0, 'pagi 17/09 milik malam 16/09: ' || d.state;

  /* ── Jami: lupa pulang, lalu Shift 1, Shift 1, Shift 2 ── */
  select * into d from ops_hr.read_day(jami, '2026-09-14');
  assert d.state = 'review' and d.day_value = 0, 'satu tap = review: ' || d.state;
  assert d.issues[1] like 'Satu tap tanpa pasangan%', 'alasannya: ' || coalesce(array_to_string(d.issues,'; '),'');
  assert d.shift_code = 'S1', 'tap 07.07 sendirian dibaca sebagai masuk Shift 1';

  select * into d from ops_hr.read_day(jami, '2026-09-15');
  assert d.shift_code = 'S1' and d.state = 'complete' and d.work_hours = 10,
    'Shift 1 07.03–17.11 = 10 jam: ' || coalesce(d.shift_code,'-') || ' ' || d.state || ' ' || d.work_hours;
  assert d.overtime_hours = 0.25, 'lewat 17.00 tampil lembur, got ' || d.overtime_hours;
  assert not d.overnight, 'Shift 1 tidak melewati tengah malam';

  select * into d from ops_hr.read_day(jami, '2026-09-16');
  assert d.shift_code = 'S1' and d.state = 'complete', '16/09 Shift 1: ' || coalesce(d.shift_code,'-');

  select * into d from ops_hr.read_day(jami, '2026-09-17');
  assert d.shift_code = 'S2' and d.state = 'complete' and d.work_hours = 14,
    'Shift 2 16.58–07.05: ' || coalesce(d.shift_code,'-') || ' ' || d.state || ' ' || d.work_hours;

  /* ── Guntur: read from the wrong end until HRD picks ── */
  select * into d from ops_hr.read_day(gun, '2026-09-14');
  assert d.shift_code = 'S1' and d.state = 'complete', 'tanpa pilihan: Shift 1 07.00–17.00';
  select * into d from ops_hr.read_day(gun, '2026-09-15');
  assert d.state = 'review', 'dan 15/09 07.00 sendirian';

  a := ops_hr.pick_shift('S-2063', '2026-09-14', 'S2', '');
  assert a -> 'error' ->> 'code' = 'reason_required', a::text;
  a := ops_hr.pick_shift('S-2063', '2026-09-14', 'S9', 'Buku jaga');
  assert a -> 'error' ->> 'code' = 'shift_unknown', a::text;
  a := ops_hr.pick_shift('S-2063', '2026-09-14', 'S2', 'Buku jaga: malam');
  assert ops_core.said_ok(a), a::text;
  a := ops_hr.pick_shift('S-2063', '2026-09-14', 'S2', 'Buku jaga: malam');
  assert a ->> 'outcome' = 'noop', a::text;

  select * into d from ops_hr.read_day(gun, '2026-09-14');
  assert d.shift_code = 'S2' and d.state = 'complete' and d.work_hours = 14,
    'dipilih Shift 2: 17.00–07.00: ' || coalesce(d.shift_code,'-') || ' ' || d.state || ' ' || d.work_hours;
  assert d.notes @> array['Shift dipilih HRD: Shift 2'], 'catatan pilihan: ' || coalesce(array_to_string(d.notes,'; '),'');
  assert d.notes @> array['1 tap lain di shift ini tidak dihitung'], '07.00 pagi itu tidak dihitung: ' || coalesce(array_to_string(d.notes,'; '),'');
  select * into d from ops_hr.read_day(gun, '2026-09-15');
  assert d.state = 'off', '15/09 07.00 kini pulang malam 14/09: ' || d.state;

  a := ops_hr.pick_shift('S-2063', '2026-09-14', null, null);
  assert ops_core.said_ok(a), a::text;
  select * into d from ops_hr.read_day(gun, '2026-09-14');
  assert d.shift_code = 'S1', 'pilihan dicabut, kembali dibaca dari tap';

  /* ── a shift still going ── */
  select * into d from ops_hr.read_day('aaaa2060-0000-0000-0000-000000000004', '2099-01-05');
  assert d.state = 'review' and d.issues[1] = 'Shift 1 sedang berjalan — belum ada tap pulang',
    'berjalan: ' || coalesce(array_to_string(d.issues,'; '),'');

  /* ── a pattern without shifts is read as before ── */
  select * into d from ops_hr.read_day('aaaa2060-0000-0000-0000-000000000005', '2026-09-14');
  assert d.shift_code is null and d.work_hours = 8.25, 'pola biasa tidak berubah, got ' || d.work_hours;

  /* ── late against the shift's own start; one shift is one day ── */
  select * into p from ops_hr.payroll_line_for(kido, '2026-09-14', '2026-09-16');
  assert p.worked_days = 3 and p.base_pay = 3 * 150000, 'tiga shift = tiga hari, got ' || p.worked_days;
  assert p.late_minutes = 25 and p.late_days = 3, '2 + 20 + 3 menit dari 17.00, got ' || p.late_minutes || '/' || p.late_days;
  assert exists (select 1 from jsonb_array_elements(p.days) x where x ->> 'shift' = 'S2'), 'slip menyebut shift';

  /* ── timesheet carries the shift ── */
  assert (select shift_name from ops_hr.timesheet_rows('2026-09-15','2026-09-15', null, 'S-2062')) = 'Shift 1',
    'timesheet_rows membawa nama shift';

  /* ── HRD sets the shifts; shape refused in the same words as the screen ── */
  a := ops_hr.set_schedule_shifts('PRODUKSI', '[{"code":"P1","name":"Pagi","start_minutes":420,"end_minutes":420}]', '2026-09-20', 'uji');
  assert a -> 'error' ->> 'code' = 'shift_end_before_start', a::text;
  a := ops_hr.set_schedule_shifts('SATPAM', '[{"code":"s1","name":"Pagi","start_minutes":420,"end_minutes":1020}]', '2026-09-20', 'uji');
  assert a -> 'error' ->> 'code' = 'shift_code', a::text;
  a := ops_hr.set_schedule_shifts('SATPAM', '[]', '2026-09-20', '');
  assert a -> 'error' ->> 'code' = 'note_required', a::text;
  a := ops_hr.set_schedule_shifts('SATPAM', '[]', '2026-09-20', 'Satpam kembali jam tetap');
  assert ops_core.said_ok(a), a::text;
  assert not (ops_hr.pattern_on(null, 'Security', '2026-09-21') ? 'shifts'), 'shift dihapus mulai 20/09';
  assert ops_hr.pattern_on(null, 'Security', '2026-09-19') ? 'shifts', 'sebelum itu tetap';
end $$;

rollback;
