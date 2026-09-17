import type {
  Delivery, DeliveryLine, Installation, InstallationLine, Snag, Handover,
} from "@/services/delivery/contracts";

/** The last leg, as it really goes (D209).
 *
 *  Four things the demo is built to show without anybody clicking:
 *
 *  - **VILLA SEMINYAK is the ordinary middle.** The only line the workshop has
 *    actually finished is the nakas: eight made, eight delivered, five fitted,
 *    three standing in the hallway. Three numbers, none of them equal, which is
 *    the state every live job is in and the state no screen could describe.
 *  - **A consignment that left four days ago and has never been marked
 *    arrived.** Not an error — a truck that reached a site and nobody wrote it
 *    down, which is the most common way this record goes wrong.
 *  - **OFFICE FITOUT has no SPK behind what it shipped at all.** An old job,
 *    migrated in. `dibuat` reads `?` rather than `0`, because nothing in
 *    production knows about it — and on a handed-over project that is history
 *    rather than a task, so it does not raise a warning (F60).
 *  - **A snag that outlives the visit that found it.** Raised on the fitting
 *    day, still open eleven days later, and it is the reason the handover is
 *    not clean.
 *  - **OFFICE FITOUT, handed over with two notes still open.** Signed, dated,
 *    the BAST attached — and the two open snags frozen onto the record, because
 *    a handover that pretends the list was empty is the one thing this record
 *    must not be able to say (D212).
 */
export const DELIVERIES: Delivery[] = [
  {
    /* The nakas: the one Villa Seminyak line the floor has finished. */
    id: "dlv_01", delivery_no: "krm-26-09-02_01", project_code: "25009",
    dispatched_on: "2026-09-02", vehicle: "Colt diesel B 9421 KJ", driver: "Sukirman",
    status: "ARRIVED",
    received_by: "Pak Yoga (site manager)", received_at: "2026-09-02T14:30:00+08:00",
    surat_jalan_attachment_id: "att_60", photo_attachment_id: "att_61",
    note: "Delapan nakas, dibongkar di carport.", cancelled_reason: null,
    created_by: "usr_made", created_at: "2026-09-02T07:40:00+08:00",
  },
  {
    /* Two of the three finished dining tables. The third is made and still in
       the yard, which is what the *siap kirim* panel exists to show. Left on
       the 8th, and nobody has written down that it arrived. */
    id: "dlv_02", delivery_no: "krm-26-09-08_01", project_code: "25007",
    dispatched_on: "2026-09-08", vehicle: "Pick-up L300 DK 1780 AH", driver: "Komang",
    status: "IN_TRANSIT",
    received_by: null, received_at: null,
    surat_jalan_attachment_id: "att_63", photo_attachment_id: null,
    note: "Dua set naik duluan; satu lagi menunggu truk berikutnya.", cancelled_reason: null,
    created_by: "usr_made", created_at: "2026-09-08T08:05:00+08:00",
  },
  {
    /* June, and nothing in production knows about it. */
    id: "dlv_04", delivery_no: "krm-26-06-11_01", project_code: "25012",
    dispatched_on: "2026-06-11", vehicle: "Colt diesel B 9421 KJ", driver: "Sukirman",
    status: "ARRIVED",
    received_by: "Ibu Ratna (GA)", received_at: "2026-06-11T13:00:00+08:00",
    surat_jalan_attachment_id: "att_64", photo_attachment_id: "att_65",
    note: null, cancelled_reason: null,
    created_by: "usr_made", created_at: "2026-06-11T07:00:00+08:00",
  },
];

export const DELIVERY_LINES: DeliveryLine[] = [
  { id: "dll_01", delivery_id: "dlv_01", project_line_id: "prl_06", description: "Nakas jati kecil", qty: 8, uom: "unit", note: null },
  { id: "dll_02", delivery_id: "dlv_02", project_line_id: "prl_01", description: "Meja makan jati 220×100, finishing natural matt", qty: 2, uom: "set", note: "Satu set lagi sudah jadi, menunggu truk." },
  { id: "dll_04", delivery_id: "dlv_04", project_line_id: "prl_10", description: "Lemari arsip 3 pintu", qty: 4, uom: "unit", note: null },
];

export const INSTALLATIONS: Installation[] = [
  {
    id: "ins_01", install_no: "pas-26-09-04_01", project_code: "25009",
    visit_date: "2026-09-04", crew: "Tim Wayan (3 orang)", status: "DONE",
    note: "Lima nakas terpasang di kamar utama dan dua kamar anak; tiga menunggu kamar tamu selesai dicat.",
    cancelled_reason: null, created_by: "usr_made", created_at: "2026-09-04T07:30:00+08:00",
  },
  {
    id: "ins_03", install_no: "pas-26-09-15_01", project_code: "25009",
    visit_date: "2026-09-15", crew: "Tim Wayan", status: "SCHEDULED",
    note: "Sisa tiga nakas, dan lemari kalau sudah sampai.",
    cancelled_reason: null, created_by: "usr_made", created_at: "2026-09-09T09:00:00+08:00",
  },
  {
    id: "ins_04", install_no: "pas-26-06-12_01", project_code: "25012",
    visit_date: "2026-06-12", crew: "Tim Wayan (2 orang)", status: "DONE",
    note: null, cancelled_reason: null, created_by: "usr_made", created_at: "2026-06-12T07:30:00+08:00",
  },
];

export const INSTALLATION_LINES: InstallationLine[] = [
  { id: "inl_01", installation_id: "ins_01", project_line_id: "prl_06", qty: 5, note: "Tiga menunggu kamar tamu." },
  { id: "inl_03", installation_id: "ins_04", project_line_id: "prl_10", qty: 4, note: null },
];

export const SNAGS: Snag[] = [
  {
    id: "sng_01", snag_no: "tmn-26-09-04_01", project_code: "25009", project_line_id: "prl_06",
    raised_on: "2026-09-04", raised_by: "Pak Yoga (site manager)",
    description: "Laci nakas kamar utama seret, kayunya memuai.",
    severity: "minor", status: "FIXED",
    photo_attachment_id: "att_66",
    fixed_on: "2026-09-09", fixed_by: "Tim Wayan", fix_note: "Sisi laci diserut tipis dan dililin.",
  },
  {
    /* Raised on the fitting day, still open. This is why the handover on this
       project will not be clean, and it is visible here before anybody asks. */
    id: "sng_02", snag_no: "tmn-26-09-04_02", project_code: "25009", project_line_id: "prl_06",
    raised_on: "2026-09-04", raised_by: "Pak Yoga (site manager)",
    description: "Dua nakas warnanya lebih gelap dari sampel yang disetujui klien.",
    severity: "major", status: "OPEN",
    photo_attachment_id: "att_67",
    fixed_on: null, fixed_by: null, fix_note: null,
  },
  {
    id: "sng_03", snag_no: "tmn-26-09-04_03", project_code: "25009", project_line_id: null,
    raised_on: "2026-09-04", raised_by: "Tim Wayan",
    description: "Lantai koridor tergores waktu nakas digeser — perlu dipoles ulang.",
    severity: "minor", status: "OPEN",
    photo_attachment_id: null,
    fixed_on: null, fixed_by: null, fix_note: null,
  },
  {
    id: "sng_04", snag_no: "tmn-26-06-12_01", project_code: "25012", project_line_id: "prl_10",
    raised_on: "2026-06-12", raised_by: "Ibu Ratna (GA)",
    description: "Kunci lemari arsip nomor 3 seret.",
    severity: "minor", status: "OPEN",
    photo_attachment_id: null,
    fixed_on: null, fixed_by: null, fix_note: null,
  },
  {
    id: "sng_05", snag_no: "tmn-26-06-12_02", project_code: "25012", project_line_id: null,
    raised_on: "2026-06-12", raised_by: "Ibu Ratna (GA)",
    description: "Sisa serbuk gergaji di belakang lemari, belum dibersihkan tuntas.",
    severity: "minor", status: "OPEN",
    photo_attachment_id: null,
    fixed_on: null, fixed_by: null, fix_note: null,
  },
];

export const HANDOVERS: Handover[] = [
  {
    id: "hdo_01", handover_no: "bast-26-06-18_01", project_code: "25012",
    handed_on: "2026-06-18",
    client_rep: "Ibu Ratna Kusuma (GA Manager)", our_rep: "Made Suparta",
    bast_attachment_id: "att_68",
    /* Frozen onto the record on the day it was signed. The two are still open
       three months later, and the handover says so for ever (D212). */
    open_snags_at_handover: 2,
    open_snag_nos: ["tmn-26-06-12_01", "tmn-26-06-12_02"],
    note: "Diserahterimakan dengan dua catatan; klien setuju diselesaikan menyusul.",
    created_by: "usr_made", created_at: "2026-06-18T15:00:00+08:00",
  },
];
