/** Implements `/api/v1/accounting` against the database.
 *
 *  The same rules as `procurement.ts`: nothing derived is computed here,
 *  no permission is checked here, and no refusal is reworded here. In this
 *  service that matters more than anywhere else — a guard reimplemented in
 *  TypeScript is a guard that can disagree with the one in front of the money.
 *
 *  **Two write seams, and only two** (ADR-006): `postTransaction` and
 *  `allocate`. Everything else that moves money is one of those two under a
 *  different name, and adding a third road is how the check gets skipped.
 */
import type {
  Account, AccountBalance, TransactionView, TransactionDetail,
  TransactionType, Direction, AllocMethod, InboxStatus, InboxHealth,
  TrxStatus, BankStatementView, StatementLineView, StatementMatch,
  TransactionTypeCode, PaymentAllocation,
} from "@/services/accounting/contracts";
import type { DocKind } from "@/services/documents/contracts";
import { supabaseBrowser } from "@/lib/supabase/client";
import { fail, fromSeam, fromRows, invalid, notFound, ok, type Result } from "./_kit";

const SERVICE = "accounting" as const;

/** Every object this module reads or calls lives in `ops_acct`, and PostgREST
 *  has to be told so on **every request**.
 *
 *  `.from("x")` and `.rpc("y")` resolve against the schema the request names —
 *  its `Accept-Profile` / `Content-Profile` header. With none, PostgREST uses
 *  the first of its exposed schemas, which is `public`, and ours holds nothing.
 *  The symptom is exact, and was seen in production: *Could not find the table
 *  'public.v_my_access' in the schema cache*.
 *
 *  **Supabase's "Extra search path" does not fix this, and believing it did cost
 *  a deploy.** That setting adds schemas to the search_path so objects *inside*
 *  an exposed schema can reference them unqualified; PostgREST is explicit that
 *  those schemas get no API endpoints of their own. Exposing a schema says it
 *  may be addressed; naming it on the request is what addresses it.
 *
 *  `.schema()` rather than a second client: a client per schema is an auth
 *  listener and a token-refresh timer per schema, and those racing is how a
 *  session appears to end halfway through a form. This is a query builder bound
 *  to one schema, from the one client.
 *
 *  Called `db` and not `q` because several functions here already open with
 *  `let q = …` to build a filter chain, and a helper of the same name would be
 *  shadowed by it — silently, in exactly the branches that filter.
 */
const db = () => supabaseBrowser().schema("ops_acct");

/** A document going in, by its **code**. The contracts carry display strings
 *  (`"Payment Proof"`); the database stores `transfer_proof` and keeps the
 *  wording in `core.doc_kind_labels` so renaming a label is a row rather than
 *  a migration (C1). Callers that already hold a code pass it straight
 *  through; the map is for the screens that still hold the label. */
const KIND_CODE: Partial<Record<DocKind, string>> = {
  "Receipt / Invoice / Nota": "nota",
  "Payment Proof": "transfer_proof",
  "Receiving Item": "goods_photo",
  "Delivery Note": "delivery_note",
  "Purchase Order": "purchase_order",
  "Reference Link": "quotation",
  "Rekening Koran": "rekening_koran",
  "Surat Dokter": "surat_dokter",
  "Surat Lembur": "surat_lembur",
  "Laporan Lembur": "laporan_lembur",
  "Gambar Kerja": "gambar_kerja",
  "Gambar Jadi": "gambar_jadi",
  Others: "other",
};

function toKindCode(kind: string): string {
  return KIND_CODE[kind as DocKind] ?? kind;
}

/* ------------------------------------------------------------------ */
/* Reference                                                           */
/* ------------------------------------------------------------------ */

/** The accounts **with their balances**, as the database computes them (D9).
 *  No screen recomputes this, and one that cannot load it shows an em dash
 *  rather than a substitute — a client-side stand-in is how a page ends up
 *  disagreeing with the books.
 *
 *  `balance_locked` is how the leadership accounts read to somebody without
 *  `approve_funds`: **locked, not hidden** (D87). The row is there, the figure
 *  is not, and the screen can say which — hiding the account from people who
 *  can see every transfer into it is a fiction they see through.
 *
 *  **These two functions were the wrong way round** until the swap in
 *  `src/demo/api/index.ts` put the two implementations side by side. This one
 *  read `accounts` and the one below read `v_account_balance`, which is exactly
 *  backwards from the demo the screens were written against — so every screen
 *  asking for balances would have got rows with no balance on them, and the
 *  reverse. Only one of the two showed up as a type error, because
 *  `AccountBalance` has every field `Account` has and is assignable to it; the
 *  other would have been found by somebody looking at a blank column.
 */
export async function listAccounts(): Promise<Result<(AccountBalance & { balance_locked: boolean })[]>> {
  const { data, error } = await db().from("v_account_balance").select("*").order("code");
  return fromRows(SERVICE, data as (AccountBalance & { balance_locked: boolean })[], error);
}

/** The account rows themselves — no balance, no lock. What a picker needs. */
export async function listAccountRows(): Promise<Result<Account[]>> {
  const { data, error } = await db().from("accounts").select("*").order("code");
  return fromRows<Account[]>(SERVICE, data as Account[], error);
}

export async function listTypeRows(): Promise<Result<TransactionType[]>> {
  const { data, error } = await db().from("transaction_types").select("*").order("code");
  return fromRows<TransactionType[]>(SERVICE, data as TransactionType[], error);
}

/* ------------------------------------------------------------------ */
/* The ledger                                                          */
/* ------------------------------------------------------------------ */

export async function listTransactions(
  opts: { limit?: number; offset?: number; account_code?: string; status?: TrxStatus } = {},
): Promise<Result<TransactionView[]>> {
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;
  let q = db().from("v_transaction").select("*");
  if (opts.account_code) q = q.eq("account_code", opts.account_code);
  if (opts.status) q = q.eq("status", opts.status);
  const { data, error } = await q
    .order("trx_date", { ascending: false })
    .order("trx_no", { ascending: false })
    .range(offset, offset + limit - 1);
  return fromRows<TransactionView[]>(SERVICE, data as TransactionView[], error);
}

/** Everything a ledger row is made of, in one call: what it bought, what it
 *  funded, and what proves it. */
export async function getTransaction(trxNo: string): Promise<Result<TransactionDetail>> {
  const { data, error } = await db().from("v_transaction_detail").select("*").eq("trx_no", trxNo).maybeSingle();
  if (error) return fail(SERVICE, error);
  if (!data) return notFound(SERVICE, "transaction_not_found", `Transaction ${trxNo} not found.`);
  return ok(SERVICE, data as unknown as TransactionDetail);
}

/** The audit trail read from the record it belongs to, rather than from a
 *  screen nobody opens (D84). Anomaly questions are never "who touched the
 *  ledger this month" — they are "what happened to *this* row", asked while
 *  looking at it. */
export async function historyFor(trxNo: string): Promise<Result<unknown[]>> {
  /* **The one object this module reads from outside its own schema.** The audit
     log belongs to `ops_core` — one trail for the whole system, not one per
     service — so this call names that schema rather than the module's. Checked
     against the database rather than remembered: it is the only exception among
     the hundred objects the four clients touch, and
     `scripts/check-api-schemas.mjs` is what keeps it the only one. */
  const { data, error } = await supabaseBrowser().schema("ops_core")
    .from("audit_log").select("*")
    .eq("entity", "transaction").eq("entity_no", trxNo)
    .order("at", { ascending: false });
  return fromRows<unknown[]>(SERVICE, data as unknown[], error);
}

export async function coverageFor(prLineNo: string): Promise<Result<unknown[]>> {
  const { data, error } = await db().from("v_allocation").select("*")
    .eq("pr_line_no", prLineNo).is("superseded_by", null)
    .order("allocated_at");
  return fromRows<unknown[]>(SERVICE, data as unknown[], error);
}

/* ------------------------------------------------------------------ */
/* The two seams                                                       */
/* ------------------------------------------------------------------ */

/** Resolve a uuid to the public code the seam actually takes.
 *
 *  Every seam in this system is addressed by code, never by uuid (ADR-004):
 *  `post_transaction` takes `p_account_code`, and a trail somebody has to read
 *  says `BCA-OPS`, not `9f3c…`. The screens were written against the demo,
 *  whose fixtures are uuid-keyed, so they pass `account_id`.
 *
 *  **The translation belongs here, and only until the contract moves.** Doing
 *  it in the client keeps the seam's rule intact and keeps the promise that a
 *  screen cannot tell which implementation it got. Logged as a contract change
 *  for the design session: `account_id` → `account_code`, and the same for
 *  vendor and project. Once the screens send codes, these three lookups go.
 */
async function codeFor(
  table: "accounts" | "vendors" | "projects", id: string | null | undefined,
): Promise<string | null> {
  if (!id) return null;
  const { data } = await db().from(table).select("code").eq("id", id).maybeSingle();
  return (data as { code: string } | null)?.code ?? null;
}

/** Post a transaction, and answer with the transaction.
 *
 *  **No document, no row** (D85), and a purchase needs to be checkable (D86).
 *  Both refusals are the database's, with its own wording — which names what is
 *  missing rather than saying the form is invalid.
 *
 *  Two round trips, the same shape as `createVendor`: the seam answers
 *  `{trx_no, amount, status}` — what happened — and the contract promises a
 *  `TransactionView`, which is what the ledger screen puts straight into its
 *  list without reloading. The write stays narrow; the read that follows is
 *  where the shape comes from.
 */
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
    lines?: { description: string; qty?: number | null; uom?: string | null;
              unit_price?: number | null; amount: number }[];
    documents: { attachment_id: string; kind: DocKind }[];
  },
  idempotencyKey?: string,
): Promise<Result<TransactionView>> {
  const accountCode = await codeFor("accounts", input.account_id);
  if (!accountCode) {
    return invalid(SERVICE, "account_not_found",
      "Akun itu tidak ada di database.", { field: "account_id" });
  }

  const { data, error } = await db().rpc("post_transaction", {
    p_account_code: accountCode,
    p_direction: input.direction,
    p_amount: input.amount_idr,
    p_type_code: input.type_code,
    p_description: input.description,
    p_documents: input.documents.map((d) => ({ ...d, kind: toKindCode(d.kind) })),
    p_trx_date: input.trx_date,
    p_vendor_code: await codeFor("vendors", input.vendor_id),
    p_project_code: await codeFor("projects", input.project_id),
    p_lines: input.lines ?? [],
    p_remark: null,
    p_source_ref: input.source_ref || null,
    p_key: idempotencyKey ?? null,
  });

  const posted = fromSeam<{ trx_no: string; amount: number; status: string }>(
    SERVICE, data, error);
  if (posted.error) return posted;

  /* The row exists whether or not this read succeeds, so its error is returned
     as it is rather than dressed as a failed post — retrying a post that
     already happened is how a payment gets made twice. */
  const row = await db().from("v_transaction").select("*").eq("trx_no", posted.data.trx_no).single();
  return fromRows<TransactionView>(SERVICE, row.data as TransactionView | null, row.error);
}

/** Pay an approved request line.
 *
 *  The working surface's whole point (D74): the same board where a line is
 *  asked for, corrected and documented is where it gets paid. Until `0034` this
 *  had **no seam, no client function and no row anywhere** — paying an approved
 *  request was a thing the database could not do at all, which is why
 *  `/procurement/pr` and `/procurement/meeting` were both dark.
 *
 *  `account_id` rather than a code, because the screen picked the account from
 *  a list of `AccountRow`; the seam takes the code, and `codeFor` translates.
 *
 *  **The proof is required** (D85). A payment with no transfer receipt is the
 *  same empty row as any other undocumented posting, and the refusal names the
 *  receipt rather than "documents", because that is the thing the person is
 *  being asked for.
 */
export async function postFromLine(
  input: {
    line_no: string;
    amount: number;
    account_id: string;
    trx_date: string;
    type_code: TransactionTypeCode;
    attachment_id: string;
    document_kind?: DocKind;
  },
  idempotencyKey?: string,
): Promise<Result<TransactionView>> {
  const accountCode = await codeFor("accounts", input.account_id);
  if (!accountCode) {
    return invalid(SERVICE, "account_not_found",
      "Akun itu tidak ada di database.", { field: "account_id" });
  }

  const { data, error } = await db().rpc("post_from_line", {
    p_line_no:       input.line_no,
    p_amount:        input.amount,
    p_account_code:  accountCode,
    p_type_code:     input.type_code,
    p_attachment_id: input.attachment_id || null,
    p_trx_date:      input.trx_date,
    p_document_kind: input.document_kind ?? "Payment Proof",
    p_key:           idempotencyKey ?? null,
  });
  const posted = fromSeam<{ trx_no: string }>(SERVICE, data, error);
  if (posted.error) return posted;

  /* Same shape as `postTransaction`: the money has moved whether or not this
     read succeeds, so a failed read is returned as itself rather than dressed
     as a failed payment. Retrying one that already happened is how a supplier
     gets paid twice. */
  const row = await db()
    .from("v_transaction").select("*").eq("trx_no", posted.data.trx_no).single();
  return fromRows<TransactionView>(SERVICE, row.data as TransactionView | null, row.error);
}

/** VOID keeps the row and the amount, with a reason beside it (A5, D84). The
 *  correction is a new row; this one stays, saying what was once believed. */
export async function voidTransaction(
  trxNo: string, reason: string, idempotencyKey?: string,
): Promise<Result<TransactionView>> {
  const { data, error } = await db().rpc("void_transaction", {
    p_trx_no: trxNo, p_reason: reason, p_key: idempotencyKey ?? null,
  });
  const voided = fromSeam<{ trx_no: string; status: string }>(SERVICE, data, error);
  if (voided.error) return voided;

  /* The row is still there — that is the whole point of a VOID (A5, D84) — so
     the screen wants it back, now reading VOID, rather than a receipt saying it
     worked. */
  const row = await db().from("v_transaction").select("*").eq("trx_no", voided.data.trx_no).single();
  return fromRows<TransactionView>(SERVICE, row.data as TransactionView | null, row.error);
}

/** The second seam: what a payment was *for*. A transaction never funds more
 *  than it moved (A9), and the target may be an order rather than a request
 *  line — the deposit on a PO answers to no PR (D106). */
export async function allocate(
  input: {
    trx_no: string;
    amount: number;
    pr_line_no?: string | null;
    po_no?: string | null;
    method?: AllocMethod;
  },
  idempotencyKey?: string,
): Promise<Result<PaymentAllocation>> {
  const { data, error } = await db().rpc("allocate_payment", {
    p_trx_no: input.trx_no,
    p_amount: input.amount,
    p_pr_line_no: input.pr_line_no ?? null,
    p_po_no: input.po_no ?? null,
    p_method: input.method ?? "transfer",
    p_key: idempotencyKey ?? null,
  });
  const allocated = fromSeam<{ trx_no: string; amount: number; unallocated: number }>(
    SERVICE, data, error);
  if (allocated.error) return allocated;

  /* The allocation row itself, which is what the drawer draws. Newest live one
     for this transaction and this target: `allocate` always writes a new row and
     supersedes rather than editing (A2), so the latest is the one in force. */
  let q = db().from("v_allocation").select("*")
    .eq("trx_no", input.trx_no).is("superseded_by", null);
  q = input.pr_line_no ? q.eq("pr_line_no", input.pr_line_no) : q.eq("po_no", input.po_no ?? "");
  const row = await q.order("allocated_at", { ascending: false }).limit(1).maybeSingle();
  return fromRows<PaymentAllocation>(SERVICE, row.data as PaymentAllocation | null, row.error);
}

/** A correction supersedes; it never deletes (A2). Pass no amount to withdraw
 *  the allocation entirely — the row stays, retired, so "who applied this money
 *  where, and who changed their mind" is still readable. */
export async function supersedeAllocation(
  allocationId: string, newAmount?: number | null,
): Promise<Result<unknown>> {
  const { data, error } = await db().rpc("supersede_allocation", {
    p_allocation_id: allocationId, p_new_amount: newAmount ?? null,
  });
  return fromSeam(SERVICE, data, error);
}

/* ------------------------------------------------------------------ */
/* The exception road                                                  */
/* ------------------------------------------------------------------ */

export async function listInbox(): Promise<Result<unknown[]>> {
  const { data, error } = await db().from("evidence_inbox").select("*")
    .eq("status", "PENDING").order("reported_at", { ascending: false });
  return fromRows<unknown[]>(SERVICE, data as unknown[], error);
}

export async function listInboxAll(): Promise<Result<unknown[]>> {
  const { data, error } = await db().from("evidence_inbox").select("*").order("reported_at", { ascending: false });
  return fromRows<unknown[]>(SERVICE, data as unknown[], error);
}

/** Not decoration. If this number grows, people are routing around the normal
 *  road — attaching from the record — and the reason is worth finding
 *  (ADR-010). */
export async function getInboxHealth(): Promise<Result<InboxHealth>> {
  const { data, error } = await db().from("v_inbox_health").select("*").maybeSingle();
  if (error) return fail(SERVICE, error);
  return ok(SERVICE, data as unknown as InboxHealth);
}

/** Five roads out, **none of which delete** (F26, D94). A document that
 *  reached the inbox and left it without a trace is the failure this road
 *  exists to prevent: somebody sent it, and "we never got it" must never be
 *  the answer. */
export async function resolveInbox(
  input: { ref_id: string; status: InboxStatus; trx_no?: string | null; note?: string | null },
  idempotencyKey?: string,
): Promise<Result<{ ref_id: string; status: string }>> {
  const { data, error } = await db().rpc("resolve_inbox", {
    p_ref_id: input.ref_id,
    p_status: input.status,
    p_trx_no: input.trx_no ?? null,
    p_note: input.note ?? null,
    p_key: idempotencyKey ?? null,
  });
  return fromSeam(SERVICE, data, error);
}

/* ------------------------------------------------------------------ */
/* The payment calendar                                                */
/* ------------------------------------------------------------------ */

/** Twelve months, planned against actual — computed on every read from three
 *  tables and the ledger as it stands. **No projection is stored** (D109–D115):
 *  a stored one disagrees with the ledger the moment a payment lands.
 *
 *  `from` exists because the engine takes a date, and pinning it is what makes
 *  the calendar testable. Left off, it starts at the office day. */
export async function getCashPlan(from?: string): Promise<Result<unknown[]>> {
  const { data, error } = await db().rpc("cash_events", { p_from: from ?? null });
  return fromRows<unknown[]>(SERVICE, data as unknown[], error);
}

/** One line, one month: the cell a calendar draws. Its state is the **worst**
 *  of the occurrences behind it, because a month with one overdue payday is an
 *  overdue month however well the other three went. */
export async function listCells(month?: string): Promise<Result<unknown[]>> {
  let q = db().from("v_cash_cell").select("*");
  if (month) q = q.eq("month", month);
  const { data, error } = await q.order("month").order("due_date");
  return fromRows<unknown[]>(SERVICE, data as unknown[], error);
}

export async function listComponents(): Promise<Result<unknown[]>> {
  const { data, error } = await db().from("v_cash_row").select("*").order("name");
  return fromRows<unknown[]>(SERVICE, data as unknown[], error);
}

/** Cash across the accounts that actually pay people. **Leadership's are not
 *  among them**: money sitting there has not been given to operations yet, and
 *  counting it would make every month look survivable. */
export async function getCashPosition(): Promise<Result<{ opening_cash: number; as_of: string }>> {
  const { data, error } = await db().from("v_cash_position").select("*").maybeSingle();
  if (error) return fail(SERVICE, error);
  return ok(SERVICE, data as { opening_cash: number; as_of: string });
}

/** What left the paying accounts and no planned line claimed. Not an error —
 *  most spending is not on the calendar — but the figure a month is short by
 *  when the plan looked fine. */
export async function listUnplanned(): Promise<Result<unknown[]>> {
  const { data, error } = await db().from("v_cash_unplanned").select("*").order("month");
  return fromRows<unknown[]>(SERVICE, data as unknown[], error);
}

export async function saveComponent(input: {
  id?: string | null;
  name: string;
  amount: number;
  frequency: "weekly" | "monthly" | "once";
  direction?: Direction;
  due_day?: number | null;
  due_weekday?: number | null;
  due_date?: string | null;
  type_code?: string | null;
  vendor_code?: string | null;
  account_code?: string | null;
  starts_on?: string | null;
  note?: string | null;
}): Promise<Result<unknown>> {
  const { data, error } = await db().rpc("save_cash_component", {
    p_name: input.name,
    p_amount: input.amount,
    p_frequency: input.frequency,
    p_direction: input.direction ?? "OUT",
    p_due_day: input.due_day ?? null,
    p_due_weekday: input.due_weekday ?? null,
    p_due_date: input.due_date ?? null,
    p_type_code: input.type_code ?? null,
    p_vendor_code: input.vendor_code ?? null,
    p_account_code: input.account_code ?? null,
    p_starts_on: input.starts_on ?? null,
    p_note: input.note ?? null,
    p_id: input.id ?? null,
  });
  return fromSeam(SERVICE, data, error);
}

/** A month changed. `skip: true` means *not this month* — a bill that skips is
 *  a fact, not a deletion. On a **weekly** line the amount is the month's
 *  total, and the difference lands on the last run: the THR is paid with one
 *  payday rather than spread across four (D114). */
export async function setOverride(input: {
  component_id: string;
  month: string;
  amount?: number | null;
  reason?: string | null;
  skip?: boolean;
}): Promise<Result<unknown>> {
  const { data, error } = await db().rpc("set_cash_override", {
    p_component_id: input.component_id,
    p_month: input.month,
    p_amount: input.amount ?? null,
    p_reason: input.reason ?? null,
    p_skip: input.skip ?? false,
  });
  return fromSeam(SERVICE, data, error);
}

/** Somebody saying *this ledger row is that bill*. It beats the category
 *  guess, which is the point — the guess is the fallback, not the answer. One
 *  row, one bill: a payment already on the calendar is a 409. */
export async function linkPayment(input: {
  component_id: string; month: string; trx_no: string;
}): Promise<Result<unknown>> {
  const { data, error } = await db().rpc("link_cash_payment", {
    p_component_id: input.component_id, p_month: input.month, p_trx_no: input.trx_no,
  });
  return fromSeam(SERVICE, data, error);
}

/* ------------------------------------------------------------------ */
/* Vendors and statements                                              */
/* ------------------------------------------------------------------ */

/** One payment, and what it settled. `applies_to` is a list because one
 *  transfer really does close three orders — the bank saw one payment, the
 *  vendor closed three, and both are true (D97). */
export async function paymentsForVendor(vendorId: string): Promise<Result<unknown[]>> {
  const { data, error } = await db().from("v_vendor_payment").select("*")
    .eq("vendor_id", vendorId).order("trx_date", { ascending: false });
  return fromRows<unknown[]>(SERVICE, data as unknown[], error);
}

export async function listStatements(): Promise<Result<unknown[]>> {
  const { data, error } = await db().from("v_bank_statement").select("*").order("period_start", { ascending: false });
  return fromRows<unknown[]>(SERVICE, data as unknown[], error);
}

/** A ledger row that looks like this statement line. **A suggestion, never
 *  applied by itself** (D180) — the view proposes and a person decides. */
export async function suggestionsFor(statementLineId: string): Promise<Result<unknown[]>> {
  const { data, error } = await db().from("v_statement_suggestion").select("*")
    .eq("statement_line_id", statementLineId).order("days_apart");
  return fromRows<unknown[]>(SERVICE, data as unknown[], error);
}

/* ------------------------------------------------------------------ */
/* Rekening koran                                                      */
/* ------------------------------------------------------------------ */

/** One statement, its lines, and what the ledger already has that looks like
 *  each of them.
 *
 *  Three reads rather than one: the statement, its lines, and every suggestion
 *  for those lines in a single `in (…)`. Never one suggestion query per line —
 *  a month of a busy account is sixty lines, and sixty round trips is the
 *  difference between a screen that opens and a screen somebody waits for.
 */
export async function getStatement(statementNo: string): Promise<Result<BankStatementView>> {

  const { data: head, error: headErr } = await db()
    .from("v_bank_statement").select("*").eq("statement_no", statementNo).maybeSingle();
  if (headErr) return fail(SERVICE, headErr);
  if (!head) {
    return notFound(SERVICE, "statement_not_found", `No statement ${statementNo}.`);
  }

  const { data: lines, error: lineErr } = await db()
    .from("v_statement_line").select("*").eq("statement_no", statementNo).order("line_no");
  if (lineErr) return fail(SERVICE, lineErr);

  const rows = (lines ?? []) as StatementLineView[];
  let suggestions: (StatementMatch & { statement_line_id: string })[] = [];
  if (rows.length > 0) {
    const { data: sug, error: sugErr } = await db()
      .from("v_statement_suggestion").select("*")
      .in("statement_line_id", rows.map((l) => l.id))
      .order("days_apart");
    if (sugErr) return fail(SERVICE, sugErr);
    suggestions = (sug ?? []) as (StatementMatch & { statement_line_id: string })[];
  }

  const byLine = new Map<string, StatementMatch[]>();
  for (const { statement_line_id, ...m } of suggestions) {
    const list = byLine.get(statement_line_id) ?? [];
    list.push(m);
    byLine.set(statement_line_id, list);
  }

  return ok(SERVICE, {
    ...(head as BankStatementView),
    lines: rows.map((l) => ({ ...l, suggestions: byLine.get(l.id) ?? [] })),
  });
}

/** A statement, its lines, and the period it covers.
 *
 *  The refusal that matters is the seam's: the same period twice is a
 *  re-upload, not a second statement, and booking one movement twice is the
 *  most expensive mistake this screen offers.
 */
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
  const { data, error } = await db().rpc("import_statement", {
    p_account_code: input.account_code,
    p_period_start: input.period_start,
    p_period_end: input.period_end,
    p_opening: input.opening_balance,
    p_closing: input.closing_balance,
    p_currency: input.currency,
    p_filename: input.filename,
    p_rows: input.rows,
    p_attachment_id: input.attachment_id ?? null,
    p_note: input.note ?? null,
    p_key: idempotencyKey ?? null,
  });
  const res = fromSeam<{ statement_no: string }>(SERVICE, data, error);
  if (res.error) return res;
  return getStatement(res.data.statement_no);
}

/** The rate for one foreign line. Typed, never looked up (D181). */
export async function setStatementRate(
  input: { statement_no: string; line_id: string; fx_rate: number },
): Promise<Result<BankStatementView>> {
  const { data, error } = await db().rpc("set_statement_rate", {
    p_line_id: input.line_id,
    p_fx_rate: input.fx_rate,
    p_key: null,
  });
  const res = fromSeam<unknown>(SERVICE, data, error);
  if (res.error) return res;
  return getStatement(input.statement_no);
}

/** Saying this line **is** a row the ledger already has. */
export async function matchStatementLine(
  input: { statement_no: string; line_id: string; trx_no: string },
): Promise<Result<BankStatementView>> {
  const { data, error } = await db().rpc("match_statement_line", {
    p_line_id: input.line_id,
    p_trx_no: input.trx_no,
    p_key: null,
  });
  const res = fromSeam<unknown>(SERVICE, data, error);
  if (res.error) return res;
  return getStatement(input.statement_no);
}

/** Booking a line the ledger does not have yet.
 *
 *  It does not write a ledger row: the seam hands the line to
 *  `post_transaction`, which is the one write seam for money (ADR-006). Every
 *  refusal that road has — the authority, the evidence, a purchase with no
 *  detail — comes back from here unchanged.
 */
export async function bookStatementLine(
  input: {
    statement_no: string; line_id: string;
    type_code: TransactionTypeCode; description: string;
    vendor_id?: string | null; project_id?: string | null;
  },
): Promise<Result<BankStatementView>> {
  const { data, error } = await db().rpc("book_statement_line", {
    p_line_id: input.line_id,
    p_type_code: input.type_code,
    p_description: input.description,
    /* The seam resolves by public code, like every other cross-reference
       (ADR-004). The screen holds ids today; passing them through would make
       this the one place that addresses a vendor by uuid. */
    p_vendor_code: input.vendor_id ?? null,
    p_project_code: input.project_id ?? null,
    p_key: null,
  });
  const res = fromSeam<unknown>(SERVICE, data, error);
  if (res.error) return res;
  return getStatement(input.statement_no);
}

/** Leaving a line out, with a reason (D182). */
export async function ignoreStatementLine(
  input: { statement_no: string; line_id: string; note: string },
): Promise<Result<BankStatementView>> {
  const { data, error } = await db().rpc("ignore_statement_line", {
    p_line_id: input.line_id,
    p_note: input.note,
    p_key: null,
  });
  const res = fromSeam<unknown>(SERVICE, data, error);
  if (res.error) return res;
  return getStatement(input.statement_no);
}
