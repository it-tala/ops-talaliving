import type { ItemCategory, ItemGroupSuggestion } from "./contracts";

/** Suggestions for filing the uncurated pile (Master Data phase 5).
 *
 *  The catalogue's shape is **Category → Item type → Item**, and an item's
 *  name leads with its type: *Screw SST 4x30*, *Screw SST 4x40* are both
 *  *Screw SST*. So items are grouped by their leading words — the words
 *  before the first size, number or unit — and each group is offered as one
 *  item type to file it under. Nothing is written: a person accepts a group,
 *  and the ordinary seams (`create_category`, `set_items_category`,
 *  `archive_items`) do the writing.
 *
 *  One pure function, used by both the demo and the live client, so the two
 *  cannot suggest different things for the same names. It is a heuristic and
 *  the screen says so; the words it knows are the ones production's names
 *  actually use (2026-09-23), Indonesian and English both. */

/** Tokens that end the "type" part of a name: sizes and units. */
const UNIT_TOKENS = new Set([
  "mm", "cm", "m", "mtr", "meter", "inch", "in", "x", "kg", "gr", "g", "ml", "l", "lt", "ltr", "liter",
  "pcs", "pc", "lembar", "lbr", "roll", "set", "box", "dus", "pack", "pak", "btg", "batang", "unit",
]);

/** Words that start a payment description rather than a thing bought. */
const NOT_GOODS_WORDS = new Set([
  "payment", "transfer", "tf", "payroll", "gaji", "salary", "thr", "bonus", "refund", "reimburse",
  "reimbursement", "pelunasan", "cicilan", "setor", "setoran", "pajak", "bpjs", "kasbon", "pinjaman",
  "topup", "deposit", "interest", "balance", "dp", "pembayaran", "tagihan", "uang",
  "funding", "withdrawal", "pemindahan", "reimbursment", "trf",
]);
const NOT_GOODS_PHRASES = [
  "uang makan", "admin fee", "tarik tunai", "bank charge", "biaya admin", "daily payroll",
  "petty cash", "bca to", "bni to", "open account",
];

/** Leading word → the top-level category it usually belongs under. Only
 *  codes that exist are used; the rest are ignored. */
const PARENT_BY_WORD: Record<string, string> = {
  amplas: "sanding", ampelas: "sanding", sandpaper: "sanding", sanding: "sanding", abrasive: "sanding",
  lem: "finishing", glue: "finishing", cat: "finishing", paint: "finishing", thinner: "finishing",
  melamine: "finishing", politur: "finishing", dempul: "finishing", filler: "finishing", stain: "finishing",
  sealer: "finishing", lacquer: "finishing", kuas: "finishing", coating: "finishing", wax: "finishing",
  plastik: "packing", kardus: "packing", karton: "packing", foam: "packing", bubble: "packing",
  lakban: "packing", tape: "packing", stretch: "packing", palet: "packing", pallet: "packing", strapping: "packing",
  mata: "machining", nanasan: "production", jcbc: "production", fab: "production", ring: "production",
  pipa: "production", braket: "production", webbing: "production", kain: "production", spon: "packing",
  styrofoam: "packing", tali: "packing", single: "packing", glaze: "finishing", binder: "finishing",
  tinner: "finishing", warna: "finishing", staples: "machining", pisau: "machining", router: "machining", bit: "machining", gergaji: "machining",
  saw: "machining", blade: "machining", gerinda: "machining", grinda: "machining", cutter: "machining", disc: "machining",
  screw: "production", sekrup: "production", baut: "production", bolt: "production", mur: "production",
  nut: "production", paku: "production", nail: "production", engsel: "production", hinge: "production",
  plat: "production", besi: "production", plywood: "production", kayu: "production", mdf: "production",
  triplek: "production", hpl: "production", rel: "production", handle: "production", dowel: "production",
  spidol: "office", kertas: "office", atk: "office", pulpen: "office", pen: "office", tinta: "office",
  stapler: "office", amplop: "office", materai: "office", map: "office",
  jasa: "service", sewa: "service", ongkir: "service", ongkos: "service", servis: "service",
  service: "service", kirim: "service", cargo: "service", rental: "service",
};

/** The type part of a name: lower-cased words up to the first size or unit. */
export function leadingWords(name: string): string[] {
  const words = name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
  const out: string[] = [];
  for (const w of words) {
    if (/\d/.test(w) || UNIT_TOKENS.has(w)) break;
    out.push(w);
  }
  return out;
}

export function looksLikePayment(name: string): boolean {
  const lower = ` ${name.toLowerCase().replace(/\s+/g, " ").trim()} `;
  if (NOT_GOODS_PHRASES.some((p) => lower.includes(` ${p} `) || lower.startsWith(` ${p}`))) return true;
  const first = leadingWords(name).slice(0, 2);
  return first.some((w) => NOT_GOODS_WORDS.has(w));
}

/** Title case, with vowel-less short words kept as the acronyms they are —
 *  *SST*, *MDF*, *HPL*, *PVC*. */
const title = (key: string) => key.split(" ")
  .map((w) => (w.length <= 4 && !/[aeiou]/.test(w) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)))
  .join(" ");

export function suggestItemGroups(
  items: { id: string; name: string; category_code: string }[],
  categories: ItemCategory[],
  opts: { min?: number } = {},
): ItemGroupSuggestion[] {
  const min = opts.min ?? 3;
  const codes = new Set(categories.map((c) => c.code));
  const tops = new Set(categories.filter((c) => !c.parent_code).map((c) => c.code));
  const types = categories.filter((c) => c.parent_code);

  const lead = new Map(items.map((i) => [i.id, leadingWords(i.name)]));
  /* How many names start with each one- and two-word prefix. */
  const counted = new Map<string, number>();
  for (const w of lead.values()) {
    if (w[0]) counted.set(w[0], (counted.get(w[0]) ?? 0) + 1);
    if (w.length >= 2) {
      const two = w.slice(0, 2).join(" ");
      counted.set(two, (counted.get(two) ?? 0) + 1);
    }
  }

  const groups = new Map<string, { id: string; name: string; category_code: string }[]>();
  for (const item of items) {
    const w = lead.get(item.id)!;
    if (w.length === 0) continue;
    const two = w.length >= 2 ? w.slice(0, 2).join(" ") : null;
    /* Two words when two words still make a group (*screw sst*), one when
       only the first word does (*amplas*), none when the name is alone. */
    const key = two && (counted.get(two) ?? 0) >= min ? two : (counted.get(w[0]) ?? 0) >= min ? w[0] : null;
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }

  const out: ItemGroupSuggestion[] = [];
  for (const [key, members] of groups) {
    if (members.length < min) continue;
    const notGoods = members.filter((m) => looksLikePayment(m.name)).length * 2 > members.length;
    /* What the first word usually means, and failing that where most of the
       members already are. The word comes first because the old filing is
       the thing being corrected — production had glue under machining and
       sandpaper under packing. */
    const tally = new Map<string, number>();
    for (const m of members) {
      if (m.category_code !== "uncurated" && codes.has(m.category_code)) {
        const top = categories.find((c) => c.code === m.category_code)?.parent_code ?? m.category_code;
        tally.set(top, (tally.get(top) ?? 0) + 1);
      }
    }
    const byMembers = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const byWord = PARENT_BY_WORD[key.split(" ")[0]] ?? null;
    const parent = notGoods ? null : (byWord && tops.has(byWord) ? byWord : byMembers && tops.has(byMembers) ? byMembers : null);
    const typeName = title(key);
    const existing = types.find((t) => t.name.toLowerCase() === typeName.toLowerCase()) ?? null;
    out.push({
      key,
      type_name: typeName,
      parent_code: existing?.parent_code ?? parent,
      existing_type_code: existing?.code ?? null,
      not_goods: notGoods,
      item_ids: members.map((m) => m.id),
      sample: members.slice(0, 5).map((m) => m.name),
      count: members.length,
    });
  }
  return out.sort((a, b) => Number(a.not_goods) - Number(b.not_goods) || b.count - a.count || a.key.localeCompare(b.key));
}
