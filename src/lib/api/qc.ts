/** Field QC against the real database — schema `ops_qc` (0261, O6, D418).
 *
 *  Reads are the two views, which run as the reader: a QC gets their own
 *  assignments back and nothing else, leadership and procurement get all of
 *  them. The lines of an assignment come from `assignment_lines`, a definer
 *  function, because a QC does not read purchase orders and the answer must
 *  carry the drawing but never the price.
 */
import type {
  QcAssignableOrder, QcAssignment, QcAssignmentInput, QcAssignmentLine, QcAssignResult, QcPerson, QcPersonInput,
} from "@/services/qc/contracts";
import { supabaseBrowser } from "@/lib/supabase/client";
import { fail, fromSeam, notFound, ok, type Result } from "./_kit";

const SERVICE = "production" as const;
const db = () => supabaseBrowser().schema("ops_qc");

type Row = Record<string, unknown>;
const n = (v: unknown) => (v == null ? 0 : Number(v));
const s = (v: unknown) => (v == null ? null : String(v));

function toPerson(r: Row): QcPerson {
  return {
    id: String(r.id), code: String(r.code), name: String(r.name),
    phone: s(r.phone), city: s(r.city), is_active: !!r.is_active,
    inactive_reason: s(r.inactive_reason), note: s(r.note),
    account_email: s(r.account_email),
    account_qc_level: (s(r.account_qc_level) as QcPerson["account_qc_level"]) ?? null,
    active_assignments: n(r.active_assignments), total_assignments: n(r.total_assignments),
  };
}

function toAssignment(r: Row): QcAssignment {
  return {
    id: String(r.id), assign_no: String(r.assign_no), starts_on: String(r.starts_on),
    ends_on: s(r.ends_on), note: s(r.note), created_at: String(r.created_at),
    cancelled_at: s(r.cancelled_at), cancel_reason: s(r.cancel_reason),
    person_code: String(r.person_code), person_name: String(r.person_name),
    person_phone: s(r.person_phone), person_city: s(r.person_city), is_mine: !!r.is_mine,
    po_no: s(r.po_no), po_status: (s(r.po_status) as QcAssignment["po_status"]) ?? null,
    vendor_name: s(r.vendor_name), vendor_address: s(r.vendor_address),
    project_code: s(r.project_code), project_name: s(r.project_name), client_name: s(r.client_name),
    expected_delivery: s(r.expected_delivery), issued_at: s(r.issued_at),
    line_count: n(r.line_count), container_count: n(r.container_count),
    state: String(r.state) as QcAssignment["state"],
  };
}

/** The team, as the reader may see it — a QC sees only themselves. */
export async function listQcPeople(opts: { include_inactive?: boolean } = {}): Promise<Result<QcPerson[]>> {
  let q = db().from("v_qc_person").select("*");
  if (!opts.include_inactive) q = q.eq("is_active", true);
  const { data, error } = await q.order("name");
  if (error) return fail(SERVICE, error);
  return ok(SERVICE, ((data ?? []) as Row[]).map(toPerson));
}

export async function saveQcPerson(input: QcPersonInput): Promise<Result<QcPerson & { granted_qc_write: boolean }>> {
  const { data, error } = await db().rpc("save_qc_person", {
    p_code: input.code ?? null, p_name: input.name, p_phone: input.phone ?? null, p_city: input.city ?? null,
    p_note: input.note ?? null, p_user_email: input.user_email ?? null,
  });
  const res = fromSeam<{ code: string; granted_qc_write: boolean }>(SERVICE, data, error);
  if (res.error) return res;
  const one = await db().from("v_qc_person").select("*").eq("code", res.data.code).maybeSingle();
  if (one.error) return fail(SERVICE, one.error);
  if (!one.data) return notFound(SERVICE, "qc_person_not_found", `Tidak ada QC ${res.data.code}.`);
  return ok(SERVICE, { ...toPerson(one.data as Row), granted_qc_write: !!res.data.granted_qc_write });
}

export async function setQcPersonActive(
  input: { code: string; active: boolean; reason?: string | null },
): Promise<Result<{ code: string; is_active: boolean; warnings: string[] }>> {
  const { data, error } = await db().rpc("set_qc_person_active", {
    p_code: input.code, p_active: input.active, p_reason: input.reason ?? null,
  });
  const res = fromSeam<{ code: string; is_active: boolean; warnings?: string[] }>(SERVICE, data, error);
  if (res.error) return res;
  return ok(SERVICE, { code: res.data.code ?? input.code, is_active: res.data.is_active ?? input.active, warnings: res.data.warnings ?? [] });
}

/** Every assignment the reader may see — a QC's own, or all of them. */
export async function listQcAssignments(
  opts: { person_code?: string; po_no?: string; project_code?: string; include_cancelled?: boolean } = {},
): Promise<Result<QcAssignment[]>> {
  let q = db().from("v_qc_assignment").select("*");
  if (opts.person_code) q = q.eq("person_code", opts.person_code);
  if (opts.po_no) q = q.eq("po_no", opts.po_no);
  if (opts.project_code) q = q.eq("project_code", opts.project_code);
  if (!opts.include_cancelled) q = q.is("cancelled_at", null);
  const { data, error } = await q.order("starts_on", { ascending: false });
  if (error) return fail(SERVICE, error);
  return ok(SERVICE, ((data ?? []) as Row[]).map(toAssignment));
}

export async function assignQc(input: QcAssignmentInput, idempotencyKey?: string): Promise<Result<QcAssignResult>> {
  const { data, error } = await db().rpc("assign_qc", {
    p_person_code: input.person_code, p_po_no: input.po_no, p_starts_on: input.starts_on || null,
    p_ends_on: input.ends_on || null, p_note: input.note ?? null, p_key: idempotencyKey ?? null,
  });
  const res = fromSeam<QcAssignResult>(SERVICE, data, error);
  if (res.error) return res;
  return ok(SERVICE, {
    assign_no: res.data.assign_no, account_linked: !!res.data.account_linked,
    others_on_order: res.data.others_on_order ?? null,
  });
}

export async function endQcAssignment(input: { assign_no: string; ends_on: string | null }): Promise<Result<{ assign_no: string }>> {
  const { data, error } = await db().rpc("end_qc_assignment", { p_assign_no: input.assign_no, p_ends_on: input.ends_on || null });
  const res = fromSeam(SERVICE, data, error);
  if (res.error) return res;
  return ok(SERVICE, { assign_no: input.assign_no });
}

export async function cancelQcAssignment(input: { assign_no: string; reason: string }): Promise<Result<{ assign_no: string }>> {
  const { data, error } = await db().rpc("cancel_qc_assignment", { p_assign_no: input.assign_no, p_reason: input.reason });
  const res = fromSeam(SERVICE, data, error);
  if (res.error) return res;
  return ok(SERVICE, { assign_no: input.assign_no });
}

/** What a QC checks on one assignment: the order's lines and drawings. */
export async function listAssignmentLines(assignNo: string): Promise<Result<QcAssignmentLine[]>> {
  const { data, error } = await db().rpc("assignment_lines", { p_assign_no: assignNo });
  if (error) return fail(SERVICE, error);
  return ok(SERVICE, ((data ?? []) as Row[]).map((r) => ({
    line_no: n(r.line_no), description: String(r.description), qty: n(r.qty), uom: String(r.uom),
    project_line_no: r.project_line_no == null ? null : n(r.project_line_no),
    design_item_no: s(r.design_item_no), product_code: s(r.product_code),
    drawing_attachment_id: s(r.drawing_attachment_id), drawing_filename: s(r.drawing_filename),
    drawing_url: s(r.drawing_url),
  })));
}

/** The live factory orders a coordinator picks from, with who is on each. */
export async function listAssignableOrders(): Promise<Result<QcAssignableOrder[]>> {
  const { data, error } = await db().rpc("assignable_orders");
  if (error) return fail(SERVICE, error);
  return ok(SERVICE, ((data ?? []) as Row[]).map((r) => ({
    po_no: String(r.po_no), po_status: String(r.po_status) as QcAssignableOrder["po_status"],
    vendor_name: String(r.vendor_name), project_code: String(r.project_code), project_name: String(r.project_name),
    expected_delivery: s(r.expected_delivery), line_count: n(r.line_count), qc_names: s(r.qc_names),
  })));
}
