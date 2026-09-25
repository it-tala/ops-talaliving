# Evaluasi penomoran — rantai pembelian → produksi (D312)

Pertanyaan pemilik (2026-09-25):

> *kita butuh 1 nomor di setiap event dimana 1 nomor bisa merujuk ke database
> inventory → inventory dipakai BOM → nomornya dipakai lagi ke Purchase Request →
> bisa jadi ke Purchase Order untuk vendor → lalu barangnya masuk gudang masuk ke
> receiving report, stok nambah, status di job order jadi material ready → job
> order pakai nomor yang sama → job selesai, project selesai bisa di review ulang
> seluruh kejadian purchase-produksi*

## Jawaban singkat

**Satu nomor untuk semua dokumen tidak mungkin, dan tidak perlu.** Satu PO ke
satu vendor bisa berisi bahan untuk tiga Job Order, dan satu Job Order belanja
ke lima vendor. Kalau semua dokumen dipaksa memakai satu nomor, nomor itu harus
memilih salah satu JO dan yang lain hilang.

Yang dibutuhkan: **setiap baris membawa dua kunci**, dan **satu nomor apa pun
bisa membuka seluruh ceritanya**. Keduanya sekarang ada:

| kunci | contoh | menjawab | ada di |
|---|---|---|---|
| **Kode barang** | `I-00042` | *barang apa* | katalog/inventory, baris BOM, baris PR, baris PO, penerimaan (lewat barisnya), gerak stok |
| **Nomor Job Order** | `spk-26-08-24_01` | *untuk pekerjaan mana* | baris PR (`source_wo_no`), bahan keluar (`ref_no`), progres, barang jadi — dan lewat JO: **kode proyek** + baris pesanan klien |

Layar **Produksi → Job trail** (`/produksi/jejak`) menerima nomor proyek, JO,
PR, PO, receiving report, atau surat jalan, lalu menampilkan seluruh proyeknya
urut waktu: PR → PO → penerimaan → stok masuk → bahan keluar ke JO → progres →
barang jadi → surat jalan → BAST. Dari drawer Job Order ada tautan *Jejak lengkap*.

## Rantai, langkah demi langkah

| langkah pemilik | nomornya sendiri | menyambung ke langkah sebelumnya lewat | status |
|---|---|---|---|
| database inventory | `I-00042` (item) | — | ✅ + nama lapangan & foto (D309) |
| dipakai BOM | produk `PRD-…`, revisi BOM | baris BOM menyebut kode barang | ✅ |
| Purchase Request | `pr-…`, baris `pr-…-L01` | `item_id` + **`source_wo_no`** (dari tombol *buat PR dari BOM JO*) | ✅ — **`source_wo_no` sekarang diperiksa** (D312) |
| Purchase Order | `po-…` | `po_lines.pr_line_id` | ✅ |
| masuk gudang / receiving report | `rcv-…` | `receipts.po_line_id` / `line_id` | ✅ |
| stok nambah | `stk-…` | `stock_moves.ref_no = rcv-…` | ✅ **baru berjalan di sistem sungguhan** (D310 — sebelumnya tidak pernah) |
| JO jadi *material ready* | — (bukan dokumen) | dihitung: sisa kebutuhan BOM JO vs stok di rak | ✅ dihitung saat dibaca, tidak disimpan (D312) |
| bahan keluar ke JO | `stk-…` | `ref_no = spk-…` | ✅ — **sekarang diperiksa** (D312) |
| job selesai | status JO `DONE` | progres per tahap | ✅ |
| barang jadi / kelebihan produksi | `fgm-…` | `wo_no` + baris pesanan dari JO | ✅ baru (D311) |
| pengiriman | `krm-…` | baris pesanan klien | ✅ |
| project selesai | BAST `bast-…` | kode proyek | ✅ |
| **review ulang semua** | — | **Job trail** | ✅ baru (D312) |

## Yang ditemukan rusak atau longgar

1. **Stok tidak pernah bertambah dari penerimaan di sistem sungguhan.** Hanya
   demo yang melakukannya. Diperbaiki (D310, `0169`).
2. **`pr_lines.source_wo_no` dan `ref_no` bahan keluar adalah teks bebas.** Satu
   salah ketik memutus rantai tanpa ada yang tahu. Sekarang ditolak saat ditulis
   (JO tidak ada → ditolak; JO dibatalkan → tidak boleh belanja untuknya).
   Baris lama tidak disentuh.
3. **Belanja proyek yang tidak menyebut JO.** Contoh di data demo: 6 baris
   pembelian proyek 25007 tanpa JO — biayanya masuk proyek, tapi tidak bisa
   ditelusuri ke produksi mana. Job trail menghitung dan menampilkannya.
4. **Tidak ada status *material ready*.** Sekarang dihitung dari rak: *Belum ada
   BOM · Menunggu bahan · Material ready · Bahan sudah keluar*.
5. **Barang jadi tidak tercatat sama sekali.** Sekarang ada (D311).

## Riwayat satu barang (D313)

Tidak ada tabel khusus — riwayat dibaca dari baris yang sudah ada, supaya tidak
ada salinan kedua yang bisa berbeda. Ketik **kode barang** (mis. `I-00042`) di
Job trail, atau klik *Riwayat lengkap barang* di drawer stok: masuk katalog →
BOM yang memakainya → PR → PO → receiving → stok → Job Order yang dilayani.

## Keputusan pemilik (2026-09-25)

Surplus barang jadi **boleh dipakai untuk pesanan lain** — dibangun (D313).
Tiga hal di bawah **tidak perlu** (*sisanya tidak perlu*) dan tidak dibangun:

- **Reservasi stok per JO.** *Material ready* membaca rak bersama: dua JO bisa
  sama-sama *ready* atas plywood yang sama. Mengunci stok untuk satu JO adalah
  aturan baru (siapa duluan? bisa dipindah?) — belum dibangun.
- **Wajib JO di setiap baris PR bahan produksi?** Saat ini boleh kosong (ongkos
  angkut, belanja umum proyek). Bisa diwajibkan untuk kategori bahan produksi.
- **PO menyebut proyek/JO di kepalanya?** Sekarang PO tahu JO lewat baris PR-nya
  saja. PO yang dibuat tanpa PR tidak punya jalur ke JO.
- **Alokasi ulang surplus barang jadi** dari satu pesanan ke pesanan lain (D311).

## Format nomor yang dipakai

`prefix-YY-MM-DD_NN` untuk dokumen harian (`pr`, `po`, `spk`, `krm`, `stk`,
`fgm`, `trx`, …), baris PR `…-L01`, barang `I-00042`, produk `PRD-…`, proyek
kode angka (`25007`). Nomor yang tercetak di kertas tidak pernah berubah; yang
menyambungkan adalah kunci di baris, bukan nomor baru.
