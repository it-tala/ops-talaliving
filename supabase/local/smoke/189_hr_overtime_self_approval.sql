-- 189_hr_overtime_self_approval.sql — lembur yang diajukan sendiri, dengan
-- deliverable, disetujui HRD atau pimpinan (D333, `0189`).
--
-- Yang dibuktikan:
--   • deliverable wajib saat mengajukan dan tersimpan di barisnya; hasil kerja
--     boleh menyusul lewat `add_overtime_result_self`, tapi persetujuan
--     menolak tanpa hasil;
--   • pengajuan yang belum diputuskan `waiting_hrd` dan tidak `payable` —
--     tidak lagi "dibayar kecuali dimatikan" seperti lembar HRD (D146);
--   • HRD menyetujui (decided_as = hrd); pimpinan dengan `approve_overtime`
--     menyetujui (decided_as = leader); akun tanpa keduanya ditolak;
--   • tidak ada yang menyetujui lemburnya sendiri — pimpinan maupun HRD;
--   • penolakan butuh kalimat, dan membebaskan malam itu untuk diajukan lagi;
--   • hanya jam yang disetujui masuk baris gaji; yang menunggu masuk
--     `overtime_pending_hours`, yang ditolak tidak ke mana-mana;
--   • `decide_overtime_sheet` (laci HRD lama) meneruskan pengajuan ke seam
--     yang sama, jadi tidak ada jalan kedua untuk memutuskannya;
--   • `self_overtime_queue()` terbaca HRD dan pimpinan dengan nama, dan
--     kosong untuk orang lain;
--   • jalur HRD sendiri (`add_overtime_line`) menerima deliverable dan tetap
--     `paid_default`.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-000000189001','hrd189@talaliving.com','{"full_name":"Wulan HRD"}'),
  ('ffffffff-0000-0000-0000-000000189002','evin189@talaliving.com','{"full_name":"Evin Pimpinan"}'),
  ('ffffffff-0000-0000-0000-000000189003','sari189@talaliving.com','{"full_name":"Sari"}'),
  ('ffffffff-0000-0000-0000-000000189004','andi189@talaliving.com','{"full_name":"Andi Procurement"}');

insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-000000189001','hrd','admin'),
  ('ffffffff-0000-0000-0000-000000189001','payroll','admin'),
  ('ffffffff-0000-0000-0000-000000189004','procurement','admin');
insert into ops_core.user_authorities (user_id, authority) values
  ('ffffffff-0000-0000-0000-000000189002','approve_overtime');

insert into ops_hr.pay_rule_sets (version, effective_from, note, rules, created_by) values
 (1, '2026-01-01', 'uji', '{
   "week_pattern":"5day","day_starts_minutes":480,
   "overtime_mode":"flat","flat_multiplier":1.5,
   "workday_tiers":[{"after_hours":0,"multiplier":1.5}],
   "restday_tiers":[{"after_hours":0,"multiplier":2}],
   "monthly_divisor":173,"hourly_basis":"company","effective_days_per_year":240,
   "hourly_includes_allowance":false,"overtime_rounding_minutes":0,
   "undertime_mode":"off","undertime_grace_minutes":15,
   "late_grace_minutes":0,"late_mode":"manual","late_forfeits_allowance":false,
   "schedules":[{"code":"KANTOR","name":"Kantor","start_minutes":480,"end_minutes":1020,
                 "break_minutes":60,"friday_break_minutes":90,"friday_end_minutes":1020,"note":null}],
   "schedule_by_unit":{"Kantor":"KANTOR"}
 }'::jsonb, 'ffffffff-0000-0000-0000-000000189001');

insert into ops_hr.employees
  (id, employee_no, full_name, position, unit, pay_basis, base_rate, allowance_rate,
   daily_hours, joined_on, user_id, paid_leave_days)
values
  ('aaaa1890-0000-0000-0000-000000000001','B-1891','Sari','Admin','Kantor',
   'monthly', 4500000, 25000, 8, '2026-01-01','ffffffff-0000-0000-0000-000000189003', 12),
  ('aaaa1890-0000-0000-0000-000000000002','B-1892','Evin','Direktur','Kantor',
   'monthly', 9000000, 0, 8, '2026-01-01','ffffffff-0000-0000-0000-000000189002', 12),
  ('aaaa1890-0000-0000-0000-000000000003','B-1893','Wulan','HRD','Kantor',
   'monthly', 5000000, 25000, 8, '2026-01-01','ffffffff-0000-0000-0000-000000189001', 12);

set local role authenticated;

/* ── Sari mengajukan empat malam ───────────────────────────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000189003';
do $$
declare a jsonb; v_n int; v_d text;
begin
  -- Tanpa deliverable: ditolak, bahkan dengan hasil kerja.
  a := ops_hr.report_overtime_self(p_work_date => '2026-03-02', p_hours => 2,
                                   p_result_note => 'Rekap stok selesai');
  assert a -> 'error' ->> 'code' = 'deliverable_required', a::text;
  a := ops_hr.report_overtime_self(p_work_date => '2026-03-02', p_hours => 2,
                                   p_deliverable => '   ');
  assert a -> 'error' ->> 'code' = 'deliverable_required', a::text;

  -- Hari ini boleh (deliverable sudah diketahui sebelum malamnya), besok tidak.
  a := ops_hr.report_overtime_self(p_work_date => ops_core.office_day() + 1, p_hours => 2,
                                   p_deliverable => 'x');
  assert a -> 'error' ->> 'code' = 'date_in_future', a::text;

  -- Senin: dengan hasil. Selasa: hasil menyusul. Rabu dan Kamis: dengan hasil.
  a := ops_hr.report_overtime_self(p_work_date => '2026-03-02', p_hours => 2,
         p_deliverable => 'Rekap stok gudang Maret', p_result_note => 'Rekap stok selesai, 412 SKU',
         p_key => 'ot189-senin');
  assert a ->> 'outcome' = 'ok', a::text;
  assert a -> 'data' ->> 'sheet_no' is not null, a::text;
  assert a -> 'data' ->> 'stage' = 'waiting_hrd', a::text;
  perform set_config('ot189.senin', a -> 'data' ->> 'sheet_no', true);

  a := ops_hr.report_overtime_self(p_work_date => '2026-03-03', p_hours => 3,
         p_deliverable => 'Laporan pajak masa Februari');
  assert a ->> 'outcome' = 'ok', a::text;
  perform set_config('ot189.selasa', a -> 'data' ->> 'sheet_no', true);

  a := ops_hr.report_overtime_self(p_work_date => '2026-03-04', p_hours => 1.5,
         p_deliverable => 'Arsip faktur', p_result_note => 'Faktur Januari tersusun');
  assert a ->> 'outcome' = 'ok', a::text;
  perform set_config('ot189.rabu', a -> 'data' ->> 'sheet_no', true);

  a := ops_hr.report_overtime_self(p_work_date => '2026-03-05', p_hours => 4,
         p_deliverable => 'Input absensi manual', p_result_note => 'Setengah selesai');
  assert a ->> 'outcome' = 'ok', a::text;
  perform set_config('ot189.kamis', a -> 'data' ->> 'sheet_no', true);

  -- Deliverable tersimpan, di baris milik Sari sendiri.
  select l.deliverable into v_d
    from ops_hr.overtime_lines l join ops_hr.overtime_sheets s on s.id = l.sheet_id
   where s.sheet_no = current_setting('ot189.senin');
  assert v_d = 'Rekap stok gudang Maret', 'deliverable tidak tersimpan: ' || coalesce(v_d,'(null)');
  select count(*) into v_n from ops_hr.overtime_sheets
   where sheet_no = current_setting('ot189.senin') and via = 'self';
  assert v_n = 1, 'pengajuan sendiri tidak ditandai via = self';

  -- Belum diputuskan = belum dibayar.
  select count(*) into v_n from ops_hr.v_overtime_claim
   where sheet_no in (current_setting('ot189.senin'), current_setting('ot189.selasa'))
     and not payable and stage = 'waiting_hrd';
  assert v_n = 2, 'pengajuan yang belum diputuskan terbaca payable atau bukan waiting_hrd';

  -- Sari tidak bisa memutuskan apa pun.
  a := ops_hr.decide_overtime_self(current_setting('ot189.senin'), true);
  assert a -> 'error' ->> 'code' = 'not_permitted', a::text;
  -- Antrian keputusan kosong untuknya.
  select count(*) into v_n from ops_hr.self_overtime_queue();
  assert v_n = 0, 'self_overtime_queue terbuka untuk karyawan biasa';
end $$;

/* ── orang tanpa HRD dan tanpa wewenang pimpinan ───────────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000189004';
do $$
declare a jsonb; v_n int;
begin
  a := ops_hr.decide_overtime_self(current_setting('ot189.senin'), true, null, null);
  assert a ->> 'outcome' = 'refused' and a -> 'error' ->> 'code' = 'not_permitted', a::text;
  a := ops_hr.decide_overtime_self(current_setting('ot189.senin'), true, null, 'leader');
  assert a -> 'error' ->> 'code' = 'not_permitted', a::text;
  a := ops_hr.decide_overtime_sheet(current_setting('ot189.senin'), 'hrd', true);
  assert a -> 'error' ->> 'code' = 'not_permitted', a::text;
  select count(*) into v_n from ops_hr.self_overtime_queue();
  assert v_n = 0, 'self_overtime_queue terbuka untuk procurement';
end $$;

/* ── HRD menyetujui Senin ──────────────────────────────────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000189001';
do $$
declare a jsonb; r record; v_n int;
begin
  -- HRD tidak punya wewenang pimpinan: memilih kapasitas itu ditolak.
  a := ops_hr.decide_overtime_self(current_setting('ot189.senin'), true, null, 'leader');
  assert a -> 'error' ->> 'code' = 'not_permitted', a::text;

  a := ops_hr.decide_overtime_self(current_setting('ot189.senin'), true, 'Sesuai laporan', null, 'd189-senin');
  assert a ->> 'outcome' = 'ok', a::text;
  assert a -> 'data' ->> 'decided_as' = 'hrd', a::text;
  assert a -> 'data' ->> 'stage' = 'approved', a::text;
  -- Diulang dengan kunci yang sama: jawaban yang sama, bukan konflik.
  a := ops_hr.decide_overtime_self(current_setting('ot189.senin'), true, 'Sesuai laporan', null, 'd189-senin');
  assert a ->> 'outcome' = 'duplicate' and a -> 'data' ->> 'decided_as' = 'hrd', 'replay: ' || a::text;
  -- Tanpa kunci: sudah diputuskan.
  a := ops_hr.decide_overtime_self(current_setting('ot189.senin'), false, 'berubah pikiran');
  assert a -> 'error' ->> 'code' = 'already_decided', a::text;

  select s.decided_by, s.decided_as, s.decision_note into r
    from ops_hr.overtime_sheets s where s.sheet_no = current_setting('ot189.senin');
  assert r.decided_by = 'ffffffff-0000-0000-0000-000000189001', 'decided_by bukan HRD';
  assert r.decided_as = 'hrd', 'decided_as: ' || coalesce(r.decided_as,'(null)');
  assert r.decision_note = 'Sesuai laporan', 'decision_note hilang';

  -- Selasa belum ada hasilnya: tidak bisa disetujui.
  a := ops_hr.decide_overtime_self(current_setting('ot189.selasa'), true);
  assert a -> 'error' ->> 'code' = 'result_required', a::text;

  -- Menolak tanpa alasan: ditolak.
  a := ops_hr.decide_overtime_self(current_setting('ot189.kamis'), false, '  ');
  assert a -> 'error' ->> 'code' = 'reason_required', a::text;
  -- Menolak Kamis, lewat laci lama: diteruskan ke seam yang sama.
  a := ops_hr.decide_overtime_sheet(current_setting('ot189.kamis'), 'hrd', false,
                                    'Input absensi bukan lembur — jam kerja biasa');
  assert a ->> 'outcome' = 'ok', a::text;
  assert a -> 'data' ->> 'stage' = 'declined', a::text;
  assert a -> 'data' ->> 'decided_as' = 'hrd', a::text;

  -- Antrian: HRD melihat keempatnya, dengan nama dan deliverable.
  select count(*) into v_n from ops_hr.self_overtime_queue() q
   where q.full_name = 'Sari' and q.deliverable is not null;
  assert v_n = 4, 'antrian HRD: ' || v_n;
end $$;

/* ── Sari menulis hasil Selasa, lalu pimpinan menyetujuinya ────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000189003';
do $$
declare a jsonb;
begin
  a := ops_hr.add_overtime_result_self(current_setting('ot189.selasa'), '  ');
  assert a -> 'error' ->> 'code' = 'result_required', a::text;
  a := ops_hr.add_overtime_result_self(current_setting('ot189.selasa'), 'SPT masa terkirim');
  assert a ->> 'outcome' = 'ok', a::text;
  -- Yang sudah diputuskan tidak bisa diberi hasil lagi.
  a := ops_hr.add_overtime_result_self(current_setting('ot189.senin'), 'tambahan');
  assert a -> 'error' ->> 'code' = 'already_decided', a::text;
  -- Kamis ditolak: malam itu bebas untuk diajukan lagi.
  a := ops_hr.report_overtime_self(p_work_date => '2026-03-05', p_hours => 1,
         p_deliverable => 'Koreksi slip gaji Februari');
  assert a ->> 'outcome' = 'ok', 'malam yang ditolak tidak bisa diajukan lagi: ' || a::text;
  perform set_config('ot189.kamis2', a -> 'data' ->> 'sheet_no', true);
end $$;

set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000189002';
do $$
declare a jsonb; r record; v_n int;
begin
  -- Pimpinan melihat antrian lewat seam definer — tanpa modul HRD.
  select count(*) into v_n from ops_hr.self_overtime_queue() q where q.full_name = 'Sari';
  assert v_n = 5, 'antrian pimpinan: ' || v_n;
  -- Tapi baris mentahnya tetap tertutup (RLS tidak dilebarkan).
  select count(*) into v_n from ops_hr.overtime_lines
   where employee_id = 'aaaa1890-0000-0000-0000-000000000001';
  assert v_n = 0, 'overtime_lines Sari terbaca pimpinan lewat RLS';

  -- Pimpinan tidak punya hrd.update: kapasitas HRD ditolak.
  a := ops_hr.decide_overtime_self(current_setting('ot189.selasa'), true, null, 'hrd');
  assert a -> 'error' ->> 'code' = 'not_permitted', a::text;

  a := ops_hr.decide_overtime_self(current_setting('ot189.selasa'), true, 'OK, penting');
  assert a ->> 'outcome' = 'ok', a::text;
  assert a -> 'data' ->> 'decided_as' = 'leader', a::text;

  -- Lewat laci lama, langkah pimpinan pada pengajuan staff: diteruskan, bukan
  -- `no_leader_needed`.
  a := ops_hr.decide_overtime_sheet(current_setting('ot189.rabu'), 'leader', true);
  assert a ->> 'outcome' = 'ok', a::text;
  assert a -> 'data' ->> 'decided_as' = 'leader', a::text;

  select q.decided_by_name, q.decided_as, q.stage::text as stage into r
    from ops_hr.self_overtime_queue() q where q.sheet_no = current_setting('ot189.selasa');
  assert r.decided_by_name = 'Evin Pimpinan' and r.decided_as = 'leader' and r.stage = 'approved',
    'keputusan pimpinan tidak tercatat dengan kapasitasnya';

  /* Lembur Evin sendiri: tidak bisa diputuskan Evin. */
  a := ops_hr.report_overtime_self(p_work_date => '2026-03-02', p_hours => 2,
         p_deliverable => 'Presentasi investor', p_result_note => 'Deck selesai');
  assert a ->> 'outcome' = 'ok', a::text;
  perform set_config('ot189.evin', a -> 'data' ->> 'sheet_no', true);
  a := ops_hr.decide_overtime_self(current_setting('ot189.evin'), true);
  assert a ->> 'outcome' = 'refused' and a -> 'error' ->> 'code' = 'own_overtime', a::text;
  a := ops_hr.decide_overtime_sheet(current_setting('ot189.evin'), 'leader', true);
  assert a -> 'error' ->> 'code' = 'own_overtime', a::text;
  select count(*) into v_n from ops_hr.self_overtime_queue() q
   where q.sheet_no = current_setting('ot189.evin') and q.mine;
  assert v_n = 1, 'antrian tidak menandai lembur milik pemanggil';
end $$;

/* ── HRD: lembur sendiri ditolak, lembur Evin boleh ────────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000189001';
do $$
declare a jsonb;
begin
  a := ops_hr.report_overtime_self(p_work_date => '2026-03-03', p_hours => 2,
         p_deliverable => 'Payroll Maret', p_result_note => 'Draft run siap');
  assert a ->> 'outcome' = 'ok', a::text;
  a := ops_hr.decide_overtime_self(a -> 'data' ->> 'sheet_no', true);
  assert a -> 'error' ->> 'code' = 'own_overtime', 'HRD menyetujui lemburnya sendiri: ' || a::text;

  a := ops_hr.decide_overtime_self(current_setting('ot189.evin'), true, null, 'hrd');
  assert a ->> 'outcome' = 'ok', a::text;
end $$;

/* ── hanya jam yang disetujui masuk baris gaji ─────────────────────────── */
do $$
declare L ops_hr.payroll_figures;
begin
  -- Sari, 2–8 Maret: disetujui Senin 2 + Selasa 3 + Rabu 1,5 = 6,5 jam.
  -- Kamis pertama (4 jam) ditolak; Kamis kedua (1 jam) menunggu.
  L := ops_hr.payroll_line_for('aaaa1890-0000-0000-0000-000000000001', '2026-03-02', '2026-03-08');
  assert L.overtime_pending_hours = 1,
    'jam menunggu harus 1 (Kamis kedua): ' || L.overtime_pending_hours;
  assert L.overtime_hours = 6.5,
    'jam lembur yang dibayar harus 6,5: ' || L.overtime_hours || ' ' || L.overtime_parts::text;
  assert (select count(distinct x ->> 'source') from jsonb_array_elements(L.overtime_parts) x) = 3,
    'rincian lembur harus dari tiga pengajuan yang disetujui: ' || L.overtime_parts::text;
  assert L.overtime_pay > 0, 'lembur yang disetujui tidak dibayar';
end $$;

/* ── jalur HRD sendiri menerima deliverable, dan tetap paid_default ────── */
do $$
declare a jsonb; v_no text; v_stage text; v_d text;
begin
  a := ops_hr.create_overtime_sheet('staff', '2026-03-06', 'Stock opname');
  v_no := a -> 'data' ->> 'sheet_no';
  a := ops_hr.add_overtime_line(p_sheet_no => v_no, p_employee_no => 'B-1891', p_hours => 2,
         p_task => 'hitung gudang', p_deliverable => 'Berita acara stock opname');
  assert a ->> 'outcome' = 'ok', a::text;
  select l.deliverable into v_d from ops_hr.overtime_lines l
    join ops_hr.overtime_sheets s on s.id = l.sheet_id where s.sheet_no = v_no;
  assert v_d = 'Berita acara stock opname', 'deliverable di jalur HRD tidak tersimpan';
  select stage into v_stage from ops_hr.v_overtime_stage where sheet_no = v_no;
  assert v_stage = 'paid_default', 'lembar HRD kehilangan default dibayar (D146): ' || v_stage;
  -- Pengajuan sendiri tidak bisa ditambahi nama.
  a := ops_hr.add_overtime_line(current_setting('ot189.kamis2'), 'B-1893', 1, 'ikut');
  assert a -> 'error' ->> 'code' = 'self_submitted', a::text;
end $$;

reset role;
do $$
begin
  assert not has_function_privilege('public','ops_hr.decide_overtime_self(text,boolean,text,text,text)','execute'),
    'decide_overtime_self() terbuka untuk PUBLIC';
  assert not has_function_privilege('public','ops_hr.self_overtime_queue()','execute'),
    'self_overtime_queue() terbuka untuk PUBLIC';
  assert not has_function_privilege('public','ops_hr.add_overtime_result_self(text,text,text)','execute'),
    'add_overtime_result_self() terbuka untuk PUBLIC';
end $$;

rollback;
