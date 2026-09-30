/** How long somebody was at work on a day, beside how long they are paid
 *  for (D354).
 *
 *  Owner, on D353's reading: *mungkin perlu diberikan jam ada di lokasi kerja
 *  vs jam kerja dibayar.* Under `in_out` the paid hours are the schedule's at
 *  most, so a person who tapped in at 07.12 and out at 16.45 is paid 8,25 and
 *  was there 9,55 — and both numbers are worth seeing: the first is the wage,
 *  the second is the day as it was lived, and a gap between them that grows
 *  is overtime nobody has claimed yet.
 *
 *  On site is **first tap to last tap**, breaks included, rounded to the
 *  hundredth. Fewer than two taps is no span at all (null), not nought. Pure
 *  and shared, so both clients and every screen say the same number.
 */
export function onSiteHours(scans: { at: string }[]): number | null {
  if (scans.length < 2) return null;
  const t = scans.map((s) => Date.parse(s.at)).sort((a, b) => a - b);
  return Math.round((t[t.length - 1] - t[0]) / 36_000) / 100;
}
