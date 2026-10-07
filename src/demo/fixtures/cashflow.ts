import type {
  CashflowLine, CashflowOpening, CashflowReceipt, CashflowSettings, CashflowWeekOverride,
} from "@/services/accounting/contracts";

/** Leadership's cashflow (`0239`, D392) — sample data for the sandbox.
 *
 *  The payment calendar already holds the bills; what it has never held is the
 *  money the company **expects to receive** — a client's termin, a pelunasan,
 *  the DP from projects still being sold. Those are the cashflow's own lines.
 *  Two calendar bills carry a cashflow change: payroll grows as the workshop
 *  hires, and the electricity grows with it — the calendar's figure is left
 *  as it is for accounting.
 */
const base = {
  source_ref: null, frequency: null, amount: null, due_day: null, due_weekday: null, due_date: null,
  starts_on: null, ends_on: null, growth_pct: 0, growth_from: null,
  type_code: null, vendor_id: null, project_id: null, hidden: false, note: null, active: true,
  created_by: "usr_evin", created_at: "2026-10-07T09:00:00+07:00",
} satisfies Partial<CashflowLine>;

export const CASHFLOW_LINES: CashflowLine[] = [
  /* ── cash in ── */
  { ...base, id: "cfl_01", name: "Termin 2 — Hotel Ubud (40%)", direction: "IN", category: "client",
    frequency: "once", amount: 402_720_000, due_date: "2026-10-20", project_id: "prj_25011",
    note: "40% saat barang tiba di lokasi." },
  { ...base, id: "cfl_02", name: "Pelunasan — Villa Seminyak", direction: "IN", category: "client",
    frequency: "once", amount: 64_260_000, due_date: "2026-10-30", project_id: "prj_25009",
    note: "30% setelah BAST." },
  { ...base, id: "cfl_03", name: "Pelunasan — Hotel Ubud (30%)", direction: "IN", category: "client",
    frequency: "once", amount: 302_040_000, due_date: "2026-12-18", project_id: "prj_25011" },
  { ...base, id: "cfl_04", name: "DP proyek baru (perkiraan penjualan)", direction: "IN", category: "client",
    frequency: "monthly", amount: 150_000_000, due_day: 12, starts_on: "2026-11",
    growth_pct: 5, growth_from: "2026-11",
    note: "Rata-rata DP 50% dari satu proyek baru per bulan; tumbuh 5% per bulan." },
  { ...base, id: "cfl_05", name: "Penjualan showroom", direction: "IN", category: "other_in",
    frequency: "weekly", amount: 6_000_000, due_weekday: 6, starts_on: "2026-10",
    growth_pct: 3, growth_from: "2026-10" },
  { ...base, id: "cfl_06", name: "Termin 1 — Villa Umalas (DP 50%)", direction: "IN", category: "client",
    frequency: "once", amount: 210_000_000, due_date: "2027-01-15", project_id: "prj_26001",
    note: "Masih INQUIRY — kalau tidak jadi, hapus baris ini." },

  /* ── cash out ── */
  { ...base, id: "cfl_10", name: "PPh 21 & PPN", direction: "OUT", category: "tax",
    frequency: "monthly", amount: 14_500_000, due_day: 15, starts_on: "2026-10" },
  { ...base, id: "cfl_11", name: "Cicilan mesin CNC", direction: "OUT", category: "loan",
    frequency: "monthly", amount: 9_750_000, due_day: 25, starts_on: "2026-10", ends_on: "2027-06" },
  { ...base, id: "cfl_12", name: "Material Hotel Ubud (pelunasan PO)", direction: "OUT", category: "vendor",
    frequency: "once", amount: 185_000_000, due_date: "2026-10-23", project_id: "prj_25011",
    type_code: "SUPPLIERS" },
  { ...base, id: "cfl_13", name: "THR & bonus akhir tahun", direction: "OUT", category: "payroll",
    frequency: "once", amount: 120_000_000, due_date: "2026-12-19" },

  /* ── the cashflow's change to two calendar bills ── */
  { ...base, id: "cfl_20", source_ref: "component:cmp_01", name: "Payroll", direction: "OUT", category: "payroll",
    growth_pct: 2, growth_from: "2026-11", note: "Dua tukang baru per bulan mulai November." },
  { ...base, id: "cfl_21", source_ref: "component:cmp_02", name: "Workshop electricity", direction: "OUT", category: "bills",
    amount: 4_800_000, growth_pct: 1, growth_from: "2026-11", note: "Mesin CNC menambah beban listrik." },
];

export const CASHFLOW_OVERRIDES: CashflowWeekOverride[] = [
  { id: "cfo_01", line_id: "cfl_05", week_start: "2026-12-22", amount: 15_000_000,
    reason: "Musim liburan — penjualan showroom biasanya naik.", recorded_by: "usr_evin", recorded_at: "2026-10-07T09:10:00+07:00" },
];

export const CASHFLOW_RECEIPTS: CashflowReceipt[] = [
  { id: "cfr_01", line_id: "cfl_05", on_date: "2026-10-03", amount: 4_250_000, trx_no: null,
    note: "Dua kursi display, tunai.", recorded_by: "usr_evin", recorded_at: "2026-10-03T16:00:00+07:00" },
];

export const CASHFLOW_OPENINGS: CashflowOpening[] = [];

export const CASHFLOW_SETTINGS: CashflowSettings = { min_balance: 150_000_000, transfer_types: ["CASHFLOW"] };
