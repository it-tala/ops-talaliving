-- 0140 — the second module walked: HR, through to the ledger.
--
-- Written from `supabase/local/smoke/99_sim_hr_to_ledger.sql`, which walks
-- this flow against the ladder as four people (IT, staf HRD, pimpinan,
-- keuangan), and from `scripts/e2e/walk-hr.mjs`, which presses the same
-- buttons on the live screens. A status named here is one the walk read back;
-- a refusal named here is one it hit. Button labels are the screen's own
-- words, in the language the screen prints them — HR is mostly Indonesian,
-- the payroll pages still partly English.
--
-- Three doors the walk found shut (F154) are fixed in 0138 and 0139 and the
-- screens that go with them, so they are described here as they now work.
--
-- Individual pay and attendance stay closed to John Lau's *data* tools (D218:
-- `hr.payroll`, `hr.attendance`, `hr.employee_files` are blocked). This is
-- knowledge about *how the screens are used*, which is a different thing — it
-- names no person and no figure.

insert into ops_asst.processes (key, module, seq, title, purpose, route, permission, follows, sop_ref) values
('hr.pay_rules', 'hr', 10,
 'Aturan gaji dan pola jadwal kerja',
 'Aturan gaji (pola lima hari, lembur, keterlambatan, pembagi upah bulanan) dan pola jadwal (jam masuk, istirahat, pulang, Jumat) disimpan sebagai versi yang berlaku dari sebuah tanggal. Dipegang IT, bukan HRD, karena satu perubahan menggeser gaji semua orang.',
 '/it/aturan-gaji', 'it.update', null, 'hr/01'),

('hr.employee', 'hr', 20,
 'Menambah dan mengubah data karyawan',
 'Karyawan dicatat dengan nomor yang sama dengan nomor di mesin absen, unit, cara dibayar (bulanan, harian, per jam), upah dan tunjangan per hari hadir. Nomor mesin itulah yang menyambungkan tap sidik jari ke orangnya.',
 '/hrd/karyawan', 'hrd.create', 'hr.pay_rules', 'hr/02'),

('hr.schedule', 'hr', 30,
 'Memasang pola kerja ke karyawan',
 'Setiap orang harus punya pola kerja supaya jam kerjanya bisa dihitung. Pola ikut unitnya (misalnya Produksi → PRODUKSI); yang berbeda dari unitnya dipasang sendiri.',
 '/hrd/jadwal', 'hrd.update', 'hr.employee', 'hr/03'),

('hr.employee_files', 'hr', 40,
 'Berkas 201 (KTP, KK, NPWP, BPJS, ijazah)',
 'Berkas pribadi karyawan, satu slot per jenis dokumen. Boleh dicatat nomornya saja dulu (pemindaiannya menyusul) atau langsung dengan scan/foto. Nomor dokumen disimpan tertutup; membukanya tercatat di audit.',
 '/hrd/berkas-201', 'hrd.create', 'hr.employee', 'hr/04'),

('hr.contract', 'hr', 50,
 'Kontrak kerja (PKWT/PKWTT)',
 'Kontrak didaftarkan sebagai draft, kertas yang ditandatangani dilampirkan, sepuluh poin wajib dijawab dengan kalimat aslinya, lalu diberlakukan. Kontrak baru yang diberlakukan menggantikan kontrak lama orang yang sama.',
 '/hrd/kontrak', 'hrd.create', 'hr.employee', 'hr/05'),

('hr.attendance', 'hr', 60,
 'Absensi: impor mesin, tap yang terlewat, dan menandai hari',
 'Tap dari mesin sidik jari diimpor per file. Satu hari kerja dibaca dari empat tap: masuk, keluar istirahat, kembali, pulang. Hari yang tapnya tidak lengkap dan tidak diberi tanda tetap "belum dibaca" dan menahan persetujuan gaji.',
 '/hrd/absensi', 'hrd.create', 'hr.schedule', 'hr/06'),

('hr.leave', 'hr', 70,
 'Cuti, izin dan sakit',
 'Pengajuan cuti, izin atau sakit dicatat dengan tanggal dan alasannya, lalu diputuskan. Persetujuan langsung menulis tanda hari di absensi dan mengurangi sisa cuti; penolakan wajib beralasan karena orangnya akan membacanya.',
 '/hrd/cuti', 'hrd.update', 'hr.attendance', 'hr/07'),

('hr.payroll_run', 'hr', 80,
 'Membuka run gaji dan menambah penyesuaian',
 'Run gaji adalah satu periode (seminggu untuk harian, sebulan untuk bulanan). Baris gaji tidak disimpan: dihitung dari absensi dan lembur yang disetujui setiap kali dibaca, jadi tidak ada tombol hitung. Penyesuaian (bonus, potongan, kasbon) ditambahkan tangan dengan alasan.',
 '/hrd/payroll/minggu', 'payroll.run', 'hr.attendance', 'hr/08'),

('hr.payroll_approve', 'hr', 90,
 'Menyetujui run gaji (pimpinan)',
 'Pimpinan (pemegang approve_funds) memeriksa dan menyetujui run. Yang menyiapkan run tidak bisa menyetujuinya. Run ditolak disetujui selama masih ada hari yang belum dibaca.',
 '/hrd/payroll', 'wewenang approve_funds', 'hr.payroll_run', 'hr/09'),

('hr.payroll_pay', 'hr', 100,
 'Membayar run gaji dan mencatatnya ke buku besar',
 'Keuangan (pemegang post_ledger) membayar run yang sudah disetujui dari halaman run itu sendiri. Satu baris buku besar untuk seluruh run, dengan bukti transfer, dan run langsung tertulis PAID. Gaji per orang tidak ditulis ke buku besar.',
 '/hrd/payroll', 'wewenang post_ledger', 'hr.payroll_approve', 'hr/10'),

('hr.payslip', 'hr', 110,
 'Mencetak slip gaji',
 'Slip gaji dicetak dari halaman run, delapan per lembar atau enam per lembar dengan rekap harian.',
 '/hrd/payroll', 'payroll.read', 'hr.payroll_approve', 'hr/11');

insert into ops_asst.process_steps (process_key, seq, route, action, rule, status_before, status_after, writes, screenshot) values
-- aturan gaji
('hr.pay_rules', 1, '/it/aturan-gaji', 'Buka IT → Aturan gaji. Versi yang berlaku sekarang tampil di atas; ubah pola jadwal atau aturannya di bawahnya.', 'Hanya pemegang akses IT (it.update) yang bisa mengubah. Kode pola huruf besar (PRODUKSI, KANTOR); pola yang masih dipakai orang tidak bisa dihapus (schedule_in_use) — pindahkan orangnya dulu.', null, null, '{}', 'hr/01-aturan-gaji.jpg'),
('hr.pay_rules', 2, '/it/aturan-gaji', 'Isi tanggal berlaku dan alasan perubahan, tekan "Lihat dampaknya", baca dampaknya ke gaji, lalu "Simpan versi".', 'Tombol simpan baru terbuka setelah dampaknya dihitung. Versi lama tetap tersimpan untuk menjawab slip lama yang ditanyakan.', null, 'versi baru berlaku', '{ops_hr.save_pay_rules}', null),

-- karyawan
('hr.employee', 1, '/hrd/karyawan', 'Buka HRD → Karyawan, tekan "Add somebody".', null, null, null, '{}', 'hr/02-karyawan.jpg'),
('hr.employee', 2, '/hrd/karyawan', 'Isi "Number on the machine" (nomor di mesin absen), nama lengkap, jabatan, unit, cara dibayar, upah (per bulan/hari/jam) dan tunjangan per hari hadir, lalu "Save".', 'Upah wajib diisi (rate_required). Nomor mesin harus sama persis dengan nomor di mesin sidik jari, kalau tidak tapnya tidak tersambung ke orang ini.', null, 'aktif', '{ops_hr.save_employee}', null),

-- jadwal
('hr.schedule', 1, '/hrd/jadwal', 'Buka HRD → Jadwal kerja. Orang yang belum punya pola tampil di atas.', 'Orang yang polanya ikut unit tidak perlu dipasang satu per satu.', null, null, '{}', 'hr/03-jadwal.jpg'),
('hr.schedule', 2, '/hrd/jadwal', 'Pilih pola untuk orang itu lalu tekan "Pasang".', 'Pola yang tidak dikenal ditolak (schedule_unknown); tambahkan polanya dulu di Aturan gaji.', null, 'punya pola', '{ops_hr.set_employee_schedule}', null),

-- berkas 201
('hr.employee_files', 1, '/hrd/berkas-201', 'Buka HRD → Berkas 201, pilih orangnya. Setiap slot tampil, termasuk yang masih kosong.', null, null, null, '{}', 'hr/04-berkas-201.jpg'),
('hr.employee_files', 2, '/hrd/berkas-201', 'Pada slot dokumen (misalnya KTP) tekan "Tambah", ketik nomor dokumen dan/atau tekan "Pilih scan / foto", isi tanggal terbit dan berakhir kalau ada, lalu "Simpan".', 'Nomor saja boleh, scan saja boleh, keduanya kosong ditolak (nothing_to_file). Tanggal berakhir sebelum tanggal terbit ditolak.', 'belum ada', 'tercatat', '{ops_hr.file_employee_document}', null),

-- kontrak
('hr.contract', 1, '/hrd/kontrak', 'Buka HRD → Kontrak kerja, tekan "Daftarkan kontrak". Pilih karyawan, jenis (PKWT/PKWTT), tanggal mulai berlaku dan berakhir, lalu "Daftarkan".', 'PKWT wajib punya tanggal berakhir (end_date_required); PKWTT tidak boleh punya (end_date_not_allowed).', null, 'draft', '{ops_hr.register_contract}', 'hr/05-kontrak.jpg'),
('hr.contract', 2, '/hrd/kontrak', 'Buka kontraknya. Setelah ditandatangani, tekan "Lampirkan kontrak" dan pilih scan/PDF kontrak itu.', 'Tanpa kertas yang ditandatangani kontrak tidak bisa diberlakukan (paper_required). Hanya kontrak draft yang bisa dilampiri atau diganti berkasnya.', 'draft', 'draft · berkas terlampir', '{ops_hr.attach_contract_paper}', null),
('hr.contract', 3, '/hrd/kontrak', 'Jawab sepuluh poin wajib satu per satu: tekan "Jawab", salin kalimat aslinya dari kontrak, isi nilainya, lalu "Konfirmasi".', 'Poin yang belum dijawab disebut namanya saat memberlakukan (clauses_missing). Nilai yang tidak sesuai bentuknya ditolak (value_shape). Selisih dengan data karyawan ditampilkan, tidak diterapkan otomatis.', null, null, '{ops_hr.confirm_clause}', null),
('hr.contract', 4, '/hrd/kontrak', 'Tekan "Berlakukan".', 'Kontrak aktif sebelumnya milik orang yang sama otomatis menjadi "Digantikan".', 'draft', 'active', '{ops_hr.activate_contract}', null),
('hr.contract', 5, '/hrd/kontrak', 'Untuk mengakhiri: buka kontrak yang berjalan, tekan "Akhiri", tulis alasannya, lalu "Akhiri kontrak".', 'Alasan wajib (reason_required).', 'active', 'ended', '{ops_hr.end_contract}', null),

-- absensi
('hr.attendance', 1, '/hrd/absensi', 'Buka HRD → Absensi, tekan "Upload biometric file", pilih file ekspor mesin (CSV), periksa ringkasannya, lalu tekan "Import N tap(s)".', 'Mengunggah file yang sama dua kali tidak menggandakan tap. Tap dengan nomor yang tidak dikenal tidak masuk dan nomornya disebut — tambahkan karyawannya lalu impor ulang.', null, 'tap masuk', '{ops_hr.import_scans}', 'hr/06-absensi.jpg'),
('hr.attendance', 2, '/hrd/absensi', 'Hari yang tapnya kurang: klik sel hari itu, tekan "Tap the machine missed", isi jam dan alasannya, lalu "Add tap".', 'Alasan wajib (reason_required). Hari dibaca dari empat tap: masuk, keluar istirahat, kembali, pulang.', 'belum dibaca', 'terbaca', '{ops_hr.add_scan}', null),
('hr.attendance', 3, '/hrd/absensi', 'Hari tidak masuk: klik sel hari itu, pilih jenisnya (Sakit, Izin, Tidak masuk, Setengah hari), isi keterangan, lalu tekan "Mark as sakit" (atau jenis lain yang dipilih).', 'Satu hari hanya punya satu tanda (already_marked); tanda yang salah ditarik dulu dengan "Withdraw this mark".', 'belum dibaca', 'bertanda', '{ops_hr.mark_day}', null),
('hr.attendance', 4, '/hrd/absensi', 'Pada hari sakit, tekan "Lampirkan surat dokter" dan pilih fotonya.', 'Sakit dengan surat dokter dibayar penuh; tanpa surat tidak.', 'sakit', 'sakit · surat dokter terlampir', '{ops_hr.attach_surat_dokter}', null),
('hr.attendance', 5, '/hrd/absensi', 'Tanggal merah untuk semua orang: klik judul tanggalnya, pilih "Tanggal merah", isi keterangan, lalu "Mark for everybody".', 'Tanda untuk semua orang hanya untuk hari libur (office_wide).', null, 'libur', '{ops_hr.mark_day}', null),

-- cuti
('hr.leave', 1, '/hrd/cuti', 'Buka HRD → Cuti, tekan "Ajukan". Pilih karyawan, jenis (Cuti, Izin, Sakit), dari dan sampai tanggal, tulis alasannya, lalu tekan "Ajukan" lagi.', 'Tanggal yang bertumpuk dengan pengajuan lain ditolak (overlaps_existing). Alasan wajib — itu yang dibaca saat diputuskan.', null, 'PENDING', '{ops_hr.request_leave}', 'hr/07-cuti.jpg'),
('hr.leave', 2, '/hrd/cuti', 'Pada pengajuan yang menunggu, tekan "Setujui" atau "Tolak".', 'Menolak wajib beralasan (reason_required); alasannya dibaca orangnya. Persetujuan menulis tanda hari di absensi, kecuali di hari yang sudah punya tanda.', 'PENDING', 'APPROVED / REJECTED', '{ops_hr.decide_leave}', null),

-- run gaji
('hr.payroll_run', 1, '/hrd/payroll/minggu', 'Buka Payroll → "Gajian mingguan". Pratinjau minggu itu tampil sebelum ada run; pindah minggu dengan "Minggu sebelumnya".', 'Pratinjau dan run membaca angka yang sama dari absensi.', null, null, '{}', 'hr/08-gajian-mingguan.jpg'),
('hr.payroll_run', 2, '/hrd/payroll/minggu', 'Tekan "Buka run minggu ini". Untuk periode lain (misalnya bulanan) pakai "Open a run" di halaman Payroll dengan tanggal dari–sampai.', 'Periode yang bertumpuk dengan run lain ditolak (period_overlaps).', null, 'DRAFT', '{ops_hr.open_payroll_run}', null),
('hr.payroll_run', 3, '/hrd/payroll', 'Di halaman run, bagian penyesuaian: pilih karyawan dan jenisnya, isi nominal dan alasan, lalu "Tambahkan" (atau "Potong" untuk pengurang).', 'Hanya run DRAFT yang bisa diubah (run_not_draft). Alasan wajib.', 'DRAFT', 'DRAFT', '{ops_hr.add_adjustment}', 'hr/08-run.jpg'),
('hr.payroll_run', 4, '/hrd/payroll', 'Periksa "Days unread". Kalau belum nol, tekan "Read them" dan selesaikan hari-hari itu di Absensi.', 'Run dengan hari yang belum dibaca tidak bisa disetujui (open_days).', null, null, '{}', null),

-- persetujuan
('hr.payroll_approve', 1, '/hrd/payroll', 'Pimpinan membuka run lalu menekan "Approve the run".', 'Hanya pemegang approve_funds. Yang menyiapkan run tidak bisa menyetujui (not_permitted). Ditolak selama masih ada hari belum dibaca (open_days).', 'DRAFT', 'APPROVED', '{ops_hr.approve_payroll_run}', null),

-- bayar
('hr.payroll_pay', 1, '/hrd/payroll', 'Keuangan membuka run yang sudah APPROVED. Di kartu "Bayar run ini" isi tanggal bayar, nominal (terisi dari Diterima), rekening, tekan "Lampirkan bukti transfer", lalu "Catat Rp … ke buku besar".', 'Hanya pemegang post_ledger (authority_required). Bukti transfer wajib (evidence_required). Run yang belum disetujui (not_approved) atau sudah dibayar (already_paid) ditolak.', 'APPROVED', 'PAID', '{ops_acct.post_payroll_run}', 'hr/10-bayar-run.jpg'),
('hr.payroll_pay', 2, '/accounting/ledger', 'Transaksi gaji muncul di buku besar dengan jenis payroll mingguan atau bulanan. Tandai lengkap seperti transaksi lain.', 'Buku besar hanya menyimpan total run; rincian per orang tetap di halaman run.', 'POSTED', 'COMPLETED', '{ops_acct.complete_transaction}', null),

-- slip
('hr.payslip', 1, '/hrd/payroll', 'Di halaman run tekan "Payslips". Halaman slip terbuka dan langsung siap dicetak; pilih "Padatkan (8 per lembar)" atau rekap harian, lalu "Cetak".', null, null, null, '{}', null);

insert into ops_asst.process_faq (process_key, question, answer) values
('hr.attendance', 'Kenapa hari seseorang masih "belum dibaca" padahal dia masuk?',
 'Satu hari dibaca dari empat tap: masuk, keluar istirahat, kembali dari istirahat, pulang. Kalau salah satunya tidak ada (misalnya jari tidak terbaca saat pulang), hari itu belum dibaca. Klik selnya, tekan "Tap the machine missed", isi jam dan alasannya.'),
('hr.attendance', 'Tap dari file mesin ada yang tidak masuk. Kenapa?',
 'Nomor di mesin tidak cocok dengan nomor karyawan mana pun. Ringkasan impor menyebut nomor itu. Tambahkan atau betulkan karyawannya di HRD → Karyawan, lalu impor ulang file yang sama — tap yang sudah masuk tidak dobel.'),
('hr.payroll_approve', 'Kenapa run gaji tidak bisa disetujui?',
 'Biasanya karena masih ada hari yang belum dibaca (open_days): angka "Days unread" di halaman run lebih dari nol. Tekan "Read them" dan selesaikan hari-hari itu di Absensi. Selain itu hanya pemegang approve_funds yang bisa menyetujui, dan yang menyiapkan run tidak bisa.'),
('hr.payroll_run', 'Di mana tombol untuk menghitung gaji?',
 'Tidak ada. Baris gaji dihitung dari absensi, tanda hari, cuti dan lembur yang disetujui setiap kali halaman run dibuka. Menutup hari yang belum dibaca langsung mengubah angkanya.'),
('hr.payroll_pay', 'Nominal yang dibayar harus sama dengan "Diterima"?',
 'Tidak ditolak kalau berbeda. Apakah run membayar bruto plus penyesuaian atau dikurangi bagian BPJS karyawan belum diputuskan (Q56), jadi nominal yang dibayar dicatat apa adanya dan angka run tersimpan di sebelahnya.'),
('hr.payroll_pay', 'Kenapa gaji per orang tidak ada di buku besar?',
 'Buku besar dibaca lebih banyak orang daripada yang boleh melihat gaji. Yang dicatat satu baris untuk seluruh run; rinciannya tetap di halaman run gaji.'),
('hr.contract', 'Kontrak tidak bisa diberlakukan, katanya berkas belum terlampir.',
 'Buka kontraknya, tekan "Lampirkan kontrak" dan pilih scan/PDF yang sudah ditandatangani. Setelah itu jawab poin wajib yang masih kosong, lalu "Berlakukan".'),
('hr.leave', 'Cuti sudah disetujui, apakah absensinya perlu ditandai lagi?',
 'Tidak. Persetujuan langsung menulis tanda cuti/izin/sakit di hari-hari itu. Hari yang sudah punya tanda lain tidak ditimpa.'),
('hr.payroll_run', 'Bisakah John Lau memberi tahu gaji atau absensi seseorang?',
 'Tidak. Gaji, absensi per orang dan berkas 201 tidak dibaca lewat percakapan (keputusan pemilik). John Lau bisa menjelaskan cara memakai layarnya; angkanya dibaca di layar HRD oleh yang berhak.');
