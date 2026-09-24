-- 101_hr_wlkp.sql — data diri untuk WLKP, dan rekap yang mencetaknya.
--
-- Yang dibuktikan:
--   • tabelnya **tidak bisa dibaca langsung** oleh siapa pun, bahkan HRD —
--     satu-satunya jalan adalah seam yang menanyakan izinnya sendiri (D196,
--     bentuk yang sama dengan `employee_documents` di `0056`);
--   • setiap dimensi rekap **berjumlah sama dengan headcount**, termasuk yang
--     `tidak_diketahui` — kegagalan yang dijaga di sini bersifat diam: sebuah
--     `filter` yang membuang null menghasilkan tabel yang tampak selesai dan
--     kurang sembilan orang;
--   • null bukan kategori: yang belum diisi tidak pernah dilipat ke `tidak`;
--   • `p_asof` menghitung siapa yang bekerja **pada tanggal itu**, bukan siapa
--     yang aktif hari ini — orang yang keluar bulan November tetap terhitung
--     pada laporan 31 Desember tahun sebelumnya dan tidak pada tahun ini;
--   • WNA tanpa negara, WNI dengan negara, keterangan disabilitas tanpa jawaban
--     ya, tanggal lahir di masa depan, dan umur mustahil pada tanggal masuk
--     semuanya ditolak dengan kalimat — dan constraint menangkapnya juga;
--   • audit menyebut **field mana yang diisi**, tidak pernah nilainya.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-000000010101','hrd101@talaliving.com','{"full_name":"Wulan"}'),
  ('ffffffff-0000-0000-0000-000000010102','gaji101@talaliving.com','{"full_name":"Bendahara"}'),
  ('ffffffff-0000-0000-0000-000000010103','lain101@talaliving.com','{"full_name":"Orang lain"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-000000010101','hrd','admin'),
  -- Payroll saja: boleh melihat rekapnya (angka), tidak boleh melihat orangnya.
  ('ffffffff-0000-0000-0000-000000010102','payroll','admin'),
  ('ffffffff-0000-0000-0000-000000010103','procurement','admin');

insert into ops_hr.employees
  (id, employee_no, full_name, position, unit, pay_basis, base_rate, allowance_rate,
   daily_hours, joined_on, left_on, active)
values
  ('aaaa1010-0000-0000-0000-000000000001','B-1101','Sari','Admin','Kantor',
   'monthly', 4000000, 25000, 8, '2020-01-01', null, true),
  ('aaaa1010-0000-0000-0000-000000000002','B-1102','Karjo','Tukang','Produksi',
   'daily', 180000, 25000, 8, '2021-03-01', null, true),
  -- Lahir Agustus 2009 dan masuk Oktober 2024, tepat lima belas. Sengaja:
  -- dialah satu-satunya yang mengisi `di_bawah_18` pada laporan akhir 2024,
  -- dan sudah tujuh belas hari ini — jadi kelompok umurnya **berpindah** antara
  -- dua tanggal laporan, yang membuktikan umur dihitung pada `p_asof` dan bukan
  -- sekarang.
  ('aaaa1010-0000-0000-0000-000000000003','B-1103','Wayan','Tukang','Produksi',
   'daily', 180000, 25000, 8, '2024-10-01', null, true),
  -- Keluar tahun lalu. Tidak aktif hari ini, tapi jelas bekerja pada 2024.
  ('aaaa1010-0000-0000-0000-000000000004','B-1104','Budi','Sopir','Kantor',
   'monthly', 3000000, 25000, 8, '2019-02-01', '2025-06-30', false),
  -- Baru masuk tahun ini: tidak boleh terhitung pada laporan 2024.
  ('aaaa1010-0000-0000-0000-000000000005','B-1105','Nyoman','Finishing','Produksi',
   'daily', 175000, 25000, 8, '2026-02-01', null, true);

-- Dua kontrak, dan hanya satu yang boleh terhitung: Karjo punya PKWT yang
-- aktif, Sari punya PKWTT yang **masih draft**. Kertas yang belum ditandatangani
-- tidak menggambarkan status hubungan kerja siapa pun, dan sebuah rekap yang
-- menghitungnya melaporkan orang sebagai pekerja tetap sebelum ada yang setuju.
insert into ops_hr.employment_contracts
  (employee_id, kind, effective_from, ends_on, status, activated_by, activated_at)
values ('aaaa1010-0000-0000-0000-000000000002','PKWT','2021-03-01','2027-02-28',
        'active','ffffffff-0000-0000-0000-000000010101', now()),
       ('aaaa1010-0000-0000-0000-000000000001','PKWTT','2020-01-01', null,
        'draft', null, null);

set local role authenticated;

/* ── D196: tabelnya tertutup, bahkan untuk HRD ─────────────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000010101';
do $$
declare leaked boolean := false; n int;
begin
  begin
    perform 1 from ops_hr.employee_identity;
    leaked := true;
  exception when insufficient_privilege then null;
  end;
  assert not leaked,
    'tabel data diri bisa di-select langsung — seam-nya jadi hiasan (F127)';

  /* The guard that keeps holding **after somebody re-runs a blanket
     `grant select on all tables in schema ops_hr`**, which is F147 and has
     happened. The revoke in `0137` is insurance and changes nothing today,
     because no grant was ever made on a table created after `0040` ran. What
     actually closes the door is this: row level security on, and **not one
     select policy**. Asserted rather than the revoke, because the revoke is the
     mechanism and this is the property. */
  assert (select relrowsecurity from pg_class
           where oid = 'ops_hr.employee_identity'::regclass),
    'RLS mati di tabel data diri';
  select count(*) into n from pg_policies
   where schemaname = 'ops_hr' and tablename = 'employee_identity'
     and cmd in ('SELECT','ALL');
  assert n = 0, format('ada %s policy select di tabel data diri — satu-satunya jalan baca seharusnya seam', n);
end $$;

/* ── REFUSAL: yang bukan HRD tidak bisa mengubah, dan tidak melihat orangnya ─ */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000010103';
do $$
declare a jsonb; n int;
begin
  a := ops_hr.save_employee_identity('B-1101', date '1990-05-04', 'P');
  assert a ->> 'outcome' = 'refused', 'orang tanpa HRD bisa mengubah data diri';
  assert (a -> 'error' ->> 'status')::int = 403, a::text;

  select count(*) into n from ops_hr.employee_identities();
  assert n = 0, format('orang tanpa HRD melihat %s baris data diri', n);
  assert ops_hr.wlkp_recap() is null, 'rekap terbuka untuk yang tidak berhak';
end $$;

set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000010101';

/* ── REFUSAL: lima cara salah mengisi, masing-masing dengan kalimatnya ─── */
do $$
declare a jsonb;
begin
  a := ops_hr.save_employee_identity('B-1101', ops_core.office_day() + 1, 'P');
  assert a -> 'error' ->> 'code' = 'born_in_the_future', a::text;
  assert (a -> 'error' ->> 'status')::int = 422, a::text;

  a := ops_hr.save_employee_identity('B-1101', date '1899-01-01', 'P');
  assert a -> 'error' ->> 'code' = 'born_too_long_ago', a::text;

  -- Sari masuk 2020; lahir 2015 berarti mulai bekerja umur lima tahun.
  a := ops_hr.save_employee_identity('B-1101', date '2015-01-01', 'P');
  assert a -> 'error' ->> 'code' = 'born_after_joining', a::text;

  a := ops_hr.save_employee_identity('B-1101', date '1990-05-04','P','S1','WNA', null);
  assert a -> 'error' ->> 'code' = 'nationality_required', a::text;

  a := ops_hr.save_employee_identity('B-1101', date '1990-05-04','P','S1','WNI','Australia');
  assert a -> 'error' ->> 'code' = 'nationality_not_for_wni', a::text;

  a := ops_hr.save_employee_identity('B-1101', date '1990-05-04','P','S1','WNI', null,
                                     false, 'pakai kursi roda');
  assert a -> 'error' ->> 'code' = 'note_without_a_yes', a::text;

  a := ops_hr.save_employee_identity('B-9999', date '1990-05-04','P');
  assert (a -> 'error' ->> 'status')::int = 404, a::text;
end $$;

-- Dan constraint menangkapnya juga, bukan hanya seam-nya.
reset role;
do $$
declare refused boolean := false;
begin
  begin
    insert into ops_hr.employee_identity (employee_id, citizenship, nationality)
    values ('aaaa1010-0000-0000-0000-000000000002','WNA', null);
  exception when check_violation then refused := true;
  end;
  assert refused, 'WNA tanpa negara lolos lewat insert langsung';
end $$;
do $$
declare refused boolean := false;
begin
  begin
    insert into ops_hr.employee_identity (employee_id, disabled, disability_note)
    values ('aaaa1010-0000-0000-0000-000000000002', null, 'sesuatu');
  exception when check_violation then refused := true;
  end;
  assert refused, 'keterangan disabilitas tanpa jawaban ya lolos lewat insert langsung';
end $$;

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000010101';

/* ── mengisi: tiga lengkap, dua sengaja dibiarkan kosong ───────────────── */
do $$
declare a jsonb;
begin
  a := ops_hr.save_employee_identity('B-1101', date '1990-05-04','P','S1','WNI', null,
                                     false, null, 'KAWIN');
  assert a ->> 'outcome' = 'ok', a::text;
  -- Amplopnya tidak membawa nilainya pulang.
  assert a::text not like '%1990-05-04%', 'tanggal lahir bocor ke amplop';

  a := ops_hr.save_employee_identity('B-1102', date '1985-11-20','L','SMP','WNI', null,
                                     true, 'gangguan pendengaran sebagian', 'KAWIN');
  assert a ->> 'outcome' = 'ok', a::text;

  a := ops_hr.save_employee_identity('B-1103', date '2009-08-15','L','SMK','WNA','Timor-Leste',
                                     false, null, 'BELUM_KAWIN');
  assert a ->> 'outcome' = 'ok', a::text;

  -- B-1104 dan B-1105 tidak diisi sama sekali.
end $$;

-- Dan yang tertulis di jejak audit adalah **field mana yang diisi**, tidak
-- pernah nilainya: sebuah baris audit yang mengulang tanggal lahir sudah
-- menyalin justru hal yang tabel ini dibuat untuk menahannya di satu tempat
-- (D196). `id desc` ikut di urutan karena `now()` adalah jam transaksi dan
-- ketiga baris di atas punya `at` yang identik (F146).
reset role;
do $$
declare row_ ops_core.audit_log%rowtype;
begin
  select * into row_ from ops_core.audit_log
   where entity = 'employee_identity' and entity_no = 'B-1101' and outcome = 'ok'
   order by at desc, id desc limit 1;
  assert found, 'menyimpan data diri tidak meninggalkan jejak audit';
  assert row_.after -> 'fields' @> '["tanggal_lahir","jenis_kelamin","status_kawin"]'::jsonb,
    format('got %s', row_.after);
  assert row_.after::text not like '%1990-05-04%',
    format('tanggal lahir tersalin ke jejak audit: %s', row_.after);
  assert row_.before is null, 'ada before untuk baris yang baru dibuat';
end $$;
set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000010101';

/* ── daftar: siapa yang kurang apa ─────────────────────────────────────── */
do $$
declare r ops_hr.employee_identity_t; n int;
begin
  select count(*) into n from ops_hr.employee_identities();
  assert n = 5, format('lima orang di daftar, dapat %s', n);

  select * into r from ops_hr.employee_identities('B-1101');
  assert r.missing = '{}', format('Sari lengkap, tapi kurang: %s', r.missing);
  assert r.age = ops_hr.age_on(date '1990-05-04', ops_core.office_day()),
    'umur tidak diturunkan dari tanggal lahir';
  assert r.age_band = '35_44', format('got %s', r.age_band);
  assert r.contract_kind is null, 'tidak ada kontrak, tapi ada jenisnya';

  select * into r from ops_hr.employee_identities('B-1103');
  assert r.age_band = '18_24' or r.age_band = 'di_bawah_18',
    format('Wayan lahir 2009, got %s', r.age_band);
  assert r.nationality = 'Timor-Leste', 'negara WNA hilang';

  select * into r from ops_hr.employee_identities('B-1105');
  -- Enam-enamnya kosong, dan disebut satu per satu supaya layarnya bisa
  -- memberi tahu siapa yang harus ditanyai apa.
  assert array_length(r.missing, 1) = 6, format('got %s', r.missing);
  assert r.missing @> array['tanggal_lahir','disabilitas','status_kawin'], format('got %s', r.missing);
  assert r.age is null, 'umur muncul dari tanggal lahir yang tidak ada';
  assert r.age_band = 'tidak_diketahui', format('got %s', r.age_band);
end $$;

/* ── rekap: tiap dimensi berjumlah headcount, termasuk yang kosong ─────── */
do $$
declare rec jsonb; dim text; fld text; total int; d_total int;
begin
  rec := ops_hr.wlkp_recap();
  -- Hari ini: empat orang bekerja (B-1104 keluar 2025).
  total := (rec ->> 'headcount')::int;
  assert total = 4, format('empat orang bekerja hari ini, dapat %s', total);
  assert (rec ->> 'complete')::int = 3, format('got %s', rec ->> 'complete');
  assert (rec ->> 'incomplete')::int = 1, format('got %s', rec ->> 'incomplete');

  -- **Yang dijaga file ini.** Delapan dimensi, dan tiap-tiapnya harus
  -- menjumlah ke headcount. Sebuah `filter` yang membuang null menghasilkan
  -- tabel yang tampak selesai dan kurang orang, dan tidak ada yang error.
  for dim in select jsonb_object_keys(rec -> 'by') loop
    select sum((x ->> 'count')::int) into d_total
      from jsonb_array_elements(rec -> 'by' -> dim) x;
    assert d_total = total,
      format('dimensi %s berjumlah %s, headcount %s — ada orang yang hilang dari tabel', dim, d_total, total);
  end loop;

  /* **Null bukan kategori, dan ini yang membuktikannya untuk keenam dimensi
     sekaligus.** Jumlah `tidak_diketahui` di setiap tabel harus sama persis
     dengan hitungan `missing_by_field` untuk field yang sama — dua jalan
     berbeda ke angka yang sama, dan yang satu tidak bisa melipat null ke
     kategori terbesar tanpa yang lain membantahnya. Menjumlah ke headcount saja
     tidak cukup: sebuah `coalesce(sex, 'L')` tetap berjumlah benar. */
  for dim, fld in
    select * from (values ('jenis_kelamin','jenis_kelamin'),
                          ('kelompok_umur','tanggal_lahir'),
                          ('pendidikan','pendidikan'),
                          ('kewarganegaraan','kewarganegaraan'),
                          ('disabilitas','disabilitas'),
                          ('status_kawin','status_kawin')) v(a, b)
  loop
    select coalesce((select (x ->> 'count')::int
                       from jsonb_array_elements(rec -> 'by' -> dim) x
                      where x ->> 'key' = 'tidak_diketahui'), 0) into d_total;
    assert d_total = coalesce((rec -> 'missing_by_field' ->> fld)::int, 0),
      format('dimensi %s melaporkan %s tidak diketahui, tapi %s orang belum mengisi %s — null dilipat ke kategori lain',
             dim, d_total, coalesce((rec -> 'missing_by_field' ->> fld)::int, 0), fld);
  end loop;

  -- Dan sekali secara eksplisit, supaya angkanya sendiri terbaca.
  assert (select (x ->> 'count')::int from jsonb_array_elements(rec -> 'by' -> 'disabilitas') x
           where x ->> 'key' = 'tidak_diketahui') = 1,
    format('disabilitas: %s', rec -> 'by' -> 'disabilitas');
  assert (select (x ->> 'count')::int from jsonb_array_elements(rec -> 'by' -> 'disabilitas') x
           where x ->> 'key' = 'tidak') = 2,
    format('disabilitas: %s', rec -> 'by' -> 'disabilitas');
  assert (select (x ->> 'count')::int from jsonb_array_elements(rec -> 'by' -> 'disabilitas') x
           where x ->> 'key' = 'ya') = 1,
    format('disabilitas: %s', rec -> 'by' -> 'disabilitas');

  /* Satu PKWT aktif, dan tiga tanpa kontrak — **termasuk Sari, yang punya
     PKWTT yang masih draft**. Kertas yang belum ditandatangani tidak boleh
     melaporkan orang sebagai pekerja tetap. */
  assert (select (x ->> 'count')::int
            from jsonb_array_elements(rec -> 'by' -> 'status_hubungan_kerja') x
           where x ->> 'key' = 'PKWT') = 1,
    format('status: %s', rec -> 'by' -> 'status_hubungan_kerja');
  assert (select (x ->> 'count')::int
            from jsonb_array_elements(rec -> 'by' -> 'status_hubungan_kerja') x
           where x ->> 'key' = 'tanpa_kontrak') = 3,
    format('status: %s', rec -> 'by' -> 'status_hubungan_kerja');
  assert not (rec -> 'by' -> 'status_hubungan_kerja') @> '[{"key":"PKWTT"}]'::jsonb,
    format('kontrak draft ikut terhitung: %s', rec -> 'by' -> 'status_hubungan_kerja');

  assert rec -> 'nationalities' @> '[{"country":"Timor-Leste","count":1}]'::jsonb,
    format('got %s', rec -> 'nationalities');
  assert (rec -> 'missing_by_field' ->> 'tanggal_lahir')::int = 1,
    format('got %s', rec -> 'missing_by_field');
end $$;

/* ── p_asof: laporan untuk sebuah tanggal, bukan untuk hari ini ────────── */
do $$
declare rec jsonb;
begin
  rec := ops_hr.wlkp_recap(date '2024-12-31');
  -- Pada 31 Desember 2024: Sari, Karjo, Wayan dan Budi. Nyoman belum masuk.
  assert (rec ->> 'headcount')::int = 4,
    format('empat orang pada akhir 2024, dapat %s', rec ->> 'headcount');
  assert (rec ->> 'asof') = '2024-12-31', format('got %s', rec ->> 'asof');

  /* Umur dihitung **pada tanggal itu**, bukan hari ini — dan yang
     membuktikannya adalah orang yang **berpindah kelompok** di antara keduanya.
     Sari lahir Mei 1990: tiga puluh empat pada akhir 2024, tiga puluh enam
     sekarang. Wayan sendiri tidak cukup, karena ia di bawah delapan belas pada
     kedua tanggal dan angkanya sama apa pun yang dipakai. */
  assert (select (x ->> 'count')::int from jsonb_array_elements(rec -> 'by' -> 'kelompok_umur') x
           where x ->> 'key' = '25_34') = 1,
    format('Sari berumur 34 pada akhir 2024 — umur: %s', rec -> 'by' -> 'kelompok_umur');
  assert (select (x ->> 'count')::int from jsonb_array_elements(rec -> 'by' -> 'kelompok_umur') x
           where x ->> 'key' = 'di_bawah_18') = 1,
    format('umur: %s', rec -> 'by' -> 'kelompok_umur');
  assert not (rec -> 'by' -> 'kelompok_umur') @> '[{"key":"35_44","count":2}]'::jsonb,
    format('umur dihitung hari ini, bukan pada 31 Des 2024: %s', rec -> 'by' -> 'kelompok_umur');

  rec := ops_hr.wlkp_recap(date '2018-01-01');
  assert (rec ->> 'headcount')::int = 0, 'belum ada yang masuk pada 2018';
end $$;

/* ── rekap boleh dibaca payroll; daftar orangnya tidak ─────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000010102';
do $$
declare rec jsonb; n int;
begin
  assert not ops_core.has_permission('hrd.read'), 'fixture salah: bendahara punya hrd.read';
  rec := ops_hr.wlkp_recap();
  assert rec is not null, 'payroll tidak bisa membaca rekap yang isinya hanya angka';
  assert (rec ->> 'headcount')::int = 4, format('got %s', rec ->> 'headcount');

  select count(*) into n from ops_hr.employee_identities();
  assert n = 0, format('payroll melihat %s baris tanggal lahir', n);

  -- Dan tetap tidak boleh menulis.
  assert (ops_hr.save_employee_identity('B-1101', date '1991-01-01') -> 'error' ->> 'status')::int = 403,
    'payroll bisa mengubah data diri';
end $$;

/* ── F141 lagi: definer yang terbuka untuk PUBLIC ──────────────────────── */
reset role;
do $$
begin
  assert not has_function_privilege('public','ops_hr.employee_identities(text)','execute'),
    'employee_identities() terbuka untuk PUBLIC';
  assert not has_function_privilege('public','ops_hr.wlkp_recap(date)','execute'),
    'wlkp_recap() terbuka untuk PUBLIC';
  assert has_function_privilege('authenticated','ops_hr.wlkp_recap(date)','execute'),
    'authenticated tidak bisa memanggil wlkp_recap()';
end $$;

rollback;
