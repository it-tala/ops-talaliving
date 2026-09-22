/** Implements `/api/v1/inventory` against the database — the material-stock
 *  half first (`0071`). Timber (`0070`) and the board rack (no migration yet)
 *  follow separately; until they land, `swap()` answers those names the same
 *  way it answers a function that was never written at all (this file's
 *  sibling modules' own header comments explain why that is safe to ship
 *  incrementally, not a half-measure).
 *
 *  Same rules as `accounting.ts`/`procurement.ts`: nothing derived is computed
 *  here that the database already decided, no permission is checked here
 *  (RLS on `ops_inv.stock_moves` already gates every insert by kind — `moves_new`
 *  in `0071`), and no refusal is reworded.
 *
 *  **No write seam.** Unlike accounting/procurement, `0071` never wrapped
 *  `stock_moves` in a `security definer` function — the table's own RLS policy
 *  is the whole of its access control, and "on_hand" is `sum(qty)` computed on
 *  read (A3, D170), so there is no server-side function to ask for `before`/
 *  `after` either. Those figures are read here (a `select` before the
 *  `insert`), the same arithmetic `writeMove()`'s callers do in the demo —
 *  this is not a second implementation of a business rule, it is the one
 *  place that rule can run at all.
 */
import type {
  StockLocation, StockMove, StockMoveView, StockItemView, StockItemDetail,
} from "@/services/inventory/contracts";
import { supabaseBrowser } from "@/lib/supabase/client";
import { fail, fromRows, invalid, noop, notFound, ok, type Result } from "./_kit";

const SERVICE = "inventory" as const;

const db = () => supabaseBrowser().schema("ops_inv");
const procure = () => supabaseBrowser().schema("ops_procure");

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
      why: `${item.name} sits in ${item.category_code}, which is not counted — it is bought and used, not stocked (D169).`,
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
    filtered = filtered.filter((r) => `${r.item_code} ${r.item_name} ${r.category_name}`.toLowerCase().includes(q));
  }
  return ok(SERVICE, filtered);
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
  const { data: row, error } = await db().from("v_stock_item").select("*").eq("item_code", itemCode).maybeSingle();
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

  const [movesRes, onOrderRes] = await Promise.all([
    listStockMoves({ item_code: itemCode }),
    onOrderFor(itemCode),
  ]);
  if (movesRes.error) return movesRes;

  return ok(SERVICE, {
    ...view,
    moves: movesRes.data,
    /* `used_in` (which products' BOMs call for this item) reads `ops_prod`,
       which has no tables in this project yet (production's own migrations,
       0060–0066, have never been applied) — empty rather than a 500 until
       that module exists to ask. */
    used_in: [],
    on_order: onOrderRes,
  });
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

export async function listStockLocations(): Promise<Result<StockLocation[]>> {
  const { data, error } = await db().from("stock_locations").select("*").eq("is_active", true).order("name");
  return fromRows<StockLocation[]>(SERVICE, data as StockLocation[], error);
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
 *  answer rather than the write being blocked. */
export async function issueStock(
  input: { item_code: string; location: string; qty: number; wo_no?: string | null; reason?: string | null },
): Promise<Result<{ move_no: string; on_hand_after: number; went_negative: boolean }>> {
  if (input.qty <= 0) return invalid(SERVICE, "qty_invalid", "Jumlah keluar harus lebih dari nol.", { field: "qty" });
  const check = await stockable(input.item_code);
  if (!check.ok) return invalid(SERVICE, "not_stocked", check.why, { field: "item_code" });
  const uid = await currentUserId();
  if (uid.error) return uid;

  const before = await onHandFor(input.item_code);
  const after = Math.round((before - input.qty) * 1000) / 1000;

  const { data, error } = await db().from("stock_moves").insert({
    item_code: input.item_code, location: input.location, kind: "issue",
    qty: -Math.abs(input.qty), uom: check.base_uom,
    ref_no: input.wo_no ?? null, reason: input.reason ?? null, moved_by: uid.data,
  }).select("move_no").single();
  if (error) return fail(SERVICE, error);

  return ok(SERVICE, { move_no: data.move_no as string, on_hand_after: after, went_negative: after < 0 });
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

/** Stock from a confirmed receipt — the one move the system makes by itself.
 *  Called by `procurement.confirmReceipt`'s caller, not a screen — same three
 *  arguments as the demo's `stockFromReceipt(draft, receiptNo, userId,
 *  userEmail)`, minus `draft`: there is no in-memory state to pass, so the
 *  receipt → po_line/pr_line → item chain the demo walks over `draft` is
 *  walked here over the database instead (D172's resolution belongs to this
 *  module, not to whoever calls it — the demo puts it here for the same
 *  reason).
 *
 *  `userEmail` is accepted and unused: the demo's `writeMove` puts it in an
 *  audit-row detail column, and `ops_inv` (`0071`) has no audit trail at all
 *  to put it in — every other write-seam in this codebase is `security
 *  definer` specifically to write one, and `stock_moves` was never given
 *  that seam. Not this pass's call to add one.
 *
 *  Necessarily `Promise`-wrapped where the demo is not: resolving the chain
 *  is a database read here, which the demo already has in `draft`. Listed on
 *  `PENDING_PARITY` for that reason — `check-api-parity.mjs` cannot see past
 *  a return type this different, and it should not: a screen awaiting this
 *  needs to know it can. */
export async function stockFromReceipt(
  receiptNo: string, userId: string, _userEmail: string,
): Promise<{ stocked: boolean; why?: string }> {
  const { data: receipt } = await procure().from("receipts")
    .select("receipt_no, po_line_id, line_id, qty_received").eq("receipt_no", receiptNo).maybeSingle();
  if (!receipt) return { stocked: false, why: "receipt not found" };

  const { data: existing } = await db().from("stock_moves").select("id")
    .eq("ref_no", receiptNo).eq("kind", "receipt").maybeSingle();
  if (existing) return { stocked: false, why: "already stocked" };

  const [poLine, prLine] = await Promise.all([
    receipt.po_line_id
      ? procure().from("po_lines").select("item_id, uom, unit_price").eq("id", receipt.po_line_id).maybeSingle()
      : Promise.resolve({ data: null }),
    receipt.line_id
      ? procure().from("pr_lines").select("item_id, uom, unit_price").eq("id", receipt.line_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const line = poLine.data ?? prLine.data;
  const itemId = line?.item_id;
  if (!itemId) return { stocked: false, why: "the line names no catalogue item" };

  const { data: item } = await procure().from("items").select("code, base_uom, category_code").eq("id", itemId).maybeSingle();
  if (!item) return { stocked: false, why: "catalogue item missing" };
  const { data: cat } = await db().from("stocked_categories").select("category_code")
    .eq("category_code", item.category_code).maybeSingle();
  if (!cat) return { stocked: false, why: `${item.category_code} is not a counted category` };

  const { data: setting } = await db().from("stock_settings").select("home_location").eq("item_code", item.code).maybeSingle();

  const { error } = await db().from("stock_moves").insert({
    item_code: item.code,
    location: setting?.home_location ?? "GUDANG",
    kind: "receipt",
    qty: Math.abs(receipt.qty_received),
    uom: line?.uom ?? item.base_uom,
    unit_cost: line?.unit_price ?? null,
    ref_no: receiptNo,
    moved_by: userId,
  });
  if (error) {
    if (error.code === "23505") return { stocked: false, why: "already stocked" };
    return { stocked: false, why: error.message };
  }
  return { stocked: true };
}
