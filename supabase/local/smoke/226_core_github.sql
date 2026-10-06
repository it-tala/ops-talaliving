-- 226_core_github.sql — tugas dan GitHub (D382).
--
-- Yang dibuktikan:
--   • IT memetakan login GitHub ke akun ops (huruf kecil, satu login satu akun,
--     login yang sudah dipakai ditolak dengan nama pemiliknya), selain IT ditolak;
--   • PR pemegang tugas dibuka → tugas tercatat mulai; kiriman ulang (delivery
--     yang sama) tidak mengubah apa pun;
--   • PR pemegang di-merge ke branch lain → tugas tetap terbuka; di-merge ke
--     branch default → tugas selesai, done_by = akun pemegang, catatan serah =
--     PR + judul + link, dan HRD diberi tahu lewat trigger 0215;
--   • kiriman `opened` yang datang terlambat tidak membatalkan merge;
--   • PR dari orang lain / login tak terpetakan → tugas tetap terbuka, PR
--     dicatat, HRD diberi tahu sekali saat PR pertama menyebut tugas dan sekali
--     saat di-merge;
--   • nomor tugas yang tidak ada dilaporkan, PR tanpa nomor tugas = noop;
--   • akun yang masuk (authenticated) tidak bisa memanggil seam webhook/papan;
--   • PR terbaca oleh siapa pun yang bisa membaca tugasnya, dan hanya itu;
--   • papan: tugas pemegang ber-login GitHub jatuh tempo sinkron sampai
--     dicatat tersinkron; gagal lima kali pada keadaan yang sama → berhenti
--     dicoba sampai tugasnya berubah.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-000000022601','hrd226@talaliving.com','{"full_name":"Dewi HRD"}'),
  ('ffffffff-0000-0000-0000-000000022602','it226@talaliving.com','{"full_name":"Iwan IT"}'),
  ('ffffffff-0000-0000-0000-000000022603','budi226@talaliving.com','{"full_name":"Budi"}'),
  ('ffffffff-0000-0000-0000-000000022604','sari226@talaliving.com','{"full_name":"Sari"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-000000022601','hrd','admin'),
  ('ffffffff-0000-0000-0000-000000022602','it','admin'),
  ('ffffffff-0000-0000-0000-000000022603','procurement','read'),
  ('ffffffff-0000-0000-0000-000000022604','procurement','read');

insert into ops_hr.employees
  (id, employee_no, full_name, position, unit, pay_basis, base_rate, allowance_rate,
   daily_hours, joined_on, user_id)
values ('aaaa2260-0000-0000-0000-000000000001','B-2261','Budi','IT','Kantor',
        'monthly', 4500000, 25000, 8, '2026-01-01','ffffffff-0000-0000-0000-000000022603'),
       ('aaaa2260-0000-0000-0000-000000000002','B-2262','Sari','Drafter','Kantor',
        'monthly', 4000000, 25000, 8, '2026-01-01','ffffffff-0000-0000-0000-000000022604');

create temp table k (key text primary key, val text) on commit drop;
grant all on k to authenticated, service_role;

set local role authenticated;

/* ── HRD memberi tiga tugas ───────────────────────────────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000022601';
do $$
declare a jsonb;
begin
  a := ops_hr.assign_task(p_assignee_no => 'B-2261', p_title => 'Halaman selisih stok',
                          p_due => ops_core.office_day() + 7, p_deliverable => 'Halaman di ops');
  assert a ->> 'outcome' = 'ok', a::text;
  insert into k values ('t1', a -> 'data' ->> 'task_no');
  a := ops_hr.assign_task(p_assignee_no => 'B-2261', p_title => 'Kolom warna di BOM',
                          p_due => ops_core.office_day() + 7);
  assert a ->> 'outcome' = 'ok', a::text;
  insert into k values ('t2', a -> 'data' ->> 'task_no');
  a := ops_hr.assign_task(p_assignee_no => 'B-2262', p_title => 'Template gambar kursi',
                          p_due => ops_core.office_day() + 7);
  assert a ->> 'outcome' = 'ok', a::text;
  insert into k values ('t3', a -> 'data' ->> 'task_no');

  -- HRD bukan IT: tidak memetakan akun GitHub.
  a := ops_core.save_github_account('ffffffff-0000-0000-0000-000000022603', 'budi-dev');
  assert a -> 'error' ->> 'code' = 'not_permitted', a::text;
  assert ops_core.github_status() is null, 'github_status() is IT''s to read';
end $$;

/* ── IT memetakan akun ────────────────────────────────────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000022602';
do $$
declare a jsonb;
begin
  a := ops_core.save_github_account('ffffffff-0000-0000-0000-000000022603', 'https://github.com/budi');
  assert a -> 'error' ->> 'code' = 'bad_login', a::text;
  a := ops_core.save_github_account('ffffffff-0000-0000-0000-000000022603', '@Budi-Dev');
  assert a ->> 'outcome' = 'ok' and a -> 'data' ->> 'github_login' = 'budi-dev', a::text;
  a := ops_core.save_github_account('ffffffff-0000-0000-0000-000000022603', 'budi-dev');
  assert a ->> 'outcome' = 'noop', a::text;
  a := ops_core.save_github_account('ffffffff-0000-0000-0000-000000022604', 'BUDI-dev');
  assert a -> 'error' ->> 'code' = 'login_taken' and a -> 'error' ->> 'message' like '%Budi%', a::text;
  a := ops_core.save_github_account('ffffffff-0000-0000-0000-000000022604', 'sari-x');
  assert a ->> 'outcome' = 'ok', a::text;
  assert (select count(*) from ops_core.list_github_accounts()) >= 2;
  assert (ops_core.github_status() ->> 'accounts')::int >= 2;
end $$;

/* ── seorang yang masuk tidak bisa mengaku GitHub ─────────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000022603';
do $$
declare st text := '(no error)';
begin
  begin
    perform ops_hr.github_pull_request('d-x', 'closed', 'it-tala/ops', 1, 'https://github.com/it-tala/ops/pull/1',
      (select val from k where key = 't1'), null, 'budi-dev', false, true, 'main', 'main');
  exception when others then st := sqlstate;
  end;
  assert st = '42501', 'authenticated reached github_pull_request: ' || st;
  begin
    perform ops_hr.github_project_due(10);
  exception when others then st := sqlstate || '!';
  end;
  assert st = '42501!', 'authenticated reached github_project_due: ' || st;
end $$;

/* ── GitHub ───────────────────────────────────────────────────────────────
 *  The first call goes in as service_role, the key the route holds. The rest
 *  run as the owner so the block can read the tables to check them — the
 *  service role itself has no table privilege anywhere (A2 §5). */
reset role;
set local request.jwt.claim.sub = '';
do $$
declare
  a jsonb; t1 text; t2 text; t3 text; t ops_hr.tasks%rowtype; n int;
  hrd uuid := 'ffffffff-0000-0000-0000-000000022601';
begin
  select val into t1 from k where key = 't1';
  select val into t2 from k where key = 't2';
  select val into t3 from k where key = 't3';

  -- Pemegang membuka PR → mulai.
  set local role service_role;
  a := ops_hr.github_pull_request('d-1', 'opened', 'it-tala/ops-talaliving', 41,
         'https://github.com/it-tala/ops-talaliving/pull/41', 'Halaman selisih stok',
         'Tugas: ' || upper(t1) || E'\n\nSelesai.', 'Budi-Dev', true, false, 'main', 'main');
  reset role;
  assert a ->> 'outcome' = 'ok' and a -> 'data' -> 'tasks' -> 0 ->> 'did' = 'started', a::text;
  select * into t from ops_hr.tasks where task_no = t1;
  assert t.status = 'OPEN' and t.started_at is not null, 'opened did not start the task';

  -- Kiriman ulang.
  a := ops_hr.github_pull_request('d-1', 'opened', 'it-tala/ops-talaliving', 41,
         'https://github.com/it-tala/ops-talaliving/pull/41', 'x', t1, 'budi-dev', false, false, 'main', 'main');
  assert a ->> 'outcome' = 'noop' and (a -> 'data' ->> 'replay')::boolean, a::text;

  -- Merge ke branch lain → tetap terbuka.
  a := ops_hr.github_pull_request('d-2', 'closed', 'it-tala/ops-talaliving', 41,
         'https://github.com/it-tala/ops-talaliving/pull/41', 'Halaman selisih stok', t1,
         'budi-dev', false, true, 'staging', 'main');
  assert a -> 'data' -> 'tasks' -> 0 ->> 'did' = 'merged_not_default', a::text;
  assert (select status from ops_hr.tasks where task_no = t1) = 'OPEN';

  -- Merge ke branch default → selesai dan diserahkan.
  select count(*) into n from ops_core.notifications where user_id = hrd and kind = 'task.delivered';
  assert n = 0;
  a := ops_hr.github_pull_request('d-3', 'closed', 'it-tala/ops-talaliving', 41,
         'https://github.com/it-tala/ops-talaliving/pull/41', 'Halaman selisih stok', t1,
         'budi-dev', false, true, 'main', 'main');
  assert a -> 'data' -> 'tasks' -> 0 ->> 'did' = 'delivered', a::text;
  select * into t from ops_hr.tasks where task_no = t1;
  assert t.status = 'DONE' and t.done_by = 'ffffffff-0000-0000-0000-000000022603'
     and t.delivered_note like 'PR it-tala/ops-talaliving#41 Halaman selisih stok — https://github.com/%',
     row_to_json(t)::text;
  select count(*) into n from ops_core.notifications where user_id = hrd and kind = 'task.delivered'
     and entity_no = t1;
  assert n = 1, 'HRD was not told about the PR hand-over (0215): ' || n;
  assert exists (select 1 from ops_hr.task_pull_requests
                  where pr_number = 41 and state = 'merged' and effect = 'delivered' and by_assignee);

  -- `opened` yang terlambat tidak membatalkan merge.
  a := ops_hr.github_pull_request('d-4', 'reopened', 'it-tala/ops-talaliving', 41,
         'https://github.com/it-tala/ops-talaliving/pull/41', 'Halaman selisih stok', t1,
         'budi-dev', false, false, 'main', 'main');
  assert (select state from ops_hr.task_pull_requests where pr_number = 41) = 'merged';
  assert (select status from ops_hr.tasks where task_no = t1) = 'DONE';

  -- Orang lain (terpetakan) menyebut tugas Budi → tetap terbuka, HRD diberi tahu sekali.
  a := ops_hr.github_pull_request('d-5', 'opened', 'it-tala/ops-talaliving', 42,
         'https://github.com/it-tala/ops-talaliving/pull/42', 'Warna BOM ' || t2, null,
         'sari-x', false, false, 'main', 'main');
  assert a -> 'data' -> 'tasks' -> 0 ->> 'did' = 'held_not_holder', a::text;
  a := ops_hr.github_pull_request('d-6', 'edited', 'it-tala/ops-talaliving', 42,
         'https://github.com/it-tala/ops-talaliving/pull/42', 'Warna BOM ' || t2, 'lagi', 'sari-x',
         false, false, 'main', 'main');
  select count(*) into n from ops_core.notifications where user_id = hrd and kind = 'task.github_pr';
  assert n = 1, 'HRD should be told once when the PR first names the task: ' || n;
  a := ops_hr.github_pull_request('d-7', 'closed', 'it-tala/ops-talaliving', 42,
         'https://github.com/it-tala/ops-talaliving/pull/42', 'Warna BOM ' || t2, null, 'sari-x',
         false, true, 'main', 'main');
  select * into t from ops_hr.tasks where task_no = t2;
  assert t.status = 'OPEN' and t.started_at is null, 'somebody else''s PR moved the task';
  select count(*) into n from ops_core.notifications where user_id = hrd and kind = 'task.github_pr';
  assert n = 2, 'HRD should be told again when it merges: ' || n;
  assert (select data ->> 'reason' from ops_core.notifications
           where user_id = hrd and kind = 'task.github_pr' order by id desc limit 1) = 'not_holder';

  -- Login tak terpetakan, nomor tak dikenal, dan tanpa nomor.
  a := ops_hr.github_pull_request('d-8', 'opened', 'it-tala/ops-talaliving', 43,
         'https://github.com/it-tala/ops-talaliving/pull/43', 'Template',
         t3 || ' dan tgs-99-01-01_99', 'stranger', false, false, 'main', 'main');
  assert a -> 'data' -> 'tasks' -> 0 ->> 'did' = 'held_unmapped'
     and a -> 'data' -> 'unknown' ->> 0 = 'tgs-99-01-01_99', a::text;
  assert (select data ->> 'reason' from ops_core.notifications
           where user_id = hrd and kind = 'task.github_pr' order by id desc limit 1) = 'unmapped';
  a := ops_hr.github_pull_request('d-9', 'opened', 'it-tala/ops-talaliving', 44,
         'https://github.com/it-tala/ops-talaliving/pull/44', 'Rapikan lint', null, 'budi-dev',
         false, false, 'main', 'main');
  assert a ->> 'outcome' = 'noop', a::text;
  a := ops_hr.github_pull_request('d-10', 'labeled', 'it-tala/ops-talaliving', 44,
         'https://github.com/it-tala/ops-talaliving/pull/44', 'x', t2, 'budi-dev',
         false, false, 'main', 'main');
  assert a ->> 'outcome' = 'noop', a::text;

  /* ── papan ── */
  assert exists (select 1 from ops_hr.github_project_due(50) d where d.task_no = t1 and d.github_login = 'budi-dev');
  assert exists (select 1 from ops_hr.github_project_due(50) d where d.task_no = t2);
  assert exists (select 1 from ops_hr.github_project_due(50) d where d.task_no = t3 and d.github_login = 'sari-x');

  perform ops_hr.github_project_synced(t1, 'PVTI_1', 'DI_1', false,
            (select d.fingerprint from ops_hr.github_project_due(50) d where d.task_no = t1));
  assert not exists (select 1 from ops_hr.github_project_due(50) d where d.task_no = t1),
    'a synced task is still due';

  for i in 1..5 loop
    perform ops_hr.github_project_synced(t2, null, null, false,
              (select d.fingerprint from ops_hr.github_project_due(50) d where d.task_no = t2),
              'boom');
  end loop;
  assert not exists (select 1 from ops_hr.github_project_due(50) d where d.task_no = t2),
    'five failures on the same state should stop the retries';
  update ops_hr.tasks set due_date = due_date + 1 where task_no = t2;
  assert exists (select 1 from ops_hr.github_project_due(50) d where d.task_no = t2),
    'a changed task is due again after failures';
end $$;

/* ── siapa membaca PR ─────────────────────────────────────────────────── */
set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000022603';
do $$
begin
  assert (select count(*) from ops_hr.task_pull_requests) = 2,
    'Budi reads the PRs on his own two tasks';
  assert (select count(*) from ops_hr.list_task_pull_requests(null)) = 2
     and (select count(*) from ops_hr.list_task_pull_requests(array[(select val from k where key = 't1')])) = 1;
end $$;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000022604';
do $$
begin
  assert (select count(*) from ops_hr.task_pull_requests) = 1
     and (select author_login from ops_hr.task_pull_requests) = 'stranger',
    'Sari reads only the PR on her own task, not hers on Budi''s';
  assert (select count(*) from ops_core.github_accounts) = 1, 'a person reads their own GitHub line only';
end $$;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000022602';
do $$
declare s jsonb := ops_core.github_status();
begin
  assert (s ->> 'linked_prs')::int >= 3 and jsonb_array_length(s -> 'deliveries') >= 10
     and jsonb_array_length(s -> 'sync_errors') = 1, s::text;
end $$;

rollback;
