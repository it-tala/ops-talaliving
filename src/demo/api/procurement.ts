/** Implements `/api/v1/procurement` from `03-api.md`. */
import { ok, noop, invalid, notFound, refused, type Result } from "@/services/_shared/envelope";
import type {
  Vendor, Item, Uom, Project, ProjectLine, ItemCategory,
  PrDocument, PrLine, PrLineView, PaymentRound, RoundSummary,
  PurchaseOrder, PoLine, PoStatusView, Receipt, ReceiptCondition, PrCategory, UomCode,
  VendorView, ItemView, VarianceReason, PrApproval, VendorJourney,
  ApprovalRequestView, ApprovalBatchView, PoDetail, PoApprovalView,
} from "@/services/procurement/contracts";
import type { PrLine as PrLineRow } from "@/services/procurement/contracts";
import { PROBLEM_CONDITIONS, COUNTING_CONDITIONS, VARIANCE_REASON_LABEL } from "@/services/procurement/contracts";
import type { DocKind } from "@/services/documents/contracts";
import { REQUEST_SUPPORT_KINDS } from "@/services/documents/contracts";
import { getActiveLocale } from "@/lib/format";
import { getState, apply, newId, nextDocNumber, writeAudit, writeOutbox } from "../store";
/* The one cross-service call in this module, and it is deliberate: confirming
   a delivery puts the goods on a rack (D170). Written as a function the
   inventory service owns, so Phase 2 replaces the call with the outbox
   consumer and nothing else moves (ADR-004, ADR-008). */
import { stockFromReceipt } from "./inventory";
import {
  prLineView, approvalQueue, lineCoverage, roundSummary, poStatus, isApproved,
  poDetail, poTerms,
  boughtCategories, itemsBoughtFrom, itemSources, purchaseFacts, openLines,
  pendingRequest, byTime, vendorJourney,
  varianceOf, currentApproval, lineEvidenceKinds,
} from "../derive";
import {
  latency, actingUser, requireAuthority, requireModule, conflict, replayed, remember, paged,
} from "./_kit";

const SERVICE = "procurement" as const;

/* ------------------------------------------------------------------ */
/* Reference data                                                      */
/* ------------------------------------------------------------------ */

export async function listVendors(opts: { q?: string; curated?: boolean } = {}): Promise<Result<Vendor[]>> {
  await latency();
  let rows = getState().vendors;
  if (opts.q) {
    const q = opts.q.toLowerCase();
    rows = rows.filter((v) => v.name.toLowerCase().includes(q) || v.aka.some((a) => a.toLowerCase().includes(q)));
  }
  /* Uncurated vendors are shown and marked in lists; only a dropdown filters
   * them out. `active=false` means RECORDED, NOT YET CURATED — never hidden. */
  if (opts.curated !== undefined) rows = rows.filter((v) => v.is_curated === opts.curated);
  return ok(SERVICE, rows);
}

/** A vendor name a human types is always accepted, and is born uncurated.
 *  Auto-curating would feed every spelling variant into the catalogue as if it
 *  were canonical. */
export async function createVendor(input: { name: string }, idempotencyKey?: string): Promise<Result<Vendor>> {
  await latency();
  const cached = replayed<Vendor>(SERVICE, "createVendor", idempotencyKey);
  if (cached) return cached;

  const name = input.name.trim();
  if (!name) return invalid(SERVICE, "name_required", "Vendor name is required.", { field: "name" });

  const existing = getState().vendors.find((v) => v.name.toLowerCase() === name.toLowerCase());
  if (existing) {
    return conflict(SERVICE, "vendor_exists", `Vendor "${existing.name}" already exists — nothing changed.`, { vendor_id: existing.id });
  }

  const vendor: Vendor = {
    id: newId("vnd"), code: `V-${String(getState().vendors.length + 1).padStart(4, "0")}`,
    name, aka: [], is_curated: false,
    phone: null, address: null, pic_name: null, pic_phone: null,
    bank_account: null, bank_account_secondary: null, npwp: null,
    supplied_categories: [],
  };
  apply((draft) => {
    draft.vendors.push(vendor);
    writeAudit(draft, { service: SERVICE, entity: "vendor", entity_no: vendor.code, action: "create", outcome: "ok", reason: null });
    writeOutbox(draft, { service: SERVICE, event_type: "procurement.vendor.created", payload: { vendor_id: vendor.id, name } });
  });
  remember(SERVICE, "createVendor", idempotencyKey, vendor);
  return ok(SERVICE, vendor);
}

export async function listItems(opts: { q?: string; curated?: boolean } = {}): Promise<Result<Item[]>> {
  await latency();
  let rows = getState().items;
  if (opts.q) {
    const q = opts.q.toLowerCase();
    rows = rows.filter((i) => i.name.toLowerCase().includes(q) || i.code.toLowerCase().includes(q));
  }
  if (opts.curated !== undefined) rows = rows.filter((i) => i.is_curated === opts.curated);
  return ok(SERVICE, rows);
}

export async function listUom(): Promise<Result<Uom[]>> {
  await latency();
  return ok(SERVICE, getState().uom);
}

export async function listProjects(): Promise<Result<Project[]>> {
  await latency();
  return ok(SERVICE, [...getState().projects].sort((a, b) => b.code.localeCompare(a.code)));
}

export async function getProject(code: string): Promise<Result<Project>> {
  await latency();
  const found = getState().projects.find((p) => p.code === code);
  if (!found) return notFound(SERVICE, "project_not_found", `No project ${code}.`);
  return ok(SERVICE, found);
}

/** Master data for a customer's order.
 *
 *  The **code** is set once and never edited: it is on purchase request lines,
 *  on work orders and on ledger rows, and every one of those references is by
 *  code at the seam (ADR-004). A code that moves is a set of references that
 *  break silently, which is the one failure nobody notices until a report is
 *  wrong (D149).
 */
export async function saveProject(
  input: {
    code: string;
    name: string;
    client_name?: string | null;
    location?: string | null;
    pic?: string | null;
    started_on?: string | null;
    target_date?: string | null;
    contract_value?: number | null;
    is_active?: boolean;
    note?: string | null;
  },
  idempotencyKey?: string,
): Promise<Result<Project>> {
  await latency();
  const cached = replayed<Project>(SERVICE, "saveProject", idempotencyKey);
  if (cached) return cached;

  const denied = requireModule(SERVICE, "procurement");
  if (denied) return denied;

  const code = input.code.trim();
  if (!code) {
    return invalid(SERVICE, "code_required", "Kode proyek dipakai di PR, SPK dan ledger.", { field: "code" });
  }
  if (!input.name.trim()) {
    return invalid(SERVICE, "name_required", "Proyeknya dikenal dengan nama apa?", { field: "name" });
  }
  if (input.target_date && input.started_on && input.target_date < input.started_on) {
    return invalid(
      SERVICE, "dates_reversed",
      "Tanggal target lebih awal dari tanggal mulai.",
      { field: "target_date" },
    );
  }

  const user = actingUser();
  const existing = getState().projects.find((p) => p.code === code);
  let saved: Project | null = null;
  apply((draft) => {
    if (existing) {
      const row = draft.projects.find((p) => p.code === code);
      if (!row) return;
      const before = { name: row.name, contract_value: row.contract_value, is_active: row.is_active };
      Object.assign(row, {
        name: input.name.trim(),
        client_name: input.client_name?.trim() ?? row.client_name,
        location: input.location?.trim() ?? row.location,
        pic: input.pic?.trim() ?? row.pic,
        started_on: input.started_on ?? row.started_on,
        target_date: input.target_date ?? row.target_date,
        contract_value: input.contract_value ?? row.contract_value,
        is_active: input.is_active ?? row.is_active,
        note: input.note?.trim() ?? row.note,
      });
      saved = row;
      writeAudit(draft, {
        service: SERVICE, entity: "project", entity_no: code,
        action: "update", outcome: "ok", reason: null,
        detail: { before, after: { name: row.name, contract_value: row.contract_value, is_active: row.is_active }, by: user.email },
      });
    } else {
      const row: Project = {
        id: newId("prj"), code,
        name: input.name.trim(),
        is_active: input.is_active ?? true,
        client_name: input.client_name?.trim() || null,
        location: input.location?.trim() || null,
        pic: input.pic?.trim() || null,
        started_on: input.started_on ?? null,
        target_date: input.target_date ?? null,
        contract_value: input.contract_value ?? null,
        note: input.note?.trim() || null,
      };
      draft.projects.push(row);
      saved = row;
      writeAudit(draft, {
        service: SERVICE, entity: "project", entity_no: code,
        action: "create", outcome: "ok", reason: null,
        detail: { name: row.name, client: row.client_name, by: user.email },
      });
    }
  });
  const view = saved as Project | null;
  if (!view) return invalid(SERVICE, "not_saved", "Proyek tidak tersimpan.", { field: "code" });
  remember(SERVICE, "saveProject", idempotencyKey, view);
  return ok(SERVICE, view);
}

/** The customer's order, line by line (D150). */
export async function listProjectLines(code: string): Promise<Result<ProjectLine[]>> {
  await latency();
  const state = getState();
  const project = state.projects.find((p) => p.code === code);
  if (!project) return notFound(SERVICE, "project_not_found", `No project ${code}.`);
  return ok(
    SERVICE,
    state.project_lines
      .filter((l) => l.project_id === project.id)
      .sort((a, b) => a.line_no - b.line_no),
  );
}

/** Adding a line to an order, or correcting one.
 *
 *  The product is carried as a **code**, and it is not validated against the
 *  catalogue: an order gets typed the day it is signed, which is often before
 *  anybody has drawn the thing. A line with no product code is legitimate too —
 *  installation, delivery, a one-off nobody will make twice (A6).
 */
export async function saveProjectLine(
  input: {
    project_code: string;
    line_id?: string | null;
    product_code?: string | null;
    description: string;
    qty: number;
    uom: string;
    unit_price?: number | null;
    note?: string | null;
  },
): Promise<Result<ProjectLine[]>> {
  await latency();
  const denied = requireModule(SERVICE, "procurement");
  if (denied) return denied;

  const state = getState();
  const project = state.projects.find((p) => p.code === input.project_code);
  if (!project) return notFound(SERVICE, "project_not_found", `No project ${input.project_code}.`);
  if (!input.description.trim()) {
    return invalid(SERVICE, "description_required", "Barangnya apa? Klien membaca baris ini.", { field: "description" });
  }
  if (!input.qty || input.qty <= 0) {
    return invalid(SERVICE, "qty_required", "Pesanan nol bukan pesanan.", { field: "qty" });
  }

  const user = actingUser();
  apply((draft) => {
    const row = input.line_id ? draft.project_lines.find((l) => l.id === input.line_id) : null;
    if (row) {
      Object.assign(row, {
        product_code: input.product_code?.trim().toUpperCase() || null,
        description: input.description.trim(),
        qty: input.qty,
        uom: input.uom.trim() || row.uom,
        unit_price: input.unit_price ?? row.unit_price,
        note: input.note?.trim() ?? row.note,
      });
    } else {
      const used = draft.project_lines.filter((l) => l.project_id === project.id);
      draft.project_lines.push({
        id: newId("prl"), project_id: project.id,
        line_no: used.length + 1,
        product_code: input.product_code?.trim().toUpperCase() || null,
        description: input.description.trim(),
        qty: input.qty,
        uom: input.uom.trim() || "unit",
        unit_price: input.unit_price ?? null,
        note: input.note?.trim() || null,
      });
    }
    writeAudit(draft, {
      service: SERVICE, entity: "project", entity_no: project.code,
      action: row ? "update_line" : "add_line", outcome: "ok", reason: null,
      detail: { product: input.product_code ?? null, qty: input.qty, by: user.email },
    });
  });
  return listProjectLines(project.code);
}

export async function removeProjectLine(
  input: { project_code: string; line_id: string },
): Promise<Result<ProjectLine[]>> {
  await latency();
  const denied = requireModule(SERVICE, "procurement");
  if (denied) return denied;

  const state = getState();
  const project = state.projects.find((p) => p.code === input.project_code);
  if (!project) return notFound(SERVICE, "project_not_found", `No project ${input.project_code}.`);
  const row = state.project_lines.find((l) => l.id === input.line_id);
  if (!row) return notFound(SERVICE, "line_not_found", "Baris itu tidak ada.");

  const user = actingUser();
  apply((draft) => {
    draft.project_lines = draft.project_lines.filter((l) => l.id !== input.line_id);
    writeAudit(draft, {
      service: SERVICE, entity: "project", entity_no: project.code,
      action: "remove_line", outcome: "ok", reason: null,
      detail: { description: row.description, qty: row.qty, by: user.email },
    });
  });
  return listProjectLines(project.code);
}

/** Every request line raised from one work order's bill of material.
 *
 *  The other half of D151: the BOM projected what a run should cost, these are
 *  what somebody actually asked to buy for it. Two sums over the same rows. */
export async function listLinesForWorkOrder(woNo: string): Promise<Result<PrLineView[]>> {
  await latency();
  const state = getState();
  const rows = state.pr_lines
    .filter((l) => l.source_wo_no === woNo)
    .map((l) => prLineView(state, l))
    .sort((a, b) => a.line_no_full.localeCompare(b.line_no_full));
  return ok(SERVICE, rows);
}

export async function listCategories(): Promise<Result<ItemCategory[]>> {
  await latency();
  return ok(SERVICE, getState().item_categories);
}

/* ------------------------------------------------------------------ */
/* PR                                                                  */
/* ------------------------------------------------------------------ */

export interface PrDocumentView extends PrDocument {
  lines: PrLineView[];
  requested_by_name: string;
  project_code: string | null;
  requested_total: number;
  approved_total: number;
}

/** The board: every open line, everywhere. */
export async function listOpenLines(): Promise<Result<PrLineView[]>> {
  await latency();
  return ok(SERVICE, openLines(getState()));
}

/** Every line including settled ones, for the "show everything" view. */
export async function listAllLines(): Promise<Result<PrLineView[]>> {
  await latency();
  const state = getState();
  return ok(SERVICE, state.pr_lines
    .filter((l) => {
      const doc = state.pr_documents.find((d) => d.id === l.doc_id);
      return doc && doc.status !== "CANCELLED";
    })
    .map((l) => prLineView(state, l))
    .sort((a, b) => byTime(b.submitted_at ?? "", a.submitted_at ?? "") || b.doc_no.localeCompare(a.doc_no)));
}

function docView(docId: string): PrDocumentView | null {
  const state = getState();
  const doc = state.pr_documents.find((d) => d.id === docId);
  if (!doc) return null;
  const lines = state.pr_lines.filter((l) => l.doc_id === docId).map((l) => prLineView(state, l));
  return {
    ...doc,
    lines,
    requested_by_name: state.users.find((u) => u.id === doc.requested_by)?.full_name ?? "—",
    project_code: state.projects.find((p) => p.id === doc.project_id)?.code ?? null,
    requested_total: lines.reduce((s, l) => s + l.item_total, 0),
    approved_total: lines
      .filter((l) => l.approval?.approved)
      .reduce((s, l) => s + (l.approval?.approved_amount ?? l.item_total), 0),
  };
}

export async function listPr(opts: { limit?: number; offset?: number } = {}): Promise<Result<PrDocumentView[]>> {
  await latency();
  const rows = getState().pr_documents
    .map((d) => docView(d.id))
    .filter((d): d is PrDocumentView => !!d)
    .sort((a, b) => byTime(b.created_at, a.created_at));
  return paged(SERVICE, rows, opts.limit ?? 50, opts.offset ?? 0);
}

export async function getPr(docNo: string): Promise<Result<PrDocumentView>> {
  await latency();
  const doc = getState().pr_documents.find((d) => d.doc_no === docNo);
  const view = doc ? docView(doc.id) : null;
  if (!view) return notFound(SERVICE, "pr_not_found", `Document ${docNo} not found.`);
  return ok(SERVICE, view);
}

export interface NewLineInput {
  item_id?: string | null;
  description: string;
  qty?: number | null;
  uom?: UomCode | null;
  unit_price?: number | null;
  item_total?: number | null;
  vendor_id?: string | null;
  category?: PrCategory | null;
  purpose?: string | null;
  need_by?: string | null;
  /** The work order whose BOM produced this line (D151). */
  source_wo_no?: string | null;
}

export async function createPr(
  /** `project_code` is the seam-friendly way in: another service knows the
   *  code, never the internal id (ADR-004). Resolved here. */
  input: { project_id?: string | null; project_code?: string | null; lines: NewLineInput[] },
  idempotencyKey?: string,
): Promise<Result<PrDocumentView>> {
  await latency();
  const cached = replayed<PrDocumentView>(SERVICE, "createPr", idempotencyKey);
  if (cached) return cached;
  if (!input.lines.length) return invalid(SERVICE, "lines_required", "A purchase request needs at least one line.", { field: "lines" });

  const byCode = input.project_code
    ? getState().projects.find((p) => p.code === input.project_code)
    : null;
  if (input.project_code && !byCode) {
    return notFound(SERVICE, "project_not_found", `No project ${input.project_code}.`);
  }

  const user = actingUser();
  let docNo = "";
  apply((draft) => {
    docNo = nextDocNumber(draft, "pr");
    const docId = newId("doc");
    draft.pr_documents.push({
      id: docId, doc_no: docNo, doc_type: "PR", status: "DRAFT",
      requested_by: user.id, project_id: input.project_id ?? byCode?.id ?? null,
      created_at: new Date().toISOString(), submitted_at: null,
    });
    input.lines.forEach((l, i) => {
      const lineNo = i + 1;
      draft.pr_lines.push({
        id: newId("prl"), doc_id: docId, line_no: lineNo,
        line_no_full: `${docNo}-L${String(lineNo).padStart(2, "0")}`,
        item_id: l.item_id ?? null, description: l.description,
        qty: l.qty ?? null, uom: l.uom ?? null, unit_price: l.unit_price ?? null,
        item_total: l.item_total ?? Math.round((l.qty ?? 0) * (l.unit_price ?? 0)),
        vendor_id: l.vendor_id ?? null, po_line_id: null,
        category: l.category ?? null, purpose: l.purpose ?? null,
        need_by: l.need_by ?? null,
        source_wo_no: l.source_wo_no ?? null,
        removed_at: null, removed_by: null,
      });
    });
    writeAudit(draft, { service: SERVICE, entity: "pr_document", entity_no: docNo, action: "create", outcome: "ok", reason: null });
  });
  const view = docView(getState().pr_documents.find((d) => d.doc_no === docNo)!.id)!;
  remember(SERVICE, "createPr", idempotencyKey, view);
  return ok(SERVICE, view);
}

/** One item, asked for and submitted in a single act.
 *
 *  For the meeting itself: somebody says "we also need thinner", and the item
 *  has to be on the list before the conversation moves on. Going through the
 *  full create-then-submit form loses the room.
 *
 *  It is a real purchase request, not a lighter kind — same document, same
 *  numbering, same queue. The only thing skipped is the draft stage, which
 *  exists for the case where somebody is still assembling a list (D73).
 */
export async function quickAddLine(
  input: NewLineInput & { project_id?: string | null },
  idempotencyKey?: string,
): Promise<Result<PrLineView>> {
  const endpoint = "quickAddLine";
  const cached = replayed<PrLineView>(SERVICE, endpoint, idempotencyKey);
  if (cached) return cached;

  if (!input.description.trim()) {
    return invalid(SERVICE, "description_required", "An item needs a name before anyone can decide it.", { field: "description" });
  }

  const { project_id, ...line } = input;
  const created = await createPr({ project_id, lines: [line] });
  if (created.error) return created as unknown as Result<PrLineView>;
  const submitted = await submitPr(created.data.doc_no);
  if (submitted.error) return submitted as unknown as Result<PrLineView>;

  const state = getState();
  const row = state.pr_lines.find((l) => l.line_no_full === `${created.data.doc_no}-L01`)!;
  const view = prLineView(state, row);
  remember(SERVICE, endpoint, idempotencyKey, view);
  return ok(SERVICE, view);
}

export async function submitPr(docNo: string, idempotencyKey?: string): Promise<Result<PrDocumentView>> {
  await latency();
  const cached = replayed<PrDocumentView>(SERVICE, `submitPr:${docNo}`, idempotencyKey);
  if (cached) return cached;

  const doc = getState().pr_documents.find((d) => d.doc_no === docNo);
  if (!doc) return notFound(SERVICE, "pr_not_found", `Document ${docNo} not found.`);
  if (doc.status !== "DRAFT") {
    return conflict(SERVICE, "already_submitted", `${docNo} has already been submitted — nothing changed.`, { status: doc.status });
  }

  apply((draft) => {
    const d = draft.pr_documents.find((x) => x.id === doc.id)!;
    d.status = "SUBMITTED";
    d.submitted_at = new Date().toISOString();
    writeAudit(draft, { service: SERVICE, entity: "pr_document", entity_no: docNo, action: "submit", outcome: "ok", reason: null });
    writeOutbox(draft, { service: SERVICE, event_type: "procurement.pr.submitted", payload: { doc_no: docNo } });
  });
  const view = docView(doc.id)!;
  remember(SERVICE, `submitPr:${docNo}`, idempotencyKey, view);
  return ok(SERVICE, view);
}

/* ------------------------------------------------------------------ */
/* Approval — a checkbox (D28)                                         */
/* ------------------------------------------------------------------ */

export async function queue(): Promise<Result<PrLineView[]>> {
  await latency();
  return ok(SERVICE, approvalQueue(getState()));
}

/** Lines somebody has already decided, most recently decided first.
 *
 *  This exists so un-ticking is reachable. A decision that can be made but not
 *  unmade is a trap: the CEO who ticks the wrong row would otherwise have to
 *  ask somebody with database access to fix it (F9 — a control that only
 *  reads is not built).
 */
export async function decidedLines(limit = 12): Promise<Result<PrLineView[]>> {
  await latency();
  const state = getState();
  const rows = state.pr_lines
    .filter((line) => {
      const doc = state.pr_documents.find((d) => d.id === line.doc_id);
      if (!doc || doc.status === "DRAFT" || doc.status === "CANCELLED") return false;
      return !!currentApproval(state, line.id);
    })
    .map((line) => prLineView(state, line))
    .sort((a, b) => byTime(b.approval?.recorded_at ?? "", a.approval?.recorded_at ?? ""));
  return ok(SERVICE, rows.slice(0, limit));
}

/** The whole decision. `approved_amount` may be reduced below what was asked
 *  and never raised — money can only shrink on its way through approval (A8).
 */
/** Does anything stand behind this request? See `REQUEST_SUPPORT_KINDS`. */
function lineHasSupport(state: ReturnType<typeof getState>, line: PrLineRow): boolean {
  return [...lineEvidenceKinds(state, line)].some((k) => REQUEST_SUPPORT_KINDS.includes(k));
}

export async function approveLine(
  input: {
    line_no: string;
    approved: boolean;
    approved_qty?: number | null;
    approved_amount?: number | null;
    /** Leadership's own words, recorded with the decision when they write any
     *  (D64). Written as a note row, not as columns on the decision. */
    instructions?: string | null;
    remark?: string | null;
  },
  idempotencyKey?: string,
): Promise<Result<PrLineView>> {
  await latency();
  const endpoint = `approveLine:${input.line_no}`;
  const cached = replayed<PrLineView>(SERVICE, endpoint, idempotencyKey);
  if (cached) return cached;

  const denied = requireAuthority(SERVICE, "approve_goods");
  if (denied) {
    apply((draft) => {
      writeAudit(draft, {
        service: SERVICE, entity: "pr_line", entity_no: input.line_no,
        action: "approve", outcome: "refused", reason: "tanpa authority approve_goods",
      });
    });
    return denied;
  }

  const state = getState();
  const line = state.pr_lines.find((l) => l.line_no_full === input.line_no);
  if (!line) return notFound(SERVICE, "line_not_found", `Line ${input.line_no} not found.`);
  if (line.removed_at) {
    return conflict(SERVICE, "line_removed", `Line ${input.line_no} has been removed and cannot be approved.`);
  }

  /* Quantity and money move together — approving 40 of the 60 litres asked for
   * approves two-thirds of the price, and asking somebody to do that
   * arithmetic in their head is how an approval ends up disagreeing with
   * itself (D65).
   *
   * Neither is capped at what was requested (D76, owner). The old rule said
   * approval could only reduce, which assumed the request was always the
   * higher number — but the vendor raises a price between the request and the
   * meeting, and a leader approving Rp 4.500.000 for something asked at
   * Rp 4.275.000 is making a real decision, not a mistake. What that leaves
   * behind is a difference between requested and approved, which the line
   * already carries and reports. */
  /* Nothing to approve a number against.
   *
   *  The owner's rule: *setiap pengajuan untuk pembayaran harus dilengkapi
   *  dengan dokumen pendukung* — the shop link, the invoice, the bill. It is
   *  refused rather than warned about because approving a figure with nothing
   *  behind it is exactly the habit this system exists to end, and because the
   *  fix takes ten seconds on the line itself (D125).
   *
   *  Un-approving is never blocked: withdrawing a yes must stay possible even
   *  on a line whose paperwork is a mess. */
  if (input.approved && !lineHasSupport(state, line)) {
    apply((draft) => {
      writeAudit(draft, {
        service: SERVICE, entity: "pr_line", entity_no: input.line_no,
        action: "approve", outcome: "refused", reason: "no supporting document",
      });
    });
    return invalid(
      SERVICE, "support_required",
      `${input.line_no} has nothing behind it. Attach what the price came from — a link to the shop page, an invoice, a bill, or the order — then approve it.`,
      { field: "documents", accepted: REQUEST_SUPPORT_KINDS },
    );
  }

  const qty = input.approved_qty ?? line.qty;
  const amount = input.approved_amount ?? line.item_total;

  const already = isApproved(state, line.id);
  if (already === input.approved) {
    return conflict(
      SERVICE, "already_decided",
      `This line is already ${input.approved ? "approved" : "not approved"} — nothing changed.`,
    );
  }

  const user = actingUser();
  apply((draft) => {
    draft.pr_approvals.push({
      id: newId("apr"), line_id: line.id, step: "GOODS",
      approved: input.approved,
      approved_qty: input.approved ? qty : null,
      approved_amount: input.approved ? amount : null,
      recorded_by: user.id, recorded_by_email: user.email,
      recorded_at: new Date().toISOString(), channel: "web",
    });
    if (input.instructions?.trim() || input.remark?.trim()) {
      draft.line_notes.push({
        id: newId("nte"), line_id: line.id,
        instructions: input.instructions?.trim() || null,
        remark: input.remark?.trim() || null,
        recorded_by: user.id, recorded_by_email: user.email,
        recorded_at: new Date().toISOString(),
      });
    }
    /* A decision taken here answers the card sitting in chat. Leaving it open
     * would mean the approver is still being asked for something already
     * settled — and the answer they gave would then land as a 409. */
    for (const r of draft.approval_requests) {
      if (r.line_id === line.id && !r.answered_at) {
        r.answered_at = new Date().toISOString();
        r.outcome = input.approved ? "approved" : "declined";
      }
    }
    writeAudit(draft, {
      service: SERVICE, entity: "pr_line", entity_no: input.line_no,
      action: input.approved ? "approve" : "unapprove", outcome: "ok", reason: null,
    });
    writeOutbox(draft, {
      service: SERVICE, event_type: "procurement.line.approved",
      payload: { line_no: input.line_no, approved: input.approved, amount },
    });
  });

  const view = prLineView(getState(), getState().pr_lines.find((l) => l.id === line.id)!);
  remember(SERVICE, endpoint, idempotencyKey, view);
  return ok(SERVICE, view);
}

/** The whole trail of decisions on one line, oldest first.
 *
 *  Append-only means the story is the rows, not the last row: "approved at
 *  10:18, un-approved at 14:07" is a fact about how the decision was made and
 *  the screen has no business hiding it behind the current value (D28).
 */
export async function lineHistory(lineNo: string): Promise<Result<PrApproval[]>> {
  await latency();
  const state = getState();
  const line = state.pr_lines.find((l) => l.line_no_full === lineNo);
  if (!line) return notFound(SERVICE, "line_not_found", `Line ${lineNo} not found.`);
  return ok(SERVICE, state.pr_approvals
    .filter((a) => a.line_id === line.id)
    .sort((a, b) => byTime(a.recorded_at, b.recorded_at)));
}

/* ------------------------------------------------------------------ */
/* Approval asked for through chat (D69)                               */
/* ------------------------------------------------------------------ */

/** Send lines to the approver in Google Chat, as one list.
 *
 *  This exists because of how the meeting actually runs: one laptop, open on
 *  whoever's account, and the CEO saying yes out loud. Ticking the box on that
 *  laptop records the wrong person as the approver — and an approval trail
 *  that names the wrong person is worse than no trail, because it looks
 *  authoritative.
 *
 *  Sent as a BATCH rather than a card per line (D70). A person answering
 *  fifteen separate cards has no idea what they have committed to until they
 *  add fifteen numbers up; a batch states the three totals that matter — asked,
 *  approved, and what has to be paid.
 *
 *  Sending is an ordinary act anyone in procurement may do; answering is the
 *  decision, and only the addressee can take it.
 */
export async function requestApproval(
  input: {
    line_nos: string[];
    to?: string;
    /** What the room said about each item, by line number. Travels with the
     *  question so the approver has the context the meeting had (D127). */
    notes?: Record<string, string | null>;
  },
  idempotencyKey?: string,
): Promise<Result<ApprovalBatchView>> {
  await latency();
  const endpoint = `requestApproval:${input.line_nos.join(",")}`;
  const cached = replayed<ApprovalBatchView>(SERVICE, endpoint, idempotencyKey);
  if (cached) return cached;

  const state = getState();
  /* Whoever holds the authority to approve goods is who the question goes to.
   * Not a name in a config file: if the authority moves, the notification
   * follows it (D19). */
  const approver = state.users.find((u) =>
    input.to ? u.id === input.to : u.authorities.includes("approve_goods"));
  if (!approver) {
    return conflict(SERVICE, "no_approver", "Nobody currently holds the authority to approve goods, so there is no one to ask.");
  }

  const user = actingUser();
  const fresh: string[] = [];
  const bare: string[] = [];
  for (const lineNo of input.line_nos) {
    const line = state.pr_lines.find((l) => l.line_no_full === lineNo);
    if (!line || line.removed_at) continue;
    if (isApproved(state, line.id)) continue;
    if (pendingRequest(state, line.id)) continue;  /* already asked; asking twice is nagging, not a record */
    /* Sending a bare number to somebody's phone is worse than sending
       nothing: they cannot check it there, so they either say yes blind or
       put the phone down (D125). */
    if (!lineHasSupport(state, line)) { bare.push(lineNo); continue; }
    fresh.push(lineNo);
  }

  if (bare.length > 0) {
    return invalid(
      SERVICE, "support_required",
      bare.length === 1
        ? `${bare[0]} has nothing behind it. Attach the shop link, the invoice or the bill before asking anybody to decide.`
        : `${bare.length} of these have nothing behind them — ${bare.join(", ")}. Attach the shop link, the invoice or the bill before asking anybody to decide.`,
      { field: "documents", lines: bare, accepted: REQUEST_SUPPORT_KINDS },
    );
  }

  if (fresh.length === 0) {
    return conflict(
      SERVICE, "nothing_to_ask",
      "Nothing to send — every one of those is already decided or already waiting for an answer.",
    );
  }

  let batchNo = "";
  apply((draft) => {
    batchNo = nextDocNumber(draft, "ask");
    const batchId = newId("abt");
    /* Unguessable and unique, never derived from the batch number. The token
     * is what the chat card carries back, so a predictable one would let
     * anybody who can guess a document number answer somebody else's list —
     * and two sends deriving the same token would answer each other's. */
    const token = `tok_${newId("t").slice(2)}${Math.random().toString(36).slice(2, 10)}`;
    draft.approval_batches.push({
      id: batchId, batch_no: batchNo, token,
      sent_to: approver.id, sent_to_email: approver.email,
      sent_by: user.id, sent_by_email: user.email,
      sent_at: new Date().toISOString(), channel: "chat",
    });
    fresh.forEach((lineNo, i) => {
      const line = draft.pr_lines.find((l) => l.line_no_full === lineNo)!;
      draft.approval_requests.push({
        id: newId("arq"), batch_id: batchId, line_id: line.id,
        token: `${token}~${i + 1}`,
        sent_to: approver.id, sent_to_email: approver.email,
        sent_by: user.id, sent_by_email: user.email,
        sent_at: new Date().toISOString(),
        channel: "chat",
        meeting_note: input.notes?.[lineNo]?.trim() || null,
        answered_at: null, outcome: null,
      });
      writeAudit(draft, {
        service: SERVICE, entity: "pr_line", entity_no: lineNo,
        action: "request_approval", outcome: "ok", reason: `${batchNo} → ${approver.email}`,
      });
    });
    /* One event for one send. The worker that turns this into a chat card
     * needs the list, not fifteen separate notifications (ADR-004). */
    writeOutbox(draft, {
      service: SERVICE, event_type: "procurement.approval.requested",
      payload: {
        batch_no: batchNo, token, to: approver.email,
        line_nos: fresh,
        requested_total: fresh.reduce((sum, no) => {
          const l = draft.pr_lines.find((x) => x.line_no_full === no);
          return sum + (l?.item_total ?? 0);
        }, 0),
      },
    });
  });

  const view = batchViews(getState()).find((b) => b.batch_no === batchNo)!;
  remember(SERVICE, endpoint, idempotencyKey, view);
  return ok(SERVICE, view);
}

function requestViews(state: ReturnType<typeof getState>): ApprovalRequestView[] {
  return state.approval_requests.map((r) => {
    const line = state.pr_lines.find((l) => l.id === r.line_id)!;
    const doc = state.pr_documents.find((d) => d.id === line.doc_id);
    const approval = currentApproval(state, line.id);
    const decided = approval?.approved === true;
    const approvedAmount = decided ? approval.approved_amount ?? line.item_total : null;
    const covered = lineCoverage(state, line).covered;
    return {
      ...r,
      line_no_full: line.line_no_full,
      description: line.description,
      purpose: line.purpose,
      qty: line.qty,
      uom: line.uom,
      unit_price: line.unit_price,
      item_total: line.item_total,
      vendor_name: state.vendors.find((v) => v.id === line.vendor_id)?.name ?? null,
      requested_by_name: state.users.find((u) => u.id === doc?.requested_by)?.full_name ?? "—",
      project_code: state.projects.find((p) => p.id === doc?.project_id)?.code ?? null,
      line_decided: decided,
      approved_amount: approvedAmount,
      /* What actually has to leave the bank: approved, less whatever already
       * reached the line. Approving something already paid for commits no new
       * money, and a total that ignores that is a total nobody can act on. */
      to_pay: Math.max((approvedAmount ?? 0) - covered, 0),
    };
  });
}

function batchViews(state: ReturnType<typeof getState>): ApprovalBatchView[] {
  const all = requestViews(state);
  return state.approval_batches.map((b) => {
    const items = all.filter((r) => r.batch_id === b.id);
    return {
      ...b,
      items,
      requested_total: items.reduce((s, i) => s + i.item_total, 0),
      approved_total: items.reduce((s, i) => s + (i.approved_amount ?? 0), 0),
      to_pay_total: items.reduce((s, i) => s + i.to_pay, 0),
      answered: items.filter((i) => i.answered_at).length,
      pending: items.filter((i) => !i.answered_at).length,
    };
  }).sort((a, b) => byTime(b.sent_at, a.sent_at));
}

/** The sends waiting in one person's chat, newest first. */
export async function listApprovalBatches(
  opts: { for_email?: string; pending?: boolean } = {},
): Promise<Result<ApprovalBatchView[]>> {
  await latency();
  let rows = batchViews(getState());
  if (opts.for_email) rows = rows.filter((b) => b.sent_to_email === opts.for_email);
  if (opts.pending) rows = rows.filter((b) => b.pending > 0);
  return ok(SERVICE, rows);
}

/** The answer coming back from chat.
 *
 *  **The identity does not come from this session.** It comes from the chat
 *  platform, which authenticated the person who tapped the button — that is
 *  the entire reason the round trip exists, and using `actingUser()` here
 *  would put us back to recording whoever's laptop was open.
 *
 *  In Phase 2 this is a signed webhook from Google and `answered_by_email` is
 *  read from the verified sender, never from the request body. The demo screen
 *  stands in for that signature, and the check below is the shape of the rule
 *  it will enforce: an answer from anyone but the addressee is refused.
 */
export async function answerFromChat(
  input: {
    token: string;
    answered_by_email: string;
    approved: boolean;
    approved_qty?: number | null;
    approved_amount?: number | null;
    instructions?: string | null;
    remark?: string | null;
  },
  idempotencyKey?: string,
): Promise<Result<PrLineView>> {
  await latency();
  const endpoint = `answerFromChat:${input.token}`;
  const cached = replayed<PrLineView>(SERVICE, endpoint, idempotencyKey);
  if (cached) return cached;

  const state = getState();
  const req = state.approval_requests.find((r) => r.token === input.token);
  if (!req) return notFound(SERVICE, "request_not_found", "That approval card does not match anything — it may have been withdrawn.");
  if (req.answered_at) {
    return conflict(SERVICE, "already_answered", `Answered already, at ${new Date(req.answered_at).toLocaleString(getActiveLocale())}. Nothing changed.`);
  }
  if (input.answered_by_email !== req.sent_to_email) {
    apply((draft) => {
      writeAudit(draft, {
        service: SERVICE, entity: "pr_line", entity_no: req.token,
        action: "answer_from_chat", outcome: "refused", reason: input.answered_by_email,
      });
    });
    return refused(
      SERVICE, "not_the_addressee",
      `This was sent to ${req.sent_to_email}. An answer from ${input.answered_by_email} is not that person's decision, and recording it as theirs is the mistake this whole route exists to prevent.`,
    );
  }

  const line = state.pr_lines.find((l) => l.id === req.line_id);
  if (!line) return notFound(SERVICE, "line_not_found", "The item this card refers to no longer exists.");
  if (line.removed_at) return conflict(SERVICE, "line_removed", `${line.line_no_full} has been removed since the card was sent.`);

  /* Not capped at what was asked for (D76): the price may have moved between
   * the request and the meeting. */
  const amount = input.approved_amount ?? line.item_total;

  apply((draft) => {
    const r = draft.approval_requests.find((x) => x.id === req.id)!;
    r.answered_at = new Date().toISOString();
    r.outcome = input.approved ? "approved" : "declined";
    if (input.approved) {
      draft.pr_approvals.push({
        id: newId("apr"), line_id: line.id, step: "GOODS",
        approved: true,
        approved_qty: input.approved_qty ?? line.qty,
        approved_amount: amount,
        /* The approver, not the person holding the laptop. */
        recorded_by: req.sent_to, recorded_by_email: req.sent_to_email,
        recorded_at: new Date().toISOString(),
        channel: req.channel,
      });
    }
    if (input.instructions?.trim() || input.remark?.trim()) {
      draft.line_notes.push({
        id: newId("nte"), line_id: line.id,
        instructions: input.instructions?.trim() || null,
        remark: input.remark?.trim() || null,
        recorded_by: req.sent_to, recorded_by_email: req.sent_to_email,
        recorded_at: new Date().toISOString(),
      });
    }
    writeAudit(draft, {
      service: SERVICE, entity: "pr_line", entity_no: line.line_no_full,
      action: input.approved ? "approve" : "decline",
      outcome: "ok", reason: `chat · ${req.sent_to_email}`,
    });
    writeOutbox(draft, {
      service: SERVICE, event_type: "procurement.line.approved",
      payload: { line_no: line.line_no_full, approved: input.approved, amount, channel: "chat" },
    });
  });

  const view = prLineView(getState(), getState().pr_lines.find((l) => l.id === line.id)!);
  remember(SERVICE, endpoint, idempotencyKey, view);
  return ok(SERVICE, view);
}

/** Yes to everything still open in one send, at the amounts asked.
 *
 *  The honest case for it: most items in a meeting are approved as asked, and
 *  making the approver tap fifteen times to say so is how people stop reading
 *  the fifteenth. Anything they want to change, they change first — this only
 *  covers what is left (D70).
 */
export async function answerBatch(
  input: { batch_token: string; answered_by_email: string },
  idempotencyKey?: string,
): Promise<Result<ApprovalBatchView>> {
  await latency();
  const endpoint = `answerBatch:${input.batch_token}`;
  const cached = replayed<ApprovalBatchView>(SERVICE, endpoint, idempotencyKey);
  if (cached) return cached;

  const state = getState();
  const batch = state.approval_batches.find((b) => b.token === input.batch_token);
  if (!batch) return notFound(SERVICE, "batch_not_found", "That card does not match anything — it may have been withdrawn.");
  if (input.answered_by_email !== batch.sent_to_email) {
    apply((draft) => {
      writeAudit(draft, {
        service: SERVICE, entity: "pr_line", entity_no: batch.batch_no,
        action: "answer_from_chat", outcome: "refused", reason: input.answered_by_email,
      });
    });
    return refused(
      SERVICE, "not_the_addressee",
      `This was sent to ${batch.sent_to_email}. An answer from ${input.answered_by_email} is not that person's decision, and recording it as theirs is the mistake this whole route exists to prevent.`,
    );
  }

  const open = state.approval_requests.filter((r) => r.batch_id === batch.id && !r.answered_at);
  if (open.length === 0) {
    return conflict(SERVICE, "already_answered", "Every item in this list has been answered already — nothing changed.");
  }

  apply((draft) => {
    const now = new Date().toISOString();
    for (const req of draft.approval_requests) {
      if (req.batch_id !== batch.id || req.answered_at) continue;
      const line = draft.pr_lines.find((l) => l.id === req.line_id);
      if (!line || line.removed_at) continue;
      req.answered_at = now;
      req.outcome = "approved";
      draft.pr_approvals.push({
        id: newId("apr"), line_id: line.id, step: "GOODS",
        approved: true, approved_qty: line.qty, approved_amount: line.item_total,
        recorded_by: batch.sent_to, recorded_by_email: batch.sent_to_email,
        recorded_at: now, channel: batch.channel,
      });
      writeAudit(draft, {
        service: SERVICE, entity: "pr_line", entity_no: line.line_no_full,
        action: "approve", outcome: "ok", reason: `chat · ${batch.sent_to_email} · ${batch.batch_no}`,
      });
      writeOutbox(draft, {
        service: SERVICE, event_type: "procurement.line.approved",
        payload: { line_no: line.line_no_full, approved: true, amount: line.item_total, channel: "chat" },
      });
    }
  });

  const view = batchViews(getState()).find((b) => b.id === batch.id)!;
  remember(SERVICE, endpoint, idempotencyKey, view);
  return ok(SERVICE, view);
}

/** Leadership writing on a line without deciding it.
 *
 *  Separate from `approveLine` because the useful case is the undecided line:
 *  "get another quote before you order this" is an instruction, and making
 *  somebody approve the line before they can say it would be exactly backwards
 *  (D64). Append-only — a new note never erases the previous one.
 */
export async function noteLine(
  input: { line_no: string; instructions?: string | null; remark?: string | null },
  idempotencyKey?: string,
): Promise<Result<PrLineView>> {
  await latency();
  const endpoint = `noteLine:${input.line_no}`;
  const cached = replayed<PrLineView>(SERVICE, endpoint, idempotencyKey);
  if (cached) return cached;

  const denied = requireAuthority(SERVICE, "approve_goods");
  if (denied) return denied;

  const state = getState();
  const line = state.pr_lines.find((l) => l.line_no_full === input.line_no);
  if (!line) return notFound(SERVICE, "line_not_found", `Line ${input.line_no} not found.`);
  if (!input.instructions?.trim() && !input.remark?.trim()) {
    return invalid(SERVICE, "note_empty", "There is nothing to record — write an instruction or a remark.", { field: "instructions" });
  }

  const user = actingUser();
  apply((draft) => {
    draft.line_notes.push({
      id: newId("nte"), line_id: line.id,
      instructions: input.instructions?.trim() || null,
      remark: input.remark?.trim() || null,
      recorded_by: user.id, recorded_by_email: user.email,
      recorded_at: new Date().toISOString(),
    });
    writeAudit(draft, {
      service: SERVICE, entity: "pr_line", entity_no: input.line_no,
      action: "note", outcome: "ok", reason: null,
    });
  });

  const view = prLineView(getState(), getState().pr_lines.find((l) => l.id === line.id)!);
  remember(SERVICE, endpoint, idempotencyKey, view);
  return ok(SERVICE, view);
}

/** Removed because it is no longer needed. No deadline, nothing ages out —
 *  but refused once money has reached the line, because past that point the
 *  words are return, credit or void, never a quiet disappearance (D29). */
export async function removeLine(
  input: { line_no: string },
  idempotencyKey?: string,
): Promise<Result<PrLineView>> {
  await latency();
  const endpoint = `removeLine:${input.line_no}`;
  const cached = replayed<PrLineView>(SERVICE, endpoint, idempotencyKey);
  if (cached) return cached;

  const state = getState();
  const line = state.pr_lines.find((l) => l.line_no_full === input.line_no);
  if (!line) return notFound(SERVICE, "line_not_found", `Line ${input.line_no} not found.`);
  if (line.removed_at) {
    return conflict(SERVICE, "already_removed", "This line has already been removed — nothing changed.");
  }

  const covered = lineCoverage(state, line).covered;
  if (covered > 0) {
    return conflict(
      SERVICE, "money_already_allocated",
      `This line has already received Rp ${covered.toLocaleString(getActiveLocale())}. What applies now is a return, a vendor credit, or voiding the transaction — not removal.`,
      { covered },
    );
  }

  const user = actingUser();
  apply((draft) => {
    const l = draft.pr_lines.find((x) => x.id === line.id)!;
    l.removed_at = new Date().toISOString();
    l.removed_by = user.id;
    /* Also pull it out of any round that has not frozen its numbers yet. */
    draft.payment_round_lines = draft.payment_round_lines.filter((rl) => {
      if (rl.line_id !== line.id) return true;
      const round = draft.payment_rounds.find((r) => r.id === rl.round_id);
      return round?.status !== "OPEN";
    });
    writeAudit(draft, { service: SERVICE, entity: "pr_line", entity_no: input.line_no, action: "remove", outcome: "ok", reason: null });
    writeOutbox(draft, { service: SERVICE, event_type: "procurement.line.removed", payload: { line_no: input.line_no } });
  });

  const view = prLineView(getState(), getState().pr_lines.find((l) => l.id === line.id)!);
  remember(SERVICE, endpoint, idempotencyKey, view);
  return ok(SERVICE, view);
}

/* ------------------------------------------------------------------ */
/* Payment rounds                                                      */
/* ------------------------------------------------------------------ */

export interface RoundView extends RoundSummary {
  lines: PrLineView[];
}

function roundView(roundId: string): RoundView | null {
  const state = getState();
  const round = state.payment_rounds.find((r) => r.id === roundId);
  if (!round) return null;
  const lines = state.payment_round_lines
    .filter((rl) => rl.round_id === roundId)
    .map((rl) => state.pr_lines.find((l) => l.id === rl.line_id))
    .filter((l): l is PrLine => !!l)
    .map((l) => prLineView(state, l));
  return { ...roundSummary(state, roundId), lines };
}

export async function listRounds(): Promise<Result<RoundView[]>> {
  await latency();
  const rows = getState().payment_rounds
    .map((r) => roundView(r.id))
    .filter((r): r is RoundView => !!r);
  return ok(SERVICE, rows);
}

export async function getRound(roundNo: string): Promise<Result<RoundView>> {
  await latency();
  const round = getState().payment_rounds.find((r) => r.round_no === roundNo);
  const view = round ? roundView(round.id) : null;
  if (!view) return notFound(SERVICE, "round_not_found", `Round ${roundNo} not found.`);
  return ok(SERVICE, view);
}

/** Rolls every approved-and-still-owed line, from every document and every
 *  requester, into the single OPEN round. Idempotent — safe to call on every
 *  page load, which is why it can be the thing that keeps the round honest. */
export async function syncRound(): Promise<Result<RoundView>> {
  await latency();
  const state = getState();
  let open = state.payment_rounds.find((r) => r.status === "OPEN");

  const eligible = state.pr_lines.filter((line) => {
    if (line.removed_at) return false;
    if (!isApproved(state, line.id)) return false;
    const cov = lineCoverage(state, line);
    if (cov.settled) return false;
    const existing = state.payment_round_lines.find((rl) => rl.line_id === line.id);
    if (!existing) return true;
    const round = state.payment_rounds.find((r) => r.id === existing.round_id);
    /* A line in a closed round that is still owed comes back; a line in a
     * round that has frozen its numbers stays where it is. */
    return round?.status === "CLOSED";
  });

  if (!open && eligible.length === 0) {
    return noop(SERVICE, roundView(state.payment_rounds[0]?.id ?? "") ?? ({} as RoundView));
  }

  let roundId = open?.id ?? "";
  let added = 0;
  apply((draft) => {
    if (!roundId) {
      roundId = newId("rnd");
      draft.payment_rounds.unshift({
        id: roundId, round_no: nextDocNumber(draft, "pay"), status: "OPEN",
        opened_at: new Date().toISOString(), approved_by: null, approved_at: null,
        closed_by: null, closed_at: null,
      });
    }
    for (const line of eligible) {
      const already = draft.payment_round_lines.some(
        (rl) => rl.line_id === line.id && rl.round_id === roundId,
      );
      if (already) continue;
      draft.payment_round_lines.push({
        id: newId("rl"), round_id: roundId, line_id: line.id,
        requested_amount: lineCoverage(draft, line).remaining,
      });
      added += 1;
    }
    if (added > 0) {
      writeAudit(draft, {
        service: SERVICE, entity: "payment_round", entity_no: roundId,
        action: "sync", outcome: "ok", reason: `${added} line(s) rolled in`,
      });
    }
  });

  const view = roundView(roundId)!;
  return added === 0 ? noop(SERVICE, view) : ok(SERVICE, view);
}

export async function approveRound(roundNo: string, idempotencyKey?: string): Promise<Result<RoundView>> {
  await latency();
  const cached = replayed<RoundView>(SERVICE, `approveRound:${roundNo}`, idempotencyKey);
  if (cached) return cached;

  const denied = requireAuthority(SERVICE, "approve_funds");
  if (denied) return denied;

  const round = getState().payment_rounds.find((r) => r.round_no === roundNo);
  if (!round) return notFound(SERVICE, "round_not_found", `Round ${roundNo} not found.`);
  if (round.status !== "OPEN") {
    return conflict(SERVICE, "round_not_open", `Round ${roundNo} is already ${round.status} — nothing changed.`);
  }

  const user = actingUser();
  apply((draft) => {
    const r = draft.payment_rounds.find((x) => x.id === round.id)!;
    r.status = "APPROVED";
    r.approved_by = user.id;
    r.approved_at = new Date().toISOString();
    /* Freeze what was asked. The number stops being a live calculation and
     * becomes the record of a decision. */
    for (const rl of draft.payment_round_lines.filter((x) => x.round_id === round.id)) {
      const line = draft.pr_lines.find((l) => l.id === rl.line_id);
      if (line) rl.requested_amount = lineCoverage(draft, line).remaining;
    }
    writeAudit(draft, { service: SERVICE, entity: "payment_round", entity_no: roundNo, action: "approve", outcome: "ok", reason: null });
    writeOutbox(draft, { service: SERVICE, event_type: "procurement.round.approved", payload: { round_no: roundNo } });
  });
  const view = roundView(round.id)!;
  remember(SERVICE, `approveRound:${roundNo}`, idempotencyKey, view);
  return ok(SERVICE, view);
}

/** Money reaching the accounting account. Deliberately does NOT make any line
 *  PAID: "send money ≠ payment" (A10).
 *
 *  Guarded by `post_ledger`, not `approve_funds` (D78). The funds decision was
 *  approving the round; this is the bookkeeping that follows it, and it is the
 *  same act as writing the two ledger legs — the person who can do one can do
 *  the other. Closing the round is a decision again, so it goes back to
 *  `approve_funds`.
 */
export async function transferRound(
  roundNo: string,
  input: { amount: number; trx_no: string; proof_attachment_id: string },
  idempotencyKey?: string,
): Promise<Result<RoundView>> {
  await latency();
  const cached = replayed<RoundView>(SERVICE, `transferRound:${roundNo}`, idempotencyKey);
  if (cached) return cached;

  const denied = requireAuthority(SERVICE, "post_ledger");
  if (denied) return denied;

  const round = getState().payment_rounds.find((r) => r.round_no === roundNo);
  if (!round) return notFound(SERVICE, "round_not_found", `Round ${roundNo} not found.`);
  if (round.status !== "APPROVED" && round.status !== "TRANSFERRED") {
    return conflict(
      SERVICE, "round_not_approved",
      `Round ${roundNo} is ${round.status}. A round is funded after it is approved and before it is closed.`,
    );
  }
  /* No proof, no transfer (D80). "Transferred" is a claim about the bank, and
   * the old sheet's version of that claim was a tick somebody typed. The same
   * rule already applies to receiving — no photo, no receipt (A15). */
  if (!input.proof_attachment_id) {
    return invalid(
      SERVICE, "evidence_required",
      "A round is funded when there is proof it was funded. Attach the transfer receipt, or point at the money already booked in.",
      { field: "proof_attachment_id" },
    );
  }
  if (input.amount <= 0) {
    return invalid(SERVICE, "amount_positive", "A transfer of nothing is not a transfer.", { field: "amount" });
  }
  /* The same ledger row cannot fund a round twice. Two instalments are two
   * transactions; one transaction counted twice is money invented (A4). */
  const already = getState().round_transfers.find(
    (t) => t.round_id === round.id && t.trx_no === input.trx_no,
  );
  if (already) {
    return conflict(
      SERVICE, "already_counted",
      `${input.trx_no} is already recorded against ${roundNo} — nothing changed.`,
      { amount: already.amount },
    );
  }

  const user = actingUser();
  apply((draft) => {
    const r = draft.payment_rounds.find((x) => x.id === round.id)!;
    /* A round becomes TRANSFERRED on the first instalment: money has moved.
     * Whether it is fully funded is a number, not a status — the screen shows
     * the shortfall and more instalments can follow (D82). */
    r.status = "TRANSFERRED";
    draft.round_transfers.push({
      id: newId("rtf"), round_id: round.id,
      amount: input.amount, trx_no: input.trx_no,
      proof_attachment_id: input.proof_attachment_id,
      recorded_by: user.id, recorded_by_email: user.email,
      recorded_at: new Date().toISOString(),
    });
    writeAudit(draft, {
      service: SERVICE, entity: "payment_round", entity_no: roundNo,
      action: "transfer", outcome: "ok", reason: `${input.trx_no} · ${input.amount}`,
    });
  });
  const view = roundView(round.id)!;
  remember(SERVICE, `transferRound:${roundNo}`, idempotencyKey, view);
  return ok(SERVICE, view);
}

export interface CloseRoundResult {
  round: RoundView;
  /** What closing releases. The step everyone forgets, so the answer says
   *  exactly what it is letting go of. */
  still_owed: PrLineView[];
}

export async function closeRound(roundNo: string, idempotencyKey?: string): Promise<Result<CloseRoundResult>> {
  await latency();
  const cached = replayed<CloseRoundResult>(SERVICE, `closeRound:${roundNo}`, idempotencyKey);
  if (cached) return cached;

  const denied = requireAuthority(SERVICE, "approve_funds");
  if (denied) return denied;

  const state = getState();
  const round = state.payment_rounds.find((r) => r.round_no === roundNo);
  if (!round) return notFound(SERVICE, "round_not_found", `Round ${roundNo} not found.`);
  if (round.status === "CLOSED") {
    return conflict(SERVICE, "already_closed", `Round ${roundNo} is already closed — nothing changed.`);
  }

  const stillOwed = state.payment_round_lines
    .filter((rl) => rl.round_id === round.id)
    .map((rl) => state.pr_lines.find((l) => l.id === rl.line_id))
    .filter((l): l is PrLine => !!l)
    .filter((l) => !lineCoverage(state, l).settled)
    .map((l) => prLineView(state, l));

  const user = actingUser();
  apply((draft) => {
    const r = draft.payment_rounds.find((x) => x.id === round.id)!;
    r.status = "CLOSED";
    r.closed_by = user.id;
    r.closed_at = new Date().toISOString();
    writeAudit(draft, {
      service: SERVICE, entity: "payment_round", entity_no: roundNo, action: "close",
      outcome: "ok", reason: stillOwed.length ? `${stillOwed.length} line(s) still owed` : null,
    });
    writeOutbox(draft, { service: SERVICE, event_type: "procurement.round.closed", payload: { round_no: roundNo, still_owed: stillOwed.length } });
  });

  const result: CloseRoundResult = { round: roundView(round.id)!, still_owed: stillOwed };
  remember(SERVICE, `closeRound:${roundNo}`, idempotencyKey, result);
  return ok(SERVICE, result);
}

/** Everything one vendor has going with us: orders, what arrived, what was
 *  paid, and what they could invoice next (D97). */
export async function getVendorJourney(vendorId: string): Promise<Result<VendorJourney>> {
  await latency();
  const state = getState();
  if (!state.vendors.some((v) => v.id === vendorId)) {
    return notFound(SERVICE, "vendor_not_found", `Vendor ${vendorId} not found.`);
  }
  return ok(SERVICE, vendorJourney(state, vendorId));
}

/** The vendors with orders, worst-unpaid first — the list the journey opens
 *  from. Vendors we have never issued a PO to are not here: this is about
 *  contracts, not about the address book. */
export async function listVendorJourneys(): Promise<Result<VendorJourney[]>> {
  await latency();
  const state = getState();
  const ids = [...new Set(
    state.purchase_orders.filter((p) => p.status !== "CANCELLED").map((p) => p.vendor_id),
  )];
  return ok(SERVICE, ids
    .map((id) => vendorJourney(state, id))
    .sort((a, b) => b.billable_now - a.billable_now || b.outstanding - a.outstanding));
}

/* ------------------------------------------------------------------ */
/* PO and receiving                                                    */
/* ------------------------------------------------------------------ */

export interface PoView extends PurchaseOrder {
  status_view: PoStatusView;
  lines: PoLine[];
  vendor_name: string;
  /** Days past the date the vendor promised, when not everything has arrived.
   *  Null without a promise: nothing is late, it is merely absent (D134). */
  days_late: number | null;
}

/** Issue a purchase order.
 *
 *  Created and issued in one act on purpose: a PO nobody has sent is a
 *  document, not an obligation, and the tracker exists for obligations. The
 *  draft stage stays reachable through `status`, for the case where terms are
 *  still being argued (D100).
 */
export async function createPo(
  input: {
    vendor_id: string;
    lines: { description: string; qty: number; uom: UomCode; unit_price: number }[];
    dp_percent?: number | null;
    note?: string | null;
    /** When the vendor says it will arrive (D134). */
    expected_delivery?: string | null;
  },
  idempotencyKey?: string,
): Promise<Result<PoView>> {
  await latency();
  const cached = replayed<PoView>(SERVICE, "createPo", idempotencyKey);
  if (cached) return cached;

  const state = getState();
  if (!state.vendors.some((v) => v.id === input.vendor_id)) {
    return invalid(SERVICE, "vendor_required", "An order is placed with somebody. Choose the vendor first.", { field: "vendor_id" });
  }
  const lines = input.lines.filter((l) => l.description.trim() && l.qty > 0);
  if (lines.length === 0) {
    return invalid(SERVICE, "lines_required", "An order with no lines is not an order.", { field: "lines" });
  }
  const priceless = lines.find((l) => !l.unit_price);
  if (priceless) {
    return invalid(
      SERVICE, "price_required",
      `"${priceless.description}" has no unit price. A contract value nobody agreed is not a contract.`,
      { field: "lines" },
    );
  }
  if (input.dp_percent != null && (input.dp_percent < 0 || input.dp_percent > 100)) {
    return invalid(SERVICE, "dp_out_of_range", "A deposit is between 0 and 100 per cent.", { field: "dp_percent" });
  }

  const user = actingUser();
  const selfConfirm = user.authorities.includes("approve_goods");
  let poNo = "";
  apply((draft) => {
    poNo = nextDocNumber(draft, "po");
    const poId = newId("po");
    const now = new Date().toISOString();
    /* Always a draft. An order is a promise made to a supplier in the
       company's name, so leadership confirms it before it is sent — which
       means creating one cannot also send it (D132, narrowing D100). */
    draft.purchase_orders.unshift({
      id: poId, po_no: poNo, vendor_id: input.vendor_id,
      status: "DRAFT",
      created_at: now,
      issued_at: null,
      issued_by: null,
      note: input.note?.trim() || null,
      expected_delivery: input.expected_delivery || null,
      approval_asked_at: null, approval_asked_by: null,
      approval_sent_to: null, approval_token: null,
      /* The second road (D267): when the person writing the order already
         holds the authority to confirm it, the order is confirmed in the same
         act. Sending them a chat card asking themselves is theatre — and
         theatre in an approval trail is worse than nothing, because it makes a
         rubber stamp look like a second pair of eyes.

         It stays a DRAFT and still has to be issued deliberately, and the
         confirmation still falls away the moment a line is edited (D135), so
         this removes a click and never a decision. `self_confirmed` is
         **stored**: *approved by Evin* and *written and approved by Evin in
         one act* are different facts about how a decision was taken, and the
         second is the one an auditor asks about. */
      self_confirmed: selfConfirm,
      approved_at: selfConfirm ? now : null,
      approved_by: selfConfirm ? user.id : null,
      approval_note: null,
      revision: 0, sent_revision: 0,
    });
    lines.forEach((l, i) => {
      draft.po_lines.push({
        id: newId("pol"), po_id: poId, line_no: i + 1, item_id: null,
        description: l.description.trim(), qty: l.qty, uom: l.uom,
        unit_price: l.unit_price, line_total: Math.round(l.qty * l.unit_price),
        superseded_by: null,
      });
    });
    if (input.dp_percent) {
      draft.po_schedule.push({
        id: newId("pos"), po_id: poId, term_no: `${poNo}-M01`, kind: "DP",
        basis: "percent", basis_value: input.dp_percent, due_rule: "on_issue", due_date: null,
      });
      draft.po_schedule.push({
        id: newId("pos"), po_id: poId, term_no: `${poNo}-M02`, kind: "FINAL",
        basis: "percent", basis_value: 100 - input.dp_percent, due_rule: "on_delivery", due_date: null,
      });
    }
    writeAudit(draft, {
      service: SERVICE, entity: "purchase_order", entity_no: poNo,
      action: "create", outcome: "ok", reason: null,
      detail: { lines: lines.length, expected_delivery: input.expected_delivery ?? null },
    });
    if (selfConfirm) {
      /* Its own audit row, not a field on the creation row: the confirmation
         is a separate act with its own consequences, and it has to be findable
         by somebody reading the approval trail rather than the creation one. */
      writeAudit(draft, {
        service: SERVICE, entity: "purchase_order", entity_no: poNo,
        action: "approve", outcome: "ok",
        reason: "dikonfirmasi sendiri saat dibuat — pembuatnya memegang approve_goods",
        detail: { by: user.email, self_confirmed: true, contract_value: lines.reduce((t, l) => t + Math.round(l.qty * l.unit_price), 0) },
      });
    }
  });

  const view = (await getPo(poNo));
  if (view.data) remember(SERVICE, "createPo", idempotencyKey, view.data);
  return view;
}

export async function listPo(): Promise<Result<PoView[]>> {
  await latency();
  const state = getState();
  return ok(SERVICE, state.purchase_orders.map((po) => ({
    ...po,
    status_view: poStatus(state, po.id),
    lines: state.po_lines.filter((l) => l.po_id === po.id && l.superseded_by === null),
    vendor_name: state.vendors.find((v) => v.id === po.vendor_id)?.name ?? "—",
    days_late: poDetail(state, po.id)?.days_late ?? null,
  })));
}

export async function getPo(poNo: string): Promise<Result<PoView>> {
  await latency();
  const state = getState();
  const po = state.purchase_orders.find((p) => p.po_no === poNo);
  if (!po) return notFound(SERVICE, "po_not_found", `PO ${poNo} not found.`);
  return ok(SERVICE, {
    ...po,
    status_view: poStatus(state, po.id),
    lines: state.po_lines.filter((l) => l.po_id === po.id && l.superseded_by === null),
    vendor_name: state.vendors.find((v) => v.id === po.vendor_id)?.name ?? "—",
    days_late: poDetail(state, po.id)?.days_late ?? null,
  });
}

/** A photo is mandatory. A problem condition leaves the line open and says who
 *  was told — the system never quietly closes a problem delivery (A18). */
export async function createReceipt(
  input: {
    line_no?: string | null;
    po_line_id?: string | null;
    qty_received: number;
    condition: ReceiptCondition;
    /** Both required: the photo of the goods and the signed tanda terima. */
    documents: { attachment_id: string; kind: DocKind }[];
    /** Who checked it, when that is not the person recording it. */
    qc_by?: string | null;
    note?: string | null;
  },
  idempotencyKey?: string,
): Promise<Result<{ receipt: Receipt; notified: boolean }>> {
  await latency();
  const endpoint = `createReceipt:${input.line_no ?? input.po_line_id}:${input.qty_received}`;
  const cached = replayed<{ receipt: Receipt; notified: boolean }>(SERVICE, endpoint, idempotencyKey);
  if (cached) return cached;

  /* The photo is always required: without it there is no evidence anything
   * arrived at all, and that is the one thing the person standing there can
   * always produce.
   *
   * The tanda terima is required to **confirm**, not to report (D131,
   * superseding half of D101). Goods from outside arrive at night, when the
   * people with the app open are asleep; refusing the report until the signed
   * paper exists does not produce the paper, it loses the arrival. So a report
   * without it is recorded as REPORTED and counts for nothing until
   * procurement completes it. */
  const kinds = input.documents?.map((d) => d.kind) ?? [];
  if (!kinds.includes("Receiving Item")) {
    return invalid(
      SERVICE, "photo_required",
      "A photograph of what arrived is required — it is the one thing whoever is there can always produce.",
      { field: "documents" },
    );
  }
  const confirmed = kinds.includes("Delivery Note");
  if (!input.line_no && !input.po_line_id) {
    return invalid(SERVICE, "anchor_required", "A receiving report must point at a PR line or a PO line.", { field: "line_no" });
  }

  const state = getState();
  const line = input.line_no ? state.pr_lines.find((l) => l.line_no_full === input.line_no) : null;
  if (input.line_no && !line) return notFound(SERVICE, "line_not_found", `Line ${input.line_no} not found.`);

  const user = actingUser();
  const receipt: Receipt = {
    id: newId("rcp"), receipt_no: `rcv-${new Date().toISOString().slice(2, 10)}_01`,
    line_id: line?.id ?? null, po_line_id: input.po_line_id ?? null,
    qty_received: input.qty_received, condition: input.condition,
    received_by: user.id, received_at: new Date().toISOString(),
    qc_by: confirmed ? input.qc_by ?? user.id : null, note: input.note ?? null,
    status: confirmed ? "CONFIRMED" : "REPORTED",
    confirmed_by: confirmed ? user.id : null,
    confirmed_at: confirmed ? new Date().toISOString() : null,
  };
  const notified = PROBLEM_CONDITIONS.includes(input.condition);

  apply((draft) => {
    draft.receipts.push(receipt);
    for (const d of input.documents) {
      draft.attachment_links.push({
        id: newId("lnk"), attachment_id: d.attachment_id,
        entity: "receipt", entity_no: receipt.receipt_no,
        kind: d.kind, linked_by: user.id, linked_at: new Date().toISOString(),
      });
    }
    writeAudit(draft, {
      service: SERVICE, entity: "receipt", entity_no: receipt.receipt_no,
      action: confirmed ? "receive" : "report",
      outcome: "ok",
      reason: notified ? `condition ${input.condition} — line stays open` : null,
      detail: { status: receipt.status, qty: input.qty_received, condition: input.condition },
    });
    writeOutbox(draft, {
      service: SERVICE, event_type: "procurement.receipt.recorded",
      payload: { receipt_no: receipt.receipt_no, condition: input.condition, notified, status: receipt.status },
    });
  });

  const result = { receipt, notified };
  remember(SERVICE, endpoint, idempotencyKey, result);
  return ok(SERVICE, result);
}

/* ------------------------------------------------------------------ */
/* Reference data — curation                                           */
/* ------------------------------------------------------------------ */

function vendorView(state: ReturnType<typeof getState>, v: Vendor): VendorView {
  const absorbed = state.vendors.filter((x) => x.merged_into === v.id);
  const ids = new Set([v.id, ...absorbed.map((a) => a.id)]);
  const trx = state.transactions.filter((t) => t.vendor_id && ids.has(t.vendor_id) && t.status !== "VOID");
  return {
    ...v,
    supplied_category_names: v.supplied_categories.map(
      (c) => state.item_categories.find((x) => x.code === c)?.name ?? c,
    ),
    transaction_count: trx.length,
    total_spend: trx.filter((t) => t.direction === "OUT").reduce((s, t) => s + t.amount_idr, 0),
    last_purchase: trx.map((t) => t.trx_date).sort().pop() ?? null,
    open_pr_lines: state.pr_lines.filter((l) => l.vendor_id && ids.has(l.vendor_id) && !l.removed_at).length,
    absorbed,
    bought_categories: boughtCategories(state, v.id),
    items_bought: itemsBoughtFrom(state, v.id),
  };
}

/** Search reaches past the vendor's own name into what they supply and what we
 *  have actually bought from them — so typing "thinner" finds the vendor rather
 *  than requiring someone to already know which one it is. */
export async function listVendorViews(opts: { q?: string } = {}): Promise<Result<VendorView[]>> {
  await latency();
  const state = getState();
  let rows = state.vendors.filter((v) => !v.merged_into);

  if (opts.q) {
    const q = opts.q.toLowerCase();
    const facts = purchaseFacts(state);
    const categoryName = (code: string) =>
      (state.item_categories.find((c) => c.code === code)?.name ?? code).toLowerCase();

    rows = rows.filter((v) => {
      if (v.name.toLowerCase().includes(q)) return true;
      if (v.aka.some((a) => a.toLowerCase().includes(q))) return true;
      if (v.pic_name?.toLowerCase().includes(q)) return true;
      if (v.supplied_categories.some((c) => c.includes(q) || categoryName(c).includes(q))) return true;
      /* …and the items we have bought from them. */
      return facts.some((f) => f.vendor_id === v.id && (
        f.item_name.toLowerCase().includes(q) || categoryName(f.category_code).includes(q)
      ));
    });
  }
  return ok(SERVICE, rows.map((v) => vendorView(state, v)));
}

export async function getVendor(id: string): Promise<Result<VendorView>> {
  await latency();
  const state = getState();
  const v = state.vendors.find((x) => x.id === id);
  if (!v) return notFound(SERVICE, "vendor_not_found", "Vendor not found.");
  return ok(SERVICE, vendorView(state, v));
}

/** Promote to curated: it now appears in dropdowns and in the extractor's list
 *  of names it may treat as canonical. Deliberately a human act — auto-curating
 *  would feed every spelling variant in as if it were the real name. */
export async function curateVendor(id: string, curated: boolean): Promise<Result<VendorView>> {
  await latency();
  const v = getState().vendors.find((x) => x.id === id);
  if (!v) return notFound(SERVICE, "vendor_not_found", "Vendor not found.");
  if (v.is_curated === curated) {
    return conflict(SERVICE, "already_set", `Already ${curated ? "curated" : "uncurated"} — nothing changed.`);
  }
  apply((draft) => {
    draft.vendors.find((x) => x.id === id)!.is_curated = curated;
    writeAudit(draft, { service: SERVICE, entity: "vendor", entity_no: v.code, action: curated ? "curate" : "uncurate", outcome: "ok", reason: null });
  });
  return ok(SERVICE, vendorView(getState(), getState().vendors.find((x) => x.id === id)!));
}

/** Merge a duplicate spelling into the real vendor.
 *
 *  The absorbed row is KEPT and marked, never deleted: every transaction that
 *  pointed at it still points at it, so history does not move when somebody
 *  corrects a name years later (D4). Readers follow `merged_into`.
 *
 *  Only ever a human decision. Two spellings differing by nothing but spacing
 *  are one thing; two differing by a WORD are a question, and the answer is
 *  not the machine's.
 */
export async function mergeVendor(loserId: string, winnerId: string): Promise<Result<VendorView>> {
  await latency();
  const state = getState();
  const loser = state.vendors.find((v) => v.id === loserId);
  const winner = state.vendors.find((v) => v.id === winnerId);
  if (!loser || !winner) return notFound(SERVICE, "vendor_not_found", "Vendor not found.");
  if (loserId === winnerId) return invalid(SERVICE, "same_vendor", "A vendor cannot be merged into itself.", { field: "winner" });
  if (loser.merged_into) return conflict(SERVICE, "already_merged", `${loser.name} has already been merged.`);

  apply((draft) => {
    const l = draft.vendors.find((v) => v.id === loserId)!;
    const w = draft.vendors.find((v) => v.id === winnerId)!;
    l.merged_into = winnerId;
    for (const spelling of [l.name, ...l.aka]) {
      if (!w.aka.includes(spelling) && spelling !== w.name) w.aka.push(spelling);
    }
    writeAudit(draft, { service: SERVICE, entity: "vendor", entity_no: l.code, action: "merge", outcome: "ok", reason: `into ${w.name}` });
    writeOutbox(draft, { service: SERVICE, event_type: "procurement.vendor.merged", payload: { loser: l.name, winner: w.name } });
  });
  return ok(SERVICE, vendorView(getState(), getState().vendors.find((v) => v.id === winnerId)!));
}

function itemView(state: ReturnType<typeof getState>, i: Item): ItemView {
  return {
    ...i,
    category_name: state.item_categories.find((c) => c.code === i.category_code)?.name ?? i.category_code,
    last_vendor_name: state.vendors.find((v) => v.id === i.last_vendor_id)?.name ?? null,
    suggested_price: i.standard_price ?? i.last_price,
    sourced_from: itemSources(state, i.id),
    purchase_count: state.transaction_lines.filter((l) => l.item_id === i.id).length
      + state.pr_lines.filter((l) => l.item_id === i.id).length,
  };
}

export async function listItemViews(
  opts: { q?: string; category?: string; curated?: boolean } = {},
): Promise<Result<ItemView[]>> {
  await latency();
  const state = getState();
  let rows = state.items.filter((i) => !i.merged_into);
  if (opts.q) {
    const q = opts.q.toLowerCase();
    rows = rows.filter((i) => i.name.toLowerCase().includes(q) || i.code.toLowerCase().includes(q));
  }
  if (opts.category) rows = rows.filter((i) => i.category_code === opts.category);
  /* The other half of the curation rule: a list is where "not yet curated"
   * means "shown and marked", and a DROPDOWN is where it means "absent". */
  if (opts.curated !== undefined) rows = rows.filter((i) => i.is_curated === opts.curated);
  return ok(SERVICE, rows.map((i) => itemView(state, i)));
}

export async function createItem(
  input: { name: string; base_uom: UomCode; category_code?: string; kind?: "goods" | "service" },
  idempotencyKey?: string,
): Promise<Result<ItemView>> {
  await latency();
  const cached = replayed<ItemView>(SERVICE, "createItem", idempotencyKey);
  if (cached) return cached;

  const name = input.name.trim();
  if (!name) return invalid(SERVICE, "name_required", "Item name is required.", { field: "name" });
  const existing = getState().items.find((i) => i.name.toLowerCase() === name.toLowerCase());
  if (existing) return conflict(SERVICE, "item_exists", `"${existing.name}" already exists — nothing changed.`, { item_id: existing.id });

  const item: Item = {
    id: newId("itm"),
    code: `ITM-${String(getState().items.length + 1).padStart(4, "0")}`,
    name, aka: [], category_code: input.category_code ?? "uncurated",
    base_uom: input.base_uom, kind: input.kind ?? "goods",
    /* Born uncurated: recorded, visible here, and absent from dropdowns until
     * a human says it is a real catalogue entry. */
    is_curated: false,
    standard_price: null, last_price: null, last_vendor_id: null, last_purchased_at: null,
    merged_into: null,
  };
  apply((draft) => {
    draft.items.push(item);
    writeAudit(draft, { service: SERVICE, entity: "item", entity_no: item.code, action: "create", outcome: "ok", reason: null });
  });
  const view = itemView(getState(), item);
  remember(SERVICE, "createItem", idempotencyKey, view);
  return ok(SERVICE, view);
}

export async function curateItem(
  id: string,
  input: { curated: boolean; category_code?: string; standard_price?: number | null },
): Promise<Result<ItemView>> {
  await latency();
  const item = getState().items.find((i) => i.id === id);
  if (!item) return notFound(SERVICE, "item_not_found", "Item not found.");
  if (input.standard_price != null && input.standard_price < 0) {
    return invalid(SERVICE, "price_negative", "A standard price cannot be negative.", { field: "standard_price" });
  }
  apply((draft) => {
    const i = draft.items.find((x) => x.id === id)!;
    i.is_curated = input.curated;
    if (input.category_code) i.category_code = input.category_code;
    /* `standard_price` is the curated price and is only ever set by a person.
     * `last_price` is a trace of what was actually paid and is never edited
     * here — conflating them is how a one-off panic purchase becomes the
     * official price. */
    if (input.standard_price !== undefined) i.standard_price = input.standard_price;
    writeAudit(draft, { service: SERVICE, entity: "item", entity_no: i.code, action: "curate", outcome: "ok", reason: null });
  });
  return ok(SERVICE, itemView(getState(), getState().items.find((i) => i.id === id)!));
}

/** Contact and banking details. Kept apart from curation: knowing who to call
 *  does not make a vendor canonical, and a curated vendor with no phone number
 *  is still a gap worth seeing. */
export async function updateVendorContact(
  id: string,
  input: Partial<Pick<Vendor,
    "pic_name" | "pic_phone" | "phone" | "address" |
    "bank_account" | "bank_account_secondary" | "npwp" | "supplied_categories">>,
): Promise<Result<VendorView>> {
  await latency();
  const v = getState().vendors.find((x) => x.id === id);
  if (!v) return notFound(SERVICE, "vendor_not_found", "Vendor not found.");
  apply((draft) => {
    Object.assign(draft.vendors.find((x) => x.id === id)!, input);
    writeAudit(draft, { service: SERVICE, entity: "vendor", entity_no: v.code, action: "update_contact", outcome: "ok", reason: null });
  });
  return ok(SERVICE, vendorView(getState(), getState().vendors.find((x) => x.id === id)!));
}

/** "We need thinner — where do we buy it?" asked directly, without going
 *  through a vendor record at all. */
export async function whereToBuy(query: string): Promise<Result<ItemView[]>> {
  await latency();
  const state = getState();
  const q = query.trim().toLowerCase();
  if (!q) return ok(SERVICE, []);
  const rows = state.items
    .filter((i) => !i.merged_into && i.name.toLowerCase().includes(q))
    .map((i) => itemView(state, i))
    .filter((i) => i.sourced_from.length > 0);
  return ok(SERVICE, rows);
}

/* ------------------------------------------------------------------ */
/* Draft editing                                                       */
/* ------------------------------------------------------------------ */

/** Change a line for as long as nobody has approved it.
 *
 *  The rule used to be "drafts only" (D51). The owner's rule is simpler and
 *  matches how the work actually goes: **a request is editable until it is
 *  approved** (D66). Somebody spots the wrong quantity an hour after
 *  submitting, and making them remove the line and file it again — losing its
 *  place in the queue and its number — is bureaucracy the old spreadsheet
 *  never imposed either.
 *
 *  Three doors close it, and each is a real event rather than a phase:
 *  approval (the amount is now somebody's decision), payment (money has moved
 *  against these numbers) and removal.
 *
 *  What the edit costs is answered rather than avoided: the previous values go
 *  into the audit row, so a line that was 60 litres when the CEO read it and
 *  is 80 now says so.
 */
export async function updateLine(
  lineNo: string,
  input: Partial<Pick<PrLineRow,
    "description" | "qty" | "uom" | "unit_price" | "vendor_id" | "category" | "purpose" | "need_by"
    | "item_id" | "item_total">>,
): Promise<Result<PrLineView>> {
  await latency();
  const state = getState();
  const line = state.pr_lines.find((l) => l.line_no_full === lineNo);
  if (!line) return notFound(SERVICE, "line_not_found", `Line ${lineNo} not found.`);

  if (line.removed_at) {
    return conflict(SERVICE, "line_removed", `Line ${lineNo} has been removed. Ask for it again rather than editing it back to life.`);
  }
  if (isApproved(state, line.id)) {
    return conflict(
      SERVICE, "already_approved",
      `${lineNo} has been approved. Editing it now would rewrite what the approver said yes to — ask the CEO to un-approve it first, or remove it and ask again.`,
    );
  }
  const covered = lineCoverage(state, line).covered;
  if (covered > 0) {
    return conflict(
      SERVICE, "already_paid",
      `${covered.toLocaleString(getActiveLocale())} has already been paid against ${lineNo}. Past that point the words are return, credit or void — never an edit.`,
    );
  }

  const before = {
    description: line.description, qty: line.qty, uom: line.uom,
    unit_price: line.unit_price, purpose: line.purpose, need_by: line.need_by,
    vendor_id: line.vendor_id, category: line.category,
  } as Record<string, unknown>;
  const changed = Object.entries(input)
    .filter(([k, v]) => before[k] !== v)
    .map(([k, v]) => `${k}: ${String(before[k] ?? "—")} → ${String(v ?? "—")}`)
    .join("; ");

  apply((draft) => {
    const l = draft.pr_lines.find((x) => x.id === line.id)!;
    Object.assign(l, input);
    /* The amount is quantity × price when there is a quantity and a price, and
     * whatever the caller says otherwise. Plenty of real lines have neither —
     * a service, a delivery charge, a lump sum quoted by the vendor — and
     * recomputing those from a missing quantity would silently zero the one
     * number that mattered (D75). */
    if (input.item_total === undefined) {
      l.item_total = l.qty != null && l.unit_price != null
        ? Math.round(l.qty * l.unit_price)
        : l.item_total;
    }
    writeAudit(draft, {
      service: SERVICE, entity: "pr_line", entity_no: lineNo,
      action: "edit_line", outcome: "ok",
      /* The old values, not just the fact that something changed. */
      reason: changed || null,
    });
  });
  return ok(SERVICE, prLineView(getState(), getState().pr_lines.find((l) => l.id === line.id)!));
}

export async function addDraftLine(docNo: string, input: NewLineInput): Promise<Result<PrLineView>> {
  await latency();
  const state = getState();
  const doc = state.pr_documents.find((d) => d.doc_no === docNo);
  if (!doc) return notFound(SERVICE, "pr_not_found", `Document ${docNo} not found.`);
  if (doc.status !== "DRAFT") {
    return conflict(SERVICE, "not_a_draft", `${docNo} has already been submitted.`);
  }
  if (!input.description?.trim()) {
    return invalid(SERVICE, "description_required", "A line needs a description.", { field: "description" });
  }

  let newId_ = "";
  apply((draft) => {
    const lineNo = draft.pr_lines.filter((l) => l.doc_id === doc.id).length + 1;
    newId_ = newId("prl");
    draft.pr_lines.push({
      id: newId_, doc_id: doc.id, line_no: lineNo,
      line_no_full: `${docNo}-L${String(lineNo).padStart(2, "0")}`,
      source_wo_no: input.source_wo_no ?? null,
      item_id: input.item_id ?? null, description: input.description.trim(),
      qty: input.qty ?? null, uom: input.uom ?? null, unit_price: input.unit_price ?? null,
      item_total: input.item_total ?? Math.round((input.qty ?? 0) * (input.unit_price ?? 0)),
      vendor_id: input.vendor_id ?? null, po_line_id: null,
      category: input.category ?? null, purpose: input.purpose ?? null,
      need_by: input.need_by ?? null, removed_at: null, removed_by: null,
    });
    writeAudit(draft, { service: SERVICE, entity: "pr_line", entity_no: docNo, action: "add_draft_line", outcome: "ok", reason: null });
  });
  return ok(SERVICE, prLineView(getState(), getState().pr_lines.find((l) => l.id === newId_)!));
}

/* ------------------------------------------------------------------ */
/* Variance                                                            */
/* ------------------------------------------------------------------ */

/** What accounting needs to post a ledger row from this line, without reaching
 *  into procurement's tables. In Phase 2 this is
 *  `GET /procurement/pr/lines/{line_no}` and the caller is a fetch (ADR-004). */
export async function lineForPosting(lineNo: string): Promise<Result<{
  line_no: string;
  description: string;
  approved_amount: number;
  qty: number | null;
  uom: string | null;
  unit_price: number | null;
  vendor_id: string | null;
  project_id: string | null;
  already_covered: number;
  removed: boolean;
}>> {
  const state = getState();
  const line = state.pr_lines.find((l) => l.line_no_full === lineNo);
  if (!line) return notFound(SERVICE, "line_not_found", `Line ${lineNo} not found.`);
  const doc = state.pr_documents.find((d) => d.id === line.doc_id);
  const cov = lineCoverage(state, line);
  const approval = currentApproval(state, line.id);
  return ok(SERVICE, {
    line_no: lineNo,
    description: line.description,
    approved_amount: approval?.approved ? approval.approved_amount ?? line.item_total : line.item_total,
    /* The detail travels with it: a ledger row for a purchase has to say what
     * was bought, how many and at what price (D86). */
    qty: approval?.approved ? approval.approved_qty ?? line.qty : line.qty,
    uom: line.uom,
    unit_price: line.unit_price,
    vendor_id: line.vendor_id,
    project_id: doc?.project_id ?? null,
    already_covered: cov.covered,
    removed: !!line.removed_at,
  });
}

/** Every line where what was paid is not what was approved, whether the line
 *  is still open or long finished.
 *
 *  Deliberately not filtered to open lines: a difference does not stop being a
 *  difference because the line closed, and the question leadership asks is
 *  about the pattern across months, not about this week's board.
 */
export async function listVariances(): Promise<Result<PrLineView[]>> {
  await latency();
  const state = getState();
  return ok(SERVICE, state.pr_lines
    .filter((l) => {
      const doc = state.pr_documents.find((d) => d.id === l.doc_id);
      return doc && doc.status !== "CANCELLED" && doc.status !== "DRAFT" && !l.removed_at;
    })
    .map((l) => prLineView(state, l))
    .filter((l) => l.variance.material)
    .sort((a, b) => Math.abs(b.variance.delta) - Math.abs(a.variance.delta)));
}

/** Explain why what was paid is not what was approved.
 *
 *  Append-only: a correction is a new statement, not an edit of the old one.
 *  The reason is from a closed list so the KINDS can be counted — one variance
 *  tells you nothing, and a pattern tells you everything.
 */
export async function explainVariance(
  input: { line_no: string; reason: VarianceReason; note?: string },
  idempotencyKey?: string,
): Promise<Result<PrLineView>> {
  await latency();
  const endpoint = `explainVariance:${input.line_no}`;
  const cached = replayed<PrLineView>(SERVICE, endpoint, idempotencyKey);
  if (cached) return cached;

  const state = getState();
  const line = state.pr_lines.find((l) => l.line_no_full === input.line_no);
  if (!line) return notFound(SERVICE, "line_not_found", `Line ${input.line_no} not found.`);

  const v = varianceOf(state, line);
  if (!v.material) {
    return conflict(
      SERVICE, "no_variance",
      "There is nothing to explain — what was paid matches what was approved, within rounding.",
    );
  }
  if (input.reason === "other" && !input.note?.trim()) {
    return invalid(SERVICE, "note_required", "“Something else” needs a sentence saying what.", { field: "note" });
  }

  const user = actingUser();
  /* An underpayment explained by anything except "more to come" is a decision
   * that the line is finished cheaper than approved. That decision is a
   * settlement — the same row a human would otherwise have to write twice —
   * so the explanation closes the line instead of leaving it owed forever
   * (A12: a shortfall closes by a named reason, never by a silent tolerance). */
  const settles = v.kind === "under" && input.reason !== "partial_payment";
  apply((draft) => {
    draft.line_variances.push({
      id: newId("var"), line_id: line.id, reason: input.reason,
      note: input.note?.trim() || null,
      amount_at_time: v.delta,
      recorded_by: user.id, recorded_by_email: user.email,
      recorded_at: new Date().toISOString(),
    });
    if (settles && !draft.line_settlements.some((s) => s.line_id === line.id)) {
      draft.line_settlements.push({
        id: newId("stl"), line_id: line.id, shortfall: Math.abs(v.delta),
        reason: `${VARIANCE_REASON_LABEL[input.reason]}${input.note?.trim() ? ` — ${input.note.trim()}` : ""}`,
        decided_by: user.id, decided_at: new Date().toISOString(),
      });
    }
    writeAudit(draft, {
      service: SERVICE, entity: "pr_line", entity_no: input.line_no,
      action: "explain_variance", outcome: "ok", reason: input.reason,
    });
    writeOutbox(draft, {
      service: SERVICE, event_type: "procurement.variance.explained",
      payload: { line_no: input.line_no, reason: input.reason, delta: v.delta },
    });
  });

  const view = prLineView(getState(), getState().pr_lines.find((l) => l.id === line.id)!);
  remember(SERVICE, endpoint, idempotencyKey, view);
  return ok(SERVICE, view);
}

/* ------------------------------------------------------------------ */
/* PO — issue, amend, close                                            */
/* ------------------------------------------------------------------ */

/** Everything about one order, in one call. */
export async function getPoDetail(poNo: string): Promise<Result<PoDetail>> {
  await latency();
  const state = getState();
  const po = state.purchase_orders.find((p) => p.po_no === poNo);
  if (!po) return notFound(SERVICE, "po_not_found", `No purchase order ${poNo}.`);
  const detail = poDetail(state, po.id);
  if (!detail) return notFound(SERVICE, "po_not_found", `No purchase order ${poNo}.`);
  return ok(SERVICE, detail);
}

/** Sending the order.
 *
 *  This is the moment a document becomes an obligation: before it, nothing is
 *  owed however large the contract; after it, the deposit is payable and the
 *  order counts against what we owe suppliers (D99, D100). So it is its own
 *  act with its own audit row, not a side effect of editing.
 */
export async function issuePo(poNo: string, idempotencyKey?: string): Promise<Result<PoDetail>> {
  await latency();
  const cached = replayed<PoDetail>(SERVICE, `issuePo:${poNo}`, idempotencyKey);
  if (cached) return cached;

  const denied = requireModule(SERVICE, "procurement");
  if (denied) return denied;

  const state = getState();
  const po = state.purchase_orders.find((p) => p.po_no === poNo);
  if (!po) return notFound(SERVICE, "po_not_found", `No purchase order ${poNo}.`);
  if (po.status !== "DRAFT") {
    return conflict(SERVICE, "already_issued", `${poNo} is ${po.status} — only a draft can be issued.`);
  }
  const lines = state.po_lines.filter((l) => l.po_id === po.id && l.superseded_by === null);
  if (lines.length === 0) {
    return invalid(SERVICE, "lines_required", "An order with no lines is not an order.", { field: "lines" });
  }
  /* Leadership confirms before the supplier hears about it (D132). */
  if (!po.approved_at) {
    return invalid(
      SERVICE, "approval_required",
      po.approval_asked_at
        ? `${poNo} is still waiting for leadership to confirm it.`
        : `${poNo} has not been confirmed by leadership. Ask for it first — an order is a promise made in the company's name.`,
      { field: "approved_at" },
    );
  }

  const user = actingUser();
  apply((draft) => {
    const row = draft.purchase_orders.find((p) => p.po_no === poNo);
    if (!row) return;
    row.status = "ISSUED";
    row.issued_at = new Date().toISOString();
    row.issued_by = user.id;
    writeAudit(draft, {
      service: SERVICE, entity: "purchase_order", entity_no: poNo,
      action: "issue", outcome: "ok", reason: null,
      detail: { lines: lines.length, contract_value: lines.reduce((s, l) => s + l.line_total, 0) },
    });
    writeOutbox(draft, {
      service: SERVICE, event_type: "procurement.po.issued",
      payload: { po_no: poNo, vendor_id: row.vendor_id },
    });
  });
  const view = await getPoDetail(poNo);
  if (view.data) remember(SERVICE, `issuePo:${poNo}`, idempotencyKey, view.data);
  return view;
}

/** Changing an order that has already been sent.
 *
 *  Never an edit. The old line stays and points at the new one, because "what
 *  did we agree, and when did it change" is a question somebody asks with a
 *  vendor on the phone (D129). A closed order does not move at all.
 */
export async function amendPoLine(
  input: {
    po_no: string;
    line_no: number;
    qty?: number;
    unit_price?: number;
    description?: string;
    reason: string;
  },
): Promise<Result<PoDetail>> {
  await latency();
  const denied = requireModule(SERVICE, "procurement");
  if (denied) return denied;

  const state = getState();
  const po = state.purchase_orders.find((p) => p.po_no === input.po_no);
  if (!po) return notFound(SERVICE, "po_not_found", `No purchase order ${input.po_no}.`);
  if (po.status === "CLOSED" || po.status === "CANCELLED") {
    return conflict(SERVICE, "po_closed", `${input.po_no} is ${po.status}. A finished obligation does not move.`);
  }
  const line = state.po_lines.find(
    (l) => l.po_id === po.id && l.line_no === input.line_no && l.superseded_by === null,
  );
  if (!line) return notFound(SERVICE, "line_not_found", `${input.po_no} has no live line ${input.line_no}.`);
  if (!input.reason.trim()) {
    return invalid(
      SERVICE, "reason_required",
      "An order that has been sent changes for a reason — the vendor raised the price, the site measured again. Write it.",
      { field: "reason" },
    );
  }

  const qty = input.qty ?? line.qty;
  const unit_price = input.unit_price ?? line.unit_price;
  if (qty <= 0 || unit_price <= 0) {
    return invalid(SERVICE, "amount_invalid", "A line has a quantity and a price, both above zero.", { field: "qty" });
  }

  /* Delivered more than the amendment leaves ordered? Allowed, and stated:
     the over-delivery becomes a credit with the vendor (D98) rather than a
     refusal that leaves the order disagreeing with the warehouse. */
  const received = state.receipts
    .filter((r) => r.po_line_id === line.id && COUNTING_CONDITIONS.includes(r.condition))
    .reduce((s, r) => s + r.qty_received, 0);

  const user = actingUser();
  apply((draft) => {
    const row = draft.purchase_orders.find((p) => p.po_no === input.po_no);
    const old = draft.po_lines.find((l) => l.id === line.id);
    if (!old || !row) return;

    /* A confirmation is a yes to particular numbers. Change them and the yes
       no longer refers to anything somebody saw, so it falls away and has to
       be asked for again (D135). Once the order has been *sent*, the vendor
       already has it and re-confirming changes nothing they hold — so an
       issued order is amended without going back to leadership (owner). */
    const droppedApproval = row.status === "DRAFT" && row.approved_at !== null;
    if (droppedApproval) {
      row.approved_at = null;
      row.approved_by = null;
      row.approval_asked_at = null;
      row.approval_asked_by = null;
    }
    /* Sent, and now different from the copy the vendor holds. */
    if (row.status === "ISSUED") row.revision += 1;
    const fresh = {
      ...old,
      id: newId("pol"),
      description: input.description?.trim() || old.description,
      qty,
      unit_price,
      line_total: Math.round(qty * unit_price),
      superseded_by: null as string | null,
    };
    draft.po_lines.push(fresh);
    old.superseded_by = fresh.id;
    /* Receipts follow the live line, or a delivery already recorded would
       vanish from the order it arrived against. */
    draft.receipts.forEach((r) => { if (r.po_line_id === old.id) r.po_line_id = fresh.id; });
    writeAudit(draft, {
      service: SERVICE, entity: "purchase_order", entity_no: input.po_no,
      action: "amend", outcome: "ok", reason: input.reason.trim(),
      detail: {
        line_no: input.line_no,
        before: { qty: old.qty, unit_price: old.unit_price, line_total: old.line_total },
        after: { qty, unit_price, line_total: fresh.line_total },
        already_received: received,
        by: user.email,
        dropped_approval: droppedApproval,
        revision: row.revision,
      },
    });
  });
  return getPoDetail(input.po_no);
}

/** Closing an order.
 *
 *  Refused while either axis disagrees — money and goods are never collapsed
 *  (A1) — or while nothing is filed against it. A settlement with a written
 *  reason is the way out, because real orders end untidily and pretending
 *  otherwise is how they stay open forever.
 */
export async function closePo(
  input: { po_no: string; settle_reason?: string | null },
): Promise<Result<PoDetail>> {
  await latency();
  const denied = requireModule(SERVICE, "procurement");
  if (denied) return denied;

  const state = getState();
  const po = state.purchase_orders.find((p) => p.po_no === input.po_no);
  if (!po) return notFound(SERVICE, "po_not_found", `No purchase order ${input.po_no}.`);
  const detail = poDetail(state, po.id);
  if (!detail) return notFound(SERVICE, "po_not_found", `No purchase order ${input.po_no}.`);

  const fatal = detail.close_blockers.filter(
    (b) => b.startsWith("It is already") || b.startsWith("It was never"),
  );
  if (fatal.length > 0) {
    return conflict(SERVICE, "cannot_close", fatal.join(" "));
  }
  if (detail.close_blockers.length > 0 && !input.settle_reason?.trim()) {
    return invalid(
      SERVICE, "close_refused",
      `${input.po_no} is not finished: ${detail.close_blockers.join(" ")} Close it anyway by saying why — that reason is what somebody reads in six months.`,
      { field: "settle_reason", blockers: detail.close_blockers },
    );
  }

  const user = actingUser();
  apply((draft) => {
    const row = draft.purchase_orders.find((p) => p.po_no === input.po_no);
    if (!row) return;
    row.status = "CLOSED";
    writeAudit(draft, {
      service: SERVICE, entity: "purchase_order", entity_no: input.po_no,
      action: "close", outcome: "ok",
      reason: input.settle_reason?.trim() || null,
      detail: {
        settled_early: detail.close_blockers.length > 0,
        blockers: detail.close_blockers,
        outstanding: detail.status_view.outstanding,
        by: user.email,
      },
    });
    writeOutbox(draft, {
      service: SERVICE, event_type: "procurement.po.closed",
      payload: { po_no: input.po_no, settled_early: detail.close_blockers.length > 0 },
    });
  });
  return getPoDetail(input.po_no);
}

/** Completing a reported arrival.
 *
 *  The report says *it came*, with a photograph, from whoever was standing
 *  there at 23:40. This is procurement doing the part they are accountable
 *  for: the signed tanda terima, who checked it, and what the quantity and
 *  condition actually turned out to be once somebody counted in daylight
 *  (D131).
 *
 *  Until this runs, nothing about the arrival counts as value received. That
 *  is deliberate: an arrival nobody has acknowledged in writing is a fact
 *  worth recording and not yet a thing we owe for.
 */
export async function confirmReceipt(
  input: {
    receipt_no: string;
    /** The signed tanda terima. Required — it is the whole difference. */
    delivery_note_attachment_id: string;
    qc_by?: string | null;
    /** What it turned out to be, when the night count was rough. */
    qty_received?: number;
    condition?: ReceiptCondition;
    note?: string | null;
  },
): Promise<Result<Receipt>> {
  await latency();
  const denied = requireModule(SERVICE, "procurement");
  if (denied) return denied;

  const state = getState();
  const receipt = state.receipts.find((r) => r.receipt_no === input.receipt_no);
  if (!receipt) return notFound(SERVICE, "receipt_not_found", `No receiving report ${input.receipt_no}.`);
  if (receipt.status === "CONFIRMED") {
    return conflict(SERVICE, "already_confirmed", `${input.receipt_no} was already confirmed — nothing changed.`);
  }
  if (!input.delivery_note_attachment_id) {
    return invalid(
      SERVICE, "delivery_note_required",
      "The signed tanda terima is what confirms it. The photo says what arrived; this says we acknowledged it.",
      { field: "delivery_note_attachment_id" },
    );
  }

  const user = actingUser();
  let updated: Receipt | null = null;
  let stocked: { stocked: boolean; why?: string } = { stocked: false };
  apply((draft) => {
    const row = draft.receipts.find((r) => r.receipt_no === input.receipt_no);
    if (!row) return;
    const before = { qty: row.qty_received, condition: row.condition, status: row.status };
    if (input.qty_received != null) row.qty_received = input.qty_received;
    if (input.condition) row.condition = input.condition;
    if (input.note?.trim()) row.note = input.note.trim();
    row.qc_by = input.qc_by ?? user.id;
    row.status = "CONFIRMED";
    row.confirmed_by = user.id;
    row.confirmed_at = new Date().toISOString();
    updated = row;

    draft.attachment_links.push({
      id: newId("lnk"), attachment_id: input.delivery_note_attachment_id,
      entity: "receipt", entity_no: row.receipt_no,
      kind: "Delivery Note", linked_by: user.id, linked_at: new Date().toISOString(),
    });
    writeAudit(draft, {
      service: SERVICE, entity: "receipt", entity_no: row.receipt_no,
      action: "confirm", outcome: "ok", reason: null,
      detail: {
        before,
        after: { qty: row.qty_received, condition: row.condition, status: row.status },
        confirmed_by: user.email,
        /* How long the paper took to catch up — the number that says whether
           this road is working or being used to avoid the paperwork. */
        hours_after_arrival: Math.round(
          (Date.parse(row.confirmed_at ?? "") - Date.parse(row.received_at)) / 3_600_000,
        ),
      },
    });
    writeOutbox(draft, {
      service: SERVICE, event_type: "procurement.receipt.confirmed",
      payload: { receipt_no: row.receipt_no, qty: row.qty_received, condition: row.condition },
    });

    /* Goods that arrived are goods on a rack (D170). In Phase 2 this is the
       consumer of the event written just above; here it is a direct call with
       the same shape, because the alternative — a confirmed delivery that
       leaves no trace in stock — is the gap this whole module exists to close.
       It stocks nothing for a free-text line or an uncounted category, and
       says which, rather than inventing an item to hang the quantity on. */
    stocked = stockFromReceipt(draft, row.receipt_no, user.id, user.email);
  });
  return ok(SERVICE, updated as unknown as Receipt & { stocked?: { stocked: boolean; why?: string } });
}

/** Arrivals somebody reported and nobody has completed — the morning queue. */
export async function listReported(): Promise<Result<(Receipt & {
  description: string; po_no: string | null; vendor_name: string | null; reported_by_name: string;
})[]>> {
  await latency();
  const state = getState();
  const rows = state.receipts
    .filter((r) => r.status === "REPORTED")
    .sort((a, b) => byTime(a.received_at, b.received_at))
    .map((r) => {
      const poLine = state.po_lines.find((l) => l.id === r.po_line_id);
      const po = poLine ? state.purchase_orders.find((p) => p.id === poLine.po_id) : null;
      const prLine = state.pr_lines.find((l) => l.id === r.line_id);
      return {
        ...r,
        description: poLine?.description ?? prLine?.description ?? "—",
        po_no: po?.po_no ?? null,
        vendor_name: po ? state.vendors.find((v) => v.id === po.vendor_id)?.name ?? null : null,
        reported_by_name: state.users.find((u) => u.id === r.received_by)?.full_name ?? r.received_by,
      };
    });
  return ok(SERVICE, rows);
}

/** Asking leadership to confirm an order.
 *
 *  A purchase request is a request to *spend*; a purchase order is a promise
 *  made to a supplier in the company's name, and the two are not the same
 *  decision. So an order is confirmed before it is sent, not after (D132) —
 *  and the ask is its own act, because "it is sitting with the boss" is a
 *  state somebody has to be able to see.
 */
export async function requestPoApproval(
  input: { po_no: string; to?: string },
): Promise<Result<PoDetail>> {
  await latency();
  const denied = requireModule(SERVICE, "procurement");
  if (denied) return denied;

  const state = getState();
  const po = state.purchase_orders.find((p) => p.po_no === input.po_no);
  if (!po) return notFound(SERVICE, "po_not_found", `No purchase order ${input.po_no}.`);
  if (po.status !== "DRAFT") {
    return conflict(SERVICE, "not_a_draft", `${input.po_no} is ${po.status} — only a draft is confirmed.`);
  }
  if (po.approved_at) {
    return conflict(SERVICE, "already_approved", `${input.po_no} has already been confirmed.`);
  }
  const lines = state.po_lines.filter((l) => l.po_id === po.id && l.superseded_by === null);
  if (lines.length === 0) {
    return invalid(SERVICE, "lines_required", "An order with no lines is not an order.", { field: "lines" });
  }
  const approver = state.users.find((u) =>
    input.to ? u.id === input.to : u.authorities.includes("approve_goods"));
  if (!approver) {
    return conflict(SERVICE, "no_approver", "Nobody currently holds the authority to approve goods, so there is no one to ask.");
  }

  const user = actingUser();
  apply((draft) => {
    const row = draft.purchase_orders.find((p) => p.po_no === input.po_no);
    if (!row) return;
    row.approval_asked_at = new Date().toISOString();
    row.approval_asked_by = user.id;
    /* The other half of D267: the question goes out with a token, and the
       answer comes back from the approver's **own** account. Same rule a
       request batch already follows (D69) — a leadership meeting runs on one
       laptop, and ticking a box there records the wrong person. */
    row.approval_sent_to = approver.email;
    row.approval_token = newId("potok");
    writeAudit(draft, {
      service: SERVICE, entity: "purchase_order", entity_no: input.po_no,
      action: "request_approval", outcome: "ok", reason: `→ ${approver.email}`,
      detail: { contract_value: lines.reduce((s, l) => s + l.line_total, 0), lines: lines.length },
    });
    /* The seam, not a second write path: a worker turns this into the chat
       card, exactly as it does for a request batch (ADR-008). */
    writeOutbox(draft, {
      service: SERVICE, event_type: "procurement.po.approval_requested",
      payload: {
        po_no: input.po_no,
        vendor_id: row.vendor_id,
        to: approver.email,
        contract_value: lines.reduce((s, l) => s + l.line_total, 0),
      },
    });
  });
  return getPoDetail(input.po_no);
}

/** Leadership's answer on the order itself. */
export async function approvePo(
  input: { po_no: string; approved: boolean; note?: string | null },
): Promise<Result<PoDetail>> {
  await latency();
  const denied = requireAuthority(SERVICE, "approve_goods");
  if (denied) {
    apply((draft) => {
      writeAudit(draft, {
        service: SERVICE, entity: "purchase_order", entity_no: input.po_no,
        action: "approve", outcome: "refused", reason: "tanpa authority approve_goods",
      });
    });
    return denied;
  }

  const state = getState();
  const po = state.purchase_orders.find((p) => p.po_no === input.po_no);
  if (!po) return notFound(SERVICE, "po_not_found", `No purchase order ${input.po_no}.`);
  if (po.status !== "DRAFT") {
    return conflict(SERVICE, "not_a_draft", `${input.po_no} is ${po.status} — it has already been sent.`);
  }
  if (!input.approved && !input.note?.trim()) {
    return invalid(
      SERVICE, "reason_required",
      "Turning an order down needs a sentence — somebody has to tell the supplier something.",
      { field: "note" },
    );
  }

  const user = actingUser();
  apply((draft) => {
    const row = draft.purchase_orders.find((p) => p.po_no === input.po_no);
    if (!row) return;
    row.approved_at = input.approved ? new Date().toISOString() : null;
    row.approved_by = input.approved ? user.id : null;
    row.approval_note = input.note?.trim() || null;
    writeAudit(draft, {
      service: SERVICE, entity: "purchase_order", entity_no: input.po_no,
      action: input.approved ? "approve" : "decline", outcome: "ok",
      reason: input.note?.trim() ?? null,
      detail: { by: user.email },
    });
  });
  return getPoDetail(input.po_no);
}

/** The date the vendor promised. Changing it is a fact about the vendor, so
 *  it is kept with a reason once the order has been sent (D134). */
export async function setExpectedDelivery(
  input: { po_no: string; expected_delivery: string | null; reason?: string | null },
): Promise<Result<PoDetail>> {
  await latency();
  const denied = requireModule(SERVICE, "procurement");
  if (denied) return denied;

  const state = getState();
  const po = state.purchase_orders.find((p) => p.po_no === input.po_no);
  if (!po) return notFound(SERVICE, "po_not_found", `No purchase order ${input.po_no}.`);
  if (po.status === "ISSUED" && po.expected_delivery && !input.reason?.trim()) {
    return invalid(
      SERVICE, "reason_required",
      "The date was agreed with the supplier. Moving it is something they said — write what they said.",
      { field: "reason" },
    );
  }

  apply((draft) => {
    const row = draft.purchase_orders.find((p) => p.po_no === input.po_no);
    if (!row) return;
    const before = row.expected_delivery;
    row.expected_delivery = input.expected_delivery || null;
    writeAudit(draft, {
      service: SERVICE, entity: "purchase_order", entity_no: input.po_no,
      action: "expected_delivery", outcome: "ok", reason: input.reason?.trim() || null,
      detail: { before, after: row.expected_delivery },
    });
  });
  return getPoDetail(input.po_no);
}

/** Telling the vendor about an amendment.
 *
 *  Amending an issued order does not go back to leadership — the vendor
 *  already has it, and re-confirming changes nothing they hold (owner). What
 *  it does change is that the paper in their hand is now wrong, so the order
 *  carries a **revision** and says *changed, not re-sent* until somebody says
 *  they have sent it (D135). The PDF prints the revision, which is what lets
 *  two pieces of paper be told apart.
 */
export async function markPoResent(poNo: string): Promise<Result<PoDetail>> {
  await latency();
  const denied = requireModule(SERVICE, "procurement");
  if (denied) return denied;

  const state = getState();
  const po = state.purchase_orders.find((p) => p.po_no === poNo);
  if (!po) return notFound(SERVICE, "po_not_found", `No purchase order ${poNo}.`);
  if (po.revision === po.sent_revision) {
    return conflict(SERVICE, "nothing_to_send", `The vendor already has revision ${po.revision} — nothing changed since.`);
  }

  const user = actingUser();
  apply((draft) => {
    const row = draft.purchase_orders.find((p) => p.po_no === poNo);
    if (!row) return;
    row.sent_revision = row.revision;
    writeAudit(draft, {
      service: SERVICE, entity: "purchase_order", entity_no: poNo,
      action: "resend", outcome: "ok", reason: null,
      detail: { revision: row.revision, by: user.email },
    });
  });
  return getPoDetail(poNo);
}

/* ── The second road to a confirmed order (D267) ───────────────────────
 *
 *  W2 named two roads and only one of them existed. When leadership write the
 *  order themselves it is confirmed in the same act — `createPo` does that,
 *  and `self_confirmed` records that it happened that way. When anybody else
 *  writes it, the question goes out on chat **exactly as a request batch
 *  does**, and this is the half that was missing: the card, not the plumbing.
 *
 *  The rule that makes the road worth having is the one D69 already
 *  established: the answer is recorded against the account that gave it. A
 *  leadership meeting runs on one laptop; ticking a box there records the
 *  wrong person, in the one place this system is meant to be trustworthy.
 */

export async function listPoApprovals(
  opts: { for_email?: string; pending?: boolean } = {},
): Promise<Result<PoApprovalView[]>> {
  await latency();
  const state = getState();
  const rows = state.purchase_orders
    .filter((po) => po.approval_token !== null && po.approval_asked_at !== null)
    .filter((po) => !opts.for_email || po.approval_sent_to === opts.for_email)
    .filter((po) => !opts.pending || po.approved_at === null)
    .map((po) => {
      const lines = state.po_lines.filter((l) => l.po_id === po.id && l.superseded_by === null);
      const vendor = state.vendors.find((v) => v.id === po.vendor_id);
      return {
        po_no: po.po_no,
        vendor_name: vendor?.name ?? po.vendor_id,
        vendor_pic: vendor?.pic_name ?? null,
        contract_value: lines.reduce((t, l) => t + l.line_total, 0),
        line_count: lines.length,
        expected_delivery: po.expected_delivery,
        /* The work orders the requests behind this order came from, where
           there are any — so *what is this for* is answerable from the card
           rather than by opening the app (D151). */
        project_codes: [...new Set(
          state.pr_lines
            .filter((l) => lines.some((pl) => pl.id === l.po_line_id))
            .map((l) => l.source_wo_no)
            .filter((c): c is string => !!c),
        )],
        asked_at: po.approval_asked_at!,
        asked_by_email: state.users.find((u) => u.id === po.approval_asked_by)?.email ?? "—",
        sent_to_email: po.approval_sent_to ?? "—",
        token: po.approval_token!,
        answered: po.approved_at !== null,
      };
    })
    .sort((a, b) => b.asked_at.localeCompare(a.asked_at));
  return ok(SERVICE, rows);
}

/** Leadership's answer, arriving from the chat card rather than the app.
 *
 *  Deliberately **not** `requireAuthority`: the acting session is the chat
 *  worker, not the approver. What stands in for it is the token plus the
 *  addressee check — which is a stronger claim, because it names the one
 *  person the card went to rather than anybody holding a grant.
 */
export async function answerPoFromChat(
  input: {
    token: string;
    answered_by_email: string;
    approved: boolean;
    note?: string | null;
  },
  idempotencyKey?: string,
): Promise<Result<PoDetail>> {
  await latency();
  const endpoint = `answerPoFromChat:${input.token}`;
  const cached = replayed<PoDetail>(SERVICE, endpoint, idempotencyKey);
  if (cached) return cached;

  const state = getState();
  const po = state.purchase_orders.find((p) => p.approval_token === input.token);
  if (!po) {
    return notFound(SERVICE, "request_not_found", "Kartu persetujuan ini tidak cocok dengan apa pun — mungkin sudah ditarik.");
  }
  if (input.answered_by_email !== po.approval_sent_to) {
    apply((draft) => {
      writeAudit(draft, {
        service: SERVICE, entity: "purchase_order", entity_no: po.po_no,
        action: "answer_from_chat", outcome: "refused", reason: input.answered_by_email,
      });
    });
    return refused(
      SERVICE, "not_the_addressee",
      `Kartu ini dikirim ke ${po.approval_sent_to}. Jawaban dari ${input.answered_by_email} bukan keputusan orang itu, dan mencatatnya seolah-olah begitu adalah kesalahan yang justru dihindari oleh jalur ini.`,
    );
  }
  if (po.approved_at) {
    return conflict(SERVICE, "already_answered", `${po.po_no} sudah dikonfirmasi. Tidak ada yang berubah.`);
  }
  if (po.status !== "DRAFT") {
    return conflict(SERVICE, "not_a_draft", `${po.po_no} sekarang ${po.status} — sudah lewat tahap ini.`);
  }
  if (!input.approved && !input.note?.trim()) {
    return invalid(
      SERVICE, "reason_required",
      "Menolak sebuah pesanan perlu satu kalimat — ada orang yang harus menyampaikan sesuatu ke pemasoknya.",
      { field: "note" },
    );
  }

  const answerer = state.users.find((u) => u.email === input.answered_by_email);
  apply((draft) => {
    const row = draft.purchase_orders.find((p) => p.id === po.id)!;
    /* Against the answerer, never against the acting session — that is the
       entire point of this road. */
    row.approved_at = input.approved ? new Date().toISOString() : null;
    row.approved_by = input.approved ? (answerer?.id ?? null) : null;
    row.approval_note = input.note?.trim() || null;
    writeAudit(draft, {
      service: SERVICE, entity: "purchase_order", entity_no: po.po_no,
      action: input.approved ? "approve" : "decline", outcome: "ok",
      reason: input.note?.trim() ?? null,
      detail: { by: input.answered_by_email, via: "chat" },
    });
  });

  const detail = await getPoDetail(po.po_no);
  if (detail.data) remember(SERVICE, endpoint, idempotencyKey, detail.data);
  return detail;
}
