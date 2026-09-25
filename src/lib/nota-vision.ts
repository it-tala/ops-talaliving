import "server-only";

import type {
  LogCostKind, NotaCostLine, NotaScan, NotaTimberLine,
} from "@/services/inventory/contracts";

/** Reading a photographed nota with a language model — and still deciding
 *  first whether it is a timber one (D200).
 *
 *  The rules reader (`_nota_kayu.ts`) needs typed text, and nobody types a
 *  nota: they photograph it. So the photo goes to a model, and what comes back
 *  is put through **the same shape and the same doubts** as the rules reader's
 *  answer: a `NotaScan`, reasons in words, rows it could not make sense of kept
 *  rather than dropped, and nothing written until somebody agrees. A model's
 *  reading is a proposal exactly as the regex's is.
 *
 *  What the model returns is not trusted as numbers either. Every board is
 *  checked against the same plausible sizes the rules reader uses, and a row
 *  that is not wood goes to `unread` where a person sees it — a misread `8` for
 *  `3` is a factor of nearly three on every cubic metre.
 */

export const NOTA_SYSTEM = `Kamu membaca foto nota dari usaha kayu di Indonesia untuk sebuah bengkel mebel.
Jawab HANYA dengan satu objek JSON, tanpa teks lain, dengan bentuk:

{
  "document": "timber" | "cost" | "other",
  "issuer": string | null,
  "date": "YYYY-MM-DD" | null,
  "species": string | null,
  "total": number | null,
  "lines": [
    { "raw": string, "kind": "board", "thickness_mm": number, "width_mm": number, "length_mm": number, "qty": number, "amount": number | null },
    { "raw": string, "kind": "log", "diameter_cm": number, "length_cm": number, "qty": number, "amount": number | null }
  ],
  "costs": [ { "raw": string, "kind": "angkut" | "potong" | "bongkar" | "lain", "amount": number } ],
  "unread": [string],
  "reasons_for": [string],
  "reasons_against": [string]
}

Aturan:
- "timber": nota penjual kayu — berisi ukuran papan (tebal × lebar × panjang) atau log (diameter × panjang).
  "cost": nota jasa untuk kayu — angkutan/truk, potong/gergaji/sawmill, bongkar muat — tanpa ukuran kayu yang dijual.
  "other": selain itu.
- Tiap baris ukuran di nota menjadi satu entri "lines". Jangan dijumlahkan, jangan digabung.
- Ukuran papan dalam MILIMETER. Nota biasanya menulis sentimeter (3 x 20 x 300 berarti 30 × 200 × 3000 mm).
- Log: diameter dan panjang dalam SENTIMETER. "qty" = jumlah batang/lembar pada baris itu (1 bila tidak tertulis).
- "raw" = teks baris itu persis seperti tertulis.
- Ongkos yang bukan kayu (angkut, kirim, potong, gergaji, bongkar, muat, kuli) masuk "costs", bukan "lines".
- "total" = angka total/jumlah yang tercetak di nota, dalam rupiah utuh (tanpa titik atau koma).
- Semua uang dalam rupiah utuh. Tulisan tangan yang tidak yakin terbaca: masukkan ke "unread", jangan ditebak.
- "species": jenis kayu yang disebut (Jati, Mahoni, Sungkai, Meranti, Trembesi, …), atau null.
- "reasons_for"/"reasons_against": alasan singkat dalam bahasa Indonesia mengapa ini (bukan) nota kayu. Maksimal tiga masing-masing.`;

export const NOTA_PROMPT = "Baca nota ini.";

const PLAUSIBLE = {
  thickness: [5, 150],
  width: [30, 1500],
  length: [300, 6500],
} as const;

const LOG_PLAUSIBLE = { diameter: [5, 300], length: [50, 2000] } as const;

const COST_KINDS: LogCostKind[] = ["angkut", "potong", "bongkar", "lain"];

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/[^\d.,-]/g, "").replace(/\./g, "").replace(",", ".")) : NaN;
  return Number.isFinite(n) ? n : null;
};

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, 200) : null;

const within = (n: number | null, [lo, hi]: readonly [number, number]) => n != null && n >= lo && n <= hi;

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b\p{L}/gu, (c) => c.toUpperCase());
}

/** The model's object, as a `NotaScan` a person can check. */
export function toNotaScan(out: Record<string, unknown>): NotaScan {
  const doc = out.document === "timber" || out.document === "cost" ? out.document : "other";
  const species = str(out.species) ? titleCase(str(out.species)!) : null;
  const unread: string[] = (Array.isArray(out.unread) ? out.unread : [])
    .map(str).filter((s): s is string => s !== null).slice(0, 40);

  const lines: NotaTimberLine[] = [];
  for (const raw of Array.isArray(out.lines) ? out.lines.slice(0, 200) : []) {
    if (!raw || typeof raw !== "object") continue;
    const l = raw as Record<string, unknown>;
    const text = str(l.raw) ?? "(tanpa teks)";
    const qty = Math.max(1, Math.round(num(l.qty) ?? 1));
    const amount = num(l.amount);
    if (l.kind === "board") {
      const t = num(l.thickness_mm);
      const w = num(l.width_mm);
      const len = num(l.length_mm);
      if (within(t, PLAUSIBLE.thickness) && within(w, PLAUSIBLE.width) && within(len, PLAUSIBLE.length)) {
        lines.push({
          raw: text, kind: "board", species,
          thickness_mm: t, width_mm: w, length_mm: len,
          diameter_cm: null, length_cm: null, qty,
          amount: amount != null && amount > 0 ? Math.round(amount) : null,
        });
        continue;
      }
    } else if (l.kind === "log") {
      const d = num(l.diameter_cm);
      const len = num(l.length_cm);
      if (within(d, LOG_PLAUSIBLE.diameter) && within(len, LOG_PLAUSIBLE.length)) {
        lines.push({
          raw: text, kind: "log", species,
          thickness_mm: null, width_mm: null, length_mm: null,
          diameter_cm: d, length_cm: len, qty,
          amount: amount != null && amount > 0 ? Math.round(amount) : null,
        });
        continue;
      }
    }
    /* Not a size any board or log can be — shown, never filed. */
    unread.push(text);
  }

  const costs: NotaCostLine[] = [];
  for (const raw of Array.isArray(out.costs) ? out.costs.slice(0, 20) : []) {
    if (!raw || typeof raw !== "object") continue;
    const c = raw as Record<string, unknown>;
    const amount = num(c.amount);
    if (amount == null || amount <= 0) continue;
    const kind = COST_KINDS.includes(c.kind as LogCostKind) ? c.kind as LogCostKind : "lain";
    costs.push({ raw: str(c.raw) ?? kind, kind, amount: Math.round(amount) });
  }

  const boards = lines.filter((l) => l.kind === "board").length;
  const logs = lines.filter((l) => l.kind === "log").length;
  const said = (v: unknown) => (Array.isArray(v) ? v : []).map(str).filter((s): s is string => s !== null).slice(0, 3);

  const signals = ["dibaca dari foto oleh model bahasa — periksa tiap baris dengan notanya"];
  const against: string[] = [];
  if (boards > 0) signals.push(`${boards} baris berbentuk ukuran papan`);
  if (logs > 0) signals.push(`${logs} baris berbentuk ukuran log (diameter × panjang)`);
  if (boards + logs === 0) against.push("tidak ada baris ukuran kayu yang masuk akal");
  if (species) signals.push(`menyebut ${species}`);
  else against.push("tidak menyebut jenis kayu");
  if (doc === "cost") against.push("terbaca sebagai nota jasa (angkut/potong), bukan nota penjual kayu");
  if (doc === "other") against.push("model tidak mengenalinya sebagai nota kayu");
  signals.push(...said(out.reasons_for).map((r) => `model: ${r}`));
  against.push(...said(out.reasons_against).map((r) => `model: ${r}`));

  const total = num(out.total);
  const date = str(out.date);

  return {
    is_timber: doc === "timber" && boards + logs > 0 && species !== null,
    signals, against,
    species_guess: species,
    total_guess: total != null && total > 0 ? Math.round(total) : null,
    lines, unread,
    source: "image",
    vendor_guess: str(out.issuer),
    date_guess: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
    costs,
  };
}
