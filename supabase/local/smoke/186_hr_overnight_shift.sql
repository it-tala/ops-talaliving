-- 186_hr_overnight_shift.sql — satpam 12 jam lewat tengah malam dibaca sebagai
--                               satu hari kerja (D330).
--
-- Yang dibuktikan:
--   • satpam dengan tap 19.02 dan 07.05 adalah **satu** hari lengkap, milik
--     hari shift dimulai — lewat jalur impor mesin sidik jari;
--   • pagi yang tidak ada tapnya adalah `review` yang sama persis dengan hari
--     satu-tap biasa, dan pagi berikutnya tidak memunculkan hari kosong baru;
--   • terlambat dihitung dari jam mulai shift, termasuk datang lewat tengah
--     malam (00.40 untuk shift 19.00 = 325 menit lewat toleransi);
--   • payroll menghitung satu hari per malam dan jam yang benar, dan periode
--     yang berakhir pada suatu malam ikut membaca tap pagi sesudahnya;
--   • tap mandiri (`source = 'self'`) dibaca sama, dan pemiliknya sendiri —
--     tanpa akses HRD — mendapat bacaan yang sama dengan payroll;
--   • pekerja pola siang tidak berubah: jendela harinya tengah malam, slotnya,
--     jamnya dan terlambatnya sama dengan rumus lama;
--   • `schedule_problem` menerima pola malam dan tetap menolak yang salah;
--     `schedule_roll` menghitung 12 jam, bukan minus;
--   • `set_schedule_hours`: HRD menetapkan jamnya, penandanya hilang, dan
--     penolakannya (izin, catatan, versi sesudahnya, bentuk) berbunyi.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-000000018601','hrd186@talaliving.com','{"full_name":"HRD"}'),
  ('ffffffff-0000-0000-0000-000000018602','jaga186@talaliving.com','{"full_name":"Satpam mandiri"}'),
  ('ffffffff-0000-0000-0000-000000018603','lain186@talaliving.com','{"full_name":"Orang lain"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-000000018601','hrd','admin'),
  ('ffffffff-0000-0000-0000-000000018603','procurement','admin');

-- Satu buku, dua pola. SATPAM adalah default D330 — ditandai belum
-- dikonfirmasi — dan PRODUKSI adalah jam bengkel yang sebenarnya.
insert into ops_hr.pay_rule_sets (version, effective_from, note, rules, created_by) values
 (1, '2026-01-01', 'uji', '{
   "week_pattern":"5day","day_starts_minutes":480,
   "late_grace_minutes":15,"late_mode":"manual","undertime_mode":"off",
   "schedules":[
     {"code":"PRODUKSI","name":"Produksi","start_minutes":450,"end_minutes":990,
      "break_minutes":45,"friday_break_minutes":90,"friday_end_minutes":960,"note":null},
     {"code":"SATPAM","name":"Satpam — 12 jam","start_minutes":1140,"end_minutes":420,
      "break_minutes":0,"friday_break_minutes":null,"friday_end_minutes":null,
      "note":null,"hours_unconfirmed":true}],
   "schedule_by_unit":{"Produksi":"PRODUKSI"}
 }'::jsonb, 'ffffffff-0000-0000-0000-000000018601');

insert into ops_hr.employees
  (id, employee_no, full_name, position, unit, pay_basis, base_rate, allowance_rate,
   daily_hours, joined_on, user_id, paid_leave_days, schedule_code)
values
  ('aaaa1860-0000-0000-0000-000000000001','S-0861','Satpam impor','Satpam','Umum',
   'daily', 150000, 0, 12, '2025-01-01', null, 12, 'SATPAM'),
  ('aaaa1860-0000-0000-0000-000000000002','S-0862','Satpam mandiri','Satpam','Umum',
   'daily', 150000, 0, 12, '2025-01-01','ffffffff-0000-0000-0000-000000018602', 12, 'SATPAM'),
  ('aaaa1860-0000-0000-0000-000000000003','P-0863','Tukang siang','Tukang','Produksi',
   'daily', 180000, 0, 8, '2025-01-01', null, 12, null);

-- Tap mandiri ditulis seperti `tap_self` menulisnya — kalender WIB sebagai
-- `work_date`, `source = 'self'`, pemanggilnya sebagai `recorded_by` —
-- karena `tap_self` memakai `now()` dan jamnya tidak bisa dipilih di sini.
insert into ops_hr.attendance_scans (employee_id, work_date, at, verify, source, recorded_by)
select 'aaaa1860-0000-0000-0000-000000000002', ops_core.office_day(t), t, 'app', 'self',
       'ffffffff-0000-0000-0000-000000018602'
  from unnest(array['2026-08-03 19:05+07','2026-08-04 07:01+07']::timestamptz[]) t;

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000018601';

/* ── impor mesin: empat malam dan satu pekerja siang ────────────────────── */
do $$
declare a jsonb;
begin
  a := ops_hr.import_scans('mesin-186.csv', $j$[
    {"employee_ref":"861","at":"2026-08-03T19:02:00+07"},
    {"employee_ref":"861","at":"2026-08-04T07:05:00+07"},
    {"employee_ref":"861","at":"2026-08-04T19:30:00+07"},
    {"employee_ref":"861","at":"2026-08-06T00:40:00+07"},
    {"employee_ref":"861","at":"2026-08-06T07:10:00+07"},
    {"employee_ref":"861","at":"2026-08-06T19:00:00+07"},
    {"employee_ref":"861","at":"2026-08-06T23:00:00+07"},
    {"employee_ref":"861","at":"2026-08-06T23:30:00+07"},
    {"employee_ref":"861","at":"2026-08-07T07:00:00+07"},
    {"employee_ref":"863","at":"2026-08-03T07:25:00+07"},
    {"employee_ref":"863","at":"2026-08-03T12:00:00+07"},
    {"employee_ref":"863","at":"2026-08-03T12:40:00+07"},
    {"employee_ref":"863","at":"2026-08-03T16:35:00+07"},
    {"employee_ref":"863","at":"2026-08-04T07:50:00+07"},
    {"employee_ref":"863","at":"2026-08-04T12:00:00+07"},
    {"employee_ref":"863","at":"2026-08-04T12:45:00+07"},
    {"employee_ref":"863","at":"2026-08-04T16:31:00+07"},
    {"employee_ref":"863","at":"2026-08-05T00:30:00+07"}
  ]$j$::jsonb);
  assert a ->> 'outcome' = 'ok', a::text;
  assert (a -> 'data' ->> 'added')::int = 18, a::text;
end $$;

/* ── work_date tetap fakta kalender ─────────────────────────────────────── */
do $$
declare v date;
begin
  select work_date into v from ops_hr.attendance_scans
   where employee_id = 'aaaa1860-0000-0000-0000-000000000001' and at = '2026-08-04 07:05+07';
  assert v = '2026-08-04', 'work_date yang tersimpan harus tetap hari kalender: ' || v;

  assert ops_hr.shift_day('aaaa1860-0000-0000-0000-000000000001', '2026-08-04 07:05+07') = '2026-08-03',
    'tap 07.05 satpam harus milik malam sebelumnya';
  assert ops_hr.shift_day('aaaa1860-0000-0000-0000-000000000001', '2026-08-04 12:59+07') = '2026-08-03',
    '12.59 masih sisa malam sebelumnya (batas 13.00)';
  assert ops_hr.shift_day('aaaa1860-0000-0000-0000-000000000001', '2026-08-04 13:00+07') = '2026-08-04',
    '13.00 sudah milik shift malam itu';
  -- Pekerja siang: tengah malam tetap batasnya.
  assert ops_hr.shift_day('aaaa1860-0000-0000-0000-000000000003', '2026-08-05 00:30+07') = '2026-08-05',
    'tap 00.30 pekerja siang tetap milik hari kalendernya';
end $$;

/* ── satu malam, satu hari lengkap ─────────────────────────────────────── */
do $$
declare d ops_hr.day_reading;
begin
  select * into d from ops_hr.read_day('aaaa1860-0000-0000-0000-000000000001', '2026-08-03');
  assert d.state = 'complete', format('19.02–07.05 harus lengkap: %s %s', d.state, d.issues);
  assert d.overnight, 'harus terbaca sebagai shift malam';
  assert d.taps = 2, 'dua tap: ' || d.taps;
  assert d.in_at = '2026-08-03 19:02+07' and d.out_at = '2026-08-04 07:05+07', d::text;
  assert d.work_hours = 12.05, 'jam kerja 12,05: ' || d.work_hours;
  assert d.day_value = 1, 'nilai hari 1: ' || d.day_value;
  assert d.window_from = '2026-08-03 13:00+07' and d.window_to = '2026-08-04 13:00+07',
    format('jendela %s → %s', d.window_from, d.window_to);

  -- Pagi yang hilang: tap 19.30 saja. `review` yang sama dengan hari satu-tap.
  select * into d from ops_hr.read_day('aaaa1860-0000-0000-0000-000000000001', '2026-08-04');
  assert d.state = 'review' and d.day_value = 0, format('satu tap: %s', d.state);
  assert d.issues = array['No pulang — the day has no end'], 'isu yang sama dengan hari biasa: ' || d.issues::text;
  assert d.why = 'Belum dibaca — absensi hari ini tidak lengkap, jadi belum bernilai.', d.why;

  -- Datang lewat tengah malam: masih milik shift 5 Agustus.
  select * into d from ops_hr.read_day('aaaa1860-0000-0000-0000-000000000001', '2026-08-05');
  assert d.state = 'complete' and d.in_at = '2026-08-06 00:40+07', format('%s %s', d.state, d.in_at);
  assert d.work_hours = 6.50, 'jam 00.40–07.10: ' || d.work_hours;

  -- Istirahat di tengah malam dibaca sebagai istirahat, dan lewat jatah 0.
  select * into d from ops_hr.read_day('aaaa1860-0000-0000-0000-000000000001', '2026-08-06');
  assert d.state = 'complete', format('%s %s', d.state, d.issues);
  assert d.break_out_at = '2026-08-06 23:00+07' and d.break_in_at = '2026-08-06 23:30+07', d::text;
  assert d.work_hours = 11.50 and d.break_hours = 0.50, format('%s / %s', d.work_hours, d.break_hours);
  assert array_length(d.notes, 1) = 1, 'istirahat lewat jatah dicatat, tidak memblokir: ' || d.notes::text;

  -- Pagi 7 Agustus milik 6 Agustus, jadi 7 Agustus kosong — bukan hari satu-tap.
  select * into d from ops_hr.read_day('aaaa1860-0000-0000-0000-000000000001', '2026-08-07');
  assert d.state = 'off' and d.taps = 0, format('7 Agustus: %s, %s tap', d.state, d.taps);
end $$;

/* ── daftar hari: tidak ada hari kosong dari tap pagi ──────────────────── */
do $$
declare v_days date[];
begin
  select array_agg(work_date order by work_date) into v_days
    from ops_hr.v_timesheet_day where employee_no = 'S-0861';
  assert v_days = array['2026-08-03','2026-08-04','2026-08-05','2026-08-06']::date[],
    'hari yang terdaftar: ' || v_days::text;

  -- timesheet_rows membawa jendela dan tanda malam ke klien.
  perform 1 from ops_hr.timesheet_rows('2026-08-03','2026-08-03', null, 'S-0861') r
   where r.overnight and r.window_to = '2026-08-04 13:00+07' and r.state = 'complete';
  assert found, 'timesheet_rows harus membawa window dan overnight';
end $$;

/* ── payroll: satu hari per malam, jam dan terlambat yang benar ─────────── */
do $$
declare p ops_hr.payroll_figures;
begin
  -- Periode berakhir 6 Agustus, dan tap 7 Agustus 07.00 tetap terbaca untuk
  -- malam 6 Agustus.
  p := ops_hr.payroll_line_for('aaaa1860-0000-0000-0000-000000000001', '2026-08-03', '2026-08-06');
  assert p.worked_days = 3, 'tiga malam lengkap: ' || p.worked_days;
  assert p.open_days = 1, 'satu malam belum dibaca: ' || p.open_days;
  assert p.normal_hours = 30.05, 'jam 12,05 + 6,5 + 11,5: ' || p.normal_hours;
  assert p.base_pay = 450000, 'tiga hari × 150.000: ' || p.base_pay;
  -- 00.40 terhadap 19.00 + 15 menit toleransi = 325 menit — rumus jam dinding
  -- lama menghasilkan 40 − 1140 − 15: tidak pernah terlambat. Ditambah malam
  -- 4 Agustus (masuk 19.30 = 15 menit): hari `review` tetap dihitung
  -- terlambatnya, seperti hari biasa sejak 0050.
  assert p.late_minutes = 340 and p.late_days = 2, format('terlambat %s menit / %s hari', p.late_minutes, p.late_days);

  -- Satu malam saja: satu hari, bukan dua setengah hari.
  p := ops_hr.payroll_line_for('aaaa1860-0000-0000-0000-000000000001', '2026-08-03', '2026-08-03');
  assert p.worked_days = 1 and p.open_days = 0 and p.normal_hours = 12.05,
    format('satu malam: %s hari, %s terbuka, %s jam', p.worked_days, p.open_days, p.normal_hours);
end $$;

/* ── KPI membaca derivasi yang sama ─────────────────────────────────────── */
do $$
declare v_basis text;
begin
  select basis into v_basis from ops_hr.kpi_measures(
    'aaaa1860-0000-0000-0000-000000000001', '2026-08-03', '2026-08-06') where key = 'punctuality';
  -- Empat malam bertap, empat bisa dinilai; di bawah ambang lima, jadi yang
  -- dilaporkan adalah dasarnya. Yang penting: tidak ada hari kelima dari pagi.
  assert v_basis = '4 hari dengan tap, 4 bisa dinilai', 'dasar KPI: ' || v_basis;
end $$;

/* ── pekerja siang tidak berubah ────────────────────────────────────────── */
do $$
declare d ops_hr.day_reading; p ops_hr.payroll_figures;
begin
  select * into d from ops_hr.read_day('aaaa1860-0000-0000-0000-000000000003', '2026-08-03');
  assert not d.overnight, 'pola siang bukan malam';
  assert d.window_from = '2026-08-03 00:00+07' and d.window_to = '2026-08-04 00:00+07',
    format('jendela siang harus tengah malam: %s → %s', d.window_from, d.window_to);
  assert d.state = 'complete' and d.work_hours = 8.50 and d.break_hours = 0.67,
    format('%s %s %s', d.state, d.work_hours, d.break_hours);

  -- Tap 00.30 tanggal 5 tetap hari 5, satu tap, review — seperti sebelumnya.
  select * into d from ops_hr.read_day('aaaa1860-0000-0000-0000-000000000003', '2026-08-05');
  assert d.state = 'review' and d.taps = 1, format('%s %s', d.state, d.taps);

  -- Terlambat: 07.50 terhadap 07.30 + 15 = 5 menit, sama dengan rumus lama.
  p := ops_hr.payroll_line_for('aaaa1860-0000-0000-0000-000000000003', '2026-08-03', '2026-08-04');
  assert p.late_minutes = greatest(ops_hr.wita_minutes('2026-08-04 07:50+07') - 450 - 15, 0)
     and p.late_minutes = 5, 'terlambat pekerja siang: ' || p.late_minutes;
  assert p.worked_days = 2 and p.normal_hours = 16.43, format('%s hari %s jam', p.worked_days, p.normal_hours);
end $$;

-- `late_minutes` dan rumus lama sepakat sampai detik dan pembulatan ke bawah
-- untuk semua masuk di hari yang sama, termasuk yang lebih awal.
do $$
declare t timestamptz;
begin
  foreach t in array array['2026-08-03 07:45:59+07','2026-08-03 07:20:30+07',
                           '2026-08-03 07:29:30+07','2026-08-03 07:30:00+07',
                           '2026-08-03 23:59:59+07']::timestamptz[] loop
    assert ops_hr.late_minutes(t, '2026-08-03', 450, 15) = ops_hr.wita_minutes(t) - 450 - 15,
      format('late_minutes berbeda dari rumus lama pada %s', t);
  end loop;
end $$;

/* ── tap mandiri, dibaca pemiliknya sendiri ─────────────────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000018602';

do $$
declare d ops_hr.day_reading; n int;
begin
  -- Tanpa hrd.read: buku aturan tidak terbaca olehnya, dan polanya tetap
  -- terbaca lewat `pattern_on` — layar /profil sama dengan slipnya.
  select count(*) into n from ops_hr.pay_rule_sets;
  assert n = 0, 'satpam tidak boleh membaca buku aturan: ' || n;

  select * into d from ops_hr.read_day('aaaa1860-0000-0000-0000-000000000002', '2026-08-03');
  assert d.state = 'complete' and d.overnight and d.work_hours = 11.93,
    format('tap mandiri 19.05–07.01: %s %s %s', d.state, d.overnight, d.work_hours);

  select count(*) into n from ops_hr.timesheet_rows('2026-08-03','2026-08-04', null, 'S-0862')
   where state = 'complete';
  assert n = 1, 'timesheet_rows milik sendiri: satu hari lengkap, dapat ' || n;
end $$;

/* ── orang lain tidak mendapat apa-apa ──────────────────────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000018603';

do $$
declare n int;
begin
  select count(*) into n from ops_hr.read_day('aaaa1860-0000-0000-0000-000000000002', '2026-08-03');
  assert n = 0, 'orang lain tidak boleh membaca hari satpam: ' || n;
end $$;

/* ── bentuk pola: malam diterima, yang salah tetap ditolak ──────────────── */
do $$
declare p jsonb;
  base jsonb := '{"code":"SATPAM","name":"Satpam","start_minutes":1140,"end_minutes":420,
                  "break_minutes":0,"friday_break_minutes":null,"friday_end_minutes":null,"note":null}';
begin
  assert ops_hr.schedule_problem(jsonb_build_object('schedules', jsonb_build_array(base))) is null,
    'pola 19.00–07.00 harus sah';
  p := ops_hr.schedule_problem(jsonb_build_object('schedules',
         jsonb_build_array(base || '{"end_minutes":1140}')));
  assert p ->> 'code' = 'end_before_start', 'pulang = masuk tetap ditolak: ' || coalesce(p::text,'null');
  p := ops_hr.schedule_problem(jsonb_build_object('schedules',
         jsonb_build_array(base || '{"break_minutes":720}')));
  assert p ->> 'code' = 'break_too_long', 'istirahat 12 jam menghabiskan malam: ' || coalesce(p::text,'null');
  p := ops_hr.schedule_problem(jsonb_build_object('schedules',
         jsonb_build_array(base || '{"friday_end_minutes":300}')));
  assert p ->> 'code' = 'overnight_friday_end', coalesce(p::text,'null');
end $$;

set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000018601';

do $$
declare s jsonb;
begin
  select x into s from jsonb_array_elements(ops_hr.schedule_roll() -> 'schedules') x
   where x ->> 'code' = 'SATPAM';
  assert (s -> 'hours' ->> 'daily_hours')::numeric = 12, 'sehari 12 jam: ' || (s -> 'hours')::text;
  assert (s -> 'hours' ->> 'weekly_hours')::numeric = 60, 'seminggu 5 × 12: ' || (s -> 'hours')::text;
  assert (s ->> 'overnight')::boolean and (s ->> 'day_boundary_minutes')::int = 780, s::text;
  assert (s ->> 'hours_unconfirmed')::boolean, 'default harus terbaca belum dikonfirmasi';

  select x into s from jsonb_array_elements(ops_hr.schedule_roll() -> 'schedules') x
   where x ->> 'code' = 'PRODUKSI';
  assert (s -> 'hours' ->> 'daily_hours')::numeric = 8.25 and not (s ->> 'overnight')::boolean
     and not (s ->> 'hours_unconfirmed')::boolean, s::text;
end $$;

/* ── HRD menetapkan jamnya ──────────────────────────────────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000018603';

do $$
declare a jsonb;
begin
  -- Bukan HRD.
  a := ops_hr.set_schedule_hours('SATPAM', 1140, 420, 0, '2026-09-01', 'x');
  assert a -> 'error' ->> 'code' = 'not_permitted', a::text;
end $$;

set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000018601';

do $$
declare a jsonb; s jsonb; v int;
begin
  a := ops_hr.set_schedule_hours('SATPAM', 1140, 420, 0, '2026-09-01', '  ');
  assert a -> 'error' ->> 'code' = 'note_required', a::text;
  a := ops_hr.set_schedule_hours('JAGA', 1140, 420, 0, '2026-09-01', 'ada');
  assert a -> 'error' ->> 'code' = 'not_found', a::text;
  a := ops_hr.set_schedule_hours('SATPAM', 1140, 1140, 0, '2026-09-01', 'salah ketik');
  assert a -> 'error' ->> 'code' = 'end_before_start', a::text;

  -- Jam 18.00–06.00, dikonfirmasi HRD.
  a := ops_hr.set_schedule_hours('SATPAM', 1080, 360, 0, '2026-09-01', 'Jam jaga dari kepala keamanan');
  assert a ->> 'outcome' = 'ok', a::text;
  v := (a -> 'data' ->> 'version')::int;
  assert v = 2, 'versi baru: ' || a::text;

  select x into s from jsonb_array_elements(ops_hr.rules_on('2026-09-01') -> 'schedules') x
   where x ->> 'code' = 'SATPAM';
  assert (s ->> 'start_minutes')::int = 1080 and (s ->> 'end_minutes')::int = 360, s::text;
  assert not (s ? 'hours_unconfirmed'), 'penandanya harus hilang: ' || s::text;
  -- Yang lain disalin utuh.
  assert ops_hr.rules_on('2026-09-01') - 'schedules' = ops_hr.rules_on('2026-08-01') - 'schedules',
    'aturan lain ikut berubah';
  -- Agustus tetap dibaca dengan buku lama.
  assert ops_hr.shift_day('aaaa1860-0000-0000-0000-000000000001', '2026-08-04 07:05+07') = '2026-08-03';

  a := ops_hr.set_schedule_hours('SATPAM', 1080, 360, 0, '2026-09-01', 'lagi');
  assert a ->> 'outcome' = 'noop', a::text;

  -- Versi sesudah tanggal ini akan membatalkannya diam-diam: ditolak.
  a := ops_hr.set_schedule_hours('SATPAM', 1140, 420, 0, '2026-08-15', 'mundur');
  assert a -> 'error' ->> 'code' = 'later_version_exists', a::text;
end $$;

rollback;
