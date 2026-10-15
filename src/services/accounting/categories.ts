/** Categories: what a ledger row was for, as leadership reads it (L9;
 *  D433, D435; kajian §6.8, §10).
 *
 *  Ten of them, fixed in the database as `ops_acct.category_t` (`0274`).
 *  Every transaction type carries one; a row may carry its own
 *  (`category_override`), and the effective one is
 *  `coalesce(override, type.category)`. A `fee` line counts to `bank` and a
 *  `tax` line to `tax` whatever the row says — that split is the database's
 *  (`v_category_part`) and the demo's (`derive.categoryParts`) alike.
 */

import type { Category } from "./contracts";

export const CATEGORIES: readonly Category[] = [
  "transfer", "income", "vendor", "payroll", "fixed", "overhead", "bank", "tax", "ejo", "saripan",
];

/** Shown as the owner named them (D435): English, `EJO` in capitals. */
export const CATEGORY_LABELS: Record<Category, { en: string; id: string }> = {
  transfer: { en: "Transfer", id: "Transfer" },
  income:   { en: "Income", id: "Pemasukan" },
  vendor:   { en: "Vendor", id: "Vendor" },
  payroll:  { en: "Payroll", id: "Payroll" },
  fixed:    { en: "Fixed", id: "Tetap" },
  overhead: { en: "Overhead", id: "Overhead" },
  bank:     { en: "Bank", id: "Bank" },
  tax:      { en: "Tax", id: "Pajak" },
  ejo:      { en: "EJO", id: "EJO" },
  saripan:  { en: "Saripan", id: "Saripan" },
};

/** What each one holds, for the picker and the summary's legend. */
export const CATEGORY_NOTES: Record<Category, { en: string; id: string }> = {
  transfer: { en: "between our own accounts, cash withdrawals, USD conversion", id: "antar rekening sendiri, tarik tunai, konversi USD" },
  income:   { en: "money from clients, capital, refunds", id: "uang dari klien, modal, pengembalian" },
  vendor:   { en: "goods and services for production, projects and stock", id: "barang dan jasa untuk produksi, proyek, stok" },
  payroll:  { en: "wages, overtime, severance, BPJS", id: "gaji, lembur, pesangon, BPJS" },
  fixed:    { en: "rent, electricity, water, internet, subscriptions, monthly consultants", id: "sewa, listrik, air, internet, langganan, konsultan bulanan" },
  overhead: { en: "fuel, office and warehouse supplies, meals", id: "bensin, perlengkapan kantor dan gudang, makan" },
  bank:     { en: "admin fees, card interest", id: "biaya admin, bunga kartu" },
  tax:      { en: "payments to the state", id: "pembayaran pajak ke negara" },
  ejo:      { en: "the leadership household, reported apart", id: "pengeluaran pimpinan, dilaporkan terpisah" },
  saripan:  { en: "the Saripan house, reported apart", id: "rumah Saripan, dilaporkan terpisah" },
};

/** Money out that counts as the business's running cost (§6.9): not what
 *  moves between our accounts, not what buys for a project, not the
 *  household. */
export const BURN_CATEGORIES: readonly Category[] = ["payroll", "fixed", "overhead", "bank", "tax"];

export const isCategory = (s: string): s is Category => (CATEGORIES as readonly string[]).includes(s);

/** The one line under a funding's life: spent through in N days (and how far
 *  beyond), or how much is still unspent. Shared by both API layers so the
 *  real side and the sandbox read the same sentence. */
export function fundingHeadline(
  f: { amount: number; spent: number; consumed_on: string | null; days_lasted: number | null; is_open: boolean },
  tr: (en: string, id: string) => string,
  formatShort: (n: number) => string,
): string {
  if (f.consumed_on) {
    const beyond = f.spent > f.amount ? f.spent - f.amount : 0;
    return tr(
      `Spent through in ${f.days_lasted} day(s)${beyond ? `, and ${formatShort(beyond)} beyond it` : ""}`,
      `Habis terpakai dalam ${f.days_lasted} hari${beyond ? `, dan lebih ${formatShort(beyond)} darinya` : ""}`,
    );
  }
  const left = f.amount - f.spent;
  return f.is_open
    ? tr(`${formatShort(left)} of it still unspent`, `${formatShort(left)} darinya masih belum terpakai`)
    : tr(`${formatShort(left)} was still unspent when the next transfer arrived`, `${formatShort(left)} masih belum terpakai saat transfer berikutnya datang`);
}
