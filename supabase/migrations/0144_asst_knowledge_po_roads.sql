-- 0144 — the guide says both roads to a confirmed order (0143, D267, D69).
--
-- Written as the database now behaves. The Chat half is honest about the one
-- piece still missing — the worker that turns `po.approval_requested` into a
-- card and carries the answer back — with a (sementara) row that goes when the
-- worker lands.

update ops_asst.process_steps set
  action = 'Kalau Anda staf: buka PO-nya dari daftar Purchase Orders, lalu tekan "Ask leadership to confirm". Permintaan persetujuan dikirim ke Google Chat pemegang approve_goods. Kalau Anda pimpinan dan membuat PO sendiri, langkah ini dan berikutnya tidak perlu — konfirmasinya sudah tercatat saat PO dibuat.',
  rule   = 'PO tidak bisa di-issue sebelum dikonfirmasi pimpinan (not_approved), karena PO adalah janji atas nama perusahaan. PO yang sudah dikonfirmasi tidak dikirim lagi ke Chat (already_approved).'
 where process_key = 'procure.create_po' and seq = 3;

update ops_asst.process_steps set
  action = 'Pimpinan menjawab dari kartu di Google Chat (setuju, atau tolak dengan alasan), atau membuka PO yang sama di aplikasi dan menekan "Confirm it".',
  rule   = 'Jawaban dari Chat hanya diterima dari orang yang dikirimi kartu, dan dicatat atas nama akunnya — bukan akun laptop rapat (D69). Menolak wajib dengan alasan. Kalau pembuat PO sendiri memegang approve_goods, sistem mencatatnya sebagai dikonfirmasi sendiri: tidak ada orang kedua yang memeriksa.',
  writes = '{ops_procure.approve_po,ops_procure.answer_po_approval}'
 where process_key = 'procure.create_po' and seq = 4;

insert into ops_asst.process_faq (process_key, question, answer) values
('procure.create_po', 'Siapa yang harus menyetujui PO?',
 'Selalu pimpinan (pemegang approve_goods). Kalau pimpinan sendiri yang membuat PO, konfirmasinya tercatat otomatis saat dibuat. Kalau staf yang membuat, staf menekan "Ask leadership to confirm" dan pimpinan menjawab dari Google Chat atau dari halaman PO.'),
('procure.create_po', 'Kenapa kartu persetujuan PO belum muncul di Google Chat pimpinan? (sementara)',
 'Permintaannya sudah tercatat dan ditujukan ke pimpinan, tetapi pengirim kartu ke Google Chat untuk PO belum dipasang. Sementara itu pimpinan membuka PO di aplikasi (banner "Waiting on leadership") dan menekan "Confirm it".');
