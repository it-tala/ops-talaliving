-- simulasi — procurement sampai buku besar, satu minggu kerja, satu per satu.
--
-- `05_procure_lifecycle` proves each seam hands the next one something it can
-- consume. This file is a different thing: a **walk**, written to be read by
-- the people who will do it. Every step is a person doing one thing on one
-- screen, in the order a real week happens, and every step is written into
-- `sim_log` with who did it, which seam did the work, what came back and what
-- status it left behind. `supabase/local/simulate.sh` prints that log; the SOP
-- (`docs/sop/`) and John Lau's process knowledge (`0126`) were written from it.
--
-- Three people, with the grants the real roles carry:
--   Andi — staf procurement: procurement write
--   Evin — pimpinan: approve_goods (persetujuan barang)
--   Rina — keuangan: accounting write, approve_funds, post_ledger, resolve_inbox
--
-- Where the application disagrees with itself, the step is logged as `TEMUAN`
-- rather than asserted away, so the walk still finishes and the log carries
-- every finding at once. Anything logged `OK` is asserted.

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

insert into auth.users (id, email, raw_user_meta_data) values
  ('51510000-0000-0000-0000-00000000a11d','andi@talaliving.com','{"full_name":"Andi Prasetyo"}'),
  ('51510000-0000-0000-0000-00000000ce00','evin@talaliving.com','{"full_name":"Evin Jonathan"}'),
  ('51510000-0000-0000-0000-00000000f11a','rina@talaliving.com','{"full_name":"Rina Kartika"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('51510000-0000-0000-0000-00000000a11d','procurement','write'),
  ('51510000-0000-0000-0000-00000000ce00','procurement','write'),
  ('51510000-0000-0000-0000-00000000f11a','procurement','write'),
  ('51510000-0000-0000-0000-00000000f11a','accounting','write');
insert into ops_core.user_authorities (user_id, authority) values
  ('51510000-0000-0000-0000-00000000ce00','approve_goods'),
  ('51510000-0000-0000-0000-00000000f11a','approve_funds'),
  ('51510000-0000-0000-0000-00000000f11a','post_ledger'),
  ('51510000-0000-0000-0000-00000000f11a','resolve_inbox');
insert into ops_procure.projects (code, name) values ('25777','HOTEL SIMULASI');

-- Uploads go to Google Drive through `/api/documents/upload`, which ends in
-- `ops_core.attach_file` as the person. Drive is not here, so the files are
-- made by calling that same seam — the row the route would have written.
set local role authenticated;
set local request.jwt.claim.sub = '51510000-0000-0000-0000-00000000a11d';

-- ═════ 1. DATA MASTER ═════════════════════════════════════════════════════
do $$
declare r jsonb;
begin
  r := ops_procure.create_vendor('CV SIMULASI KAYU');
  assert ops_core.said_ok(r), format('vendor: %s', r);
  perform pg_temp.log('1. Data master','Tambah supplier baru','Andi','/master-data/suppliers',
    'ops_procure.create_vendor','OK', 'belum dikurasi',
    'Kode '|| (r->'data'->>'code') ||'. Nama yang diketik selalu diterima; kurasi menyusul.');

  r := ops_procure.create_item('Plywood 18mm simulasi','raw-wood','lembar');
  assert ops_core.said_ok(r), format('item: %s', r);
  perform pg_temp.log('1. Data master','Tambah barang baru','Andi','/master-data/items',
    'ops_procure.create_item','OK', null, 'Kode '|| (r->'data'->>'code'));

  r := ops_procure.create_item('Sekrup','kategori-tidak-ada');
  assert r->'error'->>'code' = 'no_such_category', format('%s', r);
  perform pg_temp.log('1. Data master','Tambah barang dengan kategori yang tidak ada','Andi','/master-data/items',
    'ops_procure.create_item','DITOLAK', null, 'no_such_category — kategori harus dipilih dari daftar.');
end $$;

-- ═════ 2. PERMINTAAN PEMBELIAN (PR) ════════════════════════════════════════
do $$
declare r jsonb; v uuid; i uuid; doc text; st text;
begin
  r := ops_procure.create_pr('[]'::jsonb, '25777');
  assert r->'error'->>'code' = 'lines_required', format('%s', r);
  perform pg_temp.log('2. PR','Simpan PR tanpa baris','Andi','/procurement/pr/new',
    'ops_procure.create_pr','DITOLAK', null, 'lines_required — PR harus punya minimal satu baris.');

  select id into v from ops_procure.vendors where name = 'CV SIMULASI KAYU';
  select id into i from ops_procure.items  where name = 'Plywood 18mm simulasi';
  r := ops_procure.create_pr(jsonb_build_array(
        jsonb_build_object('description','Plywood 18mm — meja lobi','qty',10,'uom','lembar',
          'unit_price',150000,'vendor_id',v,'item_id',i,'purpose','Meja lobi hotel'),
        jsonb_build_object('description','Ongkos kirim','item_total',300000,'vendor_id',v)),
       '25777');
  assert ops_core.said_ok(r), format('pr: %s', r);
  doc := r->'data'->>'doc_no';
  select status into st from ops_procure.pr_documents where doc_no = doc;
  assert st = 'DRAFT', st;
  perform pg_temp.log('2. PR','Isi baris PR lalu simpan sebagai draft','Andi','/procurement/pr/new',
    'ops_procure.create_pr','OK', 'PR: DRAFT',
    doc || ' — 2 baris. Baris jasa (ongkir) diisi nominal langsung, tanpa jumlah × harga.');

  r := ops_procure.submit_pr(doc);
  assert ops_core.said_ok(r), format('submit: %s', r);
  select status into st from ops_procure.pr_documents where doc_no = doc;
  assert st = 'SUBMITTED', st;
  select status::text into st from ops_procure.v_pr_line_status where line_no_full = doc || '-L01';
  perform pg_temp.log('2. PR','Tekan Submit for approval','Andi','/procurement/pr/new',
    'ops_procure.submit_pr','OK', 'PR: SUBMITTED · baris: ' || st, null);

  r := ops_procure.submit_pr(doc);
  perform pg_temp.log('2. PR','Submit PR yang sama sekali lagi','Andi','/procurement/pr/documents',
    'ops_procure.submit_pr', case when r->'error'->>'code' = 'already_submitted' then 'DITOLAK' else 'TEMUAN' end,
    null, coalesce(r->'error'->>'code', r->>'outcome'));
end $$;

-- ═════ 3. PERSETUJUAN BARANG ═══════════════════════════════════════════════
do $$
declare r jsonb; doc text; att jsonb;
begin
  select doc_no into doc from ops_procure.pr_documents order by created_at desc limit 1;

  r := ops_procure.approve_line(doc || '-L01', true, null, null, null, null);
  assert r->'error'->>'code' = 'authority_required', format('%s', r);
  perform pg_temp.log('3. Persetujuan barang','Staf mencoba menyetujui sendiri','Andi','/procurement/meeting',
    'ops_procure.approve_line','DITOLAK', null, 'authority_required — hanya pemegang approve_goods.');

  r := ops_procure.request_approval(array[doc || '-L01']);
  assert r->'error'->>'code' = 'support_required', format('%s', r);
  perform pg_temp.log('3. Persetujuan barang','Kirim ke Chat tanpa bukti harga','Andi','/procurement/meeting',
    'ops_procure.request_approval','DITOLAK', null,
    'support_required — lampirkan penawaran/link toko dulu; angka tanpa bukti tidak dikirim ke HP pimpinan.');

  att := ops_core.attach_url('https://toko.example/plywood-18', 'penawaran-plywood');
  assert ops_core.said_ok(att), format('attach_url: %s', att);
  r := ops_core.attach_link((att->'data'->>'attachment_id')::uuid, 'pr_line', doc || '-L01', 'quotation');
  assert ops_core.said_ok(r), format('attach_link: %s', r);
  perform pg_temp.log('3. Persetujuan barang','Lampirkan penawaran di baris PR','Andi','/procurement/pr',
    'ops_core.attach_url + attach_link','OK', null, 'Bukti harga menempel di baris L01.');

  r := ops_procure.request_approval(array[doc || '-L01']);
  assert ops_core.said_ok(r), format('request: %s', r);
  perform pg_temp.log('3. Persetujuan barang','Kirim permintaan persetujuan ke Chat','Andi','/procurement/meeting',
    'ops_procure.request_approval','OK', 'menunggu jawaban',
    'Terkirim ke ' || (r->'data'->>'sent_to') || ' — dicari dari siapa yang memegang approve_goods.');
end $$;

-- Evin answers the card from Chat. The worker calls `answer_request` with the
-- signed identity; here Evin is simply the signed-in person.
set local request.jwt.claim.sub = '51510000-0000-0000-0000-00000000ce00';
do $$
declare r jsonb; tok text; doc text; st text; att jsonb;
begin
  select doc_no into doc from ops_procure.pr_documents order by created_at desc limit 1;
  select token into tok from ops_procure.approval_requests where answered_at is null limit 1;
  r := ops_procure.answer_request(tok, true, 'evin@talaliving.com');
  assert ops_core.said_ok(r), format('answer: %s', r);
  select status::text into st from ops_procure.v_pr_line_status where line_no_full = doc || '-L01';
  assert st = 'APPROVED', st;
  perform pg_temp.log('3. Persetujuan barang','Pimpinan menyetujui dari kartu Chat','Evin','Google Chat',
    'ops_procure.answer_request','OK', 'baris L01: ' || st, null);

  -- The lump-sum line is decided in the room, on the meeting board — and the
  -- rule about support holds there too.
  r := ops_procure.approve_line(doc || '-L02', true, null, 250000, null, 'Nego jadi 250 ribu');
  assert r->'error'->>'code' = 'support_required', format('%s', r);
  perform pg_temp.log('3. Persetujuan barang','Setujui ongkir di papan rapat tanpa bukti','Evin','/procurement/meeting',
    'ops_procure.approve_line','DITOLAK', null,
    'support_required — pimpinan pun tidak bisa menyetujui angka yang tidak ada buktinya.');

  att := ops_core.attach_url('https://chat.example/ongkir-vendor', 'chat-ongkir');
  perform ops_core.attach_link((att->'data'->>'attachment_id')::uuid, 'pr_line', doc || '-L02', 'quotation');
  r := ops_procure.approve_line(doc || '-L02', true, null, 250000, null, 'Nego jadi 250 ribu');
  assert ops_core.said_ok(r), format('approve L02: %s', r);
  select status::text into st from ops_procure.v_pr_line_status where line_no_full = doc || '-L02';
  assert st = 'APPROVED', st;
  perform pg_temp.log('3. Persetujuan barang','Lampirkan chat ongkir, lalu setujui dengan nominal dikurangi','Evin','/procurement/meeting',
    'ops_procure.approve_line','OK', 'baris L02: ' || st,
    'Disetujui 250.000 dari 300.000 yang diminta; yang diminta tetap tercatat.');
end $$;

-- ═════ 4. PURCHASE ORDER ═══════════════════════════════════════════════════
set local request.jwt.claim.sub = '51510000-0000-0000-0000-00000000a11d';
do $$
declare r jsonb; vcode text; po text; st text; n int; doc text;
begin
  select code into vcode from ops_procure.vendors where name = 'CV SIMULASI KAYU';
  select doc_no into doc from ops_procure.pr_documents order by created_at desc limit 1;

  r := ops_procure.create_po(vcode, jsonb_build_array(
        jsonb_build_object('description','Plywood 18mm','qty',10,'uom','lembar','unit_price',0)));
  assert r->'error'->>'code' = 'price_required', format('%s', r);
  perform pg_temp.log('4. PO','Buat PO dengan harga kosong','Andi','/procurement/po',
    'ops_procure.create_po','DITOLAK', null, 'price_required — nilai kontrak harus disepakati.');

  -- The delivery charge is a lump sum: money, not goods (A1).
  r := ops_procure.create_po(vcode, jsonb_build_array(
        jsonb_build_object('description','Ongkos kirim','qty',1,'uom','unit','unit_price',250000,'pr_line_no', doc || '-L02')));
  assert r->'error'->>'code' = 'lump_sum_line', format('%s', r);
  perform pg_temp.log('4. PO','Pilih baris ongkir (tanpa jumlah) sebagai baris PO','Andi','/procurement/po',
    'ops_procure.create_po','DITOLAK', null,
    'lump_sum_line — baris tanpa jumlah adalah uang, bukan barang; dibayar lewat barisnya, tidak dipesan.');

  r := ops_procure.create_po(vcode, jsonb_build_array(
        jsonb_build_object('description','Plywood 18mm — meja lobi','qty',10,'uom','lembar','unit_price',150000,
                           'pr_line_no', doc || '-L01')),
        30, 'DP 30%, pelunasan saat barang datang.', ops_core.office_day() + 7);
  assert ops_core.said_ok(r), format('po: %s', r);
  po := r->'data'->>'po_no';
  select status into st from ops_procure.purchase_orders where po_no = po;
  select count(*) into n from ops_procure.po_schedule s join ops_procure.purchase_orders p on p.id = s.po_id where p.po_no = po;
  assert st = 'DRAFT' and n = 2;
  assert ops_procure.order_of_line(doc || '-L01') = po, 'the request line knows its order';
  perform pg_temp.log('4. PO','Add new PO → pilih baris PR yang disetujui di "From request line", DP 30%','Andi','/procurement/po',
    'ops_procure.create_po','OK', 'PO: DRAFT',
    po || ' — terisi dari baris ' || doc || '-L01 dan tersambung ke baris itu; 2 termin otomatis: DP saat issue, pelunasan saat barang diterima.');

  r := ops_procure.create_po(vcode, jsonb_build_array(
        jsonb_build_object('description','Plywood 18mm','qty',10,'uom','lembar','unit_price',150000,'pr_line_no', doc || '-L01')));
  assert r->'error'->>'code' = 'line_already_ordered', format('%s', r);
  perform pg_temp.log('4. PO','Pesan baris PR yang sama di PO kedua','Andi','/procurement/po',
    'ops_procure.create_po','DITOLAK', null, 'line_already_ordered — baris itu sudah dipesan di ' || po || '.');

  r := ops_procure.issue_po(po);
  assert r->'error'->>'code' = 'not_approved', format('%s', r);
  perform pg_temp.log('4. PO','Issue PO sebelum dikonfirmasi pimpinan','Andi','/procurement/po/[po]',
    'ops_procure.issue_po','DITOLAK', 'PO: DRAFT', 'not_approved — PO adalah janji atas nama perusahaan.');

  r := ops_procure.request_po_approval(p_po_no => po);
  assert ops_core.said_ok(r), format('ask: %s', r);
  perform pg_temp.log('4. PO','Tekan Ask leadership to confirm','Andi','/procurement/po/[po]',
    'ops_procure.request_po_approval','OK', 'PO: DRAFT · menunggu konfirmasi', null);
end $$;

set local request.jwt.claim.sub = '51510000-0000-0000-0000-00000000ce00';
do $$
declare r jsonb; po text;
begin
  select po_no into po from ops_procure.purchase_orders order by created_at desc limit 1;
  r := ops_procure.approve_po(p_po_no => po, p_note => 'OK, sesuai penawaran.');
  assert ops_core.said_ok(r), format('approve_po: %s', r);
  perform pg_temp.log('4. PO','Pimpinan menekan Confirm it','Evin','/procurement/po/[po]',
    'ops_procure.approve_po','OK', 'PO: DRAFT · dikonfirmasi', 'self_confirmed = false (ada yang diminta).');
end $$;

set local request.jwt.claim.sub = '51510000-0000-0000-0000-00000000a11d';
do $$
declare r jsonb; po text; st text; payable numeric;
begin
  select po_no into po from ops_procure.purchase_orders order by created_at desc limit 1;
  r := ops_procure.issue_po(po);
  assert ops_core.said_ok(r), format('issue: %s', r);
  select status, payable_now into st, payable from ops_procure.v_po_detail where po_no = po;
  assert st = 'ISSUED' and payable = 450000, format('%s %s', st, payable);
  perform pg_temp.log('4. PO','Tekan Issue and send it, lalu cetak','Andi','/procurement/po/[po]/print',
    'ops_procure.issue_po','OK', 'PO: ISSUED',
    'DP sekarang jadi kewajiban: payable_now = 450.000 (30% dari 1.500.000).');
end $$;

-- ═════ 5. PENERIMAAN BARANG ════════════════════════════════════════════════
do $$
declare r jsonb; pol uuid; photo uuid; tt uuid; po text; recv numeric; doc text; st text;
begin
  select po_no into po from ops_procure.purchase_orders order by created_at desc limit 1;
  select doc_no into doc from ops_procure.pr_documents order by created_at desc limit 1;
  select l.id into pol from ops_procure.po_lines l join ops_procure.purchase_orders p on p.id = l.po_id where p.po_no = po;

  r := ops_core.attach_file('sim/foto-barang.jpg','foto-barang.jpg','image/jpeg',120000,null,'upload');
  assert ops_core.said_ok(r), format('attach_file: %s', r);
  photo := (r->'data'->>'attachment_id')::uuid;
  r := ops_core.attach_file('sim/tanda-terima.pdf','tanda-terima.pdf','application/pdf',80000,null,'upload');
  tt := (r->'data'->>'attachment_id')::uuid;

  r := ops_procure.create_receipt(10, 'GOOD', '[]'::jsonb, null, pol);
  assert r->'error'->>'code' = 'photo_required', format('%s', r);
  perform pg_temp.log('5. Penerimaan','Catat barang datang tanpa foto','Andi','/procurement/tracker/[vendor]',
    'ops_procure.create_receipt','DITOLAK', null, 'photo_required — foto barang selalu wajib.');

  -- Exactly what `ReceiveForm.tsx` sends: the display labels (B5, 0128).
  r := ops_procure.create_receipt(10, 'GOOD', jsonb_build_array(
        jsonb_build_object('attachment_id', photo, 'kind','Receiving Item'),
        jsonb_build_object('attachment_id', tt,    'kind','Delivery Note')), null, pol);
  perform pg_temp.log('5. Penerimaan','Record arrival → isi jumlah, foto barang dan tanda terima, tekan Record what arrived','Andi','/procurement/tracker/[vendor]',
    'ops_procure.create_receipt',
    case when ops_core.said_ok(r) and r->'data'->>'status' = 'CONFIRMED' then 'OK' else 'TEMUAN' end,
    'penerimaan: ' || coalesce(r->'data'->>'status', '—'),
    case when ops_core.said_ok(r) then null else
      'Ditolak ' || coalesce(r->'error'->>'code','?') || ' padahal foto ada — layar mengirim label, seam harus membacanya lewat doc_kind_of.' end);
  if not ops_core.said_ok(r) then return; end if;

  select value_received into recv from ops_procure.v_po_status
   where po_id = (select po_id from ops_procure.po_lines where id = pol);
  assert recv = 1500000, format('received %s', recv);
  select status::text into st from ops_procure.v_pr_line_status where line_no_full = doc || '-L01';
  perform pg_temp.log('5. Penerimaan','Periksa baris PR yang dibeli PO ini','Andi','/procurement/pr',
    'ops_procure.v_pr_line_status', case when st = 'PARTIAL' then 'OK' else 'TEMUAN' end, 'baris L01: ' || st,
    'Barang diterima di PO ikut menggerakkan baris PR-nya (belum lunas, jadi belum COMPLETED). Stok gudang tidak bertambah otomatis (inventory.stockFromReceipt belum tersambung).');
end $$;

-- ═════ 6. PEMBAYARAN & BUKU BESAR ══════════════════════════════════════════
do $$
declare r jsonb; po text; proof uuid;
begin
  select po_no into po from ops_procure.purchase_orders order by created_at desc limit 1;
  r := ops_core.attach_file('sim/bukti-transfer.jpg','bukti-transfer.jpg','image/jpeg',90000,null,'upload');
  proof := (r->'data'->>'attachment_id')::uuid;
  r := ops_acct.post_to_po(po, 450000, 'BCA 271', 'SUPPLIERS', proof);
  assert r->'error'->>'code' = 'authority_required', format('%s', r);
  perform pg_temp.log('6. Pembayaran','Staf procurement mencoba membayar DP PO','Andi','/procurement/po/[po]',
    'ops_acct.post_to_po','DITOLAK', null, 'authority_required — hanya pemegang post_ledger (keuangan).');
end $$;

set local request.jwt.claim.sub = '51510000-0000-0000-0000-00000000f11a';
do $$
declare r jsonb; doc text; po text; proof uuid; trx text; st text; ps text; bal_before numeric; bal_after numeric; cov numeric;
begin
  select doc_no into doc from ops_procure.pr_documents order by created_at desc limit 1;
  select po_no into po from ops_procure.purchase_orders order by created_at desc limit 1;
  select balance into bal_before from ops_acct.v_account_balance where code = 'BCA 271';

  r := ops_acct.post_to_po(po, 450000, 'BCA 271', 'SUPPLIERS', null);
  assert r->'error'->>'code' = 'evidence_required', format('%s', r);
  perform pg_temp.log('6. Pembayaran','Bayar DP tanpa bukti transfer','Rina','/procurement/po/[po]',
    'ops_acct.post_to_po','DITOLAK', null, 'evidence_required — tanpa bukti, tidak ada pembayaran.');

  r := ops_core.attach_file('sim/bukti-dp.jpg','bukti-dp.jpg','image/jpeg',90000,null,'upload');
  proof := (r->'data'->>'attachment_id')::uuid;
  r := ops_acct.post_to_po(po, 450000, 'BCA 271', 'SUPPLIERS', proof);
  assert ops_core.said_ok(r), format('post_to_po: %s', r);
  select payment_state::text into ps from ops_procure.v_po_status where po_no = po;
  select covered into cov from ops_procure.v_line_coverage where line_no_full = doc || '-L01';
  assert ps = 'PARTIAL' and cov = 450000, format('%s %s', ps, cov);
  perform pg_temp.log('6. Pembayaran','Pay this order: bayar DP 450.000 dari halaman PO','Rina','/procurement/po/[po]',
    'ops_acct.post_to_po → post_transaction + alokasi','OK', 'PO: ' || ps || ' · baris L01 terbayar 450.000',
    (r->'data'->>'trx_no') || ' — satu baris buku besar; karena PO tersambung ke L01, uangnya terbaca di PO dan di baris PR sekaligus.');

  r := ops_core.attach_file('sim/bukti-pelunasan.jpg','bukti-pelunasan.jpg','image/jpeg',90000,null,'upload');
  proof := (r->'data'->>'attachment_id')::uuid;
  r := ops_acct.post_from_line(p_line_no => doc || '-L01', p_amount => 1050000,
        p_account_code => 'BCA 271', p_type_code => 'SUPPLIERS', p_attachment_id => proof);
  assert ops_core.said_ok(r), format('post_from_line: %s', r);
  trx := r->'data'->>'trx_no';
  select payment_state::text into ps from ops_procure.v_po_status where po_no = po;
  select status::text into st from ops_procure.v_pr_line_status where line_no_full = doc || '-L01';
  assert ps = 'SETTLED', ps;
  perform pg_temp.log('6. Pembayaran','Lunasi dari baris PR: Post Rp… to the ledger','Rina','/procurement/pr',
    'ops_acct.post_from_line → post_transaction + allocate_payment','OK', 'PO: ' || ps || ' · baris L01: ' || st,
    trx || ' — dicatat di baris PR, tetapi PO ikut lunas karena alokasinya menyebut PO-nya.');

  -- The delivery charge has no quantity (D75), and SUPPLIERS is a purchase
  -- type that asks every detail line for one. Refused `line_detail_required`
  -- until 0131 (B9, D298): the ledger detail now says 1 lot at the amount paid.
  -- Still logged rather than asserted, so a regression reads as a finding.
  r := ops_core.attach_file('sim/bukti-ongkir.jpg','bukti-ongkir.jpg','image/jpeg',90000,null,'upload');
  proof := (r->'data'->>'attachment_id')::uuid;
  r := ops_acct.post_from_line(p_line_no => doc || '-L02', p_amount => 250000,
        p_account_code => 'BCA 271', p_type_code => 'SUPPLIERS', p_attachment_id => proof);
  select status::text into st from ops_procure.v_pr_line_status where line_no_full = doc || '-L02';
  perform pg_temp.log('6. Pembayaran','Bayar ongkir (baris tanpa jumlah) dari barisnya, jenis SUPPLIERS','Rina','/procurement/pr',
    'ops_acct.post_from_line', case when ops_core.said_ok(r) then 'OK' else 'TEMUAN' end, 'baris L02: ' || st,
    case when ops_core.said_ok(r) then
      'Detail buku besar: ' || (select format('%s %s × %s', tl.qty, tl.uom, tl.unit_price)
        from ops_acct.transaction_lines tl join ops_acct.transactions t on t.id = tl.trx_id
       where t.trx_no = r->'data'->>'trx_no' limit 1) || ' — baris PR-nya tetap tanpa jumlah.' else
      coalesce(r->'error'->>'code','?') || ' — jenis SUPPLIERS mewajibkan jumlah dan harga satuan di detail, padahal baris jasa lump-sum memang tidak punya jumlah (D75). Layar menawarkan jalan ini, buku besar menolaknya.' end);

  select balance into bal_after from ops_acct.v_account_balance where code = 'BCA 271';
  assert bal_before - bal_after = 1500000 + case when ops_core.said_ok(r) then 250000 else 0 end,
    format('balance moved %s', bal_before - bal_after);
end $$;

-- ═════ 7. MELENGKAPI TRANSAKSI ═════════════════════════════════════════════
do $$
declare r jsonb; trx text; st text;
begin
  select trx_no into trx from ops_acct.transactions order by posted_at desc limit 1;
  r := ops_acct.complete_transaction(trx);
  select status into st from ops_acct.transactions where trx_no = trx;
  perform pg_temp.log('7. Lengkapi transaksi','Tekan Mark completed','Rina','/accounting/ledger',
    'ops_acct.complete_transaction',
    case when ops_core.said_ok(r) then 'OK' else 'DITOLAK' end, 'transaksi: ' || st,
    coalesce(r->'error'->>'code', 'Bukti transfer sudah menempel, jadi transaksi bisa ditandai lengkap.'));
end $$;

-- ═════ 8. VERIFIKASI (KOTAK MASUK BUKTI) ═══════════════════════════════════
-- A receipt photographed in the field and sent to the capture worker, which
-- files it as the service. It lands PENDING for finance to resolve.
set local role postgres;
select ops_acct.file_evidence('sim-inb-01','nota-bensin.jpg','https://drive.example/nota-bensin',
       'chat','andi@talaliving.com');
set local role authenticated;
set local request.jwt.claim.sub = '51510000-0000-0000-0000-00000000f11a';
do $$
declare r jsonb; trx text; st text;
begin
  select trx_no into trx from ops_acct.transactions order by posted_at desc limit 1;
  perform pg_temp.log('8. Verifikasi','Bukti masuk dari Chat ke kotak verifikasi','sistem','/accounting/verifikasi',
    'ops_acct.file_evidence','OK', 'PENDING', null);

  r := ops_acct.resolve_inbox('sim-inb-01','REJECTED');
  assert r->'error'->>'code' = 'reason_required', format('%s', r);
  perform pg_temp.log('8. Verifikasi','Tolak tanpa alasan','Rina','/accounting/verifikasi',
    'ops_acct.resolve_inbox','DITOLAK', null, 'reason_required — pengirim perlu tahu kenapa.');

  r := ops_acct.resolve_inbox('sim-inb-01','ATTACHED', trx, 'Nota pendukung pembayaran plywood');
  assert ops_core.said_ok(r), format('resolve: %s', r);
  select status::text into st from ops_acct.evidence_inbox where ref_id = 'sim-inb-01';
  perform pg_temp.log('8. Verifikasi','Link to a row — tempel ke transaksi yang ada','Rina','/accounting/verifikasi',
    'ops_acct.resolve_inbox','OK', st, null);
end $$;

-- ═════ 9. REKENING KORAN ═══════════════════════════════════════════════════
do $$
declare r jsonb; line uuid; trx text; amt numeric; st text; d date := ops_core.office_day();
begin
  select trx_no, amount_idr into trx, amt from ops_acct.transactions
   where account_id = (select id from ops_acct.accounts where code = 'BCA 271')
   order by posted_at desc limit 1;
  r := ops_acct.import_statement('BCA 271', date_trunc('month', d)::date,
        (date_trunc('month', d) + interval '1 month - 1 day')::date,
        0, 0, 'IDR', 'rk-simulasi.pdf',
        jsonb_build_array(
          jsonb_build_object('value_date', d, 'direction','OUT','amount',amt,'raw_description','TRSF KE CV SIMULASI KAYU'),
          jsonb_build_object('value_date', d, 'direction','OUT','amount',amt - 50000,'raw_description','TRSF LAIN')));
  perform pg_temp.log('9. Rekening koran','Upload rekening koran bulan ini','Rina','/accounting/rekening-koran',
    'ops_acct.import_statement', case when ops_core.said_ok(r) then 'OK' else 'TEMUAN' end, null,
    coalesce(r->'error'->>'code' || ': ' || (r->'error'->>'message'), '2 baris masuk, status unmatched.'));
  if not ops_core.said_ok(r) then return; end if;

  select id into line from ops_acct.statement_lines where raw_description = 'TRSF LAIN';
  r := ops_acct.match_statement_line(line, trx);
  perform pg_temp.log('9. Rekening koran','Cocokkan baris bank yang nominalnya beda','Rina','/accounting/rekening-koran',
    'ops_acct.match_statement_line', case when r->'error'->>'code' = 'amount_differs' then 'DITOLAK' else 'TEMUAN' end,
    null, coalesce(r->'error'->>'code', r->>'outcome'));

  select id into line from ops_acct.statement_lines where raw_description = 'TRSF KE CV SIMULASI KAYU';
  r := ops_acct.match_statement_line(line, trx);
  assert ops_core.said_ok(r), format('match: %s', r);
  select status::text into st from ops_acct.statement_lines where id = line;
  perform pg_temp.log('9. Rekening koran','Pilih saran di bawah "Mirip dengan:"','Rina','/accounting/rekening-koran',
    'ops_acct.match_statement_line','OK', 'baris bank: ' || st, 'Transaksi buku besar terbukti keluar dari bank.');
end $$;

-- The whole week, one row per thing somebody did. `simulate.sh` prints this.
select n, proses, langkah, pelaku, layar, seam, hasil, status, catatan from sim_log order by n;

-- Every OK and DITOLAK above is asserted; what is left is the list of findings.
do $$
declare n int;
begin
  select count(*) into n from sim_log where hasil = 'TEMUAN';
  raise notice 'simulasi procurement → buku besar: % langkah, % temuan',
    (select count(*) from sim_log), n;
end $$;

rollback;
