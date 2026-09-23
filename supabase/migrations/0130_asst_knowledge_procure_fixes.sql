-- 0130 — the procurement guide, after B5–B8 were fixed.
--
-- 0127 wrote four steps as they stood on the day of the walk, each with a
-- *(sementara)* question saying the step did not work yet. 0128 and 0129 fixed
-- them, so this removes those rows — as 0127 promised — and writes the steps
-- the way they now work: an order line chosen from an approved request line,
-- arrivals that move the request, and an order paid from its own page.
--
-- The walk that proves it is `99_sim_procure_to_ledger`: L01 goes from
-- WAITING FOR APPROVAL to COMPLETED and its order from DRAFT to SETTLED, with
-- one finding left (B9), which gets its own *(sementara)* row below.
--
-- Matched by question text rather than id: ids are identity columns and a
-- migration that names one is a migration that fails on a database where the
-- rows were inserted in another order.

delete from ops_asst.process_faq where question in (
  'Kenapa halaman New request tidak bisa dibuka? (sementara)',
  'Apakah PO otomatis tersambung ke baris PR? (sementara)',
  'Kenapa penerimaan ditolak photo_required padahal foto sudah diunggah? (sementara)',
  'Bagaimana membayar DP PO? (sementara)');

-- ── the order is built from the approved line (B7) ───────────────────────
update ops_asst.process_steps set
  action = 'Buka Procurement → Purchase Orders (atau Tracker), tekan "Add new PO", pilih vendor. Di tiap baris, pilih baris PR yang sudah disetujui di "From request line" — barang, jumlah, satuan dan harganya terisi dari yang disetujui.',
  rule   = 'Hanya baris yang sudah APPROVED yang bisa dipesan (line_not_approved), satu baris PR hanya di satu PO yang masih berjalan (line_already_ordered), dan satuannya harus sama (uom_differs). Baris tanpa jumlah — ongkir, DP — adalah uang, bukan barang: dibayar lewat barisnya, tidak dipesan (lump_sum_line).'
 where process_key = 'procure.create_po' and seq = 1;

update ops_asst.process_steps set
  action = 'Periksa atau lengkapi barisnya: barang, jumlah, satuan, harga satuan. Baris yang tidak berasal dari PR (misalnya kontrak tetap) boleh diketik langsung. Isi persen DP kalau ada uang muka, dan tanggal barang diharapkan datang. Tekan "Create the draft".'
 where process_key = 'procure.create_po' and seq = 2;

-- ── arrivals move the request line (B5, B7) ──────────────────────────────
update ops_asst.process_steps set
  rule = 'Tanpa foto ditolak (photo_required). Dengan foto dan tanda terima sekaligus, penerimaan langsung CONFIRMED. Kalau baris PO dibuat dari baris PR, baris PR-nya ikut bergerak: sebagian datang → PARTIAL; lengkap dan sudah lunas → COMPLETED.',
  status_after = 'penerimaan: CONFIRMED · baris PR: PARTIAL'
 where process_key = 'procure.receive_goods' and seq = 2;

-- ── paying the order from its page (B8) ──────────────────────────────────
insert into ops_asst.processes (key, module, seq, title, purpose, route, permission, follows, sop_ref) values
('acct.pay_po', 'accounting', 55,
 'Membayar PO (DP atau termin) dari halaman PO',
 'Uang muka dan termin PO dibayar dari halaman PO-nya. Satu pembayaran menjadi satu baris buku besar, dan kalau PO dibuat dari baris PR, uangnya dibagi ke baris-baris PR itu sesuai nilainya — jadi halaman PO dan papan Requests menunjukkan pembayaran yang sama tanpa dicatat dua kali.',
 '/procurement/po', 'wewenang post_ledger', 'procure.create_po', 'procurement/06');

insert into ops_asst.process_steps (process_key, seq, route, action, rule, status_before, status_after, writes, screenshot) values
('acct.pay_po', 1, '/procurement/po', 'Buka Procurement → Purchase Orders, klik PO yang sudah ISSUED. Lihat "Payable now" — itu termin yang sudah jatuh tempo.', 'PO yang masih draft belum menimbulkan kewajiban apa pun, jadi belum bisa dibayar (not_issued).', 'PO: ISSUED', null, '{}', 'procurement/06-pay-po.jpg'),
('acct.pay_po', 2, '/procurement/po', 'Di kartu "Pay this order", isi tanggal, nominal (terisi otomatis sebesar Payable now), rekening sumber dan jenis transaksi, lalu unggah bukti transfer.', 'Tanpa bukti transfer ditolak (evidence_required). Nominal tidak boleh melebihi sisa kontrak (over_contract) — kelebihan bayar adalah urusan dengan vendor, bukan pembayaran PO. Hanya pemegang post_ledger (authority_required).', null, null, '{}', null),
('acct.pay_po', 3, '/procurement/po', 'Tekan "Post Rp… to the ledger".', 'Satu baris buku besar. Bagian untuk baris yang berasal dari PR tercatat di baris PR itu juga; sisanya hanya di PO.', 'PO: UNPAID', 'PO: PARTIAL / SETTLED', '{ops_acct.post_to_po,ops_acct.post_transaction}', null);

update ops_asst.process_steps set
  rule = 'Tanpa bukti transfer ditolak (evidence_required). Staf procurement tidak bisa mencatat pembayaran (authority_required) — hanya pemegang post_ledger. Kalau baris ini sudah dipesan di PO, pembayarannya otomatis terbaca juga di PO tersebut.'
 where process_key = 'acct.pay_line' and seq = 2;

insert into ops_asst.process_faq (process_key, question, answer) values
('acct.pay_po', 'Bayar DP lewat halaman PO atau lewat baris PR?',
 'Keduanya tercatat di dua sisi. Bayar dari halaman PO kalau yang ditagih vendor adalah termin PO (DP, pelunasan); bayar dari baris PR kalau yang dibayar adalah baris itu sendiri. Satu pembayaran tidak pernah terhitung dua kali.'),
('procure.create_po', 'Kenapa baris PR tidak muncul di pilihan "From request line"?',
 'Yang muncul hanya baris yang sudah APPROVED (atau PAID), punya jumlah, belum dihapus, dan vendornya sama atau belum ditentukan. Kalau baris itu sudah ada di PO lain, sistem menolak dengan nama PO-nya.'),
('acct.pay_line', 'Kenapa bayar ongkir ditolak line_detail_required? (sementara)',
 'Jenis transaksi pembelian (misalnya SUPPLIERS) mewajibkan jumlah dan harga satuan, sedangkan baris jasa seperti ongkir memang tidak punya jumlah. Sudah dilaporkan ke IT. Sementara: catat di Accounting → Ledger dengan tombol "Post to the ledger" (detail 1 × nominal), lalu di laci transaksinya tekan "Point this money at that line" ke baris ongkir.');
