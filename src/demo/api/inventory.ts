/** Implements `/api/v1/inventory` from `03-api.md` — timber, for now.
 *
 *  The module exists for one comparison: **logs come in by the cubic metre and
 *  wood goes into furniture by the cubic metre, and they are not the same
 *  cubic metre** (D153). Everything here is in service of pricing the second
 *  one honestly.
 */
import { ok, noop, invalid, notFound, type Result } from "@/services/_shared/envelope";
import type {
  LogPurchaseView, LogMeasure, TimberVendorSummary,
  StockItemView, StockItemDetail, StockLocation, StockMove, StockMoveView,
  BoardStockView, BoardMoveView, BoardMoveKind, NotaScan,
} from "@/services/inventory/contracts";
import type { DemoState } from "../state";
import { getState, apply, newId, nextDocNumber, writeAudit, writeOutbox } from "../store";
import {
  logPurchaseView, logPurchaseViews, timberVendorSummaries,
  stockItems, stockItemDetail, stockMoveViews,
  boardStock, boardMoveViews,
} from "../inventory-derive";
import { materialPlan } from "../production-derive";
import type { MaterialPlan } from "@/services/production/contracts";
import { scanNota } from "../nota-kayu";
import { STOCKED_CATEGORIES } from "../fixtures/reference";
import { latency, actingUser, requireModule, conflict, replayed, remember } from "./_kit";

const SERVICE = "inventory" as const;

export async function listLogPurchases(): Promise<Result<LogPurchaseView[]>> {
  await latency();
  return ok(SERVICE, logPurchaseViews(getState()));
}

export async function getLogPurchase(purchaseNo: string): Promise<Result<LogPurchaseView>> {
  await latency();
  const state = getState();
  const p = state.log_purchases.find((x) => x.purchase_no === purchaseNo);
  if (!p) return notFound(SERVICE, "purchase_not_found", `No log purchase ${purchaseNo}.`);
  return ok(SERVICE, logPurchaseView(state, p));
}

/** Every vendor's timber side by side. The column that decides is
 *  `cost_per_sawn_m3`, not the invoice price (D153). */
export async function timberByVendor(): Promise<Result<TimberVendorSummary[]>> {
  await latency();
  return ok(SERVICE, timberVendorSummaries(getState()));
}

/** A load of logs arriving.
 *
 *  What the seller claimed it measured is recorded **beside** our own
 *  measurement, never instead of it: the difference between the two is the
 *  conversation with the vendor, and a system that keeps only one number has
 *  already lost that argument (D153).
 */
export async function receiveLogs(
  input: {
    vendor_id: string;
    received_on: string;
    species: string;
    total_cost: number;
    claimed_m3?: number | null;
    measure?: LogMeasure;
    trx_no?: string | null;
    pr_line_no?: string | null;
    nota_attachment_id?: string | null;
    note?: string | null;
    /** Board rows read off the nota, already confirmed by a person. They are
     *  filed as boards here and **never as transaction lines** (D200). */
    boards?: { thickness_mm: number; width_mm: number; length_mm: number; qty: number; grade?: string | null }[];
    logs?: { tag?: string; diameter_cm: number; length_cm: number }[];
  },
  idempotencyKey?: string,
): Promise<Result<LogPurchaseView>> {
  await latency();
  const cached = replayed<LogPurchaseView>(SERVICE, "receiveLogs", idempotencyKey);
  if (cached) return cached;

  const denied = requireModule(SERVICE, "inventory");
  if (denied) return denied;

  const state = getState();
  if (!state.vendors.some((v) => v.id === input.vendor_id)) {
    return notFound(SERVICE, "vendor_not_found", "Vendor itu tidak ada.");
  }
  if (!input.species.trim()) {
    return invalid(SERVICE, "species_required", "Kayu apa?", { field: "species" });
  }
  if (!input.total_cost || input.total_cost <= 0) {
    return invalid(
      SERVICE, "cost_required",
      "Tanpa nilai tagihan, tidak ada harga per m³ yang bisa dihitung — dan itu satu-satunya alasan catatan ini ada.",
      { field: "total_cost" },
    );
  }

  const user = actingUser();
  let no = "";
  apply((draft) => {
    no = nextDocNumber(draft, "kyu");
    draft.log_purchases.push({
      id: newId("lgp"), purchase_no: no,
      vendor_id: input.vendor_id,
      trx_no: input.trx_no ?? null,
      pr_line_no: input.pr_line_no ?? null,
      received_on: input.received_on,
      species: input.species.trim(),
      total_cost: Math.round(input.total_cost),
      claimed_m3: input.claimed_m3 ?? null,
      measure: input.measure ?? "round",
      nota_attachment_id: input.nota_attachment_id ?? null,
      note: input.note?.trim() || null,
      created_at: new Date().toISOString(), created_by: user.id,
    });
    const purchaseId = draft.log_purchases[draft.log_purchases.length - 1].id;
    for (const l of input.logs ?? []) {
      draft.log_pieces.push({
        id: newId("lgs"), purchase_id: purchaseId,
        tag: l.tag?.trim() || `#${draft.log_pieces.length + 1}`,
        diameter_cm: l.diameter_cm, length_cm: l.length_cm,
        sawn_on: null, note: null,
      });
    }
    for (const b of input.boards ?? []) {
      draft.sawn_boards.push({
        id: newId("swb"), purchase_id: purchaseId, log_id: null,
        thickness_mm: b.thickness_mm, width_mm: b.width_mm, length_mm: b.length_mm,
        qty: b.qty, sawn_on: input.received_on,
        grade: b.grade ?? null,
        note: "Dari nota.",
      });
    }
    writeAudit(draft, {
      service: SERVICE, entity: "log_purchase", entity_no: no,
      action: "receive", outcome: "ok", reason: null,
      detail: {
        vendor: input.vendor_id, cost: input.total_cost,
        claimed_m3: input.claimed_m3 ?? null,
        nota: input.nota_attachment_id ?? null,
        /* What the nota contributed, and where it went. The point of the row:
           these sizes became boards, not ledger lines (D200). */
        from_nota: { boards: (input.boards ?? []).length, logs: (input.logs ?? []).length },
        by: user.email,
      },
    });
  });
  const view = await getLogPurchase(no);
  if (view.data) remember(SERVICE, "receiveLogs", idempotencyKey, view.data);
  return view;
}

/** One log, measured. Diameter is the average of the two ends, in centimetres,
 *  as the yard measures it. */
export async function addLog(
  input: {
    purchase_no: string;
    tag: string;
    diameter_cm: number;
    length_cm: number;
    note?: string | null;
  },
): Promise<Result<LogPurchaseView>> {
  await latency();
  const denied = requireModule(SERVICE, "inventory");
  if (denied) return denied;

  const state = getState();
  const p = state.log_purchases.find((x) => x.purchase_no === input.purchase_no);
  if (!p) return notFound(SERVICE, "purchase_not_found", `No log purchase ${input.purchase_no}.`);
  if (input.diameter_cm <= 0 || input.length_cm <= 0) {
    return invalid(SERVICE, "dimensions_required", "Diameter dan panjang harus lebih dari nol.", { field: "diameter_cm" });
  }
  if (state.log_pieces.some((l) => l.purchase_id === p.id && l.tag === input.tag.trim())) {
    return conflict(SERVICE, "tag_used", `Nomor ${input.tag} sudah dipakai di kiriman ini.`);
  }

  const user = actingUser();
  apply((draft) => {
    draft.log_pieces.push({
      id: newId("lgc"), purchase_id: p.id,
      tag: input.tag.trim() || `#${draft.log_pieces.filter((l) => l.purchase_id === p.id).length + 1}`,
      diameter_cm: input.diameter_cm, length_cm: input.length_cm,
      sawn_on: null, note: input.note?.trim() || null,
    });
    writeAudit(draft, {
      service: SERVICE, entity: "log_purchase", entity_no: p.purchase_no,
      action: "add_log", outcome: "ok", reason: null,
      detail: { tag: input.tag, d: input.diameter_cm, l: input.length_cm, by: user.email },
    });
  });
  return getLogPurchase(p.purchase_no);
}

/** Boards off the saw: one size, counted.
 *
 *  Naming the log is optional, because a day's sawing is usually reported as
 *  one pile and pretending otherwise would make the sawyer invent a link. What
 *  is **not** optional is the date, since yield is only meaningful against the
 *  logs that had been cut by then (D153).
 */
export async function reportBoards(
  input: {
    purchase_no: string;
    log_tag?: string | null;
    thickness_mm: number;
    width_mm: number;
    length_mm: number;
    qty: number;
    sawn_on: string;
    grade?: string | null;
    note?: string | null;
  },
): Promise<Result<LogPurchaseView>> {
  await latency();
  const denied = requireModule(SERVICE, "inventory");
  if (denied) return denied;

  const state = getState();
  const p = state.log_purchases.find((x) => x.purchase_no === input.purchase_no);
  if (!p) return notFound(SERVICE, "purchase_not_found", `No log purchase ${input.purchase_no}.`);
  if (input.thickness_mm <= 0 || input.width_mm <= 0 || input.length_mm <= 0) {
    return invalid(SERVICE, "dimensions_required", "Tebal, lebar dan panjang harus diisi.", { field: "thickness_mm" });
  }
  if (!input.qty || input.qty <= 0) {
    return invalid(SERVICE, "qty_required", "Berapa lembar?", { field: "qty" });
  }

  const log = input.log_tag
    ? state.log_pieces.find((l) => l.purchase_id === p.id && l.tag === input.log_tag)
    : null;
  if (input.log_tag && !log) {
    return notFound(SERVICE, "log_not_found", `Tidak ada batang ${input.log_tag} di kiriman ini.`);
  }

  const user = actingUser();
  apply((draft) => {
    draft.sawn_boards.push({
      id: newId("swb"), purchase_id: p.id, log_id: log?.id ?? null,
      thickness_mm: input.thickness_mm, width_mm: input.width_mm, length_mm: input.length_mm,
      qty: input.qty, sawn_on: input.sawn_on,
      grade: input.grade?.trim() || null, note: input.note?.trim() || null,
    });
    /* Reporting boards off a log is what marks it sawn — one act, not two,
       because the second one is the one people forget. */
    if (log) {
      const row = draft.log_pieces.find((l) => l.id === log.id);
      if (row && !row.sawn_on) row.sawn_on = input.sawn_on;
    }
    writeAudit(draft, {
      service: SERVICE, entity: "log_purchase", entity_no: p.purchase_no,
      action: "report_boards", outcome: "ok", reason: input.note?.trim() ?? null,
      detail: {
        log: input.log_tag ?? null,
        size: `${input.thickness_mm}×${input.width_mm}×${input.length_mm}`,
        qty: input.qty, by: user.email,
      },
    });
  });
  return getLogPurchase(p.purchase_no);
}

/** Marking a log sawn without reporting boards — for the one that split and
 *  produced nothing. It still counts against the yield, which is the point. */
export async function markLogSawn(
  input: { purchase_no: string; tag: string; sawn_on: string; note?: string | null },
): Promise<Result<LogPurchaseView>> {
  await latency();
  const denied = requireModule(SERVICE, "inventory");
  if (denied) return denied;

  const state = getState();
  const p = state.log_purchases.find((x) => x.purchase_no === input.purchase_no);
  if (!p) return notFound(SERVICE, "purchase_not_found", `No log purchase ${input.purchase_no}.`);
  const log = state.log_pieces.find((l) => l.purchase_id === p.id && l.tag === input.tag);
  if (!log) return notFound(SERVICE, "log_not_found", `Tidak ada batang ${input.tag}.`);

  const user = actingUser();
  apply((draft) => {
    const row = draft.log_pieces.find((l) => l.id === log.id);
    if (!row) return;
    row.sawn_on = input.sawn_on;
    if (input.note?.trim()) row.note = input.note.trim();
    writeAudit(draft, {
      service: SERVICE, entity: "log_purchase", entity_no: p.purchase_no,
      action: "mark_sawn", outcome: "ok", reason: input.note?.trim() ?? null,
      detail: { tag: input.tag, by: user.email },
    });
  });
  return getLogPurchase(p.purchase_no);
}

/* ── Stock ──────────────────────────────────────────────────────────────── */

/** The rack: what is on it, what it cost, and what is about to run out.
 *
 *  Every quantity here is the sum of the moves (D170). Nothing is stored, so
 *  nothing can disagree with its own history — which is the failure this module
 *  exists to avoid, because the version of it that runs on a spreadsheet has
 *  been wrong since the day somebody forgot a row.
 */
export async function listStock(
  opts: { q?: string; group?: string; location?: string; low_only?: boolean } = {},
): Promise<Result<StockItemView[]>> {
  await latency();
  const state = getState();
  let rows = stockItems(state);

  if (opts.group) rows = rows.filter((r) => r.group_code === opts.group || r.category_code === opts.group);
  if (opts.location) rows = rows.filter((r) => r.by_location.some((l) => l.location === opts.location));
  if (opts.low_only) rows = rows.filter((r) => r.below_min);
  if (opts.q) {
    const q = opts.q.toLowerCase();
    rows = rows.filter((r) => `${r.item_code} ${r.item_name} ${r.category_name}`.toLowerCase().includes(q));
  }
  return ok(SERVICE, rows);
}

export async function getStockItem(itemCode: string): Promise<Result<StockItemDetail>> {
  await latency();
  const detail = stockItemDetail(getState(), itemCode);
  if (!detail) {
    return notFound(
      SERVICE, "item_not_stocked",
      `${itemCode} is not an item this system counts — either it does not exist, or its category is one that is bought and used the same day.`,
    );
  }
  return ok(SERVICE, detail);
}

export async function listStockLocations(): Promise<Result<StockLocation[]>> {
  await latency();
  return ok(SERVICE, getState().stock_locations.filter((l) => l.is_active));
}

export async function listStockMoves(
  filter: { item_code?: string; ref_no?: string } = {},
): Promise<Result<StockMoveView[]>> {
  await latency();
  return ok(SERVICE, stockMoveViews(getState(), filter));
}

/** Writing one move. The single road every stock change takes, so the audit
 *  row and the reason cannot be forgotten by one caller and remembered by
 *  another (ADR-006). */
function writeMove(
  draft: DemoState,
  input: {
    item_code: string; location: string; kind: StockMove["kind"]; qty: number;
    uom: string; unit_cost?: number | null; ref_no?: string | null; reason?: string | null;
  },
  userId: string,
  userEmail: string,
): StockMove {
  const move: StockMove = {
    id: newId("stm"),
    move_no: nextDocNumber(draft, "stk"),
    item_code: input.item_code,
    location: input.location,
    kind: input.kind,
    qty: input.qty,
    uom: input.uom,
    unit_cost: input.unit_cost ?? null,
    ref_no: input.ref_no ?? null,
    reason: input.reason?.trim() || null,
    moved_by: userId,
    moved_at: new Date().toISOString(),
  };
  draft.stock_moves.push(move);
  writeAudit(draft, {
    service: SERVICE, entity: "stock_move", entity_no: move.move_no,
    action: input.kind, outcome: "ok", reason: move.reason,
    detail: { item: move.item_code, qty: move.qty, location: move.location, ref: move.ref_no, by: userEmail },
  });
  return move;
}

/** What the item is measured in, and whether it is counted at all. */
function stockable(state: DemoState, itemCode: string) {
  const item = state.items.find((i) => i.code === itemCode);
  if (!item) return { ok: false as const, why: `No catalogue item ${itemCode}.` };
  if (!STOCKED_CATEGORIES.has(item.category_code)) {
    return { ok: false as const, why: `${item.name} sits in ${item.category_code}, which is not counted — it is bought and used, not stocked (D169).` };
  }
  return { ok: true as const, item };
}

/** Taking material out to the floor.
 *
 *  Issuing more than the record shows is **allowed and flagged**, never
 *  refused (A6). The wood is either on the rack or it is not, and a screen
 *  that refuses to record what a storeman just carried out teaches him to stop
 *  recording. What it must not do is stay quiet: the response says the stock
 *  went negative, which is a counting problem somebody has to resolve, not a
 *  reason to stop work.
 */
export async function issueStock(
  input: { item_code: string; location: string; qty: number; wo_no?: string | null; reason?: string | null },
  idempotencyKey?: string,
): Promise<Result<{ move_no: string; on_hand_after: number; went_negative: boolean }>> {
  await latency();
  const cached = replayed<{ move_no: string; on_hand_after: number; went_negative: boolean }>(SERVICE, "issueStock", idempotencyKey);
  if (cached) return cached;

  const denied = requireModule(SERVICE, "inventory");
  if (denied) return denied;
  if (input.qty <= 0) {
    return invalid(SERVICE, "qty_invalid", "Jumlah keluar harus lebih dari nol.", { field: "qty" });
  }

  const state = getState();
  const check = stockable(state, input.item_code);
  if (!check.ok) return invalid(SERVICE, "not_stocked", check.why, { field: "item_code" });

  const before = stockItems(state).find((r) => r.item_code === input.item_code)?.on_hand ?? 0;
  const after = Math.round((before - input.qty) * 1000) / 1000;

  const user = actingUser();
  let moveNo = "";
  apply((draft) => {
    const move = writeMove(draft, {
      item_code: input.item_code, location: input.location, kind: "issue",
      qty: -Math.abs(input.qty), uom: check.item.base_uom,
      ref_no: input.wo_no ?? null, reason: input.reason ?? null,
    }, user.id, user.email);
    moveNo = move.move_no;
    writeOutbox(draft, {
      service: SERVICE, event_type: "inventory.stock.issued",
      payload: { item_code: input.item_code, qty: input.qty, wo_no: input.wo_no ?? null, on_hand_after: after },
    });
  });

  const result = { move_no: moveNo, on_hand_after: after, went_negative: after < 0 };
  remember(SERVICE, "issueStock", idempotencyKey, result);
  return ok(SERVICE, result);
}

/** Material coming back unused. */
export async function returnStock(
  input: { item_code: string; location: string; qty: number; wo_no?: string | null; reason?: string | null },
): Promise<Result<{ move_no: string; on_hand_after: number }>> {
  await latency();
  const denied = requireModule(SERVICE, "inventory");
  if (denied) return denied;
  if (input.qty <= 0) return invalid(SERVICE, "qty_invalid", "Jumlah kembali harus lebih dari nol.", { field: "qty" });

  const state = getState();
  const check = stockable(state, input.item_code);
  if (!check.ok) return invalid(SERVICE, "not_stocked", check.why, { field: "item_code" });

  const before = stockItems(state).find((r) => r.item_code === input.item_code)?.on_hand ?? 0;
  const user = actingUser();
  let moveNo = "";
  apply((draft) => {
    moveNo = writeMove(draft, {
      item_code: input.item_code, location: input.location, kind: "return",
      qty: Math.abs(input.qty), uom: check.item.base_uom,
      ref_no: input.wo_no ?? null, reason: input.reason ?? null,
    }, user.id, user.email).move_no;
  });
  return ok(SERVICE, { move_no: moveNo, on_hand_after: Math.round((before + input.qty) * 1000) / 1000 });
}

/** An opname: what the rack actually held.
 *
 *  The form takes the **counted** quantity, not the difference, because that is
 *  what a person standing at the rack knows. The difference is computed, and it
 *  is the difference that is stored — with the reason, which is required
 *  (D171). "Stock was wrong" is not a reason; it is the thing being recorded.
 */
export async function adjustStock(
  input: { item_code: string; location: string; counted_qty: number; reason: string },
): Promise<Result<{ move_no: string; difference: number } | { noop: true }>> {
  await latency();
  const denied = requireModule(SERVICE, "inventory");
  if (denied) return denied;
  if (!input.reason?.trim()) {
    return invalid(
      SERVICE, "reason_required",
      "Penyesuaian harus punya alasan — selisihnya akan dibaca orang lain bulan depan.",
      { field: "reason" },
    );
  }

  const state = getState();
  const check = stockable(state, input.item_code);
  if (!check.ok) return invalid(SERVICE, "not_stocked", check.why, { field: "item_code" });

  const here = state.stock_moves
    .filter((m) => m.item_code === input.item_code && m.location === input.location)
    .reduce((s, m) => s + m.qty, 0);
  const difference = Math.round((input.counted_qty - here) * 1000) / 1000;

  /* Counting and finding exactly what the system said is the good outcome, and
     it writes nothing: a zero-quantity move would be a row on a payslip-like
     history that says nothing happened. The count itself is still worth
     knowing, so it is said in the response rather than stored. */
  if (difference === 0) {
    return noop(SERVICE, { noop: true as const });
  }

  const user = actingUser();
  let moveNo = "";
  apply((draft) => {
    moveNo = writeMove(draft, {
      item_code: input.item_code, location: input.location, kind: "adjust",
      qty: difference, uom: check.item.base_uom, reason: input.reason,
    }, user.id, user.email).move_no;
    writeOutbox(draft, {
      service: SERVICE, event_type: "inventory.stock.adjusted",
      payload: { item_code: input.item_code, location: input.location, difference, reason: input.reason },
    });
  });
  return ok(SERVICE, { move_no: moveNo, difference });
}

/** Moving stock between locations — two rows, so each location's own history
 *  reads correctly on its own. */
export async function transferStock(
  input: { item_code: string; from: string; to: string; qty: number; reason?: string | null },
): Promise<Result<{ move_nos: string[] }>> {
  await latency();
  const denied = requireModule(SERVICE, "inventory");
  if (denied) return denied;
  if (input.from === input.to) {
    return invalid(SERVICE, "same_location", "Lokasi asal dan tujuan sama.", { field: "to" });
  }
  if (input.qty <= 0) return invalid(SERVICE, "qty_invalid", "Jumlah pindah harus lebih dari nol.", { field: "qty" });

  const state = getState();
  const check = stockable(state, input.item_code);
  if (!check.ok) return invalid(SERVICE, "not_stocked", check.why, { field: "item_code" });

  const user = actingUser();
  const nos: string[] = [];
  apply((draft) => {
    nos.push(writeMove(draft, {
      item_code: input.item_code, location: input.from, kind: "transfer",
      qty: -Math.abs(input.qty), uom: check.item.base_uom, reason: input.reason ?? null,
    }, user.id, user.email).move_no);
    nos.push(writeMove(draft, {
      item_code: input.item_code, location: input.to, kind: "transfer",
      qty: Math.abs(input.qty), uom: check.item.base_uom, reason: input.reason ?? null,
    }, user.id, user.email).move_no);
  });
  return ok(SERVICE, { move_nos: nos });
}

/** How low is too low, per item. A threshold nobody set stays null, and the
 *  screen says *belum ditetapkan* rather than treating zero as the answer. */
export async function setStockMinimum(
  input: { item_code: string; min_qty: number | null; home_location?: string | null },
): Promise<Result<{ item_code: string; min_qty: number | null }>> {
  await latency();
  const denied = requireModule(SERVICE, "inventory");
  if (denied) return denied;

  const user = actingUser();
  apply((draft) => {
    const row = draft.stock_settings.find((s) => s.item_code === input.item_code);
    const before = row?.min_qty ?? null;
    if (row) {
      row.min_qty = input.min_qty;
      if (input.home_location !== undefined) row.home_location = input.home_location;
    } else {
      draft.stock_settings.push({
        item_code: input.item_code, min_qty: input.min_qty,
        home_location: input.home_location ?? null,
      });
    }
    writeAudit(draft, {
      service: SERVICE, entity: "stock_setting", entity_no: input.item_code,
      action: "set_minimum", outcome: "ok", reason: null,
      detail: { before, after: input.min_qty, by: user.email },
    });
  });
  return ok(SERVICE, { item_code: input.item_code, min_qty: input.min_qty });
}

/** Stock from a confirmed receipt — the one move the system makes by itself.
 *
 *  Called by procurement the moment a delivery is confirmed (D131), which is
 *  what finally closes the gap this module was built for: goods used to be
 *  received, paid for, and then forgotten until somebody walked to the rack.
 *  In Phase 2 this is the outbox consumer for `procurement.receipt.confirmed`
 *  rather than a direct call; the shape is written that way on purpose.
 *
 *  Two cases it does **not** invent:
 *  - a receipt whose line has no catalogue item (a free-text purchase) moves
 *    no stock, and says so, because there is nothing to count it against;
 *  - a line with no unit price becomes stock with `unit_cost: null` rather
 *    than nought, which keeps the quantity honest and the valuation partial.
 */
export function stockFromReceipt(
  draft: DemoState,
  receiptNo: string,
  userId: string,
  userEmail: string,
): { stocked: boolean; why?: string } {
  const receipt = draft.receipts.find((r) => r.receipt_no === receiptNo);
  if (!receipt) return { stocked: false, why: "receipt not found" };
  if (draft.stock_moves.some((m) => m.ref_no === receiptNo && m.kind === "receipt")) {
    return { stocked: false, why: "already stocked" };
  }

  const poLine = receipt.po_line_id ? draft.po_lines.find((l) => l.id === receipt.po_line_id) : null;
  const prLine = receipt.line_id ? draft.pr_lines.find((l) => l.id === receipt.line_id) : null;
  const itemId = poLine?.item_id ?? prLine?.item_id ?? null;
  if (!itemId) return { stocked: false, why: "the line names no catalogue item" };

  const item = draft.items.find((i) => i.id === itemId);
  if (!item) return { stocked: false, why: "catalogue item missing" };
  if (!STOCKED_CATEGORIES.has(item.category_code)) {
    return { stocked: false, why: `${item.category_code} is not a counted category` };
  }

  const setting = draft.stock_settings.find((s) => s.item_code === item.code);
  writeMove(draft, {
    item_code: item.code,
    location: setting?.home_location ?? "GUDANG",
    kind: "receipt",
    qty: Math.abs(receipt.qty_received),
    uom: poLine?.uom ?? prLine?.uom ?? item.base_uom,
    unit_cost: poLine?.unit_price ?? prLine?.unit_price ?? null,
    ref_no: receiptNo,
    reason: null,
  }, userId, userEmail);
  return { stocked: true };
}

/* ── The rack: boards as stock, and what leaves it ────────────────────────
 *
 *  Q40 answered (D203). Until now the board list only ever grew, and the
 *  screen said so plainly rather than pretend it was stock. The owner has
 *  asked for the other half, so here it is: what is on the rack is the sum of
 *  what came off the saw and everything that happened afterwards.
 */

export async function listBoardStock(): Promise<Result<BoardStockView[]>> {
  await latency();
  return ok(SERVICE, boardStock(getState()));
}

export async function listBoardMoves(
  filter: { board_key?: string; ref_no?: string; limit?: number } = {},
): Promise<Result<BoardMoveView[]>> {
  await latency();
  const rows = boardMoveViews(getState(), filter);
  return ok(SERVICE, rows.slice(0, filter.limit ?? 300));
}

/** Taking boards to the floor, bringing them back, scrapping them, or counting
 *  them and finding something else.
 *
 *  One function for all four because they differ in one field. What they share
 *  is the part worth guarding: **the rack is not allowed to go negative** on
 *  an issue or a scrap. Elsewhere this system warns rather than blocks (A6),
 *  and here it refuses — a stack that reads −4 is not a warning anybody can
 *  act on, it is a count nobody can use again until somebody works out which
 *  of the last twenty movements was wrong. An opname is the way a real
 *  surplus gets recorded, and it carries a reason.
 */
export async function moveBoards(
  input: {
    board_key: string;
    kind: BoardMoveKind;
    qty: number;
    ref_no?: string | null;
    purchase_no?: string | null;
    reason?: string | null;
  },
  idempotencyKey?: string,
): Promise<Result<BoardStockView[]>> {
  await latency();
  const cached = replayed<BoardStockView[]>(SERVICE, "moveBoards", idempotencyKey);
  if (cached) return cached;

  const denied = requireModule(SERVICE, "inventory");
  if (denied) return denied;
  if (input.kind === "sawn") {
    return invalid(
      SERVICE, "sawn_is_reported",
      "Papan masuk lewat laporan gergajian, bukan lewat sini — supaya rendemen dan isi rak tidak pernah berbeda.",
      { field: "kind" },
    );
  }

  const state = getState();
  const stack = boardStock(state).find((b) => b.board_key === input.board_key);
  if (!stack) return notFound(SERVICE, "board_not_found", "Ukuran itu tidak ada di rak.");
  if (!input.qty || input.qty <= 0) {
    return invalid(SERVICE, "qty_required", "Berapa lembar?", { field: "qty" });
  }

  const outward = input.kind === "issue" || input.kind === "scrap";
  if (outward && input.qty > stack.qty) {
    return conflict(
      SERVICE, "not_enough_boards",
      `Di rak ada ${stack.qty} lembar ${stack.size} ${stack.species}, diminta ${input.qty}. Kalau fisiknya memang ada, catat sebagai penyesuaian opname dengan alasannya — bukan dengan mengeluarkan lebih dari yang tercatat.`,
      { on_hand: stack.qty, asked: input.qty },
    );
  }
  if (input.kind === "issue" && !input.ref_no?.trim()) {
    return invalid(
      SERVICE, "ref_required",
      "Dipakai untuk pekerjaan yang mana? Papan yang keluar tanpa tujuan tidak bisa dibandingkan dengan BOM-nya.",
      { field: "ref_no" },
    );
  }
  if ((input.kind === "adjust" || input.kind === "scrap") && !input.reason?.trim()) {
    return invalid(
      SERVICE, "reason_required",
      "Tulis alasannya. Selisih tanpa keterangan adalah selisih yang ditemukan lagi bulan depan.",
      { field: "reason" },
    );
  }

  const purchase = input.purchase_no
    ? state.log_purchases.find((p) => p.purchase_no === input.purchase_no)
    : null;
  if (input.purchase_no && !purchase) {
    return notFound(SERVICE, "purchase_not_found", `Tidak ada kiriman ${input.purchase_no}.`);
  }

  const user = actingUser();
  let no = "";
  apply((draft) => {
    no = nextDocNumber(draft, "ppn");
    draft.board_moves.push({
      id: newId("bmv"), move_no: no, at: new Date().toISOString(),
      board_key: input.board_key,
      species: stack.species,
      thickness_mm: stack.thickness_mm, width_mm: stack.width_mm, length_mm: stack.length_mm,
      qty: outward ? -Math.abs(input.qty) : Math.abs(input.qty),
      kind: input.kind,
      /* Left null when nobody knows which load — it decides what the issue
         cost, and a load picked to make the arithmetic work is a wrong number
         in a costing report (D204). */
      purchase_id: purchase?.id ?? null,
      ref_no: input.ref_no?.trim() || null,
      reason: input.reason?.trim() || null,
      by: user.id,
    });
    writeAudit(draft, {
      service: SERVICE, entity: "board_move", entity_no: no,
      action: input.kind, outcome: "ok", reason: input.reason?.trim() || null,
      detail: {
        board: `${stack.species} ${stack.size}`, qty: input.qty,
        ref: input.ref_no ?? null, purchase: input.purchase_no ?? null, by: user.email,
      },
    });
  });

  const rows = boardStock(getState());
  remember(SERVICE, "moveBoards", idempotencyKey, rows);
  return ok(SERVICE, rows);
}

/** Reading a nota, without writing anything.
 *
 *  Deliberately a read: the answer to *is this a timber nota* is a proposal
 *  that a person accepts or rejects, and a reader that filed as it read would
 *  be the thing this whole design exists to prevent (D200).
 */
export async function readNota(text: string): Promise<Result<NotaScan>> {
  await latency();
  return ok(SERVICE, scanNota(text));
}

/* ── Issuing a whole run's material against its SPK ────────────────────
 *
 *  The gap S1 left open since M27: nothing draws stock down from a BOM, so an
 *  issue was recorded item by item and never against the list it came from.
 *
 *  What this endpoint deliberately is **not** is automatic. Stock does not
 *  move when somebody types a progress entry, and the BOM does not deduct
 *  itself. The list is a **proposal**; the storeman edits it to what he
 *  actually carried out and confirms (D266). Stock that moves because a form
 *  was submitted somewhere else is stock nobody counted, and the rack then
 *  disagrees with the screen in a way only a stock-take can find.
 *
 *  Issuing more than the record shows stays allowed and flagged, exactly as
 *  the single-item endpoint does (A6): the wood is off the rack or it is not,
 *  and refusing to record what somebody just carried teaches him to stop
 *  recording. The response names every line that went negative.
 */
export async function issueForWorkOrder(
  input: {
    wo_no: string;
    location: string;
    lines: { item_code: string; qty: number }[];
    note?: string | null;
    idempotency_key?: string;
  },
): Promise<Result<{
  wo_no: string;
  move_nos: string[];
  issued: number;
  negative: { item_code: string; item_name: string; on_hand_after: number }[];
}>> {
  await latency();
  const cached = replayed<{
    wo_no: string; move_nos: string[]; issued: number;
    negative: { item_code: string; item_name: string; on_hand_after: number }[];
  }>(SERVICE, "issueForWorkOrder", input.idempotency_key);
  if (cached) return cached;

  const denied = requireModule(SERVICE, "inventory");
  if (denied) return denied;

  const state = getState();
  const wo = state.work_orders.find((w) => w.wo_no === input.wo_no);
  if (!wo) return notFound(SERVICE, "wo_not_found", `Tidak ada SPK ${input.wo_no}.`);
  if (wo.status === "CANCELLED") {
    return conflict(SERVICE, "wo_cancelled", `${wo.wo_no} sudah dibatalkan.`, {});
  }
  if (!state.stock_locations.some((l) => l.code === input.location && l.is_active)) {
    return invalid(SERVICE, "location_required", "Bahan ini keluar dari lokasi mana?", { field: "location" });
  }

  const wanted = (input.lines ?? []).filter((l) => l.qty > 0);
  if (wanted.length === 0) {
    return invalid(
      SERVICE, "nothing_to_issue",
      "Tidak ada barang yang dikeluarkan. Isi jumlah yang benar-benar dibawa ke bengkel — daftar dari BOM hanya usulan.",
      { field: "lines" },
    );
  }

  /* Every line is checked before any is written: half an issue posted and half
     refused would leave the rack describing a trip that did not happen. */
  const bad = wanted.map((l) => ({ l, check: stockable(state, l.item_code) })).filter((r) => !r.check.ok);
  if (bad.length > 0) {
    return invalid(
      SERVICE, "not_stocked",
      bad.map((b) => b.check.ok ? "" : b.check.why).join(" "),
      { field: "lines", items: bad.map((b) => b.l.item_code) },
    );
  }

  const before = new Map(stockItems(state).map((r) => [r.item_code, r.on_hand]));
  const user = actingUser();
  const moveNos: string[] = [];
  const negative: { item_code: string; item_name: string; on_hand_after: number }[] = [];

  apply((draft) => {
    for (const l of wanted) {
      const item = draft.items.find((i) => i.code === l.item_code)!;
      const move = writeMove(draft, {
        item_code: l.item_code, location: input.location, kind: "issue",
        qty: -Math.abs(l.qty), uom: item.base_uom,
        ref_no: wo.wo_no, reason: input.note?.trim() || null,
      }, user.id, user.email);
      moveNos.push(move.move_no);

      const after = Math.round(((before.get(l.item_code) ?? 0) - l.qty) * 1000) / 1000;
      if (after < 0) negative.push({ item_code: l.item_code, item_name: item.name, on_hand_after: after });
    }
    writeOutbox(draft, {
      service: SERVICE, event_type: "inventory.stock.issued_for_wo",
      payload: { wo_no: wo.wo_no, lines: wanted.length, location: input.location },
    });
  });

  const result = { wo_no: wo.wo_no, move_nos: moveNos, issued: wanted.length, negative };
  remember(SERVICE, "issueForWorkOrder", input.idempotency_key, result);
  return ok(SERVICE, result);
}

/** The list beside the record: what the run should take, what has gone out,
 *  and what is left — read from the order's **own** pinned BOM revision. */
export async function materialForWorkOrder(woNo: string): Promise<Result<MaterialPlan>> {
  await latency();
  const state = getState();
  const wo = state.work_orders.find((w) => w.wo_no === woNo);
  if (!wo) return notFound(SERVICE, "wo_not_found", `Tidak ada SPK ${woNo}.`);
  return ok(SERVICE, materialPlan(state, wo));
}
