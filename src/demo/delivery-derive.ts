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
import { VENDOR_PROCESS_NAME } from "@/services/production/contracts";
import {
  buildFulfilment, fulfilmentOrder, deliveryWarnings, boxWarnings, daysBetween,
} from "@/services/delivery/fulfilment";


/** How many of this product this project has actually finished.
 *
 *  Matched on **project code and product code**, which is the only pairing
 *  that exists on both sides. A line with no product code cannot be matched to
 *  a work order without guessing from its wording, and guessing here would put
 *  a number under *sudah dibuat* that nobody can check — so it returns null
 *  and the screen says the line cannot be matched (D210, F53).
 */
/** How many units of this line are sitting at a vendor right now, and where.
 *
 *  The fulfilment board answers *how much has reached the client*, and until
 *  W6 it had no word for the most common reason a number is stuck: the goods
 *  are at the upholsterer. A client asking *where are my twenty chairs* was
 *  answerable only by opening the production board and reading the legs
 *  (D282). Null where the line cannot be matched to a work order at all —
 *  the same distinction `madeFor` makes, for the same reason (F60).
 */
/** The Job Orders behind one order line: those made from it (0130), or — for
 *  a project that predates the link — those for its project and product that
 *  name no line. The same rule `ops_dlv.v_fulfilment_line` uses. */
function jobsFor(state: DemoState, projectCode: string, line: { id: string; product_code: string | null }) {
  return state.work_orders.filter((w) => w.status !== "CANCELLED" && (
    w.project_line_id === line.id
    || (!w.project_line_id && w.project_code === projectCode && !!line.product_code && w.product_code === line.product_code)));
}

function atVendorFor(
  state: DemoState, projectCode: string, line: { id: string; product_code: string | null }, today: string,
): { qty: number; where: string[] } | null {
  const orders = jobsFor(state, projectCode, line);
  if (orders.length === 0) return null;
  const ids = new Set(orders.map((w) => w.id));
  const open = state.vendor_legs.filter((l) => ids.has(l.wo_id) && l.returned_on === null);
  return {
    qty: open.reduce((t, l) => t + (l.qty - (l.returned_qty ?? 0)), 0),
    where: [...new Set(open.map((l) => {
      const vendor = state.vendors.find((v) => v.id === l.vendor_id)?.name ?? l.vendor_id;
      const late = l.expected_back !== null && l.expected_back < today
        ? `, lewat janji ${Math.abs(daysBetween(today, l.expected_back))} hari`
        : "";
      return `${l.qty - (l.returned_qty ?? 0)} untuk ${VENDOR_PROCESS_NAME(l.process)} di ${vendor}${late}`;
    }))],
  };
}

/** Finished all the way through, on the line's Job Orders. **No Job Order at
 *  all is not zero** — it is nothing in production knowing about this line,
 *  and the two need completely different conversations (F60). */
function madeFor(state: DemoState, projectCode: string, line: { id: string; product_code: string | null }): number | null {
  const orders = jobsFor(state, projectCode, line);
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
      const made = madeFor(state, projectCode, l);
      const atVendor = atVendorFor(state, projectCode, l, today);
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
        at_vendor: atVendor?.qty ?? null,
        at_vendor_where: atVendor?.where ?? [],
        /* Nothing to build — installation labour, a delivery fee. */
        is_service: l.product_code == null && delivered === 0,
      };
    });

  const snags = state.snags.filter((s) => s.project_code === projectCode);
  const mine = state.deliveries.filter((d) => d.project_code === projectCode && d.status !== "CANCELLED");
  const clientName = project.client_id
    ? state.clients.find((c) => c.id === project.client_id)?.name ?? project.client_name
    : project.client_name;
  return buildFulfilment(
    { code: project.code, name: project.name, client_name: clientName ?? null, location: project.location, target_date: project.target_date },
    lines,
    {
      handover: state.handovers.find((h) => h.project_code === projectCode) ?? null,
      open_snags: snags.filter((s) => s.status === "OPEN").length,
      major_snags: snags.filter((s) => s.status === "OPEN" && s.severity === "major").length,
      deliveries: mine.length,
      in_transit: mine.filter((d) => d.status === "IN_TRANSIT").length,
      today,
    },
  );
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
    .sort(fulfilmentOrder);
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

  const warnings = deliveryWarnings(d, lines.length, today);

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

  const warnings = boxWarnings(b, lines.length, delivery ?? null);

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
