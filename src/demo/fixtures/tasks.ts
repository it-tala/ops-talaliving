import type { Task, TaskRoutine } from "@/services/hr/contracts";

/** What people were asked to do, and what happened to it.
 *
 *  Deliberately uneven, because the shapes are the point of the seed. There is
 *  a task finished early, one finished late, one open and overdue, one
 *  **blocked on somebody else** — which must not count against the person it is
 *  assigned to (D261) — and a person with no tasks at all, whose delivery
 *  therefore cannot be measured rather than measuring zero.
 *
 *  The workshop is largely absent from this list on purpose. Their work is
 *  recorded on the production board against a **name**, not an employee, so it
 *  cannot feed a score without matching people by string — which is exactly the
 *  cleverness that puts the wrong review on the wrong person (F81). Until that
 *  link exists, the honest thing is a tracker with few workshop rows and a KPI
 *  that says what it could not see.
 */
let n = 0;
const t = (
  assignee_id: string, title: string, due_date: string,
  status: Task["status"] = "OPEN",
  opts: Partial<Task> = {},
): Task => {
  n += 1;
  const no = `tgs-26-09-${String(n).padStart(2, "0")}_01`;
  return {
    id: `tsk_${String(n).padStart(3, "0")}`,
    task_no: no,
    title,
    detail: null,
    assignee_id,
    assigned_by: "usr_evin",
    assigned_at: "2026-09-01T08:00:00+08:00",
    due_date,
    ref_kind: "none",
    ref_no: null,
    status,
    done_at: null, done_by: null,
    blocked_reason: null, blocked_at: null,
    cancelled_reason: null,
    period_start: null, period_end: null,
    chase_date: null, deliverable: null, delivered_note: null,
    acknowledged_at: null,
    chased_at: null, chased_by: null, chase_note: null,
    routine_id: null,
    ...opts,
  };
};

export const TASKS: Task[] = [
  /* Putri — three due this month, two on time and one late. Measurable. */
  t("emp_02", "Tutup buku Agustus dan rekonsiliasi rekening koran BNI 325", "2026-09-05", "DONE",
    { done_at: "2026-09-04T16:00:00+08:00", done_by: "usr_putri" }),
  t("emp_02", "Kirim rekap pajak Agustus ke konsultan", "2026-09-10", "DONE",
    { done_at: "2026-09-12T11:00:00+08:00", done_by: "usr_putri",
      detail: "Terlambat dua hari; menunggu nota dari gudang." }),
  /* Asked for, acknowledged, and now **due to be chased** — the row the whole
     chase board is for. Nobody has asked yet, so it is on the leader's list
     today and comes off it when they record that they asked, not when the work
     arrives. */
  t("emp_02", "Cocokkan tagihan BPJS September dengan daftar karyawan terdaftar", "2026-09-15",
    "OPEN", { chase_date: "2026-09-13", acknowledged_at: "2026-09-01T08:40:00+08:00",
              deliverable: "Daftar selisih, nama per nama, dikirim ke WA pimpinan" }),

  /* Anggun — one done early, one blocked on somebody else. The blocked one is
     the row that must not touch her score. */
  t("emp_03", "Susun daftar vendor yang dobel untuk dibereskan", "2026-09-12", "DONE",
    { done_at: "2026-09-08T10:00:00+08:00", done_by: "usr_anggun" }),
  t("emp_03", "Input saldo awal kas kecil dari hasil opname gudang", "2026-09-09", "OPEN",
    { blocked_reason: "Menunggu tim gudang selesai menghitung fisik. Sudah ditanyakan dua kali.",
      blocked_at: "2026-09-08T09:00:00+08:00" }),

  /* Andi — one overdue and not blocked. This is what the score is for. */
  t("emp_04", "Minta penawaran ulang tiga vendor kayu untuk Q4", "2026-09-08"),
  /* Already chased, and still open. It must **not** appear on today's chase
     list: asking twice in one day is the noise that makes a leader stop
     reading the list at all. */
  t("emp_04", "Tutup PO yang barangnya sudah lengkap", "2026-09-20",
    "OPEN", { chase_date: "2026-09-18", chased_at: "2026-09-18T09:20:00+08:00",
              chased_by: "usr_evin", chase_note: "Ditanyakan di rapat pagi, katanya Jumat." }),

  /* Made — one done on time, one cancelled. A cancelled task is neither a
     success nor a failure and is left out of the arithmetic entirely. */
  t("emp_05", "Opname papan jati sebelum gajian", "2026-09-05", "DONE",
    { done_at: "2026-09-05T15:00:00+08:00", done_by: "usr_made" }),
  t("emp_05", "Siapkan rak sementara untuk kusen aluminium", "2026-09-18", "CANCELLED",
    { cancelled_reason: "Kusen langsung dikirim ke site, tidak lewat gudang." }),

  /* Karjo — a workshop hand with one task, to show the tracker works for them
     even though the production board cannot feed the score. Never
     acknowledged, on purpose: he has no account to acknowledge it with, which
     is the ordinary case for the workshop and the reason the column is
     evidence rather than a gate. */
  t("emp_w009", "Rapikan dan tandai sisa papan jati di rak B", "2026-09-16"),

  /* ── raised by a routine, three months of it ─────────────────────────────
     Same title, three rows, and the only thing telling them apart is the
     period — which is the argument for the column. August was handed in late
     and says what was handed in; July was on time; September is still open and
     already chased once. */
  t("emp_02", "Laporan keuangan bulanan", "2026-08-05", "DONE",
    { routine_id: "rtn_001", period_start: "2026-07-01", period_end: "2026-07-31",
      chase_date: "2026-08-03", deliverable: "Laba rugi dan neraca, PDF, ke email pimpinan",
      acknowledged_at: "2026-07-01T08:10:00+08:00",
      done_at: "2026-08-05T14:00:00+08:00", done_by: "usr_putri",
      delivered_note: "Dikirim ke email pimpinan 5 Agustus, lampiran PDF." }),
  t("emp_02", "Laporan keuangan bulanan", "2026-09-05", "DONE",
    { routine_id: "rtn_001", period_start: "2026-08-01", period_end: "2026-08-31",
      chase_date: "2026-09-03", deliverable: "Laba rugi dan neraca, PDF, ke email pimpinan",
      acknowledged_at: "2026-08-01T08:05:00+08:00",
      chased_at: "2026-09-03T10:00:00+08:00", chased_by: "usr_evin",
      chase_note: "Ditagih, katanya menunggu rekening koran BNI.",
      done_at: "2026-09-08T17:30:00+08:00", done_by: "usr_putri",
      delivered_note: "Terlambat tiga hari, menunggu rekening koran." }),
  t("emp_02", "Laporan keuangan bulanan", "2026-10-05", "OPEN",
    { routine_id: "rtn_001", period_start: "2026-09-01", period_end: "2026-09-30",
      chase_date: "2026-10-03", deliverable: "Laba rugi dan neraca, PDF, ke email pimpinan",
      acknowledged_at: "2026-09-01T08:00:00+08:00" }),

  /* And a weekly one on somebody else, so the board is not a single cadence
     and `Minggu 39/2026` has to render beside `Sep 2026`. */
  t("emp_03", "Opname kas kecil mingguan", "2026-09-21", "DONE",
    { routine_id: "rtn_002", period_start: "2026-09-14", period_end: "2026-09-20",
      chase_date: "2026-09-21", deliverable: "Foto buku kas dan selisihnya, ke grup WA",
      acknowledged_at: "2026-09-14T08:00:00+08:00",
      done_at: "2026-09-21T11:00:00+08:00", done_by: "usr_anggun",
      delivered_note: "Selisih 12.000, sudah dicatat." }),
  t("emp_03", "Opname kas kecil mingguan", "2026-09-28", "OPEN",
    { routine_id: "rtn_002", period_start: "2026-09-21", period_end: "2026-09-27",
      chase_date: "2026-09-28", deliverable: "Foto buku kas dan selisihnya, ke grup WA" }),
];

/** The standing expectations themselves (D296).
 *
 *  Two, and deliberately of different cadences: a monthly report due on the
 *  5th and chased two days before, and a weekly count due on the Monday after
 *  the week it covers. Between them they exercise both period shapes the label
 *  has to print, and the arithmetic that turns *tanggal 5, ditagih dua hari
 *  sebelumnya* into two real dates per period.
 */
export const TASK_ROUTINES: TaskRoutine[] = [
  {
    id: "rtn_001", routine_no: "rtn-26-07-01_01",
    title: "Laporan keuangan bulanan",
    detail: "Disepakati di rapat 1 Juli. Termasuk penjelasan singkat untuk selisih di atas 5 juta.",
    deliverable: "Laba rugi dan neraca, PDF, ke email pimpinan",
    assignee_id: "emp_02", cadence: "MONTHLY",
    due_offset_days: 5, chase_lead_days: 2,
    starts_on: "2026-07-01", ends_on: null, ended_reason: null,
    created_by: "usr_evin", created_at: "2026-07-01T09:00:00+08:00",
  },
  {
    id: "rtn_002", routine_no: "rtn-26-09-01_01",
    title: "Opname kas kecil mingguan",
    detail: null,
    deliverable: "Foto buku kas dan selisihnya, ke grup WA",
    assignee_id: "emp_03", cadence: "WEEKLY",
    due_offset_days: 1, chase_lead_days: 0,
    starts_on: "2026-09-01", ends_on: null, ended_reason: null,
    created_by: "usr_evin", created_at: "2026-09-01T09:00:00+08:00",
  },
];
