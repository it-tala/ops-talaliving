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
 *
 *  `bookEvidence` is not a third one, and the distinction is worth stating
 *  because it looks like one. ADR-006's own words: `post_transaction` is the
 *  only grantee of INSERT on its tables, *"everything else calls them"*.
 *  `book_evidence` calls it and adds no rule about money — what it adds is
 *  the inbox row moving in the same transaction as the posting, so a
 *  document cannot end up booked and still queued.
 */
import type {
  Account, AccountBalance, TransactionView, TransactionDetail,
  TransactionType, Direction, AllocMethod, InboxStatus, InboxHealth,
  TrxStatus, BankStatementView, StatementLineView, StatementMatch,
  TransactionTypeCode, PaymentAllocation, VendorPayment, CashOverride, CashSettlement,
  CashComponent, CashAmountKind, CashPlan, CashMonth, CashMonthDetail, CashDue, CashDayRow,
  CashCell, CashRow, MonthlyBill, MonthlyBills, AssetRentSchedule, AccountCode,
  InboxOrigin, EvidenceInboxRow, IncomingMoney,
  DocumentCoverage, TransactionCoverage, CoverageTransaction,
  CoverageLine, CoveragePayment,
} from "@/services/accounting/contracts";
import type { DocKind } from "@/services/documents/contracts";
import type { ContributionAuditGroup } from "@/services/hr/contracts";
import type { LineCoverage } from "@/services/procurement/contracts";
import { supabaseBrowser } from "@/lib/supabase/client";
import { getActiveLocale, formatIDRCompact } from "@/lib/format";
import { officeToday } from "@/lib/office";
import { fail, fromSeam, fromPage, fromRows, invalid, notFound, ok, type Result } from "./_kit";

const SERVICE = "accounting" as const;

/** The shape of `src/demo/state.ts`'s `AuditRow`, restated here rather than
 *  imported from it: this module is the real implementation and does not
 *  depend on the demo one, the same way `src/demo/api` does not depend on
 *  this file. `check-api-parity.mjs` compares the two structurally, so this
 *  only has to match the shape — it does not have to share the declaration. */
interface AuditRow {
  id: string;
  at: string;
  actor_id: string;
  actor_email: string;
  service: string;
  entity: string;
  entity_no: string;
  action: string;
  outcome: "ok" | "refused" | "duplicate" | "noop";
  reason: string | null;
  detail?: Record<string, unknown> | null;
}

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
  Invoice: "invoice",
  "Receiving Report": "receiving_report",
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
/* Master data (0105): accounts and transaction types                  */
/* ------------------------------------------------------------------ */

async function accountByCode(code: string): Promise<Result<Account>> {
  const { data, error } = await db().from("accounts").select("*").eq("code", code).maybeSingle();
  if (error) return fail(SERVICE, error);
  if (!data) return notFound(SERVICE, "account_not_found", "No such account.");
  return ok(SERVICE, { ...data, opening_balance: Number(data.opening_balance) } as Account);
}

async function typeByCode(code: string): Promise<Result<TransactionType>> {
  const { data, error } = await db().from("transaction_types").select("*").eq("code", code).maybeSingle();
  if (error) return fail(SERVICE, error);
  if (!data) return notFound(SERVICE, "type_not_found", "No such transaction type.");
  return ok(SERVICE, data as TransactionType);
}

/** Accounting write, `post_ledger`, and `approve_funds` for anything touching
 *  a leadership account — all decided by the seam (`0105`). */
export async function createAccount(input: {
  code: string; name: string; custody: Account["custody"]; is_paying?: boolean;
  currency?: string; opening_balance?: number; opened_on?: string;
}): Promise<Result<Account>> {
  const { data, error } = await db().rpc("create_account", {
    p_code: input.code, p_name: input.name, p_custody: input.custody,
    p_is_paying: input.is_paying ?? false, p_currency: input.currency ?? "IDR",
    p_opening_balance: input.opening_balance ?? 0, p_opened_on: input.opened_on ?? null,
  });
  const res = fromSeam<{ code: string }>(SERVICE, data, error);
  if (res.error) return res;
  return accountByCode(res.data.code);
}

/** Every field optional; an opening balance change needs `reason`, which the
 *  audit log keeps with the value before and after. */
export async function updateAccount(
  code: string,
  input: {
    name?: string; custody?: Account["custody"]; is_paying?: boolean; currency?: string;
    opening_balance?: number; opened_on?: string; is_active?: boolean; reason?: string;
  },
): Promise<Result<Account>> {
  const { data, error } = await db().rpc("update_account", {
    p_code: code,
    p_name: input.name ?? null,
    p_custody: input.custody ?? null,
    p_is_paying: input.is_paying ?? null,
    p_currency: input.currency ?? null,
    p_opening_balance: input.opening_balance ?? null,
    p_opened_on: input.opened_on ?? null,
    p_is_active: input.is_active ?? null,
    p_reason: input.reason ?? null,
  });
  const res = fromSeam(SERVICE, data, error);
  if (res.error) return res;
  return accountByCode(code);
}

export async function deleteAccount(code: string): Promise<Result<{ code: string; deleted: true }>> {
  const { data, error } = await db().rpc("delete_account", { p_code: code });
  const res = fromSeam(SERVICE, data, error);
  if (res.error) return res;
  return ok(SERVICE, { code, deleted: true as const });
}

export async function createTransactionType(input: {
  code: string; is_purchase?: boolean; auto_complete?: boolean;
  creates_catalog_item?: boolean; description?: string;
}): Promise<Result<TransactionType>> {
  const { data, error } = await db().rpc("create_transaction_type", {
    p_code: input.code,
    p_is_purchase: input.is_purchase ?? true,
    p_auto_complete: input.auto_complete ?? false,
    p_creates_catalog_item: input.creates_catalog_item ?? false,
    p_description: input.description ?? null,
  });
  const res = fromSeam<{ code: string }>(SERVICE, data, error);
  if (res.error) return res;
  return typeByCode(res.data.code);
}

export async function updateTransactionType(
  code: string,
  input: {
    is_purchase?: boolean; auto_complete?: boolean; creates_catalog_item?: boolean;
    description?: string; is_active?: boolean;
  },
): Promise<Result<TransactionType>> {
  const { data, error } = await db().rpc("update_transaction_type", {
    p_code: code,
    p_is_purchase: input.is_purchase ?? null,
    p_auto_complete: input.auto_complete ?? null,
    p_creates_catalog_item: input.creates_catalog_item ?? null,
    p_description: input.description ?? null,
    p_is_active: input.is_active ?? null,
  });
  const res = fromSeam(SERVICE, data, error);
  if (res.error) return res;
  return typeByCode(code);
}

export async function deleteTransactionType(code: string): Promise<Result<{ code: string; deleted: true }>> {
  const { data, error } = await db().rpc("delete_transaction_type", { p_code: code });
  const res = fromSeam(SERVICE, data, error);
  if (res.error) return res;
  return ok(SERVICE, { code, deleted: true as const });
}

/* ------------------------------------------------------------------ */
/* The ledger                                                          */
/* ------------------------------------------------------------------ */

/** `description.ilike."%needle%",trx_no.ilike."%needle%"` — quoted, because a
 *  comma or parenthesis typed into the search box is filter syntax to
 *  PostgREST, not search text, and unquoted it either breaks the `.or()`
 *  below or lets free-text input add a clause nobody typed. */
function ilikeOrFilter(q: string, ...columns: string[]): string {
  const escaped = q.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const pattern = `"%${escaped}%"`;
  return columns.map((c) => `${c}.ilike.${pattern}`).join(",");
}

export async function listTransactions(
  opts: {
    account_id?: string; type_code?: string; q?: string;
    project_code?: string; include_void?: boolean;
    /** Inclusive `YYYY-MM-DD` bounds on `trx_date`. */
    from?: string; to?: string;
    direction?: "IN" | "OUT";
    limit?: number; offset?: number;
  } = {},
): Promise<Result<TransactionView[]>> {
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;
  let q = db().from("v_transaction").select("*", { count: "exact" });
  if (!opts.include_void) q = q.neq("status", "VOID");
  if (opts.account_id) q = q.eq("account_id", opts.account_id);
  if (opts.project_code) q = q.eq("project_code", opts.project_code);
  if (opts.type_code) q = q.eq("type_code", opts.type_code);
  if (opts.direction) q = q.eq("direction", opts.direction);
  if (opts.from) q = q.gte("trx_date", opts.from);
  if (opts.to) q = q.lte("trx_date", opts.to);
  if (opts.q) q = q.or(ilikeOrFilter(opts.q, "description", "trx_no"));
  const { data, error, count } = await q
    .order("trx_date", { ascending: false })
    .order("trx_no", { ascending: false })
    .range(offset, offset + limit - 1);
  return fromPage<TransactionView>(SERVICE, data as TransactionView[], count, error, limit, offset);
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
export async function historyFor(trxNo: string): Promise<Result<AuditRow[]>> {
  /* One of two objects this module reads from outside its own schema — the
     other is `coverageFor`'s `ops_procure.v_line_coverage`, below. The audit
     log belongs to `ops_core` — one trail for the whole system, not one per
     service — so this call names that schema rather than the module's.
     Checked against the database rather than remembered:
     `scripts/check-api-schemas.mjs` reads every `.schema(...).from(...)` call
     in this file and confirms each one names the object's real home.
     `v_audit`, not the bare `audit_log` table: the table has no `actor_email`
     at all, and the contract needs it read back from `at` alone in every
     screen that shows this trail — `0023` already did that join once (`0086`
     added the table's own `actor_id` to the same view, on the same
     reasoning). */
  const { data, error } = await supabaseBrowser().schema("ops_core")
    .from("v_audit").select("*")
    /* The row's own actions, plus the documents linked to and unlinked from
       it — `attach_link`/`attach_unlink` file those as `attachment` under the
       row's code, with the kind and file name in `detail` (`0101`). */
    .in("entity", ["transaction", "attachment"]).eq("entity_no", trxNo)
    .order("at", { ascending: false });
  return fromRows<AuditRow[]>(SERVICE, data as AuditRow[], error);
}

/** What a line is covered for, in the shape the demo's `lineCoverage()`
 *  answers (`line_id`, `approved`, `covered`, `remaining`, `settled`) — not
 *  the allocation rows behind it, which `ops_procure.v_allocation` gives and
 *  which is a different question (*what paid for it*, not *how much of it is
 *  paid*). `ops_procure.v_line_coverage` already computes exactly this for
 *  every line `v_pr_line`'s own `coverage_*` columns draw from — a second
 *  cross-schema read alongside `historyFor`'s, because coverage is owned by
 *  procurement the same way the audit trail is owned by core. */
export async function coverageFor(lineNoFull: string): Promise<Result<LineCoverage>> {
  const { data, error } = await supabaseBrowser().schema("ops_procure")
    .from("v_line_coverage").select("line_id, approved, covered, remaining, settled")
    .eq("line_no_full", lineNoFull).maybeSingle();
  if (error) return fail(SERVICE, error);
  if (!data) return notFound(SERVICE, "line_not_found", `Line ${lineNoFull} not found.`);
  return ok(SERVICE, data as LineCoverage);
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
  /* `accounts` lives in `ops_acct`; `vendors` and `projects` are procurement's
     (ADR-004 again, one level down) — reading either through `db()`'s
     `ops_acct` binding asks PostgREST for a table that schema does not have. */
  const client = table === "accounts" ? db() : supabaseBrowser().schema("ops_procure");
  const { data } = await client.from(table).select("code").eq("id", id).maybeSingle();
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

/** Book one document — the whole nota, in one act.
 *
 *  ## Why this is not a third write seam
 *
 *  The note at the top of this file says two write seams and only two, and
 *  that adding a third is how the check gets skipped. This is not one.
 *  ADR-006 is precise about it: `post_transaction` is *"the only grantee of
 *  INSERT on their tables; **everything else calls them**"* — and this is the
 *  everything else. `ops_acct.book_evidence` writes no ledger row itself; it
 *  calls `post_transaction`, which still owns every rule about money. Not one
 *  of those rules is restated, here or in the seam.
 *
 *  ## What it buys, which two calls could not
 *
 *  The screen used to post the transaction and then resolve the inbox row,
 *  and its own toast admitted the gap: **"Posted, inbox unchanged"**. That
 *  state is a document already in the ledger and still sitting in the queue,
 *  which the next person confirms again. One call, one answer, or nothing.
 *
 *  And the lines. One nota is one date, one vendor, one project, and several
 *  things bought — so the person confirms **the document**, not each line
 *  (owner, 2026-09-23). The seam refuses when the lines do not add up to the
 *  document total, which is the net for a nota read as 3 items of 5.
 */
export async function bookEvidence(
  input: {
    ref_id: string;
    /** The other inbox rows of the **same photo**. The capture worker files
     *  one row per slot it read (`<event>~x0`, `~x1`, …), so one nota can
     *  arrive as several rows; they are booked as one document and closed
     *  together (0157). */
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
    lines?: { description: string; qty?: number | null; uom?: string | null;
              unit_price?: number | null; amount: number }[];
  },
  idempotencyKey?: string,
): Promise<Result<TransactionView>> {
  const accountCode = await codeFor("accounts", input.account_id);
  if (!accountCode) {
    return invalid(SERVICE, "account_not_found",
      "Akun itu tidak ada di database.", { field: "account_id" });
  }

  /* One photo filed as several rows goes through `book_evidence_group`,
     which calls `book_evidence` for the first and closes the rest against
     the same ledger row, in the same transaction. */
  const also = (input.also_ref_ids ?? []).filter((r) => r && r !== input.ref_id);
  const args = {
    p_account_code: accountCode,
    p_direction: input.direction,
    p_amount: input.amount_idr,
    p_type_code: input.type_code,
    p_description: input.description,
    p_trx_date: input.trx_date,
    p_vendor_code: await codeFor("vendors", input.vendor_id),
    p_project_code: await codeFor("projects", input.project_id),
    p_lines: input.lines ?? [],
    p_remark: input.remark ?? null,
    p_key: idempotencyKey ?? null,
  };
  const { data, error } = also.length > 0
    ? await db().rpc("book_evidence_group", { p_ref_ids: [input.ref_id, ...also], ...args })
    : await db().rpc("book_evidence", { p_ref_id: input.ref_id, ...args });

  const booked = fromSeam<{ trx_no: string; lines: number; amount: number }>(
    SERVICE, data, error);
  if (booked.error) return booked;

  /* Same reasoning as `postTransaction`: the row exists whether or not this
     read succeeds, so a failed read is returned as itself rather than dressed
     as a failed booking. Retrying a booking that already happened is how a
     payment gets made twice. */
  const row = await db().from("v_transaction").select("*").eq("trx_no", booked.data.trx_no).single();
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

/** Paying an order from its own screen (B8, `ops_acct.post_to_po`, 0139).
 *  The seam splits the money across the order's linked request lines; this
 *  passes the arguments and re-reads the row, like `postFromLine`. */
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
  const accountCode = await codeFor("accounts", input.account_id);
  if (!accountCode) {
    return invalid(SERVICE, "account_not_found",
      "Akun itu tidak ada di database.", { field: "account_id" });
  }
  const { data, error } = await db().rpc("post_to_po", {
    p_po_no:         input.po_no,
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
  const row = await db()
    .from("v_transaction").select("*").eq("trx_no", posted.data.trx_no).single();
  return fromRows<TransactionView>(SERVICE, row.data as TransactionView | null, row.error);
}

/** Paying an approved payroll run from its page (F154, `ops_acct.post_payroll_run`,
 *  0149). One ledger row for the whole run — never one per person — and the
 *  run marked PAID in the same call. */
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
  const accountCode = await codeFor("accounts", input.account_id);
  if (!accountCode) {
    return invalid(SERVICE, "account_not_found",
      "Akun itu tidak ada di database.", { field: "account_id" });
  }
  const { data, error } = await db().rpc("post_payroll_run", {
    p_run_no:        input.run_no,
    p_amount:        input.amount,
    p_account_code:  accountCode,
    p_attachment_id: input.attachment_id || null,
    p_trx_date:      input.trx_date,
    p_type_code:     input.type_code ?? null,
    p_document_kind: "Payment Proof",
    p_key:           idempotencyKey ?? null,
  });
  const posted = fromSeam<{ trx_no: string }>(SERVICE, data, error);
  if (posted.error) return posted;
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

/** Correcting a row in place — amount (with a remark) and description
 *  (`0101`). The seam writes the audit row with the remark as its reason and
 *  the values before and after as its detail; this reads the row back. */
/** Correcting a ledger row in place.
 *
 *  `vendor_code`, `project_code` and `type_code` arrived with `0105`, and the
 *  three-state argument is the part to read carefully:
 *
 *    omitted   leave the field as it is
 *    `""`      take it off — the row has no vendor / no project
 *    a code    resolve it, or the seam refuses rather than creating one
 *
 *  `undefined → null` is what makes *leave it alone* the default, which is the
 *  behaviour a description-only edit needs: without it, every typo fix would
 *  quietly clear the vendor. `type_code` has no clearing case — the column is
 *  `not null`, and `OTHERS` is what this system calls unclassified.
 */
export async function editTransaction(
  input: {
    trx_no: string;
    amount_idr?: number;
    description?: string;
    vendor_code?: string | null;
    project_code?: string | null;
    type_code?: string;
    reason?: string;
  },
  idempotencyKey?: string,
): Promise<Result<TransactionView>> {
  const { data, error } = await db().rpc("edit_transaction", {
    p_trx_no: input.trx_no,
    p_amount: input.amount_idr ?? null,
    p_description: input.description ?? null,
    p_vendor_code: input.vendor_code ?? null,
    p_project_code: input.project_code ?? null,
    p_type_code: input.type_code ?? null,
    p_reason: input.reason ?? null,
    p_key: idempotencyKey ?? null,
  });
  const edited = fromSeam<{ trx_no: string }>(SERVICE, data, error);
  if (edited.error) return edited;

  const row = await db().from("v_transaction").select("*").eq("trx_no", edited.data.trx_no).single();
  return fromRows<TransactionView>(SERVICE, row.data as TransactionView | null, row.error);
}

/** A row moved past POSTED to COMPLETED — `post_ledger`, the same authority
 *  every seam in this file answers to, and nothing else (`0093`, read against
 *  `void_transaction` rather than invented). */
export async function markComplete(trxNo: string): Promise<Result<TransactionView>> {
  const { data, error } = await db().rpc("complete_transaction", { p_trx_no: trxNo });
  const completed = fromSeam<{ trx_no: string; status: string }>(SERVICE, data, error);
  if (completed.error) return completed;

  const row = await db().from("v_transaction").select("*").eq("trx_no", completed.data.trx_no).single();
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

/** The row as `evidence_inbox` stores it.
 *
 *  Named apart from `EvidenceInboxRow` because two of its fields do not carry
 *  the contract's names. `select("*") as EvidenceInboxRow[]` type-checks and
 *  is wrong: the screen reads `produced_trx_id` off an object whose key is
 *  `produced_trx_no`, gets `undefined`, and renders a blank where a ledger
 *  reference should be. A cast is not a mapping.
 */
interface InboxRowDb {
  id: string;
  ref_id: string;
  origin: InboxOrigin;
  status: InboxStatus;
  attachment_id: string;
  reported_by: string;
  reported_at: string;
  extracted: EvidenceInboxRow["extracted"] | null;
  money_direction: Direction | null;
  produced_trx_no: string | null;
  produced_pr_line_no: string | null;
}

/** Named rather than `*`, so adding a column to the table cannot silently
 *  change what this function answers. */
const INBOX_COLUMNS =
  "id, ref_id, origin, status, attachment_id, reported_by, reported_at, "
  + "extracted, money_direction, produced_trx_no, produced_pr_line_no";

function toInboxRow(r: InboxRowDb): Omit<EvidenceInboxRow, "reported_by_name"> {
  return {
    id: r.id,
    ref_id: r.ref_id,
    origin: r.origin,
    status: r.status,
    attachment_id: r.attachment_id,
    reported_by: r.reported_by,
    reported_at: r.reported_at,
    /* `{}` and not `null`: every field inside is optional and the screen reads
       `extracted.amount_idr` without guarding the parent. */
    extracted: r.extracted ?? {},
    /* The contract calls it `produced_trx_id` and the column holds a trx_no,
       because ADR-004 keeps public codes on the wire rather than uuids. The
       mismatch is the contract's, and renaming it is a change to fifty-two
       screens; translating it is a line here. */
    produced_trx_id: r.produced_trx_no,
    produced_pr_line_no: r.produced_pr_line_no,
    /* **Empty because nothing computes it**, not because there is nothing.
       The legacy queue carried a `similar_trx` column its pipeline filled;
       this schema has no equivalent and no view derives one. An empty list is
       the honest answer — "we did not look" — and the fixtures carry the same.
       Give it a source and this stops being a literal. */
    similar_trx_nos: [],
    money_direction: r.money_direction,
  };
}

/** Who `reported_by` is, spelled out — batched, so a queue of twenty rows is
 *  one extra query rather than twenty. */
async function withReporterNames(
  rows: Omit<EvidenceInboxRow, "reported_by_name">[],
): Promise<Result<EvidenceInboxRow[]>> {
  if (rows.length === 0) return ok(SERVICE, []);
  const ids = [...new Set(rows.map((r) => r.reported_by))];
  const { data, error } = await core().from("users").select("id, full_name").in("id", ids);
  if (error) return fail(SERVICE, error);
  const nameOf = new Map((data ?? []).map((u) => [u.id as string, u.full_name as string]));
  return ok(SERVICE, rows.map((r) => ({ ...r, reported_by_name: nameOf.get(r.reported_by) ?? null })));
}

export async function listInbox(): Promise<Result<EvidenceInboxRow[]>> {
  const { data, error } = await db().from("evidence_inbox").select(INBOX_COLUMNS)
    .eq("status", "PENDING").order("reported_at", { ascending: false });
  if (error) return fail(SERVICE, error);
  return withReporterNames(((data ?? []) as unknown as InboxRowDb[]).map(toInboxRow));
}

export async function listInboxAll(): Promise<Result<EvidenceInboxRow[]>> {
  const { data, error } = await db().from("evidence_inbox").select(INBOX_COLUMNS)
    .order("reported_at", { ascending: false });
  if (error) return fail(SERVICE, error);
  return withReporterNames(((data ?? []) as unknown as InboxRowDb[]).map(toInboxRow));
}

/** The last `limit` decided rows, newest first, with the total so the screen
 *  can say how many it is not showing. The history grows forever; the screen
 *  only ever asks the question about the recent ones. */
export async function listInboxDecided(limit = 20): Promise<Result<EvidenceInboxRow[]>> {
  const { data, error, count } = await db().from("evidence_inbox")
    .select(INBOX_COLUMNS, { count: "exact" })
    .neq("status", "PENDING")
    .order("reported_at", { ascending: false })
    .limit(limit);
  if (error) return fail(SERVICE, error);
  const named = await withReporterNames(((data ?? []) as unknown as InboxRowDb[]).map(toInboxRow));
  if (named.error) return named;
  const total = count ?? named.data.length;
  return ok(SERVICE, named.data, { limit, cursor: null, has_more: total > limit, total });
}

/** Not decoration. If this number grows, people are routing around the normal
 *  road — attaching from the record — and the reason is worth finding
 *  (ADR-010).
 *
 *  `v_inbox_health` (`0020`) has no `by_origin` column — a view answers flat
 *  rows, and `InboxOrigin`'s two counts are `from_chat`/`from_web` there,
 *  never nested. The blind `as unknown as InboxHealth` this used to end on
 *  hid exactly that: `check-api-parity.mjs` checks declared types, and a
 *  double cast satisfies it whether or not the value underneath has the
 *  field at all — `by_origin` was undefined on every real call, and
 *  `/accounting/verifikasi` read `.chat` off it and crashed the page. */
export async function getInboxHealth(): Promise<Result<InboxHealth>> {
  const { data, error } = await db().from("v_inbox_health").select("*").maybeSingle();
  if (error) return fail(SERVICE, error);
  if (!data) return notFound(SERVICE, "inbox_health_missing", "The inbox health row could not be read.");
  return ok(SERVICE, {
    week_start: data.week_start as string,
    arrived: data.arrived as number,
    unresolved: data.unresolved as number,
    by_origin: { chat: data.from_chat as number, web: data.from_web as number },
  });
}

/** Five roads out, **none of which delete** (F26, D94). A document that
 *  reached the inbox and left it without a trace is the failure this road
 *  exists to prevent: somebody sent it, and "we never got it" must never be
 *  the answer. */
type InboxResolution = "transaction" | "retro_pr_line" | "link" | "note" | "reject";

/** The road the screen names, and the status it arrives at.
 *
 *  Two roads land on `CONFIRMED` because *it became a ledger row* and *it
 *  became a request line that was then paid* are the same outcome as far as
 *  the document is concerned — the difference is recorded in
 *  `produced_pr_line_no`, which is the point of `0039`.
 */
const RESOLUTION_STATUS: Record<InboxResolution, InboxStatus> = {
  transaction: "CONFIRMED",
  retro_pr_line: "CONFIRMED",
  link: "ATTACHED",
  note: "NOTED",
  reject: "REJECTED",
};

export async function resolveInbox(
  input: {
    ref_id: string;
    resolution: InboxResolution;
    /** What it produced, when it produced something. */
    trx_no?: string;
    pr_line_no?: string;
    /** Mandatory for `reject` and `note`: a row nobody explained is a row
     *  nobody can review. Both are enforced by the seam (`0039`). */
    reason?: string;
  },
  idempotencyKey?: string,
): Promise<Result<EvidenceInboxRow>> {
  const { data, error } = await db().rpc("resolve_inbox", {
    p_ref_id: input.ref_id,
    p_status: RESOLUTION_STATUS[input.resolution],
    p_trx_no: input.trx_no ?? null,
    p_pr_line_no: input.pr_line_no ?? null,
    p_note: input.reason ?? null,
    p_key: idempotencyKey ?? null,
  });

  const res = fromSeam<{ ref_id: string }>(SERVICE, data, error);
  if (res.error) return res;

  /* The seam answers a receipt; the screen redraws the row. **Re-read rather
     than reconstruct** — `resolved_at`, `resolved_by` and the link the seam
     wrote are the database's to state, and a receipt assembled here would
     disagree with it the first time either changes. */
  const after = await db().from("evidence_inbox").select(INBOX_COLUMNS)
    .eq("ref_id", input.ref_id).maybeSingle();
  if (after.error) return fail(SERVICE, after.error);
  if (!after.data) {
    return notFound(SERVICE, "inbox_row_not_found", `Row ${input.ref_id} not found.`);
  }
  const named = await withReporterNames([toInboxRow(after.data as unknown as InboxRowDb)]);
  if (named.error) return named;
  return ok(SERVICE, named.data[0]);
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
  const code = opts.account_code ?? "BCA 271";
  const { data: acc, error: accErr } = await db().from("accounts").select("id").eq("code", code).maybeSingle();
  if (accErr) return fail(SERVICE, accErr);
  if (!acc) return ok(SERVICE, []);

  const { data, error } = await db().from("transactions")
    .select("trx_no, trx_date, amount_idr, description")
    .eq("account_id", (acc as { id: string }).id).eq("direction", "IN").neq("status", "VOID")
    .order("trx_date", { ascending: false }).order("trx_no", { ascending: false });
  if (error) return fail(SERVICE, error);
  const rows = (data ?? []) as { trx_no: string; trx_date: string; amount_idr: number; description: string }[];
  if (rows.length === 0) return ok(SERVICE, []);

  const trxNos = rows.map((r) => r.trx_no);
  const { data: links, error: linkErr } = await core().from("attachment_links")
    .select("attachment_id, entity_no")
    .eq("entity", "transaction").eq("kind", "transfer_proof").is("unlinked_at", null)
    .in("entity_no", trxNos);
  if (linkErr) return fail(SERVICE, linkErr);
  const attByTrx = new Map(((links ?? []) as { attachment_id: string; entity_no: string }[])
    .map((l) => [l.entity_no, l.attachment_id]));

  const attIds = [...new Set(attByTrx.values())];
  const { data: atts, error: attErr } = attIds.length
    ? await core().from("attachments").select("id, filename").in("id", attIds)
    : { data: [] as { id: string; filename: string }[], error: null };
  if (attErr) return fail(SERVICE, attErr);
  const filenameOf = new Map(((atts ?? []) as { id: string; filename: string }[]).map((a) => [a.id, a.filename]));

  return ok(SERVICE, rows.map((r) => {
    const attId = attByTrx.get(r.trx_no) ?? null;
    return {
      trx_no: r.trx_no, trx_date: r.trx_date, account_code: code,
      amount_idr: r.amount_idr, description: r.description,
      proof_attachment_id: attId, proof_filename: attId ? (filenameOf.get(attId) ?? null) : null,
    };
  }));
}

/** Rows waiting in the inbox that are money coming IN.
 *
 *  Almost everything in that inbox is somebody who bought first. A transfer
 *  proof dropped in chat by leadership is the other direction, and it is
 *  waiting for a different act by a different person — booking it, not
 *  matching it to a purchase. */
export async function listIncomingReview(): Promise<Result<EvidenceInboxRow[]>> {
  const { data, error } = await db().from("evidence_inbox").select(INBOX_COLUMNS)
    .eq("status", "PENDING").eq("money_direction", "IN")
    .order("reported_at", { ascending: false });
  if (error) return fail(SERVICE, error);
  return withReporterNames(((data ?? []) as unknown as InboxRowDb[]).map(toInboxRow));
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
  const accountCode = await codeFor("accounts", input.account_id);
  if (!accountCode) {
    return invalid(SERVICE, "account_not_found", "Akun itu tidak ada di database.", { field: "account_id" });
  }

  const { data, error } = await db().rpc("confirm_incoming", {
    p_ref_id: input.ref_id,
    p_account_code: accountCode,
    p_trx_date: input.trx_date,
    p_amount: input.amount_idr,
    p_description: input.description ?? null,
    p_key: idempotencyKey ?? null,
  });
  return fromSeam<IncomingMoney>(SERVICE, data, error);
}

/* ------------------------------------------------------------------ */
/* Coverage — the questions asked before a document is booked          */
/* ------------------------------------------------------------------ */

/** Coverage is the one read in this service that genuinely spans three
 *  schemas: the paper is `ops_core`'s, the money is `ops_acct`'s, and the
 *  request line the money closes is `ops_procure`'s.
 *
 *  That is not ADR-004 being bent. The rule is that a service does not reach
 *  into another service's *decisions* — no writes, no reimplemented guards.
 *  These are reads of published views, and the demo derives exactly the same
 *  three sources from one state object. A screen asking "is this document
 *  already accounted for" is asking a question no single schema can answer.
 */
const core = () => supabaseBrowser().schema("ops_core");
const procure = () => supabaseBrowser().schema("ops_procure");

/** The request lines a set of transactions reaches, each with **every**
 *  payment against it — not only the ones these transactions made.
 *
 *  Showing only our own half is what makes a split-paid line read as half
 *  paid: the plywood bought with cash at the counter and settled by transfer
 *  the next day is one line and two transactions (D206), and a screen that
 *  sees one of them reports a gap that does not exist.
 */
async function coverageLines(trxNos: string[]): Promise<Result<CoverageLine[]>> {
  if (trxNos.length === 0) return ok(SERVICE, []);

  const mine = await db().from("v_allocation").select("pr_line_no")
    .in("trx_no", trxNos).is("superseded_by", null).not("pr_line_no", "is", null);
  if (mine.error) return fail(SERVICE, mine.error);

  const lineNos = [...new Set((mine.data ?? []).map((a) => a.pr_line_no as string))];
  if (lineNos.length === 0) return ok(SERVICE, []);

  /* Coverage and descriptions need only the line numbers, so they are asked
     alongside the payments rather than after them. */
  const [all, cov, desc] = await Promise.all([
    db().from("v_allocation").select("trx_no, pr_line_no, amount, method")
      .in("pr_line_no", lineNos).is("superseded_by", null),
    procure().from("v_line_coverage")
      .select("line_no_full, approved, covered, remaining, settled").in("line_no_full", lineNos),
    procure().from("v_pr_line")
      .select("line_no_full, description").in("line_no_full", lineNos),
  ]);
  if (all.error) return fail(SERVICE, all.error);
  const payments = (all.data ?? []) as {
    trx_no: string; pr_line_no: string; amount: number | string; method: AllocMethod;
  }[];

  /* Which account each paying transaction came out of. The screen shows it so
     a person can tell the cash half from the transfer half at a glance. */
  const payingTrx = [...new Set(payments.map((a) => a.trx_no))];
  const accts = await db().from("v_transaction").select("trx_no, account_code").in("trx_no", payingTrx);
  if (accts.error) return fail(SERVICE, accts.error);
  const accountOf = new Map(
    ((accts.data ?? []) as { trx_no: string; account_code: string }[])
      .map((t) => [t.trx_no, t.account_code]),
  );

  /* Approved, covered, remaining and settled come from the view. **Not
     recomputed here** (A3): a second opinion about whether a line is settled
     is how a screen and the board disagree. */
  if (cov.error) return fail(SERVICE, cov.error);
  const covOf = new Map(
    ((cov.data ?? []) as {
      line_no_full: string; approved: number | string; covered: number | string;
      remaining: number | string; settled: boolean;
    }[]).map((c) => [c.line_no_full, c]),
  );

  if (desc.error) return fail(SERVICE, desc.error);
  const descOf = new Map(
    ((desc.data ?? []) as { line_no_full: string; description: string }[])
      .map((d) => [d.line_no_full, d.description]),
  );

  const ours = new Set(trxNos);
  return ok(SERVICE, lineNos.map((no) => {
    const c = covOf.get(no);
    return {
      line_no_full: no,
      description: descOf.get(no) ?? "—",
      approved: Number(c?.approved ?? 0),
      covered: Number(c?.covered ?? 0),
      remaining: Number(c?.remaining ?? 0),
      settled: c?.settled ?? false,
      payments: payments.filter((a) => a.pr_line_no === no).map((a): CoveragePayment => ({
        trx_no: a.trx_no,
        account_code: accountOf.get(a.trx_no) ?? "—",
        method: a.method,
        amount: Number(a.amount),
        from_this_document: ours.has(a.trx_no),
      })),
    };
  }));
}

/** What one document already stands behind.
 *
 *  Asked before booking it again, which is the duplicate this screen exists to
 *  prevent: the same nota photographed twice, or sent to two chat groups.
 */
export async function coverageForDocument(
  attachmentId: string,
  documentAmount: number | null = null,
): Promise<Result<DocumentCoverage>> {
  const [links, names] = await Promise.all([
    core().from("attachment_links").select("entity_no")
      .eq("attachment_id", attachmentId).eq("entity", "transaction").is("unlinked_at", null),
    db().from("accounts").select("code, name"),
  ]);
  if (links.error) return fail(SERVICE, links.error);
  const trxNos = [...new Set(((links.data ?? []) as { entity_no: string }[]).map((l) => l.entity_no))];

  const [trx, lines] = await Promise.all([
    db().from("v_transaction")
      .select("trx_no, trx_date, account_code, direction, amount_idr, status, description, evidence_count")
      .in("trx_no", trxNos),
    coverageLines(trxNos),
  ]);
  if (trx.error) return fail(SERVICE, trx.error);

  if (names.error) return fail(SERVICE, names.error);
  const nameOf = new Map(
    ((names.data ?? []) as { code: string; name: string }[]).map((a) => [a.code, a.name]),
  );

  const transactions: CoverageTransaction[] =
    ((trx.data ?? []) as {
      trx_no: string; trx_date: string; account_code: string; direction: Direction;
      amount_idr: number | string; status: TrxStatus; description: string;
      evidence_count: number | null;
    }[]).map((t) => ({
      trx_no: t.trx_no,
      trx_date: t.trx_date,
      account_code: t.account_code,
      account_name: nameOf.get(t.account_code) ?? "—",
      direction: t.direction,
      /* A void row moved no money. Counting its face value is how a document
         reads as fully accounted for by a transaction somebody cancelled. */
      amount_idr: t.status === "VOID" ? 0 : Number(t.amount_idr),
      status: t.status,
      description: t.description,
      /* The view counts every piece of paper on the row, this one included. */
      other_documents: Math.max(0, Number(t.evidence_count ?? 0) - 1),
    }));

  if (lines.error) return lines;

  const coveredTotal = transactions.reduce((n, t) => n + t.amount_idr, 0);
  return ok(SERVICE, {
    attachment_id: attachmentId,
    document_amount: documentAmount,
    transactions,
    lines: lines.data,
    covered_total: coveredTotal,
    /* Null rather than `0 − covered`: a gap measured against an amount nobody
       ever read is the whole sum wearing the costume of a discrepancy. */
    gap: documentAmount === null ? null : documentAmount - coveredTotal,
    shared: transactions.some((t) => t.other_documents > 0),
  });
}

/** What a ledger row already carries, before a document is attached to it.
 *
 *  This is the end the check actually bites at. A document in the queue is
 *  attached to nothing, so its own coverage is empty and says nothing; what
 *  decides whether *link* is the right road is the state of the row being
 *  linked to (D207).
 */
export async function coverageForTransaction(trxNo: string): Promise<Result<TransactionCoverage>> {
  /* The row, its documents (links, then their filenames), its allocations and
     its lines are independent reads, asked together. */
  const [t, { links, atts }, alloc, lines] = await Promise.all([
    db().from("v_transaction")
      .select("trx_no, amount_idr, status, account_code, description, allocated_total, unallocated")
      .eq("trx_no", trxNo).maybeSingle(),
    (async () => {
      const links = await core().from("attachment_links").select("attachment_id, kind")
        .eq("entity", "transaction").eq("entity_no", trxNo).is("unlinked_at", null);
      if (links.error) return { links, atts: null };
      const atts = await core().from("attachments").select("id, filename")
        .in("id", ((links.data ?? []) as { attachment_id: string }[]).map((l) => l.attachment_id));
      return { links, atts };
    })(),
    db().from("v_allocation").select("pr_line_no, po_no, amount, method")
      .eq("trx_no", trxNo).is("superseded_by", null),
    coverageLines([trxNo]),
  ]);
  if (t.error) return fail(SERVICE, t.error);
  if (!t.data) return notFound(SERVICE, "transaction_not_found", `Tidak ada transaksi ${trxNo}.`);
  const row = t.data as unknown as {
    trx_no: string; amount_idr: number | string; status: TrxStatus; account_code: string;
    description: string; allocated_total: number | string | null; unallocated: number | string | null;
  };

  if (links.error) return fail(SERVICE, links.error);
  const linkRows = (links.data ?? []) as { attachment_id: string; kind: string }[];

  if (atts?.error) return fail(SERVICE, atts.error);
  const fileOf = new Map(
    ((atts?.data ?? []) as { id: string; filename: string }[]).map((a) => [a.id, a.filename]),
  );

  if (alloc.error) return fail(SERVICE, alloc.error);

  if (lines.error) return lines;

  return ok(SERVICE, {
    trx_no: row.trx_no,
    amount_idr: Number(row.amount_idr),
    status: row.status,
    account_code: row.account_code,
    description: row.description,
    documents: linkRows.map((l) => ({
      attachment_id: l.attachment_id,
      filename: fileOf.get(l.attachment_id) ?? "—",
      kind: l.kind,
    })),
    allocations: ((alloc.data ?? []) as {
      pr_line_no: string | null; po_no: string | null; amount: number | string; method: AllocMethod;
    }[]).map((a) => ({
      target: (a.pr_line_no ?? a.po_no ?? "—"),
      kind: (a.pr_line_no ? "line" : "po") as "line" | "po",
      amount: Number(a.amount),
      method: a.method,
    })),
    /* The view's numbers, not a sum of the list above: an allocation the view
       counts and this query missed would otherwise read as unallocated money. */
    allocated_total: Number(row.allocated_total ?? 0),
    unallocated: Number(row.unallocated ?? 0),
    lines: lines.data,
  });
}

/* ------------------------------------------------------------------ */
/* The payment calendar                                                */
/* ------------------------------------------------------------------ */

/** Twelve months, planned against actual — computed on every read from three
 *  tables and the ledger as it stands. **No projection is stored** (D109–D115):
 *  a stored one disagrees with the ledger the moment a payment lands.
 *
 *  The engine — occurrence dates, claim order, the fuzzy match against the
 *  ledger, the running balance — is `ops_acct.cash_plan()` (`0091`), ported
 *  from `cashPlan()` one branch at a time and proved against
 *  `smoke/86_acct_cash_plan.sql`. Two things stay here rather than in SQL:
 *  `label` (a locale-formatted month name — locale is a per-request concern
 *  the database does not have) and `verdict` (formatting a Rupiah figure into
 *  a sentence is presentation, the same boundary `formatShort` sits on in the
 *  demo). Both are built from data the seam already returns
 *  (`short_month` / `short_by` / each month's `closing`), so nothing is
 *  computed here that the database has not already decided. */
export async function getCashPlan(): Promise<Result<CashPlan>> {
  return planFrom();
}

/** The same plan anchored at a month's first day (`0114`'s `p_from`) —
 *  Monthly bills compares a month with the one before it, and the default
 *  window starts today. */
async function planFrom(from?: string): Promise<Result<CashPlan>> {
  /* The calendar asks for the plan twice as it opens — the grid and "Due
     next" — and each ask is the whole twelve-month loop in the database. Two
     asks that are in flight at once share one request. Nothing is kept once
     it answers: the next ask, after a link or an edit, goes to the database. */
  const key = from ?? "";
  const pending = planInFlight.get(key);
  if (pending) return pending;
  const run = readPlan(from).finally(() => planInFlight.delete(key));
  planInFlight.set(key, run);
  return run;
}

const planInFlight = new Map<string, Promise<Result<CashPlan>>>();

async function readPlan(from?: string): Promise<Result<CashPlan>> {
  const { data, error } = from
    ? await db().rpc("cash_plan", { p_from: from })
    : await db().rpc("cash_plan");
  if (error) return fail(SERVICE, error);
  const plan = data as Omit<CashPlan, "months" | "verdict"> & {
    months: Omit<CashMonth, "label">[];
  };

  const months: CashMonth[] = plan.months.map((m) => ({ ...m, label: monthLabel(m.month) }));
  const last = months[months.length - 1];
  const verdict = plan.short_month
    ? `On this plan the money runs out in ${monthLabel(plan.short_month)} — ${formatIDRCompact(plan.short_by)} short.`
    : `The plan holds through ${last.label}, ending at ${formatIDRCompact(last.closing)}.`;

  return ok(SERVICE, { ...plan, months, verdict });
}

function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(getActiveLocale(), { month: "short", year: "numeric" });
}

/** `to − from`, in whole days, the same WITA-anchored arithmetic
 *  `src/demo/derive.ts`'s own `daysBetween` uses — so a "3 hari lagi" here and
 *  in the demo never disagree over which side of midnight a date fell on. */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00+08:00`) - Date.parse(`${from}T00:00:00+08:00`)) / 86_400_000);
}

/** One month opened up, day by day, with the balance running through it.
 *
 *  Not a seam of its own: `cashMonthDetail` in the demo is `cashPlan()` read
 *  from one angle — every event behind the month's twelve rows, sorted into a
 *  day order, with a balance walked across them the same way the twelve-month
 *  view walks a balance across months. `getCashPlan()` already carries every
 *  event this needs; redoing the walk here is the same boundary
 *  `getCashPlan`'s own `verdict`/`label` sit on — presentation built from data
 *  the database already decided, not a second derivation racing the
 *  database's (0091's header, on `undated_obligations`/`short_by`). */
export async function getMonthDetail(month: string): Promise<Result<CashMonthDetail>> {
  const plan = await getCashPlan();
  if (plan.error) return plan;

  const index = plan.data.months.findIndex((m) => m.month === month);
  if (index === -1) {
    return notFound(SERVICE, "month_not_in_plan", `${month} is outside the twelve months the plan covers.`);
  }
  const today = plan.data.generated_for;
  const view = plan.data.months[index];
  const opening = index === 0 ? plan.data.opening_cash : plan.data.months[index - 1].closing;

  const events = plan.data.rows
    .flatMap((r) => r.cells[index].events)
    .filter((e) => e.state !== "SKIPPED")
    .sort((a, b) => a.date.localeCompare(b.date) || (b.direction === "IN" ? 1 : -1));

  let balance = opening;
  let low = opening;
  let low_date: string | null = null;
  let first_negative_date: string | null = null;

  const rows: CashDayRow[] = events.map((e) => {
    const is_past = view.is_current && (e.date < today || e.state === "PAID");
    const moves = is_past ? 0 : Math.max(e.planned - e.actual, 0);
    balance += e.direction === "IN" ? moves : -moves;
    if (balance < low) { low = balance; low_date = e.date; }
    if (balance < 0 && first_negative_date === null) first_negative_date = e.date;
    return { ...e, balance, is_past };
  });

  return ok(SERVICE, {
    month, label: view.label, opening, closing: view.closing, rows,
    low_point: low, low_date, first_negative_date,
    undated_obligations: plan.data.undated_obligations,
  });
}

/** The reminder half: what falls due next, and what is already late — built
 *  from the very same events `getMonthDetail` reads, so the two can never say
 *  different things (D116). */
export async function listDue(): Promise<Result<CashDue[]>> {
  const plan = await getCashPlan();
  if (plan.error) return plan;
  const today = plan.data.generated_for;

  const due = plan.data.rows
    .flatMap((r) => r.cells.flatMap((c) => c.events))
    .filter((e) => e.state !== "SKIPPED" && e.state !== "PAID")
    .map((e) => ({ ...e, days_away: daysBetween(today, e.date) }))
    .filter((e) => e.days_away <= 21 && e.days_away >= -90)
    .sort((a, b) => a.date.localeCompare(b.date));

  return ok(SERVICE, due);
}

/** The month's bills as a worklist — `monthlyBills()` in the demo, over the
 *  same `cash_plan()` the calendar reads (D227, D228). Two runs of one seam:
 *  one anchored at the month shown, one at the month before, so *last month*
 *  exists at all (F68). Everything below is arithmetic on what those two runs
 *  already decided, the demo's rules line for line. */
export async function getMonthlyBills(month?: string): Promise<Result<MonthlyBills>> {
  const today = officeToday();
  const m = month || today.slice(0, 7);
  const prev = previousMonth(m);

  const [planRes, prevRes, setting] = await Promise.all([
    planFrom(`${m}-01`),
    planFrom(`${prev}-01`),
    core().from("settings").select("value").eq("key", "ops.bill_anomaly_percent").maybeSingle(),
  ]);
  if (planRes.error) return planRes;
  if (prevRes.error) return prevRes;
  const plan = planRes.data;
  const prevPlan = prevRes.data;
  const threshold = Number((setting.data as { value?: unknown } | null)?.value ?? 25) || 25;

  /* A month that has ended is worth what it cost; one still running, what it
     is expected to cost — and a paid estimate, what it came to (`0114`). */
  const ended = (x: string) => x < today.slice(0, 7);
  const figure = (cell: CashCell, x: string, estimate: boolean) =>
    ended(x) || (estimate && cell.state === "PAID") ? cell.actual : Math.max(cell.planned, cell.actual);
  const isEstimate = (row: CashRow) => row.component.amount_kind === "estimate";

  const lastByComponent = new Map<string, number>();
  for (const row of prevPlan.rows) {
    const cell = row.cells.find((c) => c.month === prev);
    if (cell && cell.state !== "SKIPPED") lastByComponent.set(row.component.id, figure(cell, prev, isEstimate(row)));
  }
  const thisByComponent = new Map<string, number>();
  const occurrences = new Map<string, number>();
  for (const row of plan.rows) {
    const cell = row.cells.find((c) => c.month === m);
    if (cell && cell.state !== "SKIPPED") {
      thisByComponent.set(row.component.id, figure(cell, m, isEstimate(row)));
      occurrences.set(row.component.id, cell.events.length);
    }
  }

  const bills: MonthlyBill[] = plan.rows
    .flatMap((row) => row.cells.filter((c) => c.month === m).flatMap((c) => c.events.map((e) => ({ row, event: e }))))
    .map(({ row, event }) => {
      const last = lastByComponent.get(row.component.id) ?? null;
      const thisMonth = thisByComponent.get(row.component.id) ?? 0;
      const deltaPercent = last == null || last === 0 ? null : Math.round(((thisMonth - last) / last) * 100);
      const settledGuess = isEstimate(row) && event.state === "PAID";
      return {
        component_id: row.component.id,
        name: event.name,
        date: event.date,
        direction: event.direction,
        planned: Number(event.planned),
        actual: Number(event.actual),
        outstanding: settledGuess ? 0 : Math.max(0, event.planned - event.actual),
        amount_kind: row.component.amount_kind ?? "fixed",
        variance: settledGuess ? event.actual - event.planned : null,
        state: event.state,
        days_away: daysBetween(today, event.date),
        vendor_name: event.vendor_name,
        account_code: event.account_code,
        trx_nos: event.trx_nos,
        matched_by: event.matched_by,
        reason: event.reason,
        month_total: thisMonth,
        occurrences: occurrences.get(row.component.id) ?? 1,
        last_month: last,
        delta: last == null ? null : thisMonth - last,
        delta_percent: deltaPercent,
        unusual: deltaPercent != null && Math.abs(deltaPercent) >= threshold,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));

  const out = bills.filter((b) => b.direction === "OUT" && b.state !== "SKIPPED");
  const lastTotal = lastByComponent.size > 0
    ? prevPlan.rows
        .filter((r) => r.component.direction === "OUT")
        .reduce((sum, r) => {
          const c = r.cells.find((x) => x.month === prev);
          return sum + (c && c.state !== "SKIPPED" ? figure(c, prev, isEstimate(r)) : 0);
        }, 0)
    : null;

  return ok(SERVICE, {
    month: m,
    label: monthLabel(m),
    bills,
    total_planned: out.reduce((s, b) => s + b.planned, 0),
    total_paid: out.reduce((s, b) => s + b.actual, 0),
    total_outstanding: out.reduce((s, b) => s + b.outstanding, 0),
    overdue_count: out.filter((b) => b.state === "OVERDUE").length,
    overdue_amount: out.filter((b) => b.state === "OVERDUE").reduce((s, b) => s + b.outstanding, 0),
    due_this_week: out.filter((b) => b.state === "DUE").length,
    unusual_count: new Set(out.filter((b) => b.unusual).map((b) => b.component_id)).size,
    last_month_total: lastTotal,
  });
}

/** An asset's rent onto the payment calendar, once (`0116`): fixed lines
 *  marked with the asset's tag, so a second press is refused. */
export async function scheduleAssetRent(
  assetNo: string,
  opts: { account_code?: AccountCode | null; type_code?: TransactionTypeCode | null } = {},
): Promise<Result<AssetRentSchedule>> {
  const { data, error } = await db().rpc("schedule_asset_rent", {
    p_asset_no: assetNo,
    p_account_code: opts.account_code ?? null,
    p_type_code: opts.type_code ?? null,
  });
  return fromSeam<AssetRentSchedule>(SERVICE, data, error);
}

/** The contribution audit — names × rate against what left (D259). The demo
 *  derives it from the roster's schemes (`contributionAudit`); no seam computes
 *  it against the live roster yet. Until one does the answer is an empty list,
 *  which the Monthly bills card reads as nothing to show and hides itself;
 *  refusing instead would take the whole bills page down with it. */
export async function getContributionAudit(_month?: string): Promise<Result<ContributionAuditGroup[]>> {
  return ok(SERVICE, []);
}

function previousMonth(month: string): string {
  const [y, mo] = month.split("-").map(Number);
  return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, "0")}`;
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

/** The raw editable rows — what a form needs (`vendor_id`, `account_id`,
 *  `scheme_codes`), not `v_cash_row`'s display shape (`vendor_name`,
 *  `account_code`, the cells and totals a calendar cell draws). That view is
 *  for `CashRow`, a different contract; reading it here was the same
 *  backwards-view mistake `listAccounts`/`listAccountRows` had until the
 *  swap put the two clients side by side (see this file's own header). */
export async function listComponents(): Promise<Result<CashComponent[]>> {
  const { data, error } = await db().from("cash_components").select("*").order("name");
  return fromRows<CashComponent[]>(SERVICE, data as CashComponent[], error);
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
  amount_kind?: CashAmountKind;
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
    p_amount_kind: input.amount_kind ?? null,
  });
  return fromSeam(SERVICE, data, error);
}

/** Add something that repeats — `saveComponent` (`save_cash_component`) with
 *  `p_id` left null, and `vendor_id`/`account_id` resolved to the codes the
 *  seam takes (`codeFor`, above). Redraws the row from `cash_components`
 *  rather than trusting the seam's echo, the same as every other write here.
 *
 *  The category clash (D110), the day-of-month and weekday ranges, the
 *  once-needs-a-date rule — every refusal `addComponent` can produce — are
 *  the seam's (`0022`, `0092`), not reimplemented in TypeScript (this file's
 *  header, again). **Not checked here**: the demo also refuses below
 *  `requireLevel(SERVICE, "accounting", "admin")` (Q24/D233 — the estimate
 *  belongs to leadership, not merely to whoever holds `accounting.update`);
 *  the seam still gates on `has_permission('accounting.update')` as it has
 *  since `0022`, one level looser. Tightening a live money-path authorisation
 *  rule is a call for whoever owns that decision, not something this parity
 *  pass makes unasked.
 *
 *  No idempotency key: `save_cash_component` has never taken one (unlike
 *  `post_transaction`), so a retried call adds a second line rather than
 *  replaying the first — accepted here, on the signature, only to match the
 *  demo's; nothing yet makes the promise the demo's does. */
export async function addComponent(input: {
  name: string;
  direction: Direction;
  amount: number;
  frequency?: "weekly" | "monthly" | "once";
  due_day?: number;
  due_weekday?: number | null;
  due_date?: string | null;
  type_code?: string | null;
  vendor_id?: string | null;
  account_id?: string | null;
  starts_on?: string;
  ends_on?: string | null;
  note?: string | null;
  amount_kind?: CashAmountKind;
}): Promise<Result<CashComponent>> {
  const { data, error } = await db().rpc("save_cash_component", {
    p_name: input.name,
    p_amount: input.amount,
    p_frequency: input.frequency ?? "monthly",
    p_direction: input.direction,
    p_due_day: input.due_day ?? null,
    p_due_weekday: input.due_weekday ?? null,
    p_due_date: input.due_date ?? null,
    p_type_code: input.type_code ?? null,
    p_vendor_code: await codeFor("vendors", input.vendor_id),
    p_account_code: await codeFor("accounts", input.account_id),
    p_starts_on: input.starts_on ?? null,
    p_note: input.note ?? null,
    p_id: null,
    p_ends_on: input.ends_on ?? null,
    p_active: true,
    p_amount_kind: input.amount_kind ?? "fixed",
  });
  const saved = fromSeam<{ component_id: string }>(SERVICE, data, error);
  if (saved.error) return saved;
  const row = await db().from("cash_components").select("*").eq("id", saved.data.component_id).maybeSingle();
  if (row.error) return fail(SERVICE, row.error);
  if (!row.data) return notFound(SERVICE, "component_not_found", "The line was saved but could not be read back.");
  return ok(SERVICE, row.data as CashComponent);
}

/** Change the estimate, the day, or the name.
 *
 *  `save_cash_component` is one seam for both create and update, and on
 *  update it **replaces the row** — every field it accepts, not only the
 *  ones a caller means to touch (unchanged from `0022`; `0092` only added
 *  `ends_on`/`active` to the same replace). A `patch` object is therefore
 *  read against the current row first, so a caller who names only `amount`
 *  does not blank out the line's vendor, category or due date. */
export async function updateComponent(
  id: string,
  patch: {
    name?: string; amount?: number; due_day?: number; ends_on?: string | null;
    note?: string | null; active?: boolean; amount_kind?: CashAmountKind;
  },
): Promise<Result<CashComponent>> {
  const current = await db().from("cash_components").select("*").eq("id", id).maybeSingle();
  if (current.error) return fail(SERVICE, current.error);
  if (!current.data) return notFound(SERVICE, "component_not_found", `No calendar line ${id}.`);
  const row = current.data as CashComponent;

  const { data, error } = await db().rpc("save_cash_component", {
    p_name: patch.name ?? row.name,
    p_amount: patch.amount ?? row.amount,
    p_frequency: row.frequency,
    p_direction: row.direction,
    p_due_day: patch.due_day ?? row.due_day,
    p_due_weekday: row.due_weekday,
    p_due_date: row.due_date,
    p_type_code: row.type_code,
    p_vendor_code: await codeFor("vendors", row.vendor_id),
    p_account_code: await codeFor("accounts", row.account_id),
    p_starts_on: row.starts_on,
    p_note: patch.note ?? row.note,
    p_id: id,
    p_ends_on: patch.ends_on !== undefined ? patch.ends_on : row.ends_on,
    p_active: patch.active ?? row.active,
    p_amount_kind: patch.amount_kind ?? null,
  });
  const saved = fromSeam(SERVICE, data, error);
  if (saved.error) return saved;

  const after = await db().from("cash_components").select("*").eq("id", id).maybeSingle();
  if (after.error) return fail(SERVICE, after.error);
  if (!after.data) return notFound(SERVICE, "component_not_found", `No calendar line ${id}.`);
  return ok(SERVICE, after.data as CashComponent);
}

/** A month changed. `skip: true` means *not this month* — a bill that skips is
 *  a fact, not a deletion. On a **weekly** line the amount is the month's
 *  total, and the difference lands on the last run: the THR is paid with one
 *  payday rather than spread across four (D114). */
/** The demo signals "skip this month" with `amount: null`; the seam takes a
 *  separate `p_skip` boolean (`0089` added `p_due_day` beside it — the
 *  contract's `due_day` had a column since `0022` and no seam parameter to
 *  reach it). Redraws the saved row from `cash_overrides` rather than
 *  echoing the seam, the same as every other write in this file. */
export async function setOverride(input: {
  component_id: string;
  month: string;
  amount: number | null;
  due_day?: number | null;
  reason?: string | null;
}): Promise<Result<CashOverride>> {
  const { data, error } = await db().rpc("set_cash_override", {
    p_component_id: input.component_id,
    p_month: input.month,
    p_amount: input.amount,
    p_reason: input.reason ?? null,
    p_skip: input.amount === null,
    p_due_day: input.due_day ?? null,
  });
  const res = fromSeam(SERVICE, data, error);
  if (res.error) return res;
  const { data: row, error: readErr } = await db().from("cash_overrides").select("*")
    .eq("component_id", input.component_id).eq("month", input.month).maybeSingle();
  if (readErr) return fail(SERVICE, readErr);
  if (!row) return notFound(SERVICE, "override_not_found", "The override was saved but could not be read back.");
  return ok(SERVICE, row as CashOverride);
}

/** Somebody saying *this ledger row is that bill*. It beats the category
 *  guess, which is the point — the guess is the fallback, not the answer. One
 *  row, one bill: a payment already on the calendar is a 409. */
export async function linkPayment(input: {
  component_id: string; month: string; trx_no: string;
}): Promise<Result<CashSettlement>> {
  const { data, error } = await db().rpc("link_cash_payment", {
    p_component_id: input.component_id, p_month: input.month, p_trx_no: input.trx_no,
  });
  const res = fromSeam(SERVICE, data, error);
  if (res.error) return res;
  const { data: row, error: readErr } = await db().from("cash_settlements").select("*")
    .eq("trx_no", input.trx_no).maybeSingle();
  if (readErr) return fail(SERVICE, readErr);
  if (!row) return notFound(SERVICE, "settlement_not_found", "The link was saved but could not be read back.");
  return ok(SERVICE, row as CashSettlement);
}

/* ------------------------------------------------------------------ */
/* Vendors and statements                                              */
/* ------------------------------------------------------------------ */

/** One payment, and what it settled. `applies_to` is a list because one
 *  transfer really does close three orders — the bank saw one payment, the
 *  vendor closed three, and both are true (D97). */
export async function paymentsForVendor(vendorId: string): Promise<Result<VendorPayment[]>> {
  const { data, error } = await db().from("v_vendor_payment").select("*")
    .eq("vendor_id", vendorId).order("trx_date").order("trx_no");
  return fromRows<VendorPayment[]>(SERVICE, data as VendorPayment[], error);
}

/** Every statement, each with its lines — `getStatement`'s shape, for every
 *  row rather than one. One `getStatement` per statement rather than a fourth
 *  hand-rolled query here: the demo builds the same nested shape from the
 *  same three reads, and a second way to assemble a `BankStatementView` is a
 *  second place for the two to drift. */
export async function listStatements(): Promise<Result<BankStatementView[]>> {
  const { data, error } = await db().from("v_bank_statement").select("statement_no")
    .order("period_start", { ascending: false });
  if (error) return fail(SERVICE, error);
  const views = await Promise.all(
    (data ?? []).map((r) => getStatement((r as { statement_no: string }).statement_no)),
  );
  const failed = views.find((v) => v.error);
  if (failed?.error) return { error: failed.error, meta: failed.meta };
  return ok(SERVICE, views.map((v) => (v as { data: BankStatementView }).data));
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

  const [{ data: head, error: headErr }, { data: lines, error: lineErr }] = await Promise.all([
    db()
      .from("v_bank_statement").select("*").eq("statement_no", statementNo).maybeSingle(),
    db()
      .from("v_statement_line").select("*").eq("statement_no", statementNo).order("line_no"),
  ]);
  if (headErr) return fail(SERVICE, headErr);
  if (!head) {
    return notFound(SERVICE, "statement_not_found", `No statement ${statementNo}.`);
  }

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
