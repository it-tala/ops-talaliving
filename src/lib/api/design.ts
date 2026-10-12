/** A project's design against the database — `ops_procure` design tables
 *  (0222, P4). Same names and signatures as `src/demo/api/design.ts`.
 *
 *  Stamped `procurement`, where projects live; checked against
 *  `may_design` — whoever sells (D375) and the drafters.
 */
import type {
  DesignApproval, DesignApprovalInput, DesignAssignInput, DesignAssignment, DesignBox, DesignBoxKey, DesignBoxVersion, DesignCollection,
  DesignItemInput, DesignItemView, DesignProject, DesignRoom, ProjectDesign,
  FactoryQuote, FactoryQuoteInput, FactoryQuoteLine, FactoryQuoteResult,
} from "@/services/design/contracts";
import { supabaseBrowser } from "@/lib/supabase/client";
import { fail, fromSeam, notFound, ok, type Result } from "./_kit";

const SERVICE = "procurement" as const;

const db = () => supabaseBrowser().schema("ops_procure");

type Row = Record<string, unknown>;
const num = (v: unknown): number | null => (v == null ? null : Number(v));

function toItem(r: Row): DesignItemView {
  return {
    ...(r as unknown as DesignItemView),
    qty: Number(r.qty),
    length_mm: num(r.length_mm),
    width_mm: num(r.width_mm),
    height_mm: num(r.height_mm),
    quoted_unit_price: num(r.quoted_unit_price),
    ordered: !!r.ordered,
    factory_unit_price: num(r.factory_unit_price),
    factory_lead_time_days: num(r.factory_lead_time_days),
    factory_offers: Number(r.factory_offers ?? 0),
  };
}

/** The whole design of one project: collections, rooms and items, in three
 *  reads rather than one per collection. */
export async function getProjectDesign(projectCode: string): Promise<Result<ProjectDesign>> {
  const [c, r, i] = await Promise.all([
    db().from("v_design_collection").select("*").eq("project_code", projectCode).order("code"),
    db().from("v_design_room").select("*").eq("project_code", projectCode).order("sort"),
    db().from("v_design_item").select("*").eq("project_code", projectCode).order("item_no"),
  ]);
  if (c.error) return fail(SERVICE, c.error);
  if (r.error) return fail(SERVICE, r.error);
  if (i.error) return fail(SERVICE, i.error);
  return ok(SERVICE, {
    collections: (c.data ?? []) as DesignCollection[],
    rooms: (r.data ?? []) as DesignRoom[],
    items: ((i.data ?? []) as Row[]).map(toItem),
  });
}

export async function getDesignItem(itemNo: string): Promise<Result<DesignItemView>> {
  const { data, error } = await db().from("v_design_item").select("*").eq("item_no", itemNo).maybeSingle();
  if (error) return fail(SERVICE, error);
  if (!data) return notFound(SERVICE, "design_item_not_found", `Tidak ada item ${itemNo}.`);
  return ok(SERVICE, toItem(data as Row));
}

/** Every approval decision on an item, newest first. */
export async function listDesignApprovals(itemNo: string): Promise<Result<DesignApproval[]>> {
  const { data, error } = await db().from("v_design_approval").select("*")
    .eq("item_no", itemNo).order("recorded_at", { ascending: false });
  if (error) return fail(SERVICE, error);
  return ok(SERVICE, (data ?? []) as DesignApproval[]);
}

export async function saveDesignCollection(
  input: { project_code: string; code: string; name: string; note?: string | null },
): Promise<Result<ProjectDesign>> {
  const { data, error } = await db().rpc("save_design_collection", {
    p_project_code: input.project_code, p_code: input.code, p_name: input.name, p_note: input.note ?? null,
  });
  const res = fromSeam(SERVICE, data, error);
  if (res.error) return res;
  return getProjectDesign(input.project_code);
}

/** The collection's gallery link (a Google Photos album): set, change, or
 *  clear with a blank (0251, D407). */
export async function setDesignCollectionGallery(
  input: { project_code: string; code: string; url: string | null },
): Promise<Result<ProjectDesign>> {
  const { data, error } = await db().rpc("set_design_collection_gallery", {
    p_project_code: input.project_code, p_code: input.code, p_url: input.url ?? null,
  });
  const res = fromSeam(SERVICE, data, error);
  if (res.error) return res;
  const d = await getProjectDesign(input.project_code);
  return d.error ? d : { ...d, meta: res.meta };
}

export async function saveDesignRoom(
  input: { project_code: string; collection_code: string; code: string; name: string; sort?: number | null },
): Promise<Result<ProjectDesign>> {
  const { data, error } = await db().rpc("save_design_room", {
    p_project_code: input.project_code, p_collection_code: input.collection_code,
    p_code: input.code, p_name: input.name, p_sort: input.sort ?? null,
  });
  const res = fromSeam(SERVICE, data, error);
  if (res.error) return res;
  return getProjectDesign(input.project_code);
}

export async function saveDesignItem(input: DesignItemInput): Promise<Result<DesignItemView>> {
  const { data, error } = await db().rpc("save_design_item", {
    p_project_code: input.project_code,
    p_collection_code: input.collection_code,
    p_room_code: input.room_code ?? null,
    p_name: input.name,
    p_qty: input.qty,
    p_origin: input.origin,
    p_length_mm: input.length_mm ?? null,
    p_width_mm: input.width_mm ?? null,
    p_height_mm: input.height_mm ?? null,
    p_note: input.note ?? null,
    p_item_no: input.item_no ?? null,
    p_client_item_code: input.client_item_code ?? null,
  });
  const res = fromSeam<{ item_no: string }>(SERVICE, data, error);
  if (res.error) return res;
  return getDesignItem(res.data.item_no);
}

/** Remove an item typed by mistake — refused once anything hangs on it
 *  (0262, D419); such an item is dropped with a reason instead. */
export async function removeDesignItem(itemNo: string): Promise<Result<{ item_no: string }>> {
  const { data, error } = await db().rpc("remove_design_item", { p_item_no: itemNo });
  return fromSeam<{ item_no: string }>(SERVICE, data, error);
}

/** Take an item out of the design (with a reason), or put it back. */
export async function setDesignItemDropped(
  itemNo: string, dropped: boolean, reason?: string | null,
): Promise<Result<DesignItemView>> {
  const { data, error } = await db().rpc("set_design_item_dropped", {
    p_item_no: itemNo, p_dropped: dropped, p_reason: reason ?? null,
  });
  const res = fromSeam(SERVICE, data, error);
  if (res.error) return res;
  return getDesignItem(itemNo);
}

/** The client approved an item, or took an approval back (D378). */
export async function recordDesignApproval(input: DesignApprovalInput): Promise<Result<DesignItemView>> {
  const { data, error } = await db().rpc("record_design_approval", {
    p_item_no: input.item_no,
    p_decision: input.decision,
    p_decided_on: input.decided_on,
    p_channel: input.channel,
    p_client_person: input.client_person,
    p_attachment_id: input.attachment_id ?? null,
    p_evidence_attachment_id: input.evidence_attachment_id ?? null,
    p_note: input.note ?? null,
  });
  const res = fromSeam(SERVICE, data, error);
  if (res.error) return res;
  return getDesignItem(input.item_no);
}

/* ── Studio Desain: six boxes on every item (0248, S1, D399–D405) ─────────── */

function toBox(r: Row): DesignBox {
  return {
    ...(r as unknown as DesignBox),
    sort: Number(r.sort),
    room_sort: Number(r.room_sort ?? 0),
    versions: Number(r.versions ?? 0),
    dropped: !!r.dropped,
    bom_rev: num(r.bom_rev),
    bom_draft_rev: num(r.bom_draft_rev),
    bom_cost: num(r.bom_cost),
  };
}

/** The projects a drafter works in: live ones, and any with a design. */
export async function listDesignProjects(): Promise<Result<DesignProject[]>> {
  const { data, error } = await db().from("v_design_project").select("*")
    .order("client_display", { ascending: true, nullsFirst: false }).order("project_code");
  if (error) return fail(SERVICE, error);
  return ok(SERVICE, ((data ?? []) as Row[]).map((r) => ({
    ...(r as unknown as DesignProject),
    collection_count: Number(r.collection_count ?? 0),
    item_count: Number(r.item_count ?? 0),
  })));
}

/** Every box of a project's items, or of one item. */
export async function listDesignBoxes(
  filter: { project_code?: string; item_no?: string },
): Promise<Result<DesignBox[]>> {
  let q = db().from("v_design_box").select("*");
  if (filter.item_no) q = q.eq("item_no", filter.item_no);
  else if (filter.project_code) q = q.eq("project_code", filter.project_code);
  const { data, error } = await q.order("item_no").order("sort");
  if (error) return fail(SERVICE, error);
  return ok(SERVICE, ((data ?? []) as Row[]).map(toBox));
}

/** A box's history, oldest first: every file version, or every spec. */
export async function listDesignBoxVersions(itemNo: string): Promise<Result<DesignBoxVersion[]>> {
  const { data, error } = await db().from("v_design_box_version").select("*")
    .eq("item_no", itemNo).order("box").order("ordinal");
  if (error) return fail(SERVICE, error);
  return ok(SERVICE, ((data ?? []) as Row[]).map((r) => ({
    ...(r as unknown as DesignBoxVersion),
    ordinal: Number(r.ordinal),
    removed: !!r.removed,
  })));
}

/** The specification, as a new version. The same text again is not one. */
export async function saveDesignSpec(
  input: { item_no: string; body: string; note?: string | null },
): Promise<Result<DesignBox[]>> {
  const { data, error } = await db().rpc("save_design_spec", {
    p_item_no: input.item_no, p_body: input.body, p_note: input.note ?? null,
  });
  const res = fromSeam(SERVICE, data, error);
  if (res.error) return res;
  /* Keep the seam's own outcome: the same text again is a no-op, and the
     screen says so rather than claiming a new version. */
  const list = await listDesignBoxes({ item_no: input.item_no });
  return list.error ? list : { ...list, meta: res.meta };
}

/** A box not needed for this item, or needed again. The note is optional. */
export async function setDesignBoxSkip(
  input: { item_no: string; box: DesignBoxKey; skip: boolean; note?: string | null },
): Promise<Result<DesignBox[]>> {
  const { data, error } = await db().rpc("set_design_box_skip", {
    p_item_no: input.item_no, p_box: input.box, p_skip: input.skip, p_note: input.note ?? null,
  });
  const res = fromSeam(SERVICE, data, error);
  if (res.error) return res;
  /* Keep the seam's own outcome: the same text again is a no-op, and the
     screen says so rather than claiming a new version. */
  const list = await listDesignBoxes({ item_no: input.item_no });
  return list.error ? list : { ...list, meta: res.meta };
}

/** A product (and so a BOM) for an item before it is ordered, so a quotation
 *  can be priced from it (D400). Inactive until an order line names it. */
export async function productFromDesignItem(
  input: { item_no: string; product_code?: string | null; category?: string | null },
): Promise<Result<{ product_code: string; existing: boolean }>> {
  const { data, error } = await db().rpc("product_from_design_item", {
    p_item_no: input.item_no, p_product_code: input.product_code ?? null, p_category: input.category ?? null,
  });
  return fromSeam<{ product_code: string; existing: boolean }>(SERVICE, data, error);
}

/* ── Studio Desain S2: a room or an item given out as an HRD task (0250) ─── */

/** The tasks given out from Design, for a project or for all. */
export async function listDesignAssignments(projectCode?: string | null): Promise<Result<DesignAssignment[]>> {
  const { data, error } = await db().rpc("design_assignments", { p_project_code: projectCode ?? null });
  if (error) return fail(SERVICE, error);
  return ok(SERVICE, ((data ?? []) as Row[]).map((r) => ({
    ...(r as unknown as DesignAssignment),
    filled: Number(r.filled ?? 0),
    total: Number(r.total ?? 0),
  })));
}

/** Give a room or an item to a drafter as an HRD task, or move the open one
 *  to another person or date. Answers the project's tasks. */
export async function assignDesignTask(input: DesignAssignInput): Promise<Result<DesignAssignment[]>> {
  const { data, error } = await db().rpc("assign_design_task", {
    p_scope: input.scope, p_ref: input.ref_no, p_assignee_no: input.assignee_no,
    p_due: input.due_date, p_note: input.note ?? null,
  });
  const res = fromSeam(SERVICE, data, error);
  if (res.error) return res;
  const list = await listDesignAssignments(input.ref_no.split("-")[0]);
  return list.error ? list : { ...list, meta: res.meta };
}

/* ── Factory prices (0256, O2, kajian F255 §5.3) ─────────────────────────── */

function toFactoryQuote(r: Row): FactoryQuote {
  return {
    ...(r as unknown as FactoryQuote),
    line_count: Number(r.line_count ?? 0),
    chosen_count: Number(r.chosen_count ?? 0),
    expired: !!r.expired,
  };
}

function toFactoryLine(r: Row): FactoryQuoteLine {
  return {
    ...(r as unknown as FactoryQuoteLine),
    item_qty: Number(r.item_qty),
    unit_price: Number(r.unit_price),
    lead_time_days: num(r.lead_time_days),
    moq: num(r.moq),
    is_chosen: !!r.is_chosen,
    is_latest: !!r.is_latest,
    expired: !!r.expired,
  };
}

/** The offers, newest first — for a project, or all of them. */
export async function listFactoryQuotes(filter: { project_code?: string } = {}): Promise<Result<FactoryQuote[]>> {
  let q = db().from("v_factory_quote").select("*")
    .order("quoted_on", { ascending: false }).order("recorded_at", { ascending: false });
  if (filter.project_code) q = q.eq("project_code", filter.project_code);
  const { data, error } = await q;
  if (error) return fail(SERVICE, error);
  return ok(SERVICE, ((data ?? []) as Row[]).map(toFactoryQuote));
}

/** The prices — of one offer, one item, or one project — newest first. */
export async function listFactoryQuoteLines(
  filter: { fq_no?: string; item_no?: string; project_code?: string } = {},
): Promise<Result<FactoryQuoteLine[]>> {
  let q = db().from("v_factory_quote_line").select("*")
    .order("quoted_on", { ascending: false }).order("recorded_at", { ascending: false }).order("item_no");
  if (filter.fq_no) q = q.eq("fq_no", filter.fq_no);
  if (filter.item_no) q = q.eq("item_no", filter.item_no);
  if (filter.project_code) q = q.eq("project_code", filter.project_code);
  const { data, error } = await q;
  if (error) return fail(SERVICE, error);
  return ok(SERVICE, ((data ?? []) as Row[]).map(toFactoryLine));
}

/** One factory's offer, with a price for one or more of a project's items. */
export async function recordFactoryQuote(
  input: FactoryQuoteInput, idempotencyKey?: string,
): Promise<Result<FactoryQuoteResult>> {
  const { data, error } = await db().rpc("record_factory_quote", {
    p_project_code: input.project_code,
    p_vendor_code: input.vendor_code,
    p_currency: input.currency,
    p_lines: input.lines.map((l) => ({
      item_no: l.item_no, unit_price: l.unit_price,
      lead_time_days: l.lead_time_days ?? null, moq: l.moq ?? null, note: l.note ?? null,
    })),
    p_quoted_on: input.quoted_on ?? null,
    p_valid_until: input.valid_until ?? null,
    p_note: input.note ?? null,
    p_attachment_id: input.attachment_id ?? null,
    p_key: idempotencyKey ?? null,
  });
  const res = fromSeam<FactoryQuoteResult>(SERVICE, data, error);
  if (res.error) return res;
  return ok(SERVICE, {
    fq_no: res.data.fq_no, lines: Number(res.data.lines), chosen: Number(res.data.chosen),
    vendor_marked_factory: !!res.data.vendor_marked_factory,
  });
}

/** Which offer an item is priced from; null for none. */
export async function chooseFactoryLine(itemNo: string, lineId: string | null): Promise<Result<DesignItemView>> {
  const { data, error } = await db().rpc("choose_factory_line", { p_item_no: itemNo, p_line_id: lineId });
  const res = fromSeam(SERVICE, data, error);
  if (res.error) return res;
  const item = await getDesignItem(itemNo);
  return item.error ? item : { ...item, meta: res.meta };
}

/** A wrong offer, voided with a reason; what was recorded stays readable. */
export async function voidFactoryQuote(fqNo: string, reason: string): Promise<Result<FactoryQuote>> {
  const { data, error } = await db().rpc("void_factory_quote", { p_fq_no: fqNo, p_reason: reason });
  const res = fromSeam(SERVICE, data, error);
  if (res.error) return res;
  const row = await db().from("v_factory_quote").select("*").eq("fq_no", fqNo).maybeSingle();
  if (row.error) return fail(SERVICE, row.error);
  if (!row.data) return notFound(SERVICE, "factory_quote_not_found", `Tidak ada penawaran ${fqNo}.`);
  return ok(SERVICE, toFactoryQuote(row.data as Row));
}
