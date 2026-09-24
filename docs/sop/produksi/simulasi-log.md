| # | Proses | Langkah | Pelaku | Layar | Seam | Hasil | Status | Catatan |
|---|---|---|---|---|---|---|---|---|
| 1 | 1. Klien & proyek | Klien baru: nama, kontak, telepon, alamat → Simpan | Ryan | `/master-data/clients` | `ops_procure.save_client` | OK | CL-0001 |  |
| 2 | 1. Klien & proyek | Proyek baru: klien, lokasi, penanggung jawab, mulai, jadwal kirim → Simpan | Ryan | `/proyek/order` | `ops_procure.save_project` | OK | INQUIRY | Kode proyek dibuat otomatis kalau dikosongkan. |
| 3 | 2. Produk & BOM | Produk baru: item code, kategori, nama, satuan, ukuran → Simpan | Wayan | `/produksi/bom` | `ops_prod.save_product` | OK | produk tanpa BOM |  |
| 4 | 2. Produk & BOM | Tentukan tahap produksi meja (amplas, finishing, packing — tanpa machinery) | Wayan | `/produksi/bom` | `ops_prod.save_product` | OK | AMPLAS → FINISHING → PACKING | Tahap dicentang di laci produk; tanpa centang, produk ikut empat tahap rutenya (0154, F156). |
| 5 | 2. Produk & BOM | Tambah komponen dari database items: jati, cat, baut (jumlah, satuan, susut) | Wayan | `/produksi/bom` | `ops_prod.save_bom_line` | OK | draft BOM · 3 bahan |  |
| 6 | 2. Produk & BOM | Tambah tenaga kerja tanpa tarif | Wayan | `/produksi/bom` | `ops_prod.save_bom_line` | DITOLAK |  | rate_required |
| 7 | 2. Produk & BOM | Tenaga kerja: nama, satuan, tarif → Tambah | Wayan | `/produksi/bom` | `ops_prod.save_bom_line` | OK | draft BOM · 3 bahan + 1 tenaga kerja |  |
| 8 | 2. Produk & BOM | Rilis tanpa catatan | Wayan | `/produksi/bom` | `ops_prod.release_bom` | DITOLAK |  | note_required |
| 9 | 2. Produk & BOM | Isi catatan rilis → Rilis rev 1 | Wayan | `/produksi/bom` | `ops_prod.release_bom` | OK | rev 1 · biaya produksi 1553500 | Harga bahan diambil dari harga standar/terakhir di database items. |
| 10 | 3. Quotation | Quotation baru: pilih proyek → Buat draft | Ryan | `/proyek/quotation` | `ops_procure.save_quotation` | OK | DRAFT |  |
| 11 | 3. Quotation | Kirim quotation tanpa item | Ryan | `/proyek/quotation` | `ops_procure.send_quotation` | DITOLAK | DRAFT | no_lines |
| 12 | 3. Quotation | Tambah item: item code, jumlah, satuan → harga dihitung dari BOM + persen | Ryan | `/proyek/quotation` | `ops_procure.save_quotation_line` | OK | DRAFT |  |
| 13 | 3. Quotation | Kirim ke klien | Ryan | `/proyek/quotation` | `ops_procure.send_quotation` | OK | SENT · proyek QUOTATION_SENT |  |
| 14 | 3. Quotation | Klien setuju: Disetujui | Ryan | `/proyek/quotation` | `ops_procure.decide_quotation` | OK | ACCEPTED · proyek DEAL · 1 baris order | Item quotation menjadi baris order proyek. |
| 15 | 4. Job Order | Dari baris order: Buat Job Order → jumlah, jatuh tempo, rute Bengkel sendiri → Buat | Wayan | `/proyek/order` | `ops_prod.create_work_order` | OK | OPEN · BOM rev 1 · proyek IN_PRODUCTION | Job Order mengunci revisi BOM yang dirilis terakhir. |
| 16 | 5. Bahan | Buka Job Order → Buat PR dari BOM | Wayan | `/produksi/jadwal` | `ops_procure.create_pr` | OK | PR pr-26-09-24_01 DRAFT · 3 baris | Tiap baris membawa nomor Job Order-nya; PR masih harus diperiksa dan disubmit. |
| 17 | 5. Bahan | Baris PR tersambung ke database items (untuk harga terakhir dan stok) | Wayan | `/produksi/jadwal` | `ops_procure.create_pr` | OK | 3 baris bertaut item | Harga terakhir, vendor terakhir dan stok item ikut terbaca di baris PR (0154, F156). |
| 18 | 5. Bahan | Buka PR itu di Procurement → Requests, periksa, Submit for approval | Wayan | `/procurement/pr` | `ops_procure.submit_pr` | OK | SUBMITTED | Dari sini jalurnya procurement: persetujuan pimpinan, PO, barang datang. |
| 19 | 6. Progres | Catat progres: tahap Amplas, jumlah 4, tanggal, siapa → Catat | Wayan | `/produksi/jadwal` | `ops_prod.record_progress` | OK | Amplas 4/4 |  |
| 20 | 6. Progres | Catat lebih dari jumlah order | Wayan | `/produksi/jadwal` | `ops_prod.record_progress` | DITOLAK |  | over_order |
| 21 | 6. Progres | Kirim ke vendor finishing: proses, vendor, jumlah, dijanjikan kembali → Catat dikirim | Wayan | `/produksi/jadwal` | `ops_prod.send_to_vendor` | OK | leg-26-09-24_01 di vendor |  |
| 22 | 6. Progres | Barang kembali dari vendor → Catat kembali | Wayan | `/produksi/jadwal` | `ops_prod.receive_from_vendor` | OK | leg-26-09-24_01 kembali 4 |  |
| 23 | 6. Progres | Catat tahap berikutnya sampai selesai | Wayan | `/produksi/jadwal` | `ops_prod.record_progress` | OK | AMPLAS → FINISHING → PACKING |  |
| 24 | 6. Progres | Tutup Job Order | Wayan | `/produksi/jadwal` | `ops_prod.close_work_order` | OK | DONE |  |
| 25 | 7. Pengiriman | Kemas peti: proyek, tujuan di gedung, isi → Kemas & beri label (2 peti) | Komang | `/proyek/peti` | `ops_dlv.pack_box` | OK | PACKED ×2 |  |
| 26 | 7. Pengiriman | Surat jalan melebihi yang sudah dibuat | Komang | `/proyek/pengiriman` | `ops_dlv.create_delivery` | DITOLAK |  | not_enough_made |
| 27 | 7. Pengiriman | Buat surat jalan: jumlah per baris, peti yang ikut, sopir, kendaraan → Berangkatkan | Komang | `/proyek/pengiriman` | `ops_dlv.create_delivery` | OK | IN_TRANSIT · proyek SHIPPED |  |
| 28 | 7. Pengiriman | Catat sampai tanpa foto surat jalan bertanda tangan | Komang | `/proyek/pengiriman` | `ops_dlv.mark_arrived` | DITOLAK | IN_TRANSIT | surat_jalan_required |
| 29 | 7. Pengiriman | Catat sampai: penerima + foto surat jalan bertanda tangan → Simpan | Komang | `/proyek/pengiriman` | `ops_dlv.mark_arrived` | OK | ARRIVED |  |
| 30 | 7. Pengiriman | Scan QR peti di lokasi → Sampai di site | Komang | `/box` | `ops_dlv.scan_box` | OK | ON_SITE |  |
| 31 | 8. Pemasangan | Catat pemasangan: jumlah terpasang, tim → Catat N unit terpasang | Komang | `/proyek/instalasi` | `ops_dlv.record_installation` | OK | 4 terpasang |  |
| 32 | 8. Pemasangan | Peti di lokasi → Terpasang | Komang | `/box` | `ops_dlv.mark_box_installed` | OK | INSTALLED |  |
| 33 | 8. Pemasangan | Catat temuan: apa yang salah, tingkat, ditemukan siapa | Komang | `/proyek/instalasi` | `ops_dlv.raise_snag` | OK | temuan terbuka |  |
| 34 | 8. Pemasangan | Tutup temuan: keterangan perbaikan → Simpan | Komang | `/proyek/instalasi` | `ops_dlv.close_snag` | OK | temuan selesai |  |
| 35 | 9. Serah terima | Tim pengiriman mencoba mencatat BAST | Komang | `/proyek/serah-terima` | `ops_dlv.record_handover` | DITOLAK |  | not_permitted |
| 36 | 9. Serah terima | Serah terima tanpa BAST yang ditandatangani | Ryan | `/proyek/serah-terima` | `ops_dlv.record_handover` | DITOLAK |  | bast_required |
| 37 | 9. Serah terima | Serah terima: yang tanda tangan dari klien dan dari kita, unggah BAST → Catat serah terima | Ryan | `/proyek/serah-terima` | `ops_dlv.record_handover` | OK | proyek DONE |  |
