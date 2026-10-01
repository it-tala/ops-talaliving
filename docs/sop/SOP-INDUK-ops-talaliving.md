# SOP Induk — ops.talaliving

**Standard Operating Procedure lintas tim · Tala Living**
Disusun 2026-10-01 dari seluruh kode (`src/`, `supabase/migrations/` 0001–0207), seluruh dokumen (`docs/plan/**`, `docs/sop/**`, `docs/analysis/**`, `CLAUDE.md`) dan seluruh riwayat commit (211 commit, 2026-09-10 s/d 2026-10-01).

> **Aturan baca:** bila dokumen lama dan kode berbeda, **kode dan commit terbaru yang menang**. Perbedaannya dicatat di akhir tiap bab dan dirangkum di Lampiran C. Tidak ada aturan bisnis yang dikarang: hal yang tidak bisa dipastikan dari kode atau dokumen ditulis *tidak terkonfirmasi*.

---

## Bagian 1 — Untuk apa SOP ini

Tujuan sistem ops.talaliving: **menyatukan seluruh proses kerja dan merekam setiap aktivitas dari awal sampai akhir, lengkap dan dapat ditelusuri.** Satu kejadian bisnis (mis. membeli kayu untuk Job Order tertentu) harus bisa dibuka dari satu nomor dan menunjukkan: siapa meminta, siapa menyetujui, berapa dibayar, dari rekening mana, barang masuk kapan dan oleh siapa, dipakai untuk pekerjaan apa, dan bukti berkasnya ada di mana.

SOP ini dibagi menjadi:

| Bagian | Isi | Pembaca utama |
|---|---|---|
| Bagian 1–5 (di awal) | Prinsip, peta alur end-to-end, serah-terima antar tim, aturan emas | **Semua tim** — baca dulu |
| Bab 1 Pengadaan & Data Master | PR → persetujuan → PO → penerimaan; supplier, barang, klien | Procurement, Pimpinan |
| Bab 2 Akuntansi & Dokumen | Buku besar, pembayaran, verifikasi, rekening koran, kas, aturan Google Drive | Finance/Akuntansi, Pimpinan |
| Bab 3 Persediaan | Lokasi, stok, kayu, barang jadi, aset, label QR | Gudang, Produksi |
| Bab 4 SDM & Penggajian | Karyawan, kontrak, absensi, jadwal, lembur, cuti, gaji, layanan mandiri | HRD, semua karyawan |
| Bab 5 Produksi, Proyek, Pengiriman, Marketing | Enquiry → quotation → order → Job Order → BOM → produksi → kirim → pasang → serah-terima | PM, Produksi, Delivery, Marketing |
| Bab 6 Platform | Akses & peran, penomoran, audit, John Lau, rilis | IT, Pimpinan, semua |
| Lampiran A–C | Matriks wewenang, checklist periodik lintas tim, kesenjangan terkonsolidasi | IT, Pimpinan |

Setiap proses di bab memakai kerangka sama: **Tujuan · Pemilik/peran & kewenangan · Prasyarat · Langkah-langkah · Aturan & kontrol · Jejak data · Serah-terima · Koreksi & pengecualian · Checklist rutin · Sumber.**

---

## Bagian 2 — Lima prinsip yang berlaku di semua tim

1. **Semua lewat sistem, satu pintu.** Pekerjaan yang tidak ada di sistem dianggap tidak terjadi. Chat, kertas, dan WhatsApp hanya sarana; hasilnya wajib masuk sebagai record bernomor.
2. **Satu kejadian = satu nomor yang dicetak database.** Format `prefix-YY-MM-DD_NN` (mis. `pr-26-09-11_03`, `po-…`, `trx-…`, `jo-…`). Tidak ada yang mengetik nomor dokumen. Nomor tercetak **tidak pernah diganti**; kesalahan dikoreksi dengan VOID/supersede disertai alasan (tabel lengkap di Bab 6).
3. **Dua kunci penyambung di setiap baris:** *kode barang* (`I-00042` — barang apa) dan *nomor Job Order* (`jo-…` — untuk pekerjaan mana). Satu nomor untuk semua dokumen tidak mungkin; layar **Job trail** (`/produksi/jejak`) menerima nomor proyek, JO, PR, PO, receiving report, atau surat jalan dan menampilkan seluruh rantainya (D312).
4. **Pemisahan wewenang.** Akses modul (Baca / Baca & ubah / Penuh) ≠ wewenang bernama. Lima wewenang bernama tidak pernah tersirat dari level modul (D24): `approve_goods` (persetujuan barang), `approve_funds` (persetujuan dana), `approve_overtime`, `post_ledger` (membukukan), `resolve_inbox` (menautkan dokumen tanpa induk). Layar dan database membaca hak yang sama; penolakan tercatat.
5. **Tidak ada yang hilang diam-diam.** Setiap panggilan tulis — berhasil maupun ditolak — menulis satu baris `ops_core.audit_log` (siapa, apa, kapan, nomor record, hasil, alasan). Berkas bukti disimpan di Google Drive di folder `ops-talaliving/<TUGAS>/…` dan ditautkan ke record. Detail di Bab 6 ("Jejak audit") dan Bab 2 ("Aturan penyimpanan file").

### Aturan penyimpanan file (berlaku semua tim — keputusan pemilik D313, D320)

- Semua berkas yang disimpan aplikasi masuk ke folder **`ops-talaliving`** di akar shared drive modul (PROCUREMENT, ACCOUNTING, HRD, DRAFTING, PRODUCTION, PROJECT MANAGER, IT). **Aplikasi yang membuat folder itu sendiri**; folder OPS buatan tangan tidak terbaca aplikasi (F173).
- **Tidak ada berkas lepas** di `ops-talaliving`: tiap tugas punya subfolder (mis. `INVENTORY/ITEMS`, `RECEIVING REPORT/<YYYY-MM>/<YYYY-MM-DD>`). Peta lengkap per jenis dokumen ada di Bab 2.
- Unggah selalu lewat layar (tombol lampir bukti / EvidenceStrip), **jangan** menaruh berkas langsung di Drive. Data pribadi (HRD) hanya masuk drive yang ditentukan `doc_kind_drive` (batas data pribadi, 0035).

---

## Bagian 3 — Peta alur end-to-end

```
 MARKETING            PROYEK / KLIEN          PRODUKSI              PENGADAAN
 properti→agen        enquiry (CL-…)          BOM (rev N)           PR (pr-…)  ←─ dibuat dari BOM
 referral lead-…  →   proyek INQUIRY      →   Job Order (jo-…) ──→  ajukan → rapat/Chat
                      quotation qt-…           (BOM dipin)          setujui barang (CEO)
                      ACCEPTED→DEAL                                 setujui dana (Finance)
                                                                    PO (po-…) → konfirmasi pimpinan
                                                                          │
   AKUNTANSI  ←── bayar baris PR / bayar PO / uang masuk / gaji           ▼
   trx-… buku besar                                              PENERIMAAN rcv-… / rr-…
   verifikasi bukti, rekening koran rkk-…                        (tanda tangan penerima)
   kalender & rencana kas 12 bulan                                       │
                                                                         ▼
 SDM                                                            PERSEDIAAN
 absensi, jadwal, lembur lbr-… ─→ jam produksi                  stok stk-… (otomatis dari penerimaan bertanda tangan)
 run gaji pyr-… ─→ Akuntansi (bayar gaji)                       bahan keluar → JO · kayu kyu-… · aset AST-…
                                                                         │
                                                                         ▼
                                    PRODUKSI: progres tahap, timeslot tsl-…, leg vendor leg-…
                                    JO DONE → barang jadi fgm-… → peti kol-…
                                    PENGIRIMAN: surat jalan krm-… → instalasi pas-… (+ temuan tmn-…)
                                    SERAH-TERIMA: BAST bast-… → proyek DONE
```

Tonggak "sudah masuk sistem" per tahap:

| # | Tahap | Tim pemilik | Bukti minimal yang harus ada | Bab |
|---|---|---|---|---|
| 1 | Enquiry klien & proyek | Marketing / PM | klien `CL-…`, proyek berkode | 5 |
| 2 | Quotation disetujui klien | PM / estimator | `qt-…` `ACCEPTED` | 5 |
| 3 | Job Order & BOM | Produksi | `jo-…` `OPEN`, BOM revisi dipin | 5 |
| 4 | Kebutuhan bahan → PR | Produksi → Procurement | `pr-…` dengan `source_wo_no` = JO | 1, 5 |
| 5 | Persetujuan | CEO (`approve_goods`), Finance (`approve_funds`) | jejak persetujuan di baris | 1 |
| 6 | PO & konfirmasi | Procurement / pimpinan | `po-…` terkonfirmasi | 1 |
| 7 | Pembayaran | Finance (`post_ledger`) | `trx-…` + bukti transfer | 2 |
| 8 | Penerimaan barang | Gudang / Procurement | `rcv-…`/`rr-…` bertanda tangan + foto | 1, 3 |
| 9 | Stok masuk & keluar | Gudang | `stk-…` merujuk JO | 3 |
| 10 | Produksi & jam kerja | Produksi, HRD | progres, `tsl-…`, lembur disetujui | 4, 5 |
| 11 | Barang jadi, peti, kirim | Gudang / Delivery | `fgm-…`, `kol-…`, `krm-…` | 3, 5 |
| 12 | Instalasi & serah-terima | Delivery / PM | `pas-…`, `bast-…` | 5 |
| 13 | Gaji & kewajiban SDM | HRD → Finance | `pyr-…` disetujui → `trx-…` | 4, 2 |
| 14 | Penutupan bulanan | Finance | checklist Lampiran B | 2 |

> Pembayaran **klien** sengaja **tidak** dilacak di sistem (D164, D106) — dilakukan Finance langsung dengan klien. Ini bagian dari "yang belum terekam" (Lampiran C).

---

## Bagian 4 — Serah-terima antar tim (siapa menyerahkan apa ke siapa)

| Dari → Ke | Apa yang diserahkan | Di mana terjadi | Syarat sebelum menyerahkan |
|---|---|---|---|
| Marketing → PM | Referral `WON` + kode proyek | `/marketing/agen` → `/proyek/order` | kode proyek angka sudah diketik |
| PM → Produksi | Pesanan `DEAL` → Job Order | `/proyek/order` / `/produksi/jadwal` | quotation `ACCEPTED`, BOM terpilih |
| Produksi → Procurement | PR `DRAFT` dari BOM | drawer Job Order | tiap baris mengacu ke JO |
| Procurement → CEO / Finance | PR minta disetujui | Meeting board atau kartu Google Chat | baris lengkap (qty, vendor, harga) |
| Procurement → Finance | Baris disetujui / PO terkonfirmasi untuk dibayar | `/accounting/…` | persetujuan dana ada |
| Finance → Procurement | Bukti bayar (transfer proof) | EvidenceStrip pada PO/baris | pembayaran terbukukan `trx-…` |
| Vendor → Gudang | Barang + surat jalan vendor | `/procurement/penerimaan` / Chat Receiving Report | foto nota & barang; tanda tangan penerima |
| Gudang → Finance | Nota & penerimaan terkonfirmasi (bahan verifikasi) | `/accounting/verifikasi` | berkas terlampir |
| Gudang → Produksi | Bahan keluar untuk JO | `/inventory/material` | stok cukup; keluar menyebut nomor JO |
| Produksi → Gudang | Barang jadi (`produced` menyebut JO) | `/inventory/produk` | JO `DONE` |
| Gudang → Delivery | Barang jadi masuk peti, surat jalan | `/proyek/peti`, `/proyek/pengiriman` | stok barang jadi tercatat |
| Delivery → PM | Instalasi selesai, temuan ditutup | `/proyek/instalasi` | semua `tmn-…` `FIXED` |
| PM → Klien/Finance | BAST ditandatangani | `/proyek/serah-terima` | instalasi selesai |
| HRD → Finance | Run gaji disetujui | `/hrd/payroll` → Akuntansi | `approve_funds` memutuskan run |
| Produksi → HRD | Lembar lembur/jam produksi | `/hrd/lembur` | surat lembur terlampir; `approve_overtime` |
| Semua → IT | Permintaan akses, masalah, akun | `/it/pengguna`, kanal IT | alasan penolakan sistem menyebut izin yang kurang |

---

## Bagian 5 — Aturan emas lintas tim (ringkas)

1. **Jangan membayar tanpa baris persetujuan.** Pembayaran dibukukan hanya oleh pemegang `post_ledger`, dan harus menempel pada baris PR / PO / run gaji.
2. **Jangan menerima barang tanpa tanda tangan dan foto.** Stok bertambah otomatis dari penerimaan *bertanda tangan* (0169/0180) — salah tanda tangan = salah stok.
3. **Setiap bahan keluar menyebut nomor Job Order.** Tanpa itu biaya tidak tertelusur ke proyek.
4. **Koreksi, jangan hapus.** Gunakan Edit/VOID/supersede dengan alasan; riwayat tetap ada di audit.
5. **Berkas hanya lewat layar** supaya masuk folder tugas yang benar dan tertaut ke record.
6. **Pemegang wewenang tunggal tidak boleh jadi titik macet:** `approve_goods` kini satu orang (D19). Saat bepergian, pekerjaan berhenti — keputusan manajemen untuk menunjuk wewenang kedua, bukan jalan pintas teknis.
7. **Satu perubahan per rilis** (aturan pengembangan, `CLAUDE.md`): sesi dan branch fokus satu fitur; setelah PR di-merge, branch dihapus.
8. **Zona waktu kantor WIB** (D334/0190): tanggal dokumen = hari kantor, bukan UTC.

---


## Bab 1 — Procurement dan Master Data

Posisi bab ini dalam SOP induk: dari "kita butuh barang" sampai "barang tercatat datang, uang tercatat keluar, dan semuanya bisa ditelusuri dari satu nomor". Bab ini mencakup dua kelompok layar:

- **Procurement** (`/procurement/*`): Requests (PR), Meeting board, Purchase Order, Purchase Tracker, Receiving Report (`/procurement/penerimaan`), Payment rounds.
- **Master Data** (`/master-data/*`): Suppliers, Items, Item categories, Units, Accounts, Transaction types, Asset categories, Clients.

Bab ini ditulis dari kode (migrasi `supabase/migrations/*`, `src/lib/api/procurement.ts`, halaman `src/app/(app)/procurement/**` dan `master-data/**`) dan log keputusan (`docs/plan/06-decisions.md`). Kode dan commit terbaru menang atas dokumen lama; konflik dicatat di bagian akhir. Posisi git saat bab ini ditulis: 2026-10-01, migrasi terakhir `0207`.

Catatan bahasa tombol: antarmuka berbahasa Inggris secara bawaan (D318) dan bisa dialihkan ke Indonesia. Label tombol di bawah ditulis persis seperti di layar (bahasa Inggris), dengan padanan Indonesia di dalam kurung bila perlu.

### Pegangan umum (berlaku untuk semua proses di bab ini)

#### Peran dan kewenangan: dua hal yang terpisah (D24)

| Konsep | Isi | Sumber |
|---|---|---|
| **Akses modul** | `read` < `write` < `admin` per modul. Untuk `procurement`: `read` (lihat), `create` (buat PR, PO, vendor, barang, catat kedatangan), `update` (ubah, ajukan, konfirmasi penerimaan, ubah PO, master data). Level `write` sudah memberi `create` + `update`; tidak ada aksi khusus admin di `procurement`. | `src/lib/roles.ts` (`PERMISSION_CATALOG`) |
| **Wewenang (authority)** | Keputusan bernama, diberikan terpisah, tidak pernah tersirat dari level modul. `approve_goods` (label "Menyetujui barang (CEO)"), `approve_funds` ("Menyetujui dana"), `post_ledger` ("Membukukan ke buku besar"), `resolve_inbox` ("Menautkan dokumen tanpa induk"), `approve_overtime` (tidak dipakai di bab ini). | `src/services/identity/contracts.ts`, D19, D24 |

Siapa memegang apa di bab ini (ringkas):

| Peran kerja | Akses modul | Wewenang | Yang boleh dilakukan di bab ini |
|---|---|---|---|
| Staf procurement | `procurement` write | tidak ada | Membuat dan mengajukan PR, mengirim permintaan persetujuan ke Chat, membuat PO draf, meminta konfirmasi PO, menerbitkan PO yang sudah dikonfirmasi, mengubah baris PO, mencatat kedatangan, mengonfirmasi penerimaan, mencocokkan kiriman Chat, mengelola master data supplier/barang/satuan/kategori |
| Pimpinan (CEO) | `procurement` (minimal read) | `approve_goods` | Menyetujui baris PR (di Meeting board atau kartu Chat), menulis instruksi di baris, mengonfirmasi PO. Hanya satu otoritas ini yang bisa menyetujui barang (D19, D30: tidak ada pengganti CEO). |
| Keuangan | `procurement` + `accounting` write | `post_ledger`, `approve_funds` (dan `resolve_inbox` untuk Verifikasi) | Mencatat pembayaran baris PR dan PO ke buku besar, menutup PO (`approve_funds`), menyetujui dan mendanai Payment rounds (`approve_funds`), mengelola Accounts |
| Pembaca | `procurement` read | tidak ada | Melihat semua layar; tombol tulis terlihat tetapi ditolak sistem dengan alasan |

Pemegang wewenang bukan daftar nama di kode: yang memegang `approve_goods` dicari dari tabel `ops_core.user_authorities`. Siapa orangnya hari ini dilihat di IT → Users (`/it/pengguna`); catatan di migrasi `0159` menyebut Evin Oshima sebagai pemegang `approve_goods` per 2026-09-24. **Verifikasi daftar ini sebelum bab ini dipakai sebagai acuan nama.** Layar Meeting board juga menampilkan panel "Who decides" (goods / funds) dan, bagi yang punya `it.read`, tautan "Change who holds it".

#### Format nomor (semua dibuat database, tidak pernah diketik)

| Dokumen | Format | Contoh |
|---|---|---|
| Purchase Request | `pr-YY-MM-DD_NN` | `pr-26-09-23_01` |
| Baris PR | `<nomor PR>-L<NN>` | `pr-26-09-23_01-L01` |
| Kelompok permintaan persetujuan (Chat) | `ask-YY-MM-DD_NN` | `ask-26-09-24_01` |
| Purchase Order | `po-YY-MM-DD_NN` | `po-26-09-23_01` |
| Termin PO | `<nomor PO>-M<NN>` | `po-26-09-23_01-M01` (DP), `-M02` (pelunasan) |
| Penerimaan (receipt) | `rcv-YY-MM-DD_NN` | `rcv-26-09-23_01` |
| Receiving report dari Chat | `rr-YY-MM-DD_NN` | `rr-26-10-01_01` |
| Payment round | `fund-YY-MM-DD_NN` | `fund-26-09-11_01` |
| Transaksi buku besar (dibuat Accounting) | `trx-YY-MM-DD_NNN` | `trx-26-09-23_001` |
| Supplier | `V-NNNN` | `V-0001` |
| Barang | `I-NNNNN` (lima digit sejak `0112`; barang impor `I-00001` sampai `I-01045`) | `I-00042` |
| Klien | `CL-NNNN` | `CL-0001` |
| Proyek | kode angka, tidak pernah berubah | `25007` |

Kode barang **tidak** dibentuk dari lokasi atau kategori (D347): nomor katalog saja.

#### Daftar status resmi

- **Dokumen PR**: `DRAFT`, `SUBMITTED` (enum juga memuat `APPROVED`, `CLOSED`, `CANCELLED`, tetapi tidak ada layar atau fungsi yang menuliskannya).
- **Baris PR** (dihitung sistem, tidak pernah diketik; D28, D126): `DRAFT`, `WAITING FOR APPROVAL`, `APPROVED`, `PAID`, `PARTIAL`, `COMPLETED`, `REMOVED`. Urutan penentuan di database (`v_pr_line_status`): dokumen masih draf → `DRAFT`; baris dihapus → `REMOVED`; ada penutupan manual (`line_closures`) → `COMPLETED`; lunas **dan** ada bukti bayar **dan** tidak ada kiriman bermasalah **dan** (jasa, atau jumlah diterima ≥ jumlah diminta) → `COMPLETED`; ada jumlah diterima > 0 → `PARTIAL` (artinya sebagian atau seluruhnya sudah datang tetapi belum selesai, **bukan** dibayar sebagian); lunas → `PAID`; sudah disetujui → `APPROVED` (disetujui, belum dibayar); selain itu `WAITING FOR APPROVAL`.
- **Empat kuadran rapat** (`meeting_state`): "Approved and paid" (Disetujui dan dibayar), "Approved, not paid" (Disetujui, belum dibayar), "Paid, not approved" (Dibayar, belum disetujui), "Waiting for approval" (Menunggu persetujuan).
- **PO**: `DRAFT`, `ISSUED`, `CLOSED` (`CANCELLED` ada di enum, tidak ada fungsi pembatalan). Dua sumbu terpisah: pembayaran `UNPAID`/`PARTIAL`/`SETTLED`, pengiriman `PENDING`/`PARTIAL`/`COMPLETE`. Termin: `PAID`, `PARTIAL`, `PAYABLE`, `BLOCKED`, `NOT DUE`.
- **Penerimaan**: `REPORTED` (dilaporkan, belum bernilai), `CONFIRMED` (dikonfirmasi, terhitung diterima). Kondisi: `GOOD`, `DAMAGED`, `PARTIALLY DAMAGED`, `MISSING PARTS`, `WRONG ITEM`, `RETURN TO SENDER`, `WAITING FOR CONFIRMATION`; hanya `GOOD` dan bagian yang diterima dari `PARTIALLY DAMAGED` terhitung menuntaskan baris (A18).
- **Receiving report dari Chat**: `PENDING` (tab Waiting/Menunggu), `MATCHED` (Matched/Dicocokkan), `DISMISSED` (Set aside/Diabaikan).
- **Payment round**: `OPEN`, `APPROVED`, `TRANSFERRED`, `CLOSED`.

#### Prinsip jejak (berlaku untuk setiap tombol tulis di bab ini)

Semua penulisan lewat fungsi database ("seam") yang dalam satu transaksi menulis tiga hal: baris bisnis, satu baris audit (`ops_core.audit_log`, terbaca di IT → Audit Log `/it/audit`), dan satu baris outbox (`ops_core.outbox`, kejadian `procurement.*`). Penolakan juga tercatat (`refused`/`invalid`/`conflict`). Setiap penolakan punya kode (mis. `support_required`) dan kalimat yang tampil di layar. Tidak ada nomor yang bisa dipilih pemakai. Tidak ada penghapusan diam-diam: penghapusan baris PR bersifat lunak dan tercatat, penggabungan master data meninggalkan penunjuk, bukan hapus.

---

### Master data — Supplier (vendor)

- **Tujuan**
  Daftar pemasok yang dipakai semua PR, PO, transaksi buku besar, dan rencana pembayaran. Satu pemasok = satu baris, sehingga riwayat belanja per pemasok bisa dibaca utuh.

- **Pemilik / peran & kewenangan**
  - Layar `/master-data/suppliers` muncul di menu bila punya `procurement.read`.
  - Tambah vendor: `procurement.create` (`create_vendor`). Ubah kontak, ganti nama (`rename_vendor`), kurasi (`curate_vendor`), gabung (`merge_vendor`), arsipkan (`archive_vendor`), hapus (`delete_vendor`): `procurement.update`.
  - Tidak ada wewenang khusus. Pemilik memutuskan master data diedit oleh modul pemilik datanya, bukan peran admin terpisah (2026-09-23, 0099).

- **Prasyarat**
  Akun dengan `procurement` write. Cek dulu apakah pemasok sudah ada (kotak cari "Vendor, contact, or item…") supaya tidak menambah duplikat.

- **Langkah-langkah**
  1. Staf procurement → `/master-data/suppliers` → **Add vendor** → isi "Vendor name" → **Add vendor**. Hasil: vendor `V-NNNN` dengan status **Not yet curated** (belum dikurasi). Nama apa pun yang diketik selalu diterima (D30), supaya pembelian tidak terjadi di luar sistem.
  2. Buka baris vendor (laci) → **Edit details** → isi Contact (PIC name, PIC phone, Office phone, Address), Payment details (Bank account, Second account, "Only if they really have two"), NPWP, dan "What they supply" → **Save details**. Hasil: kontak dan rekening tercatat; sebelum/sesudah masuk audit.
  3. Setelah nama dan kontak benar: **Curate**. Hasil: vendor masuk dropdown pilihan di form PR, Quick add, dan New PO. **Vendor yang belum dikurasi tidak muncul di dropdown tersebut**, kecuali pembuatan langsung dari form PR ("Add “…” as a new vendor"), yang langsung memakainya pada baris itu.
  4. Bila ejaan salah: **Rename** (nama lama disimpan di "Other spellings"/`aka` agar pencarian dan pembaca chat tetap mengenalinya). Nama yang sama dengan vendor lain ditolak `name_taken` — gabungkan keduanya.
  5. Bila duplikat: **Merge** → "Pick the vendor" yang dipertahankan. Baris yang kalah tidak dihapus: ditandai `merged_into`, ejaannya pindah ke vendor pemenang.
  6. Bila tidak lagi dipakai: **Archive** (keluar dari semua pilihan, riwayat tetap). **Restore** bisa kapan saja (centang "Show archived").
  7. Hapus (**Delete**) hanya untuk vendor yang belum dipakai apa pun.

- **Aturan & kontrol**
  - `name_required`: vendor wajib punya nama.
  - Hapus ditolak `vendor_in_use` dengan rincian hitungan (transaksi, baris PR, PO, rencana pembayaran, barang yang terakhir dibeli dari vendor itu, vendor yang digabung, pembelian log kayu); sistem menawarkan "Archive instead".
  - Gabung ditolak: `merge_into_self`, `already_merged`, `circular_merge`.
  - Arsip ditolak `already_merged` untuk vendor yang sudah digabung.
  - Penggabungan tidak pernah memindahkan atau mengubah transaksi lama (D41).
  - Rekening kedua ada karena sebagian vendor menagih dari satu rekening dan menerima di rekening lain. Salah bayar = seminggu mengejar.

- **Jejak data (apa yang terekam)**
  - Tabel `ops_procure.vendors` (kode, nama, `aka`, `is_curated`, `merged_into`, `archived_at`, kontak, `bank_account`, `bank_account_secondary`, `npwp`, `supplied_categories`).
  - Audit log berisi sebelum/sesudah. Tampilan `v_vendor_view` menghitung: jumlah transaksi, total belanja, pembelian terakhir, baris PR terbuka, kategori yang benar-benar dibeli, barang yang dibeli (diturunkan dari riwayat, tidak disimpan).
  - Tidak ada file/dokumen yang diunggah di layar ini, jadi tidak ada folder Drive.

- **Serah-terima ke tim lain**
  - Accounting memakai kode vendor di setiap transaksi pembelian (jenis transaksi bertanda Purchase mewajibkan vendor, `vendor_required`) dan di rencana pembayaran.
  - Inventory membaca vendor lewat riwayat pembelian barang ("Where we buy this").
  - PIC dan telepon dipakai tim lapangan untuk menghubungi vendor.

- **Koreksi & pengecualian**
  - Salah nama: Rename. Duplikat: Merge. Berhenti membeli: Archive. Tidak pernah dipakai: Delete.
  - Kurasi bisa dibalik (**Uncurate**).
  - Isi kontak yang dikosongkan di formulir tidak menghapus nilai lama (kolom kosong dianggap "tidak diubah").

- **Checklist rutin**
  - Mingguan: buka `/master-data/suppliers` → kartu "Not yet curated". Kurasi atau gabungkan vendor baru yang dibuat dari form PR.
  - Bulanan: arsipkan vendor yang sudah tidak dipakai. (Kadensi ini usulan penulis, belum diputuskan pemilik.)

- **Sumber**
  `src/app/(app)/master-data/suppliers/page.tsx`; migrasi `0006`, `0016` (merge/curate), `0017` (create), `0032`, `0099` (rename/archive/delete); D30, D33, D41, F8; `src/services/procurement/contracts.ts` (`Vendor`, `VendorView`).

---

### Master data — Barang (item), Kategori barang, Satuan (unit)

- **Tujuan**
  Katalog barang beli yang dipakai PR, PO, penerimaan, BOM, dan stok. Struktur tiga tingkat: Category → Item type → Item (mis. Packing → Foam Sheet → Foam Sheet 2mm). Satuan dan konversinya menjamin jumlah di PR, PO, dan stok bisa dijumlahkan.

- **Pemilik / peran & kewenangan**
  - Lihat: `procurement.read`. Tambah barang (`create_item`): `procurement.create`.
  - Semua perubahan lain: `procurement.update`: `update_item`, `curate_item`, `archive_item(s)`, `merge_item`, `set_items_category`, `create/update/delete_category`, `create/update/delete_uom`, `save/delete_uom_conversion`.
  - Tidak ada wewenang khusus.
  - Layar Item categories dan Units juga menggunakan `procurement.update` untuk tombol tulis.

- **Prasyarat**
  Cek dulu apakah barang sudah ada (nama termasuk spesifikasi: ukuran, warna, atau satuan berbeda = barang berbeda). Satuan yang dibutuhkan harus sudah ada di Units.

- **Langkah-langkah**
  1. Staf procurement → `/master-data/items` → **Add item** → isi "Item name, with its specification", "Category › item type" (pilih dari daftar), "Base unit" → **Add item**. Hasil: barang `I-NNNNN`, status **Not yet curated**. Kategori yang tidak ada ditolak `no_such_category`; satuan yang tidak ada ditolak `no_such_uom`.
  2. Periksa dan lengkapi: buka barang → **Edit** → Name, Category, Base unit, "Kind" (**Goods**/**Service**), "Standard price (IDR)" ("Leave empty for none") → **Save**. Nama lama otomatis jadi nama lain (`aka`).
  3. **Curate** barang yang sudah benar. Hanya barang terkurasi yang muncul di pilihan Item di form PR (`New request`).
  4. Merapikan tumpukan barang belum terkurasi: **Suggest filing** (SuggestPanel) mengelompokkan nama yang diawali kata sama dan mengusulkan jenis; centang barang → "File selected under" (Pilih kategori/jenis) → **File them**. Kelompok yang tampak seperti deskripsi pembayaran (transfer, payroll, uang makan) bisa diarsipkan sekaligus dengan satu alasan (`archive_items`).
  5. Duplikat: **Merge into…** → "Find the item to keep". Salah satu dihapus dari daftar tetapi riwayatnya mengikuti penunjuk ke barang yang dipertahankan.
  6. Kategori: `/master-data/categories` → **Add category** (tingkat atas) atau **Add item type** (di bawah kategori) → Name, "Sits under" → **Save**. Kode kategori dibuat dari nama.
  7. Satuan baru: `/master-data/units` → **Add unit** → Code (huruf kecil, angka, `-` atau `_`, 1–20 karakter), Name, Dimension (count, mass, length, area, volume, time) → **Save**. Konversi: **Add conversion** → dari satuan, ke satuan, Factor, "Yield (optional, 0–1)" (hanya bila bahan hilang, mis. 0.52).

- **Aturan & kontrol**
  - Barang: `name_required`, `no_such_category`, `no_such_uom`, `name_taken` (nama sudah dipakai barang lain: gabungkan bila sama), `category_unknown`, `uom_unknown`, `price_negative`, `already_merged`.
  - Merge: `merge_into_self`, `already_merged`, `winner_merged`, `item_in_use_by_code` (kode barang masih dipakai sebagai teks bebas di tempat lain).
  - Kategori: maksimal dua tingkat (`too_deep`); "Not yet curated" adalah kantong penampung yang tidak boleh punya jenis (`parent_reserved`/`reserved`) dan tidak bisa dihapus; hapus kategori terpakai ditolak `category_in_use`.
  - Satuan: hapus ditolak `uom_in_use` bila masih dipakai barang, baris PR/PO, baris proyek, baris transaksi, gerak stok, atau konversi; kode tidak pernah berubah; konversi ditolak `same_uom`, `factor_invalid`, `yield_invalid`, `reverse_exists`.
  - Harga standar tidak pernah ditulis otomatis. `last_price` hanya bergerak maju. Keduanya hanya petunjuk, bukan daftar harga.

- **Jejak data (apa yang terekam)**
  - `ops_procure.items` (kode, nama, `aka`, kategori, `base_uom`, `kind`, `is_curated`, `standard_price`, `last_price`, `last_vendor_id`, `last_purchased_at`, `archived_at`, `name_local`), `item_categories`, `uom`, `uom_conversions`.
  - Setiap penulisan masuk audit log dengan sebelum/sesudah.
  - Foto barang yang diambil dari rak disimpan Inventory di Drive: PROCUREMENT → `ops-talaliving/INVENTORY/ITEMS` (D309). Layar Items sendiri tidak mengunggah file.
  - Laci barang menampilkan "Ledger purchases" (baris buku besar yang menyebut barang ini) dan "Where we buy this" (diturunkan dari riwayat).

- **Serah-terima ke tim lain**
  - Production: BOM menunjuk barang lewat kode barang; kategori yang dihitung stok (`ops_inv.stocked_categories`) menentukan apakah penerimaan menambah stok.
  - Inventory: katalog yang sama dipakai untuk Input stock dan Register an item (nama lapangan `name_local`).
  - Accounting: jenis transaksi bertanda "Creates items" mengisi katalog dari rincian baris.

- **Koreksi & pengecualian**
  - Salah ketik: Edit (nama lama tersimpan di `aka`). Duplikat: Merge. Tidak dipakai: Archive (tidak pernah Delete). Salah kategori: Edit atau **File them** massal.
  - Satuan barang boleh diubah, tetapi Inventory menolak ubah satuan bila sudah ada gerak stok dalam satuan lain (0198).
  - Barang jasa (`Service`) dihitung selesai tanpa penerimaan jumlah.

- **Checklist rutin**
  - Mingguan: buka `/master-data/items` → filter "Not yet curated"; kurasi, rapikan kategori, gabung duplikat.
  - Setiap ada barang baru dari lapangan: pastikan nama dengan spesifikasi dan satuan dasar benar sebelum dipakai di PR.

- **Sumber**
  `master-data/items`, `categories`, `units` (halaman dan `SuggestPanel.tsx`); migrasi `0006`, `0017`, `0099` (units), `0104` (item master), `0112`, `0120`, `0168` (`name_local`), `0197` (kategori dua tingkat, 16 jenis baru); D309, D346, D347; `src/services/procurement/suggest.ts`.

---

### Master data — Klien dan Proyek

- **Tujuan**
  Klien adalah master data (bukan kalimat yang diketik di tiap proyek). Proyek adalah pesanan klien, dimensi yang dipakai semua modul: procurement membeli untuk proyek, produksi membuat untuk proyek, buku besar mengeluarkan biaya atas proyek (D149).

- **Pemilik / peran & kewenangan**
  - Layar `/master-data/clients` butuh `project.read`. Buat klien: `project.create`. Ubah/arsipkan klien dan proyek, ubah status proyek, ubah baris pesanan: `project.update`.
  - Catatan: ini kewenangan modul `project` (Project Manager), bukan `procurement`. Procurement hanya membaca daftar proyek untuk memilih proyek di PR.

- **Prasyarat**
  Cek dulu apakah klien sudah ada (satu klien hidup per nama, huruf besar/kecil diabaikan, `client_exists`).

- **Langkah-langkah**
  1. PM → `/master-data/clients` → **New client** → isi Client name, Contact, Phone / WA, Address, NPWP, Note → **Save**. Hasil: `CL-NNNN` (dibuat otomatis).
  2. Buka klien (`/master-data/clients/[code]`) → lihat proyek dan quotation klien ("All revisions, newest first"), **Edit contact**, **Archive**/**Restore**.
  3. Proyek dibuat dan diubah di modul Project (di luar bab ini); statusnya: `INQUIRY`, `QUOTATION_SENT`, `DEAL`, `IN_PRODUCTION`, `SHIPPED`, `DONE`, `CANCELLED`. Setiap perpindahan tercatat siapa dan kenapa; `CANCELLED` wajib alasan (`reason_required`).
  4. Proyek `is_active` (belum DONE/CANCELLED) muncul sebagai pilihan "Project" di form PR.

- **Aturan & kontrol**
  - `name_required`, `client_exists`, `client_unknown`, `dates_reversed` (tanggal kirim lebih awal dari tanggal mulai), `negative_value` (nilai kontrak), `unknown_status`, `reason_required` (batal), `qty_required`, `negative_price`, `no_such_uom` (baris pesanan).
  - Kode proyek dan kode klien tidak pernah berubah. Semua modul menyebut proyek lewat kode teks.

- **Jejak data (apa yang terekam)**
  `ops_procure.clients`, `projects` (client, status, pic, tanggal, `contract_value`), `project_lines`, riwayat status proyek; CRM klien `client_activities` (telepon, WhatsApp, email, rapat, kunjungan, catatan, dengan tindak lanjut; hanya tambah, tidak diedit; `0134`). Tidak ada file di layar klien.

- **Serah-terima ke tim lain**
  Production menerima baris pesanan (untuk Job Order dan BOM); Accounting memakai kode proyek di transaksi; Marketing/PM memakai klien untuk quotation dan CRM.

- **Koreksi & pengecualian**
  Klien salah ketik: Edit contact. Klien tidak aktif: Archive (tidak dihapus). Perubahan status proyek bisa bergerak ke status mana pun (tercatat).

- **Checklist rutin**
  Mingguan (PM): pastikan klien baru terdaftar sebelum proyek baru dibuat; pastikan status proyek mutakhir supaya picker PR tidak penuh proyek selesai.

- **Sumber**
  `master-data/clients/*`; migrasi `0111`, `0133` (quotation), `0134` (CRM klien); D149, D150; `contracts.ts` (`Client`, `Project`, `ProjectStatus`).

---

### Master data — Rekening (accounts), Jenis transaksi, Kategori aset

- **Tujuan**
  Tiga daftar acuan yang dipakai ketika uang dibukukan dan aset dicatat: rekening sumber/tujuan, makna sebuah baris buku besar (jenis transaksi), dan jenis aset. Dikelola dari layar, bukan lewat migrasi (`0105`, `0107`).

- **Pemilik / peran & kewenangan**
  - Accounts (`/master-data/accounts`, menu butuh `accounting.read`): ubah butuh `accounting.update` **dan** wewenang `post_ledger`. Rekening pimpinan (custody `leadership`, mis. BCA 064): membuat, mengubah, atau memindahkan ke/dari kustodi pimpinan juga butuh `approve_funds` (`leadership_account`, D87).
  - Transaction types (`/master-data/transaction-types`): `accounting.update`.
  - Asset categories (`/master-data/asset-categories`, menu butuh `inventory.read`): ubah butuh `inventory.update`.

- **Prasyarat**
  Keuangan: cek dulu daftar rekening dan jenis yang ada. Rekening baru: nomor, mata uang, saldo awal per tanggal, dan bukti saldo awal (rekening koran).

- **Langkah-langkah**
  1. Keuangan → **Add account** → Code (2–24 karakter huruf/angka/spasi/titik/strip, mis. "BCA 271"), Currency (tiga huruf, mis. IDR), Name, "Held by" (Accounting/Leadership), "Pays vendors", "Opening balance", "As of" → **Save**. Hasil: rekening aktif; muncul di picker.
  2. Ubah rekening: **Edit**. Mengubah saldo awal wajib alasan ("Why the opening balance changes", `reason_required`); mata uang terkunci setelah ada transaksi (`currency_locked`). Rekening pimpinan tidak boleh "Pays vendors" (`leadership_not_paying`, D87).
  3. Hapus rekening hanya bila tidak ada transaksi (`account_in_use`); selain itu hilangkan centang **Active** (rekening hilang dari picker, riwayat tetap).
  4. Keuangan → Transaction types → **Add type** → Code (huruf kapital, 2–40 karakter, tidak bisa diganti nama), "What it is for", centang **Purchase** (baris jenis ini diharapkan menyebut PR atau PO), **Creates items** (rincian baris mengisi katalog), "Auto-complete" (dicadangkan, belum dijalankan) → **Save**. Jenis terpakai dipensiunkan (hilangkan centang **Active**), tidak dihapus (`type_in_use`).
  5. Staf inventory → Asset categories → **Add** → code (huruf kecil/angka/`-`/`_`, 2–30 karakter, mis. `cctv`), name, description → **Save**; kategori terpakai dinonaktifkan, bukan dihapus.

- **Aturan & kontrol**
  - Kode rekening, kode jenis, dan kode kategori aset tetap seumur hidup karena dipakai sebagai kunci di setiap baris yang ditulis.
  - Kode tidak valid: `code_invalid`; duplikat: `account_exists`, `type_exists`.
  - Semua penulisan lewat `ops_core.say` (audit dengan sebelum/sesudah).
  - Pengguna tanpa wewenang melihat pesan "Editing accounts needs accounting write access and the post_ledger authority."

- **Jejak data (apa yang terekam)**
  `ops_acct.accounts`, `ops_acct.transaction_types` (flag `is_purchase`, `creates_catalog_item`, `auto_complete`, `is_active`), `ops_inv.asset_categories`. Audit log untuk setiap perubahan. Tidak ada file.

- **Serah-terima ke tim lain**
  Jenis transaksi dan rekening dibaca oleh form pembayaran di Procurement ("Paid from", "Ledger type") dan oleh seluruh Accounting. Kategori aset dipakai Inventory dan pencocokan kiriman Chat (baris aset wajib punya kategori).

- **Koreksi & pengecualian**
  Rekening salah: Edit (atau hanya baris ledger yang salah rekening dikoreksi lewat Edit di ledger, D359, aturan penjaga dicatat di bab Accounting). Jenis atau rekening yang tidak lagi dipakai: nonaktifkan.

- **Checklist rutin**
  Bulanan (Keuangan): tinjau rekening nonaktif dan saldo awal; tinjau jenis transaksi baru yang dibuat di lapangan.

- **Sumber**
  `master-data/accounts`, `transaction-types`, `asset-categories`; migrasi `0013`, `0042`, `0105_acct_master_data`, `0107_inv_assets`, `0197_inv_categories_and_locations`; D87.

---

### Permintaan Pembelian (Purchase Request, PR)

- **Tujuan**
  Meminta barang atau jasa dibeli, dengan bukti harga, supaya pimpinan bisa memutuskan. Satu dokumen PR adalah satu kelompok pengajuan; satuan kerja sesungguhnya adalah **baris** yang disetujui, dibayar, dan diterima sendiri-sendiri (D28).

- **Pemilik / peran & kewenangan**
  - Membuat PR dan menambah baris: `procurement.create` (`create_pr`, `add_draft_line`, `quick_add_line`).
  - Mengajukan (`submit_pr`), mengedit baris (`update_line`), menghapus baris (`remove_line`), menjelaskan selisih (`explain_variance`): `procurement.update`.
  - Tidak ada wewenang. Persetujuan ada di proses berikutnya.
  - Bisa juga lewat John Lau (asisten): ketik "siapkan PR untuk lem kayu 5 kaleng"; draf muncul sebagai kartu Confirm/Cancel dan baru tertulis setelah "Ya, tulis" (D300, D317). Sistem tidak mengarang vendor atau harga.
  - Produksi bisa membuat PR draf dari BOM sebuah Job Order (`request_materials`, butuh `procurement.create`).

- **Prasyarat**
  - Barang ada di katalog dan terkurasi (atau diketik bebas sebagai "not in the catalogue").
  - Vendor terkurasi (atau tulis nama baru lewat "Add “…” as a new vendor").
  - Proyek sudah ada dan aktif (bila belanja untuk proyek).
  - **Bukti harga siap**: tautan toko atau chat vendor, penawaran (PDF/foto), nota, atau pilih PO terbuka yang menjadi dasar. Tanpa bukti, baris tidak akan bisa disetujui.

- **Langkah-langkah**
  1. Staf → `/procurement/pr` (Requests) → **New request** (`/procurement/pr/new`). Halaman penuh, bukan laci, karena diisi beberapa menit.
  2. Pilih **Project** di kartu "This request" (boleh "— no project —").
  3. Untuk setiap baris isi: "Item" (cari di katalog; memilih mengisi deskripsi, satuan, harga saran, vendor terakhir; semuanya bisa diubah), "Description", "Quantity", "Unit", "Unit price", "What is it for" (keperluan dengan nama job, mis. "Table tops, VILLA SEMINYAK"), "For which job in production" (Job Order terbuka, opsional, D152), "Vendor" (boleh "— not decided yet —"), "Category" (`RAW MATERIAL`, `MACHINING`, `FINISHING`, `SANDING`, `PACKING`, `OTHER`), "Needed by".
  4. Isi **"What stands behind it"** (Pendukungnya) per baris: pilih jenis `Reference Link` (tempel tautan toko/penawaran), `Receipt / Invoice / Nota`, `Purchase Order`, atau `Others`; unggah file lewat "Attach the quotation or the nota"; atau, untuk pembayaran sisa terhadap PO yang sudah ada, pilih "— which order is this against? —" (PO terbuka berstatus DRAFT/ISSUED). Bila ada file dan tautan, file yang dipakai.
  5. **Add another line** bila perlu. Nilai baris = jumlah × harga; baris jasa tanpa jumlah (ongkir, borongan) boleh diisi nominal langsung (D75).
  6. Tekan **Submit for approval** (Ajukan untuk persetujuan) untuk mengajukan langsung, atau **Save as draft** (Simpan sebagai draf). Hasil draf: PR `pr-YY-MM-DD_NN`, baris berstatus `DRAFT`, dokumen `DRAFT`, belum masuk antrean siapa pun. Hasil submit: dokumen `SUBMITTED`, baris `WAITING FOR APPROVAL`, kejadian `procurement.pr.submitted`. Bukti yang dilampirkan di form langsung ditautkan ke baris (`pr_line`).
  7. Draf lanjutan: `/procurement/pr/documents` (Submissions) → buka dokumen → **Submit for approval**.
  8. Bukti kurang: bila toast menyebut "N line(s) have nothing behind them", buka baris di `/procurement/pr` → laci → bagian dokumen → pilih jenis, **Paste a link** (tempel, Enter) atau **Choose a file**/**Photograph**.
  9. Item mendadak saat rapat: Meeting board → **Add an item** (QuickAdd): Item, "What it is for", Qty, Unit, Unit price, "Vendor (optional)" → **Add**. Ini PR sungguhan (nomor sendiri) yang langsung `SUBMITTED` (D73).

- **Aturan & kontrol**
  - `create_pr`: `not_permitted` (butuh `procurement.create`), `lines_required` (minimal satu baris), proyek tidak ada → not found. `description_required` untuk quick add dan tambah baris.
  - `submit_pr`: `already_submitted` (sudah diajukan), `no_lines` (tidak ada baris hidup), `not_permitted` (butuh `procurement.update`).
  - `source_wo_no` (Job Order) harus Job Order yang ada dan belum dibatalkan (`0171`).
  - Edit baris (`update_line`): ditolak `already_approved` (sudah disetujui; minta CEO un-approve atau hapus lalu minta lagi), `already_paid` (sudah dibayar, itu urusan retur/kredit/void), `line_removed`.
  - Hapus baris (`remove_line`): lunak dan tercatat; ditolak `money_has_reached_it` bila sudah ada uang masuk ke baris itu (D29). Tombol: **No longer needed** (Tidak diperlukan lagi).
  - Bukti harga: nilai baris `has_support` benar bila ada tautan/dokumen jenis `quotation`/`nota`/`purchase_order`/`other`, atau bila baris dibuat "against" PO terbuka (`0158`). Jenis `invoice` sengaja tidak ditawarkan karena tidak dihitung sebagai bukti.
  - Edit bisa mengubah jumlah, harga, nominal (untuk baris tanpa jumlah), vendor, kategori, keperluan; nilai kosong dianggap "tidak diubah".

- **Jejak data (apa yang terekam)**
  - `ops_procure.pr_documents`, `pr_lines` (nomor penuh `line_no_full`, item, deskripsi, qty, uom, harga, `item_total` = apa yang DIMINTA, tidak pernah dinolkan, vendor, kategori, `purpose`, `need_by`, `source_wo_no`, `against_po_id`, `removed_at/by`).
  - Dokumen pendukung di `ops_core.attachments` + `attachment_links` (entity `pr_line`, nomor baris, jenis).
  - Audit log + outbox untuk `procurement.pr.created`, `procurement.pr.submitted`, `procurement.line.removed`.
  - **Folder Drive** (di bawah `ops-talaliving` pada shared drive modul; drive dipilih oleh `ops_core.doc_kind_drive`):
    - `Reference Link` (kode `quotation`) berupa file → PROCUREMENT → `ops-talaliving/QUOTATION` (tidak ada baris `drive_paths`, jadi nama jenis dalam huruf kapital). Bila hanya tautan, tidak ada file dan tidak ada folder.
    - `Purchase Order` → PROCUREMENT → `ops-talaliving/PURCHASE ORDER`.
    - `Receipt / Invoice / Nota` (kode `nota`) → drive ACCOUNTING (batas data pribadi/uang) → `ops-talaliving/NOTA`, atau `TRANSACTIONS/<YYYY-MM>/<YYYY-MM-DD>` setelah IT menambah baris `drive_paths` untuk `nota` (lihat Kesenjangan).
    - `Others` → PROCUREMENT → `ops-talaliving/LAIN-LAIN`.
    - File yang persis sama (SHA-256) dengan yang sudah ada di drive yang sama tidak diunggah ulang; berkas yang ada yang ditautkan (D359).

- **Serah-terima ke tim lain**
  - Pimpinan menerima baris di Meeting board dan kartu Chat.
  - Production: `source_wo_no` menghubungkan belanja dengan Job Order (Job trail `/produksi/jejak`: PR → PO → penerimaan → stok → bahan keluar).
  - Accounting kemudian melihat baris yang disetujui untuk dibayar (lihat "Pembayaran baris PR").

- **Koreksi & pengecualian**
  - Baris salah sebelum disetujui: laci baris → **Edit item** → **Save line**.
  - Baris sudah disetujui dan perlu diubah: minta CEO **Un-approve** dulu (atau hapus dan buat baris baru).
  - Baris tidak diperlukan: **No longer needed** (selama belum ada uang masuk).
  - PR yang sudah SUBMITTED tidak punya aksi "tarik kembali" atau "batalkan dokumen"; yang ada hanya menghapus barisnya (lihat Kesenjangan).
  - Barang sudah dibeli dahulu baru dimintakan: jalur Retro request line di Accounting → Verifikasi (bab Accounting).

- **Checklist rutin**
  - Harian: `/procurement/pr/documents` → cari PR yang masih `DRAFT` terlalu lama dan ajukan atau hapus.
  - Harian: baris `WAITING FOR APPROVAL` tanpa bukti harga (badge "nothing behind them") → lengkapi sebelum rapat.

- **Sumber**
  `procurement/pr/new/page.tsx`, `pr/page.tsx`, `pr/LineDrawer.tsx`, `pr/documents/page.tsx`, `meeting/QuickAdd.tsx`; migrasi `0008`, `0009`, `0016` (`submit_pr`, `remove_line`), `0017` (`create_pr`, `update_line`), `0066`, `0158`, `0171`; D28, D29, D73, D75, D125, D151, D152, D300, D317; `docs/plan/penomoran.md`.

---

### Persetujuan barang — Meeting board dan Google Chat

- **Tujuan**
  Pimpinan memutuskan baris mana yang boleh dibeli dan berapa nilainya. Persetujuan barang adalah izin membeli, **berbeda** dari persetujuan uang. Setiap angka yang disetujui harus punya bukti harga (D125).

- **Pemilik / peran & kewenangan**
  - Memutuskan (menyetujui, mencabut, mengubah jumlah/nominal): hanya pemegang `approve_goods` (`approve_line`), tanpa pengecualian level modul. Jawaban dari Chat hanya diterima dari penerima kartu dan hanya bila orang itu masih memegang `approve_goods` (`answer_request`, `0159`).
  - Meminta persetujuan lewat Chat (`request_approval`): `procurement.update`.
  - Menulis instruksi/catatan di baris (`note_line`): `approve_goods` atau `approve_funds`. Staf boleh mengetik "apa kata rapat" yang ikut terkirim sebagai konteks, tetapi baru menjadi instruksi pimpinan bila pimpinan mengirimkannya kembali (D127).
  - Menjelaskan selisih bayar vs setuju: `procurement.update`.

- **Prasyarat**
  Baris berstatus `WAITING FOR APPROVAL` (PR sudah `SUBMITTED`) dan **punya bukti harga**. Ada minimal satu orang pemegang `approve_goods`.

- **Langkah-langkah**
  A. Rapat dengan pimpinan hadir:
  1. Pimpinan (`approve_goods`) → `/procurement/meeting` (Meeting board) → di tabel "Waiting for a decision" centang kolom **Approve this** untuk tiap baris. Boleh mengubah "Approve how many"/"For how much" (lebih kecil atau lebih besar dari permintaan; keduanya diizinkan, D76) dan mengetik instruksi di kolom Instructions → **Record it**.
  2. Tekan **Approve N · Rp…** (di bawah tabel). Hasil: baris `APPROVED`; satu baris `pr_approvals` (step `GOODS`, approved, qty, amount, `recorded_by`, `recorded_by_email`, channel `web`); instruksi/remark masuk `line_notes`; kartu Chat yang masih menggantung untuk baris itu ditutup; kejadian `procurement.line.approved`.
  3. Mencabut: di laci baris (`/procurement/pr`, bagian Decision) → **Un-approve** (Cabut persetujuan). Mencabut tidak pernah diblokir karena kekurangan dokumen.
  B. Pimpinan tidak di ruangan, atau staf yang memegang laptop (jalur yang disarankan, D69):
  1. Staf → Meeting board → centang baris → tombol **Ask <nama pemegang approve_goods> on Chat · Rp…** (juga ada **Ask for approval on Chat** di laci baris). Tombol memakai nama dari daftar pemegang `approve_goods`; bila tidak ada, tombol bertuliskan "Nobody holds approve_goods".
  2. Sistem membuat kelompok `ask-YY-MM-DD_NN` berisi satu permintaan per baris dengan token tersendiri, dialamatkan ke satu orang, mencatat siapa yang mengirim, dan kejadian `procurement.approval.requested` (satu-satunya kejadian yang diizinkan sampai ke kanal Chat, migrasi `0155`). Kartu memuat total diminta, total disetujui, dan yang harus dibayar.
  3. Pimpinan menjawab dari kartu di Google Chat. Identitas yang tercatat adalah akun Google pimpinan yang menjawab (bukan laptop rapat). Jawaban setuju dari Chat menyetujui jumlah dan nominal **seperti yang diminta** (kartu tidak memotong).
  4. Jawaban dari browser tidak diterima: `answer_request` hanya bisa dipanggil worker Chat (`service_role`, `0157`).
  C. Tindak lanjut:
  1. Baris yang disetujui tampil di "Approved — not paid yet" dan di kartu uang (MoneyPanel: "Approved, not paid yet", "Waiting for a decision", "BCA 271 balance", "Transfer into BCA 271").
  2. Banner merah "Money moved before anyone approved it": ada baris yang sudah dibayar tetapi belum disetujui (kuadran "Paid, not approved"). Membayar bukan memutuskan: keputusan tetap diambil di papan ini.

- **Aturan & kontrol**
  - `approve_line`: `authority_required` ("This decision belongs to the CEO — logged, not applied."), `line_removed`, `support_required` (tak ada tautan/faktur/PO di baris; berlaku juga untuk pimpinan), `already_decided` (sudah dalam keadaan itu; tidak ada update ganda, jejak hanya menambah).
  - `request_approval`: `not_permitted`, `no_approver`, `not_an_approver` (alamat yang dituju tidak memegang `approve_goods`; celah ini ditutup `0159`), `support_required` (menyebut baris-barisnya; kartu tanpa bukti tidak dikirim ke HP), `nothing_to_ask` (semua sudah diputuskan atau sedang menunggu jawaban).
  - `answer_request`: `already_answered`, `not_the_approver` (kartu bersifat dialamatkan, bukan disiarkan), `authority_required`, `line_already_decided` (kartu basi).
  - Persetujuan boleh di atas atau di bawah permintaan (D76); selisih permintaan vs disetujui tetap tercatat dan dilaporkan sebagai bagian dari keputusan, bukan variance.
  - Chat hanya untuk barang dan penerimaan, tidak untuk keputusan dana (D33): menyetujui Payment round tetap di web.
  - Bukan ambang nilai: tidak ada batas nominal, tidak ada tingkat kedua (D19).

- **Jejak data (apa yang terekam)**
  `ops_procure.pr_approvals` (hanya tambah; setiap centang adalah satu baris, "approved 14:02, un-approved 14:09" tetap terbaca; `channel` = `web` atau `chat`), `line_notes` (instruksi dan remark, hanya tambah), `approval_batches`, `approval_requests` (token, `sent_to_email`, `sent_by_email`, `meeting_note`, `answered_at`, `outcome`). Audit dan outbox. Lampiran bukti tetap di baris. Tidak ada file baru dari proses ini.

- **Serah-terima ke tim lain**
  - Procurement (staf) menerima baris `APPROVED` untuk dijadikan PO.
  - Accounting/Keuangan menerima baris `APPROVED` untuk dibayar di `/procurement/pr` (laci baris → "Record the payment"). Saldo BCA 271 dan "Transfer into BCA 271" membantu Keuangan memutuskan transfer pendanaan.
  - IT: pengiriman kartu bergantung pada worker Chat di luar repo (lihat Kesenjangan).

- **Koreksi & pengecualian**
  - Salah setuju: **Un-approve** (tidak ada penjaga tambahan bila baris sudah masuk PO; lihat Kesenjangan).
  - Kartu basi: kartu dari Chat tertutup otomatis bila baris sudah diputuskan di aplikasi.
  - Pimpinan tidak ada: tidak ada pengganti (D30). Pemilik dapat memberi `approve_goods` ke orang lain lewat IT → Users.
  - Baris tidak diinginkan: dihapus (REMOVED), bukan "ditolak": status HELD/REJECTED tidak ada (D28).

- **Checklist rutin**
  - Saat rapat: Meeting board "Waiting for a decision" dikosongkan; instruksi dicatat per baris.
  - Harian: baris yang sudah "asked … on chat" tetapi belum dijawab → ingatkan pimpinan.
  - Harian (Keuangan/pimpinan): banner "Money moved before anyone approved it" harus nol.

- **Sumber**
  `procurement/meeting/*`, `pr/DecisionPanel.tsx`, `pr/ApprovalTrail.tsx`; migrasi `0009`, `0016`, `0017`, `0155`, `0157`, `0159`, `0160`; D19, D24, D28, D30, D33, D64, D65, D69, D70, D73, D74, D76, D125, D126, D127; F15, F16.

---

### Pembayaran baris PR dan penjelasan selisih (serah ke Keuangan)

- **Tujuan**
  Mencatat uang yang keluar untuk satu baris PR yang sudah disetujui, dengan bukti transfer, dalam satu aksi: transaksi buku besar + alokasi ke baris. Selisih antara disetujui dan dibayar harus dijelaskan.

- **Pemilik / peran & kewenangan**
  - Mencatat pembayaran: `accounting.create` **dan** wewenang `post_ledger` (tombol "Record the payment" hanya aktif bagi pemegang keduanya).
  - Menjelaskan selisih: `procurement.update`.

- **Prasyarat**
  Baris sudah `APPROVED` (atau membayar lebih dulu, yang akan tampil sebagai "Paid, not approved"); bukti transfer atau nota; rekening sumber dan jenis transaksi dipilih dari master data.

- **Langkah-langkah**
  1. Keuangan → `/procurement/pr` → klik baris → laci → **Record the payment**: isi "Date paid", "Amount paid", "Paid from", "Ledger type" (mis. `SUPPLIERS`), lampirkan bukti ("Attach the payment proof") → **Post Rp… to the ledger**. Hasil: transaksi `trx-YY-MM-DD_NNN` (status `POSTED`), alokasi pembayaran ke baris `pr-…-L01`; baris menjadi `PAID` bila lunas dalam toleransi.
  2. Baris tanpa jumlah (ongkir, jasa) dibayar dengan cara yang sama; rincian buku besar tercatat "1 lot × nominal" dan baris PR tetap tanpa jumlah (D298, `0141`).
  3. Bila baris sudah ada di PO, pembayaran otomatis terbaca juga di PO (alokasi menyebut baris dan PO, dihitung sekali di tiap sisi, `0139`).
  4. Bila uang yang keluar tidak sama dengan yang disetujui: laci baris → bagian "Approved against paid" → **Explain the difference** → pilih "What happened" (`price_changed`, `quantity_changed`, `rounding`, `input_error`, `partial_payment`, `overpaid`, `other`) + Detail ("required" untuk `other`) → **Record explanation**.

- **Aturan & kontrol**
  - `post_from_line`: `authority_required`, `pr_line_not_found`, `line_removed`, `evidence_required` (tanpa bukti transfer tidak ada pembayaran), `vendor_required` (jenis transaksi pembelian tanpa vendor; vendor baris dicari dari PO bila baris sudah dipesan, `0145`), `allocation_failed`.
  - Selisih: `explain_variance` hanya jika selisih material (`no_material_variance` bila di bawah toleransi); toleransi pembayaran bawaan 1.000 rupiah (setting `payment_tolerance_idr`). Penjelasan hanya tambah (koreksi = penjelasan baru), nominal selisih saat itu dibekukan.
  - Alasan yang dipilih adalah daftar tertutup supaya bisa dihitung per vendor dan per orang (enam `input_error` dari orang yang sama = soal pelatihan).

- **Jejak data (apa yang terekam)**
  `ops_acct.transactions` + `transaction_lines` + `payment_allocations`; `ops_procure.line_variances`. Bukti transfer: jenis `Payment Proof` (`transfer_proof`) → drive ACCOUNTING (`NOTA`/`TRANSFER PROOF` atau pohon bulan sesuai baris `drive_paths`; lihat Kesenjangan). Audit dan outbox accounting.

- **Serah-terima ke tim lain**
  Accounting memegang transaksi, rekening koran, dan verifikasi; bab Accounting menjelaskan "Mark completed", Verifikasi, dan Rekening koran. Procurement membaca hasilnya (status `PAID`, `trx_nos`).

- **Koreksi & pengecualian**
  Salah catat: koreksi lewat Edit atau VOID di ledger (bab Accounting). Selisih sudah dijelaskan keliru: buat penjelasan baru.

- **Checklist rutin**
  Harian (Keuangan): baris `APPROVED` yang menunggu bayar; baris dengan label "needs an explanation".

- **Sumber**
  `pr/PayFromLine.tsx`, `pr/VariancePanel.tsx`; migrasi `0014`, `0034`, `0141`, `0145`, `0016` (`explain_variance`); D126, D298, F150.

---

### Purchase Order (PO)

- **Tujuan**
  PO adalah janji atas nama perusahaan kepada vendor: dibuat sebagai draf, dikonfirmasi pimpinan, baru diterbitkan. Sebelum diterbitkan tidak ada utang; sesudahnya DP menjadi kewajiban (D132).

- **Pemilik / peran & kewenangan**
  - Membuat PO draf: `procurement.create` (`create_po`).
  - Minta konfirmasi (`request_po_approval`), terbitkan (`issue_po`), ubah baris (`amend_po_line`), ubah tanggal perkiraan kirim (`set_expected_delivery`), tandai sudah dikirim ulang (`mark_po_resent`): `procurement.update`.
  - **Konfirmasi PO (`approve_po`)**: hanya `approve_goods`. Dua jalan menuju PO terkonfirmasi (D267, `0143`): (1) pimpinan yang menulis sendiri, PO langsung terkonfirmasi saat dibuat, `self_confirmed = true` (tidak ada orang kedua yang memeriksa, dan itu disebut jelas di layar); (2) staf yang menulis, lalu meminta konfirmasi, dijawab pimpinan di kartu Chat (identitas dari Google) atau dengan **Confirm it** di halaman PO.
  - **Tutup PO (`close_po`)**: `approve_funds` (Keuangan).

- **Prasyarat**
  Vendor terkurasi. Idealnya baris PR sudah `APPROVED` (PO dibangun dari baris itu). Boleh juga PO tanpa PR (kontrak tetap, perbaikan yang dikutip di tempat). Harga satuan disepakati (wajib > 0).

- **Langkah-langkah**
  1. Staf → `/procurement/po` atau `/procurement/tracker` → **Add new PO** (modal "New purchase order"). Pilih Vendor, lalu per baris pilih "From request line (optional)" (barang, jumlah, satuan, harga terisi dari yang disetujui) atau ketik manual (Item, Qty, Unit, Unit price). Isi "Deposit (%)" bila ada DP, "Note (optional)", "Expected delivery". → **Create the draft**. Hasil: PO `po-YY-MM-DD_NN` berstatus `DRAFT`; bila DP > 0 dibuat dua termin otomatis: `-M01` (DP, saat PO terbit) dan `-M02` (pelunasan, saat barang diterima); uang yang sudah masuk ke baris PR ikut terbaca di PO.
  2. Staf → buka PO → **Ask leadership to confirm** (Minta konfirmasi pimpinan). Dikirim ke pemegang `approve_goods` (`approval_sent_to`, token `potok_…`). Hasil: banner "Waiting on leadership"; kejadian `procurement.po.approval_requested`.
  3. Pimpinan → buka PO yang sama → **Confirm it** (atau jawab kartu Chat; menolak wajib alasan satu kalimat). Hasil: `approved_at`, `approved_by`; PO tetap `DRAFT` tetapi terkonfirmasi.
  4. Staf → **Issue and send it** (Terbitkan dan kirim). Hasil: status `ISSUED`, `issued_at`, `issued_by`, `sent_revision = revision`; DP menjadi "Payable now". Kejadian `procurement.po.issued`.
  5. Cetak: **Print / PDF** (`/procurement/po/[po]/print`, tanpa menu; berisi kode QR menuju halaman PO kita, D244) atau **Send on WhatsApp**. Pengiriman ke vendor dilakukan manual oleh staf; sistem tidak mengirimnya.
  6. Perubahan sesudah diterbitkan: baris PO → **Amend** (Ubah): isi Quantity dan/atau Unit price dan "Why it changed" (wajib). Baris lama tetap, menunjuk baris baru; nomor revisi naik; banner "changed, not re-sent" sampai staf menekan tombol tandai terkirim (`mark_po_resent`). Konfirmasi ulang oleh pimpinan tidak diminta (D135).
  7. Tanggal janji vendor: ubah "Expected delivery" (halaman PO). Keterlambatan dihitung dari tanggal ini (D134).
  8. Penutupan: setelah barang lengkap dan uang lunas, Keuangan → **Close it**. Bila belum selesai, **Close it anyway** dengan "Why close it anyway".
  9. Pembayaran dan pengajuan pembayaran: lihat proses "Pembayaran PO".

- **Aturan & kontrol**
  - `create_po`: `not_permitted`, `vendor_required`, `lines_required`, `price_required` (harga kosong/nol; "nilai kontrak yang tidak disepakati bukan kontrak"), `dp_out_of_range` (0–100), `line_named_twice`, `pr_line_not_found`, `line_removed`, `line_not_approved`, `line_already_ordered` (menyebut nama PO), `lump_sum_line` (baris tanpa jumlah adalah uang, dibayar tidak dipesan), `uom_differs` (satuan harus sama dengan baris PR).
  - `request_po_approval`: `not_a_draft`, `already_approved`, `lines_required`, `not_an_approver`, `no_approver`.
  - `approve_po`: `authority_required`, `not_a_draft`, `already_approved`, `reason_required` (menolak tanpa alasan).
  - `answer_po_approval` (khusus worker Chat): `not_the_addressee`, `authority_required`, `already_answered`, `not_a_draft`, `reason_required`.
  - `issue_po`: `not_permitted`, `already_issued`, `not_approved` (PO belum dikonfirmasi pimpinan), `no_lines`.
  - `amend_po_line`: `reason_required`, `order_closed`, `bad_values`, tidak ada perubahan = noop.
  - `close_po`: `authority_required`, `never_issued` (draf dibatalkan, bukan ditutup), `close_refused` (menyebut blocker: utang belum lunas, barang belum lengkap); boleh ditutup lebih awal dengan alasan tertulis yang masuk audit (`settled_early`, D130).
  - Termin dibayar berurutan dari yang tertua; termin yang pemicunya sudah jatuh tetapi termin sebelumnya belum dibayar berstatus `BLOCKED` (D128). "Billable now" = bagian DP setelah PO terbit + bagian yang sudah dikirim, dikurangi yang dibayar, tidak pernah negatif (D99). Kelebihan kirim = kredit dengan vendor, bukan nilai diterima (D98).
  - Satu baris PR hanya boleh ada di satu PO yang masih berjalan. Pemeriksaan "hanya baris APPROVED/PAID dengan vendor sama atau belum ditentukan" pada dropdown "From request line" ada di layar; di fungsi database yang dicek adalah persetujuan, bukan duplikat, satuan, dan jumlah (vendor tidak dicek di database).

- **Jejak data (apa yang terekam)**
  `ops_procure.purchase_orders` (status, `approval_asked_*`, `approval_sent_to`, `approval_token`, `approved_*`, `approval_note`, `self_confirmed`, `revision`, `sent_revision`, `expected_delivery`), `po_lines` (`pr_line_id`, `superseded_by`), `po_schedule` (termin). Tampilan `v_po_status`, `v_po_terms`, `v_po_journey`. Audit dan outbox: `procurement.po.created/approved/declined/issued/amended/closed`. Dokumen PO tercetak/PDF: tidak disimpan otomatis ke Drive; berkas yang diunggah dengan jenis `Purchase Order` masuk PROCUREMENT → `ops-talaliving/PURCHASE ORDER`. Kartu "Filed against it" di halaman PO menampilkan dokumen yang tertaut.

- **Serah-terima ke tim lain**
  - Accounting menerima kewajiban (Payable now) yang dibayar dari halaman PO.
  - Inventory menerima stok lewat penerimaan atas baris PO (proses Penerimaan).
  - Production membaca belanja per Job Order lewat baris PR yang tertaut.

- **Koreksi & pengecualian**
  - Angka salah pada draf: edit bebas lewat Amend (draf tidak menaikkan revisi).
  - Angka salah setelah terbit: Amend dengan alasan; kirim ulang kertas revisi ke vendor, lalu tandai terkirim.
  - Pimpinan menolak: PO tetap `DRAFT` dengan catatan penolakan; perbaiki atau tinggalkan.
  - Order tidak jadi dikirim: tidak ada fungsi pembatalan PO; lihat Kesenjangan.
  - Selesai tidak rapi (dua lembar terakhir tidak pernah datang): **Close it anyway** dengan alasan.

- **Checklist rutin**
  - Harian: `/procurement/po` → tab draf: PO dengan banner "Waiting on leadership" (ingatkan pimpinan, B10 menyebabkan kartu PO belum sampai ke Chat).
  - Harian: order dengan tanggal janji lewat dan belum lengkap ("days late").
  - Mingguan: PO berstatus "changed, not re-sent".
  - Mingguan: PO yang sudah lunas dan lengkap → minta Keuangan menutup.

- **Sumber**
  `procurement/po/*`, `tracker/NewPo.tsx`; migrasi `0011`, `0016`, `0017`, `0033`, `0086`, `0139`, `0143`; D97–D100, D128–D135, D244, D267, D299; F36, F149, F151; backlog B10.

---

### Pembayaran PO dan pengajuan pembayaran dari PO

- **Tujuan**
  Membayar DP/termin PO dari halaman PO (satu pembayaran = satu baris buku besar), atau mengajukan pembayaran berdasarkan yang sudah dikirim lewat jalur PR agar pimpinan melihatnya di Meeting board.

- **Pemilik / peran & kewenangan**
  - Bayar langsung: `accounting.create` + `post_ledger` (`post_to_po`).
  - Ajukan pembayaran (PR) atas PO: `procurement.create` dan `procurement.update` (`request_po_payment`).

- **Prasyarat**
  PO `ISSUED`. Untuk pengajuan: ada jumlah yang "billable now" (DP sesudah terbit, atau barang yang sudah dikonfirmasi diterima).

- **Langkah-langkah**
  1. Keuangan → `/procurement/po/[po]` → lihat "Payable now" dan tabel "Payment terms" → kartu **Pay this order**: isi "Date paid", "Amount paid" (terisi otomatis sebesar Payable now), "Paid from", "Ledger type", lampirkan bukti → **Post Rp… to the ledger**. Hasil: transaksi `trx-…`, uang dibagi ke baris PR yang tertaut sebanding nilainya (bagian baris tanpa PR tercatat atas PO saja); `payment_state` menjadi `PARTIAL` atau `SETTLED`.
  2. Staf → halaman PO → kartu **Request payment (PR)** → isi Amount (kosong = "all that is billable") dan Note (mis. "termin 2, delivery of 30 Sep") → **Request**. Hasil: satu PR (`pr-…`) dengan satu baris "Pembayaran <PO> — <vendor>" **against** PO tersebut, langsung `SUBMITTED`; tampil di Meeting board; pimpinan menyetujui; Keuangan membayar dari baris itu; setelah dibayar, PO ikut terbaca lunas atau sebagian.

- **Aturan & kontrol**
  - `post_to_po`: `authority_required`, `po_not_found`, `not_issued` (draf tidak menimbulkan utang), `order_closed`, `amount_positive`, `over_contract` (tidak boleh melebihi sisa kontrak), `evidence_required`.
  - `request_po_payment`: `not_permitted`, `order_not_open`, `nothing_billable` (semua yang bisa ditagih sudah diajukan atau belum ada barang terkonfirmasi), `amount_positive`, `over_billable` (jumlah melebihi yang tersedia setelah dikurangi yang sudah diajukan).
  - Pengajuan yang sama atas pengiriman yang sama tidak bisa ganda (sisa yang tersedia dihitung ulang).

- **Jejak data (apa yang terekam)**
  Transaksi dan alokasi di `ops_acct`; PR pembayaran `against_po_id` di `pr_lines`; bukti transfer `Payment Proof` → ACCOUNTING; kejadian `procurement.po.payment_requested`.

- **Serah-terima ke tim lain**
  Accounting memegang buku besar; baris PR pembayaran melewati Meeting board seperti PR biasa.

- **Koreksi & pengecualian**
  Salah nominal: koreksi di ledger (bab Accounting). Kelebihan bayar: urusan dengan vendor, bukan pembayaran PO (ditolak `over_contract`).

- **Checklist rutin**
  Mingguan: Tracker → kolom "billable now" per vendor; ajukan pembayaran untuk yang sudah diterima.

- **Sumber**
  `po/[po]/PayPo.tsx`, `RequestPayment.tsx`; migrasi `0139` (`post_to_po`), `0158`, `0203` (`request_po_payment`); D99, D128, D358.

---

### Penerimaan barang (Purchase Tracker dan konfirmasi di Receiving Report)

- **Tujuan**
  Mencatat barang yang datang terhadap baris PO, dengan foto (wajib) dan tanda terima bertanda tangan. Penerimaan terhitung sebagai "diterima" hanya setelah dikonfirmasi (D131).

- **Pemilik / peran & kewenangan**
  - Melapor: `procurement.create` **atau** `inventory.create` (`create_receipt`): siapa pun yang berada di tempat, termasuk gudang pada malam hari.
  - Mengonfirmasi penerimaan (`confirm_receipt`): `procurement.update`: procurement bertanggung jawab atas pemeriksaan terhadap PO.
  - Tanpa wewenang.

- **Prasyarat**
  PO `ISSUED` yang barangnya datang. Foto barang. Tanda terima (surat jalan) bertanda tangan bila ada. Nama pemeriksa (QC).

- **Langkah-langkah**
  1. Penerima/staf → `/procurement/tracker` → pilih vendor (`/procurement/tracker/[vendor]`) → di baris PO tekan **Record arrival** (Catat kedatangan).
  2. Isi "How many arrived", "Condition", "Checked by (QC)" (bawaan: "me — I checked it myself"), "Note (optional)"; unggah "Photo of the goods" (jenis `Receiving Item`) dan "Tanda terima" (jenis `Delivery Note`).
  3. Tekan **Record what arrived** bila kedua dokumen ada (hasil `rcv-…` berstatus `CONFIRMED`: langsung terhitung), atau **Report it — tanda terima follows** bila baru foto (hasil `REPORTED`: tercatat, terlihat di mana-mana, belum menggerakkan angka apa pun).
  4. Penerimaan `REPORTED`: besok → `/procurement/penerimaan` (Receiving report) → daftar laporan menunggu → **Complete it** (Lengkapi) → isi "Counted in daylight", "Condition", "Checked by", unggah "Signed tanda terima" → **Confirm it**. Jumlah dan kondisi hitungan siang yang dipakai (D363, `0205`).
  5. Efek otomatis saat penerimaan `CONFIRMED`:
     - Baris PR yang dibeli PO itu bergerak: `PARTIAL` bila sebagian/belum lunas; `COMPLETED` bila lengkap + lunas + ada bukti bayar + tidak bermasalah.
     - Barang katalog masuk stok di rak asal barang itu (default `GUDANG`): satu gerak `receipt` dengan `ref_no = rcv-…` (lihat Serah-terima).
     - Sumbu pengiriman PO: `PENDING`/`PARTIAL`/`COMPLETE`; "billable now" bertambah.
  6. Kondisi bermasalah (`WRONG ITEM`, `RETURN TO SENDER`, `DAMAGED`, `MISSING PARTS`): baris tetap terbuka dan kejadian "notified" dipancarkan.

- **Aturan & kontrol**
  - `create_receipt`: `not_permitted`, `anchor_required` (harus menunjuk tepat satu: baris PR atau baris PO), `bad_qty` (jumlah > 0), `unknown_kind`, `photo_required` ("foto barang selalu wajib"), baris tidak ditemukan.
  - Foto saja → `REPORTED`; foto + `Delivery Note` → `CONFIRMED`.
  - `confirm_receipt`: `not_permitted`, `already_confirmed`, `bad_qty` (≤ 0 saat koreksi). Tanda terima opsional saat konfirmasi (`0086`).
  - Hanya penerimaan `CONFIRMED` dengan kondisi `GOOD`/bagian baik dari `PARTIALLY DAMAGED` yang menuntaskan baris (A18).
  - Kelebihan kirim dicatat sebagai "OVER", dihargai dan disebut kredit, tidak ikut nilai diterima (D98).

- **Jejak data (apa yang terekam)**
  `ops_procure.receipts` (nomor, `line_id` atau `po_line_id`, qty, kondisi, `received_by`, `qc_by`, status, `confirmed_by/at`), `attachment_links` (entity `receipt`; jenis `goods_photo`, `delivery_note`). Audit dan outbox `procurement.receipt.recorded/confirmed`. Stok: `ops_inv.stock_moves` (`receipt`, `ref_no = rcv-…`). Drive: PROCUREMENT → `ops-talaliving/RECEIVING REPORT/<YYYY-MM>/<YYYY-MM-DD>` (D360; `drive_paths` untuk `goods_photo`, `receiving_report`, `delivery_note`, `surat_jalan`). Sistem membaca hari kantor (WITA), bukan jam server.

- **Serah-terima ke tim lain**
  - Inventory: trigger `ops_inv.stock_from_receipt` (`0169`, `0180`) menambah stok saat penerimaan `CONFIRMED` (insert langsung CONFIRMED maupun REPORTED menjadi CONFIRMED). Kondisi pengecualian: barang tidak tertaut katalog ("the line names no catalogue item"; item PO diambil dari baris PR bila baris PO tidak punya), kategori bukan kategori yang dihitung stok, kondisi `WRONG ITEM`/`RETURN TO SENDER` (tidak disimpan), satuan baris berbeda dengan satuan dasar tanpa konversi di Units. Semua kasus itu memancarkan `inventory.receipt.not_stocked` dengan alasan, dan stok tidak bertambah. Barang `DAMAGED` tetap distok.
  - Accounting: "billable now" dan status PO menjadi dasar permintaan bayar.
  - Production: Job trail menampilkan penerimaan setelah PO dan sebelum stok keluar ke Job Order.

- **Koreksi & pengecualian**
  - Hitungan malam salah: saat "Complete it", isi hitungan siang dan kondisi; keduanya ditulis bersamaan dengan status `CONFIRMED` sehingga stok yang masuk adalah jumlah koreksi (D363).
  - Penerimaan yang sudah `CONFIRMED` tidak punya aksi edit/batal di kode (lihat Kesenjangan).
  - Stok tidak tertambah karena alasan di atas: perbaiki master data (kategori/ konversi) lalu catat gerak stok lewat Inventory (Input stock); tidak ada backfill otomatis (Q58).
  - Penerimaan yang ditandatangani antara `0169` dan `0180` tidak otomatis menambah stok (di produksi tidak ada yang terdampak, per catatan Q58).

- **Checklist rutin**
  - Harian pagi: `/procurement/penerimaan` → kartu laporan `REPORTED` semalam ("reported by … hours ago") → lengkapi dengan tanda terima.
  - Harian: PO terlambat (tanggal janji lewat).

- **Sumber**
  `procurement/tracker/*`, `penerimaan/page.tsx`; migrasi `0012`, `0016` (`confirm_receipt`), `0017`, `0086`, `0138`, `0139`, `0169`, `0180`, `0205_procure_confirm_receipt_correction`; D97–D103, D131, D268, D310, D363; F149, F176, F179, F214.

---

### Receiving report dari Google Chat (kotak masuk penerimaan)

- **Tujuan**
  Foto yang dikirim lapangan ke space Google Chat **RECEIVING REPORT** otomatis masuk ke sistem, dibaca AI (John Lau), lalu dicocokkan procurement ke transaksi yang sudah dibayar atau ke PO, supaya barang masuk stok/aset dan terdokumentasi.

- **Pemilik / peran & kewenangan**
  - Melihat: `procurement.read`. Mencocokkan, mengabaikan, dan menyimpan ke Drive: `procurement.update` (`match_receiving_to_trx`, `match_receiving_to_po`, `dismiss_receiving`, `receiving_archive_*`).
  - Mengajukan pembayaran setelah cocok ke PO: `procurement.create` + `procurement.update`.
  - Pengirim foto: siapa saja di space Chat tersebut (tidak perlu akun di sistem). Pengirim yang tidak dikenali sistem tidak ditolak; namanya disimpan seperti dari Chat dan file dicatat atas shared@ (D358).
  - Jembatan Chat → database dijalankan `pg_cron` job `ops-receiving-bridge` setiap 5 menit (dipasang 2026-10-01).

- **Prasyarat**
  Foto sudah dikirim ke space RECEIVING REPORT. Untuk jalur transaksi: uang sudah keluar dan tercatat di ledger (transaksi jenis OUT). Untuk jalur PO: PO `ISSUED`/terbuka.

- **Langkah-langkah**
  1. Lapangan → kirim foto barang (dan lembar tanda terima bila ada) ke space RECEIVING REPORT dengan keterangan.
  2. Sistem (≤ 5 menit) → membuat `rr-YY-MM-DD_NN` berstatus `PENDING` di `/procurement/penerimaan` → kartu **From Google Chat · RECEIVING REPORT** (tab Waiting) lengkap dengan foto dan "AI reading" (jenis dokumen, vendor, nomor PO, nomor surat jalan, baris, keyakinan). Bacaan AI hanya usulan, tidak pernah mem-posting.
  3. Procurement → tekan **Match** (Cocokkan) → drawer pencocokan. Pilih jalan:
     a. **Transaksi ledger yang sudah dibayar** (calon dicari dari uang keluar di sekitar tanggal): tandai tiap file sebagai "photo of the goods", "receiving report", atau "Kuitansi / Nota" (cukup nota saja bila tidak ada foto). Isi baris **Masuk inventory**: *material* (cari item katalog per kata, jumlah + satuan, rak, harga per unit opsional, tidak pernah 0; **Barang baru** bila belum ada di katalog) atau *aset* (nama, kategori, jumlah unit 1–50, harga, merek, lokasi dari daftar, pemegang). Hasil: foto menjadi "Receiving Item" baris ledger, lembar menjadi "Receiving Report", nota menjadi "Receipt / Invoice / Nota"; material masuk rak (gerak `receipt` dengan ref `rr-…`), aset masuk register (satu baris per unit, membawa `trx_no`).
     b. **PO**: pilih PO (calon: PO ISSUED dengan sisa per baris), isi qty per baris PO dan kondisi, tandai file sebagai foto barang, tanda terima, receiving report, atau nota. Hasil: satu penerimaan `rcv-…` per baris; `CONFIRMED` bila ada tanda terima, `REPORTED` bila tidak; "billable now" bergerak. Sesudah cocok, sistem menawarkan **Ajukan pembayaran (PR)** (lihat proses Pembayaran PO).
  4. Tidak relevan (balasan chat, foto ganda): **Not an arrival** (Bukan kiriman) → isi alasan ("Why — a chat reply, a duplicate…") → **Set aside** (Abaikan). Tidak pernah dihapus.
  5. Setelah cocok, sistem otomatis menyimpan salinan foto yang dipakai ke Drive. Bila gagal, tab Matched menyediakan **File in Drive** (Simpan ke Drive).

- **Aturan & kontrol**
  - `match_receiving_to_trx`: `not_permitted`, `already_resolved`, `transaction_void`, `not_a_purchase` (uang masuk), `photo_required` (minimal satu file), `file_not_on_report`, `file_twice`, `lines_malformed`, `item_twice`, `item_not_stocked` (bukan kategori yang dihitung), `bad_qty`, `location_unknown`, `cost_not_positive`, aset: `name_required`, `bad_count`, `cost_negative`, `category_required`, `kind_unknown`.
  - `match_receiving_to_po`: `order_not_open`, `photo_required`, `lines_required`, `line_not_on_order`, `line_twice`, `condition_unknown`.
  - `dismiss_receiving`: `reason_required`, `already_resolved`.
  - Idempotensi: satu pesan Chat = satu `rr-…` (ID Chat jadi kunci); file dan bacaan AI yang datang belakangan digabung selama masih `PENDING`.
  - Kendala identitas: 21 dari 26 pesan awal tidak punya pengirim yang terpetakan (mis. "Cintya Arta" di Chat vs "Cintya" di users). Namanya disimpan; IT perlu memetakan akun Chat (`public.chat_users`).

- **Jejak data (apa yang terekam)**
  `ops_procure.receiving_inbox` (status, pesan, pengirim, `extracted`, `matched_to`, `trx_no`/`po_no`, `receipt_nos`, `move_nos`, `asset_nos`, `resolved_by`, `resolve_note`) dan `receiving_inbox_files`. Tautan dokumen: ledger (`goods_photo`, `receiving_report`, `nota`), penerimaan (`goods_photo`, `delivery_note`, `receiving_report`), PO (`nota`). Audit dan outbox `procurement.receiving.matched`, `procurement.receiving.archived`.
  Drive: PROCUREMENT → `ops-talaliving/RECEIVING REPORT/<YYYY-MM>/<YYYY-MM-DD>`, tanggal = hari foto dikirim ke Chat (bukan hari dicocokkan, D360). Hanya file yang dipakai record yang disalin; file "Not used" tetap di folder Chat. Setelah disalin, semua tautan record pindah ke salinan (tautan lama di-unlink, bukan dihapus; file asli Chat tidak disentuh dan dicatat sebagai asal). Nota mengikuti drive Accounting.

- **Serah-terima ke tim lain**
  - Accounting: ledger mendapat "Item photo" (Receiving Item), "Receiving report", dan nota pada baris transaksi yang dicocokkan.
  - Inventory: gerak stok `receipt` (ref `rr-…`) dan baris aset.
  - Procurement sendiri: penerimaan `rcv-…` terhadap PO dan permintaan pembayaran.
  - IT: pemetaan akun Chat; keberlangsungan job `pg_cron` dan worker.

- **Koreksi & pengecualian**
  - Salah cocok: kode tidak punya fungsi "batalkan pencocokan" (status `MATCHED` final); koreksi dilakukan di record yang ditulis (stok lewat Inventory, ledger lewat Edit).
  - Foto kembar: ditandai "duplicate suspect" oleh sistem; pakai **Set aside**.
  - Salinan Drive gagal: **File in Drive**; sepuluh baris yang dicocokkan sebelum `0204` perlu **File in Drive** manual (catatan board D360).

- **Checklist rutin**
  - Harian pagi: `/procurement/penerimaan` → tab Waiting harus kosong pada akhir hari; urut terlama dulu.
  - Mingguan: tab Matched → pastikan tidak ada tile tanpa folder hari (gunakan **File in Drive**).

- **Sumber**
  `procurement/penerimaan/ChatInbox.tsx`, `MatchDrawer.tsx`; migrasi `0100`, `0155`, `0203_procure_receiving_inbox`, `0204_procure_receiving_archive`, `0205_procure_receiving_nota_lines`; D358, D360, D363 (versi kedua); F208, F209, F211, F212.

---

### Pelacak pembelian (Purchase Tracker) dan perjalanan vendor

- **Tujuan**
  Menjawab "di mana posisi kita dengan pemasok ini": berapa nilai kontrak, berapa dibayar, apa yang sudah datang, dan berapa yang aman ditagih berikutnya, tanpa menggabungkan sumbu uang dan barang (A1).

- **Pemilik / peran & kewenangan**
  Membaca: `procurement.read`. Aksi di dalamnya mengikuti proses masing-masing (Add new PO: `procurement.create`; Record arrival: lihat Penerimaan).

- **Prasyarat**
  Ada PO di sistem.

- **Langkah-langkah**
  1. `/procurement/tracker`: di atas ada total kewajiban semua vendor (kontrak, dibayar, terutang, dan dari itu "billable now"); vendor yang sudah lunas dipisah di kartu tertutup (D102).
  2. Klik vendor → `/procurement/tracker/[vendor]`: tiga tabel penuh lebar: order, pembayaran, pengiriman dengan chip bukti yang bisa dibuka (foto barang, tanda terima).
  3. Dari halaman ini: **Add new PO**, **Record arrival**, buka PO.

- **Aturan & kontrol**
  Angka dihitung saat dibaca (`v_vendor_journey`, `v_po_journey`), tidak pernah disimpan (A3). Headline satu kalimat per vendor. "Exposure" = dibayar dikurangi diterima (positif = kita menanggung risiko vendor).

- **Jejak data (apa yang terekam)**
  Tidak menulis data sendiri; membaca PO, penerimaan, alokasi pembayaran.

- **Serah-terima ke tim lain**
  Keuangan memakai "billable now" untuk jadwal bayar; pimpinan memakai total kewajiban.

- **Koreksi & pengecualian**
  Angka tidak cocok: periksa penerimaan `REPORTED` yang belum dikonfirmasi (tidak dihitung) dan pembayaran yang belum diberi alokasi PO.

- **Checklist rutin**
  Mingguan (Procurement + Keuangan): tinjau kewajiban per vendor, order terlambat, order dengan exposure positif.

- **Sumber**
  `procurement/tracker/*`, `po/page.tsx`; migrasi `0014`, `0018`, `0033`; D97–D103, D128.

---

### Payment rounds (putaran pendanaan) — fitur diparkir

- **Tujuan**
  Mengumpulkan semua baris yang disetujui tetapi belum dibayar menjadi satu putaran, disetujui, didanai ke rekening pembayar (BCA 271) dengan bukti, lalu ditutup. **Didanai belum berarti membayar siapa pun** (A10).

- **Pemilik / peran & kewenangan**
  `sync_round`: `procurement.update`. Menyetujui (`approve_round`), mencatat pendanaan (`transfer_round`), menutup (`close_round`): `approve_funds`. Penulisan transaksi masuk dari layar ini: `post_ledger`.

- **Prasyarat**
  Ada baris `APPROVED` belum dibayar.

- **Langkah-langkah**
  1. Staf → `/procurement/rounds` → **Roll in what is owed** (Masukkan yang terutang). Hasil: putaran `fund-…` `OPEN`, berisi sisa yang terutang tiap baris (satu baris hanya di satu putaran).
  2. Keuangan (`approve_funds`) → **Approve the round**. Angka dibekukan (rekam keputusan); `APPROVED`. `nothing_owed` bila semua sudah dibayar.
  3. Pendanaan: dua jalan (D81): "We transferred it" (Keuangan memindahkan uang dan mengunggah bukti; kedua sisi tertulis di buku besar) atau uang dikirim pimpinan dari HP dan bukti masuk Chat lalu di Accounting → Verifikasi; di putaran: **Book as money in** (Bukukan sebagai uang masuk) lalu **Fund this round** (Danai putaran ini). Bukti transfer wajib (D80). Pendanaan boleh bertahap; tiap tahap punya bukti sendiri (D82). Status `TRANSFERRED`.
  4. **Close the round**. Baris yang masih terutang kembali ke putaran berikut lewat Roll in.

- **Aturan & kontrol**
  `authority_required` (`approve_funds`), `already_approved`, `nothing_owed`, `not_approved` (danai sebelum disetujui), `round_closed`, `bad_amount`, `no_such_transaction` (baris ledger harus hidup), `already_recorded`, `never_approved` (tutup putaran yang belum disetujui). Kekurangan saldo tidak memblokir persetujuan (informasi, bukan gerbang).

- **Jejak data (apa yang terekam)**
  `payment_rounds`, `payment_round_lines`, `round_transfers` (jumlah, `trx_no`, bukti). Bukti: `Payment Proof` → ACCOUNTING.

- **Serah-terima ke tim lain**
  Accounting: transaksi uang masuk ke BCA 271.

- **Koreksi & pengecualian**
  Putaran dibiarkan terbuka bila belum diputuskan. Salah baris: baris yang dibayar keluar dari putaran lewat penutupan.

- **Checklist rutin**
  Pemilik memutuskan fitur ini **diparkir** (D105: tetap hidup, tidak dikembangkan; Meeting board dan Tracker sudah menjawab apa yang dulu dijawab putaran). Gunakan hanya bila Keuangan masih bekerja dengan putaran; bila tidak, abaikan.

- **Sumber**
  `procurement/rounds/*`; migrasi `0010`, `0016` (`approve_round`, `transfer_round`), `0017` (`sync_round`, `close_round`), `0087`; D6, D80–D82, D105, D126; A10.

---

### Kesenjangan & catatan chapter ini

#### A. Hal yang belum tercatat atau belum dibangun

1. **Tidak ada fitur ronde penawaran / perbandingan penawaran antar-vendor.** Kode tidak memuat tabel atau layar untuk meminta dan membandingkan beberapa penawaran. "Bukti harga" hanyalah lampiran (tautan, penawaran PDF, nota, PO) pada baris PR. Perbandingan penawaran dilakukan di luar sistem; hasil pilihan terekam hanya sebagai vendor + harga di baris PR. Model `quotation` di `0133` adalah penawaran **ke klien** (Project/Marketing), bukan dari vendor.
2. **Kartu persetujuan PO belum sampai ke Google Chat (backlog B10).** `request_po_approval` memancarkan `procurement.po.approval_requested` dan `po_approval_card`/`answer_po_approval` sudah siap, tetapi worker pengirim dan penerima jawaban belum ada (butuh keputusan pemilik: bot John Lau v01 atau aplikasi Chat baru). Sementara itu pimpinan membuka PO di aplikasi dan menekan **Confirm it**.
3. **Kartu Chat untuk baris PR**: kejadian `procurement.approval.requested` sudah ditetapkan live di katalog pengiriman (`0155`) dan jawaban dijamin lewat `answer_request` oleh worker; tetapi worker berada di luar repo ini (John Lau di Cloud Run). Dari kode **tidak bisa dipastikan** bahwa kartu benar-benar terkirim dan terjawab di produksi. Layar `/demo/chat` hanya simulasi. Cek langsung sebelum bab ini dinyatakan terverifikasi.
4. **Tidak ada pembatalan atau penarikan dokumen.** Enum PR memuat `CANCELLED`/`CLOSED`/`APPROVED` dan enum PO memuat `CANCELLED`, tetapi tidak ada fungsi database atau tombol yang menuliskannya. PO yang tidak jadi dikirim tidak bisa dibatalkan (`close_po` menolak draf dengan `never_issued`, dan menyuruh "cancel it", yang tidak ada). PR yang sudah `SUBMITTED` hanya bisa dikosongkan dengan menghapus barisnya satu per satu.
5. **Tidak ada edit/pembatalan penerimaan yang sudah `CONFIRMED`**, dan tidak ada pembatalan pencocokan receiving report (`MATCHED` final). Koreksi dilakukan di record turunannya.
6. **Penutupan baris dan penyelesaian selisih tanpa layar.** `line_closures` (`0122`) dan `line_settlements` hanya diisi lewat impor/SQL; tidak ada fungsi yang ditulis oleh layar. Akibatnya baris yang dibayar kurang dari yang disetujui dan sudah dijelaskan selisihnya tetap "masih terutang" di produksi (lihat konflik C4).
7. **Un-approve dan hapus baris tidak dijaga terhadap PO.** `approve_line(false)` dan `remove_line` hanya memeriksa uang yang sudah masuk (dan wewenang); tidak memeriksa apakah baris sudah tertaut ke PO yang berjalan atau sudah ada penerimaan. Kontrol ada pada disiplin staf.
8. **PO tidak dibandingkan dengan nilai yang disetujui.** `create_po` mewajibkan harga > 0 dan satuan sama dengan baris PR, tetapi tidak membatasi harga/jumlah PO terhadap `approved_amount` baris PR, dan tidak memeriksa kesamaan vendor (hanya dropdown di layar yang menyaring).
9. **PO tanpa PR tidak punya jalur ke proyek/Job Order.** Penentuan proyek hanya lewat baris PR (`docs/plan/penomoran.md`, "PO menyebut proyek/JO di kepalanya": belum dibangun).
10. **Wajib Job Order di PR bahan produksi tidak diwajibkan**, dan belanja proyek tanpa JO tidak terhubung ke produksi (data demo punya 6 baris contohnya). Reservasi stok per Job Order tidak dibangun (pemilik: "tidak perlu").
11. **Pengiriman PO ke vendor tidak tercatat sebagai kejadian.** Sistem hanya menyediakan **Print / PDF** dan **Send on WhatsApp**; saat `issue_po` sistem menganggap revisi terbaru terkirim (`sent_revision = revision`). Bukti pengiriman manual tidak disimpan. PDF PO tidak otomatis difile ke Drive.
12. **Folder Drive untuk nota dan bukti transfer:** baris `ops_core.drive_paths` untuk `nota` dan `transfer_proof` ke `TRANSACTIONS/{YYYY-MM}/{YYYY-MM-DD}` sengaja belum ditambahkan oleh migrasi `0203_core_drive_transactions` (menunggu IT memindahkan pohon capture worker). Dari kode **tidak bisa dipastikan** apakah baris itu sudah ada; cek di IT → Google Drive (`/it/drive`). Sampai ada, nota dan bukti transfer dari layar ini masuk `ops-talaliving/NOTA` dan `ops-talaliving/TRANSFER PROOF` (jenis dalam huruf kapital).
13. **Pengunggahan dari layar procurement tidak mengirim `entity`.** `CLAUDE.md` mewajibkan fitur yang menyimpan file meneruskan `entity` ke `documents.upload(...)`. `ReceiveForm`, `penerimaan/page.tsx`, `PayPo`, `PayFromLine`, dan `TransferForm` memanggil `documents.upload({file, kind})` tanpa `entity`. Untuk jenis yang dipakai sekarang tidak berdampak (baris `drive_paths`-nya tanpa entity), tetapi baris `drive_paths` khusus entity di masa depan tidak akan terpakai.
14. **Cakupan peran produksi belum terdokumentasi dari kode.** Tidak ada preset peran di kode (`roles.ts` hanya katalog). Siapa memegang `procurement write`, `approve_goods`, `approve_funds`, `post_ledger` di produksi hanya terlihat di IT → Users; bab ini tidak bisa memastikan daftarnya.
15. **Kadensi checklist** (harian/mingguan/bulanan) pada bab ini adalah usulan berdasarkan layar, bukan aturan yang diputuskan pemilik. Frekuensi rapat persetujuan dan aturan kapan PO wajib dibuat (mis. ambang nilai) tidak ada di kode maupun keputusan; D19 menyatakan tidak ada ambang nilai.
16. **Aturan opname** (frekuensi, siapa menyetujui selisih, foto rak) belum diputuskan (Q57); relevan karena stok dari penerimaan bergantung pada opname sebagai baseline.

#### B. Solusi sementara (manual)

- Konfirmasi PO tanpa kartu Chat: staf memberi tahu pimpinan secara langsung/WhatsApp; pimpinan membuka `/procurement/po/[po]` dan menekan **Confirm it**.
- Pengiriman PO ke vendor: cetak PDF atau WhatsApp dari halaman PO; catat bukti kirim di luar sistem.
- Membatalkan PO atau PR: tidak ada tombol. Biarkan `DRAFT` tidak diterbitkan dan hapus barisnya (PR), atau minta IT/pemilik memutuskan fitur pembatalan.
- Perbandingan penawaran: lampirkan penawaran terpilih (bahkan semua penawaran sebagai `Others`) di baris PR supaya pimpinan dapat memeriksa.
- Pembayaran baris yang kurang dari yang disetujui tanpa tombol tutup: jelaskan selisih (`partial_payment` bila sisa akan datang), dan minta IT menutup baris lewat SQL hanya bila pemilik menyetujui.
- Stok tidak bertambah dari penerimaan karena kategori/konversi: perbaiki master data, lalu catat via Inventory → **Input stock** (tidak ada backfill otomatis).

#### C. Konflik dokumen vs kode (kode terbaru menang)

1. **SOP lama `docs/sop/procurement/sop.html` / `simulasi-log.md` (23 Sep 2026) menyatakan stok gudang tidak bertambah otomatis** dari penerimaan. Itu sudah tidak benar: trigger `ops_inv.stock_from_receipt` (`0169`, diperbaiki `0180`, dipasang di produksi 2026-09-29) menambah stok untuk penerimaan `CONFIRMED`. Bab ini memakai perilaku kode.
2. **SOP lama langkah 1** menyebut kode barang `I-00001` dan kategori ditolak `no_such_category`: cocok dengan kode. Tetapi SOP lama tidak memuat kotak masuk Chat (`/procurement/penerimaan` bagian "From Google Chat"), Request payment dari PO, dan pohon folder bulan; semuanya ditambahkan sesudah 23 Sep (D358, D360, D363).
3. **D100 (menerbitkan PO adalah bawaan di Add new PO) sudah digantikan D132**: Add new PO hanya membuat draf; tombol "Create the draft" adalah satu-satunya.
4. **Demo vs database (selisih perilaku):**
   - Demo menutup baris yang kurang bayar otomatis begitu selisih dijelaskan dengan alasan selain `partial_payment` (membuat `line_settlements`); fungsi database `explain_variance` hanya mencatat penjelasan dan tidak menutup baris (`src/demo/api/procurement.ts` vs `0016`).
   - D135 menyatakan konfirmasi PO draf gugur bila angkanya diubah; demo melakukannya (`approved_at` direset), tetapi `amend_po_line` di database tidak mereset konfirmasi. Konfirmasi yang diberikan terhadap angka lama tetap berlaku pada angka baru.
   - D134: memindahkan tanggal kirim setelah PO terbit wajib alasan; demo menolak tanpa alasan (`reason_required`), database menerima alasan sebagai opsional dan menyerahkan penegakannya ke layar (`0086`). Bahwa layar live menegakkannya tidak diverifikasi dari kode.
5. **Komentar kode lawas di `contracts.ts`** pada `PrApproval.approved_amount` menyebut "boleh dikurangi, tidak pernah dinaikkan (A8)". D76 menggantinya: persetujuan boleh di atas atau di bawah permintaan, dan fungsi `approve_line` tidak membatasi. Pakai D76.
6. **Penomoran keputusan ganda**: nomor D359 dan D363 muncul dua kali di `06-decisions.md`; D363 menyebut `confirm_receipt` ada di `0204`, padahal berkas yang menerapkannya adalah `0205_procure_confirm_receipt_correction`. Acuan nomor keputusan ini perlu dirapikan di log.
7. **Kode penolakan PR tanpa baris**: `create_pr` menolak dengan `lines_required`, tetapi `submit_pr` (dokumen yang barisnya habis dihapus) menolak dengan `no_lines`. SOP lama hanya menyebut `lines_required`.
8. **Label "Reference Link"** pada layar berarti jenis dokumen `quotation` di database. Berkas yang diunggah dengan label ini difile di folder `QUOTATION`, bukan folder berlabel "Reference Link".
9. **Konfirmasi PO oleh pembuat yang memegang `approve_goods`** tidak melibatkan orang kedua. Itu disengaja (D267), dan dicatat sebagai `self_confirmed`; auditor harus membaca kolom ini, bukan menyimpulkan dari `created_by = approved_by`.
10. **Pemisahan kewenangan yang mudah tertukar**: baris PR dibayar oleh `post_ledger` (Keuangan), tetapi PO ditutup oleh `approve_funds`, dan Payment round diputuskan oleh `approve_funds`; sementara persetujuan barang dan konfirmasi PO oleh `approve_goods`. Akun yang memegang satu tidak otomatis memegang yang lain.



## Bab 2 — Akuntansi / Keuangan & Penyimpanan Dokumen

> Cakupan: buku besar (ledger), verifikasi dokumen, pembayaran dari baris PR / order / payroll, rekening koran,
> likuidasi, kalender pembayaran & rencana kas 12 bulan, tagihan bulanan, data master rekening & jenis transaksi,
> dokumen akuntansi, dan aturan penyimpanan file di Google Drive (`ops-talaliving`) untuk SEMUA modul.
>
> Prinsip yang menjadi dasar semua proses di bab ini (docs/plan/00-context.md, A1–A18):
> uang yang tercatat adalah uang yang benar-benar bergerak; **tidak ada dokumen, tidak ada baris buku besar** (D85);
> koreksi = VOID atau edit beralasan, **tidak pernah DELETE** (A5); semua perubahan masuk log audit dengan nilai
> sebelum/sesudah (D84); angka turunan (saldo, status, cakupan) dihitung database, bukan disimpan (A3).
>
> Sumber kebenaran bab ini: kode dan migrasi terbaru (sampai `0207`, 2026-10-01). Bila dokumen `docs/plan/*` berbeda
> dengan kode, kode yang dipakai dan perbedaannya dicatat di bagian akhir.
>
> Format nomor (docs/plan/penomoran.md; `ops_core.next_doc_number`, `supabase/migrations/0004`): `prefix-YY-MM-DD_NN`,
> hari = hari kantor **WIB** (`Asia/Jakarta`, D334, `0190`). Khusus transaksi buku besar lebarnya **3 digit**:
> `trx-26-09-11_014`. Rekening koran: `rkk-26-09-11_01`. Baris PR: `pr-26-09-11_03-L02`. PO: `po-26-09-11_01`.
> Run gaji: `pyr-…`. Penerimaan: `rcv-…` / inbox penerimaan Chat `rr-…`.

---

### Peran, wewenang & istilah (dibaca dulu)

- **Pemilik / peran & kewenangan**
  - Akses = dua hal terpisah (src/lib/roles.ts, D24): **modul + level** (`read` < `write` < `admin`) dan **wewenang bernama**
    (authority) yang tidak pernah tersirat dari level modul.
  - Modul `accounting` menawarkan aksi: `read`, `create`, `update` (keduanya ikut level `write`), dan `plan_cash`
    (**hanya level `admin`**, D233). Modul `it` menawarkan `manage_drives` (hanya `admin`, D314).
  - Wewenang yang dipakai bab ini (src/services/identity/contracts.ts):
    - `post_ledger` — "Membukukan ke buku besar": memposting, mengedit, VOID, menandai selesai, mengalokasikan,
      membukukan baris rekening koran, mengubah rekening data master.
    - `resolve_inbox` — "Menautkan dokumen tanpa induk": memutuskan nasib dokumen di Verifikasi.
    - `approve_funds` — "Menyetujui dana": satu-satunya yang boleh melihat saldo rekening pimpinan (BCA 064, BCA USD 081),
      mengubah data master rekening pimpinan, dan memindahkan baris dari/ke rekening pimpinan.
    - `approve_goods` — CEO; di bab ini hanya relevan lewat persetujuan baris PR (bab Pengadaan).
  - Snapshot akses produksi per 2026-09-21 (supabase/import/RUNLOG.md; **bukan daftar tetap** — daftar sebenarnya di
    IT → Peran, `/it/peran`, dan IT bisa mengubahnya):
    Anggun Tala & putri (Accounting) = `accounting:write` + `procurement:read` + `post_ledger` + `resolve_inbox`;
    Geryle Lao (Payment Approver) = `accounting:read` + `approve_funds`; Evin Oshima (CEO) & Alika Oshima (CO-CEO) =
    `accounting:read` tanpa authority; Tala IT = `accounting:admin`. Fixture demo (src/demo/fixtures/reference.ts)
    memberi putri `approve_funds` juga — jangan dianggap sama dengan produksi.
  - **Aturan emas**: tombol yang tampil dan penolakan database membaca grant yang sama. Bila tombol tidak muncul, orangnya
    tidak punya modul/level/wewenang itu — bukan bug.
- **Status baris buku besar** (`ops_acct.trx_status_t`): `POSTED` (baru dibukukan) → `COMPLETED` (dokumen nota/bukti bayar
  ada dan ditandai selesai) ; `VOID` (dibatalkan, baris tetap, jumlah dikecualikan dari saldo); `UNTRACKED` ada di enum
  tetapi **tidak ada seam yang menetapkannya** (hanya mungkin dari data impor lama — tidak bisa dikonfirmasi dari kode).
- **Rekening** (`ops_acct.accounts`, 0013): `PETTY CASH`, `BNI 325`, `BCA 271`, `JAGO` = custody `accounting`, `is_paying`
  (membayar vendor); `BCA 064` dan `BCA USD 081` = custody `leadership`, bukan `is_paying`, saldo **terkunci** (locked,
  bukan disembunyikan) kecuali untuk pemegang `approve_funds` (D87).
- **Toleransi uang**: `ops_core.money_tolerance()` = setting `payment_tolerance_idr`, bawaan **Rp 1.000**.

---

### Entri buku besar manual ("Entri baru")

#### Tujuan
Membukukan uang yang sudah bergerak (masuk/keluar) yang tidak punya jalur lain (bukan dari baris PR, PO, payroll, atau
rekening koran), lengkap dengan bukti dan rincian barang.

#### Pemilik / peran & kewenangan
- Layar `/accounting/ledger` terbuka untuk `accounting.read`; tombol **Entri baru** hanya untuk pemegang `post_ledger`.
- Seam `ops_acct.post_transaction` memeriksa `post_ledger` (RLS `trx_post` juga). Tidak ada persetujuan kedua: pembukuan adalah
  pernyataan Akuntansi bahwa uang bergerak; kontrol ada pada bukti wajib, bukan pada approver.

#### Prasyarat
1. Bukti uang minimal satu: nota (`Receipt / Invoice / Nota`), bukti transfer (`Payment Proof`), foto barang (`Receiving Item`),
   atau rekening koran. Surat jalan/PO/Invoice hanya pendukung, tidak cukup sendiri (D85).
2. **Cek dulu Verifikasi.** Bila foto/nota sudah dikirim ke chat accounting, dokumennya sudah ditangkap bot John Lau — bukukan dari
   `/accounting/verifikasi`, jangan diunggah ulang (D359; form menampilkan kalimat ini).
3. Untuk jenis transaksi bertanda `is_purchase`: vendor dan rincian barang (qty + harga satuan) sudah diketahui.

#### Langkah-langkah
1. Akuntansi → `/accounting/ledger` → **Entri baru** → panel "Entri buku besar baru — Uang yang sudah bergerak — bukan rencana".
2. Isi **Tanggal uang bergerak**, **Rekening**, **Masuk atau keluar** (`OUT — uang keluar` / `IN — uang masuk`), **Jenis**
   (jenis transaksi dari master data), **Deskripsi**, **Vendor** (wajib untuk pembelian; centang **Bukan pembelian dari vendor**
   untuk jenis non-pembelian), **Untuk apa uangnya**.
3. Isi tabel **Barang / Jml / Satuan / Harga satuan** (**Tambah barang** untuk baris lain). Jumlah transaksi = Σ(qty × harga satuan);
   layar menjumlahkan sendiri.
4. Bagian **Dokumen**: pilih **Jenis dokumen**, tekan **Lampirkan berkas**. Berkas diunggah ke Drive saat itu juga (lihat bab
   "Aturan penyimpanan file"); ada peringatan bila isi identik pernah terlihat atau sudah ada di Drive dari Google Chat.
5. Tekan **Posting ke buku besar** → status **`POSTED`**; nomor **`trx-YY-MM-DD_NNN`** dibuat; toast `<trx_no> diposting`.
   Dicatat: lihat Jejak data.

#### Aturan & kontrol
- Penolakan (kode → arti), semua dari `post_transaction` (0021/0034):
  `authority_required` (butuh `post_ledger`) · `amount_positive` · `description_required` · `no_such_account` / `no_such_type` /
  `no_such_vendor` / `no_such_project` · `unknown_kind` · `evidence_required` ("A ledger row needs at least one nota, transfer proof,
  bank statement or photo of what arrived…") · untuk jenis pembelian: `detail_required` (tanpa rincian), `line_detail_required`
  (tanpa qty atau harga satuan), `vendor_required` · `lines_do_not_add_up` (rincian ≠ jumlah; sistem tidak menebak mana yang salah, D86) ·
  `already_posted` (409, `source_ref` sama; "Already booked as trx-… — nothing changed").
- `source_ref` entri manual = `manual:<tanggal>:<rekening>:<jumlah>:<24 huruf pertama deskripsi>` (NewEntry.tsx). Dua entri sah dengan
  tanggal, rekening, jumlah, dan awal deskripsi yang sama akan ditolak `already_posted` — bedakan deskripsinya.
- Jumlah selalu positif; arah di kolom `IN/OUT`. Tidak ada angka "dialokasikan" di buku besar (D88): yang ditandai hanya pembelian
  tanpa permintaan di baliknya ("tanpa permintaan di baliknya") dan hanya untuk jenis `is_purchase` (D83).
- Seam **tidak** memeriksa `is_paying`; layar pembayaran (baris PR/PO/payroll) hanya menawarkan rekening `is_paying` aktif, tetapi
  daftar rekening di Entri baru memuat semua rekening aktif. Jangan membukukan pembayaran vendor dari BCA 064/USD 081 secara manual.

#### Jejak data (apa yang terekam)
- `ops_acct.transactions` (+ `transaction_lines`), `ops_core.attachments` + `attachment_links` (entity `transaction`, `entity_no` = trx_no,
  kind sesuai pilihan), `ops_core.audit_log` (aksi `post`), event `accounting.transaction.posted`.
- Drive: `ACCOUNTING / ops-talaliving / <folder jenis dokumen>` — nota → `NOTA`, bukti transfer → `TRANSFER PROOF` (lihat bab Drive;
  pohon bulanan `TRANSACTIONS/…` belum aktif).
- Tampilan: `/accounting/ledger` (daftar 25/halaman, filter rekening/jenis/"Sertakan yang dibatalkan", cari "Deskripsi atau nomor…").

#### Serah-terima ke tim lain
- Pengadaan: baris pembelian tanpa permintaan tampil sebagai "tanpa permintaan di baliknya" → dikejar lewat Alokasi (bab berikut) atau
  jalan "Baris permintaan susulan" di Verifikasi.
- Inventory: jenis transaksi `creates_catalog_item` (SUPPLIERS, ONLINE, CHINA, PRODUCTION) mengisi katalog dengan harga terakhir dibayar (D86).
- Pimpinan/Kalender: baris yang cocok dengan kategori kalender dihitung sebagai realisasi (lihat Kalender).

#### Koreksi & pengecualian
Lihat "Koreksi baris buku besar" (Edit / VOID / Tandai selesai). Unggahan yang batal diposting meninggalkan berkas di Drive dan
satu baris `attachments` tanpa tautan → terlihat di **Dokumen akuntansi** sebagai "belum dilampirkan".

#### Checklist rutin
- Harian: setiap entri hari ini punya dokumen (kolom **Bukti**), dan tidak ada baris dengan lencana "tanpa permintaan di baliknya"
  yang tidak punya alasan.
- Mingguan: buka filter per rekening; saldo di **CashPosition** cocok dengan saldo aplikasi bank/kas (selisih → cari baris yang belum
  dibukukan atau salah rekening).

#### Sumber
`src/app/(app)/accounting/ledger/{page,NewEntry,TrxDrawer,CashPosition}.tsx` · `src/lib/api/accounting.ts` (`postTransaction`) ·
migrasi `0013`, `0021`, `0034`, `0020` (view saldo) · D83–D89, F211.

---

### Pembayaran dari baris permintaan (PR line) — "Catat pembayaran"

#### Tujuan
Satu tindakan menulis: transaksi keluar, alokasi ke baris PR, dan tautan dokumen bukti (D53). Ini jalan utama membayar pembelian yang
sudah disetujui.

#### Pemilik / peran & kewenangan
- Layar: Pengadaan → `/procurement/pr` → laci baris (LineDrawer). Panel **Catat pembayaran** tampil hanya bila pengguna punya
  `accounting.create` **dan** `post_ledger` (PayFromLine.tsx) dan baris sudah disetujui (`line.approval?.approved`), belum lunas,
  belum dihapus.
- Persetujuan baris (barang: `approve_goods`/CEO; dana: `approve_funds`) terjadi sebelum ini — lihat bab Pengadaan. Akuntansi tidak
  menyetujui; Akuntansi membayar apa yang sudah disetujui.

#### Prasyarat
1. Baris PR disetujui dan belum `removed`.
2. Bukti pembayaran (bukti transfer atau nota) sudah ada di tangan — **tanpa bukti, tanpa pembayaran** (D85).
3. Rekening sumber = rekening `is_paying` aktif (daftar di layar hanya memuat itu).

#### Langkah-langkah
1. Akuntansi → `/procurement/pr` → buka baris → panel **Catat pembayaran**.
2. Isi **Tanggal bayar**, **Jumlah dibayar** (bawaan = sisa/`remaining`, atau jumlah disetujui bila belum ada pembayaran), **Dibayar dari**,
   **Jenis buku besar** (bawaan `SUPPLIERS`).
3. **Lampirkan bukti pembayaran** (unggah; bila baris sudah punya bukti bayar, layar menawarkannya agar tidak diunggah dua kali —
   "juga akan diarsipkan di baris buku besar").
4. Tekan **Catat Rp … ke buku besar** → seam `ops_acct.post_from_line` → status transaksi **`POSTED`**, nomor `trx-…`; toast
   `Dicatat sebagai <trx_no>`.

#### Aturan & kontrol
- Satu panggilan menulis tiga hal sekaligus: baris `transactions` (OUT), lini rincian, alokasi ke baris PR (metode `transfer`) +
  tautan dokumen (kind `Payment Proof` bawaan). Deskripsi baris buku besar = `<deskripsi baris> — <nomor baris>`.
- Vendor diambil dari baris PR; bila vendor diputuskan belakangan, dari vendor order tempat baris dibeli (0145, B11). Proyek dari
  dokumen PR. Baris tanpa qty (lump sum, mis. ongkos kirim) dibukukan sebagai **1 lot × jumlah dibayar** (0141, D298).
- Penolakan: `authority_required` · `pr_line_not_found` ("Line … does not exist in procurement") · `line_removed` (409) ·
  `evidence_required` ("A payment needs its proof…") · semua penolakan `post_transaction` (lihat Entri manual) ·
  `already_posted` (409) — `source_ref` = `pr-line:<baris>:<tanggal>:<jumlah>`, jadi dua orang membayar baris yang sama dengan jumlah
  dan tanggal yang sama ditolak (melindungi dari dua laptop).
- `allocation_failed` (409): transaksi **sudah** terbit tetapi alokasi gagal; pesan menyebut nomor transaksi — alokasikan manual dari
  laci buku besar, **jangan posting ulang** (supplier terbayar dua kali).
- Seam **tidak membatasi** jumlah terhadap jumlah disetujui; selisih approved-vs-paid dibaca sebagai varians (D54–D57), tidak diblokir.
  Alokasi baru tidak boleh melebihi uang yang bergerak (A9, `over_allocated`).
- Bila baris sudah ada di sebuah PO, alokasi otomatis ikut dicap nomor PO (0139, B8).

#### Jejak data (apa yang terekam)
`ops_acct.transactions`/`transaction_lines`/`payment_allocations` (pr_line_no, po_no, method), `attachment_links` (entity `transaction`),
audit `post_from_line`, event `accounting.transaction.posted` + `accounting.allocation.recorded`. Drive: `ACCOUNTING / ops-talaliving /
TRANSFER PROOF` (kind `Payment Proof`) atau `NOTA`.

#### Serah-terima ke tim lain
Status baris PR (PAID/lunas, "needs an explanation") dihitung view procurement dari alokasi; Tracker pemasok membaca pembayaran + bukti
(`v_vendor_payment`, 0088).

#### Koreksi & pengecualian
Jumlah/rekening/vendor salah → **Edit** (bukan VOID). Row ganda → **VOID** dengan alasan. Pembayaran ke baris yang salah →
VOID transaksi (alokasi tetap tercatat tetapi tidak dihitung, A10) lalu bayar ulang ke baris yang benar.

#### Checklist rutin
Setiap hari: baris PR yang dibayar hari ini tampil lunas di papan; Tracker tidak menampilkan pembayaran tanpa bukti.

#### Sumber
`src/app/(app)/procurement/pr/PayFromLine.tsx` · `0034`, `0141`, `0145`, `0139` · D53–D57, D297, D298 · `docs/plan/03-api.md` (`/transactions/from-line`).

---

### Pembayaran order (PO) — "Bayar order ini"

#### Tujuan
Membayar order yang sudah diterbitkan (uang muka, termin, pelunasan) dari halaman order itu sendiri.

#### Pemilik / peran & kewenangan
`accounting.create` + `post_ledger` (PayPo.tsx); panel tampil hanya bila status PO `ISSUED` dan `outstanding > 0`. PO terbit setelah
konfirmasi pimpinan (D132; bab Pengadaan).

#### Prasyarat
PO `ISSUED` (bukan `DRAFT`, `CLOSED`, `CANCELLED`); bukti transfer di tangan.

#### Langkah-langkah
1. Pengadaan → `/procurement/po/[po]` → kartu **Bayar order ini** ("Satu baris buku besar, dihitung terhadap order ini.").
2. Isi **Tanggal bayar**, **Jumlah dibayar**, **Dibayar dari**, **Jenis buku besar**; **Lampirkan bukti pembayaran**.
3. **Catat Rp … ke buku besar** → `ops_acct.post_to_po` → `POSTED`, nomor `trx-…`, deskripsi `Pembayaran <po_no>`, rincian 1 unit.

#### Aturan & kontrol
- Penolakan: `authority_required` · `po_not_found` · `not_issued` ("nothing is owed on an order the vendor has not received") ·
  `order_closed` · `amount_positive` · `over_contract` (jumlah > sisa + toleransi Rp 1.000) · `evidence_required`.
- Pembagian alokasi **disimpan, bukan diturunkan**: uang dibagi proporsional nilai baris PO yang tertaut ke baris PR (tiap bagian menyebut
  baris PR **dan** PO); sisa untuk baris tak bertaut dicatat pada PO saja (0139).
- `source_ref` = `po:<po>:<tanggal>:<jumlah>`.

#### Jejak data (apa yang terekam)
`transactions`, `payment_allocations` (satu per baris tertaut + sisa), `attachment_links`, audit `post_to_po`, event `accounting.allocation.recorded`.

#### Serah-terima ke tim lain
Status pembayaran PO (`v_po_status`: contract_value/outstanding) dibaca Pengadaan dan Tracker.

#### Koreksi & pengecualian
Edit/VOID di buku besar; PO sudah `CLOSED` tidak bisa dibayar lagi — buka masalahnya ke Pengadaan.

#### Checklist rutin
Mingguan: PO `ISSUED` dengan termin jatuh tempo punya pembayaran tercatat (bandingkan dengan Tagihan bulan ini bila termin ada di kalender).

#### Sumber
`src/app/(app)/procurement/po/[po]/PayPo.tsx` · `0139` · D128, D132 · F149.

---

### Pembayaran gaji (run payroll) — "Bayar run ini"

#### Tujuan
Mencatat transfer gaji satu run ke buku besar (satu baris per run) dan menandai run `PAID`.

#### Pemilik / peran & kewenangan
- Run disiapkan dan disetujui oleh HRD/pimpinan (bab HRD). Pembayaran = `accounting.create` + `post_ledger` (PayRun.tsx); **tidak** butuh
  akses payroll di sisi seam (0149): "Finance pays; it does not prepare the run".
- Akuntansi tidak membaca slip gaji (D213): ledger tidak memuat gaji per orang (D218).

#### Prasyarat
Run berstatus `APPROVED`; bukti transfer gaji.

#### Langkah-langkah
1. HRD → `/hrd/payroll/[run]` → kartu **Bayar run ini** (hanya tampil untuk pemegang izin di atas dan status `APPROVED`).
2. Isi **Tanggal bayar**, **Nominal dibayar** (bawaan = *Diterima* menurut run), **Dibayar dari**; **Lampirkan bukti transfer**.
3. **Catat Rp … ke buku besar** → `ops_acct.post_payroll_run` → transaksi `POSTED`; run → `PAID` dengan `paid_trx_no`.

#### Aturan & kontrol
- Jenis otomatis `RECCURING - PAYROLL WEEKLY` (periode ≤ 7 hari) atau `RECCURING - PAYROLL MONTHLY`; deskripsi `Gaji <run> (dd Mon s/d dd Mon yyyy)`;
  `source_ref` = `payroll:<run>`.
- Penolakan: `authority_required` · `run_not_found` · `not_approved` ("Belum ada yang menandatangani run ini") · `already_paid` ·
  `amount_positive` · `evidence_required`.
- Jumlah berbeda dari *Diterima* **tetap dicatat** dan layar memberi peringatan; mana yang dibayar run (gross+penyesuaian atau minus iuran
  karyawan) masih pertanyaan terbuka (Q56 — tidak dipastikan di kode).

#### Jejak data (apa yang terekam)
`transactions` (OUT), `attachment_links`, `ops_hr.payroll_runs.status/paid_trx_no`, audit (jejak `before`/`after` status), event `payroll.paid`.

#### Serah-terima ke tim lain
Kalender kas: jenis payroll mingguan/bulanan dikenali sebagai realisasi garis gaji.

#### Koreksi & pengecualian
Edit nominal/rekening di buku besar (jumlah butuh keterangan). Run `PAID` tidak dibuka kembali dari layar ini.

#### Checklist rutin
Setiap Jumat (gaji mingguan, D357: Jumat–Kamis): run minggu lalu `PAID` dan barisnya ada di buku besar.

#### Sumber
`src/app/(app)/hrd/payroll/[run]/PayRun.tsx` · `0149` · F154, D213, D218, D357.

---

### Verifikasi dokumen (kotak masuk bukti) — `/accounting/verifikasi`

#### Tujuan
Menyelesaikan dokumen yang datang **tanpa induk** (mis. nota difoto di chat sebelum ada permintaan), lewat lima jalan yang tidak satu pun
membuang berkasnya (A16, D94).

#### Pemilik / peran & kewenangan
- Baca antrean: `accounting.read`. **Memutuskan**: wewenang `resolve_inbox`; **membukukan** (jalan "Buat transaksi") butuh **`post_ledger` DAN
  `resolve_inbox`** (`book_evidence`, 0124 — keduanya diperiksa; penolakan menyebut yang kurang).
- Pengirim dokumen (siapa pun di chat accounting) tidak butuh akses sistem; bot John Lau yang memasukkan (`file_evidence`, service_role, idempoten
  pada `ref_id`).

#### Prasyarat
Dokumen sudah masuk antrean (otomatis dari Google Chat tiap beberapa menit; layar memeriksa ulang tiap 60 detik dan berhenti selama satu
dokumen dibuka).

#### Langkah-langkah
1. Akuntansi → `/accounting/verifikasi`. Kiri: antrean ("N menunggu — Terlama di atas"), dikelompokkan **per berkas** (satu foto = satu kartu,
   lencana "N baris"; F209, 0161). Atas: hitungan "masuk lewat jalan ini sejak <senin>", "masih menunggu", "dari chat / dari aplikasi".
2. Pilih dokumen → panel kanan: pratinjau gambar + bacaan AI (vendor, tanggal, jumlah, jenis — **usulan, bukan posting**; keyakinan %),
   serta "Sudah menopang N baris buku besar …" (cakupan dokumen, D206) dan peringatan "Ini mirip <trx>" bila ada transaksi serupa.
3. Pilih satu dari lima jalan:

| Jalan (label layar) | Hasil di inbox | Efek |
|---|---|---|
| **Buat transaksi** | `CONFIRMED` | Satu baris buku besar dari satu dokumen: header bersama (tanggal, rekening, arah, jenis, vendor, proyek) + **Isi nota** (beberapa baris barang). Seam `book_evidence` / `book_evidence_group` (banyak baris inbox satu foto → satu transaksi). |
| **Baris permintaan susulan** | `CONFIRMED` (+`produced_pr_line_no`) | Pembelian yang terjadi sebelum ada yang meminta: tulis baris PR setelah fakta ("Dibeli sebelum ada yang meminta — ditulis setelahnya"), posting transaksi, alokasi metode `cash`; di papan tampil "dibayar, tidak disetujui". |
| **Tautkan ke baris** | `ATTACHED` | Uang sudah dibukukan; dokumen ini bukti tambahan. Centang **beberapa** baris buku besar; satu aksi memasang bukti ke semuanya (`link_evidence`, 0162). Tidak ada uang baru. |
| **Catatan** | `NOTED` | Bukan transaksi perusahaan; disimpan, alasan wajib. |
| **Tolak** | `REJECTED` | "Bukan milik kita"; disimpan, alasan wajib ("Mengapa ini bukan milik kita?"). |

4. Untuk "Buat transaksi": isi **Tanggal uang bergerak**, **Rekening**, **Masuk atau keluar**, **Jenis**, **Vendor**, **Proyek**,
   **Apa yang dibeli**, **Isi nota** (tombol **+ baris**; kolom Jml/Satuan/Harga satuan), lalu tekan simpan. Layar menampilkan
   "N baris berjumlah … — cocok / selisih …" dan menonaktifkan tombol bila beda.
5. Nomor dihasilkan: `trx-YY-MM-DD_NNN` (jalan transaksi/susulan); jalan susulan juga membuat nomor baris PR `pr-…-L..`.

#### Aturan & kontrol
- Status inbox (`evidence_inbox.status`): `PENDING` → `CONFIRMED` | `ATTACHED` | `REJECTED` | `CANCELLED` | `NOTED`. Hanya `PENDING` bisa
  diputuskan (`already_resolved`, 409). `CANCELLED` (ditarik pengirim) ada di enum/seam tetapi **tidak ada tombolnya** di layar.
- `book_evidence` menolak `lines_do_not_add_up` bila Σ baris ≠ jumlah dokumen — pesannya menyebut kedua angka dan selisihnya
  (contoh: "The document says Rp … and its 3 line(s) add up to Rp …"). Ini satu-satunya tempat sistem **menolak** alih-alih memperingatkan,
  karena orangnya sedang memegang foto (0124, §14 john-lau).
- `book_evidence_group`/`link_evidence` menolak `not_one_document` bila baris-baris itu berkas berbeda (diperiksa, bukan dipercaya).
- `link_evidence`: Σ baris terpilih ≠ nilai dokumen hanya **diperingatkan** ("selisih …", A6); `trx_required` bila tidak ada baris dipilih;
  `no_such_transaction`.
- `reason_required` untuk `NOTED` dan `REJECTED`. `not_a_road` bila diminta `PENDING`.
- Dokumen yang **sama persis** (SHA-256) tidak diunggah ulang: lihat bab Drive (`same_bytes`).
- `source_ref` posting dari inbox = `inbox:<ref_id>`; satu inbox tidak bisa menghasilkan dua baris.

#### Jejak data (apa yang terekam)
`ops_acct.evidence_inbox` (status, `produced_trx_no`, `produced_pr_line_no`, `resolved_by/at`, `resolve_note`, `extracted` bacaan AI),
`attachments` + `attachment_links` (kind dari bacaan AI `doc_kind`, bawaan `nota`; `link_evidence` memakai kind dokumen),
`transactions`, audit (`resolve`, `book`, `link`), event `accounting.inbox.resolved`. Bagian "Sudah diputuskan" menampilkan 20 keputusan terakhir
dengan total.
Drive: berkas chat disimpan bot di `ACCOUNTING / TRANSACTIONS / <YYYY-MM> / <YYYY-MM-DD>` (folder buatan bot, di luar `ops-talaliving`;
lihat Kesenjangan).

#### Serah-terima ke tim lain
Pengadaan: jalan "Baris permintaan susulan" menulis baris PR; Inventory/Penerimaan: foto RECEIVING REPORT dari chat berbeda (masuk
`/procurement/penerimaan`, bab Pengadaan) — hanya yang bersifat uang/nota yang masuk sini.

#### Koreksi & pengecualian
Salah pilih jalan: `CONFIRMED` yang keliru → VOID transaksinya (dokumen tetap di inbox sebagai sudah diputuskan). Dokumen yang tertaut ke
baris keliru → lepas tautan lewat panel **Dokumen** baris itu (unlink, tidak dihapus).

#### Checklist rutin
Harian: antrean = 0 (bila tumbuh, orang melewati jalan utama — D94). Mingguan: angka "masuk lewat jalan ini" tidak naik terus.

#### Sumber
`src/app/(app)/accounting/verifikasi/page.tsx` · `0019`, `0021` (`resolve_inbox`), `0038`, `0039`, `0096`, `0124`, `0161`, `0162` · D81, D94, D206, D207, F209,
F211.

---

### Uang masuk dari pimpinan (transfer operasional masuk)

#### Tujuan
Membukukan transfer dana operasional dari pimpinan ke rekening Akuntansi — satu-satunya uang masuk (tidak ada pembayaran klien, D106).

#### Pemilik / peran & kewenangan
`post_ledger` (+ `resolve_inbox` bila lewat Verifikasi). Dua jalan (D81): (a) pimpinan transfer dari ponsel dan kirim bukti ke chat → menunggu di
Verifikasi (`money_direction = IN`); (b) Akuntansi yang mentransfer dan mengunggah bukti.

#### Prasyarat
Bukti transfer (`Payment Proof`). Bila dana dari BCA 064: baris cermin di rekening pimpinan hanya muncul lewat rekening koran 064 (lihat Rekening koran).

#### Langkah-langkah
1. Jalan bukti-di-chat: Verifikasi → pilih dokumen → **Buat transaksi** → **Masuk atau keluar** = `IN — uang masuk`, **Rekening** tujuan,
   jenis (biasanya `CASHFLOW`) → posting → `trx-…` `POSTED`.
2. Jalan layar Ronde pembayaran (parkir, D105 — tetap berfungsi): `/procurement/rounds` → form Transfer → memilih uang masuk yang sudah
   ada atau **confirmIncoming** → seam `confirm_incoming` (jenis `CASHFLOW`, `source_ref` `inbox-in:<ref_id>`, bukti `transfer_proof`).

#### Aturan & kontrol
- `confirm_incoming`: `authority_required` · `not_found` · `already_resolved` · `amount_positive` · `no_such_account` · `already_posted`.
  Jumlah dikonfirmasi orang, tidak pernah diambil dari ekstraksi AI (A13).
- Ronde: status ronde "funded" butuh bukti transfer (D80).

#### Jejak data (apa yang terekam)
`transactions` (IN, `CASHFLOW`), `attachment_links` (`transfer_proof`), inbox `CONFIRMED`. Drive: `ACCOUNTING / ops-talaliving / TRANSFER PROOF`.

#### Serah-terima ke tim lain
Liquidation memakai transfer masuk ini sebagai awal "jendela"; Kalender memakai garis IN "transfer dari pimpinan" sebagai rencana masuk.

#### Koreksi & pengecualian
Edit rekening/tanggal lewat **Edit** (rekening pimpinan butuh `approve_funds`) atau VOID.

#### Checklist rutin
Mingguan: setiap transfer masuk di mutasi bank sudah punya baris IN dan bukti.

#### Sumber
`0098`, `0124`, `src/app/(app)/procurement/rounds/TransferForm.tsx` · D80, D81, D105, D106.

---

### Alokasi pembayaran ke baris permintaan / order

#### Tujuan
Menunjuk uang yang sudah keluar ke pembelian yang dibayarnya, supaya papan permintaan membaca "dibayar".

#### Pemilik / peran & kewenangan
`post_ledger`. Layar: laci baris buku besar → **Apa yang dibayarnya** → **Arahkan uang ini ke baris itu** (tampil bila status ≠ VOID, `unallocated > 0`,
dan jenis `expects_allocation`).

#### Prasyarat
Transaksi ada dan bukan VOID; nomor baris PR diketahui (`pr-26-09-04_01-L01`).

#### Langkah-langkah
1. Buku besar → buka baris → bagian alokasi → isi **Baris permintaan** + **Jumlah** → **Arahkan uang ini ke baris itu**.
2. Seam `allocate_payment` menulis satu baris `payment_allocations`; bila baris ada di PO, ikut dicap PO.

#### Aturan & kontrol
- `authority_required` · `target_required` (tepat satu: baris ATAU order) · `amount_positive` · `not_found` · `transaction_void` ·
  `pr_line_not_found` / `po_not_found` · `line_removed` · **`over_allocated`** (Σ alokasi tidak boleh melebihi uang yang bergerak, A9).
- Koreksi alokasi = baris baru dengan `superseded_by` (A2). Alokasi dari transaksi VOID otomatis tidak dihitung (A10).

#### Jejak data (apa yang terekam)
`ops_acct.payment_allocations`, audit, event `accounting.allocation.recorded`.

#### Serah-terima ke tim lain
Papan permintaan & status PO (Pengadaan) membaca alokasi.

#### Koreksi & pengecualian
`supersede_allocation(id, jumlah baru)` mengoreksi jumlah — **belum ada tombol di layar**. Menarik alokasi sepenuhnya (`jumlah` kosong) **selalu gagal**
karena melanggar constraint `supersede_not_self` (temuan F211; belum diperbaiki). Jalan keluar manual: VOID transaksi dan bayar ulang.

#### Checklist rutin
Mingguan: baris OUT pembelian dengan lencana "tanpa permintaan di baliknya" tinggal sedikit.

#### Sumber
`0021`, `0139`; TrxDrawer.tsx · A2, A9, A10, D88.

---

### Koreksi baris buku besar: Edit, VOID, Tandai selesai

#### Tujuan
Memperbaiki baris yang salah tanpa menghapus apa pun, dan menandai baris yang urusan dokumennya tuntas.

#### Pemilik / peran & kewenangan
Semua tombol di laci baris hanya untuk `post_ledger` dan baris bukan VOID. Rekening pimpinan di sisi mana pun → butuh juga `approve_funds` (D87).

#### Prasyarat
Baris ada; untuk **Tandai selesai** ada tautan dokumen kind `Receipt / Invoice / Nota` atau `Payment Proof`.

#### Langkah-langkah
1. **Edit** (laci baris → **Edit**): ubah **Jumlah**, **Deskripsi**, **Rekening** (BCA 271 ↔ BNI 325 ↔ JAGO, D359), **Vendor**, **Proyek**, **Jenis**; isi
   **Keterangan** → **Simpan perubahan**. Seam `edit_transaction` (argumen kesembilan `p_account_code`, 0204).
2. **VOID**: tautan kecil "Ada yang salah dengan baris ini?" → **Batalkan entri ini** → isi alasan ("Mengapa ini dibatalkan?") → **Batalkan baris ini**
   → status **`VOID`**; baris & jumlah tetap terlihat, alasan tercatat; saldo mengecualikannya.
3. **Tandai selesai** → `complete_transaction` → status **`COMPLETED`** (nomor tetap).
4. **Dokumen**: bagian "Dokumen" di laci memakai EvidenceStrip (slot: Kuitansi/Nota, Faktur(opsional), Bukti bayar, Foto barang, Laporan penerimaan(opsional);
   untuk IN: Bukti bayar, Faktur(opsional)).

#### Aturan & kontrol
- **Edit**: `authority_required` · `not_found` · `transaction_void` ("a void row is not edited. Post a new one") · `description_required` · `amount_positive` ·
  `no_such_vendor/project/type/account` · **`reason_required`** (keterangan wajib **hanya bila jumlah berubah**) · `account_inactive` (tidak boleh dipindah ke
  rekening nonaktif) · **`account_currency`** (beda mata uang ditolak) · `authority_required` untuk rekening pimpinan (butuh `approve_funds`) ·
  **`statement_matched`** (baris yang sudah dicocokkan/dibukukan dari rekening koran tidak boleh diubah rekening/jumlahnya — lepas cocoknya dulu) ·
  tidak ada perubahan → `noop`. Jumlah boleh turun di bawah yang sudah dialokasikan (diskon/refund; 0102) — tidak diblokir, jejak audit membawa
  `allocated` dan `over_allocated`; baris rincian tunggal ikut disesuaikan.
- **VOID**: `authority_required` · `reason_required` · `not_found` · `already_void`. Alokasi dibiarkan (tidak ditulis ulang).
  Seam VOID **tidak** memeriksa kecocokan rekening koran (lihat Kesenjangan).
- **Tandai selesai** (0103): `authority_required` · `already_complete` · `transaction_void` · **`document_required`** ("Attach a receipt / nota or a payment proof…").
  Bukti lain (Invoice, foto, laporan penerimaan, **Rekening Koran**) tidak cukup untuk COMPLETED. Baris COMPLETED lama (846 dari 847 berasal dari sistem lama
  tanpa dokumen) dibiarkan.
- Edit/VOID/complete memakai kunci idempoten; ulangan = balasan sama.

#### Jejak data (apa yang terekam)
`transactions` diperbarui; log audit `edit`/`void`/`complete` dengan `before`/`after` per field (kode rekening/vendor/proyek, bukan uuid); event
`accounting.transaction.edited|voided|completed`. Riwayat per baris tampil di laci ("Riwayat": Diposting, Diedit, Dibatalkan, Ditandai selesai, Dokumen dilampirkan/dilepas).

#### Serah-terima ke tim lain
VOID menjadikan baris yang didanainya "terutang lagi" di papan permintaan.

#### Koreksi & pengecualian
Edit tidak bisa mengubah **arah** (IN/OUT) atau **tanggal** (kolom tidak diberi hak update, 0013): gunakan VOID + posting baru. Beda mata uang (USD) → VOID + posting benar
(baris dolar masuk lewat rekening koran, D181).

#### Checklist rutin
Bulanan: tidak ada baris `POSTED` lebih lama dari satu siklus tutup tanpa alasan; baris `POSTED` bernota/bukti bayar ditandai `COMPLETED`.

#### Sumber
`0021`, `0093`, `0101`, `0102`, `0103`, `0105` (vendor/proyek/jenis), `0204` · D84, D89, D359 · `TrxDrawer.tsx`.

---

### Rekening koran (bank statement) — `/accounting/rekening-koran`

#### Tujuan
Untuk **BCA 064 dan BCA USD 081** (dipegang pimpinan, tidak dibuka luas) rekening koran adalah **satu-satunya jalan mutasi mereka masuk buku besar**;
untuk rekening Akuntansi ia mencocokkan baris yang sudah ada (D180).

#### Pemilik / peran & kewenangan
Unggah: `accounting.create`. Cocokkan / lewati / isi kurs: `accounting.update`. **Bukukan** (membuat baris buku besar): `post_ledger`. Layar menyebut
"Membukukan ke buku besar butuh wewenang post_ledger" bila tidak ada.

#### Prasyarat
File ekspor bank (CSV): kolom **Tanggal, Keterangan, Jumlah (DB/CR), Saldo** (gaya BCA) atau kolom **Debit/Kredit** terpisah. Saldo awal dan saldo akhir dari header rekening koran (diketik).

#### Langkah-langkah
1. **Unggah** → modal "Upload rekening koran": pilih **Rekening**, pilih file; layar membaca baris (baris tanpa tanggal/jumlah dihitung dan **tidak ditebak**); isi
   **Saldo awal (dari rekening koran)**, **Saldo akhir (dari rekening koran)**, **Catatan** → **Masukkan N baris**. Dibuat `rkk-YY-MM-DD_NN`, status `PENDING`,
   baris awal `unmatched`.
2. Layar menghitung `saldo awal + Σ masuk − Σ keluar` terhadap saldo akhir bank: "cocok" atau "selisih …" + peringatan "Filenya belum utuh" (D182; file
   tetap bisa masuk, selisih tidak disembunyikan).
3. Per baris `unmatched` — satu dari:
   - **Tautkan ke** transaksi serupa (daftar "Mirip dengan:", beda hari ditampilkan) → baris jadi `matched` (tidak ada uang baru). Sistem hanya menyarankan, tidak pernah menautkan sendiri.
   - **Bukukan** → pilih **Jenis transaksi** + **Keterangan** → **Simpan** → baris `booked`, dibuat transaksi `trx-…` dengan `rekening_koran` sebagai bukti;
     `source_ref` = `<rkk>:<no baris>`; keterangan transaksi memuat uraian asli bank di `remark`.
   - **Lewati** → alasan wajib ("Alasan dilewati — dibaca saat baris ini ditanyakan") → `ignored`; tidak dihapus.
   - Baris mata uang asing: isi **Kurs hari itu** → **Simpan kurs** dulu (diketik dari advis bank, tidak pernah dicari otomatis, D181).

#### Aturan & kontrol
- `import_statement`: `permission_required` · `not_found` (rekening) · `no_rows` · `period_backwards` · **`period_already_uploaded`** (409; rekening + periode yang sama
  tidak bisa diunggah dua kali: `UNIQUE (account_id, period_start, period_end)`).
- `match_statement_line`: `rate_required` · `transaction_void` · **`direction_differs`** · **`amount_differs`** (selisih > toleransi Rp 1.000; "A match that accepts a
  different figure hides the disagreement") ; satu baris bank hanya tertaut ke satu baris buku besar.
- `book_statement_line`: `rate_required` · **`statement_not_filed`** (rekening koran tanpa file terlampir tidak bisa dipakai membukukan) · lalu seluruh penolakan
  `post_transaction`. Baris yang sudah diputuskan → `noop` ("That line has already been decided").
- `ignore_statement_line`: `reason_required`. `set_statement_rate`: `rate_invalid` · `line_decided`.
- Dua kondisi di kode yang harus diketahui pengguna (lihat Kesenjangan): modal unggah **tidak mengunggah file ke Drive dan tidak mengirim `attachment_id`**, sehingga
  **Bukukan** akan ditolak `statement_not_filed`; dan daftar jenis di form Bukukan menyertakan jenis pembelian (SUPPLIERS, CHINA, PREPAID VENDOR, OTHERS) yang akan
  ditolak `detail_required` karena baris dibukukan tanpa rincian/vendor — hanya `CASHFLOW` dan `BANK CHARGES` lolos (berdasarkan pembacaan kode; belum diuji di layar).

#### Jejak data (apa yang terekam)
`ops_acct.bank_statements` (statement_no, periode, saldo awal/akhir, mata uang, filename, status `PENDING|BOOKED|ABANDONED`, attachment_id, note),
`ops_acct.statement_lines` (status, trx_no, note, decided_by/at, fx_rate, amount_idr), audit `import/match/book/ignore/set_rate`, event `accounting.statement.*`.
Drive (bila berkas rekening koran diunggah sebagai dokumen): `ACCOUNTING / ops-talaliving / REKENING KORAN`.

#### Serah-terima ke tim lain
Pimpinan menyerahkan file (mis. via WhatsApp); hasilnya: saldo BCA 064/USD 081 (terkunci untuk non-`approve_funds`) dan baris yang menjadi data likuidasi/kalender.

#### Koreksi & pengecualian
Baris salah di-`ignored`/`matched` tidak bisa dibalik dari layar (tidak ada seam "lepas cocok" yang ditemukan; Edit memerintahkan "Unmatch it first" tetapi tombolnya
tidak ada — Kesenjangan). Status `ABANDONED` ada di enum tetapi tidak ada seam yang menetapkannya.

#### Checklist rutin
Bulanan: rekening koran setiap rekening bank diunggah; `belum diputuskan` = 0; `menunggu kurs` = 0; saldo akhir hitung = saldo akhir bank.

#### Sumber
`src/app/(app)/accounting/rekening-koran/{page,ImportStatement}.tsx` · `0019`, `0020`, `0025` · D180, D181, D182 · M31.

---

### Likuidasi dana operasional — `/accounting/liquidation`

#### Tujuan
Menjawab "saya sudah transfer sekian, kok sudah habis?": untuk setiap transfer masuk ke rekening operasional, ke mana uangnya pergi sebelum transfer berikutnya (D106).

#### Pemilik / peran & kewenangan
Baca: `accounting.read` (pimpinan & Akuntansi). Tidak ada aksi tulis.

#### Prasyarat
Transfer IN ke rekening `is_paying` sudah dibukukan.

#### Langkah-langkah
1. Buka **Likuidasi**: kartu "Transfer masuk", "Terpakai dalam rentang itu", "Umur khas sebuah transfer".
2. Daftar **Semua transfer masuk** (terbaru di atas): Ditransfer · Ke · dari · Jumlah · Terpakai sebelum transfer berikutnya · Berapa lama bertahan · Tanpa keputusan.
3. Buka satu transfer → laci: saldo sebelum transfer, tiap baris keluar dalam jendela dengan hitung mundur, pecahan per jenis/vendor/proyek; baris tanpa persetujuan di atas batas
   ditandai merah "no approval · over limit" (D231, batas Rp 2.000.000 sebagai setting `ops.no_approval_limit_idr`).

#### Aturan & kontrol
- Tidak ada pelacakan rupiah per rupiah: bila pengeluaran melebihi transfer, layar menyatakan kelebihan berasal dari saldo yang sudah ada.
- `undecided` hanya menghitung baris yang **diharapkan** punya persetujuan (`expects_allocation`); gaji/listrik tidak dihitung (D83).
- **Status implementasi**: fungsi `listFundings`/`getFunding` **hanya ada di demo** (`src/demo/api/accounting.ts`); `src/lib/api/accounting.ts` tidak memilikinya dan rute
  `/accounting/liquidation` **tidak ada di `LIVE_ROUTES`** (`src/lib/live.ts`) — di mode produksi layar ini gelap/501 sampai seam dibangun. Setting `ops.no_approval_limit_idr`
  hanya ada di fixture demo, bukan di migrasi.

#### Jejak data (apa yang terekam)
Hanya membaca `transactions`; tidak menulis.

#### Serah-terima ke tim lain
Pimpinan menggunakan keluaran untuk memutuskan besar transfer berikutnya.

#### Koreksi & pengecualian
Angka salah → perbaiki baris sumbernya di buku besar (Edit/VOID).

#### Checklist rutin
Setiap kali pimpinan mentransfer dana: periksa transfer sebelumnya habis berapa hari dan berapa "tanpa keputusan".

#### Sumber
`src/app/(app)/accounting/liquidation/*` · `src/services/accounting/contracts.ts` (FundingView) · D106, D108, D231, M12a.

---

### Kalender pembayaran & rencana kas 12 bulan — `/accounting/calendar`

#### Tujuan
Satu daftar komponen berulang (listrik, gaji, sewa, termin vendor, transfer pimpinan) dengan tanggal jatuh tempo: **anggaran dan pengingat sekaligus**, dua belas bulan ke depan,
rencana di atas, realisasi di bawah; mengatakan bulan uang habis (D109, D113, D115).

#### Pemilik / peran & kewenangan
- Baca penuh: `accounting.read` (Akuntansi & pimpinan). Mengaitkan pembayaran nyata ke tagihan (**Tautkan pembayaran**): `accounting.update`.
- **Menetapkan/mengubah perkiraan** (tombol **Tambah baris**, klik baris, klik sel **Ubah bulan ini saja**): di layar hanya `accounting.plan_cash` = **`accounting: admin`**,
  "milik pimpinan saja" (Q24, D233). **Konflik**: seam database `save_cash_component`/`set_cash_override` hanya memeriksa `accounting.update` (lihat Kesenjangan).

#### Prasyarat
Daftar komponen sudah diisi; jenis transaksi/vendor/rekening sudah ada di data master.

#### Langkah-langkah
1. **Tambah baris** (admin) → panel "Baris kalender baru": **Apa ini**, **Arah uangnya** (`Kita membayar` / `Uang masuk`), **Seberapa sering** (`Setiap bulan` / `Setiap minggu` /
   `Sekali saja`), **Jenis jumlah** (`Jumlah tetap` / `Perkiraan`), **Jumlah**, tanggal (hari dalam bulan 1–31, hari dalam minggu, atau tanggal), **Kategori di buku besar** (jenis transaksi),
   **Biasanya dibayar dari**, **Catatan**; **Tambahkan**. Jumlah adalah **per kejadian** (garis mingguan 30 juta = 120–150 juta sebulan).
2. **Ubah bulan ini saja** (sel): jumlah bulan itu (atau tidak ada bulan ini) + **Mengapa bulan ini berbeda** (mis. THR). Untuk garis mingguan, selisih jatuh di payday terakhir bulan itu (D114).
   Layar menjaga alasan wajib (D109); **seam tidak** menolak alasan kosong.
3. **Keluarkan dari kalender** (`active=false`): tidak direncanakan lagi mulai sekarang.
4. **Jatuh tempo berikutnya** (panel): tiga minggu ke depan + yang terlambat; per baris **Tautkan pembayaran** → pilih baris buku besar yang membayarnya.
5. Klik bulan → "Hari demi hari, dan titik kas terendah": hari pertama saldo minus, titik terendah, kewajiban tak bertanggal ("Tidak dihitung: utang ke pemasok yang terminnya tidak bertanggal").
6. Garis sewa aset: dari layar aset (**Create payment schedule**) → `schedule_asset_rent` membuat garis `Rent — <aset> (<no>)` (sumber `asset:<no>`).

#### Aturan & kontrol
- Status sel/kejadian (dihitung, tidak disimpan): `PAID` · `PARTIAL` · `OVERDUE` · `DUE` · `PLANNED` · `SKIPPED`. Aturan (0114): ada aktual dan (garis `estimate` **atau** aktual ≥ rencana − toleransi) → `PAID`;
  aktual > 0 saja → `PARTIAL`; tanggal lewat tanpa aktual → `OVERDUE`; ≤ 7 hari → `DUE`; selain itu `PLANNED`; override tanpa jumlah → `SKIPPED`. Garis `estimate` lunas oleh pembayaran apa pun yang cocok.
- **Pencocokan realisasi**: tautan manual selalu menang (`cash_settlements`, "One row, one bill" → `already_linked` 409; `transaction_void`); bila tidak ada tautan, kategori cocok = tebakan yang
  ditandai `≈`; garis bulanan mengklaim semua baris cocok di bulan itu, garis mingguan/sekali mengklaim yang terdekat dalam jendela **3 / 10 hari**; urutan klaim: sekali-berdata → ber-vendor → kategori (D110).
- Kas awal = jumlah saldo rekening `custody = accounting` yang aktif (saldo pimpinan tidak dihitung). Baris "Tidak ada di rencana" = uang keluar tanpa garis yang mengklaimnya (D111).
- Kalender **tidak pernah memposting transaksi** (D112): uang dicatat di buku besar dengan bukti, lalu dinamai di sini.
- Penolakan seam: `not_permitted` · `name_required` · `amount_required` · `amount_kind_invalid` · `due_day_out_of_range` · `weekday_required` · `date_required` · `month_invalid` ·
  `already_linked` · `already_scheduled` / `not_rented` / `rent_missing` / `contract_start_required` (garis sewa).
- Bukan di seam walau tertulis di dokumen: penolakan bentrok kategori antar dua garis (D110, "409") dan "422 tanpa alasan" pada override (docs/plan/03-api.md).

#### Jejak data (apa yang terekam)
`ops_acct.cash_components` (nama, arah, jumlah, frekuensi, tanggal, `amount_kind`, `scheme_codes`, `source_ref`, `active`), `cash_overrides` (per bulan, alasan, siapa), `cash_settlements`;
audit `save`/`override`/`link`. Rencana dihitung oleh `ops_acct.cash_plan()` (tidak disimpan).

#### Serah-terima ke tim lain
Pimpinan membaca verdict "habis di <bulan>"; HRD: garis iuran memuat `scheme_codes` (BPJS Kesehatan, JHT, JP, JKK, JKM, PPh21) untuk audit nama × tarif (D259).

#### Koreksi & pengecualian
Tautan salah → belum ada tombol lepas tautan di layar (hanya dilindungi "satu baris, satu tagihan"). Garis salah → ubah atau keluarkan; sejarah realisasi tetap dari buku besar.

#### Checklist rutin
Harian: buka **Jatuh tempo berikutnya**; tautkan pembayaran yang sudah dibukukan ke tagihannya. Bulanan: tinjau "Tidak ada di rencana" dan usulkan garis baru kepada pimpinan.

#### Sumber
`src/app/(app)/accounting/calendar/*` · `0022`, `0089`, `0090`, `0091`, `0092`, `0114`, `0116` · D109–D116, D233, D259 · smoke `07`, `86`, `87`, `96`.

---

### Tagihan bulan ini — `/accounting/tagihan`

#### Tujuan
Daftar kerja Akuntansi untuk satu bulan: apa yang harus dibayar, apa yang sudah, apa yang lewat tempo, dan mana yang tidak biasa dibanding bulan lalu (D227, D228).

#### Pemilik / peran & kewenangan
`accounting.read` (baca saja; membayar tetap lewat proses pembayaran di atas). Bentuk lain dari perhitungan kalender yang sama — bukan perhitungan kedua.

#### Prasyarat
Komponen kalender sudah diisi (oleh pimpinan).

#### Langkah-langkah
1. Buka **Tagihan <bulan>**; pindah **Bulan lalu / Bulan ini / Bulan depan**.
2. Baca kartu: "Harus keluar", "Sudah dibayar", "Masih harus dibayar", "Lewat tempo", "N tagihan berbeda jauh dari bulan lalu".
3. Tabel **Tanggal / Tagihan / Rencana / Dibayar / Baris ini · bulan lalu / Status** dengan bagian lewat tempo, belum dibayar, sudah dibayar, uang masuk yang direncanakan (tidak dijumlah).
4. Bayar lewat Entri/Pembayaran, lalu **Tautkan pembayaran** dari kalender bila pencocokan kategori ≈ tidak cukup.

#### Aturan & kontrol
- Anomali: perubahan > **25%** terhadap bulan lalu (setting `ops.bill_anomaly_percent`, D229) → "Ditandai, bukan ditolak". Garis yang belum ada bulan lalu **tidak pernah** dianggap anomali.
  Perbandingan memakai total bulanan per garis (bukan per baris); garis mingguan "N× sebulan — dibandingkan sebagai total bulanan" (F68).
- Estimasi lunas oleh pembayaran apa pun; selisih estimasi ditampilkan ("dari estimasi").
- Kartu **Iuran wajib — tagihan vs daftar nama** (D259) memanggil `getContributionAudit`; di kode produksi fungsi itu **mengembalikan daftar kosong** sehingga kartu tersembunyi (hanya demo yang menghitung).

#### Jejak data (apa yang terekam)
Hanya membaca kalender + buku besar.

#### Serah-terima ke tim lain
HRD: daftar nama iuran wajib (`/hrd/wlkp`); pimpinan: kalender.

#### Koreksi & pengecualian
Angka berbeda dari harapan → periksa pencocokan (≈ vs tertaut) dan jenis transaksi baris buku besar.

#### Checklist rutin
Setiap awal bulan dan setiap Senin: buka **Tagihan bulan ini**; kejar yang **Lewat tempo** dan yang ditandai tidak biasa.

#### Sumber
`src/app/(app)/accounting/tagihan/page.tsx` · `getMonthlyBills` di `src/lib/api/accounting.ts` · D227–D229, D259, F68.

---

### Data master akuntansi: rekening & jenis transaksi

#### Tujuan
Memelihara daftar rekening dan jenis transaksi dari layar, bukan migrasi (0105).

#### Pemilik / peran & kewenangan
- **Jenis transaksi** (`/master-data/transaction-types`): `accounting.update`.
- **Rekening** (`/master-data/accounts`): `accounting.update` **dan** `post_ledger`; menyentuh rekening pimpinan (membuat, mengubah, memindah custody) juga butuh `approve_funds`.
- Layar dibuka dengan `accounting.read`.

#### Prasyarat
Kode rekening/jenis baru belum dipakai; untuk mengubah saldo awal, alasan.

#### Langkah-langkah
1. **Tambah rekening**: **Kode** (2–24 karakter huruf/angka/spasi/titik/strip, mis. `MANDIRI 123`; tidak bisa diubah), **Nama**, **Dipegang oleh** (`Accounting`/`Pimpinan`), **Membayar vendor**,
   **Mata uang**, **Saldo awal**, **Per tanggal**.
2. **Ubah** rekening: bila saldo awal diubah, isi **Alasan saldo awal berubah** (wajib).
3. **Nonaktif** (Aktif tidak dicentang) → keluar dari pilihan, riwayat tetap. **Hapus** hanya bila tidak ada transaksi.
4. **Tambah jenis**: **Kode** (huruf kapital, ejaan buku besar — `RECCURING` tetap dua C), **Kegunaannya**, **Pembelian** (baris diharapkan menyebut PR/PO; wajib vendor + rincian), **Membuat barang**
   (rincian mengisi katalog), **Selesai otomatis** (dicadangkan, belum jalan); retired = dipensiunkan (tidak dihapus).

#### Aturan & kontrol
- `authority_required`; `leadership_account` ("Leadership accounts are changed only by someone who approves funds"); `code_invalid`, `name_required`, `currency_invalid`; mata uang terkunci setelah ada transaksi;
  hapus hanya baris tak-direferensi. Setiap perubahan ke log audit dengan nilai lama/baru.
- Jenis bawaan (0013 + 0042): `RECCURING - UTILITIES`, `CREDIT CARD`, `PREPAID VENDOR`, `SUPPLIERS`, `BANK CHARGES`, `ONLINE`, `CHINA`, `RECCURING - PAYROLL`, `CASHFLOW`, `OTHERS`, `PRODUCTION`, `OFFICE`,
  `WAREHOUSE`, `TRANSPORT`, `EJO`, `RECCURING - PAYROLL MONTHLY`, `RECCURING - PAYROLL WEEKLY`, `RECCURING - OVERTIME`. Bendera `is_purchase=false`: `RECCURING - UTILITIES`, `BANK CHARGES`, `RECCURING - PAYROLL*`, `CASHFLOW`,
  `EJO`, `RECCURING - OVERTIME`. Jenis tak dikenal dianggap pembelian (disengaja, D83). `EJO` dibaca sebagai pengeluaran pribadi pemilik (asumsi 0042 — tidak dikonfirmasi).

#### Jejak data (apa yang terekam)
`ops_acct.accounts`, `ops_acct.transaction_types` (`description`, `is_active`), audit via `ops_core.say`.

#### Serah-terima ke tim lain
Pengadaan memakai jenis `SUPPLIERS` dll. di form pembayaran; kalender memakai jenis untuk pencocokan.

#### Koreksi & pengecualian
Kode tidak dapat diganti nama: nonaktifkan lalu buat baru.

#### Checklist rutin
Bulanan/tiap ada rekening baru: daftar rekening aktif = rekening bank yang benar-benar dipakai.

#### Sumber
`src/app/(app)/master-data/{accounts,transaction-types}/page.tsx` · `0013`, `0042`, `0105` · D87.

---

### Bukti & dokumen pada record (EvidenceStrip, ubin gambar, Dokumen akuntansi)

#### Tujuan
Menjamin setiap uang/barang punya bukti yang bisa dibuka, dan setiap berkas tahu menempel ke record apa — jalan utama (ADR-010): lampirkan **dari record-nya**.

#### Pemilik / peran & kewenangan
- Melampirkan/melepas: tombol hanya tampil bila `canEdit` layar tersebut (untuk baris buku besar = `post_ledger` dan bukan VOID). Seam `attach_link`/`attach_unlink` tidak
  memeriksa modul/authority (hanya harus login; RLS `links_write` mengharuskan `linked_by = auth.uid()`); kontrolnya ada di layar.
- Membaca metadata berkas: semua pengguna login (`attachments_read` = true). Membuka isi berkas: izin Google Drive orang itu sendiri.

#### Prasyarat
Record induk (baris buku besar, baris PR, aset, item, dst.) sudah ada.

#### Langkah-langkah
1. Buka laci record → bagian **Dokumen**. Setiap slot yang diharapkan (mis. Kuitansi/Nota, Bukti bayar, Foto barang) punya tombol unggah dan kamera.
2. Pilih berkas → diunggah lewat `/api/documents/upload` (lihat Drive) → `documents.link` memasang tautan dengan `kind`.
3. **Juga mencakup**: satu dokumen bisa ditautkan ke beberapa record (nota satu pengiriman, bukti transfer untuk beberapa pembelian) — tidak diunggah berkali-kali.
4. Melepas: tombol lepas → tautan ditandai `unlinked_at/by` (berkas tetap, A2/A5).
5. Gambar tampil sebagai **ubin** (tile) dengan thumbnail; klik membuka berkas di Google Drive; nama berkas adalah tautan. Thumbnail diambil lewat `/api/documents/thumb/[id]?w=` oleh server
   (akun layanan), bukan oleh browser (F174, F175).
6. **Dokumen akuntansi** `/accounting/documents` (diparkir, D105 — tetap berfungsi): 300 berkas terbaru; kolom Dokumen/Jenis/Dilampirkan ke/Mencakup; filter jenis & bulan; "N belum dilampirkan" =
   berkas tanpa tautan (yatim).

#### Aturan & kontrol
- **Jenis dokumen** (label layar → kode database; `ops_core.doc_kind_labels`): `Receipt / Invoice / Nota`→`nota`; `Payment Proof`→`transfer_proof`; `Receiving Item`→`goods_photo`;
  `Delivery Note`→`delivery_note`; `Purchase Order`→`purchase_order`; `Reference Link`→`quotation`; `Invoice`→`invoice`; `Surat Jalan`→`surat_jalan`; `Rekening Koran`→`rekening_koran`;
  `Receiving Report`→`receiving_report`; `Others`→`other`; (HR/produksi/proyek: lihat bab Drive).
- **Bukti utama** untuk uang (D85/D180): `nota`, `transfer_proof`, `goods_photo`, `rekening_koran`. **Pendukung**: delivery note, PO, invoice, receiving report, reference link, dll.
  **Syarat COMPLETED**: `nota` atau `transfer_proof` (0103). **Syarat permintaan** sebelum minta keputusan: Reference Link, Nota, PO, atau Others (`REQUEST_SUPPORT_KINDS`, D125).
- Tautan (link) adalah bukti kelas satu: halaman toko/marketplace tidak difoto, melainkan ditautkan (`Reference Link`, hanya http/https; `url_scheme`).
- **Kehati-hatian duplikat**: byte sama → `duplicate_suspect` (peringatan, tidak memblokir, A6). Byte sama persis yang sudah ada di drive yang sama atau tangkapan Chat untuk jenis ACCOUNTING →
  berkas yang ada ditautkan, **tidak ada yang dikirim ke Drive** ("Terlampir — sudah ada di Drive").
- Batas ukuran: setting `ops_core.settings 'upload.max_bytes'` = **26.214.400 byte (25 MB)** — dicek di `attach_file` **setelah** berkas sudah di Drive; dokumen lama (03-api, demo) menyebut 15 MB.

#### Jejak data (apa yang terekam)
`ops_core.attachments` (`storage_path` = id Drive, `web_view_link`, `drive_slug`, `drive_path`, `drive_folder_id`, `sha256`, `source` web/chat/api/import, `uploaded_by/at`), `attachment_links` (entity, `entity_no`, kind,
`linked_by/at`, `unlinked_by/at`), audit `attach_file` (nama berkas → `PROCUREMENT / ops-talaliving / INVENTORY/ITEMS`), event `documents.attachment.filed|unlinked`. View `v_attachment.filed_in` menampilkan lokasi dalam kata.

#### Serah-terima ke tim lain
Semua modul memakai komponen yang sama; berkas HR hanya dibuka orang yang anggota drive HRD.

#### Koreksi & pengecualian
Berkas salah jenis → lepas tautan, unggah ulang dengan jenis benar (jenis menentukan drive; tidak bisa dipindah dari layar). Lihat Kesenjangan untuk pembatasan baca thumbnail.

#### Checklist rutin
Mingguan: **Dokumen** → "belum dilampirkan" dibersihkan (lampirkan atau catat mengapa dibiarkan).

#### Sumber
`src/components/ui/{evidence-strip,image-tiles,doc-preview,evidence-chip,file-evidence}.tsx` · `src/services/documents/contracts.ts` · `src/lib/drive-links.ts` · `0005`, `0024`, `0175`, `0177` ·
D85, D91, D125, D180, F174, F175 · `/accounting/documents/page.tsx`.

---

### Aturan penyimpanan file (Google Drive)

#### Tujuan
Semua file yang dipakai aplikasi tersimpan di **satu tempat yang bisa dibuka manusia dan sistem berdampingan**: folder **`ops-talaliving`** di root shared drive modul, **satu folder per tugas**,
dan Supabase mencatat di mana setiap file berada (D313, D319, D320, D359, D360).

#### Pemilik / peran & kewenangan
- Mengunggah: siapa pun yang login lewat layar yang punya tombol unggah (akses modul layar itu). Drive ditulis oleh **akun layanan** (`capture-worker@john-lau-v01.iam.gserviceaccount.com`, Content manager di
  tiap shared drive); database ditulis **sebagai orangnya** (RLS berlaku).
- Memilih drive/mengubah pemetaan jenis→drive (`doc_kind_drive`, `drive_folders`): `it.manage_drives` (IT level `admin`; D314, `0173`). Mengubah sub-folder tugas (`drive_paths`): `it.update` (langsung di tabel; **tidak ada layar**).
- Membuat folder `ops-talaliving` di semua drive: IT → Google Drive (`/it/drive`, `it.read` untuk melihat, `it.manage_drives` untuk membuat).

#### Prasyarat
1. Akun layanan menjadi **Content manager** di setiap shared drive (cek di `/it/drive`).
2. Env Worker `GOOGLE_SERVICE_ACCOUNT_EMAIL` dan `GOOGLE_PRIVATE_KEY` (tidak pernah berprefiks `NEXT_PUBLIC_`).
3. Setiap `doc_kind_t` punya baris di `doc_kind_drive` (dicek saat ladder dibangun) dan label di `doc_kind_labels`.

#### Langkah-langkah
1. Layar memanggil `documents.upload({file, kind, entity?})` → `POST /api/documents/upload` (cookie sesi). `kind` **wajib** (menentukan drive; tidak ada default).
2. Route bertanya ke database `ops_core.drive_folder_for(kind, entity)` → `{slug, label, drive_id, folder_id, path}`; drive dari `doc_kind_drive` (batas data pribadi, 0035), folder tugas dari `drive_paths`
   (`drive_path_for`). Penolakan: `unknown_kind`, `unknown_entity`, `no_drive_for_kind`, `drive_not_configured`.
3. Route menghitung **SHA-256**; `ops_core.same_bytes(sha256, kind)` — bila berkas identik sudah ada (drive sama, atau tangkapan Chat untuk jenis ACCOUNTING) → tautkan yang ada, balas `reused: true`, **tidak ke Drive** (D359).
4. Bila `ops-talaliving` belum tercatat: route mencari drive (`driveOf`, `drive.readonly`), **membuat/menemukan folder `ops-talaliving`** di root (`findOrCreateAppFolder`), lalu `record_ops_folder` menyimpan `drive_id` + `folder_id`.
5. `findOrCreatePath` membuat tiap tingkat folder tugas (`INVENTORY` → `ITEMS`, dst., nama dicocokkan tanpa peduli huruf besar-kecil sehingga folder buatan tangan dipakai ulang), lalu mengunggah (`uploadToDrive`, scope `drive.file`).
6. Route memeriksa `parents` file di Drive = folder tujuan (bila tidak, `drive_misfiled`, 502, tidak dicatat; id file di pesan agar IT memindahkan).
7. `ops_core.attach_file` mencatat: `storage_path` (id Drive), `web_view_link` (harus `https://drive|docs.google.com/…`, `not_a_drive_link`), `drive_slug`/`drive_path` (diturunkan database, bukan dari pemanggil), `drive_folder_id`, `sha256`, `source`.
8. Layar lalu memasang tautan ke record (`attach_link`) — lihat bab sebelumnya.

#### Aturan & kontrol
**Aturan folder (CLAUDE.md, D313, D320):**
- Tidak pernah ada file lepas di `ops-talaliving`; tiap file di folder tugasnya. Tanpa baris `drive_paths` → folder = nama jenis dalam huruf kapital (`purchase_order` → `PURCHASE ORDER`).
- Fitur baru yang menyimpan file **wajib** meneruskan `entity` ke `documents.upload(...)` dan, bila perlu folder sendiri, menambah baris `drive_paths` di migrasinya. Drive tetap hanya dipilih `doc_kind_drive`.
- Token tanggal di `drive_paths.path`: `{YYYY-MM}` dan `{YYYY-MM-DD}` = **hari kantor WIB** (0203); untuk dokumen penerimaan Chat = **hari foto dikirim**, bukan hari dicocokkan (`drive_path_for(kind, entity, day)`, 0204).
- `drive.file` hanya melihat file buatan aplikasi, sebab itu folder buatan tangan "OPS" dulu menjawab *File not found* (F173); `parent_folder_id` (OPS buatan tangan) kini hanya menandai **drive mana**.
- **Batas data pribadi (0035)**: kind HR (KTP dst.) tidak bisa dikirim ke luar HRD karena drive diturunkan dari kind, bukan diterima dari pemanggil; route juga mencocokkan `parents` dari Drive.

**Pohon folder lengkap per jenis dokumen** (turunan `doc_kind_drive` 0035/0101/0132/0188 + `drive_paths` 0172/0187/0188/0204; semua di bawah `<drive> / ops-talaliving /`):

| Drive (label) | Jenis dokumen (label layar → kode) | Folder di bawah `ops-talaliving` | Sumber aturan |
|---|---|---|---|
| **ACCOUNTING** | Receipt / Invoice / Nota → `nota` | `NOTA` (target D359: `TRANSACTIONS/{YYYY-MM}/{YYYY-MM-DD}` — **belum ada barisnya**) | default 0172 |
| | Payment Proof → `transfer_proof` | `TRANSFER PROOF` (target sama) | default |
| | Rekening Koran → `rekening_koran` | `REKENING KORAN` | default |
| | Invoice → `invoice` | `INVOICE` | default |
| **PROCUREMENT** | Foto, `entity=item` | `INVENTORY/ITEMS` (foto barang katalog, D309) | `drive_paths` 0172 |
| | Foto, `entity=product` | `INVENTORY/FINISHED GOODS` (barang jadi, D311) | 0172 |
| | Foto, `entity=asset` | `INVENTORY/ASSETS` | 0172 |
| | Foto, entity lain / tanpa entity | `FOTO` | default |
| | Receiving Item → `goods_photo` | `RECEIVING REPORT/{YYYY-MM}/{YYYY-MM-DD}` | 0172 → 0204 (D360) |
| | Receiving Report → `receiving_report` | `RECEIVING REPORT/{YYYY-MM}/{YYYY-MM-DD}` | idem |
| | Delivery Note → `delivery_note` | `RECEIVING REPORT/{YYYY-MM}/{YYYY-MM-DD}` | idem |
| | Surat Jalan → `surat_jalan` | `RECEIVING REPORT/{YYYY-MM}/{YYYY-MM-DD}` | idem |
| | Purchase Order → `purchase_order` | `PURCHASE ORDER` | default |
| | Reference Link → `quotation` | `QUOTATION` (tautan tidak masuk Drive; hanya bila ada berkas) | default |
| | Sertifikat → `sertifikat` | `SERTIFIKAT` | default |
| | Others → `other` | `LAIN-LAIN` | 0172 |
| **DRAFTING** | Gambar Kerja → `gambar_kerja` | `GAMBAR KERJA` | default |
| | Gambar Jadi → `gambar_jadi` | `GAMBAR JADI` | default |
| **HRD** | KTP, Kartu Keluarga, Ijazah, CV, Kontrak Kerja, NPWP, BPJS | `KTP`, `KARTU KELUARGA`, `IJAZAH`, `CV`, `KONTRAK KERJA`, `NPWP`, `BPJS` | default |
| | Surat Dokter → `surat_dokter` | `CUTI IZIN SAKIT/SURAT DOKTER` | 0187 |
| | Surat Lembur / Laporan Lembur / Surat Peringatan | `SURAT LEMBUR`, `LAPORAN LEMBUR`, `SURAT PERINGATAN` | default |
| | Foto Presensi → `foto_presensi` (`entity=attendance_scan`) | `PRESENSI LUAR AREA` | 0188 |
| **PROJECT MANAGER** | BAST → `bast` | `BAST` | default |
| | Surat Jalan Keluar → `surat_jalan_keluar` | `SURAT JALAN KELUAR` | default |
| | Foto Lokasi → `foto_lokasi` | `FOTO LOKASI` | default |
| **PRODUCTION, BACKUP, IT** | (belum ada jenis yang dipetakan) | — | 0035/0036: kosong |

Catatan pohon: (1) contoh pohon di CLAUDE.md menaruh `TRANSACTIONS/...` seolah sudah berlaku untuk akuntansi — di kode baru **`RECEIVING REPORT/{YYYY-MM}/{YYYY-MM-DD}`** (PROCUREMENT) yang berbulan;
akuntansi masih `NOTA`/`TRANSFER PROOF` sampai IT menambah barisnya. (2) Foto RECEIVING REPORT dari Chat disalin otomatis ke `PROCUREMENT / ops-talaliving / RECEIVING REPORT / <YYYY-MM> / <YYYY-MM-DD>` begitu **Cocokkan**;
file bertanda *Kuitansi / Nota* mengikuti drive nota (ACCOUNTING, `NOTA`) — D360, D363.

#### Jejak data (apa yang terekam)
`ops_core.drive_folders` (slug, label, `drive_id`, `folder_id` = `ops-talaliving`, `parent_folder_id`), `ops_core.doc_kind_drive` (kind → slug), `ops_core.drive_paths` (kind + entity → path), `ops_core.attachments`
(`drive_slug`, `drive_path`, `drive_folder_id`, `web_view_link`, `sha256`), `ops_procure.receiving_inbox_files.original_attachment_id` (asal salinan Chat, 0204). Audit: berkas masuk = `attach_file`; unggahan gagal = `upload · refused` dengan alasan terbaca dan jawaban Google di `detail`
(`record_upload_failure`, 0177); pertanyaan folder **tidak** dicatat sebagai peristiwa.

#### Serah-terima ke tim lain
Semua modul menaati aturan yang sama. HRD: dokumen pribadi hanya di drive HRD. Pengadaan: foto penerimaan berbulan. Akuntansi: bukti uang di drive ACCOUNTING.

#### Koreksi & pengecualian
- Salah drive/folder (mis. `drive_misfiled`): IT memindahkan file memakai id Drive dalam pesan, lalu mengunggah ulang yang benar; tautan lama dilepas, bukan dihapus.
- Folder `ops-talaliving` hilang/dipindah: `app_folder_missing` → IT → Google Drive → **Buat ops-talaliving**.
- Kode galat Drive yang dikenal (`src/lib/drive-errors.ts`): `drive_key_refused`, `drive_not_member` (akun layanan bukan anggota), `drive_not_shared`, `drive_no_permission` (jadikan Content manager), `drive_app_folder_missing`,
  `drive_upload_failed`/`drive_folder_failed`, `drive_failed`, `drive_misfiled`, `drive_not_configured` (501).
- 28 berkas kembar (28/09–01/10) dibiarkan (D359).

#### Checklist rutin
Bulanan (IT): `/it/drive` semua drive berstatus **Siap**; Audit log tidak memuat `upload · refused` berulang; tidak ada folder lepas di akar `ops-talaliving`.

#### Sumber
`src/app/api/documents/upload/route.ts` · `src/lib/drive.ts`, `drive-errors.ts`, `drive-links.ts` · `src/app/api/documents/{drive-check,thumb}` · `0005`, `0024`, `0035`, `0036`, `0100`, `0101`, `0132`, `0172`, `0173`, `0175`, `0177`, `0187`, `0188`, `0203`, `0204`, `0205`
· CLAUDE.md (aturan pemilik) · D309, D311, D313, D314, D319, D320, D359, D360, D363 · F166, F169, F173–F175, F211, F212.

---

### Operasional IT → Google Drive — `/it/drive`

#### Tujuan
Memastikan aplikasi bisa menyimpan file ke setiap shared drive dan membuat folder `ops-talaliving` untuk semua drive sekaligus.

#### Pemilik / peran & kewenangan
Lihat: `it.read` (IT dan pimpinan). Membuat folder / mencatat id: `it.manage_drives` (IT `admin`). Layar IT hanya dibuka IT dan pimpinan (D190, IT_ACCESS_RULE).

#### Prasyarat
Akun layanan sudah ditambahkan ke shared drive; env Worker terpasang.

#### Langkah-langkah
1. IT → `/it/drive` → baca kartu **Akun Drive aplikasi** (alamat akun, izin `drive.file`, "Menyimpan ke <shared drive> / ops-talaliving / …").
2. Baca status tiap drive: `ready` **Siap** · `not_set_up` **Belum disiapkan** · `not_member_or_wrong_id` **Tidak bisa diakses** (tambahkan akun sebagai Content manager) · `read_only_member` **Anggota hanya-baca** ·
   `app_folder_missing` **Folder hilang** · `not_configured` **Belum dicatat** · `check_failed` **Cek gagal**.
3. **Buat ops-talaliving di semua drive** (atau per drive: **Buat ops-talaliving**) → folder dicari/dibuat, `drive_id` dan `folder_id` dicatat; toast "ops-talaliving siap".
4. **Cek lagi** setelah menambah akun ke drive.

#### Aturan & kontrol
Endpoint `GET/POST /api/documents/drive-check` memeriksa `it.read` / `it.manage_drives` lewat database; `501 drive_not_configured` bila env hilang. Mencatat folder mengisi kolom kosong saja; mengubah yang sudah terisi tetap `it.manage_drives`.

#### Jejak data (apa yang terekam)
`ops_core.drive_folders.drive_id/folder_id/updated_by`; audit.

#### Serah-terima ke tim lain
Semua modul bergantung pada status **Siap** untuk drive masing-masing.

#### Koreksi & pengecualian
Drive "Tidak bisa diakses": tambahkan `capture-worker@john-lau-v01.iam.gserviceaccount.com` ke shared drive. Menambah baris `drive_paths` (mis. pohon `TRANSACTIONS/{YYYY-MM}/{YYYY-MM-DD}` untuk nota & bukti transfer) tidak punya layar:
IT menulis ke tabel (`it.update`) — contoh: `insert into ops_core.drive_paths (kind, entity, path) values ('nota', null, 'TRANSACTIONS/{YYYY-MM}/{YYYY-MM-DD}')` **hanya setelah** pemindahan isi OPS lama diputuskan pemilik (D359 butir 3).

#### Checklist rutin
Mingguan: buka `/it/drive` setelah perubahan keanggotaan Google; bulanan: pastikan tiap drive **Siap**.

#### Sumber
`src/app/(app)/it/drive/page.tsx` · `src/app/api/documents/drive-check/route.ts` · `0036`, `0173`, `0177` · D314, D320, F166, F173.

---

### Checklist penutupan rutin Akuntansi (ringkasan lintas proses)

#### Checklist rutin
> Catatan: sistem hanya memaksa kontrol di tiap proses di atas; **jadwal tutup di bawah adalah usulan operasional berdasarkan fitur yang ada, belum ditetapkan pemilik** (tidak ditemukan keputusan D### tentang jadwal tutup).

**Harian**
1. Verifikasi: antrean `0` atau setiap dokumen punya alasan menunggu; periksa dokumen "mirip …" sebelum membukukan.
2. Buku besar: semua uang bergerak hari ini sudah dibukukan dengan bukti; tidak ada "tanpa permintaan di baliknya" tanpa alasan.
3. Kalender → **Jatuh tempo berikutnya**: tagihan hari ini/terlambat dibayar atau dijelaskan; pembayaran yang sudah dibukukan **ditautkan**.
4. Saldo `CashPosition` sama dengan saldo nyata `PETTY CASH`, `BNI 325`, `BCA 271`, `JAGO`.

**Mingguan**
1. Jumat: run gaji mingguan `PAID` dan tercatat (D357).
2. Dokumen akuntansi: "belum dilampirkan" dibersihkan; jumlah "masuk lewat jalan ini" tidak naik terus.
3. Alokasi: baris pembelian tanpa permintaan ditindaklanjuti dengan Pengadaan.
4. Transfer pimpinan yang masuk minggu ini sudah dibukukan (IN) dengan bukti; cek Likuidasi bila layar sudah live.

**Bulanan**
1. Unggah rekening koran tiap rekening bank; semua baris `matched`/`booked`/`ignored` (alasan), kurs asing terisi, saldo akhir hitung = bank.
2. **Tagihan bulan ini**: semua `Lewat tempo` selesai; tinjau tagihan "tidak biasa" (> 25%); baris "Tidak ada di rencana" dibawa ke pimpinan.
3. Baris `POSTED` yang dokumennya lengkap ditandai `COMPLETED`.
4. IT: `/it/drive` semua **Siap**.

#### Sumber
Gabungan bagian sebelumnya.

---

### Kesenjangan & catatan chapter ini

**A. Belum dibangun / belum tercatat**
1. **Likuidasi tidak live**: `listFundings`/`getFunding` hanya di demo; rute `/accounting/liquidation` di luar `LIVE_ROUTES`. Setting `ops.no_approval_limit_idr` (Rp 2.000.000, D231) tidak ada di migrasi.
2. **Audit iuran wajib** (kartu di Tagihan, D259) kosong di produksi (`getContributionAudit` mengembalikan `[]`).
3. **Rekening koran tidak punya file bukti**: modal unggah tidak mengunggah CSV ke Drive dan tidak mengirim `attachment_id`; `bank_statements.attachment_id` tidak bisa diperbarui sesudahnya (hak update hanya `status`,`note`).
   Akibatnya **Bukukan** ditolak `statement_not_filed` (dibaca dari kode; belum diuji di layar). Jalan keluar manual: tidak ada di layar — perlu pekerjaan IT.
4. Form **Bukukan** di rekening koran menawarkan jenis pembelian (SUPPLIERS, CHINA, PREPAID VENDOR, OTHERS) yang akan ditolak `detail_required` (baris dibukukan tanpa rincian/vendor); hanya `CASHFLOW` / `BANK CHARGES` yang
   lolos (kesimpulan dari kode seam).
5. Tidak ada tombol untuk: melepas kecocokan baris rekening koran (padahal Edit menyuruh "Unmatch it first"), mengoreksi/menarik alokasi (`supersede_allocation`; penarikan penuh **rusak** karena `supersede_not_self`, F211),
   melepas tautan kalender, `CANCELLED` di Verifikasi, status `ABANDONED` rekening koran, status `UNTRACKED`.
6. **Pohon `TRANSACTIONS/<YYYY-MM>/<YYYY-MM-DD>` untuk nota dan bukti transfer belum aktif** (D359 butir 3 menunggu pemilik: memindahkan isi folder OPS lama ke `ops-talaliving` dan mengubah bot Chat agar membuat folder di bawah
   `drive.file`). Saat ini: unggahan aplikasi → `NOTA`/`TRANSFER PROOF`; tangkapan bot Chat tetap di `OPS/TRANSACTIONS/<bulan>` (di luar `ops-talaliving`). CLAUDE.md menggambarkan target, bukan keadaan sekarang.
7. Tidak ada layar untuk `drive_paths` / `doc_kind_drive`: IT mengubah langsung di tabel.
8. Tidak ada jadwal tutup bulan/periode (lock periode) di kode: baris lama tetap bisa diedit/VOID kapan pun oleh `post_ledger`; tidak ada rekonsiliasi saldo bank otomatis selain rekening koran.
9. Pembayaran payroll di layar HRD butuh akses modul payroll untuk membuka halaman; akun Akuntansi di snapshot produksi tidak punya modul `payroll` — siapa yang menekan "Bayar run ini" di praktiknya tidak terdokumentasi.

**B. Konflik dokumen vs kode**
1. Kalender (D233, 03-api): perkiraan "hanya `accounting: admin`, dijaga di API dengan `requireLevel`". Di database, `save_cash_component`/`set_cash_override`/`link_cash_payment` hanya memeriksa `accounting.update`;
   penjaga `requireLevel(... "admin")` hanya di demo (komentar `src/lib/api/accounting.ts` mengakui). Praktisnya hanya layar yang membatasi.
2. 03-api: "409 bila dua garis kalender mengklaim kategori sama (D110)" dan "422 override tanpa alasan" — **tidak ada di seam SQL** (alasan dan bentrok kategori hanya dijaga demo/layar).
3. 03-api/demo: batas unggah 15 MB; setting database `upload.max_bytes` = 25 MB (route salinan penerimaan 25 MB), dan batas dicek **setelah** berkas sudah di Drive (berkas besar tertinggal di Drive tanpa baris).
4. A11 (00-context): COMPLETED = rantai penuh (permintaan + approval + ronde + bukti bayar + receiving report). Kode (0103): cukup satu `nota` atau `transfer_proof`. Baris yang hanya berbukti `Rekening Koran` tidak bisa COMPLETED.
5. CLAUDE.md menggambarkan pohon Procurement `RECEIVING REPORT/<YYYY-MM>/<YYYY-MM-DD>` (benar, 0204) dan "as ACCOUNTING files TRANSACTIONS/…" (belum, lihat A.6).
6. Komentar 0004/0203 menyebut hari kantor WITA; sejak D334/`0190` hari kantor = WIB.
7. `source_ref` payroll/PO/baris-PR mencakup tanggal dan jumlah: dua pembayaran sah dengan tanggal+jumlah sama ke target yang sama ditolak `already_posted` (A6 "warn, do not block" diutamakan di tempat lain).

**C. Risiko / perilaku yang perlu diketahui**
1. **Pembacaan thumbnail**: `/api/documents/thumb/[id]` mengandalkan RLS untuk menentukan siapa boleh melihat, tetapi kebijakan `attachments_read` = `true` (semua pengguna login). Metadata & thumbnail semua berkas (termasuk KTP HRD)
   dapat diambil bila id attachment diketahui; hanya **membuka file di Drive** tetap dibatasi keanggotaan drive. Batas data pribadi di drive terjaga; di thumbnail tidak. (Dari kode; belum dites penuh.)
2. VOID tidak memeriksa/melepas kecocokan rekening koran: baris rekening koran bisa tetap `matched/booked` menunjuk transaksi VOID.
3. Seam `post_transaction` tidak menegakkan `is_paying`; hanya layar pembayaran yang menyaring rekening.
4. Entity upload memakai nama kontrak (`po`, `overtime`) sementara enum database `purchase_order`/`overtime_sheet`: `drive_folder_for` akan menolak `unknown_entity` bila suatu layar mengunggah dengan entity itu
   (tidak ada layar yang melakukannya sekarang).
5. Rute **Ronde pembayaran** dan **Dokumen** diparkir (D105): dipertahankan, tidak dikembangkan.
6. `EJO` ditafsirkan sebagai pengeluaran pribadi pemilik (asumsi 0042 menunggu konfirmasi); jenis tanpa tipe dari impor lama masuk `OTHERS`.
7. Alur Chat → Verifikasi dijalankan bot/pipeline John Lau di luar repo ini (`file_evidence`, mirror `ops_inbox`); keandalannya (jadwal 5 menit, `p_sha256`) tidak bisa diverifikasi dari repo.

**D. Hal yang tidak dikonfirmasi bab ini**
- Daftar pemegang authority hari ini (hanya snapshot 2026-09-21 yang ada di repo); aksi John Lau (AI) khusus akuntansi; isi pengaturan produksi `ops.bill_anomaly_percent` selain bawaan 25.



## Bab 3 — Inventory (Persediaan)

Chapter ini adalah bagian dari SOP induk ops.talaliving. Tujuan sistem: setiap proses disatukan dan setiap aktivitas tercatat dari awal sampai akhir, bisa ditelusuri. Untuk Inventory itu berarti: dari barang didaftarkan atau datang, ditaruh di lokasi, keluar ke Job Order, sampai jadi barang jadi dan keluar lewat surat jalan, tidak ada angka yang diketik sebagai "jumlah". Stok selalu **dijumlah dari gerak** (buku gerak bertanda), tidak pernah disimpan (A3, D170).

Dasar chapter ini: kode di `src/app/(app)/inventory/**`, `src/app/l/**`, `src/app/(app)/box/**`, `src/lib/api/inventory.ts`, `src/services/inventory/contracts.ts`, migrasi `0070` sampai `0205`, dan `docs/plan/06-decisions.md`. Keadaan terakhir yang dibaca: commit `cd2aba8` (2026-10-01). Kalau kode dan dokumen lama berbeda, kode dan commit terbaru yang dipakai, dan perbedaannya dicatat di bagian akhir.

### Ketentuan umum Inventory (dibaca sebelum proses mana pun)

**Menu dan layar.** Menu *Inventory* (Persediaan) berisi enam layar. Label menu dalam bahasa Inggris (bahasa bawaan, D318); pengguna bisa mengganti ke Indonesia lewat tombol bahasa di topbar. Isi database ditampilkan apa adanya.

| Menu | Path | Syarat menu muncul |
|---|---|---|
| Timber (Kayu) | `/inventory/log` | `inventory.read` |
| Materials & Hardware (Bahan & hardware) | `/inventory/material` | `inventory.read` |
| Finished Goods (Barang jadi) | `/inventory/produk` | `inventory.read` |
| Stock Adjustments (Opname & penyesuaian) | `/inventory/penyesuaian` | `inventory.adjust` |
| Assets (Aset) | `/inventory/assets` | `inventory.read` |
| Labels (Label) | `/inventory/label` | `inventory.read` |

Tambahan di luar menu Inventory: `/inventory/papan` (hanya mengalihkan ke `/inventory/log`, D202), `/l/[token]` (kartu publik hasil scan QR, tanpa login), `/box/[box]` (kartu peti pengiriman, milik modul Pengiriman), Master Data → Asset categories (`/master-data/asset-categories`), Produksi → Job trail (`/produksi/jejak`).

**Peran dan kewenangan (dari `src/lib/roles.ts` dan `0002_core_identity.sql`).** Akses diberikan per modul dengan tiga tingkat: *Read* (Baca), *Read & edit* (Baca & ubah, nilai `write`), *Full* (Penuh, `admin`). Modul `inventory` menawarkan empat kewenangan akses: `inventory.read`, `inventory.create`, `inventory.update`, `inventory.adjust`. Tidak satu pun yang `admin_only`, jadi:

- tingkat **Baca** = `inventory.read` saja;
- tingkat **Baca & ubah** dan **Penuh** = keempatnya sekaligus (`read`, `create`, `update`, `adjust`). Tidak ada perbedaan kewenangan Inventory antara Baca & ubah dan Penuh;
- **Tidak ada otoritas bernama** (`approve_goods`, `approve_funds`, `approve_overtime`, `post_ledger`, `resolve_inbox`) yang dipakai di Inventory. Tidak ada persetujuan atas selisih opname (Q57 belum diputuskan).

Nama jabatan atau peran (misalnya "staf gudang") tidak didefinisikan di kode; chapter ini memakai istilah **Staf gudang = akun dengan modul Inventory tingkat Baca & ubah**, dan **Pembaca = Inventory tingkat Baca**. Nama orang pada simulasi lama (Dewi, Lina, Andi, Budi, Joko) hanya persona uji, bukan peran.

Pembagian kewenangan yang dipakai database:

| Kewenangan | Dipakai untuk |
|---|---|
| `inventory.read` | Melihat semua layar, riwayat perubahan input, mencetak label, membaca stok dan nilai |
| `inventory.create` | Daftarkan barang (`register_item`); keluar, kembali dan pindah lokasi material; terima kiriman kayu, tambah log, papan hasil gergaji, biaya kayu; papan keluar/kembali; hasil produksi, pindah, jual, retur dan pakai surplus barang jadi; daftarkan aset; menerima/melaporkan kedatangan barang (`create_receipt`, juga bisa oleh `procurement.create`); membaca nota kayu dengan model (`/api/inventory/nota/read`) |
| `inventory.update` | Kelola lokasi; ubah data barang (`update_item_details`, nama lapangan); ubah aset, ubah status, hapus aset keliru, catat servis; kategori aset; lokasi rumah barang jadi; ubah/hapus biaya kayu (policy ada, tidak ada layar) |
| `inventory.adjust` | Input stok; catat hasil hitung (opname); ubah atau hapus input stok; papan `adjust`/`scrap`; barang jadi `scrap` dan hitung (opname); hitungan awal saat daftarkan barang |

Kewenangan modul lain yang menyentuh Inventory: `procurement.update` menandatangani/melengkapi penerimaan dan mencocokkan kiriman Chat; `procurement.update` juga mengatur kategori barang (master data); `accounting.update` memasukkan sewa aset ke kalender pembayaran; `production.create` membuat Job Order dan mencatat progres; `delivery.create` membuat surat jalan dan peti; `it.update` mengatur `drive_paths`; `it.read` membaca Audit Log.

**Format nomor (`ops_core.next_doc_number`, jam kantor WIB, D334).** Dokumen harian: `prefix-YY-MM-DD_NN`, mis. `stk-26-09-28_01`. Nomor tercetak tidak pernah berubah.

| Nomor | Contoh | Dibuat oleh |
|---|---|---|
| Kode barang | `I-00012` (5 digit, deret katalog; bukan dibentuk dari lokasi/kategori, D347) | `register_item` atau katalog procurement |
| Gerak stok material | `stk-26-09-28_01` | tiap baris gerak (satu pindah lokasi = dua nomor) |
| Penerimaan | `rcv-26-09-28_01` | `create_receipt` (procurement) |
| Receiving report dari Chat | `rr-26-10-01_01` | `file_receiving` |
| Gerak papan | `ppn-26-09-28_01` | `move_boards` |
| Kiriman kayu | `kyu-26-09-28_01` | `receive_logs` |
| Biaya kayu | `kyb-26-09-28_01` | biaya angkut/potong/bongkar/lain |
| Gerak barang jadi | `fgm-26-09-28_01` | `move_product` dan kawan-kawan |
| Tag aset | `AST-0001` (4 digit) | `create_asset` |
| Job Order | `jo-26-09-28_01` (JO lama: `spk-…`; keduanya diperiksa) | Produksi |
| Surat jalan / peti | `krm-…` / `kol-…` | Pengiriman |
| Kode lokasi | huruf besar, bebas, mis. `GUDANG`, `BENGKEL`, `FINISHING`, `AREA-A` | Staf gudang |

**Dua kunci yang menyambung rantai** (D312): kode barang (barang apa) dan nomor Job Order (untuk pekerjaan mana). Satu nomor apa pun (proyek, JO, PR, PO, `rcv-`, surat jalan, kode barang) dapat dibuka seluruh ceritanya di Produksi → Job trail (`/produksi/jejak`).

**Aturan folder Drive (CLAUDE.md, D313, D320).** Semua file yang disimpan aplikasi masuk ke folder `ops-talaliving` di root shared drive modulnya, dibuat oleh aplikasi sendiri, dan selalu dalam folder per tugas. Drive dipilih oleh `ops_core.doc_kind_drive` (batas data pribadi), folder tugas oleh `ops_core.drive_paths` (jenis dokumen + record), tanpa baris = nama jenis dokumen dalam huruf besar. Untuk Inventory:

| File | Drive | Folder di bawah `ops-talaliving` |
|---|---|---|
| Foto barang material (kind `Foto`, entity `item`) | PROCUREMENT | `INVENTORY/ITEMS` |
| Foto aset (kind `Foto`, entity `asset`) | PROCUREMENT | `INVENTORY/ASSETS` |
| Foto produk jadi (diunggah dari Produksi → BOM → drawer produk, entity `product`) | PROCUREMENT | `INVENTORY/FINISHED GOODS` |
| Foto barang, receiving report, surat jalan vendor, tanda terima (jenis `goods_photo`, `receiving_report`, `delivery_note`, `surat_jalan`) | PROCUREMENT | `RECEIVING REPORT/<YYYY-MM>/<YYYY-MM-DD>` (hari barang tiba, D360) |
| Nota pembelian aset, nota kayu, nota biaya kayu (kind `Receipt / Invoice / Nota` = `nota`) | ACCOUNTING | `NOTA` (nama jenisnya) selama IT belum menambah baris `drive_paths` ke `TRANSACTIONS/<YYYY-MM>/<YYYY-MM-DD>` (D359). Tidak ada folder tugas Inventory khusus untuk nota kayu |
| Kartu garansi aset (kind `Sertifikat`) | PROCUREMENT | `SERTIFIKAT` (tidak ada baris `drive_paths`; kata aturan "tanpa baris = nama jenis") |

Satu foto/file yang sama (isi byte sama) tidak diunggah dua kali ke drive yang sama (`same_bytes`, D359).

---

### Pengelolaan lokasi (rak dan area)

#### Tujuan
Satu daftar lokasi untuk semua tempat Inventory menyimpan sesuatu: rak material, rak barang jadi, dan tempat aset (perabotan, mesin, kendaraan) (D347). Setiap gerak stok, hitungan, dan aset menunjuk satu kode lokasi.

#### Pemilik / peran & kewenangan
- Mengelola daftar (tambah, ganti nama, nonaktifkan/aktifkan lagi): Staf gudang, kewenangan `inventory.update`. Kartu *Manage locations (Kelola lokasi)* hanya tampil bagi pemegang `inventory.update`.
- Memakai lokasi di formulir: semua yang boleh menulis di layar bersangkutan.
- Pembaca: tidak bisa mengubah; hanya melihat daftar di dropdown.
- Tidak ada otoritas bernama.

#### Prasyarat
- Akun Inventory tingkat Baca & ubah.
- Area sudah disepakati dengan tim lapangan. Prinsip: lokasi yang tidak pernah didatangi tidak pernah dihitung (`0071`); daftar sengaja dijaga pendek (kurasi, bukan kolom bebas).

#### Langkah-langkah
1. Staf gudang → Inventory → *Stock Adjustments* (`/inventory/penyesuaian`) → kartu *Manage locations (Kelola lokasi)*.
2. Isi **Code** (mis. `AREA-A`, huruf besar otomatis, tanpa spasi di depan/belakang) dan **Name** (mis. "Area A — rak amplas"), tekan **Add location (Tambah lokasi)**. Hasil: lokasi baru berstatus `active` (aktif), langsung bisa dipilih di semua dropdown.
3. Ganti nama: tekan **Rename (Ganti nama)** di baris lokasi, ketik nama baru, **Save name (Simpan nama)**. Kode tidak bisa diganti.
4. Berhenti dipakai: tekan **Deactivate (Nonaktifkan)** → status `inactive` (nonaktif). Aktif lagi dengan **Reactivate (Aktifkan lagi)**.
5. Tidak ada tombol hapus.

Yang tercatat: kode, nama, `is_active`. Tidak ada nomor dokumen.

#### Aturan & kontrol
- Kode duplikat ditolak (konflik 409, kunci utama tabel). Kode kosong: `code_required`; nama kosong: `name_required` (pesan di layar bahasa Indonesia).
- Hanya lokasi `active` yang ditawarkan untuk input baru (Input stok, opname, daftarkan barang, hasil produksi barang jadi, pindah lokasi). Lokasi nonaktif tetap terbaca di riwayat dan tetap tampil pada aset yang masih berdiri di sana.
- Lokasi aset dipilih dari daftar ini. Tempat yang belum ada ditolak dengan pesan "Lokasi "…" tidak ada di daftar lokasi. Tambahkan dulu di Inventory → Penyesuaian → Kelola lokasi." (trigger `asset_location_resolve`, `0197`).
- Lokasi tidak bisa dihapus agar riwayat tetap terbaca (A5).
- Seed awal: `GUDANG` (Gudang utama), `BENGKEL` (Rak bengkel), `FINISHING` (Gudang finishing) (`0071`). `0197` menambah satu lokasi untuk tiap tempat yang pernah diketik pada aset (satu tempat = satu lokasi walau huruf besar/kecil berbeda). Per catatan papan README, produksi memegang 13 lokasi sejak 2026-09-30.

#### Jejak data (apa yang terekam)
- Tabel `ops_inv.stock_locations` (`code`, `name`, `is_active`). Penulisan langsung lewat RLS (policy `loc_new`, `loc_edit`), jadi **tidak ada baris Audit Log** untuk penambahan/ganti nama; jejaknya adalah baris tabel itu sendiri.
- Tidak ada dokumen terlampir, tidak ada folder Drive.

#### Serah-terima ke tim lain
- Produksi dan Pengiriman memakai lokasi yang sama untuk barang jadi (lokasi rumah produk, tujuan pindah).
- HRD tidak memakai daftar ini (lokasi absen punya daftar sendiri di `/hrd/absensi/lokasi`).

#### Koreksi & pengecualian
- Salah ketik nama: Rename. Salah ketik kode: tidak bisa diganti; nonaktifkan dan buat kode baru, lalu pindahkan stok (lihat proses *Mengeluarkan, mengembalikan, dan memindah material*).
- Dua nama untuk satu tempat: jangan buat dua lokasi; pakai satu dan nonaktifkan yang lain.

#### Checklist rutin
- Sebelum opname: tinjau daftar; nonaktifkan lokasi yang sudah tidak ada.
- Pastikan setiap aset dan tiap barang jadi berdiri di lokasi yang ada di daftar.

#### Sumber
`src/app/(app)/inventory/penyesuaian/LocationManager.tsx`, `src/lib/api/inventory.ts` (`createStockLocation`, `updateStockLocation`), migrasi `0071`, `0157`, `0197`; D308, D346, D347, F178, Q62.

---

### Kategori barang dan kategori aset

#### Tujuan
Menentukan barang apa yang **dihitung di gudang** (dan karena itu muncul di *Materials & Hardware*, opname, label) dan jenis aset apa yang tersedia.

#### Pemilik / peran & kewenangan
- Kategori barang (pohon dua tingkat, grup lalu jenis): Procurement, `procurement.update` (data master katalog, `0104`). Inventory tidak mengubah pohonnya; pemegang `inventory.update` hanya bisa mengganti kategori sebuah barang (lihat proses *Daftar barang*).
- Kategori aset: Staf gudang, `inventory.update`, di Master Data → *Asset categories* (`/master-data/asset-categories`); menu butuh `inventory.read`, tombol edit butuh `inventory.update`.

#### Prasyarat
Untuk kategori aset: kode 2 sampai 30 karakter huruf kecil, angka, `-` atau `_`.

#### Langkah-langkah
1. Kategori barang: Procurement mengelola di master data barang. Aturan hitung: sebuah jenis di bawah grup yang dihitung otomatis ikut dihitung (`0104`, `0197`). Grup yang dihitung: Production, Sanding, Finishing, Packing, Machining, Office. Grup **tidak dihitung**: Facility, Services (jasa), Not yet curated. Barang di kategori tidak dihitung dibeli dan habis dipakai, tidak pernah tampil di rak.
2. Kategori aset: Staf gudang → Master Data → *Asset categories* → **Add category (Tambah kategori)** → isi Name, Code, "What goes in it" (Isinya), centang Active → **Save (Simpan)**. Hasil: kategori baru dipakai di formulir *Register asset*.
3. Mengubah: klik baris → ubah nama/isi/aktif → Simpan. Kode tidak bisa diubah setelah dibuat.
4. Menghapus: **Delete (Hapus)** hanya jika tidak ada aset di dalamnya; kalau ada, kategori **dipensiunkan** (Active dimatikan), bukan dihapus (tampil `Retired`/`Dipensiunkan`).

Seed kategori aset: `cctv`, `computer`, `printer`, `network`, `phone`, `vehicle`, `tool`, `furniture`, `other`.

#### Aturan & kontrol
- `code_invalid`, `name_required`, `not_permitted` (kategori aset); hapus saat masih dipakai aset ditolak (konflik).
- Kategori default untuk label bahan: *Timber & panels* (`raw-wood`) dan *Metal stock* (`production-metal-stock`) (`ops_inv.label_categories`, `0178`). Bahan habis pakai (mis. amplas) tidak dipilih otomatis di Label tetapi tetap bisa dicetak dengan *All categories*.

#### Jejak data (apa yang terekam)
- `ops_procure.item_categories`, `ops_inv.stocked_categories` (hanya dibaca oleh layar; tidak ada policy tulis, jadi diubah lewat seam procurement atau migrasi).
- `ops_inv.asset_categories` lewat seam `save_asset_category` / `delete_asset_category`: **ada baris Audit Log** (service `inventory`, entity `asset_category`, before/after).

#### Serah-terima ke tim lain
Procurement memelihara pohon kategori barang; Inventory memakainya. Perubahan kategori sebuah barang berdampak ke laporan nilai stok per grup.

#### Koreksi & pengecualian
- Barang salah kategori: ubah dari laci barang (Edit). Kategori tujuan harus yang dihitung, kalau tidak ditolak `not_stocked`.
- Jenis baru yang belum ada di pohon: minta Procurement membuatnya; Inventory tidak punya layar untuk itu.

#### Checklist rutin
Triwulan: tinjau kategori aset yang tidak lagi aktif; tinjau barang di *Not yet curated* yang perlu difilekan.

#### Sumber
`src/app/(app)/master-data/asset-categories/page.tsx`, migrasi `0071`, `0104`, `0107`, `0178`, `0197`; D169, D346, D347.

---

### Daftar barang (mendaftarkan dan merawat data barang)

#### Tujuan
Setiap barang yang ada di rak punya satu kode katalog (`I-xxxxx`), nama katalog (Inggris, sistem), nama lapangan (yang dipakai tim), kategori, satuan, dan **1 sampai 4 foto**. Tidak ada barang kembar.

#### Pemilik / peran & kewenangan
- Daftarkan barang baru: Staf gudang, `inventory.create`. Hitungan awal pada saat daftar: butuh juga `inventory.adjust` (pada Baca & ubah otomatis ada).
- Ubah nama katalog, nama lapangan, kategori, satuan: `inventory.update`.
- Tambah/buang foto: `inventory.update` (strip dokumen di laci barang, hanya tampil bila boleh).
- Pembaca: hanya melihat.

#### Prasyarat
- Foto barang (1 sampai 4), diambil dengan kamera di layar (`capture="environment"`) atau dipilih dari galeri.
- Nama belum ada di katalog (cek dulu lewat *Search items…*).
- Kategori yang dihitung dan satuan yang ada di daftar satuan Procurement.

#### Langkah-langkah
**A. Daftarkan barang baru**
1. Staf gudang → `/inventory/material` → **Register an item (Daftarkan barang)**.
2. Ambil/pilih 1 sampai 4 foto (tombol *Item photo / Foto barang*; "n dari 4 foto").
3. Isi **Catalogue name (system) / Nama katalog (sistem)** (mis. "Sandpaper 240"), **Floor name / Nama lapangan** (mis. "Amplas 240"), **Category / Kategori** (dropdown berkelompok grup lalu jenis), **Unit / Satuan**.
4. Isi **jumlah yang ada** dan **rak** (wajib bagi pemegang `inventory.adjust`). Tombol **Register (Daftarkan)** baru aktif jika foto, nama, kategori, satuan, jumlah dan rak lengkap.
5. Sistem mengunggah foto dulu (`documents.upload`, kind `Foto`, entity `item`), lalu memanggil `register_item`. Hasil: toast "Terdaftar sebagai I-xxxxx"; barang dibuat dengan kode `I-` + 5 digit; foto ditautkan; hitungan awal tercatat sebagai gerak `adjust` dengan alasan "Opname: barang baru didaftarkan, dihitung saat didaftarkan" (bukan "barang masuk").
6. Muncul tawaran "I-xxxxx sudah terdaftar. Cetak labelnya sekarang?" → **Print label (Cetak label)** atau **Later (Nanti)**.

**B. Isi/ubah data barang yang sudah ada**
1. Klik barang di daftar (atau buka dengan `?item=I-xxxxx` dari QR) → laci barang.
2. Di baris *Floor name (Nama lapangan)* tekan **Edit (Ubah)** → ubah nama katalog, nama lapangan, kategori atau satuan → **Save (Simpan)**.
3. Nama lapangan ikut dicari bersama nama katalog; ia bukan barang kedua.

**C. Foto barang**
Di laci barang, bagian *Item photos (1–4)*: tambah foto; untuk mengganti foto terakhir, **tambah penggantinya dulu**, baru buang yang lama.

#### Aturan & kontrol
- `photo_required` (tanpa foto), `too_many_photos` (lebih dari 4), `duplicate_photo`, `name_required`, `no_such_category`, `no_such_uom`, `not_stocked` (kategori tidak dihitung), `counted_invalid` (jumlah ≤ 0), `location_required` (lokasi aktif wajib bila ada hitungan), `not_permitted`.
- `already_catalogued` (409): nama katalog **atau** nama lapangan persis sama dengan barang yang ada (tanpa memperhatikan huruf besar/kecil) → hitung di barang yang sudah ada; jangan buat kembarannya. Nama yang hanya mirip diurus alat gabung di Procurement.
- Foto: batas 4 dijaga trigger database (foto kelima ditolak `check_violation`); foto terakhir tidak bisa dibuang ("harus punya minimal satu foto…").
- Ubah data: `name_taken` (nama dipakai barang lain; yang sama digabung di Procurement), `uom_has_moves` (satuan hanya bisa diganti selama belum ada gerak dalam satuan lain), `already_merged`, `name_required`, `not_stocked` untuk kategori tujuan.
- Nama lama otomatis disimpan di `aka` sehingga pencarian lama tetap menemukan.
- Tombol tidak ganda: kunci idempoten per formulir; tombol dinonaktifkan selama menyimpan.

#### Jejak data (apa yang terekam)
- `ops_procure.items` (`code`, `name`, `name_local`, `category_code`, `base_uom`, `kind = goods`, `is_curated = false`, `created_by`). Barang yang didaftarkan di rak belum "dikurasi" (Procurement bisa menyempurnakan).
- `ops_core.attachment_links` (entity `item`, kind `foto`), file di Drive: PROCUREMENT → `ops-talaliving/INVENTORY/ITEMS`.
- Audit Log (service `inventory`, entity `item`, aksi `register` / `update_details` / `set_local_name`, before/after) dan event outbox `inventory.item.registered`.
- Gerak awal (bila ada hitungan): baris `stk-…` jenis `adjust` dengan `moved_by`.

#### Serah-terima ke tim lain
- Procurement: barang yang sama dibeli lewat PR/PO memakai kode ini. Riwayat pembelian barang terbaca di laci barang (*Purchase transactions*), dan jejak lengkap (katalog, BOM, PR, PO, penerimaan, stok, Job Order) di *Full item history* → Job trail.
- Produksi: BOM menunjuk kode barang ini.
- Accounting: tidak ada serah-terima langsung.

#### Koreksi & pengecualian
- Salah nama/kategori/satuan: Edit (lihat B). Dua barang kembar yang sudah terlanjur dibuat: digabung oleh Procurement (alat gabung `0104`); Inventory tidak punya tombol gabung.
- Barang lama (sekitar 800-an) dari sebelum foto diwajibkan terbaca `no photo yet` (belum ada foto); tambahkan minimal satu foto saat disentuh.
- Pembaca yang melihat barang tanpa foto: lapor ke Staf gudang.

#### Checklist rutin
- Mingguan: kartu ringkas di `/inventory/material` menampilkan "n belum ada foto" dan "Minimum belum ditetapkan"; kurangi angkanya.
- Pastikan setiap barang baru dari lapangan didaftarkan, bukan ditambah sebagai nama lain.

#### Sumber
`src/app/(app)/inventory/material/RegisterItem.tsx`, `ItemDetails.tsx`, `StockDrawer.tsx`; `supabase/migrations/0168_inv_item_register.sql`, `0198_inv_stock_input.sql`; D309, D346, D347, D348; `docs/sop/inventory/sop.html` (bagian 3).

---

### Input stok (stok dimulai dari nol)

#### Tujuan
Mengisi rak dari nol: memilih nama dari katalog, lokasi, dan jumlah yang ada. Daftar *Materials & Hardware* hanya menampilkan barang yang sudah pernah dicatat gerak (D348); katalog (883 nama) menjadi daftar nama, bukan rak.

#### Pemilik / peran & kewenangan
Staf gudang dengan `inventory.adjust`. Tombol *Input stock (Input stok)* tidak tampil bagi Pembaca.

#### Prasyarat
- Barang sudah ada di katalog dan di kategori yang dihitung (kalau belum: daftarkan, proses di atas).
- Lokasi aktif sudah ada.
- Hitungan fisik di rak sudah dilakukan.

#### Langkah-langkah
1. Staf gudang → `/inventory/material` → **Input stock (Input stok)**.
2. Di **Item (Barang)** ketik nama atau kode, pilih dari daftar katalog (tampil nama, nama lapangan, kode, kategori, satuan, dan jumlah yang sudah tercatat). Nama yang belum ada: pilih **New item: "…" (Barang baru)**, formulir *Register an item* terbuka dengan nama itu.
3. Pilih **Location (Lokasi)** aktif; isi **Quantity (Jumlah)** (> 0) dan **Note (Catatan)** bila perlu.
4. **Save entry (Simpan input)**. Hasil: gerak `stk-YY-MM-DD_NN` jenis `adjust`, qty positif, alasan "Input stok — <catatan>"; toast "…: +N, sekarang total M".
5. Form tetap terbuka dengan lokasi yang sama untuk input berikutnya (satu rak = banyak input beruntun).

#### Aturan & kontrol
- `not_permitted` (tanpa `inventory.adjust`), `no_such_item`, `not_stocked` (barang jasa, digabung, diarsipkan, atau kategori tidak dihitung), `location_required` (lokasi harus aktif), `qty_invalid` (jumlah ≤ 0).
- Input **menambah**: jumlah yang sudah tercatat tidak diganti. Untuk membetulkan input lama, ubah di riwayat barang (proses *Mengoreksi atau menghapus input stok*), bukan input ulang.
- Kunci idempoten per entri: ketukan ganda tidak mencatat dua kali.
- Satuan mengikuti satuan dasar barang (tidak diketik).

#### Jejak data (apa yang terekam)
- `ops_inv.stock_moves`: `move_no`, `item_code`, `location`, `kind = adjust`, `qty`, `uom`, `reason`, `moved_by`, `moved_at`. Tidak ada `unit_cost` (input tanpa harga).
- Audit Log (service `inventory`, entity `stock_move`, aksi `input`, after: item/lokasi/jumlah).
- Tidak ada dokumen terlampir pada input (foto opsional, tidak dibangun di layar ini, D348).

#### Serah-terima ke tim lain
- Nilai stok di layar hanya memuat bagian yang masuk dengan harga (dari penerimaan atau input harga). Input stok awal tidak berharga, sehingga ditandai "belum ada harga" (D172). Accounting yang memerlukan nilai persediaan harus tahu bagian ini belum lengkap.
- Procurement memakai stok ini untuk menimbang apakah PR perlu dibuat.

#### Koreksi & pengecualian
Lihat proses *Mengoreksi atau menghapus input stok*. Barang dengan stok minus ditandai merah "minus — perlu dihitung ulang".

#### Checklist rutin
- Selesaikan satu rak penuh dalam satu sesi, lalu cocokkan jumlah per lokasi di laci barang.
- Setelah selesai, buka `/inventory/penyesuaian` untuk memastikan alasan opname terbaca.

#### Sumber
`src/app/(app)/inventory/material/StockInput.tsx`, `page.tsx`; `0198_inv_stock_input.sql` (`input_stock`); D348, F201.

---

### Barang masuk dari penerimaan (stok bertambah karena tanda tangan)

#### Tujuan
Stok material bertambah **hanya** karena penerimaan barang dicatat dan ditandatangani di Procurement (atau barang dicocokkan dari Receiving Report Chat). Gudang tidak mencatat "barang masuk" sendiri, agar tidak dobel.

#### Pemilik / peran & kewenangan
- Mencatat kedatangan (`create_receipt`): `procurement.create` **atau** `inventory.create` (seam). Layar yang dipakai di Procurement (Purchase Tracker → vendor → *Record arrival*) dibuka lewat modul Procurement; apakah akun Inventory-saja bisa membukanya belum diperiksa (lihat Kesenjangan).
- Menandatangani/melengkapi penerimaan yang `REPORTED`: Procurement, `procurement.update` (`confirm_receipt`).
- Mencocokkan kiriman dari Chat ke transaksi atau PO: Procurement, `procurement.update`.
- Stok yang bertambah adalah akibat tanda tangan (trigger `security definer`); Inventory tidak perlu izin tambahan (D310).

#### Prasyarat
- Baris PR atau baris PO yang jelas, dengan barang katalog (langsung di baris PO, atau lewat baris PR yang dibelinya).
- Foto barang yang datang (wajib). Surat jalan vendor (opsional pada saat mencatat).

#### Langkah-langkah
**Jalur 1: penerimaan di Procurement**
1. Procurement/Staf penerima → Procurement → Purchase Tracker → vendor → **Record arrival** → isi jumlah, kondisi, **foto barang** (wajib), dan **surat jalan vendor** (jenis *Delivery Note*).
2. Dengan surat jalan vendor: penerimaan langsung `CONFIRMED` (nomor `rcv-YY-MM-DD_NN`); tanpa surat jalan: `REPORTED` (belum masuk stok).
3. Penerimaan `REPORTED` dilengkapi di `/procurement/penerimaan` (Receiving Report): Procurement memasukkan surat jalan/tanda terima dan, bila setelah dihitung di siang hari jumlah/kondisi berbeda, jumlah dan kondisi **koreksi** (disimpan dalam satu UPDATE bersama status `CONFIRMED`, D363). Stok yang masuk memakai angka koreksi, bukan angka malam.
4. Begitu penerimaan `CONFIRMED`, trigger `stock_from_receipt` membuat gerak `stk-…` jenis `receipt` (qty positif) di **lokasi rumah barang** (`stock_settings.home_location`) atau `GUDANG` bila tidak ada, dengan harga satuan dari baris PO/PR (dikonversi bila satuan beli berbeda), `ref_no = rcv-…`.

**Jalur 2: kiriman dari Google Chat (RECEIVING REPORT)** (D358, D363)
1. Siapa pun mengunggah foto ke space *RECEIVING REPORT* di Google Chat; dalam lima menit masuk ke `/procurement/penerimaan` sebagai baris `rr-YY-MM-DD_NN` berstatus `PENDING` dengan bacaan AI (jenis dokumen, vendor, nomor PO, baris).
2. Procurement membuka baris itu dan memilih salah satu: **cocokkan ke transaksi ledger yang sudah dibayar**, **cocokkan ke PO**, atau **abaikan** (wajib alasan; tidak dihapus).
3. Cocok ke transaksi: tandai file sebagai *Item photo (Foto barang)*, *Receipt / Nota (Kuitansi / Nota)*, atau *Receiving report*; lalu di bagian **Into inventory (Masuk inventory)** tiap baris jadi **Material** (item katalog, jumlah dalam satuannya, rak, harga per unit) atau **Asset** (nama, kategori, jumlah unit 1 sampai 50, harga, merek, lokasi, pemegang). Hasil: material menjadi gerak `receipt` dengan `ref_no = rr-…` dan alasan "Diterima (rr-…), dibayar trx-…"; aset menjadi baris `AST-xxxx` berstatus `in_use`, `ownership = owned`, membawa `trx_no` dan vendor transaksi.
4. Cocok ke PO: jumlah per baris PO + tanda terima → `create_receipt` per baris (CONFIRMED bila ada tanda terima); stok mengikuti trigger yang sama.
5. Foto yang dipakai disalin ke Drive: PROCUREMENT → `ops-talaliving/RECEIVING REPORT/<YYYY-MM>/<YYYY-MM-DD>` (hari foto dikirim ke Chat, D360); link record dipindah ke salinan.

#### Aturan & kontrol
- Tidak masuk stok (event `inventory.receipt.not_stocked`, dengan alasan): kondisi `WRONG ITEM` atau `RETURN TO SENDER`; kategori tidak dihitung; baris tidak menyebut barang katalog (baik di baris PO maupun baris PR); satuan beli tidak bisa dikonversi ke satuan dasar (`uom_conversions`). Kondisi `DAMAGED` dan sejenisnya **tetap masuk**; dipakai atau dikembalikan adalah gerak berikutnya dengan alasan.
- Idempoten: satu penerimaan yang sama tidak menambah stok dua kali (`stock_receipt_once_idx` pada `ref_no` + `item_code`).
- Tanpa backfill: penerimaan yang sudah `CONFIRMED` sebelum `0169` (dan yang bertanda tangan saat dicatat sebelum `0180`) tidak menambah stok; opname menetapkan dasar (Q58).
- Penerimaan `REPORTED` tidak menambah stok sampai ditandatangani.
- Receiving Report Chat, match ke transaksi: `photo_required` (kini boleh nota saja, D363), `not_a_purchase`, `transaction_void`, `item_not_stocked`, `bad_qty`, `item_twice` (barang sama dua kali dalam satu kiriman; jumlahkan), `cost_not_positive` (harga per unit > 0 atau kosong), `location_unknown`, `bad_count` (aset 1 sampai 50), `category_required`, `already_resolved` (409), `file_not_on_report`.
- `confirm_receipt`: `bad_qty` bila jumlah koreksi ≤ 0; `already_confirmed` (409) bila sudah ditandatangani.

#### Jejak data (apa yang terekam)
- `ops_procure.receipts` (nomor `rcv-`, jumlah, kondisi, `received_by`, `confirmed_by`, status) + link dokumen (`goods_photo`, `delivery_note`) → Drive `RECEIVING REPORT/<YYYY-MM>/<YYYY-MM-DD>`.
- `ops_inv.stock_moves` jenis `receipt` (`ref_no = rcv-…` atau `rr-…`, `unit_cost` bila berharga).
- Chat: `ops_procure.receiving_inbox` (`rr-`, `status` `PENDING`/`MATCHED`/`DISMISSED`, `receipt_nos`, `move_nos`, `asset_nos`, siapa dan kapan memutuskan).
- Audit Log (procurement: `create_receipt`, `confirm_receipt` dengan before/after `{qty, condition, status}`; `receiving_inbox` match) dan outbox (`inventory.stock.received`, `inventory.receipt.not_stocked`).

#### Serah-terima ke tim lain
- **Dari Procurement ke Inventory:** hanya lewat tanda tangan penerimaan atau match Chat; Staf gudang tidak memasukkan ulang.
- **Ke Accounting:** transaksi yang dibayar memegang foto barang dan receiving report; aset yang dibuat membawa `trx_no` agar bisa ditelusuri ke ledger.
- **Ke Produksi:** stok yang masuk menggeser status Job Order "Menunggu bahan" menjadi "Material ready" (dihitung saat dibaca, tidak disimpan).

#### Koreksi & pengecualian
- Salah jumlah/kondisi pada penerimaan: dikoreksi **di penerimaannya** di Procurement (`from_receipt`: layar Inventory menolak mengubah atau menghapus gerak `receipt`).
- Barang tidak jadi masuk (WRONG ITEM): catat kondisinya; sistem tidak menaikkan stok.
- Barang yang datang tapi stok tidak naik: periksa (a) status masih `REPORTED`? (b) kondisi? (c) kategori? (d) satuan bisa dikonversi? (e) baris PO punya barang atau baris PR? Daftar penerimaan yang tidak masuk stok bisa dicari di outbox (event `inventory.receipt.not_stocked`) oleh IT.
- Barang masuk di luar penerimaan (hibah, sisa lama, temuan): masuk lewat *Input stok* atau opname, bukan penerimaan.

#### Checklist rutin
- Harian: Procurement membuka `/procurement/penerimaan`, kosongkan antrean `PENDING`.
- Mingguan: bandingkan penerimaan `CONFIRMED` dengan gerak `receipt` untuk barang yang sama.
- Setiap barang masuk: lokasi rumah barang tepat? (lihat *Kesenjangan*: lokasi rumah barang material tidak punya layar pengatur.)

#### Sumber
`supabase/migrations/0169_inv_stock_from_receipt.sql`, `0180_inv_stock_from_signed_receipt.sql`, `0138_procure_receipt_kinds.sql`, `0203_procure_receiving_inbox.sql`, `0204_procure_receiving_archive.sql`, `0205_procure_confirm_receipt_correction.sql`, `0205_procure_receiving_nota_lines.sql`; `src/app/(app)/procurement/penerimaan/MatchDrawer.tsx`; D310, D358, D360, D363, F176, F179, F212, F214, Q58; `docs/sop/inventory/sop.html` (bagian 4).

---

### Mengeluarkan, mengembalikan, dan memindah material

#### Tujuan
Mencatat material yang dibawa ke lantai produksi (untuk Job Order), sisa yang kembali, dan perpindahan antar rak, sehingga stok selalu hasil jumlah gerak dan setiap keluar bisa ditelusuri ke pekerjaan.

#### Pemilik / peran & kewenangan
Staf gudang, `inventory.create` (keluar, kembali, pindah). Halaman Job Order di Produksi memakai `inventory.update` di layar (`mayIssue`) sedangkan seam meminta `inventory.create`; pada Baca & ubah keduanya ada. Pembaca tidak melihat formulir.

#### Prasyarat
- Barang sudah ada di rak (sudah dimasukkan lewat penerimaan atau Input stok).
- Job Order sudah dibuat di Produksi (`jo-…`), bila material untuk produksi.
- Lokasi asal terisi (default: lokasi pertama yang memegang stok barang itu, atau `GUDANG`).

#### Langkah-langkah
**A. Keluar (Issue)**
1. Staf gudang → `/inventory/material` → klik barang → laci barang.
2. Pilih **Issue (Keluarkan)**; isi jumlah, **From location (Dari lokasi)** (kosong = lokasi utama barang), **Job Order number (nomor Job Order)** (kolom "opsional" di layar) dan **What for (Untuk apa)**; tekan **Record (Catat)**.
3. Hasil: gerak `stk-…` jenis `issue`, qty negatif, `ref_no` = nomor JO. Toast "Tercatat"; bila stok jadi minus: toast kuning "Tercatat, tapi stok jadi minus … perlu opname".

**B. Keluar sekaligus dari halaman Job Order**
1. Produksi → Jadwal → buka Job Order → bagian **Material issued to the workshop (Bahan yang keluar ke bengkel)** → **Issue material (Keluarkan bahan)**.
2. Daftar dari BOM hanya usulan: isi jumlah yang benar-benar dibawa, pilih lokasi, tekan **Record issue (Catat keluar)**. Satu panggilan `issue_for_work_order` mencatat satu gerak per barang, semuanya bernomor JO yang sama.

**C. Kembali (Return)**: pilih **Return (Kembalikan)**, jumlah, lokasi dan (opsional) nomor JO → **Record (Catat)** → gerak `return`, qty positif.

**D. Pindah lokasi (Move location)**: pilih **Move location (Pindah lokasi)**, jumlah, **From location**, **To location** → **Record (Catat)** → dua baris gerak `transfer` (keluar dari asal, masuk ke tujuan) yang saling menutup; stok total tidak berubah.

#### Aturan & kontrol
- Keluar: `qty_invalid` (jumlah ≤ 0), `not_stocked` (barang bukan stok, digabung, atau kategori tidak dihitung), `not_permitted`. Keluar lebih banyak dari yang tercatat **tidak ditolak** (A6): tercatat dan ditandai `went_negative`; stok minus tampil merah "negative — needs a recount (minus — perlu dihitung ulang)".
- Nomor Job Order yang diawali `jo-` atau `spk-` **harus ada** (trigger `check_jo_reference`): "Job Order … tidak ada. Periksa nomornya — rantai pembelian-produksi putus di sini." Nomor lain (mis. nomor lembar opname) diterima apa adanya. Gerak keluar langsung dari kartu barang tidak memblokir Job Order yang `CANCELLED`; keluar dari halaman Job Order memblokir (`wo_cancelled`).
- Dari halaman Job Order: `nothing_to_issue` (semua jumlah nol), `not_stocked` (menyebut kode barang), `location_required`, `wo_cancelled`, `not_found`.
- Pindah lokasi: lokasi asal dan tujuan harus berbeda (`same_location`); sistem **tidak memeriksa** saldo asal, jadi pindah melebihi saldo membuat saldo asal minus.
- Kembali: `qty_invalid`, `not_stocked`.
- Keluar: kunci idempoten ada di seam; di layar tombol dinonaktifkan selama menyimpan.
- Reservasi stok per JO tidak ada (D312): dua JO bisa sama-sama "ready" atas stok yang sama.

#### Jejak data (apa yang terekam)
- `ops_inv.stock_moves`: `move_no` (`stk-`), `kind`, `qty` (bertanda), `uom`, `ref_no` (JO), `reason`, `moved_by`, `moved_at`.
- Keluar lewat seam `issue_stock`/`issue_for_work_order`: baris Audit Log (service `inventory`, entity `stock_move`, aksi `issue`). **Kembali dan pindah lokasi ditulis langsung lewat RLS** (tidak ada seam), jadi tidak ada baris Audit Log; barisnya sendiri (nomor, siapa, kapan) adalah jejaknya.
- Laci barang: *Movement history (Riwayat pergerakan)*; JO yang tidak ada ditandai "this Job Order does not exist" (`ref_missing`).
- Tidak ada dokumen terlampir.

#### Serah-terima ke tim lain
- **Ke Produksi:** gerak keluar bernomor JO menjadi bagian "Bahan sudah keluar" pada status material JO dan jejak proyek (Job trail).
- **Dari Produksi:** Job Order dan daftar kebutuhan BOM; PR dari JO membawa `source_wo_no`.
- Nilai keluar tidak dihitung (D172, Q43): gerak keluar tidak punya harga.

#### Koreksi & pengecualian
- Salah catat keluar/kembali: ubah atau hapus dari riwayat (proses *Mengoreksi atau menghapus input stok*).
- Salah catat pindah lokasi: hapus berpasangan dan catat ulang.
- Stok minus: hitung rak dan catat selisih di *Stock Adjustments*; minus berarti ada yang belum tercatat (barang masuk tanpa penerimaan atau hitungan awal belum ada).
- Praktik yang dianjurkan (belum dipaksa sistem): selalu isi nomor JO pada keluar untuk produksi, karena kolomnya opsional dan barang keluar tanpa JO tidak muncul di jejak proyek.

#### Checklist rutin
- Akhir hari: cocokkan keluar hari itu dengan JO yang berjalan.
- Mingguan: daftar barang berstatus minus; hitung dan catat selisih.
- Mingguan: sisa material yang tidak terpakai dikembalikan (`return`), bukan dibiarkan.

#### Sumber
`src/app/(app)/inventory/material/StockDrawer.tsx`; `src/app/(app)/produksi/jadwal/WorkOrderDrawer.tsx`; `0097_inv_issue_stock_seam.sql`, `0130_prod_job_orders.sql` (`issue_for_work_order`), `0171_prod_job_trail.sql`; `src/lib/api/inventory.ts` (`returnStock`, `transferStock`); D170, D266, D312, A6; `docs/sop/inventory/simulasi-log.md` baris 18 sampai 25.

---

### Opname dan penyesuaian stok material

#### Tujuan
Menyamakan catatan dengan isi rak: orang di depan rak mengisi jumlah yang benar-benar ada; sistem menyimpan **selisihnya** terhadap catatan rak itu, dengan alasan.

#### Pemilik / peran & kewenangan
Staf gudang dengan `inventory.adjust`. Menu *Stock Adjustments* hanya muncul bagi pemegang `inventory.adjust`. Pembaca bisa membuka layar lewat alamat langsung dan hanya melihat riwayat penyesuaian; formulir dan Kelola lokasi tidak tampil. **Tidak ada langkah persetujuan** (Q57 belum diputuskan: seberapa sering, siapa menyetujui, apakah foto rak diminta).

#### Prasyarat
- Lokasi sudah ada dan aktif.
- Hitungan fisik **satu rak** sudah selesai (tidak ada hitungan "semua lokasi").
- Sebaiknya tidak ada keluar/masuk saat menghitung (praktik, tidak dipaksa).

#### Langkah-langkah
1. Staf gudang → `/inventory/penyesuaian` → kartu **Record a count (Catat hasil hitung)**.
2. Pilih **barang** dan **lokasi**. Sistem menampilkan "Tercatat di sistem: N" untuk rak itu.
3. Isi **jumlah yang benar-benar ada** (hasil hitung). Layar menampilkan hitungan Anda dan selisih (hijau lebih, merah kurang).
4. Isi **Reason (Alasan)**: kenapa berbeda atau dugaannya.
5. Tekan **Record difference (Catat selisih)**. Hasil: bila selisih nol, toast **Matches (Cocok)** dan **tidak ada yang ditulis**; bila beda, gerak `stk-…` jenis `adjust` dengan qty = selisih bertanda dan alasan Anda; toast "Adjustment recorded / Selisih +N".
6. Riwayat semua penyesuaian ada di bawah kartu (`N adjustments recorded`), dengan peringatan bila hitungan fisik berulang kali lebih sedikit dari catatan.

#### Aturan & kontrol
- Tombol tidak aktif tanpa barang, lokasi dan alasan. Database juga menolak penyesuaian tanpa alasan (`adjust_says_why`).
- Yang disimpan selisih, bukan angka baru (D171): form meminta hitungan, bukan selisih, supaya tidak ada yang mengetik angka yang membuat layar setuju.
- Selisih dihitung terhadap jumlah **lokasi itu** (`stock_moves` untuk barang dan lokasi), bukan total.
- Barang harus dihitung di gudang (`not_stocked` bila tidak). Pemeriksaan ini dilakukan di sisi klien (`stockable`); database tidak memeriksa kategori pada tulis langsung.
- Tidak ada persetujuan atau batas selisih; tidak ada jadwal opname; tidak ada foto rak.

#### Jejak data (apa yang terekam)
- `ops_inv.stock_moves` jenis `adjust` (alasan, `moved_by`, `moved_at`). **Catat hasil hitung ditulis langsung lewat RLS**, tanpa baris Audit Log (berbeda dengan *Input stok*, yang lewat seam dan terekam di Audit Log).
- Perubahan/penghapusan sesudahnya terekam dengan nilai sebelum/sesudah (lihat proses koreksi).
- Tidak ada dokumen terlampir.

#### Serah-terima ke tim lain
- **Ke Accounting:** nilai persediaan dan selisih tidak diposting otomatis ke ledger (tidak ada jurnal selisih persediaan di sistem).
- **Ke Procurement:** barang berulang kali kurang menjadi dasar menimbang pembelian atau pengamanan.
- **Dari Produksi/Pengiriman:** tidak ada.

#### Koreksi & pengecualian
- Salah hitung: ubah atau hapus penyesuaian dari riwayat barang dengan alasan (D348), bukan dengan menambah selisih lawan, meskipun menambah selisih lawan juga sah.
- Konflik dokumen: teks layar `/inventory/penyesuaian` masih berbunyi "Semuanya tetap ada. Penyesuaian yang dihapus adalah penyesuaian yang tidak pernah bisa dijelaskan", padahal sejak D348 penyesuaian bisa dihapus dari riwayat barang (dengan alasan; nilai sebelumnya tersimpan di Audit Log). Perlakukan penghapusan sebagai pengecualian yang bertanggung jawab, dan selalu tulis alasan.
- Untuk papan kayu dan barang jadi opname dilakukan di layar masing-masing.

#### Checklist rutin
- Jadwal opname belum ditetapkan pemilik (Q57); sampai diputuskan, opname dilakukan per rak sebelum Input stok pertama dan setiap kali stok minus muncul.
- Barang yang berulang kali kurang: tandai ke atasan (peringatan layar).

#### Sumber
`src/app/(app)/inventory/penyesuaian/page.tsx`; `src/lib/api/inventory.ts` (`adjustStock`); `0071_inv_stock.sql` (`adjust_says_why`, `moves_new`); D171, D348; Q57; `docs/sop/inventory/sop.html` (bagian 6); `simulasi-log.md` baris 26 sampai 29.

---

### Mengoreksi atau menghapus input stok (riwayat pergerakan)

#### Tujuan
Memperbaiki input yang salah di tempat, tanpa kehilangan jejak: nilai sebelum dan sesudah tersimpan (D348, menggantikan "kesalahan dibetulkan dengan gerak baru" untuk input di layar inventory).

#### Pemilik / peran & kewenangan
Staf gudang dengan `inventory.adjust`. Pembaca dapat membaca bagian *Changes to entries (Perubahan input)*.

#### Prasyarat
Buka barangnya di `/inventory/material` (klik baris atau `?item=I-xxxxx`) → *Movement history (Riwayat pergerakan)*.

#### Langkah-langkah
1. **Ubah:** tekan **Change (Ubah)** pada baris → ubah barang, lokasi, jumlah, alasan atau Job Order → **Save change (Simpan perubahan)**. Hasil: baris yang sama diubah; muncul "diubah <tanggal> oleh <nama>" dan satu baris di *Changes to entries*.
2. **Hapus:** tekan **Delete (Hapus)** → tulis alasan → **Delete entry (Hapus input)**. Hasil: baris hilang dari riwayat; *Changes to entries* memuat baris `deleted` dengan isi baris dan alasan.
3. **Pindah lokasi** (dua baris): tombol Ubah tidak tersedia; **Delete** menghapus **kedua sisi** sekaligus, lalu catat ulang pindahnya.

#### Aturan & kontrol
- Yang bisa **diubah**: `adjust`, `issue`, `return`. Yang bisa **dihapus**: semua kecuali `receipt`.
- Gerak `receipt` ditolak diubah/dihapus: `from_receipt` "koreksi di penerimaannya" di Procurement. `transfer` ditolak diubah: `transfer_pair`.
- `reason_required` untuk hapus; penyesuaian tidak boleh dikosongkan alasannya (`reason_required`); jumlah `adjust` tidak boleh nol (`qty_invalid`; hapus saja); jumlah `issue`/`return` harus > 0.
- Pindah barang ke barang lain: `not_stocked` bila barang tujuan tidak dihitung; lokasi tujuan harus aktif (`location_required`).
- Referensi JO yang diubah wajib menunjuk JO yang ada (trigger `check_jo_reference_edit`).
- `noop` bila tidak ada yang berubah.

#### Jejak data (apa yang terekam)
- `ops_inv.stock_moves.edited_at` dan `edited_by` pada baris yang diubah.
- Audit Log (service `inventory`, entity `stock_move`, aksi `edit` dengan before/after item/lokasi/jumlah/satuan/alasan/ref; aksi `delete` dengan seluruh baris yang dihapus dan alasan). Dibaca dari laci barang lewat `stock_entry_history` (butuh `inventory.read`) dan dari IT → Audit Log (`it.read`).

#### Serah-terima ke tim lain
IT dapat memeriksa semua koreksi di Audit Log bila ada pertanyaan nilai persediaan.

#### Koreksi & pengecualian
- Hapus lalu input ulang kalau perubahan terlalu rumit.
- Koreksi pada penerimaan: lewat Procurement (lihat proses *Barang masuk dari penerimaan*).

#### Checklist rutin
Bulanan: tinjau *Changes to entries* untuk barang bernilai tinggi; pola hapus-ulang berulang adalah tanda pelatihan.

#### Sumber
`src/app/(app)/inventory/material/MoveHistory.tsx`; `0198_inv_stock_input.sql` (`edit_stock_move`, `delete_stock_move`, `stock_entry_history`); D348, F201.

---

### Kayu (1): menerima kiriman log dan papan dari nota

#### Tujuan
Kayu dibeli sebagai log tetapi dipakai sebagai papan; harga di nota bukan harga kayu yang bisa dipakai (D153). Modul ini mencatat kubikasi masuk, papan keluar gergaji, dan biaya per m³ papan.

#### Pemilik / peran & kewenangan
Staf gudang, `inventory.create` (menerima kiriman, `receive_logs`; membaca nota dengan model). Tombol *Enter from a nota (Masukkan dari nota)* terlihat oleh semua pemegang `inventory.read`, tetapi database menolak yang tanpa `inventory.create` (`not_permitted`).

#### Prasyarat
- Nota kayu (foto atau PDF, JPG/PNG/WebP/GIF/PDF sampai 8 MB) atau tempelan teks nota; **atau** pilih mode *No nota* bila nota hilang.
- Vendor sudah ada di daftar vendor Procurement.
- Pembacaan foto butuh model bahasa yang dikonfigurasi IT (`ASSISTANT_LLM_PROVIDER` dan `ASSISTANT_LLM_API_KEY`); bila belum, layar menjawab 501 dan nota ditempel sebagai teks.

#### Langkah-langkah
1. Staf gudang → Inventory → *Timber* (`/inventory/log`) → **Enter from a nota (Masukkan dari nota)**.
2. Pilih mode **Timber nota (Nota kayu)**, unggah foto/PDF atau tempel teks, tekan **Read the nota (Baca notanya)**. Layar menampilkan alasan "Why" dan "Against it", sumber ("dibaca dari foto"/"dibaca dari teks"), dan baris-barisnya (papan: tebal × lebar × panjang dalam mm × lembar; log: Ø cm × panjang cm × batang).
3. Periksa dan **edit** setiap baris (hasil model hanyalah usulan). Bila terbaca "Belum yakin ini nota kayu" dengan baris yang ada, centang konfirmasi bahwa ini memang nota kayu. Nota yang ternyata nota biaya: tekan **Record as a cost nota (Catat sebagai nota biaya)**.
4. Pilih **Vendor**, **tanggal terima**, **Species (Jenis)**, **total nilai kayu** (tanpa biaya angkut/potong; biaya di kertas yang sama diusulkan sebagai baris biaya terpisah).
5. Simpan. Hasil: kiriman `kyu-YY-MM-DD_NN`; tiap batang log sebagai satu baris `log_pieces` (baris "Ø32 × 250, 3 btg" menjadi tiga batang), papan sebagai `sawn_boards` (catatan "Dari nota."), biaya di nota yang sama sebagai `kyb-…`. Foto nota diunggah (kind *Receipt / Invoice / Nota*) dan ditautkan ke kiriman. Toast: "n baris nota masuk sebagai kayu, bukan sebagai transaksi".
6. **Tanpa nota** (mode *No nota*): tambah baris log/papan manual, lalu simpan lewat jalan yang sama. Layar memperingatkan bahwa tidak ada kertas untuk dicocokkan nanti.

#### Aturan & kontrol
- `not_permitted`, vendor tidak ada (`not_found`), `species_required` ("Kayu apa?"), `cost_required` (total nilai harus > 0, karena tanpa nilai tagihan tidak ada harga per m³).
- Nota kayu **dikenali sebelum dibaca** (D200): total satu angka untuk accounting, baris-barisnya papan untuk inventory; tidak pernah menjadi puluhan transaksi ledger.
- Tombol simpan aktif bila: sudah dipahami sebagai nota kayu (atau mode manual), ada baris, vendor dipilih, total > 0, jenis terisi.
- Jenis kubikasi default: bulat (π/4 × d² × p); persegi (d² × p) hanya bila kiriman mencatat cara lain. Keduanya berbeda sekitar 21% (D235 tidak menyediakan pemilih).
- Kunci idempoten pada `receive_logs`.
- Kiriman tidak bisa dihapus (tidak ada policy hapus); layar tidak menyediakan ubah/hapus kiriman.

#### Jejak data (apa yang terekam)
- `ops_inv.log_purchases` (`purchase_no`, `vendor_code`, `trx_no` dan `pr_line_no` opsional, `received_on`, `species`, `total_cost`, `claimed_m3`, `measure`, `created_by`), `log_pieces`, `sawn_boards`.
- Dokumen: nota (`attachment_links` entity `log_purchase`, kind `nota`) → Drive ACCOUNTING `ops-talaliving/NOTA` (kind nota; tidak ada folder tugas kayu).
- Audit Log (service `inventory`, entity `log_purchase`, aksi `receive`) dan outbox `inventory.log_purchase.received`.
- Layar Timber menghitung rendemen (papan ÷ log yang digergaji), harga per m³ log dan per m³/m² papan, tanpa menyimpan angka.

#### Serah-terima ke tim lain
- **Ke Accounting:** total nota kayu adalah satu angka; `trx_no` dan `pr_line_no` pada kiriman opsional (layar belum menyodorkannya, lihat Kesenjangan). Pembayaran vendor dicatat accounting sendiri.
- **Ke Procurement:** perbandingan vendor per jenis kayu (landed cost per m³ papan) menjadi dasar memilih pemasok.

#### Koreksi & pengecualian
- Salah baca nota: koreksi di layar sebelum disimpan. **Sesudah disimpan tidak ada layar koreksi** untuk kiriman, log, papan hasil gergaji, maupun biaya; hubungi IT (policy update ada untuk `inventory.update`, tidak ada layar).
- Nota hilang: mode *No nota*; foto nota dapat dilampirkan kemudian.
- Foto nota gagal terunggah: data tetap tercatat, notanya dilampirkan nanti ("Foto nota tidak tersimpan").

#### Checklist rutin
- Setiap kiriman: nota difoto dan tampak badge `nota` pada kiriman.
- Peringatan "Needs checking (Perlu diperiksa)" pada kiriman diperiksa (selisih ukuran dengan penjual, rendemen di bawah ambang `ops.low_yield_percent`).

#### Sumber
`src/app/(app)/inventory/log/NotaImport.tsx`, `page.tsx`, `src/lib/api/_nota_kayu.ts`, `src/app/api/inventory/nota/read/route.ts`; `0070_inv_timber.sql`, `0095_inv_receive_logs.sql`, `0156_inv_timber_costs.sql`; D153, D200, D201, D235, F53.

---

### Kayu (2): biaya tambahan, pengukuran log, dan laporan gergajian

#### Tujuan
Menambahkan ke kiriman yang sudah ada: nota biaya (angkut, potong, bongkar, lain), batang log yang diukur, dan papan yang keluar dari gergaji, sehingga biaya per m³ papan "sampai di rak" (landed) jujur.

#### Pemilik / peran & kewenangan
Staf gudang, `inventory.create` (tambah biaya, log, papan). Tampilan form hanya muncul bagi pemegang `inventory.adjust` atau `inventory.update` (`mayEdit`).

#### Prasyarat
Kiriman `kyu-…` sudah ada.

#### Langkah-langkah
**A. Nota biaya**
1. *Timber* → **Enter from a nota** → mode **Cost nota (Nota biaya)** → foto/teks nota truk/gergaji → **Read the nota** → pilih kiriman yang dituju (daftar kiriman terbaru), jenis biaya, jumlah, tanggal, pihak yang dibayar → simpan. Atau di drawer kiriman: baris *Costs besides the wood* → pilih jenis, dibayar ke, tanggal, jumlah, tombol **Nota** (foto) → **Cost (Biaya)**.
2. Hasil: baris `kyb-…` (jenis `angkut`, `potong`, `bongkar`, `lain`), terpisah dari harga kayu (nilai kayu tidak diubah).

**B. Ukur log**: drawer kiriman → bagian *Logs (Batang)* → isi Tanda (mis. `A-09`, huruf besar otomatis), Ø cm, Panjang cm → **Log (Batang)**.

**C. Laporkan papan keluar gergaji**: drawer kiriman → bagian *Boards (Papan)* → isi **log** asal (opsional), tebal, lebar, panjang dalam **milimeter**, jumlah lembar, tanggal → **Boards (Papan)**. Melaporkan papan dari sebuah log otomatis menandai log itu sudah digergaji.

#### Aturan & kontrol
- Jumlah biaya > 0 (database: `amount > 0`). Jenis hanya empat.
- Tag log tidak boleh kembar dalam satu kiriman (`tag_used`); log tanpa tag diberi `#N`.
- Papan tanpa log asal sah ("satu hari menggergaji dilaporkan sebagai satu tumpukan"); log yang tidak ditemukan: `log_not_found`.
- Biaya selalu di samping nilai kayu, tidak pernah ditambahkan ke nota kayu.
- Biaya dari nota yang sama dengan nota kayu dicatat sebagai biaya milik kiriman itu (vendor yang sama).
- Rendemen dihitung hanya atas log yang sudah digergaji; kiriman yang belum digergaji tidak ikut harga per m³ papan.

#### Jejak data (apa yang terekam)
`ops_inv.log_costs` (`cost_no`, `purchase_id`, `kind`, `amount`, `incurred_on`, `payee`, `vendor_code`, `trx_no`, `note`, `created_by`), `log_pieces`, `sawn_boards`; nota biaya di `attachment_links` (entity `log_purchase`, kind `nota`) → Drive ACCOUNTING `NOTA`. Penulisan langsung lewat RLS: tidak ada baris Audit Log; jejaknya baris itu sendiri (`created_by`, tanggal).

#### Serah-terima ke tim lain
Accounting: biaya yang dibayar tunai/transfer tetap dicatat di ledger oleh accounting; `trx_no` pada biaya adalah tautan opsional (layar belum menyodorkannya).

#### Koreksi & pengecualian
Tidak ada layar mengubah/menghapus biaya, log, atau papan hasil gergaji. Salah ukur log: tidak ada tombol "ukur ulang" (`pieces_edit` ada di database; belum ada layar). Salah jumlah papan: papan hasil gergaji tidak bisa dikurangi; catat penyesuaian opname atau scrap di stok papan (proses berikut).

#### Checklist rutin
Setiap kiriman: semua log terukur dan semua papan keluar gergaji dilaporkan sampai kolom "belum digergaji" nol.

#### Sumber
`src/app/(app)/inventory/log/LogPurchaseDrawer.tsx`, `NotaImport.tsx`; `0070`, `0156`; D153, D204; `simulasi-log.md` baris 50 sampai 51.

---

### Kayu (3): stok papan, pemakaian, rekap bulanan, dan banding vendor

#### Tujuan
Stok papan = jumlah hasil gergaji ditambah semua gerak sesudahnya, dibaca per jenis dan ukuran (D203). Pemakaian papan tercatat dengan pekerjaannya.

#### Pemilik / peran & kewenangan
- Keluar (`issue`) dan kembali (`return`): `inventory.create`.
- Penyesuaian opname (`adjust`) dan rusak/terbuang (`scrap`): `inventory.adjust`; tombol *Opname adjustment* nonaktif tanpa izin itu.
- Membaca tab dan rekap: `inventory.read`.

#### Prasyarat
Papan sudah dilaporkan keluar gergaji (stok papan hanya naik karena laporan gergajian; tidak ada tombol "tambah papan").

#### Langkah-langkah
1. Staf gudang → `/inventory/log` → tab **Board stock (Stok papan)**: daftar jenis·ukuran, di rak, digergaji, dipakai, m³, Rp/m³, nilai.
2. Tekan **Record (Catat)** pada tumpukan → pilih **Used (Dipakai)**, **Returned (Dikembalikan)**, **Damaged / scrapped (Rusak / terbuang)** atau **Opname adjustment (Penyesuaian opname)**.
3. Isi jumlah lembar; untuk Dipakai isi **For the job (Job Order)** (mis. `jo-26-09-…`); untuk adjust/scrap isi **Reason (Alasan)**; **From which load (Dari kiriman mana)** (`kyu-…`) kosongkan bila tumpukan campur → **Record (Catat)**.
4. Hasil: gerak `ppn-YY-MM-DD_NN` (keluar dan scrap negatif, kembali positif, adjust bertanda).
5. Tab **Usage (Pemakaian)**: satu lini waktu, hasil gergaji (dihitung dari laporan gergajian) dan semua gerak; tab **Purchases & kubikasi (Pembelian & kubikasi)**: rekap bulanan (*Monthly recap*, tanpa harga per m³) dan tabel *Per vendor* (urutan Rp/m³ papan sampai rak, per jenis kayu), daftar kiriman.

#### Aturan & kontrol
- **Satu-satunya blokir keras di modul ini (D205):** keluar atau scrap melebihi isi rak ditolak (`not_enough_boards`: "Di rak ada N lembar … Kalau fisiknya memang ada, catat sebagai penyesuaian opname dengan alasannya"). Berbeda dengan stok material yang hanya menandai minus.
- `ref_required` ("Dipakai untuk pekerjaan yang mana?") bila Dipakai tanpa Job Order; `reason_required` untuk adjust dan scrap; `qty_required`; `not_found` bila ukuran atau kiriman tidak ada.
- Nomor Job Order pada papan hanya diperiksa tidak kosong; **tidak diperiksa keberadaannya** (beda dengan material).
- Nilai: dari harga per m³ papan kiriman asalnya; bila kiriman tidak disebut, memakai harga **termahal** jenis itu, ditandai `±` (D232); bila jenis tidak pernah berharga, nilai dibiarkan kosong, jumlah tetap pasti (D204).
- Perbandingan antar vendor hanya dalam satu jenis kayu (D153).

#### Jejak data (apa yang terekam)
`ops_inv.board_moves` (`move_no`, `species`, `thickness_mm`, `width_mm`, `length_mm`, `qty`, `kind`, `purchase_id`, `ref_no`, `reason`, `moved_by`, `at`) lewat seam `move_boards` (**ada baris Audit Log**, entity `board_move`, aksi sesuai kind). Tidak ada dokumen terlampir.

#### Serah-terima ke tim lain
Produksi: papan keluar bernomor JO menjadi bahan JO (nilai estimasi, ditandai bila dari harga termahal). Accounting: nilai rak papan terbaca di layar (tidak diposting).

#### Koreksi & pengecualian
Tidak ada ubah/hapus gerak papan: salah keluar dikoreksi dengan **Returned**; salah hitung dengan **Opname adjustment** beralasan.

#### Checklist rutin
Mingguan: cocokkan tumpukan fisik dengan *Board stock*; selisih dicatat sebagai adjust beralasan. Bulanan: tinjau *Monthly recap* dan tabel *Per vendor*.

#### Sumber
`src/app/(app)/inventory/log/BoardStock.tsx`, `BoardUsage.tsx`, `TimberMonthRecap.tsx`, `page.tsx`; `0094_inv_board_rack.sql`, `0157_inv_locations_and_timber_recap.sql`; D202, D203, D204, D205, D232; `simulasi-log.md` baris 52 sampai 53.

---

### Barang jadi (finished goods): dari Job Order sampai siap kirim

#### Tujuan
Barang jadi punya rak sendiri, per produk dan per baris pesanan klien (satu *batch* = satu produk untuk satu baris pesanan, atau stok tanpa pesanan). Kelebihan produksi dan surplus dihitung, tidak disimpan (D311).

#### Pemilik / peran & kewenangan
- Catat gerak (hasil produksi, pindah lokasi, pakai untuk pesanan lain, jual lepas, retur dari klien): Staf gudang, `inventory.create`.
- Rusak/afkir dan hitung (opname): `inventory.adjust` (tombolnya tidak muncul tanpa izin itu).
- Lokasi rumah produk: `inventory.update`.
- Pembaca: hanya membaca. Pengiriman tidak mencatat di sini (D53).

#### Prasyarat
- Job Order produk itu ada dan tidak dibatalkan; progres produksi dicatat Produksi (`/produksi/progress`).
- Lokasi aktif.
- Produk ada di katalog produk Produksi (kode `PRD-…`).

#### Langkah-langkah
1. Staf gudang → `/inventory/produk` → **Record a finished-goods move (Catat gerak barang jadi)**.
2. Pilih jenis, lalu isi:
   - **Production output (Hasil produksi):** pilih **Job Order**, lokasi, jumlah → **Save (Simpan)**. Pesanan klien (baris pesanan) **diambil dari JO**, tidak diketik. Hasil: `fgm-YY-MM-DD_NN` jenis `produced`.
   - **Move location (Pindah lokasi):** produk, batch/pesanan, dari lokasi, ke lokasi, jumlah. Hasil: dua gerak `transfer` (kedua dengan kaitan nomor).
   - **Use for another order (Pakai untuk pesanan lain):** produk, batch asal, pesanan tujuan, lokasi, jumlah, alasan; hanya **surplus** yang boleh pindah.
   - **Sold outright (Dijual lepas):** surplus dijual di luar proyek; tulis pembelinya (alasan wajib).
   - **Damaged / scrapped (Rusak / afkir):** alasan wajib.
   - **Returned by client (Retur dari klien):** alasan wajib (mis. "dari mana kembalinya").
   - **Count (opname) (Hitung (opname)):** isi jumlah di rak, alasan selisih.
   - **Home location (Lokasi rumah):** rak biasa produk ini; surat jalan mengambil dari sini (kosong = `GUDANG`).
3. Pada layar: kartu ringkas *In the warehouse*, *Awaiting delivery*, *Overproduction*, *Free surplus*; klik baris batch untuk *This batch's history*.

#### Aturan & kontrol
- Hasil produksi: `wo_required` (JO tidak ada atau kosong), `wo_cancelled`, `wo_other_product` (JO membuat produk lain), `qty_invalid`, `no_such_location`, `not_permitted`.
- Pindah, jual, afkir **ditolak melebihi saldo batch di lokasi itu** (`insufficient`, 409), berbeda dengan stok material; hitung (opname) memperbaiki dasarnya.
- `reason_required` untuk jual, afkir, retur, pakai pesanan lain, dan opname dengan selisih; `line_other_product`, `same_line`.
- Opname barang jadi: selisih nol tidak menulis apa pun; selisih beralasan menulis `adjust`.
- Pakai surplus: hanya yang melebihi kewajiban kirim batch asal dan ada di lokasi itu (`insufficient`, 409 dengan angka surplus).
- Hasil produksi **tidak otomatis** dari progres Produksi: Staf gudang harus mencatatnya di sini (Produksi mencatat progres; Gudang mencatat masuk rak).
- Kunci idempoten per gerak (ketukan ganda aman).

#### Jejak data (apa yang terekam)
- `ops_inv.product_moves` (`fgm-`, `product_code`, `location`, `kind`, `qty`, `wo_no`, `project_line_id`, `ref_no`, `reason`, `moved_by`) dan `product_settings` (lokasi rumah).
- `shipped` tidak disimpan: dibaca dari `ops_dlv.delivery_lines` yang tidak dibatalkan, hanya untuk baris pesanan yang sudah punya catatan barang jadi dan surat jalan yang dibuat sejak catatan pertama.
- Audit Log (service `inventory`, entity `product`, aksi `move` / `count` / `allocate` / `set_home`) dan outbox (`inventory.product.moved`, `.counted`, `.allocated`).
- Foto produk: diunggah dari Produksi (drawer produk) → Drive PROCUREMENT `ops-talaliving/INVENTORY/FINISHED GOODS`.

#### Serah-terima ke tim lain
- **Dari Produksi:** JO dan progres tahap terakhir; produk dengan baris pesanan klien.
- **Ke Pengiriman:** "Siap kirim" di Projects → Delivery dihitung dari **progres JO tahap terakhir**, bukan dari rak barang jadi (lihat proses *Surat jalan*).
- **Ke Marketing/Penjualan:** surplus yang dijual lepas (`sold`) hanya mencatat alasan/pembeli, tidak ada pesanan penjualan.

#### Koreksi & pengecualian
Tidak ada ubah/hapus gerak barang jadi (tidak ada layar). Salah hasil produksi: catat opname (Hitung) beralasan; barang rusak: Rusak/afkir.

#### Checklist rutin
- Setiap JO selesai: catat hasil produksi di hari yang sama.
- Sebelum surat jalan dibuat: pindahkan barang ke lokasi rumah produk (lihat F177).
- Mingguan: hitung (opname) rak barang jadi; periksa "Needs a recount" (batch bersaldo minus).

#### Sumber
`src/app/(app)/inventory/produk/page.tsx`, `ProductMoveForm.tsx`, `batch.ts`; `0170_inv_finished_goods.sql`; D53, D311, D313; F177; Q59; `simulasi-log.md` baris 30 sampai 42.

---

### Surat jalan: barang jadi keluar gudang

#### Tujuan
Mencatat apa yang meninggalkan gudang untuk klien tanpa dua kali mengetik: rak barang jadi **membaca** surat jalan, Gudang tidak mencatat pengiriman lagi.

#### Pemilik / peran & kewenangan
- Membuat surat jalan dan peti: Tim pengiriman, `delivery.create` (Projects → Delivery `/proyek/pengiriman`, Peti `/proyek/peti`).
- Mencatat tiba di lokasi/dan scan peti: `delivery.update`.
- Inventory: hanya membaca efeknya di rak barang jadi (`inventory.read`).

#### Prasyarat
Barang jadi sudah **selesai menurut progres JO** dan (praktik wajib sampai Q59 diputuskan) sudah dipindahkan ke **lokasi rumah produk**.

#### Langkah-langkah
1. Pengiriman → Projects → *Delivery (Pengiriman)* → kartu *Ready to ship (Siap kirim)* → **Create delivery note (Buat surat jalan)** pada proyek → isi jumlah per baris, sopir, kendaraan → **Dispatch (Berangkatkan)**. Hasil: surat jalan `krm-YY-MM-DD_NN` berstatus `IN_TRANSIT`; status lain: `DRAFT`, `ARRIVED`, `CANCELLED`.
2. Peti yang ikut diberi QR `/box/<nomor peti>` (`kol-…`); scan di lokasi: **Arrived on site (Sampai di site)**, **Installed (Terpasang)**, **There is a problem (Ada masalah)** (alasan wajib). Status peti: `PACKED`, `IN_TRANSIT`, `ON_SITE`, `INSTALLED`, `PROBLEM`.
3. Di lokasi: **Record arrival (Catat sampai)** dengan nama penerima dan foto surat jalan bertanda tangan (*Surat Jalan Keluar*) → `ARRIVED`.
4. Staf gudang membaca rak di `/inventory/produk`: kolom *Shipped (Dikirim)* berkurang menurut surat jalan.

#### Aturan & kontrol
- Surat jalan lebih banyak dari yang selesai ditolak: `not_enough_made` (409). "Siap kirim" dihitung dari progres JO, bukan dari rak barang jadi; bila rak penuh tetapi progres belum dicatat sampai tahap terakhir, minta Produksi mencatatnya.
- Surat jalan mengurangi rak dari **lokasi rumah produk, else `GUDANG`** (D311, Q59). Bila barang berada di rak lain, lokasi rumah menjadi minus dan rak asal tetap penuh (F177, B20). Aturan sementara: pindahkan barang jadi ke lokasi rumah **sebelum** surat jalan dibuat, atau atur lokasi rumah ke rak tempat barang disimpan.
- Surat jalan `CANCELLED` tidak dihitung.

#### Jejak data (apa yang terekam)
Seam Pengiriman (`ops_dlv.create_delivery` dan kawan-kawan) menulis Audit Log dan dokumen bukti (*Surat Jalan Keluar*, *Foto Lokasi*). Di Inventory, `product_ledger` menurunkan baris `shipped` (nomor = nomor surat jalan) tanpa menyimpannya.

#### Serah-terima ke tim lain
Gudang ke Pengiriman: barang di lokasi rumah, progres JO lengkap. Pengiriman ke Proyek: BAST (di chapter Pengiriman/Proyek).

#### Koreksi & pengecualian
Surat jalan salah: dibatalkan di Pengiriman dengan alasan (`CANCELLED`); rak barang jadi mengikuti otomatis. Batch minus: opname barang jadi.

#### Checklist rutin
Sebelum Dispatch: lokasi rumah benar; sesudah Dispatch: batch tidak minus.

#### Sumber
`src/app/(app)/proyek/pengiriman/page.tsx`, `src/app/(app)/box/[box]/page.tsx`, `0132_dlv_delivery.sql`, `0170_inv_finished_goods.sql`; F177, Q59; `simulasi-log.md` baris 35 sampai 37; `walk-12-surat-jalan.jpg`.

---

### Aset: mendaftar, mengubah, dan melepas

#### Tujuan
Mencatat apa yang dimiliki dan dipakai perusahaan (bukan dijual atau dihabiskan): CCTV, PC, kendaraan, perkakas, perabotan, mesin, dan barang sewa/leasing/pinjam, satu per satu dengan tag stiker, lokasi, pemegang, status dan dokumen. Aset tidak punya stok dan tidak pernah dikeluarkan ke Job Order.

#### Pemilik / peran & kewenangan
- Daftarkan aset: Staf gudang, `inventory.create`.
- Ubah aset, ubah status, hapus entri keliru, catat servis: `inventory.update`.
- Aset juga dibuat oleh Procurement lewat pencocokan Receiving Report Chat (`procurement.update`, D358).
- Pembaca: hanya membaca.

#### Prasyarat
Kategori aset yang tepat ada (Master Data → Asset categories); lokasi dari daftar lokasi; kode pemasok bila diisi harus ada di vendor; baris ledger bila diisi harus ada.

#### Langkah-langkah
**A. Daftarkan**
1. Staf gudang → Inventory → *Assets* (`/inventory/assets`) → **Register asset (Daftarkan aset)**.
2. Isi **Name (Nama)**, **Category (Kategori)**, **Ownership (Kepemilikan)** (`owned` Milik sendiri, `rented` Sewa, `leased` Leasing, `borrowed` Pinjam), **Serial no. / plate**, **Brand**, **Model**, **Location (Lokasi)** (dropdown; tidak ada? "Add it under Manage locations"), **Held by (Dipegang oleh)** (saran dari daftar karyawan HR; teks bebas karena sopir pickup sewaan belum tentu karyawan), tanggal dan harga perolehan, kode pemasok, baris ledger (`trx-…`), garansi sampai, catatan.
3. **Save (Simpan)**. Hasil: tag `AST-0001`, status `in_use`.
4. Di drawer aset (klik baris): unggah **Photo (Foto)**, **Purchase nota / invoice (Nota pembelian)** (opsional), **Warranty card (Kartu garansi)** (opsional).

**B. Ubah dan ganti status**
1. Drawer → **Edit (Ubah)**; atau **Change status… (Ubah status…)** pilih: `in_use` (Dipakai), `in_storage` (Disimpan), `under_repair` (Sedang diperbaiki), `disposed` (Dilepas), `lost` (Hilang), `returned` (Dikembalikan; hanya aset sewa/leasing/pinjam).
2. Untuk `disposed` dan `lost`: tulis catatan (bagaimana keluar). Hasil: status baru, `ended_on` terisi bila keluar dari daftar (disposed/lost/returned).
3. **Delete (Hapus)** (di formulir ubah) hanya untuk entri yang dibuat keliru.

#### Aturan & kontrol
- Buat: `name_required`, `category_required`, `category_unknown`, `vendor_unknown`, `trx_unknown`, `status_invalid` (aset baru bukan `disposed`/`lost`/`returned`), `cost_negative`, `not_permitted`.
- Lokasi: harus kode atau nama yang ada di daftar lokasi.
- Status: `note_required` untuk `disposed`/`lost`; `status_invalid` bila aset milik sendiri ditandai `returned` ("Only a rented, leased or borrowed asset is returned. An owned one is disposed of."); `noop` bila status sama; `ownership_returned` bila aset berstatus `returned` diubah jadi `owned`.
- Hapus: `asset_has_documents` (konflik) bila sudah ada dokumen; tandai `disposed` agar catatan tetap.
- Daftar default tidak menampilkan yang sudah keluar; centang *Show disposed, lost & returned*.
- Tanda di daftar: *warranty expired (garansi habis)*, *contract ends / contract ended*, *service due (jatuh tempo servis)*.

#### Jejak data (apa yang terekam)
- `ops_inv.assets` (`asset_no`, nama, kategori, merek/model, `identifier`, `location`, `holder`, `status`, `acquired_on`, `purchase_cost`, `vendor_code`, `trx_no`, `warranty_until`, `ownership` dan data sewa, `ended_on`, `created_by`).
- **Audit Log lengkap** (service `inventory`, entity `asset`, aksi `create`/`update`/`status`/`delete`) dan ditampilkan di drawer sebagai *History (Riwayat)* dengan pelaku, waktu, alasan, before/after.
- Dokumen: `attachment_links` entity `asset`: Foto → Drive `INVENTORY/ASSETS`; nota → ACCOUNTING `NOTA`; garansi → PROCUREMENT `SERTIFIKAT`.
- Aset dari Chat: `notes` berisi "Dari laporan penerimaan rr-…", membawa `trx_no` dan vendor transaksi, foto pertama sebagai foto aset.

#### Serah-terima ke tim lain
- **Dari Procurement/Accounting:** `trx_no` dan kode pemasok menautkan aset ke pembayaran.
- **HRD:** pemegang aset (nama) tidak tertaut ke karyawan secara teknis (teks bebas).
- **Ke Accounting:** untuk sewa, lihat proses *Aset sewa*.

#### Koreksi & pengecualian
- Salah data: Edit. Salah entri sama sekali: Delete (selama belum ada dokumen).
- Aset yang pindah tempat: ubah Lokasi lewat Edit (tidak ada riwayat pindah selain Audit Log aset).
- Aset yang dijual ke staf, dibuang, dicuri: `disposed`/`lost` dengan catatan.

#### Checklist rutin
- Bulanan: tinjau tanda *warranty expired* dan *service due*.
- Saat opname aset (tidak ada alat opname aset di sistem, lihat Kesenjangan): cocokkan tag stiker dengan daftar.

#### Sumber
`src/app/(app)/inventory/assets/page.tsx`; `0107_inv_assets.sql`, `0115_inv_asset_returned.sql`, `0116_inv_asset_rental.sql`, `0197_inv_categories_and_locations.sql`, `0203_procure_receiving_inbox.sql`; D321, D346, D347, D358; `simulasi-log.md` baris 43 sampai 49.

---

### Aset: servis dan perbaikan

#### Tujuan
Mencatat pekerjaan pada sebuah aset (servis, perbaikan, inspeksi) dan kapan berikutnya jatuh tempo.

#### Pemilik / peran & kewenangan
`inventory.update` (Staf gudang). Pembaca melihat daftar servis.

#### Prasyarat
Aset sudah terdaftar. Tanggal pekerjaan tidak di masa depan.

#### Langkah-langkah
1. Drawer aset → bagian *Service & repairs (Servis & perbaikan)* → **Log a service (Catat servis)**.
2. Isi **Done on (Dikerjakan pada)**, **Kind (Jenis)** (`service` Servis, `repair` Perbaikan, `inspection` Inspeksi, `other` Lainnya; bawaan Perbaikan bila aset `under_repair`), **What was done**, **Cost**, **Next due (jika berulang)**, **Done by (kode pemasok)**, **Ledger row (trx-…)** → **Save (Simpan)**.
3. Hasil: baris servis; badge *next due* di drawer; tanda *service due (jatuh tempo servis)* di daftar bila jatuh tempo dalam 14 hari.

#### Aturan & kontrol
`date_required`, `date_in_future` ("Put a future date in next due"), `description_required`, `kind_invalid`, `cost_negative`; `next_due` harus setelah tanggal pekerjaan (`next_after_this`). Hapus baris servis (ikon sampah) hanya untuk entri keliru dan meminta konfirmasi; alasan otomatis "Entered by mistake".

#### Jejak data (apa yang terekam)
`ops_inv.asset_services` dibaca lewat `v_asset_service` (tanggal, jenis, uraian, pemasok, biaya, `trx_no`, `next_due`, `recorded_by`, `recorded_at`); Audit Log (aksi `service`, `service_delete`).

#### Serah-terima ke tim lain
Biaya servis yang dibayar dicatat accounting di ledger; `trx_no` menautkan.

#### Koreksi & pengecualian
Entri keliru dihapus (dengan jejak Audit Log); salah isi lain: hapus dan catat ulang (tidak ada edit baris servis).

#### Checklist rutin
Mingguan: aset dengan *service due*.

#### Sumber
`src/app/(app)/inventory/assets/ServiceLog.tsx`; `0121_inv_asset_services.sql`.

---

### Aset sewa, leasing, dan pinjam (kontrak, kalender pembayaran, dikembalikan)

#### Tujuan
Aset yang bukan milik sendiri berakhir dengan **dikembalikan** (`returned`), bukan dilepas. Sewanya masuk kalender pembayaran sehingga tidak terlupa.

#### Pemilik / peran & kewenangan
- Mendaftarkan dan mengubah data sewa/kontrak: `inventory.create` / `inventory.update`.
- Memasukkan sewa ke kalender pembayaran: **Accounting**, `accounting.update` (tombol *Create payment schedule (Buat jadwal pembayaran)*). Tanpa izin itu layar mengatakan "Accounting yang memasukkannya."

#### Prasyarat
Aset berkepemilikan `rented`, `leased` atau `borrowed`; untuk jadwal: **Rent (Sewa)** dan **Paid (Dibayar)** terisi, **Contract start (Awal kontrak)** terisi; sewa tahunan butuh **Contract end**.

#### Langkah-langkah
1. Daftarkan aset dengan Ownership bukan `owned`; bagian **Rent & contract (Sewa & kontrak)** muncul: Rent, Paid (`monthly` per bulan, `yearly` per tahun, `upfront` sekali di muka), Contract start, Contract end, Due on day (untuk bulanan, 1 sampai 31; kosong = hari awal kontrak). Kode pemasok adalah pihak yang menyewakan/meminjamkan.
2. Accounting → drawer aset → *Rent on the payment calendar (Sewa di kalender pembayaran)* → pilih **Paid from (Dibayar dari)** dan **Transaction type** → **Schedule (Jadwalkan)**. Hasil: bulanan = satu baris bulanan dari bulan awal kontrak; tahunan = satu baris tiap ulang tahun kontrak (maks sepuluh); `upfront` = satu baris di tanggal awal kontrak; jumlah tetap, diubah di kalender sesudahnya.
3. Saat kontrak berakhir (30 hari sebelumnya muncul *contract ends*; sesudahnya *contract ended — still here*): ubah status ke **Returned (Dikembalikan)** dengan catatan (mis. "diambil pihak yang menyewakan").

#### Aturan & kontrol
- Aset milik sendiri tidak boleh membawa sewa/kontrak: `rent_on_owned` ("clear them, or change who owns it"). `ownership_invalid`, `rent_negative`, `period_invalid`, `period_required`, `due_day_invalid`, `contract_dates` (kontrak berakhir sebelum mulai).
- Jadwal sewa: `not_rented`, `rent_missing`, `contract_start_required`, `contract_end_required`, `asset_gone` (aset sudah `disposed`/`lost`/`returned`), `already_scheduled` ("Change it there"), `no_such_type`, `not_permitted`.
- Pembayaran sewa lampau di bulan berjalan ke belakang tidak dibuat (sudah dibayar atau terlewat sebelum kalender tahu; ledger yang memegangnya).

#### Jejak data (apa yang terekam)
Kolom sewa/kontrak pada `ops_inv.assets`; baris kalender di `ops_acct.cash_components` bersumber `asset:AST-xxxx`; Audit Log kedua sisi (service `inventory` untuk aset, `accounting` untuk jadwal).

#### Serah-terima ke tim lain
**Inventory ke Accounting:** data sewa dan kontrak; Accounting menjadwalkan dan membayar. **Kembalinya aset:** Inventory mengubah status; Accounting menghentikan sewa di kalender secara manual (tidak ada pemutus otomatis; lihat Kesenjangan).

#### Koreksi & pengecualian
Sewa berubah: ubah di kalender pembayaran (bukan di aset) setelah dijadwalkan. Kontrak diperpanjang: ubah Contract end di aset, dan sesuaikan kalender.

#### Checklist rutin
Bulanan: tinjau kartu *Rented, leased, borrowed* dan kontrak yang akan/sudah berakhir.

#### Sumber
`src/app/(app)/inventory/assets/RentSchedule.tsx`, `page.tsx`; `0115`, `0116`; D321 (label membawa tanggal akhir kontrak).

---

### Label dan QR (barang, aset, barang jadi) serta kartu `/l/[token]`

#### Tujuan
Mencetak label stiker (kode, nama, lokasi, tanggal didaftarkan, QR) untuk apa yang baru dicatat. QR membuka kartu singkat **tanpa login**.

#### Pemilik / peran & kewenangan
Mencetak: siapa pun dengan `inventory.read` (Pembaca boleh mencetak). Membuka kartu publik: siapa pun yang memegang label (token acak). Membuka catatan lengkap lewat tautan kartu: staf yang sudah login. Menu *Labels* butuh `inventory.read`. Peti pengiriman (`/box/[box]`) di dalam aplikasi, di balik login, milik Pengiriman.

#### Prasyarat
Barang/aset/produk sudah didaftarkan (yang dilabel adalah yang tercatat). Printer A4 dengan stiker 8, 21 atau 40 per lembar, atau kertas biasa.

#### Langkah-langkah
1. Inventory → *Labels* (`/inventory/label`), atau tombol **Print labels (Cetak label)** dari layar Bahan, Aset, atau Barang jadi, atau tawaran *Print label* tepat setelah barang didaftarkan (membuka halaman dengan `?codes=`).
2. Pilih jenis: **Materials (Bahan)**, **Assets (Aset)**, **Finished goods (Barang jadi)**.
3. Filter **Registered since (Didaftarkan sejak)** (bawaan 7 hari terakhir; kosong bila membuka dengan `?codes=`), cari kode/nama, centang **All categories (incl. consumables)** untuk bahan habis pakai. Daftar menyorot semua yang tampil; hilangkan centang yang tidak perlu.
4. Panel *Sheet (Lembar)*: **Sticker sheet (A4)** 8 per lembar (99 × 68 mm), 21 per lembar (63,5 × 38 mm, bawaan), 40 per lembar (45,7 × 25,4 mm); **Copies of each (Salinan per label)** (1 sampai 100, mis. satu per papan dalam tumpukan); **Start at position (Mulai di posisi)** untuk lembar yang sudah terpakai sebagian; **Location on the label (Lokasi di label)** (bawaan: tempat stok tercatat); **Cut lines (Garis potong)** (nyalakan untuk kertas biasa, matikan untuk stiker yang sudah terpotong); **QR code** nyala/mati.
5. **Print n labels (Cetak n label)**. Cetak pada 100%, A4, tanpa margin (tanpa "fit to page"). Tidak ada pratinjau di layar (permintaan pemilik, 2026-09-28).
6. Pemindai QR → `/l/<token>`: kartu berisi kode, nama, nama lapangan, kategori (dan ukuran produk), nama lokasi, tanggal didaftarkan, dan untuk aset sewa/leasing/pinjam tanggal akhir kontrak. **Tidak** menampilkan harga, jumlah, nama pemegang, serial/plat. Staf login memakai tautan *Staff: open the full record (sign-in)*, yang membuka `/inventory/material?item=…`, `/inventory/assets?asset=…`, atau `/inventory/produk?product=…`.

#### Aturan & kontrol
- Token QR: 32 karakter heksa acak per record (`ops_inv.label_tokens`), dibuat pertama kali record ditawarkan untuk label dan tetap sama saat cetak ulang; tidak ada daftar token dan tidak ada cara mengubah kode jadi token tanpa `inventory.read`, sehingga isi inventory tidak bisa ditelusuri dengan menebak kode berurutan.
- `label_card` satu-satunya fungsi `ops_*` yang boleh dipanggil tanpa login; tidak menulis apa pun, tidak juga audit untuk token tak dikenal.
- Aset yang `disposed`/`lost`/`returned` tidak ditawarkan untuk label. Barang yang digabung atau diarsipkan tidak ditawarkan. Daftar dibatasi 500 baris.
- QR tanpa token (cadangan) memakai alamat catatan lengkap (perlu login).
- Tag di label: MATERIAL/BAHAN, ASSET/ASET (atau SEWA/LEASING/PINJAM), FINISHED/BARANG JADI.

#### Jejak data (apa yang terekam)
Token di `ops_inv.label_tokens` (jenis, kode). Pencetakan sendiri tidak dicatat (tidak ada log cetak). Tanggal di label = `created_at` record (tanggal didaftarkan).

#### Serah-terima ke tim lain
Procurement/Produksi/Pengiriman melihat kartu yang sama bila memindai. Stiker tag aset ditempel di barangnya sendiri.

#### Koreksi & pengecualian
Label rusak/hilang: cetak ulang dengan `?codes=` atau filter kode; tokennya tetap sama. Label salah lokasi: pilih lokasi lain di panel *Location on the label* (hanya cetakan, tidak mengubah data).

#### Checklist rutin
Mingguan: cetak label untuk barang/aset yang didaftarkan minggu ini (bawaan 7 hari). Pastikan cetak 100%.

#### Sumber
`src/app/(app)/inventory/label/page.tsx`, `src/app/l/[token]/page.tsx`, `src/app/(app)/box/[box]/page.tsx`; `0178_inv_labels.sql`, `0179_inv_label_public.sql`, `0197_inv_categories_and_locations.sql` (`label_rows`); D321, D322, F175.

---

### Jejak dan penelusuran Inventory (inventory log)

#### Tujuan
Menjawab "barang/aset/kiriman ini dari mana, lewat siapa, keluar ke mana, dan apa yang pernah diubah" tanpa bertanya orang.

#### Pemilik / peran & kewenangan
`inventory.read` untuk riwayat di layar Inventory; `procurement.read`/`production.read`/`project.read`/`inventory.read` (salah satu) untuk Job trail; `it.read` untuk Audit Log dan Activity Log. Layar Inventory bernama *Timber* (`/inventory/log`) adalah **kayu**, bukan log aktivitas.

#### Prasyarat
Nomor yang diketahui: kode barang, nomor gerak, nomor JO, PR, PO, `rcv-`, surat jalan, tag aset.

#### Langkah-langkah
1. **Riwayat satu barang:** `/inventory/material` → klik barang → *Movement history* (semua gerak, siapa, kapan, ref JO/penerimaan, alasan), *Changes to entries* (edit/hapus dengan sebelum/sesudah), *Purchase transactions* (transaksi ledger yang membeli barang itu), *Used in products*, *Approved, not yet arrived*.
2. **Seluruh hidup satu barang:** laci barang → *Full item history →* atau Produksi → Job trail (`/produksi/jejak?no=I-xxxxx`): katalog → BOM → PR → PO → penerimaan → stok → Job Order. Mengetik nomor proyek, JO, PR, PO, `rcv-` atau surat jalan menampilkan seluruh proyek berurutan waktu.
3. **Riwayat aset:** drawer aset → *History (Riwayat)* dan *Service & repairs*.
4. **Riwayat barang jadi:** `/inventory/produk` → klik batch → *This batch's history* (produksi per JO, surat jalan, opname).
5. **Riwayat papan:** `/inventory/log` → tab *Usage (Pemakaian)*.
6. **IT:** IT → Audit Log (`/it/audit`), filter pelaku, entity (`stock_move`, `item`, `asset`, `board_move`, `product`, `log_purchase`, `asset_category`), aksi, hasil `ok`/`refused`/`duplicate`/`noop`; penolakan juga dicatat. Tidak ada rute hapus Audit Log.

#### Aturan & kontrol
- Tidak ada angka stok yang disimpan; semuanya hasil jumlah gerak (A3).
- Audit Log hanya mencatat penulisan lewat seam (`ops_core.ok/refused/…`): Input stok, Keluar, Daftarkan barang, Ubah/Hapus input, Ubah data barang, aset, kategori aset, papan, barang jadi, kiriman kayu. Penulisan langsung (kembali, pindah lokasi, **catat hasil hitung (opname)**, tambah log/papan/biaya kayu, kelola lokasi) **tidak** menulis Audit Log; barisnya sendiri (`moved_by`, tanggal) adalah jejaknya.
- John Lau (asisten AI, tombol pojok kanan bawah) menjelaskan cara memakai layar; ia tidak membacakan isi rak, harga atau nilai.

#### Jejak data (apa yang terekam)
`ops_core.audit_log` (aktor, service, entity, entity_no, aksi, hasil, alasan, before, after); `ops_core.outbox` (event: `inventory.item.registered`, `inventory.stock.received`, `inventory.receipt.not_stocked`, `inventory.log_purchase.received`, `inventory.product.moved/counted/allocated`); `ops_core.attachment_links` (dokumen per record).

#### Serah-terima ke tim lain
IT menjaga Audit Log. Auditor internal/Accounting memakai Job trail untuk meninjau seluruh pembelian-produksi satu proyek.

#### Koreksi & pengecualian
Bila gerak tampak janggal: baca riwayat dan perubahan lebih dulu, lalu koreksi lewat proses masing-masing (bukan menumpuk gerak lawan tanpa alasan).

#### Checklist rutin
Bulanan (IT/penanggung jawab Inventory): tinjau Audit Log inventory untuk `refused` berulang dan aksi `delete`/`edit` stok.

#### Sumber
`src/app/(app)/inventory/material/StockDrawer.tsx`, `MoveHistory.tsx`; `src/app/(app)/produksi/jejak/page.tsx`; `0171_prod_job_trail.sql`, `0198_inv_stock_input.sql`, `0003_core_audit.sql`; D84, D312, D313, `docs/plan/penomoran.md`.

---

### Kesenjangan & catatan chapter ini

**Belum dibangun atau belum diputuskan pemilik**
1. **Opname:** frekuensi, persetujuan selisih, dan foto rak belum diputuskan (Q57). Hari ini selisih langsung tercatat tanpa persetujuan, jadwal, atau foto. Cara termurah bila diinginkan: menjadikan `adjust` admin-only atau menambah status *diajukan → disetujui* (dokumen Q57, belum dibangun).
2. **Minimum stok dan lokasi rumah barang material tidak punya layar.** `setStockMinimum` ada di API tetapi tidak dipanggil layar mana pun, jadi kolom *Minimum* hampir semua "belum ditetapkan" dan peringatan "Below minimum" tidak akan menyala. Lokasi rumah barang material (`stock_settings.home_location`) juga tidak ada layar; akibatnya semua penerimaan masuk ke `GUDANG` dan harus dipindah manual. (Lokasi rumah **produk jadi** punya layar.) Sampai ada layar, mengatur keduanya perlu bantuan IT.
3. **Surat jalan dan lokasi barang jadi (Q59/F177):** surat jalan mengurangi dari lokasi rumah produk atau `GUDANG`, bukan dari rak tempat barang berada. Sampai diputuskan: pindahkan ke lokasi rumah sebelum surat jalan dibuat.
4. **Hasil produksi barang jadi tidak otomatis dari progres Produksi.** Dua pencatatan terpisah (progres di Produksi, masuk rak di Inventory); bisa tidak sinkron.
5. **Nilai rupiah barang jadi** belum ada (butuh biaya produksi per unit, D311/D239). Nilai keluar material tidak dihitung (Q43; FIFO/rata-rata belum dipilih), hanya nilai rak.
6. **Tidak ada jurnal ke ledger** dari selisih opname, nilai persediaan, atau pemakaian material; Accounting tidak mendapat angka persediaan otomatis.
7. **Reservasi stok per JO tidak ada** (D312): dua JO bisa "Material ready" atas stok yang sama. PR bahan produksi boleh tanpa JO. PO tanpa PR tidak punya jalur ke JO.
8. **Tidak ada layar mengubah/menghapus** untuk: kiriman kayu, log, papan hasil gergaji, biaya kayu (policy update `inventory.update` ada di database), gerak papan, gerak barang jadi. Koreksi lewat gerak lawan (Returned, Opname adjustment, Hitung) atau lewat IT. `markLogSawn` (menandai log tanpa papan) ada di API tetapi tidak ada tombolnya.
9. **Kiriman kayu belum tertaut ke ledger/PR dari layar:** `trx_no` dan `pr_line_no` ada di database dan API tetapi `NotaImport` tidak mengirimkannya; tautan ke transaksi pembayaran manual/di luar sistem.
10. **Nota kayu dan nota biaya kayu tidak punya folder tugas Inventory** (diunggah tanpa `entity`), masuk `NOTA` bersama nota accounting; ini menyimpang dari aturan "satu folder per tugas" (CLAUDE.md, D313/D320) dan perlu baris `drive_paths` (entity `log_purchase`) bila diinginkan. Nota (kind `nota`) dan banyak dokumen lain belum memakai pohon bulan `TRANSACTIONS/<YYYY-MM>/<YYYY-MM-DD>` sampai IT menambah baris `drive_paths` (D359, "IT menambah dua baris"; status baris itu di produksi tidak diverifikasi di sini).
11. **Tidak ada opname/penghitungan aset** (cocokkan tag dengan daftar), tidak ada alat transfer aset antar pemegang selain Edit; pemegang aset teks bebas, tidak tertaut ke karyawan HR.
12. **Aset dikembalikan tidak otomatis menghentikan sewa** di kalender pembayaran Accounting; perlu langkah manual di Accounting.
13. **Kategori barang** (pohon dua tingkat) tidak punya layar di Inventory; diurus Procurement. `stocked_categories` tidak punya policy tulis (diubah lewat seam procurement atau migrasi).
14. **Backfill:** penerimaan CONFIRMED sebelum `0169`/`0180` tidak menambah stok (Q58); stok dimulai dari Input stok/opname.
15. Hapus Audit Log: tidak ada rute hapus; tidak ada jejak cetak label.

**Perbedaan dokumen dan kode (kode/commit terbaru dipakai)**
- `docs/sop/inventory/sop.html` dan `simulasi-log.md` (30 Sep 2026) menyebut Procurement mencatat kedatangan lewat Purchase Tracker saja; sejak D358 (1 Okt) ada jalur kedua, **Receiving Report dari Chat** dengan nomor `rr-…`, dan sejak D363 jumlah/kondisi koreksi siang dan peran file *Kuitansi / Nota* (SOP lama belum memuat).
- SOP lama dan simulasi menulis Job Order `jo-…`; kode memeriksa `jo-` **dan** `spk-` (awalan lama `spk` dipakai di data lama dan di contoh isian papan `spk-26-09-…`). Gunakan nomor JO apa adanya dari Produksi.
- Teks layar `/inventory/penyesuaian` ("Semuanya tetap ada…") bertentangan dengan D348: penyesuaian kini bisa diubah/dihapus dari riwayat barang dengan alasan. Aturan A5/D171 ("kesalahan = gerak baru") berlaku utuh untuk papan, barang jadi, dan penerimaan; D348 menggantikannya hanya untuk input stok material di layar inventory.
- SOP lama menyebut Input stok bagian dari proses 2 "Input stok dari awal" dengan `inventory.adjust`; kode cocok. SOP lama bagian "Lokasi" memuat tiga lokasi seed; produksi kini 13 lokasi (D346).
- CLAUDE.md memberi contoh pohon folder INVENTORY/ITEMS dan FINISHED GOODS; `0172` juga menetapkan `INVENTORY/ASSETS` untuk foto aset. D313 menyebut folder `OPS`; sejak D320 foldernya `ops-talaliving`.
- Menu *Stock Adjustments* butuh `inventory.adjust` (nav), sedangkan SOP lama menyebut Pembaca "melihat riwayat opname"; itu hanya bisa lewat alamat langsung.
- Layar Job Order memakai `inventory.update` untuk menampilkan tombol keluar bahan, seam meminta `inventory.create`; tidak berbeda dalam praktik selama peran Baca & ubah memegang keduanya.
- Pembaca nota kayu (foto) tergantung konfigurasi model bahasa oleh IT; bila belum, layar membalas 501 (hanya tempel teks).

**Hal yang tidak dikonfirmasi saat menyusun chapter ini**
- Nama peran/jabatan sebenarnya (misalnya "kepala gudang") dan siapa yang memegang modul Inventory tidak ada di kode; ditentukan lewat IT → Roles & Permissions.
- Apakah akun Inventory-saja bisa membuka Purchase Tracker untuk *Record arrival* (seam mengizinkan `inventory.create`; kebijakan menu Procurement tidak diperiksa).
- Status baris `drive_paths` `nota`/`transfer_proof` di produksi (D359) dan status 13 lokasi persisnya.
- Pelaksanaan opname fisik (jadwal, siapa menghitung) di lapangan: tidak ada aturan di kode; Q57.
- Praktik "selalu isi nomor JO pada keluar" dan "pindahkan barang jadi ke lokasi rumah sebelum surat jalan" adalah panduan prosedur dari simulasi/F177, bukan kontrol sistem.



## Bab 4 — HRD & Penggajian (SDM)

Bab ini memuat seluruh siklus orang di ops.talaliving: karyawan masuk, berkas dan kontrak, jadwal, absensi, lembur, cuti, gaji mingguan/bulanan, slip, iuran, tugas, kinerja, WLKP, sampai layanan mandiri karyawan di HP. Prinsipnya sama dengan bab lain: **semua kejadian dicatat sebagai baris (tap, tanda hari, lembar, run, tugas), status diturunkan saat dibaca, dan koreksi ditulis sebagai catatan baru dengan alasan — bukan dihapus.** Gaji **tidak pernah disimpan sebagai angka**: setiap kali halaman run/slip dibuka, angkanya dihitung ulang dari tap, tanda hari, cuti, lembur yang disetujui, penyesuaian, dan buku aturan gaji (D139, A3).

**Cara membaca bab ini**

- Nama layar, tombol, status, kode penolakan, nama wewenang, dan nomor dokumen ditulis persis seperti di kode. Aplikasi dua bahasa: bawaannya Inggris, akun karyawan-saja (`door = employee`) bawaannya Indonesia (D331). Tombol ditulis `EN / ID` bila beda. Nama menu SDM (`src/lib/messages.ts`): *Karyawan, Jadwal kerja, Absensi, Presensi berlokasi, Lembur, Berkas 201, Kontrak kerja, Cuti & izin, Penggajian, Gajian mingguan, Iuran wajib, Pemantauan tugas, Wajib Lapor (WLKP), Kinerja & tugas, Aturan penggajian*.
- **Tidak ada "peran" bernama yang bisa diedit** (`/it/peran` hanya katalog). Akses = **modul + level per orang** (`read` < `write` < `admin`, `src/lib/roles.ts`) ditambah **wewenang** (*authority*) yang diberikan terpisah dan tidak pernah tersirat dari level (D24). `write` atau `admin` membuka semua kata kerja non-admin: `hrd` → `read`/`create`/`update`; `payroll` → `read`/`run`; `it` → `read`/`update` (+ `manage_users`, `manage_roles`, `purge_activity`, `manage_drives` hanya `admin`). Yang dipakai bab ini:

| Sebutan di bab ini | Grant sebenarnya |
|---|---|
| **Staf HRD** | modul `hrd` level write (`hrd.read/create/update`), biasanya + `payroll` write (`payroll.read/run`) — kombinasi yang dipakai simulasi (`supabase/local/smoke/99_sim_hr_to_ledger.sql`) |
| **Pimpinan** | wewenang `approve_funds` (menyetujui run gaji), `approve_overtime` ("Menyetujui lembur (pimpinan)"); biasanya `payroll` read |
| **Keuangan** | modul `accounting` write + wewenang `post_ledger` ("Membukukan ke buku besar") |
| **IT** | modul `it` write (`it.update`: tulis aturan gaji); `it` admin (`it.manage_users`: buat akun, tautkan akun↔karyawan) |
| **Karyawan** | akun yang tertaut ke satu baris karyawan (`ops_hr.my_employee_id()`); tanpa modul pun boleh `/saya` dan `/profil` |

- **Jam kantor = WIB** (UTC+7, `Asia/Jakarta`, `OFFICE_TZ` di `src/lib/office.ts`, `ops_core.office_tz()`) sejak D334 (2026-09-29). Mesin sidik jari menulis jam WIB; "hari kerja" sebuah tap = hari kantor WIB. (D327 menyebut WITA — sudah digantikan, lihat catatan akhir.)
- **Mode live vs demo.** Di deployment sungguhan hanya rute dalam `LIVE_ROUTES` (`src/lib/live.ts`) yang dibuka. Rute HR yang **live**: `/hrd/karyawan`, `/hrd/jadwal`, `/hrd/absensi`, `/hrd/absensi/lokasi`, `/hrd/berkas-201`, `/hrd/kontrak(/[no])`, `/hrd/cuti`, `/hrd/lembur`, `/hrd/payroll(/[run](/payslip))`, `/hrd/payroll/minggu`, `/hrd/tugas`, `/hrd/wlkp`, `/it/aturan-gaji`, `/profil`, `/saya`. **Belum live (hanya demo): `/hrd/iuran`, `/hrd/kinerja`, `/pengaturan`.**
- **Sumber kebenaran urutan:** kode + migrasi terbaru > `docs/plan/README.md`/`06-decisions.md` > `docs/sop/hr/sop.html` (versi 24 Sep 2026, sebagian sudah kedaluwarsa — daftar konflik di akhir bab).

---

### Karyawan baru (onboarding) dan pemeliharaan data karyawan

#### Tujuan
Mendaftarkan orang dengan **nomor yang sama dengan nomor di mesin absen**, unit, cara dibayar, upah pokok, tunjangan harian, dan kontak, sehingga tap, jadwal, lembur, dan gaji bisa tertaut ke orang yang benar.

#### Pemilik / peran & kewenangan
- Membuat/mengubah: **Staf HRD** — `hrd.create` (seam `ops_hr.save_employee`; layar memakai `hrd.update` untuk membuka tombol/drawer). Membaca daftar & upah: `hrd.read` atau `payroll.read`; karyawan hanya membaca baris dirinya.
- Membuat akun masuk & menautkan ke karyawan: **IT** — `it.manage_users` (`ops_hr.link_employee_account`, `/it/pengguna`). HRD hanya **melihat** akun di kolom daftar (baca-saja).
- Mengisi hak cuti: Staf HRD (`hrd.create`), hanya setelah 1 tahun masa kerja.

#### Prasyarat
- Orang sudah terdaftar di mesin sidik jari dan **nomor mesinnya diketahui** (nomor itu menjadi `employee_no`; `B-0101`, `019`, `19` dianggap sama oleh importer, `ops_hr.machine_no`).
- Upah pokok sudah disepakati (kontrak/penawaran). Pola kerja yang akan dipasang sudah ada di *Jadwal kerja* (atau unitnya punya pola bawaan).

#### Langkah-langkah
1. **Staf HRD** → HRD › *Karyawan* (`/hrd/karyawan`) → tombol **Add somebody / Tambah orang** → drawer *New employee / Karyawan baru*.
2. Isi: **Number on the machine / Nomor di mesin** (wajib; setelah disimpan tidak bisa diubah), **Full name / Nama lengkap** (wajib), **Position / Jabatan**, **Unit** (teks bebas; mis. `Workshop`, `STAFF`), **Email** (opsional, disimpan huruf kecil), **Mobile number / Nomor HP** (opsional; 8–15 angka, boleh diawali `+`), **Work schedule / Jadwal kerja** (pilih pola, atau *Follow unit default / Ikut bawaan unit*), **How they are paid / Cara dibayar** (`Monthly salary` / `Per day` / `Per hour`), **Salary/Rate / Gaji/Tarif** (pokok per bulan/hari/jam), **Allowance, per day present / Tunjangan, per hari hadir**, **Hours in a standard day / Jam dalam sehari standar**, **Start date / Tanggal masuk** (kosong = hari ini), **Paid leave entitlement, per year / Hak cuti berbayar** (biarkan 0 untuk orang baru).
3. Tombol **Save / Simpan** (aktif hanya bila nomor mesin, nama, dan upah terisi; layar menulis *"To save, fill in: …" / "Untuk menyimpan, isi dulu: …"*) → status **aktif** (`active = true`). Tidak ada nomor dokumen yang dibuat; identitas karyawan = nomor mesin.
4. Selesai di HRD, lanjutkan: pola kerja (bila belum ikut unit) → *Berkas 201* → *Kontrak kerja* → (IT) akun masuk → *Wajib Lapor* (data diri) → daftar BPJS (lihat *Iuran wajib*).
5. **IT** → IT › *Pengguna & akses* (`/it/pengguna`) → *Add user* (default dengan kata sandi yang dibuat server, ditampilkan sekali dengan tombol salin) → menautkan akun ke karyawan (cari nama/nomor karyawan di laci pengguna). Setelah tertaut karyawan bisa membuka `/saya`.

**Yang direkam:** baris `ops_hr.employees` (pokok, tunjangan, jam standar, jadwal, tanggal masuk, kontak, hak cuti, `active`, `left_on`), baris audit `hr/employee/save` dengan nilai sebelum/sesudah upah (kedua angka tercatat, D250), tidak ada penulisan email/HP ke audit (D349). Akun tertaut: `employees.user_id`.

#### Aturan & kontrol
- Penolakan seam `save_employee`: `not_permitted` ("Writing the personnel record needs HR access."), `employee_no_required`, `name_required`, `rate_required` ("Nol bukan upah. Tulis yang benar-benar dibayar."), `allowance_negative`, `pay_basis_required`, `schedule_unknown`, `email_invalid`, `phone_invalid`, `leave_needs_start_date`, `leave_before_one_year` ("Hak cuti diisi setelah 1 tahun bekerja — orang ini berhak mulai <tanggal>.").
- **Hak cuti berbayar baru = 0**; HRD yang mengisinya setelah 1 tahun sejak `joined_on` (D349). Menurunkan/menyimpan ulang angka yang sama tidak pernah ditolak. Daftar menunjuk orang yang "sudah 1 tahun — isi".
- **Upah tidak pernah nol** untuk orang baru; untuk orang yang sudah ada dengan upah belum terisi (kasus 6 karyawan bulanan produksi), field upah boleh dikosongkan — upah dibiarkan, **penggajian menghitung nol sampai diisi** (F216, `b43a781`).
- Tunjangan = **per hari hadir**, satuan sama untuk semua cara bayar (D250). Pay = pokok + tunjangan.
- Urutan jadwal yang berlaku untuk seseorang: pola yang dipasang pada orang > pola bawaan unitnya > tidak ada pola (jam kerja tak terukur, tidak ada keterlambatan — bukan "08.00 diam-diam", F70).
- Daftar: yang bekerja tampil **10 per halaman**; yang keluar 10 terakhir (urut `left_on` terbaru), halaman berikut dibaca dari database saat *Next* (D365). Kotak cari: nama, nomor, jabatan, unit, HP, email.

#### Jejak data (apa yang terekam)
- Tabel `ops_hr.employees` (+ `ops_hr.v_employee_account` untuk tautan akun); audit `ops_core.audit_log`; outbox event.
- **Data pribadi:** gaji, email, HP hanya terbaca oleh `hrd.read`/`payroll.read` dan orangnya sendiri (RLS `employees_read_own`). Tidak ada berkas yang diunggah di langkah ini.

#### Serah-terima ke tim lain
- **IT:** membuat/menautkan akun (`it.manage_users`). **Produksi:** daftar karyawan aktif tanpa gaji untuk memilih nama di kartu lantai (`ops_hr.work_roster()`, lihat bagian *Roster kerja*). **Akuntansi:** tidak membaca gaji per orang (D213/D218).

#### Koreksi & pengecualian
- Salah nomor mesin: nomor **tidak bisa diubah**; cara resmi belum ada di layar (lihat Kesenjangan). Salah upah/jabatan/unit: edit lagi di drawer (nilai lama→baru tercatat).
- Nomor tak dikenal di file biometrik: tambahkan orangnya dulu, lalu impor ulang file yang sama (tap yang sudah masuk tidak ganda).
- Orang tanpa nomor mesin (di produksi per D337: 12 orang, mis. AGUS finishing, NUR helper) harus didaftarkan di mesin dulu.

#### Checklist rutin
- Harian: orang baru hari ini sudah didaftarkan **sebelum** file biometrik diimpor.
- Bulanan: lihat banner *"N orang sudah 1 tahun bekerja dan hak cutinya belum diisi"*; periksa baris "no schedule / tanpa jadwal".

#### Sumber
`src/app/(app)/hrd/karyawan/{page,EmployeeDrawer}.tsx`, `src/services/hr/{contracts,employee-rules}.ts`, `src/lib/api/hr.ts` (`saveEmployee`, `listLeavers`), migrasi `0043`, `0056`, `0198_hr_employee_contact_leave`, `0185_core_employee_accounts`; D136, D250, D281, D329, D349, D365; F193, F216.

---

### Offboarding karyawan (keluar) dan mengaktifkan kembali

#### Tujuan
Menandai orang yang berhenti (tanggal + alasan) agar ia keluar dari daftar kerja, absensi, dan gaji **tanpa menghapus** satu pun catatan atau tap.

#### Pemilik / peran & kewenangan
**Staf HRD** — `hrd.update` (`ops_hr.offboard_employee`, `ops_hr.reinstate_employee`). Pembatalan akun masuk: **IT** (`it.manage_users`).

#### Prasyarat
Orang aktif (`active = true`); hari kerja terakhir dan alasan diketahui (resign, kontrak selesai, tidak kembali).

#### Langkah-langkah
1. Staf HRD → HRD › *Karyawan* → klik baris orang itu → drawer → bagian **Offboard / Offboard / keluar** → tombol **This person has left… / Orang ini sudah keluar…**.
2. Isi **Last working day / Hari kerja terakhir** dan **Why / Alasan** → tombol **Offboard / Keluarkan** → `active = false`, `left_on = tanggal`; toast menyebut berapa tap setelah tanggal itu (`taps_after`).
3. Orang yang salah dikeluarkan atau kembali bekerja: buka baris orang itu (di daftar *who have left / yang sudah keluar*) → isi **Why** → **Reinstate / Aktifkan kembali** → `active = true`.
4. Tindak lanjut **manual** (tidak otomatis oleh sistem, lihat Kesenjangan): akhiri kontrak (*Kontrak kerja › End*), akhiri keikutsertaan BPJS, minta IT menonaktifkan/melepas akun, hentikan tugas rutin/tugas terbuka atasnya.

#### Aturan & kontrol
- `offboard_employee`: `not_permitted`, `reason_required`, `not_found`, `already_left` ("<nama> sudah keluar per <tanggal>."), `left_before_joined`. `reinstate_employee`: `reason_required`, `already_active`.
- Semua pembaca (gaji, absensi, KPI) memakai `active or left_on >= awal periode`: orang yang keluar **tetap muncul di setiap periode yang pernah ia kerjakan**.
- Impor biometrik: tap sesudah hari **kerja** terakhir (`shift_day`, termasuk shift malam yang dimulai di hari terakhir) **disisihkan** sebagai `after_left` dan disebut dengan tanggal keluarnya, tidak dimasukkan. Waspada nomor mesin yang dipakai ulang oleh orang baru.

#### Jejak data (apa yang terekam)
`employees.active/left_on`; audit `hr/employee/offboard` (sebelum: aktif; sesudah: `left_on`, `reason`, `taps_after`) dan `…/reinstate`. Tap dan baris lama tidak disentuh.

#### Serah-terima ke tim lain
IT (akun), Akuntansi (BPJS: nama yang keluar harus lepas dari tagihan — diaudit Akuntansi terhadap daftar peserta), Produksi (kartu lantai membaca roster aktif saja).

#### Koreksi & pengecualian
Tanggal keluar salah → *Reinstate* (alasan) lalu offboard ulang dengan tanggal benar. Slip periode yang sudah dibayar tidak berubah oleh offboard.

#### Checklist rutin
Bulanan: bandingkan orang yang tidak lagi tap dengan daftar aktif; sisihan `after_left` dari impor file terakhir.

#### Sumber
`0192_hr_offboard.sql`, `src/app/(app)/hrd/karyawan/EmployeeDrawer.tsx`, `src/app/(app)/hrd/absensi/ImportScans.tsx`; D337, F193; smoke `192_hr_offboard`.

---

### Berkas 201 (berkas pribadi karyawan)

#### Tujuan
Menyimpan berkas pribadi sebagai **daftar periksa**: sistem bisa menjawab *apa yang belum ada* dan *apa yang segera kedaluwarsa*; nomor dokumen boleh dicatat tanpa scan.

#### Pemilik / peran & kewenangan
Mencatat dokumen: **Staf HRD** `hrd.create` (`ops_hr.file_employee_document`). Membaca: `hrd.read`. **Membuka nomor identitas asli: `hrd.read`** (`ops_hr.reveal_employee_doc_no`) — tercatat di audit.

#### Prasyarat
Karyawan sudah terdaftar. Scan/foto dokumen tersedia (boleh menyusul).

#### Langkah-langkah
1. Staf HRD → HRD › *Berkas 201* (`/hrd/berkas-201`) → cari nama (urut: yang belum lengkap dulu, lalu masa berlaku terdekat) → klik orang → drawer menampilkan **setiap slot, termasuk yang kosong**.
2. Di slot (mis. KTP) tombol **Add / Tambah** → isi nomor dokumen (opsional), pilih scan/foto (opsional), tanggal terbit & berakhir (bila ada), catatan → **Save / Simpan** → dokumen tercatat; nomor `edc-YY-MM-DD_NN` (`doc_ref`).
3. Berkas diunggah ke Drive lewat `documents.upload` lalu ditautkan ke karyawan (jenis sesuai slot).
4. Melihat nomor identitas: klik ikon mata pada baris dokumen → nomor asli ditampilkan sementara (tidak disimpan di cache layar); audit mencatat siapa, dokumen siapa, jenis apa — **tidak pernah nomornya**.

Slot (kind): `ktp`, `kartu_keluarga`, `kontrak_kerja`, `foto` — **wajib** (`EMPLOYEE_DOC_CHECKLIST`); tidak wajib: `ijazah`, `cv`, `npwp`, `bpjs_kesehatan`, `bpjs_tk`, `sertifikat`, `sp` (Surat peringatan), `lainnya`.

#### Aturan & kontrol
- Penolakan: `not_permitted`, `nothing_to_file` ("Lampirkan berkasnya atau tulis nomornya. Satu baris kosong bukan dokumen."), `extracted_without_file`, `expiry_before_issue`; baca nomor: `not_permitted`, `no_number`.
- **Hanya nomor identitas yang disamarkan** — KTP, KK, NPWP, BPJS (kedua kartu): ditampilkan `••••` penuh dengan panjangnya saja (KTP 16, KK 16, NPWP 15, BPJS Kesehatan 13, BPJS TK 11 angka; panjang janggal = bacaan gagal). Nomor kontrak/sertifikat/ijazah terbuka. Penyamaran dilakukan di **payload**, bukan di layar (D195, D196, D198).
- Masa berlaku: "sudah lewat" dan "berakhir ≤ 60 hari" dihitung; kartu ringkasan menunjukkan *Berkas lengkap, Belum lengkap, Sudah lewat masa berlaku, Berakhir ≤ 60 hari*.
- Sumber nomor: `typed` (diketik), `extracted` (terbaca dari berkas; wajib ada berkas), `pending` (berkas ada, nomor belum dibaca).

#### Jejak data (apa yang terekam)
- `ops_hr.employee_documents` + `ops_core.attachment_links` (entity `employee`) + audit tanpa nomor.
- **Folder Drive** (pohon `ops-talaliving` di shared drive **HRD**; jenis dokumen yang memilih drive — batas data pribadi, `ops_core.doc_kind_drive`, 0035). Upload Berkas 201 **tidak mengirim `entity`**, jadi foldernya = nama jenis dokumen huruf besar: `KTP`, `KARTU KELUARGA`, `IJAZAH`, `CV`, `KONTRAK KERJA`, `NPWP`, `BPJS` (kedua kartu), `SURAT PERINGATAN`.
- **PERHATIAN (lihat Kesenjangan):** jenis `foto` (Pas foto), `sertifikat`, dan `lainnya`→`other` terpetakan ke shared drive **PROCUREMENT** (folder `FOTO`, `SERTIFIKAT`, `LAIN-LAIN`), bukan HRD.

#### Serah-terima ke tim lain
Kertas kontrak yang diunggah dari *Kontrak kerja* ikut tertaut ke karyawan sebagai `kontrak_kerja`. Kepatuhan WLKP membaca jenis kontrak, bukan berkas.

#### Koreksi & pengecualian
Dokumen baru ditambahkan sebagai baris baru (yang lama tetap ada); tidak ada tombol hapus. Nomor salah baca → catat ulang dengan sumber `typed`. John Lau **tidak** membaca Berkas 201 (D218).

#### Checklist rutin
Bulanan: buka *Berkas 201* → angka *Belum lengkap*, *Sudah lewat*, *≤ 60 hari* → perpanjang yang mendekati kedaluwarsa (kontrak PKWT, kartu BPJS, sertifikat K3/las/forklift).

#### Sumber
`src/app/(app)/hrd/berkas-201/{page,FileDrawer}.tsx`, `src/services/hr/contracts.ts` (EMPLOYEE_DOC_*), `0056_hr_people_seams.sql`, `0035_core_drive_folders.sql`, `0172_core_drive_ops_paths.sql`, `docs/plan/03-api.md`; D177, D195, D196, D198, D218, D313, D320.

---

### Kontrak kerja (PKWT/PKWTT) dan kertas kontrak

#### Tujuan
Mencatat kontrak sebagai **draft**, melampirkan kertas yang ditandatangani, menjawab 10 poin wajib dengan **kalimat aslinya**, lalu memberlakukannya. Kontrak **diperiksa terhadap sistem, bukan dimuat ke dalamnya**: selisih ditampilkan, tidak diterapkan otomatis.

#### Pemilik / peran & kewenangan
- Mendaftarkan, mengusulkan poin: `hrd.create`. Melampirkan kertas, **mengonfirmasi poin, memberlakukan, mengakhiri**: `hrd.update` (`ops_hr.register_contract/propose_clause/confirm_clause/attach_contract_paper/activate_contract/end_contract`). Semua = **Staf HRD**.

#### Prasyarat
Karyawan terdaftar. Kontrak sudah dibuat (Word, kop surat) dan **ditandatangani di kertas**; scan/PDF tersedia.

#### Langkah-langkah
1. Staf HRD → HRD › *Kontrak kerja* (`/hrd/kontrak`) → **Register contract / Daftarkan kontrak** → pilih karyawan, **Kind / Jenis** (`PKWT` waktu tertentu / `PKWTT` waktu tidak tertentu), **Effective from / Mulai berlaku**, **Ends / Berakhir** (wajib untuk PKWT, tidak boleh untuk PKWTT), catatan → **Register / Daftarkan** → status **draft**, nomor `kkj-YY-MM-DD_NN`.
2. Buka kontrak (`/hrd/kontrak/<kkj-…>`) → **Attach contract / Lampirkan kontrak** (atau **Replace contract file / Ganti berkas kontrak**) → pilih scan/PDF → diunggah (jenis `Kontrak Kerja`, drive HRD) dan ditautkan; `sha256` dipaku ke berkas. Hanya draft yang bisa dilampiri/diganti.
3. **Contract points / Poin kontrak**: untuk tiap poin tombol **Answer / Jawab** (usulan mesin: **Review proposal / Periksa usulan**; sudah dikonfirmasi: **Edit / Ubah**) → salin **Original wording / Kalimat aslinya** dari kertas → isi nilai terstruktur sesuai bentuk poin (mis. `gaji_pokok`: jumlah + per bulan/hari/jam) → **Confirm / Konfirmasi**.
4. Setelah kertas terlampir dan 10 poin wajib dijawab → **Put into force / Berlakukan** → status **active**. Kontrak aktif sebelumnya milik orang yang sama otomatis menjadi **superseded** ("Digantikan", `superseded_by` menunjuk kontrak baru).
5. Mengakhiri: kontrak aktif → **End / Akhiri** → tulis alasan → **End contract / Akhiri kontrak** → status **ended**, `ended_on`, `ended_reason`.
6. Bagian **Differs from what runs / Tidak sama dengan yang dijalankan** menampilkan selisih kertas vs sistem (gaji pokok, tunjangan, jadwal, cuti, jenis, keterlambatan, potongan, lembur). Menerapkan selisih = perbuatan terpisah lewat *Karyawan* (jejaknya berbunyi *upah berubah*).

#### Aturan & kontrol
- **Status:** `draft → active → superseded | ended` (A5: yang lama tetap ada karena slip lama dihitung di bawah kontrak yang berlaku saat itu).
- **10 poin wajib:** `gaji_pokok`, `tunjangan` (nol pun harus disebut), `jam_kerja`, `cuti`, `jangka_waktu`, `masa_percobaan`, `keterlambatan`, `potongan`, `lembur`, `pemutusan`. Tidak wajib: `bpjs`, `kerahasiaan`, `fasilitas`, `penempatan`, `lainnya`.
- Penolakan: `end_date_required` ("PKWT selalu punya tanggal berakhir…"), `end_date_not_allowed` (PKWTT), `period_invalid`; `attachment_required`, `not_a_draft`; `quote_required`, `value_shape`, `already_confirmed` ("Syarat yang berubah adalah kontrak baru, bukan suntingan atas yang lama."); `paper_required` ("Berkas yang ditandatangani belum terlampir."), `clauses_missing` (menyebut poin yang belum), `already_decided`; `not_active`, `reason_required` (End).
- Masa percobaan **diturunkan** dari poin `masa_percobaan` + tanggal mulai (tidak disimpan ganda).
- Usulan mesin (bacaan PDF otomatis) tidak pernah lahir terkonfirmasi dan tidak menimpa konfirmasi orang; **pembaca PDF (tahap C) belum ada** — mengetik adalah satu-satunya jalan (D286).
- Kontrak yang PKWT lewat tanggal berakhir **tidak berubah status otomatis**; layar menandai "lewat N hari" dan kartu *Berakhir ≤ 60 hari*.

#### Jejak data (apa yang terekam)
`ops_hr.employment_contracts`, `contract_clauses` (kalimat asli + halaman + nilai + sumber + terkonfirmasi), audit tiap langkah; kertas: attachment jenis `kontrak_kerja` di drive **HRD**, folder `ops-talaliving/KONTRAK KERJA` (tidak ada `drive_paths` khusus; unggahan tidak membawa `entity`), tertaut ke karyawan.

#### Serah-terima ke tim lain
Penggajian membaca `employees`, **bukan** kontrak; kontrak tidak mengubah gaji. WLKP membaca jenis kontrak berlaku (`status_hubungan_kerja`; "tanpa_kontrak" bila tak ada kontrak aktif).

#### Koreksi & pengecualian
Syarat berubah = **kontrak baru**, bukan edit. Salah kertas pada draft: *Replace contract file*. Kontrak aktif salah → *End* dengan alasan lalu daftarkan baru.

#### Checklist rutin
Bulanan: kartu *Poin wajib belum dijawab*, *Tidak sama dengan sistem*, *Berakhir ≤ 60 hari* → siapkan perpanjangan PKWT.

#### Sumber
`src/app/(app)/hrd/kontrak/**`, `src/services/hr/contracts.ts` (ClauseKind, CLAUSE_FIELDS), `0058_hr_contracts.sql`, `0148_hr_contract_paper.sql`; D286, F154; `docs/sop/hr/sop.html` langkah 5.

---

### Jadwal kerja, pola kerja, dan pola bawaan unit

#### Tujuan
Menetapkan **jam kerja yang menjadi ukuran** (masuk, pulang, istirahat, jadwal per hari, shift) dan pola mana yang dipakai siapa, supaya keterlambatan, jam dibayar, dan pengali akhir pekan/tanggal merah bisa dihitung.

#### Pemilik / peran & kewenangan
- **Staf HRD** `hrd.update`: pasang pola ke orang (`ops_hr.set_employee_schedule`), tambah pola (`add_schedule`), ubah jam (`set_schedule_hours`), jadwal per hari (`set_schedule_days`), shift (`set_schedule_shifts`), **pola bawaan unit** (`set_unit_schedule`, D365).
- **IT** `it.update`: tulis **versi buku aturan gaji** secara keseluruhan dan **menghapus** pola (`/it/aturan-gaji`, `save_pay_rules`). Peta unit di `/it/aturan-gaji` kini **baca-saja** dengan tautan ke HRD (D365).

#### Prasyarat
Ada versi buku aturan gaji yang berlaku pada tanggal berlaku yang dipilih (bila tidak: `no_rule_book` — "IT menerbitkannya dulu"). Untuk pola baru: kode, nama, jam masuk/pulang, istirahat.

#### Langkah-langkah
1. **Pasang pola ke orang.** HRD › *Jadwal kerja* (`/hrd/jadwal`) → kartu *"N karyawan belum punya jadwal"* → pilih **Choose work pattern… / Pilih pola kerja…** → **Assign / Pasang** → `employees.schedule_code`. (Atau di drawer karyawan.)
2. **Tambah pola.** **Add pattern / Tambah pola** → **Code/Kode** (huruf besar/angka/_/-, diawali huruf; mis. `SATPAM`, `HELPER`), **Name/Nama**, **Start/Masuk**, **End/Pulang**, **Break (minutes)/Istirahat (menit)**, opsional **Friday break / Friday end**, **About this pattern**, **In force from / Berlaku mulai**, **Why / Alasan** → **Add pattern** → versi buku aturan **baru bertanggal**, aturan lain disalin utuh.
3. **Ubah jam** (tombol baris **Hours / Jam**): masuk, pulang, istirahat, berlaku mulai, alasan → **Save hours / Simpan jam** (menyimpan = mengonfirmasi jam; tanda *belum dikonfirmasi* hilang).
4. **Per hari** (**Per day / Per hari**): tiap hari Senin–Minggu punya jam sendiri, istirahat, **Pay × / Upah ×** (mis. Sabtu/Minggu 2), atau **Off/Libur** → **Save days / Simpan jadwal per hari**.
5. **Shift** (**Shifts / Shift**): lihat bagian *Shift malam dan shift satpam*.
6. **Pola bawaan unit** (kartu **Unit default pattern / Pola bawaan unit**): baris tiap unit (unit yang dipakai karyawan aktif + unit yang disebut buku aturan) → **Change / Ubah** → pilih pola atau *— no default — / — tanpa pola bawaan —*, **In force from**, **Why** (layar menyebut berapa orang terkena) → **Save / Simpan** → `ops_hr.set_unit_schedule` (versi buku aturan baru).
7. **IT** menghapus pola / menerbitkan versi penuh di `/it/aturan-gaji` → **See the effect / Lihat dampaknya** → **Save version / Simpan versi** (lihat bab *Aturan penggajian*).

#### Aturan & kontrol
- Pola = baris di **buku aturan bertanggal**; **tidak pernah diedit** — perubahan menulis versi berikutnya. Versi yang berlaku untuk suatu hari = yang `effective_from`-nya terlambat yang masih ≤ hari itu, lalu nomor tertinggi (`rules_on`). **Versi bertanggal mundur berhenti di tanggal versi berikutnya yang sudah ada** (F216) — layar kini menyebut "Versi ini hanya membaca … s.d. …" sebelum menyimpan.
- Penolakan umum seam jadwal: `not_permitted`, `note_required`, `no_rule_book`, `later_version_exists`, `schedule_exists` (kode sudah ada — pakai tombol Hours), `already_paid` ("sudah ditandatangani untuk periode yang berakhir … Aturan tidak bisa mundur melewati uang yang sudah dibayarkan"), `inside_existing_run` (tanggal jatuh di dalam run), `schedule_unknown`, `shift_unknown`; bentuk lewat `schedule_problem`: `code_required`, `code_shape`, `code_duplicate`, `name_required`, `minutes_range`, `end_before_start`, `break_too_long`, `overnight_friday_end`, `days_shape`, `day_multiplier` (>0 s.d. 5), `shifts_too_many` (≤6) dst. Pola yang masih dipakai orang **tidak bisa dihapus** (`schedule_in_use`).
- Urutan resolusi (`schedule_of`): `employees.schedule_code` → pola bawaan unit → tidak ada. Orang tanpa pola ditandai *tanpa jadwal*; ia tidak punya jam masuk acuan sehingga **keterlambatannya tidak dihitung** (bukan berarti tepat waktu).
- Pola hasil seed produksi: `PRODUKSI` (07.30–16.30, istirahat 45 mnt, Jumat pulang 16.00 dan istirahat 90 mnt), `KANTOR` (08.00–17.15, istirahat 60 mnt), `SATPAM`, `HELPER` — nilai persisnya baca di layar (data, bukan konstanta).
- Pola tanpa jam yang dipastikan ditandai **belum dikonfirmasi** (mis. SATPAM) dan jam mingguannya kosong dengan alasan, bukan nol.

#### Jejak data (apa yang terekam)
`ops_hr.pay_rule_sets` (versi baru dengan `schedules`, `schedule_by_unit`; `created_by`, `note`), audit. Tidak ada dokumen.

#### Serah-terima ke tim lain
IT memegang buku aturan (angka gaji); Produksi tidak membaca pola. Penggajian membaca pola per hari saat menghitung.

#### Koreksi & pengecualian
Salah jam → tulis versi baru pada **tanggal yang sama** (koreksi duduk di tanggal yang dikoreksi; nomor lebih tinggi menang). Perubahan **tidak bisa mundur melewati run yang sudah APPROVED/PAID**; koreksi lewat *Penyesuaian* di periode berikutnya.

#### Checklist rutin
Harian/mingguan: kartu *Pola belum lengkap* dan *"N karyawan belum punya jadwal"* harus nol. Setiap ada orang pindah unit: cek apakah ia ikut bawaan unit atau dipasang sendiri (pola yang dipasang **tidak ikut pindah unit**, bawaan unit ikut).

#### Sumber
`src/app/(app)/hrd/jadwal/page.tsx`, `src/services/hr/schedule-rules.ts`, `src/app/(app)/it/aturan-gaji/ScheduleEditor.tsx`, migrasi `0059`, `0113`, `0117`, `0186`, `0191`, `0195`, `0206`, `0207`; D270, D274, D279, D281, D289, D291, D335, D340, D341, D364, D365; F70, F216.

---

### Absensi: impor file mesin sidik jari dan tap yang terlewat

#### Tujuan
Memasukkan **setiap tap** mesin sebagai baris (bukan "hari"), membacanya menjadi hari kerja, dan memastikan **tidak ada hari yang "belum dibaca"** sebelum gaji disetujui.

#### Pemilik / peran & kewenangan
**Staf HRD**: impor file dan menambah tap = `hrd.create` (`ops_hr.import_scans`, `ops_hr.add_scan`); membaca absensi = `hrd.read`. Karyawan membaca absensinya sendiri (14 hari) di `/saya` dan `/profil`.

#### Prasyarat
Semua orang di file sudah terdaftar di *Karyawan* dengan **nomor mesin yang sama**. File ekspor mesin tersedia (`.xlsx`, `.xls`, `.csv`, `.tsv`) dengan kolom (judul boleh di baris mana pun dalam 30 baris pertama): **No.** (nomor mesin) dan **Date/Time** wajib; **Name, Location ID, VerifyCode** dibawa apa adanya. Format tanggal `DD/MM/YYYY H:MM:SS` atau `YYYY-MM-DD HH:MM:SS`; serial tanggal Excel dikonversi per detik.

#### Langkah-langkah
1. Staf HRD → HRD › *Absensi* (`/hrd/absensi`; judul layar *Timesheet*) → tombol **Upload biometric file / Unggah file biometrik**.
2. Pilih file → layar membaca dan menampilkan ringkasan **Taps / Tap**, **People / Orang**, **Period / Periode**, dan jumlah baris yang tak terbaca (dilewati). Waktu dibaca sebagai **WIB**, "sesuai yang ditulis mesin".
3. Tombol **Import N tap(s) / Impor N tap** → hasil: **Added / Ditambahkan**, **Already on file / Sudah tercatat** (duplikat), **Unknown number / Nomor tidak dikenal** (nomor + jumlah tap), **Taps after somebody left / Tap setelah orangnya keluar** (disisihkan, disebut dengan tanggal keluar). File **tidak pernah ditolak** karena orang yang tak dikenal (D337).
4. Nomor tak dikenal → tambahkan orangnya di *Karyawan* → **unggah ulang file yang sama** (tap yang sudah masuk tidak ganda; kunci `unique (employee_id, at)`).
5. Hari yang tapnya kurang → klik sel hari → laci hari → **Tap the machine missed / Tap yang terlewat mesin** → isi jam dan **alasan** (mesin mati, jari tidak terbaca…) → **Add tap / Tambah tap** → tap berumber `manual` dan alasan tersimpan; mesin tetap sumber kebenaran untuk tap lain.
6. Baca layar: tiap sel = angka besar **jam dibayar**, angka kecil **jam kerja aktual** (tap pertama→terakhir dikurangi istirahat jadwal, D362); kuning `n tap` = perlu dibaca; merah = kurang dari jadwal (telat/pulang cepat); `×2` = dibayar dengan pengali jadwal; bulan = shift malam; `—` = tak ada tap. Tampilan **5 days / 5 hari** (5 hari kalender sampai hari ini) atau **Week / Minggu** (bawaan **Jumat–Kamis**, atau hari awal minggu menurut buku aturan); dua tabel terpisah: **Weekly — paid by the day / Mingguan — dibayar per hari** (bruto estimasi) dan **Monthly — on a salary / Bulanan** (tunjangan + lembur hari-hari itu), masing-masing dengan total jam dan estimasi gaji (D345).

#### Aturan & kontrol
- **Tiga cara baca hari** (`day_reading` di buku aturan; IT yang memilih di `/it/aturan-gaji` → *Situasi 5 — Cara membaca satu hari*):
  - `slots` (bawaan lama): enam tap ditempatkan ke slot (*Masuk, Istirahat keluar, Istirahat masuk, Pulang, Lembur mulai, Lembur selesai*); hari yang tak cocok → status `review`.
  - `schedule` (D340): ada tap = hadir; jam normal dibaca terhadap jadwal **hari itu**; tap lebih/kurang tidak membuat `review`; pembulatan 15 menit (`hours_rounding_minutes`).
  - `in_out` (D353, **"Tap datang & pulang saja"**): hanya tap pertama (datang) dan terakhir (pulang) wajib; istirahat dipotong sesuai jadwal tanpa tap; jam dibayar = min(pulang, jadwal pulang) − max(datang, jadwal masuk) − istirahat, dibulatkan 15 menit, **maksimum kuota jadwal** (mis. 8,25); telat/pulang cepat = kurang, dicatat *"Kurang x jam dari jadwal"* dan sel merah (tidak memotong upah harian kecuali aturan *undertime* dinyalakan); **satu tap = review** ("Tidak ada tap pulang — tap datang dan pulang wajib"). Lewat jadwal pulang tampil sebagai lembur **tetapi tidak dibayar dari mesin** (D138). Menurut F216 produksi memakai cara baca ini sejak versi buku aturan yang diterbitkan IT pada 1 Okt 2026 — konfirmasi di layar *Aturan penggajian*.
- **Status hari** (`DayState`): `complete` (terbaca bersih), `review` (perlu dibaca — **menahan persetujuan run**), `marked` (HRD menyatakan apa yang terjadi), `off` (tak ada tap).
- Penolakan: `import`: `not_permitted`, `empty_file`; `add_scan`: `not_permitted`, `reason_required` ("A time somebody typed needs to say why the machine missed it."), `not_found`, `already_recorded`.
- Tanda `after_left` dan `unknown` **tidak membuat siapa pun** dan tidak memasukkan tap-nya.
- Tap tidak pernah dihapus atau diubah; tidak ada `UPDATE` jam. Hari yang belum terjadi digambar *belum*.
- **Pengecualian jam kantor:** semua jam WIB; impor lama (sebelum 29 Sep) digeser +1 jam oleh `0190` supaya terbaca persis seperti mesin; tap dari HP tidak digeser.

#### Jejak data (apa yang terekam)
- `ops_hr.attendance_imports` (nama file, jumlah baris dilihat/ditambah/duplikat, nomor tak dikenal, `after_left_refs`, siapa, kapan); `ops_hr.attendance_scans` (karyawan, `work_date`, `at`, `verify`, `location`, `source` = `import` | `manual` | `self`, `import_id`, `reason`, `recorded_by`). Audit per impor dan per tap manual.
- **File ekspor mesin itu sendiri tidak diarsipkan ke Drive** (hanya barisnya). Tidak ada dokumen terlampir pada impor.

#### Serah-terima ke tim lain
Penggajian membaca tap langsung; Produksi (`/produksi/…`) boleh membaca jam hadir vs jam timeslot bila pembacanya berhak membaca absensi (D352); KPI membaca ketepatan masuk (khusus yang memakai mesin).

#### Koreksi & pengecualian
- Tap salah/hilang: tambah tap yang terlewat (dengan alasan). Tap berlebih tidak dihapus — cara baca `schedule`/`in_out` mengabaikannya; pada `slots` ia membuat hari `review`.
- Orang tidak tap sama sekali (kantor tidak memakai mesin): tidak ada tanda → hari tidak dihitung; bulanan tetap dibayar sebulan penuh apa pun kata mesin.
- Impor ulang aman. Impor minggu yang sudah APPROVED/PAID **tidak dijaga** (lihat Kesenjangan, F207).

#### Checklist rutin
- **Harian (pagi):** unduh ekspor mesin hari kemarin → impor → baca ringkasan → tangani *Unknown number* dan *after left* → kartu **Days to read / Hari untuk dibaca** harus menuju nol → tangani sel kuning (tap yang terlewat atau tanda hari).
- **Kamis:** semua hari Jumat–Rabu terbaca (Kamis diasumsikan penuh bila `pay_week_assume_last_day` menyala).

#### Sumber
`src/app/(app)/hrd/absensi/{page,ImportScans,DayDrawer}.tsx`, `src/lib/biometricFile.ts`, `src/lib/office.ts`, `0044`, `0053`, `0186`, `0190`, `0192`, `0195`, `0199`; D137, D141, D143, D337, D334, D345, D350, D353, D354, D357, D362; F40, F191, F193, F199.

---

### Menandai hari (tanggal merah, sakit, izin, cuti, setengah hari), surat dokter, dan tunjangan ditahan

#### Tujuan
Menyatakan **apa yang terjadi pada sebuah hari** ketika mesin tak bisa tahu — tanpa menyentuh satu tap pun — dan menentukan apakah hari itu dibayar.

#### Pemilik / peran & kewenangan
Menandai dan melampirkan surat dokter: `hrd.create` (`ops_hr.mark_day`, `ops_hr.attach_surat_dokter`). **Menarik tanda, menahan/mengembalikan tunjangan: `hrd.update`** (`withdraw_mark`, `withhold_allowance`, `restore_allowance`). Semua = **Staf HRD**.

#### Prasyarat
Kejadian diketahui (tanggal, siapa, alasan). Untuk sakit: foto surat dokter (boleh menyusul).

#### Langkah-langkah
1. **Tanda untuk satu orang:** HRD › *Absensi* → klik sel hari orang itu → laci hari → **Mark this day for <nama> / Tandai hari ini untuk <nama>** → pilih jenis → isi **Reason / Keterangan** (wajib) → tombol **Mark as <jenis> / Tandai sebagai <jenis>** → nomor `dmk-YY-MM-DD_NN`. Jenis: `holiday` *Tanggal merah*, `half_day` *Setengah hari*, `absent` *Tidak masuk*, `sick` *Sakit*, `leave` *Cuti*, `permit` *Izin*.
2. **Tanda untuk semua orang:** klik judul tanggal di tabel → **Mark for everybody / Tandai untuk semua orang** (isi keterangan, mis. nama hari libur). Dipakai terutama untuk tanggal merah; kode dan layar mengizinkan keenam jenis (cuti bersama, setengah hari karena listrik padam, dst.).
3. **Surat dokter:** pada hari bertanda `sick` tombol **Attach doctor's note / Lampirkan surat dokter** → pilih foto → diunggah (jenis `Surat Dokter`) dan ditautkan ke `dmk-…` → hari itu **sekarang dibayar penuh** (tanpa hitung ulang karena tak ada yang disimpan; bisa menyusul berhari-hari).
4. **Menarik tanda yang salah:** pada tanda → **Withdraw this mark / Tarik tanda ini** → alasan → **Withdraw / Tarik**. Tanda tetap tercatat (`withdrawn_at/by/reason`); yang dibaca pembaca berikutnya adalah alasannya.
5. **Tunjangan hari ini:** laci hari → **Withhold this day's allowance / Tahan tunjangan hari ini** → alasan (WFH, setengah hari, tidak masuk…) → **Withhold allowance / Tahan tunjangan**; untuk membatalkan **Restore / Kembalikan** (alasan pengembalian diminta lewat kotak isian).

#### Aturan & kontrol
- **Nilai hari yang dibaca penggajian** (`v_day_mark_value`): hari biasa/hadir = 1; `half_day` = 0,5 (tetap dapat tunjangan penuh — D272, kecuali switch `allowance_by_day_value`); `sick` = 1 **hanya bila surat dokter terlampir**, selain itu 0 ("sakit, surat dokter belum ada"); `leave` = 1 selama hari ke-n cuti tahun itu ≤ `paid_leave_days` orang itu, selebihnya 0 ("cuti, melewati jatah N hari"); `permit` = 0 ("izin, tidak dibayar"); `absent` = 0 ("alpa"); hari kantor tutup (tanda `holiday` seluruh kantor) = 0 dan **tidak memotong jatah cuti** siapa pun.
- **Tanggal merah:** orang yang tetap masuk — jamnya menjadi lembur (aturan lama) atau dibayar `holiday_pay_multiplier`× upah sehari bila diaktifkan (pemilik: 2×, D340/D341).
- Penolakan: `mark_day`: `not_permitted`, `reason_required`, `not_found`, `already_marked` ("<tgl> is already marked as … for … / for everybody"). `withdraw_mark`: `not_permitted`, `reason_required`, `not_found`, `already_withdrawn`. `attach_surat_dokter`: `not_a_sick_day`. `withhold_allowance`: `reason_required`, `already_withheld`. `restore_allowance`: `reason_required`, `already_restored`.
- Satu hari = satu tanda aktif per orang (`mark_once` hanya untuk tanda yang belum ditarik). **Tanda tidak pernah menimpa tap dan tap tidak pernah menimpa tanda** (D142).
- Keterlambatan: **menit** dihitung melewati toleransi 15 menit; **potongan** hanya bila buku aturan `late_mode = pro_rata` (bawaan `manual`, mati); keterlambatan **tidak** menghapus tunjangan (D250) — hanya HRD yang menahannya, terpisah, dengan alasan sendiri.
- Tanda "acara kantor": hari libur tanpa upah; yang bekerja ×1; yang hanya datang (tap tanpa kerja) ditandai HRD per orang (D342).

#### Jejak data (apa yang terekam)
`ops_hr.day_marks` (`mark_no`, tanggal, karyawan atau NULL, jenis, alasan, `marked_by`, kolom penarikan), `ops_hr.allowance_withholdings` (append-only, `restored_*`), tautan lampiran entity `day_mark` jenis `surat_dokter`. **Drive HRD** (data pribadi), folder `ops-talaliving/CUTI IZIN SAKIT/SURAT DOKTER`. Audit tiap tindakan.

#### Serah-terima ke tim lain
Penggajian (nilai hari, tunjangan, slip menulis alasan); tidak ada tim lain yang membaca tanda.

#### Koreksi & pengecualian
Tarik tanda lalu tandai ulang. Surat yang datang terlambat: lampirkan kapan saja. Tunjangan salah ditahan: **Restore**. **Tidak ada penjagaan** terhadap menandai/menarik tanda pada periode yang sudah APPROVED/PAID (angka run akan ikut bergeser — lihat Kesenjangan).

#### Checklist rutin
Harian: sel merah/kuning yang tersisa; tanggal merah nasional sudah ditandai **sebelum** Kamis; sakit tanpa surat (`sick_without_letter` di kartu *Sisa hak cuti*) ditagih suratnya.

#### Sumber
`src/app/(app)/hrd/absensi/{DayDrawer,MarkDay}.tsx`, `0049`, `0053`, `0057`, `0187_hr_sick_note`, `0195`; D142, D144, D250, D251, D272, D285, D340–D342; F101.

---

### Presensi berlokasi (tap dari HP) dan lokasi kerja

#### Tujuan
Membiarkan karyawan lantai/satpam mencatat masuk/pulang dari **HP sendiri**, dengan lokasi dibaca **sekali saat tombol ditekan**, dinilai terhadap lokasi kerja, dan yang di luar area **ditandai, tidak pernah ditolak**.

#### Pemilik / peran & kewenangan
- Tap: **karyawan** (akun tertaut; `ops_hr.tap_self`, tanpa modul).
- Mengatur lokasi kerja: **Staf HRD** `hrd.update` **atau** IT `it.update` (`save_work_site`, `remove_work_site`).
- Meninjau tap berlokasi: `hrd.read`.

#### Prasyarat
Akun tertaut ke karyawan (IT). **Titik lokasi sudah diatur** (tanpa titik → verdict `no_site`: tap tercatat satu tekan, tidak dinilai, tidak ditandai). Izin lokasi browser diberikan.

#### Langkah-langkah
1. **HRD/IT menyiapkan lokasi:** HRD › *Presensi berlokasi* (`/hrd/absensi/lokasi`) → **Add location / Tambah lokasi** → **Code/Kode** (2–20 huruf besar/angka, mis. `GUDANG`, tidak bisa diubah setelah disimpan), **Name/Nama**, **Latitude/Lintang**, **Longitude/Bujur**, **Radius (metres)** (bawaan 150 m; 20–2000), **Active / Aktif** → berdiri di lokasi dan tekan **Use my current location / Pakai lokasi saya sekarang** → **Check the point on the map / Cek titiknya di peta** → **Save / Simpan**. Tombol **Where am I against them? / Posisi saya terhadap lokasi?** untuk menguji.
2. **Karyawan** → `/saya` tab **Presensi** (atau `/profil` › *Presensi*) → jam besar waktu kantor + keadaan hari ini (*Not in yet / Belum masuk*, *In 07:28 / Masuk 07:28*, *Out 16:35 / Pulang 16:35*) → satu tombol bernama **CLOCK IN / MASUK**, **CLOCK OUT / PULANG**, atau **TAP AGAIN / TAP LAGI** (dibaca dari tap hari ini; tombol tidak memutuskan apa pun — hanya menulis tap, D141) → HP membaca lokasi (akurasi tinggi, `maximumAge 0`, batas 15 detik).
3. **Di dalam area:** satu tekan → toast *Tap recorded · HH:MM / Tap tercatat · HH:MM*.
4. **Di luar area / kurang tepat / tanpa lokasi:** form menuntut **Note / Keterangan** (wajib; mis. "ambil kayu di pemasok"), foto opsional (**Selfie / Swafoto** atau **Photo of the place / Foto tempat**) → **Record attendance / Catat presensi** → tap ditulis **dan ditandai** untuk HRD.
5. **HRD meninjau:** `/hrd/absensi/lokasi` → kartu **Taps to look at / Tap yang perlu dilihat** (filter **From/to**, **Flagged only / Hanya yang ditandai**; tiap baris: verdict, jarak, ±akurasi, keterangan, **Photo / Foto**, **Open in maps / Buka di peta**) dan peta **Where people tapped / Lokasi absen karyawan** di bawah tabel *Absensi* (satu hari; hijau = di area; kuning = di luar/kurang tepat; mesin sidik jari = satu titik di lokasinya).

#### Aturan & kontrol
- Penilaian satu fungsi (`ops_hr.judge_location`) atas **seluruh lingkaran akurasi**: `inside` bila jarak + akurasi ≤ radius; `outside` bila jarak − akurasi > radius; `uncertain` selain itu; `no_location` bila HP tak memberi titik; `no_site` bila belum ada titik lokasi aktif. Dinilai terhadap lokasi **aktif terdekat**.
- Penolakan: `no_employee_link` ("Akun ini belum tertaut ke data karyawan… Minta HRD menautkannya."), `bad_location`, `off_site_needs_note` (membawa verdict di `detail`; itu isyarat HP menampilkan form), `photo_not_found`, `photo_not_yours`. Lokasi: `not_permitted` ("Titik lokasi kerja diatur oleh HRD atau IT."), `bad_code`, `name_required`, `point_required`, `bad_radius`; `site_in_use` ("<kode> sudah dipakai menilai N tap, jadi tidak bisa dihapus — nonaktifkan saja").
- Tap HP = tap biasa berumber `self`; tidak menentukan masuk/pulang; dibaca sama dengan tap mesin (D141). Tap mesin di layar HRD dilabeli lokasi `GUDANG` (atau lokasi aktif pertama) dengan tautan peta (D344).
- Lokasi **tidak dilacak berkala** (W8 dibatalkan): hanya saat tap.

#### Jejak data (apa yang terekam)
`ops_hr.attendance_scans` (`source = self`), `ops_hr.scan_locations` (bacaan lokasi per tap: verdict, jarak, akurasi, catatan, titik, foto) dibaca lewat view `ops_hr.v_located_tap`, `ops_hr.work_sites`. **Nomor tap** `B-1841/2026-09-29T07:25:03.000000` (`employee_no/waktu kantor`). Foto: jenis `foto_presensi` → drive **HRD** (data pribadi: wajah + tempat), folder `ops-talaliving/PRESENSI LUAR AREA`, tertaut entity `attendance_scan`. Activity feed pribadi: `attendance_tap`.

#### Serah-terima ke tim lain
IT: akun + titik lokasi bila HRD tak ada di lokasi. Penggajian: membaca tap seperti biasa.

#### Koreksi & pengecualian
Tap salah → tidak dihapus; HRD menambah tap lain/menandai hari. Lokasi pindah gudang → tambah lokasi baru, nonaktifkan yang lama (jangan hapus bila sudah menilai tap).

#### Checklist rutin
Harian: kartu *Taps to look at* dengan *Flagged only*; konfirmasi alasan wajar. Bulanan: titik lokasi masih benar.

#### Sumber
`src/components/attendance/located-tap.tsx`, `src/app/(app)/saya/presensi.tsx`, `src/app/(app)/hrd/absensi/lokasi/page.tsx`, `src/services/hr/tap-where.ts`, `0164`, `0184`, `0188_hr_located_tap`, `0196_hr_work_sites_manage`; D307, D331, D332, D343, D344, D361; F189; W8 (dibatalkan).

---

### Shift malam dan shift satpam

#### Tujuan
Membaca kerja yang **melewati tengah malam** (satpam 12 jam) sebagai **satu hari kerja milik hari shift itu dimulai**, dan membayar **1 shift = 1 hari upah**, shift mana pun.

#### Pemilik / peran & kewenangan
Mengatur shift dan memilih shift sebuah hari: **Staf HRD** `hrd.update` (`set_schedule_shifts`, `pick_shift`). Karyawan hanya tap.

#### Prasyarat
Satpam dipasang pada pola `SATPAM` (per orang). Shift diatur: **Shift 1** 07.00–17.00 dan **Shift 2** 17.00–07.00, tanpa istirahat (D364). Pola SATPAM semula satu pola 19.00–07.00 (D330, "belum dikonfirmasi"); **shift berlaku setelah HRD menyimpan shift-nya** (per README, produksi per 2026-10-01 masih menunggu langkah ini).

#### Langkah-langkah
1. HRD › *Jadwal kerja* → baris `SATPAM` → **Shifts / Shift** → tombol **Use Satpam's two shifts / Pakai 2 shift Satpam** (atau **Add shift / Tambah shift**: kode, nama, masuk, pulang, istirahat opsional; ikon bulan = berakhir esok pagi) → **In force from**, **Why** → **Save shifts / Simpan shift**.
2. Satpam tap seperti biasa (mesin/HP). Sistem membaca rangkaian tap menjadi shift: dua tap < 1 jam = satu tap; pilihan HRD diutamakan; sisa tap dibentuk pasangan yang cocok dengan satu shift (masuk ±4 jam dari jam masuk shift, pulang ±4 jam dari jam pulangnya) dari awal rangkaian; tap sisa = **sedang berjalan** (tap terakhir, shift belum selesai) atau **tanpa pasangan** (review).
3. Bila tap tak bisa memastikan shift: HRD → *Absensi* → klik sel hari → bagian shift → pilih shift (**Pick a shift… / Pilih shift…**) → isi alasan (mis. "buku jaga") → **Pick / Pilih**. Kembali ke bacaan tap: **Read from the taps again / Kembalikan ke bacaan tap**.
4. Sel absensi menampilkan `S1`/`S2`; laci hari menulis *"Read as Shift 2 / Dibaca sebagai Shift 2"*.

#### Aturan & kontrol
- **Hari = shift yang mulai pada hari itu**; `work_date` tap tetap hari kalender tap (D141) — yang berubah adalah bacaannya (batas hari tiap orang `day_begins`).
- Jam dibayar = jam shift paling banyak (cara baca `in_out`), kurang = merah; melewati jam pulang = lembur yang **tampil** dan hanya dibayar lewat lembar lembur (D138); telat dihitung dari jam masuk shift-nya.
- Minggu: satpam dibayar hari Minggu **hanya bila masuk** (×2 untuk pola Senin–Sabtu, D341/D342; tidak ada Minggu yang dibayar otomatis). D341 (sebelum shift D364) menyatakan dua shift dalam satu Minggu = satu hari ×2 dengan shift kedua dicatat sebagai lembur yang disetujui; apakah aturan itu masih dipakai setelah D364 tidak dinyatakan di kode — tanyakan pemilik.
- Penolakan: `shift_unknown`, `date_required`, `reason_required`, `already_paid` ("sudah ditandatangani untuk tanggal itu. Koreksinya lewat penyesuaian di periode berikutnya."); `shifts_too_many` (>6), `shift_code`, `shift_code_duplicate`, `overnight_friday_end`.
- Pola tanpa shift berperilaku seperti sebelumnya.

#### Jejak data (apa yang terekam)
Versi buku aturan baru (`shifts` dalam pola), `ops_hr.shift_picks` (HRD memilih; RLS baca HRD/payroll/dirinya, tulis hanya lewat `pick_shift`), audit.

#### Serah-terima ke tim lain
Penggajian membaca `shift_code` per hari; slip menulis shift.

#### Koreksi & pengecualian
Shift salah dibaca → *Pick* / *Read from the taps again* (tidak untuk hari yang sudah dibayar).

#### Checklist rutin
Harian: sel satpam bertanda `tanpa pasangan` / `sedang berjalan`; pastikan ke-2 shift pagi/sore terbaca.

#### Sumber
`src/services/hr/shift-reading.ts`, `src/app/(app)/hrd/jadwal/page.tsx`, `DayDrawer.tsx`, `0186_hr_overnight_shift`, `0206_hr_shift_reading`; D330, D335, D341, D342, D364; F187, F215.

---

### Lembur (lembar produksi, sesi staff, form scan, pengajuan sendiri) dan persetujuan

#### Tujuan
Lembur **diajukan dan disetujui, tidak pernah disimpulkan dari mesin** (D138): jam lewat jam kerja **tampil** di absensi tetapi hanya jam yang disetujui masuk slip.

#### Pemilik / peran & kewenangan
- Membuat lembar, menambah nama, upload form: **Staf HRD** `hrd.create`; memeriksa jam (langkah `hrd`): `hrd.update`.
- **Tanda tangan pimpinan** (lembur produksi): wewenang **`approve_overtime`** ("Menyetujui lembur (pimpinan)") — **bukan** level modul; pemegang `hrd.update` tanpa wewenang ini tidak bisa (D24, D147).
- Memutuskan **pengajuan sendiri**: `hrd.update` **atau** `approve_overtime`, salah satu, sekali (D333). Layar `/hrd/lembur` terbuka untuk `hrd.read` atau `payroll.read` (lembar) / `hrd.read` atau `approve_overtime` (antrian).
- Mengajukan sendiri: **karyawan** (akun tertaut).

#### Prasyarat
Kerja lembur sudah terjadi (atau hari ini). Produksi: **surat lembur** bertanda tangan terlampir. Pengajuan sendiri: *deliverable* (untuk apa lemburnya).

#### Langkah-langkah
**A. Lembar produksi** (satu malam, banyak nama; juga laporan produksi)
1. HRD › *Lembur* (`/hrd/lembur`) → **Production sheet / Lembar produksi** → **Work date / Tanggal kerja**, **Why the overtime / Kenapa ada lembur** (wajib) → tiap nama: karyawan, jam, tugas, **Order / Pesanan** (nomor Job Order), **Stage / Tahap**, jumlah selesai; **Add name / Tambah nama** → **Create sheet · N names / Buat lembar · N nama** → nomor `lbr-YY-MM-DD_NN`, tahap `waiting_hrd`.
2. Lampirkan **Surat lembur (tanda tangan)** → tahap `waiting_surat` → bila sudah ada tahap `waiting_leader` setelah HRD.
3. HRD **Check & pass on / Periksa & teruskan** (atau **Decline / Tolak** + alasan) → `hrd_checked_at`.
4. **Pimpinan** (`approve_overtime`) → **Sign & report production / Tanda tangani & laporkan produksi** (aktif hanya bila surat terlampir) → tahap `approved`; layar lalu mem-posting **satu timeslot per baris** ke papan Job Order (`production.recordWorkSlot`, sumber `overtime_sheet`, D352) — tanda tangan = laporan produksi per orang.

**B. Sesi staff** (satu sesi, satu orang, laporan pekerjaan)
1. **Staff session / Sesi staff** → tanggal, alasan, nama + jam + tugas (+ **Deliverable** opsional) → lampirkan **Laporan pekerjaan (screenshot)**.
2. HRD **Review — still paid / Tinjau — tetap dibayar** (`paid_checked`) atau **Not paid / Tidak dibayar** + alasan (`unpaid`). **Tanpa keputusan pun dibayar** (`paid_default`, "Dibayar — belum ditinjau") — tanpa tanda tangan pimpinan (D146).

**C. Upload form** (form kertas perusahaan `NO · NAMA · DESCRIPTION · GAJI · JAM · TTD`)
1. Buka lembar yang **belum diperiksa** → **Upload form / Upload form lembur** → pilih xlsx/csv → ringkasan (baris terisi, total jam, total gaji di form) → **Add N rows / Masukkan N baris**. Nama dicocokkan **per nama** (satu-satunya identitas di kertas); nama tak dikenal dilaporkan dan **barisnya tidak masuk** (tidak ada orang dibuat); nama yang sudah ada tidak ditambah dua kali. Kolom **GAJI dibayar apa adanya** (`form_amount`); jam tanpa angka dibayar tarif biasa.

**D. Pengajuan sendiri** (karyawan)
1. HP: `/saya` › **Pengajuan** › **Overtime / Lembur** (atau `/profil` › *Lembur*) → **Date / Tanggal** (hari ini atau yang sudah lewat; **besok ditolak**), **Hours / Jam** (>0 s.d. 12), **What is this overtime for? (deliverable) / Lembur ini untuk menghasilkan apa?** (wajib), **What was finished / Apa yang selesai** (boleh menyusul), **Task**, **Photo of the work / Foto hasil kerja** → **Send overtime / Ajukan lembur** → sheet `lbr-…` jenis `staff`, `via = self`, tahap `waiting_hrd`.
2. Hasil menyusul dari riwayat: **Save / Simpan** (`add_overtime_result_self`) selama belum diputuskan.
3. HRD atau pimpinan (bukan orang yang sama): `/hrd/lembur` › kartu **Asked for by employees / Diajukan karyawan** → **Deciding as / Memutuskan sebagai** `HRD` atau `Pimpinan`, **Note / Catatan** → **Approve / Setujui** atau **Decline / Tolak** (catatan wajib bila menolak, dibaca karyawannya). Tahap `approved` / `declined`; label karyawan *Disetujui HRD* / *Disetujui pimpinan*.

#### Aturan & kontrol
- **Tahap lembar** (`OvertimeStage`, diturunkan, tidak disimpan): `waiting_hrd`, `waiting_surat`, `waiting_leader`, `approved` (produksi: dua tanda tangan → masuk slip), `paid_default`, `paid_checked`, `unpaid` (staff), `declined`.
- **Urutan produksi:** HRD dulu, baru pimpinan; pimpinan **ditolak** tanpa surat (`surat_required`: "Surat lembur belum dilampirkan. Pimpinan menandatangani suratnya — tanpa itu yang disetujui hanya angka."). HRD tidak ditolak tanpa surat (surat bisa menyusul).
- Penolakan: `create_overtime_sheet` `purpose_required`; `add_line` `sheet_closed` ("sudah diperiksa — nama baru masuk lembar baru"), `self_submitted`, `hours_required`, `task_required`, `already_on_sheet`; `decide_overtime_sheet` `bad_step`, `no_leader_needed`, `reason_required`, `empty_sheet`, `hrd_first`, `already_decided`, `surat_required`, `not_permitted`; `import_form` `sheet_closed`, `empty_form`; pengajuan sendiri: `no_employee_link`, `work_date_required`, `date_in_future`, `hours_out_of_range`, `deliverable_required`, `already_reported` (satu pengajuan per hari), `result_required` ("Hasil kerjanya belum ditulis. Yang disetujui adalah hasilnya, bukan jamnya saja.") — **menyetujui butuh hasil; menolak tidak**; **`own_overtime`** ("Lembur sendiri tidak bisa disetujui sendiri. HRD atau pimpinan yang lain yang memutuskan.").
- **Rumus lembur** (per malam, bukan per periode): bila baris membawa `form_amount` → dibayar **sebesar angka di form** (label *"Sesuai form lembur"*); mode `form_only` tanpa angka → 0; selain itu jam dibulatkan (`overtime_rounding_minutes`, bawaan 0), jam setelah `overtime_night_after_minutes` (mis. 1320 = 22.00) dibayar `overtime_night_multiplier`, sisanya per **tangga**: hari kerja `workday_tiers` (jam pertama 1,5×, selanjutnya 2×) atau hari libur/tanggal merah `restday_tiers` (tangga 2×/3×/4×, D173); mode `flat` = satu pengali; satu jam = tarif per jam (lihat *Gajian*), opsional `overtime_exact_hourly`. Nilai tangga yang berlaku dibaca di *Aturan penggajian*.
- **Dua jalan, aturan berbeda (D333):** lembar yang diketik HRD (`via = hrd`) staff = dibayar kecuali dimatikan; pengajuan sendiri = **diajukan**, dibayar hanya setelah disetujui.

#### Jejak data (apa yang terekam)
`ops_hr.overtime_sheets` (`sheet_no`, jenis, tanggal, tujuan, `hrd_checked_*`, `leader_approved_*`, `paid/unpaid_reason`, `declined_*`, `via`, `decided_by/at/as`, `decision_note`), `ops_hr.overtime_lines` (jam, tugas, `wo_no`, `stage`, `qty_done`, `form_amount`, `result_note`, `deliverable`, `until_minutes`), `v_overtime_stage`, `v_overtime_claim`. **Dokumen:** `Surat Lembur` (produksi) / `Laporan Lembur` (staff, foto kerja karyawan) — entity `overtime`, drive **HRD**, folder `SURAT LEMBUR` / `LAPORAN LEMBUR` (catatan: layar mengunggah surat produksi dengan jenis `Laporan Lembur` lalu menautkannya sebagai `Surat Lembur`; tujuan drive sama). File form scan **tidak diarsipkan** (hanya dibaca). Peristiwa `hr.overtime.approved` pada tanda tangan kedua.

#### Serah-terima ke tim lain
- **Penggajian:** hanya jam `payable` yang masuk slip; jam menunggu tampil sebagai *"N jam lembur di lembar yang belum selesai ditandatangani — tidak masuk angka ini"*.
- **Produksi:** tanda tangan pimpinan memposting timeslot per orang ke papan Job Order; `approve_overtime` diterima `production.recordProgress` hanya untuk sumber itu.
- **Pimpinan:** hanya perlu wewenang `approve_overtime`, bukan modul HRD.

#### Koreksi & pengecualian
Menolak yang sudah dikerjakan butuh satu kalimat. Nama baru setelah lembar diperiksa → **lembar baru** (tanda tangan harus tetap menunjuk apa yang ditandatangani). Lembar yang gagal memposting ke produksi menampilkan toast peringatan *"Sebagian tidak masuk papan produksi"*; tanda tangan sudah sah tetapi timeslot yang gagal harus dicatat ulang manual di Job Order (posting dilakukan dari layar, tidak atomik dengan tanda tangan; cara pengulangan otomatis tidak ada di kode).

#### Checklist rutin
Harian: kartu *Menunggu tanda tangan* dan antrian *Diajukan karyawan*. Kamis: lembar yang jatuh di minggu gaji sudah diputuskan (bila belum, jamnya jatuh ke run berikutnya — persetujuan run **tidak** ditahan oleh lembur yang menunggu).

#### Sumber
`src/app/(app)/hrd/lembur/**`, `src/app/(app)/saya/{overtime-form,overtime-ask,pengajuan}.tsx`, `0046`, `0054`, `0165`, `0189_hr_overtime_self_approval`, `0195`; D138, D145, D146, D147, D154, D173, D333, D352; F190.

---

### Cuti, izin, dan sakit (pengajuan dan keputusan)

#### Tujuan
Cuti/izin/sakit **diminta dulu, diputuskan, baru ditulis ke absensi**; sisa cuti dihitung dari tanda hari, tidak disimpan.

#### Pemilik / peran & kewenangan
Mengajukan untuk orang lain dan memutuskan: **Staf HRD** (`hrd.create` untuk `ops_hr.request_leave` atas nama orang lain; `hrd.update` untuk `decide_leave`). Karyawan mengajukan **untuk dirinya** tanpa modul (akun tertaut). Surat dokter pada pengajuan: peminta sendiri atau HRD saja.

#### Prasyarat
Rentang tanggal dan alasan. Sakit: foto surat dokter (wajib dibawa saat mengajukan dari HP; boleh menyusul). Cuti: hak cuti berbayar sudah diisi (setelah 1 tahun).

#### Langkah-langkah
1. **HRD:** *Cuti & izin* (`/hrd/cuti`) → **New request / Ajukan** → karyawan (dropdown menyebut sisa hari), **Kind / Jenis** (`Cuti`/`Izin`/`Sakit`), **From date / Dari tanggal**, **To date / Sampai tanggal**, **Reason / Alasan** → **Submit / Ajukan** → nomor `izn-YY-MM-DD_NN`, status **PENDING**.
2. **Karyawan (HP):** `/saya` › **Pengajuan** → pilih **Izin / Sakit / Cuti** → tanggal → alasan → untuk Sakit **Photograph the doctor's note / Foto surat dokter** → **Send request / Kirim pengajuan** (surat bisa menyusul dari riwayat: **No doctor's note yet — photograph it / Belum ada surat dokter — foto sekarang**). Atau `/profil` › *Cuti & izin*. John Lau dapat menyiapkan **draft** pengajuan yang tidak tersimpan sampai orang menekan *Ya, tulis* (D301).
3. **HRD memutuskan:** kartu *"N menunggu keputusan"* menampilkan **hari dibayar / tidak dibayar sebelum diputuskan**, bentrok dengan tanda lain, dan status surat → **Approve / Setujui** atau **Reject / Tolak** (alasan wajib, dibaca orangnya) → **APPROVED** menulis tanda hari `cuti`/`izin`/`sakit` untuk **setiap tanggal kalender** dalam rentang (kecuali hari yang sudah bertanda — dilewati, tidak ditimpa) dan membawa surat dokter ke tiap hari sakit; **REJECTED** tidak menulis apa pun.
4. Kartu *Remaining leave / Sisa hak cuti*: entitlement, terpakai, sudah disetujui (*booked*), sisa, lewat jatah, sakit tanpa surat.

#### Aturan & kontrol
- **Status** (`LeaveStatus`): `PENDING → APPROVED | REJECTED`; `CANCELLED` ada di enum dan tampil di `/saya`, **tetapi tidak ada seam yang menetapkannya** (belum bisa dibatalkan).
- Penolakan: `request_leave`: `no_employee_link`, `not_permitted`, `not_found`, `range_invalid`, `reason_required`, `overlaps_existing` ("<izn-…> sudah menutupi tanggal itu untuk orang yang sama."); `decide_leave`: `not_permitted`, `not_found`, `already_decided`, `reason_required`.
- **Jatah:** `paid_leave_days` per orang; `taken` = jumlah tanda cuti tahun itu dari tanda (tidak pernah disimpan); **tidak pernah ditolak karena melewati jatah** — hari lewat jatah tercatat dan **tidak dibayar** (D144, D178). Hanya `cuti` menghabiskan jatah; sakit dibayar dengan surat, izin tidak dibayar.
- **Hari kantor tutup** (tanggal merah) di dalam rentang: tidak dihitung dan tidak memotong jatah. **Akhir pekan di dalam rentang tidak dikecualikan oleh kode** (lihat Kesenjangan): ajukan rentang hari kerja saja sampai dikonfirmasi.
- Surat dokter yang tiba sesudah persetujuan ikut terbawa ke hari-hari sakit saat ditautkan (trigger), dan hari itu langsung dibayar.

#### Jejak data (apa yang terekam)
`ops_hr.leave_requests` (`request_no`, jenis, rentang, alasan, status, peminta, pemutus, `decision_note`), tanda `dmk-…` yang ditulis (alasan berformat `izn-…: <alasan>`), audit (hari yang ditandai/dilewati, jumlah surat terbawa). Surat: entity `leave_request` jenis `surat_dokter` → drive **HRD**, `ops-talaliving/CUTI IZIN SAKIT/SURAT DOKTER`. Activity pribadi: `leave_requested`.

#### Serah-terima ke tim lain
Penggajian (nilai hari). Tidak ada tim lain.

#### Koreksi & pengecualian
Persetujuan yang salah: **Withdraw** tanda-tandanya di *Absensi* (tiap hari) — tidak ada tombol "batalkan persetujuan". Tanda yang sudah ada dilewati — periksa daftar *skipped* di toast.

#### Checklist rutin
Harian: antrian PENDING. Bulanan: kartu `over` (lewat jatah) dan `sakit tanpa surat`.

#### Sumber
`src/app/(app)/hrd/cuti/page.tsx`, `src/app/(app)/saya/pengajuan.tsx`, `src/app/(app)/profil/page.tsx`, `0123_hr_leave_requests`, `0165`, `0187_hr_sick_note`, `0187_core_leave_link_entity`; D142, D144, D178, D285, D295, D301, D331, D349.

---

### Gajian: run mingguan (Jumat–Kamis) dan bulanan, penyesuaian, dan slip gaji

#### Tujuan
Menghitung gaji **bruto + penyesuaian** per orang untuk satu periode **langsung dari hari-hari kerja** (tap, tanda, cuti, lembur yang disetujui) dan menyiapkannya untuk disetujui pimpinan. Tidak ada tombol "hitung": angka dibaca ulang setiap halaman dibuka.

#### Pemilik / peran & kewenangan
- Membuka run, menambah/menarik penyesuaian: **Staf HRD dengan `payroll.run`** (modul `payroll` write; `ops_hr.open_payroll_run`, `add_adjustment`, `withdraw_adjustment`). Melihat run/slip: `payroll.read`. Menyetujui: lihat bagian berikutnya.
- Karyawan membaca slipnya sendiri (hanya run **APPROVED/PAID**; run DRAFT tidak terbuka untuk dirinya).

#### Prasyarat
- Semua hari dalam periode **terbaca** (kartu *Days unread / Hari belum dibaca* = 0), lembur yang jatuh di periode sudah diputuskan (kalau belum, jamnya jatuh ke run berikutnya).
- Buku aturan gaji berlaku pada tanggal awal periode; setiap orang punya pola jadwal; upah terisi.
- **Kalender gaji harian (D357):** minggu = **Jumat–Kamis** (`PAY_WEEK_STARTS_DEFAULT = 5`; `pay_week_starts_isodow` di buku aturan menimpa), **di-approve pimpinan hari Kamis, dibayar hari Jumat**; kerja hari Jumat dibayar minggu berikutnya. Karyawan **bulanan**: run per periode yang diketik (biasanya sebulan; tanggal ditentukan tangan).

#### Langkah-langkah
1. **Staf HRD (Kamis pagi)** → HRD › *Gajian mingguan* (`/hrd/payroll/minggu`) → pratinjau minggu tampil **sebelum ada run**; navigasi **Last week / Minggu lalu**, **This week / Minggu ini**, **Next week / Minggu depan**. Kartu: *Gross/Bruto*, *Take-home/Diterima*, *People/Orang*, *Days unread*.
2. Selesaikan hari belum dibaca di *Absensi* (tombol **Read them / Baca sekarang** di banner halaman run).
3. **Open this week's run / Buka run minggu ini** → run **DRAFT**, nomor `pyr-YY-MM-DD_NN`. (Periode lain, mis. bulanan: HRD › *Penggajian* `/hrd/payroll` → **Period from / Periode dari** … **to / sampai** → **Open a run / Buka periode gaji**.)
4. Periksa tabel **Every line / Semua baris**: dasar, Pokok, Tunjangan, Lembur (tangga per malam), Penyesuaian, **Take-home / Diterima**, peringatan per orang. Banner biru (bila `pay_week_assume_last_day` menyala) menyebut hari terakhir yang **diasumsikan penuh** dan tanggal lembur yang dibayar.
5. **Penyesuaian** (kartu **Deductions & additions / Potongan & tambahan**, hanya saat DRAFT): pilih karyawan, **Kind / Jenis**, nominal, **Reason / Alasan** (dicetak apa adanya di slip) → **Add / Tambahkan** (tambah) atau **Deduct / Potong** (kurang; disimpan bertanda negatif). Jenis (`AdjustmentKind`): `late` *Keterlambatan*, `sp` *Surat peringatan*, `carry_over` *Selisih periode lalu*, `advance` *Kasbon / potongan pinjaman*, `bonus` *Tambahan*, `other` *Lain-lain*; nomor `adj-YY-MM-DD_NN`. Menarik: ikon hapus pada baris.
6. **Payslips / Slip gaji** (halaman `/hrd/payroll/<pyr-…>/payslip`) → **Compact (8 per sheet) / Padatkan (8 per lembar)** atau **Show daily summary (6 per sheet) / Tampilkan rekap harian (6 per lembar)** → **Print / Cetak**. Slip memuat rekap hari (masuk/pulang/jam/lembur), *Hari dibayar*, *Jam lembur*, *Terlambat*, alasan penyesuaian, tunjangan yang ditahan beserta alasan dan siapa, dan peringatan (hari belum dibaca bertanda `?`, hari **asumsi**, lembur belum disetujui, sakit tanpa surat).
7. Serahkan ke pimpinan untuk persetujuan (bagian berikut).

#### Aturan & kontrol
- **Status run:** `DRAFT → APPROVED → PAID`, **tidak pernah mundur** (trigger `payroll_run_moves_forward`).
- Penolakan `open_payroll_run`: `not_permitted`, `period_invalid`, `period_overlaps` ("<pyr-…> sudah mencakup … Hari yang sama tidak dibayar dua kali."; juga dijaga constraint eksklusi). `add_adjustment`: `not_permitted`, `not_found`, `run_not_draft` ("Koreksinya masuk run berikutnya"), `amount_required`, `reason_required`. `withdraw_adjustment`: `already_withdrawn`, `run_not_draft`, `reason_required`.
- **Rumus per orang (`ops_hr.payroll_line_for`, dihitung di bawah buku aturan yang berlaku pada *tanggal awal periode*):**
  - **Pokok:** bulanan = `base_rate` tetap per bulan (tidak peduli mesin); harian = `round(Σ(nilai hari × pengali hari) × base_rate)`; per jam = `round(Σ(jam kerja × pengali) × base_rate)`.
  - **Nilai hari** 1 / 0,5 / 0 sesuai tabel pada *Menandai hari*; **pengali** = `pay_multiplier` hari itu dalam pola (mis. Sabtu/Minggu 2) atau `holiday_pay_multiplier` untuk tanggal merah; satu shift = satu hari.
  - **Tunjangan** = (jumlah hari hadir yang tidak ditahan) × `allowance_rate`. Hadir: harian/per jam = hari bernilai >0 (atau setengah hari); bulanan = hari bukan hari libur tanpa tanda, atau setengah hari. Switch: `allowance_on_premium_days` (hari berpengali >1 juga dapat tunjangan; bawaan ya), `allowance_by_day_value` (setengah hari = setengah tunjangan; bawaan tidak, D272).
  - **Harga satu jam** (`hourly_rate`): `company` (bawaan) = `round(upah setahun ÷ hari kerja efektif setahun ÷ jam sehari)` dengan upah setahun bulanan = `pokok × 12 + tunjangan × hari efektif`, harian = `(pokok + tunjangan) × hari efektif`, per jam = `(pokok × jam sehari + tunjangan) × hari efektif` (tunjangan ikut bila `hourly_includes_allowance`, bawaan ya); `statutory` = `round((pokok + tunjangan×hari/12) ÷ 173)` untuk bulanan. Hari efektif setahun = angka yang diketik IT (bawaan kode 300 bila tak ada). 173 = 40×52÷12, hanya konstanta tangga lembur (D249).
  - **Lembur:** lihat bagian *Lembur* (hanya jam yang `payable`).
  - **Undertime** (bawaan **off**): `pro_rata` = jam kurang × harga jam; `half_day_step` = kelipatan setengah hari × pokok/2; hanya untuk upah harian, hari bukan bertanda; toleransi `undertime_grace_minutes`.
  - **Keterlambatan:** menit melewati `late_grace_minutes` (15) dari jam masuk hari/shift itu; `late_priced` = menit/60 × harga jam; **dipotong hanya bila `late_mode = pro_rata`** (bawaan `manual` ⇒ 0; slip tetap mencetak menit dan rupiah yang *tidak* dipotong). Potongan manual diketik sebagai penyesuaian `late` — bila tidak ada keterlambatan di baliknya, layar **menandai** (tidak memblokir, D252).
  - **Bruto** = pokok + tunjangan + lembur − undertime − potongan terlambat (otomatis). **Net / "Diterima" di layar run** = bruto + Σ penyesuaian aktif. **Take-home di slip karyawan** = net − Σ iuran **bagian karyawan untuk skema yang memang didaftarkan** (kosong bila tak ada pendaftaran).
  - **Kamis diasumsikan penuh** (D357, saat `pay_week_assume_last_day` menyala, hanya non-bulanan, bila tidak ditandai HRD dan orangnya bekerja di hari itu): hari terakhir minggu bernilai 1 dengan jam terjadwal, tak pernah `review`, ditandai `assumed`; lembur yang dibayar = jendela digeser sehari (Kamis lalu s.d. Rabu), lembur Kamis dibayar minggu depan. Kamis yang ternyata tidak masuk/pulang cepat dikoreksi HRD **manual** di minggu berikutnya (penyesuaian).
- **Peringatan per orang** (kalimat di baris & slip): hari belum dibaca, lembur menunggu tanda tangan, jam lewat jam kerja yang belum diklaim siapa pun, sakit tanpa surat, cuti melewati jatah.
- Periode 7 hari atau kurang dianggap *weekly*, lebih panjang *monthly* (dipakai saat membukukan).

#### Jejak data (apa yang terekam)
`ops_hr.payroll_runs` (`run_no`, periode, status, `created_by`, `approved_by/at`, `paid_trx_no`, catatan), `ops_hr.payroll_adjustments` (`adj_no`, jenis, nominal bertanda, alasan, `withdrawn_*`), audit tiap pembukaan/penyesuaian. **Baris gaji per orang tidak disimpan** (dihitung saat dibaca). Slip tercetak: tidak ada file di Drive.

#### Serah-terima ke tim lain
Persetujuan pimpinan → pembayaran Keuangan (bagian berikut). Akuntansi **tidak membaca slip** (D213; `/accounting/payslip` dihapus); buku besar menyimpan **satu baris per run**.

#### Koreksi & pengecualian
- Run yang sudah APPROVED **tidak bisa diubah penyesuaiannya**; koreksi = penyesuaian di run berikutnya (jenis `carry_over` *Selisih periode lalu*, `late`, `bonus`, dst.).
- Salah periode: run DRAFT tidak bisa dihapus/dibatalkan oleh seam yang ada; periode bertumpuk ditolak (lihat Kesenjangan).
- THR/bonus/pesangon **tidak dihitung otomatis** — hanya bisa diketik sebagai penyesuaian `bonus`/`other` dengan alasan. PPh 21 **tidak dihitung** (D140, D277).

#### Checklist rutin
- **Kamis:** impor tap terakhir → *Days unread* = 0 → buka run minggu → periksa peringatan per orang → penyesuaian (kasbon, SP, selisih Kamis lalu) → cetak/siap slip → minta pimpinan approve.
- **Jumat:** lembur hari Kamis ikut run berikutnya; Keuangan membayar.
- **Bulanan (staf bulanan):** buka run bulan itu tangan; periksa tunjangan hari hadir + lembur.

#### Sumber
`src/app/(app)/hrd/payroll/**`, `0047`, `0050`, `0055`, `0057`, `0119`, `0186`, `0194_hr_period_lines_once`, `0195`, `0202_hr_pay_week_thursday`, `0206`; D139, D140, D155, D156, D157, D158, D173, D174, D176, D230, D249–D252, D272, D340, D350, D357; F40, F72, F195, F207, F216; Q41, Q56.

---

### Persetujuan run gaji dan serah-terima pembayaran ke Akuntansi

#### Tujuan
Run **disetujui pimpinan** (tanda tangan kedua), lalu **dibayar Keuangan** dari halaman run itu sendiri dengan **satu baris buku besar** dan bukti transfer; run menjadi PAID.

#### Pemilik / peran & kewenangan
- **Menyetujui:** pemegang wewenang **`approve_funds`** ("Menyetujui dana") — bukan level modul payroll (D24).
- **Membayar & membukukan:** modul `accounting` write (`accounting.create`) **dan** wewenang **`post_ledger`** (`ops_acct.post_payroll_run`). Menandai transaksi lengkap: Keuangan (`ops_acct.complete_transaction`).
- *Catatan:* tidak ada pemeriksaan bahwa penyetuju ≠ pembuka run; pemisahan tugas bergantung pada **tidak memberi `approve_funds` kepada orang yang menyiapkan run**.

#### Prasyarat
Run **DRAFT** dengan 0 hari belum dibaca, ≥ 1 orang. Untuk bayar: run **APPROVED**, bukti transfer (foto/PDF), nomor rekening sumber.

#### Langkah-langkah
1. **Pimpinan** → HRD › *Penggajian* → buka run (`/hrd/payroll/<pyr-…>`) → tombol **Approve the run / Setujui periode gaji** → **APPROVED**; toast *"Sudah bisa dibayar dari buku besar"*; event `payroll.approved`.
2. **Bank:** transfer gaji dilakukan di luar aplikasi (aplikasi tidak mengirim uang).
3. **Keuangan** → buka run APPROVED → kartu **Pay this run / Bayar run ini**: **Payment date / Tanggal bayar**, **Amount paid / Nominal dibayar** (terisi dari *Diterima* menurut run), **Paid from / Dibayar dari** (rekening), **Attach transfer proof / Lampirkan bukti transfer** → **Record Rp … to the ledger / Catat Rp … ke buku besar** → run **PAID**, `paid_trx_no`; transaksi `trx-YY-MM-DD_NNN` (3 digit urut).
4. Buku besar: baris **OUT**, jenis `RECCURING - PAYROLL WEEKLY` (periode ≤ 7 hari) atau `RECCURING - PAYROLL MONTHLY` (ejaan persis kode), keterangan `Gaji pyr-… (dd Mon s/d dd Mon yyyy)`, sumber `payroll:<run_no>`, dokumen jenis *Payment Proof*. Lanjutkan seperti transaksi lain di `/accounting/ledger` (**tandai lengkap**).

#### Aturan & kontrol
- `approve_payroll_run`: `not_permitted` ("Menandatangani gaji butuh wewenang approve_funds, bukan akses modul payroll."), `not_found`, `already_decided`, `empty_run` ("Tidak ada seorang pun di periode ini."), **`open_days`** ("N hari di periode ini belum dibaca …" — **ditolak, bukan peringatan**). Lembur yang menunggu tanda tangan hanya **peringatan** (jamnya jatuh ke run berikutnya), tidak menahan persetujuan.
- `post_payroll_run`: `authority_required` ("Posting to the ledger belongs to Accounting — logged, not applied."), `run_not_found`, `not_approved` ("Belum ada yang menandatangani run ini. Gaji dibayar setelah disetujui, bukan sebelum."), `already_paid` ("<pyr-…> sudah dibayar lewat <trx-…>."), `amount_positive`, `evidence_required` ("A payment needs its proof…").
- **Nominal yang dibayar boleh berbeda dari "Diterima"** — tidak ditolak; keduanya dicatat. Apakah run membayar bruto+penyesuaian atau dikurangi BPJS karyawan **belum diputuskan (Q56)**.
- Buku besar **tidak** memuat gaji per orang (D218): baris tunggal per run; rincian tetap di halaman run (hanya pembaca payroll).

#### Jejak data (apa yang terekam)
`payroll_runs` (`approved_by/at`, `paid_trx_no`, status), baris buku besar + dokumen bukti transfer (drive **ACCOUNTING**, pohon folder transaksi menurut bab Akuntansi / D359), audit kedua langkah, event outbox.

#### Serah-terima ke tim lain
**HRD → Akuntansi:** satu transaksi payroll per run (jenis mingguan/bulanan) agar kalender kas membaca realisasi terhadap rencana. **Akuntansi → HRD:** hanya nomor transaksi (`paid_trx_no`) dan status PAID.

#### Koreksi & pengecualian
Salah rekening/nominal pada transaksi: koreksi di buku besar (Edit rekening tanpa VOID, D359) — **bukan** di run. Run APPROVED tidak bisa kembali ke DRAFT.

#### Checklist rutin
Kamis: pimpinan approve; Jumat: Keuangan catat pembayaran + tandai lengkap transaksi; setiap minggu: tidak ada run APPROVED yang menggantung (status bukan PAID).

#### Sumber
`src/app/(app)/hrd/payroll/[run]/{page,PayRun}.tsx`, `0055`, `0149_acct_post_payroll_run`, `docs/sop/hr/simulasi-log.md` (langkah 26–33); D139, D213, D218, D302; F154; Q56.

---

### Aturan penggajian (buku aturan gaji) — dibaca HRD, diubah IT

#### Tujuan
Menyimpan semua **kebijakan angka gaji sebagai data bertanggal** (lembur, harga satu jam, undertime, keterlambatan, cara baca absensi, pengali hari libur, awal minggu gaji) supaya slip lama dapat dihitung ulang dengan aturan saat itu.

#### Pemilik / peran & kewenangan
- **Menulis versi baru: IT** — `it.update` (`ops_hr.save_pay_rules`). **Membaca: `payroll.read` atau `it.update`** (menu *Aturan penggajian* di bawah SDM; HRD melihat form lengkap tetapi **semua kontrol nonaktif** dengan penjelasan "View only / Lihat saja", D193). Alasan: satu perubahan menggeser gaji semua orang; HRD mengusulkan (lisan/di luar sistem), IT menulis.
- Pola jadwal & pola bawaan unit: HRD di `/hrd/jadwal` (D335, D365).

#### Prasyarat
Alasan perubahan; tanggal berlaku; pemahaman dampak (layar menghitung).

#### Langkah-langkah
1. IT → *Aturan penggajian* (`/it/aturan-gaji`; judul *Pay rules*) → versi berlaku tampil di atas (*In force since …*).
2. Ubah di **Situasi 1 & 2** (komposisi upah, dasar harga satu jam, hari kerja efektif setahun, pembagi 173, tunjangan ikut harga jam), **Situasi 3** (lembur: cara hitung, tangga, hari istirahat mingguan `6day`/`5day`, pembulatan), **Situasi 4** (undertime, toleransi, jam masuk perusahaan, toleransi terlambat 15, potongan keterlambatan, tunjangan hangus), **Situasi 5** (cara baca hari `slots`/`schedule`/`in_out`, pembulatan jam, jendela tap pulang, tanggal merah × upah, minggu gaji mulai hari, lembur lewat jam, tiga switch tunjangan/lembur, **Payroll mingguan di-approve di hari terakhir minggu**).
3. Kartu **Save as a new version / Simpan sebagai versi baru** (selalu tampil bagi editor): **Effective from / Berlaku mulai**, **Reason for the change / Alasan perubahan** → **See the effect / Lihat dampaknya** (membandingkan dengan periode nyata, orang yang bergeser) → **Save version / Simpan versi** → versi N+1 bertanggal. Layar menyebut rentang yang benar-benar akan dibaca versi ini (F216). **Discard changes / Batalkan perubahan** membuang draf. *Version history / Riwayat versi* tidak menghapus apa pun.

#### Aturan & kontrol
- **Versi tidak pernah diedit**; periode dihitung dengan versi yang berlaku saat periode dibuka (tanggal awal periode). Versi boleh bertanggal mundur **selama belum ada rupiah yang dihitung darinya** (D287); lebih tepatnya ditolak bila ada run APPROVED/PAID yang periodenya berakhir pada atau setelah tanggal itu (`already_paid`) atau tanggal jatuh di dalam run (`inside_existing_run`).
- Penolakan: `not_permitted` ("Mengubah aturan gaji butuh akses IT. Angkanya dari HRD; tangannya IT (D173)."), `note_required`, `rules_required`, `schedule_in_use` ("Buku baru tidak memuat pola yang masih dipakai: …"), kode pola `code`/`message` dari `schedule_problem`.
- Menurut `lib/live.ts` rute ini live; kunci opsional baru (D340/D353/D357) **berlaku hanya setelah IT menerbitkan versi yang menyalakannya**: buku tanpa kunci itu membaca dan membayar seperti sebelumnya.
- Contoh dampak (nilai yang berlaku dibaca di layar, bukan di bab ini): tangga lembur hari kerja 1,5× jam pertama lalu 2×; hari libur tangga 2×/3×/4× (D173); toleransi terlambat 15 menit (Q41); undertime off; late_mode manual.

#### Jejak data (apa yang terekam)
`ops_hr.pay_rule_sets` (`version`, `effective_from`, `note`, `rules` jsonb, `created_by`, `created_at`), audit.

#### Serah-terima ke tim lain
**HRD ↔ IT:** HRD menyampaikan angka/perubahan kebijakan; IT menerbitkan; HRD mengonfirmasi dampak di *Gajian*. Pemilik memutuskan kebijakannya.

#### Koreksi & pengecualian
Kekeliruan versi: terbitkan versi **pada tanggal yang sama** (nomor lebih tinggi menang), atau pada tanggal yang menutup rentang yang benar — lihat F216 (versi bertanggal mundur berhenti di tanggal versi berikutnya yang sudah ada). Perubahan tidak bisa menjangkau periode yang sudah dibayar.

#### Checklist rutin
Awal tahun: periksa **hari kerja efektif setahun** (kartu kalender `effective_days_calendar` membandingkan angka yang diketik dengan kalender perusahaan; kalender tanpa tanggal merah memperkirakan terlalu banyak hari). Setiap perubahan kebijakan: *Lihat dampaknya* dulu.

#### Sumber
`src/app/(app)/it/aturan-gaji/{page,ScheduleEditor}.tsx`, `src/services/hr/contracts.ts` (PayRules), `0059`, `0117`, `0118_hr_effective_days_calendar`, `0195`, `0199`, `0202`; D168, D173, D174, D190, D192–D194, D249–D251, D287, D291, D292, D365; F207, F213, F216; Q31, Q41, Q45.

---

### Iuran wajib (BPJS Kesehatan, BPJS Ketenagakerjaan, PPh 21 sebagai pendaftaran)

#### Tujuan
HRD mencatat **siapa yang terdaftar di skema apa**; Akuntansi mengaudit **tagihan** bulanan terhadap daftar nama itu (nama × tarif). Tarif publik, daftar nama yang bocor — itulah yang diaudit (D259).

#### Pemilik / peran & kewenangan
Mencatat/mengakhiri pendaftaran: **Staf HRD** (`hrd.create` / `hrd.update` — kebijakan RLS `enrolments`). Menulis tarif bertanggal: **IT** `it.update`. Membaca daftar & audit: `payroll.read` **atau** `accounting.read`.

#### Prasyarat
Karyawan terdaftar dan tanggal masuk ada. Tarif untuk bulan itu ada (kalau tidak, layar menulis "tidak ada tarif" — bukan tagihan nol).

#### Langkah-langkah
1. HRD › *Iuran wajib* (`/hrd/iuran`) → pilih bulan → per skema (`BPJS_KESEHATAN`, `JHT`, `JP`, `JKK`, `JKM`, `PPH21`) tambah pendaftaran: karyawan, skema, nomor peserta (disamarkan), tanggal mulai, dasar upah yang dilaporkan (opsional), catatan.
2. Mengakhiri pendaftaran: tanggal + **alasan wajib**; barisnya tetap ada (`ended_on`, `ended_reason`).
3. Layar menampilkan roll per skema: dasar (diumumkan atau catatan gaji), batas upah, bagian pemberi kerja dan karyawan, total yang seharusnya, bulan lalu + siapa yang masuk/keluar. Akuntansi membandingkan dengan jumlah tagihan yang sungguh dibayar (grup per faktur: satu tagihan BPJS TK mencakup JHT+JP+JKK+JKM).

#### Aturan & kontrol
- Iuran **tidak diprorata** (BPJS menagih bulannya; baris menyebut "masuk/keluar di tengah bulan"). PPh 21 **hanya pendaftaran**, tidak dihitung (D140, D277). Tarif **belum terkonfirmasi** ditandai (mis. JKK kelas II, Q49/D276).
- Slip: bagian **karyawan** skema yang terdaftar mengurangi *Take-home* slip karyawan; tanpa pendaftaran = tanpa potongan.
- Penolakan menurut `03-api.md`: 422 tanpa tanggal atau sebelum orang masuk; 409 `already_enrolled` pada pendaftaran terbuka kedua; akhiri tanpa alasan 422 (nama kodenya tidak diverifikasi dalam bab ini).

#### Jejak data (apa yang terekam)
`ops_hr.enrolments`, `ops_hr.contribution_rates` (bertanggal, `confirmed`), `v_enrolment`, `v_payroll_contribution`; nomor peserta disamarkan seperti nomor identitas.

#### Serah-terima ke tim lain
**HRD → Akuntansi:** daftar peserta per bulan; Akuntansi memeriksa faktur BPJS terhadap roll dan kalender kas (komponen *BPJS TK — …*). Nama yang keluar harus lepas dari roll sebelum tagihan berikutnya.

#### Koreksi & pengecualian
Pendaftaran salah: akhiri dengan alasan dan buat baru.

#### Checklist rutin
Bulanan (sebelum tagihan datang): roll bulan itu vs tagihan; yang keluar bulan ini sudah diakhiri pendaftarannya.

#### Sumber
`src/app/(app)/hrd/iuran/page.tsx`, `src/services/hr/contracts.ts`, `0051_hr_contributions`, `0090_acct_cash_component_schemes`, `docs/plan/03-api.md`; D140, D227, D259, D276, D277; Q30, Q49, Q56. **Rute ini belum live (demo saja)** — lihat Kesenjangan.

---

### Pemantauan tugas dan tugas rutin

#### Tujuan
Mencatat **apa yang diminta dari siapa, kapan jatuh tempo, kapan ditagih**, dan hasilnya — bukti untuk KPI. *Pimpinan lupa* dijawab dengan papan, bukan ingatan.

#### Pemilik / peran & kewenangan
- Memberi tugas, membuat dan menerbitkan tugas rutin: **Staf HRD** `hrd.create` (`ops_hr.assign_task`, `save_task_routine`, `roll_task_routines`). Mengubah status (selesai/tertahan/batal), menagih, menghentikan rutin: `hrd.update`.
- **Orang yang diberi tugas** boleh mengubah status tugasnya dan menandai **diterima** (`update_task`, `acknowledge_task`: pemilik tugas atau `hrd.update`) — dari `/profil` › *Tugas* (**Acknowledge / Terima**).

#### Prasyarat
Karyawan **aktif**; tanggal jatuh tempo; hasil yang harus diserahkan (kalimat yang bisa diperiksa dua orang).

#### Langkah-langkah
1. HRD › *Pemantauan tugas* (`/hrd/tugas`; *Task tracking*) → **New task / Tugas baru** → **For whom / Untuk siapa**, **What is the task / Tugasnya apa**, **What must be handed over / Yang harus diserahkan**, **Period start / mulai**, **Period end / selesai** (dua-duanya atau tidak sama sekali), **Due date / Jatuh tempo**, **Chase on / Ditagih tanggal** → **Save / Simpan** → `tgs-YY-MM-DD_NN`, status **OPEN**.
2. Kartu **To chase today / Ditagih hari ini**: tugas yang tanggal tagihnya tiba, belum ada yang menagih, tidak tertahan → **Record chase / Catat penagihan** → tulis jawaban orangnya (catatan itu dibaca di tagihan berikutnya; tugas **keluar dari daftar tagih begitu penagihan dicatat**, bukan saat pekerjaan tiba). Sistem **tidak mengirim pesan**; menagih dilakukan orang di luar sistem.
3. Aksi per tugas: **Received / Diterima**, **Chase / Tagih**, **Done / Selesai** (isian *apa yang diserahkan*, boleh kosong), **Blocked / Tertahan** (alasan wajib), **Resume / Lanjut**, **Cancel / Batal** (alasan wajib).
4. **Tugas rutin** (tab *Routine tasks / Tugas rutin*): **New routine task / Tugas rutin baru** → untuk siapa, **Cadence / Irama** (`WEEKLY`, `MONTHLY`, `QUARTERLY`, `SEMESTER`, `ANNUAL`), tugas, hasil wajib, **Due — days after the period ends** (0–60), **Chased — days before the due date** → `rtn-YY-MM-DD_NN`. **Raise periods / Terbitkan periode** menerbitkan tugas bertanggal, **satu per rutin per periode** (aman diulang; penarikan mundur 31 hari bawaan, 0–365). **Stop / Hentikan** + alasan; tugas yang sudah terbit tetap terutang.

#### Aturan & kontrol
- **Status:** `OPEN → DONE | CANCELLED`; *tertahan* adalah penanda pada tugas terbuka. **Tertahan tidak pernah dihitung sebagai kegagalan orangnya** (D261); batal tidak berhasil/gagal. Pengakuan diterima = bukti, bukan gerbang (tidak menunda jatuh tempo).
- Penolakan: `assign_task`: `not_permitted`, `not_found`, `employee_left`, `title_required`, `due_date_required`, `period_incomplete`, `period_backwards`, `due_inside_period`, `chase_after_due`, `ref_incomplete`; `update_task`: `unknown_action`, `task_closed`, `reason_required` (blokir/batal); `chase_task`: `task_closed`; `acknowledge_task`: `not_permitted`; rutin: `title_required`, `deliverable_required`, `offset_out_of_range`, `employee_left`, `routine_ended`, `cadence_is_fixed`, `ends_before_start`, `backfill_out_of_range`.
- Rujukan opsional: `ref_kind` `none` | `work_order` | `project` | `purchase_request` (divalidasi, tidak di-join lintas layanan). **Berkas hasil tidak bisa dilampirkan ke tugas** (`link_entity_t` belum punya `task`, W7).

#### Jejak data (apa yang terekam)
`ops_hr.tasks`, `ops_hr.task_routines` (siapa menugasi, kapan, diterima, ditagih oleh/kapan/catatan, selesai oleh/kapan/catatan, alasan tertahan/batal), audit; activity pribadi `task_acknowledged`.

#### Serah-terima ke tim lain
Tugas dapat menunjuk Job Order/proyek/permintaan pembelian (nomor saja). KPI membaca ketepatan tugas.

#### Koreksi & pengecualian
Tugas salah → Batal + alasan, buat baru. Rutin salah irama → **hentikan, buat baru** (`cadence_is_fixed`).

#### Checklist rutin
Harian: kartu *Ditagih hari ini*, tugas **Overdue** (merah). Awal tiap periode: **Terbitkan periode** (belum ada penjadwal otomatis).

#### Sumber
`src/app/(app)/hrd/tugas/page.tsx`, `src/services/hr/task-periods.ts`, `0052_hr_tasks`, `0152_hr_task_monitoring`, `0190`; D260, D261, D303; W7.

---

### Kinerja (KPI) dan tugas

#### Tujuan
Menampilkan **skor kinerja per orang yang menolak menilai apa yang tak bisa diukur**: ketepatan masuk, kehadiran, ketepatan tugas, ditambah konteks yang sengaja tidak dinilai.

#### Pemilik / peran & kewenangan
Membaca: `payroll.read` atau `hrd.read` (layar), data sangat pribadi. Mengelola tugas dari layar yang sama: `hrd.create/update`. Bobot dan ambang: pengaturan perusahaan (`/pengaturan`, `settings.update`).

#### Prasyarat
Tugas dan absensi tercatat; minimal **5 hari** rekaman per ukuran (`kpi.min_days_recorded`).

#### Langkah-langkah
1. HRD › *Kinerja & tugas* (`/hrd/kinerja`) → pilih periode → kartu per orang: tiga ukuran (*Ketepatan waktu masuk*, *Hadir tanpa mangkir*, *Tugas selesai tepat waktu*) dengan dasar (mis. "18 dari 20 hari") dan sumber, skor gabungan, lembur (konteks), tugas terbuka/tertahan, pekerjaan produksi yang tertaut (bukti, tidak dinilai).
2. Tindak lanjut tugas lewat *Pemantauan tugas*.

#### Aturan & kontrol
- **Bobot bawaan** 25 / 25 / 50; skor gabungan hanya bila ≥ `kpi.min_measures` (2) ukuran terukur; bobot dibagi ulang atas yang terukur. **Tidak terukur ≠ nol**: kantor yang tidak memakai mesin tidak diberi skor ketepatan.
- Sakit bersurat dan cuti yang jadi haknya dikeluarkan dari penyebut; tugas tertahan tidak dihitung; hasil produksi **tidak masuk skor** ("satu potong bukan satu unit") dan hanya tampil bila tertaut ke orangnya.
- **Rute ini belum live (demo)**; di produksi hanya `kpi_measures` di database yang ada.

#### Jejak data (apa yang terekam)
Dihitung saat dibaca dari `attendance_scans`, `day_marks`, `tasks`, `overtime`; tidak ada tabel skor.

#### Serah-terima ke tim lain
Tidak ada (pemakaian internal HRD/pimpinan).

#### Koreksi & pengecualian
Skor salah → perbaiki sumbernya (tap, tanda, status tugas); skor ikut berubah.

#### Checklist rutin
Bulanan/triwulanan sesuai kebijakan pimpinan (frekuensi tidak ditetapkan di kode).

#### Sumber
`src/app/(app)/hrd/kinerja/page.tsx`, `0064_hr_kpi`, `0186`; D260, D261, D264.

---

### Wajib Lapor Ketenagakerjaan (WLKP) dan data diri karyawan

#### Tujuan
Menghasilkan **rekap jumlah** (bukan nama) untuk formulir WLKP per tanggal laporan, dan mengumpulkan **enam data diri** yang diminta (tanggal lahir, jenis kelamin, pendidikan, kewarganegaraan, disabilitas, status kawin).

#### Pemilik / peran & kewenangan
- Rekap angka: `hrd.read` **atau** `payroll.read` (tidak ada nama di baliknya). Daftar per orang dan **mengisi data diri**: `hrd.read` / `hrd.update` (`ops_hr.save_employee_identity`, `employee_identities`).

#### Prasyarat
Karyawan terdaftar dengan tanggal masuk; kontrak berlaku (untuk status hubungan kerja PKWT/PKWTT); data diri dari karyawan/berkas.

#### Langkah-langkah
1. HRD › *Wajib Lapor (WLKP)* (`/hrd/wlkp`; *Mandatory Employment Report*) → **As of / Per tanggal** (tanggal laporan) → baca rekap per dimensi: jenis kelamin, kelompok umur, pendidikan, kewarganegaraan (WNA **per negara**), disabilitas, status kawin, jabatan, status hubungan kerja. Tombol **Print / Cetak**.
2. Bagian **Personal data per person / Data diri per orang**: **Fill in / Isi** → **Date of birth**, **Sex**, **Highest education**, **Citizenship**, **Country (WNA only)**, **Marital status**, **Person with a disability** → **Save**. Kartu "Yang masih ditunggu" menyebut field mana yang menahan laporan dan berapa orang.
3. Salin angka rekap ke formulir WLKP resmi (pelaporan ke instansi **dilakukan manual di luar sistem**).

#### Aturan & kontrol
- **Null bukan kategori**: setiap dimensi punya `tidak_diketahui` dan jumlah semua kelompok = `headcount`; "belum ditanyakan" bukan "tidak".
- Penolakan: `born_in_the_future`, `born_too_long_ago`, `born_after_joining`, `nationality_required` (WNA wajib menyebut negara), `nationality_not_for_wni`, `note_without_a_yes`, `not_permitted`, `not_found`.
- Umur dan kelompok umur **diturunkan** dari tanggal lahir terhadap hari kantor (batas kelompok hanya di SQL `age_band`).

#### Jejak data (apa yang terekam)
`ops_hr.employee_identity` — tabel **tanpa kebijakan baca** untuk akun payroll; dibaca hanya lewat seam yang memeriksa izin sendiri (D304). Audit mencatat **field yang diubah, tidak pernah nilainya** (D196). Tidak ada dokumen.

#### Serah-terima ke tim lain
Instansi ketenagakerjaan (manual). Tidak ada tim internal lain.

#### Koreksi & pengecualian
Koreksi data diri = simpan ulang (satu baris per orang, tanpa riwayat; audit menyimpan jejak field).

#### Checklist rutin
Menjelang tanggal pelaporan: kartu *Data diri lengkap*; kejar field yang kosong. Jadwal pelaporan WLKP **tidak ditetapkan di repo**.

#### Sumber
`src/app/(app)/hrd/wlkp/page.tsx`, `0153_hr_wlkp_identity`; D304; `supabase/local/smoke/101_hr_wlkp.sql`.

---

### Roster kerja (daftar karyawan aktif untuk kartu lantai produksi)

#### Tujuan
Memberi tim produksi **daftar karyawan aktif tanpa data gaji** untuk memilih siapa yang mengerjakan sebuah timeslot di kartu *Lantai produksi* (D355).

#### Pemilik / peran & kewenangan
`ops_hr.work_roster()` dibaca oleh `production.read`, `hrd.read`, atau `payroll.read`; kosong untuk yang lain. HRD tidak melakukan apa-apa — roster **mengikuti daftar aktif** *Karyawan*.

#### Prasyarat
Karyawan terdaftar dan aktif (`active = true`).

#### Langkah-langkah
1. Produksi membuka kartu Job Order → **catat timeslot** → memilih nama dari roster (nomor, nama, unit, jabatan) → menyimpan: kegiatan, jam mulai–selesai atau lama, jumlah bila ada unit selesai → timeslot (`ops_prod.work_slots` + `work_slot_workers`).
2. Timeslot yang membawa jumlah memposting entri progres dalam transaksi yang sama.

#### Aturan & kontrol
Roster tidak memuat gaji, tunjangan, kontak. Orang yang keluar hilang dari roster. Kru dua orang = dua baris pekerja; hasil kru dibagi rata di laporan produktivitas.

#### Jejak data (apa yang terekam)
Tidak ada tabel HR baru; timeslot disimpan modul Produksi (`0198_prod_work_slots`).

#### Serah-terima ke tim lain
**HRD → Produksi:** daftar aktif; **Produksi → HRD:** produktivitas (jam hadir vs jam timeslot) bagi pembaca absensi (D352).

#### Koreksi & pengecualian
Nama tak muncul: periksa status aktif dan nomor di *Karyawan*.

#### Checklist rutin
Bila ada karyawan baru/keluar: roster otomatis ikut; tidak ada langkah tambahan.

#### Sumber
`0200_hr_work_roster.sql`, `0198_prod_work_slots.sql`; D352, D355.

---

### Layanan mandiri karyawan: /saya, /profil, dan Pengaturan

#### Tujuan
Setiap karyawan dapat sendiri **mencatat presensi, mengajukan izin/sakit/cuti/lembur, membaca slip, dan melihat aktivitasnya** dari HP — tanpa mengakses modul HRD. Data tiap orang dibatasi oleh **tautan akun↔karyawan**, bukan oleh grant modul.

#### Pemilik / peran & kewenangan
- **Karyawan** (akun tertaut): `/saya` (4 tab) dan `/profil` (tab lengkap) — semua dibatasi baris dirinya (RLS `*_read_own`, `my_employee_id()`).
- **Staf** (punya modul) membuka halaman yang sama dari tautan *Saya* di topbar.
- **IT** membuat akun dan menautkan (`it.manage_users`); HRD melihat akun di daftar *Karyawan*.
- **Pengaturan perusahaan** (`/pengaturan`): `settings.read` melihat, `settings.update` mengubah — **demo saja**, belum live.

#### Prasyarat
Akun aktif dengan kata sandi buatan IT (D329). Tautan akun↔karyawan ada. Tanpa tautan: `/saya` menulis "Akun ini belum tertaut ke data karyawan"; akun **tanpa modul dan tanpa tautan** diarahkan ke `/no-access`; akun nonaktif selalu `none`.

#### Langkah-langkah
1. **Masuk:** akun karyawan-saja mendarat di `/saya` (pintu `employee`), dan hanya boleh membuka `/saya` dan `/profil`. Bahasa bawaan akun ini Indonesia.
2. **Presensi** (tab *Attendance / Presensi*): tombol **CLOCK IN / MASUK**, **CLOCK OUT / PULANG**, **TAP AGAIN / TAP LAGI**; teks *"Overtime? Tap when it starts and when it ends. / Lembur? Tap saat mulai dan saat selesai."* (tap lembur adalah tap biasa); daftar **Last 14 days / 14 hari terakhir** dengan jam kerja dan lembur; hari `review` yang bukan hari ini ditandai *dicek*. Detail: bagian *Presensi berlokasi*.
3. **Pengajuan** (*Requests / Pengajuan*): sisa cuti (*Leave left / Sisa cuti*, *Allowance / Jatah*, *Taken / Terpakai*); pilih **Permit / Izin**, **Sick / Sakit**, **Leave / Cuti**, **Overtime / Lembur**; riwayat **My requests / Pengajuan saya** dengan status *Waiting / Menunggu*, *Approved / Disetujui*, *Rejected / Ditolak*, *Cancelled / Dibatalkan*. Langkah per jenis: bagian *Cuti, izin, dan sakit* dan *Lembur*.
4. **Gaji** (*Pay / Gaji*): daftar periode **APPROVED/PAID** ("Slip muncul di sini setelah HRD menyetujui penggajiannya"), kartu *Take-home / Diterima* (pokok, tunjangan, lembur, potongan BPJS bila ada, hari kerja, hari tidak dibayar), status *Paid / Sudah dibayar* atau *Approved, not yet paid / Disetujui, belum dibayar*.
5. **Akun** (*Account / Akun*): bahasa, kata sandi (lupa → minta IT membuat yang baru), **Sign out / Keluar**, tombol pasang aplikasi (PWA).
6. **/profil** (staf & karyawan): tab *Security / Keamanan* (**Send a password change link / Kirim tautan ganti kata sandi**), *Activity / Aktivitas* (aktivitas terakhir milik sendiri), *Attendance / Presensi*, *Overtime / Lembur*, *Leave & permits / Cuti & izin*, *Tasks / Tugas* (**Acknowledge / Terima**), *Pay / Gaji* (periode di kiri, slip di kanan: Pokok, Tunjangan, Lembur, Bruto, Penyesuaian, Neto, Potongan BPJS, Diterima).
7. **/pengaturan** (staf): pengaturan umum (nama aplikasi, bahasa, format, ambang, bobot KPI `kpi.*`, toleransi iuran, peringatan masa berlaku berkas, zona waktu kantor, aturan gaji → tautan ke `/it/aturan-gaji`). Setiap pengaturan diberi **jangkauan**: `display`, `forward`, `retroactive` — yang retroaktif **dikunci** (ditolak di API, menyebut apa yang bergeser; D214, D215).

#### Aturan & kontrol
- **Activity pribadi** hanya jenis aman: `sign_in`, `sign_out`, `update`, `attendance_tap`, `leave_requested`, `overtime_requested`, `task_acknowledged` (`ops_core.v_my_activity`); log audit IT (`view/export/print`) **tetap tertutup** bagi orangnya (D190, D306).
- Karyawan **tidak bisa** memutuskan miliknya sendiri (`own_overtime`), tidak bisa mengajukan atas nama orang lain, tidak membaca slip DRAFT, dan hanya melihat tap/lembur/cuti sendiri.
- Slip dihitung oleh fungsi yang sama dengan layar HRD (komposisi RLS) — bukan salinan kedua (D9, A3).
- Aplikasi dapat dipasang sebagai PWA; **tidak ada mode offline** (presensi butuh internet; halaman `/offline.html`).

#### Jejak data (apa yang terekam)
Tap `self`, lembar `via = self`, `leave_requests`, tautan lampiran (foto surat dokter, foto kerja, foto presensi — semua drive **HRD**), `activity_events` jenis aman; audit tiap aksi. Folder: `CUTI IZIN SAKIT/SURAT DOKTER`, `LAPORAN LEMBUR`, `PRESENSI LUAR AREA` (dikirim dengan `entity`, lihat `attachPhoto`).

#### Serah-terima ke tim lain
Semua pengajuan masuk antrian HRD (`/hrd/cuti`, `/hrd/lembur`). IT mengurus akun dan kata sandi.

#### Koreksi & pengecualian
Karyawan tanpa tautan akun: minta IT menautkan (HRD tak bisa). Lupa kata sandi: minta IT *Buat kata sandi baru* — tautan email tidak dapat diandalkan (email hanya nama pengguna, D329).

#### Checklist rutin
Karyawan: tap masuk/pulang tiap hari; foto surat dokter pada hari sakit; tulis hasil lembur sebelum diputuskan. HRD: pastikan tiap karyawan aktif punya akun tertaut.

#### Sumber
`src/app/(app)/saya/**`, `src/app/(app)/profil/page.tsx`, `src/app/(app)/pengaturan/page.tsx`, `src/components/layout/employee-shell.tsx`, `src/lib/live.ts`, `0152`, `0163`–`0166`, `0185`, `0187`, `0188`; D305–D307, D326, D328, D329, D331–D333; F183–F190.

---

### Kesenjangan & catatan chapter ini

#### A. Belum dicatat / belum dibangun (verifikasi dengan kode 2026-10-01)

1. **Gaji yang sudah disetujui tidak dibekukan (F207, belum diputuskan pemilik).** Baris run dihitung ulang setiap dibaca. Yang dijaga terhadap periode APPROVED/PAID **hanya**: penyesuaian (trigger/`run_not_draft`), versi buku aturan (`already_paid`, `inside_existing_run`), dan `pick_shift` (`already_paid`). **Tidak ada penjaga** pada `add_scan`, `mark_day`, `withdraw_mark`, `decide_leave`, `withhold_allowance`/`restore_allowance`, impor biometrik, atau lembar lembur bertanggal di periode itu — koreksi di Senin setelah tanda tangan Kamis dapat menggeser angka run/slip yang sudah ditandatangani. Prosedur sementara: setelah APPROVED, **jangan** mengubah absensi/tanda periode itu; koreksi lewat *Penyesuaian* di run berikutnya. (`docs/plan/03-api.md` menyebut `409` untuk menahan tunjangan di dalam run APPROVED — **tidak ada di kode**.)
2. **Pemisahan tugas persetujuan tidak ditegakkan oleh kode.** `approve_payroll_run` hanya memeriksa `approve_funds`; tidak membandingkan penyetuju dengan pembuka run. SOP lama menulis "yang menyiapkan run tidak bisa menyetujui" — benar **hanya bila** pembuka run tidak dipegangi `approve_funds`. Begitu juga lembar lembur yang diketik HRD: `own_overtime` hanya menjaga jalan *pengajuan sendiri*; HRD yang menambah namanya sendiri ke lembar staff yang diketiknya sendiri tidak dihalangi (dan lembar staff default **dibayar**).
3. **BPJS/iuran tidak bisa dicatat di sistem sungguhan.** `/hrd/iuran` tidak ada di `LIVE_ROUTES`; tabel `enrolments`/`contribution_rates` ada tetapi **tidak ada seam/fungsi live** yang menulisnya (RLS mengizinkan insert langsung, tetapi tidak ada layar). Akibatnya slip produksi tidak memuat potongan BPJS, dan audit tagihan Akuntansi belum bisa berjalan. PPh 21 tidak dihitung (D140/D277). **Q56 (run membayar bruto+penyesuaian atau dikurangi BPJS karyawan?) terbuka.** THR, bonus tahunan, pesangon: tidak ada perhitungan — hanya penyesuaian `bonus`/`other` yang diketik.
4. **KPI (`/hrd/kinerja`) dan Pengaturan (`/pengaturan`) belum live** (demo saja). Bobot/ambang `kpi.*` di database ada (`0064`) tetapi tidak ada layar live untuk mengubahnya.
5. **Offboarding tidak berantai.** `offboard_employee` hanya menulis `active`/`left_on`. Tidak otomatis: mengakhiri kontrak aktif, mengakhiri pendaftaran BPJS, menonaktifkan/melepas akun masuk, menutup tugas/tugas rutin atasnya. Semua manual (daftar di bagian *Offboarding*). Nomor mesin karyawan **tidak bisa diubah** dan tidak ada alur "nomor mesin salah/ganti" di layar.
6. **Cuti:** status `CANCELLED` ada di enum dan di tampilan `/saya`, tetapi **tidak ada seam yang membatalkan** pengajuan; persetujuan yang keliru hanya bisa diperbaiki dengan menarik tanda hari satu per satu. `decide_leave` menandai **setiap tanggal kalender** dalam rentang (Sabtu/Minggu ikut) dan jatah cuti dihitung dari tanda — apakah akhir pekan memang seharusnya menghabiskan jatah **tidak dinyatakan di kode/keputusan**; hanya tanggal merah seluruh-kantor yang dikecualikan (D285). Konfirmasi dengan pemilik sebelum dipakai untuk rentang melintasi akhir pekan.
7. **Kontrak:** tidak ada pengakhiran otomatis PKWT yang lewat tanggal (layar hanya menandai "lewat N hari"); tidak ada pembaca PDF (poin diketik); kertas bertanda tangan tidak divalidasi isinya.
8. **Berkas yang tidak diarsipkan:** file ekspor mesin sidik jari (hanya baris tap + nama file + hitungan), scan form lembur (hanya dibaca), slip tercetak. Layar tidak menyimpan salinan.
9. **Tap berlokasi yang ditandai tidak punya status "sudah ditinjau"** — tanda tetap ada selamanya; tidak ada catatan siapa HRD yang menyetujui alasan.
10. **Tugas rutin tidak terbit otomatis** — HRD menekan **Terbitkan periode**; tidak ada penjadwal. Sistem tidak mengirim pengingat/penagihan (hanya mencatat bahwa orang menagih).
11. **WLKP:** hanya rekap angka; pengiriman ke instansi manual; jadwal pelaporan tidak ditetapkan di repo.
12. **Pembayaran fisik gaji** tidak dicatat per orang: aplikasi hanya mencatat satu baris buku besar + bukti transfer per run (D218). `ops_hr.record_payroll_paid` ada tetapi tidak dipanggil dari aplikasi.
13. **Penarikan penyesuaian tanpa alasan dari pengguna:** tombol hapus penyesuaian mengisi alasan otomatis "dibatalkan dari layar payroll" (`removeAdjustment` di `src/lib/api/hr.ts`) — padahal seam `withdraw_adjustment` menuntut alasan yang dibaca orang berikutnya. Run DRAFT sendiri tidak punya aksi batal/hapus; salah periode hanya bisa dibiarkan atau diabaikan (periode bertumpuk ditolak).

#### B. Pelanggaran aturan penyimpanan file (CLAUDE.md, D313/D320) dan batas data pribadi

1. **Tiga slot Berkas 201 masuk drive PROCUREMENT**, bukan HRD: `foto` (Pas foto), `sertifikat`, `lainnya` (→ jenis dokumen `other`). Pemetaan `ops_core.doc_kind_drive` (0035) menempatkan `foto`, `sertifikat`, `other` di `procurement` sebagai "judgement call"; folder: `FOTO`, `SERTIFIKAT`, `LAIN-LAIN`. Ini data pribadi (wajah, sertifikat orang) di drive tim lain. **Butuh keputusan/migrasi** (jenis khusus karyawan, mis. `foto_karyawan`) — belum ada.
2. **Hampir semua unggahan HR tidak mengirim `entity` dan tidak punya baris `ops_core.drive_paths`.** Hanya dua jenis HR yang punya baris: `surat_dokter` → `CUTI IZIN SAKIT/SURAT DOKTER`, `foto_presensi` → `PRESENSI LUAR AREA`. Sisanya jatuh ke "nama jenis huruf besar" langsung di bawah `ops-talaliving`: `KTP`, `KARTU KELUARGA`, `IJAZAH`, `CV`, `KONTRAK KERJA`, `NPWP`, `BPJS`, `SURAT PERINGATAN`, `SURAT LEMBUR`, `LAPORAN LEMBUR`. Belum "satu folder per tugas" bertingkat per orang/tahun/bulan seperti `RECEIVING REPORT/<YYYY-MM>/<YYYY-MM-DD>`; semua KTP seluruh karyawan bercampur dalam satu folder `KTP`. Aturan CLAUDE.md ("fitur yang menyimpan berkas harus mengirim `entity` dan menambah `drive_paths`") belum dipenuhi oleh `FileDrawer`, `kontrak/[no]`, `DayDrawer`, `SheetDrawer`.
3. Unggahan surat lembur produksi memakai jenis unggah `Laporan Lembur` lalu ditautkan sebagai `Surat Lembur` (`SheetDrawer.attach` vs `attachOvertimeDoc`) — drive sama (HRD) tetapi folder dan label jenis tidak konsisten.

#### C. Konflik dokumen vs kode (kode + commit terbaru menang)

| Dokumen | Menyatakan | Kode/commit terbaru |
|---|---|---|
| `docs/sop/hr/sop.html` (24 Sep) langkah 1 & 3 | Pola jadwal & **peta unit** diedit IT di `/it/aturan-gaji` | **D365 (1 Okt):** pola bawaan unit diatur **HRD** di `/hrd/jadwal` (`set_unit_schedule`, `0207`); peta di IT baca-saja. **`0207` belum diterapkan ke produksi** per README — terapkan sebelum deploy |
| SOP lama langkah 8 | Run mingguan Senin–Minggu / "pratinjau minggu" | D158 Senin–Minggu → D350 Sabtu–Jumat → **D357 Jumat–Kamis** (`PAY_WEEK_STARTS_DEFAULT = 5`), disetujui Kamis, dibayar Jumat; asumsi Kamis penuh **baru berlaku bila IT menerbitkan versi buku aturan dengan switch "Payroll mingguan di-approve di hari terakhir minggu"** |
| SOP lama langkah 6 | Tanda untuk semua orang "hanya untuk hari libur (office_wide)" | Seam dan layar mengizinkan **keenam jenis** tanda untuk seluruh kantor; hanya `holiday` yang menutup kantor (`office_closed`) |
| SOP lama langkah 9 | "Yang menyiapkan run tidak bisa menyetujui" | Hanya wewenang `approve_funds` yang diperiksa (lihat A.2) |
| `06-decisions` D327 / `settings` fixture `time.office_tz` | Jam kantor WITA (UTC+8) | **D334 (29 Sep): WIB (UTC+7)**; `OFFICE_TZ` = Asia/Jakarta; data tap lama digeser +1 jam (`0190`). Komentar kode dan label lama masih menyebut WITA; sapuan `0190` mengganti literal `Asia/Makassar` di semua fungsi |
| Banner layar run & `Employees` page "Gross only / Deductions are not modelled" (D140) | Tidak ada potongan | Slip memuat **Potongan BPJS** untuk yang terdaftar (`take_home`, D259); kolom run "Diterima" = **net** (bruto+penyesuaian), bukan take-home (Q56) |
| `EmployeeDrawer`: "Anything past this is overtime — claimed, then approved twice." | Dua kali disetujui | D146/D333: lembur staff cukup **HRD sekali** (atau pimpinan sekali untuk pengajuan sendiri); **dua tanda tangan hanya lembur produksi** |
| `docs/plan/03-api.md` `/allowance-withholdings` | 409 di dalam run APPROVED | Tidak ada di `withhold_allowance` (lihat A.1) |
| `docs/plan/03-api.md` `/day-marks/{id}` DELETE | Menghapus tanda | Sejak `0053` tanda **ditarik** (`withdraw_mark`), tidak dihapus |
| `saya/akun.tsx`, `/profil` Security | "Tautan ganti dikirim ke email Anda" | D329: email hanya nama pengguna, **tidak pernah dikirimi apa pun** (tanpa SMTP) — gunakan *Buat kata sandi baru* oleh IT |
| Bawaan lama `paid_leave_days` = 12 | Orang baru berhak 12 hari | D349: **0**, diisi HRD setelah 1 tahun |

#### D. Keadaan produksi yang diketahui (README 2026-10-01) — tindakan manusia yang menunggu

- **Cara baca `in_out` (D353), switch Kamis (D357), dan shift satpam (D364) hanya berlaku setelah IT/HRD menyimpannya**: README: shift satpam menunggu HRD menekan *Shift › Pakai 2 shift Satpam*; produksi menunjukkan SATPAM masih satu pola 19.00–07.00 untuk 2 orang. F216 mencatat IT sudah menerbitkan cara baca `in_out` (versi bertanggal 23 Sep) — **konfirmasi di layar Aturan penggajian** bahwa versi yang berlaku memuatnya dan `pay_week_assume_last_day`.
- **Enam karyawan bulanan produksi tanpa upah terisi** — penggajian menghitung nol sampai HRD mengisinya (F216). **12 orang tanpa nomor mesin** (mis. AGUS finishing, NUR helper) belum bisa tap-nya terbaca. Perbedaan jabatan/tarif tertunda untuk SITI, NUR AISAH, HENDI, SUKARJO, THOHARI menunggu konfirmasi HRD (D337).
- Data minggu 1 September (buku aturan, penomoran ulang, tap, tanda, run) **belum ditulis ke produksi, menunggu pemilik, per catatan D340 (30 Sep)**; status terkini tidak dikonfirmasi dalam bab ini. Lembar lembur dari empat form pindai harus diketik/diimpor dan disetujui HRD/pimpinan.
- Titik **gudang** harus diatur di `/hrd/absensi/lokasi` sebelum presensi HP dinilai; selama belum, semua tap HP berverdict `no_site` (tercatat, tidak ditandai).

#### E. Pertanyaan kebijakan yang tidak dijawab kode (jangan diasumsikan)

1. **Pengajuan lembur sendiri dari pekerja produksi** selalu menjadi lembar jenis `staff` dan cukup disetujui **HRD saja** — melewati aturan D145 (HRD + pimpinan + surat lembur untuk lembur produksi). Apakah ini dikehendaki?
2. Dua shift satpam pada satu Minggu: satu hari ×2 atau dua? (D341 sebelum D364.)
3. Cuti yang melintasi akhir pekan menghabiskan jatah? (A.6)
4. Jadwal gaji bulanan: tanggal periode run bulanan, dan kapan dibayar, tidak ditetapkan di kode (run diketik tangan).
5. Q56 dan nominal yang dibayar (bruto+penyesuaian vs setelah BPJS).
6. Siapa yang menjaga bahwa `approve_funds` tidak dipegang pembuat run.

#### F. Cakupan yang **tidak** diperiksa mendalam di bab ini
`/hrd/kinerja` dan `/hrd/iuran` hanya dibaca dari komentar dan kontrak (belum live; perilaku kode demo `src/demo/api/hr.ts` tidak diuji ulang). Kode penolakan iuran dari `03-api.md`, bukan dari migrasi. Tangga lembur dan angka buku aturan produksi yang **berlaku** (nilai persis 1,5×/2×, tangga hari libur, hari efektif setahun) tidak dibaca dari database — baca langsung di `/it/aturan-gaji`. Rincian walk-through layar dan tangkapan (`docs/sop/hr/walk-*.jpg`) tertanggal 24 Sep dan **mendahului** D327–D365 (presensi berlokasi, `/saya`, jadwal per hari, shift, pola bawaan unit, minggu Jumat–Kamis) — perlu dijalankan ulang bila SOP akan diterbitkan dengan gambar.



## Bab 5 — Produksi, Proyek & Pengiriman, dan Marketing

Bab ini menjelaskan satu rantai: **enquiry klien → quotation → order → Job Order → BOM → Purchase Request → produksi → pengiriman → instalasi → serah-terima → pembayaran**, dan di titik mana tiap langkah diserahkan ke Procurement, Inventory, Accounting dan HRD. Isinya dibaca dari kode (`src/`, `supabase/migrations/`) dan git log per 2026-10-01; bila dokumen lama (`docs/plan/*`) berbeda, **kode menang** dan perbedaannya dicatat di bagian akhir.

### Cara membaca bab ini

- **Kewenangan** ditulis `modul.aksi` persis seperti `src/lib/roles.ts`: level `read` memberi `.read`; level `write` memberi `.read`, `.create`, `.update` (+ `production.schedule`, `project.handover` bila modulnya punya); level `admin` memberi semuanya. **Authority** bernama (`approve_goods`, `approve_funds`, `approve_overtime`, `post_ledger`, `resolve_inbox`) diberikan terpisah dan **tidak pernah ikut dari level modul** (D24). Akun asli diberi grant oleh IT di `/it/pengguna`; tidak ada nama peran baku di database. Sebutan "PM / admin proyek", "admin produksi / estimator", "kru lapangan" di bawah adalah **sebutan fungsi** untuk kombinasi grant, bukan peran yang di-seed. Satu-satunya persona yang di-seed adalah persona demo (sandbox): *Made Suparta* (Kepala Gudang: `production` write, `delivery` write, `inventory` write, `project` read) dan *Evin Jonathan* (Direktur: `approve_goods`, `approve_overtime`, modul produksi/proyek/delivery read).
- Di wilayah bab ini **tidak ada authority yang menjaga satu pun langkah** kecuali dua pintu produksi: target harian (D356: `approve_funds` atau `approve_goods` boleh) dan posting lembar lembur (`approve_overtime`). Semua langkah lain dijaga **level modul** saja — ini dicatat sebagai kesenjangan di akhir.
- Setiap tulisan lewat *seam* (fungsi database `security definer`) dan membalas amplop: `ok` (200), `refused`/`not_permitted` (403), `invalid` (422), `conflict` (409), `not_found` (404), `noop`. **Setiap panggilan — berhasil maupun ditolak — menulis satu baris `ops_core.audit_log`** (dilihat di `/it/audit`, hak `it.read`). Kode penolakan di bab ini adalah kode amplop itu (`code`), pesannya yang tampil di toast.
- Label tombol ditulis `English / Indonesia` karena layar dwibahasa (D318). Nama status (`OPEN`, `DONE`, `QUOTATION_SENT`, …), kode tahap, dan id dipakai apa adanya.
- **Tanggal dan jam = jam kantor WIB** (`ops_core.office_tz()` = Asia/Jakarta, D334, `0190`). Nomor dokumen harian memakai hari kantor itu.

### Gambaran alur order sampai serah-terima

#### Tujuan
Satu urutan baku yang bisa ditelusuri dari satu nomor mana pun (lihat proses "Job trail"). Sistem menyatukan proses dan mencatat tiap kejadian dari awal sampai akhir.

#### Alur dan nomor yang lahir

| # | Tahap | Layar | Status / nomor yang lahir | Diserahkan ke |
|---|---|---|---|---|
| 1 | Prospek agen (opsional) | `/marketing/pipeline` | properti `TL-0001`, agen slot 1–3, `QUEUED` → `DEAL`; representative `agn-YY-MM-DD_NN` | — |
| 2 | Referral agen (opsional) | `/marketing/agen` | `lead-YY-MM-DD_NN`, `LEAD`→`WON` (butuh kode proyek) | Proyek (kode proyek diketik) |
| 3 | Enquiry klien | `/master-data/clients`, `/proyek/order` | klien `CL-0001`; proyek kode angka (mis. `25007`) status `INQUIRY` | — |
| 4 | Item code & BOM | `/produksi/bom` | produk (kode diketik, tetap), BOM `rev N` draft → dirilis | Procurement (harga katalog) |
| 5 | Quotation | `/proyek/quotation` | `qt-YY-MM-DD_NN` `DRAFT`→`SENT` (proyek `QUOTATION_SENT`) → `ACCEPTED` (proyek `DEAL`, baris pesanan lahir) | — |
| 6 | Job Order | `/proyek/order` (tombol per baris) atau `/produksi/jadwal` | `jo-YY-MM-DD_NN` `OPEN`, `bom_rev` dipin; proyek → `IN_PRODUCTION` | Produksi |
| 7 | Buat PR dari BOM | drawer Job Order | `pr-YY-MM-DD_NN` **DRAFT**, tiap baris `source_wo_no` = nomor JO | **Procurement** (ajukan → PO → receiving) |
| 8 | Bahan masuk & keluar | drawer Job Order → panel bahan | status bahan: `no_plan` / `waiting` / `ready` / `issued`; `stk-…` `ref_no` = nomor JO | **Inventory** (stok), **Accounting** (bayar PO) |
| 9 | Produksi | `/produksi/jadwal` | progres tahap `AMPLAS`→`FINISHING`→`MACHINERY`→`PACKING`; timeslot `tsl-…`; leg vendor `leg-…`; JO `DONE` | HRD (jam/lembur) |
| 10 | Barang jadi | `/inventory/produk` | gerak `fgm-…` (`produced` wajib sebut JO) | Inventory |
| 11 | Peti & surat jalan | `/proyek/peti`, `/proyek/pengiriman` | peti `kol-…`; surat jalan `krm-…` `IN_TRANSIT` (proyek `SHIPPED`) → `ARRIVED` | Delivery/Inventory |
| 12 | Instalasi | `/proyek/instalasi` | kunjungan `pas-…` (`DONE`); temuan `tmn-…` `OPEN`→`FIXED` | — |
| 13 | Serah-terima | `/proyek/serah-terima` | BAST `bast-…`; proyek `DONE` | — |
| 14 | Pembayaran | **di luar sistem** (D164, D106) | tidak ada nomor | Finance langsung dengan klien |

Aturan format nomor harian: `prefix-YY-MM-DD_NN` (urut per hari kantor; lebar 2 digit, `tsl` dan `trx` 3 digit, tidak pernah lebih sempit dari angkanya). Nomor yang sudah tercetak **tidak pernah diganti** (`docs/plan/penomoran.md`). Satu nomor tidak mungkin untuk semua dokumen (satu PO bisa memuat bahan tiga JO, satu JO belanja ke lima vendor); yang menyambung adalah **dua kunci di tiap baris**: kode barang (*apa*) dan nomor JO (*untuk pekerjaan mana*, lewat JO: proyeknya) (D312).

#### Sumber
`docs/plan/penomoran.md`, D312, D164, D106; `supabase/migrations/0004`, `0111`, `0130`, `0132`, `0133`, `0171`.

---

### Klien & follow-up (CRM klien)

#### Tujuan
Satu master klien (bukan kalimat yang diketik di tiap proyek) dan catatan *apa yang dikatakan ke klien, dan apa yang harus dilakukan berikutnya*, supaya quotation yang terkirim tidak dilupakan.

#### Pemilik / peran & kewenangan
- Lihat klien dan aktivitas: `project.read` (klien juga terbaca pemegang `procurement.read` dan `production.read`).
- Tambah klien: `project.create`. Ubah kontak, arsipkan/pulihkan klien, catat aktivitas, tutup follow-up: `project.update`.
- Pelaku: PM / admin proyek. Tidak ada authority bernama.

#### Prasyarat
Akun dengan modul `project` level `write`. Untuk follow-up dari quotation: quotation sudah ada.

#### Langkah-langkah
1. PM → `/master-data/clients` → `New client / Klien baru` (atau `New client` dari drawer proyek) → isi nama, kontak, telepon, email, alamat, NPWP, catatan → **kode `CL-0001` dst. lahir** (nomor urut + 1; yang sudah dipakai dilewati). Terekam: `ops_procure.clients`.
2. PM → `/master-data/clients/[code]` → kartu *Activity & follow-up / Aktivitas & follow-up* → `Log / Catat` → pilih **jenis** (`call`, `whatsapp`, `email`, `meeting`, `visit`, `note`), tanggal kejadian, proyek (opsional), ringkasan; opsional **tanggal follow-up** + *tindakan berikutnya* → `Save / Simpan`. Terekam: baris `client_activities` (tidak bisa diubah/dihapus).
3. Dari halaman quotation: kartu *Client communication / Komunikasi dengan klien* memakai komponen yang sama dengan proyek dan quotation terisi otomatis.
4. PM → `/proyek/follow-up` → daftar dikelompokkan `Overdue / Terlambat`, `Today / Hari ini`, `Upcoming / Berikutnya` → klik `Done / Selesai` pada baris, isi *hasilnya* (opsional) → `Close / Tutup`. Terekam: `follow_up_done_at/by/result`; baris lama tidak diubah.

#### Aturan & kontrol
- `client_exists` (409): satu klien hidup per nama (tak peduli huruf besar/kecil); `name_required`.
- Aktivitas: `bad_kind`, `summary_required`, `in_future` (aktivitas dicatat **setelah** terjadi; rencana pakai follow-up), `follow_up_before` (follow-up tidak boleh sebelum aktivitasnya), `quote_other_project`, `project_other_client`, `no_client` (proyek belum punya klien), `client_required`.
- Menutup follow-up: `no_follow_up`; sudah ditutup → `noop`.
- Status follow-up dihitung saat dibaca: `none`, `done`, `overdue`, `today`, `upcoming`.

#### Jejak data (apa yang terekam)
`ops_procure.clients`, `client_activities` (append-only), `audit_log`. Mengubah nama klien menyalin nama ke `projects.client_name` semua proyeknya. Tidak ada dokumen/Drive.

#### Serah-terima ke tim lain
Tidak ada; klien dipakai Procurement dan Produksi hanya sebagai referensi baca.

#### Koreksi & pengecualian
Aktivitas salah tidak diedit: catat aktivitas baru yang menjelaskan. Klien dobel: arsipkan salah satu (`Archive`); proyek lama tetap menunjuk ke klien yang diarsipkan. Klien internal/stok: proyek boleh dipilih `— internal / stok, tanpa klien —`.

#### Checklist rutin
- Harian: buka `/proyek/follow-up`, kerjakan `Overdue` dan `Today`, tutup dengan hasil.
- Setiap quotation `SENT`: pastikan ada follow-up bertanggal.

#### Sumber
`0111_procure_clients_orders.sql`, `0134_procure_client_crm.sql`; `src/components/crm/*`, `src/app/(app)/master-data/clients/**`, `src/app/(app)/proyek/follow-up/page.tsx`; `src/services/crm/contracts.ts`.

---

### Pipeline Package: properti → agen → representative

#### Tujuan
Menemukan **agen** yang mau memperkenalkan pemilik unit condo yang ingin renovasi interior (program *Package*, D166, D183). Dua corong: (1) mencapai agen, (2) bekerja dengan agen (lihat proses Referral).

#### Pemilik / peran & kewenangan
- Lihat `/marketing/pipeline`: `marketing.read`.
- Ubah tahap agen, `Release & move on`, validasi properti, qualify/disqualify: `marketing.update`.
- Onboarding representative, impor scrape, promosi baris scrape, buat pasar: `marketing.create`.
- Pelaku: staf marketing. Tanpa authority bernama.

#### Prasyarat
Pasar (`ops_mkt.markets`) dan properti sudah ada di database. **Layar tidak punya tombol impor scrape, promosi baris scrape, atau pembuatan pasar**; seam-nya (`import_scrape`, `promote_scrape_row`, `create_market`, `set_property_status`) ada tetapi belum dipanggil layar mana pun, dan tabel produksi kosong sejak dibuka (D316). Data awal harus dimasukkan lewat IT/seam (lihat Kesenjangan).

#### Langkah-langkah
1. Staf marketing → `/marketing/pipeline` → baca KPI (*Properties, Validated, Messaged, Replied, Reply rate, Deal*), antrean *Queue / need action* (lewat tujuh hari tanpa balasan di atas, lalu yang jatuh tempo hari ini), corong *Funnel — furthest agent per property*, dan *Scrape → enrichment*. Filter **scope** = awalan kode pasar (`AU` = negara, `AU-QLD-GOLDCOAST` = kota).
2. Buka properti (drawer) → `Mark as validated / Tandai tervalidasi` setelah memeriksa skor enrichment (skor mesin belum divalidasi orang). Terekam: `validated`, `validated_by/at`.
3. Untuk agen slot 1 (lalu 2, 3): klik tombol tahap (`QUEUED`, `MSG SENT`, `REPLIED`, `CALL SET`, `FORM BACK`, `PRESENTATION`, `DEAL`). Pesan pertama (`MSG SENT`) **menstempel `sent_on`** dan jam jatuh tempo; balasan (`REPLIED`) menstempel `replied_on` dan menghentikan pengejaran (trigger database, bukan diketik).
4. Agen diam ≥ 7 hari (setting `mkt.agent_move_on_days` = 7; dihitung dari `sent_on`, bukan kolom) → `Release & move on / Lepas & lanjut` → isi alasan → agen jadi `RECYCLED` dan agen slot berikutnya yang `QUEUED` otomatis jadi `MSG SENT` (**kedua langkah atau tidak sama sekali**). Bila tidak ada agen berikutnya, properti `exhausted` (kembali ke tumpukan) — bukan penolakan.
5. Agen setuju → `Make representative / Jadikan representative` → isi `Commission %` (bawaan layar 4) → `Onboard / Onboarding`. **Lahir `agn-YY-MM-DD_NN`** (representative, dengan persentase komisi per orang); agen tertaut (`rep_id`).
6. Baru setelah itu tahap agen boleh `DEAL`.

#### Aturan & kontrol
- `rep_required` (422): `DEAL` ditolak sebelum agen di-onboard (komisi tanpa persentase tak bisa dihitung, D185).
- `reason_required`: `RECYCLED` / `Release & move on` / disqualify wajib beralasan.
- `agent_agreed`: tidak bisa `move on` dari agen yang sudah `DEAL`.
- `commission_out_of_range`: komisi harus > 0 dan ≤ 20 %.
- `already_onboarded` (409); `not_found` bila slot tidak ada.
- `RECYCLED` dan `SKIP` adalah **pintu keluar**, bukan anak tangga: tidak pernah dihitung sebagai "sudah membalas". Properti dihitung **sekali, di tahap agen terjauhnya**.
- Persentase komisi tidak bisa diubah setelah ada komisi terbayar untuk representative itu (trigger `rate_is_frozen_once_paid`).

#### Jejak data (apa yang terekam)
`ops_mkt.markets`, `properties`, `property_agents`, `scrape_rows`, `sales_reps`; `audit_log` (before/after tahap); outbox `marketing.agent.deal`, `marketing.agent.moved_on`, `marketing.rep.onboarded`. Tidak ada dokumen/Drive.

#### Serah-terima ke tim lain
Representative baru → proses **Referral**. Tidak ada serah ke Procurement/Accounting pada tahap ini.

#### Koreksi & pengecualian
Tahap boleh dipindah ke tahap mana pun lewat tombol (mundur juga). Validasi bisa dicabut (`Withdraw validation / Cabut validasi`). Pasar dengan beda mata uang: **tidak ada rata-rata lintas mata uang** (ADR tidak pernah dijumlah).

#### Checklist rutin
- Harian: kosongkan antrean *need action* (kirim pesan / `Release & move on`).
- Mingguan: periksa properti `exhausted` dan skor yang belum divalidasi.
- Bulanan: baca corong dan tingkat balasan per negara/kota.

#### Sumber
`0081_mkt_outreach.sql`, `0082_mkt_outreach_seams.sql`, `0083_mkt_property_seams.sql`, `0084_mkt_referral_seams.sql`, `0085_mkt_rollup.sql`; `src/app/(app)/marketing/pipeline/**`; `src/services/marketing/contracts.ts`; D166, D183, D185, D187, D315, D316, F167, F168.

---

### Referral, proyek jadi (`WON`), dan komisi agen

#### Tujuan
Mencatat pemilik unit yang diperkenalkan representative, mengikatnya ke **proyek yang benar-benar ada**, dan menghitung komisi yang **terutang** (bukan membayarnya).

#### Pemilik / peran & kewenangan
- Lihat `/marketing/agen`: `marketing.read` atau `accounting.read`.
- Tambah kontak (`New lead / Kontak baru`): `marketing.create`. Ubah status referral: `marketing.update`.
- Pembayaran komisi dilakukan **Accounting** lewat ledger (`post_ledger` pada jalur ledger biasa).

#### Prasyarat
Representative sudah di-onboard. Untuk `WON`: proyek sudah ada **dan `contract_value`-nya sudah diisi** (> 0).

#### Langkah-langkah
1. Staf marketing → `/marketing/agen` → kartu representative → `New lead / Kontak baru` → nama pemilik unit, unit, telepon → `Save`. **Lahir `lead-YY-MM-DD_NN`**, status `LEAD`.
2. Seiring waktu: ubah status ke `SURVEYED`, `QUOTED` (label: *Surveyed / Sudah disurvei*, *Quoted / Sudah ditawar*).
3. Klien setuju dan PM sudah membuat proyeknya (proses Proyek & pesanan; **nilai kontrak diisi di drawer proyek**) → di baris referral `Became a project / Jadi proyek` → isi `Project code / Kode proyek` → `Record project / Catat proyek`. Status `WON`; komisi = `contract_value` proyek × persentase representative (dihitung, tidak disimpan).
4. Pemilik batal: `LOST` dengan alasan.
5. Pembayaran komisi: Accounting membayar lewat ledger seperti uang keluar lain; layar ini hanya menampilkan *Unpaid commission / Komisi belum dibayar* dan "dibayar `<trx>`" bila `commission_trx_no` terisi.

#### Aturan & kontrol
- `project_required` / `not_found`: `WON` wajib kode proyek yang ada. `value_required`: proyek harus punya nilai kontrak > 0 (trigger `won_needs_a_priced_contract` menjaga di tabel juga).
- Satu proyek hanya boleh punya **satu** referral `WON` (indeks unik).
- `reason_required`: `LOST` wajib alasan. `already_paid`: setelah komisi tercatat dibayar, status tidak bisa mundur dari `WON`; koreksinya adalah entri jurnal lain.
- `contract_value` **tidak diterima dari layar referral** (C15): nilainya dibaca dari proyek supaya tidak ada dua salinan yang bisa berbeda.
- `record_commission_paid` (`trx_required`, `not_won`, `already_paid`) ada di database tetapi **tidak punya fungsi klien maupun layar** — lihat Kesenjangan.

#### Jejak data (apa yang terekam)
`ops_mkt.referrals`, `sales_reps`; `ops_prod.v_project_cost` memuat `commission_owed`/`commission_paid` per proyek (terlihat bagi `marketing.read`/`accounting.read`); outbox `marketing.referral.won`, `marketing.commission.paid`.

#### Serah-terima ke tim lain
- Ke **Proyek**: kode proyek diketik manual (tidak ada tautan otomatis dari proyek ke referral).
- Ke **Accounting**: komisi terutang dibayar lewat ledger; accounting perlu tahu angkanya dari `/marketing/agen`.

#### Koreksi & pengecualian
Persentase komisi per orang tidak diubah setelah ada pembayaran. Perkenalan yang tidak jadi: `LOST` + alasan (dibaca bila pemilik yang sama muncul lagi).

#### Checklist rutin
- Mingguan: tinjau `LEAD` yang lama tak bergerak.
- Setelah `WON`: beri tahu Accounting nilai komisi; pastikan pembayaran dibukukan.

#### Sumber
`0080_mkt_referrals.sql`, `0084_mkt_referral_seams.sql`; `src/app/(app)/marketing/agen/page.tsx`; `src/lib/api/marketing.ts`; D185, D186, C15.

---

### Proyek & pesanan (order)

#### Tujuan
Satu catatan **pesanan klien**: siapa kliennya, apa yang dipesan (baris), kapan kirim, dan di mana posisinya (7 status). Kode proyek adalah dimensi yang dipakai Procurement, Produksi, ledger dan Delivery.

#### Pemilik / peran & kewenangan
- Lihat: `project.read` (Delivery/crew membaca proyek lewat `delivery.read`).
- Buat proyek: `project.create`. Ubah fakta/status/baris pesanan: `project.update`.
- Buat item code dari baris pesanan dan Job Order dari baris: `production.create`.
- Pelaku: PM / admin proyek; admin produksi untuk item code & Job Order.

#### Prasyarat
Klien terdaftar (atau proyek internal/stok tanpa klien).

#### Langkah-langkah
1. PM → `/proyek/order` → `New project / Proyek baru` → kode (kosongkan: nomor berikutnya = angka tertinggi + 1, mis. `25008`), nama, klien, lokasi, PIC, mulai, jadwal kirim, **nilai kontrak**, catatan → `Save`. Status awal `INQUIRY` (tercatat di `project_status_log`: "proyek dibuat"). Kode **tidak pernah berubah**.
2. Di drawer proyek → `Add item / Tambah item`: deskripsi (bahasa klien), item code (opsional), jumlah, satuan, harga jual/unit, tanggal kirim, catatan. Satu baris = satu tanggal kirim (order bertahap = beberapa baris).
3. Baris belum punya item code: `Make item code / Jadikan item code` (butuh `production.create`) → ketik kode (mis. `SG-01A`) → `OK`. Kode yang sudah ada **ditautkan**, bukan digandakan (kursi yang sama dipesan dua hotel = satu item code, satu BOM). Pesan: *Linked to the existing item code* / *Item code created*.
4. Status berpindah lewat dua jalur: **otomatis** (quotation dikirim → `QUOTATION_SENT`; quotation disetujui → `DEAL`; Job Order pertama → `IN_PRODUCTION`; surat jalan pertama → `SHIPPED`; BAST → `DONE`) dan **manual** (tombol status di drawer, maju atau mundur; `Cancel… / Batalkan…` → alasan → `Cancel project / Batalkan proyek` → `CANCELLED`).
5. Drawer menampilkan per baris: dipesan · di Job Order · selesai, biaya produksi dari BOM (`cost … / unit`), catatan *no BOM yet*, *BOM incomplete*, *not in the product catalog yet*.

#### Aturan & kontrol
- Status: `INQUIRY` → `QUOTATION_SENT` → `DEAL` → `IN_PRODUCTION` → `SHIPPED` → `DONE`, plus `CANCELLED`. **Boleh pindah ke status mana pun** (order memang bisa mundur dari deal ke quotation); setiap pindah masuk `project_status_log` (siapa, kapan, alasan). `CANCELLED` wajib alasan (`reason_required`). Memindahkan ke status yang sama → `noop`.
- Pindah otomatis hanya **maju** dan hanya dari status asal yang terdaftar (fungsi `move_project`): surat jalan dari `INQUIRY…IN_PRODUCTION`, BAST dari `…SHIPPED`.
- `DONE`/`CANCELLED` menyetel `is_active = false` (proyek hilang dari pemilih "untuk proyek mana" di PR dll.).
- `name_required`, `dates_reversed` (kirim sebelum mulai), `negative_value`, `client_unknown`, `description_required`, `qty_required`, `negative_price`, `no_such_uom`.
- Baris yang sudah punya Job Order **tidak bisa dihapus** (`has_job_orders`, 409): tutup Job Order dulu; baris tetap sebagai catatan.

#### Jejak data (apa yang terekam)
`ops_procure.projects`, `project_lines`, `project_status_log`, `audit_log`. Tidak ada dokumen pada langkah ini.

#### Serah-terima ke tim lain
Kode proyek dipakai: **Procurement** (PR/PO per proyek), **Accounting** (ledger per proyek, `v_project_cost`), **Produksi** (JO), **Delivery**, **Marketing** (referral `WON`).

#### Koreksi & pengecualian
- Salah ketik kode: tidak bisa diubah; buat proyek baru dan batalkan yang lama (dengan alasan).
- Nilai kontrak **tidak otomatis terisi** saat quotation disetujui; PM mengetiknya (dibutuhkan referral `WON`). "Order value" di drawer = Σ jumlah × harga baris; "Contract value" = angka yang diketik. Keduanya bisa berbeda.
- Proyek lama (sebelum `0111`) diberi status tebakan: aktif → `IN_PRODUCTION`, tidak aktif → `DONE`.

#### Checklist rutin
- Harian: periksa proyek `DEAL` tanpa Job Order dan `IN_PRODUCTION` melewati jadwal kirim.
- Mingguan: tutup proyek yang BAST-nya sudah ada tetapi status belum `DONE` (jarang; BAST menutupnya otomatis).

#### Sumber
`0111_procure_clients_orders.sql`, `0130_prod_job_orders.sql` (baris & Job Order), `0132_dlv_delivery.sql` (`move_project`); `src/app/(app)/proyek/order/**`; `src/services/procurement/contracts.ts` (`PROJECT_STATUSES`); D149, D150.

---

### Quotation (BOM → harga jual → keputusan klien)

#### Tujuan
Mengubah **biaya produksi dari BOM yang sudah dirilis** menjadi harga yang bisa dijawab "ya" oleh klien; bila disetujui, barisnya **menjadi pesanan**.

#### Pemilik / peran & kewenangan
- Lihat harga: `project.read`. **Ongkos produksi dan margin hanya terbaca pemegang `project.update`** (yang lain melihat harga saja; kolom null + `cost_visible` = false).
- Buat draft: `project.create`. Isi, kirim, revisi, catat keputusan klien: `project.update`.
- Pelaku: PM. Tidak ada authority/persetujuan pimpinan atas harga.

#### Prasyarat
Proyek ada. Item yang dijual punya item code dengan **BOM dirilis** (atau PM mengetik ongkos manual / menetapkan harga jual).

#### Langkah-langkah
1. PM → `/proyek/quotation` → `New quotation / Quotation baru` → pilih proyek → `Create draft / Buat draft`. (Atau `Create quotation / Buat quotation` di drawer proyek.) **Lahir `qt-YY-MM-DD_NN`**, `rev` 1, status `DRAFT`, berlaku 30 hari sejak hari ini. Satu proyek hanya boleh satu draft.
2. Halaman quotation → atur persentase: `Marketing %`, `Overhead %`, `Margin % (of selling price) / Margin % (dari harga jual)`, `Valid until / Berlaku sampai`, PPN (`Charge / Kenakan`, bawaan 11 %), `Terms & conditions`, `Note to the client` → `Save`.
3. `Add item / Tambah item`: item code dari katalog (ongkos terbaca dari BOM **dirilis**, bukan draft), deskripsi untuk klien, jumlah, satuan, estimasi produksi (hari; bawaan dari `lead_time_days` produk), opsional `Manual cost per unit`, persentase khusus baris, dan `Selling price per unit (fixed)` untuk menetapkan harga.
4. Rumus tunggal: **harga = ongkos × (1 + marketing% + overhead%) ÷ (1 − margin%)** (margin dari harga jual, bukan markup), dibulatkan. Harga override menang; rumusnya tetap tampil di sebelahnya.
5. `Preview / Pratinjau` → `/proyek/quotation/[no]/print` (cetak browser → *Save as PDF*) untuk dikirim ke klien di luar sistem.
6. `Send to client / Kirim ke klien` → semua angka **dibekukan** di baris (`frozen_*`: ongkos, sumber, `bom_rev`, persentase, harga). Status `SENT`, `sent_at/by`; proyek `INQUIRY` → `QUOTATION_SENT` (dicatat di log status).
7. Klien menjawab: `Accepted / Disetujui` → status `ACCEPTED`; **baris beku menjadi baris pesanan** di proyek (catatan `dari qt-…`, tertaut `quotation_line_id` sehingga tidak bisa dobel); proyek `INQUIRY`/`QUOTATION_SENT` → `DEAL`. Atau `Rejected / Ditolak` → alasan → `Record rejection / Catat ditolak` → `REJECTED`.
8. Mau menawar ulang: `Revise / Revisi` dari `SENT` atau `REJECTED` → draft baru `rev N+1` berisi baris yang sama; yang lama `SUPERSEDED` (bila `SENT`) dan tetap terbaca.

#### Aturan & kontrol
- State machine: `DRAFT` → `SENT` → `ACCEPTED` | `REJECTED` | `SUPERSEDED`. Hanya `DRAFT` yang boleh diubah (`not_draft`, 409: "buat revisi"). `ACCEPTED` tidak bisa direvisi (`not_revisable`: perubahan diurus di pesanannya).
- `draft_exists`; `bad_percent` (0 sampai <100); `no_lines` (quotation tanpa item bukan penawaran); `cost_missing` (belum ada ongkos: rilis BOM, isi ongkos manual, atau tetapkan harga jual); `already_expired` (berlaku sampai sudah lewat); `product_not_found`, `description_required`, `qty_required`, `no_such_uom`, `negative`; `reason_required` (penolakan wajib alasan); `not_sent` (keputusan hanya untuk `SENT`).
- Penanda `expired` = `SENT` dan lewat `valid_until` (dihitung, bukan status).

#### Jejak data (apa yang terekam)
`ops_procure.quotations`, `quotation_lines` (angka beku), `project_lines.quotation_line_id`, `project_status_log`, `audit_log`; CRM `client_activities` bila dicatat. **Cetakan quotation tidak disimpan sebagai dokumen/Drive** (lihat Kesenjangan).

#### Serah-terima ke tim lain
Quotation `ACCEPTED` → baris pesanan → Job Order (Produksi). Tidak ada serah ke Accounting (tidak ada piutang/penagihan, D164).

#### Koreksi & pengecualian
Angka terkirim tidak diubah — **revisi**. Ongkos BOM yang berubah setelah kirim tidak menggeser penawaran (BOM dirilis dan angka beku). Harga yang dinegosiasikan: isi `Selling price per unit (fixed)`.

#### Checklist rutin
- Sebelum kirim: tidak ada baris *BOM not released / incomplete*; `Valid until` masuk akal; PPN sesuai.
- Setelah kirim: buat follow-up CRM bertanggal (proses Klien & follow-up).
- Mingguan: tinjau quotation `SENT` yang `expired` — revisi atau catat ditolak.

#### Sumber
`0133_procure_quotations.sql`; `src/app/(app)/proyek/quotation/**`; `src/services/quotation/*`; `src/lib/api/quotation.ts`; D240 (digantikan, lihat Kesenjangan).

---

### Katalog produk, gambar kerja & antrean desain

#### Tujuan
Master data **apa yang dijual dan dibuat** (`ops_prod.products`): kode permanen, ukuran dalam mm, gambar kerja (yang dikerjakan bengkel) dan gambar jadi (yang dilihat klien).

#### Pemilik / peran & kewenangan
- Lihat katalog: `production.read` (BOM dan produk terbaca semua pengguna masuk). Tambah produk: `production.create`. Ubah produk, unggah gambar, kelola BOM: `production.update`.
- Pelaku: admin produksi / estimator; drafter (belum ada modul `drafting` — pakai modul `production`).

#### Prasyarat
Item code lahir dari baris pesanan (`Make item code`) atau dibuat langsung.

#### Langkah-langkah
1. Admin produksi → `/produksi/bom` → `New product / Produk baru` → kode (huruf besar; mis. `PRD-MJ-220`, `AA-02`), nama, kategori, satuan, ukuran P×L×T (mm), catatan ukuran, `lead_time_days`, gambar kerja (opsional saat buat) → `Save`. Produk baru langsung membuka BOM-nya.
2. Drawer produk → panel gambar → pilih jenis `Gambar Kerja` (*Working drawing*) atau `Gambar Jadi` (*Finished photo*) → `Upload / Unggah` (revisi berikutnya: `Upload revision / Unggah revisi`) atau `Link` (URL Drive) → `Attach / Tempel`. Gambar baru **menambah**, tidak menimpa; revisi lama tetap.
3. Kolom *Completeness / Kelengkapan* di katalog menyebut apa yang belum ada: ukuran, gambar kerja, gambar jadi, BOM.
4. **`/produksi/desain` (antrean drafter): hanya sandbox/demo — tidak aktif di sistem live** (lihat Kesenjangan). Rencananya: tugas per produk (`BELUM` → `DIGAMBAR` → `TANYA` → `RILIS`), revisi `A/B/C`, pertanyaan yang memblokir rilis.

#### Aturan & kontrol
- `code_required`, `name_required`; **kode produk tidak bisa diubah** (trigger `product_code_is_permanent`); `component_is_not_its_parent`.
- Tahap produk (`stages`) boleh kosong = "belum ada yang bilang" → papan memakai tahap rute dan menandai produk.
- `labour_cost` lama tidak lagi dipakai untuk biaya (biaya tenaga kerja adalah baris BOM `labour`).

#### Jejak data (apa yang terekam)
`ops_prod.products`; unggahan: `ops_core.attachments` + `attachment_links` (`entity = product`, `kind = gambar_kerja` / `gambar_jadi`, tampil *Gambar Kerja / Gambar Jadi*). **Drive**: drive **DRAFTING** → `ops-talaliving/GAMBAR KERJA` atau `ops-talaliving/GAMBAR JADI` (tidak ada baris `drive_paths`, jadi nama jenis dokumen huruf besar). Foto produk jadi (jenis `foto`, entity `product`) ke drive PROCUREMENT `ops-talaliving/INVENTORY/FINISHED GOODS` (bab Inventory).

#### Serah-terima ke tim lain
Gambar kerja dibaca AI untuk usulan BOM; produk dipakai Quotation dan Job Order. Foto barang jadi: Inventory.

#### Koreksi & pengecualian
Gambar salah: unggah revisi baru, jangan hapus. Produk tidak dipakai lagi: `active = false` (tidak dihapus).

#### Checklist rutin
- Mingguan: filter *Data incomplete / Data belum lengkap* dan lengkapi ukuran + gambar.

#### Sumber
`0060_prod_master.sql`, `0109_prod_bom_costing.sql` (`save_product`), `0035_core_drive_folders.sql` (`doc_kind_drive`), `0172_core_drive_ops_paths.sql`; `src/app/(app)/produksi/bom/**`, `produksi/desain/**`; `scripts/check-live-routes.mjs --report`; D150, D179.

---

### BOM, daftar rate & saran AI

#### Tujuan
Menjawab **berapa biaya membuat satu unit** (bukan harga jual) dan **apa yang harus dibeli**: tiap baris = komponen – material – kebutuhan per unit – satuan – rate (D324).

#### Pemilik / peran & kewenangan
`production.update` untuk semua perubahan BOM, daftar rate (`/produksi/rate`) dan `AI suggestion`; `production.read` untuk membaca BOM, rate dan norma. Pelaku: admin produksi / estimator. Daftar rate dikelola produksi (default D324; pemilik boleh memindahkannya ke procurement).

#### Prasyarat
Produk ada; gambar kerja diunggah (untuk saran AI); daftar rate terisi (84 rate 29 Sep + 26 rate PLV `RT-0085`–`RT-0110`, D355).

#### Langkah-langkah
1. Estimator → `/produksi/bom` → buka produk → `AI suggestion / Saran AI` (aktif hanya bila ada gambar kerja). Server `/api/production/bom/suggest` membaca gambar (foto/PDF, dari Drive) dengan model dan menyusun usulan: komponen (*part*), material, rate dari **daftar rate**, qty per unit, susut dari **norma bisnis** (`ops_prod.bom_norms`). **Tidak ada yang tersimpan**; model tidak menentukan harga maupun susut.
2. Estimator memeriksa tiap baris (peringatan: satuan beda, qty tidak tertulis di gambar, teks tak terbaca) → centang baris yang disetujui → `Add N lines to the draft / Tambahkan N baris ke draft`, atau `+ Add component / Tambah komponen` manual. Draft **rev N terbuka sendiri** pada perubahan pertama (menyalin rilisan sebelumnya).
3. Baris: jenis `material` (kode item `I-00042` dari database items, atau dibuat dari sini lewat `Create item / Buat item` → masuk `ops_procure.items`, belum dikurasi), `product` (sub-rakitan; BOM berlapis) atau `labour` (nama + rate; jam × rate). Rate: ketik (`manual`), atau ikuti **rate list** (`RT-0001`, mengikuti harga hidup selama draft) atau katalog (harga standar, lalu harga terakhir dibayar).
4. `miskalkulasi %` (satu persentase per revisi, atas subtotal) → `Save`.
5. `Release note / Catatan rilis` (satu kalimat alasan versi ini) → `Release rev N / Rilis rev N` (nonaktif bila draft sama persis dengan rilisan sebelumnya). Rilis **membekukan rate** tiap baris dan menjadikan revisi tidak bisa diubah. Tombol `Discard draft / Buang draft` membuang draft bila batal.
6. `/produksi/rate` (`BOM rates / Daftar rate BOM`): `New rate / Rate baru` (nama + grade, kelompok `kayu` / `material` / `finishing` / `labour` / `packing` / `lain`, satuan, Rp per satuan, item tertaut opsional) → kode `RT-0001` dst. tidak berubah. Kartu *Suggested from finishing recipes* menawarkan total resep finishing sebagai rate → `Add to rate list / Tambahkan ke daftar rate` (tidak pernah ditambahkan otomatis).

#### Aturan & kontrol
- Satu draft per produk; baris rilisan tidak diedit (menyentuh baris rilisan = menyalin ke draft); `already_on_bom` (satu baris per material **per komponen**), `qty_required`, `waste_out_of_range` (0–90 %), `negative_rate`, `unknown_rate`, `rate_on_sub_assembly` (sub-rakitan dihitung dari BOM-nya sendiri), `label_required`/`rate_required` (tenaga kerja), `ref_required`, `bom_cycle` (rakitan memuat dirinya tolak).
- Rilis ditolak bila: `no_draft`, `note_required`, `empty_revision`, `unpriced_lines` ("biaya yang dirilis tidak boleh bolong"), `nothing_changed` (draft sama persis dengan rilis sebelumnya).
- **Biaya produksi/unit** = Σ round(qty × (1 + susut%) × rate) material+labour + miskalkulasi; **null (bukan nol) bila ada baris tanpa rate**. Bukan harga jual.
- Rate: `name_required`, `unknown_group`, `uom_required`, `rate_required`, `negative_rate`, `no_such_item`, `rate_name_taken` (satu nama aktif satu rate). Rate dinonaktifkan, tidak dihapus.
- Norma bisnis hanya dibaca (tidak ada layar ubah); susut dari norma `yield` dikonversi (yield 80 % = susut 25 %, F194). Deployment tanpa `ASSISTANT_LLM_PROVIDER`/`ASSISTANT_LLM_API_KEY` atau akun layanan Drive → `llm_not_configured` / `drive_not_configured` (501): isi manual.

#### Jejak data (apa yang terekam)
`ops_prod.bom_revisions` (rev, `released_at/by`, catatan), `bom_components` (rate beku + `rate_source` `manual|standard|last|sub_assembly|rate`), `bom_rates`, `bom_norms`, `finishing_recipes`; audit; outbox `production.bom.released`. Item baru dari BOM: `ops_procure.items` (belum dikurasi — Procurement mengurasinya di Master Data).

#### Serah-terima ke tim lain
- **Procurement**: item baru dari BOM perlu dikurasi; harga katalog (`standard_price`, `last_price`) dipakai biaya BOM; BOM → PR (proses Kebutuhan bahan).
- **Accounting/pimpinan**: tidak ada; rilis tidak butuh persetujuan.

#### Koreksi & pengecualian
Rilisan salah: buka draft baru (ubah satu baris), rilis dengan alasan → rev baru; JO lama tetap memakai rev lamanya. Harga naik: rate list diubah → draft mengikuti; rilisan beku.

#### Checklist rutin
- Sebelum rilis: tidak ada baris tanpa rate; `Release note` jelas.
- Bulanan: tinjau rate yang `Used in` banyak produk sebelum mengubahnya; tinjau rate kayu *per m³ log / balok / komponen* — **dasar harus ada di nama** (F205).

#### Sumber
`0060`, `0065_prod_bom_explode.sql`, `0108`, `0109_prod_bom_costing.sql`, `0110`, `0182_prod_bom_rates.sql`, `0193_prod_bom_norms_read.sql`, `0200_prod_bom_rates_plv.sql`; `src/lib/bom-vision.ts`, `src/lib/bom-norms.ts`, `src/app/api/production/bom/suggest/route.ts`; `docs/analysis/2026-09-30-plv-bom-vs-ops-bom.md`; D149, D237, D238, D239, D256, D257, D324, D336, D338, D355, F77, F78, F181, F194, F205.

---

### Job Order (membuat dan menyematkan BOM)

#### Tujuan
Satu perintah kerja: **apa dibuat, berapa, untuk proyek mana, kapan jatuh tempo**, dengan BOM versi yang dipakai. Papan menunjukkan *mana dari sebelas yang terlambat*.

#### Pemilik / peran & kewenangan
- Buat: `production.create`. Ubah/pindah BOM/tutup: `production.update`. Lihat: `production.read` (JO terbaca semua pengguna masuk).
- Pelaku: admin produksi. Tanpa authority.

#### Prasyarat
Disarankan: baris pesanan dengan item code + BOM dirilis. JO tanpa produk katalog ("barang sekali buat") diperbolehkan tetapi tanpa proyeksi bahan.

#### Langkah-langkah
1. **Dari baris pesanan (jalur utama)**: admin produksi → `/proyek/order` → buka proyek → pada baris yang sudah punya item code → `Job Order for the remaining N / Job Order untuk sisa N` → isi jumlah, jatuh tempo, rute (`Own workshop / Bengkel sendiri` = `IN_HOUSE` atau `Via vendor / Lewat vendor` = `SUBCON`) → `Create / Buat`. Baris pesanan terikat ke JO (`project_line_id`).
2. **Dari papan**: `/produksi/jadwal` → `New Job Order / Job Order baru` → pilih item katalog (atau `Not in the catalogue — type it yourself…`), keterangan, jumlah, satuan, jatuh tempo, `How it is made / Cara dikerjakan`, `Project / customer` → `Save`.
3. **Lahir `jo-YY-MM-DD_NN`** (nomor lama berbentuk `spk-…` tetap sah), status `OPEN`. `bom_rev` **dipin ke revisi dirilis terbaru saat itu** (null bila belum ada rilisan — layar mengatakannya, tidak menampilkan daftar hari ini seolah itu yang dipakai). Proyek `INQUIRY`/`QUOTATION_SENT`/`DEAL` → `IN_PRODUCTION` (alasan: "Job Order … dibuat").
4. BOM berubah sesudah JO dibuat: drawer menunjukkan "the catalogue is now at rev N"; `Move to rev N / Pindahkan ke rev N` + alasan.

#### Aturan & kontrol
- `not_permitted`; `line_not_found`; `item_required`; `qty_required`; `due_date_required` ("JO tanpa tanggal tidak bisa terlambat"); `no_such_uom`; `unknown_route`; `product_not_found`; `project_not_found`.
- Pin hanya ke revisi **dirilis** produk itu sendiri (trigger `pin_is_a_released_rev`).
- `repin_bom`: `reason_required`, `no_product`, `no_released_revision`, `wo_not_open`, `already_started` (sudah ada pekerjaan dilaporkan → bahan terpakai adalah bahan rev lama; ditolak), sudah terbaru → `noop`.
- Status JO: `OPEN` → `DONE` (lewat penutupan) — `CANCELLED` ada di tipe data tetapi **tidak ada seam maupun layar untuk membatalkan JO** (lihat Kesenjangan).
- Tahap yang dilalui JO: tahap produk (bila diisi) atau tahap rute; keduanya kini empat tahap: `AMPLAS` (Sanding) → `FINISHING` → `MACHINERY` (Machinery / instalasi) → `PACKING`. Kode lama `POTONG/SERUT/RAKIT/PEMBUATAN` ditampilkan terpisah (*Old stages, no longer used*), `QC` digulung ke `PACKING`.
- Peringatan papan (bukan penolakan): tahap melompati tahap sebelumnya, > jumlah pesanan, lewat tenggat, ≤ 3 hari dan < 70 %, belum ada tahap dikerjakan, vendor telat.

#### Jejak data (apa yang terekam)
`ops_prod.work_orders` (+`project_line_id`, `bom_rev`), `project_status_log`, `audit_log`. Dokumen: tidak ada (JO tidak dicetak sebagai berkas).

#### Serah-terima ke tim lain
Produksi → Procurement (PR dari BOM), → Inventory (bahan keluar `ref_no` = nomor JO), → HRD (lembur produksi merujuk nomor JO), → Delivery (ready to ship dibaca dari progres JO).

#### Koreksi & pengecualian
JO salah jumlah: tidak ada pengubah jumlah di layar; tutup dengan alasan (`Close Job Order`) dan buat JO baru. Order susulan: baris pesanan menawarkan `Job Order untuk sisa N`.

#### Checklist rutin
- Harian: papan — *Past due*, *Due in ≤ 3 days*, *Needs checking*; bicarakan yang terlambat.
- Setiap JO baru: BOM sudah dirilis? Bila belum, rilis dulu atau terima "tidak ada proyeksi".

#### Sumber
`0061_prod_orders.sql`, `0130_prod_job_orders.sql`, `0063`; `src/app/(app)/produksi/jadwal/**`; `src/services/production/work-order-view.ts`; D148, D253–D256, D275, D278, F60, F74, F75, F92.

---

### Kebutuhan bahan: BOM → Purchase Request → bahan masuk → bahan keluar

#### Tujuan
Menurunkan **kebutuhan bahan** satu JO dari BOM yang dipin, menjadikannya permintaan pembelian (draft), dan membandingkan *proyeksi vs diminta vs disetujui vs dibayar vs dikeluarkan* — "BOM mengusulkan, gudang menetapkan" (D266).

#### Pemilik / peran & kewenangan
- Membuat PR dari BOM memerlukan **`procurement.create`** (bukan `production.update`; Q54: bengkel tidak punya jalur PR sendiri — mandor yang perlu diberi grant ini). Tombol `Create PR from the BOM` terlihat bagi pemegang `production.update`, tetapi seam menolak tanpa `procurement.create`.
- Melihat angka diminta/disetujui/dibayar: `procurement.read`; ledger: `accounting.read`.
- Mengeluarkan bahan ke JO: `inventory.create`/`update` (kepala gudang).
- Menyetujui barang dan PO: authority `approve_goods` (CEO) dan alur Procurement (bab Procurement).

#### Prasyarat
JO punya `bom_rev` (BOM dirilis). BOM tanpa siklus.

#### Langkah-langkah
1. Pelaku (pemegang `procurement.create`) → drawer JO → panel *Materials: BOM projection vs what was actually bought* → baca **Material projection**, **Labour** (diketik, bukan dihitung), **Requested (PR)**, **Approved**, **Paid**.
2. `Create PR from the BOM / Buat PR dari BOM` (bila sudah ada: `Create another PR…`, periksa dulu agar tidak dobel). Daftar **dijalani ke bawah** (sub-rakitan diuraikan; susut berlipat; bahan yang sama dari dua rakitan = satu baris dengan dua jalur). **Lahir `pr-YY-MM-DD_NN` berstatus DRAFT**; tiap baris membawa `source_wo_no` = nomor JO, `need_by` = jatuh tempo JO, tujuan `BOM jo-… rev N — <item>`. Sub-rakitan tanpa BOM dirilis tetap tampil dan ditandai.
3. **Handoff ke Procurement**: orang Procurement membaca, memberi harga, mengajukan (submit) → persetujuan → PO → penerimaan (bab Procurement). PR dari BOM tidak pernah otomatis diajukan.
4. Barang diterima & **penerimaan bertanda tangan menambah stok** (bab Inventory) → status bahan JO dihitung dari rak: `Belum ada BOM` (`no_plan`) · `Menunggu bahan` (`waiting`) · `Material ready` (`ready`) · `Bahan sudah keluar` (`issued`). **Dihitung saat dibaca, tidak disimpan.**
5. Kepala gudang → drawer JO → panel bahan → pilih lokasi → isi jumlah yang benar-benar dibawa → `Issue / Keluarkan` (seam `issue_for_work_order`) → gerak `stk-…` dengan `ref_no` = nomor JO. Daftar BOM hanya usulan; semua baris diperiksa dulu — **semua atau tidak sama sekali**.
6. Pasca selesai: panel menunjukkan selisih per bahan; item keluar yang tidak ada di BOM bertanda *di luar BOM*; selisih baru dibaca setelah JO selesai (variance_readable).

#### Aturan & kontrol
- `request_materials` (seam, belum dipakai layar; layar memanggil `create_pr` langsung dengan baris yang sama): `not_permitted`, `order_cancelled`, `no_bom`, `bom_has_a_cycle`, `nothing_to_buy`.
- Trigger `check_jo_reference` (0171): `source_wo_no` di baris PR **harus JO yang ada dan tidak `CANCELLED`**; `ref_no` bahan keluar/kembali berbentuk `spk-`/`jo-` harus JO yang ada.
- `issue_for_work_order`: `wo_cancelled`, `location_required`, `nothing_to_issue`, `not_stocked`; stok tak cukup **dicatat dan ditandai, tidak ditolak** (`negative`).
- **Tidak ada reservasi stok per JO**: dua JO bisa sama-sama `ready` atas plywood yang sama (D312). Stok tidak pernah berkurang otomatis dari progres (D266).
- Perbandingan hanya **bahan vs bahan**; tenaga kerja di kedua sisi tidak ada.

#### Jejak data (apa yang terekam)
`ops_procure.pr_documents`/`pr_lines` (`source_wo_no`), `ops_inv.stock_moves` (`ref_no`), audit; outbox `production.materials.requested` (hanya jalur seam). Dokumen: ikut jalur Procurement/Inventory.

#### Serah-terima ke tim lain
**Procurement**: PR draft → submit/approval/PO/receiving. **Inventory**: stok masuk dari penerimaan; bahan keluar ke JO. **Accounting**: PO dibayar lewat ledger; pengeluaran per proyek muncul di `/proyek/produksi`.

#### Koreksi & pengecualian
PR dobel: periksa daftar baris di panel sebelum `Create another PR`. Belanja umum proyek tanpa JO diperbolehkan (ongkos angkut) tetapi muncul sebagai "purchase lines in the story that name no JO" di Job trail.

#### Checklist rutin
- Per JO baru: status bahan `Menunggu bahan`? ajukan PR hari itu.
- Mingguan: bandingkan *Requested* vs *Material projection*; selidiki selisih.
- Setelah JO `DONE`: baca selisih bahan keluar vs BOM.

#### Sumber
`0065_prod_bom_explode.sql`, `0066_prod_purchase_request.sql`, `0130` (`issue_for_work_order`), `0158_procure_line_against_po.sql` (`create_pr`), `0171_prod_job_trail.sql`; `src/app/(app)/produksi/jadwal/WorkOrderDrawer.tsx`; D151, D238, D257, D266, D312, Q54, F78, `docs/plan/penomoran.md`.

---

### Pencatatan lantai produksi: progres tahap, timeslot, dan target harian

#### Tujuan
Menjawab tiga pertanyaan lantai: **siapa mengerjakan apa, berapa banyak, sampai tahap mana — dan berapa jam** (D351, D352), tanpa menulis ulang sejarah (koreksi = entri negatif).

#### Pemilik / peran & kewenangan
- Catat timeslot / progres / koreksi / batalkan timeslot: `production.update` (admin produksi). **Tukang tidak melapor sendiri**; mandor/admin mencatat (cukup absensi bagi tukang; D355).
- Posting dari lembar lembur produksi yang ditandatangani: authority `approve_overtime` (D147; pintu kedua `record_progress`).
- Target harian: `production.update`, `hrd.update`, atau authority `approve_funds`/`approve_goods` (D356).
- Lihat: `production.read`; jam hadir vs timeslot hanya bagi yang boleh membaca absensi.

#### Prasyarat
JO `OPEN`; **barang ada di bengkel** (rute `SUBCON`: tidak semua barang sedang di vendor).

#### Langkah-langkah
1. Admin produksi → `/produksi/jadwal` → kartu *The floor: who worked on what / Lantai produksi: siapa mengerjakan apa* → `Record a timeslot / Catat timeslot` (atau di drawer JO): pilih JO, tanggal, jam mulai–selesai (WIB) **atau** hanya lamanya (`only the duration`), **kegiatan** dalam kata bengkel (mis. "rakit pintu", "tambah engsel"), **orang** (pilih dari roster karyawan aktif; ketik nama bebas = tim/vendor `bukan karyawan`), `Finished a stage / Selesai tahap` + jumlah (opsional) → `Record / Catat`. **Lahir `tsl-YY-MM-DD_NNN`**. Bila ada tahap + jumlah, **satu entri progres** ikut diposting (membawa `slot_id`).
2. Hanya jumlah tanpa timeslot (mis. koreksi): drawer JO → `Correct a count / record pieces without a timeslot` → tahap, jumlah (negatif = koreksi), tanggal, jam (opsional), siapa, catatan → `Record / Catat`. **Koreksi negatif wajib catatan alasan.**
3. Salah catat timeslot: `Cancel / Batalkan` → alasan → `Cancel timeslot / Batalkan timeslot` → jumlah yang diposting ditarik otomatis lewat entri negatif; catatan tetap ada.
4. Target: kartu lantai → tab **Targets / Target** → `Set a target / Isi target` → JO, tanggal (hari ini atau nanti), tahap, jumlah, alasan → `Save target / Simpan target`. `0` berarti "tidak direncanakan". Drawer JO menampilkan *Target hari ini: Amplas 12/15*.
5. Tab lain: **Timeslots**, **Per person / Per orang** (semua karyawan aktif; baris kosong = belum dicatat), **Pieces per hour / Hasil per jam** (per tahap per JO, tidak dijumlah lintas tahap).
6. Baris PM di papan: *10/100 selesai · Amplas 1 · Finishing 2 · belum mulai 87*.

#### Aturan & kontrol
- `record_progress`: `unknown_stage` (tahap pensiun disebut jelas), `stage_not_on_product`, `qty_required`, `reason_required`, `wo_not_open`, `employee_not_found`, `over_order` (kumulatif per tahap > jumlah pesanan), `below_zero`, `still_at_vendor` / `not_sent_yet` (barang tidak ada di bengkel), jam: `span_half` (harus dua-duanya), `span_backwards`, `span_too_long` (> 16 jam), `span_other_day`, `span_in_future`; lembar sudah diposting → `noop`.
- Jam disimpan sebagai momen WIB; entri tanpa jam ditandai *jam tidak dicatat* — tidak pernah ditebak dari `recorded_at`. Pergeseran malam melewati tengah malam termasuk hari mulainya.
- `record_work_slot`: `workers_required`, `activity_required`, `duration_required`, `worker_twice`, `worker_name_required`, `stage_required`, `qty_positive`, `sheet_line_required` (dari lembar lembur), durasi > 960 menit ditolak.
- Penghitungan: tahap = kumulatif entri; tahap lama yang digulung dihitung **minimum, bukan jumlah** (F74). *Completed* = jumlah yang lewat **tahap terakhir** JO itu.
- Target: `stage_not_on_product`, `qty_required`, `over_order`, `day_passed` (hari yang sudah lewat tidak bisa diberi/diubah), `reason_required` (mengubah target yang ada), sama → `noop`; `wo_not_open`.
- Entri append-only; tak ada UPDATE/DELETE pada progres.

#### Jejak data (apa yang terekam)
`ops_prod.progress_entries` (`worked_by` verbatim + tautan karyawan **di samping** nama, `source` `manual|overtime_sheet`, `started_at/finished_at`, `slot_id`), `work_slots`, `work_slot_workers`, `daily_targets` (append-only, siapa/kapan/alasan), audit. Tidak ada dokumen.

#### Serah-terima ke tim lain
**HRD**: lembur produksi (satu lembar, banyak nama; ditandatangani pimpinan) memposting progres dan timeslot per baris (satu timeslot per orang, klaim = baris lembar); HRD melihat jam timeslot vs absensi. Hasil tim tidak dikreditkan ke kartu KPI HRD (D355).

#### Koreksi & pengecualian
Angka/jam salah: tarik dengan entri negatif beralasan lalu catat ulang. Nama pekerja yang diketik bebas tetap sebagai ditulis; **`/produksi/penautan` (menautkan nama ke karyawan atau menandai "bukan satu orang") hanya sandbox — tidak aktif di live**; sistem tidak pernah mencocokkan nama sendiri (D264).

#### Checklist rutin
- Harian (mandor/admin): catat timeslot hari itu **sebelum pulang**; isi target hari berikutnya.
- Mingguan: baris tanpa timeslot di *Per person*; entri `belum ditautkan`.

#### Sumber
`0062_prod_progress.sql`, `0130`, `0197_prod_progress_hours.sql`, `0198_prod_work_slots.sql`, `0201_prod_daily_targets.sql`; `src/app/(app)/produksi/jadwal/{WorkSlots,Targets,ProgressPanels,WorkOrderDrawer}.tsx`; D147, D148, D264, D275, D346, D351, D352, D355, D356, F74, F92, F205/F206. (Catatan: header `0197`/`0198` menyebut D346–D348; di log keputusan nomor itu dipakai ulang — gunakan D351–D356.)

---

### Pekerjaan vendor (vendor leg) untuk JO rute SUBCON

#### Tujuan
Mencatat **vendor mana memegang berapa barang untuk proses apa, sejak kapan, dijanjikan kembali kapan** — satu baris per perjalanan, karena satu barang bisa mampir ke beberapa vendor.

#### Pemilik / peran & kewenangan
`production.update` (kirim dan catat kembali). Vendor diambil dari daftar vendor Procurement (`procurement.read` untuk pemilih). Pelaku: admin produksi/mandor.

#### Prasyarat
JO `OPEN`; vendor ada di master vendor (Procurement).

#### Langkah-langkah
1. Drawer JO → blok *Done by a vendor / Dikerjakan vendor* → pilih `Process / Proses` (`BARANG_MENTAH` Barang mentah, `JOK`, `AMPLAS`, `FINISHING`, `PACKING`), `Vendor`, `Quantity`, `Promised back / Dijanjikan kembali` → `Record sent / Catat dikirim`. **Lahir `leg-YY-MM-DD_NN`**; tanggal kirim = **hari ini** (tidak bisa mundur).
2. Barang kembali: pada leg → `Back on / Kembali`, `Quantity` (boleh **kurang** dari yang dikirim — sisanya jadi "kurang N dari yang dikirim") → `Record return / Catat kembali`.
3. Selama sebagian barang di vendor, progres hanya boleh untuk sisa yang di bengkel; semua di vendor → tidak ada tahap yang bisa dilaporkan.

#### Aturan & kontrol
- `unknown_process`, `vendor_not_found`, `qty_required`, `promise_in_past`, `over_order` (di vendor + kirim > jumlah JO), `wo_not_open`.
- Kembali: `returned_before_sent`, `qty_negative`, `over_sent` (lebih dari yang dikirim = barang pesanan lain, catat terpisah); sudah kembali → `noop`.
- **Yang pergi dan tidak kembali dikurangkan dari bengkel dan ditampilkan** (`not_returned_qty`, F107, D284). Kembali dari vendor **tidak otomatis mencatat progres** (leg = di mana barang; progres = apa yang dikerjakan, ditulis orang lain, hari lain; D280).
- Keterlambatan vendor ditandai `vendor late` / `vendor telat` — bukan menyalahkan bengkel (D254).

#### Jejak data (apa yang terekam)
`ops_prod.vendor_legs` (+ `v_vendor_leg`), audit. Dokumen: tidak ada.

#### Serah-terima ke tim lain
Procurement memiliki master vendor; **tidak ada** pembayaran/biaya vendor otomatis dari leg — jasa vendor dibayar lewat PR/PO/ledger biasa.

#### Koreksi & pengecualian
Leg salah qty/vendor: tidak ada edit/batal leg; catat kembali 0 dengan catatan dan buat leg baru. `/produksi/vendor` (daftar leg lintas JO dan **rekam jejak vendor**: tepat waktu %, rata-rata hari, unit hilang) **hanya sandbox — tidak aktif di live**.

#### Checklist rutin
- Harian: leg terbuka melewati janji → telepon vendor.
- Mingguan: leg tertutup dengan *short by*.

#### Sumber
`0063_prod_vendor_legs.sql`, `0130` (`send_to_vendor`, `receive_from_vendor`); `src/app/(app)/produksi/vendor/page.tsx`; D254, D255, D280, D282, D284, F107.

---

### Penutupan Job Order dan barang jadi

#### Tujuan
Menutup JO dengan jujur (selesai penuh atau sebagian dengan alasan) dan memasukkan hasilnya ke **gudang barang jadi** agar tidak hilang dari sistem saat JO ditutup.

#### Pemilik / peran & kewenangan
Tutup JO: `production.update`. Catat gerak barang jadi (`produced`, `transfer`, `scrap`, `sold`, `return`): `inventory` write; hitung/`count`: `inventory.adjust`; alokasi surplus ke pesanan lain: `inventory` write. Pelaku: admin produksi (tutup), kepala gudang (barang jadi).

#### Prasyarat
Progres tahap terakhir tercatat. Untuk gerak barang jadi: JO tidak `CANCELLED`.

#### Langkah-langkah
1. Admin produksi → drawer JO → bila semua unit lewat tahap terakhir, peringatan *Every unit has passed the last stage — this Job Order can be closed* → `Close Job Order / Tutup Job Order` → (bila belum penuh: isi alasan) → `Close / Tutup`. Status `OPEN` → `DONE`; alasan ditulis ke catatan JO.
2. Kepala gudang → `/inventory/produk` (*Finished goods / Barang jadi*) → `Record a finished-goods move / Catat gerak barang jadi` → jenis `produced`, produk, lokasi, jumlah, **nomor JO (wajib)** → **lahir `fgm-YY-MM-DD_NN`**; baris pesanan klien diturunkan dari JO (tidak diketik).
3. Pastikan barang jadi dipindah ke **lokasi rumah produk** sebelum surat jalan dibuat (lihat Aturan).
4. Kelebihan produksi dan surplus **dihitung, tidak disimpan**; surplus boleh dialokasikan ke pesanan lain (`allocate_product`, wajib alasan).

#### Aturan & kontrol
- Tutup: `reason_required` bila selesai < jumlah; `already_closed`. JO **tidak otomatis `DONE`** ketika selesai — harus ditutup orang.
- Barang jadi: `wo_required`, `wo_cancelled`, `line_other_product`, `reason_required` (scrap/sold/return/adjust), `insufficient`, `no_such_location`. Surat jalan **mengurangi rak dari lokasi rumah produk** (atau `GUDANG`) tanpa peduli di rak mana barang sebenarnya (F177/Q59) — bila barang ada di rak lain, stok per lokasi salah; total batch tetap benar.
- JO yang ditutup tidak menerima progres/timeslot/target baru (`wo_not_open`).

#### Jejak data (apa yang terekam)
`ops_prod.work_orders.status`, `ops_inv.product_moves` (`move_no`, `wo_no`, `project_line_id`, `reason`), `product_settings` (lokasi rumah); audit; outbox `inventory.product.moved`/`counted`. Foto barang jadi (kind `foto`) → drive PROCUREMENT `ops-talaliving/INVENTORY/FINISHED GOODS`.

#### Serah-terima ke tim lain
**Inventory** memegang buku barang jadi; **Delivery** membaca *made* langsung dari progres JO (bukan dari buku barang jadi), dan pengiriman dibaca dari surat jalan (tidak dicatat dua kali, D311).

#### Koreksi & pengecualian
Tutup keliru: tidak ada "buka kembali" JO di layar. Hasil produksi keliru: `adjust`/`scrap` beralasan di buku barang jadi.

#### Checklist rutin
- Setelah tahap `PACKING` penuh: tutup JO hari itu.
- Mingguan: *Overproduction* dan *Awaiting delivery* di `/inventory/produk`.

#### Sumber
`0130` (`close_work_order`), `0170_inv_finished_goods.sql`; `src/app/(app)/inventory/produk/**`; D311, D313, F177, Q59.

---

### Peti & label (packing)

#### Tujuan
Satu peti, satu kode, satu **ruang tujuan di dalam gedung**; supaya kru di lokasi tidak membuka peti satu per satu dan kekurangan tidak ketahuan di hari pemasangan (D262).

#### Pemilik / peran & kewenangan
Kemas: `delivery.create`. Muat ke surat jalan: `delivery.create` atau `update`. Scan/terpasang/bermasalah: `delivery.update`. Lihat: `delivery.read` atau `project.read`. Pelaku: kru lapangan / kepala gudang (`delivery` write).

#### Prasyarat
Proyek ada. Surat jalan hanya bila peti langsung dimuat.

#### Langkah-langkah
1. Kru → `/proyek/peti` → `Pack a box / Kemas peti` → proyek, **`Destination inside the building / Tujuan di dalam gedung`** (mis. "Lantai 2 — kamar tidur utama"), isi peti (baris: deskripsi, jumlah, satuan; baris pesanan opsional — kantong sekrup tak perlu ditautkan), catatan label → `Pack & label / Kemas & beri label`. **Lahir `kol-YY-MM-DD_NN`**, status `PACKED`.
2. `Print labels / Cetak label` → `/proyek/peti/label` (QR membuka `/box/<kode>`; yang memindai adalah tim sendiri yang sudah login).
3. Peti dimuat saat membuat surat jalan (`Boxes going along / Peti yang ikut`) → status `IN_TRANSIT`; posisi dihitung `3 dari 12`.
4. Di lokasi: pindai QR → `/box/[kode]` → `Arrived on site / Sampai di site` (`ON_SITE`) → setelah dipasang `Installed / Terpasang` (`INSTALLED`); bila ada masalah `There is a problem / Ada masalah` → tulis apa yang salah → `Save problem / Simpan masalah` (`PROBLEM`).

#### Aturan & kontrol
- `destination_required`; `contents_required`; `line_not_found`; `wrong_project`; `already_loaded` (sudah ikut pengiriman lain); `cancelled`.
- Satu penolakan pada peti: **tidak bisa ditandai terpasang sebelum ada yang memindainya di lokasi** (`not_on_site`). Scan pada peti yang sudah `ON_SITE`/`INSTALLED`/`PROBLEM` → `noop`. `problem_note_required`.
- Peti dipindai di lokasi padahal catatan bilang belum berangkat = celah kertas, **tidak ditolak** (peti ada di tangan orang).

#### Jejak data (apa yang terekam)
`ops_dlv.packing_boxes`, `box_lines`; `scanned_by/at`, `problem_note`; audit. Foto temuan/peti (kind `foto_lokasi`) → drive **PROJECT MANAGER** `ops-talaliving/FOTO LOKASI`.

#### Serah-terima ke tim lain
Ke pengiriman (proses berikutnya); label dicetak oleh tim yang sama. Tidak ada serah ke Procurement/Accounting.

#### Koreksi & pengecualian
Pengiriman lama tidak punya peti (label belum ada) — celah catatan, bukan truk kosong. Salah isi peti: tidak ada edit isi; kemas ulang.

#### Checklist rutin
- Sebelum truk: tidak ada peti `PACKED` yang tertinggal (*Packed, no truck yet*).
- Hari pemasangan: tidak ada peti *With problems* yang belum ditangani.

#### Sumber
`0132_dlv_delivery.sql`; `src/app/(app)/proyek/peti/**`, `src/app/(app)/box/[box]/page.tsx`; D262.

---

### Pengiriman (surat jalan keluar)

#### Tujuan
Mencatat **apa yang berangkat dan apa yang sudah diterima di lokasi**; menolak janji kosong (surat jalan untuk barang yang belum jadi).

#### Pemilik / peran & kewenangan
Buat surat jalan: `delivery.create`. Catat sampai: `delivery.update`. Lihat: `project.read` atau `delivery.read` (kru membaca proyek/baris lewat `delivery.read`). Pelaku: kru lapangan/kepala gudang.

#### Prasyarat
Ada JO yang menghasilkan barang (*ready to ship* = dibuat − sudah berangkat). Barang jasa/tanpa JO tidak punya angka yang bisa ditolak.

#### Langkah-langkah
1. Kru → `/proyek/pengiriman` → daftar *Ready to ship / Siap kirim* dan *At a vendor / Sedang di vendor* (jawaban atas "di mana barang saya?") → `Create delivery note / Buat surat jalan` → isi jumlah per baris, sopir, kendaraan, catatan, peti yang ikut → `Dispatch N / Berangkatkan N`.
2. **Lahir `krm-YY-MM-DD_NN`**, status `IN_TRANSIT`; **proyek → `SHIPPED`** pada surat jalan pertama (log: "Surat jalan … berangkat").
3. Barang tiba: `Record arrival / Catat sampai` → `Who received it on site? / Diterima siapa di lokasi?` + **unggah foto surat jalan bertanda tangan** (jenis `Surat Jalan Keluar`, wajib) + foto barang (jenis `Foto Lokasi`, opsional) → `Save / Simpan` → status `ARRIVED`.

#### Aturan & kontrol
- `not_enough_made` (409): "Baris N: siap kirim X, diminta Y; sudah dibuat M, terkirim D" (D210). `date_required`, `no_lines`, `qty_required`, baris bukan milik proyek.
- `mark_arrived`: `already_arrived`, `cancelled`, `receiver_required`, `surat_jalan_required`. **Tidak bisa `ARRIVED` tanpa nama penerima dan lampiran surat jalan** (constraint tabel juga).
- *Delivered* (berangkat) dan *arrived* (ditandatangani) adalah dua hitungan berbeda dari baris yang sama (F62). Pengiriman berangkat tanpa pernah dicatat sampai ditandai di daftar — bukan truknya hilang, tetapi tidak ada yang menulis.

#### Jejak data (apa yang terekam)
`ops_dlv.deliveries`, `delivery_lines`; lampiran: `attachment_links` (`entity = delivery`, `kind = surat_jalan_keluar` dan `foto_lokasi`). **Drive**: **PROJECT MANAGER** → `ops-talaliving/SURAT JALAN KELUAR` dan `ops-talaliving/FOTO LOKASI` (tanpa subfolder per proyek/bulan — hanya folder tugas). `project_status_log`; audit.

#### Serah-terima ke tim lain
**Inventory**: pengiriman mengurangi rak barang jadi (dibaca dari surat jalan, ke lokasi rumah produk atau `GUDANG`). Accounting: tidak ada (tidak ada penagihan).

#### Koreksi & pengecualian
Tidak ada pembatalan atau pengubahan surat jalan di layar/seam (status `CANCELLED` ada di tipe data tetapi tidak ada fungsinya; `DRAFT` tidak dipakai). Surat jalan salah: catat catatan dan buat koreksi di pengiriman berikutnya; konsultasikan IT bila harus dibatalkan (lihat Kesenjangan).

#### Checklist rutin
- Hari kirim: peti dimuat dan terdaftar; foto surat jalan ditandatangani diunggah **hari yang sama**.
- Harian: pengiriman `IN_TRANSIT` yang belum `ARRIVED`.

#### Sumber
`0131_core_delivery_enums.sql`, `0132_dlv_delivery.sql`, `0135_dlv_helpers_invoker.sql`; `src/app/(app)/proyek/pengiriman/page.tsx`; `src/services/delivery/*`; D209, D210, D311, F62, F177.

---

### Instalasi dan temuan (snag)

#### Tujuan
Mencatat **kunjungan pemasangan** (satu hari, satu tim, apa yang terpasang) dan **temuan** yang hidup lebih lama dari kunjungan; menolak memasang lebih dari yang sudah sampai.

#### Pemilik / peran & kewenangan
Catat pemasangan dan buka temuan: `delivery.create`. Tutup temuan, scan/tandai peti: `delivery.update`. Lihat: `project.read` atau `delivery.read`. Pelaku: kru pemasang.

#### Prasyarat
Barang tercatat `ARRIVED` (*on site* = sampai − terpasang).

#### Langkah-langkah
1. Kru → `/proyek/instalasi` → *On site, not installed / Di lokasi, belum terpasang* → `Record installation / Catat pemasangan` → tanggal, `Crew on site / Tim yang datang`, jumlah per baris, catatan, **temuan opsional** (apa yang salah, `Found by / Ditemukan siapa`, tingkat `minor`/`major`, `Snag photo / Foto temuan`) → `Record N units installed / Catat N unit terpasang`. **Lahir `pas-YY-MM-DD_NN`** (status `DONE`); temuan **`tmn-YY-MM-DD_NN`** status `OPEN`.
2. Temuan diperbaiki: baris temuan → `Close / Tutup` → `What was done? / Apa yang dikerjakan?` → `Save`. Status `FIXED`, `fixed_on` = hari ini.

#### Aturan & kontrol
- `not_enough_on_site` (409): "di lokasi ada X, dilaporkan Y; sudah berangkat/sampai/terpasang …. Kalau barangnya memang ada di sana, pengirimannya yang belum dicatat sampai." (D210).
- `no_lines`, `qty_required`, baris bukan milik proyek; temuan: `description_required`, `raiser_required`, `unknown_severity`; tutup: `fix_note_required`, `already_fixed`.
- Status `SCHEDULED`/`CANCELLED` kunjungan ada di tipe data tetapi **tidak ada fungsi untuk menjadwalkan atau membatalkan** (hanya mencatat yang sudah `DONE`).

#### Jejak data (apa yang terekam)
`ops_dlv.installations`, `installation_lines`, `snags`; foto temuan: `attachment_links` (`entity = snag`, `kind = foto_lokasi`) → **PROJECT MANAGER** `ops-talaliving/FOTO LOKASI`; audit.

#### Serah-terima ke tim lain
Temuan terbuka dibawa ke serah-terima (dibekukan di BAST). Perbaikan membutuhkan Produksi (kerja ulang) — dikomunikasikan di luar sistem (tidak ada tugas otomatis ke produksi).

#### Koreksi & pengecualian
Kunjungan salah angka: tidak ada edit; catat catatan dan koreksi di kunjungan berikutnya. Temuan salah ketik: tutup dengan keterangan, buka yang baru.

#### Checklist rutin
- Setiap kunjungan: catat temuan hari itu juga (usia temuan dihitung).
- Mingguan: *snags still open* dan usianya.

#### Sumber
`0132_dlv_delivery.sql`; `src/app/(app)/proyek/instalasi/page.tsx`; D209, D210, D212.

---

### Serah-terima (BAST) dan penutupan proyek

#### Tujuan
Mencatat bahwa **klien menerima pekerjaan** — dengan BAST bertanda tangan — dan menutup proyek (`DONE`). Dibaca per baris: **dipesan · dibuat · berangkat · sampai · terpasang**.

#### Pemilik / peran & kewenangan
Serah-terima: **`project.handover`** (ikut level `write` modul `project`; bukan `delivery`) — ia menutup proyek. Lihat: `project.read` atau `delivery.read`. Pelaku: PM. Tanpa authority bernama.

#### Prasyarat
Ada barang tercatat terkirim atau terpasang; BAST bertanda tangan di tangan (foto/PDF). Temuan terbuka tidak menghalangi.

#### Langkah-langkah
1. PM → `/proyek/serah-terima` → kartu proyek (baca 5 angka per baris dan `% installed`) → `Hand over / Serah terima`.
2. Isi `Signing for the client / Yang tanda tangan dari klien` (nama + jabatan seperti di kertas), `Signing for us / dari kita`, tanggal, catatan, dan **`Upload the signed BAST / Unggah BAST yang sudah ditandatangani`** (jenis `BAST`) → `Record handover / Catat serah terima`.
3. **Lahir `bast-YY-MM-DD_NN`** (satu per proyek). **Proyek → `DONE`**, `is_active = false`; daftar temuan `OPEN` saat itu **dibekukan** di BAST (jumlah + nomor).

#### Aturan & kontrol
- `bast_required` (422): tanpa dokumen = klaim bahwa klien menerima, dan klien satu-satunya pihak yang tak bisa mengoreksi catatan kita (D211). `reps_required`; `already_handed_over` (409, satu per proyek); `nothing_delivered` (belum ada barang tercatat terkirim/terpasang); `not_permitted` tanpa `project.handover`.
- Serah-terima dengan temuan terbuka **diperbolehkan dan biasa**; angka dan nomor temuan dibekukan, tidak dihitung ulang (D212).

#### Jejak data (apa yang terekam)
`ops_dlv.handovers` (`open_snags_at_handover`, `open_snag_nos`), `attachment_links` (`entity = handover`, `kind = bast`), `project_status_log` ("BAST … ditandatangani"), audit. **Drive**: **PROJECT MANAGER** → `ops-talaliving/BAST`.

#### Serah-terima ke tim lain
**Accounting/Finance**: penutupan proyek tidak memicu apa pun di ledger; penagihan/pembayaran klien dilakukan finance di luar sistem (lihat proses Pembayaran di bawah). **Marketing**: komisi agen dibayar bila referral `WON`.

#### Koreksi & pengecualian
Tidak ada pembatalan BAST di layar. **Status `DONE` juga bisa disetel manual** di drawer proyek tanpa BAST (celah — lihat Kesenjangan). Temuan setelah BAST: tetap bisa dibuka/ditutup (`raise_snag`) tetapi tidak mengubah angka beku.

#### Checklist rutin
- Sebelum menandatangani: temuan terbuka dibaca bersama klien.
- Setelah: foto BAST diunggah, status proyek `DONE`, beri tahu finance.

#### Sumber
`0132_dlv_delivery.sql` (`record_handover`); `src/app/(app)/proyek/serah-terima/page.tsx`; `src/lib/roles.ts` (`project.handover`); D211, D212, F61.

---

### Pembayaran klien dan penutupan keuangan proyek

#### Tujuan
Menjelaskan **apa yang sistem ini catat dan tidak catat** tentang uang dari klien, supaya staf tidak mencari fitur yang memang tidak ada.

#### Pemilik / peran & kewenangan
Finance/pimpinan menangani klien langsung di luar sistem (D164, D106). Di dalam sistem: Accounting mencatat **pengeluaran** proyek di ledger (`post_ledger`), pimpinan memberi **dana operasional** (satu-satunya pemasukan, D106).

#### Prasyarat
—

#### Langkah-langkah
1. Syarat bayar ditulis sebagai teks bebas di `Terms & conditions` quotation (mis. "DP 50 %") dan di catatan proyek (mis. "termin 3 kali, DP sudah masuk"). **Tidak ada tagihan, termin, atau penerimaan pembayaran klien di sistem.**
2. Finance menagih dan menerima pembayaran klien langsung; yang tercatat sistem hanya dana operasional dari pimpinan dan semua pengeluaran per proyek (`/accounting/liquidation`, dan `/proyek/produksi` bagi yang boleh membaca ledger).
3. Komisi agen untuk referral `WON`: Accounting membayar lewat ledger; `/marketing/agen` menampilkan terutang.

#### Aturan & kontrol
- `contract_value` = nilai yang disepakati, **bukan faktur** dan bukan produk quotation (D164); tidak ada laba/rugi proyek di sistem; laporan biaya tetap **bahan vs bahan** (D151).

#### Jejak data (apa yang terekam)
Hanya sisi biaya: PR/PO/ledger bertanda proyek. Tidak ada tabel piutang.

#### Serah-terima ke tim lain
Produksi/Proyek → Accounting: nomor proyek dan nilai kontrak sebagai acuan baca; angka komisi.

#### Koreksi & pengecualian
Pembayaran klien yang perlu dibukukan ke sistem: **belum ada jalurnya** (kesenjangan, bukan pengecualian).

#### Checklist rutin
Finance: cocokkan status `DONE` dan BAST dengan penagihan yang dilakukannya sendiri.

#### Sumber
D106, D164, `docs/plan/03-api.md` (Projects); `0133` (`terms`).

---

### Job trail dan biaya proyeksi vs aktual (penelusuran)

#### Tujuan
**Satu nomor apa pun membuka seluruh ceritanya** (D312): dari nomor proyek, JO, PR, PO, receiving, surat jalan atau kode barang → urutan waktu katalog → BOM → PR → PO → penerimaan → stok → bahan keluar → progres → barang jadi → surat jalan → BAST. Dan membandingkan biaya.

#### Pemilik / peran & kewenangan
Job trail: salah satu dari `production.read`, `project.read`, `procurement.read`, `inventory.read`, atau akses baca pengiriman. **Tiap bagian hanya ditampilkan bila pembaca boleh membaca modulnya; bagian yang disembunyikan disebut** ("Not shown for this account … bukan berarti tidak terjadi"). Biaya vs proyeksi: `project.read` (angka diminta/disetujui/dibayar butuh `procurement.read`, ledger `accounting.read`, komisi `marketing.read`/`accounting.read`).

#### Prasyarat
Nomor yang ada.

#### Langkah-langkah
1. `/produksi/jejak` → ketik nomor (`25007`, `jo-26-09-23_01`, `spk-…`, `pr-…`, `po-…`, `rcv-…`, `krm-…`, atau kode barang) → `Open trail / Buka jejak`. Kode barang membuka **riwayat barang itu**: katalog, BOM yang memakainya, PR, PO, penerimaan, stok, JO yang dilayani.
2. Dari drawer JO: tautan *Jejak lengkap*. Baca baris PR yang tidak menyebut JO ("Purchase lines in the story that name no JO").
3. `/proyek/produksi` (*Cost vs projection*): pilih proyek → *Projected materials* (BOM × jumlah dipesan) vs *Requested via PR* vs *Approved* vs *Paid*, per item dan per JO, plus semua belanja yang dibukukan ke proyek (lebih luas; **jangan dikurangkan**).

#### Aturan & kontrol
`not_permitted`, `number_required`, `not_found` ("… tidak ditemukan sebagai proyek, JO, PR, PO, penerimaan, surat jalan, atau kode barang"). Hanya baca; tidak menulis apa pun. Barang yang di-merge dibaca sebagai barang tujuan merge.

#### Jejak data (apa yang terekam)
Dibaca dari baris yang ada (tidak ada tabel jejak, agar tidak ada salinan kedua yang bisa berbeda, D313): `work_orders`, `pr_lines`, `po_lines`, `receipts`, `stock_moves`, `progress_entries`, `product_moves`, `deliveries`, `handovers`.

#### Serah-terima ke tim lain
Alat tinjau bersama: Produksi, Procurement, Inventory, Accounting, PM.

#### Koreksi & pengecualian
Rantai putus bila `source_wo_no` salah ketik pada baris lama (baris sebelum `0171` tidak diperiksa). PO yang dibuat tanpa PR tidak punya jalur ke JO.

#### Checklist rutin
- Akhir proyek: buka trail proyek, pastikan tidak ada pembelian tanpa JO yang tak terjelaskan; cocokkan proyeksi vs diminta/dibayar.

#### Sumber
`0171_prod_job_trail.sql` (`job_trail`, `item_trail`, `check_jo_reference`), `0066` (`v_project_cost`); `src/app/(app)/produksi/jejak/page.tsx`, `src/app/(app)/proyek/produksi/page.tsx`; `docs/plan/penomoran.md`; D151, D312, D313, F104.

---

### Kesenjangan & catatan chapter ini

**A. Belum dibangun / belum aktif di sistem live**
1. **`/produksi/desain`, `/produksi/penautan`, `/produksi/vendor` hanya sandbox.** `node scripts/check-live-routes.mjs --report` (1 Okt): 7 rute gelap; tiga di antaranya di wilayah ini menunggu `production.*` (9 fungsi desain, `listUnresolvedNames`/`resolveWorkName`, `listVendorLegs`/`listVendorRecords`). Tidak ada tabel desain di database (`design_tasks`, `design_revisions` tidak ada di migrasi). **Workaround**: antrean gambar dikelola di luar sistem; gambar kerja tetap diunggah di drawer produk; leg vendor tetap dicatat di drawer JO; nama pekerja tidak ditautkan.
2. **Tidak ada pembatalan Job Order** (status `CANCELLED` ada; tidak ada seam/layar; trigger `check_jo_reference` sudah menolak PR untuk JO `CANCELLED`). Workaround: `Close Job Order` dengan alasan.
3. **Tidak ada pembatalan/pengubahan surat jalan, kunjungan instalasi, atau BAST**; status `DRAFT`/`CANCELLED` (delivery) dan `SCHEDULED`/`CANCELLED` (instalasi) tidak punya fungsi; instalasi tak bisa dijadwalkan.
4. **Pembayaran klien tidak tercatat** (D164, D106) — disengaja, tetapi staf sering mencarinya. Tidak ada piutang, termin, atau jadwal tagih.
5. **`record_commission_paid` tanpa klien/layar** (hanya DB). Pembayaran komisi dibukukan di ledger oleh Accounting; `commission_trx_no` di referral tidak bisa diisi dari aplikasi, sehingga komisi tampil "belum dibayar" selamanya. Ledger juga tidak punya jenis transaksi/tautan khusus komisi.
6. **Layar marketing tidak punya impor scrape, promosi baris scrape, pembuatan pasar, atau qualify/disqualify properti** (seam ada; tabel produksi kosong, D316). Data awal harus dimuat IT.
7. **Hasil cetak quotation tidak disimpan** sebagai dokumen (hanya cetak/Save as PDF dari browser); jenis dokumen `quotation` di Drive adalah milik vendor/Procurement. Tidak ada jejak berkas apa yang persisnya dikirim ke klien selain angka beku.
8. **Drive**: tidak ada jenis dokumen yang dipetakan ke drive **PRODUCTION**; BAST, surat jalan keluar, foto lokasi hanya masuk folder tugas (`BAST`, `SURAT JALAN KELUAR`, `FOTO LOKASI`) di PROJECT MANAGER **tanpa subfolder per proyek/bulan** (token `{YYYY-MM}` baru ada untuk transaksi, `0203`). Pemisahan per proyek hanya lewat `attachment_links`.
9. **`production.schedule`** ada di katalog izin tetapi tidak dicek oleh kode/seam mana pun. Seam `ops_prod.request_materials` ada tetapi layar membuat PR lewat `create_pr` langsung.
10. **Tahap 1–3 metode PLV (dimensi per baris, tier otomatis, baris turunan, rate card berversi) belum dibangun** (`docs/analysis/2026-09-30-plv-bom-vs-ops-bom.md`); sampai itu `miscalc_percent` 18,64 % mewakili misc + overhead (D355). Empat pasang angka STMV bertabrakan menunggu owner (Q-D355a, Q-D338a).
11. **Aktual per JO (jam × upah) belum dirangkum ke biaya per unit**; proyeksi vs aktual hanya bahan vs bahan.
12. Tidak ada reservasi stok per JO, JO tidak wajib di baris PR bahan produksi, dan PO tanpa PR tak punya jalur ke JO (keputusan pemilik 2026-09-25, `penomoran.md`).

**B. Kontrol yang longgar (nyata di kode)**
13. **Tidak ada persetujuan pimpinan atas quotation, rilis BOM, atau pembuatan JO** — semuanya cukup `project.update`/`production.update`. Authority hanya relevan di target harian dan posting lembur.
14. **Status proyek `DONE` bisa diset manual tanpa BAST** (`set_project_status` menerima status mana pun); BAST hanya jalur yang *menjamin* dokumen.
15. **Nilai kontrak tidak diisi dari quotation** yang disetujui; harus diketik, padahal referral `WON` mensyaratkannya.
16. Tombol *Create PR from the BOM* tampil bagi `production.update` tetapi seam butuh `procurement.create` (Q54): mandor tanpa grant itu akan ditolak setelah menekan.
17. Tanggal kirim leg vendor selalu hari ini (tidak bisa mundur); leg tidak bisa diedit/dibatalkan.
18. Ongkos produksi/margin quotation hanya untuk `project.update`, tetapi layar menampilkan *Selling price − cost* (selisih) — berhadapan dengan D164 "tidak ada profitabilitas proyek" (lihat C).

**C. Konflik dokumen vs kode (kode menang)**
19. **D240 "No quotation model" / `03-api.md` ("nothing in this system produces either yet") sudah usang**: `0133` + layar `/proyek/quotation` + `src/lib/api/quotation.ts` membangunnya penuh (2026-09-23), **tanpa nomor D baru**; komentar `0133` yang menjelaskan pembukaan ulang itu satu-satunya catatannya. Perlu D-number resmi.
20. **D164 vs quotation**: D164 melarang kolom laba; quotation menyimpan margin % dan memperlihatkan *Selling price − cost*; `ops_prod.v_project_cost` menampilkan `contract_value`. Pemilik perlu menegaskan.
21. **Nomor JO**: `penomoran.md`, placeholder `/produksi/jejak` ("spk-26-08-24_01") dan contoh docs memakai `spk-…`; kode memberi nomor baru `jo-YY-MM-DD_NN` sejak `0130`. Trail dan trigger menerima keduanya.
22. **Zona waktu nomor harian**: `0004` menulis Asia/Makassar (WITA); sejak `0190` (D334) jam kantor adalah WIB (Asia/Jakarta). Komentar lama di migrasi/dokumen yang menyebut WITA sudah tidak berlaku.
23. **README D324** masih menyebut daftar rate kosong dan AI memerlukan konfigurasi; kenyataan produksi: 84 rate (29 Sep) + 26 rate PLV (D355), `0193` terpasang (F205). Header `0197`/`0198` memakai nomor D346–D348 yang di log keputusan dipakai ulang (kategori barang/lokasi); pakai D351–D356 untuk jam, timeslot, target.
24. Dokumen lama (D253) masih menyebut empat tahap *Pembuatan · Finishing · QC · Packing*; kode sekarang `AMPLAS` · `FINISHING` · `MACHINERY` · `PACKING` (D275, D278); `QC` digulung ke `PACKING`.

**D. Yang tidak dapat dipastikan dari kode**
25. Siapa sebenarnya memegang grant `project` write, `production` write, `delivery` write, `marketing` write di produksi: **tidak ada seed produksi untuk peran ini**; IT yang mengaturnya di `/it/pengguna` (baca di sana, bukan dari bab ini). Persona demo bukan akun asli.
26. Aturan tindak lanjut temuan (siapa memperbaiki, SLA), prosedur pembatalan dokumen pengiriman, dan siapa memverifikasi isi peti di gudang **tidak ditetapkan di kode**; perlu keputusan pemilik sebelum dijadikan aturan SOP.
27. Apakah `LLM` dan akun layanan Drive terpasang di deployment produksi (syarat `AI suggestion`): diatur IT lewat Worker secret; tidak dapat dipastikan dari repo.



## Bab 6 — Platform lintas-tim: akses, jejak, penomoran, John Lau, lingkungan & rilis

> Keadaan kode dan migrasi sampai 2026-10-01 (keputusan terakhir D365, migrasi terakhir `0207`).
> Kode dan commit terbaru dipakai sebagai kebenaran; bila dokumen lama berbeda, konfliknya dicatat di
> bagian penutup. Istilah status, nama layar, label tombol, id, nama modul dan nama wewenang ditulis persis
> seperti di kode (data, bukan terjemahan). Hal yang tidak bisa dikonfirmasi dari repo ditulis "tidak terkonfirmasi".

Prinsip yang membuat bab ini penting bagi semua tim: sistem harus menyatukan setiap proses dan merekam
setiap kegiatan dari awal sampai akhir. Untuk itu platform memegang lima janji:

1. **Satu identitas terverifikasi di setiap tindakan** — `actor_id` datang dari sesi (`auth.uid()`), tidak pernah dari isian layar.
2. **Setiap perubahan menulis jejak di transaksi yang sama** — baris bisnis + satu baris `ops_core.audit_log` (+ satu baris `ops_core.outbox`). Penolakan juga dicatat (`outcome = refused`).
3. **Tidak ada yang dihapus** — koreksi adalah VOID / supersession dengan alasan; satu-satunya penghapusan yang disengaja adalah log aktivitas orang (retensi).
4. **Nomor dokumen dicetak oleh database** — satu nomor dapat membuka seluruh ceritanya (lihat penomoran).
5. **Akses dan wewenang dipisah** — modul/level menentukan layar mana yang terbuka; wewenang bernama menentukan siapa yang boleh memutuskan.

---

### Masuk ke sistem: sign-in, atur kata sandi, keluar, dan halaman tanpa akses

#### Tujuan
Memastikan setiap tindakan di sistem dilakukan oleh orang yang dikenal, dan setiap orang yang masuk tahu
persis apa yang terjadi bila ia belum/tidak lagi punya akses. Tidak ada pendaftaran mandiri: orang hanya
masuk bila IT sudah membuat akunnya.

#### Pemilik / peran & kewenangan
- **Pemilik proses**: IT (pemegang `it` level `admin`, khususnya `it.manage_users`) untuk pembuatan akun; setiap pengguna untuk sign-in dan ganti kata sandi sendiri.
- Tidak ada wewenang bernama yang terlibat. Akun baru **tidak memegang modul maupun wewenang apa pun** (D24) sampai IT memberinya.
- Autentikasi dipegang Supabase Auth (GoTrue); profil dan hak dipegang `ops_core.users`, `ops_core.user_modules`, `ops_core.user_authorities`.

#### Prasyarat
- Deployment berjalan dalam **mode live** (`NEXT_PUBLIC_USE_SUPABASE=1` + `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY`, ketiganya). Tanpa salah satunya aplikasi diam-diam menjadi **demo** (lihat bagian Mode demo). Badge di halaman `/signin` — **Live** (hijau) atau **Demo** (kuning) — adalah penanda yang tidak boleh salah.
- Akun sudah dibuat IT di `/it/pengguna` (lihat bagian Pengelolaan pengguna).
- Pengaturan di luar repo (dashboard Supabase, `docs/plan/phase-2/06-auth.md`): **Site URL** harus domain produksi, daftar **Redirect URLs** memuat origin produksi dan preview (`https://*-ops-talaliving.<subdomain>.workers.dev/**`), dan SMTP sungguhan (mail bawaan Supabase dibatasi beberapa pesan per jam). Salah satunya kosong = tautan undangan/pemulihan mendarat di tempat yang salah (insiden: akun admin pertama tanpa kata sandi yang bisa diatur selama 3 minggu, `phase-2/06-auth.md`).

#### Langkah-langkah
**A. Masuk (live)**
1. Pengguna → `/signin` (halaman apa pun di dalam shell yang diminta tanpa sesi dialihkan ke `/signin?next=<path>`; `next` hanya diterima bila path internal, bukan `//host` atau `/signin`) → isi **email** dan **kata sandi** → tekan tombol masuk.
2. Sistem memanggil Supabase Auth `signInWithPassword`. Salah kata sandi dan alamat yang tidak dikenal menghasilkan **kalimat yang sama** (*That email and password do not match an account here.*) agar tidak bisa dipakai menebak alamat.
3. Bila berhasil, klien memanggil `ops_core.record_sign_in()` → **terekam**: satu baris `audit_log` `service=identity`, `entity=session`, `action=sign_in`, `outcome=ok`. Bila profil `ops_core.users` belum ada (akun lebih tua dari trigger), profil dibuat saat itu juga **tanpa modul/wewenang** dan alasan baris audit menyebut *provisioned on first sign-in*.
4. Bila akun `is_active = false`: `record_sign_in` mencatat `outcome=refused` (*the account is switched off*), lalu klien **keluar paksa** dan layar menampilkan *Akun ini sudah dinonaktifkan. Hubungi IT jika ini keliru.*
5. Pengguna diarahkan ke halaman `next` atau `/dashboard`. Pintu (`door`) ditentukan dari akun (lihat bagian Dasbor): `staff`, `employee`, atau `none`.

**B. Lupa kata sandi / tautan dari IT**
1. Pengguna → `/signin` → isi email → *lupa kata sandi* → sistem memanggil `resetPasswordForEmail` dengan `redirectTo = <origin>/set-password`. Jawabannya **selalu "terkirim"** walau alamat tidak ada (tidak membocorkan alamat nyata); hanya kegagalan server (5xx) yang dilaporkan sebagai masalah deployment.
2. Pengguna membuka tautan di email → `/set-password`. Tautan yang diminta sendiri (PKCE, `?code=`) ditukar otomatis; tautan yang dikirim IT (undangan/pemulihan) berbentuk implicit (`#access_token=`), dibaca halaman itu sendiri lalu fragmennya dihapus dari bilah alamat.
3. Pengguna mengisi kata sandi baru → `auth.updateUser`. Aturan kekuatan kata sandi = aturan GoTrue (kalimat GoTrue ditampilkan apa adanya). **Terekam**: `activity_events` `kind=update`, `target=session`, label *Mengganti kata sandi*.
4. Tautan kedaluwarsa/terpakai/tanpa sesi menghasilkan *Tautan ini sudah dipakai atau kedaluwarsa. Minta tautan baru dari halaman masuk.*

**C. Karyawan tanpa email (username `.local`)**
1. IT membuatkan kata sandi (lihat Pengelolaan pengguna). Karyawan masuk dengan "email" berbentuk `nama@pekerja.talaliving.com`/`*.local` (teks biasa, tidak pernah dikirimi surat) dan kata sandi dari IT.
2. Karyawan yang lupa kata sandi **tidak** bisa meminta tautan (tidak ada mailbox) — minta IT membuat kata sandi baru.

**D. Akun tanpa akses**
1. Akun aktif tanpa modul dan tanpa tautan ke data karyawan → shell mengarahkan ke `/no-access`: *Belum ada modul yang diberikan* + email akun + tombol *Masuk sebagai orang lain*. (Tombol *Beri saya akses baca (demo)* hanya ada untuk sandbox demo; di live menu itu tidak punya efek yang berarti dan pemberian akses tetap keputusan IT.)
2. Akun yang dinonaktifkan IT → `/no-access` versi *Akun ini dinonaktifkan* (kalimat berbeda karena solusinya berbeda: bukan "minta diberi modul" tetapi "minta diaktifkan kembali").
3. Akun tanpa modul tetapi tertaut ke data karyawan masuk lewat pintu `employee` ke `/saya` (lihat bagian Dasbor).

**E. Keluar**
1. Tombol keluar di topbar (`signOut()`) → sesi berakhir; shell membaca ulang sesi.

#### Aturan & kontrol
- **Tidak ada formulir pendaftaran.** Akun dibuat oleh IT; orang tidak bisa mendaftarkan diri (kontrol akses ke ruang kerja).
- **Akun nonaktif tidak memegang apa pun**: `has_permission()` dan `has_authority()` di database menjawab kosong untuk `is_active = false`, dan view akses tidak mengembang izin (0183). Ini berlaku seketika, termasuk `approve_funds`.
- **Pemblokiran sign-in (`banned_until`) hanya terjadi bila server punya `SUPABASE_SERVICE_ROLE_KEY`** (Secret Worker). Tanpa kunci itu akun nonaktif tetap bisa melewati halaman masuk tetapi tidak melihat apa pun; layar IT mengatakannya dan menawarkan *Blokir masuk sekarang*.
- Penegakan akses adalah **RLS dan fungsi `security definer` di Postgres**; menu yang disembunyikan hanyalah kesopanan. Shell tidak mengecek izin per-rute — hanya pintu (`staff` / `employee` / `none`) dan apakah rute itu "live".
- Pesan kesalahan selalu menyebut siapa yang bisa bertindak (aturan A7).

#### Jejak data (apa yang terekam)
| Peristiwa | Tempat | Kunci |
|---|---|---|
| Sign-in berhasil / profil dibuat saat sign-in | `ops_core.audit_log` | `identity · session · sign_in · ok` |
| Sign-in oleh akun nonaktif | `ops_core.audit_log` | `sign_in · refused` |
| Ganti kata sandi sendiri | `ops_core.activity_events` | `kind=update`, label *Mengganti kata sandi* (tampil di tab Aktivitas `/profil`) |
| Kata sandi salah / alamat tidak dikenal | **tidak direkam oleh aplikasi** (hanya log GoTrue di dashboard Supabase — tidak terkonfirmasi cara melihatnya) | — |
| Keluar (sign-out) | **tidak direkam** (jenis `sign_out` didokumentasikan di 0027/0163 tetapi tidak ada pemanggilnya) | — |
| Masuk lewat tautan undangan/pemulihan | tidak ada baris `sign_in` (halaman `/set-password` tidak memanggil `record_sign_in`); `last_sign_in_at` tercatat di GoTrue | — |

#### Serah-terima ke tim lain
- Akun tanpa modul → IT (`/it/pengguna`) memberi modul; karyawan lapangan → IT menautkan akun ke data karyawan, lalu HRD yang memegang data karyawan itu.
- Setelah masuk, tiap tim bekerja di modulnya; bab modul masing-masing mengatur langkah selanjutnya.

#### Koreksi & pengecualian
- Lupa kata sandi staf dengan email asli: *lupa kata sandi* di `/signin`. Tanpa email: IT → *Buat kata sandi baru*.
- Admin pertama pada database baru: fungsi `ops_core.bootstrap_admin(email)` dijalankan lewat SQL oleh orang yang menyiapkan database (menolak bila sudah ada admin IT). Kata sandi pertama dapat diatur lewat SQL editor oleh pemilik akunnya sendiri (`docs/plan/phase-2/06-auth.md`) — sekali, untuk akun pertama.
- Akun salah nonaktif: IT *Aktifkan kembali* (grant yang disimpan berlaku lagi persis seperti semula).

#### Checklist rutin
- [ ] Badge `/signin` bertuliskan **Live** di produksi (bukan Demo).
- [ ] Tiap bulan: tinjau `/it/pengguna` filter *Belum pernah masuk* — undangan yang tidak pernah dipakai.
- [ ] Setiap ada karyawan keluar: akun *Nonaktifkan* pada hari yang sama (lihat Pengelolaan pengguna).
- [ ] Setelah mengganti deployment/domain: uji satu tautan *lupa kata sandi* dari preview dan dari produksi.

#### Sumber
`src/app/signin/page.tsx`, `src/app/set-password/page.tsx`, `src/app/no-access/page.tsx`, `src/lib/api/identity.ts` (`signIn`, `recordSignIn`, `requestPasswordReset`, `setPassword`), `src/store/session.tsx`, `supabase/migrations/0007_core_auth.sql`, `0029_provision_existing_users.sql`, `0183_core_user_admin.sql`, `docs/plan/phase-2/06-auth.md`, D24, D325, D329, D331.

---

### Pengelolaan pengguna dan akun karyawan (`/it/pengguna`)

#### Tujuan
IT mengelola **orangnya**, bukan hanya aksesnya: menambah akun, memperbaiki nama, membuat/mengirim kata sandi atau tautan, menonaktifkan dan mengaktifkan kembali akun, menautkan akun ke data karyawan, serta memberi modul dan wewenang. Setiap perubahan tercatat dan tidak ada akun yang dihapus (nama seseorang ada di persetujuan, slip gaji dan nota; `users.id` dirujuk di mana-mana).

#### Pemilik / peran & kewenangan
- **Pemilik**: IT.
- Layar `/it/pengguna` muncul di menu **Users** bila punya `it.manage_users` (hanya `it` level `admin`).
- Memberi modul/wewenang di database memerlukan `it.manage_roles` (juga hanya `it` level `admin`). Pimpinan memegang `it: read` — bisa membaca direktori tetapi **tidak** mengubah apa pun (D190).
- Tidak ada wewenang bernama (`approve_*`, `post_ledger`, `resolve_inbox`) yang dibutuhkan.

#### Prasyarat
- Pelaksana memegang `it` = `admin`.
- Untuk undangan email dan blokir sign-in: `SUPABASE_SERVICE_ROLE_KEY` terpasang sebagai **Secret** Worker; SMTP sungguhan di Supabase.
- Untuk menautkan ke karyawan: data karyawan sudah ada di HRD (`/hrd/karyawan`).

#### Langkah-langkah
**A. Menambah pengguna**
1. IT → `/it/pengguna` → **Tambah pengguna** → pilih *Cara masuk*: **Dengan kata sandi (disarankan)** atau **Undangan email** → isi *Nama lengkap* dan *Email (nama pengguna)* → opsional *Karyawan* (pilih dari karyawan yang belum punya akun) → **Tambah dan buat kata sandi** / **Tambah dan kirim undangan**.
2. Database memutuskan lebih dulu sebagai orang yang menekan tombol: `ops_core.create_user` / `invite_user` (cek `it.manage_users`, format email, nama wajib ≤ 120 karakter, alamat belum terdaftar). **Terekam**: audit `identity · user · create` atau `invite` (`ok`, atau `refused`/`invalid`/`duplicate` dengan alasan).
3. Hanya bila jawabannya ok, rute `/api/identity/users` meminta GoTrue (admin API) membuat akun (`email_confirm: true` + kata sandi yang dibangkitkan server, atau mengirim undangan). Trigger `provision_user` membuat profil `ops_core.users` **tanpa modul dan wewenang**.
4. Mode kata sandi: kata sandi dibangkitkan server (format `Kx7mP-q4rTz`, tanpa karakter mirip), **ditampilkan sekali** ke IT dengan tombol **Salin** / **Salin keduanya** / **Selesai — sudah diserahkan**. Kata sandi itu tidak disimpan di tabel, audit, log aktivitas, outbox maupun penyimpanan browser.
5. Bila *Karyawan* dipilih, akun langsung ditautkan (`ops_hr.link_employee_account`, audit `hr · employee · account.link`).
6. IT memberi modul dan wewenang (langkah C).

**B. Mengelola akun yang ada** (klik satu orang di daftar; filter *Semua / Aktif / Belum pernah masuk / Nonaktif*, cari nama atau email)
1. **Ubah nama** → `update_user` (audit `profile.update`, before/after nama; nama tidak boleh kosong; sama = `noop`).
2. **Buat kata sandi baru** → `request_user_password` → server membangkitkan kata sandi baru, ditampilkan sekali. **Ditolak untuk akun sendiri** (`self_service_refused` — ganti sendiri di `/profil`) dan untuk akun nonaktif (`user_inactive`).
3. **Kirim tautan atur kata sandi** / **Kirim ulang undangan** → `request_user_link`; database memilih jenisnya (undangan bila alamat belum pernah dikonfirmasi, pemulihan bila sudah). Ditolak untuk alamat `.local` (`no_mailbox`: buat kata sandi baru saja) dan akun nonaktif.
4. **Nonaktifkan** → isi alasan opsional (*mis. resign, kontrak selesai*) → konfirmasi → `set_user_active(false)`. Akun tidak memegang apa pun lagi seketika dan, bila server punya kunci, sign-in diblokir. **Tidak bisa menonaktifkan akun sendiri** (`self_service_refused`). Grant tidak dihapus. Hasilnya menunjukkan `sign_in`: `blocked` / `allowed` / `not_configured` / `failed`; bila bukan `blocked`, tombol **Blokir masuk sekarang** tersedia.
5. **Aktifkan kembali** → `set_user_active(true)`; semua grant kembali berlaku.
6. **Tautkan ke karyawan** / **Lepas tautan** → `link_employee_account` (menolak: karyawan sudah punya akun lain `employee_has_account`, akun sudah tertaut ke karyawan lain `account_linked_elsewhere`, karyawan sudah keluar `employee_left`; melepas tautan selalu boleh).

**C. Memberi akses** (panel *Akses modul* dan *Wewenang* pada orang yang dipilih)
1. Per modul tekan **Baca** / **Baca & ubah** / **Penuh** (menekan level yang sama mencabut). Tiap klik menyimpan **seluruh set modul** (`ops_core.set_modules`).
2. Per wewenang tekan tombol wewenang (menyala = dipegang; tekan lagi = dicabut) → `ops_core.set_authorities` (juga mengganti seluruh set).
3. Hasil dan penolakan: dibaca langsung dari database. **Terekam**: audit `identity · user · modules.set` / `authorities.set` dengan before/after set lengkap, `granted_by` + `granted_at`, dan peristiwa outbox `identity/access.changed`.

#### Aturan & kontrol
- **Akun baru nol akses** (D24). Tidak ada akun yang mewarisi apa pun dari "peran".
- **Bukan layanan-mandiri**: IT tidak dapat mengubah modul/wewenang, kata sandi, atau status aktif **akunnya sendiri** — orang lain yang harus melakukannya (`self_service_refused`). Inilah satu-satunya kontrol ganda: tidak ada persetujuan kedua bila IT A memberi `approve_funds` kepada IT B (lihat Kesenjangan).
- **Tidak ada hapus akun** (A5). Keluar = `left_on` + nonaktif.
- Level `Penuh` pada sebuah modul **tidak pernah** menyiratkan wewenang bernama (D24); wewenang diberikan satu per satu.
- Daftar pemegang wewenang di bagian atas `/it/pengguna` hanya menghitung akun aktif; wewenang tanpa pemegang tampil merah *tidak ada yang memegang* — tindakan itu akan selalu ditolak.
- Nama harus benar: nama ini yang tercetak di setiap persetujuan, slip gaji dan nota.

#### Jejak data (apa yang terekam)
- `ops_core.audit_log`: `create`, `invite`, `profile.update`, `password.reset`, `link.send`, `user.deactivate`, `user.reactivate`, `modules.set`, `authorities.set`, `account.link`/`account.unlink` (+ penolakannya).
- `ops_core.user_modules.granted_by/granted_at`, `ops_core.user_authorities.granted_by/granted_at` (keadaan terkini; lihat Kesenjangan: dihitung ulang tiap simpan).
- `ops_core.outbox`: `identity/access.changed`, `access.changed` (tidak dikirim ke Chat — aturan pengiriman sengaja off).
- GoTrue: `invited_at`, `last_sign_in_at`, `banned_until` (dibaca ke direktori: kolom status *Aktif* / *Belum pernah masuk* / *Nonaktif*).
- **Tidak direkam**: kata sandi yang dibangkitkan (sengaja).

#### Serah-terima ke tim lain
- IT → HRD: akun yang ditautkan ke karyawan muncul read-only di HR → Karyawan; data karyawan tetap milik HRD.
- IT → pimpinan/keuangan: wewenang diberikan atas keputusan pemilik (mis. siapa memegang `approve_funds`); IT hanya menjalankan.
- Karyawan keluar: HRD melakukan *offboard* (`0192`) di `/hrd/karyawan`; IT menonaktifkan akun. Dua langkah ini terpisah dan tidak otomatis — lihat Kesenjangan.

#### Koreksi & pengecualian
- Salah beri/cabut modul atau wewenang: setel ulang di panel; keduanya tercatat sebagai dua baris audit (jejak tidak dihapus).
- Salah ketik email saat membuat akun: tidak ada layar ubah-email (hanya nama) — tidak terkonfirmasi ada jalan lain; buat akun baru dan nonaktifkan yang salah.
- Alamat sudah terdaftar: sistem menjawab `already_registered` dan menunjuk akun itu (apakah nonaktif atau perlu tautan).
- Kunci layanan tidak terpasang: undangan ditolak dengan kalimat yang menyebut Secret-nya; nonaktif tetap mencabut akses tetapi belum memblokir masuk.

#### Checklist rutin
- [ ] Mingguan: tiap wewenang punya pemegang (`/it/peran`, bagian *Siapa memegang wewenang apa*) dan tidak ada yang memegang tanpa alasan.
- [ ] Setiap karyawan keluar: *Nonaktifkan* dengan alasan.
- [ ] Bulanan: akun *Belum pernah masuk* — kirim ulang tautan atau nonaktifkan.
- [ ] Setiap perubahan hak: periksa `/it/audit` (aksi `modules.set` / `authorities.set`).

#### Sumber
`src/app/(app)/it/pengguna/page.tsx`, `src/app/api/identity/users`, `src/lib/api/identity.ts`, `src/lib/generated-password.ts`, `supabase/migrations/0002_core_identity.sql`, `0007_core_auth.sql`, `0183_core_user_admin.sql`, `0185_core_employee_accounts.sql`, `0192_hr_offboard.sql`, D24, D190, D325, D329, F182.

---

### Akses modul, wewenang bernama, dan katalog peran (`/it/peran`)

#### Tujuan
Menjawab dua pertanyaan tanpa menyunting apa pun: *apa yang sebenarnya dibuka oleh "Baca & ubah" di sebuah modul* dan *siapa yang hari ini boleh memutuskan apa*. Tidak ada "peran" yang bisa diedit; yang ada adalah katalog (modul × level) dan hak per orang.

#### Pemilik / peran & kewenangan
- Layar `/it/peran` (menu **Roles & Permissions**) butuh `it.manage_roles`; katalognya sendiri adalah **kode** (`src/lib/roles.ts`) yang dicerminkan ke `ops_core.permission_catalog`; CI (`scripts/check-permissions.mjs`) menggagalkan build bila keduanya berbeda.
- Pemberi hak: IT (`it` = `admin`). Penentu *siapa seharusnya memegang apa*: pemilik/pimpinan.
- "Peran" bisnis hanyalah kombinasi hak (mis. Direktur, Keuangan, HRD, Kepala Gudang) — nama itu tidak disimpan di sistem.

#### Prasyarat
Akun aktif dan sudah dibuat (bagian sebelumnya).

#### Langkah-langkah
1. Pemilik/pimpinan memutuskan siapa memegang apa (di luar sistem; keputusan dicatat sebagai `D…` bila dari pemilik).
2. IT → `/it/pengguna` → pilih orang → atur **Akses modul** dan **Wewenang** (lihat bagian sebelumnya).
3. IT/pimpinan membaca `/it/peran`: (a) kartu *Siapa boleh membuka modul IT* (pemegang `it` dan levelnya: *Penuh* = mengelola dan menghapus, *Baca* = membaca saja); (b) tabel *Apa yang dibuka tiap level*; (c) daftar *Siapa memegang wewenang apa* dengan lencana jumlah (merah = tidak ada pemegang, hijau = satu, kuning = dua atau lebih).
4. Setiap pemakaian hak oleh pengguna dievaluasi dua kali: menu menyembunyikan layar yang tidak diizinkan (`can()`), dan database menolak panggilan yang tidak diizinkan (RLS / `has_permission()` / `has_authority()`), **terekam** sebagai `outcome = refused` di `audit_log`.

#### Aturan & kontrol
- Level terurut `read` < `write` < `admin`. `read` selalu hanya `<modul>.read`; `write` membuka semua kata kerja kecuali yang khusus-admin; `admin` menambah kata kerja khusus-admin (`ADMIN_ONLY`: `it.manage_users`, `it.manage_roles`, `it.purge_activity`, `it.manage_drives`, `accounting.plan_cash`).
- **Wewenang tidak pernah tersirat dari level** (D24). Persetujuan barang dan persetujuan uang tidak pernah digabung (A1).
- **Modul IT**: hanya IT dan pimpinan boleh membukanya (IT_ACCESS_RULE). Pimpinan membaca (`read`); mengelola pengguna/peran dan menghapus log aktivitas tetap `admin` IT. "Pimpinan" **tidak** dideduksi dari wewenang (tidak ada flag `is_leadership`): pengganti sementara pemegang `approve_funds` tidak otomatis boleh membaca log aktivitas semua orang (D190).
- Estimasi kas 12 bulan (`accounting.plan_cash`) hanya `accounting` level `admin` (D233): pimpinan.
- Akun nonaktif tidak memegang apa pun (0183).
- `ops_core.approvers()` hanya menjawab nama + email pemegang `approve_goods`/`approve_funds` yang aktif (agar papan persetujuan dapat berkata *dikirim ke Evin*); fungsi ini sengaja tanpa parameter agar tidak membocorkan pemegang `post_ledger` atau akses IT.

#### Matriks modul × level (lengkap)

Keterangan: **R** = hanya melihat; **W** = Baca & ubah (`write`); **A** = Penuh (`admin`). Kolom "Izin dalam katalog" = `PERMISSION_CATALOG` (`src/lib/roles.ts`) = `ops_core.permission_catalog`. Tanda `*` = khusus-admin.

| Modul (`ModuleName`, label ID) | Izin dalam katalog | `read` — Baca | `write` — Baca & ubah | `admin` — Penuh |
|---|---|---|---|---|
| `dashboard` (Dasbor) | `dashboard.read` | melihat Dasbor | sama dengan read | sama dengan read |
| `hrd` (SDM) | `read`, `create`, `update` | melihat | + membuat, mengubah | sama dengan write |
| `payroll` (Penggajian) | `read`, `run` | melihat | + menjalankan penggajian | sama dengan write |
| `procurement` (Pengadaan) | `read`, `create`, `update` | melihat | + membuat, mengubah | sama dengan write |
| `inventory` (Persediaan) | `read`, `create`, `update`, `adjust` | melihat | + membuat, mengubah, menyesuaikan stok | sama dengan write |
| `accounting` (Akuntansi) | `read`, `create`, `update`, `plan_cash`* | melihat | + membuat, mengubah (membaca dan menulis rencana kas dan memposting pembayaran nyata; **tanpa** menetapkan perkiraan) | + `plan_cash`: menetapkan perkiraan kas |
| `marketing` (Pemasaran) | `read`, `create`, `update` | melihat | + membuat, mengubah | sama dengan write |
| `project` (Proyek) | `read`, `create`, `update`, `handover` | melihat | + membuat, mengubah, melakukan serah terima (BAST) | sama dengan write |
| `production` (Produksi) | `read`, `create`, `update`, `schedule` | melihat | + membuat, mengubah, menjadwalkan | sama dengan write |
| `delivery` (Pengiriman) | `read`, `create`, `update` | melihat | + membuat, mengubah (peti, surat jalan, instalasi, snag) | sama dengan write |
| `it` (IT) | `read`, `update`, `manage_users`*, `manage_roles`*, `purge_activity`*, `manage_drives`* | membaca Audit Log, Activity Log, direktori, John Lau — tidak dimengerti, Google Drive (pimpinan di sini) | + mengubah (`it.update`: merekap hari log aktivitas, mengubah aturan gaji) | + mengelola pengguna, mengelola peran/hak, menghapus log aktivitas (retensi), memilih folder shared drive |
| `settings` (Pengaturan) | `read`, `update` | melihat | + mengubah | sama dengan write |

Catatan penafsiran: aksi `read` dipenuhi **level apa pun** pada modul itu; pemegang modul dengan level apa pun otomatis bisa `.read`. Tidak ada modul HRD ↔ payroll otomatis: `hrd` dan `payroll` adalah dua grant terpisah.

Gerbang layar yang bukan sekadar `modul.read` (dari `src/lib/nav.ts`):

| Layar | Syarat membuka |
|---|---|
| Audit Log `/it/audit`, Activity Log `/it/aktivitas`, John Lau — tidak dimengerti `/it/john-lau`, Google Drive `/it/drive` | `it.read` |
| Users `/it/pengguna` | `it.manage_users` |
| Roles & Permissions `/it/peran` | `it.manage_roles` |
| Aturan penggajian `/it/aturan-gaji` | `payroll.read` **atau** `it.update` (HRD membaca, IT mengubah; D193) |
| Overtime `/hrd/lembur` | `hrd.read` **atau** wewenang `approve_overtime` |
| Statutory contributions `/hrd/iuran`, Wajib Lapor `/hrd/wlkp`, Performance `/hrd/kinerja` | `payroll.read` atau `accounting.read` / `hrd.read` sesuai rute |
| Delivery, Packing boxes, Installation, Handover (di bawah Projects) | `project.read` **atau** `delivery.read` |
| John Lau `/john-lau` ("Apa yang boleh ditanyakan") | `dashboard.read` |
| Pengaturan `/pengaturan` | `settings.read` |
| `/saya`, `/profil` | akun mana pun yang masuk (`/saya`: terikat data karyawan) |

#### Matriks wewenang bernama (lima)

| Wewenang (`Authority`) | Label di layar | Mengizinkan (yang terkonfirmasi di migrasi) | Pemegang bawaan (acuan) |
|---|---|---|---|
| `approve_goods` | Menyetujui barang (CEO) | Langkah persetujuan `GOODS` pada baris PR (`approve_line`); konfirmasi PO oleh pimpinan (`approve_po`; bila penulis PO memegangnya, PO terkonfirmasi sendiri — `self_confirmed`, D267); catatan baris (`note_line`, bersama `approve_funds`); penutupan baris (`line_closures`); mengisi target harian Job Order (0201, bersama `approve_funds`) | **Satu orang: CEO/Direktur** (D19). Pemegang yang dikenal di kode: Evin Jonathan (komentar `0159`). Q18 (menambah direktur operasional) tercatat sebagai contoh jawaban, bukan keputusan |
| `approve_funds` | Menyetujui dana | Langkah `FUNDS` pada baris PR; menyetujui, mentransfer, menutup *payment round* (`approve_round`, `transfer_round`, `close_round`); menutup PO (`close_po`); menyetujui run gaji (`approve_payroll_run`); melihat saldo rekening pimpinan (BCA 064, BCA USD 081 — custody `leadership`); mengubah master data rekening/ledger yang menyentuh rekening pimpinan (`0105`, `0204`); target harian Job Order | **Keuangan/finance** (di acuan seed demo: Putri Handayani dan Geryle Tanoto). Penunjukan nyata tidak ada di repo |
| `approve_overtime` | Menyetujui lembur (pimpinan) | Langkah `leader` pada lembar lembur (`decide_overtime_sheet`; ditolak bila surat lembur belum dilampirkan); memutuskan pengajuan lembur karyawan (`decide_overtime_self`, sebagai `decided_as = leader`); menandatangani lembar produksi = sumber `overtime_sheet` yang memposting progres/timeslot produksi; membuka menu Overtime tanpa modul HR | **Pimpinan/Direktur** (D145: wewenang tersendiri agar bisa dipindah). Di seed demo: Evin Jonathan |
| `post_ledger` | Membukukan ke buku besar | Satu-satunya jalur menulis buku besar: membuat/mengedit/mem-void transaksi `trx-…`, mengalokasikan pembayaran, membayar PO/baris/run gaji (`post_to_po`, `post_from_line`, `post_payroll_run`), melengkapi transaksi, jembatan penerimaan Chat (`0203`) | **Keuangan/akuntansi** (seed demo: Putri Handayani, Anggun Lestari) |
| `resolve_inbox` | Menautkan dokumen tanpa induk | Menyelesaikan dokumen di *Purchase Verification* (`resolve_inbox`, `resolve_inbox_line`), membukukan bukti (`book_evidence`), menautkan bukti (`link_evidence`) | **Keuangan/akuntansi** (seed demo: Putri, Anggun) |

Catatan: "pemegang bawaan" di atas berasal dari **seed demo** (`src/demo/fixtures/reference.ts`) dan keputusan D19/D24/D145 — di produksi hak adalah baris database yang diatur IT lewat `/it/pengguna`; daftar pemegang sungguhan tidak ada di repo dan harus dibaca dari `/it/peran`. Akun seed demo `it@talaliving.com` ("IT / Shared") memegang kelima wewenang dan semua modul `admin` — **hanya demo**; jangan ditiru di produksi.

Contoh kombinasi modul pada seed demo (ilustrasi, bukan data produksi): Direktur — `dashboard`, `procurement`=write, `accounting`/`production`/`inventory`/`project`/`delivery`/`settings`=read, `it`=read; Keuangan — `accounting`=write, `procurement`=write, `settings`=read; Kepala Gudang — `inventory`/`production`/`delivery`=write, `procurement`/`project`=read; HRD — `hrd`=write, `payroll`=write; karyawan lapangan — tanpa modul (hanya `/saya`, `/profil`).

#### Jejak data (apa yang terekam)
- `ops_core.user_modules`, `ops_core.user_authorities` (keadaan terkini + `granted_by`, `granted_at`).
- `ops_core.audit_log`: `modules.set` / `authorities.set` (before/after tersimpan di kolom `before`/`after`), dan setiap `refused` dengan `reason` yang menyebut wewenang/izin yang dibutuhkan.
- `ops_core.permission_catalog` (baca oleh semua yang masuk).

#### Serah-terima ke tim lain
Semua tim: hak yang tidak cukup → alasan penolakan menyebut izin/wewenang yang dibutuhkan → hubungi IT. Keputusan siapa yang seharusnya memegang → pimpinan/pemilik.

#### Koreksi & pengecualian
- Hak kurang atau berlebih: IT menyetel ulang; riwayat tetap di audit.
- Pemegang tunggal wewenang bepergian: pekerjaan berhenti (layar memperingatkan "satu pemegang"); solusinya keputusan manajemen (memberi wewenang kedua), bukan pengecualian teknis.
- Penunjukan pengganti sementara: beri wewenang, lalu cabut setelahnya — **tidak ada kedaluwarsa otomatis** (tidak terkonfirmasi).

#### Checklist rutin
- [ ] Setiap wewenang punya ≥ 1 pemegang aktif (lencana tidak merah).
- [ ] Hanya IT dan pimpinan memegang modul `it`.
- [ ] Pemegang `approve_funds`/`post_ledger` ditinjau setiap triwulan atau saat ada perubahan susunan tim.
- [ ] Setelah menambah izin baru di `roles.ts`: jalankan `node scripts/check-permissions.mjs` (CI melakukannya).

#### Sumber
`src/lib/roles.ts`, `src/services/identity/contracts.ts`, `src/lib/nav.ts`, `src/app/(app)/it/peran/page.tsx`, `supabase/migrations/0002`, `0007`, `0026`, `0159`, `0173`, `0183`, `scripts/check-permissions.mjs`, `src/demo/fixtures/reference.ts`, D19, D22–D24, D145, D190, D233, D267, D314.

---

### Dasbor dan "rumah" tiap pengguna (`/dashboard`, `/saya`, `/profil`)

#### Tujuan
Memberi setiap orang titik mulai yang sesuai: staf melihat angka lintas-modul yang bisa langsung ditindaklanjuti; karyawan lapangan hanya melihat urusan pribadinya (presensi, pengajuan, slip gaji, akun).

#### Pemilik / peran & kewenangan
- `/dashboard`: modul `dashboard.read` (siapa pun yang punya akses modul).
- `/saya` dan `/profil`: setiap akun; `/saya` untuk akun yang tertaut ke data karyawan.
- Tidak ada wewenang bernama.

#### Prasyarat
Sesi aktif. Untuk pintu karyawan: akun tertaut ke data karyawan (`ops_hr.employees.user_id`, diatur IT).

#### Langkah-langkah
1. Pengguna masuk → `/` mengalihkan ke `/dashboard`.
2. Shell menunggu sesi, lalu menentukan **pintu**:
   - `staff` — memegang ≥ 1 modul (dan aktif): shell penuh (sidebar + topbar + dock John Lau); `/saya` terbuka dari topbar.
   - `employee` — tanpa modul tetapi tertaut ke karyawan: shell ponsel (tab bawah), hanya `/saya` dan `/profil`; bahasa bawaan Indonesia sampai memilih sendiri.
   - `none` — selain itu: `/no-access`.
3. **Dasbor** menjawab lima pertanyaan berurutan: berapa uang ada, apakah cukup (kas akhir tiap bulan), apa yang jatuh tempo berikutnya, apa yang menunggu keputusan, apa yang macet — tiap angka menaut ke layar yang bisa menindaklanjutinya. Sumber: `accounting.getCashPlan`, `listDue`, `getInboxHealth`, `listTransactions({limit: 8})`, `procurement.queue`, `listVendorJourneys`.
4. **`/saya`** (empat tab: Presensi, Pengajuan, Gaji, Akun): tap masuk/pulang dari ponsel, mengajukan cuti/izin/sakit/lembur, slip gaji terakhir, ganti kata sandi. **`/profil`** (staf): tab Keamanan, Aktivitas, Presensi, Lembur, Cuti & izin, Tugas, Gaji.
5. Setiap layar yang dibuka tercatat satu kali sebagai `view` (komponen `ActivityRecorder` di shell).

#### Aturan & kontrol
- Semua data `/saya`/`/profil` dibatasi oleh **tautan akun ↔ karyawan** (`my_employee_id()`), bukan oleh grant modul — seorang karyawan hanya membaca barisnya sendiri.
- Akun karyawan-saja yang membuka rute lain dipaksa kembali ke `/saya`.
- Rute yang layanannya belum ada di klien live **gelap**: shell menampilkan panel "belum live" (bukan tabel kosong yang terbaca "tidak ada data"). Daftar rute live dibangkitkan dari kode (`scripts/check-live-routes.mjs`, `src/lib/live.ts`).
- Dasbor memanggil view keuangan; apa yang benar-benar terlihat oleh pemegang `dashboard.read` saja ditentukan RLS pada view tersebut — **tidak terkonfirmasi** dari kode apakah angka kas terlihat oleh pemegang `dashboard` tanpa `accounting` (lihat Kesenjangan).

#### Jejak data (apa yang terekam)
- `activity_events` `kind=view` (target = path, label = nama menu berbahasa Inggris dari `nav.ts`).
- Di `/profil` tab **Aktivitas** orang hanya melihat jenisnya sendiri yang aman: `sign_in`, `sign_out`, `update`, `attendance_tap`, `leave_requested`, `overtime_requested`, `task_acknowledged` (view `v_my_activity`, 0163). Jenis `view`/`export`/`print` sengaja tidak terlihat oleh pemiliknya (D190, D306).

#### Serah-terima ke tim lain
Dasbor mengarahkan ke layar modul pemilik angka (Akuntansi, Pengadaan). Pengajuan karyawan (cuti, lembur) diteruskan ke antrean HRD/pimpinan di `/hrd/cuti`, `/hrd/lembur`.

#### Koreksi & pengecualian
- Karyawan melihat *Akun ini belum tertaut ke data karyawan*: minta IT menautkan.
- Staf tidak melihat angka tertentu: izin modul kurang (IT).
- Bahasa/tampilan: lihat bagian Bahasa dan PWA.

#### Checklist rutin
- [ ] Setiap karyawan lapangan punya akun tertaut (cek `/it/pengguna` → bagian *Data karyawan*).
- [ ] Tidak ada rute dengan panel "belum live" yang masih dipakai tim.

#### Sumber
`src/app/(app)/dashboard/page.tsx`, `src/app/(app)/layout.tsx`, `src/store/session.tsx`, `src/app/(app)/saya/page.tsx`, `src/app/(app)/profil/page.tsx`, `src/components/activity-recorder.tsx`, `src/lib/live.ts`, `supabase/migrations/0163_core_self_activity.sql`, D305, D306, D331.

---

### Penomoran dokumen dan ID

#### Tujuan
Setiap peristiwa punya nomor yang dicetak database, bisa dibaca lewat telepon, tidak berubah sesudah dicetak, dan satu nomor apa pun dapat membuka seluruh ceritanya. **Satu nomor untuk semua dokumen tidak mungkin dan tidak perlu** (satu PO bisa menutup tiga Job Order, satu Job Order belanja ke lima vendor); yang dipakai adalah dua kunci per baris — **kode barang** (`I-00042`: barang apa) dan **nomor Job Order** (`jo-26-09-23_01`: untuk pekerjaan mana) — ditambah layar **Job trail** (`/produksi/jejak`) yang menerima nomor proyek, JO, PR, PO, receiving report atau surat jalan.

#### Pemilik / peran & kewenangan
- Pemilik teknis: IT (migrasi). Penerbit nomor: database (`ops_core.next_doc_number`), dipanggil otomatis oleh tiap seam/kolom default. Tidak ada orang yang mengetik nomor dokumen.
- Menambah prefix baru = migrasi (daftar `ops_core.doc_prefixes`, dapat dibaca semua pengguna).
- Pengecualian yang **diketik manusia**: nomor karyawan (`employee_no`, diisi HRD), kode proyek (angka mis. `25007`, diisi saat membuat proyek), kode produk (mis. `PRD-MJ-220`), kode pasar (`NEGARA[-WILAYAH]-KOTA-AREA`). Tidak terkonfirmasi apakah keunikan kode produk diperiksa oleh generator.

#### Prasyarat
Migrasi terbaru terpasang. Jam kantor = **WIB (UTC+7)** sejak D334/`0190` (`ops_core.office_tz()`).

#### Langkah-langkah
1. Pengguna melakukan tindakan yang membuat dokumen (mis. *New request*, *Issue PO*, simpan transaksi).
2. Database memanggil `ops_core.next_doc_number('<prefix>')`: menaikkan hitungan di `ops_core.doc_numbers (prefix, day)` dengan `insert … on conflict do update` (dua permintaan bersamaan tak bisa menerbitkan nomor sama) dan mengembalikan `prefix-YY-MM-DD_NN`.
3. Nomor tercetak di layar, dokumen cetak, dan menjadi kunci rujukan di baris lain dan di berkas bukti (`attachment_links.entity_no`) serta di baris audit (`audit_log.entity_no`).
4. Untuk menelusuri: ketik nomor di Job trail, atau pakai tombol *Jejak lengkap* di drawer Job Order, atau *Riwayat lengkap barang* di drawer stok.

#### Aturan & kontrol
- Format umum: `prefix-YY-MM-DD_NN` — dua digit urutan per hari per prefix; **tiga digit untuk `trx` dan `tsl`**; urutan tidak pernah dipotong (sejak `0198`, `greatest(width, length(n))`) — sebelum itu `lpad` akan memotong urutan ke-100 per hari.
- Tanggal = **hari kantor** (`office_day`), bukan UTC dan bukan jam browser.
- Nomor yang sudah tercetak **tidak pernah diganti nomornya** (mis. `spk` tetap berlaku untuk Work Order lama; yang baru `jo`).
- Prefix harus terdaftar di `ops_core.doc_prefixes` agar tidak muncul nomor yang tak dikenal.
- Referensi lintas-modul memakai kode publik, bukan uuid (ADR-004).
- Token (bukan nomor dokumen): `tok_…`, `potok_…`, `src_…` (acak 244 bit, tidak dapat ditebak; siapa memegangnya bisa menjawab permintaan itu).

#### Tabel format nomor/ID per modul

Sumber: `ops_core.doc_prefixes` dan kolom default di migrasi (kolom "Dipakai di" = tabel/kolom yang diisi otomatis).

| Modul | Dokumen / ID | Format | Prefix terdaftar | Migrasi |
|---|---|---|---|---|
| Pengadaan | Purchase Request (kepala) | `pr-YY-MM-DD_NN` | `pr` | 0004/0017 |
| Pengadaan | Baris PR | `<pr>-LNN` (mis. `pr-26-09-11_03-L01`) — kolom turunan `line_no_full` | — | 0008 |
| Pengadaan | Batch permintaan persetujuan | `ask-YY-MM-DD_NN` (+ token `tok_…`) | `ask` | 0004/0017/0159 |
| Pengadaan | Payment round | `fund-YY-MM-DD_NN` | `fund` | 0004/0017 |
| Pengadaan | Purchase Order | `po-YY-MM-DD_NN` | `po` | 0004/0017/0139/0143 |
| Pengadaan | Termin pembayaran PO | `<po>-M01` (DP), `<po>-M02` (FINAL) | — | 0017/0143 |
| Pengadaan | Receiving report (penerimaan) | `rcv-YY-MM-DD_NN` | `rcv` | 0004/0012/0138 |
| Pengadaan | Penerimaan dari Google Chat | `rr-YY-MM-DD_NN` (`rr_no`) | `rr` | 0203 |
| Pengadaan | Quotation / penawaran | `qt-YY-MM-DD_NN` | `qt` | 0133 |
| Pengadaan (master) | Kode barang | `I-00001` (5 digit; sebelum 0110/0112 4 digit) | tidak terdaftar | 0017/0110/0112/0168 |
| Pengadaan (master) | Kode vendor | `V-0001` | tidak terdaftar | 0017 |
| Pengadaan / Proyek (master) | Kode klien | `CL-0001` | tidak terdaftar | 0111 |
| Pengadaan | Kode proyek | angka diketik (mis. `25007`) | — | — |
| Akuntansi | Transaksi buku besar | `trx-YY-MM-DD_NNN` (**3 digit**) | `trx` | 0004/0021/0034/0098 |
| Akuntansi | Alokasi pembayaran | `pay-YY-MM-DD_NN` — **terdaftar, tetapi tidak ditemukan pemanggil `next_doc_number('pay')` di migrasi** (tidak terkonfirmasi dipakai) | `pay` | 0004 |
| Akuntansi | Rekening koran (statement) | `rkk-YY-MM-DD_NN` | `rkk` | 0025 |
| Akuntansi | Token sumber (idempotensi posting) | `src_…` | — | 0021 |
| HRD | Tanda hari (day mark) | `dmk-YY-MM-DD_NN` | `dmk` | 0044 |
| HRD | Lembar lembur | `lbr-YY-MM-DD_NN` | `lbr` | 0046 |
| HRD | Run gaji | `pyr-YY-MM-DD_NN` | `pyr` | 0047 |
| HRD | Penyesuaian gaji | `adj-YY-MM-DD_NN` | `adj` | 0055 |
| HRD | Dokumen karyawan (Berkas 201) | `edc-YY-MM-DD_NN` (`doc_ref`) | `edc` | 0056 |
| HRD | Kontrak kerja | `kkj-YY-MM-DD_NN` | `kkj` | 0058 |
| HRD | Pengajuan cuti/izin/sakit | `izn-YY-MM-DD_NN` | `izn` | 0123 |
| HRD | Tugas | `tgs-YY-MM-DD_NN` | `tgs` | 0052 |
| HRD | Rutinitas tugas | `rtn-YY-MM-DD_NN` | `rtn` | 0152 |
| HRD | Nomor karyawan | diketik HRD (`employee_no`, unik) | — | 0056 |
| Persediaan | Gerak stok | `stk-YY-MM-DD_NN` | `stk` | 0071 |
| Persediaan | Gerak papan (board rack) | `ppn-YY-MM-DD_NN` | `ppn` | 0094 |
| Persediaan | Barang jadi (finished goods) | `fgm-YY-MM-DD_NN` | `fgm` | 0170 |
| Persediaan | Pembelian kayu | `kyu-YY-MM-DD_NN` | `kyu` | 0070 |
| Persediaan | Biaya kayu (angkut/gergaji) | `kyb-YY-MM-DD_NN` | `kyb` | 0156 |
| Persediaan | Aset | `AST-0001` | tidak terdaftar | 0107 |
| Persediaan | Token label QR | 32 hex acak (`/l/<token>`) | — | 0179 |
| Produksi | Job Order (baru) | `jo-YY-MM-DD_NN` | `jo` | 0130 |
| Produksi | Work Order lama / SPK | `spk-YY-MM-DD_NN` (tetap berlaku untuk nomor lama) | `spk` | 0061 |
| Produksi | Leg vendor | `leg-YY-MM-DD_NN` | `leg` | 0063 |
| Produksi | Timeslot kerja | `tsl-YY-MM-DD_NNN` (**3 digit**) | `tsl` | 0198 |
| Produksi | Tarif BOM | `RT-0001` | tidak terdaftar | 0182/0200 |
| Produksi | Produk | kode diketik (mis. `PRD-MJ-220`) | — | — |
| Produksi | Tugas desain | `dsn-YY-MM-DD_NN` — hanya di data demo; tidak terdaftar di database | — | — |
| Pengiriman | Surat jalan / pengiriman | `krm-YY-MM-DD_NN` | `krm` | 0132 |
| Pengiriman | Peti (packing box) | `kol-YY-MM-DD_NN` | `kol` | 0132 |
| Pengiriman | Kunjungan instalasi | `pas-YY-MM-DD_NN` | `pas` | 0132 |
| Pengiriman | Snag / temuan | `tmn-YY-MM-DD_NN` | `tmn` | 0132 |
| Proyek | Serah terima (BAST) | `bast-YY-MM-DD_NN` | `bast` | 0132 |
| Pemasaran | Perwakilan penjualan | `agn-YY-MM-DD_NN` | `agn` | 0080 |
| Pemasaran | Referral | `lead-YY-MM-DD_NN` | `lead` | 0080 |
| Pemasaran | Properti | `TL-0004` (urutan `property_ref_seq`; sengaja tidak terdaftar) | — | 0083 |
| Pemasaran | Kode pasar | `NEGARA[-WILAYAH]-KOTA-AREA` (mis. `AU-QLD-GOLDCOAST-SPNORTH`), diketik | — | 0081/0084 |
| Platform | Baris audit | `bigserial` (`audit_log.id`) — rujukan bisnisnya ada di `entity_no` | — | 0003 |
| Platform | Baris outbox | `bigserial` (`outbox.id`) | — | 0003 |
| Platform | Kunci idempotensi | teks dari klien, dibuat saat formulir dibuka; unik `(service, endpoint, key)` | — | 0015 |
| Platform | Turn John Lau / draft | `uuid` (tidak punya nomor baca-manusia) | — | 0039/0040 |

Format yang disebut `docs/plan/00-context.md` §7.2 tetapi **tidak ditemukan generatornya** di migrasi: `<doc>-ANN` (amandemen PO) dan `-vN` (versi dokumen). PO yang diubah memakai `revision` dan supersession baris (`po_lines.superseded_by`), bukan nomor baru.

#### Jejak data (apa yang terekam)
- `ops_core.doc_numbers (prefix, day, seq)` — hitungan per prefix per hari kantor.
- Nomor tertulis di dokumennya, di `audit_log.entity_no`, di `attachment_links.entity_no` (bukti), dan di `stock_moves.ref_no` / `pr_lines.source_wo_no` (penghubung rantai; keduanya **diperiksa** sejak D312: JO tidak ada atau dibatalkan ditolak).

#### Serah-terima ke tim lain
Rantai nomor lintas tim (barang → BOM → PR → PO → receiving → stok → JO → barang jadi → surat jalan → BAST): kolom penghubung `item_id`, `source_wo_no`, `po_lines.pr_line_id`, `receipts.po_line_id`, `stock_moves.ref_no`. Penjelasan lengkap di `docs/plan/penomoran.md`; bab modul masing-masing menjelaskan langkahnya.

#### Koreksi & pengecualian
- Nomor tidak pernah diganti; kesalahan dikoreksi lewat VOID/supersession dengan alasan.
- Belanja proyek tanpa Job Order diperbolehkan (ongkos angkut, belanja umum) — biayanya masuk proyek tetapi tidak dapat ditelusuri ke produksi; Job trail menghitungnya. Keputusan pemilik: mewajibkan JO pada bahan produksi **belum dibangun**; reservasi stok per JO **tidak dibangun** ("sisanya tidak perlu").
- PO tanpa PR tidak punya jalur ke JO.

#### Checklist rutin
- [ ] Nomor yang diminta pihak luar (vendor, bank) dikutip dari dokumen cetak, tidak diketik ulang.
- [ ] Saat menambah jenis dokumen baru: daftarkan prefix di migrasi **dan** di tabel ini.

#### Sumber
`supabase/migrations/0004_core_numbers.sql`, `0198_prod_work_slots.sql` (versi `next_doc_number` terbaru), `0190_core_office_clock_wib.sql`, migrasi pembuat tiap prefix (kolom Migrasi), `docs/plan/penomoran.md`, `docs/plan/00-context.md` §B, D312, D313.

---

### Jejak audit: apa yang direkam dan di mana dilihat

#### Tujuan
Menjawab dua pertanyaan berbeda dengan dua rekaman berbeda — dan menjamin bahwa setiap angka dan keputusan dapat ditelusuri ke orang, waktu, dan buktinya:
- **Audit** menjawab *apa yang terjadi pada baris ini* — bukti tentang **catatan**; ditulis setiap mutasi; **tidak pernah dihapus**.
- **Aktivitas** menjawab *apa yang dilakukan orang ini hari ini* — bukti tentang **orang**; **kedaluwarsa** (retensi).

#### Pemilik / peran & kewenangan
- Membaca: `it.read` (IT dan pimpinan). Audit dan log aktivitas **tidak dapat dibaca lewat John Lau** (alat `it.audit` diblokir).
- Merekap hari log aktivitas: `it.update`. Menghapus (retensi): `it.purge_activity` (hanya `it` = `admin`).
- Pemilik data pribadi hanya melihat feed aman miliknya sendiri di `/profil` → Aktivitas.

#### Prasyarat
Akun dengan `it.read`. Rekaman ditulis oleh seam database, bukan oleh layar.

#### Langkah-langkah
**A. Membaca audit** — IT/pimpinan → `/it/audit` (menu **Audit Log**)
1. Filter: *Nomor dokumen…* (mencari `entity_no` sebagian), *Hasil* (`Berhasil`/`Ditolak`/`Duplikat`/`Tidak ada perubahan` = `ok`/`refused`/`duplicate`/`noop`), *Tindakan* (mis. *Buka nomor identitas* = `reveal`). Menampilkan 300 baris terbaru.
2. Baris: waktu, hasil (lencana), tindakan, `service · entity`, `entity_no`, email pelaku (`system` bila tanpa sesi), alasan; klik membuka rincian.
3. Spanduk ungu: *N nomor identitas dibuka — <pelaku>* (pembukaan KTP/KK/NPWP/BPJS lewat tombol mata; baris menyebut dokumen siapa, bukan nomornya). Spanduk kuning: *N tindakan ditolak dalam rentang ini* — ditolak berulang berarti hak kurang atau orang mengerjakan pekerjaan orang lain.

**B. Membaca log aktivitas** — IT/pimpinan → `/it/aktivitas` (menu **Activity Log**)
1. Kartu retensi: *Detail tersimpan*, *Detail lewat batas*, *Rekap harian*, *Rekap lewat batas* (aturan dibaca dari `ops_core.settings`).
2. Daftar *kejadian* (layar yang dibuka — kasar sengaja, bukan apa yang diketik) dan *rekap harian* per orang (jumlah kejadian, layar teratas, `changes`, `refusals`, `reveals`).
3. Hanya pemegang `it.update`: tombol **Rekap kemarin** (menulis rekap satu hari: kemarin, bukan hari ini). Hanya pemegang `it.purge_activity`: **Jalankan retensi** (konfirmasi *Hapus … Ini penghapusan, bukan koreksi — dan tidak bisa dibatalkan*). Yang lain melihat *Baca saja — retensi dijalankan IT*.

**C. Cara menelusuri satu dokumen dari awal sampai akhir**
1. Ambil nomor dokumen (lihat penomoran) → `/it/audit` filter *Nomor dokumen* → baca urutan tindakan.
2. Untuk rantai pembelian-produksi: **Job trail** `/produksi/jejak` (PR → PO → penerimaan → stok masuk → bahan keluar ke JO → progres → barang jadi → surat jalan → BAST).
3. Untuk bukti: drawer baris/dokumen menampilkan *EvidenceStrip* (berkas dan tautan beserta siapa yang menautkan dan kapan).

#### Aturan & kontrol
- Setiap seam menulis jejaknya **lewat satu fungsi** (`ops_core.write_audit` via `ok/refused/invalid/conflict/not_found/noop`) di transaksi yang sama dengan baris bisnis; bungkus-bungkus itu tidak diberikan ke `authenticated` sehingga klien tidak bisa memalsukan jejak.
- **Penolakan direkam** (`refused`, `duplicate`) — sebab seam menolak dengan *nilai*, bukan `raise exception` (exception membatalkan baris audit-nya sendiri).
- Audit **tidak pernah dihapus** dan tidak ada kebijakan insert/update/delete bagi pengguna (hanya `select` untuk `it.read`). Pembatasan ini ditegakkan oleh tidak adanya policy/grant; **tidak ada trigger yang melarang** `update`/`delete` oleh pemilik tabel atau service role (lihat Kesenjangan).
- Aktivitas: detail **120 hari** (`activity_log.detail_days`), rekap harian **120 baris per orang** (`activity_log.recap_rows`; dihitung per orang, bukan per tanggal) — D283 menggantikan 30 hari pada D188. Penghapusan melewati hari yang detailnya sudah lewat batas tetapi belum direkap (`blocked_days` dilaporkan, tidak dihapus diam-diam).
- Menanyakan folder tujuan berkas bukan peristiwa (`drive_folder_for` tidak menulis audit); penolakannya tetap tercatat.
- `view` tidak merekam `reveal`: pembukaan nomor identitas hanya di audit (agar tidak terhitung ganda).

#### Jejak data — daftar semua tempat sistem merekam siapa melakukan apa kapan

**1. Tiga rekaman platform**
| Rekaman | Tabel / layar | Isi | Retensi |
|---|---|---|---|
| Audit | `ops_core.audit_log` → `/it/audit` | `at`, `actor_id`, `service`, `entity`, `entity_no`, `action`, `outcome` (`ok`/`refused`/`duplicate`/`noop`), `reason`, `before`, `after`, `detail` | tidak dihapus |
| Aktivitas aplikasi | `ops_core.activity_events` (+ `activity_recap`) → `/it/aktivitas` | `view` tiap layar; `update` (ganti kata sandi); `attendance_tap`; `leave_requested`; `overtime_requested` | 120 hari detail; 120 baris rekap/orang |
| Outbox | `ops_core.outbox` | peristiwa keluar (`service`, `event_type`, `entity_no`, `payload`, `delivered_at`, `attempts`, `last_error`) | tidak ada pembersihan tercatat |

**2. Rekaman "siapa" yang melekat pada baris bisnis** (kolom `*_by` + waktu; dari migrasi)
- **Identitas/hak**: `user_modules` & `user_authorities` (`granted_by`/`granted_at`), `users` (`left_on`), `drive_folders.updated_by`, `settings.updated_by`.
- **Pengadaan**: `pr_approvals` (`recorded_by`; setiap centang persetujuan adalah baris append-only berisi waktu, nama, email, `channel` = `web`/`chat`/`sheet`/`script`/`api`), `approval_batches`/`approval_requests` (`sent_by`), `pr_lines.removed_by`, `line_notes`, `line_variances`, `line_settlements`, `line_closures` (`decided_by`), `payment_rounds` (`opened_by`/`approved_by`/`closed_by`), `round_transfers`, `purchase_orders` (`created_by`/`approval_asked_by`/`approved_by`/`issued_by`), `po_lines.superseded_by`, `receipts` (`received_by`/`qc_by`/`confirmed_by`), `receiving_inbox` (`reported_by`/`resolved_by`), `quotations`, `projects`/`project_status_log` (`changed_by`), `clients`/`client_activities`, `vendors`, `items` (`created_by`).
- **Akuntansi**: `transactions` (`posted_by`, `void_by`), `payment_allocations` (`allocated_by`, `superseded_by`), `evidence_inbox` (`reported_by`/`resolved_by`), `statement_lines` (`decided_by`), `bank_statements` (`uploaded_by`), `cash_components`/`cash_overrides`/`cash_settlements`.
- **HRD**: `attendance_scans` (`recorded_by`), `attendance_imports` (`imported_by`), `day_marks` (`marked_by`), `allowance_withholdings` (`restored_by`), `overtime_sheets` (`created_by`/`hrd_checked_by`/`leader_approved_by`/`declined_by`), `leave_requests` (`requested_by`/`decided_by`), `payroll_runs` (`created_by`/`approved_by`), `payroll_adjustments`, `pay_rule_sets`, `employment_contracts` (`created_by`/`activated_by`/`superseded_by`), `contract_clauses`, `employee_documents`, `employee_identity` (`updated_by`), `shift_picks`, `tasks` (`assigned_by`/`done_by`), `task_routines`, `work_sites`.
- **Persediaan**: `stock_moves` (`moved_by`/`edited_by`), `board_moves`, `product_moves`, `log_purchases`, `log_costs`, `assets`/`asset_services`.
- **Produksi**: `work_orders` (`created_by`), `progress_entries` (`recorded_by`, `worked_by` dipertahankan apa adanya), `work_slots` (`recorded_by`/`voided_by`), `daily_targets` (`set_by`; setiap perubahan disimpan dengan alasan), `bom_revisions` (`created_by`/`released_by`), `bom_rates`, `vendor_legs`, `products`.
- **Pengiriman**: `deliveries`, `packing_boxes` (`packed_by`/`scanned_by`), `installations`, `snags` (`raised_by`/`fixed_by`), `handovers`.
- **Pemasaran**: `properties.validated_by`, `referrals`, `sales_reps`.
- **Asisten**: `ops_asst.turns` (`actor_id`, prompt verbatim), `ops_asst.drafts` (apa yang dikonfirmasi, kata demi kata).

**3. Status dan pola append-only** — status adalah **turunan (view)**, tidak disimpan (A3); pergerakan uang, stok, persetujuan dan penerimaan adalah baris baru, tidak pernah ditimpa (A2); koreksi = VOID + alasan atau `superseded_by` (A5); `attachment_links.unlinked_*` (melepas bukti = penanda, bukan hapus).

**4. Berkas bukti**
- `ops_core.attachments` (`filename`, `sha256`, `mime`, `bytes`, `source` = `web`/`chat`/`api`/`import`, `uploaded_by`, `uploaded_at`; berkas **atau** tautan) dan `attachment_links` (`entity`, `entity_no`, `kind`, `note`, `linked_by`, `linked_at`, `unlinked_by`, `unlinked_at`). Berkas fisik di Google Drive (`ops-talaliving` di shared drive modul, satu folder per tugas — `ops_core.drive_paths`; drive dipilih database dari jenis dokumen sehingga KTP tidak pernah ke drive selain HRD). Duplikat byte yang sama hanya **memperingatkan** (A6).
- Jejak upload: `attach_file` menulis nama berkas dan `kursi.jpg → PROCUREMENT / ops-talaliving / INVENTORY/ITEMS`; kegagalan Google dicatat `upload · refused` (`record_upload_failure`) beserta jawaban Google di `detail`.

**5. Rekaman sisi asisten** — `ops_asst.may_run` menulis satu baris audit **untuk setiap pemanggilan alat** (ya/tidak/ditutup); `record_turn`, `open_draft`, `settle_draft` juga menulis audit. IT dapat melihat *kalimat yang tidak dimengerti* tetapi **tanpa nama penanya** (grup dan `actor_id` tidak dikembalikan).

**6. Identitas (GoTrue)**: `created_at`, `invited_at`, `last_sign_in_at`, `banned_until` (dibaca ke direktori `/it/pengguna`).

#### Tindakan yang TIDAK tercatat (dikonfirmasi dari kode)
- **Pembacaan data bisnis** (membuka slip gaji, buku besar, daftar karyawan) — hanya `view` kasar di log aktivitas (120 hari), bukan baris audit. Satu-satunya pembacaan yang masuk audit: pembukaan nomor identitas (`reveal`).
- `print` dan `export` (didokumentasikan sebagai jenis `activity_events`) — **tidak ada pemanggilnya** di aplikasi; hanya data demo yang memuatnya.
- `sign_out`, kata sandi salah, dan masuk lewat tautan undangan/pemulihan (lihat bagian Masuk).
- Pengiriman peristiwa outbox ke luar (belum ada pekerja; lihat bagian Idempotensi & outbox).
- Pengulangan yang dijawab ulang dari kunci idempotensi (klik ganda): tidak menulis baris audit baru.
- Pemeriksaan folder Drive yang berhasil (`drive_folder_for ok`).
- Jalur yang menolak dengan `raise exception` (mis. pelanggaran indeks unik) — baris audit ikut dibatalkan.
- Tulisan langsung ke tabel yang diizinkan policy RLS tanpa seam (mis. `ops_core.settings` `update` oleh pemegang `settings.update`) — **tidak ada trigger audit** yang terlihat; layar Pengaturan tidak terhubung ke jalur ini di mode live, tetapi policy-nya ada.
- Jalur `service_role` / SQL editor (mis. `bootstrap_admin` menulis audit; `update auth.users` untuk kata sandi pertama **tidak**).
- Rekaman mesin PC (`activity_intervals`, `activity_daily` di `0026`): tabel, kebijakan RLS, fungsi `record_activity`/`roll_up_activity`/`purge_activity` ada, tetapi **tidak ada agen maupun layar** di repo yang menulis/membacanya (tidak terkonfirmasi apakah agen berjalan).

#### Serah-terima ke tim lain
- Tim mana pun yang butuh bukti "siapa yang melakukan" → minta IT/pimpinan membaca `/it/audit` dengan nomor dokumen.
- HRD: pertanyaan "siapa yang melihat KTP saya" dijawab dari baris `reveal`.

#### Koreksi & pengecualian
- Baris audit **tidak dikoreksi**; koreksi atas peristiwa dibuat sebagai peristiwa baru.
- Satu-satunya penghapusan yang disengaja: retensi log aktivitas, oleh IT (admin), terkonfirmasi di layar dan **dicatat di audit** (`identity · activity · purge`).
- Hari yang detailnya sudah di ambang kedaluwarsa tetapi belum direkap: jalankan **Rekap** untuk hari itu (default tombol hanya "kemarin"; menyebut hari lain butuh pemanggilan dengan rentang — tidak ada layar untuk itu) sebelum **Jalankan retensi**.

#### Checklist rutin
- [ ] Harian: **Rekap kemarin** di `/it/aktivitas` (tidak otomatis — tidak ditemukan penjadwal untuk ini).
- [ ] Bulanan: **Jalankan retensi** setelah semua hari terekap (`days_unrolled` = 0).
- [ ] Mingguan: baca spanduk *tindakan ditolak* dan *nomor identitas dibuka* di `/it/audit`.
- [ ] Triwulanan: sampel acak 5 dokumen dan telusuri dari nomor ke bukti.

#### Sumber
`supabase/migrations/0003_core_audit.sql`, `0005_core_files.sql`, `0023_core_audit_view.sql`, `0086_acct_procure_parity_fixes.sql`, `0026_core_activity.sql`, `0027_core_activity_log.sql`, `0163_core_self_activity.sql`, `0177_core_upload_audit.sql`, `0038_asst_catalogue.sql`, `0039`, `0040`, `src/app/(app)/it/audit/page.tsx`, `src/app/(app)/it/aktivitas/page.tsx`, `src/components/activity-recorder.tsx`, `src/lib/activity-label.ts`, `src/lib/api/identity.ts`, D84, D188, D190, D196–D197, D283, D306.

---

### Idempotensi, outbox, dan notifikasi

#### Tujuan
Klik ganda, kirim ulang, atau gangguan jaringan tidak boleh menjadi dua persetujuan atau dua pembayaran; dan peristiwa penting harus dapat dibawa keluar (Google Chat) tanpa pernah memanggil layanan luar di dalam transaksi bisnis.

#### Pemilik / peran & kewenangan
Mekanisme otomatis (tidak ada pemilik operasional per transaksi). Aturan pengiriman notifikasi = katalog `ops_core.delivery_rules`, diubah hanya lewat migrasi (keputusan pemilik). Membaca outbox: `it.read`.

#### Prasyarat
Seam yang menerima `p_key` / klien yang membuat kunci saat formulir dibuka. Untuk notifikasi: pekerja pengirim (belum ada — lihat Kesenjangan).

#### Langkah-langkah
**Idempotensi**
1. Saat formulir dibuka klien membuat satu kunci; tombol dua kali menekan kunci yang sama.
2. Seam memanggil `ops_core.idem_replay(service, endpoint, key)` lebih dulu; bila kunci sudah ada, jawaban pertama dikembalikan (ditandai `duplicate`, status 200) dan **tidak ada yang berubah**.
3. Setelah sukses, `idem_remember` menyimpan jawaban lengkap. **Yang disimpan**: `ok`, `noop`, `duplicate`/409. **Yang tidak disimpan** (klaim dilepas, bisa dicoba lagi dengan kunci yang sama): 403, 422, 5xx.

**Outbox**
1. Setiap seam yang mengubah sesuatu memanggil `ops_core.emit(service, event_type, entity_no, payload)` di transaksi yang sama.
2. Pengirim (yang dirancang) mengambil baris lewat `ops_core.outbox_due` — hanya peristiwa yang aturannya `is_live`, belum lewat `max_age`, kurang dari 5 percobaan, dengan `skip locked`; lalu `outbox_delivered`/kegagalan mencatat hasil.
3. Hanya satu aturan hidup: `procurement.approval.requested` → `chat` (maks. usia 2 hari). Kandidat tetapi **off**: `accounting.inbox.resolved`, `accounting.transaction.voided`, `procurement.po.amended` (belum bisa dibangun: payload tidak membawa status issued), `procurement.po.issued`, `payroll.approved`, `access.changed` (sengaja off — catatan keamanan).

#### Aturan & kontrol
- Tidak ada panggilan jaringan di dalam transaksi bisnis (ADR-008).
- Peristiwa yang tidak punya baris di `delivery_rules` tidak pernah dikirim; menyalakan satu = migrasi satu baris (sengaja bukan tombol — kanal yang sering dibisukan lebih buruk daripada yang sepi).
- Notifikasi ke Chat hanya notifikasi: **persetujuan, penolakan, konfirmasi penerimaan tidak dilakukan di Chat** (D291 tentang Chat); Chat hanya membawa masuk pesan/berkas (ke inbox akuntansi/penerimaan) dan membawa keluar notifikasi.
- Kartu persetujuan PO untuk pimpinan dijawab hanya oleh penerimanya sendiri (token acak; fungsi `answer_po_approval` hanya dapat dipanggil `service_role` pekerja Chat — D69, D299).
- Kunci tabel `idempotency_keys` tidak punya kebijakan RLS: hanya seam yang dapat membaca/menulisnya.

#### Jejak data (apa yang terekam)
`ops_core.idempotency_keys` (jawaban + `actor_id` + `created_at`), `ops_core.outbox` (`delivered_at`, `attempts`, `last_error`), `ops_core.delivery_rules`.

#### Serah-terima ke tim lain
Pimpinan menerima kartu persetujuan PO/PR dari Google Chat (bila pekerja sudah terpasang); jawaban sah hanya dari akun pimpinan sendiri. Pesan Chat yang masuk jatuh ke inbox akuntansi/penerimaan (bab Akuntansi/Pengadaan).

#### Koreksi & pengecualian
- Percobaan ke-6 tidak lagi ditawarkan; baris tetap di outbox dengan `last_error` untuk dibaca IT.
- Peristiwa lebih tua dari `max_age` sengaja tidak dikirim (tidak mengirim alarm hari Selasa pada hari Jumat); catatannya tetap lengkap.

#### Checklist rutin
- [ ] IT meninjau baris outbox dengan `attempts >= 5` atau `last_error` terisi (tidak ada layar khusus: lewat SQL/`it.read`).
- [ ] Sebelum menyalakan aturan baru: cek payload peristiwanya cukup (lihat catatan `po.amended`).

#### Sumber
`supabase/migrations/0003_core_audit.sql`, `0015_core_idempotency.sql`, `0155_core_outbox_delivery.sql`, `0159`, `0203` (jembatan Chat via `pg_cron`), `docs/plan/00-context.md` §E, `docs/plan/backlog.md` B10, D69, D291, D299.

---

### Asisten John Lau (`/john-lau`, `/it/john-lau`, dock di shell)

#### Tujuan
Mengubah kalimat menjadi **tindakan bernama terhadap API yang sama dengan yang dipakai layar**: membaca sesuatu, menghitung sesuatu, menunjukkan langkah mengerjakannya, atau **menyiapkan draft tulisan untuk dikonfirmasi orang**. John Lau bukan narator dan bukan modul yang dapat diberi hak.

#### Pemilik / peran & kewenangan
- Pemakai: siapa pun yang masuk (dock tersedia di shell staf). Hak yang dipakai = **hak orang yang mengetik** (D219) — tidak lebih.
- Pemilik katalog (`ops_asst.tools`): hanya migrasi (tidak ada kebijakan tulis untuk siapa pun, termasuk IT dan pemilik).
- Menyetel pemahaman: IT/pimpinan (`it.read`) membaca `/it/john-lau`; menambah aturan/alat = migrasi.

#### Prasyarat
- Layar `/john-lau` ada di daftar rute live. Untuk pertanyaan *cara pakai* dengan model bahasa: Secret Worker `ASSISTANT_LLM_PROVIDER` (produksi: `anthropic`, D336 — nilai harus persis `anthropic`), `ASSISTANT_LLM_API_KEY`, opsional `ASSISTANT_LLM_MODEL` / `ASSISTANT_LLM_BASE_URL`. Tanpa kunci, John Lau hanya memakai kata kunci dan rute `/api/assistant/explain` menjawab 501.

#### Langkah-langkah
1. Pengguna membuka dock John Lau (ikon mengambang) atau halaman `/john-lau` (daftar yang boleh ditanyakan) → mengetik kalimat.
2. **Router kata kunci** (`ops_asst.route`, aturan di `ops_asst.rules`) mencocokkan kalimat ke satu alat. Kalimat yang dikenal dijawab persis seperti biasa, dengan panggilan yang sama dengan layar.
3. Bila tidak dikenal, model bahasa (server `/api/assistant/explain`) **hanya** boleh (a) menjawab *cara pakai* dari pengetahuan proses (`ops_asst.processes`, `process_steps`, `process_faq`) + percakapan orang itu + layar yang sedang dibuka, atau (b) **memilih satu nama alat** dari katalog yang dilihat orang itu, dengan argumen yang dibaca dari kalimat. Pilihan itu **dikembalikan, tidak dijalankan**; nama harus ada di katalog dan argumen harus kunci milik alat itu, jika tidak dibuang.
4. Setiap pemanggilan alat melewati gerbang `ops_asst.may_run` dengan urutan: alat ada? → `reach` (blocked)? → orang punya grant modul/level? Hasil: `blocked` (*closed*), `no_grant` (*permission*), `yes`. Gerbang menulis baris audit untuk **setiap** jawaban.
5. Alat **baca** (`effect=read`) menjalankan panggilan layar sebagai orang itu dan menampilkan fakta `AnswerFact` (label, nilai/jumlah, **nama alat sumber**, tautan ke layar yang menampilkan angka yang sama). Alat **panduan** (`guide`) menampilkan langkah (+ aturan di balik langkah) tanpa menyentuh data. Alat **tulis** (`write`) menghasilkan **draft**.
6. Draft: kartu menampilkan **semua field** yang akan ditulis (bukan ringkasan), dapat diedit, dengan peringatan (tidak memblokir). Tombol **Ya, tulis** → gerbang `may_run` diperiksa **lagi** (izin bisa berubah antara draft dan "ya") → seam dipanggil **sebagai orang itu** melalui PostgREST/API yang sama dengan layar → jawaban seam (`refused`/`invalid`/`conflict`) dibacakan di kartu apa adanya (*Ditolak — tidak ada yang ditulis* dst). Tombol batal → *Dibatalkan. Tidak ada yang ditulis.*
7. Percakapan tersimpan: `ops_asst.turns` (prompt verbatim, jawaban, alat yang dijalankan, aturan yang cocok) sehingga riwayat bertahan antar reload dan tab.

#### Aturan pakai John Lau (ringkas, bagi semua tim)
**Boleh ditanyakan (alat terbuka)**
| Alat | Jenis | Modul & level yang dibutuhkan | Fungsi |
|---|---|---|---|
| `procurement.pending_approvals` | baca | `procurement` read | Baris permintaan yang menunggu persetujuan |
| `procurement.vendor_debt` | baca | `procurement` read | Berapa yang masih kita hutang ke sebuah vendor |
| `accounting.balances` | baca | `accounting` read | Saldo tiap rekening |
| `inventory.low_stock` | baca | `inventory` read | Barang di bawah stok minimum |
| `production.late_orders` | baca | `production` read | Job Order/SPK lewat tanggal janji |
| `delivery.fulfilment` | baca | `project` read | Berapa pesanan klien sudah sampai dan terpasang |
| `guide.create_po`, `guide.receive_goods`, `guide.pay_line` | panduan | tanpa grant | Cara membuat PO / mencatat barang datang / membayar baris permintaan |
| `procurement.draft_pr_line` | tulis (draft) | `procurement` write | Menyiapkan baris permintaan pembelian (seam `quickAddLine`; field Barang, Jumlah, Satuan, Keperluan) |
| `procurement.draft_po` | tulis (draft) | `procurement` write | Menyiapkan PO dari baris PR yang **disetujui** dan cocok; harga/vendor adalah yang disetujui. Sesudah "Ya, tulis": penulis pemegang `approve_goods` → terkonfirmasi saat dibuat; selain itu langsung `request_po_approval` ke pimpinan. **Meng-issue ke vendor tetap di layar PO** |
| `hr.draft_leave` | tulis (draft) | `hrd` write | Menyiapkan pengajuan cuti/izin/sakit (`ops_hr.request_leave`); status PENDING; memutuskan tetap di layar |
| `marketing.draft_market` | tulis (draft) | `marketing` write | Menyiapkan pasar baru (`ops_mkt.create_market`) |
| Pengetahuan proses (model bahasa) | panduan | — | `procure.*`, `acct.*`, `hr.*`, `inv.*` (mis. `acct.pay_po`, `hr.pay_rules`, `inv.stock_input`) |

**Tidak pernah lewat prompt (ditutup di setiap level — `reach = blocked`, bukan level yang bisa diberikan)**
| Alat | Alasan (ringkas) | Dikerjakan di |
|---|---|---|
| `hr.employee_files` | Berkas 201 dibuka satu per satu oleh orang lewat tombol mata dan dicatat atas nama orang itu | `/hrd/berkas-201` |
| `hr.payroll` | Gaji per orang sama sensitifnya dengan nomor KTP (dikonfirmasi pemilik) | `/hrd/payroll` |
| `hr.attendance` | Presensi per orang = catatan tentang orang, bukan tentang perusahaan (dikonfirmasi pemilik) | `/hrd/absensi` |
| `it.audit` | Modul IT tidak dapat dibaca lewat prompt sama sekali (audit/log aktivitas/pengguna/peran) | `/it/audit` |
| `it.settings_write` | Lima dari dua belas pengaturan mengubah angka lama; tidak diubah lewat kalimat | `/pengaturan` |

**Aturan pasti**
1. **Tidak mengarang angka.** Angka hanya berasal dari alat bernama dan ditampilkan bersama nama alat dan tautan layar. Bila tak ada alat yang menjawab: *saya tidak tahu*.
2. **Hak sama dengan pengguna** — "saya bekerja dengan hak Anda, bukan hak saya sendiri". Penolakan dibedakan: *Tertutup lewat prompt — tidak ada izin yang membukanya* (tidak bisa diperbaiki IT) vs *Akses Anda belum cukup* (perbaikannya: minta grant ke IT).
3. **Tidak menulis tanpa "ya" kedua** atas payload persis; field editable; izin dicek ulang saat konfirmasi; kunci idempotensi per draft (klik ganda = satu dokumen).
4. **PO tidak pernah di-issue lewat prompt**; hanya draft dari baris yang disetujui.
5. **Model bahasa tidak pernah melihat data bisnis** (saldo, vendor, baris) — hanya pengetahuan proses, riwayat percakapan orang itu sendiri, dan path layar. Tautan yang dikembalikan model harus rute yang disebut pengetahuan itu, jika tidak dibuang. **Teks yang diketik pengguna dikirim ke penyedia model (Anthropic di produksi)** — jangan menaruh data pribadi/rahasia di prompt.
6. **Privasi percakapan**: `turns` dan `drafts` hanya terbaca oleh orang yang bersangkutan (bukan IT, bukan pimpinan). Akuntabilitas tetap ada di audit: setiap panggilan alat (`may_run`) dan setiap seam tulis menulis baris audit atas nama orang itu.
7. IT hanya melihat kalimat **yang tidak dimengerti**, dikelompokkan (`normalise()`), tanpa nama penanya, dengan indikator kesehatan router (diterima / terjawab / dipandu / draft / tidak dimengerti / ditolak-tertutup / ditolak-izin).
8. **Menambah kemampuan = migrasi** yang ditinjau (alat, aturan, seam, field kartu); seam `rpc` tidak boleh berada di `ops_core` atau `ops_asst` (asisten tidak boleh meraih fungsi yang memberi hak). John Lau tidak menulis skema.
9. Fitur AI lain memakai penyedia dan Secret yang sama (usulan BOM di `/api/production/bom`, pembacaan foto nota kayu di `/api/inventory/nota`): keluarannya **usulan**; manusia yang menyetujui (lihat bab Produksi/Persediaan).

#### Aturan & kontrol
- Gerbang tiga lapis: (1) alat dapat dijangkau dari prompt; (2) hak orang itu; (3) tidak ada tulisan tanpa konfirmasi kedua. Urutan `blocked` sebelum grant disengaja.
- `ops_asst.holds_grant` membandingkan level berurutan: `admin` memenuhi alat yang meminta `write`.
- CI (`scripts/check-john-lau.mjs`) memastikan saran yang ditawarkan dock memang dikenali router dan tidak mengarah ke modul tanpa data.
- Pengetahuan proses (`ops_asst.processes`) juga menjadi sumber SOP cetak per modul (`scripts/sop/build-sop.mjs` → `docs/sop/<modul>/`, saat ini procurement, hr, inventory).

#### Jejak data (apa yang terekam)
- `audit_log`: `assistant · tool · run` (setiap `may_run`: ya/ditolak/tidak dikenal), `assistant · turn · record`, `assistant · draft · open` / `settle`, ditambah baris audit seam tulis yang dipanggil (mis. `procurement · pr_line · quick_add`) atas nama orang itu.
- `ops_asst.turns` (prompt, `kind` = `answer`/`guide`/`draft`/`refused`/`unknown`, jawaban, fakta, langkah, `tools_used`, `refused_because`, `matched_rule`, bahasa).
- `ops_asst.drafts` (alat, args, `confirmed_payload` kata demi kata, `outcome` = `confirmed`/`abandoned`, `produced_ref`, kunci idempotensi).
- Dokumen yang dihasilkan membawa nomor dan jejak normalnya (mis. Keperluan *Diminta lewat John Lau* terlihat di baris).

#### Serah-terima ke tim lain
Draft PR → alur persetujuan Pengadaan; draft PO → konfirmasi pimpinan (`approve_goods`) lalu issue di `/procurement/po`; draft cuti → antrean HRD di `/hrd/cuti` (status PENDING); draft pasar → Pemasaran.

#### Koreksi & pengecualian
- Draft yang salah: ubah field sebelum "Ya, tulis" atau batalkan; yang sudah tertulis dikoreksi lewat layar modul (VOID/supersession), bukan lewat John Lau.
- Pertanyaan tidak dimengerti berulang → IT menambah aturan lewat migrasi (bukan lewat layar).
- Pertanyaan yang ditutup: arahkan ke layar yang disebut (`instead_at`).

#### Checklist rutin
- [ ] IT mingguan: baca `/it/john-lau` — kalimat yang berulang tidak dimengerti ≥ 3 kali layak jadi aturan.
- [ ] Setelah mengubah grant: ingat bahwa dock mengikuti hak baru seketika.
- [ ] Tidak ada alat `blocked` yang dibuka (mengubah D218 butuh keputusan pemilik).

#### Sumber
`src/services/assistant/contracts.ts`, `src/lib/john-lau.ts`, `src/lib/john-lau-seams.ts`, `src/lib/llm.ts`, `src/app/api/assistant/explain/route.ts`, `src/components/john-lau/dock.tsx`, `src/app/(app)/john-lau/page.tsx`, `src/app/(app)/it/john-lau/page.tsx`, `supabase/migrations/0038`–`0041`, `0136`, `0137`, `0150`, `0151`, `0176`, `0181`, `0197`, `0198` (asst), `scripts/check-john-lau.mjs`, D217–D221, D296, D300, D301, D317, D336.

---

### Mode demo/sandbox, PWA, dan bahasa

#### Tujuan
Menyediakan tiga hal yang membuat sistem bisa dipakai tanpa risiko dan dari ponsel: sandbox demo yang tidak menyentuh data nyata; aplikasi yang dapat dipasang di layar utama; dan tampilan dua bahasa dengan batas yang jujur.

#### Pemilik / peran & kewenangan
IT (konfigurasi deployment), pemilik (keputusan bahasa dan siapa yang memakai). Pemakai: semua.

#### Prasyarat
- **Mode ditentukan deployment**, bukan pengguna: live bila tiga variabel build (`NEXT_PUBLIC_USE_SUPABASE`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`) terisi; selain itu demo. Variabel `NEXT_PUBLIC_*` harus di **Build variables** (di-inline saat build), bukan di Variables and Secrets.

#### Langkah-langkah
**Demo / sandbox**
1. Pengguna membuka deployment demo → `/signin` menampilkan badge **Demo** dan daftar persona (memilih persona = masuk; tidak ada kata sandi); data berada di browser (`src/demo/store.ts`), per pengunjung.
2. Tombol **Reset** di topbar mengembalikan sandbox ke data awal (*Data demo direset*). Menu **Demo** (`Diagnostics`, `Google Chat (simulated)`) hanya untuk uji alur.
3. `?tour=flow-b` memandu alur pembelian (TourBar).

**PWA**
1. Chrome/Android: tombol pasang dari browser (`beforeinstallprompt` ditangkap `ServiceWorker` di root layout); iOS Safari: penjelasan *Share → Add to Home Screen*.
2. Service worker (`public/sw.js`) hanya untuk dua hal: aplikasi terpasang dapat dibuka dan halaman `/offline` yang jujur saat tak ada jaringan. **Bukan mode offline**: tidak ada data bisnis yang di-cache; navigasi network-first; hanya `/_next/static/*` dan `/icons/*` cache-first. Versi baru menunggu sampai orang memuat ulang (muncul pemberitahuan "versi baru tersedia").
3. `manifest.ts`: nama *Talaliving*, `display: standalone`, `start_url: /`, ikon 192/512/maskable.

**Bahasa**
1. Toggle di topbar (English / Bahasa Indonesia) — pilihan **per peramban** (`localStorage` `ops.lang`), bukan pengaturan perusahaan. Bawaan **English**; akun karyawan-saja bawaan **Indonesia** (D331).
2. Tiap teks layar memakai `useTr(en, id)`; **isi dari database ditampilkan apa adanya** (nama, catatan, label pengaturan).

#### Aturan & kontrol
- **Demo adalah mode, bukan cadangan**: konfigurasi yang hilang tidak boleh diam-diam menjadi demo; badge Live/Demo harus benar. Fungsi yang belum diimplementasi klien live mengembalikan **501** yang menyebut fungsinya, tidak jatuh ke demo.
- Dua lapis API harus selaras: `src/lib/api/*` (nyata, Supabase) dan `src/demo/api/*` (sandbox) dengan tanda tangan yang sama; CI memeriksa paritas (`scripts/check-api-parity.mjs`, `check-api-schemas.mjs`).
- Kosakata bisnis tidak diterjemahkan (`MSG SENT`, `SP NORTH`, `PKWT`, kode rekening, string status).
- Rute dinyatakan live hanya bila seluruh layanan yang dipanggilnya ada (`LIVE_ROUTES` dibangkitkan; CI gagal bila berbeda).
- Pengaturan bahasa/format perusahaan hanya default untuk peramban yang belum memilih.

#### Jejak data (apa yang terekam)
- Demo: **tidak ada rekaman nyata**; audit/aktivitas demo hidup di memori peramban dan hilang saat reset.
- PWA/bahasa: tidak direkam di server (bahasa di `localStorage`, bagian "browser storage" hanya kenyamanan per pengguna).
- Tampilan layar tetap tercatat sebagai `view` (label bahasa Inggris dari `nav.ts`, agar rekap satu layar tidak terpecah dua bahasa).

#### Serah-terima ke tim lain
Tidak ada. Tim memakai modulnya masing-masing; demo dipakai untuk pelatihan dan peninjauan layar.

#### Koreksi & pengecualian
- Produksi tampil Demo: periksa tiga variabel **Build variables** lalu *Retry deployment*/push ke `main` (menyetel variabel build tidak membangun ulang).
- Layar menampilkan "belum live": layanan backend untuk rute itu belum ada; pakai rute yang live atau tunggu.
- Versi lama tertahan di ponsel: muat ulang saat pemberitahuan versi baru muncul.

#### Checklist rutin
- [ ] Setelah setiap deploy produksi: buka `/signin` → badge **Live**.
- [ ] Setelah mengubah `wrangler.jsonc`/variabel build: uji pasang PWA di satu ponsel Android dan satu iPhone.
- [ ] Pelatihan karyawan baru dilakukan di deployment demo, bukan produksi.

#### Sumber
`src/lib/live.ts`, `src/lib/supabase/env.ts`, `src/demo/api/_swap.ts`, `src/demo/store.ts`, `src/demo/provider.tsx`, `src/lib/i18n.ts`, `src/lib/pwa.ts`, `public/sw.js`, `src/app/manifest.ts`, `.env.example`, D224, D318, D328, D331.

---

### Lingkungan, rilis ke produksi, pelaporan masalah, dan pencadangan

#### Tujuan
Memastikan perubahan sampai ke produksi dengan cara yang dapat dilacak dan dapat dibatalkan, dan bahwa masalah dilaporkan menjadi catatan yang tidak hilang. Produksi menyimpan uang dan catatan bisnis nyata.

#### Pemilik / peran & kewenangan
- **Pemilik produk**: menyatakan "merge" (keputusan), menjawab pertanyaan terbuka.
- **IT / sesi Claude**: membangun, memverifikasi, membuka PR, menerapkan migrasi ke produksi.
- **Ketentuan dari pemilik**: perubahan DDL yang destruktif **minta izin pemilik dulu** — tidak ada wipe atau hapus massal; koreksi di produksi adalah VOID dengan alasan.

#### Prasyarat
Akses repositori GitHub, proyek Cloudflare Workers `ops-talaliving` (Workers Builds terhubung ke repo), proyek Supabase produksi (database yang sama menampung sistem lama `john-lau-v01` pada skema berbeda; skema sistem ini berawalan `ops_*` dan `check_schema_isolation.sh` menjaga migrasi tidak menyentuh skema lama).

#### Langkah-langkah
1. **Mulai pekerjaan** — sesi membaca `docs/plan/README.md` (papan) dan `docs/plan/07-ways-of-working.md` (siklus); keputusan di `06-decisions.md`, pelajaran di `findings.md`, endpoint di `03-api.md`. **Satu sesi, satu fitur, satu branch**; permintaan lain yang tidak berkaitan = branch dan sesi baru.
2. **Bangun** — dua lapis API harus sama (`src/lib/api/*` dan `src/demo/api/*`; kontrak di `src/services/*/contracts.ts`). Migrasi di `supabase/migrations/` adalah skema (*maju saja*): setiap tabel baru berakhir dengan `analyze`, setiap fungsi `security definer` diberi `grant` ke `authenticated` dan memutuskan di dalamnya, nilai enum baru tidak boleh dipakai di migrasi yang menambahkannya (F161), setiap seam mengembalikan envelope `ok/refused/invalid/conflict/not_found`.
3. **Verifikasi sebelum push** — `npm run verify` (tsc, lint, `check-live-routes`, `check-permissions`, `check-api-parity`, `check-api-schemas`, `check-bom-norms`, `cf:build`) dan, untuk database, `npm run verify:db` (`supabase/local/rebuild.sh` membangun ulang dari nol → `smoke.sh` → `check-view-contracts` → `check-schedule-rules` → `check-john-lau` → `check-knowledge` → `supabase/import/test.sh`). `rebuild.sh` menolak `PGHOST` non-lokal, menolak menghapus database yang berisi akun, dan tidak menyentuh skema `auth` milik Supabase. Layar yang berubah **dijalan­kan di peramban**, bukan hanya `tsc` (F164).
4. **Dokumentasi tail** — catat keputusan pemilik sebagai `D…`, pelajaran sebagai `F…`, dan perbarui papan di commit yang sama.
5. **PR ke `main`** — CI (`.github/workflows/ci.yml`) berjalan pada `push` ke `main` dan `claude/**`: job **app** (types, lint, build, paritas, `opennextjs-cloudflare build`) dan job **database** (Postgres 16: ladder dari nol, smoke, view contracts, schedule rules, task periods, john lau). Branch protection meminta CI hijau sebelum merge (dinyatakan di komentar CI; pengaturannya ada di GitHub, **tidak terkonfirmasi dari repo**).
6. **Deploy aplikasi** — push ke `main` → Workers Builds menjalankan `npx wrangler deploy` (produksi); push ke branch lain → `npx wrangler versions upload` (versi pratinjau di `*.workers.dev`). Variabel `NEXT_PUBLIC_*` di Build variables; Secret (`SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_PRIVATE_KEY`, `ASSISTANT_LLM_API_KEY`) di Variables and Secrets; hanya `GOOGLE_SERVICE_ACCOUNT_EMAIL` (bukan rahasia) di `wrangler.jsonc`.
7. **Terapkan migrasi ke produksi** — dilakukan terpisah dari deploy aplikasi, lewat Supabase `apply_migration` setelah *dry run* (di dalam blok `do` yang sengaja `raise` di akhir bila perlu), dan **sebelum** deploy bila kode baru memanggil fungsi baru (mis. `0189` diterapkan sebelum deploy). Verifikasi: bandingkan `md5` teks yang tersimpan di `supabase_migrations.schema_migrations.statements[1]` dengan berkas (hitung karakter, bukan byte) dan sidik jari fungsi/view dengan ladder lokal (F159, F167). Papan menulis *"`020x` applied to production … as `<versi>`"*.
8. **Tutup** — setelah PR **di-merge** (dan hanya setelah itu), hapus branch: `git push origin --delete <nama-branch>`; PR yang ditutup tanpa merge juga dihapus branch-nya. Aktifkan "Automatically delete head branches" di GitHub bila punya akses.
9. **Melaporkan bug/permintaan** — pemilik menulis ke sesi (screen name + apa yang diharapkan; "tidak perlu tepat soal berkas"), sesi mencatat di `docs/plan/backlog.md` (bagian *Bugs*: apa yang terjadi, di mana, status) dan `findings.md` (`F…`); yang diputuskan pemilik masuk `06-decisions.md` (`D…`); pertanyaan terbuka diberi nomor `Q…` dengan default yang sudah berjalan.

#### Aturan & kontrol
- **Satu sesi, satu fitur**; satu milestone per PR (`07-ways-of-working.md`).
- **`main` adalah produksi**; hanya PR yang boleh mencapainya. `npm run build` bukan yang dikirim — `opennextjs-cloudflare build` yang dikirim (menolak hal yang diterima `next build`, mis. rute edge-runtime).
- **Migrasi aditif** boleh diterapkan setelah `rebuild.sh` bersih; **destruktif minta pemilik**. Jangan menulis ulang `schema_migrations` agar tampak cocok (merekam sesuatu yang tidak pernah berjalan).
- Jangan menyimpan status turunan; jangan menyatakan milestone selesai dengan jalur penolakan yang belum diuji.
- Rahasia hanya di secret store; `service_role` tidak pernah berawalan `NEXT_PUBLIC_` (kode menolak membacanya dan melempar error).
- Penamaan lokal PL/pgSQL: variabel diawali `v_`, argumen `p_` (dicek `check_shadowing.sh`).

#### Jejak data (apa yang terekam)
- Git: commit/PR/merge (riwayat perubahan kode), commit memuat atribusi sesi.
- `supabase_migrations.schema_migrations` (nama + teks tiap migrasi yang diterapkan), papan di `docs/plan/README.md`, `06-decisions.md`, `findings.md`, `backlog.md`.
- `docs/plan/checkpoints/` — jalan-jalan (walkthrough) dengan pengguna nyata.

#### Serah-terima ke tim lain
Perubahan yang mengubah cara kerja tim (layar baru, aturan baru) → ditulis sebagai keputusan di `06-decisions.md` dan pengetahuan proses John Lau (`ops_asst.processes`) sehingga SOP dan asisten ikut berubah; pemilik mengabari tim.

#### Koreksi & pengecualian
- **Rollback aplikasi**: balik (revert) satu commit dan deploy ulang melalui `main`; pratinjau/versi Cloudflare lama tersedia (mekanisme rollback Cloudflare tidak terdokumentasi di repo — tidak terkonfirmasi).
- **Rollback migrasi**: migrasi *maju saja*; tidak ada skrip turun. Koreksi = migrasi baru. Data bisnis salah dikoreksi lewat VOID/supersession, bukan hapus.
- **Insiden**: tidak ada runbook insiden, jadwal on-call, kanal pelaporan insiden, atau SLA yang terdokumentasi di repo (tidak terkonfirmasi). Jalur yang dipakai nyata: pemilik melapor ke sesi → `backlog.md`/`findings.md` → perbaikan → PR.
- **Pencadangan database**: tidak ada prosedur backup/restore atau uji pemulihan yang terdokumentasi di repo; ketersediaan backup/PITR Supabase tidak terkonfirmasi. (Shared drive bernama **BACKUP** ada di daftar drive Google, tetapi tidak disebut terhubung ke backup database.)
- **Cutover domain**: `wrangler.jsonc` tidak mendefinisikan `routes`; menghubungkan `ops.talaliving.com` ke Worker adalah langkah DNS terpisah. Dokumen auth menyebut Site URL `https://ops.talaliving.com`; status cutover tidak terkonfirmasi dari repo.

#### Checklist rutin
- [ ] Sebelum push: `npm run verify` dan (bila ada migrasi) `npm run verify:db` hijau.
- [ ] Setelah merge: branch dihapus; papan diperbarui; migrasi yang perlu diterapkan ke produksi dicatat ("applied to production …").
- [ ] Setelah apply migrasi ke produksi: sidik jari teks tersimpan = berkas; deploy aplikasi menyusul.
- [ ] Bulanan: `git branch -r` hanya berisi branch yang sedang berjalan.
- [ ] Pemilik/IT: konfirmasi backup Supabase aktif dan lakukan uji pulih berkala (belum ada prosedur — lihat Kesenjangan).

#### Sumber
`CLAUDE.md`, `docs/plan/07-ways-of-working.md`, `.github/workflows/ci.yml`, `wrangler.jsonc`, `package.json` (skrip `verify`, `verify:db`), `supabase/README.md`, `supabase/local/rebuild.sh`, `.env.example`, `docs/plan/phase-2/README.md` (aturan 10), `docs/plan/phase-2/06-auth.md`, `docs/plan/findings.md` F159, F167, `docs/plan/backlog.md`.

---

### Penyimpanan berkas bukti di Google Drive (`/it/drive`)

#### Tujuan
Semua berkas yang disimpan aplikasi berada di folder `ops-talaliving` di akar shared drive modul (PROCUREMENT, ACCOUNTING, HRD, DRAFTING, PRODUCTION, PROJECT MANAGER, IT), **satu folder per tugas**, sehingga manusia dan sistem membuka berkas yang sama berdampingan, dan metadata/jejaknya tetap di database.

#### Pemilik / peran & kewenangan
- IT: `it.read` untuk melihat layar `/it/drive`; `it.manage_drives` (hanya `it` `admin`) untuk memindahkan folder drive atau memindahkan jenis dokumen ke drive lain (batas data pribadi — `doc_kind_drive`).
- Pengunggah: pemegang izin modul pemilik dokumen (cek di seam `attach_file`/`documents.upload`).

#### Prasyarat
Secret `GOOGLE_PRIVATE_KEY` dan `GOOGLE_SERVICE_ACCOUNT_EMAIL` (di `wrangler.jsonc`), akun layanan menjadi anggota shared drive, dan folder `ops-talaliving` dibuat **oleh aplikasi sendiri** (izin `drive.file` hanya melihat yang dibuat aplikasi; folder OPS buatan tangan menjawab *File not found*, F173).

#### Langkah-langkah
1. IT → `/it/drive` → **Buat ops-talaliving di semua drive** (atau per drive: **Buat ops-talaliving**) → **Cek lagi**; layar menunjukkan drive yang tidak dapat dijangkau aplikasi.
2. Fitur yang menyimpan berkas memanggil `documents.upload(..., entity)`; rute `src/app/api/documents/upload/route.ts` menemukan atau membuat tiap tingkat folder per `ops_core.drive_paths` (jenis + rekaman → jalur di bawah `ops-talaliving`; tanpa baris = nama jenis dengan huruf kapital, mis. `PURCHASE ORDER`) dan menulis metadata (`attachments`, `attachment_links`).
3. Contoh jalur (Pengadaan): `INVENTORY/ITEMS`, `INVENTORY/FINISHED GOODS`, `RECEIVING REPORT/<YYYY-MM>/<YYYY-MM-DD>` (menurut hari kedatangan, D360); Akuntansi: `TRANSACTIONS/<YYYY-MM>/<YYYY-MM-DD>` (D359).

#### Aturan & kontrol
- **Tidak pernah berserakan di akar `ops-talaliving`** — selalu di folder tugas.
- Drive dipilih **database** dari jenis dokumen (`doc_kind_drive`): 11 jenis pribadi (KTP, KK, ijazah, CV, kontrak, NPWP, BPJS, surat dokter, surat lembur, laporan lembur, surat peringatan) selalu ke HRD; tidak ada argumen yang bisa mengalihkannya (0035). Jenis `other`/`foto`/`sertifikat` jatuh ke Pengadaan — risiko yang disebut (foto KTP yang masuk lewat chat ke Pengadaan).
- Fitur baru yang menyimpan berkas **wajib** mengirim `entity` dan, bila perlu folder sendiri, menambah baris `drive_paths` di migrasinya.
- Berkas sama (hash sama) hanya diperingatkan, tidak ditolak.

#### Jejak data (apa yang terekam)
`attachments`, `attachment_links` (siapa menautkan/melepas), audit `attach_file` (nama berkas + jalur drive), `upload · refused` (kegagalan Google), `drive_folders.updated_by`, `v_drive_readiness`.

#### Serah-terima ke tim lain
Pemilik dokumen (Pengadaan, Akuntansi, HRD, dst.) menautkan bukti dari layar rekamannya; IT hanya memastikan folder siap.

#### Koreksi & pengecualian
- Berkas salah tautan: lepas tautan (penanda `unlinked_*`, bukan hapus) lalu tautkan ulang.
- Upload gagal: lihat baris `upload · refused` di `/it/audit` dan kartu drive di `/it/drive` (menyebut penyebabnya: folder belum dibuat, akun layanan bukan anggota, dst.).

#### Checklist rutin
- [ ] Setelah menambah shared drive/modul baru: **Buat ops-talaliving** di `/it/drive`.
- [ ] Mingguan: baris `upload · refused` di audit.

#### Sumber
`CLAUDE.md` (aturan D313/D320), `docs/plan/phase-2/05-storage.md`, `src/app/(app)/it/drive/page.tsx`, `src/app/api/documents/upload/route.ts`, `src/lib/drive.ts`, `supabase/migrations/0005`, `0035`, `0036`, `0173`, `0175`, `0177`, `0203_core_drive_transactions`, F166, F173, D313, D314, D320.

---

### Kesenjangan & catatan chapter ini

#### A. Yang tidak direkam atau tidak dibangun
1. **Rekaman pembacaan** tidak ada kecuali `view` kasar 120 hari dan `reveal` identitas. Pembacaan slip gaji, buku besar, atau daftar karyawan oleh orang tertentu tidak dapat dibuktikan setelah 120 hari. `print`/`export` didefinisikan tetapi tidak dipanggil siapa pun; `sign_out` dan `task_acknowledged` (di aturan baca 0163) tidak punya pemanggil.
2. **Percobaan sign-in gagal tidak direkam** aplikasi (hanya log GoTrue, cara melihatnya tidak terdokumentasi). Sign-in lewat tautan undangan/pemulihan tidak menghasilkan baris `sign_in`.
3. **Tampilan "Sebelum/Sesudah" di `/it/audit` kemungkinan kosong di mode live untuk sebagian besar baris**: `ops_core.v_audit` (0023/0086) tidak mengekspos kolom `before`/`after` — hanya `detail` — sedangkan layar membaca `detail.before`/`detail.after`. Seam yang menaruh before/after lewat `ok(..., p_before, p_after)` (mis. `modules.set`, `authorities.set`, `profile.update`) menyimpannya di kolom, bukan `detail`. Akibatnya jejak "siapa mengubah akses siapa dari apa ke apa" ada di database tetapi tidak tampil di layar tanpa SQL. **Diturunkan dari kode, belum diverifikasi di produksi.**
4. **`granted_at`/`granted_by` direset** untuk seluruh set pada setiap simpan karena `set_modules`/`set_authorities` menghapus-lalu-menyisipkan ulang seluruh set; riwayat per-modul hanya tersedia dari audit (lihat butir 3).
5. **Tidak ada persetujuan kedua** atas pemberian wewenang: satu IT admin dapat memberi `approve_funds` kepada IT admin lain (hanya larangan memberi ke diri sendiri). Tidak ada kedaluwarsa otomatis hak sementara. Tidak ada peninjauan hak berkala terotomatisasi.
6. **Rekap dan retensi log aktivitas manual** (**Rekap kemarin**, **Jalankan retensi**); tidak ditemukan penjadwal (`pg_cron` hanya dipakai jembatan penerimaan Chat). Hari yang terlewat bisa membuat detailnya kedaluwarsa tanpa rekap (retensi melindungi dengan `blocked_days`, tetapi hari itu terus menumpuk). Layar hanya merekap "kemarin".
7. **Audit "append-only" hanya karena tidak ada policy/grant**; tidak ada trigger penolak `update`/`delete`/`truncate` untuk pemilik tabel/service role. Tabel `idempotency_keys` dan `outbox` tidak punya pembersihan terjadwal (tumbuh terus).
8. **Pengiriman outbox belum ada pekerjanya** (B10): kartu persetujuan PO ke Google Chat belum terkirim; `0155` mencatat 180 baris outbox tak terkirim per 2026-09-24 dan hanya `procurement.approval.requested` yang hidup. Notifikasi "belum absen" dan "perubahan rate gaji" tidak punya peristiwa sama sekali. Tidak terkonfirmasi apakah pekerja sudah dipasang sejak itu.
9. **Rekaman mesin PC** (`activity_intervals`, `activity_daily` di `0026`, retensi 120 hari menurut D283) hanya skema — tidak ada agen atau layar di repo.
10. **Layar Pengaturan (`/pengaturan`) tidak live**: tidak ada di `LIVE_ROUTES`, klien live `identity` tidak punya fungsi pengaturan; dua puluh pengaturan yang tampil adalah fixture demo. Pengaturan nyata di `ops_core.settings` (toleransi, `late_after_minutes`, `activity_log.*`, dst.) hanya berubah lewat migrasi/SQL. Kunci retensi ganda: `activity.interval_days`/`activity.recap_days` (0026) vs `activity_log.detail_days`/`activity_log.recap_rows` (0027); yang dipakai layar adalah yang kedua.
11. **Tidak ada runbook insiden, kanal pelaporan bug resmi, SLA, prosedur backup/restore, atau uji pemulihan** yang terdokumentasi. Cara rollback Cloudflare dan konfigurasi branch protection ada di luar repo.
12. **Autorisasi per-rute tidak ada di shell**; menu menyembunyikan, RLS dan seam menolak. Layar yang memanggil view lintas modul (Dasbor memakai keuangan dan pengadaan) tidak punya jaminan tertulis tentang apa yang terlihat oleh pemegang `dashboard` saja.
13. Karyawan keluar memerlukan **dua tindakan terpisah** (HRD *offboard*, IT *Nonaktifkan*); tidak ada pemicu otomatis dari yang satu ke yang lain.
14. Format `-ANN` (amandemen PO) dan `-vN` (versi dokumen) di konteks tidak ditemukan generatornya; prefix `pay` terdaftar tetapi tidak ada pemanggil; `dsn` (tugas desain) hanya di data demo; kode produk/proyek diketik manusia tanpa generator terkonfirmasi.
15. Salah ketik email akun tidak dapat diperbaiki lewat layar (hanya nama).
16. Pengunggahan "KTP lewat chat" bisa mendarat di drive Pengadaan karena jenis `other` — risiko yang diakui di `05-storage.md`, belum ditutup.
17. Teks yang diketik ke John Lau meninggalkan sistem menuju penyedia model (Anthropic) saat model dipakai; tidak ada penyaringan data pribadi di prompt (hanya larangan model melihat data bisnis).

#### B. Konflik dokumen vs kode (kode/commit terbaru dipakai)
| Dokumen | Menyatakan | Kode/commit terbaru |
|---|---|---|
| `README.md` (akar) | Belum ada backend/autentikasi, 8 peran, 9 seksi menu, "35 halaman placeholder", `backend/` kosong | Backend Supabase, 210 migrasi, autentikasi nyata, katalog 12 modul × 3 level + 5 wewenang; README akar usang |
| `docs/plan/README.md` (bagian Deployment) | Vercel membangun dari GitHub; Production Branch `claude/serene-euler-eq2qef`, `main` tidak men-deploy | `wrangler.jsonc` dan `ci.yml`: Cloudflare Workers Builds, `main` = produksi, branch lain = versi pratinjau; Vercel hanya milik repositori lama |
| `supabase/README.md` | "Nothing in this folder has been applied to Supabase yet" | Papan: puluhan migrasi (sampai `0206`) diterapkan ke produksi |
| `wrangler.jsonc` (komentar) dan `.env.example` | Tidak ada route handler/`next/image`; `/api/documents/upload` adalah satu-satunya rute server | Ada rute server: `/api/assistant/explain`, `/api/documents/{upload,drive-check,thumb}`, `/api/identity/users`, `/api/inventory/nota`, `/api/procurement/receiving`, `/api/production/bom` |
| `docs/plan/phase-2/README.md` aturan 8 & `0004` | Hari kantor = `Asia/Makassar` (WITA) | D334/`0190`: seluruh jam kantor = **WIB**; `office_tz()` dan penomoran memakainya. |
| `02-database.md` §akses | Enam modul (`procurement`, `accounting`, `hrd`, `inventory`, `production`, `it`) dan empat wewenang | Dua belas modul (`dashboard`, `payroll`, `marketing`, `project`, `delivery`, `settings` ditambahkan) dan lima wewenang (`approve_overtime`, D145) |
| `0035` (komentar) | Mengubah folder drive butuh `it.admin` | Tidak ada izin itu; yang benar `it.manage_drives` (F166, 0173) |
| `/john-lau` (teks layar) dan D221 | "Pemahaman kalimatnya belum nyata — masih pencocok kata kunci, bukan model bahasa" | D296/D336: model bahasa (Anthropic di produksi) menjawab *cara pakai* dan memilih alat bila kata kunci gagal; teks layar perlu diperbarui |
| `docs/plan/06-decisions.md` | Dua baris bernomor **D291** (Jadwal kerja dapat diubah dari layar; Google Chat hanya ingest/notifikasi) | Duplikasi nomor — salah satu perlu dinomori ulang |
| `docs/plan/penomoran.md` | Format ID ringkas `prefix-YY-MM-DD_NN` | Benar, tetapi `trx` dan `tsl` tiga digit; terdapat ID non-prefiks (`I-`, `V-`, `CL-`, `AST-`, `RT-`, `TL-`) yang tidak terdaftar di `doc_prefixes` |

#### C. Hal yang tidak dapat dikonfirmasi dari repo
- Daftar pemegang modul/wewenang di produksi (diatur di `/it/pengguna`); "pemegang bawaan" di tabel wewenang berasal dari seed demo dan keputusan D19/D24/D145.
- Apakah branch protection `main` benar-benar aktif, apakah backup/PITR Supabase aktif, apakah domain `ops.talaliving.com` sudah diarahkan, apakah pekerja outbox/Chat terpasang, dan apakah SMTP sungguhan sudah dikonfigurasi.
- Nilai sebenarnya `NEXT_PUBLIC_USE_SUPABASE` di produksi (diasumsikan live sejak M61/D265; badge `/signin` adalah cara memastikan).

#### D. Catatan metodologis
Bab ini menyusun fakta dari: `src/lib/roles.ts`, `src/services/identity/contracts.ts`, `src/lib/nav.ts`, migrasi `0001`–`0207` (khususnya `0002`, `0003`, `0004`, `0007`, `0015`, `0023`, `0026`, `0027`, `0029`, `0038`–`0041`, `0086`, `0155`, `0163`, `0176`, `0177`, `0183`, `0185`, `0190`, `0198`), seluruh layar `/it/*`, `/signin`, `/set-password`, `/no-access`, `/dashboard`, `/saya`, `/profil`, `CLAUDE.md`, `docs/plan/*`, `.github/workflows/ci.yml`, `wrangler.jsonc`, dan riwayat `git log` sampai 2026-10-01. Setiap klaim "tidak ditemukan/tidak terkonfirmasi" berarti pencarian di repo tidak menemukannya, bukan bahwa hal itu pasti tidak ada.


---

## Lampiran A — Ringkasan akses dan wewenang

Matriks lengkap modul × level dan lima wewenang bernama (apa yang diizinkan, pemegang bawaan) ada di **Bab 6, bagian "Akses modul, wewenang bernama, dan katalog peran"**. Ringkasnya:

| Modul | Izin dalam katalog | Catatan |
|---|---|---|
| dashboard, settings | read / update | |
| hrd, payroll | hrd: read/create/update · payroll: read/run | dua grant terpisah |
| procurement, marketing, delivery | read/create/update | |
| inventory | + `adjust` | tanpa langkah persetujuan opname (Q57) |
| accounting | + `plan_cash` (khusus level Penuh/pimpinan, D233) | |
| project | + `handover` (BAST) | |
| production | + `schedule` | |
| it | + `manage_users`, `manage_roles`, `purge_activity`, `manage_drives` (khusus Penuh) | hanya IT dan pimpinan |

| Wewenang | Memutuskan | Pemegang acuan |
|---|---|---|
| `approve_goods` | persetujuan barang; konfirmasi PO | satu orang: CEO (D19) |
| `approve_funds` | persetujuan dana, payment round, tutup PO, run gaji | Finance |
| `approve_overtime` | lembar & pengajuan lembur | Pimpinan (D145) |
| `post_ledger` | satu-satunya jalur menulis buku besar | Finance/Akuntansi |
| `resolve_inbox` | menautkan/membukukan bukti tanpa induk | Finance/Akuntansi |

*Pemegang nyata di produksi tidak ada di repo — baca dari `/it/peran`.*

## Lampiran B — Ritme kerja lintas tim

> Ritme di bawah adalah **saran operasional** yang diturunkan dari cara kerja sistem; cadensinya belum diputuskan pemilik (tandai sebagai keputusan baru bila ingin dijadikan aturan).

| Ritme | Tim | Yang dikerjakan di sistem |
|---|---|---|
| Harian | Semua karyawan | tap masuk/pulang di `/saya` |
| Harian | Gudang | catat penerimaan dan tanda tangan; bahan keluar menyebut JO |
| Harian | Produksi | progres tahap, timeslot, leg vendor |
| Harian | Procurement | PR baru, status PO, tindak lanjut persetujuan |
| Harian | Finance | kotak masuk `/accounting/verifikasi` sampai kosong; bukukan bayar |
| Harian | CEO/Finance | Meeting board persetujuan |
| Mingguan | HRD | impor absensi, lembar lembur, run gaji minggu (pekan Jumat–Kamis, D357) |
| Mingguan | Finance | rekening koran vs buku besar; kalender pembayaran |
| Bulanan | Finance | checklist penutupan (Bab 2), rencana kas 12 bulan, tagihan bulan ini |
| Bulanan | Gudang | opname, rekap kayu bulanan |
| Bulanan | HRD | iuran/BPJS, kontrak yang akan berakhir, KPI |
| Triwulan / saat berubah | IT & Pimpinan | tinjau pemegang wewenang dan modul IT; cek drive di `/it/drive`; jalankan retensi log aktivitas |

## Lampiran C — Kesenjangan terkonsolidasi (yang belum terekam / belum dibangun)

Tujuan sistem adalah *semua terekam*. Daftar ini jujur memetakan di mana tujuan itu belum tercapai, berdasarkan kode per 2026-10-01. Rincian dan nomor sumber ada di bagian "Kesenjangan" tiap bab.

### C1. Risiko tinggi (kontrol atau bukti bisa lolos)

1. **Run gaji yang sudah disetujui tidak dibekukan** (F207); tidak ada penjaga terhadap perubahan absensi/tanda hari/cuti pada periode yang sudah ditandatangani. Penyetuju tidak dicek berbeda dari pembuka run (Bab 4).
2. **Tidak ada pembatalan** untuk PR yang sudah diajukan, PO, Job Order, surat jalan, instalasi, BAST; tidak ada edit/batal penerimaan `CONFIRMED` dan receiving report `MATCHED` (Bab 1, 5). Enum `CANCELLED` ada, fungsinya tidak.
3. **Tidak ada wewenang yang menjaga** quotation, rilis BOM, pembuatan Job Order; proyek bisa diset `DONE` tanpa BAST (Bab 5).
4. **`attachments_read = true`**: proxy thumbnail dapat menyajikan lampiran apa pun (termasuk berkas HR) kepada pengguna yang masuk (Bab 2). `post_transaction` tidak menegakkan `is_paying`; VOID mengabaikan kecocokan rekening koran.
5. **Opname, pengembalian, dan pindah stok adalah insert langsung tanpa baris Audit Log** (Bab 3). Daftar aksi yang tidak dicatat (login gagal, sign-out, cetak, ekspor) ada di Bab 6.
6. **`v_audit` tidak menampilkan kolom before/after**, sehingga `/it/audit` mungkin tidak menunjukkan perubahan hak akses dari-ke di mode live (Bab 6; belum diperiksa di produksi).
7. **Pemberian wewenang tidak butuh persetujuan kedua** dan tidak kedaluwarsa otomatis. `approve_goods` dipegang satu orang.

### C2. Fitur yang belum live atau hanya sandbox

| Area | Kondisi |
|---|---|
| `/produksi/desain`, `/produksi/penautan`, `/produksi/vendor` | hanya sandbox; tabel desain belum ada di database |
| Liquidation (`/accounting/liquidation`), `/hrd/iuran`, `/hrd/kinerja`, `/pengaturan` | hanya demo |
| BPJS | tidak ada seam/screen live → slip gaji tanpa potongan BPJS (Q56 terbuka) |
| Rekening koran | unggahan tidak mengirim berkas → "Bukukan" ditolak `statement_not_filed` |
| Kartu persetujuan PO di Google Chat | belum dibangun (B10); pengiriman kartu PR bergantung worker di luar repo (tidak terverifikasi) |
| Penawaran antar-vendor | tidak ada; hanya lampiran bukti harga di baris PR |
| Outbox | tidak ada worker pengirim; roll-up dan retensi log aktivitas manual |
| Pembayaran klien, pembayaran komisi agen | sengaja/belum dilacak |
| Barang jadi dari progres Produksi | tidak otomatis; surat jalan mengambil dari rak asal (Q59/F177) |
| Pengaturan minimum stok / lokasi asal barang | tidak ada layar, semua penerimaan jatuh ke GUDANG |
| Pencatatan kayu: edit/hapus muatan, biaya, gerak papan | tidak ada |
| Alokasi pembayaran ditarik kembali | selalu gagal (`supersede_not_self`, F211) |

### C3. Berkas yang belum mengikuti aturan folder per tugas

- Nota kayu tidak punya folder tugas sendiri → masuk `ACCOUNTING/NOTA`.
- Nota/transfer proof memakai `NOTA` / `TRANSFER PROOF`, belum `TRANSACTIONS/<YYYY-MM>/<YYYY-MM-DD>` (D359 butir 3 menunggu pemilik); baris `drive_paths` untuk `nota`/`transfer_proof` mungkin belum ada di produksi.
- Berkas 201 *Foto, Sertifikat, Lainnya* masuk drive PROCUREMENT; sebagian besar unggahan HR tanpa `entity`/`drive_paths` — melanggar aturan `CLAUDE.md`.
- Kutipan/quotation cetak tidak disimpan di Drive.
- Tidak ada layar untuk mengelola `drive_paths`.

### C4. Perbedaan dokumen vs kode yang harus dibereskan

| Topik | Dokumen lama | Kode (berlaku) |
|---|---|---|
| Stok dari penerimaan | SOP lama: tidak otomatis | otomatis lewat penerimaan bertanda tangan (0169/0180) |
| Zona waktu kantor | WITA | **WIB** (D334, 0190) |
| Pekan gaji | — | Jumat–Kamis (D357); pola unit kini di HRD (D365) |
| Nomor Job Order | `spk-` | `jo-` baru; `spk-` lama tetap valid |
| Model quotation | D240/`03-api.md`: tidak ada | ada (0133) tanpa nomor D |
| Batas unggah | 15 MB (dokumen) | 25 MB (database) |
| Estimasi kas 12 bulan | D233: khusus admin | seam SQL hanya cek `accounting.update` (aturan admin hanya di sisi layar/demo) |
| Hapus penyesuaian stok | teks layar: tidak pernah dihapus | D348 mengizinkan hapus dengan alasan |
| Nomor keputusan | D359, D363, D291 bernomor ganda; D363 menyebut 0204 padahal kode di 0205 | — |
| Status migrasi | README/ supabase README: sebagian "belum diterapkan" | cek papan; 0207 belum diterapkan ke produksi per README |
| Tombol/teks John Lau | "tidak ada model bahasa nyata" | model dipakai (Bab 6) |

### C5. Belum ada dokumen operasional

- Runbook insiden, prosedur cadangan/pemulihan, dan rollback rilis (Bab 6).
- Penetapan pemegang wewenang di produksi (hanya ada di `/it/peran`, bukan di repo).
- Keputusan pemilik atas cadensi checklist (Lampiran B) dan atas butir-butir D359 yang masih menunggu.

---

*Akhir dokumen. Perbarui SOP ini setiap kali sebuah keputusan baru (`D…`) atau temuan (`F…`) mengubah cara kerja, dan catat di papan `docs/plan/README.md`.*
