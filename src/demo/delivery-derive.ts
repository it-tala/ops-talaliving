/** Delivery, installation and handover — computed, never stored.
 *
 *  The one figure this file exists for: **how much of what the client ordered
 *  has actually reached them.** Four numbers per line — ordered, made,
 *  delivered, installed — and the gaps between them are what nobody could see.
 */
import type { DemoState } from "./state";
import type {
  Delivery, DeliveryView, Installation, InstallationView,
  Snag, SnagView, FulfilmentView, FulfilmentLine, FulfilmentStage,
  PackingBox, BoxView,
} from "@/services/delivery/contracts";
import { BOX_STATUS_LABEL } from "@/services/delivery/contracts";
import { workOrderView } from "./production-derive";

const DAY = 86_400_000;

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);
}

/** How many of this product this project has actually finished.
 *
 *  Matched on **project code and product code**, which is the only pairing
 *  that exists on both sides. A line with no product code cannot be matched to
 *  a work order without guessing from its wording, and guessing here would put
 *  a number under *sudah dibuat* that nobody can check — so it returns null
 *  and the screen says the line cannot be matched (D210, F53).
 */
function madeFor(state: DemoState, projectCode: string, productCode: string | null): number | null {
  if (!productCode) return null;
  const orders = state.work_orders.filter(
    (w) => w.project_code === projectCode && w.product_code === productCode && w.status !== "CANCELLED",
  );
  /* **No work order at all is not zero.** Zero means the floor has an order
     and has finished none of it; null means nothing in production knows about
     this line — an old job migrated in, or an order somebody shipped without
     ever writing an SPK. The two look identical in a column of numbers and
     they need completely different conversations (F60). */
  if (orders.length === 0) return null;
  return orders.reduce((sum, w) => sum + workOrderView(state, w).completed, 0);
}

/** Left the yard: on a truck, or already signed for. What `ready_to_ship`
 *  subtracts — a table on the road cannot be loaded onto a second truck. */
export function deliveredFor(state: DemoState, projectLineId: string): number {
  const live = new Set(
    state.deliveries.filter((d) => d.status !== "CANCELLED").map((d) => d.id),
  );
  return state.delivery_lines
    .filter((l) => l.project_line_id === projectLineId && live.has(l.delivery_id))
    .reduce((sum, l) => sum + l.qty, 0);
}

/** Signed for at the site. **A different number from `deliveredFor`**, and the
 *  difference is the whole reason both exist: goods on a truck have left the
 *  yard and are not on site, so fitting them is not possible and the record
 *  must not allow it (F62). */
export function arrivedFor(state: DemoState, projectLineId: string): number {
  const here = new Set(
    state.deliveries.filter((d) => d.status === "ARRIVED").map((d) => d.id),
  );
  return state.delivery_lines
    .filter((l) => l.project_line_id === projectLineId && here.has(l.delivery_id))
    .reduce((sum, l) => sum + l.qty, 0);
}

export function installedFor(state: DemoState, projectLineId: string): number {
  const done = new Set(
    state.installations.filter((i) => i.status === "DONE").map((i) => i.id),
  );
  return state.installation_lines
    .filter((l) => l.project_line_id === projectLineId && done.has(l.installation_id))
    .reduce((sum, l) => sum + l.qty, 0);
}

export function fulfilmentView(state: DemoState, projectCode: string, today: string): FulfilmentView | null {
  const project = state.projects.find((p) => p.code === projectCode);
  if (!project) return null;

  const lines: FulfilmentLine[] = state.project_lines
    .filter((l) => l.project_id === project.id)
    .sort((a, b) => a.line_no - b.line_no)
    .map((l) => {
      const made = madeFor(state, projectCode, l.product_code);
      const delivered = deliveredFor(state, l.id);
      const arrived = arrivedFor(state, l.id);
      const installed = installedFor(state, l.id);
      return {
        project_line_id: l.id,
        line_no: l.line_no,
        product_code: l.product_code,
        description: l.description,
        uom: l.uom,
        ordered: l.qty,
        made,
        delivered,
        arrived,
        installed,
        ready_to_ship: made == null ? null : Math.max(0, made - delivered),
        on_site: Math.max(0, arrived - installed),
        /* A line with no product code and nothing delivered against it is a
           service — installation labour, a delivery fee. It has nothing to
           build and should not sit on a board reading 0 of 1 for ever. */
        is_service: l.product_code == null && delivered === 0,
      };
    });

  const goods = lines.filter((l) => !l.is_service);
  const matchable = goods.filter((l) => l.made != null);

  const ordered_qty = goods.reduce((s, l) => s + l.ordered, 0);
  const made_qty = matchable.length === goods.length
    ? goods.reduce((s, l) => s + (l.made ?? 0), 0)
    : matchable.length > 0 ? matchable.reduce((s, l) => s + (l.made ?? 0), 0) : null;
  const delivered_qty = goods.reduce((s, l) => s + l.delivered, 0);
  const installed_qty = goods.reduce((s, l) => s + l.installed, 0);

  const handoverOf = state.handovers.find((h) => h.project_code === projectCode) ?? null;
  const handover = handoverOf;

  const snags = state.snags.filter((s) => s.project_code === projectCode);
  const open_snags = snags.filter((s) => s.status === "OPEN").length;
  const major_snags = snags.filter((s) => s.status === "OPEN" && s.severity === "major").length;

  const mine = state.deliveries.filter((d) => d.project_code === projectCode && d.status !== "CANCELLED");
  const in_transit = mine.filter((d) => d.status === "IN_TRANSIT").length;

  /* The furthest thing that is true, not the furthest thing that has started.
     A project with one crate on a truck is not *in transit* as a whole. */
  const stage: FulfilmentStage =
    handover ? "handed_over"
      : ordered_qty > 0 && installed_qty >= ordered_qty ? "installed"
        : installed_qty > 0 || delivered_qty > 0 ? (in_transit > 0 ? "in_transit" : "on_site")
          : in_transit > 0 ? "in_transit"
            : made_qty != null && made_qty > 0 ? "ready_to_ship"
              : "in_production";

  const warnings: string[] = [];
  for (const l of goods) {
    if (l.made != null && l.made > l.ordered) {
      warnings.push(`Baris ${l.line_no}: dibuat ${l.made} ${l.uom}, dipesan ${l.ordered} — kelebihan ${l.made - l.ordered} perlu dijelaskan.`);
    }
    if (l.delivered > l.ordered) {
      warnings.push(`Baris ${l.line_no}: terkirim ${l.delivered} ${l.uom} dari pesanan ${l.ordered}.`);
    }
    /* Shipped more than the floor ever reported finishing. Not impossible —
       it usually means nobody reported the last stage — but it is the one gap
       that makes every other number on this row unreadable. */
    if (l.made != null && l.delivered > l.made) {
      warnings.push(`Baris ${l.line_no}: terkirim ${l.delivered} ${l.uom} tapi produksi baru melaporkan ${l.made} selesai. Biasanya tahap terakhirnya yang belum dilaporkan, bukan barangnya yang tidak ada.`);
    }
    /* A finished job's missing SPK is history, not a task. Saying it on a
       handed-over project puts a permanent warning on something nobody can
       act on — the same mistake F51 made with a closed project's date. */
    if (l.made == null && !handoverOf) {
      warnings.push(l.product_code
        ? `Baris ${l.line_no} tidak punya SPK sama sekali, jadi jumlah yang sudah dibuat tidak diketahui — bukan nol.`
        : `Baris ${l.line_no} tidak punya kode produk, jadi jumlah yang sudah dibuat tidak bisa dicocokkan ke SPK mana pun.`);
    }
  }
  if (handover && handover.open_snags_at_handover > 0) {
    warnings.push(`Diserahterimakan dengan ${handover.open_snags_at_handover} catatan masih terbuka.`);
  }
  if (!handover && project.target_date && project.target_date < today) {
    warnings.push(`Lewat tanggal janji ${project.target_date} dan belum serah terima.`);
  }

  return {
    project_code: project.code,
    project_name: project.name,
    client_name: project.client_name,
    location: project.location,
    target_date: project.target_date,
    lines,
    ordered_qty,
    made_qty,
    delivered_qty,
    installed_qty,
    installed_percent: ordered_qty > 0 ? Math.round((installed_qty / ordered_qty) * 100) : null,
    open_snags,
    major_snags,
    deliveries: mine.length,
    in_transit,
    handover,
    stage,
    days_to_target: project.target_date ? daysBetween(today, project.target_date) : null,
    warnings,
  };
}

export function fulfilmentViews(state: DemoState, today: string): FulfilmentView[] {
  return state.projects
    /* A handed-over project is closed, and closing it is exactly why it
       belongs on this board: the record of a finished job is the thing people
       come back to. Inactive with no handover is genuinely finished with
       nothing to show, and stays off. */
    .filter((p) => p.client_name && (p.is_active || state.handovers.some((h) => h.project_code === p.code)))
    .map((p) => fulfilmentView(state, p.code, today))
    .filter((v): v is FulfilmentView => v !== null)
    .sort((a, b) => {
      /* Handed over sinks; everything else by how close the promise is. */
      if ((a.stage === "handed_over") !== (b.stage === "handed_over")) return a.stage === "handed_over" ? 1 : -1;
      return (a.days_to_target ?? 9999) - (b.days_to_target ?? 9999);
    });
}

export function deliveryView(state: DemoState, d: Delivery, today: string): DeliveryView {
  const project = state.projects.find((p) => p.code === d.project_code);
  const lines = state.delivery_lines
    .filter((l) => l.delivery_id === d.id)
    .map((l) => ({
      ...l,
      line_no: state.project_lines.find((p) => p.id === l.project_line_id)?.line_no ?? 0,
    }))
    .sort((a, b) => a.line_no - b.line_no);

  const warnings: string[] = [];
  if (d.status === "ARRIVED" && !d.surat_jalan_attachment_id) {
    warnings.push("Sampai tapi surat jalannya belum dilampirkan.");
  }
  if (d.status === "IN_TRANSIT" && daysBetween(d.dispatched_on, today) >= 3) {
    warnings.push(`Berangkat ${daysBetween(d.dispatched_on, today)} hari lalu dan belum tercatat sampai.`);
  }
  if (lines.length === 0) warnings.push("Tidak ada barang di surat jalan ini.");

  return {
    ...d,
    project_name: project?.name ?? d.project_code,
    client_name: project?.client_name ?? null,
    location: project?.location ?? null,
    lines,
    total_qty: lines.reduce((s, l) => s + l.qty, 0),
    warnings,
  };
}

export function installationView(state: DemoState, i: Installation): InstallationView {
  const project = state.projects.find((p) => p.code === i.project_code);
  const lines = state.installation_lines
    .filter((l) => l.installation_id === i.id)
    .map((l) => {
      const pl = state.project_lines.find((p) => p.id === l.project_line_id);
      return { ...l, description: pl?.description ?? l.project_line_id, uom: pl?.uom ?? "", line_no: pl?.line_no ?? 0 };
    })
    .sort((a, b) => a.line_no - b.line_no);

  return {
    ...i,
    project_name: project?.name ?? i.project_code,
    location: project?.location ?? null,
    lines,
    total_qty: lines.reduce((s, l) => s + l.qty, 0),
    snags_found: state.snags.filter((s) => s.project_code === i.project_code && s.raised_on === i.visit_date).length,
  };
}

export function snagView(state: DemoState, s: Snag, today: string): SnagView {
  const project = state.projects.find((p) => p.code === s.project_code);
  const line = s.project_line_id
    ? state.project_lines.find((l) => l.id === s.project_line_id)
    : undefined;
  return {
    ...s,
    project_name: project?.name ?? s.project_code,
    line_description: line?.description ?? null,
    age_days: daysBetween(s.raised_on, s.fixed_on ?? today),
  };
}

/* ── Packing boxes ────────────────────────────────────────────────────
 *
 *  `position` — *3 dari 5* — is the only figure here the box row does not
 *  carry, and it is deliberately not stored. A box's place in a consignment
 *  changes when another box is added to the same lorry, and a number printed
 *  on a label that is no longer true is worse than no number. It is computed
 *  from the consignment every time it is read, and a box that is not on a
 *  consignment yet has none at all.
 */

export function boxView(state: DemoState, b: PackingBox): BoxView {
  const lines = state.box_lines.filter((l) => l.box_id === b.id);
  const delivery = b.delivery_id
    ? state.deliveries.find((d) => d.id === b.delivery_id)
    : undefined;

  let position: string | null = null;
  if (b.delivery_id) {
    const siblings = state.packing_boxes
      .filter((x) => x.delivery_id === b.delivery_id)
      .sort((x, y) => x.box_no.localeCompare(y.box_no));
    const at = siblings.findIndex((x) => x.id === b.id);
    if (at >= 0) position = `${at + 1} dari ${siblings.length}`;
  }

  const warnings: string[] = [];
  if (lines.length === 0) warnings.push("Peti ini tercatat tanpa isi.");
  if ((b.status === "ON_SITE" || b.status === "INSTALLED") && !delivery) {
    warnings.push("Tercatat sampai di site, tapi tidak menempel pada pengiriman mana pun.");
  }
  if (delivery && delivery.status === "ARRIVED" && b.scanned_at == null) {
    warnings.push("Pengirimannya sudah tercatat sampai, tapi peti ini belum ada yang scan.");
  }
  if (b.status === "PROBLEM" && !b.problem_note) {
    warnings.push("Ditandai bermasalah tanpa keterangan.");
  }

  return {
    ...b,
    lines,
    warnings,
    status_label: BOX_STATUS_LABEL[b.status],
    delivery_no: delivery?.delivery_no ?? null,
    project_name: state.projects.find((p) => p.code === b.project_code)?.name ?? null,
    packed_by_name: state.users.find((u) => u.id === b.packed_by)?.full_name ?? b.packed_by,
    scanned_by_name: b.scanned_by
      ? state.users.find((u) => u.id === b.scanned_by)?.full_name ?? b.scanned_by
      : null,
    piece_count: lines.reduce((sum, l) => sum + l.qty, 0),
    position,
  };
}

export function boxViews(state: DemoState): BoxView[] {
  return state.packing_boxes
    .map((b) => boxView(state, b))
    .sort((a, b) => b.box_no.localeCompare(a.box_no));
}

/** The one sentence a delivery screen needs about its boxes.
 *
 *  Returns `null` when the consignment has no boxes recorded — which is not
 *  the same fact as *nol peti* and must not be rendered as one. Deliveries
 *  from before the labels existed are the ordinary case, not an error (F60).
 */
export function boxSummary(state: DemoState, deliveryId: string): {
  total: number; on_site: number; installed: number; problem: number; unscanned: number;
} | null {
  const boxes = state.packing_boxes.filter((b) => b.delivery_id === deliveryId);
  if (boxes.length === 0) return null;
  return {
    total: boxes.length,
    on_site: boxes.filter((b) => b.status === "ON_SITE").length,
    installed: boxes.filter((b) => b.status === "INSTALLED").length,
    problem: boxes.filter((b) => b.status === "PROBLEM").length,
    unscanned: boxes.filter((b) => b.scanned_at == null).length,
  };
}
