/** The client log in the demo — the same rules as 0134's seams, over the store.
 *
 *  Envelopes are stamped `procurement`, where clients and projects live; the
 *  permission is the project module's (`write` to log, any level to read).
 */
import { ok, invalid, notFound, noop, type Result } from "@/services/_shared/envelope";
import type {
  ActivityFilter, ActivityInput, ClientActivity, ClientActivityView, FollowUpState,
} from "@/services/crm/contracts";
import { ACTIVITY_KINDS } from "@/services/crm/contracts";
import { getState, apply, newId, writeAudit } from "../store";
import { latency, actingUser, requireLevel, replayed, remember } from "./_kit";
import { officeToday } from "@/lib/office";
import type { DemoState } from "../state";

const SERVICE = "procurement" as const;

function stateOf(a: ClientActivity, today: string): FollowUpState {
  if (!a.follow_up_on) return "none";
  if (a.follow_up_done_at) return "done";
  if (a.follow_up_on < today) return "overdue";
  if (a.follow_up_on === today) return "today";
  return "upcoming";
}

function viewOf(state: DemoState, a: ClientActivity, today: string): ClientActivityView {
  const c = state.clients.find((x) => x.id === a.client_id)!;
  const p = a.project_id ? state.projects.find((x) => x.id === a.project_id) : undefined;
  const q = a.quotation_id ? state.quotations.find((x) => x.id === a.quotation_id) : undefined;
  const who = (id: string | null) => {
    const u = id ? state.users.find((x) => x.id === id) : undefined;
    return u ? (u.full_name || u.email) : null;
  };
  return {
    id: a.id, kind: a.kind, happened_on: a.happened_on, summary: a.summary,
    follow_up_on: a.follow_up_on, next_action: a.next_action,
    follow_up_done_at: a.follow_up_done_at, follow_up_result: a.follow_up_result,
    follow_up_state: stateOf(a, today),
    client_code: c.code, client_name: c.name, client_contact: c.contact_name, client_phone: c.phone,
    project_code: p?.code ?? null, project_name: p?.name ?? null,
    quote_no: q?.quote_no ?? null, quote_status: q?.status ?? null,
    created_by_name: who(a.created_by), follow_up_done_by_name: who(a.follow_up_done_by),
    created_at: a.created_at,
  };
}

/** Newest contact first; open follow-ups by their date. */
export async function listActivities(filter: ActivityFilter = {}): Promise<Result<ClientActivityView[]>> {
  await latency();
  const state = getState();
  const today = officeToday();
  const rows = state.client_activities
    .map((a) => viewOf(state, a, today))
    .filter((v) => (!filter.client_code || v.client_code === filter.client_code)
      && (!filter.project_code || v.project_code === filter.project_code)
      && (!filter.quote_no || v.quote_no === filter.quote_no)
      && (!filter.open_follow_ups || ["overdue", "today", "upcoming"].includes(v.follow_up_state)));
  rows.sort(filter.open_follow_ups
    ? (a, b) => (a.follow_up_on ?? "").localeCompare(b.follow_up_on ?? "")
    : (a, b) => b.happened_on.localeCompare(a.happened_on) || b.created_at.localeCompare(a.created_at));
  return ok(SERVICE, rows);
}

export async function logActivity(input: ActivityInput, idempotencyKey?: string): Promise<Result<ClientActivityView>> {
  await latency();
  const cached = replayed<ClientActivityView>(SERVICE, "logActivity", idempotencyKey);
  if (cached) return cached;
  const denied = requireLevel(SERVICE, "project", "write");
  if (denied) return denied;

  const state = getState();
  const today = officeToday();
  const on = input.happened_on || today;
  if (!ACTIVITY_KINDS.some((k) => k.code === input.kind)) {
    return invalid(SERVICE, "bad_kind", "Jenisnya telepon, WhatsApp, email, meeting, kunjungan, atau catatan.", { field: "kind" });
  }
  if (!input.summary?.trim()) return invalid(SERVICE, "summary_required", "Apa yang dibicarakan? Satu kalimat cukup.", { field: "summary" });
  if (on > today) return invalid(SERVICE, "in_future", "Aktivitas dicatat setelah terjadi. Untuk rencana, pakai follow-up.", { field: "happened_on" });
  if (input.follow_up_on && input.follow_up_on < on) {
    return invalid(SERVICE, "follow_up_before", "Follow-up tidak bisa sebelum aktivitasnya.", { field: "follow_up_on" });
  }

  const qt = input.quote_no?.trim() ? state.quotations.find((x) => x.quote_no === input.quote_no!.trim()) : undefined;
  if (input.quote_no?.trim() && !qt) return notFound(SERVICE, "quotation_not_found", `Tidak ada quotation ${input.quote_no}.`);
  let pr = input.project_code?.trim() ? state.projects.find((x) => x.code === input.project_code!.trim()) : undefined;
  if (input.project_code?.trim()) {
    if (!pr) return notFound(SERVICE, "project_not_found", `Tidak ada proyek ${input.project_code}.`);
    if (qt && qt.project_id !== pr.id) {
      return invalid(SERVICE, "quote_other_project", `${qt.quote_no} bukan quotation proyek ${pr.code}.`, { field: "quote_no" });
    }
  } else if (qt) {
    pr = state.projects.find((x) => x.id === qt.project_id);
  }
  let client = input.client_code?.trim() ? state.clients.find((x) => x.code === input.client_code!.trim()) : undefined;
  if (input.client_code?.trim()) {
    if (!client) return notFound(SERVICE, "client_not_found", `Tidak ada klien ${input.client_code}.`);
    if (pr && pr.client_id !== client.id) {
      return invalid(SERVICE, "project_other_client", `Proyek ${pr.code} bukan milik ${client.name}.`, { field: "project_code" });
    }
  } else if (pr) {
    client = pr.client_id ? state.clients.find((x) => x.id === pr!.client_id) : undefined;
    if (!client) {
      return invalid(SERVICE, "no_client", `Proyek ${pr.code} belum punya klien. Pilih kliennya di proyek dulu.`, { field: "client_code" });
    }
  } else {
    return invalid(SERVICE, "client_required", "Dengan klien siapa?", { field: "client_code" });
  }

  const user = actingUser();
  const id = newId("act");
  apply((draft) => {
    draft.client_activities.push({
      id, client_id: client!.id, project_id: pr?.id ?? null, quotation_id: qt?.id ?? null,
      kind: input.kind, happened_on: on, summary: input.summary.trim(),
      follow_up_on: input.follow_up_on || null, next_action: input.next_action?.trim() || null,
      follow_up_done_at: null, follow_up_done_by: null, follow_up_result: null,
      created_by: user.id, created_at: new Date().toISOString(),
    });
    writeAudit(draft, {
      service: SERVICE, entity: "client_activity", entity_no: client!.code, action: "create", outcome: "ok",
      reason: null, detail: { kind: input.kind, project: pr?.code ?? null, quote: qt?.quote_no ?? null, by: user.email },
    });
  });
  const s = getState();
  const v = viewOf(s, s.client_activities.find((a) => a.id === id)!, today);
  remember(SERVICE, "logActivity", idempotencyKey, v);
  return ok(SERVICE, v);
}

export async function completeFollowUp(activityId: string, result?: string | null): Promise<Result<ClientActivityView>> {
  await latency();
  const denied = requireLevel(SERVICE, "project", "write");
  if (denied) return denied;
  const state = getState();
  const a = state.client_activities.find((x) => x.id === activityId);
  if (!a) return notFound(SERVICE, "activity_not_found", "Aktivitas itu tidak ada.");
  if (!a.follow_up_on) return invalid(SERVICE, "no_follow_up", "Aktivitas ini tidak punya follow-up.", { field: "follow_up_on" });
  const today = officeToday();
  if (a.follow_up_done_at) return noop(SERVICE, viewOf(state, a, today));
  const user = actingUser();
  apply((draft) => {
    const row = draft.client_activities.find((x) => x.id === activityId)!;
    row.follow_up_done_at = new Date().toISOString();
    row.follow_up_done_by = user.id;
    row.follow_up_result = result?.trim() || null;
  });
  const s = getState();
  return ok(SERVICE, viewOf(s, s.client_activities.find((x) => x.id === activityId)!, today));
}
