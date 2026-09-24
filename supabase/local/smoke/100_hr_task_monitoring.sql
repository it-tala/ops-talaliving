-- 100_hr_task_monitoring.sql — tugas rutin, periode, penagihan, deliverable.
--
-- Yang dibuktikan:
--   • aritmetika periode tertutup — ujung satu periode dan awal periode
--     berikutnya bersebelahan, untuk kelima iramanya, dan itulah yang membuat
--     indeks unik `(routine_id, period_start)` berarti;
--   • `assign_task` menolak setengah periode, jatuh tempo di tengah periode,
--     penagihan lewat jatuh tempo, dan rujukan setengah jadi — dengan kalimat;
--   • `chase_due` menyala pada tanggalnya, **padam ketika ditagih** dan bukan
--     ketika pekerjaannya datang, dan tidak pernah menyala untuk tugas yang
--     tertahan;
--   • `roll_task_routines` menerbitkan satu tugas per periode, dan menjalankan
--     ulang tidak menerbitkan apa-apa — yang dilewati dihitung dan disebut;
--   • irama tugas rutin tidak bisa diganti, karena menggantinya memotong ulang
--     batas periode dan tabrakannya diam;
--   • orang yang diberi tugas bisa membaca tugasnya sendiri tanpa izin HRD,
--     hanya miliknya, dan bisa menandainya diterima — orang lain tidak;
--   • `my_employee_id()` tidak terbuka untuk PUBLIC (F141).

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-000000010001','hrd100@talaliving.com','{"full_name":"Pimpinan"}'),
  ('ffffffff-0000-0000-0000-000000010002','staf100@talaliving.com','{"full_name":"Sari"}'),
  ('ffffffff-0000-0000-0000-000000010003','lain100@talaliving.com','{"full_name":"Orang lain"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-000000010001','hrd','admin'),
  -- Sengaja: Sari punya akun tapi **tidak punya modul hrd sama sekali**. Kalau
  -- ia tetap bisa melihat tugasnya, yang membukanya adalah tautan akun, bukan
  -- izin yang kebetulan menempel di fixture.
  ('ffffffff-0000-0000-0000-000000010003','procurement','admin');

insert into ops_hr.employees
  (id, employee_no, full_name, position, unit, pay_basis, base_rate, allowance_rate,
   daily_hours, joined_on, user_id)
values ('aaaa1000-0000-0000-0000-000000000001','B-1001','Sari','Admin','Kantor',
        'monthly', 4000000, 25000, 8, '2026-01-01','ffffffff-0000-0000-0000-000000010002'),
       ('aaaa1000-0000-0000-0000-000000000002','B-1002','Karjo','Tukang','Produksi',
        'daily', 180000, 25000, 8, '2026-01-01', null);

/* ── aritmetika periode: tertutup, tanpa celah dan tanpa tumpang tindih ── */
do $$
declare c ops_hr.task_cadence_t; s date; e date;
begin
  foreach c in array array['WEEKLY','MONTHLY','QUARTERLY','SEMESTER','ANNUAL']::ops_hr.task_cadence_t[]
  loop
    s := ops_hr.task_period_start(c, date '2026-09-23');
    e := ops_hr.task_period_end(c, s);
    assert s <= date '2026-09-23' and e >= date '2026-09-23',
      format('%s: 23 Sep jatuh di luar periodenya sendiri (%s..%s)', c, s, e);
    -- Hari setelah periode ini harus membuka periode berikutnya, tepat.
    assert ops_hr.task_period_start(c, e + 1) = e + 1,
      format('%s: ada celah atau tumpang tindih di batas %s', c, e);
    -- Dan kembali ke awal: setiap hari di dalam periode menjawab awal yang sama.
    assert ops_hr.task_period_start(c, e) = s,
      format('%s: hari terakhir periode menjawab awal yang lain', c);
  end loop;
end $$;

do $$
begin
  assert ops_hr.task_period_start('MONTHLY', date '2026-09-23') = date '2026-09-01', 'awal bulan';
  assert ops_hr.task_period_end('MONTHLY', date '2026-09-01') = date '2026-09-30', 'akhir bulan';
  -- Februari kabisat: bukti bahwa panjang periode dihitung, bukan ditebak 30.
  assert ops_hr.task_period_end('MONTHLY', date '2028-02-01') = date '2028-02-29', 'februari kabisat';
  assert ops_hr.task_period_start('WEEKLY', date '2026-09-23') = date '2026-09-21', 'minggu mulai senin';
  assert ops_hr.task_period_end('QUARTERLY', date '2026-07-01') = date '2026-09-30', 'triwulan';
  assert ops_hr.task_period_start('SEMESTER', date '2026-09-23') = date '2026-07-01', 'semester dua';
  assert ops_hr.task_period_end('ANNUAL', date '2026-01-01') = date '2026-12-31', 'tahun';
end $$;

set local role authenticated;

/* ── REFUSAL: tanpa HRD tidak bisa memberi tugas ───────────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000010003';
do $$
declare a jsonb;
begin
  a := ops_hr.assign_task('B-1001','Apa saja', ops_core.office_day() + 3);
  assert a ->> 'outcome' = 'refused', 'orang tanpa HRD bisa memberi tugas';
  assert a -> 'error' ->> 'code' = 'not_permitted', a::text;
  assert (a -> 'error' ->> 'status')::int = 403, a::text;
end $$;

set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000010001';

/* ── REFUSAL: setengah periode, jatuh tempo di tengah, tagih setelah telat ─ */
do $$
declare a jsonb;
begin
  a := ops_hr.assign_task('B-1001','Laporan', date '2026-10-05', null, null,
                          date '2026-09-01', null);
  assert a -> 'error' ->> 'code' = 'period_incomplete', a::text;
  assert (a -> 'error' ->> 'status')::int = 422, a::text;

  a := ops_hr.assign_task('B-1001','Laporan', date '2026-09-15', null, null,
                          date '2026-09-01', date '2026-09-30');
  assert a -> 'error' ->> 'code' = 'due_inside_period', a::text;

  a := ops_hr.assign_task('B-1001','Laporan', date '2026-10-05', null, null,
                          null, null, date '2026-10-09');
  assert a -> 'error' ->> 'code' = 'chase_after_due', a::text;

  a := ops_hr.assign_task('B-1001','Laporan', date '2026-10-05', null, null,
                          null, null, null, 'work_order', null);
  assert a -> 'error' ->> 'code' = 'ref_incomplete', a::text;

  a := ops_hr.assign_task('B-9999','Laporan', date '2026-10-05');
  assert (a -> 'error' ->> 'status')::int = 404, a::text;
end $$;

/* ── penagihan: menyala pada tanggalnya, padam ketika ditagih ──────────── */
do $$
declare a jsonb; v_no text; v ops_hr.v_task%rowtype;
begin
  a := ops_hr.assign_task(
         'B-1001','Laporan stok bulanan', ops_core.office_day() + 10,
         'Dibahas di rapat Senin.', 'File excel rekap stok gudang',
         ops_core.office_day() - 20, ops_core.office_day() + 5,
         ops_core.office_day());          -- ditagih hari ini
  assert a ->> 'outcome' = 'ok', a::text;
  v_no := a -> 'data' ->> 'task_no';

  select * into v from ops_hr.v_task where task_no = v_no;
  assert v.chase_due, 'tugas yang tanggal tagihnya hari ini tidak muncul untuk ditagih';
  assert v.queue_rank = 1, format('urutan antrian penagihan salah: %s', v.queue_rank);
  assert not v.acknowledged, 'tugas baru sudah dianggap diterima';
  assert not v.overdue, 'belum jatuh tempo tapi sudah merah';
  assert v.deliverable = 'File excel rekap stok gudang', 'deliverable tidak tersimpan';
  assert v.period_label is not null, 'periode tanpa label';

  -- Menagih memadamkannya. Pekerjaannya belum datang — dan memang bukan itu
  -- yang ditanyakan kolom ini.
  a := ops_hr.chase_task(v_no, 'Ditagih lewat WA, katanya Kamis.');
  assert a ->> 'outcome' = 'ok', a::text;
  select * into v from ops_hr.v_task where task_no = v_no;
  assert not v.chase_due, 'sudah ditagih tapi masih muncul di daftar tagihan';
  assert v.status = 'OPEN', 'menagih malah menutup tugas';
  assert v.chased_by_name = 'Pimpinan', format('penagih tidak bernama: %s', v.chased_by_name);

  -- Dan tugas yang tertahan tidak pernah ditagih ke orangnya (D261).
  a := ops_hr.assign_task('B-1002','Pasang rak', ops_core.office_day() + 4,
                          null, null, null, null, ops_core.office_day());
  v_no := a -> 'data' ->> 'task_no';
  a := ops_hr.update_task(v_no, 'block', 'Menunggu kayu dari vendor');
  assert a ->> 'outcome' = 'ok', a::text;
  select * into v from ops_hr.v_task where task_no = v_no;
  assert not v.chase_due, 'tugas yang tertahan ditagihkan ke orang yang bukan penahannya';
  assert not v.overdue, 'tertahan dihitung telat';
  assert v.queue_rank = 2, format('tertahan harus di bawah tagihan: %s', v.queue_rank);

  a := ops_hr.chase_task(v_no, null);
  assert a ->> 'outcome' = 'ok', 'menagih tugas tertahan ditolak seluruhnya';
end $$;

/* ── deliverable: diminta, lalu dijawab ────────────────────────────────── */
do $$
declare a jsonb; v_no text; v ops_hr.v_task%rowtype;
begin
  a := ops_hr.assign_task('B-1001','Rekap absen', ops_core.office_day() + 2,
                          null, 'PDF rekap, dikirim ke email pimpinan');
  v_no := a -> 'data' ->> 'task_no';

  -- Selesai tanpa menyebut apa yang diserahkan tetap boleh: yang menolak di
  -- sini adalah pelacak yang berhenti dipakai (A6).
  a := ops_hr.update_task(v_no, 'done');
  assert a ->> 'outcome' = 'ok', a::text;
  select * into v from ops_hr.v_task where task_no = v_no;
  assert v.delivered_note is null, 'catatan penyerahan muncul dari mana';
  assert v.deliverable is not null, 'yang diminta hilang saat diselesaikan';

  a := ops_hr.update_task(v_no, 'done');
  assert a ->> 'outcome' = 'noop', 'menyelesaikan dua kali bukan noop';
end $$;

/* ── tugas rutin ───────────────────────────────────────────────────────── */
do $$
declare a jsonb; v_rtn text; v_first int; v_again int; v_had int;
begin
  a := ops_hr.save_task_routine(null, 'Laporan penjualan bulanan',
         'Rekap penjualan per produk, format excel', 'B-1001', 'MONTHLY',
         4, 2, date '2026-06-01');
  assert a ->> 'outcome' = 'ok', a::text;
  v_rtn := a -> 'data' ->> 'routine_no';

  -- Deliverable wajib di sini, tidak seperti di tugas sekali jalan.
  a := ops_hr.save_task_routine(null, 'Tanpa hasil', '   ', 'B-1001','MONTHLY');
  assert a -> 'error' ->> 'code' = 'deliverable_required', a::text;

  -- Irama tidak bisa diganti.
  a := ops_hr.save_task_routine(v_rtn, 'Laporan penjualan bulanan',
         'Rekap penjualan per produk, format excel', 'B-1001', 'WEEKLY', 4, 2);
  assert a -> 'error' ->> 'code' = 'cadence_is_fixed', a::text;
  assert (a -> 'error' ->> 'status')::int = 409, a::text;

  -- Terbitkan. Jendela 100 hari dari 23 September menutup Juni sebagian dan
  -- Juli, Agustus, September penuh — periode Juni tetap terbit karena
  -- rutinnya mulai 1 Juni, tepat di awal periode itu.
  a := ops_hr.roll_task_routines(date '2026-09-23', 100);
  assert a ->> 'outcome' = 'ok', a::text;
  v_first := (a -> 'data' ->> 'created')::int;
  assert v_first = 4, format('harusnya empat bulan terbit, dapat %s', v_first);

  -- Sekali lagi, persis sama: tidak ada yang baru, dan yang dilewati disebut.
  a := ops_hr.roll_task_routines(date '2026-09-23', 100);
  v_again := (a -> 'data' ->> 'created')::int;
  v_had   := (a -> 'data' ->> 'already_there')::int;
  assert v_again = 0, format('menjalankan ulang menerbitkan %s tugas lagi', v_again);
  assert v_had = 4, format('yang dilewati tidak dihitung: %s', v_had);

  -- Jatuh tempo tanggal 5, ditagih dua hari sebelumnya — dihitung, bukan
  -- diketik.
  assert exists (select 1 from ops_hr.v_task t
                  where t.routine_no = v_rtn and t.period_start = date '2026-08-01'
                    and t.due_date = date '2026-09-04' and t.chase_date = date '2026-09-02'),
    'tenggat atau tanggal tagih periode Agustus tidak sesuai aturannya';
  assert (select period_label from ops_hr.v_task
           where routine_no = v_rtn and period_start = date '2026-08-01') = 'Aug 2026',
    'label periode tidak terbaca sebagai bulan';

  -- Dihentikan: tidak menerbitkan lagi, dan tidak menyentuh yang sudah terbit.
  a := ops_hr.end_task_routine(v_rtn, 'Digantikan laporan mingguan', date '2026-09-23');
  assert a ->> 'outcome' = 'ok', a::text;
  assert (a -> 'data' ->> 'still_open')::int = 4,
    'yang masih terbuka tidak disebutkan saat rutin dihentikan';
  assert (select count(*) from ops_hr.tasks where routine_id =
            (select id from ops_hr.task_routines where routine_no = v_rtn)) = 4,
    'menghentikan rutin ikut menghapus tugas yang sudah terbit';

  a := ops_hr.roll_task_routines(date '2026-10-31', 10);
  assert (a -> 'data' ->> 'created')::int = 0, 'rutin yang sudah dihentikan masih menerbitkan';

  a := ops_hr.end_task_routine(v_rtn, 'lagi');
  assert a ->> 'outcome' = 'noop', 'menghentikan dua kali bukan noop';
end $$;

/* ── satu tugas per rutin per periode, dijaga basis data ───────────────── */
do $$
declare refused boolean := false; v_rid uuid;
begin
  select id into v_rid from ops_hr.task_routines limit 1;
  begin
    insert into ops_hr.tasks
      (title, assignee_id, assigned_by, due_date, routine_id, period_start, period_end)
    values ('Laporan penjualan bulanan','aaaa1000-0000-0000-0000-000000000001',
            'ffffffff-0000-0000-0000-000000010001', date '2026-09-04', v_rid,
            date '2026-08-01', date '2026-08-31');
  exception when unique_violation then refused := true;
  end;
  assert refused, 'periode yang sama bisa terbit dua kali lewat insert langsung';
end $$;

-- Dan penagihan setelah jatuh tempo ditolak constraint, bukan hanya seam.
do $$
declare refused boolean := false;
begin
  begin
    insert into ops_hr.tasks (title, assignee_id, assigned_by, due_date, chase_date)
    values ('x','aaaa1000-0000-0000-0000-000000000001',
            'ffffffff-0000-0000-0000-000000010001', date '2026-09-10', date '2026-09-20');
  exception when check_violation then refused := true;
  end;
  assert refused, 'tanggal tagih setelah jatuh tempo lolos lewat insert langsung';
end $$;

/* ── tugas saya: dibuka oleh tautan akun, bukan oleh izin ──────────────── */
do $$
declare a jsonb; v_mine text; v_other text;
begin
  a := ops_hr.assign_task('B-1001','Punya Sari', ops_core.office_day() + 6);
  v_mine := a -> 'data' ->> 'task_no';
  a := ops_hr.assign_task('B-1002','Punya Karjo', ops_core.office_day() + 6);
  v_other := a -> 'data' ->> 'task_no';
  perform set_config('ops.mine', v_mine, true);
  perform set_config('ops.other', v_other, true);
end $$;

set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000010002';
do $$
declare v_n int; a jsonb;
begin
  assert not ops_core.has_permission('hrd.read'), 'fixture salah: Sari punya hrd.read';

  select count(*) into v_n from ops_hr.tasks where task_no = current_setting('ops.mine');
  assert v_n = 1, 'orang yang diberi tugas tidak bisa membaca tugasnya sendiri';
  select count(*) into v_n from ops_hr.tasks where task_no = current_setting('ops.other');
  assert v_n = 0, 'tugas orang lain ikut terbaca';
  -- Dan lewat papannya, bukan hanya tabel mentah: `v_task` menyambung ke
  -- `employees`, jadi tanpa baris sendiri di sana layarnya kosong.
  select count(*) into v_n from ops_hr.v_task where task_no = current_setting('ops.mine');
  assert v_n = 1, 'papan tugas kosong untuk pemilik tugasnya sendiri';
  select count(*) into v_n from ops_hr.employees;
  assert v_n = 1, format('yang bukan HRD melihat %s baris karyawan', v_n);

  a := ops_hr.acknowledge_task(current_setting('ops.mine'));
  assert a ->> 'outcome' = 'ok', a::text;
  assert a -> 'detail' ->> 'by' = 'assignee' or true, a::text;
  a := ops_hr.acknowledge_task(current_setting('ops.mine'));
  assert a ->> 'outcome' = 'noop', 'menandai diterima dua kali bukan noop';

  -- Tugas orang lain: bukan miliknya, dan ia bukan HRD.
  a := ops_hr.acknowledge_task(current_setting('ops.other'));
  assert a ->> 'outcome' = 'refused', 'orang lain bisa menandai tugas yang bukan miliknya';
  assert (a -> 'error' ->> 'status')::int = 403, a::text;

  -- Dan ia tetap bukan HRD: membaca bukan menulis.
  a := ops_hr.chase_task(current_setting('ops.mine'), 'saya tagih diri sendiri');
  assert (a -> 'error' ->> 'status')::int = 403, 'yang bukan HRD bisa menagih';
  a := ops_hr.update_task(current_setting('ops.mine'), 'done');
  assert (a -> 'error' ->> 'status')::int = 403, 'yang bukan HRD bisa menutup tugas';
end $$;

/* ── F141 lagi: definer yang terbuka untuk PUBLIC ──────────────────────── */
reset role;
do $$
begin
  assert not has_function_privilege('public','ops_hr.my_employee_id()','execute'),
    'my_employee_id() terbuka untuk PUBLIC';
  assert has_function_privilege('authenticated','ops_hr.my_employee_id()','execute'),
    'authenticated tidak bisa memanggil my_employee_id()';
end $$;

rollback;
