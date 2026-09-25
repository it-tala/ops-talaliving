/** Reading the biometric machine's own export — CSV/TSV as text, or the
 *  device's native `.xlsx`/`.xls`. Both end up at the same row shape so the
 *  upload screen doesn't care which one it got.
 *
 *  The device's own export is Excel, not CSV (`BIOMETRIK_TESTER.xlsx`,
 *  `Department | Name | No. | Date/Time | Location ID | ID Number |
 *  VerifyCode | CardNo`), so a CSV-only reader rejects every real file HRD
 *  is handed — the upload fails with "nothing to read" because the browser
 *  decodes the xlsx's binary bytes as UTF-8 text before this ever sees a row.
 *
 *  Excel serial dates are converted by hand, not via SheetJS's `cellDates`:
 *  that option builds the JS `Date` in the machine running the browser's own
 *  timezone, so a 07:42:40 tap in Bali would read as a different hour on a
 *  laptop set to WIB or UTC. The same fix already proven against a real
 *  machine export in the john-lau HRD build (`apps/ops/lib/absensi/berkas.ts`).
 */
import { parseCsv } from "@/lib/csv";

export type ParsedRow = {
  employee_ref: string;
  name: string;
  at: string;
  verify: string;
  location: string | null;
};

const HEADER_PATTERNS = {
  name: [/^name$/i, /^nama$/i],
  no: [/^no\.?$/i, /^user\s*id$/i, /^emp\s*no/i, /^pin$/i],
  at: [/^date\s*\/?\s*time$/i, /^datetime$/i, /^waktu$/i],
  verify: [/^verify\s*code$/i, /^verifikasi$/i, /^mode$/i],
  location: [/^location\s*id$/i, /^lokasi$/i, /^device/i],
} as const;

type Col = keyof typeof HEADER_PATTERNS;

function cell(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

/** Column titles aren't assumed to sit on the first row — a reference sheet
 *  can carry a title or a blank row above them — so the first 30 rows are
 *  searched for one that has both a time and the machine number, the only
 *  two columns a tap cannot exist without. */
function findHeader(matrix: unknown[][]): { row: number; cols: Map<Col, number> } | null {
  const limit = Math.min(matrix.length, 30);
  for (let i = 0; i < limit; i++) {
    const line = (matrix[i] ?? []).map(cell);
    const cols = new Map<Col, number>();
    for (const [name, patterns] of Object.entries(HEADER_PATTERNS) as [Col, readonly RegExp[]][]) {
      const idx = line.findIndex((s) => s && patterns.some((p) => p.test(s)));
      if (idx >= 0) cols.set(name, idx);
    }
    if (cols.has("at") && cols.has("no")) return { row: i, cols };
  }
  return null;
}

/** Excel's day-1899-12-30 serial number, rounded to the whole second — Excel
 *  stores a time of day as a fraction of a day that is never exactly round,
 *  and rounding to the millisecond instead leaves a stamp one second off
 *  from what the machine printed. */
function fromExcelSerial(n: number): string | null {
  if (!Number.isFinite(n) || n < 1 || n > 100000) return null;
  const seconds = Math.round((n - 25569) * 86400);
  const d = new Date(seconds * 1000);
  const p = (x: number) => String(x).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T` +
    `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}+08:00`
  );
}

/** `DD/MM/YYYY H:MM:SS` or `YYYY-MM-DD HH:MM:SS` → an ISO stamp in WITA, the
 *  same two shapes the machine's CSV export already used. */
function fromTextStamp(raw: string): string | null {
  const s = raw.trim();
  const p = (v: string) => v.padStart(2, "0");

  let m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) {
    const [, d, mo, y, h, mi, se] = m;
    return `${y}-${p(mo)}-${p(d)}T${p(h)}:${p(mi)}:${p(se ?? "00")}+08:00`;
  }

  m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) {
    const [, y, mo, d, h, mi, se] = m;
    return `${y}-${p(mo)}-${p(d)}T${p(h)}:${p(mi)}:${p(se ?? "00")}+08:00`;
  }

  return null;
}

function stampOf(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return fromExcelSerial(v);
  return fromTextStamp(String(v));
}

/** "9", "9.0", 9 and " 9 " are the same person — the fingerprint number is
 *  the only thing that ties a tap to somebody, and Excel hands it back as a
 *  float. Numbers that aren't purely numeric (a lettered code) are left
 *  untouched rather than mangled. */
function normalizeNo(v: unknown): string {
  const s = cell(v);
  if (!s) return "";
  const n = Number(s);
  if (Number.isFinite(n) && /^-?\d+(\.0+)?$/.test(s)) return String(Math.trunc(n));
  return s;
}

function rowsFromMatrix(matrix: unknown[][]): { rows: ParsedRow[]; skipped: number } {
  const header = findHeader(matrix);
  if (!header) return { rows: [], skipped: 0 };

  const get = (line: unknown[], col: Col): unknown => {
    const i = header.cols.get(col);
    return i === undefined ? "" : line[i];
  };

  const rows: ParsedRow[] = [];
  let skipped = 0;
  for (let i = header.row + 1; i < matrix.length; i++) {
    const line = matrix[i] ?? [];
    if (line.every((c) => cell(c) === "")) continue;

    const ref = normalizeNo(get(line, "no"));
    const at = stampOf(get(line, "at"));
    if (!ref || !at) {
      skipped += 1;
      continue;
    }

    rows.push({
      employee_ref: ref,
      name: cell(get(line, "name")),
      at,
      verify: cell(get(line, "verify")).toUpperCase() || "—",
      location: cell(get(line, "location")) || null,
    });
  }
  return { rows, skipped };
}

/** Reads the file as-is: `.xlsx`/`.xlsm`/`.xlsb`/`.xls` through SheetJS,
 *  everything else as CSV/TSV text. The first sheet that actually yields a
 *  tap wins — guessing "the first sheet" would read a summary tab that
 *  carries formulas instead of the machine's raw rows. */
export async function readBiometricFile(file: File): Promise<{ rows: ParsedRow[]; skipped: number }> {
  const isExcel = /\.(xlsx|xlsm|xlsb|xls)$/i.test(file.name);
  if (!isExcel) {
    const text = await file.text();
    return rowsFromMatrix(parseCsv(text));
  }

  const XLSX = await import("xlsx");
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(new Uint8Array(buf), { type: "array", cellDates: false, raw: true });

  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    if (!sheet) continue;
    const matrix = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      raw: true,
      defval: "",
      blankrows: false,
    }) as unknown[][];
    const result = rowsFromMatrix(matrix);
    if (result.rows.length > 0) return result;
  }
  return { rows: [], skipped: 0 };
}
