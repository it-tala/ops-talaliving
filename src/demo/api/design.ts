/** A project's design in the demo — the same rules as 0222's seams, over the
 *  store. Stamped `procurement`; checked like `may_design`: project or
 *  marketing (who sells, D375) or production (the drafters).
 */
import { ok, invalid, notFound, noop, refused, type Result } from "@/services/_shared/envelope";
import {
  DESIGN_BOXES, roomCode,
  type DesignApproval, type DesignApprovalInput, type DesignAssignInput, type DesignAssignment, type DesignBox, type DesignBoxKey, type DesignBoxVersion,
  type DesignCollection, type DesignItemInput, type DesignItemView, type DesignProject,
  type DesignRoom, type ProjectDesign,
} from "@/services/design/contracts";
import type { DocKind } from "@/services/documents/contracts";
import { currentBomRev, draftBomRev, productView } from "../production-derive";
import { getState, apply, newId, nextDocNumber, writeAudit } from "../store";
import { latency, actingUser, canDesign, conflict } from "./_kit";
import { officeToday } from "@/lib/office";
import type { DemoState, DemoDesignItem } from "../state";

const SERVICE = "procurement" as const;

const CODE = /^[A-Z0-9]{1,6}$/;
const DESIGN_KINDS = ["Render", "Moodboard", "Layout / Floor Plan", "Gambar Kerja", "Gambar Jadi"];
const DRAWN_KINDS = ["Render", "Layout / Floor Plan", "Gambar Kerja", "Gambar Jadi", "Client Drawing"];
const CLIENT_KINDS = ["Client Drawing", "Client Reference"];

const mayDesign = canDesign;

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
  /* P5 (0225): the latest quotation that went out with it, and the order. */
  const quoted = state.quotation_lines
    .filter((l) => l.design_item_id === i.id)
    .map((l) => ({ l, q: state.quotations.find((x) => x.id === l.quotation_id)! }))
    .filter((x) => x.q.status !== "DRAFT")
    .sort((a, b) => (b.q.sent_at ?? "").localeCompare(a.q.sent_at ?? ""))[0];
  const orders = state.project_lines.filter((l) => l.design_item_id === i.id);
  return {
    ...i,
    product_code: i.product_code ?? orders.find((o) => o.product_code)?.product_code ?? null,
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
    status: i.dropped_at ? "DROPPED" : orders.length ? "ORDERED" : quoted ? "QUOTED"
      : ap?.decision === "approved" ? "APPROVED" : drawn ? "DRAWN" : "CONCEPT",
    quote_no: quoted?.q.quote_no ?? null,
    quote_status: quoted?.q.status ?? null,
    quoted_unit_price: quoted?.l.frozen_unit_price ?? null,
    ordered: orders.length > 0,
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
        approved_count: mine.filter((i) => i.status !== "DROPPED" && i.approval_decision === "approved").length,
        gallery_url: c.gallery_url ?? null,
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

/** The collection's gallery link (a Google Photos album): set, change, or
 *  clear with a blank (0251, D406). */
export async function setDesignCollectionGallery(
  input: { project_code: string; code: string; url: string | null },
): Promise<Result<ProjectDesign>> {
  await latency();
  if (!mayDesign("write")) return denied();
  const state = getState();
  const p = state.projects.find((x) => x.code === input.project_code.trim());
  const code = input.code.trim().toUpperCase();
  const c = p && state.design_collections.find((x) => x.project_id === p.id && x.code === code);
  if (!p || !c) return notFound(SERVICE, "not_found", `Tidak ada koleksi ${input.project_code}-${code}.`);
  const url = input.url?.trim() || null;
  if (url && !/^https?:\/\/\S+$/i.test(url)) {
    return invalid(SERVICE, "bad_url", "Tempel link lengkap yang diawali https://, mis. link album Google Photos.", { field: "url" });
  }
  if ((c.gallery_url ?? null) === url) return noop(SERVICE, design(state, p.code)!);
  apply((draft) => {
    draft.design_collections.find((x) => x.id === c.id)!.gallery_url = url;
    writeAudit(draft, { service: SERVICE, entity: "design_collection", entity_no: `${p.code}-${code}`, action: "set_gallery", outcome: "ok", reason: null });
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
  /* An item taken out can leave the rest of its room complete (0250). */
  if (dropped) {
    const st = getState();
    const it = st.design_items.find((x) => x.item_no === itemNo);
    for (const o of st.design_items.filter((x) => it && x.room_id === it.room_id && !x.dropped_at)) settleDesignTasks(o.item_no);
  }
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

/* ── Studio Desain: six boxes on every item (0248, S1, D399–D405) ──────────
 *
 * The sandbox's reading of `v_design_box`, `v_design_box_version` and
 * `v_design_project`, and of the three seams beside them. */

const BOX_KIND: Record<DesignBoxKey, DocKind | null> = {
  pdf: "Gambar Kerja", dwg: "DWG", render: "Render", foto: "Gambar Jadi", spec: null, bom: null,
};
const userName = (state: DemoState, id: string | null | undefined) => {
  const u = id ? state.users.find((x) => x.id === id) : undefined;
  return u ? u.full_name || u.email : null;
};
/** A version's letter: its place in filing order, kept when an earlier one
 *  is taken off (A, B … Z, Z2 …). */
const letter = (n: number) => (n <= 26 ? String.fromCharCode(64 + n) : `Z${n - 25}`);

function boxVersions(state: DemoState, i: DemoDesignItem, box: DesignBoxKey): DesignBoxVersion[] {
  if (box === "spec") {
    return state.design_item_specs.filter((v) => v.item_id === i.id).sort((a, b) => a.version - b.version)
      .map((v) => ({
        item_no: i.item_no, box, ordinal: v.version, label: String(v.version), at: v.written_at,
        by_name: userName(state, v.written_by), note: v.note, attachment_id: null, filename: null,
        web_view_link: null, body: v.body, removed: false,
      }));
  }
  const kind = BOX_KIND[box];
  if (!kind) return [];
  /* The demo keeps unlinked rows out of `attachment_links` — so a removed
     version is simply absent here, and letters follow what is left. */
  return state.attachment_links
    .filter((l) => l.entity === "design_item" && l.entity_no === i.item_no && l.kind === kind)
    .sort((a, b) => a.linked_at.localeCompare(b.linked_at) || a.id.localeCompare(b.id))
    .map((l, n) => {
      const a = state.attachments.find((x) => x.id === l.attachment_id);
      return {
        item_no: i.item_no, box, ordinal: n + 1, label: letter(n + 1), at: l.linked_at,
        by_name: userName(state, l.linked_by), note: state.design_link_notes[l.id] ?? null,
        attachment_id: l.attachment_id, filename: a?.filename ?? null, web_view_link: a?.web_view_link ?? null,
        body: null, removed: false,
      };
    });
}

function itemBoxes(state: DemoState, i: DemoDesignItem): DesignBox[] {
  const v = itemView(state, i);
  const productCode = v.product_code;
  const product = productCode ? state.products.find((p) => p.product_code === productCode) : undefined;
  const pv = product ? productView(state, product, currentBomRev(state, product)) : null;
  return DESIGN_BOXES.map((b, n) => {
    const versions = boxVersions(state, i, b.key);
    const last = versions[versions.length - 1];
    const skip = state.design_box_skips
      .filter((s) => s.item_id === i.id && s.box === b.key)
      .sort((x, y) => y.set_at.localeCompare(x.set_at))[0];
    const skipped = !!skip?.skipped;
    const bomRev = b.key === "bom" && product ? currentBomRev(state, product) : null;
    const bomDraft = b.key === "bom" && product ? draftBomRev(state, product) : null;
    const filled = b.key === "bom" ? (bomRev ?? bomDraft) != null : versions.length > 0;
    return {
      item_no: i.item_no, item_name: i.name, project_code: v.project_code, collection_code: v.collection_code,
      collection_name: v.collection_name, room_code: v.room_code, room_name: v.room_name, room_sort: v.room_sort, dropped: !!i.dropped_at, box: b.key, sort: n + 1,
      state: filled ? "terisi" : skipped ? "tidak_perlu" : "kosong",
      versions: versions.length,
      latest_label: b.key === "bom" ? (bomRev ?? bomDraft)?.toString() ?? null : last?.label ?? null,
      latest_at: last?.at ?? null, latest_by: last?.by_name ?? null, latest_note: last?.note ?? null,
      latest_attachment_id: last?.attachment_id ?? null, latest_filename: last?.filename ?? null,
      latest_link: last?.web_view_link ?? null, spec_body: last?.body ?? null,
      product_code: productCode,
      bom_rev: bomRev, bom_draft_rev: bomDraft,
      bom_cost: b.key === "bom" && bomRev != null ? pv?.production_cost ?? null : null,
      skip_note: skipped ? skip!.note : null, skip_by: skipped ? userName(state, skip!.set_by) : null,
      skip_at: skipped ? skip!.set_at : null,
    };
  });
}

function itemsOf(state: DemoState, filter: { project_code?: string; item_no?: string }): DemoDesignItem[] {
  return state.design_items.filter((i) => {
    if (filter.item_no) return i.item_no === filter.item_no;
    if (filter.project_code) return i.item_no.startsWith(`${filter.project_code}-`);
    return true;
  });
}

/** The projects a drafter works in: live ones, and any with a design. */
export async function listDesignProjects(): Promise<Result<DesignProject[]>> {
  await latency();
  if (!mayDesign("read")) return ok(SERVICE, []);
  const state = getState();
  const rows = state.projects
    .filter((p) => !["LOST", "CANCELLED", "DONE"].includes(p.status ?? "")
      || state.design_collections.some((c) => c.project_id === p.id))
    .map((p) => {
      const cl = p.client_id ? state.clients.find((x) => x.id === p.client_id) : undefined;
      const cols = state.design_collections.filter((c) => c.project_id === p.id);
      const rooms = state.design_rooms.filter((r) => cols.some((c) => c.id === r.collection_id));
      return {
        project_code: p.code, project_name: p.name, status: p.status ?? "INQUIRY",
        client_code: cl?.code ?? null, client_display: cl?.name ?? p.client_name ?? null,
        target_date: p.target_date ?? null,
        collection_count: cols.length,
        item_count: state.design_items.filter((i) => !i.dropped_at && rooms.some((r) => r.id === i.room_id)).length,
      };
    })
    /* Projects with no client last, as the live view orders them. */
    .sort((a, b) => (a.client_display == null ? 1 : 0) - (b.client_display == null ? 1 : 0)
      || (a.client_display ?? "").localeCompare(b.client_display ?? "") || a.project_code.localeCompare(b.project_code));
  return ok(SERVICE, rows);
}

/** Every box of a project's items, or of one item. */
export async function listDesignBoxes(
  filter: { project_code?: string; item_no?: string },
): Promise<Result<DesignBox[]>> {
  await latency();
  if (!mayDesign("read")) return ok(SERVICE, []);
  const state = getState();
  return ok(SERVICE, itemsOf(state, filter).sort((a, b) => a.item_no.localeCompare(b.item_no))
    .flatMap((i) => itemBoxes(state, i)));
}

/** A box's history, oldest first: every file version, or every spec. */
export async function listDesignBoxVersions(itemNo: string): Promise<Result<DesignBoxVersion[]>> {
  await latency();
  if (!mayDesign("read")) return ok(SERVICE, []);
  const state = getState();
  const i = state.design_items.find((x) => x.item_no === itemNo);
  if (!i) return notFound(SERVICE, "design_item_not_found", `Tidak ada item ${itemNo}.`);
  return ok(SERVICE, DESIGN_BOXES.flatMap((b) => boxVersions(state, i, b.key)));
}

/** The specification, as a new version. The same text again is not one. */
export async function saveDesignSpec(
  input: { item_no: string; body: string; note?: string | null },
): Promise<Result<DesignBox[]>> {
  await latency();
  if (!mayDesign("write")) return denied();
  const state = getState();
  const i = state.design_items.find((x) => x.item_no === input.item_no.trim());
  if (!i) return notFound(SERVICE, "not_found", `Tidak ada item ${input.item_no}.`);
  const body = input.body.trim();
  if (!body) {
    return invalid(SERVICE, "spec_empty",
      "Spesifikasinya masih kosong. Kotak ini boleh dibiarkan kosong, atau ditandai tidak perlu.", { field: "body" });
  }
  const last = state.design_item_specs.filter((v) => v.item_id === i.id).sort((a, b) => b.version - a.version)[0];
  if (last && last.body === body) return noop(SERVICE, itemBoxes(state, i));
  const me = actingUser();
  apply((d) => {
    d.design_item_specs.push({
      id: newId("dsp"), item_id: i.id, version: (last?.version ?? 0) + 1, body,
      note: input.note?.trim() || null, written_by: me.id, written_at: new Date().toISOString(),
    });
    writeAudit(d, { service: SERVICE, entity: "design_item", entity_no: i.item_no, action: "save_spec", outcome: "ok", reason: null });
  });
  settleDesignTasks(i.item_no);
  return ok(SERVICE, itemBoxes(getState(), i));
}

/** A box not needed for this item, or needed again. The note is optional. */
export async function setDesignBoxSkip(
  input: { item_no: string; box: DesignBoxKey; skip: boolean; note?: string | null },
): Promise<Result<DesignBox[]>> {
  await latency();
  if (!mayDesign("write")) return denied();
  if (!DESIGN_BOXES.some((b) => b.key === input.box)) {
    return invalid(SERVICE, "unknown_box", "Kotaknya: pdf, dwg, render, foto, spec, atau bom.", { field: "box" });
  }
  const state = getState();
  const i = state.design_items.find((x) => x.item_no === input.item_no.trim());
  if (!i) return notFound(SERVICE, "not_found", `Tidak ada item ${input.item_no}.`);
  const now = state.design_box_skips.filter((s) => s.item_id === i.id && s.box === input.box)
    .sort((a, b) => b.set_at.localeCompare(a.set_at))[0];
  if ((now?.skipped ?? false) === input.skip) return noop(SERVICE, itemBoxes(state, i));
  const me = actingUser();
  apply((d) => {
    d.design_box_skips.push({
      id: newId("dbs"), item_id: i.id, box: input.box, skipped: input.skip,
      note: input.note?.trim() || null, set_by: me.id, set_at: new Date().toISOString(),
    });
    writeAudit(d, { service: SERVICE, entity: "design_item", entity_no: i.item_no, action: "skip_box", outcome: "ok", reason: null });
  });
  settleDesignTasks(i.item_no);
  return ok(SERVICE, itemBoxes(getState(), i));
}

/** A product (and so a BOM) for an item before it is ordered, so a quotation
 *  can be priced from it (D400). Inactive until an order line names it. */
export async function productFromDesignItem(
  input: { item_no: string; product_code?: string | null; category?: string | null },
): Promise<Result<{ product_code: string; existing: boolean }>> {
  await latency();
  const me = actingUser();
  if (!me.modules.some((m) => m.module === "production" && m.level !== "read")) {
    return refused(SERVICE, "not_permitted",
      "Membuat produk dan BOM butuh akses produksi (create) — minta drafter atau kepala produksi.");
  }
  const state = getState();
  const i = state.design_items.find((x) => x.item_no === input.item_no.trim());
  if (!i) return notFound(SERVICE, "not_found", `Tidak ada item ${input.item_no}.`);
  if (i.product_code) {
    return conflict(SERVICE, "already_product",
      `Item ${i.item_no} sudah punya produk ${i.product_code}. BOM-nya diubah di /produksi/bom.`);
  }
  const code = (input.product_code?.trim() || i.item_no).toUpperCase();
  const existing = state.products.some((p) => p.product_code === code);
  const now = new Date().toISOString();
  apply((d) => {
    if (!existing) {
      d.products.push({
        id: newId("prd"), product_code: code, name: i.name,
        category: input.category?.trim() || "Belum dikategorikan", uom: "pcs", description: null,
        length_mm: i.length_mm == null ? null : Math.round(i.length_mm),
        width_mm: i.width_mm == null ? null : Math.round(i.width_mm),
        height_mm: i.height_mm == null ? null : Math.round(i.height_mm),
        dimension_note: null, lead_time_days: null, stages: null, labour_cost: null, labour_note: null,
        active: false, note: `Dari desain ${i.item_no}, belum dipesan.`, created_at: now, updated_at: now,
      } as DemoState["products"][number]);
      d.design_products[code] = i.item_no;
    }
    const it = d.design_items.find((x) => x.id === i.id)!;
    it.product_code = code;
    it.updated_at = now;
    writeAudit(d, { service: SERVICE, entity: "product", entity_no: code, action: "from_design_item", outcome: "ok", reason: null });
  });
  return ok(SERVICE, { product_code: code, existing });
}

/* ── Studio Desain S2: a room or an item given out as an HRD task (0250) ───
 *
 * The sandbox's `assign_design_task`, `settle_design_tasks` and
 * `design_assignments`. The task is a row in `state.tasks`, the same one HRD
 * reads; the bell follows from the store (`notifyTasks`). */

const roomOf = (state: DemoState, i: DemoDesignItem) => {
  const v = itemView(state, i);
  return roomCode(v.project_code, v.collection_code, v.room_code);
};

/** Filled / total for a room (`26003-A-LR`) or an item; dropped items do not
 *  count. */
function scopeBoxes(state: DemoState, scope: "room" | "item", ref: string): { filled: number; total: number } {
  const items = state.design_items.filter((i) => !i.dropped_at
    && (scope === "item" ? i.item_no === ref : roomOf(state, i) === ref));
  const boxes = items.flatMap((i) => itemBoxes(state, i));
  return { filled: boxes.filter((b) => b.state !== "kosong").length, total: boxes.length };
}

/** Filled / total for a room or an item, read now — for HRD's task list. */
export function designScopeProgress(scope: "room" | "item", ref: string) {
  return scopeBoxes(getState(), scope, ref);
}

function assignmentRows(state: DemoState, projectCode?: string | null): DesignAssignment[] {
  return state.tasks
    .filter((t) => (t.ref_kind === "design_room" || t.ref_kind === "design_item") && t.status !== "CANCELLED"
      && (!projectCode || (t.ref_no ?? "").split("-")[0] === projectCode))
    .map((t) => {
      const ref = t.ref_no ?? "";
      const [p, c, r] = ref.split("-");
      const scope = t.ref_kind === "design_room" ? "room" as const : "item" as const;
      const emp = state.employees.find((e) => e.id === t.assignee_id);
      return {
        task_no: t.task_no, scope, ref_no: ref, project_code: p, collection_code: c, room_code: r,
        item_no: scope === "item" ? ref : null,
        assignee_no: emp?.employee_no ?? "", assignee_name: emp?.full_name ?? "",
        due_date: t.due_date, status: t.status, assigned_at: t.assigned_at, done_at: t.done_at,
        blocked_reason: t.blocked_reason, ...scopeBoxes(state, scope, ref),
      };
    })
    .sort((a, b) => Number(a.status === "DONE") - Number(b.status === "DONE")
      || a.due_date.localeCompare(b.due_date) || a.task_no.localeCompare(b.task_no));
}

/** The tasks given out from Design, for a project or for all. */
export async function listDesignAssignments(projectCode?: string | null): Promise<Result<DesignAssignment[]>> {
  await latency();
  if (!mayDesign("read")) return ok(SERVICE, []);
  return ok(SERVICE, assignmentRows(getState(), projectCode));
}

/** Give a room or an item to a drafter as an HRD task, or move the open one. */
export async function assignDesignTask(input: DesignAssignInput): Promise<Result<DesignAssignment[]>> {
  await latency();
  if (!mayDesign("write")) {
    return refused(SERVICE, "not_permitted", "Menugaskan pekerjaan desain butuh akses proyek, marketing, atau produksi (update).");
  }
  const state = getState();
  const ref = input.ref_no.trim().toUpperCase();
  const project = ref.split("-")[0];
  let title = "";
  if (input.scope === "room") {
    const room = state.design_rooms.find((r) => {
      const c = state.design_collections.find((x) => x.id === r.collection_id);
      const p = c && state.projects.find((x) => x.id === c.project_id);
      return p && c && roomCode(p.code, c.code, r.code) === ref;
    });
    if (!room) return notFound(SERVICE, "not_found", `Tidak ada ruangan ${ref}.`);
    const n = state.design_items.filter((i) => i.room_id === room.id && !i.dropped_at).length;
    title = `Desain ${ref} ${room.name} — ${n} item`;
  } else if (input.scope === "item") {
    const i = state.design_items.find((x) => x.item_no === ref);
    if (!i) return notFound(SERVICE, "not_found", `Tidak ada item ${ref}.`);
    if (i.dropped_at) return invalid(SERVICE, "item_dropped", "Item ini sudah dikeluarkan dari desain.", { field: "ref" });
    title = `Desain ${ref} ${i.name}`;
  } else {
    return invalid(SERVICE, "unknown_scope", "Yang ditugaskan: room (ruangan) atau item.", { field: "scope" });
  }
  const emp = state.employees.find((e) => e.employee_no === input.assignee_no && e.active);
  if (!emp) return invalid(SERVICE, "assignee_unknown", "Siapa drafternya? Pilih karyawan yang masih aktif.", { field: "assignee_no" });
  if (!input.due_date) return invalid(SERVICE, "due_required", "Tenggatnya kapan?", { field: "due_date" });
  if (input.due_date < officeToday()) return invalid(SERVICE, "due_in_past", "Tenggat tidak boleh sebelum hari ini.", { field: "due_date" });

  const kind = input.scope === "room" ? "design_room" : "design_item";
  const open = state.tasks.find((t) => t.ref_kind === kind && t.ref_no === ref && t.status === "OPEN");
  const user = actingUser();
  if (open) {
    if (open.assignee_id === emp.id && open.due_date === input.due_date) return noop(SERVICE, assignmentRows(state, project));
    apply((d) => {
      const t = d.tasks.find((x) => x.id === open.id)!;
      if (t.assignee_id !== emp.id) t.acknowledged_at = null;
      t.assignee_id = emp.id;
      t.due_date = input.due_date;
      t.title = title;
      if (input.note?.trim()) t.detail = input.note.trim();
      if (t.chase_date && t.chase_date > input.due_date) t.chase_date = null;
      writeAudit(d, { service: SERVICE, entity: "design_task", entity_no: t.task_no, action: "reassign", outcome: "ok", reason: null });
    });
    return ok(SERVICE, assignmentRows(getState(), project));
  }
  const prog = scopeBoxes(state, input.scope, ref);
  if (prog.total === 0) return invalid(SERVICE, "nothing_to_do", "Belum ada item di sini. Tambah itemnya dulu, lalu tugaskan.", { field: "ref" });
  if (prog.filled === prog.total) {
    return invalid(SERVICE, "already_complete",
      `Semua kotak sudah terisi (${prog.filled}/${prog.total}) — tidak ada yang perlu dikerjakan.`, { field: "ref" });
  }
  apply((d) => {
    const no = nextDocNumber(d, "tgs");
    d.tasks.push({
      id: newId("tsk"), task_no: no, title, detail: input.note?.trim() || null,
      assignee_id: emp.id, assigned_by: user.id, assigned_at: new Date().toISOString(),
      due_date: input.due_date, ref_kind: kind, ref_no: ref, status: "OPEN",
      done_at: null, done_by: null, blocked_reason: null, blocked_at: null, cancelled_reason: null,
      period_start: null, period_end: null, chase_date: null,
      deliverable: "Semua kotak terisi: gambar kerja PDF, DWG, render, foto item, spesifikasi, BOM — atau ditandai tidak perlu. Selesai sendiri.",
      delivered_note: null, acknowledged_at: null, chased_at: null, chased_by: null, chase_note: null,
      routine_id: null, goal_id: null, waits_on: null, started_at: null,
    });
    writeAudit(d, { service: SERVICE, entity: "design_task", entity_no: no, action: "assign", outcome: "ok", reason: null });
  });
  return ok(SERVICE, assignmentRows(getState(), project));
}

/** Close every open task this item belongs to — its room's and its own — once
 *  its scope has no empty box (D403). Called after anything that can fill the
 *  last box: a file, a spec, *not needed*, a dropped item, a BOM revision. */
export function settleDesignTasks(itemNo: string) {
  const state = getState();
  const item = state.design_items.find((i) => i.item_no === itemNo);
  if (!item) return;
  const room = roomOf(state, item);
  const done = state.tasks.filter((t) => t.status === "OPEN"
    && ((t.ref_kind === "design_room" && t.ref_no === room) || (t.ref_kind === "design_item" && t.ref_no === itemNo)))
    .map((t) => ({ t, p: scopeBoxes(state, t.ref_kind === "design_room" ? "room" : "item", t.ref_no ?? "") }))
    .filter(({ p }) => p.total > 0 && p.filled === p.total);
  if (done.length === 0) return;
  const me = actingUser();
  apply((d) => {
    for (const { t, p } of done) {
      const row = d.tasks.find((x) => x.id === t.id)!;
      row.status = "DONE";
      row.done_at = new Date().toISOString();
      row.done_by = me.id;
      row.delivered_note = `Semua kotak terisi (${p.filled}/${p.total}) — selesai sendiri dari Desain.`;
    }
  });
}

/** Every item a product belongs to, settled: its BOM may be the last box. */
export function settleDesignTasksForProduct(productCode: string) {
  const state = getState();
  for (const i of state.design_items) {
    if (i.product_code === productCode
        || state.project_lines.some((l) => l.design_item_id === i.id && l.product_code === productCode)) {
      settleDesignTasks(i.item_no);
    }
  }
}
