/** Field QC in the demo — the same rules as `ops_qc` (0261, O6, D418; 0263,
 *  O7, D419).
 *
 *  The coordinator (`qc: admin`) keeps the team and sends people to factory
 *  orders; leadership and procurement read every assignment; a QC reads only
 *  their own, and through it the order's lines and drawings, never a price.
 */
import { ok, noop, invalid, notFound, refused, type Result } from "@/services/_shared/envelope";
import type {
  QcAssignableOrder, QcAssignment, QcAssignmentInput, QcAssignmentLine, QcAssignResult, QcPerson, QcPersonInput,
  QcFinding, QcFindingInput, QcLineProgress, QcOrderContainer, QcReport, QcReportInput, QcReportLine, QcStage,
} from "@/services/qc/contracts";
import { QC_STAGES } from "@/services/qc/contracts";
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
    ...reportingOf(state, a),
  };
}

/** 0263's columns on `v_qc_assignment`: when it last reported, what is open. */
function reportingOf(state: DemoState, a: DemoState["qc_assignments"][number]) {
  const today = officeToday();
  const live = state.qc_reports.filter((r) => r.assignment_id === a.id && !r.cancelled_at);
  const last = live.map((r) => r.report_date).sort().at(-1) ?? null;
  const running = !a.cancelled_at && a.starts_on <= today && (!a.ends_on || a.ends_on >= today);
  return {
    last_report_on: last,
    report_count: live.length,
    days_without_report: running ? daysBetween(last ?? dayBefore(a.starts_on), today) : null,
    open_findings: state.qc_findings.filter((f) => f.po_id === a.po_id && f.status === "OPEN").length,
  };
}
const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
const dayBefore = (day: string) => new Date(Date.parse(day) - 86_400_000).toISOString().slice(0, 10);

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

/* ── reports, findings, progress (0263, O7, D419) ───────────────────────── */

/** `ops_qc.my_assignment`: the signed-in QC's own live assignment, or anybody
 *  who sees every one. */
function mayReadAssignment(state: DemoState, a: DemoState["qc_assignments"][number]): boolean {
  return seesAll() || (!a.cancelled_at && a.person_id === myPersonId(state));
}
/** `ops_qc.may_see_order`. */
function maySeeOrder(state: DemoState, poId: string): boolean {
  const me = myPersonId(state);
  return seesAll() || state.qc_assignments.some((a) => a.po_id === poId && !a.cancelled_at && a.person_id === me);
}
/** `ops_qc.watching`: the signed-in QC's live assignment on the order. */
function watching(state: DemoState, poId: string) {
  const me = myPersonId(state);
  return state.qc_assignments
    .filter((a) => a.po_id === poId && !a.cancelled_at && a.person_id === me)
    .sort((x, y) => y.starts_on.localeCompare(x.starts_on))[0] ?? null;
}
const liveLines = (state: DemoState, poId: string) =>
  state.po_lines.filter((l) => l.po_id === poId && l.superseded_by === null).sort((a, b) => a.line_no - b.line_no);

/** `ops_qc.line_progress`: passed at the latest report that counted the line. */
export function lineProgressOf(state: DemoState, poId: string): QcLineProgress[] {
  const reports = state.qc_reports
    .filter((r) => !r.cancelled_at && state.qc_assignments.find((a) => a.id === r.assignment_id)?.po_id === poId)
    .sort((a, b) => b.report_date.localeCompare(a.report_date) || b.created_at.localeCompare(a.created_at));
  return liveLines(state, poId).map((l) => {
    const counted = reports
      .map((r) => ({ r, x: state.qc_report_lines.find((x) => x.report_id === r.id && x.line_no === l.line_no) }))
      .filter((v) => v.x);
    const latest = counted[0];
    return {
      line_no: l.line_no, description: l.description, qty: l.qty, uom: l.uom,
      passed: latest?.x!.passed ?? null, qc_stage: latest?.r.stage ?? null,
      reported_on: latest?.r.report_date ?? null, report_no: latest?.r.report_no ?? null,
      rejected_total: counted.reduce((t, v) => t + v.x!.rejected, 0),
      open_findings: state.qc_findings.filter((f) => f.po_id === poId && f.line_no === l.line_no && f.status === "OPEN").length,
    };
  });
}

/** `ops_qc.load_warnings`: what stands between an order QC watches and loading. */
export function loadWarningsOf(state: DemoState, poId: string): string[] {
  if (!state.qc_assignments.some((a) => a.po_id === poId && !a.cancelled_at)) return [];
  const po = state.purchase_orders.find((x) => x.id === poId);
  const out: string[] = [];
  const short = lineProgressOf(state, poId).filter((l) => (l.passed ?? 0) < l.qty);
  if (short.length) {
    out.push(`QC belum melaporkan semua baris ${po?.po_no} lolos penuh (${short.map((l) => `baris ${l.line_no}: ${l.passed ?? 0} dari ${l.qty}`).join("; ")}).`);
  }
  const open = state.qc_findings.filter((f) => f.po_id === poId && f.status === "OPEN" && f.severity !== "minor").length;
  if (open) out.push(`Masih ada ${open} temuan QC major/kritis yang terbuka di ${po?.po_no}.`);
  return out;
}

function reportView(state: DemoState, r: DemoState["qc_reports"][number]): QcReport {
  const a = state.qc_assignments.find((x) => x.id === r.assignment_id)!;
  const v = assignmentView(state, a);
  const lines = state.qc_report_lines.filter((x) => x.report_id === r.id);
  const d = r.delivery_id ? state.deliveries.find((x) => x.id === r.delivery_id) : undefined;
  return {
    id: r.id, report_no: r.report_no, report_date: r.report_date, stage: r.stage, note: r.note,
    created_at: r.created_at, cancelled_at: r.cancelled_at, cancel_reason: r.cancel_reason,
    assign_no: a.assign_no, person_code: v.person_code, person_name: v.person_name, is_mine: v.is_mine,
    po_no: v.po_no, vendor_name: v.vendor_name, project_code: v.project_code, project_name: v.project_name,
    container_no: d ? d.container_no ?? d.delivery_no : null,
    line_count: lines.length,
    passed_total: lines.reduce((t, x) => t + x.passed, 0),
    rejected_total: lines.reduce((t, x) => t + x.rejected, 0),
    photo_count: state.attachment_links.filter((k) => k.entity === "qc_report" && k.entity_no === r.report_no).length,
  };
}

function findingView(state: DemoState, f: DemoState["qc_findings"][number]): QcFinding {
  const po = state.purchase_orders.find((x) => x.id === f.po_id);
  const pj = po?.project_id ? state.projects.find((x) => x.id === po.project_id) : undefined;
  const asg = f.assignment_id ? state.qc_assignments.find((a) => a.id === f.assignment_id) : undefined;
  const qp = asg ? state.qc_people.find((p) => p.id === asg.person_id) : undefined;
  const d = f.delivery_id ? state.deliveries.find((x) => x.id === f.delivery_id) : undefined;
  return {
    id: f.id, finding_no: f.finding_no, phase: f.phase, finding_kind: f.finding_kind, severity: f.severity,
    description: f.description, status: f.status, resolution: f.resolution, resolved_at: f.resolved_at,
    created_at: f.created_at, line_no: f.line_no,
    line_description: f.line_no != null ? liveLines(state, f.po_id).find((l) => l.line_no === f.line_no)?.description ?? null : null,
    po_no: po?.po_no ?? null, vendor_name: po ? state.vendors.find((v) => v.id === po.vendor_id)?.name ?? null : null,
    project_code: pj?.code ?? null, project_name: pj?.name ?? null,
    report_no: f.report_id ? state.qc_reports.find((r) => r.id === f.report_id)?.report_no ?? null : null,
    container_no: d ? d.container_no ?? d.delivery_no : null,
    raised_by_name: qp?.name ?? state.users.find((u) => u.id === f.created_by)?.full_name ?? null,
    resolved_by_name: f.resolved_by ? state.users.find((u) => u.id === f.resolved_by)?.full_name ?? null : null,
    photo_count: state.attachment_links.filter((k) => k.entity === "qc_finding" && k.entity_no === f.finding_no).length,
  };
}

function linkPhotos(draft: DemoState, ids: string[], entity: "qc_report" | "qc_finding", no: string, by: string) {
  for (const id of ids) {
    if (draft.attachment_links.some((k) => k.attachment_id === id && k.entity === entity && k.entity_no === no)) continue;
    draft.attachment_links.push({
      id: newId("lnk"), attachment_id: id, entity, entity_no: no, kind: "Foto QC",
      linked_by: by, linked_at: new Date().toISOString(),
    });
  }
}
const missingPhoto = (state: DemoState, ids: string[] | undefined) =>
  (ids ?? []).find((id) => !state.attachments.some((a) => a.id === id)) ?? null;

/** Every report the reader may see, newest first. */
export async function listQcReports(
  opts: { assign_no?: string; po_no?: string; include_cancelled?: boolean } = {},
): Promise<Result<QcReport[]>> {
  await latency();
  const state = getState();
  return ok(SERVICE, state.qc_reports
    .filter((r) => mayReadAssignment(state, state.qc_assignments.find((a) => a.id === r.assignment_id)!))
    .filter((r) => opts.include_cancelled || !r.cancelled_at)
    .map((r) => reportView(state, r))
    .filter((v) => (!opts.assign_no || v.assign_no === opts.assign_no) && (!opts.po_no || v.po_no === opts.po_no))
    .sort((a, b) => b.report_date.localeCompare(a.report_date) || b.created_at.localeCompare(a.created_at)));
}

export async function submitQcReport(
  input: QcReportInput, idempotencyKey?: string,
): Promise<Result<{ report_no: string; warnings: string[] }>> {
  await latency();
  const cached = replayed<{ report_no: string; warnings: string[] }>(SERVICE, "submitQcReport", idempotencyKey);
  if (cached) return cached;
  const state = getState();
  const a = state.qc_assignments.find((x) => x.assign_no === input.assign_no?.trim());
  if (!a) return notFound(SERVICE, "qc_assignment_not_found", `Tidak ada penugasan ${input.assign_no}.`);
  if (!(isCoordinator() || a.person_id === myPersonId(state))) {
    return refused(SERVICE, "not_permitted", "Laporan QC dikirim oleh QC yang ditugaskan atau koordinator QC.");
  }
  if (a.cancelled_at) return conflict(SERVICE, "assignment_cancelled", "Penugasan ini sudah dibatalkan.");
  const today = officeToday();
  if (!input.report_date) return invalid(SERVICE, "date_required", "Laporan tanggal berapa?", { field: "report_date" });
  if (input.report_date > today) {
    return invalid(SERVICE, "date_in_future", "Laporan tidak bisa untuk hari yang belum datang.", { field: "report_date" });
  }
  if (input.report_date < a.starts_on || (a.ends_on && input.report_date > a.ends_on)) {
    return invalid(SERVICE, "outside_assignment", `Penugasan ini ${a.starts_on} sampai ${a.ends_on ?? "sekarang"}.`, { field: "report_date" });
  }
  const stage = (input.stage ?? "").toLowerCase() as QcStage;
  if (!QC_STAGES.includes(stage)) {
    return invalid(SERVICE, "unknown_stage", "Tahapnya bahan, konstruksi, finishing, packing, atau muat.", { field: "stage" });
  }
  const lines = input.lines ?? [];
  const onOrder = liveLines(state, a.po_id);
  const off = lines.find((l) => !onOrder.some((o) => o.line_no === l.line_no));
  if (off) return invalid(SERVICE, "line_not_on_order", `Baris ${off.line_no} tidak ada di order ini.`, { field: "lines" });
  if (new Set(lines.map((l) => l.line_no)).size !== lines.length) {
    return invalid(SERVICE, "line_twice", "Satu baris dilaporkan sekali per laporan.", { field: "lines" });
  }
  const bad = lines.find((l) => !(Number.isFinite(l.passed) && l.passed >= 0) || !(Number.isFinite(l.rejected ?? 0) && (l.rejected ?? 0) >= 0));
  if (bad) {
    return invalid(SERVICE, "bad_count", `Baris ${bad.line_no}: jumlah lolos dan ditolak adalah angka, tidak negatif.`, { field: "lines" });
  }
  const over = lines.find((l) => l.passed > onOrder.find((o) => o.line_no === l.line_no)!.qty);
  if (over) {
    return invalid(SERVICE, "passed_over_ordered",
      `Baris ${over.line_no}: lolos ${over.passed}, dipesan ${onOrder.find((o) => o.line_no === over.line_no)!.qty}. Lolos adalah jumlah yang sudah lolos sampai hari ini, tidak lebih dari yang dipesan.`,
      { field: "lines" });
  }
  const warnings: string[] = [];
  let deliveryId: string | null = null;
  if (input.delivery_no?.trim()) {
    if (stage !== "loading") {
      return invalid(SERVICE, "container_only_at_loading", "Kontainer disebut pada laporan tahap muat.", { field: "delivery_no" });
    }
    const d = state.deliveries.find((x) => x.delivery_no === input.delivery_no!.trim() && x.po_id === a.po_id
      && x.delivery_mode === "container" && x.status !== "CANCELLED");
    if (!d) {
      return invalid(SERVICE, "container_not_this_order", `${input.delivery_no.trim()} bukan kontainer dari order ini.`, { field: "delivery_no" });
    }
    deliveryId = d.id;
  } else if (stage === "loading") {
    warnings.push("Laporan muat tanpa kontainer — sebutkan kontainernya setelah logistik mencatatnya.");
  }
  if (missingPhoto(state, input.photo_ids)) {
    return invalid(SERVICE, "no_such_file", "Ada foto yang belum terunggah. Unggah lagi.", { field: "photo_ids" });
  }
  if (!input.photo_ids?.length) warnings.push("Laporan tanpa foto. Foto bisa ditambahkan sesudahnya.");
  const before = lineProgressOf(state, a.po_id);
  if (lines.some((l) => before.some((g) => g.line_no === l.line_no && g.qc_stage === stage && l.passed < (g.passed ?? 0)))) {
    warnings.push("Ada baris yang lolosnya lebih kecil dari laporan sebelumnya di tahap yang sama — lolos adalah jumlah sampai hari ini, bukan tambahan hari ini.");
  }
  const by = actingUser();
  let no = "";
  apply((draft) => {
    no = nextDocNumber(draft, "qcr");
    const id = newId("qcr");
    draft.qc_reports.push({
      id, report_no: no, assignment_id: a.id, report_date: input.report_date, stage, delivery_id: deliveryId,
      note: input.note?.trim() || null, created_by: by.id, created_at: new Date().toISOString(),
      cancelled_at: null, cancel_reason: null,
    });
    for (const l of lines) draft.qc_report_lines.push({ report_id: id, line_no: l.line_no, passed: l.passed, rejected: l.rejected ?? 0 });
    linkPhotos(draft, input.photo_ids ?? [], "qc_report", no, by.id);
    writeAudit(draft, {
      service: SERVICE, entity: "qc_report", entity_no: no, action: "submit", outcome: "ok", reason: null,
      detail: { assign_no: a.assign_no, stage, lines: lines.length, photos: input.photo_ids?.length ?? 0 },
    });
  });
  const result = { report_no: no, warnings };
  remember(SERVICE, "submitQcReport", idempotencyKey, result);
  return ok(SERVICE, result);
}

export async function addQcReportPhotos(input: { report_no: string; photo_ids: string[] }): Promise<Result<{ report_no: string }>> {
  await latency();
  const state = getState();
  const r = state.qc_reports.find((x) => x.report_no === input.report_no);
  if (!r) return notFound(SERVICE, "qc_report_not_found", `Tidak ada laporan ${input.report_no}.`);
  const a = state.qc_assignments.find((x) => x.id === r.assignment_id)!;
  if (!(isCoordinator() || a.person_id === myPersonId(state))) {
    return refused(SERVICE, "not_permitted", "Foto laporan ditambahkan oleh QC yang ditugaskan atau koordinator QC.");
  }
  if (r.cancelled_at) return conflict(SERVICE, "report_cancelled", "Laporan ini sudah ditarik.");
  if (!input.photo_ids?.length) return invalid(SERVICE, "no_photos", "Foto mana?", { field: "photo_ids" });
  if (missingPhoto(state, input.photo_ids)) {
    return invalid(SERVICE, "no_such_file", "Ada foto yang belum terunggah. Unggah lagi.", { field: "photo_ids" });
  }
  const by = actingUser();
  apply((draft) => {
    linkPhotos(draft, input.photo_ids, "qc_report", r.report_no, by.id);
    writeAudit(draft, {
      service: SERVICE, entity: "qc_report", entity_no: r.report_no, action: "add_photos", outcome: "ok", reason: null,
      detail: { photos: input.photo_ids.length },
    });
  });
  return ok(SERVICE, { report_no: r.report_no });
}

export async function cancelQcReport(input: { report_no: string; reason: string }): Promise<Result<{ report_no: string }>> {
  await latency();
  const state = getState();
  const r = state.qc_reports.find((x) => x.report_no === input.report_no);
  if (!r) return notFound(SERVICE, "qc_report_not_found", `Tidak ada laporan ${input.report_no}.`);
  const a = state.qc_assignments.find((x) => x.id === r.assignment_id)!;
  if (!(isCoordinator() || a.person_id === myPersonId(state))) {
    return refused(SERVICE, "not_permitted", "Laporan ditarik oleh QC yang mengirimnya atau koordinator QC.");
  }
  if (r.cancelled_at) return conflict(SERVICE, "already_cancelled", "Laporan ini sudah ditarik.");
  if (!input.reason?.trim()) return invalid(SERVICE, "reason_required", "Kenapa ditarik?", { field: "reason" });
  apply((draft) => {
    const row = draft.qc_reports.find((x) => x.id === r.id)!;
    row.cancelled_at = new Date().toISOString();
    row.cancel_reason = input.reason.trim();
    writeAudit(draft, {
      service: SERVICE, entity: "qc_report", entity_no: r.report_no, action: "cancel", outcome: "ok",
      reason: input.reason.trim(), detail: {},
    });
  });
  return ok(SERVICE, { report_no: r.report_no });
}

/** One report's lines, against what the order asked for. */
export async function listReportLines(reportNo: string): Promise<Result<QcReportLine[]>> {
  await latency();
  const state = getState();
  const r = state.qc_reports.find((x) => x.report_no === reportNo);
  const a = r ? state.qc_assignments.find((x) => x.id === r.assignment_id) : undefined;
  if (!r || !a || !mayReadAssignment(state, a)) return ok(SERVICE, []);
  const order = liveLines(state, a.po_id);
  return ok(SERVICE, state.qc_report_lines
    .filter((x) => x.report_id === r.id)
    .sort((x, y) => x.line_no - y.line_no)
    .map((x) => {
      const o = order.find((l) => l.line_no === x.line_no);
      return { line_no: x.line_no, description: o?.description ?? null, qty: o?.qty ?? null, uom: o?.uom ?? null,
        passed: x.passed, rejected: x.rejected };
    }));
}

/** How far each line of an assignment's order is, by QC's latest count. */
export async function listAssignmentProgress(assignNo: string): Promise<Result<QcLineProgress[]>> {
  await latency();
  const state = getState();
  const a = state.qc_assignments.find((x) => x.assign_no === assignNo);
  if (!a || !mayReadAssignment(state, a)) return ok(SERVICE, []);
  return ok(SERVICE, lineProgressOf(state, a.po_id));
}

/** The containers loaded from an assignment's order, for the loading check. */
export async function listOrderContainers(assignNo: string): Promise<Result<QcOrderContainer[]>> {
  await latency();
  const state = getState();
  const a = state.qc_assignments.find((x) => x.assign_no === assignNo);
  if (!a || !mayReadAssignment(state, a)) return ok(SERVICE, []);
  return ok(SERVICE, state.deliveries
    .filter((d) => d.po_id === a.po_id && d.delivery_mode === "container" && d.status !== "CANCELLED")
    .sort((x, y) => y.dispatched_on.localeCompare(x.dispatched_on) || y.delivery_no.localeCompare(x.delivery_no))
    .map((d) => ({ delivery_no: d.delivery_no, container_no: d.container_no ?? null, container_size: d.container_size ?? null,
      loaded_on: d.dispatched_on, status: d.status })));
}

/** Every finding the reader may see — open first, newest first. */
export async function listQcFindings(
  opts: { po_no?: string; status?: "OPEN" | "RESOLVED" } = {},
): Promise<Result<QcFinding[]>> {
  await latency();
  const state = getState();
  return ok(SERVICE, state.qc_findings
    .filter((f) => maySeeOrder(state, f.po_id))
    .filter((f) => !opts.status || f.status === opts.status)
    .map((f) => findingView(state, f))
    .filter((v) => !opts.po_no || v.po_no === opts.po_no)
    .sort((a, b) => Number(b.status === "OPEN") - Number(a.status === "OPEN") || b.created_at.localeCompare(a.created_at)));
}

export async function raiseQcFinding(
  input: QcFindingInput, idempotencyKey?: string,
): Promise<Result<{ finding_no: string }>> {
  await latency();
  const cached = replayed<{ finding_no: string }>(SERVICE, "raiseQcFinding", idempotencyKey);
  if (cached) return cached;
  const state = getState();
  const po = state.purchase_orders.find((x) => x.po_no === input.po_no?.trim());
  if (!po || !po.project_id) {
    return invalid(SERVICE, "order_unknown", `Tidak ada order pabrik ${input.po_no || "—"}.`, { field: "po_no" });
  }
  if (!["production", "loading", "after_arrival"].includes(input.phase)) {
    return invalid(SERVICE, "unknown_phase", "Fasenya produksi, muat, atau setelah sampai.", { field: "phase" });
  }
  const mine = watching(state, po.id);
  if (input.phase === "after_arrival") {
    if (!(isCoordinator() || holds("project", "write"))) {
      return refused(SERVICE, "not_permitted", "Klaim klien dicatat oleh koordinator QC atau pengelola proyek.");
    }
  } else if (!(isCoordinator() || mine)) {
    return refused(SERVICE, "not_permitted", "Temuan dicatat oleh QC yang memantau order ini atau koordinator QC.");
  }
  if (!["defect", "spec_mismatch", "late", "damaged", "packing", "other"].includes(input.kind)) {
    return invalid(SERVICE, "unknown_kind", "Jenisnya cacat, bahan/spek tidak sesuai, telat, rusak, packing, atau lainnya.", { field: "kind" });
  }
  if (!["minor", "major", "critical"].includes(input.severity)) {
    return invalid(SERVICE, "unknown_severity", "Tingkatnya minor, major, atau kritis.", { field: "severity" });
  }
  if (!input.description?.trim()) return invalid(SERVICE, "description_required", "Apa temuannya?", { field: "description" });
  if (input.line_no != null && !liveLines(state, po.id).some((l) => l.line_no === input.line_no)) {
    return invalid(SERVICE, "line_not_on_order", `Baris ${input.line_no} tidak ada di ${po.po_no}.`, { field: "line_no" });
  }
  let reportId: string | null = null;
  if (input.report_no?.trim()) {
    const r = state.qc_reports.find((x) => x.report_no === input.report_no!.trim()
      && state.qc_assignments.find((a) => a.id === x.assignment_id)?.po_id === po.id);
    if (!r) return invalid(SERVICE, "report_not_this_order", `${input.report_no.trim()} bukan laporan order ini.`, { field: "report_no" });
    reportId = r.id;
  }
  let deliveryId: string | null = null;
  if (input.delivery_no?.trim()) {
    const d = state.deliveries.find((x) => x.delivery_no === input.delivery_no!.trim() && x.po_id === po.id && x.delivery_mode === "container");
    if (!d) return invalid(SERVICE, "container_not_this_order", `${input.delivery_no.trim()} bukan kontainer dari order ini.`, { field: "delivery_no" });
    deliveryId = d.id;
  }
  if (missingPhoto(state, input.photo_ids)) {
    return invalid(SERVICE, "no_such_file", "Ada foto yang belum terunggah. Unggah lagi.", { field: "photo_ids" });
  }
  const by = actingUser();
  let no = "";
  apply((draft) => {
    no = nextDocNumber(draft, "qcf");
    draft.qc_findings.push({
      id: newId("qcf"), finding_no: no, po_id: po.id, assignment_id: mine?.id ?? null, report_id: reportId,
      delivery_id: deliveryId, line_no: input.line_no ?? null, phase: input.phase, finding_kind: input.kind,
      severity: input.severity, description: input.description.trim(), status: "OPEN", resolution: null,
      resolved_at: null, resolved_by: null, created_by: by.id, created_at: new Date().toISOString(),
    });
    linkPhotos(draft, input.photo_ids ?? [], "qc_finding", no, by.id);
    writeAudit(draft, {
      service: SERVICE, entity: "qc_finding", entity_no: no, action: "raise", outcome: "ok", reason: null,
      detail: { po_no: po.po_no, phase: input.phase, kind: input.kind, severity: input.severity, line_no: input.line_no ?? null },
    });
  });
  const result = { finding_no: no };
  remember(SERVICE, "raiseQcFinding", idempotencyKey, result);
  return ok(SERVICE, result);
}

export async function resolveQcFinding(input: { finding_no: string; resolution: string }): Promise<Result<{ finding_no: string }>> {
  await latency();
  const state = getState();
  const f = state.qc_findings.find((x) => x.finding_no === input.finding_no);
  if (!f) return notFound(SERVICE, "qc_finding_not_found", `Tidak ada temuan ${input.finding_no}.`);
  if (!(isCoordinator() || watching(state, f.po_id) || (f.phase === "after_arrival" && holds("project", "write")))) {
    return refused(SERVICE, "not_permitted", "Temuan ditutup oleh QC yang memantau order ini atau koordinator QC.");
  }
  if (f.status === "RESOLVED") return conflict(SERVICE, "already_resolved", "Temuan ini sudah selesai.");
  if (!input.resolution?.trim()) {
    return invalid(SERVICE, "resolution_required", "Apa tindakannya — diperbaiki, diganti, diterima klien?", { field: "resolution" });
  }
  const by = actingUser();
  apply((draft) => {
    const row = draft.qc_findings.find((x) => x.id === f.id)!;
    row.status = "RESOLVED";
    row.resolution = input.resolution.trim();
    row.resolved_at = new Date().toISOString();
    row.resolved_by = by.id;
    writeAudit(draft, {
      service: SERVICE, entity: "qc_finding", entity_no: f.finding_no, action: "resolve", outcome: "ok",
      reason: input.resolution.trim(), detail: {},
    });
  });
  return ok(SERVICE, { finding_no: f.finding_no });
}
