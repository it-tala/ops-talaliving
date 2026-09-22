-- 0058_hr_contracts.sql — kontrak kerja: dokumennya, klausul wajibnya, dan
-- selisihnya terhadap apa yang benar-benar dijalankan sistem.
--
-- HRD yang membuat kontraknya — di Word, di atas kop surat, ditandatangani di
-- kertas. Yang tidak ada sampai sekarang adalah jawaban atas *apa isinya*, dan
-- itulah yang hilang setiap kali orang HRD berganti: empat puluh PDF di Drive
-- dan tidak satu pun pertanyaan yang bisa dijawab tanpa membukanya satu per satu.
--
-- ## Kontrak diperiksa TERHADAP sistem, bukan dimuat KE DALAM sistem
--
-- Angkanya sudah punya rumah. Gaji pokok, tunjangan, jam per hari dan jatah
-- cuti ada di `employees`; keterlambatan, potongan dan lembur ada di buku
-- aturan bertanggal `pay_rule_sets` (D173). Menyalinnya ke sini akan membuat
-- dua angka untuk satu hal, dan revisi pertama membuat keduanya berbeda tanpa
-- ada yang mengatakannya (A3).
--
-- Jadi klausul **tidak menulis apa pun**. `contract_conflicts()` membandingkan
-- yang tertulis di kontrak dengan yang dijalankan hari ini dan melaporkan
-- selisihnya. Menerapkannya adalah keputusan seseorang, lewat `save_employee`
-- yang sudah ada — satu jalan, satu baris audit yang berbunyi *upah berubah*,
-- karena memang itu yang terjadi (D155).
--
-- ## Klausul kebijakan tidak boleh diam-diam mengubah aturan orang lain
--
-- Klausul per orang — gaji, tunjangan, cuti, jadwal — adalah tentang satu
-- orang. Klausul kebijakan — keterlambatan, potongan, lembur — mengutip aturan
-- yang berlaku untuk **semua orang**. Satu kontrak yang menyebut aturan lembur
-- berbeda bukan pengecualian yang boleh dijalankan; itu selisih yang harus
-- dibaca seseorang. Keduanya dilaporkan, tidak satu pun diterapkan sendiri.
--
-- ## Yang dibaca mesin adalah usulan, bukan syarat
--
-- Tahap ini tidak memanggil model apa pun — HRD mengetik klausulnya sendiri,
-- dan seluruh nilai *HRD berganti* serta *dasaran KPI* sudah didapat dari situ.
-- Yang disiapkan adalah **bentuknya**: `propose_clause` menulis dengan
-- `source = 'extracted'` dan tidak pernah terkonfirmasi, `confirm_clause`
-- adalah tanda tangan orang di atasnya, dan **usulan mesin tidak boleh menimpa
-- jawaban orang**. Kosakata `extracted | typed | pending` bukan baru: itu yang
-- sudah dipakai `0056` untuk asal nomor dokumen, dan artinya sama (F57).
--
-- Satu kolom yang terlihat sepele dan tidak: **`quote`**. Setiap klausul
-- membawa kalimat aslinya. Angka tanpa kalimat di belakangnya adalah angka
-- yang tidak bisa dibantah di meja, dan nanti — ketika mesin yang membacanya —
-- kutipan itu yang bisa kita **buktikan ada** di dokumennya sebelum disimpan.

insert into ops_core.doc_prefixes (prefix, what) values ('kkj', 'kontrak kerja');

-- ── kosakata ──────────────────────────────────────────────────────────────
create type ops_hr.contract_kind_t as enum ('PKWT','PKWTT');

-- draft → active → superseded/ended, dan tidak pernah mundur.
create type ops_hr.contract_status_t as enum ('draft','active','superseded','ended');

-- Poin yang wajib ada di tiap kontrak, dan yang boleh ada. **Enum, bukan teks
-- bebas**, supaya *berapa kontrak yang tidak menyebut aturan lembur* adalah
-- satu hitungan dan bukan pencarian kata.
create type ops_hr.clause_kind_t as enum (
  'gaji_pokok','tunjangan','jam_kerja','cuti','jangka_waktu','masa_percobaan',
  'keterlambatan','potongan','lembur','pemutusan',
  'bpjs','kerahasiaan','fasilitas','penempatan','lainnya');

-- ── daftar wajibnya adalah data ───────────────────────────────────────────
--
-- Sama seperti `EMPLOYEE_DOC_CHECKLIST` di berkas 201: menambah satu poin
-- wajib membuat setiap kontrak yang belum menyebutnya melaporkan itu hari yang
-- sama, tanpa ada yang perlu di-backfill. Kalau daftar ini hidup di kode, ia
-- hanya benar sampai orang berikutnya lupa memperbaruinya.
create table ops_hr.clause_checklist (
  kind      ops_hr.clause_kind_t primary key,
  required  boolean not null,
  -- Kenapa poin ini ditanyakan. Tercetak di layar di sebelah namanya.
  what      text not null,
  -- Di mana jawabannya bermuara, kalau ada. Null berarti klausul ini disimpan
  -- sebagai catatan dan tidak dibandingkan dengan apa pun.
  bears_on  text,
  sort      int not null
);

insert into ops_hr.clause_checklist (kind, required, what, bears_on, sort) values
  ('gaji_pokok',     true,  'Upah pokok dan satuannya — bulanan, harian atau per jam.', 'employees.base_rate', 1),
  ('tunjangan',      true,  'Tunjangan dan satuannya. Nol pun harus disebut, supaya jelas memang tidak ada.', 'employees.allowance_rate', 2),
  ('jam_kerja',      true,  'Jam masuk, jam pulang, dan berapa hari seminggu.', 'employees.schedule_code', 3),
  ('cuti',           true,  'Berapa hari cuti berbayar setahun.', 'employees.paid_leave_days', 4),
  ('jangka_waktu',   true,  'PKWT dengan tanggal berakhirnya, atau PKWTT.', 'employment_contracts.kind', 5),
  ('masa_percobaan', true,  'Berapa lama, dan apa yang berlaku selama itu.', null, 6),
  ('keterlambatan',  true,  'Ada potongan atau tidak, dan bagaimana dihitung.', 'pay_rule_sets.late_mode', 7),
  ('potongan',       true,  'Apa saja yang boleh dipotong dari upah.', 'pay_rule_sets.undertime_mode', 8),
  ('lembur',         true,  'Bagaimana lembur dihitung dan siapa yang menyetujui.', 'pay_rule_sets.workday_tiers', 9),
  ('pemutusan',      true,  'Pemberitahuan dan tata caranya.', null, 10),
  ('bpjs',           false, 'Kepesertaan dan siapa menanggung apa.', null, 11),
  ('kerahasiaan',    false, '', null, 12),
  ('fasilitas',      false, 'Kendaraan, mes, makan.', null, 13),
  ('penempatan',     false, 'Lokasi kerja dan apakah bisa dipindah.', null, 14),
  ('lainnya',        false, 'Yang tidak masuk mana pun di atas.', null, 15);

-- ── kontraknya ────────────────────────────────────────────────────────────
create table ops_hr.employment_contracts (
  id             uuid primary key default gen_random_uuid(),
  contract_no    text not null unique default ops_core.next_doc_number('kkj'),
  employee_id    uuid not null references ops_hr.employees(id),
  kind           ops_hr.contract_kind_t not null,
  effective_from date not null,
  -- PKWT berakhir; PKWTT tidak. Bukan dua kolom yang kebetulan sejalan —
  -- kontrak tanpa waktu yang punya tanggal berakhir adalah dokumen yang
  -- membantah dirinya sendiri.
  ends_on        date,
  -- Kertas yang ditandatangani, di jalur bukti seperti setiap dokumen lain
  -- (ADR-010). Yang disimpan adalah **tautannya**, bukan berkasnya: apakah ini
  -- masih kontraknya dijawab di satu tempat (A3).
  link_id        uuid references ops_core.attachment_links(id),
  -- Dipaku ke berkas itu. PDF baru berarti bacaan yang lama tidak lagi berlaku,
  -- dan ini yang membuat pernyataan itu bisa diperiksa, bukan dipercaya.
  sha256         text,
  status         ops_hr.contract_status_t not null default 'draft',
  activated_by   uuid references ops_core.users(id),
  activated_at   timestamptz,
  -- Kontrak berikutnya yang menggantikan ini. Yang lama tidak dihapus: slip
  -- gaji bulan Maret dihitung di bawah kontrak yang berlaku bulan Maret (A5).
  superseded_by  text references ops_hr.employment_contracts(contract_no),
  ended_on       date,
  ended_reason   text,
  note           text,
  created_by     uuid references ops_core.users(id),
  created_at     timestamptz not null default now(),

  constraint pkwtt_has_no_end check (kind <> 'PKWTT' or ends_on is null),
  constraint pkwt_has_an_end  check (kind <> 'PKWT'  or ends_on is not null),
  constraint ends_after_it_starts check (ends_on is null or ends_on >= effective_from),
  constraint activation_is_signed check ((activated_at is null) = (activated_by is null)),
  constraint active_is_activated  check (status = 'draft' or activated_at is not null),
  constraint ending_says_why check (
    (ended_on is null and ended_reason is null)
    or (ended_on is not null and ended_reason is not null and length(btrim(ended_reason)) > 0))
);

create index contracts_employee_idx on ops_hr.employment_contracts (employee_id, effective_from desc);

-- **Satu kontrak berlaku sekali.** Dua kontrak aktif untuk satu orang berarti
-- dua jawaban untuk *berapa upahnya*, dan yang menjawab adalah urutan baris.
create unique index contract_one_active_idx
  on ops_hr.employment_contracts (employee_id) where status = 'active';

-- ── klausulnya ────────────────────────────────────────────────────────────
--
-- Satu baris per (kontrak, jenis). Satu jenis adalah **jawaban atas satu
-- pertanyaan** — *bagaimana lembur dihitung* — dan dua jawaban di satu dokumen
-- adalah pertentangan yang diselesaikan waktu dikonfirmasi, bukan disimpan
-- berdampingan. Kalau kertasnya menyebutnya di tiga paragraf, `quote`
-- memuat ketiganya.
create table ops_hr.contract_clauses (
  id            uuid primary key default gen_random_uuid(),
  contract_no   text not null references ops_hr.employment_contracts(contract_no),
  kind          ops_hr.clause_kind_t not null,
  -- Kalimat aslinya, apa adanya. Angka tanpa kalimat di belakangnya adalah
  -- angka yang tidak bisa dibantah di meja.
  quote         text not null check (length(btrim(quote)) > 0),
  page          int check (page is null or page > 0),
  -- Bacaan terstrukturnya. Bentuknya ditentukan per jenis oleh
  -- `clause_value_ok()` di bawah — sebuah jsonb tanpa aturan hanya memindahkan
  -- masalahnya ke layar.
  value         jsonb,
  source        ops_hr.doc_no_source_t not null,
  proposed_by   uuid references ops_core.users(id),
  proposed_at   timestamptz not null default now(),
  confirmed_by  uuid references ops_core.users(id),
  confirmed_at  timestamptz,

  constraint clause_once unique (contract_no, kind),
  constraint confirmation_is_signed check ((confirmed_at is null) = (confirmed_by is null)),
  -- Bacaan mesin tidak pernah lahir dalam keadaan terkonfirmasi. Yang
  -- mengonfirmasi adalah orang, dan itu perbuatan tersendiri.
  constraint extracted_is_not_confirmed_by_itself check (
    confirmed_at is null or source <> 'pending')
);

-- ── bentuk yang wajib dibawa tiap jenis ───────────────────────────────────
--
-- Ini yang membuat *poin wajib* bisa ditegakkan dan bukan sekadar kebiasaan.
-- Nilainya juga harus **memakai kosakata yang sama dengan buku aturan** —
-- `pro_rata`, `half_day_step` — kalau tidak, perbandingannya nanti hanya
-- membandingkan dua ejaan.
create or replace function ops_hr.clause_value_ok(
  p_kind ops_hr.clause_kind_t, p_value jsonb)
returns boolean language sql immutable as $$
  -- `coalesce(..., false)` bukan hiasan. `null ->> 'per' in (...)` adalah NULL,
  -- `not NULL` adalah NULL, dan sebuah `if` atas NULL tidak pernah menyala —
  -- jadi tanpa ini seluruh pemeriksaan bentuk di atas diam-diam meloloskan
  -- bacaan yang setengah kosong, yang persis kebalikan dari gunanya.
  select coalesce(case p_kind
    when 'gaji_pokok' then
      (p_value ->> 'amount') ~ '^[0-9]+$' and (p_value ->> 'amount')::numeric > 0
      and p_value ->> 'per' in ('month','day','hour')
    when 'tunjangan' then
      (p_value ->> 'amount') ~ '^[0-9]+$'
      and p_value ->> 'per' in ('day','month')
    when 'cuti' then
      (p_value ->> 'days') ~ '^[0-9]+$'
    when 'masa_percobaan' then
      (p_value ->> 'months') ~ '^[0-9]+$'
    when 'jangka_waktu' then
      p_value ->> 'kind' in ('PKWT','PKWTT')
    when 'jam_kerja' then
      coalesce(p_value ->> 'schedule_code', '') <> ''
    when 'keterlambatan' then
      p_value ->> 'mode' in ('none','manual','pro_rata')
    when 'potongan' then
      p_value ->> 'mode' in ('off','hourly','half_day_step')
    when 'lembur' then
      p_value ->> 'mode' in ('none','statutory','flat')
    -- Sisanya disimpan sebagai kalimat. Memaksa bentuk pada *kerahasiaan*
    -- berarti mengarang bentuk, dan bentuk karangan adalah yang diisi
    -- asal-asalan supaya tombolnya menyala.
    else true end, false)
$$;

alter table ops_hr.contract_clauses
  add constraint value_fits_the_kind check (ops_hr.clause_value_ok(kind, value));

-- ── mendaftarkan kontraknya ───────────────────────────────────────────────
--
-- Kertasnya boleh menyusul: sebuah kontrak yang sudah disepakati tapi PDF-nya
-- belum dipindai tetap perlu dicatat, dan itulah gunanya `draft`. Yang tidak
-- boleh adalah **diaktifkan** tanpa kertasnya.
create or replace function ops_hr.register_contract(
  p_employee_no    text,
  p_kind           ops_hr.contract_kind_t,
  p_effective_from date,
  p_ends_on        date default null,
  p_attachment_id  uuid default null,
  p_sha256         text default null,
  p_note           text default null,
  p_key            text default null)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare
  v_replayed jsonb; v_emp ops_hr.employees; v_no text; v_link uuid;
  v_linked jsonb; v_res jsonb;
begin
  v_replayed := ops_core.idem_replay('hr','register_contract', p_key);
  if v_replayed is not null then return v_replayed; end if;

  if not ops_core.has_permission('hrd.create') then
    return ops_core.refused('hr','contract', null,'register',
      'not_permitted','Mendaftarkan kontrak butuh akses HRD.');
  end if;

  select e.* into v_emp from ops_hr.employees e where e.employee_no = p_employee_no;
  if not found then
    return ops_core.not_found('hr','contract', null,'register',
      format('Tidak ada karyawan %s.', p_employee_no));
  end if;

  if p_kind = 'PKWT' and p_ends_on is null then
    return ops_core.invalid('hr','contract', null,'register',
      'end_date_required',
      'PKWT selalu punya tanggal berakhir. Kalau tidak ada, yang dibuat adalah PKWTT.',
      jsonb_build_object('field','ends_on'));
  end if;
  if p_kind = 'PKWTT' and p_ends_on is not null then
    return ops_core.invalid('hr','contract', null,'register',
      'end_date_not_allowed',
      'PKWTT tidak punya tanggal berakhir. Kontrak tanpa waktu yang berakhir membantah dirinya sendiri.',
      jsonb_build_object('field','ends_on'));
  end if;
  if p_ends_on is not null and p_ends_on < p_effective_from then
    return ops_core.invalid('hr','contract', null,'register',
      'period_invalid','Berakhir sebelum mulai berlaku.',
      jsonb_build_object('field','ends_on'));
  end if;

  -- Satu jalan untuk berkas: seam dokumen yang memilikinya (ADR-010), sama
  -- seperti `file_employee_document` di `0056`.
  if p_attachment_id is not null then
    v_linked := ops_core.attach_link(p_attachment_id,'employee', p_employee_no,'kontrak_kerja');
    if not ops_core.said_ok(v_linked) then return v_linked; end if;
    select id into v_link from ops_core.attachment_links
     where attachment_id = p_attachment_id and entity = 'employee'
       and entity_no = p_employee_no and kind = 'kontrak_kerja' and unlinked_at is null;
  end if;

  insert into ops_hr.employment_contracts
    (employee_id, kind, effective_from, ends_on, link_id, sha256, note, created_by)
  values (v_emp.id, p_kind, p_effective_from, p_ends_on, v_link,
          nullif(btrim(coalesce(p_sha256,'')), ''),
          nullif(btrim(coalesce(p_note,'')), ''), auth.uid())
  returning contract_no into v_no;

  v_res := ops_core.ok('hr','contract', v_no,'register',
    jsonb_build_object('contract_no', v_no, 'employee_no', p_employee_no,
                       'kind', p_kind, 'effective_from', p_effective_from,
                       'ends_on', p_ends_on, 'status','draft',
                       'attached', p_attachment_id is not null));
  return ops_core.idem_remember('hr','register_contract', p_key, v_res);
end $$;

-- ── mengusulkan sebuah klausul ────────────────────────────────────────────
--
-- Jalan untuk mesin, dan hari ini belum ada mesinnya — yang ada adalah
-- bentuknya. Dua sifat yang membuatnya aman dipakai nanti: usulan **tidak
-- pernah lahir terkonfirmasi**, dan usulan **tidak boleh menimpa jawaban
-- orang**. Membaca ulang dokumen yang sama besok boleh mengganti usulan
-- kemarin; ia tidak boleh mengganti tanda tangan.
create or replace function ops_hr.propose_clause(
  p_contract_no text,
  p_kind        ops_hr.clause_kind_t,
  p_quote       text,
  p_page        int default null,
  p_value       jsonb default null,
  p_key         text default null)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare v_replayed jsonb; v_c ops_hr.employment_contracts; v_old ops_hr.contract_clauses; v_res jsonb;
begin
  v_replayed := ops_core.idem_replay('hr','propose_clause', p_key);
  if v_replayed is not null then return v_replayed; end if;

  if not ops_core.has_permission('hrd.create') then
    return ops_core.refused('hr','contract_clause', p_contract_no,'propose',
      'not_permitted','Menulis klausul butuh akses HRD.');
  end if;

  select c.* into v_c from ops_hr.employment_contracts c where c.contract_no = p_contract_no;
  if not found then
    return ops_core.not_found('hr','contract_clause', p_contract_no,'propose',
      format('Tidak ada kontrak %s.', p_contract_no));
  end if;

  if coalesce(btrim(coalesce(p_quote,'')), '') = '' then
    return ops_core.invalid('hr','contract_clause', p_contract_no,'propose',
      'quote_required',
      'Klausul tanpa kalimat aslinya adalah angka yang tidak bisa dibantah di meja.',
      jsonb_build_object('field','quote'));
  end if;
  if not ops_hr.clause_value_ok(p_kind, p_value) then
    return ops_core.invalid('hr','contract_clause', p_contract_no,'propose',
      'value_shape',
      format('Bacaan untuk %s tidak berbentuk seperti yang diminta jenisnya.', p_kind),
      jsonb_build_object('field','value','kind', p_kind));
  end if;

  select cl.* into v_old from ops_hr.contract_clauses cl
   where cl.contract_no = p_contract_no and cl.kind = p_kind;
  if found and v_old.confirmed_at is not null then
    return ops_core.conflict('hr','contract_clause', p_contract_no,'propose',
      'already_confirmed',
      format('%s sudah dikonfirmasi orang. Bacaan mesin tidak menimpa tanda tangan.', p_kind));
  end if;

  insert into ops_hr.contract_clauses
    (contract_no, kind, quote, page, value, source, proposed_by)
  values (p_contract_no, p_kind, btrim(p_quote), p_page, p_value,'extracted', auth.uid())
  on conflict (contract_no, kind) do update
    set quote = excluded.quote, page = excluded.page, value = excluded.value,
        source = 'extracted', proposed_by = excluded.proposed_by, proposed_at = now();

  v_res := ops_core.ok('hr','contract_clause', p_contract_no,'propose',
    jsonb_build_object('contract_no', p_contract_no, 'kind', p_kind,
                       'confirmed', false, 'source','extracted'));
  return ops_core.idem_remember('hr','propose_clause', p_key, v_res);
end $$;

-- ── mengonfirmasinya ──────────────────────────────────────────────────────
--
-- Jalan untuk orang, dan satu-satunya jalan yang menghasilkan klausul yang
-- dipercaya laporan mana pun. HRD bisa memakainya tanpa ada usulan sama sekali
-- — itu yang terjadi hari ini.
--
-- `source` disimpulkan, tidak diminta: kalau kalimat dan bacaannya sama persis
-- dengan yang diusulkan mesin, ini **`extracted`** — orangnya setuju; kalau
-- diubah, ini **`typed`**. Nanti, *berapa persen bacaan mesin yang diterima
-- apa adanya* adalah satu hitungan atas kolom ini dan bukan tebakan tentang
-- kualitas parsernya.
create or replace function ops_hr.confirm_clause(
  p_contract_no text,
  p_kind        ops_hr.clause_kind_t,
  p_quote       text,
  p_page        int default null,
  p_value       jsonb default null,
  p_key         text default null)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare
  v_replayed jsonb; v_c ops_hr.employment_contracts; v_old ops_hr.contract_clauses;
  v_source ops_hr.doc_no_source_t; v_res jsonb;
begin
  v_replayed := ops_core.idem_replay('hr','confirm_clause', p_key);
  if v_replayed is not null then return v_replayed; end if;

  if not ops_core.has_permission('hrd.update') then
    return ops_core.refused('hr','contract_clause', p_contract_no,'confirm',
      'not_permitted','Mengonfirmasi klausul butuh akses HRD.');
  end if;

  select c.* into v_c from ops_hr.employment_contracts c where c.contract_no = p_contract_no;
  if not found then
    return ops_core.not_found('hr','contract_clause', p_contract_no,'confirm',
      format('Tidak ada kontrak %s.', p_contract_no));
  end if;

  if coalesce(btrim(coalesce(p_quote,'')), '') = '' then
    return ops_core.invalid('hr','contract_clause', p_contract_no,'confirm',
      'quote_required','Kalimat aslinya dari kontrak — itu yang dibaca orang berikutnya.',
      jsonb_build_object('field','quote'));
  end if;
  if not ops_hr.clause_value_ok(p_kind, p_value) then
    return ops_core.invalid('hr','contract_clause', p_contract_no,'confirm',
      'value_shape',
      format('Bacaan untuk %s tidak berbentuk seperti yang diminta jenisnya.', p_kind),
      jsonb_build_object('field','value','kind', p_kind));
  end if;

  select cl.* into v_old from ops_hr.contract_clauses cl
   where cl.contract_no = p_contract_no and cl.kind = p_kind;

  -- **Kontrak yang berjalan boleh dilengkapi, tidak boleh diubah.** Mengisi
  -- poin yang belum pernah dijawab bukan menyunting kesepakatan — itu mencatat
  -- apa yang memang sudah tertulis di kertasnya, dan tanpa jalan ini empat
  -- puluh kontrak lama tidak akan pernah bisa dilengkapi. Mengubah jawaban
  -- yang sudah ditandatangani adalah hal lain: itu kontrak baru yang
  -- menggantikannya, aturan yang sama dengan run gaji yang sudah disetujui.
  if v_c.status <> 'draft' and found and v_old.confirmed_at is not null then
    return ops_core.conflict('hr','contract_clause', p_contract_no,'confirm',
      'already_confirmed',
      format('%s sudah %s dan %s sudah dijawab. Syarat yang berubah adalah kontrak baru, '
             'bukan suntingan atas yang lama.', p_contract_no, v_c.status, p_kind));
  end if;

  v_source := case
    when found and v_old.source = 'extracted'
         and v_old.quote = btrim(p_quote)
         and v_old.value is not distinct from p_value
      then 'extracted'      -- orangnya menerima bacaan mesin apa adanya
    else 'typed' end;

  insert into ops_hr.contract_clauses
    (contract_no, kind, quote, page, value, source, proposed_by, confirmed_by, confirmed_at)
  values (p_contract_no, p_kind, btrim(p_quote), p_page, p_value, v_source,
          coalesce(v_old.proposed_by, auth.uid()), auth.uid(), now())
  on conflict (contract_no, kind) do update
    set quote = excluded.quote, page = excluded.page, value = excluded.value,
        source = excluded.source, confirmed_by = excluded.confirmed_by,
        confirmed_at = excluded.confirmed_at;

  v_res := ops_core.ok('hr','contract_clause', p_contract_no,'confirm',
    jsonb_build_object('contract_no', p_contract_no, 'kind', p_kind,
                       'confirmed', true, 'source', v_source),
    case when v_old.contract_no is null then null
         else jsonb_build_object('confirmed', v_old.confirmed_at is not null,
                                 'source', v_old.source) end,
    jsonb_build_object('confirmed', true, 'source', v_source));
  return ops_core.idem_remember('hr','confirm_clause', p_key, v_res);
end $$;

-- ── mengaktifkan, menggantikan, mengakhiri ────────────────────────────────
create or replace function ops_hr.activate_contract(
  p_contract_no text, p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare
  v_replayed jsonb; v_c ops_hr.employment_contracts; v_missing text[];
  v_prev text; v_res jsonb;
begin
  v_replayed := ops_core.idem_replay('hr','activate_contract', p_key);
  if v_replayed is not null then return v_replayed; end if;

  if not ops_core.has_permission('hrd.update') then
    return ops_core.refused('hr','contract', p_contract_no,'activate',
      'not_permitted','Memberlakukan kontrak butuh akses HRD.');
  end if;

  select c.* into v_c from ops_hr.employment_contracts c where c.contract_no = p_contract_no;
  if not found then
    return ops_core.not_found('hr','contract', p_contract_no,'activate',
      format('Tidak ada kontrak %s.', p_contract_no));
  end if;
  if v_c.status <> 'draft' then
    return ops_core.conflict('hr','contract', p_contract_no,'activate',
      'already_decided', format('%s sudah %s.', p_contract_no, v_c.status));
  end if;

  -- **Kertasnya dulu.** Kontrak yang berlaku tanpa berkas yang ditandatangani
  -- adalah kesepakatan lisan dengan nomor dokumen di depannya.
  if v_c.link_id is null
     or not exists (select 1 from ops_core.attachment_links l
                     where l.id = v_c.link_id and l.unlinked_at is null) then
    return ops_core.invalid('hr','contract', p_contract_no,'activate',
      'paper_required',
      'Berkas yang ditandatangani belum terlampir. Tanpa kertasnya, yang diberlakukan hanya catatan.',
      jsonb_build_object('field','attachment_id'));
  end if;

  -- Poin wajib yang belum dijawab, **disebut namanya**. Jumlah saja membuat
  -- orang menebak mana yang kurang; daftar membuatnya satu pekerjaan.
  select array_agg(k.kind::text order by k.sort) into v_missing
    from ops_hr.clause_checklist k
   where k.required
     and not exists (select 1 from ops_hr.contract_clauses cl
                      where cl.contract_no = p_contract_no and cl.kind = k.kind
                        and cl.confirmed_at is not null);
  if v_missing is not null then
    return ops_core.invalid('hr','contract', p_contract_no,'activate',
      'clauses_missing',
      format('Belum terkonfirmasi: %s. Kontrak yang berlaku tanpa poin wajibnya adalah '
             'kontrak yang tidak bisa dijawab waktu ditanya.', array_to_string(v_missing, ', ')),
      jsonb_build_object('field','clauses','missing', to_jsonb(v_missing)));
  end if;

  -- Yang sebelumnya digantikan, tidak dihapus: slip gaji bulan Maret dihitung
  -- di bawah kontrak yang berlaku bulan Maret (A5).
  select c.contract_no into v_prev from ops_hr.employment_contracts c
   where c.employee_id = v_c.employee_id and c.status = 'active';
  if v_prev is not null then
    update ops_hr.employment_contracts
       set status = 'superseded', superseded_by = p_contract_no
     where contract_no = v_prev;
  end if;

  update ops_hr.employment_contracts
     set status = 'active', activated_by = auth.uid(), activated_at = now()
   where contract_no = p_contract_no;

  v_res := ops_core.ok('hr','contract', p_contract_no,'activate',
    jsonb_build_object('contract_no', p_contract_no, 'status','active',
                       'supersedes', v_prev,
                       -- Selisih terhadap yang benar-benar dijalankan, dihitung
                       -- di sini supaya layarnya tidak perlu bertanya lagi.
                       -- **Tidak satu pun diterapkan**: memberlakukan kontrak
                       -- adalah satu perbuatan, mengubah upah adalah perbuatan
                       -- lain dengan jejaknya sendiri (D155).
                       'conflicts', (select count(*) from ops_hr.contract_conflicts(p_contract_no)
                                      where differs)),
    jsonb_build_object('status', v_c.status),
    jsonb_build_object('status','active'));
  return ops_core.idem_remember('hr','activate_contract', p_key, v_res);
end $$;

create or replace function ops_hr.end_contract(
  p_contract_no text, p_ended_on date, p_reason text, p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare v_replayed jsonb; v_c ops_hr.employment_contracts; v_res jsonb;
begin
  v_replayed := ops_core.idem_replay('hr','end_contract', p_key);
  if v_replayed is not null then return v_replayed; end if;

  if not ops_core.has_permission('hrd.update') then
    return ops_core.refused('hr','contract', p_contract_no,'end',
      'not_permitted','Mengakhiri kontrak butuh akses HRD.');
  end if;

  select c.* into v_c from ops_hr.employment_contracts c where c.contract_no = p_contract_no;
  if not found then
    return ops_core.not_found('hr','contract', p_contract_no,'end',
      format('Tidak ada kontrak %s.', p_contract_no));
  end if;
  if v_c.status <> 'active' then
    return ops_core.conflict('hr','contract', p_contract_no,'end',
      'not_active', format('%s sedang %s, bukan berjalan.', p_contract_no, v_c.status));
  end if;
  if coalesce(btrim(coalesce(p_reason,'')), '') = '' then
    return ops_core.invalid('hr','contract', p_contract_no,'end',
      'reason_required',
      'Kenapa berakhir — habis masa, mengundurkan diri, diakhiri. Itu yang ditanyakan enam bulan lagi.',
      jsonb_build_object('field','reason'));
  end if;

  update ops_hr.employment_contracts
     set status = 'ended', ended_on = p_ended_on, ended_reason = btrim(p_reason)
   where contract_no = p_contract_no;

  v_res := ops_core.ok('hr','contract', p_contract_no,'end',
    jsonb_build_object('contract_no', p_contract_no, 'status','ended', 'ended_on', p_ended_on),
    jsonb_build_object('status','active'), jsonb_build_object('status','ended'));
  return ops_core.idem_remember('hr','end_contract', p_key, v_res);
end $$;

-- ── apa yang belum dijawab ────────────────────────────────────────────────
--
-- Pertanyaan pertama orang HRD yang baru masuk: berkas mana yang belum
-- lengkap, dan apa yang kurang. Dihitung, tidak dicatat — menambah poin wajib
-- ke `clause_checklist` membuat setiap kontrak melaporkannya hari itu juga.
create type ops_hr.clause_coverage_row as (
  contract_no  text,
  employee_no  text,
  full_name    text,
  status       ops_hr.contract_status_t,
  kind         ops_hr.clause_kind_t,
  required     boolean,
  what         text,
  present      boolean,
  confirmed    boolean,
  source       ops_hr.doc_no_source_t
);

create or replace function ops_hr.contract_coverage(p_contract_no text default null)
returns setof ops_hr.clause_coverage_row
language sql stable set search_path = ops_hr, pg_temp as $$
  select
    c.contract_no, e.employee_no, e.full_name, c.status,
    k.kind, k.required, k.what,
    cl.contract_no is not null,
    cl.confirmed_at is not null,
    cl.source
  from ops_hr.employment_contracts c
  join ops_hr.employees e on e.id = c.employee_id
  cross join ops_hr.clause_checklist k
  left join ops_hr.contract_clauses cl
    on cl.contract_no = c.contract_no and cl.kind = k.kind
  where p_contract_no is null or c.contract_no = p_contract_no
  order by c.contract_no, k.sort
$$;


-- ── selisih terhadap yang benar-benar dijalankan ──────────────────────────
--
-- **Inilah alasan seluruh migrasi ini ada.** Bukan menyimpan isi kontrak —
-- menjawab *apakah yang tertulis sama dengan yang dibayarkan*. Jawaban itu
-- tidak pernah bisa diberikan siapa pun sebelum ini tanpa membuka empat puluh
-- PDF satu per satu.
--
-- Tidak ada yang diterapkan di sini. Klausul per orang dibandingkan dengan
-- baris karyawannya, klausul kebijakan dengan buku aturan yang berlaku, dan
-- yang berbeda dilaporkan **beserta kedua sisinya** supaya yang membacanya
-- tahu apa yang sedang ia putuskan (A6, D155).
create type ops_hr.clause_conflict_row as (
  contract_no  text,
  employee_no  text,
  full_name    text,
  kind         ops_hr.clause_kind_t,
  -- Apa yang dikatakan kertasnya, sebagai angka.
  says         text,
  -- Apa yang dijalankan sistem hari ini.
  runs         text,
  -- Ada yang bisa dibandingkan sama sekali. Sebuah klausul kerahasiaan tidak
  -- punya lawan di basis data, dan mengarang satu lebih buruk daripada
  -- mengatakan tidak ada.
  comparable   boolean,
  differs      boolean,
  bears_on     text,
  quote        text
);

create or replace function ops_hr.contract_conflicts(p_contract_no text default null)
returns setof ops_hr.clause_conflict_row
language sql stable set search_path = ops_hr, pg_temp as $$
  with live as (
    select c.contract_no, e.employee_no, e.full_name, e.id as employee_id,
           e.base_rate, e.pay_basis, e.allowance_rate, e.paid_leave_days,
           e.schedule_code, c.kind as contract_kind,
           ops_hr.rules_on(ops_core.office_day()) as rules
      from ops_hr.employment_contracts c
      join ops_hr.employees e on e.id = c.employee_id
     where c.status = 'active'
       and (p_contract_no is null or c.contract_no = p_contract_no)
  ),
  said as (
    select l.*, cl.kind, cl.value, cl.quote, k.bears_on
      from live l
      join ops_hr.contract_clauses cl on cl.contract_no = l.contract_no
      join ops_hr.clause_checklist k on k.kind = cl.kind
     -- Hanya yang sudah dikonfirmasi. Bacaan mesin yang belum ditandatangani
     -- siapa pun bukan dasar untuk mengatakan sistem salah.
     where cl.confirmed_at is not null
  ),
  compared as (
    select s.*,
      case s.kind
        when 'gaji_pokok'    then (s.value ->> 'amount') || ' / ' || (s.value ->> 'per')
        when 'tunjangan'     then (s.value ->> 'amount') || ' / ' || (s.value ->> 'per')
        when 'cuti'          then (s.value ->> 'days') || ' hari'
        when 'jam_kerja'     then s.value ->> 'schedule_code'
        when 'jangka_waktu'  then s.value ->> 'kind'
        when 'keterlambatan' then s.value ->> 'mode'
        when 'potongan'      then s.value ->> 'mode'
        when 'lembur'        then s.value ->> 'mode'
        end as says,
      case s.kind
        when 'gaji_pokok'    then s.base_rate::text || ' / ' ||
                                  (case s.pay_basis when 'monthly' then 'month'
                                                    when 'daily'   then 'day'
                                                    else 'hour' end)
        when 'tunjangan'     then s.allowance_rate::text || ' / day'
        when 'cuti'          then s.paid_leave_days::text || ' hari'
        when 'jam_kerja'     then s.schedule_code
        when 'jangka_waktu'  then s.contract_kind::text
        when 'keterlambatan' then s.value ->> 'mode'
        when 'potongan'      then coalesce(s.rules ->> 'undertime_mode', 'off')
        when 'lembur'        then coalesce(s.rules ->> 'overtime_mode', 'statutory')
        end as runs
    from said s
  )
  select
    c.contract_no, c.employee_no, c.full_name, c.kind,
    c.says, c.runs,
    c.says is not null,
    -- Sebuah klausul yang tidak bisa dibandingkan tidak pernah "berbeda":
    -- kedua sisinya null, dan `null is distinct from null` adalah false. Tidak
    -- ada penjaga tambahan di sini, karena penjaga yang tidak bisa gagal adalah
    -- penjaga yang tidak pernah diuji (F95).
    c.says is distinct from c.runs,
    c.bears_on, c.quote
  from compared c
  order by c.contract_no, c.kind
$$;

-- Satu baris per kontrak, untuk daftar di layar.
create or replace view ops_hr.v_contract as
select
  c.id,
  c.contract_no,
  c.employee_id,
  e.employee_no,
  e.full_name,
  c.kind,
  c.effective_from,
  c.ends_on,
  c.status,
  c.sha256,
  l.attachment_id,
  c.superseded_by,
  c.ended_on,
  c.ended_reason,
  c.note,
  -- Berapa hari lagi PKWT ini habis, dihitung dari hari kantor dan bukan dari
  -- tengah malam di peramban siapa pun (F17).
  case when c.ends_on is null then null
       else (c.ends_on - ops_core.office_day())::int end            as ends_in_days,
  -- Masa percobaan **diturunkan dari klausulnya**, bukan disimpan di kolom
  -- kedua: berapa bulan disebut di kertas, dan kapan berakhirnya adalah
  -- aritmetika atas tanggal mulainya (A3).
  case when pc.value ->> 'months' is null then null
       else (c.effective_from + ((pc.value ->> 'months')::int || ' months')::interval)::date end
                                                                     as probation_until,
  (select count(*) from ops_hr.clause_checklist k
    where k.required
      and not exists (select 1 from ops_hr.contract_clauses cl
                       where cl.contract_no = c.contract_no and cl.kind = k.kind
                         and cl.confirmed_at is not null))::int       as required_missing,
  (select count(*) from ops_hr.contract_clauses cl
    where cl.contract_no = c.contract_no and cl.confirmed_at is not null)::int as clauses_confirmed,
  (select count(*) from ops_hr.contract_clauses cl
    where cl.contract_no = c.contract_no and cl.confirmed_at is null)::int     as clauses_proposed,
  -- Berapa poin yang tertulis di kertas tidak sama dengan yang dijalankan
  -- sistem hari ini. Nol untuk kontrak yang belum berlaku: kertas yang belum
  -- diberlakukan tidak mengatakan apa pun tentang apa yang dibayarkan.
  (select count(*) from ops_hr.contract_conflicts(c.contract_no) f
    where f.differs)::int                                                      as conflict_count
from ops_hr.employment_contracts c
join ops_hr.employees e on e.id = c.employee_id
left join ops_core.attachment_links l on l.id = c.link_id and l.unlinked_at is null
left join ops_hr.contract_clauses pc
  on pc.contract_no = c.contract_no and pc.kind = 'masa_percobaan'
 and pc.confirmed_at is not null;

alter view ops_hr.v_contract set (security_invoker = on);

-- ── akses ─────────────────────────────────────────────────────────────────
alter table ops_hr.employment_contracts enable row level security;
alter table ops_hr.contract_clauses     enable row level security;
alter table ops_hr.clause_checklist     enable row level security;

-- Kontrak adalah milik HRD. Payroll membaca angkanya lewat baris karyawan,
-- bukan lewat kertas perjanjiannya — dan kalimat di dalam kutipan sering
-- menyebut hal yang bukan urusan juru bayar.
create policy contracts_read on ops_hr.employment_contracts for select to authenticated
  using (ops_core.has_permission('hrd.read'));
create policy contracts_new  on ops_hr.employment_contracts for insert to authenticated
  with check (ops_core.has_permission('hrd.create'));
create policy contracts_edit on ops_hr.employment_contracts for update to authenticated
  using (ops_core.has_permission('hrd.update')) with check (ops_core.has_permission('hrd.update'));

create policy clauses_read on ops_hr.contract_clauses for select to authenticated
  using (ops_core.has_permission('hrd.read'));
create policy clauses_new  on ops_hr.contract_clauses for insert to authenticated
  with check (ops_core.has_permission('hrd.create'));
create policy clauses_edit on ops_hr.contract_clauses for update to authenticated
  using (ops_core.has_permission('hrd.update')) with check (ops_core.has_permission('hrd.update'));

-- Daftar poin wajibnya dibaca semua orang dan ditulis IT, di sebelah buku
-- aturan gaji: menambah poin wajib adalah keputusan kebijakan, bukan
-- pekerjaan harian.
create policy checklist_read on ops_hr.clause_checklist for select to authenticated
  using (true);
create policy checklist_new  on ops_hr.clause_checklist for insert to authenticated
  with check (ops_core.has_permission('it.update'));
create policy checklist_edit on ops_hr.clause_checklist for update to authenticated
  using (ops_core.has_permission('it.update')) with check (ops_core.has_permission('it.update'));

grant select on ops_hr.employment_contracts, ops_hr.contract_clauses,
                ops_hr.clause_checklist, ops_hr.v_contract to authenticated;
grant insert, update on ops_hr.employment_contracts, ops_hr.contract_clauses,
                        ops_hr.clause_checklist to authenticated;

grant execute on function
  ops_hr.clause_value_ok(ops_hr.clause_kind_t, jsonb),
  ops_hr.contract_coverage(text),
  ops_hr.contract_conflicts(text),
  ops_hr.register_contract(text, ops_hr.contract_kind_t, date, date, uuid, text, text, text),
  ops_hr.propose_clause(text, ops_hr.clause_kind_t, text, int, jsonb, text),
  ops_hr.confirm_clause(text, ops_hr.clause_kind_t, text, int, jsonb, text),
  ops_hr.activate_contract(text, text),
  ops_hr.end_contract(text, date, text, text)
  to authenticated;
