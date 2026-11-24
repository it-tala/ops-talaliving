/** The ops ledger laid out as the `GL OPS 2026` tab (D455).
 *
 *  Pure: rows from `ops_acct.ledger_sheet_rows()` in, the cells out. The route
 *  (`/api/accounting/ledger-sheet`) writes them with USER_ENTERED, so:
 *
 *  * text goes in with a leading `'` — a description that starts with `=`,
 *    `+` or `-` stays text, never a formula;
 *  * dates go in as the sheet's day number, formatted by column B;
 *  * links go in bare, so the sheet makes them clickable like the manual tab.
 *
 *  Columns A–I and the link columns follow `GENERAL LEDGER PLUS 064 2026`. The
 *  balances are grouped J–O (the owner, 2026-11-25: no SCRAP SALES, no JAGO).
 *  Each row carries every account's latest balance down, as the manual tab's
 *  SUMIFS do — computed here from the database's own running balance, never
 *  re-added in the sheet. */

export interface LedgerSheetDoc { kind: string; href: string }

export interface LedgerSheetRow {
  trx_no: string;
  line: string | null;
  trx_date: string;
  description: string | null;
  remark: string | null;
  type: string | null;
  project: string | null;
  account: string;
  currency: string;
  direction: "IN" | "OUT";
  amount: number | string;
  balance: number | string | null;
  vendor: string | null;
  docs: LedgerSheetDoc[];
  pr_line_nos: string[];
  po_nos: string[];
  status: string;
  category: string | null;
  posted_by: string | null;
}

export const HEADERS = [
  "NO", "DATE", "DESCRIPTION", "REMARK", "TYPE OF TRANSACTION", "PRN PROJECT", "ACCOUNT", "IN / OUT", "IDR AMOUNT",
  "PC CASH BALANCE", "BNI BALANCE", "271 BCA BALANCE", "064 BALANCE", "JENIUS BALANCE", "JENIUS CARDS BALANCE",
  "PRN SUPPLIER", "INVOICE/NOTA LINK", "FAKTUR", "PROOF PAYMENT", "ITEM PHOTO", "PURCHASE REQUISITION", "PAYMENT REQUEST",
  "MISC LINK 1", "REMARK", "MISC LINK 2", "REMARK", "MISC LINK 3", "REMARK",
  "STATUS", "CATEGORY", "POSTED BY",
] as const;

export const COLUMN_COUNT = HEADERS.length; // 31 → A..AE
export const LAST_COLUMN = "AE";

/** Account → its balance column (index into a row). */
export const BALANCE_COLUMNS: Record<string, number> = {
  "PETTY CASH": 9,
  "BNI 325": 10,
  "BCA 271": 11,
  "BCA 064": 12,
  "JENIUS": 13,
  "JENIUS CARDS": 14,
};

const SLOT: Record<string, number> = {
  nota: 16, invoice: 16,
  faktur_pajak: 17,
  transfer_proof: 18,
  goods_photo: 19,
};
const MISC = [22, 24, 26];

const KIND_LABEL: Record<string, string> = {
  nota: "NOTA", invoice: "INVOICE", faktur_pajak: "FAKTUR", transfer_proof: "PROOF PAYMENT",
  goods_photo: "ITEM PHOTO", quotation: "QUOTATION", receiving_report: "RECEIVING REPORT",
  rekening_koran: "REKENING KORAN", other: "LAINNYA",
};

type Cell = string | number;

const text = (s: string | null | undefined): Cell => (s == null || s === "" ? "" : `'${s}`);

/** `2026-11-25` → the sheet's day number (days since 1899-12-30). */
export function sheetDay(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86_400_000);
}

const num = (v: number | string | null | undefined): number | null => {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

function placeDocs(row: Cell[], docs: LedgerSheetDoc[]) {
  const misc: LedgerSheetDoc[] = [];
  for (const d of docs) {
    const slot = SLOT[d.kind];
    if (slot !== undefined && row[slot] === "") row[slot] = d.href;
    else misc.push(d);
  }
  misc.slice(0, MISC.length).forEach((d, i) => {
    row[MISC[i]] = d.href;
    row[MISC[i] + 1] = text(KIND_LABEL[d.kind] ?? d.kind.toUpperCase());
  });
  if (misc.length > MISC.length) {
    const last = MISC[MISC.length - 1] + 1;
    row[last] = text(`${KIND_LABEL[misc[MISC.length - 1].kind] ?? ""} (+${misc.length - MISC.length} lagi di ops)`.trim());
  }
}

export interface LedgerGrid {
  /** Row 2 (headers) onward. */
  values: Cell[][];
  /** Each balance column's last value, for row 1. */
  lastBalances: (number | null)[];
}

export function buildGrid(rows: LedgerSheetRow[]): LedgerGrid {
  const carry: (number | null)[] = Object.keys(BALANCE_COLUMNS).map(() => null);
  const firstBalance = Math.min(...Object.values(BALANCE_COLUMNS));
  const out: Cell[][] = [[...HEADERS]];

  for (const r of rows) {
    const row: Cell[] = new Array(COLUMN_COUNT).fill("");
    const foreign = r.currency !== "IDR";
    const amount = num(r.amount);

    row[0] = text(r.line ? `${r.trx_no}${r.line}` : r.trx_no);
    row[1] = sheetDay(r.trx_date);
    row[2] = text(r.description);
    // A foreign-currency account's amount is in its own currency (0285); it
    // never goes into the rupiah column, so the column's SUM stays rupiah.
    row[3] = foreign && amount !== null
      ? text([`${r.currency} ${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, r.remark]
          .filter(Boolean).join(" · "))
      : text(r.remark);
    row[4] = text(r.type);
    row[5] = text(r.project);
    row[6] = text(r.account);
    row[7] = r.direction;
    row[8] = foreign || amount === null ? "" : amount;

    const col = BALANCE_COLUMNS[r.account];
    const bal = num(r.balance);
    if (col !== undefined && bal !== null) carry[col - firstBalance] = bal;
    carry.forEach((v, i) => { row[firstBalance + i] = v ?? ""; });

    row[15] = text(r.vendor);
    placeDocs(row, r.docs ?? []);
    row[20] = text((r.pr_line_nos ?? []).join(", "));
    row[21] = text((r.po_nos ?? []).join(", "));
    row[28] = text(r.status);
    row[29] = text(r.category);
    row[30] = text(r.posted_by);
    out.push(row);
  }
  return { values: out, lastBalances: carry };
}

/** Row 1: when it was written, and the totals the manual tab's row 1 shows. */
export function summaryRow(grid: LedgerGrid, rowCount: number, syncedAtWib: string): Cell[] {
  const row: Cell[] = new Array(COLUMN_COUNT).fill("");
  row[0] = text(`Disalin dari ops · ${syncedAtWib} WIB · ${rowCount} baris · jangan diedit, ditulis ulang setiap sinkron`);
  row[7] = text("SUBTOTAL");
  row[8] = `=SUBTOTAL(109,I3:I${rowCount + 2})`;
  grid.lastBalances.forEach((v, i) => { row[9 + i] = v ?? ""; });
  return row;
}
