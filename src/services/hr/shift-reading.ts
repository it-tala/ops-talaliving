/** Which shift a day of somebody on shifts was, read off their taps (D364).
 *
 *  Owner: *Satpam ada 2 shift — Shift 1 07.00–17.00, Shift 2 17.00–07.00*,
 *  given out **tidak tentu, tiap hari bisa beda**, and where the taps cannot
 *  say, HRD picks. The machine says *when*, never *in or out*, and both shifts
 *  tap at about 07.00 and 17.00 — so the taps are read as a chain:
 *
 *   1. taps within an hour of each other are one tap;
 *   2. HRD's picks first: for a picked day, the tap nearest the shift's start
 *      is masuk and the one nearest its end is pulang;
 *   3. the rest form **runs** of neighbouring taps that each fit one shift
 *      (masuk four hours either side of its start, pulang of its end), paired
 *      **from the start** of each run;
 *   4. a run with an odd number of taps leaves its last alone — *open* while
 *      it is the latest tap and its shift has not ended, otherwise *lone*.
 *
 *  A shift belongs to the day it starts. Transcribes `ops_hr.shift_reading()`
 *  (0206) for the demo; the database is the reading production uses. Pure,
 *  imports only the shapes.
 */
import type { ScheduleShift } from "./schedule-rules";

const MIN = 60_000;
const HOUR = 60 * MIN;
/** The office clock, WIB (D334) — `OFFICE_OFFSET` in `schedule-rules.ts`. */
const OFFSET_MS = 7 * HOUR;
/** How far a tap may be from a shift's start or end and still be it. */
const NEAR = 4 * HOUR;
/** Taps closer than this are one tap. */
const SAME_TAP = 60 * MIN;
/** How far back a run is followed, and forward. */
export const SHIFT_LOOKBACK_DAYS = 21;
export const SHIFT_LOOKAHEAD_DAYS = 3;

export interface ShiftTap { id: string; at: string }
export interface ShiftPick { work_date: string; shift_code: string }

export type ShiftStatus = "paired" | "open" | "lone" | "none";

export interface ShiftReading {
  code: string | null;
  name: string | null;
  in: ShiftTap | null;
  out: ShiftTap | null;
  /** The shift's own start and end on this day, epoch ms. */
  start: number | null;
  end: number | null;
  /** Every tap this day took, in order. */
  taps: ShiftTap[];
  status: ShiftStatus;
  /** Taps on the day that are neither masuk nor pulang. */
  extra: number;
  picked: boolean;
}

export function officeDayOf(ms: number): string {
  return new Date(ms + OFFSET_MS).toISOString().slice(0, 10);
}

export function addDayKey(key: string, n: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function at(day: string, minutes: number): number {
  return Date.parse(`${day}T00:00:00Z`) - OFFSET_MS + minutes * MIN;
}

export function shiftStartAt(day: string, s: ScheduleShift): number {
  return at(day, s.start_minutes);
}

export function shiftEndAt(day: string, s: ScheduleShift): number {
  return at(s.end_minutes <= s.start_minutes ? addDayKey(day, 1) : day, s.end_minutes);
}

interface Placed { code: string; day: string }

/** Whether `a` then `b` is one shift: the closest fit, or null. */
export function shiftLink(shifts: ScheduleShift[], a: number, b: number): Placed | null {
  if (b <= a) return null;
  let best: Placed | null = null;
  let bestDist = Infinity;
  const base = officeDayOf(a);
  for (const s of shifts) {
    for (const k of [-1, 0, 1]) {
      const day = addDayKey(base, k);
      const ds = Math.abs(a - shiftStartAt(day, s));
      const de = Math.abs(b - shiftEndAt(day, s));
      if (ds <= NEAR && de <= NEAR && ds + de < bestDist) {
        best = { code: s.code, day };
        bestDist = ds + de;
      }
    }
  }
  return best;
}

/** What one tap on its own most likely is: a start (preferred), else an end. */
export function shiftRole(
  shifts: ScheduleShift[], a: number,
): (Placed & { role: "in" | "out" }) | null {
  const base = officeDayOf(a);
  let best: (Placed & { role: "in" | "out" }) | null = null;
  let bestKey = [Infinity, Infinity];
  for (const [pref, role] of [[0, "in"], [1, "out"]] as const) {
    for (const s of shifts) {
      for (const k of [-1, 0, 1]) {
        const day = addDayKey(base, k);
        const dist = Math.abs(a - (role === "in" ? shiftStartAt(day, s) : shiftEndAt(day, s)));
        if (dist > NEAR) continue;
        if (pref < bestKey[0] || (pref === bestKey[0] && dist < bestKey[1])) {
          best = { code: s.code, day, role };
          bestKey = [pref, dist];
        }
      }
    }
  }
  return best;
}

type Role = "in" | "out" | "open" | "lone";

/** One day of somebody on shifts. `taps` are theirs, any order, from at least
 *  `SHIFT_LOOKBACK_DAYS` before the day to `SHIFT_LOOKAHEAD_DAYS` after. */
export function shiftReading(
  shifts: ScheduleShift[],
  taps: ShiftTap[],
  picks: ShiftPick[],
  date: string,
  now: number = Date.now(),
): ShiftReading {
  const from = addDayKey(date, -SHIFT_LOOKBACK_DAYS);
  const to = addDayKey(date, SHIFT_LOOKAHEAD_DAYS);
  const sorted = taps
    .filter((t) => { const d = officeDayOf(Date.parse(t.at)); return d >= from && d <= to; })
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const kept: ShiftTap[] = [];
  let prev: number | null = null;
  for (const t of sorted) {
    const ms = Date.parse(t.at);
    if (prev == null || ms - prev >= SAME_TAP) { kept.push(t); prev = ms; }
  }
  const ms = kept.map((t) => Date.parse(t.at));
  const n = kept.length;
  const oDay: (string | null)[] = new Array(n).fill(null);
  const oCode: (string | null)[] = new Array(n).fill(null);
  const oRole: (Role | null)[] = new Array(n).fill(null);
  const byCode = new Map(shifts.map((s) => [s.code, s]));

  let vCode: string | null = null;
  let picked = false;

  /* HRD's picks first. */
  const pickTo = addDayKey(date, 2);
  for (const pk of [...picks].sort((a, b) => a.work_date.localeCompare(b.work_date))) {
    if (pk.work_date < from || pk.work_date > pickTo) continue;
    const s = byCode.get(pk.shift_code);
    if (!s) continue;
    if (pk.work_date === date) { picked = true; vCode = pk.shift_code; }
    if (n === 0) continue;
    const st = shiftStartAt(pk.work_date, s);
    const en = shiftEndAt(pk.work_date, s);
    let i: number | null = null;
    for (let q = 0; q < n; q++) {
      if (oDay[q] != null || Math.abs(ms[q] - st) > NEAR) continue;
      if (i == null || Math.abs(ms[q] - st) < Math.abs(ms[i] - st)) i = q;
    }
    let j: number | null = null;
    for (let q = 0; q < n; q++) {
      if (oDay[q] != null || q === i || (i != null && ms[q] <= ms[i]) || Math.abs(ms[q] - en) > NEAR) continue;
      if (j == null || Math.abs(ms[q] - en) < Math.abs(ms[j] - en)) j = q;
    }
    if (i != null) { oDay[i] = pk.work_date; oCode[i] = pk.shift_code; oRole[i] = "in"; }
    if (j != null) { oDay[j] = pk.work_date; oCode[j] = pk.shift_code; oRole[j] = "out"; }
  }

  /* The rest, run by run, paired from the start. */
  let i = 0;
  while (i < n) {
    if (oDay[i] != null) { i++; continue; }
    const run = [i];
    let k = i;
    while (k + 1 < n && oDay[k + 1] == null && shiftLink(shifts, ms[k], ms[k + 1])) {
      k++;
      run.push(k);
    }
    let idx = 0;
    while (idx + 1 < run.length) {
      const lk = shiftLink(shifts, ms[run[idx]], ms[run[idx + 1]])!;
      oDay[run[idx]] = lk.day; oCode[run[idx]] = lk.code; oRole[run[idx]] = "in";
      oDay[run[idx + 1]] = lk.day; oCode[run[idx + 1]] = lk.code; oRole[run[idx + 1]] = "out";
      idx += 2;
    }
    if (idx === run.length - 1) {
      const last = run[idx];
      const r = shiftRole(shifts, ms[last]);
      const s = r ? byCode.get(r.code) : undefined;
      oDay[last] = r?.day ?? officeDayOf(ms[last]);
      oCode[last] = r?.code ?? null;
      oRole[last] = r?.role === "in" && last === n - 1 && s && now < shiftEndAt(r.day, s) + NEAR
        ? "open" : "lone";
    }
    i = k + 1;
  }

  /* What fell on the day asked about: a paired masuk and pulang first — the
     picked shift's before any other — and a tap on its own only when the day
     has neither. */
  const mine: number[] = [];
  for (let g = 0; g < n; g++) if (oDay[g] === date) mine.push(g);
  let vIn: number | null = null;
  let vOut: number | null = null;
  let status: ShiftStatus = "none";
  const pairedFirst = mine
    .filter((g) => oRole[g] === "in" || oRole[g] === "out")
    .sort((a, b) => {
      const pa = picked && oCode[a] === vCode ? 0 : 1;
      const pb = picked && oCode[b] === vCode ? 0 : 1;
      return pa - pb || a - b;
    });
  for (const g of pairedFirst) {
    if (oRole[g] === "in" && vIn == null && (vCode == null || oCode[g] === vCode)) {
      vIn = g; vCode = vCode ?? oCode[g];
    } else if (oRole[g] === "out" && vOut == null && (vCode == null || oCode[g] === vCode)) {
      vOut = g; vCode = vCode ?? oCode[g];
    }
  }
  if (vIn == null && vOut == null) {
    const g = mine.find((q) => oRole[q] === "open" || oRole[q] === "lone");
    if (g != null) {
      vIn = g; vCode = vCode ?? oCode[g];
      if (oRole[g] === "open") status = "open";
    }
  }
  if (vIn != null && vOut != null) status = "paired";
  else if (status !== "open" && (vIn != null || vOut != null)) status = "lone";

  const s = vCode ? byCode.get(vCode) : undefined;
  return {
    code: vCode,
    name: s?.name ?? null,
    in: vIn != null ? kept[vIn] : null,
    out: vOut != null ? kept[vOut] : null,
    start: s ? shiftStartAt(date, s) : null,
    end: s ? shiftEndAt(date, s) : null,
    taps: mine.map((g) => kept[g]),
    status,
    extra: mine.length - (vIn != null ? 1 : 0) - (vOut != null ? 1 : 0),
    picked,
  };
}
