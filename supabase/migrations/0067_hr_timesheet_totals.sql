-- 0067_hr_timesheet_totals.sql — berapa jam dan berapa hari, per orang, untuk
--                                satu periode.
--
-- `/hrd/absensi` sudah menggambar tiap hari tiap orang, dan itu jawaban atas
-- *hari ini kenapa*. Yang tidak bisa dijawabnya adalah pertanyaan yang justru
-- ditanyakan lebih dulu: **berapa jam Karjo bulan ini, dan berapa harinya**.
-- Datanya sudah ada sejak `0057`; yang belum ada adalah penjumlahannya.
--
-- ## Kenapa di sini dan bukan di peramban
--
-- Menjumlahkan baris yang sudah dipegang klien terlihat seperti perakitan, dan
-- `0057` sudah menolak alasan itu untuk total payroll dengan kalimat yang sama
-- berlakunya di sini: *dua implementasi yang melakukan aritmetika itu adalah
-- dua kesempatan membulatkannya berbeda*. Jam kerja adalah angka yang akan
-- dibawa orang ke percakapan tentang gaji, jadi ia dihitung satu kali, di
-- tempat yang sama dengan harinya.
--
-- ## Yang membuat sebuah total jujur
--
-- **`days_review` berdiri di sebelah totalnya, bukan di catatan kaki.** Sebuah
-- periode dengan empat hari yang belum dibaca punya total yang pasti terlalu
-- kecil, dan total yang terlalu kecil tanpa keterangan adalah angka yang
-- dipercaya. Itu sebabnya yang dikembalikan bukan satu angka melainkan
-- hitungan tiap keadaan hari — lengkap, belum dibaca, ditandai HRD, dan tidak
-- ada absensi sama sekali — sehingga layarnya bisa mengatakan *16,58 jam dari
-- 2 hari, 4 hari belum dibaca* dan bukan *16,58 jam*.
--
-- **`overtime_hours` di sini adalah yang dilihat mesin, bukan yang dibayar.**
-- Lembur dibayar dari lembar yang ditandatangani (D145–D147), bukan dari jam
-- di mesin; angkanya ada supaya selisihnya terlihat — jam lewat jam kerja yang
-- belum diklaim siapa pun adalah pertanyaan untuk HRD, dan menyembunyikannya
-- membuat lembar yang tidak pernah dibuat jadi tidak terlihat.
--
-- Dibangun di atas `timesheet_rows` supaya satu hari hanya punya satu
-- definisi: kalau pembacaan harinya berubah, totalnya ikut, tanpa ada yang
-- perlu diingat.

create type ops_hr.timesheet_total_t as (
  employee_no     text,
  full_name       text,
  unit            text,
  -- Nilai periodenya dalam hari: setengah hari adalah 0,5 dan hari yang belum
  -- dibaca adalah nol sampai ada yang membacanya.
  days_counted    numeric,
  days_complete   int,
  days_review     int,
  days_marked     int,
  days_off        int,
  work_hours      numeric,
  break_hours     numeric,
  overtime_hours  numeric
);

create or replace function ops_hr.timesheet_totals(
  p_from date, p_to date, p_unit text default null, p_employee_no text default null)
returns setof ops_hr.timesheet_total_t
language sql stable set search_path = ops_hr, pg_temp as $$
  -- **Tidak ada `round()` di sini, dan itu disengaja.** Tiap hari sudah keluar
  -- dari `span_hours` dengan dua desimal dan `day_value` hanya bernilai 0, 0,5
  -- atau 1, jadi jumlah `numeric`-nya eksak. Pembulatan di lapisan ini tidak
  -- pernah mengubah satu angka pun — ia hanya terlihat seperti kehati-hatian,
  -- dan sebuah penjaga yang tidak bisa gagal adalah penjaga yang tidak pernah
  -- diuji (F95). Ditemukan oleh mutasi yang menghapusnya dan lolos.
  select
    t.employee_no,
    t.full_name,
    e.unit,
    sum(t.day_value),
    count(*) filter (where t.state = 'complete')::int,
    count(*) filter (where t.state = 'review')::int,
    count(*) filter (where t.state = 'marked')::int,
    count(*) filter (where t.state = 'off')::int,
    sum(t.work_hours),
    sum(t.break_hours),
    sum(t.overtime_hours)
  from ops_hr.timesheet_rows(p_from, p_to, p_unit, p_employee_no) t
  join ops_hr.employees e on e.employee_no = t.employee_no
  group by t.employee_no, t.full_name, e.unit
  order by t.employee_no
$$;

grant execute on function ops_hr.timesheet_totals(date, date, text, text) to authenticated;
