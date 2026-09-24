-- simulasi — produksi: dari pesanan klien sampai serah terima.
--
-- The same kind of file as `99_sim_procure_to_ledger` and `99_sim_hr_to_ledger`:
-- a **walk**, one person doing one thing on one screen per step, written into
-- `sim_log`. `supabase/local/simulate.sh sim_production_to_handover` prints it;
-- the SOP (`docs/sop/produksi/`) and John Lau's process knowledge were
-- written from it.
--
-- Four people, with the grants the real roles carry:
--   Ryan  — sales / PM: project write (klien, proyek, quotation, BAST)
--   Wayan — PPIC / mandor: production write, procurement write (PR dari BOM), hr read
--   Komang — pengiriman: delivery write, production read
--   Evin  — pimpinan: approve_goods (the request raised from the BOM goes to them)
--
-- Where the application disagrees with itself the step is logged `TEMUAN`
-- rather than asserted away, so the walk finishes and the log carries every
-- finding at once. Anything logged `OK` or `DITOLAK` is asserted.

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
create temp table ctx (k text primary key, v text) on commit drop;
grant all on ctx to authenticated;
create function pg_temp.put(p_k text, p_v text) returns void language sql as $$
  insert into ctx values (p_k, p_v) on conflict (k) do update set v = excluded.v;
$$;
create function pg_temp.get(p_k text) returns text language sql as $$ select v from ctx where k = p_k $$;

insert into auth.users (id, email, raw_user_meta_data) values
  ('51530000-0000-0000-0000-0000000000a1','ryan@talaliving.com','{"full_name":"Ryan Pratama"}'),
  ('51530000-0000-0000-0000-0000000000b2','wayan@talaliving.com','{"full_name":"Wayan Sudarma"}'),
  ('51530000-0000-0000-0000-0000000000c3','komang@talaliving.com','{"full_name":"Komang Adi"}'),
  ('51530000-0000-0000-0000-00000000ce00','evin.prod@talaliving.com','{"full_name":"Evin Jonathan"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('51530000-0000-0000-0000-0000000000a1','project','write'),
  ('51530000-0000-0000-0000-0000000000a1','production','read'),
  ('51530000-0000-0000-0000-0000000000b2','production','write'),
  ('51530000-0000-0000-0000-0000000000b2','procurement','write'),
  ('51530000-0000-0000-0000-0000000000b2','project','read'),
  ('51530000-0000-0000-0000-0000000000b2','hrd','read'),
  ('51530000-0000-0000-0000-0000000000c3','delivery','write'),
  ('51530000-0000-0000-0000-0000000000c3','production','read'),
  ('51530000-0000-0000-0000-0000000000c3','project','read'),
  ('51530000-0000-0000-0000-00000000ce00','procurement','write');
insert into ops_core.user_authorities (user_id, authority) values
  ('51530000-0000-0000-0000-00000000ce00','approve_goods');

-- Reference data the walk starts from: the items a BOM is built of and a
-- finishing vendor. Master data is its own walk (procurement's).
insert into ops_procure.items (code, name, category_code, base_uom, standard_price, last_price) values
  ('SIM-JATI','Kayu jati kering','raw-wood','m3', 5000000, 4800000),
  ('SIM-CAT','Cat PU clear','finishing','ltr', 85000, 80000),
  ('SIM-BAUT','Baut 8x50','hardware','pcs', 2000, 2000);
insert into ops_procure.vendors (code, name, is_curated) values ('V-SIMFIN','CV FINISHING SIMULASI', true);

set local role authenticated;

-- ═════ 1. KLIEN DAN PROYEK ════════════════════════════════════════════════
select pg_temp.as_('51530000-0000-0000-0000-0000000000a1');
do $$
declare r jsonb; cl text; pj text;
begin
  r := ops_procure.save_client(null, 'Hotel Laut Biru Simulasi', 'Bu Sari', '0812000111', null, 'Labuan Bajo', null, null);
  assert ops_core.said_ok(r), format('client: %s', r);
  cl := r -> 'data' ->> 'code';
  perform pg_temp.put('client', cl);
  perform pg_temp.log('1. Klien & proyek','Klien baru: nama, kontak, telepon, alamat → Simpan','Ryan','/master-data/clients',
    'ops_procure.save_client','OK', cl);

  r := ops_procure.save_project(null, 'Restoran Hotel Laut Biru', cl, 'Labuan Bajo', 'Ryan',
                                ops_core.office_day(), ops_core.office_day() + 45, null, null);
  assert ops_core.said_ok(r), format('project: %s', r);
  pj := r -> 'data' ->> 'code';
  perform pg_temp.put('project', pj);
  perform pg_temp.log('1. Klien & proyek','Proyek baru: klien, lokasi, penanggung jawab, mulai, jadwal kirim → Simpan','Ryan','/proyek/order',
    'ops_procure.save_project','OK', (select status::text from ops_procure.projects where code = pj),
    'Kode proyek dibuat otomatis kalau dikosongkan.');
end $$;

-- ═════ 2. PRODUK DAN BOM ══════════════════════════════════════════════════
select pg_temp.as_('51530000-0000-0000-0000-0000000000b2');
do $$
declare r jsonb; st text[];
begin
  r := ops_prod.save_product('SIM-MJ-01', 'Meja makan jati 180', 'Meja', 'unit', null, 1800, 900, 760, null, 21, null, null,
                             array['AMPLAS','FINISHING','PACKING']);
  assert ops_core.said_ok(r), format('product: %s', r);
  perform pg_temp.log('2. Produk & BOM','Produk baru: item code, kategori, nama, satuan, ukuran → Simpan','Wayan','/produksi/bom',
    'ops_prod.save_product','OK','produk tanpa BOM');

  select stages into st from ops_prod.products where product_code = 'SIM-MJ-01';
  perform pg_temp.log('2. Produk & BOM','Tentukan tahap produksi meja (amplas, finishing, packing — tanpa machinery)','Wayan','/produksi/bom',
    'ops_prod.save_product', case when st is not null then 'OK' else 'TEMUAN' end,
    coalesce(array_to_string(st, ' → '), 'ikut rute: 4 tahap'),
    case when st is null then 'Layar produk tidak punya isian tahap dan save_product tidak menerimanya: meja tanpa lampu atau kabel ikut menunggu tahap Machinery (F92).'
      else 'Tahap dicentang di laci produk; tanpa centang, produk ikut empat tahap rutenya (0152, F155).' end);

  r := ops_prod.save_bom_line('SIM-MJ-01', null, 'material', 'SIM-JATI', null, 0.12, 'm3', null, 10, null);
  assert ops_core.said_ok(r), format('bom jati: %s', r);
  r := ops_prod.save_bom_line('SIM-MJ-01', null, 'material', 'SIM-CAT', null, 1.5, 'ltr', null, 0, null);
  assert ops_core.said_ok(r), format('bom cat: %s', r);
  r := ops_prod.save_bom_line('SIM-MJ-01', null, 'material', 'SIM-BAUT', null, 8, 'pcs', null, 0, null);
  assert ops_core.said_ok(r), format('bom baut: %s', r);
  perform pg_temp.log('2. Produk & BOM','Tambah komponen dari database items: jati, cat, baut (jumlah, satuan, susut)','Wayan','/produksi/bom',
    'ops_prod.save_bom_line','OK','draft BOM · 3 bahan');

  r := ops_prod.save_bom_line('SIM-MJ-01', null, 'labour', null, 'Tukang kayu borongan meja', 1, 'unit', null, 0, null);
  perform pg_temp.log('2. Produk & BOM','Tambah tenaga kerja tanpa tarif','Wayan','/produksi/bom','ops_prod.save_bom_line',
    case when r -> 'error' ->> 'code' = 'rate_required' then 'DITOLAK' else 'TEMUAN' end, null,
    coalesce(r -> 'error' ->> 'code', r ->> 'outcome'));
  r := ops_prod.save_bom_line('SIM-MJ-01', null, 'labour', null, 'Tukang kayu borongan meja', 1, 'unit', 750000, 0, null);
  assert ops_core.said_ok(r), format('bom labour: %s', r);
  perform pg_temp.log('2. Produk & BOM','Tenaga kerja: nama, satuan, tarif → Tambah','Wayan','/produksi/bom',
    'ops_prod.save_bom_line','OK','draft BOM · 3 bahan + 1 tenaga kerja');

  r := ops_prod.release_bom('SIM-MJ-01', null);
  perform pg_temp.log('2. Produk & BOM','Rilis tanpa catatan','Wayan','/produksi/bom','ops_prod.release_bom',
    case when r -> 'error' ->> 'code' = 'note_required' then 'DITOLAK' else 'TEMUAN' end, null,
    coalesce(r -> 'error' ->> 'code', r ->> 'outcome'));
  r := ops_prod.release_bom('SIM-MJ-01', 'rev awal dari gambar kerja');
  assert ops_core.said_ok(r), format('release: %s', r);
  perform pg_temp.log('2. Produk & BOM','Isi catatan rilis → Rilis rev 1','Wayan','/produksi/bom','ops_prod.release_bom','OK',
    'rev ' || (r -> 'data' ->> 'rev') || ' · biaya produksi ' || coalesce(r -> 'data' ->> 'production_cost', '?'),
    'Harga bahan diambil dari harga standar/terakhir di database items.');
end $$;

-- ═════ 3. QUOTATION ═══════════════════════════════════════════════════════
select pg_temp.as_('51530000-0000-0000-0000-0000000000a1');
do $$
declare r jsonb; q text; pj text := pg_temp.get('project');
begin
  r := ops_procure.save_quotation(null, pj, ops_core.office_day() + 14, 5, 10, 20, true, 11, 'DP 50%, pelunasan sebelum kirim', null, null);
  assert ops_core.said_ok(r), format('quotation: %s', r);
  q := r -> 'data' ->> 'quote_no';
  perform pg_temp.put('quote', q);
  perform pg_temp.log('3. Quotation','Quotation baru: pilih proyek → Buat draft','Ryan','/proyek/quotation','ops_procure.save_quotation','OK','DRAFT');

  r := ops_procure.send_quotation(q);
  perform pg_temp.log('3. Quotation','Kirim quotation tanpa item','Ryan','/proyek/quotation','ops_procure.send_quotation',
    case when r -> 'error' ->> 'code' = 'no_lines' then 'DITOLAK' else 'TEMUAN' end, 'DRAFT',
    coalesce(r -> 'error' ->> 'code', r ->> 'outcome'));

  r := ops_procure.save_quotation_line(q, null, 'SIM-MJ-01', null, 4, 'unit', null, null, null, null, null, null, null);
  assert ops_core.said_ok(r), format('quote line: %s', r);
  perform pg_temp.log('3. Quotation','Tambah item: item code, jumlah, satuan → harga dihitung dari BOM + persen','Ryan','/proyek/quotation',
    'ops_procure.save_quotation_line','OK','DRAFT');

  r := ops_procure.send_quotation(q);
  assert ops_core.said_ok(r), format('send: %s', r);
  perform pg_temp.log('3. Quotation','Kirim ke klien','Ryan','/proyek/quotation','ops_procure.send_quotation','OK',
    'SENT · proyek ' || (select status::text from ops_procure.projects where code = pj));

  r := ops_procure.decide_quotation(q, true, null);
  assert ops_core.said_ok(r), format('accept: %s', r);
  perform pg_temp.log('3. Quotation','Klien setuju: Disetujui','Ryan','/proyek/quotation','ops_procure.decide_quotation','OK',
    'ACCEPTED · proyek ' || (select status::text from ops_procure.projects where code = pj) || ' · '
      || coalesce(r -> 'data' ->> 'order_lines_added', '?') || ' baris order',
    'Item quotation menjadi baris order proyek.');
end $$;

-- ═════ 4. JOB ORDER ═══════════════════════════════════════════════════════
select pg_temp.as_('51530000-0000-0000-0000-0000000000b2');
do $$
declare r jsonb; ln uuid; jo text; pj text := pg_temp.get('project');
begin
  select l.id into ln from ops_procure.project_lines l join ops_procure.projects p on p.id = l.project_id
   where p.code = pj and l.product_code = 'SIM-MJ-01';
  assert ln is not null, 'baris order dari quotation';
  perform pg_temp.put('line', ln::text);

  r := ops_prod.create_work_order(null, 4, null, ops_core.office_day() + 21, null, null, null, 'IN_HOUSE', null, ln, null);
  assert ops_core.said_ok(r), format('jo: %s', r);
  jo := r -> 'data' ->> 'wo_no';
  perform pg_temp.put('jo', jo);
  perform pg_temp.log('4. Job Order','Dari baris order: Buat Job Order → jumlah, jatuh tempo, rute Bengkel sendiri → Buat','Wayan','/proyek/order',
    'ops_prod.create_work_order','OK',
    (select status::text from ops_prod.work_orders where wo_no = jo) || ' · BOM rev ' || coalesce((select bom_rev::text from ops_prod.work_orders where wo_no = jo), '-')
      || ' · proyek ' || (select status::text from ops_procure.projects where code = pj),
    'Job Order mengunci revisi BOM yang dirilis terakhir.');
end $$;

-- ═════ 5. BAHAN: PR DARI BOM ══════════════════════════════════════════════
do $$
declare r jsonb; jo text := pg_temp.get('jo'); pj text := pg_temp.get('project'); lines jsonb; doc text; n int;
begin
  -- What "Buat PR dari BOM" sends: every exploded material line, labour left
  -- out, the unit only when the database knows it, the SPK on every line.
  select jsonb_agg(jsonb_build_object(
           'item_code', b.ref_code,
           'description', coalesce(b.ref_name, b.ref_code), 'qty', b.qty,
           'uom', case when exists (select 1 from ops_procure.uom u where u.code = b.uom) then b.uom end,
           'unit_price', case when b.subtotal is not null and b.qty > 0 then round(b.subtotal / b.qty) end,
           'purpose', format('BOM %s rev 1 — Meja makan jati 180 · proyek %s', jo, pj),
           'need_by', ops_core.office_day() + 21, 'source_wo_no', jo))
    into lines
    from ops_prod.explode_bom('SIM-MJ-01', 4, null) b where b.kind <> 'labour';
  r := ops_procure.create_pr(lines, pj, 'PR', null);
  assert ops_core.said_ok(r), format('pr: %s', r);
  doc := r -> 'data' ->> 'doc_no';
  select count(*) into n from ops_procure.pr_lines l join ops_procure.pr_documents d on d.id = l.doc_id where d.doc_no = doc;
  perform pg_temp.log('5. Bahan','Buka Job Order → Buat PR dari BOM','Wayan','/produksi/jadwal','ops_procure.create_pr','OK',
    format('PR %s DRAFT · %s baris', doc, n), 'Tiap baris membawa nomor Job Order-nya; PR masih harus diperiksa dan disubmit.');

  select count(*) into n from ops_procure.pr_lines l join ops_procure.pr_documents d on d.id = l.doc_id
   where d.doc_no = doc and l.item_id is not null;
  perform pg_temp.log('5. Bahan','Baris PR tersambung ke database items (untuk harga terakhir dan stok)','Wayan','/produksi/jadwal',
    'ops_procure.create_pr', case when n > 0 then 'OK' else 'TEMUAN' end, format('%s baris bertaut item', n),
    case when n = 0 then 'Tombol mengirim deskripsi saja, bukan item_id: baris PR dari BOM tidak tersambung ke item yang sudah ada di BOM.'
      else 'Harga terakhir, vendor terakhir dan stok item ikut terbaca di baris PR (0152, F155).' end);

  r := ops_procure.submit_pr(doc, null);
  assert ops_core.said_ok(r), format('submit: %s', r);
  perform pg_temp.log('5. Bahan','Buka PR itu di Procurement → Requests, periksa, Submit for approval','Wayan','/procurement/pr',
    'ops_procure.submit_pr','OK','SUBMITTED', 'Dari sini jalurnya procurement: persetujuan pimpinan, PO, barang datang.');
end $$;

-- ═════ 6. PROGRES DAN VENDOR ══════════════════════════════════════════════
do $$
declare r jsonb; jo text := pg_temp.get('jo'); leg text; stg text;
begin
  r := ops_prod.record_progress(jo, 'AMPLAS', 4, ops_core.office_day(), 'Pak Nyoman', null, null, 'manual', null);
  assert ops_core.said_ok(r), format('amplas: %s', r);
  perform pg_temp.log('6. Progres','Catat progres: tahap Amplas, jumlah 4, tanggal, siapa → Catat','Wayan','/produksi/jadwal',
    'ops_prod.record_progress','OK','Amplas 4/4');

  r := ops_prod.record_progress(jo, 'AMPLAS', 1, ops_core.office_day(), 'Pak Nyoman', null, null, 'manual', null);
  perform pg_temp.log('6. Progres','Catat lebih dari jumlah order','Wayan','/produksi/jadwal','ops_prod.record_progress',
    case when r -> 'error' ->> 'code' = 'over_order' then 'DITOLAK' else 'TEMUAN' end, null,
    coalesce(r -> 'error' ->> 'code', r ->> 'outcome'));

  r := ops_prod.send_to_vendor(jo, 'V-SIMFIN', 'FINISHING', 4, ops_core.office_day() + 5, null, null);
  assert ops_core.said_ok(r), format('vendor out: %s', r);
  leg := r -> 'data' ->> 'leg_no';
  perform pg_temp.log('6. Progres','Kirim ke vendor finishing: proses, vendor, jumlah, dijanjikan kembali → Catat dikirim','Wayan','/produksi/jadwal',
    'ops_prod.send_to_vendor','OK', leg || ' di vendor');

  r := ops_prod.receive_from_vendor(leg, 4, ops_core.office_day(), null);
  assert ops_core.said_ok(r), format('vendor back: %s', r);
  perform pg_temp.log('6. Progres','Barang kembali dari vendor → Catat kembali','Wayan','/produksi/jadwal',
    'ops_prod.receive_from_vendor','OK', leg || ' kembali 4');

  -- Every stage the order goes through, full quantity.
  for stg in select stage_code from ops_prod.v_work_order_stage where wo_no = jo and stage_code <> 'AMPLAS' order by seq loop
    r := ops_prod.record_progress(jo, stg, 4, ops_core.office_day(), 'Pak Nyoman', null, null, 'manual', null);
    assert ops_core.said_ok(r), format('%s: %s', stg, r);
  end loop;
  perform pg_temp.log('6. Progres','Catat tahap berikutnya sampai selesai','Wayan','/produksi/jadwal','ops_prod.record_progress','OK',
    (select string_agg(stage_code, ' → ' order by seq) from ops_prod.v_work_order_stage where wo_no = jo),
    case when exists (select 1 from ops_prod.v_work_order_stage where wo_no = jo and stage_code = 'MACHINERY')
      then 'Termasuk Machinery, karena produk ini tidak punya daftar tahapnya sendiri (lihat temuan di langkah 2).' end);

  r := ops_prod.close_work_order(jo, null);
  assert ops_core.said_ok(r), format('close: %s', r);
  perform pg_temp.log('6. Progres','Tutup Job Order','Wayan','/produksi/jadwal','ops_prod.close_work_order','OK',
    (select status::text from ops_prod.work_orders where wo_no = jo));
end $$;

-- ═════ 7. PETI DAN PENGIRIMAN ═════════════════════════════════════════════
select pg_temp.as_('51530000-0000-0000-0000-0000000000c3');
do $$
declare r jsonb; pj text := pg_temp.get('project'); ln uuid := pg_temp.get('line')::uuid; bx text; dn text; sj uuid;
begin
  r := ops_dlv.pack_box(pj, 'Restoran lantai 1', jsonb_build_array(jsonb_build_object(
         'project_line_id', ln, 'description', 'Meja makan jati 180', 'qty', 2, 'uom', 'unit')), null, 'Jangan ditumpuk.', null);
  assert ops_core.said_ok(r), format('box1: %s', r);
  bx := r -> 'data' ->> 'box_no';
  perform pg_temp.put('box', bx);
  r := ops_dlv.pack_box(pj, 'Restoran lantai 1', jsonb_build_array(jsonb_build_object(
         'project_line_id', ln, 'description', 'Meja makan jati 180', 'qty', 2, 'uom', 'unit')), null, null, null);
  assert ops_core.said_ok(r), format('box2: %s', r);
  perform pg_temp.put('box2', r -> 'data' ->> 'box_no');
  perform pg_temp.log('7. Pengiriman','Kemas peti: proyek, tujuan di gedung, isi → Kemas & beri label (2 peti)','Komang','/proyek/peti',
    'ops_dlv.pack_box','OK','PACKED ×2');

  r := ops_dlv.create_delivery(pj, ops_core.office_day(), jsonb_build_array(jsonb_build_object('project_line_id', ln, 'qty', 5)),
         'DK 1234 XX', 'Pak Made', null, array[pg_temp.get('box'), pg_temp.get('box2')], null);
  perform pg_temp.log('7. Pengiriman','Surat jalan melebihi yang sudah dibuat','Komang','/proyek/pengiriman','ops_dlv.create_delivery',
    case when r -> 'error' ->> 'code' = 'not_enough_made' then 'DITOLAK' else 'TEMUAN' end, null,
    coalesce(r -> 'error' ->> 'code', r ->> 'outcome'));

  r := ops_dlv.create_delivery(pj, ops_core.office_day(), jsonb_build_array(jsonb_build_object('project_line_id', ln, 'qty', 4)),
         'DK 1234 XX', 'Pak Made', null, array[pg_temp.get('box'), pg_temp.get('box2')], null);
  assert ops_core.said_ok(r), format('delivery: %s', r);
  dn := r -> 'data' ->> 'delivery_no';
  perform pg_temp.put('delivery', dn);
  perform pg_temp.log('7. Pengiriman','Buat surat jalan: jumlah per baris, peti yang ikut, sopir, kendaraan → Berangkatkan','Komang','/proyek/pengiriman',
    'ops_dlv.create_delivery','OK', 'IN_TRANSIT · proyek ' || (select status::text from ops_procure.projects where code = pj));

  r := ops_dlv.mark_arrived(dn, 'Pak Wayan (engineering hotel)', null, null);
  perform pg_temp.log('7. Pengiriman','Catat sampai tanpa foto surat jalan bertanda tangan','Komang','/proyek/pengiriman','ops_dlv.mark_arrived',
    case when r -> 'error' ->> 'code' = 'surat_jalan_required' then 'DITOLAK' else 'TEMUAN' end, 'IN_TRANSIT',
    coalesce(r -> 'error' ->> 'code', r ->> 'outcome'));
  r := ops_core.attach_file('sim/surat-jalan.jpg','surat-jalan.jpg','image/jpeg',90000,null,'upload');
  sj := (r -> 'data' ->> 'attachment_id')::uuid;
  r := ops_dlv.mark_arrived(dn, 'Pak Wayan (engineering hotel)', sj, null);
  assert ops_core.said_ok(r), format('arrived: %s', r);
  perform pg_temp.log('7. Pengiriman','Catat sampai: penerima + foto surat jalan bertanda tangan → Simpan','Komang','/proyek/pengiriman',
    'ops_dlv.mark_arrived','OK','ARRIVED');

  r := ops_dlv.scan_box(pg_temp.get('box'), null);
  assert ops_core.said_ok(r), format('scan: %s', r);
  perform pg_temp.log('7. Pengiriman','Scan QR peti di lokasi → Sampai di site','Komang','/box',
    'ops_dlv.scan_box','OK','ON_SITE');
end $$;

-- ═════ 8. PEMASANGAN ══════════════════════════════════════════════════════
do $$
declare r jsonb; pj text := pg_temp.get('project'); ln uuid := pg_temp.get('line')::uuid; sn text;
begin
  r := ops_dlv.record_installation(pj, ops_core.office_day(), jsonb_build_array(jsonb_build_object('project_line_id', ln, 'qty', 4)),
         'Tim Made', null, null);
  assert ops_core.said_ok(r), format('install: %s', r);
  perform pg_temp.log('8. Pemasangan','Catat pemasangan: jumlah terpasang, tim → Catat N unit terpasang','Komang','/proyek/instalasi',
    'ops_dlv.record_installation','OK','4 terpasang');

  r := ops_dlv.mark_box_installed(pg_temp.get('box'), null);
  perform pg_temp.log('8. Pemasangan','Peti di lokasi → Terpasang','Komang','/box','ops_dlv.mark_box_installed',
    case when ops_core.said_ok(r) then 'OK' else 'TEMUAN' end, 'INSTALLED', coalesce(r -> 'error' ->> 'code', null));

  r := ops_dlv.raise_snag(pj, 'Goresan halus di daun meja nomor 3', 'Klien', 'minor', ln, null);
  assert ops_core.said_ok(r), format('snag: %s', r);
  sn := r -> 'data' ->> 'snag_no';
  perform pg_temp.log('8. Pemasangan','Catat temuan: apa yang salah, tingkat, ditemukan siapa','Komang','/proyek/instalasi',
    'ops_dlv.raise_snag','OK','temuan terbuka');

  r := ops_dlv.close_snag(sn, 'Dipoles ulang di lokasi', 'Tim Made');
  assert ops_core.said_ok(r), format('close snag: %s', r);
  perform pg_temp.log('8. Pemasangan','Tutup temuan: keterangan perbaikan → Simpan','Komang','/proyek/instalasi',
    'ops_dlv.close_snag','OK','temuan selesai',
    case when (select fixed_by from ops_dlv.snags where snag_no = sn) is null
      then 'Siapa yang memperbaiki tidak tercatat.' end);
end $$;

-- ═════ 9. SERAH TERIMA ════════════════════════════════════════════════════
do $$
declare r jsonb; pj text := pg_temp.get('project');
begin
  r := ops_dlv.record_handover(pj, ops_core.office_day(), 'Bu Sari', 'Ryan', gen_random_uuid(), null, null);
  perform pg_temp.log('9. Serah terima','Tim pengiriman mencoba mencatat BAST','Komang','/proyek/serah-terima','ops_dlv.record_handover',
    case when r -> 'error' ->> 'code' in ('not_permitted','authority_required') then 'DITOLAK' else 'TEMUAN' end, null,
    coalesce(r -> 'error' ->> 'code', r ->> 'outcome'));
end $$;

select pg_temp.as_('51530000-0000-0000-0000-0000000000a1');
do $$
declare r jsonb; pj text := pg_temp.get('project'); bast uuid;
begin
  r := ops_dlv.record_handover(pj, ops_core.office_day(), 'Bu Sari', 'Ryan', null, null, null);
  perform pg_temp.log('9. Serah terima','Serah terima tanpa BAST yang ditandatangani','Ryan','/proyek/serah-terima','ops_dlv.record_handover',
    case when r -> 'error' ->> 'code' = 'bast_required' then 'DITOLAK' else 'TEMUAN' end, null,
    coalesce(r -> 'error' ->> 'code', r ->> 'outcome'));

  r := ops_core.attach_file('sim/bast.pdf','bast.pdf','application/pdf',150000,null,'upload');
  bast := (r -> 'data' ->> 'attachment_id')::uuid;
  r := ops_dlv.record_handover(pj, ops_core.office_day(), 'Bu Sari', 'Ryan', bast, null, null);
  assert ops_core.said_ok(r), format('handover: %s', r);
  perform pg_temp.log('9. Serah terima','Serah terima: yang tanda tangan dari klien dan dari kita, unggah BAST → Catat serah terima','Ryan',
    '/proyek/serah-terima','ops_dlv.record_handover','OK',
    'proyek ' || (select status::text from ops_procure.projects where code = pj));
end $$;

select n, proses, langkah, pelaku, layar, seam, hasil, status, catatan from sim_log order by n;

do $$
declare n int;
begin
  select count(*) into n from sim_log where hasil = 'TEMUAN';
  raise notice 'simulasi produksi → serah terima: % langkah, % temuan', (select count(*) from sim_log), n;
end $$;

rollback;
