#!/usr/bin/env node
/** Derive which routes may open against the real database, and refuse a
 *  `src/lib/live.ts` that disagrees.
 *
 *  ## Why a script rather than a list somebody keeps
 *
 *  `LIVE_ROUTES` decides what a business booking real money is allowed to open.
 *  Kept by hand it is correct on the day it is written and wrong the first time
 *  somebody adds one `hr.` call to a procurement screen — and wrong silently,
 *  because the route stays in the list and the screen still renders right up
 *  until that call runs against a schema with no tables in it.
 *
 *  ## Why it follows imports instead of grepping the route folder
 *
 *  The first version scanned each route's own files, and it would have been
 *  wrong about nearly every screen that matters. `<EvidenceStrip>` lives in
 *  `src/components`, calls `documents.*`, and is the single component the
 *  ledger drawer and the PR line drawer both attach evidence through (D93,
 *  M9) — so a grep of `src/app/(app)/accounting/ledger` sees no `documents.`
 *  at all and calls the screen live. It is not: opening it in live mode would
 *  render an evidence strip pointed at a service that does not exist.
 *
 *  A dependency you cannot see is still a dependency, so this walks the import
 *  graph from each `page.tsx` through everything under `src/` and collects the
 *  service calls of the whole reachable set.
 *
 *    node scripts/check-live-routes.mjs           # verify (CI)
 *    node scripts/check-live-routes.mjs --write   # regenerate the list
 */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..");
const APP = join(ROOT, "src/app/(app)");
const LIVE_TS = join(ROOT, "src/lib/live.ts");

/* Every service a screen can call, whether or not it is implemented. Taken
   from `src/demo/api/index.ts`, which is the complete list by construction:
   it is what screens import. */
const ALL_SERVICES = [
  "identity", "procurement", "accounting", "documents",
  "hr", "production", "inventory", "marketing", "delivery", "assistant",
];

/* Implemented = exported by `src/lib/api/index.ts`. Read rather than assumed,
   so adding a service to the live set means writing it, not editing a list. */
function liveServices() {
  const src = readFileSync(join(ROOT, "src/lib/api/index.ts"), "utf8");
  return ALL_SERVICES.filter((s) => new RegExp(`export \\* as ${s} from`).test(src));
}

/* ── the import graph ──────────────────────────────────────────────────── */

function resolveImport(spec, fromFile) {
  let base;
  if (spec.startsWith("@/")) base = join(ROOT, "src", spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(fromFile), spec);
  else return null;                                   // a package, not our code

  for (const c of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+["']([^"']+)["']/g;

/** Every service called by this file or anything it imports, transitively. */
function servicesReachableFrom(entry) {
  const seen = new Set();
  const found = new Set();
  const stack = [entry];

  while (stack.length) {
    const file = stack.pop();
    if (seen.has(file)) continue;
    seen.add(file);

    const src = readFileSync(file, "utf8");
    for (const s of ALL_SERVICES) {
      /* `accounting.listAccounts(` — a call, not the word. The negative
         lookbehind keeps `procurement.accounting` and `foo.hr` out of it. */
      if (new RegExp(`(?<![A-Za-z0-9_.])${s}\\.[a-zA-Z]`).test(src)) found.add(s);
    }

    for (const m of src.matchAll(IMPORT_RE)) {
      const target = resolveImport(m[1], file);
      if (!target || !target.startsWith(join(ROOT, "src"))) continue;
      /* The service layers are leaves, never nodes to walk into.
         `src/demo/api/index.ts` is a barrel that re-exports all eleven
         services, so following it made every screen in the application look
         like it needed every service — which is true of the barrel and true of
         nothing else. What a screen depends on is which binding it *calls*,
         and that is visible in the screen. */
      if (target.startsWith(join(ROOT, "src/demo")) || target.startsWith(join(ROOT, "src/lib/api"))) continue;
      stack.push(target);
    }
  }
  return found;
}

/* ── the routes ───────────────────────────────────────────────────────── */

function routeDirs(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) routeDirs(p, out);
    else if (e === "page.tsx") out.push(dir);
  }
  return out;
}

const LIVE = liveServices();

/* `/demo` is the fixtures sandbox and the guided tour. It is demo-only by
   definition, never live, and listing it would be a category error rather than
   a missing implementation. */
const routes = routeDirs(APP)
  .map((d) => "/" + relative(APP, d).split("/").join("/"))
  .filter((r) => r !== "/" && !r.startsWith("/demo"))
  .sort();

/* A route's module, from its first segment. The second half of the gate: a
   screen that happens to call no service at all is not therefore live —
   `/inventory/papan` calls nothing and is still an inventory screen, sitting in
   a module whose schema has no tables in it. Being live has to mean *this
   module is open for business*, not *this file compiled*. */
const MODULE_OF = {
  dashboard: "dashboard", hrd: "hrd", procurement: "procurement", inventory: "inventory",
  accounting: "accounting", marketing: "marketing", proyek: "project", produksi: "production",
  it: "it", pengaturan: "settings", "john-lau": "assistant", box: "project",
};

/* The modules this deployment opens. Procurement and accounting are the two the
   owner is going live with; identity carries IT and settings, and the dashboard
   reads only from those two. Everything else waits for its service. */
const LIVE_MODULES = ["dashboard", "procurement", "accounting", "it", "settings"];

const verdict = routes.map((r) => {
  const entry = join(APP, r.slice(1), "page.tsx");
  const used = [...servicesReachableFrom(entry)].sort();
  const mod = MODULE_OF[r.split("/")[1]] ?? "unknown";
  const missing = used.filter((s) => !LIVE.includes(s));
  return {
    route: r, used, module: mod, missing,
    live: missing.length === 0 && LIVE_MODULES.includes(mod),
  };
});

const expected = verdict.filter((v) => v.live).map((v) => v.route);

/* ── compare, or write ────────────────────────────────────────────────── */

const file = readFileSync(LIVE_TS, "utf8");
const BLOCK = /(export const LIVE_ROUTES: readonly string\[\] = \[)([\s\S]*?)(\n\];)/;
const m = file.match(BLOCK);
if (!m) {
  console.error("could not find LIVE_ROUTES in src/lib/live.ts");
  process.exit(1);
}
const actual = [...m[2].matchAll(/"([^"]+)"/g)].map((x) => x[1]);

if (process.argv.includes("--write")) {
  const body = expected.map((r) => `\n  ${JSON.stringify(r)},`).join("");
  writeFileSync(LIVE_TS, file.replace(BLOCK, `$1${body}$3`));
  console.log(`live routes                                 written (${expected.length})`);
  process.exit(0);
}

const missing = expected.filter((r) => !actual.includes(r));
const extra = actual.filter((r) => !expected.includes(r));

if (missing.length || extra.length) {
  console.error("src/lib/live.ts does not match the code.\n");
  for (const r of extra) {
    const v = verdict.find((x) => x.route === r);
    const why = !v ? "no longer a route"
      : v.missing.length ? `needs ${v.missing.join(", ")}`
      : `module "${v.module}" is not live`;
    console.error(`  listed as live, but is not: ${r}  → ${why}`);
  }
  for (const r of missing) console.error(`  live but not listed:        ${r}`);
  console.error("\nRegenerate with: node scripts/check-live-routes.mjs --write");
  process.exit(1);
}

console.log(`live routes                                 ok (${expected.length} of ${routes.length} live)`);
