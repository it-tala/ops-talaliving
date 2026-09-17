/** Centralised formatting.
 *
 *  One file, so rupiah and dates never appear in two different shapes on two
 *  different pages.
 */

/** The interface language, and with it the number and date shapes.
 *
 *  ONE PLACE, deliberately: when multi-language arrives this becomes a value
 *  from the session rather than a constant, and nothing else moves.
 *
 *  Why `en-US` grouping for rupiah, when Indonesia writes `Rp 18.900.000`:
 *  an English interface showing `18.900` is genuinely ambiguous — an English
 *  reader sees eighteen point nine. Mixing an English UI with Indonesian digit
 *  grouping is the one combination that can be misread as a number a thousand
 *  times smaller, and money is the wrong place to be clever. If the team would
 *  rather have local grouping back, change this line and nothing else.
 */
export const LOCALE = "en-US";

/** The locale actually in force.
 *
 *  A module-level value rather than a constant, because the settings screen
 *  can move it (D216) and a settings page whose values nothing reads is
 *  theatre. It is set once when the sandbox hydrates and again whenever the
 *  setting changes; everything below reads it rather than `LOCALE`, so there
 *  is still exactly one place the shape of a number is decided.
 */
let activeLocale: string = LOCALE;

export function setActiveLocale(locale: string) {
  activeLocale = locale || LOCALE;
}

export function getActiveLocale(): string {
  return activeLocale;
}

export function formatIDR(value: number, withSymbol = true): string {
  const n = new Intl.NumberFormat(activeLocale, { maximumFractionDigits: 0 }).format(Math.round(value));
  return withSymbol ? `Rp ${n}` : n;
}

/** For chart axes and KPI tiles, where the full number hides the shape of the
 *  data. K / M / B in the English sense — note this is not the Indonesian
 *  scale, where M means miliar. */
export function formatIDRCompact(value: number): string {
  return `Rp ${compactNumber(value)}`;
}

/** The same scale without the currency prefix, for chart axes: a tick does not
 *  need to repeat `Rp` eight times when the card title already says what the
 *  axis measures, and the prefix is what made English compact labels wrap. */
export function formatCompact(value: number): string {
  return compactNumber(value);
}

function compactNumber(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(0)}K`;
  return `${value}`;
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat(activeLocale).format(value);
}

export function formatDate(d: Date): string {
  return new Intl.DateTimeFormat(activeLocale, { day: "2-digit", month: "short", year: "numeric" }).format(d);
}

export function formatDateTime(d: Date): string {
  return new Intl.DateTimeFormat(activeLocale, {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(d);
}

/** Timber volume in cubic metres — three decimals, because 0.001 m³ of a log
 *  is money. */
export function formatM3(value: number): string {
  return `${new Intl.NumberFormat(activeLocale, { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(value)} m³`;
}
