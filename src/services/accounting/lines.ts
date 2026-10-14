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
