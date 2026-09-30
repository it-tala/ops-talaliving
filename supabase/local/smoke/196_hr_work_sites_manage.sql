-- 196_hr_work_sites_manage.sql — beberapa lokasi presensi: tambah, ubah, hapus (D343).
--
-- Yang dibuktikan:
--   • dua lokasi disimpan berdampingan, dan tap dinilai terhadap yang terdekat;
--   • mengubah lokasi = menyimpan kode yang sama, tidak menambah baris;
--   • lokasi nonaktif tidak dipakai menilai;
--   • lokasi yang belum pernah menilai tap bisa dihapus;
--   • lokasi yang sudah menilai tap ditolak dihapus, dengan jumlahnya;
--   • bukan HRD/IT ditolak; kode yang tidak ada dijawab not_found.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-000000019601','hrd196@talaliving.com','{"full_name":"HRD"}'),
  ('ffffffff-0000-0000-0000-000000019602','lain196@talaliving.com','{"full_name":"Orang lain"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-000000019601','hrd','admin'),
  ('ffffffff-0000-0000-0000-000000019602','procurement','admin');

insert into ops_hr.employees
  (id, employee_no, full_name, position, unit, pay_basis, base_rate, allowance_rate,
   daily_hours, joined_on, paid_leave_days)
values ('aaaa1960-0000-0000-0000-000000000001','B-1961','Tukang uji','Tukang','Workshop',
        'daily', 100000, 0, 8, '2025-01-01', 12);

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000019601';

do $$
declare r jsonb; j jsonb; n int;
begin
  r := ops_hr.save_work_site('GUDANG', 'Gudang', -6.5900, 110.6700, 150, true);
  assert r ->> 'outcome' = 'ok', r::text;
  r := ops_hr.save_work_site('KANTOR', 'Kantor', -6.6000, 110.6800, 100, true);
  assert r ->> 'outcome' = 'ok', r::text;
  select count(*) into n from ops_hr.work_sites;
  assert n = 2, 'dua lokasi, got ' || n;

  -- Dekat kantor: dinilai terhadap kantor, bukan gudang.
  j := ops_hr.judge_location(-6.6001, 110.6801, 10);
  assert j ->> 'site_code' = 'KANTOR' and j ->> 'verdict' = 'inside', j::text;

  -- Mengubah = kode yang sama; tidak ada baris baru.
  r := ops_hr.save_work_site('kantor', 'Kantor pusat', -6.6000, 110.6800, 120, true);
  assert r ->> 'outcome' = 'ok' and r -> 'data' ->> 'name' = 'Kantor pusat', r::text;
  select count(*) into n from ops_hr.work_sites;
  assert n = 2, 'ubah tidak menambah baris, got ' || n;

  -- Nonaktif: tidak dipakai menilai; tap dekat kantor jatuh ke gudang.
  r := ops_hr.save_work_site('KANTOR', 'Kantor pusat', -6.6000, 110.6800, 120, false);
  j := ops_hr.judge_location(-6.6001, 110.6801, 10);
  assert j ->> 'site_code' = 'GUDANG' and j ->> 'verdict' = 'outside', j::text;

  -- Belum pernah menilai tap: bisa dihapus.
  r := ops_hr.remove_work_site('KANTOR');
  assert r ->> 'outcome' = 'ok', r::text;
  select count(*) into n from ops_hr.work_sites;
  assert n = 1, 'tinggal satu, got ' || n;

  r := ops_hr.remove_work_site('SHOWROOM');
  assert r -> 'error' ->> 'code' = 'not_found', r::text;
end $$;

/* ── lokasi yang sudah menilai tap tidak bisa dihapus ─────────────────── */
reset role;
insert into ops_hr.attendance_scans (id, employee_id, work_date, at, verify, source, recorded_by)
values ('bbbb1960-0000-0000-0000-000000000001','aaaa1960-0000-0000-0000-000000000001',
        '2026-09-29','2026-09-29 07:25+07','app','self','ffffffff-0000-0000-0000-000000019601');
insert into ops_hr.scan_locations (scan_id, tap_no, site_id, lat, lng, accuracy_m, distance_m, radius_m, verdict)
select 'bbbb1960-0000-0000-0000-000000000001', 'B-1961/2026-09-29T07:25:00', w.id,
       -6.5901, 110.6701, 12, 15, 150, 'inside'
  from ops_hr.work_sites w where w.code = 'GUDANG';

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000019601';
do $$
declare r jsonb;
begin
  r := ops_hr.remove_work_site('GUDANG');
  assert r -> 'error' ->> 'code' = 'site_in_use', r::text;
  assert r -> 'error' ->> 'message' like '%1 tap%', r::text;
end $$;

set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000019602';
do $$
declare r jsonb;
begin
  r := ops_hr.remove_work_site('GUDANG');
  assert r -> 'error' ->> 'code' = 'not_permitted', r::text;
end $$;

rollback;
