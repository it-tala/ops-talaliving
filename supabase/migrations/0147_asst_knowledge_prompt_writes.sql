-- 0147 — the guide says what John Lau can now do from a sentence (D300).
--
-- A person asking *bisa minta John Lau bikin PO?* should get the rule, not a
-- guess: a draft built from the approved line, confirmed by the person, and
-- leadership's approval exactly as on the screen (D299).

insert into ops_asst.process_faq (process_key, question, answer) values
('procure.create_po', 'Bisakah saya minta John Lau membuat PO?',
 'Bisa. Ketik misalnya "buat PO untuk KSA binder 5 liter". John Lau mencari baris PR yang sudah disetujui dan cocok, lalu menyiapkan draft PO dari baris itu: vendor, jumlah dan harga diambil dari yang disetujui, bukan ditebak. Periksa dan lengkapi isinya, lalu tekan "Ya, tulis". Kalau Anda staf, PO langsung dikirim ke pimpinan untuk dikonfirmasi; kalau Anda pimpinan, konfirmasinya tercatat saat itu juga. Issue ke vendor tetap dilakukan dari halaman PO.'),
('procure.create_pr', 'Bisakah saya minta John Lau membuat PR?',
 'Bisa. Ketik misalnya "siapkan PR untuk lem kayu 5 kaleng". John Lau menyiapkan draft baris permintaan dari kalimat Anda tanpa mengarang vendor atau harga; lengkapi, lalu tekan "Ya, tulis". Baris itu masuk sebagai permintaan — yang menyetujui tetap pimpinan, di papan rapat.');
