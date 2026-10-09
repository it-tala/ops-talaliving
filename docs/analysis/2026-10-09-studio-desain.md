# Studio Desain: modul kerja tim drafter, kajian 9 Okt 2026

Ini kajian, bukan keputusan. Dokumen ini tidak melahirkan nomor D. Apa pun
yang diputuskan owner setelah membacanya dicatat di `docs/plan/06-decisions.md`.
Pertanyaan di §7 diberi nomor Q74 sampai Q80, masing-masing dengan default.

Preview yang bisa diklik: `docs/analysis/2026-10-09-studio-desain-preview.html`.

**Permintaan owner (9 Okt):** *kita butuh 1 modul di dalam project untuk
project management internal. Kita punya daftar klien → koleksi gambar → set
ruangan → item. Per item ada detail seperti spesifikasi, BOM, file gambar
kerja PDF, file DWG, gambar render, gambar item / foto. Tiap file ada
revisinya dan rekam jejak (rejected/approved, reason / note / feedback,
version history). Mungkin bisa improvement dari `/produksi/bom` dan
`/produksi/desain`, karena `/produksi/desain` tidak ada input. Bayangkan tools
untuk mengkoordinasikan tugas dan deadline untuk team drafter. Ini harus
terhubung ke task monitoring di HRD.*

Sumber yang dibaca:
- Migrasi `0222` (koleksi, ruangan, item desain, persetujuan klien), `0225`
  (quotation ↔ item), `0226` (antrean drafter), `0210`/`0215`/`0230` (tugas
  HRD, notifikasi, rencana harian), dan jalur file `0216`/`0217`.
- Layar `/produksi/desain`, `/produksi/bom`, `/proyek/order/[code]` tab
  Design, `src/components/design/*`, `src/lib/nav.ts`.
- Keputusan D179, D264, D313, D367, D371, D374, D378, D379, D382, D384.
- **Database produksi**, hanya dibaca, 9 Okt.

---

## 0. Jawaban singkat

1. **Rangkanya sudah ada di produksi, tetapi kosong dan tidak bisa diisi oleh
   drafter.** Tabel koleksi → ruangan → item desain, persetujuan klien, tugas
   gambar, revisi, dan pertanyaan sudah diterapkan (P4, P6). Isinya hari ini:
   **1 klien, 5 proyek, 0 koleksi, 0 ruangan, 0 item, 0 tugas gambar, 0
   revisi.**
2. **Kenapa `/produksi/desain` tidak ada input** (F246): layar itu hanya bisa
   membuat tugas dari daftar *gambar belum punya tugas*, dan daftar itu
   dihitung dari item yang sudah disetujui, ditawarkan, atau dipesan. Item
   desain hanya bisa dibuat di tab Design halaman proyek
   (`/proyek/order/[code]`), dan menu Projects hanya terbuka untuk akses
   `project` atau `marketing`. Drafter memegang akses `production`, jadi
   **drafter tidak bisa sampai ke tempat item dibuat**, dan layarnya sendiri
   menunggu item yang tidak pernah ada. Lingkarannya tertutup.
3. **Yang belum ada sama sekali**, dibandingkan permintaan:
   - **Spesifikasi terstruktur** per item. Hari ini hanya ukuran, qty, dan
     satu catatan bebas.
   - **DWG dan foto item** sebagai jenis file. PDF dan DWG dari gambar yang
     sama tidak bisa diikat sebagai satu revisi.
   - **Revisi untuk render dan foto.** Revisi hanya ada untuk gambar kerja dan
     gambar jadi, dan hanya punya satu langkah: *rilis*.
   - **Ditolak dengan alasan.** Persetujuan klien hanya *disetujui* atau
     *ditarik*, per item, tidak per revisi. Tidak ada *ditolak*, tidak ada
     *minta revisi*, tidak ada pemeriksaan internal sebelum ke klien.
   - **BOM sebelum dipesan.** Item baru menjadi produk (dan bisa punya BOM)
     setelah ada baris order. Padahal BOM dibutuhkan untuk menghitung harga
     quotation.
   - **Penugasan ke orang.** Pemegang tugas gambar adalah teks bebas, tanpa
     tanggal tenggat yang bisa diisi dari layar, dan **tidak terhubung ke
     tugas HRD**. Jadi pekerjaan drafter tidak muncul di `/hrd/tugas`,
     notifikasi, rencana harian, laporan harian, Roadmap, maupun KPI.
4. **Usulan: satu modul *Studio Desain* (`/desain`)** yang menjadi tempat
   kerja drafter dari klien sampai file terakhir, memakai tabel yang sudah ada,
   dan menambah empat hal: spesifikasi, *jalur file* dengan revisi dan review
   untuk setiap jenis file, BOM per item, dan **tugas gambar yang sekaligus
   tugas HRD**. Dikerjakan dalam enam sesi (§6). Sesi pertama hampir tanpa
   migrasi dan langsung membuka input.

---

## 1. Yang sudah ada dan tetap dipakai

| Bagian | Di mana | Tetap? |
|---|---|---|
| Klien dan proyek | `ops_procure.clients`, `projects` | Ya. Studio membaca, tidak menggandakan |
| Koleksi → ruangan → item, nomor `26003-A-LR-01` | `0222`, D379 | Ya, ini tulang punggungnya |
| Status item dibaca, bukan diketik (CONCEPT · DRAWN · APPROVED · QUOTED · ORDERED · DROPPED) | `0222`, `0225` | Ya |
| File per item, folder Drive `<klien>/<proyek>/KOLEKSI …/<ruangan>/<item>` di DRAFTING | `0217`, `0222`, D313 | Ya, ditambah subfolder per jalur |
| Tugas gambar, revisi berfile, rilis, pertanyaan yang menahan rilis | `0226`, D179 | Ya, diperluas |
| Persetujuan klien append-only, tidak wajib | `0222`, D378 | Ya, dipindah ke tingkat revisi |
| Quotation mengunci gambar yang dihargai | `0225` | Ya |
| Produk + BOM berversi, tarif BOM, AI membaca gambar kerja | `/produksi/bom`, D256, D324 | Ya, dibuka dari item |
| Tugas HRD: sasaran, notifikasi, rencana harian, laporan harian, Roadmap, KPI | `0210`, `0215`, `0230`, `0214`, D382 | Ya, tugas drafter masuk ke sini |

Yang sengaja **tidak** dibuat: tabel klien kedua, tabel tugas kedua di luar
HRD, status yang diketik, integrasi CAD. Revisi tetap file yang diunggah
dengan nomor (D179).

---

## 2. Bentuk modul

### 2.1 Menu dan layar

Satu menu baru **Desain** (di atas Produksi), dibuka oleh `may_design('read')`
(penjual dan drafter, sama seperti tabelnya):

| Layar | Isinya |
|---|---|
| `/desain` | **Ruang kerja.** Kiri: pohon Klien › Proyek › Koleksi › Ruangan, dengan tombol *+* di setiap tingkat. Tengah: item di ruangan itu (status, kelengkapan file, tugas, tenggat). Kanan / halaman: item |
| `/desain/item/[item_no]` | **Halaman item**, enam tab: Ringkasan · Spesifikasi · File & revisi · BOM · Tugas · Riwayat |
| `/desain/tugas` | **Papan drafter.** Antrean (yang tertahan, yang lewat, yang belum dipegang), dan **beban per drafter** per minggu. Pengganti `/produksi/desain`, yang dialihkan ke sini |

Klien baru tetap dibuat di master data klien. Dari pohon, *+ Klien* membuka
form yang sama (satu sumber).

### 2.2 Jalur file (file track)

Satu item punya beberapa **jalur**, masing-masing dengan revisi sendiri:

| Jalur | Isi satu revisi | Siapa yang menggambar |
|---|---|---|
| Gambar kerja | **PDF wajib + DWG** (DWG diikat ke revisi yang sama) | drafter |
| Render | satu atau beberapa gambar | drafter / 3D |
| Gambar jadi / foto item | foto produk jadi atau foto sampel | produksi / drafter |
| Dari klien | gambar & referensi klien | klien (diunggah TALA) |

PDF dan DWG **satu revisi, dua file**. Pemeriksa membaca PDF, bengkel dan
drafter berikutnya membuka DWG. Revisi B tanpa DWG boleh diunggah, tetapi
ditandai *DWG belum ada* dan tidak bisa dirilis ke bengkel (default Q76).

Jalur jadi kolom `track` di tugas gambar yang sudah ada
(`design_tasks.kind` diperluas: `gambar_kerja`, `render`, `foto_item`).
Satu revisi bisa membawa beberapa file lewat tabel kecil
`design_revision_files (revision_id, attachment_id, role pdf|dwg|image)`.
Jenis file baru: `dwg` dan `foto_item`, keduanya ke DRAFTING, dengan baris
`drive_paths` supaya file jatuh di
`…/<item>/GAMBAR KERJA/REV B`, `…/<item>/RENDER/REV A`, `…/<item>/FOTO`.

### 2.3 Siklus revisi dan rekam jejak

```
diunggah ──▶ diajukan ──▶ dicek internal ──▶ dikirim ke klien ──▶ disetujui ──▶ dirilis ke bengkel
                 │               │                    │
                 └── ditolak ◀───┴──── minta revisi ◀─┘   (alasan wajib)
```

- Setiap langkah adalah **baris baru** di `design_reviews`
  (append-only): revisi, sisi (`internal` / `klien`), keputusan
  (`disetujui` / `minta_revisi` / `ditolak`), **alasan wajib kalau bukan
  disetujui**, kategori alasan, catatan, siapa, kapan, lewat apa (untuk
  klien: WhatsApp, meeting, email, tanda tangan), dan bukti (file).
- **Status revisi dibaca dari baris terakhir**, tidak disimpan (A3).
- Revisi baru menggantikan yang lama hanya di tampilan *terbaru*. Riwayatnya
  tetap: rev A ditolak 2 Okt *“tinggi sandaran 85 terlalu tinggi”*, rev B
  disetujui 5 Okt. Itu jawaban untuk *version history*.
- `design_approvals` (persetujuan per item, `0222`) dibaca sebagai review
  klien atas revisi terbaru saat itu. Tidak ada data yang perlu dipindah
  karena tabelnya masih kosong di produksi.
- Kategori alasan (default Q77): **kesalahan gambar** · **perubahan dari
  klien** · **masukan desain** · **teknis produksi**. Ini yang membuat KPI
  adil (lihat §3).

### 2.4 Spesifikasi

Tab Spesifikasi berisi baris terstruktur per kelompok, bukan satu kotak teks:

| Kelompok | Contoh baris |
|---|---|
| Dimensi | P × L × T (sudah ada), tinggi dudukan, kedalaman dudukan |
| Material | Rangka: kayu mahoni oven · Panel: plywood 18 mm |
| Finishing | Duco putih doff · bisa memilih resep finishing yang ada (`finishing_recipes`) |
| Hardware | Engsel Blum soft-close × 4 · rel tandem 450 |
| Kain / kulit | kode kain, supplier, kebutuhan meter |
| Catatan teknis | bebas |

Tabel `design_item_specs (item_id, grp, label, value, sort)`. Setiap
perubahan masuk audit dan tampil di Riwayat. Revisi gambar kerja yang
diajukan **mencatat spesifikasi saat itu** (snapshot jsonb di baris revisi),
supaya *“rev B dibuat dengan finishing apa”* tetap bisa dijawab setelah
spesifikasinya diubah.

### 2.5 BOM per item

- Tab BOM membuka editor BOM `/produksi/bom` yang sama, untuk produk item
  itu. Kalau item belum punya produk, tombol **Buat produk & BOM** membuat
  produk dari item (nama, ukuran, kategori) dan mengisi `design_items.product_code`.
  Default Q75: boleh sebelum dipesan, produknya ditandai *dari desain* dan
  tidak tampil di katalog aktif sampai dipesan.
- BOM revisi mencatat **revisi gambar kerja asalnya**. Kalau gambar kerja
  sudah rev C dan BOM terakhir dari rev B, item menampilkan **BOM tertinggal
  dari gambar** (pola yang sama dengan *revisi belum dirilis*, D179).
- AI pembaca gambar kerja (D324) diberi PDF revisi terbaru item, bukan file
  yang dipilih manual.

---

## 3. Terhubung ke tugas HRD

Ini bagian yang owner tekankan, jadi bentuknya dipilih supaya **tidak ada dua
daftar tugas**.

1. **Satu tugas gambar = satu tugas HRD per putaran.** Saat tugas gambar
   ditugaskan ke karyawan dengan tenggat, database membuat baris
   `ops_hr.tasks` dengan `ref_kind = 'design_task'` (nilai enum baru, dipakai
   di migrasi berikutnya, F161) dan `ref_no = <nomor tugas gambar>`:
   - judul: *Gambar kerja 26003-A-LR-01 Sofa 3 dudukan — rev B*
   - hasil yang diserahkan: *revisi diunggah dan diajukan*
   - tenggat: tenggat tugas gambar
   - sasaran (goal): proyek itu, kalau HRD sudah membuatnya sebagai sasaran
2. **Sinkron satu arah, dari desain ke HRD**, dengan trigger seperti
   `task_notify` (0215):
   - drafter **mengajukan** revisi → tugas HRD **selesai**, catatan
     penyerahan berisi nomor revisi dan tautan item;
   - revisi **ditolak / minta revisi** → **tugas HRD baru** untuk putaran
     berikutnya, ke drafter yang sama, dengan alasan penolakan sebagai detail
     dan tenggat baru (default: +3 hari kerja, bisa diubah sebelum disimpan);
   - pemegang atau tenggat diubah di Studio → `edit_task` di HRD.
3. Karena tugasnya tugas HRD biasa, **semua yang sudah dibangun langsung
   berlaku**: lonceng dan Google Chat (D374), *Profil → Tugas* dan *Hari ini*,
   rencana harian per tugas (D384), laporan harian (D371), Roadmap/Gantt
   (D382), sasaran & prioritas (D367), dan KPI ketepatan waktu.
4. **KPI yang adil.** Putaran yang dibuka karena **perubahan dari klien** atau
   **masukan desain** adalah pekerjaan baru, bukan kegagalan. Yang dihitung
   melawan drafter hanya putaran karena **kesalahan gambar** (default Q77).
   Ketepatan waktu dihitung dari tanggal *diajukan*, bukan *disetujui*,
   karena lamanya klien menjawab bukan kerja drafter (default Q78).
5. **Drafter lepas** tetap boleh (D264): pemegang teks bebas tanpa tugas HRD,
   dan papan menandainya *di luar HRD*.
6. Di HRD, baris tugas desain membawa tautan **Buka di Studio**, dan HRD
   tidak bisa menutupnya sendiri (refused `managed_by_design`) supaya kedua
   daftar tidak pernah berbeda.

---

## 4. Papan drafter: koordinasi tugas dan tenggat

`/desain/tugas` menjawab tiga pertanyaan koordinator drafter:

1. **Apa yang macet?** Menunggu jawaban (pertanyaan terbuka, D179),
   menunggu review internal lebih dari 2 hari, menunggu klien lebih dari 5 hari.
2. **Apa yang lewat atau hampir lewat?** Tenggat dari tugas, Job Order
   terbuka, atau target proyek (sudah dihitung `needed_by`, `0226`).
3. **Siapa yang penuh, siapa yang kosong?** Beban per drafter per minggu:
   jumlah tugas terbuka dan yang jatuh tempo minggu ini, dari tugas HRD-nya.
   Tugas yang belum dipegang bisa diseret ke orang yang kosong.

Tanpa estimasi jam. Beban dibaca dari jumlah tugas dan tenggat, karena jam
gambar tidak pernah dicatat dan menebaknya membuat angka yang tidak bisa
dibela (pola D261).

---

## 5. Hak akses

| Siapa | Baca | Ubah item, spesifikasi, unggah | Review internal | Catat review klien | Tugaskan & tenggat |
|---|---|---|---|---|---|
| Drafter (`production.update`) | ya | ya | — | — | ambil tugas sendiri |
| Kepala drafter / pimpinan (`production.review`, izin baru) | ya | ya | **ya** | ya | **ya** |
| Penjual / PM (`may_sell`) | ya | item & spesifikasi | — | **ya** | minta tugas |
| HRD (`hr.*`) | tugas desain di `/hrd/tugas` | — | — | — | lihat, tidak menutup |

Default Q74: pemeriksa internal adalah pemegang izin baru `production.review` dan
pimpinan. Harga quotation tidak terlihat oleh drafter (sudah begitu, `0222`).

---

## 6. Urutan kerja: enam sesi

| # | Sesi | Migrasi | Hasil yang bisa dicoba |
|---|---|---|---|
| **S1** | **Ruang kerja dan input.** Menu Desain, `/desain` dengan pohon klien › proyek › koleksi › ruangan › item dan tombol tambah di setiap tingkat; halaman item memakai bagian yang sudah ada (fakta, file, persetujuan, tugas gambar). `/produksi/desain` mendapat tombol *Tugas baru* dan tenggat yang bisa diisi | kecil: `set_design_task_due` | drafter bisa mengisi dari nol tanpa akses proyek. **Menutup F246** |
| **S2** | **Tugas gambar = tugas HRD.** Pemegang sebagai karyawan, enum `design_task`, trigger sinkron, putaran, tautan dua arah, papan drafter dengan beban per orang | ya | tugas drafter muncul di `/hrd/tugas`, lonceng, Roadmap, KPI |
| **S3** | **Jalur file, revisi, dan review.** Jalur gambar kerja (PDF + DWG), render, foto; `design_revision_files`; `design_reviews` dengan alasan wajib; jenis file `dwg`, `foto_item`; subfolder Drive per jalur dan revisi | ya | rekam jejak disetujui/ditolak per revisi |
| **S4** | **Spesifikasi terstruktur** dan snapshot spesifikasi per revisi | ya | tab Spesifikasi |
| **S5** | **BOM per item.** Produk dari item sebelum dipesan, BOM tahu revisi gambar asalnya, *BOM tertinggal dari gambar* | ya | tab BOM, harga quotation dari BOM item |
| **S6** | **Riwayat item** (view gabungan seperti `v_project_timeline`) dan walk bersama tim drafter | view | tab Riwayat, catatan perbaikan dari walk |

S1 tidak menunggu jawaban §7. S2 menunggu Q74, Q78, Q80. S3 menunggu Q76 dan
Q77. S5 menunggu Q75.

---

## 7. Pertanyaan untuk owner, dengan default

| # | Pertanyaan | Default sampai dijawab |
|---|---|---|
| Q74 | Siapa yang memeriksa gambar sebelum dikirim ke klien? | Kepala drafter (izin baru `production.review`, diberikan IT di Users & access) dan pimpinan. Pemeriksaan internal **boleh dilewati** dengan catatan, seperti persetujuan klien (D378) |
| Q75 | Boleh item dibuatkan produk + BOM sebelum dipesan? | Ya, ditandai *dari desain* dan tidak tampil di katalog aktif sampai dipesan |
| Q76 | Gambar kerja tanpa DWG boleh dirilis ke bengkel? | Tidak. Boleh diunggah dan diajukan, tetapi rilis butuh DWG |
| Q77 | Kategori alasan penolakan, dan mana yang dihitung melawan drafter? | Empat kategori: kesalahan gambar · perubahan dari klien · masukan desain · teknis produksi. Hanya *kesalahan gambar* yang dihitung di KPI |
| Q78 | Tugas HRD drafter selesai saat revisi **diajukan** atau saat **disetujui**? | Saat diajukan. Putaran berikutnya adalah tugas baru |
| Q79 | Klien → koleksi tanpa proyek (owner menulis klien → koleksi)? | Tetap klien → proyek → koleksi (D379). Koleksi katalog sendiri memakai proyek internal *TALA KATALOG* |
| Q80 | Menu sendiri *Desain*, atau tetap di bawah Produksi? | Menu sendiri, dibuka untuk penjual dan drafter. `/produksi/desain` dialihkan ke `/desain/tugas` |

---

## 8. Risiko

- **Dua daftar tugas.** Kalau HRD bisa menutup tugas desain sendiri, kedua
  daftar akan berbeda dalam seminggu. Karena itu sinkronnya satu arah dan HRD
  ditolak menutupnya (§3.6).
- **Banyak file per item.** 40 item × 4 jalur × 3 revisi = 480 file per
  proyek. Struktur folder per jalur dan revisi (§2.2) membuat Drive tetap bisa
  dibaca tanpa aplikasi.
- **Data kosong.** Modul baru tidak berguna sampai satu proyek nyata diisi.
  Usul: S1 langsung dicoba dengan satu proyek yang sedang digambar minggu ini,
  oleh drafter sendiri.
