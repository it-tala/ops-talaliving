import type { DesignTask, DesignRevision, DesignQuestion } from "@/services/production/contracts";

/** The drafting queue as it stands on a Friday (D179).
 *
 *  Five situations, because a queue where everything is fine teaches nobody how
 *  to read it:
 *
 *  - **Late and undrawn.** The rak display is on a work order due 15 September
 *    and nobody has started its gambar kerja.
 *  - **Blocked on an answer.** The pintu panel is drawn and cannot be released:
 *    nobody has confirmed whether the client wants a 40 mm or 45 mm leaf, and
 *    the question has been waiting nine days.
 *  - **Ahead of release.** The lemari's revision C exists and was never
 *    released, so the workshop is still cutting from B. This is the dangerous
 *    one — everything looks done.
 *  - **Ordered, not yet on the floor.** The nakas was ordered by VILLA
 *    SEMINYAK; there is no SPK yet, and its gambar jadi has never been made.
 *  - **Finished properly.** The meja makan: revision B released, nothing open.
 */
export const DESIGN_TASKS: DesignTask[] = [
  {
    id: "dsg_01", task_no: "dsn-26-08-20_01", product_code: "PRD-MJ-220",
    kind: "gambar_kerja", status: "RILIS", assignee: "Rizal",
    assignee_employee_id: null, assignee_not_a_person: false,
    due_date: "2026-08-24", note: null,
    created_by: "usr_shared", created_at: "2026-08-20T09:00:00+08:00",
  },
  {
    id: "dsg_02", task_no: "dsn-26-08-20_02", product_code: "PRD-MJ-220",
    kind: "gambar_jadi", status: "RILIS", assignee: "Rizal",
    assignee_employee_id: null, assignee_not_a_person: false,
    due_date: "2026-08-24", note: null,
    created_by: "usr_shared", created_at: "2026-08-20T09:02:00+08:00",
  },
  {
    id: "dsg_03", task_no: "dsn-26-08-22_01", product_code: "PRD-LM-3P",
    kind: "gambar_kerja", status: "DIGAMBAR", assignee: "Rizal",
    assignee_employee_id: null, assignee_not_a_person: false,
    due_date: "2026-09-02",
    note: "Revisi C: tarikan pintu diganti model panjang, permintaan klien 5 September.",
    created_by: "usr_shared", created_at: "2026-08-22T10:15:00+08:00",
  },
  {
    id: "dsg_04", task_no: "dsn-26-08-25_01", product_code: "PRD-PT-90",
    kind: "gambar_kerja", status: "TANYA", assignee: "Ayu",
    assignee_employee_id: null, assignee_not_a_person: false,
    due_date: "2026-09-05", note: null,
    created_by: "usr_shared", created_at: "2026-08-25T08:40:00+08:00",
  },
  {
    id: "dsg_05", task_no: "dsn-26-09-01_01", product_code: "PRD-RK-DSP",
    kind: "gambar_kerja", status: "BELUM", assignee: null,
    assignee_employee_id: null, assignee_not_a_person: false,
    due_date: null, note: null,
    created_by: "usr_shared", created_at: "2026-09-01T09:00:00+08:00",
  },
  {
    id: "dsg_06", task_no: "dsn-26-09-01_02", product_code: "PRD-NK-KCL",
    kind: "gambar_jadi", status: "BELUM", assignee: null,
    assignee_employee_id: null, assignee_not_a_person: false,
    due_date: null, note: null,
    created_by: "usr_shared", created_at: "2026-09-01T09:05:00+08:00",
  },
];

export const DESIGN_REVISIONS: DesignRevision[] = [
  {
    id: "drv_01", task_id: "dsg_01", rev: "A", attachment_id: null,
    filename: "PRD-MJ-220_kerja_revA.pdf", note: "Versi awal.",
    released_at: "2026-08-21T14:00:00+08:00", released_by: "usr_shared",
    uploaded_by: "usr_shared", uploaded_at: "2026-08-21T13:40:00+08:00",
  },
  {
    id: "drv_02", task_id: "dsg_01", rev: "B", attachment_id: null,
    filename: "PRD-MJ-220_kerja_revB.pdf",
    note: "Tebal top 40 mm, sesuai permintaan klien.",
    released_at: "2026-08-24T09:30:00+08:00", released_by: "usr_shared",
    uploaded_by: "usr_shared", uploaded_at: "2026-08-24T09:10:00+08:00",
  },
  {
    id: "drv_03", task_id: "dsg_02", rev: "A", attachment_id: null,
    filename: "PRD-MJ-220_jadi_revA.jpg", note: null,
    released_at: "2026-08-24T09:32:00+08:00", released_by: "usr_shared",
    uploaded_by: "usr_shared", uploaded_at: "2026-08-24T09:31:00+08:00",
  },
  /* The lemari: B is what the floor is building from, C exists and nobody
     released it. Everything looks finished from the outside. */
  {
    id: "drv_04", task_id: "dsg_03", rev: "A", attachment_id: null,
    filename: "PRD-LM-3P_kerja_revA.pdf", note: null,
    released_at: "2026-08-23T11:00:00+08:00", released_by: "usr_shared",
    uploaded_by: "usr_shared", uploaded_at: "2026-08-23T10:45:00+08:00",
  },
  {
    id: "drv_05", task_id: "dsg_03", rev: "B", attachment_id: null,
    filename: "PRD-LM-3P_kerja_revB.pdf", note: "Rel laci diganti full extension.",
    released_at: "2026-08-28T08:20:00+08:00", released_by: "usr_shared",
    uploaded_by: "usr_shared", uploaded_at: "2026-08-28T08:05:00+08:00",
  },
  {
    id: "drv_06", task_id: "dsg_03", rev: "C", attachment_id: null,
    filename: "PRD-LM-3P_kerja_revC.pdf", note: "Tarikan panjang, belum rilis.",
    released_at: null, released_by: null,
    uploaded_by: "usr_shared", uploaded_at: "2026-09-08T16:20:00+08:00",
  },
  {
    id: "drv_07", task_id: "dsg_04", rev: "A", attachment_id: null,
    filename: "PRD-PT-90_kerja_revA.pdf", note: "Menunggu keputusan tebal daun.",
    released_at: null, released_by: null,
    uploaded_by: "usr_shared", uploaded_at: "2026-09-02T15:00:00+08:00",
  },
];

export const DESIGN_QUESTIONS: DesignQuestion[] = [
  {
    id: "dqs_01", task_id: "dsg_04", asked_of: "klien",
    question: "Tebal daun pintu 40 mm atau 45 mm? Kusen yang sudah terpasang di lokasi 45 mm.",
    answer: null,
    asked_by: "usr_shared", asked_at: "2026-09-02T15:10:00+08:00",
    answered_by: null, answered_at: null,
  },
  {
    id: "dqs_02", task_id: "dsg_03", asked_of: "produksi",
    question: "Rel full extension 45 cm stoknya cukup untuk enam unit?",
    answer: "Cukup — 60 set masuk 26 Agustus, 24 dipakai unit pertama.",
    asked_by: "usr_shared", asked_at: "2026-08-27T09:00:00+08:00",
    answered_by: "usr_made", answered_at: "2026-08-27T11:30:00+08:00",
  },
];
