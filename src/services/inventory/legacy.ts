/** The 2013 machine register's identifiers, decoded (D450).
 *
 *  `docs/handoff/inventory-verification/LEGACY-CODES.md` is the definition;
 *  this is its code. Nothing here is stored: it reads the `legacy_*` columns
 *  the import kept as the register recorded them.
 *
 *    code        `L#-##`  type letter · family within the letter · unit
 *    area        `M16`    a cell of the 2013 floor grid, column A–N × row 1–16
 *    department  ten values, each with a short code
 */

import type { Message } from "@/lib/i18n";

/** The 27 families: the type letter and its family digit. */
export const LEGACY_FAMILIES: Record<string, Message> = {
  A1: { en: "Air compressor", id: "Kompresor udara" },
  A2: { en: "Air dryer", id: "Pengering udara" },
  A3: { en: "Air tank", id: "Tangki udara" },
  B1: { en: "Boring", id: "Bor (boring)" },
  C1: { en: "Clamp", id: "Klem" },
  C2: { en: "Construction equipment", id: "Alat konstruksi" },
  D1: { en: "Dovetailing", id: "Dovetail" },
  D2: { en: "Drill press", id: "Bor duduk" },
  D3: { en: "Dehumidifier", id: "Dehumidifier" },
  E1: { en: "Edgebander", id: "Edgebander" },
  F1: { en: "Spray booth", id: "Spray booth" },
  G1: { en: "Glue roller", id: "Roller lem" },
  J1: { en: "Jointer", id: "Jointer" },
  L1: { en: "Lathe", id: "Bubut" },
  M1: { en: "Metal working", id: "Pengerjaan logam" },
  M2: { en: "Moulder", id: "Moulder" },
  P1: { en: "Planer", id: "Serut (planer)" },
  P2: { en: "Press", id: "Press" },
  R1: { en: "Router", id: "Router" },
  S1: { en: "Sander", id: "Amplas (sander)" },
  S2: { en: "Saw", id: "Gergaji" },
  T1: { en: "Toolroom", id: "Toolroom" },
  U1: { en: "Upholstery", id: "Jok (upholstery)" },
  V1: { en: "Veneer", id: "Veneer" },
};

/** Codes that break the pattern, kept as recorded and flagged (D450). */
const BREAKS: Record<string, { family: string; should: string; why: Message }> = {
  "C3-03": { family: "C2", should: "C2-03", why: { en: "Family digit bumped with the unit; should be C2-03", id: "Digit famili ikut naik; seharusnya C2-03" } },
  "C4-04": { family: "C2", should: "C2-04", why: { en: "Family digit bumped with the unit; should be C2-04", id: "Digit famili ikut naik; seharusnya C2-04" } },
  "U-11": { family: "U1", should: "U1-11", why: { en: "Family digit missing; should be U1-11", id: "Digit famili hilang; seharusnya U1-11" } },
};

export interface LegacyCode {
  code: string;
  /** `S2` — the family, after correcting a known break. */
  family: string;
  familyLabel: Message | null;
  /** `14` — the unit within the family. */
  unit: string;
  /** Set when the recorded code breaks the pattern. */
  broken: Message | null;
}

export function decodeLegacyCode(code: string | null | undefined): LegacyCode | null {
  if (!code) return null;
  const c = code.trim().toUpperCase();
  const known = BREAKS[c];
  const m = c.match(/^([A-Z])(\d?)-(\d+)$/);
  if (!m) return null;
  const family = known?.family ?? `${m[1]}${m[2]}`;
  return { code: c, family, familyLabel: LEGACY_FAMILIES[family] ?? null, unit: m[3], broken: known?.why ?? null };
}

/** The ten 2013 departments, by the clean name the import stored. */
export const LEGACY_DEPARTMENTS: Record<string, { short: string; label: Message }> = {
  "Machinery": { short: "MCH", label: { en: "Machinery", id: "Mesin" } },
  "Assembly": { short: "ASM", label: { en: "Assembly", id: "Perakitan" } },
  "Upholstery": { short: "UPH", label: { en: "Upholstery", id: "Jok" } },
  "Finishing": { short: "FIN", label: { en: "Finishing", id: "Finishing" } },
  "Warehouse": { short: "WHS", label: { en: "Warehouse", id: "Gudang" } },
  "Metal production": { short: "MTL", label: { en: "Metal production", id: "Produksi logam" } },
  "Toolroom": { short: "TRM", label: { en: "Toolroom", id: "Toolroom" } },
  "Guard house": { short: "GRD", label: { en: "Guard house", id: "Pos jaga" } },
  "Power house": { short: "PWR", label: { en: "Power house", id: "Power house" } },
  "Fitting": { short: "FIT", label: { en: "Fitting", id: "Fitting" } },
};

export function legacyDepartment(name: string | null | undefined) {
  return name ? LEGACY_DEPARTMENTS[name] ?? null : null;
}

/** `M16` → column `M`, row `16`, or null for anything else. */
export function decodeLegacyArea(area: string | null | undefined): { column: string; row: number } | null {
  const m = area?.trim().toUpperCase().match(/^([A-N])0?(\d{1,2})$/);
  return m ? { column: m[1], row: Number(m[2]) } : null;
}

/** Everything a search box should find a 2013 machine by, in one string:
 *  code, family (`S2`, *Saw*), area, department and its short code. */
export function legacySearchText(row: { legacy_code: string | null; legacy_area: string | null; legacy_department: string | null }): string {
  const c = decodeLegacyCode(row.legacy_code);
  const d = legacyDepartment(row.legacy_department);
  return [row.legacy_code, c?.family, c?.familyLabel?.en, c?.familyLabel?.id, row.legacy_area,
          row.legacy_department, d?.short, d?.label.id].filter(Boolean).join(" ").toLowerCase();
}
