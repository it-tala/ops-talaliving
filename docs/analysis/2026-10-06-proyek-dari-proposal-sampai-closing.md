# Modul Proyek: dari proposal sampai closing (dan sesudahnya), kajian 6 Okt 2026

Ini kajian, bukan keputusan. Dokumen ini tidak melahirkan nomor D. Apa pun
yang diputuskan owner setelah membacanya dicatat di `docs/plan/06-decisions.md`.
Pertanyaan di §7 diberi nomor Q64 sampai Q71.

**Dijawab owner pada hari yang sama:** D371–D376. Bagian §4 dan §6 di bawah
sudah disesuaikan dengan jawaban itu. Q67, Q68, dan Q72 (baru) masih terbuka
dengan default.

**Permintaan owner (6 Okt):** *mulai merekam aktivitas perusahaan dari
mengirim proposal, penawaran, meeting dengan klien, sampai closing atau tidak
jadi. Semuanya di-track dan dikumpulkan datanya. Berarti kita harus punya
daftar item desain, drawings, render, dan sebagainya, baik dari kita sendiri
maupun dari klien. Di ops, proses bisnis terekam dari awal sampai akhir.*

Sumber yang dibaca:
- Kode dan migrasi `0006`, `0111`, `0130`, `0132`, `0133`, `0134`, `0060`,
  `0172`, `0203`, dan `0080`–`0085`.
- Layar `/proyek/*`, `/master-data/clients*`, `/produksi/bom`,
  `/produksi/desain`, dan `/marketing/*`.
- `src/lib/live.ts` dan `src/lib/api/_pending.ts`.
- Keputusan D150, D164, D166, D179, D183–D186, D240 dan D313.
- **Database produksi**, hanya dibaca, 6 Okt.

---

## 0. Jawaban singkat

1. **Kerangkanya sudah ada, tetapi belum dipakai.** Ops sudah punya master
   klien, proyek berstatus `INQUIRY → QUOTATION_SENT → DEAL → IN_PRODUCTION
   → SHIPPED → DONE / CANCELLED`, quotation berrevisi yang bisa dicetak,
   log kontak klien dengan follow-up, Job Order, pengiriman, instalasi, dan
   serah terima. Semuanya sudah tersambung ke backend sungguhan. Isinya di
   produksi:
   - **0 klien**
   - **0 quotation**
   - **0 catatan kontak**
   - **0 baris order**
   - **5 proyek**, semuanya tanpa klien dan tanpa nilai kontrak
2. **Yang benar-benar belum ada justru inti permintaan ini, yaitu sisi
   desain dan sisi "kenapa jadi atau tidak jadi".** Rinciannya:
   - Tidak ada **daftar item desain per proyek**.
   - Tidak ada tempat untuk **render, moodboard, layout, atau gambar dan
     referensi dari klien**.
   - Tidak ada **notulen meeting** dan peserta.
   - Tidak ada **sumber lead** dan **PIC sales**.
   - Tidak ada status **tidak jadi (LOST)** yang terpisah dari **batal
     (CANCELLED)**.
   - Tidak ada **timeline proyek** dari awal sampai akhir.
   - Antrian drafter (`/produksi/desain`, M30) **hanya ada di demo**. Belum
     ada tabel dan belum ada fungsi live.
3. **Usulan:** satu proyek tetap menjadi satu kartu dari pertanyaan pertama
   klien sampai serah terima. Kita tambahkan **item desain** sebagai tulang
   punggungnya. Item desain lahir sebelum penawaran, membawa file dari dua
   pihak (TALA dan klien), lalu menjadi baris quotation, baris order, produk,
   dan Job Order. Semua kejadian di sepanjang jalan dibaca sebagai **satu
   timeline** (view, bukan kolom tersimpan, A3). Pekerjaannya dipecah menjadi
   delapan sesi kecil (§6), dan sesi pertama tidak memerlukan keputusan baru.

---

## 1. Proses bisnis yang ingin direkam

```
 LEAD ──▶ BRIEF & SURVEI ──▶ DESAIN / PROPOSAL ──▶ PENAWARAN ──▶ MEETING / NEGO ──▶ CLOSING
  │         │                  │                    │              │                 ├─ DEAL ──▶ SPK/Job Order ──▶ produksi ──▶ kirim ──▶ instal ──▶ serah terima
  │         │                  │                    │              │                 └─ TIDAK JADI (alasan)
  sumber    referensi klien,   moodboard, layout,   quotation      notulen,
  PIC       foto lokasi,       render, daftar item, rev 1, 2, …    keputusan,
            ukuran             gambar kerja                         revisi diminta
```

Status yang sudah ada kurang lebih mengikuti jalur ini:

| Tahap | Status `projects.status` hari ini |
|---|---|
| Lead, brief, desain | `INQUIRY` (satu status untuk tiga tahap) |
| Penawaran terkirim | `QUOTATION_SENT` (otomatis saat quotation dikirim, `0133`) |
| Closing jadi | `DEAL` (otomatis saat quotation diterima) |
| Produksi | `IN_PRODUCTION` (otomatis saat Job Order pertama dibuat, `0130`) |
| Kirim, selesai | `SHIPPED` / `DONE` (otomatis dari pengiriman dan BAST, `0132`) |
| Tidak jadi / batal | `CANCELLED` (manual, wajib alasan) |

Jalurnya sudah benar. Yang kurang adalah isi tiap tahap.

## 2. Apa yang sudah ada

| Kebutuhan | Yang ada | Live? | Dipakai di produksi? |
|---|---|---|---|
| Daftar klien | `ops_procure.clients` (`0111`), `/master-data/clients` | ya | **0 baris** |
| Proyek dan status | `projects` + `project_status_log` (`0006`, `0111`), `/proyek/order` | ya | 5 proyek (`25004`–`25008`), semua tanpa klien dan nilai |
| Penawaran | `quotations` + `quotation_lines` (`0133`). Ada revisi (`rev`, `supersedes_id`), masa berlaku, harga dari BOM rilis atau biaya manual, cetak dua bahasa, terima/tolak (tolak wajib alasan) | ya | **0 baris** |
| Kontak dan meeting | `client_activities` (`0134`). Jenis: `call`, `whatsapp`, `email`, `meeting`, `visit`, `note`. Bisa diarahkan ke proyek dan quotation tertentu, dengan follow-up dan hasilnya. Append-only. `/proyek/follow-up` | ya | **0 baris** |
| Ringkasan penjualan | `salesSummary()`: jumlah dan nilai open/diterima/ditolak, win rate, alasan tolak | ya | kosong |
| Produk dan gambar | `ops_prod.products`, gambar `gambar_kerja` dan `gambar_jadi` ditautkan ke **produk** (D150), `/produksi/bom` | ya | 27 produk, **27 gambar kerja, 0 gambar jadi** |
| Antrian drafter | `/produksi/desain` (D179): tugas per produk, revisi append-only, pertanyaan yang mengunci rilis | **tidak, hanya demo** | belum ada tabelnya |
| Order → produksi | `project_lines`, Job Order dengan `bom_rev` terkunci (`0130`) | ya | 0 baris order, 2 Job Order di `25008` |
| Kirim, instal, serah terima | `0132`, `/proyek/pengiriman`, `/proyek/instalasi`, `/proyek/serah-terima` | ya | — |
| Lead dari agen (Package) | `ops_mkt.referrals`: `LEAD → SURVEYED → QUOTED → WON / LOST` (D183–D186) | ya | **0 baris**. Tersambung ke proyek hanya lewat teks `project_code` |

Catatan dokumen yang sudah basi: `03-api.md:238` dan Q37/D240 di
`06-decisions.md` masih menyebut *tidak ada model quotation*. `0133` mencatat
bahwa owner membuka lagi pertanyaan itu pada 23 Sep. `02-database.md` dan
`03-api.md` belum memuat `0111`, `0133`, dan `0134`.

## 3. Celah

### 3a. Sisi penjualan

| # | Celah | Kenapa penting |
|---|---|---|
| G1 | Tidak ada **sumber lead** (referral Package, Instagram, arsitek, repeat, walk-in, …) | Tanpa ini kita tidak tahu saluran mana yang menghasilkan deal |
| G2 | Tidak ada **PIC sales** sebagai orang. `projects.pic` hanya teks bebas | Kinerja per orang dan siapa yang wajib follow-up tidak bisa dihitung |
| G3 | **Tidak jadi** dan **batal** tercampur dalam `CANCELLED`. Alasannya teks bebas di log | Pertanyaan *kenapa kita kalah* tidak bisa dijawab per kategori (harga, waktu, desain, kompetitor, klien menunda) |
| G4 | Menolak quotation tidak mengubah apa pun pada proyek. Proyek bisa tetap `QUOTATION_SENT` selamanya | Pipeline menggelembung oleh proyek yang sebenarnya sudah mati |
| G5 | Meeting hanya satu `kind` dengan satu kolom `summary`. Tidak ada peserta, keputusan, atau file | Hasil meeting (klien minta revisi X) tidak bisa ditelusuri ke revisi desainnya |
| G6 | Tidak ada perkiraan nilai dan tanggal closing sebelum ada quotation | Nilai pipeline di tahap awal tidak terlihat |
| G7 | Referral Package tidak tersambung ke klien dan proyek (teks bebas) | Lead dari agen dicatat dua kali, dan komisi bergantung pada kode yang diketik tangan |
| G8 | Tidak ada dokumen **SPK / kontrak / PO klien** yang ditandatangani | `DEAL` hanya berarti *quotation diterima di layar*, tanpa bukti |

### 3b. Sisi desain dan file

| # | Celah | Kenapa penting |
|---|---|---|
| G9 | **Tidak ada daftar item desain per proyek.** Item baru ada setelah quotation diterima (`project_lines`), dan gambarnya melekat ke produk, bukan ke proyek | Saat proposal, sebelum ada harga, itemnya belum punya rumah |
| G10 | **Jenis file kurang.** Hanya ada `gambar_kerja` dan `gambar_jadi`. Belum ada render, moodboard/konsep, layout/denah, gambar dari klien, referensi klien, foto survei, deck proposal, notulen, SPK/kontrak | Render dan foto barang jadi kini bercampur dalam satu jenis (`gambar_jadi` dilabeli *Finished drawing* di satu layar dan *Finished photo* di layar lain) |
| G11 | **Asal file tidak tercatat** (TALA, klien, atau arsitek/desainer klien). Yang tercatat hanya user yang mengunggah | Permintaan owner secara eksplisit: *dari kita sendiri maupun dari klien* |
| G12 | **File tidak bisa ditempel ke klien, quotation, atau catatan meeting.** `link_entity_t` hanya punya `project` dan `product`. `LinkEntity` di TypeScript bahkan belum punya `project` | Lampiran WA klien atau notulen tidak punya tempat |
| G13 | **Persetujuan klien atas desain tidak tercatat** (render disetujui pada tanggal X, lewat WA, oleh siapa) | Sengketa *kami tidak pernah setuju bentuk ini* tidak bisa dijawab |
| G14 | Quotation mengunci `frozen_bom_rev`, tetapi **tidak mengunci revisi gambar** yang menjadi dasar harganya | Harga dan gambar bisa berjalan sendiri-sendiri |
| G15 | Antrian drafter hanya demo. Revisi di sana hanya nama file yang diketik, tidak terhubung ke file sungguhan | M30 tercatat DONE di board, padahal backend-nya tidak ada |
| G16 | **Drive PROJECT MANAGER belum dikonfigurasi** di produksi (`drive_folders.project`: `drive_id` dan `folder_id` kosong). Drive lain sudah punya folder `ops-talaliving` | BAST, foto lokasi, dan surat jalan keluar tidak bisa terunggah ke Drive hari ini. Semua file baru dari proses penjualan pun akan bernasib sama kalau diarahkan ke sana |
| G17 | `drive_paths` hanya mengenal token tanggal (`{YYYY-MM}`, `{YYYY-MM-DD}`), **belum mengenal token proyek** | Aturan D313 (*satu folder per tugas*) menuntut file proyek masuk ke folder proyeknya, bukan bertumpuk di satu folder per jenis |

## 4. Usulan bentuk

Prinsipnya sama dengan bagian lain sistem ini: append-only, status sebagai
view, menolak dengan alasan yang terlihat, dan tidak ada angka yang dikarang
sistem.

### 4.1 Proyek tetap satu kartu dari awal sampai akhir

Kita **tidak** membuat entitas *opportunity* atau *lead* terpisah. Lead
adalah proyek berstatus `INQUIRY`. Seluruh rangkaian (quotation, Job Order,
pengiriman, BAST) sudah memakai `project_id` atau `project_code`, jadi
memecahnya justru memaksa pemindahan data saat closing. Yang ditambahkan ke
`projects`:

- `source_note`: catatan sumber lead berupa teks bebas yang opsional. **Belum
  berupa daftar (D372)** karena model bisnis barunya belum tervalidasi. Kalau
  sumbernya referral Package, `referral_id` menunjuk ke `ops_mkt.referrals`
  (menutup G7).
- `sales_pic`: FK ke user/karyawan, menggantikan teks `pic` (menutup G2).
- `expected_value` dan `expected_close_on`: perkiraan sebelum ada quotation
  (G6). Setelah quotation terkirim, nilai pipeline dibaca dari quotation
  yang berlaku.
- Status baru **`LOST`**: tidak jadi sebelum deal. `CANCELLED` dipakai untuk
  batal setelah deal (G3). Keduanya wajib `reason_code` dan catatan bebas.
  Kategorinya **dalam bahasa Inggris (D373)**: `PRICE` · `TIMELINE` · `DESIGN`
  · `COMPETITOR` · `CLIENT POSTPONED` · `NO RESPONSE` · `OTHER`. Ingat F161: nilai enum baru tidak bisa dipakai di migrasi
  yang menambahkannya.
- Menolak quotation yang **terakhir berlaku** memunculkan pilihan di layar:
  *buat revisi* atau *tandai proyek tidak jadi*. Sistem tidak memutuskan
  sendiri (G4).
- Opsional (Q67): tahap `INQUIRY` dipecah menjadi `BRIEF` dan `DESIGN` agar
  funnel awal terbaca.

### 4.2 Meeting sebagai catatan yang lengkap

`client_activities` tetap menjadi satu-satunya log kontak. Untuk jenis
`meeting` dan `visit`, kita tambahkan:

- **Peserta.** Peserta TALA sebagai FK user, peserta klien sebagai teks.
- **Notulen** dan **keputusan / permintaan revisi** sebagai baris, sehingga
  satu permintaan bisa ditunjuk oleh revisi desain yang menjawabnya.
- **File.** Entity baru `client_activity` di `link_entity_t`, untuk foto
  papan tulis, notulen yang ditandatangani, atau tangkapan WA.

Log tetap append-only (`0134`). Koreksi ditulis sebagai catatan baru.

### 4.3 Item desain: tulang punggung yang hilang

**Urutannya ditetapkan owner (D375): klien → proyek → koleksi / katalog →
ruangan → item/produk.** Drafter bekerja, mencari, dan menyimpan file menurut
urutan itu.

```
CL-0007  (klien)
└── 25008 PACKAGE - SKYLINE           proyek
    ├── KOLEKSI A · TYPE 2BR           koleksi / katalog
    │   ├── LIVING ROOM                ruangan
    │   │   ├── 25008-A-LR-01  Sofa 3 seater      item → produk saat dipesan
    │   │   └── 25008-A-LR-02  Coffee table
    │   └── MASTER BEDROOM
    │       └── 25008-A-MB-01  Bed 180 + headboard
    └── KOLEKSI B · TYPE 3BR
        └── …
```

Dua tabel kecil dan satu tabel item:

- `design_collections`: proyek, kode, nama, catatan. Satu koleksi milik satu
  proyek (default Q72). Katalog milik TALA sendiri dicatat sebagai proyek
  dengan klien internal TALA.
- `design_rooms`: koleksi, nama ruangan, urutan.
- `design_items`: satu baris adalah satu benda yang ditawarkan atau digambar
  di ruangan itu.

| Kolom `design_items` | Isi |
|---|---|
| `room_id`, `item_no` | `<proyek>-<koleksi>-<ruangan>-NN`, dicetak oleh Postgres |
| `name`, `qty`, ukuran L × W × H | |
| `origin` | `TALA` (desain kita) · `KLIEN` (klien membawa desainnya, kita produksi) · `ADAPTASI` (dari referensi klien, digambar ulang oleh kita) |
| `product_code` | kosong sampai item menjadi produk. Diisi lewat jalur yang sudah ada, `product_from_order_line` |
| `status` (view) | `KONSEP` → `RENDER` → `DISETUJUI KLIEN` → `GAMBAR KERJA RILIS` → `DI-QUOTE` → `DIPESAN`, atau `DIBATALKAN`. **Dihitung dari file, persetujuan, dan baris quotation, bukan disimpan** (A3) |

Yang terhubung ke item desain:

- `quotation_lines.design_item_id` dan `frozen_design_rev`, sehingga harga
  dan gambar terkunci bersama (G14).
- `project_lines` mewarisi `design_item_id` saat quotation diterima, jadi
  rantainya utuh: item desain → baris quotation → baris order → produk → Job
  Order.
- Antrian drafter (D179) dibuat live dengan tugas yang menunjuk **item
  desain** (G15), dikelompokkan dan disaring per klien, proyek, koleksi, dan
  ruangan (D375). Tugas untuk produk yang sudah ada (tanpa proyek baru) tetap
  bisa dibuat. Revisinya adalah file sungguhan (`attachment_id` wajib).
- **Persetujuan klien** (G13) dicatat sebagai baris append-only
  `design_approvals`: item, revisi/file yang disetujui, tanggal, saluran (WA,
  meeting, email, tanda tangan), nama di pihak klien, dan bukti (file).
  Pencatatnya orang TALA. Ini bukan alur tanda tangan elektronik.
  **Persetujuan tidak wajib (D374):** rilis gambar kerja tanpa persetujuan
  tetap boleh, tetapi layar memperingatkan. Satu-satunya penolakan rilis
  tetap aturan D179, yaitu masih ada pertanyaan yang belum dijawab.

### 4.4 Jenis file dan asal file

Jenis baru di `doc_kind_t`. Usulannya, menunggu Q68:

| Jenis | Isi | Drive |
|---|---|---|
| `brief` | brief / kebutuhan tertulis dari klien | PROJECT MANAGER |
| `referensi_klien` | foto inspirasi, Pinterest, contoh produk | DRAFTING |
| `gambar_klien` | gambar teknis atau desain yang dibawa klien atau arsiteknya | DRAFTING |
| `foto_survei` | foto dan ukuran lokasi saat survei | PROJECT MANAGER |
| `moodboard` | konsep, material board | DRAFTING |
| `layout` | denah / layout ruang | DRAFTING |
| `render` | render 3D, terpisah dari `gambar_jadi` (G10) | DRAFTING |
| `proposal` | deck/PDF proposal yang dikirim ke klien | PROJECT MANAGER |
| `notulen` | notulen meeting | PROJECT MANAGER |
| `kontrak` | SPK / kontrak / PO klien bertanda tangan (G8) | PROJECT MANAGER |

`gambar_jadi` kembali ke arti aslinya, yaitu foto barang jadi (D150). Kolom
**`origin`** (`TALA` / `KLIEN` / `PIHAK_KETIGA`) dipasang di file itu sendiri,
karena satu render bisa dibuat oleh desainer klien (G11). Entity baru di
`link_entity_t`: `client`, `quotation`, `client_activity`, dan `design_item`.
Selain itu, `project` ditambahkan ke `LinkEntity` TypeScript (G12).

### 4.5 Folder Drive per proyek (D313)

`drive_paths` perlu token `{PROJECT}`, berisi kode dan nama proyek,
misalnya `25008 PACKAGE - SKYLINE`, diambil dari record tempat file itu
diarsipkan (G17). Usulan tata letaknya:

```
PROJECT MANAGER / ops-talaliving
└── PROYEK
    └── 25008 PACKAGE - SKYLINE
        ├── 01 BRIEF & SURVEI        (brief, foto_survei)
        ├── 03 PROPOSAL & PENAWARAN  (proposal, quotation PDF)
        ├── 04 MEETING               (notulen, file catatan meeting)
        ├── 05 KONTRAK               (kontrak)
        └── 06 SERAH TERIMA          (bast, foto_lokasi, surat_jalan_keluar)

DRAFTING / ops-talaliving                    (urutan D375)
└── <KODE KLIEN> <NAMA KLIEN>
    └── 25008 PACKAGE - SKYLINE
        ├── 00 DARI KLIEN            (gambar_klien, referensi_klien untuk seluruh proyek)
        └── KOLEKSI A · TYPE 2BR
            ├── 00 KONSEP            (moodboard, layout koleksi)
            └── LIVING ROOM
                └── 25008-A-LR-01 Sofa 3 seater   (render, gambar_klien, gambar kerja item ini)
```

Untuk ini `drive_paths` butuh token `{CLIENT}`, `{PROJECT}`, `{COLLECTION}`,
`{ROOM}`, dan `{ITEM}`, yang dibaca dari record tempat file diarsipkan.

Drive tetap ditentukan oleh `doc_kind_drive` saja, karena itu batas data
pribadi (0035). Path hanya memilih folder di dalam drive tersebut. **Syarat
pertama: IT mengonfigurasi drive PROJECT MANAGER** di `/it/drive` (G16).

### 4.6 Timeline proyek dan dashboard

- `v_project_timeline` adalah satu view yang menggabungkan perubahan status,
  catatan kontak dan meeting, quotation dikirim/diputuskan, file diunggah,
  persetujuan klien, revisi desain dirilis, Job Order, pengiriman, dan BAST.
  Semuanya diurutkan menurut waktu dan ditampilkan di halaman proyek.
  Tidak ada yang disimpan dua kali.
- Dashboard pipeline `/proyek/pipeline` berisi:
  - jumlah dan nilai per tahap
  - umur di tiap tahap
  - win rate per sumber dan per PIC
  - alasan tidak jadi per kategori
  - lama rata-rata dari inquiry sampai deal

  Batas D164 tetap berlaku: tidak ada piutang, penagihan, atau kolom laba.
  Nilai di sini adalah nilai penawaran, bukan keuntungan.

## 5. Yang sengaja tidak diusulkan

- **Kirim email/WA otomatis dari ops.** Kontak tetap dicatat manual. Chat
  tetap pintu masuk dan notifikasi saja (D291).
- **Tanda tangan elektronik.** Persetujuan klien dicatat beserta buktinya.
- **Entitas opportunity terpisah** (lihat §4.1).
- **Piutang dan margin proyek** (D164).

## 6. Urutan kerja: satu sesi, satu fitur

| # | Sesi | Isi | Butuh jawaban owner? |
|---|---|---|---|
| P1 | **Fondasi file proyek** | Drive PROJECT MANAGER dikonfigurasi (IT). Entity `client`/`quotation`/`client_activity` dan `project` di TS. Jenis file baru dengan kolom `origin`. Token `{CLIENT}`/`{PROJECT}` di `drive_paths`. Unggah file dari halaman proyek, quotation, dan catatan kontak | Q68 masih terbuka, jalan dengan default |
| P2 | **Pipeline: sumber, PIC, tidak jadi** | `source_note` teks bebas (D372), `sales_pic`, `expected_value`/`expected_close_on`, `LOST` dengan kategori alasan berbahasa Inggris (D373), pilihan setelah quotation terakhir ditolak, papan `/proyek/pipeline`, akses pimpinan + marketing (D371) | Q67 masih terbuka, jalan dengan default |
| P3 | **Meeting lengkap** | Peserta, notulen, baris keputusan/permintaan revisi, file meeting | — |
| P4 | **Koleksi → ruangan → item desain** (D375) | `design_collections`, `design_rooms`, `design_items`, file per item dari dua pihak, token `{COLLECTION}`/`{ROOM}`/`{ITEM}`, status turunan, persetujuan klien yang tidak wajib (D374) | Q72 masih terbuka, jalan dengan default |
| P5 | **Quotation ↔ item desain** | `design_item_id` dan `frozen_design_rev` di quotation_lines, diwariskan ke project_lines; quotation dicetak per koleksi/ruangan | — |
| P6 | **Antrian drafter live** (M30 ke backend) | Tabel dan fungsi untuk tugas, revisi (file sungguhan), dan pertanyaan per item desain, disaring per klien → proyek → koleksi → ruangan (D375) | — |
| P7 | **Timeline dan dashboard** | `v_project_timeline` di halaman proyek, metrik pipeline | — |
| P8 | **Mulai dipakai** | Klien dan nilai untuk proyek 25004–25008 diisi, proyek baru dicatat dari tahap inquiry. Tidak ada impor (D376) | — |

P1 tidak bergantung pada jawaban apa pun dan langsung berguna. Hari ini
pun file klien sudah punya tempat. **Penggunaan bisa dimulai sebelum P2–P7
selesai**: daftar klien, proyek berstatus `INQUIRY`, quotation, dan catatan
kontak sudah live dan kosong. Data yang dicatat sejak hari ini akan terbaca
oleh timeline dan dashboard yang dibangun belakangan.

## 7. Pertanyaan untuk owner

**Jawaban owner, 6 Okt:**

| Q | Jawaban | Keputusan |
|---|---|---|
| Q64 | *pimpinan dan semua yang punya akses ke marketing* | D371 |
| Q65 | *belum terpikirkan, karena kita masih belum menemukan model bisnis baru yang tervalidasi* | D372: teks bebas opsional, belum berupa daftar |
| Q66 | *ikut saranmu, pakai english* | D373 |
| Q69 | *tidak wajib* | D374: diperingatkan, tidak diblokir |
| Q70 | *drafter bekerja berdasarkan client - project - koleksi / catalog - ruangan - item/produk* | D375 |
| Q71 | *tidak ada catatan penjualan lama* | D376 |
| Q67, Q68 | belum dijawab | default di bawah tetap berlaku |
| Q72 (baru) | apakah satu koleksi bisa dipakai di lebih dari satu proyek? | default: tidak, koleksi milik satu proyek; yang dipakai bersama adalah produk |

Daftar pertanyaan aslinya:

| Q | Pertanyaan | Default sampai dijawab |
|---|---|---|
| **Q64** | Siapa yang mencatat penjualan: tim sales, PM, atau pimpinan? Siapa yang boleh melihat nilai penawaran? | Tetap `project.read` / `project.update` seperti `0133`/`0134` |
| **Q65** | Daftar sumber lead | `REFERRAL PACKAGE` · `REPEAT CLIENT` · `ARSITEK/DESAINER` · `INSTAGRAM/WEBSITE` · `WALK-IN/SHOWROOM` · `KENALAN` · `LAINNYA` |
| **Q66** | Kategori alasan tidak jadi | `HARGA` · `WAKTU` · `DESAIN` · `KOMPETITOR` · `KLIEN MENUNDA` · `TIDAK ADA KABAR` · `LAINNYA`, selalu ditambah catatan bebas |
| **Q67** | Apakah `INQUIRY` dipecah menjadi brief dan desain? | Tidak. Tahap awal dibaca dari item desain dan file yang ada |
| **Q68** | Daftar jenis file di §4.4 dan drive tujuannya | Seperti tabel §4.4 |
| **Q69** | Apakah persetujuan klien atas render/gambar wajib sebelum gambar kerja dirilis? | **Tidak wajib, tetapi diperingatkan** (A6: peringatkan, jangan blokir). D179 hanya memblokir rilis bila ada pertanyaan yang belum dijawab |
| **Q70** | Apakah drafter mengerjakan tugas per item desain proyek, per produk, atau keduanya? | Keduanya. Item desain menjadi produk saat dipesan, dan tugasnya ikut pindah |
| **Q71** | Apakah ada catatan penjualan lama (sheet, WA, folder) yang perlu diimpor? | Tidak diimpor. Mulai dari proyek aktif dan proyek baru |
