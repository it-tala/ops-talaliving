# Studio Desain: progres dan kelengkapan kerja drafter, kajian 9 Okt 2026

Kajian ini sudah dijawab owner pada hari yang sama: **D398–D404** di
`docs/plan/06-decisions.md`. Isi di bawah adalah bentuk yang diputuskan.

Preview yang bisa diklik: `docs/analysis/2026-10-09-studio-desain-preview.html`.

**Permintaan owner (9 Okt):** *klien → koleksi gambar → set ruangan → item.
Per item ada spesifikasi, BOM, gambar kerja PDF, DWG, render, foto item. Tiap
file ada revisi dan rekam jejak. `/produksi/desain` tidak ada input.
Koordinasi tugas dan deadline tim drafter, terhubung ke task monitoring HRD.*
Lalu: *buat lebih sederhana. Data seakurat mungkin, kerja sesedikit mungkin.
Intinya track progress dan track kelengkapan hasil kerja.*

**Jawaban owner atas Q74–Q80:**

| | Jawaban | Keputusan |
|---|---|---|
| Q74 | *tidak ada final, hanya versi terbaru saja* | D398 |
| Q75 | *ya, untuk quotation ke klien* | D399 |
| Q76 | *tidak, jangan wajibkan sehingga tidak error* | D400 |
| Q77 | *HRD hanya memantau* | D401 |
| Q78 | *semua kotak terisi* | D402 |
| Q79 | *pakai proyek* | D403 |
| Q80 | *di bawah desain saja* | D404 |

Versi-versi sebelumnya (dengan review, Final, dan kategori alasan) ada di
riwayat git cabang ini.

---

## 0. Ringkas

1. **Kenapa `/produksi/desain` tidak ada input** (F246). Tabelnya sudah ada di
   produksi tapi kosong: 1 klien, 5 proyek, 0 koleksi, 0 item, 0 tugas gambar.
   Antrean hanya membuat tugas dari item yang disetujui, ditawarkan, atau
   dipesan. Item hanya bisa dibuat di halaman proyek, dan menu Projects
   tertutup untuk drafter.
2. **Setiap item punya enam kotak.** Kotak terisi saat ada file atau isinya.
   **Yang berlaku selalu versi terbaru** (D398). Progres adalah jumlah kotak
   yang terisi, dan tidak pernah diketik.
3. **Drafter hanya mengunggah.** Versi A, B, C, siapa, dan kapan tercatat
   sendiri.
4. **Tidak ada yang wajib** (D400). Kotak kosong tidak menahan quotation,
   order, BOM, atau Job Order. Kosong hanya terlihat di progres.
5. **Tugas drafter dibuat dari Desain sebagai tugas HRD.** Tugas selesai
   sendiri saat semua kotaknya terisi (D402). HRD hanya memantau (D401).
6. **Tempatnya layar Desain yang sudah ada** di bawah Produksi (D404).

---

## 1. Enam kotak per item

| Kotak | Terisi saat | Yang tampil |
|---|---|---|
| Gambar kerja (PDF) | ada file PDF | versi terbaru + riwayat |
| DWG | ada file DWG | versi terbaru + riwayat. Ditandai kalau versinya tertinggal dari PDF |
| Render | ada gambar render | versi terbaru + riwayat |
| Foto item | ada foto produk / sampel | versi terbaru + riwayat |
| Spesifikasi | kolom spesifikasi berisi teks | teks terbaru + riwayat versi |
| BOM | produk item punya BOM di `/produksi/bom` | revisi BOM terbaru dan biaya per unit. Dibaca dari modul BOM |

Setiap kotak punya tiga keadaan: **kosong**, **terisi** (dengan versi
terbarunya), atau **tidak perlu**. *Tidak perlu* adalah satu ketukan, catatan
boleh kosong, dan dihitung terisi. Tujuannya supaya item yang memang tanpa
render tetap bisa 6/6 (D400, D402).

**Progres item** = kotak terisi / 6. Progres ruangan, koleksi, proyek, dan
drafter dijumlahkan dari kotak yang sama. Tidak ada angka yang disimpan dua
kali (A3).

## 2. Versi dan rekam jejak, otomatis

- **Unggah ke kotak yang sudah berisi = versi berikutnya.** A, B, C diberi
  otomatis. Nama file tidak penting, dan drafter tidak mengetik nomor. File
  lama tetap ada sebagai riwayat, di folder item yang sama di Drive (D313).
- Yang tercatat sendiri: siapa, kapan, dan nomor versi. **Catatan opsional**
  per versi (*apa yang berubah*, *masukan klien*) untuk yang mau menulis.
  Catatan ini tidak pernah wajib.
- **Versi terbaru yang berlaku** (D398), termasuk untuk bengkel. Untuk item
  Studio Desain, langkah *rilis* D179 tidak dipakai lagi.
- **DWG dicek silang terhadap PDF tanpa kerja tambahan:** *DWG versi A, PDF
  sudah versi B*. Ini sekadar tanda, tidak menahan apa pun.

## 3. BOM untuk quotation (D399)

- Kotak BOM kosong → tombol **Buat produk & BOM**. Produk dibuat dari nama,
  ukuran, dan kategori item, ditandai *dari desain*, dan tidak tampil di
  katalog aktif sampai dipesan. Editor BOM-nya tetap `/produksi/bom`,
  termasuk AI pembaca gambar kerja yang diberi PDF versi terbaru.
- Biaya per unit dari BOM tampil di kotak dan dipakai quotation *Dari desain*
  (`0225`), sehingga penawaran ke klien bisa dihargai sebelum ada order.

## 4. Tugas dan tenggat (D401, D402)

- Di Desain, koordinator menugaskan **satu ruangan** (atau satu item, kalau
  ruangan dibagi) ke satu drafter dengan satu tenggat. Itu menjadi tugas HRD
  biasa (`ref_kind` desain), misalnya *Desain 26003-A Living room: 3 item, 18
  kotak*.
- **Progres tugas dibaca dari kotak** (misalnya *11 / 18 terisi*). Tugas
  **selesai sendiri** saat semua kotak di lingkupnya terisi. Tanggal selesai
  adalah tanggal kotak terakhir terisi.
- Versi baru sesudah selesai hanya menambah riwayat. Tugasnya tidak dibuka
  lagi.
- **HRD hanya memantau:** tugas tampil di `/hrd/tugas`, Profil → Tugas,
  Roadmap, lonceng, rencana harian, dan KPI ketepatan waktu. HRD tidak
  membuat, mengubah, atau menutupnya.

## 5. Layar (D404)

`/produksi/desain` (menu Produksi → Design) diganti isinya dengan dua tab:

| Tab | Isinya |
|---|---|
| **Ruang kerja** | Kiri: klien › proyek › koleksi › ruangan, dengan tombol tambah di setiap tingkat. Tengah: item di ruangan itu, enam kotak kecil, dan progres. Klik item: enam kotak dengan versi terbaru, riwayat, Unggah, dan Tidak perlu. Tugaskan ruangan + tenggat |
| **Progres** | Per proyek dan ruangan (terisi, drafter, tenggat), per drafter, dan daftar *yang masih kosong mendekati tenggat* |

Menu tetap di Produksi. Pembacanya diperluas ke penjual (`may_design`),
supaya PM juga bisa melihat kelengkapan sebelum membuat quotation.

## 6. Tiga sesi

| # | Sesi | Database | Hasil |
|---|---|---|---|
| **S1** | **Ruang kerja dan enam kotak** di `/produksi/desain`: pohon dengan tombol tambah, unggah = versi otomatis, *tidak perlu*, progres item / ruangan / proyek, tanda DWG tertinggal, *Buat produk & BOM* | jenis file `dwg` dan `foto_item` ke DRAFTING; kolom `design_items.spec` (riwayat lewat audit); `design_slot_skips` (append-only); view `v_design_item_progress`; produk *dari desain* | drafter mengisi dari nol, progres dan kelengkapan terbaca. **Menutup F246** |
| **S2** | **Tugas dari Desain ke HRD:** tugaskan ruangan / item + tenggat, progres di tugas HRD, selesai sendiri, HRD baca saja; tab Progres per drafter | enum `ref_kind` desain (dipakai di migrasi berikutnya, F161); trigger dari unggahan dan *tidak perlu* | pekerjaan drafter terpantau di HRD tanpa input HRD |
| **S3** | **Unggah massal per ruangan:** file dicocokkan ke item lewat nomor item di nama file (`26003-A-LR-01.dwg`), yang tidak cocok ditanyakan. Lalu walk dengan tim drafter | — | puluhan file sekali seret |

Tabel antrean lama `0226` (`design_tasks`, `design_revisions`,
`design_questions`) kosong di produksi dan tidak dipakai layar baru. Tabel itu
dibiarkan, tidak dihapus. Persetujuan klien per item (`0222`, D378) tetap ada
di laci item di halaman proyek dan bukan bagian dari kotak kelengkapan.
