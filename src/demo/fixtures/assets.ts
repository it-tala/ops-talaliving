import type { Asset, AssetCategory } from "@/services/inventory/contracts";

/** The non-production asset register (`0107`), seeded with the categories the
 *  migration seeds and a handful of assets that show each thing the screen
 *  exists to show: something in use with its warranty running, something whose
 *  warranty has lapsed, a vehicle identified by its plate, something in for
 *  repair, and something that has already left. */
export const ASSET_CATEGORIES: AssetCategory[] = [
  { code: "cctv", name: "CCTV & security", description: "Cameras, DVR/NVR, alarms", is_active: true },
  { code: "computer", name: "Computers", description: "Desktop PCs, laptops, monitors", is_active: true },
  { code: "printer", name: "Printers & scanners", description: null, is_active: true },
  { code: "network", name: "Network", description: "Routers, switches, access points", is_active: true },
  { code: "phone", name: "Phones & tablets", description: null, is_active: true },
  { code: "vehicle", name: "Vehicles", description: "Cars, trucks, motorbikes — the plate number goes in the identifier", is_active: true },
  { code: "tool", name: "Tools & equipment", description: "Power tools and equipment that are not stock", is_active: true },
  { code: "furniture", name: "Office furniture", description: null, is_active: true },
  { code: "other", name: "Other", description: null, is_active: true },
];

const base = { created_at: "2026-09-01T09:00:00+08:00", updated_at: "2026-09-01T09:00:00+08:00" };
const owned = {
  ownership: "owned", rent_amount: null, rent_period: null, rent_due_day: null,
  contract_start: null, contract_end: null,
} as const;

export const ASSETS: Asset[] = [
  {
    ...base, ...owned, id: "ast_001", asset_no: "AST-0001", name: "Camera — workshop gate", category_code: "cctv",
    brand: "Hikvision", model: "DS-2CD1023", identifier: "SN-778812", location: "Workshop gate", holder: "Security",
    status: "in_use", acquired_on: "2026-01-15", purchase_cost: 850_000, vendor_code: null, trx_no: null,
    warranty_until: "2027-01-15", notes: "Night vision", ended_on: null,
  },
  {
    ...base, ...owned, id: "ast_002", asset_no: "AST-0002", name: "NVR 8 channel", category_code: "cctv",
    brand: "Hikvision", model: "DS-7608NI", identifier: "NVR-55120", location: "Office server rack", holder: null,
    status: "in_use", acquired_on: "2025-03-02", purchase_cost: 2_450_000, vendor_code: null, trx_no: null,
    warranty_until: "2026-03-02", notes: null, ended_on: null,
  },
  {
    ...base, ...owned, id: "ast_003", asset_no: "AST-0003", name: "PC — accounting desk", category_code: "computer",
    brand: "Lenovo", model: "ThinkCentre M70q", identifier: "PF3X9K2A", location: "Office, accounting", holder: "Anggun",
    status: "in_use", acquired_on: "2025-08-20", purchase_cost: 9_800_000, vendor_code: null, trx_no: null,
    warranty_until: "2028-08-20", notes: null, ended_on: null,
  },
  {
    ...base, ...owned, id: "ast_004", asset_no: "AST-0004", name: "Pickup — deliveries", category_code: "vehicle",
    brand: "Suzuki", model: "Carry 1.5", identifier: "DK 8123 ZA", location: "Workshop yard", holder: "Made (driver)",
    status: "in_use", acquired_on: "2024-05-10", purchase_cost: 165_000_000, vendor_code: null, trx_no: null,
    warranty_until: null, notes: "STNK renews every May", ended_on: null,
  },
  {
    ...base, ...owned, id: "ast_005", asset_no: "AST-0005", name: "Laser printer — office", category_code: "printer",
    brand: "Brother", model: "HL-L2375DW", identifier: null, location: "Service centre", holder: null,
    status: "under_repair", acquired_on: "2023-11-01", purchase_cost: 2_900_000, vendor_code: null, trx_no: null,
    warranty_until: null, notes: "Paper jam, fuser replaced", ended_on: null,
  },
  {
    ...base, ...owned, id: "ast_006", asset_no: "AST-0006", name: "Laptop — old design", category_code: "computer",
    brand: "Asus", model: "VivoBook 14", identifier: "L9N0CV02", location: null, holder: null,
    status: "disposed", acquired_on: "2021-02-01", purchase_cost: 7_200_000, vendor_code: null, trx_no: null,
    warranty_until: null, notes: "Sold to staff", ended_on: "2026-08-30",
  },
  /* Not ours (`0116`): a generator rented by the month, its rent already on
     the calendar; a car leased by the year, its rent not yet; and a projector
     borrowed from a client that has to go back within the fortnight. */
  {
    ...base, id: "ast_007", asset_no: "AST-0007", name: "Generator 20 kVA — workshop", category_code: "tool",
    brand: "Denyo", model: "DCA-25", identifier: "GEN-2231", location: "Workshop, back yard", holder: null,
    status: "in_use", acquired_on: null, purchase_cost: null, vendor_code: "V-0005", trx_no: null,
    warranty_until: null, notes: "Serviced by the lessor", ended_on: null,
    ownership: "rented", rent_amount: 3_500_000, rent_period: "monthly", rent_due_day: 10,
    contract_start: "2026-06-10", contract_end: "2027-06-10",
  },
  {
    ...base, id: "ast_008", asset_no: "AST-0008", name: "Car — site visits", category_code: "vehicle",
    brand: "Toyota", model: "Avanza", identifier: "DK 1450 AB", location: "Office car park", holder: "Anggun",
    status: "in_use", acquired_on: null, purchase_cost: null, vendor_code: null, trx_no: null,
    warranty_until: null, notes: null, ended_on: null,
    ownership: "leased", rent_amount: 54_000_000, rent_period: "yearly", rent_due_day: null,
    contract_start: "2025-10-15", contract_end: "2028-10-15",
  },
  {
    ...base, id: "ast_009", asset_no: "AST-0009", name: "Projector — showroom", category_code: "other",
    brand: "Epson", model: "EB-X06", identifier: null, location: "Showroom", holder: null,
    status: "in_use", acquired_on: null, purchase_cost: null, vendor_code: null, trx_no: null,
    warranty_until: null, notes: "Lent by the client for the launch", ended_on: null,
    ownership: "borrowed", rent_amount: null, rent_period: null, rent_due_day: null,
    contract_start: "2026-09-01", contract_end: "2026-10-05",
  },
];
