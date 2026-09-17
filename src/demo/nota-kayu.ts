/** Reading a nota — and deciding first whether it is a timber one.
 *
 *  The order matters and it is the whole point (D200). Every other nota in
 *  this business is read line by line into the thing that was bought: one row,
 *  one item, one amount. A nota kayu looks identical to a parser and is not
 *  the same document at all — its thirty rows are **sizes out of one load**,
 *  and reading them the ordinary way puts thirty purchases in the ledger for
 *  one delivery of wood.
 *
 *  So this module answers one question before any other: *does this paper list
 *  board sizes?* It answers with the evidence, not a score, because the person
 *  confirming it has to be able to disagree with a reason.
 */
import type { NotaScan, NotaTimberLine } from "@/services/inventory/contracts";

/** The woods this workshop buys, plus the spellings that turn up on notas. */
const SPECIES = [
  ["jati", "Jati"], ["mahoni", "Mahoni"], ["mahogany", "Mahoni"],
  ["sungkai", "Sungkai"], ["meranti", "Meranti"], ["bengkirai", "Bengkirai"],
  ["kamper", "Kamper"], ["albasia", "Albasia"], ["sengon", "Sengon"],
  ["trembesi", "Trembesi"], ["suar", "Trembesi"],
] as const;

/** `3 x 20 x 200`, `3/20/200`, `3x20x200cm`, `30 x 200 x 2000 mm`. Three
 *  numbers separated by x or / is the shape of a board, and it is the single
 *  strongest signal on the page — far stronger than the word *kayu*, which
 *  appears on a nota for a hammer. */
const SIZE = /(\d+(?:[.,]\d+)?)\s*[x×\/]\s*(\d+(?:[.,]\d+)?)\s*[x×\/]\s*(\d+(?:[.,]\d+)?)/i;

/** `Ø32 x 250`, `diameter 32 panjang 250` — a log is two numbers, not three. */
const LOG_SIZE = /(?:ø|diam(?:eter)?\.?)\s*(\d+(?:[.,]\d+)?)\s*(?:cm)?\s*[x×\/,]?\s*(?:p(?:anjang)?\.?)?\s*(\d+(?:[.,]\d+)?)/i;

const QTY = /(?:^|\s)(\d+)\s*(?:pcs|btg|batang|lbr|lembar|keping|bh|buah)\b/i;

/** `12/09/2026`, `12-09-26`. Three numbers separated by slashes is also the
 *  shape of a date, and a nota header carries one — which is how `Nota 2209 -
 *  12/09/2026` first read as a board 20 metres long, and *raised the very
 *  count the timber decision rests on* (F58). */
const DATE = /\b\d{1,2}\s*[\/-]\s*\d{1,2}\s*[\/-]\s*\d{2,4}\b/;

/** What a board can actually be, in millimetres. Wood outside these is not
 *  wood — it is a date, an invoice number, or a misread unit, and the row goes
 *  to `unread` where somebody looks at it rather than into the yard. */
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

/** Millimetres, from a number written in whatever unit the nota used.
 *
 *  Notas in this trade write board sizes in centimetres (`3 x 20 x 200`) and
 *  occasionally in millimetres (`30 x 200 x 2000`). Guessing wrong is a factor
 *  of ten on every cubic metre, so the rule is explicit rather than clever:
 *  a thickness under 15 is centimetres, at or above is millimetres. No board
 *  this workshop cuts is 15 cm thick, and none is 15 mm and called `15`.
 */
function toMm(value: number, unitHint: "cm" | "mm" | null, thickness: number): number {
  const unit = unitHint ?? (thickness < 15 ? "cm" : "mm");
  return unit === "cm" ? value * 10 : value;
}

function speciesIn(text: string): string | null {
  const low = text.toLowerCase();
  for (const [needle, label] of SPECIES) if (low.includes(needle)) return label;
  return null;
}

/** Read one line, or say it could not be read. Never a silent skip. */
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

/** The total the nota prints for itself, when it prints one. */
function totalIn(lines: string[]): number | null {
  for (const l of [...lines].reverse()) {
    if (!/\b(total|jumlah|grand\s*total)\b/i.test(l)) continue;
    const m = /([\d.]{4,})(?:,\d+)?\s*$/.exec(l.trim());
    if (m) return Math.round(num(m[1]));
  }
  return null;
}

/** Does this paper list timber, and what is on it.
 *
 *  Two signals carry the decision and both are counted rather than weighed:
 *  how many lines are board-shaped, and whether a wood is named. A nota needs
 *  **three or more size lines** to be treated as timber — one or two sizes is
 *  a hardware nota mentioning a plank, and routing that into the yard would be
 *  the same mistake in the other direction.
 */
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
    /* A nota of whole logs has no board rows and that is not evidence against
       it — saying so would make the reader argue with itself. */
    const i = against.indexOf("tidak ada baris berbentuk ukuran papan");
    if (i >= 0) against.splice(i, 1);
  }
  if (fallbackSpecies) signals.push(`menyebut ${fallbackSpecies}`);
  else against.push("tidak menyebut jenis kayu");

  const is_timber = boards.length + logs.length >= 3 && fallbackSpecies !== null;

  /* Rows that read as neither a size nor a heading. Kept and shown: four
     unread rows on a nota is a nota somebody has to look at, and a reader that
     hides them is a reader that quietly loses wood. */
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
