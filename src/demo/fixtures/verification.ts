import type { Asset, AssetCategory, CodeFamily, StockLocation } from "@/services/inventory/contracts";
import type { AssetCode, AssetLegacy, AssetVerificationRecord } from "../state";
import { ASSETS } from "./assets";

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
  {"no": "AST-0101", "code": "A1-01", "name": "AIR COMPRESSOR", "brand": "BENWELL", "model": "B50", "area": "M16", "dept": "Assembly", "notes": "Area M16 is Power House for A2/A3 but Assembly here"},
  {"no": "AST-0102", "code": "A1-02", "name": "AIR COMPRESSOR", "brand": "BENWELL", "model": "B50", "area": "M16", "dept": "Assembly", "notes": "Area M16 is Power House for A2/A3 but Assembly here"},
  {"no": "AST-0103", "code": "A2-01", "name": "AIR DRYER", "brand": "FENG FAN", "model": "LD50AC", "area": "M16", "dept": "Power house", "notes": null},
  {"no": "AST-0104", "code": "B1-01", "name": "BORING, SINGLE MULTI (LARGE)", "brand": "NANXING", "model": "MZ7121", "area": "I01", "dept": "Machinery", "notes": null},
  {"no": "AST-0105", "code": "B1-02", "name": "BORING, SINGLE HEAD", "brand": "WOODTEK", "model": "BM301", "area": "N10", "dept": "Assembly", "notes": null},
  {"no": "AST-0106", "code": "C1-04", "name": "CLAMP, CASE (SINGLE)", "brand": "TALA MANUFACTURED", "model": null, "area": "K15", "dept": "Machinery", "notes": "Item name starts with the descriptor (SINGLE CLAMP), not the type; Area code written as 'K15' (no space or no zero padding) · Same photo reused for C1-04 and C1-05; this unit has no photo of its own"},
  {"no": "AST-0107", "code": "C1-05", "name": "CLAMP, CASE (SINGLE)", "brand": "TALA MANUFACTURED", "model": null, "area": "H07", "dept": "Assembly", "notes": "Item name starts with the descriptor (SINGLE CLAMP), not the type; Area code written as 'H7' (no space or no zero padding) · Same photo reused for C1-04 and C1-05; this unit has no photo of its own"},
  {"no": "AST-0108", "code": "D1-01", "name": "DOVETAILING MACHINE", "brand": null, "model": "SC 30-8Z", "area": "C01", "dept": "Machinery", "notes": null},
  {"no": "AST-0109", "code": "E1-01", "name": "EDGEBANDER, AUTOMATIC", "brand": "NANXING", "model": "MFB60CA", "area": "H02", "dept": "Machinery", "notes": null},
  {"no": "AST-0110", "code": "F1-05", "name": "FINISHING, SPRAY BOOTH (NEW)", "brand": null, "model": "MF92", "area": "I08", "dept": "Finishing", "notes": "Same photo reused for F1-05 to F1-10; this unit has no photo of its own"},
  {"no": "AST-0111", "code": "F1-06", "name": "FINISHING, SPRAY BOOTH (NEW)", "brand": null, "model": "MF92", "area": "J08", "dept": "Finishing", "notes": "Same photo reused for F1-05 to F1-10; this unit has no photo of its own; Byte-identical image object in the PDF"},
  {"no": "AST-0112", "code": "J1-01", "name": "JOINTER", "brand": "HUA HUA", "model": "MB504", "area": "B01", "dept": "Machinery", "notes": null},
  {"no": "AST-0113", "code": "P1-01", "name": "PLANER, DOUBLE", "brand": "V HOLD", "model": "MB 2061A", "area": "A02", "dept": "Machinery", "notes": null},
  {"no": "AST-0114", "code": "R1-01", "name": "ROUTER, OVERHEAD", "brand": "HUA HUA", "model": "MX5080", "area": "G03", "dept": "Machinery", "notes": null},
  {"no": "AST-0115", "code": "S1-01", "name": "SANDER, VERTICAL SPONGE/DRUM", "brand": "HUA HUA", "model": "MM2115", "area": "D02", "dept": "Machinery", "notes": "Extra space before comma (SANDER , VERTICAL)"},
  {"no": "AST-0116", "code": "S2-01", "name": "SAW, BAND", "brand": "MAS", "model": "MJ346", "area": "C01", "dept": "Machinery", "notes": null},
  {"no": "AST-0117", "code": "S2-02", "name": "SAW, BAND", "brand": "HUA HUA", "model": "MJ345", "area": "D03", "dept": "Machinery", "notes": null},
  {"no": "AST-0118", "code": "U1-24", "name": "UPHOLSTERY, SEWING MACHINE EXTRA HIGH SPEED OVERLOCK (EDGING MACHINE)", "brand": "GOLDEN WHEEL", "model": "CS-5150L", "area": "J14", "dept": "Upholstery", "notes": "Description (overlock) may belong to U1-26, see photo · Placard in photo reads area J15, sheet says J 14; Photo shows a single-needle machine, not an overlock"},
  {"no": "AST-0119", "code": "U1-26", "name": "UPHOLSTERY, FABRIC THINNER", "brand": "GOLDEN WHEEL", "model": "CS-M74013-H", "area": "J14", "dept": "Upholstery", "notes": "Description FABRIC THINNER, but photo and placard show an overlock · Placard in photo reads area I16, sheet says J 14; Placard item reads 'sewing machine extra high speed overlock'"},
  {"no": "AST-0120", "code": "V1-01", "name": "VENEER, CUTTER", "brand": "NANXING", "model": "MT310", "area": "D03", "dept": "Machinery", "notes": null},
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

/* ── the one code system (0293, D451) ─────────────────────────────────── */

const fam = (code: string, type_name: string, label_en: string, label_id: string, opts: Partial<CodeFamily> = {}): CodeFamily => ({
  code, letter: code[0], digit: Number(code.slice(1)), type_name, label_en, label_id, kind: "unit",
  asset_category_code: "machine", category_default: false, item_category_code: null, reserved: false, is_active: true, ...opts,
});

/** The 2013 families, C3/C4 held back, and a default for each asset category
 *  — the same registry 0293 seeds. */
export const DEMO_CODE_FAMILIES: CodeFamily[] = [
  fam("A1", "AIR COMPRESSOR", "Air compressor", "Kompresor udara"), fam("A2", "AIR DRYER", "Air dryer", "Pengering udara"),
  fam("A3", "AIR TANK", "Air tank", "Tangki udara"), fam("B1", "BORING", "Boring", "Bor (boring)"),
  fam("C1", "CLAMP", "Clamp", "Klem"), fam("C2", "CONSTRUCTION", "Construction equipment", "Alat konstruksi"),
  fam("C3", "CONSTRUCTION", "Reserved: 2013 label C3-03", "Dicadangkan", { reserved: true }),
  fam("C4", "CONSTRUCTION", "Reserved: 2013 label C4-04", "Dicadangkan", { reserved: true }),
  fam("D1", "DOVETAILING MACHINE", "Dovetailing", "Dovetail"), fam("D2", "DRILL", "Drill press", "Bor duduk"),
  fam("D3", "DEHUMIDIFIER", "Dehumidifier", "Dehumidifier"), fam("E1", "EDGEBANDER", "Edgebander", "Edgebander"),
  fam("F1", "FINISHING", "Spray booth", "Spray booth"), fam("G1", "GLUE", "Glue roller", "Roller lem"),
  fam("J1", "JOINTER", "Jointer", "Jointer"), fam("L1", "LATHE MACHINE", "Lathe", "Bubut"),
  fam("M1", "METAL", "Metal working", "Pengerjaan logam"), fam("M2", "MOULDER", "Moulder", "Moulder"),
  fam("P1", "PLANER", "Planer", "Serut (planer)"), fam("P2", "PRESS", "Press", "Press"),
  fam("R1", "ROUTER", "Router", "Router"), fam("S1", "SANDER", "Sander", "Amplas (sander)"),
  fam("S2", "SAW", "Saw", "Gergaji"), fam("T1", "TOOLROOM", "Toolroom", "Toolroom"),
  fam("U1", "UPHOLSTERY", "Upholstery", "Jok (upholstery)"), fam("V1", "VENEER", "Veneer", "Veneer"),
  fam("C5", "CCTV", "CCTV & security", "CCTV & keamanan", { asset_category_code: "cctv", category_default: true }),
  fam("C6", "COMPUTER", "Computer", "Komputer", { asset_category_code: "computer", category_default: true }),
  fam("P3", "PRINTER", "Printer & scanner", "Printer & scanner", { asset_category_code: "printer", category_default: true }),
  fam("N1", "NETWORK DEVICE", "Network device", "Perangkat jaringan", { asset_category_code: "network", category_default: true }),
  fam("P4", "PHONE", "Phone & tablet", "HP & tablet", { asset_category_code: "phone", category_default: true }),
  fam("V2", "VEHICLE", "Vehicle", "Kendaraan", { asset_category_code: "vehicle", category_default: true }),
  fam("T2", "TOOL", "Tool & equipment", "Alat & perlengkapan", { asset_category_code: "tool", category_default: true }),
  fam("F2", "FURNITURE", "Office furniture", "Mebel kantor", { asset_category_code: "furniture", category_default: true }),
  fam("O1", "OTHER", "Other", "Lainnya", { asset_category_code: "other", category_default: true }),
];

const corrected = (legacy: string) => ({ "C3-03": "C2-03", "C4-04": "C2-04", "U-11": "U1-11" } as Record<string, string>)[legacy] ?? legacy;

/** Codes as 0293 and import step 15 give them: a 2013 machine its corrected
 *  2013 code, any other asset the next number in its category's family. */
export const DEMO_ASSET_CODES: AssetCode[] = (() => {
  const out: AssetCode[] = [];
  const next = (family: string) => {
    const n = out.filter((c) => c.family_code === family).reduce((m, c) => Math.max(m, Number(c.code.split("-")[1])), 0) + 1;
    return `${family}-${String(n).padStart(2, "0")}`;
  };
  for (const r of REGISTER) {
    let code = corrected(r.code);
    const family = code.split("-")[0];
    if (out.some((c) => c.code === code)) code = next(family);
    out.push({ asset_no: r.no, code, family_code: family, description: null });
  }
  for (const a of ASSETS) {
    const family = DEMO_CODE_FAMILIES.find((f) => f.category_default && f.asset_category_code === a.category_code)?.code;
    if (family) out.push({ asset_no: a.asset_no, code: next(family), family_code: family, description: null });
  }
  return out;
})();
