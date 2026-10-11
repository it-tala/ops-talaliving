/** The one price formula, shared by the demo and the screens — the same
 *  arithmetic as `ops_procure.quote_price` (0133):
 *
 *      harga jual = ongkos × (1 + marketing% + overhead%) ÷ (1 − margin%)
 *
 *  Margin is of the selling price (owner, 2026-09-23).
 */

/** The selling price per unit, whole rupiah — `ops_procure.quote_price`.
 *  Null when there is no cost to price from. A margin of 100% or more has no
 *  price and is refused before it gets here. */
export function quotePrice(
  cost: number | null,
  marketingPct: number | null | undefined,
  overheadPct: number | null | undefined,
  marginPct: number | null | undefined,
  currency: "IDR" | "USD" = "IDR",
): number | null {
  if (cost == null) return null;
  const loaded = cost * (1 + ((marketingPct ?? 0) + (overheadPct ?? 0)) / 100);
  return roundTo(loaded / (1 - (marginPct ?? 0) / 100), currency === "USD" ? 2 : 0);
}

/** An amount in one currency, in another, at a kurs of rupiah per 1 USD —
 *  `ops_procure.money_in` (0256). Null where a kurs is needed and nobody has
 *  typed one: never a guess (D181). USD to the cent, rupiah to the rupiah. */
export function moneyIn(
  amount: number | null, from: "IDR" | "USD" | null, to: "IDR" | "USD", fxRate: number | null,
): number | null {
  if (amount == null || from == null) return null;
  if (from === to) return amount;
  if (fxRate == null) return null;
  return from === "IDR" ? roundTo(amount / fxRate, 2) : roundTo(amount * fxRate, 0);
}

/** Postgres `round(numeric, digits)`, half away from zero. Postgres counts in
 *  decimal and JavaScript in binary: 312.505 × 100 is 31250.499999999996 here,
 *  so the product is cut to 15 significant digits — past any price — before
 *  it is rounded, and both sides agree to the cent. */
export function roundTo(v: number, digits: number): number {
  if (digits === 0) return roundHalfAway(v);
  const f = 10 ** digits;
  return Math.sign(v) * Math.round(Number((Math.abs(v) * f).toPrecision(15))) / f;
}

/** Postgres `round(numeric)`: half away from zero. `Math.round` rounds −0.5
 *  up, which never matters for a price but would make the two sides disagree
 *  about a number that should be the same. */
export function roundHalfAway(v: number): number {
  return Math.sign(v) * Math.round(Math.abs(v));
}

/** A percent the database accepts: 0 up to, not including, 100. */
export const pctOk = (v: number | null | undefined): boolean => v == null || (v >= 0 && v < 100);
