import type {
  Transaction, TransactionLine, PaymentAllocation, TransactionTypeCode,
  Direction, TrxStatus, EvidenceInboxRow,
} from "@/services/accounting/contracts";

type TrxSeed = [
  string, string, string, Direction, number, TransactionTypeCode,
  string | null, string | null, string, TrxStatus,
];

/* trx_no, date, account, direction, amount, type, vendor, project, description, status
 *
 * Thirty rows across the five accounts and most of the thirteen types. A few
 * things are deliberate rather than decorative:
 *   - trx-26-08-29_004 is VOID: amount zeroed, reason kept, row still there.
 *   - the BANK CHARGES rows are their own ledger lines and never count as
 *     coverage for anything (A14).
 *   - the BCA 064 rows are money entering a leadership account, which never
 *     pays a vendor directly.
 *   - two rows have no PR line behind them at all, which is what
 *     `v_unlinked_transactions` is for: shown, never hidden.
 */
const TRX_SEEDS: TrxSeed[] = [
  ["trx-26-06-30_001", "2026-06-30", "acc_bca271", "IN", 12_000_000, "CASHFLOW", null, null, "Operating transfer to BCA 271, from BCA 064", "COMPLETED"],
  ["trx-26-06-30_002", "2026-06-30", "acc_bca064", "OUT", 12_000_000, "CASHFLOW", null, null, "Transfer to BCA 271 — operating funds", "COMPLETED"],
  ["trx-26-07-22_001", "2026-07-22", "acc_bca271", "IN", 22_000_000, "CASHFLOW", null, null, "Operating transfer to BCA 271, from BCA 064", "COMPLETED"],
  ["trx-26-07-22_002", "2026-07-22", "acc_bca064", "OUT", 22_000_000, "CASHFLOW", null, null, "Transfer to BCA 271 — operating funds", "COMPLETED"],
  ["trx-26-08-10_002", "2026-08-10", "acc_bca271", "IN", 15_000_000, "CASHFLOW", null, null, "Operating transfer to BCA 271, from BCA 064", "COMPLETED"],
  ["trx-26-08-10_003", "2026-08-10", "acc_bca064", "OUT", 15_000_000, "CASHFLOW", null, null, "Transfer to BCA 271 — operating funds", "COMPLETED"],
  ["trx-26-08-20_001", "2026-08-20", "acc_bca271", "IN", 29_100_000, "CASHFLOW", null, null, "Round funding pay-26-08-22_01, from BCA 064", "COMPLETED"],
  ["trx-26-08-20_002", "2026-08-20", "acc_bca064", "OUT", 29_100_000, "CASHFLOW", null, null, "Transfer to BCA 271 — weekly funding", "COMPLETED"],
  ["trx-26-08-20_003", "2026-08-20", "acc_bca271", "OUT", 4_050_000, "SUPPLIERS", "vnd_07", "prj_25007", "AMPLAS 120 GRIT, 500 lembar", "COMPLETED"],
  ["trx-26-08-20_004", "2026-08-20", "acc_bca271", "OUT", 6_500, "BANK CHARGES", null, null, "Transfer admin fee", "COMPLETED"],
  ["trx-26-08-21_001", "2026-08-21", "acc_bca271", "OUT", 5_550_000, "SUPPLIERS", "vnd_02", "prj_25007", "ENGSEL SENDOK HUBEN, 300 pcs", "POSTED"],
  ["trx-26-08-21_002", "2026-08-21", "acc_bca271", "OUT", 19_668_000, "PREPAID VENDOR", "vnd_08", "prj_25007", "30% deposit, veneer and HPL PO po-26-08-14_01", "POSTED"],
  ["trx-26-08-21_003", "2026-08-21", "acc_bca271", "OUT", 6_500, "BANK CHARGES", null, null, "Transfer admin fee", "COMPLETED"],
  ["trx-26-08-22_001", "2026-08-22", "acc_petty", "OUT", 185_000, "PRODUCTION", "vnd_03", "prj_25004", "Nails and screws — unplanned purchase", "COMPLETED"],
  ["trx-26-08-24_001", "2026-08-24", "acc_bni325", "OUT", 4_180_000, "RECCURING - UTILITIES", null, null, "Workshop electricity, August", "COMPLETED"],
  ["trx-26-08-24_002", "2026-08-24", "acc_petty", "OUT", 320_000, "PRODUCTION", null, null, "Fuel, operations vehicle", "COMPLETED"],
  ["trx-26-08-25_001", "2026-08-25", "acc_bni325", "OUT", 1_250_000, "OTHERS", "vnd_05", null, "Planer service", "COMPLETED"],
  ["trx-26-08-26_001", "2026-08-26", "acc_bca271", "OUT", 2_480_000, "PACKING" as TransactionTypeCode, "vnd_09", "prj_25007", "Bubble wrap and packing tape", "POSTED"],
  ["trx-26-08-27_001", "2026-08-27", "acc_bni325", "IN", 60_000_000, "CASHFLOW", null, null, "Top-up BNI 325 for payroll — from BCA 064", "COMPLETED"],
  ["trx-26-08-27_002", "2026-08-27", "acc_bca064", "OUT", 60_000_000, "CASHFLOW", null, null, "Transfer to BNI 325 — payroll top-up", "COMPLETED"],
  ["trx-26-08-28_001", "2026-08-28", "acc_bni325", "OUT", 28_400_000, "RECCURING - PAYROLL", null, null, "Weekly payroll W35", "COMPLETED"],
  /* The deposit, paid in cash at the counter. The balance went by transfer the
     next day (trx-26-08-29_002) — one purchase, two ledger rows, on two
     different accounts, which is what the ledger should hold and what no
     screen could show until now (D206). */
  ["trx-26-08-28_002", "2026-08-28", "acc_petty", "OUT", 2_000_000, "SUPPLIERS", "vnd_03", "prj_25004", "PLYWOOD 18MM — uang muka tunai di toko", "COMPLETED"],
  ["trx-26-08-29_001", "2026-08-29", "acc_bca271", "IN", 12_100_000, "CASHFLOW", null, null, "Round funding pay-26-08-31_01, from BCA 064", "COMPLETED"],
  ["trx-26-08-29_005", "2026-08-29", "acc_bca064", "OUT", 12_100_000, "CASHFLOW", null, null, "Transfer to BCA 271 — round funding", "COMPLETED"],
  ["trx-26-08-29_002", "2026-08-29", "acc_bca271", "OUT", 9_500_000, "SUPPLIERS", "vnd_03", "prj_25004", "PLYWOOD 18MM, 40 lembar — pelunasan setelah uang muka tunai", "POSTED"],
  ["trx-26-08-29_003", "2026-08-29", "acc_petty", "OUT", 350_000, "OTHERS", "vnd_10", "prj_25004", "Grounds mowing, workshop", "COMPLETED"],
  ["trx-26-08-29_004", "2026-08-29", "acc_bca271", "OUT", 0, "SUPPLIERS", "vnd_03", null, "PLYWOOD 18MM — entered twice", "VOID"],
  ["trx-26-08-31_001", "2026-08-31", "acc_bni325", "OUT", 890_000, "OFFICE", "vnd_03", null, "Stationery and copier paper", "COMPLETED"],
  ["trx-26-09-01_001", "2026-09-01", "acc_bca064", "IN", 185_000_000, "CASHFLOW", null, null, "Operating funds placed in BCA 064 by leadership", "COMPLETED"],
  ["trx-26-09-02_001", "2026-09-02", "acc_bca271", "OUT", 4_820_000, "SUPPLIERS", "vnd_04", "prj_25011", "Sanding sealer and wood filler", "POSTED"],
  ["trx-26-09-02_002", "2026-09-02", "acc_petty", "OUT", 275_000, "PRODUCTION", null, null, "Fuel, operations vehicle", "COMPLETED"],
  ["trx-26-09-03_001", "2026-09-03", "acc_bni325", "OUT", 1_450_000, "ONLINE", "vnd_11", null, "Compressor oil and spares — Tokopedia", "POSTED"],
  ["trx-26-09-03_002", "2026-09-03", "acc_bni325", "IN", 70_000_000, "CASHFLOW", null, null, "Top-up BNI 325 for payroll — from BCA 064", "COMPLETED"],
  ["trx-26-09-03_003", "2026-09-03", "acc_bca064", "OUT", 70_000_000, "CASHFLOW", null, null, "Transfer to BNI 325 — payroll top-up", "COMPLETED"],
  ["trx-26-09-04_001", "2026-09-04", "acc_bni325", "OUT", 29_800_000, "RECCURING - PAYROLL", null, null, "Weekly payroll W36", "COMPLETED"],
  ["trx-26-09-05_001", "2026-09-05", "acc_bca271", "OUT", 8_400_000, "CHINA", null, "prj_25009", "Imported hardware — Guangzhou supplier payment", "POSTED"],
  ["trx-26-09-05_002", "2026-09-05", "acc_bca271", "OUT", 15_000, "BANK CHARGES", null, null, "International transfer fee", "COMPLETED"],
  ["trx-26-09-07_001", "2026-09-07", "acc_petty", "OUT", 420_000, "WAREHOUSE", "vnd_03", null, "Steel racking, consumables store", "POSTED"],
  ["trx-26-09-08_001", "2026-09-08", "acc_bni325", "OUT", 2_150_000, "CREDIT CARD", null, null, "Mandiri credit card bill, August", "COMPLETED"],
  ["trx-26-09-08_002", "2026-09-08", "acc_bca271", "OUT", 3_680_000, "SUPPLIERS", "vnd_12", "prj_25009", "KAYU SUNGKAI PAPAN 2CM, 20 lembar", "POSTED"],
  ["trx-26-09-09_001", "2026-09-09", "acc_bni325", "OUT", 31_200_000, "RECCURING - PAYROLL", null, null, "Weekly payroll W37", "COMPLETED"],
  ["trx-26-09-09_002", "2026-09-09", "acc_petty", "OUT", 96_000, "OFFICE", null, null, "Refreshments, production meeting", "COMPLETED"],
  /* The two statutory invoices, paid. Kesehatan is deliberately paid at
     AUGUST's amount — still charging for Made Suparta, who came off the roll on
     31 August. That is the leak the owner described, and it is the case the
     audit screen exists to catch (D259). */
  ["trx-26-09-10_001", "2026-09-10", "acc_bni325", "OUT", 1_525_000, "RECCURING - PAYROLL", "vnd_50", null, "BPJS Kesehatan September", "COMPLETED"],
  ["trx-26-09-10_002", "2026-09-10", "acc_bni325", "OUT", 3_310_689, "RECCURING - PAYROLL", "vnd_51", null, "BPJS Ketenagakerjaan September", "COMPLETED"],
  /* HADI GLASS, five payments across three orders — including one transfer on
   * 19 August that closes three of them at once (D97). */
  ["trx-26-07-01_001", "2026-07-01", "acc_bca271", "OUT", 9_562_500, "SUPPLIERS", "vnd_13", "prj_25007", "HADI GLASS — DP 50% po-26-06-30_01", "COMPLETED"],
  ["trx-26-07-24_001", "2026-07-24", "acc_bca271", "OUT", 15_847_500, "SUPPLIERS", "vnd_13", "prj_25007", "HADI GLASS — progress 2, po-26-06-30_01", "COMPLETED"],
  ["trx-26-07-31_001", "2026-07-31", "acc_bca271", "OUT", 4_915_000, "SUPPLIERS", "vnd_13", "prj_25007", "HADI GLASS — balance, po-26-06-30_01 closed", "COMPLETED"],
  ["trx-26-08-10_001", "2026-08-10", "acc_bca271", "OUT", 12_750_000, "SUPPLIERS", "vnd_13", "prj_25007", "HADI GLASS — progress 1, po-26-07-25_01", "COMPLETED"],
  ["trx-26-08-19_002", "2026-08-19", "acc_bca271", "OUT", 13_810_000, "SUPPLIERS", "vnd_13", "prj_25007", "HADI GLASS — one transfer, three orders", "COMPLETED"],
];

export const TRANSACTIONS: Transaction[] = TRX_SEEDS.map(
  ([trx_no, trx_date, account_id, direction, amount_idr, type_code, vendor_id, project_id, description, status], i) => ({
    id: `trx_${String(i + 1).padStart(3, "0")}`,
    trx_no,
    trx_date,
    account_id,
    direction,
    amount_idr,
    type_code,
    vendor_id,
    project_id,
    description,
    remark: null,
    status,
    source_ref: `seed:${trx_no}`,
    posted_by: i % 3 === 0 ? "usr_anggun" : "usr_putri",
    posted_at: `${trx_date}T16:00:00+08:00`,
    void_reason:
      trx_no === "trx-26-08-29_004"
        ? "VOID 2026-08-29 — the same receipt was already posted as trx-26-08-29_002."
        : null,
  }),
);

export function trxIdByNo(no: string): string {
  const found = TRANSACTIONS.find((t) => t.trx_no === no);
  if (!found) throw new Error(`fixture transaction ${no} not found`);
  return found.id;
}

export const TRANSACTION_LINES: TransactionLine[] = [
  { id: "trl_01", trx_id: trxIdByNo("trx-26-08-20_003"), line_no: 1, item_id: null, description: "AMPLAS 120 GRIT", qty: 500, uom: "lembar", unit_price: 8_100, amount: 4_050_000 },
  { id: "trl_02", trx_id: trxIdByNo("trx-26-08-21_001"), line_no: 1, item_id: null, description: "ENGSEL SENDOK HUBEN", qty: 300, uom: "pcs", unit_price: 18_500, amount: 5_550_000 },
  { id: "trl_03", trx_id: trxIdByNo("trx-26-08-29_002"), line_no: 1, item_id: null, description: "PLYWOOD 18MM 122X244", qty: 40, uom: "lembar", unit_price: 287_500, amount: 11_500_000 },
  { id: "trl_04", trx_id: trxIdByNo("trx-26-08-22_001"), line_no: 1, item_id: null, description: "PAKU 5CM", qty: 4, uom: "kg", unit_price: 22_500, amount: 90_000 },
  { id: "trl_05", trx_id: trxIdByNo("trx-26-08-22_001"), line_no: 2, item_id: null, description: "SEKRUP GYPSUM 1 INCH", qty: 2, uom: "box", unit_price: 47_500, amount: 95_000 },
];

/* Coverage, not a paid flag. A line becomes PAID because money actually
 * reached it — "a stamp pointing at nothing is not paid" (A10).
 *
 * Two of these deliberately do not match what was approved, because in a real
 * month two of them never do:
 *   alc_01  Rp 225.000 MORE than approved, and nobody has said why yet.
 *   alc_04  Rp 180.000 LESS than approved, explained and closed (var_01).
 * A model that cannot hold those two rows is a model that quietly rounds one
 * of them away. */
export const PAYMENT_ALLOCATIONS: PaymentAllocation[] = [
  { id: "alc_01", trx_id: trxIdByNo("trx-26-08-20_003"), pr_line_no: "pr-26-08-18_01-L01", po_no: null, amount: 4_050_000, method: "transfer", superseded_by: null, allocated_by: "usr_putri", allocated_at: "2026-08-20T16:10:00+08:00" },
  { id: "alc_02", trx_id: trxIdByNo("trx-26-08-21_001"), pr_line_no: "pr-26-08-18_01-L02", po_no: null, amount: 5_550_000, method: "transfer", superseded_by: null, allocated_by: "usr_putri", allocated_at: "2026-08-21T16:10:00+08:00" },
  { id: "alc_03", trx_id: trxIdByNo("trx-26-08-21_002"), pr_line_no: "pr-26-08-18_01-L03", po_no: "po-26-08-14_01", amount: 19_668_000, method: "transfer", superseded_by: null, allocated_by: "usr_putri", allocated_at: "2026-08-21T16:12:00+08:00" },
  /* One request line, two payments. Neither allocation is wrong and neither
     is the whole story — together they settle the line, and a screen that
     showed only one of them would call a paid purchase half paid (D206). */
  { id: "alc_04", trx_id: trxIdByNo("trx-26-08-29_002"), pr_line_no: "pr-26-08-27_01-L01", po_no: null, amount: 9_500_000, method: "transfer", superseded_by: null, allocated_by: "usr_anggun", allocated_at: "2026-08-29T16:20:00+08:00" },
  { id: "alc_04b", trx_id: trxIdByNo("trx-26-08-28_002"), pr_line_no: "pr-26-08-27_01-L01", po_no: null, amount: 2_000_000, method: "cash", superseded_by: null, allocated_by: "usr_anggun", allocated_at: "2026-08-28T15:40:00+08:00" },
  /* Cash out of petty cash against a line nobody had approved. The allocation
   * is real, so the coverage is real, so the board shows it — which is the
   * point (A6: warn, never hide). */
  { id: "alc_06", trx_id: trxIdByNo("trx-26-08-22_001"), pr_line_no: "pr-26-08-27_01-L03", po_no: null, amount: 95_000, method: "cash", superseded_by: null, allocated_by: "usr_anggun", allocated_at: "2026-08-22T17:00:00+08:00" },
  /* The split: one transfer, three orders. Recording it as three allocations
   * against one transaction is the only way both facts survive — the bank saw
   * one payment, the vendor closed three orders (D97). */
  { id: "alc_10", trx_id: trxIdByNo("trx-26-07-01_001"), pr_line_no: null, po_no: "po-26-06-30_01", amount: 9_562_500, method: "transfer", superseded_by: null, allocated_by: "usr_putri", allocated_at: "2026-07-01T16:00:00+08:00" },
  { id: "alc_11", trx_id: trxIdByNo("trx-26-07-24_001"), pr_line_no: null, po_no: "po-26-06-30_01", amount: 15_847_500, method: "transfer", superseded_by: null, allocated_by: "usr_putri", allocated_at: "2026-07-24T16:00:00+08:00" },
  { id: "alc_12", trx_id: trxIdByNo("trx-26-07-31_001"), pr_line_no: null, po_no: "po-26-06-30_01", amount: 4_915_000, method: "transfer", superseded_by: null, allocated_by: "usr_putri", allocated_at: "2026-07-31T16:00:00+08:00" },
  { id: "alc_13", trx_id: trxIdByNo("trx-26-08-10_001"), pr_line_no: null, po_no: "po-26-07-25_01", amount: 12_750_000, method: "transfer", superseded_by: null, allocated_by: "usr_putri", allocated_at: "2026-08-10T16:00:00+08:00" },
  { id: "alc_14", trx_id: trxIdByNo("trx-26-08-19_002"), pr_line_no: null, po_no: "po-26-07-25_01", amount: 12_680_000, method: "transfer", superseded_by: null, allocated_by: "usr_putri", allocated_at: "2026-08-19T16:00:00+08:00" },
  { id: "alc_15", trx_id: trxIdByNo("trx-26-08-19_002"), pr_line_no: null, po_no: "po-26-08-19_01", amount: 850_000, method: "transfer", superseded_by: null, allocated_by: "usr_putri", allocated_at: "2026-08-19T16:01:00+08:00" },
  { id: "alc_16", trx_id: trxIdByNo("trx-26-08-19_002"), pr_line_no: null, po_no: "po-26-06-30_01", amount: 280_000, method: "transfer", superseded_by: null, allocated_by: "usr_putri", allocated_at: "2026-08-19T16:02:00+08:00" },
  { id: "alc_05", trx_id: trxIdByNo("trx-26-08-29_003"), pr_line_no: "pr-26-08-27_01-L02", po_no: null, amount: 350_000, method: "cash", superseded_by: null, allocated_by: "usr_anggun", allocated_at: "2026-08-29T16:22:00+08:00" },
];

/* The exception road, and only that: documents whose parent is genuinely
 * unknown because somebody bought first (ADR-010). Three waiting, one already
 * resolved to a note, one that produced a transaction. If this list grows,
 * people are routing around the normal road. */
export const EVIDENCE_INBOX: EvidenceInboxRow[] = [
  /* Two decisions from months back, which exist so the history has a **shape**
     rather than a length (B4, D269). A window that never has anything outside
     it proves nothing: these are what makes *3 dari 5 keputusan, 2 lagi lebih
     lama dari itu* a real sentence, and they are also the honest content of
     this list — *what did we do with that photo* is asked months later, which
     is exactly why the history is kept at all (A16). */
  {
    id: "inb_07", ref_id: "upl_26-04-17_01~x0", origin: "chat", status: "REJECTED",
    attachment_id: "att_13", reported_by: "usr_shared", reported_at: "2026-04-17T20:10:00+08:00",
    extracted: { vendor_name: null, document_date: "2026-04-17", amount_idr: null, doc_type: null, confidence: 22, note: "Foto pribadi, masuk ke grup chat yang salah. Ditolak, filenya tetap disimpan." },
    produced_trx_id: null, produced_pr_line_no: null, similar_trx_nos: [],
  },
  {
    id: "inb_08", ref_id: "upl_26-06-05_01~x0", origin: "web", status: "CONFIRMED",
    attachment_id: "att_06", reported_by: "usr_anggun", reported_at: "2026-06-05T16:30:00+08:00",
    extracted: { vendor_name: "JASA POTONG RUMPUT", document_date: "2026-06-05", amount_idr: 350_000, doc_type: "Receipt / Invoice / Nota", confidence: 78, note: "Kwitansi tulis tangan, dibayar tunai dari kas kecil." },
    produced_trx_id: null, produced_pr_line_no: null, similar_trx_nos: [],
    money_direction: "OUT",
  },
  /* Decided, and the most instructive row in the queue's history: one nota
     that ended up standing behind **two** ledger rows, because the plywood was
     paid in two goes — cash at the counter, the balance transferred the next
     day (D206). Opening it in *Already decided* is the only place in the app
     where one document, two transactions and one split-paid request line are
     all visible at once. */
  {
    id: "inb_06", ref_id: "upl_26-08-28_01~x0", origin: "web", status: "ATTACHED",
    attachment_id: "att_43", reported_by: "usr_anggun", reported_at: "2026-08-28T15:44:00+08:00",
    extracted: { vendor_name: "TOKO BANGUNAN MAKMUR SENTOSA", document_date: "2026-08-28", amount_idr: 11_500_000, doc_type: "Receipt / Invoice / Nota", confidence: 91, note: "PLYWOOD 18MM 122x244, 40 lembar. Uang muka tunai, sisanya transfer." },
    produced_trx_id: null, produced_pr_line_no: "pr-26-08-27_01-L01", similar_trx_nos: [],
    money_direction: "OUT",
  },
  /* The other direction: leadership transferred money INTO BCA 271 and
   * dropped the proof in chat. Nobody has booked it yet, so the round it was
   * meant to fund cannot be marked funded — which is the point (D80, D81). */
  {
    id: "inb_05", ref_id: "upl_26-09-10_03~x0", origin: "chat", status: "PENDING",
    attachment_id: "att_17", reported_by: "usr_geryle", reported_at: "2026-09-10T08:22:00+08:00",
    extracted: { vendor_name: null, document_date: "2026-09-10", amount_idr: 60_000_000, doc_type: "Payment Proof", confidence: 93, note: "Transfer BCA 064 → BCA 271, funding the September round." },
    produced_trx_id: null, produced_pr_line_no: null, similar_trx_nos: [],
    money_direction: "IN",
  },
  {
    id: "inb_01", ref_id: "upl_26-09-09_01~x0", origin: "chat", status: "PENDING",
    attachment_id: "att_10", reported_by: "usr_made", reported_at: "2026-09-09T17:22:00+08:00",
    extracted: { vendor_name: "TOKO BANGUNAN MAKMUR SENTOSA", document_date: "2026-09-09", amount_idr: 685_000, doc_type: "Receipt / Invoice / Nota", confidence: 88, note: "Bought first, no PR yet — urgent need." },
    produced_trx_id: null, produced_pr_line_no: null, similar_trx_nos: [],
  },
  {
    id: "inb_02", ref_id: "upl_26-09-10_01~x0", origin: "chat", status: "PENDING",
    attachment_id: "att_11", reported_by: "usr_andi", reported_at: "2026-09-10T08:05:00+08:00",
    extracted: { vendor_name: "UD SINAR ABADI", document_date: "2026-09-10", amount_idr: 1_450_000, doc_type: "Receipt / Invoice / Nota", confidence: 64, note: "Handwritten, partly illegible." },
    produced_trx_id: null, produced_pr_line_no: null,
    similar_trx_nos: ["trx-26-09-03_001"],
  },
  {
    id: "inb_03", ref_id: "upl_26-09-10_02~x0", origin: "web", status: "PENDING",
    attachment_id: "att_12", reported_by: "usr_anggun", reported_at: "2026-09-10T09:40:00+08:00",
    extracted: { vendor_name: null, document_date: "2026-09-06", amount_idr: 96_000, doc_type: "Receipt / Invoice / Nota", confidence: 41, note: "Faded receipt." },
    produced_trx_id: null, produced_pr_line_no: null, similar_trx_nos: [],
  },
  {
    id: "inb_04", ref_id: "upl_26-09-07_01~x0", origin: "chat", status: "NOTED",
    attachment_id: "att_13", reported_by: "usr_shared", reported_at: "2026-09-07T20:10:00+08:00",
    extracted: { vendor_name: null, document_date: "2026-09-07", amount_idr: 2_400_000, doc_type: "Others", confidence: 72, note: "Not a company transaction." },
    produced_trx_id: null, produced_pr_line_no: null, similar_trx_nos: [],
  },
  {
    id: "inb_05", ref_id: "upl_26-09-02_01~x0", origin: "chat", status: "CONFIRMED",
    attachment_id: "att_14", reported_by: "usr_made", reported_at: "2026-09-02T18:30:00+08:00",
    extracted: { vendor_name: "TOKO BANGUNAN MAKMUR SENTOSA", document_date: "2026-09-02", amount_idr: 420_000, doc_type: "Receipt / Invoice / Nota", confidence: 91 },
    produced_trx_id: trxIdByNo("trx-26-09-07_001"), produced_pr_line_no: null, similar_trx_nos: [],
  },
];
