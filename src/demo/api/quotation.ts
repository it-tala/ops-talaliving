/** The quotation in the demo — the same rules as 0133's seams, over the store.
 *
 *  A draft prices every line live from the product's **released** BOM, never
 *  the open draft; sending freezes the figures; a revision copies the lines and
 *  supersedes what was sent; acceptance writes the order lines at the quoted
 *  price, once, and moves the project to DEAL. The price itself is
 *  `quotePrice`, the one function both sides share.
 *
 *  Envelopes are stamped `procurement`, where projects live; the module the
 *  permission is checked against is `project`.
 */
import { ok, invalid, notFound, type Result } from "@/services/_shared/envelope";
import type {
  Quotation, QuotationDetail, QuotationInput, QuotationLine, QuotationLineInput,
  QuotationLineView, QuotationView,
} from "@/services/quotation/contracts";
import { pctOk, quotePrice, roundHalfAway } from "@/services/quotation/pricing";
import type { ProjectStatus } from "@/services/procurement/contracts";
import { getState, apply, newId, nextDocNumber, writeAudit } from "../store";
import { bomCost, currentBomRev } from "../production-derive";
import { latency, actingUser, requireLevel, conflict, replayed, remember } from "./_kit";
import { officeToday } from "@/lib/office";
import type { DemoState } from "../state";

const SERVICE = "procurement" as const;

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** `project.update`: the level that edits a project also sees cost. */
function seesCost(): boolean {
  return actingUser().modules.some((m) => m.module === "project" && (m.level === "write" || m.level === "admin"));
}

/** What one unit costs at the released revision — `ops_procure.released_cost`. */
function releasedCost(state: DemoState, code: string | null): { exists: boolean; cost: number | null; rev: number | null; lead: number | null } {
  const p = code ? state.products.find((x) => x.product_code === code) : undefined;
  if (!p) return { exists: false, cost: null, rev: null, lead: null };
  const rev = currentBomRev(state, p);
  return {
    exists: true,
    cost: rev == null ? null : bomCost(state, p, rev).production_cost,
    rev,
    lead: p.lead_time_days ?? null,
  };
}

function lineView(state: DemoState, q: Quotation, l: QuotationLine, see: boolean): QuotationLineView {
  const r = releasedCost(state, l.product_code);
  const draft = q.status === "DRAFT";
  const mkt = l.marketing_pct ?? q.marketing_pct;
  const ovh = l.overhead_pct ?? q.overhead_pct;
  const mrg = l.margin_pct ?? q.margin_pct;
  const cost = draft ? (l.manual_unit_cost ?? (r.rev != null ? r.cost : null)) : l.frozen_unit_cost;
  const source = draft
    ? (l.manual_unit_cost != null ? "manual" : r.rev != null && r.cost != null ? "bom" : null)
    : l.frozen_cost_source;
  const computed = quotePrice(cost, mkt, ovh, mrg);
  return {
    id: l.id, quotation_id: q.id, quote_no: q.quote_no, status: q.status,
    line_no: l.line_no, product_code: l.product_code, description: l.description,
    qty: l.qty, uom: l.uom,
    lead_time_days: l.lead_time_days ?? r.lead,
    product_exists: r.exists,
    note: l.note,
    cost_is_manual: l.manual_unit_cost != null,
    cost_missing: cost == null,
    cost_visible: see,
    unit_cost: see ? cost : null,
    cost_source: see ? source : null,
    bom_rev: draft ? r.rev : l.frozen_bom_rev,
    marketing_pct: see ? (draft ? mkt : l.frozen_marketing_pct) : null,
    overhead_pct: see ? (draft ? ovh : l.frozen_overhead_pct) : null,
    margin_pct: see ? (draft ? mrg : l.frozen_margin_pct) : null,
    pct_overridden: l.marketing_pct != null || l.overhead_pct != null || l.margin_pct != null,
    computed_unit_price: see ? computed : null,
    unit_price_override: l.unit_price_override,
    unit_price: draft ? (l.unit_price_override ?? computed) : l.frozen_unit_price,
    line_lead_time_days: l.lead_time_days,
    manual_unit_cost: see ? l.manual_unit_cost : null,
    line_marketing_pct: see ? l.marketing_pct : null,
    line_overhead_pct: see ? l.overhead_pct : null,
    line_margin_pct: see ? l.margin_pct : null,
  };
}

function linesOf(state: DemoState, q: Quotation, see: boolean): QuotationLineView[] {
  return state.quotation_lines
    .filter((l) => l.quotation_id === q.id)
    .sort((a, b) => a.line_no - b.line_no)
    .map((l) => lineView(state, q, l, see));
}

function quotationView(state: DemoState, q: Quotation, see: boolean, today: string): QuotationView {
  const p = state.projects.find((x) => x.id === q.project_id)!;
  const c = p.client_id ? state.clients.find((x) => x.id === p.client_id) : undefined;
  const lines = linesOf(state, q, see);
  const subtotal = lines.length === 0 || lines.some((l) => l.unit_price == null)
    ? null : lines.reduce((a, l) => a + (l.unit_price ?? 0) * l.qty, 0);
  const costTotal = lines.length === 0 || lines.some((l) => l.unit_cost == null)
    ? null : lines.reduce((a, l) => a + (l.unit_cost ?? 0) * l.qty, 0);
  const vatAmount = q.vat && subtotal != null ? roundHalfAway(subtotal * q.vat_pct / 100) : null;
  const leads = lines.map((l) => l.lead_time_days).filter((d): d is number => d != null);
  return {
    ...q,
    project_code: p.code,
    project_name: p.name,
    client_name: c?.name ?? p.client_name,
    client_code: c?.code ?? null,
    client_contact: c?.contact_name ?? null,
    client_address: c?.address ?? null,
    location: p.location,
    line_count: lines.length,
    lines_without_cost: lines.filter((l) => l.cost_missing).length,
    subtotal,
    vat_amount: vatAmount,
    grand_total: subtotal == null ? null : subtotal + (vatAmount ?? 0),
    cost_total: see ? costTotal : null,
    max_lead_time_days: leads.length ? Math.max(...leads) : null,
    expired: q.status === "SENT" && q.valid_until != null && q.valid_until < today,
    is_current: (q.status === "DRAFT" || q.status === "SENT")
      && !state.quotations.some((n) => n.supersedes_id === q.id),
  };
}

function view(quoteNo: string): QuotationView | null {
  const state = getState();
  const q = state.quotations.find((x) => x.quote_no === quoteNo);
  return q ? quotationView(state, q, seesCost(), officeToday()) : null;
}

/** The project moves forward and says why — `project_status_log`. */
function moveProject(draft: DemoState, projectId: string, to: ProjectStatus, from: ProjectStatus[], reason: string, by: string) {
  const p = draft.projects.find((x) => x.id === projectId);
  if (!p) return;
  const now = (p.status ?? (p.is_active ? "IN_PRODUCTION" : "DONE")) as ProjectStatus;
  if (!from.includes(now)) return;
  p.status = to;
  p.status_changed_at = new Date().toISOString();
  p.is_active = true;
  draft.project_status_log.push({
    project_id: p.id, from_status: now, to_status: to, reason, changed_by: by, changed_at: new Date().toISOString(),
  });
}

const notDraft = (q: Quotation, what: string) =>
  conflict(SERVICE, "not_draft", `${q.quote_no} sudah ${q.status}. ${what}`);

/* ── Reading ──────────────────────────────────────────────────────────── */

export async function listQuotations(
  filter: { project_code?: string } = {},
): Promise<Result<QuotationView[]>> {
  await latency();
  const state = getState();
  const see = seesCost();
  const today = officeToday();
  const project = filter.project_code ? state.projects.find((p) => p.code === filter.project_code) : undefined;
  if (filter.project_code && !project) return ok(SERVICE, []);
  return ok(SERVICE, state.quotations
    .filter((q) => !project || q.project_id === project.id)
    .map((q) => quotationView(state, q, see, today))
    .sort((a, b) => b.created_at.localeCompare(a.created_at)));
}

export async function getQuotation(quoteNo: string): Promise<Result<QuotationDetail>> {
  await latency();
  const state = getState();
  const q = state.quotations.find((x) => x.quote_no === quoteNo);
  if (!q) return notFound(SERVICE, "quotation_not_found", `Tidak ada quotation ${quoteNo}.`);
  const see = seesCost();
  const today = officeToday();
  return ok(SERVICE, {
    quotation: quotationView(state, q, see, today),
    lines: linesOf(state, q, see),
    revisions: state.quotations
      .filter((x) => x.project_id === q.project_id)
      .sort((a, b) => b.rev - a.rev)
      .map((x) => {
        const v = quotationView(state, x, see, today);
        return { quote_no: x.quote_no, rev: x.rev, status: x.status, sent_at: x.sent_at, grand_total: v.grand_total };
      }),
  });
}

/* ── Writing ──────────────────────────────────────────────────────────── */

/** Create one for a project (one draft at a time), or change a draft's terms. */
export async function saveQuotation(input: QuotationInput, idempotencyKey?: string): Promise<Result<QuotationView>> {
  await latency();
  const cached = replayed<QuotationView>(SERVICE, "saveQuotation", idempotencyKey);
  if (cached) return cached;
  if (![input.marketing_pct, input.overhead_pct, input.margin_pct].every(pctOk)) {
    return invalid(SERVICE, "bad_percent", "Persentase harus 0 sampai di bawah 100.", { field: "margin_pct" });
  }
  const denied = requireLevel(SERVICE, "project", "write");
  if (denied) return denied;
  const state = getState();
  const user = actingUser();

  if (!input.quote_no) {
    const p = state.projects.find((x) => x.code === input.project_code);
    if (!p) return notFound(SERVICE, "project_not_found", `Tidak ada proyek ${input.project_code}.`);
    const open = state.quotations.find((x) => x.project_id === p.id && x.status === "DRAFT");
    if (open) {
      return conflict(SERVICE, "draft_exists", `Proyek ${p.code} sudah punya quotation draft. Lanjutkan yang itu.`,
        { quote_no: open.quote_no });
    }
    let no = "";
    apply((draft) => {
      no = nextDocNumber(draft, "qt");
      const rev = Math.max(0, ...draft.quotations.filter((x) => x.project_id === p.id).map((x) => x.rev)) + 1;
      draft.quotations.push({
        id: newId("qt"), quote_no: no, project_id: p.id, rev, supersedes_id: null, status: "DRAFT",
        valid_until: input.valid_until || addDays(officeToday(), 30),
        marketing_pct: input.marketing_pct ?? 0, overhead_pct: input.overhead_pct ?? 0, margin_pct: input.margin_pct ?? 0,
        vat: !!input.vat, vat_pct: input.vat_pct ?? 11,
        terms: input.terms?.trim() || null, note: input.note?.trim() || null,
        sent_at: null, decided_at: null, decision_reason: null, created_at: new Date().toISOString(),
      });
      writeAudit(draft, {
        service: SERVICE, entity: "quotation", entity_no: no, action: "create", outcome: "ok", reason: null,
        detail: { project: p.code, by: user.email },
      });
    });
    const v = view(no)!;
    remember(SERVICE, "saveQuotation", idempotencyKey, v);
    return ok(SERVICE, v);
  }

  const q = state.quotations.find((x) => x.quote_no === input.quote_no);
  if (!q) return notFound(SERVICE, "quotation_not_found", `Tidak ada quotation ${input.quote_no}.`);
  if (q.status !== "DRAFT") return notDraft(q, "Angka yang sudah dikirim tidak diubah. Buat revisi.");
  apply((draft) => {
    const row = draft.quotations.find((x) => x.id === q.id)!;
    row.valid_until = input.valid_until ?? null;
    row.marketing_pct = input.marketing_pct ?? 0;
    row.overhead_pct = input.overhead_pct ?? 0;
    row.margin_pct = input.margin_pct ?? 0;
    row.vat = !!input.vat;
    row.vat_pct = input.vat_pct ?? 11;
    row.terms = input.terms?.trim() || null;
    row.note = input.note?.trim() || null;
    writeAudit(draft, {
      service: SERVICE, entity: "quotation", entity_no: q.quote_no, action: "update", outcome: "ok", reason: null,
      detail: { by: user.email },
    });
  });
  return ok(SERVICE, view(q.quote_no)!);
}

/** Add or change a line on a draft. The name and lead time come from the
 *  catalogue when the item code is known and the line does not say. */
export async function saveQuotationLine(quoteNo: string, input: QuotationLineInput): Promise<Result<QuotationLineView>> {
  await latency();
  const denied = requireLevel(SERVICE, "project", "write");
  if (denied) return denied;
  const state = getState();
  const q = state.quotations.find((x) => x.quote_no === quoteNo);
  if (!q) return notFound(SERVICE, "quotation_not_found", `Tidak ada quotation ${quoteNo}.`);
  if (q.status !== "DRAFT") return notDraft(q, "Buat revisi untuk mengubah isinya.");

  const code = input.product_code?.trim().toUpperCase() || null;
  let desc = input.description?.trim() ?? "";
  if (code) {
    const p = state.products.find((x) => x.product_code === code);
    if (!p) return invalid(SERVICE, "product_not_found", `Tidak ada item code ${code} di katalog.`, { field: "product_code" });
    if (!desc) desc = p.name;
  }
  if (!desc) return invalid(SERVICE, "description_required", "Itemnya apa? Klien membaca baris ini.", { field: "description" });
  if (!(input.qty > 0)) return invalid(SERVICE, "qty_required", "Berapa unit?", { field: "qty" });
  if (!state.uom.some((u) => u.code === input.uom)) {
    return invalid(SERVICE, "no_such_uom", `Tidak ada satuan ${input.uom}.`, { field: "uom" });
  }
  if ((input.manual_unit_cost ?? 0) < 0 || (input.unit_price_override ?? 0) < 0) {
    return invalid(SERVICE, "negative", "Ongkos dan harga tidak bisa negatif.", { field: "manual_unit_cost" });
  }
  if (![input.marketing_pct, input.overhead_pct, input.margin_pct].every(pctOk)) {
    return invalid(SERVICE, "bad_percent", "Persentase harus 0 sampai di bawah 100.", { field: "margin_pct" });
  }
  if (input.id && !state.quotation_lines.some((l) => l.id === input.id && l.quotation_id === q.id)) {
    return notFound(SERVICE, "line_not_found", "Baris itu tidak ada.");
  }

  const fields = {
    product_code: code, description: desc, qty: input.qty, uom: input.uom,
    lead_time_days: input.lead_time_days ?? null, manual_unit_cost: input.manual_unit_cost ?? null,
    marketing_pct: input.marketing_pct ?? null, overhead_pct: input.overhead_pct ?? null,
    margin_pct: input.margin_pct ?? null, unit_price_override: input.unit_price_override ?? null,
    note: input.note?.trim() || null,
  };
  let id = input.id ?? "";
  apply((draft) => {
    if (input.id) {
      Object.assign(draft.quotation_lines.find((l) => l.id === input.id)!, fields);
    } else {
      id = newId("ql");
      const next = Math.max(0, ...draft.quotation_lines.filter((l) => l.quotation_id === q.id).map((l) => l.line_no)) + 1;
      draft.quotation_lines.push({
        id, quotation_id: q.id, line_no: next, ...fields,
        frozen_unit_cost: null, frozen_cost_source: null, frozen_bom_rev: null,
        frozen_marketing_pct: null, frozen_overhead_pct: null, frozen_margin_pct: null, frozen_unit_price: null,
      });
    }
  });
  const s = getState();
  const line = s.quotation_lines.find((l) => l.id === id)!;
  return ok(SERVICE, lineView(s, s.quotations.find((x) => x.id === q.id)!, line, seesCost()));
}

export async function removeQuotationLine(quoteNo: string, lineId: string): Promise<Result<{ quote_no: string }>> {
  await latency();
  const denied = requireLevel(SERVICE, "project", "write");
  if (denied) return denied;
  const state = getState();
  const q = state.quotations.find((x) => x.quote_no === quoteNo);
  if (!q) return notFound(SERVICE, "quotation_not_found", `Tidak ada quotation ${quoteNo}.`);
  if (q.status !== "DRAFT") return notDraft(q, "Buat revisi untuk mengubah isinya.");
  if (!state.quotation_lines.some((l) => l.id === lineId && l.quotation_id === q.id)) {
    return notFound(SERVICE, "line_not_found", "Baris itu tidak ada.");
  }
  apply((draft) => {
    draft.quotation_lines = draft.quotation_lines.filter((l) => l.id !== lineId);
    draft.quotation_lines
      .filter((l) => l.quotation_id === q.id)
      .sort((a, b) => a.line_no - b.line_no)
      .forEach((l, i) => { l.line_no = i + 1; });
  });
  return ok(SERVICE, { quote_no: q.quote_no });
}

/** Freeze every figure and hand it to the client. INQUIRY → QUOTATION_SENT. */
export async function sendQuotation(quoteNo: string): Promise<Result<QuotationView>> {
  await latency();
  const denied = requireLevel(SERVICE, "project", "write");
  if (denied) return denied;
  const state = getState();
  const q = state.quotations.find((x) => x.quote_no === quoteNo);
  if (!q) return notFound(SERVICE, "quotation_not_found", `Tidak ada quotation ${quoteNo}.`);
  if (q.status !== "DRAFT") return conflict(SERVICE, "not_draft", `${q.quote_no} sudah ${q.status}.`);
  const lines = linesOf(state, q, true);
  if (lines.length === 0) return invalid(SERVICE, "no_lines", "Quotation tanpa item bukan penawaran.", { field: "lines" });
  const missing = lines.filter((l) => l.cost_missing && l.unit_price_override == null);
  if (missing.length) {
    return invalid(SERVICE, "cost_missing",
      `Belum ada ongkos produksi untuk ${missing.map((l) => `baris ${l.line_no} (${l.description})`).join(", ")}. `
      + "Rilis BOM-nya, isi ongkos manual, atau tetapkan harga jualnya.", { field: "lines" });
  }
  const today = officeToday();
  if (q.valid_until && q.valid_until < today) {
    return invalid(SERVICE, "already_expired", `Berlaku sampai ${q.valid_until} — tanggal itu sudah lewat.`, { field: "valid_until" });
  }
  const user = actingUser();
  apply((draft) => {
    for (const v of lines) {
      const l = draft.quotation_lines.find((x) => x.id === v.id)!;
      l.frozen_unit_cost = v.unit_cost;
      l.frozen_cost_source = v.cost_source;
      l.frozen_bom_rev = v.bom_rev;
      l.frozen_marketing_pct = v.marketing_pct;
      l.frozen_overhead_pct = v.overhead_pct;
      l.frozen_margin_pct = v.margin_pct;
      l.frozen_unit_price = v.unit_price;
    }
    const row = draft.quotations.find((x) => x.id === q.id)!;
    row.status = "SENT";
    row.sent_at = new Date().toISOString();
    moveProject(draft, q.project_id, "QUOTATION_SENT", ["INQUIRY"], `Quotation ${q.quote_no} dikirim`, user.email);
    writeAudit(draft, {
      service: SERVICE, entity: "quotation", entity_no: q.quote_no, action: "send", outcome: "ok", reason: null,
      detail: { lines: lines.length, by: user.email },
    });
  });
  return ok(SERVICE, view(q.quote_no)!);
}

/** A new draft from a sent or rejected one; a sent one is superseded. */
export async function reviseQuotation(quoteNo: string): Promise<Result<QuotationView>> {
  await latency();
  const denied = requireLevel(SERVICE, "project", "write");
  if (denied) return denied;
  const state = getState();
  const q = state.quotations.find((x) => x.quote_no === quoteNo);
  if (!q) return notFound(SERVICE, "quotation_not_found", `Tidak ada quotation ${quoteNo}.`);
  if (q.status !== "SENT" && q.status !== "REJECTED") {
    return conflict(SERVICE, "not_revisable",
      q.status === "DRAFT" ? "Masih draft — ubah langsung saja."
        : q.status === "ACCEPTED" ? "Sudah disetujui dan menjadi pesanan. Perubahan setelah ini diurus di pesanannya."
          : `${q.quote_no} sudah ${q.status}.`);
  }
  if (state.quotations.some((x) => x.project_id === q.project_id && x.status === "DRAFT")) {
    return conflict(SERVICE, "draft_exists", "Proyek ini sudah punya quotation draft.");
  }
  const user = actingUser();
  const today = officeToday();
  let no = "";
  apply((draft) => {
    no = nextDocNumber(draft, "qt");
    const id = newId("qt");
    const rev = Math.max(...draft.quotations.filter((x) => x.project_id === q.project_id).map((x) => x.rev)) + 1;
    const plus30 = addDays(today, 30);
    draft.quotations.push({
      ...q, id, quote_no: no, rev, supersedes_id: q.id, status: "DRAFT",
      valid_until: (q.valid_until ?? today) > plus30 ? q.valid_until : plus30,
      sent_at: null, decided_at: null, decision_reason: null, created_at: new Date().toISOString(),
    });
    for (const l of draft.quotation_lines.filter((x) => x.quotation_id === q.id)) {
      draft.quotation_lines.push({
        ...l, id: newId("ql"), quotation_id: id,
        frozen_unit_cost: null, frozen_cost_source: null, frozen_bom_rev: null,
        frozen_marketing_pct: null, frozen_overhead_pct: null, frozen_margin_pct: null, frozen_unit_price: null,
      });
    }
    if (q.status === "SENT") draft.quotations.find((x) => x.id === q.id)!.status = "SUPERSEDED";
    writeAudit(draft, {
      service: SERVICE, entity: "quotation", entity_no: no, action: "revise", outcome: "ok", reason: null,
      detail: { from: q.quote_no, rev, by: user.email },
    });
  });
  return ok(SERVICE, view(no)!);
}

/** The client's answer. Accepted, the lines become the order at the quoted
 *  price — once — and the project moves to DEAL. Rejected, say why. */
export async function decideQuotation(
  quoteNo: string, accepted: boolean, reason?: string | null,
): Promise<Result<{ quotation: QuotationView; order_lines_added: number }>> {
  await latency();
  const denied = requireLevel(SERVICE, "project", "write");
  if (denied) return denied;
  const state = getState();
  const q = state.quotations.find((x) => x.quote_no === quoteNo);
  if (!q) return notFound(SERVICE, "quotation_not_found", `Tidak ada quotation ${quoteNo}.`);
  if (q.status !== "SENT") {
    return conflict(SERVICE, "not_sent", q.status === "DRAFT" ? "Belum dikirim ke klien." : `${q.quote_no} sudah ${q.status}.`);
  }
  if (!accepted && !reason?.trim()) {
    return invalid(SERVICE, "reason_required",
      "Kenapa ditolak? Harga, waktu, atau desain — pertanyaan ini pasti datang lagi di penawaran berikutnya.",
      { field: "reason" });
  }
  const user = actingUser();
  let added = 0;
  apply((draft) => {
    const row = draft.quotations.find((x) => x.id === q.id)!;
    row.status = accepted ? "ACCEPTED" : "REJECTED";
    row.decided_at = new Date().toISOString();
    row.decision_reason = reason?.trim() || null;
    if (accepted) {
      let next = Math.max(0, ...draft.project_lines.filter((l) => l.project_id === q.project_id).map((l) => l.line_no));
      for (const l of draft.quotation_lines.filter((x) => x.quotation_id === q.id).sort((a, b) => a.line_no - b.line_no)) {
        if (draft.project_lines.some((x) => x.quotation_line_id === l.id)) continue;
        draft.project_lines.push({
          id: newId("pl"), project_id: q.project_id, line_no: ++next, product_code: l.product_code,
          description: l.description, qty: l.qty, uom: l.uom, unit_price: l.frozen_unit_price,
          note: `dari ${q.quote_no}`, delivery_date: null, quotation_line_id: l.id,
        });
        added++;
      }
      moveProject(draft, q.project_id, "DEAL", ["INQUIRY", "QUOTATION_SENT"], `Quotation ${q.quote_no} disetujui`, user.email);
    }
    writeAudit(draft, {
      service: SERVICE, entity: "quotation", entity_no: q.quote_no, action: accepted ? "accept" : "reject",
      outcome: "ok", reason: reason?.trim() || null, detail: { order_lines_added: added, by: user.email },
    });
  });
  return ok(SERVICE, { quotation: view(q.quote_no)!, order_lines_added: added });
}
