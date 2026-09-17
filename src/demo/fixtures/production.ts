import type { WorkOrder, ProgressEntry, VendorLeg } from "@/services/production/contracts";

/** The workshop floor, as it would look on a Friday.
 *
 *  Note the `project_code`: it is the project's **code**, not its name. Every
 *  reference across a service boundary is by code, and a screen that matched
 *  on the name would work until somebody renamed a project (D149, D150).
 *
 *  Six orders, deliberately not all healthy: one finished, one comfortable,
 *  one that is going to be late and can be seen to be late, one that has not
 *  started with four days to go, and one where finishing has been reported on
 *  more pieces than were sanded — which is either a mis-keyed number or work
 *  that skipped a stage, and either way is something a supervisor should be
 *  told about rather than something the screen should hide.
 */
export const WORK_ORDERS: WorkOrder[] = [
  {
    id: "wo_01", product_code: "PRD-MJ-220", wo_no: "spk-26-08-24_01",
    item_name: "Meja makan jati 220×100",
    description: "BABY ISLAND — 4 set, finishing natural matt.",
    qty: 4, uom: "set", project_code: "25007",
    due_date: "2026-09-05", status: "OPEN",
    created_at: "2026-08-24T08:00:00+08:00", created_by: "usr_made",
    /* Pinned to rev 1 — the only BOM that has ever existed in this data
       (D256). `bom_rev: null` on wo_07 is the honest other case: no catalogue
       product, so nothing to pin. */
    bom_rev: 1,
    route: "IN_HOUSE",
    cancelled_reason: null, note: null,
  },
  {
    id: "wo_02", product_code: "PRD-KR-STD", wo_no: "spk-26-08-24_02",
    item_name: "Kursi makan jati",
    description: "BABY ISLAND — 24 pcs, mengikuti meja wo_01.",
    qty: 24, uom: "pcs", project_code: "25007",
    due_date: "2026-09-12", status: "OPEN",
    created_at: "2026-08-24T08:05:00+08:00", created_by: "usr_made",
    /* Pinned to rev 1 — the only BOM that has ever existed in this data
       (D256). `bom_rev: null` on wo_07 is the honest other case: no catalogue
       product, so nothing to pin. */
    bom_rev: 1,
    route: "IN_HOUSE",
    cancelled_reason: null, note: null,
  },
  {
    id: "wo_03", product_code: "PRD-LM-3P", wo_no: "spk-26-08-28_01",
    item_name: "Lemari pakaian 3 pintu",
    description: "VILLA SEMINYAK — HPL putih, handle hitam.",
    qty: 6, uom: "unit", project_code: "25009",
    due_date: "2026-09-09", status: "OPEN",
    created_at: "2026-08-28T09:10:00+08:00", created_by: "usr_made",
    /* Pinned to rev 1 — the only BOM that has ever existed in this data
       (D256). `bom_rev: null` on wo_07 is the honest other case: no catalogue
       product, so nothing to pin. */
    bom_rev: 1,
    route: "IN_HOUSE",
    cancelled_reason: null, note: null,
  },
  {
    id: "wo_04", product_code: "PRD-RK-DSP", wo_no: "spk-26-09-01_01",
    item_name: "Rak display besi–kayu",
    description: "STANDARD (showroom) — belum mulai, menunggu besi dari vendor.",
    qty: 10, uom: "unit", project_code: "25004",
    due_date: "2026-09-15", status: "OPEN",
    created_at: "2026-09-01T08:30:00+08:00", created_by: "usr_made",
    /* Rangka besinya dibuat vendor; bengkel tinggal finishing dan packing.
       Sudah lewat tanggal janji vendor — dan itu keterlambatan vendor, bukan
       keterlambatan bengkel, yang papan tidak boleh mencampuradukkannya. */
    bom_rev: 1,
    route: "SUBCON",
    cancelled_reason: null, note: "Menunggu rangka besi dari Karya Logam Abadi.",
  },
  {
    id: "wo_05", product_code: "PRD-NK-KCL", wo_no: "spk-26-08-10_01",
    item_name: "Nakas jati kecil",
    description: "VILLA SEMINYAK — selesai dan sudah dikirim.",
    qty: 8, uom: "unit", project_code: "25009",
    due_date: "2026-08-29", status: "DONE",
    created_at: "2026-08-10T08:00:00+08:00", created_by: "usr_made",
    /* Pinned to rev 1 — the only BOM that has ever existed in this data
       (D256). `bom_rev: null` on wo_07 is the honest other case: no catalogue
       product, so nothing to pin. */
    bom_rev: 1,
    route: "IN_HOUSE",
    cancelled_reason: null, note: null,
  },
  {
    id: "wo_06", product_code: "PRD-PT-90", wo_no: "spk-26-08-30_01",
    item_name: "Pintu panel jati 90×210",
    description: "VILLA SEMINYAK — 12 daun pintu.",
    qty: 12, uom: "daun", project_code: "25009",
    due_date: "2026-09-08", status: "OPEN",
    created_at: "2026-08-30T08:00:00+08:00", created_by: "usr_made",
    /* Pinned to rev 1 — the only BOM that has ever existed in this data
       (D256). `bom_rev: null` on wo_07 is the honest other case: no catalogue
       product, so nothing to pin. */
    bom_rev: 1,
    route: "IN_HOUSE",
    cancelled_reason: null, note: null,
  },
  {
    id: "wo_07", product_code: null, wo_no: "spk-26-09-02_01",
    item_name: "Kusen aluminium + kaca, 8 bukaan",
    description: "VILLA SEMINYAK — dibuat vendor, kembali untuk finishing & packing.",
    qty: 8, uom: "unit", project_code: "25009",
    due_date: "2026-09-16", status: "OPEN",
    created_at: "2026-09-02T08:00:00+08:00", created_by: "usr_made",
    /* Sudah kembali, jadi finishing boleh dicatat. Selama masih di vendor,
       API menolak pencatatan tahap apa pun (D255). */
    bom_rev: null,
    route: "SUBCON",
    cancelled_reason: null, note: null,
  },
];

/** `link` is an employee id, `"team"` for a name somebody has confirmed is not
 *  one person, or omitted for the ordinary state of this data: **nobody has
 *  been asked yet** (D264). The three are genuinely three, and the seed carries
 *  all of them because the screen that resolves them has to have something to
 *  resolve. */
const e = (
  id: string, wo_id: string, stage: string, qty: number, work_date: string,
  worked_by: string | null, note: string | null = null,
  link: string | "team" | null = null,
): ProgressEntry => ({
  id, wo_id, stage, qty, work_date, worked_by,
  worked_by_employee_id: link && link !== "team" ? link : null,
  worked_by_not_a_person: link === "team",
  source: "manual", source_ref: null, note,
  recorded_by: "usr_made", recorded_at: `${work_date}T17:00:00+08:00`,
});

export const PRODUCTION_PROGRESS: ProgressEntry[] = [
  /* wo_01 — meja BABY ISLAND. Past its date with one set left in finishing. */
  e("prg_01", "wo_01", "POTONG", 4, "2026-08-25", "Tim potong", null, "team"),
  e("prg_02", "wo_01", "SERUT", 4, "2026-08-26", "Karjo", null, "emp_w009"),
  e("prg_03", "wo_01", "RAKIT", 4, "2026-08-28", "Trisno", null, "emp_w012"),
  e("prg_04", "wo_01", "AMPLAS", 4, "2026-08-29", "Sumiati", null, "emp_w006"),
  e("prg_05", "wo_01", "FINISHING", 3, "2026-09-02", "Sakirin", null, "emp_w016"),
  e("prg_06", "wo_01", "QC", 3, "2026-09-03", "Made Suparta", null, "emp_05"),
  e("prg_07", "wo_01", "PACKING", 3, "2026-09-03", "Tim packing", null, "team"),

  /* wo_02 — kursi. Early stages, plenty of time. */
  e("prg_08", "wo_02", "POTONG", 24, "2026-08-27", "Tim potong", null, "team"),
  e("prg_09", "wo_02", "SERUT", 18, "2026-08-31", "Karjo", null, "emp_w009"),
  e("prg_10", "wo_02", "RAKIT", 10, "2026-09-03", "Trisno"),

  /* wo_03 — lemari. Behind, and the date is close. */
  e("prg_11", "wo_03", "POTONG", 6, "2026-08-31", "Tim potong"),
  e("prg_12", "wo_03", "SERUT", 6, "2026-09-01", "Pranowo"),   /* nama jelas, tinggal dikonfirmasi */
  e("prg_13", "wo_03", "RAKIT", 2, "2026-09-04", "Trisno"),
  /* Dua orang bernama Andi: B-036 di bengkel dan K-011 di kantor. Sistem
     tidak boleh menebak, dan layar penautan menolak memberi saran (D264). */
  e("prg_13b", "wo_03", "RAKIT", 2, "2026-09-05", "Andi"),
  /* Bukan karyawan, dan belum ada yang bilang begitu. */
  e("prg_13c", "wo_03", "AMPLAS", 4, "2026-09-07", "CV Rimba Jaya (subkon)"),

  /* wo_05 — nakas, finished all the way through. */
  e("prg_14", "wo_05", "POTONG", 8, "2026-08-12", "Tim potong", null, "team"),
  e("prg_15", "wo_05", "SERUT", 8, "2026-08-13", "Karjo", null, "emp_w009"),
  e("prg_16", "wo_05", "RAKIT", 8, "2026-08-17", "Trisno", null, "emp_w012"),
  e("prg_17", "wo_05", "AMPLAS", 8, "2026-08-19", "Sumiati", null, "emp_w006"),
  e("prg_18", "wo_05", "FINISHING", 8, "2026-08-24", "Sakirin", null, "emp_w016"),
  e("prg_19", "wo_05", "QC", 8, "2026-08-26", "Made Suparta", null, "emp_05"),
  e("prg_20", "wo_05", "PACKING", 8, "2026-08-27", "Tim packing", null, "team"),

  /* wo_06 — pintu. Finishing reported on more pieces than were sanded: either
     a mis-keyed number or work that skipped a stage. The board says so rather
     than quietly averaging it away. */
  e("prg_21", "wo_06", "POTONG", 12, "2026-09-01", "Tim potong"),
  e("prg_22", "wo_06", "SERUT", 12, "2026-09-02", "Pranowo"),
  e("prg_23", "wo_06", "RAKIT", 9, "2026-09-03", "Trisno"),
  e("prg_24", "wo_06", "AMPLAS", 4, "2026-09-04", "Sumiati"),
  e("prg_25", "wo_06", "FINISHING", 7, "2026-09-04", "Sakirin", "Dilaporkan sore, angka menyusul dari mandor."),
];

/* wo_07 — dicatat langsung ke empat tahap yang baru, bukan ke tujuh yang lama.
   Ini yang membuat roll-up bisa dilihat kerjanya: entri baru dihitung apa
   adanya, entri lama dilipat dengan minimum (F74). */
PRODUCTION_PROGRESS.push(
  /* prg_26 / prg_27, not prg_23 / prg_24 — those ids were already taken by
     wo_06 above, and two rows sharing a primary key is a seed that works only
     for as long as nothing looks an entry up by id. Linking a name to a person
     is exactly that (F84). */
  e("prg_26", "wo_07", "FINISHING", 5, "2026-09-10", "Sakirin", null, "emp_w016"),
  /* wo_04 is the display rack, the one product in the seed that actually has
     something to install — lampu strip and its wiring. Machinery reads 0 on
     every other order, and that is honest rather than broken: a plain dining
     table has no lamps in it. Whether a stage that does not apply should show
     as *0* at all is the substance of Q52 (D275). */
  e("prg_28", "wo_04", "AMPLAS", 6, "2026-09-08", "Sumiati", null, "emp_w006"),
  e("prg_29", "wo_04", "FINISHING", 4, "2026-09-10", "Sakirin", null, "emp_w016"),
  e("prg_30", "wo_04", "MACHINERY", 2, "2026-09-12", "Thohari", "Pasang lampu strip dan kabel.", "emp_w027"),
  e("prg_27", "wo_07", "QC", 3, "2026-09-11", "Made Suparta", null, "emp_05"),
);

/** Where things actually are, vendor by vendor (W6, D280).
 *
 *  The owner's own list of who does what: *vendor barang mentah, proses jok,
 *  amplas, packing*. Four situations, because a board where every trip is on
 *  time teaches nobody how to read it:
 *
 *  - **Out and overdue.** The rak display frames went to Karya Logam on 1
 *    September, promised back on the 9th, and are still there. This is the leg
 *    that used to be the work order's four `subcon_*` columns — one trip was
 *    all they could hold.
 *  - **A second leg on the same order.** The same rak display's timber went to
 *    a different vendor for sanding. Two vendors, one order, which is the
 *    thing the old shape could not say at all.
 *  - **Came back short.** Twenty chair frames went for upholstery, eighteen
 *    came back. The two that did not are a question somebody has to put to the
 *    vendor, and a tick-box would have lost it.
 *  - **Closed, on time, unremarkable.** Because a list where everything is
 *    wrong is as useless as one where nothing is.
 */
export const VENDOR_LEGS: VendorLeg[] = [
  {
    id: "vlg_01", leg_no: "vnl-26-09-01_01", wo_id: "wo_04",
    process: "BARANG_MENTAH", vendor_id: "vnd_06", qty: 10,
    sent_on: "2026-09-01", expected_back: "2026-09-09",
    returned_on: null, returned_qty: null,
    note: "Rangka besi dilas di Karya Logam, kayunya ikut dikirim ke sana.",
    created_by: "usr_made", created_at: "2026-09-01T08:30:00+08:00",
  },
  {
    id: "vlg_02", leg_no: "vnl-26-09-03_01", wo_id: "wo_04",
    process: "AMPLAS", vendor_id: "vnd_22", qty: 10,
    sent_on: "2026-09-03", expected_back: "2026-09-08",
    returned_on: "2026-09-08", returned_qty: 10,
    note: null,
    created_by: "usr_made", created_at: "2026-09-03T09:00:00+08:00",
  },
  {
    id: "vlg_03", leg_no: "vnl-26-09-02_01", wo_id: "wo_02",
    process: "JOK", vendor_id: "vnd_21", qty: 20,
    sent_on: "2026-09-02", expected_back: "2026-09-10",
    returned_on: "2026-09-11", returned_qty: 18,
    note: "Dua rangka dikembalikan belum dijok — kainnya kurang, menunggu kiriman klien.",
    created_by: "usr_made", created_at: "2026-09-02T10:15:00+08:00",
  },
  {
    id: "vlg_04", leg_no: "vnl-26-09-10_01", wo_id: "wo_06",
    process: "PACKING", vendor_id: "vnd_20", qty: 12,
    sent_on: "2026-09-10", expected_back: null,
    returned_on: null, returned_qty: null,
    note: "Belum ada janji tanggal kembali — tidak bisa disebut terlambat sampai ada.",
    created_by: "usr_made", created_at: "2026-09-10T14:00:00+08:00",
  },
];
