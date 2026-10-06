-- 228_hr_task_daily_routines.sql — tugas rutin harian (D383).
--
-- Yang dibuktikan:
--   • irama DAILY: satu tugas per hari, periodenya hari itu sendiri;
--   • tidak pernah ditarik mundur — menerbitkan dengan mundur 31 hari tetap
--     hanya membuat tugas hari itu; menjalankan dua kali tidak menggandakan;
--   • tidak terbit di hari libur mingguan, di tanggal merah kantor, atau di hari
--     yang ditandai cuti/sakit untuk orangnya; setengah hari tetap terbit;
--   • tugas pagi (`raise_routine_tasks(..., 'DAILY')`) hanya menerbitkan yang
--     harian, bukan yang bulanan;
--   • lonceng berbunyi, Chat tidak; serah tugas harian tidak diumumkan;
--   • hanya pemilik database (cron) dan `roll_task_routines` (HRD) yang bisa
--     menerbitkan.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-000000022801','hrd228@talaliving.com','{"full_name":"Dewi HRD"}'),
  ('ffffffff-0000-0000-0000-000000022802','sari228@talaliving.com','{"full_name":"Sari"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-000000022801','hrd','admin'),
  ('ffffffff-0000-0000-0000-000000022802','procurement','read');
insert into ops_hr.employees
  (id, employee_no, full_name, position, unit, pay_basis, base_rate, allowance_rate,
   daily_hours, joined_on, user_id)
values ('aaaa2280-0000-0000-0000-000000000001','B-2281','Sari','Admin gudang','Kantor',
        'monthly', 4000000, 25000, 8, '2026-01-01','ffffffff-0000-0000-0000-000000022802');

create temp table k (key text primary key, val text) on commit drop;
grant all on k to authenticated;

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000022801';
do $$
declare a jsonb;
begin
  a := ops_hr.save_task_routine(null, 'Cek kas kecil harian', 'Foto buku kas ke grup WA', 'B-2281',
                                'DAILY', 0, 0, date '2026-10-01');
  assert a ->> 'outcome' = 'ok', a::text;
  insert into k values ('daily', a -> 'data' ->> 'routine_no');
  a := ops_hr.save_task_routine(null, 'Laporan stok bulanan', 'Excel stok', 'B-2281',
                                'MONTHLY', 4, 2, date '2026-10-01');
  assert a ->> 'outcome' = 'ok', a::text;

  -- Senin 05-10, dengan mundur 31 hari: harian hanya hari itu.
  a := ops_hr.roll_task_routines(date '2026-10-05', 31);
  assert a ->> 'outcome' = 'ok', a::text;
  assert (select count(*) from ops_hr.tasks t join ops_hr.task_routines r on r.id = t.routine_id
           where r.routine_no = (select val from k where key = 'daily')) = 1,
    'rutin harian ditarik mundur';
  assert (select period_start from ops_hr.tasks t join ops_hr.task_routines r on r.id = t.routine_id
           where r.routine_no = (select val from k where key = 'daily')) = date '2026-10-05';

  -- Dua kali: tidak bertambah.
  a := ops_hr.roll_task_routines(date '2026-10-05', 0);
  assert (a -> 'data' ->> 'created')::int = 0 and (a -> 'data' ->> 'already_there')::int >= 1, a::text;

  -- Minggu 11-10: hari libur mingguan.
  a := ops_hr.roll_task_routines(date '2026-10-11', 0);
  assert (a -> 'data' ->> 'not_a_working_day')::int = 1, a::text;
  assert not exists (select 1 from ops_hr.tasks where period_start = date '2026-10-11'
                       and routine_id is not null), 'tugas harian terbit di hari Minggu';
end $$;

reset role;
do $$
declare a jsonb; v_task text;
begin
  -- Cuti Sari 06-10, tanggal merah kantor 07-10, setengah hari 08-10.
  insert into ops_hr.day_marks (employee_id, work_date, kind, reason, marked_by) values
    ('aaaa2280-0000-0000-0000-000000000001', date '2026-10-06', 'leave', 'Cuti tahunan', 'ffffffff-0000-0000-0000-000000022801'),
    (null,                                   date '2026-10-07', 'holiday', 'Libur kantor', 'ffffffff-0000-0000-0000-000000022801'),
    ('aaaa2280-0000-0000-0000-000000000001', date '2026-10-08', 'half_day', 'Urusan keluarga', 'ffffffff-0000-0000-0000-000000022801');

  assert not ops_hr.works_on('aaaa2280-0000-0000-0000-000000000001', date '2026-10-06'), 'cuti dianggap hari kerja';
  assert not ops_hr.works_on('aaaa2280-0000-0000-0000-000000000001', date '2026-10-07'), 'tanggal merah dianggap hari kerja';
  assert ops_hr.works_on('aaaa2280-0000-0000-0000-000000000001', date '2026-10-08'), 'setengah hari dianggap libur';

  -- Pekerjaan pagi: hanya harian.
  a := ops_hr.raise_routine_tasks(date '2026-10-06', 0, 'DAILY');
  assert (a ->> 'created')::int = 0 and (a ->> 'not_a_working_day')::int = 1, a::text;
  a := ops_hr.raise_routine_tasks(date '2026-10-08', 0, 'DAILY');
  assert (a ->> 'created')::int = 1, a::text;
  -- Tidak ada tugas bulanan baru dari pekerjaan pagi (yang bulanan sudah ada dari roll 05-10).
  assert (select count(*) from ops_hr.tasks t join ops_hr.task_routines r on r.id = t.routine_id
           where r.cadence = 'MONTHLY') = 1;

  -- Jalan sebagai cron (tanpa pengguna): tidak error, jawabannya angka.
  a := ops_hr.raise_daily_routines();
  assert a ? 'created', a::text;

  select t.task_no into v_task from ops_hr.tasks t
   where t.period_start = date '2026-10-05' and t.routine_id is not null
     and (select cadence from ops_hr.task_routines where id = t.routine_id) = 'DAILY';
  insert into k values ('d05', v_task);

  -- Lonceng ya, Chat tidak.
  assert exists (select 1 from ops_core.notifications where entity_no = v_task
                  and kind = 'task.assigned' and (data ->> 'daily')::boolean), 'lonceng tugas harian tidak berbunyi';
  assert not exists (select 1 from ops_core.outbox where entity_no = v_task), 'tugas harian dikirim ke Chat';
  assert (select ops_hr.task_period_label('DAILY', date '2026-10-05')) = '05-10-2026';

  assert not has_function_privilege('authenticated', 'ops_hr.raise_routine_tasks(date,integer,ops_hr.task_cadence_t)', 'EXECUTE'),
    'raise_routine_tasks terbuka untuk authenticated';
  assert not has_function_privilege('authenticated', 'ops_hr.raise_daily_routines()', 'EXECUTE'),
    'raise_daily_routines terbuka untuk authenticated';
end $$;

/* ── Sari menyerahkan tugas harian: tidak diumumkan ───────────────────── */
set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000022802';
do $$
declare a jsonb; v_task text := (select val from k where key = 'd05');
begin
  a := ops_hr.update_task(v_task, 'done', null, 'Foto buku kas sudah di grup WA');
  assert a ->> 'outcome' = 'ok', a::text;
end $$;

reset role;
do $$
begin
  assert not exists (select 1 from ops_core.notifications
                      where entity_no = (select val from k where key = 'd05') and kind = 'task.delivered'),
    'serah tugas harian diumumkan';
end $$;

rollback;
