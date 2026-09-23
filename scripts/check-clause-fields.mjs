#!/usr/bin/env node
/** Refuse a contract-clause form that disagrees with the constraint behind it.
 *
 *  ## Why this exists
 *
 *  `ops_hr.clause_value_ok` decides what a clause answer may look like — which
 *  keys, which choices, which must be digits. Until the PDF reader (tahap C)
 *  exists, **every answer is typed by a person**, and the thing they type into
 *  is `CLAUSE_FIELDS` in `src/services/hr/contracts.ts`. Two statements of one
 *  rule, in two languages, neither able to see the other.
 *
 *  Both ways of drifting are silent, and neither is caught by anything else:
 *
 *  - **SQL grows a choice the form does not offer.** Somebody adds
 *    `'half_day_step'` to `potongan`. `tsc` is happy, the smoke files are
 *    happy — the choice simply cannot be picked by anyone, forever, and the
 *    only symptom is a clause nobody ever fills in that way.
 *  - **The form offers a choice SQL refuses.** Worse, because it looks like it
 *    worked: HRD picks it, presses *Konfirmasi*, and gets a refusal whose
 *    wording is about a `check` constraint. The form promised something the
 *    database was never going to accept.
 *
 *  A `clause_kind_t` value added to the enum and forgotten in `CLAUSE_FIELDS`
 *  is caught by `tsc` already (the `Record<ClauseKind, …>` is exhaustive). What
 *  `tsc` cannot see is the *inside* of that record, because the inside is a
 *  transcription of a SQL function body.
 *
 *  ## What it checks
 *
 *  It parses the `case` arms of `ops_hr.clause_value_ok` out of the migration
 *  ladder and the `CLAUSE_FIELDS` literal out of the service module, reduces
 *  both to the same shape — per kind, a sorted list of
 *  `key:digits`, `key:digits+`, `key:nonempty` or `key:in(a|b|c)` — and refuses
 *  any kind where the two do not match exactly.
 *
 *  It does **not** re-implement the rule, and it is not a substitute for the
 *  constraint: the database still decides. It only refuses the two drifts.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MIG = "supabase/migrations";
const SVC = "src/services/hr/contracts.ts";

/* ── The SQL side ─────────────────────────────────────────────────────────
 *
 *  Read the *last* definition in ladder order, not the first: the ladder is
 *  append-only and a later migration may restate the function. Reading the
 *  first would pin this check to a body nothing runs any more.
 */
const files = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort();
let body = null;
for (const f of files) {
  const sql = readFileSync(join(MIG, f), "utf8");
  const m = sql.match(
    /function\s+ops_hr\.clause_value_ok\s*\([\s\S]*?\$\$([\s\S]*?)\$\$\s*;/g);
  if (m) body = m[m.length - 1];
}
if (!body) {
  console.error("check-clause-fields: no ops_hr.clause_value_ok in the ladder.");
  process.exit(1);
}

/* Strip `--` comments before parsing. The real body carries a paragraph about
 * three-valued logic that contains the word `when`, and a parser that reads it
 * as a case arm reports a kind called *coalesce*. */
const sqlBody = body.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");

const sqlKinds = new Map();
/* Each arm runs from `when 'kind' then` to the next `when` or to `else`. */
const arms = [...sqlBody.matchAll(/when\s+'([a-z_]+)'\s+then([\s\S]*?)(?=\bwhen\s+'|\belse\b)/g)];
for (const [, kind, expr] of arms) {
  const facts = [];
  for (const [, key] of expr.matchAll(/\(p_value\s*->>\s*'([a-z_]+)'\)\s*~\s*'\^\[0-9\]\+\$'/g)) {
    const positive = new RegExp(
      `\\(p_value\\s*->>\\s*'${key}'\\)::numeric\\s*>\\s*0`).test(expr);
    facts.push(`${key}:digits${positive ? "+" : ""}`);
  }
  for (const [, key, list] of expr.matchAll(/p_value\s*->>\s*'([a-z_]+)'\s+in\s*\(([^)]*)\)/g)) {
    const options = [...list.matchAll(/'([^']*)'/g)].map((o) => o[1]);
    facts.push(`${key}:in(${options.join("|")})`);
  }
  for (const [, key] of expr.matchAll(
    /coalesce\s*\(\s*p_value\s*->>\s*'([a-z_]+)'\s*,\s*''\s*\)\s*<>\s*''/g)) {
    facts.push(`${key}:nonempty`);
  }
  if (facts.length === 0) {
    console.error(
      `check-clause-fields: read no condition out of the SQL arm for '${kind}'.`
      + "\nThe arm exists, so this is the parser falling behind the shapes the"
      + "\nfunction now uses — teach it the new shape rather than deleting the arm.");
    process.exit(1);
  }
  sqlKinds.set(kind, facts.sort());
}

/* ── The TypeScript side ──────────────────────────────────────────────────
 *
 *  Sliced out of the source rather than imported: this runs under plain node,
 *  before the build, and importing a `.ts` module would make the guard depend
 *  on the thing it guards compiling first.
 */
const svc = readFileSync(SVC, "utf8");
const start = svc.indexOf("export const CLAUSE_FIELDS");
if (start < 0) {
  console.error(`check-clause-fields: no CLAUSE_FIELDS in ${SVC}.`);
  process.exit(1);
}
const lit = svc.slice(svc.indexOf("{", start), svc.indexOf("\n};", start));

const tsKinds = new Map();
for (const [, kind, entries] of lit.matchAll(/^  ([a-z_]+): \[([\s\S]*?)^  \],$/gm)) {
  const facts = [];
  /* Split on the `key:` boundaries rather than on braces. An options list is
   * itself made of `{ value, label }` objects, so a brace-matching slice stops
   * inside the first option and reports a one-choice field — which is exactly
   * the drift this check is for, arriving as a false one. */
  const parts = entries.split(/(?=\bkey: ")/).slice(1);
  for (const field of parts) {
    const key = field.match(/^key: "([a-z_]+)"/)?.[1];
    if (!key) continue;
    const input = field.match(/input: "([a-z]+)"/)?.[1];
    if (input === "digits") {
      facts.push(`${key}:digits${/positive: true/.test(field) ? "+" : ""}`);
    } else if (input === "schedule") {
      facts.push(`${key}:nonempty`);
    } else if (input === "choice") {
      const options = [...field.matchAll(/value: "([^"]*)"/g)].map((o) => o[1]);
      facts.push(`${key}:in(${options.join("|")})`);
    }
  }
  if (facts.length) tsKinds.set(kind, facts.sort());
}

/* ── Compare ──────────────────────────────────────────────────────────── */
const problems = [];
for (const kind of new Set([...sqlKinds.keys(), ...tsKinds.keys()])) {
  const sql = sqlKinds.get(kind);
  const ts = tsKinds.get(kind);
  if (!sql) {
    problems.push(
      `  ${kind}  — the form asks for ${ts.join(", ")}, the constraint shapes nothing.`
      + "\n           Whatever is typed here is stored unchecked.");
  } else if (!ts) {
    problems.push(
      `  ${kind}  — the constraint requires ${sql.join(", ")}, the form has no fields.`
      + "\n           Nobody can answer this clause: every attempt is refused.");
  } else if (sql.join(" ") !== ts.join(" ")) {
    problems.push(
      `  ${kind}\n      database: ${sql.join(", ")}\n      form:     ${ts.join(", ")}`);
  }
}

if (problems.length) {
  console.error(
    "the contract-clause form and ops_hr.clause_value_ok disagree.\n");
  console.error(problems.join("\n"));
  console.error(
    "\nThe constraint decides, so a form that offers more produces refusals and a"
    + "\nform that offers less hides a choice nobody can ever pick. Change"
    + "\nCLAUSE_FIELDS in src/services/hr/contracts.ts, or restate the function in"
    + "\na new migration — not the one already applied.");
  process.exit(1);
}

console.log(
  `clause fields                               ok (${sqlKinds.size} shaped kinds)`);
