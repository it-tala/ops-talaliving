-- 0134 — two steps corrected by the first walk through the live screens.
--
-- `scripts/sop/check-knowledge.mjs` compares what the walk pressed with what
-- the guide says. Its first run found the guide describing a click nobody
-- could make:
--
-- * attaching a price: the guide said *dari laci baris*, and the drawer asks
--   for a document type (**Reference Link**) and a button (**Paste a link**);
-- * approving on the meeting board: the guide said *tekan "Approve this"*,
--   which is the checkbox column's header. The button is **Approve N · Rp…**.

update ops_asst.process_steps set
  action = 'Klik barisnya di Procurement → Requests untuk membuka lacinya. Di bagian dokumen pilih jenis "Reference Link", tekan "Paste a link", tempel alamat halaman toko atau chat vendor, lalu tekan Enter. Untuk file (penawaran PDF, foto nota) pakai "Choose a file" atau "Photograph".'
 where process_key = 'procure.create_pr' and seq = 4;

update ops_asst.process_steps set
  action = 'Kalau diputuskan di rapat: pemegang approve_goods mencentang baris di kolom "Approve this", boleh mengurangi jumlah atau nominalnya dan menambah instruksi, lalu tekan tombol "Approve N · Rp…" di bawah tabel.'
 where process_key = 'procure.approve_goods' and seq = 4;
