# Proyek sebagai agen: klien → desain → pabrik mitra → QC → purna jual, kajian 10 Okt 2026

> Owner (2026-10-10): *check bagaimana user input project baru — sepertinya
> belum ada. pastikan ada client management, project management (internal —
> yang digunakan untuk desain gambar, bom dan quotation ke client) lalu ada
> project management untuk produksi yang desainnya diterima klient dan kita
> terima order? hubungkan ke modul management production dan QC (baru kita
> rancang — simpan saja di rencana kerja).*
>
> Gambaran umum dari owner:
> 1. Pimpinan memberi instruksi membuat render koleksi ruangan, render item,
>    gambar kerja 3D untuk BOM, dan gambar kerja untuk tim produksi.
> 2. Render, BOM, dan gambar kerja dipakai untuk negosiasi dengan klien
>    **dan** dengan pabrik produksi. TALA menjadi **agen**: TALA mencari
>    order, lalu order itu dikerjakan pabrik di tempat lain.
> 3. Kalau klien setuju dan pabrik sanggup, lanjut ke **pembayaran awal**,
>    lalu produksi.
> 4. Selama produksi ada **tim QC outsource** (bukan karyawan tetap) yang
>    memantau order, dengan skema **1 QC per 5 kontainer**. Dibutuhkan
>    manajemen personel QC, laporan, progres, insiden, dan sebagainya.
> 5. Prosesnya selesai ketika barang sampai di customer. Kalau **tidak ada
>    masalah dalam 3 bulan**, pembayaran tim QC dirilis.
>
> Diminta: rancangan yang mudah, sedikit kerja, tetapi datanya akurat dan
> terekam untuk evaluasi, disesuaikan dengan modul ops yang sudah ada.

Status: **kajian**. O1 dan O2 dikerjakan 10 Okt (O2: D415). Urutan kerja di §7,
pertanyaan untuk owner di §8.

> **Pembaruan 10 Okt: owner mengubah Q89 dan Q91 (D414).** *Q88: default, hanya
> melihat order yang di assign padanya / Q89: manual saja, tidak perlu sistem /
> Q90: ya / Q91: tambahkan USD juga.*
> - Rasio 1 QC per 5 kontainer diatur koordinator sendiri. Sistem tidak menghitung
>   kebutuhan QC dan tidak memperingatkan; `containers_planned` dan *kontainer yang
>   ditanggung* dihapus dari rancangan (§5.4, §5.7).
> - Harga bisa dalam **IDR atau USD**, satu mata uang per dokumen, dengan kurs
>   diketik orang untuk dokumen USD (§5.3).
>
> **Pembaruan 10 Okt: Q81, Q83, Q84, Q88–Q91 memakai default (D413).** Owner:
> *pertanyaannya pakai jawaban default.* Tidak ada sesi yang menunggu jawaban lagi.
>
> **Pembaruan 10 Okt: jawaban owner atas Q82, Q85, Q86, Q87 (D412).**
> *Masalah uang tidak perlu dikaitkan erat ke sistem, cukup status
> pekerjaannya saja: apakah belum selesai, diterima klien, atau tertolak,
> dsb.* Akibatnya untuk kajian ini:
> - DP klien, fee QC, uang muka, dan rilis pembayaran **tidak dicatat dan
>   tidak menahan apa pun** di sistem. O4 dibatalkan, dan kolom fee dihapus
>   dari rancangan QC.
> - Yang dicatat adalah **status hasil kerja** per order pabrik:
>   `berjalan → dikirim → sampai → diterima klien`, atau `ditolak klien`
>   dengan alasan. Klaim klien dicatat sebagai temuan. Masa 3 bulan hanya
>   **pengingat** sejak barang sampai, supaya ada yang menanyakan *diterima
>   atau tidak*.
> - PO tetap dipakai sebagai order pabrik karena di sanalah order disetujui
>   dan didokumentasikan. Pembayaran ke pabrik tetap di tempat procurement
>   dan finance membayarnya sekarang, dan alur agen tidak menunggu status
>   pembayaran apa pun.
>
> Bagian di bawah sudah disesuaikan. Yang dicoret ditandai *(D412)*.

---

## 0. Jawaban singkat

1. **Input proyek baru sudah ada, tetapi letaknya bukan di tempat kerja
   dimulai.**
   - Tombol **Proyek baru** hanya ada di **Proyek › Order** (`/proyek/order`).
     Klien baru bisa dibuat langsung dari formulir itu, atau di **Master Data
     › Klien**.
   - Di **Proyek › Pipeline**, tombol *Inquiry baru* hanya berupa link ke
     halaman Order.
   - Di **Produksi › Design** sama sekali tidak ada tombol proyek. Layar itu
     hanya berkata *proyek dibuka oleh sales di Projects*.
   - Tombolnya hanya muncul untuk akses **proyek** atau **marketing**
     (create). Di produksi ada 7 akun admin proyek dan 5 admin marketing.
   - Proyek 25008 (oleh Ryan Tala, 30 Sep) dan klien LIVINGIKON (oleh
     superadmin, 9 Okt) dibuat lewat jalan ini. 25004–25007 tidak punya
     pembuat, jadi dimuat saat persiapan.

   Perbaikannya kecil (O1): tombol yang sama dipasang di Pipeline dan Design.
2. **Manajemen klien dan proyek internal (desain → BOM → quotation) sudah
   lengkap dan live**, tetapi baru sedikit dipakai: 1 klien, 0 quotation, 0
   item desain di produksi. Bagian ini cukup dirapikan, tidak dibangun ulang.
   - Klien dan log kontak.
   - Pipeline dan status proyek (tidak jadi / batal dengan alasan).
   - Koleksi → ruangan → item desain, enam kotak per item, dan tugas drafter
     yang terpantau di HRD (S1–S2).
   - Link galeri render per koleksi (D407).
   - BOM dari item desain.
   - Quotation dari item desain, berrevisi, bisa dicetak.
   - Order line otomatis saat quotation diterima.
3. **Yang belum ada adalah seluruh sisi "agen".** Ops hari ini menganggap
   produksi dikerjakan di workshop sendiri: Job Order, atau dilempar ke vendor
   per proses (`vendor_legs`). Belum ada:
   - harga pabrik per item;
   - order ke pabrik mitra yang terikat ke proyek;
   - kontainer;
   - QC lapangan dan personelnya;
   - status hasil kerja setelah barang sampai (diterima atau ditolak klien).
4. **Usulan: tetap satu kartu proyek dari inquiry sampai purna jual.**
   Tambahkan **jalur produksi per baris order** (*Workshop sendiri* atau
   *Pabrik mitra*), lalu pakai ulang yang sudah ada:
   - **Pabrik mitra** = vendor berjenis pabrik.
   - **Order pabrik** = PO yang ditautkan ke proyek. Persetujuan pimpinan dan
     dokumen order sudah ada di PO.
   - **Kontainer** = pengiriman (`ops_dlv`) berjenis kontainer.

   Yang benar-benar baru hanya **modul QC** (personel, penugasan, laporan
   harian dari HP, temuan) dan **status hasil kerja** (diterima / ditolak klien,
   dengan pengingat 3 bulan sejak sampai). Semua
   angka diketik sekali oleh orang yang melihatnya:
   - harga pabrik oleh purchasing;
   - jumlah jadi oleh QC di pabrik;
   - nomor kontainer oleh logistik.

   Progres, kebutuhan jumlah QC, tanggal pengingat 3 bulan, dan nilai evaluasi
   dihitung sistem, tidak diketik.
5. Dikerjakan dalam sembilan sesi kecil (O1–O9, §7). **O1 bisa langsung**
   tanpa jawaban apa pun. O2–O9 menunggu beberapa jawaban di §8, tetapi
   semuanya punya default supaya tidak ada yang tertahan.

---

## 1. Proses bisnis

```
 PIMPINAN ──instruksi──▶ DRAFTER                         (tugas desain, S2)
                          │ render koleksi · render item · 3D/DWG untuk BOM · gambar kerja produksi · BOM
                          ▼
 KLIEN ◀── quotation (harga dari BOM / harga pabrik) ──▶ PABRIK MITRA ◀── gambar + BOM, minta harga
   │ setuju                                                   │ sanggup (harga, lead time)
   ▼                                                          ▼
 DEAL (quotation diterima) ───────────────────────────▶ ORDER PABRIK (PO, disetujui pimpinan)
                                                              │
                                    PRODUKSI DI PABRIK ◀──────┤ QC outsource: 1 QC / 5 kontainer
                                    laporan harian · foto · progres per item · temuan/insiden
                                                              │
                                    MUAT KONTAINER (cek muat QC) ─▶ KIRIM (ETD/ETA, B/L)
                                                              │
                                    SAMPAI DI KLIEN ─▶ pengingat 3 bulan ─┬─ DITERIMA KLIEN
                                                                          └─ DITOLAK KLIEN (alasan, klaim)
```

Tiga hal dari gambaran owner yang menentukan bentuk rancangan:

- **TALA tidak memproduksi barang ini.** Produksi dicatat sebagai pekerjaan
  pihak lain yang dipantau, bukan Job Order di workshop.
- **QC adalah orang luar yang dibayar per penugasan, dan pembayarannya
  ditahan.** Mereka tidak bisa masuk ke `ops_hr.employees`, karena payroll,
  absensi, dan BPJS tidak berlaku untuk mereka.
- **Ukuran pekerjaannya kontainer**, bukan item atau truk.

## 2. Cek: bagaimana proyek baru dimasukkan hari ini

| Yang ingin dilakukan | Di mana sekarang | Siapa yang bisa |
|---|---|---|
| Klien baru | **Master Data › Klien** › *Klien baru*, atau *Klien baru* di dalam formulir proyek | akses proyek/marketing *create* (`may_sell`) |
| Proyek baru | **Proyek › Order** › *Proyek baru*: nama, klien, lokasi, PIC, tanggal, nilai kontrak, catatan. Kodenya otomatis (`26001`…), status awal `INQUIRY` | sama |
| Inquiry baru dari Pipeline | Tombol ada, tetapi hanya link ke Proyek › Order | sama |
| Proyek baru dari Design | **Tidak ada.** Layar kosong berkata *proyek dibuka oleh sales di Projects* | — |
| Koleksi / ruangan / item | Produksi › Design (Ruang kerja), juga tab Design di halaman proyek | `may_design` |
| Quotation | Proyek › Quotation › *Quotation baru*, atau dari item desain | `may_sell` |
| Order line | Otomatis saat quotation diterima (`decide_quotation`) | `may_sell` |
| Job Order | Per order line, manual, dari drawer proyek | `production.create` |

Jadi jalannya ada. Yang membuat terasa *belum ada*: layar tempat pimpinan dan
drafter bekerja (Design) tidak punya pintu masuknya, dan Pipeline hanya
memantulkan ke halaman lain.

## 3. Yang sudah ada dan dipakai ulang

| Kebutuhan owner | Yang sudah ada | Live di produksi | Isinya |
|---|---|---|---|
| Daftar klien + kontak | `clients` (0111), log kontak dan meeting (0134, 0224) | ya | 1 klien |
| Proyek dan statusnya | `projects`, status `INQUIRY → QUOTATION_SENT → DEAL → IN_PRODUCTION → SHIPPED → DONE / LOST / CANCELLED`, log status beralasan, pipeline (0219), timeline (0229) | ya | 5 proyek |
| Instruksi pimpinan ke drafter | Tugas ruangan/item + tenggat dari Design, tercatat di HRD, selesai sendiri saat kotak terisi (0250, D402–D403) | ya | — |
| Render koleksi | Link galeri per koleksi (0251, D407) | ya | — |
| Render item, gambar kerja produksi, DWG, BOM | Enam kotak per item: PDF gambar kerja, DWG, render, foto, spesifikasi, BOM (0248, D399–D405) | ya | 0 item |
| BOM untuk quotation | Produk dari item desain + editor BOM (`/produksi/bom`), harga rilis | ya | 27 produk |
| Quotation ke klien | `quotations` berrevisi, cetak dua bahasa, terima/tolak beralasan, baris dari item desain (0133, 0225) | ya | 0 |
| Order klien | `project_lines` dibuat dari quotation yang diterima | ya | 0 |
| Membayar pihak luar | PO + termin DP/PROGRESS/FINAL (`po_schedule`), persetujuan pimpinan (`approve_po`), *Bayar order ini* (`post_to_po`) | ya | dipakai procurement |
| Vendor | `vendors` (bank, NPWP, PIC) | ya | 305 vendor |
| Kirim, sampai, serah terima | `ops_dlv`: pengiriman, `mark_arrived`, BAST, temuan instalasi (0132) | ya | 0 |
| Uang masuk | Buku besar `transactions` dengan `project_id` (arah IN), proyeksi cashflow dengan kategori `client` (0239) | ya | — |
| File per proyek ke Drive | `drive_paths` `{CLIENT}/{PROJECT}/…` (0217, 0222) | ya | — |

Catatan untuk papan README:
- P3–P7 masih tertulis *belum diterapkan ke produksi*. Padahal `0221`–`0229`
  sudah tercatat di produksi, dan tabel, fungsi, serta view-nya ada (dicek 10
  Okt). Papan dirapikan di PR kajian ini.
- Satu sisa P2 masih benar. `remove_quotation_line` di produksi masih versi
  0133 (gerbang `project.update`), bukan versi 0219 (`may_sell`). Akibatnya,
  akun yang hanya punya akses marketing belum bisa menghapus baris quotation.
  Ini kecil, dan dicatat di O1.

## 4. Celah

| # | Celah | Akibatnya hari ini |
|---|---|---|
| G1 | Pintu *Proyek baru* tidak ada di Design dan Pipeline | Owner mengira fiturnya belum ada |
| G2 | Vendor tidak punya jenis: pabrik mitra, QC, dan toko bahan tercampur di 305 baris | Pabrik mitra tidak bisa dipilih atau dievaluasi sebagai pabrik |
| G3 | Tidak ada **harga pabrik** per item | Negosiasi dengan pabrik tidak terekam. Quotation hanya bisa dihargai dari BOM internal atau biaya manual |
| G4 | Tidak ada **order ke pabrik untuk satu proyek**. PO tidak punya proyek, dan baris PO tidak menunjuk baris order klien | Siapa mengerjakan item mana, dengan harga berapa, dan kapan janji kirim, tidak terbaca dari proyek |
| G5 | ~~Tidak ada tanda DP klien sudah masuk di proyek~~ | *(D412) Uang tidak dicatat di sistem; tidak dibangun* |
| G6 | Tidak ada **kontainer**. Pengiriman hanya truk lokal | Isi kontainer dan jadwal kapal tidak bisa dicatat |
| G7 | Tidak ada **QC lapangan**: personel, penugasan, laporan, progres, temuan | Pemantauan produksi di pabrik hanya ada di WhatsApp |
| G8 | Tidak ada **status hasil kerja setelah sampai**: diterima atau ditolak klien | Tidak terbaca order mana yang tuntas dan mana yang bermasalah. Pembayaran QC diputuskan di luar sistem dari status ini (D412) |
| G9 | Orang luar tidak punya tempat. `employees` hanya untuk karyawan, dan orang luar hanya muncul sebagai teks bebas | Personel QC tidak bisa dibayar, dinilai, atau diberi akses |

## 5. Rancangan

Prinsip yang dipegang:
- satu kartu proyek;
- satu angka diketik sekali, di sumbernya;
- status dan progres dihitung, tidak diketik;
- **peringatkan, jangan blokir** (A6);
- semua catatan bertanggal dan append-only, supaya bisa dievaluasi
  belakangan.

### 5.1 Jalur produksi per baris order

Baris order (`project_lines`) mendapat satu kolom `route`:

- `WORKSHOP`: workshop TALA. Tetap memakai Job Order seperti sekarang,
  termasuk subkon per proses (`vendor_legs`).
- `FACTORY`: pabrik mitra. Barangnya dikerjakan di luar, lewat **order
  pabrik** (§5.4).

Defaultnya `WORKSHOP`, jadi lima proyek yang sudah ada tidak berubah. Satu
proyek boleh campuran.

Jumlah jadi per baris dibaca dari sumbernya:
- `WORKSHOP`: Job Order selesai (sudah ada di `v_fulfilment_line`).
- `FACTORY`: angka QC terakhir (§5.7).

Dengan begitu satu papan **Produksi per proyek** bisa menampilkan
keduanya. Halaman `/proyek/produksi` yang sudah ada menjadi tempatnya.

### 5.2 Instruksi pimpinan = tugas desain yang sudah ada

Empat keluaran yang disebut owner sudah punya kotak:

| Keluaran | Kotak / tempat |
|---|---|
| Render koleksi ruangan | Link galeri koleksi (D407). Kalau perlu per ruangan, link yang sama ditambahkan ke ruangan (kecil) |
| Render item | Kotak **Render** |
| Gambar kerja 3D untuk BOM | Kotak **DWG**. Diusulkan diberi label **DWG / 3D** dan menerima file SketchUp/3DM (Q81). Tidak perlu tabel baru |
| Gambar kerja untuk produksi | Kotak **Gambar kerja (PDF)**, yang juga dikirim ke pabrik |
| BOM | Kotak **BOM** |

Instruksinya adalah **Tugaskan ruangan / item + tenggat** (S2). Tugas itu
masuk ke HRD, bel berbunyi, dan selesai sendiri saat semua kotak terisi.
Tidak ada yang baru di sini.

### 5.3 Harga pabrik per item (negosiasi dengan pabrik)

Satu tabel kecil `ops_procure.factory_quotes`:

- **Kolom:** item desain, pabrik (vendor berjenis `factory`), harga per unit,
  lead time (hari), MOQ (opsional), berlaku sampai, catatan, file penawaran
  pabrik (opsional).
- **Append-only.** Penawaran baru dari pabrik yang sama berarti baris baru, dan
  yang berlaku adalah yang terbaru. Riwayat tawar-menawar tersimpan sendiri.
- **Beberapa pabrik bisa menawar item yang sama.** Satu ditandai **dipilih**.
- **Quotation ke klien bisa memakai harga pabrik yang dipilih sebagai biaya**,
  dengan sumber biaya `factory`, di samping `bom` dan `manual`. Margin dihitung
  dengan rumus quotation yang sudah ada dan hanya terlihat oleh pemegang
  `project.update`, sama seperti sekarang.

**Mata uang (D414).** Penawaran pabrik, quotation ke klien, dan order pabrik
masing-masing punya satu `currency`: `IDR` (default) atau `USD`. Semua baris
dokumen ikut mata uang dokumennya, dan total tidak pernah dijumlahkan lintas mata
uang.
- Untuk dokumen USD, orang mengetik **kurs** (rupiah per 1 USD) di dokumen itu,
  `fx_rate`. Kurs tidak ditebak dan tidak diambil otomatis, sama seperti baris
  bank USD di akuntansi (D181).
- Kurs hanya dipakai untuk **membaca** dalam rupiah: margin quotation saat
  biayanya dalam mata uang lain (biaya BOM selalu rupiah; harga pabrik bisa
  USD), dan papan evaluasi. Kalau kurs belum diisi, margin tertulis *kurs belum
  diisi*, bukan angka tebakan.
- PDF quotation menulis mata uangnya (*USD 1,250.00* atau *Rp 1.250.000*).
- PO supplier lokal tetap rupiah. Pembayaran USD ke pabrik tetap dicatat
  akuntansi seperti sekarang dan tidak dibaca alur agen (D412).

Vendor mendapat kolom `kind`: `supplier` (default), `factory`, `qc`, `other`.
Daftar 305 vendor tidak perlu disentuh. Cukup pabrik mitra yang ditandai.

### 5.4 Order pabrik = PO yang ditautkan ke proyek

PO yang sudah ada dipakai ulang, tidak membuat modul order baru:

- `purchase_orders.project_id`: order ini untuk proyek mana.
- `po_lines.project_line_id`: baris PO ini mengerjakan baris order klien yang
  mana. Harga pabrik yang dipilih menjadi harga satuan baris PO.
- `purchase_orders.currency` dan `fx_rate` (§5.3, D414). Tidak ada perkiraan
  jumlah kontainer: rasio QC diatur manual (D414).
- Kolom yang sudah ada tetap dipakai:
  - tanggal janji kirim (`expected_delivery`);
  - persetujuan pimpinan (`request_po_approval` / `approve_po`);
  - file PO yang ditandatangani pabrik.
- Termin dan pembayaran ke pabrik (`po_schedule`, `post_to_po`) tetap bisa
  dipakai procurement dan finance seperti sekarang, tetapi **alur agen tidak
  membaca dan tidak menunggunya** (D412).

Arti status untuk proyek:
- **Pabrik sanggup** = PO berstatus `ISSUED`: dikirim dan diterima pabrik.
- Proyek pindah ke `IN_PRODUCTION` otomatis saat order pabrik pertamanya
  `ISSUED`, seperti Job Order pertama memindahkannya sekarang.

Satu proyek boleh punya lebih dari satu order pabrik, satu per pabrik (Q84).

### 5.5 ~~DP klien sebagai syarat mulai~~ *(D412: tidak dibangun)*

Owner: uang tidak dikaitkan erat ke sistem. DP klien tidak dibaca dan tidak
menjadi syarat. Order pabrik bisa diajukan begitu quotation diterima (DEAL),
dan pimpinan menyetujuinya seperti PO biasa. D164 tetap berlaku.

### 5.6 Kontainer = pengiriman berjenis kontainer

`ops_dlv.deliveries` mendapat:
- `mode` (`truck` / `container`);
- `po_no` (dari order pabrik mana);
- `container_no`, `seal_no`, `container_size` (`20`, `40`, `40HC`);
- `etd`, `eta`, `bl_no` (opsional).

Baris pengiriman (`delivery_lines`, sudah ada) mencatat isi kontainer per
baris order. File packing list dan B/L disimpan sebagai file pengiriman.

Yang sudah ada tetap berlaku:
- `create_delivery` memindahkan proyek ke `SHIPPED`;
- `mark_arrived` mencatat tanggal sampai;
- BAST memindahkan proyek ke `DONE`.

Jumlah kontainer dihitung dari pengiriman ini.

### 5.7 QC lapangan (modul baru: `ops_qc`)

Lima tabel. Semuanya kecil.

| Tabel | Isi | Siapa mengisi |
|---|---|---|
| `qc_people` | Nama, HP, kota, akun ops (opsional), aktif/tidak, catatan | Koordinator QC |
| `qc_assignments` | Orang, order pabrik (dan proyeknya), mulai, selesai, catatan. Rasio 1 QC per 5 kontainer diatur koordinator sendiri (D414). Tanpa fee (D412) | Koordinator QC |
| `qc_reports` | Laporan per kunjungan/hari: tanggal, tahap (`bahan` · `konstruksi` · `finishing` · `packing` · `muat`), catatan, foto. Untuk tahap `muat`, menunjuk kontainer (§5.6) | QC dari HP |
| `qc_report_lines` | Per baris order: jumlah **lolos** dan **ditolak** pada laporan itu | QC dari HP |
| `qc_findings` | Temuan/insiden: jenis (`cacat` · `bahan/spek tidak sesuai` · `telat` · `rusak` · `packing` · `lainnya`), tingkat (`minor` · `major` · `kritis`), baris order (opsional), foto, tindakan, status `OPEN → RESOLVED`. Dicatat juga **fasenya**: `produksi`, `muat`, atau `setelah sampai` (klaim klien, §5.8) | QC, koordinator, atau sales untuk klaim klien |

Yang dihitung, tidak diketik:

- **Progres produksi pabrik** per baris = jumlah lolos terakhir ÷ jumlah
  dipesan. Angka ini yang tampil di papan Produksi per proyek (§5.1).
- **Laporan telat**: hari penugasan aktif tanpa laporan. Disorot, tidak
  diblokir.
- **Siap muat**: semua baris lolos penuh dan tidak ada temuan `major`/`kritis`
  yang masih `OPEN`. Ini peringatan saat kontainer dicatat, bukan penghalang.

Akses QC (Q88):
- QC masuk dengan akun ops miliknya dari HP. PWA karyawan sudah ada.
- QC hanya melihat **penugasannya sendiri**: order pabrik, gambar kerja PDF
  dari kotak item, BOM, dan laporannya.
- QC tidak melihat harga jual atau harga pabrik.
- Modul baru `qc`: koordinator `admin`, QC `write` yang dibatasi ke
  penugasannya.
- Foto laporan disimpan di Drive PROJECT MANAGER, di folder
  `{CLIENT}/{PROJECT}/QC/{YYYY-MM-DD}` lewat `drive_paths`, sesuai aturan
  D313/D320.

Opsional: lokasi saat laporan dikirim dicatat dengan mekanisme tap berlokasi
yang sudah ada (0188). Itu bukti QC benar-benar ada di pabrik, tanpa kerja
tambahan dari QC.

### 5.8 Status hasil kerja setelah barang sampai (D412)

- Setiap **order pabrik** punya status hasil kerja yang dibaca dari data yang
  sudah ada, ditambah satu keputusan orang:
  - `berjalan`: ada penugasan QC dan laporan, belum ada kontainer;
  - `dikirim`: kontainer tercatat (`create_delivery`);
  - `sampai`: semua kontainer order itu `mark_arrived`;
  - `diterima klien` atau `ditolak klien`: **dipilih sales/pimpinan**, dengan
    tanggal, nama orang di pihak klien, dan alasan bila ditolak.
- **Pengingat 3 bulan.** Tanggal sampai kontainer terakhir + 3 bulan tampil di
  kartu proyek. Kalau lewat dan status belum dipilih, order itu muncul di
  daftar *perlu dikonfirmasi*. Ini hanya pengingat, bukan jam uang.
- **Klaim klien** dicatat sebagai `qc_findings` dengan fase `setelah sampai`.
  Tabel dan layarnya sama dengan temuan produksi, jadi evaluasi bisa
  membandingkan *temuan sebelum kirim* dengan *klaim setelah sampai*.
- Apakah dan kapan QC dibayar diputuskan **di luar sistem**, dengan melihat
  status ini. Sistem tidak menyimpan fee, uang muka, atau tanggal rilis.

### 5.9 Evaluasi: apa yang terekam

Karena setiap angka bertanggal dan bersumber, papan berikut tinggal dibaca.
Tidak ada yang diketik ulang.

| Untuk | Yang terbaca |
|---|---|
| **Pabrik mitra** | Order per tahun, harga penawaran vs harga jadi, kirim tepat waktu (ETD vs janji), temuan per kontainer, klaim setelah sampai |
| **Personel QC** | Penugasan, kontainer yang dimuat selama penugasannya, hari dengan laporan / hari aktif, temuan sebelum kirim, klaim yang lolos ke klien, order yang diterima / ditolak klien |
| **Proyek** | Lama tiap tahap (inquiry → deal → produksi → kirim → sampai → purna jual), diterima / ditolak klien, margin quotation (hanya pemegang `project.update`) |
| **Desain** | Kelengkapan kotak dan ketepatan tenggat drafter (sudah ada, S2) |

### 5.10 Siapa melihat apa

| Bagian | Akses |
|---|---|
| Klien, proyek, quotation, harga pabrik | `may_sell` (pimpinan + marketing, D375). Harga pabrik juga untuk procurement |
| Order pabrik (PO) | procurement, dengan persetujuan pimpinan seperti PO sekarang |
| Kontainer | delivery |
| QC | modul `qc`. QC hanya penugasannya sendiri |

## 6. Yang sengaja tidak diusulkan

- **Modul order produksi terpisah.** PO sudah menyimpan pabrik, baris, harga,
  persetujuan, dan dokumen order. Membuat tabel kedua berarti dua tempat untuk
  satu order.
- **QC sebagai karyawan.** Payroll, absensi, dan BPJS tidak berlaku. QC adalah
  orang luar dengan akun.
- **Uang di dalam alur:** DP klien, fee QC, uang muka, rilis (D412). Yang
  dicatat status pekerjaannya. D164 tetap.
- **Status proyek baru.** `IN_PRODUCTION → SHIPPED → DONE` cukup. Purna jual
  adalah tanggal turunan, bukan status.
- **Tracking kapal otomatis.** ETD/ETA diketik dari B/L.
- **Wajib-wajib.** Tidak ada yang diblokir.

## 7. Urutan kerja: satu sesi, satu fitur

| # | Sesi | Database | Butuh jawaban? |
|---|---|---|---|
| **O1** | **Pintu masuk:** *Proyek baru* dan *Klien baru* langsung dari Pipeline dan Design, memakai formulir yang sudah ada. Design menawarkan *buat proyek* saat kosong. Sisa P2: `remove_quotation_line` versi 0219 ke produksi lewat SQL Editor (badannya menghapus baris) | tidak (hanya menerapkan sisa 0219) | tidak |
| **O2** ✓ | **Jenis vendor + harga pabrik per item** *(dikerjakan, D415)*: `vendors.kind`, `factory_quotes`, sumber biaya `factory` di quotation, kolom harga pabrik di Design/quotation, mata uang IDR/USD + kurs per dokumen (D414) | ya | — (D414) |
| **O3** ✓ | **Jalur produksi + order pabrik** *(dikerjakan, D416)*: `project_lines.route`, PO ↔ proyek/baris order, buat order pabrik dari baris order `FACTORY`, `ISSUED` → `IN_PRODUCTION`, papan Produksi per proyek | ya | — (D413) |
| ~~O4~~ | ~~Uang masuk dari klien di kartu proyek~~ **Dibatalkan (D412)** | — | — |
| **O5** ✓ | **Kontainer** *(dikerjakan, D417)*: `deliveries.mode` + kolom kontainer, isi per baris order, packing list / B/L | ya | — |
| **O6** ✓ | **QC: personel + penugasan** *(dikerjakan, D418)*: `ops_qc` schema, modul `qc`, QC hanya melihat order yang ditugaskan; rasio 1 per 5 kontainer manual (D414) | ya | — (D414) |
| **O7** ✓ | **QC dari HP** *(dikerjakan, D419)*: laporan harian + foto + jumlah lolos/tolak, temuan/insiden, cek muat kontainer, progres pabrik di papan proyek | ya | — |
| **O8** | **Status hasil kerja:** diterima / ditolak klien per order pabrik, klaim klien sebagai temuan *setelah sampai*, pengingat 3 bulan sejak sampai | ya | — |
| **O9** | **Evaluasi:** papan pabrik, QC, dan proyek (§5.9) | view saja | — |

O1 bisa dikerjakan sekarang. O2–O5 membuat jalur agen bisa dipakai tanpa QC.
O6–O8 adalah modul QC. O9 dikerjakan setelah ada data.

## 8. Pertanyaan untuk owner

Setiap pertanyaan punya default. Pekerjaan berjalan dengan default sampai
dijawab.

| Q | Pertanyaan | Default sampai dijawab |
|---|---|---|
| **Q81** | Gambar kerja 3D untuk BOM: filenya apa (SketchUp, 3DM, DWG 3D)? Cukup satu kotak **DWG / 3D**, atau perlu kotak 3D sendiri? | **Dijawab (D413): default.** Satu kotak, diberi label **DWG / 3D**, menerima semua jenis file |
| **Q82** | D164 (*kita tidak handle penagihan ke klien*) masih berlaku? DP klien cukup dibaca dari uang masuk yang dicatat finance, dengan peringatan (bukan blokir) saat order pabrik diajukan tanpa DP? | **Dijawab (D412):** uang tidak dikaitkan ke sistem; yang dicatat status pekerjaannya |
| **Q83** | Apakah workshop sendiri tetap memproduksi sebagian order, berdampingan dengan pabrik mitra? | **Dijawab (D413): default.** Ya. Jalur per baris order, default workshop |
| **Q84** | Bisakah satu proyek dibagi ke beberapa pabrik? | **Dijawab (D413): default.** Bisa. Satu order pabrik per pabrik per proyek |
| **Q85** | Masa 3 bulan dihitung sejak kapan: barang sampai di klien, BAST, atau ETA kapal? | **Dijawab (D412):** uang tidak dikaitkan ke sistem; yang dicatat status pekerjaannya |
| **Q86** | Kalau ada klaim dalam 3 bulan: fee QC ditahan sampai klaim selesai, dipotong, atau hangus? | **Dijawab (D412):** uang tidak dikaitkan ke sistem; yang dicatat status pekerjaannya |
| **Q87** | Fee QC: angka per penugasan, per kontainer, atau bulanan? Ada uang muka atau uang jalan selama produksi, atau 100% ditahan sampai rilis? | **Dijawab (D412):** uang tidak dikaitkan ke sistem; yang dicatat status pekerjaannya |
| **Q88** | QC mengisi laporan sendiri dari HP (akun ops), atau mengirim lewat WA lalu diketik koordinator? | **Dijawab (D414): dikonfirmasi.** Akun sendiri, hanya melihat order yang ditugaskan kepadanya |
| **Q89** | Aturan 1 QC per 5 kontainer dihitung per order pabrik atau per proyek? Jumlah kontainer sudah diketahui saat order? | **Dijawab (D414): manual.** Koordinator QC mengatur rasionya sendiri; sistem tidak menghitung dan tidak memperingatkan |
| **Q90** | Siapa yang mencatat harga pabrik dan membuat order pabrik: procurement, sales, atau pimpinan? | **Dijawab (D414): ya.** Procurement mencatat dan membuat, pimpinan menyetujui (alur PO sekarang) |
| **Q91** | Harga pabrik dan harga ke klien dalam rupiah, atau ada mata uang asing (pabrik atau klien di luar negeri)? | **Dijawab (D414): IDR dan USD.** Satu mata uang per dokumen, kurs diketik orang untuk dokumen USD (§5.3) |
