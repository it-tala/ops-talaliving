/** Implements `/api/v1/inventory` against the database — material stock
 *  (`0071`), timber (`0070`), and the board rack (`0094`/`0095`, written for
 *  this module: `0070` never migrated `board_moves` at all, and the atomic
 *  three-table write `receiveLogs` needs had no seam anywhere in the ladder).
 *
 *  Same rules as `accounting.ts`/`procurement.ts`: nothing derived is computed
 *  here that the database already decided, no permission is checked here, and
 *  no refusal is reworded.
 *
 *  **Two shapes of write seam, not one.** `stock_moves` (`0071`) and the
 *  single-row timber writes (`addLog`, `reportBoards`, `markLogSawn`, all
 *  `0070`) have no `security definer` function — RLS alone gates them, and
 *  "on_hand"/yield/cost are `sum()`s computed on read (A3, D170, D153), so
 *  there is no server-side function to ask for a before/after either; those
 *  figures are read here, a `select` before the `insert`, the same arithmetic
 *  the demo's own callers do. `receive_logs` and `move_boards` (`0095`,
 *  `0094`) ARE seams — one because three tables have to land in one
 *  transaction, the other because "not enough boards" (D205) needs every
 *  other row for that size, which RLS cannot see.
 */
import type {
  StockLocation, StockMove, StockMoveView, StockItemView, StockItemDetail,
  LogMeasure, LogPiece, LogPieceView, SawnBoard, SawnBoardView, LogPurchaseView,
  TimberVendorSummary, TimberMonthSummary, BoardStockView, BoardMoveView, BoardMoveKind, NotaScan,
  LogCost, LogCostKind,
  AssetView, AssetCategory, AssetStatus, AssetInput, AssetService, AssetServiceInput,
} from "@/services/inventory/contracts";
import type { MaterialPlan } from "@/services/production/contracts";
import type { ItemPurchase } from "@/services/procurement/contracts";
import { supabaseBrowser } from "@/lib/supabase/client";
import { fail, fromRows, fromSeam, invalid, noop, notFound, ok, conflict, refused, type Result } from "./_kit";
import { scanNota } from "./_nota_kayu";

const SERVICE = "inventory" as const;

const db = () => supabaseBrowser().schema("ops_inv");
const procure = () => supabaseBrowser().schema("ops_procure");
const core = () => supabaseBrowser().schema("ops_core");
const prod = () => supabaseBrowser().schema("ops_prod");

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

/** A log's volume in cubic metres — `ops_inv.log_volume_m3()`'s own formula
 *  (`0070`), restated here for the per-row `m3` `LogPieceView` needs;
 *  `v_log_purchase` already applies it for the load's totals. */
function logVolumeM3(diameterCm: number, lengthCm: number, measure: LogMeasure): number {
  const d = diameterCm / 100;
  const l = lengthCm / 100;
  const v = measure === "round" ? (Math.PI / 4) * d * d * l : d * d * l;
  return round4(v);
}

function boardVolumeM3(thicknessMm: number, widthMm: number, lengthMm: number): number {
  return round4((thicknessMm / 1000) * (widthMm / 1000) * (lengthMm / 1000));
}

/** The signed-in user's id, for `moved_by` — `stock_moves` has no default for
 *  it (unlike the seam-backed tables elsewhere, nothing here can fall back to
 *  `auth.uid()` server-side because there is no seam to run it in). */
async function currentUserId(): Promise<Result<string>> {
  const { data } = await supabaseBrowser().auth.getSession();
  if (!data.session) {
    return {
      error: { code: "not_signed_in", message: "Nobody is signed in.", outcome: "refused", status: 401 },
      meta: { request_id: "", service: SERVICE, version: "1", outcome: "refused" },
    };
  }
  return ok(SERVICE, data.session.user.id);
}

/** What the item is measured in, and whether it is stocked at all — the same
 *  question `ops_inv.v_stock_item` answers with its `stocked_categories` join,
 *  asked here before a write because a move needs the item's `base_uom` and
 *  the view only exists for items already known to qualify. */
async function stockable(
  itemCode: string,
): Promise<{ ok: true; base_uom: string } | { ok: false; why: string }> {
  const { data: item, error } = await procure().from("items")
    .select("code, name, base_uom, category_code, merged_into")
    .eq("code", itemCode).maybeSingle();
  if (error || !item) return { ok: false, why: `No catalogue item ${itemCode}.` };
  if (item.merged_into) return { ok: false, why: `${item.name} was merged into another item.` };
  const { data: cat } = await db().from("stocked_categories").select("category_code")
    .eq("category_code", item.category_code).maybeSingle();
  if (!cat) {
    return {
      ok: false,
      why: `${item.name} sits in ${item.category_code}, which is not counted — it is bought and used, not stocked.`,
    };
  }
  return { ok: true, base_uom: item.base_uom as string };
}

/** The rack: what is on it, what it cost, and what is about to run out.
 *
 *  `v_stock_item` (`0071`) carries everything but `by_location` and
 *  `group_code`/`group_name` — a second read each, joined in here, the same
 *  boundary `getCashPlan`'s `label` sits on (presentation/composition, not a
 *  second derivation of what the view already computed). */
export async function listStock(
  opts: { q?: string; group?: string; location?: string; low_only?: boolean } = {},
): Promise<Result<StockItemView[]>> {
  const { data, error } = await db().from("v_stock_item").select("*").order("item_name");
  if (error) return fail(SERVICE, error);
  const rows = await withGroupAndLocation(data ?? []);
  if (rows.error) return rows;

  let filtered = rows.data;
  if (opts.group) filtered = filtered.filter((r) => r.group_code === opts.group || r.category_code === opts.group);
  if (opts.location) filtered = filtered.filter((r) => r.by_location.some((l) => l.location === opts.location));
  if (opts.low_only) filtered = filtered.filter((r) => r.below_min);
  if (opts.q) {
    const q = opts.q.toLowerCase();
    filtered = filtered.filter((r) =>
      `${r.item_code} ${r.item_name} ${r.item_name_local ?? ""} ${r.category_name}`.toLowerCase().includes(q));
  }
  return ok(SERVICE, filtered);
}

/** The categories counted on a rack — the only ones an item registered at the
 *  rack may go into (`register_item` refuses the rest as `not_stocked`). */
export async function listStockedCategories(): Promise<Result<{ code: string; name: string }[]>> {
  const [{ data: stocked, error: sErr }, { data: cats, error: cErr }] = await Promise.all([
    db().from("stocked_categories").select("category_code"),
    procure().from("item_categories").select("code, name"),
  ]);
  if (sErr) return fail(SERVICE, sErr);
  if (cErr) return fail(SERVICE, cErr);
  const names = new Map((cats ?? []).map((c) => [c.code as string, c.name as string]));
  return ok(SERVICE, (stocked ?? [])
    .map((s) => ({ code: s.category_code as string, name: names.get(s.category_code as string) ?? (s.category_code as string) }))
    .sort((a, b) => a.name.localeCompare(b.name)));
}

/** An item registered at the rack (`0168`, `ops_inv.register_item`): the
 *  catalogue entry, its 1–4 photos and — when the counter has the number —
 *  what is on the rack right now, as an opname adjustment against a location
 *  (D171). One seam, so a refused count never leaves an item with no count and
 *  a refused item never leaves orphan links. The photos are uploaded first
 *  (`documents.upload`) and arrive here as attachment ids. */
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
  const { data, error } = await db().rpc("register_item", {
    p_name: input.name,
    p_name_local: input.name_local ?? null,
    p_category_code: input.category_code,
    p_base_uom: input.base_uom,
    p_photo_ids: input.photo_ids,
    p_location: input.location ?? null,
    p_counted: input.counted ?? null,
    p_reason: input.reason ?? null,
    p_key: idempotencyKey ?? null,
  });
  const res = fromSeam<{ code: string }>(SERVICE, data, error);
  if (res.error) return res;
  return getStockItem(res.data.code);
}

/** The floor's name for an item already in the catalogue — most of the rack
 *  predates `0168`. Blank clears it. */
export async function setItemLocalName(itemCode: string, nameLocal: string | null): Promise<Result<StockItemDetail>> {
  const { data, error } = await db().rpc("set_item_local_name", {
    p_code: itemCode,
    p_name_local: nameLocal,
  });
  const res = fromSeam(SERVICE, data, error);
  if (res.error) return res;
  return getStockItem(itemCode);
}

/** The ledger lines that bought this item (`0104`'s `item_purchases`, opened
 *  to `inventory.read` by `0168`) — merged duplicates included. The link is
 *  `transaction_lines.item_id`, set when the purchase was booked; this reads
 *  it, it never guesses one. */
export async function stockItemPurchases(itemCode: string): Promise<Result<ItemPurchase[]>> {
  const { data, error } = await procure().rpc("item_purchases", { p_code: itemCode });
  const res = fromSeam<ItemPurchase[]>(SERVICE, data, error);
  if (res.error) return res;
  return ok(SERVICE, res.data.map((r) => ({
    ...r,
    qty: r.qty == null ? null : Number(r.qty),
    unit_price: r.unit_price == null ? null : Number(r.unit_price),
    amount: Number(r.amount),
  })));
}

/** Joins `v_stock_item` rows to `v_stock_by_location` (one query for every row
 *  on the screen, not one per row) and to each category's parent, for
 *  `group_code`/`group_name` — the category itself when it has no parent. */
async function withGroupAndLocation(
  rows: Array<Omit<StockItemView, "by_location" | "group_code" | "group_name">>,
): Promise<Result<StockItemView[]>> {
  if (rows.length === 0) return ok(SERVICE, []);
  const codes = rows.map((r) => r.item_code);

  const [locRes, catRes] = await Promise.all([
    db().from("v_stock_by_location").select("*").in("item_code", codes),
    procure().from("item_categories").select("code, name, parent_code"),
  ]);
  if (locRes.error) return fail(SERVICE, locRes.error);
  if (catRes.error) return fail(SERVICE, catRes.error);

  const byItem = new Map<string, { location: string; location_name: string; qty: number }[]>();
  for (const l of locRes.data ?? []) {
    const list = byItem.get(l.item_code as string) ?? [];
    list.push({ location: l.location as string, location_name: l.location_name as string, qty: l.qty as number });
    byItem.set(l.item_code as string, list);
  }
  const categories = new Map((catRes.data ?? []).map((c) => [c.code as string, c as { code: string; name: string; parent_code: string | null }]));

  return ok(SERVICE, rows.map((r) => {
    const cat = categories.get(r.category_code);
    const parent = cat?.parent_code ? categories.get(cat.parent_code) : null;
    return {
      ...r,
      by_location: (byItem.get(r.item_code) ?? []).sort((a, b) => b.qty - a.qty),
      group_code: parent?.code ?? r.category_code,
      group_name: parent?.name ?? r.category_name,
    };
  }));
}

export async function getStockItem(itemCode: string): Promise<Result<StockItemDetail>> {
  /* Moves, orders and BOM use are keyed by the code alone, so they are asked
     alongside the row rather than after it. */
  const [{ data: row, error }, movesRes, onOrderRes, usedInRes] = await Promise.all([
    db().from("v_stock_item").select("*").eq("item_code", itemCode).maybeSingle(),
    listStockMoves({ item_code: itemCode }),
    onOrderFor(itemCode),
    itemUsedIn(itemCode),
  ]);
  if (error) return fail(SERVICE, error);
  if (!row) {
    return notFound(
      SERVICE, "item_not_stocked",
      `${itemCode} is not an item this system counts — either it does not exist, or its category is one that is bought and used the same day.`,
    );
  }
  const withLoc = await withGroupAndLocation([row]);
  if (withLoc.error) return withLoc;
  const view = withLoc.data[0];

  if (movesRes.error) return movesRes;
  if (usedInRes.error) return usedInRes;

  return ok(SERVICE, {
    ...view,
    moves: movesRes.data,
    used_in: usedInRes.data,
    on_order: onOrderRes,
  });
}

/** Which products' BOMs call for this item — each product's **latest**
 *  revision only, because a line dropped in rev 3 is not a reason to keep
 *  buying. By code, across the seam (ADR-004). `ops_prod` is readable by any
 *  signed-in user (`0060`), so the catalogue can ask without production's
 *  grants. Was hard-coded empty while `ops_prod` had no tables. */
export async function itemUsedIn(itemCode: string): Promise<Result<StockItemDetail["used_in"]>> {
  const { data, error } = await prod().from("v_product_bom")
    .select("product_id, product_code, rev, qty")
    .eq("kind", "material").eq("ref_code", itemCode);
  if (error) return fail(SERVICE, error);
  const rows = (data ?? []) as { product_id: string; product_code: string; rev: number; qty: number | string }[];
  if (rows.length === 0) return ok(SERVICE, []);
  const productIds = [...new Set(rows.map((r) => r.product_id))];
  const [revs, products] = await Promise.all([
    prod().from("bom_revisions").select("product_id, rev").in("product_id", productIds),
    prod().from("products").select("id, name").in("id", productIds),
  ]);
  if (revs.error) return fail(SERVICE, revs.error);
  if (products.error) return fail(SERVICE, products.error);
  const latest = new Map<string, number>();
  for (const r of (revs.data ?? []) as { product_id: string; rev: number }[]) {
    latest.set(r.product_id, Math.max(latest.get(r.product_id) ?? 0, r.rev));
  }
  const names = new Map(((products.data ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name]));
  return ok(SERVICE, rows
    .filter((r) => r.rev === latest.get(r.product_id))
    .map((r) => ({ product_code: r.product_code, product_name: names.get(r.product_id) ?? r.product_code, qty_per_unit: Number(r.qty) }))
    .sort((a, b) => a.product_code.localeCompare(b.product_code)));
}

/** Approved requests for this item that have not yet arrived — `v_pr_line`'s
 *  own `status`/`received_qty`, read by the item's catalogue id (ADR-004: the
 *  screen has the code, the line has the id, so the id is resolved once here
 *  rather than every caller doing it). */
async function onOrderFor(itemCode: string): Promise<{ pr_line_no: string; qty: number; need_by: string | null }[]> {
  const { data: item } = await procure().from("items").select("id").eq("code", itemCode).maybeSingle();
  if (!item) return [];
  const { data } = await procure().from("v_pr_line")
    .select("line_no_full, qty, received_qty, need_by, status, removed_at")
    .eq("item_id", item.id).eq("status", "APPROVED").is("removed_at", null);
  return (data ?? [])
    .filter((l) => (l.received_qty as number ?? 0) < (l.qty as number))
    .map((l) => ({ pr_line_no: l.line_no_full as string, qty: l.qty as number, need_by: l.need_by as string | null }));
}

export async function listStockLocations(
  opts: { all?: boolean } = {},
): Promise<Result<StockLocation[]>> {
  let q = db().from("stock_locations").select("*");
  if (!opts.all) q = q.eq("is_active", true);
  const { data, error } = await q.order("name");
  return fromRows<StockLocation[]>(SERVICE, data as StockLocation[], error);
}

/** Adding a rack to count (`0157`). RLS alone gates it (`loc_new`,
 *  `inventory.update` — the same authority `stock_settings` already answers
 *  to), so a duplicate code lands here as `23505` and `fail()` turns it into
 *  `conflict` on its own; nothing here needs to pre-check for one. */
export async function createStockLocation(
  input: { code: string; name: string },
): Promise<Result<StockLocation>> {
  const code = input.code.trim().toUpperCase();
  const name = input.name.trim();
  if (!code) return invalid(SERVICE, "code_required", "Kode lokasi wajib diisi.", { field: "code" });
  if (!name) return invalid(SERVICE, "name_required", "Nama lokasi wajib diisi.", { field: "name" });
  const { data, error } = await db().from("stock_locations")
    .insert({ code, name }).select("*").single();
  if (error) return fail(SERVICE, error);
  return ok(SERVICE, data as StockLocation);
}

/** Renaming a rack, or retiring/reviving it. Never a delete — a rack once
 *  counted against stays addressable in `stock_moves` for ever (A5); `false`
 *  is how it stops being offered on new counts. */
export async function updateStockLocation(
  code: string,
  patch: { name?: string; is_active?: boolean },
): Promise<Result<StockLocation>> {
  const update: Record<string, unknown> = {};
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) return invalid(SERVICE, "name_required", "Nama lokasi wajib diisi.", { field: "name" });
    update.name = name;
  }
  if (patch.is_active !== undefined) update.is_active = patch.is_active;
  if (Object.keys(update).length === 0) return invalid(SERVICE, "nothing_to_change", "Tidak ada yang diubah.");

  /* Existence first, under the READ policy: a plain `.update()` under RLS
     matches zero rows both when the code does not exist and when the UPDATE
     policy hides it, and those are different answers (not_found vs refused).
     Checking existence separately is the only way to tell them apart without
     a security-definer seam, which this table deliberately has none of. */
  const { data: existing, error: findErr } = await db().from("stock_locations")
    .select("code").eq("code", code).maybeSingle();
  if (findErr) return fail(SERVICE, findErr);
  if (!existing) return notFound(SERVICE, "location_not_found", `No location ${code}.`);

  const { data, error } = await db().from("stock_locations")
    .update(update).eq("code", code).select("*").maybeSingle();
  if (error) return fail(SERVICE, error);
  if (!data) return refused(SERVICE, "not_permitted", "Tidak diizinkan mengubah lokasi ini.");
  return ok(SERVICE, data as StockLocation);
}

export async function listStockMoves(
  filter: { item_code?: string; ref_no?: string } = {},
): Promise<Result<StockMoveView[]>> {
  let q = db().from("stock_moves").select("*");
  if (filter.item_code) q = q.eq("item_code", filter.item_code);
  if (filter.ref_no) q = q.eq("ref_no", filter.ref_no);
  const { data, error } = await q.order("moved_at", { ascending: false });
  if (error) return fail(SERVICE, error);
  return viewMoves(data ?? []);
}

/** Adds `item_name`/`location_name`/`by_name`/`ref_missing` to raw
 *  `stock_moves` rows — batched, the same shape as `withGroupAndLocation`
 *  above, so a move-history screen is three queries regardless of row count. */
async function viewMoves(moves: StockMove[]): Promise<Result<StockMoveView[]>> {
  if (moves.length === 0) return ok(SERVICE, []);
  const itemCodes = [...new Set(moves.map((m) => m.item_code))];
  const locCodes = [...new Set(moves.map((m) => m.location))];
  const userIds = [...new Set(moves.map((m) => m.moved_by))];
  const spkRefs = [...new Set(moves.filter((m) => m.ref_no?.startsWith("spk-")).map((m) => m.ref_no as string))];

  const [itemsRes, locsRes, usersRes, woRes] = await Promise.all([
    procure().from("items").select("code, name").in("code", itemCodes),
    db().from("stock_locations").select("code, name").in("code", locCodes),
    supabaseBrowser().schema("ops_core").from("users").select("id, full_name").in("id", userIds),
    spkRefs.length
      ? supabaseBrowser().schema("ops_prod").from("work_orders").select("wo_no").in("wo_no", spkRefs)
      : Promise.resolve({ data: [] as { wo_no: string }[], error: null }),
  ]);
  if (itemsRes.error) return fail(SERVICE, itemsRes.error);
  if (locsRes.error) return fail(SERVICE, locsRes.error);
  if (usersRes.error) return fail(SERVICE, usersRes.error);
  /* ops_prod has no tables in this project yet (see getStockItem's used_in
     note) — every spk- ref reads as missing rather than erroring the whole
     move list, which is the honest answer until that module exists. */
  const knownWos = new Set((woRes.error ? [] : woRes.data ?? []).map((w) => w.wo_no));

  const itemNames = new Map((itemsRes.data ?? []).map((i) => [i.code as string, i.name as string]));
  const locNames = new Map((locsRes.data ?? []).map((l) => [l.code as string, l.name as string]));
  const userNames = new Map((usersRes.data ?? []).map((u) => [u.id as string, u.full_name as string]));

  return ok(SERVICE, moves.map((m) => ({
    ...m,
    item_name: itemNames.get(m.item_code) ?? m.item_code,
    location_name: locNames.get(m.location) ?? m.location,
    by_name: userNames.get(m.moved_by) ?? m.moved_by,
    ref_missing: !!m.ref_no?.startsWith("spk-") && !knownWos.has(m.ref_no),
  })));
}

async function onHandFor(itemCode: string): Promise<number> {
  const { data } = await db().from("v_stock_by_location").select("qty").eq("item_code", itemCode);
  return (data ?? []).reduce((s, r) => s + (r.qty as number), 0);
}

async function onHandAt(itemCode: string, location: string): Promise<number> {
  const { data } = await db().from("stock_moves").select("qty").eq("item_code", itemCode).eq("location", location);
  return (data ?? []).reduce((s, r) => s + (r.qty as number), 0);
}

/** Taking material out to the floor. Issuing more than the record shows is
 *  **allowed and flagged**, never refused (A6): `went_negative` says so in the
 *  answer rather than the write being blocked.
 *
 *  The one write in this family with a seam (`0097`) behind it rather than a
 *  plain insert — `returnStock`/`adjustStock`/`transferStock` stay a plain
 *  insert, matching their demo counterparts, which take no idempotency key
 *  either. A double tap issuing material is the one of the four where a
 *  repeat is a silent second bundle leaving the rack rather than a mistake
 *  somebody notices immediately (an adjustment or transfer of the same
 *  amount twice reads oddly on the screen; an issue of the same amount twice
 *  does not). */
export async function issueStock(
  input: { item_code: string; location: string; qty: number; wo_no?: string | null; reason?: string | null },
  idempotencyKey?: string,
): Promise<Result<{ move_no: string; on_hand_after: number; went_negative: boolean }>> {
  const { data, error } = await db().rpc("issue_stock", {
    p_item_code: input.item_code, p_location: input.location, p_qty: input.qty,
    p_wo_no: input.wo_no ?? null, p_reason: input.reason ?? null,
    p_key: idempotencyKey ?? null,
  });
  return fromSeam(SERVICE, data, error);
}

/** Material coming back unused. */
export async function returnStock(
  input: { item_code: string; location: string; qty: number; wo_no?: string | null; reason?: string | null },
): Promise<Result<{ move_no: string; on_hand_after: number }>> {
  if (input.qty <= 0) return invalid(SERVICE, "qty_invalid", "Jumlah kembali harus lebih dari nol.", { field: "qty" });
  const check = await stockable(input.item_code);
  if (!check.ok) return invalid(SERVICE, "not_stocked", check.why, { field: "item_code" });
  const uid = await currentUserId();
  if (uid.error) return uid;

  const before = await onHandFor(input.item_code);

  const { data, error } = await db().from("stock_moves").insert({
    item_code: input.item_code, location: input.location, kind: "return",
    qty: Math.abs(input.qty), uom: check.base_uom,
    ref_no: input.wo_no ?? null, reason: input.reason ?? null, moved_by: uid.data,
  }).select("move_no").single();
  if (error) return fail(SERVICE, error);

  return ok(SERVICE, { move_no: data.move_no as string, on_hand_after: Math.round((before + input.qty) * 1000) / 1000 });
}

/** An opname: what the rack actually held. The form takes the **counted**
 *  quantity, and the difference — the thing actually written — is computed
 *  here against this location's own moves, matching how `v_stock_by_location`
 *  itself sums them. */
export async function adjustStock(
  input: { item_code: string; location: string; counted_qty: number; reason: string },
): Promise<Result<{ move_no: string; difference: number } | { noop: true }>> {
  if (!input.reason?.trim()) {
    return invalid(
      SERVICE, "reason_required",
      "Penyesuaian harus punya alasan — selisihnya akan dibaca orang lain bulan depan.",
      { field: "reason" },
    );
  }
  const check = await stockable(input.item_code);
  if (!check.ok) return invalid(SERVICE, "not_stocked", check.why, { field: "item_code" });
  const uid = await currentUserId();
  if (uid.error) return uid;

  const here = await onHandAt(input.item_code, input.location);
  const difference = Math.round((input.counted_qty - here) * 1000) / 1000;

  if (difference === 0) return noop(SERVICE, { noop: true as const });

  const { data, error } = await db().from("stock_moves").insert({
    item_code: input.item_code, location: input.location, kind: "adjust",
    qty: difference, uom: check.base_uom, reason: input.reason, moved_by: uid.data,
  }).select("move_no").single();
  if (error) return fail(SERVICE, error);

  return ok(SERVICE, { move_no: data.move_no as string, difference });
}

/** Moving stock between locations — two rows, so each location's own history
 *  reads correctly on its own. Not one seam call: two inserts, same as the
 *  demo's two `writeMove()`s — there being no RPC to wrap them is what makes
 *  this the honest shape rather than a shortcut (see this file's header). */
export async function transferStock(
  input: { item_code: string; from: string; to: string; qty: number; reason?: string | null },
): Promise<Result<{ move_nos: string[] }>> {
  if (input.from === input.to) return invalid(SERVICE, "same_location", "Lokasi asal dan tujuan sama.", { field: "to" });
  if (input.qty <= 0) return invalid(SERVICE, "qty_invalid", "Jumlah pindah harus lebih dari nol.", { field: "qty" });
  const check = await stockable(input.item_code);
  if (!check.ok) return invalid(SERVICE, "not_stocked", check.why, { field: "item_code" });
  const uid = await currentUserId();
  if (uid.error) return uid;

  const { data, error } = await db().from("stock_moves").insert([
    { item_code: input.item_code, location: input.from, kind: "transfer", qty: -Math.abs(input.qty), uom: check.base_uom, reason: input.reason ?? null, moved_by: uid.data },
    { item_code: input.item_code, location: input.to, kind: "transfer", qty: Math.abs(input.qty), uom: check.base_uom, reason: input.reason ?? null, moved_by: uid.data },
  ]).select("move_no");
  if (error) return fail(SERVICE, error);

  return ok(SERVICE, { move_nos: (data ?? []).map((d) => d.move_no as string) });
}

/** How low is too low, per item. A threshold nobody set stays null, and the
 *  screen says *belum ditetapkan* rather than treating zero as the answer. */
export async function setStockMinimum(
  input: { item_code: string; min_qty: number | null; home_location?: string | null },
): Promise<Result<{ item_code: string; min_qty: number | null }>> {
  const payload: { item_code: string; min_qty: number | null; home_location?: string | null } = {
    item_code: input.item_code, min_qty: input.min_qty,
  };
  if (input.home_location !== undefined) payload.home_location = input.home_location;
  const { error } = await db().from("stock_settings")
    .upsert(payload, { onConflict: "item_code" });
  if (error) return fail(SERVICE, error);
  return ok(SERVICE, { item_code: input.item_code, min_qty: input.min_qty });
}

/* Stock from a confirmed receipt is not a client call. It is `0169`'s
   trigger on `ops_procure.receipts`, in the same transaction as the signature,
   so a dropped connection cannot leave a signed delivery with nothing on the
   rack. The client function that stood here was never called by anything. */

/* ------------------------------------------------------------------ */
/* Timber                                                               */
/* ------------------------------------------------------------------ */

/** A vendor's public code, for a seam addressed by code (ADR-004) — the
 *  reverse of `withGroupAndLocation`'s sibling lookups in `accounting.ts`,
 *  needed here because `LogPurchase.vendor_id` is, despite its name, always a
 *  code at the seam (C12) while the screens still pass an id. */
async function vendorCodeFor(vendorId: string): Promise<string | null> {
  const { data } = await procure().from("vendors").select("code").eq("id", vendorId).maybeSingle();
  return (data as { code: string } | null)?.code ?? null;
}

/** Every `LogPurchaseView` this module returns, built the same way for one
 *  purchase or for the whole list: `v_log_purchase` (`0070`) for the
 *  per-load arithmetic, `log_pieces`/`sawn_boards` batched by purchase id for
 *  the nested `logs`/`boards` arrays, vendor codes resolved back to ids, the
 *  nota resolved via `attachment_links` (C14 — there is no column for it),
 *  and `warnings[]` built from figures the view already computed — the same
 *  boundary `getCashPlan`'s `label`/`verdict` sit on, restated from
 *  `logPurchaseView()` in `src/demo/inventory-derive.ts` rather than
 *  recomputing the volumes and yield it already read off the view. */
async function buildLogPurchaseViews(purchaseNos?: string[]): Promise<Result<LogPurchaseView[]>> {
  let q = db().from("v_log_purchase").select("*");
  if (purchaseNos) q = q.in("purchase_no", purchaseNos);
  const { data, error } = await q.order("received_on", { ascending: false });
  if (error) return fail(SERVICE, error);
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  if (rows.length === 0) return ok(SERVICE, []);

  const ids = rows.map((r) => r.id as string);
  const nos = rows.map((r) => r.purchase_no as string);
  const vendorCodes = [...new Set(rows.map((r) => r.vendor_code as string))];

  const [piecesRes, boardsRes, costsRes, linksRes, lowYieldRes] = await Promise.all([
    db().from("log_pieces").select("*").in("purchase_id", ids),
    db().from("sawn_boards").select("*").in("purchase_id", ids),
    db().from("log_costs").select("*").in("purchase_id", ids).order("incurred_on"),
    core().from("attachment_links").select("entity_no, attachment_id")
      .eq("entity", "log_purchase").eq("kind", "nota").is("unlinked_at", null).in("entity_no", nos),
    core().rpc("setting_num", { p_key: "ops.low_yield_percent" }),
  ]);
  if (piecesRes.error) return fail(SERVICE, piecesRes.error);
  if (boardsRes.error) return fail(SERVICE, boardsRes.error);
  if (costsRes.error) return fail(SERVICE, costsRes.error);
  if (linksRes.error) return fail(SERVICE, linksRes.error);

  /* A trucker's vendor code joins the timber sellers' in one lookup, and each
     cost's own nota is found by its own number (`0155`) — never counted as
     the load's (`has_nota`). */
  const costRows = (costsRes.data ?? []) as Array<Record<string, unknown>>;
  const allCodes = [...new Set([...vendorCodes, ...costRows.map((c) => c.vendor_code as string | null).filter((c): c is string => !!c)])];
  const [vendorsRes, costLinksRes] = await Promise.all([
    procure().from("vendors").select("id, code").in("code", allCodes),
    costRows.length === 0
      ? Promise.resolve({ data: [] as { entity_no: string; attachment_id: string }[], error: null })
      : core().from("attachment_links").select("entity_no, attachment_id")
        .eq("entity", "log_cost").eq("kind", "nota").is("unlinked_at", null)
        .in("entity_no", costRows.map((c) => c.cost_no as string)),
  ]);
  if (vendorsRes.error) return fail(SERVICE, vendorsRes.error);
  if (costLinksRes.error) return fail(SERVICE, costLinksRes.error);

  const lowYieldThreshold = (lowYieldRes.data as number | null) ?? 45;
  const vendorIdByCode = new Map((vendorsRes.data ?? []).map((v) => [v.code as string, v.id as string]));
  const notaByPurchaseNo = new Map((linksRes.data ?? []).map((l) => [l.entity_no as string, l.attachment_id as string]));
  const notaByCostNo = new Map((costLinksRes.data ?? []).map((l) => [l.entity_no as string, l.attachment_id as string]));
  const purchaseNoById = new Map(rows.map((r) => [r.id as string, r.purchase_no as string]));

  const costsByPurchase = new Map<string, LogCost[]>();
  for (const c of costRows) {
    const code = c.vendor_code as string | null;
    const cost: LogCost = {
      id: c.id as string,
      cost_no: c.cost_no as string,
      purchase_no: purchaseNoById.get(c.purchase_id as string) ?? "",
      kind: c.kind as LogCostKind,
      amount: c.amount as number,
      incurred_on: c.incurred_on as string,
      payee: c.payee as string | null,
      vendor_id: code ? vendorIdByCode.get(code) ?? code : null,
      trx_no: c.trx_no as string | null,
      nota_attachment_id: notaByCostNo.get(c.cost_no as string) ?? null,
      note: c.note as string | null,
      created_at: c.created_at as string,
    };
    const list = costsByPurchase.get(c.purchase_id as string) ?? [];
    list.push(cost);
    costsByPurchase.set(c.purchase_id as string, list);
  }

  const piecesByPurchase = new Map<string, LogPieceView[]>();
  for (const p of piecesRes.data ?? []) {
    const measure = (rows.find((r) => r.id === p.purchase_id)?.measure as LogMeasure) ?? "round";
    const view: LogPieceView = {
      ...(p as unknown as LogPiece),
      m3: logVolumeM3(p.diameter_cm as number, p.length_cm as number, measure),
    };
    const list = piecesByPurchase.get(p.purchase_id as string) ?? [];
    list.push(view);
    piecesByPurchase.set(p.purchase_id as string, list);
  }
  for (const list of piecesByPurchase.values()) list.sort((a, b) => a.tag.localeCompare(b.tag));

  const boardsByPurchase = new Map<string, SawnBoardView[]>();
  for (const b of boardsRes.data ?? []) {
    const each = boardVolumeM3(b.thickness_mm as number, b.width_mm as number, b.length_mm as number);
    const view: SawnBoardView = {
      ...(b as unknown as SawnBoard),
      m3_each: each,
      m3: round4(each * (b.qty as number)),
      size: `${(b.thickness_mm as number) / 10} × ${(b.width_mm as number) / 10} × ${(b.length_mm as number) / 10} cm`,
    };
    const list = boardsByPurchase.get(b.purchase_id as string) ?? [];
    list.push(view);
    boardsByPurchase.set(b.purchase_id as string, list);
  }
  for (const list of boardsByPurchase.values()) {
    list.sort((a, b) => a.sawn_on.localeCompare(b.sawn_on) || a.size.localeCompare(b.size));
  }

  const views: LogPurchaseView[] = rows.map((r) => {
    const logs = piecesByPurchase.get(r.id as string) ?? [];
    const boards = boardsByPurchase.get(r.id as string) ?? [];
    const log_m3 = r.log_m3 as number;
    const sawn_m3 = r.sawn_m3 as number;
    const unsawn_m3 = r.unsawn_m3 as number;
    const yield_percent = r.yield_percent as number | null;
    const measure_gap_m3 = r.claimed_gap_m3 as number | null;
    const claimed_m3 = r.claimed_m3 as number | null;

    const warnings: string[] = [];
    /* A load bought as boards has no sticks to measure, and is not missing
       any (`0156`). */
    if ((r.pieces as number) === 0 && boards.length === 0) {
      warnings.push("Belum ada batang yang diukur — kubikasi dan harga per m³ belum bisa dihitung.");
    }
    if (log_m3 > 0 && sawn_m3 === 0) {
      warnings.push("Belum ada papan yang dilaporkan — angka rendemen dan harga per m³ papan belum ada.");
    }
    if (unsawn_m3 > 0 && sawn_m3 > 0) {
      warnings.push(`${unsawn_m3} m³ belum digergaji — rendemen dan harga per m³ papan dihitung hanya dari batang yang sudah.`);
    }
    if (yield_percent != null && yield_percent > 100) {
      warnings.push(`Papan ${sawn_m3} m³ melebihi log ${log_m3} m³ — salah ukur, atau ada papan dari log lain masuk ke sini.`);
    } else if (yield_percent != null && yield_percent < lowYieldThreshold) {
      warnings.push(`Rendemen ${yield_percent}% — di bawah yang biasa. Layak ditanyakan ke pemilik sawmill.`);
    }
    if (measure_gap_m3 != null && Math.abs(measure_gap_m3) >= 0.05) {
      warnings.push(
        measure_gap_m3 < 0
          ? `Ukuran kita ${Math.abs(measure_gap_m3)} m³ LEBIH KECIL dari yang ditagih (${claimed_m3} m³).`
          : `Ukuran kita ${measure_gap_m3} m³ lebih besar dari yang ditagih (${claimed_m3} m³).`,
      );
    }

    return {
      id: r.id as string,
      purchase_no: r.purchase_no as string,
      vendor_id: vendorIdByCode.get(r.vendor_code as string) ?? (r.vendor_code as string),
      trx_no: r.trx_no as string | null,
      pr_line_no: r.pr_line_no as string | null,
      received_on: r.received_on as string,
      species: r.species as string,
      total_cost: r.total_cost as number,
      claimed_m3, measure: r.measure as LogMeasure,
      nota_attachment_id: notaByPurchaseNo.get(r.purchase_no as string) ?? null,
      note: r.note as string | null,
      created_at: r.created_at as string,
      created_by: r.created_by as string,
      vendor_name: (r.vendor_name as string) ?? "—",
      logs, boards, log_m3, sawn_m3, yield_percent,
      cost_per_log_m3: r.cost_per_log_m3 as number | null,
      cost_per_sawn_m3: r.cost_per_sawn_m3 as number | null,
      unsawn_m3, measure_gap_m3, warnings,
      costs: costsByPurchase.get(r.id as string) ?? [],
      extra_cost: r.extra_cost as number,
      landed_cost: r.landed_cost as number,
      sawn_m2: r.sawn_m2 as number,
      landed_cost_per_log_m3: r.landed_cost_per_log_m3 as number | null,
      landed_cost_per_sawn_m3: r.landed_cost_per_sawn_m3 as number | null,
      landed_cost_per_sawn_m2: r.landed_cost_per_sawn_m2 as number | null,
    };
  });

  return ok(SERVICE, views);
}

export async function listLogPurchases(): Promise<Result<LogPurchaseView[]>> {
  return buildLogPurchaseViews();
}

export async function getLogPurchase(purchaseNo: string): Promise<Result<LogPurchaseView>> {
  const res = await buildLogPurchaseViews([purchaseNo]);
  if (res.error) return res;
  const found = res.data[0];
  if (!found) return notFound(SERVICE, "purchase_not_found", `No log purchase ${purchaseNo}.`);
  return ok(SERVICE, found);
}

/** Every vendor's timber side by side. The column that decides is the
 *  landed cost per board m³, not the invoice price (D153) —
 *  `v_timber_by_vendor` (`0070`, `0156`) groups by vendor and species and sums
 *  the transport and sawing notas beside the invoices. */
export async function timberByVendor(): Promise<Result<TimberVendorSummary[]>> {
  const { data, error } = await db().from("v_timber_by_vendor").select("*")
    .order("species").order("landed_cost_per_sawn_m3", { ascending: false });
  if (error) return fail(SERVICE, error);
  const rows = data ?? [];
  const codes = [...new Set(rows.map((r) => r.vendor_code as string))];
  const { data: vendors, error: vErr } = await procure().from("vendors").select("id, code").in("code", codes);
  if (vErr) return fail(SERVICE, vErr);
  const idByCode = new Map((vendors ?? []).map((v) => [v.code as string, v.id as string]));

  return ok(SERVICE, rows.map((r) => ({
    vendor_id: idByCode.get(r.vendor_code as string) ?? (r.vendor_code as string),
    vendor_name: r.vendor_name as string,
    species: r.species as string,
    purchases: r.loads as number,
    log_m3: r.log_m3 as number,
    sawn_m3: r.sawn_m3 as number,
    total_cost: r.total_cost as number,
    yield_percent: r.yield_percent as number | null,
    cost_per_log_m3: r.cost_per_log_m3 as number | null,
    cost_per_sawn_m3: r.cost_per_sawn_m3 as number | null,
    unsawn_m3: r.unsawn_m3 as number,
    sawn_m2: r.sawn_m2 as number,
    cost_angkut: r.cost_angkut as number,
    cost_potong: r.cost_potong as number,
    cost_bongkar: r.cost_bongkar as number,
    cost_lain: r.cost_lain as number,
    extra_cost: r.extra_cost as number,
    landed_cost: r.landed_cost as number,
    landed_cost_per_log_m3: r.landed_cost_per_log_m3 as number | null,
    landed_cost_per_sawn_m3: r.landed_cost_per_sawn_m3 as number | null,
    landed_cost_per_sawn_m2: r.landed_cost_per_sawn_m2 as number | null,
  })));
}

/** Timber purchases recapped by month, for reporting rather than comparing
 *  vendors (`0157`). `v_timber_by_month` carries no per-cubic-metre rate —
 *  that figure only means anything within one species (D153) and a month
 *  usually spans several — so this is totals only. */
export async function timberByMonth(): Promise<Result<TimberMonthSummary[]>> {
  const { data, error } = await db().from("v_timber_by_month").select("*").order("month", { ascending: false });
  if (error) return fail(SERVICE, error);
  return ok(SERVICE, (data ?? []).map((r) => ({
    month: r.month as string,
    loads: r.loads as number,
    vendors: r.vendors as number,
    species_count: r.species_count as number,
    wood_cost: r.wood_cost as number,
    extra_cost: r.extra_cost as number,
    landed_cost: r.landed_cost as number,
    log_m3: r.log_m3 as number,
    sawn_m3: r.sawn_m3 as number,
    sawn_m2: r.sawn_m2 as number,
  })));
}

/** A charge against a load — the truck, the sawmill — from **its own nota**.
 *
 *  One row, so `0156`'s RLS is enough (no seam, matching this file's header).
 *  The timber invoice is never touched: the landed figures are summed on read.
 *  The cost's nota is linked afterwards under the cost's own number, the same
 *  optional, non-atomic evidence link `receiveLogs` makes (A6). */
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
  if (!input.amount || input.amount <= 0) {
    return invalid(SERVICE, "amount_required", "Berapa biayanya?", { field: "amount" });
  }
  const { data: purchase, error: pErr } = await db().from("log_purchases").select("id")
    .eq("purchase_no", input.purchase_no).maybeSingle();
  if (pErr) return fail(SERVICE, pErr);
  if (!purchase) return notFound(SERVICE, "purchase_not_found", `No log purchase ${input.purchase_no}.`);

  let vendorCode: string | null = null;
  if (input.vendor_id) {
    vendorCode = await vendorCodeFor(input.vendor_id);
    if (!vendorCode) return notFound(SERVICE, "vendor_not_found", "Vendor itu tidak ada.");
  }

  const { data: row, error } = await db().from("log_costs").insert({
    purchase_id: purchase.id,
    kind: input.kind,
    amount: Math.round(input.amount),
    incurred_on: input.incurred_on,
    payee: input.payee?.trim() || null,
    vendor_code: vendorCode,
    trx_no: input.trx_no?.trim() || null,
    note: input.note?.trim() || null,
  }).select("cost_no").single();
  if (error) return fail(SERVICE, error);

  if (input.nota_attachment_id) {
    const uid = await currentUserId();
    if (!uid.error) {
      await core().from("attachment_links").insert({
        attachment_id: input.nota_attachment_id, entity: "log_cost",
        entity_no: (row as { cost_no: string }).cost_no, kind: "nota", linked_by: uid.data,
      });
    }
  }
  return getLogPurchase(input.purchase_no);
}

/** A load of logs arriving — `ops_inv.receive_logs()` (`0095`), the one
 *  atomic write in this module: the purchase, its logs and any boards read
 *  straight off the nota land in one transaction, because three separate
 *  `.insert()`s could leave a purchase with no logs behind it if the second
 *  one failed. `nota_attachment_id` is linked afterwards, the same optional,
 *  non-atomic evidence link `confirmReceipt`'s `delivery_note_attachment_id`
 *  already is (`0086`) — a load that arrived is a fact whether or not the
 *  link lands (A6). */
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
    boards?: { thickness_mm: number; width_mm: number; length_mm: number; qty: number; grade?: string | null }[];
    logs?: { tag?: string; diameter_cm: number; length_cm: number }[];
  },
  idempotencyKey?: string,
): Promise<Result<LogPurchaseView>> {
  const vendorCode = await vendorCodeFor(input.vendor_id);
  if (!vendorCode) return notFound(SERVICE, "vendor_not_found", "Vendor itu tidak ada.");

  const { data, error } = await db().rpc("receive_logs", {
    p_vendor_code: vendorCode,
    p_received_on: input.received_on,
    p_species: input.species,
    p_total_cost: Math.round(input.total_cost),
    p_claimed_m3: input.claimed_m3 ?? null,
    p_measure: input.measure ?? "round",
    p_trx_no: input.trx_no ?? null,
    p_pr_line_no: input.pr_line_no ?? null,
    p_note: input.note ?? null,
    p_logs: (input.logs ?? []).map((l) => ({ tag: l.tag ?? null, diameter_cm: l.diameter_cm, length_cm: l.length_cm })),
    p_boards: (input.boards ?? []).map((b) => ({
      thickness_mm: b.thickness_mm, width_mm: b.width_mm, length_mm: b.length_mm, qty: b.qty, grade: b.grade ?? null,
    })),
    p_key: idempotencyKey ?? null,
  });
  const res = fromSeam<{ purchase_no: string }>(SERVICE, data, error);
  if (res.error) return res;

  if (input.nota_attachment_id) {
    const uid = await currentUserId();
    if (!uid.error) {
      await core().from("attachment_links").insert({
        attachment_id: input.nota_attachment_id, entity: "log_purchase",
        entity_no: res.data.purchase_no, kind: "nota", linked_by: uid.data,
      });
    }
  }
  return getLogPurchase(res.data.purchase_no);
}

/** One log, measured — a single row against a load that already exists, so
 *  `0070`'s RLS is enough (no seam, matching this file's header). The tag
 *  falls back to `#N` exactly as the demo's does when nobody gives one;
 *  `piece_tag_once` (`0070`) refuses a repeat within the same load. */
export async function addLog(
  input: { purchase_no: string; tag: string; diameter_cm: number; length_cm: number; note?: string | null },
): Promise<Result<LogPurchaseView>> {
  const { data: purchase, error: pErr } = await db().from("log_purchases").select("id")
    .eq("purchase_no", input.purchase_no).maybeSingle();
  if (pErr) return fail(SERVICE, pErr);
  if (!purchase) return notFound(SERVICE, "purchase_not_found", `No log purchase ${input.purchase_no}.`);

  let tag = input.tag.trim();
  if (!tag) {
    const { count } = await db().from("log_pieces")
      .select("id", { count: "exact", head: true }).eq("purchase_id", purchase.id);
    tag = `#${(count ?? 0) + 1}`;
  }

  const { error } = await db().from("log_pieces").insert({
    purchase_id: purchase.id, tag,
    diameter_cm: input.diameter_cm, length_cm: input.length_cm,
    note: input.note?.trim() || null,
  });
  if (error) {
    if (error.code === "23505") return conflict(SERVICE, "tag_used", `Nomor ${input.tag} sudah dipakai di kiriman ini.`);
    return fail(SERVICE, error);
  }
  return getLogPurchase(input.purchase_no);
}

/** Boards off the saw. Reporting them off a named log is what marks that log
 *  sawn — one write here, then a second only when the log had no `sawn_on`
 *  yet, the same "the second one is the one people forget" reasoning the
 *  demo gives. */
export async function reportBoards(
  input: {
    purchase_no: string; log_tag?: string | null;
    thickness_mm: number; width_mm: number; length_mm: number; qty: number;
    sawn_on: string; grade?: string | null; note?: string | null;
  },
): Promise<Result<LogPurchaseView>> {
  const { data: purchase, error: pErr } = await db().from("log_purchases").select("id")
    .eq("purchase_no", input.purchase_no).maybeSingle();
  if (pErr) return fail(SERVICE, pErr);
  if (!purchase) return notFound(SERVICE, "purchase_not_found", `No log purchase ${input.purchase_no}.`);

  let logId: string | null = null;
  if (input.log_tag) {
    const { data: log } = await db().from("log_pieces").select("id, sawn_on")
      .eq("purchase_id", purchase.id).eq("tag", input.log_tag).maybeSingle();
    if (!log) return notFound(SERVICE, "log_not_found", `Tidak ada batang ${input.log_tag} di kiriman ini.`);
    logId = log.id as string;
    if (!log.sawn_on) {
      await db().from("log_pieces").update({ sawn_on: input.sawn_on }).eq("id", logId);
    }
  }

  const { error } = await db().from("sawn_boards").insert({
    purchase_id: purchase.id, log_id: logId,
    thickness_mm: input.thickness_mm, width_mm: input.width_mm, length_mm: input.length_mm,
    qty: input.qty, sawn_on: input.sawn_on,
    grade: input.grade?.trim() || null, note: input.note?.trim() || null,
  });
  if (error) return fail(SERVICE, error);
  return getLogPurchase(input.purchase_no);
}

/** Marking a log sawn without reporting boards — for the one that split and
 *  produced nothing. It still counts against the yield, which is the point. */
export async function markLogSawn(
  input: { purchase_no: string; tag: string; sawn_on: string; note?: string | null },
): Promise<Result<LogPurchaseView>> {
  const { data: purchase, error: pErr } = await db().from("log_purchases").select("id")
    .eq("purchase_no", input.purchase_no).maybeSingle();
  if (pErr) return fail(SERVICE, pErr);
  if (!purchase) return notFound(SERVICE, "purchase_not_found", `No log purchase ${input.purchase_no}.`);

  const { data: log } = await db().from("log_pieces").select("id")
    .eq("purchase_id", purchase.id).eq("tag", input.tag).maybeSingle();
  if (!log) return notFound(SERVICE, "log_not_found", `Tidak ada batang ${input.tag}.`);

  const patch: { sawn_on: string; note?: string } = { sawn_on: input.sawn_on };
  if (input.note?.trim()) patch.note = input.note.trim();
  const { error } = await db().from("log_pieces").update(patch).eq("id", log.id);
  if (error) return fail(SERVICE, error);
  return getLogPurchase(input.purchase_no);
}

/** Reading a nota, without writing anything (D200) — pure text parsing,
 *  `_nota_kayu.ts`, no database involved. */
export async function readNota(text: string): Promise<Result<NotaScan>> {
  return ok(SERVICE, scanNota(text));
}

/** Reading a **photo** of a nota, without writing anything (D200).
 *
 *  The one call here that is not PostgREST: the model key cannot be in a
 *  browser, so the photo makes one hop through `/api/inventory/nota/read`,
 *  which answers the same `NotaScan` the text reader does. The route's
 *  refusals are relayed whole — *no model configured* names the thing to do. */
export async function readNotaImage(file: File): Promise<Result<NotaScan>> {
  const body = new FormData();
  body.append("file", file);
  let res: Response;
  try {
    res = await fetch("/api/inventory/nota/read", { method: "POST", body, credentials: "same-origin" });
  } catch (e) {
    return {
      error: {
        code: "upload_interrupted",
        message: `Foto nota terputus sebelum sampai. Coba lagi. (${String((e as Error).message)})`,
        outcome: "refused", status: 500,
      },
      meta: { request_id: "", service: SERVICE, version: "1", outcome: "refused" },
    };
  }
  const envelope = await res.json().catch(() => ({})) as { data?: NotaScan; error?: Result<never>["error"] };
  if (!res.ok || envelope.error || !envelope.data) {
    return {
      error: envelope.error ?? {
        code: "read_failed", message: `Nota tidak terbaca (${res.status}).`,
        outcome: "refused", status: res.status as never,
      },
      meta: { request_id: "", service: SERVICE, version: "1", outcome: "refused" },
    } as Result<never>;
  }
  return ok(SERVICE, envelope.data);
}

/* ------------------------------------------------------------------ */
/* The board rack                                                       */
/* ------------------------------------------------------------------ */

export async function listBoardStock(): Promise<Result<BoardStockView[]>> {
  const { data, error } = await db().from("v_board_stock").select("*")
    .order("species").order("thickness_mm").order("width_mm");
  return fromRows<BoardStockView[]>(SERVICE, data as BoardStockView[], error);
}

/** Every movement, sawing included, newest first — `v_board_stock`'s (`0094`)
 *  raw sources read directly rather than through a second view: `sawn_boards`
 *  synthesizes a `"sawn"` move per row (there is no such row in
 *  `board_moves`, D203) and `board_moves` itself, both priced by the same
 *  load-then-species-dearest rule `v_board_stock` uses, restated here rather
 *  than duplicated in SQL because — unlike `v_board_stock`'s per-key
 *  aggregation — this is a per-row transform with no grouping to get wrong. */
export async function listBoardMoves(
  filter: { board_key?: string; ref_no?: string; limit?: number } = {},
): Promise<Result<BoardMoveView[]>> {
  const [sawnRes, movesRes, purchasesRes] = await Promise.all([
    db().from("sawn_boards").select("*"),
    db().from("board_moves").select("*"),
    db().from("v_log_purchase").select("id, purchase_no, species, cost_per_sawn_m3, created_by"),
  ]);
  if (sawnRes.error) return fail(SERVICE, sawnRes.error);
  if (movesRes.error) return fail(SERVICE, movesRes.error);
  if (purchasesRes.error) return fail(SERVICE, purchasesRes.error);

  const purchases = new Map((purchasesRes.data ?? []).map((p) => [p.id as string, p]));
  const dearestBySpecies = new Map<string, number>();
  for (const p of purchasesRes.data ?? []) {
    const c = p.cost_per_sawn_m3 as number | null;
    if (c != null) {
      const species = p.species as string;
      dearestBySpecies.set(species, Math.max(dearestBySpecies.get(species) ?? 0, c));
    }
  }
  const rateFor = (purchaseId: string | null, species: string): { rate: number | null; basis: "load" | "dearest" | null } => {
    const own = purchaseId ? ((purchases.get(purchaseId)?.cost_per_sawn_m3 as number | null | undefined) ?? null) : null;
    if (own != null) return { rate: own, basis: "load" };
    const dearest = dearestBySpecies.get(species) ?? null;
    return dearest == null ? { rate: null, basis: null } : { rate: dearest, basis: "dearest" };
  };

  const userIds = [...new Set([
    ...(purchasesRes.data ?? []).map((p) => p.created_by as string),
    ...(movesRes.data ?? []).map((m) => m.moved_by as string),
  ])];
  const { data: users, error: uErr } = await core().from("users").select("id, full_name").in("id", userIds);
  if (uErr) return fail(SERVICE, uErr);
  const nameOf = new Map((users ?? []).map((u) => [u.id as string, u.full_name as string]));

  const fromSawing: BoardMoveView[] = (sawnRes.data ?? []).map((sb) => {
    const purchase = purchases.get(sb.purchase_id as string);
    const species = (purchase?.species as string) ?? "—";
    const t = sb.thickness_mm as number, w = sb.width_mm as number, l = sb.length_mm as number, qty = sb.qty as number;
    const m3Each = boardVolumeM3(t, w, l);
    const { rate, basis } = rateFor(sb.purchase_id as string, species);
    const createdBy = (purchase?.created_by as string) ?? "";
    return {
      id: sb.id as string, move_no: sb.id as string, at: `${sb.sawn_on}T12:00:00+08:00`,
      board_key: `${species}|${t}x${w}x${l}`,
      species, thickness_mm: t, width_mm: w, length_mm: l,
      qty, kind: "sawn",
      purchase_id: sb.purchase_id as string | null, ref_no: null,
      reason: sb.grade ? `Grade ${sb.grade}` : null,
      by: createdBy,
      size: `${t / 10} × ${w / 10} × ${l / 10} cm`,
      m3: round4(m3Each * qty),
      purchase_no: (purchase?.purchase_no as string) ?? null,
      by_name: nameOf.get(createdBy) ?? createdBy,
      value: rate == null ? null : Math.round(rate * m3Each * qty),
      value_basis: basis,
    };
  });

  const rest: BoardMoveView[] = (movesRes.data ?? []).map((m) => {
    const t = m.thickness_mm as number, w = m.width_mm as number, l = m.length_mm as number, qty = m.qty as number;
    const species = m.species as string;
    const m3Each = boardVolumeM3(t, w, l);
    const { rate, basis } = rateFor(m.purchase_id as string | null, species);
    const purchase = m.purchase_id ? purchases.get(m.purchase_id as string) : null;
    const movedBy = m.moved_by as string;
    return {
      id: m.id as string, move_no: m.move_no as string, at: m.at as string,
      board_key: `${species}|${t}x${w}x${l}`,
      species, thickness_mm: t, width_mm: w, length_mm: l,
      qty, kind: m.kind as BoardMoveKind,
      purchase_id: m.purchase_id as string | null, ref_no: m.ref_no as string | null, reason: m.reason as string | null,
      by: movedBy,
      size: `${t / 10} × ${w / 10} × ${l / 10} cm`,
      m3: round4(m3Each * qty),
      purchase_no: (purchase?.purchase_no as string) ?? null,
      by_name: nameOf.get(movedBy) ?? movedBy,
      value: rate == null ? null : Math.round(rate * m3Each * qty),
      value_basis: basis,
    };
  });

  const merged = [...fromSawing, ...rest]
    .filter((m) => (!filter.board_key || m.board_key === filter.board_key) && (!filter.ref_no || m.ref_no === filter.ref_no))
    .sort((a, b) => b.at.localeCompare(a.at));

  return ok(SERVICE, merged.slice(0, filter.limit ?? 300));
}

/** Taking boards to the floor, bringing them back, scrapping them, or
 *  counting them and finding something else — `ops_inv.move_boards()`
 *  (`0094`), the one hard block in this system (D205): issuing or scrapping
 *  more than the rack holds is refused there, not flagged, because RLS alone
 *  cannot see every other row for a size the way the seam's own read of
 *  `v_board_stock` does. `kind: "sawn"` is refused **here**, before the
 *  seam: `ops_inv.board_move_kind_t` (`0094`) has no such value at all — a
 *  screen that sent it would meet a Postgres type-cast error instead of the
 *  seam's own worded refusal, which this one line exists to give it instead. */
export async function moveBoards(
  input: {
    board_key: string; kind: BoardMoveKind; qty: number;
    ref_no?: string | null; purchase_no?: string | null; reason?: string | null;
  },
  idempotencyKey?: string,
): Promise<Result<BoardStockView[]>> {
  if (input.kind === "sawn") {
    return invalid(
      SERVICE, "sawn_is_reported",
      "Papan masuk lewat laporan gergajian, bukan lewat sini — supaya rendemen dan isi rak tidak pernah berbeda.",
      { field: "kind" },
    );
  }
  const { data, error } = await db().rpc("move_boards", {
    p_board_key: input.board_key, p_kind: input.kind, p_qty: input.qty,
    p_ref_no: input.ref_no ?? null, p_purchase_no: input.purchase_no ?? null, p_reason: input.reason ?? null,
    p_key: idempotencyKey ?? null,
  });
  const res = fromSeam(SERVICE, data, error);
  if (res.error) return res;
  return listBoardStock();
}


/* ------------------------------------------------------------------ */
/* The asset register (0107)                                           */
/* ------------------------------------------------------------------ */

/** `src/demo/state.ts`'s `AuditRow`, restated rather than imported — this
 *  module does not depend on the demo (see `src/lib/api/accounting.ts`). */
interface AuditRow {
  id: string;
  at: string;
  actor_id: string;
  actor_email: string;
  service: string;
  entity: string;
  entity_no: string;
  action: string;
  outcome: "ok" | "refused" | "duplicate" | "noop";
  reason: string | null;
  detail?: Record<string, unknown> | null;
}

/** `numeric` and `bigint` arrive as strings or numbers; the contract says number. */
function toAssetView(r: Record<string, unknown>): AssetView {
  return {
    ...(r as unknown as AssetView),
    purchase_cost: r.purchase_cost == null ? null : Number(r.purchase_cost),
    rent_amount: r.rent_amount == null ? null : Number(r.rent_amount),
    document_count: Number(r.document_count ?? 0),
    rent_lines: Number(r.rent_lines ?? 0),
    service_count: Number(r.service_count ?? 0),
  };
}

/** The register, newest tag first. Gone assets (disposed, lost, returned) are
 *  left out unless asked for. */
export async function listAssets(
  opts: { q?: string; category?: string; status?: AssetStatus; include_gone?: boolean } = {},
): Promise<Result<AssetView[]>> {
  let q = db().from("v_asset").select("*");
  if (!opts.include_gone && !opts.status) q = q.not("status", "in", "(disposed,lost,returned)");
  if (opts.status) q = q.eq("status", opts.status);
  if (opts.category) q = q.eq("category_code", opts.category);
  if (opts.q) {
    /* Quoted, so a comma or bracket typed into the box is search text, not
       PostgREST filter syntax. */
    const needle = `"%${opts.q.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}%"`;
    q = q.or(["asset_no", "name", "brand", "model", "identifier", "location", "holder"]
      .map((c) => `${c}.ilike.${needle}`).join(","));
  }
  const { data, error } = await q.order("asset_no", { ascending: false });
  if (error) return fail(SERVICE, error);
  return ok(SERVICE, (data ?? []).map((r) => toAssetView(r as Record<string, unknown>)));
}

export async function getAsset(assetNo: string): Promise<Result<AssetView>> {
  const { data, error } = await db().from("v_asset").select("*").eq("asset_no", assetNo).maybeSingle();
  if (error) return fail(SERVICE, error);
  if (!data) return notFound(SERVICE, "asset_not_found", "No such asset.");
  return ok(SERVICE, toAssetView(data as Record<string, unknown>));
}

export async function createAsset(
  input: AssetInput & { name: string; category_code: string; status?: AssetStatus },
  idempotencyKey?: string,
): Promise<Result<AssetView>> {
  const { data, error } = await db().rpc("create_asset", {
    p_name: input.name,
    p_category_code: input.category_code,
    p_brand: input.brand ?? null,
    p_model: input.model ?? null,
    p_identifier: input.identifier ?? null,
    p_location: input.location ?? null,
    p_holder: input.holder ?? null,
    p_status: input.status ?? "in_use",
    p_acquired_on: input.acquired_on ?? null,
    p_purchase_cost: input.purchase_cost ?? null,
    p_vendor_code: input.vendor_code ?? null,
    p_trx_no: input.trx_no ?? null,
    p_warranty_until: input.warranty_until ?? null,
    p_notes: input.notes ?? null,
    p_key: idempotencyKey ?? null,
    p_ownership: input.ownership ?? null,
    p_rent_amount: input.rent_amount ?? null,
    p_rent_period: input.rent_period ?? null,
    p_rent_due_day: input.rent_due_day ?? null,
    p_contract_start: input.contract_start ?? null,
    p_contract_end: input.contract_end ?? null,
  });
  const res = fromSeam<{ asset_no: string }>(SERVICE, data, error);
  if (res.error) return res;
  return getAsset(res.data.asset_no);
}

/** Leave a field out to keep it; `""` clears a text field, `null` a date or
 *  number — sent to the seam as `p_clear`, so leaving a field out can never
 *  wipe it. */
export async function updateAsset(assetNo: string, input: AssetInput): Promise<Result<AssetView>> {
  const clear = ([
    "acquired_on", "purchase_cost", "warranty_until",
    "rent_amount", "rent_period", "rent_due_day", "contract_start", "contract_end",
  ] as const)
    .filter((k) => k in input && input[k] === null);
  const { data, error } = await db().rpc("update_asset", {
    p_asset_no: assetNo,
    p_name: input.name ?? null,
    p_category_code: input.category_code ?? null,
    p_brand: input.brand ?? null,
    p_model: input.model ?? null,
    p_identifier: input.identifier ?? null,
    p_location: input.location ?? null,
    p_holder: input.holder ?? null,
    p_acquired_on: input.acquired_on ?? null,
    p_purchase_cost: input.purchase_cost ?? null,
    p_vendor_code: input.vendor_code ?? null,
    p_trx_no: input.trx_no ?? null,
    p_warranty_until: input.warranty_until ?? null,
    p_notes: input.notes ?? null,
    p_clear: clear,
    p_ownership: input.ownership ?? null,
    p_rent_amount: input.rent_amount ?? null,
    p_rent_period: input.rent_period ?? null,
    p_rent_due_day: input.rent_due_day ?? null,
    p_contract_start: input.contract_start ?? null,
    p_contract_end: input.contract_end ?? null,
  });
  const res = fromSeam(SERVICE, data, error);
  if (res.error) return res;
  return getAsset(assetNo);
}

export async function setAssetStatus(
  assetNo: string, status: AssetStatus, note?: string,
): Promise<Result<AssetView>> {
  const { data, error } = await db().rpc("set_asset_status", {
    p_asset_no: assetNo, p_status: status, p_note: note ?? null,
  });
  const res = fromSeam(SERVICE, data, error);
  if (res.error) return res;
  return getAsset(assetNo);
}

export async function deleteAsset(assetNo: string): Promise<Result<{ asset_no: string; deleted: true }>> {
  const { data, error } = await db().rpc("delete_asset", { p_asset_no: assetNo });
  const res = fromSeam(SERVICE, data, error);
  if (res.error) return res;
  return ok(SERVICE, { asset_no: assetNo, deleted: true as const });
}

/** One asset's service log, newest first (`0121`). */
export async function listAssetServices(assetNo: string): Promise<Result<AssetService[]>> {
  const { data, error } = await db().from("v_asset_service").select("*")
    .eq("asset_no", assetNo).order("service_date", { ascending: false }).order("recorded_at", { ascending: false });
  if (error) return fail(SERVICE, error);
  return ok(SERVICE, ((data ?? []) as AssetService[]).map((s) => ({ ...s, cost: s.cost == null ? null : Number(s.cost) })));
}

export async function addAssetService(assetNo: string, input: AssetServiceInput): Promise<Result<AssetService>> {
  const { data, error } = await db().rpc("add_asset_service", {
    p_asset_no: assetNo,
    p_service_date: input.service_date || null,
    p_description: input.description,
    p_kind: input.kind ?? "service",
    p_vendor_code: input.vendor_code?.trim() || null,
    p_cost: input.cost ?? null,
    p_trx_no: input.trx_no?.trim() || null,
    p_next_due: input.next_due ?? null,
  });
  const res = fromSeam<{ id: string }>(SERVICE, data, error);
  if (res.error) return res;
  const { data: row, error: e2 } = await db().from("v_asset_service").select("*").eq("id", res.data.id).maybeSingle();
  if (e2) return fail(SERVICE, e2);
  if (!row) return notFound(SERVICE, "service_not_found", "No such service entry.");
  const s = row as AssetService;
  return ok(SERVICE, { ...s, cost: s.cost == null ? null : Number(s.cost) });
}

export async function deleteAssetService(id: string, reason?: string): Promise<Result<{ id: string; deleted: true }>> {
  const { data, error } = await db().rpc("delete_asset_service", { p_id: id, p_reason: reason ?? null });
  const res = fromSeam(SERVICE, data, error);
  if (res.error) return res;
  return ok(SERVICE, { id, deleted: true as const });
}

/** The asset's own edits and status changes, and documents put on or taken
 *  off it (`0101` files those as `attachment` under the asset's tag). */
export async function assetHistory(assetNo: string): Promise<Result<AuditRow[]>> {
  const { data, error } = await core().from("v_audit").select("*")
    .in("entity", ["asset", "attachment"]).eq("entity_no", assetNo)
    .order("at", { ascending: false });
  return fromRows<AuditRow[]>(SERVICE, data as AuditRow[], error);
}

export async function listAssetCategories(): Promise<Result<AssetCategory[]>> {
  const { data, error } = await db().from("asset_categories").select("*").order("name");
  return fromRows<AssetCategory[]>(SERVICE, data as AssetCategory[], error);
}

export async function saveAssetCategory(
  input: { code: string; name: string; description?: string; is_active?: boolean },
): Promise<Result<AssetCategory>> {
  const { data, error } = await db().rpc("save_asset_category", {
    p_code: input.code, p_name: input.name,
    p_description: input.description ?? null, p_is_active: input.is_active ?? null,
  });
  const res = fromSeam<{ code: string }>(SERVICE, data, error);
  if (res.error) return res;
  const { data: row, error: e2 } = await db().from("asset_categories").select("*").eq("code", res.data.code).maybeSingle();
  if (e2) return fail(SERVICE, e2);
  if (!row) return notFound(SERVICE, "category_not_found", "No such category.");
  return ok(SERVICE, row as AssetCategory);
}

export async function deleteAssetCategory(code: string): Promise<Result<{ code: string; deleted: true }>> {
  const { data, error } = await db().rpc("delete_asset_category", { p_code: code });
  const res = fromSeam(SERVICE, data, error);
  if (res.error) return res;
  return ok(SERVICE, { code, deleted: true as const });
}

/* ── material against a Job Order (0130) ─────────────────────────────── */

/** Material out to a Job Order, every line or none (`issue_for_work_order`,
 *  which runs each line through `issue_stock`). */
export async function issueForWorkOrder(
  input: {
    wo_no: string; location: string; lines: { item_code: string; qty: number }[];
    note?: string | null; idempotency_key?: string;
  },
): Promise<Result<{
  wo_no: string; move_nos: string[]; issued: number;
  negative: { item_code: string; item_name: string; on_hand_after: number }[];
}>> {
  const { data, error } = await db().rpc("issue_for_work_order", {
    p_wo_no: input.wo_no, p_location: input.location, p_lines: input.lines,
    p_note: input.note ?? null, p_key: input.idempotency_key ?? null,
  });
  return fromSeam(SERVICE, data, error);
}

/** The list beside the record: what the run should take, from the Job
 *  Order's **own** pinned BOM revision (D256), what has gone out against it,
 *  and what is on the rack now. The same shape the demo's `materialPlan`
 *  builds, from `explode_bom` and `stock_moves`. */
export async function materialForWorkOrder(woNo: string): Promise<Result<MaterialPlan>> {
  const wo = await prod().from("v_work_order").select("wo_no, product_code, qty, bom_rev, status, completed")
    .eq("wo_no", woNo).maybeSingle();
  if (wo.error) return fail(SERVICE, wo.error);
  if (!wo.data) return notFound(SERVICE, "wo_not_found", `Tidak ada Job Order ${woNo}.`);
  const w = wo.data as { wo_no: string; product_code: string | null; qty: number | string; bom_rev: number | null; status: string; completed: number | string | null };
  const qty = Number(w.qty);

  let rev: number | null = w.bom_rev;
  let no_plan_reason: string | null = null;
  const expected = new Map<string, { qty: number; uom: string }>();
  if (!w.product_code) {
    no_plan_reason = "Produk Job Order ini tidak ada di katalog.";
  } else {
    const p = await prod().from("v_product_summary").select("current_rev").eq("product_code", w.product_code).maybeSingle();
    if (p.error) return fail(SERVICE, p.error);
    if (!p.data) no_plan_reason = "Produk Job Order ini tidak ada di katalog.";
    rev = rev ?? (p.data?.current_rev as number | null) ?? null;
    if (!no_plan_reason && rev === null) {
      no_plan_reason = "Produk ini belum punya BOM yang dirilis, jadi tidak ada daftar bahan yang bisa dibandingkan.";
    }
    if (!no_plan_reason) {
      const ex = await prod().rpc("explode_bom", { p_product_code: w.product_code, p_qty: qty, p_rev: rev });
      if (ex.error) return fail(SERVICE, ex.error);
      const rows = (ex.data ?? []) as { ref_code: string; kind: string; qty: number | string; uom: string; cycle: boolean }[];
      const cyc = rows.find((r) => r.cycle);
      const items = rows.filter((r) => r.kind === "item");
      if (cyc) no_plan_reason = `BOM produk ini berputar di ${cyc.ref_code}, jadi kebutuhannya belum bisa dihitung.`;
      else if (items.length === 0) no_plan_reason = "Produk ini belum punya bill of material, jadi tidak ada daftar bahan yang bisa dibandingkan.";
      else for (const r of items) expected.set(r.ref_code, { qty: Number(r.qty), uom: r.uom });
    }
  }

  /* Issues minus returns against this Job Order. */
  const mv = await db().from("stock_moves").select("item_code, qty, kind").eq("ref_no", woNo).in("kind", ["issue", "return"]);
  if (mv.error) return fail(SERVICE, mv.error);
  const moved = new Map<string, number>();
  for (const m of mv.data ?? []) moved.set(m.item_code as string, (moved.get(m.item_code as string) ?? 0) - Number(m.qty));

  const codes = [...new Set([...expected.keys(), ...moved.keys()])];
  const stock = codes.length
    ? await db().from("v_stock_item").select("item_code, item_name, uom, on_hand").in("item_code", codes)
    : { data: [], error: null };
  if (stock.error) return fail(SERVICE, stock.error);
  const names = codes.length
    ? await procure().from("items").select("code, name, base_uom").in("code", codes)
    : { data: [], error: null };
  if (names.error) return fail(SERVICE, names.error);
  const onHand = new Map((stock.data ?? []).map((s) => [s.item_code as string, Number(s.on_hand)]));
  const item = new Map((names.data ?? []).map((i) => [i.code as string, i as { code: string; name: string; base_uom: string }]));
  const r3 = (n: number) => Math.round(n * 1000) / 1000;

  const lines = codes.map((code) => {
    const exp = expected.get(code);
    const issued = r3(moved.get(code) ?? 0);
    return {
      item_code: code,
      item_name: item.get(code)?.name ?? code,
      uom: exp?.uom ?? item.get(code)?.base_uom ?? "",
      expected: exp ? r3(exp.qty) : null,
      issued,
      remaining: exp ? r3(exp.qty - issued) : null,
      on_hand: onHand.get(code) ?? 0,
      off_bom: !exp,
    };
  }).sort((a, b) =>
    Number(a.off_bom) - Number(b.off_bom)
    || (b.remaining ?? -Infinity) - (a.remaining ?? -Infinity)
    || a.item_name.localeCompare(b.item_name));

  const completed = Number(w.completed ?? 0);
  return ok(SERVICE, {
    wo_no: w.wo_no,
    rev: no_plan_reason ? null : rev,
    no_plan_reason,
    lines,
    variance_readable: completed >= qty || w.status === "DONE",
    completed,
    ordered: qty,
  });
}
