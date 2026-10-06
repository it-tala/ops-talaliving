/** A project's design in the demo — the same rules as 0222's seams, over the
 *  store. Stamped `procurement`; checked like `may_design`: project or
 *  marketing (who sells, D375) or production (the drafters).
 */
import { ok, invalid, notFound, noop, refused, type Result } from "@/services/_shared/envelope";
import type {
  DesignApproval, DesignApprovalInput, DesignCollection, DesignItemInput, DesignItemView,
  DesignRoom, ProjectDesign,
} from "@/services/design/contracts";
import { getState, apply, newId, writeAudit } from "../store";
import { latency, actingUser } from "./_kit";
import { officeToday } from "@/lib/office";
import type { DemoState, DemoDesignItem } from "../state";

const SERVICE = "procurement" as const;

const CODE = /^[A-Z0-9]{1,6}$/;
const DESIGN_KINDS = ["Render", "Moodboard", "Layout / Floor Plan", "Gambar Kerja", "Gambar Jadi"];
const DRAWN_KINDS = ["Render", "Layout / Floor Plan", "Gambar Kerja", "Gambar Jadi", "Client Drawing"];
const CLIENT_KINDS = ["Client Drawing", "Client Reference"];

function mayDesign(level: "read" | "write"): boolean {
  const rank = { read: 0, write: 1, admin: 2 } as const;
  return actingUser().modules.some((m) =>
    (m.module === "project" || m.module === "marketing" || m.module === "production")
    && rank[m.level] >= rank[level]);
}

function denied() {
  return refused(SERVICE, "not_permitted", "Mengubah desain butuh akses proyek, marketing, atau produksi (update).");
}

function itemView(state: DemoState, i: DemoDesignItem): DesignItemView {
  const r = state.design_rooms.find((x) => x.id === i.room_id)!;
  const c = state.design_collections.find((x) => x.id === r.collection_id)!;
  const p = state.projects.find((x) => x.id === c.project_id)!;
  const cl = p.client_id ? state.clients.find((x) => x.id === p.client_id) : undefined;
  const links = state.attachment_links.filter((l) => l.entity === "design_item" && l.entity_no === i.item_no);
  const ap = state.design_approvals
    .filter((a) => a.item_id === i.id)
    .sort((a, b) => b.recorded_at.localeCompare(a.recorded_at))[0];
  const drawn = links.some((l) => DRAWN_KINDS.includes(l.kind));
  return {
    ...i,
    room_code: r.code, room_name: r.name, room_sort: r.sort,
    collection_code: c.code, collection_name: c.name,
    project_code: p.code, project_name: p.name,
    client_code: cl?.code ?? null, client_display: cl?.name ?? p.client_name,
    design_files: links.filter((l) => DESIGN_KINDS.includes(l.kind)).length,
    client_files: links.filter((l) => CLIENT_KINDS.includes(l.kind)).length,
    all_files: links.length,
    approval_decision: ap?.decision ?? null,
    approval_on: ap?.decided_on ?? null,
    approval_channel: ap?.channel ?? null,
    approval_by: ap?.client_person ?? null,
    status: i.dropped_at ? "DROPPED" : ap?.decision === "approved" ? "APPROVED" : drawn ? "DRAWN" : "CONCEPT",
  };
}

function design(state: DemoState, projectCode: string): ProjectDesign | null {
  const p = state.projects.find((x) => x.code === projectCode);
  if (!p) return null;
  const cols = state.design_collections.filter((c) => c.project_id === p.id);
  const rooms = state.design_rooms.filter((r) => cols.some((c) => c.id === r.collection_id));
  const items = state.design_items
    .filter((i) => rooms.some((r) => r.id === i.room_id))
    .map((i) => itemView(state, i))
    .sort((a, b) => a.item_no.localeCompare(b.item_no));
  const collections: DesignCollection[] = cols
    .map((c) => {
      const mine = items.filter((i) => i.collection_code === c.code);
      return {
        id: c.id, code: c.code, name: c.name, note: c.note, created_at: c.created_at,
        project_code: p.code, project_name: p.name,
        room_count: rooms.filter((r) => r.collection_id === c.id).length,
        item_count: mine.filter((i) => i.status !== "DROPPED").length,
        approved_count: mine.filter((i) => i.status === "APPROVED").length,
      };
    })
    .sort((a, b) => a.code.localeCompare(b.code));
  const roomViews: DesignRoom[] = rooms
    .map((r) => ({
      id: r.id, code: r.code, name: r.name, sort: r.sort,
      collection_code: cols.find((c) => c.id === r.collection_id)!.code,
      project_code: p.code,
      item_count: items.filter((i) => i.room_code === r.code
        && i.collection_code === cols.find((c) => c.id === r.collection_id)!.code && i.status !== "DROPPED").length,
    }))
    .sort((a, b) => a.sort - b.sort);
  return { collections, rooms: roomViews, items };
}

export async function getProjectDesign(projectCode: string): Promise<Result<ProjectDesign>> {
  await latency();
  if (!mayDesign("read")) return ok(SERVICE, { collections: [], rooms: [], items: [] });
  const d = design(getState(), projectCode);
  if (!d) return notFound(SERVICE, "project_not_found", `Tidak ada proyek ${projectCode}.`);
  return ok(SERVICE, d);
}

export async function getDesignItem(itemNo: string): Promise<Result<DesignItemView>> {
  await latency();
  const state = getState();
  const i = state.design_items.find((x) => x.item_no === itemNo);
  if (!i || !mayDesign("read")) return notFound(SERVICE, "design_item_not_found", `Tidak ada item ${itemNo}.`);
  return ok(SERVICE, itemView(state, i));
}

export async function listDesignApprovals(itemNo: string): Promise<Result<DesignApproval[]>> {
  await latency();
  const state = getState();
  const i = state.design_items.find((x) => x.item_no === itemNo);
  if (!i || !mayDesign("read")) return ok(SERVICE, []);
  const file = (id: string | null) => (id ? state.attachments.find((a) => a.id === id)?.filename ?? null : null);
  return ok(SERVICE, state.design_approvals
    .filter((a) => a.item_id === i.id)
    .sort((a, b) => b.recorded_at.localeCompare(a.recorded_at))
    .map((a) => {
      const u = state.users.find((x) => x.id === a.recorded_by);
      return {
        id: a.id, item_no: i.item_no, decision: a.decision, decided_on: a.decided_on, channel: a.channel,
        client_person: a.client_person, note: a.note,
        attachment_id: a.attachment_id, attachment_filename: file(a.attachment_id),
        evidence_attachment_id: a.evidence_attachment_id, evidence_filename: file(a.evidence_attachment_id),
        recorded_by_name: u ? (u.full_name || u.email) : null, recorded_at: a.recorded_at,
      };
    }));
}

export async function saveDesignCollection(
  input: { project_code: string; code: string; name: string; note?: string | null },
): Promise<Result<ProjectDesign>> {
  await latency();
  if (!mayDesign("write")) return denied();
  const state = getState();
  const p = state.projects.find((x) => x.code === input.project_code.trim());
  if (!p) return notFound(SERVICE, "not_found", `Tidak ada proyek ${input.project_code}.`);
  const code = input.code.trim().toUpperCase();
  if (!CODE.test(code)) {
    return invalid(SERVICE, "bad_code", "Kode koleksi 1–6 huruf atau angka, mis. A, B, KAT1. Kode ini masuk ke nomor setiap item.", { field: "code" });
  }
  if (!input.name.trim()) return invalid(SERVICE, "name_required", "Koleksinya dinamai apa? mis. TYPE 2BR.", { field: "name" });
  apply((draft) => {
    const had = draft.design_collections.find((c) => c.project_id === p.id && c.code === code);
    if (had) { had.name = input.name.trim(); had.note = input.note?.trim() || null; }
    else {
      draft.design_collections.push({
        id: newId("dc"), project_id: p.id, code, name: input.name.trim(),
        note: input.note?.trim() || null, created_at: new Date().toISOString(),
      });
    }
    writeAudit(draft, { service: SERVICE, entity: "design_collection", entity_no: `${p.code}-${code}`, action: had ? "update" : "create", outcome: "ok", reason: null });
  });
  return ok(SERVICE, design(getState(), p.code)!);
}

export async function saveDesignRoom(
  input: { project_code: string; collection_code: string; code: string; name: string; sort?: number | null },
): Promise<Result<ProjectDesign>> {
  await latency();
  if (!mayDesign("write")) return denied();
  const state = getState();
  const p = state.projects.find((x) => x.code === input.project_code.trim());
  const c = p && state.design_collections.find((x) => x.project_id === p.id && x.code === input.collection_code.trim().toUpperCase());
  if (!p || !c) return notFound(SERVICE, "not_found", `Tidak ada koleksi ${input.project_code}-${input.collection_code}.`);
  const code = input.code.trim().toUpperCase();
  if (!CODE.test(code)) {
    return invalid(SERVICE, "bad_code", "Kode ruangan 1–6 huruf atau angka, mis. LR, MB, DN. Kode ini masuk ke nomor setiap item.", { field: "code" });
  }
  if (!input.name.trim()) return invalid(SERVICE, "name_required", "Ruangannya apa? mis. Living room.", { field: "name" });
  apply((draft) => {
    const had = draft.design_rooms.find((r) => r.collection_id === c.id && r.code === code);
    if (had) { had.name = input.name.trim(); had.sort = input.sort ?? had.sort; }
    else {
      const sorts = draft.design_rooms.filter((r) => r.collection_id === c.id).map((r) => r.sort);
      draft.design_rooms.push({
        id: newId("dr"), collection_id: c.id, code, name: input.name.trim(),
        sort: input.sort ?? (sorts.length ? Math.max(...sorts) + 1 : 1),
      });
    }
  });
  return ok(SERVICE, design(getState(), p.code)!);
}

export async function saveDesignItem(input: DesignItemInput): Promise<Result<DesignItemView>> {
  await latency();
  if (!mayDesign("write")) return denied();
  const name = input.name.trim();
  if (!name) return invalid(SERVICE, "name_required", "Itemnya apa? mis. Sofa 3 seater.", { field: "name" });
  if (!(input.qty > 0)) return invalid(SERVICE, "qty_required", "Berapa unit?", { field: "qty" });
  if (!["tala", "client", "adapted"].includes(input.origin)) {
    return invalid(SERVICE, "unknown_origin", "Siapa yang mendesain: tala, client, atau adapted (dari referensi klien)?", { field: "origin" });
  }
  for (const v of [input.length_mm, input.width_mm, input.height_mm]) {
    if (v != null && !(v > 0)) return invalid(SERVICE, "bad_size", "Ukuran dalam mm, lebih dari nol — atau kosongkan.", { field: "length_mm" });
  }
  const state = getState();
  const now = new Date().toISOString();
  if (input.item_no) {
    const i = state.design_items.find((x) => x.item_no === input.item_no);
    if (!i) return notFound(SERVICE, "not_found", `Tidak ada item ${input.item_no}.`);
    apply((draft) => {
      const row = draft.design_items.find((x) => x.id === i.id)!;
      Object.assign(row, {
        name, qty: input.qty, origin: input.origin,
        length_mm: input.length_mm ?? null, width_mm: input.width_mm ?? null, height_mm: input.height_mm ?? null,
        note: input.note?.trim() || null, updated_at: now,
      });
    });
    return getDesignItem(i.item_no);
  }
  const p = state.projects.find((x) => x.code === input.project_code.trim());
  const c = p && state.design_collections.find((x) => x.project_id === p.id && x.code === input.collection_code.trim().toUpperCase());
  const r = c && state.design_rooms.find((x) => x.collection_id === c.id && x.code === input.room_code.trim().toUpperCase());
  if (!p || !c || !r) {
    return notFound(SERVICE, "not_found", `Tidak ada ruangan ${input.project_code}-${input.collection_code}-${input.room_code}.`);
  }
  const seq = Math.max(0, ...state.design_items.filter((x) => x.room_id === r.id).map((x) => x.seq)) + 1;
  const itemNo = `${p.code}-${c.code}-${r.code}-${String(seq).padStart(2, "0")}`;
  apply((draft) => {
    draft.design_items.push({
      id: newId("di"), item_no: itemNo, room_id: r.id, seq, name, qty: input.qty,
      length_mm: input.length_mm ?? null, width_mm: input.width_mm ?? null, height_mm: input.height_mm ?? null,
      origin: input.origin, product_code: null, note: input.note?.trim() || null,
      dropped_at: null, drop_reason: null, created_at: now, updated_at: now,
    });
    writeAudit(draft, { service: SERVICE, entity: "design_item", entity_no: itemNo, action: "create", outcome: "ok", reason: null });
  });
  return getDesignItem(itemNo);
}

export async function setDesignItemDropped(
  itemNo: string, dropped: boolean, reason?: string | null,
): Promise<Result<DesignItemView>> {
  await latency();
  if (!mayDesign("write")) return denied();
  const state = getState();
  const i = state.design_items.find((x) => x.item_no === itemNo);
  if (!i) return notFound(SERVICE, "not_found", `Tidak ada item ${itemNo}.`);
  if (!!i.dropped_at === dropped) return noop(SERVICE, itemView(state, i));
  if (dropped && !reason?.trim()) {
    return invalid(SERVICE, "reason_required", "Kenapa item ini dikeluarkan dari desain? Satu kalimat.", { field: "reason" });
  }
  apply((draft) => {
    const row = draft.design_items.find((x) => x.id === i.id)!;
    row.dropped_at = dropped ? new Date().toISOString() : null;
    row.drop_reason = dropped ? reason!.trim() : null;
  });
  return getDesignItem(itemNo);
}

export async function recordDesignApproval(input: DesignApprovalInput): Promise<Result<DesignItemView>> {
  await latency();
  if (!mayDesign("write")) {
    return refused(SERVICE, "not_permitted", "Mencatat persetujuan klien butuh akses proyek, marketing, atau produksi (update).");
  }
  const state = getState();
  const i = state.design_items.find((x) => x.item_no === input.item_no);
  if (!i) return notFound(SERVICE, "not_found", `Tidak ada item ${input.item_no}.`);
  if (!["approved", "withdrawn"].includes(input.decision)) {
    return invalid(SERVICE, "unknown_decision", "Disetujui (approved) atau ditarik kembali (withdrawn)?", { field: "decision" });
  }
  if (!input.decided_on || input.decided_on > officeToday()) {
    return invalid(SERVICE, "bad_date", "Tanggal persetujuan tidak boleh kosong atau di masa depan.", { field: "decided_on" });
  }
  if (!input.client_person.trim()) {
    return invalid(SERVICE, "client_person_required", "Siapa di pihak klien yang menyetujui?", { field: "client_person" });
  }
  if (input.attachment_id && !state.attachment_links.some((l) =>
    l.attachment_id === input.attachment_id && l.entity === "design_item" && l.entity_no === i.item_no)) {
    return invalid(SERVICE, "file_not_on_item", "File yang disetujui harus file item ini. Unggah dulu render atau gambarnya ke item.", { field: "attachment_id" });
  }
  apply((draft) => {
    draft.design_approvals.push({
      id: newId("da"), item_id: i.id, decision: input.decision, decided_on: input.decided_on,
      channel: input.channel, client_person: input.client_person.trim(),
      attachment_id: input.attachment_id ?? null, evidence_attachment_id: input.evidence_attachment_id ?? null,
      note: input.note?.trim() || null, recorded_by: actingUser().id, recorded_at: new Date().toISOString(),
    });
    writeAudit(draft, { service: SERVICE, entity: "design_approval", entity_no: i.item_no, action: input.decision, outcome: "ok", reason: null });
  });
  return getDesignItem(i.item_no);
}
