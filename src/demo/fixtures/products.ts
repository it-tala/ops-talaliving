import type { Product, BomComponent, BomNorm, BomRate, BomRevision } from "@/services/production/contracts";
import type { FinishingRecipeRow } from "../state";

/** What the business sells and makes, and what each one is made of.
 *
 *  Six products, matching the work orders already on the floor, plus one
 *  sub-assembly — the drawer box — which exists to show a bill of materials
 *  referring to **another product** rather than only to purchased materials
 *  (D149).
 *
 *  The BOMs are deliberately uneven. Two are complete and priced; the display
 *  rack has a component the catalogue cannot price (the steel frame is bought
 *  as a service from a vendor, not as a catalogue item); and one product has
 *  no bill of materials at all, which is the honest state of most catalogues
 *  in month one and exactly what the screen has to be able to show.
 */
export const PRODUCTS: Product[] = [
  {
    id: "prd_01", product_code: "PRD-MJ-220", name: "Meja makan jati 220×100",
    stages: ["AMPLAS", "FINISHING", "PACKING"],
    category: "Meja", uom: "set",
    description: "Meja makan solid jati, kaki tapered, finishing natural matt.",
    length_mm: 2200, width_mm: 1000, height_mm: 750, dimension_note: null, labour_cost: 1_800_000, labour_note: "Sample 1 unit, Agustus: 2 tukang × 1,5 hari potong-rakit + 1 tukang × 1 hari finishing. Diukur, bukan ditaksir.", lead_time_days: 14, active: true, note: null,
  },
  {
    id: "prd_02", product_code: "PRD-KR-STD", name: "Kursi makan jati",
    stages: ["AMPLAS", "FINISHING", "PACKING"],
    category: "Kursi", uom: "pcs",
    description: "Kursi makan solid jati, dudukan busa, kain pelanggan.",
    length_mm: 450, width_mm: 520, height_mm: 900, dimension_note: null, labour_cost: 320_000, labour_note: "Sample 4 kursi sekaligus, dibagi empat.", lead_time_days: 10, active: true, note: null,
  },
  {
    id: "prd_03", product_code: "PRD-LM-3P", name: "Lemari pakaian 3 pintu",
    stages: ["AMPLAS", "FINISHING", "MACHINERY", "PACKING"],
    category: "Lemari", uom: "unit",
    description: "Rangka plywood 18 mm, HPL putih, dua laci dalam.",
    length_mm: 1800, width_mm: 600, height_mm: 2100, dimension_note: null, labour_cost: null, labour_note: null, lead_time_days: 21, active: true, note: null,
  },
  {
    id: "prd_04", product_code: "PRD-PT-90", name: "Pintu panel jati 90×210",
    stages: ["AMPLAS", "FINISHING", "PACKING"],
    category: "Pintu", uom: "daun",
    description: "Daun pintu panel solid jati, empat panel.",
    length_mm: 900, width_mm: 2100, height_mm: 40, dimension_note: null, labour_cost: null, labour_note: null, lead_time_days: 12, active: true, note: null,
  },
  {
    id: "prd_05", product_code: "PRD-RK-DSP", name: "Rak display besi–kayu",
    stages: ["AMPLAS", "FINISHING", "MACHINERY", "PACKING"],
    category: "Rak", uom: "unit",
    description: "Rangka besi hollow dari vendor, papan jati 3 cm.",
    /* Deliberately without measurements: the frame is fabricated by a vendor
       and nobody has drawn it yet. A product the system cannot state the size
       of is exactly what the completeness column exists to surface (D150). */
    length_mm: null, width_mm: null, height_mm: null,
    dimension_note: "Menunggu ukuran rangka dari Makmur Sentosa.",
    labour_cost: null, labour_note: null, lead_time_days: 18, active: true, note: null,
  },
  {
    id: "prd_06", product_code: "PRD-NK-KCL", name: "Nakas jati kecil",
    stages: ["AMPLAS", "FINISHING", "PACKING"],
    category: "Meja", uom: "unit",
    description: "Nakas satu laci, finishing walnut.",
    length_mm: 450, width_mm: 400, height_mm: 550, dimension_note: null, labour_cost: null, labour_note: null, lead_time_days: 7, active: true,
    note: "Belum ada BOM — selalu dibuat dari sisa potongan.",
  },
  {
    id: "prd_07", product_code: "PRD-SUB-LACI", name: "Box laci 45 cm (sub-rakitan)",
    stages: null,
    category: "Sub-rakitan", uom: "pcs",
    description: "Box laci plywood 12 mm dengan rel full extension. Dipakai di lemari dan nakas.",
    length_mm: 450, width_mm: 400, height_mm: 150, dimension_note: null, labour_cost: 180_000, labour_note: "Box laci: 1 tukang setengah hari termasuk pasang rel.", lead_time_days: 3, active: true, note: null,
  },
];

let n = 0;
const c = (
  product_id: string, kind: "material" | "product", ref_code: string,
  qty: number, uom: string, waste_percent = 0, note: string | null = null,
  rev = 1,
): BomComponent => {
  n += 1;
  return { id: `bom_${String(n).padStart(3, "0")}`, product_id, rev, kind, ref_code, qty, uom, waste_percent, note };
};

export const BOM_COMPONENTS: BomComponent[] = [
  /* Meja makan — the complete one. Waste on the boards is the point: a 10%
     susut on jati is the difference between enough and a second trip. */
  c("prd_01", "material", "ITM-0006", 6, "lembar", 12, "Papan jati 3 cm untuk daun meja."),
  c("prd_01", "material", "ITM-0001", 0.08, "m3", 15, "Kaki dan rangka, sortimen A."),
  c("prd_01", "material", "ITM-0022", 0.5, "pack", 0, null),
  c("prd_01", "material", "ITM-0013", 8, "lembar", 0, null),
  c("prd_01", "material", "ITM-0014", 6, "lembar", 0, null),
  c("prd_01", "material", "ITM-0016", 2, "ltr", 5, null),
  c("prd_01", "material", "ITM-0019", 2.5, "ltr", 5, "Melamine clear doff, dua lapis."),
  c("prd_01", "material", "ITM-0021", 0.8, "kg", 0, null),
  c("prd_01", "material", "ITM-0033", 0.3, "roll", 0, "Bubble wrap saat packing."),
  c("prd_01", "material", "ITM-0032", 2, "pcs", 0, null),

  /* Kursi — small, and the one that shows how little a chair costs in
     material next to what it takes in hours. */
  c("prd_02", "material", "ITM-0002", 0.035, "m3", 18, "Sortimen B cukup untuk kursi."),
  c("prd_02", "material", "ITM-0022", 0.1, "pack", 0, null),
  c("prd_02", "material", "ITM-0013", 2, "lembar", 0, null),
  c("prd_02", "material", "ITM-0016", 0.4, "ltr", 5, null),
  c("prd_02", "material", "ITM-0019", 0.5, "ltr", 5, null),
  c("prd_02", "material", "ITM-0027", 0.1, "box", 0, null),

  /* Lemari — references the drawer box, which is another product. */
  c("prd_03", "material", "ITM-0007", 5, "lembar", 8, "Rangka dan pintu."),
  c("prd_03", "material", "ITM-0010", 4, "lembar", 10, "HPL putih."),
  c("prd_03", "material", "ITM-0023", 1.2, "kg", 0, "Lem kuning untuk HPL."),
  c("prd_03", "material", "ITM-0024", 6, "pcs", 0, "Engsel sendok, dua per pintu."),
  c("prd_03", "material", "ITM-0026", 3, "pcs", 0, null),
  c("prd_03", "material", "ITM-0027", 0.5, "box", 0, null),
  c("prd_03", "product", "PRD-SUB-LACI", 2, "pcs", 0, "Dua laci dalam."),

  /* Pintu panel. */
  c("prd_04", "material", "ITM-0006", 2.5, "lembar", 15, "Panel dan rangka daun."),
  c("prd_04", "material", "ITM-0022", 0.2, "pack", 0, null),
  c("prd_04", "material", "ITM-0014", 3, "lembar", 0, null),
  c("prd_04", "material", "ITM-0016", 0.8, "ltr", 5, null),
  c("prd_04", "material", "ITM-0020", 0.6, "ltr", 5, "Wood stain walnut."),

  /* Rak display — one component the catalogue cannot price, on purpose. */
  c("prd_05", "material", "ITM-0006", 2, "lembar", 10, null),
  c("prd_05", "material", "RANGKA-BESI-CUSTOM", 1, "set", 0, "Dipesan ke Makmur Sentosa, belum ada di katalog."),
  c("prd_05", "material", "ITM-0019", 1, "ltr", 5, null),
  c("prd_05", "material", "ITM-0027", 0.3, "box", 0, null),

  /* The drawer box itself. */
  c("prd_07", "material", "ITM-0008", 0.5, "lembar", 10, null),
  c("prd_07", "material", "ITM-0025", 1, "set", 0, "Rel full extension 45 cm."),
  c("prd_07", "material", "ITM-0027", 0.05, "box", 0, null),
];

/** Every BOM that existed before versioning is **revision 1, released** (D256).
 *
 *  That is a statement of fact rather than a convenience. The BOM was
 *  current-state with no history, so one list is the only list that has ever
 *  existed in this data, and calling it rev 1 loses nothing. The same argument
 *  carries the real migration in Phase 2.
 *
 *  `prd_01` then carries a **draft rev 2** on top, because the whole point of
 *  versioning is invisible until a product has two: one work order on the floor
 *  is pinned to rev 1 while the drafting table has moved on, and the board can
 *  say so.
 */
export const BOM_REVISIONS: BomRevision[] = [
  ...["prd_01", "prd_02", "prd_03", "prd_04", "prd_05", "prd_07"].map((product_id) => ({
    id: `bmr_${product_id}_1`, product_id, rev: 1,
    released_at: "2026-08-01T08:00:00+07:00", released_by: "usr_made",
    note: "Versi awal, dari katalog yang dipakai sebelum BOM diberi versi.",
    created_at: "2026-08-01T08:00:00+07:00", created_by: "usr_made",
  })),
  {
    id: "bmr_prd_01_2", product_id: "prd_01", rev: 2,
    released_at: null, released_by: null,
    note: "Sekrup diganti ke ukuran yang lebih panjang dan susut papan dinaikkan — meja 220 sering kurang bahan.",
    created_at: "2026-09-10T09:00:00+07:00", created_by: "usr_made",
  },
];

/* The draft: a **full copy** of rev 1 with two lines changed and one added.
   Copied, not referenced — releasing rev 1 froze its lines, and a draft that
   pointed back at them would edit a released revision by the back door (D256).
   Full, because a partial copy is a diff nobody meant: three lines left out is
   three components removed, and the screen would be right to say so. */
BOM_COMPONENTS.push(
  c("prd_01", "material", "ITM-0006", 6, "lembar", 15, "Susut dinaikkan 12% → 15%: meja 220 sering kurang bahan.", 2),
  c("prd_01", "material", "ITM-0001", 0.08, "m3", 15, "Kaki dan rangka, sortimen A.", 2),
  c("prd_01", "material", "ITM-0022", 0.5, "pack", 0, null, 2),
  c("prd_01", "material", "ITM-0013", 12, "lembar", 0, "Sekrup 6×80, naik dari 8 lembar.", 2),
  c("prd_01", "material", "ITM-0014", 6, "lembar", 0, null, 2),
  c("prd_01", "material", "ITM-0016", 2, "ltr", 5, null, 2),
  c("prd_01", "material", "ITM-0019", 2.5, "ltr", 5, "Melamine clear doff, dua lapis.", 2),
  c("prd_01", "material", "ITM-0021", 0.8, "kg", 0, null, 2),
  c("prd_01", "material", "ITM-0033", 0.3, "roll", 0, "Bubble wrap saat packing.", 2),
  c("prd_01", "material", "ITM-0032", 2, "pcs", 0, null, 2),
  c("prd_01", "material", "ITM-0027", 0.2, "box", 0, "Baru: dowel untuk sambungan kaki.", 2),
);

/* Labour as lines (0109): the workshop's own time, costed like any other
   component — a name, a quantity and a rate. The meja carries it on both its
   released revision and the draft; the drawer box on its own, so the lemari
   that contains two of them is costed with their labour inside. */
const labour = (
  product_id: string, label: string, qty: number, uom: string, rate: number, rev = 1,
): BomComponent => {
  n += 1;
  return {
    id: `bom_${String(n).padStart(3, "0")}`, product_id, rev, kind: "labour",
    ref_code: "LABOUR:" + label.replace(/[^A-Za-z0-9]+/g, "-").toUpperCase(),
    label, qty, uom, waste_percent: 0, unit_rate: rate, rate_source: "manual", note: null,
  };
};
BOM_COMPONENTS.push(
  labour("prd_01", "Tukang kayu (potong-rakit)", 3, "hari", 175_000),
  labour("prd_01", "Tukang finishing", 1, "hari", 150_000),
  labour("prd_01", "Tukang kayu (potong-rakit)", 3, "hari", 175_000, 2),
  labour("prd_01", "Tukang finishing", 1, "hari", 150_000, 2),
  labour("prd_02", "Tukang kayu (potong-rakit)", 1, "hari", 175_000),
  labour("prd_02", "Tukang finishing", 0.5, "hari", 150_000),
  labour("prd_07", "Rakit laci + pasang rel", 0.5, "hari", 175_000),
);
for (const r of BOM_REVISIONS) r.miscalc_percent = r.product_id === "prd_01" ? 7.5 : 5;

/* The *komponen* each line is for (0182, D324). Written onto both of the meja's
   revisions and the kursi's, the same way on each, so the draft's diff still
   shows only what actually changed. */
const PARTS: Record<string, Record<string, string>> = {
  prd_01: {
    "ITM-0006": "Top (daun meja)", "ITM-0001": "Kaki & rangka", "ITM-0027": "Kaki & rangka",
    "ITM-0022": "Rakit", "ITM-0013": "Amplas", "ITM-0014": "Amplas",
    "ITM-0016": "Finishing", "ITM-0019": "Finishing", "ITM-0021": "Finishing",
    "ITM-0033": "Packing", "ITM-0032": "Packing",
    "LABOUR:TUKANG-KAYU-POTONG-RAKIT-": "Rakit", "LABOUR:TUKANG-FINISHING": "Finishing",
  },
  prd_02: {
    "ITM-0002": "Rangka kursi", "ITM-0022": "Rakit", "ITM-0027": "Rakit", "ITM-0013": "Amplas",
    "ITM-0016": "Finishing", "ITM-0019": "Finishing",
    "LABOUR:TUKANG-KAYU-POTONG-RAKIT-": "Rakit", "LABOUR:TUKANG-FINISHING": "Finishing",
  },
};
for (const b of BOM_COMPONENTS) {
  const part = PARTS[b.product_id]?.[b.ref_code];
  if (part) b.part = part;
}

/** The estimator's rate list (0182, D324): what a BOM is costed at, apart from
 *  what procurement last paid. Sample figures for the sandbox — the real list
 *  is typed by the business, not seeded. Some rates stand for an item in the
 *  database (`item_code`), so a line priced from them still points at
 *  something procurement buys; finishing and labour stand for nothing
 *  bought. */
const rate = (
  n: number, name: string, rate_group: BomRate["rate_group"], uom: string, value: number,
  item_code: string | null = null, note: string | null = null,
): BomRate => ({
  id: `rt_${String(n).padStart(3, "0")}`, code: `RT-${String(n).padStart(4, "0")}`,
  name, rate_group, uom, rate: value, item_code, note, active: true,
  created_at: "2026-09-20T08:00:00+07:00", updated_at: "2026-09-20T08:00:00+07:00",
});

export const BOM_RATES: BomRate[] = [
  rate(1, "Kayu mindi grade A", "kayu", "m3", 5_800_000, "ITM-0005", "Kering oven, sortimen A."),
  rate(2, "Kayu jati grade C", "kayu", "m3", 9_500_000, null, "Jati kampung, mata kayu diterima."),
  rate(3, "Kayu jati grade A", "kayu", "m3", 18_500_000, "ITM-0001"),
  rate(4, "Plywood 18 mm", "material", "lembar", 285_000, "ITM-0007"),
  rate(5, "Hardware & pengikat (lem, sekrup, dowel)", "material", "set", 35_000),
  rate(6, "Finishing PU natural matt", "finishing", "m2", 85_000, null, "Sealer + 2 lapis top coat."),
  rate(7, "Finishing melamine", "finishing", "m2", 60_000),
  rate(8, "Tukang kayu (potong-rakit)", "labour", "hari", 175_000),
  rate(9, "Tukang finishing", "labour", "hari", 150_000),
  rate(10, "Karton 5 lapis", "packing", "m2", 12_000),
  rate(11, "Packing (bubble wrap + karton + label)", "packing", "unit", 45_000),
];

/** The business's estimating norms (`ops_prod.bom_norms`, read since 0193,
 *  D338). **Sample rules for the sandbox**: common industry figures, not the
 *  business's own list, which lives in production and is not copied here. The
 *  sandbox's AI stand-in takes timber and plywood waste and the sheet size
 *  from these, as the live model is told to. */
const norm = (
  n: number, category: string, name: string, value: number | null, unit: string,
  source_kind: BomNorm["source_kind"], basis: string, remarks: string | null = null,
): BomNorm => ({
  id: `bn_${String(n).padStart(3, "0")}`, category, norm: name, value, unit, basis, remarks, source_kind,
  effective_on: "2026-09-25",
});

export const BOM_NORMS: BomNorm[] = [
  norm(1, "Wood", "Square to finished component yield", 80, "%", "industry",
    "Norma industri (sampel sandbox)", "Susut potong, cacat dan sisa dari kayu square ke komponen jadi."),
  norm(2, "Panel", "Plywood cutting waste", 12, "%", "industry", "Norma industri 10–15% (nesting)",
    "Naikkan ke 20% untuk komponen kecil."),
  norm(3, "Panel", "Standard sheet", 2.976, "m²/sheet", "decision", "1220 × 2440 mm"),
  norm(4, "Finishing", "NC sanding sealer coverage", 9, "m²/L/coat", "industry", "TDS pabrikan 8–12 m²/L", "2 lapis."),
  norm(5, "Upholstery", "Fabric cutting waste", 15, "%", "industry", "Norma industri 10–20%", "Kain bermotif bisa 25%."),
  norm(6, "Factor", "Kontingensi / miskalkulasi", 5, "%", "decision", "Sampel sandbox", "Untuk seluruh BOM, bukan per baris."),
  norm(7, "Packing", "Packing material per m³ product", null, "", "empirical", "Hitung per item dari packing list",
    "Belum ada norma umum."),
];

/** Finishing systems step by step (`ops_prod.finishing_recipes`, 0193).
 *  **Sample figures**, rounded — the business's recipes live in production. */
const step = (
  n: number, system: string, name: string, product: string, unit_price: number, uom: string,
  coverage: number, coats: number, remarks: string | null = null,
): FinishingRecipeRow => ({
  id: `fr_${String(n).padStart(3, "0")}`, system, step: name, product, unit_price, uom,
  coverage_m2_per_unit: coverage, coats,
  cost_per_m2: Math.round(unit_price / coverage * coats), remarks, effective_on: "2026-09-25",
});

export const FINISHING_RECIPES: FinishingRecipeRow[] = [
  step(1, "NC natural", "Abrasives", "Amplas (per m²)", 9_000, "m2", 1, 1),
  step(2, "NC natural", "Sanding sealer", "NC sanding sealer", 58_500, "kg", 9, 2, "2 lapis @9 m²/L"),
  step(3, "NC natural", "Thinner", "Thinner NC", 22_500, "ltr", 9, 2, "Pengenceran 1:1"),
  step(4, "NC natural", "Topcoat", "NC top coat matt", 69_000, "kg", 6, 2, "2 lapis @6 m²/L"),
  step(5, "NC natural", "Bleach (optional)", "Bleaching agent", 1_700_000, "pail", 170, 1, "Hanya untuk warna terang"),
  step(6, "PU duco", "Abrasives", "Amplas (per m²)", 12_000, "m2", 1, 1),
  step(7, "PU duco", "Primer", "PU clear primer", 56_000, "kg", 8, 3),
  step(8, "PU duco", "Colour / topcoat", "Cat duco", 132_000, "ltr", 8, 2),
  step(9, "PU duco", "Hardener", "PU hardener", 64_000, "kg", 16, 3, "Rasio 2:1"),
];
