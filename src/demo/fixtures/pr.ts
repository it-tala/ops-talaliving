import type {
  PrDocument, PrLine, PrApproval, PaymentRound, PaymentRoundLine, Receipt,
  PurchaseOrder, PoLine, PoScheduleTerm, PrCategory, UomCode,
  LineVariance, LineSettlement, LineNote, ApprovalRequest, ApprovalBatch, RoundTransfer,
} from "@/services/procurement/contracts";
import { itemIdByCode } from "./reference";

/* Six documents, chosen so that every one of the eight statuses in the ladder
 * is reachable on the deployed demo without anybody having to create data
 * first. Read them in order and the whole chain is visible:
 *
 *   pr-26-09-10_02  DRAFT                -> DRAFT
 *   pr-26-09-10_01  submitted, untouched -> WAITING FOR APPROVAL
 *   pr-26-09-08_01  partly decided       -> APPROVED · WAITING FOR APPROVAL · REMOVED
 *   pr-26-09-04_01  in an approved round -> still APPROVED: a funded round
 *                   reserves nothing for a particular line (D126)
 *   pr-26-08-27_01  paid                 -> PAID · COMPLETED (a service line)
 *   pr-26-08-18_01  paid and received    -> COMPLETED · PARTIAL · PAID (a PO DP)
 */

export const PR_DOCUMENTS: PrDocument[] = [
  { id: "doc_06", doc_no: "pr-26-09-10_02", doc_type: "PR", status: "DRAFT", requested_by: "usr_andi", project_id: "prj_25004", created_at: "2026-09-10T02:15:00+08:00", submitted_at: null },
  { id: "doc_05", doc_no: "pr-26-09-10_01", doc_type: "PR", status: "SUBMITTED", requested_by: "usr_andi", project_id: "prj_25007", created_at: "2026-09-10T01:05:00+08:00", submitted_at: "2026-09-10T01:40:00+08:00" },
  { id: "doc_04", doc_no: "pr-26-09-08_01", doc_type: "PR", status: "SUBMITTED", requested_by: "usr_made", project_id: "prj_25009", created_at: "2026-09-08T09:20:00+08:00", submitted_at: "2026-09-08T10:02:00+08:00" },
  { id: "doc_03", doc_no: "pr-26-09-04_01", doc_type: "PR", status: "SUBMITTED", requested_by: "usr_andi", project_id: "prj_25011", created_at: "2026-09-04T08:30:00+08:00", submitted_at: "2026-09-04T09:00:00+08:00" },
  { id: "doc_02", doc_no: "pr-26-08-27_01", doc_type: "PR", status: "SUBMITTED", requested_by: "usr_andi", project_id: "prj_25004", created_at: "2026-08-27T08:10:00+08:00", submitted_at: "2026-08-27T08:45:00+08:00" },
  { id: "doc_01", doc_no: "pr-26-08-18_01", doc_type: "PR", status: "CLOSED", requested_by: "usr_made", project_id: "prj_25007", created_at: "2026-08-18T08:00:00+08:00", submitted_at: "2026-08-18T08:35:00+08:00" },
];

type LineSeed = [
  string, string, number, string | null, string, number | null, UomCode | null,
  number | null, string | null, PrCategory | null, string | null, string | null,
];

/* doc_id, id, line_no, item_code, description, qty, uom, unit_price, vendor,
   category, need_by, purpose */
const LINE_SEEDS: LineSeed[] = [
  ["doc_06", "prl_0601", 1, "ITM-0014", "AMPLAS 240 GRIT", 200, "lembar", 8_000, "vnd_07", "SANDING", "2026-09-18", "Weekly sanding stock, workshop floor"],
  ["doc_06", "prl_0602", 2, "ITM-0022", "LEM PUTIH FOX 5 KG", 6, "pack", 230_000, "vnd_03", "FINISHING", "2026-09-18", "Laminating panels — BABY ISLAND wardrobes"],

  ["doc_05", "prl_0501", 1, "ITM-0033", "BUBBLE WRAP 125CM", 4, "roll", 428_000, "vnd_09", "PACKING", "2026-09-20", "Wrapping finished units before shipping"],
  ["doc_05", "prl_0502", 2, "ITM-0032", "KARDUS DOUBLE WALL 60X40X40", 150, "pcs", 28_500, "vnd_09", "PACKING", "2026-09-20", "Export cartons for the BABY ISLAND batch"],
  ["doc_05", "prl_0503", 3, "ITM-0034", "STRETCH FILM 500MM", 10, "roll", 96_000, "vnd_09", "PACKING", "2026-09-20", "Pallet wrapping, same shipment"],

  ["doc_04", "prl_0401", 1, "ITM-0001", "KAYU JATI SORTIMEN A", 1.2, "m3", 18_900_000, "vnd_01", "RAW MATERIAL", "2026-09-22", "Main frames — VILLA SEMINYAK dining set"],
  ["doc_04", "prl_0402", 2, "ITM-0006", "PAPAN JATI KERING 3CM", 30, "lembar", 640_000, "vnd_01", "RAW MATERIAL", "2026-09-22", "Table tops, VILLA SEMINYAK. Kiln-dried only"],
  ["doc_04", "prl_0403", 3, "ITM-0030", "PISAU PLANER 300MM", 2, "set", 435_000, "vnd_05", "MACHINING", "2026-09-30", "Replacement blades — the current set is chipped"],
  ["doc_04", "prl_0404", 4, "ITM-0029", "MATA BOR SET HSS", 1, "set", 285_000, "vnd_05", "MACHINING", null, "Spare drill set for the second bench"],

  ["doc_03", "prl_0301", 1, "ITM-0017", "CAT DUCO PUTIH", 60, "ltr", 168_000, "vnd_04", "FINISHING", "2026-09-16", "Carcass finishing, HOTEL UBUD stage 1"],
  ["doc_03", "prl_0302", 2, "ITM-0018", "THINNER ND SUPER", 100, "ltr", 33_500, "vnd_04", "FINISHING", "2026-09-16", "Thinner for the same finishing run"],

  ["doc_02", "prl_0201", 1, "ITM-0007", "PLYWOOD 18MM 122X244", 40, "lembar", 292_000, "vnd_03", "RAW MATERIAL", "2026-09-02", "Drawer bottoms and backing panels, STANDARD"],
  ["doc_02", "prl_0202", 2, "ITM-0039", "JASA POTONG RUMPUT HALAMAN", null, null, null, "vnd_10", "OTHER", null, "Monthly grounds maintenance at the workshop"],

  /* Bought first, approved never. The state a leadership meeting most needs to
   * see, and the whole reason it gets its own corner rather than being folded
   * into "in progress". Without an example in the fixtures the board would
   * teach that this cannot happen — and it is exactly what does. */
  ["doc_02", "prl_0203", 3, "ITM-0027", "SEKRUP GYPSUM 1 INCH", 2, "box", 47_500, "vnd_03", "OTHER", null, "Bench repair — bought the same afternoon, no PR raised first"],

  ["doc_01", "prl_0101", 1, "ITM-0013", "AMPLAS 120 GRIT", 500, "lembar", 7_650, "vnd_07", "SANDING", "2026-08-25", "Sanding stock for the BABY ISLAND batch"],
  ["doc_01", "prl_0102", 2, "ITM-0024", "ENGSEL SENDOK HUBEN", 300, "pcs", 18_500, "vnd_02", "MACHINING", "2026-08-25", "Wardrobe doors — 300 hinges, BABY ISLAND"],
  ["doc_01", "prl_0103", 3, null, "30% deposit, veneer and HPL PO — po-26-08-14_01", null, null, null, "vnd_08", "RAW MATERIAL", null, "Deposit so INDO VENEER starts cutting"],
];

const DOC_NO: Record<string, string> = Object.fromEntries(
  PR_DOCUMENTS.map((d) => [d.id, d.doc_no]),
);

/** Fixed totals where a line has no qty × price (a service, a PO deposit). */
const FIXED_TOTAL: Record<string, number> = {
  prl_0202: 350_000,
  prl_0103: 19_668_000,
};

export const PR_LINES: PrLine[] = LINE_SEEDS.map(
  ([doc_id, id, line_no, item_code, description, qty, uom, unit_price, vendor_id, category, need_by, purpose]) => ({
    id,
    doc_id,
    line_no,
    line_no_full: `${DOC_NO[doc_id]}-L${String(line_no).padStart(2, "0")}`,
    source_wo_no: null,
    item_id: item_code ? itemIdByCode(item_code) : null,
    description,
    qty,
    uom,
    unit_price,
    item_total: FIXED_TOTAL[id] ?? Math.round((qty ?? 0) * (unit_price ?? 0)),
    vendor_id,
    /* A line that funds a PO deposit carries the PO on its allocation, not a
     * po_line_id: the deposit funds the obligation, not one row of it. It
     * reaches PAID and stops — delivery is the PO's two axes to carry, and
     * collapsing that back into the PR line is exactly what A1 forbids. */
    po_line_id: null,
    category,
    need_by,
    purpose,
    /* Removed because it is no longer needed — no deadline, nothing ages out.
     * Soft, and it can never be paid (D29). */
    removed_at: id === "prl_0404" ? "2026-09-09T11:20:00+08:00" : null,
    removed_by: id === "prl_0404" ? "usr_made" : null,
  }),
);

/* A checkbox, not a vocabulary (D28). Every toggle is a row, so the trail
 * carries the nuance the old three-value column used to carry badly. Note
 * prl_0402: approved at a lower amount than requested — money can only shrink
 * on its way through approval (A8). */
export const PR_APPROVALS: PrApproval[] = [
  { id: "apr_01", line_id: "prl_0401", step: "GOODS", approved: true, approved_qty: 1.2, approved_amount: 22_680_000, recorded_by: "usr_evin", recorded_by_email: "evin@talaliving.com", recorded_at: "2026-09-09T10:14:00+08:00", channel: "web" },
  { id: "apr_02", line_id: "prl_0402", step: "GOODS", approved: true, approved_qty: 20, approved_amount: 12_800_000, recorded_by: "usr_evin", recorded_by_email: "evin@talaliving.com", recorded_at: "2026-09-09T10:16:00+08:00", channel: "web" },
  { id: "apr_03", line_id: "prl_0301", step: "GOODS", approved: true, approved_qty: 60, approved_amount: 10_080_000, recorded_by: "usr_evin", recorded_by_email: "evin@talaliving.com", recorded_at: "2026-09-05T09:02:00+08:00", channel: "web" },
  { id: "apr_04", line_id: "prl_0302", step: "GOODS", approved: true, approved_qty: 100, approved_amount: 3_350_000, recorded_by: "usr_evin", recorded_by_email: "evin@talaliving.com", recorded_at: "2026-09-05T09:02:00+08:00", channel: "web" },
  { id: "apr_05", line_id: "prl_0201", step: "GOODS", approved: true, approved_qty: 40, approved_amount: 11_680_000, recorded_by: "usr_evin", recorded_by_email: "evin@talaliving.com", recorded_at: "2026-08-28T08:40:00+08:00", channel: "chat" },
  { id: "apr_06", line_id: "prl_0202", step: "GOODS", approved: true, approved_qty: null, approved_amount: 350_000, recorded_by: "usr_evin", recorded_by_email: "evin@talaliving.com", recorded_at: "2026-08-28T08:41:00+08:00", channel: "chat" },
  { id: "apr_07", line_id: "prl_0101", step: "GOODS", approved: true, approved_qty: 500, approved_amount: 3_825_000, recorded_by: "usr_evin", recorded_by_email: "evin@talaliving.com", recorded_at: "2026-08-19T09:10:00+08:00", channel: "web" },
  { id: "apr_08", line_id: "prl_0102", step: "GOODS", approved: true, approved_qty: 300, approved_amount: 5_550_000, recorded_by: "usr_evin", recorded_by_email: "evin@talaliving.com", recorded_at: "2026-08-19T09:11:00+08:00", channel: "web" },
  { id: "apr_09", line_id: "prl_0103", step: "GOODS", approved: true, approved_qty: null, approved_amount: 19_668_000, recorded_by: "usr_evin", recorded_by_email: "evin@talaliving.com", recorded_at: "2026-08-19T09:12:00+08:00", channel: "web" },
  /* A line the CEO ticked and then un-ticked. The old model could not express
   * this at all; the trail carries it plainly. */
  { id: "apr_10", line_id: "prl_0403", step: "GOODS", approved: true, approved_qty: 2, approved_amount: 870_000, recorded_by: "usr_evin", recorded_by_email: "evin@talaliving.com", recorded_at: "2026-09-09T10:18:00+08:00", channel: "web" },
  { id: "apr_11", line_id: "prl_0403", step: "GOODS", approved: false, approved_qty: null, approved_amount: null, recorded_by: "usr_evin", recorded_by_email: "evin@talaliving.com", recorded_at: "2026-09-09T14:07:00+08:00", channel: "web" },
];

/* The plywood came in Rp 180.000 under the approved figure and Anggun said so
 * on the day. The explanation is what closes the line: without it the line
 * would sit at "Rp 180.000 still owed" forever, and a shortfall must close by
 * a named reason rather than by a tolerance nobody set (A12).
 *
 * Nothing explains the sandpaper overpayment on purpose — that line is what
 * the board is for. */
export const LINE_VARIANCES: LineVariance[] = [
  {
    id: "var_01", line_id: "prl_0201", reason: "price_changed",
    note: "Vendor dropped to Rp 287.500/lembar for the 40-sheet order.",
    amount_at_time: -180_000,
    recorded_by: "usr_anggun", recorded_by_email: "anggun@talaliving.com",
    recorded_at: "2026-08-29T16:35:00+08:00",
  },
];

export const LINE_SETTLEMENTS: LineSettlement[] = [
  {
    id: "stl_01", line_id: "prl_0201", shortfall: 180_000,
    reason: "Vendor price differed from the quote — Vendor dropped to Rp 287.500/lembar for the 40-sheet order.",
    decided_by: "usr_anggun", decided_at: "2026-08-29T16:35:00+08:00",
  },
];

/* Leadership writing on a line before deciding it — which is the case that
 * matters. "Negotiate first" on an undecided line is an instruction; the same
 * sentence after approval is a complaint. */
export const LINE_NOTES: LineNote[] = [
  {
    id: "nte_01", line_id: "prl_0501",
    instructions: "Ask CV Bali Packing for a price on the 6-roll box before ordering.",
    remark: null,
    recorded_by: "usr_evin", recorded_by_email: "evin@talaliving.com",
    recorded_at: "2026-09-10T07:20:00+08:00",
  },
  {
    id: "nte_02", line_id: "prl_0301",
    instructions: null,
    remark: "Cut to 60 litres — the HOTEL UBUD stage 1 carcasses only need that much.",
    recorded_by: "usr_evin", recorded_by_email: "evin@talaliving.com",
    recorded_at: "2026-09-05T09:03:00+08:00",
  },
];

/* One card already sitting in the CEO's chat, sent from the meeting laptop
 * this morning. The whole point of the row: `sent_by` is Putri, and whatever
 * comes back will be recorded as Evin's decision, because Evin is who answers
 * it (D69). */
export const APPROVAL_BATCHES: ApprovalBatch[] = [
  {
    id: "abt_01", batch_no: "ask-26-09-10_01", token: "tok_seed01_a7f3d2",
    sent_to: "usr_evin", sent_to_email: "evin@talaliving.com",
    sent_by: "usr_putri", sent_by_email: "putri@talaliving.com",
    sent_at: "2026-09-10T09:05:00+08:00", channel: "chat",
  },
];

export const APPROVAL_REQUESTS: ApprovalRequest[] = [
  {
    id: "arq_01", batch_id: "abt_01", line_id: "prl_0503", token: "tok_seed01_a7f3d2~1",
    sent_to: "usr_evin", sent_to_email: "evin@talaliving.com",
    sent_by: "usr_putri", sent_by_email: "putri@talaliving.com",
    sent_at: "2026-09-10T09:05:00+08:00",
    channel: "chat", meeting_note: "Only if they can deliver before the 20th — otherwise hold it.",
    answered_at: null, outcome: null,
  },
  {
    id: "arq_02", batch_id: "abt_01", line_id: "prl_0502", token: "tok_seed01_a7f3d2~2",
    sent_to: "usr_evin", sent_to_email: "evin@talaliving.com",
    sent_by: "usr_putri", sent_by_email: "putri@talaliving.com",
    sent_at: "2026-09-10T09:05:00+08:00",
    /* Nothing was said about this one. Most items in a real meeting are like
       that, and a column that is full on every row is a column people stop
       reading. */
    channel: "chat", meeting_note: null,
    answered_at: null, outcome: null,
  },
];

export const PAYMENT_ROUNDS: PaymentRound[] = [
  { id: "rnd_04", round_no: "pay-26-09-09_01", status: "OPEN", opened_at: "2026-09-09T07:00:00+08:00", approved_by: null, approved_at: null, closed_by: null, closed_at: null },
  { id: "rnd_03", round_no: "pay-26-09-07_01", status: "APPROVED", opened_at: "2026-09-02T07:00:00+08:00", approved_by: "usr_geryle", approved_at: "2026-09-07T14:30:00+08:00", closed_by: null, closed_at: null },
  { id: "rnd_02", round_no: "pay-26-08-31_01", status: "CLOSED", opened_at: "2026-08-26T07:00:00+08:00", approved_by: "usr_geryle", approved_at: "2026-08-28T15:00:00+08:00", closed_by: "usr_geryle", closed_at: "2026-09-01T09:20:00+08:00" },
  { id: "rnd_01", round_no: "pay-26-08-22_01", status: "CLOSED", opened_at: "2026-08-18T07:00:00+08:00", approved_by: "usr_geryle", approved_at: "2026-08-19T16:10:00+08:00", closed_by: "usr_geryle", closed_at: "2026-08-24T10:00:00+08:00" },
];

/* pay-26-08-22_01 was funded in two goes — a first transfer on the Thursday
 * and the rest once a client paid on the Friday. That is the ordinary case,
 * not the exception, which is why the record is a list (D82). */
export const ROUND_TRANSFERS: RoundTransfer[] = [
  {
    id: "rtf_01", round_id: "rnd_01", amount: 20_000_000, trx_no: "trx-26-08-20_001",
    proof_attachment_id: "att_15",
    recorded_by: "usr_putri", recorded_by_email: "putri@talaliving.com",
    recorded_at: "2026-08-20T09:25:00+08:00",
  },
  {
    id: "rtf_02", round_id: "rnd_01", amount: 9_100_000, trx_no: "trx-26-08-20_001",
    proof_attachment_id: "att_15",
    recorded_by: "usr_putri", recorded_by_email: "putri@talaliving.com",
    recorded_at: "2026-08-21T10:05:00+08:00",
  },
  {
    id: "rtf_03", round_id: "rnd_02", amount: 12_100_000, trx_no: "trx-26-08-29_001",
    proof_attachment_id: "att_16",
    recorded_by: "usr_putri", recorded_by_email: "putri@talaliving.com",
    recorded_at: "2026-08-29T08:55:00+08:00",
  },
];

export const PAYMENT_ROUND_LINES: PaymentRoundLine[] = [
  { id: "rl_01", round_id: "rnd_04", line_id: "prl_0401", requested_amount: 22_680_000 },
  { id: "rl_02", round_id: "rnd_04", line_id: "prl_0402", requested_amount: 12_800_000 },
  { id: "rl_03", round_id: "rnd_03", line_id: "prl_0301", requested_amount: 10_080_000 },
  { id: "rl_04", round_id: "rnd_03", line_id: "prl_0302", requested_amount: 3_350_000 },
  { id: "rl_05", round_id: "rnd_02", line_id: "prl_0201", requested_amount: 11_680_000 },
  { id: "rl_06", round_id: "rnd_02", line_id: "prl_0202", requested_amount: 350_000 },
  { id: "rl_07", round_id: "rnd_01", line_id: "prl_0101", requested_amount: 3_825_000 },
  { id: "rl_08", round_id: "rnd_01", line_id: "prl_0102", requested_amount: 5_550_000 },
  { id: "rl_09", round_id: "rnd_01", line_id: "prl_0103", requested_amount: 19_668_000 },
];

/* Cumulative and append-only. 180 of 300 hinges arrived, so the line stays
 * open at PARTIAL — nothing quietly closes it (A18). */
export const RECEIPTS: Receipt[] = [
  /* Arrived at 23:40, reported by whoever was on the gate with a photograph.
     The tanda terima follows from procurement in the morning, so it counts for
     nothing yet — and is visible everywhere until it does (D131). */
  { id: "rcp_19", receipt_no: "rcv-26-09-10_01", status: "REPORTED", confirmed_by: null, confirmed_at: null, line_id: null, po_line_id: "pol_0102", qty_received: 80, condition: "WAITING FOR CONFIRMATION", received_by: "usr_made", received_at: "2026-09-10T23:40:00+08:00", qc_by: null, note: "Truk datang malam. Foto ada, tanda terima menyusul besok pagi." },
  { id: "rcp_18", receipt_no: "rcv-26-09-09_02", status: "CONFIRMED", confirmed_by: "usr_made", confirmed_at: "2026-09-09T15:00:00+08:00", line_id: null, po_line_id: "pol_0601", qty_received: 1, condition: "GOOD", received_by: "usr_made", received_at: "2026-09-09T14:20:00+08:00", qc_by: "usr_andi", note: "Compressor arrived; the deposit still has not gone out." },
  { id: "rcp_01", receipt_no: "rcv-26-08-25_01", status: "CONFIRMED", confirmed_by: "usr_made", confirmed_at: "2026-08-25T13:30:00+08:00", line_id: "prl_0101", po_line_id: null, qty_received: 500, condition: "GOOD", received_by: "usr_made", received_at: "2026-08-25T13:30:00+08:00", qc_by: "usr_made", note: null },
  { id: "rcp_02", receipt_no: "rcv-26-08-26_01", status: "CONFIRMED", confirmed_by: "usr_made", confirmed_at: "2026-08-26T10:05:00+08:00", line_id: "prl_0102", po_line_id: null, qty_received: 180, condition: "GOOD", received_by: "usr_made", received_at: "2026-08-26T10:05:00+08:00", qc_by: "usr_made", note: "Remaining 120 pcs to follow; vendor out of stock." },
  /* 47 of 45 arrived: two sheets more than ordered. Counted as what arrived,
   * flagged as OVER, and left as a vendor credit rather than quietly folded
   * into another order (D98). */
  { id: "rcp_10", receipt_no: "rcv-26-07-08_01", status: "CONFIRMED", confirmed_by: "usr_made", confirmed_at: "2026-07-08T10:15:00+08:00", line_id: null, po_line_id: "pol_0301", qty_received: 47, condition: "GOOD", received_by: "usr_made", received_at: "2026-07-08T10:15:00+08:00", qc_by: "usr_andi", note: "47 lembar arrived against 45 ordered." },
  { id: "rcp_11", receipt_no: "rcv-26-07-08_02", status: "CONFIRMED", confirmed_by: "usr_made", confirmed_at: "2026-07-08T10:30:00+08:00", line_id: null, po_line_id: "pol_0302", qty_received: 41, condition: "GOOD", received_by: "usr_made", received_at: "2026-07-08T10:30:00+08:00", qc_by: "usr_made", note: null },
  { id: "rcp_12", receipt_no: "rcv-26-08-02_01", status: "CONFIRMED", confirmed_by: "usr_made", confirmed_at: "2026-08-02T09:00:00+08:00", line_id: null, po_line_id: "pol_0401", qty_received: 20, condition: "GOOD", received_by: "usr_made", received_at: "2026-08-02T09:00:00+08:00", qc_by: "usr_andi", note: "Shipment 1 of 4." },
  { id: "rcp_13", receipt_no: "rcv-26-08-06_01", status: "CONFIRMED", confirmed_by: "usr_made", confirmed_at: "2026-08-06T09:00:00+08:00", line_id: null, po_line_id: "pol_0401", qty_received: 12, condition: "GOOD", received_by: "usr_made", received_at: "2026-08-06T09:00:00+08:00", qc_by: "usr_made", note: "Shipment 2 of 4." },
  { id: "rcp_14", receipt_no: "rcv-26-08-11_01", status: "CONFIRMED", confirmed_by: "usr_made", confirmed_at: "2026-08-11T09:00:00+08:00", line_id: null, po_line_id: "pol_0401", qty_received: 8, condition: "GOOD", received_by: "usr_made", received_at: "2026-08-11T09:00:00+08:00", qc_by: "usr_made", note: "Shipment 3 of 4." },
  { id: "rcp_15", receipt_no: "rcv-26-08-14_01", status: "CONFIRMED", confirmed_by: "usr_made", confirmed_at: "2026-08-14T09:00:00+08:00", line_id: null, po_line_id: "pol_0401", qty_received: 6, condition: "GOOD", received_by: "usr_made", received_at: "2026-08-14T09:00:00+08:00", qc_by: "usr_made", note: "Shipment 4 of 4." },
  { id: "rcp_16", receipt_no: "rcv-26-08-05_01", status: "CONFIRMED", confirmed_by: "usr_made", confirmed_at: "2026-08-05T09:00:00+08:00", line_id: null, po_line_id: "pol_0402", qty_received: 11, condition: "GOOD", received_by: "usr_made", received_at: "2026-08-05T09:00:00+08:00", qc_by: "usr_made", note: "Shipment 1 of 2." },
  { id: "rcp_17", receipt_no: "rcv-26-08-12_01", status: "CONFIRMED", confirmed_by: "usr_made", confirmed_at: "2026-08-12T09:00:00+08:00", line_id: null, po_line_id: "pol_0402", qty_received: 10, condition: "GOOD", received_by: "usr_made", received_at: "2026-08-12T09:00:00+08:00", qc_by: "usr_made", note: "Shipment 2 of 2." },
  { id: "rcp_03", receipt_no: "rcv-26-09-02_01", status: "CONFIRMED", confirmed_by: "usr_made", confirmed_at: "2026-09-02T09:40:00+08:00", line_id: null, po_line_id: "pol_0101", qty_received: 120, condition: "GOOD", received_by: "usr_made", received_at: "2026-09-02T09:40:00+08:00", qc_by: "usr_andi", note: "Counted against the surat jalan, sheet by sheet." },
  { id: "rcp_04", receipt_no: "rcv-26-09-06_01", status: "CONFIRMED", confirmed_by: "usr_made", confirmed_at: "2026-09-06T11:15:00+08:00", line_id: null, po_line_id: "pol_0102", qty_received: 150, condition: "GOOD", received_by: "usr_made", received_at: "2026-09-06T11:15:00+08:00", qc_by: "usr_andi", note: "First delivery of 400 lembar." },
];

/* Two POs: one still DRAFT because no approved PR line points at it yet, and
 * one ISSUED whose two axes disagree on purpose — money and goods are never
 * collapsed into one bar (A1). */
export const PURCHASE_ORDERS: PurchaseOrder[] = [
  { id: "po_06", po_no: "po-26-09-02_01", vendor_id: "vnd_05", status: "ISSUED", created_at: "2026-09-02T08:00:00+08:00", issued_at: "2026-09-02T09:00:00+08:00", issued_by: "usr_evin", note: "Workshop compressor overhaul — 50% up front, the rest on delivery. The deposit was never sent." , expected_delivery: "2026-09-09", approval_asked_at: "2026-09-02T09:00:00+08:00", approval_asked_by: "usr_putri", approval_sent_to: null, approval_token: null, self_confirmed: false, approved_at: "2026-09-02T09:00:00+08:00", approved_by: "usr_evin", approval_note: null , revision: 0, sent_revision: 0 },
    /* Asked, and nobody has answered. Rp 111 juta of teak sitting on the second
     road (D267): Putri wrote the order, the question went to Evin's own
     account, and until he answers it from there the order cannot be sent. It
     is the live item the chat card exists to show. */
  { id: "po_02", po_no: "po-26-09-09_01", vendor_id: "vnd_01", status: "DRAFT", created_at: "2026-09-09T15:00:00+08:00", issued_at: null, issued_by: null, note: "Q4 teak contract — waiting on the deposit PR." , expected_delivery: "2026-10-15", approval_asked_at: "2026-09-10T08:30:00+08:00", approval_asked_by: "usr_putri", approval_sent_to: "evin@talaliving.com", approval_token: "potok_seed_02", self_confirmed: false, approved_at: null, approved_by: null, approval_note: null , revision: 0, sent_revision: 0 },
  { id: "po_05", po_no: "po-26-08-19_01", vendor_id: "vnd_13", status: "ISSUED", created_at: "2026-08-19T09:00:00+08:00", issued_at: "2026-08-19T10:20:00+08:00", issued_by: "usr_evin", note: "Paid off the vendor's 19 August payment before the goods themselves showed up." , expected_delivery: null, approval_asked_at: "2026-08-19T10:20:00+08:00", approval_asked_by: "usr_putri", approval_sent_to: null, approval_token: null, self_confirmed: false, approved_at: "2026-08-19T10:20:00+08:00", approved_by: "usr_evin", approval_note: null , revision: 0, sent_revision: 0 },
  { id: "po_04", po_no: "po-26-07-25_01", vendor_id: "vnd_13", status: "ISSUED", created_at: "2026-07-25T09:00:00+08:00", issued_at: "2026-07-25T11:00:00+08:00", issued_by: "usr_evin", note: "No separate deposit — billed as two progress payments." , expected_delivery: null, approval_asked_at: "2026-07-25T11:00:00+08:00", approval_asked_by: "usr_putri", approval_sent_to: null, approval_token: null, self_confirmed: false, approved_at: "2026-07-25T11:00:00+08:00", approved_by: "usr_evin", approval_note: null , revision: 0, sent_revision: 0 },
  { id: "po_03", po_no: "po-26-06-30_01", vendor_id: "vnd_13", status: "ISSUED", created_at: "2026-06-30T08:30:00+08:00", issued_at: "2026-07-01T09:00:00+08:00", issued_by: "usr_evin", note: "50% deposit on issue. The two extra AA-04B sheets are a small vendor credit, not applied to any order here." , expected_delivery: null, approval_asked_at: "2026-07-01T09:00:00+08:00", approval_asked_by: "usr_putri", approval_sent_to: null, approval_token: null, self_confirmed: false, approved_at: "2026-07-01T09:00:00+08:00", approved_by: "usr_evin", approval_note: null , revision: 0, sent_revision: 0 },
  { id: "po_01", po_no: "po-26-08-14_01", vendor_id: "vnd_08", status: "ISSUED", created_at: "2026-08-14T10:00:00+08:00", issued_at: "2026-08-19T09:12:00+08:00", issued_by: "usr_evin", note: "HPL and veneer for BABY ISLAND, 30/70 terms." , expected_delivery: "2026-09-08", approval_asked_at: "2026-08-19T09:12:00+08:00", approval_asked_by: "usr_putri", approval_sent_to: null, approval_token: null, self_confirmed: false, approved_at: "2026-08-19T09:12:00+08:00", approved_by: "usr_evin", approval_note: null , revision: 0, sent_revision: 0 },
];

/* HADI GLASS: three orders across two months, the shape the purchase journey
 * exists to show (D97). po_03 carries a 50% deposit and an over-delivery of
 * two sheets; po_05's shipment has not arrived at all. */
export const PO_LINES: PoLine[] = [
  { id: "pol_0601", po_id: "po_06", line_no: 1, item_id: null, description: "OVERHAUL KOMPRESOR 10HP + SPAREPART", qty: 1, uom: "unit", unit_price: 14_500_000, line_total: 14_500_000, superseded_by: null },
  { id: "pol_0101", po_id: "po_01", line_no: 1, item_id: itemIdByCode("ITM-0010"), description: "HPL TACO TH 133 GLOSSY", qty: 120, uom: "lembar", unit_price: 248_000, line_total: 29_760_000, superseded_by: null },
  { id: "pol_0102", po_id: "po_01", line_no: 2, item_id: itemIdByCode("ITM-0011"), description: "VENEER JATI 0.6MM", qty: 400, uom: "lembar", unit_price: 89_500, line_total: 35_800_000, superseded_by: null },
  { id: "pol_0301", po_id: "po_03", line_no: 1, item_id: null, description: "AA-04B — 1780×860×5mm sandblast, persegi panjang", qty: 45, uom: "lembar", unit_price: 425_000, line_total: 19_125_000, superseded_by: null },
  { id: "pol_0302", po_id: "po_03", line_no: 2, item_id: null, description: "AA-04A — 1000×860×5mm sandblast", qty: 41, uom: "lembar", unit_price: 280_000, line_total: 11_480_000, superseded_by: null },
  { id: "pol_0401", po_id: "po_04", line_no: 1, item_id: null, description: "AA-04B — 1780×860×5mm sandblast, persegi panjang", qty: 46, uom: "lembar", unit_price: 425_000, line_total: 19_550_000, superseded_by: null },
  { id: "pol_0402", po_id: "po_04", line_no: 2, item_id: null, description: "AA-04A — 1000×860×5mm sandblast", qty: 21, uom: "lembar", unit_price: 280_000, line_total: 5_880_000, superseded_by: null },
  { id: "pol_0501", po_id: "po_05", line_no: 1, item_id: null, description: "AA-04B — 1780×860×5mm sandblast, persegi panjang", qty: 2, uom: "lembar", unit_price: 425_000, line_total: 850_000, superseded_by: null },
  { id: "pol_0201", po_id: "po_02", line_no: 1, item_id: itemIdByCode("ITM-0001"), description: "KAYU JATI SORTIMEN A", qty: 6, uom: "m3", unit_price: 18_500_000, line_total: 111_000_000, superseded_by: null },
];

export const PO_SCHEDULE: PoScheduleTerm[] = [
  { id: "pos_01", po_id: "po_01", term_no: "po-26-08-14_01-M01", kind: "DP", basis: "percent", basis_value: 30, due_rule: "on_issue", due_date: null },
  { id: "pos_02", po_id: "po_01", term_no: "po-26-08-14_01-M02", kind: "FINAL", basis: "percent", basis_value: 70, due_rule: "on_delivery", due_date: null },
  { id: "pos_05", po_id: "po_03", term_no: "po-26-06-30_01-M01", kind: "DP", basis: "percent", basis_value: 50, due_rule: "on_issue", due_date: null },
  { id: "pos_06", po_id: "po_03", term_no: "po-26-06-30_01-M02", kind: "FINAL", basis: "percent", basis_value: 50, due_rule: "on_delivery", due_date: null },
  { id: "pos_07", po_id: "po_04", term_no: "po-26-07-25_01-M01", kind: "PROGRESS", basis: "percent", basis_value: 100, due_rule: "on_delivery", due_date: null },
  { id: "pos_08", po_id: "po_05", term_no: "po-26-08-19_01-M01", kind: "FINAL", basis: "percent", basis_value: 100, due_rule: "on_delivery", due_date: null },
  /* The state the guard exists for: goods have arrived, the progress payment's
     trigger has fired — and the deposit was never paid, so it is BLOCKED and
     names the term holding it up (D128). */
  { id: "pos_09", po_id: "po_06", term_no: "po-26-09-02_01-M01", kind: "DP", basis: "percent", basis_value: 50, due_rule: "on_issue", due_date: null },
  { id: "pos_10", po_id: "po_06", term_no: "po-26-09-02_01-M02", kind: "PROGRESS", basis: "percent", basis_value: 50, due_rule: "on_delivery", due_date: null },
  { id: "pos_03", po_id: "po_02", term_no: "po-26-09-09_01-M01", kind: "DP", basis: "percent", basis_value: 30, due_rule: "on_issue", due_date: null },
  { id: "pos_04", po_id: "po_02", term_no: "po-26-09-09_01-M02", kind: "FINAL", basis: "percent", basis_value: 70, due_rule: "date", due_date: "2026-11-30" },
];
