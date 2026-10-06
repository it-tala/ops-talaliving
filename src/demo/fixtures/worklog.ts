import type { WorkLog } from "@/services/hr/contracts";

/** A week of daily logs (D371), uneven on purpose.
 *
 *  Made logs every working day, and the count is a task; Andi logs most days
 *  and loses two of them to dadakan from the director; Anggun logs rarely, so
 *  Anggun's *Laporan harian terisi* is the low one, and the card says over how
 *  many days. Putri has no lines at all, and that measure reads as what it is.
 *  Nothing here is dated today: today is the reader's to write.
 */
let n = 0;
const w = (
  employee_id: string, work_date: string, summary: string,
  opts: Partial<WorkLog> = {},
): WorkLog => {
  n += 1;
  return {
    id: `wlg_${String(n).padStart(3, "0")}`,
    employee_id, work_date, task_id: null, summary,
    progress: "lanjut", requested_by: null, hours: null,
    created_by: employee_id === "emp_05" ? "usr_made" : employee_id === "emp_04" ? "usr_andi" : "usr_anggun",
    created_at: `${work_date}T16:30:00+07:00`, updated_at: null,
    promoted_task_id: null, promoted_by: null, promoted_at: null,
    ...opts,
  };
};

export const WORK_LOG: WorkLog[] = [
  /* Made — the count for the hotel order, every day, and one interruption. */
  w("emp_05", "2026-09-29", "Menyiapkan rak B untuk hitung papan jati", { requested_by: "Pak Evin", hours: 3, progress: "selesai" }),
  w("emp_05", "2026-09-30", "Bongkar kiriman kusen aluminium dari vendor", { requested_by: "Andi (procurement)", hours: 4, progress: "selesai" }),
  w("emp_05", "2026-10-01", "Mulai hitung papan jati 3×20 dan 2×10", { task_id: "tsk_g01", hours: 6 }),
  w("emp_05", "2026-10-02", "Papan 3×20 selesai dihitung, 2×10 setengah", { task_id: "tsk_g01", hours: 7 }),
  w("emp_05", "2026-10-05", "Hitung 2×10 dan sortir yang cacat", { task_id: "tsk_g01", hours: 6 }),

  /* Andi — the PR waits on Made's count, so two of his days went elsewhere. */
  w("emp_04", "2026-09-29", "Telepon tiga vendor kayu untuk penawaran Q4", { hours: 3 , requested_by: "Pak Evin"}),
  w("emp_04", "2026-09-30", "Mengurus retur kusen yang penyok", { requested_by: "Made (gudang)", hours: 5, progress: "selesai" }),
  w("emp_04", "2026-10-01", "Menunggu daftar kekurangan dari gudang", { task_id: "tsk_g02", progress: "tertahan", hours: 1 }),
  w("emp_04", "2026-10-02", "Cari harga cat duco untuk proyek villa", { requested_by: "Pak Evin", hours: 4, progress: "selesai" }),
  w("emp_04", "2026-10-05", "Draft PR dari daftar sementara gudang", { task_id: "tsk_g02", hours: 3 }),

  /* Anggun — two lines in a week. */
  w("emp_03", "2026-10-01", "Rekonsiliasi kas kecil September", { task_id: "tsk_g04", hours: 4 }),
  w("emp_03", "2026-10-02", "Selisih kas kecil ketemu, foto buku kas diunggah", { task_id: "tsk_g04", progress: "selesai", hours: 3 }),
];
