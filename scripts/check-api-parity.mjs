#!/usr/bin/env node
/** Refuse a real client that answers a different shape from the demo.
 *
 *  ## Why this exists
 *
 *  `src/demo/api/*` and `src/lib/api/*` are supposed to be interchangeable —
 *  same names, same arguments, same answers — so that a screen cannot tell
 *  which one it got (ADR-009). Everything about the swap depends on it: the
 *  switchboard in `src/demo/api/index.ts` is one file rather than fifty-two
 *  edits precisely because the two modules are meant to be the same shape.
 *
 *  Nothing checked it, and nothing could, because until the switchboard existed
 *  **no file imported both**. TypeScript never saw them side by side. The first
 *  time anything did, 37 of the 98 shared functions disagreed.
 *
 *  They disagree in ways that reach a person rather than a reviewer:
 *
 *    `approvePo`       answers `unknown`; the screen redraws a `PoDetail`
 *    `curateVendor`    takes a code here and a uuid there — both `string`
 *    `createItem`      takes `base_uom?: string` against eighteen `UomCode`s
 *    `listAccounts`    read the plain rows while `listAccountRows` read the
 *                      balances, which is exactly backwards from the demo
 *
 *  That last one is the shape of the whole problem: `AccountBalance` has every
 *  field `Account` has, so it is assignable to it, so **half of a swapped pair
 *  raises no error at all**. It would have been found by somebody noticing a
 *  blank column in production.
 *
 *  ## How it checks
 *
 *  By asking TypeScript, because nothing else can answer this. It writes a
 *  probe file that assigns each real function to the demo's type of the same
 *  name, type-checks it, and reads back which assignments failed:
 *
 *      const _procurement_approvePo: typeof demo.approvePo = live.approvePo;
 *
 *  Then it compares that set against `PENDING_PARITY` in
 *  `src/lib/api/_pending.ts` and fails on a difference **in either direction**:
 *
 *    - a mismatch that is not listed — new drift, or a function somebody added
 *      to the real client without matching the contract;
 *    - a listed name that now type-checks — the fix landed and the list is
 *      stale, which matters because `swap()` still refuses everything on it.
 *      A function that works while the list says it does not is a screen left
 *      dark for no reason.
 *
 *  So the list cannot rot in either direction, and **it only ever shrinks**:
 *  removing a line is the unit of progress for finishing B2/B3, and the removal
 *  has to arrive with the fix that earns it.
 *
 *    node scripts/check-api-parity.mjs
 */

import { readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname, resolve } from "node:path";

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..");

/* The services that have a real client at all. A service with no
   `src/lib/api/<name>.ts` has nothing to compare and is not drift — it is B2/B3
   not having reached it, which `check-live-routes.mjs` already reports. */
const SERVICES = ["identity", "procurement", "accounting", "documents", "marketing"];

/** Every `export function` / `export async function` name in a module. */
function exportedFunctions(path) {
  const src = readFileSync(path, "utf8");
  return new Set(
    [...src.matchAll(/^export (?:async )?function ([a-zA-Z_][\w]*)/gm)].map((m) => m[1]),
  );
}

/* ── build the probe ──────────────────────────────────────────────────── */

const lines = [];
const imports = [];
/** probe line number → `service.function`, so a tsc error can be named. */
const byLine = new Map();

for (const svc of SERVICES) {
  imports.push(`import * as demo_${svc} from "@/demo/api/${svc}";`);
  imports.push(`import * as live_${svc} from "@/lib/api/${svc}";`);
}

const shared = [];
for (const svc of SERVICES) {
  const demo = exportedFunctions(join(ROOT, `src/demo/api/${svc}.ts`));
  const live = exportedFunctions(join(ROOT, `src/lib/api/${svc}.ts`));
  for (const fn of [...demo].filter((f) => live.has(f)).sort()) {
    shared.push(`${svc}.${fn}`);
    lines.push(
      `export const _${svc}_${fn}: typeof demo_${svc}.${fn} = live_${svc}.${fn};`,
    );
    byLine.set(imports.length + lines.length + 1, `${svc}.${fn}`);
  }
}

const PROBE = join(ROOT, "src/__api_parity_probe.ts");
writeFileSync(PROBE, [...imports, "", ...lines].join("\n") + "\n");

/* ── ask TypeScript ───────────────────────────────────────────────────── */

let output = "";
try {
  execFileSync("npx", ["tsc", "--noEmit", "-p", "tsconfig.json"], {
    cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  });
} catch (e) {
  output = `${e.stdout ?? ""}${e.stderr ?? ""}`;
} finally {
  rmSync(PROBE, { force: true });
}

/* An error anywhere else means the repository does not compile, which is a
   different and larger problem than parity — say so rather than reporting a
   confusing parity result derived from a broken build. */
const elsewhere = output
  .split("\n")
  .filter((l) => /^src\/.*error TS/.test(l) && !l.startsWith("src/__api_parity_probe.ts"));
if (elsewhere.length) {
  console.error("the project does not type-check, so parity cannot be measured.\n");
  console.error(elsewhere.slice(0, 10).join("\n"));
  process.exit(1);
}

const found = new Set();
for (const m of output.matchAll(/^src\/__api_parity_probe\.ts\((\d+),/gm)) {
  const name = byLine.get(Number(m[1]));
  if (name) found.add(name);
}

/* ── compare with the list ────────────────────────────────────────────── */

const pendingSrc = readFileSync(join(ROOT, "src/lib/api/_pending.ts"), "utf8");
const block = pendingSrc.match(/PENDING_PARITY: readonly string\[\] = \[([\s\S]*?)\n\];/);
if (!block) {
  console.error("could not find PENDING_PARITY in src/lib/api/_pending.ts");
  process.exit(1);
}
const listed = new Set(
  [...block[1].matchAll(/"([a-z]+\.[a-zA-Z]+)"/g)].map((m) => m[1]),
);

const unlisted = [...found].filter((n) => !listed.has(n)).sort();
const stale = [...listed].filter((n) => !found.has(n)).sort();

if (unlisted.length || stale.length) {
  console.error("the demo and the real client disagree, and the list is wrong.\n");
  if (unlisted.length) {
    console.error("  NEW drift — these answer a different shape and are not listed:");
    for (const n of unlisted) console.error(`      ${n}`);
    console.error(
      "\n  Either fix the real client to match the contract, or add the name to"
      + "\n  PENDING_PARITY with one line saying how it differs. Adding it means"
      + "\n  `swap()` refuses the call and the routes that reach it go dark —"
      + "\n  which is the honest state, not a workaround.\n",
    );
  }
  if (stale.length) {
    console.error("  FIXED — these now match and must come off the list:");
    for (const n of stale) console.error(`      ${n}`);
    console.error(
      "\n  `swap()` still refuses everything on the list, so leaving a working"
      + "\n  function there keeps a screen dark for no reason. Remove the line"
      + "\n  and regenerate LIVE_ROUTES.\n",
    );
  }
  process.exit(1);
}

const ok = shared.length - found.size;
console.log(
  `api parity                                  ok (${ok} of ${shared.length} match`
  + `${found.size ? `, ${found.size} pending` : ""})`,
);
