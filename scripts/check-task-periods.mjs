#!/usr/bin/env node
/** Refuse a period boundary the database and the browser disagree about.
 *
 *  ## The bug this exists for, before it happens
 *
 *  The task module holds **one task per routine per period**, and it holds it
 *  with a unique index on `(routine_id, period_start)`. That index is the whole
 *  idempotency guarantee: run the generator twice, run it from two screens at
 *  once, run it after somebody raised this month's row by hand — same database.
 *
 *  It guarantees nothing at all if the two implementations cut the period
 *  somewhere different. A demo that starts September on the 1st and a database
 *  that starts it on the 2nd never collide, so the index never fires, so the
 *  generator raises the same month twice and **nothing reports an error**. The
 *  board just grows a duplicate row every period, and the first person to
 *  notice is the one asked twice for the same report.
 *
 *  F143 was exactly this shape and it shipped: a JS `.sort()` and an
 *  `en_US.UTF-8` `order by` disagreed, and the gate that should have caught it
 *  was blind because CI and the scratch cluster both collated like `C`. What
 *  was missing was not care. It was a check that put the same question to both
 *  sides and compared the answers.
 *
 *  ## What it checks
 *
 *  `PERIOD_CASES` in `src/services/hr/task-periods.ts` is the specification.
 *  Each case is put to the TypeScript functions — compiled and **executed**,
 *  not read — and to `ops_hr.task_period_start`, `task_period_end` and
 *  `task_period_label`. All three must match, to the day and to the character.
 *
 *  Three properties are checked besides equality, because two implementations
 *  can agree and both be wrong:
 *
 *    - the date asked about falls inside the period it was given;
 *    - the day after a period ends opens the next one, exactly — no gap and no
 *      overlap, which is what makes `period_start` a key at all;
 *    - every day of a period answers the same start.
 *
 *    supabase/local/rebuild.sh && node scripts/check-task-periods.mjs
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const SRC = "src/services/hr/task-periods.ts";

function loadModule() {
  const dir = mkdtempSync(join(tmpdir(), "task-periods-"));
  try {
    execFileSync("npx", [
      "tsc", SRC,
      "--outDir", dir,
      "--target", "es2022",
      "--module", "es2022",
      "--moduleResolution", "bundler",
      "--strict",
    ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    console.error(
      `could not compile ${SRC}.\n\n`
      + String(e.stdout ?? "").trim() + "\n" + String(e.stderr ?? "").trim(),
    );
    rmSync(dir, { recursive: true, force: true });
    process.exit(2);
  }
  return { dir, entry: pathToFileURL(join(dir, "task-periods.js")).href };
}

/* One round trip per case. The cases are few, and a batched query that got its
   own grouping wrong would report an agreement it had not checked. */
function askDatabase(cadence, on) {
  const sql =
    `select ops_hr.task_period_start('${cadence}', date '${on}')::text
         || '|' || ops_hr.task_period_end('${cadence}',
                    ops_hr.task_period_start('${cadence}', date '${on}'))::text
         || '|' || ops_hr.task_period_label('${cadence}',
                    ops_hr.task_period_start('${cadence}', date '${on}'))`;
  try {
    return execFileSync("psql", ["-tAc", sql], {
      encoding: "utf8",
      env: { ...process.env, PGDATABASE: process.env.PGDATABASE ?? "postgres" },
    }).trim().split("|");
  } catch (e) {
    console.error(
      "could not reach the database. This check needs the ladder applied"
      + "\n— `supabase/local/rebuild.sh` — and PGHOST/PGPORT/PGUSER set the way"
      + "\nthat script wants them.\n\n" + String(e.message).trim(),
    );
    process.exit(2);
  }
}

const { dir, entry } = loadModule();
let mod;
try {
  mod = await import(entry);
} finally {
  process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
}

const { PERIOD_CASES, taskPeriodStart, taskPeriodEnd, taskPeriodLabel, addDays } = mod;
if (!Array.isArray(PERIOD_CASES) || PERIOD_CASES.length === 0) {
  console.error(`${SRC} exports no PERIOD_CASES — the battery is the specification.`);
  process.exit(1);
}

const problems = [];
const seenCadences = new Set();

for (const { cadence, on } of PERIOD_CASES) {
  seenCadences.add(cadence);

  const tsStart = taskPeriodStart(cadence, on);
  const tsEnd = taskPeriodEnd(cadence, tsStart);
  const tsLabel = taskPeriodLabel(cadence, tsStart);
  const [sqlStart, sqlEnd, sqlLabel] = askDatabase(cadence, on);

  const where = `${cadence} on ${on}`;
  if (tsStart !== sqlStart) problems.push(`${where}: starts ${tsStart} here, ${sqlStart} in the database`);
  if (tsEnd !== sqlEnd) problems.push(`${where}: ends ${tsEnd} here, ${sqlEnd} in the database`);
  if (tsLabel !== sqlLabel) problems.push(`${where}: reads "${tsLabel}" here, "${sqlLabel}" in the database`);

  /* Agreement is not correctness. */
  if (!(tsStart <= on && on <= tsEnd)) {
    problems.push(`${where}: the date falls outside its own period (${tsStart}..${tsEnd})`);
  }
  const next = taskPeriodStart(cadence, addDays(tsEnd, 1));
  if (next !== addDays(tsEnd, 1)) {
    problems.push(`${where}: a gap or an overlap at ${tsEnd} — the next period starts ${next}`);
  }
  if (taskPeriodStart(cadence, tsEnd) !== tsStart) {
    problems.push(`${where}: the last day of the period answers a different start`);
  }
}

/* A battery that has quietly lost a cadence checks the other four forever. */
for (const c of ["WEEKLY", "MONTHLY", "QUARTERLY", "SEMESTER", "ANNUAL"]) {
  if (!seenCadences.has(c)) problems.push(`no case exercises ${c} — it is unchecked, not agreed`);
}

if (problems.length > 0) {
  console.error("period boundaries disagree:\n");
  for (const p of problems) console.error(`  - ${p}`);
  console.error(
    "\nThis is not a display bug. `tasks_routine_period_uq` is keyed on"
    + "\n`period_start`, so two implementations that cut a period differently"
    + "\nraise the same period twice and nothing reports an error.",
  );
  process.exit(1);
}

console.log(`period boundaries agree — ${PERIOD_CASES.length} cases, both sides.`);
