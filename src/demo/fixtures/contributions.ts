import type { ContributionRate, Enrolment } from "@/services/hr/contracts";

/** The public percentages, and a roll of names that is deliberately incomplete.
 *
 *  **The rates are published; the roll is not.** That asymmetry is the whole
 *  shape of Q30, and the owner's answer named it exactly: *data real nya belum
 *  ada — pastikan HRD bisa input dan biarkan akunting bisa audit*. So the
 *  percentages below are the national ones, cited, and the enrolments cover
 *  **five of forty people** — which is what a real register looks like in month
 *  one and exactly the state the screens have to be able to show without
 *  pretending otherwise.
 *
 *  One rate is **not** published and is marked as such: JKK is set per employer
 *  by BPJS between 0,24% and 1,74% according to the risk class of the business.
 *  A furniture workshop is plausibly class II; that is a guess, it is flagged
 *  `confirmed: false`, and it is Q49 on the open list. A rate nobody has
 *  checked must not look like one that has been.
 */
export const CONTRIBUTION_RATES: ContributionRate[] = [
  {
    id: "crt_kes", scheme: "BPJS_KESEHATAN", effective_from: "2026-01-01",
    employer_percent: 4, employee_percent: 1, wage_ceiling: 12_000_000,
    note: "5% dari upah: 4% perusahaan, 1% pekerja. Batas upah Rp 12.000.000 ditetapkan pemerintah dan berubah dari waktu ke waktu.",
    confirmed: true, created_by: "usr_shared", created_at: "2026-01-01T08:00:00+08:00",
  },
  {
    id: "crt_jht", scheme: "JHT", effective_from: "2026-01-01",
    employer_percent: 3.7, employee_percent: 2, wage_ceiling: null,
    note: "5,7% dari upah: 3,7% perusahaan, 2% pekerja. Tanpa batas upah.",
    confirmed: true, created_by: "usr_shared", created_at: "2026-01-01T08:00:00+08:00",
  },
  {
    id: "crt_jp", scheme: "JP", effective_from: "2026-01-01",
    employer_percent: 2, employee_percent: 1, wage_ceiling: 10_042_300,
    note: "3% dari upah: 2% perusahaan, 1% pekerja. Batas upah JP disetel BPJS tiap tahun — angka ini perlu dicek ulang setiap Maret.",
    confirmed: true, created_by: "usr_shared", created_at: "2026-01-01T08:00:00+08:00",
  },
  {
    id: "crt_jkk", scheme: "JKK", effective_from: "2026-01-01",
    employer_percent: 0.54, employee_percent: 0, wage_ceiling: null,
    note: "Dibayar penuh perusahaan. Persentasenya mengikuti KELAS RISIKO usaha, 0,24%–1,74%, dan ditetapkan BPJS per pemberi kerja. 0,54% di sini adalah kelas II sebagai perkiraan — BELUM dikonfirmasi (Q49).",
    confirmed: false, created_by: "usr_shared", created_at: "2026-01-01T08:00:00+08:00",
  },
  {
    id: "crt_jkm", scheme: "JKM", effective_from: "2026-01-01",
    employer_percent: 0.3, employee_percent: 0, wage_ceiling: null,
    note: "0,30% dari upah, dibayar penuh perusahaan.",
    confirmed: true, created_by: "usr_shared", created_at: "2026-01-01T08:00:00+08:00",
  },
];

let n = 0;
const e = (
  employee_id: string, scheme: Enrolment["scheme"], member_no: string | null,
  enrolled_on: string, declared_base: number | null = null,
  note: string | null = null, ended_on: string | null = null,
  ended_reason: string | null = null,
): Enrolment => {
  n += 1;
  return {
    id: `enr_${String(n).padStart(3, "0")}`,
    employee_id, scheme, member_no, enrolled_on, ended_on, ended_reason,
    declared_base, note,
    by: "usr_wulan", at: "2026-09-01T09:00:00+08:00",
  };
};

/** Five people, and four shapes worth having in the data.
 *
 *  - **Putri** is in everything, on her real wage — the ordinary case.
 *  - **Evin** is in everything and his BPJS Kesehatan base hits the ceiling,
 *    so the line shows what it was capped from rather than only the result.
 *  - **Anggun** is registered on a **declared wage lower than she is paid**,
 *    which is common and is the gap the field exists to make visible.
 *  - **Made** left BPJS Kesehatan in August and is still in the TK schemes —
 *    the row stays, with the date and the reason, so *was he covered in July*
 *    stays answerable (A5). His is the leak the owner described: an invoice
 *    that keeps charging for somebody who came off the roll.
 *  - **Karjo** is the one workshop hand registered so far, JHT only.
 */
export const ENROLMENTS: Enrolment[] = [
  e("emp_02", "BPJS_KESEHATAN", "0001234567890", "2021-07-01"),
  e("emp_02", "JHT", "21000123456", "2021-07-01"),
  e("emp_02", "JP", "21000123456", "2021-07-01"),
  e("emp_02", "JKK", "21000123456", "2021-07-01"),
  e("emp_02", "JKM", "21000123456", "2021-07-01"),
  e("emp_02", "PPH21", "09.876.543.2-901.000", "2021-07-01", null,
    "NPWP ada, status PTKP K/1. Perhitungannya belum dibangun."),

  e("emp_01", "BPJS_KESEHATAN", "0009876543210", "2019-03-01"),
  e("emp_01", "JHT", "21000987654", "2019-03-01"),
  e("emp_01", "JP", "21000987654", "2019-03-01"),

  e("emp_03", "BPJS_KESEHATAN", "0005555444433", "2022-02-01", 5_000_000,
    "Didaftarkan atas upah Rp 5.000.000, di bawah gaji sebenarnya."),
  e("emp_03", "JHT", "21000555544", "2022-02-01", 5_000_000, "Ikut upah yang didaftarkan."),

  e("emp_05", "BPJS_KESEHATAN", "0002222111100", "2020-04-01", null,
    "Pindah ikut BPJS istri.", "2026-08-31", "Pindah ke tanggungan BPJS istri per 1 September."),
  e("emp_05", "JHT", "21000222211", "2020-04-01"),
  e("emp_05", "JKK", "21000222211", "2020-04-01"),
  e("emp_05", "JKM", "21000222211", "2020-04-01"),

  e("emp_w009", "JHT", "21000777788", "2024-02-01", null, "Baru JHT; sisanya menyusul."),
];
