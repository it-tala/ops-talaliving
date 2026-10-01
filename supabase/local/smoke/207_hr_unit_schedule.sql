-- 207_hr_unit_schedule.sql — HRD mengatur pola bawaan unit dari /hrd/jadwal (D365).
--
-- Yang dibuktikan:
--   • HRD memasang unit STAFF ke KANTOR sebagai versi buku baru yang
--     bertanggal; aturan lain disalin utuh, buku lama tidak berubah;
--   • `schedule_roll` membaca unit itu di `unit_defaults` (bawaan, jumlah
--     orang, yang ikut bawaan) dan orangnya pindah dari *belum punya jadwal*
--     ke *ikut bawaan unit*; orang yang punya pola sendiri tidak ikut;
--   • kode kosong melepas bawaan unit, dan yang mengikutinya kembali tanpa pola;
--   • penolakannya: bukan HRD, tanpa unit, tanpa alasan, pola yang tidak ada,
--     sama dengan sekarang (noop), tanggal sebelum versi yang lebih baru, dan
--     tanggal di dalam run gaji.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-000000020701','hrd207@talaliving.com','{"full_name":"HRD"}'),
  ('ffffffff-0000-0000-0000-000000020702','it207@talaliving.com','{"full_name":"IT"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-000000020701','hrd','admin'),
  ('ffffffff-0000-0000-0000-000000020702','it','admin');

-- Seperti produksi: peta unit menyebut unit yang tidak dipakai siapa pun, dan
-- STAFF tidak punya bawaan.
insert into ops_hr.pay_rule_sets (version, effective_from, note, rules, created_by) values
 (1, '2026-01-01', 'uji', '{
   "week_pattern":"5day","day_starts_minutes":480,
   "late_grace_minutes":15,"late_mode":"manual","undertime_mode":"off",
   "schedules":[
     {"code":"PRODUKSI","name":"Produksi","start_minutes":450,"end_minutes":990,
      "break_minutes":45,"friday_break_minutes":90,"friday_end_minutes":960,"note":null},
     {"code":"KANTOR","name":"Kantor","start_minutes":480,"end_minutes":1035,
      "break_minutes":60,"friday_break_minutes":90,"friday_end_minutes":990,"note":null}],
   "schedule_by_unit":{"Workshop":"PRODUKSI","Office":"KANTOR"}
 }'::jsonb, 'ffffffff-0000-0000-0000-000000020701');

insert into ops_hr.employees
  (id, employee_no, full_name, position, unit, pay_basis, base_rate, allowance_rate,
   daily_hours, joined_on, user_id, paid_leave_days, schedule_code)
values
  ('aaaa2070-0000-0000-0000-000000000001','S-2071','Staf satu','Admin','STAFF',
   'monthly', 5000000, 0, 8, '2025-01-01', null, 12, null),
  ('aaaa2070-0000-0000-0000-000000000002','S-2072','Staf dua','Admin','STAFF',
   'monthly', 5000000, 0, 8, '2025-01-01', null, 12, 'PRODUKSI'),
  ('aaaa2070-0000-0000-0000-000000000003','S-2073','Tukang','Tukang','Workshop',
   'daily', 150000, 0, 8, '2025-01-01', null, 12, null);

set local role authenticated;

/* ── bukan HRD ──────────────────────────────────────────────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000020702';

do $$
declare a jsonb;
begin
  a := ops_hr.set_unit_schedule('STAFF','KANTOR','2026-08-01','staf ikut kantor');
  assert a -> 'error' ->> 'code' = 'not_permitted', a::text;
end $$;

/* ── HRD ────────────────────────────────────────────────────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000020701';

do $$
declare a jsonb; r jsonb; u jsonb;
begin
  a := ops_hr.set_unit_schedule('  ','KANTOR','2026-08-01','tanpa unit');
  assert a -> 'error' ->> 'code' = 'unit_required', a::text;

  a := ops_hr.set_unit_schedule('STAFF','KANTOR','2026-08-01',' ');
  assert a -> 'error' ->> 'code' = 'note_required', a::text;

  a := ops_hr.set_unit_schedule('STAFF','SATPAM','2026-08-01','tidak ada');
  assert a -> 'error' ->> 'code' = 'not_found', a::text;

  a := ops_hr.set_unit_schedule('Workshop','PRODUKSI','2026-08-01','sama');
  assert a ->> 'outcome' = 'noop', a::text;

  -- Sebelum: STAFF tanpa bawaan, Staf satu belum punya jadwal.
  r := ops_hr.schedule_roll();
  select x into u from jsonb_array_elements(r -> 'unit_defaults') x where x ->> 'unit' = 'STAFF';
  assert u ->> 'schedule_code' is null and (u ->> 'people')::int = 2
     and (u ->> 'own')::int = 1 and (u ->> 'following')::int = 0, u::text;
  assert exists (select 1 from jsonb_array_elements(r -> 'unlinked') x where x ->> 'employee_no' = 'S-2071'),
    'Staf satu mestinya belum punya jadwal';
  -- Unit di peta yang tidak dipakai siapa pun tetap terlihat.
  select x into u from jsonb_array_elements(r -> 'unit_defaults') x where x ->> 'unit' = 'Office';
  assert u ->> 'schedule_code' = 'KANTOR' and (u ->> 'people')::int = 0, u::text;

  -- Yang benar.
  a := ops_hr.set_unit_schedule(' STAFF ','KANTOR','2026-08-01','Staf kantor ikut jam kantor','k-207');
  assert a ->> 'outcome' = 'ok', a::text;
  assert (a -> 'data' ->> 'version')::int = 2 and (a -> 'data' ->> 'following')::int = 1
     and a -> 'data' ->> 'unit' = 'STAFF', a::text;

  -- Kunci idempoten: kiriman ulang tidak menulis versi ketiga.
  a := ops_hr.set_unit_schedule(' STAFF ','KANTOR','2026-08-01','Staf kantor ikut jam kantor','k-207');
  assert (select count(*) from ops_hr.pay_rule_sets) = 2, 'kiriman ulang menulis versi baru';

  -- Aturan lain disalin utuh; buku lama tidak berubah.
  assert ops_hr.rules_on('2026-08-01') - 'schedule_by_unit' = ops_hr.rules_on('2026-07-31') - 'schedule_by_unit',
    'aturan selain peta unit ikut berubah';
  assert ops_hr.rules_on('2026-07-31') -> 'schedule_by_unit' = '{"Workshop":"PRODUKSI","Office":"KANTOR"}'::jsonb,
    'buku lama berubah';
  assert ops_hr.rules_on('2026-08-01') -> 'schedule_by_unit'
       = '{"Workshop":"PRODUKSI","Office":"KANTOR","STAFF":"KANTOR"}'::jsonb,
    (ops_hr.rules_on('2026-08-01') -> 'schedule_by_unit')::text;

  -- Tanggal sebelum versi 2: perubahannya akan hilang pada 1 Agustus.
  a := ops_hr.set_unit_schedule('Workshop','KANTOR','2026-07-15','mundur');
  assert a -> 'error' ->> 'code' = 'later_version_exists', a::text;
end $$;

/* ── dibaca, lalu dilepas ───────────────────────────────────────────────── */
do $$
declare a jsonb; r jsonb; u jsonb; k jsonb;
begin
  -- `schedule_roll` membaca buku hari kantor ini; versi 2 berlaku sejak Agustus.
  r := ops_hr.schedule_roll();
  select x into u from jsonb_array_elements(r -> 'unit_defaults') x where x ->> 'unit' = 'STAFF';
  assert u ->> 'schedule_code' = 'KANTOR' and (u ->> 'people')::int = 2
     and (u ->> 'own')::int = 1 and (u ->> 'following')::int = 1, u::text;
  assert not exists (select 1 from jsonb_array_elements(r -> 'unlinked') x where x ->> 'employee_no' = 'S-2071'),
    'Staf satu mestinya ikut bawaan';
  assert exists (select 1 from jsonb_array_elements(r -> 'inherited') x
                  where x ->> 'employee_no' = 'S-2071' and x ->> 'schedule_code' = 'KANTOR'), r::text;
  select x into k from jsonb_array_elements(r -> 'schedules') x where x ->> 'code' = 'KANTOR';
  assert k -> 'units' = '["Office", "STAFF"]'::jsonb, k::text;

  -- Kode kosong melepas bawaan unit.
  a := ops_hr.set_unit_schedule('STAFF', '', '2026-08-01', 'staf diatur per orang');
  assert a ->> 'outcome' = 'ok', a::text;
  assert not (ops_hr.rules_on('2026-08-01') -> 'schedule_by_unit' ? 'STAFF'),
    (ops_hr.rules_on('2026-08-01') -> 'schedule_by_unit')::text;
  r := ops_hr.schedule_roll();
  assert exists (select 1 from jsonb_array_elements(r -> 'unlinked') x where x ->> 'employee_no' = 'S-2071'),
    'Staf satu mestinya kembali tanpa jadwal';

  -- Melepas yang sudah lepas: noop.
  a := ops_hr.set_unit_schedule('STAFF', null, '2026-08-01', 'lagi');
  assert a ->> 'outcome' = 'noop', a::text;
end $$;

/* ── tanggal di dalam run gaji ──────────────────────────────────────────── */
reset role;
insert into ops_hr.payroll_runs (run_no, period_start, period_end, status)
values ('PAY-207', '2026-09-01', '2026-09-30', 'DRAFT');
set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000020701';

do $$
declare a jsonb;
begin
  a := ops_hr.set_unit_schedule('STAFF','KANTOR','2026-09-15','tengah periode');
  assert a -> 'error' ->> 'code' = 'inside_existing_run', a::text;
end $$;

rollback;
