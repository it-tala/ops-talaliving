import type { PayRuleSet } from "@/services/hr/contracts";

/** The rule book, dated (D173).
 *
 *  Two versions on purpose, because the point of dating them is only visible
 *  when there are two: the January book paid overtime at a flat ordinary rate,
 *  which is what this system did before anybody asked (Q31); from July it
 *  follows the national ladder, which is what the owner says the business
 *  actually does. A payslip from March is still recomputable under March's
 *  rule, and that is the whole reason a change writes a new version instead of
 *  editing the old one.
 *
 *  Undertime ships **off**. The owner named it as a scheme that exists, but
 *  what a short hour costs here has not been stated — and a deduction invented
 *  by software reaches somebody's pocket (D174). The screen shows exactly what
 *  turning it on would cost, per person, before it is turned on.
 */
export const PAY_RULE_SETS: PayRuleSet[] = [
  {
    id: "prs_01", version: 1,
    effective_from: "2026-01-01",
    note: "Awal tahun: lembur dibayar tarif jam biasa, belum ada aturan bertingkat.",
    rules: {
      overtime_mode: "flat",
      workday_tiers: [{ after_hours: 0, multiplier: 1 }],
      restday_tiers: [{ after_hours: 0, multiplier: 1 }],
      flat_multiplier: 1,
      monthly_divisor: 173,
      hourly_basis: "statutory",
      effective_days_per_year: 288,
      hourly_includes_allowance: false,
      week_pattern: "6day",
      overtime_rounding_minutes: 0,
      undertime_mode: "off",
      undertime_grace_minutes: 15,
      day_starts_minutes: 8 * 60,
      /* Belum ada jadwal kerja tertulis waktu buku ini berlaku (D274). */
      schedules: [],
      schedule_by_unit: {},
      late_grace_minutes: 0,
      late_mode: "manual",
      late_forfeits_allowance: false,
    },
    created_by: "usr_shared",
    created_at: "2026-01-01T08:00:00+08:00",
  },
  {
    id: "prs_02", version: 2,
    effective_from: "2026-07-01",
    note: "Ikut ketentuan lembur nasional: jam pertama 1,5×, seterusnya 2×; hari libur 2× sampai jam ke-7, lalu 3× dan 4×.",
    rules: {
      overtime_mode: "statutory",
      /* Kepmenaker 102/2004 pasal 11: hari kerja biasa. */
      workday_tiers: [
        { after_hours: 0, multiplier: 1.5 },
        { after_hours: 1, multiplier: 2 },
      ],
      /* Istirahat mingguan / tanggal merah, pola enam hari kerja. */
      restday_tiers: [
        { after_hours: 0, multiplier: 2 },
        { after_hours: 7, multiplier: 3 },
        { after_hours: 8, multiplier: 4 },
      ],
      flat_multiplier: 1,
      monthly_divisor: 173,
      hourly_basis: "statutory",
      effective_days_per_year: 288,
      hourly_includes_allowance: false,
      week_pattern: "6day",
      overtime_rounding_minutes: 0,
      undertime_mode: "off",
      undertime_grace_minutes: 15,
      day_starts_minutes: 8 * 60,
      /* Belum ada jadwal kerja tertulis waktu buku ini berlaku (D274). */
      schedules: [],
      schedule_by_unit: {},
      late_grace_minutes: 0,
      late_mode: "manual",
      late_forfeits_allowance: false,
    },
    created_by: "usr_shared",
    created_at: "2026-06-28T16:30:00+08:00",
  },
  {
    id: "prs_03", version: 3,
    effective_from: "2026-09-01",
    note: "Jawaban pemilik atas Q41 dan pembagi per jam: upah dibaca sebagai pokok + tunjangan, satu jam dihitung dari setahun gaji ÷ hari kerja efektif ÷ jam sehari, dan terlambat punya toleransi 15 menit.",
    rules: {
      overtime_mode: "statutory",
      workday_tiers: [
        { after_hours: 0, multiplier: 1.5 },
        { after_hours: 1, multiplier: 2 },
      ],
      restday_tiers: [
        { after_hours: 0, multiplier: 2 },
        { after_hours: 7, multiplier: 3 },
        { after_hours: 8, multiplier: 4 },
      ],
      flat_multiplier: 1,
      /* Tetap ada, tetap 173, dan tetap dipakai tangga lembur nasional sebagai
         pembanding — bukan lagi jawaban atas *satu jam di sini berapa* (D249). */
      monthly_divisor: 173,
      hourly_basis: "company",
      /* Enam hari kerja: 52 × 6 = 312, dikurangi tanggal merah dan cuti
         bersama. 288 adalah 24 hari sebulan — konvensi enam-hari yang lazim
         dipakai di sini, bukan hitungan yang dikarang layar ini. Pemilik yang
         menetapkan angkanya; layar aturan menampilkan aritmatikanya. */
      effective_days_per_year: 288,
      /* Pemilik: *pakai pokok+allowance untuk perhitungan semua* (D250). */
      hourly_includes_allowance: true,
      week_pattern: "6day",
      overtime_rounding_minutes: 0,
      undertime_mode: "off",
      undertime_grace_minutes: 15,
      day_starts_minutes: 8 * 60,
      /* Belum ada jadwal kerja tertulis waktu buku ini berlaku (D274). */
      schedules: [],
      schedule_by_unit: {},
      /* Pemilik: *terlambat baru dipotong setelah 15 menit* (D251). */
      late_grace_minutes: 15,
      /* Masih manual: aturannya sudah ada, keputusan menyalakannya belum
         (D174). Layar aturan menghitung dampaknya per orang lebih dulu. */
      late_mode: "manual",
      /* Pemilik, mengoreksi jawabannya sendiri: *potongannya jam saja,
         allowance masih diberikan jika hadir* (D250). */
      late_forfeits_allowance: false,
    },
    created_by: "usr_shared",
    created_at: "2026-09-12T10:00:00+08:00",
  },
  {
    /* Q44 terjawab: bengkel mulai 07.30, kantor tetap 08.00, istirahat 45
       menit (D270).
       
       Versi baru, berlaku dari hari pemilik mengatakannya — bukan disurutkan
       ke belakang. Bengkel memang selalu masuk 07.30; yang baru adalah
       **tertulisnya**. Menyurutkan tanggalnya akan mengubah terhadap apa
       keterlambatan bulan-bulan lalu diukur, dan itulah satu hal yang justru
       dicegah oleh buku aturan bertanggal (D173). Yang benar adalah mencatat
       aturannya dari sekarang dan mengatakan terus terang bahwa sebelum ini
       jam masuk bengkel tidak pernah tercatat — layar aturan menuliskannya. */
    id: "prs_04", version: 4,
    /* Bertanggal sama dengan v3, bukan hari ini. Ini **koreksi, bukan
       perubahan kebijakan**: bengkel memang selalu masuk 07.30, dan 08.00
       untuk mereka tidak pernah jadi aturan — itu pertanyaan yang belum pernah
       ditanyakan. Menanggalkannya dari hari ini akan membuat sistem menyatakan
       bahwa sepanjang September bengkel mulai jam 08.00, dan itu tidak benar.
       Yang membuat penyurutan ini aman adalah `late_mode: "manual"`: tidak ada
       satu rupiah pun yang pernah dihitung dari aturan ini, jadi tidak ada
       keputusan yang ditulis ulang — hanya angka yang selama ini salah. v3
       tetap ada di catatan dan tidak diubah (A5). */
    effective_from: "2026-09-01",
    note: "Koreksi atas v3, berlaku dari tanggal yang sama. Jawaban pemilik atas Q44: lima pola kerja — produksi 07.30–16.30 istirahat 45 menit, kantor 08.00–17.15 istirahat 1 jam, Jumat istirahat 1,5 jam, satpam 12 jam, ART mulai 14.00. Sebelumnya satu jam masuk dipakai untuk semua unit — bukan kebijakan, melainkan pertanyaan yang belum ditanyakan.",
    rules: {
      overtime_mode: "statutory",
      workday_tiers: [
        { after_hours: 0, multiplier: 1.5 },
        { after_hours: 1, multiplier: 2 },
      ],
      restday_tiers: [
        { after_hours: 0, multiplier: 2 },
        { after_hours: 7, multiplier: 3 },
        { after_hours: 8, multiplier: 4 },
      ],
      flat_multiplier: 1,
      monthly_divisor: 173,
      hourly_basis: "company",
      effective_days_per_year: 288,
      hourly_includes_allowance: true,
      week_pattern: "6day",
      overtime_rounding_minutes: 0,
      undertime_mode: "off",
      undertime_grace_minutes: 15,
      /* Jam kantor, dan tetap jadi jawaban untuk unit yang belum diatur. */
      day_starts_minutes: 8 * 60,
      /* Lima pola kerja, dan tidak ada dua yang sama (Q44, D274). Yang tidak
         pernah disebut pemilik ditinggal null — jam mulai satpam dan jam
         pulang asisten rumah tangga adalah *belum ada yang bilang*, bukan nol.
         Istirahat Jumat lebih panjang untuk yang punya jam kantor dan bengkel;
         untuk dua pola sisanya belum ada yang menyebutkan. */
      schedules: [
        {
          code: "PRODUKSI", name: "Produksi",
          start_minutes: 7 * 60 + 30, end_minutes: 16 * 60 + 30,
          break_minutes: 45, friday_break_minutes: 90, note: null,
        },
        {
          code: "KANTOR", name: "Kantor",
          start_minutes: 8 * 60, end_minutes: 17 * 60 + 15,
          break_minutes: 60, friday_break_minutes: 90, note: null,
        },
        {
          code: "SATPAM", name: "Satpam — 12 jam",
          start_minutes: null, end_minutes: null,
          break_minutes: null, friday_break_minutes: null,
          note: "Dua belas jam sehari. Jam mulainya belum pernah disebutkan, dan apakah bergilir siang–malam juga belum — jadi ketepatan waktu orang di jadwal ini tidak bisa diukur sampai ada yang menetapkannya.",
        },
        {
          code: "ART", name: "Asisten rumah tangga",
          start_minutes: 14 * 60, end_minutes: null,
          break_minutes: null, friday_break_minutes: null,
          note: "Mulai jam 14.00. Jam pulang dan istirahatnya belum ditetapkan.",
        },
      ],
      /* Unit yang tidak ada di sini jatuh ke jam kantor di bawah, dan layar
         aturan mengatakannya. Satpam dan ART bukan unit — mereka pola kerja
         yang dipasang ke orangnya, dan di data contoh belum ada orangnya. */
      schedule_by_unit: {
        Workshop: "PRODUKSI",
        Office: "KANTOR",
        Warehouse: "PRODUKSI",
        Leadership: "KANTOR",
      },
      late_grace_minutes: 15,
      late_mode: "manual",
      late_forfeits_allowance: false,
    },
    created_by: "usr_shared",
    created_at: "2026-09-13T09:00:00+08:00",
  },
];
