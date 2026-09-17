/** The office day — ONE place.
 *
 *  The workshop's day is not UTC's. A scan at 23:10 WITA belongs to that
 *  evening's shift, and a UTC-based `toISOString().slice(0, 10)` files it under
 *  tomorrow — which is how a Friday's overtime lands on Saturday's payslip
 *  (F17, F39).
 *
 *  This constant existed **nine times**, copied into every file that needed a
 *  date (F63). Nine copies of a number is nine chances to disagree, and the
 *  disagreement would not be a crash: it would be one module thinking a scan
 *  happened on a different day from another module, which is the exact class
 *  of bug that takes a week to find. It is one file now, and the settings
 *  screen can point at it honestly.
 *
 *  It is **not editable from the settings screen** and the screen says why:
 *  changing it does not change what happens next, it changes which day every
 *  scan, every payslip and every daily recap already in the system belongs to.
 *  A business that genuinely moves time zone needs a migration, not a dropdown.
 */
export const OFFICE_TZ = {
  /** WITA, UTC+8. Bali. */
  offset_hours: 8,
  label: "WITA (UTC+8)",
  city: "Denpasar",
} as const;

const OFFSET_MS = OFFICE_TZ.offset_hours * 3_600_000;

/** The office day a moment belongs to, as `YYYY-MM-DD`. */
export function officeDay(at: Date | number = Date.now()): string {
  const ms = typeof at === "number" ? at : at.getTime();
  return new Date(ms + OFFSET_MS).toISOString().slice(0, 10);
}

/** Today, in the office's own reckoning. */
export function officeToday(): string {
  return officeDay(Date.now());
}
