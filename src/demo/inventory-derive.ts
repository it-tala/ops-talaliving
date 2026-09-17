/** Inventory views — computed on read (A3).
 *
 *  All of it is arithmetic over measurements: cubic metres from dimensions,
 *  yield from the two volumes, rupiah per cubic metre from the invoice. None
 *  of it is stored, because every one of those figures changes the moment
 *  another board is reported off the same logs — and a stored yield that
 *  stopped matching its boards is exactly the number somebody would quote from
 *  (D153).
 */
import type { DemoState } from "./state";
import type {
  LogPurchase, LogPurchaseView, LogPieceView, SawnBoardView, LogMeasure,
  TimberVendorSummary, BoardStockView, BoardMoveView,
} from "@/services/inventory/contracts";

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

/** A log's volume in cubic metres.
 *
 *  `round` is the cylinder: π/4 × d² × L. `square` is the *kubikasi persegi*
 *  the trade quotes in — the biggest square beam the log could give, d² × L —
 *  which is about 78% of the cylinder and is what many sellers price against.
 *  Which one was used is recorded on the purchase, never assumed (Q39).
 */
export function logVolumeM3(diameterCm: number, lengthCm: number, measure: LogMeasure): number {
  const d = diameterCm / 100;
  const l = lengthCm / 100;
  const v = measure === "round" ? (Math.PI / 4) * d * d * l : d * d * l;
  return round4(v);
}

/** A sawn board, in cubic metres. Millimetres in, m³ out. */
export function boardVolumeM3(thicknessMm: number, widthMm: number, lengthMm: number): number {
  return round4((thicknessMm / 1000) * (widthMm / 1000) * (lengthMm / 1000));
}

export function logPurchaseView(state: DemoState, p: LogPurchase): LogPurchaseView {
  const vendor = state.vendors.find((v) => v.id === p.vendor_id);

  const logs: LogPieceView[] = state.log_pieces
    .filter((l) => l.purchase_id === p.id)
    .map((l) => ({ ...l, m3: logVolumeM3(l.diameter_cm, l.length_cm, p.measure) }))
    .sort((a, b) => a.tag.localeCompare(b.tag));

  const boards: SawnBoardView[] = state.sawn_boards
    .filter((b) => b.purchase_id === p.id)
    .map((b) => {
      const each = boardVolumeM3(b.thickness_mm, b.width_mm, b.length_mm);
      return {
        ...b,
        m3_each: each,
        m3: round4(each * b.qty),
        size: `${b.thickness_mm / 10} × ${b.width_mm / 10} × ${b.length_mm / 10} cm`,
      };
    })
    .sort((a, b) => a.sawn_on.localeCompare(b.sawn_on) || a.size.localeCompare(b.size));

  const log_m3 = round4(logs.reduce((a, l) => a + l.m3, 0));
  const sawn_m3 = round4(boards.reduce((a, b) => a + b.m3, 0));

  /* Yield and price per board metre must be measured against the logs that
     have actually been through the saw — not the whole load.
     `kyu-26-08-26_01` has three of five logs done; dividing its boards by all
     five would read as 39% when the sawyer is getting 61%, and dividing the
     whole invoice by those boards would say the wood costs half again what it
     does. Both errors flatter or damn a vendor for wood still lying in the
     yard (D153). */
  const sawnLogM3 = round4(logs.filter((l) => l.sawn_on).reduce((a, l) => a + l.m3, 0));
  /* A pile reported without anybody marking the logs is the common case, and
     is taken to mean the load was sawn. */
  const basis = sawnLogM3 > 0 ? sawnLogM3 : (sawn_m3 > 0 ? log_m3 : 0);
  const unsawn_m3 = round4(Math.max(log_m3 - basis, 0));

  const yield_percent = sawn_m3 > 0 && basis > 0
    ? Math.round((sawn_m3 / basis) * 1000) / 10
    : null;

  /* The invoice covers every log. Only the share belonging to the logs that
     were sawn may be divided by the boards that came out of them. */
  const sawnCost = basis > 0 && log_m3 > 0 ? p.total_cost * (basis / log_m3) : 0;

  const warnings: string[] = [];
  if (logs.length === 0) {
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
  } else if (yield_percent != null && yield_percent < settingNumber(state, "ops.low_yield_percent", 45)) {
    warnings.push(`Rendemen ${yield_percent}% — di bawah yang biasa. Layak ditanyakan ke pemilik sawmill.`);
  }

  /* Ours against the seller's. Kept as a fact, not a correction: the number to
     argue with is the difference, and overwriting one with the other loses
     it. */
  const measure_gap_m3 = p.claimed_m3 != null && log_m3 > 0
    ? round4(log_m3 - p.claimed_m3)
    : null;
  if (measure_gap_m3 != null && Math.abs(measure_gap_m3) >= 0.05) {
    warnings.push(
      measure_gap_m3 < 0
        ? `Ukuran kita ${Math.abs(measure_gap_m3)} m³ LEBIH KECIL dari yang ditagih (${p.claimed_m3} m³).`
        : `Ukuran kita ${measure_gap_m3} m³ lebih besar dari yang ditagih (${p.claimed_m3} m³).`,
    );
  }

  return {
    ...p,
    vendor_name: vendor?.name ?? "—",
    logs,
    boards,
    log_m3,
    sawn_m3,
    yield_percent,
    cost_per_log_m3: log_m3 > 0 ? Math.round(p.total_cost / log_m3) : null,
    cost_per_sawn_m3: sawn_m3 > 0 ? Math.round(sawnCost / sawn_m3) : null,
    unsawn_m3,
    measure_gap_m3,
    warnings,
  };
}

export function logPurchaseViews(state: DemoState): LogPurchaseView[] {
  return state.log_purchases
    .map((p) => logPurchaseView(state, p))
    .sort((a, b) => b.received_on.localeCompare(a.received_on));
}

/** Every vendor's timber, summed.
 *
 *  The figure that matters is `cost_per_sawn_m3`: two vendors quoting the same
 *  rupiah per log cubic metre are not the same price if one of them sells logs
 *  that saw out at 62% and the other at 48%. That difference is invisible on
 *  an invoice and is the whole reason this module exists (D153).
 */
export function timberVendorSummaries(state: DemoState): TimberVendorSummary[] {
  const views = logPurchaseViews(state);
  /* Keyed by vendor AND species: comparing one vendor's mahoni with another's
     jati is two different woods, and a single average per vendor hides which
     is which (D153). */
  const byVendor = new Map<string, LogPurchaseView[]>();
  for (const v of views) {
    const key = `${v.vendor_id}|${v.species}`;
    byVendor.set(key, [...(byVendor.get(key) ?? []), v]);
  }

  return [...byVendor.entries()]
    .map(([key, rows]) => {
      const vendor_id = key.split("|")[0];
      const log_m3 = round4(rows.reduce((a, r) => a + r.log_m3, 0));
      const sawn_m3 = round4(rows.reduce((a, r) => a + r.sawn_m3, 0));
      const total_cost = rows.reduce((a, r) => a + r.total_cost, 0);
      /* Built from what each purchase already worked out, so a partly-sawn
         load contributes only the share of its invoice that belongs to the
         logs actually cut (D153). Summing raw invoices here would undo that
         care one level up. */
      const sawnBasis = round4(rows.reduce((a, r) => a + (r.log_m3 - r.unsawn_m3), 0));
      const allocatedCost = rows.reduce(
        (a, r) => a + (r.cost_per_sawn_m3 != null ? r.cost_per_sawn_m3 * r.sawn_m3 : 0), 0,
      );

      return {
        vendor_id,
        vendor_name: rows[0].vendor_name,
        species: rows[0].species,
        purchases: rows.length,
        log_m3,
        sawn_m3,
        total_cost,
        yield_percent: sawnBasis > 0 && sawn_m3 > 0
          ? Math.round((sawn_m3 / sawnBasis) * 1000) / 10
          : null,
        cost_per_log_m3: log_m3 > 0 ? Math.round(total_cost / log_m3) : null,
        cost_per_sawn_m3: sawn_m3 > 0 ? Math.round(allocatedCost / sawn_m3) : null,
        unsawn_m3: round4(rows.reduce((a, r) => a + r.unsawn_m3, 0)),
      };
    })
    /* Grouped by species, dearest usable wood first inside each — the row a
       buyer should look at before ringing anybody. */
    .sort((a, b) => a.species.localeCompare(b.species)
      || (b.cost_per_sawn_m3 ?? 0) - (a.cost_per_sawn_m3 ?? 0));
}

/* ── Stock ──────────────────────────────────────────────────────────────── */

import type {
  StockItemView, StockItemDetail, StockMoveView, StockMove,
} from "@/services/inventory/contracts";
import { STOCKED_CATEGORIES } from "./fixtures/reference";
import { settingNumber } from "./settings";

/** What one item's stock is worth, and how sure we are of it.
 *
 *  Weighted average over the **priced** receipts, applied to what is on hand.
 *  Two decisions in that sentence, both deliberate (D172):
 *
 *  - A receipt with no unit price does not value the rack at zero. It is
 *    counted in `unpriced_qty` and left out of the average, so the value that
 *    comes back is a value of *part* of the stock and the screen says which
 *    part. A rack valued at zero because nobody typed a price looks like a
 *    rack that cost nothing.
 *  - Issues are not valued here at all. Costing what left the rack is a
 *    different question with a different answer (FIFO, average, standard), and
 *    nobody has said which this business uses. What is asked today is *what is
 *    on the rack and what did it cost*, and that is what this returns.
 */
function valueOf(moves: StockMove[]): { avg: number | null; unpriced: number } {
  const priced = moves.filter((m) => m.qty > 0 && m.unit_cost != null);
  const unpricedIn = moves
    .filter((m) => m.qty > 0 && m.unit_cost == null && m.kind === "receipt")
    .reduce((s, m) => s + m.qty, 0);
  if (priced.length === 0) return { avg: null, unpriced: unpricedIn };
  const qty = priced.reduce((s, m) => s + m.qty, 0);
  const cost = priced.reduce((s, m) => s + m.qty * (m.unit_cost ?? 0), 0);
  return { avg: qty > 0 ? Math.round(cost / qty) : null, unpriced: unpricedIn };
}

function moveView(state: DemoState, m: StockMove): StockMoveView {
  return {
    ...m,
    item_name: state.items.find((i) => i.code === m.item_code)?.name ?? m.item_code,
    location_name: state.stock_locations.find((l) => l.code === m.location)?.name ?? m.location,
    by_name: state.users.find((u) => u.id === m.moved_by)?.full_name ?? "—",
    /* Only SPK references are checked, because they are the only ones this
       state can resolve: `rcv-…` and an opname reference live elsewhere. */
    ref_missing: m.ref_no != null
      && m.ref_no.startsWith("spk-")
      && !state.work_orders.some((w) => w.wo_no === m.ref_no),
  };
}

/** Every catalogue item that is **meant** to be counted, whether or not it has
 *  ever moved.
 *
 *  Items in an unstocked category — a service, the electricity bill — are not
 *  here at all (D169). An item that is stocked and has never moved **is** here,
 *  showing nought: *we have none* and *nobody has ever bought this* look
 *  identical on a screen that hides the second one, and they lead to opposite
 *  actions.
 */
export function stockItems(state: DemoState): StockItemView[] {
  const byItem = new Map<string, StockMove[]>();
  for (const m of state.stock_moves) {
    const list = byItem.get(m.item_code) ?? [];
    list.push(m);
    byItem.set(m.item_code, list);
  }

  const rows: StockItemView[] = [];
  for (const item of state.items) {
    if (item.merged_into) continue;
    if (!STOCKED_CATEGORIES.has(item.category_code)) continue;

    const moves = (byItem.get(item.code) ?? []).sort((a, b) => a.moved_at.localeCompare(b.moved_at));
    const on_hand = Math.round(moves.reduce((s, m) => s + m.qty, 0) * 1000) / 1000;

    const perLocation = new Map<string, number>();
    for (const m of moves) perLocation.set(m.location, (perLocation.get(m.location) ?? 0) + m.qty);

    const { avg, unpriced } = valueOf(moves);
    const cat = state.item_categories.find((c) => c.code === item.category_code);
    const parent = cat?.parent_code
      ? state.item_categories.find((c) => c.code === cat.parent_code)
      : cat;
    const setting = state.stock_settings.find((s) => s.item_code === item.code);
    /* Value only the part we can price. `unpriced_qty` is capped at what is
       actually still on the rack — eight unpriced sheets that have since been
       used are not eight unknowns today. */
    const unpricedHere = Math.min(unpriced, Math.max(on_hand, 0));
    const pricedQty = Math.max(on_hand - unpricedHere, 0);

    rows.push({
      item_code: item.code,
      item_name: item.name,
      category_code: item.category_code,
      category_name: cat?.name ?? item.category_code,
      group_code: parent?.code ?? item.category_code,
      group_name: parent?.name ?? item.category_code,
      uom: item.base_uom,
      on_hand,
      by_location: [...perLocation.entries()]
        .filter(([, q]) => Math.abs(q) > 0.0001)
        .map(([location, qty]) => ({
          location,
          location_name: state.stock_locations.find((l) => l.code === location)?.name ?? location,
          qty: Math.round(qty * 1000) / 1000,
        }))
        .sort((a, b) => b.qty - a.qty),
      avg_cost: avg,
      value: avg == null ? null : Math.round(avg * pricedQty),
      unpriced_qty: Math.round(unpricedHere * 1000) / 1000,
      min_qty: setting?.min_qty ?? null,
      below_min: setting?.min_qty != null && on_hand < setting.min_qty,
      last_move_at: moves.length > 0 ? moves[moves.length - 1].moved_at : null,
      moves_count: moves.length,
    });
  }

  /* Trouble first: below the minimum, then never counted, then the rest by
     name. A stock list read top to bottom should start with the thing that
     stops the workshop on Saturday. */
  return rows.sort((a, b) => {
    if (a.below_min !== b.below_min) return a.below_min ? -1 : 1;
    if ((a.moves_count === 0) !== (b.moves_count === 0)) return a.moves_count === 0 ? 1 : -1;
    return a.item_name.localeCompare(b.item_name);
  });
}

export function stockItemDetail(state: DemoState, itemCode: string): StockItemDetail | null {
  const row = stockItems(state).find((r) => r.item_code === itemCode);
  if (!row) return null;

  const moves = state.stock_moves
    .filter((m) => m.item_code === itemCode)
    .sort((a, b) => b.moved_at.localeCompare(a.moved_at))
    .map((m) => moveView(state, m));

  /* What calls for it. The question behind this column is "can this go" — an
     item nothing is made from is a candidate for the skip, and one that four
     products need is not (D170). */
  const item = state.items.find((i) => i.code === itemCode);
  const used_in = item
    /* A BOM line names the catalogue item by **code**, across the seam
       (ADR-004) — so this matches on the code, not on an id. */
    ? state.bom_components
      .filter((c) => c.kind === "material" && c.ref_code === itemCode)
      .map((c) => {
        const product = state.products.find((p) => p.id === c.product_id);
        return {
          product_code: product?.product_code ?? "—",
          product_name: product?.name ?? "—",
          qty_per_unit: c.qty,
        };
      })
    : [];

  /* Asked for and not yet on the rack. Approved lines only: a request nobody
     has said yes to is not stock arriving. */
  const on_order = item
    ? state.pr_lines
      .filter((l) => l.item_id === item.id && !l.removed_at)
      .filter((l) => state.pr_approvals.some((a) => a.line_id === l.id && a.approved))
      .filter((l) => !state.receipts.some((r) => r.line_id === l.id && r.status === "CONFIRMED"))
      .map((l) => ({ pr_line_no: l.line_no_full, qty: l.qty ?? 0, need_by: l.need_by }))
    : [];

  return { ...row, moves, used_in, on_order };
}

export function stockMoveViews(state: DemoState, filter: { item_code?: string; ref_no?: string } = {}): StockMoveView[] {
  return state.stock_moves
    .filter((m) => (!filter.item_code || m.item_code === filter.item_code)
      && (!filter.ref_no || m.ref_no === filter.ref_no))
    .sort((a, b) => b.moved_at.localeCompare(a.moved_at))
    .map((m) => moveView(state, m));
}

/* ── Boards on the rack ───────────────────────────────────────────────────
 *
 *  The count is the sum of two things and neither of them stores it: what came
 *  off the saw (`sawn_boards`, which is also what the yield figures divide),
 *  and everything that happened to it afterwards (`board_moves`). Keeping the
 *  sawn side where it already lived means no fact is written twice, and the
 *  rack cannot disagree with the rendemen (D203).
 */

/** Species and size in millimetres. The one place this string is built — a key
 *  rebuilt from the words that render it is F53 all over again. */
export function boardKey(species: string, t: number, w: number, l: number): string {
  return `${species}|${t}x${w}x${l}`;
}

export function boardSize(t: number, w: number, l: number): string {
  return `${t / 10} × ${w / 10} × ${l / 10} cm`;
}

interface BoardBucket {
  species: string; t: number; w: number; l: number;
  sawn: number; issued: number; returned: number; scrapped: number; adjusted: number;
  /** qty by purchase, for the weighted average. */
  byPurchase: Map<string | null, number>;
  last: string | null;
}

function buckets(state: DemoState): Map<string, BoardBucket> {
  const out = new Map<string, BoardBucket>();
  const bucket = (species: string, t: number, w: number, l: number) => {
    const key = boardKey(species, t, w, l);
    let b = out.get(key);
    if (!b) {
      b = { species, t, w, l, sawn: 0, issued: 0, returned: 0, scrapped: 0, adjusted: 0, byPurchase: new Map(), last: null };
      out.set(key, b);
    }
    return b;
  };

  for (const sb of state.sawn_boards) {
    const purchase = state.log_purchases.find((p) => p.id === sb.purchase_id);
    const species = purchase?.species ?? "—";
    const b = bucket(species, sb.thickness_mm, sb.width_mm, sb.length_mm);
    b.sawn += sb.qty;
    b.byPurchase.set(sb.purchase_id, (b.byPurchase.get(sb.purchase_id) ?? 0) + sb.qty);
    if (!b.last || sb.sawn_on > b.last) b.last = sb.sawn_on;
  }

  for (const m of state.board_moves) {
    const b = bucket(m.species, m.thickness_mm, m.width_mm, m.length_mm);
    if (m.kind === "issue") b.issued += -m.qty;
    else if (m.kind === "scrap") b.scrapped += -m.qty;
    else if (m.kind === "return") b.returned += m.qty;
    else if (m.kind === "adjust") b.adjusted += m.qty;
    b.byPurchase.set(m.purchase_id, (b.byPurchase.get(m.purchase_id) ?? 0) + m.qty);
    if (!b.last || m.at > b.last) b.last = m.at;
  }
  return out;
}

/** Cost per m³ of board, per load. Null where the load has not been costed —
 *  nothing is bought at an average that was invented here (D172, D204). */
function boardCostIndex(state: DemoState): {
  costOf: Map<string, number | null>;
  dearestOf: Map<string, number>;
} {
  const costOf = new Map<string, number | null>();
  /* The dearest costed load **per species** is the fallback the owner chose for
     boards whose own load is unknown or uncosted (D232, Q43): timber only gets
     more expensive, so the dearest rate we have seen is close to today's and
     errs against the job rather than in its favour. Per species, never across
     them — jati at a mahoni rate would be worse than no rate at all. */
  const dearestOf = new Map<string, number>();
  for (const p of state.log_purchases) {
    const c = logPurchaseView(state, p).cost_per_sawn_m3;
    costOf.set(p.id, c);
    if (c != null) dearestOf.set(p.species, Math.max(dearestOf.get(p.species) ?? 0, c));
  }
  return { costOf, dearestOf };
}

export function boardStock(state: DemoState): BoardStockView[] {
  const { costOf, dearestOf } = boardCostIndex(state);

  return [...buckets(state).values()]
    .map((b) => {
      const qty = b.sawn - b.issued - b.scrapped + b.returned + b.adjusted;
      const m3Each = boardVolumeM3(b.t, b.w, b.l);

      /* Weighted average across what is still represented on the rack, and the
         boards whose load has no costed yield are counted but left out of the
         value — the same shape as the material rack (D172). */
      const dearest = dearestOf.get(b.species) ?? null;
      let valued = 0;
      let valuedQty = 0;
      let estimated = 0;
      let unpriced = 0;
      for (const [purchaseId, n] of b.byPurchase) {
        if (n <= 0) continue;
        const c = purchaseId ? costOf.get(purchaseId) ?? null : null;
        if (c == null) {
          /* No rate of its own. Take the species' dearest (D232) — and where
             not even that exists, leave it counted and unvalued. */
          if (dearest == null) { unpriced += n; continue; }
          estimated += n;
          valued += dearest * m3Each * n;
          valuedQty += n;
          continue;
        }
        valued += c * m3Each * n;
        valuedQty += n;
      }
      /* Scale the value of the priced share to what is actually left. */
      const share = valuedQty > 0 ? Math.max(0, Math.min(qty, valuedQty)) / valuedQty : 0;

      return {
        board_key: boardKey(b.species, b.t, b.w, b.l),
        species: b.species,
        thickness_mm: b.t, width_mm: b.w, length_mm: b.l,
        size: boardSize(b.t, b.w, b.l),
        qty,
        sawn_total: b.sawn,
        issued_total: b.issued,
        scrapped_total: b.scrapped,
        m3_each: round4(m3Each),
        m3: round4(m3Each * qty),
        avg_cost_per_m3: valuedQty > 0 ? Math.round(valued / (m3Each * valuedQty)) : null,
        value: valuedQty > 0 ? Math.round(valued * share) : null,
        estimated_qty: Math.round(Math.min(estimated, Math.max(0, qty)) * 1000) / 1000,
        estimate_per_m3: estimated > 0 ? dearest : null,
        unpriced_qty: Math.min(unpriced, Math.max(0, qty)),
        last_move_at: b.last,
      };
    })
    .sort((a, b) => a.species.localeCompare(b.species) || a.thickness_mm - b.thickness_mm || a.width_mm - b.width_mm);
}

/** Every movement, sawing included, newest first. One timeline: *where did the
 *  jati 3 × 20 × 200 go* is not answerable from two lists. */
export function boardMoveViews(
  state: DemoState,
  filter: { board_key?: string; ref_no?: string } = {},
): BoardMoveView[] {
  const { costOf, dearestOf } = boardCostIndex(state);
  /* The load's own rate where there is one, the species' dearest where there
     is not, and null where neither exists (D232). */
  const rateFor = (purchaseId: string | null, species: string): { rate: number | null; basis: "load" | "dearest" | null } => {
    const own = purchaseId ? costOf.get(purchaseId) ?? null : null;
    if (own != null) return { rate: own, basis: "load" };
    const dearest = dearestOf.get(species) ?? null;
    return dearest == null ? { rate: null, basis: null } : { rate: dearest, basis: "dearest" };
  };
  const name = (id: string) => state.users.find((u) => u.id === id)?.full_name ?? id;
  const noOf = (id: string | null) => state.log_purchases.find((p) => p.id === id)?.purchase_no ?? null;

  const fromSawing: BoardMoveView[] = state.sawn_boards.map((sb) => {
    const purchase = state.log_purchases.find((p) => p.id === sb.purchase_id);
    const species = purchase?.species ?? "—";
    const m3Each = boardVolumeM3(sb.thickness_mm, sb.width_mm, sb.length_mm);
    const { rate: c, basis } = rateFor(sb.purchase_id, species);
    return {
      id: sb.id, move_no: sb.id, at: `${sb.sawn_on}T12:00:00+08:00`,
      board_key: boardKey(species, sb.thickness_mm, sb.width_mm, sb.length_mm),
      species, thickness_mm: sb.thickness_mm, width_mm: sb.width_mm, length_mm: sb.length_mm,
      qty: sb.qty, kind: "sawn" as const,
      purchase_id: sb.purchase_id, ref_no: null,
      reason: sb.grade ? `Grade ${sb.grade}` : null,
      by: purchase?.created_by ?? "",
      size: boardSize(sb.thickness_mm, sb.width_mm, sb.length_mm),
      m3: round4(m3Each * sb.qty),
      purchase_no: noOf(sb.purchase_id),
      by_name: name(purchase?.created_by ?? ""),
      value: c == null ? null : Math.round(c * m3Each * sb.qty),
      value_basis: basis,
    };
  });

  const rest: BoardMoveView[] = state.board_moves.map((m) => {
    const m3Each = boardVolumeM3(m.thickness_mm, m.width_mm, m.length_mm);
    const { rate: c, basis } = rateFor(m.purchase_id, m.species);
    return {
      ...m,
      size: boardSize(m.thickness_mm, m.width_mm, m.length_mm),
      m3: round4(m3Each * m.qty),
      purchase_no: noOf(m.purchase_id),
      by_name: name(m.by),
      value: c == null ? null : Math.round(c * m3Each * m.qty),
      value_basis: basis,
    };
  });

  return [...fromSawing, ...rest]
    .filter((m) => (!filter.board_key || m.board_key === filter.board_key)
      && (!filter.ref_no || m.ref_no === filter.ref_no))
    .sort((a, b) => b.at.localeCompare(a.at));
}
