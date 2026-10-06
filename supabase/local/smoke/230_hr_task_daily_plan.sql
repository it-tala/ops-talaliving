-- 230_hr_task_daily_plan.sql — rencana per hari, per tugas (D384).
--
-- Yang dibuktikan:
--   • pemegang tugas menulis target per hari, dari hari ini sampai jatuh tempo;
--     hari yang lewat dan hari sesudah jatuh tempo ditolak;
--   • orang lain tidak bisa menulis, dan tidak bisa membaca rencana orang lain;
--     HRD membaca;
--   • `task_plan` menampilkan setiap hari sampai jatuh tempo, dengan tanda hari
--     kerja; `my_plan` mengumpulkan target hari itu lintas tugas;
--   • mengosongkan satu hari menghapus targetnya tanpa DELETE; isi yang sama = noop;
--   • tugas yang sudah selesai tidak bisa direncanakan lagi.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-000000022901','hrd229@talaliving.com','{"full_name":"Dewi HRD"}'),
  ('ffffffff-0000-0000-0000-000000022902','sari229@talaliving.com','{"full_name":"Sari"}'),
  ('ffffffff-0000-0000-0000-000000022903','budi229@talaliving.com','{"full_name":"Budi"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-000000022901','hrd','admin'),
  ('ffffffff-0000-0000-0000-000000022902','procurement','read'),
  ('ffffffff-0000-0000-0000-000000022903','procurement','read');
insert into ops_hr.employees
  (id, employee_no, full_name, position, unit, pay_basis, base_rate, allowance_rate,
   daily_hours, joined_on, user_id)
values ('aaaa2290-0000-0000-0000-000000000001','B-2291','Sari','Drafter','Kantor',
        'monthly', 4000000, 25000, 8, '2026-01-01','ffffffff-0000-0000-0000-000000022902'),
       ('aaaa2290-0000-0000-0000-000000000002','B-2292','Budi','IT','Kantor',
        'monthly', 4500000, 25000, 8, '2026-01-01','ffffffff-0000-0000-0000-000000022903');

create temp table k (key text primary key, val text) on commit drop;
grant all on k to authenticated;

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000022901';
do $$
declare a jsonb;
begin
  a := ops_hr.assign_task('B-2291','Gambar kerja sofa ABC', ops_core.office_day() + 4,
                          p_deliverable => 'PDF di DRAFTING');
  insert into k values ('t', a -> 'data' ->> 'task_no');
  -- HRD tidak menulis rencana orang lain.
  a := ops_hr.save_task_plan(a -> 'data' ->> 'task_no', ops_core.office_day(), 'Apa saja');
  assert a -> 'error' ->> 'code' = 'not_yours', a::text;
end $$;

/* ── Sari merencanakan ─────────────────────────────────────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000022902';
do $$
declare a jsonb; t text := (select val from k where key = 't'); n int;
begin
  a := ops_hr.save_task_plan(t, ops_core.office_day(), 'Ukur ulang denah, sketsa tampak depan');
  assert a ->> 'outcome' = 'ok', a::text;
  a := ops_hr.save_task_plan(t, ops_core.office_day() + 1, 'Tampak samping dan detail rangka');
  assert a ->> 'outcome' = 'ok', a::text;
  a := ops_hr.save_task_plan(t, ops_core.office_day() + 1, 'Tampak samping dan detail rangka');
  assert a ->> 'outcome' = 'noop', a::text;

  a := ops_hr.save_task_plan(t, ops_core.office_day() - 1, 'Kemarin');
  assert a -> 'error' ->> 'code' = 'past_day', a::text;
  a := ops_hr.save_task_plan(t, ops_core.office_day() + 5, 'Sesudah tenggat');
  assert a -> 'error' ->> 'code' = 'after_due', a::text;
  a := ops_hr.save_task_plan(t, ops_core.office_day() + 2, repeat('x', 501));
  assert a -> 'error' ->> 'code' = 'target_too_long', a::text;

  -- Setiap hari sampai jatuh tempo, hari ini sampai +4 = 5 baris.
  select count(*) into n from ops_hr.task_plan(t);
  assert n = 5, format('task_plan memberi %s hari', n);
  assert (select editable from ops_hr.task_plan(t) where plan_date = ops_core.office_day());
  assert (select count(*) from ops_hr.task_plan(t) where target is not null) = 2;

  -- Hari ini lintas tugas.
  assert (select target from ops_hr.my_plan()) = 'Ukur ulang denah, sketsa tampak depan';

  -- Mengosongkan: hilang dari my_plan, baris tetap ada.
  a := ops_hr.save_task_plan(t, ops_core.office_day(), '   ');
  assert a ->> 'outcome' = 'ok', a::text;
  assert not exists (select 1 from ops_hr.my_plan());
  a := ops_hr.save_task_plan(t, ops_core.office_day(), 'Ukur ulang denah');
  assert a ->> 'outcome' = 'ok', a::text;
end $$;

/* ── Budi: tidak menulis dan tidak membaca rencana Sari ────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000022903';
do $$
declare a jsonb; t text := (select val from k where key = 't');
begin
  a := ops_hr.save_task_plan(t, ops_core.office_day(), 'Bukan tugas saya');
  assert a -> 'error' ->> 'code' = 'not_yours', a::text;
  begin
    perform ops_hr.task_plan(t);
    assert false, 'Budi membaca rencana Sari';
  exception when no_data_found then null;
  end;
end $$;

/* ── HRD membaca ───────────────────────────────────────────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000022901';
do $$
declare t text := (select val from k where key = 't');
begin
  assert (select count(*) from ops_hr.task_plan(t) where target is not null) = 2, 'HRD tidak melihat rencana';
  assert not (select editable from ops_hr.task_plan(t) where plan_date = ops_core.office_day()),
    'HRD diberi tanda bisa mengubah';
end $$;

/* ── tugas ditutup: rencana tidak diubah lagi ─────────────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000022902';
do $$
declare a jsonb; t text := (select val from k where key = 't');
begin
  a := ops_hr.update_task(t, 'done', null, 'PDF di DRAFTING/sofa-abc');
  assert a ->> 'outcome' = 'ok', a::text;
  a := ops_hr.save_task_plan(t, ops_core.office_day() + 1, 'Lagi');
  assert a -> 'error' ->> 'code' = 'task_closed', a::text;
  -- Yang selesai hanya menampilkan hari yang berisi target.
  assert (select count(*) from ops_hr.task_plan(t)) = 2;
end $$;

reset role;
do $$
begin
  assert not has_function_privilege('anon', 'ops_hr.save_task_plan(text,date,text)', 'EXECUTE');
  assert not has_function_privilege('anon', 'ops_hr.task_plan(text)', 'EXECUTE');
end $$;

rollback;
