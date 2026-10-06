/** The sandbox's copy of `ops_procure.latest_design_file` (0225): the newest
 *  drawing filed on a design item — ours or the client's own — that a price
 *  can rest on. A moodboard is not one. */
import type { DemoState } from "./state";

export const PRICED_DRAWING_KINDS = ["Render", "Layout / Floor Plan", "Gambar Kerja", "Client Drawing"];

export function latestDesignFile(state: DemoState, itemId: string | null | undefined): string | null {
  if (!itemId) return null;
  const item = state.design_items.find((i) => i.id === itemId);
  if (!item) return null;
  const link = state.attachment_links
    .filter((l) => l.entity === "design_item" && l.entity_no === item.item_no && PRICED_DRAWING_KINDS.includes(l.kind))
    .sort((a, b) => b.linked_at.localeCompare(a.linked_at))[0];
  return link?.attachment_id ?? null;
}

/** How far a design item has got, as far as the drafters care (P6): the
 *  client approved it, it went out on a quotation, an order line carries it.
 *  The sandbox's reading of `v_design_item`'s status (0222, 0225). */
export function designItemProgress(state: DemoState, itemId: string) {
  const approval = state.design_approvals
    .filter((a) => a.item_id === itemId)
    .sort((a, b) => b.recorded_at.localeCompare(a.recorded_at))[0];
  const quoted = state.quotation_lines
    .filter((l) => l.design_item_id === itemId)
    .map((l) => state.quotations.find((q) => q.id === l.quotation_id))
    .filter((q) => q && q.status !== "DRAFT")
    .sort((a, b) => (b!.sent_at ?? "").localeCompare(a!.sent_at ?? ""))[0];
  const orders = state.project_lines.filter((l) => l.design_item_id === itemId);
  return {
    approved: approval?.decision === "approved",
    quote_no: quoted?.quote_no ?? null,
    ordered: orders.length > 0,
    product_code: orders.find((o) => o.product_code)?.product_code ?? null,
  };
}
