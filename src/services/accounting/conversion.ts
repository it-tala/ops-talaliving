/** Reading a conversion out of the caption Evin writes under the bank advice
 *  (D456). The captions are free text and vary:
 *
 *    USD=IDR1 @2000 @ 18028= 36,056,000
 *    TR USD 4000-IDR 1 @18145 =72.580.000
 *    CHANGE USD 6000 USD - IDR 1, @ 18229 = 109374000
 *    TR USD TO IDR 1, USD 2000 @ 18085 = 36.170.000
 *
 *  What they share: the rate is the last number after an `@`, the rupiah is
 *  the number after `=`, and the dollars are what remains (or rupiah ÷ rate).
 *  A proposal for the form, never a posting — the person checks it against
 *  the advice and the seam refuses a rate that does not multiply out. */

export interface ConversionGuess {
  usd: number | null;
  rate: number | null;
  idr: number | null;
}

/** `36,056,000` / `72.580.000` / `109374000` / `2,295.14` → number. A dot or
 *  comma followed by exactly three digits is a thousands separator. */
export function parseLooseNumber(raw: string): number | null {
  const s = raw.trim().replace(/[.,](?=\d{3}(?:\D|$))/g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function guessConversion(caption: string | null | undefined): ConversionGuess {
  const none: ConversionGuess = { usd: null, rate: null, idr: null };
  if (!caption || !/usd/i.test(caption)) return none;
  const text = caption.replace(/IDR\s*[12]\b/gi, " ");

  const idrMatch = /=\s*([\d.,]+)/.exec(text);
  const idr = idrMatch ? parseLooseNumber(idrMatch[1]) : null;

  const ats = [...text.matchAll(/@\s*([\d.,]+)/g)].map((m) => parseLooseNumber(m[1])).filter((n): n is number => n !== null);
  const rate = ats.length ? ats[ats.length - 1] : null;

  let usd: number | null = null;
  if (ats.length >= 2) usd = ats[ats.length - 2];
  if (usd === null) {
    const m = /USD\s*([\d.,]+)/i.exec(text.replace(/USD\s*(TO|=|-)\s*/gi, " "));
    if (m) usd = parseLooseNumber(m[1]);
  }
  if (usd === null && idr && rate) usd = Math.round((idr / rate) * 100) / 100;
  return { usd, rate, idr };
}
