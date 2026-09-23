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

    if (st != null && en != null && !badMinutes(st) && !badMinutes(en) && en <= st) {
      out.push({
        code: "end_before_start",
        message: `${where}: pulang ${clockOf(en)} tidak sesudah masuk ${clockOf(st)}.`,
      });
    }
    /* A break that eats the whole day leaves nought hours, and nought hours is
       not a schedule — it is a row that will quietly value every day at zero
       for whoever is on it. */
    if (st != null && en != null && br != null && en > st && br >= en - st) {
      out.push({
        code: "break_too_long",
        message: `${where}: istirahat ${br} menit menghabiskan seluruh hari kerja ${clockOf(st)}–${clockOf(en)}.`,
      });
    }

    if (st != null && fen != null && !badMinutes(st) && !badMinutes(fen) && fen <= st) {
      out.push({
        code: "friday_end_before_start",
        message: `${where}: pulang Jumat ${clockOf(fen)} tidak sesudah masuk ${clockOf(st)}.`,
      });
    }
    /* Friday's two halves fall back independently (D289), so its arithmetic has
       to be checked on the pair it will actually be computed from. */
    const fEnd = fen ?? en;
    const fBreak = fbr ?? br;
    if (st != null && fEnd != null && fBreak != null && fEnd > st && fBreak >= fEnd - st) {
      out.push({
        code: "friday_break_too_long",
        message: `${where}: istirahat Jumat ${fBreak} menit menghabiskan seluruh hari Jumat ${clockOf(st)}–${clockOf(fEnd)}.`,
      });
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
    { name: "pulang sebelum masuk", schedules: [sc({ start_minutes: 600, end_minutes: 540 })], schedule_by_unit: {}, expect: "end_before_start" },
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
  const daily_hours = round2(((sc.end_minutes as number) - start - (sc.break_minutes as number)) / 60);

  /* Friday differs in two ways and either one is enough (Q54, D289): a longer
     break, an earlier finish, or both. Whichever is not stated falls back to
     the ordinary day rather than blanking Friday — the office's Friday is
     16.30 *and* the usual 90-minute break, and reading the missing half as
     unknown would lose a day the business has actually decided. */
  const fridayDiffers = sc.friday_end_minutes != null || sc.friday_break_minutes != null;
  const fridayEnd = sc.friday_end_minutes ?? (sc.end_minutes as number);
  const fridayBreak = sc.friday_break_minutes ?? (sc.break_minutes as number);
  const friday_hours = fridayDiffers ? round2((fridayEnd - start - fridayBreak) / 60) : null;

  const weekly_hours = friday_hours == null
    ? round2(daily_hours * daysPerWeek)
    : round2(daily_hours * (daysPerWeek - 1) + friday_hours);

  return {
    daily_hours, friday_hours, days_per_week: daysPerWeek, weekly_hours,
    monthly_hours: round2((weekly_hours * 52) / 12),
    blocked_by: null,
  };
}
