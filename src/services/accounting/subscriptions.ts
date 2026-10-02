/** Subscriptions on the payment calendar — one arithmetic, two API layers.
 *
 *  The register (`ops_acct.subscriptions`, `0208`) stores what somebody typed
 *  and the payments somebody recorded. **Where a subscription falls on the
 *  months, what it costs in rupiah and whether the money lasts are decided
 *  here**, and `src/lib/api/accounting.ts` and `src/demo/api/accounting.ts`
 *  both call it. Two implementations of the same schedule is how the calendar
 *  and the register would disagree within a month (D228).
 *
 *  A subscription reaches the calendar as a **row of its own** beside the
 *  components: it has no ledger match to make, because it is settled by the
 *  payment recorded on it, and it never posts a transaction (D112). Because it
 *  is a row in the same plan, every screen built on the plan — the month
 *  opened day by day, "due next", Monthly bills — shows it without knowing it
 *  is different.
 *
 *  Dollar subscriptions are converted at **one rate the plan uses** (19.000,
 *  editable by leadership). Once a billing is paid the rupiah that actually
 *  left replaces the estimate, and the rate it really went at is shown beside
 *  it — so a rate that moved is a visible difference, not a silent one.
 */
import { trNow } from "@/lib/i18n";
import type {
  AccountCode, CashCell, CashEvent, CashMonth, CashRow, CashCellState, CashComponent, CashUnplanned,
  Subscription, SubscriptionPayment, SubscriptionRegister, SubscriptionView,
} from "./contracts";

const STEP: Record<Subscription["cycle"], number> = { monthly: 1, yearly: 12, biennial: 24 };
/** Billings in a year, for the per-year figure that makes a yearly and a
 *  monthly subscription comparable. */
const PER_YEAR: Record<Subscription["cycle"], number> = { monthly: 12, yearly: 1, biennial: 0.5 };

export const SUBSCRIPTION_LINE_PREFIX = "sub:";

/** A calendar row id made for a subscription (never a component's uuid). */
export const isSubscriptionLine = (componentId: string): boolean =>
  componentId.startsWith(SUBSCRIPTION_LINE_PREFIX);

const monthIndex = (ym: string): number => Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1;

function daysIn(ym: string): number {
  return new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0).getDate();
}

/** The 31st in February is the 28th, rather than a date that does not exist. */
function dueDateIn(sub: Subscription, ym: string): string {
  const day = Math.min(Number(sub.start_on.slice(8, 10)), daysIn(ym));
  return `${ym}-${String(day).padStart(2, "0")}`;
}

/** Does it fall due in this month? Monthly every month from the start;
 *  yearly every twelfth; every two years every twenty-fourth. */
export function occursIn(sub: Subscription, ym: string): boolean {
  const diff = monthIndex(ym) - monthIndex(sub.start_on.slice(0, 7));
  if (diff < 0 || diff % STEP[sub.cycle] !== 0) return false;
  return sub.ends_on === null || dueDateIn(sub, ym) <= sub.ends_on;
}

/** One billing in rupiah **at the plan rate**. A rupiah subscription is itself. */
export function plannedIdr(sub: Pick<Subscription, "currency" | "amount">, usdIdr: number): number {
  return Math.round(sub.currency === "USD" ? sub.amount * usdIdr : sub.amount);
}

const usd = (n: number): string => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const rate = (n: number): string => Math.round(n).toLocaleString("id-ID");

function reasonFor(sub: Subscription, usdIdr: number, pay: SubscriptionPayment | undefined): string {
  const kind = sub.amount_kind === "payg" ? trNow("pay as you go", "sesuai pemakaian") : null;
  if (pay) {
    if (pay.trx_no) return trNow(`Settled by ledger row ${pay.trx_no}`, `Dilunasi baris ledger ${pay.trx_no}`);
    if (pay.amount_usd != null && pay.fx_rate != null) {
      return trNow(
        `${usd(pay.amount_usd)} charged at Rp ${rate(pay.fx_rate)} (plan Rp ${rate(usdIdr)})`,
        `${usd(pay.amount_usd)} ditagih kurs Rp ${rate(pay.fx_rate)} (rencana Rp ${rate(usdIdr)})`);
    }
    return trNow("Paid", "Sudah dibayar");
  }
  if (sub.currency === "USD") {
    return [`${usd(sub.amount)} × Rp ${rate(usdIdr)}`, kind].filter(Boolean).join(" · ");
  }
  return kind ?? "";
}

function stateOf(paid: boolean, date: string, today: string): CashCellState {
  if (paid) return "PAID";
  if (date < today) return "OVERDUE";
  const days = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  return days <= 7 ? "DUE" : "PLANNED";
}

/** The calendar rows for the subscriptions, one per subscription, twelve cells
 *  each. Cancelled and paused ones plan nothing — but a month that already has
 *  a payment still shows it, because it happened. */
export function subscriptionRows(input: {
  subscriptions: Subscription[];
  payments: SubscriptionPayment[];
  usd_idr: number;
  months: string[];
  today: string;
  accountCodeOf: (id: string | null) => AccountCode | null;
}): CashRow[] {
  const { subscriptions, payments, usd_idr, months, today, accountCodeOf } = input;
  const paidBy = new Map(payments.map((p) => [`${p.subscription_id}|${p.period}`, p]));

  return subscriptions.map((sub) => {
    const planned = plannedIdr(sub, usd_idr);
    const lineId = `${SUBSCRIPTION_LINE_PREFIX}${sub.id}`;
    const account_code = accountCodeOf(sub.account_id);
    const kind = sub.amount_kind === "payg" ? "estimate" as const : "fixed" as const;

    const component: CashComponent = {
      id: lineId,
      name: sub.name,
      direction: "OUT",
      amount: planned,
      frequency: sub.cycle === "monthly" ? "monthly" : "once",
      due_day: Number(sub.start_on.slice(8, 10)),
      due_weekday: null,
      due_date: sub.cycle === "monthly" ? null : sub.start_on,
      type_code: null,
      vendor_id: null,
      account_id: sub.account_id,
      scheme_codes: [],
      amount_kind: kind,
      source_ref: `subscription:${sub.sub_no}`,
      starts_on: sub.start_on.slice(0, 7),
      ends_on: sub.ends_on ? sub.ends_on.slice(0, 7) : null,
      note: sub.note,
      active: sub.status === "active",
      created_by: sub.created_by,
      created_at: sub.created_at,
    };

    const cells: CashCell[] = months.map((month) => {
      const pay = paidBy.get(`${sub.id}|${month}`);
      const falls = occursIn(sub, month) && (sub.status === "active" || !!pay);
      const date = dueDateIn(sub, month);
      if (!falls) {
        return {
          month, due_date: date, planned: 0, actual: 0, matched_by: null, trx_nos: [],
          state: "SKIPPED" as const, overridden: false, reason: null, events: [],
        };
      }
      const state = stateOf(!!pay, date, today);
      const reason = reasonFor(sub, usd_idr, pay);
      const event: CashEvent = {
        component_id: lineId, name: sub.name, direction: "OUT", frequency: component.frequency,
        amount_kind: kind, month, date, planned, actual: pay?.amount_idr ?? 0,
        matched_by: pay?.trx_no ? "linked" as const : null, trx_nos: pay?.trx_no ? [pay.trx_no] : [], state,
        vendor_name: sub.provider, account_code,
        carries_override: false, reason: reason || null,
      };
      return {
        month, due_date: date, planned, actual: pay?.amount_idr ?? 0, matched_by: event.matched_by,
        trx_nos: event.trx_nos, state, overridden: false, reason: reason || null, events: [event],
      };
    });

    return {
      component,
      subscription: {
        subscription_id: sub.id, sub_no: sub.sub_no, cycle: sub.cycle,
        currency: sub.currency, amount: sub.amount, amount_kind: sub.amount_kind, usd_idr,
      },
      vendor_name: sub.provider,
      account_code,
      cells,
      planned_total: cells.reduce((s, c) => s + c.planned, 0),
      actual_total: cells.reduce((s, c) => s + c.actual, 0),
    };
  }).filter((r) => r.cells.some((c) => c.state !== "SKIPPED"));
}

/** What a month still costs of the subscriptions: the month we stand in counts
 *  only what is not yet paid (what was paid already left); any other month
 *  counts what it plans. The same rule `cash_plan()` applies to a component. */
function stillToCome(cell: CashCell, isCurrent: boolean): number {
  if (cell.state === "SKIPPED") return 0;
  if (!isCurrent) return cell.planned;
  return cell.state === "PAID" ? 0 : cell.planned;
}

/** Lay the subscription rows onto a plan: they are added to the rows, their
 *  month costs to `planned_out`, and the running balance and the first month
 *  it goes under are worked out again — so *does the money last* answers for
 *  everything that is due, subscriptions included.
 *
 *  Takes and returns the pieces rather than a whole `CashPlan` because the two
 *  API layers build the verdict and the month labels at different points. */
export function applySubscriptions<M extends Pick<CashMonth, "month" | "is_current" | "planned_out" | "closing">>(
  plan: { months: M[]; rows: CashRow[] },
  subRows: CashRow[],
): { months: M[]; rows: CashRow[]; short_month: string | null; short_by: number } {
  let carried = 0;
  const months = plan.months.map((m, i) => {
    const extra = subRows.reduce((s, r) => s + stillToCome(r.cells[i], m.is_current), 0);
    carried += extra;
    return { ...m, planned_out: m.planned_out + extra, closing: m.closing - carried };
  });
  const short = months.find((m) => m.closing < 0) ?? null;
  return {
    months,
    rows: [...plan.rows, ...subRows],
    short_month: short?.month ?? null,
    short_by: short ? Math.abs(short.closing) : 0,
  };
}

/** The ledger rows a subscription has taken are spoken for: they are the
 *  billing's payment, not money that left with no line planned for it. Taken
 *  out of *Not in the plan* so the same payment is not counted twice. `typeOf`
 *  names a row's category so the three biggest are right afterwards. */
export function settleUnplanned(
  unplanned: CashUnplanned[],
  payments: SubscriptionPayment[],
  typeOf: (trxNo: string) => string | null,
): CashUnplanned[] {
  const linked = payments.filter((p) => p.trx_no);
  if (linked.length === 0) return unplanned;
  return unplanned.map((u) => {
    const mine = linked.filter((p) => u.trx_nos.includes(p.trx_no!));
    if (mine.length === 0) return u;
    const top = new Map(u.top_types.map((t) => [t.type_code, t.amount]));
    for (const p of mine) {
      const type = typeOf(p.trx_no!);
      if (type && top.has(type)) top.set(type, top.get(type)! - p.amount_idr);
    }
    return {
      ...u,
      amount: Math.max(u.amount - mine.reduce((s, p) => s + p.amount_idr, 0), 0),
      trx_nos: u.trx_nos.filter((n) => !mine.some((p) => p.trx_no === n)),
      top_types: [...top.entries()].filter(([, amount]) => amount > 0)
        .map(([type_code, amount]) => ({ type_code, amount }))
        .sort((a, b) => b.amount - a.amount),
    };
  });
}

/** The register as the screen draws it. `months` is only used to look ahead
 *  for the next unpaid billing; a biennial one needs more than two years. */
export function subscriptionRegister(input: {
  subscriptions: Subscription[];
  payments: SubscriptionPayment[];
  usd_idr: number;
  today: string;
  accountCodeOf: (id: string | null) => AccountCode | null;
}): SubscriptionRegister {
  const { subscriptions, payments, usd_idr, today, accountCodeOf } = input;
  const thisMonth = today.slice(0, 7);

  const views: SubscriptionView[] = subscriptions.map((sub) => {
    const own = payments
      .filter((p) => p.subscription_id === sub.id)
      .sort((a, b) => b.period.localeCompare(a.period));
    const paidIn = new Map(own.map((p) => [p.period, p]));

    let next_due: string | null = null;
    let next_period: string | null = null;
    if (sub.status !== "cancelled") {
      for (let n = 0; n <= 25; n++) {
        const d = new Date(Number(thisMonth.slice(0, 4)), Number(thisMonth.slice(5, 7)) - 1 + n, 1);
        const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        if (occursIn(sub, ym) && !paidIn.has(ym)) {
          next_due = dueDateIn(sub, ym);
          next_period = ym;
          break;
        }
      }
    }

    const planned_idr = plannedIdr(sub, usd_idr);
    return {
      ...sub,
      account_code: accountCodeOf(sub.account_id),
      planned_idr,
      per_year_idr: Math.round(planned_idr * PER_YEAR[sub.cycle]),
      next_due,
      next_period,
      paid: paidIn.get(thisMonth) ?? null,
      payments: own,
    };
  });

  const yearly_total = views
    .filter((v) => v.status === "active")
    .reduce((s, v) => s + v.per_year_idr, 0);
  return { usd_idr, subscriptions: views, yearly_total, monthly_average: Math.round(yearly_total / 12) };
}
