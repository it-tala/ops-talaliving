# PLV BOM (proyek Claude) vs modul BOM ops.talaliving — kajian 30 Sep 2026

Kajian, bukan keputusan. Tidak ada D-number yang lahir dari dokumen ini;
yang diputuskan owner setelah membacanya dicatat di `docs/plan/06-decisions.md`.

## 0. Apa yang bisa dibaca, apa yang tidak

Proyek claude.ai bernama **PLV BOM** tidak bisa dibuka dari sesi ini (Claude
Code tidak punya akses ke Projects claude.ai). Yang dibaca adalah **berkas
keluarannya di shared drive** (`shared@talaliving.com`) dan folder
`PLV BOM` milik `evin1oshima@gmail.com`:

| Berkas | Tanggal | Isi |
|---|---|---|
| `PLV BOM` / `PLV BOM 27 SEPT 26` | 27 Sep | Salinan format costing lama (tab `PL 085`, `PL 086`, `PL 08 7`): per komponen L × W × H → m² flat, m² 3D, m³, RATE, lalu kolom USD, MARKUP, FOB, LOADING, SHIPPING, LANDED, VAT+CUSTOMS 22 %, PHP, GROSS MARGIN. Ini keluarga "BOM lama" (`REVISI BOM 21 MEI 26` untuk STMV) |
| `STMV_BOM_vs_Actual_Reconciliation 23 sept` | 23 Sep | Budget (BOM REVISI 21 MEI 26 × qty) vs aktual ledger 1 Jan–21 Sep: proyek **137 %** dari budget; upah produksi 355 %, hardware 328 %, upholstery 198 %, mindi 191 %; overhead pabrik 175 % dari "misc 20 %" |
| `TALA_BOM_Dataset_ops_aligned`, `TALA_Item_Master_DB`, `TALA_Master_Price_Catalogue` | 24 Sep | Harga dari nota → `ops_procure.items` (137 UPDATE, 104 INSERT), 379 rate per vendor, 692 observasi harga, dan **`BOM_RATE_REF`: rate rekomendasi untuk `ops_prod.bom_components.unit_rate` + `rate_source`** (mis. `KY-JTI-A` 8,8 jt/m³, `KY-MND-S` 2,7 jt/m³, `PL-18PU` 250 rb/lembar, `KC-POL` 270 rb/m²) |
| `PLV Labour Rate Card - Daily Worker Payroll Mar-Sep 2026` | 29 Sep | 30 lembar payroll mingguan → rate per kategori: tukang 20.300/jam, sanding 12.400, finishing 20.600, PU 13.100, gerinda 13.500, sample maker 26.100 (loaded, + uplift tak langsung 9,95 %) |
| *PLV BOM Rate Card and Rule Spec 29Sep26* | 29 Sep | Dokumen spesifikasinya sendiri **tidak ada di Drive** (ada di knowledge proyek Claude); yang terbaca adalah *snapshot*-nya di tab `RATES` stack test (`rates_version 2026-09-29`) |
| `PLV_BOM_Stack_Test_OV-505B_ID-OV-506_30Sep26_v2` | 30 Sep | Uji 2 item: template v2 + rate card, dibanding baris per baris dengan BOM lama dan alasan tiap selisih |
| `PLV_BOM_Stack_Test_12_Items_30Sep26` | 30 Sep | Uji 12 item STMV (1.435 pcs): total **+29 %** dari BOM lama; estimasi baru = **94 %** dari aktual teralokasi |

Sisi OPS dibaca dari kode dan migrasi (`0060`, `0061`, `0065`, `0066`,
`0108`–`0111`, `0130`, `0133`, `0174`, `0182`, `0193`), layar
`/produksi/bom`, `/produksi/rate`, Job Order, quotation, dan
`docs/plan/06-decisions.md` (D149–D151, D237–D240, D256, D257, D266, D324,
D338, Q-D338a).

## 1. Cara kerja PLV BOM (Input Template v2 + Rate Card 29 Sep)

**Satu tab per item.** Kepala: kode, nama, ruang, **project qty**, resep
finishing (NC NATURAL / PU DUCO / NC + GLAZE / NONE / OTHER), flatpack Y/N,
link gambar, L × W × H keseluruhan.

**Empat blok input, semua per SATU unit:**

1. **PACKING** — kosong untuk barang rakitan (sistem memakai ukuran
   keseluruhan + 40 mm per sisi sebagai 1 karton); flatpack: satu baris per
   kotak. Dihitung: m² 6 sisi, m³.
2. **SOLID WOOD** (25 baris) — material (TEAK/MINDI/MERANTI/OTHER),
   komponen, **L × W × T mm, qty, EXPOSED Y/N, CURVED Y/N, TIER OVERRIDE**.
   Dihitung: m³, m² muka terbesar, **tier otomatis**, CHECK, rate, biaya.
3. **PANELS** (15 baris) — tipe panel (`PLY-3..24-RAW/MSF/MDF/TSF/TDF`),
   L × W × T, qty, **muka terekspos 0/1/2**, SHEETS manual bila tanpa ukuran.
   Dihitung: potongan per lembar 2440 × 1220 (kerf 5 mm), lembar, waste %,
   sisa lembar terakhir dipakai ulang bila waste > 25 % (+5 % handling).
4. **HARDWARE & BOUGHT-IN** (15 baris) — kode item master, vendor, qty,
   satuan, harga bila diketahui. Kaca, LED, kain, busa, jasa bubut/laser/
   powder coat masuk di sini, **masih harga BOM lama**.

**Aturan tier kayu (T1, revisi 30 Sep):** D bila volume < 0,0005 m³ dan
sisi terpanjang < 300 mm; C bila tidak terekspos; A-CURVED bila lengkung/
bubut; B bila penampang ≤ 40 × 40 mm dan panjang ≤ 1500 mm; A bila
terekspos lurus ≥ 1000 mm; selain itu B.

**Rate tier per m³ komponen** = (harga log + processing 0,6 jt/m³) × faktor
rendemen + upah tukang per m³. Rendemen: A 3,5 · A-CURVED 4,6 · B 2,5 ·
C 2,0 · D 1,5 · meranti 1,5. Harga log **tersirat dari ledger** (jati 10,9 jt,
mindi 3,1 jt/m³; status CONFIRM). Upah tukang 7,47 jt/m³ = pool payroll
tukang Mar–Sep (270 jt, dikurangi 10 % pemotongan panel) ÷ 32,56 m³
komponen STMV. Hasil: TEAK_A 47,7 jt · TEAK_B 36,2 jt · TEAK_C 30,5 jt ·
MINDI_A 20,4 jt · MINDI_B 16,7 jt · MERANTI 20,2 jt per m³.

**Ringkasan 18 baris per item (semua turunan):** TIMBER (Σ m³ × rate tier) ·
FASTENERS (m³ kayu × 1,75 jt) · PANELS (lembar × harga lembar) · empat baris
finishing per m² terekspos (**FIN_MAT 38.845 · SAND_MAT 12.795 · SAND_LAB
39.477 · FIN_LAB 88.755 = 179.871/m²**, semuanya pool ledger/payroll STMV ÷
2.166 m²) · HARDWARE (Σ baris bought-in) · PACKING (m² karton × 42.000 + m³
× 100.000) · DIRECT · **MISC 5 %** · **OVERHEAD 13,0 %** (payroll overhead +
utilitas ÷ direct STMV) · UNIT COST · × project qty.

**Sifatnya:** satu tabel RATES ("ubah sel biru, semua ikut"), formula
CHECK di tiap baris, tab *cmp* yang menaruh BOM lama dan estimasi baru
berdampingan dengan alasan tiap selisih, dan angka pembanding "aktual
teralokasi" dari rekonsiliasi 23 Sep (pro-rata, indikatif).

**Yang masih terbuka di PLV sendiri (dari tab SUMMARY):** luas finishing
dihitung **satu muka per komponen** — seluruh muka memberi unit cost +25 %
sampai +77 % (soal terbesar); rendemen A/B/D masih *judgement*; harga log
jati tersirat vs harga nota; belum ada ambang lebar untuk "papan lebar"
(A-CURVED); hardware masih harga lama; bubut luar bisa dobel dengan upah di
rate tier.

## 2. Cara kerja modul BOM OPS hari ini

**Rekaman:** `products` (kode permanen, L/W/H mm, gambar kerja + gambar
jadi), `bom_revisions` (draft / released, satu draft per produk, rilis butuh
catatan dan membekukan rate, `miscalc_percent`), `bom_components` (kind
`material | product | labour`, `part` = komponen, `ref_code`, **qty per unit
dalam satuan rate**, `uom`, `waste_percent` 0–90, `rate_code`, `unit_rate` +
`rate_source`), `bom_rates` (`RT-nnnn`, grup kayu / material / finishing /
labour / packing / lain, rate flat per satuan, tanpa riwayat), `bom_norms`
(28 di produksi: susut, rendemen, cakupan, *Kontingensi 5 %*, *Overhead
pabrik 17 %*, *Total finishing material NC natural all-in 96.300/m²*),
`finishing_recipes` (13 langkah → `v_finishing_system` → calon rate
finishing per m²).

**Biaya:** `Σ round(qty × (1 + waste %) × rate)` per baris → material +
labour = subtotal → + miskalkulasi % = **production cost**; null bila ada
baris tanpa rate (tidak pernah dianggap nol). Sub-rakitan berlapis, waste
berlipat, siklus ditolak.

**Alur:** AI membaca gambar kerja → usulan baris dengan `rate_code` dari
daftar dan susut dari norma (tidak menulis apa pun) → estimator centang/edit →
rilis → **quotation** membaca production cost rilisan dan menerapkan
marketing % + overhead % + margin % (harga jual IDR, dibekukan saat kirim)
→ order → **Job Order** menyematkan revisi → ledakan kebutuhan → **PR draft**
dengan `source_wo_no` → proyeksi vs diminta / disetujui / dibayar → **stok**
diusulkan oleh BOM, dikeluarkan oleh gudang, selisih per JO setelah selesai.

**Status produksi:** `0182` (komponen, rate, AI) sudah di produksi; daftar
rate **kosong**; `0193` (baca norma & resep) **belum diterapkan**, jadi AI di
produksi belum memakai norma.

## 3. Perbandingan

| Aspek | PLV BOM (Sheets) | OPS (`ops_prod`) |
|---|---|---|
| Satuan input kayu | **L × W × T mm × qty** per komponen; m³ dan m² muka dihitung | qty dalam m³ diketik (atau diusulkan AI); tidak ada kolom dimensi per baris |
| Rate kayu | **Per spesies × tier** (A/A-CURVED/B/C/D), tier otomatis dari ukuran, terekspos, lengkung | Satu rate per nama (mis. "mindi grade A"), dipilih tangan; grup `kayu` tanpa konsep tier |
| Rendemen / susut | Faktor rendemen **di dalam rate tier** (3,5 / 2,5 / 2,0 / 1,5) | `waste_percent` per baris dari `bom_norms` (15 % decision vs 25 % industry, Q-D338a belum diputus) |
| Upah tukang | Di dalam rate tier, **per m³ komponen**, dari pool payroll | Baris `labour` hari/jam × rate; awalnya diketik (D239) |
| Finishing | **Empat baris turunan per m² terekspos** (material, amplas, upah amplas, upah finishing); m² = muka terbesar tiap komponen terekspos | Satu rate `finishing` per m² (dari resep), **m² diketik / diusulkan AI**; upah finishing baris labour terpisah |
| Panel | **Nesting** ke lembar 2440 × 1220, kerf, waste %, sisa dipakai ulang | Lembar diketik |
| Paku/sekrup/lem | Turunan: m³ kayu × 1,75 jt | Baris manual bila diingat |
| Packing | Turunan dari ukuran keseluruhan + 40 mm (atau kotak flatpack) × 42.000/m² + 100.000/m³ | Baris manual (grup `packing`) |
| Misc / overhead | **Misc 5 % + overhead 13 %** (dari data STMV) | Satu `miscalc_percent`; norma menyimpan *Kontingensi 5 %* dan *Overhead 17 %* — **berbeda dari kartu** |
| Kalibrasi rate | Rate card **diturunkan dari ledger + payroll** STMV (pool ÷ m³ / m², versi `rates_version`) | Rate diketik tangan; tidak ada yang menurunkan rate dari aktual |
| Versi | Snapshot RATES per workbook; item tab tidak berversi | **Draft / rilis per produk**, rate dibekukan saat rilis, JO menyemat revisi, diff draft |
| Hubungan ke pembelian / stok / JO | Tidak ada | PR dari BOM, proyeksi vs PR, stok keluar vs BOM, jejak per JO |
| Harga jual | Template v2 berhenti di unit cost; format lama punya USD/FOB/landed/margin | Quotation IDR: marketing + overhead + margin, dibekukan saat kirim |
| Bought-in / hardware | Blok dengan kode item master, harga lama | Dari `ops_procure.items` (standar / terakhir) atau rate |
| Validasi | Sel CHECK (`material?`, `exposed Y/N?`, `T must match panel type`) | Penolakan di seam (qty > 0, rate dikenal, rilis menolak baris tanpa harga, siklus) |
| AI dari gambar | Tidak ada | Ada (rate + norma, tanpa harga dari model) |
| Multi-pengguna, izin, audit | Tidak ada | RLS, `production.update`, audit |
| Pembanding aktual | "Aktual teralokasi" pro-rata dari ledger (indikatif) | Per JO: material diminta/disetujui/dibayar dan dikeluarkan; jam kerja per item (D351/D352) — belum dirangkum ke biaya per unit |

**Kesimpulan perbandingan.** Keduanya bukan pesaing di lapisan yang sama.
PLV BOM adalah **metode estimasi** (aturan tier, rate turunan dari aktual,
baris turunan) yang sudah diuji ke 12 item dan mendekati aktual (94 %).
OPS adalah **sistem rekam** (versi, izin, JO, PR, stok, quotation, AI) dengan
mesin biaya yang masih generik (qty × rate + susut + miskalkulasi). Mesin
biaya OPS **tidak bisa mereproduksi angka PLV** hari ini: tidak ada dimensi
per baris, tidak ada tier, tidak ada m² terekspos, nesting, packing dan
overhead sebagai turunan. Sebaliknya, Sheets PLV tidak bisa menjadi
sistem: satu tab per item, tidak berversi, tidak terhubung ke pembelian dan
stok, tidak ada izin.

Yang **lebih baik** bukan salah satu. Metode PLV lebih baik sebagai cara
menghitung; OPS lebih baik sebagai tempat menyimpan dan mengalirkan.
Rekomendasi: **adopsi metode PLV sebagai mesin biaya di dalam OPS**, jangan
pindahkan estimasi ke Sheets.

## 4. Cara mengadopsi — bertahap

### Tahap 0 — tanpa kode, bisa hari ini

1. Terapkan `0193` ke produksi (menunggu owner) supaya AI memakai norma.
2. Isi `/produksi/rate` dari tab RATES 29 Sep: `TEAK_A..D`, `TEAK_AC`,
   `MINDI_A..D`, `MINDI_AC`, `MERANTI` (grup kayu, per m³); `FASTENERS`
   (per m³); `FIN_MAT`, `SAND_MAT`, `SAND_LAB`, `FIN_LAB` (finishing / labour,
   per m²); `CARTON_M2`, `PACK_LAB`, `GRP_A` (packing); `PLY-3..24-RAW`
   (per lembar). Nama rate memuat tier supaya AI bisa memilihnya.
3. Tambahkan konstanta aturan ke `bom_norms` (kategori `PLV`): ambang tier
   (1000 / 300 / 0,0005 / 40 × 40 / 1500), lembar 2440 × 1220 kerf 5,
   karton +40 mm, `MISC_PCT 5 %`, `OH_PCT 13 %`, `WASTE_REUSE_MIN 25 %`.
   Sekaligus putuskan nasib *Kontingensi 5 %* dan *Overhead pabrik 17 %* yang
   sudah ada — dua pasang angka tidak boleh berlaku bersamaan.
4. Hasil: estimator memasukkan m³ per komponen dan memilih rate tier sendiri;
   biaya OPS memakai angka yang sama dengan stack test. Keterbatasan: tier,
   m² finishing, lembar panel dan packing masih diketik.

### Tahap 1 — mesin biaya PLV di `ops_prod` (2–3 sesi)

- **Dimensi per baris:** `bom_components` + `length_mm`, `width_mm`,
  `thickness_mm`, `pieces`, `exposed`, `curved`, `tier_override`,
  `exposed_faces` (panel). `qty` menjadi turunan (m³ atau m²) bila dimensi
  ada; tetap bisa diketik bila tidak.
- **Tier otomatis:** fungsi `bom_tier(l, w, t, exposed, curved)` yang membaca
  ambang dari `bom_norms`; rate kayu di `bom_rates` mendapat `species` +
  `tier`, dipilih otomatis dari baris.
- **Baris turunan ("system lines") di `v_product_cost`:** fasteners
  (Σ m³ × rate), empat baris finishing (Σ m² terekspos × rate), packing
  (dari L/W/H produk + 40 mm, atau kotak flatpack), panel nesting
  (lembar dari L × W × qty, kerf, sisa dipakai ulang). Tidak disimpan —
  dihitung saat dibaca, sesuai D149; rilis membekukan rate-nya seperti
  sekarang.
- **Misc + overhead** dua persen dari norma menggantikan satu
  `miscalc_percent`.
- **Hardware / bought-in** tetap baris manual dari `ops_procure.items` —
  blok HARDWARE PLV sudah identik dengan yang ada.
- **Layar:** tabel BOM memuat kolom L × W × T · qty · terekspos · lengkung ·
  tier; ringkasan 18 baris seperti template; kolom **CHECK** menjadi
  penolakan di seam. Demo dan live harus sama (`src/demo/api/production.ts`).
- **AI:** prompt sudah meminta pieces × L × W × T; cukup mengembalikan
  dimensi, bukan m³, sehingga tier dihitung sistem, bukan model.

### Tahap 2 — rate card yang bisa diturunkan ulang (1–2 sesi)

- `bom_rates` berversi (`rates_version` / `effective_on`) supaya
  "ubah sel biru, semua ikut" menjadi "draft mengikuti kartu terbaru,
  rilisan membeku" — sudah setengah ada.
- Layar **turunan kartu**: input (harga log, processing, pool payroll per
  kategori, m³ komponen, m² finishing, overhead) → rate tier, per m³, per m².
  Payroll sudah ada di OPS (D340, D353), jam per item ada (D351/D352), jadi
  pool-nya bisa dibaca dari sistem, bukan dari 30 lembar Sheets.

### Tahap 3 — kalibrasi berkelanjutan

Aktual per JO (material keluar, jam per item, upah) dirangkum ke biaya per
unit → menggantikan "aktual teralokasi pro-rata" → kartu diturunkan ulang
per periode. Ini yang tidak akan pernah bisa dilakukan Sheets.

### Tentang `TALA_BOM_Dataset_ops_aligned` (24 Sep)

Ini keluaran yang lain dari proyek yang sama: harga nota → items dan
`BOM_RATE_REF`. Layak diimpor ke `ops_procure.items` (sudah berbentuk
UPSERT), tetapi angkanya **bertabrakan** dengan kartu 29 Sep: jati balok
8,8 jt/m³ (penawaran vendor) lawan log jati 10,9 jt/m³ (tersirat dari ledger),
mindi 2,7–3,0 jt lawan 3,1 jt. Owner memilih dasar mana; kartu sendiri
menandai keduanya CONFIRM.

## 5. Keputusan yang dibutuhkan dari owner

1. Luas finishing: satu muka per komponen atau seluruh muka (+25–77 %).
2. Rendemen A 3,5 / B 2,5 / D 1,5 (judgement) — dan menjawab Q-D338a
   (susut 15 % vs 25 %) dengan satu jawaban yang sama.
3. Harga log jati: 10,9 jt tersirat atau harga nota; sumber harga mindi.
4. Misc 5 % + overhead 13 % menggantikan misc 20 % dan norma *Overhead 17 %*.
5. Ambang lebar "papan lebar" untuk A-CURVED.
6. Hardware / bought-in: tetap harga lama atau dari katalog items.
7. D239 (upah diketik) secara efektif digantikan upah per m³ / m² dari
   payroll — perlu ditegaskan sebagai keputusan.
8. Siapa yang mengelola daftar rate: produksi atau procurement (default D324).

Sampai keputusan 1–4 ada, Tahap 0 sudah bisa dijalankan dengan angka kartu
apa adanya, karena rilisan membekukan rate dan draft mengikuti perubahan.
