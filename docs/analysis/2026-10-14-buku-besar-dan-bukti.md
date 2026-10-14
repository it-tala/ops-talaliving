# Buku besar dan bukti: dari dokumen di Chat sampai cashflow pimpinan, kajian 14 Okt 2026

> Owner (2026-10-14): *Review bagaimana keuangan kita dicatat. Seharusnya
> setiap pengeluaran atau pembayaran yang dilakukan oleh akunting memiliki
> dokumen seperti invoice, nota, receipt, faktur, surat jalan, payment proof,
> foto item, receiving report atau TTB (tanda terima barang). Setiap pembayaran
> harus bisa direfleksikan bahwa pembayaran ini merujuk ke PR mana, approval
> yang mana, project apa, vendor apa, PO yang mana. Setiap pembayaran dipecah
> menjadi beberapa baris transaksi tergantung jenis transaksinya — admin fee,
> pajak, item yang dibeli — yang setiap item itu diambil harganya dan disimpan
> sebagai referensi harga di masa depan. Setiap baris transaksi bisa menampilkan
> buktinya dan dicatat lengkap tanpa harus berpindah halaman untuk memudahkan
> audit.*
>
> Hasil yang diharapkan: *di ledger pimpinan bisa melihat semua pencatatan
> dokumen lengkap; tahu total pengeluaran berdasarkan kategori, project,
> perpindahan uang antar rekening, biaya bank, overhead, biaya tetap bulanan;
> bisa menebak apakah cashflow masih aman untuk berapa bulan ke depan.*

Status: **kajian**. Tidak ada kode dan tidak ada migrasi di sesi ini. Angka di
§3 dibaca dari produksi pada 14 Okt 2026. Urutan kerja di §8, pertanyaan untuk
owner di §9; Q92–Q96 dijawab hari yang sama (D433), rekomendasi kategori dan
pajak dari setahun transaksi di §10.

> **Pembaruan 14 Okt: jawaban owner atas Q92–Q96 (D433).**
> - **Q92 (pajak)** — *akunting biasanya sulit membedakan jika total nilai
>   pembayaran sudah termasuk pajak, jadi butuh pembagiannya atau setup nilai
>   berdasarkan persentase, misal nilai barang 112.000 jika pajak 12% maka
>   nilai di ledger adalah item 1 50, item 2 50, PPN 12 — ini yang saya belum
>   tentukan. Nanti coba lihat dari transaksi beberapa bulan terakhir.* →
>   dilihat, §10.2: pembagian **dari persentase, dipilih per transaksi**, tidak
>   otomatis.
> - **Q93 (kategori)** — *review semua transaksi setahun ini dan berikan
>   rekomendasimu. Kamu boleh mengkategorikan ulang karena akunting kami pun
>   ragu, asalkan masih selaras dengan tujuan kita.* → §10.1: kategori per
>   jenis transaksi **plus** pemindahan jenis untuk baris yang deskripsinya
>   jelas salah tempat, menunggu Q97–Q98.
> - **Q94 (kelengkapan dokumen)** — *tidak perlu dipaksakan di kode; ini hanya
>   akan membuat user bingung jika data tidak lengkap sementara harus segera
>   diinput.* → §6.6 **dicoret**: tidak ada aturan per jenis, tidak ada
>   *lengkap/kurang*, COMPLETED tetap seperti `0103`. Yang tersisa dari L8
>   hanya jenis dokumen `faktur_pajak`, `ttb`, dan label *Surat jalan*.
> - **Q95 (berapa bulan)** — *akunting saja; 064 kita tidak punya catatan
>   transaksinya, hanya file yang diunggah EJO ke Chat.* → §6.9 memakai saldo
>   PETTY CASH + BNI 325 + BCA 271 + JAGO saja, satu angka.
> - **Q96 (tanpa PR)** — *tidak perlu sama sekali.* → ringkasan pimpinan tidak
>   menjumlah *pembelian tanpa permintaan*; petunjuk kecil di baris buku besar
>   (D83/D88) tidak disentuh.

Ketentuan owner saya beri nomor supaya bisa dirujuk:

| | Ketentuan |
|---|---|
| **K1** | Setiap pengeluaran punya dokumen: invoice, nota, receipt, faktur, surat jalan, payment proof, foto item, receiving report, TTB |
| **K2** | Setiap pembayaran merujuk ke PR, approval, proyek, vendor, PO |
| **K3** | Pembayaran dipecah per baris menurut jenisnya (admin fee, pajak, item); harga per item disimpan sebagai referensi |
| **K4** | Setiap baris bisa menampilkan buktinya, lengkap di satu halaman |
| **K5** | Pimpinan: dokumen lengkap; total per kategori, proyek, transfer antar rekening, biaya bank, overhead, biaya tetap; cashflow aman berapa bulan |

---

## 0. Jawaban singkat

**Kerangkanya sudah ada, dan sebagian besar jalan — tapi jalur yang paling
sering dipakai (dokumen dari Google Chat) melewati hampir semua kaitan yang
K2 dan K3 minta, dan satu kunci JSON yang salah membuat semua dokumen dari
Chat tercatat sebagai "nota".**

Yang sudah benar dan dipakai:

- **Tidak ada baris tanpa dokumen** (D85). Sejak impor spreadsheet berhenti
  (22 Sep), **159 dari 160 baris** di buku besar punya minimal satu dokumen,
  dan **semua** punya rincian baris dengan harga satuan.
- **Satu jalur dari uang ke dokumen**: transaksi → alokasi → baris PR → PO,
  dengan `post_from_line` (bayar dari baris PR) dan `post_to_po`. Dokumen
  PR-nya ikut terbaca dari drawer transaksi (`reachedFrom`).
- **Verifikasi** (`/accounting/verifikasi`) menerima dokumen dari Chat dan
  membukukannya dengan rincian baris; admin fee sudah datang sebagai baris
  terpisah dari ekstraksi john-lau.
- **Cashflow pimpinan** (D392) sudah menghitung minggu kapan uang habis
  (`runs_out_week`, `runway_weeks`), dengan proyeksi vs aktual.

Yang belum, dan ini yang kajian ini usulkan dikerjakan:

1. **Jenis dokumen dari Chat hilang di pintu masuk** — john-lau mengirim
   `doc_type` ("Payment Proof"), ops membaca `doc_kind`; yang tidak ketemu
   jatuh ke `nota`. Akibatnya bukti transfer, rekening koran, dan foto barang
   dari Chat semua tercatat "nota" (F272). Perbaikan satu baris, dampaknya
   semua angka kelengkapan dokumen di §3 menjadi benar.
2. **Pembayaran dari Chat tidak pernah menyebut PR/PO/approval.** Dari 86
   baris keluar yang masuk lewat Chat sejak 22 Sep, **1** yang dialokasikan ke
   PR, **1** yang punya proyek. Mekanismenya ada (`post_from_line`), tapi
   verifikasi tidak punya jalan *"bayar baris PR yang sudah disetujui"* —
   yang ada *"buat PR susulan"* (D94, beli dulu baru minta).
3. **Harga per item tidak tersimpan sejak 21 Sep.** `item_id` di baris
   transaksi hanya terisi oleh impor legacy (1.218 baris); semua jalur hidup
   (Chat, manual, PO) menulis `item_id` kosong, sehingga `item_purchases` dan
   `last_price` katalog tidak belajar apa pun dari pembayaran nyata —
   bertentangan dengan D86.
4. **Baris transaksi tidak punya jenis** (item / admin fee / pajak / ongkir /
   diskon). Admin fee hanya bisa dikenali dari teks deskripsi.
5. **Tidak ada kategori pengeluaran untuk pimpinan.** 18 `transaction_types`
   dibawa apa adanya dari spreadsheet (Q10); tidak ada yang menandai mana
   overhead, biaya tetap, gaji, transfer, bank. Tidak ada layar total per
   kategori/proyek; likuidasi per transfer (D106) masih demo-only.
6. **Faktur pajak dan TTB** belum punya jenis dokumen; surat jalan vendor
   difile sebagai *Delivery Note*; TTB ada di penerimaan procurement, bukan
   di baris pembayaran.
7. **Cashflow berhitung dalam minggu, tanpa kategori.** Pimpinan belum bisa
   membaca *"dengan overhead + gaji rata-rata 3 bulan terakhir, kas cukup N
   bulan tanpa pemasukan"*.

Usulan §6 berpegang pada bentuk yang sudah ada — satu seam tulis
(`post_transaction`), bukti per transaksi dengan penunjuk per baris, kategori
sebagai atribut jenis transaksi (bukan kolom baru per baris) — supaya setiap
langkah kecil, bisa dicek di browser, dan tidak menyentuh 3.400 baris lama.

---

## 1. Bagaimana uang dicatat hari ini

Empat pintu menulis ke `ops_acct.transactions`, semuanya lewat satu seam
`post_transaction` (`0021`, `0034`):

| Pintu | Jalan | Yang terisi otomatis |
|---|---|---|
| **Google Chat → verifikasi** | john-lau mengekstrak (Gemini) → `file_evidence` (`0038`) → `evidence_inbox` → orang membukukan di `/accounting/verifikasi` lewat `book_evidence` (`0124`) / `book_evidence_group` (`0161`) / `link_evidence` (`0162`) | vendor (nama), tanggal, jumlah, baris (deskripsi, qty, harga), `source_ref = inbox:…` |
| **Bayar dari baris PR** | papan PR → `post_from_line` (`0034`, `0145`) | vendor (baris PR atau PO-nya, D297), proyek (dokumen PR), alokasi `pr_line_no`, nomor baris di deskripsi |
| **Bayar PO** | tracker → `post_to_po` (`0139`) | alokasi `po_no`, satu baris generik *"Pembayaran po-…"* |
| **Entri baru** | `/accounting/ledger` → `NewEntry` | semua diketik; tidak ada kolom proyek; tidak ada item picker |

Pintu kelima, **impor spreadsheet** (`supabase/import/03_ledger.sql`,
`source_ref = legacy:…`), **berhenti 22 Sep 2026** (baris terakhir
`trx_date` 21 Sep, dibukukan 22 Sep). Sejak itu buku besar ops adalah
satu-satunya catatan — 160 baris dalam tiga minggu, dari Chat 96, manual 28,
crosscheck 1 Okt 36, PO 2. Pipeline john-lau sendiri sudah `INGEST_ONLY=1`
sejak 25 Sep: tidak menulis sheet, tidak mencocokkan PR, tidak menanyakan
duplikat (`services/pipeline_cycle/main.py:49-58`).

Bukti menempel **per transaksi** (`attachment_links.entity = 'transaction'`),
lewat `EvidenceStrip` dengan lima kotak untuk uang keluar — Nota, Invoice
(opsional), Bukti transfer, Foto barang, Receiving report (opsional) — dan
dua untuk uang masuk. Posting menolak baris tanpa satu pun dari nota /
transfer_proof / goods_photo / rekening_koran (D85, `0034:146-166`);
COMPLETED menuntut nota atau bukti transfer (`0103`). Dokumen yang menempel
di baris PR yang dibayar ikut tampil di drawer transaksi (`reachedFrom`,
`TrxDrawer.tsx:148`).

Rincian baris (`transaction_lines`: `item_id`, deskripsi, qty, uom,
`unit_price`, `amount`) ditulis hanya di `post_transaction`; tipe pembelian
wajib punya baris yang jumlahnya = jumlah transaksi (`0021:95-129`).

Pimpinan membaca: saldo per rekening (`v_account_balance`, D87/D391), saldo
sebelum/sesudah per baris (D429), cashflow mingguan 12 bulan (D392),
kalender tagihan (D109–D115), register langganan (D366), rekening koran
(D180). Likuidasi per transfer (D106) hanya ada di demo (`listFundings`
tidak ada di `src/lib/api/accounting.ts`).

## 2. Pipeline john-lau: apa yang diekstrak, apa yang sampai

Dibaca dari `/home/user/john-lau` (kode saja, tidak dijalankan).

- **Masuk**: Workspace Events → Pub/Sub → `POST /pubsub` di
  `services/chat_gateway/main.py:147-213`. Space akuntansi `spaces/AAQAkScgGDA`
  hanya memicu ekstraksi lebih cepat; space penerimaan `spaces/AAQAiO_aiOA`
  satu-satunya yang dikecualikan (`extractor.py:696-713`). Siapa pun anggota
  space boleh mengirim. Dedup: `raw_events.source_ref` unik; SHA-256 file
  hanya menandai `duplicate_suspect`, tidak memblokir.
- **File** ke Google Drive folder `TRANSACTIONS/YYYY-MM`, bukan Supabase
  storage (`capture.py:39,740`); nanti dinamai ulang
  `RECEIPT|PAYMENT|RECEIVE|OTHERS_<desc>_<vendor>_<amount>_<date>`.
- **Ekstraksi**: Gemini `gemini-3.1-flash-lite`, satu panggilan per file,
  prompt warisan n8n (`extractor.py:231-384`) diperkaya daftar vendor /
  proyek / item dari `ops_procure.extraction_reference()`. Satu baris per
  item dokumen dengan kolom: DOCUMENT TYPE, DOCUMENT DATE, PROJECT,
  DESCRIPTION, REMARK, VENDOR, QTY, UNIT, PRICE, IDR AMOUNT, TYPE OF
  TRANSACTION, ACCOUNT, IN/OUT, RECEIPT/INVOICE NO., DATE RECEIVED, QTY
  RECEIVED, AI CONFIDENCE. Aturan prompt yang relevan: **admin fee menjadi
  baris sendiri bertipe BANK CHARGES** (`:279`), diskon baris negatif,
  rekening koran satu baris per mutasi, valuta asing tanpa IDR AMOUNT.
  Jenis dokumen hanya empat: `Receipt / Invoice / Nota | Payment Proof |
  Receiving Item | Others` — surat jalan menjadi *Receiving Item*, PO dan
  penawaran menjadi *Others*.
- **Yang dikirim ke ops** (`ops_inbox.py:343-388`, `file_evidence`):
  ref_id, nama file, link Drive, pelapor, mime, ukuran, sha256, arah uang
  (hanya kalau semua baris sepakat), dan `extracted = {vendor_name,
  document_date, amount_idr, doc_type, confidence, note, lines[] (enam kunci
  yang sama + money_direction), lines_total_idr, space}`.
- **Yang diekstrak tapi tidak dikirim**: ACCOUNT, TYPE OF TRANSACTION,
  PROJECT, QTY, UNIT, PRICE, RECEIPT/INVOICE NO., REMARK, DATE/QTY RECEIVED,
  status NEEDS CORRECTION, `duplicate_suspect`, dan **caption pesan** (dibuat
  di `_berkas`, dibuang di `file_document`, `ops_inbox.py:198` vs `374-385`).
- **Yang tidak pernah diekstrak**: total dokumen untuk cek jumlah baris
  (backlog §14), PPN/pajak sebagai kolom, mata uang, nomor rekening, nomor
  PO/PR/SJ, subjenis surat jalan / TTB / faktur.
- **Yang mati di bawah INGEST_ONLY**: pencocokan caption `pr-…-Lxx` ke
  baris PR (`payments.py:27-84`), `proof_match`, filter baris mustahil
  (baris saldo rekening koran, pasangan OUT/IN yang saling meniadakan —
  backlog §21), dan **penangkapan harga per item ke `item_purchases` di
  pusher** (`pusher.py:739-763`).
- Komentar di `ops_mirror.py:37-49` masih mengatakan ops berjalan di fixture
  dan inbox belum pernah dirender — **usang**: produksi menyimpan 254 baris
  inbox sejak 17 Agu, 170 CONFIRMED, 37 PENDING.

## 3. Angka dari produksi (14 Okt 2026)

Seluruh buku besar: 3.436 baris non-void (3.085 keluar, 351 masuk), Rp 8,0 M
keluar. Yang membedakan masa adalah pintunya, jadi dua potret:

**Seluruh masa** — 393 dari 3.085 baris keluar punya dokumen (13%); 1.279
punya rincian baris; 306 teralokasi (265 ke PR, 79 ke PO); 650 punya proyek.
Sebagian besar sisanya adalah warisan spreadsheet (`UNTRACKED` 1.804 baris
Jan–Jun).

> **Sore hari yang sama (D435 butir 4):** angka *seluruh masa* di atas
> mengukur tabel legacy, bukan sheet-nya. Sheet `2026 TALAHOME LEDGERS`
> membawa 3.814 tautan Drive yang tidak pernah diimpor (F273); setelah
> langkah 13 ladder impor, baris 2026 tanpa dokumen tinggal **137** dari
> 3.448 (Jan 14 · Mar 1 · Mei 2 · Jun 82 · Jul 19 · Agu 7 · Sep 11 · Okt 1),
> dan hampir semuanya transfer antar rekening, tarik tunai, saldo awal, dan
> biaya bank. Angka *sejak impor berhenti* di bawah tidak berubah.

**Sejak impor berhenti (trx_date > 21 Sep, 160 baris)**:

| Pintu | Baris | Rp | Ada dokumen | Nota/invoice | Bukti transfer | Keduanya | Foto/RR | Ke PR/PO | Proyek | >1 baris |
|---|---|---|---|---|---|---|---|---|---|---|
| Chat, keluar | 86 | 227 jt | 86 | 86 | 9 | 9 | 5 | **1** | **1** | 45 |
| Crosscheck 1 Okt, keluar | 33 | 105 jt | 32 | 22 | 15 | 5 | 15 | 0 | 0 | 1 |
| Manual, keluar | 18 | 56 jt | 18 | 17 | 2 | 1 | 2 | 0 | 0 | 3 |
| Chat, masuk | 10 | 159 jt | 10 | 10 | 0 | — | — | — | 0 | 2 |
| Manual, masuk | 10 | 195 jt | 10 | 10 | 0 | — | — | — | 0 | 0 |

Dua hal yang angka ini sembunyikan, dan dua-duanya ketahuan dari sampel:

- **"Nota" 86 dari 86 di jalur Chat bukan karena semuanya nota.** Sampel 14
  Okt: *Transfer BCA ke BNI (Pesangon)* dengan `doc_type` *Payment Proof* dan
  *bank statement TRF/PAY/TOP-UP* keduanya menempel sebagai `nota`. Lihat §4
  K1 dan F272.
- **Kolom "bukti transfer" di jalur Chat (9) sebenarnya adalah dokumen kedua
  yang ditautkan orang**, bukan hasil klasifikasi.

Rincian baris: 1.453 baris total; `item_id` terisi **1.218 — semuanya dari
impor legacy** (trx_date ≤ 21 Sep); Chat 156, manual 40, crosscheck 37, PO 2
baris: **`item_id` nol**. Harga satuan terisi di semua jalur hidup.

Inbox (`evidence_inbox`): 254 baris, semua `origin = chat`; CONFIRMED 170,
REJECTED 38, PENDING 37, ATTACHED 5, NOTED 4; `produced_pr_line_no` **0** —
jalan *"PR susulan"* belum pernah dipakai. Kunci `extracted` yang ada:
`note, doc_type, document_date, confidence, amount_idr, vendor_name, space,
lines (169 dari 254), lines_total_idr` — **tidak ada `doc_kind`**.

Rekening koran: 0 statement diunggah. Cashflow: `cashflow_lines` dan
`cashflow_openings` ada, dipakai pimpinan. Jenis transaksi: 18 kode aktif,
`auto_complete` mati semua (D26); tidak ada atribut kategori.

## 4. Evaluasi per ketentuan

### K1 — setiap pengeluaran punya dokumen

**Ada**: aturan D85 (tidak ada dokumen, tidak ada baris) dan ini terbukti —
159/160 sejak 22 Sep. Jenis dokumen `nota`, `invoice`, `transfer_proof`,
`goods_photo`, `receiving_report`, `delivery_note`, `surat_jalan`,
`rekening_koran` ada di `ops_core.doc_kind_t`. Satu dokumen bisa menutup
beberapa baris (`link_evidence`, `book_evidence_group`), dan cakupannya
terbaca (D206/D207).

**Sebagian**:

- *Satu dokumen cukup.* Lima kotak di `EvidenceStrip` adalah daftar cek
  visual, bukan aturan. Pembelian dari supplier dengan nota tanpa bukti
  transfer dan tanpa foto barang tetap COMPLETED (sejak 22 Sep: 86 baris
  Chat keluar, 9 punya nota **dan** bukti transfer).
- *Jenis dokumen dari Chat hilang* (F272): `book_evidence` membaca
  `extracted ->> 'doc_kind'` (`0124:166`), john-lau mengirim `doc_type`
  (`ops_inbox.py:374-385`); fallback-nya `'nota'`. `link_evidence` (`0162`)
  sudah memetakan `doc_type` dengan benar, `book_evidence` tidak. Maka
  bukti transfer dari Chat tercatat nota, dan `complete_transaction` (yang
  menuntut nota **atau** bukti transfer) tidak bisa membedakan keduanya.
- *Surat jalan* ada sebagai `surat_jalan` di database tetapi tidak ada di
  `DOC_KINDS` TypeScript; di layar ia difile sebagai *Delivery Note*. Dari
  Chat ia menjadi *Receiving Item* → `goods_photo`.

**Belum ada**: jenis `faktur_pajak` dan `ttb`. TTB hari ini hidup di
penerimaan procurement (`receipts`, `0017`, `0203`) — benar tempatnya (TTB
adalah bukti barang diterima, bukan bukti bayar), tapi baris pembayaran
belum menunjukkan *"barang untuk pembayaran ini sudah diterima, TTB-nya
ini"* kecuali lewat baris PR.

### K2 — pembayaran merujuk ke PR, approval, proyek, vendor, PO

**Ada**: `vendor_id`, `project_id` di transaksi; `payment_allocations`
(`pr_line_no`, `po_no`); `post_from_line` mengisi vendor + proyek + alokasi
sekaligus; drawer membuka baris PR di tempat dan membaca dokumennya.
Approval tersimpan append-only di `ops_procure.pr_approvals` (siapa, kapan,
`channel`, jumlah disetujui).

**Sebagian**:

- Approval **tidak terbaca dari baris buku besar**: drawer hanya tahu
  `line_status` lewat `v_allocation`; tidak ada nama penyetuju, tanggal,
  dan jumlah yang disetujui di samping jumlah yang dibayar.
- Satu transaksi = satu vendor, satu proyek. Pembayaran yang menutup baris
  dua proyek (jarang, tapi ada: satu transfer ke supplier untuk dua PR)
  hanya bisa menyebut satu.
- Proyek tidak ada di kolom tabel buku besar, tidak ada di form Entri baru,
  tidak ada di fakta drawer (walau bisa diedit).

**Belum ada, dan ini yang paling besar**: **jalur Chat tidak menyentuh PR**.
Dari 86 baris keluar lewat Chat, 1 teralokasi. Verifikasi punya lima jalan
(D94) — buat transaksi, PR susulan, tautkan ke baris, catat, tolak — dan
**tidak satu pun "bayar baris PR yang sudah disetujui"**. Padahal sebagian
besar nota dari Chat adalah pembayaran untuk permintaan yang sudah disetujui
di papan PR; hari ini orang harus membukukannya sebagai transaksi polos lalu
(kalau ingat) membuka papan PR untuk mengalokasikan. Caption `pr-…-L01`
yang dulu dicocokkan john-lau (`payments.py:27-84`) sekarang tidak sampai ke
ops sama sekali.

### K3 — dipecah per baris menurut jenis; harga item disimpan

**Ada**: beberapa baris per transaksi dengan qty × harga satuan, wajib
berjumlah sama dengan transaksi; admin fee datang sebagai baris sendiri dari
ekstraksi; `item_id` dan `item_purchases` (`0168`) + `v_purchase_facts` +
`items.last_price` / `standard_price` (model dua harga, M3).

**Sebagian / belum**:

- **Baris tidak punya jenis.** `transaction_lines` tidak punya kolom *item /
  admin fee / pajak / ongkir / diskon*. Admin fee hanya dikenali dari
  deskripsi (*"Transfer admin fee"*); tidak ada yang bisa menjumlah *biaya
  admin bulan ini* tanpa membaca teks. Prompt john-lau justru memisahkan
  admin fee menjadi **transaksi** BANK CHARGES sendiri di sheet lama, tapi
  ke ops ia datang sebagai **baris** di transaksi yang sama (benar untuk
  saldo, tapi tipenya ikut tipe induk, misalnya RECCURING - PAYROLL).
- **Pajak**: D163 memutuskan *tidak ada PPN/PPh di procurement dan buku
  besar; pajak milik konsultan*. Konsekuensinya PPN di nota masuk ke harga
  barang, dan referensi harga tercampur antara vendor PKP dan non-PKP.
  Ketentuan K3 owner hari ini menyebut pajak sebagai baris sendiri — ini
  **membuka kembali D163** untuk satu hal sempit: pajak sebagai *baris
  informasi* di pembayaran (supaya harga item bersih dan jumlah pajak
  terjumlah), **bukan** perhitungan pajak (Q92).
- **`item_id` tidak pernah ditulis oleh jalur hidup** (§3). Form verifikasi
  dan Entri baru tidak punya item picker; `post_from_line` menjatuhkan
  `item_id` yang ada di baris PR; `post_to_po` menulis satu baris generik
  walau PO punya baris ber-item. Maka sejak 21 Sep katalog tidak belajar
  harga dari pembayaran — D86 (*supaya katalog belajar harga terakhir yang
  benar-benar dibayar*) tidak terpenuhi.

### K4 — setiap baris menampilkan buktinya, satu halaman

**Ada**: drawer transaksi memuat baris, alokasi (dengan baris PR yang
terbuka di tempat), dokumen (pratinjau + tautan), riwayat edit, saldo —
tanpa pindah halaman. Dokumen baris PR yang dibayar ikut tampil.

**Sebagian**: bukti menempel per **transaksi**, bukan per baris. Untuk
sebagian besar pembayaran ini sudah tepat — satu nota memuat semua
barisnya. Yang tidak terjawab: transaksi gabungan dari beberapa dokumen
(`book_evidence_group`: satu foto berisi tiga struk), atau satu transfer
yang menutup nota A dan nota B — baris mana dari dokumen mana tidak
tersimpan. `link_entity_t` tidak punya `transaction_line`.

**Belum ada**: ringkasan kelengkapan di tabel (hanya jumlah dokumen);
approval di drawer; proyek di drawer.

### K5 — pimpinan: dokumen lengkap, total per kategori/proyek, berapa bulan

**Ada**: saldo per rekening dan saldo berjalan; baris akun pimpinan hanya
untuk `approve_funds`; cashflow 12 bulan mingguan dengan vonis
aman/tipis/kurang dan minggu kapan uang habis; `CASHFLOW` sebagai transfer
antar rekening sendiri (`cashflow_settings.transfer_types`); `BANK CHARGES`
sebagai tipe; kalender tagihan tetap/estimasi; langganan; unduh Excel.

**Sebagian**:

- **Kategori**: satu-satunya penggolongan adalah `cashflow_lines.category`
  (client, capital, payroll, bills, subscription, vendor, tax, loan, …) —
  untuk *rencana*, bukan untuk baris buku besar. 18 `transaction_types`
  tidak bergolongan: tidak ada yang bilang RECCURING - UTILITIES adalah
  biaya tetap, OFFICE adalah overhead, EJO adalah pinjaman/pribadi (94
  baris, Rp 316 jt keluar, Rp 229 jt masuk — tidak pernah diklasifikasi,
  Q10).
- **Per proyek**: `ops_prod.v_project_cost.ledger_spend` (`0066`) hanya untuk
  proyek yang punya work order; 650 baris berproyek tidak punya layar
  rekap.
- **Likuidasi** (per transfer: dipakai untuk apa, per tipe/vendor/proyek,
  D106) **demo-only**.
- **Berapa bulan**: cashflow menjawab dalam minggu dari rencana yang
  diketik; belum ada angka sederhana *"pengeluaran rutin rata-rata 3 bulan
  terakhir = X/bulan; kas accounting ÷ X = N bulan"* yang berdiri sendiri
  dari rencana.

**Belum ada**: layar pimpinan yang memuat *semua* pencatatan dengan
dokumennya dan kelengkapannya; laporan pengeluaran per kategori per bulan;
P&L (D162: sengaja — cashflow + buku besar menggantikannya; kajian ini
tidak membuka itu).

## 5. Temuan yang tercatat dari kajian ini

- **F271** — kajian ini.
- **F272** — `book_evidence` membaca `doc_kind`, bot mengirim `doc_type`;
  semua dokumen dari Chat menjadi `nota`. Lihat `findings.md`.
- Komentar `ops_mirror.py` di john-lau usang (ops "di fixture") — dicatat di
  §2, tidak ada akibat.
- Pasangan OUT/IN yang saling meniadakan dan baris saldo dari rekening
  koran lolos ke inbox karena filter baris mustahil mati di jalur mirror
  (backlog john-lau §21) — terlihat di sampel *"bank statement
  TRF/PAY/TOP-UP"* yang dibukukan sebagai nota IN 3 jt.

## 6. Rancangan

Prinsip: pakai bentuk yang ada. Satu seam tulis; bukti per transaksi; jenis
transaksi tetap 18 kode warisan (data, D-Q10) dan **kategori adalah atribut
kode itu**, bukan kolom baru di 3.400 baris; angka pimpinan dihitung dari
baris, tidak disimpan.

### 6.1 Jenis dokumen dari Chat (F272) — perbaikan, bukan fitur

`book_evidence` dan `book_evidence_group` memetakan `doc_type` seperti
`link_evidence` sudah melakukannya: *Payment Proof* → `transfer_proof`,
*Receiving Item* → `goods_photo`, *Receipt / Invoice / Nota* → `nota`,
*Others* → `other`; `doc_kind` eksplisit menang kalau ada. Plus satu
koreksi data satu kali untuk 102 baris `inbox:` yang sudah dibukukan, dari
`evidence_inbox.extracted ->> 'doc_type'` (migrasi dengan audit, bukan
`update` telanjang). Setelah ini angka §3 kolom *Bukti transfer* menjadi
jujur.

### 6.2 Jenis baris: item · admin fee · pajak · ongkir · diskon · lainnya

`transaction_lines.kind` (enum, default `item`), diisi oleh
`post_transaction` dari `p_lines[].kind`; verifikasi dan Entri baru punya
pilihan per baris; `book_evidence` menebak `fee` untuk baris yang
deskripsinya *admin fee* / *biaya admin* dari ekstraksi. Aturan jumlah
tidak berubah (Σ baris = jumlah). Yang dibuka: `item_purchases` hanya
membaca `kind = 'item'`; total *biaya admin bulan ini* dan *pajak yang
dibayar* menjadi satu query. Pajak sebagai baris **informasi** (Q92),
tidak dihitung dari apa pun.

### 6.3 Item di baris pembayaran → referensi harga

Tiga tempat, satu arah:

1. `post_from_line` membawa `item_id` baris PR ke baris transaksi (sudah
   ada di `pr_lines.item_id`, dijatuhkan sekarang).
2. `post_to_po` menulis baris transaksi dari baris PO yang dibayar (item,
   qty, harga) bila pembayaran menutup PO penuh; termin tetap satu baris
   generik dengan `kind = 'other'`.
3. Verifikasi dan Entri baru: **item picker** per baris (katalog
   `ops_procure.items`, `extraction_reference` sudah memberi daftar yang
   sama ke Gemini — nama item hasil ekstraksi dicocokkan ke katalog sebagai
   usulan, orang mengonfirmasi, A13). Baris tanpa item tetap boleh (`kind
   = 'item'`, `item_id` null) — dicatat sebagai *tidak di katalog*, dan
   `creates_catalog_item` pada tipe SUPPLIERS/ONLINE/CHINA/PRODUCTION
   akhirnya dipakai: tawarkan *tambahkan ke katalog*.

Setelah ini `item_purchases` dan `last_price` hidup lagi dari uang yang
benar-benar keluar, dan drawer item menunjukkan *terakhir dibayar Rp X
kepada V pada tanggal T, trx-…*.

### 6.4 Jalan keenam di verifikasi: "bayar baris PR yang sudah disetujui"

Dokumen dari Chat yang vendornya punya baris PR APPROVED belum dibayar
(`v_line_funding.covered < approved`) → verifikasi menawarkan baris itu
(vendor sama, jumlah ±toleransi, terbaru di atas); memilihnya memanggil
`post_from_line` dengan dokumen inbox sebagai buktinya dan menandai inbox
CONFIRMED + `produced_pr_line_no`. Proyek, vendor, alokasi terisi sendiri.
John-lau meneruskan **caption** pesan ke `extracted.caption` (satu baris di
`ops_inbox.py`); kalau caption memuat `pr-…-Lxx`, baris itu dipilih
duluan. Ini menutup K2 untuk jalur yang paling ramai tanpa mengubah D94
(beli dulu tetap boleh).

### 6.5 Approval dan proyek di baris buku besar

`v_transaction_detail` ikut membawa, per alokasi, `approved_by`,
`approved_at`, `approved_amount`, `channel` dari `pr_approvals` lewat baris
PR; drawer menampilkannya di *Apa yang dibayar* (*disetujui Evin 3 Okt via
chat, Rp 1.250.000; dibayar Rp 1.250.000*). Kolom **Proyek** di tabel buku
besar dan di fakta drawer; filter proyek dan rentang tanggal di layar (API
sudah punya keduanya, `accounting.ts:285-291`).

### 6.6 ~~Aturan kelengkapan dokumen per jenis transaksi~~ *(Q94: tidak dibangun)*

> Owner: *tidak perlu dipaksakan di kode.* Paragraf di bawah dibiarkan sebagai
> catatan apa yang dipertimbangkan; yang dikerjakan hanya kalimat terakhirnya
> (jenis dokumen baru dan label).

`transaction_types.evidence_rule` (jsonb): dokumen apa yang **diharapkan**
per tipe, misalnya SUPPLIERS: nota + bukti transfer (bukan petty cash) +
foto barang atau receiving report bila ada PO; CASHFLOW: bukti transfer;
BANK CHARGES: rekening koran atau bukti transfer; PAYROLL: run payroll
(sudah, `post_payroll_run`); SUBSCRIPTION: invoice. `v_transaction`
menurunkan `evidence_missing text[]`; tabel menunjukkan *lengkap* atau
*kurang: bukti transfer*; COMPLETED menuntut lengkap (memperluas `0103`).
Posting **tidak** diblokir (A6) — yang berubah hanya kapan sebuah baris
boleh dianggap selesai. Jenis dokumen baru: `faktur_pajak`, `ttb`; label
*Surat jalan* di `DOC_KINDS`; pemetaan Chat *Receiving Item* → `surat_jalan`
bila ekstraksi membaca kata *surat jalan / delivery order*, selain itu
`goods_photo`.

### 6.7 Penunjuk bukti per baris (opsional per baris)

`transaction_lines.attachment_id` (nullable, harus salah satu dokumen yang
menempel di transaksinya — dicek oleh seam). `book_evidence_group` mengisi
ini sendiri (baris dari struk ke-2 menunjuk foto ke-2). Drawer menampilkan
ikon dokumen di baris, klik → pratinjau dokumen itu. Tidak ada entitas
tautan baru; bukti tetap milik transaksi.

### 6.8 Kategori pengeluaran untuk pimpinan

`transaction_types.category` (enum: `vendor` pembelian barang/jasa untuk
proyek atau stok · `overhead` kantor, transport, online · `fixed` listrik,
air, internet, sewa, langganan · `payroll` · `bank` · `transfer` antar
rekening sendiri · `loan` EJO/pinjaman · `tax` · `other`) diisi sekali per
kode (18 baris, Q93 untuk EJO dan OTHERS), bisa diubah di Master data.
`cashflow_settings.transfer_types` dibaca dari sini (`category = 'transfer'`)
supaya dua tempat tidak berbeda. Baris dengan `kind = 'fee'` dihitung ke
`bank` dan `kind = 'tax'` ke `tax` apa pun tipe induknya.

Layar baru **`/accounting/ringkasan`** (`approve_funds`): bulan × kategori
(12 bulan, kolom = kategori, sel bisa diklik → daftar baris dengan dokumen
dan kelengkapannya), per proyek (semua proyek yang punya baris, bukan hanya
yang punya work order; ongkos vs nilai kontrak bila ada), per vendor
teratas, transfer antar rekening (keluar dari mana masuk ke mana, selisih
= uang di jalan), biaya bank. Semua dari `v_transaction`; Excel per tabel
(D427). Likuidasi (D106) **dibangun di sisi nyata** sebagai tab di sini,
bukan layar sendiri.

### 6.9 Berapa bulan

Di `/accounting/cashflow` (D392) satu kartu baru, dihitung dari buku besar
bukan dari rencana: *burn* = rata-rata bulanan 3 bulan terakhir dari
kategori `fixed + overhead + payroll + bank + loan` (bukan `vendor`, bukan
`transfer`); *kas* = saldo rekening accounting saja — PETTY CASH, BNI 325, BCA 271, JAGO
(Q95: BCA 064 tidak punya catatan transaksi, hanya file dari EJO); **N bulan**
= kas ÷ burn, dengan dua angka pembanding: *tanpa pemasukan* dan *dengan
pemasukan rata-rata 3 bulan*. Vonis mingguan
yang ada tetap — angka ini adalah jawaban satu baris untuk pertanyaan
*masih aman berapa bulan*, dan ia berubah sendiri begitu kategori (6.8) dan
jenis baris (6.2) terisi.

### 6.10 Pipeline john-lau: lebih banyak yang sampai

Satu PR di john-lau: `file_document` meneruskan `caption`, `account`,
`transaction_type`, `project`, `invoice_no`, `duplicate_suspect`, dan per
baris `qty`, `unit`, `price` ke `extracted`; `doc_kind` dipetakan di sisi
john-lau juga (ganda tidak merugikan); filter baris mustahil dinyalakan di
jalur mirror. Ops membaca semuanya sebagai **usulan** di verifikasi (akun
dan tipe terisi, orang mengonfirmasi, A13) dan menyimpan `invoice_no` ke
`transactions.remark` sampai ada kolomnya. Komentar usang di `ops_mirror.py`
dihapus.

## 7. Yang sengaja tidak diusulkan

- **P&L / laporan keuangan akrual** — D162 tetap; semua angka di §6
  berbasis kas dari buku besar.
- **Perhitungan PPN/PPh** — D163 tetap; pajak hanya baris informasi (Q92).
- **Mencocokkan saldo dengan rekening koran / hitung fisik kas** — owner
  menolak di D430; tidak diusulkan ulang.
- **Bukti wajib per baris** — bukti tetap milik transaksi; per baris hanya
  penunjuk (6.7). Satu nota untuk lima baris adalah bentuk yang benar.
- **Kategori per baris transaksi** — kategori adalah atribut jenis
  transaksi; baris hanya punya `kind`. Kalau suatu hari satu transaksi
  harus terbagi dua kategori, itu dua transaksi (sudah bisa).
- **Memindahkan ekstraksi dari john-lau ke ops** — pipeline-nya stabil dan
  `INGEST_ONLY` sudah membuatnya sekadar pengantar; yang kurang adalah
  muatan yang diantar (6.10), bukan pengantarnya.
- **Mengisi ulang `item_id` untuk 235 baris sejak 22 Sep** — bisa, tapi
  butuh orang menebak item per baris; lebih jujur mulai dari 6.3 dan
  menawarkan *tautkan ke item* di drawer untuk baris lama bila dibutuhkan.

## 8. Urutan kerja: satu sesi, satu fitur

| # | Fitur | Sesi | Menutup | Prasyarat |
|---|---|---|---|---|
| L3 | 6.1 Jenis dokumen dari Chat (F272) + koreksi 102 baris | ½ | K1 | — |
| L4 | 6.2 Jenis baris `kind` + tebakan admin fee + pilihan di verifikasi/Entri baru | 1 | K3 | Q92 |
| L5 | 6.3 `item_id` dari PR/PO + item picker + usulan dari ekstraksi | 1–2 | K3 | L4 |
| L6 | 6.4 Jalan keenam verifikasi: bayar baris PR yang disetujui (+ caption dari john-lau) | 1 | K2 | — |
| L7 | 6.5 Approval + proyek di drawer dan tabel; filter proyek/tanggal | ½ | K2, K4 | — |
| L8 | 6.6 Aturan kelengkapan per tipe, `faktur_pajak`/`ttb`, label surat jalan, *lengkap/kurang* di tabel | 1 | K1, K4 | L3, Q94 |
| L9 | 6.8 Kategori per jenis transaksi + `/accounting/ringkasan` (+ likuidasi nyata) | 2 | K5 | Q93 |
| L10 | 6.9 Kartu *berapa bulan* di cashflow | ½ | K5 | L9 |
| L11 | 6.7 Penunjuk bukti per baris (grup dokumen) | ½ | K4 | L3 |
| J1 | 6.10 john-lau: muatan ekstraksi yang lebih lengkap + filter baris mustahil | 1 | K2, K3 | — (repo lain) |

L3 duluan karena murah dan membuat semua angka kelengkapan jujur sebelum L8
mengukurnya. L6 dan L7 tidak bergantung apa pun dan langsung terasa di
pekerjaan accounting harian. L9 paling besar dan paling ditunggu pimpinan;
ia butuh jawaban Q93 sebelum mulai.

## 9. Pertanyaan untuk owner

| # | Pertanyaan | Default yang dipakai kalau tidak dijawab |
|---|---|---|
| **Q92** | Pajak sebagai **baris informasi** di pembayaran (jumlah PPN yang tertulis di nota dicatat sebagai baris `tax`, harga item bersih) — tanpa menghitung PPN/PPh apa pun (D163 tetap)? | Ya, baris informasi saja |
| **Q93** | Kategori untuk 18 jenis transaksi, khususnya: **EJO** = `loan` (pinjaman/pribadi) atau `other`? **OTHERS** = `overhead`? **CREDIT CARD** = ikut apa yang dibeli atau `overhead`? **PREPAID VENDOR** dan **CHINA** = `vendor`? | EJO → `loan`, OTHERS → `overhead`, CREDIT CARD → `overhead`, PREPAID VENDOR/CHINA → `vendor` |
| **Q94** | Kelengkapan dokumen untuk **SUPPLIERS**: nota + bukti transfer (kecuali petty cash) + foto barang/receiving report **bila ada PO** — atau foto barang selalu? | Foto barang / RR hanya bila ada PO atau PR berbarang |
| **Q95** | Angka *berapa bulan* (6.9): kas yang dihitung **rekening accounting saja** (PETTY CASH, BNI 325, BCA 271, JAGO) atau **termasuk BCA 064** untuk pembaca `approve_funds`? | Dua angka: accounting saja, dan termasuk pimpinan bila berwenang |
| **Q96** | Pembayaran dari Chat yang **tidak** merujuk PR mana pun setelah L6 — tetap boleh (D94, beli dulu) tanpa peringatan, atau ditandai *tanpa permintaan* lebih tegas di ringkasan pimpinan? | Tetap boleh; ringkasan pimpinan menjumlah *pembelian tanpa permintaan* per bulan |

## 10. Dari setahun transaksi: rekomendasi kategori dan pajak (jawaban Q92–Q93)

Dibaca dari 3.436 baris non-void Jan–Okt 2026 (214 · 275 · 210 · 356 · 301 ·
448 · 675 · 466 · 393 · 98 per bulan). Dua hal yang data itu katakan sebelum
rekomendasi apa pun:

- **Jenis transaksi tidak pernah dipakai sebagai kategori.** Ia dipakai
  sebagai *"dari sheet mana baris ini datang"*. `RECCURING - UTILITIES`
  (151 baris) memuat 38 transfer antar rekening senilai Rp 449 jt (*TF FROM
  BCA 064*), 10 baris gaji Rp 128 jt, BPJS, konsultan pajak, sewa rumah
  Saripan — dan listrik. `SUPPLIERS` memuat 100 baris bensin, 49 galon, 27
  transfer internal, 15 baris gaji. `CASHFLOW` memuat 591 transfer internal
  **dan** 33 pemasukan dari luar senilai Rp 1,03 M. Memberi satu kategori per
  jenis saja akan mewarisi semua salah tempat itu.
- **Yang tercampur dapat dipisahkan dari deskripsinya**, karena orang yang
  mengetik selalu menulis *TF FROM*, *WITHDRAWAL*, *BENSIN*, *PAYROLL*,
  *ADMIN FEE*. Pola-pola itu konsisten sepanjang tahun (tabel di bawah).

### 10.1 Kategori yang diusulkan, dan ke mana 18 jenis masuk

Sembilan kategori — cukup untuk pertanyaan pimpinan (K5), tidak lebih:

| Kategori | Isi | Masuk hitungan *burn* (§6.9)? |
|---|---|---|
| `transfer` | perpindahan uang antar rekening sendiri, tarik tunai ke petty cash, konversi USD | tidak |
| `pemasukan` | uang dari klien, modal, pengembalian | tidak (sisi masuk) |
| `vendor` | barang dan jasa untuk produksi/proyek/stok | tidak (ikut proyek) |
| `payroll` | gaji bulanan/mingguan/harian, lembur, uang makan lembur, pesangon, BPJS TK/Kes | ya |
| `tetap` | sewa (rumah, kendaraan), listrik, air, telepon/internet, langganan, konsultan bulanan | ya |
| `overhead` | ATK, kebersihan, bensin, parkir, galon, makan, perlengkapan kantor/gudang | ya |
| `bank` | biaya admin, bunga kartu kredit | ya |
| `pajak` | pembayaran pajak ke negara (termin, SPT) | ya |
| `pribadi` | pengeluaran pimpinan yang dibayar perusahaan (rumah, belanja, kartu kredit pribadi) | **tidak** — dilaporkan terpisah |

Kategori per jenis (bawaan; baris yang jelas salah tempat dipindah jenisnya,
§10.3):

| Jenis | Baris | Keluar | Kategori bawaan | Catatan dari data |
|---|---|---|---|---|
| CASHFLOW | 658 | 2,9 M | `transfer` | 33 baris masuk Rp 1,03 M dari luar (e-banking CR TALA HOME, USD→IDR) → **`pemasukan`** per baris, §10.3 |
| SUPPLIERS | 1.230 | 2,1 M | `vendor` | bensin 100, galon 49, transfer 27, gaji 15, konsultan/pajak 11 → dipindah |
| RECCURING - PAYROLL MONTHLY | 167 | 685 jt | `payroll` | 25 *DAILY PAYROLL WEEK* → PAYROLL WEEKLY; 16 *BIAYA KEBERSIHAN OFFICE* → OFFICE |
| RECCURING - UTILITIES | 151 | 539 jt | `tetap` | 38 transfer Rp 449 jt → CASHFLOW; 10 gaji → PAYROLL; BPJS 10 → payroll; konsultan pajak 7 → tetap (jasa bulanan); rumah Saripan 11 → Q97 |
| RECCURING - PAYROLL | 76 | 438 jt | `payroll` | uang makan lembur 28, satpam; 11 transfer internal → CASHFLOW |
| PREPAID VENDOR | 27 | 414 jt | `vendor` | DP ke pengrajin (Dul Rotan, CN Glass, Jawul) — benar |
| EJO | 94 | 316 jt | `pribadi` | Saripan 48 (rumah + belanja), listrik, warung, kartu kredit; 229 jt masuk = *TF FROM BCA 081 USD* dan pengembalian → `transfer`/`pemasukan` per baris |
| CREDIT CARD | 24 | 253 jt | `transfer` | ini **pelunasan tagihan kartu**, bukan pembelian: *TF TO BCA 271 - CREDIT CARD MANDIRI & BNI* 74 jt, *PAYMENT CREDIT CARD MANDIRI - EJO* 47 jt. Pembeliannya sendiri sudah/semestinya tercatat saat dibayar kartu. Yang pribadi (EJO) → `pribadi` |
| OTHERS | 81 | 108 jt | `overhead` | *TF TO BCA 271* 20 jt → transfer; pesangon 17 jt → payroll; *PAYMENT BALANCE CN GLASS* 17 jt → vendor; listrik Langon 17 jt → Q97; sewa Grandmax → tetap |
| RECCURING - PAYROLL WEEKLY | 5 | 46 jt | `payroll` | — |
| PRODUCTION | 21 | 34 jt | `vendor` | jasa asah, CNC, oven — benar |
| SUBSCRIPTION | 14 | 26 jt | `tetap` | Google, Anthropic, Starlink — benar |
| TRANSPORT | 187 | 23 jt | `overhead` | bensin 124, sewa Grandmax (12) → `tetap` per vendor |
| CHINA | 4 | 20 jt | `vendor` | — |
| ONLINE | 25 | 18 jt | `vendor` | Tokopedia/Shopee — barang; yang ATK → overhead per baris |
| RECCURING - OVERTIME | 36 | 13 jt | `payroll` | — |
| BANK CHARGES | 527 | 9 jt | `bank` | 497 admin fee — benar; 106 di antaranya bernama *PAYROLL* karena fee transfer gaji, tetap `bank` |
| WAREHOUSE | 34 | 9 jt | `overhead` | galon, rumput, paralon — perlengkapan, bukan barang jual |
| OFFICE | 75 | 4 jt | `overhead` | — |

Dua jenis layak **diistirahatkan** (`is_active = false`, data lama tetap):
`EJO` sebagai jenis — karena *siapa* bukan *apa*; pengeluaran pimpinan
dicatat dengan jenis sebenarnya (UTILITIES, SUPPLIERS…) dan kategori
`pribadi` ditentukan oleh **vendor/penerima** (lihat §10.3 butir 7). Dan
`CREDIT CARD` — pelunasan kartu adalah transfer; biaya bunga/admin kartu
adalah BANK CHARGES. Keduanya menunggu Q98.

### 10.2 Pajak (Q92): yang ada di data, dan bentuk yang diusulkan

Setahun, kata *pajak / PPN / PPh / tax / faktur* muncul di **50 baris** (Rp
442 jt), 13 di antaranya di baris rincian. Hampir semuanya **bukan PPN di
nota**: konsultan pajak Subadriyah (jasa bulanan Rp 2 jt), *PAJAK TERMIN 1*
Rp 40 jt, *TAX APRIL–AGST 2026* Rp 24 jt (setoran ke negara lewat
konsultan), dan transfer dana *FOR … TAX CONSULTAN*. Vendor yang sangat
mungkin PKP (PLN, PT Urecel, CV Cintya Box, Telkomsel) dibayar tanpa PPN
disebut. Pengrajin — Dul Rotan, Jawul, Hadi Glass, Kurniawan Plywood,
sebagian besar nilai `SUPPLIERS` — bukan PKP; tidak ada PPN untuk dipisah.

Maka:

1. **Dua hal berbeda, dua perlakuan.** *Setoran pajak ke negara* = baris
   `kind = 'tax'` dan kategori `pajak` (jenis apa pun). *Jasa konsultan* =
   `vendor`/`tetap` biasa. *PPN yang tertulis di nota* = baris `tax` di
   transaksi pembelian itu, kategori ikut induk.
2. **Pembagian dari persentase, dipilih per transaksi, tidak otomatis.** Di
   verifikasi dan Entri baru ada sakelar *Harga sudah termasuk PPN __%*
   (bawaan 12, dari `ops_core.settings.ppn_rate_pct`). Dinyalakan →
   sistem menambah satu baris `tax` = total × r ÷ (100 + r), dibulatkan ke
   rupiah, dan **mengurangi setiap baris item secara proporsional** supaya Σ
   baris tetap = total dan harga item menjadi harga bersih — persis contoh
   owner: 112.000 → item 50.000 + 50.000 + PPN 12.000. Kalau nota
   mencetak angka PPN-nya, angka itu yang diketik dan baris item mengikuti.
   Sakelar mati = nota tanpa PPN (bawaan), tidak ada yang berubah.
3. **Tidak ada perhitungan pajak lain** (PPh, faktur keluaran, kredit pajak)
   — D163 tetap. Yang baru hanya satu baris informasi dan satu pembagian
   aritmetika yang orang pilih.
4. **Tidak ada koreksi ke belakang.** 50 baris yang ada dibiarkan; yang
   terbantu adalah referensi harga item mulai dari sini.

### 10.3 Pemindahan jenis untuk baris yang salah tempat — satu kali, teraudit

Dikerjakan sebagai migrasi yang memanggil `edit_transaction` (atau seam
setara dengan audit `before/after` dan alasan *rekategorisasi D433*), bukan
`update` telanjang; VOID tidak disentuh; baris yang terkait rekening koran
tidak ada (0 statement). Aturan, dengan jumlah yang terkena hari ini:

| # | Aturan (deskripsi, huruf besar) | Dari → ke | Baris | Rp |
|---|---|---|---|---|
| 1 | `TF FROM|TF TO|TRANSFER FROM|TRANSFER TO|WITHDRAWAL|TARIK TUNAI|TOP UP|SETOR|KE PETTY` | UTILITIES 38, SUPPLIERS 27, PAYROLL 11, OTHERS 1, CREDIT CARD 1 → **CASHFLOW** | 78 | 583 jt |
| 2 | `BENSIN|PERTALITE|PERTAMAX|SOLAR|SPBU` | SUPPLIERS 100, OTHERS 11, WAREHOUSE 4 → **TRANSPORT** | 115 | 8 jt |
| 3 | `PAYROLL|GAJI|UPAH|PESANGON|THR` (bukan transfer, bukan admin fee) | UTILITIES 10, SUPPLIERS 15, OTHERS 3 → **RECCURING - PAYROLL** | 28 | 193 jt |
| 4 | `DAILY PAYROLL|WEEKLY` | PAYROLL MONTHLY 25 → **PAYROLL WEEKLY** | 25 | — |
| 5 | `KEBERSIHAN|MASKER|ATK` | PAYROLL MONTHLY 16 → **OFFICE** | 16 | <1 jt |
| 6 | `BPJS` | UTILITIES, OTHERS → **RECCURING - PAYROLL** (kategori payroll) | ~15 | — |
| 7 | vendor/penerima pimpinan: `SARIPAN HOUSE`, `WARUNG KEMBAR`, `EJO`, kartu kredit `- EJO` | jenis tetap; **kategori `pribadi`** lewat daftar penerima pribadi di `ops_acct.cashflow_settings` (bukan per baris) | 94+ | ~350 jt |
| 8 | `PAJAK TERMIN|TAX .* 20\d\d|SPT` | → baris `kind = 'tax'`, kategori **pajak** | 3 | 66 jt |
| 9 | `CASHFLOW` **masuk** yang bukan pola transfer internal | kategori **`pemasukan`** per baris (jenis tetap) | 33 | 1,03 M |

Butir 7 dan 9 menunjukkan batas pendekatan *kategori = atribut jenis*: ada
dua kasus di mana kategori harus bisa **menimpa per baris** (penerima
pribadi; uang masuk dari luar di jenis CASHFLOW). Usulan: kolom
`transactions.category_override` (nullable, enum kategori), diisi oleh
aturan 7 dan 9 dan bisa diubah dari drawer oleh `post_ledger`; `category`
efektif = `coalesce(override, jenis.category)`. Satu kolom, bukan satu per
baris rincian.

Setelah pemindahan, angka yang akan dibaca pimpinan untuk 2026 (perkiraan
dari aturan di atas, sebelum Q97): transfer antar rekening ≈ Rp 3,5 M keluar
/ 6,4 M masuk; vendor ≈ 2,5 M; payroll ≈ 1,4 M; tetap ≈ 0,35 M; overhead ≈
0,07 M; bank ≈ 0,01 M; pajak ≈ 0,07 M; pribadi ≈ 0,35 M; pemasukan ≈ 1,0 M
(+ 393 jt UTILITIES masuk yang sebenarnya transfer). Angka pasti keluar dari
migrasi itu sendiri dan dicek di `/accounting/ringkasan` sebelum diterapkan
ke produksi.

### 10.4 Pertanyaan lanjutan

| # | Pertanyaan | Default |
|---|---|---|
| **Q97** | **Rumah Saripan** (sewa + belanja, 70 baris, ~Rp 75 jt) dan **listrik Langon** (17 jt): pengeluaran perusahaan (mess/kantor → `tetap`) atau pimpinan (→ `pribadi`)? | **Dijawab (D435):** Saripan kategori **sendiri** (`saripan`); Langon `fixed` |
| **Q98** | Setuju jenis `EJO` dan `CREDIT CARD` diistirahatkan (tidak muncul di pilihan baru; data lama tetap), dan pemindahan jenis §10.3 dijalankan sekali dengan audit? | **Dijawab (D435):** **tidak** diistirahatkan — keduanya tetap ada; pemindahan jenis §10.3 tetap, tanpa butir yang mematikan keduanya |

### 10.5 Jawaban owner, 14 Okt sore (D435) — yang berubah di §10

1. **Pajak (§10.2 butir 2 diganti).** *Daripada bawaan 12% lebih baik biarkan
   user input berapa nominal pajaknya.* Tidak ada persentase bawaan, tidak ada
   `ppn_rate_pct`: di verifikasi dan Entri baru ada isian **nominal pajak**
   yang menjadi baris `tax` dan mengurangi baris item sejumlah itu. Contoh
   owner tetap terpenuhi (112.000, pajak diketik 12.000 → item 100.000), dan
   nota yang mencetak PPN-nya diketik apa adanya.
2. **Tagihan USD, dibayar IDR.** *Beberapa transaksi memberikan tagihan dalam
   bentuk USD sementara kita bayar di IDR.* Transaksi menyimpan **mata uang
   dan nilai tagihan** (`billed_currency`, `billed_amount`) di samping
   `amount_idr`; kurs efektif = `amount_idr ÷ billed_amount`, dihitung dan
   ditampilkan, tidak diketik. Pola yang sama dengan order pabrik (D414:
   satu mata uang per dokumen). Referensi harga item dari transaksi semacam
   ini disimpan dalam IDR yang dibayar, dengan mata uang asalnya terlihat.
3. **Nama kategori bahasa Inggris, `pribadi` → `EJO`.** Tabel §10.1 dibaca
   dengan nama: `transfer · income · vendor · payroll · fixed · overhead ·
   bank · tax · EJO`, ditambah **`saripan`** (butir 4). Isi tiap kategori
   tidak berubah.
4. **Saripan kategori sendiri.** Sewa rumah, belanja, listrik, air Saripan
   (70 baris, ~Rp 75 jt setahun) → `saripan`, dilaporkan terpisah seperti
   `EJO`, tidak ikut hitungan *berapa bulan* kecuali pimpinan memilih
   memasukkannya. Aturan §10.3 butir 7 dibagi dua: penerima Saripan →
   `saripan`; penerima pimpinan lain → `EJO`.
5. **Jenis `EJO` dan `CREDIT CARD` tetap ada** (Q98). Kategori bawaan
   keduanya tetap seperti tabel §10.1 (`EJO` → `EJO`; `CREDIT CARD` →
   `transfer`, yang pribadi → `EJO`).

## 11. Memecah yang sudah terlanjur satu: nomor a/b, dan review ulang (D434)

> Owner (2026-10-14): *Beberapa transaksi mungkin sudah terlanjur jadi satu,
> maka saya sarankan untuk menambah nomor id-nya, misal trx-123a dan trx-123b
> — yang a adalah itemnya, yang b jadi admin fee atau pajaknya. Kita perlu
> review ulang semua transaksi yang sudah masuk di Supabase untuk memecahnya
> menjadi detail terkecil setiap item pembayaran. Mungkin untuk invoice dari
> e-commerce tidak perlu, karena di sana ada nilai diskon dan voucher yang
> akan membuat ledger ambigu.*

### 11.1 Ukuran pekerjaannya (produksi, 14 Okt, baris keluar non-void)

| Masa | Baris | Tanpa dokumen | Ada dokumen, 0 baris rincian | Ada dokumen, 1 baris | Ada dokumen, >1 baris | Jumlahnya berakhiran biaya admin (…2.500/…6.500) | E-commerce |
|---|---|---|---|---|---|---|---|
| Jan–Jun | 1.616 | **1.616** → **69** | 0 | 0 | 0 | 0 | 27 |
| Jul–21 Sep | 1.332 | 1.075 → **29** | 16 | 241 | 0 | 49 | 25 |
| Sejak 22 Sep | 137 | 1 | 0 | 87 | 49 | 39 | 1 |

Kolom *tanpa dokumen* diukur pagi hari (tabel legacy) dan sore hari, setelah
tautan dari sheet diimpor (langkah 13, D435 butir 4, F273). Yang tersisa
tanpa dokumen di seluruh 2026 adalah 137 baris (masuk dan keluar), hampir
semuanya transfer, tarik tunai, saldo awal, dan biaya bank.

Tiga hal yang mengubah bentuk tugasnya:

- ~~**Jan–Jun tidak bisa dirinci**: tidak satu pun dari 1.616 baris punya
  dokumen (john-lau baru menangkap sejak Juli).~~ **Tidak lagi berlaku
  (D435):** dokumennya ada di sheet, bukan di tabel legacy, dan sekarang
  tertaut — 1.547 dari 1.616 baris. Jan–Jun masuk antrean seperti bulan
  lain; owner: *review ulang dari transaksi terbaru sampai Januari* (Q100
  dijawab). Memecah tanpa nota tetap menebak: 69 baris Jan–Jun yang tetap
  tanpa dokumen dibiarkan, bertanda *tanpa rincian — tidak ada dokumen*.
- **Yang punya dokumen ada 394 baris** *(pagi; sore: 2.986 baris keluar
  berdokumen sepanjang 2026)*, dan sebagian besar sudah satu baris
  rincian yang benar-benar satu barang (*Aqua galon*, *Sander 180*, *SEWA
  KOMPRESOR 31 AGST–4 SEPT*). Yang perlu dibuka lagi adalah yang dokumennya
  memuat beberapa barang tetapi rinciannya satu baris generik, dan yang
  jumlahnya menyimpan biaya admin (88 baris). Ini pekerjaan beberapa jam
  dengan layar yang tepat, bukan ribuan baris.
- **Biaya admin hari ini dicatat dengan dua cara.** Warisan spreadsheet:
  transaksi `BANK CHARGES` sendiri (497 baris, *ADMIN FEE PAYROLL …*).
  Jalur Chat sejak September: **baris** di transaksi yang sama (182
  transaksi, 49 sejak 22 Sep; hanya 7 `BANK CHARGES` baru). Dua konvensi di
  satu buku adalah sumber ambigu yang owner khawatirkan.

### 11.2 Nomor a/b: sebagai baris, bukan transaksi baru

Yang owner minta — *trx-123a itemnya, trx-123b admin fee-nya* — adalah
persis `transaction_lines` dengan `kind` (§6.2): satu nomor, dua baris
bersaudara. Rekomendasi: **huruf a/b adalah nomor baris, bukan transaksi
terpisah**. Buku besar mendapat tampilan **Rincian** (sakelar di atas
tabel): satu baris layar per baris rincian, bernomor `trx-26-10-14_002-a`,
`-b`, … (diturunkan dari `line_no`, tidak disimpan), dengan jenis baris,
item, jumlah, dan dokumennya; saldo sebelum/sesudah tetap di baris terakhir
transaksinya. Unduh Excel mengikuti tampilan yang aktif (D427).

Kenapa bukan dua transaksi:

- **Uang bergerak sekali.** Satu transfer Rp 1.002.500 adalah satu bukti,
  satu langkah saldo, satu baris rekening koran. Dua transaksi berarti saldo
  *di antara* a dan b yang tidak pernah ada, dan satu bukti yang harus
  ditautkan dua kali.
- **Nomor adalah kunci**: `attachment_links.entity_no`, `payment_allocations`,
  `evidence_inbox.produced_trx_no`, `source_ref` idempoten, dan nomor yang
  orang sebut di Chat semuanya memegang `trx_no`. Nomor berakhiran huruf
  (belum ada satu pun hari ini) akan dibaca sebagai nomor baru oleh semua
  itu.
- **Pajak dan diskon menempel pada pembelian yang sama**: pembagian PPN
  (§10.2) mengurangi baris item secara proporsional — itu hanya bisa terjadi
  kalau item dan pajak satu transaksi.

Konsekuensi yang diterima: untuk biaya admin, **baris** menjadi satu-satunya
konvensi ke depan (497 baris warisan dibiarkan). Kalau rekening koran suatu
hari dicocokkan (`0025`), pencocokan satu baris koran ke transaksi harus
mengizinkan *jumlah koran = jumlah transaksi − baris fee-nya*; dicatat di
sini, dibangun saat dibutuhkan.

### 11.3 Review ulang: layar *Rincian ulang* dan seam `set_transaction_lines`

**L12.** Satu seam `ops_acct.set_transaction_lines(p_trx_no, p_lines, p_reason)`
— mengganti seluruh rincian sebuah transaksi (jenis, item, qty, harga,
jumlah; Σ = jumlah transaksi; `post_ledger`; ditolak pada VOID dan pada baris
yang terkait rekening koran), rincian lama tersimpan di audit `before`,
`transactions.lines_reviewed_at/by` diisi. Dipakai oleh drawer (*Edit
rincian*) **dan** oleh layar antrean **`/accounting/rincian-ulang`**:

- Antrean = baris keluar non-void **dengan dokumen**, **seluruh 2026**
  (D435 butir 6; semula sejak 1 Jul), belum `lines_reviewed_at`, dan (rincian
  ≤ 1 baris **atau** jumlah berakhiran …2.500/…6.500/…5.000 **atau** tipe
  pembelian dengan nota). **Urut terbaru, mundur sampai Januari**; buku 2025
  dan 2024 menyusul bila owner memberikannya, lewat langkah impor yang sama.
  E-commerce (`ONLINE`, vendor Tokopedia/Shopee/Lazada/Blibli) **tidak**
  dirinci per item (owner), tetapi **merekam nilai asli barang dan total
  bayar** (D435 butir 5): paling banyak tiga baris — `item` sejumlah **harga
  tercantum**, `discount` negatif (voucher/potongan), `fee` (ongkir/admin);
  Σ = total dibayar; referensi harga mengambil harga tercantum, bukan harga
  setelah diskon. Baris `discount` negatif diizinkan hanya di transaksi
  e-commerce.
- Layar: dokumen di kiri (pratinjau, semua file transaksi), editor baris di
  kanan: jenis, item (picker katalog, usulan dari deskripsi), qty, harga,
  jumlah, selisih ke jumlah transaksi selalu terlihat; sakelar *termasuk
  PPN r%* (§10.2); tombol *Pisahkan biaya admin* yang memotong …2.500 dari
  baris terakhir menjadi baris `fee`. *Simpan* = `set_transaction_lines`;
  *Sudah benar* = tandai reviewed tanpa mengubah. Antrean menyusut.
- Yang **tidak** dilakukan: mengubah jumlah, tanggal, akun, vendor (itu
  `edit_transaction`); menyentuh baris tanpa dokumen; membuat transaksi
  baru. *(Jan–Jun tidak lagi dikecualikan — D435.)*

Urutan: L12 bergantung pada L4 (jenis baris) dan L5 (item picker); menjadi
sesi ke-3 setelah keduanya, lalu accounting mengerjakan antreannya (±394
baris, sebagian besar *Sudah benar* satu klik).

### 11.4 Pertanyaan

| # | Pertanyaan | Default |
|---|---|---|
| **Q99** | Setuju a/b adalah **nomor baris** di tampilan Rincian (satu transaksi, bukan dua), dan biaya admin ke depan selalu **baris** `fee` di transaksi yang dibayarnya? | Ya |
| **Q100** | Antrean review ulang: **sejak 1 Jul** (394 baris berdokumen) — atau cukup sejak 22 Sep (137)? | **Dijawab (D435):** seluruh 2026, dari yang terbaru mundur sampai Januari; 2025 dan 2024 mungkin menyusul |

