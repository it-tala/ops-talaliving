import type { PackingBox, BoxLine } from "@/services/delivery/contracts";

/** What actually leaves the workshop: peti, not lines (D262).
 *
 *  A delivery note says *two set meja makan*. A lorry arrives carrying nine
 *  wooden crates. Nobody on site can reconcile those two sentences, and today
 *  nobody tries — the crew opens crates until they find the one they need, and
 *  a short shipment is discovered a week later when the fitter reaches for a
 *  handle that was never sent.
 *
 *  Four things this seed is built to show:
 *
 *  - **One item, two boxes.** A dining set ships as a top and a leg-and-bolt
 *    box. Either one alone is worth nothing, and the delivery note that says
 *    "1 set" cannot express that. `kol-26-09-08_01` and `_02` can.
 *  - **Five nakas fitted, three waiting** — the same three numbers the
 *    delivery record already carries, now attached to the rooms they are
 *    standing outside of. Three boxes `INSTALLED`, one `ON_SITE`.
 *  - **The box that stops the job.** `kol-26-09-02_05` holds the handles and
 *    the screws. It was scanned, it was short, and it is flagged with the
 *    sentence that says so. This is the single most common way a fitting day
 *    is lost, and there is nowhere in the old system to write it down.
 *  - **A consignment from before any of this existed.** OFFICE FITOUT, June,
 *    has no boxes at all. The screen must say *tidak ada peti tercatat*, never
 *    *0 peti* — an old job that predates the labels is a gap in the record,
 *    not an empty lorry (F60).
 */
export const PACKING_BOXES: PackingBox[] = [
  /* ── The nakas run: five boxes, four states ───────────────────────── */
  {
    id: "box_01", box_no: "kol-26-09-02_01", project_code: "25009",
    delivery_id: "dlv_01", destination: "Lantai 2 — kamar tidur utama",
    packed_by: "usr_made", packed_at: "2026-09-02T06:50:00+08:00",
    status: "INSTALLED",
    scanned_by: "usr_made", scanned_at: "2026-09-02T14:35:00+08:00",
    problem_note: null, note: null,
  },
  {
    id: "box_02", box_no: "kol-26-09-02_02", project_code: "25009",
    delivery_id: "dlv_01", destination: "Lantai 2 — kamar anak 1",
    packed_by: "usr_made", packed_at: "2026-09-02T06:55:00+08:00",
    status: "INSTALLED",
    scanned_by: "usr_made", scanned_at: "2026-09-02T14:36:00+08:00",
    problem_note: null, note: null,
  },
  {
    id: "box_03", box_no: "kol-26-09-02_03", project_code: "25009",
    delivery_id: "dlv_01", destination: "Lantai 2 — kamar anak 2",
    packed_by: "usr_made", packed_at: "2026-09-02T07:00:00+08:00",
    status: "INSTALLED",
    scanned_by: "usr_made", scanned_at: "2026-09-02T14:36:00+08:00",
    problem_note: null, note: null,
  },
  {
    /* Arrived, scanned, and still standing in the corridor because the room it
       belongs in is being painted. Three nakas — the same three the delivery
       record has been carrying as a bare number since the 4th. */
    id: "box_04", box_no: "kol-26-09-02_04", project_code: "25009",
    delivery_id: "dlv_01", destination: "Lantai 2 — kamar tamu",
    packed_by: "usr_made", packed_at: "2026-09-02T07:05:00+08:00",
    status: "ON_SITE",
    scanned_by: "usr_made", scanned_at: "2026-09-02T14:37:00+08:00",
    problem_note: null,
    note: "Ditaruh di koridor, kamar tamu masih dicat.",
  },
  {
    /* The small box that decides whether anybody can work. */
    id: "box_05", box_no: "kol-26-09-02_05", project_code: "25009",
    delivery_id: "dlv_01", destination: "Lantai 2 — koridor (aksesoris)",
    packed_by: "usr_made", packed_at: "2026-09-02T07:10:00+08:00",
    status: "PROBLEM",
    scanned_by: "usr_made", scanned_at: "2026-09-02T14:40:00+08:00",
    problem_note: "Handle kuningan cuma 6 dari 8. Dua nakas belum bisa dipasang handle-nya.",
    note: null,
  },

  /* ── Two dining sets, four boxes, all still on the road ───────────── */
  {
    id: "box_06", box_no: "kol-26-09-08_01", project_code: "25007",
    delivery_id: "dlv_02", destination: "Ruang makan utama",
    packed_by: "usr_made", packed_at: "2026-09-08T07:20:00+08:00",
    status: "IN_TRANSIT",
    scanned_by: null, scanned_at: null,
    problem_note: null, note: "Daun meja set 1. Jangan ditumpuk.",
  },
  {
    id: "box_07", box_no: "kol-26-09-08_02", project_code: "25007",
    delivery_id: "dlv_02", destination: "Ruang makan utama",
    packed_by: "usr_made", packed_at: "2026-09-08T07:25:00+08:00",
    status: "IN_TRANSIT",
    scanned_by: null, scanned_at: null,
    problem_note: null, note: "Kaki + baut set 1. Tanpa peti ini meja tidak bisa berdiri.",
  },
  {
    id: "box_08", box_no: "kol-26-09-08_03", project_code: "25007",
    delivery_id: "dlv_02", destination: "Ruang makan utama",
    packed_by: "usr_made", packed_at: "2026-09-08T07:30:00+08:00",
    status: "IN_TRANSIT",
    scanned_by: null, scanned_at: null,
    problem_note: null, note: "Daun meja set 2.",
  },
  {
    id: "box_09", box_no: "kol-26-09-08_04", project_code: "25007",
    delivery_id: "dlv_02", destination: "Ruang makan utama",
    packed_by: "usr_made", packed_at: "2026-09-08T07:35:00+08:00",
    status: "IN_TRANSIT",
    scanned_by: null, scanned_at: null,
    problem_note: null, note: "Kaki + baut set 2.",
  },

  /* ── Packed, labelled, waiting for a truck that has not been booked ─ */
  {
    id: "box_10", box_no: "kol-26-09-11_01", project_code: "25007",
    delivery_id: null, destination: "Ruang makan utama",
    packed_by: "usr_made", packed_at: "2026-09-11T15:40:00+08:00",
    status: "PACKED",
    scanned_by: null, scanned_at: null,
    problem_note: null, note: "Daun meja set 3.",
  },
  {
    id: "box_11", box_no: "kol-26-09-11_02", project_code: "25007",
    delivery_id: null, destination: "Ruang makan utama",
    packed_by: "usr_made", packed_at: "2026-09-11T15:45:00+08:00",
    status: "PACKED",
    scanned_by: null, scanned_at: null,
    problem_note: null, note: "Kaki + baut set 3.",
  },
];

export const BOX_LINES: BoxLine[] = [
  { id: "bxl_01", box_id: "box_01", project_line_id: "prl_06", description: "Nakas jati kecil", qty: 2, uom: "unit" },
  { id: "bxl_02", box_id: "box_02", project_line_id: "prl_06", description: "Nakas jati kecil", qty: 2, uom: "unit" },
  { id: "bxl_03", box_id: "box_03", project_line_id: "prl_06", description: "Nakas jati kecil", qty: 1, uom: "unit" },
  { id: "bxl_04", box_id: "box_04", project_line_id: "prl_06", description: "Nakas jati kecil", qty: 3, uom: "unit" },
  /* No project line: handles and screws are not something the client ordered
     by name, and forcing them onto `prl_06` would make the fitted count wrong. */
  { id: "bxl_05", box_id: "box_05", project_line_id: null, description: "Handle kuningan nakas", qty: 8, uom: "pcs" },
  { id: "bxl_06", box_id: "box_05", project_line_id: null, description: "Sekrup + alas kaki nakas", qty: 8, uom: "set" },

  { id: "bxl_07", box_id: "box_06", project_line_id: "prl_01", description: "Daun meja makan jati 220×100", qty: 1, uom: "pcs" },
  { id: "bxl_08", box_id: "box_07", project_line_id: "prl_01", description: "Kaki meja makan + baut", qty: 1, uom: "set" },
  { id: "bxl_09", box_id: "box_08", project_line_id: "prl_01", description: "Daun meja makan jati 220×100", qty: 1, uom: "pcs" },
  { id: "bxl_10", box_id: "box_09", project_line_id: "prl_01", description: "Kaki meja makan + baut", qty: 1, uom: "set" },

  { id: "bxl_11", box_id: "box_10", project_line_id: "prl_01", description: "Daun meja makan jati 220×100", qty: 1, uom: "pcs" },
  { id: "bxl_12", box_id: "box_11", project_line_id: "prl_01", description: "Kaki meja makan + baut", qty: 1, uom: "set" },
];
