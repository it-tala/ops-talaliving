/** What a working pattern is allowed to say — one statement of the rule.
 *
 *  ## Why this file has no imports
 *
 *  Until now the schedule rows were seeded by a migration and shown read-only,
 *  so the only thing that could put a bad one in the rule book was somebody
 *  writing SQL by hand. Making them editable from `/it/aturan-gaji` changes
 *  that: a code becomes something a person types, and `employees.schedule_code`
 *  is a **text key into versioned JSON**, so there is no foreign key that can
 *  catch a typo or a deleted row. The rule has to be written down somewhere.
 *
 *  It is written down twice, because it has to be (ADR-009): once here for the
 *  demo client, once in `ops_hr.schedule_problem()` for the real one. Two
 *  statements of one rule is exactly the drift `check-clause-fields.mjs` exists
 *  to refuse, so this one is refused the same way — `check-schedule-rules.mjs`
 *  runs `SCHEDULE_CASES` through both and compares the answers.
 *
 *  That check needs to execute this module in plain node, which is why this
 *  file imports nothing at all and declares its own shapes. Keep it that way:
 *  the moment it needs `@/…`, the parity gate needs a bundler and stops being
 *  something anybody runs.
 *
 *  ## What is deliberately not here
 *
 *  **Whether a pattern is still in use.** Removing `PRODUKSI` while three
 *  people are on it is the worst thing this screen can do — they do not fall
 *  back to anything, they simply stop having hours, and `schedule_roll()` stops
 *  listing them because their `schedule_code` is neither null nor found. That
 *  is a real rule and it is refused, but it needs to read the roster, so it
 *  lives beside the data in each seam rather than in this pure function.
 */

/** One working pattern (Q44, D274), in the shape it has inside
 *  `rules.schedules`. `contracts.ts` re-exports this as `WorkSchedule` rather
 *  than restating it — one shape in one place beats two that a checker has to
 *  keep level. What matters about it:
 *
 *  - **`start_minutes` is nullable.** The guard works twelve hours and nobody
 *    has said from when. A schedule with no start cannot measure lateness, and
 *    that reads as *tidak terukur* with the reason — never as *never late*,
 *    which is the error Q44 was raised about in the first place (F70).
 *  - **`end_minutes` is nullable** for the same reason and separately: 07.30
 *    to 16.30 is nine hours with 45 minutes out of it; 08.00 to 17.15 is nine
 *    and a quarter with an hour. Those are the same working day by different
 *    arithmetic, and neither can be derived from the other.
 *  - **Friday has its own break and its own finishing time** (Q54, D289). The
 *    break was here first and it was not enough: the office works 08.00–17.15
 *    on four days and goes home at 16.30 on Friday. Both are null where Friday
 *    is an ordinary day, and each falls back **on its own** to the ordinary
 *    value, because a Friday that differs in one respect still has the other
 *    from the rest of the week.
 */
export interface ScheduleShape {
  /** The key. `employees.schedule_code` and `schedule_by_unit` both point at a
   *  pattern by this text, across a seam, in a document with no referential
   *  integrity — so its shape is checked rather than assumed. */
  code: string;
  name: string;
  /** Minutes from midnight. Null where nobody has stated it. */
  start_minutes: number | null;
  end_minutes: number | null;
  break_minutes: number | null;
  /** Friday's break where it differs. Null = Friday takes `break_minutes`. */
  friday_break_minutes: number | null;
  /** Friday's finishing time where it differs. Null = Friday takes
   *  `end_minutes` — not *nobody has said*. */
  friday_end_minutes: number | null;
  /** What is known about it that the numbers do not say — a twelve-hour shift
   *  that may or may not rotate, an end time nobody has fixed. */
  note: string | null;
  /** The start, end and break are a **default nobody has confirmed** (D288,
   *  D330). The guard's 19.00–07.00 is the one today: the owner said twelve
   *  hours across midnight and never said from when. Absent and `false` mean
   *  the same — somebody stated these hours. HRD saving them clears it. */
  hours_unconfirmed?: boolean;
  /** One weekday's own hours and worth, by ISO weekday "1" (Senin) … "7"
   *  (Minggu) — D340. A weekday not listed takes the pattern's hours (and
   *  Friday its Friday ones). Transcribes `ops_hr.schedule_day()`. */
  days?: Record<string, ScheduleDay> | null;
  /** The shifts somebody on this pattern may work, read off their taps (D364)
   *  — Satpam's Shift 1 07.00–17.00 and Shift 2 17.00–07.00, given out in no
   *  fixed order. Absent or empty: the pattern is one working day, as before.
   *  Transcribes the `shifts` key `ops_hr.shift_reading()` reads. */
  shifts?: ScheduleShift[] | null;
}

/** One shift on a pattern (D364). An end not after its start ends the next
 *  morning. One shift is one day of pay, whichever it is. */
export interface ScheduleShift {
  /** Short, upper case — what the timesheet cell shows: `S1`, `S2`. */
  code: string;
  name: string;
  start_minutes: number;
  end_minutes: number;
  /** None for Satpam. Absent = none. */
  break_minutes?: number | null;
}

/** One weekday on a pattern (D340). Every field optional: what is not said
 *  falls back to the pattern. */
export interface ScheduleDay {
  start_minutes?: number | null;
  end_minutes?: number | null;
  break_minutes?: number | null;
  /** What a day worked on this weekday is worth, in days of pay. 2 for
   *  Sabtu and Minggu at the workshop (owner: *hitung 2×*). Default 1. */
  pay_multiplier?: number | null;
  /** Not a working day on this pattern. */
  off?: boolean | null;
}

/** One weekday as the reading will see it (D340) — `schedule_roll().week`. */
export interface ScheduleWeekDay {
  isodow: number;
  start_minutes: number | null;
  end_minutes: number | null;
  break_minutes: number | null;
  pay_multiplier: number;
  off: boolean;
  /** Set on the pattern itself, rather than taken from its ordinary hours. */
  own: boolean;
  hours: number | null;
}

/** The seven days of a pattern, Senin first — what `schedule_roll()` builds. */
export function scheduleWeek(sc: ScheduleShape): ScheduleWeekDay[] {
  return [1, 2, 3, 4, 5, 6, 7].map((d) => {
    const x = scheduleDay(sc, d)!;
    const hours = x.off || x.start_minutes == null || x.end_minutes == null
      ? null
      : Math.round(((shiftMinutes(x.start_minutes, x.end_minutes) ?? 0) - (x.break_minutes ?? 0)) / 60 * 100) / 100;
    return {
      isodow: d, start_minutes: x.start_minutes, end_minutes: x.end_minutes,
      break_minutes: x.break_minutes, pay_multiplier: x.pay_multiplier, off: x.off,
      own: sc.days?.[String(d)] != null, hours,
    };
  });
}

export const WEEKDAY_NAMES = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"] as const;

/** What one weekday is on a pattern — `ops_hr.schedule_day()`. `isodow` is
 *  1 (Senin) … 7 (Minggu). */
export function scheduleDay(sc: ScheduleShape | null, isodow: number): {
  start_minutes: number | null; end_minutes: number | null; break_minutes: number | null;
  pay_multiplier: number; off: boolean;
} | null {
  if (!sc) return null;
  const fri = isodow === 5;
  const base = {
    start_minutes: sc.start_minutes,
    end_minutes: fri ? (sc.friday_end_minutes ?? sc.end_minutes) : sc.end_minutes,
    break_minutes: fri ? (sc.friday_break_minutes ?? sc.break_minutes) : sc.break_minutes,
    pay_multiplier: 1,
    off: false,
  };
  const d = sc.days?.[String(isodow)];
  if (!d) return base;
  return {
    start_minutes: d.start_minutes ?? base.start_minutes,
    end_minutes: d.end_minutes ?? base.end_minutes,
    break_minutes: d.break_minutes ?? base.break_minutes,
    pay_multiplier: d.pay_multiplier ?? 1,
    off: d.off ?? false,
  };
}

/** A refusal, in the two parts a seam needs: a code the client can branch on
 *  and a sentence a person can act on. */
export interface ScheduleProblem {
  code: string;
  message: string;
}

const MINUTES_IN_DAY = 24 * 60;

/** Codes are keys. `employees.schedule_code` and `schedule_by_unit` both point
 *  at one by text, across a seam, in a document with no referential integrity
 *  (ADR-004's reason, in a place ADR-004 did not reach). Lower case and spaces
 *  are how two rows that look the same stop matching. */
const CODE_SHAPE = /^[A-Z][A-Z0-9_-]*$/;

/** A shift's code is what a timesheet cell shows (`S1`, `S2`), so it may start
 *  with a digit; the rest is `CODE_SHAPE`'s reasoning (D364). */
const SHIFT_CODE_SHAPE = /^[A-Z0-9][A-Z0-9_-]*$/;

/** Minutes from start to end, walking forward through midnight when the end
 *  is earlier on the clock (D330). Null when either is unstated — a shift
 *  nobody has described has no length, not a length of zero. Transcribes
 *  `ops_hr.shift_minutes()`. */
export function shiftMinutes(start: number | null, end: number | null): number | null {
  if (start == null || end == null) return null;
  return end > start ? end - start : end + MINUTES_IN_DAY - start;
}

/** Hours of one shift: its length less its break (D364). */
export function shiftHours(sh: ScheduleShift): number {
  return Math.max((shiftMinutes(sh.start_minutes, sh.end_minutes) ?? 0) - (sh.break_minutes ?? 0), 0) / 60;
}

/** A pattern with shifts works one shift a day, and which one is read off the
 *  taps (D364) — so its day, week and month are a range from the shortest
 *  shift to the longest, over the weekdays it works. Null with no shifts. */
export function shiftRange(
  shifts: ScheduleShift[] | null | undefined,
  workingDays: number,
): { daily: [number, number]; weekly: [number, number]; monthly: [number, number] } | null {
  if (!shifts || shifts.length === 0) return null;
  const each = shifts.map(shiftHours);
  const lo = Math.min(...each), hi = Math.max(...each);
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return {
    daily: [r2(lo), r2(hi)],
    weekly: [r2(lo * workingDays), r2(hi * workingDays)],
    monthly: [r2(lo * workingDays * 52 / 12), r2(hi * workingDays * 52 / 12)],
  };
}

/** *Any pattern whose end is before its start is overnight* — the whole
 *  definition (D330). Equal is not overnight; it is refused. */
export function isOvernight(sc: Pick<ScheduleShape, "start_minutes" | "end_minutes"> | null): boolean {
  return sc != null && sc.start_minutes != null && sc.end_minutes != null
    && sc.end_minutes < sc.start_minutes;
}

/** Where the next working day begins for somebody on this pattern, in minutes
 *  after midnight: 0 for an ordinary pattern, and for a night the middle of the
 *  off-duty gap — 13.00 for 19.00–07.00. A tap before it is still last night.
 *  Transcribes `ops_hr.day_boundary_minutes()`. */
export function dayBoundaryMinutes(sc: Pick<ScheduleShape, "start_minutes" | "end_minutes"> | null): number {
  if (!sc || !isOvernight(sc)) return 0;
  return Math.floor(((sc.end_minutes as number) + (sc.start_minutes as number)) / 2);
}

function clockOf(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}.${String(m % 60).padStart(2, "0")}`;
}

/** Null is an answer here, so only a stated value is checked. */
function badMinutes(v: number | null): boolean {
  if (v === null || v === undefined) return false;
  return !Number.isInteger(v) || v < 0 || v > MINUTES_IN_DAY;
}

/** Every problem with a candidate rule book's patterns, in a fixed order.
 *
 *  Fixed order matters: the seams report the **first** one, and a demo that
 *  reported a different first problem than the database would be two systems
 *  disagreeing about the same form (ADR-009). Row order first, then the checks
 *  within a row from *is it identifiable* to *does its arithmetic work*,
 *  because naming the row is useless if the row has no usable name.
 */
export function scheduleProblems(
  schedules: ScheduleShape[],
  scheduleByUnit: Record<string, string>,
): ScheduleProblem[] {
  const out: ScheduleProblem[] = [];
  const seen = new Set<string>();

  schedules.forEach((sc, i) => {
    /* Named by its code once it has one, by its position until then — a
       message about "pola ke-3" is the only thing that can be said about a row
       whose identifier is the broken part. */
    const code = typeof sc.code === "string" ? sc.code.trim() : "";
    const where = code === "" ? `Pola ke-${i + 1}` : `Pola ${code}`;

    if (code === "") {
      out.push({ code: "code_required", message: `${where} belum punya kode.` });
    } else if (!CODE_SHAPE.test(code)) {
      out.push({
        code: "code_shape",
        message: `${where}: kode dipakai sebagai kunci di data karyawan, jadi hanya huruf besar, angka, garis bawah dan tanda hubung, diawali huruf.`,
      });
    } else if (seen.has(code)) {
      out.push({
        code: "code_duplicate",
        message: `${where} muncul dua kali. Dua pola dengan kode sama berarti orang yang terpasang padanya bisa terbaca sebagai salah satu dari keduanya.`,
      });
    }
    if (code !== "") seen.add(code);

    if (typeof sc.name !== "string" || sc.name.trim() === "") {
      out.push({ code: "name_required", message: `${where} belum punya nama.` });
    }

    const fields: [keyof ScheduleShape, string][] = [
      ["start_minutes", "jam masuk"],
      ["end_minutes", "jam pulang"],
      ["break_minutes", "istirahat"],
      ["friday_break_minutes", "istirahat Jumat"],
      ["friday_end_minutes", "jam pulang Jumat"],
    ];
    for (const [key, label] of fields) {
      if (badMinutes(sc[key] as number | null)) {
        out.push({
          code: "minutes_range",
          message: `${where}: ${label} harus menit dalam sehari (0–1440) atau dikosongkan.`,
        });
      }
    }

    const st = sc.start_minutes, en = sc.end_minutes, br = sc.break_minutes;
    const fen = sc.friday_end_minutes, fbr = sc.friday_break_minutes;
    /* Only stated, in-range values take part in the arithmetic; a bad one has
       already been reported above, and the SQL side never gets this far with
       one because it returns on the first problem. */
    const ok = (v: number | null): v is number => v != null && !badMinutes(v);

    /* Equal is a pattern with no length. An end earlier on the clock is a
       night (D330) and no longer a mistake. */
    if (ok(st) && ok(en) && en === st) {
      out.push({
        code: "end_before_start",
        message: `${where}: pulang ${clockOf(en)} tidak sesudah masuk ${clockOf(st)}.`,
      });
    }
    const night = ok(st) && ok(en) && en < st;
    const span = ok(st) && ok(en) && en !== st ? shiftMinutes(st, en) : null;

    /* A break that eats the whole day leaves nought hours, and nought hours is
       not a schedule — it is a row that will quietly value every day at zero
       for whoever is on it. */
    if (span != null && br != null && br >= span) {
      out.push({
        code: "break_too_long",
        message: `${where}: istirahat ${br} menit menghabiskan seluruh hari kerja ${clockOf(st as number)}–${clockOf(en as number)}.`,
      });
    }

    /* A night's Friday ends on Saturday morning. A field that means *Friday
       16.30* for the office cannot also mean *Saturday 05.00* for the guard
       without somebody deciding it does, so it is refused rather than read. */
    if (night && fen != null) {
      out.push({
        code: "overnight_friday_end",
        message: `${where}: shift ini melewati tengah malam, jadi jam pulang Jumat belum bisa diatur — kosongkan; shift Jumat malam pulang pada jam pulang biasa.`,
      });
    }
    if (!night && ok(st) && ok(fen) && fen <= st) {
      out.push({
        code: "friday_end_before_start",
        message: `${where}: pulang Jumat ${clockOf(fen)} tidak sesudah masuk ${clockOf(st)}.`,
      });
    }
    /* Friday's two halves fall back independently (D289), so its arithmetic has
       to be checked on the pair it will actually be computed from. */
    const fEnd = fen ?? en;
    const fBreak = fbr ?? br;
    const fSpan = night ? span : st != null && fEnd != null && fEnd > st ? fEnd - st : null;
    if (fSpan != null && fBreak != null && fBreak >= fSpan) {
      out.push({
        code: "friday_break_too_long",
        message: `${where}: istirahat Jumat ${fBreak} menit menghabiskan seluruh hari Jumat ${clockOf(st as number)}–${clockOf(fEnd as number)}.`,
      });
    }

    /* The weekdays (D340), in key order, each from *is it a day* to *does its
       arithmetic work*. The sentences are `ops_hr.schedule_problem()`'s. */
    const days = sc.days;
    if (days != null && (typeof days !== "object" || Array.isArray(days))) {
      out.push({
        code: "days_shape",
        message: `${where}: jadwal per hari harus berupa daftar hari 1 (Senin) sampai 7 (Minggu).`,
      });
    } else if (days != null) {
      for (const key of Object.keys(days).sort()) {
        if (!/^[1-7]$/.test(key)) {
          out.push({ code: "day_key", message: `${where}: hari "${key}" tidak dikenal — pakai 1 (Senin) sampai 7 (Minggu).` });
          continue;
        }
        const dv = days[key];
        const dn = WEEKDAY_NAMES[Number(key) - 1];
        if (dv == null || typeof dv !== "object" || Array.isArray(dv)) {
          out.push({ code: "day_shape", message: `${where}: ${dn} harus berisi jam masuk, jam pulang dan istirahat, atau libur.` });
          continue;
        }
        if (dv.off) continue;
        const dayFields: [keyof ScheduleDay, string][] = [
          ["start_minutes", "jam masuk"], ["end_minutes", "jam pulang"], ["break_minutes", "istirahat"],
        ];
        for (const [k, label] of dayFields) {
          if (badMinutes((dv[k] as number | null | undefined) ?? null)) {
            out.push({ code: "minutes_range", message: `${where}: ${label} ${dn} harus menit dalam sehari (0–1440) atau dikosongkan.` });
          }
        }
        const m = dv.pay_multiplier;
        if (m !== undefined && m !== null && (typeof m !== "number" || !(m > 0) || m > 5)) {
          out.push({ code: "day_multiplier", message: `${where}: pengali upah ${dn} harus angka lebih dari 0 dan paling banyak 5.` });
        }
        const dSt = dv.start_minutes ?? st;
        const dEn = dv.end_minutes ?? (key === "5" ? (fen ?? en) : en);
        const dBr = dv.break_minutes ?? (key === "5" ? (fbr ?? br) : br);
        if (ok(dSt) && ok(dEn) && dEn === dSt) {
          out.push({ code: "day_end_before_start", message: `${where}: pulang ${dn} ${clockOf(dEn)} tidak sesudah masuk ${clockOf(dSt)}.` });
        }
        const dSpan = ok(dSt) && ok(dEn) && dEn !== dSt ? shiftMinutes(dSt, dEn) : null;
        if (dSpan != null && dBr != null && dBr >= dSpan) {
          out.push({ code: "day_break_too_long", message: `${where}: istirahat ${dn} ${dBr} menit menghabiskan seluruh hari ${clockOf(dSt as number)}–${clockOf(dEn as number)}.` });
        }
      }
    }

    /* The shifts (D364), in list order, each from *is it a shift* to *does
       its arithmetic work*. The sentences are `ops_hr.schedule_problem()`'s. */
    const shifts = sc.shifts as unknown;
    if (Array.isArray(shifts)) {
      if (shifts.length > 6) {
        out.push({ code: "shifts_too_many", message: `${where}: paling banyak 6 shift dalam satu pola.` });
      }
      const seenShift = new Set<string>();
      shifts.forEach((raw: unknown, j: number) => {
        const n = j + 1;
        if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
          out.push({ code: "shift_shape", message: `${where}: shift ke-${n} harus berisi kode, nama, jam masuk dan jam pulang.` });
          return;
        }
        const sh = raw as Partial<ScheduleShift>;
        const sCode = typeof sh.code === "string" ? sh.code.trim() : "";
        const sWhere = sCode === "" ? `shift ke-${n}` : `shift ${sCode}`;
        if (sCode === "") {
          out.push({ code: "shift_code", message: `${where}: shift ke-${n} belum punya kode.` });
        } else if (!SHIFT_CODE_SHAPE.test(sCode)) {
          out.push({ code: "shift_code", message: `${where}: kode shift ${sCode} hanya huruf besar, angka, garis bawah dan tanda hubung.` });
        } else if (seenShift.has(sCode)) {
          out.push({ code: "shift_code_duplicate", message: `${where}: shift ${sCode} muncul dua kali.` });
        }
        if (sCode !== "") seenShift.add(sCode);
        if (typeof sh.name !== "string" || sh.name.trim() === "") {
          out.push({ code: "shift_name", message: `${where}: ${sWhere} belum punya nama.` });
        }
        const sSt = sh.start_minutes ?? null, sEn = sh.end_minutes ?? null, sBr = sh.break_minutes ?? null;
        if (sSt == null || badMinutes(sSt) || sEn == null || badMinutes(sEn)) {
          out.push({ code: "shift_minutes", message: `${where}: jam masuk dan jam pulang ${sWhere} harus menit dalam sehari (0–1440).` });
          return;
        }
        if (badMinutes(sBr)) {
          out.push({ code: "minutes_range", message: `${where}: istirahat ${sWhere} harus menit dalam sehari (0–1440) atau dikosongkan.` });
          return;
        }
        if (sEn === sSt) {
          out.push({ code: "shift_end_before_start", message: `${where}: pulang ${sWhere} ${clockOf(sEn)} tidak sesudah masuk ${clockOf(sSt)}.` });
          return;
        }
        const sSpan = shiftMinutes(sSt, sEn) as number;
        if (sBr != null && sBr >= sSpan) {
          out.push({ code: "shift_break", message: `${where}: istirahat ${sWhere} ${sBr} menit menghabiskan seluruh shift ${clockOf(sSt)}–${clockOf(sEn)}.` });
        }
      });
    } else if (shifts != null) {
      out.push({ code: "shifts_shape", message: `${where}: daftar shift harus berupa daftar.` });
    }
  });

  /* A unit pointing at a pattern that is not there is worse than a unit
     pointing at nothing: nothing falls back to the company clock and says so,
     while a dangling code resolves to no schedule at all and reads as
     *belum ditetapkan* for everybody in that unit, with no sign of why. */
  /* `.sort()` is code-unit order, and the SQL side pins itself to `collate
     "C"` to match it. Not cosmetic: `en_US.UTF-8` orders `office` before
     `Workshop` where this puts `Workshop` first, so with two dangling units
     the two seams would name different ones (F143). */
  for (const unit of Object.keys(scheduleByUnit ?? {}).sort()) {
    const wanted = scheduleByUnit[unit];
    if (!seen.has(wanted)) {
      out.push({
        code: "unit_unknown_code",
        message: `Unit ${unit} dipasang ke pola ${wanted}, dan pola itu tidak ada di daftar.`,
      });
    }
  }

  return out;
}

/** The first problem, or null. What both seams report. */
export function scheduleProblem(
  schedules: ScheduleShape[],
  scheduleByUnit: Record<string, string>,
): ScheduleProblem | null {
  return scheduleProblems(schedules, scheduleByUnit)[0] ?? null;
}

/** The battery both implementations are held to.
 *
 *  Every case names the answer it expects, so the fixture is the specification
 *  and neither implementation is the reference for the other. A case with
 *  `expect: null` is as load-bearing as the rest: most of the ways this could
 *  go wrong are a check that fires on something perfectly ordinary.
 */
export interface ScheduleCase {
  name: string;
  schedules: ScheduleShape[];
  schedule_by_unit: Record<string, string>;
  expect: string | null;
}

/** Satpam's two shifts as the owner gave them (D364): 07.00–17.00 and
 *  17.00–07.00, no break. */
export const SATPAM_SHIFTS: ScheduleShift[] = [
  { code: "S1", name: "Shift 1", start_minutes: 420, end_minutes: 1020, break_minutes: 0 },
  { code: "S2", name: "Shift 2", start_minutes: 1020, end_minutes: 420, break_minutes: 0 },
];

export const SCHEDULE_CASES: ScheduleCase[] = (() => {
  const sc = (o: Partial<ScheduleShape>): ScheduleShape => ({
    code: "KANTOR", name: "Kantor",
    start_minutes: 480, end_minutes: 1035, break_minutes: 60,
    friday_break_minutes: 90, friday_end_minutes: 990, note: null, ...o,
  });
  const cases: ScheduleCase[] = [
    { name: "pola yang benar", schedules: [sc({})], schedule_by_unit: { Office: "KANTOR" }, expect: null },
    { name: "tidak ada pola sama sekali", schedules: [], schedule_by_unit: {}, expect: null },
    /* Jumat kosong dua-duanya: hari biasa, bukan cacat. */
    { name: "tanpa aturan Jumat", schedules: [sc({ friday_break_minutes: null, friday_end_minutes: null })], schedule_by_unit: {}, expect: null },
    /* Satpam: jam belum ditetapkan, dan itu sah (D274). */
    { name: "jam belum ditetapkan", schedules: [sc({ code: "SATPAM", name: "Satpam", start_minutes: null, end_minutes: null, break_minutes: null, friday_break_minutes: null, friday_end_minutes: null })], schedule_by_unit: {}, expect: null },
    { name: "kode kosong", schedules: [sc({ code: "  " })], schedule_by_unit: {}, expect: "code_required" },
    { name: "kode huruf kecil", schedules: [sc({ code: "kantor" })], schedule_by_unit: {}, expect: "code_shape" },
    { name: "kode berspasi", schedules: [sc({ code: "KANTOR PUSAT" })], schedule_by_unit: {}, expect: "code_shape" },
    { name: "kode diawali angka", schedules: [sc({ code: "2KANTOR" })], schedule_by_unit: {}, expect: "code_shape" },
    { name: "kode bertanda hubung diterima", schedules: [sc({ code: "SHIFT-MALAM" })], schedule_by_unit: {}, expect: null },
    { name: "tanda hubung tidak memaafkan huruf kecil", schedules: [sc({ code: "shift-malam" })], schedule_by_unit: {}, expect: "code_shape" },
    { name: "kode kembar", schedules: [sc({}), sc({ name: "Kantor lagi" })], schedule_by_unit: {}, expect: "code_duplicate" },
    { name: "nama kosong", schedules: [sc({ name: "" })], schedule_by_unit: {}, expect: "name_required" },
    { name: "menit di luar sehari", schedules: [sc({ start_minutes: 1441 })], schedule_by_unit: {}, expect: "minutes_range" },
    { name: "menit negatif", schedules: [sc({ break_minutes: -1 })], schedule_by_unit: {}, expect: "minutes_range" },
    { name: "menit pecahan", schedules: [sc({ end_minutes: 1035.5 })], schedule_by_unit: {}, expect: "minutes_range" },
    /* Sejak D330 pulang yang lebih awal di jam dinding adalah shift malam, bukan
       salah ketik: 10.00–09.00 adalah malam 23 jam dan sah bentuknya. */
    { name: "pulang sebelum masuk = lewat tengah malam", schedules: [sc({ start_minutes: 600, end_minutes: 540, friday_end_minutes: null })], schedule_by_unit: {}, expect: null },
    { name: "satpam 19.00–07.00", schedules: [sc({ code: "SATPAM", name: "Satpam", start_minutes: 1140, end_minutes: 420, break_minutes: 0, friday_break_minutes: null, friday_end_minutes: null, hours_unconfirmed: true })], schedule_by_unit: {}, expect: null },
    { name: "istirahat menghabiskan malam", schedules: [sc({ code: "SATPAM", name: "Satpam", start_minutes: 1140, end_minutes: 420, break_minutes: 720, friday_break_minutes: null, friday_end_minutes: null })], schedule_by_unit: {}, expect: "break_too_long" },
    { name: "malam dengan jam pulang Jumat", schedules: [sc({ code: "SATPAM", name: "Satpam", start_minutes: 1140, end_minutes: 420, break_minutes: 0, friday_break_minutes: null, friday_end_minutes: 300 })], schedule_by_unit: {}, expect: "overnight_friday_end" },
    { name: "istirahat Jumat menghabiskan malam Jumat", schedules: [sc({ code: "SATPAM", name: "Satpam", start_minutes: 1140, end_minutes: 420, break_minutes: 0, friday_break_minutes: 720, friday_end_minutes: null })], schedule_by_unit: {}, expect: "friday_break_too_long" },
    { name: "pulang sama dengan masuk", schedules: [sc({ start_minutes: 600, end_minutes: 600 })], schedule_by_unit: {}, expect: "end_before_start" },
    { name: "istirahat menghabiskan hari", schedules: [sc({ start_minutes: 480, end_minutes: 1035, break_minutes: 555 })], schedule_by_unit: {}, expect: "break_too_long" },
    { name: "pulang Jumat sebelum masuk", schedules: [sc({ friday_end_minutes: 420 })], schedule_by_unit: {}, expect: "friday_end_before_start" },
    { name: "istirahat Jumat menghabiskan Jumat", schedules: [sc({ friday_end_minutes: 990, friday_break_minutes: 510 })], schedule_by_unit: {}, expect: "friday_break_too_long" },
    /* Istirahat Jumat kosong: yang dipakai istirahat biasa, dan terhadap jam
       pulang Jumat yang lebih awal ia bisa jadi kepanjangan. */
    { name: "istirahat biasa kepanjangan untuk Jumat pendek", schedules: [sc({ break_minutes: 500, end_minutes: 1035, friday_end_minutes: 960, friday_break_minutes: null })], schedule_by_unit: {}, expect: "friday_break_too_long" },
    /* Dua unit menggantung sekaligus, dan namanya sengaja beda kapital:
       urutan mana yang dilaporkan lebih dulu tidak boleh bergantung pada
       collation basis datanya (F143). */
    { name: "dua unit menggantung — yang mana dilaporkan dulu", schedules: [sc({})], schedule_by_unit: { Workshop: "PRODUKSI", office: "GUDANG" }, expect: "unit_unknown_code" },
    { name: "unit menunjuk pola yang tidak ada", schedules: [sc({})], schedule_by_unit: { Workshop: "PRODUKSI" }, expect: "unit_unknown_code" },
    /* Urutan dilaporkannya penting: baris dulu, baru pemetaan unit. */
    { name: "baris rusak dilaporkan sebelum unit", schedules: [sc({ code: "kantor" })], schedule_by_unit: { Workshop: "PRODUKSI" }, expect: "code_shape" },
    /* D340 — jadwal per hari. Pola produksi pemilik: Sabtu dan Minggu 08.00–
       16.00 tanpa istirahat, dibayar 2×. */
    { name: "jadwal per hari produksi", schedules: [sc({ code: "PRODUKSI", name: "Produksi", start_minutes: 450, end_minutes: 990, break_minutes: 45, friday_end_minutes: 960, friday_break_minutes: 90, days: { "6": { start_minutes: 480, end_minutes: 960, break_minutes: 0, pay_multiplier: 2 }, "7": { start_minutes: 480, end_minutes: 960, break_minutes: 0, pay_multiplier: 2 } } })], schedule_by_unit: {}, expect: null },
    { name: "hari libur di pola", schedules: [sc({ days: { "7": { off: true } } })], schedule_by_unit: {}, expect: null },
    { name: "hari tidak dikenal", schedules: [sc({ days: { "8": { pay_multiplier: 2 } } })], schedule_by_unit: {}, expect: "day_key" },
    { name: "pengali nol", schedules: [sc({ days: { "6": { pay_multiplier: 0 } } })], schedule_by_unit: {}, expect: "day_multiplier" },
    { name: "menit hari di luar sehari", schedules: [sc({ days: { "6": { start_minutes: 2000 } } })], schedule_by_unit: {}, expect: "minutes_range" },
    { name: "pulang Sabtu sama dengan masuk", schedules: [sc({ days: { "6": { start_minutes: 480, end_minutes: 480 } } })], schedule_by_unit: {}, expect: "day_end_before_start" },
    { name: "istirahat Sabtu menghabiskan Sabtu", schedules: [sc({ days: { "6": { start_minutes: 480, end_minutes: 720, break_minutes: 240 } } })], schedule_by_unit: {}, expect: "day_break_too_long" },
    /* Jumat per hari jatuh ke jam pulang Jumat pola, bukan jam pulang biasa. */
    { name: "jadwal per hari bukan daftar", schedules: [sc({ days: [1, 2] as unknown as Record<string, ScheduleDay> })], schedule_by_unit: {}, expect: "days_shape" },
    { name: "hari berisi angka", schedules: [sc({ days: { "6": 2 as unknown as ScheduleDay } })], schedule_by_unit: {}, expect: "day_shape" },
    { name: "istirahat Jumat per hari terhadap pulang Jumat", schedules: [sc({ friday_end_minutes: 720, days: { "5": { break_minutes: 240 } } })], schedule_by_unit: {}, expect: "day_break_too_long" },
    /* D364 — shift Satpam: Shift 1 07.00–17.00, Shift 2 17.00–07.00. */
    { name: "shift satpam", schedules: [sc({ code: "SATPAM", name: "Satpam", start_minutes: 420, end_minutes: 1020, break_minutes: 0, friday_break_minutes: null, friday_end_minutes: null, shifts: SATPAM_SHIFTS })], schedule_by_unit: {}, expect: null },
    { name: "daftar shift kosong", schedules: [sc({ shifts: [] })], schedule_by_unit: {}, expect: null },
    { name: "shift bukan daftar", schedules: [sc({ shifts: { S1: 1 } as unknown as ScheduleShift[] })], schedule_by_unit: {}, expect: "shifts_shape" },
    { name: "tujuh shift", schedules: [sc({ shifts: Array.from({ length: 7 }, (_, k) => ({ code: `S${k + 1}`, name: `Shift ${k + 1}`, start_minutes: k * 60, end_minutes: k * 60 + 30 })) })], schedule_by_unit: {}, expect: "shifts_too_many" },
    { name: "shift berisi angka", schedules: [sc({ shifts: [3 as unknown as ScheduleShift] })], schedule_by_unit: {}, expect: "shift_shape" },
    { name: "shift tanpa kode", schedules: [sc({ shifts: [{ code: " ", name: "Pagi", start_minutes: 420, end_minutes: 1020 }] })], schedule_by_unit: {}, expect: "shift_code" },
    { name: "kode shift huruf kecil", schedules: [sc({ shifts: [{ code: "s1", name: "Pagi", start_minutes: 420, end_minutes: 1020 }] })], schedule_by_unit: {}, expect: "shift_code" },
    { name: "kode shift kembar", schedules: [sc({ shifts: [SATPAM_SHIFTS[0], { ...SATPAM_SHIFTS[1], code: "S1" }] })], schedule_by_unit: {}, expect: "shift_code_duplicate" },
    { name: "shift tanpa nama", schedules: [sc({ shifts: [{ ...SATPAM_SHIFTS[0], name: "" }] })], schedule_by_unit: {}, expect: "shift_name" },
    { name: "shift tanpa jam masuk", schedules: [sc({ shifts: [{ ...SATPAM_SHIFTS[0], start_minutes: null as unknown as number }] })], schedule_by_unit: {}, expect: "shift_minutes" },
    { name: "jam shift di luar sehari", schedules: [sc({ shifts: [{ ...SATPAM_SHIFTS[0], end_minutes: 1500 }] })], schedule_by_unit: {}, expect: "shift_minutes" },
    { name: "istirahat shift pecahan", schedules: [sc({ shifts: [{ ...SATPAM_SHIFTS[0], break_minutes: 30.5 }] })], schedule_by_unit: {}, expect: "minutes_range" },
    { name: "pulang shift sama dengan masuk", schedules: [sc({ shifts: [{ ...SATPAM_SHIFTS[0], end_minutes: 420 }] })], schedule_by_unit: {}, expect: "shift_end_before_start" },
    { name: "istirahat menghabiskan shift malam", schedules: [sc({ shifts: [{ ...SATPAM_SHIFTS[1], break_minutes: 840 }] })], schedule_by_unit: {}, expect: "shift_break" },
  ];
  return cases;
})();

/* ------------------------------------------------------------------ */
/* A pattern's week and month, worked out                              */
/* ------------------------------------------------------------------ */

/** The hours, derived rather than stored (Q53, D279).
 *
 *  Null propagates deliberately. The guard's twelve hours have no start, so no
 *  day, so no week, so no month — and every one of those is *belum ditetapkan*
 *  rather than zero. A zero here would be a figure HR could plan against, and
 *  it would be a figure about somebody nobody has written the hours down for.
 */
export interface ScheduleHoursShape {
  /** Working hours in one ordinary day: end − start − break. */
  daily_hours: number | null;
  /** Friday, where its break or its finishing time differs. Null when Friday
   *  is an ordinary day for this pattern. */
  friday_hours: number | null;
  /** Working days a week, from the rule book's `week_pattern`. */
  days_per_week: number;
  /** The week, Friday counted at its own length where it has one. */
  weekly_hours: number | null;
  /** `weekly_hours × 52 ÷ 12`, and the arithmetic is printed beside it. */
  monthly_hours: number | null;
  /** What is stopping the figures, in words, where they are null. */
  blocked_by: string | null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** One pattern's figures.
 *
 *  Lives here rather than in the demo's derivation because `/it/aturan-gaji`
 *  needs them for a row **nobody has saved yet** — a draft has no server to ask
 *  — and a third copy of the Friday arithmetic is exactly how two of the three
 *  end up agreeing while the third quietly does not. `ops_hr.schedule_roll()`
 *  is still its own statement, in SQL, and smoke 58 is what holds the two
 *  languages level.
 */
export function scheduleHoursOf(sc: ScheduleShape, daysPerWeek: number): ScheduleHoursShape {
  const missing: string[] = [];
  if (sc.start_minutes == null) missing.push("jam masuk");
  if (sc.end_minutes == null) missing.push("jam pulang");
  if (sc.break_minutes == null) missing.push("istirahat");

  if (missing.length > 0) {
    return {
      daily_hours: null, friday_hours: null, days_per_week: daysPerWeek,
      weekly_hours: null, monthly_hours: null,
      blocked_by: `Belum ada ${missing.join(", ")} — jamnya belum bisa dihitung.`,
    };
  }

  const start = sc.start_minutes as number;
  /* Walked through midnight: `end − start` gave the guard minus seven hundred
     and twenty minutes (D330). */
  const daily_hours = round2(((shiftMinutes(start, sc.end_minutes) as number) - (sc.break_minutes as number)) / 60);

  /* Friday differs in two ways and either one is enough (Q54, D289): a longer
     break, an earlier finish, or both. Whichever is not stated falls back to
     the ordinary day rather than blanking Friday — the office's Friday is
     16.30 *and* the usual 90-minute break, and reading the missing half as
     unknown would lose a day the business has actually decided. */
  const fridayDiffers = sc.friday_end_minutes != null || sc.friday_break_minutes != null;
  const fridayEnd = sc.friday_end_minutes ?? (sc.end_minutes as number);
  const fridayBreak = sc.friday_break_minutes ?? (sc.break_minutes as number);
  const friday_hours = fridayDiffers
    ? round2(((shiftMinutes(start, fridayEnd) as number) - fridayBreak) / 60)
    : null;

  const weekly_hours = friday_hours == null
    ? round2(daily_hours * daysPerWeek)
    : round2(daily_hours * (daysPerWeek - 1) + friday_hours);

  return {
    daily_hours, friday_hours, days_per_week: daysPerWeek, weekly_hours,
    monthly_hours: round2((weekly_hours * 52) / 12),
    blocked_by: null,
  };
}

/* ------------------------------------------------------------------ */
/* Which calendar day a typed clock time lands on                      */
/* ------------------------------------------------------------------ */

/** The calendar day after `key` (`YYYY-MM-DD`), without going near a timezone
 *  — `Date` in local time loses the last day of a period (F39). */
export function nextOfficeDay(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/** The instant a person means by *this clock time, on this working day*.
 *
 *  For almost everybody it is that day at that time, on the office clock
 *  (`src/lib/office.ts`, WIB since D334). For a guard on a
 *  night (D330) the working day runs into the next morning, so 07.05 typed
 *  against Monday's shift is **Tuesday** 07.05. Decided by the day's own
 *  window as the reading reported it — a time earlier than the window opens
 *  can only be the morning after — so neither client works out the shift
 *  rule a second time.
 */
/** The office clock's offset (WIB, D334). `src/lib/office.ts` is where it is
 *  decided, but this file may not import anything (see the header), so it is
 *  restated here — and `office.ts` refuses to compile if the two disagree
 *  (`OfficeOffsetAgrees`), so a second zone change cannot miss this copy. */
export const OFFICE_OFFSET = "+07:00" as const;

export function instantInDay(workDate: string, time: string, windowFrom: string | null): string {
  const at = `${workDate}T${time}:00${OFFICE_OFFSET}`;
  if (windowFrom && Date.parse(at) < Date.parse(windowFrom)) {
    return `${nextOfficeDay(workDate)}T${time}:00${OFFICE_OFFSET}`;
  }
  return at;
}
