#!/usr/bin/env node
/** Refuse a guide that describes a button the walk did not press.
 *
 *  `scripts/e2e/walk-procurement.mjs` presses the real buttons in live mode and
 *  writes what it pressed to `docs/sop/<module>/walk.json`. John Lau's model and
 *  the SOP both read `ops_asst.process_steps`. This compares the two:
 *
 *    * every button the walk pressed for a process must be named in that
 *      process's steps — a renamed button whose guide still says the old name
 *      is a tutorial that sends people looking for something that is not there;
 *    * every step the walk recorded must have passed — a walk.json with a
 *      failure in it is not evidence of anything;
 *    * every process in the module should have been walked. A process nobody
 *      walked is reported, not refused: some (master data, seeded for the walk)
 *      are deliberately outside it, and the list says which.
 *
 *    PGHOST=/tmp PGPORT=5433 node scripts/sop/check-knowledge.mjs procurement
 *
 *  Needs the ladder applied, like the other checks that read the database.
 *  walk.json is committed, so CI checks the last recorded walk against the
 *  knowledge the migrations write — without needing a browser.
 */
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname, resolve } from "node:path";

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "../..");
const MODULE = process.argv[2] ?? "procurement";
const WALK = join(ROOT, "docs/sop", MODULE, "walk.json");

/* Processes deliberately not walked through the screens, and why. */
const NOT_WALKED = {
  "procure.master_data": "seeded by scripts/e2e/seed-procurement.sql; the walk starts from a curated vendor",
  "hr.pay_rules": "IT's; seeded by scripts/e2e/seed-hr.sql, the walk starts from a version in force (59 smoke edits it)",
  "hr.payslip": "opens a print dialog in a new tab — read-only, nothing to record",
};

if (!existsSync(WALK)) {
  console.log("knowledge".padEnd(44) + `skipped (no ${MODULE} walk recorded)`);
  process.exit(0);
}

function ask(sql) {
  try {
    return execFileSync("psql", ["-tAc", sql], {
      encoding: "utf8",
      env: { ...process.env, PGDATABASE: process.env.PGDATABASE ?? "postgres", PGUSER: process.env.PGUSER ?? "postgres" },
    });
  } catch (e) {
    console.error("could not read the knowledge — this check needs the ladder applied.\n" + String(e.message).trim());
    process.exit(2);
  }
}

const walk = JSON.parse(readFileSync(WALK, "utf8"));
const rows = JSON.parse(ask(
  `select coalesce(json_agg(json_build_object('key', p.key, 'text',
     (select string_agg(coalesce(s.action,'') || ' ' || coalesce(s.rule,''), ' ') from ops_asst.process_steps s where s.process_key = p.key))), '[]')
     from ops_asst.processes p where p.sop_ref like '${MODULE}/%'`).trim());
const knowledge = new Map(rows.map((r) => [r.key, (r.text ?? "").toLowerCase()]));

const findings = [];
for (const s of walk.steps) {
  if (!s.ok) findings.push(`walk step ${s.n} (${s.action}) did not pass: ${s.note}`);
  if (!s.button) continue;
  const text = knowledge.get(s.process);
  if (text === undefined) {
    findings.push(`walk step ${s.n} belongs to ${s.process}, which the knowledge does not have`);
  } else if (!text.includes(s.button.toLowerCase().split(" rp")[0].replace("…", "").trim())) {
    findings.push(`${s.process} never says "${s.button}", and step ${s.n} (${s.action}) is pressed with it`);
  }
}
for (const f of walk.failures ?? []) findings.push(`walk failure: ${f}`);

const walked = new Set(walk.steps.map((s) => s.process));
const unwalked = [...knowledge.keys()].filter((k) => !walked.has(k) && !NOT_WALKED[k]);

if (findings.length) {
  console.error("knowledge\n");
  for (const f of findings) console.error("  ✗  " + f);
  console.error("\nThe guide John Lau reads and the screens the walk pressed disagree. Update the\n"
    + "step in a migration, or re-record the walk if the screen is what changed.");
  process.exit(1);
}
console.log("knowledge".padEnd(44)
  + `ok (${walk.steps.length} walked steps, ${walked.size} processes`
  + `${unwalked.length ? `, not walked: ${unwalked.join(", ")}` : ""})`);
