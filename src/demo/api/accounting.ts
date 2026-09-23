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
} from "@/services/accounting/contracts";
import { getActiveLocale } from "@/lib/format";
import { officeToday } from "@/lib/office";
import { getState, apply, newId, nextDocNumber, writeAudit, writeOutbox } from "../store";
import type { AuditRow, DemoState } from "../state";
import {
  accountBalances, transactionView, allocatedTotal, inboxHealth, lineCoverage,
  lineStatus, fundings, fundingView, cashPlan, cashDue, cashMonthDetail,
  bankStatementView, bankStatementViews, documentCoverage, transactionCoverage,
  monthlyBills, contributionAudit, orderOfLine,
} from "../derive";
import { latency, actingUser, requireAuthority, requireModule, requireLevel, conflict, replayed, remember, paged } from "./_kit";
import { PRIMARY_DOC_KINDS, COMPLETION_DOC_KINDS, type DocKind } from "@/services/documents/contracts";
import * as procurement from "./procurement";

const SERVICE = "accounting" as const;

export async function listAccounts(): Promise<Result<AccountBalance[]>> {
  await latency();
  return ok(SERVICE, accountBalances(getState()));
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
    return invalid(SERVICE, "leadership_not_paying", "A leadership account never pays a vendor directly (D87).", { field: "is_paying" });
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
    return invalid(SERVICE, "leadership_not_paying", "A leadership account never pays a vendor directly (D87).", { field: "is_paying" });
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
    creates_catalog_item: input.creates_catalog_item ?? false,
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

export async function listTransactions(
  opts: {
    account_id?: string; type_code?: string; q?: string;
    /** By project **code**, resolved here — the caller crosses the seam with
     *  the public identifier, never an internal id (ADR-004). */
    project_code?: string;
    include_void?: boolean; limit?: number; offset?: number;
  } = {},
): Promise<Result<TransactionView[]>> {
  await latency();
  const state = getState();
  let rows = state.transactions;
  /* Filtered here rather than in the browser, so "page 2 of 3" counts the
     rows the reader will actually see. */
  if (!opts.include_void) rows = rows.filter((t) => t.status !== "VOID");
  if (opts.account_id) rows = rows.filter((t) => t.account_id === opts.account_id);
  if (opts.project_code) {
    const project = state.projects.find((p) => p.code === opts.project_code);
    rows = project ? rows.filter((t) => t.project_id === project.id) : [];
  }
  if (opts.type_code) rows = rows.filter((t) => t.type_code === opts.type_code);
  if (opts.q) {
    const q = opts.q.toLowerCase();
    rows = rows.filter((t) => t.description.toLowerCase().includes(q) || t.trx_no.includes(q));
  }
  const views = rows
    .map((t) => transactionView(state, t))
    .sort((a, b) => b.trx_date.localeCompare(a.trx_date) || b.trx_no.localeCompare(a.trx_no));
  return paged(SERVICE, views, opts.limit ?? 50, opts.offset ?? 0);
}

/** The whole row: what it bought, what it funded, and the line each
 *  allocation points at. One call, because a drawer that needs three is a
 *  drawer that renders in three stages. */
export async function getTransaction(trxNo: string): Promise<Result<TransactionDetail>> {
  await latency();
  const state = getState();
  const trx = state.transactions.find((t) => t.trx_no === trxNo);
  if (!trx) return notFound(SERVICE, "transaction_not_found", `Transaction ${trxNo} not found.`);

  const allocations: AllocationView[] = state.payment_allocations
    .filter((a) => a.trx_id === trx.id)
    .map((a) => {
      const line = state.pr_lines.find((l) => l.line_no_full === a.pr_line_no);
      return {
        ...a,
        line_description: line?.description ?? null,
        line_status: line ? lineStatus(state, line) : null,
      };
    });

  return ok(SERVICE, {
    ...transactionView(state, trx),
    lines: state.transaction_lines.filter((l) => l.trx_id === trx.id),
    allocations,
  });
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
    lines?: { description: string; qty?: number | null; uom?: string | null; unit_price?: number | null; amount: number }[];
    /** At least one of these has to be a nota, a transfer proof or a photo of
     *  what arrived (D85). The files are uploaded first and linked here, in
     *  the same act as the row — so a row without evidence never exists, not
     *  even for a second. */
    documents: { attachment_id: string; kind: DocKind }[];
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
  const lines = input.lines ?? [];

  if (type?.is_purchase) {
    if (lines.length === 0) {
      return invalid(
        SERVICE, "detail_required",
        `${input.type_code} is a purchase: it needs what was bought, how many and at what price. An amount on its own cannot be checked against a delivery, a quote or next month.`,
        { field: "lines" },
      );
    }
    const missing = lines.find((l) => l.qty == null || l.unit_price == null);
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
    const sum = lines.reduce((acc, l) => acc + l.amount, 0);
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
    });
    lines.forEach((l, i) => {
      draft.transaction_lines.push({
        id: newId("trl"), trx_id: trxId, line_no: i + 1, item_id: null,
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
        documents: input.documents.map((d) => d.kind),
        source_ref: input.source_ref,
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
    reason?: string;
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

  if (amount === trx.amount_idr && description === trx.description
      && vendorId === trx.vendor_id && projectId === trx.project_id
      && typeCode === trx.type_code) {
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

  apply((draft) => {
    const t = draft.transactions.find((x) => x.id === trx.id)!;
    t.amount_idr = amount;
    t.description = description;
    t.vendor_id = vendorId;
    t.project_id = projectId;
    t.type_code = typeCode as typeof t.type_code;
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
    id: newId("alc"), trx_id: trx.id, pr_line_no: input.pr_line_no, po_no: orderOfLine(state, input.pr_line_no),
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

/** Who `reported_by` is, spelled out. Not stored on the row (`state.ts`'s own
 *  comment on `evidence_inbox`) — resolved here, the same boundary every
 *  other `_name` field in this file sits on. */
function withReporterName(
  state: DemoState, row: Omit<EvidenceInboxRow, "reported_by_name">,
): EvidenceInboxRow {
  return { ...row, reported_by_name: state.users.find((u) => u.id === row.reported_by)?.full_name ?? null };
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
  const rows = state.transactions
    .filter((t) => t.vendor_id === vendorId && t.direction === "OUT")
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
      id: newId("alc"), trx_id: trxId, pr_line_no: input.line_no, po_no: orderOfLine(draft, input.line_no),
      amount: input.amount, method: "transfer", superseded_by: null,
      allocated_by: user.id, allocated_at: new Date().toISOString(),
    });
    /* The detail comes from the line itself: what was bought, how many, at
       what price — so the ledger row can be read without opening the PR. */
    draft.transaction_lines.push({
      id: newId("trl"), trx_id: trxId, line_no: 1, item_id: null,
      /* A lump-sum line has no quantity (D75); its payment is described as
         1 lot at the amount paid, the same as `post_from_line` (0129, D298). */
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

/** Paying an order from its own screen (B8) — the demo twin of
 *  `ops_acct.post_to_po` (0127). One ledger row; the amount split across the
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
    draft.transaction_lines.push({
      id: newId("trl"), trx_id: trxId, line_no: 1, item_id: null,
      description: `Pembayaran ${input.po_no}`, qty: 1, uom: "unit" as never,
      unit_price: input.amount, amount: input.amount,
    });
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
  return ok(SERVICE, bankStatementViews(getState()));
}

export async function getStatement(statementNo: string): Promise<Result<BankStatementView>> {
  await latency();
  const denied = requireModule(SERVICE, "accounting");
  if (denied) return denied;
  const state = getState();
  const st = state.bank_statements.find((s) => s.statement_no === statementNo);
  if (!st) return notFound(SERVICE, "statement_not_found", `No statement ${statementNo}.`);
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
      `Baris ini dalam ${st.currency}. Isi kursnya dulu — sistem tidak menebak kurs, karena yang benar adalah kurs yang bank berikan hari itu (D181).`,
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
  const c = transactionCoverage(getState(), trxNo);
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
