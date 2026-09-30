-- 0197 — the inventory guide, after `0197_inv_item_code_by_location` (D346).
--
-- Three steps changed meaning: a location's short code, a rack that is now
-- required when registering an item (the code names it), and an asset's
-- location picked from the list. John Lau and the SOP read these rows (D296),
-- so they are rewritten here rather than left saying the old thing.

update ops_asst.process_steps set
  action = 'Buka Inventory → Stock adjustments (Opname & penyesuaian). Di kartu "Manage locations" ("Kelola lokasi") isi kode dan nama rak — kode singkat untuk kode barang boleh diisi atau dikosongkan — lalu tekan "Add location" ("Tambah lokasi").',
  rule   = 'Hanya pemegang inventory.update yang melihat kartu ini. Kode tidak bisa diganti sesudahnya — riwayat stok memakainya. Kode singkat (2–4 huruf/angka) menjadi awal kode barang yang didaftarkan di lokasi itu; kalau dikosongkan, sistem memilihkannya.'
 where process_key = 'inv.locations' and seq = 1;

update ops_asst.process_steps set
  action = 'Isi nama katalog (sistem, bahasa Inggris), nama lapangan (yang dipakai tim), kategori (pilih grup lalu jenisnya), satuan dan lokasi raknya. Kode barang terbentuk dari lokasi · kategori · nomor urut, mis. GDG-AMS-0001. Kalau sudah dihitung, isi jumlahnya. Tekan "Register" ("Daftarkan").',
  rule   = 'Lokasi wajib (location_required) — kode barang memakainya dan rak itu menjadi lokasi rumah barangnya. Nama katalog atau nama lapangan yang sudah ada ditolak (already_catalogued) — hitung di barang yang sudah ada. Hitungan awal tercatat sebagai penyesuaian opname (butuh inventory.adjust) di rak itu. Kategori yang tidak dihitung di gudang ditolak (not_stocked).'
 where process_key = 'inv.register_item' and seq = 2;

update ops_asst.processes set
  purpose = 'Aset perusahaan (alat, mesin, kendaraan, komputer, CCTV) dan barang sewa/leasing/pinjaman dicatat dengan nomor seri, lokasi (dipilih dari daftar lokasi yang sama dengan rak) dan pemegangnya, beserta riwayat servis dan statusnya.'
 where key = 'inv.assets';

update ops_asst.process_steps set
  rule = 'Nama dan kategori wajib (name_required, category_required). Lokasi dipilih dari daftar lokasi; tempat yang belum ada ditambah dulu di Opname & penyesuaian → Kelola lokasi. Aset sewa/leasing/pinjaman butuh biaya, periode dan tanggal jatuh tempo sewanya.'
 where process_key = 'inv.assets' and seq = 1;

analyze ops_asst.process_steps;
analyze ops_asst.processes;
