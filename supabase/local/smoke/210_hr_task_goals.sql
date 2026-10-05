-- 210_hr_task_goals.sql — sasaran berperingkat, urutan kerja, staf menggerakkan tugasnya.
--
-- Yang dibuktikan:
--   • tanpa HRD tidak ada yang bisa menyusun, mengurutkan, atau menutup sasaran,
--     menggeser rencana tugas, membatalkan, atau membuka lagi tugas;
--   • sasaran baru masuk di urutan paling bawah; urutan diganti utuh, dan daftar
--     yang sudah basi ditolak (`order_stale`) alih-alih menimpa urutan orang lain;
--   • urutan kerja hanya di dalam satu sasaran, tidak ke dirinya sendiri, tidak
--     melingkar;
--   • staf melihat **semua bagian** sasaran yang ia ikuti — drafter melihat tugas
--     IT di sasaran yang sama — tetapi tidak sasaran lain, dan tidak membaca
--     baris tugas rekan lewat tabelnya (catatan penagihan HRD tetap tertutup);
--   • hitungan kemajuan sasaran sama untuk HRD dan untuk staf;
--   • staf bisa mulai, menyelesaikan (dengan catatan serah, hari ini), menahan
--     dan melanjutkan tugasnya sendiri — tidak tugas orang lain;
--   • jatuh tempo tidak bisa dipindah ke masa lalu; berganti orang menghapus
--     tanda terima; sasaran tidak bisa ditutup di atas bagian yang masih terbuka,
--     dan urutan sisanya dirapatkan.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-000000021001','hrd210@talaliving.com','{"full_name":"Pimpinan"}'),
  ('ffffffff-0000-0000-0000-000000021002','drafter210@talaliving.com','{"full_name":"Sari"}'),
  ('ffffffff-0000-0000-0000-000000021003','it210@talaliving.com','{"full_name":"Budi"}'),
  ('ffffffff-0000-0000-0000-000000021004','lain210@talaliving.com','{"full_name":"Dewi"}');
-- Sengaja: tiga staf tanpa modul hrd sama sekali. Yang membuka tugas dan
-- sasaran mereka adalah tautan akun, bukan izin yang menempel di fixture.
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-000000021001','hrd','admin'),
  ('ffffffff-0000-0000-0000-000000021004','procurement','admin');

insert into ops_hr.employees
  (id, employee_no, full_name, position, unit, pay_basis, base_rate, allowance_rate,
   daily_hours, joined_on, user_id)
values ('aaaa2100-0000-0000-0000-000000000001','B-2101','Sari','Drafter','Kantor',
        'monthly', 4000000, 25000, 8, '2026-01-01','ffffffff-0000-0000-0000-000000021002'),
       ('aaaa2100-0000-0000-0000-000000000002','B-2102','Budi','IT','Kantor',
        'monthly', 4500000, 25000, 8, '2026-01-01','ffffffff-0000-0000-0000-000000021003'),
       ('aaaa2100-0000-0000-0000-000000000003','B-2103','Dewi','Purchasing','Kantor',
        'monthly', 4200000, 25000, 8, '2026-01-01','ffffffff-0000-0000-0000-000000021004');

create temp table k (key text primary key, val text) on commit drop;
grant all on k to authenticated;

set local role authenticated;

/* ── REFUSAL: tanpa HRD tidak bisa menyusun sasaran ────────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000021004';
do $$
declare a jsonb;
begin
  a := ops_hr.save_goal(null, 'Apa saja', 'Hasil', 'B-2101', ops_core.office_day() + 10);
  assert a ->> 'outcome' = 'refused', 'orang tanpa HRD bisa menyusun sasaran';
  assert (a -> 'error' ->> 'status')::int = 403, a::text;
  a := ops_hr.rank_goals(array[]::text[]);
  assert a ->> 'outcome' = 'refused', 'orang tanpa HRD bisa mengurutkan sasaran';
end $$;

set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000021001';

/* ── sasaran: wajib hasil, masuk di bawah, urutan diganti utuh ─────────── */
do $$
declare a jsonb; g1 text; g2 text; g3 text; r int[];
begin
  a := ops_hr.save_goal(null, 'Sample sofa ABC', '  ', 'B-2101', ops_core.office_day() + 14);
  assert a -> 'error' ->> 'code' = 'outcome_required', a::text;
  a := ops_hr.save_goal(null, 'Sample sofa ABC', 'Lolos QC', 'B-9999', ops_core.office_day() + 14);
  assert (a -> 'error' ->> 'status')::int = 404, a::text;

  a := ops_hr.save_goal(null, 'Sample sofa ABC', 'Sample lolos QC dan siap kirim',
                        'B-2101', ops_core.office_day() + 14);
  assert a ->> 'outcome' = 'ok', a::text;
  g1 := a -> 'data' ->> 'goal_no';
  a := ops_hr.save_goal(null, 'Stock opname Oktober', 'Selisih stok tercatat',
                        'B-2103', ops_core.office_day() + 20);
  g2 := a -> 'data' ->> 'goal_no';
  a := ops_hr.save_goal(null, 'Website katalog', 'Katalog tayang', 'B-2102', ops_core.office_day() + 30);
  g3 := a -> 'data' ->> 'goal_no';
  assert (a -> 'data' ->> 'rank')::int = 3, format('sasaran baru tidak di bawah: %s', a);

  insert into k values ('g1', g1), ('g2', g2), ('g3', g3);

  -- Basi: satu sasaran tertinggal dari daftar. Ditolak, tidak diterapkan separuh.
  a := ops_hr.rank_goals(array[g3, g1]);
  assert a -> 'error' ->> 'code' = 'order_stale', a::text;
  assert (a -> 'error' ->> 'status')::int = 409, a::text;
  -- Pengulangan juga basi.
  a := ops_hr.rank_goals(array[g3, g1, g1]);
  assert a -> 'error' ->> 'code' = 'order_stale', a::text;

  -- Permutasi penuh: melewati keadaan antara yang kembar, dan itu boleh.
  a := ops_hr.rank_goals(array[g3, g1, g2]);
  assert a ->> 'outcome' = 'ok', a::text;
  select array_agg(rank order by goal_no) into r from ops_hr.goals where goal_no in (g1, g2, g3);
  assert (select rank from ops_hr.goals where goal_no = g3) = 1, 'urutan tidak tersimpan';
  assert (select rank from ops_hr.goals where goal_no = g1) = 2, 'urutan tidak tersimpan';

  a := ops_hr.rank_goals(array[g3, g1, g2]);
  assert a ->> 'outcome' = 'noop', a::text;
end $$;

/* ── tugas sebagai bagian: sasaran dan urutan kerja ────────────────────── */
do $$
declare a jsonb; g1 text := (select val from k where key = 'g1');
        g2 text := (select val from k where key = 'g2');
        t_draw text; t_bom text; t_pr text; t_other text;
begin
  a := ops_hr.assign_task('B-2101','Gambar kerja sofa ABC', ops_core.office_day() + 3,
         null, 'PDF gambar kerja di folder DRAFTING',
         p_goal_no => g1);
  assert a ->> 'outcome' = 'ok', a::text;
  t_draw := a -> 'data' ->> 'task_no';

  -- Urutan kerja tanpa sasaran tidak punya arti.
  a := ops_hr.assign_task('B-2102','Update BOM', ops_core.office_day() + 5,
         p_waits_on_no => t_draw);
  assert a -> 'error' ->> 'code' = 'waits_on_needs_goal', a::text;

  a := ops_hr.assign_task('B-2102','Update data BOM sofa ABC', ops_core.office_day() + 5,
         null, 'BOM lengkap di modul BOM',
         p_goal_no => g1, p_waits_on_no => t_draw);
  assert a ->> 'outcome' = 'ok', a::text;
  t_bom := a -> 'data' ->> 'task_no';

  a := ops_hr.assign_task('B-2103','PR bahan sofa ABC', ops_core.office_day() + 7,
         p_goal_no => g1, p_waits_on_no => t_bom, p_chase_date => ops_core.office_day() + 6);
  t_pr := a -> 'data' ->> 'task_no';

  -- Sasaran lain: Sari tidak ikut di dalamnya.
  a := ops_hr.assign_task('B-2103','Hitung rak A', ops_core.office_day() + 4, p_goal_no => g2);
  t_other := a -> 'data' ->> 'task_no';
  a := ops_hr.chase_task(t_other, 'Catatan HRD tentang Dewi');
  -- HRD menagih Budi; catatannya bukan untuk dibaca rekan.
  update ops_hr.tasks set chase_note = 'Rahasia HRD' where task_no = t_bom;

  -- Ke sasaran lain: ditolak.
  a := ops_hr.assign_task('B-2103','Salah tempat', ops_core.office_day() + 4,
         p_goal_no => g2, p_waits_on_no => t_draw);
  assert a -> 'error' ->> 'code' = 'waits_on_other_goal', a::text;

  -- Melingkar: gambar menunggu PR yang (lewat BOM) menunggu gambar.
  a := ops_hr.edit_task(t_draw, ops_core.office_day() + 3, 'B-2101', g1, t_pr);
  assert a -> 'error' ->> 'code' = 'waits_on_cycle', a::text;
  a := ops_hr.edit_task(t_draw, ops_core.office_day() + 3, 'B-2101', g1, t_draw);
  assert a -> 'error' ->> 'code' = 'waits_on_self', a::text;

  insert into k values ('draw', t_draw), ('bom', t_bom), ('pr', t_pr), ('other', t_other);
end $$;

/* ── staf: melihat seluruh sasarannya, dan hanya itu ───────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000021002';
do $$
declare n int; v ops_hr.v_task%rowtype; g record;
        g1 text := (select val from k where key = 'g1');
        g2 text := (select val from k where key = 'g2');
begin
  select count(*) into n from ops_hr.list_goals();
  assert n = 1, format('Sari melihat %s sasaran, harusnya hanya yang ia ikuti', n);
  select * into g from ops_hr.list_goals() where goal_no = g1;
  -- Kemajuan dihitung atas semua bagian, bukan hanya baris Sari.
  assert g.tasks_total = 3, format('sasaran tiga bagian terbaca %s bagian oleh staf', g.tasks_total);
  assert g.tasks_waiting = 2, format('bagian yang menunggu: %s', g.tasks_waiting);
  assert g.my_open = 1, format('tugas Sari sendiri: %s', g.my_open);
  assert not g.is_owner or g.is_owner, 'is_owner tidak terisi';

  select count(*) into n from ops_hr.goal_board(g1);
  assert n = 3, format('papan sasaran menampilkan %s bagian kepada staf', n);
  select count(*) into n from ops_hr.goal_board(g1) where assignee_no = 'B-2102';
  assert n = 1, 'drafter tidak melihat tugas IT di sasaran yang sama';
  select count(*) into n from ops_hr.goal_board(g2);
  assert n = 0, 'staf melihat papan sasaran yang tidak ia ikuti';

  -- Lewat tabel: tetap hanya miliknya. Catatan penagihan rekan tidak terbuka.
  select count(*) into n from ops_hr.tasks;
  assert n = 1, format('staf membaca %s baris tugas lewat tabel', n);
  select count(*) into n from ops_hr.tasks where chase_note is not null;
  assert n = 0, 'catatan penagihan HRD terbaca oleh rekan';
  select count(*) into n from ops_hr.goals;
  assert n = 1, format('staf membaca %s sasaran lewat tabel', n);

  select * into v from ops_hr.v_task where task_no = (select val from k where key = 'draw');
  assert v.goal_no = g1 and v.goal_rank = 2, format('tugas tidak tahu sasarannya: %s %s', v.goal_no, v.goal_rank);
  assert not v.waiting, 'gambar tidak menunggu apa-apa';
end $$;

-- Budi: tugasnya menunggu tugas Sari — nama dan nomornya tetap terbaca.
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000021003';
do $$
declare v ops_hr.v_task%rowtype;
begin
  select * into v from ops_hr.v_task where task_no = (select val from k where key = 'bom');
  assert v.waits_on_no = (select val from k where key = 'draw'),
    format('pendahulu hilang bagi pemegang tugas: %s', v.waits_on_no);
  assert v.waits_on_assignee = 'Sari', format('nama pendahulu: %s', v.waits_on_assignee);
  assert v.waiting, 'menunggu gambar yang belum selesai tidak terbaca sebagai menunggu';
end $$;

/* ── staf menggerakkan tugasnya sendiri ────────────────────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000021002';
do $$
declare a jsonb; t_draw text := (select val from k where key = 'draw');
        t_bom text := (select val from k where key = 'bom');
begin
  a := ops_hr.update_task(t_draw, 'start');
  assert a ->> 'outcome' = 'ok', a::text;
  a := ops_hr.update_task(t_draw, 'start');
  assert a ->> 'outcome' = 'noop', a::text;

  a := ops_hr.update_task(t_draw, 'block', 'Menunggu ukuran dari klien');
  assert a ->> 'outcome' = 'ok', a::text;
  a := ops_hr.update_task(t_draw, 'unblock');
  assert a ->> 'outcome' = 'ok', a::text;

  a := ops_hr.update_task(t_draw, 'cancel', 'Tidak jadi');
  assert a ->> 'outcome' = 'refused', 'staf membatalkan tugasnya sendiri';
  a := ops_hr.update_task(t_bom, 'start');
  assert a ->> 'outcome' = 'refused', 'staf menggerakkan tugas rekan';

  a := ops_hr.update_task(t_draw, 'done');
  assert a -> 'error' ->> 'code' = 'delivered_required', a::text;
  a := ops_hr.update_task(t_draw, 'done', null, 'PDF di DRAFTING/ABC', ops_core.office_day() - 3);
  assert a -> 'error' ->> 'code' = 'done_on_self', a::text;
  a := ops_hr.update_task(t_draw, 'done', null, 'PDF di DRAFTING/ABC');
  assert a ->> 'outcome' = 'ok', a::text;

  a := ops_hr.update_task(t_draw, 'reopen', 'Kurang tampak samping');
  assert a ->> 'outcome' = 'refused', 'staf membuka lagi tugasnya sendiri';
end $$;

set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000021003';
do $$
declare v ops_hr.v_task%rowtype;
begin
  select * into v from ops_hr.v_task where task_no = (select val from k where key = 'bom');
  assert not v.waiting, 'gambar sudah selesai tapi BOM masih menunggu';
end $$;

/* ── HRD: buka lagi, geser rencana, tutup sasaran ──────────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000021001';
do $$
declare a jsonb; v ops_hr.v_task%rowtype; g record;
        g1 text := (select val from k where key = 'g1');
        g2 text := (select val from k where key = 'g2');
        g3 text := (select val from k where key = 'g3');
        t_draw text := (select val from k where key = 'draw');
        t_bom text := (select val from k where key = 'bom');
        t_pr text := (select val from k where key = 'pr');
begin
  a := ops_hr.update_task(t_draw, 'reopen');
  assert a -> 'error' ->> 'code' = 'reason_required', a::text;
  a := ops_hr.update_task(t_draw, 'reopen', 'Kurang tampak samping');
  assert a ->> 'outcome' = 'ok', a::text;
  select * into v from ops_hr.v_task where task_no = t_draw;
  assert v.status = 'OPEN' and v.done_at is null, 'dibuka lagi tapi masih selesai';
  assert v.delivered_note is not null, 'catatan serah hilang saat dibuka lagi';

  -- Jatuh tempo ke masa lalu: ditolak.
  a := ops_hr.edit_task(t_bom, ops_core.office_day() - 1, 'B-2102', g1, t_draw);
  assert a -> 'error' ->> 'code' = 'due_in_past', a::text;

  -- Sama persis: tidak ada yang berubah.
  a := ops_hr.edit_task(t_pr, ops_core.office_day() + 7, 'B-2103', g1, t_bom, ops_core.office_day() + 6);
  assert a ->> 'outcome' = 'noop', a::text;

  -- Dipindah ke orang lain: tanda terima ikut terhapus.
  perform ops_hr.acknowledge_task(t_pr);
  a := ops_hr.edit_task(t_pr, ops_core.office_day() + 9, 'B-2102', g1, t_bom, ops_core.office_day() + 6);
  assert a ->> 'outcome' = 'ok', a::text;
  select * into v from ops_hr.v_task where task_no = t_pr;
  assert v.assignee_no = 'B-2102' and not v.acknowledged,
    'berganti orang tetapi masih tercatat diterima';

  -- Gambar masih ditunggu BOM: tidak bisa pindah sasaran.
  a := ops_hr.edit_task(t_draw, ops_core.office_day() + 3, 'B-2101', g2, null);
  assert a -> 'error' ->> 'code' = 'has_dependents', a::text;

  -- Ditutup di atas bagian yang masih terbuka: ditolak.
  a := ops_hr.close_goal(g1, 'done');
  assert a -> 'error' ->> 'code' = 'parts_still_open', a::text;
  a := ops_hr.close_goal(g1, 'cancel');
  assert a -> 'error' ->> 'code' = 'reason_required', a::text;

  perform ops_hr.update_task(t_draw, 'done', null, 'Revisi 1');
  perform ops_hr.update_task(t_bom, 'done');
  perform ops_hr.update_task(t_pr, 'done');
  a := ops_hr.close_goal(g1, 'done', 'Sample dikirim');
  assert a ->> 'outcome' = 'ok', a::text;

  -- Urutan yang tersisa dirapatkan: g3 tetap 1, g2 naik dari 3 ke 2.
  assert (select rank from ops_hr.goals where goal_no = g3) = 1, 'urutan teratas bergeser';
  assert (select rank from ops_hr.goals where goal_no = g2) = 2, 'urutan tidak dirapatkan';
  assert (select rank from ops_hr.goals where goal_no = g1) is null, 'sasaran tertutup masih berperingkat';

  -- Sasaran yang sudah ditutup tidak menerima bagian baru.
  a := ops_hr.assign_task('B-2101','Terlambat', ops_core.office_day() + 3, p_goal_no => g1);
  assert a -> 'error' ->> 'code' = 'goal_closed', a::text;

  select * into g from ops_hr.list_goals(true) where goal_no = g1;
  assert g.status = 'DONE' and g.tasks_done = 3, format('sasaran tertutup terbaca %s/%s', g.status, g.tasks_done);
  assert (select count(*) from ops_hr.list_goals()) = 2, 'daftar bawaan memuat sasaran yang sudah ditutup';
end $$;

/* ── grant: tidak ada definer baru yang terbuka untuk PUBLIC (F141) ────── */
reset role;
do $$
begin
  assert not has_function_privilege('public', 'ops_hr.goal_board(text)', 'EXECUTE'), 'goal_board terbuka untuk PUBLIC';
  assert not has_function_privilege('public', 'ops_hr.check_task_place(uuid,text,text,text,text)', 'EXECUTE'),
    'pembantu internal terbuka untuk PUBLIC';
  assert not has_function_privilege('authenticated', 'ops_hr.check_task_place(uuid,text,text,text,text)', 'EXECUTE'),
    'pembantu internal bisa dipanggil langsung';
end $$;

rollback;
