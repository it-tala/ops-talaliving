#!/usr/bin/env node
/** Refuse a permission catalogue that exists twice and says two things.
 *
 *  ## Why this exists
 *
 *  The same catalogue is written down in two places, and it has to be:
 *
 *    `src/lib/roles.ts`            what `can()` offers a screen
 *    `ops_core.permission_catalog` what `has_permission()` will grant
 *
 *  Neither can be derived from the other at build time — one is TypeScript a
 *  browser reads, the other is rows a policy reads inside Postgres. So they are
 *  kept by hand, which means they drift, which is not a risk but a schedule.
 *
 *  They had already drifted by two entries when this was written, and both
 *  failed **silently**, which is the shape worth guarding against:
 *
 *    `it.purge_activity`    — `has_permission` returned false for everybody,
 *                             admin included, because the row did not exist.
 *    `accounting.plan_cash` — `/accounting/calendar` asks `can()` for it, and
 *                             `permissions` is expanded from the *database*
 *                             catalogue through `v_my_access`. So the cash
 *                             estimates were read-only for every person in the
 *                             company: no error, no refusal, just buttons that
 *                             were never drawn.
 *
 *  Nobody was going to notice either one from reading. A screen that quietly
 *  offers less than it should is the failure this project keeps finding, and it
 *  is always cheaper to have a script hold the two lists side by side.
 *
 *  ## What it compares
 *
 *  Every `module.action`, in both directions, and whether each is admin-only.
 *  `admin_only` matters as much as existence: a permission the database will
 *  hand to `write` while the frontend reserves it for `admin` is a control that
 *  looks stricter than it is, which is the more dangerous direction of the two.
 *
 *    node scripts/check-permissions.mjs
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..");

/* ── the frontend's ───────────────────────────────────────────────────── */

function fromRoles() {
  const src = readFileSync(join(ROOT, "src/lib/roles.ts"), "utf8");

  const cat = src.match(/PERMISSION_CATALOG[^=]*=\s*\{([\s\S]*?)\n\}/);
  if (!cat) throw new Error("PERMISSION_CATALOG not found in src/lib/roles.ts");

  const adminOnly = new Set();
  const admin = src.match(/ADMIN_ONLY\s*=\s*new Set\(\[([^\]]*)\]\)/);
  if (!admin) throw new Error("ADMIN_ONLY not found in src/lib/roles.ts");
  for (const v of admin[1].split(",")) {
    const t = v.trim().replace(/["']/g, "");
    if (t) adminOnly.add(t);
  }

  const out = new Map();
  for (const line of cat[1].split("\n")) {
    const m = line.match(/^\s*([a-z_]+)\s*:\s*\[([^\]]*)\]/);
    if (!m) continue;
    for (const v of m[2].split(",")) {
      const action = v.trim().replace(/["']/g, "");
      if (!action) continue;
      out.set(`${m[1]}.${action}`, adminOnly.has(action));
    }
  }
  return out;
}

/* ── the database's ───────────────────────────────────────────────────── */

/** Every row any migration inserts into the catalogue.
 *
 *  Read from the ladder rather than from a running database, so this answers
 *  the same question in CI, on a laptop, and before anything has been applied
 *  anywhere. Later migrations add rows; none removes one, and if that ever
 *  changes this has to learn about deletes.
 */
function fromMigrations() {
  const dir = join(ROOT, "supabase/migrations");
  const out = new Map();

  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith(".sql")) continue;
    const sql = readFileSync(join(dir, file), "utf8")
      /* Comments discuss these names at length, on purpose. */
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/^\s*--.*$/gm, "");

    const re = /insert\s+into\s+ops_core\.permission_catalog[^;]*?values([\s\S]*?);/gi;
    for (const stmt of sql.matchAll(re)) {
      const rows = stmt[1].matchAll(
        /\(\s*'([a-z_]+)'\s*,\s*'([a-z_]+)'\s*,\s*(true|false|t|f)\s*\)/gi,
      );
      for (const r of rows) {
        out.set(`${r[1]}.${r[2]}`, /^(true|t)$/i.test(r[3]));
      }
    }
  }
  return out;
}

/* ── compare ──────────────────────────────────────────────────────────── */

const ts = fromRoles();
const db = fromMigrations();

const problems = [];

for (const [code, adminOnly] of ts) {
  if (!db.has(code)) {
    problems.push(`  in roles.ts, missing from the ladder:  ${code}`);
  } else if (db.get(code) !== adminOnly) {
    problems.push(
      `  admin_only disagrees:                  ${code}`
      + `  — roles.ts says ${adminOnly}, the ladder says ${db.get(code)}`,
    );
  }
}
for (const code of db.keys()) {
  if (!ts.has(code)) {
    problems.push(`  in the ladder, missing from roles.ts:  ${code}`);
  }
}

if (problems.length) {
  console.error("the permission catalogue says two different things.\n");
  console.error(problems.join("\n"));
  console.error(
    "\nA permission in only one of them fails silently: `can()` hides a control"
    + "\nnobody can reach, or the database grants one no screen offers."
    + "\nBoth lists are hand-kept — fix whichever is wrong and say which in the"
    + "\ncommit, because the disagreement is the interesting part.",
  );
  process.exit(1);
}

console.log(`permission catalogue                        ok (${ts.size} permissions)`);
