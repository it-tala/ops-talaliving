import type {
  CashComponent, CashOverride, CashSettlement,
} from "@/services/accounting/contracts";

/** The recurring bill list, with when each one is due.
 *
 *  This is the part of the business that was never in a system: everybody
 *  knows payroll goes out on Friday and the electricity arrives around the
 *  24th, and that knowledge lives in one person's head and a chat reminder.
 *  Written down, it is a budget and a reminder at the same time (D109).
 *
 *  Three shapes, because the business has three (D113): what happens **every
 *  week**, what happens **every month**, and what is certain but happens
 *  **once** — settling a vendor in October, paying the card off in November
 *  rather than carrying it. The amounts are estimates and are meant to be
 *  wrong; showing actual beside them is what makes next month's better.
 */
export const CASH_COMPONENTS: CashComponent[] = [
  {
    id: "cmp_01", name: "Payroll", direction: "OUT", amount: 30_000_000,
    frequency: "weekly", due_day: 25, due_weekday: 5, due_date: null,
    type_code: "RECCURING - PAYROLL", vendor_id: null, account_id: "acc_bni325",
    scheme_codes: [], starts_on: "2026-01", ends_on: null,
    note: "Every Friday. Four runs in most months, five in some — and that is a real difference.",
    active: true, created_by: "usr_anggun", created_at: "2026-09-01T09:00:00+08:00",
  },
  {
    id: "cmp_02", name: "Workshop electricity", direction: "OUT", amount: 4_300_000,
    frequency: "monthly", due_day: 24, due_weekday: null, due_date: null,
    type_code: "RECCURING - UTILITIES", vendor_id: null, account_id: "acc_bni325",
    scheme_codes: [], starts_on: "2026-01", ends_on: null, note: null,
    active: true, created_by: "usr_anggun", created_at: "2026-09-01T09:02:00+08:00",
  },
  {
    id: "cmp_03", name: "Credit card — monthly bill", direction: "OUT", amount: 2_500_000,
    frequency: "monthly", due_day: 8, due_weekday: null, due_date: null,
    type_code: "CREDIT CARD", vendor_id: null, account_id: "acc_bni325",
    scheme_codes: [], starts_on: "2026-01", ends_on: null, note: "Mandiri, the previous month's spending.",
    active: true, created_by: "usr_anggun", created_at: "2026-09-01T09:04:00+08:00",
  },
  {
    id: "cmp_04", name: "Materials and hardware", direction: "OUT", amount: 45_000_000,
    frequency: "monthly", due_day: 15, due_weekday: null, due_date: null,
    type_code: "SUPPLIERS", vendor_id: null, account_id: "acc_bca271",
    scheme_codes: [], starts_on: "2026-01", ends_on: null,
    note: "What the workshop buys in an ordinary month, across all suppliers.",
    active: true, created_by: "usr_anggun", created_at: "2026-09-01T09:06:00+08:00",
  },
  {
    id: "cmp_05", name: "Office and warehouse", direction: "OUT", amount: 1_500_000,
    frequency: "monthly", due_day: 20, due_weekday: null, due_date: null,
    type_code: "OFFICE", vendor_id: null, account_id: "acc_petty",
    scheme_codes: [], starts_on: "2026-01", ends_on: null, note: null,
    active: true, created_by: "usr_anggun", created_at: "2026-09-01T09:08:00+08:00",
  },
  {
    id: "cmp_06", name: "Imported hardware — Guangzhou", direction: "OUT", amount: 8_400_000,
    frequency: "monthly", due_day: 5, due_weekday: null, due_date: null,
    type_code: "CHINA", vendor_id: null, account_id: "acc_bca271",
    scheme_codes: [], starts_on: "2026-09", ends_on: "2026-12",
    note: "Four instalments to the end of the year, then it stops.",
    active: true, created_by: "usr_anggun", created_at: "2026-09-05T09:00:00+08:00",
  },

  /* Certain, but only that once. Neither of these is a bill that repeats, and
     modelling them as one would put them in twelve months instead of one. */
  {
    id: "cmp_08", name: "HADI GLASS — settle po-26-07-25_01", direction: "OUT", amount: 12_680_000,
    frequency: "once", due_day: 15, due_weekday: null, due_date: "2026-10-15",
    type_code: "SUPPLIERS", vendor_id: "vnd_13", account_id: "acc_bca271",
    scheme_codes: [], starts_on: "2026-10", ends_on: "2026-10",
    note: "The balance of the July order, agreed for October.",
    active: true, created_by: "usr_anggun", created_at: "2026-09-09T10:00:00+08:00",
  },
  {
    id: "cmp_09", name: "Credit card — pay it off", direction: "OUT", amount: 26_000_000,
    frequency: "once", due_day: 20, due_weekday: null, due_date: "2026-11-20",
    type_code: "CREDIT CARD", vendor_id: null, account_id: "acc_bni325",
    scheme_codes: [], starts_on: "2026-11", ends_on: "2026-11",
    note: "Clearing the balance rather than carrying it. Separate from the monthly bill, and only in November.",
    active: true, created_by: "usr_anggun", created_at: "2026-09-09T10:04:00+08:00",
  },

  /* The only way money arrives. Everything above is paid out of it. */
  {
    id: "cmp_07", name: "Operating transfer from leadership", direction: "IN", amount: 150_000_000,
    frequency: "monthly", due_day: 3, due_weekday: null, due_date: null,
    type_code: "CASHFLOW", vendor_id: null, account_id: "acc_bca271",
    scheme_codes: [], starts_on: "2026-01", ends_on: null,
    note: "What has been going in each month. Change it and the year changes.",
    active: true, created_by: "usr_anggun", created_at: "2026-09-01T09:10:00+08:00",
  },
  {
    id: "cmp_10", name: "BPJS Kesehatan", direction: "OUT", amount: 1_450_000,
    frequency: "monthly", due_day: 10, due_weekday: null, due_date: null,
    /* Named vendor, so this line claims its own payment before the plain
       payroll category sweeps it up (D110's ordering). */
    type_code: "RECCURING - PAYROLL", vendor_id: "vnd_50", account_id: "acc_bni325",
    /* Tied to the scheme, so accounting can hold the invoice against the roll
       of names rather than against last month's number (D259). */
    scheme_codes: ["BPJS_KESEHATAN"], starts_on: "2026-01", ends_on: null,
    note: "Tagihan bulanan. Yang diharapkan dihitung dari daftar karyawan terdaftar × tarif, bukan dari angka bulan lalu.",
    active: true, created_by: "usr_anggun", created_at: "2026-09-01T09:00:00+08:00",
  },
  {
    id: "cmp_11", name: "BPJS Ketenagakerjaan", direction: "OUT", amount: 1_900_000,
    frequency: "monthly", due_day: 10, due_weekday: null, due_date: null,
    type_code: "RECCURING - PAYROLL", vendor_id: "vnd_51", account_id: "acc_bni325",
    /* JHT is the largest of the four TK schemes; the audit screen shows all
       four beside it, because one line pays for all of them. */
    scheme_codes: ["JHT", "JP", "JKK", "JKM"], starts_on: "2026-01", ends_on: null,
    note: "Satu tagihan untuk JHT, JP, JKK dan JKM.",
    active: true, created_by: "usr_anggun", created_at: "2026-09-01T09:00:00+08:00",
  },
];

/** A month that is not like the others. Typed once, not re-typed twelve times.
 *
 *  On a weekly line the figure is the **month's total**, and the difference
 *  lands on the last run: the THR is paid with one payday, not spread across
 *  four (D114). */
export const CASH_OVERRIDES: CashOverride[] = [
  {
    id: "cov_01", component_id: "cmp_01", month: "2026-12", amount: 160_000_000, due_day: null,
    reason: "THR — the last December run carries the holiday allowance.",
    recorded_by: "usr_anggun", recorded_at: "2026-09-01T09:12:00+08:00",
  },
  {
    id: "cov_02", component_id: "cmp_05", month: "2026-10", amount: null, due_day: null,
    reason: "Nothing planned — the stationery order was pulled forward into September.",
    recorded_by: "usr_anggun", recorded_at: "2026-09-01T09:14:00+08:00",
  },
];

/** Somebody pointing at a ledger row and saying: that one was this bill. */
export const CASH_SETTLEMENTS: CashSettlement[] = [
  {
    id: "cst_01", component_id: "cmp_03", month: "2026-09", trx_no: "trx-26-09-08_001",
    recorded_by: "usr_anggun", recorded_at: "2026-09-08T16:30:00+08:00",
  },
];
