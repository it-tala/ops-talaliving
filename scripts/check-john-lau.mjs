#!/usr/bin/env node
/** Refuse a John Lau who offers a question he cannot answer.
 *
 *  ## The bug this exists for
 *
 *  F64 is *the demo's own suggestion chip not working*: the dock offered
 *  **stoknya menipis**, the router had the rule written as **stok menipis**,
 *  and the one sentence the application itself proposed was the one it did not
 *  understand. It was found by somebody clicking it.
 *
 *  The same failure now has two more ways to happen, and both are quieter:
 *
 *  1. The router lives in `ops_asst.rules` and the suggestions live in
 *     `src/lib/messages.ts`. They are edited in different files, in different
 *     languages, by different kinds of change — a migration and a string.
 *
 *  2. A tool can be in the catalogue, reachable, permitted, and have **no data
 *     behind it**. `inventory.low_stock` routes perfectly and answers *that
 *     module has nothing in it yet*, because `ops_inv` has no tables. A
 *     suggestion is a promise; offering that one is breaking it in the most
 *     visible place the application has.
 *
 *  ## What it checks
 *
 *  Every sentence in `EXAMPLES`, in both languages, is put through the real
 *  `ops_asst.route()` against a database with the ladder applied — not a
 *  re-implementation of it, because a re-implementation is a second router
 *  that agrees until it does not.
 *
 *    * it has to match something. A suggestion that answers *saya tidak
 *      mengerti* teaches people the application is unreliable in the first
 *      sentence they ever try.
 *
 *    * and the tool it matches has to be one `src/lib/api/assistant.ts`
 *      actually answers — unless it is `blocked`, which is deliberate:
 *      *Berapa gaji Karjo?* is in the list **because** it is refused, and
 *      seeing the refusal explained is the point of it being there.
 *
 *  It also asks the reverse question, which is the one that rots: every
 *  readable tool in the catalogue must have a branch in the client, answered
 *  or explicitly not-built. A tool that falls through to the default is a tool
 *  somebody added to the database and never wired, and the default is the only
 *  thing that would ever have said so.
 *
 *    node scripts/check-john-lau.mjs
 */

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname, resolve } from "node:path";

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..");

/* ── what the dock offers ─────────────────────────────────────────────── */

function examples() {
  const src = readFileSync(join(ROOT, "src/lib/messages.ts"), "utf8");
  const block = src.match(/EXAMPLES: Record<"en" \| "id", string\[\]> = \{([\s\S]*?)\n\};/);
  if (!block) throw new Error("EXAMPLES not found in src/lib/messages.ts");
  return [...block[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)]
    .map((m) => m[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\"));
}

/* ── what the client answers ──────────────────────────────────────────── */

/** The `case` labels inside `readFor`, split by whether the branch calls
 *  `notBuilt`. Read from the file rather than listed here for the reason every
 *  other list in `scripts/` is: a hand-kept scope stops covering the newest
 *  thing first (F94). */
function branches() {
  const src = readFileSync(join(ROOT, "src/lib/api/assistant.ts"), "utf8");
  const body = src.slice(src.indexOf("switch (src) {"));
  const answered = new Set();
  const notBuilt = new Set();
  const parts = body.split(/case "([\w.]+)":/);
  /* `parts[0]` is everything before the first case; then name, block, name,
     block … */
  for (let i = 1; i < parts.length; i += 2) {
    const name = parts[i];
    const block = (parts[i + 1] ?? "").split(/\n\s*(?:case "|default:)/)[0];
    (block.includes("notBuilt(") ? notBuilt : answered).add(name);
  }
  return { answered, notBuilt };
}

/* ── the router and the catalogue, from a database ────────────────────── */

function ask(sql) {
  try {
    return execFileSync("psql", ["-tAc", sql], {
      encoding: "utf8",
      env: { ...process.env, PGDATABASE: process.env.PGDATABASE ?? "postgres" },
    });
  } catch (e) {
    console.error(
      "could not reach the router. This check needs a database with the ladder"
      + "\napplied — `supabase/local/rebuild.sh` — and PGHOST/PGPORT/PGUSER set"
      + "\nthe way that script wants them.\n\n" + String(e.message).trim(),
    );
    process.exit(2);
  }
}

const quoted = (s) => "'" + s.replace(/'/g, "''") + "'";

const prompts = examples();
const routed = new Map();
{
  const sql =
    "select s || E'\\t' || coalesce(ops_asst.route(s) ->> 'tool', '') "
    + "from unnest(array[" + prompts.map(quoted).join(",") + "]) s";
  for (const line of ask(sql).trim().split("\n").filter(Boolean)) {
    const [s, tool] = line.split("\t");
    routed.set(s, tool || null);
  }
}

const tools = new Map();
for (const line of ask(
  "select name || ' ' || effect || ' ' || reach from ops_asst.tools",
).trim().split("\n").filter(Boolean)) {
  const [name, effect, reach] = line.trim().split(" ");
  tools.set(name, { effect, reach });
}

/* ── the findings ─────────────────────────────────────────────────────── */

const { answered, notBuilt } = branches();
const findings = [];

for (const s of prompts) {
  const tool = routed.get(s);
  if (!tool) {
    findings.push(
      `the dock offers "${s}" and the router does not understand it.\n`
      + "     A suggestion is a promise, and this one answers *saya tidak mengerti*\n"
      + "     in the first sentence anybody ever tries. Add the phrasing to a rule in\n"
      + "     `ops_asst.rules`, or offer a sentence that works.",
    );
    continue;
  }
  const t = tools.get(tool);
  if (!t) {
    findings.push(`"${s}" routes to ${tool}, which is not in the catalogue.`);
    continue;
  }
  /* A blocked suggestion is deliberate: it is there so somebody sees the
     refusal explained rather than discovering it on a Tuesday. */
  if (t.reach === "blocked") continue;
  if (t.effect !== "read") continue;
  if (notBuilt.has(tool)) {
    findings.push(
      `the dock offers "${s}", which routes to ${tool} — and the client answers\n`
      + "     *that module has nothing in it yet*. Offering it is promising an answer\n"
      + "     the new system cannot give. Swap the suggestion until the module lands.",
    );
  } else if (!answered.has(tool)) {
    findings.push(
      `"${s}" routes to ${tool}, which \`readFor\` has no branch for at all.`,
    );
  }
}

/* And the reverse: a readable tool nobody wired. */
for (const [name, t] of tools) {
  if (t.reach === "blocked" || t.effect !== "read") continue;
  if (!answered.has(name) && !notBuilt.has(name)) {
    findings.push(
      `${name} is readable in the catalogue and \`readFor\` has no branch for it,\n`
      + "     so it falls through to the default. Answer it, or say it is not built —\n"
      + "     by name, so the next person reading the switch can see which it is.",
    );
  }
}

if (findings.length) {
  console.error("john lau\n");
  for (const f of findings) console.error("  ✗  " + f + "\n");
  console.error(
    "F64 was the dock offering a sentence its own router did not understand,\n"
    + "found by somebody clicking it. This is that check.",
  );
  process.exit(1);
}

const built = [...answered].length;
console.log(
  "john lau".padEnd(44)
  + `ok (${prompts.length} suggestions route, ${built} tools answer, `
  + `${notBuilt.size} waiting on a module)`,
);
