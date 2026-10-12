/** Field QC in the demo — the same rules as `ops_qc` (0261, O6, D418).
 *
 *  The coordinator (`qc: admin`) keeps the team and sends people to factory
 *  orders; leadership and procurement read every assignment; a QC reads only
 *  their own, and through it the order's lines and drawings, never a price.
 */
import { ok, noop, invalid, notFound, refused, type Result } from "@/services/_shared/envelope";
import type {
  QcAssignableOrder, QcAssignment, QcAssignmentInput, QcAssignmentLine, QcAssignResult, QcPerson, QcPersonInput,
} from "@/services/qc/contracts";
import { getState, apply, newId, nextDocNumber, writeAudit } from "../store";
import { latency, actingUser, conflict, replayed, remember } from "./_kit";
import { officeToday } from "@/lib/office";
import type { DemoState } from "../state";

const SERVICE = "production" as const;
const rank = { read: 0, write: 1, admin: 2 } as const;

function holds(module: string, level: "read" | "write" | "admin"): boolean {
  return actingUser().modules.some((m) => m.module === module && rank[m.level] >= rank[level]);
}
/** `ops_qc.is_coordinator`: `qc.coordinate`, which is `qc: admin`. */
const isCoordinator = () => holds("qc", "admin");
/** `ops_qc.sees_all`: the coordinator, project editors, procurement. */
const seesAll = () => isCoordinator() || holds("project", "write") || holds("procurement", "read");
function myPersonId(state: DemoState): string | null {
  const me = actingUser().id;
  return state.qc_people.find((p) => p.user_id === me && p.is_active)?.id ?? null;
}

function personView(state: DemoState, p: DemoState["qc_people"][number]): QcPerson {
  const today = officeToday();
  const mine = state.qc_assignments.filter((a) => a.person_id === p.id && !a.cancelled_at);
  const user = p.user_id ? state.users.find((u) => u.id === p.user_id) : undefined;
  const level = user?.modules.find((m) => m.module === "qc")?.level ?? null;
  return {
    id: p.id, code: p.code, name: p.name, phone: p.phone, city: p.city, is_active: p.is_active,
    inactive_reason: p.inactive_reason, note: p.note, account_email: user?.email ?? null,
    account_qc_level: seesAll() || p.user_id === actingUser().id ? level : null,
    active_assignments: mine.filter((a) => a.starts_on <= today && (!a.ends_on || a.ends_on >= today)).length,
    total_assignments: mine.length,
  };
}

function assignmentView(state: DemoState, a: DemoState["qc_assignments"][number]): QcAssignment {
  const today = officeToday();
  const p = state.qc_people.find((x) => x.id === a.person_id)!;
  const po = state.purchase_orders.find((x) => x.id === a.po_id);
  const v = po ? state.vendors.find((x) => x.id === po.vendor_id) : undefined;
  const pj = po?.project_id ? state.projects.find((x) => x.id === po.project_id) : undefined;
  const cl = pj?.client_id ? state.clients.find((x) => x.id === pj.client_id) : undefined;
  return {
    id: a.id, assign_no: a.assign_no, starts_on: a.starts_on, ends_on: a.ends_on, note: a.note,
    created_at: a.created_at, cancelled_at: a.cancelled_at, cancel_reason: a.cancel_reason,
    person_code: p.code, person_name: p.name, person_phone: p.phone, person_city: p.city,
    is_mine: p.user_id === actingUser().id,
    po_no: po?.po_no ?? null, po_status: po?.status ?? null,
    vendor_name: v?.name ?? null, vendor_address: v?.address ?? null,
    project_code: pj?.code ?? null, project_name: pj?.name ?? null,
    client_name: cl?.name ?? pj?.client_name ?? null,
    expected_delivery: po?.expected_delivery ?? null, issued_at: po?.issued_at ?? null,
    line_count: po ? state.po_lines.filter((l) => l.po_id === po.id && l.superseded_by === null).length : 0,
    container_count: po ? state.deliveries.filter((d) => d.po_id === po.id && d.delivery_mode === "container" && d.status !== "CANCELLED").length : 0,
    state: a.cancelled_at ? "CANCELLED"
      : a.starts_on > today ? "PLANNED"
        : a.ends_on && a.ends_on < today ? "ENDED" : "ACTIVE",
  };
}

const notCoordinator = (what: string) => refused(SERVICE, "not_permitted", `${what} butuh akses koordinator QC.`);

export async function listQcPeople(opts: { include_inactive?: boolean } = {}): Promise<Result<QcPerson[]>> {
  await latency();
  const state = getState();
  const me = actingUser().id;
  return ok(SERVICE, state.qc_people
    .filter((p) => seesAll() || p.user_id === me)
    .filter((p) => opts.include_inactive || p.is_active)
    .map((p) => personView(state, p))
    .sort((a, b) => a.name.localeCompare(b.name)));
}

export async function saveQcPerson(input: QcPersonInput): Promise<Result<QcPerson & { granted_qc_write: boolean }>> {
  await latency();
  if (!isCoordinator()) return notCoordinator("Mengelola tim QC");
  if (!input.name?.trim()) return invalid(SERVICE, "name_required", "Namanya siapa?", { field: "name" });
  const state = getState();
  const existing = input.code ? state.qc_people.find((p) => p.code === input.code!.trim().toUpperCase()) : undefined;
  if (input.code && !existing) return notFound(SERVICE, "qc_person_not_found", `Tidak ada QC ${input.code}.`);
  let userId: string | null = null;
  if (input.user_email?.trim()) {
    const u = state.users.find((x) => x.email.toLowerCase() === input.user_email!.trim().toLowerCase());
    if (!u) {
      return invalid(SERVICE, "account_unknown",
        `Belum ada akun ops ${input.user_email.trim()}. Minta IT membuatnya dulu, lalu tautkan di sini.`, { field: "user_email" });
    }
    const taken = state.qc_people.find((p) => p.user_id === u.id && p.id !== existing?.id);
    if (taken) return conflict(SERVICE, "account_taken", `Akun ${u.email} sudah tertaut ke ${taken.code}.`, { code: taken.code });
    userId = u.id;
  }
  const values = {
    name: input.name.trim(), phone: input.phone?.trim() || null, city: input.city?.trim() || null,
    note: input.note?.trim() || null, user_id: userId,
  };
  let code = existing?.code ?? "";
  let granted = false;
  const by = actingUser();
  apply((draft) => {
    if (existing) {
      Object.assign(draft.qc_people.find((p) => p.id === existing.id)!, values);
    } else {
      const next = draft.qc_people.reduce((m, p) => Math.max(m, Number(p.code.replace(/\D/g, "")) || 0), 0) + 1;
      code = `QC-${String(next).padStart(3, "0")}`;
      draft.qc_people.push({
        id: newId("qcp"), code, ...values, is_active: true, inactive_reason: null, created_at: new Date().toISOString(),
      });
    }
    /* An account that can sign in but not see its assignment is a support call. */
    const u = userId ? draft.users.find((x) => x.id === userId) : undefined;
    if (u && !u.modules.some((m) => m.module === "qc")) { u.modules.push({ module: "qc", level: "write" }); granted = true; }
    writeAudit(draft, {
      service: SERVICE, entity: "qc_person", entity_no: code, action: existing ? "update" : "add", outcome: "ok", reason: null,
      detail: { account: input.user_email ?? null, granted_qc_write: granted, by: by.email },
    });
  });
  const st = getState();
  return ok(SERVICE, { ...personView(st, st.qc_people.find((p) => p.code === code)!), granted_qc_write: granted });
}

export async function setQcPersonActive(
  input: { code: string; active: boolean; reason?: string | null },
): Promise<Result<{ code: string; is_active: boolean; warnings: string[] }>> {
  await latency();
  if (!isCoordinator()) return notCoordinator("Mengelola tim QC");
  const state = getState();
  const p = state.qc_people.find((x) => x.code === input.code.trim().toUpperCase());
  if (!p) return notFound(SERVICE, "qc_person_not_found", `Tidak ada QC ${input.code}.`);
  if (p.is_active === input.active) return noop(SERVICE, { code: p.code, is_active: p.is_active, warnings: [] });
  if (!input.active && !input.reason?.trim()) {
    return invalid(SERVICE, "reason_required", "Kenapa dinonaktifkan? Alasannya dibaca saat evaluasi.", { field: "reason" });
  }
  const today = officeToday();
  const live = state.qc_assignments.filter((a) => a.person_id === p.id && !a.cancelled_at && (!a.ends_on || a.ends_on >= today)).length;
  apply((draft) => {
    const row = draft.qc_people.find((x) => x.id === p.id)!;
    row.is_active = input.active;
    row.inactive_reason = input.active ? null : input.reason!.trim();
    writeAudit(draft, {
      service: SERVICE, entity: "qc_person", entity_no: p.code, action: "set_active", outcome: "ok",
      reason: input.reason ?? null, detail: { is_active: input.active, live_assignments: live },
    });
  });
  return ok(SERVICE, {
    code: p.code, is_active: input.active,
    warnings: !input.active && live > 0 ? [`${p.name} masih punya ${live} penugasan berjalan.`] : [],
  });
}

export async function listQcAssignments(
  opts: { person_code?: string; po_no?: string; project_code?: string; include_cancelled?: boolean } = {},
): Promise<Result<QcAssignment[]>> {
  await latency();
  const state = getState();
  const mine = myPersonId(state);
  const all = seesAll();
  return ok(SERVICE, state.qc_assignments
    .filter((a) => all || (a.person_id === mine && !a.cancelled_at))
    .filter((a) => opts.include_cancelled || !a.cancelled_at)
    .map((a) => assignmentView(state, a))
    .filter((v) => (!opts.person_code || v.person_code === opts.person_code)
      && (!opts.po_no || v.po_no === opts.po_no) && (!opts.project_code || v.project_code === opts.project_code))
    .sort((a, b) => b.starts_on.localeCompare(a.starts_on)));
}

export async function assignQc(input: QcAssignmentInput, idempotencyKey?: string): Promise<Result<QcAssignResult>> {
  await latency();
  const cached = replayed<QcAssignResult>(SERVICE, "assignQc", idempotencyKey);
  if (cached) return cached;
  if (!isCoordinator()) return notCoordinator("Menugaskan QC");
  const state = getState();
  const p = state.qc_people.find((x) => x.code === input.person_code?.trim().toUpperCase());
  if (!p) return invalid(SERVICE, "person_unknown", `Tidak ada QC ${input.person_code || "—"}.`, { field: "person_code" });
  if (!p.is_active) return conflict(SERVICE, "person_inactive", `${p.name} sedang nonaktif.`);
  const po = state.purchase_orders.find((x) => x.po_no === input.po_no?.trim());
  if (!po) return invalid(SERVICE, "order_unknown", `Tidak ada order ${input.po_no || "—"}.`, { field: "po_no" });
  if (!po.project_id) {
    return invalid(SERVICE, "not_factory_order", `${po.po_no} bukan order pabrik — QC memantau order pabrik sebuah proyek.`, { field: "po_no" });
  }
  if (po.status === "CANCELLED" || po.status === "CLOSED") {
    return conflict(SERVICE, "order_closed", `${po.po_no} sudah ${po.status === "CANCELLED" ? "dibatalkan" : "ditutup"}.`);
  }
  if (!input.starts_on) return invalid(SERVICE, "start_required", "Mulai tanggal berapa?", { field: "starts_on" });
  if (input.ends_on && input.ends_on < input.starts_on) {
    return invalid(SERVICE, "end_before_start", "Selesai tidak bisa sebelum mulai.", { field: "ends_on" });
  }
  if (state.qc_assignments.some((a) => a.person_id === p.id && a.po_id === po.id && !a.cancelled_at)) {
    return conflict(SERVICE, "already_assigned", `${p.name} sudah ditugaskan di ${po.po_no}.`);
  }
  const others = state.qc_assignments
    .filter((a) => a.po_id === po.id && !a.cancelled_at && a.person_id !== p.id)
    .map((a) => state.qc_people.find((x) => x.id === a.person_id)?.name ?? "")
    .sort().join(", ") || null;
  let no = "";
  apply((draft) => {
    no = nextDocNumber(draft, "qca");
    draft.qc_assignments.push({
      id: newId("qca"), assign_no: no, person_id: p.id, po_id: po.id, starts_on: input.starts_on,
      ends_on: input.ends_on || null, note: input.note?.trim() || null, created_at: new Date().toISOString(),
      cancelled_at: null, cancel_reason: null,
    });
    writeAudit(draft, {
      service: SERVICE, entity: "qc_assignment", entity_no: no, action: "assign", outcome: "ok", reason: null,
      detail: { person: p.code, po_no: po.po_no, starts_on: input.starts_on, ends_on: input.ends_on ?? null },
    });
  });
  const result: QcAssignResult = { assign_no: no, account_linked: !!p.user_id, others_on_order: others };
  remember(SERVICE, "assignQc", idempotencyKey, result);
  return ok(SERVICE, result);
}

export async function endQcAssignment(input: { assign_no: string; ends_on: string | null }): Promise<Result<{ assign_no: string }>> {
  await latency();
  if (!isCoordinator()) return notCoordinator("Mengubah penugasan QC");
  const a = getState().qc_assignments.find((x) => x.assign_no === input.assign_no);
  if (!a) return notFound(SERVICE, "qc_assignment_not_found", `Tidak ada penugasan ${input.assign_no}.`);
  if (a.cancelled_at) return conflict(SERVICE, "cancelled", "Penugasan ini sudah dibatalkan.");
  if (input.ends_on && input.ends_on < a.starts_on) {
    return invalid(SERVICE, "end_before_start", "Selesai tidak bisa sebelum mulai.", { field: "ends_on" });
  }
  if ((a.ends_on ?? null) === (input.ends_on || null)) return noop(SERVICE, { assign_no: a.assign_no });
  apply((draft) => {
    draft.qc_assignments.find((x) => x.id === a.id)!.ends_on = input.ends_on || null;
    writeAudit(draft, {
      service: SERVICE, entity: "qc_assignment", entity_no: a.assign_no, action: "end", outcome: "ok", reason: null,
      detail: { from: a.ends_on, to: input.ends_on },
    });
  });
  return ok(SERVICE, { assign_no: a.assign_no });
}

export async function cancelQcAssignment(input: { assign_no: string; reason: string }): Promise<Result<{ assign_no: string }>> {
  await latency();
  if (!isCoordinator()) return notCoordinator("Membatalkan penugasan QC");
  const a = getState().qc_assignments.find((x) => x.assign_no === input.assign_no);
  if (!a) return notFound(SERVICE, "qc_assignment_not_found", `Tidak ada penugasan ${input.assign_no}.`);
  if (a.cancelled_at) return conflict(SERVICE, "already_cancelled", "Penugasan ini sudah dibatalkan.");
  if (!input.reason?.trim()) return invalid(SERVICE, "reason_required", "Kenapa dibatalkan?", { field: "reason" });
  apply((draft) => {
    const row = draft.qc_assignments.find((x) => x.id === a.id)!;
    row.cancelled_at = new Date().toISOString();
    row.cancel_reason = input.reason.trim();
    writeAudit(draft, {
      service: SERVICE, entity: "qc_assignment", entity_no: a.assign_no, action: "cancel", outcome: "ok",
      reason: input.reason.trim(), detail: {},
    });
  });
  return ok(SERVICE, { assign_no: a.assign_no });
}

export async function listAssignmentLines(assignNo: string): Promise<Result<QcAssignmentLine[]>> {
  await latency();
  const state = getState();
  const a = state.qc_assignments.find((x) => x.assign_no === assignNo && !x.cancelled_at);
  if (!a || !(seesAll() || a.person_id === myPersonId(state))) return ok(SERVICE, []);
  return ok(SERVICE, state.po_lines
    .filter((l) => l.po_id === a.po_id && l.superseded_by === null)
    .sort((x, y) => x.line_no - y.line_no)
    .map((l) => {
      const pl = l.project_line_id ? state.project_lines.find((x) => x.id === l.project_line_id) : undefined;
      const di = pl?.design_item_id ? state.design_items.find((x) => x.id === pl.design_item_id) : undefined;
      const link = di ? state.attachment_links
        .filter((k) => k.entity === "design_item" && k.entity_no === di.item_no && k.kind === "Gambar Kerja")
        .sort((x, y) => y.linked_at.localeCompare(x.linked_at))[0] : undefined;
      const att = link ? state.attachments.find((x) => x.id === link.attachment_id) : undefined;
      return {
        line_no: l.line_no, description: l.description, qty: l.qty, uom: l.uom,
        project_line_no: pl?.line_no ?? null, design_item_no: di?.item_no ?? null, product_code: pl?.product_code ?? null,
        drawing_attachment_id: att?.id ?? null, drawing_filename: att?.filename ?? null, drawing_url: att?.url ?? null,
      };
    }));
}

/** The live factory orders a coordinator picks from (0261's `assignable_orders`). */
export async function listAssignableOrders(): Promise<Result<QcAssignableOrder[]>> {
  await latency();
  if (!seesAll()) return ok(SERVICE, []);
  const state = getState();
  return ok(SERVICE, state.purchase_orders
    .filter((po) => po.project_id && po.status !== "CANCELLED" && po.status !== "CLOSED")
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map((po) => {
      const pj = state.projects.find((x) => x.id === po.project_id)!;
      return {
        po_no: po.po_no, po_status: po.status, vendor_name: state.vendors.find((v) => v.id === po.vendor_id)?.name ?? "—",
        project_code: pj.code, project_name: pj.name, expected_delivery: po.expected_delivery,
        line_count: state.po_lines.filter((l) => l.po_id === po.id && l.superseded_by === null).length,
        qc_names: state.qc_assignments.filter((a) => a.po_id === po.id && !a.cancelled_at)
          .map((a) => state.qc_people.find((p) => p.id === a.person_id)?.name ?? "").sort().join(", ") || null,
      };
    }));
}
