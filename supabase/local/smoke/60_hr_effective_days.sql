-- 60_hr_effective_days.sql — hari kerja efektif berhenti jadi tebakan.
--
-- Yang dibuktikan: angkanya dihitung dari kalender yang sudah dipegang
-- sistem, bukan dikarang; penguraiannya (hari kalender − istirahat mingguan −
-- tanggal merah di hari kerja) benar-benar kembali ke `is_rest_day`, karena
-- dua cara menghitung hal yang sama adalah cara mereka mulai berbeda;
-- tanggal merah yang jatuh di hari libur tidak mengurangi apa pun; polanya
-- mengubah jawabannya; **IT bisa melihat tanggal merah meski tidak punya
-- `hrd.read`** (F135 di pintu ketiga); dan orang yang tidak berhak tidak
-- mendapat angkanya sama sekali.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-000000006001','it60@talaliving.com','{"full_name":"IT"}'),
  ('ffffffff-0000-0000-0000-000000006002','gaji60@talaliving.com','{"full_name":"Payroll"}'),
  ('ffffffff-0000-0000-0000-000000006003','lain60@talaliving.com','{"full_name":"Orang lain"}');
insert into ops_core.user_modules (user_id, module, level) values
  -- IT saja. Tanpa hrd sama sekali: itulah yang membuat definer perlu.
  ('ffffffff-0000-0000-0000-000000006001','it','admin'),
  ('ffffffff-0000-0000-0000-000000006002','payroll','read'),
  ('ffffffff-0000-0000-0000-000000006003','procurement','admin');

-- 2026: 1 Januari jatuh Kamis, 20 Maret Jumat, 22 Maret Minggu.
insert into ops_hr.day_marks (work_date, employee_id, kind, reason, marked_by) values
  ('2026-01-01', null, 'holiday', 'Tahun Baru',        'ffffffff-0000-0000-0000-000000006001'),
  ('2026-03-20', null, 'holiday', 'Nyepi',             'ffffffff-0000-0000-0000-000000006001'),
  ('2026-03-22', null, 'holiday', 'jatuh di hari libur','ffffffff-0000-0000-0000-000000006001'),
  -- Ditarik kembali: tidak boleh ikut dihitung, dan tidak boleh ikut terdaftar.
  ('2026-04-01', null, 'holiday', 'salah catat',       'ffffffff-0000-0000-0000-000000006001');
update ops_hr.day_marks set withdrawn_at = now(),
       withdrawn_by = 'ffffffff-0000-0000-0000-000000006001', withdrawn_reason = 'keliru'
 where work_date = '2026-04-01';

set local role authenticated;

/* ── IT: lima hari, dan penguraiannya harus kembali ke totalnya ────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000006001';
do $$
declare j jsonb;
begin
  j := ops_hr.effective_days_calendar('{"week_pattern":"5day","effective_days_per_year":240}'::jsonb, 2026);

  assert (j ->> 'calendar_days')::int = 365, format('365 hari, got %s', j);
  -- 2026 punya 52 Sabtu dan 52 Minggu.
  assert (j ->> 'weekly_rest_days')::int = 104, format('104 hari istirahat, got %s', j);
  -- Tiga tercatat dan masih berlaku; yang ditarik tidak dihitung.
  assert (j ->> 'holidays_recorded')::int = 3, format('3 tercatat, got %s', j);
  -- Hanya dua yang jatuh di hari kerja — 22 Maret hari Minggu dan tidak
  -- mengurangi apa pun, karena hari itu memang sudah libur.
  assert (j ->> 'holidays_on_workdays')::int = 2, format('2 di hari kerja, got %s', j);

  /* Ini asersi yang paling menanggung beban di berkas ini. `working_days`
     dihitung sekali oleh `is_rest_day`, dan tiga angka di atas hanya
     menjelaskannya. Kalau penjelasannya tidak kembali ke angkanya, salah satu
     dari keduanya bohong — dan layar menampilkan keduanya bersebelahan. */
  assert (j ->> 'working_days')::int
       = (j ->> 'calendar_days')::int
       - (j ->> 'weekly_rest_days')::int
       - (j ->> 'holidays_on_workdays')::int,
    format('penguraian tidak kembali ke totalnya: %s', j);
  assert (j ->> 'working_days')::int = 259, format('259, got %s', j);

  -- Selisih terhadap angka yang diketik, bertanda: 240 − 259.
  assert (j ->> 'typed')::int = 240, format('got %s', j);
  assert (j ->> 'difference')::int = -19, format('got %s', j);

  -- Daftarnya bisa dibaca, dan yang ditarik tidak ada di dalamnya.
  assert jsonb_array_length(j -> 'holidays') = 3, format('got %s', j -> 'holidays');
  assert (j -> 'holidays')::text not like '%salah catat%', 'yang ditarik masih terdaftar';
end $$;

/* ── polanya mengubah jawabannya ───────────────────────────────────────── */
do $$
declare lima jsonb; enam jsonb;
begin
  lima := ops_hr.effective_days_calendar('{"week_pattern":"5day"}'::jsonb, 2026);
  enam := ops_hr.effective_days_calendar('{"week_pattern":"6day"}'::jsonb, 2026);
  assert (enam ->> 'weekly_rest_days')::int = 52, format('enam hari: 52 Minggu, got %s', enam);
  -- Enam hari kerja berarti Sabtu ikut bekerja, jadi hari kerjanya lebih
  -- banyak — dan Nyepi yang jatuh Jumat tetap dipotong di kedua pola.
  assert (enam ->> 'working_days')::int > (lima ->> 'working_days')::int,
    format('enam hari harus lebih banyak: %s vs %s', enam ->> 'working_days', lima ->> 'working_days');
  assert (enam ->> 'days_per_week')::int = 6 and (lima ->> 'days_per_week')::int = 5,
    'jumlah hari seminggu ikut dilaporkan';
end $$;

/* ── payroll boleh membaca, orang lain tidak dapat apa-apa ─────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000006002';
do $$
declare j jsonb;
begin
  j := ops_hr.effective_days_calendar('{"week_pattern":"5day"}'::jsonb, 2026);
  assert j is not null, 'payroll.read seharusnya boleh membaca kalender (D271)';
  -- Dan ia melihat tanggal merah yang sama, bukan nol: payroll pun tidak
  -- selalu punya hrd.read.
  assert (j ->> 'holidays_on_workdays')::int = 2, format('got %s', j);
end $$;

set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000006003';
do $$
declare j jsonb;
begin
  j := ops_hr.effective_days_calendar('{"week_pattern":"5day"}'::jsonb, 2026);
  assert j is null, 'orang tanpa payroll.read atau it.update mendapat angkanya';
end $$;

/* ── tahun yang tidak masuk akal tidak dijawab dengan angka ────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000006001';
do $$
begin
  assert ops_hr.effective_days_calendar('{}'::jsonb, null) is null, 'tahun null dijawab';
  assert ops_hr.effective_days_calendar('{}'::jsonb, 12) is null, 'tahun 12 dijawab';
end $$;

rollback;
