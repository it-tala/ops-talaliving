-- 215_core_task_notifications.sql — tugas baru dan tugas diserahkan sampai ke
-- orangnya: lonceng web dan event Chat (D374).
--
-- Yang dibuktikan:
--   • tugas baru → satu notifikasi untuk penerima tugas dan satu event
--     `hr.task.assigned` beralamat emailnya; pemberi tugas tidak diberi tahu;
--   • karyawan tanpa akun tidak menghasilkan apa-apa (tidak ada yang bisa
--     diberi tahu), dan menugaskan diri sendiri juga tidak;
--   • memindahkan tugas ke orang lain memberi tahu orang barunya;
--   • tugas ditutup dengan catatan serah → HRD (write/admin) dan pemberi
--     tugas diberi tahu, HRD read-only dan yang menutup tidak;
--   • lonceng hanya bisa dibaca dan ditandai oleh pemiliknya;
--   • kedua event hidup di `delivery_rules`.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-000000021501','hrd215@talaliving.com','{"full_name":"Dewi HRD"}'),
  ('ffffffff-0000-0000-0000-000000021502','tulis215@talaliving.com','{"full_name":"Ryan HRD"}'),
  ('ffffffff-0000-0000-0000-000000021503','baca215@talaliving.com','{"full_name":"Evin"}'),
  ('ffffffff-0000-0000-0000-000000021504','sari215@talaliving.com','{"full_name":"Sari"}'),
  ('ffffffff-0000-0000-0000-000000021505','budi215@talaliving.com','{"full_name":"Budi"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-000000021501','hrd','admin'),
  ('ffffffff-0000-0000-0000-000000021502','hrd','write'),
  ('ffffffff-0000-0000-0000-000000021503','hrd','read'),
  ('ffffffff-0000-0000-0000-000000021504','procurement','read'),
  ('ffffffff-0000-0000-0000-000000021505','procurement','read');

insert into ops_hr.employees
  (id, employee_no, full_name, position, unit, pay_basis, base_rate, allowance_rate,
   daily_hours, joined_on, user_id)
values ('aaaa2150-0000-0000-0000-000000000001','B-2151','Sari','Drafter','Kantor',
        'monthly', 4000000, 25000, 8, '2026-01-01','ffffffff-0000-0000-0000-000000021504'),
       ('aaaa2150-0000-0000-0000-000000000002','B-2152','Budi','IT','Kantor',
        'monthly', 4500000, 25000, 8, '2026-01-01','ffffffff-0000-0000-0000-000000021505'),
       ('aaaa2150-0000-0000-0000-000000000003','B-2153','Karjo','Tukang','Produksi',
        'daily', 150000, 0, 8, '2026-01-01', null),
       ('aaaa2150-0000-0000-0000-000000000004','B-2154','Ryan','HRD','Kantor',
        'monthly', 5000000, 25000, 8, '2026-01-01','ffffffff-0000-0000-0000-000000021502');

create temp table k (key text primary key, val text) on commit drop;
grant all on k to authenticated;

set local role authenticated;

/* ── Dewi menugaskan ───────────────────────────────────────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000021501';
do $$
declare a jsonb; v_out jsonb;
begin
  a := ops_hr.assign_task('B-2151','Gambar kerja kursi', ops_core.office_day() + 5,
                          p_deliverable => 'PDF gambar kerja di folder DRAFTING');
  assert a ->> 'outcome' = 'ok', a::text;
  insert into k values ('sari_task', a -> 'data' ->> 'task_no');

  -- Karyawan tanpa akun: tugasnya sah, tapi tidak ada yang bisa diberi tahu.
  a := ops_hr.assign_task('B-2153','Rakit rangka', ops_core.office_day() + 2);
  assert a ->> 'outcome' = 'ok', a::text;
  insert into k values ('karjo_task', a -> 'data' ->> 'task_no');

  -- Pemberi tugas tidak melihat lonceng orang lain, dan tidak diberi tahu
  -- tentang tugas yang ia berikan sendiri.
  assert ops_core.unread_notifications() = 0, 'pemberi tugas diberi tahu tugasnya sendiri';
  assert (select count(*) from ops_core.notifications) = 0, 'RLS: lonceng orang lain terbaca';
end $$;

reset role;
do $$
declare t_sari text := (select val from k where key = 'sari_task');
        t_karjo text := (select val from k where key = 'karjo_task');
        v_ev ops_core.outbox%rowtype;
begin
  select * into v_ev from ops_core.outbox
   where event_type = 'hr.task.assigned' and entity_no = t_sari;
  assert v_ev.id is not null, 'event hr.task.assigned tidak ada';
  assert v_ev.payload ->> 'to' = 'sari215@talaliving.com', v_ev.payload::text;
  assert v_ev.payload ->> 'assigned_by' = 'Dewi HRD', v_ev.payload::text;
  assert v_ev.payload ->> 'deliverable' = 'PDF gambar kerja di folder DRAFTING', v_ev.payload::text;
  assert v_ev.payload ->> 'link' = '/profil?tab=tugas', v_ev.payload::text;
  assert (v_ev.payload ->> 'moved')::boolean = false, v_ev.payload::text;

  assert not exists (select 1 from ops_core.outbox where entity_no = t_karjo),
    'tugas karyawan tanpa akun menghasilkan event';
  assert not exists (select 1 from ops_core.notifications where entity_no = t_karjo),
    'tugas karyawan tanpa akun menghasilkan notifikasi';

  assert exists (select 1 from ops_core.delivery_rules
                  where event_type = 'hr.task.assigned' and is_live), 'hr.task.assigned tidak hidup';
  assert exists (select 1 from ops_core.delivery_rules
                  where event_type = 'hr.task.delivered' and is_live), 'hr.task.delivered tidak hidup';
end $$;

/* ── Sari membaca loncengnya ───────────────────────────────────────────── */
set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000021504';
do $$
declare n int; v_id bigint;
        t_sari text := (select val from k where key = 'sari_task');
begin
  assert ops_core.unread_notifications() = 1, 'Sari tidak punya satu notifikasi belum dibaca';
  select id into v_id from ops_core.my_notifications() where entity_no = t_sari and kind = 'task.assigned';
  assert v_id is not null, 'notifikasi tugas baru tidak ada di lonceng Sari';
  assert (select title from ops_core.my_notifications() where id = v_id) like 'Tugas baru dari Dewi HRD:%';

  -- Id milik orang lain: bukan miliknya untuk ditandai.
  n := ops_core.mark_notifications_read(array[v_id + 100000]);
  assert n = 0, 'menandai id yang bukan miliknya';
  n := ops_core.mark_notifications_read(null);
  assert n = 1, format('tandai semua: %s', n);
  assert ops_core.unread_notifications() = 0;
  -- Kedua kalinya tidak menggeser waktu dibaca.
  assert ops_core.mark_notifications_read(null) = 0;

  -- Sari menutup tugasnya dengan catatan serah.
  perform ops_hr.update_task(t_sari, 'start');
  assert (ops_hr.update_task(t_sari, 'done', null, 'PDF di DRAFTING/kursi')) ->> 'outcome' = 'ok';
  -- Yang menutup tidak diberi tahu tentang penutupannya sendiri.
  assert ops_core.unread_notifications() = 0, 'yang menutup diberi tahu';
end $$;

reset role;
do $$
declare t_sari text := (select val from k where key = 'sari_task');
        v_to text[];
begin
  select array_agg(payload ->> 'to' order by payload ->> 'to') into v_to
    from ops_core.outbox where event_type = 'hr.task.delivered' and entity_no = t_sari;
  -- Dewi (admin, juga pemberi tugas — sekali saja) dan Ryan (write). Evin (read) tidak.
  assert v_to = array['hrd215@talaliving.com','tulis215@talaliving.com'], v_to::text;
  assert (select count(*) from ops_core.notifications
           where kind = 'task.delivered' and entity_no = t_sari) = 2;
  assert (select payload ->> 'delivered_note' from ops_core.outbox
           where event_type = 'hr.task.delivered' and entity_no = t_sari limit 1) = 'PDF di DRAFTING/kursi';
  assert (select (payload ->> 'by_assignee')::boolean from ops_core.outbox
           where event_type = 'hr.task.delivered' and entity_no = t_sari limit 1);
  assert (select (payload ->> 'late')::boolean from ops_core.outbox
           where event_type = 'hr.task.delivered' and entity_no = t_sari limit 1) = false;
end $$;

/* ── Ryan menugaskan dirinya sendiri, lalu memindahkannya ke Budi ─────── */
set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000021502';
do $$
declare a jsonb;
begin
  a := ops_hr.assign_task('B-2154','Rekap absensi', ops_core.office_day() + 3);
  assert a ->> 'outcome' = 'ok', a::text;
  insert into k values ('ryan_task', a -> 'data' ->> 'task_no');
  assert not exists (select 1 from ops_core.my_notifications() where entity_no = a -> 'data' ->> 'task_no'),
    'menugaskan diri sendiri memberi tahu diri sendiri';

  a := ops_hr.edit_task(a -> 'data' ->> 'task_no', ops_core.office_day() + 3, 'B-2152');
  assert a ->> 'outcome' = 'ok', a::text;
end $$;

reset role;
do $$
declare t_ryan text := (select val from k where key = 'ryan_task');
begin
  assert (select count(*) from ops_core.outbox where entity_no = t_ryan) = 1,
    'pindah tugas: harus tepat satu event, untuk Budi';
  assert (select payload ->> 'to' from ops_core.outbox where entity_no = t_ryan) = 'budi215@talaliving.com';
  assert (select (payload ->> 'moved')::boolean from ops_core.outbox where entity_no = t_ryan);
  assert (select count(*) from ops_core.notifications n
            join ops_core.users u on u.id = n.user_id
           where n.entity_no = t_ryan and u.email = 'budi215@talaliving.com') = 1;

  assert not has_function_privilege('anon', 'ops_core.my_notifications(int)', 'EXECUTE'), 'my_notifications terbuka untuk anon';
  assert not has_function_privilege('anon', 'ops_core.mark_notifications_read(bigint[])', 'EXECUTE'), 'mark_notifications_read terbuka untuk anon';
  assert not has_function_privilege('authenticated', 'ops_hr.task_delivery_recipients(uuid)', 'EXECUTE'), 'daftar penerima terbuka';
end $$;

rollback;
