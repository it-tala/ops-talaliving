/** The client log against the database — `ops_procure` client activities
 *  (0134). Reads are `v_client_activity`; writes are the two seams, each
 *  re-reading the row it wrote so a screen redraws from what was stored.
 */
import type {
  ActivityFilter, ActivityInput, ClientActivityView,
} from "@/services/crm/contracts";
import { supabaseBrowser } from "@/lib/supabase/client";
import { fail, fromSeam, notFound, ok, type Result } from "./_kit";

const SERVICE = "procurement" as const;

const db = () => supabaseBrowser().schema("ops_procure");

type Row = Record<string, unknown>;
const s = (v: unknown): string | null => (v == null ? null : String(v));

function toView(r: Row): ClientActivityView {
  return {
    id: r.id as string,
    kind: r.kind as ClientActivityView["kind"],
    happened_on: r.happened_on as string,
    summary: r.summary as string,
    follow_up_on: s(r.follow_up_on),
    next_action: s(r.next_action),
    follow_up_done_at: s(r.follow_up_done_at),
    follow_up_result: s(r.follow_up_result),
    follow_up_state: r.follow_up_state as ClientActivityView["follow_up_state"],
    client_code: r.client_code as string,
    client_name: r.client_name as string,
    client_contact: s(r.client_contact),
    client_phone: s(r.client_phone),
    project_code: s(r.project_code),
    project_name: s(r.project_name),
    quote_no: s(r.quote_no),
    quote_status: s(r.quote_status),
    created_by_name: s(r.created_by_name),
    follow_up_done_by_name: s(r.follow_up_done_by_name),
    created_at: r.created_at as string,
  };
}

async function one(id: string): Promise<Result<ClientActivityView>> {
  const { data, error } = await db().from("v_client_activity").select("*").eq("id", id).maybeSingle();
  if (error) return fail(SERVICE, error);
  if (!data) return notFound(SERVICE, "activity_not_found", "Aktivitas itu tidak ada.");
  return ok(SERVICE, toView(data as Row));
}

/** Newest contact first; open follow-ups by their date. */
export async function listActivities(filter: ActivityFilter = {}): Promise<Result<ClientActivityView[]>> {
  let q = db().from("v_client_activity").select("*");
  if (filter.client_code) q = q.eq("client_code", filter.client_code);
  if (filter.project_code) q = q.eq("project_code", filter.project_code);
  if (filter.quote_no) q = q.eq("quote_no", filter.quote_no);
  if (filter.open_follow_ups) {
    q = q.in("follow_up_state", ["overdue", "today", "upcoming"]).order("follow_up_on", { ascending: true });
  } else {
    q = q.order("happened_on", { ascending: false }).order("created_at", { ascending: false });
  }
  const { data, error } = await q;
  if (error) return fail(SERVICE, error);
  return ok(SERVICE, ((data ?? []) as Row[]).map(toView));
}

export async function logActivity(input: ActivityInput, idempotencyKey?: string): Promise<Result<ClientActivityView>> {
  const { data, error } = await db().rpc("log_client_activity", {
    p_client_code: input.client_code ?? null,
    p_kind: input.kind,
    p_summary: input.summary,
    p_project_code: input.project_code ?? null,
    p_quote_no: input.quote_no ?? null,
    p_happened_on: input.happened_on || null,
    p_follow_up_on: input.follow_up_on || null,
    p_next_action: input.next_action ?? null,
    p_key: idempotencyKey ?? null,
  });
  const res = fromSeam<{ id: string }>(SERVICE, data, error);
  if (res.error) return res;
  return one(res.data.id);
}

export async function completeFollowUp(activityId: string, result?: string | null): Promise<Result<ClientActivityView>> {
  const { data, error } = await db().rpc("complete_follow_up", { p_activity_id: activityId, p_result: result ?? null });
  const res = fromSeam<{ id: string }>(SERVICE, data, error);
  if (res.error) return res;
  return one(activityId);
}
