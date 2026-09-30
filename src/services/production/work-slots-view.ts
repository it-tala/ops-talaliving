/** The two readings the owner asked the Job Order for (D352):
 *
 *  - **for the project manager** — *AA-02 · 10/100 · sanding 1 · finishing 2 ·
 *    complete 10*: where the pieces are, read off the stage counts;
 *  - **for productivity** — *who worked on what, how long an item took, whether
 *    people were productive, how many items one person can do*: read off the
 *    timeslots.
 *
 *  One implementation for both clients, like `work-order-view.ts`.
 *
 *  **How a crew's pieces are credited.** A slot of Karjo and Toha that
 *  finished 6 pieces in 2 hours is 4 person-hours for 6 pieces. Each of them is
 *  credited 3 — the pieces shared by the time each spent, and on one slot that
 *  time is the same for everybody on it. Nobody counted who sanded which
 *  three; this is the standard labour measure (pieces per person-hour), not a
 *  claim about individual hands, and the screen says so.
 *
 *  **Pieces are never added across stages or products** (F74, D264): every
 *  figure carries its stage, and a rate is only ever pieces of one stage per
 *  hour.
 */
import { STAGE_NAME, type ProgressEntry, type WorkOrderView, type WorkSlotView } from "./contracts";

/* ── the project manager's line ───────────────────────────────────────── */

export interface StagePosition {
  qty: number;
  /** Pieces past the order's last stage — finished. */
  complete: number;
  /** Pieces nothing has been reported on yet. */
  not_started: number;
  /** Pieces whose furthest stage is this one: past it, not yet past the next.
   *  The order's last stage is not listed — past it is `complete`. */
  at: { stage: string; name: string; count: number }[];
}

/** *10/100 · sanding 1 · finishing 2 · complete 10.* From the cumulative stage
 *  counts: past sanding and not past finishing is `done(sanding) −
 *  done(finishing)`. A stage nobody has ever reported on (Machinery on a
 *  table) is passed through rather than read as zero, as the board does
 *  (D275, F92). A later stage ahead of an earlier one is a typo the board
 *  already flags; the difference is not allowed to go negative here. */
export function stagePosition(wo: Pick<WorkOrderView, "qty" | "stages">): StagePosition {
  const last = wo.stages[wo.stages.length - 1];
  const read = wo.stages.filter((s) => s.recorded || s === last);
  const at: StagePosition["at"] = [];
  for (let i = 0; i < read.length - 1; i++) {
    at.push({ stage: read[i].stage, name: read[i].name, count: Math.max(0, read[i].done - read[i + 1].done) });
  }
  const complete = Math.max(0, last?.done ?? 0);
  const first = read[0]?.done ?? 0;
  return { qty: wo.qty, complete, not_started: Math.max(0, wo.qty - Math.max(first, complete)), at };
}

/* ── labour rows: slots, and the counts that never had one ────────────── */

export interface LabourRow {
  key: string;
  wo_no: string;
  item_name: string;
  work_date: string;
  started_at: string | null;
  finished_at: string | null;
  /** Null for a count reported without hours — labour nobody measured. */
  minutes: number | null;
  activity: string;
  stage: string | null;
  qty: number | null;
  /** `team` is a name somebody confirmed is *not one person* (D264) — only an
   *  old count can carry one; a slot lists its people. */
  workers: { name: string; employee_id: string | null; team?: boolean }[];
  from: "slot" | "entry";
}

/** Every live (not cancelled) slot, plus the counts reported **without** a slot
 *  — every entry before 0198, and those still typed on their own. Those carry
 *  no activity but their stage, and no minutes unless they had a span; they
 *  are here so a person's older work does not vanish from their row. Counts a
 *  slot posted are skipped: the slot already carries them. */
export function labourRows(
  slots: WorkSlotView[],
  entries: (ProgressEntry & { wo_no?: string; item_name?: string })[] = [],
  wo?: { wo_no: string; item_name: string },
): LabourRow[] {
  const rows: LabourRow[] = slots.filter((s) => !s.voided_at).map((s) => ({
    key: s.slot_no, wo_no: s.wo_no, item_name: s.item_name, work_date: s.work_date,
    started_at: s.started_at, finished_at: s.finished_at, minutes: s.minutes,
    activity: s.activity, stage: s.stage, qty: s.qty, workers: s.workers, from: "slot",
  }));
  for (const e of entries) {
    if (e.slot_id) continue;
    const m = e.started_at && e.finished_at ? Math.round((Date.parse(e.finished_at) - Date.parse(e.started_at)) / 60_000) : null;
    rows.push({
      key: e.id, wo_no: e.wo_no ?? wo?.wo_no ?? "", item_name: e.item_name ?? wo?.item_name ?? "",
      work_date: e.work_date, started_at: e.started_at, finished_at: e.finished_at,
      minutes: m && m > 0 ? m : null, activity: STAGE_NAME(e.stage), stage: e.stage, qty: e.qty,
      workers: e.worked_by ? [{ name: e.worked_by, employee_id: e.worked_by_employee_id, team: e.worked_by_not_a_person }] : [],
      from: "entry",
    });
  }
  return rows.sort((a, b) => a.work_date.localeCompare(b.work_date)
    || (a.started_at ?? "~").localeCompare(b.started_at ?? "~"));
}

/* ── per person ───────────────────────────────────────────────────────── */

export interface PersonProductivity {
  key: string;
  name: string;
  employee_id: string | null;
  team: boolean;
  /** Minutes on the rows that had a duration. */
  minutes: number;
  /** Rows this person is on with no duration — counted, not timed. */
  untimed: number;
  slots: number;
  jobs: string[];
  activities: string[];
  /** Pieces credited, per stage: a crew's pieces shared equally (see top). */
  pieces: Record<string, number>;
  /** Pieces per hour, per stage, from the timed rows with pieces only. */
  per_hour: Record<string, number>;
}

const personKey = (w: { name: string; employee_id: string | null }) => w.employee_id ?? `name:${w.name.trim().toLowerCase()}`;
const round1 = (n: number) => Math.round(n * 10) / 10;

export function productivityByPerson(rows: LabourRow[]): PersonProductivity[] {
  const people = new Map<string, PersonProductivity & { _timedPieces: Record<string, number>; _timedMin: Record<string, number> }>();
  for (const r of rows) {
    const n = r.workers.length;
    for (const w of r.workers) {
      const k = personKey(w);
      let p = people.get(k);
      if (!p) {
        p = {
          key: k, name: w.name, employee_id: w.employee_id, team: !!w.team, minutes: 0, untimed: 0, slots: 0,
          jobs: [], activities: [], pieces: {}, per_hour: {}, _timedPieces: {}, _timedMin: {},
        };
        people.set(k, p);
      }
      p.slots += 1;
      if (r.minutes !== null) p.minutes += r.minutes; else p.untimed += 1;
      if (!p.jobs.includes(r.wo_no)) p.jobs.push(r.wo_no);
      if (!p.activities.includes(r.activity)) p.activities.push(r.activity);
      if (r.stage && r.qty) {
        const share = r.qty / n;
        p.pieces[r.stage] = (p.pieces[r.stage] ?? 0) + share;
        if (r.minutes !== null && r.qty > 0) {
          p._timedPieces[r.stage] = (p._timedPieces[r.stage] ?? 0) + share;
          p._timedMin[r.stage] = (p._timedMin[r.stage] ?? 0) + r.minutes;
        }
      }
    }
  }
  return [...people.values()].map(({ _timedPieces, _timedMin, ...p }) => ({
    ...p,
    pieces: Object.fromEntries(Object.entries(p.pieces).map(([s, v]) => [s, round1(v)])),
    per_hour: Object.fromEntries(Object.entries(_timedPieces)
      .filter(([s]) => _timedMin[s] > 0)
      .map(([s, v]) => [s, round1(v / (_timedMin[s] / 60))])),
  })).sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name));
}

/* ── per Job Order ────────────────────────────────────────────────────── */

export interface JobLabour {
  /** Sum over rows of minutes × people on it. */
  person_minutes: number;
  people: number;
  slots: number;
  first_day: string | null;
  last_day: string | null;
  /** Rows with no duration, whose labour is therefore not in the total. */
  untimed: number;
  /** Person-minutes per finished piece, once anything is finished. Includes
   *  every activity on the order, not only the ones that moved a count —
   *  *tambah engsel* is part of what one chair costs. */
  per_complete: number | null;
}

export function jobLabour(rows: LabourRow[], complete: number): JobLabour {
  const people = new Set<string>();
  let pm = 0, untimed = 0;
  for (const r of rows) {
    r.workers.forEach((w) => people.add(personKey(w)));
    if (r.minutes === null) untimed += 1; else pm += r.minutes * Math.max(1, r.workers.length);
  }
  const days = rows.map((r) => r.work_date).sort();
  return {
    person_minutes: pm, people: people.size, slots: rows.length,
    first_day: days[0] ?? null, last_day: days[days.length - 1] ?? null, untimed,
    per_complete: complete > 0 && pm > 0 ? Math.round(pm / complete) : null,
  };
}

/** *3 j 30 mnt*, or *3 h 30 min*. */
export function durationLabel(minutes: number, hUnit = "j", mUnit = "mnt"): string {
  const h = Math.floor(minutes / 60), m = Math.round(minutes % 60);
  if (h === 0) return `${m} ${mUnit}`;
  return m === 0 ? `${h} ${hUnit}` : `${h} ${hUnit} ${m} ${mUnit}`;
}
