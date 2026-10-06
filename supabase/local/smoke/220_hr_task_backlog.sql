-- 220_hr_task_backlog.sql — daftar tunggu (D381).
--
-- Yang dibuktikan:
--   • HRD menambah item → langsung masuk daftar, di urutan paling bawah;
--   • staf (punya data karyawan) hanya bisa mengusulkan → HRD diberi tahu;
--     usulan bisa diubah/ditarik oleh pengusulnya selama belum diterima;
--   • staf membaca daftar terbuka dan usulannya sendiri, bukan usulan orang lain;
--     akun tanpa data karyawan dan tanpa HRD tidak membaca apa-apa;
--   • terima → masuk paling bawah, pengusul diberi tahu; keluarkan wajib alasan,
--     pengusul diberi tahu alasannya;
--   • urutan dikirim utuh (order_stale bila tidak cocok, noop bila sama);
--   • Tugaskan: satu orang + jatuh tempo → tugas lewat assign_task, dengan
--     sasaran, yang harus diserahkan, dan notifikasi tugas baru (0215);
--     item jadi ASSIGNED dan tidak bisa ditugaskan dua kali;
--   • backlog_notify tidak bisa dipakai langsung untuk membunyikan lonceng orang.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-000000021601','hrd216@talaliving.com','{"full_name":"Dewi HRD"}'),
  ('ffffffff-0000-0000-0000-000000021602','sari216@talaliving.com','{"full_name":"Sari"}'),
  ('ffffffff-0000-0000-0000-000000021603','budi216@talaliving.com','{"full_name":"Budi"}'),
  ('ffffffff-0000-0000-0000-000000021604','lain216@talaliving.com','{"full_name":"Tanpa tautan"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-000000021601','hrd','admin'),
  ('ffffffff-0000-0000-0000-000000021602','procurement','read'),
  ('ffffffff-0000-0000-0000-000000021603','procurement','read'),
  ('ffffffff-0000-0000-0000-000000021604','procurement','read');

insert into ops_hr.employees
  (id, employee_no, full_name, position, unit, pay_basis, base_rate, allowance_rate,
   daily_hours, joined_on, user_id)
values ('aaaa2160-0000-0000-0000-000000000001','B-2161','Sari','Drafter','Kantor',
        'monthly', 4000000, 25000, 8, '2026-01-01','ffffffff-0000-0000-0000-000000021602'),
       ('aaaa2160-0000-0000-0000-000000000002','B-2162','Budi','IT','Kantor',
        'monthly', 4500000, 25000, 8, '2026-01-01','ffffffff-0000-0000-0000-000000021603');

create temp table k (key text primary key, val text) on commit drop;
grant all on k to authenticated;

set local role authenticated;

/* ── HRD menyusun daftar ───────────────────────────────────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000021601';
do $$
declare a jsonb;
begin
  a := ops_hr.save_goal(null, 'Sistem stok rapi', 'Stok di ops sama dengan rak', 'B-2162', ops_core.office_day() + 30);
  assert a ->> 'outcome' = 'ok', a::text;
  insert into k values ('goal', a -> 'data' ->> 'goal_no');

  a := ops_hr.save_backlog_item(null, '  ', null);
  assert a -> 'error' ->> 'code' = 'title_required', a::text;
  a := ops_hr.save_backlog_item(null, 'Laporan selisih stok otomatis', 'Halaman selisih stok di ops', null, 'IT', 'ssr-tidak-ada');
  assert a -> 'error' ->> 'code' = 'unknown_goal', a::text;

  a := ops_hr.save_backlog_item(null, 'Laporan selisih stok otomatis', 'Halaman selisih stok di ops',
                                'Bandingkan opname dengan saldo', 'IT', (select val from k where key = 'goal'));
  assert a ->> 'outcome' = 'ok' and a -> 'data' ->> 'status' = 'OPEN'
     and (a -> 'data' ->> 'position')::int = 1, a::text;
  insert into k values ('it1', a -> 'data' ->> 'item_no');

  a := ops_hr.save_backlog_item(null, 'Template gambar kursi standar', 'File template di DRAFTING', null, 'Drafting');
  assert a ->> 'outcome' = 'ok' and (a -> 'data' ->> 'position')::int = 2, a::text;
  insert into k values ('dr1', a -> 'data' ->> 'item_no');
end $$;

/* ── Sari mengusulkan ──────────────────────────────────────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000021602';
do $$
declare a jsonb; n int;
begin
  a := ops_hr.save_backlog_item(null, 'Kode warna kain di BOM', 'Kolom warna di BOM', null, 'IT');
  assert a ->> 'outcome' = 'ok' and a -> 'data' ->> 'status' = 'PROPOSED'
     and a -> 'data' ->> 'position' is null, a::text;
  insert into k values ('sari_prop', a -> 'data' ->> 'item_no');

  -- Usulan sendiri boleh diubah selama belum diterima; item HRD tidak.
  a := ops_hr.save_backlog_item(a -> 'data' ->> 'item_no', 'Kode warna kain di BOM dan PR', 'Kolom warna di BOM', null, 'IT');
  assert a ->> 'outcome' = 'ok', a::text;
  a := ops_hr.save_backlog_item((select val from k where key = 'it1'), 'Diubah staf', null);
  assert a ->> 'outcome' = 'refused' and a -> 'error' ->> 'code' = 'not_permitted', a::text;

  -- Membaca: daftar terbuka + usulan sendiri.
  select count(*) into n from ops_hr.list_backlog();
  assert n = 3, format('Sari melihat %s item, seharusnya 3', n);

  -- Staf tidak menugaskan dan tidak mengurutkan.
  a := ops_hr.assign_backlog_item((select val from k where key = 'it1'), 'B-2162', ops_core.office_day() + 3);
  assert a -> 'error' ->> 'code' = 'not_permitted', a::text;
  a := ops_hr.rank_backlog(array[(select val from k where key = 'dr1'), (select val from k where key = 'it1')]);
  assert a -> 'error' ->> 'code' = 'not_permitted', a::text;

  -- Lonceng orang lain tidak bisa dibunyikan langsung.
  begin
    perform ops_hr.backlog_notify('x', 'spam', '{}'::jsonb, 'x', 'ffffffff-0000-0000-0000-000000021603');
    assert false, 'backlog_notify bisa dipakai langsung oleh staf';
  exception when insufficient_privilege then null;
  end;
end $$;

/* ── Budi tidak melihat usulan Sari, lalu mengusulkan sendiri ─────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000021603';
do $$
declare a jsonb; n int;
begin
  select count(*) into n from ops_hr.list_backlog() where item_no = (select val from k where key = 'sari_prop');
  assert n = 0, 'Budi melihat usulan Sari';
  a := ops_hr.save_backlog_item(null, 'Ganti printer gudang', null);
  assert a -> 'data' ->> 'status' = 'PROPOSED', a::text;
  insert into k values ('budi_prop', a -> 'data' ->> 'item_no');
end $$;

/* ── akun tanpa data karyawan ──────────────────────────────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000021604';
do $$
declare a jsonb;
begin
  a := ops_hr.save_backlog_item(null, 'Apa saja', null);
  assert a -> 'error' ->> 'code' = 'not_permitted', a::text;
  begin
    perform ops_hr.list_backlog();
    assert false, 'akun tanpa data karyawan membaca daftar tunggu';
  exception when insufficient_privilege then null;
  end;
end $$;

/* ── HRD menjawab usulan, mengurutkan, menugaskan ─────────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000021601';
do $$
declare a jsonb;
        it1 text := (select val from k where key = 'it1');
        dr1 text := (select val from k where key = 'dr1');
        sp  text := (select val from k where key = 'sari_prop');
        bp  text := (select val from k where key = 'budi_prop');
begin
  -- HRD diberi tahu dua usulan.
  assert (select count(*) from ops_core.my_notifications() where kind = 'backlog.proposed') = 2;

  -- Usulan belum bisa ditugaskan.
  a := ops_hr.assign_backlog_item(sp, 'B-2162', ops_core.office_day() + 3);
  assert a -> 'error' ->> 'code' = 'not_open', a::text;

  a := ops_hr.accept_backlog_item(sp);
  assert a ->> 'outcome' = 'ok' and (a -> 'data' ->> 'position')::int = 3, a::text;
  a := ops_hr.accept_backlog_item(sp);
  assert a -> 'error' ->> 'code' = 'not_a_proposal', a::text;

  a := ops_hr.drop_backlog_item(bp);
  assert a -> 'error' ->> 'code' = 'reason_required', a::text;
  a := ops_hr.drop_backlog_item(bp, 'Sudah dianggarkan lewat PR aset bulan depan.');
  assert a ->> 'outcome' = 'ok', a::text;

  -- Urutan: utuh atau ditolak.
  a := ops_hr.rank_backlog(array[sp, it1]);
  assert a -> 'error' ->> 'code' = 'order_stale', a::text;
  a := ops_hr.rank_backlog(array[sp, it1, dr1]);
  assert a ->> 'outcome' = 'ok', a::text;
  a := ops_hr.rank_backlog(array[sp, it1, dr1]);
  assert a ->> 'outcome' = 'noop', a::text;
  assert (select array_agg(item_no order by "position") from ops_hr.list_backlog() where status = 'OPEN')
       = array[sp, it1, dr1];

  -- Tugaskan: satu orang dan jatuh tempo.
  a := ops_hr.assign_backlog_item(it1, 'B-2162', null);
  assert a -> 'error' ->> 'code' = 'due_required', a::text;
  a := ops_hr.assign_backlog_item(it1, 'B-2162', ops_core.office_day() + 7, ops_core.office_day() + 6);
  assert a ->> 'outcome' = 'ok', a::text;
  insert into k values ('it1_task', a -> 'data' ->> 'task_no');
  a := ops_hr.assign_backlog_item(it1, 'B-2161', ops_core.office_day() + 7);
  assert a -> 'error' ->> 'code' = 'not_open', a::text;
end $$;

reset role;
do $$
declare t ops_hr.tasks%rowtype;
        it1 text := (select val from k where key = 'it1');
begin
  select * into t from ops_hr.tasks where task_no = (select val from k where key = 'it1_task');
  assert t.assignee_id = 'aaaa2160-0000-0000-0000-000000000002', 'tugas bukan untuk Budi';
  assert t.deliverable = 'Halaman selisih stok di ops', coalesce(t.deliverable, '(kosong)');
  assert t.goal_id = (select id from ops_hr.goals where goal_no = (select val from k where key = 'goal'));
  assert t.detail like '%Dari daftar tunggu ' || it1 || '.%', t.detail;
  assert t.chase_date = ops_core.office_day() + 6;
  assert (select status from ops_hr.backlog where item_no = it1) = 'ASSIGNED';
  assert (select sort_key from ops_hr.backlog where item_no = it1) is null;

  -- Budi diberi tahu tugas barunya (0215), Sari tahu usulannya diterima,
  -- dan Budi tahu kenapa usulannya dikeluarkan.
  assert exists (select 1 from ops_core.notifications n join ops_core.users u on u.id = n.user_id
                  where u.email = 'budi216@talaliving.com' and n.kind = 'task.assigned' and n.entity_no = t.task_no);
  assert exists (select 1 from ops_core.notifications n join ops_core.users u on u.id = n.user_id
                  where u.email = 'sari216@talaliving.com' and n.kind = 'backlog.accepted');
  assert exists (select 1 from ops_core.notifications n join ops_core.users u on u.id = n.user_id
                  where u.email = 'budi216@talaliving.com' and n.kind = 'backlog.dropped'
                    and n.data ->> 'reason' like 'Sudah dianggarkan%');

  assert not has_function_privilege('anon', 'ops_hr.save_backlog_item(text,text,text,text,text,text)', 'EXECUTE');
  assert not has_function_privilege('anon', 'ops_hr.list_backlog(boolean)', 'EXECUTE');
end $$;

/* ── Sari menarik usulan berikutnya tanpa alasan ──────────────────────── */
set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000021602';
do $$
declare a jsonb; v_no text;
begin
  a := ops_hr.save_backlog_item(null, 'Usulan yang ditarik', null);
  v_no := a -> 'data' ->> 'item_no';
  a := ops_hr.drop_backlog_item(v_no);
  assert a ->> 'outcome' = 'ok', a::text;
  -- Item HRD tidak bisa dikeluarkan oleh staf.
  a := ops_hr.drop_backlog_item((select val from k where key = 'dr1'), 'tidak perlu');
  assert a -> 'error' ->> 'code' = 'not_permitted', a::text;
end $$;

rollback;
