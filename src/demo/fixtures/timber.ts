import type {
  LogPurchase, LogPiece, SawnBoard, BoardMove,
} from "@/services/inventory/contracts";

/** Four loads of logs, two vendors, and the thing nobody could see before.
 *
 *  The demo is built so the answer is not the obvious one. **CV SUMBER KAYU
 *  JATI is the dearer vendor per log cubic metre and the cheaper one per
 *  usable board**, because their logs saw out at around 61% and CV KAYU MANIS
 *  SELATAN's at around 45%. On an invoice, Kayu Manis looks like the better
 *  buy — Rp 15,5 juta against Rp 18 juta per cubic metre of log. After the saw
 *  it is not: roughly Rp 35 juta against Rp 29 juta per cubic metre of wood
 *  that can actually go into a table (D153).
 *
 *  One load is deliberately still unsawn — its real price is not knowable yet,
 *  and the screens say so instead of quietly averaging it in. Another has our
 *  measurement below the seller's, which is a conversation with the vendor
 *  rather than a number to overwrite.
 */
export const LOG_PURCHASES: LogPurchase[] = [
  {
    id: "lgp_01", purchase_no: "kyu-26-07-12_01",
    vendor_id: "vnd_01", trx_no: null, pr_line_no: null,
    received_on: "2026-07-12", species: "Jati",
    total_cost: 54_700_000, claimed_m3: 3.2, measure: "round", nota_attachment_id: "att_50",
    note: "Sortimen A, kering angin. Bongkar di halaman belakang.",
    created_at: "2026-07-12T09:30:00+08:00", created_by: "usr_made",
  },
  {
    id: "lgp_02", purchase_no: "kyu-26-08-05_01",
    vendor_id: "vnd_12", trx_no: null, pr_line_no: null,
    received_on: "2026-08-05", species: "Jati",
    total_cost: 33_200_000, claimed_m3: 2.3, measure: "round", nota_attachment_id: "att_51",
    note: "Harga per m³ lebih murah dari Sumber Kayu — makanya dicoba.",
    created_at: "2026-08-05T14:10:00+08:00", created_by: "usr_made",
  },
  {
    id: "lgp_03", purchase_no: "kyu-26-08-26_01",
    vendor_id: "vnd_01", trx_no: null, pr_line_no: null,
    received_on: "2026-08-26", species: "Jati",
    total_cost: 34_600_000, claimed_m3: 1.87, measure: "round", nota_attachment_id: "att_52",
    note: null,
    created_at: "2026-08-26T10:05:00+08:00", created_by: "usr_made",
  },
  {
    id: "lgp_04", purchase_no: "kyu-26-09-08_01",
    vendor_id: "vnd_12", trx_no: null, pr_line_no: null,
    received_on: "2026-09-08", species: "Mahoni",
    total_cost: 6_600_000, claimed_m3: 0.95, measure: "round", nota_attachment_id: null,
    note: "Belum digergaji — masih menunggu jadwal sawmill.",
    created_at: "2026-09-08T16:40:00+08:00", created_by: "usr_made",
  },
];

let ln = 0;
const log = (
  purchase_id: string, tag: string, diameter_cm: number, length_cm: number,
  sawn_on: string | null, note: string | null = null,
): LogPiece => {
  ln += 1;
  return { id: `lgc_${String(ln).padStart(3, "0")}`, purchase_id, tag, diameter_cm, length_cm, sawn_on, note };
};

export const LOG_PIECES: LogPiece[] = [
  /* lgp_01 — Sumber Kayu, July. Eight logs, all sawn. */
  log("lgp_01", "A-01", 42, 300, "2026-07-18"),
  log("lgp_01", "A-02", 38, 280, "2026-07-18"),
  log("lgp_01", "A-03", 45, 320, "2026-07-19"),
  log("lgp_01", "A-04", 36, 300, "2026-07-19"),
  log("lgp_01", "A-05", 40, 260, "2026-07-20"),
  log("lgp_01", "A-06", 48, 300, "2026-07-20"),
  log("lgp_01", "A-07", 35, 250, "2026-07-21"),
  log("lgp_01", "A-08", 41, 290, "2026-07-21"),

  /* lgp_02 — Kayu Manis, August. Cheaper per m³, and the pith was bad on two
     of them, which is where the yield went. */
  log("lgp_02", "B-01", 39, 300, "2026-08-12"),
  log("lgp_02", "B-02", 44, 280, "2026-08-12", "Gubal tebal, banyak terbuang."),
  log("lgp_02", "B-03", 37, 260, "2026-08-13"),
  log("lgp_02", "B-04", 41, 300, "2026-08-13", "Hati pecah memanjang."),
  log("lgp_02", "B-05", 35, 240, "2026-08-14"),
  log("lgp_02", "B-06", 43, 310, "2026-08-14"),

  /* lgp_03 — Sumber Kayu, late August. Partly sawn. */
  log("lgp_03", "C-01", 46, 300, "2026-09-02"),
  log("lgp_03", "C-02", 40, 280, "2026-09-02"),
  log("lgp_03", "C-03", 38, 300, "2026-09-03"),
  log("lgp_03", "C-04", 44, 260, null),
  log("lgp_03", "C-05", 36, 280, null),

  /* lgp_04 — mahoni, nothing sawn yet. */
  log("lgp_04", "D-01", 33, 300, null),
  log("lgp_04", "D-02", 31, 280, null),
  log("lgp_04", "D-03", 35, 300, null),
  log("lgp_04", "D-04", 30, 260, null),
];

let bn = 0;
const board = (
  purchase_id: string, log_id: string | null,
  thickness_mm: number, width_mm: number, length_mm: number,
  qty: number, sawn_on: string, grade: string | null = "A", note: string | null = null,
): SawnBoard => {
  bn += 1;
  return {
    id: `swb_${String(bn).padStart(3, "0")}`, purchase_id, log_id,
    thickness_mm, width_mm, length_mm, qty, sawn_on, grade, note,
  };
};

export const SAWN_BOARDS: SawnBoard[] = [
  /* lgp_01 — about 60% out of 3,48 m³ of log. */
  board("lgp_01", "lgc_001", 30, 250, 3000, 8, "2026-07-18"),
  board("lgp_01", "lgc_001", 30, 200, 3000, 6, "2026-07-18"),
  board("lgp_01", "lgc_002", 30, 220, 2800, 9, "2026-07-18"),
  board("lgp_01", "lgc_003", 40, 250, 3200, 7, "2026-07-19"),
  board("lgp_01", "lgc_003", 30, 200, 3200, 8, "2026-07-19"),
  board("lgp_01", "lgc_004", 30, 200, 3000, 10, "2026-07-19"),
  board("lgp_01", "lgc_005", 30, 220, 2600, 9, "2026-07-20"),
  board("lgp_01", "lgc_006", 40, 260, 3000, 10, "2026-07-20"),
  board("lgp_01", "lgc_006", 30, 180, 3000, 6, "2026-07-20", "B", "Tepi, ada mata kayu."),
  board("lgp_01", "lgc_007", 30, 190, 2500, 8, "2026-07-21"),
  board("lgp_01", "lgc_008", 30, 230, 2900, 9, "2026-07-21"),

  /* lgp_02 — the cheap logs. Same sawyer, far less board out of them. */
  board("lgp_02", "lgc_009", 30, 200, 3000, 8, "2026-08-12"),
  board("lgp_02", "lgc_010", 30, 180, 2800, 7, "2026-08-12", "B", "Gubal dibuang banyak."),
  board("lgp_02", "lgc_011", 30, 190, 2600, 8, "2026-08-13"),
  board("lgp_02", "lgc_012", 30, 170, 3000, 7, "2026-08-13", "B", "Sisi hati pecah, dipotong pendek."),
  board("lgp_02", "lgc_013", 30, 180, 2400, 8, "2026-08-14"),
  board("lgp_02", "lgc_014", 30, 210, 3100, 9, "2026-08-14"),
  board("lgp_02", "lgc_014", 40, 220, 3000, 5, "2026-08-14"),
  board("lgp_02", "lgc_013", 30, 160, 2500, 6, "2026-08-14", "B", "Papan tepi."),

  /* lgp_03 — three of five logs done. */
  board("lgp_03", "lgc_015", 40, 260, 3000, 9, "2026-09-02"),
  board("lgp_03", "lgc_015", 30, 200, 3000, 6, "2026-09-02"),
  board("lgp_03", "lgc_016", 30, 220, 2800, 9, "2026-09-02"),
  board("lgp_03", "lgc_017", 30, 210, 3000, 9, "2026-09-03"),
];

/** What happened to the boards after the saw (D203).
 *
 *  Three things this has to show, and the demo is built so each is visible
 *  without anybody clicking:
 *
 *  - **wood going to a job**, against an SPK, from a load somebody kept track
 *    of — so the issue has a cost;
 *  - **wood going to a job from a mixed pile**, where the load is genuinely
 *    unknown. Its quantity is exact and its cost is blank, which is the honest
 *    pair and the one a costing report has to be able to show (D204);
 *  - **an opname that found four boards more than the system had**, with the
 *    reason on the row — because the alternative, letting an issue take the
 *    rack negative, is how a count stops being usable at all.
 */
export const BOARD_MOVES: BoardMove[] = [
  {
    id: "bmv_01", move_no: "ppn-26-08-18_01", at: "2026-08-18T09:10:00+08:00",
    board_key: "Jati|30x200x3000", species: "Jati",
    thickness_mm: 30, width_mm: 200, length_mm: 3000,
    qty: -14, kind: "issue",
    purchase_id: "lgp_01", ref_no: "spk-26-08-17_01",
    reason: null, by: "usr_made",
  },
  {
    id: "bmv_02", move_no: "ppn-26-08-26_01", at: "2026-08-26T14:40:00+08:00",
    board_key: "Jati|30x220x2800", species: "Jati",
    thickness_mm: 30, width_mm: 220, length_mm: 2800,
    qty: -6, kind: "issue",
    /* This size came off two different loads and the stack was topped up
       without anybody writing down from which. Quantity exact, cost blank. */
    purchase_id: null, ref_no: "spk-26-08-24_02",
    reason: null, by: "usr_made",
  },
  {
    id: "bmv_03", move_no: "ppn-26-08-29_01", at: "2026-08-29T16:05:00+08:00",
    board_key: "Jati|30x200x3000", species: "Jati",
    thickness_mm: 30, width_mm: 200, length_mm: 3000,
    qty: 3, kind: "return",
    purchase_id: "lgp_01", ref_no: "spk-26-08-17_01",
    reason: "Sisa potong, masih utuh.", by: "usr_made",
  },
  {
    id: "bmv_04", move_no: "ppn-26-09-01_01", at: "2026-09-01T08:20:00+08:00",
    board_key: "Jati|30x180x3000", species: "Jati",
    thickness_mm: 30, width_mm: 180, length_mm: 3000,
    qty: -2, kind: "scrap",
    purchase_id: "lgp_01", ref_no: null,
    reason: "Melengkung setelah seminggu di rak terbuka.", by: "usr_made",
  },
  {
    id: "bmv_05", move_no: "ppn-26-09-05_01", at: "2026-09-05T10:00:00+08:00",
    board_key: "Jati|30x190x2500", species: "Jati",
    thickness_mm: 30, width_mm: 190, length_mm: 2500,
    qty: 4, kind: "adjust",
    /* Nobody knows which load these came off, so they are counted and left out
       of the value — four boards that are real and unpriced (D204). */
    purchase_id: null, ref_no: null,
    reason: "Opname 5 September: fisik 12, tercatat 8. Sisa gergajian Juli yang tidak pernah dilaporkan.",
    by: "usr_made",
  },
];
