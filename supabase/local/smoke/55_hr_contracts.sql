-- hr — kontrak kerja: dokumennya, poin wajibnya, dan selisihnya terhadap yang
-- benar-benar dijalankan (A3, A5, D155, ADR-010).
--
--   REFUSALS     mendaftarkan dengan grant baca; PKWT tanpa tanggal berakhir
--                dan PKWTT dengan tanggal berakhir; berakhir sebelum mulai;
--                klausul tanpa kalimat aslinya; bacaan yang bentuknya tidak
--                sesuai jenisnya; **usulan mesin menimpa konfirmasi orang**;
--                mengonfirmasi klausul pada kontrak yang sudah berjalan;
--                memberlakukan tanpa kertasnya, dengan poin wajib yang belum
--                dijawab, atau dua kali; mengakhiri tanpa alasan
--   DERIVATIONS  daftar poin wajib adalah **data** — menambah satu membuat
--                setiap kontrak melaporkannya hari itu juga; `source`
--                disimpulkan dari apakah orangnya menerima bacaan mesin apa
--                adanya; masa percobaan **diturunkan** dari klausulnya;
--                kontrak baru menggantikan yang lama dan yang lama tetap ada;
--                **selisih terhadap sistem dilaporkan dan tidak satu pun
--                diterapkan**

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-000000005801','hrd58@talaliving.com','{"full_name":"Staf HRD"}'),
  ('ffffffff-0000-0000-0000-000000005802','lihat58@talaliving.com','{"full_name":"Pembaca"}'),
  ('ffffffff-0000-0000-0000-000000005803','it58@talaliving.com','{"full_name":"Staf IT"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-000000005801','hrd','write'),
  ('ffffffff-0000-0000-0000-000000005802','hrd','read'),
  ('ffffffff-0000-0000-0000-000000005803','it','admin');

insert into ops_hr.pay_rule_sets (version, effective_from, note, rules, created_by) values
 (1, current_date, 'versi uji', '{
   "week_pattern": "6day",
   "late_mode": "manual",
   "undertime_mode": "off",
   "overtime_mode": "statutory",
   "schedules": [
     {"code":"produksi","name":"Produksi","start_minutes":450,"end_minutes":990,
      "break_minutes":45,"friday_break_minutes":90,"note":null}
   ]
 }'::jsonb, 'ffffffff-0000-0000-0000-000000005801');

insert into ops_core.attachments (id, storage_path, filename, mime, bytes, source, uploaded_by)
values ('bbbb5800-0000-0000-0000-0000000000f1','drive/pkwt-karjo.pdf','pkwt-karjo.pdf',
        'application/pdf', 220000,'web','ffffffff-0000-0000-0000-000000005801'),
       ('bbbb5800-0000-0000-0000-0000000000f2','drive/pkwt-karjo-2027.pdf','pkwt-karjo-2027.pdf',
        'application/pdf', 231000,'web','ffffffff-0000-0000-0000-000000005801');

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000005801';

insert into ops_hr.employees (id, employee_no, full_name, unit, schedule_code, pay_basis,
                              base_rate, allowance_rate, paid_leave_days)
values ('aaaa5800-0000-0000-0000-0000000000e1','B-0012','Karjo Susanto','Produksi','produksi',
        'daily', 180000, 20000, 12);

/* ── REFUSAL: grant baca tidak mendaftarkan apa pun ─────────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000005802';
do $$
declare a jsonb; n int;
begin
  a := ops_hr.register_contract('B-0012','PKWT', current_date, current_date + 365);
  assert a -> 'error' ->> 'code' = 'not_permitted', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');
  select count(*) into n from ops_hr.employment_contracts;
  assert n = 0, 'dan tidak ada yang tertulis dalam perjalanan ditolak, got ' || n;
end $$;

set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000005801';

/* ── REFUSAL: kontrak yang membantah dirinya sendiri ────────────────────── */
do $$
declare a jsonb;
begin
  a := ops_hr.register_contract('B-9999','PKWT', current_date, current_date + 365);
  assert a -> 'error' ->> 'code' = 'not_found', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');

  a := ops_hr.register_contract('B-0012','PKWT', current_date, null);
  assert a -> 'error' ->> 'code' = 'end_date_required',
    'PKWT selalu berakhir, got ' || coalesce(a -> 'error' ->> 'code','(null)');
  a := ops_hr.register_contract('B-0012','PKWTT', current_date, current_date + 365);
  assert a -> 'error' ->> 'code' = 'end_date_not_allowed',
    'PKWTT tidak berakhir, got ' || coalesce(a -> 'error' ->> 'code','(null)');
  a := ops_hr.register_contract('B-0012','PKWT', current_date, current_date - 1);
  assert a -> 'error' ->> 'code' = 'period_invalid', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');
end $$;

/* ── DERIVATION: mendaftarkan, dan kertasnya masuk jalur bukti ──────────── */
do $$
declare a jsonb; v_no text; n int;
begin
  a := ops_hr.register_contract('B-0012','PKWT','2026-01-02','2026-12-31',
                                'bbbb5800-0000-0000-0000-0000000000f1',
                                'sha-karjo-1','kontrak pertama','k-58-reg');
  assert ops_core.said_ok(a), 'got ' || coalesce(a -> 'error' ->> 'code', a::text);
  v_no := a -> 'data' ->> 'contract_no';
  assert v_no like 'kkj-%', 'got ' || coalesce(v_no,'(null)');
  assert a -> 'data' ->> 'status' = 'draft', 'kertasnya ada, isinya belum dijawab';

  -- Satu jalan: tautannya ditulis seam dokumen, bukan seam ini (ADR-010).
  select count(*) into n from ops_core.attachment_links l
   where l.entity = 'employee' and l.entity_no = 'B-0012'
     and l.kind = 'kontrak_kerja' and l.unlinked_at is null;
  assert n = 1, 'got ' || n;

  -- Ulangan dengan kunci yang sama membawa muatan lain: yang kembali adalah
  -- jawaban pertama, dan kontrak kedua tidak terbuat.
  a := ops_hr.register_contract('B-0012','PKWTT','2026-06-01', null, null, null, null,'k-58-reg');
  assert a ->> 'outcome' = 'duplicate', 'got ' || coalesce(a ->> 'outcome','(null)');
  assert a -> 'data' ->> 'contract_no' = v_no, 'got ' || coalesce(a -> 'data' ->> 'contract_no','(null)');
  select count(*) into n from ops_hr.employment_contracts;
  assert n = 1, 'got ' || n;
end $$;

/* ── DERIVATION: daftar poin wajib adalah data ──────────────────────────── */
do $$
declare n int; v_no text;
begin
  select contract_no into v_no from ops_hr.employment_contracts;
  select count(*) into n from ops_hr.contract_coverage(v_no) where required;
  assert n = 10, 'sepuluh poin wajib, got ' || n;
  select count(*) into n from ops_hr.contract_coverage(v_no) where required and not present;
  assert n = 10, 'dan belum satu pun dijawab, got ' || n;
  -- Setiap jenis dibawa serta namanya, supaya layarnya tidak perlu daftar kedua.
  assert (select what from ops_hr.contract_coverage(v_no) where kind = 'lembur') like 'Bagaimana lembur%';
end $$;

/* ── REFUSAL: apa yang bukan klausul ────────────────────────────────────── */
do $$
declare a jsonb; v_no text;
begin
  select contract_no into v_no from ops_hr.employment_contracts;

  a := ops_hr.confirm_clause('kkj-99-99-99_01','gaji_pokok','x');
  assert a -> 'error' ->> 'code' = 'not_found', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');
  a := ops_hr.confirm_clause(v_no,'gaji_pokok','   ');
  assert a -> 'error' ->> 'code' = 'quote_required',
    'angka tanpa kalimatnya tidak bisa dibantah di meja, got '
    || coalesce(a -> 'error' ->> 'code','(null)');

  -- Bentuk yang diminta jenisnya. Sebuah jsonb tanpa aturan hanya memindahkan
  -- masalahnya ke layar.
  a := ops_hr.confirm_clause(v_no,'gaji_pokok','Upah pokok Rp 180.000 per hari', 1,
                             '{"amount":"180000"}'::jsonb);
  assert a -> 'error' ->> 'code' = 'value_shape', 'satuannya belum disebut, got '
    || coalesce(a -> 'error' ->> 'code','(null)');
  a := ops_hr.confirm_clause(v_no,'gaji_pokok','Upah pokok Rp 0 per hari', 1,
                             '{"amount":"0","per":"day"}'::jsonb);
  assert a -> 'error' ->> 'code' = 'value_shape', 'nol bukan upah, got '
    || coalesce(a -> 'error' ->> 'code','(null)');
  -- Kosakatanya harus sama dengan buku aturan, kalau tidak perbandingannya
  -- nanti hanya membandingkan dua ejaan.
  a := ops_hr.confirm_clause(v_no,'keterlambatan','Terlambat dipotong', 2,
                             '{"mode":"dipotong"}'::jsonb);
  assert a -> 'error' ->> 'code' = 'value_shape', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');
end $$;

/* ── DERIVATION: mesin mengusulkan, orang menandatangani ────────────────── */
do $$
declare a jsonb; v_no text; cl ops_hr.contract_clauses;
begin
  select contract_no into v_no from ops_hr.employment_contracts;

  a := ops_hr.propose_clause(v_no,'gaji_pokok','Upah pokok sebesar Rp 180.000 (seratus delapan puluh ribu rupiah) per hari kerja.', 1,
                             '{"amount":"180000","per":"day"}'::jsonb,'k-58-prop');
  assert ops_core.said_ok(a), 'got ' || coalesce(a -> 'error' ->> 'code', a::text);
  assert not (a -> 'data' ->> 'confirmed')::boolean,
    'bacaan mesin tidak pernah lahir terkonfirmasi';

  select * into cl from ops_hr.contract_clauses where contract_no = v_no and kind = 'gaji_pokok';
  assert cl.source = 'extracted', 'got ' || cl.source::text;
  assert cl.confirmed_at is null, 'dan belum ada yang menandatanganinya';

  -- Orangnya menerima bacaan itu apa adanya: `source` tetap `extracted`, yang
  -- nanti menjadi hitungan *berapa persen bacaan mesin diterima tanpa diubah*.
  a := ops_hr.confirm_clause(v_no,'gaji_pokok','Upah pokok sebesar Rp 180.000 (seratus delapan puluh ribu rupiah) per hari kerja.', 1,
                             '{"amount":"180000","per":"day"}'::jsonb);
  assert ops_core.said_ok(a), 'got ' || coalesce(a -> 'error' ->> 'code', a::text);
  assert a -> 'data' ->> 'source' = 'extracted',
    'diterima apa adanya, got ' || coalesce(a -> 'data' ->> 'source','(null)');

  -- **Usulan mesin tidak menimpa tanda tangan.** Membaca ulang dokumen yang
  -- sama besok boleh mengganti usulan kemarin; ia tidak boleh mengganti ini.
  a := ops_hr.propose_clause(v_no,'gaji_pokok','Upah pokok Rp 1.800.000 per hari.', 1,
                             '{"amount":"1800000","per":"day"}'::jsonb);
  assert a -> 'error' ->> 'code' = 'already_confirmed', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');
  assert (select (value ->> 'amount') from ops_hr.contract_clauses
           where contract_no = v_no and kind = 'gaji_pokok') = '180000',
    'dan angkanya tidak bergerak';
end $$;

/* ── DERIVATION: yang dikoreksi orang tercatat sebagai diketik ───────────── */
do $$
declare a jsonb; v_no text;
begin
  select contract_no into v_no from ops_hr.employment_contracts;
  a := ops_hr.propose_clause(v_no,'cuti','Cuti tahunan 12 hari.', 3, '{"days":"12"}'::jsonb);
  assert ops_core.said_ok(a), 'got ' || coalesce(a -> 'error' ->> 'code', a::text);

  -- HRD membacanya lagi dan angkanya salah.
  a := ops_hr.confirm_clause(v_no,'cuti','Cuti tahunan 14 (empat belas) hari kerja.', 3,
                             '{"days":"14"}'::jsonb);
  assert a -> 'data' ->> 'source' = 'typed',
    'yang dikoreksi bukan lagi bacaan mesin, got ' || coalesce(a -> 'data' ->> 'source','(null)');
  -- Kalimat yang dikoreksi yang tersimpan, bukan kalimat usulan mesinnya.
  assert (select quote from ops_hr.contract_clauses
           where contract_no = v_no and kind = 'cuti') like 'Cuti tahunan 14%',
    'got ' || coalesce((select quote from ops_hr.contract_clauses
                         where contract_no = v_no and kind = 'cuti'),'(null)');
end $$;

/* ── REFUSAL: memberlakukan sebelum isinya dijawab ──────────────────────── */
do $$
declare a jsonb; v_no text;
begin
  select contract_no into v_no from ops_hr.employment_contracts;
  -- Mesin sudah membaca klausul lemburnya, dan belum ada yang menandatangani.
  -- **Usulan bukan jawaban**: kontrak ini tetap belum lengkap.
  perform ops_hr.propose_clause(v_no,'lembur','Lembur mengikuti ketentuan pemerintah.', 2,
                                '{"mode":"statutory"}'::jsonb);
  -- Sepuluh poin wajib, dua sudah ditandatangani, satu baru diusulkan mesin —
  -- yang tersisa delapan, bukan tujuh.
  assert (select required_missing from ops_hr.v_contract where contract_no = v_no) = 8,
    'usulan yang belum ditandatangani tidak menutup poin wajib, got '
    || (select required_missing from ops_hr.v_contract where contract_no = v_no);

  a := ops_hr.activate_contract(v_no);
  assert a -> 'error' ->> 'code' = 'clauses_missing', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');
  -- Disebut namanya, bukan hanya dihitung: jumlah membuat orang menebak mana.
  assert a -> 'error' -> 'detail' -> 'missing' ? 'lembur',
    'dan yang baru diusulkan mesin ikut disebut, got '
    || coalesce((a -> 'error' -> 'detail' -> 'missing')::text,'(null)');
  assert not (a -> 'error' -> 'detail' -> 'missing' ? 'gaji_pokok'),
    'yang sudah dijawab tidak ikut disebut';
  assert (select status from ops_hr.employment_contracts where contract_no = v_no) = 'draft';
end $$;

/* ── REFUSAL: berlaku tanpa kertasnya ───────────────────────────────────── */
--
-- Kontrak yang berlaku tanpa berkas yang ditandatangani adalah kesepakatan
-- lisan dengan nomor dokumen di depannya.
do $$
declare a jsonb; v_no text;
begin
  a := ops_hr.register_contract('B-0012','PKWTT','2030-01-01');
  v_no := a -> 'data' ->> 'contract_no';
  a := ops_hr.activate_contract(v_no);
  assert a -> 'error' ->> 'code' = 'paper_required', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');
  -- Dan dihapus dari jalan supaya sisa berkas ini bicara tentang dua kontrak
  -- saja; sebuah draft tidak menghalangi apa pun, hanya membingungkan hitungan.
  update ops_hr.employment_contracts set kind = 'PKWTT' where contract_no = v_no;
end $$;

/* ── DERIVATION: menjawab sisanya, lalu memberlakukannya ────────────────── */
do $$
declare a jsonb; v_no text;
begin
  select contract_no into v_no from ops_hr.employment_contracts;

  perform ops_hr.confirm_clause(v_no,'tunjangan','Tunjangan kehadiran Rp 20.000 per hari masuk.', 1,
                                '{"amount":"20000","per":"day"}'::jsonb);
  perform ops_hr.confirm_clause(v_no,'jam_kerja','Jam kerja 07.30 sampai 16.30, enam hari seminggu.', 2,
                                '{"schedule_code":"produksi"}'::jsonb);
  perform ops_hr.confirm_clause(v_no,'jangka_waktu','Perjanjian ini berlaku satu tahun.', 1,
                                '{"kind":"PKWT"}'::jsonb);
  perform ops_hr.confirm_clause(v_no,'masa_percobaan','Masa percobaan tiga bulan sejak tanggal mulai.', 1,
                                '{"months":"3"}'::jsonb);
  -- **Klausul kebijakan yang tidak sama dengan yang dijalankan.** Kertasnya
  -- bilang potong per jam; buku aturan menjalankan `manual`.
  perform ops_hr.confirm_clause(v_no,'keterlambatan','Keterlambatan dipotong secara proporsional per jam.', 2,
                                '{"mode":"pro_rata"}'::jsonb);
  perform ops_hr.confirm_clause(v_no,'potongan','Kekurangan jam kerja tidak dipotong.', 2,
                                '{"mode":"off"}'::jsonb);
  perform ops_hr.confirm_clause(v_no,'lembur','Lembur mengikuti ketentuan pemerintah.', 2,
                                '{"mode":"statutory"}'::jsonb);
  perform ops_hr.confirm_clause(v_no,'pemutusan','Pemberitahuan tiga puluh hari sebelumnya.', 4, null);

  a := ops_hr.activate_contract(v_no,'k-58-act');
  assert ops_core.said_ok(a), 'got ' || coalesce(a -> 'error' ->> 'code', a::text);
  assert a -> 'data' ->> 'status' = 'active', 'got ' || coalesce(a -> 'data' ->> 'status','(null)');
  assert a -> 'data' ->> 'supersedes' is null, 'yang pertama tidak menggantikan apa pun';
  -- Selisihnya dihitung waktu diberlakukan supaya layarnya tidak bertanya lagi.
  assert (a -> 'data' ->> 'conflicts')::int > 0, 'ada yang tidak sama, got '
    || coalesce(a -> 'data' ->> 'conflicts','(null)');

  a := ops_hr.activate_contract(v_no);
  assert a -> 'error' ->> 'code' = 'already_decided', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');
end $$;

/* ── REFUSAL dan DERIVATION: yang berjalan dilengkapi, tidak diubah ─────── */
do $$
declare a jsonb; v_no text; n int;
begin
  select contract_no into v_no from ops_hr.employment_contracts where status = 'active';

  -- Jawaban yang sudah ditandatangani tidak disunting.
  a := ops_hr.confirm_clause(v_no,'gaji_pokok','Upah pokok Rp 200.000 per hari.', 1,
                             '{"amount":"200000","per":"day"}'::jsonb);
  assert a -> 'error' ->> 'code' = 'already_confirmed',
    'syarat yang berubah adalah kontrak baru, got ' || coalesce(a -> 'error' ->> 'code','(null)');

  -- Poin yang belum pernah dijawab boleh dilengkapi — tanpa jalan ini, kontrak
  -- lama yang sudah diberlakukan tidak akan pernah bisa dirapikan.
  a := ops_hr.confirm_clause(v_no,'bpjs','Kepesertaan BPJS ditanggung bersama sesuai ketentuan.', 5, null);
  assert ops_core.said_ok(a), 'got ' || coalesce(a -> 'error' ->> 'code', a::text);

  -- **Usulan mesin di atas kontrak yang berjalan tidak mengubah laporan apa
  -- pun** sampai ada yang menandatanganinya.
  a := ops_hr.propose_clause(v_no,'fasilitas','Disediakan mes dan makan siang.', 6, null);
  assert ops_core.said_ok(a), 'got ' || coalesce(a -> 'error' ->> 'code', a::text);
  a := ops_hr.propose_clause(v_no,'penempatan','Ditempatkan di Denpasar.', 6, null);
  assert ops_core.said_ok(a), 'got ' || coalesce(a -> 'error' ->> 'code', a::text);
  select count(*) into n from ops_hr.contract_conflicts();
  assert n = 11, 'sepuluh yang ditandatangani plus BPJS, bukan usulan yang menyusul, got ' || n;
end $$;

/* ── DERIVATION: masa percobaan diturunkan, tidak disimpan ──────────────── */
do $$
declare v ops_hr.v_contract%rowtype;
begin
  select * into v from ops_hr.v_contract where status = 'active';
  assert v.probation_until = '2026-04-02',
    'tiga bulan sejak 2 Januari, got ' || coalesce(v.probation_until::text,'(null)');
  assert v.required_missing = 0, 'got ' || v.required_missing;
  -- Sepuluh poin wajib, plus BPJS yang baru dilengkapi di atas.
  assert v.clauses_confirmed = 11, 'got ' || v.clauses_confirmed;
  assert v.attachment_id = 'bbbb5800-0000-0000-0000-0000000000f1', 'kertasnya terjangkau';
  -- Berapa poin yang tidak sama dengan yang dijalankan, di baris daftarnya —
  -- supaya layar tidak perlu membuka tiap kontrak untuk tahu mana yang perlu
  -- dibaca.
  -- Disebut namanya, bukan dihitung: sebuah angka yang meleset menyuruh orang
  -- berikutnya menebak mana yang hilang, dan itu satu putaran CI yang terbuang.
  assert (select string_agg(kind::text, ',' order by kind::text)
            from ops_hr.contract_conflicts() where differs) = 'cuti,keterlambatan',
    'got ' || coalesce((select string_agg(kind::text || '(' || coalesce(says,'∅')
                                          || ' vs ' || coalesce(runs,'∅') || ')', ', '
                                          order by kind::text)
                          from ops_hr.contract_conflicts() where differs), '(none)');
  assert v.conflict_count = 2, 'cuti dan keterlambatan, got ' || v.conflict_count;
  -- Dan nol untuk yang belum berlaku: kertas yang belum diberlakukan tidak
  -- mengatakan apa pun tentang apa yang dibayarkan hari ini.
  assert (select conflict_count from ops_hr.v_contract where status = 'draft') = 0,
    'got ' || (select conflict_count from ops_hr.v_contract where status = 'draft');
  assert v.ends_in_days = ('2026-12-31'::date - ops_core.office_day()),
    'dihitung dari hari kantor, bukan tengah malam peramban (F17)';
end $$;

/* ── DERIVATION: selisih terhadap yang benar-benar dijalankan ───────────── */
--
-- Inilah alasan seluruh migrasi ini ada.
do $$
declare r ops_hr.clause_conflict_row; n int;
begin
  -- Gaji, tunjangan dan jadwal sama dengan baris karyawannya.
  select * into r from ops_hr.contract_conflicts() where kind = 'gaji_pokok';
  assert r.says = '180000 / day' and r.runs = '180000 / day', format('%s vs %s', r.says, r.runs);
  assert not r.differs, 'yang sama tidak dilaporkan sebagai selisih';
  assert r.bears_on = 'employees.base_rate', 'dan tahu ke mana bermuara';

  -- **Cuti tidak sama**: kertasnya 14 hari, sistem membayar 12.
  select * into r from ops_hr.contract_conflicts() where kind = 'cuti';
  assert r.differs, 'got ' || r.says || ' vs ' || r.runs;
  assert r.says = '14 hari' and r.runs = '12 hari', format('%s vs %s', r.says, r.runs);
  -- Kalimat aslinya ikut, supaya yang memutuskan tidak perlu membuka PDF-nya.
  assert r.quote like 'Cuti tahunan 14%', 'got ' || coalesce(r.quote,'(null)');

  -- **Keterlambatan tidak sama**, dan ini klausul kebijakan: satu kontrak
  -- tidak diam-diam mengubah aturan untuk semua orang.
  select * into r from ops_hr.contract_conflicts() where kind = 'keterlambatan';
  assert r.differs and r.says = 'pro_rata' and r.runs = 'manual',
    format('%s vs %s', r.says, r.runs);

  -- Klausul yang tidak punya lawan di basis data tidak pernah "berbeda".
  -- Melaporkannya akan memenuhi daftar ini dengan hal yang tidak bisa
  -- diperbaiki siapa pun, dan daftar seperti itu berhenti dibaca.
  select * into r from ops_hr.contract_conflicts() where kind = 'pemutusan';
  assert not r.comparable and not r.differs, 'got ' || coalesce(r.says,'(null)');

  select count(*) into n from ops_hr.contract_conflicts() where differs;
  assert n = 2, 'dua selisih: cuti dan keterlambatan, got ' || n;

  -- **Tidak satu pun diterapkan.** Memberlakukan kontrak adalah satu perbuatan;
  -- mengubah upah adalah perbuatan lain dengan jejaknya sendiri (D155).
  assert (select paid_leave_days from ops_hr.employees where employee_no = 'B-0012') = 12,
    'kontraknya bilang 14 dan sistem tetap membayar 12 sampai ada yang memutuskan';
end $$;

/* ── DERIVATION: menambah poin wajib membuat semua kontrak melaporkannya ── */
--
-- Daftarnya ditulis IT, di sebelah buku aturan gaji: menambah poin wajib adalah
-- keputusan kebijakan, bukan pekerjaan harian.
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000005803';
update ops_hr.clause_checklist set required = true where kind = 'kerahasiaan';

set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000005801';
do $$
declare n int;
begin
  -- Tanpa backfill, tanpa satu pun baris kontrak disentuh.
  select required_missing into n from ops_hr.v_contract where status = 'active';
  assert n = 1, 'kontrak yang sudah berjalan pun melaporkan poin baru yang belum dijawabnya, got ' || n;
  select count(*) into n from ops_hr.contract_coverage(
    (select contract_no from ops_hr.employment_contracts where status = 'active'))
   where required and not present;
  assert n = 1, 'dan daftar kerjanya menyebut satu hal, got ' || n;
end $$;

set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000005803';
update ops_hr.clause_checklist set required = false where kind = 'kerahasiaan';

/* ── DERIVATION: kontrak berikutnya menggantikan, yang lama tetap ada ───── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000005801';
do $$
declare a jsonb; v_old text; v_new text; n int;
begin
  select contract_no into v_old from ops_hr.employment_contracts where status = 'active';

  a := ops_hr.register_contract('B-0012','PKWTT','2027-01-01', null,
                                'bbbb5800-0000-0000-0000-0000000000f2','sha-karjo-2');
  v_new := a -> 'data' ->> 'contract_no';
  perform ops_hr.confirm_clause(v_new,'gaji_pokok','Upah pokok Rp 200.000 per hari.', 1,
                                '{"amount":"200000","per":"day"}'::jsonb);
  perform ops_hr.confirm_clause(v_new,'tunjangan','Tunjangan Rp 20.000 per hari.', 1,
                                '{"amount":"20000","per":"day"}'::jsonb);
  perform ops_hr.confirm_clause(v_new,'jam_kerja','Jam kerja tetap.', 2,
                                '{"schedule_code":"produksi"}'::jsonb);
  perform ops_hr.confirm_clause(v_new,'cuti','Cuti 12 hari.', 3, '{"days":"12"}'::jsonb);
  perform ops_hr.confirm_clause(v_new,'jangka_waktu','Tanpa batas waktu.', 1,
                                '{"kind":"PKWTT"}'::jsonb);
  perform ops_hr.confirm_clause(v_new,'masa_percobaan','Tidak ada masa percobaan.', 1,
                                '{"months":"0"}'::jsonb);
  perform ops_hr.confirm_clause(v_new,'keterlambatan','Tidak ada potongan keterlambatan.', 2,
                                '{"mode":"manual"}'::jsonb);
  perform ops_hr.confirm_clause(v_new,'potongan','Tidak ada.', 2, '{"mode":"off"}'::jsonb);
  perform ops_hr.confirm_clause(v_new,'lembur','Sesuai ketentuan pemerintah.', 2,
                                '{"mode":"statutory"}'::jsonb);
  perform ops_hr.confirm_clause(v_new,'pemutusan','Tiga puluh hari.', 4, null);

  a := ops_hr.activate_contract(v_new);
  assert ops_core.said_ok(a), 'got ' || coalesce(a -> 'error' ->> 'code', a::text);
  assert a -> 'data' ->> 'supersedes' = v_old, 'got ' || coalesce(a -> 'data' ->> 'supersedes','(null)');

  -- Yang lama tidak dihapus: slip gaji bulan Maret dihitung di bawah kontrak
  -- yang berlaku bulan Maret (A5).
  assert (select status from ops_hr.employment_contracts where contract_no = v_old) = 'superseded';
  assert (select superseded_by from ops_hr.employment_contracts where contract_no = v_old) = v_new;
  -- Tiga baris: yang digantikan, yang menggantikan, dan draft tanpa kertas yang
  -- gagal diberlakukan tadi — yang juga tidak dihapus.
  select count(*) into n from ops_hr.employment_contracts;
  assert n = 3, 'got ' || n;
  -- Dan satu orang punya satu kontrak yang berlaku.
  select count(*) into n from ops_hr.employment_contracts where status = 'active';
  assert n = 1, 'got ' || n;

  -- Selisih dibaca dari yang berlaku saja: kertas lama tidak lagi mengatakan
  -- apa pun tentang apa yang dibayarkan hari ini.
  select count(*) into n from ops_hr.contract_conflicts() where differs;
  assert n = 1, 'sekarang tinggal gaji, yang naik di kertas dan belum di sistem, got ' || n;
end $$;

/* ── REFUSAL dan DERIVATION: mengakhirinya ──────────────────────────────── */
do $$
declare a jsonb; v_no text;
begin
  select contract_no into v_no from ops_hr.employment_contracts where status = 'active';
  a := ops_hr.end_contract(v_no, current_date,'  ');
  assert a -> 'error' ->> 'code' = 'reason_required', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');

  a := ops_hr.end_contract(v_no, current_date,'mengundurkan diri','k-58-end');
  assert ops_core.said_ok(a), 'got ' || coalesce(a -> 'error' ->> 'code', a::text);
  assert (select status from ops_hr.employment_contracts where contract_no = v_no) = 'ended';

  -- Yang sudah berakhir tidak diakhiri lagi.
  a := ops_hr.end_contract(v_no, current_date,'lagi');
  assert a -> 'error' ->> 'code' = 'not_active', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');
end $$;

/* ── REFUSAL: kontrak adalah milik HRD ──────────────────────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000005803';
do $$
declare n int;
begin
  -- IT boleh menambah poin wajib ke daftarnya dan tidak boleh membaca isi
  -- perjanjian siapa pun. Kalimat di dalam kutipan sering menyebut hal yang
  -- bukan urusan siapa-siapa selain HRD.
  -- Tabelnya langsung, bukan hanya viewnya. `v_contract` menyambung ke
  -- `employees`, yang punya kebijakannya sendiri — jadi view itu kosong untuk
  -- IT bahkan seandainya kebijakan kontraknya dicabut. Aman karena kebetulan
  -- adalah bentuk yang sama dengan `v_po_detail` di `0037`, dan yang diuji di
  -- sini adalah kebijakan yang benar-benar menjaganya.
  select count(*) into n from ops_hr.employment_contracts;
  assert n = 0, 'got ' || n;
  select count(*) into n from ops_hr.v_contract;
  assert n = 0, 'got ' || n;
  select count(*) into n from ops_hr.contract_clauses;
  assert n = 0, 'got ' || n;
end $$;

/* ── REFUSAL: grant baca melihat, tidak menulis ─────────────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000005802';
do $$
declare a jsonb; n int; v_no text;
begin
  select contract_no into v_no from ops_hr.employment_contracts limit 1;
  select count(*) into n from ops_hr.v_contract;
  assert n = 3, 'pembaca HRD melihat semuanya, got ' || n;

  a := ops_hr.propose_clause(v_no,'lainnya','x');
  assert a -> 'error' ->> 'code' = 'not_permitted', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');
  a := ops_hr.confirm_clause(v_no,'lainnya','x');
  assert a -> 'error' ->> 'code' = 'not_permitted', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');
  a := ops_hr.activate_contract(v_no);
  assert a -> 'error' ->> 'code' = 'not_permitted', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');
  a := ops_hr.end_contract(v_no, current_date,'x');
  assert a -> 'error' ->> 'code' = 'not_permitted', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');
end $$;

rollback;
