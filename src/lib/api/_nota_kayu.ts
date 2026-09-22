/** Reading a nota — and deciding first whether it is a timber one.
 *
 *  A verbatim duplicate of `src/demo/nota-kayu.ts`, not an import from it.
 *  Every other function in this module reads or writes `ops_inv`; this one
 *  touches no table at all — it is text in, `NotaScan` out, the same
 *  function whichever client calls it. ADR-009 keeps the real and demo
 *  clients independent all the same (this file's sibling `inventory.ts`
 *  says why, in `accounting.ts`'s words, at its own top), so it is restated
 *  here rather than imported. If the parsing rules ever change, they change
 *  in both places — the same discipline `_pending.ts` exists to catch for
 *  everything that is *not* this simple.
 */
import type { NotaScan, NotaTimberLine } from "@/services/inventory/contracts";

const SPECIES = [
  ["jati", "Jati"], ["mahoni", "Mahoni"], ["mahogany", "Mahoni"],
  ["sungkai", "Sungkai"], ["meranti", "Meranti"], ["bengkirai", "Bengkirai"],
  ["kamper", "Kamper"], ["albasia", "Albasia"], ["sengon", "Sengon"],
  ["trembesi", "Trembesi"], ["suar", "Trembesi"],
] as const;

const SIZE = /(\d+(?:[.,]\d+)?)\s*[x×\/]\s*(\d+(?:[.,]\d+)?)\s*[x×\/]\s*(\d+(?:[.,]\d+)?)/i;
const LOG_SIZE = /(?:ø|diam(?:eter)?\.?)\s*(\d+(?:[.,]\d+)?)\s*(?:cm)?\s*[x×\/,]?\s*(?:p(?:anjang)?\.?)?\s*(\d+(?:[.,]\d+)?)/i;
const QTY = /(?:^|\s)(\d+)\s*(?:pcs|btg|batang|lbr|lembar|keping|bh|buah)\b/i;
const DATE = /\b\d{1,2}\s*[\/-]\s*\d{1,2}\s*[\/-]\s*\d{2,4}\b/;

const PLAUSIBLE = {
  thickness: [5, 150],
  width: [30, 1500],
  length: [300, 6500],
} as const;

function plausible(t: number, w: number, l: number): boolean {
  return t >= PLAUSIBLE.thickness[0] && t <= PLAUSIBLE.thickness[1]
    && w >= PLAUSIBLE.width[0] && w <= PLAUSIBLE.width[1]
    && l >= PLAUSIBLE.length[0] && l <= PLAUSIBLE.length[1];
}

const num = (t: string) => Number(t.replace(/\./g, "").replace(",", "."));

function toMm(value: number, unitHint: "cm" | "mm" | null, thickness: number): number {
  const unit = unitHint ?? (thickness < 15 ? "cm" : "mm");
  return unit === "cm" ? value * 10 : value;
}

function speciesIn(text: string): string | null {
  const low = text.toLowerCase();
  for (const [needle, label] of SPECIES) if (low.includes(needle)) return label;
  return null;
}

function readLine(raw: string, fallbackSpecies: string | null): NotaTimberLine | null {
  const unitHint: "cm" | "mm" | null =
    /\bmm\b/i.test(raw) ? "mm" : /\bcm\b/i.test(raw) ? "cm" : null;
  const species = speciesIn(raw) ?? fallbackSpecies;
  const qty = QTY.exec(raw);
  const amount = /(?:rp|idr)\s*([\d.,]+)/i.exec(raw);

  const size = DATE.test(raw) ? null : SIZE.exec(raw);
  if (size) {
    const t0 = num(size[1]);
    const t = toMm(t0, unitHint, t0);
    const w = toMm(num(size[2]), unitHint, t0);
    const l = toMm(num(size[3]), unitHint, t0);
    if (plausible(t, w, l)) {
      return {
        raw, kind: "board", species,
        thickness_mm: t, width_mm: w, length_mm: l,
        diameter_cm: null, length_cm: null,
        qty: qty ? Number(qty[1]) : 1,
        amount: amount ? Math.round(num(amount[1])) : null,
      };
    }
  }

  const log = LOG_SIZE.exec(raw);
  if (log) {
    return {
      raw, kind: "log", species,
      thickness_mm: null, width_mm: null, length_mm: null,
      diameter_cm: num(log[1]), length_cm: num(log[2]),
      qty: qty ? Number(qty[1]) : 1,
      amount: amount ? Math.round(num(amount[1])) : null,
    };
  }
  return null;
}

function totalIn(lines: string[]): number | null {
  for (const l of [...lines].reverse()) {
    if (!/\b(total|jumlah|grand\s*total)\b/i.test(l)) continue;
    const m = /([\d.]{4,})(?:,\d+)?\s*$/.exec(l.trim());
    if (m) return Math.round(num(m[1]));
  }
  return null;
}

export function scanNota(text: string): NotaScan {
  const rows = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const fallbackSpecies = speciesIn(text);

  const parsed = rows.map((r) => ({ raw: r, line: readLine(r, fallbackSpecies) }));
  const lines = parsed.map((p) => p.line).filter((l): l is NotaTimberLine => l !== null);
  const boards = lines.filter((l) => l.kind === "board");
  const logs = lines.filter((l) => l.kind === "log");

  const signals: string[] = [];
  const against: string[] = [];

  if (boards.length >= 3) signals.push(`${boards.length} baris berbentuk ukuran papan`);
  else if (boards.length > 0) against.push(`hanya ${boards.length} baris berbentuk ukuran — belum cukup untuk disebut nota kayu`);
  else against.push("tidak ada baris berbentuk ukuran papan");

  if (logs.length > 0) {
    signals.push(`${logs.length} baris berbentuk ukuran log (diameter × panjang)`);
    const i = against.indexOf("tidak ada baris berbentuk ukuran papan");
    if (i >= 0) against.splice(i, 1);
  }
  if (fallbackSpecies) signals.push(`menyebut ${fallbackSpecies}`);
  else against.push("tidak menyebut jenis kayu");

  const is_timber = boards.length + logs.length >= 3 && fallbackSpecies !== null;

  const unread = parsed
    .filter((p) => p.line === null)
    .map((p) => p.raw)
    .filter((r) => !/\b(total|jumlah|nota|tanggal|kepada|hormat|ttd|no\.?|tgl)\b/i.test(r) && /\d/.test(r));

  return {
    is_timber, signals, against,
    species_guess: fallbackSpecies,
    total_guess: totalIn(rows),
    lines, unread,
  };
}
