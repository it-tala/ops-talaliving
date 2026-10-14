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
§3 dibaca dari produksi pada 14 Okt 2026. Urutan kerja di §7, pertanyaan untuk
owner di §8.

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

### 6.6 Aturan kelengkapan dokumen per jenis transaksi — peringatkan, jangan blokir

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
`transfer`); *kas* = saldo rekening accounting (+ pimpinan bila
`approve_funds`); **N bulan** = kas ÷ burn, dengan dua angka pembanding:
*tanpa pemasukan* dan *dengan pemasukan rata-rata 3 bulan*. Vonis mingguan
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
