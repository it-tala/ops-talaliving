/** *Masih aman berapa bulan* — the one-line answer (L10; kajian §6.9, D433
 *  Q95).
 *
 *  Burn is what the business spends on itself in an ordinary month: the
 *  average of the last three finished months of `payroll · fixed · overhead
 *  · bank · tax` (`BURN_CATEGORIES`). Not vendor — that follows projects;
 *  not transfer — that is our own money moving; not the household, which
 *  is reported apart (D435). Cash is the balance of the accounting accounts
 *  only (PETTY CASH, BNI 325, BCA 271, JAGO — Q95: leadership's 064 has no
 *  ledger of its own). Months = cash ÷ burn, stated twice: with no income
 *  at all, and with the last three months' average income arriving.
 *
 *  Computed from the ledger, never from the plan, so it moves by itself as
 *  categories and lines are corrected. Shared by the real and the sandbox
 *  API so both say the same thing from the same rows.
 */

import { BURN_CATEGORIES } from "./categories";
import type { AccountCustody, Category, CategoryMonthRow, Runway } from "./contracts";

/** The three months before the current one, oldest first. */
export function runwayMonths(today: string, count = 3): string[] {
  const [y, m] = today.slice(0, 7).split("-").map(Number);
  const out: string[] = [];
  for (let i = count; i >= 1; i -= 1) {
    const d = new Date(y, m - 1 - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

export function runwayFrom(input: {
  today: string;
  months: CategoryMonthRow[];
  balances: { code: string; custody: AccountCustody; balance: number; is_active?: boolean }[];
}): Runway {
  const months = runwayMonths(input.today);
  const inWindow = input.months.filter((r) => months.includes(r.month));
  const n = months.length;

  const burnBy: Runway["burn_by"] = BURN_CATEGORIES.map((category) => ({
    category,
    amount: Math.round(inWindow
      .filter((r) => r.direction === "OUT" && r.category === category)
      .reduce((s, r) => s + r.amount, 0) / n),
  })).filter((b) => b.amount > 0);
  const burn = burnBy.reduce((s, b) => s + b.amount, 0);
  const incomeAvg = Math.round(inWindow
    .filter((r) => r.direction === "IN" && r.category === "income")
    .reduce((s, r) => s + r.amount, 0) / n);

  const cashAccounts = input.balances
    .filter((a) => a.custody === "accounting" && a.is_active !== false)
    .map((a) => ({ code: a.code, balance: a.balance }));
  const cash = cashAccounts.reduce((s, a) => s + a.balance, 0);

  const round1 = (x: number) => Math.round(x * 10) / 10;
  const net = burn - incomeAvg;
  return {
    as_of: input.today,
    months_used: months,
    burn,
    burn_by: burnBy,
    income_avg: incomeAvg,
    cash,
    cash_accounts: cashAccounts,
    months_without_income: burn > 0 ? round1(cash / burn) : null,
    /* Income covering the burn means it never runs out on this reading;
       said as null, not as a number nobody should trust. */
    months_with_income: burn > 0 ? (net > 0 ? round1(cash / net) : null) : null,
  };
}

export const categoriesOfBurn = (): readonly Category[] => BURN_CATEGORIES;
