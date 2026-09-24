-- 0160 — the guide says who the question goes to, and what the card can do
--        (0159).
--
-- Three of these four steps described a screen that has changed, and one of them
-- described a button whose label was replaced. `scripts/sop/check-knowledge.mjs`
-- compares what the walk presses with what the guide says, and the value of that
-- check is entirely in keeping this file honest the same week the screen moves.
--
-- What changed: staff now see **who** the request will go to before they send it
-- and pick when more than one person holds the authority, the card carries the
-- amounts and BCA 271 instead of a line of text and a link, and leadership can
-- answer the whole list in one press or one line on its own.

update ops_asst.process_steps set
  action = 'Buka Procurement → Meeting board. Baris yang menunggu keputusan ada di sini dengan total yang diminta, dan di atasnya baris "Who decides" menyebut siapa pemegang approve_goods (barang) dan approve_funds (dana).',
  rule   = 'Semua orang yang bisa membuka papan ini melihat siapa yang berwenang. Wewenangnya diberikan IT di Settings → People, bukan di papan ini.'
 where process_key = 'procure.approve_goods' and seq = 1;

update ops_asst.process_steps set
  action = 'Kalau pimpinan tidak di ruangan: centang barisnya, lalu tekan tombol "Ask <nama> on Chat · Rp…" di atas tabel. Kalau lebih dari satu orang memegang approve_goods, pilih dulu tujuannya di daftar sebelah tombol itu — papan tidak memilih sendiri.',
  rule   = 'Yang dikirimi harus pemegang approve_goods; alamat lain ditolak (not_an_approver) dan penolakannya menyebut siapa yang berwenang. Baris tanpa dokumen pendukung ditolak sebelum kartu dikirim (support_required). Baris yang sudah ditanyakan tidak ditanyakan dua kali (nothing_to_ask).',
  writes = '{ops_procure.request_approval}'
 where process_key = 'procure.approve_goods' and seq = 2;

update ops_asst.process_steps set
  action = 'Pimpinan membaca kartu di Google Chat: apa yang diminta per baris dengan jumlah dan harganya, keterangan dan catatan rapatnya, total yang diminta, saldo BCA 271, dan berapa dana tambahan yang perlu masuk kalau ini disetujui. Lalu tekan "Setujui semua · Rp…", atau "Setujui ini" pada satu baris yang mendesak, atau tulis alasan dan tekan "Tolak semua".',
  rule   = 'Menolak wajib beralasan — itu yang dibaca orang yang mengajukan. Jawaban dicatat atas nama akun Google Chat yang menekan, bukan akun laptop rapat (D69), dan hanya diterima dari orang yang dikirimi kartu itu dan masih memegang approve_goods saat menekan (authority_required). Baris yang sudah diputuskan di aplikasi tidak disetujui dua kali — kartu menyebutnya per baris.',
  writes = '{ops_procure.answer_batch,ops_procure.answer_request}'
 where process_key = 'procure.approve_goods' and seq = 3;

insert into ops_asst.process_faq (process_key, question, answer) values
('procure.approve_goods', 'Siapa yang boleh menyetujui pembelian, dan bagaimana saya tahu?',
 'Pemegang wewenang approve_goods. Namanya tertulis di baris "Who decides" di atas papan rapat, jadi tidak perlu bertanya. Kalau di sana kosong, tidak ada yang bisa menyetujui apa pun dan IT harus memberikan wewenangnya dulu di Settings → People.'),
('procure.approve_goods', 'Saya staf. Bisa saya setujui sendiri kalau pimpinan sedang sibuk?',
 'Tidak, dan mengirim permintaannya ke alamat sendiri juga tidak bisa — ditolak dengan not_an_approver. Kalau memang mendesak, kirim ke pimpinan lalu minta beliau menekan "Setujui ini" pada baris itu saja; satu baris bisa dijawab tanpa menunggu seluruh daftar.'),
('procure.approve_goods', 'Kartu di Chat menyebut "perlu tambahan dana". Apa artinya?',
 'Kalau daftar itu disetujui, yang harus dibayar dari BCA 271 melebihi saldonya sekarang, dan selisihnya itulah yang harus ditransfer masuk. Angkanya dihitung dari tiga hal: yang sudah disetujui dan belum dibayar, yang ditambahkan daftar ini, dan saldo BCA 271 — sama seperti di papan rapat, jadi kartu dan layar tidak mungkin berbeda.'),
('procure.approve_goods', 'Di kartu ada baris bertanda "sudah dibayar sebelum ada persetujuan". Kenapa masih diminta disetujui?',
 'Karena uangnya sudah keluar dan persetujuannya belum ada. Menyetujuinya bukan mengizinkan pengeluaran baru — tidak ada uang tambahan yang keluar — tapi mencatat bahwa pimpinan membenarkan yang sudah terjadi. Kalau tidak dibenarkan, tolak dengan alasannya; barisnya tetap tercatat pernah dibayar.');
