/** The sandbox's copy of `ops_procure.latest_design_file` (0224): the newest
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
