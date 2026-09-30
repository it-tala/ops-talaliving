| # | Proses | Langkah | Pelaku | Layar | Seam | Hasil | Status | Catatan |
|---|---|---|---|---|---|---|---|---|
| 1 | 1. Lokasi | Tambah lokasi: kode dan nama rak | Dewi | `/inventory/penyesuaian` | `ops_inv.stock_locations (insert)` | OK | aktif | Kode tidak bisa diganti sesudahnya — riwayat stok memakainya. Nama bebas diubah. |
| 2 | 1. Lokasi | Ganti nama lokasi | Dewi | `/inventory/penyesuaian` | `ops_inv.stock_locations (update)` | OK | aktif |  |
| 3 | 1. Lokasi | Nonaktifkan rak yang sudah tidak dipakai | Dewi | `/inventory/penyesuaian` | `ops_inv.stock_locations (update)` | OK | nonaktif | Tidak ada hapus: rak yang pernah dihitung tetap bisa dibaca di riwayat. |
| 4 | 1. Lokasi | Pembaca mencoba menambah lokasi | Lina | `/inventory/penyesuaian` | `ops_inv.stock_locations (insert)` | DITOLAK |  | Lokasi dikelola pemegang inventory.update. |
| 5 | 2. Daftar barang | Daftarkan barang tanpa foto | Dewi | `/inventory/material` | `ops_inv.register_item` | DITOLAK |  | photo_required |
| 6 | 2. Daftar barang | Daftarkan barang dengan lima foto | Dewi | `/inventory/material` | `ops_inv.register_item` | DITOLAK |  | too_many_photos |
| 7 | 2. Daftar barang | Daftarkan barang: foto (1–4), nama katalog, nama lapangan, kategori, satuan, hitungan awal dan raknya | Dewi | `/inventory/material` | `ops_inv.register_item` | OK | I-00003 · 12 di RAK-A1 | Hitungan awal tercatat sebagai penyesuaian opname (adjust) dengan alasannya — bukan barang masuk. |
| 8 | 2. Daftar barang | Daftarkan lagi barang yang nama lapangannya sudah ada | Dewi | `/inventory/material` | `ops_inv.register_item` | DITOLAK |  | already_catalogued — hitung di barang yang sudah ada, jangan buat kembarannya. |
| 9 | 2. Daftar barang | Isi nama lapangan untuk barang yang sudah ada di katalog | Dewi | `/inventory/material` | `ops_inv.set_item_local_name` | OK | amplas 240 |  |
| 10 | 2. Daftar barang | Hapus foto terakhir barang | Dewi | `/inventory/material` | `ops_core.attach_unlink` | DITOLAK |  | Minimal satu foto: tambah penggantinya dulu, baru hapus yang lama. |
| 11 | 2. Daftar barang | Pembaca mencoba mendaftarkan barang | Lina | `/inventory/material` | `ops_inv.register_item` | DITOLAK |  | not_permitted |
| 12 | 3. Penerimaan | Catat barang datang dengan foto barang dan surat jalan vendor sekaligus | Andi | `/procurement/tracker/[vendor]` | `ops_procure.create_receipt` | OK | rcv-26-09-28_01 CONFIRMED · stok lem di BENGKEL 20 | Masuk ke lokasi rumah barangnya (BENGKEL), dengan harga baris PR-nya. |
| 13 | 3. Penerimaan | Catat barang datang untuk baris PO (PO dibuat dari baris PR, tanpa kode barang sendiri) | Andi | `/procurement/tracker/[vendor]` | `ops_procure.create_receipt` | OK | rcv-26-09-28_02 CONFIRMED · lem di BENGKEL 30 | Barangnya dibaca dari baris PR yang dibeli baris PO itu. |
| 14 | 3. Penerimaan | Catat barang datang dengan foto saja (surat jalan menyusul) | Andi | `/procurement/tracker/[vendor]` | `ops_procure.create_receipt` | OK | REPORTED · stok amplas 0 | Belum ditandatangani, belum masuk stok. |
| 15 | 3. Penerimaan | Tandatangani penerimaan yang dilaporkan | Andi | `/procurement/tracker/[vendor]` | `ops_procure.confirm_receipt` | OK | CONFIRMED · amplas di GUDANG 100 | Barang tanpa lokasi rumah masuk ke GUDANG. |
| 16 | 3. Penerimaan | Barang salah kirim dicatat WRONG ITEM | Andi | `/procurement/tracker/[vendor]` | `ops_procure.create_receipt` | OK | CONFIRMED · tidak masuk stok | WRONG ITEM dan RETURN TO SENDER tidak disimpan; DAMAGED tetap masuk stok (barangnya ada di gedung). |
| 17 | 4. Pemakaian | (Produksi) Buat Job Order 12 kursi dari baris pesanan klien 10 kursi (dua cadangan) | Budi | `/produksi/jadwal` | `ops_prod.create_work_order` | OK | jo-26-09-28_01 | Dasar semua barang keluar dan barang jadi di bawah. |
| 18 | 4. Pemakaian | Keluarkan nol | Dewi | `/inventory/material` | `ops_inv.issue_stock` | DITOLAK |  | qty_invalid |
| 19 | 4. Pemakaian | Keluarkan material untuk Job Order: lokasi, jumlah, nomor JO, untuk apa | Dewi | `/inventory/material` | `ops_inv.issue_stock` | OK | BENGKEL 24 kg |  |
| 20 | 4. Pemakaian | Tombol Catat tertekan dua kali | Dewi | `/inventory/material` | `ops_inv.issue_stock` | OK | 1 gerak keluar | Tekanan kedua dijawab sama, tidak menulis dua kali. |
| 21 | 4. Pemakaian | Keluarkan material dari halaman Job Order | Dewi | `/produksi/jadwal` | `ops_inv.issue_for_work_order` | OK | amplas GUDANG 70 |  |
| 22 | 4. Pemakaian | Keluarkan lebih banyak dari yang tercatat | Dewi | `/inventory/material` | `ops_inv.issue_stock` | OK | BENGKEL -6 kg | Tidak ditolak (A6): tercatat, dan stok minus ditandai "perlu dihitung ulang". |
| 23 | 4. Pemakaian | Kembalikan material yang tidak terpakai | Dewi | `/inventory/material` | `ops_inv.stock_moves (return)` | OK | BENGKEL -2 kg |  |
| 24 | 4. Pemakaian | Pindah lokasi: dari GUDANG ke RAK-A1 | Dewi | `/inventory/material` | `ops_inv.stock_moves (transfer)` | OK | GUDANG 50 · RAK-A1 20 | Dua baris yang saling meniadakan: total tidak berubah. |
| 25 | 4. Pemakaian | Pembaca mencoba mengeluarkan material | Lina | `/inventory/material` | `ops_inv.issue_stock` | DITOLAK |  | not_permitted |
| 26 | 5. Opname | Catat selisih tanpa alasan | Dewi | `/inventory/penyesuaian` | `ops_inv.stock_moves (adjust)` | DITOLAK |  | Layar tidak membuka tombolnya tanpa alasan; database juga menolak (adjust_says_why). |
| 27 | 5. Opname | Catat hasil hitung: barang, lokasi, jumlah fisik, alasan selisih | Dewi | `/inventory/penyesuaian` | `ops_inv.stock_moves (adjust)` | OK | selisih 5 · BENGKEL 3 kg | Yang disimpan selisihnya, bukan angka barunya. |
| 28 | 5. Opname | Hitungan sama dengan catatan | Dewi | `/inventory/penyesuaian` | `ops_inv.stock_moves (adjust)` | OK | RAK-A1 20 = 20 | Tidak ada yang ditulis kalau cocok (selisih nol). |
| 29 | 5. Opname | Pembaca mencoba mencatat selisih | Lina | `/inventory/penyesuaian` | `ops_inv.stock_moves (adjust)` | DITOLAK |  | Penyesuaian butuh inventory.adjust. Siapa yang menyetujui selisih belum diputuskan pemilik (Q57). |
| 30 | 6. Barang jadi | (Produksi) Catat progres sampai tahap terakhir: 12 kursi selesai untuk pesanan 10 | Budi | `/produksi/progress` | `ops_prod.record_progress` | OK | 12 selesai |  |
| 31 | 6. Barang jadi | Catat hasil produksi tanpa Job Order | Dewi | `/inventory/produk` | `ops_inv.move_product` | DITOLAK |  | wo_required |
| 32 | 6. Barang jadi | Hasil produksi masuk rak: produk, Job Order, jumlah, lokasi | Dewi | `/inventory/produk` | `ops_inv.move_product` | OK | 12 di FINISHING | Pesanan kliennya diambil dari Job Order, bukan dari formulir. |
| 33 | 6. Barang jadi | Pindahkan lebih banyak dari yang ada | Dewi | `/inventory/produk` | `ops_inv.move_product` | DITOLAK |  | insufficient |
| 34 | 6. Barang jadi | Pindah lokasi 8 kursi dari FINISHING ke GUDANG | Dewi | `/inventory/produk` | `ops_inv.move_product` | OK | FINISHING 4 · GUDANG 8 |  |
| 35 | 6. Barang jadi | (Pengiriman) Surat jalan untuk lebih banyak dari yang selesai | Joko | `/pengiriman` | `ops_dlv.create_delivery` | DITOLAK |  | not_enough_made — siap kirim dihitung dari progres Job Order, bukan dari rak barang jadi. |
| 36 | 6. Barang jadi | (Pengiriman) Buat surat jalan 10 kursi | Joko | `/pengiriman` | `ops_dlv.create_delivery` | OK | krm-26-09-28_01 IN_TRANSIT | Gudang tidak mencatat pengiriman lagi: rak barang jadi membaca surat jalan. |
| 37 | 6. Barang jadi | Baca rak barang jadi setelah surat jalan berangkat | Dewi | `/inventory/produk` | `ops_inv.product_stock` | **TEMUAN** | dibuat 12 · terkirim 10 · di rak 2 · lebih 2 · surplus 2 · per lokasi {"GUDANG": -2, "FINISHING": 4} | Surat jalan krm-26-09-28_01 mengurangi 10 dari lokasi rumah (GUDANG) yang hanya memegang 8; FINISHING tetap 4. Per lokasi jadi minus (F177, B20). |
| 38 | 6. Barang jadi | Surplus dipakai untuk pesanan lain (produk yang sama) | Dewi | `/inventory/produk` | `ops_inv.allocate_product` | OK | fgm-26-09-28_04 | Hanya surplus yang boleh pindah; yang masih menjadi hak pesanan asal tetap di sana. |
| 39 | 6. Barang jadi | Opname barang jadi: selisih tanpa alasan | Dewi | `/inventory/produk` | `ops_inv.count_product` | DITOLAK |  | reason_required |
| 40 | 6. Barang jadi | Opname barang jadi: jumlah fisik dan alasan selisih | Dewi | `/inventory/produk` | `ops_inv.count_product` | OK | selisih -1 |  |
| 41 | 6. Barang jadi | Jual tanpa menyebut pembelinya | Dewi | `/inventory/produk` | `ops_inv.move_product` | DITOLAK |  | reason_required |
| 42 | 6. Barang jadi | Pembaca mencoba mencatat hasil produksi | Lina | `/inventory/produk` | `ops_inv.move_product` | DITOLAK |  | not_permitted |
| 43 | 7. Aset | Simpan aset tanpa nama | Dewi | `/inventory/assets` | `ops_inv.create_asset` | DITOLAK |  | name_required |
| 44 | 7. Aset | Tambah aset milik sendiri: nama, kategori, merek, nomor seri, lokasi, pemegang | Dewi | `/inventory/assets` | `ops_inv.create_asset` | OK | AST-0001 in_use |  |
| 45 | 7. Aset | Tambah aset sewa: pemilik, biaya sewa, periode, tanggal jatuh tempo, masa kontrak | Dewi | `/inventory/assets` | `ops_inv.create_asset` | OK | AST-0002 rented |  |
| 46 | 7. Aset | Catat servis/perbaikan | Dewi | `/inventory/assets` | `ops_inv.add_asset_service` | OK | ok |  |
| 47 | 7. Aset | Tandai aset hilang tanpa keterangan | Dewi | `/inventory/assets` | `ops_inv.set_asset_status` | DITOLAK |  | note_required |
| 48 | 7. Aset | Ubah status aset: dalam perbaikan | Dewi | `/inventory/assets` | `ops_inv.set_asset_status` | OK | under_repair |  |
| 49 | 7. Aset | Pembaca mencoba menambah aset | Lina | `/inventory/assets` | `ops_inv.create_asset` | DITOLAK |  | not_permitted |
| 50 | 8. Kayu | Terima kayu tanpa menyebut jenisnya | Dewi | `/inventory/log` | `ops_inv.receive_logs` | DITOLAK |  | species_required |
| 51 | 8. Kayu | Terima kayu: supplier, tanggal, jenis, harga, log dan papan hasil gergaji | Dewi | `/inventory/log` | `ops_inv.receive_logs` | OK | kyu-26-09-28_01 |  |
| 52 | 8. Kayu | Pakai papan tanpa menyebut pekerjaannya | Dewi | `/inventory/log` | `ops_inv.move_boards` | DITOLAK |  | ref_required |
| 53 | 8. Kayu | Pakai papan untuk Job Order | Dewi | `/inventory/log` | `ops_inv.move_boards` | OK | Mahoni\|25x150x2000 tersisa 5 lembar |  |
| 54 | 9. Label | Cari barang yang baru didaftarkan untuk dicetak labelnya | Lina | `/inventory/label` | `ops_inv.label_sources` | OK | 1 label | Membaca saja: pemegang inventory read boleh mencetak. |
