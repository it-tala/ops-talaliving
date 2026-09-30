/** Reading a Job Order's entries three ways: **by whom, by day, by hour**
 *  (D346).
 *
 *  One implementation for both clients, the same arrangement as
 *  `work-order-view.ts`: the rows are `progress_entries` either way, and two
 *  copies of the arithmetic are how two screens start to disagree.
 *
 *  Three rules run through all of it.
 *
 *  - **Pieces are counted per stage and never added across stages.** Four
 *    chairs sanded and four finished is not eight of anything (F74, D264), so
 *    every figure here carries its stage.
 *  - **An entry with no hours is not given one.** It is counted in its day and
 *    listed apart as *jam tidak dicatat* — `recorded_at` is when the mandor
 *    typed it, and filing the afternoon's work under 17.00 would draw a spike
 *    that never happened.
 *  - **An hour is the hour the pieces were finished in.** A span 08.00–10.00
 *    with six pieces is filed under 09.00–10.00 and printed with its span;
 *    spreading six over two hours evenly is a number nobody counted.
 */
import { officeClock, officeStamp } from "@/lib/office";
import { attributionOf, type ProgressEntry, type WorkAttribution } from "./contracts";

const HOUR_MS = 3_600_000;

/** Minutes between the two ends, or null for an entry without hours. */
export function spanMinutes(e: Pick<ProgressEntry, "started_at" | "finished_at">): number | null {
  if (!e.started_at || !e.finished_at) return null;
  const m = (Date.parse(e.finished_at) - Date.parse(e.started_at)) / 60_000;
  return Number.isFinite(m) && m > 0 ? Math.round(m) : null;
}

/** *07.30–08.30* on the office clock, or null. */
export function spanLabel(e: Pick<ProgressEntry, "started_at" | "finished_at">): string | null {
  if (!e.started_at || !e.finished_at) return null;
  const dot = (iso: string) => officeClock(new Date(iso)).replace(":", ".");
  return `${dot(e.started_at)}–${dot(e.finished_at)}`;
}

/* ── by whom ──────────────────────────────────────────────────────────── */

export interface WorkerProgress {
  /** The employee's id where the entry is linked; otherwise the name as
   *  written, case-folded; `—` where nobody wrote a name. Two spellings of one
   *  unlinked name stay two rows — matching them is a person's job (D264). */
  key: string;
  name: string | null;
  employee_id: string | null;
  attribution: WorkAttribution | "none";
  stage: string;
  /** Net: corrections included, because a correction is part of what this
   *  person is recorded as having done. */
  qty: number;
  entries: number;
  first_day: string;
  last_day: string;
  /** Across the entries **with hours and a positive quantity** only. */
  timed_minutes: number;
  timed_qty: number;
  /** Pieces per hour at this stage, from the timed entries. Null when nothing
   *  was timed — not zero, which would read as *worked and made nothing*.
   *  Comparable between people only because it is one Job Order and one
   *  stage: the same piece, the same work (D264 forbids it across products). */
  per_hour: number | null;
}

function workerKey(e: ProgressEntry): string {
  if (e.worked_by_employee_id) return e.worked_by_employee_id;
  return e.worked_by?.trim().toLowerCase() || "—";
}

export function progressByWorker(entries: ProgressEntry[], stageOrder: string[] = []): WorkerProgress[] {
  const rows = new Map<string, WorkerProgress>();
  for (const e of entries) {
    const key = `${workerKey(e)}|${e.stage}`;
    let r = rows.get(key);
    if (!r) {
      r = {
        key: workerKey(e), name: e.worked_by, employee_id: e.worked_by_employee_id,
        attribution: e.worked_by ? attributionOf(e) : "none",
        stage: e.stage, qty: 0, entries: 0, first_day: e.work_date, last_day: e.work_date,
        timed_minutes: 0, timed_qty: 0, per_hour: null,
      };
      rows.set(key, r);
    }
    r.qty += e.qty;
    r.entries += 1;
    if (e.work_date < r.first_day) r.first_day = e.work_date;
    if (e.work_date > r.last_day) r.last_day = e.work_date;
    const m = spanMinutes(e);
    if (m !== null && e.qty > 0) { r.timed_minutes += m; r.timed_qty += e.qty; }
  }
  const seq = (s: string) => { const i = stageOrder.indexOf(s); return i < 0 ? 99 : i; };
  return [...rows.values()]
    .map((r) => ({ ...r, per_hour: r.timed_minutes > 0 ? Math.round((r.timed_qty / (r.timed_minutes / 60)) * 10) / 10 : null }))
    .sort((a, b) => seq(a.stage) - seq(b.stage) || b.qty - a.qty || (a.name ?? "").localeCompare(b.name ?? ""));
}

/* ── by day ───────────────────────────────────────────────────────────── */

export interface DayProgress {
  day: string;
  /** Net pieces reported that day, per stage. */
  stages: Record<string, number>;
  /** Running total per stage through the end of that day. */
  cumulative: Record<string, number>;
  workers: string[];
  entries: number;
  /** How many of the day's entries carry hours. */
  timed: number;
}

export function progressByDay(entries: ProgressEntry[]): DayProgress[] {
  const days = [...new Set(entries.map((e) => e.work_date))].sort();
  const run: Record<string, number> = {};
  return days.map((day) => {
    const on = entries.filter((e) => e.work_date === day);
    const stages: Record<string, number> = {};
    for (const e of on) {
      stages[e.stage] = (stages[e.stage] ?? 0) + e.qty;
      run[e.stage] = (run[e.stage] ?? 0) + e.qty;
    }
    return {
      day, stages, cumulative: { ...run },
      workers: [...new Set(on.map((e) => e.worked_by).filter((n): n is string => !!n))],
      entries: on.length,
      timed: on.filter((e) => spanMinutes(e) !== null).length,
    };
  });
}

/* ── by hour ──────────────────────────────────────────────────────────── */

export interface HourSlot<E extends ProgressEntry = ProgressEntry> {
  /** Hours since the office midnight of the day; 24 and above is past
   *  midnight on an overnight shift, which still belongs to the day it began. */
  index: number;
  /** *08.00–09.00*, with *(+1)* past midnight. */
  label: string;
  stages: Record<string, number>;
  /** Running total per stage through the end of this hour — the day's earlier
   *  work included, and what came before the day (`DayByHour.before`). */
  cumulative: Record<string, number>;
  workers: string[];
  entries: E[];
}

export interface DayByHour<E extends ProgressEntry = ProgressEntry> {
  day: string;
  /** Every hour from the first to the last with work in it, **empty hours
   *  included**: an hour with nothing finished is the thing a supervisor is
   *  looking for. */
  slots: HourSlot<E>[];
  /** Net per stage from every earlier day, so the hourly curve starts where
   *  the order actually stood that morning. */
  before: Record<string, number>;
  /** The day's entries without hours — counted, and not placed. */
  untimed: { stages: Record<string, number>; entries: E[] };
}

function hourLabel(index: number): string {
  const h = index % 24;
  const pad = (n: number) => String(n % 24).padStart(2, "0");
  return `${pad(h)}.00–${pad(h + 1)}.00${index >= 24 ? " (+1)" : ""}`;
}

export function progressByHour<E extends ProgressEntry>(entries: E[], day: string): DayByHour<E> {
  const midnight = Date.parse(officeStamp(day, "00:00"));
  const before: Record<string, number> = {};
  for (const e of entries) if (e.work_date < day) before[e.stage] = (before[e.stage] ?? 0) + e.qty;

  const on = entries.filter((e) => e.work_date === day);
  const untimed = { stages: {} as Record<string, number>, entries: [] as E[] };
  const byIndex = new Map<number, E[]>();
  for (const e of on) {
    if (!e.finished_at || spanMinutes(e) === null) {
      untimed.entries.push(e);
      untimed.stages[e.stage] = (untimed.stages[e.stage] ?? 0) + e.qty;
      continue;
    }
    /* The hour it finished in; a span ending exactly on the hour belongs to
       the hour before it (08.00–09.00 is the eight o'clock hour). */
    const idx = Math.max(0, Math.floor((Date.parse(e.finished_at) - 1 - midnight) / HOUR_MS));
    byIndex.set(idx, [...(byIndex.get(idx) ?? []), e]);
  }

  const slots: HourSlot<E>[] = [];
  if (byIndex.size > 0) {
    const idxs = [...byIndex.keys()];
    const run: Record<string, number> = { ...before };
    for (let i = Math.min(...idxs); i <= Math.max(...idxs); i++) {
      const es = (byIndex.get(i) ?? []).sort((a, b) => (a.finished_at ?? "").localeCompare(b.finished_at ?? ""));
      const stages: Record<string, number> = {};
      for (const e of es) {
        stages[e.stage] = (stages[e.stage] ?? 0) + e.qty;
        run[e.stage] = (run[e.stage] ?? 0) + e.qty;
      }
      slots.push({
        index: i, label: hourLabel(i), stages, cumulative: { ...run },
        workers: [...new Set(es.map((e) => e.worked_by).filter((n): n is string => !!n))],
        entries: es,
      });
    }
  }
  return { day, slots, before, untimed };
}

/** The days that have any entry, newest first — for a day picker. */
export function progressDays(entries: Pick<ProgressEntry, "work_date">[]): string[] {
  return [...new Set(entries.map((e) => e.work_date))].sort().reverse();
}
