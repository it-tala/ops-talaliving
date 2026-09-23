-- 0130 — the last (sementara) row goes: a lump-sum line is paid from its row
-- (B9, 0129, D298). The walk now pays the delivery charge like any other line.

delete from ops_asst.process_faq
 where question = 'Kenapa bayar ongkir ditolak line_detail_required? (sementara)';

insert into ops_asst.process_faq (process_key, question, answer) values
('acct.pay_line', 'Bagaimana membayar baris tanpa jumlah, seperti ongkir atau jasa borongan?',
 'Sama seperti baris lain: buka lacinya di Procurement → Requests, lalu tekan "Post Rp… to the ledger". Di buku besar, detailnya tercatat sebagai 1 lot × nominal yang dibayar. Baris PR-nya sendiri tetap tanpa jumlah, karena memang tidak pernah dikutip per satuan.');
