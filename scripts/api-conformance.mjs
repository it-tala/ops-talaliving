/** Do the two API implementations actually agree?
 *
 *  `src/lib/api/index.ts` says of itself: "The mirror of `src/demo/api/index.ts`,
 *  exporting the same module names with the same function signatures. A screen
 *  imports one or the other and cannot tell which it got, which is the entire
 *  design of the swap (ADR-009)."
 *
 *  That is a claim about two files, written in one of them, checked by nothing.
 *  When it was first measured (F94) it was false by 43 functions: a screen
 *  calling `listDue` after the swap would have got `undefined is not a function`,
 *  at runtime, in production, on a screen that looked finished.
 *
 *  So this is the check. It is a **ratchet, not a wall**: the gap that exists
 *  today is listed in KNOWN_GAP and passes, because failing the build over work
 *  that is already scheduled teaches people to pass `--no-verify`. Anything that
 *  drifts *newly* fails. KNOWN_GAP shrinking is the build session's progress bar,
 *  and it is the only honest measure of how close the swap is.
 *
 *  ## What this does and does not prove
 *
 *  It compares **export names**, resolved through the TypeScript compiler rather
 *  than by grepping for `export function` — `src/demo/api/identity.ts` exports one
 *  member as `export const`, and a regex that missed it would have reported a
 *  clean sheet for the wrong reason.
 *
 *  Matching names are necessary, **not sufficient**: two functions can share a
 *  name and disagree about every argument. Nothing here would notice. That proof
 *  belongs to `tsc`, and it arrives for free the moment the swap in
 *  `src/demo/api/index.ts` is written, because the two namespaces then have to be
 *  assignable to one another. Until then this is the cheaper half, and it says so
 *  rather than implying it covered the rest.
 *
 *  Run: `npm run check:api`
 */
import ts from "typescript";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVICES = ["identity", "procurement", "accounting"];

/** Exports that exist in the demo and must NEVER exist in the real client.
 *  Not a gap — an absence with a reason. */
const DEMO_ONLY = {
  identity: {
    actAs: "impersonation. Against a real database this is not a feature with a "
      + "guard missing, it is the absence of authentication (src/lib/api/index.ts).",
  },
  procurement: {},
  accounting: {},
};

/** The real client's outstanding work, measured 2026-09-17 (F94).
 *  Every name here is a screen that breaks if the swap is thrown today.
 *  The build session removes names from this list; nobody adds to it without
 *  saying why in the commit. */
const KNOWN_GAP = {
  identity: [
    /* Not a function to transcribe: the retention policy of D188 (Q22), which in
       Phase 2 belongs in `ops_core.settings` rather than a const in a client —
       two clients holding their own copy of "30 days" is D3's nine copies of the
       account list, one size down. No screen imports it today. */
    "RETENTION",
    "getRetention", "listActivity", "listActivityDaily", "listAudit",
    "listSettings", "purgeActivity", "recordActivity", "rollUpActivity",
    "updateSetting",
  ],
  procurement: [
    "answerBatch", "answerPoFromChat", "getProject", "getVendor",
    "lineForPosting", "listApprovalBatches", "listPoApprovals",
    "listProjectLines", "removeProjectLine", "saveProject", "saveProjectLine",
    "whereToBuy",
  ],
  accounting: [
    "addComponent", "bookStatementLine", "confirmIncoming",
    "coverageForDocument", "coverageForTransaction", "getContributionAudit",
    "getFunding", "getMonthDetail", "getMonthlyBills", "getStatement",
    "ignoreStatementLine", "importStatement", "listDue", "listFundings",
    "listIncoming", "listIncomingReview", "markComplete", "matchStatementLine",
    "postFromLine", "setStatementRate", "updateComponent",
  ],
};

/** Exports split by what they are, because the two fail differently.
 *
 *  A missing **value** — a function, a const — is a runtime failure: the screen
 *  renders, the user clicks, and `undefined is not a function`. A missing
 *  **type** is a compile failure, which is loud, early and free. Counting them
 *  together would inflate the number that matters and hide which names are
 *  actually dangerous. The first measurement did exactly that: 48, of which
 *  five were type aliases.
 *
 *  Re-exported symbols arrive as aliases, so the flags are read from the
 *  resolved symbol; otherwise every `export { X } from "./contracts"` reads as
 *  neither a value nor a type.
 */
function exportsOf(program, checker, file) {
  const sf = program.getSourceFile(file);
  if (!sf) throw new Error(`not in program: ${file}`);
  const sym = checker.getSymbolAtLocation(sf);
  if (!sym) return { values: [], types: [] };
  const values = [];
  const types = [];
  for (const raw of checker.getExportsOfModule(sym)) {
    const s = raw.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(raw) : raw;
    (s.flags & ts.SymbolFlags.Value ? values : types).push(raw.getName());
  }
  return { values: values.sort(), types: types.sort() };
}

const files = SERVICES.flatMap((s) => [
  path.join(ROOT, "src/demo/api", `${s}.ts`),
  path.join(ROOT, "src/lib/api", `${s}.ts`),
]);

const cfgPath = ts.findConfigFile(ROOT, ts.sys.fileExists, "tsconfig.json");
const cfg = ts.parseJsonConfigFileContent(
  ts.readConfigFile(cfgPath, ts.sys.readFile).config, ts.sys, ROOT,
);
const program = ts.createProgram(files, { ...cfg.options, noEmit: true });
const checker = program.getTypeChecker();

let broke = false;
let gapTotal = 0;
const lines = [];

for (const svc of SERVICES) {
  const demo = exportsOf(program, checker, path.join(ROOT, "src/demo/api", `${svc}.ts`));
  const real = exportsOf(program, checker, path.join(ROOT, "src/lib/api", `${svc}.ts`));
  const demoOnly = DEMO_ONLY[svc] ?? {};
  const known = new Set(KNOWN_GAP[svc] ?? []);

  // In the demo, absent from the real client: a screen that breaks after the swap.
  const missing = demo.values.filter((n) => !real.values.includes(n) && !(n in demoOnly));
  // In the real client, absent from the demo: unreachable through the seam.
  const extra = real.values.filter((n) => !demo.values.includes(n));
  // Types fail at compile time, so they are reported and never fatal here.
  const typeGap = demo.types.filter((n) => !real.types.includes(n));

  const fresh = missing.filter((n) => !known.has(n));
  const closed = [...known].filter((n) => real.values.includes(n));

  gapTotal += missing.length;
  lines.push(`${svc.padEnd(12)} demo ${String(demo.values.length).padStart(3)}  real ${String(real.values.length).padStart(3)}`
    + `  gap ${String(missing.length).padStart(2)}  unreachable ${String(extra.length).padStart(2)}`
    + `  types missing ${String(typeGap.length).padStart(2)}`);

  if (fresh.length) {
    broke = true;
    lines.push(`  NEW DRIFT — in the demo, missing from the real client, not in KNOWN_GAP:`);
    fresh.forEach((n) => lines.push(`    ${n}`));
  }
  if (closed.length) {
    lines.push(`  now implemented (remove from KNOWN_GAP): ${closed.join(", ")}`);
  }
  if (extra.length) {
    lines.push(`  in the real client, unreachable through the seam: ${extra.join(", ")}`);
  }
}

console.log(lines.join("\n"));
console.log(`\n${gapTotal} value(s) a screen could call today and not find after the swap.`);
console.log("Types are counted apart: a missing type stops the build, which is loud and free;");
console.log("a missing function reaches the user.");
console.log("Names only — matching names do not prove matching signatures. tsc does that,");
console.log("once the swap in src/demo/api/index.ts is written.");

if (broke) {
  console.error("\nFAIL: the two implementations drifted apart somewhere new.");
  process.exit(1);
}
console.log("\nOK: no new drift.");
