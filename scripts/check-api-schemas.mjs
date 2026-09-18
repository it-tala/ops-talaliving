#!/usr/bin/env node
/** Refuse a client call that names an object PostgREST will look for in the
 *  wrong schema.
 *
 *  ## Why this exists
 *
 *  `.from("v_my_access")` and `.rpc("record_sign_in")` do not search. PostgREST
 *  resolves both against **the one schema the request names** — its
 *  `Accept-Profile` / `Content-Profile` header — and with no schema named it
 *  uses the first of its exposed schemas, which is `public`. This project keeps
 *  nothing in `public`.
 *
 *  So the first screen to load against the real database answered:
 *
 *      Could not find the table 'public.v_my_access' in the schema cache
 *
 *  Every one of the ~100 calls in `src/lib/api/*` had the same fault. None of
 *  them could fail earlier: `tsc` sees a string, the demo never routes through
 *  PostgREST, and the smoke files talk to Postgres directly. **The first
 *  possible moment to find it was in production**, which is the definition of a
 *  bug that needs a guard rather than a fix.
 *
 *  ## The belief that caused it
 *
 *  `supabase/config.toml` claimed a client "calls `.from("v_pr_line")`
 *  unqualified, so the search path is what resolves them". That is wrong, and
 *  it was wrong in a way that survives being read: Supabase's **Extra search
 *  path** does add our schemas to `search_path`, and PostgREST's documentation
 *  is explicit that schemas listed there get **no API endpoints** — they exist
 *  so objects inside an exposed schema can reference them unqualified.
 *
 *  Exposing a schema says it may be addressed. Naming it on the request is what
 *  addresses it. Two settings that sound like one thing.
 *
 *  ## What it checks
 *
 *  For each client module it reads the schema that module binds with
 *  `.schema("…")`, collects every `.from()` and `.rpc()` name, and resolves each
 *  name against the migration ladder — which is where the schemas are actually
 *  declared. A name whose home schema is not the one its call names is a
 *  finding, and so is a name the ladder does not declare at all.
 *
 *  A call may name a schema inline —
 *  `supabaseBrowser().schema("ops_core").from("audit_log")` — and that is read
 *  as written. Exactly one call does today: the audit log belongs to `ops_core`
 *  because there is one trail for the whole system, not one per service.
 *
 *    node scripts/check-api-schemas.mjs
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..");
const API = join(ROOT, "src/lib/api");

/* ── where every object actually lives ────────────────────────────────── */

/** `name` → `ops_x`, read from the ladder rather than from a running database,
 *  so this answers the same question in CI, on a laptop, and before anything
 *  has been applied anywhere. */
function schemaOfEveryObject() {
  const dir = join(ROOT, "supabase/migrations");
  const home = new Map();

  const DECL = new RegExp(
    "create\\s+(?:or\\s+replace\\s+)?"
    + "(?:table|view|materialized\\s+view|function|procedure)\\s+"
    + "(?:if\\s+not\\s+exists\\s+)?"
    + "(ops_[a-z]+)\\.([a-z_][a-z0-9_]*)",
    "gi",
  );

  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith(".sql")) continue;
    /* Comments in this repository discuss these names at length, on purpose. */
    const sql = readFileSync(join(dir, file), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/^\s*--.*$/gm, "");
    for (const m of sql.matchAll(DECL)) home.set(m[2].toLowerCase(), m[1].toLowerCase());
  }
  return home;
}

/* ── what each client module asks for ─────────────────────────────────── */

/** Strings and line comments blanked, so a name discussed in prose is never
 *  read as a call. The same one-pass scanner `check-live-routes.mjs` uses, and
 *  for the same reason: blanking with two regexes lets an apostrophe in a
 *  sentence open a string that swallows the code after it. */
function blankProse(src) {
  let out = "";
  let i = 0;
  let mode = null; // "line" | "block" | "s" | "d" | "t"
  while (i < src.length) {
    const c = src[i];
    const two = src.slice(i, i + 2);
    if (mode === null) {
      if (two === "//") { mode = "line"; out += "  "; i += 2; continue; }
      if (two === "/*") { mode = "block"; out += "  "; i += 2; continue; }
      if (c === "'") { mode = "s"; out += c; i++; continue; }
      if (c === '"') { mode = "d"; out += c; i++; continue; }
      if (c === "`") { mode = "t"; out += c; i++; continue; }
      out += c; i++; continue;
    }
    if (mode === "line") {
      if (c === "\n") { mode = null; out += c; } else out += " ";
      i++; continue;
    }
    if (mode === "block") {
      if (two === "*/") { mode = null; out += "  "; i += 2; continue; }
      out += c === "\n" ? c : " "; i++; continue;
    }
    /* Inside a string. Kept, because the call's argument IS a string and it is
       exactly what this script needs to read. Only the closer ends it. */
    out += c;
    if (c === "\\") { out += src[i + 1] ?? ""; i += 2; continue; }
    if ((mode === "s" && c === "'") || (mode === "d" && c === '"') || (mode === "t" && c === "`")) {
      mode = null;
    }
    i++;
  }
  return out;
}

const home = schemaOfEveryObject();
const problems = [];
let checked = 0;

for (const file of readdirSync(API).sort()) {
  if (!file.endsWith(".ts") || file.startsWith("_") || file === "index.ts") continue;
  const mod = file.replace(/\.ts$/, "");
  const src = blankProse(readFileSync(join(API, file), "utf8"));

  /* The module's default, from its `db()` helper. A module with none makes no
     PostgREST calls at all, or is about to be a finding on every line. */
  const bound = src.match(/supabaseBrowser\(\)\s*\.schema\("(ops_[a-z]+)"\)/);
  if (!bound) continue;
  const fallback = bound[1];

  /* Each call, with **what it was called on**.
   *
   *  The first version of this matched `.from("x")` and assumed the module's
   *  bound schema, which made it blind to the one thing it exists to catch: a
   *  call that never went through the helper at all. Fifteen did — `const sb =
   *  supabaseBrowser()` on one line and `.from(…)` on the next — and the guard
   *  passed them while `/it/pengguna` answered *Could not find the table
   *  'public.v_user_access'*. The receiver is the whole question, so it is what
   *  is matched.
   *
   *  `[\s\S]*?` rather than `\s*` between the receiver and the call: a chained
   *  builder wraps across lines, and a pattern that stops at a newline is
   *  exactly how the fifteen got through in the first place. */
  const CALL =
    /(db\(\)|\.schema\("(ops_[a-z]+)"\)|supabaseBrowser\(\)|\bsb\b)\s*\n?\s*\.(from|rpc)\("([a-z_][a-z0-9_]*)"\)/g;
  for (const m of src.matchAll(CALL)) {
    const receiver = m[1];
    const name = m[4];
    checked++;

    if (receiver === "supabaseBrowser()" || receiver === "sb") {
      problems.push(
        `  ${mod}.ts  .${m[3]}("${name}")  — called on an unbound client;`
        + ` PostgREST will look in \`public\`.`,
      );
      continue;
    }
    const named = m[2] ?? fallback;

    const lives = home.get(name);
    if (!lives) {
      problems.push(
        `  ${mod}.ts  .${m[2]}("${name}")  — no migration declares this object.`,
      );
      continue;
    }
    if (lives !== named) {
      problems.push(
        `  ${mod}.ts  .${m[2]}("${name}")  — asks ${named}, lives in ${lives}.`,
      );
    }
  }
}

if (problems.length) {
  console.error("a client call names the wrong schema.\n");
  console.error(problems.join("\n"));
  console.error(
    "\nPostgREST does not search: it resolves against the one schema the request"
    + "\nnames, and with none it uses `public`, which this project keeps empty."
    + "\nThe failure is invisible until a real request is made — `tsc` sees a"
    + "\nstring, the demo never reaches PostgREST, and the smoke files talk to"
    + "\nPostgres directly. Fix the call with `.schema(\"…\")`, or move the object.",
  );
  process.exit(1);
}

console.log(`api schemas                                 ok (${checked} calls)`);
