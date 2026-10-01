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

/** The hours actually worked on a day (D362): on site, first tap to last,
 *  **less the break** — the schedule's (45 minutes at the workshop, an hour at
 *  the office, 90 on a Friday) under the arrival-and-departure reading, or
 *  the break tapped out and back in under the slot reading. Owner, on D354:
 *  *jika jadwal 8,25 maka maksimal paid hanya 8,25, dan jam bekerja aktual
 *  kurangi jam istirahat entah 45 menit atau 1 jam.* So the paid hours stop
 *  at the schedule and this one does not: the gap between them is time
 *  worked past the schedule that only an overtime sheet pays. Null with
 *  fewer than two taps. */
export function actualHours(day: OnSiteDay): number | null {
  const span = onSiteSpan(day);
  if (span == null) return null;
  const on = Math.round((Date.parse(span.to) - Date.parse(span.from)) / 36_000) / 100;
  return Math.max(Math.round((on - day.break_hours) * 100) / 100, 0);
}

export interface OnSiteDay {
  scans: { at: string }[];
  break_hours: number;
  shift_code?: string | null;
  slots?: { in?: string; out?: string };
}

/** The stretch the actual hours are measured over: first tap to last — or,
 *  for a day read as a shift (D364), its masuk to its pulang, because a
 *  guard's stray tap at 00.30 is not twelve more hours at the gate. Null
 *  without two ends. */
export function onSiteSpan(day: OnSiteDay): { from: string; to: string } | null {
  if (day.shift_code) {
    return day.slots?.in && day.slots?.out ? { from: day.slots.in, to: day.slots.out } : null;
  }
  if (day.scans.length < 2) return null;
  const t = [...day.scans].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return { from: t[0].at, to: t[t.length - 1].at };
}
