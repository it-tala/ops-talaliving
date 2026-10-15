/** Implements `/api/v1/accounting` from `03-api.md`. */
import { ok, noop, invalid, notFound, type Result } from "@/services/_shared/envelope";
import type { ContributionAuditGroup } from "@/services/hr/contracts";
import type {
  Account, AccountBalance, Transaction, TransactionView, TransactionTypeCode,
  IncomingMoney, TransactionDetail, AllocationView, TransactionLine, TransactionType,
  VendorPayment, FundingView, FundingDetail,
  CashPlan, CashDue, CashComponent, CashOverride, CashSettlement,
  CashFrequency, CashMonthDetail, CashAmountKind,
  Direction, PaymentAllocation, EvidenceInboxRow, InboxHealth, AllocMethod,
  BankStatementView, DocumentCoverage, TransactionCoverage, MonthlyBills,
  AssetRentSchedule, AccountCode,
  Subscription, SubscriptionRegister, SubscriptionInput, SubscriptionPaymentInput,
  SubscriptionStatus, SubscriptionPayment,
  Cashflow, CashflowLineInput, CashflowBillInput, CashflowSettings,
  TransactionLineView, RedetailQueueRow,
  InboxLineCandidate,
  InboxLineCandidates,
} from "@/services/accounting/contracts";
import { guessLineKind, signedTotal, type LineKind } from "@/services/accounting/lines";
import { CASHFLOW_IN_CATEGORIES, CASHFLOW_OUT_CATEGORIES } from "@/services/accounting/contracts";
import type { Category, CategorySummary, Runway } from "@/services/accounting/contracts";
import { isCategory } from "@/services/accounting/categories";
import { runwayFrom } from "@/services/accounting/runway";
import { subscriptionRegister } from "@/services/accounting/subscriptions";
import { buildCashflow, balancesAt } from "@/services/accounting/cashflow";
import { getActiveLocale, formatIDR } from "@/lib/format";
import { officeToday } from "@/lib/office";
import { getState, apply, newId, nextDocNumber, writeAudit, writeOutbox } from "../store";
import type { AuditRow, DemoState } from "../state";
import {
  accountBalances, transactionView, allocatedTotal, inboxHealth, lineCoverage,
  lineStatus, fundings, fundingView, cashPlan, cashDue, cashMonthDetail,
  bankStatementView, bankStatementViews, documentCoverage, transactionCoverage,
  monthlyBills, contributionAudit, orderOfLine, orderPaidByLine,
  effectiveCategory, categorySummary, currentApproval,
} from "../derive";
import { latency, actingUser, requireAuthority, requireModule, requireLevel, conflict, replayed, remember, paged } from "./_kit";
import { PRIMARY_DOC_KINDS, COMPLETION_DOC_KINDS, type DocKind } from "@/services/documents/contracts";
import * as procurement from "./procurement";
import { link as linkDocument } from "./documents";

const SERVICE = "accounting" as const;

export async function listAccounts(): Promise<Result<AccountBalance[]>> {
  await latency();
  return ok(SERVICE, accountBalances(getState()));
}

/** The accounts whose rows this reader may see: every one of accounting's,
 *  and leadership's only with `approve_funds` — the test that already locks
 *  the balance (D87), now also hiding the rows under it (D391, `0238`). */
function readableAccountIds(state: DemoState): Set<string> {
  const mayReadLeadership = actingUser(state).authorities.includes("approve_funds");
  return new Set(state.accounts
    .filter((a) => a.custody !== "leadership" || mayReadLeadership)
    .map((a) => a.id));
}

export async function listAccountRows(): Promise<Result<Account[]>> {
  await latency();
  return ok(SERVICE, getState().accounts);
}

/** The types, with the flag that decides whether a row is expected to name
 *  what it bought and who from (D83, D86). Retired ones included — a picker
 *  filters them, a filter on the ledger does not. */
export async function listTypeRows(): Promise<Result<TransactionType[]>> {
  await latency();
  return ok(SERVICE, [...getState().transaction_types].sort((a, b) => a.code.localeCompare(b.code)));
}

/* ------------------------------------------------------------------ */
/* Master data (0105): accounts and transaction types                  */
/* ------------------------------------------------------------------ */

/** Accounts are money: accounting write and `post_ledger`, and anything that
 *  touches a leadership account also `approve_funds` (D87). */
function accountGuard(touchesLeadership: boolean) {
  const denied = requireLevel(SERVICE, "accounting", "write") ?? requireAuthority(SERVICE, "post_ledger");
  if (denied) return denied;
  return touchesLeadership ? requireAuthority(SERVICE, "approve_funds") : null;
}

export async function createAccount(input: {
  code: string; name: string; custody: Account["custody"]; is_paying?: boolean;
  currency?: string; opening_balance?: number; opened_on?: string;
}): Promise<Result<Account>> {
  await latency();
  const code = input.code.trim().toUpperCase();
  const currency = (input.currency ?? "IDR").trim().toUpperCase();
  const denied = accountGuard(input.custody === "leadership");
  if (denied) return denied;
  if (!/^[A-Z0-9][A-Z0-9 .\-]{1,23}$/.test(code)) {
    return invalid(SERVICE, "code_invalid", 'An account code is 2–24 characters: letters, digits, spaces, dots or dashes — e.g. "BCA 271".', { field: "code" });
  }
  if (!input.name.trim()) return invalid(SERVICE, "name_required", "An account needs a name.", { field: "name" });
  if (!/^[A-Z]{3}$/.test(currency)) {
    return invalid(SERVICE, "currency_invalid", "A currency is a three-letter code, e.g. IDR or USD.", { field: "currency" });
  }
  if (input.custody === "leadership" && input.is_paying) {
    return invalid(SERVICE, "leadership_not_paying", "A leadership account never pays a vendor directly.", { field: "is_paying" });
  }
  if (getState().accounts.some((a) => a.code.toUpperCase() === code)) {
    return conflict(SERVICE, "account_exists", `Account ${code} already exists.`, { field: "code" });
  }
  const row: Account = {
    id: newId("acc"), code, name: input.name.trim(), custody: input.custody,
    is_paying: input.is_paying ?? false, currency, opening_balance: input.opening_balance ?? 0,
    opened_on: input.opened_on ?? officeToday(), is_active: true,
  };
  apply((draft) => {
    draft.accounts.push(row);
    writeAudit(draft, { service: SERVICE, entity: "account", entity_no: code, action: "create", outcome: "ok", reason: null });
  });
  return ok(SERVICE, row);
}

export async function updateAccount(
  code: string,
  input: {
    name?: string; custody?: Account["custody"]; is_paying?: boolean; currency?: string;
    opening_balance?: number; opened_on?: string; is_active?: boolean; reason?: string;
  },
): Promise<Result<Account>> {
  await latency();
  const state = getState();
  const a = state.accounts.find((x) => x.code === code);
  if (!a) return notFound(SERVICE, "account_not_found", "No such account.");
  const custody = input.custody ?? a.custody;
  const denied = accountGuard(a.custody === "leadership" || custody === "leadership");
  if (denied) return denied;
  if (input.name !== undefined && !input.name.trim()) {
    return invalid(SERVICE, "name_required", "An account needs a name.", { field: "name" });
  }
  const isPaying = input.is_paying ?? a.is_paying;
  if (custody === "leadership" && isPaying) {
    return invalid(SERVICE, "leadership_not_paying", "A leadership account never pays a vendor directly.", { field: "is_paying" });
  }
  const currency = input.currency?.trim().toUpperCase() ?? a.currency;
  if (!/^[A-Z]{3}$/.test(currency)) {
    return invalid(SERVICE, "currency_invalid", "A currency is a three-letter code, e.g. IDR or USD.", { field: "currency" });
  }
  if (currency !== a.currency && state.transactions.some((t) => t.account_id === a.id)) {
    return conflict(SERVICE, "currency_locked", `${code} already has transactions in ${a.currency}; its currency cannot change.`, { field: "currency" });
  }
  const reason = input.reason?.trim() || null;
  const balanceChanged = input.opening_balance !== undefined && input.opening_balance !== a.opening_balance;
  if (balanceChanged && !reason) {
    return invalid(SERVICE, "reason_required", "Changing an opening balance moves every balance after it — say why.", { field: "reason" });
  }
  const next: Account = {
    ...a,
    name: input.name?.trim() ?? a.name, custody, is_paying: isPaying, currency,
    opening_balance: input.opening_balance ?? a.opening_balance,
    opened_on: input.opened_on ?? a.opened_on,
    is_active: input.is_active ?? a.is_active,
  };
  if (JSON.stringify(next) === JSON.stringify(a)) return noop(SERVICE, a);
  apply((draft) => {
    const d = draft.accounts.find((x) => x.id === a.id)!;
    Object.assign(d, next);
    writeAudit(draft, {
      service: SERVICE, entity: "account", entity_no: code, action: "update", outcome: "ok", reason,
      detail: balanceChanged ? { opening_balance_before: a.opening_balance, opening_balance_after: next.opening_balance } : null,
    });
  });
  return ok(SERVICE, getState().accounts.find((x) => x.id === a.id)!);
}

export async function deleteAccount(code: string): Promise<Result<{ code: string; deleted: true }>> {
  await latency();
  const state = getState();
  const a = state.accounts.find((x) => x.code === code);
  if (!a) return notFound(SERVICE, "account_not_found", "No such account.");
  const denied = accountGuard(a.custody === "leadership");
  if (denied) return denied;
  const trx = state.transactions.filter((t) => t.account_id === a.id).length;
  const stmt = state.bank_statements.filter((b) => b.account_id === a.id).length;
  const cash = state.cash_components.filter((c) => c.account_id === a.id).length;
  if (trx + stmt + cash > 0) {
    return conflict(SERVICE, "account_in_use",
      `${code} has ${trx} transaction(s), ${stmt} bank statement(s) and ${cash} planned payment(s). Deactivate it instead.`);
  }
  apply((draft) => {
    draft.accounts = draft.accounts.filter((x) => x.id !== a.id);
    writeAudit(draft, { service: SERVICE, entity: "account", entity_no: code, action: "delete", outcome: "ok", reason: null });
  });
  return ok(SERVICE, { code, deleted: true as const });
}

export async function createTransactionType(input: {
  code: string; is_purchase?: boolean; auto_complete?: boolean;
  creates_catalog_item?: boolean; description?: string;
}): Promise<Result<TransactionType>> {
  await latency();
  const denied = requireLevel(SERVICE, "accounting", "write");
  if (denied) return denied;
  const code = input.code.trim().replace(/\s+/g, " ").toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9 &/.\-]{1,39}$/.test(code)) {
    return invalid(SERVICE, "code_invalid", 'A type is 2–40 characters: letters, digits, spaces, "&", "/", "." or "-" — e.g. "TRANSPORT".', { field: "code" });
  }
  if (getState().transaction_types.some((t) => t.code === code)) {
    return conflict(SERVICE, "type_exists", `${code} already exists.`, { field: "code" });
  }
  const row: TransactionType = {
    code, is_purchase: input.is_purchase ?? true, auto_complete: input.auto_complete ?? false,
    creates_catalog_item: input.creates_catalog_item ?? false, category: "overhead",
    description: input.description?.trim() || null, is_active: true,
  };
  apply((draft) => {
    draft.transaction_types.push(row);
    writeAudit(draft, { service: SERVICE, entity: "transaction_type", entity_no: code, action: "create", outcome: "ok", reason: null });
  });
  return ok(SERVICE, row);
}

export async function updateTransactionType(
  code: string,
  input: {
    is_purchase?: boolean; auto_complete?: boolean; creates_catalog_item?: boolean;
    description?: string; is_active?: boolean;
  },
): Promise<Result<TransactionType>> {
  await latency();
  const denied = requireLevel(SERVICE, "accounting", "write");
  if (denied) return denied;
  const t = getState().transaction_types.find((x) => x.code === code);
  if (!t) return notFound(SERVICE, "type_not_found", "No such transaction type.");
  const next: TransactionType = {
    ...t,
    is_purchase: input.is_purchase ?? t.is_purchase,
    auto_complete: input.auto_complete ?? t.auto_complete,
    creates_catalog_item: input.creates_catalog_item ?? t.creates_catalog_item,
    description: input.description === undefined ? (t.description ?? null) : (input.description.trim() || null),
    is_active: input.is_active ?? (t.is_active ?? true),
  };
  if (JSON.stringify(next) === JSON.stringify({ ...t, description: t.description ?? null, is_active: t.is_active ?? true })) {
    return noop(SERVICE, t);
  }
  apply((draft) => {
    Object.assign(draft.transaction_types.find((x) => x.code === code)!, next);
    writeAudit(draft, { service: SERVICE, entity: "transaction_type", entity_no: code, action: "update", outcome: "ok", reason: null });
  });
  return ok(SERVICE, getState().transaction_types.find((x) => x.code === code)!);
}

export async function deleteTransactionType(code: string): Promise<Result<{ code: string; deleted: true }>> {
  await latency();
  const denied = requireLevel(SERVICE, "accounting", "write");
  if (denied) return denied;
  const state = getState();
  if (!state.transaction_types.some((x) => x.code === code)) {
    return notFound(SERVICE, "type_not_found", "No such transaction type.");
  }
  const trx = state.transactions.filter((t) => t.type_code === code).length;
  const cash = state.cash_components.filter((c) => c.type_code === code).length;
  if (trx + cash > 0) {
    return conflict(SERVICE, "type_in_use",
      `${code} is on ${trx} transaction(s) and ${cash} planned payment(s). Deactivate it instead.`);
  }
  apply((draft) => {
    draft.transaction_types = draft.transaction_types.filter((x) => x.code !== code);
    writeAudit(draft, { service: SERVICE, entity: "transaction_type", entity_no: code, action: "delete", outcome: "ok", reason: null });
  });
  return ok(SERVICE, { code, deleted: true as const });
}

/** `set_type_category` (0274): the category every row of the type gets. */
export async function setTypeCategory(code: string, category: Category): Promise<Result<TransactionType>> {
  await latency();
  const denied = requireLevel(SERVICE, "accounting", "write");
  if (denied) return denied;
  const t = getState().transaction_types.find((x) => x.code === code);
  if (!t) return notFound(SERVICE, "type_not_found", "No such transaction type.");
  if (!isCategory(category)) return invalid(SERVICE, "unknown_category", `${category} is not a category.`, { field: "category" });
  if (t.category === category) return noop(SERVICE, t);
  apply((draft) => {
    draft.transaction_types.find((x) => x.code === code)!.category = category;
    writeAudit(draft, { service: SERVICE, entity: "transaction_type", entity_no: code, action: "set_category", outcome: "ok", reason: null });
  });
  return ok(SERVICE, getState().transaction_types.find((x) => x.code === code)!);
}

export async function listTransactions(
  opts: {
    account_id?: string; type_code?: string; q?: string;
    /** By project **code**, resolved here — the caller crosses the seam with
     *  the public identifier, never an internal id (ADR-004). */
    project_code?: string;
    /** Inclusive `YYYY-MM-DD` bounds on `trx_date`. */
    from?: string; to?: string;
    direction?: "IN" | "OUT";
    /** The effective category (`0274`): the row's own, else its type's. */
    category?: Category;
    include_void?: boolean; limit?: number; offset?: number;
  } = {},
): Promise<Result<TransactionView[]>> {
  await latency();
  const state = getState();
  const readable = readableAccountIds(state);
  let rows = state.transactions.filter((t) => readable.has(t.account_id));
  if (opts.category) rows = rows.filter((t) => effectiveCategory(state, t) === opts.category);
  /* Filtered here rather than in the browser, so "page 2 of 3" counts the
     rows the reader will actually see. */
  if (!opts.include_void) rows = rows.filter((t) => t.status !== "VOID");
  if (opts.account_id) rows = rows.filter((t) => t.account_id === opts.account_id);
  if (opts.project_code) {
    const project = state.projects.find((p) => p.code === opts.project_code);
    rows = project ? rows.filter((t) => t.project_id === project.id) : [];
  }
  if (opts.type_code) rows = rows.filter((t) => t.type_code === opts.type_code);
  if (opts.direction) rows = rows.filter((t) => t.direction === opts.direction);
  if (opts.from) rows = rows.filter((t) => t.trx_date >= opts.from!);
  if (opts.to) rows = rows.filter((t) => t.trx_date <= opts.to!);
  if (opts.q) {
    const q = opts.q.toLowerCase();
    rows = rows.filter((t) => t.description.toLowerCase().includes(q) || t.trx_no.includes(q));
  }
  const views = rows
    .map((t) => transactionView(state, t))
    .sort((a, b) => b.trx_date.localeCompare(a.trx_date) || b.trx_no.localeCompare(a.trx_no));
  return paged(SERVICE, views, opts.limit ?? 50, opts.offset ?? 0);
}

/** `set_transaction_category` (0274): this row's own category; `""` clears
 *  it. `post_ledger`; a VOID row keeps what it has; an override equal to
 *  the type's category is no override. */
export async function setTransactionCategory(trxNo: string, category: Category | ""): Promise<Result<TransactionDetail>> {
  await latency();
  const denied = requireAuthority(SERVICE, "post_ledger");
  if (denied) return denied;
  const state = getState();
  const trx = state.transactions.find((t) => t.trx_no === trxNo);
  if (!trx) return notFound(SERVICE, "transaction_not_found", `Transaction ${trxNo} not found.`);
  if (trx.status === "VOID") return conflict(SERVICE, "transaction_void", "A void row keeps its category.");
  if (category !== "" && !isCategory(category)) {
    return invalid(SERVICE, "unknown_category", `${category} is not a category.`, { field: "category" });
  }
  const typeCat = state.transaction_types.find((t) => t.code === trx.type_code)?.category ?? "overhead";
  const next: Category | null = category === "" || category === typeCat ? null : category;
  if ((trx.category_override ?? null) === next) return getTransaction(trxNo);
  apply((draft) => {
    draft.transactions.find((t) => t.trx_no === trxNo)!.category_override = next;
    writeAudit(draft, {
      service: SERVICE, entity: "transaction", entity_no: trxNo, action: "set_category", outcome: "ok", reason: null,
      detail: { category_before: trx.category_override ?? typeCat, category_after: next ?? typeCat },
    });
  });
  return getTransaction(trxNo);
}

/** `set_line_evidence` (0279, L11): which of the row's own documents each
 *  line was read from. A document not attached to the row is refused. */
export async function setLineEvidence(
  trxNo: string, pointers: { line_no: number; attachment_id: string | null }[],
): Promise<Result<TransactionDetail>> {
  await latency();
  const denied = requireAuthority(SERVICE, "post_ledger");
  if (denied) return denied;
  const state = getState();
  const trx = state.transactions.find((t) => t.trx_no === trxNo);
  if (!trx) return notFound(SERVICE, "transaction_not_found", `Transaction ${trxNo} not found.`);
  if (trx.status === "VOID") return conflict(SERVICE, "transaction_void", "A void row is history; its lines are not pointed anywhere.");
  if (pointers.length === 0) return invalid(SERVICE, "pointers_required", "Say which line points at which document.", { field: "pointers" });
  const lines = state.transaction_lines.filter((l) => l.trx_id === trx.id);
  const missing = pointers.find((p) => !lines.some((l) => l.line_no === p.line_no));
  if (missing) return invalid(SERVICE, "no_such_line", `${trxNo} has no line ${missing.line_no}.`, { field: "pointers", line_no: missing.line_no });
  const attached = new Set(state.attachment_links
    .filter((k) => k.entity === "transaction" && k.entity_no === trxNo)
    .map((k) => k.attachment_id));
  const stray = pointers.find((p) => p.attachment_id && !attached.has(p.attachment_id));
  if (stray) {
    return invalid(SERVICE, "document_not_attached", "A line can only point at a document that is attached to its own row. Attach the file first.", { field: "pointers", attachment_id: stray.attachment_id });
  }
  const before = Object.fromEntries(lines.map((l) => [l.line_no, l.attachment_id ?? null]));
  let changed = 0;
  apply((draft) => {
    for (const p of pointers) {
      const l = draft.transaction_lines.find((x) => x.trx_id === trx.id && x.line_no === p.line_no)!;
      if ((l.attachment_id ?? null) !== p.attachment_id) { l.attachment_id = p.attachment_id; changed += 1; }
    }
    if (changed > 0) {
      writeAudit(draft, {
        service: SERVICE, entity: "transaction", entity_no: trxNo, action: "set_line_evidence", outcome: "ok", reason: null,
        detail: { before, after: Object.fromEntries(draft.transaction_lines.filter((l) => l.trx_id === trx.id).map((l) => [l.line_no, l.attachment_id ?? null])) },
      });
    }
  });
  return getTransaction(trxNo);
}

/** The whole row: what it bought, what it funded, and the line each
 *  allocation points at. One call, because a drawer that needs three is a
 *  drawer that renders in three stages. */
export async function getTransaction(trxNo: string): Promise<Result<TransactionDetail>> {
  await latency();
  const state = getState();
  const trx = state.transactions.find((t) => t.trx_no === trxNo);
  if (!trx || !readableAccountIds(state).has(trx.account_id)) {
    return notFound(SERVICE, "transaction_not_found", `Transaction ${trxNo} not found.`);
  }

  const allocations: AllocationView[] = state.payment_allocations
    .filter((a) => a.trx_id === trx.id)
    .map((a) => {
      const line = state.pr_lines.find((l) => l.line_no_full === a.pr_line_no);
      /* The line's current GOODS decision (0280, L7), as `v_allocation`
         carries it: the latest row of the trail, or nothing. */
      const approval = line ? currentApproval(state, line.id) : null;
      return {
        ...a,
        line_description: line?.description ?? null,
        line_status: line ? lineStatus(state, line) : null,
        approved: approval?.approved ?? null,
        approved_amount: approval?.approved_amount ?? null,
        approved_by: approval?.recorded_by_email ?? null,
        approved_at: approval?.recorded_at ?? null,
        approval_channel: approval?.channel ?? null,
      };
    });

  return ok(SERVICE, {
    ...transactionView(state, trx),
    /* Named, as `v_transaction_detail` names it (0272). */
    lines: state.transaction_lines.filter((l) => l.trx_id === trx.id).map((l) => {
      const item = l.item_id ? state.items.find((i) => i.id === l.item_id) : undefined;
      return { ...l, item_code: item?.code ?? null, item_name: item?.name ?? null };
    }),
    allocations,
    billed_currency: trx.billed_currency ?? null,
    billed_amount: trx.billed_amount ?? null,
    lines_reviewed_at: trx.lines_reviewed_at ?? null,
    lines_reviewed_by_name: trx.lines_reviewed_by
      ? state.users.find((u) => u.id === trx.lines_reviewed_by)?.full_name ?? null : null,
  });
}

/** `v_transaction_line` (0273): the a/b lines of the rows asked for, with
 *  their item named. */
export async function listTransactionLines(trxNos: string[]): Promise<Result<TransactionLineView[]>> {
  await latency();
  const state = getState();
  const want = new Set(trxNos);
  const readable = readableAccountIds(state);
  const rows: TransactionLineView[] = [];
  for (const t of state.transactions) {
    if (!want.has(t.trx_no) || !readable.has(t.account_id)) continue;
    for (const l of state.transaction_lines.filter((x) => x.trx_id === t.id).sort((a, b) => a.line_no - b.line_no)) {
      const item = l.item_id ? state.items.find((i) => i.id === l.item_id) : undefined;
      rows.push({ ...l, trx_no: t.trx_no, item_code: item?.code ?? null, item_name: item?.name ?? null });
    }
  }
  return ok(SERVICE, rows);
}

/** `v_redetail_queue` (0273, D434): money out with a document, dated 2026,
 *  not yet stamped, and looking lumped. Newest first, paged like the ledger. */
export async function listRedetailQueue(
  opts: { q?: string; account_code?: string; limit?: number; offset?: number } = {},
): Promise<Result<RedetailQueueRow[]>> {
  await latency();
  const state = getState();
  const readable = readableAccountIds(state);
  const q = opts.q?.trim().toLowerCase();
  const all = state.transactions
    .filter((t) => t.direction === "OUT" && t.status !== "VOID" && t.trx_date >= "2026-01-01"
      && !t.lines_reviewed_at && readable.has(t.account_id))
    .map((t) => {
      const account = state.accounts.find((a) => a.id === t.account_id);
      const vendor = state.vendors.find((v) => v.id === t.vendor_id);
      const type = state.transaction_types.find((x) => x.code === t.type_code);
      const lineCount = state.transaction_lines.filter((l) => l.trx_id === t.id).length;
      const evidence = state.attachment_links.filter((l) => l.entity === "transaction" && l.entity_no === t.trx_no).length;
      const row: RedetailQueueRow = {
        id: t.id, trx_no: t.trx_no, trx_date: t.trx_date,
        account_code: account?.code ?? "", type_code: t.type_code, vendor_name: vendor?.name ?? null,
        description: t.description, amount_idr: t.amount_idr, evidence_count: evidence,
        line_count: lineCount, single_line: lineCount <= 1,
        fee_tail: [2500, 5000, 6500].includes(t.amount_idr % 10000),
        is_purchase: type?.is_purchase ?? false,
        is_ecommerce: t.type_code === "ONLINE"
          || /shopee|tokopedia|lazada|blibli|tiktok shop/i.test(vendor?.name ?? "")
          || /\b(shopee|tokopedia|lazada|blibli)\b/i.test(t.description),
      };
      return row;
    })
    .filter((r) => r.evidence_count > 0 && (r.single_line || r.fee_tail || r.is_purchase))
    .filter((r) => !opts.account_code || r.account_code === opts.account_code)
    .filter((r) => !q || r.description.toLowerCase().includes(q) || r.trx_no.toLowerCase().includes(q))
    .sort((a, b) => b.trx_date.localeCompare(a.trx_date) || b.trx_no.localeCompare(a.trx_no));
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;
  return ok(SERVICE, all.slice(offset, offset + limit),
    { limit, cursor: null, has_more: all.length > offset + limit, total: all.length });
}

/** `set_transaction_lines` (0273): the whole detail replaced, or — with
 *  `lines: null` — confirmed as it is. The amount never moves here. */
export async function setTransactionLines(
  input: {
    trx_no: string;
    lines: { kind?: LineKind; description: string; qty?: number | null; uom?: string | null;
             unit_price?: number | null; amount: number; item_id?: string | null; attachment_id?: string | null }[] | null;
    reason?: string | null;
  },
  idempotencyKey?: string,
): Promise<Result<TransactionDetail>> {
  await latency();
  const endpoint = `setTransactionLines:${input.trx_no}`;
  const cached = replayed<TransactionDetail>(SERVICE, endpoint, idempotencyKey);
  if (cached) return cached;
  const denied = requireAuthority(SERVICE, "post_ledger");
  if (denied) return denied;

  const state = getState();
  const trx = state.transactions.find((t) => t.trx_no === input.trx_no);
  if (!trx) return notFound(SERVICE, "transaction_not_found", `Transaction ${input.trx_no} not found.`);
  if (trx.status === "VOID") {
    return conflict(SERVICE, "transaction_void", `${trx.trx_no} is VOID — a void row is not re-detailed.`);
  }
  if (state.statement_lines.some((l) => l.trx_no === trx.trx_no && (l.status === "matched" || l.status === "booked"))) {
    return conflict(SERVICE, "statement_matched", "This row is matched to a bank statement line. Unmatch it first, then re-detail it.");
  }
  const type = state.transaction_types.find((x) => x.code === trx.type_code);
  const before = state.transaction_lines.filter((l) => l.trx_id === trx.id).sort((a, b) => a.line_no - b.line_no);
  const user = actingUser();
  const now = new Date().toISOString();
  const reason = input.reason?.trim() || null;

  if (input.lines === null) {
    apply((draft) => {
      const t = draft.transactions.find((x) => x.id === trx.id)!;
      t.lines_reviewed_at = now; t.lines_reviewed_by = user.id;
      writeAudit(draft, {
        service: SERVICE, entity: "transaction", entity_no: trx.trx_no, action: "set_lines",
        outcome: "ok", reason: reason ?? "confirmed as is", detail: { confirmed: true, lines: before.length },
      });
    });
    const got = await getTransaction(trx.trx_no);
    if (got.data) remember(SERVICE, endpoint, idempotencyKey, got.data);
    return got;
  }

  const lines = input.lines.map((l) => ({ ...l, kind: l.kind ?? guessLineKind(l.description) }));
  if (lines.length === 0) {
    return invalid(SERVICE, "detail_required", "Re-detailing a row means at least one line. To confirm it as it is, send no lines.", { field: "lines" });
  }
  if (lines.some((l) => l.amount < 0)) {
    return invalid(SERVICE, "line_amount_negative", "A line's amount is always positive. A voucher or a refund netted in is a discount line — the kind carries the sign.", { field: "lines" });
  }
  if (lines.some((l) => !l.description.trim())) {
    return invalid(SERVICE, "line_description_required", "Every line says what it is.", { field: "lines" });
  }
  if (type?.is_purchase) {
    const missing = lines.find((l) => l.kind === "item" && (l.qty == null || l.unit_price == null));
    if (missing) {
      return invalid(SERVICE, "line_detail_required", `"${missing.description}" has no quantity or no unit price. Both are what make a price comparable to the next one.`, { field: "lines" });
    }
  }
  const sum = signedTotal(lines);
  if (sum !== trx.amount_idr) {
    return invalid(SERVICE, "lines_do_not_add_up",
      `The detail adds up to ${sum.toLocaleString(getActiveLocale())} but the transaction is ${trx.amount_idr.toLocaleString(getActiveLocale())}. The amount is corrected with Edit, not here.`,
      { field: "lines", lines_total: sum, amount: trx.amount_idr });
  }
  if (lines.some((l) => l.item_id && !state.items.some((i) => i.id === l.item_id))) {
    return invalid(SERVICE, "no_such_item", "A line names a catalogue item that does not exist.", { field: "lines" });
  }

  apply((draft) => {
    draft.transaction_lines = draft.transaction_lines.filter((l) => l.trx_id !== trx.id);
    lines.forEach((l, i) => {
      draft.transaction_lines.push({
        id: newId("trl"), trx_id: trx.id, line_no: i + 1, kind: l.kind, item_id: l.item_id ?? null,
        description: l.description.trim(), qty: l.qty ?? null, uom: (l.uom ?? null) as never,
        unit_price: l.unit_price ?? null, amount: l.amount, attachment_id: null,
      });
    });
    const t = draft.transactions.find((x) => x.id === trx.id)!;
    t.lines_reviewed_at = now; t.lines_reviewed_by = user.id;
    writeAudit(draft, {
      service: SERVICE, entity: "transaction", entity_no: trx.trx_no, action: "set_lines",
      outcome: "ok", reason,
      /* The old detail and the new, so the lump is never lost (the real
         trail keeps them as before/after). */
      detail: {
        lines_before: before.map(({ line_no, kind, item_id, description, qty, uom, unit_price, amount }) =>
          ({ line_no, kind, item_id, description, qty, uom, unit_price, amount })),
        lines_after: lines.map((l, i) => ({ line_no: i + 1, kind: l.kind, item_id: l.item_id ?? null,
          description: l.description.trim(), qty: l.qty ?? null, uom: l.uom ?? null, unit_price: l.unit_price ?? null, amount: l.amount })),
      },
    });
    writeOutbox(draft, { service: SERVICE, event_type: "accounting.transaction.redetailed", payload: { trx_no: trx.trx_no, lines: lines.length, reason } });
  });
  const got = await getTransaction(trx.trx_no);
  if (got.data) remember(SERVICE, endpoint, idempotencyKey, got.data);
  return got;
}

/** The one write seam. Everything that creates a ledger row comes through
 *  here, and `source_ref` is the claim that makes a retry a no-op — the reason
 *  double posting is impossible rather than merely unlikely (A4, ADR-006). */
export async function postTransaction(
  input: {
    trx_date: string;
    account_id: string;
    direction: Direction;
    amount_idr: number;
    type_code: TransactionTypeCode;
    vendor_id?: string | null;
    project_id?: string | null;
    description: string;
    source_ref: string;
    /** What was bought, in quantity and price. Required for a purchase: an
     *  amount with no detail behind it cannot be checked against anything
     *  later (D86). */
    lines?: { kind?: LineKind; description: string; qty?: number | null; uom?: string | null;
              unit_price?: number | null; amount: number; item_id?: string | null }[];
    /** At least one of these has to be a nota, a transfer proof or a photo of
     *  what arrived (D85). The files are uploaded first and linked here, in
     *  the same act as the row — so a row without evidence never exists, not
     *  even for a second. */
    documents: { attachment_id: string; kind: DocKind }[];
    /** The bill in another currency, paid in rupiah (`0271`, D435). */
    billed_currency?: string | null;
    billed_amount?: number | null;
  },
  idempotencyKey?: string,
): Promise<Result<TransactionView>> {
  await latency();
  const cached = replayed<TransactionView>(SERVICE, "postTransaction", idempotencyKey);
  if (cached) return cached;

  const denied = requireAuthority(SERVICE, "post_ledger");
  if (denied) {
    apply((draft) => {
      writeAudit(draft, {
        service: SERVICE, entity: "transaction", entity_no: input.source_ref,
        action: "post", outcome: "refused", reason: "tanpa authority post_ledger",
        detail: { attempted_amount: input.amount_idr, account_id: input.account_id },
      });
    });
    return denied;
  }

  if (input.amount_idr <= 0) {
    return invalid(SERVICE, "amount_positive", "Amount must be greater than zero. Direction lives in the IN/OUT column.", { field: "amount_idr" });
  }
  if (!input.description.trim()) {
    return invalid(SERVICE, "description_required", "Description is required.", { field: "description" });
  }

  /* No document, no row (D85). The old system let a number be typed and the
   * paperwork follow "later", and later is where the unexplained rows live. */
  const primary = input.documents.filter((d) => PRIMARY_DOC_KINDS.includes(d.kind));
  if (primary.length === 0) {
    return invalid(
      SERVICE, "evidence_required",
      "A ledger row needs at least one nota, transfer proof or photo of what arrived. Supporting documents — a delivery note, the PO — are welcome, but they cannot stand alone.",
      { field: "documents", accepted: PRIMARY_DOC_KINDS },
    );
  }

  const state = getState();
  const type = state.transaction_types.find((t) => t.code === input.type_code);
  /* Each line's kind: as sent, or what its description suggests — the same
     guess the seam makes (`line_kind_guess`, 0271). */
  const lines = (input.lines ?? []).map((l) => ({ ...l, kind: l.kind ?? guessLineKind(l.description) }));

  if (lines.some((l) => l.amount < 0)) {
    return invalid(
      SERVICE, "line_amount_negative",
      "A line's amount is always positive. A voucher or a refund netted in is a discount line — the kind carries the sign.",
      { field: "lines" },
    );
  }

  /* The bill in another currency: both or neither, a real code, not IDR. */
  const billedCcy = (input.billed_currency ?? "").trim().toUpperCase() || null;
  const billedAmt = input.billed_amount ?? null;
  if ((billedCcy === null) !== (billedAmt === null)) {
    return invalid(SERVICE, "billed_together",
      "A bill in another currency is a currency and an amount, together. Give both or neither.", { field: "billed_amount" });
  }
  if (billedCcy !== null && (!/^[A-Z]{3}$/.test(billedCcy) || billedCcy === "IDR")) {
    return invalid(SERVICE, "billed_currency",
      "The billed currency is a three-letter code other than IDR — USD, SGD, EUR.", { field: "billed_currency", given: billedCcy });
  }
  if (billedAmt !== null && billedAmt <= 0) {
    return invalid(SERVICE, "billed_amount_positive", "The billed amount is greater than zero.", { field: "billed_amount" });
  }

  if (type?.is_purchase) {
    if (lines.length === 0) {
      return invalid(
        SERVICE, "detail_required",
        `${input.type_code} is a purchase: it needs what was bought, how many and at what price. An amount on its own cannot be checked against a delivery, a quote or next month.`,
        { field: "lines" },
      );
    }
    /* D86 on the goods only: a fee, a tax or the courier is an amount, not a
       quantity of anything (0271). */
    const missing = lines.find((l) => l.kind === "item" && (l.qty == null || l.unit_price == null));
    if (missing) {
      return invalid(
        SERVICE, "line_detail_required",
        `"${missing.description}" has no quantity or no unit price. Both are what make a price comparable to the next one.`,
        { field: "lines" },
      );
    }
    if (!input.vendor_id) {
      return invalid(
        SERVICE, "vendor_required",
        "A purchase has somebody it was bought from. Without it the question \"where do we buy this\" has no answer.",
        { field: "vendor_id" },
      );
    }
  }

  if (lines.length > 0) {
    const sum = signedTotal(lines);
    if (sum !== input.amount_idr) {
      return invalid(
        SERVICE, "lines_do_not_add_up",
        `The detail adds up to ${sum.toLocaleString(getActiveLocale())} but the transaction is ${input.amount_idr.toLocaleString(getActiveLocale())}. One of the two is wrong, and the ledger will not guess which.`,
        { field: "lines", lines_total: sum, amount: input.amount_idr },
      );
    }
  }

  const existing = state.transactions.find((t) => t.source_ref === input.source_ref);
  if (existing) {
    return conflict(
      SERVICE, "already_posted",
      `Already posted as ${existing.trx_no} — nothing changed.`,
      { trx_no: existing.trx_no },
    );
  }

  const user = actingUser();
  let trxNo = "";
  apply((draft) => {
    trxNo = nextDocNumber(draft, "trx");
    const trxId = newId("trx");
    draft.transactions.unshift({
      id: trxId, trx_no: trxNo, trx_date: input.trx_date,
      account_id: input.account_id, direction: input.direction, amount_idr: input.amount_idr,
      type_code: input.type_code, vendor_id: input.vendor_id ?? null,
      project_id: input.project_id ?? null, description: input.description,
      remark: null, status: "POSTED", source_ref: input.source_ref,
      posted_by: user.id, posted_at: new Date().toISOString(), void_reason: null,
      billed_currency: billedCcy, billed_amount: billedAmt,
    });
    lines.forEach((l, i) => {
      draft.transaction_lines.push({
        id: newId("trl"), trx_id: trxId, line_no: i + 1, kind: l.kind, item_id: l.item_id ?? null,
        description: l.description, qty: l.qty ?? null, uom: (l.uom ?? null) as never,
        unit_price: l.unit_price ?? null, amount: l.amount,
      });
    });
    for (const d of input.documents) {
      draft.attachment_links.push({
        id: newId("lnk"), attachment_id: d.attachment_id,
        entity: "transaction", entity_no: trxNo, kind: d.kind,
        linked_by: user.id, linked_at: new Date().toISOString(),
      });
    }
    writeAudit(draft, {
      service: SERVICE, entity: "transaction", entity_no: trxNo,
      action: "post", outcome: "ok", reason: null,
      /* Everything a later question would ask: how much, out of which
         account, to whom, with what behind it (D84). */
      detail: {
        amount: input.amount_idr, direction: input.direction,
        account: draft.accounts.find((a) => a.id === input.account_id)?.code ?? null,
        type: input.type_code,
        vendor: draft.vendors.find((v) => v.id === input.vendor_id)?.name ?? null,
        lines: lines.length,
        item_lines: lines.filter((l) => l.kind === "item").length,
        documents: input.documents.map((d) => d.kind),
        source_ref: input.source_ref,
        ...(billedCcy ? { billed: `${billedCcy} ${billedAmt}` } : {}),
      },
    });
    writeOutbox(draft, { service: SERVICE, event_type: "accounting.transaction.posted", payload: { trx_no: trxNo, amount: input.amount_idr } });
  });

  const after = getState();
  const view = transactionView(after, after.transactions.find((t) => t.trx_no === trxNo)!);
  remember(SERVICE, "postTransaction", idempotencyKey, view);
  return ok(SERVICE, view);
}


/** Amount to zero, reason kept, row stays. Never a delete (A5). Reversible,
 *  because sometimes the bank really did do the thing. */
export async function voidTransaction(
  trxNo: string, reason: string, idempotencyKey?: string,
): Promise<Result<TransactionView>> {
  await latency();
  const cached = replayed<TransactionView>(SERVICE, `void:${trxNo}`, idempotencyKey);
  if (cached) return cached;

  const denied = requireAuthority(SERVICE, "post_ledger");
  if (denied) return denied;
  if (!reason.trim()) {
    return invalid(SERVICE, "reason_required", "A reason is required to void.", { field: "reason" });
  }

  const trx = getState().transactions.find((t) => t.trx_no === trxNo);
  if (!trx) return notFound(SERVICE, "transaction_not_found", `Transaction ${trxNo} not found.`);
  if (trx.status === "VOID") {
    return conflict(SERVICE, "already_void", `${trxNo} is already VOID — nothing changed.`);
  }

  apply((draft) => {
    const t = draft.transactions.find((x) => x.id === trx.id)!;
    t.status = "VOID";
    t.amount_idr = 0;
    t.void_reason = `VOID ${new Date().toISOString().slice(0, 10)} — ${reason.trim()}`;
    writeAudit(draft, {
      service: SERVICE, entity: "transaction", entity_no: trxNo, action: "void",
      outcome: "ok", reason,
      /* The amount that disappeared is the whole point of the entry: a void
         is the one action that makes money vanish from a total (D84). */
      detail: {
        amount_before: trx.amount_idr, amount_after: 0,
        status_before: trx.status, status_after: "VOID",
        account: draft.accounts.find((a) => a.id === trx.account_id)?.code ?? null,
      },
    });
    writeOutbox(draft, { service: SERVICE, event_type: "accounting.transaction.voided", payload: { trx_no: trxNo, reason } });
  });

  const state = getState();
  const view = transactionView(state, state.transactions.find((t) => t.id === trx.id)!);
  remember(SERVICE, `void:${trxNo}`, idempotencyKey, view);
  return ok(SERVICE, view);
}

/** Correcting a row in place (owner, 2026-09-23). Either field may be left
 *  out to keep it. An amount change needs a remark and may not contradict a
 *  bank statement line the row is matched to. Going below what is already
 *  applied to requests is allowed and flagged in the audit detail. The remark is the audit row's reason; the
 *  values before and after are its detail — the IT audit log reads both. */
export async function editTransaction(
  input: {
    trx_no: string;
    amount_idr?: number;
    description?: string;
    /** Omitted keeps it, `""` takes it off, a code resolves it or refuses.
     *  Three states, because `vendor_id` is nullable and *leave it alone* and
     *  *clear it* are different instructions (`0105`). */
    vendor_code?: string | null;
    project_code?: string | null;
    type_code?: string;
    /** Which account the money moved through (`0204`). No clearing case —
     *  money always moved through somewhere. */
    account_code?: string;
    /** IN ↔ OUT (`0269`, D430). Needs a remark; refused on a row matched to
     *  a bank statement or paying request lines or orders. */
    direction?: "IN" | "OUT";
    reason?: string;
    /** The bill in another currency (`0271`): omitted keeps it, `""` clears
     *  both, a code sets both with `billed_amount`; the amount alone changes
     *  it on a row that already has a currency. */
    billed_currency?: string | null;
    billed_amount?: number | null;
  },
  idempotencyKey?: string,
): Promise<Result<TransactionView>> {
  await latency();
  const endpoint = `edit:${input.trx_no}`;
  const cached = replayed<TransactionView>(SERVICE, endpoint, idempotencyKey);
  if (cached) return cached;

  const denied = requireAuthority(SERVICE, "post_ledger");
  if (denied) return denied;

  const state = getState();
  const trx = state.transactions.find((t) => t.trx_no === input.trx_no);
  if (!trx) return notFound(SERVICE, "transaction_not_found", `Transaction ${input.trx_no} not found.`);
  if (trx.status === "VOID") {
    return conflict(SERVICE, "transaction_void", `${input.trx_no} is VOID — a void row is not edited. Post a new one.`);
  }
  if (input.description !== undefined && !input.description.trim()) {
    return invalid(SERVICE, "description_required", "The description cannot be empty.", { field: "description" });
  }
  if (input.amount_idr !== undefined && !(input.amount_idr > 0)) {
    return invalid(SERVICE, "amount_positive", "The amount must be greater than zero. Direction is its own field.", { field: "amount" });
  }

  const amount = input.amount_idr ?? trx.amount_idr;
  const description = input.description?.trim() ?? trx.description;
  const reason = input.reason?.trim() || null;

  /* The three references, resolved before anything is written — a run that
     applied the amount and then refused an unknown code would leave the row
     half corrected, and the screen would have no way to show which half. */
  let vendorId = trx.vendor_id;
  if (input.vendor_code !== undefined && input.vendor_code !== null) {
    if (input.vendor_code.trim() === "") {
      vendorId = null;
    } else {
      const v = state.vendors.find((x) => x.code === input.vendor_code!.trim());
      if (!v) {
        return invalid(SERVICE, "no_such_vendor", `There is no vendor ${input.vendor_code.trim()}.`, { field: "vendor_code" });
      }
      vendorId = v.id;
    }
  }
  let projectId = trx.project_id;
  if (input.project_code !== undefined && input.project_code !== null) {
    if (input.project_code.trim() === "") {
      projectId = null;
    } else {
      const p = state.projects.find((x) => x.code === input.project_code!.trim());
      if (!p) {
        return invalid(SERVICE, "no_such_project", `There is no project ${input.project_code.trim()}.`, { field: "project_code" });
      }
      projectId = p.id;
    }
  }
  const typeCode = input.type_code?.trim() || trx.type_code;
  if (typeCode !== trx.type_code && !state.transaction_types.some((ty) => ty.code === typeCode)) {
    return invalid(SERVICE, "no_such_type", `There is no transaction type ${typeCode}.`, { field: "type_code" });
  }

  /* The account (`0204`). Unlike the vendor it moves money from one balance
     to another, so three guards the vendor does not have: the bank statement
     that already confirmed the row, a leadership account on either side
     (D87), and a different currency. */
  const accFrom = state.accounts.find((a) => a.id === trx.account_id)!;
  let accTo = accFrom;
  const wantedAccount = input.account_code?.trim();
  if (wantedAccount && wantedAccount !== accFrom.code) {
    const a = state.accounts.find((x) => x.code === wantedAccount);
    if (!a) {
      return invalid(SERVICE, "no_such_account", `There is no account ${wantedAccount}.`, { field: "account_code" });
    }
    if (a.is_active === false) {
      return invalid(SERVICE, "account_inactive", `${a.code} is no longer in use — a row is not moved onto it.`, { field: "account_code" });
    }
    if (a.currency !== accFrom.currency) {
      return invalid(
        SERVICE, "account_currency",
        `${accFrom.code} is a ${accFrom.currency} account and ${a.code} is ${a.currency}. The amount here is in ${accFrom.currency}, so it cannot simply move — void it and post it on the right account.`,
        { field: "account_code" },
      );
    }
    if (accFrom.custody === "leadership" || a.custody === "leadership") {
      const denied = requireAuthority(SERVICE, "approve_funds");
      if (denied) return denied;
    }
    if (state.statement_lines.some((l) => l.trx_no === trx.trx_no && (l.status === "matched" || l.status === "booked"))) {
      return conflict(SERVICE, "statement_matched", `This row is matched to a ${accFrom.code} bank statement line, so the bank says which account it moved through. Unmatch it first.`);
    }
    accTo = a;
  }

  /* IN/OUT (`0269`). It turns the row's effect on the balance around by
     twice its amount: the bank statement says which way the money went,
     money that came in paid for nothing, and a leadership balance is
     `approve_funds`' (D87). */
  const direction = input.direction ?? trx.direction;
  if (direction !== "IN" && direction !== "OUT") {
    return invalid(SERVICE, "no_such_direction", "Direction is IN or OUT.", { field: "direction" });
  }
  if (direction !== trx.direction) {
    if (state.statement_lines.some((l) => l.trx_no === trx.trx_no && (l.status === "matched" || l.status === "booked"))) {
      return conflict(SERVICE, "statement_matched", "This row is matched to a bank statement line, so the bank says whether money came in or went out. Unmatch it first.");
    }
    if (state.payment_allocations.some((a) => a.trx_id === trx.id && a.superseded_by === null)) {
      return conflict(SERVICE, "direction_allocated", "This row pays request lines or orders. Money that came in paid for nothing — take the allocations off first.");
    }
    if (accFrom.custody === "leadership" || accTo.custody === "leadership") {
      const denied = requireAuthority(SERVICE, "approve_funds");
      if (denied) return denied;
    }
    if (!reason) {
      return invalid(SERVICE, "reason_required", "A remark is required when IN/OUT changes — say why it was recorded the wrong way.", { field: "reason" });
    }
  }

  /* The bill in another currency (0271). Null leaves it; "" clears both; a
     code sets both, with the amount. No remark — the rupiah that moved does
     not change, only what the invoice said. */
  let billedCcy = trx.billed_currency ?? null;
  let billedAmt = trx.billed_amount ?? null;
  if (input.billed_currency !== undefined && input.billed_currency !== null) {
    if (input.billed_currency.trim() === "") {
      billedCcy = null; billedAmt = null;
    } else {
      billedCcy = input.billed_currency.trim().toUpperCase();
      billedAmt = input.billed_amount ?? trx.billed_amount ?? null;
      if (!/^[A-Z]{3}$/.test(billedCcy) || billedCcy === "IDR") {
        return invalid(SERVICE, "billed_currency", "The billed currency is a three-letter code other than IDR — USD, SGD, EUR.", { field: "billed_currency", given: billedCcy });
      }
      if (billedAmt === null) {
        return invalid(SERVICE, "billed_together", "A bill in another currency is a currency and an amount, together.", { field: "billed_amount" });
      }
      if (billedAmt <= 0) {
        return invalid(SERVICE, "billed_amount_positive", "The billed amount is greater than zero.", { field: "billed_amount" });
      }
    }
  } else if (input.billed_amount !== undefined && input.billed_amount !== null) {
    if (!trx.billed_currency) {
      return invalid(SERVICE, "billed_together", "An amount in another currency needs the currency with it.", { field: "billed_currency" });
    }
    if (input.billed_amount <= 0) {
      return invalid(SERVICE, "billed_amount_positive", "The billed amount is greater than zero.", { field: "billed_amount" });
    }
    billedAmt = input.billed_amount;
  }
  const billedChanged = billedCcy !== (trx.billed_currency ?? null) || billedAmt !== (trx.billed_amount ?? null);

  if (amount === trx.amount_idr && description === trx.description
      && vendorId === trx.vendor_id && projectId === trx.project_id
      && typeCode === trx.type_code && accTo.id === accFrom.id
      && direction === trx.direction && !billedChanged) {
    return ok(SERVICE, transactionView(state, trx));
  }

  const detail: Record<string, unknown> = {};
  let syncLine: string | null = null;
  if (amount !== trx.amount_idr) {
    if (!reason) {
      return invalid(SERVICE, "reason_required", "A remark is required when the amount changes — say why the number was wrong.", { field: "reason" });
    }
    /* Below what is already applied is allowed (owner, 2026-09-23 — a
       discount after the request was paid), and flagged in the audit detail. */
    const allocated = allocatedTotal(state, trx.id);
    if (state.statement_lines.some((l) => l.trx_no === trx.trx_no && (l.status === "matched" || l.status === "booked"))) {
      return conflict(SERVICE, "statement_matched", "This row is matched to a bank statement line, so the bank's amount is the record. Unmatch it first.");
    }
    const lines = state.transaction_lines.filter((l) => l.trx_id === trx.id);
    if (lines.length === 1 && lines[0].amount === trx.amount_idr) syncLine = lines[0].id;
    Object.assign(detail, {
      amount_before: trx.amount_idr, amount_after: amount,
      lines: lines.length === 0 ? "none" : syncLine ? "updated" : "unchanged",
      ...(allocated > amount ? { allocated, over_allocated: allocated - amount } : {}),
    });
  }
  if (description !== trx.description) {
    Object.assign(detail, { description_before: trx.description, description_after: description });
  }
  /* By code and by name in the trail, never by uuid — an audit row nobody can
     read without a join is one nobody reads. */
  if (vendorId !== trx.vendor_id) {
    Object.assign(detail, {
      vendor_before: state.vendors.find((v) => v.id === trx.vendor_id)?.name ?? null,
      vendor_after: state.vendors.find((v) => v.id === vendorId)?.name ?? null,
    });
  }
  if (projectId !== trx.project_id) {
    Object.assign(detail, {
      project_before: state.projects.find((p) => p.id === trx.project_id)?.code ?? null,
      project_after: state.projects.find((p) => p.id === projectId)?.code ?? null,
    });
  }
  if (typeCode !== trx.type_code) {
    Object.assign(detail, { type_before: trx.type_code, type_after: typeCode });
  }
  if (accTo.id !== accFrom.id) {
    Object.assign(detail, { account_before: accFrom.code, account_after: accTo.code });
  }
  if (direction !== trx.direction) {
    Object.assign(detail, { direction_before: trx.direction, direction_after: direction });
  }
  if (billedChanged) {
    /* One readable value — `USD 26.64 → USD 25` — not two columns to pair. */
    Object.assign(detail, {
      billed_before: trx.billed_currency ? `${trx.billed_currency} ${trx.billed_amount}` : null,
      billed_after: billedCcy ? `${billedCcy} ${billedAmt}` : null,
    });
  }

  apply((draft) => {
    const t = draft.transactions.find((x) => x.id === trx.id)!;
    t.amount_idr = amount;
    t.description = description;
    t.vendor_id = vendorId;
    t.project_id = projectId;
    t.type_code = typeCode as typeof t.type_code;
    t.account_id = accTo.id;
    t.direction = direction;
    t.billed_currency = billedCcy;
    t.billed_amount = billedAmt;
    if (syncLine) {
      const l = draft.transaction_lines.find((x) => x.id === syncLine)!;
      l.amount = amount;
      if (l.qty && l.unit_price !== null) l.unit_price = Math.round((amount / l.qty) * 100) / 100;
    }
    writeAudit(draft, {
      service: SERVICE, entity: "transaction", entity_no: trx.trx_no, action: "edit",
      outcome: "ok", reason, detail,
    });
    writeOutbox(draft, {
      service: SERVICE, event_type: "accounting.transaction.edited",
      payload: { trx_no: trx.trx_no, ...detail, reason },
    });
  });

  const after = getState();
  const view = transactionView(after, after.transactions.find((t) => t.id === trx.id)!);
  remember(SERVICE, endpoint, idempotencyKey, view);
  return ok(SERVICE, view);
}

/** §10.1 item 15 of the recap: never built in the old web app. Built here. */
export async function markComplete(trxNo: string): Promise<Result<TransactionView>> {
  await latency();
  const denied = requireAuthority(SERVICE, "post_ledger");
  if (denied) return denied;

  const trx = getState().transactions.find((t) => t.trx_no === trxNo);
  if (!trx) return notFound(SERVICE, "transaction_not_found", `Transaction ${trxNo} not found.`);
  if (trx.status === "COMPLETED") {
    return conflict(SERVICE, "already_complete", `${trxNo} is already COMPLETED — nothing changed.`);
  }
  if (trx.status === "VOID") {
    return conflict(SERVICE, "transaction_void", `${trxNo} is VOID and cannot be completed.`);
  }
  /* COMPLETED means the paperwork is on it (owner, 2026-09-23): at least a
     receipt / nota or a payment proof. */
  const hasDoc = getState().attachment_links.some(
    (l) => l.entity === "transaction" && l.entity_no === trxNo && COMPLETION_DOC_KINDS.includes(l.kind),
  );
  if (!hasDoc) {
    return invalid(
      SERVICE, "document_required",
      "Attach a receipt / nota or a payment proof before marking this row completed.",
      { field: "documents" },
    );
  }

  apply((draft) => {
    draft.transactions.find((x) => x.id === trx.id)!.status = "COMPLETED";
    writeAudit(draft, {
      service: SERVICE, entity: "transaction", entity_no: trxNo, action: "complete",
      outcome: "ok", reason: null,
      detail: { status_before: trx.status, status_after: "COMPLETED" },
    });
  });
  const state = getState();
  return ok(SERVICE, transactionView(state, state.transactions.find((t) => t.id === trx.id)!));
}

/** A transaction never funds more than it moved (A9). The PR line is validated
 *  against procurement before anything is written — the seam doing its job,
 *  rather than a text field written hopefully and checked by a sweep hours
 *  later (ADR-004). */
export async function allocate(
  input: { trx_no: string; pr_line_no: string; amount: number; method?: AllocMethod },
  idempotencyKey?: string,
): Promise<Result<PaymentAllocation>> {
  await latency();
  const endpoint = `allocate:${input.trx_no}:${input.pr_line_no}`;
  const cached = replayed<PaymentAllocation>(SERVICE, endpoint, idempotencyKey);
  if (cached) return cached;

  const denied = requireAuthority(SERVICE, "post_ledger");
  if (denied) return denied;

  const state = getState();
  const trx = state.transactions.find((t) => t.trx_no === input.trx_no);
  if (!trx) return notFound(SERVICE, "transaction_not_found", `Transaction ${input.trx_no} not found.`);
  if (trx.status === "VOID") {
    return conflict(SERVICE, "transaction_void", `${input.trx_no} is VOID and cannot fund anything.`);
  }

  const line = state.pr_lines.find((l) => l.line_no_full === input.pr_line_no);
  if (!line) {
    return invalid(
      SERVICE, "pr_line_not_found",
      `Line ${input.pr_line_no} does not exist in procurement.`,
      { field: "pr_line_no", pr_line_no: input.pr_line_no },
    );
  }
  if (line.removed_at) {
    return conflict(SERVICE, "line_removed", `Line ${input.pr_line_no} has been removed.`);
  }
  if (input.amount <= 0) {
    return invalid(SERVICE, "amount_positive", "Allocation amount must be greater than zero.", { field: "amount" });
  }

  const already = allocatedTotal(state, trx.id);
  if (already + input.amount > trx.amount_idr) {
    return invalid(
      SERVICE, "over_allocated",
      `This transaction only moved Rp ${trx.amount_idr.toLocaleString(getActiveLocale())}; Rp ${already.toLocaleString(getActiveLocale())} is already allocated. A transaction never funds more than it moved.`,
      { field: "amount", moved: trx.amount_idr, already, attempted: input.amount },
    );
  }

  const user = actingUser();
  const alloc: PaymentAllocation = {
    /* A line on an order is paid on the order too (B8); the order is found
       from the link, never taken from the caller. */
    id: newId("alc"), trx_id: trx.id, pr_line_no: input.pr_line_no, po_no: orderPaidByLine(state, input.pr_line_no),
    amount: input.amount, method: input.method ?? "transfer", superseded_by: null,
    allocated_by: user.id, allocated_at: new Date().toISOString(),
  };
  apply((draft) => {
    draft.payment_allocations.push(alloc);
    writeAudit(draft, { service: SERVICE, entity: "allocation", entity_no: input.pr_line_no, action: "allocate", outcome: "ok", reason: null });
    writeOutbox(draft, {
      service: SERVICE, event_type: "accounting.allocation.recorded",
      payload: { trx_no: input.trx_no, pr_line_no: input.pr_line_no, amount: input.amount },
    });
  });
  remember(SERVICE, endpoint, idempotencyKey, alloc);
  return ok(SERVICE, alloc);
}

/** Everything that has happened to one ledger row, newest first.
 *
 *  The audit trail read from the record it belongs to, rather than from a
 *  screen nobody opens (D84). Anomaly and fraud questions are never "who
 *  touched the ledger this month" — they are "what happened to *this* row",
 *  asked while looking at it.
 */
export async function historyFor(trxNo: string): Promise<Result<AuditRow[]>> {
  await latency();
  /* The row's own actions, plus the documents put on and taken off it —
     `documents.link` files those under the record's own entity. */
  return ok(SERVICE, getState().audit_log.filter(
    (a) => (a.entity === "transaction" || a.entity === "attachment") && a.entity_no === trxNo,
  ));
}

/* ------------------------------------------------------------------ */
/* The exception inbox                                                 */
/* ------------------------------------------------------------------ */

/** Who `reported_by` is, spelled out, and which file the row is. Neither is
 *  stored on the row (`state.ts`'s own comment on `evidence_inbox`) — resolved
 *  here, the same boundary every other `_name` field in this file sits on.
 *  The demo files one photo's rows against one attachment, so the attachment
 *  is the file — the same identity `linkEvidence` checks below. */
function withReporterName(
  state: DemoState, row: Omit<EvidenceInboxRow, "reported_by_name" | "file_key">,
): EvidenceInboxRow {
  return {
    ...row,
    file_key: row.attachment_id,
    reported_by_name: state.users.find((u) => u.id === row.reported_by)?.full_name ?? null,
  };
}

export async function listInbox(): Promise<Result<EvidenceInboxRow[]>> {
  await latency();
  const state = getState();
  return ok(SERVICE, state.evidence_inbox.filter((r) => r.status === "PENDING").map((r) => withReporterName(state, r)));
}

export async function getInboxHealth(): Promise<Result<InboxHealth>> {
  await latency();
  return ok(SERVICE, inboxHealth(getState()));
}

/** Five resolutions, and none of them discards anything (A16).
 *
 *  The inbox holds documents whose parent is genuinely unknown — somebody
 *  bought first and the paperwork arrived in a chat thread. Every road out of
 *  it is recorded, including the two that never touch the ledger:
 *
 *    transaction    it becomes a ledger row (the document is its evidence)
 *    retro_pr_line  a request line written after the fact, then paid
 *    link           the money is already booked; this is its missing proof
 *    note           not a company transaction — kept, never posted
 *    reject         not ours, or unreadable. Kept with a reason, never posted
 *
 *  **A rejected row is the opposite of a ledger row** (D94). Rejecting is how
 *  you say "no money of ours moved here", and the file stays so the decision
 *  can be read later — which is the whole reason nothing is deleted.
 */
/** Book one document — the whole nota, in one act.
 *
 *  The live seam is `ops_acct.book_evidence` (0124); this answers the same
 *  shapes and the same refusals so the two clients stay one contract.
 *
 *  Not a third write seam (ADR-006): it composes `postTransaction` and the
 *  inbox resolution, and adds no rule about money. What it adds is that the
 *  two happen together — the screen's old two-call path had a toast reading
 *  *"Posted, inbox unchanged"*, which is a document in the ledger and still
 *  in the queue for the next person to confirm again.
 *
 *  The sum check is reproduced here rather than left to the database, because
 *  the demo is where somebody first meets this refusal, and meeting it late
 *  is how a contract quietly diverges.
 */
export async function bookEvidence(
  input: {
    ref_id: string;
    /** The other inbox rows of the **same photo**. The capture worker files
     *  one row per slot it read (`<event>~x0`, `~x1`, …), so one nota can
     *  arrive as several rows; they are booked as one document and closed
     *  together (0161). */
    also_ref_ids?: string[];
    trx_date: string;
    account_id: string;
    direction: Direction;
    amount_idr: number;
    type_code: TransactionTypeCode;
    vendor_id?: string | null;
    project_id?: string | null;
    description: string;
    remark?: string | null;
    lines?: { kind?: LineKind; description: string; qty?: number | null; uom?: string | null;
              unit_price?: number | null; amount: number; item_id?: string | null }[];
  },
  idempotencyKey?: string,
): Promise<Result<TransactionView>> {
  await latency();
  const endpoint = `bookEvidence:${input.ref_id}`;
  const cached = replayed<TransactionView>(SERVICE, endpoint, idempotencyKey);
  if (cached) return cached;

  /* Both, because it does both things (D24). The refusal names which is
     missing — "no" with no noun is a dead end for whoever reads it. */
  const deniedPost = requireAuthority(SERVICE, "post_ledger");
  if (deniedPost) return deniedPost;
  const deniedResolve = requireAuthority(SERVICE, "resolve_inbox");
  if (deniedResolve) return deniedResolve;

  const row = getState().evidence_inbox.find((r) => r.ref_id === input.ref_id);
  if (!row) return notFound(SERVICE, "inbox_row_not_found", `Row ${input.ref_id} not found.`);
  if (row.status !== "PENDING") {
    return conflict(SERVICE, "already_resolved",
      `This document is already ${row.status} — nothing changed.`);
  }
  /* The other rows of the same photo (0161): all present, all still pending. */
  const also = [...new Set(input.also_ref_ids ?? [])].filter((r) => r && r !== input.ref_id);
  for (const ref of also) {
    const other = getState().evidence_inbox.find((r) => r.ref_id === ref);
    if (!other) return notFound(SERVICE, "inbox_row_not_found", `Row ${ref} not found.`);
    if (other.status !== "PENDING") {
      return conflict(SERVICE, "already_resolved",
        `Part of this document is already ${other.status} — nothing changed. Reload the queue.`);
    }
  }

  const lines = input.lines ?? [];
  if (lines.length > 0) {
    const total = signedTotal(lines);
    if (total !== input.amount_idr) {
      return invalid(
        SERVICE, "lines_do_not_add_up",
        `Dokumen menyebut ${formatIDR(input.amount_idr)} dan ${lines.length} barisnya `
        + `berjumlah ${formatIDR(total)} — selisih ${formatIDR(total - input.amount_idr)}. `
        + "Tambahkan baris untuk sisanya, atau perbaiki salah satunya, sebelum dibukukan.",
        { field: "lines", amount: input.amount_idr, lines_total: total,
          difference: total - input.amount_idr },
      );
    }
  }

  const posted = await postTransaction({
    trx_date: input.trx_date,
    account_id: input.account_id,
    direction: input.direction,
    amount_idr: input.amount_idr,
    type_code: input.type_code,
    vendor_id: input.vendor_id ?? null,
    project_id: input.project_id ?? null,
    description: input.description,
    source_ref: `inbox:${input.ref_id}`,
    lines,
    documents: [{ attachment_id: row.attachment_id, kind: "Receipt / Invoice / Nota" }],
  });
  /* Relayed whole. Its refusals name the account or the vendor, and those are
     the words the person needs — nothing has been written at this point. */
  if (posted.error) return posted;

  apply((draft) => {
    const trxId = draft.transactions.find((t) => t.trx_no === posted.data.trx_no)?.id ?? null;
    for (const ref of [input.ref_id, ...also]) {
      const r = draft.evidence_inbox.find((x) => x.ref_id === ref)!;
      r.status = "CONFIRMED";
      r.produced_trx_id = trxId;
    }
    writeAudit(draft, {
      service: SERVICE, entity: "evidence_inbox", entity_no: input.ref_id,
      action: "book", outcome: "ok", reason: null,
      detail: {
        status_before: "PENDING", status_after: "CONFIRMED",
        trx_no: posted.data.trx_no, lines: lines.length, amount: input.amount_idr,
      },
    });
    writeOutbox(draft, {
      service: SERVICE, event_type: "accounting.inbox.resolved",
      payload: { ref_id: input.ref_id, resolution: "transaction", trx_no: posted.data.trx_no },
    });
  });

  remember(SERVICE, endpoint, idempotencyKey, posted.data);
  return ok(SERVICE, posted.data);
}

/** `inbox_line_candidates` (0281, L6): the approved request lines still
 *  owed money, ranked for one inbox document — the line the message names
 *  first, then the reading's vendor, then an amount within tolerance, newest
 *  decision first. A read; it decides nothing. */
export async function inboxLineCandidates(refId: string, limit = 20): Promise<Result<InboxLineCandidates>> {
  await latency();
  const denied = requireAuthority(SERVICE, "resolve_inbox");
  if (denied) return denied;
  const state = getState();
  const row = state.evidence_inbox.find((r) => r.ref_id === refId);
  if (!row) return notFound(SERVICE, "inbox_row_not_found", `Row ${refId} not found.`);

  const vendorRead = (row.extracted.vendor_name ?? "").trim() || null;
  const amountRead = typeof row.extracted.amount_idr === "number" ? row.extracted.amount_idr : null;
  /* The message's own words: `caption` once john-lau forwards it (J1), the
     reading's `note` until then. A `pr-…-Lxx` in either picks that line. */
  const text = `${(row.extracted as { caption?: string | null }).caption ?? ""} ${row.extracted.note ?? ""}`;
  const m = /(pr-\d{2}-\d{2}-\d{2}_\d+-L\d{2})/i.exec(text);
  const captionLine = m ? m[1].toLowerCase().replace(/-l(\d{2})$/, "-L$1") : null;
  /* Same as `ops_core.money_tolerance()` on a fresh database. */
  const tolerance = 1000;

  const all: InboxLineCandidate[] = state.pr_lines
    .filter((l) => !l.removed_at)
    .flatMap((l) => {
      const approval = currentApproval(state, l.id);
      if (!approval?.approved) return [];
      const cov = lineCoverage(state, l);
      if (cov.remaining <= 0) return [];
      const doc = state.pr_documents.find((d) => d.id === l.doc_id);
      const vendor = state.vendors.find((v) => v.id === l.vendor_id) ?? null;
      const project = doc ? state.projects.find((p) => p.id === doc.project_id) ?? null : null;
      const vn = vendor?.name ?? null;
      return [{
        line_no: l.line_no_full, description: l.description, doc_no: doc?.doc_no ?? "",
        vendor_id: l.vendor_id ?? null, vendor_name: vn,
        project_code: project?.code ?? null, project_name: project?.name ?? null,
        approved_amount: cov.approved, covered: cov.covered, remaining: cov.remaining,
        approved_by: approval.recorded_by_email, approved_at: approval.recorded_at, approval_channel: approval.channel,
        caption_match: captionLine !== null && l.line_no_full === captionLine,
        vendor_match: !!vendorRead && !!vn
          && (vn.toLowerCase().includes(vendorRead.toLowerCase()) || vendorRead.toLowerCase().includes(vn.toLowerCase())),
        amount_match: amountRead !== null && Math.abs(cov.remaining - amountRead) <= Math.max(tolerance, amountRead * 0.02),
      }];
    });
  const anyVendor = all.some((c) => c.vendor_match);
  const rank = (c: InboxLineCandidate) => (c.caption_match ? 4 : 0) + (c.vendor_match ? 2 : 0) + (c.amount_match ? 1 : 0);
  const candidates = all
    .filter((c) => c.caption_match || c.vendor_match || !anyVendor)
    .sort((a, b) => rank(b) - rank(a) || (b.approved_at ?? "").localeCompare(a.approved_at ?? ""))
    .slice(0, Math.max(limit, 1));
  return ok(SERVICE, { candidates, caption_line: captionLine, vendor_read: vendorRead, amount_read: amountRead });
}

/** Verification's sixth road (`book_evidence_to_line`, 0281, L6): pay an
 *  approved request line with this inbox document as the proof, and close
 *  the inbox row(s) with the line it paid — one act. */
export async function bookEvidenceToLine(
  input: {
    ref_id: string;
    also_ref_ids?: string[];
    line_no: string;
    account_id: string;
    amount: number;
    trx_date: string;
    type_code?: TransactionTypeCode;
  },
  idempotencyKey?: string,
): Promise<Result<TransactionView>> {
  await latency();
  const endpoint = `bookEvidenceToLine:${input.ref_id}`;
  const cached = replayed<TransactionView>(SERVICE, endpoint, idempotencyKey);
  if (cached) return cached;
  const deniedPost = requireAuthority(SERVICE, "post_ledger");
  if (deniedPost) return deniedPost;
  const deniedResolve = requireAuthority(SERVICE, "resolve_inbox");
  if (deniedResolve) return deniedResolve;
  if (!input.line_no.trim()) {
    return invalid(SERVICE, "line_required", "Say which approved request line this document pays.", { field: "line_no" });
  }

  const row = getState().evidence_inbox.find((r) => r.ref_id === input.ref_id);
  if (!row) return notFound(SERVICE, "inbox_row_not_found", `Row ${input.ref_id} not found.`);
  if (row.status !== "PENDING") {
    return conflict(SERVICE, "already_resolved", `This document is already ${row.status} — nothing changed.`);
  }
  const also = [...new Set(input.also_ref_ids ?? [])].filter((r) => r && r !== input.ref_id);
  for (const ref of also) {
    const other = getState().evidence_inbox.find((r) => r.ref_id === ref);
    if (!other) return notFound(SERVICE, "inbox_row_not_found", `Row ${ref} not found.`);
    if (other.status !== "PENDING") {
      return conflict(SERVICE, "already_resolved", `Part of this document is already ${other.status} — nothing changed. Reload the queue.`);
    }
  }

  /* `postFromLine` owns every rule about the line and the money; its
     refusals are relayed whole, and nothing is written before it answers. */
  const kind = row.extracted.doc_type === "Payment Proof" ? "Payment Proof" : "Receipt / Invoice / Nota";
  const posted = await postFromLine({
    line_no: input.line_no, amount: input.amount, account_id: input.account_id,
    trx_date: input.trx_date, type_code: input.type_code ?? "SUPPLIERS",
    attachment_id: row.attachment_id, document_kind: kind,
  });
  if (posted.error) return posted;

  apply((draft) => {
    const trxId = draft.transactions.find((t) => t.trx_no === posted.data.trx_no)?.id ?? null;
    for (const ref of [input.ref_id, ...also]) {
      const r = draft.evidence_inbox.find((x) => x.ref_id === ref)!;
      r.status = "CONFIRMED";
      r.produced_trx_id = trxId;
      r.produced_pr_line_no = input.line_no;
    }
    writeAudit(draft, {
      service: SERVICE, entity: "evidence_inbox", entity_no: input.ref_id,
      action: "book_to_line", outcome: "ok", reason: null,
      detail: { status_before: "PENDING", status_after: "CONFIRMED",
                trx_no: posted.data.trx_no, pr_line_no: input.line_no, amount: input.amount },
    });
    writeOutbox(draft, {
      service: SERVICE, event_type: "accounting.inbox.resolved",
      payload: { ref_id: input.ref_id, resolution: "pay_line", trx_no: posted.data.trx_no, pr_line_no: input.line_no },
    });
  });
  remember(SERVICE, endpoint, idempotencyKey, posted.data);
  return ok(SERVICE, posted.data);
}

/** One proof, several ledger rows, one act. The live seam is
 *  `ops_acct.link_evidence` (0162); same refusals, same answer. */
export async function linkEvidence(
  input: { ref_ids: string[]; trx_nos: string[] },
  idempotencyKey?: string,
): Promise<Result<{ trx_nos: string[]; rows: number; rows_total: number }>> {
  await latency();
  const refs = [...new Set(input.ref_ids.map((r) => r.trim()).filter(Boolean))];
  const trxNos = [...new Set(input.trx_nos.map((t) => t.trim()).filter(Boolean))];
  const endpoint = `linkEvidence:${refs[0] ?? ""}`;
  const cached = replayed<{ trx_nos: string[]; rows: number; rows_total: number }>(
    SERVICE, endpoint, idempotencyKey);
  if (cached) return cached;

  const denied = requireAuthority(SERVICE, "resolve_inbox");
  if (denied) return denied;
  if (refs.length === 0) {
    return invalid(SERVICE, "ref_required", "Say which inbox document this is.", { field: "ref_ids" });
  }
  if (trxNos.length === 0) {
    return invalid(SERVICE, "trx_required",
      "Which ledger rows is this the proof of? Pick at least one.", { field: "trx_nos" });
  }

  const state = getState();
  const rows = refs.map((r) => state.evidence_inbox.find((x) => x.ref_id === r));
  if (rows.some((r) => !r)) {
    return notFound(SERVICE, "inbox_row_not_found", "Some of the inbox rows named do not exist.");
  }
  if (rows.some((r) => r!.status !== "PENDING")) {
    return conflict(SERVICE, "already_resolved",
      "Part of this document is already decided — nothing changed. Reload the queue.");
  }
  if (new Set(rows.map((r) => r!.attachment_id)).size > 1) {
    return invalid(SERVICE, "not_one_document",
      "These inbox rows are different files. Only rows of the same photo can be linked as one document.",
      { field: "ref_ids" });
  }
  const missing = trxNos.filter((t) => !state.transactions.some((x) => x.trx_no === t));
  if (missing.length > 0) {
    return invalid(SERVICE, "no_such_transaction",
      `There is no ledger row ${missing.join(", ")}.`, { field: "trx_nos", missing });
  }

  const head = rows[0]!;
  const kind: DocKind = /payment|transfer|bukti/i.test(head.extracted.doc_type ?? "")
    ? "Payment Proof" : "Receipt / Invoice / Nota";
  for (const trxNo of trxNos) {
    const linked = await linkDocument({
      attachment_id: head.attachment_id, entity: "transaction", entity_no: trxNo, kind,
    });
    if (linked.error && linked.error.status !== 409) return linked;
  }

  const rowsTotal = trxNos.reduce(
    (n, t) => n + (state.transactions.find((x) => x.trx_no === t)?.amount_idr ?? 0), 0);
  apply((draft) => {
    const trxId = draft.transactions.find((t) => t.trx_no === trxNos[0])?.id ?? null;
    for (const ref of refs) {
      const r = draft.evidence_inbox.find((x) => x.ref_id === ref)!;
      r.status = "ATTACHED";
      r.produced_trx_id = trxId;
    }
    writeAudit(draft, {
      service: SERVICE, entity: "evidence_inbox", entity_no: refs[0],
      action: "link", outcome: "ok", reason: null,
      detail: { status_before: "PENDING", status_after: "ATTACHED", trx_nos: trxNos },
    });
    writeOutbox(draft, {
      service: SERVICE, event_type: "accounting.inbox.resolved",
      payload: { ref_id: refs[0], ref_ids: refs, resolution: "link", trx_nos: trxNos },
    });
  });

  const answer = { trx_nos: trxNos, rows: trxNos.length, rows_total: rowsTotal };
  remember(SERVICE, endpoint, idempotencyKey, answer);
  return ok(SERVICE, answer);
}

export async function resolveInbox(
  input: {
    ref_id: string;
    resolution: "transaction" | "retro_pr_line" | "link" | "note" | "reject";
    /** What it produced, when it produced something. */
    trx_no?: string;
    pr_line_no?: string;
    /** Mandatory for `reject` and `note`: a row nobody explained is a row
     *  nobody can review. */
    reason?: string;
  },
  idempotencyKey?: string,
): Promise<Result<EvidenceInboxRow>> {
  await latency();
  const endpoint = `resolveInbox:${input.ref_id}`;
  const cached = replayed<EvidenceInboxRow>(SERVICE, endpoint, idempotencyKey);
  if (cached) return cached;

  const denied = requireAuthority(SERVICE, "resolve_inbox");
  if (denied) return denied;

  const state = getState();
  const row = state.evidence_inbox.find((r) => r.ref_id === input.ref_id);
  if (!row) return notFound(SERVICE, "inbox_row_not_found", `Row ${input.ref_id} not found.`);
  if (row.status !== "PENDING") {
    return conflict(SERVICE, "already_resolved", `This row is already ${row.status} — nothing changed.`);
  }
  if ((input.resolution === "reject" || input.resolution === "note") && !input.reason?.trim()) {
    return invalid(
      SERVICE, "reason_required",
      input.resolution === "reject"
        ? "Say why this is not ours. A rejection nobody explained cannot be reviewed later."
        : "Say what this is. A note with no words is a file in a drawer.",
      { field: "reason" },
    );
  }
  if ((input.resolution === "transaction" || input.resolution === "link") && !input.trx_no) {
    return invalid(SERVICE, "trx_required", "Which ledger row does this belong to?", { field: "trx_no" });
  }

  const nextStatus = {
    transaction: "CONFIRMED", retro_pr_line: "CONFIRMED", link: "ATTACHED",
    note: "NOTED", reject: "REJECTED",
  }[input.resolution] as EvidenceInboxRow["status"];

  apply((draft) => {
    const r = draft.evidence_inbox.find((x) => x.ref_id === input.ref_id)!;
    r.status = nextStatus;
    if (input.trx_no) {
      r.produced_trx_id = draft.transactions.find((t) => t.trx_no === input.trx_no)?.id ?? null;
    }
    if (input.pr_line_no) r.produced_pr_line_no = input.pr_line_no;
    if (input.reason?.trim()) {
      r.extracted = { ...r.extracted, note: input.reason.trim() };
    }
    writeAudit(draft, {
      service: SERVICE, entity: "evidence_inbox", entity_no: input.ref_id,
      action: `resolve.${input.resolution}`, outcome: "ok", reason: input.reason?.trim() ?? null,
      detail: {
        status_before: row.status, status_after: nextStatus,
        trx_no: input.trx_no ?? null, pr_line_no: input.pr_line_no ?? null,
        amount_read: row.extracted.amount_idr ?? null,
      },
    });
    writeOutbox(draft, {
      service: SERVICE, event_type: "accounting.inbox.resolved",
      payload: { ref_id: input.ref_id, resolution: input.resolution, trx_no: input.trx_no ?? null },
    });
  });

  const finalState = getState();
  const updated = withReporterName(finalState, finalState.evidence_inbox.find((r) => r.ref_id === input.ref_id)!);
  remember(SERVICE, endpoint, idempotencyKey, updated);
  return ok(SERVICE, updated);
}

/** Everything the inbox has ever held, resolved or not — because "what did we
 *  decide about that photo" is asked long after the row leaves the queue. */
export async function listInboxAll(): Promise<Result<EvidenceInboxRow[]>> {
  await latency();
  const state = getState();
  return ok(SERVICE, [...state.evidence_inbox]
    .sort((a, b) => b.reported_at.localeCompare(a.reported_at))
    .map((r) => withReporterName(state, r)));
}

/** The last `limit` decided rows, newest first, with the total. */
export async function listInboxDecided(limit = 20): Promise<Result<EvidenceInboxRow[]>> {
  await latency();
  const state = getState();
  const decided = state.evidence_inbox
    .filter((r) => r.status !== "PENDING")
    .sort((a, b) => b.reported_at.localeCompare(a.reported_at));
  return ok(SERVICE, decided.slice(0, limit).map((r) => withReporterName(state, r)), {
    limit, cursor: null, has_more: decided.length > limit, total: decided.length,
  });
}

/** Every payment made to one vendor, newest first, with what each one closed.
 *
 *  Read from the ledger rather than from procurement's side, because a payment
 *  is a ledger fact — and because the proof lives on the transaction (D85).
 *  The purchase journey screen puts this beside the orders; neither service
 *  reaches into the other (ADR-004).
 */
export async function paymentsForVendor(vendorId: string): Promise<Result<VendorPayment[]>> {
  await latency();
  const state = getState();
  const readable = readableAccountIds(state);
  const rows = state.transactions
    .filter((t) => t.vendor_id === vendorId && t.direction === "OUT" && readable.has(t.account_id))
    .map((t) => {
      const link = state.attachment_links.find(
        (l) => l.entity === "transaction" && l.entity_no === t.trx_no && l.kind === "Payment Proof",
      );
      const att = link ? state.attachments.find((a) => a.id === link.attachment_id) : undefined;
      return {
        trx_no: t.trx_no,
        trx_date: t.trx_date,
        amount: t.amount_idr,
        description: t.description,
        status: t.status,
        applies_to: state.payment_allocations
          .filter((a) => a.trx_id === t.id && a.superseded_by === null && a.po_no)
          .map((a) => ({ po_no: a.po_no as string, amount: a.amount })),
        proof_attachment_id: att?.id ?? null,
        proof_filename: att?.filename ?? null,
      };
    })
    .sort((a, b) => a.trx_date.localeCompare(b.trx_date) || a.trx_no.localeCompare(b.trx_no));
  return ok(SERVICE, rows);
}

/* ------------------------------------------------------------------ */
/* Money coming IN — the second road (D81)                             */
/* ------------------------------------------------------------------ */

/** Money already booked into a paying account, with whatever proof is on it.
 *
 *  The round screen reads this rather than asking somebody to retype an
 *  amount that is already in the ledger. Filtered to IN rows on the account
 *  that pays suppliers, newest first.
 */
export async function listIncoming(
  opts: { account_code?: string } = {},
): Promise<Result<IncomingMoney[]>> {
  await latency();
  const state = getState();
  const code = opts.account_code ?? "BCA 271";
  const rows = state.transactions
    .filter((t) => t.direction === "IN" && t.status !== "VOID")
    .filter((t) => state.accounts.find((a) => a.id === t.account_id)?.code === code)
    .map((t) => {
      const link = state.attachment_links.find(
        (l) => l.entity === "transaction" && l.entity_no === t.trx_no && l.kind === "Payment Proof",
      );
      const att = link ? state.attachments.find((a) => a.id === link.attachment_id) : undefined;
      return {
        trx_no: t.trx_no,
        trx_date: t.trx_date,
        account_code: code,
        amount_idr: t.amount_idr,
        description: t.description,
        proof_attachment_id: att?.id ?? null,
        proof_filename: att?.filename ?? null,
      };
    })
    .sort((a, b) => b.trx_date.localeCompare(a.trx_date) || b.trx_no.localeCompare(a.trx_no));
  return ok(SERVICE, rows);
}

/** Rows waiting in the inbox that are money coming IN.
 *
 *  Almost everything in that inbox is somebody who bought first. A transfer
 *  proof dropped in chat by leadership is the other direction, and it is
 *  waiting for a different act by a different person — booking it, not
 *  matching it to a purchase. */
export async function listIncomingReview(): Promise<Result<EvidenceInboxRow[]>> {
  await latency();
  const state = getState();
  return ok(SERVICE, state.evidence_inbox
    .filter((r) => r.status === "PENDING" && r.money_direction === "IN")
    .map((r) => withReporterName(state, r)));
}

/** Book a chat-uploaded transfer proof as money in.
 *
 *  One act: the IN transaction, the document linked to it, and the inbox row
 *  closed with a pointer to what it produced. The amount is confirmed by a
 *  person rather than taken from the extraction — the reading is a proposal,
 *  never a posting (A13).
 */
export async function confirmIncoming(
  input: { ref_id: string; account_id: string; trx_date: string; amount_idr: number; description?: string },
  idempotencyKey?: string,
): Promise<Result<IncomingMoney>> {
  await latency();
  const endpoint = `confirmIncoming:${input.ref_id}`;
  const cached = replayed<IncomingMoney>(SERVICE, endpoint, idempotencyKey);
  if (cached) return cached;

  const denied = requireAuthority(SERVICE, "post_ledger");
  if (denied) return denied;

  const state = getState();
  const row = state.evidence_inbox.find((r) => r.ref_id === input.ref_id);
  if (!row) return notFound(SERVICE, "inbox_row_not_found", `Row ${input.ref_id} not found.`);
  if (row.status !== "PENDING") {
    return conflict(SERVICE, "already_resolved", `This row is already ${row.status} — nothing changed.`);
  }
  if (input.amount_idr <= 0) {
    return invalid(SERVICE, "amount_positive", "Amount must be greater than zero.", { field: "amount_idr" });
  }

  const sourceRef = `inbox-in:${input.ref_id}`;
  const existing = state.transactions.find((t) => t.source_ref === sourceRef);
  if (existing) {
    return conflict(SERVICE, "already_posted", `Already booked as ${existing.trx_no} — nothing changed.`, { trx_no: existing.trx_no });
  }

  const user = actingUser();
  let trxNo = "";
  apply((draft) => {
    trxNo = nextDocNumber(draft, "trx");
    const trxId = newId("trx");
    draft.transactions.unshift({
      id: trxId, trx_no: trxNo, trx_date: input.trx_date,
      account_id: input.account_id, direction: "IN", amount_idr: input.amount_idr,
      type_code: "CASHFLOW", vendor_id: null, project_id: null,
      description: input.description?.trim() || row.extracted.note || "Money in, confirmed from chat",
      remark: null, status: "POSTED", source_ref: sourceRef,
      posted_by: user.id, posted_at: new Date().toISOString(), void_reason: null,
    });
    /* The proof follows the money onto the ledger row, so the transaction can
       be read on its own without going back to the inbox. */
    draft.attachment_links.push({
      id: newId("lnk"), attachment_id: row.attachment_id,
      entity: "transaction", entity_no: trxNo, kind: "Payment Proof",
      linked_by: user.id, linked_at: new Date().toISOString(),
    });
    const r = draft.evidence_inbox.find((x) => x.ref_id === input.ref_id)!;
    r.status = "CONFIRMED";
    r.produced_trx_id = trxId;
    writeAudit(draft, {
      service: SERVICE, entity: "evidence_inbox", entity_no: input.ref_id,
      action: "confirm_incoming", outcome: "ok", reason: trxNo,
    });
    writeOutbox(draft, {
      service: SERVICE, event_type: "accounting.transaction.posted",
      payload: { trx_no: trxNo, amount: input.amount_idr, direction: "IN" },
    });
  });

  const state2 = getState();
  const att = state2.attachments.find((a) => a.id === row.attachment_id);
  const view: IncomingMoney = {
    trx_no: trxNo,
    trx_date: input.trx_date,
    account_code: state2.accounts.find((a) => a.id === input.account_id)?.code ?? "",
    amount_idr: input.amount_idr,
    description: state2.transactions.find((t) => t.trx_no === trxNo)!.description,
    proof_attachment_id: row.attachment_id,
    proof_filename: att?.filename ?? null,
  };
  remember(SERVICE, endpoint, idempotencyKey, view);
  return ok(SERVICE, view);
}

/** Used by the PR line drawer: how much of this line has money against it. */
export async function coverageFor(lineNoFull: string): Promise<Result<ReturnType<typeof lineCoverage>>> {
  await latency();
  const state = getState();
  const line = state.pr_lines.find((l) => l.line_no_full === lineNoFull);
  if (!line) return notFound(SERVICE, "line_not_found", `Line ${lineNoFull} not found.`);
  return ok(SERVICE, lineCoverage(state, line));
}

export type { Transaction };

/** Post a ledger row FROM a paid purchase-request line.
 *
 *  The owner's rule: a request that has been paid, whose document is uploaded
 *  here, is the same event as the ledger entry — supporting document and PR
 *  number included. So this does the whole thing in one act: it posts the
 *  transaction, allocates it to the line, and carries the document across.
 *  Doing it in three separate steps is how two of them get skipped.
 *
 *  The PR number goes in the description and in the allocation, so the ledger
 *  row can say what it was for without anyone opening procurement.
 */
export async function postFromLine(
  input: {
    line_no: string;
    amount: number;
    account_id: string;
    trx_date: string;
    type_code: TransactionTypeCode;
    /** Required (D85). Paying from a line without the transfer proof is the
     *  same empty row as any other undocumented posting. */
    attachment_id: string;
    document_kind?: DocKind;
  },
  idempotencyKey?: string,
): Promise<Result<TransactionView>> {
  await latency();
  const endpoint = `postFromLine:${input.line_no}`;
  const cached = replayed<TransactionView>(SERVICE, endpoint, idempotencyKey);
  if (cached) return cached;

  const denied = requireAuthority(SERVICE, "post_ledger");
  if (denied) return denied;

  /* Validated at the seam rather than by reaching into procurement's tables
   * (ADR-004). In Phase 2 this line is a fetch. */
  const lineRes = await procurement.lineForPosting(input.line_no);
  if (lineRes.error) return lineRes.error.code === "line_not_found"
    ? invalid(SERVICE, "pr_line_not_found", `Line ${input.line_no} does not exist in procurement.`, { field: "line_no" })
    : lineRes as unknown as Result<TransactionView>;
  const line = lineRes.data;
  if (line.removed) {
    return conflict(SERVICE, "line_removed", `Line ${input.line_no} has been removed.`);
  }
  if (input.amount <= 0) {
    return invalid(SERVICE, "amount_positive", "Amount must be greater than zero.", { field: "amount" });
  }
  if (!input.attachment_id) {
    return invalid(
      SERVICE, "evidence_required",
      "A payment needs its proof. Attach the transfer receipt or the nota before recording it.",
      { field: "attachment_id" },
    );
  }

  const sourceRef = `pr-line:${input.line_no}:${input.trx_date}:${input.amount}`;
  const existing = getState().transactions.find((t) => t.source_ref === sourceRef);
  if (existing) {
    return conflict(SERVICE, "already_posted", `Already posted as ${existing.trx_no} — nothing changed.`, { trx_no: existing.trx_no });
  }

  const user = actingUser();
  let trxNo = "";
  apply((draft) => {
    trxNo = nextDocNumber(draft, "trx");
    const trxId = newId("trx");
    draft.transactions.unshift({
      id: trxId, trx_no: trxNo, trx_date: input.trx_date,
      account_id: input.account_id, direction: "OUT", amount_idr: input.amount,
      type_code: input.type_code, vendor_id: line.vendor_id,
      project_id: line.project_id,
      /* The PR number lives in the description too, so the ledger reads
       * correctly on its own. */
      description: `${line.description} — ${input.line_no}`,
      remark: null, status: "POSTED", source_ref: sourceRef,
      posted_by: user.id, posted_at: new Date().toISOString(), void_reason: null,
    });
    draft.payment_allocations.push({
      id: newId("alc"), trx_id: trxId, pr_line_no: input.line_no, po_no: orderPaidByLine(draft, input.line_no),
      amount: input.amount, method: "transfer", superseded_by: null,
      allocated_by: user.id, allocated_at: new Date().toISOString(),
    });
    /* The detail comes from the line itself: what was bought, how many, at
       what price — so the ledger row can be read without opening the PR. */
    draft.transaction_lines.push({
      /* The request line's item rides along (0272), so the catalogue learns
         the price that was really paid (D86). */
      id: newId("trl"), trx_id: trxId, line_no: 1, kind: "item", item_id: line.item_id ?? null,
      /* A lump-sum line has no quantity (D75); its payment is described as
         1 lot at the amount paid, the same as `post_from_line` (0141, D298). */
      description: line.description,
      qty: line.qty ?? 1, uom: (line.qty == null ? "lot" : line.uom) as never,
      unit_price: line.qty == null ? input.amount : line.unit_price, amount: input.amount,
    });
    draft.attachment_links.push({
      id: newId("lnk"), attachment_id: input.attachment_id,
      entity: "transaction", entity_no: trxNo, kind: input.document_kind ?? "Payment Proof",
      linked_by: user.id, linked_at: new Date().toISOString(),
    });
    writeAudit(draft, {
      service: SERVICE, entity: "transaction", entity_no: trxNo,
      action: "post_from_line", outcome: "ok", reason: input.line_no,
      detail: {
        amount: input.amount, pr_line: input.line_no,
        account: draft.accounts.find((a) => a.id === input.account_id)?.code ?? null,
        type: input.type_code, document: input.document_kind ?? "Payment Proof",
      },
    });
    writeOutbox(draft, {
      service: SERVICE, event_type: "accounting.transaction.posted",
      payload: { trx_no: trxNo, pr_line_no: input.line_no, amount: input.amount },
    });
  });

  const state = getState();
  const view = transactionView(state, state.transactions.find((t) => t.trx_no === trxNo)!);
  remember(SERVICE, endpoint, idempotencyKey, view);
  return ok(SERVICE, view);
}

/* ------------------------------------------------------------------ */
/* Liquidation                                                         */
/* ------------------------------------------------------------------ */

/** Every transfer of operating money into an account that pays people,
 *  newest first — the list the liquidation report opens from (D106). */

/** `ops_acct.post_payroll_run` (0149): one OUT row for an approved run, and
 *  the run marked PAID. The amount is not checked against the run while Q56
 *  (which figure a run pays) is open. */
export async function postPayrollRun(
  input: {
    run_no: string;
    amount: number;
    account_id: string;
    trx_date: string;
    attachment_id: string;
    type_code?: TransactionTypeCode;
  },
  idempotencyKey?: string,
): Promise<Result<TransactionView>> {
  await latency();
  const endpoint = `postPayrollRun:${input.run_no}`;
  const cached = replayed<TransactionView>(SERVICE, endpoint, idempotencyKey);
  if (cached) return cached;

  const denied = requireAuthority(SERVICE, "post_ledger");
  if (denied) return denied;

  const state = getState();
  const run = state.payroll_runs.find((r) => r.run_no === input.run_no);
  if (!run) return invalid(SERVICE, "run_not_found", `Tidak ada run gaji ${input.run_no}.`, { field: "run_no" });
  if (run.status === "DRAFT") {
    return conflict(SERVICE, "not_approved", "Belum ada yang menandatangani run ini. Gaji dibayar setelah disetujui, bukan sebelum.");
  }
  if (run.status === "PAID") {
    return conflict(SERVICE, "already_paid", `${input.run_no} sudah dibayar lewat ${run.paid_trx_no}.`);
  }
  if (!(input.amount > 0)) {
    return invalid(SERVICE, "amount_positive", "A payment is more than nothing.", { field: "amount" });
  }
  if (!input.attachment_id) {
    return invalid(SERVICE, "evidence_required",
      "A payment needs its proof. Attach the transfer receipt before recording it.", { field: "attachment_id" });
  }
  const days = (Date.parse(run.period_end) - Date.parse(run.period_start)) / 86_400_000;
  const type = input.type_code
    ?? (days <= 7 ? "RECCURING - PAYROLL WEEKLY" : "RECCURING - PAYROLL MONTHLY");

  const user = actingUser();
  let trxNo = "";
  apply((draft) => {
    trxNo = nextDocNumber(draft, "trx");
    const trxId = newId("trx");
    const now = new Date().toISOString();
    draft.transactions.unshift({
      id: trxId, trx_no: trxNo, trx_date: input.trx_date,
      account_id: input.account_id, direction: "OUT", amount_idr: input.amount,
      type_code: type, vendor_id: null, project_id: null,
      description: `Gaji ${input.run_no} (${run.period_start} s/d ${run.period_end})`,
      remark: null, status: "POSTED", source_ref: `payroll:${input.run_no}`,
      posted_by: user.id, posted_at: now, void_reason: null,
    });
    draft.attachment_links.push({
      id: newId("lnk"), attachment_id: input.attachment_id,
      entity: "transaction", entity_no: trxNo, kind: "Payment Proof",
      linked_by: user.id, linked_at: now,
    });
    const r = draft.payroll_runs.find((x) => x.run_no === input.run_no)!;
    r.status = "PAID";
    r.paid_trx_no = trxNo;
    writeAudit(draft, {
      service: SERVICE, entity: "transaction", entity_no: trxNo,
      action: "post_payroll_run", outcome: "ok", reason: input.run_no,
      detail: { amount: input.amount, run_no: input.run_no, type },
    });
    writeOutbox(draft, {
      service: "hr", event_type: "payroll.paid",
      payload: { run_no: input.run_no, trx_no: trxNo, amount: input.amount },
    });
  });

  const view = transactionView(getState(), getState().transactions.find((t) => t.trx_no === trxNo)!);
  remember(SERVICE, endpoint, idempotencyKey, view);
  return ok(SERVICE, view);
}

/** Paying an order from its own screen (B8) — the demo twin of
 *  `ops_acct.post_to_po` (0139). One ledger row; the amount split across the
 *  order's linked request lines by value, the rest on the order alone. */
export async function postToPo(
  input: {
    po_no: string;
    amount: number;
    account_id: string;
    trx_date: string;
    type_code: TransactionTypeCode;
    attachment_id: string;
    document_kind?: DocKind;
  },
  idempotencyKey?: string,
): Promise<Result<TransactionView>> {
  await latency();
  const endpoint = `postToPo:${input.po_no}`;
  const cached = replayed<TransactionView>(SERVICE, endpoint, idempotencyKey);
  if (cached) return cached;

  const denied = requireAuthority(SERVICE, "post_ledger");
  if (denied) return denied;

  const state = getState();
  const po = state.purchase_orders.find((p) => p.po_no === input.po_no);
  if (!po) return invalid(SERVICE, "po_not_found", `Order ${input.po_no} does not exist.`, { field: "po_no" });
  if (po.status === "DRAFT") {
    return conflict(SERVICE, "not_issued", `${input.po_no} has not been issued — nothing is owed on an order the vendor has not received.`);
  }
  if (po.status === "CLOSED" || po.status === "CANCELLED") {
    return conflict(SERVICE, "order_closed", `${input.po_no} is ${po.status.toLowerCase()}.`);
  }
  if (!(input.amount > 0)) {
    return invalid(SERVICE, "amount_positive", "A payment is more than nothing.", { field: "amount" });
  }
  const live = state.po_lines.filter((l) => l.po_id === po.id && l.superseded_by === null);
  const contract = live.reduce((t, l) => t + l.line_total, 0);
  const paid = state.payment_allocations
    .filter((a) => a.superseded_by === null && a.po_no === po.po_no
      && state.transactions.find((t) => t.id === a.trx_id)?.status !== "VOID")
    .reduce((t, a) => t + a.amount, 0);
  const outstanding = Math.max(contract - paid, 0);
  if (input.amount > outstanding) {
    return invalid(SERVICE, "over_contract",
      `Only ${outstanding} is still outstanding on ${input.po_no}. Money beyond the contract is a question for the vendor, not a payment on this order.`,
      { field: "amount", outstanding });
  }
  if (!input.attachment_id) {
    return invalid(SERVICE, "evidence_required",
      "A payment needs its proof. Attach the transfer receipt before recording it.", { field: "attachment_id" });
  }

  const user = actingUser();
  let trxNo = "";
  apply((draft) => {
    trxNo = nextDocNumber(draft, "trx");
    const trxId = newId("trx");
    const now = new Date().toISOString();
    draft.transactions.unshift({
      id: trxId, trx_no: trxNo, trx_date: input.trx_date,
      account_id: input.account_id, direction: "OUT", amount_idr: input.amount,
      type_code: input.type_code, vendor_id: po.vendor_id, project_id: null,
      description: `Pembayaran ${input.po_no}`,
      remark: null, status: "POSTED", source_ref: `po:${input.po_no}:${input.trx_date}:${input.amount}`,
      posted_by: user.id, posted_at: now, void_reason: null,
    });
    /* The whole contract on an unpaid order: one ledger line per order line,
       with its item, and a rounding/discount line if the money differs. A
       term payment stays one generic `other` line — a deposit is money, not
       goods (A1, 0272). */
    const full = paid <= 0 && contract > 0 && Math.abs(input.amount - contract) <= 1;
    if (full) {
      live.forEach((l, i) => {
        draft.transaction_lines.push({
          id: newId("trl"), trx_id: trxId, line_no: i + 1, kind: "item", item_id: l.item_id ?? null,
          description: l.description, qty: l.qty, uom: l.uom, unit_price: l.unit_price, amount: l.line_total,
        });
      });
      const linesTotal = live.reduce((t, l) => t + l.line_total, 0);
      if (input.amount !== linesTotal) {
        draft.transaction_lines.push({
          id: newId("trl"), trx_id: trxId, line_no: live.length + 1,
          kind: input.amount > linesTotal ? "other" : "discount", item_id: null,
          description: input.amount > linesTotal ? `Selisih pembayaran ${input.po_no}` : `Potongan atas ${input.po_no}`,
          qty: null, uom: null, unit_price: null, amount: Math.abs(input.amount - linesTotal),
        });
      }
    } else {
      draft.transaction_lines.push({
        id: newId("trl"), trx_id: trxId, line_no: 1, kind: "other", item_id: null,
        description: `Pembayaran ${input.po_no}`, qty: 1, uom: "unit" as never,
        unit_price: input.amount, amount: input.amount,
      });
    }
    let spent = 0;
    for (const l of live) {
      if (!l.pr_line_id || contract <= 0) continue;
      const lineNo = draft.pr_lines.find((p) => p.id === l.pr_line_id)?.line_no_full;
      const share = Math.min(Math.round(input.amount * l.line_total / contract), input.amount - spent);
      if (!lineNo || share <= 0) continue;
      draft.payment_allocations.push({
        id: newId("alc"), trx_id: trxId, pr_line_no: lineNo, po_no: input.po_no,
        amount: share, method: "transfer", superseded_by: null, allocated_by: user.id, allocated_at: now,
      });
      spent += share;
    }
    if (input.amount - spent > 0) {
      draft.payment_allocations.push({
        id: newId("alc"), trx_id: trxId, pr_line_no: null, po_no: input.po_no,
        amount: input.amount - spent, method: "transfer", superseded_by: null, allocated_by: user.id, allocated_at: now,
      });
    }
    draft.attachment_links.push({
      id: newId("lnk"), attachment_id: input.attachment_id,
      entity: "transaction", entity_no: trxNo, kind: input.document_kind ?? "Payment Proof",
      linked_by: user.id, linked_at: now,
    });
    writeAudit(draft, {
      service: SERVICE, entity: "transaction", entity_no: trxNo,
      action: "post_to_po", outcome: "ok", reason: input.po_no,
      detail: { amount: input.amount, po_no: input.po_no, type: input.type_code },
    });
    writeOutbox(draft, {
      service: SERVICE, event_type: "accounting.allocation.recorded",
      payload: { trx_no: trxNo, po_no: input.po_no, amount: input.amount },
    });
  });

  const view = transactionView(getState(), getState().transactions.find((t) => t.trx_no === trxNo)!);
  remember(SERVICE, endpoint, idempotencyKey, view);
  return ok(SERVICE, view);
}

export async function listFundings(): Promise<Result<FundingView[]>> {
  await latency();
  return ok(SERVICE, fundings(getState()));
}

/** Month × category, per project, per vendor and transfers for one year
 *  (0274), from the same parts the database's `v_category_part` makes. */
export async function getCategorySummary(year: string): Promise<Result<CategorySummary>> {
  await latency();
  return ok(SERVICE, categorySummary(getState(), year));
}

/** *Berapa bulan* (L10): the same arithmetic as the real side, over the
 *  sandbox's months and balances. */
export async function getRunway(): Promise<Result<Runway>> {
  await latency();
  const state = getState();
  const today = officeToday();
  const year = today.slice(0, 4);
  const months = [...categorySummary(state, year).months, ...categorySummary(state, String(Number(year) - 1)).months];
  return ok(SERVICE, runwayFrom({ today, months, balances: accountBalances(state) }));
}

/** One transfer and where it went. */
export async function getFunding(trxNo: string): Promise<Result<FundingDetail>> {
  await latency();
  const state = getState();
  const trx = state.transactions.find((t) => t.trx_no === trxNo && t.direction === "IN");
  if (!trx) return notFound(SERVICE, "funding_not_found", `No incoming transfer ${trxNo}.`);
  return ok(SERVICE, fundingView(state, trx));
}

/* ------------------------------------------------------------------ */
/* Payment calendar                                                    */
/* ------------------------------------------------------------------ */

/** Twelve months forward: what is planned, what actually happened, and
 *  whether the money lasts (D109). */
export async function getCashPlan(): Promise<Result<CashPlan>> {
  await latency();
  return ok(SERVICE, cashPlan(getState()));
}

/** What falls due next, and what is already late. */
export async function listDue(): Promise<Result<CashDue[]>> {
  await latency();
  return ok(SERVICE, cashDue(getState()));
}

export async function listComponents(): Promise<Result<CashComponent[]>> {
  await latency();
  return ok(SERVICE, getState().cash_components);
}

/** Add something that repeats.
 *
 *  Refuses a category another component already claims (D110): with two
 *  components on `RECCURING - PAYROLL`, no ledger row could say which of them
 *  it belongs to, and the plan would show the same money twice.
 */
export async function addComponent(
  input: {
    name: string;
    direction: Direction;
    amount: number;
    frequency?: CashFrequency;
    due_day?: number;
    due_weekday?: number | null;
    due_date?: string | null;
    type_code?: TransactionTypeCode | null;
    vendor_id?: string | null;
    account_id?: string | null;
    starts_on?: string;
    ends_on?: string | null;
    note?: string | null;
    amount_kind?: CashAmountKind;
  },
  idempotencyKey?: string,
): Promise<Result<CashComponent>> {
  await latency();
  const cached = replayed<CashComponent>(SERVICE, "addComponent", idempotencyKey);
  if (cached) return cached;

  /* Q24 (D233): the estimates on the cash calendar belong to leadership alone.
     Enforced at the module **level** rather than by an authority, for the same
     reason D24 gives: who counts as leadership is a grant somebody made, not
     something to infer in code from holding `approve_funds` — accounting holds
     that too. Accounting keeps `write` and therefore keeps reading the plan and
     booking real payments against it; only `admin` may move the estimate. */
  const denied = requireLevel(SERVICE, "accounting", "admin");
  if (denied) return denied;

  const frequency: CashFrequency = input.frequency ?? "monthly";

  if (!input.name.trim()) {
    return invalid(SERVICE, "name_required", "A line on the calendar needs a name somebody will recognise.", { field: "name" });
  }
  if (!input.amount || input.amount <= 0) {
    return invalid(SERVICE, "amount_required", "An estimate of zero plans nothing. Put the number you expect, even roughly.", { field: "amount" });
  }
  if (frequency === "monthly" && (!input.due_day || input.due_day < 1 || input.due_day > 31)) {
    return invalid(SERVICE, "due_day_out_of_range", "The day of the month it is due, between 1 and 31.", { field: "due_day" });
  }
  if (frequency === "weekly" && (input.due_weekday == null || input.due_weekday < 0 || input.due_weekday > 6)) {
    return invalid(SERVICE, "weekday_required", "Which day of the week it goes out.", { field: "due_weekday" });
  }
  if (frequency === "once" && !/^\d{4}-\d{2}-\d{2}$/.test(input.due_date ?? "")) {
    return invalid(
      SERVICE, "date_required",
      "A one-off has a date — that is the whole difference between it and a bill that repeats.",
      { field: "due_date" },
    );
  }

  const state = getState();
  /* Two *standing* lines may not claim one category: no ledger row could say
     which of them it paid (D110). A one-off may share a category with a
     standing line, because it is dated and claims first — which is exactly
     what "pelunasan kartu kredit, bukan cicilan" is (D113). */
  const clash = frequency === "once" ? undefined : state.cash_components.find(
    (c) => c.active
      && c.frequency !== "once"
      && c.type_code !== null
      && c.type_code === (input.type_code ?? null)
      && (c.vendor_id ?? null) === (input.vendor_id ?? null),
  );
  if (clash) {
    return conflict(
      SERVICE, "category_already_tracked",
      `"${clash.name}" already tracks ${clash.type_code}${clash.vendor_id ? " for that vendor" : ""}. Two standing lines on one category means no ledger row can say which one it paid — change this one's category, make it a one-off with a date, or edit that line instead.`,
      { component_id: clash.id },
    );
  }

  const user = actingUser();
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  let created: CashComponent | null = null;
  apply((draft) => {
    const row: CashComponent = {
      id: newId("cmp"),
      name: input.name.trim(),
      direction: input.direction,
      amount: Math.round(input.amount),
      frequency,
      due_day: frequency === "once"
        ? Number((input.due_date ?? "").slice(8, 10))
        : input.due_day ?? 1,
      due_weekday: frequency === "weekly" ? input.due_weekday ?? null : null,
      due_date: frequency === "once" ? input.due_date ?? null : null,
      type_code: input.type_code ?? null,
      vendor_id: input.vendor_id ?? null,
      account_id: input.account_id ?? null,
      scheme_codes: [],
      amount_kind: input.amount_kind ?? "fixed",
      starts_on: frequency === "once"
        ? (input.due_date ?? thisMonth).slice(0, 7)
        : input.starts_on ?? thisMonth,
      ends_on: frequency === "once"
        ? (input.due_date ?? thisMonth).slice(0, 7)
        : input.ends_on ?? null,
      note: input.note?.trim() || null,
      active: true,
      created_by: user.id,
      created_at: now.toISOString(),
    };
    draft.cash_components.push(row);
    created = row;
    writeAudit(draft, {
      service: SERVICE, entity: "cash_component", entity_no: row.id,
      action: "create", outcome: "ok", reason: null,
      detail: {
        name: row.name, amount: row.amount, frequency: row.frequency,
        due: row.due_date ?? (row.frequency === "weekly" ? `weekday ${row.due_weekday}` : `day ${row.due_day}`),
        direction: row.direction,
      },
    });
  });
  const view = created as CashComponent | null;
  if (!view) return invalid(SERVICE, "not_created", "The line could not be written.", { field: "name" });
  remember(SERVICE, "addComponent", idempotencyKey, view);
  return ok(SERVICE, view);
}

/** Change the estimate, the day, or the name. The audit row carries what it
 *  was and what it became — a budget nobody can see the history of is a budget
 *  people quietly bend (D84). */
export async function updateComponent(
  id: string,
  patch: {
    name?: string; amount?: number; due_day?: number; ends_on?: string | null;
    note?: string | null; active?: boolean; amount_kind?: CashAmountKind;
  },
): Promise<Result<CashComponent>> {
  await latency();
  /* Q24 (D233): the estimates on the cash calendar belong to leadership alone.
     Enforced at the module **level** rather than by an authority, for the same
     reason D24 gives: who counts as leadership is a grant somebody made, not
     something to infer in code from holding `approve_funds` — accounting holds
     that too. Accounting keeps `write` and therefore keeps reading the plan and
     booking real payments against it; only `admin` may move the estimate. */
  const denied = requireLevel(SERVICE, "accounting", "admin");
  if (denied) return denied;

  const state = getState();
  const found = state.cash_components.find((c) => c.id === id);
  if (!found) return notFound(SERVICE, "component_not_found", `No calendar line ${id}.`);
  if (patch.amount !== undefined && patch.amount <= 0) {
    return invalid(SERVICE, "amount_required", "An estimate of zero plans nothing.", { field: "amount" });
  }
  if (patch.due_day !== undefined && (patch.due_day < 1 || patch.due_day > 31)) {
    return invalid(SERVICE, "due_day_out_of_range", "The day of the month it is due, between 1 and 31.", { field: "due_day" });
  }

  let updated: CashComponent | null = null;
  apply((draft) => {
    const row = draft.cash_components.find((c) => c.id === id);
    if (!row) return;
    const before = { name: row.name, amount: row.amount, due_day: row.due_day, active: row.active };
    Object.assign(row, {
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
      ...(patch.amount !== undefined ? { amount: Math.round(patch.amount) } : {}),
      ...(patch.due_day !== undefined ? { due_day: patch.due_day } : {}),
      ...(patch.ends_on !== undefined ? { ends_on: patch.ends_on } : {}),
      ...(patch.note !== undefined ? { note: patch.note?.trim() || null } : {}),
      ...(patch.active !== undefined ? { active: patch.active } : {}),
      ...(patch.amount_kind !== undefined ? { amount_kind: patch.amount_kind } : {}),
    });
    updated = row;
    writeAudit(draft, {
      service: SERVICE, entity: "cash_component", entity_no: id,
      action: patch.active === false ? "deactivate" : "update", outcome: "ok", reason: null,
      detail: { before, after: { name: row.name, amount: row.amount, due_day: row.due_day, active: row.active } },
    });
  });
  return ok(SERVICE, updated as unknown as CashComponent);
}

/** One month that is not like the others — a bigger payroll in December, a
 *  month the bill does not arrive at all. `amount: null` means skipped. */
export async function setOverride(
  input: { component_id: string; month: string; amount: number | null; due_day?: number | null; reason?: string | null },
): Promise<Result<CashOverride>> {
  await latency();
  /* Q24 (D233): the estimates on the cash calendar belong to leadership alone.
     Enforced at the module **level** rather than by an authority, for the same
     reason D24 gives: who counts as leadership is a grant somebody made, not
     something to infer in code from holding `approve_funds` — accounting holds
     that too. Accounting keeps `write` and therefore keeps reading the plan and
     booking real payments against it; only `admin` may move the estimate. */
  const denied = requireLevel(SERVICE, "accounting", "admin");
  if (denied) return denied;

  const state = getState();
  if (!state.cash_components.some((c) => c.id === input.component_id)) {
    return notFound(SERVICE, "component_not_found", `No calendar line ${input.component_id}.`);
  }
  if (!/^\d{4}-\d{2}$/.test(input.month)) {
    return invalid(SERVICE, "month_invalid", "A month reads as YYYY-MM.", { field: "month" });
  }
  if (!input.reason?.trim()) {
    return invalid(
      SERVICE, "reason_required",
      "A month that differs from every other month has a reason. Write it — in three months nobody will remember, including you.",
      { field: "reason" },
    );
  }

  const user = actingUser();
  let saved: CashOverride | null = null;
  apply((draft) => {
    const existing = draft.cash_overrides.find(
      (o) => o.component_id === input.component_id && o.month === input.month,
    );
    const row: CashOverride = existing ?? {
      id: newId("cov"),
      component_id: input.component_id,
      month: input.month,
      amount: null,
      due_day: null,
      reason: null,
      recorded_by: user.id,
      recorded_at: new Date().toISOString(),
    };
    const before = existing ? { amount: existing.amount, due_day: existing.due_day } : null;
    row.amount = input.amount === null ? null : Math.round(input.amount);
    row.due_day = input.due_day ?? null;
    row.reason = input.reason?.trim() ?? null;
    row.recorded_by = user.id;
    row.recorded_at = new Date().toISOString();
    if (!existing) draft.cash_overrides.push(row);
    saved = row;
    writeAudit(draft, {
      service: SERVICE, entity: "cash_override", entity_no: `${input.component_id}:${input.month}`,
      action: existing ? "update" : "create", outcome: "ok", reason: row.reason,
      detail: { before, after: { amount: row.amount, due_day: row.due_day } },
    });
  });
  return ok(SERVICE, saved as unknown as CashOverride);
}

/** Somebody pointing at a ledger row and saying: that one was this bill.
 *  Matching by category is a guess; this is a decision, and it wins. */
export async function linkPayment(
  input: { component_id: string; month: string; trx_no: string },
): Promise<Result<CashSettlement>> {
  await latency();
  const denied = requireModule(SERVICE, "accounting");
  if (denied) return denied;

  const state = getState();
  if (!state.cash_components.some((c) => c.id === input.component_id)) {
    return notFound(SERVICE, "component_not_found", `No calendar line ${input.component_id}.`);
  }
  const trx = state.transactions.find((t) => t.trx_no === input.trx_no);
  if (!trx) return notFound(SERVICE, "transaction_not_found", `No ledger row ${input.trx_no}.`);
  if (trx.status === "VOID") {
    return invalid(SERVICE, "transaction_void", "That row was voided. A voided payment settles nothing.", { field: "trx_no" });
  }
  const taken = state.cash_settlements.find((s) => s.trx_no === input.trx_no);
  if (taken) {
    return conflict(
      SERVICE, "already_linked",
      `${input.trx_no} is already linked to another line on the calendar.`,
      { component_id: taken.component_id, month: taken.month },
    );
  }
  if (state.subscription_payments.some((p) => p.trx_no === input.trx_no)) {
    return conflict(
      SERVICE, "already_linked",
      `${input.trx_no} is already linked to a subscription on the calendar.`,
      { trx_no: input.trx_no },
    );
  }

  const user = actingUser();
  let saved: CashSettlement | null = null;
  apply((draft) => {
    saved = {
      id: newId("cst"),
      component_id: input.component_id,
      month: input.month,
      trx_no: input.trx_no,
      recorded_by: user.id,
      recorded_at: new Date().toISOString(),
    };
    draft.cash_settlements.push(saved);
    writeAudit(draft, {
      service: SERVICE, entity: "cash_settlement", entity_no: input.trx_no,
      action: "link", outcome: "ok", reason: null,
      detail: { component_id: input.component_id, month: input.month, amount: trx.amount_idr },
    });
  });
  return ok(SERVICE, saved as unknown as CashSettlement);
}

/** One month opened up: every movement in date order, the balance running
 *  down beside it, and the day it gets lowest (D115). */
export async function getMonthDetail(month: string): Promise<Result<CashMonthDetail>> {
  await latency();
  const detail = cashMonthDetail(getState(), month);
  if (!detail) {
    return notFound(SERVICE, "month_not_in_plan", `${month} is outside the twelve months the plan covers.`);
  }
  return ok(SERVICE, detail);
}

/* ── Rekening koran ───────────────────────────────────────────────────────
 *
 *  For BCA 064 and BCA USD 081 the statement is not a check on rows somebody
 *  typed — it is how their rows come to exist at all (D180). So the verbs here
 *  are: upload one, tie a line to a row the ledger already has, or **book** a
 *  line the ledger has never seen.
 */
export async function listStatements(): Promise<Result<BankStatementView[]>> {
  await latency();
  const denied = requireModule(SERVICE, "accounting");
  if (denied) return denied;
  const state = getState();
  const readable = readableAccountIds(state);
  return ok(SERVICE, bankStatementViews(state).filter((s) => readable.has(s.account_id)));
}

export async function getStatement(statementNo: string): Promise<Result<BankStatementView>> {
  await latency();
  const denied = requireModule(SERVICE, "accounting");
  if (denied) return denied;
  const state = getState();
  const st = state.bank_statements.find((s) => s.statement_no === statementNo);
  if (!st || !readableAccountIds(state).has(st.account_id)) {
    return notFound(SERVICE, "statement_not_found", `No statement ${statementNo}.`);
  }
  return ok(SERVICE, bankStatementView(state, st));
}

/** Importing a file. The lines arrive parsed by the screen — the browser reads
 *  the CSV, the service stores what it read (D143's shape, reused). */
export async function importStatement(
  input: {
    account_code: string;
    period_start: string;
    period_end: string;
    opening_balance: number;
    closing_balance: number;
    currency: string;
    filename: string;
    attachment_id?: string | null;
    note?: string | null;
    rows: {
      value_date: string; direction: Direction; amount: number;
      raw_description: string; balance_after?: number | null;
    }[];
  },
  idempotencyKey?: string,
): Promise<Result<BankStatementView>> {
  await latency();
  const cached = replayed<BankStatementView>(SERVICE, "importStatement", idempotencyKey);
  if (cached) return cached;

  const denied = requireModule(SERVICE, "accounting");
  if (denied) return denied;

  const state = getState();
  const account = state.accounts.find((a) => a.code === input.account_code);
  if (!account) return notFound(SERVICE, "account_not_found", `No account ${input.account_code}.`);
  if (input.rows.length === 0) {
    return invalid(SERVICE, "no_rows", "Tidak ada baris yang terbaca di file itu.", { field: "rows" });
  }
  /* The same period twice is a re-upload, not a second statement. Refusing it
     keeps one movement from being booked twice — the single most expensive
     mistake available on this screen. */
  const clash = state.bank_statements.find(
    (s) => s.account_id === account.id
      && s.period_start === input.period_start && s.period_end === input.period_end,
  );
  if (clash) {
    return conflict(
      SERVICE, "period_already_uploaded",
      `${clash.statement_no} sudah memuat ${input.period_start} → ${input.period_end} untuk ${account.code}.`,
    );
  }

  const user = actingUser();
  let no = "";
  apply((draft) => {
    no = nextDocNumber(draft, "rkk");
    const id = newId("bst");
    draft.bank_statements.push({
      id, statement_no: no, account_id: account.id,
      period_start: input.period_start, period_end: input.period_end,
      opening_balance: input.opening_balance, closing_balance: input.closing_balance,
      currency: input.currency || account.currency,
      filename: input.filename,
      status: "PENDING",
      attachment_id: input.attachment_id ?? null,
      note: input.note?.trim() || null,
      uploaded_by: user.id, uploaded_at: new Date().toISOString(),
    });
    input.rows.forEach((r, i) => {
      draft.statement_lines.push({
        id: newId("stl"), statement_id: id, line_no: i + 1,
        value_date: r.value_date, direction: r.direction, amount: r.amount,
        /* A rupiah line needs no conversion; a foreign one waits for a rate
           somebody types (D181). */
        amount_idr: (input.currency || account.currency) === "IDR" ? r.amount : null,
        fx_rate: null,
        raw_description: r.raw_description,
        balance_after: r.balance_after ?? null,
        status: "unmatched", trx_no: null, note: null,
        decided_by: null, decided_at: null,
      });
    });
    writeAudit(draft, {
      service: SERVICE, entity: "bank_statement", entity_no: no,
      action: "import", outcome: "ok", reason: null,
      detail: { account: account.code, rows: input.rows.length, period: `${input.period_start}…${input.period_end}`, by: user.email },
    });
  });

  const view = await getStatement(no);
  if (view.data) remember(SERVICE, "importStatement", idempotencyKey, view.data);
  return view;
}

/** The rate for one foreign line. Typed, never looked up: what the bank
 *  actually gave on the day is on the advice, and a mid-market rate from
 *  anywhere else is a different number (D181). */
export async function setStatementRate(
  input: { statement_no: string; line_id: string; fx_rate: number },
): Promise<Result<BankStatementView>> {
  await latency();
  const denied = requireModule(SERVICE, "accounting");
  if (denied) return denied;
  if (input.fx_rate <= 0) {
    return invalid(SERVICE, "rate_positive", "Kurs harus lebih dari nol.", { field: "fx_rate" });
  }

  const state = getState();
  const st = state.bank_statements.find((s) => s.statement_no === input.statement_no);
  if (!st) return notFound(SERVICE, "statement_not_found", `No statement ${input.statement_no}.`);
  const line = state.statement_lines.find((l) => l.id === input.line_id);
  if (!line) return notFound(SERVICE, "line_not_found", "Baris itu tidak ada.");
  if (line.status === "booked") {
    return conflict(SERVICE, "already_booked", "Baris itu sudah masuk ledger — kursnya ikut baris ledger-nya.");
  }

  const user = actingUser();
  apply((draft) => {
    const row = draft.statement_lines.find((l) => l.id === input.line_id);
    if (!row) return;
    row.fx_rate = input.fx_rate;
    row.amount_idr = Math.round(row.amount * input.fx_rate);
    writeAudit(draft, {
      service: SERVICE, entity: "statement_line", entity_no: st.statement_no,
      action: "set_rate", outcome: "ok", reason: null,
      detail: { line: row.line_no, rate: input.fx_rate, amount: row.amount, amount_idr: row.amount_idr, by: user.email },
    });
  });
  return getStatement(input.statement_no);
}

/** Tying a line to a ledger row that already exists. Creates nothing. */
export async function matchStatementLine(
  input: { statement_no: string; line_id: string; trx_no: string },
): Promise<Result<BankStatementView>> {
  await latency();
  const denied = requireModule(SERVICE, "accounting");
  if (denied) return denied;

  const state = getState();
  const st = state.bank_statements.find((s) => s.statement_no === input.statement_no);
  if (!st) return notFound(SERVICE, "statement_not_found", `No statement ${input.statement_no}.`);
  const trx = state.transactions.find((t) => t.trx_no === input.trx_no);
  if (!trx) return notFound(SERVICE, "trx_not_found", `No ledger row ${input.trx_no}.`);
  const taken = state.statement_lines.find((l) => l.trx_no === input.trx_no && l.id !== input.line_id);
  if (taken) {
    return conflict(
      SERVICE, "trx_already_tied",
      `${input.trx_no} sudah ditautkan ke baris lain. Satu mutasi, satu baris ledger.`,
    );
  }

  const user = actingUser();
  apply((draft) => {
    const row = draft.statement_lines.find((l) => l.id === input.line_id);
    if (!row) return;
    row.status = "matched";
    row.trx_no = input.trx_no;
    row.decided_by = user.id;
    row.decided_at = new Date().toISOString();
    writeAudit(draft, {
      service: SERVICE, entity: "statement_line", entity_no: st.statement_no,
      action: "match", outcome: "ok", reason: null,
      detail: { line: row.line_no, trx_no: input.trx_no, by: user.email },
    });
  });
  return getStatement(input.statement_no);
}

/** Booking a line the ledger has never seen — the ordinary case for these two
 *  accounts (D180).
 *
 *  The statement is the evidence. That is not a shortcut around D85: a bank's
 *  own record of a movement is stronger than the screenshot of a transfer that
 *  usually stands in for it.
 */
export async function bookStatementLine(
  input: {
    statement_no: string; line_id: string;
    type_code: TransactionTypeCode; description: string;
    vendor_id?: string | null; project_id?: string | null;
  },
): Promise<Result<BankStatementView>> {
  await latency();
  const denied = requireAuthority(SERVICE, "post_ledger");
  if (denied) return denied;

  const state = getState();
  const st = state.bank_statements.find((s) => s.statement_no === input.statement_no);
  if (!st) return notFound(SERVICE, "statement_not_found", `No statement ${input.statement_no}.`);
  const line = state.statement_lines.find((l) => l.id === input.line_id);
  if (!line) return notFound(SERVICE, "line_not_found", "Baris itu tidak ada.");
  if (line.status !== "unmatched") {
    return conflict(SERVICE, "already_decided", `Baris ${line.line_no} sudah ${line.status}.`);
  }
  if (line.amount_idr == null) {
    return invalid(
      SERVICE, "rate_required",
      `Baris ini dalam ${st.currency}. Isi kursnya dulu — sistem tidak menebak kurs, karena yang benar adalah kurs yang bank berikan hari itu.`,
      { field: "fx_rate" },
    );
  }
  if (!input.description.trim()) {
    return invalid(SERVICE, "description_required", "Tulis keterangannya — baris bank apa adanya bukan penjelasan.", { field: "description" });
  }

  const user = actingUser();
  let trxNo = "";
  apply((draft) => {
    const row = draft.statement_lines.find((l) => l.id === input.line_id);
    if (!row || row.amount_idr == null) return;
    trxNo = nextDocNumber(draft, "trx");
    draft.transactions.push({
      id: newId("trx"), trx_no: trxNo,
      trx_date: row.value_date,
      account_id: st.account_id,
      direction: row.direction,
      amount_idr: row.amount_idr,
      type_code: input.type_code,
      vendor_id: input.vendor_id ?? null,
      project_id: input.project_id ?? null,
      description: input.description.trim(),
      remark: st.currency === "IDR"
        ? `Dari ${st.statement_no} baris ${row.line_no}.`
        : `Dari ${st.statement_no} baris ${row.line_no} — ${st.currency} ${row.amount} @ ${row.fx_rate}.`,
      status: "COMPLETED",
      source_ref: st.statement_no,
      posted_by: user.id,
      posted_at: new Date().toISOString(),
      void_reason: null,
    });
    if (st.attachment_id) {
      draft.attachment_links.push({
        id: newId("lnk"), attachment_id: st.attachment_id,
        entity: "transaction", entity_no: trxNo,
        kind: "Rekening Koran", linked_by: user.id, linked_at: new Date().toISOString(),
      });
    }
    row.status = "booked";
    row.trx_no = trxNo;
    row.decided_by = user.id;
    row.decided_at = new Date().toISOString();

    writeAudit(draft, {
      service: SERVICE, entity: "transaction", entity_no: trxNo,
      action: "book_from_statement", outcome: "ok", reason: null,
      detail: {
        statement: st.statement_no, line: row.line_no,
        amount_idr: row.amount_idr, currency: st.currency,
        original: row.amount, rate: row.fx_rate, by: user.email,
      },
    });
    writeOutbox(draft, {
      service: SERVICE, event_type: "accounting.transaction.posted",
      payload: { trx_no: trxNo, source: st.statement_no, amount_idr: row.amount_idr },
    });
  });
  return getStatement(input.statement_no);
}

/** Leaving a line out, with a reason. Never deleted — a line nobody can
 *  explain is exactly the one somebody will ask about (A5). */
export async function ignoreStatementLine(
  input: { statement_no: string; line_id: string; note: string },
): Promise<Result<BankStatementView>> {
  await latency();
  const denied = requireModule(SERVICE, "accounting");
  if (denied) return denied;
  if (!input.note.trim()) {
    return invalid(SERVICE, "reason_required", "Tulis alasannya — baris yang dilewati tanpa keterangan adalah baris yang akan ditanyakan.", { field: "note" });
  }

  const state = getState();
  const st = state.bank_statements.find((s) => s.statement_no === input.statement_no);
  if (!st) return notFound(SERVICE, "statement_not_found", `No statement ${input.statement_no}.`);

  const user = actingUser();
  apply((draft) => {
    const row = draft.statement_lines.find((l) => l.id === input.line_id);
    if (!row) return;
    row.status = "ignored";
    row.note = input.note.trim();
    row.decided_by = user.id;
    row.decided_at = new Date().toISOString();
    writeAudit(draft, {
      service: SERVICE, entity: "statement_line", entity_no: st.statement_no,
      action: "ignore", outcome: "ok", reason: row.note,
      detail: { line: row.line_no, by: user.email },
    });
  });
  return getStatement(input.statement_no);
}

/** What one document is holding up — every ledger row it stands behind, every
 *  request line those rows reach, and every payment against each of those
 *  lines including the ones this document knows nothing about (D206).
 *
 *  A read, and a read that is worth making before every one of the five roads:
 *  the commonest mistake this queue can produce is booking a nota that is
 *  already booked, and the only thing that prevents it is seeing what the
 *  paper already covers.
 */
export async function coverageForDocument(
  attachmentId: string,
  documentAmount: number | null = null,
): Promise<Result<DocumentCoverage>> {
  await latency();
  return ok(SERVICE, documentCoverage(getState(), attachmentId, documentAmount));
}

/** What a ledger row already carries, before a document is attached to it. */
export async function coverageForTransaction(trxNo: string): Promise<Result<TransactionCoverage>> {
  await latency();
  const state = getState();
  const trx = state.transactions.find((t) => t.trx_no === trxNo);
  const c = trx && readableAccountIds(state).has(trx.account_id) ? transactionCoverage(state, trxNo) : null;
  if (!c) return notFound(SERVICE, "transaction_not_found", `Tidak ada transaksi ${trxNo}.`);
  return ok(SERVICE, c);
}

/** The month's bills as a worklist (D227). The same computation the calendar
 *  draws, in the shape the person paying them needs. */
/** Accounting's audit of the statutory invoices (D259).
 *
 *  *Daftar nama terdaftar × biaya per orang*, against what actually left — the
 *  owner's own sentence, built here because it spans two services: HR owns who
 *  is enrolled, accounting owns what was paid, and neither reaches into the
 *  other's tables (ADR-004).
 */
export async function getContributionAudit(month?: string): Promise<Result<ContributionAuditGroup[]>> {
  await latency();
  const denied = requireModule(SERVICE, "accounting");
  if (denied) return denied;
  const m = month || officeToday().slice(0, 7);
  return ok(SERVICE, contributionAudit(getState(), m));
}

/** An asset's rent onto the payment calendar, once (`0116`).
 *
 *    monthly   one monthly line from the contract's first month to the last
 *              month whose due day falls before the contract ends
 *    yearly    a one-off per contract year, from this month on (at most ten)
 *    upfront   one one-off on the day the contract starts
 *
 *  Fixed lines, marked `source_ref = asset:AST-…`. A contract's rent is a
 *  number on paper, not leadership's estimate, so accounting `write` makes
 *  them — the live seam gates on `accounting.update` for the same reason. */
export async function scheduleAssetRent(
  assetNo: string,
  opts: { account_code?: AccountCode | null; type_code?: TransactionTypeCode | null } = {},
): Promise<Result<AssetRentSchedule>> {
  await latency();
  const denied = requireLevel(SERVICE, "accounting", "write");
  if (denied) return denied;
  const state = getState();
  const a = state.assets.find((x) => x.asset_no === assetNo);
  if (!a) return notFound(SERVICE, "asset_not_found", "No such asset.");
  if (a.ownership === "owned") return invalid(SERVICE, "not_rented", `${assetNo} has no rent to pay.`);
  if (!a.rent_amount || a.rent_amount <= 0 || !a.rent_period) {
    return invalid(SERVICE, "rent_missing", "Enter the rent and how often it is paid on the asset first.", { field: "rent_amount" });
  }
  if (!a.contract_start) {
    return invalid(SERVICE, "contract_start_required", "Enter when the contract starts on the asset first.", { field: "contract_start" });
  }
  if (a.rent_period === "yearly" && !a.contract_end) {
    return invalid(SERVICE, "contract_end_required", "Yearly rent needs the contract's end date, so the calendar knows how many years.", { field: "contract_end" });
  }
  if (a.status === "disposed" || a.status === "lost" || a.status === "returned") {
    return conflict(SERVICE, "asset_gone", `${assetNo} is ${a.status} — there is no rent left to pay.`);
  }
  const ref = `asset:${assetNo}`;
  if (state.cash_components.some((c) => c.active && c.source_ref === ref)) {
    return conflict(SERVICE, "already_scheduled", `The rent for ${assetNo} is already on the payment calendar. Change it there.`);
  }
  if (opts.type_code && !state.transaction_types.some((t) => t.code === opts.type_code)) {
    return invalid(SERVICE, "no_such_type", `There is no transaction type ${opts.type_code}.`, { field: "type_code" });
  }
  const account = opts.account_code ? state.accounts.find((x) => x.code === opts.account_code) : undefined;
  if (opts.account_code && !account) return invalid(SERVICE, "no_such_account", `There is no account ${opts.account_code}.`);
  const vendorId = a.vendor_code ? state.vendors.find((v) => v.code === a.vendor_code)?.id ?? null : null;

  const name = `Rent — ${a.name} (${assetNo})`;
  const startMonth = a.contract_start.slice(0, 7);
  const thisMonth = officeToday().slice(0, 7);
  type Line = { name: string; frequency: CashFrequency; due_day: number; due_date: string | null; starts_on: string; ends_on: string | null };
  const lines: Line[] = [];
  if (a.rent_period === "monthly") {
    const day = a.rent_due_day ?? Number(a.contract_start.slice(8, 10));
    let ends: string | null = null;
    if (a.contract_end) {
      const endMonth = a.contract_end.slice(0, 7);
      const [y, m] = endMonth.split("-").map(Number);
      const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const lastDue = `${endMonth}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
      ends = lastDue >= a.contract_end ? shiftMonth(endMonth, -1) : endMonth;
      if (ends < startMonth) ends = startMonth;
    }
    lines.push({ name, frequency: "monthly", due_day: day, due_date: null, starts_on: startMonth, ends_on: ends });
  } else {
    const max = a.rent_period === "upfront" ? 1 : 10;
    for (let k = 0; k < max; k++) {
      const on = `${Number(a.contract_start.slice(0, 4)) + k}${a.contract_start.slice(4)}`;
      if (a.rent_period === "yearly" && on >= a.contract_end!) break;
      if (on.slice(0, 7) < thisMonth) continue;
      lines.push({
        name: a.rent_period === "yearly" ? `${name} · year ${k + 1}` : name,
        frequency: "once", due_day: Number(on.slice(8, 10)), due_date: on, starts_on: on.slice(0, 7), ends_on: on.slice(0, 7),
      });
    }
  }
  if (lines.length === 0) {
    return invalid(SERVICE, "nothing_to_schedule", `Every rent payment for ${assetNo} falls before this month.`);
  }

  const user = actingUser();
  const now = new Date().toISOString();
  const ids: string[] = [];
  apply((draft) => {
    for (const l of lines) {
      const row: CashComponent = {
        id: newId("cmp"), name: l.name, direction: "OUT", amount: Math.round(a.rent_amount!),
        frequency: l.frequency, due_day: l.due_day, due_weekday: null, due_date: l.due_date,
        type_code: opts.type_code ?? null, vendor_id: vendorId, account_id: account?.id ?? null,
        scheme_codes: [], amount_kind: "fixed", source_ref: ref,
        starts_on: l.starts_on, ends_on: l.ends_on, note: `From ${assetNo}`,
        active: true, created_by: user.id, created_at: now,
      };
      draft.cash_components.push(row);
      ids.push(row.id);
      writeAudit(draft, {
        service: SERVICE, entity: "cash_component", entity_no: row.id, action: "create", outcome: "ok", reason: null,
        detail: { name: row.name, amount: row.amount, frequency: row.frequency, source_ref: ref },
      });
    }
    writeAudit(draft, {
      service: SERVICE, entity: "asset", entity_no: assetNo, action: "schedule_rent", outcome: "ok", reason: null,
      detail: { rent_amount: a.rent_amount, rent_period: a.rent_period, lines: ids.length },
    });
  });
  return ok(SERVICE, { asset_no: assetNo, component_ids: ids, lines: ids.length });
}

function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export async function getMonthlyBills(month?: string): Promise<Result<MonthlyBills>> {
  await latency();
  const denied = requireModule(SERVICE, "accounting");
  if (denied) return denied;
  const m = month || officeToday().slice(0, 7);
  return ok(SERVICE, monthlyBills(getState(), m));
}


/* ------------------------------------------------------------------ */
/* Subscriptions (`0208`)                                              */
/* ------------------------------------------------------------------ */

/** The register: every subscription, what it costs at the plan's rate, when it
 *  is next billed, what has been paid. Read-only for anybody in accounting. */
export async function getSubscriptions(): Promise<Result<SubscriptionRegister>> {
  await latency();
  const denied = requireModule(SERVICE, "accounting");
  if (denied) return denied;
  const state = getState();
  return ok(SERVICE, subscriptionRegister({
    subscriptions: state.subscriptions, payments: state.subscription_payments,
    usd_idr: state.subscription_fx, today: officeToday(),
    accountCodeOf: (id) => state.accounts.find((a) => a.id === id)?.code ?? null,
  }));
}

export async function saveSubscription(
  input: SubscriptionInput, id?: string | null,
): Promise<Result<{ id: string; sub_no: string }>> {
  await latency();
  const denied = requireLevel(SERVICE, "accounting", "write");
  if (denied) return denied;

  if (!input.name.trim()) {
    return invalid(SERVICE, "name_required", "Name the service so somebody will recognise it.", { field: "name" });
  }
  if (!["monthly", "yearly", "biennial"].includes(input.cycle)) {
    return invalid(SERVICE, "cycle_invalid", "Billed monthly, yearly or every two years.", { field: "cycle" });
  }
  if (!["fixed", "payg"].includes(input.amount_kind)) {
    return invalid(SERVICE, "amount_kind_invalid", "The price is either fixed or pay as you go.", { field: "amount_kind" });
  }
  if (!["USD", "IDR"].includes(input.currency)) {
    return invalid(SERVICE, "currency_invalid", "Billed in USD or in IDR.", { field: "currency" });
  }
  if (!(input.amount > 0)) {
    return invalid(SERVICE, "amount_required", "Put the amount per billing — for pay as you go, the amount you expect.", { field: "amount" });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.start_on ?? "")) {
    return invalid(SERVICE, "start_required", "The date it is billed — its first billing, or the next one.", { field: "start_on" });
  }
  if (input.ends_on && input.ends_on < input.start_on) {
    return invalid(SERVICE, "end_before_start", "It ends before it starts.", { field: "ends_on" });
  }
  const state = getState();
  if (input.account_id && !state.accounts.some((a) => a.id === input.account_id)) {
    return invalid(SERVICE, "no_such_account", "There is no such account.", { field: "account_code" });
  }
  if (id && !state.subscriptions.some((x) => x.id === id)) {
    return notFound(SERVICE, "subscription_not_found", "No such subscription.");
  }

  const user = actingUser();
  let saved: { id: string; sub_no: string } | null = null;
  apply((draft) => {
    const fields = {
      name: input.name.trim(),
      provider: input.provider?.trim() || null,
      login_email: input.login_email?.trim() || null,
      cycle: input.cycle,
      amount_kind: input.amount_kind,
      currency: input.currency,
      amount: input.amount,
      start_on: input.start_on,
      ends_on: input.ends_on || null,
      account_id: input.account_id ?? null,
      note: input.note?.trim() || null,
    };
    const existing = id ? draft.subscriptions.find((x) => x.id === id) : undefined;
    if (existing) {
      Object.assign(existing, fields);
      saved = { id: existing.id, sub_no: existing.sub_no };
    } else {
      const n = draft.subscriptions.reduce((m, x) => Math.max(m, Number(x.sub_no.slice(4))), 0) + 1;
      const row: Subscription = {
        id: newId("sub"), sub_no: `SUB-${String(n).padStart(4, "0")}`, ...fields,
        status: "active", created_by: user.id, created_at: new Date().toISOString(),
      };
      draft.subscriptions.push(row);
      saved = { id: row.id, sub_no: row.sub_no };
    }
    writeAudit(draft, {
      service: SERVICE, entity: "subscription", entity_no: saved!.sub_no,
      action: "save", outcome: "ok", reason: null,
      detail: { name: fields.name, cycle: fields.cycle, currency: fields.currency, amount: fields.amount },
    });
  });
  return ok(SERVICE, saved as unknown as { id: string; sub_no: string });
}

export async function setSubscriptionStatus(
  id: string, status: SubscriptionStatus,
): Promise<Result<{ id: string; status: SubscriptionStatus }>> {
  await latency();
  const denied = requireLevel(SERVICE, "accounting", "write");
  if (denied) return denied;
  if (!["active", "paused", "cancelled"].includes(status)) {
    return invalid(SERVICE, "status_invalid", "Active, paused or cancelled.", { field: "status" });
  }
  if (!getState().subscriptions.some((x) => x.id === id)) {
    return notFound(SERVICE, "subscription_not_found", "No such subscription.");
  }
  apply((draft) => {
    const row = draft.subscriptions.find((x) => x.id === id)!;
    const was = row.status;
    row.status = status;
    writeAudit(draft, {
      service: SERVICE, entity: "subscription", entity_no: row.sub_no,
      action: "status", outcome: "ok", reason: null, detail: { from: was, to: status },
    });
  });
  return ok(SERVICE, { id, status });
}

/** What was charged for one billing period. The rate is rupiah ÷ dollars — the
 *  rate the card really went at. Recording the same period again corrects it. */
export async function recordSubscriptionPayment(
  id: string, input: SubscriptionPaymentInput,
): Promise<Result<{ id: string; period: string; fx_rate: number | null }>> {
  await latency();
  const denied = requireLevel(SERVICE, "accounting", "write");
  if (denied) return denied;
  const sub = getState().subscriptions.find((x) => x.id === id);
  if (!sub) return notFound(SERVICE, "subscription_not_found", "No such subscription.");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.period ?? "")) {
    return invalid(SERVICE, "period_invalid", "The month it was billed for, as YYYY-MM.", { field: "period" });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.paid_on ?? "")) {
    return invalid(SERVICE, "paid_on_required", "The day it was charged.", { field: "paid_on" });
  }
  if (!(input.amount_idr > 0)) {
    return invalid(SERVICE, "amount_required", "The rupiah that actually left.", { field: "amount_idr" });
  }
  if (input.amount_usd != null && !(input.amount_usd > 0)) {
    return invalid(SERVICE, "usd_invalid", "The dollars charged must be more than zero.", { field: "amount_usd" });
  }
  if (sub.currency === "IDR" && input.amount_usd != null) {
    return invalid(SERVICE, "usd_on_idr", "This one is billed in rupiah — there are no dollars to record.", { field: "amount_usd" });
  }

  const linkedTo = getState().subscription_payments
    .find((p) => p.subscription_id === id && p.period === input.period)?.trx_no;
  if (linkedTo) {
    return conflict(
      SERVICE, "linked_to_ledger",
      `That billing is settled by ledger row ${linkedTo}, whose figures are the ledger's. Remove the link first to record it by hand.`,
      { trx_no: linkedTo },
    );
  }

  const fx_rate = input.amount_usd == null ? null : Math.round((input.amount_idr / input.amount_usd) * 100) / 100;
  const user = actingUser();
  apply((draft) => {
    const row: SubscriptionPayment = {
      id: newId("subpay"), subscription_id: id, period: input.period, paid_on: input.paid_on,
      amount_idr: input.amount_idr, amount_usd: input.amount_usd ?? null, fx_rate, trx_no: null,
      note: input.note?.trim() || null, recorded_by: user.id, recorded_at: new Date().toISOString(),
    };
    draft.subscription_payments = draft.subscription_payments
      .filter((p) => !(p.subscription_id === id && p.period === input.period));
    draft.subscription_payments.push(row);
    writeAudit(draft, {
      service: SERVICE, entity: "subscription", entity_no: sub.sub_no,
      action: "pay", outcome: "ok", reason: null,
      detail: { period: input.period, amount_idr: input.amount_idr, amount_usd: input.amount_usd ?? null, fx_rate },
    });
  });
  return ok(SERVICE, { id, period: input.period, fx_rate });
}

export async function removeSubscriptionPayment(
  id: string, period: string,
): Promise<Result<{ id: string; period: string }>> {
  await latency();
  const denied = requireLevel(SERVICE, "accounting", "write");
  if (denied) return denied;
  const state = getState();
  const sub = state.subscriptions.find((x) => x.id === id);
  if (!sub) return notFound(SERVICE, "subscription_not_found", "No such subscription.");
  if (!state.subscription_payments.some((p) => p.subscription_id === id && p.period === period)) {
    return notFound(SERVICE, "payment_not_found", "No payment recorded for that month.");
  }
  apply((draft) => {
    draft.subscription_payments = draft.subscription_payments
      .filter((p) => !(p.subscription_id === id && p.period === period));
    writeAudit(draft, {
      service: SERVICE, entity: "subscription", entity_no: sub.sub_no,
      action: "unpay", outcome: "ok", reason: null, detail: { period },
    });
  });
  return ok(SERVICE, { id, period });
}

/** The rate the plan converts dollars at — leadership's to change, so `admin`
 *  and not `write` (Q24, D233). */
export async function setSubscriptionFx(rate: number): Promise<Result<{ usd_idr: number }>> {
  await latency();
  const denied = requireLevel(SERVICE, "accounting", "admin");
  if (denied) return denied;
  if (!(rate > 0)) {
    return invalid(SERVICE, "rate_invalid", "Rupiah per dollar, more than zero.", { field: "usd_idr" });
  }
  apply((draft) => {
    const was = draft.subscription_fx;
    draft.subscription_fx = rate;
    writeAudit(draft, {
      service: SERVICE, entity: "subscription_fx", entity_no: "USD",
      action: "set_rate", outcome: "ok", reason: null, detail: { from: was, to: rate },
    });
  });
  return ok(SERVICE, { usd_idr: rate });
}

/** Point one billing at the ledger row that paid it, as `linkPayment` does for a
 *  calendar component. The amount and the day are the row's own, the row stops
 *  counting as money nobody planned, and one row settles one billing — here or
 *  on a component, never both (D112). Removing the payment undoes the link. */
export async function linkSubscriptionPayment(input: {
  subscription_id: string; period: string; trx_no: string;
}): Promise<Result<{ id: string; period: string; trx_no: string; amount_idr: number }>> {
  await latency();
  const denied = requireLevel(SERVICE, "accounting", "write");
  if (denied) return denied;
  const state = getState();
  const sub = state.subscriptions.find((x) => x.id === input.subscription_id);
  if (!sub) return notFound(SERVICE, "subscription_not_found", "No such subscription.");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.period ?? "")) {
    return invalid(SERVICE, "period_invalid", "The month it was billed for, as YYYY-MM.", { field: "period" });
  }
  const trx = state.transactions.find((t) => t.trx_no === input.trx_no);
  if (!trx) return notFound(SERVICE, "transaction_not_found", `There is no ledger row ${input.trx_no}.`);
  if (trx.status === "VOID") {
    return invalid(SERVICE, "transaction_void", "That row was voided. A voided payment settles nothing.", { field: "trx_no" });
  }
  if (trx.direction !== "OUT") {
    return invalid(SERVICE, "not_a_payment", "That row is money coming in. A subscription is paid out.", { field: "trx_no" });
  }
  const taken = state.cash_settlements.some((c) => c.trx_no === input.trx_no)
    || state.subscription_payments.some((p) => p.trx_no === input.trx_no
      && !(p.subscription_id === input.subscription_id && p.period === input.period));
  if (taken) {
    return conflict(SERVICE, "already_linked",
      "That payment is already on the calendar against another line. One row, one bill.", { field: "trx_no" });
  }

  const user = actingUser();
  apply((draft) => {
    draft.subscription_payments = draft.subscription_payments
      .filter((p) => !(p.subscription_id === input.subscription_id && p.period === input.period));
    draft.subscription_payments.push({
      id: newId("subpay"), subscription_id: input.subscription_id, period: input.period,
      paid_on: trx.trx_date, amount_idr: trx.amount_idr, amount_usd: null, fx_rate: null,
      trx_no: input.trx_no, note: null, recorded_by: user.id, recorded_at: new Date().toISOString(),
    });
    writeAudit(draft, {
      service: SERVICE, entity: "subscription", entity_no: sub.sub_no,
      action: "link", outcome: "ok", reason: null,
      detail: { period: input.period, trx_no: input.trx_no, amount_idr: trx.amount_idr },
    });
  });
  return ok(SERVICE, { id: input.subscription_id, period: input.period, trx_no: input.trx_no, amount_idr: trx.amount_idr });
}


/* ------------------------------------------------------------------ */
/* Cashflow — leadership's weekly projection (`0239`, D392)            */
/* ------------------------------------------------------------------ */

/** Leadership's alone: the owner's *untuk pimpinan dan superadmin* is exactly
 *  the people holding `approve_funds` — the same door as the leadership
 *  accounts' balances and rows (D87, D391), which this screen adds up. */
function cashflowDenied() {
  return requireAuthority(SERVICE, "approve_funds");
}

const isMonth = (s: string | null | undefined) => !!s && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
const isDay = (s: string | null | undefined) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Twelve months of weeks from `from` (default: this month). */
export async function getCashflow(from?: string): Promise<Result<Cashflow>> {
  await latency();
  const denied = cashflowDenied();
  if (denied) return denied;
  const today = officeToday();
  const fromMonth = isMonth(from) ? from! : today.slice(0, 7);
  const state = getState();
  const [y, m] = fromMonth.split("-").map(Number);
  const plan = cashPlan(state, new Date(), new Date(y, m - 1, 1));
  const ledger = state.transactions
    .filter((t) => t.status !== "VOID")
    .map((t) => ({
      trx_no: t.trx_no, trx_date: t.trx_date, direction: t.direction, amount_idr: t.amount_idr,
      type_code: t.type_code, vendor_id: t.vendor_id, project_id: t.project_id, account_id: t.account_id,
    }));
  return ok(SERVICE, buildCashflow({
    today, fromMonth, plan,
    lines: state.cashflow_lines,
    overrides: state.cashflow_overrides,
    receipts: state.cashflow_receipts,
    openings: state.cashflow_openings,
    settings: state.cashflow_settings,
    ledger,
    openingAccounts: balancesAt(state.accounts, ledger, `${fromMonth}-01`),
    vendorName: (id) => state.vendors.find((v) => v.id === id)?.name ?? null,
    projectCode: (id) => state.projects.find((p) => p.id === id)?.code ?? null,
    accountCode: (id) => state.accounts.find((a) => a.id === id)?.code ?? null,
  }));
}

function checkLine(input: CashflowLineInput) {
  if (!input.name?.trim()) return invalid(SERVICE, "name_required", "Name the line so it can be recognised.", { field: "name" });
  if (!["IN", "OUT"].includes(input.direction)) return invalid(SERVICE, "direction_invalid", "Money in or money out.", { field: "direction" });
  const cats = input.direction === "IN" ? CASHFLOW_IN_CATEGORIES : CASHFLOW_OUT_CATEGORIES;
  if (!cats.includes(input.category)) return invalid(SERVICE, "category_invalid", "That group does not belong on this side.", { field: "category" });
  if (!["weekly", "monthly", "once"].includes(input.frequency)) return invalid(SERVICE, "frequency_invalid", "Weekly, monthly or once.", { field: "frequency" });
  if (!(input.amount > 0)) return invalid(SERVICE, "amount_required", "The amount each time, more than zero.", { field: "amount" });
  if (input.frequency === "once" && !isDay(input.due_date)) return invalid(SERVICE, "date_required", "A one-off needs its date.", { field: "due_date" });
  if (input.frequency === "monthly" && !(Number(input.due_day) >= 1 && Number(input.due_day) <= 31)) return invalid(SERVICE, "day_invalid", "A day of the month, 1 to 31.", { field: "due_day" });
  if (input.frequency === "weekly" && !(Number(input.due_weekday) >= 0 && Number(input.due_weekday) <= 6)) return invalid(SERVICE, "weekday_invalid", "A day of the week.", { field: "due_weekday" });
  if (input.frequency !== "once" && !isMonth(input.starts_on)) return invalid(SERVICE, "start_required", "The month it starts.", { field: "starts_on" });
  if (input.ends_on && (!isMonth(input.ends_on) || input.ends_on < input.starts_on)) return invalid(SERVICE, "end_before_start", "It ends before it starts.", { field: "ends_on" });
  if (input.growth_pct != null && !(input.growth_pct > -100 && input.growth_pct <= 100)) return invalid(SERVICE, "growth_invalid", "Growth is a percentage per month, between −99 and 100.", { field: "growth_pct" });
  if (input.growth_from && !isMonth(input.growth_from)) return invalid(SERVICE, "growth_from_invalid", "The month growth starts from.", { field: "growth_from" });
  return null;
}

/** Add or change one of the cashflow's own lines. */
export async function saveCashflowLine(input: CashflowLineInput, id?: string | null): Promise<Result<{ id: string }>> {
  await latency();
  const denied = cashflowDenied();
  if (denied) return denied;
  const bad = checkLine(input);
  if (bad) return bad;
  const state = getState();
  if (id) {
    const was = state.cashflow_lines.find((l) => l.id === id && l.source_ref === null);
    if (!was) return notFound(SERVICE, "no_such_line", "No such cashflow line.");
  }
  const lineId = id ?? newId("cfl");
  const row = {
    name: input.name.trim(), direction: input.direction, category: input.category,
    frequency: input.frequency, amount: input.amount,
    due_day: input.frequency === "monthly" ? Number(input.due_day) : null,
    due_weekday: input.frequency === "weekly" ? Number(input.due_weekday) : null,
    due_date: input.frequency === "once" ? input.due_date ?? null : null,
    starts_on: input.frequency === "once" ? (input.due_date ?? "").slice(0, 7) : input.starts_on,
    ends_on: input.frequency === "once" ? null : input.ends_on ?? null,
    growth_pct: input.growth_pct ?? 0, growth_from: input.growth_from ?? null,
    type_code: input.type_code ?? null, vendor_id: input.vendor_id ?? null, project_id: input.project_id ?? null,
    note: input.note?.trim() || null,
  };
  apply((draft) => {
    const at = draft.cashflow_lines.findIndex((l) => l.id === lineId);
    if (at >= 0) draft.cashflow_lines[at] = { ...draft.cashflow_lines[at], ...row };
    else draft.cashflow_lines.push({
      ...row, id: lineId, source_ref: null, hidden: false, active: true,
      created_by: actingUser().id, created_at: new Date().toISOString(),
    });
    writeAudit(draft, { service: SERVICE, entity: "cashflow_line", entity_no: row.name, action: id ? "update" : "create", outcome: "ok", reason: null, detail: row });
  });
  return ok(SERVICE, { id: lineId });
}

/** The cashflow's change to a monthly bill — amount, growth, or leaving it
 *  out. The calendar's own figure is not touched. */
export async function saveCashflowBill(input: CashflowBillInput): Promise<Result<{ id: string }>> {
  await latency();
  const denied = cashflowDenied();
  if (denied) return denied;
  if (!/^(component:|sub:)/.test(input.source_ref ?? "")) return invalid(SERVICE, "source_invalid", "Not a monthly bill.", { field: "source_ref" });
  if (!CASHFLOW_OUT_CATEGORIES.includes(input.category)) return invalid(SERVICE, "category_invalid", "That group does not belong on this side.", { field: "category" });
  if (input.amount !== null && !(input.amount > 0)) return invalid(SERVICE, "amount_required", "The amount each time, more than zero — or empty to follow the calendar.", { field: "amount" });
  if (!(input.growth_pct > -100 && input.growth_pct <= 100)) return invalid(SERVICE, "growth_invalid", "Growth is a percentage per month, between −99 and 100.", { field: "growth_pct" });
  if (input.growth_from && !isMonth(input.growth_from)) return invalid(SERVICE, "growth_from_invalid", "The month growth starts from.", { field: "growth_from" });
  const state = getState();
  const existing = state.cashflow_lines.find((l) => l.source_ref === input.source_ref);
  const lineId = existing?.id ?? newId("cfl");
  apply((draft) => {
    const at = draft.cashflow_lines.findIndex((l) => l.id === lineId);
    const row = {
      name: input.name, category: input.category, amount: input.amount, growth_pct: input.growth_pct,
      growth_from: input.growth_from, hidden: input.hidden, note: input.note?.trim() || null, active: true,
    };
    if (at >= 0) draft.cashflow_lines[at] = { ...draft.cashflow_lines[at], ...row };
    else draft.cashflow_lines.push({
      ...row, id: lineId, source_ref: input.source_ref, direction: "OUT", frequency: null,
      due_day: null, due_weekday: null, due_date: null, starts_on: null, ends_on: null,
      type_code: null, vendor_id: null, project_id: null,
      created_by: actingUser().id, created_at: new Date().toISOString(),
    });
    writeAudit(draft, { service: SERVICE, entity: "cashflow_line", entity_no: input.name, action: "adjust_bill", outcome: "ok", reason: null, detail: row });
  });
  return ok(SERVICE, { id: lineId });
}

/** Take an own line off the cashflow. Its realisations stay on record. */
export async function removeCashflowLine(id: string): Promise<Result<{ id: string }>> {
  await latency();
  const denied = cashflowDenied();
  if (denied) return denied;
  const line = getState().cashflow_lines.find((l) => l.id === id && l.source_ref === null);
  if (!line) return notFound(SERVICE, "no_such_line", "No such cashflow line.");
  apply((draft) => {
    const l = draft.cashflow_lines.find((x) => x.id === id)!;
    l.active = false;
    writeAudit(draft, { service: SERVICE, entity: "cashflow_line", entity_no: l.name, action: "remove", outcome: "ok", reason: null, detail: null });
  });
  return ok(SERVICE, { id });
}

/** Change one week of one line: an amount, or null for *not this week*.
 *  A bill nobody has adjusted yet is given its cashflow row on the way. */
export async function setCashflowWeek(input: {
  line_id?: string | null; source_ref?: string | null; name?: string;
  week_start: string; amount: number | null; reason: string;
}): Promise<Result<{ line_id: string; week_start: string }>> {
  await latency();
  const denied = cashflowDenied();
  if (denied) return denied;
  if (!isDay(input.week_start) || ![1, 8, 15, 22].includes(Number(input.week_start.slice(8, 10)))) {
    return invalid(SERVICE, "week_invalid", "A week starts on the 1st, 8th, 15th or 22nd.", { field: "week_start" });
  }
  if (input.amount !== null && !(input.amount >= 0)) return invalid(SERVICE, "amount_invalid", "Zero or more — or not this week.", { field: "amount" });
  if (!input.reason?.trim()) return invalid(SERVICE, "reason_required", "Say why this week is different.", { field: "reason" });
  const state = getState();
  let lineId = input.line_id ?? null;
  if (!lineId && input.source_ref) {
    lineId = state.cashflow_lines.find((l) => l.source_ref === input.source_ref)?.id ?? null;
    if (!lineId) {
      const r = await saveCashflowBill({
        source_ref: input.source_ref, name: input.name ?? input.source_ref, category: input.source_ref.startsWith("sub:") ? "subscription" : "bills",
        amount: null, growth_pct: 0, growth_from: null, hidden: false,
      });
      if (r.error) return r;
      lineId = r.data.id;
    }
  }
  if (!lineId || !getState().cashflow_lines.some((l) => l.id === lineId)) return notFound(SERVICE, "no_such_line", "No such cashflow line.");
  apply((draft) => {
    draft.cashflow_overrides = draft.cashflow_overrides.filter((o) => !(o.line_id === lineId && o.week_start === input.week_start));
    draft.cashflow_overrides.push({
      id: newId("cfo"), line_id: lineId!, week_start: input.week_start, amount: input.amount,
      reason: input.reason.trim(), recorded_by: actingUser().id, recorded_at: new Date().toISOString(),
    });
    writeAudit(draft, { service: SERVICE, entity: "cashflow_week", entity_no: input.week_start, action: "set", outcome: "ok", reason: input.reason, detail: { line_id: lineId, amount: input.amount } });
  });
  return ok(SERVICE, { line_id: lineId, week_start: input.week_start });
}

/** Undo a week's change — the line falls back to its schedule. */
export async function clearCashflowWeek(lineId: string, weekStart: string): Promise<Result<{ line_id: string; week_start: string }>> {
  await latency();
  const denied = cashflowDenied();
  if (denied) return denied;
  apply((draft) => {
    draft.cashflow_overrides = draft.cashflow_overrides.filter((o) => !(o.line_id === lineId && o.week_start === weekStart));
  });
  return ok(SERVICE, { line_id: lineId, week_start: weekStart });
}

/** Record money that actually moved against an own line. */
export async function recordCashflowReceipt(lineId: string, input: {
  on_date: string; amount: number; trx_no?: string | null; note?: string | null;
}): Promise<Result<{ id: string }>> {
  await latency();
  const denied = cashflowDenied();
  if (denied) return denied;
  const state = getState();
  if (!state.cashflow_lines.some((l) => l.id === lineId && l.source_ref === null)) return notFound(SERVICE, "no_such_line", "Realisations are recorded on the cashflow's own lines; a bill is settled on the calendar.");
  if (!isDay(input.on_date)) return invalid(SERVICE, "date_required", "The day the money moved.", { field: "on_date" });
  if (input.on_date > officeToday()) return invalid(SERVICE, "date_in_future", "A realisation has already happened.", { field: "on_date" });
  if (!(input.amount > 0)) return invalid(SERVICE, "amount_required", "The amount, more than zero.", { field: "amount" });
  const trx = input.trx_no?.trim() || null;
  if (trx) {
    if (!state.transactions.some((t) => t.trx_no === trx && t.status !== "VOID")) return invalid(SERVICE, "no_such_trx", `There is no ledger row ${trx}.`, { field: "trx_no" });
    if (state.cashflow_receipts.some((r) => r.trx_no === trx)) return conflict(SERVICE, "trx_already_used", `${trx} is already a realisation on another line.`);
  }
  const id = newId("cfr");
  apply((draft) => {
    draft.cashflow_receipts.push({
      id, line_id: lineId, on_date: input.on_date, amount: input.amount, trx_no: trx,
      note: input.note?.trim() || null, recorded_by: actingUser().id, recorded_at: new Date().toISOString(),
    });
    writeAudit(draft, { service: SERVICE, entity: "cashflow_receipt", entity_no: input.on_date, action: "record", outcome: "ok", reason: null, detail: { line_id: lineId, amount: input.amount, trx_no: trx } });
  });
  return ok(SERVICE, { id });
}

export async function removeCashflowReceipt(id: string): Promise<Result<{ id: string }>> {
  await latency();
  const denied = cashflowDenied();
  if (denied) return denied;
  if (!getState().cashflow_receipts.some((r) => r.id === id)) return notFound(SERVICE, "no_such_receipt", "No such realisation.");
  apply((draft) => {
    draft.cashflow_receipts = draft.cashflow_receipts.filter((r) => r.id !== id);
  });
  return ok(SERVICE, { id });
}

/** Type a month's starting balance (null clears it, back to the ledger's). */
export async function setCashflowOpening(month: string, amount: number | null, note?: string | null): Promise<Result<{ month: string }>> {
  await latency();
  const denied = cashflowDenied();
  if (denied) return denied;
  if (!isMonth(month)) return invalid(SERVICE, "month_invalid", "A month, YYYY-MM.", { field: "month" });
  if (amount !== null && !Number.isFinite(amount)) return invalid(SERVICE, "amount_invalid", "A figure in rupiah.", { field: "amount" });
  apply((draft) => {
    draft.cashflow_openings = draft.cashflow_openings.filter((o) => o.month !== month);
    if (amount !== null) draft.cashflow_openings.push({
      month, amount, note: note?.trim() || null, recorded_by: actingUser().id, recorded_at: new Date().toISOString(),
    });
    writeAudit(draft, { service: SERVICE, entity: "cashflow_opening", entity_no: month, action: "set", outcome: "ok", reason: note ?? null, detail: { amount } });
  });
  return ok(SERVICE, { month });
}

export async function setCashflowSettings(input: CashflowSettings): Promise<Result<CashflowSettings>> {
  await latency();
  const denied = cashflowDenied();
  if (denied) return denied;
  if (!(input.min_balance >= 0)) return invalid(SERVICE, "min_balance_invalid", "The safe minimum is zero or more.", { field: "min_balance" });
  const types = [...new Set(input.transfer_types.map((t) => t.trim()).filter(Boolean))];
  apply((draft) => {
    draft.cashflow_settings = { min_balance: input.min_balance, transfer_types: types };
    writeAudit(draft, { service: SERVICE, entity: "cashflow_settings", entity_no: "settings", action: "set", outcome: "ok", reason: null, detail: { min_balance: input.min_balance, transfer_types: types } });
  });
  return ok(SERVICE, { min_balance: input.min_balance, transfer_types: types });
}
