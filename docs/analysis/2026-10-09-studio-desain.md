# Studio Desain: progres dan kelengkapan kerja drafter, kajian 9 Okt 2026

Ini kajian, bukan keputusan. Dokumen ini tidak melahirkan nomor D. Apa pun
yang diputuskan owner setelah membacanya dicatat di `docs/plan/06-decisions.md`.
Pertanyaan di §6 diberi nomor Q74 sampai Q80, masing-masing dengan default.

Preview yang bisa diklik: `docs/analysis/2026-10-09-studio-desain-preview.html`.

**Permintaan owner (9 Okt):** *kita butuh 1 modul di dalam project untuk
project management internal: klien → koleksi gambar → set ruangan → item. Per
item ada spesifikasi, BOM, file gambar kerja PDF, file DWG, gambar render,
gambar item / foto. Tiap file ada revisinya dan rekam jejak (rejected /
approved, reason / note / feedback, version history). `/produksi/desain` tidak
ada input. Koordinasi tugas dan deadline tim drafter, terhubung ke task
monitoring di HRD.*

**Disederhanakan hari yang sama, atas permintaan owner:** *buat lebih
sederhana. Datanya seakurat mungkin, kerjanya sesedikit mungkin. Intinya track
progress dan track kelengkapan hasil kerja.* Versi pertama (jalur review
internal → klien, kategori alasan, snapshot spesifikasi, tugas per putaran,
enam sesi) ada di riwayat git cabang ini. Versi ini menggantikannya.

---

## 0. Jawaban singkat

1. **Kenapa `/produksi/desain` tidak ada input** (F246). Tabelnya sudah ada di
   produksi tapi kosong: 1 klien, 5 proyek, 0 koleksi, 0 item, 0 tugas gambar.
   Antrean hanya membuat tugas dari item yang disetujui, ditawarkan, atau
   dipesan. Item hanya bisa dibuat di halaman proyek, dan menu Projects
   tertutup untuk drafter yang memegang akses produksi.
2. **Satu ide: setiap item punya enam kotak kelengkapan.** Progres tidak
   pernah diketik. Progres dihitung dari kotak yang sudah terisi dan sudah
   final.
3. **Drafter hanya mengunggah file.** Revisi, siapa, dan kapan tercatat
   sendiri dari unggahan. Yang memeriksa cukup menekan **Final** atau
   **Revisi** dengan satu kalimat.
4. **Tugas HRD per ruangan.** Ditugaskan sekali dengan tenggat, progresnya
   ikut kotak, dan **selesai sendiri** saat semua kotak di ruangan itu final.
5. **Tiga sesi** (§5). Sesi pertama membuka input dan kotak kelengkapan.

---

## 1. Enam kotak kelengkapan per item

| Kotak | Terisi kalau | Final kalau |
|---|---|---|
| Gambar kerja (PDF) | ada file PDF | diperiksa → **Final** |
| DWG | ada file DWG | diperiksa → **Final** |
| Render | ada gambar render | diperiksa → **Final** |
| Foto item | ada foto produk / sampel | diperiksa → **Final** |
| Spesifikasi | kolom spesifikasi item berisi teks | diperiksa → **Final** |
| BOM | produk item punya BOM draft di `/produksi/bom` | BOM itu **sudah dirilis**. Dibaca dari modul BOM, tanpa klik tambahan |

Setiap kotak punya satu dari lima keadaan:

| Keadaan | Artinya |
|---|---|
| **Belum** | kosong |
| **Menunggu cek** | ada file terbaru yang belum diperiksa |
| **Revisi** | file terbaru diminta diperbaiki, dengan catatannya |
| **Final** | file terbaru disetujui |
| **Tidak perlu** | kotak ini tidak dibutuhkan untuk item ini, dengan alasan satu kalimat (mis. *desain klien, tanpa render*) |

**Progres item** = kotak Final + Tidak perlu, dibagi 6. Layar menampilkan dua
angka supaya jujur: **terisi** (sudah ada file) dan **final** (sudah
disetujui). *5 terisi · 2 final* berarti drafter sudah bekerja tetapi
pemeriksaan tertinggal. Itu informasi yang hilang kalau hanya ada satu persen.

Progres ruangan, koleksi, proyek, dan drafter dijumlahkan dari kotak yang
sama. Tidak ada angka yang disimpan dua kali (A3).

---

## 2. Revisi dan rekam jejak, otomatis

- **Mengunggah file ke kotak yang sudah berisi = revisi berikutnya.** A, B, C
  diberi otomatis. Nama file tidak penting, dan drafter tidak mengetik nomor
  revisi. File lama tetap ada sebagai riwayat.
- Yang dicatat sendiri: siapa mengunggah, kapan, nomor revisi, dan folder
  Drive (`…/<item>`, sesuai D313).
- **Pemeriksaan satu ketukan:** **Final**, atau **Revisi** + satu kalimat
  (wajib, karena drafter membacanya sebagai instruksi). Setiap ketukan adalah
  baris baru, tidak pernah diedit. Riwayat kotak jadi seperti ini:
  *rev A diunggah Made 30 Sep → Revisi 2 Okt, "sandaran 85 terlalu tinggi,
  minta 78" (Wulan) → rev B diunggah 7 Okt → Final 8 Okt (Wulan).*
- **PDF dan DWG dicek silang tanpa kerja tambahan.** Kalau gambar kerja sudah
  rev B tetapi DWG masih rev A, kotak DWG ditandai *DWG tertinggal dari PDF*.
- **Revisi pada kotak yang sudah Final** (klien berubah pikiran) membuka
  kotaknya lagi. Progres turun, dan alasannya tercatat.

Yang **dibuang** dari versi pertama: tahap internal → klien, kategori alasan,
snapshot spesifikasi per revisi, subfolder Drive per revisi, dan pertanyaan
yang menahan rilis (tugas HRD yang *tertahan* sudah menjawab itu, D367).

---

## 3. Tugas dan tenggat: tugas HRD per ruangan

- Koordinator menugaskan **satu ruangan** (atau satu item, kalau ruangan
  dibagi) ke satu drafter, dengan satu tenggat. Itu langsung menjadi tugas
  HRD biasa (`ref_kind = 'design_room'` / `'design_item'`), misalnya *Desain
  26003-A Living room — 3 item, 18 kotak*.
- **Progres tugas dibaca dari kotak**, misalnya *11 / 18 final*, dan tampil di
  `/hrd/tugas`, *Profil → Tugas*, dan Roadmap. Tidak ada yang mengetik persen.
- **Selesai sendiri** saat semua kotak di ruangan itu Final atau Tidak perlu.
  Tanggal selesai adalah tanggal kotak terakhir final, jadi ketepatan waktu di
  KPI akurat tanpa ada yang menekan *selesai*.
- **Revisi setelah selesai** membuat **tugas revisi** baru untuk drafter yang
  sama. Tenggatnya diisi oleh yang meminta revisi (default +3 hari kerja).
  Tugas lama tetap tercatat selesai tepat waktu.
- Semua fitur HRD yang ada langsung berlaku: lonceng dan Chat (D374), rencana
  harian (D384), laporan harian (D371), tertahan dengan alasan (D367), Roadmap
  (D382), KPI. HRD tidak perlu memasukkan apa pun.

---

## 4. Layar

| Layar | Isinya |
|---|---|
| `/desain` | **Ruang kerja.** Kiri: klien › proyek › koleksi › ruangan, dengan tombol tambah di setiap tingkat. Tengah: item di ruangan itu, masing-masing enam kotak berwarna dan progresnya. Klik item: enam kotak dengan file terbaru, riwayat, dan tombol Unggah / Final / Revisi / Tidak perlu |
| `/desain/progres` | **Progres.** Per proyek dan ruangan (terisi, final, tenggat, drafter), per drafter, dan daftar *menunggu cek* untuk pemeriksa. Pengganti `/produksi/desain`, yang dialihkan ke sini |

Yang dikerjakan setiap orang:

| Siapa | Kerjanya |
|---|---|
| Drafter | unggah file ke kotaknya. Selesai |
| Pemeriksa (kepala drafter / PM) | Final, atau Revisi + satu kalimat |
| Koordinator | tugaskan ruangan + tenggat, sekali |
| HRD | tidak ada. Membaca dan mengejar seperti tugas lain |

---

## 5. Tiga sesi

| # | Sesi | Database | Hasil |
|---|---|---|---|
| **S1** | **Ruang kerja dan kotak kelengkapan.** Menu Desain; pohon dengan tombol tambah; enam kotak per item; unggah = revisi otomatis; Final / Revisi / Tidak perlu; progres item, ruangan, dan proyek | jenis file `dwg` dan `foto_item` ke DRAFTING; kolom `design_items.spec`; tabel `design_checks` (append-only); view `v_design_item_progress` | drafter bisa mengisi dari nol, progres dan kelengkapan terbaca. **Menutup F246** |
| **S2** | **Tugas HRD per ruangan.** Tugaskan + tenggat; progres di tugas HRD; selesai otomatis; tugas revisi otomatis; `/desain/progres` per drafter | enum `design_room` / `design_item` (dipakai di migrasi berikutnya, F161); trigger dari `design_checks` | pekerjaan drafter muncul di HRD tanpa input HRD |
| **S3** | **Unggah massal per ruangan** (file dicocokkan ke item lewat nomor item di nama file, mis. `26003-A-LR-01.dwg`; yang tidak cocok ditanyakan) dan walk dengan tim drafter | — | puluhan file sekali seret |

Tabel antrean lama (`design_tasks`, `design_revisions`, `design_questions`,
`0226`) masih kosong di produksi dan tidak dipakai layar baru. Tabel itu
dibiarkan dulu, tidak dihapus.

---

## 6. Pertanyaan untuk owner, dengan default

| # | Pertanyaan | Default sampai dijawab |
|---|---|---|
| Q74 | Siapa yang boleh menekan Final / Revisi? | Kepala drafter dan pimpinan (izin baru `production.review`). Drafter tidak memfinalkan filenya sendiri |
| Q75 | Item boleh dibuatkan produk + BOM sebelum dipesan (supaya kotak BOM bisa terisi)? | Ya. Produknya ditandai *dari desain* dan tidak tampil di katalog aktif sampai dipesan |
| Q76 | Enam kotak itu wajib untuk setiap item? | Ya, kecuali ditandai *Tidak perlu* dengan alasan satu kalimat |
| Q77 | Tugas HRD per ruangan atau per item? | Per ruangan. Per item hanya kalau satu ruangan dibagi ke beberapa drafter |
| Q78 | Tugas selesai saat semua kotak **terisi** atau saat semua **final**? | Saat semua final. Waktu tunggu pemeriksaan terlihat sebagai *menunggu cek*, jadi pemeriksa ikut terukur |
| Q79 | Klien → koleksi tanpa proyek? | Tetap klien → proyek → koleksi (D379). Koleksi katalog sendiri memakai proyek internal *TALA KATALOG* |
| Q80 | Menu sendiri *Desain*, atau di bawah Produksi? | Menu sendiri untuk penjual dan drafter. `/produksi/desain` dialihkan ke `/desain/progres` |
