import type { Product, BomComponent, BomRevision } from "@/services/production/contracts";

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
    category: "Meja", uom: "set",
    description: "Meja makan solid jati, kaki tapered, finishing natural matt.",
    length_mm: 2200, width_mm: 1000, height_mm: 750, dimension_note: null, labour_cost: 1_800_000, labour_note: "Sample 1 unit, Agustus: 2 tukang × 1,5 hari potong-rakit + 1 tukang × 1 hari finishing. Diukur, bukan ditaksir.", lead_time_days: 14, active: true, note: null,
  },
  {
    id: "prd_02", product_code: "PRD-KR-STD", name: "Kursi makan jati",
    category: "Kursi", uom: "pcs",
    description: "Kursi makan solid jati, dudukan busa, kain pelanggan.",
    length_mm: 450, width_mm: 520, height_mm: 900, dimension_note: null, labour_cost: 320_000, labour_note: "Sample 4 kursi sekaligus, dibagi empat.", lead_time_days: 10, active: true, note: null,
  },
  {
    id: "prd_03", product_code: "PRD-LM-3P", name: "Lemari pakaian 3 pintu",
    category: "Lemari", uom: "unit",
    description: "Rangka plywood 18 mm, HPL putih, dua laci dalam.",
    length_mm: 1800, width_mm: 600, height_mm: 2100, dimension_note: null, labour_cost: null, labour_note: null, lead_time_days: 21, active: true, note: null,
  },
  {
    id: "prd_04", product_code: "PRD-PT-90", name: "Pintu panel jati 90×210",
    category: "Pintu", uom: "daun",
    description: "Daun pintu panel solid jati, empat panel.",
    length_mm: 900, width_mm: 2100, height_mm: 40, dimension_note: null, labour_cost: null, labour_note: null, lead_time_days: 12, active: true, note: null,
  },
  {
    id: "prd_05", product_code: "PRD-RK-DSP", name: "Rak display besi–kayu",
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
    category: "Meja", uom: "unit",
    description: "Nakas satu laci, finishing walnut.",
    length_mm: 450, width_mm: 400, height_mm: 550, dimension_note: null, labour_cost: null, labour_note: null, lead_time_days: 7, active: true,
    note: "Belum ada BOM — selalu dibuat dari sisa potongan.",
  },
  {
    id: "prd_07", product_code: "PRD-SUB-LACI", name: "Box laci 45 cm (sub-rakitan)",
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
    released_at: "2026-08-01T08:00:00+08:00", released_by: "usr_made",
    note: "Versi awal, dari katalog yang dipakai sebelum BOM diberi versi.",
    created_at: "2026-08-01T08:00:00+08:00", created_by: "usr_made",
  })),
  {
    id: "bmr_prd_01_2", product_id: "prd_01", rev: 2,
    released_at: null, released_by: null,
    note: "Sekrup diganti ke ukuran yang lebih panjang dan susut papan dinaikkan — meja 220 sering kurang bahan.",
    created_at: "2026-09-10T09:00:00+08:00", created_by: "usr_made",
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
