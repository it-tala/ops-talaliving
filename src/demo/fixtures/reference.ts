import type {
  Vendor, Uom, UomConversion, ItemCategory, Item, Project, ProjectLine,
} from "@/services/procurement/contracts";
import type { Account, TransactionType } from "@/services/accounting/contracts";
import type { DemoUser } from "../state";

/* Demo people. Real shapes, invented names — except the mailbox conventions,
 * which match how the running system addresses people.
 *
 * Note what these demonstrate together: a user holds SEVERAL module grants
 * (D23), and authorities are granted separately from them (D24). Andi can
 * raise a purchase request but cannot approve one; Geryle can approve the
 * money but never sees a ledger row; only Evin can approve goods. */
export const USERS: DemoUser[] = [
  {
    id: "usr_evin", email: "evin@talaliving.com", full_name: "Evin Jonathan", is_active: true,
    modules: [
      { module: "dashboard", level: "read" },
      { module: "procurement", level: "write" },
      { module: "accounting", level: "read" },
      { module: "production", level: "read" },
      { module: "inventory", level: "read" },
      { module: "project", level: "read" },
      { module: "settings", level: "read" },
      /* Read, not admin. The owner's answer to Q22: the IT module is open to
       * IT and to leadership, and what leadership was given is the right to
       * **read** it. Purging the activity log and moving people's grants stay
       * with IT, which is what the level split enforces (D190). */
      { module: "it", level: "read" },
    ],
    /* The Direktur holds both leadership decisions: goods, and now overtime
     * (D145). Which person should hold `approve_overtime` is the owner's to
     * change — it is granted separately precisely so it can move. */
    authorities: ["approve_goods", "approve_overtime"],
  },
  {
    id: "usr_putri", email: "putri@talaliving.com", full_name: "Putri Handayani", is_active: true,
    modules: [
      { module: "dashboard", level: "read" },
      { module: "accounting", level: "write" },
      { module: "procurement", level: "write" },
      { module: "settings", level: "read" },
    ],
    authorities: ["approve_funds", "post_ledger", "resolve_inbox"],
  },
  {
    id: "usr_anggun", email: "anggun@talaliving.com", full_name: "Anggun Lestari", is_active: true,
    modules: [
      { module: "dashboard", level: "read" },
      { module: "accounting", level: "write" },
    ],
    authorities: ["post_ledger", "resolve_inbox"],
  },
  {
    id: "usr_geryle", email: "geryle@talaliving.com", full_name: "Geryle Tanoto", is_active: true,
    modules: [
      { module: "dashboard", level: "read" },
      { module: "procurement", level: "read" },
    ],
    authorities: ["approve_funds"],
  },
  {
    id: "usr_andi", email: "andi@talaliving.com", full_name: "Andi Prasetyo", is_active: true,
    modules: [
      { module: "dashboard", level: "read" },
      { module: "procurement", level: "write" },
      { module: "inventory", level: "read" },
    ],
    authorities: [],
  },
  {
    /* Kepala Gudang, and the workshop's own hand on the production board: he
     * is the one who opens a work order and reports what came off the floor
     * (D148). No authorities — reporting work is not approving anything. */
    id: "usr_made", email: "made@talaliving.com", full_name: "Made Suparta", is_active: true,
    modules: [
      { module: "dashboard", level: "read" },
      { module: "inventory", level: "write" },
      { module: "production", level: "write" },
      { module: "procurement", level: "read" },
      /* The last leg is his too (D209). He is already the workshop's own hand
       * on the production board; delivery, installation and the handover
       * record are the same person reporting what happened, one step further
       * down the line. Building those screens found that **nobody in the seed
       * could use them at all** — the only `project` grant was leadership's,
       * at read (F61). */
      { module: "project", level: "write" },
    ],
    authorities: [],
  },
  {
    /* HRD. The one person whose day is the timesheet: she reads the days the
     * fingerprint machine could not describe, says what happened on them, and
     * runs the payroll — but approving overtime and approving the money are
     * somebody else's signature (D24). */
    id: "usr_wulan", email: "wulan@talaliving.com", full_name: "Wulan Sari", is_active: true,
    modules: [
      { module: "dashboard", level: "read" },
      { module: "hrd", level: "write" },
      { module: "payroll", level: "write" },
    ],
    authorities: [],
  },
  {
    id: "usr_shared", email: "it@talaliving.com", full_name: "IT / Shared", is_active: true,
    modules: [
      { module: "dashboard", level: "read" },
      { module: "hrd", level: "admin" },
      { module: "payroll", level: "admin" },
      { module: "procurement", level: "admin" },
      { module: "inventory", level: "admin" },
      { module: "accounting", level: "admin" },
      { module: "marketing", level: "admin" },
      { module: "project", level: "admin" },
      { module: "production", level: "admin" },
      { module: "it", level: "admin" },
      { module: "settings", level: "admin" },
    ],
    authorities: ["approve_goods", "approve_funds", "approve_overtime", "post_ledger", "resolve_inbox"],
  },
];

/** The five accounts, spelled exactly. Three are held by accounting and pay
 *  vendors; two are held by leadership and never pay a vendor directly. */
/* BCA 271 is kept lean on purpose: it is funded per payment round, not held
 * full. That is also what makes the meeting board's most important number
 * — how much has to be transferred in before what is approved can be paid —
 * a real number in the demo rather than a permanent "nothing needed". A
 * screen whose key figure is always zero teaches that it cannot happen. */
export const ACCOUNTS: Account[] = [
  { id: "acc_petty", code: "PETTY CASH", name: "Workshop petty cash", custody: "accounting", is_paying: true, currency: "IDR", opening_balance: 5_000_000, opened_on: "2026-01-01", is_active: true },
  { id: "acc_bni325", code: "BNI 325", name: "BNI 325 — Operations", custody: "accounting", is_paying: true, currency: "IDR", opening_balance: 42_000_000, opened_on: "2026-01-01", is_active: true },
  { id: "acc_bca271", code: "BCA 271", name: "BCA 271 — Accounting custody", custody: "accounting", is_paying: true, currency: "IDR", opening_balance: 60_000_000, opened_on: "2026-01-01", is_active: true },
  { id: "acc_jago", code: "JAGO", name: "JAGO — day-to-day operations", custody: "accounting", is_paying: true, currency: "IDR", opening_balance: 25_000_000, opened_on: "2026-01-01", is_active: true },
  { id: "acc_bca064", code: "BCA 064", name: "BCA 064 — Leadership account", custody: "leadership", is_paying: false, currency: "IDR", opening_balance: 610_000_000, opened_on: "2026-01-01", is_active: true },
  { id: "acc_bcausd", code: "BCA USD 081", name: "BCA USD 081 — Leadership account", custody: "leadership", is_paying: false, currency: "USD", opening_balance: 0, opened_on: "2026-01-01", is_active: true },
];

/** Thirteen types. `is_purchase` vetoes auto-complete — goods that were bought
 *  can still be delivered. `auto_complete` ships false everywhere (D26). */
export const TRANSACTION_TYPES: TransactionType[] = [
  { code: "RECCURING - UTILITIES", is_purchase: false, auto_complete: false, creates_catalog_item: false },
  { code: "CREDIT CARD", is_purchase: false, auto_complete: false, creates_catalog_item: false },
  { code: "PREPAID VENDOR", is_purchase: true, auto_complete: false, creates_catalog_item: true },
  { code: "SUPPLIERS", is_purchase: true, auto_complete: false, creates_catalog_item: true },
  { code: "BANK CHARGES", is_purchase: false, auto_complete: false, creates_catalog_item: false },
  { code: "ONLINE", is_purchase: true, auto_complete: false, creates_catalog_item: true },
  { code: "CHINA", is_purchase: true, auto_complete: false, creates_catalog_item: true },
  { code: "RECCURING - PAYROLL", is_purchase: false, auto_complete: false, creates_catalog_item: false },
  { code: "CASHFLOW", is_purchase: false, auto_complete: false, creates_catalog_item: false },
  { code: "OTHERS", is_purchase: false, auto_complete: false, creates_catalog_item: false },
  { code: "PRODUCTION", is_purchase: true, auto_complete: false, creates_catalog_item: true },
  { code: "OFFICE", is_purchase: true, auto_complete: false, creates_catalog_item: true },
  { code: "WAREHOUSE", is_purchase: true, auto_complete: false, creates_catalog_item: true },
];

export const UOM: Uom[] = [
  { code: "pcs", name: "Pieces", dimension: "count" },
  { code: "buah", name: "Buah (each)", dimension: "count" },
  { code: "kg", name: "Kilogram", dimension: "mass" },
  { code: "gr", name: "Gram", dimension: "mass" },
  { code: "meter", name: "Meter", dimension: "length" },
  { code: "m2", name: "Square metre", dimension: "area" },
  { code: "m3", name: "Cubic metre", dimension: "volume" },
  { code: "cm", name: "Centimetre", dimension: "length" },
  { code: "sak", name: "Sak (bag)", dimension: "count" },
  { code: "box", name: "Box", dimension: "count" },
  { code: "roll", name: "Roll", dimension: "count" },
  { code: "set", name: "Set", dimension: "count" },
  { code: "pack", name: "Pack", dimension: "count" },
  { code: "ltr", name: "Liter", dimension: "volume" },
  { code: "lembar", name: "Lembar (sheet)", dimension: "count" },
  { code: "batang", name: "Batang (bar)", dimension: "count" },
  { code: "unit", name: "Unit", dimension: "count" },
  { code: "lusin", name: "Lusin (dozen)", dimension: "count" },
];

/** Packaging conversions only, in Phase 1. `yield_ratio` is the hook the wood
 *  chain needs later: a log does not become boards one-for-one. */
export const UOM_CONVERSIONS: UomConversion[] = [
  { id: "uc_01", from_uom: "lusin", to_uom: "pcs", factor: 12, yield_ratio: null, note: null },
  { id: "uc_02", from_uom: "kg", to_uom: "gr", factor: 1000, yield_ratio: null, note: null },
  { id: "uc_03", from_uom: "box", to_uom: "pcs", factor: 100, yield_ratio: null, note: "screws, per factory box" },
  { id: "uc_04", from_uom: "m3", to_uom: "lembar", factor: 55, yield_ratio: 0.52, note: "teak log -> 3cm board, 45-60% yield" },
];

/** The catalogue's own filing, two levels deep (D169).
 *
 *  The first version of this list had nine flat headings and one of them was
 *  "Production", which is every item in the workshop. A category earns its
 *  place by answering a question somebody actually asks: *how much wood is on
 *  the rack*, *which finishing is running out*, *what did we spend on hardware
 *  this month*. Anything that does not separate two of those is a word, not a
 *  category.
 *
 *  Two levels, deliberately not three: the parent is what a report groups by,
 *  the child is what a storeman looks for. A third level would be the item.
 *
 *  `stocked` is on the category rather than on each item, because it is a
 *  property of the *kind* of thing: a service is never on a rack, and neither
 *  is electricity. An item in a stocked category is counted; one in an
 *  unstocked category is bought and expensed, and the stock screen says which
 *  of the two it is rather than showing a silent zero.
 */
export const ITEM_CATEGORIES: ItemCategory[] = [
  { code: "bahan", parent_code: null, name: "Bahan baku" },
  { code: "kayu", parent_code: "bahan", name: "Kayu solid" },
  { code: "panel", parent_code: "bahan", name: "Panel & pelapis" },

  { code: "hardware", parent_code: null, name: "Hardware" },
  { code: "engsel-rel", parent_code: "hardware", name: "Engsel, rel & mekanis" },
  { code: "handle", parent_code: "hardware", name: "Handle & aksesori" },
  { code: "pengikat", parent_code: "hardware", name: "Sekrup, paku & baut" },

  { code: "finishing", parent_code: null, name: "Finishing" },
  { code: "cat", parent_code: "finishing", name: "Cat, stain & sealer" },
  { code: "pelarut", parent_code: "finishing", name: "Pelarut & pembersih" },
  { code: "lem", parent_code: "finishing", name: "Lem & dempul" },

  { code: "abrasif", parent_code: null, name: "Amplas & abrasif" },
  { code: "mesin", parent_code: null, name: "Perkakas & sparepart mesin" },
  { code: "kemasan", parent_code: null, name: "Kemasan & pengiriman" },
  { code: "kantor", parent_code: null, name: "Kantor & umum" },

  { code: "jasa", parent_code: null, name: "Jasa" },
  { code: "uncurated", parent_code: null, name: "Belum dikategorikan" },
];

/** Which categories sit on a rack and are counted. Everything else is bought
 *  and gone the same day — a service, the electricity bill, an item nobody has
 *  filed yet (D169). */
export const STOCKED_CATEGORIES = new Set([
  "kayu", "panel", "engsel-rel", "handle", "pengikat",
  "cat", "pelarut", "lem", "abrasif", "mesin", "kemasan", "kantor",
]);

export const PROJECTS: Project[] = [
  {
    id: "prj_25004", code: "25004", name: "STANDARD", is_active: true,
    client_name: null, location: "Workshop", pic: "Made Suparta",
    started_on: "2026-01-02", target_date: null, contract_value: null,
    note: "Produksi stok, bukan pesanan pelanggan.",
  },
  {
    id: "prj_25007", code: "25007", name: "BABY ISLAND", is_active: true,
    client_name: "PT Baby Island Resort", location: "Nusa Dua", pic: "Evin Jonathan",
    started_on: "2026-07-14", target_date: "2026-09-20", contract_value: 298_400_000,
    note: null,
  },
  {
    id: "prj_25009", code: "25009", name: "VILLA SEMINYAK", is_active: true,
    client_name: "Ibu Laksmi", location: "Seminyak", pic: "Evin Jonathan",
    started_on: "2026-08-01", target_date: "2026-10-15", contract_value: 214_200_000,
    note: null,
  },
  {
    id: "prj_25011", code: "25011", name: "HOTEL UBUD", is_active: true,
    client_name: "Ubud Green Hospitality", location: "Ubud", pic: "Andi Prasetyo",
    started_on: "2026-09-01", target_date: "2026-12-05", contract_value: 1_006_800_000,
    note: "Termin 3 kali, DP sudah masuk.",
  },
  {
    id: "prj_25012", code: "25012", name: "OFFICE FITOUT", is_active: false,
    client_name: "PT Sinar Kreasi", location: "Denpasar", pic: null,
    started_on: "2026-03-10", target_date: "2026-06-30", contract_value: 98_000_000,
    /* Contract value deliberately above the sum of its lines: the second
     * phase was agreed by telephone and never written down as a line. That
     * gap is what the drawer's "beda dari nilai kontrak" is for (D150). */
    note: "Selesai dan diserahterimakan Juni 2026. Tahap kedua belum pernah dicatat sebagai baris.",
  },
];

/** Twelve vendors. Three are uncurated: recorded, shown, marked, and absent
 *  from dropdowns until a human promotes them. A name somebody types is always
 *  accepted — that was the owner's call and it stands. */
export const VENDORS: Vendor[] = [
  { id: "vnd_01", code: "V-0001", name: "CV SUMBER KAYU JATI", aka: ["SUMBER KAYU"], is_curated: true,
    phone: "0361-812445", address: "Jl. Raya Gianyar No. 88, Gianyar, Bali",
    pic_name: "Hendra Wijaya", pic_phone: "0812-3811-4402",
    bank_account: "BCA 145-0882-771", bank_account_secondary: "Mandiri 145-00-1120884-2",
    npwp: "01.234.567.8-905.000", supplied_categories: ["kayu", "panel"] },
  { id: "vnd_02", code: "V-0002", name: "UD ALRIZKY JAYA", aka: ["ALRIZKY", "AL RIZKY"], is_curated: true,
    phone: "0361-425190", address: "Jl. Cokroaminoto 210, Denpasar",
    pic_name: "Rina Kusuma", pic_phone: "0813-3902-1188",
    bank_account: "BNI 088-771-2210", bank_account_secondary: null,
    npwp: null, supplied_categories: ["hardware", "mesin"] },
  { id: "vnd_03", code: "V-0003", name: "TOKO BANGUNAN MAKMUR SENTOSA", aka: ["MAKMUR SENTOSA"], is_curated: true,
    phone: "0361-733012", address: "Jl. Mahendradatta 45, Denpasar",
    pic_name: "Yanto Suryana", pic_phone: "0878-6120-4471",
    bank_account: "BCA 771-0034-112", bank_account_secondary: "BRI 0271-01-004488-53",
    npwp: null, supplied_categories: ["panel", "hardware", "lem", "kantor"] },
  { id: "vnd_04", code: "V-0004", name: "PT PROPAN RAYA ICC", aka: ["PROPAN"], is_curated: true,
    phone: "021-5901888", address: "Kawasan Industri Jatake, Tangerang",
    pic_name: "Bagus Nugroho (Sales Bali)", pic_phone: "0811-9004-2213",
    bank_account: "Mandiri 128-00-0912334-5", bank_account_secondary: "BCA 206-3009-118",
    npwp: "01.311.402.7-054.000", supplied_categories: ["cat", "pelarut", "abrasif"] },
  { id: "vnd_05", code: "V-0005", name: "CV MITRA TEKNIK MANDIRI", aka: [], is_curated: true,
    phone: "0361-462017", address: "Jl. By Pass Ngurah Rai 122, Sanur",
    pic_name: "Sukirman", pic_phone: "0812-3744-9901",
    bank_account: "BCA 145-0771-330", bank_account_secondary: null,
    npwp: null, supplied_categories: ["mesin", "jasa"] },
  { id: "vnd_06", code: "V-0006", name: "UD KARYA LOGAM ABADI", aka: ["KARYA LOGAM"], is_curated: true,
    phone: "0361-298776", address: "Jl. Gatot Subroto Barat 190, Denpasar",
    pic_name: "Anwar Hidayat", pic_phone: "0857-3388-2210",
    bank_account: null, bank_account_secondary: null,
    npwp: null, supplied_categories: ["hardware"] },
  { id: "vnd_07", code: "V-0007", name: "TOKO AMPLAS SEJAHTERA", aka: [], is_curated: true,
    phone: "0361-234881", address: "Jl. Imam Bonjol 77, Denpasar",
    pic_name: "Dewi Anggraini", pic_phone: "0819-3312-7788",
    bank_account: "BNI 771-002-8891", bank_account_secondary: null,
    npwp: null, supplied_categories: ["abrasif"] },
  { id: "vnd_08", code: "V-0008", name: "PT INDO VENEER UTAMA", aka: ["INDOVENEER"], is_curated: true,
    phone: "031-7885120", address: "Jl. Rungkut Industri III/44, Surabaya",
    pic_name: "Maya Kartika", pic_phone: "0811-3055-6677",
    bank_account: "BCA 188-3300-771", bank_account_secondary: "Mandiri 141-00-7788221-9",
    npwp: "02.115.889.4-604.000", supplied_categories: ["kayu", "panel"] },
  { id: "vnd_09", code: "V-0009", name: "CV BALI PACKING PRIMA", aka: [], is_curated: true,
    phone: "0361-901223", address: "Jl. Kargo Permai 12, Denpasar",
    pic_name: "Gede Arya", pic_phone: "0813-3877-2244",
    bank_account: "BCA 145-8812-004", bank_account_secondary: null,
    npwp: null, supplied_categories: ["kemasan"] },
  /* The three below are uncurated: recorded because money moved, and nobody has
   * filled in who to call. That gap is the point — an empty PIC on a vendor we
   * keep buying from is a question the screen should be able to raise. */
  /* The vendor the purchase journey was designed around: three orders, a
   * deposit, an over-delivery, a shipment that has not arrived, and one
   * transfer that closes three orders at once (D97). */
  { id: "vnd_13", code: "V-0013", name: "HADI GLASS", aka: ["HADI KACA"], is_curated: true,
    phone: "0361-778220", address: "Jl. Cokroaminoto 88, Denpasar",
    pic_name: "Pak Hadi", pic_phone: "0812-3600-8821",
    bank_account: "BCA 771-0088-221", bank_account_secondary: null,
    npwp: null, supplied_categories: ["finishing"] },
  { id: "vnd_10", code: "V-0010", name: "UD SINAR ABADI", aka: [], is_curated: false,
    phone: null, address: null, pic_name: null, pic_phone: null,
    bank_account: null, bank_account_secondary: null, npwp: null, supplied_categories: [] },
  { id: "vnd_11", code: "V-0011", name: "TOKO LISTRIK JAYA MANDIRI", aka: [], is_curated: false,
    phone: null, address: null, pic_name: null, pic_phone: null,
    bank_account: null, bank_account_secondary: null, npwp: null, supplied_categories: [] },
  { id: "vnd_12", code: "V-0012", name: "CV KAYU MANIS SELATAN", aka: [], is_curated: false,
    phone: null, address: null, pic_name: null, pic_phone: null,
    bank_account: null, bank_account_secondary: null, npwp: null, supplied_categories: ["kayu", "panel"] },
  /* The two statutory bodies. Counterparties rather than suppliers — they are
     named here so the BPJS calendar lines can claim their own payments before
     the plain payroll category sweeps them up (D110, D259). */
  { id: "vnd_50", code: "V-0050", name: "BPJS KESEHATAN", aka: ["BPJS KES"], is_curated: true,
    phone: "1500400", address: "Kantor Cabang Denpasar",
    pic_name: null, pic_phone: null,
    bank_account: null, bank_account_secondary: null,
    npwp: null, supplied_categories: [] },
  { id: "vnd_51", code: "V-0051", name: "BPJS KETENAGAKERJAAN", aka: ["BPJS TK", "BPJSTK"], is_curated: true,
    phone: "175", address: "Kantor Cabang Denpasar",
    pic_name: null, pic_phone: null,
    bank_account: null, bank_account_secondary: null,
    npwp: null, supplied_categories: [] },
];

type ItemSeed = [string, string, string, Item["base_uom"], number | null, number | null, string | null, boolean, Item["kind"]];

/* code, name, category, uom, standard_price, last_price, last_vendor, curated, kind */
const ITEM_SEEDS: ItemSeed[] = [
  ["ITM-0001", "KAYU JATI SORTIMEN A", "kayu", "m3", 18_500_000, 18_900_000, "vnd_01", true, "goods"],
  ["ITM-0002", "KAYU JATI SORTIMEN B", "kayu", "m3", 14_200_000, 14_200_000, "vnd_01", true, "goods"],
  ["ITM-0003", "KAYU MAHONI LOG", "kayu", "m3", 6_800_000, 6_950_000, "vnd_01", true, "goods"],
  ["ITM-0004", "KAYU SUNGKAI PAPAN 2CM", "kayu", "lembar", 185_000, 188_000, "vnd_12", true, "goods"],
  ["ITM-0005", "KAYU MINDI LOG", "kayu", "m3", 4_900_000, null, null, true, "goods"],
  ["ITM-0006", "PAPAN JATI KERING 3CM", "kayu", "lembar", 620_000, 640_000, "vnd_01", true, "goods"],
  ["ITM-0007", "PLYWOOD 18MM 122X244", "panel", "lembar", 285_000, 292_000, "vnd_03", true, "goods"],
  ["ITM-0008", "PLYWOOD 12MM 122X244", "panel", "lembar", 198_000, 205_000, "vnd_03", true, "goods"],
  ["ITM-0009", "MDF 15MM 122X244", "panel", "lembar", 165_000, null, null, true, "goods"],
  ["ITM-0010", "HPL TACO TH 133 GLOSSY", "panel", "lembar", 245_000, 248_000, "vnd_08", true, "goods"],
  ["ITM-0011", "VENEER JATI 0.6MM", "panel", "lembar", 87_000, 89_500, "vnd_08", true, "goods"],
  ["ITM-0012", "AMPLAS 80 GRIT", "abrasif", "lembar", 7_500, 7_500, "vnd_07", true, "goods"],
  ["ITM-0013", "AMPLAS 120 GRIT", "abrasif", "lembar", 7_500, 7_650, "vnd_07", true, "goods"],
  ["ITM-0014", "AMPLAS 240 GRIT", "abrasif", "lembar", 8_000, 8_000, "vnd_07", true, "goods"],
  ["ITM-0015", "AMPLAS ROLL 180 GRIT", "abrasif", "roll", 385_000, 392_000, "vnd_07", true, "goods"],
  ["ITM-0016", "SANDING SEALER PROPAN", "cat", "ltr", 78_000, 79_500, "vnd_04", true, "goods"],
  ["ITM-0017", "CAT DUCO PUTIH", "cat", "ltr", 165_000, 168_000, "vnd_04", true, "goods"],
  ["ITM-0018", "THINNER ND SUPER", "pelarut", "ltr", 32_000, 33_500, "vnd_04", true, "goods"],
  ["ITM-0019", "MELAMINE CLEAR DOFF", "cat", "ltr", 142_000, 145_000, "vnd_04", true, "goods"],
  ["ITM-0020", "WOOD STAIN WALNUT", "cat", "ltr", 118_000, null, null, true, "goods"],
  ["ITM-0021", "DEMPUL KAYU", "lem", "kg", 45_000, 46_500, "vnd_03", true, "goods"],
  ["ITM-0022", "LEM PUTIH FOX 5 KG", "lem", "pack", 230_000, 230_000, "vnd_03", true, "goods"],
  ["ITM-0023", "LEM KUNING AIBON", "lem", "kg", 68_000, 69_000, "vnd_03", true, "goods"],
  ["ITM-0024", "ENGSEL SENDOK HUBEN", "engsel-rel", "pcs", 18_500, 18_500, "vnd_02", true, "goods"],
  ["ITM-0025", "REL LACI FULL EXTENSION 45CM", "engsel-rel", "set", 95_000, 97_500, "vnd_02", true, "goods"],
  ["ITM-0026", "HANDLE TARIK ALUMUNIUM 128MM", "handle", "pcs", 32_000, 32_000, "vnd_02", true, "goods"],
  ["ITM-0027", "SEKRUP GYPSUM 1 INCH", "pengikat", "box", 42_000, 43_000, "vnd_02", true, "goods"],
  ["ITM-0028", "PAKU 5CM", "pengikat", "kg", 22_000, 22_500, "vnd_03", true, "goods"],
  ["ITM-0029", "MATA BOR SET HSS", "mesin", "set", 285_000, null, null, true, "goods"],
  ["ITM-0030", "PISAU PLANER 300MM", "mesin", "set", 420_000, 435_000, "vnd_05", true, "goods"],
  ["ITM-0031", "BATU GERINDA 4 INCH", "mesin", "pcs", 12_000, 12_500, "vnd_05", true, "goods"],
  ["ITM-0032", "KARDUS DOUBLE WALL 60X40X40", "kemasan", "pcs", 28_000, 28_500, "vnd_09", true, "goods"],
  ["ITM-0033", "BUBBLE WRAP 125CM", "kemasan", "roll", 420_000, 428_000, "vnd_09", true, "goods"],
  ["ITM-0034", "STRETCH FILM 500MM", "kemasan", "roll", 95_000, 96_000, "vnd_09", true, "goods"],
  ["ITM-0035", "STYROFOAM SHEET 2CM", "kemasan", "lembar", 35_000, null, null, true, "goods"],
  ["ITM-0036", "LAKBAN COKLAT 2 INCH", "kemasan", "pcs", 12_500, 12_500, "vnd_09", true, "goods"],
  ["ITM-0037", "KERTAS HVS A4 80GR", "kantor", "pack", 58_000, 59_000, "vnd_03", true, "goods"],
  ["ITM-0038", "TINTA PRINTER EPSON 003", "kantor", "pcs", 95_000, null, null, true, "goods"],
  ["ITM-0039", "JASA POTONG RUMPUT HALAMAN", "jasa", "unit", 350_000, 350_000, "vnd_10", true, "service"],
  ["ITM-0040", "JASA SERVIS MESIN PLANER", "jasa", "unit", null, 1_250_000, "vnd_05", true, "service"],
  ["ITM-0041", "LISTRIK WORKSHOP BULANAN", "jasa", "unit", null, 4_180_000, null, true, "service"],
  ["ITM-0042", "BAUT L 8MM", "uncurated", "pcs", null, 3_500, "vnd_10", false, "goods"],
  ["ITM-0043", "OLI KOMPRESOR", "uncurated", "ltr", null, 78_000, "vnd_11", false, "goods"],
];

export const ITEMS: Item[] = ITEM_SEEDS.map(
  ([code, name, category_code, base_uom, standard_price, last_price, last_vendor_id, is_curated, kind], i) => ({
    id: `itm_${String(i + 1).padStart(3, "0")}`,
    code,
    name,
    aka: [],
    category_code,
    base_uom,
    kind,
    is_curated,
    standard_price,
    last_price,
    last_vendor_id,
    last_purchased_at: last_price ? "2026-08-24" : null,
  }),
);

export function itemIdByCode(code: string): string {
  const found = ITEMS.find((i) => i.code === code);
  if (!found) throw new Error(`fixture item ${code} not found`);
  return found.id;
}

/** What each customer actually ordered (D150).
 *
 *  The point of having these next to the work orders is the gap between them:
 *  BABY ISLAND ordered four tables and twenty-four chairs and both are on the
 *  floor; VILLA SEMINYAK ordered ten doors and twelve are being made, which is
 *  a real thing that happens and a real thing to notice; HOTEL UBUD signed
 *  three weeks ago and **nothing has been started**, which nobody could see
 *  before this table existed.
 */
export const PROJECT_LINES: ProjectLine[] = [
  { id: "prl_01", project_id: "prj_25007", line_no: 1, product_code: "PRD-MJ-220", description: "Meja makan jati 220×100, finishing natural matt", qty: 4, uom: "set", unit_price: 42_500_000, note: null },
  { id: "prl_02", project_id: "prj_25007", line_no: 2, product_code: "PRD-KR-STD", description: "Kursi makan jati, kain dari klien", qty: 24, uom: "pcs", unit_price: 4_850_000, note: null },
  { id: "prl_03", project_id: "prj_25007", line_no: 3, product_code: null, description: "Pemasangan di lokasi, dua hari", qty: 1, uom: "paket", unit_price: 12_000_000, note: "Jasa, bukan barang produksi." },

  { id: "prl_04", project_id: "prj_25009", line_no: 1, product_code: "PRD-LM-3P", description: "Lemari pakaian 3 pintu, HPL putih", qty: 6, uom: "unit", unit_price: 18_500_000, note: null },
  { id: "prl_05", project_id: "prj_25009", line_no: 2, product_code: "PRD-PT-90", description: "Pintu panel jati 90×210", qty: 10, uom: "daun", unit_price: 7_200_000, note: "SPK dibuat 12 daun — dua untuk cadangan, perlu dicek." },
  { id: "prl_06", project_id: "prj_25009", line_no: 3, product_code: "PRD-NK-KCL", description: "Nakas jati kecil", qty: 8, uom: "unit", unit_price: 3_900_000, note: null },

  { id: "prl_07", project_id: "prj_25011", line_no: 1, product_code: "PRD-MJ-220", description: "Meja makan untuk restoran, 220×100", qty: 14, uom: "set", unit_price: 41_000_000, note: null },
  { id: "prl_08", project_id: "prj_25011", line_no: 2, product_code: "PRD-KR-STD", description: "Kursi makan jati", qty: 84, uom: "pcs", unit_price: 4_700_000, note: null },
  { id: "prl_09", project_id: "prj_25011", line_no: 3, product_code: "PRD-RK-DSP", description: "Rak display lobby", qty: 4, uom: "unit", unit_price: 9_500_000, note: null },

  { id: "prl_10", project_id: "prj_25012", line_no: 1, product_code: "PRD-LM-3P", description: "Lemari arsip 3 pintu", qty: 4, uom: "unit", unit_price: 17_000_000, note: null },
];
