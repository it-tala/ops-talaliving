/** The quotation against the database — `ops_procure` quotations (0133).
 *
 *  Reads are `v_quotation` and `v_quotation_line`, which already hold the
 *  price arithmetic (`ops_procure.quote_price`) and the cost masking for a
 *  reader; numerics are converted by hand. Writes are seams, and each re-reads
 *  what was stored so a screen redraws from the database's answer.
 */
import type {
  QuotationDetail, QuotationInput, QuotationLineInput, QuotationLineView, QuotationRevision,
  QuotationView,
} from "@/services/quotation/contracts";
import { supabaseBrowser } from "@/lib/supabase/client";
import { fail, fromSeam, notFound, ok, type Result } from "./_kit";

const SERVICE = "procurement" as const;

const db = () => supabaseBrowser().schema("ops_procure");

type Row = Record<string, unknown>;
const n = (v: unknown): number => (v == null ? 0 : Number(v));
const nn = (v: unknown): number | null => (v == null ? null : Number(v));
const s = (v: unknown): string | null => (v == null ? null : String(v));

function toView(r: Row): QuotationView {
  return {
    id: r.id as string,
    quote_no: r.quote_no as string,
    project_id: r.project_id as string,
    rev: n(r.rev),
    supersedes_id: s(r.supersedes_id),
    status: r.status as QuotationView["status"],
    valid_until: s(r.valid_until),
    marketing_pct: n(r.marketing_pct),
    overhead_pct: n(r.overhead_pct),
    margin_pct: n(r.margin_pct),
    vat: !!r.vat,
    vat_pct: n(r.vat_pct),
    terms: s(r.terms),
    note: s(r.note),
    sent_at: s(r.sent_at),
    decided_at: s(r.decided_at),
    decision_reason: s(r.decision_reason),
    created_at: r.created_at as string,
    project_code: r.project_code as string,
    project_name: r.project_name as string,
    client_name: s(r.client_name),
    client_code: s(r.client_code),
    client_contact: s(r.client_contact),
    client_address: s(r.client_address),
    location: s(r.location),
    line_count: n(r.line_count),
    lines_without_cost: n(r.lines_without_cost),
    subtotal: nn(r.subtotal),
    vat_amount: nn(r.vat_amount),
    grand_total: nn(r.grand_total),
    cost_total: nn(r.cost_total),
    max_lead_time_days: nn(r.max_lead_time_days),
    expired: !!r.expired,
    is_current: !!r.is_current,
  };
}

function toLine(r: Row): QuotationLineView {
  return {
    id: r.id as string,
    quotation_id: r.quotation_id as string,
    quote_no: r.quote_no as string,
    status: r.status as QuotationLineView["status"],
    line_no: n(r.line_no),
    product_code: s(r.product_code),
    description: r.description as string,
    qty: n(r.qty),
    uom: r.uom as string,
    lead_time_days: nn(r.lead_time_days),
    product_exists: !!r.product_exists,
    note: s(r.note),
    cost_is_manual: !!r.cost_is_manual,
    cost_missing: !!r.cost_missing,
    cost_visible: !!r.cost_visible,
    unit_cost: nn(r.unit_cost),
    cost_source: (r.cost_source as QuotationLineView["cost_source"]) ?? null,
    bom_rev: nn(r.bom_rev),
    marketing_pct: nn(r.marketing_pct),
    overhead_pct: nn(r.overhead_pct),
    margin_pct: nn(r.margin_pct),
    pct_overridden: !!r.pct_overridden,
    computed_unit_price: nn(r.computed_unit_price),
    unit_price_override: nn(r.unit_price_override),
    unit_price: nn(r.unit_price),
    line_lead_time_days: nn(r.line_lead_time_days),
    manual_unit_cost: nn(r.manual_unit_cost),
    line_marketing_pct: nn(r.line_marketing_pct),
    line_overhead_pct: nn(r.line_overhead_pct),
    line_margin_pct: nn(r.line_margin_pct),
  };
}

async function one(quoteNo: string): Promise<Result<QuotationView>> {
  const { data, error } = await db().from("v_quotation").select("*").eq("quote_no", quoteNo).maybeSingle();
  if (error) return fail(SERVICE, error);
  if (!data) return notFound(SERVICE, "quotation_not_found", `Tidak ada quotation ${quoteNo}.`);
  return ok(SERVICE, toView(data as Row));
}

/* ── Reading ──────────────────────────────────────────────────────────── */

export async function listQuotations(
  filter: { project_code?: string } = {},
): Promise<Result<QuotationView[]>> {
  let q = db().from("v_quotation").select("*").order("created_at", { ascending: false });
  if (filter.project_code) q = q.eq("project_code", filter.project_code);
  const { data, error } = await q;
  if (error) return fail(SERVICE, error);
  return ok(SERVICE, ((data ?? []) as Row[]).map(toView));
}

export async function getQuotation(quoteNo: string): Promise<Result<QuotationDetail>> {
  const head = await one(quoteNo);
  if (head.error) return head;
  const [lines, revs] = await Promise.all([
    db().from("v_quotation_line").select("*").eq("quote_no", quoteNo).order("line_no"),
    db().from("v_quotation").select("quote_no, rev, status, sent_at, grand_total")
      .eq("project_id", head.data.project_id).order("rev", { ascending: false }),
  ]);
  if (lines.error) return fail(SERVICE, lines.error);
  if (revs.error) return fail(SERVICE, revs.error);
  return ok(SERVICE, {
    quotation: head.data,
    lines: ((lines.data ?? []) as Row[]).map(toLine),
    revisions: ((revs.data ?? []) as Row[]).map((r): QuotationRevision => ({
      quote_no: r.quote_no as string, rev: n(r.rev), status: r.status as QuotationRevision["status"],
      sent_at: s(r.sent_at), grand_total: nn(r.grand_total),
    })),
  });
}

/* ── Writing ──────────────────────────────────────────────────────────── */

export async function saveQuotation(input: QuotationInput, idempotencyKey?: string): Promise<Result<QuotationView>> {
  const { data, error } = await db().rpc("save_quotation", {
    p_quote_no: input.quote_no ?? null,
    p_project_code: input.project_code ?? null,
    p_valid_until: input.valid_until ?? null,
    p_marketing_pct: input.marketing_pct,
    p_overhead_pct: input.overhead_pct,
    p_margin_pct: input.margin_pct,
    p_vat: input.vat,
    p_vat_pct: input.vat_pct ?? 11,
    p_terms: input.terms ?? null,
    p_note: input.note ?? null,
    p_key: idempotencyKey ?? null,
  });
  const res = fromSeam<{ quote_no: string }>(SERVICE, data, error);
  if (res.error) return res;
  return one(res.data.quote_no);
}

export async function saveQuotationLine(quoteNo: string, input: QuotationLineInput): Promise<Result<QuotationLineView>> {
  const { data, error } = await db().rpc("save_quotation_line", {
    p_quote_no: quoteNo,
    p_line_id: input.id ?? null,
    p_product_code: input.product_code ?? null,
    p_description: input.description ?? null,
    p_qty: input.qty,
    p_uom: input.uom,
    p_lead_time_days: input.lead_time_days ?? null,
    p_manual_unit_cost: input.manual_unit_cost ?? null,
    p_marketing_pct: input.marketing_pct ?? null,
    p_overhead_pct: input.overhead_pct ?? null,
    p_margin_pct: input.margin_pct ?? null,
    p_unit_price_override: input.unit_price_override ?? null,
    p_note: input.note ?? null,
  });
  const res = fromSeam<{ line_id: string }>(SERVICE, data, error);
  if (res.error) return res;
  const line = await db().from("v_quotation_line").select("*").eq("id", res.data.line_id).maybeSingle();
  if (line.error) return fail(SERVICE, line.error);
  if (!line.data) return notFound(SERVICE, "line_not_found", "Baris itu tidak ada.");
  return ok(SERVICE, toLine(line.data as Row));
}

export async function removeQuotationLine(quoteNo: string, lineId: string): Promise<Result<{ quote_no: string }>> {
  const { data, error } = await db().rpc("remove_quotation_line", { p_quote_no: quoteNo, p_line_id: lineId });
  return fromSeam<{ quote_no: string }>(SERVICE, data, error);
}

export async function sendQuotation(quoteNo: string): Promise<Result<QuotationView>> {
  const { data, error } = await db().rpc("send_quotation", { p_quote_no: quoteNo });
  const res = fromSeam<{ quote_no: string }>(SERVICE, data, error);
  if (res.error) return res;
  return one(quoteNo);
}

export async function reviseQuotation(quoteNo: string): Promise<Result<QuotationView>> {
  const { data, error } = await db().rpc("revise_quotation", { p_quote_no: quoteNo });
  const res = fromSeam<{ quote_no: string }>(SERVICE, data, error);
  if (res.error) return res;
  return one(res.data.quote_no);
}

export async function decideQuotation(
  quoteNo: string, accepted: boolean, reason?: string | null,
): Promise<Result<{ quotation: QuotationView; order_lines_added: number }>> {
  const { data, error } = await db().rpc("decide_quotation", {
    p_quote_no: quoteNo, p_accepted: accepted, p_reason: reason ?? null,
  });
  const res = fromSeam<{ order_lines_added: number }>(SERVICE, data, error);
  if (res.error) return res;
  const head = await one(quoteNo);
  if (head.error) return head;
  return ok(SERVICE, { quotation: head.data, order_lines_added: n(res.data.order_lines_added) });
}
