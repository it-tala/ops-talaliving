-- 0137 — the first module walked: procurement, through to the ledger.
--
-- Written from `supabase/local/smoke/99_sim_procure_to_ledger.sql`, which
-- walks this exact flow against the ladder as three people (staf procurement,
-- pimpinan, keuangan) and logs every step. A status named here is the status
-- that walk read back; a refusal named here is one it hit.
--
-- The button labels are the screen's own words, in the language the screen
-- prints them — mostly English today — because *tekan "Issue and send it"* is
-- only useful if that is what the button says.
--
-- Three findings from the walk are written into the FAQ as they stand today,
-- marked *(sementara)*, because a guide that pretends a broken step works
-- sends somebody to press a button that fails. The migration that fixes each
-- one removes its row.

insert into ops_asst.processes (key, module, seq, title, purpose, route, permission, follows, sop_ref) values
('procure.master_data', 'procurement', 10,
 'Menambah supplier dan barang',
 'Supplier dan barang adalah daftar yang dipakai semua dokumen. Nama yang diketik selalu diterima supaya pembelian tidak terjadi di luar sistem; kurasi (merapikan dan menggabungkan duplikat) dilakukan belakangan.',
 '/master-data/suppliers', 'procurement.create', null, 'procurement/01'),

('procure.create_pr', 'procurement', 20,
 'Membuat permintaan pembelian (PR)',
 'PR adalah permintaan barang atau jasa, satu dokumen berisi beberapa baris. Satuan kerjanya adalah baris: tiap baris disetujui, dibayar dan diterima sendiri-sendiri.',
 '/procurement/pr/new', 'procurement.create', 'procure.master_data', 'procurement/02'),

('procure.approve_goods', 'procurement', 30,
 'Persetujuan barang (papan rapat dan Google Chat)',
 'Pimpinan memutuskan baris mana yang boleh dibeli dan berapa nilainya. Persetujuan barang berbeda dari persetujuan uang, dan harus ada sebelum memesan ke vendor. Setiap angka yang disetujui harus punya bukti harga.',
 '/procurement/meeting', 'wewenang approve_goods', 'procure.create_pr', 'procurement/03'),

('procure.create_po', 'procurement', 40,
 'Membuat, mengonfirmasi dan mengirim purchase order (PO)',
 'PO adalah janji atas nama perusahaan kepada vendor. Dibuat sebagai draft, dikonfirmasi pimpinan, lalu di-issue. Sebelum di-issue tidak ada yang kita hutangi; sesudahnya uang muka (DP) sudah menjadi kewajiban.',
 '/procurement/po', 'procurement.create', 'procure.approve_goods', 'procurement/04'),

('procure.receive_goods', 'procurement', 50,
 'Mencatat barang datang (penerimaan)',
 'Barang yang datang dicatat terhadap baris PO, dengan foto barang (wajib) dan tanda terima yang ditandatangani. Tanpa tanda terima, penerimaan hanya dilaporkan dan belum dihitung sebagai barang diterima.',
 '/procurement/tracker', 'procurement.create', 'procure.create_po', 'procurement/05'),

('acct.pay_line', 'accounting', 60,
 'Membayar baris PR dan mencatatnya ke buku besar',
 'Membayar dan menulis baris buku besar adalah satu tindakan: uang keluar dari rekening, tercatat sebagai transaksi, dan langsung dialokasikan ke baris PR yang dibayar. Hanya keuangan (pemegang post_ledger) yang bisa, dan selalu dengan bukti transfer.',
 '/procurement/pr', 'wewenang post_ledger', 'procure.receive_goods', 'procurement/06'),

('acct.complete_transaction', 'accounting', 70,
 'Melengkapi transaksi di buku besar',
 'Transaksi yang sudah tercatat (POSTED) ditandai lengkap (COMPLETED) kalau nota atau bukti transfernya sudah menempel. Ini tanda bahwa transaksi itu sudah bisa dipertanggungjawabkan.',
 '/accounting/ledger', 'wewenang post_ledger', 'acct.pay_line', 'procurement/07'),

('acct.verify_evidence', 'accounting', 80,
 'Verifikasi bukti yang masuk (kotak verifikasi)',
 'Foto nota dan bukti yang dikirim dari lapangan lewat Chat masuk ke kotak verifikasi sebagai PENDING. Keuangan memutuskan: jadikan transaksi, tempelkan ke transaksi yang ada, catat saja, atau tolak dengan alasan. Tidak ada yang dibuang.',
 '/accounting/verifikasi', 'wewenang resolve_inbox', 'acct.pay_line', 'procurement/08'),

('acct.bank_statement', 'accounting', 90,
 'Mencocokkan rekening koran dengan buku besar',
 'Rekening koran dari bank diunggah per periode, lalu tiap baris bank dicocokkan dengan transaksi di buku besar. Ini bukti bahwa yang tercatat benar-benar keluar atau masuk bank.',
 '/accounting/rekening-koran', 'accounting.create', 'acct.complete_transaction', 'procurement/09');

insert into ops_asst.process_steps (process_key, seq, route, action, rule, status_before, status_after, writes, screenshot) values
-- master data
('procure.master_data', 1, '/master-data/suppliers', 'Buka Master data → Suppliers, tekan tombol tambah, ketik nama supplier.', 'Nama apa pun diterima dan langsung bisa dipakai. Supplier baru belum dikurasi: muncul di daftar, belum muncul di dropdown pilihan sampai dikurasi.', null, 'belum dikurasi', '{ops_procure.create_vendor}', 'procurement/01-suppliers.jpg'),
('procure.master_data', 2, '/master-data/items', 'Buka Master data → Items untuk menambah barang: nama, kategori, dan satuan dasar.', 'Kategori harus dipilih dari daftar yang ada; kategori yang tidak dikenal ditolak (no_such_category). Kode barang dibuat otomatis (I-00001).', null, null, '{ops_procure.create_item}', null),
('procure.master_data', 3, '/master-data/units', 'Kalau satuannya belum ada, tambahkan di Master data → Units, beserta konversinya.', 'Satuan dan konversi harus benar karena jumlah di PR, PO dan stok dihitung dari situ.', null, null, '{ops_procure.create_uom,ops_procure.save_uom_conversion}', null),

-- PR
('procure.create_pr', 1, '/procurement/pr', 'Buka Procurement → Requests, tekan "New request".', null, null, null, '{}', 'procurement/02-pr-board.jpg'),
('procure.create_pr', 2, '/procurement/pr/new', 'Pilih proyek, lalu isi tiap baris: barang, vendor, jumlah, satuan dan harga satuan. Nilai baris dihitung dari jumlah × harga.', 'Baris jasa (misalnya ongkos kirim) tidak punya jumlah: nominalnya diketik langsung. Kalau dihitung ulang dari jumlah × harga, hasilnya nol.', null, 'PR: DRAFT', '{ops_procure.create_pr}', 'procurement/02-pr-new.jpg'),
('procure.create_pr', 3, '/procurement/pr/new', 'Tekan "Submit for approval". Kalau belum siap, simpan sebagai draft dulu.', 'PR tanpa baris ditolak (lines_required). PR yang sudah disubmit tidak bisa disubmit lagi (already_submitted).', 'PR: DRAFT', 'PR: SUBMITTED · baris: WAITING FOR APPROVAL', '{ops_procure.submit_pr}', null),
('procure.create_pr', 4, '/procurement/pr', 'Lampirkan bukti harga di tiap baris (penawaran, link toko, atau chat vendor) dari laci baris.', 'Baris tanpa bukti harga tidak bisa dikirim untuk disetujui dan tidak bisa disetujui (support_required).', null, null, '{ops_core.attach_url,ops_core.attach_file,ops_core.attach_link}', null),

-- approval of goods
('procure.approve_goods', 1, '/procurement/meeting', 'Buka Procurement → Meeting board. Baris yang menunggu keputusan ada di sini, dengan total yang diminta.', null, 'baris: WAITING FOR APPROVAL', null, '{}', 'procurement/03-meeting.jpg'),
('procure.approve_goods', 2, '/procurement/meeting', 'Kalau pimpinan tidak di ruangan: centang barisnya lalu tekan "Send N to the approver on Chat". Kartu persetujuan dikirim ke Google Chat pemegang approve_goods.', 'Yang dikirim harus punya bukti harga, karena pimpinan tidak bisa memeriksa angka tanpa bukti dari HP. Kalau tidak ada yang memegang approve_goods, pengiriman ditolak (no_approver).', null, 'menunggu jawaban', '{ops_procure.request_approval}', null),
('procure.approve_goods', 3, null, 'Pimpinan menjawab dari kartu di Google Chat: setuju atau tidak.', 'Yang tercatat adalah akun pimpinan yang menjawab, bukan laptop rapat.', 'baris: WAITING FOR APPROVAL', 'baris: APPROVED', '{ops_procure.answer_request}', null),
('procure.approve_goods', 4, '/procurement/meeting', 'Kalau diputuskan di rapat: pemegang approve_goods mencentang baris, boleh mengurangi jumlah atau nominalnya, menambah instruksi, lalu tekan "Approve this".', 'Staf procurement tidak bisa menyetujui (authority_required). Nominal yang disetujui boleh lebih kecil dari yang diminta; yang diminta tetap tercatat.', 'baris: WAITING FOR APPROVAL', 'baris: APPROVED', '{ops_procure.approve_line}', null),

-- PO
('procure.create_po', 1, '/procurement/po', 'Buka Procurement → Purchase Orders (atau Tracker), tekan "Add new PO", pilih vendor.', 'Pastikan baris PR-nya sudah APPROVED dulu.', null, null, '{}', 'procurement/04-new-po.jpg'),
('procure.create_po', 2, '/procurement/po', 'Isi barisnya: barang, jumlah, satuan, harga satuan. Isi persen DP kalau ada uang muka, dan tanggal barang diharapkan datang. Tekan "Create the draft".', 'Harga kosong ditolak (price_required) — nilai kontrak harus disepakati. Kalau ada DP, sistem membuat dua termin: DP saat PO di-issue dan pelunasan saat barang diterima.', null, 'PO: DRAFT', '{ops_procure.create_po}', null),
('procure.create_po', 3, '/procurement/po', 'Buka PO-nya dari daftar Purchase Orders, lalu tekan "Ask leadership to confirm".', 'PO tidak bisa di-issue sebelum dikonfirmasi pimpinan (not_approved), karena PO adalah janji atas nama perusahaan.', 'PO: DRAFT', 'PO: DRAFT · menunggu konfirmasi', '{ops_procure.request_po_approval}', 'procurement/04-po-detail.jpg'),
('procure.create_po', 4, '/procurement/po', 'Pimpinan membuka PO yang sama dan menekan "Confirm it".', 'Kalau pembuat PO sendiri memegang approve_goods, ia bisa langsung mengonfirmasi; sistem mencatatnya sebagai dikonfirmasi sendiri (tidak ada orang kedua yang memeriksa).', 'PO: DRAFT', 'PO: DRAFT · dikonfirmasi', '{ops_procure.approve_po}', null),
('procure.create_po', 5, '/procurement/po', 'Tekan "Issue and send it", lalu cetak PO dari halaman cetaknya.', 'Sesudah di-issue, DP sudah menjadi kewajiban dan muncul sebagai "Payable now". Yang dicetak adalah dokumennya, tanpa menu dan sidebar.', 'PO: DRAFT', 'PO: ISSUED', '{ops_procure.issue_po}', 'procurement/04-po-print.jpg'),

-- receiving
('procure.receive_goods', 1, '/procurement/tracker', 'Buka Procurement → Tracker, pilih vendornya, lalu tekan "Record arrival" di baris PO yang barangnya datang.', null, null, null, '{}', 'procurement/05-receive.jpg'),
('procure.receive_goods', 2, '/procurement/tracker', 'Isi jumlah yang datang dan kondisinya. Unggah foto barang (wajib) dan tanda terima yang ditandatangani, lalu tekan "Record what arrived".', 'Tanpa foto ditolak (photo_required). Dengan foto dan tanda terima sekaligus, penerimaan langsung CONFIRMED dan dihitung sebagai barang diterima.', null, 'penerimaan: CONFIRMED', '{ops_procure.create_receipt}', null),
('procure.receive_goods', 3, '/procurement/penerimaan', 'Kalau tanda terima belum ada (misalnya barang datang malam), catat dengan foto saja. Besoknya buka Procurement → Penerimaan, tekan "Complete it" lalu "Confirm it".', 'Penerimaan yang baru dilaporkan (REPORTED) belum bernilai apa pun sampai ada orang yang mengonfirmasi.', 'penerimaan: REPORTED', 'penerimaan: CONFIRMED', '{ops_procure.confirm_receipt}', 'procurement/05-penerimaan.jpg'),

-- pay a line
('acct.pay_line', 1, '/procurement/pr', 'Buka Procurement → Requests, klik baris yang sudah APPROVED untuk membuka lacinya.', 'Yang dibayar adalah baris yang sudah disetujui.', 'baris: APPROVED', null, '{}', 'procurement/06-pay-line.jpg'),
('acct.pay_line', 2, '/procurement/pr', 'Di bagian pembayaran, pilih rekening sumber, jenis transaksi (misalnya SUPPLIERS), nominal, dan unggah bukti transfer.', 'Tanpa bukti transfer ditolak (evidence_required). Staf procurement tidak bisa mencatat pembayaran (authority_required) — hanya pemegang post_ledger.', null, null, '{}', null),
('acct.pay_line', 3, '/procurement/pr', 'Tekan "Post Rp… to the ledger".', 'Satu tindakan menulis transaksi di buku besar dan mengalokasikan uangnya ke baris PR. Saldo rekening langsung berkurang.', 'baris: APPROVED', 'transaksi: POSTED · baris: PAID', '{ops_acct.post_from_line,ops_acct.post_transaction,ops_acct.allocate_payment}', null),
('acct.pay_line', 4, '/accounting/ledger', 'Transaksinya bisa dilihat di Accounting → Ledger.', null, null, null, '{}', 'procurement/07-ledger.jpg'),

-- complete
('acct.complete_transaction', 1, '/accounting/ledger', 'Buka Accounting → Ledger, klik transaksinya untuk membuka lacinya.', null, 'transaksi: POSTED', null, '{}', null),
('acct.complete_transaction', 2, '/accounting/ledger', 'Pastikan nota atau bukti transfer sudah menempel, lalu tekan "Mark completed".', 'Tanpa nota atau bukti transfer ditolak (document_required).', 'transaksi: POSTED', 'transaksi: COMPLETED', '{ops_acct.complete_transaction}', null),

-- verifikasi
('acct.verify_evidence', 1, '/accounting/verifikasi', 'Buka Accounting → Verifikasi. Bukti yang dikirim dari Chat menunggu di sini sebagai PENDING.', null, null, 'PENDING', '{ops_acct.file_evidence}', 'procurement/08-verifikasi.jpg'),
('acct.verify_evidence', 2, '/accounting/verifikasi', 'Pilih jalannya: "Make a transaction" (jadi transaksi baru), "Link to a row" (tempel ke transaksi yang sudah ada), "Retro request line" (dibeli dulu, disetujui belakangan), "Note" (catat saja), atau "Reject".', 'Menolak wajib dengan alasan (reason_required), supaya pengirim tahu kenapa.', 'PENDING', 'CONFIRMED / ATTACHED / NOTED / REJECTED', '{ops_acct.resolve_inbox}', null),

-- rekening koran
('acct.bank_statement', 1, '/accounting/rekening-koran', 'Buka Accounting → Rekening koran, unggah file rekening koran untuk satu rekening dan satu periode, lalu tekan "Masukkan N baris".', 'Periode yang sama tidak bisa diunggah dua kali (period_already_uploaded).', null, 'baris bank: unmatched', '{ops_acct.import_statement}', 'procurement/09-rekening-koran.jpg'),
('acct.bank_statement', 2, '/accounting/rekening-koran', 'Untuk tiap baris bank, pilih saran di bawah "Mirip dengan:" untuk mencocokkannya dengan transaksi buku besar.', 'Nominal atau arah yang berbeda ditolak (amount_differs, direction_differs).', 'baris bank: unmatched', 'baris bank: matched', '{ops_acct.match_statement_line}', null),
('acct.bank_statement', 3, '/accounting/rekening-koran', 'Baris bank yang belum ada di buku besar (misalnya biaya admin) dibukukan langsung dengan "Bukukan", atau dilewati dengan alasan.', 'Membukukan dari rekening koran tetap menulis transaksi, jadi perlu wewenang post_ledger.', 'baris bank: unmatched', 'baris bank: booked / ignored', '{ops_acct.book_statement_line,ops_acct.ignore_statement_line}', null);

insert into ops_asst.process_faq (process_key, question, answer) values
('procure.create_pr', 'Apa bedanya status PR dan status baris?',
 'Dokumen PR hanya DRAFT atau SUBMITTED. Yang bergerak adalah barisnya: WAITING FOR APPROVAL → APPROVED → PAID → COMPLETED. Status baris dihitung dari persetujuan dan pembayaran, tidak diketik.'),
('procure.create_pr', 'Kenapa halaman New request tidak bisa dibuka? (sementara)',
 'Saat ini halaman /procurement/pr/new masih ikut memuat daftar work order dari modul produksi, yang belum aktif di sistem live, jadi halamannya belum dibuka. Sudah dilaporkan ke IT; sementara itu PR dibuat oleh admin.'),
('procure.approve_goods', 'Siapa yang bisa menyetujui?',
 'Hanya orang yang memegang wewenang approve_goods. Staf procurement tidak bisa menyetujui barisnya sendiri. Kartu Chat dikirim ke pemegang wewenang itu, bukan ke nama yang ditulis tangan.'),
('procure.approve_goods', 'Kenapa kirim ke Chat ditolak support_required?',
 'Baris yang dikirim belum punya bukti harga. Lampirkan penawaran, link toko, atau tangkapan chat vendor di laci baris PR, lalu kirim lagi.'),
('procure.create_po', 'Kenapa tombol Issue ditolak not_approved?',
 'PO harus dikonfirmasi pimpinan dulu. Tekan "Ask leadership to confirm", tunggu pimpinan menekan "Confirm it", baru "Issue and send it".'),
('procure.create_po', 'Apakah PO otomatis tersambung ke baris PR? (sementara)',
 'Belum. Saat ini PO dibuat terpisah dari baris PR: sistem belum mencatat baris PR mana yang dibeli oleh PO tersebut. Pastikan sendiri baris PR-nya sudah APPROVED sebelum membuat PO.'),
('procure.receive_goods', 'Kenapa penerimaan ditolak photo_required padahal foto sudah diunggah? (sementara)',
 'Ini kesalahan sistem yang sudah ditemukan saat simulasi: layar penerimaan mengirim jenis dokumen dengan nama tampilan, sedangkan database mengharapkan kodenya. Sudah dilaporkan ke IT untuk diperbaiki.'),
('procure.receive_goods', 'Apakah stok gudang bertambah otomatis saat barang diterima?',
 'Belum. Penerimaan di procurement belum tersambung ke stok inventory; stok masuk dicatat terpisah di modul inventory.'),
('acct.pay_line', 'Siapa yang boleh mencatat pembayaran?',
 'Hanya keuangan yang memegang wewenang post_ledger, dan selalu dengan bukti transfer.'),
('acct.pay_line', 'Bagaimana membayar DP PO? (sementara)',
 'Belum ada tombol untuk membayar termin PO langsung. Pembayaran dicatat ke baris PR yang disetujui lewat "Post Rp… to the ledger". Termin di halaman PO akan tetap terbaca belum dibayar sampai fiturnya tersedia.'),
('acct.complete_transaction', 'Apa bedanya POSTED dan COMPLETED?',
 'POSTED berarti uangnya sudah tercatat di buku besar. COMPLETED berarti dokumennya (nota atau bukti transfer) sudah lengkap menempel.'),
('acct.bank_statement', 'Kenapa pencocokan ditolak amount_differs?',
 'Nominal di baris bank tidak sama dengan nominal transaksi di buku besar. Periksa lagi transaksinya; jangan dicocokkan ke transaksi yang berbeda nominalnya.');
