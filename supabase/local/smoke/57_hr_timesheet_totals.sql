-- 57_hr_timesheet_totals.sql — berapa jam dan berapa hari, dan kenapa sebuah
--                              total tidak boleh berdiri sendirian.
--
-- Yang dibuktikan: jam dijumlahkan dari pembacaan hari dan bukan dari selisih
-- tap mentah; setengah hari bernilai 0,5; hari yang **belum dibaca** bernilai
-- nol **dan dihitung terpisah**, karena total tanpa keterangan itu adalah
-- angka yang terlalu kecil yang dipercaya orang; tanggal merah tidak menambah
-- hari; dan totalnya hanya berisi orang yang ditanyakan.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-000000005701','hrd57@talaliving.com','{"full_name":"HRD"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-000000005701','hrd','write');

insert into ops_hr.pay_rule_sets (version, effective_from, note, rules, created_by) values
 (1, current_date - 90, 'uji', '{
   "week_pattern":"6day","day_starts_minutes":480,
   "schedules":[{"code":"PRODUKSI","name":"Produksi","start_minutes":450,"end_minutes":990,
                 "break_minutes":45,"friday_break_minutes":90,"note":null}],
   "schedule_by_unit":{"Produksi":"PRODUKSI"}
 }'::jsonb, 'ffffffff-0000-0000-0000-000000005701');

insert into ops_hr.employees
  (id, employee_no, full_name, position, unit, pay_basis, base_rate, allowance_rate,
   daily_hours, schedule_code, paid_leave_days, joined_on)
values
  ('aaaa5700-0000-0000-0000-000000000001','B-5701','Karjo','Tukang','Produksi','daily',
   180000, 25000, 8, 'PRODUKSI', 12, current_date - 365),
  -- Orang kedua, di unit lain: totalnya tidak boleh bocor ke baris Karjo.
  ('aaaa5700-0000-0000-0000-000000000002','B-5702','Wulan','Admin','Kantor','monthly',
   4500000, 25000, 8, null, 12, current_date - 365);

-- Hari 1 dan 2: empat tap bersih, 8,5 jam masing-masing (07.30→16.30 kurang 30' istirahat).
--
-- `::timestamp` sebelum `at time zone` bukan hiasan. `generate_series` atas
-- dua `date` mengembalikan **timestamptz**, dan `at time zone` atas timestamptz
-- berjalan ke arah sebaliknya — ia membaca jam dinding, bukan menetapkannya —
-- sehingga tiap tap bergeser delapan jam dan harinya terbaca sebagai *belum
-- dibaca*. Kesalahan itu ada di fixture ini dan bukan di `read_day`, dan ia
-- terlihat persis seperti bug di aturan slotnya.
insert into ops_hr.attendance_scans (employee_id, work_date, at, verify, source, reason, recorded_by)
select 'aaaa5700-0000-0000-0000-000000000001', d::date,
       (d::date + t)::timestamp at time zone 'Asia/Makassar', 'MANUAL','manual','seed',
       'ffffffff-0000-0000-0000-000000005701'
from generate_series(current_date - 10, current_date - 9, interval '1 day') d,
     unnest(array[time '07:30', time '12:00', time '12:30', time '16:30']) t;

-- Hari 3: tiga tap — pulangnya tidak ada, jadi hari itu **belum dibaca**.
insert into ops_hr.attendance_scans (employee_id, work_date, at, verify, source, reason, recorded_by)
select 'aaaa5700-0000-0000-0000-000000000001', (current_date - 8)::date,
       ((current_date - 8)::date + t)::timestamp at time zone 'Asia/Makassar', 'MANUAL','manual','seed',
       'ffffffff-0000-0000-0000-000000005701'
from unnest(array[time '07:30', time '12:00', time '12:30']) t;

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000005701';

/* ── dua hari bersih: jam dari pembacaan, bukan dari selisih tap ───────── */
do $$
declare t ops_hr.timesheet_total_t;
begin
  select * into t from ops_hr.timesheet_totals(current_date - 10, current_date - 9, null,'B-5701');
  assert t.work_hours = 17.0, '2 hari × 8,5 jam, dapat ' || t.work_hours;
  assert t.days_counted = 2,  'dua hari penuh, dapat ' || t.days_counted;
  assert t.days_complete = 2, 'dapat ' || t.days_complete;
  assert t.days_review = 0,   'dapat ' || t.days_review;
  assert t.break_hours = 1.0, 'istirahat 2 × 30 menit, dapat ' || t.break_hours;
end $$;

/* ── hari yang belum dibaca bernilai nol DAN dihitung terpisah ─────────── */
do $$
declare t ops_hr.timesheet_total_t;
begin
  select * into t from ops_hr.timesheet_totals(current_date - 10, current_date - 8, null,'B-5701');
  assert t.days_review = 1,
    'hari tanpa pulang harus dihitung sebagai belum dibaca, dapat ' || t.days_review;
  -- **Inilah alasan kolomnya ada.** Harinya tidak menambah nilai, jadi tanpa
  -- `days_review` totalnya terbaca seperti dua hari kerja yang lengkap.
  assert t.days_counted = 2,
    'hari yang belum dibaca tidak boleh bernilai, dapat ' || t.days_counted;
  assert t.work_hours = 17.0,
    'jam dari hari yang belum dibaca tidak ikut, dapat ' || t.work_hours;
end $$;

/* ── setengah hari bernilai 0,5; tanggal merah tidak menambah hari ─────── */
do $$
declare t ops_hr.timesheet_total_t; a jsonb;
begin
  a := ops_hr.mark_day(current_date - 7, 'half_day','pulang cepat','B-5701');
  assert a ->> 'outcome' = 'ok', a ->> 'outcome';
  a := ops_hr.mark_day(current_date - 6, 'holiday','tanggal merah');
  assert a ->> 'outcome' = 'ok', a ->> 'outcome';

  select * into t from ops_hr.timesheet_totals(current_date - 7, current_date - 6, null,'B-5701');
  assert t.days_counted = 0.5,
    'setengah hari 0,5 dan tanggal merah nol, dapat ' || t.days_counted;
  assert t.days_marked = 2, 'dapat ' || t.days_marked;
end $$;

/* ── satu baris per orang, dan unitnya menyaring ───────────────────────── */
do $$
declare n int; who text;
begin
  select count(*) into n from ops_hr.timesheet_totals(current_date - 10, current_date, null, null);
  assert n = 2, 'dua orang aktif, dapat ' || n;

  select count(*), string_agg(employee_no, ',') into n, who
    from ops_hr.timesheet_totals(current_date - 10, current_date, 'Produksi', null);
  assert n = 1 and who = 'B-5701', 'saringan unit: dapat ' || n || ' — ' || coalesce(who,'∅');

  -- Yang ditanyakan satu orang tidak pernah membawa jam orang lain.
  select count(*) into n from ops_hr.timesheet_totals(current_date - 10, current_date, null,'B-5702');
  assert n = 1, 'dapat ' || n;
end $$;

rollback;
