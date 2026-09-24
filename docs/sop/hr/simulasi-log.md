| # | Proses | Langkah | Pelaku | Layar | Seam | Hasil | Status | Catatan |
|---|---|---|---|---|---|---|---|---|
| 1 | 1. Aturan gaji | Simpan aturan gaji dan dua pola jadwal (Produksi, Kantor) | Tomi | `/it/aturan-gaji` | `ops_hr.save_pay_rules` | OK | versi 1 | Lima hari kerja; pola dipasang per unit. Aturan ini dipegang IT, bukan HRD. |
| 2 | 2. Karyawan | Tambah karyawan harian: nomor mesin, nama, unit, upah per hari, tunjangan | Sari | `/hrd/karyawan` | `ops_hr.save_employee` | OK | aktif | Nomor di mesin absen (B-0101) yang menyambungkan tap ke orangnya. |
| 3 | 2. Karyawan | Tambah karyawan bulanan | Sari | `/hrd/karyawan` | `ops_hr.save_employee` | OK | aktif |  |
| 4 | 2. Karyawan | Simpan karyawan tanpa upah | Sari | `/hrd/karyawan` | `ops_hr.save_employee` | DITOLAK |  | rate_required |
| 5 | 3. Jadwal | Pastikan tiap orang punya pola kerja (dari unitnya, atau dipasang sendiri) | Sari | `/hrd/jadwal` | `ops_hr.set_employee_schedule` | OK | Karjo: PRODUKSI | Orang tanpa pola tidak bisa dihitung jam kerjanya. |
| 6 | 4. Berkas 201 | Tambah KTP: unggah scan, ketik nomornya | Sari | `/hrd/berkas-201` | `ops_hr.file_employee_document` | OK | KTP terlampir | Nomor KTP disimpan tertutup; membukanya tercatat di audit. |
| 7 | 4. Berkas 201 | Simpan berkas tanpa scan dan tanpa nomor | Sari | `/hrd/berkas-201` | `ops_hr.file_employee_document` | DITOLAK |  | nothing_to_file |
| 8 | 5. Kontrak | Daftarkan kontrak: jenis, mulai berlaku, berakhir | Sari | `/hrd/kontrak` | `ops_hr.register_contract` | OK | draft |  |
| 9 | 5. Kontrak | Berlakukan sebelum kertasnya terlampir | Sari | `/hrd/kontrak/kkj-26-09-24_01` | `ops_hr.activate_contract` | DITOLAK | draft | paper_required |
| 10 | 5. Kontrak | Lampirkan kontrak yang sudah ditandatangani (scan/PDF) | Sari | `/hrd/kontrak/kkj-26-09-24_01` | `ops_hr.attach_contract_paper` | OK | draft · berkas terlampir | Sebelum 0148 langkah ini tidak ada: formulir pendaftaran tidak punya kolom berkas (F154). |
| 11 | 5. Kontrak | Berlakukan sebelum isi pokoknya dijawab | Sari | `/hrd/kontrak/kkj-26-09-24_01` | `ops_hr.activate_contract` | DITOLAK | draft | clauses_missing |
| 12 | 5. Kontrak | Jawab sepuluh poin wajib: tekan "Jawab", salin kalimat aslinya, isi nilainya, "Konfirmasi" | Sari | `/hrd/kontrak/kkj-26-09-24_01` | `ops_hr.confirm_clause` | OK | 10 poin terjawab |  |
| 13 | 5. Kontrak | Tekan "Berlakukan" | Sari | `/hrd/kontrak/kkj-26-09-24_01` | `ops_hr.activate_contract` | OK | active |  |
| 14 | 6. Absensi | Unggah file mesin absen, periksa ringkasannya, tekan "Import N tap" | Sari | `/hrd/absensi` | `ops_hr.import_scans` | OK | 27 tap masuk · 1 tap bernomor tak dikenal | Tap bernomor yang tidak dikenal tidak masuk, dan nomornya disebut. Tambahkan orangnya dulu, lalu impor ulang file yang sama — tap yang sudah masuk tidak dobel. |
| 15 | 6. Absensi | Tap yang terlewat: buka sel harinya, "Tap the machine missed", isi jam dan alasannya | Sari | `/hrd/absensi` | `ops_hr.add_scan` | OK | hari lengkap |  |
| 16 | 6. Absensi | Tandai hari: pilih jenis "Sakit", isi keterangan, "Mark as Sakit" | Sari | `/hrd/absensi` | `ops_hr.mark_day` | OK | sakit |  |
| 17 | 6. Absensi | "Lampirkan surat dokter" pada hari sakit itu | Sari | `/hrd/absensi` | `ops_hr.attach_surat_dokter` | OK | sakit · surat dokter terlampir |  |
| 18 | 6. Absensi | Tandai hari yang sudah bertanda | Sari | `/hrd/absensi` | `ops_hr.mark_day` | DITOLAK |  | already_marked |
| 19 | 7. Cuti | "Ajukan": karyawan, jenis Cuti, dari–sampai tanggal, alasan | Sari | `/hrd/cuti` | `ops_hr.request_leave` | OK | PENDING |  |
| 20 | 7. Cuti | Ajukan izin di hari yang sudah diajukan cuti | Sari | `/hrd/cuti` | `ops_hr.request_leave` | DITOLAK |  | overlaps_existing |
| 21 | 7. Cuti | Tolak tanpa alasan | Sari | `/hrd/cuti` | `ops_hr.decide_leave` | DITOLAK |  | reason_required |
| 22 | 7. Cuti | "Setujui" | Sari | `/hrd/cuti` | `ops_hr.decide_leave` | OK | APPROVED · 2 hari bertanda cuti | Persetujuan menulis tanda hari di absensi; sisa cuti berkurang. |
| 23 | 8. Gajian | Buka run minggu ini dari "Gajian mingguan" ("Buka run minggu ini") | Sari | `/hrd/payroll/minggu` | `ops_hr.open_payroll_run` | OK | DRAFT | Baris gaji dihitung dari absensi saat dibaca; tidak ada tombol hitung. |
| 24 | 8. Gajian | Buka run yang periodenya bertumpuk | Sari | `/hrd/payroll` | `ops_hr.open_payroll_run` | DITOLAK |  | period_overlaps |
| 25 | 8. Gajian | Tambah penyesuaian: karyawan, jenis, nominal, alasan, "Tambahkan" | Sari | `/hrd/payroll/pyr-26-09-24_01` | `ops_hr.add_adjustment` | OK | DRAFT |  |
| 26 | 8. Gajian | Staf HRD mencoba menyetujui run | Sari | `/hrd/payroll/pyr-26-09-24_01` | `ops_hr.approve_payroll_run` | DITOLAK | DRAFT | not_permitted |
| 27 | 8. Gajian | Periksa total run sebelum diserahkan ke pimpinan | Sari | `/hrd/payroll/pyr-26-09-24_01` | `ops_hr.payroll_totals` | OK | DRAFT | 2 orang · bruto 5575000 · penyesuaian 150000 · bersih 5725000 · hari terbuka 0 |
| 28 | 8. Gajian | Pimpinan membuka run dan menekan "Approve the run" | Evin | `/hrd/payroll/pyr-26-09-24_01` | `ops_hr.approve_payroll_run` | OK | APPROVED |  |
| 29 | 9. Bayar gaji | Staf HRD mencoba mencatat pembayaran gaji ke buku besar | Sari | `/hrd/payroll/pyr-26-09-24_01` | `ops_acct.post_payroll_run` | DITOLAK | APPROVED | authority_required |
| 30 | 9. Bayar gaji | Catat pembayaran tanpa bukti transfer | Rina | `/hrd/payroll/pyr-26-09-24_01` | `ops_acct.post_payroll_run` | DITOLAK | APPROVED | evidence_required |
| 31 | 9. Bayar gaji | "Bayar run ini": rekening, nominal (terisi dari total bersih), bukti transfer | Rina | `/hrd/payroll/pyr-26-09-24_01` | `ops_acct.post_payroll_run` | OK | PAID · trx-26-09-24_001 | Satu baris buku besar untuk seluruh run — gaji per orang tidak ditulis ke buku besar. |
| 32 | 9. Bayar gaji | Bayar run yang sudah dibayar | Rina | `/hrd/payroll/pyr-26-09-24_01` | `ops_acct.post_payroll_run` | DITOLAK | PAID | already_paid |
| 33 | 9. Bayar gaji | Tandai transaksinya lengkap di buku besar | Rina | `/accounting/ledger` | `ops_acct.complete_transaction` | OK | COMPLETED |  |
