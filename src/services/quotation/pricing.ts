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
): number | null {
  if (cost == null) return null;
  const loaded = cost * (1 + ((marketingPct ?? 0) + (overheadPct ?? 0)) / 100);
  return roundHalfAway(loaded / (1 - (marginPct ?? 0) / 100));
}

/** Postgres `round(numeric)`: half away from zero. `Math.round` rounds −0.5
 *  up, which never matters for a price but would make the two sides disagree
 *  about a number that should be the same. */
export function roundHalfAway(v: number): number {
  return Math.sign(v) * Math.round(Math.abs(v));
}

/** A percent the database accepts: 0 up to, not including, 100. */
export const pctOk = (v: number | null | undefined): boolean => v == null || (v >= 0 && v < 100);
