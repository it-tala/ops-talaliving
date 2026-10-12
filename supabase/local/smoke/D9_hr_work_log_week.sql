-- D9_hr_work_log_week.sql — laporan harian seperti lembar kerja (0267, D427).
--
-- Yang dibuktikan:
--   • item jangka panjang milik orangnya sendiri: dibuat, dipilih untuk
--     catatan, ditutup; orang lain tidak bisa memakainya atau membacanya;
--   • catatan item bukan dadakan dan tidak butuh *diminta oleh*; satu per
--     item per hari; tugas dan item tidak bisa sekaligus;
--   • catatan boleh untuk hari lain — mundur dan ke depan — dalam jendela
--     `hr.work_log_window_days`, dan boleh diubah serta dihapus;
--   • hari dihitung *terisi* hanya bila catatannya ditulis atau disentuh
--     pada hari itu atau sesudahnya; rencana yang tidak pernah disentuh lagi
--     tidak dihitung;
--   • bukti PA menghitung catatan yang ditulis belakangan dan yang ditulis
--     di muka;
--   • ringkasan minggu: Senin saja, satu per baris, dikosongkan = null;
--   • `work_week()` memberi tujuh hari dan ringkasannya; rekan ditolak.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-000000026701','hrd267@talaliving.com','{"full_name":"Pimpinan"}'),
  ('ffffffff-0000-0000-0000-000000026702','it267@talaliving.com','{"full_name":"Tika"}'),
  ('ffffffff-0000-0000-0000-000000026703','rio267@talaliving.com','{"full_name":"Rio"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-000000026701','hrd','admin'),
  ('ffffffff-0000-0000-0000-000000026701','payroll','admin'),
  ('ffffffff-0000-0000-0000-000000026702','procurement','read'),
  ('ffffffff-0000-0000-0000-000000026703','procurement','read');

insert into ops_hr.employees
  (id, employee_no, full_name, position, unit, pay_basis, base_rate, allowance_rate,
   daily_hours, joined_on, user_id)
values ('aaaa2670-0000-0000-0000-000000000001','B-2671','Tika','IT','Kantor',
        'monthly', 4500000, 25000, 8, '2026-01-01','ffffffff-0000-0000-0000-000000026702'),
       ('aaaa2670-0000-0000-0000-000000000002','B-2672','Rio','Drafter','Kantor',
        'monthly', 4000000, 25000, 8, '2026-01-01','ffffffff-0000-0000-0000-000000026703');

create temp table k (key text primary key, val text) on commit drop;
grant all on k to authenticated;

update ops_core.settings set value = to_jsonb((ops_core.office_day() - 40)::text)
 where key = 'kpi.daily_log_from';

set local role authenticated;

/* ── Tika: item, catatan untuk hari mana pun ───────────────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000026702';
do $$
declare a jsonb; v_item uuid; v_old uuid; v_ahead uuid; v_back uuid;
begin
  a := ops_hr.save_work_item(null, '  ');
  assert a -> 'error' ->> 'code' = 'title_required', a::text;
  a := ops_hr.save_work_item(null, 'Google Workspace');
  assert a ->> 'outcome' = 'ok', a::text;
  v_item := (a -> 'data' ->> 'item_id')::uuid;
  insert into k values ('item', v_item::text);
  a := ops_hr.save_work_item(null, 'google workspace');
  assert a -> 'error' ->> 'code' = 'title_taken', a::text;
  a := ops_hr.save_work_item(null, 'Sistem HRD lama');
  v_old := (a -> 'data' ->> 'item_id')::uuid;
  insert into k values ('old_item', v_old::text);
  a := ops_hr.save_work_item(v_old, null, 'kadaluarsa');
  assert a -> 'error' ->> 'code' = 'unknown_status', a::text;

  -- Item: bukan dadakan, tanpa *diminta oleh*.
  a := ops_hr.log_work('Atur ulang grup email', 'lanjut', p_item => v_item);
  assert a ->> 'outcome' = 'ok', a::text;
  a := ops_hr.log_work('Lagi', 'lanjut', p_item => v_item);
  assert a -> 'error' ->> 'code' = 'already_logged', a::text;
  a := ops_hr.log_work('Dua-duanya', 'lanjut', 'tgs-x', null, null, null, v_item);
  assert a -> 'error' ->> 'code' = 'task_or_item', a::text;

  -- Ke depan: rencana pribadi.
  a := ops_hr.log_work('Migrasi Drive bersama', 'lanjut', p_item => v_item,
                       p_work_date => ops_core.office_day() + 3);
  assert a ->> 'outcome' = 'ok', a::text;
  v_ahead := (a -> 'data' ->> 'entry_id')::uuid;
  insert into k values ('ahead', v_ahead::text);
  -- Mundur.
  a := ops_hr.log_work('Lupa diisi: backup laptop desain', 'selesai', null, 'Pak Evin',
                       p_work_date => ops_core.office_day() - 2);
  assert a ->> 'outcome' = 'ok', a::text;
  v_back := (a -> 'data' ->> 'entry_id')::uuid;
  -- Terlalu jauh.
  a := ops_hr.log_work('Salah tahun', 'lanjut', p_item => v_item,
                       p_work_date => ops_core.office_day() + 400);
  assert a -> 'error' ->> 'code' = 'date_out_of_range', a::text;

  -- Rencana dipindah satu hari, lalu dihapus dan ditulis ulang.
  a := ops_hr.log_work('Migrasi Drive bersama', 'lanjut', null, null, null, v_ahead, v_item,
                       ops_core.office_day() + 4);
  assert a ->> 'outcome' = 'ok', a::text;
  assert (select work_date from ops_hr.work_log where id = v_ahead) = ops_core.office_day() + 4,
    'tanggal rencana tidak pindah';
  a := ops_hr.remove_work_log(v_back);
  assert a ->> 'outcome' = 'ok', a::text;
  a := ops_hr.log_work('Lupa diisi: backup laptop desain', 'selesai', null, 'Pak Evin',
                       p_work_date => ops_core.office_day() - 2);
  assert a ->> 'outcome' = 'ok', a::text;

  -- Item ditutup hari ini: catatan sesudah hari tutup ditolak, sebelumnya boleh.
  a := ops_hr.save_work_item(v_old, null, 'dihentikan');
  assert a ->> 'outcome' = 'ok', a::text;
  assert (select closed_at is not null from ops_hr.work_items where id = v_old), 'item ditutup tanpa tanggal';
  a := ops_hr.log_work('Masih dikerjakan', 'lanjut', p_item => v_old,
                       p_work_date => ops_core.office_day() + 1);
  assert a -> 'error' ->> 'code' = 'item_closed', a::text;
  a := ops_hr.log_work('Penutupan sistem lama', 'selesai', p_item => v_old,
                       p_work_date => ops_core.office_day() - 1);
  assert a ->> 'outcome' = 'ok', a::text;

  -- Ringkasan minggu.
  a := ops_hr.save_work_week_note(date_trunc('week', ops_core.office_day())::date + 1, 'Bukan Senin');
  assert a -> 'error' ->> 'code' = 'not_monday', a::text;
  a := ops_hr.save_work_week_note(date_trunc('week', ops_core.office_day())::date,
                                  'Workspace dirapikan', v_item);
  assert a ->> 'outcome' = 'ok', a::text;
  a := ops_hr.save_work_week_note(date_trunc('week', ops_core.office_day())::date,
                                  'Workspace dirapikan, grup email selesai', v_item);
  assert a ->> 'outcome' = 'ok', a::text;
  a := ops_hr.save_work_week_note(date_trunc('week', ops_core.office_day())::date, 'Banyak dadakan');
  assert a ->> 'outcome' = 'ok', a::text;
  assert (select count(*) from ops_hr.work_week_notes
           where employee_id = 'aaaa2670-0000-0000-0000-000000000001') = 2, 'ringkasan tidak satu per baris';
  a := ops_hr.save_work_week_note(date_trunc('week', ops_core.office_day())::date, '  ');
  assert a ->> 'outcome' = 'ok', a::text;
  assert (select summary from ops_hr.work_week_notes
           where employee_id = 'aaaa2670-0000-0000-0000-000000000001' and item_id is null) is null,
    'ringkasan dikosongkan tidak menjadi null';
end $$;

/* ── tampilan dan bukti ─────────────────────────────────────────────────── */
do $$
declare v jsonb; r ops_hr.v_work_log%rowtype; n int;
begin
  select * into r from ops_hr.v_work_log where id = (select val from k where key = 'ahead')::uuid;
  assert r.kind = 'item' and r.item_title = 'Google Workspace' and r.editable, row_to_json(r)::text;
  assert r.written_on = ops_core.office_day() and r.requested_by is null, row_to_json(r)::text;

  v := ops_hr.work_evidence('B-2671', ops_core.office_day() - 7, ops_core.office_day() + 7);
  assert (v ->> 'entries')::int = 4, v::text;
  assert (v ->> 'item_entries')::int = 3 and (v ->> 'dadakan_entries')::int = 1, v::text;
  assert (v ->> 'written_later')::int = 2 and (v ->> 'written_ahead')::int = 1, v::text;
  assert (v -> 'items' -> 0 ->> 'title') = 'Google Workspace', v::text;

  v := ops_hr.work_week('B-2671', date_trunc('week', ops_core.office_day())::date);
  assert jsonb_array_length(v -> 'days') = 7 and (v ->> 'mine')::boolean, v::text;
  assert jsonb_array_length(v -> 'notes') = 1
     and v -> 'notes' -> 0 ->> 'summary' = 'Workspace dirapikan, grup email selesai', v::text;
  begin
    perform ops_hr.work_week('B-2671', date_trunc('week', ops_core.office_day())::date + 2);
    assert false, 'minggu yang bukan Senin diterima';
  exception when invalid_parameter_value then null;
  end;
end $$;

/* ── Rio: tidak bisa memakai atau membaca milik Tika ───────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000026703';
do $$
declare a jsonb; n int;
begin
  a := ops_hr.log_work('Pakai item orang', 'lanjut', p_item => (select val from k where key = 'item')::uuid);
  assert (a -> 'error' ->> 'status')::int = 404, a::text;
  a := ops_hr.save_work_item((select val from k where key = 'item')::uuid, 'Diambil alih');
  assert (a -> 'error' ->> 'status')::int = 404, a::text;
  a := ops_hr.save_work_week_note(date_trunc('week', ops_core.office_day())::date, 'x',
                                  (select val from k where key = 'item')::uuid);
  assert (a -> 'error' ->> 'status')::int = 404, a::text;
  a := ops_hr.remove_work_log((select val from k where key = 'ahead')::uuid);
  assert (a -> 'error' ->> 'status')::int = 404, a::text;
  select count(*) into n from ops_hr.v_work_items;
  assert n = 0, format('Rio membaca %s item orang lain', n);
  select count(*) into n from ops_hr.work_week_notes;
  assert n = 0, format('Rio membaca %s ringkasan orang lain', n);
  begin
    perform ops_hr.work_week('B-2671', date_trunc('week', ops_core.office_day())::date);
    assert false, 'rekan membaca minggu orang lain';
  exception when insufficient_privilege then null;
  end;
end $$;

/* ── HRD: membaca, tidak menulis ───────────────────────────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000026701';
do $$
declare a jsonb; n int; v jsonb;
begin
  a := ops_hr.save_work_item(null, 'Item HRD');
  assert a -> 'error' ->> 'code' = 'no_employee_link', a::text;
  select count(*) into n from ops_hr.v_work_items where employee_no = 'B-2671';
  assert n = 2, format('HRD membaca %s item Tika', n);
  select count(*) into n from ops_hr.v_work_log where employee_no = 'B-2671' and editable;
  assert n = 0, 'catatan orang lain terbaca bisa diubah oleh HRD';
  v := ops_hr.work_week('B-2671', date_trunc('week', ops_core.office_day())::date);
  assert not (v ->> 'mine')::boolean, v::text;
  a := ops_hr.promote_work_log((select val from k where key = 'ahead')::uuid, ops_core.office_day() + 5);
  assert a -> 'error' ->> 'code' = 'not_dadakan', a::text;
end $$;

/* ── terisi: rencana yang tidak disentuh lagi tidak dihitung ───────────── */
reset role;
do $$
declare d date; lc record;
begin
  select g::date into d
    from generate_series(ops_core.office_day() - 14, ops_core.office_day() - 3, interval '1 day') g
   where ops_hr.works_on('aaaa2670-0000-0000-0000-000000000001', g::date)
   order by g desc limit 1;
  insert into ops_hr.work_log (id, employee_id, work_date, item_id, summary, progress, created_by, created_at)
  values ('bbbb2670-0000-0000-0000-000000000001','aaaa2670-0000-0000-0000-000000000001', d,
          (select val from k where key = 'item')::uuid, 'Rencana lama', 'lanjut',
          'ffffffff-0000-0000-0000-000000026702', (d - 3)::timestamp at time zone 'Asia/Jakarta');
  select * into lc from ops_hr.daily_log_coverage('aaaa2670-0000-0000-0000-000000000001', d, d);
  assert lc.expected = 1 and lc.logged = 0, format('rencana dihitung terisi: %s/%s', lc.logged, lc.expected);

  update ops_hr.work_log set updated_at = now() where id = 'bbbb2670-0000-0000-0000-000000000001';
  select * into lc from ops_hr.daily_log_coverage('aaaa2670-0000-0000-0000-000000000001', d, d);
  assert lc.expected = 1 and lc.logged = 1, format('rencana yang dilaporkan tidak dihitung: %s/%s', lc.logged, lc.expected);
end $$;

/* ── tidak terbuka untuk anon ──────────────────────────────────────────── */
do $$
begin
  assert not has_function_privilege('anon', 'ops_hr.save_work_item(uuid,text,text)', 'EXECUTE'), 'save_work_item terbuka untuk anon';
  assert not has_function_privilege('anon', 'ops_hr.save_work_week_note(date,text,uuid,text)', 'EXECUTE'), 'save_work_week_note terbuka untuk anon';
  assert not has_function_privilege('anon', 'ops_hr.work_week(text,date)', 'EXECUTE'), 'work_week terbuka untuk anon';
end $$;

rollback;
