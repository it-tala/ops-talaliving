-- 102_hr_self_service.sql — the profile screen's own seams (W7).
--
-- Yang dibuktikan:
--   • `tap_self` menulis satu tap milik pemanggilnya sendiri, dan menolak
--     akun yang tidak tertaut ke karyawan;
--   • taps, marks, overtime dan leave milik seseorang tidak terbaca oleh
--     orang lain yang bukan HRD — RLS, bukan filter di klien;
--   • `report_overtime_self` menolak jam di luar rentang, hasil kerja kosong,
--     tanggal di masa depan, dan pengajuan dua kali untuk malam yang sama;
--   • `request_leave` tanpa nomor karyawan mengajukan untuk diri sendiri, dan
--     jalur HRD (dengan nomor karyawan) menolak persis seperti sebelumnya —
--     permission diperiksa sebelum nama dicari, jadi tidak ada yang bisa
--     menebak nomor karyawan siapa pun dari kode kesalahannya;
--   • `leave_balances()` dan `kpi_measures()`/`run_lines()` menjawab "hanya
--     saya" untuk pemanggil tanpa `hrd.read`, lewat komposisi RLS yang sama
--     dengan `v_task` — tanpa fungsi baru;
--   • payslip run `DRAFT` tidak terbaca sendiri; run `APPROVED` terbaca;
--   • jejak aktivitas sendiri hanya menunjukkan jenis yang aman — `view`
--     tetap tidak terbaca, sesuai D190.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-000000020001','hrd102@talaliving.com','{"full_name":"Pimpinan"}'),
  ('ffffffff-0000-0000-0000-000000020002','sari102@talaliving.com','{"full_name":"Sari"}'),
  ('ffffffff-0000-0000-0000-000000020003','karjo102@talaliving.com','{"full_name":"Karjo"}'),
  ('ffffffff-0000-0000-0000-000000020004','lain102@talaliving.com','{"full_name":"Orang lain"}'),
  ('ffffffff-0000-0000-0000-000000020005','it102@talaliving.com','{"full_name":"IT"}');

insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-000000020001','hrd','admin'),
  ('ffffffff-0000-0000-0000-000000020004','procurement','admin'),
  ('ffffffff-0000-0000-0000-000000020005','it','read');

insert into ops_hr.employees
  (id, employee_no, full_name, position, unit, pay_basis, base_rate, allowance_rate,
   daily_hours, joined_on, user_id, paid_leave_days)
values
  ('aaaa1020-0000-0000-0000-000000000001','B-2001','Sari','Admin','Kantor',
   'monthly', 4500000, 25000, 8, '2025-01-01','ffffffff-0000-0000-0000-000000020002', 12),
  ('aaaa1020-0000-0000-0000-000000000002','B-2002','Karjo','Tukang','Produksi',
   'daily', 180000, 25000, 8, '2025-01-01','ffffffff-0000-0000-0000-000000020003', 12),
  -- Nobody's account: the roster still has people with no login (0152).
  ('aaaa1020-0000-0000-0000-000000000003','B-2003','Tanpa akun','Tukang','Produksi',
   'daily', 180000, 25000, 8, '2025-01-01', null, 12);

/* ── aktivitas: kelas aman terbaca sendiri, kelas IT tidak ─────────────── */
do $$
begin
  insert into ops_core.activity_events (actor_id, kind, target, label) values
    ('ffffffff-0000-0000-0000-000000020002','view','/hrd/payroll','Payroll'),
    ('ffffffff-0000-0000-0000-000000020002','sign_in','session','Masuk');
end $$;

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000020002';

do $$
declare v_n int;
begin
  select count(*) into v_n from ops_core.activity_events where kind = 'view';
  assert v_n = 0, 'kelas view (telemetri IT) ikut terbaca oleh pemiliknya sendiri';
  select count(*) into v_n from ops_core.activity_events where kind = 'sign_in';
  assert v_n = 1, 'kelas aman (sign_in) tidak terbaca oleh pemiliknya sendiri';
  select count(*) into v_n from ops_core.v_my_activity;
  assert v_n = 1, format('v_my_activity harus hanya menghitung kelas aman: dapat %s', v_n);
end $$;

/* ── presensi: tap sendiri, tidak terbaca orang lain ───────────────────── */
do $$
declare a jsonb; v_n int;
begin
  a := ops_hr.tap_self();
  assert a ->> 'outcome' = 'ok', a::text;

  select count(*) into v_n from ops_hr.attendance_scans
   where employee_id = 'aaaa1020-0000-0000-0000-000000000001' and source = 'self';
  assert v_n = 1, 'tap sendiri tidak tersimpan atau tidak terbaca oleh pemiliknya';

  select count(*) into v_n from ops_hr.attendance_scans
   where employee_id = 'aaaa1020-0000-0000-0000-000000000002';
  assert v_n = 0, 'tap milik Karjo terbaca oleh Sari';
end $$;

set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000020004';
do $$
declare a jsonb;
begin
  -- Punya akun, tapi tidak tertaut ke karyawan mana pun.
  a := ops_hr.tap_self();
  assert a ->> 'outcome' = 'refused', 'akun tanpa tautan karyawan bisa tap sendiri';
  assert a -> 'error' ->> 'code' = 'no_employee_link', a::text;
end $$;

/* ── lembur sendiri ─────────────────────────────────────────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000020002';
do $$
declare a jsonb; v_no text; v_n int;
begin
  a := ops_hr.report_overtime_self(ops_core.office_day(), 15, 'Rekap stok');
  assert a -> 'error' ->> 'code' = 'hours_out_of_range', a::text;

  a := ops_hr.report_overtime_self(ops_core.office_day() + 1, 2, 'Rekap stok');
  assert a -> 'error' ->> 'code' = 'date_in_future', a::text;

  a := ops_hr.report_overtime_self(ops_core.office_day(), 2, '   ');
  assert a -> 'error' ->> 'code' = 'result_required', a::text;

  a := ops_hr.report_overtime_self(ops_core.office_day(), 2, 'Rekap stok gudang selesai');
  assert a ->> 'outcome' = 'ok', a::text;
  v_no := a -> 'data' ->> 'sheet_no';
  assert a -> 'data' ->> 'via' = 'self', a::text;

  -- Dua kali untuk malam yang sama: koreksi, bukan klaim baru.
  a := ops_hr.report_overtime_self(ops_core.office_day(), 3, 'Lanjut lagi');
  assert a -> 'error' ->> 'code' = 'already_reported', a::text;

  select count(*) into v_n from ops_hr.v_overtime_stage where sheet_no = v_no;
  assert v_n = 1, 'sheet lembur sendiri tidak terbaca lewat papannya sendiri';
end $$;

set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000020003';
do $$
declare v_n int;
begin
  select count(*) into v_n from ops_hr.overtime_lines
   where employee_id = 'aaaa1020-0000-0000-0000-000000000001';
  assert v_n = 0, 'baris lembur Sari terbaca oleh Karjo';
end $$;

set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000020004';
do $$
declare a jsonb;
begin
  a := ops_hr.report_overtime_self(ops_core.office_day(), 2, 'x');
  assert a -> 'error' ->> 'code' = 'no_employee_link', a::text;
end $$;

/* ── cuti sendiri, dan jalur HRD yang tidak berubah ────────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000020002';
do $$
declare a jsonb; v_no text; v_n int;
begin
  a := ops_hr.request_leave(null, 'cuti', ops_core.office_day() + 10,
                            ops_core.office_day() + 11, 'Acara keluarga');
  assert a ->> 'outcome' = 'ok', a::text;
  assert a -> 'data' ->> 'via' = 'self', a::text;
  v_no := a -> 'data' ->> 'request_no';

  -- Tumpang tindih: ditolak constraint, lewat seam yang sama.
  a := ops_hr.request_leave(null, 'izin', ops_core.office_day() + 10,
                            ops_core.office_day() + 10, 'Lainnya');
  assert a ->> 'outcome' = 'duplicate', a::text;
  assert a -> 'error' ->> 'code' = 'overlaps_existing', a::text;

  select count(*) into v_n from ops_hr.leave_requests where request_no = v_no;
  assert v_n = 1, 'pengajuan sendiri tidak terbaca oleh pemiliknya';

  -- Jatah sendiri: satu baris, miliknya sendiri.
  select count(*) into v_n from ops_hr.leave_balances();
  assert v_n = 1, format('leave_balances() untuk diri sendiri harus satu baris, dapat %s', v_n);
end $$;

set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000020003';
do $$
declare v_n int;
begin
  select count(*) into v_n from ops_hr.leave_requests
   where employee_id = 'aaaa1020-0000-0000-0000-000000000001';
  assert v_n = 0, 'pengajuan cuti Sari terbaca oleh Karjo';
end $$;

set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000020004';
do $$
declare a jsonb;
begin
  -- Jalur HRD lewat nomor karyawan eksplisit, dan tetap ditolak untuk orang
  -- tanpa `hrd.create` — persis seperti sebelum migrasi ini.
  a := ops_hr.request_leave('B-2002', 'cuti', ops_core.office_day() + 20,
                            ops_core.office_day() + 20, 'Diajukan orang lain');
  assert a ->> 'outcome' = 'refused', a::text;
  assert a -> 'error' ->> 'code' = 'not_permitted', a::text;
end $$;

set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000020001';
do $$
declare a jsonb; v_n int;
begin
  a := ops_hr.request_leave('B-2002', 'cuti', ops_core.office_day() + 20,
                            ops_core.office_day() + 20, 'Diajukan HRD');
  assert a ->> 'outcome' = 'ok', a::text;
  assert a -> 'data' ->> 'via' = 'hrd', a::text;

  -- HRD melihat seluruh roster, bukan satu baris.
  select count(*) into v_n from ops_hr.leave_balances();
  assert v_n = 3, format('HRD harus melihat seluruh roster: dapat %s', v_n);
end $$;

/* ── payslip sendiri ────────────────────────────────────────────────────── */
reset role;
insert into ops_hr.payroll_runs
  (run_no, period_start, period_end, status, approved_by, approved_at, created_by)
values
  ('pyr-draft-102', ops_core.office_day() - 14, ops_core.office_day() - 8, 'DRAFT',
   null, null, 'ffffffff-0000-0000-0000-000000020001'),
  ('pyr-done-102', ops_core.office_day() - 7, ops_core.office_day() - 1, 'APPROVED',
   'ffffffff-0000-0000-0000-000000020001', now(), 'ffffffff-0000-0000-0000-000000020001');

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000020002';
do $$
declare v_n int;
begin
  select count(*) into v_n from ops_hr.payroll_runs where run_no = 'pyr-draft-102';
  assert v_n = 0, 'run DRAFT terbaca sendiri sebelum disetujui';

  select count(*) into v_n from ops_hr.payroll_runs where run_no = 'pyr-done-102';
  assert v_n = 1, 'run APPROVED tidak terbaca oleh karyawan tertaut';

  select count(*) into v_n from ops_hr.run_lines('pyr-done-102');
  assert v_n = 1, format('run_lines untuk diri sendiri harus satu baris, dapat %s', v_n);
end $$;

set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000020004';
do $$
declare v_n int;
begin
  select count(*) into v_n from ops_hr.payroll_runs where run_no = 'pyr-done-102';
  assert v_n = 0, 'run APPROVED terbaca oleh akun tanpa tautan karyawan';
end $$;

/* ── my_employee_id() dan seam baru tidak terbuka untuk PUBLIC ───────────── */
reset role;
do $$
begin
  assert not has_function_privilege('public','ops_hr.tap_self(text)','execute'),
    'tap_self() terbuka untuk PUBLIC';
  assert not has_function_privilege('public','ops_hr.report_overtime_self(date,numeric,text,text,text)','execute'),
    'report_overtime_self() terbuka untuk PUBLIC';
  assert has_function_privilege('authenticated','ops_hr.tap_self(text)','execute'),
    'authenticated tidak bisa memanggil tap_self()';
end $$;

rollback;
