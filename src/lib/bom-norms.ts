/* Types only, for the reason `bom-vision.ts` gives: the contracts module also
   carries React-bound labels, and the suggest route cannot compile those. */
import type { BomNorm } from "@/services/production/contracts";

/** The business's estimating norms, applied to one BOM line (0193, D338).
 *
 *  Shared by the suggest route's validator (`bom-vision.ts`) and the sandbox's
 *  stand-in estimate, so the live model and the demo take a line's waste from
 *  the same rule in the same way.
 *
 *  Two readings of a `%` norm, because the business wrote both kinds:
 *
 *  - **waste** (*Plywood cutting waste 12 %*) is the line's `waste_percent`
 *    as it stands;
 *  - **yield** (*Square to finished component yield 80 %*) is what survives,
 *    and a BOM line is costed as `qty × (1 + waste ÷ 100)` (0182's
 *    `qty_with_waste`), so 80 % yield is 25 % waste — not the 20 % that
 *    `100 − yield` gives, which under-buys by a fifth of the waste (F194).
 *
 *  Which `%` norms are a line's waste is read from the norm's **name**, not
 *  its category: the business's `Factor` category holds both *Waste kayu (log
 *  ke komponen) 15 %* and *Kontingensi 5 %*, and only the first is a line's.
 *  Overhead, contingency and the old MISC figure price the whole BOM
 *  (`bom_revisions.miscalc_percent`) and are never one line's waste.
 */

const WASTE = /\b(waste|susut|scrap|breakage|pecah)\b/i;
const YIELD = /\b(yield|rendemen)\b/i;

/** `Panel · Plywood cutting waste` — how a norm is named on a line. */
export function normLabel(n: Pick<BomNorm, "category" | "norm">): string {
  return `${n.category.trim()} · ${n.norm.trim()}`;
}

export function isYieldNorm(n: Pick<BomNorm, "norm">): boolean {
  return YIELD.test(n.norm);
}

/** The `waste_percent` a norm gives a line, or null when it is not a line's
 *  waste (a coverage, a sheet size, overhead or contingency, a figure left
 *  blank). */
export function wasteFromNorm(n: BomNorm): number | null {
  if (n.value == null || !Number.isFinite(n.value)) return null;
  if ((n.unit ?? "").replace(/\s+/g, "") !== "%") return null;
  if (!WASTE.test(n.norm) && !isYieldNorm(n)) return null;
  if (isYieldNorm(n)) {
    if (n.value <= 0 || n.value > 100) return null;
    const w = Math.round((100 / n.value - 1) * 1000) / 10;
    return w <= 90 ? w : null;
  }
  return n.value >= 0 && n.value <= 90 ? n.value : null;
}

/** The norm a model named, by `Category | Norm` (or `·`), else by the norm's
 *  name alone when only one norm has it. */
export function findNorm(norms: BomNorm[], asked: string | null | undefined): BomNorm | null {
  if (!asked) return null;
  const key = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const parts = asked.split(/\s*[|·]\s*/);
  if (parts.length >= 2) {
    const [cat, ...rest] = parts;
    const hit = norms.find((n) => key(n.category) === key(cat) && key(n.norm) === key(rest.join(" | ")));
    if (hit) return hit;
  }
  const byName = norms.filter((n) => key(n.norm) === key(asked));
  return byName.length === 1 ? byName[0] : null;
}

/** One norm as a line of the prompt: category | norm | value unit | source |
 *  basis — remarks. The remarks carry the business's own *how to use this*. */
export function normPromptLine(n: BomNorm): string {
  const value = n.value == null ? "—" : `${n.value}${n.unit ? ` ${n.unit}` : ""}`;
  const why = [n.basis, n.remarks].map((x) => x?.trim()).filter(Boolean).join(" — ");
  return `${n.category} | ${n.norm} | ${value} | ${n.source_kind ?? "—"}${why ? ` | ${why}` : ""}`;
}
