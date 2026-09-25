/** Implements `/api/v1/inventory` from `03-api.md` — timber, for now.
 *
 *  The module exists for one comparison: **logs come in by the cubic metre and
 *  wood goes into furniture by the cubic metre, and they are not the same
 *  cubic metre** (D153). Everything here is in service of pricing the second
 *  one honestly.
 */
import { ok, noop, invalid, notFound, type Result } from "@/services/_shared/envelope";
import type {
  LogPurchaseView, LogMeasure, TimberVendorSummary, TimberMonthSummary,
  StockItemView, StockItemDetail, StockLocation, StockMove, StockMoveView,
  BoardStockView, BoardMoveView, BoardMoveKind, NotaScan, LogCostKind,
  Asset, AssetView, AssetCategory, AssetStatus, AssetInput, AssetService, AssetServiceInput,
  ProductStockRow, ProductLedgerRow, ProductMove, ProductMoveInput, ProductCountInput,
} from "@/services/inventory/contracts";
import { ASSET_GONE, ASSET_OWNERSHIP_LABEL } from "@/services/inventory/contracts";
import type { ItemPurchase } from "@/services/procurement/contracts";
import { ITEM_PHOTO_MAX, ITEM_PHOTO_MIN } from "@/services/documents/contracts";
import { itemPurchases } from "./procurement";
import type { DemoState, AuditRow } from "../state";
import { officeToday } from "@/lib/office";
import { getState, apply, newId, nextDocNumber, writeAudit, writeOutbox } from "../store";
import {
  logPurchaseView, logPurchaseViews, timberVendorSummaries, timberMonthSummaries,
  stockItems, stockItemDetail, stockMoveViews,
  boardStock, boardMoveViews,
  itemUsedIn as usedIn,
  productStockRows, productLedgerRows, productOnHand,
} from "../inventory-derive";
import { materialPlan, joReferenceProblem } from "../production-derive";
import type { MaterialPlan } from "@/services/production/contracts";
import { scanNota } from "../nota-kayu";
import { STOCKED_CATEGORIES } from "../fixtures/reference";
import { latency, actingUser, requireModule, requireLevel, conflict, refused, replayed, remember } from "./_kit";

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

export async function timberByMonth(): Promise<Result<TimberMonthSummary[]>> {
  await latency();
  return ok(SERVICE, timberMonthSummaries(getState()));
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

/** A charge against a load — the truck, the sawmill — from **its own nota**.
 *
 *  Beside the timber invoice, never into it: `total_cost` stays what the
 *  timber seller billed, and the landed figures are summed on read (`0156`).
 */
export async function addLogCost(
  input: {
    purchase_no: string;
    kind: LogCostKind;
    amount: number;
    incurred_on: string;
    payee?: string | null;
    vendor_id?: string | null;
    trx_no?: string | null;
    nota_attachment_id?: string | null;
    note?: string | null;
  },
): Promise<Result<LogPurchaseView>> {
  await latency();
  const denied = requireModule(SERVICE, "inventory");
  if (denied) return denied;

  const state = getState();
  const p = state.log_purchases.find((x) => x.purchase_no === input.purchase_no);
  if (!p) return notFound(SERVICE, "purchase_not_found", `No log purchase ${input.purchase_no}.`);
  if (!input.amount || input.amount <= 0) {
    return invalid(SERVICE, "amount_required", "Berapa biayanya?", { field: "amount" });
  }
  if (input.vendor_id && !state.vendors.some((v) => v.id === input.vendor_id)) {
    return notFound(SERVICE, "vendor_not_found", "Vendor itu tidak ada.");
  }

  const user = actingUser();
  apply((draft) => {
    const no = nextDocNumber(draft, "kyb");
    draft.log_costs.push({
      id: newId("lgc"), cost_no: no, purchase_id: p.id,
      kind: input.kind, amount: Math.round(input.amount), incurred_on: input.incurred_on,
      payee: input.payee?.trim() || null, vendor_id: input.vendor_id ?? null,
      trx_no: input.trx_no?.trim() || null,
      nota_attachment_id: input.nota_attachment_id ?? null,
      note: input.note?.trim() || null,
      created_at: new Date().toISOString(),
    });
    writeAudit(draft, {
      service: SERVICE, entity: "log_purchase", entity_no: p.purchase_no,
      action: "add_cost", outcome: "ok", reason: null,
      detail: { cost_no: no, kind: input.kind, amount: input.amount, payee: input.payee ?? null, by: user.email },
    });
  });
  return getLogPurchase(p.purchase_no);
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
    rows = rows.filter((r) =>
      `${r.item_code} ${r.item_name} ${r.item_name_local ?? ""} ${r.category_name}`.toLowerCase().includes(q));
  }
  return ok(SERVICE, rows);
}

export async function listStockedCategories(): Promise<Result<{ code: string; name: string }[]>> {
  await latency();
  const state = getState();
  return ok(SERVICE, [...STOCKED_CATEGORIES]
    .map((code) => ({ code, name: state.item_categories.find((c) => c.code === code)?.name ?? code }))
    .sort((a, b) => a.name.localeCompare(b.name)));
}

/** An item registered at the rack (`0168`). The same refusals as
 *  `ops_inv.register_item`, in the same order, so a counter meets the same
 *  sentence in both modes. */
export async function registerItem(
  input: {
    name: string;
    name_local?: string | null;
    category_code: string;
    base_uom: string;
    photo_ids: string[];
    location?: string | null;
    counted?: number | null;
    reason?: string | null;
  },
  idempotencyKey?: string,
): Promise<Result<StockItemDetail>> {
  await latency();
  const cached = replayed<StockItemDetail>(SERVICE, "registerItem", idempotencyKey);
  if (cached) return cached;
  const denied = requireModule(SERVICE, "inventory");
  if (denied) return denied;

  const state = getState();
  const name = input.name.trim();
  const nameLocal = input.name_local?.trim() || null;
  const photos = input.photo_ids;
  if (!name) return invalid(SERVICE, "name_required", "Barang butuh nama katalog.", { field: "name" });
  if (photos.length < ITEM_PHOTO_MIN) {
    return invalid(SERVICE, "photo_required", "Barang butuh minimal satu foto.", { field: "photos" });
  }
  if (photos.length > ITEM_PHOTO_MAX) {
    return invalid(SERVICE, "too_many_photos", "Paling banyak empat foto per barang.", { field: "photos", given: photos.length });
  }
  if (new Set(photos).size !== photos.length) {
    return invalid(SERVICE, "duplicate_photo", "Foto yang sama dikirim dua kali.", { field: "photos" });
  }
  if (photos.some((id) => !state.attachments.some((a) => a.id === id))) {
    return notFound(SERVICE, "not_found", "Salah satu foto tidak ditemukan.");
  }
  if (!state.item_categories.some((c) => c.code === input.category_code)) {
    return invalid(SERVICE, "no_such_category", `Tidak ada kategori ${input.category_code}.`, { field: "category_code" });
  }
  if (!STOCKED_CATEGORIES.has(input.category_code)) {
    return invalid(SERVICE, "not_stocked", `Kategori ${input.category_code} tidak dihitung di gudang.`, { field: "category_code" });
  }
  if (input.counted != null) {
    if (input.counted <= 0) {
      return invalid(SERVICE, "counted_invalid",
        "Jumlah hasil hitung harus lebih dari nol — kosongkan kalau belum dihitung.", { field: "counted" });
    }
    if (!state.stock_locations.some((l) => l.code === input.location && l.is_active)) {
      return invalid(SERVICE, "location_required", "Hasil hitung butuh lokasi rak yang aktif.", { field: "location" });
    }
  }
  const existing = state.items.find((i) => !i.merged_into && !i.archived_at && (
    i.name.trim().toLowerCase() === name.toLowerCase()
    || (nameLocal != null && (i.name_local ?? "").trim().toLowerCase() === nameLocal.toLowerCase())));
  if (existing) {
    return conflict(SERVICE, "already_catalogued", `Barang ini sudah ada sebagai ${existing.code} — hitung di sana.`,
      { existing_code: existing.code });
  }

  const code = `ITM-${String(state.items.length + 1).padStart(4, "0")}`;
  const user = actingUser();
  apply((draft) => {
    draft.items.push({
      id: newId("itm"), code, name, name_local: nameLocal, aka: [],
      category_code: input.category_code, base_uom: input.base_uom, kind: "goods",
      is_curated: false, standard_price: null, last_price: null,
      last_vendor_id: null, last_purchased_at: null, merged_into: null,
    });
    for (const attachment_id of photos) {
      draft.attachment_links.push({
        id: newId("lnk"), attachment_id, entity: "item", entity_no: code, kind: "Foto",
        linked_by: user.id, linked_at: new Date().toISOString(),
      });
    }
    if (input.counted != null) {
      writeMove(draft, {
        item_code: code, location: input.location!, kind: "adjust", qty: input.counted,
        uom: input.base_uom,
        reason: input.reason?.trim() || "Opname: barang baru didaftarkan, dihitung saat didaftarkan",
      }, user.id, user.email);
    }
    writeOutbox(draft, {
      service: SERVICE, event_type: "inventory.item.registered",
      payload: { code, photos: photos.length, counted: input.counted ?? null, location: input.location ?? null },
    });
  });
  const detail = stockItemDetail(getState(), code)!;
  remember(SERVICE, "registerItem", idempotencyKey, detail);
  return ok(SERVICE, detail);
}

export async function setItemLocalName(itemCode: string, nameLocal: string | null): Promise<Result<StockItemDetail>> {
  await latency();
  const denied = requireModule(SERVICE, "inventory");
  if (denied) return denied;
  if (!getState().items.some((i) => i.code === itemCode)) {
    return notFound(SERVICE, "not_found", "Barang tidak ditemukan.");
  }
  apply((draft) => {
    const item = draft.items.find((i) => i.code === itemCode)!;
    const before = item.name_local ?? null;
    item.name_local = nameLocal?.trim() || null;
    writeAudit(draft, {
      service: SERVICE, entity: "item", entity_no: itemCode, action: "set_local_name", outcome: "ok", reason: null,
      detail: { before, after: item.name_local },
    });
  });
  return getStockItem(itemCode);
}

/** The ledger lines that bought this item — the catalogue's own answer
 *  (`procurement.itemPurchases`), asked by code from the rack. */
export async function stockItemPurchases(itemCode: string): Promise<Result<ItemPurchase[]>> {
  const item = getState().items.find((i) => i.code === itemCode);
  if (!item) {
    await latency();
    return notFound(SERVICE, "item_not_found", "No such item.");
  }
  return itemPurchases(item.id);
}

/* ── finished goods (0170) ─────────────────────────────────────────────── */

export async function listProductStock(productCode?: string): Promise<Result<ProductStockRow[]>> {
  await latency();
  const denied = requireModule(SERVICE, "inventory");
  if (denied) return denied;
  return ok(SERVICE, productStockRows(getState(), productCode));
}

export async function productLedger(productCode: string): Promise<Result<ProductLedgerRow[]>> {
  await latency();
  if (requireModule(SERVICE, "inventory")) return ok(SERVICE, []);
  return ok(SERVICE, productLedgerRows(getState(), productCode));
}

export async function productMoveOptions(): Promise<Result<{
  products: { product_code: string; name: string; uom: string }[];
  work_orders: { wo_no: string; product_code: string; item_name: string; qty: number; status: string; project_code: string | null }[];
}>> {
  await latency();
  const state = getState();
  return ok(SERVICE, {
    products: state.products.filter((p) => p.active)
      .map((p) => ({ product_code: p.product_code, name: p.name, uom: p.uom }))
      .sort((a, b) => a.product_code.localeCompare(b.product_code)),
    work_orders: state.work_orders
      .filter((w) => w.product_code && w.status !== "CANCELLED")
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((w) => ({
        wo_no: w.wo_no, product_code: w.product_code!, item_name: w.item_name, qty: w.qty,
        status: w.status, project_code: w.project_code,
      })),
  });
}

function writeProductMove(
  draft: DemoState,
  input: Omit<ProductMove, "id" | "move_no" | "moved_by" | "moved_at">,
  userId: string,
): ProductMove {
  const move: ProductMove = {
    ...input,
    id: newId("fgm"),
    move_no: nextDocNumber(draft, "fgm"),
    moved_by: userId,
    moved_at: new Date().toISOString(),
  };
  draft.product_moves.push(move);
  return move;
}

/** `ops_inv.move_product`: `qty` positive, the kind gives the sign. A
 *  `produced` move takes its order line from the JO, never the form. */
export async function moveProduct(input: ProductMoveInput, idempotencyKey?: string): Promise<Result<ProductStockRow[]>> {
  await latency();
  const cached = replayed<ProductStockRow[]>(SERVICE, "moveProduct", idempotencyKey);
  if (cached) return cached;
  const denied = requireLevel(SERVICE, "inventory", "write");
  if (denied) return denied;

  const state = getState();
  const kind = input.kind;
  const reason = input.reason?.trim() || null;
  if (!["produced", "transfer", "scrap", "sold", "return"].includes(kind)) {
    return invalid(SERVICE, "no_such_kind", `Jenis gerak ${kind} tidak dikenal.`, { field: "kind" });
  }
  if (!state.products.some((p) => p.product_code === input.product_code)) {
    return notFound(SERVICE, "not_found", "Produk tidak ditemukan.");
  }
  if (!(input.qty > 0)) return invalid(SERVICE, "qty_invalid", "Jumlah harus lebih dari nol.", { field: "qty" });
  const active = (code: string | null | undefined) => state.stock_locations.some((l) => l.code === code && l.is_active);
  if (!active(input.location)) {
    return invalid(SERVICE, "no_such_location", "Lokasi tidak ada atau tidak aktif.", { field: "location" });
  }
  if (["scrap", "sold", "return"].includes(kind) && !reason) {
    return invalid(SERVICE, "reason_required",
      "Tulis alasannya — siapa pembelinya, kenapa rusak, dari mana kembalinya.", { field: "reason" });
  }

  let lineId = input.project_line_id ?? null;
  let woNo = input.wo_no?.trim() || null;
  if (kind === "produced") {
    const wo = state.work_orders.find((w) => w.wo_no === woNo);
    if (!wo) {
      return invalid(SERVICE, "wo_required", "Hasil produksi harus menyebut Job Order yang membuatnya.", { field: "wo_no" });
    }
    if (wo.status === "CANCELLED") return refused(SERVICE, "wo_cancelled", `${wo.wo_no} sudah dibatalkan.`);
    if (wo.product_code !== input.product_code) {
      return invalid(SERVICE, "wo_other_product",
        `${wo.wo_no} membuat ${wo.product_code ?? "barang di luar katalog"}, bukan ${input.product_code}.`, { field: "wo_no" });
    }
    lineId = wo.project_line_id ?? null;
    woNo = wo.wo_no;
  } else if (lineId) {
    const line = state.project_lines.find((l) => l.id === lineId);
    if (!line || line.product_code !== input.product_code) {
      return invalid(SERVICE, "line_other_product", "Baris pesanan itu bukan untuk produk ini.", { field: "project_line_id" });
    }
  }
  if (kind === "transfer" && (!input.to_location || input.to_location === input.location || !active(input.to_location))) {
    return invalid(SERVICE, "no_such_location", "Lokasi tujuan harus lokasi aktif yang lain.", { field: "to_location" });
  }
  if (["transfer", "scrap", "sold"].includes(kind)) {
    const have = productOnHand(state, input.product_code, lineId, input.location);
    if (have < input.qty) {
      return conflict(SERVICE, "insufficient", `Di ${input.location} hanya ada ${have}.`, { on_hand: have });
    }
  }

  const user = actingUser();
  apply((draft) => {
    const out = writeProductMove(draft, {
      product_code: input.product_code, location: input.location, kind,
      qty: kind === "produced" || kind === "return" ? input.qty : -input.qty,
      wo_no: woNo, project_line_id: lineId, ref_no: input.ref_no?.trim() || null, reason,
    }, user.id);
    if (kind === "transfer") {
      writeProductMove(draft, {
        product_code: input.product_code, location: input.to_location!, kind: "transfer", qty: input.qty,
        wo_no: woNo, project_line_id: lineId, ref_no: out.move_no, reason,
      }, user.id);
    }
    writeOutbox(draft, {
      service: SERVICE, event_type: "inventory.product.moved",
      payload: { product_code: input.product_code, kind, qty: input.qty, location: input.location,
                 to_location: input.to_location ?? null, wo_no: woNo, project_line_id: lineId },
    });
  });
  const rows = productStockRows(getState(), input.product_code);
  remember(SERVICE, "moveProduct", idempotencyKey, rows);
  return ok(SERVICE, rows);
}

/** Opname on the finished-goods rack (`ops_inv.count_product`). */
export async function countProduct(input: ProductCountInput, idempotencyKey?: string): Promise<Result<ProductStockRow[]>> {
  await latency();
  const cached = replayed<ProductStockRow[]>(SERVICE, "countProduct", idempotencyKey);
  if (cached) return cached;
  const denied = requireLevel(SERVICE, "inventory", "write");
  if (denied) return denied;
  const state = getState();
  if (!state.products.some((p) => p.product_code === input.product_code)) {
    return notFound(SERVICE, "not_found", "Produk tidak ditemukan.");
  }
  if (input.counted == null || !(input.counted >= 0)) {
    return invalid(SERVICE, "counted_invalid", "Hasil hitung tidak boleh kosong atau minus.", { field: "counted" });
  }
  if (!state.stock_locations.some((l) => l.code === input.location && l.is_active)) {
    return invalid(SERVICE, "no_such_location", "Lokasi tidak ada atau tidak aktif.", { field: "location" });
  }
  const lineId = input.project_line_id ?? null;
  if (lineId) {
    const line = state.project_lines.find((l) => l.id === lineId);
    if (!line || line.product_code !== input.product_code) {
      return invalid(SERVICE, "line_other_product", "Baris pesanan itu bukan untuk produk ini.", { field: "project_line_id" });
    }
  }
  const have = productOnHand(state, input.product_code, lineId, input.location);
  const diff = input.counted - have;
  if (diff === 0) return ok(SERVICE, productStockRows(state, input.product_code));
  const reason = input.reason?.trim();
  if (!reason) {
    return invalid(SERVICE, "reason_required",
      `Sistem mencatat ${have}, dihitung ${input.counted}. Tulis kenapa berbeda.`, { field: "reason", on_hand: have });
  }
  const user = actingUser();
  apply((draft) => {
    const m = writeProductMove(draft, {
      product_code: input.product_code, location: input.location, kind: "adjust", qty: diff,
      wo_no: null, project_line_id: lineId, ref_no: null, reason,
    }, user.id);
    writeOutbox(draft, {
      service: SERVICE, event_type: "inventory.product.counted",
      payload: { move_no: m.move_no, product_code: input.product_code, location: input.location,
                 was: have, counted: input.counted, diff },
    });
  });
  const rows = productStockRows(getState(), input.product_code);
  remember(SERVICE, "countProduct", idempotencyKey, rows);
  return ok(SERVICE, rows);
}

export async function setProductHome(productCode: string, location: string | null): Promise<Result<ProductStockRow[]>> {
  await latency();
  const denied = requireLevel(SERVICE, "inventory", "write");
  if (denied) return denied;
  const state = getState();
  if (!state.products.some((p) => p.product_code === productCode)) {
    return notFound(SERVICE, "not_found", "Produk tidak ditemukan.");
  }
  if (location && !state.stock_locations.some((l) => l.code === location && l.is_active)) {
    return invalid(SERVICE, "no_such_location", "Lokasi tidak ada atau tidak aktif.", { field: "location" });
  }
  apply((draft) => {
    const s = draft.product_settings.find((x) => x.product_code === productCode);
    if (s) s.home_location = location;
    else draft.product_settings.push({ product_code: productCode, home_location: location });
  });
  return ok(SERVICE, productStockRows(getState(), productCode));
}

/** Which products' BOMs call for this item, latest revision only. */
export async function itemUsedIn(itemCode: string): Promise<Result<StockItemDetail["used_in"]>> {
  await latency();
  return ok(SERVICE, usedIn(getState(), itemCode));
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

export async function listStockLocations(
  opts: { all?: boolean } = {},
): Promise<Result<StockLocation[]>> {
  await latency();
  const locs = getState().stock_locations;
  return ok(SERVICE, opts.all ? locs : locs.filter((l) => l.is_active));
}

/** Adding a rack to count (`0157`). The live table gates this on
 *  `inventory.update` under RLS; the demo has no per-action permission of its
 *  own to check (only the module gate every write here already asks), so a
 *  duplicate code is the one refusal this layer can still prove. */
export async function createStockLocation(
  input: { code: string; name: string },
): Promise<Result<StockLocation>> {
  await latency();
  const denied = requireModule(SERVICE, "inventory");
  if (denied) return denied;
  const code = input.code.trim().toUpperCase();
  const name = input.name.trim();
  if (!code) return invalid(SERVICE, "code_required", "Kode lokasi wajib diisi.", { field: "code" });
  if (!name) return invalid(SERVICE, "name_required", "Nama lokasi wajib diisi.", { field: "name" });
  if (getState().stock_locations.some((l) => l.code === code)) {
    return conflict(SERVICE, "already_exists", `Lokasi ${code} sudah ada.`);
  }
  const loc: StockLocation = { code, name, is_active: true };
  apply((draft) => { draft.stock_locations.push(loc); });
  return ok(SERVICE, loc);
}

/** Renaming a rack, or retiring/reviving it. Never a delete — a rack once
 *  counted against stays addressable in `stock_moves` for ever (A5). */
export async function updateStockLocation(
  code: string,
  patch: { name?: string; is_active?: boolean },
): Promise<Result<StockLocation>> {
  await latency();
  const denied = requireModule(SERVICE, "inventory");
  if (denied) return denied;
  const existing = getState().stock_locations.find((l) => l.code === code);
  if (!existing) return notFound(SERVICE, "location_not_found", `No location ${code}.`);
  if (patch.name !== undefined && !patch.name.trim()) {
    return invalid(SERVICE, "name_required", "Nama lokasi wajib diisi.", { field: "name" });
  }
  let updated: StockLocation = existing;
  apply((draft) => {
    const loc = draft.stock_locations.find((l) => l.code === code)!;
    if (patch.name !== undefined) loc.name = patch.name.trim();
    if (patch.is_active !== undefined) loc.is_active = patch.is_active;
    updated = { ...loc };
  });
  return ok(SERVICE, updated);
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
    return { ok: false as const, why: `${item.name} sits in ${item.category_code}, which is not counted — it is bought and used, not stocked.` };
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
  const badWo = joReferenceProblem(state, input.wo_no, "issue");
  if (badWo) return invalid(SERVICE, "wo_not_found", badWo, { field: "wo_no" });

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

  let item = draft.items.find((i) => i.id === itemId);
  if (!item) return { stocked: false, why: "catalogue item missing" };
  /* A merged item is counted under the one it was merged into (0169). */
  if (item.merged_into) item = draft.items.find((i) => i.id === item!.merged_into) ?? item;
  if (!STOCKED_CATEGORIES.has(item.category_code)) {
    return { stocked: false, why: `${item.category_code} is not a counted category` };
  }
  /* Something that arrived and is going back is not stock (0169). */
  if (receipt.condition === "WRONG ITEM" || receipt.condition === "RETURN TO SENDER") {
    return { stocked: false, why: `marked ${receipt.condition} — not kept` };
  }

  /* A line bought per box and an item counted per piece cannot be added
     together: convert, or stock nothing and say why (0169). */
  const lineUom = poLine?.uom ?? prLine?.uom ?? item.base_uom;
  let factor: number | null = lineUom === item.base_uom ? 1 : null;
  if (factor == null) {
    const direct = draft.uom_conversions.find((c) => c.from_uom === lineUom && c.to_uom === item!.base_uom);
    const reverse = draft.uom_conversions.find((c) => c.from_uom === item!.base_uom && c.to_uom === lineUom);
    factor = direct ? direct.factor : reverse ? 1 / reverse.factor : null;
  }
  if (factor == null) {
    return { stocked: false, why: `bought per ${lineUom}, counted per ${item.base_uom}, and no conversion between them` };
  }
  const price = poLine?.unit_price ?? prLine?.unit_price ?? null;

  const setting = draft.stock_settings.find((s) => s.item_code === item!.code);
  writeMove(draft, {
    item_code: item.code,
    location: setting?.home_location ?? "GUDANG",
    kind: "receipt",
    qty: Math.abs(receipt.qty_received) * factor,
    uom: item.base_uom,
    /* Never zero (D172): an unpriced line leaves the move unpriced. */
    unit_cost: price != null && price > 0 ? price / factor : null,
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

/** Reading a photo needs a language model behind a server key, and the
 *  sandbox has neither. Said as itself rather than faked: a demo that
 *  invented a reading would teach somebody to trust one. */
export async function readNotaImage(_file: File): Promise<Result<NotaScan>> {
  await latency();
  return invalid(
    SERVICE, "image_needs_live",
    "Membaca foto nota hanya bisa di aplikasi live (butuh model bahasa di server). Di demo, tempel teks notanya.",
    { field: "file" },
  );
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
  if (!wo) return notFound(SERVICE, "wo_not_found", `Tidak ada Job Order ${input.wo_no}.`);
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
  if (!wo) return notFound(SERVICE, "wo_not_found", `Tidak ada Job Order ${woNo}.`);
  return ok(SERVICE, materialPlan(state, wo));
}

/* ------------------------------------------------------------------ */
/* The asset register (0107)                                           */
/* ------------------------------------------------------------------ */

function assetView(state: DemoState, a: Asset): AssetView {
  return {
    ...a,
    category_name: state.asset_categories.find((c) => c.code === a.category_code)?.name ?? a.category_code,
    vendor_name: a.vendor_code ? state.vendors.find((v) => v.code === a.vendor_code)?.name ?? null : null,
    document_count: state.attachment_links.filter((l) => (l.entity as string) === "asset" && l.entity_no === a.asset_no).length,
    warranty_expired: !!a.warranty_until && a.warranty_until < officeToday() && !ASSET_GONE.includes(a.status),
    contract_ending: a.ownership !== "owned" && !!a.contract_end && !ASSET_GONE.includes(a.status)
      && a.contract_end >= officeToday() && a.contract_end <= addDays(officeToday(), 30),
    contract_expired: a.ownership !== "owned" && !!a.contract_end && !ASSET_GONE.includes(a.status)
      && a.contract_end < officeToday(),
    rent_lines: state.cash_components.filter((c) => c.active && c.source_ref === `asset:${a.asset_no}`).length,
    ...serviceSummary(state, a),
  };
}

/** The service columns `v_asset` reads (`0121`): the latest job's date, the
 *  next due, and a flag two weeks ahead. */
function serviceSummary(state: DemoState, a: Asset) {
  const jobs = state.asset_services
    .filter((s) => s.asset_no === a.asset_no)
    .sort((x, y) => y.service_date.localeCompare(x.service_date) || y.recorded_at.localeCompare(x.recorded_at));
  /* The latest job that set a next due, unless a routine service was done
     after it — a repair in between does not cancel the oil change (`0121`). */
  const next = jobs.find((j) => j.next_due
    && !jobs.some((k) => k.kind === "service" && k.service_date > j.service_date))?.next_due ?? null;
  return {
    last_service_on: jobs[0]?.service_date ?? null,
    next_service_due: next,
    service_due: !!next && next <= addDays(officeToday(), 14) && !ASSET_GONE.includes(a.status),
    service_count: jobs.length,
  };
}

/** One asset's service log, newest first. */
export async function listAssetServices(assetNo: string): Promise<Result<AssetService[]>> {
  await latency();
  const state = getState();
  return ok(SERVICE, state.asset_services
    .filter((s) => s.asset_no === assetNo)
    .map((s) => ({ ...s, vendor_name: s.vendor_code ? state.vendors.find((v) => v.code === s.vendor_code)?.name ?? null : null }))
    .sort((x, y) => y.service_date.localeCompare(x.service_date) || y.recorded_at.localeCompare(x.recorded_at)));
}

/** A job done on an asset (`0121`). Logged once done — a future date belongs
 *  in `next_due`. */
export async function addAssetService(assetNo: string, input: AssetServiceInput): Promise<Result<AssetService>> {
  await latency();
  const denied = requireModule(SERVICE, "inventory");
  if (denied) return denied;
  const state = getState();
  const a = state.assets.find((x) => x.asset_no === assetNo);
  if (!a) return notFound(SERVICE, "asset_not_found", "No such asset.");
  if (!input.service_date) return invalid(SERVICE, "date_required", "When was the work done?", { field: "service_date" });
  if (input.service_date > officeToday()) {
    return invalid(SERVICE, "date_in_future", "A job is logged once it is done. Put a future date in \"next due\".", { field: "service_date" });
  }
  if (!input.description.trim()) return invalid(SERVICE, "description_required", "Say what was done.", { field: "description" });
  if (input.cost != null && input.cost < 0) return invalid(SERVICE, "cost_negative", "A cost cannot be negative.", { field: "cost" });
  if (input.next_due && input.next_due <= input.service_date) {
    return invalid(SERVICE, "next_due_invalid", "The next one is due after this one.", { field: "next_due" });
  }
  const bad = assetRefsInvalid(state, { vendor_code: input.vendor_code, trx_no: input.trx_no });
  if (bad) return bad;
  const row: Omit<AssetService, "vendor_name"> = {
    id: newId("asv"), asset_no: assetNo, service_date: input.service_date, kind: input.kind ?? "service",
    description: input.description.trim(), vendor_code: input.vendor_code?.trim() || null,
    cost: input.cost ?? null, trx_no: input.trx_no?.trim() || null, next_due: input.next_due ?? null,
    recorded_by: actingUser().id, recorded_at: new Date().toISOString(),
  };
  apply((draft) => {
    draft.asset_services.push(row);
    writeAudit(draft, {
      service: SERVICE, entity: "asset", entity_no: assetNo, action: "service", outcome: "ok", reason: null,
      detail: { service_date: row.service_date, kind: row.kind, description: row.description, cost: row.cost, next_due: row.next_due },
    });
  });
  return ok(SERVICE, { ...row, vendor_name: row.vendor_code ? state.vendors.find((v) => v.code === row.vendor_code)?.name ?? null : null });
}

/** For a row entered by mistake; audited with what it said. */
export async function deleteAssetService(id: string, reason?: string): Promise<Result<{ id: string; deleted: true }>> {
  await latency();
  const denied = requireModule(SERVICE, "inventory");
  if (denied) return denied;
  const s = getState().asset_services.find((x) => x.id === id);
  if (!s) return notFound(SERVICE, "service_not_found", "No such service entry.");
  apply((draft) => {
    draft.asset_services = draft.asset_services.filter((x) => x.id !== id);
    writeAudit(draft, {
      service: SERVICE, entity: "asset", entity_no: s.asset_no, action: "service_delete", outcome: "ok",
      reason: reason?.trim() || null, detail: { service_date: s.service_date, description: s.description, cost: s.cost },
    });
  });
  return ok(SERVICE, { id, deleted: true as const });
}

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The rent rules (`0116`), judged on the row as it will be. */
function assetRentInvalid(a: Pick<Asset, "ownership" | "rent_amount" | "rent_period" | "rent_due_day" | "contract_start" | "contract_end">) {
  if (!(a.ownership in ASSET_OWNERSHIP_LABEL)) {
    return invalid(SERVICE, "ownership_invalid", "Owned, rented, leased or borrowed.", { field: "ownership" });
  }
  if (a.ownership === "owned" && (a.rent_amount != null || a.rent_period != null || a.contract_start != null || a.contract_end != null)) {
    return invalid(SERVICE, "rent_on_owned", "An owned asset has no rent or contract. Clear them, or change who owns it.", { field: "ownership" });
  }
  if (a.rent_amount != null && a.rent_amount < 0) {
    return invalid(SERVICE, "rent_negative", "Rent cannot be negative.", { field: "rent_amount" });
  }
  if ((a.rent_amount ?? 0) > 0 && !a.rent_period) {
    return invalid(SERVICE, "period_required", "Say how often the rent is paid.", { field: "rent_period" });
  }
  if (a.rent_due_day != null && (a.rent_due_day < 1 || a.rent_due_day > 31)) {
    return invalid(SERVICE, "due_day_invalid", "The rent falls due on a day between 1 and 31.", { field: "rent_due_day" });
  }
  if (a.contract_start && a.contract_end && a.contract_end < a.contract_start) {
    return invalid(SERVICE, "contract_dates", "The contract ends before it starts.", { field: "contract_end" });
  }
  return null;
}

/** The register, newest tag first. Gone assets (disposed, lost, returned) are
 *  left out unless asked for. */
export async function listAssets(
  opts: { q?: string; category?: string; status?: AssetStatus; include_gone?: boolean } = {},
): Promise<Result<AssetView[]>> {
  await latency();
  const state = getState();
  let rows = state.assets;
  if (!opts.include_gone && !opts.status) rows = rows.filter((a) => !ASSET_GONE.includes(a.status));
  if (opts.status) rows = rows.filter((a) => a.status === opts.status);
  if (opts.category) rows = rows.filter((a) => a.category_code === opts.category);
  if (opts.q) {
    const q = opts.q.toLowerCase();
    rows = rows.filter((a) => [a.asset_no, a.name, a.brand, a.model, a.identifier, a.location, a.holder]
      .some((x) => x?.toLowerCase().includes(q)));
  }
  return ok(SERVICE, [...rows].sort((a, b) => b.asset_no.localeCompare(a.asset_no)).map((a) => assetView(state, a)));
}

export async function getAsset(assetNo: string): Promise<Result<AssetView>> {
  await latency();
  const state = getState();
  const a = state.assets.find((x) => x.asset_no === assetNo);
  if (!a) return notFound(SERVICE, "asset_not_found", "No such asset.");
  return ok(SERVICE, assetView(state, a));
}

function assetRefsInvalid(state: DemoState, input: AssetInput) {
  if (input.category_code && !state.asset_categories.some((c) => c.code === input.category_code)) {
    return invalid(SERVICE, "category_unknown", `No asset category ${input.category_code}.`, { field: "category_code" });
  }
  if (input.vendor_code?.trim() && !state.vendors.some((v) => v.code === input.vendor_code!.trim())) {
    return invalid(SERVICE, "vendor_unknown", `No supplier ${input.vendor_code}.`, { field: "vendor_code" });
  }
  if (input.trx_no?.trim() && !state.transactions.some((t) => t.trx_no === input.trx_no!.trim())) {
    return invalid(SERVICE, "trx_unknown", `No ledger row ${input.trx_no}.`, { field: "trx_no" });
  }
  if (input.purchase_cost != null && input.purchase_cost < 0) {
    return invalid(SERVICE, "cost_negative", "A purchase cost cannot be negative.", { field: "purchase_cost" });
  }
  return null;
}

const blank = (x: string | undefined) => (x === undefined ? undefined : x.trim() || null);

export async function createAsset(
  input: AssetInput & { name: string; category_code: string; status?: AssetStatus },
  idempotencyKey?: string,
): Promise<Result<AssetView>> {
  await latency();
  const cached = replayed<AssetView>(SERVICE, "createAsset", idempotencyKey);
  if (cached) return cached;
  const denied = requireModule(SERVICE, "inventory");
  if (denied) return denied;
  if (!input.name.trim()) return invalid(SERVICE, "name_required", "An asset needs a name.", { field: "name" });
  if (input.status && ASSET_GONE.includes(input.status)) {
    return invalid(SERVICE, "status_invalid", "A new asset is in use, in storage or under repair.", { field: "status" });
  }
  const state = getState();
  const bad = assetRefsInvalid(state, input);
  if (bad) return bad;
  const rent = {
    ownership: input.ownership ?? "owned",
    rent_amount: input.rent_amount ?? null, rent_period: input.rent_period ?? null,
    rent_due_day: input.rent_due_day ?? null,
    contract_start: input.contract_start ?? null, contract_end: input.contract_end ?? null,
  } satisfies Partial<Asset>;
  const badRent = assetRentInvalid(rent);
  if (badRent) return badRent;
  const n = Math.max(0, ...state.assets.map((a) => Number(a.asset_no.slice(4)) || 0)) + 1;
  const now = new Date().toISOString();
  const row: Asset = {
    id: newId("ast"), asset_no: `AST-${String(n).padStart(4, "0")}`, name: input.name.trim(),
    category_code: input.category_code,
    brand: blank(input.brand) ?? null, model: blank(input.model) ?? null,
    identifier: blank(input.identifier) ?? null, location: blank(input.location) ?? null,
    holder: blank(input.holder) ?? null, status: input.status ?? "in_use",
    acquired_on: input.acquired_on ?? null, purchase_cost: input.purchase_cost ?? null,
    vendor_code: blank(input.vendor_code) ?? null, trx_no: blank(input.trx_no) ?? null,
    warranty_until: input.warranty_until ?? null, notes: blank(input.notes) ?? null,
    ended_on: null, created_at: now, updated_at: now,
    ...rent,
  };
  apply((draft) => {
    draft.assets.push(row);
    writeAudit(draft, { service: SERVICE, entity: "asset", entity_no: row.asset_no, action: "create", outcome: "ok", reason: null });
  });
  const view = assetView(getState(), row);
  remember(SERVICE, "createAsset", idempotencyKey, view);
  return ok(SERVICE, view);
}

/** Leave a field out to keep it; `""` clears a text field, `null` a date or
 *  number. Only what moved is written to the trail. */
export async function updateAsset(assetNo: string, input: AssetInput): Promise<Result<AssetView>> {
  await latency();
  const denied = requireModule(SERVICE, "inventory");
  if (denied) return denied;
  const state = getState();
  const a = state.assets.find((x) => x.asset_no === assetNo);
  if (!a) return notFound(SERVICE, "asset_not_found", "No such asset.");
  if (input.name !== undefined && !input.name.trim()) {
    return invalid(SERVICE, "name_required", "An asset needs a name.", { field: "name" });
  }
  const bad = assetRefsInvalid(state, input);
  if (bad) return bad;
  const next: Asset = { ...a };
  if (input.name !== undefined) next.name = input.name.trim();
  if (input.category_code !== undefined) next.category_code = input.category_code;
  for (const k of ["brand", "model", "identifier", "location", "holder", "vendor_code", "trx_no", "notes"] as const) {
    if (input[k] !== undefined) next[k] = blank(input[k]) ?? null;
  }
  for (const k of ["acquired_on", "warranty_until"] as const) {
    if (input[k] !== undefined) next[k] = input[k] ?? null;
  }
  if (input.purchase_cost !== undefined) next.purchase_cost = input.purchase_cost;
  if (input.rent_amount !== undefined) next.rent_amount = input.rent_amount;
  if (input.rent_period !== undefined) next.rent_period = input.rent_period;
  if (input.rent_due_day !== undefined) next.rent_due_day = input.rent_due_day;
  if (input.contract_start !== undefined) next.contract_start = input.contract_start;
  if (input.contract_end !== undefined) next.contract_end = input.contract_end;
  if (input.ownership !== undefined) next.ownership = input.ownership;
  const badRent = assetRentInvalid(next);
  if (badRent) return badRent;
  if (next.ownership === "owned" && a.status === "returned") {
    return invalid(SERVICE, "ownership_returned", "A returned asset was never ours. Change its status before calling it owned.", { field: "ownership" });
  }
  const changed: Record<string, unknown> = {};
  for (const k of Object.keys(next) as (keyof Asset)[]) {
    if (next[k] !== a[k]) changed[k] = `${a[k] ?? "—"} → ${next[k] ?? "—"}`;
  }
  if (Object.keys(changed).length === 0) return noop(SERVICE, assetView(state, a));
  apply((draft) => {
    Object.assign(draft.assets.find((x) => x.id === a.id)!, next, { updated_at: new Date().toISOString() });
    writeAudit(draft, { service: SERVICE, entity: "asset", entity_no: assetNo, action: "update", outcome: "ok", reason: null, detail: changed });
  });
  return ok(SERVICE, assetView(getState(), getState().assets.find((x) => x.id === a.id)!));
}

/** Going (disposed, lost) needs a note and dates the end; a rented, leased
 *  or borrowed thing goes back — `returned`, which dates the end too. Coming
 *  back clears it. */
export async function setAssetStatus(
  assetNo: string, status: AssetStatus, note?: string,
): Promise<Result<AssetView>> {
  await latency();
  const denied = requireModule(SERVICE, "inventory");
  if (denied) return denied;
  const state = getState();
  const a = state.assets.find((x) => x.asset_no === assetNo);
  if (!a) return notFound(SERVICE, "asset_not_found", "No such asset.");
  if (a.status === status) return noop(SERVICE, assetView(state, a));
  if (status === "returned" && a.ownership === "owned") {
    return invalid(SERVICE, "status_invalid", "Only a rented, leased or borrowed asset is returned. An owned one is disposed of.", { field: "status" });
  }
  const gone = ASSET_GONE.includes(status);
  if (status !== "returned" && gone && !note?.trim()) {
    return invalid(SERVICE, "note_required", "Say how it left — sold, scrapped, stolen, where it was last seen.", { field: "note" });
  }
  apply((draft) => {
    const d = draft.assets.find((x) => x.id === a.id)!;
    d.status = status;
    d.ended_on = gone ? officeToday() : null;
    d.updated_at = new Date().toISOString();
    writeAudit(draft, {
      service: SERVICE, entity: "asset", entity_no: assetNo, action: "status", outcome: "ok",
      reason: note?.trim() || null, detail: { status_before: a.status, status_after: status },
    });
  });
  return ok(SERVICE, assetView(getState(), getState().assets.find((x) => x.id === a.id)!));
}

/** Only for an entry made by mistake — anything with a document on it is a
 *  real asset, and is disposed of rather than erased. */
export async function deleteAsset(assetNo: string): Promise<Result<{ asset_no: string; deleted: true }>> {
  await latency();
  const denied = requireModule(SERVICE, "inventory");
  if (denied) return denied;
  const state = getState();
  const a = state.assets.find((x) => x.asset_no === assetNo);
  if (!a) return notFound(SERVICE, "asset_not_found", "No such asset.");
  const docs = assetView(state, a).document_count;
  if (docs > 0) {
    return conflict(SERVICE, "asset_has_documents",
      `${assetNo} has ${docs} document(s) attached. Mark it disposed instead, so the record stays.`);
  }
  apply((draft) => {
    draft.assets = draft.assets.filter((x) => x.id !== a.id);
    writeAudit(draft, { service: SERVICE, entity: "asset", entity_no: assetNo, action: "delete", outcome: "ok", reason: null });
  });
  return ok(SERVICE, { asset_no: assetNo, deleted: true as const });
}

/** Everything that has happened to one asset, newest first — its own edits
 *  and status changes, and documents put on or taken off it. */
export async function assetHistory(assetNo: string): Promise<Result<AuditRow[]>> {
  await latency();
  return ok(SERVICE, getState().audit_log
    .filter((r) => (r.entity === "asset" || r.entity === "attachment") && r.entity_no === assetNo)
    .sort((a, b) => b.at.localeCompare(a.at)));
}

export async function listAssetCategories(): Promise<Result<AssetCategory[]>> {
  await latency();
  return ok(SERVICE, [...getState().asset_categories].sort((a, b) => a.name.localeCompare(b.name)));
}

/** Create or update by code. The code is lower-case and fixed once made. */
export async function saveAssetCategory(
  input: { code: string; name: string; description?: string; is_active?: boolean },
): Promise<Result<AssetCategory>> {
  await latency();
  const denied = requireModule(SERVICE, "inventory");
  if (denied) return denied;
  const code = input.code.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{1,29}$/.test(code)) {
    return invalid(SERVICE, "code_invalid", 'A category code is 2–30 lower-case letters, digits, "-" or "_", e.g. "cctv".', { field: "code" });
  }
  if (!input.name.trim()) return invalid(SERVICE, "name_required", "A category needs a name.", { field: "name" });
  const existing = getState().asset_categories.find((c) => c.code === code);
  const next: AssetCategory = {
    code, name: input.name.trim(),
    description: input.description === undefined ? (existing?.description ?? null) : (input.description.trim() || null),
    is_active: input.is_active ?? existing?.is_active ?? true,
  };
  if (existing && JSON.stringify(existing) === JSON.stringify(next)) return noop(SERVICE, existing);
  apply((draft) => {
    const d = draft.asset_categories.find((c) => c.code === code);
    if (d) Object.assign(d, next); else draft.asset_categories.push(next);
    writeAudit(draft, { service: SERVICE, entity: "asset_category", entity_no: code, action: existing ? "update" : "create", outcome: "ok", reason: null });
  });
  return ok(SERVICE, next);
}

export async function deleteAssetCategory(code: string): Promise<Result<{ code: string; deleted: true }>> {
  await latency();
  const denied = requireModule(SERVICE, "inventory");
  if (denied) return denied;
  const state = getState();
  const c = state.asset_categories.find((x) => x.code === code);
  if (!c) return notFound(SERVICE, "category_not_found", "No such category.");
  const n = state.assets.filter((a) => a.category_code === code).length;
  if (n > 0) return conflict(SERVICE, "category_in_use", `${c.name} still has ${n} asset(s). Move them or retire the category.`);
  apply((draft) => {
    draft.asset_categories = draft.asset_categories.filter((x) => x.code !== code);
    writeAudit(draft, { service: SERVICE, entity: "asset_category", entity_no: code, action: "delete", outcome: "ok", reason: null });
  });
  return ok(SERVICE, { code, deleted: true as const });
}
