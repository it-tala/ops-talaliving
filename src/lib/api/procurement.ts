/** Implements `/api/v1/procurement` against the database.
 *
 *  **Same names, same signatures, same envelope as `src/demo/api/procurement.ts`.**
 *  That is the whole swap: a screen that calls `procurement.listOpenLines()`
 *  today calls it afterwards and never learns where the rows came from.
 *
 *  Three things this file is deliberately *not* allowed to do, because each one
 *  would quietly end the guarantee above:
 *
 *  1. **It does not compute anything derived.** Status, coverage, the meeting
 *     quadrant, the variance, what a vendor could invoice — all of it arrives
 *     computed, from `0014_procure_views.sql`. A figure worked out here would be
 *     a second definition of a rule this project has argued about once, and the
 *     two would disagree within a month (A3).
 *  2. **It does not check a permission.** Every refusal is the database's. A
 *     check here would be a second place the rule lives, and the failure mode is
 *     the one `john-lau` had: the screen and the guard reading different things.
 *  3. **It does not reshape a refusal.** The database's wording names who the
 *     decision belongs to; "Forbidden" tells a person nothing (A7).
 *
 *  What it *does* do is map flat columns onto the nested shapes in
 *  `src/services/procurement/contracts.ts`. The view returns
 *  `variance_delta`; the screens read `line.variance.delta`. That is a
 *  renaming, not a calculation, and it is the only work here.
 */
import type {
  Vendor, VendorView, Item, ItemView, Uom, UomConversion, UomDimension, ItemCategory, ItemPurchase, Project,
  ItemGroupSuggestion,
  PrLineView, PrApproval, LineNote, LineVariance, ApprovalRequest,
  VendorJourney, RoundSummary, RoundTransfer, VarianceReason, Channel, ApprovalBatchView,
  PoDetail, PoLine, PoStatusView, PurchaseOrder, Receipt, ReceiptCondition,
  UomCode, PrCategory, PrDocument,
  ProjectView, ProjectLineView, ProjectStatus, ProjectStatusChange, Client, ClientView,
} from "@/services/procurement/contracts";
import type { DocKind } from "@/services/documents/contracts";
import { supabaseBrowser } from "@/lib/supabase/client";
import { getActiveLocale } from "@/lib/format";
import { suggestItemGroups as suggestGroups } from "@/services/procurement/suggest";
import { fail, fromSeam, fromRows, fromPage, invalid, notFound, ok, type Result } from "./_kit";
import * as documents from "./documents";

const SERVICE = "procurement" as const;

/** Every object this module reads or calls lives in `ops_procure`, and PostgREST
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
const db = () => supabaseBrowser().schema("ops_procure");

/* ------------------------------------------------------------------ */
/* id ↔ code, and reading a row back                                   */
/* ------------------------------------------------------------------ */

/** The seams take **codes**; the screens hold **ids**.
 *
 *  Both are right, and the mismatch is not a bug in either. ADR-004 says never
 *  hand out a uuid where a code will do, so `VND-0007` is what crosses a seam,
 *  lands in an audit row and gets read aloud on the phone. A screen, meanwhile,
 *  is holding a `VendorView` it already fetched, and `id` is what it has.
 *
 *  So the translation happens here — once, in the client — rather than in five
 *  screens or in the seams. It is the same shape `accounting.codeFor` uses, and
 *  it is deliberately **not** silent about failure: a null means the row is
 *  gone, which is a 404 the person can act on, not a call with `p_code: null`
 *  that the seam would answer with its own confusing *no such vendor*.
 *
 *  Both are `string` in TypeScript, so nothing would have complained until a
 *  seam refused every call. That is exactly why 37 functions were listed as
 *  pending rather than assumed correct.
 */
async function codeFor(table: "vendors" | "items", id: string): Promise<string | null> {
  const { data } = await db().from(table).select("code").eq("id", id).maybeSingle();
  return (data as { code: string } | null)?.code ?? null;
}

/** The row the screen is about to draw, after a write that answered a receipt.
 *
 *  Two round trips, the same shape as `createVendor` and `postTransaction`: the
 *  seam answers *what happened* — `{code, is_curated}` — and the contract
 *  promises the whole view, because the screen puts it straight back into its
 *  list without reloading.
 *
 *  Widening the seams to return a whole row instead was the alternative, and it
 *  is worse: every write becomes a read for the benefit of the callers that
 *  happen to need one, and the audit payload stops being *what changed*.
 */
async function vendorViewByCode(code: string): Promise<Result<VendorView>> {
  const { data, error } = await db()
    .from("v_vendor_view").select("*").eq("code", code).single();
  return fromRows<VendorView>(SERVICE, data as VendorView | null, error);
}

async function itemViewByCode(code: string): Promise<Result<ItemView>> {
  const { data, error } = await db()
    .from("v_item_view").select("*").eq("code", code).single();
  return fromRows<ItemView>(SERVICE, data as ItemView | null, error);
}

/** What a new line looks like going in.
 *
 *  Declared here rather than imported, because the demo's copy lives in
 *  `src/demo/api/procurement.ts` and this module must not depend on the demo —
 *  the whole point is that either can be swapped out for the other. The shape
 *  is identical, and it belongs in `src/services/procurement/contracts.ts`
 *  where both can read it; that move is logged as **C5** in
 *  `docs/plan/phase-2/01-schema.md` for the design session to apply.
 */
export interface NewLineInput {
  item_id?: string | null;
  description: string;
  qty?: number | null;
  uom?: UomCode | null;
  unit_price?: number | null;
  /** Set it outright for a line with no quantity — a service, a delivery
   *  charge, a lump sum the vendor quoted. Left off, the database derives it
   *  from qty × price, and leaves it alone when either is missing (D75). */
  item_total?: number | null;
  vendor_id?: string | null;
  category?: PrCategory | null;
  purpose?: string | null;
  need_by?: string | null;
  /** The work order whose BOM produced this line (D151). */
  source_wo_no?: string | null;
}

/* ------------------------------------------------------------------ */
/* The board                                                           */
/* ------------------------------------------------------------------ */

/** One row of `procure.v_pr_line`, flat. Not exported: nothing outside this
 *  file should know the view's column names, or the swap would have leaked. */
interface LineRow {
  id: string; doc_id: string; line_no: number; line_no_full: string;
  item_id: string | null; description: string;
  qty: number | null; uom: string | null; unit_price: number | null;
  item_total: number; vendor_id: string | null; po_line_id: string | null;
  category: string | null; purpose: string | null; need_by: string | null;
  source_wo_no: string | null;
  removed_at: string | null; removed_by: string | null;

  status: string; meeting_state: string;
  doc_no: string; doc_status: string; submitted_at: string | null;
  requested_by_name: string; project_code: string | null;
  vendor_name: string | null; item_name: string | null;

  coverage_approved: number; coverage_covered: number;
  coverage_remaining: number; coverage_settled: boolean;
  trx_nos: string[];

  received_qty: number; reported_qty: number; has_problem_receipt: boolean;
  evidence_count: number; has_payment_proof: boolean; has_support: boolean;

  variance_requested: number; variance_approved: number; variance_paid: number;
  variance_delta: number; variance_kind: string; variance_material: boolean;
  explanation_id: string | null; explanation_reason: string | null;
  explanation_note: string | null; explanation_amount_at_time: number | null;
  explanation_by: string | null; explanation_at: string | null;

  note_id: string | null; note_instructions: string | null; note_remark: string | null;
  note_by_id: string | null; note_by: string | null; note_at: string | null;

  pending_request_id: string | null; pending_request_batch_id: string | null;
  pending_request_token: string | null;
  pending_request_sent_to_name: string | null; pending_request_sent_to: string | null;
  pending_request_sent_by_id: string | null; pending_request_sent_by: string | null;
  pending_request_sent_at: string | null; pending_request_channel: string | null;
  pending_request_meeting_note: string | null;

  round_no: string | null; round_status: string | null;

  approval_id: string | null; approval_approved: boolean | null;
  approval_qty: number | null; approval_amount: number | null;
  approval_by_id: string | null; approval_by: string | null;
  approval_at: string | null; approval_channel: string | null;
}

function toLineView(r: LineRow): PrLineView {
  return {
    id: r.id, doc_id: r.doc_id, line_no: r.line_no, line_no_full: r.line_no_full,
    item_id: r.item_id, description: r.description,
    qty: r.qty, uom: r.uom as PrLineView["uom"], unit_price: r.unit_price,
    item_total: r.item_total, vendor_id: r.vendor_id, po_line_id: r.po_line_id,
    category: r.category as PrLineView["category"],
    purpose: r.purpose, need_by: r.need_by, source_wo_no: r.source_wo_no,
    removed_at: r.removed_at, removed_by: r.removed_by,

    status: r.status as PrLineView["status"],
    meeting_state: r.meeting_state as PrLineView["meeting_state"],
    doc_no: r.doc_no, submitted_at: r.submitted_at,
    requested_by_name: r.requested_by_name, project_code: r.project_code,
    vendor_name: r.vendor_name, item_name: r.item_name,

    coverage: {
      line_id: r.id,
      approved: r.coverage_approved,
      covered: r.coverage_covered,
      remaining: r.coverage_remaining,
      settled: r.coverage_settled,
    },
    trx_nos: r.trx_nos ?? [],
    received_qty: r.received_qty,
    has_problem_receipt: r.has_problem_receipt,
    evidence_count: r.evidence_count,
    has_payment_proof: r.has_payment_proof,
    has_support: r.has_support,

    variance: {
      requested: r.variance_requested,
      approved: r.variance_approved,
      paid: r.variance_paid,
      delta: r.variance_delta,
      kind: r.variance_kind as PrLineView["variance"]["kind"],
      material: r.variance_material,
      explanation: r.explanation_id
        ? {
          id: r.explanation_id,
          line_id: r.id,
          reason: r.explanation_reason as VarianceReason,
          note: r.explanation_note,
          amount_at_time: r.explanation_amount_at_time ?? 0,
          /* The view carries the email, which is the readable half and the one
             a trail is actually read by (ADR-004). The uuid is not on the row
             because nothing renders it. */
          recorded_by: "",
          recorded_by_email: r.explanation_by ?? "",
          recorded_at: r.explanation_at ?? "",
        }
        : null,
    },

    note: r.note_id
      ? {
        id: r.note_id, line_id: r.id,
        instructions: r.note_instructions, remark: r.note_remark,
        recorded_by: r.note_by_id ?? "",
        recorded_by_email: r.note_by ?? "",
        recorded_at: r.note_at ?? "",
      }
      : null,

    pending_request: r.pending_request_id
      ? {
        id: r.pending_request_id, line_id: r.id,
        batch_id: r.pending_request_batch_id ?? "",
        token: r.pending_request_token ?? "",
        sent_to: r.pending_request_sent_to_name ?? "",
        sent_to_email: r.pending_request_sent_to ?? "",
        sent_by: r.pending_request_sent_by_id ?? "",
        sent_by_email: r.pending_request_sent_by ?? "",
        sent_at: r.pending_request_sent_at ?? "",
        channel: (r.pending_request_channel ?? "chat") as Channel,
        meeting_note: r.pending_request_meeting_note,
        /* Pending by definition — the view selects only unanswered cards. */
        answered_at: null,
        outcome: null,
      }
      : null,

    round_no: r.round_no,
    round_status: r.round_status as PrLineView["round_status"],

    approval: r.approval_id
      ? {
        id: r.approval_id, line_id: r.id, step: "GOODS",
        approved: r.approval_approved ?? false,
        approved_qty: r.approval_qty,
        approved_amount: r.approval_amount,
        recorded_by: r.approval_by_id ?? "",
        recorded_by_email: r.approval_by ?? "",
        recorded_at: r.approval_at ?? "",
        channel: (r.approval_channel ?? "web") as Channel,
      }
      : null,
  };
}

/** Every line that is still someone's problem. Newest submission first, which
 *  is the board's own order — the queue below sorts the other way, and both
 *  orders are the view's, not this file's. */
export async function listOpenLines(): Promise<Result<PrLineView[]>> {
  const { data, error } = await db().from("v_open_lines").select("*").order("submitted_at", { ascending: false });
  if (error) return fail(SERVICE, error);
  return ok(SERVICE, (data as LineRow[]).map(toLineView));
}

/** One line by its public number, whatever its state — what a screen outside
 *  procurement (the ledger's allocation list) needs to open it in place. */
export async function getLineByNo(lineNo: string): Promise<Result<PrLineView>> {
  return getLine(lineNo);
}

export async function listAllLines(): Promise<Result<PrLineView[]>> {
  const { data, error } = await db().from("v_pr_line").select("*")
    .not("doc_status", "in", "(DRAFT,CANCELLED)")
    .is("removed_at", null)
    .order("submitted_at", { ascending: false });
  if (error) return fail(SERVICE, error);
  return ok(SERVICE, (data as LineRow[]).map(toLineView));
}

/** Every request line that asked for this item — merged duplicates' lines
 *  included, newest first. The item drawer's "requested" half (Master Data
 *  phase 5): what was asked for, by whom, and where it stands. */
export async function itemRequestLines(itemId: string): Promise<Result<PrLineView[]>> {
  const { data: merged, error: e1 } = await db().from("items").select("id").eq("merged_into", itemId);
  if (e1) return fail(SERVICE, e1);
  const ids = [itemId, ...((merged ?? []) as { id: string }[]).map((m) => m.id)];
  const { data, error } = await db().from("v_pr_line").select("*")
    .in("item_id", ids)
    .not("doc_status", "in", "(DRAFT,CANCELLED)")
    .is("removed_at", null)
    .order("submitted_at", { ascending: false });
  if (error) return fail(SERVICE, error);
  return ok(SERVICE, (data as LineRow[]).map(toLineView));
}

/** The standing queue (D21). Oldest first: nothing ages out and nothing is
 *  prioritised, but a line that has waited a week should not be below one filed
 *  this morning just because the table happens to be in that order. */
export async function queue(): Promise<Result<PrLineView[]>> {
  const { data, error } = await db().from("v_approval_queue").select("*").order("submitted_at", { ascending: true });
  if (error) return fail(SERVICE, error);
  return ok(SERVICE, (data as LineRow[]).map(toLineView));
}

export async function decidedLines(limit = 12): Promise<Result<PrLineView[]>> {
  const { data, error } = await db().from("v_pr_line").select("*")
    .eq("approval_approved", true)
    .order("approval_at", { ascending: false })
    .limit(limit);
  if (error) return fail(SERVICE, error);
  return ok(SERVICE, (data as LineRow[]).map(toLineView));
}

/** A difference outlives the line: the plywood that closed Rp 180.000 cheaper
 *  is off the open board and still part of the answer to "does this keep
 *  happening". So this reads every line with a material variance, settled or
 *  not. */
export async function listVariances(): Promise<Result<PrLineView[]>> {
  const { data, error } = await db().from("v_pr_line").select("*")
    .eq("variance_material", true)
    .order("submitted_at", { ascending: false });
  if (error) return fail(SERVICE, error);
  return ok(SERVICE, (data as LineRow[]).map(toLineView));
}

export async function listLinesForWorkOrder(woNo: string): Promise<Result<PrLineView[]>> {
  const { data, error } = await db().from("v_pr_line").select("*").eq("source_wo_no", woNo).is("removed_at", null);
  if (error) return fail(SERVICE, error);
  return ok(SERVICE, (data as LineRow[]).map(toLineView));
}

/** The whole trail of decisions on one line, oldest first.
 *
 *  Append-only means the story is the rows, not the last row: "approved at
 *  10:18, un-approved at 14:07" is a fact about how the decision was made and
 *  the screen has no business hiding it behind the current value (D28). */
export async function lineHistory(lineNo: string): Promise<Result<PrApproval[]>> {
  const { data: line, error: e1 } = await db()
    .from("pr_lines").select("id").eq("line_no_full", lineNo).maybeSingle();
  if (e1) return fail(SERVICE, e1);
  if (!line) return ok(SERVICE, []);

  const { data, error } = await db()
    .from("pr_approvals").select("*")
    .eq("line_id", (line as { id: string }).id)
    .order("recorded_at", { ascending: true });
  return fromRows<PrApproval[]>(SERVICE, data as PrApproval[], error);
}

/* ------------------------------------------------------------------ */
/* Deciding                                                            */
/* ------------------------------------------------------------------ */

/** `approve_goods` or 403, a bare number 422, a second yes 409 — every one of
 *  them the database's, from `procure.approve_line()`. Nothing is checked here
 *  and nothing is reworded. */
export async function approveLine(
  input: {
    line_no: string;
    approved: boolean;
    approved_qty?: number | null;
    approved_amount?: number | null;
    instructions?: string | null;
    remark?: string | null;
  },
  idempotencyKey?: string,
): Promise<Result<PrLineView>> {
  const { data, error } = await db().rpc("approve_line", {
    p_line_no: input.line_no,
    p_approved: input.approved,
    p_approved_qty: input.approved_qty ?? null,
    p_approved_amount: input.approved_amount ?? null,
    p_instructions: input.instructions ?? null,
    p_remark: input.remark ?? null,
    p_channel: "web",
    p_key: idempotencyKey ?? null,
  });
  const res = fromSeam<unknown>(SERVICE, data, error);
  if (res.error) return res;
  return getLine(input.line_no);
}

export async function removeLine(
  input: { line_no: string },
  idempotencyKey?: string,
): Promise<Result<PrLineView>> {
  const { data, error } = await db().rpc("remove_line", {
    p_line_no: input.line_no, p_key: idempotencyKey ?? null,
  });
  const res = fromSeam<unknown>(SERVICE, data, error);
  if (res.error) return res;
  return getLine(input.line_no);
}

export async function noteLine(
  input: { line_no: string; instructions?: string | null; remark?: string | null },
): Promise<Result<PrLineView>> {
  const { data, error } = await db().rpc("note_line", {
    p_line_no: input.line_no,
    p_instructions: input.instructions ?? null,
    p_remark: input.remark ?? null,
  });
  const res = fromSeam<unknown>(SERVICE, data, error);
  if (res.error) return res;
  return getLine(input.line_no);
}

export async function explainVariance(
  input: { line_no: string; reason: VarianceReason; note?: string | null },
): Promise<Result<PrLineView>> {
  const { data, error } = await db().rpc("explain_variance", {
    p_line_no: input.line_no, p_reason: input.reason, p_note: input.note ?? null,
  });
  const res = fromSeam<unknown>(SERVICE, data, error);
  if (res.error) return res;
  return getLine(input.line_no);
}

export async function submitPr(
  docNo: string, idempotencyKey?: string,
): Promise<Result<PrDocumentView>> {
  const { data, error } = await db().rpc("submit_pr", {
    p_doc_no: docNo, p_key: idempotencyKey ?? null,
  });
  const submitted = fromSeam<{ doc_no: string; status: string; lines: number }>(
    SERVICE, data, error);
  if (submitted.error) return submitted;
  /* Read back: the screen redraws the document it just submitted, and the
     status and the line statuses have both moved. */
  return getPr(submitted.data.doc_no);
}

/* ------------------------------------------------------------------ */
/* Creating                                                            */
/* ------------------------------------------------------------------ */

/** The whole request in one call.
 *
 *  `lines` goes down as a jsonb array rather than as N round trips, because a
 *  request half-written by a phone that lost signal is a row somebody has to
 *  find and finish. One transaction, or none of it.
 *
 *  `project_code`, never `project_id` — the code is what crosses every seam in
 *  this system (ADR-004), and it is what the caller already has.
 */
export async function createPr(
  /** `project_code` is the seam-friendly way in: another service knows the
   *  code, never the internal id (ADR-004). `project_id` is what the screens
   *  still hold, and is resolved to a code before the seam sees it. */
  input: { project_id?: string | null; project_code?: string | null; lines: NewLineInput[] },
  idempotencyKey?: string,
): Promise<Result<PrDocumentView>> {
  let projectCode = input.project_code ?? null;
  if (!projectCode && input.project_id) {
    const { data } = await db().from("projects").select("code").eq("id", input.project_id).maybeSingle();
    projectCode = (data as { code: string } | null)?.code ?? null;
  }

  const { data, error } = await db().rpc("create_pr", {
    p_lines: input.lines,
    p_project_code: projectCode,
    p_doc_type: "PR",
    p_key: idempotencyKey ?? null,
  });

  /* The seam answers `{doc_no, status, lines}` — what happened. The contract
     promises the document, because the screen that creates a request goes
     straight to it. Read back rather than widen the seam. */
  const created = fromSeam<{ doc_no: string; status: string; lines: number }>(
    SERVICE, data, error);
  if (created.error) return created;
  return getPr(created.data.doc_no);
}

/** One item, asked for and submitted in a single act — for the meeting itself,
 *  where going through the full create-then-submit form loses the room (D73).
 *  Both halves happen inside one database transaction, so there is no window in
 *  which the request exists and nobody has been asked. */
export async function quickAddLine(
  input: NewLineInput & { project_code?: string | null },
  idempotencyKey?: string,
): Promise<Result<PrLineView>> {
  const { project_code, ...line } = input;
  const { data, error } = await db().rpc("quick_add_line", {
    p_line: line, p_project_code: project_code ?? null, p_key: idempotencyKey ?? null,
  });
  const res = fromSeam<{ line_no: string }>(SERVICE, data, error);
  if (res.error) return res;
  return getLine(res.data.line_no);
}

export async function addDraftLine(
  docNo: string, input: NewLineInput,
): Promise<Result<PrLineView>> {
  const { data, error } = await db().rpc("add_draft_line", {
    p_doc_no: docNo, p_line: input,
  });
  const res = fromSeam<{ line_no: string }>(SERVICE, data, error);
  if (res.error) return res;
  return getLine(res.data.line_no);
}

/** Editing what was asked for — and the three points past which it is not an
 *  edit any more: approved, paid, or removed. All three refusals are the
 *  database's. */
export async function updateLine(
  lineNo: string, input: Partial<NewLineInput>,
): Promise<Result<PrLineView>> {
  const { data, error } = await db().rpc("update_line", {
    p_line_no: lineNo, p_patch: input,
  });
  const res = fromSeam<unknown>(SERVICE, data, error);
  if (res.error) return res;
  return getLine(lineNo);
}

/** Ask leadership. The question goes to whoever holds `approve_goods` — not to
 *  a name in a config file, so if the authority moves the notification follows
 *  it (D19). A line with nothing behind it is refused before the card is sent,
 *  and the refusal names which lines (D125). */
/** Ask leadership to decide a list, in one send.
 *
 *  **A batch, not a card per line** (D70). Fifteen separate cards ask the
 *  approver to add fifteen numbers in their head to know what they just
 *  committed to, which is how people stop reading the fifteenth.
 *
 *  `to` is a **user id**, because that is what the screen is holding — it
 *  picked a person from a list. The seam takes an email (ADR-004: the thing a
 *  person can read back), so the translation happens here, the same way
 *  `curateVendor` turns a vendor id into a code.
 *
 *  Answers the batch as the board redraws it, not the seam's receipt: the
 *  toast names the count, the total and who has to decide, and all three come
 *  from `v_approval_batch`.
 */
export async function requestApproval(
  input: { line_nos: string[]; to?: string; notes?: Record<string, string | null> },
  idempotencyKey?: string,
): Promise<Result<ApprovalBatchView>> {
  let toEmail: string | null = null;
  if (input.to) {
    const { data } = await supabaseBrowser().schema("ops_core")
      .from("users").select("email").eq("id", input.to).maybeSingle();
    toEmail = (data as { email: string } | null)?.email ?? null;
    if (!toEmail) {
      return notFound(SERVICE, "approver_not_found", "That person is not in this workspace.");
    }
  }

  const { data, error } = await db().rpc("request_approval", {
    p_line_nos: input.line_nos,
    p_to_email: toEmail,
    p_notes: input.notes ?? {},
    p_key: idempotencyKey ?? null,
  });
  const sent = fromSeam<{ batch_no: string }>(SERVICE, data, error);
  if (sent.error) return sent;

  const batch = await db()
    .from("v_approval_batch").select("*").eq("batch_no", sent.data.batch_no).single();
  return fromRows<ApprovalBatchView>(
    SERVICE, batch.data as ApprovalBatchView | null, batch.error);
}

/** Create a vendor, and answer with the vendor.
 *
 *  **Two round trips, on purpose.** The seam returns `{code, name,
 *  is_curated}` — enough to say what happened, and ADR-004's answer to *never
 *  hand out a uuid where a code will do*. The contract promises a `Vendor`,
 *  and two screens read more of it than the seam sends: `/procurement/supplier`
 *  wants the name for its toast, and `/procurement/pr/new` puts the new vendor
 *  straight onto the line it was created from, by `id`.
 *
 *  So the write stays narrow and the read that follows it is where the shape
 *  comes from. The alternative — widening the seam to return a whole row —
 *  makes every write a read as well, for the benefit of the callers that
 *  happen to need one.
 *
 *  If the row cannot be read back, the vendor still exists: this returns the
 *  read's error rather than pretending the write failed, because retrying a
 *  create that already succeeded is how a duplicate gets made.
 */
export async function createVendor(
  input: { name: string }, idempotencyKey?: string,
): Promise<Result<Vendor>> {
  const { data, error } = await db().rpc("create_vendor", {
    p_name: input.name, p_key: idempotencyKey ?? null,
  });
  const created = fromSeam<{ code: string; name: string; is_curated: boolean }>(
    SERVICE, data, error);
  if (created.error) return created;

  const row = await db().from("vendors").select("*").eq("code", created.data.code).single();
  return fromRows<Vendor>(SERVICE, row.data as Vendor | null, row.error);
}

/** Born uncurated (D30): recorded, visible on the catalogue page, and absent
 *  from every dropdown until a person says it is a real entry.
 *
 *  `base_uom` is a `UomCode` and is **required**, where this used to take
 *  `string` and default to `pcs`. Both changes matter. `string` let a typo
 *  reach the database and become a unit nobody can convert; and a defaulted
 *  `pcs` is a claim — *one piece* — about a thing nobody measured, which is the
 *  very thing `0031` made `base_uom` nullable to stop the import from doing.
 *  A person creating an item here knows the unit; the null is for the 587 rows
 *  where somebody long ago did not write one down.
 */
export async function createItem(
  input: { name: string; base_uom: UomCode; category_code?: string; kind?: "goods" | "service" },
  idempotencyKey?: string,
): Promise<Result<ItemView>> {
  const { data, error } = await db().rpc("create_item", {
    p_name: input.name,
    p_category_code: input.category_code ?? "uncurated",
    p_base_uom: input.base_uom,
    p_kind: input.kind ?? "goods",
    p_key: idempotencyKey ?? null,
  });
  const created = fromSeam<{ code: string }>(SERVICE, data, error);
  if (created.error) return created;
  /* If the read fails the item still exists, so this answers the read's error
     rather than the write's: retrying a create that already succeeded is how a
     duplicate gets made. */
  return itemViewByCode(created.data.code);
}

/** One decision, not three: *this is a real catalogue entry, it is a finishing
 *  material, and it costs about this much.* The seam took only the flag until
 *  `0032`, so the other two thirds had nowhere to go.
 *
 *  `standard_price` is the curated price and only ever set by a person.
 *  `last_price` is a trace of what was actually paid and is never written here
 *  — conflating them is how one panic purchase becomes the official price.
 */
export async function curateItem(
  id: string,
  input: { curated: boolean; category_code?: string; standard_price?: number | null },
): Promise<Result<ItemView>> {
  const code = await codeFor("items", id);
  if (!code) return notFound(SERVICE, "item_not_found", "Item not found.");

  const { data, error } = await db().rpc("curate_item", {
    p_code: code,
    p_curated: input.curated,
    p_category_code: input.category_code ?? null,
    p_standard_price: input.standard_price ?? null,
  });
  const res = fromSeam(SERVICE, data, error);
  if (res.error) return res;
  return itemViewByCode(code);
}

/** Contact and banking details, kept apart from curation: knowing who to call
 *  does not make a vendor canonical, and a curated vendor with no phone number
 *  is still a gap worth seeing.
 *
 *  A vendor is a person before it is a company — *call Toko Amplas* is not an
 *  instruction anybody can follow. Both bank accounts are on record because
 *  some vendors invoice from one and collect on another, and paying into the
 *  wrong one is a week of chasing.
 */
export async function updateVendorContact(
  id: string,
  input: Partial<Pick<Vendor,
    "pic_name" | "pic_phone" | "phone" | "address" |
    "bank_account" | "bank_account_secondary" | "npwp" | "supplied_categories">>,
): Promise<Result<VendorView>> {
  const code = await codeFor("vendors", id);
  if (!code) return notFound(SERVICE, "vendor_not_found", "Vendor not found.");

  const { data, error } = await db().rpc("update_vendor_contact", {
    p_code: code,
    p_pic_name: input.pic_name ?? null,
    p_pic_phone: input.pic_phone ?? null,
    p_phone: input.phone ?? null,
    p_address: input.address ?? null,
    p_bank_account: input.bank_account ?? null,
    p_bank_account_secondary: input.bank_account_secondary ?? null,
    p_npwp: input.npwp ?? null,
    /* `undefined` and `[]` are different answers and the seam reads them that
       way: null leaves the list alone, an empty array clears it. Collapsing
       them would make "this vendor supplies nothing in particular" impossible
       to say. */
    p_supplied_categories: input.supplied_categories ?? null,
  });
  const res = fromSeam(SERVICE, data, error);
  if (res.error) return res;
  return vendorViewByCode(code);
}

/** The drawer, after a write that answered a receipt.
 *
 *  Every PO mutation the detail screen calls redraws the whole order, so each
 *  one ends here rather than handing back what the seam said. The seam's job is
 *  to say *what happened* — that is what lands in the audit row; the drawer's
 *  job is to show the order as it now stands, and those are different
 *  sentences.
 *
 *  **A refusal is passed through untouched.** Reading the order back after a
 *  refusal would answer `ok` with a row, and the screen would redraw happily
 *  over a decision that never happened — which is the single most dangerous
 *  way to get this wrong.
 */
async function afterPo(poNo: string, res: Result<unknown>): Promise<Result<PoDetail>> {
  if (res.error) return res;
  return getPoDetail(poNo);
}

/** Always a DRAFT. An order is a promise made to a supplier in the company's
 *  name, so leadership confirms it before it is sent — which means creating one
 *  cannot also send it (D132).
 *
 *  Takes `vendor_id`, because that is what the screen is holding: it picked the
 *  vendor from a list of `VendorView`. The seam takes a code (ADR-004), so the
 *  translation happens here, once — see `codeFor` above.
 */
export async function createPo(
  input: {
    vendor_id: string;
    lines: { description: string; qty: number; uom: UomCode; unit_price: number }[];
    dp_percent?: number | null;
    note?: string | null;
    /** When the vendor says it will arrive (D134). */
    expected_delivery?: string | null;
  },
  idempotencyKey?: string,
): Promise<Result<PoView>> {
  const vendorCode = await codeFor("vendors", input.vendor_id);
  if (!vendorCode) {
    return invalid(SERVICE, "vendor_required",
      "An order is placed with somebody. Choose the vendor first.",
      { field: "vendor_id" });
  }

  const { data, error } = await db().rpc("create_po", {
    p_vendor_code: vendorCode,
    p_lines: input.lines,
    p_dp_percent: input.dp_percent ?? null,
    p_note: input.note ?? null,
    p_expected_delivery: input.expected_delivery ?? null,
    p_key: idempotencyKey ?? null,
  });
  const created = fromSeam<{ po_no: string }>(SERVICE, data, error);
  if (created.error) return created;
  /* The order exists from here on. If the read fails this answers the read's
     error, never the write's: retrying a create that already succeeded is how
     a second order reaches a supplier. */
  return getPo(created.data.po_no);
}

/** Ask leadership to confirm the order — of somebody in particular.
 *
 *  The other half of D267: the question goes to a named person and the answer
 *  comes back from **their own account**. A leadership meeting runs on one
 *  laptop, and ticking a box there records the wrong person. With no `to`, the
 *  seam picks whoever holds `approve_goods`; naming somebody who does not hold
 *  it is refused, because that question would sit unanswerable in their chat.
 */
export async function requestPoApproval(
  input: { po_no: string; to?: string },
): Promise<Result<PoDetail>> {
  const { data, error } = await db().rpc("request_po_approval", {
    p_po_no: input.po_no, p_to: input.to ?? null,
  });
  return afterPo(input.po_no, fromSeam(SERVICE, data, error));
}

export async function setExpectedDelivery(
  input: { po_no: string; expected_delivery: string | null; reason?: string | null },
): Promise<Result<PoDetail>> {
  const { data, error } = await db().rpc("set_expected_delivery", {
    p_po_no: input.po_no, p_date: input.expected_delivery, p_reason: input.reason ?? null,
  });
  return afterPo(input.po_no, fromSeam(SERVICE, data, error));
}

export async function markPoResent(poNo: string): Promise<Result<PoDetail>> {
  const { data, error } = await db().rpc("mark_po_resent", { p_po_no: poNo });
  return afterPo(poNo, fromSeam(SERVICE, data, error));
}

/** The photograph is always required; the signed tanda terima is what turns the
 *  report into a confirmation. Sending only the photo is not a failure — it is
 *  the night shift doing the right thing, and the row lands as REPORTED and
 *  counts for nothing until somebody signs for it (D131). */
export async function createReceipt(
  input: {
    line_no?: string | null;
    po_line_id?: string | null;
    qty_received: number;
    condition: ReceiptCondition;
    documents: { attachment_id: string; kind: DocKind }[];
    qc_by?: string | null;
    note?: string | null;
  },
  idempotencyKey?: string,
): Promise<Result<{ receipt: Receipt; notified: boolean }>> {
  const { data, error } = await db().rpc("create_receipt", {
    p_qty: input.qty_received,
    p_condition: input.condition,
    p_documents: input.documents,
    p_line_no: input.line_no ?? null,
    p_po_line_id: input.po_line_id ?? null,
    p_qc_by: input.qc_by ?? null,
    p_note: input.note ?? null,
    p_key: idempotencyKey ?? null,
  });
  const res = fromSeam<{ receipt_no: string; notified: boolean }>(SERVICE, data, error);
  if (res.error) return res;
  const receipt = await getReceipt(res.data.receipt_no);
  if (receipt.error) return receipt;
  return ok(SERVICE, { receipt: receipt.data, notified: res.data.notified });
}

async function getReceipt(receiptNo: string): Promise<Result<Receipt>> {
  const { data, error } = await db().from("receipts").select("*").eq("receipt_no", receiptNo).maybeSingle();
  if (error) return fail(SERVICE, error);
  if (!data) return notFound(SERVICE, "receipt_not_found", `Receipt ${receiptNo} not found.`);
  return ok(SERVICE, data as Receipt);
}

/** Roll everything still owed into the open round, opening one if there is
 *  none. Nothing to roll is a `noop` — a successful nothing-happened, which is
 *  a better answer than a 200 that looks like work. */
export async function syncRound(): Promise<Result<RoundView>> {
  const { data, error } = await db().rpc("sync_round");
  const res = fromSeam<{ round_no: string }>(SERVICE, data, error);
  if (res.error) return res;
  return getRoundView(res.data.round_no);
}

export interface CloseRoundResult {
  round: RoundView;
  still_owed: PrLineView[];
}

/** Closing does not refuse over a line still owed: that line comes back in the
 *  next round through `syncRound`, which is how it stays somebody's problem
 *  without anybody carrying it forward by hand.
 *
 *  The seam answers a **count**; the screen draws the **lines** (`still_owed`
 *  is what closing released — the step everyone forgets). Reads the round
 *  after closing rather than recomputing which lines those are: `lines` on
 *  the freshly-fetched `RoundView` still holds every line that was in this
 *  round, closed or not, and `coverage.settled` on each is the same column
 *  `v_pr_line` already computed — not a second reckoning of what "still owed"
 *  means. */
export async function closeRound(
  roundNo: string, idempotencyKey?: string,
): Promise<Result<CloseRoundResult>> {
  const { data, error } = await db().rpc("close_round", {
    p_round_no: roundNo, p_key: idempotencyKey ?? null,
  });
  const res = fromSeam(SERVICE, data, error);
  if (res.error) return res;
  const view = await getRoundView(roundNo);
  if (view.error) return view;
  return ok(SERVICE, {
    round: view.data,
    still_owed: view.data.lines.filter((l) => !l.coverage.settled),
  });
}

/** What the next round would pick up, before anybody presses the button. */
export async function roundEligible(): Promise<Result<{ line_no_full: string; remaining: number }[]>> {
  const { data, error } = await db().from("v_round_eligible").select("line_no_full, remaining");
  return fromRows(SERVICE, data as { line_no_full: string; remaining: number }[], error);
}

/** The answer coming back from chat. **Not called from a screen** — it is here
 *  so the webhook handler that verifies Google's signature has one place to land,
 *  and so that `answered_by_email` is visibly a parameter rather than something
 *  taken from the session. Taking it from the session is the bug D69 exists to
 *  prevent.
 *
 *  Still short of the demo's contract on purpose: the seam has nowhere to put
 *  `approved_qty` / `approved_amount` / `remark` yet (`answer_request` takes
 *  only `p_token`, `p_approved`, `p_answered_by_email`, `p_instructions`), so
 *  this does not claim to accept them — a field this function silently
 *  dropped would be worse than one it never offered. `answerFromChat` stays
 *  on `PENDING_PARITY` until the seam grows those parameters; what changed is
 *  the return shape, which now redraws the line instead of echoing the seam. */
export async function answerFromChat(
  input: { token: string; approved: boolean; answered_by_email: string; instructions?: string | null },
  idempotencyKey?: string,
): Promise<Result<PrLineView>> {
  const { data, error } = await db().rpc("answer_request", {
    p_token: input.token,
    p_approved: input.approved,
    p_answered_by_email: input.answered_by_email,
    p_instructions: input.instructions ?? null,
    p_key: idempotencyKey ?? null,
  });
  const res = fromSeam<{ line_no: string }>(SERVICE, data, error);
  if (res.error) return res;
  return getLine(res.data.line_no);
}

async function getLine(lineNo: string): Promise<Result<PrLineView>> {
  const { data, error } = await db().from("v_pr_line").select("*").eq("line_no_full", lineNo).maybeSingle();
  if (error) return fail(SERVICE, error);
  if (!data) {
    return {
      error: {
        code: "line_not_found", message: `Line ${lineNo} not found.`,
        outcome: "refused", status: 404,
      },
      meta: { request_id: "", service: SERVICE, version: "1", outcome: "refused" },
    };
  }
  return ok(SERVICE, toLineView(data as LineRow));
}

/* ------------------------------------------------------------------ */
/* Reference data                                                      */
/* ------------------------------------------------------------------ */

/** Uncurated vendors are **in the list and absent from dropdowns** — `curated`
 *  is the caller's filter, not a rule applied here. Refusing them outright is
 *  how a workshop ends up buying off-system (D30). */
export async function listVendors(
  opts: { q?: string; curated?: boolean } = {},
): Promise<Result<Vendor[]>> {
  /* Every caller is a picker, so an archived vendor is never offered (`0099`). */
  let q = db().from("vendors").select("*").is("merged_into", null).is("archived_at", null);
  if (opts.curated !== undefined) q = q.eq("is_curated", opts.curated);
  if (opts.q) q = q.ilike("name", `%${opts.q}%`);
  const { data, error } = await q.order("name");
  return fromRows<Vendor[]>(SERVICE, data as Vendor[], error);
}

/* ── Why these lists name their columns ──────────────────────────────────
 *
 *  `v_vendor_view` and `v_item_view` each carry a handful of columns computed
 *  by a **correlated subquery, once per row**: a vendor's `items_bought` and
 *  `absorbed`, an item's `sourced_from`. `select("*")` asks Postgres for all
 *  of them, so the cost of the list is the number of rows times the cost of
 *  scanning the purchase history.
 *
 *  That was free while the tables were empty and stopped being free the day
 *  the legacy import landed 296 vendors and 1.020 items: `/procurement/supplier`
 *  began answering **500, statement timeout**, measured in production. Naming
 *  the columns the list actually draws takes the same 296 rows from a timeout
 *  to **14 ms**, because a subquery in the target list is not evaluated when
 *  nothing selects it.
 *
 *  The heavy columns are all **drawer-only** — no list row draws them — so the
 *  detail fetch below is where they belong, and it runs the subquery once
 *  rather than three hundred times.
 *
 *  This is not pagination, and pagination would not have fixed it: the per-row
 *  cost would still be there, one page later.
 */
const VENDOR_LIST_COLUMNS =
  "id, code, name, aka, merged_into, is_curated, archived_at, phone, address, pic_name, "
  + "pic_phone, bank_account, bank_account_secondary, npwp, supplied_categories, "
  + "created_by, created_at, updated_at, supplied_category_names, "
  + "transaction_count, total_spend, last_purchase, open_pr_lines, bought_categories";

export async function listVendorViews(
  opts: { q?: string; include_archived?: boolean } = {},
): Promise<Result<VendorView[]>> {
  let q = db().from("v_vendor_view").select(VENDOR_LIST_COLUMNS).is("merged_into", null);
  if (!opts.include_archived) q = q.is("archived_at", null);
  if (opts.q) q = q.ilike("name", `%${opts.q}%`);
  const { data, error } = await q.order("name");
  if (error) return fail(SERVICE, error);
  /* Empty rather than absent, so the field exists and the screen can render
     before the detail arrives. The drawer replaces the row with `getVendor`'s
     answer; a list row never reads either of these. */
  return ok(SERVICE, ((data ?? []) as unknown as Omit<VendorView, "absorbed" | "items_bought">[])
    .map((v) => ({ ...v, absorbed: [], items_bought: [] })));
}

/** One vendor, with the history the list leaves out.
 *
 *  What the drawer opens onto. Running the per-row subqueries for a single id
 *  is the cheap direction of the same query that times out across 296. */
export async function getVendor(id: string): Promise<Result<VendorView>> {
  const { data, error } = await db().from("v_vendor_view").select("*").eq("id", id).maybeSingle();
  if (error) return fail(SERVICE, error);
  if (!data) return notFound(SERVICE, "vendor_not_found", "Vendor not found.");
  return ok(SERVICE, data as unknown as VendorView);
}

export async function listItems(
  opts: { q?: string; curated?: boolean } = {},
): Promise<Result<Item[]>> {
  /* A picker's list: merged and archived items are out (`0104`). */
  let q = db().from("items").select("*").is("merged_into", null).is("archived_at", null);
  if (opts.curated !== undefined) q = q.eq("is_curated", opts.curated);
  if (opts.q) q = q.ilike("name", `%${opts.q}%`);
  const { data, error } = await q.order("name");
  return fromRows<Item[]>(SERVICE, data as Item[], error);
}

/** Everything but `sourced_from` — see the note above `VENDOR_LIST_COLUMNS`.
 *  1.020 items times one scan of the purchase history each is the same bomb. */
const ITEM_LIST_COLUMNS =
  "id, code, name, aka, merged_into, category_code, base_uom, kind, is_curated, "
  + "standard_price, last_price, last_vendor_id, last_purchased_at, created_by, "
  + "created_at, category_name, last_vendor_name, suggested_price, purchase_count, "
  + "archived_at, top_category_code, category_path";

/** The catalogue list. `category` matches an item filed under the category
 *  itself or under any of its item types; `curated` and `include_archived`
 *  are the same filters the demo applies — until `0104` this client ignored
 *  both `category` and `curated`, so the filter on the screen did nothing live. */
export async function listItemViews(
  opts: { q?: string; category?: string; curated?: boolean; include_archived?: boolean } = {},
): Promise<Result<ItemView[]>> {
  let q = db().from("v_item_view").select(ITEM_LIST_COLUMNS).is("merged_into", null);
  if (!opts.include_archived) q = q.is("archived_at", null);
  if (opts.curated !== undefined) q = q.eq("is_curated", opts.curated);
  if (opts.category) {
    q = q.or(`category_code.eq.${opts.category},top_category_code.eq.${opts.category}`);
  }
  if (opts.q) q = q.ilike("name", `%${opts.q}%`);
  const { data, error } = await q.order("name");
  if (error) return fail(SERVICE, error);
  return ok(SERVICE, ((data ?? []) as unknown as Omit<ItemView, "sourced_from">[])
    .map((i) => ({ ...i, sourced_from: [] })));
}

/** One item, with the vendors it has been bought from. The drawer's half. */
export async function getItem(id: string): Promise<Result<ItemView>> {
  const { data, error } = await db().from("v_item_view").select("*").eq("id", id).maybeSingle();
  if (error) return fail(SERVICE, error);
  if (!data) return notFound(SERVICE, "item_not_found", "Item not found.");
  return ok(SERVICE, data as unknown as ItemView);
}

export async function listUom(): Promise<Result<Uom[]>> {
  const { data, error } = await db().from("uom").select("*").order("code");
  return fromRows<Uom[]>(SERVICE, data as Uom[], error);
}

export async function listUomConversions(): Promise<Result<UomConversion[]>> {
  const { data, error } = await db().from("uom_conversions")
    .select("id, from_uom, to_uom, factor, yield_ratio, note")
    .order("from_uom").order("to_uom");
  if (error) return fail(SERVICE, error);
  /* `numeric` comes back from PostgREST as a string; the contract says number. */
  return ok(SERVICE, (data ?? []).map((c) => ({
    ...c,
    factor: Number(c.factor),
    yield_ratio: c.yield_ratio == null ? null : Number(c.yield_ratio),
  })) as UomConversion[]);
}

/** Units are written only through the `0099` seams, which is where the audit
 *  row and the in-use check live; RLS gives this table select and nothing else. */
export async function createUom(
  input: { code: string; name: string; dimension: UomDimension },
): Promise<Result<Uom>> {
  const { data, error } = await db().rpc("create_uom", {
    p_code: input.code, p_name: input.name, p_dimension: input.dimension,
  });
  return fromSeam<Uom>(SERVICE, data, error);
}

export async function updateUom(
  code: string, input: { name: string; dimension: UomDimension },
): Promise<Result<Uom>> {
  const { data, error } = await db().rpc("update_uom", {
    p_code: code, p_name: input.name, p_dimension: input.dimension,
  });
  return fromSeam<Uom>(SERVICE, data, error);
}

export async function deleteUom(code: string): Promise<Result<{ code: string; deleted: true }>> {
  const { data, error } = await db().rpc("delete_uom", { p_code: code });
  return fromSeam<{ code: string; deleted: true }>(SERVICE, data, error);
}

export async function saveUomConversion(
  input: { from_uom: string; to_uom: string; factor: number; yield_ratio?: number | null; note?: string | null },
): Promise<Result<UomConversion>> {
  const { data, error } = await db().rpc("save_uom_conversion", {
    p_from: input.from_uom, p_to: input.to_uom, p_factor: input.factor,
    p_yield_ratio: input.yield_ratio ?? null, p_note: input.note ?? null,
  });
  const saved = fromSeam(SERVICE, data, error);
  if (saved.error) return saved;
  /* The seam answers what it wrote; the row itself — id included — is read
     back, the same shape `listUomConversions` answers. */
  const { data: row, error: e2 } = await db().from("uom_conversions")
    .select("id, from_uom, to_uom, factor, yield_ratio, note")
    .eq("from_uom", input.from_uom).eq("to_uom", input.to_uom).maybeSingle();
  if (e2) return fail(SERVICE, e2);
  if (!row) return notFound(SERVICE, "conversion_not_found", "No such conversion.");
  return ok(SERVICE, {
    ...row, factor: Number(row.factor), yield_ratio: row.yield_ratio == null ? null : Number(row.yield_ratio),
  } as UomConversion);
}

export async function deleteUomConversion(
  fromUom: string, toUom: string,
): Promise<Result<{ from_uom: string; to_uom: string; deleted: true }>> {
  const { data, error } = await db().rpc("delete_uom_conversion", { p_from: fromUom, p_to: toUom });
  return fromSeam<{ from_uom: string; to_uom: string; deleted: true }>(SERVICE, data, error);
}

export async function listCategories(): Promise<Result<ItemCategory[]>> {
  const { data, error } = await db().from("item_categories").select("*").order("name");
  return fromRows<ItemCategory[]>(SERVICE, data as ItemCategory[], error);
}

/* ------------------------------------------------------------------ */
/* Item master (0104): the category tree, editing, archive, merge      */
/* ------------------------------------------------------------------ */

async function categoryByCode(code: string): Promise<Result<ItemCategory>> {
  const { data, error } = await db().from("item_categories").select("*").eq("code", code).maybeSingle();
  if (error) return fail(SERVICE, error);
  if (!data) return notFound(SERVICE, "category_not_found", "No such category.");
  return ok(SERVICE, data as ItemCategory);
}

/** Two levels, never three; the code is derived from the name by the seam. */
export async function createCategory(
  input: { name: string; parent_code?: string | null },
): Promise<Result<ItemCategory>> {
  const { data, error } = await db().rpc("create_category", {
    p_name: input.name, p_parent_code: input.parent_code ?? null,
  });
  const res = fromSeam<{ code: string }>(SERVICE, data, error);
  if (res.error) return res;
  return categoryByCode(res.data.code);
}

export async function updateCategory(
  code: string, input: { name: string; parent_code?: string | null },
): Promise<Result<ItemCategory>> {
  const { data, error } = await db().rpc("update_category", {
    p_code: code, p_name: input.name, p_parent_code: input.parent_code ?? null,
  });
  const res = fromSeam(SERVICE, data, error);
  if (res.error) return res;
  return categoryByCode(code);
}

export async function deleteCategory(code: string): Promise<Result<{ code: string; deleted: true }>> {
  const { data, error } = await db().rpc("delete_category", { p_code: code });
  const res = fromSeam(SERVICE, data, error);
  if (res.error) return res;
  return ok(SERVICE, { code, deleted: true as const });
}

/** Every field but the code, each optional; `standard_price: null` clears the
 *  price on purpose, which the seam takes as its own flag so that leaving the
 *  field out can never wipe it. */
export async function updateItem(
  id: string,
  input: {
    name?: string; category_code?: string; base_uom?: UomCode;
    kind?: "goods" | "service"; standard_price?: number | null;
  },
): Promise<Result<ItemView>> {
  const code = await codeFor("items", id);
  if (!code) return notFound(SERVICE, "item_not_found", "Item not found.");
  const { data, error } = await db().rpc("update_item", {
    p_code: code,
    p_name: input.name ?? null,
    p_category_code: input.category_code ?? null,
    p_base_uom: input.base_uom ?? null,
    p_kind: input.kind ?? null,
    p_standard_price: input.standard_price ?? null,
    p_clear_standard_price: input.standard_price === null,
  });
  const res = fromSeam(SERVICE, data, error);
  if (res.error) return res;
  return itemViewByCode(code);
}

export async function archiveItem(id: string, archived: boolean): Promise<Result<ItemView>> {
  const code = await codeFor("items", id);
  if (!code) return notFound(SERVICE, "item_not_found", "Item not found.");
  const { data, error } = await db().rpc("archive_item", { p_code: code, p_archived: archived });
  const res = fromSeam(SERVICE, data, error);
  if (res.error) return res;
  return itemViewByCode(code);
}

/** Many at once, with the reason written once (`0120`). */
export async function archiveItems(
  ids: string[], reason?: string,
): Promise<Result<{ archived: number; codes: string[] }>> {
  if (ids.length === 0) return invalid(SERVICE, "codes_required", "Pick at least one item.", { field: "codes" });
  const { data: rows, error: e1 } = await db().from("items").select("code").in("id", ids);
  if (e1) return fail(SERVICE, e1);
  const { data, error } = await db().rpc("archive_items", {
    p_codes: (rows ?? []).map((r) => (r as { code: string }).code),
    p_reason: reason ?? null,
  });
  return fromSeam<{ archived: number; codes: string[] }>(SERVICE, data, error);
}

/** Proposed item types for the uncurated pile — the same pure function the
 *  demo runs (`services/procurement/suggest.ts`), over every uncurated,
 *  live item. One read of names, not of the catalogue view. */
export async function suggestItemGroups(): Promise<Result<ItemGroupSuggestion[]>> {
  const [pile, cats] = await Promise.all([
    db().from("items").select("id, name, category_code")
      .eq("is_curated", false).is("merged_into", null).is("archived_at", null).limit(5000),
    listCategories(),
  ]);
  if (pile.error) return fail(SERVICE, pile.error);
  if (cats.error) return cats;
  return ok(SERVICE, suggestGroups(
    (pile.data ?? []) as { id: string; name: string; category_code: string }[], cats.data,
  ));
}

/** A pointer, never a delete (`0104`); answers the survivor. */
export async function mergeItem(loserId: string, winnerId: string): Promise<Result<ItemView>> {
  const [loser, winner] = await Promise.all([codeFor("items", loserId), codeFor("items", winnerId)]);
  if (!loser || !winner) return notFound(SERVICE, "item_not_found", "Item not found.");
  const { data, error } = await db().rpc("merge_item", { p_loser_code: loser, p_winner_code: winner });
  const res = fromSeam(SERVICE, data, error);
  if (res.error) return res;
  return itemViewByCode(winner);
}

export async function setItemsCategory(
  ids: string[], categoryCode: string, curate?: boolean,
): Promise<Result<{ updated: number; category_code: string }>> {
  const { data: rows, error: e1 } = await db().from("items").select("code").in("id", ids);
  if (e1) return fail(SERVICE, e1);
  const { data, error } = await db().rpc("set_items_category", {
    p_codes: (rows ?? []).map((r) => (r as { code: string }).code),
    p_category_code: categoryCode,
    p_curate: curate ?? null,
  });
  return fromSeam<{ updated: number; category_code: string }>(SERVICE, data, error);
}

/** The item's ledger lines, merged duplicates included. Read through a
 *  definer function gated by `procurement.read`, so the catalogue can show a
 *  purchase history without the reader holding accounting's grants. */
export async function itemPurchases(id: string): Promise<Result<ItemPurchase[]>> {
  const code = await codeFor("items", id);
  if (!code) return notFound(SERVICE, "item_not_found", "Item not found.");
  const { data, error } = await db().rpc("item_purchases", { p_code: code });
  const res = fromSeam<ItemPurchase[]>(SERVICE, data, error);
  if (res.error) return res;
  /* `numeric` arrives as a string from jsonb only when it was one; these are
     jsonb numbers already, but the contract is strict about it. */
  return ok(SERVICE, res.data.map((r) => ({
    ...r,
    qty: r.qty == null ? null : Number(r.qty),
    unit_price: r.unit_price == null ? null : Number(r.unit_price),
    amount: Number(r.amount),
  })));
}

export async function listProjects(): Promise<Result<Project[]>> {
  const { data, error } = await db().from("projects").select("*").order("code");
  return fromRows<Project[]>(SERVICE, data as Project[], error);
}

/* ── the customer's order (0111) ─────────────────────────────────────────
 *
 *  Every write is a seam in `ops_procure` asking for `project.*`; every read
 *  is a view. `contract_value`, `order_value` and line prices are `numeric`,
 *  which PostgREST may hand back as strings, so each row is shaped by hand. */

interface ProjectRow extends Omit<ProjectView, "contract_value" | "order_value"> {
  contract_value: number | string | null;
  order_value: number | string | null;
}

interface ProjectLineRow extends Omit<ProjectLineView, "qty" | "unit_price" | "product_production_cost" | "job_order_qty" | "job_order_completed"> {
  qty: number | string;
  job_order_qty: number | string | null;
  job_order_completed: number | string | null;
  unit_price: number | string | null;
  product_production_cost: number | string | null;
}

const numOrNull = (v: number | string | null | undefined): number | null => (v == null ? null : Number(v));

function toProjectView(r: ProjectRow): ProjectView {
  return { ...r, contract_value: numOrNull(r.contract_value), order_value: numOrNull(r.order_value) };
}

function toProjectLineView(r: ProjectLineRow): ProjectLineView {
  return {
    ...r,
    qty: Number(r.qty),
    unit_price: numOrNull(r.unit_price),
    product_production_cost: numOrNull(r.product_production_cost),
    job_order_qty: Number(r.job_order_qty ?? 0),
    job_order_completed: Number(r.job_order_completed ?? 0),
  };
}

export async function listProjectViews(): Promise<Result<ProjectView[]>> {
  const { data, error } = await db().from("v_project").select("*").order("code", { ascending: false });
  if (error) return fail(SERVICE, error);
  return ok(SERVICE, ((data ?? []) as ProjectRow[]).map(toProjectView));
}

export async function getProject(code: string): Promise<Result<ProjectView>> {
  const { data, error } = await db().from("v_project").select("*").eq("code", code).maybeSingle();
  if (error) return fail(SERVICE, error);
  if (!data) return notFound(SERVICE, "project_not_found", `No project ${code}.`);
  return ok(SERVICE, toProjectView(data as ProjectRow));
}

export async function listProjectHistory(code: string): Promise<Result<ProjectStatusChange[]>> {
  const project = await getProject(code);
  if (project.error) return project;
  const { data, error } = await db().from("project_status_log")
    .select("from_status, to_status, reason, changed_by, changed_at")
    .eq("project_id", project.data.id).order("changed_at", { ascending: false });
  if (error) return fail(SERVICE, error);
  const rows = (data ?? []) as ProjectStatusChange[];
  /* Names, not uuids — one read, and a name the reader may not see stays the id. */
  const ids = [...new Set(rows.map((r) => r.changed_by).filter((x): x is string => !!x))];
  const { data: users } = ids.length
    ? await supabaseBrowser().schema("ops_core").from("users").select("id, full_name").in("id", ids)
    : { data: [] };
  const nameOf = new Map(((users ?? []) as { id: string; full_name: string }[]).map((u) => [u.id, u.full_name]));
  return ok(SERVICE, rows.map((r) => ({ ...r, changed_by: r.changed_by ? nameOf.get(r.changed_by) ?? r.changed_by : null })));
}

export async function saveProject(
  input: {
    code?: string | null;
    name: string;
    client_code?: string | null;
    location?: string | null;
    pic?: string | null;
    started_on?: string | null;
    target_date?: string | null;
    contract_value?: number | null;
    note?: string | null;
  },
  _idempotencyKey?: string,
): Promise<Result<ProjectView>> {
  const { data, error } = await db().rpc("save_project", {
    p_code: input.code ?? null,
    p_name: input.name,
    p_client_code: input.client_code ?? null,
    p_location: input.location ?? null,
    p_pic: input.pic ?? null,
    p_started_on: input.started_on || null,
    p_target_date: input.target_date || null,
    p_contract_value: input.contract_value ?? null,
    p_note: input.note ?? null,
  });
  const res = fromSeam<{ code: string }>(SERVICE, data, error);
  if (res.error) return res;
  return getProject(res.data.code);
}

export async function setProjectStatus(
  input: { code: string; status: ProjectStatus; reason?: string | null },
): Promise<Result<ProjectView>> {
  const { data, error } = await db().rpc("set_project_status", {
    p_code: input.code, p_status: input.status, p_reason: input.reason ?? null,
  });
  const res = fromSeam(SERVICE, data, error);
  if (res.error) return res;
  return getProject(input.code);
}

export async function listProjectLines(code: string): Promise<Result<ProjectLineView[]>> {
  const { data, error } = await db().from("v_project_line").select("*")
    .eq("project_code", code).order("line_no");
  if (error) return fail(SERVICE, error);
  return ok(SERVICE, ((data ?? []) as ProjectLineRow[]).map(toProjectLineView));
}

export async function saveProjectLine(
  input: {
    project_code: string;
    line_id?: string | null;
    product_code?: string | null;
    description: string;
    qty: number;
    uom: string;
    unit_price?: number | null;
    delivery_date?: string | null;
    note?: string | null;
  },
): Promise<Result<ProjectLineView[]>> {
  const { data, error } = await db().rpc("save_project_line", {
    p_project_code: input.project_code,
    p_line_id: input.line_id ?? null,
    p_product_code: input.product_code ?? null,
    p_description: input.description,
    p_qty: input.qty,
    p_uom: input.uom,
    p_unit_price: input.unit_price ?? null,
    p_delivery_date: input.delivery_date || null,
    p_note: input.note ?? null,
  });
  const res = fromSeam(SERVICE, data, error);
  if (res.error) return res;
  return listProjectLines(input.project_code);
}

export async function removeProjectLine(
  input: { project_code: string; line_id: string },
): Promise<Result<ProjectLineView[]>> {
  const { data, error } = await db().rpc("remove_project_line", {
    p_project_code: input.project_code, p_line_id: input.line_id,
  });
  const res = fromSeam(SERVICE, data, error);
  if (res.error) return res;
  return listProjectLines(input.project_code);
}

export async function listClients(
  opts: { include_archived?: boolean } = {},
): Promise<Result<ClientView[]>> {
  let q = db().from("clients").select("*");
  if (!opts.include_archived) q = q.is("archived_at", null);
  const [{ data, error }, { data: projects, error: pErr }] = await Promise.all([
    q.order("name"),
    db().from("projects").select("client_id, is_active").not("client_id", "is", null),
  ]);
  if (error) return fail(SERVICE, error);
  if (pErr) return fail(SERVICE, pErr);
  const ps = (projects ?? []) as { client_id: string; is_active: boolean }[];
  return ok(SERVICE, ((data ?? []) as Client[]).map((c) => ({
    ...c,
    project_count: ps.filter((p) => p.client_id === c.id).length,
    active_project_count: ps.filter((p) => p.client_id === c.id && p.is_active).length,
  })));
}

async function clientByCode(code: string): Promise<Result<ClientView>> {
  const res = await listClients({ include_archived: true });
  if (res.error) return res;
  const c = res.data.find((x) => x.code === code);
  return c ? ok(SERVICE, c) : notFound(SERVICE, "client_not_found", `Tidak ada klien ${code}.`);
}

export async function saveClient(
  input: {
    code?: string | null;
    name: string;
    contact_name?: string | null;
    phone?: string | null;
    email?: string | null;
    address?: string | null;
    npwp?: string | null;
    note?: string | null;
  },
): Promise<Result<ClientView>> {
  const { data, error } = await db().rpc("save_client", {
    p_code: input.code ?? null,
    p_name: input.name,
    p_contact_name: input.contact_name ?? null,
    p_phone: input.phone ?? null,
    p_email: input.email ?? null,
    p_address: input.address ?? null,
    p_npwp: input.npwp ?? null,
    p_note: input.note ?? null,
  });
  const res = fromSeam<{ code: string }>(SERVICE, data, error);
  if (res.error) return res;
  return clientByCode(res.data.code);
}

export async function archiveClient(
  input: { code: string; archived: boolean },
): Promise<Result<ClientView>> {
  const { data, error } = await db().rpc("archive_client", {
    p_code: input.code, p_archived: input.archived,
  });
  const res = fromSeam(SERVICE, data, error);
  if (res.error) return res;
  return clientByCode(input.code);
}

export async function curateVendor(id: string, curated: boolean): Promise<Result<VendorView>> {
  const code = await codeFor("vendors", id);
  if (!code) return notFound(SERVICE, "vendor_not_found", "Vendor not found.");

  const { data, error } = await db().rpc("curate_vendor", {
    p_code: code, p_curated: curated,
  });
  const res = fromSeam(SERVICE, data, error);
  if (res.error) return res;
  return vendorViewByCode(code);
}

/** Fold a duplicate spelling into the real vendor.
 *
 *  A pointer, never a delete (D33): the absorbed row is kept and marked, so
 *  every transaction that pointed at it still points at it and history does not
 *  move when somebody corrects a name years later. Readers follow `merged_into`
 *  — `v_vendor_view` does, which is why the winner's `total_spend` grows by
 *  exactly what the loser carried.
 *
 *  Only ever a human decision. Two spellings differing by nothing but spacing
 *  are one thing; two differing by a word are a question, and the answer is not
 *  the machine's.
 *
 *  Answers the **winner's** view, because that is the row the screen keeps.
 */
export async function mergeVendor(loserId: string, winnerId: string): Promise<Result<VendorView>> {
  const [loser, winner] = await Promise.all([
    codeFor("vendors", loserId), codeFor("vendors", winnerId),
  ]);
  if (!loser || !winner) return notFound(SERVICE, "vendor_not_found", "Vendor not found.");

  const { data, error } = await db().rpc("merge_vendor", {
    p_loser_code: loser, p_winner_code: winner,
  });
  const res = fromSeam(SERVICE, data, error);
  if (res.error) return res;
  return vendorViewByCode(winner);
}

/** The display name. The old spelling joins `aka` in the seam (`0099`), so a
 *  search for what people used to type still finds this vendor. */
export async function renameVendor(id: string, name: string): Promise<Result<VendorView>> {
  const code = await codeFor("vendors", id);
  if (!code) return notFound(SERVICE, "vendor_not_found", "Vendor not found.");
  const { data, error } = await db().rpc("rename_vendor", { p_code: code, p_name: name });
  const res = fromSeam(SERVICE, data, error);
  if (res.error) return res;
  return vendorViewByCode(code);
}

/** Out of every picker, kept in every record. Reversible. */
export async function archiveVendor(id: string, archived: boolean): Promise<Result<VendorView>> {
  const code = await codeFor("vendors", id);
  if (!code) return notFound(SERVICE, "vendor_not_found", "Vendor not found.");
  const { data, error } = await db().rpc("archive_vendor", { p_code: code, p_archived: archived });
  const res = fromSeam(SERVICE, data, error);
  if (res.error) return res;
  return vendorViewByCode(code);
}

/** Only a vendor nothing points at; the seam refuses the rest with the count
 *  of what still names them. */
export async function deleteVendor(id: string): Promise<Result<{ id: string; deleted: true }>> {
  const code = await codeFor("vendors", id);
  if (!code) return notFound(SERVICE, "vendor_not_found", "Vendor not found.");
  const { data, error } = await db().rpc("delete_vendor", { p_code: code });
  const res = fromSeam(SERVICE, data, error);
  if (res.error) return res;
  return ok(SERVICE, { id, deleted: true as const });
}

/* ------------------------------------------------------------------ */
/* Rounds, orders, receiving                                           */
/* ------------------------------------------------------------------ */

/** `RoundView`, restated here the way `AuditRow` is in `accounting.ts`: the
 *  demo declares it locally (`src/demo/api/procurement.ts`), not in the
 *  shared contracts, because it is `RoundSummary` plus the lines a screen
 *  draws beside it — the same shape `check-api-parity.mjs` compares
 *  structurally rather than by import. */
interface RoundView extends RoundSummary {
  lines: PrLineView[];
}

/** `v_round_summary` (`0087`) carries every `RoundSummary` field including
 *  the three money figures the demo computes from in-memory state
 *  (`paying_balance`, `to_transfer`, `remaining_after_payment`); `transfers`
 *  and `lines` are two more reads next to it, exactly the shape `roundView()`
 *  assembles in the demo. Not a derivation — every number here already came
 *  out of a view or a table as itself. */
async function getRoundView(roundNo: string): Promise<Result<RoundView>> {
  const { data: summary, error: e1 } = await db()
    .from("v_round_summary").select("*").eq("round_no", roundNo).maybeSingle();
  if (e1) return fail(SERVICE, e1);
  if (!summary) return notFound(SERVICE, "round_not_found", `Round ${roundNo} not found.`);
  const roundId = (summary as RoundSummary).round_id;

  const [transfersRes, roundLinesRes] = await Promise.all([
    db().from("round_transfers").select("*").eq("round_id", roundId).order("recorded_at"),
    db().from("v_line_round").select("line_id").eq("round_no", roundNo),
  ]);
  if (transfersRes.error) return fail(SERVICE, transfersRes.error);
  if (roundLinesRes.error) return fail(SERVICE, roundLinesRes.error);

  const lineIds = (roundLinesRes.data ?? []).map((r) => (r as { line_id: string }).line_id);
  let lines: PrLineView[] = [];
  if (lineIds.length) {
    const { data: lineRows, error: e3 } = await db().from("v_pr_line").select("*").in("id", lineIds);
    if (e3) return fail(SERVICE, e3);
    lines = (lineRows ?? []).map((r) => toLineView(r as LineRow));
  }

  return ok(SERVICE, {
    ...(summary as RoundSummary),
    transfers: (transfersRes.data ?? []) as RoundTransfer[],
    lines,
  });
}

export async function listRounds(): Promise<Result<RoundView[]>> {
  const { data, error } = await db().from("v_round_summary").select("round_no")
    .order("opened_at", { ascending: false });
  if (error) return fail(SERVICE, error);
  const views = await Promise.all(
    (data ?? []).map((r) => getRoundView((r as { round_no: string }).round_no)),
  );
  const failed = views.find((v) => v.error);
  if (failed?.error) return { error: failed.error, meta: failed.meta };
  return ok(SERVICE, views.map((v) => (v as { data: RoundView }).data));
}

export async function getRound(roundNo: string): Promise<Result<RoundView>> {
  return getRoundView(roundNo);
}

export async function approveRound(roundNo: string, idempotencyKey?: string): Promise<Result<RoundView>> {
  const { data, error } = await db().rpc("approve_round", {
    p_round_no: roundNo, p_key: idempotencyKey ?? null,
  });
  const res = fromSeam(SERVICE, data, error);
  if (res.error) return res;
  return getRoundView(roundNo);
}

/** Recording an instalment. It moves the round to TRANSFERRED and **makes not
 *  one line PAID** — that is D6, and it is the database's business, not this
 *  file's. */
export async function transferRound(
  roundNo: string,
  input: { amount: number; trx_no: string; proof_attachment_id: string },
  idempotencyKey?: string,
): Promise<Result<RoundView>> {
  const { data, error } = await db().rpc("transfer_round", {
    p_round_no: roundNo,
    p_amount: input.amount,
    p_trx_no: input.trx_no,
    p_proof: input.proof_attachment_id,
    p_key: idempotencyKey ?? null,
  });
  const res = fromSeam(SERVICE, data, error);
  if (res.error) return res;
  return getRoundView(roundNo);
}

/** Rp 12,7 M — for a sentence, not a column. */
function formatShort(n: number): string {
  if (n >= 1_000_000_000) return `Rp ${(n / 1_000_000_000).toFixed(1)} B`;
  if (n >= 1_000_000) return `Rp ${(n / 1_000_000).toFixed(1)} M`;
  return `Rp ${n.toLocaleString(getActiveLocale())}`;
}

/** One sentence a person can act on, rather than four numbers to compare.
 *
 *  **The one derived field in this file, and the exception is the point.** Rule
 *  1 of this module is that nothing derived is computed here: status, coverage,
 *  the variance, what a vendor could invoice — all of it arrives computed, so
 *  there is one definition of each rule rather than two that drift.
 *
 *  `headline` is not one of those. It is a sentence, formatted in the reader's
 *  locale, and putting it in the view would bake a locale into the database —
 *  which is not a rule about money, it is a decision about who is reading. The
 *  numbers it is built from are all derived, all in the row, and not recomputed
 *  here; only the wording is.
 *
 *  `check-view-contracts.mjs` records that choice against `v_vendor_journey` as
 *  a `composed` field, so *the client fills this in* is a claim somebody had to
 *  write down rather than a gap that looks like the two bugs beside it.
 */
function headlineFor(j: Omit<VendorJourney, "headline">): string {
  if (j.billable_now > 0) {
    return `${formatShort(j.billable_now)} can be invoiced now — goods have arrived that nobody has paid for`;
  }
  if (j.outstanding > 0) {
    return `${formatShort(j.outstanding)} still contracted, and nothing is billable until more arrives`;
  }
  return "Fully settled — every order paid against what has arrived";
}

export async function listVendorJourneys(): Promise<Result<VendorJourney[]>> {
  const { data, error } = await db()
    .from("v_vendor_journey").select("*").gt("orders", 0).order("vendor_name");
  if (error) return fail(SERVICE, error);
  const rows = (data ?? []) as Omit<VendorJourney, "headline">[];
  return ok(SERVICE, rows.map((j) => ({ ...j, headline: headlineFor(j) })));
}

export async function getVendorJourney(vendorId: string): Promise<Result<VendorJourney>> {
  const { data, error } = await db()
    .from("v_vendor_journey").select("*").eq("vendor_id", vendorId).maybeSingle();
  if (error) return fail(SERVICE, error);
  if (!data) return notFound(SERVICE, "vendor_not_found", "Vendor not found.");
  const j = data as Omit<VendorJourney, "headline">;
  return ok(SERVICE, { ...j, headline: headlineFor(j) });
}

/** Leadership's answer on the order itself, which may be **no**.
 *
 *  Declining clears the approval and records `decline` in the trail, and it
 *  needs a note: *no* with no sentence attached is a message procurement cannot
 *  pass on to the supplier. Before `0033` the seam could only say yes, so the
 *  only trace of a refusal was `approved_at` staying null — indistinguishable
 *  from nobody having looked yet.
 */
export async function approvePo(
  input: { po_no: string; approved: boolean; note?: string | null },
): Promise<Result<PoDetail>> {
  const { data, error } = await db().rpc("approve_po", {
    p_po_no: input.po_no, p_approved: input.approved,
    p_note: input.note ?? null, p_key: null,
  });
  return afterPo(input.po_no, fromSeam(SERVICE, data, error));
}

export async function issuePo(poNo: string, idempotencyKey?: string): Promise<Result<PoDetail>> {
  const { data, error } = await db().rpc("issue_po", {
    p_po_no: poNo, p_key: idempotencyKey ?? null,
  });
  return afterPo(poNo, fromSeam(SERVICE, data, error));
}

/** An amendment after issue is a **revision**, not an edit (D135): the old line
 *  stays pointing forward, and the vendor is holding a piece of paper that two
 *  of them have to be tellable apart.
 *
 *  `qty` and `unit_price` are optional and mean *leave this one alone*. The
 *  drawer amends a quantity without restating a price, and making it resend the
 *  old price is how a stale number gets written back over a fresh one.
 *
 *  `reason` is not. It is the whole record of why the vendor's paper changed.
 */
export async function amendPoLine(
  input: {
    po_no: string; line_no: number;
    qty?: number; unit_price?: number; description?: string;
    reason: string;
  },
): Promise<Result<PoDetail>> {
  const { data, error } = await db().rpc("amend_po_line", {
    p_po_no: input.po_no, p_line_no: input.line_no,
    p_reason: input.reason,
    p_qty: input.qty ?? null,
    p_unit_price: input.unit_price ?? null,
    p_description: input.description ?? null,
    p_key: null,
  });
  return afterPo(input.po_no, fromSeam(SERVICE, data, error));
}

/** Refuses while anything is outstanding, and the refusal's `detail.blockers`
 *  says which — a refusal that only says no leaves somebody clicking it again
 *  next week (D132).
 *
 *  `settle_reason` is how an order that will never finish gets closed anyway.
 *  Eight of ten crates arrive, the supplier stops answering, and somebody
 *  decides the company is not chasing the rest. Without it that order sits open
 *  on the board forever, which is how a board stops being read. The sentence is
 *  required in that case, and the audit row keeps what was still outstanding
 *  when it was waived.
 */
export async function closePo(
  input: { po_no: string; settle_reason?: string | null },
): Promise<Result<PoDetail>> {
  const { data, error } = await db().rpc("close_po", {
    p_po_no: input.po_no, p_settle_reason: input.settle_reason ?? null, p_key: null,
  });
  return afterPo(input.po_no, fromSeam(SERVICE, data, error));
}

/** Still short of the demo's contract on purpose: the demo requires
 *  `delivery_note_attachment_id`, and `confirm_receipt` deliberately does not
 *  (`0086` — the seam's own smoke test asserts confirming is a person's act,
 *  not a document's, and reversing that is not this file's call). What
 *  changed is that the seam now has somewhere to put one *when offered*, and
 *  the redrawn `Receipt` replaces the bare seam echo. */
export async function confirmReceipt(
  input: {
    receipt_no: string;
    delivery_note_attachment_id?: string | null;
    qc_by?: string | null;
    note?: string | null;
  },
  idempotencyKey?: string,
): Promise<Result<Receipt>> {
  const { data, error } = await db().rpc("confirm_receipt", {
    p_receipt_no: input.receipt_no,
    p_qc_by: input.qc_by ?? null,
    p_note: input.note ?? null,
    p_key: idempotencyKey ?? null,
    p_delivery_note_attachment_id: input.delivery_note_attachment_id ?? null,
  });
  const res = fromSeam(SERVICE, data, error);
  if (res.error) return res;
  return getReceipt(input.receipt_no);
}

/** Arrived and reported, with no signed tanda terima yet. The morning list
 *  (D131) — with what the demo's row carries beyond the bare receipt: what it
 *  was for, and who reported it. */
export async function listReported(): Promise<Result<(Receipt & {
  description: string; po_no: string | null; vendor_name: string | null; reported_by_name: string;
})[]>> {
  const { data, error } = await db().from("receipts").select("*").eq("status", "REPORTED")
    .order("received_at", { ascending: false });
  if (error) return fail(SERVICE, error);
  const receipts = (data ?? []) as Receipt[];
  if (receipts.length === 0) return ok(SERVICE, []);

  const lineIds = [...new Set(receipts.map((r) => r.line_id).filter((id): id is string => !!id))];
  const poLineIds = [...new Set(receipts.map((r) => r.po_line_id).filter((id): id is string => !!id))];
  const userIds = [...new Set(receipts.map((r) => r.received_by))];

  const [prLines, poLines, users] = await Promise.all([
    lineIds.length
      ? db().from("pr_lines").select("id, description").in("id", lineIds)
      : Promise.resolve({ data: [] as { id: string; description: string }[], error: null }),
    poLineIds.length
      ? db().from("po_lines").select("id, description, po_id").in("id", poLineIds)
      : Promise.resolve({ data: [] as { id: string; description: string; po_id: string }[], error: null }),
    supabaseBrowser().schema("ops_core").from("users").select("id, full_name").in("id", userIds),
  ]);

  const poIds = [...new Set((poLines.data ?? []).map((l) => l.po_id))];
  const { data: pos } = poIds.length
    ? await db().from("purchase_orders").select("id, po_no, vendor_id").in("id", poIds)
    : { data: [] as { id: string; po_no: string; vendor_id: string }[] };
  const vendorIds = [...new Set((pos ?? []).map((p) => p.vendor_id))];
  const { data: vendors } = vendorIds.length
    ? await db().from("vendors").select("id, name").in("id", vendorIds)
    : { data: [] as { id: string; name: string }[] };

  const prLineById = new Map((prLines.data ?? []).map((l) => [l.id, l]));
  const poLineById = new Map((poLines.data ?? []).map((l) => [l.id, l]));
  const poById = new Map((pos ?? []).map((p) => [p.id, p]));
  const vendorById = new Map((vendors ?? []).map((v) => [v.id, v]));
  const userById = new Map((users.data ?? []).map((u) => [u.id, u as { id: string; full_name: string }]));

  const rows = receipts.map((r) => {
    const poLine = r.po_line_id ? poLineById.get(r.po_line_id) : undefined;
    const po = poLine ? poById.get(poLine.po_id) : undefined;
    const prLine = r.line_id ? prLineById.get(r.line_id) : undefined;
    return {
      ...r,
      description: poLine?.description ?? prLine?.description ?? "—",
      po_no: po?.po_no ?? null,
      vendor_name: po ? vendorById.get(po.vendor_id)?.name ?? null : null,
      reported_by_name: userById.get(r.received_by)?.full_name ?? r.received_by,
    };
  });
  return ok(SERVICE, rows);
}

export async function listVariancesRaw(lineNo: string): Promise<Result<LineVariance[]>> {
  const sb = supabaseBrowser();
  const { data: line, error: e1 } = await db()
    .from("pr_lines").select("id").eq("line_no_full", lineNo).maybeSingle();
  if (e1) return fail(SERVICE, e1);
  if (!line) return ok(SERVICE, []);
  const { data, error } = await db()
    .from("line_variances").select("*")
    .eq("line_id", (line as { id: string }).id)
    .order("recorded_at", { ascending: true });
  return fromRows<LineVariance[]>(SERVICE, data as LineVariance[], error);
}

export async function listNotes(lineNo: string): Promise<Result<LineNote[]>> {
  const { data: line, error: e1 } = await db()
    .from("pr_lines").select("id").eq("line_no_full", lineNo).maybeSingle();
  if (e1) return fail(SERVICE, e1);
  if (!line) return ok(SERVICE, []);
  const { data, error } = await db()
    .from("line_notes").select("*")
    .eq("line_id", (line as { id: string }).id)
    .order("recorded_at", { ascending: true });
  return fromRows<LineNote[]>(SERVICE, data as LineNote[], error);
}

/* ------------------------------------------------------------------ */
/* The drawers                                                         */
/* ------------------------------------------------------------------ */

/** Everything about one order, in one call.
 *
 *  `v_po_detail` assembles the lines, their receipts, the terms with their
 *  BLOCKED guard, the amendments, the payments and the close blockers into a
 *  single row. A drawer that needs three calls is a drawer that renders in
 *  three stages — and one of the three eventually fails and leaves it
 *  half-drawn.
 */
export async function getPoDetail(poNo: string): Promise<Result<PoDetail>> {
  const { data, error } = await db().from("v_po_detail").select("*").eq("po_no", poNo).maybeSingle();
  if (error) return fail(SERVICE, error);
  if (!data) return notFound(SERVICE, "po_not_found", `Order ${poNo} not found.`);
  return ok(SERVICE, data as unknown as PoDetail);
}

/** One order, as the **board** reads it — not the drawer.
 *
 *  Structurally the demo's `PoView`, declared here rather than imported from
 *  `src/demo`, for the reason `PrDocumentView` below gives: the real client
 *  does not depend on the demo, and TypeScript being structural means the swap
 *  in `src/demo/api/index.ts` checks the two against each other. If they drift,
 *  that file stops compiling.
 *
 *  `PoView` and `PoDetail` are not a naming accident — `_pending.ts` recorded
 *  them as *two different shapes with confusingly similar names*, which is true
 *  and hid what they are: a board row and a drawer. The difference is a page of
 *  data per row. See `0033`.
 */
export interface PoView extends PurchaseOrder {
  status_view: PoStatusView;
  lines: PoLine[];
  vendor_name: string;
  /** Days past the date the vendor promised, when not everything has arrived.
   *  Null without a promise: nothing is late, it is merely absent (D134). */
  days_late: number | null;
}

/** The board.
 *
 *  Reads `v_po_board`, **not** `v_po_detail`. It used to read the latter, which
 *  rendered correctly and shipped every row's receipts, payment terms,
 *  amendments and payments across the wire to be thrown away. On forty open
 *  orders that is the difference between a list and a wait.
 */
export async function listPo(): Promise<Result<PoView[]>> {
  const { data, error } = await db()
    .from("v_po_board").select("*").order("created_at", { ascending: false });
  return fromRows<PoView[]>(SERVICE, data as unknown as PoView[], error);
}

export async function getPo(poNo: string): Promise<Result<PoView>> {
  const { data, error } = await db()
    .from("v_po_board").select("*").eq("po_no", poNo).maybeSingle();
  if (error) return fail(SERVICE, error);
  if (!data) return notFound(SERVICE, "po_not_found", `PO ${poNo} not found.`);
  return ok(SERVICE, data as unknown as PoView);
}

/** A request document with its lines, as `/procurement/pr/documents` reads it.
 *
 *  Structurally the demo's `PrDocumentView`, declared here rather than imported
 *  from `src/demo` — the real client does not depend on the demo, which is the
 *  point of there being two of them. TypeScript is structural, so the swap in
 *  `src/demo/api/index.ts` checks the two against each other for us; if they
 *  ever drift, that file stops compiling, which is exactly where the drift
 *  should surface.
 */
export interface PrDocumentView extends PrDocument {
  lines: PrLineView[];
  requested_by_name: string;
  project_code: string | null;
  requested_total: number;
  approved_total: number;
}

/** Turn `v_pr_document` rows into what the screen was written against.
 *
 *  **The lines are not decoration.** `/procurement/pr/documents` filters by
 *  line status, counts them per status for its chips, searches their
 *  descriptions and renders the selected document's lines in the drawer. A
 *  document with no `lines` array is that screen with every filter empty, every
 *  count zero and a blank drawer — and it is listed as a live route, so this is
 *  what it would have done against the database.
 *
 *  Two queries rather than a nested select: `v_pr_document` and `v_pr_line` are
 *  views, and PostgREST cannot infer a relationship between two views the way it
 *  does between two tables. Stitching here is honest about that instead of
 *  depending on a join hint that would work until somebody rebuilt the view.
 */
async function withLines(rows: PrDocumentRow[]): Promise<PrDocumentView[]> {
  if (rows.length === 0) return [];

  const { data } = await db().from("v_pr_line").select("*")
    .in("doc_id", rows.map((r) => r.id))
    .is("removed_at", null);

  const byDoc = new Map<string, PrLineView[]>();
  for (const line of (data ?? []) as LineRow[]) {
    const view = toLineView(line);
    const list = byDoc.get(line.doc_id) ?? [];
    list.push(view);
    byDoc.set(line.doc_id, list);
  }

  return rows.map((r) => {
    const lines = (byDoc.get(r.id) ?? []).sort((a, b) => a.line_no - b.line_no);
    return {
      id: r.id, doc_no: r.doc_no, doc_type: r.doc_type,
      status: r.status as PrDocumentView["status"],
      requested_by: r.requested_by, project_id: r.project_id,
      created_at: r.created_at, submitted_at: r.submitted_at,
      lines,
      requested_by_name: r.requested_by_name,
      project_code: r.project_code,
      /* The view already totals these, and it is the database's arithmetic that
         wins: re-summing the lines here would be a second figure computed from a
         page of rows, which is the mistake `approved_total` exists to avoid. */
      requested_total: r.requested_total,
      approved_total: r.approved_total,
    };
  });
}

/** The other reading of a request: what arrived together, from whom, on what
 *  day. The board is line-first (D48); this is the document. */
export async function listPr(
  opts: { limit?: number; offset?: number } = {},
): Promise<Result<PrDocumentView[]>> {
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;
  const { data, error, count } = await db().from("v_pr_document").select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) return fail(SERVICE, error);

  const docs = await withLines((data ?? []) as PrDocumentRow[]);
  const total = count ?? docs.length;
  return ok(SERVICE, docs, {
    limit, cursor: offset + limit < total ? String(offset + limit) : null,
    has_more: offset + limit < total, total,
  });
}

export async function getPr(docNo: string): Promise<Result<PrDocumentView>> {
  const { data, error } = await db().from("v_pr_document").select("*").eq("doc_no", docNo).maybeSingle();
  if (error) return fail(SERVICE, error);
  if (!data) return notFound(SERVICE, "pr_not_found", `Request ${docNo} not found.`);
  const [doc] = await withLines([data as PrDocumentRow]);
  return ok(SERVICE, doc);
}

/** `v_pr_document`, as it comes back. Declared here rather than in `contracts`
 *  because the design session owns that file — the shape goes through the
 *  protocol in `docs/plan/phase-2/README.md` when the screens need it. */
export interface PrDocumentRow {
  id: string;
  doc_no: string;
  doc_type: "PR" | "FUND";
  status: string;
  requested_by: string;
  requested_by_name: string;
  project_id: string | null;
  project_code: string | null;
  project_name: string | null;
  created_at: string;
  submitted_at: string | null;
  line_count: number;
  requested_total: number;
  approved_total: number;
  paid_total: number;
  open_lines: number;
}

export async function listPendingRequests(): Promise<Result<ApprovalRequest[]>> {
  const { data, error } = await db().from("approval_requests").select("*").is("answered_at", null)
    .order("sent_at", { ascending: false });
  return fromRows<ApprovalRequest[]>(SERVICE, data as ApprovalRequest[], error);
}
