import type { Task } from "@/services/hr/contracts";

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
  t("emp_02", "Cocokkan tagihan BPJS September dengan daftar karyawan terdaftar", "2026-09-15"),

  /* Anggun — one done early, one blocked on somebody else. The blocked one is
     the row that must not touch her score. */
  t("emp_03", "Susun daftar vendor yang dobel untuk dibereskan", "2026-09-12", "DONE",
    { done_at: "2026-09-08T10:00:00+08:00", done_by: "usr_anggun" }),
  t("emp_03", "Input saldo awal kas kecil dari hasil opname gudang", "2026-09-09", "OPEN",
    { blocked_reason: "Menunggu tim gudang selesai menghitung fisik. Sudah ditanyakan dua kali.",
      blocked_at: "2026-09-08T09:00:00+08:00" }),

  /* Andi — one overdue and not blocked. This is what the score is for. */
  t("emp_04", "Minta penawaran ulang tiga vendor kayu untuk Q4", "2026-09-08"),
  t("emp_04", "Tutup PO yang barangnya sudah lengkap", "2026-09-20"),

  /* Made — one done on time, one cancelled. A cancelled task is neither a
     success nor a failure and is left out of the arithmetic entirely. */
  t("emp_05", "Opname papan jati sebelum gajian", "2026-09-05", "DONE",
    { done_at: "2026-09-05T15:00:00+08:00", done_by: "usr_made" }),
  t("emp_05", "Siapkan rak sementara untuk kusen aluminium", "2026-09-18", "CANCELLED",
    { cancelled_reason: "Kusen langsung dikirim ke site, tidak lewat gudang." }),

  /* Karjo — a workshop hand with one task, to show the tracker works for them
     even though the production board cannot feed the score. */
  t("emp_w009", "Rapikan dan tandai sisa papan jati di rak B", "2026-09-16"),
];
