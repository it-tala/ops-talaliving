/** Overtime cut by the clock (0244, D396) — the TypeScript twin of
 *  `ops_hr.ot_segments`, so the sandbox pays what the database pays.
 *
 *  From `from` to `until` (minutes of the office day; past midnight when the
 *  finish is not after the start), less the overtime break, cut at the night
 *  line. Each range is rounded on its own; ranges before the night line climb
 *  the day's ladder together, ranges past it take the night multiplier. */
import type { OvertimeTier, PayRules } from "./contracts";

export interface OvertimeSegment {
  seg_from: number;
  seg_until: number;
  hours: number;
  multiplier: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function overtimeSegments(rules: PayRules, rest: boolean, from: number, until: number): OvertimeSegment[] {
  const out: OvertimeSegment[] = [];
  const s = from;
  /* 0245 (D397): past midnight only when the finish is before noon; an
     afternoon finish before the start is no overtime at all. */
  if (until === from || (until < from && until >= 720)) return out;
  const e = until < from ? until + 1440 : until;
  const roundm = rules.overtime_rounding_minutes ?? 0;
  const nightAfter = rules.overtime_night_after_minutes != null && rules.overtime_night_multiplier != null
    ? rules.overtime_night_after_minutes : null;
  const nightMult = rules.overtime_night_multiplier ?? 0;
  const bf = rules.overtime_break_from_minutes ?? null;
  const bt = rules.overtime_break_to_minutes ?? null;
  const hasBreak = bf != null && bt != null && bt > bf;

  /* 0246 (D398): a rest day's lunch, after four hours of work. */
  const rb = rules.rest_break_minutes ?? 0;
  const rbf = rest && rb > 0 && e - s > 240 ? s + 240 : null;
  const rbt = rbf != null ? rbf + rb : null;

  const pts = new Set<number>([s, e]);
  if (rbf != null && rbt != null) {
    if (rbf < e) pts.add(rbf);
    if (rbt < e) pts.add(rbt);
  }
  for (const k of [0, 1]) {
    const add = (x: number | null) => { if (x != null && x + 1440 * k > s && x + 1440 * k < e) pts.add(x + 1440 * k); };
    add(nightAfter);
    if (hasBreak) { add(bf); add(bt); }
  }
  const cuts = [...pts].sort((a, b) => a - b);

  const tiers: OvertimeTier[] = rules.overtime_mode === "flat"
    ? [{ after_hours: 0, multiplier: rules.flat_multiplier }]
    : rest ? rules.restday_tiers : rules.workday_tiers;
  const ladder = [...tiers].sort((a, b) => a.after_hours - b.after_hours);

  let cum = 0;
  for (let i = 0; i < cuts.length - 1; i++) {
    const a = cuts[i]; const b = cuts[i + 1];
    if (hasBreak && ((a >= bf! && b <= bt!) || (a >= bf! + 1440 && b <= bt! + 1440))) continue;
    if (rbf != null && rbt != null && a >= rbf && b <= rbt) continue;
    let m = b - a;
    if (roundm > 0) m = Math.round(m / roundm) * roundm;
    if (m <= 0) continue;
    const h = m / 60;
    if (nightAfter != null && a >= nightAfter) {
      out.push({ seg_from: a % 1440, seg_until: b % 1440, hours: r2(h), multiplier: nightMult });
      continue;
    }
    ladder.forEach((t, j) => {
      const next = ladder[j + 1]?.after_hours ?? cum + h;
      const lo = Math.max(cum, t.after_hours);
      const hi = Math.min(cum + h, next);
      if (hi > lo) {
        out.push({
          seg_from: (a + Math.round(((lo - cum) / h) * (b - a))) % 1440,
          seg_until: (a + Math.round(((hi - cum) / h) * (b - a))) % 1440,
          hours: r2(hi - lo), multiplier: t.multiplier,
        });
      }
    });
    cum += h;
  }
  return out;
}

/** `17.15` — the database's `clock_face`. */
export function clockFace(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}.${String(minutes % 60).padStart(2, "0")}`;
}

/** `"17:15"` from an `<input type="time">`, or null. */
export function minutesOfClock(v: string): number | null {
  const m = /^(\d{1,2})[:.](\d{2})$/.exec(v.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
