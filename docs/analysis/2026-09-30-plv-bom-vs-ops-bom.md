# PLV BOM (proyek Claude) vs modul BOM ops.talaliving — kajian 30 Sep 2026

Kajian, bukan keputusan. Tidak ada D-number yang lahir dari dokumen ini;
yang diputuskan owner setelah membacanya dicatat di `docs/plan/06-decisions.md`.
Bagian 3 (validasi database produksi) ditambahkan sore harinya dan
**mengoreksi** dua pernyataan versi pagi: daftar rate di produksi tidak
kosong, dan `0193` sudah diterapkan (F205).

## 0. Apa yang bisa dibaca, apa yang tidak

Proyek claude.ai bernama **PLV BOM** tidak bisa dibuka dari sesi ini (Claude
Code tidak punya akses ke Projects claude.ai). Yang dibaca adalah **berkas
keluarannya di shared drive** (`shared@talaliving.com`) dan folder
`PLV BOM` milik `evin1oshima@gmail.com`:

| Berkas | Tanggal | Isi |
|---|---|---|
| `PLV BOM` / `PLV BOM 27 SEPT 26` | 27 Sep | Salinan format costing lama (tab `PL 085`, `PL 086`, `PL 08 7`): per komponen L × W × H → m² flat, m² 3D, m³, RATE, lalu kolom USD, MARKUP, FOB, LOADING, SHIPPING, LANDED, VAT+CUSTOMS 22 %, PHP, GROSS MARGIN. Ini keluarga "BOM lama" (`REVISI BOM 21 MEI 26` untuk STMV) |
| `STMV_BOM_vs_Actual_Reconciliation 23 sept` | 23 Sep | Budget (BOM REVISI 21 MEI 26 × qty) vs aktual ledger 1 Jan–21 Sep: proyek **137 %** dari budget; upah produksi 355 %, hardware 328 %, upholstery 198 %, mindi 191 %; overhead pabrik 175 % dari "misc 20 %" |
| `TALA_BOM_Dataset_ops_aligned`, `TALA_Item_Master_DB`, `TALA_Master_Price_Catalogue` | 24 Sep | Harga dari nota → `ops_procure.items` (137 UPDATE, 104 INSERT), 379 rate per vendor, 692 observasi harga, dan **`BOM_RATE_REF`: 83 rate rekomendasi untuk `ops_prod.bom_components.unit_rate` + `rate_source`** (mis. `KY-JTI-A` 8,8 jt/m³, `KY-MND-S` 2,7 jt/m³, `PL-18PU` 250 rb/lembar, `KC-POL` 270 rb/m²) |
| `PLV Labour Rate Card - Daily Worker Payroll Mar-Sep 2026` | 29 Sep | 30 lembar payroll mingguan → rate per kategori: tukang 20.300/jam, sanding 12.400, finishing 20.600, PU 13.100, gerinda 13.500, sample maker 26.100 (loaded, + uplift tak langsung 9,95 %) |
| *PLV BOM Rate Card and Rule Spec 29Sep26* | 29 Sep | Dokumen spesifikasinya sendiri **tidak ada di Drive** (ada di knowledge proyek Claude); yang terbaca adalah *snapshot*-nya di tab `RATES` stack test (`rates_version 2026-09-29`) |
| `PLV_BOM_Stack_Test_OV-505B_ID-OV-506_30Sep26_v2` | 30 Sep | Uji 2 item: template v2 + rate card, dibanding baris per baris dengan BOM lama dan alasan tiap selisih |
| `PLV_BOM_Stack_Test_12_Items_30Sep26` | 30 Sep | Uji 12 item STMV (1.435 pcs): total **+29 %** dari BOM lama; estimasi baru = **94 %** dari aktual teralokasi |

Sisi OPS dibaca dari kode dan migrasi (`0060`, `0061`, `0065`, `0066`,
`0108`–`0111`, `0130`, `0133`, `0174`, `0182`, `0193`), layar
`/produksi/bom`, `/produksi/rate`, Job Order, quotation,
`docs/plan/06-decisions.md` (D149–D151, D237–D240, D256, D257, D266, D324,
D338, Q-D338a), dan **database produksi** (hanya baca, 30 Sep sore).

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
(28: susut, rendemen, cakupan, *Kontingensi 5 %*, *Overhead pabrik 17 %*,
*Total finishing material NC natural all-in 96.300/m²*), `finishing_recipes`
(13 langkah → `v_finishing_system` → calon rate finishing per m²).

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

## 3. Validasi database produksi (dibaca langsung, 30 Sep sore)

Semua di bawah ini dibaca dari Supabase produksi dengan query baca saja.

### 3.1 Apa yang ada

| Objek | Isi | Catatan |
|---|---|---|
| `ops_prod.bom_rates` | **84 rate aktif**, semua dibuat 29 Sep: kayu 11 (8 tertaut item), material 37, finishing 9, labour 6, packing 12, lain 9 | 75 dari `BOM_RATE_REF` (24 Sep; 8 dilewati: `KY-MRT-P` lemah, `PR-ANG`, `KC-ECR`, `TK-HRI`, `TK-MGG`, `TK-LBR`, `JS-CNC`, `JS-AMP`), 3 dari resep finishing (RT-0067–0069), 6 dari labour rate card per jam (RT-0070–0075). README D324 masih bilang "kosong" |
| `ops_prod.bom_norms` | 28 | Seperti D338 |
| `ops_prod.finishing_recipes` | 13 langkah, 2 sistem (NC natural, PU/duco Zhanchen) | Seperti D338 |
| `0193` | **Sudah diterapkan** 29 Sep (`20260929091210`); policy baca ada, `v_bom_norm` ada | README D338 masih bilang "belum" |
| `ops_prod.products` | 27, termasuk **ke-12 item stack test** | Ukuran cocok dengan kepala template (AA-02 800×800×45, ID-OV-506 1165×291×407); OV-505 B 1180×530×468 di OPS vs 1200×550×438 di template |
| BOM | **1 draft** (AA-07A), 1 baris: mindi 0,026 m³ @ 6,75 jt manual (harga flat BOM lama), tanpa `rate_code`; 0 rilisan; `used_by` semua rate = 0 | Daftar rate ada, belum ada BOM yang memakainya |
| `ops_procure.items` | 1.520; `item_master_staging` 592; `item_vendor_prices` 820 | Dataset 24 Sep sudah masuk |

### 3.2 Rate kayu: satuan sama, dasar berbeda

| | DB (29 Sep, dari nota/vendor) | PLV RATES (29 Sep, dari ledger) |
|---|---|---|
| Log jati | RT-0004 **4,5 jt**/m³ (Razka 2025); item I-01171 4,48 jt | `log_teak` **10,9 jt**/m³ (152,3 jt ÷ 14 m³; "CONFIRM — ganti harga nota") |
| Log mindi | RT-0005 3,0 jt / RT-0006 2,7 jt; item 3,05 / 2,59 jt | `log_mindi` 3,1 jt (126,1 jt ÷ 41 m³) |
| Balok/square jati | RT-0001 8,8 jt (A, ≥ 30 cm), RT-0002 7,0 jt (B), RT-0003 siap potong 7,77 jt | tidak ada; PLV mulai dari log |
| Processing per m³ | RT-0009 + 0010 + 0011 = **765 rb**; norma *Kiln + sawmill + handling* 700 rb | **599 rb** (ledger ÷ 75,82 m³) |
| Meranti | RT-0008 kusen 159 rb/pcs (dari 8,5 jt/m³) | `meranti_sawn` 8,5 jt/m³ |
| Rendemen | norma: log→square 55 %, square→komponen 80 % (gabungan × 2,27) | per tier: A 3,5 · A-CURVED 4,6 · B 2,5 · C 2,0 · D 1,5 · meranti 1,5 |
| Upah tukang | RT-0071 **20.300/jam** (butuh jam per item) | `LAB_CARP` **7,47 jt per m³ komponen** (pool 270 jt ÷ 32,56 m³) |
| Rate jadi per m³ komponen | tidak ada — estimator mengalikan sendiri | TEAK_A 47,7 · B 36,2 · C 30,5 · D 24,7 · MINDI_A 20,4 · B 16,7 · C 14,9 · MERANTI 20,2 jt |

Cek ulang TEAK_B dari komponennya: (10,9 + 0,599) × 2,5 + 7,468 = 36,215 jt,
sama dengan tab RATES. Dengan angka DB: (4,5 + 0,765) × 2,5 + 7,468 =
**20,6 jt**; dari balok B: 7,0 × 1,25 + 7,468 = **16,2 jt**. BOM lama: flat
30 jt. Jadi komponen jati yang sama bisa 16–36 jt per m³ tergantung dasar
yang dipilih, dan **harga log jati (10,9 vs 4,5 jt, 2,4×) adalah soal nomor
satu**. Harga tersirat PLV kemungkinan mencampur pembelian balok (7–8,8 jt)
ke dalam m³ "log"; tab RATES sendiri memintanya diganti harga nota.

Bahaya praktis: DB memuat harga **per m³ log** (RT-0004–0006), **per m³
balok** (RT-0001–0002) dan **siap potong** (RT-0003, 0007) di satu daftar,
tanpa menyebut rendemen mana yang masih harus diterapkan. Rate tier PLV
sudah memuat rendemannya. Bila keduanya masuk satu daftar tanpa tanda,
estimator akan mengalikan rendemen dua kali atau tidak sama sekali. Nama
rate (sekarang) atau kolom `basis` (nanti) harus menyebut dasarnya.

### 3.3 Panel per lembar 2440 × 1220

| Tebal | DB (riwayat nota 2025–26) | PLV RAW (daftar Mojo Indah Sep 2026) | Selisih |
|---|---|---|---|
| 3 mm | RT-0017 palm 62.500 | 77.500 | +24 % |
| 6 mm | RT-0016 semi meranti 95.000 | 115.000 | +21 % |
| 9 mm | RT-0015 semi 150.000 | 172.500 | +15 % |
| 12 mm | RT-0014 tunas 185.000 | 215.000 | +16 % |
| 15 mm | RT-0018 MDF 272.500 | 260.000 (plywood) | beda bahan |
| 18 mm | RT-0012 palm 250.000 / RT-0013 semi meranti 227.000 | 295.000 | +18–30 % |
| 24 mm | — | 375.000 (ekstrapolasi) | — |

PLV LISTS mendaftar 35 tipe panel (RAW/MSF/MDF/TSF/TDF × 7 tebal) tetapi
hanya RAW yang berharga. DB tidak punya nesting, kerf, atau aturan sisa.

### 3.4 Finishing per m²: lima angka untuk hal yang hampir sama

| Sumber | IDR/m² | Dasar |
|---|---|---|
| DB RT-0061 NC natural standar (bahan + upah) | 140.000 | BOM lama |
| DB RT-0062 bidang kecil / banyak sudut | 300.000 | BOM lama AA-02/AA-03 |
| DB norma *Total finishing material NC all-in* | 96.300 | 156,5 jt ÷ 1.624 m² (termasuk WA-250, amplas, dempul) |
| DB RT-0067 resep Zhanchen tanpa bleach | 59.918 | cakupan teoretis per langkah |
| PLV `FIN_MAT` + `SAND_MAT` (bahan) | **51.640** | (84,1 + 27,7 jt) ÷ 2.166 m² |
| PLV `SAND_LAB` + `FIN_LAB` (upah) | **128.232** | (131,6 jt × 65 % + 192,2 jt) ÷ 2.166 m² |
| PLV all-in empat baris | **179.871** | |
| DB norma *Finishing throughput* → upah | 12.500 | 8 m²/man-day × 100 rb (industri) |

Pembilang berbeda (156,5 jt vs 111,9 jt) dan penyebut berbeda (1.624 vs
2.166 m²), padahal keduanya "aktual STMV". Upah finishing: norma 12.500 vs
PLV 88.755, tujuh kali lipat. Satu definisi luas dan satu definisi pool
harus dipilih sebelum salah satunya masuk daftar rate.

### 3.5 Misc dan overhead

| | Angka | Pembilang |
|---|---|---|
| DB norma *Overhead pabrik* | 17 % dari direct | 410 jt (listrik, mesin, kendaraan, logistik, gedung, air, consumables — rekonsiliasi bagian B) ÷ 2,37 M |
| PLV `OH_PCT` | 13,0 % dari (direct + misc) | 308,6 jt (payroll overhead 213,6 + utilitas 144,6 − PLN 49,7) ÷ 2.374,8 jt |
| Misc | DB norma 5 % = PLV `MISC_PCT` 5 % | cocok; DB juga menyimpan *MISC BOM lama 20 %* sebagai pembanding |

Kedua pembilang bukan subset satu sama lain: PLV memasukkan payroll tak
langsung (tidak ada di 410 jt) dan mengeluarkan mesin, kendaraan, logistik,
gedung. Perlu satu definisi overhead.

### 3.6 Upah, fasteners, packing

- **Upah per jam** di DB (RT-0070–0075: 26.100 / 20.300 / 12.400 / 20.600 /
  13.100 / 13.500) **identik** dengan labour rate card. PLV memakai pool yang
  sama tetapi per m³ komponen dan per m² terekspos. Dua bentuk dari satu
  payroll: per jam butuh jam per item (sekarang ada, D351/D352), per m³
  hanya butuh geometri.
- Cross-check norma *Direct labour 2,4 man-day/unit (lounge chair ±4)*:
  SG-01A di PLV = tukang 169.201 ÷ 162.400/hari ≈ 1,0 hari + amplas dan
  finishing 108.388 ÷ ≈130 rb ≈ 0,8 hari ≈ **1,9 man-day**, jauh di bawah ±4.
  Salah satunya perlu diperiksa dengan timeslot JO.
- **Fasteners:** PLV 1,75 jt per m³ kayu (57 jt ÷ 32,56 m³); DB sekrup per
  pcs (660 / 860 / 3.150) + norma 1 sekrup per 100 mm.
- **Packing:** PLV 42 rb/m² 6 sisi + 100 rb/m³ + 24 rb grup A; DB harga
  bahan (single face 9.200/kg, box per ukuran 11.900–96.700, wrap,
  styrofoam) + borongan 17.500/pcs. Box cermin kecil 83 × 83 × 6,5 cm:
  PLV 1,59 m² × 42 rb + 4,5 rb ≈ 71 rb vs DB box 37,8 rb (PLV memuat
  consumables).

### 3.7 Siapa lebih lengkap

Bukan "PLV lebih lengkap", melainkan **lapisan berbeda**:

- **Ada di DB, tidak ada di PLV:** kain (4), busa (4), logam (6), hardware
  (10), kaca (2), jasa anyam/jok (8), bubut, box per ukuran, LED, webbing.
  Di PLV semua ini "bought-in, harga BOM lama".
- **Ada di PLV, tidak ada di DB:** 11 rate tier per m³ komponen,
  `FASTENERS` per m³, empat rate finishing dari aktual, `CARTON_M2` /
  `PACK_LAB` / `GRP_A`, `OH_PCT` 13 %, dan 13 ambang aturan (`TIER_A_MIN_LEN`
  1000, `TIER_D_MAX_VOL` 0,0005, `TIER_D_MAX_LEN` 300, `NARROW_MAX_SECTION`
  40, `NARROW_MAX_LEN` 1500, `SHEET` 2440 × 1220, `SHEET_KERF` 5,
  `CARTON_ADD` 40, `CARTON_MIN_M2` 0,15, `WASTE_REUSE_MIN` 25 %,
  `OFFCUT_HANDLING` 5 %, `KD_PACK_FACTOR` 0, `USD_IDR` 16.000).

**Kesimpulan validasi.** Database "sudah disiapkan" untuk **harga beli**
(84 rate dari nota, item, vendor) dan untuk **norma** (28). Belum
disiapkan untuk **metode PLV**: tidak ada rate per m³ komponen, tidak ada
ambang tier, dan tiga angka yang PLV turunkan dari aktual (finishing,
overhead, upah per m³) bertabrakan dengan norma yang sudah ada.

## 4. Perbandingan cara kerja

| Aspek | PLV BOM (Sheets) | OPS (`ops_prod`) |
|---|---|---|
| Satuan input kayu | **L × W × T mm × qty** per komponen; m³ dan m² muka dihitung | qty dalam m³ diketik (atau diusulkan AI); tidak ada kolom dimensi per baris |
| Rate kayu | **Per spesies × tier** (A/A-CURVED/B/C/D), tier otomatis dari ukuran, terekspos, lengkung; rendemen dan upah di dalam rate | Per m³ log / balok / siap potong yang dibeli, dipilih tangan; rendemen di `waste_percent`, upah baris terpisah |
| Rendemen / susut | Faktor rendemen **di dalam rate tier** (3,5 / 2,5 / 2,0 / 1,5) | `waste_percent` per baris dari `bom_norms` (15 % decision vs 25 % industry, Q-D338a belum diputus) |
| Upah tukang | Di dalam rate tier, **per m³ komponen**, dari pool payroll | Baris `labour` jam × rate per jam dari payroll yang sama |
| Finishing | **Empat baris turunan per m² terekspos** (bahan, amplas, upah amplas, upah finishing); m² = muka terbesar tiap komponen terekspos | Rate `finishing` per m² (BOM lama 140 rb, atau resep 59.918), **m² diketik / diusulkan AI**; upah finishing baris labour terpisah |
| Panel | **Nesting** ke lembar 2440 × 1220, kerf, waste %, sisa dipakai ulang | Lembar diketik |
| Paku/sekrup/lem | Turunan: m³ kayu × 1,75 jt | Baris manual per pcs bila diingat |
| Packing | Turunan dari ukuran keseluruhan + 40 mm (atau kotak flatpack) × 42.000/m² + 100.000/m³ | Baris manual (grup `packing`) |
| Misc / overhead | **Misc 5 % + overhead 13 %** (dari data STMV) | Satu `miscalc_percent`; norma menyimpan *Kontingensi 5 %* dan *Overhead 17 %* |
| Kalibrasi rate | Rate card **diturunkan dari ledger + payroll** STMV (pool ÷ m³ / m², versi `rates_version`) | Rate diketik dari nota; tidak ada yang menurunkan rate dari aktual |
| Versi | Snapshot RATES per workbook; item tab tidak berversi | **Draft / rilis per produk**, rate dibekukan saat rilis, JO menyemat revisi, diff draft |
| Hubungan ke pembelian / stok / JO | Tidak ada | PR dari BOM, proyeksi vs PR, stok keluar vs BOM, jejak per JO |
| Harga jual | Template v2 berhenti di unit cost; format lama punya USD/FOB/landed/margin | Quotation IDR: marketing + overhead + margin, dibekukan saat kirim |
| Bought-in / hardware | Blok dengan kode item master, harga lama | Dari `ops_procure.items` (standar / terakhir) atau 40-an rate beli |
| Validasi | Sel CHECK (`material?`, `exposed Y/N?`, `T must match panel type`) | Penolakan di seam (qty > 0, rate dikenal, rilis menolak baris tanpa harga, siklus) |
| AI dari gambar | Tidak ada | Ada (rate + norma, tanpa harga dari model) |
| Multi-pengguna, izin, audit | Tidak ada | RLS, `production.update`, audit |
| Pembanding aktual | "Aktual teralokasi" pro-rata dari ledger (indikatif) | Per JO: material diminta/disetujui/dibayar dan dikeluarkan; jam kerja per item (D351/D352) — belum dirangkum ke biaya per unit |

**Kesimpulan perbandingan.** Keduanya bukan pesaing di lapisan yang sama.
PLV BOM adalah **metode estimasi** (aturan tier, rate turunan dari aktual,
baris turunan) yang sudah diuji ke 12 item dan mendekati aktual (94 %).
OPS adalah **sistem rekam** (versi, izin, JO, PR, stok, quotation, AI) dengan
mesin biaya yang masih generik (qty × rate + susut + miskalkulasi) dan
daftar harga beli yang lebih luas. Mesin biaya OPS **tidak bisa
mereproduksi angka PLV dari gambar** hari ini: tidak ada dimensi per baris,
tidak ada tier, tidak ada m² terekspos, nesting, packing dan overhead
sebagai turunan. Tetapi bila m³, m², lembar dan karton **diketik**, OPS
sudah bisa menghasilkan angka yang sama (lihat Tahap 0 nomor 5).
Sebaliknya, Sheets PLV tidak bisa menjadi sistem: satu tab per item, tidak
berversi, tidak terhubung ke pembelian dan stok, tidak ada izin.

Yang **lebih baik** bukan salah satu. Metode PLV lebih baik sebagai cara
menghitung; OPS lebih baik sebagai tempat menyimpan dan mengalirkan.
Rekomendasi: **adopsi metode PLV sebagai mesin biaya di dalam OPS**, jangan
pindahkan estimasi ke Sheets.

## 5. Cara mengadopsi — bertahap

### Tahap 0 — tanpa kode, bisa hari ini

1. `0193` sudah di produksi; AI di produksi sudah membaca norma.
2. **Tambahkan** (jangan ganti) rate PLV ke `/produksi/rate`, dengan dasar
   di namanya: 11 rate tier *"Jati tier B — per m³ komponen (rendemen +
   upah tukang di dalam)"* dst., `FASTENERS` per m³ kayu, empat rate
   finishing per m² terekspos (bahan, amplas, upah amplas, upah
   finishing), `CARTON_M2`, `PACK_LAB`, `GRP_A`, dan plywood RAW 3–24 mm
   Mojo Indah bila dipilih atas riwayat nota. Catatan tiap rate:
   `rates_version 2026-09-29` dan rumusnya.
3. Tambahkan 13 ambang aturan PLV ke `bom_norms` (kategori `PLV`). Untuk
   tiga angka yang bertabrakan — overhead 17 % vs 13 %, upah finishing
   12.500 vs 88.755, bahan finishing 96.300 vs 51.640 — hanya satu yang
   boleh `decision`; yang lain diturunkan ke `empirical` dengan catatan.
4. Beri catatan pada RT-0001–0007 (dasar: log / balok / siap potong, dan
   rendemen mana yang masih harus dikalikan) supaya tidak terbaca setara
   dengan rate tier.
5. **Uji reproduksi**: masukkan OV-505 B dan ID-OV-506 (produknya sudah
   ada) sebagai BOM di OPS memakai rate tier — m³ per komponen, m² terekspos,
   lembar, dan karton diketik dari template — dengan `miscalc_percent`
   18,64 % (= 1,05 × 1,1299 − 1). Production cost harus keluar 725.983 dan
   766.148. Ini membuktikan mesin biaya OPS bisa membawa angka PLV
   sebelum satu baris kode pun diubah, dan sekaligus mengisi
   `used_by` yang sekarang nol.

### Tahap 1 — mesin biaya PLV di `ops_prod` (2–3 sesi)

- **Dimensi per baris:** `bom_components` + `length_mm`, `width_mm`,
  `thickness_mm`, `pieces`, `exposed`, `curved`, `tier_override`,
  `exposed_faces` (panel). `qty` menjadi turunan (m³ atau m²) bila dimensi
  ada; tetap bisa diketik bila tidak.
- **Tier otomatis:** fungsi `bom_tier(l, w, t, exposed, curved)` yang membaca
  ambang dari `bom_norms`; rate kayu di `bom_rates` mendapat `species`,
  `tier` dan `basis` (log / balok / komponen), dipilih otomatis dari baris.
- **Baris turunan ("system lines") di `v_product_cost`:** fasteners
  (Σ m³ × rate), empat baris finishing (Σ m² terekspos × rate), packing
  (dari L/W/H produk + 40 mm, atau kotak flatpack), panel nesting
  (lembar dari L × W × qty, kerf, sisa dipakai ulang). Tidak disimpan —
  dihitung saat dibaca, sesuai D149; rilis membekukan rate-nya seperti
  sekarang.
- **Misc + overhead** dua persen dari norma menggantikan satu
  `miscalc_percent`.
- **Hardware / bought-in** tetap baris manual dari `ops_procure.items` atau
  40-an rate beli yang sudah ada.
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

## 6. Keputusan yang dibutuhkan dari owner

1. **Harga log jati:** 10,9 jt tersirat (PLV) atau 4,5 jt nota (DB, RT-0004);
   dampaknya 16–36 jt per m³ komponen.
2. **Luas finishing:** satu muka per komponen atau seluruh muka (+25–77 %).
3. **Pool dan penyebut finishing:** 156,5 jt ÷ 1.624 m² (norma) atau
   111,9 jt ÷ 2.166 m² (PLV); upah finishing 12.500 atau 88.755 per m².
4. **Overhead:** 17 % (410 jt, tanpa payroll tak langsung) atau 13 % (308,6 jt,
   tanpa mesin/kendaraan/logistik); satu definisi.
5. **Rendemen:** tier A 3,5 / B 2,5 / D 1,5 (judgement) — dan jawaban Q-D338a
   (susut 15 % vs 25 %) yang konsisten dengannya.
6. Ambang lebar "papan lebar" untuk A-CURVED.
7. Hardware / bought-in: harga lama, atau 40-an rate beli yang sudah di DB.
8. D239 (upah diketik) secara efektif digantikan upah per jam / per m³ dari
   payroll — perlu ditegaskan sebagai keputusan.
9. Siapa yang mengelola daftar rate: produksi atau procurement (default D324).

Sampai keputusan 1–4 ada, Tahap 0 sudah bisa dijalankan dengan angka kartu
apa adanya, karena rilisan membekukan rate dan draft mengikuti perubahan.
