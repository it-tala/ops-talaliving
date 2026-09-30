-- 0197 — the inventory guide, after `0197_inv_categories_and_locations`
-- (D346, D347).
--
-- Two things changed meaning: an asset's location is picked from the list,
-- and that list is one list for everything inventory keeps — material stock,
-- finished goods and assets. John Lau and the SOP read these rows (D296), so
-- they are rewritten here rather than left saying the old thing. Registering
-- an item is unchanged: the location-category item code was cancelled (D347).

update ops_asst.processes set
  purpose = 'Setiap tempat penyimpanan — rak material dan bahan, rak barang jadi, dan tempat aset (perabotan, mesin, kendaraan) — memakai satu daftar lokasi yang sama. Setiap hitungan dan setiap gerak barang milik satu lokasi. Lokasi ditambah, diganti nama dan dinonaktifkan dari layar Opname oleh pemegang inventory.update, supaya area yang disepakati dengan lapangan tidak menunggu IT. Kodenya tetap selamanya; namanya bebas diubah.'
 where key = 'inv.locations';

update ops_asst.processes set
  purpose = 'Aset perusahaan (alat, mesin, kendaraan, komputer, CCTV, perabotan) dan barang sewa/leasing/pinjaman dicatat dengan nomor seri, lokasi (dipilih dari daftar lokasi umum yang sama dengan stok dan barang jadi) dan pemegangnya, beserta riwayat servis dan statusnya.'
 where key = 'inv.assets';

update ops_asst.process_steps set
  rule = 'Nama dan kategori wajib (name_required, category_required). Lokasi dipilih dari daftar lokasi; tempat yang belum ada ditambah dulu di Opname & penyesuaian → Kelola lokasi. Aset sewa/leasing/pinjaman butuh biaya, periode dan tanggal jatuh tempo sewanya.'
 where process_key = 'inv.assets' and seq = 1;

analyze ops_asst.process_steps;
analyze ops_asst.processes;
