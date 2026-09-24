-- simulasi — HR sampai buku besar: satu karyawan baru, satu minggu kerja, satu gajian.
--
-- The same kind of file as `99_sim_procure_to_ledger`: a **walk**, written to
-- be read by the people who will do it. Every step is a person doing one
-- thing on one screen, in the order a real week happens, written into
-- `sim_log`. `supabase/local/simulate.sh sim_hr_to_ledger` prints it; the SOP
-- (`docs/sop/hr/`) and John Lau's process knowledge (`0140`) were written from it.
--
-- Four people, with the grants the real roles carry:
--   Tomi — IT: it admin (aturan gaji dan pola jadwal live di /it/aturan-gaji)
--   Sari — staf HRD: hrd write, payroll write (menyiapkan run, tidak bisa menandatangani)
--   Evin — pimpinan: approve_funds, payroll read
--   Rina — keuangan: accounting write, post_ledger, payroll read
--
-- The week is **last week**, Monday to Sunday, counted from the office's own
-- day, so the walk reads the same whenever it runs. Where the application
-- disagrees with itself the step is logged `TEMUAN` rather than asserted away.

begin;

create temp table sim_log (
  n          int generated always as identity,
  proses     text not null,
  langkah    text not null,
  pelaku     text not null,
  layar      text,
  seam       text,
  hasil      text not null,
  status     text,
  catatan    text
) on commit drop;
grant insert, select on sim_log to authenticated;

create function pg_temp.log(p_proses text, p_langkah text, p_pelaku text, p_layar text,
                            p_seam text, p_hasil text, p_status text, p_catatan text default null)
returns void language sql as $$
  insert into sim_log (proses, langkah, pelaku, layar, seam, hasil, status, catatan)
  values (p_proses, p_langkah, p_pelaku, p_layar, p_seam, p_hasil, p_status, p_catatan);
$$;

create function pg_temp.as_(p_who uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', p_who::text, true);
$$;

/* Last week: Monday .. Sunday before the office's today. */
create temp table wk on commit drop as
  select date_trunc('week', ops_core.office_day() - 7)::date as mon;
grant select on wk to authenticated;

insert into auth.users (id, email, raw_user_meta_data) values
  ('51520000-0000-0000-0000-0000000000a1','tomi@talaliving.com','{"full_name":"Tomi Setiawan"}'),
  ('51520000-0000-0000-0000-0000000000b2','sari@talaliving.com','{"full_name":"Sari Wulandari"}'),
  ('51520000-0000-0000-0000-00000000ce00','evin.hr@talaliving.com','{"full_name":"Evin Jonathan"}'),
  ('51520000-0000-0000-0000-00000000f11a','rina.hr@talaliving.com','{"full_name":"Rina Kartika"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('51520000-0000-0000-0000-0000000000a1','it','admin'),
  ('51520000-0000-0000-0000-0000000000b2','hrd','write'),
  ('51520000-0000-0000-0000-0000000000b2','payroll','write'),
  ('51520000-0000-0000-0000-00000000ce00','payroll','read'),
  ('51520000-0000-0000-0000-00000000ce00','hrd','read'),
  ('51520000-0000-0000-0000-00000000f11a','payroll','read'),
  ('51520000-0000-0000-0000-00000000f11a','accounting','write');
insert into ops_core.user_authorities (user_id, authority) values
  ('51520000-0000-0000-0000-00000000ce00','approve_funds'),
  ('51520000-0000-0000-0000-00000000f11a','post_ledger');

set local role authenticated;

-- ═════ 1. ATURAN GAJI DAN POLA JADWAL ═════════════════════════════════════
select pg_temp.as_('51520000-0000-0000-0000-0000000000a1');
do $$
declare r jsonb; mon date := (select mon from wk);
begin
  r := ops_hr.save_pay_rules(mon - 30, 'aturan awal simulasi', '{
   "week_pattern":"5day","day_starts_minutes":480,
   "overtime_mode":"statutory","flat_multiplier":1,
   "workday_tiers":[{"after_hours":0,"multiplier":1.5},{"after_hours":1,"multiplier":2}],
   "restday_tiers":[{"after_hours":0,"multiplier":2}],
   "monthly_divisor":173,"hourly_basis":"company","effective_days_per_year":240,
   "hourly_includes_allowance":false,"overtime_rounding_minutes":0,
   "undertime_mode":"off","undertime_grace_minutes":15,
   "late_grace_minutes":0,"late_mode":"manual","late_forfeits_allowance":false,
   "schedules":[
     {"code":"PRODUKSI","name":"Produksi","start_minutes":450,"end_minutes":990,
      "break_minutes":45,"friday_break_minutes":90,"friday_end_minutes":960,"note":null},
     {"code":"KANTOR","name":"Kantor","start_minutes":480,"end_minutes":1035,
      "break_minutes":60,"friday_break_minutes":90,"friday_end_minutes":990,"note":null}],
   "schedule_by_unit":{"Produksi":"PRODUKSI","Kantor":"KANTOR"}
  }'::jsonb);
  assert ops_core.said_ok(r), format('pay rules: %s', r);
  perform pg_temp.log('1. Aturan gaji','Simpan aturan gaji dan dua pola jadwal (Produksi, Kantor)','Tomi',
    '/it/aturan-gaji','ops_hr.save_pay_rules','OK', 'versi ' || (r -> 'data' ->> 'version'),
    'Lima hari kerja; pola dipasang per unit. Aturan ini dipegang IT, bukan HRD.');
end $$;

-- ═════ 2. KARYAWAN BARU ═══════════════════════════════════════════════════
select pg_temp.as_('51520000-0000-0000-0000-0000000000b2');
do $$
declare r jsonb; mon date := (select mon from wk);
begin
  r := ops_hr.save_employee('B-0101','Karjo Susanto', p_position => 'Tukang kayu', p_unit => 'Produksi',
         p_pay_basis => 'daily', p_base_rate => 180000, p_allowance_rate => 25000, p_daily_hours => 8.25,
         p_paid_leave_days => 12, p_joined_on => mon - 400);
  assert ops_core.said_ok(r), format('karjo: %s', r);
  perform pg_temp.log('2. Karyawan','Tambah karyawan harian: nomor mesin, nama, unit, upah per hari, tunjangan','Sari',
    '/hrd/karyawan','ops_hr.save_employee','OK', 'aktif', 'Nomor di mesin absen (B-0101) yang menyambungkan tap ke orangnya.');

  r := ops_hr.save_employee('B-0102','Wulan Sari', p_position => 'Admin', p_unit => 'Kantor',
         p_pay_basis => 'monthly', p_base_rate => 4500000, p_allowance_rate => 25000, p_daily_hours => 8.25,
         p_paid_leave_days => 12, p_joined_on => mon - 400);
  assert ops_core.said_ok(r), format('wulan: %s', r);
  perform pg_temp.log('2. Karyawan','Tambah karyawan bulanan','Sari','/hrd/karyawan','ops_hr.save_employee','OK','aktif');

  r := ops_hr.save_employee('B-0103','Tanpa Upah', p_unit => 'Produksi', p_pay_basis => 'daily');
  perform pg_temp.log('2. Karyawan','Simpan karyawan tanpa upah','Sari','/hrd/karyawan','ops_hr.save_employee',
    case when r -> 'error' ->> 'code' = 'rate_required' then 'DITOLAK' else 'TEMUAN' end, null,
    coalesce(r -> 'error' ->> 'code', r ->> 'outcome'));
  assert r -> 'error' ->> 'code' = 'rate_required', format('tanpa upah: %s', r);
end $$;

-- ═════ 3. JADWAL ══════════════════════════════════════════════════════════
do $$
declare r jsonb; v text;
begin
  select schedule_code into v from ops_hr.employees where employee_no = 'B-0101';
  if v is null then
    r := ops_hr.set_employee_schedule('B-0101','PRODUKSI');
    assert ops_core.said_ok(r), format('jadwal: %s', r);
  end if;
  perform pg_temp.log('3. Jadwal','Pastikan tiap orang punya pola kerja (dari unitnya, atau dipasang sendiri)','Sari',
    '/hrd/jadwal','ops_hr.set_employee_schedule','OK',
    'Karjo: ' || coalesce((select schedule_code from ops_hr.employees where employee_no = 'B-0101'), 'ikut unit'),
    'Orang tanpa pola tidak bisa dihitung jam kerjanya.');
end $$;

-- ═════ 4. BERKAS 201 ══════════════════════════════════════════════════════
do $$
declare r jsonb; f uuid;
begin
  r := ops_core.attach_file('sim/ktp-karjo.jpg','ktp-karjo.jpg','image/jpeg',90000,null,'upload');
  assert ops_core.said_ok(r), format('attach ktp: %s', r);
  f := (r -> 'data' ->> 'attachment_id')::uuid;
  r := ops_hr.file_employee_document('B-0101','ktp', f, '3271010101800001','typed', null, null, 'KTP asli dilihat');
  assert ops_core.said_ok(r), format('ktp: %s', r);
  perform pg_temp.log('4. Berkas 201','Tambah KTP: unggah scan, ketik nomornya','Sari','/hrd/berkas-201',
    'ops_hr.file_employee_document','OK','KTP terlampir',
    'Nomor KTP disimpan tertutup; membukanya tercatat di audit.');

  r := ops_hr.file_employee_document('B-0101','npwp', null, null);
  perform pg_temp.log('4. Berkas 201','Simpan berkas tanpa scan dan tanpa nomor','Sari','/hrd/berkas-201',
    'ops_hr.file_employee_document',
    case when r -> 'error' ->> 'code' = 'nothing_to_file' then 'DITOLAK' else 'TEMUAN' end, null,
    coalesce(r -> 'error' ->> 'code', r ->> 'outcome'));
  assert r -> 'error' ->> 'code' = 'nothing_to_file', format('kosong: %s', r);
end $$;

-- ═════ 5. KONTRAK KERJA ═══════════════════════════════════════════════════
do $$
declare r jsonb; v_no text; f uuid; mon date := (select mon from wk);
begin
  -- What the register form sends: no file.
  r := ops_hr.register_contract('B-0101','PKWT', mon - 30, mon + 335, p_note => 'kontrak pertama');
  assert ops_core.said_ok(r), format('register: %s', r);
  v_no := r -> 'data' ->> 'contract_no';
  perform pg_temp.log('5. Kontrak','Daftarkan kontrak: jenis, mulai berlaku, berakhir','Sari','/hrd/kontrak',
    'ops_hr.register_contract','OK','draft');

  r := ops_hr.activate_contract(v_no);
  perform pg_temp.log('5. Kontrak','Berlakukan sebelum kertasnya terlampir','Sari','/hrd/kontrak/' || v_no,
    'ops_hr.activate_contract',
    case when r -> 'error' ->> 'code' = 'paper_required' then 'DITOLAK' else 'TEMUAN' end, 'draft',
    coalesce(r -> 'error' ->> 'code', r ->> 'outcome'));
  assert r -> 'error' ->> 'code' = 'paper_required', format('tanpa kertas: %s', r);

  r := ops_core.attach_file('sim/pkwt-karjo.pdf','pkwt-karjo.pdf','application/pdf',220000,null,'upload');
  f := (r -> 'data' ->> 'attachment_id')::uuid;
  r := ops_hr.attach_contract_paper(v_no, f);
  assert ops_core.said_ok(r), format('kertas: %s', r);
  perform pg_temp.log('5. Kontrak','Lampirkan kontrak yang sudah ditandatangani (scan/PDF)','Sari','/hrd/kontrak/' || v_no,
    'ops_hr.attach_contract_paper','OK','draft · berkas terlampir',
    'Sebelum 0138 langkah ini tidak ada: formulir pendaftaran tidak punya kolom berkas (F154).');

  r := ops_hr.activate_contract(v_no);
  perform pg_temp.log('5. Kontrak','Berlakukan sebelum isi pokoknya dijawab','Sari','/hrd/kontrak/' || v_no,
    'ops_hr.activate_contract',
    case when r -> 'error' ->> 'code' = 'clauses_missing' then 'DITOLAK' else 'TEMUAN' end, 'draft',
    coalesce(r -> 'error' ->> 'code', r ->> 'outcome'));
  assert r -> 'error' ->> 'code' = 'clauses_missing', format('klausul: %s', r);

  perform ops_hr.confirm_clause(v_no,'gaji_pokok','Upah pokok Rp 180.000 per hari kerja.',1,'{"amount":"180000","per":"day"}');
  perform ops_hr.confirm_clause(v_no,'tunjangan','Tunjangan Rp 25.000 per hari hadir.',1,'{"amount":"25000","per":"day"}');
  perform ops_hr.confirm_clause(v_no,'jam_kerja','Jam kerja mengikuti jadwal produksi.',1,'{"schedule_code":"PRODUKSI"}');
  perform ops_hr.confirm_clause(v_no,'cuti','Cuti tahunan 12 hari kerja.',2,'{"days":"12"}');
  perform ops_hr.confirm_clause(v_no,'jangka_waktu','Perjanjian kerja waktu tertentu.',1,'{"kind":"PKWT"}');
  perform ops_hr.confirm_clause(v_no,'masa_percobaan','Tanpa masa percobaan.',1,'{"months":"0"}');
  perform ops_hr.confirm_clause(v_no,'keterlambatan','Keterlambatan dicatat dan diputuskan HRD.',2,'{"mode":"manual"}');
  perform ops_hr.confirm_clause(v_no,'potongan','Tidak ada potongan jam kurang.',2,'{"mode":"off"}');
  perform ops_hr.confirm_clause(v_no,'lembur','Lembur mengikuti ketentuan pemerintah.',2,'{"mode":"statutory"}');
  r := ops_hr.confirm_clause(v_no,'pemutusan','Pemutusan mengikuti ketentuan perundang-undangan.',3);
  assert ops_core.said_ok(r), format('pemutusan: %s', r);
  perform pg_temp.log('5. Kontrak','Jawab sepuluh poin wajib: tekan "Jawab", salin kalimat aslinya, isi nilainya, "Konfirmasi"','Sari',
    '/hrd/kontrak/' || v_no,'ops_hr.confirm_clause','OK','10 poin terjawab');

  r := ops_hr.activate_contract(v_no);
  assert ops_core.said_ok(r), format('aktif: %s', r);
  perform pg_temp.log('5. Kontrak','Tekan "Berlakukan"','Sari','/hrd/kontrak/' || v_no,
    'ops_hr.activate_contract','OK', (select status::text from ops_hr.employment_contracts where contract_no = v_no));
end $$;

-- ═════ 6. ABSENSI ═════════════════════════════════════════════════════════
do $$
declare r jsonb; rows jsonb := '[]'; d date; mon date := (select mon from wk); i int; m text;
begin
  -- Karjo taps Mon, Tue, Thu, Fri; Wulan Mon, Tue and only the morning of Fri.
  -- A day is read from four taps: in, out to break, back from break, out.
  foreach i in array array[0,1,3,4] loop
    d := mon + i;
    rows := rows || jsonb_build_array(
      jsonb_build_object('employee_ref','101','at', (d + time '07:25')::text || '+08'),
      jsonb_build_object('employee_ref','101','at', (d + time '12:00')::text || '+08'),
      jsonb_build_object('employee_ref','101','at', (d + time '12:44')::text || '+08'),
      jsonb_build_object('employee_ref','101','at', (d + case when i = 4 then time '16:05' else time '16:35' end)::text || '+08'));
  end loop;
  foreach i in array array[0,1,4] loop
    d := mon + i;
    rows := rows || jsonb_build_array(
      jsonb_build_object('employee_ref','102','at', (d + time '07:55')::text || '+08'),
      jsonb_build_object('employee_ref','102','at', (d + time '12:00')::text || '+08'),
      jsonb_build_object('employee_ref','102','at', (d + time '12:58')::text || '+08'));
    if i < 4 then
      rows := rows || jsonb_build_array(
        jsonb_build_object('employee_ref','102','at', (d + time '17:20')::text || '+08'));
    end if;
  end loop;
  rows := rows || jsonb_build_array(jsonb_build_object('employee_ref','999','at', (mon + time '08:00')::text || '+08'));

  r := ops_hr.import_scans('mesin-minggu-lalu.csv', rows);
  assert ops_core.said_ok(r), format('import: %s', r);
  perform pg_temp.log('6. Absensi','Unggah file mesin absen, periksa ringkasannya, tekan "Import N tap"','Sari',
    '/hrd/absensi','ops_hr.import_scans','OK',
    format('%s tap masuk · %s tap bernomor tak dikenal', r -> 'data' ->> 'added',
           (select coalesce(sum((u ->> 'count')::int), 0) from jsonb_array_elements(r -> 'data' -> 'unknown') u)),
    'Tap bernomor yang tidak dikenal tidak masuk, dan nomornya disebut. Tambahkan orangnya dulu, lalu impor ulang file yang sama — tap yang sudah masuk tidak dobel.');

  -- Wulan's Friday: the machine missed the evening tap.
  r := ops_hr.add_scan('B-0102', (mon + 4 + time '16:31')::text::timestamp at time zone 'Asia/Makassar', 'jari tidak terbaca mesin, dikonfirmasi satpam');
  assert ops_core.said_ok(r), format('add scan: %s', r);
  perform pg_temp.log('6. Absensi','Tap yang terlewat: buka sel harinya, "Tap the machine missed", isi jam dan alasannya','Sari',
    '/hrd/absensi','ops_hr.add_scan','OK','hari lengkap');

  -- Karjo's Wednesday: sick, with a doctor's note.
  r := ops_hr.mark_day(mon + 2, 'sick', 'demam, surat dokter menyusul', 'B-0101');
  assert ops_core.said_ok(r), format('sakit: %s', r);
  m := r -> 'data' ->> 'mark_no';
  perform pg_temp.log('6. Absensi','Tandai hari: pilih jenis "Sakit", isi keterangan, "Mark as Sakit"','Sari',
    '/hrd/absensi','ops_hr.mark_day','OK','sakit');
  r := ops_core.attach_file('sim/surat-dokter.jpg','surat-dokter.jpg','image/jpeg',70000,null,'upload');
  r := ops_hr.attach_surat_dokter(m, (r -> 'data' ->> 'attachment_id')::uuid);
  assert ops_core.said_ok(r), format('surat dokter: %s', r);
  perform pg_temp.log('6. Absensi','"Lampirkan surat dokter" pada hari sakit itu','Sari','/hrd/absensi',
    'ops_hr.attach_surat_dokter','OK','sakit · surat dokter terlampir');

  r := ops_hr.mark_day(mon + 2, 'sick', 'dua kali', 'B-0101');
  perform pg_temp.log('6. Absensi','Tandai hari yang sudah bertanda','Sari','/hrd/absensi','ops_hr.mark_day',
    case when r -> 'error' ->> 'code' = 'already_marked' then 'DITOLAK' else 'TEMUAN' end, null,
    coalesce(r -> 'error' ->> 'code', r ->> 'outcome'));
end $$;

-- ═════ 7. CUTI ════════════════════════════════════════════════════════════
do $$
declare r jsonb; v_no text; mon date := (select mon from wk);
begin
  r := ops_hr.request_leave('B-0102','cuti', mon + 2, mon + 3, 'acara keluarga di Makassar');
  assert ops_core.said_ok(r), format('cuti: %s', r);
  v_no := r -> 'data' ->> 'request_no';
  perform pg_temp.log('7. Cuti','"Ajukan": karyawan, jenis Cuti, dari–sampai tanggal, alasan','Sari','/hrd/cuti',
    'ops_hr.request_leave','OK','PENDING');

  r := ops_hr.request_leave('B-0102','izin', mon + 3, mon + 3, 'bentrok');
  perform pg_temp.log('7. Cuti','Ajukan izin di hari yang sudah diajukan cuti','Sari','/hrd/cuti','ops_hr.request_leave',
    case when r -> 'error' ->> 'code' = 'overlaps_existing' then 'DITOLAK' else 'TEMUAN' end, null,
    coalesce(r -> 'error' ->> 'code', r ->> 'outcome'));

  r := ops_hr.decide_leave(v_no, false, null);
  perform pg_temp.log('7. Cuti','Tolak tanpa alasan','Sari','/hrd/cuti','ops_hr.decide_leave',
    case when r -> 'error' ->> 'code' = 'reason_required' then 'DITOLAK' else 'TEMUAN' end, null,
    coalesce(r -> 'error' ->> 'code', r ->> 'outcome'));

  r := ops_hr.decide_leave(v_no, true, null);
  assert ops_core.said_ok(r), format('setujui: %s', r);
  perform pg_temp.log('7. Cuti','"Setujui"','Sari','/hrd/cuti','ops_hr.decide_leave','OK',
    'APPROVED · ' || (select count(*) from ops_hr.day_marks dm join ops_hr.employees e on e.id = dm.employee_id
                        where e.employee_no = 'B-0102' and dm.kind = 'leave' and dm.work_date between mon + 2 and mon + 3)
    || ' hari bertanda cuti',
    'Persetujuan menulis tanda hari di absensi; sisa cuti berkurang.');
end $$;

-- ═════ 8. RUN GAJI ════════════════════════════════════════════════════════
do $$
declare r jsonb; v_no text; mon date := (select mon from wk); t ops_hr.payroll_totals_t;
begin
  r := ops_hr.open_payroll_run(mon, mon + 6, 'minggu lalu');
  assert ops_core.said_ok(r), format('open run: %s', r);
  v_no := r -> 'data' ->> 'run_no';
  perform pg_temp.log('8. Gajian','Buka run minggu ini dari "Gajian mingguan" ("Buka run minggu ini")','Sari',
    '/hrd/payroll/minggu','ops_hr.open_payroll_run','OK','DRAFT',
    'Baris gaji dihitung dari absensi saat dibaca; tidak ada tombol hitung.');

  r := ops_hr.open_payroll_run(mon + 3, mon + 9, 'tumpang tindih');
  perform pg_temp.log('8. Gajian','Buka run yang periodenya bertumpuk','Sari','/hrd/payroll','ops_hr.open_payroll_run',
    case when r -> 'error' ->> 'code' = 'period_overlaps' then 'DITOLAK' else 'TEMUAN' end, null,
    coalesce(r -> 'error' ->> 'code', r ->> 'outcome'));

  r := ops_hr.add_adjustment(v_no,'B-0101','bonus', 150000,'target rak selesai lebih cepat');
  assert ops_core.said_ok(r), format('bonus: %s', r);
  perform pg_temp.log('8. Gajian','Tambah penyesuaian: karyawan, jenis, nominal, alasan, "Tambahkan"','Sari',
    '/hrd/payroll/' || v_no,'ops_hr.add_adjustment','OK','DRAFT');

  r := ops_hr.approve_payroll_run(v_no);
  perform pg_temp.log('8. Gajian','Staf HRD mencoba menyetujui run','Sari','/hrd/payroll/' || v_no,
    'ops_hr.approve_payroll_run',
    case when r -> 'error' ->> 'code' in ('not_permitted','authority_required') then 'DITOLAK' else 'TEMUAN' end, 'DRAFT',
    coalesce(r -> 'error' ->> 'code', r ->> 'outcome'));
  assert not ops_core.said_ok(r), 'yang menyiapkan tidak menandatangani';

  select * into t from ops_hr.payroll_totals(mon, mon + 6, v_no);
  perform pg_temp.log('8. Gajian','Periksa total run sebelum diserahkan ke pimpinan','Sari','/hrd/payroll/' || v_no,
    'ops_hr.payroll_totals', case when t.open_days = 0 then 'OK' else 'TEMUAN' end, 'DRAFT',
    format('%s orang · bruto %s · penyesuaian %s · bersih %s · hari terbuka %s',
           t.people, t.gross_total, t.adjustment_total, t.net_total, t.open_days));
end $$;

select pg_temp.as_('51520000-0000-0000-0000-00000000ce00');
do $$
declare r jsonb; v_no text;
begin
  select run_no into v_no from ops_hr.payroll_runs where note = 'minggu lalu';
  r := ops_hr.approve_payroll_run(v_no);
  assert ops_core.said_ok(r), format('approve: %s', r);
  perform pg_temp.log('8. Gajian','Pimpinan membuka run dan menekan "Approve the run"','Evin','/hrd/payroll/' || v_no,
    'ops_hr.approve_payroll_run','OK', (select status::text from ops_hr.payroll_runs where run_no = v_no));
end $$;

-- ═════ 9. BAYAR DAN CATAT KE BUKU BESAR ═══════════════════════════════════
select pg_temp.as_('51520000-0000-0000-0000-0000000000b2');
do $$
declare r jsonb; v_no text;
begin
  select run_no into v_no from ops_hr.payroll_runs where note = 'minggu lalu';
  r := ops_acct.post_payroll_run(v_no, 1000000, 'BCA 271', gen_random_uuid());
  perform pg_temp.log('9. Bayar gaji','Staf HRD mencoba mencatat pembayaran gaji ke buku besar','Sari','/hrd/payroll/' || v_no,
    'ops_acct.post_payroll_run',
    case when r -> 'error' ->> 'code' = 'authority_required' then 'DITOLAK' else 'TEMUAN' end, 'APPROVED',
    coalesce(r -> 'error' ->> 'code', r ->> 'outcome'));
end $$;

select pg_temp.as_('51520000-0000-0000-0000-00000000f11a');
do $$
declare r jsonb; v_no text; f uuid; t ops_hr.payroll_totals_t; mon date := (select mon from wk); trx text;
begin
  select run_no into v_no from ops_hr.payroll_runs where note = 'minggu lalu';
  select * into t from ops_hr.payroll_totals(mon, mon + 6, v_no);

  r := ops_acct.post_payroll_run(v_no, t.net_total, 'BCA 271', null);
  perform pg_temp.log('9. Bayar gaji','Catat pembayaran tanpa bukti transfer','Rina','/hrd/payroll/' || v_no,
    'ops_acct.post_payroll_run',
    case when r -> 'error' ->> 'code' = 'evidence_required' then 'DITOLAK' else 'TEMUAN' end, 'APPROVED',
    coalesce(r -> 'error' ->> 'code', r ->> 'outcome'));

  r := ops_core.attach_file('sim/transfer-gaji.jpg','transfer-gaji.jpg','image/jpeg',80000,null,'upload');
  f := (r -> 'data' ->> 'attachment_id')::uuid;
  r := ops_acct.post_payroll_run(v_no, t.net_total, 'BCA 271', f, ops_core.office_day());
  assert ops_core.said_ok(r), format('bayar: %s', r);
  trx := r -> 'data' ->> 'trx_no';
  perform pg_temp.log('9. Bayar gaji','"Bayar run ini": rekening, nominal (terisi dari total bersih), bukti transfer','Rina',
    '/hrd/payroll/' || v_no,'ops_acct.post_payroll_run','OK',
    (select status::text from ops_hr.payroll_runs where run_no = v_no) || ' · ' || trx,
    'Satu baris buku besar untuk seluruh run — gaji per orang tidak ditulis ke buku besar.');

  assert (select t2.type_code from ops_acct.transactions t2 where t2.trx_no = trx) = 'RECCURING - PAYROLL WEEKLY',
    'run seminggu dicatat sebagai payroll mingguan';

  r := ops_acct.post_payroll_run(v_no, t.net_total, 'BCA 271', f);
  perform pg_temp.log('9. Bayar gaji','Bayar run yang sudah dibayar','Rina','/hrd/payroll/' || v_no,
    'ops_acct.post_payroll_run',
    case when r -> 'error' ->> 'code' = 'already_paid' then 'DITOLAK' else 'TEMUAN' end, 'PAID',
    coalesce(r -> 'error' ->> 'code', r ->> 'outcome'));

  r := ops_acct.complete_transaction(trx);
  perform pg_temp.log('9. Bayar gaji','Tandai transaksinya lengkap di buku besar','Rina','/accounting/ledger',
    'ops_acct.complete_transaction', case when ops_core.said_ok(r) then 'OK' else 'TEMUAN' end,
    (select status::text from ops_acct.transactions where trx_no = trx), coalesce(r -> 'error' ->> 'code', null));
end $$;

-- The whole week, one row per thing somebody did. `simulate.sh` prints this.
select n, proses, langkah, pelaku, layar, seam, hasil, status, catatan from sim_log order by n;

do $$
declare n int;
begin
  select count(*) into n from sim_log where hasil = 'TEMUAN';
  raise notice 'simulasi HR → buku besar: % langkah, % temuan', (select count(*) from sim_log), n;
end $$;

rollback;
