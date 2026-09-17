import type {
  Market, Property, PropertyAgent, SalesRep, Referral, ScrapeRow,
} from "@/services/marketing/contracts";

/** Where the scrape runs (D187).
 *
 *  Three countries on purpose, and at three different stages, because the
 *  question the owner asked is what happens when this stops being one coast:
 *
 *  - **Gold Coast** — the live market, three districts, everything running.
 *  - **Sydney** — scraped last week, nothing enriched, no property yet. What a
 *    new market looks like on its first day.
 *  - **Badung (Bali)** — same, and in **rupiah**, which is the whole reason
 *    currency lives on the market: an ADR of 106 and an ADR of 1.850.000 are
 *    not comparable, not addable, and not worth an invented rate.
 */
export const MARKETS: Market[] = [
  { id: "mkt_01", code: "AU-QLD-GOLDCOAST-SPNORTH", country_code: "AU", country_name: "Australia", region: "Queensland", city: "Gold Coast", area_label: "SP NORTH", currency: "AUD", timezone: "Australia/Brisbane", language: "en", active: true },
  { id: "mkt_02", code: "AU-QLD-GOLDCOAST-SPMIDDLE", country_code: "AU", country_name: "Australia", region: "Queensland", city: "Gold Coast", area_label: "SP MIDDLE", currency: "AUD", timezone: "Australia/Brisbane", language: "en", active: true },
  { id: "mkt_03", code: "AU-QLD-GOLDCOAST-SPSOUTH", country_code: "AU", country_name: "Australia", region: "Queensland", city: "Gold Coast", area_label: "SP SOUTH", currency: "AUD", timezone: "Australia/Brisbane", language: "en", active: true },
  { id: "mkt_04", code: "AU-NSW-SYDNEY-BONDI", country_code: "AU", country_name: "Australia", region: "New South Wales", city: "Sydney", area_label: "BONDI", currency: "AUD", timezone: "Australia/Sydney", language: "en", active: true },
  { id: "mkt_05", code: "ID-BA-BADUNG-SEMINYAK", country_code: "ID", country_name: "Indonesia", region: "Bali", city: "Badung", area_label: "SEMINYAK", currency: "IDR", timezone: "Asia/Makassar", language: "id", active: true },
  { id: "mkt_06", code: "ID-BA-BADUNG-CANGGU", country_code: "ID", country_name: "Indonesia", region: "Bali", city: "Badung", area_label: "CANGGU", currency: "IDR", timezone: "Asia/Makassar", language: "id", active: true },
];

/** The Package pipeline, as the tracker actually holds it (D183).
 *
 *  Names, areas and the shape of the ladder are carried from the sheet the team
 *  runs today — Gold Coast strata properties, three agents each, approached in
 *  order. What the fixtures are built to show is the part the spreadsheet
 *  cannot: every state the follow-up rule produces at once.
 *
 *  - **Chateau Beachside** — agent 1 replied. Nothing to chase.
 *  - **Mantra on View** — agent 1 sent the form back; agent 2 was recycled
 *    after a week of silence; agent 3 is nine days silent and **past the
 *    move-on line**.
 *  - **Meriton Suites** — qualified, scored 3, **never validated by a person**,
 *    both agents still queued.
 *  - **Paradise Island** — a call is set for tomorrow.
 *  - **Budds Beach** — all three agents exhausted, no deal: it goes back on
 *    the pile rather than sitting in the funnel forever.
 *  - **Dorsett** — disqualified, and the reason is in the status.
 */
export const PROPERTIES: Property[] = [
  {
    id: "prp_01", ref: "TL-0001", market_code: "AU-QLD-GOLDCOAST-SPNORTH", name: "Chateau Beachside",
    maps_url: "https://maps.google.com/?q=Chateau+Beachside", address: "Marine Parade, Surfers Paradise",
    status: "QUALIFIED", is_condo: true, rooms: 100, adr: 69, adr_flag: "OK",
    chain: null, reno_signal: "Lobi direnovasi 2024, unit belum",
    reno_source: "Ulasan tamu Mei 2026", review_note: null, rating: 4.1,
    score: 4, validated: true, notes: null, import_id: "imp_scr01",
    created_at: "2026-08-18T09:00:00+08:00",
  },
  {
    id: "prp_02", ref: "TL-0002", market_code: "AU-QLD-GOLDCOAST-SPMIDDLE", name: "Mantra on View",
    maps_url: "https://maps.google.com/?q=Mantra+on+View", address: "Hanlan St, Surfers Paradise",
    status: "QUALIFIED", is_condo: true, rooms: 355, adr: 106, adr_flag: "OK",
    chain: "Mantra", reno_signal: "Beberapa pemilik unit menjual dengan catatan 'needs update'",
    reno_source: "Listing realestate.com.au", review_note: null, rating: 4.3,
    score: 4, validated: true, notes: "Gedung besar — satu agen bisa membuka banyak unit.",
    import_id: "imp_scr01", created_at: "2026-08-18T09:00:00+08:00",
  },
  {
    id: "prp_03", ref: "TL-0003", market_code: "AU-QLD-GOLDCOAST-SPSOUTH", name: "Meriton Suites Southport",
    maps_url: "https://maps.google.com/?q=Meriton+Suites+Southport", address: "Queen St, Southport",
    status: "QUALIFIED", is_condo: true, rooms: 208, adr: 115, adr_flag: "CHECK",
    chain: "Meriton", reno_signal: null, reno_source: null, review_note: null, rating: 4.5,
    score: 3, validated: false, notes: "ADR terbaca 115 dari satu sumber saja — perlu dicek.",
    import_id: "imp_scr01", created_at: "2026-08-18T09:00:00+08:00",
  },
  {
    id: "prp_04", ref: "TL-0004", market_code: "AU-QLD-GOLDCOAST-SPNORTH", name: "Paradise Island Resort",
    maps_url: null, address: "Stanhill Dr, Chevron Island",
    status: "QUALIFIED", is_condo: true, rooms: 120, adr: 64, adr_flag: "OK",
    chain: null, reno_signal: "Strata meeting membahas perbaikan interior",
    reno_source: "Notulen rapat strata, dari agen", review_note: null, rating: 3.9,
    score: 3, validated: true, notes: null, import_id: "imp_scr01",
    created_at: "2026-08-18T09:00:00+08:00",
  },
  {
    id: "prp_05", ref: "TL-0005", market_code: "AU-QLD-GOLDCOAST-SPNORTH", name: "Budds Beach Apartments",
    maps_url: null, address: "Stanhill Dr, Surfers Paradise",
    status: "QUALIFIED", is_condo: true, rooms: 48, adr: 58, adr_flag: "OK",
    chain: null, reno_signal: null, reno_source: null, review_note: null, rating: 3.6,
    score: 2, validated: true, notes: null, import_id: "imp_scr01",
    created_at: "2026-08-18T09:00:00+08:00",
  },
  {
    id: "prp_06", ref: "TL-0006", market_code: "AU-QLD-GOLDCOAST-SPMIDDLE", name: "Dorsett Gold Coast",
    maps_url: null, address: "Surfers Paradise Blvd",
    status: "DISQUALIFIED — NOT CONDO", is_condo: false, rooms: 313, adr: 119, adr_flag: "OK",
    chain: "Dorsett", reno_signal: null, reno_source: null, review_note: null, rating: 4.4,
    score: 0, validated: true, notes: "Satu pemilik, dikelola operator — tidak ada pemilik unit.",
    import_id: "imp_scr01", created_at: "2026-08-18T09:00:00+08:00",
  },
];

type A = [
  id: string, property: string, slot: number, name: string, agency: string | null,
  phone: string | null, stage: PropertyAgent["stage"], sent: string | null,
  replied: string | null, next: string | null, remark: string | null, rep: string | null,
];

const AGENTS: A[] = [
  ["pag_01", "prp_01", 1, "D. Harper", "Ray White Surfers", "+61 412 345 678", "REPLIED", "2026-09-01", "2026-09-03", null, "Minta kirim skema komisi tertulis.", null],
  ["pag_02", "prp_01", 2, "M. Chen", "Harcourts Coastal", "+61 423 456 789", "QUEUED", null, null, null, null, null],
  ["pag_03", "prp_01", 3, "S. Patel", "LJ Hooker", "+61 434 567 890", "QUEUED", null, null, null, null, null],

  ["pag_04", "prp_02", 1, "R. Novak", "Kollosche", "+61 498 765 432", "FORM BACK", "2026-08-26", "2026-08-28", "2026-09-15", "Formulir kembali, minta presentasi untuk strata.", "rep_01"],
  ["pag_05", "prp_02", 2, "L. Ortiz", "Ray White Broadbeach", "+61 487 654 321", "RECYCLED", "2026-08-26", null, null, "Tujuh hari tanpa balasan — dilepas.", null],
  /* Nine days of silence: past the move-on line, and the queue says so. */
  ["pag_06", "prp_02", 3, "K. Webb", "Professionals", "+61 476 543 210", "MSG SENT", "2026-09-02", null, "2026-09-09", null, null],

  ["pag_07", "prp_03", 1, "T. Reyes", "Meriton Property", "+61 411 112 222", "QUEUED", null, null, null, null, null],
  ["pag_08", "prp_03", 2, "A. Kim", "First National", "+61 433 334 444", "QUEUED", null, null, null, null, null],

  ["pag_09", "prp_04", 1, "B. Singh", "Coastal Realty", "+61 455 556 666", "CALL SET", "2026-09-04", "2026-09-06", "2026-09-12", "Telepon Sabtu pagi, minta ikut rapat strata.", null],
  ["pag_10", "prp_04", 2, "E. Moss", "Ray White Chevron", "+61 477 778 888", "QUEUED", null, null, null, null, null],

  /* Everybody approached, nobody agreed. */
  ["pag_11", "prp_05", 1, "J. Alvarez", "Harcourts Coastal", "+61 401 010 101", "RECYCLED", "2026-08-20", null, null, "Tidak tertarik skema komisi.", null],
  ["pag_12", "prp_05", 2, "P. Nguyen", "Ray White Surfers", "+61 402 020 202", "RECYCLED", "2026-08-28", null, null, "Tujuh hari tanpa balasan.", null],
  ["pag_13", "prp_05", 3, "C. Blake", "Independent", "+61 403 030 303", "SKIP", null, null, null, "Nomor tidak aktif.", null],
];

export const PROPERTY_AGENTS: PropertyAgent[] = AGENTS.map(
  ([id, property_id, slot, name, agency, phone, stage, sent_on, replied_on, next_action_on, remark, rep_id]) => ({
    id, property_id, slot, name, agency, phone,
    email: null, profile_url: null, suburb: null,
    stage, sent_on, replied_on, next_action_on, remark, rep_id,
    updated_at: "2026-09-09T10:00:00+08:00",
  }),
);

/** The agent who said yes. One, deliberately: the programme is new, and a demo
 *  with six onboarded reps would hide how much work reaching one is (D185). */
export const SALES_REPS: SalesRep[] = [
  {
    id: "rep_01", rep_no: "agn-26-09-02_01", name: "R. Novak", agency: "Kollosche",
    phone: "+61 498 765 432", email: "r.novak@kollosche.com.au", market_code: "AU-QLD-GOLDCOAST-SPMIDDLE",
    commission_percent: 4, onboarded_on: "2026-09-02", active: true,
    note: "Dari TL-0002 Mantra on View. Komisi 4% nilai kontrak, dibayar setelah termin pertama masuk.",
  },
];

export const REFERRALS: Referral[] = [
  {
    id: "ref_01", referral_no: "lead-26-09-04_01", rep_id: "rep_01",
    owner_name: "Mr. & Mrs. Whitfield", unit: "Unit 1204", property_ref: "TL-0002",
    phone: "+61 466 111 222", status: "WON",
    introduced_on: "2026-09-04",
    project_code: "25011", contract_value: 186_000_000,
    commission_trx_no: null,
    note: "Renovasi dapur dan ruang tamu. Masuk sebagai bagian proyek HOTEL UBUD? — perlu dicek, kode proyek sementara.",
    updated_at: "2026-09-09T11:00:00+08:00",
  },
  {
    id: "ref_02", referral_no: "lead-26-09-06_01", rep_id: "rep_01",
    owner_name: "Ms. Adeline Koh", unit: "Unit 806", property_ref: "TL-0002",
    phone: "+61 466 333 444", status: "QUOTED",
    introduced_on: "2026-09-06",
    project_code: null, contract_value: null, commission_trx_no: null,
    note: "Penawaran dikirim 9 September, menunggu jawaban.",
    updated_at: "2026-09-09T11:05:00+08:00",
  },
  {
    id: "ref_03", referral_no: "lead-26-09-08_01", rep_id: "rep_01",
    owner_name: "Mr. Tan", unit: "Unit 1507", property_ref: "TL-0002",
    phone: null, status: "LEAD",
    introduced_on: "2026-09-08",
    project_code: null, contract_value: null, commission_trx_no: null,
    note: null,
    updated_at: "2026-09-08T16:00:00+08:00",
  },
];

/** What the scrape found, and what the enrichment has been through. The gap
 *  between the two columns is the queue nobody could see (D183). */
export const SCRAPE_ROWS: ScrapeRow[] = [
  { id: "scr_01", market_code: "AU-QLD-GOLDCOAST-SPNORTH", name: "Chateau Beachside", maps_url: null, enriched: true, property_ref: "TL-0001", scraped_on: "2026-08-15" },
  { id: "scr_02", market_code: "AU-QLD-GOLDCOAST-SPNORTH", name: "Paradise Island Resort", maps_url: null, enriched: true, property_ref: "TL-0004", scraped_on: "2026-08-15" },
  { id: "scr_03", market_code: "AU-QLD-GOLDCOAST-SPNORTH", name: "Budds Beach Apartments", maps_url: null, enriched: true, property_ref: "TL-0005", scraped_on: "2026-08-15" },
  { id: "scr_04", market_code: "AU-QLD-GOLDCOAST-SPNORTH", name: "Chevron Renaissance", maps_url: null, enriched: false, property_ref: null, scraped_on: "2026-09-05" },
  { id: "scr_05", market_code: "AU-QLD-GOLDCOAST-SPNORTH", name: "Artique Surfers Paradise", maps_url: null, enriched: false, property_ref: null, scraped_on: "2026-09-05" },
  { id: "scr_06", market_code: "AU-QLD-GOLDCOAST-SPMIDDLE", name: "Mantra on View", maps_url: null, enriched: true, property_ref: "TL-0002", scraped_on: "2026-08-15" },
  { id: "scr_07", market_code: "AU-QLD-GOLDCOAST-SPMIDDLE", name: "Dorsett Gold Coast", maps_url: null, enriched: true, property_ref: "TL-0006", scraped_on: "2026-08-15" },
  { id: "scr_08", market_code: "AU-QLD-GOLDCOAST-SPMIDDLE", name: "Q1 Resort & Spa", maps_url: null, enriched: false, property_ref: null, scraped_on: "2026-09-05" },
  { id: "scr_09", market_code: "AU-QLD-GOLDCOAST-SPSOUTH", name: "Meriton Suites Southport", maps_url: null, enriched: true, property_ref: "TL-0003", scraped_on: "2026-08-15" },
  { id: "scr_10", market_code: "AU-QLD-GOLDCOAST-SPSOUTH", name: "Broadbeach Savannah", maps_url: null, enriched: false, property_ref: null, scraped_on: "2026-09-05" },
  { id: "scr_11", market_code: "AU-QLD-GOLDCOAST-SPSOUTH", name: "Phoenician Resort", maps_url: null, enriched: false, property_ref: null, scraped_on: "2026-09-05" },

  /* Two markets opened last week. Nothing enriched, nothing promoted — what a
     new country looks like on day one, and the reason the figures have to roll
     up by city and by country rather than by a flat list of districts. */
  { id: "scr_12", market_code: "AU-NSW-SYDNEY-BONDI", name: "Bondi Beachside Apartments", maps_url: null, enriched: false, property_ref: null, scraped_on: "2026-09-09" },
  { id: "scr_13", market_code: "AU-NSW-SYDNEY-BONDI", name: "Pacific Bondi Beach", maps_url: null, enriched: false, property_ref: null, scraped_on: "2026-09-09" },
  { id: "scr_14", market_code: "ID-BA-BADUNG-SEMINYAK", name: "The Seminyak Suite", maps_url: null, enriched: false, property_ref: null, scraped_on: "2026-09-10" },
  { id: "scr_15", market_code: "ID-BA-BADUNG-SEMINYAK", name: "Seminyak Icon Residences", maps_url: null, enriched: false, property_ref: null, scraped_on: "2026-09-10" },
  { id: "scr_16", market_code: "ID-BA-BADUNG-CANGGU", name: "Canggu Beachfront Villas", maps_url: null, enriched: false, property_ref: null, scraped_on: "2026-09-10" },
];
