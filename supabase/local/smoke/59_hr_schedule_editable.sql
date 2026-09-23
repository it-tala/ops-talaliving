-- 59_hr_schedule_editable.sql — jadwal kerja bisa diketik, jadi database
--                               harus mulai menolak apa yang bisa diketik.
--
-- Yang dibuktikan: bentuk pola diperiksa di `save` **dan** di `preview`, karena
-- pratinjau yang diam-diam melewatkan orang adalah pratinjau terburuk untuk
-- ditunjukkan ke orang yang sebentar lagi menekan simpan; pola yang masih
-- dipakai tidak boleh hilang dari versi baru, dan penjaganya harus bisa
-- **melihat** karyawan meski IT tidak punya `hrd.read` (F135); pemetaan unit
-- tidak boleh menggantung; dan trigger menjaga jalan yang ditempuh migrasi,
-- bukan hanya jalan yang ditempuh layar.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-000000005901','it59@talaliving.com','{"full_name":"IT"}');
insert into ops_core.user_modules (user_id, module, level) values
  -- Sengaja HANYA it. Tidak ada hrd sama sekali: itulah yang membuat
  -- `schedules_in_use_lost` harus definer.
  ('ffffffff-0000-0000-0000-000000005901','it','admin');

insert into ops_hr.pay_rule_sets (version, effective_from, note, rules, created_by) values
 (1, current_date - 30, 'uji', '{
   "week_pattern":"5day","day_starts_minutes":480,
   "overtime_mode":"flat","flat_multiplier":1,
   "workday_tiers":[{"after_hours":0,"multiplier":1}],
   "restday_tiers":[{"after_hours":0,"multiplier":1}],
   "monthly_divisor":173,"hourly_basis":"company","effective_days_per_year":240,
   "hourly_includes_allowance":false,"overtime_rounding_minutes":0,
   "undertime_mode":"off","undertime_grace_minutes":15,
   "late_grace_minutes":0,"late_mode":"manual","late_forfeits_allowance":false,
   "schedules":[
     {"code":"PRODUKSI","name":"Produksi","start_minutes":450,"end_minutes":990,
      "break_minutes":45,"friday_break_minutes":90,"friday_end_minutes":960,"note":null},
     {"code":"KANTOR","name":"Kantor","start_minutes":480,"end_minutes":1035,
      "break_minutes":60,"friday_break_minutes":90,"friday_end_minutes":990,"note":null}],
   "schedule_by_unit":{"Produksi":"PRODUKSI"}
 }'::jsonb, 'ffffffff-0000-0000-0000-000000005901');

insert into ops_hr.employees
  (id, employee_no, full_name, position, unit, pay_basis, base_rate, allowance_rate,
   daily_hours, schedule_code, paid_leave_days, joined_on)
values
  ('aaaa5900-0000-0000-0000-000000000001','B-5901','Karjo','Tukang','Produksi','daily',
   180000, 25000, 8.25, 'PRODUKSI', 12, current_date - 365),
  ('aaaa5900-0000-0000-0000-000000000002','B-5902','Wulan','Admin','Kantor','monthly',
   4500000, 25000, 8.25, 'KANTOR', 12, current_date - 365),
  -- Keluar, jadi tidak boleh ikut menahan pola yang dihapus.
  ('aaaa5900-0000-0000-0000-000000000003','B-5903','Mantan','Admin','Kantor','monthly',
   4500000, 25000, 8.25, 'KANTOR', 12, current_date - 365);
update ops_hr.employees set active = false, left_on = current_date - 10
 where employee_no = 'B-5903';

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000005901';

-- Buku yang sama, dipakai sebagai dasar untuk tiap percobaan di bawah.
create temporary table book on commit drop as
  select rules as r from ops_hr.pay_rule_sets where version = 1;

do $$
declare
  base jsonb;
  a    jsonb;
  cand jsonb;
begin
  select r into base from book;

  ---------------------------------------------------------------- bentuk
  -- Kode huruf kecil ditolak di SAVE, dengan kalimat bukan dengan exception.
  cand := jsonb_set(base, '{schedules,0,code}', '"produksi"'::jsonb);
  a := ops_hr.save_pay_rules(current_date + 7, 'coba', cand);
  assert (a -> 'error' ->> 'status')::int = 422, format('422, got %s', a);
  assert a -> 'error' ->> 'code' = 'code_shape', format('got %s', a);
  assert a -> 'error' ->> 'message' like 'Pola produksi:%', format('got %s', a);

  -- Dan di PREVIEW juga. Pratinjau yang menghitung dulu baru mengeluh adalah
  -- pratinjau yang sudah diam-diam mengeluarkan orang dari hitungannya.
  a := ops_hr.preview_pay_rules(cand, current_date - 7, current_date - 1);
  assert (a -> 'error' ->> 'status')::int = 422, format('preview 422, got %s', a);
  assert a -> 'error' ->> 'code' = 'code_shape', format('preview got %s', a);

  -- Unit menggantung: pola yang ditunjuk tidak ada.
  cand := jsonb_set(base, '{schedule_by_unit}', '{"Produksi":"GUDANG"}'::jsonb);
  a := ops_hr.save_pay_rules(current_date + 7, 'coba', cand);
  assert a -> 'error' ->> 'code' = 'unit_unknown_code', format('got %s', a);

  ------------------------------------------------- pola yang masih dipakai
  -- KANTOR dibuang sementara Wulan masih memakainya. Ditolak, dan orangnya
  -- disebut namanya — *pindahkan dulu* hanya bisa dikerjakan kalau tahu siapa.
  cand := jsonb_set(
    jsonb_set(base, '{schedules}',
      (select jsonb_agg(s.value) from jsonb_array_elements(base->'schedules') s
        where s.value ->> 'code' <> 'KANTOR')),
    '{schedule_by_unit}', '{"Produksi":"PRODUKSI"}'::jsonb);
  a := ops_hr.save_pay_rules(current_date + 7, 'buang kantor', cand);
  assert (a -> 'error' ->> 'status')::int = 409, format('409, got %s', a);
  assert a -> 'error' ->> 'code' = 'schedule_in_use', format('got %s', a);
  assert a -> 'error' ->> 'message' like '%KANTOR (1 orang: Wulan)%', format('got %s', a);
  -- Satu orang, bukan dua: yang sudah keluar tidak ikut menahan pola.
  assert a -> 'error' ->> 'message' not like '%Mantan%', 'orang yang sudah keluar ikut terhitung';

  -- Pratinjau mengatakannya lebih dulu, tanpa menolak — supaya pekerjaannya
  -- terlihat sebelum versinya ditulis, bukan sesudah ditolak.
  a := ops_hr.preview_pay_rules(cand, current_date - 7, current_date - 1);
  assert a ->> 'outcome' = 'ok', format('preview got %s', a);
  assert a -> 'data' ->> 'schedules_lost' like '%KANTOR (1 orang: Wulan)%',
    'got ' || coalesce(a -> 'data' ->> 'schedules_lost','(null)');

  -- Membuang pola yang tidak dipakai siapa pun boleh. PRODUKSI dipakai Karjo,
  -- jadi yang dibuang harus pola ketiga yang kosong.
  cand := jsonb_set(base, '{schedules}',
            (base -> 'schedules') || '[{"code":"KOSONG","name":"Belum dipakai",
              "start_minutes":null,"end_minutes":null,"break_minutes":null,
              "friday_break_minutes":null,"friday_end_minutes":null,"note":null}]'::jsonb);
  a := ops_hr.save_pay_rules(current_date + 7, 'tambah pola kosong', cand);
  assert a ->> 'outcome' = 'ok', format('menambah pola seharusnya boleh: %s', a);
end $$;

/* ── penjaga itu definer, jadi ia tidak boleh bisa ditanya sembarang orang ─ */
--
-- `schedules_in_use_lost` menjawab dengan **nama karyawan** dan berjalan
-- sebagai definer supaya IT (yang tidak punya `hrd.read`) tetap terjaga. Dua
-- sifat itu bersama-sama berarti satu hal: ia tidak boleh bisa dipanggil
-- langsung. Postgres memberi EXECUTE ke PUBLIC pada fungsi baru secara
-- bawaan, jadi *tidak melakukan apa-apa* sama dengan memberi izin — dan
-- siapa pun yang punya akun bisa menanyakan daftar nama. Ditemukan lewat
-- mutasi, bukan lewat kecurigaan (F141).
do $$
declare r text; denied boolean := false;
begin
  begin
    r := ops_hr.schedules_in_use_lost('{"schedules":[]}'::jsonb);
  exception when insufficient_privilege then denied := true;
  end;
  assert denied, 'siapa pun bisa menanyakan siapa yang ada di pola mana: ' || coalesce(r,'(null)');
end $$;

-- Penjaga terakhir, di jalan yang ditempuh migrasi dan bukan layar: trigger.
do $$
declare bad jsonb; ok_raised boolean := false;
begin
  select r into bad from book;
  bad := jsonb_set(bad, '{schedules,0,end_minutes}', '400'::jsonb); -- pulang sebelum masuk
  begin
    insert into ops_hr.pay_rule_sets (version, effective_from, note, rules)
    values (99, current_date + 30, 'lewat migrasi', bad);
  exception when check_violation then
    ok_raised := true;
  end;
  assert ok_raised, 'trigger membiarkan jadwal tidak sah masuk lewat insert langsung';
end $$;

rollback;
