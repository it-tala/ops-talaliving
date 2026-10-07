/** Leadership's cashflow — one arithmetic, two API layers (`0239`, D392).
 *
 *  The owner's question: *kapan kita kehabisan dana, dan apakah kita
 *  underbudget atau aman.* The payment calendar (`/accounting/calendar`)
 *  answers it for the accounts accounting pays from, month by month, from the
 *  bills alone. The cashflow answers it for the **company**: every account,
 *  the money expected from clients as well as the bills, **week by week**, and
 *  with room to grow an estimate as the company grows.
 *
 *  The scheme is the owner's: start from this month's opening balance, add the
 *  projected cash in, take the projected cash out, and what is left is next
 *  month's opening balance. Weeks are cut inside the month (1–7, 8–14, 15–21,
 *  22–end), so that chain holds exactly.
 *
 *  **Nothing about a bill is computed here twice.** A monthly bill reaches the
 *  cashflow as the payment calendar already planned and matched it — its dates,
 *  its figure, its payments (D228). The cashflow only multiplies, replaces or
 *  hides it *for the projection*; the calendar accounting works from is never
 *  touched.
 *
 *  `src/lib/api/accounting.ts` and `src/demo/api/accounting.ts` both call
 *  `buildCashflow`; the database stores, validates and audits.
 */
import type {
  AccountCode, AccountCustody, CashFrequency, CashPlan, CashCellState, Cashflow, CashflowCell,
  CashflowCellState, CashflowLine, CashflowMonth, CashflowOpening, CashflowReceipt, CashflowRow,
  CashflowSettings, CashflowSource, CashflowVerdict, CashflowWeek, CashflowWeekOverride, Direction,
} from "./contracts";
import { SUBSCRIPTION_LINE_PREFIX } from "./subscriptions";

export const CASHFLOW_MONTHS = 12;
export const DEFAULT_CASHFLOW_SETTINGS: CashflowSettings = { min_balance: 0, transfer_types: ["CASHFLOW"] };

/** A ledger row as the cashflow reads it: every account, not void. */
export interface CashflowLedgerRow {
  trx_no: string;
  trx_date: string;
  direction: Direction;
  amount_idr: number;
  type_code: string;
  vendor_id: string | null;
  project_id: string | null;
}

export interface CashflowInput {
  today: string;
  /** `YYYY-MM` — where the walk starts. */
  fromMonth: string;
  /** The payment calendar over the same twelve months (`cash_plan(p_from)`),
   *  subscriptions laid on. */
  plan: Pick<CashPlan, "rows" | "undated_obligations">;
  lines: CashflowLine[];
  overrides: CashflowWeekOverride[];
  receipts: CashflowReceipt[];
  openings: CashflowOpening[];
  settings: CashflowSettings;
  ledger: CashflowLedgerRow[];
  /** Each account's balance at the start of `fromMonth`, from the ledger. */
  openingAccounts: { code: AccountCode; custody: AccountCustody; currency: string; balance: number }[];
  vendorName: (id: string | null) => string | null;
  projectCode: (id: string | null) => string | null;
  accountCode: (id: string | null) => AccountCode | null;
}

/* ── dates ─────────────────────────────────────────────────────────────── */

const pad = (n: number) => String(n).padStart(2, "0");
export const monthIndex = (ym: string): number => Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1;
const monthOf = (i: number): string => `${Math.floor(i / 12)}-${pad((i % 12) + 1)}`;
export const addMonths = (ym: string, n: number): string => monthOf(monthIndex(ym) + n);
const daysIn = (ym: string): number => new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0).getDate();

/** The four weeks of a month: 1–7, 8–14, 15–21, 22 to the end. */
export function weeksOf(ym: string): { start: string; end: string; n: number }[] {
  const last = daysIn(ym);
  return [[1, 7], [8, 14], [15, 21], [22, last]].map(([a, b], i) => ({
    start: `${ym}-${pad(a)}`, end: `${ym}-${pad(b)}`, n: i + 1,
  }));
}

/** Which of a month's four weeks a date falls in, 0-based. */
const blockOf = (date: string): number => Math.min(3, Math.floor((Number(date.slice(8, 10)) - 1) / 7));

/** Every date a line falls due in a month — the same three shapes as the
 *  calendar (D113): a monthly day clamped to the month, every matching
 *  weekday, or the one date of a one-off. */
export function occurrences(
  line: Pick<CashflowLine, "frequency" | "due_day" | "due_weekday" | "due_date" | "starts_on" | "ends_on">,
  ym: string,
): string[] {
  const f: CashFrequency | null = line.frequency;
  if (f === "once") return line.due_date && line.due_date.slice(0, 7) === ym ? [line.due_date] : [];
  if (line.starts_on && ym < line.starts_on) return [];
  if (line.ends_on && ym > line.ends_on) return [];
  if (f === "monthly") {
    const day = Math.min(Math.max(line.due_day ?? 1, 1), daysIn(ym));
    return [`${ym}-${pad(day)}`];
  }
  if (f === "weekly") {
    const wd = line.due_weekday ?? 5;
    const out: string[] = [];
    for (let d = 1; d <= daysIn(ym); d++) {
      const date = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1, d);
      if (date.getDay() === wd) out.push(`${ym}-${pad(d)}`);
    }
    return out;
  }
  return [];
}

/** `(1 + g)^months` from the month growth starts — 5% a month is 5% more
 *  each month than the one before, not 5% of the first month added each time. */
export function growthFactor(line: Pick<CashflowLine, "growth_pct" | "growth_from" | "starts_on">, ym: string, fallbackFrom: string): number {
  const g = Number(line.growth_pct ?? 0) / 100;
  if (!g) return 1;
  const from = line.growth_from ?? line.starts_on ?? fallbackFrom;
  const n = monthIndex(ym) - monthIndex(from);
  return n > 0 ? Math.pow(1 + g, n) : 1;
}

/* ── states ────────────────────────────────────────────────────────────── */

/** Worst first: one overdue payday makes the week overdue. */
const STATE_RANK: Record<CashflowCellState, number> = {
  OVERDUE: 6, PARTIAL: 5, DUE: 4, PLANNED: 3, PAID: 2, SKIPPED: 1, NONE: 0,
};
const worst = (a: CashflowCellState, b: CashflowCellState) => (STATE_RANK[a] >= STATE_RANK[b] ? a : b);

function readState(cell: CashflowCell, week: { start: string; end: string }, today: string): CashflowCellState {
  if (cell.planned <= 0) return cell.actual > 0 ? "PAID" : "NONE";
  if (cell.actual >= cell.planned) return "PAID";
  if (week.end < today) return cell.actual > 0 ? "PARTIAL" : "OVERDUE";
  if (week.start > today) return "PLANNED";
  if (cell.actual > 0) return "PARTIAL";
  return cell.dates.some((d) => d < today) ? "OVERDUE" : "DUE";
}

const fromCalendar = (s: CashCellState): CashflowCellState => s;

/** What a cell puts into the balance walk for a week that is not over: a
 *  settled one what it came to, anything else whichever is larger of the plan
 *  and what has already moved. */
const usedOf = (c: CashflowCell) => (c.state === "PAID" ? c.actual : Math.max(c.planned, c.actual));

const round = (n: number) => Math.round(n);

/* ── the build ─────────────────────────────────────────────────────────── */

export function buildCashflow(input: CashflowInput): Cashflow {
  const { today, fromMonth, plan, settings } = input;
  const months = Array.from({ length: CASHFLOW_MONTHS }, (_, i) => addMonths(fromMonth, i));
  const firstDay = `${fromMonth}-01`;
  const lastDay = `${months[months.length - 1]}-${pad(daysIn(months[months.length - 1]))}`;
  const weekSpans = months.flatMap((m) => weeksOf(m).map((w) => ({ ...w, month: m })));
  const weekAt = (date: string): number => {
    if (date < firstDay || date > lastDay) return -1;
    return (monthIndex(date.slice(0, 7)) - monthIndex(fromMonth)) * 4 + blockOf(date);
  };
  const emptyCells = (): CashflowCell[] => weekSpans.map((w) => ({
    week_start: w.start, planned: 0, actual: 0, state: "NONE", dates: [], overridden: false, reason: null, trx_nos: [],
  }));

  const overridesOf = new Map<string, Map<string, CashflowWeekOverride>>();
  for (const o of input.overrides) {
    if (!overridesOf.has(o.line_id)) overridesOf.set(o.line_id, new Map());
    overridesOf.get(o.line_id)!.set(o.week_start, o);
  }
  const claimed = new Set<string>();
  const rows: CashflowRow[] = [];
  const hidden: Cashflow["hidden"] = [];

  /* 1. Monthly bills, as the calendar planned and matched them. The calendar's
        money-in lines are leadership's transfers into accounting's accounts —
        money moving inside the company — so the company's cashflow leaves
        them out. */
  for (const r of plan.rows) {
    if (r.component.direction !== "OUT") continue;
    const isSub = r.component.id.startsWith(SUBSCRIPTION_LINE_PREFIX);
    const key = isSub ? r.component.id : `component:${r.component.id}`;
    const source: CashflowSource = isSub ? "subscription" : "calendar";
    const stored = input.lines.find((l) => l.source_ref === key && l.active);
    for (const c of r.cells) for (const e of c.events) e.trx_nos.forEach((n) => claimed.add(n));
    if (stored?.hidden) {
      hidden.push({ key, line_id: stored.id, name: r.component.name, source });
      continue;
    }
    /* The calendar's name, always: a bill renamed there is renamed here. */
    const line: CashflowLine = stored ? { ...stored, name: r.component.name } : {
      id: "", source_ref: key, name: r.component.name, direction: "OUT",
      category: isSub ? "subscription" : guessCategory(r.component.type_code),
      frequency: null, amount: null, due_day: null, due_weekday: null, due_date: null,
      starts_on: null, ends_on: null, growth_pct: 0, growth_from: null,
      type_code: null, vendor_id: null, project_id: null, hidden: false, note: null,
      active: true, created_by: "", created_at: "",
    };
    const cells = emptyCells();
    for (const c of r.cells) {
      for (const e of c.events) {
        if (e.state === "SKIPPED") continue;
        const i = weekAt(e.date);
        if (i < 0) continue;
        /* A month the calendar itself changed (December's THR) keeps that
           figure — it is a fact about the month, not an estimate to grow. */
        const base = e.carries_override || line.amount === null ? e.planned : line.amount;
        const cell = cells[i];
        cell.planned += round(base * growthFactor(line, e.month, fromMonth));
        cell.actual += e.actual;
        cell.dates.push(e.date);
        cell.trx_nos.push(...e.trx_nos);
        cell.state = worst(cell.state, fromCalendar(e.state));
      }
    }
    applyOverrides(cells, line.id ? overridesOf.get(line.id) : undefined, weekSpans, today, false);
    rows.push(rowOf(line, key, source, cells, {
      base: r.component.amount, frequency: r.component.frequency, due_day: r.component.due_day,
      due_weekday: r.component.due_weekday, due_date: r.component.due_date,
      account_code: r.account_code, vendor_name: r.vendor_name, project_code: null,
    }, today));
  }

  /* 2. The cashflow's own lines: a client's termin, tax, an instalment. */
  const own = input.lines.filter((l) => l.source_ref === null && l.active);
  const ownCells = new Map<string, CashflowCell[]>();
  for (const l of own) {
    const cells = emptyCells();
    for (const m of months) {
      for (const d of occurrences(l, m)) {
        const i = weekAt(d);
        if (i < 0) continue;
        cells[i].planned += round((l.amount ?? 0) * growthFactor(l, m, fromMonth));
        cells[i].dates.push(d);
      }
    }
    for (const rc of input.receipts.filter((x) => x.line_id === l.id)) {
      const i = weekAt(rc.on_date);
      if (rc.trx_no) claimed.add(rc.trx_no);
      if (i < 0) continue;
      cells[i].actual += rc.amount;
      if (rc.trx_no) cells[i].trx_nos.push(rc.trx_no);
    }
    ownCells.set(l.id, cells);
  }

  /* 3. The ledger, every account. Money moving between the company's own
        accounts is neither in nor out. A line naming a project and a vendor
        claims first, then one naming either, then a bare category — so a
        specific line takes its own payment before a broad one sweeps it. */
  const transfers = new Set(settings.transfer_types);
  const ledger = input.ledger.filter((t) => !transfers.has(t.type_code) && t.trx_date >= firstDay && t.trx_date <= lastDay);
  const specificity = (l: CashflowLine) => (l.project_id ? 2 : 0) + (l.vendor_id ? 1 : 0);
  for (const l of [...own].filter((x) => x.type_code).sort((a, b) => specificity(b) - specificity(a))) {
    const cells = ownCells.get(l.id)!;
    for (const t of ledger) {
      if (claimed.has(t.trx_no) || t.direction !== l.direction || t.type_code !== l.type_code) continue;
      if (l.vendor_id && t.vendor_id !== l.vendor_id) continue;
      if (l.project_id && t.project_id !== l.project_id) continue;
      const i = weekAt(t.trx_date);
      if (i < 0) continue;
      claimed.add(t.trx_no);
      cells[i].actual += t.amount_idr;
      cells[i].trx_nos.push(t.trx_no);
    }
  }
  for (const l of own) {
    const cells = ownCells.get(l.id)!;
    applyOverrides(cells, overridesOf.get(l.id), weekSpans, today, true);
    rows.push(rowOf(l, l.id, "own", cells, {
      base: l.amount, frequency: l.frequency, due_day: l.due_day, due_weekday: l.due_weekday,
      due_date: l.due_date, account_code: null, vendor_name: input.vendorName(l.vendor_id),
      project_code: input.projectCode(l.project_id),
    }, today));
  }

  /* 4. What no line claimed: actual money the plan did not see coming. */
  const unplanned_in = weekSpans.map(() => ({ amount: 0, trx_nos: [] as string[] }));
  const unplanned_out = weekSpans.map(() => ({ amount: 0, trx_nos: [] as string[], byType: new Map<string, number>() }));
  for (const t of ledger) {
    if (claimed.has(t.trx_no)) continue;
    const i = weekAt(t.trx_date);
    if (i < 0) continue;
    if (t.direction === "IN") {
      unplanned_in[i].amount += t.amount_idr;
      unplanned_in[i].trx_nos.push(t.trx_no);
    } else {
      unplanned_out[i].amount += t.amount_idr;
      unplanned_out[i].trx_nos.push(t.trx_no);
      unplanned_out[i].byType.set(t.type_code, (unplanned_out[i].byType.get(t.type_code) ?? 0) + t.amount_idr);
    }
  }

  /* 5. The walk. */
  const ledgerOpening = input.openingAccounts.reduce((s, a) => s + a.balance, 0);
  const typed = input.openings.find((o) => o.month === fromMonth) ?? null;
  const openingUsed = typed ? typed.amount : ledgerOpening;
  const curIdx = weekSpans.findIndex((w) => w.start <= today && today <= w.end);
  const inRows = rows.filter((r) => r.line.direction === "IN");
  const outRows = rows.filter((r) => r.line.direction === "OUT");

  /* Owed from weeks already over and not paid: still owed, so it lands on
     the current week. Money expected in and not received is *not* carried:
     a balance that assumes it will still arrive is the optimistic one. */
  const behind = (list: CashflowRow[]) => curIdx < 0 ? 0 : list.reduce((s, r) =>
    s + r.cells.slice(0, curIdx).reduce((t, c) =>
      t + (c.state === "OVERDUE" || c.state === "PARTIAL" ? Math.max(c.planned - c.actual, 0) : 0), 0), 0);
  const carried_out = behind(outRows);
  const missed_in = behind(inRows);

  let balance = openingUsed;
  let plannedBalance = openingUsed;
  const weeks: CashflowWeek[] = weekSpans.map((w, i) => {
    const sum = (list: CashflowRow[], f: (c: CashflowCell) => number) => list.reduce((s, r) => s + f(r.cells[i]), 0);
    const in_planned = sum(inRows, (c) => c.planned);
    const out_planned = sum(outRows, (c) => c.planned);
    const in_unplanned = unplanned_in[i].amount;
    const out_unplanned = unplanned_out[i].amount;
    const in_actual = sum(inRows, (c) => c.actual) + in_unplanned;
    const out_actual = sum(outRows, (c) => c.actual) + out_unplanned;
    const is_past = w.end < today;
    const is_current = i === curIdx;
    const carried = is_current ? carried_out : 0;
    const in_used = is_past ? in_actual : is_current ? sum(inRows, usedOf) + in_unplanned : in_planned;
    const out_used = is_past ? out_actual : is_current ? sum(outRows, usedOf) + out_unplanned + carried : out_planned;
    const opening = balance;
    balance = opening + in_used - out_used;
    const plannedOpening = plannedBalance;
    plannedBalance = plannedOpening + in_planned - out_planned;
    return {
      start: w.start, end: w.end, month: w.month, n: w.n, is_past, is_current,
      in_planned, in_actual, out_planned, out_actual, in_unplanned, out_unplanned,
      carried_out: carried, in_used, out_used, opening, closing: balance, planned_closing: plannedBalance,
    };
  });

  const monthViews: CashflowMonth[] = months.map((m) => {
    const ws = weeks.filter((w) => w.month === m);
    const s = (f: (w: CashflowWeek) => number) => ws.reduce((t, w) => t + f(w), 0);
    return {
      month: m,
      is_past: ws[ws.length - 1].is_past,
      is_current: today.slice(0, 7) === m,
      opening: ws[0].opening,
      in_planned: s((w) => w.in_planned), in_actual: s((w) => w.in_actual),
      out_planned: s((w) => w.out_planned), out_actual: s((w) => w.out_actual),
      in_used: s((w) => w.in_used), out_used: s((w) => w.out_used),
      closing: ws[ws.length - 1].closing,
      planned_closing: ws[ws.length - 1].planned_closing,
      low_point: Math.min(...ws.map((w) => w.closing)),
    };
  });

  /* 6. The verdict, read from the current week on: the past cannot run out. */
  const ahead = weeks.map((w, i) => ({ w, i })).filter(({ w }) => !w.is_past);
  const out = ahead.find(({ w }) => w.closing < 0);
  const thin = ahead.find(({ w }) => w.closing < settings.min_balance);
  const low = ahead.reduce<{ w: CashflowWeek; i: number } | null>((a, b) => (!a || b.w.closing < a.w.closing ? b : a), null);
  const start = curIdx < 0 ? (ahead[0]?.i ?? 0) : curIdx;
  const verdict: CashflowVerdict = {
    state: out ? "short" : thin ? "thin" : "safe",
    runs_out_week: out?.w.start ?? null,
    short_by: out ? -out.w.closing : 0,
    thin_week: thin?.w.start ?? null,
    lowest: low ? low.w.closing : balance,
    lowest_week: low?.w.start ?? null,
    runway_weeks: out ? out.i - start : null,
    missed_in, carried_out,
  };

  /* 7. This month so far — under or over budget. */
  const curMonth = today.slice(0, 7);
  const soFar = weeks.filter((w) => w.month === curMonth && w.start <= today);
  const t = (f: (w: CashflowWeek) => number) => soFar.reduce((s, w) => s + f(w), 0);

  const order = (r: CashflowRow) => r.next_due ?? "9999";
  const byCategory = (a: CashflowRow, b: CashflowRow) =>
    a.line.category.localeCompare(b.line.category) || order(a).localeCompare(order(b)) || a.line.name.localeCompare(b.line.name);

  return {
    generated_for: today,
    from_month: fromMonth,
    opening: { month: fromMonth, ledger: ledgerOpening, accounts: input.openingAccounts, typed, used: openingUsed },
    settings,
    months: monthViews,
    weeks,
    in_rows: inRows.sort(byCategory),
    out_rows: outRows.sort(byCategory),
    hidden,
    receipts: input.receipts.filter((r) => own.some((l) => l.id === r.line_id))
      .sort((a, b) => b.on_date.localeCompare(a.on_date)),
    unplanned_in,
    unplanned_out: unplanned_out.map((u) => ({
      amount: u.amount, trx_nos: u.trx_nos,
      top_types: [...u.byType.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([type_code, amount]) => ({ type_code, amount })),
    })),
    verdict,
    budget: {
      month: curMonth,
      in_planned: t((w) => w.in_planned), in_actual: t((w) => w.in_actual),
      out_planned: t((w) => w.out_planned), out_actual: t((w) => w.out_actual),
    },
    undated_obligations: plan.undated_obligations,
  };
}

/** A week override replaces that week's total for the line; null leaves it
 *  out. Own lines read their state from the dates; a bill keeps the
 *  calendar's state unless the week was changed. */
function applyOverrides(
  cells: CashflowCell[], overrides: Map<string, CashflowWeekOverride> | undefined,
  weeks: { start: string; end: string }[], today: string, own: boolean,
) {
  cells.forEach((cell, i) => {
    const o = overrides?.get(cell.week_start);
    if (o) {
      cell.overridden = true;
      cell.reason = o.reason;
      if (o.amount === null) {
        cell.planned = 0;
        cell.state = cell.actual > 0 ? "PAID" : "SKIPPED";
        return;
      }
      cell.planned = o.amount;
    }
    if (own || o || cell.state === "NONE") cell.state = readState(cell, weeks[i], today);
  });
}

function rowOf(
  line: CashflowLine, key: string, source: CashflowSource, cells: CashflowCell[],
  meta: {
    base: number | null; frequency: CashFrequency | null; due_day: number | null; due_weekday: number | null;
    due_date: string | null; account_code: AccountCode | null; vendor_name: string | null; project_code: string | null;
  },
  today: string,
): CashflowRow {
  const next = cells.flatMap((c) => c.dates).filter((d) => d >= today).sort()[0] ?? null;
  return {
    line, key, source, base_amount: meta.base, frequency: meta.frequency,
    due_day: meta.due_day, due_weekday: meta.due_weekday, due_date: meta.due_date,
    account_code: meta.account_code, vendor_name: meta.vendor_name, project_code: meta.project_code,
    cells,
    planned_total: cells.reduce((s, c) => s + c.planned, 0),
    actual_total: cells.reduce((s, c) => s + c.actual, 0),
    next_due: next,
  };
}

/** Where an unadjusted calendar bill sits until leadership says otherwise. */
export function guessCategory(typeCode: string | null): CashflowLine["category"] {
  const t = (typeCode ?? "").toUpperCase();
  if (t.includes("PAYROLL") || t.includes("OVERTIME")) return "payroll";
  if (t.includes("CREDIT CARD")) return "loan";
  if (t === "SUPPLIERS" || t === "PREPAID VENDOR" || t === "CHINA" || t === "PRODUCTION") return "vendor";
  return "bills";
}

/** The balance every account held at the start of a day, from the ledger:
 *  the account's opening balance and everything before that day. */
export function balancesAt(
  accounts: { id: string; code: AccountCode; custody: AccountCustody; currency: string; opening_balance: number; is_active: boolean }[],
  ledger: (CashflowLedgerRow & { account_id: string })[],
  day: string,
) {
  return accounts.filter((a) => a.is_active).map((a) => ({
    code: a.code, custody: a.custody, currency: a.currency,
    balance: ledger
      .filter((t) => t.account_id === a.id && t.trx_date < day)
      .reduce((s, t) => s + (t.direction === "IN" ? t.amount_idr : -t.amount_idr), Number(a.opening_balance)),
  }));
}
