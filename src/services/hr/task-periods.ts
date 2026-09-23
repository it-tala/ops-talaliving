/** Periods, as arithmetic — the one piece of the task module that exists
 *  twice.
 *
 *  ## Why this file has no imports
 *
 *  `scripts/check-task-periods.mjs` compiles it with `tsc` and runs it in plain
 *  node, with no bundler and no path aliases, so that every case below can be
 *  put to **both** implementations and the answers compared. An import here
 *  breaks that, which is why there are none — the same rule
 *  `schedule-rules.ts` carries, for the same reason.
 *
 *  ## Why the parity gate is not paranoia
 *
 *  `ops_hr.task_period_start` and this file must agree to the day, and the cost
 *  of disagreeing is not a wrong label on a screen. The database holds **one
 *  task per routine per period** through a unique index on
 *  `(routine_id, period_start)`. If the demo cuts September's boundary on the
 *  1st and the database cuts it on the 2nd, the index never sees a collision,
 *  the generator raises the same month twice, and nothing anywhere reports an
 *  error — the board just quietly grows a duplicate every month.
 *
 *  F143 was this shape and it got through: a JS `.sort()` and an
 *  `en_US.UTF-8` `order by` disagreed about `Workshop` and `office`, and both
 *  the local cluster and CI collated like `C`, so the gate that should have
 *  caught it was blind. The answer then was to pin the ordering on both sides
 *  and compare them. This is the same answer, applied before the bug rather
 *  than after it.
 *
 *  Everything here is UTC arithmetic on `YYYY-MM-DD` strings. A period boundary
 *  is a calendar fact and has no clock in it; going through a local `Date`
 *  would put the browser's timezone into a figure the database computed in
 *  WITA, which is F17 arriving by another road.
 */

/** How often a standing expectation comes round. Mirrors
 *  `ops_hr.task_cadence_t`. */
export type Cadence = "WEEKLY" | "MONTHLY" | "QUARTERLY" | "SEMESTER" | "ANNUAL";

export const CADENCES: Cadence[] = ["WEEKLY", "MONTHLY", "QUARTERLY", "SEMESTER", "ANNUAL"];

/** What each cadence is called on a screen, in Indonesian. Not part of the
 *  parity gate — Postgres never prints this one. */
export const CADENCE_LABEL: Record<Cadence, string> = {
  WEEKLY: "Mingguan",
  MONTHLY: "Bulanan",
  QUARTERLY: "Tiga bulanan",
  SEMESTER: "Enam bulanan",
  ANNUAL: "Tahunan",
};

/* Postgres `to_char(…, 'Mon')` with the C locale, which is what both the
   scratch cluster and the project use. Written out rather than derived from
   `Intl`, whose month names follow the runtime's locale and would differ
   between a developer's browser and a Worker. */
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
             "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parse(d: string): Date {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}

function fmt(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** `n` days after `d`. */
export function addDays(d: string, n: number): string {
  const x = parse(d);
  x.setUTCDate(x.getUTCDate() + n);
  return fmt(x);
}

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((parse(to).getTime() - parse(from).getTime()) / 86_400_000);
}

/** The first day of the period of this cadence that contains `on`.
 *
 *  Weeks start Monday, matching `date_trunc('week')` and matching what
 *  `is_rest_day` assumes when it reads `isodow`. One definition of a week.
 */
export function taskPeriodStart(cadence: Cadence, on: string): string {
  const d = parse(on);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  switch (cadence) {
    case "WEEKLY": {
      /* `getUTCDay()` is 0 for Sunday, so Sunday is six days into its week and
         not the start of the next one. Getting this backwards moves every
         weekly boundary by a day for one seventh of the year, which is the
         kind of bug that looks like nothing until a Sunday. */
      const back = (d.getUTCDay() + 6) % 7;
      return addDays(on, -back);
    }
    case "MONTHLY":   return fmt(new Date(Date.UTC(y, m, 1)));
    case "QUARTERLY": return fmt(new Date(Date.UTC(y, Math.floor(m / 3) * 3, 1)));
    case "SEMESTER":  return fmt(new Date(Date.UTC(y, m < 6 ? 0 : 6, 1)));
    case "ANNUAL":    return fmt(new Date(Date.UTC(y, 0, 1)));
  }
}

/** The last day of the period that begins on `start`.
 *
 *  Computed as *one unit on, minus a day*, never as a fixed length: February
 *  has 28 days and sometimes 29, and a month hard-coded at 30 is a boundary
 *  that drifts by a day or three every year.
 */
export function taskPeriodEnd(cadence: Cadence, start: string): string {
  const d = parse(start);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const day = d.getUTCDate();
  switch (cadence) {
    case "WEEKLY":    return addDays(start, 6);
    case "MONTHLY":   return fmt(new Date(Date.UTC(y, m + 1, day - 1)));
    case "QUARTERLY": return fmt(new Date(Date.UTC(y, m + 3, day - 1)));
    case "SEMESTER":  return fmt(new Date(Date.UTC(y, m + 6, day - 1)));
    case "ANNUAL":    return fmt(new Date(Date.UTC(y + 1, m, day - 1)));
  }
}

/** The ISO week number and its ISO year — `to_char(…, 'IW')` and `'IYYY'`.
 *
 *  Not the same as the calendar year at the turn of it: 1 January 2027 falls in
 *  ISO week 53 of 2026, and printing `Minggu 53/2027` would name a week that
 *  does not exist. The two are computed together for that reason.
 */
function isoWeek(date: string): { week: number; year: number } {
  /* The Thursday of this week decides both. That is the whole ISO rule, and
     doing it any other way means special-casing the two ends of the year. */
  const thursday = addDays(taskPeriodStart("WEEKLY", date), 3);
  const t = parse(thursday);
  const jan1 = parse(`${t.getUTCFullYear()}-01-01`);
  const week = Math.floor(
    Math.round((t.getTime() - jan1.getTime()) / 86_400_000) / 7,
  ) + 1;
  return { week, year: t.getUTCFullYear() };
}

/** The period as a person says it out loud. `Sep 2026`, not `2026-09-01 →
 *  2026-09-30`: the second one is read twice and the first one once. */
export function taskPeriodLabel(cadence: Cadence, start: string): string {
  const d = parse(start);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  switch (cadence) {
    case "WEEKLY": {
      const { week, year } = isoWeek(start);
      return `Minggu ${String(week).padStart(2, "0")}/${year}`;
    }
    case "MONTHLY":   return `${MON[m]} ${y}`;
    case "QUARTERLY": return `TW${Math.floor(m / 3) + 1} ${y}`;
    case "SEMESTER":  return `Smt ${m < 6 ? 1 : 2} ${y}`;
    case "ANNUAL":    return `${y}`;
  }
}

/** Every period of this cadence that begins on or before `through`, from the
 *  period containing `from` — what the generator walks.
 *
 *  Bounded by the caller on both ends, and returned rather than inserted, so
 *  the demo and the database can be asked the same question and compared.
 */
export function taskPeriodsBetween(
  cadence: Cadence, from: string, through: string,
): { start: string; end: string }[] {
  const out: { start: string; end: string }[] = [];
  let start = taskPeriodStart(cadence, from);
  /* A guard, not a limit anybody should reach: a year of weeks is 53, and the
     caller's window is capped at 365 days. A loop over dates that never
     terminates takes a Worker down, and the cost of the check is nothing. */
  for (let guard = 0; start <= through && guard < 400; guard += 1) {
    const end = taskPeriodEnd(cadence, start);
    out.push({ start, end });
    start = taskPeriodStart(cadence, addDays(end, 1));
  }
  return out;
}

/** The specification, put to both implementations by
 *  `scripts/check-task-periods.mjs`.
 *
 *  Chosen for the edges rather than for coverage: a Sunday and a Monday either
 *  side of a weekly boundary, a leap February, the turn of a year where the ISO
 *  week and the calendar year disagree, and one date in each half of a
 *  semester. A case list that only holds comfortable dates proves the two
 *  implementations agree about the easy half.
 */
export const PERIOD_CASES: { cadence: Cadence; on: string }[] = [
  { cadence: "WEEKLY",    on: "2026-09-20" },  // Sunday — end of its week
  { cadence: "WEEKLY",    on: "2026-09-21" },  // Monday — start of the next
  { cadence: "WEEKLY",    on: "2026-12-31" },  // ISO week 53 of 2026
  { cadence: "WEEKLY",    on: "2027-01-01" },  // still ISO week 53 of 2026
  { cadence: "WEEKLY",    on: "2027-01-04" },  // ISO week 01 of 2027
  { cadence: "WEEKLY",    on: "2026-01-01" },
  { cadence: "MONTHLY",   on: "2026-09-23" },
  { cadence: "MONTHLY",   on: "2028-02-29" },  // leap day
  { cadence: "MONTHLY",   on: "2026-02-28" },
  { cadence: "MONTHLY",   on: "2026-12-31" },
  { cadence: "MONTHLY",   on: "2026-01-01" },
  { cadence: "QUARTERLY", on: "2026-09-30" },
  { cadence: "QUARTERLY", on: "2026-10-01" },
  { cadence: "QUARTERLY", on: "2026-01-15" },
  { cadence: "SEMESTER",  on: "2026-06-30" },
  { cadence: "SEMESTER",  on: "2026-07-01" },
  { cadence: "ANNUAL",    on: "2026-12-31" },
  { cadence: "ANNUAL",    on: "2026-01-01" },
];
