/** The client log in the demo — the same rules as 0134's seams, over the store.
 *
 *  Envelopes are stamped `procurement`, where clients and projects live; the
 *  permission is the project module's (`write` to log, any level to read).
 */
import { ok, invalid, notFound, noop, refused, type Result } from "@/services/_shared/envelope";
import type {
  ActivityFilter, ActivityInput, ClientActivity, ClientActivityView, FollowUpState,
  MeetingAttendee, MeetingAttendeeInput, MeetingAttendeeRow, MeetingInput, MeetingPerson,
  MeetingPointFilter, MeetingPointInput, MeetingPointRow, MeetingPointView,
} from "@/services/crm/contracts";
import { ACTIVITY_KINDS, MEETING_KINDS } from "@/services/crm/contracts";
import { getState, apply, newId, writeAudit } from "../store";
import { latency, actingUser, canDesign, requireSeller, replayed, remember } from "./_kit";
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
    attendee_count: state.meeting_attendees.filter((m) => m.activity_id === a.id).length,
    point_count: state.meeting_points.filter((p) => p.activity_id === a.id).length,
    open_points: state.meeting_points.filter((p) => p.activity_id === a.id
      && (p.kind === "revision" || p.kind === "action") && !p.closed_at).length,
    file_count: state.attachment_links.filter((l) => l.entity === "client_activity" && l.entity_no === a.id).length,
  };
}

/** Newest contact first; open follow-ups by their date. */
export async function listActivities(filter: ActivityFilter = {}): Promise<Result<ClientActivityView[]>> {
  await latency();
  /* The log is the sellers' (0219, D375): anybody else reads no rows, as RLS
     answers them — a drafter reads a meeting's points, not the log (0223). */
  if (requireSeller(SERVICE, "read")) return ok(SERVICE, []);
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
  const denied = requireSeller(SERVICE);
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
  const denied = requireSeller(SERVICE);
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

/* ── a meeting in full (0223, P3) ───────────────────────────────────────────
 *
 * The same rules as `meeting_lines_invalid`: checked against the entry before
 * anything is written, so a refused meeting leaves nothing behind. */

const userName = (state: DemoState, id: string | null) => {
  const u = id ? state.users.find((x) => x.id === id) : undefined;
  return u ? (u.full_name || u.email) : null;
};

function linesInvalid(
  state: DemoState, a: Pick<ClientActivity, "kind" | "project_id" | "happened_on">,
  attendees: MeetingAttendeeInput[] = [], points: MeetingPointInput[] = [],
): Result<never> | null {
  if (attendees.length && !MEETING_KINDS.includes(a.kind)) {
    return invalid(SERVICE, "attendees_meeting_only", "Peserta hanya dicatat untuk meeting dan kunjungan.", { field: "attendees" });
  }
  for (const [i, x] of attendees.entries()) {
    const n = i + 1;
    if (!["tala", "client", "third_party"].includes(x.side)) {
      return invalid(SERVICE, "unknown_side", `Peserta ${n}: dari pihak TALA, klien, atau pihak ketiga?`, { field: "attendees", index: n });
    }
    if (x.side === "tala") {
      if (!x.user_id || !state.users.some((u) => u.id === x.user_id && u.is_active)) {
        return invalid(SERVICE, "attendee_unknown", `Peserta ${n} dari TALA harus akun yang aktif.`, { field: "attendees", index: n });
      }
    } else if (!x.name?.trim()) {
      return invalid(SERVICE, "attendee_name_required", `Peserta ${n}: siapa namanya?`, { field: "attendees", index: n });
    }
  }
  for (const [i, x] of points.entries()) {
    const n = i + 1;
    if (!["decision", "revision", "action", "note"].includes(x.kind)) {
      return invalid(SERVICE, "unknown_point_kind", `Butir ${n}: keputusan, permintaan revisi, tindakan, atau catatan?`, { field: "points", index: n });
    }
    if (!x.body?.trim()) return invalid(SERVICE, "point_body_required", `Butir ${n} kosong.`, { field: "points", index: n });
    if (x.item_no?.trim()) {
      const item = state.design_items.find((d) => d.item_no === x.item_no!.trim());
      if (!item) return invalid(SERVICE, "item_unknown", `Butir ${n}: tidak ada item ${x.item_no}.`, { field: "points", index: n });
      const room = state.design_rooms.find((r) => r.id === item.room_id);
      const col = state.design_collections.find((c) => c.id === room?.collection_id);
      if (!a.project_id || col?.project_id !== a.project_id) {
        return invalid(SERVICE, "item_other_project", `Butir ${n}: item ${item.item_no} bukan item proyek yang dibicarakan.`, { field: "points", index: n });
      }
    }
    if (x.owner_id && !state.users.some((u) => u.id === x.owner_id && u.is_active)) {
      return invalid(SERVICE, "owner_unknown", `Butir ${n}: penanggung jawabnya harus akun yang aktif.`, { field: "points", index: n });
    }
    if (x.due_on && x.due_on < a.happened_on) {
      return invalid(SERVICE, "due_before_meeting", `Butir ${n}: tenggatnya sebelum meeting.`, { field: "points", index: n });
    }
  }
  return null;
}

function writeLines(
  draft: DemoState, a: ClientActivity, attendees: MeetingAttendeeInput[] = [], points: MeetingPointInput[] = [],
): number {
  let seq = Math.max(0, ...draft.meeting_attendees.filter((m) => m.activity_id === a.id).map((m) => m.seq));
  for (const x of attendees) {
    if (x.side === "tala" && draft.meeting_attendees.some((m) => m.activity_id === a.id && m.user_id === x.user_id)) continue;
    seq += 1;
    draft.meeting_attendees.push({
      id: newId("ma"), activity_id: a.id, seq, side: x.side,
      user_id: x.side === "tala" ? x.user_id ?? null : null,
      name: x.side === "tala" ? null : x.name!.trim(),
      role: x.role?.trim() || null,
    } satisfies MeetingAttendeeRow);
  }
  seq = Math.max(0, ...draft.meeting_points.filter((p) => p.activity_id === a.id).map((p) => p.seq));
  const by = actingUser().id;
  for (const x of points) {
    seq += 1;
    draft.meeting_points.push({
      id: newId("mp"), activity_id: a.id, project_id: a.project_id, happened_on: a.happened_on, seq,
      kind: x.kind, body: x.body.trim(),
      design_item_id: x.item_no?.trim() ? draft.design_items.find((d) => d.item_no === x.item_no!.trim())?.id ?? null : null,
      owner_id: x.owner_id || null, due_on: x.due_on || null,
      closed_at: null, closed_by: null, closed_note: null, created_by: by,
      created_at: new Date(Date.now() + seq).toISOString(),
    } satisfies MeetingPointRow);
  }
  return points.length;
}

/** A contact with its attendees and minutes, in one call: if one line is
 *  refused, nothing is written. */
export async function logMeeting(input: MeetingInput, idempotencyKey?: string): Promise<Result<ClientActivityView>> {
  const cached = replayed<ClientActivityView>(SERVICE, "logMeeting", idempotencyKey);
  if (cached) return cached;
  /* The entry by its own rules first, then the lines against it; a refused
     line takes the entry back with it, as the database's transaction does. */
  const res = await logActivity(input);
  if (res.error) return res;
  const bad = linesInvalid(getState(), getState().client_activities.find((a) => a.id === res.data.id)!,
    input.attendees, input.points);
  if (bad) {
    apply((draft) => { draft.client_activities = draft.client_activities.filter((a) => a.id !== res.data.id); });
    return bad;
  }
  apply((draft) => {
    const a = draft.client_activities.find((x) => x.id === res.data.id)!;
    writeLines(draft, a, input.attendees, input.points);
  });
  const s = getState();
  const v = viewOf(s, s.client_activities.find((a) => a.id === res.data.id)!, officeToday());
  remember(SERVICE, "logMeeting", idempotencyKey, v);
  return ok(SERVICE, v);
}

/** More minutes, or somebody forgotten, after the meeting. */
export async function addMeetingLines(
  activityId: string, lines: { attendees?: MeetingAttendeeInput[]; points?: MeetingPointInput[] },
): Promise<Result<ClientActivityView>> {
  await latency();
  const denied = requireSeller(SERVICE);
  if (denied) return denied;
  const state = getState();
  const a = state.client_activities.find((x) => x.id === activityId);
  if (!a) return notFound(SERVICE, "activity_not_found", "Catatan kontak itu tidak ada.");
  const today = officeToday();
  if (!(lines.attendees?.length || lines.points?.length)) return noop(SERVICE, viewOf(state, a, today));
  const bad = linesInvalid(state, a, lines.attendees, lines.points);
  if (bad) return bad;
  apply((draft) => { writeLines(draft, draft.client_activities.find((x) => x.id === activityId)!, lines.attendees, lines.points); });
  const s = getState();
  return ok(SERVICE, viewOf(s, s.client_activities.find((x) => x.id === activityId)!, today));
}

function pointView(state: DemoState, p: MeetingPointRow, today: string): MeetingPointView {
  const pr = p.project_id ? state.projects.find((x) => x.id === p.project_id) : undefined;
  const item = p.design_item_id ? state.design_items.find((d) => d.id === p.design_item_id) : undefined;
  const work = p.kind === "revision" || p.kind === "action";
  return {
    id: p.id, activity_id: p.activity_id, seq: p.seq, kind: p.kind, body: p.body, happened_on: p.happened_on,
    project_code: pr?.code ?? null, project_name: pr?.name ?? null,
    item_no: item?.item_no ?? null, item_name: item?.name ?? null,
    owner_id: p.owner_id, owner_name: userName(state, p.owner_id), due_on: p.due_on,
    state: !work ? "noted" : p.closed_at ? "done" : p.due_on && p.due_on < today ? "overdue" : "open",
    closed_at: p.closed_at, closed_by_name: userName(state, p.closed_by), closed_note: p.closed_note,
    created_by_name: userName(state, p.created_by), created_at: p.created_at,
  };
}

/** A revision request or an action done, with what came of it. */
export async function closeMeetingPoint(pointId: string, note?: string | null): Promise<Result<MeetingPointView>> {
  await latency();
  if (!canDesign("write")) {
    return refused(SERVICE, "not_permitted", "Menutup butir notulen butuh akses proyek, marketing, atau produksi (update).");
  }
  const state = getState();
  const p = state.meeting_points.find((x) => x.id === pointId);
  if (!p) return notFound(SERVICE, "point_not_found", "Butir notulen itu tidak ada.");
  const today = officeToday();
  if (p.kind !== "revision" && p.kind !== "action") {
    return invalid(SERVICE, "not_closable", "Hanya permintaan revisi dan tindakan yang ditutup; keputusan dan catatan cukup dicatat.", { field: "kind" });
  }
  if (p.closed_at) return noop(SERVICE, pointView(state, p, today));
  const by = actingUser().id;
  apply((draft) => {
    const row = draft.meeting_points.find((x) => x.id === pointId)!;
    row.closed_at = new Date().toISOString();
    row.closed_by = by;
    row.closed_note = note?.trim() || null;
  });
  const s = getState();
  return ok(SERVICE, pointView(s, s.meeting_points.find((x) => x.id === pointId)!, today));
}

export async function listMeetingAttendees(activityId: string): Promise<Result<MeetingAttendee[]>> {
  await latency();
  if (requireSeller(SERVICE, "read")) return ok(SERVICE, []);
  const state = getState();
  return ok(SERVICE, state.meeting_attendees
    .filter((m) => m.activity_id === activityId)
    .sort((a, b) => a.seq - b.seq)
    .map((m) => ({
      id: m.id, activity_id: m.activity_id, seq: m.seq, side: m.side, user_id: m.user_id,
      name: (m.user_id ? userName(state, m.user_id) : null) ?? m.name ?? "", role: m.role,
    })));
}

/** Minutes: of one contact in order; of a project or an item newest first. */
export async function listMeetingPoints(filter: MeetingPointFilter = {}): Promise<Result<MeetingPointView[]>> {
  await latency();
  if (!canDesign("read")) return ok(SERVICE, []);
  const state = getState();
  const today = officeToday();
  const rows = state.meeting_points.map((p) => pointView(state, p, today))
    .filter((v) => (!filter.activity_id || v.activity_id === filter.activity_id)
      && (!filter.project_code || v.project_code === filter.project_code)
      && (!filter.item_no || v.item_no === filter.item_no)
      && (!filter.open || v.state === "open" || v.state === "overdue"));
  rows.sort(filter.activity_id
    ? (a, b) => a.seq - b.seq
    : (a, b) => b.happened_on.localeCompare(a.happened_on) || a.seq - b.seq);
  return ok(SERVICE, rows);
}

/** Every active account — whoever went to the meeting for TALA. */
export async function listMeetingPeople(): Promise<Result<MeetingPerson[]>> {
  await latency();
  if (!canDesign("read")) return ok(SERVICE, []);
  return ok(SERVICE, getState().users.filter((u) => u.is_active)
    .map((u) => ({ id: u.id, full_name: u.full_name || u.email, email: u.email }))
    .sort((a, b) => a.full_name.localeCompare(b.full_name)));
}
