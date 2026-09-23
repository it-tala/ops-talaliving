| # | Proses | Langkah | Pelaku | Layar | Seam | Hasil | Status | Catatan |
|---|---|---|---|---|---|---|---|---|
| 1 | 1. Data master | Tambah supplier baru | Andi | `/master-data/suppliers` | `ops_procure.create_vendor` | OK | belum dikurasi | Kode V-0001. Nama yang diketik selalu diterima; kurasi menyusul. |
| 2 | 1. Data master | Tambah barang baru | Andi | `/master-data/items` | `ops_procure.create_item` | OK |  | Kode I-00001 |
| 3 | 1. Data master | Tambah barang dengan kategori yang tidak ada | Andi | `/master-data/items` | `ops_procure.create_item` | DITOLAK |  | no_such_category — kategori harus dipilih dari daftar. |
| 4 | 2. PR | Simpan PR tanpa baris | Andi | `/procurement/pr/new` | `ops_procure.create_pr` | DITOLAK |  | lines_required — PR harus punya minimal satu baris. |
| 5 | 2. PR | Isi baris PR lalu simpan sebagai draft | Andi | `/procurement/pr/new` | `ops_procure.create_pr` | OK | PR: DRAFT | pr-26-09-23_01 — 2 baris. Baris jasa (ongkir) diisi nominal langsung, tanpa jumlah × harga. |
| 6 | 2. PR | Tekan Submit for approval | Andi | `/procurement/pr/new` | `ops_procure.submit_pr` | OK | PR: SUBMITTED · baris: WAITING FOR APPROVAL |  |
| 7 | 2. PR | Submit PR yang sama sekali lagi | Andi | `/procurement/pr/documents` | `ops_procure.submit_pr` | DITOLAK |  | already_submitted |
| 8 | 3. Persetujuan barang | Staf mencoba menyetujui sendiri | Andi | `/procurement/meeting` | `ops_procure.approve_line` | DITOLAK |  | authority_required — hanya pemegang approve_goods. |
| 9 | 3. Persetujuan barang | Kirim ke Chat tanpa bukti harga | Andi | `/procurement/meeting` | `ops_procure.request_approval` | DITOLAK |  | support_required — lampirkan penawaran/link toko dulu; angka tanpa bukti tidak dikirim ke HP pimpinan. |
| 10 | 3. Persetujuan barang | Lampirkan penawaran di baris PR | Andi | `/procurement/pr` | `ops_core.attach_url + attach_link` | OK |  | Bukti harga menempel di baris L01. |
| 11 | 3. Persetujuan barang | Kirim permintaan persetujuan ke Chat | Andi | `/procurement/meeting` | `ops_procure.request_approval` | OK | menunggu jawaban | Terkirim ke evin@talaliving.com — dicari dari siapa yang memegang approve_goods. |
| 12 | 3. Persetujuan barang | Pimpinan menyetujui dari kartu Chat | Evin | `Google Chat` | `ops_procure.answer_request` | OK | baris L01: APPROVED |  |
| 13 | 3. Persetujuan barang | Setujui ongkir di papan rapat tanpa bukti | Evin | `/procurement/meeting` | `ops_procure.approve_line` | DITOLAK |  | support_required — pimpinan pun tidak bisa menyetujui angka yang tidak ada buktinya. |
| 14 | 3. Persetujuan barang | Lampirkan chat ongkir, lalu setujui dengan nominal dikurangi | Evin | `/procurement/meeting` | `ops_procure.approve_line` | OK | baris L02: APPROVED | Disetujui 250.000 dari 300.000 yang diminta; yang diminta tetap tercatat. |
| 15 | 4. PO | Buat PO dengan harga kosong | Andi | `/procurement/po` | `ops_procure.create_po` | DITOLAK |  | price_required — nilai kontrak harus disepakati. |
| 16 | 4. PO | Pilih baris ongkir (tanpa jumlah) sebagai baris PO | Andi | `/procurement/po` | `ops_procure.create_po` | DITOLAK |  | lump_sum_line — baris tanpa jumlah adalah uang, bukan barang; dibayar lewat barisnya, tidak dipesan. |
| 17 | 4. PO | Add new PO → pilih baris PR yang disetujui di "From request line", DP 30% | Andi | `/procurement/po` | `ops_procure.create_po` | OK | PO: DRAFT | po-26-09-23_01 — terisi dari baris pr-26-09-23_01-L01 dan tersambung ke baris itu; 2 termin otomatis: DP saat issue, pelunasan saat barang diterima. |
| 18 | 4. PO | Pesan baris PR yang sama di PO kedua | Andi | `/procurement/po` | `ops_procure.create_po` | DITOLAK |  | line_already_ordered — baris itu sudah dipesan di po-26-09-23_01. |
| 19 | 4. PO | Issue PO sebelum dikonfirmasi pimpinan | Andi | `/procurement/po/[po]` | `ops_procure.issue_po` | DITOLAK | PO: DRAFT | not_approved — PO adalah janji atas nama perusahaan. |
| 20 | 4. PO | Tekan Ask leadership to confirm | Andi | `/procurement/po/[po]` | `ops_procure.request_po_approval` | OK | PO: DRAFT · menunggu konfirmasi |  |
| 21 | 4. PO | Pimpinan menekan Confirm it | Evin | `/procurement/po/[po]` | `ops_procure.approve_po` | OK | PO: DRAFT · dikonfirmasi | self_confirmed = false (ada yang diminta). |
| 22 | 4. PO | Tekan Issue and send it, lalu cetak | Andi | `/procurement/po/[po]/print` | `ops_procure.issue_po` | OK | PO: ISSUED | DP sekarang jadi kewajiban: payable_now = 450.000 (30% dari 1.500.000). |
| 23 | 5. Penerimaan | Catat barang datang tanpa foto | Andi | `/procurement/tracker/[vendor]` | `ops_procure.create_receipt` | DITOLAK |  | photo_required — foto barang selalu wajib. |
| 24 | 5. Penerimaan | Record arrival → isi jumlah, foto barang dan tanda terima, tekan Record what arrived | Andi | `/procurement/tracker/[vendor]` | `ops_procure.create_receipt` | OK | penerimaan: CONFIRMED |  |
| 25 | 5. Penerimaan | Periksa baris PR yang dibeli PO ini | Andi | `/procurement/pr` | `ops_procure.v_pr_line_status` | OK | baris L01: PARTIAL | Barang diterima di PO ikut menggerakkan baris PR-nya (belum lunas, jadi belum COMPLETED). Stok gudang tidak bertambah otomatis (inventory.stockFromReceipt belum tersambung). |
| 26 | 6. Pembayaran | Staf procurement mencoba membayar DP PO | Andi | `/procurement/po/[po]` | `ops_acct.post_to_po` | DITOLAK |  | authority_required — hanya pemegang post_ledger (keuangan). |
| 27 | 6. Pembayaran | Bayar DP tanpa bukti transfer | Rina | `/procurement/po/[po]` | `ops_acct.post_to_po` | DITOLAK |  | evidence_required — tanpa bukti, tidak ada pembayaran. |
| 28 | 6. Pembayaran | Pay this order: bayar DP 450.000 dari halaman PO | Rina | `/procurement/po/[po]` | `ops_acct.post_to_po → post_transaction + alokasi` | OK | PO: PARTIAL · baris L01 terbayar 450.000 | trx-26-09-23_001 — satu baris buku besar; karena PO tersambung ke L01, uangnya terbaca di PO dan di baris PR sekaligus. |
| 29 | 6. Pembayaran | Lunasi dari baris PR: Post Rp… to the ledger | Rina | `/procurement/pr` | `ops_acct.post_from_line → post_transaction + allocate_payment` | OK | PO: SETTLED · baris L01: COMPLETED | trx-26-09-23_002 — dicatat di baris PR, tetapi PO ikut lunas karena alokasinya menyebut PO-nya. |
| 30 | 6. Pembayaran | Bayar ongkir (baris tanpa jumlah) dari barisnya, jenis SUPPLIERS | Rina | `/procurement/pr` | `ops_acct.post_from_line` | OK | baris L02: PAID | Detail buku besar: 1 lot × 250000 — baris PR-nya tetap tanpa jumlah. |
| 31 | 7. Lengkapi transaksi | Tekan Mark completed | Rina | `/accounting/ledger` | `ops_acct.complete_transaction` | OK | transaksi: COMPLETED | Bukti transfer sudah menempel, jadi transaksi bisa ditandai lengkap. |
| 32 | 8. Verifikasi | Bukti masuk dari Chat ke kotak verifikasi | sistem | `/accounting/verifikasi` | `ops_acct.file_evidence` | OK | PENDING |  |
| 33 | 8. Verifikasi | Tolak tanpa alasan | Rina | `/accounting/verifikasi` | `ops_acct.resolve_inbox` | DITOLAK |  | reason_required — pengirim perlu tahu kenapa. |
| 34 | 8. Verifikasi | Link to a row — tempel ke transaksi yang ada | Rina | `/accounting/verifikasi` | `ops_acct.resolve_inbox` | OK | ATTACHED |  |
| 35 | 9. Rekening koran | Upload rekening koran bulan ini | Rina | `/accounting/rekening-koran` | `ops_acct.import_statement` | OK |  | 2 baris masuk, status unmatched. |
| 36 | 9. Rekening koran | Cocokkan baris bank yang nominalnya beda | Rina | `/accounting/rekening-koran` | `ops_acct.match_statement_line` | DITOLAK |  | amount_differs |
| 37 | 9. Rekening koran | Pilih saran di bawah "Mirip dengan:" | Rina | `/accounting/rekening-koran` | `ops_acct.match_statement_line` | OK | baris bank: matched | Transaksi buku besar terbukti keluar dari bank. |
