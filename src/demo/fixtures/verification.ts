import type { Asset, AssetCategory, StockLocation } from "@/services/inventory/contracts";
import type { AssetLegacy, AssetVerificationRecord } from "../state";

/** The asset verification flow (`0290`, `0291`, D447) in the sandbox.
 *
 *  Twenty machines taken as they are from the 2013 register
 *  (`supabase/import/data/legacy_2013_register.csv`), the `machine` category,
 *  and the site plan's zones beside the old locations. Most machines start
 *  unverified with no location, as the import leaves them, so *No location*
 *  is where the work begins; a few already carry a check each, one per
 *  status, so the summary has something to show. The sandbox has no 2013
 *  photos: the record photo tile shows its empty face. */

export const MACHINE_CATEGORY: AssetCategory = {
  code: "machine", name: "Machines",
  description: "Production machines: saws, sanders, planers, compressors, sewing machines", is_active: true,
};

/** `0291`: the zones that hold things, by their site-plan codes. */
export const SITE_PLAN_ZONES: StockLocation[] = [
  { code: "PRD", name: "Production", is_active: true },
  { code: "FN1", name: "Finishing 1", is_active: true },
  { code: "FN2", name: "Finishing 2", is_active: true },
  { code: "OVN", name: "Oven", is_active: true },
  { code: "GD1", name: "Warehouse 1 (front left)", is_active: true },
  { code: "GD2", name: "Warehouse 2 (front right)", is_active: true },
  { code: "GD3", name: "Warehouse 3 (small)", is_active: true },
  { code: "GD4", name: "Warehouse 4 (small)", is_active: true },
  { code: "PKG", name: "Packaging", is_active: true },
  { code: "LOG", name: "Logistics", is_active: true },
  { code: "B1", name: "Block 1 (storage + maintenance)", is_active: true },
  { code: "B2", name: "Block 2 (storage + maintenance)", is_active: true },
  { code: "B3", name: "Block 3 (storage + maintenance)", is_active: true },
  { code: "KT1", name: "Office (upper)", is_active: true },
  { code: "KT2", name: "Office (lower)", is_active: true },
  { code: "R06", name: "Shared break room", is_active: true },
  { code: "MES", name: "Staff housing", is_active: true },
];

const REGISTER: { no: string; code: string; name: string; brand: string | null; model: string | null;
  area: string | null; dept: string | null; notes: string | null }[] = [
  {"no": "AST-0101", "code": "A1-01", "name": "Air Compressor", "brand": "BENWELL", "model": "B50", "area": "M16", "dept": "Assembly", "notes": "Area M16 is Power House for A2/A3 but Assembly here"},
  {"no": "AST-0102", "code": "A1-02", "name": "Air Compressor", "brand": "BENWELL", "model": "B50", "area": "M16", "dept": "Assembly", "notes": "Area M16 is Power House for A2/A3 but Assembly here"},
  {"no": "AST-0103", "code": "A2-01", "name": "Air Dryer", "brand": "FENG FAN", "model": "LD50AC", "area": "M16", "dept": "Power house", "notes": null},
  {"no": "AST-0104", "code": "B1-01", "name": "Boring, Single Multi (Lrg)", "brand": "NANXING", "model": "MZ7121", "area": "I01", "dept": "Machinery", "notes": null},
  {"no": "AST-0105", "code": "B1-02", "name": "Boring, Single Head", "brand": "WOODTEK", "model": "BM301", "area": "N10", "dept": "Assembly", "notes": null},
  {"no": "AST-0106", "code": "C1-04", "name": "Single Clamp, Case", "brand": "TALA MANUFACTURED", "model": null, "area": "K15", "dept": "Machinery", "notes": "Item name starts with the descriptor (SINGLE CLAMP), not the type; Area code written as 'K15' (no space or no zero padding) · Same photo reused for C1-04 and C1-05; this unit has no photo of its own"},
  {"no": "AST-0107", "code": "C1-05", "name": "Single Clamp, Case", "brand": "TALA MANUFACTURED", "model": null, "area": "H07", "dept": "Assembly", "notes": "Item name starts with the descriptor (SINGLE CLAMP), not the type; Area code written as 'H7' (no space or no zero padding) · Same photo reused for C1-04 and C1-05; this unit has no photo of its own"},
  {"no": "AST-0108", "code": "D1-01", "name": "Dove Tailing Machine", "brand": null, "model": "SC 30-8Z", "area": "C01", "dept": "Machinery", "notes": null},
  {"no": "AST-0109", "code": "E1-01", "name": "Edgebander, Automatic", "brand": "NANXING", "model": "MFB60CA", "area": "H02", "dept": "Machinery", "notes": null},
  {"no": "AST-0110", "code": "F1-05", "name": "Finishing, Spray Booth (New)", "brand": null, "model": "MF92", "area": "I08", "dept": "Finishing", "notes": "Same photo reused for F1-05 to F1-10; this unit has no photo of its own"},
  {"no": "AST-0111", "code": "F1-06", "name": "Finishing, Spray Booth (New)", "brand": null, "model": "MF92", "area": "J08", "dept": "Finishing", "notes": "Same photo reused for F1-05 to F1-10; this unit has no photo of its own; Byte-identical image object in the PDF"},
  {"no": "AST-0112", "code": "J1-01", "name": "Jointer", "brand": "HUA HUA", "model": "MB504", "area": "B01", "dept": "Machinery", "notes": null},
  {"no": "AST-0113", "code": "P1-01", "name": "Planer, Double", "brand": "V HOLD", "model": "MB 2061A", "area": "A02", "dept": "Machinery", "notes": null},
  {"no": "AST-0114", "code": "R1-01", "name": "Router, Overhead", "brand": "HUA HUA", "model": "MX5080", "area": "G03", "dept": "Machinery", "notes": null},
  {"no": "AST-0115", "code": "S1-01", "name": "Sander, Vertical Sponge/Drum", "brand": "HUA HUA", "model": "MM2115", "area": "D02", "dept": "Machinery", "notes": "Extra space before comma (SANDER , VERTICAL)"},
  {"no": "AST-0116", "code": "S2-01", "name": "Saw, Band", "brand": "MAS", "model": "MJ346", "area": "C01", "dept": "Machinery", "notes": null},
  {"no": "AST-0117", "code": "S2-02", "name": "Saw, Band", "brand": "HUA HUA", "model": "MJ345", "area": "D03", "dept": "Machinery", "notes": null},
  {"no": "AST-0118", "code": "U1-24", "name": "Upholstery Sewing Machine Extra High Speed Overlock (Edging Machine)", "brand": "GOLDEN WHEEL", "model": "CS-5150L", "area": "J14", "dept": "Upholstery", "notes": "Description (overlock) may belong to U1-26, see photo · Placard in photo reads area J15, sheet says J 14; Photo shows a single-needle machine, not an overlock"},
  {"no": "AST-0119", "code": "U1-26", "name": "Upholstery (Fabric Thinner)", "brand": "GOLDEN WHEEL", "model": "CS-M74013-H", "area": "J14", "dept": "Upholstery", "notes": "Description FABRIC THINNER, but photo and placard show an overlock · Placard in photo reads area I16, sheet says J 14; Placard item reads 'sewing machine extra high speed overlock'"},
  {"no": "AST-0120", "code": "V1-01", "name": "Veneer, Cutter", "brand": "NANXING", "model": "MT310", "area": "D03", "dept": "Machinery", "notes": null},
];

const stamp = "2026-11-18T08:00:00+07:00";

export const DEMO_MACHINES: Asset[] = REGISTER.map((r, i) => ({
  id: `ast_m${String(i + 1).padStart(3, "0")}`, asset_no: r.no, name: r.name, category_code: "machine",
  brand: r.brand, model: r.model, identifier: null, location: null, holder: null, status: "in_storage",
  acquired_on: null, purchase_cost: null, vendor_code: null, trx_no: null, warranty_until: null, notes: null,
  ended_on: null, ownership: "owned", rent_amount: null, rent_period: null, rent_due_day: null,
  contract_start: null, contract_end: null, created_at: stamp, updated_at: stamp,
}));

export const DEMO_ASSET_LEGACY: AssetLegacy[] = REGISTER.map((r) => ({
  asset_no: r.no, legacy_code: r.code, legacy_area: r.area, legacy_department: r.dept, legacy_notes: r.notes,
}));

/** One check per status, so the list and the summary are not empty. */
export const DEMO_VERIFICATIONS: AssetVerificationRecord[] = [
  {
    id: "avf_001", verification_no: "VRF-000001", asset_no: "AST-0101", result: "match", condition: "working",
    location: "PRD", checks: { name: { ok: true }, brand: { ok: true }, model: { ok: true }, qty: { ok: true } },
    note: null, photo_ids: [], verified_by: "usr_putri", verified_at: "2026-11-18T09:12:00+07:00",
    applied_by: null, applied_at: null,
  },
  {
    id: "avf_002", verification_no: "VRF-000002", asset_no: "AST-0104", result: "mismatch", condition: "broken",
    location: "PRD",
    checks: { name: { ok: true }, brand: { ok: false, found: "HUA HUA" }, model: { ok: true }, qty: { ok: true } },
    note: "Plate reads HUA HUA; the motor does not start.", photo_ids: [], verified_by: "usr_putri",
    verified_at: "2026-11-18T09:20:00+07:00", applied_by: null, applied_at: null,
  },
  {
    id: "avf_003", verification_no: "VRF-000003", asset_no: "AST-0110", result: "not_found", condition: null,
    location: null, checks: {}, note: "Looked in FN1, FN2 and the oven.", photo_ids: [], verified_by: "usr_putri",
    verified_at: "2026-11-18T09:35:00+07:00", applied_by: null, applied_at: null,
  },
];
