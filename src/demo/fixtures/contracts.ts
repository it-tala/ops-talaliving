import type {
  ClauseChecklistItem, ContractClause, EmploymentContract,
} from "@/services/hr/contracts";

/** Poin yang ditanyakan pada setiap kontrak, dan mana yang wajib.
 *
 *  **Data, bukan konstanta di kode.** Menambah satu baris di sini — dan satu
 *  baris di `ops_hr.clause_checklist` — membuat setiap kontrak melaporkannya
 *  hari itu juga, tanpa ada yang perlu di-backfill. Itu pola yang sama dengan
 *  checklist berkas 201, dan alasannya sama: daftar yang hidup di kode hanya
 *  benar sampai orang berikutnya lupa memperbaruinya.
 */
export const CLAUSE_CHECKLIST: ClauseChecklistItem[] = [
  { kind: "gaji_pokok",     required: true,  what: "Upah pokok dan satuannya — bulanan, harian atau per jam.", bears_on: "employees.base_rate", sort: 1 },
  { kind: "tunjangan",      required: true,  what: "Tunjangan dan satuannya. Nol pun harus disebut, supaya jelas memang tidak ada.", bears_on: "employees.allowance_rate", sort: 2 },
  { kind: "jam_kerja",      required: true,  what: "Jam masuk, jam pulang, dan berapa hari seminggu.", bears_on: "employees.schedule_code", sort: 3 },
  { kind: "cuti",           required: true,  what: "Berapa hari cuti berbayar setahun.", bears_on: "employees.paid_leave_days", sort: 4 },
  { kind: "jangka_waktu",   required: true,  what: "PKWT dengan tanggal berakhirnya, atau PKWTT.", bears_on: "employment_contracts.kind", sort: 5 },
  { kind: "masa_percobaan", required: true,  what: "Berapa lama, dan apa yang berlaku selama itu.", bears_on: null, sort: 6 },
  { kind: "keterlambatan",  required: true,  what: "Ada potongan atau tidak, dan bagaimana dihitung.", bears_on: "pay_rule_sets.late_mode", sort: 7 },
  { kind: "potongan",       required: true,  what: "Apa saja yang boleh dipotong dari upah.", bears_on: "pay_rule_sets.undertime_mode", sort: 8 },
  { kind: "lembur",         required: true,  what: "Bagaimana lembur dihitung dan siapa yang menyetujui.", bears_on: "pay_rule_sets.workday_tiers", sort: 9 },
  { kind: "pemutusan",      required: true,  what: "Pemberitahuan dan tata caranya.", bears_on: null, sort: 10 },
  { kind: "bpjs",           required: false, what: "Kepesertaan dan siapa menanggung apa.", bears_on: null, sort: 11 },
  { kind: "kerahasiaan",    required: false, what: "", bears_on: null, sort: 12 },
  { kind: "fasilitas",      required: false, what: "Kendaraan, mes, makan.", bears_on: null, sort: 13 },
  { kind: "penempatan",     required: false, what: "Lokasi kerja dan apakah bisa dipindah.", bears_on: null, sort: 14 },
  { kind: "lainnya",        required: false, what: "Yang tidak masuk mana pun di atas.", bears_on: null, sort: 15 },
];

/** Kontrak seperti keadaannya sungguhan: sebagian rapi, sebagian tidak, dan
 *  satu yang isinya tidak sama dengan yang dibayarkan.
 *
 *  Wulan punya PKWTT yang lengkap. Karjo punya PKWT yang **isinya berbeda dari
 *  sistem** — kertasnya menjanjikan cuti 14 hari dan potongan keterlambatan
 *  per jam, sementara payroll membayar 12 hari dan tidak memotong apa-apa.
 *  Itu bukan kontrivansi: itu yang terjadi ketika kontrak ditulis satu orang
 *  dan payroll diatur orang lain, dan menemukannya adalah alasan layar ini ada.
 *
 *  Trisno tidak punya kontrak sama sekali — `berkas-201` sudah mengatakannya,
 *  dan di sini ia hanya tidak muncul.
 */
export const EMPLOYMENT_CONTRACTS: EmploymentContract[] = [
  {
    id: "kkj_01", contract_no: "kkj-21-06-14_01", employee_id: "emp_02",
    kind: "PKWTT", effective_from: "2021-06-14", ends_on: null,
    status: "active", sha256: "9f2c…a41b", attachment_id: null,
    superseded_by: null, ended_on: null, ended_reason: null,
    note: "Karyawan tetap sejak percobaan tiga bulan selesai.",
  },
  {
    id: "kkj_02", contract_no: "kkj-25-09-25_01", employee_id: "emp_04",
    kind: "PKWT", effective_from: "2025-09-25", ends_on: "2026-09-24",
    status: "active", sha256: "31ad…77e0", attachment_id: null,
    superseded_by: null, ended_on: null, ended_reason: null,
    note: "Perpanjangan kedua.",
  },
  /* Draft: kertasnya sudah ditandatangani minggu lalu, isinya baru separuh
     dijawab. Inilah keadaan yang paling sering ditemui. */
  {
    id: "kkj_03", contract_no: "kkj-26-09-15_01", employee_id: "emp_05",
    kind: "PKWT", effective_from: "2026-10-01", ends_on: "2027-09-30",
    status: "draft", sha256: null, attachment_id: null,
    superseded_by: null, ended_on: null, ended_reason: null, note: null,
  },
];

export const CONTRACT_CLAUSES: ContractClause[] = [
  /* Wulan — lengkap, dan semuanya sesuai dengan yang dijalankan. */
  { contract_no: "kkj-21-06-14_01", kind: "gaji_pokok", quote: "Upah pokok sebesar Rp 6.500.000 (enam juta lima ratus ribu rupiah) per bulan.", page: 1, value: { amount: "6500000", per: "month" }, source: "typed", confirmed: true, confirmed_at: "2026-02-10T09:00:00+08:00", proposed_at: "2026-02-10T09:00:00+08:00" },
  { contract_no: "kkj-21-06-14_01", kind: "tunjangan", quote: "Tunjangan kehadiran Rp 25.000 untuk setiap hari masuk kerja.", page: 1, value: { amount: "25000", per: "day" }, source: "typed", confirmed: true, confirmed_at: "2026-02-10T09:02:00+08:00", proposed_at: "2026-02-10T09:02:00+08:00" },
  { contract_no: "kkj-21-06-14_01", kind: "jam_kerja", quote: "Jam kerja pukul 08.00 sampai 17.15, Senin sampai Sabtu.", page: 1, value: { schedule_code: "kantor" }, source: "typed", confirmed: true, confirmed_at: "2026-02-10T09:03:00+08:00", proposed_at: "2026-02-10T09:03:00+08:00" },
  { contract_no: "kkj-21-06-14_01", kind: "cuti", quote: "Cuti tahunan 12 (dua belas) hari kerja.", page: 2, value: { days: "12" }, source: "typed", confirmed: true, confirmed_at: "2026-02-10T09:04:00+08:00", proposed_at: "2026-02-10T09:04:00+08:00" },
  { contract_no: "kkj-21-06-14_01", kind: "jangka_waktu", quote: "Perjanjian ini berlaku untuk waktu tidak tertentu.", page: 1, value: { kind: "PKWTT" }, source: "typed", confirmed: true, confirmed_at: "2026-02-10T09:05:00+08:00", proposed_at: "2026-02-10T09:05:00+08:00" },
  { contract_no: "kkj-21-06-14_01", kind: "masa_percobaan", quote: "Masa percobaan selama 3 (tiga) bulan terhitung sejak tanggal mulai bekerja.", page: 1, value: { months: "3" }, source: "typed", confirmed: true, confirmed_at: "2026-02-10T09:06:00+08:00", proposed_at: "2026-02-10T09:06:00+08:00" },
  { contract_no: "kkj-21-06-14_01", kind: "keterlambatan", quote: "Keterlambatan dicatat dan ditegur; tidak ada potongan otomatis.", page: 2, value: { mode: "manual" }, source: "typed", confirmed: true, confirmed_at: "2026-02-10T09:07:00+08:00", proposed_at: "2026-02-10T09:07:00+08:00" },
  { contract_no: "kkj-21-06-14_01", kind: "potongan", quote: "Kekurangan jam kerja tidak dipotong dari upah.", page: 2, value: { mode: "off" }, source: "typed", confirmed: true, confirmed_at: "2026-02-10T09:08:00+08:00", proposed_at: "2026-02-10T09:08:00+08:00" },
  { contract_no: "kkj-21-06-14_01", kind: "lembur", quote: "Lembur dihitung sesuai ketentuan pemerintah dan harus disetujui atasan.", page: 2, value: { mode: "statutory" }, source: "typed", confirmed: true, confirmed_at: "2026-02-10T09:09:00+08:00", proposed_at: "2026-02-10T09:09:00+08:00" },
  { contract_no: "kkj-21-06-14_01", kind: "pemutusan", quote: "Pemberitahuan tertulis 30 (tiga puluh) hari sebelumnya.", page: 3, value: null, source: "typed", confirmed: true, confirmed_at: "2026-02-10T09:10:00+08:00", proposed_at: "2026-02-10T09:10:00+08:00" },

  /* Karjo — lengkap, dan **dua poin tidak sama dengan yang dijalankan**. */
  { contract_no: "kkj-25-09-25_01", kind: "gaji_pokok", quote: "Upah pokok sebesar Rp 180.000 (seratus delapan puluh ribu rupiah) per hari kerja.", page: 1, value: { amount: "180000", per: "day" }, source: "typed", confirmed: true, confirmed_at: "2026-02-11T10:00:00+08:00", proposed_at: "2026-02-11T10:00:00+08:00" },
  { contract_no: "kkj-25-09-25_01", kind: "tunjangan", quote: "Tunjangan kehadiran Rp 20.000 per hari masuk.", page: 1, value: { amount: "20000", per: "day" }, source: "typed", confirmed: true, confirmed_at: "2026-02-11T10:01:00+08:00", proposed_at: "2026-02-11T10:01:00+08:00" },
  { contract_no: "kkj-25-09-25_01", kind: "jam_kerja", quote: "Jam kerja pukul 07.30 sampai 16.30, enam hari dalam seminggu.", page: 1, value: { schedule_code: "produksi" }, source: "typed", confirmed: true, confirmed_at: "2026-02-11T10:02:00+08:00", proposed_at: "2026-02-11T10:02:00+08:00" },
  /* Kertasnya 14, sistemnya 12. */
  { contract_no: "kkj-25-09-25_01", kind: "cuti", quote: "Cuti tahunan 14 (empat belas) hari kerja.", page: 2, value: { days: "14" }, source: "typed", confirmed: true, confirmed_at: "2026-02-11T10:03:00+08:00", proposed_at: "2026-02-11T10:03:00+08:00" },
  { contract_no: "kkj-25-09-25_01", kind: "jangka_waktu", quote: "Perjanjian ini berlaku 1 (satu) tahun sejak tanggal mulai.", page: 1, value: { kind: "PKWT" }, source: "typed", confirmed: true, confirmed_at: "2026-02-11T10:04:00+08:00", proposed_at: "2026-02-11T10:04:00+08:00" },
  { contract_no: "kkj-25-09-25_01", kind: "masa_percobaan", quote: "Tidak ada masa percobaan pada perpanjangan ini.", page: 1, value: { months: "0" }, source: "typed", confirmed: true, confirmed_at: "2026-02-11T10:05:00+08:00", proposed_at: "2026-02-11T10:05:00+08:00" },
  /* Kertasnya memotong per jam; buku aturan tidak memotong apa-apa. */
  { contract_no: "kkj-25-09-25_01", kind: "keterlambatan", quote: "Keterlambatan dipotong secara proporsional dari upah per jam.", page: 2, value: { mode: "pro_rata" }, source: "typed", confirmed: true, confirmed_at: "2026-02-11T10:06:00+08:00", proposed_at: "2026-02-11T10:06:00+08:00" },
  { contract_no: "kkj-25-09-25_01", kind: "potongan", quote: "Kekurangan jam kerja tidak dipotong.", page: 2, value: { mode: "off" }, source: "typed", confirmed: true, confirmed_at: "2026-02-11T10:07:00+08:00", proposed_at: "2026-02-11T10:07:00+08:00" },
  { contract_no: "kkj-25-09-25_01", kind: "lembur", quote: "Lembur mengikuti ketentuan pemerintah.", page: 2, value: { mode: "statutory" }, source: "typed", confirmed: true, confirmed_at: "2026-02-11T10:08:00+08:00", proposed_at: "2026-02-11T10:08:00+08:00" },
  { contract_no: "kkj-25-09-25_01", kind: "pemutusan", quote: "Pemberitahuan 30 hari sebelumnya.", page: 3, value: null, source: "typed", confirmed: true, confirmed_at: "2026-02-11T10:09:00+08:00", proposed_at: "2026-02-11T10:09:00+08:00" },

  /* Sumiati — draft, separuh dijawab, dan satu di antaranya masih usulan yang
     belum ditandatangani siapa pun. */
  { contract_no: "kkj-26-09-15_01", kind: "gaji_pokok", quote: "Upah pokok sebesar Rp 175.000 per hari kerja.", page: 1, value: { amount: "175000", per: "day" }, source: "typed", confirmed: true, confirmed_at: "2026-09-16T08:00:00+08:00", proposed_at: "2026-09-16T08:00:00+08:00" },
  { contract_no: "kkj-26-09-15_01", kind: "tunjangan", quote: "Tunjangan kehadiran Rp 20.000 per hari masuk.", page: 1, value: { amount: "20000", per: "day" }, source: "typed", confirmed: true, confirmed_at: "2026-09-16T08:01:00+08:00", proposed_at: "2026-09-16T08:01:00+08:00" },
  { contract_no: "kkj-26-09-15_01", kind: "jangka_waktu", quote: "Perjanjian ini berlaku 1 (satu) tahun.", page: 1, value: { kind: "PKWT" }, source: "typed", confirmed: true, confirmed_at: "2026-09-16T08:02:00+08:00", proposed_at: "2026-09-16T08:02:00+08:00" },
  { contract_no: "kkj-26-09-15_01", kind: "lembur", quote: "Lembur mengikuti ketentuan pemerintah.", page: 2, value: { mode: "statutory" }, source: "extracted", confirmed: false, confirmed_at: null, proposed_at: "2026-09-16T08:10:00+08:00" },
];
