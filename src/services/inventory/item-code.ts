/** Item codes for items registered at the rack: `LOC-CAT-NNNN` (`0197`, D346).
 *
 *  `GDG-AMS-0001` is the first sandpaper-sheet item registered in the main
 *  warehouse. The location and the category each carry a short code (`abbr`);
 *  the number runs per location and category. The database issues the real
 *  code (`ops_inv.register_item`); this file is the demo's copy of the same
 *  rules and the screen's preview. */
import type { StockedCategory } from "./contracts";

/** The short-code candidates for a name or code, best first — the same order
 *  as `ops_core.abbr_candidates`. */
export function abbrCandidates(text: string): string[] {
  const out: string[] = [];
  let all = (text ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const words = (text ?? "").toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  if (!all) all = "X";
  if (all.length >= 2 && all.length <= 4) out.push(all);
  if (all.length > 4) out.push(all.slice(0, 3));
  if (all.length > 4 && /[0-9]$/.test(all)) out.push(all[0] + all.slice(-3));
  if (words.length >= 2) {
    const init = words.slice(0, 4).map((w) => w[0]).join("");
    if (init.length >= 2) out.push(init);
  }
  const cons = all[0] + all.slice(1).replace(/[AEIOU]/g, "");
  if (cons.length >= 3) out.push(cons.slice(0, 3));
  if (all.length > 4) out.push(all[0] + all.slice(-3));
  const two = all.padEnd(2, "X").slice(0, 2);
  for (let n = 2; n <= 99; n++) out.push(two + n);
  return out;
}

/** The first candidate nobody has taken. */
export function pickAbbr(texts: string[], taken: Iterable<string | null | undefined>): string | null {
  const used = new Set([...taken].filter(Boolean) as string[]);
  for (const t of texts) {
    for (const c of abbrCandidates(t)) if (!used.has(c)) return c;
  }
  return null;
}

export const ABBR_SHAPE = /^[A-Z0-9]{2,4}$/;

export function itemCode(locationAbbr: string, categoryAbbr: string, n: number): string {
  return `${locationAbbr}-${categoryAbbr}-${String(n).padStart(4, "0")}`;
}

/** What the screen shows before saving: the number is issued on save. */
export function itemCodePreview(locationAbbr: string | null | undefined, categoryAbbr: string | null | undefined): string {
  return `${locationAbbr || "LOK"}-${categoryAbbr || "KAT"}-####`;
}

/** The stocked categories as the picker shows them: each group, then its
 *  types, by name. A type whose group is not counted still appears, under its
 *  group's name. */
export function stockedCategoryTree(
  stocked: string[],
  categories: { code: string; name: string; abbr?: string | null; parent_code: string | null }[],
): StockedCategory[] {
  const byCode = new Map(categories.map((c) => [c.code, c]));
  const rows: StockedCategory[] = stocked
    .map((code) => byCode.get(code))
    .filter((c): c is NonNullable<typeof c> => !!c)
    .map((c) => ({
      code: c.code, name: c.name, abbr: c.abbr ?? null,
      parent_code: c.parent_code, parent_name: c.parent_code ? byCode.get(c.parent_code)?.name ?? c.parent_code : null,
    }));
  const group = (r: StockedCategory) => r.parent_name ?? r.name;
  return rows.sort((a, b) =>
    group(a).localeCompare(group(b))
    || Number(a.parent_code != null) - Number(b.parent_code != null)
    || a.name.localeCompare(b.name));
}
