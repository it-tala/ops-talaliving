-- 241_hr_goal_candidates.sql — kandidat sasaran dan sasaran dari daftar tunggu (D393).
--
-- Yang dibuktikan:
--   • HRD dan pimpinan (approve_funds) menulis kandidat; staf tidak;
--     kandidat wajib tanggal keputusan, tidak sesudah target, tidak di masa lalu;
--   • kandidat tidak ikut peringkat, tidak tampil di daftar sasaran berjalan,
--     dan tidak bisa diberi tugas — baik lewat assign_task maupun dari daftar tunggu;
--   • item daftar tunggu bisa ditempel ke kandidat atau sasaran (hanya yang terbuka);
--   • Jalankan menaruhnya di peringkat yang dipilih dan menggeser yang lain;
--     pemiliknya diberi tahu; bagian-bagiannya lalu bisa ditugaskan;
--   • Tidak jadi wajib alasan, menutup kandidat, dan mengeluarkan itemnya;
--   • pengingat hari keputusan hanya sekali per orang per kandidat.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-000000024101','hrd241@talaliving.com','{"full_name":"Dewi HRD"}'),
  ('ffffffff-0000-0000-0000-000000024102','boss241@talaliving.com','{"full_name":"Pak Evin"}'),
  ('ffffffff-0000-0000-0000-000000024103','sari241@talaliving.com','{"full_name":"Sari"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-000000024101','hrd','admin'),
  ('ffffffff-0000-0000-0000-000000024102','procurement','read'),
  ('ffffffff-0000-0000-0000-000000024103','procurement','read');
insert into ops_core.user_authorities (user_id, authority) values
  ('ffffffff-0000-0000-0000-000000024102','approve_funds');
insert into ops_hr.employees
  (id, employee_no, full_name, position, unit, pay_basis, base_rate, allowance_rate,
   daily_hours, joined_on, user_id)
values ('aaaa2410-0000-0000-0000-000000000001','B-2411','Sari','Drafter','Kantor',
        'monthly', 4000000, 25000, 8, '2026-01-01','ffffffff-0000-0000-0000-000000024103');

create temp table k (key text primary key, val text) on commit drop;
grant all on k to authenticated;

set local role authenticated;

/* ── HRD: dua sasaran berjalan dan satu kandidat ───────────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000024101';
do $$
declare a jsonb;
begin
  a := ops_hr.save_goal(null, 'Tutup buku September', 'Laporan diterima pimpinan', 'B-2411', ops_core.office_day() + 10);
  insert into k values ('g1', a -> 'data' ->> 'goal_no');
  a := ops_hr.save_goal(null, 'Hotel Sanur', 'Bahan lengkap di rak', 'B-2411', ops_core.office_day() + 20);
  insert into k values ('g2', a -> 'data' ->> 'goal_no');

  a := ops_hr.save_candidate_goal(null, 'Pameran Desember', 'Booth terpasang dan 3 sampel dipajang', 'B-2411',
                                  ops_core.office_day() + 80, null);
  assert a -> 'error' ->> 'code' = 'decide_by_required', a::text;
  a := ops_hr.save_candidate_goal(null, 'Pameran Desember', 'Booth terpasang', 'B-2411',
                                  ops_core.office_day() + 80, ops_core.office_day() + 90);
  assert a -> 'error' ->> 'code' = 'decide_after_target', a::text;
  a := ops_hr.save_candidate_goal(null, 'Pameran Desember', 'Booth terpasang', 'B-2411',
                                  ops_core.office_day() + 80, ops_core.office_day() - 1);
  assert a -> 'error' ->> 'code' = 'decide_in_past', a::text;

  a := ops_hr.save_candidate_goal(null, 'Pameran Desember', 'Booth terpasang dan 3 sampel dipajang', 'B-2411',
                                  ops_core.office_day() + 80, ops_core.office_day() + 40,
                                  ops_core.office_day() + 55);
  assert a ->> 'outcome' = 'ok' and a -> 'data' ->> 'status' = 'CANDIDATE', a::text;
  insert into k values ('c1', a -> 'data' ->> 'goal_no');
  assert (select extract(day from starts_month) from ops_hr.goals where goal_no = a -> 'data' ->> 'goal_no') = 1,
    'perkiraan bulan mulai tidak dibulatkan ke tanggal 1';
  assert (select rank from ops_hr.goals where goal_no = a -> 'data' ->> 'goal_no') is null, 'kandidat diberi peringkat';
  assert not exists (select 1 from ops_hr.list_goals() where goal_no = a -> 'data' ->> 'goal_no'),
    'kandidat tampil di sasaran berjalan';

  -- Item daftar tunggu: satu langsung ke kandidat, dua lagi ditempel kemudian.
  a := ops_hr.save_backlog_item(null, 'Desain booth', 'Gambar booth 3x3', null, 'Drafting', (select val from k where key = 'c1'));
  assert a ->> 'outcome' = 'ok', a::text;
  insert into k values ('b1', a -> 'data' ->> 'item_no');
  a := ops_hr.save_backlog_item(null, 'Sampel kursi pameran', null, null, 'Produksi');
  insert into k values ('b2', a -> 'data' ->> 'item_no');
  a := ops_hr.save_backlog_item(null, 'Brosur pameran', null, null, 'Marketing');
  insert into k values ('b3', a -> 'data' ->> 'item_no');

  a := ops_hr.attach_backlog_to_goal(array[(select val from k where key = 'b2'), 'blg-tidak-ada'], (select val from k where key = 'c1'));
  assert a -> 'error' ->> 'code' = 'not_waiting', a::text;
  a := ops_hr.attach_backlog_to_goal(array[(select val from k where key = 'b2'), (select val from k where key = 'b3')],
                                     (select val from k where key = 'c1'));
  assert a ->> 'outcome' = 'ok' and (a -> 'data' ->> 'attached')::int = 2, a::text;
  assert (select items from ops_hr.list_candidate_goals() where goal_no = (select val from k where key = 'c1')) = 3;

  -- Kandidat tidak bisa diberi tugas.
  a := ops_hr.assign_backlog_item((select val from k where key = 'b1'), 'B-2411', ops_core.office_day() + 5);
  assert a -> 'error' ->> 'code' = 'goal_is_candidate', a::text;
  a := ops_hr.assign_task('B-2411', 'Langsung ke kandidat', ops_core.office_day() + 5,
                          p_goal_no => (select val from k where key = 'c1'));
  assert a ->> 'outcome' <> 'ok', a::text;
end $$;

/* ── pimpinan: menulis kandidat kedua, lalu memutuskan ─────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000024102';
do $$
declare a jsonb;
begin
  a := ops_hr.save_candidate_goal(null, 'Showroom Ubud', 'Showroom buka', 'B-2411',
                                  ops_core.office_day() + 120, ops_core.office_day());
  assert a ->> 'outcome' = 'ok', a::text;
  insert into k values ('c2', a -> 'data' ->> 'goal_no');

  -- Jalankan c1 di peringkat #1: yang lain turun.
  a := ops_hr.decide_candidate_goal((select val from k where key = 'c1'), true, 1, 'Klien sudah konfirmasi');
  assert a ->> 'outcome' = 'ok' and (a -> 'data' ->> 'rank')::int = 1, a::text;
  a := ops_hr.decide_candidate_goal((select val from k where key = 'c1'), true, 1);
  assert a -> 'error' ->> 'code' = 'not_a_candidate', a::text;

  -- Tidak jadi tanpa alasan: ditolak.
  a := ops_hr.decide_candidate_goal((select val from k where key = 'c2'), false);
  assert a -> 'error' ->> 'code' = 'reason_required', a::text;
end $$;

reset role;
do $$
begin
  assert (select array_agg(goal_no order by rank) from ops_hr.goals where status = 'OPEN'
            and goal_no in ((select val from k where key = 'c1'), (select val from k where key = 'g1'),
                            (select val from k where key = 'g2')))
       = array[(select val from k where key = 'c1'), (select val from k where key = 'g1'), (select val from k where key = 'g2')],
    'urutan setelah Jalankan salah';
  assert exists (select 1 from ops_core.notifications n join ops_core.users u on u.id = n.user_id
                  where u.email = 'sari241@talaliving.com' and n.kind = 'goal.run'), 'pemilik tidak diberi tahu';

  -- Pengingat hari keputusan (c2 diputuskan hari ini): HRD dan pimpinan, sekali.
  assert ops_hr.remind_candidate_goals() = 2, 'pengingat tidak sampai ke HRD dan pimpinan';
  assert ops_hr.remind_candidate_goals() = 0, 'pengingat terkirim dua kali';
end $$;

/* ── staf: tidak menulis dan tidak membaca kandidat ────────────────────── */
set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000024103';
do $$
declare a jsonb;
begin
  a := ops_hr.save_candidate_goal(null, 'Usulan staf', 'Hasil', 'B-2411', ops_core.office_day() + 30, ops_core.office_day() + 10);
  assert a -> 'error' ->> 'code' = 'not_permitted', a::text;
  begin
    perform ops_hr.list_candidate_goals();
    assert false, 'staf membaca kandidat';
  exception when insufficient_privilege then null;
  end;
end $$;

/* ── HRD: bagian kandidat yang dijalankan kini bisa ditugaskan; c2 tidak jadi ── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000024101';
do $$
declare a jsonb;
begin
  a := ops_hr.assign_backlog_item((select val from k where key = 'b1'), 'B-2411', ops_core.office_day() + 5);
  assert a ->> 'outcome' = 'ok', a::text;

  a := ops_hr.save_backlog_item(null, 'Survey lokasi Ubud', null, null, 'Proyek', (select val from k where key = 'c2'));
  insert into k values ('b4', a -> 'data' ->> 'item_no');
  a := ops_hr.decide_candidate_goal((select val from k where key = 'c2'), false, null, 'Anggaran dipakai untuk pameran');
  assert a ->> 'outcome' = 'ok' and (a -> 'data' ->> 'items_removed')::int = 1, a::text;
  assert not exists (select 1 from ops_hr.list_candidate_goals());
end $$;

reset role;
do $$
begin
  assert (select status from ops_hr.goals where goal_no = (select val from k where key = 'c2')) = 'CANCELLED';
  assert (select dropped_reason from ops_hr.backlog where item_no = (select val from k where key = 'b4'))
         like 'Kandidat % tidak jadi: Anggaran dipakai untuk pameran';
  assert not has_function_privilege('anon', 'ops_hr.save_candidate_goal(text,text,text,text,date,date,date,text)', 'EXECUTE');
  assert not has_function_privilege('anon', 'ops_hr.decide_candidate_goal(text,boolean,integer,text)', 'EXECUTE');
  assert not has_function_privilege('authenticated', 'ops_hr.remind_candidate_goals()', 'EXECUTE');
end $$;

rollback;
