/** Reading the PR recap tab (D454) — pure functions, no I/O.
 *
 *  The route (`/api/procurement/sheet-sync`) fetches the values and writes the
 *  cells; everything about *what the sheet says* is here, so it can be read and
 *  tested without Google. The database decides what becomes of each row
 *  (`ops_procure.sync_pr_sheet`).
 */

export interface SheetPrRow {
  row_no: number;
  line_id: string;
  date: string | null;          // YYYY-MM-DD
  description: string;
  keterangan: string;
  vendor: string;
  qty: number | null;
  unit: string;
  price: number | null;
  amount: number | null;
  approved: boolean;
  paid_amount: number | null;
  /** What the TRX ID cell holds now — the route only writes when it differs. */
  trx_id: string;
}

export interface ParsedTab {
  rows: SheetPrRow[];
  /** Column letters of the two cells the sync writes back. */
  lineCol: string;
  trxCol: string;
}

const MONTHS: string[][] = [
  ["JANUARY", "JANUARI"], ["FEBRUARY", "FEBRUARI"], ["MARCH", "MARET"], ["APRIL"], ["MAY", "MEI"],
  ["JUNE", "JUNI"], ["JULY", "JULI"], ["AUGUST", "AGUSTUS"], ["SEPTEMBER"], ["OCTOBER", "OKTOBER"],
  ["NOVEMBER", "NOPEMBER"], ["DECEMBER", "DESEMBER"],
];

/** The recap tab to read on a given office day: this month's only. Since D457
 *  the sheet wins — a row brings its line to what the row says — so reading an
 *  old tab would rewrite last month's lines, which the owner asked to leave
 *  alone. Matched by the month's English or Indonesian name and `PR RECAP`,
 *  whatever the spacing — the November tab has two spaces. */
export function pickTabs(titles: string[], today: Date): string[] {
  const names = MONTHS[today.getUTCMonth()];
  const hit = titles.find((t) => {
    const words = t.toUpperCase().replace(/\s+/g, " ").trim();
    return /\bPR RECAP\b/.test(words) && names.some((n) => words.startsWith(n + " "));
  });
  return hit ? [hit] : [];
}

/** `Rp1,535,430` → 1535430; `6.5` → 6.5; blank → null. The sheet formats
 *  rupiah with commas for thousands; a bare decimal point is a decimal. */
export function parseNumber(s: string | undefined): number | null {
  const t = (s ?? "").replace(/rp/i, "").replace(/\s/g, "");
  if (t === "" || t === "-") return null;
  const neg = /^\(.*\)$/.test(t) || t.startsWith("-");
  const digits = t.replace(/[()\-]/g, "").replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(digits)) return null;
  const n = Number(digits);
  return neg ? -n : n;
}

/** `11/02/2026` (the sheet's M/D/YYYY) → `2026-11-02`. A date that does not
 *  exist (`2/30/2026`) is null, not a string the database refuses mid-run. */
export function parseDate(s: string | undefined): string | null {
  const m = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/.exec(s ?? "")
    ?? (() => {
      const iso = /^\s*(\d{4})-(\d{2})-(\d{2})\s*$/.exec(s ?? "");
      return iso ? ([iso[0], iso[2], iso[3], iso[1]] as unknown as RegExpExecArray) : null;
    })();
  if (!m) return null;
  const [, mo, d, y] = m;
  const t = new Date(Date.UTC(+y, +mo - 1, +d));
  if (t.getUTCFullYear() !== +y || t.getUTCMonth() !== +mo - 1 || t.getUTCDate() !== +d) return null;
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

function letter(i: number): string {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

const norm = (s: string | undefined) => (s ?? "").toUpperCase().replace(/\s+/g, " ").trim();

/** Find the header row by its `LINE ID` cell and read every row below it.
 *  Columns are found by their header text, not their letter, so inserting a
 *  column in the sheet does not quietly shift what is read. */
export function parseTab(values: string[][]): ParsedTab | null {
  const h = values.findIndex((r) => r.some((c) => norm(c) === "LINE ID"));
  if (h < 0) return null;
  const header = values[h].map(norm);
  const col = (...names: string[]) => header.findIndex((c) => names.includes(c));
  const c = {
    date: col("DATE"), desc: col("DESCRIPTION"), ket: col("KETERANGAN"), vendor: col("VENDOR"),
    qty: col("QTY"), unit: col("UNIT"), price: col("PRICE"), amount: col("IDR AMOUNT", "SUBTOTAL"),
    approved: col("EJO APPROVAL"), paid: col("PAID AMOUNT"), line: col("LINE ID"), trx: col("TRX ID"),
  };
  if (c.desc < 0 || c.amount < 0 || c.line < 0 || c.trx < 0 || c.date < 0) return null;

  const cell = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "") : "");
  const rows: SheetPrRow[] = [];
  for (let i = h + 1; i < values.length; i++) {
    const r = values[i];
    const description = cell(r, c.desc).trim();
    if (!description) continue;
    rows.push({
      row_no: i + 1,
      line_id: cell(r, c.line).trim(),
      date: parseDate(cell(r, c.date)),
      description,
      keterangan: cell(r, c.ket).trim(),
      vendor: cell(r, c.vendor).trim(),
      qty: parseNumber(cell(r, c.qty)),
      unit: cell(r, c.unit).trim(),
      price: parseNumber(cell(r, c.price)),
      amount: parseNumber(cell(r, c.amount)),
      approved: norm(cell(r, c.approved)) === "TRUE",
      paid_amount: parseNumber(cell(r, c.paid)),
      trx_id: cell(r, c.trx).trim(),
    });
  }
  return { rows, lineCol: letter(c.line), trxCol: letter(c.trx) };
}

export interface SyncedRow {
  row_no: number;
  status: string;
  line_no_full?: string | null;
  trx_nos?: string | null;
}

/** The cells to write: a LINE ID only into an empty cell (a typed one is the
 *  office's and was resolved, or refused, as typed), and a TRX ID only when the
 *  ledger in ops already pays the line and the cell does not say so yet. */
export function writeBacks(tab: string, parsed: ParsedTab, synced: SyncedRow[]):
  { tab: string; a1: string; value: string }[] {
  const byRow = new Map(parsed.rows.map((r) => [r.row_no, r]));
  const out: { tab: string; a1: string; value: string }[] = [];
  for (const s of synced) {
    const row = byRow.get(s.row_no);
    if (!row || !s.line_no_full || s.status === "unknown_line" || s.status === "skipped") continue;
    if (!row.line_id) out.push({ tab, a1: `${parsed.lineCol}${s.row_no}`, value: s.line_no_full });
    if (s.trx_nos && s.trx_nos !== row.trx_id) out.push({ tab, a1: `${parsed.trxCol}${s.row_no}`, value: s.trx_nos });
  }
  return out;
}
