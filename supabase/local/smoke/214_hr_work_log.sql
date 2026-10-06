-- 214_hr_work_log.sql — laporan harian, dan ukuran yang dibangun di atasnya.
--
-- Yang dibuktikan:
--   • hanya orangnya sendiri yang menulis lognya, hanya untuk hari ini;
--     kemarin tidak bisa diubah atau dihapus; HRD tidak punya jalan untuk
--     menulis log siapa pun;
--   • entri tugas hanya untuk tugas sendiri, satu per tugas per hari;
--     dadakan wajib menyebut siapa yang meminta;
--   • staf membaca lognya sendiri saja, HRD membaca semua;
--   • HRD bisa menjadikan dadakan tugas — entrinya tetap dadakan, tugasnya
--     dianggap sudah diterima dan dimulai sejak entri ditulis;
--   • ukuran *Laporan harian terisi* menghitung hari kerja saja: hari libur
--     mingguan dan hari bertanda cuti tidak pernah dihitung kurang, dan hari
--     ini belum dihitung;
--   • bukti PA bisa dibaca orangnya sendiri, tidak oleh rekan;
--   • `kpi_board` dan `work_log_roster` tertutup untuk staf.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-000000021301','hrd213@talaliving.com','{"full_name":"Pimpinan"}'),
  ('ffffffff-0000-0000-0000-000000021302','sari213@talaliving.com','{"full_name":"Sari"}'),
  ('ffffffff-0000-0000-0000-000000021303','budi213@talaliving.com','{"full_name":"Budi"}'),
  ('ffffffff-0000-0000-0000-000000021304','lain213@talaliving.com','{"full_name":"Tanpa tautan"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-000000021301','hrd','admin'),
  ('ffffffff-0000-0000-0000-000000021301','payroll','admin'),
  ('ffffffff-0000-0000-0000-000000021304','procurement','admin'),
  -- Sari dan Budi staf kantor: satu modul yang tidak memberi akses HRD atau
  -- penggajian. Akun tanpa modul adalah akun pekerja lapangan (D331), dan
  -- orang seperti itu tidak wajib mengisi laporan harian (D371).
  ('ffffffff-0000-0000-0000-000000021302','procurement','read'),
  ('ffffffff-0000-0000-0000-000000021303','procurement','read');

insert into ops_hr.employees
  (id, employee_no, full_name, position, unit, pay_basis, base_rate, allowance_rate,
   daily_hours, joined_on, user_id)
values ('aaaa2130-0000-0000-0000-000000000001','B-2131','Sari','Drafter','Kantor',
        'monthly', 4000000, 25000, 8, '2026-01-01','ffffffff-0000-0000-0000-000000021302'),
       ('aaaa2130-0000-0000-0000-000000000002','B-2132','Budi','IT','Kantor',
        'monthly', 4500000, 25000, 8, '2026-01-01','ffffffff-0000-0000-0000-000000021303');

create temp table k (key text primary key, val text) on commit drop;
grant all on k to authenticated;

set local role authenticated;

/* ── tugas untuk Sari dan Budi ─────────────────────────────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000021301';
do $$
declare a jsonb;
begin
  a := ops_hr.assign_task('B-2131','Gambar kerja kursi', ops_core.office_day() + 5);
  insert into k values ('sari_task', a -> 'data' ->> 'task_no');
  a := ops_hr.assign_task('B-2132','Update BOM kursi', ops_core.office_day() + 5);
  insert into k values ('budi_task', a -> 'data' ->> 'task_no');

  -- HRD tidak punya tautan karyawan: tidak bisa menulis log siapa pun.
  a := ops_hr.log_work('Mengisi log orang lain', 'lanjut', null, 'Pimpinan');
  assert a -> 'error' ->> 'code' = 'no_employee_link', a::text;
end $$;

/* ── akun tanpa tautan karyawan ────────────────────────────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000021304';
do $$
declare a jsonb;
begin
  a := ops_hr.log_work('Apa saja', 'lanjut', null, 'Siapa');
  assert a ->> 'outcome' = 'refused' and a -> 'error' ->> 'code' = 'no_employee_link', a::text;
end $$;

/* ── Sari menulis lognya ───────────────────────────────────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000021302';
do $$
declare a jsonb; v_entry uuid;
        t_sari text := (select val from k where key = 'sari_task');
        t_budi text := (select val from k where key = 'budi_task');
begin
  a := ops_hr.log_work('  ', 'lanjut', t_sari);
  assert a -> 'error' ->> 'code' = 'summary_required', a::text;
  a := ops_hr.log_work('Menggambar', 'hampir', t_sari);
  assert a -> 'error' ->> 'code' = 'unknown_progress', a::text;
  a := ops_hr.log_work('Menggambar', 'lanjut', t_sari, null, 20);
  assert a -> 'error' ->> 'code' = 'hours_invalid', a::text;
  a := ops_hr.log_work('Membantu BOM', 'lanjut', t_budi);
  assert a -> 'error' ->> 'code' = 'task_not_yours', a::text;
  assert (a -> 'error' ->> 'status')::int = 403, a::text;

  a := ops_hr.log_work('Tampak depan dan samping selesai', 'lanjut', t_sari, null, 5);
  assert a ->> 'outcome' = 'ok', a::text;
  insert into k values ('sari_task_entry', a -> 'data' ->> 'entry_id');

  -- Satu catatan per tugas per hari.
  a := ops_hr.log_work('Lagi', 'lanjut', t_sari);
  assert a -> 'error' ->> 'code' = 'already_logged', a::text;

  -- Dadakan tanpa nama yang meminta: ditolak.
  a := ops_hr.log_work('Mengukur ulang ruang tamu klien', 'selesai');
  assert a -> 'error' ->> 'code' = 'requested_by_required', a::text;
  a := ops_hr.log_work('Mengukur ulang ruang tamu klien', 'selesai', null, 'Pak Evin', 2);
  assert a ->> 'outcome' = 'ok', a::text;
  insert into k values ('sari_dadakan', a -> 'data' ->> 'entry_id');

  -- Mengubah catatan hari ini: boleh.
  v_entry := (select val from k where key = 'sari_task_entry')::uuid;
  a := ops_hr.log_work('Tampak depan, samping, dan atas selesai', 'lanjut', t_sari, null, 6, v_entry);
  assert a ->> 'outcome' = 'ok', a::text;
end $$;

/* Kemarin, ditulis langsung oleh pemilik database — satu-satunya cara ia bisa
   ada, karena seamnya selalu memakai hari ini. */
reset role;
insert into ops_hr.work_log (id, employee_id, work_date, summary, progress, requested_by, created_by)
values ('bbbb2130-0000-0000-0000-000000000001','aaaa2130-0000-0000-0000-000000000001',
        ops_core.office_day() - 1, 'Kemarin', 'selesai', 'Pak Evin',
        'ffffffff-0000-0000-0000-000000021302');
set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000021302';
do $$
declare a jsonb;
begin
  a := ops_hr.log_work('Kemarin, diubah', 'selesai', null, 'Pak Evin', null,
                       'bbbb2130-0000-0000-0000-000000000001');
  assert a -> 'error' ->> 'code' = 'past_day', a::text;
  a := ops_hr.remove_work_log('bbbb2130-0000-0000-0000-000000000001');
  assert a -> 'error' ->> 'code' = 'past_day', a::text;
end $$;

/* ── Budi: tidak bisa menyentuh atau membaca log Sari ──────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000021303';
do $$
declare a jsonb; n int;
begin
  a := ops_hr.log_work('Mengambil alih', 'lanjut', null, 'Saya', null,
                       (select val from k where key = 'sari_dadakan')::uuid);
  assert a -> 'error' ->> 'code' = 'not_found' or (a -> 'error' ->> 'status')::int = 404, a::text;
  a := ops_hr.remove_work_log((select val from k where key = 'sari_dadakan')::uuid);
  assert (a -> 'error' ->> 'status')::int = 404, a::text;

  a := ops_hr.log_work('Mulai BOM', 'lanjut', (select val from k where key = 'budi_task'));
  assert a ->> 'outcome' = 'ok', a::text;

  select count(*) into n from ops_hr.v_work_log;
  assert n = 1, format('Budi membaca %s baris log, harusnya hanya miliknya', n);
  select count(*) into n from ops_hr.work_log;
  assert n = 1, format('Budi membaca %s baris log lewat tabel', n);

  begin
    perform ops_hr.work_evidence('B-2131', ops_core.office_day() - 30, ops_core.office_day());
    assert false, 'Budi membaca bukti kinerja Sari';
  exception when insufficient_privilege then null;
  end;
  begin
    perform ops_hr.work_log_roster(ops_core.office_day());
    assert false, 'staf membaca daftar laporan semua orang';
  exception when insufficient_privilege then null;
  end;
  begin
    perform ops_hr.kpi_board(ops_core.office_day() - 30, ops_core.office_day());
    assert false, 'staf membaca papan KPI';
  exception when insufficient_privilege then null;
  end;
  a := ops_hr.promote_work_log((select val from k where key = 'sari_dadakan')::uuid, ops_core.office_day() + 3);
  assert (a -> 'error' ->> 'status')::int = 403, a::text;
end $$;

/* ── Sari membaca lognya dan buktinya sendiri ──────────────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000021302';
do $$
declare n int; v jsonb; r ops_hr.v_work_log%rowtype;
begin
  select count(*) into n from ops_hr.v_work_log;
  assert n = 3, format('Sari membaca %s baris lognya', n);
  select * into r from ops_hr.v_work_log where kind = 'tugas';
  assert r.task_no = (select val from k where key = 'sari_task') and r.editable,
    'catatan tugas tidak tersambung ke tugasnya';
  select * into r from ops_hr.v_work_log where work_date < ops_core.office_day();
  assert not r.editable, 'catatan kemarin terbaca bisa diubah';

  v := ops_hr.work_evidence('B-2131', ops_core.office_day() - 30, ops_core.office_day());
  assert (v ->> 'entries')::int = 3, v::text;
  assert (v ->> 'dadakan_entries')::int = 2, v::text;
  assert (v ->> 'dadakan_share')::int = 67, v::text;
  assert (v -> 'requesters' -> 0 ->> 'requested_by') = 'Pak Evin', v::text;
  assert (v -> 'tasks' -> 0 ->> 'task_no') = (select val from k where key = 'sari_task'), v::text;
end $$;

/* ── HRD: membaca semua, menjadikan dadakan tugas ──────────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000021301';
do $$
declare a jsonb; n int; v_tno text; tv ops_hr.v_task%rowtype; r record;
        e_dadakan uuid := (select val from k where key = 'sari_dadakan')::uuid;
        e_task uuid := (select val from k where key = 'sari_task_entry')::uuid;
begin
  select count(*) into n from ops_hr.v_work_log;
  assert n = 4, format('HRD membaca %s baris log', n);

  a := ops_hr.promote_work_log(e_task, ops_core.office_day() + 3);
  assert a -> 'error' ->> 'code' = 'not_dadakan', a::text;

  a := ops_hr.promote_work_log(e_dadakan, ops_core.office_day() + 3);
  assert a ->> 'outcome' = 'ok', a::text;
  v_tno := a -> 'data' ->> 'task_no';
  select * into tv from ops_hr.v_task where task_no = v_tno;
  assert tv.assignee_no = 'B-2131', 'tugas dari dadakan jatuh ke orang lain';
  assert tv.acknowledged and tv.has_started, 'tugas dari dadakan belum dianggap diterima dan dimulai';

  a := ops_hr.promote_work_log(e_dadakan, ops_core.office_day() + 3);
  assert a -> 'error' ->> 'code' = 'already_promoted', a::text;
  -- Tetap dadakan: fakta bahwa ia datang tanpa rencana tidak dihapus.
  assert (select task_id from ops_hr.work_log where id = e_dadakan) is null,
    'entri dadakan berubah menjadi entri tugas';

  select * into r from ops_hr.work_log_roster(ops_core.office_day()) where employee_no = 'B-2131';
  assert r.entries = 2 and r.dadakan_entries = 1, format('roster Sari: %s/%s', r.entries, r.dadakan_entries);
end $$;

set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000021302';
do $$
declare a jsonb;
begin
  a := ops_hr.remove_work_log((select val from k where key = 'sari_dadakan')::uuid);
  assert a -> 'error' ->> 'code' = 'already_promoted', a::text;
end $$;

/* ── ukuran: hari kerja saja, cuti tidak dihitung, hari ini belum ─────── */
reset role;
do $$
declare
  v_from date := ops_core.office_day() - 14;
  v_leave date; v_expected int; lc record; m ops_hr.kpi_measure_t; i int := 0; d date;
begin
  update ops_core.settings set value = to_jsonb(v_from::text) where key = 'kpi.daily_log_from';

  -- Satu hari kerja dicatat cuti oleh HRD.
  select g::date into v_leave
    from generate_series(v_from, ops_core.office_day() - 1, interval '1 day') g
   where not ops_hr.is_rest_day(ops_hr.rules_on(g::date), g::date)
   order by g limit 1;
  insert into ops_hr.day_marks (employee_id, work_date, kind, reason, marked_by)
  values ('aaaa2130-0000-0000-0000-000000000001', v_leave, 'leave', 'Cuti tahunan',
          'ffffffff-0000-0000-0000-000000021301');

  -- Lima hari kerja lain diberi log, termasuk satu entri di hari cuti itu
  -- (tidak boleh menambah hari wajib).
  for d in select g::date from generate_series(v_from, ops_core.office_day() - 2, interval '1 day') g
            where not ops_hr.is_rest_day(ops_hr.rules_on(g::date), g::date) and g::date <> v_leave
            order by g loop
    exit when i >= 5;
    insert into ops_hr.work_log (employee_id, work_date, summary, progress, requested_by, created_by)
    values ('aaaa2130-0000-0000-0000-000000000001', d, 'Pekerjaan', 'lanjut', 'Pak Evin',
            'ffffffff-0000-0000-0000-000000021302');
    i := i + 1;
  end loop;

  select count(*) into v_expected
    from generate_series(v_from, ops_core.office_day() - 1, interval '1 day') g
   where not ops_hr.is_rest_day(ops_hr.rules_on(g::date), g::date);
  v_expected := v_expected - 1;  -- the leave day

  select * into lc from ops_hr.daily_log_coverage('aaaa2130-0000-0000-0000-000000000001', v_from, ops_core.office_day());
  assert lc.expected = v_expected, format('hari wajib %s, harusnya %s (libur mingguan dan cuti tidak dihitung)', lc.expected, v_expected);
  -- Kemarin juga punya log (dari atas), jadi 5 + 1 kalau kemarin hari kerja.
  assert lc.logged between 5 and 6, format('hari berlog %s', lc.logged);
  assert lc.counted_to = ops_core.office_day() - 1, 'hari ini ikut dihitung';

  select * into m from ops_hr.kpi_measures('aaaa2130-0000-0000-0000-000000000001', v_from, ops_core.office_day())
   where key = 'daily_log';
  assert m.value = round(lc.logged::numeric / lc.expected * 100)::int,
    format('ukuran laporan harian %s, basis %s', m.value, m.basis);
  assert m.weight = 25, 'bobot bawaan bukan 25';

  -- Akun pekerja lapangan (tanpa modul): tidak wajib mengisi, tidak terukur.
  insert into auth.users (id, email, raw_user_meta_data) values
    ('ffffffff-0000-0000-0000-000000021305','pekerja213@talaliving.com','{"full_name":"Roni"}');
  insert into ops_hr.employees (id, employee_no, full_name, position, unit, pay_basis, base_rate,
                                allowance_rate, daily_hours, joined_on, user_id)
  values ('aaaa2130-0000-0000-0000-000000000004','B-2134','Roni','Tukang','Produksi',
          'daily', 180000, 25000, 8, '2026-01-01','ffffffff-0000-0000-0000-000000021305');
  select * into m from ops_hr.kpi_measures('aaaa2130-0000-0000-0000-000000000004', v_from, ops_core.office_day())
   where key = 'daily_log';
  assert m.value is null, 'akun pekerja lapangan dinilai laporan hariannya';
  assert not ops_hr.owes_daily_log('aaaa2130-0000-0000-0000-000000000004'),
    'akun pekerja lapangan dianggap wajib mengisi';
  assert ops_hr.owes_daily_log('aaaa2130-0000-0000-0000-000000000001'),
    'staf kantor dianggap tidak wajib mengisi';

  -- Orang tanpa akun: tidak terukur, bukan nol.
  insert into ops_hr.employees (id, employee_no, full_name, position, unit, pay_basis, base_rate,
                                allowance_rate, daily_hours, joined_on)
  values ('aaaa2130-0000-0000-0000-000000000003','B-2133','Karjo','Tukang','Produksi',
          'daily', 180000, 25000, 8, '2026-01-01');
  select * into m from ops_hr.kpi_measures('aaaa2130-0000-0000-0000-000000000003', v_from, ops_core.office_day())
   where key = 'daily_log';
  assert m.value is null and m.unmeasured_reason is not null, 'orang tanpa akun diberi nilai';
end $$;

/* ── papan KPI live: empat ukuran, dibaca lewat penggajian ─────────────── */
set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000021301';
do $$
declare v jsonb; c jsonb;
begin
  v := ops_hr.kpi_board(ops_core.office_day() - 14, ops_core.office_day(), 'B-2131');
  assert jsonb_array_length(v) = 1, v::text;
  c := v -> 0;
  assert (c ->> 'measure_count')::int = 4, c::text;
  assert jsonb_array_length(c -> 'measures') = 4, c::text;
  assert exists (select 1 from jsonb_array_elements(c -> 'measures') x where x ->> 'key' = 'daily_log'), c::text;
  assert exists (select 1 from jsonb_array_elements_text(c -> 'notes') n where n like '%dadakan%'),
    'catatan porsi dadakan tidak muncul di kartu';

  begin
    perform ops_hr.kpi_board(ops_core.office_day() - 14, ops_core.office_day(), 'X-0000');
    assert false, 'karyawan yang tidak ada tidak ditolak';
  exception when no_data_found then null;
  end;
end $$;

reset role;
do $$
begin
  assert not has_function_privilege('anon', 'ops_hr.log_work(text,text,text,text,numeric,uuid)', 'EXECUTE'), 'log_work terbuka untuk anon';
  assert not has_function_privilege('anon', 'ops_hr.kpi_board(date,date,text)', 'EXECUTE'), 'kpi_board terbuka untuk anon';
end $$;

rollback;
