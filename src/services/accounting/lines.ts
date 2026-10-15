/** What a ledger line is, beside what it cost (`0271`, L4).
 *
 *  `transaction_lines.kind` is the answer to *which part of this transfer
 *  was the thing and which part was the bank*: `item` (goods or a service
 *  at its listed price), `fee` (bank, admin, platform), `tax` (a typed
 *  amount, never a rate — D435), `shipping`, `discount` (subtracted when the
 *  lines are summed) and `other`. The letters a/b the owner asked for (D436)
 *  are the line numbers; the kind says what the letter is for.
 *
 *  **The amount stays positive; the kind carries the sign.** Same rule as
 *  `amount_idr` + `direction`: no signed numbers, so no sum has to remember
 *  a convention. `signedTotal` is the one place the subtraction happens on
 *  the client, mirroring `post_transaction`'s.
 *
 *  `guessLineKind` is the client's copy of `ops_acct.line_kind_guess`: what
 *  a description suggests when nobody picked a kind. It never guesses
 *  `discount` — that would change the sign.
 */
export const LINE_KINDS = ["item", "fee", "tax", "shipping", "discount", "other"] as const;
export type LineKind = (typeof LINE_KINDS)[number];

/** The kind's name on screen, in both languages the app speaks. */
export const LINE_KIND_LABELS: Record<LineKind, { en: string; id: string }> = {
  item:     { en: "Item",      id: "Barang / jasa" },
  fee:      { en: "Admin fee", id: "Biaya admin" },
  tax:      { en: "Tax",       id: "Pajak" },
  shipping: { en: "Shipping",  id: "Ongkir" },
  discount: { en: "Discount",  id: "Diskon" },
  other:    { en: "Other",     id: "Lainnya" },
};

/** −1 for a discount, +1 for everything else. */
export function lineSign(kind: LineKind | null | undefined): 1 | -1 {
  return kind === "discount" ? -1 : 1;
}

/** Σ lines, discounts counted minus — what the seam compares with the amount. */
export function signedTotal(lines: { kind?: LineKind | null; amount: number }[]): number {
  return lines.reduce((n, l) => n + lineSign(l.kind) * l.amount, 0);
}

/* Anchored at the start: *ELECTRICITY (+ADMIN FEE 4.000)* is electricity. */
const FEE = /^\s*((transfer|trf|bank|platform) ?)?(admin|adm)\.? ?fee\b|^\s*biaya ?(admin|adm|transfer|trf|bank)\b|^\s*(transfer|trf|bank|platform) ?fee\b|^\s*admin ?bank\b/i;
const TAX = /^\s*(ppn|pph ?2[1-6]?|pajak|tax|setoran pajak)\b/i;
/* *Tax consultant* is a service, not a tax. */
const NOT_TAX = /\bkonsultan|\bconsult/i;
const SHIPPING = /\bongkir\b|\bongkos ?kirim\b|\bshipping\b|\bdelivery ?fee\b|\bbiaya ?kirim\b/i;

export function guessLineKind(description: string): LineKind {
  if (FEE.test(description)) return "fee";
  if (TAX.test(description) && !NOT_TAX.test(description)) return "tax";
  if (SHIPPING.test(description)) return "shipping";
  return "item";
}

/** Only an item line is a quantity of something at a price; the rest are
 *  amounts. Decides which inputs a line shows and which D86 checks apply. */
export function isPricedKind(kind: LineKind): boolean {
  return kind === "item";
}

/** `amount_idr ÷ billed_amount`, the rate the rupiah actually bought — shown,
 *  never stored (D435). */
export function effectiveRate(amountIdr: number, billedAmount: number | null | undefined): number | null {
  return billedAmount && billedAmount > 0 ? amountIdr / billedAmount : null;
}

/* ── A line while it is being typed ─────────────────────────────────────
 *
 *  One draft shape for every screen that edits lines — Verifikasi, Entri
 *  baru's cousin, the re-detailing queue and the drawer (L12). `key` is a
 *  client-side identity so React can tell two lines apart; the database
 *  never sees it. `amount` is typed only for a line that is not an item; an
 *  item's amount is qty × unit price, never typed (D86).
 */
export interface LineDraft {
  key: number;
  kind: LineKind;
  description: string;
  qty: number;
  uom: string;
  unit_price: number;
  amount: number;
  item_id: string | null;
  /** The row's document this line came from (`0279`, L11); null = none. */
  attachment_id?: string | null;
}

export function draftAmount(l: LineDraft): number {
  return isPricedKind(l.kind) ? Math.round(l.qty * l.unit_price) : Math.round(l.amount);
}

/** Σ drafts with the sign the kind carries — what the seam compares with
 *  the transaction's amount. */
export function draftsTotal(ls: LineDraft[]): number {
  return ls.reduce((n, l) => n + lineSign(l.kind) * draftAmount(l), 0);
}

export function nextKey(ls: LineDraft[]): number {
  return Math.max(0, ...ls.map((l) => l.key)) + 1;
}

/** The tax typed as a figure (D435) moves the lines, not the total: the nota
 *  says 112.000 and prints PPN 12.000, so the goods were 100.000. The item
 *  lines are scaled to what is left after every non-item line, the rounding
 *  lands on the last of them, and the tax line is written or removed. */
export function withTax(ls: LineDraft[], taxAmount: number, total: number): LineDraft[] {
  const tax = Math.max(0, Math.round(taxAmount));
  const rest = ls.filter((l) => l.kind !== "tax");
  const others = rest.filter((l) => !isPricedKind(l.kind)).reduce((n, l) => n + lineSign(l.kind) * draftAmount(l), 0);
  const items = rest.filter((l) => isPricedKind(l.kind));
  const target = total - tax - others;
  const current = items.reduce((n, l) => n + draftAmount(l), 0);
  let scaled = items;
  if (items.length > 0 && target >= 0 && current !== target) {
    let given = 0;
    scaled = items.map((l, i) => {
      const share = i === items.length - 1
        ? target - given
        : (current > 0 ? Math.round(draftAmount(l) * target / current) : Math.round(target / items.length));
      given += share;
      const qty = l.qty > 0 ? l.qty : 1;
      return { ...l, qty, unit_price: Math.round((share / qty) * 100) / 100 };
    });
  }
  const next = rest.map((l) => scaled.find((s) => s.key === l.key) ?? l);
  if (tax > 0) {
    const old = ls.find((l) => l.kind === "tax");
    next.push({
      key: old?.key ?? nextKey(ls),
      kind: "tax", description: old?.description || "PPN", qty: 1, uom: "pcs", unit_price: tax, amount: tax, item_id: null,
    });
  }
  return next;
}

/** *Pisahkan biaya admin*: the …2.500 / …6.500 a bank folds into a transfer
 *  is taken off the last item line and becomes its own `fee` line, so the
 *  total stays what the bank says and the goods stop carrying the bank's
 *  charge (D434). Null when there is nothing to split. */
export function splitFee(ls: LineDraft[], total: number): LineDraft[] | null {
  if (ls.some((l) => l.kind === "fee")) return null;
  const tail = total % 10000;
  const fee = tail === 2500 || tail === 6500 ? tail : tail === 5000 ? 5000 : 0;
  if (fee === 0) return null;
  const idx = [...ls].reverse().findIndex((l) => isPricedKind(l.kind));
  if (idx < 0) return null;
  const at = ls.length - 1 - idx;
  const l = ls[at];
  const share = draftAmount(l) - fee;
  if (share <= 0) return null;
  const qty = l.qty > 0 ? l.qty : 1;
  const next = ls.map((x, i) => (i === at ? { ...x, qty, unit_price: Math.round((share / qty) * 100) / 100 } : x));
  next.push({
    key: nextKey(ls), kind: "fee", description: "Transfer admin fee", qty: 1, uom: "pcs",
    unit_price: fee, amount: fee, item_id: null,
  });
  return next;
}

/** The drafts as the seam wants them. An item line carries its quantity and
 *  price; every other kind is an amount. */
export function toSeamLines(ls: LineDraft[], fallbackDescription = "") {
  return ls.map((l) => (isPricedKind(l.kind)
    ? { kind: l.kind, description: l.description.trim() || fallbackDescription, qty: l.qty, uom: l.uom,
        unit_price: l.unit_price, amount: draftAmount(l), item_id: l.item_id, attachment_id: l.attachment_id ?? null }
    : { kind: l.kind, description: l.description.trim() || fallbackDescription, amount: draftAmount(l), attachment_id: l.attachment_id ?? null }));
}

/** The pointers a saved detail carries, for `set_line_evidence` after
 *  `set_transaction_lines`: line i+1 → the document draft i named. Empty
 *  when no draft names one, so the second call is skipped. */
export function toLinePointers(ls: LineDraft[]): { line_no: number; attachment_id: string | null }[] {
  if (!ls.some((l) => l.attachment_id)) return [];
  return ls.map((l, i) => ({ line_no: i + 1, attachment_id: l.attachment_id ?? null }));
}
