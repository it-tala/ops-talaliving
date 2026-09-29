#!/usr/bin/env node
/** The AI's BOM proposal is held to the business's norms — checked by running
 *  the validator itself (0193, D338).
 *
 *  `toBomSuggestion` (`src/lib/bom-vision.ts`) is the one place a model's
 *  `waste_percent` is replaced by the norm it names, the way its price is
 *  replaced by the rate list's. Nothing on a screen shows the difference
 *  between *the norm said 25 %* and *the model said 20 % and cited the norm*,
 *  so this puts fixed model answers through the real function and refuses any
 *  line whose waste is not the one the rule gives:
 *
 *  - a waste norm is the waste as it stands (plywood 12 %);
 *  - a yield norm is converted for a costing that multiplies by
 *    `1 + waste ÷ 100` — 80 % yield is 25 % waste, not 20 % (F194);
 *  - overhead and contingency are never one line's waste — even filed under
 *    `Factor`, where the business also files *Waste kayu*, which is one;
 *  - a norm the model made up, or a waste no norm backs, stays with a warning;
 *  - with no norms at all, the model's own waste stands, as before 0193.
 *
 *  Bundled with esbuild (already in the tree for the Cloudflare build) because
 *  `bom-vision.ts` imports `@/…` and `server-only`; the latter is replaced by
 *  an empty module, since this is not a browser.
 *
 *    node scripts/check-bom-norms.mjs
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..");
const { build } = await import("esbuild");

const dir = mkdtempSync(join(tmpdir(), "bom-norms-"));
const out = join(dir, "bom.mjs");
const empty = join(dir, "empty.js");
writeFileSync(empty, "export {};\n");
try {
  await build({
    stdin: {
      contents: `export * from "@/lib/bom-vision"; export * from "@/lib/bom-norms";`,
      resolveDir: ROOT, loader: "ts",
    },
    bundle: true, format: "esm", platform: "node", outfile: out, logLevel: "error",
    alias: { "@": join(ROOT, "src"), "server-only": empty },
  });
} catch (e) {
  console.error(`could not bundle the validator:\n${e.message}`);
  rmSync(dir, { recursive: true, force: true });
  process.exit(2);
}
const m = await import(pathToFileURL(out).href);
rmSync(dir, { recursive: true, force: true });

const norm = (category, name, value, unit, source_kind = "industry") => ({
  id: name, category, norm: name, value, unit, basis: null, remarks: null, source_kind, effective_on: "2026-09-25",
});
const NORMS = [
  norm("Wood", "Square to finished component yield", 80, "%"),
  norm("Wood", "Log to square sawn yield", 55, "%"),
  norm("Panel", "Plywood cutting waste", 12, "%"),
  norm("Panel", "Standard sheet", 2.976, "m²/sheet", "decision"),
  norm("Factor", "Kontingensi / miskalkulasi", 5, "%", "decision"),
  norm("Overhead", "Factory overhead on direct cost", 17, "%", "empirical"),
  norm("Factor", "Waste kayu (log ke komponen)", 15, "%", "decision"),
  norm("Glass", "Breakage allowance for mirror >1 m²", 3, "%", "decision"),
  norm("Packing", "Packing material per m³ product", null, ""),
];
const RATES = [
  { id: "1", code: "RT-0001", name: "Kayu mindi grade A", rate_group: "kayu", uom: "m3", rate: 6_000_000,
    item_code: null, note: null, active: true, created_at: "", updated_at: "" },
  { id: "2", code: "RT-0002", name: "Plywood 18 mm", rate_group: "material", uom: "lembar", rate: 285_000,
    item_code: null, note: null, active: true, created_at: "", updated_at: "" },
];
const line = (part, rate_code, waste_percent, waste_norm, extra = {}) => ({
  part, kind: "material", rate_code, material: part, qty: 0.05, uom: rate_code === "RT-0002" ? "lembar" : "m3",
  waste_percent, waste_norm, working: null, confidence: "high", ...extra,
});
const base = { product_code: "PRD-X", drawing: null };

const failures = [];
const expect = (what, got, want) => {
  const same = JSON.stringify(got) === JSON.stringify(want);
  if (!same) failures.push(`${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

/* ── the pure rule ─────────────────────────────────────────────────────── */
expect("waste norm stands", m.wasteFromNorm(NORMS[2]), 12);
expect("80 % yield is 25 % waste", m.wasteFromNorm(NORMS[0]), 25);
expect("55 % yield is 81,8 % waste", m.wasteFromNorm(NORMS[1]), 81.8);
expect("a sheet size is not a waste", m.wasteFromNorm(NORMS[3]), null);
expect("contingency is the whole BOM's", m.wasteFromNorm(NORMS[4]), null);
expect("overhead is the whole BOM's", m.wasteFromNorm(NORMS[5]), null);
expect("a waste filed under Factor is still a line's", m.wasteFromNorm(NORMS.find((n) => n.norm.startsWith("Waste kayu"))), 15);
expect("a breakage allowance is a waste", m.wasteFromNorm(NORMS.find((n) => n.norm.startsWith("Breakage"))), 3);
expect("a blank norm is no figure", m.wasteFromNorm(NORMS.find((n) => n.category === "Packing")), null);
expect("found by `Category | Norm`", m.findNorm(NORMS, "panel | plywood cutting waste")?.norm, "Plywood cutting waste");
expect("found by `Category · Norm`", m.findNorm(NORMS, "Wood · Square to finished component yield")?.norm, "Square to finished component yield");
expect("found by a unique name alone", m.findNorm(NORMS, "Plywood cutting waste")?.category, "Panel");
expect("a made-up norm is not found", m.findNorm(NORMS, "Wood | Waste kayu"), null);

/* ── the validator, on fixed model answers ────────────────────────────── */
const s = m.toBomSuggestion({
  lines: [
    line("Kaki-kaki", "RT-0001", 20, "Wood | Square to finished component yield"),
    line("Panel belakang", "RT-0002", 8, "Panel | Plywood cutting waste"),
    line("Top", "RT-0001", 5, "Factor | Kontingensi / miskalkulasi"),
    line("Rangka samping", "RT-0001", 10, "Factor | Waste kayu (log ke komponen)"),
    line("Rangka", "RT-0001", 15, "Wood | Waste kayu"),
    line("Laci", "RT-0001", 18, null),
    line("Samping", "RT-0001", 0, null),
  ],
}, RATES, base, NORMS);
const by = Object.fromEntries(s.lines.map((l) => [l.part, l]));
expect("norms counted", s.norms, NORMS.length);
expect("yield norm → the norm's waste, not the model's 20", [by["Kaki-kaki"].waste_percent, by["Kaki-kaki"].waste_norm],
  [25, "Wood · Square to finished component yield"]);
expect("waste norm → 12, not the model's 8", [by["Panel belakang"].waste_percent, by["Panel belakang"].waste_norm],
  [12, "Panel · Plywood cutting waste"]);
expect("no warning where a norm backs the waste", by["Kaki-kaki"].warnings, []);
expect("the owner's Factor waste norm → 15", [by["Rangka samping"].waste_percent, by["Rangka samping"].waste_norm],
  [15, "Factor · Waste kayu (log ke komponen)"]);
expect("contingency cited for a line: model's waste kept, flagged", [by.Top.waste_percent, by.Top.waste_norm, by.Top.warnings.length],
  [5, null, 1]);
expect("a made-up norm: model's waste kept, named in the warning",
  [by.Rangka.waste_percent, by.Rangka.waste_norm, /Wood \| Waste kayu/.test(by.Rangka.warnings[0] ?? "")], [15, null, true]);
expect("no norm named, waste given: flagged", [by.Laci.waste_percent, by.Laci.warnings.length], [18, 1]);
expect("no norm, no waste: nothing to flag", [by.Samping.waste_percent, by.Samping.warnings], [0, []]);

/* ── no norms: as before 0193 ─────────────────────────────────────────── */
const bare = m.toBomSuggestion({ lines: [line("Kaki-kaki", "RT-0001", 15, "Wood | Square to finished component yield")] }, RATES, base, []);
expect("no norms: the model's waste stands, unflagged",
  [bare.lines[0].waste_percent, bare.lines[0].waste_norm, bare.lines[0].warnings, bare.norms], [15, null, [], 0]);

/* ── the prompt says which rule it is under ───────────────────────────── */
const product = { product_code: "PRD-X", name: "Meja", category: "Meja", uom: "pcs",
  length_mm: 1200, width_mm: 600, height_mm: 750, description: null };
const withNorms = m.bomPrompt(product, RATES, NORMS);
expect("prompt lists every norm", NORMS.every((n) => withNorms.includes(`${n.category} | ${n.norm} |`)), true);
expect("prompt drops the generic range when norms exist", withNorms.includes("kayu solid 10–20"), false);
expect("prompt keeps the generic range without norms", m.bomPrompt(product, RATES, []).includes("kayu solid 10–20"), true);
expect("prompt never carries a price", /6000000|6\.000\.000|285000|285\.000/.test(withNorms), false);

if (failures.length) {
  console.error(`BOM norms: ${failures.length} failed\n  ` + failures.join("\n  "));
  process.exit(1);
}
console.log("BOM norms                                  ok");
