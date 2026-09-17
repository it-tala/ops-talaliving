import type { StockLocation, StockMove, StockSetting } from "@/services/inventory/contracts";

/** Stock, as it stands on a Friday morning (D170).
 *
 *  These moves are written to produce the four situations the screen exists to
 *  show, because a stock list where everything is fine teaches nobody how to
 *  read it:
 *
 *  - **Below minimum** — thinner and amplas 240, both heading for a Saturday
 *    where the finishing bench stops.
 *  - **Priced only in part** — plywood 18mm arrived once on a line nobody had
 *    priced, so its value is computed over the rest and marked incomplete.
 *  - **Counted and wrong** — engsel came up eighteen short at the last opname,
 *    with the reason on the row.
 *  - **Never moved** — MDF 15mm is in the catalogue, bought by nobody, and has
 *    no stock at all, which is different from having none left.
 */
export const STOCK_LOCATIONS: StockLocation[] = [
  { code: "GUDANG", name: "Gudang utama", is_active: true },
  { code: "WORKSHOP", name: "Lantai produksi", is_active: true },
  { code: "FINISHING", name: "Ruang finishing", is_active: true },
];

export const STOCK_SETTINGS: StockSetting[] = [
  { item_code: "ITM-0007", min_qty: 20, home_location: "GUDANG" },
  { item_code: "ITM-0008", min_qty: 15, home_location: "GUDANG" },
  { item_code: "ITM-0010", min_qty: 10, home_location: "GUDANG" },
  { item_code: "ITM-0013", min_qty: 40, home_location: "FINISHING" },
  { item_code: "ITM-0014", min_qty: 40, home_location: "FINISHING" },
  { item_code: "ITM-0017", min_qty: 20, home_location: "FINISHING" },
  { item_code: "ITM-0018", min_qty: 30, home_location: "FINISHING" },
  { item_code: "ITM-0022", min_qty: 4, home_location: "WORKSHOP" },
  { item_code: "ITM-0024", min_qty: 100, home_location: "GUDANG" },
  { item_code: "ITM-0025", min_qty: 24, home_location: "GUDANG" },
  { item_code: "ITM-0027", min_qty: 5, home_location: "GUDANG" },
  /* Nobody has said what "low" means for these, and the screen says exactly
     that rather than treating zero as the threshold. */
  { item_code: "ITM-0026", min_qty: null, home_location: "GUDANG" },
];

type Seed = [
  no: string, item: string, loc: string,
  kind: StockMove["kind"], qty: number, uom: string,
  cost: number | null, ref: string | null, reason: string | null,
  by: string, at: string,
];

const SEEDS: Seed[] = [
  /* ── what came in ──────────────────────────────────────────────────── */
  ["stk-26-08-24_01", "ITM-0007", "GUDANG", "receipt", 60, "lembar", 292_000, "rcv-26-08-24_01", null, "usr_made", "2026-08-24T09:20:00+08:00"],
  ["stk-26-08-24_02", "ITM-0008", "GUDANG", "receipt", 40, "lembar", 205_000, "rcv-26-08-24_01", null, "usr_made", "2026-08-24T09:25:00+08:00"],
  ["stk-26-08-26_01", "ITM-0024", "GUDANG", "receipt", 300, "pcs", 18_500, "rcv-26-08-26_02", null, "usr_made", "2026-08-26T14:10:00+08:00"],
  ["stk-26-08-26_02", "ITM-0025", "GUDANG", "receipt", 60, "set", 97_500, "rcv-26-08-26_02", null, "usr_made", "2026-08-26T14:12:00+08:00"],
  ["stk-26-08-26_03", "ITM-0026", "GUDANG", "receipt", 80, "pcs", 32_000, "rcv-26-08-26_02", null, "usr_made", "2026-08-26T14:15:00+08:00"],
  ["stk-26-08-28_01", "ITM-0017", "FINISHING", "receipt", 40, "ltr", 168_000, "rcv-26-08-28_01", null, "usr_made", "2026-08-28T10:05:00+08:00"],
  ["stk-26-08-28_02", "ITM-0018", "FINISHING", "receipt", 60, "ltr", 33_500, "rcv-26-08-28_01", null, "usr_made", "2026-08-28T10:07:00+08:00"],
  ["stk-26-08-28_03", "ITM-0013", "FINISHING", "receipt", 120, "lembar", 7_650, "rcv-26-08-28_01", null, "usr_made", "2026-08-28T10:09:00+08:00"],
  ["stk-26-08-28_04", "ITM-0014", "FINISHING", "receipt", 100, "lembar", 8_000, "rcv-26-08-28_01", null, "usr_made", "2026-08-28T10:10:00+08:00"],
  ["stk-26-08-29_01", "ITM-0022", "WORKSHOP", "receipt", 12, "pack", 230_000, "rcv-26-08-29_01", null, "usr_made", "2026-08-29T08:40:00+08:00"],
  ["stk-26-08-31_01", "ITM-0010", "GUDANG", "receipt", 25, "lembar", 248_000, "rcv-26-08-31_01", null, "usr_made", "2026-08-31T11:00:00+08:00"],
  ["stk-26-08-31_02", "ITM-0027", "GUDANG", "receipt", 10, "box", 43_000, "rcv-26-08-31_01", null, "usr_made", "2026-08-31T11:02:00+08:00"],
  /* The load nobody priced: the request line was a lump sum for a mixed
     delivery, so these eight sheets arrived with no unit price on them. Kept
     as stock, kept out of the valuation, and said out loud (D172). */
  ["stk-26-09-02_01", "ITM-0007", "GUDANG", "receipt", 8, "lembar", null, "rcv-26-09-02_01", "Kiriman campuran, harga per lembar tidak dirinci di PR.", "usr_made", "2026-09-02T15:30:00+08:00"],

  /* ── what went out to the floor ────────────────────────────────────── */
  /* These referenced `spk-26-08-05_01` and `spk-26-08-12_01` until 2026-09-13
     — **two work orders that have never existed** (F86). Nothing joined a
     stock move to a work order until D266, so nine issues and one return
     pointed at nothing and no screen could say so.

     Repointed at the real orders they describe: the lemari issues to
     `spk-26-08-28_01` (6 unit) and the meja finishing issues to
     `spk-26-08-24_01` (4 set). **The quantities are unchanged on purpose.**
     They were written in M27 as plausible workshop activity, with no BOM to
     check them against — and now that there is one, the comparison says they
     do not match: 85 sheets of amplas against a list calling for 32, engsel at
     96 against 36. That is not a defect of the seed, it is what this business
     will see on its first day with a BOM behind the rack, and the panel is
     careful to call it *in progress* rather than *overrun* until the run is
     actually finished (D266). */
  ["stk-26-09-01_01", "ITM-0007", "GUDANG", "issue", -24, "lembar", null, "spk-26-08-28_01", "Body lemari 6 unit.", "usr_made", "2026-09-01T08:15:00+08:00"],
  ["stk-26-09-01_02", "ITM-0008", "GUDANG", "issue", -12, "lembar", null, "spk-26-08-28_01", "Backing lemari.", "usr_made", "2026-09-01T08:16:00+08:00"],
  ["stk-26-09-01_03", "ITM-0024", "GUDANG", "issue", -96, "pcs", null, "spk-26-08-28_01", "Engsel pintu lemari.", "usr_made", "2026-09-01T08:20:00+08:00"],
  ["stk-26-09-02_02", "ITM-0010", "GUDANG", "issue", -14, "lembar", null, "spk-26-08-28_01", "HPL putih, 6 unit lemari.", "usr_made", "2026-09-02T09:10:00+08:00"],
  ["stk-26-09-03_01", "ITM-0018", "FINISHING", "issue", -34, "ltr", null, "spk-26-08-24_01", "Pengencer duco meja BABY ISLAND.", "usr_made", "2026-09-03T13:25:00+08:00"],
  ["stk-26-09-03_02", "ITM-0017", "FINISHING", "issue", -18, "ltr", null, "spk-26-08-24_01", "Duco putih meja.", "usr_made", "2026-09-03T13:26:00+08:00"],
  ["stk-26-09-03_03", "ITM-0014", "FINISHING", "issue", -68, "lembar", null, "spk-26-08-24_01", "Amplas halus sebelum finishing.", "usr_made", "2026-09-03T13:30:00+08:00"],
  ["stk-26-09-04_01", "ITM-0013", "FINISHING", "issue", -85, "lembar", null, "spk-26-08-24_01", "Amplas 120 rangka meja.", "usr_made", "2026-09-04T08:05:00+08:00"],
  ["stk-26-09-04_02", "ITM-0022", "WORKSHOP", "issue", -9, "pack", null, "spk-26-08-28_01", "Lem body lemari.", "usr_made", "2026-09-04T08:20:00+08:00"],

  /* ── what came back ────────────────────────────────────────────────── */
  ["stk-26-09-04_03", "ITM-0007", "GUDANG", "return", 3, "lembar", null, "spk-26-08-28_01", "Sisa potongan utuh, dikembalikan ke rak.", "usr_made", "2026-09-04T16:40:00+08:00"],

  /* ── what a count found ────────────────────────────────────────────── */
  ["stk-26-09-05_01", "ITM-0024", "GUDANG", "adjust", -18, "pcs", null, null, "Opname 5 September: fisik 186, sistem 204. Selisih 18 pcs belum ketemu — dugaan terpakai di perbaikan tanpa dicatat.", "usr_made", "2026-09-05T17:00:00+08:00"],
  ["stk-26-09-05_02", "ITM-0025", "GUDANG", "adjust", 4, "set", null, null, "Opname 5 September: empat set rel ketemu di rak bawah, sebelumnya tercatat keluar.", "usr_made", "2026-09-05T17:05:00+08:00"],

  /* ── what moved between locations ──────────────────────────────────── */
  ["stk-26-09-07_01", "ITM-0013", "FINISHING", "transfer", -20, "lembar", null, null, "Dipindah ke lantai produksi untuk amplas rangka.", "usr_made", "2026-09-07T09:00:00+08:00"],
  ["stk-26-09-07_02", "ITM-0013", "WORKSHOP", "transfer", 20, "lembar", null, null, "Diterima dari ruang finishing.", "usr_made", "2026-09-07T09:00:00+08:00"],
];

export const STOCK_MOVES: StockMove[] = SEEDS.map(
  ([move_no, item_code, location, kind, qty, uom, unit_cost, ref_no, reason, moved_by, moved_at], i) => ({
    id: `stm_${String(i + 1).padStart(3, "0")}`,
    move_no, item_code, location, kind, qty, uom, unit_cost, ref_no, reason, moved_by, moved_at,
  }),
);
