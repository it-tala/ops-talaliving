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
 *  ## Why it counts functions and not services
 *
 *  It used to record only *which service* a screen called, and ask whether that
 *  service was exported from `src/lib/api/index.ts`. That passed a screen whose
 *  service exists but whose **function** does not — `/accounting/rekening-koran`
 *  calling `accounting.importStatement()` against a client that has never
 *  implemented it. The failure is the one described above, one level down: the
 *  route stays in the list, the screen still renders, and it breaks when the
 *  call runs. Eight of the seventeen routes listed live were in that state.
 *
 *  So a route is live when every `service.function` it reaches is exported by
 *  `src/lib/api/<service>.ts`. That also makes the list a to-do: a route drops
 *  out naming exactly which functions B2/B3 still owe it.
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

/* What each live service actually implements, by name. Read from the module
   rather than listed here, for the same reason as above: a list is correct on
   the day it is written. */
function implementedFunctions(service) {
  const f = join(ROOT, `src/lib/api/${service}.ts`);
  if (!existsSync(f)) return new Set();
  return new Set(
    [...readFileSync(f, "utf8").matchAll(/^export (?:async )?function ([A-Za-z0-9_]+)/gm)]
      .map((m) => m[1]),
  );
}

/* Functions that exist in the demo and deliberately never will in `src/lib/api`.
   Not gaps, so they must not hold a route back — but named, with the reason,
   because an unexplained exception is how a guard quietly stops guarding. */
const DEMO_ONLY = {
  "identity.actAs":
    "demo-only by design: impersonation against a real database is not a feature "
    + "with a guard missing, it is the absence of authentication. B5 removes the "
    + "caller in src/store/session.tsx.",
};

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

/** Source with strings and comments blanked, for the call scan only.
 *
 *  Permission codes are spelled exactly like service calls — `can("accounting.
 *  plan_cash")`, `can("procurement.update")` — and prose in this repository
 *  discusses `accounting.listDue` at length on purpose. Both would read as
 *  calls, so both have to go before the scan. Imports are matched against the
 *  untouched source, since blanking strings would take their paths with them.
 *
 *  It is a scanner rather than a few `replace` calls, and that is not
 *  fastidiousness. The first cut blanked strings with a regex and then
 *  comments, which meant an apostrophe in ordinary English — `don't`,
 *  `the system's` — opened a string that ran to the next apostrophe and
 *  swallowed whatever code lay between. It ate five real calls in
 *  `/it/aktivitas` and two in `/accounting/tagihan`, and it ate them
 *  *silently*: the guard reported fewer gaps, which reads exactly like
 *  progress. Blanking comments first only moves the hole, because `//` inside
 *  a URL string then starts a comment. One pass that knows which state it is
 *  in has no such ordering to get wrong.
 */
function blankNonCode(src) {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const d = src[i + 1];

    if (c === "/" && d === "/") {                       // line comment
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && d === "*") {                       // block comment
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
      out += " ";
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {          // string or template
      const quote = c;
      i++;
      while (i < src.length && src[i] !== quote) {
        if (src[i] === "\\") i++;                        // skip the escaped char
        i++;
      }
      i++;
      out += quote + quote;
      continue;
    }

    out += c;
    i++;
  }
  return out;
}

/** Every `service.function` called by this file or anything it imports. */
function servicesReachableFrom(entry) {
  const seen = new Set();
  const found = new Set();
  const stack = [entry];

  while (stack.length) {
    const file = stack.pop();
    if (seen.has(file)) continue;
    seen.add(file);

    const src = readFileSync(file, "utf8");
    const code = blankNonCode(src);
    for (const s of ALL_SERVICES) {
      /* `accounting.listAccounts` — the binding and the name it calls. The
         negative lookbehind keeps `procurement.accounting` and `foo.hr` out. */
      for (const m of code.matchAll(
        new RegExp(`(?<![A-Za-z0-9_.])${s}\\.([a-zA-Z][A-Za-z0-9_]*)`, "g"),
      )) found.add(`${s}.${m[1]}`);
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

const IMPL = Object.fromEntries(LIVE.map((s) => [s, implementedFunctions(s)]));

const verdict = routes.map((r) => {
  const entry = join(APP, r.slice(1), "page.tsx");
  const calls = [...servicesReachableFrom(entry)].sort();
  const used = [...new Set(calls.map((c) => c.split(".")[0]))].sort();
  const mod = MODULE_OF[r.split("/")[1]] ?? "unknown";

  /* Two ways to not be live, and they read differently in the output because
     they are different jobs: a whole service nobody has written, and a service
     that exists missing the function this screen happens to call. */
  const missing = used.filter((s) => !LIVE.includes(s));
  const unimplemented = calls.filter((c) => {
    const [svc, fn] = c.split(".");
    return LIVE.includes(svc) && !DEMO_ONLY[c] && !IMPL[svc].has(fn);
  });

  return {
    route: r, used, calls, module: mod, missing, unimplemented,
    live: missing.length === 0 && unimplemented.length === 0 && LIVE_MODULES.includes(mod),
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
      : v.unimplemented.length ? `src/lib/api has no ${v.unimplemented.join(", ")}`
      : `module "${v.module}" is not live`;
    console.error(`  listed as live, but is not: ${r}  → ${why}`);
  }
  for (const r of missing) console.error(`  live but not listed:        ${r}`);
  console.error("\nRegenerate with: node scripts/check-live-routes.mjs --write");
  process.exit(1);
}

console.log(`live routes                                 ok (${expected.length} of ${routes.length} live)`);
