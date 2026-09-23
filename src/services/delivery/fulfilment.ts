/** How much of what the client bought has reached them — the arithmetic, once.
 *
 *  The demo derives the per-line figures from its fixtures and the live client
 *  reads them from `ops_dlv.v_fulfilment_line`; both hand them here, so the
 *  stage, the totals and the warnings cannot disagree between the two (F75's
 *  rule, the same arrangement `production/work-order-view.ts` makes).
 */
import type {
  BoxStatus, DeliveryStatus, FulfilmentLine, FulfilmentStage, FulfilmentView, Handover,
} from "./contracts";

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export interface FulfilmentProject {
  code: string;
  name: string;
  client_name: string | null;
  location: string | null;
  target_date: string | null;
}

export interface FulfilmentContext {
  handover: Handover | null;
  open_snags: number;
  major_snags: number;
  /** Deliveries not cancelled. */
  deliveries: number;
  in_transit: number;
  today: string;
}

export function buildFulfilment(
  project: FulfilmentProject, lines: FulfilmentLine[], ctx: FulfilmentContext,
): FulfilmentView {
  const goods = lines.filter((l) => !l.is_service);
  const matchable = goods.filter((l) => l.made != null);

  const ordered_qty = goods.reduce((s, l) => s + l.ordered, 0);
  const made_qty = matchable.length === goods.length
    ? goods.reduce((s, l) => s + (l.made ?? 0), 0)
    : matchable.length > 0 ? matchable.reduce((s, l) => s + (l.made ?? 0), 0) : null;
  const delivered_qty = goods.reduce((s, l) => s + l.delivered, 0);
  const installed_qty = goods.reduce((s, l) => s + l.installed, 0);
  const { handover, in_transit, today } = ctx;

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
    /* Shipped more than the floor reported finishing: usually the last stage
       nobody reported, and the one gap that makes every other number on the
       row unreadable. */
    if (l.made != null && l.delivered > l.made) {
      warnings.push(`Baris ${l.line_no}: terkirim ${l.delivered} ${l.uom} tapi produksi baru melaporkan ${l.made} selesai. Biasanya tahap terakhirnya yang belum dilaporkan, bukan barangnya yang tidak ada.`);
    }
    /* A finished job's missing Job Order is history, not a task (F51). */
    if (l.made == null && !handover) {
      warnings.push(l.product_code
        ? `Baris ${l.line_no} belum punya Job Order, jadi jumlah yang sudah dibuat tidak diketahui — bukan nol.`
        : `Baris ${l.line_no} tidak punya item code, jadi jumlah yang sudah dibuat tidak bisa dicocokkan ke Job Order mana pun.`);
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
    open_snags: ctx.open_snags,
    major_snags: ctx.major_snags,
    deliveries: ctx.deliveries,
    in_transit,
    handover,
    stage,
    days_to_target: project.target_date ? daysBetween(today, project.target_date) : null,
    warnings,
  };
}

/** Handed over sinks; everything else by how close the promise is. */
export function fulfilmentOrder(a: FulfilmentView, b: FulfilmentView): number {
  if ((a.stage === "handed_over") !== (b.stage === "handed_over")) return a.stage === "handed_over" ? 1 : -1;
  return (a.days_to_target ?? 9999) - (b.days_to_target ?? 9999);
}

/** Said plainly about one consignment. */
export function deliveryWarnings(
  d: { status: DeliveryStatus; surat_jalan_attachment_id: string | null; dispatched_on: string },
  lineCount: number, today: string,
): string[] {
  const w: string[] = [];
  if (d.status === "ARRIVED" && !d.surat_jalan_attachment_id) w.push("Sampai tapi surat jalannya belum dilampirkan.");
  if (d.status === "IN_TRANSIT" && daysBetween(d.dispatched_on, today) >= 3) {
    w.push(`Berangkat ${daysBetween(d.dispatched_on, today)} hari lalu dan belum tercatat sampai.`);
  }
  if (lineCount === 0) w.push("Tidak ada barang di surat jalan ini.");
  return w;
}

/** Where the crate record and the consignment record disagree — a paperwork
 *  gap, not a lie: the crate is standing there. */
export function boxWarnings(
  b: { status: BoxStatus; scanned_at: string | null; problem_note: string | null },
  lineCount: number, delivery: { status: DeliveryStatus } | null,
): string[] {
  const w: string[] = [];
  if (lineCount === 0) w.push("Peti ini tercatat tanpa isi.");
  if ((b.status === "ON_SITE" || b.status === "INSTALLED") && !delivery) {
    w.push("Tercatat sampai di site, tapi tidak menempel pada pengiriman mana pun.");
  }
  if (delivery && delivery.status === "ARRIVED" && b.scanned_at == null) {
    w.push("Pengirimannya sudah tercatat sampai, tapi peti ini belum ada yang scan.");
  }
  if (b.status === "PROBLEM" && !b.problem_note) w.push("Ditandai bermasalah tanpa keterangan.");
  return w;
}
