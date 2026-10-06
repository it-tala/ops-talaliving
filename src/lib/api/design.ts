/** A project's design against the database — `ops_procure` design tables
 *  (0222, P4). Same names and signatures as `src/demo/api/design.ts`.
 *
 *  Stamped `procurement`, where projects live; checked against
 *  `may_design` — whoever sells (D375) and the drafters.
 */
import type {
  DesignApproval, DesignApprovalInput, DesignCollection, DesignItemInput, DesignItemView,
  DesignRoom, ProjectDesign,
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
    p_room_code: input.room_code,
    p_name: input.name,
    p_qty: input.qty,
    p_origin: input.origin,
    p_length_mm: input.length_mm ?? null,
    p_width_mm: input.width_mm ?? null,
    p_height_mm: input.height_mm ?? null,
    p_note: input.note ?? null,
    p_item_no: input.item_no ?? null,
  });
  const res = fromSeam<{ item_no: string }>(SERVICE, data, error);
  if (res.error) return res;
  return getDesignItem(res.data.item_no);
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
