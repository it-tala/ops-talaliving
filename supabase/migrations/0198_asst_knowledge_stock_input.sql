-- 0198 — the inventory guide, after `0198_inv_stock_input` (D348).
--
-- The rack now starts from what people enter: *Materials & hardware* lists
-- only items with an entry, the catalogue is the list of names *Input stock*
-- picks from, and every entry can be corrected or deleted. John Lau and the
-- SOP read these rows (D296), so the new process is written here and the
-- register step says what it now requires. Button names are the screen's,
-- in both languages (D318).

insert into ops_asst.processes (key, module, seq, title, purpose, route, permission, follows, sop_ref) values
('inv.stock_input', 'inventory', 15,
 'Input stok dari awal',
 'Stok gudang dimulai dari nol: daftar Bahan & hardware hanya berisi barang yang sudah diinput. Katalog (nama barang dari procurement) menjadi pilihan nama saat input — ketik untuk mencari. Setiap input bisa diubah atau dihapus, dan nilai sebelum dan sesudahnya tercatat.',
 '/inventory/material', 'inventory.adjust', 'inv.locations', 'inventory/02a')
on conflict (key) do update set
  module = excluded.module, seq = excluded.seq, title = excluded.title, purpose = excluded.purpose,
  route = excluded.route, permission = excluded.permission, follows = excluded.follows, sop_ref = excluded.sop_ref;

delete from ops_asst.process_steps where process_key = 'inv.stock_input';
insert into ops_asst.process_steps (process_key, seq, route, action, rule, status_before, status_after, writes, screenshot) values
('inv.stock_input', 1, '/inventory/material',
 'Buka Inventory → Materials & hardware, tekan "Input stock" ("Input stok"). Di kolom Barang ketik nama atau kodenya lalu pilih dari daftar katalog; pilih Lokasi; isi Jumlah dan catatan kalau perlu; tekan "Save entry" ("Simpan input"). Form tetap terbuka dengan lokasi yang sama untuk input berikutnya.',
 'Lokasi aktif dan jumlah lebih dari nol wajib (location_required, qty_invalid). Barang jasa, digabung, diarsipkan, atau yang kategorinya tidak dihitung di gudang ditolak (not_stocked). Input menambah stok barang itu di lokasi tersebut — tercatat sebagai penyesuaian "Input stok" dan butuh inventory.adjust.',
 null, 'di rak', '{ops_inv.input_stock}', null),
('inv.stock_input', 2, '/inventory/material',
 'Nama yang belum ada di katalog: ketik namanya di kolom Barang lalu pilih "Barang baru". Form "Register an item" ("Daftarkan barang") terbuka dengan nama itu; lengkapi foto, kategori, satuan, lokasi dan jumlahnya, lalu tekan "Register" ("Daftarkan").',
 'Barang baru tetap butuh minimal satu foto, dan didaftarkan bersama jumlah dan raknya supaya langsung muncul di daftar.',
 null, 'di rak', '{ops_inv.register_item}', null),
('inv.stock_input', 3, '/inventory/material',
 'Membetulkan input: klik barangnya, di Riwayat pergerakan tekan "Change" ("Ubah") pada barisnya, ubah barang, lokasi, jumlah, alasan atau Job Order, lalu "Save change" ("Simpan perubahan"). Untuk membuang: "Delete" ("Hapus"), tulis alasannya, lalu "Delete entry" ("Hapus input").',
 'Setiap perubahan dan penghapusan tercatat dengan nilai sebelum dan sesudahnya di "Changes to entries" ("Perubahan input"). Barang masuk dari penerimaan procurement dikoreksi di penerimaannya (from_receipt); pindah lokasi dihapus berpasangan lalu dicatat ulang (transfer_pair).',
 null, null, '{ops_inv.edit_stock_move,ops_inv.delete_stock_move}', null),
('inv.stock_input', 4, '/inventory/material',
 'Membetulkan data barangnya: di laci barang tekan "Edit" ("Ubah") di samping nama lapangan, ubah nama katalog, nama lapangan, kategori atau satuan, lalu "Save" ("Simpan").',
 'Nama yang sudah dipakai barang lain ditolak (name_taken). Satuan hanya bisa diganti selama belum ada input dalam satuan lain (uom_has_moves).',
 null, null, '{ops_inv.update_item_details}', null);

-- Registering from the rack now always comes with its count and rack (D348),
-- and the list shows only what has been entered.
update ops_asst.processes set
  purpose = 'Barang yang ada di rak tapi belum ada di katalog didaftarkan dari layar Bahan & hardware: nama katalog (sistem) dan nama lapangan (yang dipakai tim), satu sampai empat foto, kategori, satuan, dan jumlah serta raknya — barang muncul di daftar bersama input pertamanya. Barang yang sudah ada di katalog cukup diinput lewat Input stok.'
 where key = 'inv.register_item';

update ops_asst.process_steps set
  action = 'Isi nama katalog (sistem, bahasa Inggris), nama lapangan (yang dipakai tim), kategori dan satuan, lalu jumlah yang ada dan raknya. Tekan "Register" ("Daftarkan").',
  rule   = 'Nama katalog atau nama lapangan yang sudah ada ditolak (already_catalogued) — input stoknya lewat Input stok. Jumlah dan rak wajib; tercatat sebagai penyesuaian opname (butuh inventory.adjust) di rak itu. Kategori yang tidak dihitung di gudang ditolak (not_stocked).'
 where process_key = 'inv.register_item' and seq = 2;

update ops_asst.process_steps set
  action = 'Barang yang sudah ada di katalog: klik barangnya (atau buka lewat Input stok), pada "Floor name" ("Nama lapangan") tekan "Edit" ("Ubah"), ketik namanya, lalu "Save" ("Simpan").'
 where process_key = 'inv.register_item' and seq = 4;

analyze ops_asst.processes;
analyze ops_asst.process_steps;
