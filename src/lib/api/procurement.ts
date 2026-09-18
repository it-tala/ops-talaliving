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
  Vendor, VendorView, Item, ItemView, Uom, ItemCategory, Project,
  PrLineView, PrApproval, LineNote, LineVariance, ApprovalRequest,
  VendorJourney, RoundSummary, VarianceReason, Channel,
  PoDetail, UomCode, PrCategory, PrDocument,
} from "@/services/procurement/contracts";
import { supabaseBrowser } from "@/lib/supabase/client";
import { fail, fromSeam, fromRows, fromPage, notFound, ok, type Result } from "./_kit";

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

export async function listAllLines(): Promise<Result<PrLineView[]>> {
  const { data, error } = await db().from("v_pr_line").select("*")
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
  const sb = supabaseBrowser();
  const { data: line, error: e1 } = await sb
    .from("pr_lines").select("id").eq("line_no_full", lineNo).maybeSingle();
  if (e1) return fail(SERVICE, e1);
  if (!line) return ok(SERVICE, []);

  const { data, error } = await sb
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
export async function requestApproval(
  input: { line_nos: string[]; to_email?: string | null; notes?: Record<string, string | null> },
  idempotencyKey?: string,
): Promise<Result<{ batch_no: string; token: string; sent_to: string; lines: string[] }>> {
  const { data, error } = await db().rpc("request_approval", {
    p_line_nos: input.line_nos,
    p_to_email: input.to_email ?? null,
    p_notes: input.notes ?? {},
    p_key: idempotencyKey ?? null,
  });
  return fromSeam(SERVICE, data, error);
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

export async function createItem(
  input: { name: string; category_code?: string; base_uom?: string; kind?: "goods" | "service" },
  idempotencyKey?: string,
): Promise<Result<{ code: string; name: string; is_curated: boolean }>> {
  const { data, error } = await db().rpc("create_item", {
    p_name: input.name,
    p_category_code: input.category_code ?? "uncurated",
    p_base_uom: input.base_uom ?? "pcs",
    p_kind: input.kind ?? "goods",
    p_key: idempotencyKey ?? null,
  });
  return fromSeam(SERVICE, data, error);
}

export async function curateItem(code: string, curated: boolean): Promise<Result<unknown>> {
  const { data, error } = await db().rpc("curate_item", {
    p_code: code, p_curated: curated,
  });
  return fromSeam(SERVICE, data, error);
}

export async function updateVendorContact(
  code: string,
  input: {
    pic_name?: string | null; pic_phone?: string | null;
    phone?: string | null; address?: string | null;
    bank_account?: string | null; bank_account_secondary?: string | null;
    npwp?: string | null;
  },
): Promise<Result<unknown>> {
  const { data, error } = await db().rpc("update_vendor_contact", {
    p_code: code,
    p_pic_name: input.pic_name ?? null,
    p_pic_phone: input.pic_phone ?? null,
    p_phone: input.phone ?? null,
    p_address: input.address ?? null,
    p_bank_account: input.bank_account ?? null,
    p_bank_account_secondary: input.bank_account_secondary ?? null,
    p_npwp: input.npwp ?? null,
  });
  return fromSeam(SERVICE, data, error);
}

/** Always a DRAFT. An order is a promise made to a supplier in the company's
 *  name, so leadership confirms it before it is sent — which means creating one
 *  cannot also send it (D132). */
export async function createPo(
  input: {
    vendor_code: string;
    lines: { description: string; qty: number; uom: string; unit_price: number }[];
    dp_percent?: number | null;
    note?: string | null;
    expected_delivery?: string | null;
  },
  idempotencyKey?: string,
): Promise<Result<{ po_no: string; status: string; lines: number }>> {
  const { data, error } = await db().rpc("create_po", {
    p_vendor_code: input.vendor_code,
    p_lines: input.lines,
    p_dp_percent: input.dp_percent ?? null,
    p_note: input.note ?? null,
    p_expected_delivery: input.expected_delivery ?? null,
    p_key: idempotencyKey ?? null,
  });
  return fromSeam(SERVICE, data, error);
}

export async function requestPoApproval(poNo: string): Promise<Result<unknown>> {
  const { data, error } = await db().rpc("request_po_approval", { p_po_no: poNo });
  return fromSeam(SERVICE, data, error);
}

export async function setExpectedDelivery(poNo: string, date: string): Promise<Result<unknown>> {
  const { data, error } = await db().rpc("set_expected_delivery", {
    p_po_no: poNo, p_date: date,
  });
  return fromSeam(SERVICE, data, error);
}

export async function markPoResent(poNo: string): Promise<Result<unknown>> {
  const { data, error } = await db().rpc("mark_po_resent", { p_po_no: poNo });
  return fromSeam(SERVICE, data, error);
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
    condition: string;
    documents: { attachment_id: string; kind: string }[];
    qc_by?: string | null;
    note?: string | null;
  },
  idempotencyKey?: string,
): Promise<Result<{ receipt_no: string; status: string; notified: boolean }>> {
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
  return fromSeam(SERVICE, data, error);
}

/** Roll everything still owed into the open round, opening one if there is
 *  none. Nothing to roll is a `noop` — a successful nothing-happened, which is
 *  a better answer than a 200 that looks like work. */
export async function syncRound(): Promise<Result<{ round_no: string; added: number }>> {
  const { data, error } = await db().rpc("sync_round");
  return fromSeam(SERVICE, data, error);
}

/** Closing does not refuse over a line still owed: that line comes back in the
 *  next round through `syncRound`, which is how it stays somebody's problem
 *  without anybody carrying it forward by hand. The count comes back so the
 *  screen can say so. */
export async function closeRound(
  roundNo: string, idempotencyKey?: string,
): Promise<Result<{ round_no: string; status: string; still_owed: number }>> {
  const { data, error } = await db().rpc("close_round", {
    p_round_no: roundNo, p_key: idempotencyKey ?? null,
  });
  return fromSeam(SERVICE, data, error);
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
 *  prevent. */
export async function answerFromChat(
  input: { token: string; approved: boolean; answered_by_email: string; instructions?: string | null },
  idempotencyKey?: string,
): Promise<Result<{ line_no: string; approved: boolean; by: string; channel: string }>> {
  const { data, error } = await db().rpc("answer_request", {
    p_token: input.token,
    p_approved: input.approved,
    p_answered_by_email: input.answered_by_email,
    p_instructions: input.instructions ?? null,
    p_key: idempotencyKey ?? null,
  });
  return fromSeam(SERVICE, data, error);
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
  let q = db().from("vendors").select("*").is("merged_into", null);
  if (opts.curated !== undefined) q = q.eq("is_curated", opts.curated);
  if (opts.q) q = q.ilike("name", `%${opts.q}%`);
  const { data, error } = await q.order("name");
  return fromRows<Vendor[]>(SERVICE, data as Vendor[], error);
}

export async function listVendorViews(opts: { q?: string } = {}): Promise<Result<VendorView[]>> {
  let q = db().from("v_vendor_view").select("*").is("merged_into", null);
  if (opts.q) q = q.ilike("name", `%${opts.q}%`);
  const { data, error } = await q.order("name");
  return fromRows<VendorView[]>(SERVICE, data as VendorView[], error);
}

export async function listItems(
  opts: { q?: string; curated?: boolean } = {},
): Promise<Result<Item[]>> {
  let q = db().from("items").select("*").is("merged_into", null);
  if (opts.curated !== undefined) q = q.eq("is_curated", opts.curated);
  if (opts.q) q = q.ilike("name", `%${opts.q}%`);
  const { data, error } = await q.order("name");
  return fromRows<Item[]>(SERVICE, data as Item[], error);
}

export async function listItemViews(opts: { q?: string } = {}): Promise<Result<ItemView[]>> {
  let q = db().from("v_item_view").select("*").is("merged_into", null);
  if (opts.q) q = q.ilike("name", `%${opts.q}%`);
  const { data, error } = await q.order("name");
  return fromRows<ItemView[]>(SERVICE, data as ItemView[], error);
}

export async function listUom(): Promise<Result<Uom[]>> {
  const { data, error } = await db().from("uom").select("*").order("code");
  return fromRows<Uom[]>(SERVICE, data as Uom[], error);
}

export async function listCategories(): Promise<Result<ItemCategory[]>> {
  const { data, error } = await db().from("item_categories").select("*").order("name");
  return fromRows<ItemCategory[]>(SERVICE, data as ItemCategory[], error);
}

export async function listProjects(): Promise<Result<Project[]>> {
  const { data, error } = await db().from("projects").select("*").order("code");
  return fromRows<Project[]>(SERVICE, data as Project[], error);
}

export async function curateVendor(code: string, curated: boolean): Promise<Result<unknown>> {
  const { data, error } = await db().rpc("curate_vendor", {
    p_code: code, p_curated: curated,
  });
  return fromSeam(SERVICE, data, error);
}

/** A pointer, never a delete (D33). Takes **codes**, not uuids, because that is
 *  what crosses every seam in this system and what a person can read back. */
export async function mergeVendor(loserCode: string, winnerCode: string): Promise<Result<unknown>> {
  const { data, error } = await db().rpc("merge_vendor", {
    p_loser_code: loserCode, p_winner_code: winnerCode,
  });
  return fromSeam(SERVICE, data, error);
}

/* ------------------------------------------------------------------ */
/* Rounds, orders, receiving                                           */
/* ------------------------------------------------------------------ */

export async function listRounds(): Promise<Result<RoundSummary[]>> {
  const { data, error } = await db().from("v_round_summary").select("*").order("opened_at", { ascending: false });
  return fromRows<RoundSummary[]>(SERVICE, data as RoundSummary[], error);
}

export async function getRound(roundNo: string): Promise<Result<RoundSummary>> {
  const { data, error } = await db().from("v_round_summary").select("*").eq("round_no", roundNo).single();
  return fromRows<RoundSummary>(SERVICE, data as RoundSummary, error);
}

export async function approveRound(roundNo: string, idempotencyKey?: string): Promise<Result<unknown>> {
  const { data, error } = await db().rpc("approve_round", {
    p_round_no: roundNo, p_key: idempotencyKey ?? null,
  });
  return fromSeam(SERVICE, data, error);
}

/** Recording an instalment. It moves the round to TRANSFERRED and **makes not
 *  one line PAID** — that is D6, and it is the database's business, not this
 *  file's. */
export async function transferRound(
  input: { round_no: string; amount: number; trx_no: string; proof_attachment_id: string },
  idempotencyKey?: string,
): Promise<Result<unknown>> {
  const { data, error } = await db().rpc("transfer_round", {
    p_round_no: input.round_no,
    p_amount: input.amount,
    p_trx_no: input.trx_no,
    p_proof: input.proof_attachment_id,
    p_key: idempotencyKey ?? null,
  });
  return fromSeam(SERVICE, data, error);
}

export async function listVendorJourneys(): Promise<Result<VendorJourney[]>> {
  const { data, error } = await db().from("v_vendor_journey").select("*").gt("orders", 0).order("vendor_name");
  return fromRows<VendorJourney[]>(SERVICE, data as VendorJourney[], error);
}

export async function getVendorJourney(vendorId: string): Promise<Result<VendorJourney>> {
  const { data, error } = await db().from("v_vendor_journey").select("*").eq("vendor_id", vendorId).single();
  return fromRows<VendorJourney>(SERVICE, data as VendorJourney, error);
}

export async function approvePo(
  poNo: string, note?: string | null, idempotencyKey?: string,
): Promise<Result<unknown>> {
  const { data, error } = await db().rpc("approve_po", {
    p_po_no: poNo, p_note: note ?? null, p_key: idempotencyKey ?? null,
  });
  return fromSeam(SERVICE, data, error);
}

export async function issuePo(poNo: string, idempotencyKey?: string): Promise<Result<unknown>> {
  const { data, error } = await db().rpc("issue_po", {
    p_po_no: poNo, p_key: idempotencyKey ?? null,
  });
  return fromSeam(SERVICE, data, error);
}

export async function amendPoLine(
  input: { po_no: string; line_no: number; qty: number; unit_price: number; description?: string | null },
  idempotencyKey?: string,
): Promise<Result<unknown>> {
  const { data, error } = await db().rpc("amend_po_line", {
    p_po_no: input.po_no, p_line_no: input.line_no,
    p_qty: input.qty, p_unit_price: input.unit_price,
    p_description: input.description ?? null,
    p_key: idempotencyKey ?? null,
  });
  return fromSeam(SERVICE, data, error);
}

/** Refuses while anything is outstanding, and the refusal's `detail.blockers`
 *  says which — a refusal that only says no leaves somebody clicking it again
 *  next week (D132). */
export async function closePo(poNo: string, idempotencyKey?: string): Promise<Result<unknown>> {
  const { data, error } = await db().rpc("close_po", {
    p_po_no: poNo, p_key: idempotencyKey ?? null,
  });
  return fromSeam(SERVICE, data, error);
}

export async function confirmReceipt(
  input: { receipt_no: string; qc_by?: string | null; note?: string | null },
  idempotencyKey?: string,
): Promise<Result<unknown>> {
  const { data, error } = await db().rpc("confirm_receipt", {
    p_receipt_no: input.receipt_no,
    p_qc_by: input.qc_by ?? null,
    p_note: input.note ?? null,
    p_key: idempotencyKey ?? null,
  });
  return fromSeam(SERVICE, data, error);
}

/** Arrived and reported, with no signed tanda terima yet. The morning list
 *  (D131). */
export async function listReported(): Promise<Result<unknown[]>> {
  const { data, error } = await db().from("receipts").select("*").eq("status", "REPORTED")
    .order("received_at", { ascending: false });
  return fromRows<unknown[]>(SERVICE, data as unknown[], error);
}

export async function listVariancesRaw(lineNo: string): Promise<Result<LineVariance[]>> {
  const sb = supabaseBrowser();
  const { data: line, error: e1 } = await sb
    .from("pr_lines").select("id").eq("line_no_full", lineNo).maybeSingle();
  if (e1) return fail(SERVICE, e1);
  if (!line) return ok(SERVICE, []);
  const { data, error } = await sb
    .from("line_variances").select("*")
    .eq("line_id", (line as { id: string }).id)
    .order("recorded_at", { ascending: true });
  return fromRows<LineVariance[]>(SERVICE, data as LineVariance[], error);
}

export async function listNotes(lineNo: string): Promise<Result<LineNote[]>> {
  const sb = supabaseBrowser();
  const { data: line, error: e1 } = await sb
    .from("pr_lines").select("id").eq("line_no_full", lineNo).maybeSingle();
  if (e1) return fail(SERVICE, e1);
  if (!line) return ok(SERVICE, []);
  const { data, error } = await sb
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

export async function listPo(): Promise<Result<PoDetail[]>> {
  const { data, error } = await db().from("v_po_detail").select("*").order("created_at", { ascending: false });
  return fromRows<PoDetail[]>(SERVICE, data as unknown as PoDetail[], error);
}

export async function getPo(poNo: string): Promise<Result<PoDetail>> {
  return getPoDetail(poNo);
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
