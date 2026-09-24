-- 0153 — the third module walked: production, from a client's order to the
-- signed handover.
--
-- Written from `supabase/local/smoke/99_sim_production_to_handover.sql` (four
-- people, 37 steps) and `scripts/e2e/walk-production.mjs`, which presses the
-- same buttons on the live screens. Button labels are the screens' own words.
-- The two doors the walk found shut are fixed in 0152 and the screens that go
-- with it (F155), so they are described as they now work.

insert into ops_asst.processes (key, module, seq, title, purpose, route, permission, follows, sop_ref) values
('prod.project', 'production', 10,
 'Klien dan proyek (order)',
 'Setiap pesanan dimulai sebagai proyek milik seorang klien. Status proyek bergerak sendiri mengikuti pekerjaan: INQUIRY → QUOTATION_SENT (quotation dikirim) → DEAL (disetujui) → IN_PRODUCTION (Job Order pertama) → SHIPPED (surat jalan pertama) → DONE (BAST).',
 '/proyek/order', 'project.create', null, 'produksi/01'),

('prod.product_bom', 'production', 20,
 'Produk, tahap produksi dan BOM',
 'Produk (item code) adalah yang dibuat bengkel. BOM-nya berisi bahan dari database items dan tenaga kerja dengan tarifnya, dirilis sebagai revisi. Tahap produksi dicentang per produk: meja tanpa lampu atau kabel tidak melewati Machinery.',
 '/produksi/bom', 'production.create', 'prod.project', 'produksi/02'),

('prod.quotation', 'production', 30,
 'Quotation ke klien',
 'Quotation dihitung dari biaya BOM yang dirilis ditambah persen marketing, overhead dan margin. Dikirim ke klien, dan kalau disetujui, itemnya langsung menjadi baris order proyek.',
 '/proyek/quotation', 'project.update', 'prod.product_bom', 'produksi/03'),

('prod.job_order', 'production', 40,
 'Job Order (SPK)',
 'Job Order dibuat dari baris order proyek, sehingga yang dibuat bengkel terhitung terhadap yang dipesan klien. Job Order mengunci revisi BOM yang dirilis terakhir.',
 '/proyek/order', 'production.create', 'prod.quotation', 'produksi/04'),

('prod.materials', 'production', 50,
 'Bahan: PR dari BOM',
 'Kebutuhan bahan satu Job Order dihitung dari BOM-nya (dengan susut) dan dijadikan draft PR. Tiap baris membawa nomor Job Order dan item-nya, supaya proyeksi dan belanja nyata bisa dibandingkan.',
 '/produksi/jadwal', 'procurement.create', 'prod.job_order', 'produksi/05'),

('prod.progress', 'production', 60,
 'Progres produksi dan vendor',
 'Progres dicatat per tahap per hari. Barang yang dikerjakan di luar (finishing, jok) dicatat keluar ke vendor dan kembali. Job Order ditutup setelah semua tahapnya selesai.',
 '/produksi/jadwal', 'production.update', 'prod.job_order', 'produksi/06'),

('prod.packing', 'production', 70,
 'Mengemas peti dan label',
 'Barang jadi dikemas per peti dengan tujuan di dalam gedung klien dan isinya. Tiap peti punya label dengan QR yang dibuka tim di lokasi.',
 '/proyek/peti', 'delivery.create', 'prod.progress', 'produksi/07'),

('prod.delivery', 'production', 80,
 'Surat jalan dan barang sampai',
 'Surat jalan hanya boleh berisi yang sudah selesai dibuat. Sampai di lokasi dicatat dengan foto surat jalan yang ditandatangani penerima.',
 '/proyek/pengiriman', 'delivery.create', 'prod.packing', 'produksi/08'),

('prod.installation', 'production', 90,
 'Pemasangan dan temuan',
 'Pemasangan dicatat per kunjungan: berapa unit terpasang dan oleh tim siapa. Yang salah dicatat sebagai temuan dan ditutup dengan keterangan perbaikannya.',
 '/proyek/instalasi', 'delivery.create', 'prod.delivery', 'produksi/09'),

('prod.handover', 'production', 100,
 'Serah terima (BAST)',
 'Serah terima dicatat dengan BAST yang sudah ditandatangani kedua pihak. Setelah itu proyek selesai (DONE).',
 '/proyek/serah-terima', 'project.handover', 'prod.installation', 'produksi/10');

insert into ops_asst.process_steps (process_key, seq, route, action, rule, status_before, status_after, writes, screenshot) values
('prod.project', 1, '/master-data/clients', 'Buka Master data → Clients, tekan "Klien baru", isi nama klien, kontak, telepon dan alamat, lalu "Simpan". Klien juga bisa dibuat langsung dari laci proyek.', 'Nama klien wajib (name_required); nama yang sudah ada ditolak (client_exists).', null, 'klien baru', '{ops_procure.save_client}', null),
('prod.project', 2, '/proyek/order', 'Buka Proyek → Order, tekan "Proyek baru". Pilih klien, isi lokasi, penanggung jawab, tanggal mulai dan jadwal kirim, lalu "Simpan".', 'Kosongkan kode proyek untuk nomor otomatis. Jadwal kirim sebelum tanggal mulai ditolak (dates_reversed).', null, 'INQUIRY', '{ops_procure.save_project}', 'produksi/01-proyek.jpg'),

('prod.product_bom', 1, '/produksi/bom', 'Buka Produksi → BOM, tekan "Produk baru". Isi item code, kategori, nama, satuan dan ukuran, centang tahap produksi yang dilewati, lalu "Simpan". Produk juga bisa dibuat dari baris order dengan "Jadikan item code".', 'Item code tidak pernah diubah lagi. Tanpa centang, Job Order-nya menunggu keempat tahap termasuk Machinery.', null, 'produk tanpa BOM', '{ops_prod.save_product}', 'produksi/02-produk.jpg'),
('prod.product_bom', 2, '/produksi/bom', 'Buka produknya, tekan "Tambah komponen". Pilih "Dari database items" untuk bahan (jumlah, satuan, susut) atau "Tenaga kerja" untuk upah (nama, satuan, tarif), lalu "Tambah".', 'Tenaga kerja tanpa tarif ditolak (rate_required). Barang yang belum ada di database bisa dibuat dengan "Buat item".', null, 'draft BOM', '{ops_prod.save_bom_line,ops_prod.create_bom_item}', null),
('prod.product_bom', 3, '/produksi/bom', 'Isi catatan rilis, lalu tekan "Rilis rev N".', 'Catatan wajib (note_required). Harga bahan diambil dari harga standar atau terakhir di database items; baris tanpa harga menahan rilis (unpriced_lines).', 'draft BOM', 'rev dirilis', '{ops_prod.release_bom}', null),

('prod.quotation', 1, '/proyek/quotation', 'Buka Proyek → Quotation, tekan "Quotation baru", pilih proyek, lalu "Buat draft".', 'Satu proyek hanya punya satu draft (draft_exists).', null, 'DRAFT', '{ops_procure.save_quotation}', 'produksi/03-quotation.jpg'),
('prod.quotation', 2, '/proyek/quotation', 'Di quotation itu tekan "Tambah item": item code, jumlah, satuan, lalu simpan. Harga jual dihitung dari biaya BOM ditambah persen; bisa ditetapkan manual.', 'Item tanpa biaya (BOM belum dirilis dan tanpa ongkos manual) menahan pengiriman (cost_missing).', 'DRAFT', 'DRAFT', '{ops_procure.save_quotation_line}', null),
('prod.quotation', 3, '/proyek/quotation', 'Tekan "Kirim ke klien".', 'Quotation tanpa item ditolak (no_lines). Proyek pindah ke QUOTATION_SENT.', 'DRAFT', 'SENT', '{ops_procure.send_quotation}', null),
('prod.quotation', 4, '/proyek/quotation', 'Kalau klien setuju tekan "Disetujui"; kalau menolak tekan "Ditolak", tulis alasannya, lalu "Catat ditolak". Untuk mengubah harga setelah dikirim pakai "Revisi".', 'Menolak wajib beralasan (reason_required). Disetujui menyalin item menjadi baris order dan memindahkan proyek ke DEAL.', 'SENT', 'ACCEPTED / REJECTED', '{ops_procure.decide_quotation,ops_procure.revise_quotation}', null),

('prod.job_order', 1, '/proyek/order', 'Buka proyeknya di Proyek → Order. Pada baris order tekan "Buat Job Order", isi jumlah, jatuh tempo dan rute (Bengkel sendiri / Lewat vendor), lalu "Buat".', 'Tombol muncul setelah baris punya item code. Job Order dari baris order ikut terhitung "sudah dibuat" saat surat jalan; Job Order yang dibuat di Produksi → Jadwal tanpa proyek tidak.', null, 'OPEN · proyek IN_PRODUCTION', '{ops_prod.create_work_order}', 'produksi/04-job-order.jpg'),

('prod.materials', 1, '/produksi/jadwal', 'Buka Produksi → Jadwal, klik Job Order-nya, lalu di bagian bahan tekan "Buat PR dari BOM".', 'Butuh akses procurement. PR dibuat sebagai draft: tiap baris membawa nomor Job Order dan item-nya; tenaga kerja tidak ikut.', null, 'PR DRAFT', '{ops_procure.create_pr}', 'produksi/05-pr-bom.jpg'),
('prod.materials', 2, '/procurement/pr', 'Buka PR itu di Procurement → Requests, periksa jumlah dan harga, lalu "Submit for approval". Selanjutnya mengikuti SOP procurement.', null, 'PR DRAFT', 'SUBMITTED', '{ops_procure.submit_pr}', null),

('prod.progress', 1, '/produksi/jadwal', 'Di laci Job Order pilih tahap, isi jumlah, tanggal dan siapa yang mengerjakan, lalu "Catat".', 'Tahap yang tidak dilewati produk ditolak (stage_not_on_product). Melebihi jumlah order ditolak (over_order). Koreksi pakai jumlah negatif dengan catatan.', null, null, '{ops_prod.record_progress}', 'produksi/06-progres.jpg'),
('prod.progress', 2, '/produksi/jadwal', 'Untuk dikerjakan di vendor (misalnya finishing atau jok): pada Job Order bengkel sendiri tekan "Kirim ke vendor" dulu. Pilih proses dan vendor, isi jumlah dan tanggal dijanjikan kembali, lalu "Catat dikirim". Saat kembali tekan "Catat kembali".', 'Tanggal janji di masa lalu ditolak (promise_in_past). Yang kembali tidak boleh melebihi yang dikirim (over_sent).', null, 'di vendor → kembali', '{ops_prod.send_to_vendor,ops_prod.receive_from_vendor}', null),
('prod.progress', 3, '/produksi/jadwal', 'Setelah semua tahap selesai tekan "Tutup Job Order", lalu "Tutup".', 'Menutup sebelum selesai wajib beralasan.', 'OPEN', 'DONE', '{ops_prod.close_work_order}', null),

('prod.packing', 1, '/proyek/peti', 'Buka Proyek → Peti, tekan "Kemas peti". Pilih proyek, isi tujuan di dalam gedung dan isi peti, lalu "Kemas & beri label". Cetak labelnya dengan "Cetak label".', 'Tujuan dan isi wajib (destination_required, contents_required).', null, 'PACKED', '{ops_dlv.pack_box}', 'produksi/07-peti.jpg'),

('prod.delivery', 1, '/proyek/pengiriman', 'Buka Proyek → Pengiriman, tekan "Buat surat jalan". Isi jumlah per baris, centang peti yang ikut, isi sopir dan kendaraan, lalu "Berangkatkan N".', 'Tidak boleh melebihi yang sudah selesai dibuat (not_enough_made). Proyek pindah ke SHIPPED.', null, 'IN_TRANSIT', '{ops_dlv.create_delivery}', 'produksi/08-surat-jalan.jpg'),
('prod.delivery', 2, '/proyek/pengiriman', 'Saat sampai tekan "Catat sampai", isi penerima, unggah foto surat jalan bertanda tangan (dan foto barang kalau ada), lalu "Simpan".', 'Foto surat jalan yang ditandatangani wajib (surat_jalan_required).', 'IN_TRANSIT', 'ARRIVED', '{ops_dlv.mark_arrived}', null),
('prod.delivery', 3, '/proyek/peti', 'Di lokasi, scan QR di label peti lalu tekan "Sampai di site"; setelah dipasang tekan "Terpasang", atau "Ada masalah" kalau isinya kurang atau rusak.', null, 'IN_TRANSIT', 'ON_SITE / INSTALLED / PROBLEM', '{ops_dlv.scan_box,ops_dlv.mark_box_installed,ops_dlv.flag_box_problem}', null),

('prod.installation', 1, '/proyek/instalasi', 'Buka Proyek → Instalasi, tekan "Catat pemasangan". Isi jumlah terpasang per baris dan tim yang datang; kalau ada yang salah, tulis temuannya dan tingkatnya. Lalu "Catat N unit terpasang".', 'Tidak boleh memasang lebih dari yang sudah di lokasi (not_enough_on_site).', null, 'terpasang', '{ops_dlv.record_installation,ops_dlv.raise_snag}', 'produksi/09-instalasi.jpg'),
('prod.installation', 2, '/proyek/instalasi', 'Setelah diperbaiki, pada temuan itu tekan "Tutup", tulis apa yang dikerjakan dan siapa yang memperbaiki, lalu "Simpan".', 'Keterangan perbaikan wajib (fix_note_required).', 'temuan terbuka', 'temuan selesai', '{ops_dlv.close_snag}', null),

('prod.handover', 1, '/proyek/serah-terima', 'Buka Proyek → Serah terima, tekan "Serah terima". Isi yang tanda tangan dari klien dan dari kita, unggah BAST yang sudah ditandatangani, lalu "Catat serah terima".', 'Butuh wewenang serah terima proyek; tim pengiriman saja ditolak (not_permitted). BAST wajib (bast_required).', 'SHIPPED', 'DONE', '{ops_dlv.record_handover}', 'produksi/10-bast.jpg');

insert into ops_asst.process_faq (process_key, question, answer) values
('prod.progress', 'Kenapa Job Order meja saya masih menunggu tahap Machinery?',
 'Produknya belum punya daftar tahap sendiri, jadi ikut keempat tahap rutenya. Buka produk di Produksi → BOM, tekan "Ubah", centang hanya tahap yang benar-benar dilewati (misalnya Amplas, Finishing, Packing), lalu simpan. Tahap yang sudah punya progres di Job Order terbuka tidak bisa dibuang sampai Job Order itu ditutup.'),
('prod.delivery', 'Surat jalan ditolak "not_enough_made", padahal barangnya sudah ada.',
 'Surat jalan menghitung yang sudah selesai dibuat dari Job Order yang dibuat dari baris order itu, sampai tahap terakhirnya. Pastikan Job Order dibuat dari baris order (bukan dari Jadwal tanpa proyek) dan semua tahapnya sudah dicatat.'),
('prod.materials', 'Tombol "Buat PR dari BOM" tidak muncul.',
 'Tombol itu hanya untuk yang punya akses procurement, karena yang dibuat adalah permintaan pembelian. Job Order juga harus masih OPEN dan produknya punya BOM yang dirilis.'),
('prod.quotation', 'Quotation tidak bisa dikirim karena "cost_missing".',
 'Ada item yang belum punya biaya: BOM produknya belum dirilis, atau item tanpa item code belum diberi ongkos manual. Rilis BOM-nya di Produksi → BOM, atau isi ongkos manual per unit.'),
('prod.project', 'Apakah status proyek perlu diubah manual?',
 'Biasanya tidak. Status bergerak sendiri: quotation dikirim, disetujui, Job Order pertama, surat jalan pertama, dan BAST. Tombol status di laci proyek untuk koreksi atau pembatalan (dengan alasan).');
