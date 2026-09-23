-- 61_hr_payroll_line_complete.sql — satu baris gaji, utuh.
--
-- Yang dibuktikan: kedelapan belas field yang selama ini kurang benar-benar
-- terisi dan bukan null; dua ejaan untuk angka yang sama tidak boleh berbeda;
-- `net` bukan `take_home`, dan selisihnya adalah iuran karyawan; daftar hari
-- menyebut hari yang **belum dibaca** alih-alih menyembunyikannya; lembur
-- diuraikan per anak tangga, bukan satu total; penahanan tunjangan menyebut
-- siapa yang memutuskan; dan penyesuaian tidak membawa `label` karena label
-- itu presentasi, bukan data.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-000000006101','hrd61@talaliving.com','{"full_name":"Wulan Sari"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-000000006101','hrd','admin'),
  ('ffffffff-0000-0000-0000-000000006101','payroll','admin'),
  ('ffffffff-0000-0000-0000-000000006101','it','write');

insert into ops_hr.pay_rule_sets (version, effective_from, note, rules, created_by) values
 (1, '2026-01-01', 'uji', '{
   "week_pattern":"5day","day_starts_minutes":480,
   "overtime_mode":"flat","flat_multiplier":1.5,
   "workday_tiers":[{"after_hours":0,"multiplier":1.5}],
   "restday_tiers":[{"after_hours":0,"multiplier":2}],
   "monthly_divisor":173,"hourly_basis":"company","effective_days_per_year":240,
   "hourly_includes_allowance":false,"overtime_rounding_minutes":0,
   "undertime_mode":"off","undertime_grace_minutes":15,
   "late_grace_minutes":0,"late_mode":"manual","late_forfeits_allowance":false,
   "schedules":[{"code":"PRODUKSI","name":"Produksi","start_minutes":450,"end_minutes":990,
                 "break_minutes":45,"friday_break_minutes":90,"friday_end_minutes":960,"note":null}],
   "schedule_by_unit":{"Produksi":"PRODUKSI"}
 }'::jsonb, 'ffffffff-0000-0000-0000-000000006101');

insert into ops_hr.employees
  (id, employee_no, full_name, position, unit, pay_basis, base_rate, allowance_rate,
   daily_hours, schedule_code, paid_leave_days, joined_on)
values ('aaaa6100-0000-0000-0000-000000000001','B-6101','Karjo','Tukang kayu','Produksi',
        'daily', 180000, 25000, 8.25, 'PRODUKSI', 12, '2026-01-01');

-- Senin 2026-03-02 dan Selasa 03-03: masuk 07.45 (telat 15 menit dari 07.30),
-- empat tap bersih. Rabu 03-04: hanya satu tap, jadi harinya **belum dibaca**.
insert into ops_hr.attendance_scans (employee_id, work_date, at, verify, source, reason, recorded_by)
select 'aaaa6100-0000-0000-0000-000000000001', d,
       (d + t)::timestamp at time zone 'Asia/Makassar', 'MANUAL','manual','seed',
       'ffffffff-0000-0000-0000-000000006101'
  from (values ('2026-03-02'::date), ('2026-03-03'::date)) days(d),
       (values ('07:45'::time), ('12:00'::time), ('12:45'::time), ('16:30'::time)) taps(t);
-- Rabu: satu tap saja, jadi harinya tidak bisa dibaca dan bernilai nol.
insert into ops_hr.attendance_scans (employee_id, work_date, at, verify, source, reason, recorded_by)
values ('aaaa6100-0000-0000-0000-000000000001', '2026-03-04',
        ('2026-03-04'::date + '07:40'::time)::timestamp at time zone 'Asia/Makassar',
        'MANUAL','manual','seed','ffffffff-0000-0000-0000-000000006101');

-- Tunjangan ditahan satu hari, dengan alasan dan nama yang memutuskan.
insert into ops_hr.allowance_withholdings (employee_id, work_date, reason, by)
values ('aaaa6100-0000-0000-0000-000000000001','2026-03-03','pulang sebelum waktunya tanpa izin',
        'ffffffff-0000-0000-0000-000000006101');

-- Terdaftar di satu skema, supaya take_home berbeda dari net.
insert into ops_hr.contribution_rates
  (scheme, effective_from, employer_percent, employee_percent, rate_confirmed, note, created_by)
values ('JHT','2026-01-01', 3.7, 2.0, true, 'uji', 'ffffffff-0000-0000-0000-000000006101'),
-- Versi kedua, berlaku Juni. Ada supaya **pilihan bulannya berarti**: dengan
-- satu tarif saja, mengambil bulan yang salah memberi jawaban yang sama dan
-- ujinya tidak menguji apa pun (ketahuan lewat mutasi).
       ('JHT','2026-06-01', 3.7, 5.0, true, 'naik Juni', 'ffffffff-0000-0000-0000-000000006101');
insert into ops_hr.enrolments (employee_id, scheme, member_no, enrolled_on, "by")
values ('aaaa6100-0000-0000-0000-000000000001','JHT','1234567890','2026-01-01',
        'ffffffff-0000-0000-0000-000000006101');

-- Satu run, dengan satu penyesuaian di atasnya.
insert into ops_hr.payroll_runs (run_no, period_start, period_end)
values ('gaji-26-03-01','2026-03-02','2026-03-08');
insert into ops_hr.payroll_adjustments (run_no, employee_id, kind, amount, reason, created_by)
values ('gaji-26-03-01','aaaa6100-0000-0000-0000-000000000001','bonus', 100000,
        'kejar kirim akhir bulan','ffffffff-0000-0000-0000-000000006101');

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000006101';

do $$
declare
  L ops_hr.payroll_figures;
  aw jsonb; adj jsonb; con jsonb; dayrow jsonb;
begin
  L := ops_hr.payroll_line_for('aaaa6100-0000-0000-0000-000000000001',
                               '2026-03-02','2026-03-08','gaji-26-03-01');

  /* ── siapa orangnya ─────────────────────────────────────────────────── */
  assert L.position = 'Tukang kayu', 'position: ' || coalesce(L.position,'(null)');
  assert L.pay_basis = 'daily',      'pay_basis: ' || coalesce(L.pay_basis,'(null)');
  assert L.base_rate = 180000,       'base_rate: ' || coalesce(L.base_rate::text,'(null)');
  assert L.allowance_rate = 25000,   'allowance_rate: ' || coalesce(L.allowance_rate::text,'(null)');

  /* ── dua ejaan, satu angka ──────────────────────────────────────────── */
  assert L.days_worked = L.worked_days,
    format('days_worked %s vs worked_days %s', L.days_worked, L.worked_days);
  assert L.days_open = L.open_days,
    format('days_open %s vs open_days %s', L.days_open, L.open_days);
  -- Rabu hanya punya satu tap: satu hari belum dibaca.
  assert L.open_days = 1, 'open_days: ' || L.open_days;

  /* ── tarif: yang dipakai, dan yang tidak ────────────────────────────── */
  assert L.company_hourly > 0,   'company_hourly kosong';
  assert L.statutory_hourly > 0, 'statutory_hourly kosong';
  assert L.annual_pay > 0,       'annual_pay kosong';
  assert L.hourly = L.company_hourly,
    format('buku ini memilih hitungan perusahaan: %s vs %s', L.hourly, L.company_hourly);

  /* ── tunjangan yang ditahan: jumlahnya, dan siapa yang memutuskan ───── */
  assert L.allowance_withheld_days = 1, 'withheld_days: ' || L.allowance_withheld_days;
  assert L.allowance_withheld_amount = 25000, 'withheld_amount: ' || L.allowance_withheld_amount;
  assert jsonb_array_length(L.allowance_withheld) = 1,
    'daftar penahanan: ' || L.allowance_withheld::text;
  aw := L.allowance_withheld -> 0;
  assert aw ->> 'reason' like 'pulang sebelum%', 'alasan: ' || aw::text;
  assert aw ->> 'by_name' = 'Wulan Sari', 'nama yang memutuskan: ' || aw::text;

  /* ── penyesuaian: tanpa label, karena label itu presentasi ──────────── */
  assert jsonb_array_length(L.adjustments) = 1, 'penyesuaian: ' || L.adjustments::text;
  adj := L.adjustments -> 0;
  assert adj ->> 'kind' = 'bonus', adj::text;
  assert (adj ->> 'amount')::bigint = 100000, adj::text;
  assert adj ->> 'reason' = 'kejar kirim akhir bulan', adj::text;
  assert not (adj ? 'label'),
    'label seharusnya tidak datang dari database — ia ada di ADJUSTMENT_LABEL';
  assert L.adjustment_total = 100000, 'adjustment_total: ' || L.adjustment_total;

  /* ── net, iuran, dan yang benar-benar sampai ke kantong ─────────────── */
  assert L.net = L.gross + L.adjustment_total,
    format('net %s bukan gross %s + penyesuaian %s', L.net, L.gross, L.adjustment_total);
  assert jsonb_array_length(L.contributions) = 1, 'iuran: ' || L.contributions::text;
  con := L.contributions -> 0;
  assert con ->> 'scheme' = 'JHT', con::text;
  assert (con ->> 'employee')::bigint > 0, 'bagian karyawan nol: ' || con::text;
  assert not (con ? 'label'), 'label skema juga presentasi (SCHEME_LABEL)';
  assert L.contribution_total = (con ->> 'employee')::bigint,
    format('contribution_total %s vs %s', L.contribution_total, con ->> 'employee');
  -- Tarif yang dipakai harus tarif **bulan periodenya** (Maret, 2,0%), bukan
  -- tarif Juni (5,0%) yang juga ada di tabel. Iuran adalah satu-satunya angka
  -- di slip yang datang dari tabel bulanan terpisah, dan mengambil bulan yang
  -- salah tidak akan terlihat dari mana pun kecuali di sini.
  assert (con ->> 'employee')::bigint = round((con ->> 'base')::bigint * 2.0 / 100),
    format('tarif Maret 2,0%% seharusnya dipakai: %s', con::text);
  -- Inilah sebabnya keduanya ada: net bukan yang sampai ke kantong.
  assert L.take_home = L.net - L.contribution_total,
    format('take_home %s vs net %s - iuran %s', L.take_home, L.net, L.contribution_total);
  assert L.take_home < L.net, 'ada iuran, jadi take_home harus lebih kecil dari net';

  /* ── terlambat: menit dan hari, karena satu angka tidak bisa membedakan ─ */
  --
  -- Senin dan Selasa masuk 07.45 terhadap jadwal 07.30 tanpa toleransi = 15
  -- menit masing-masing. Rabu masuk 07.40 = 10 menit lagi, **dan hari itu
  -- adalah hari yang belum dibaca**. Itu benar dan sengaja diuji: orangnya
  -- memang datang terlambat, dan apakah harinya sudah dibaca petugas tidak
  -- mengubah jam berapa ia sampai. Yang tidak dibayar adalah *harinya*, bukan
  -- kesaksian mesin tentang jam kedatangannya.
  assert L.late_minutes = 40, 'late_minutes: ' || L.late_minutes;
  assert L.late_days = 3, 'late_days: ' || L.late_days;
  -- Dan inilah gunanya dua angka: 40 menit terdengar seperti satu kejadian
  -- besar sampai kelihatan bahwa ia tersebar di tiga pagi.
  assert L.late_minutes > L.late_days, 'dua angka yang menceritakan hal berbeda';

  /* ── daftar hari: ada, dan menyebut yang belum dibaca ───────────────── */
  assert jsonb_array_length(L.days) = 7, 'tujuh hari periode: ' || jsonb_array_length(L.days);
  select value into dayrow from jsonb_array_elements(L.days)
   where value ->> 'work_date' = '2026-03-04';
  assert (dayrow ->> 'open')::boolean, 'Rabu seharusnya belum dibaca: ' || dayrow::text;
  assert (dayrow ->> 'day_value')::numeric = 0,
    'hari yang belum dibaca belum bernilai: ' || dayrow::text;
  select value into dayrow from jsonb_array_elements(L.days)
   where value ->> 'work_date' = '2026-03-02';
  assert not (dayrow ->> 'open')::boolean, 'Senin sudah lengkap: ' || dayrow::text;
  assert (dayrow ->> 'weekday')::int = 1, 'Senin isodow 1: ' || dayrow::text;
  assert (dayrow ->> 'work_hours')::numeric > 0, 'jam Senin: ' || dayrow::text;

  /* ── lembur: tidak ada di sini, dan itu pun harus dikatakan ─────────── */
  assert L.overtime_parts = '[]'::jsonb, 'tidak ada lembur: ' || L.overtime_parts::text;
  assert L.overtime_pending_hours = 0, 'pending: ' || L.overtime_pending_hours;

  /* ── tidak satu pun field baru boleh null ───────────────────────────── */
  assert L.position is not null and L.pay_basis is not null and L.base_rate is not null
     and L.allowance_rate is not null and L.days_worked is not null
     and L.days_open is not null and L.overtime_pending_hours is not null
     and L.allowance_withheld_amount is not null and L.allowance_withheld is not null
     and L.company_hourly is not null and L.statutory_hourly is not null
     and L.annual_pay is not null and L.overtime_parts is not null
     and L.adjustments is not null and L.net is not null
     and L.contributions is not null and L.contribution_total is not null
     and L.take_home is not null and L.late_days is not null and L.days is not null,
    'ada field baru yang null';
end $$;

/* ── dan lewat pembaca daftarnya, bukan hanya per orang ────────────────── */
do $$
declare n int; got jsonb;
begin
  select count(*) into n from ops_hr.run_lines('gaji-26-03-01');
  assert n = 1, 'run_lines: ' || n;
  select l.days into got from ops_hr.run_lines('gaji-26-03-01') l;
  assert jsonb_array_length(got) = 7, 'daftar hari ikut lewat run_lines';
end $$;

rollback;
