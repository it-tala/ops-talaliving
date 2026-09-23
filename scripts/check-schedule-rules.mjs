#!/usr/bin/env node
/** Refuse a demo that answers differently from the database about the same form.
 *
 *  ## Why this exists
 *
 *  `/it/aturan-gaji` now lets somebody type the working patterns, so what a
 *  pattern may say became a rule with a person on the other end of it. That
 *  rule is written twice, because ADR-009 says the demo client and the real
 *  one are interchangeable: once in `ops_hr.schedule_problem()` and once in
 *  `src/services/hr/schedule-rules.ts`.
 *
 *  Both ways of drifting are silent:
 *
 *  - **SQL tightens and the demo does not.** Somebody demonstrating the system
 *    saves a pattern happily, the same keystrokes against the real database
 *    are refused, and the refusal reads like a bug in the product.
 *  - **The demo tightens and SQL does not.** Worse: the rule looks enforced
 *    everywhere it is ever *shown*, and the one place it matters — a version
 *    written against real payroll — lets the bad row through.
 *
 *  And a third that is subtler than either: the two agree that something is
 *  wrong but **say different sentences about it**. The message is the whole
 *  product here. A refusal is only useful if it tells you which row and what
 *  to do, and a demo that rehearses a different sentence has rehearsed the
 *  wrong thing. So this compares the message too, not just the code.
 *
 *  ## What it checks
 *
 *  `SCHEDULE_CASES` in the TypeScript module is the specification: every case
 *  names the answer it expects, so neither implementation is the reference for
 *  the other and a shared mistake still fails. Each case is run through
 *
 *    1. the expectation written beside it,
 *    2. `scheduleProblem()` compiled and executed in plain node,
 *    3. `ops_hr.schedule_problem()` in the database,
 *
 *  and any disagreement between the three is refused.
 *
 *  The module is compiled with `tsc` into a scratch directory rather than
 *  imported through the app's bundler, which is why `schedule-rules.ts` may
 *  not import anything. Keep it that way — the moment it needs `@/…`, this
 *  gate needs a bundler and stops being something anybody runs.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const SRC = "src/services/hr/schedule-rules.ts";

/* ── the TypeScript side, actually executed ───────────────────────────── */
function loadModule() {
  const dir = mkdtempSync(join(tmpdir(), "schedule-rules-"));
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
  return { dir, entry: pathToFileURL(join(dir, "schedule-rules.js")).href };
}

/* ── the SQL side, asked one case at a time ───────────────────────────── */
//
// One round trip per case rather than one clever query: the cases are few, and
// a batched query that got its own grouping wrong would report agreement it
// had not checked.
function askDatabase(rules) {
  const sql = `select coalesce(ops_hr.schedule_problem($json$${JSON.stringify(rules)}$json$::jsonb)::text, '')`;
  try {
    return execFileSync("psql", ["-tAc", sql], {
      encoding: "utf8",
      env: { ...process.env, PGDATABASE: process.env.PGDATABASE ?? "postgres" },
    }).trim();
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
  // Imported already; the directory has served its purpose either way.
  process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
}

const { SCHEDULE_CASES, scheduleProblem } = mod;
if (!Array.isArray(SCHEDULE_CASES) || SCHEDULE_CASES.length === 0) {
  console.error(`${SRC} exports no SCHEDULE_CASES — the battery is the specification.`);
  process.exit(1);
}

const problems = [];
const seenCodes = new Set();

for (const c of SCHEDULE_CASES) {
  const rules = { schedules: c.schedules, schedule_by_unit: c.schedule_by_unit };

  const ts = scheduleProblem(c.schedules, c.schedule_by_unit);
  const raw = askDatabase(rules);
  const sql = raw === "" ? null : JSON.parse(raw);

  if ((ts?.code ?? null) !== c.expect) {
    problems.push(
      `  ${c.name}\n      TypeScript answered ${ts?.code ?? "null"}, the case expects ${c.expect ?? "null"}`,
    );
  }
  if ((sql?.code ?? null) !== c.expect) {
    problems.push(
      `  ${c.name}\n      the database answered ${sql?.code ?? "null"}, the case expects ${c.expect ?? "null"}`,
    );
  }
  /* Same verdict, different words, is still two systems disagreeing about the
     form — the sentence is what the person acts on. */
  if (ts && sql && ts.code === sql.code && ts.message !== sql.message) {
    problems.push(
      `  ${c.name}\n      same refusal, different sentence:`
      + `\n        ts  ${ts.message}\n        sql ${sql.message}`,
    );
  }
  if (c.expect) seenCodes.add(c.expect);
}

/* Every refusal the TypeScript side can produce must be exercised. A code with
   no case is a rule whose two copies have never been compared — the drift this
   file exists for, hiding in the one branch nobody covered. */
//
// Matched on `code` immediately followed by `message`, which is the shape of a
// refusal and not of a test fixture — `sc({ code: "kantor" })` is a case, not
// a rule, and counting it as one sent this check off on a false find the first
// time it ran.
const declared = new Set(
  [...readFileSync(SRC, "utf8").matchAll(/code:\s*"([a-z_]+)",\s*(?:\n\s*)?message:/g)]
    .map((m) => m[1]),
);
for (const code of [...declared].sort()) {
  if (!seenCodes.has(code)) {
    problems.push(`  ${code} — a refusal with no case in SCHEDULE_CASES; the two copies of it have never been compared.`);
  }
}

if (problems.length) {
  console.error("the schedule rule does not say the same thing in both places.\n");
  console.error(problems.join("\n"));
  console.error(
    "\n`ops_hr.schedule_problem()` and `src/services/hr/schedule-rules.ts` are two"
    + "\nstatements of one rule, and the demo and the real client each believe one"
    + "\nof them (ADR-009). Change both, or add the missing case — do not relax the"
    + "\nexpectation to whichever side happens to be louder.",
  );
  process.exit(1);
}

console.log(
  `schedule rules                              ok (${SCHEDULE_CASES.length} cases, ${declared.size} refusals)`,
);
