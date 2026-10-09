/** Design contracts — a project's collections, rooms and design items, their
 *  files and the client's approval (`ops_procure`, 0222, P4).
 *
 *  The order is the drafters' own: client → project → collection / catalogue →
 *  room → item (D379). An item is what is drawn and offered before anything is
 *  ordered; it becomes a **product** — with a BOM and Job Orders — once it is
 *  (P5). Its status is read from its files and approvals, never typed (A3).
 */
import { trNow } from "@/lib/i18n";

/** Who designed it: us, the client (we make what they drew), or adapted from
 *  the client's reference. */
export type DesignOrigin = "tala" | "client" | "adapted";

export const DESIGN_ORIGINS: { code: DesignOrigin; label: string; label_id: string }[] = [
  { code: "tala", label: "TALA", label_id: "TALA" },
  { code: "client", label: "Client", label_id: "Klien" },
  { code: "adapted", label: "Adapted", label_id: "Adaptasi" },
];

/** Where an item stands, furthest first: on an order line, on a quotation
 *  that went out (P5), approved, drawn, or only a concept. P6 adds the
 *  drafters' release. */
export type DesignItemStatus = "CONCEPT" | "DRAWN" | "APPROVED" | "QUOTED" | "ORDERED" | "DROPPED";

export const DESIGN_ITEM_STATUSES: {
  code: DesignItemStatus; label: string; tone: "slate" | "brand" | "green" | "red" | "violet";
}[] = [
  { code: "CONCEPT", get label() { return trNow("Concept", "Konsep"); }, tone: "slate" },
  { code: "DRAWN", get label() { return trNow("Drawn", "Sudah digambar"); }, tone: "brand" },
  { code: "APPROVED", get label() { return trNow("Client approved", "Disetujui klien"); }, tone: "green" },
  { code: "QUOTED", get label() { return trNow("Quoted", "Sudah ditawarkan"); }, tone: "violet" },
  { code: "ORDERED", get label() { return trNow("Ordered", "Dipesan"); }, tone: "green" },
  { code: "DROPPED", get label() { return trNow("Dropped", "Dikeluarkan"); }, tone: "red" },
];

export type ApprovalChannel = "whatsapp" | "meeting" | "email" | "signed" | "other";

export const APPROVAL_CHANNELS: { code: ApprovalChannel; label: string; label_id: string }[] = [
  { code: "whatsapp", label: "WhatsApp", label_id: "WhatsApp" },
  { code: "meeting", label: "Meeting", label_id: "Meeting" },
  { code: "email", label: "Email", label_id: "Email" },
  { code: "signed", label: "Signed print", label_id: "Tanda tangan di gambar" },
  { code: "other", label: "Other", label_id: "Lainnya" },
];

export interface DesignCollection {
  id: string;
  /** A, B, KAT1 — fixed once; it is inside every item number. */
  code: string;
  name: string;
  note: string | null;
  project_code: string;
  project_name: string;
  room_count: number;
  /** Items not dropped. */
  item_count: number;
  approved_count: number;
  created_at: string;
}

export interface DesignRoom {
  id: string;
  code: string;
  name: string;
  sort: number;
  collection_code: string;
  project_code: string;
  item_count: number;
}

export interface DesignItemView {
  id: string;
  /** 26007-A-LR-01: project, collection, room, number in the room. */
  item_no: string;
  seq: number;
  name: string;
  qty: number;
  length_mm: number | null;
  width_mm: number | null;
  height_mm: number | null;
  origin: DesignOrigin;
  /** Filled once the item is ordered and becomes a product (P5). */
  product_code: string | null;
  note: string | null;
  dropped_at: string | null;
  drop_reason: string | null;
  created_at: string;
  updated_at: string;
  room_code: string;
  room_name: string;
  room_sort: number;
  collection_code: string;
  collection_name: string;
  project_code: string;
  project_name: string;
  client_code: string | null;
  client_display: string | null;
  /** Render, moodboard, layout, working or finished drawing on the item. */
  design_files: number;
  /** The client's drawings and references on the item. */
  client_files: number;
  all_files: number;
  approval_decision: "approved" | "withdrawn" | null;
  approval_on: string | null;
  approval_channel: ApprovalChannel | null;
  approval_by: string | null;
  status: DesignItemStatus;
  /** The latest quotation sent with the item, and what it was offered at
   *  (0225). */
  quote_no: string | null;
  quote_status: string | null;
  quoted_unit_price: number | null;
  /** An order line carries it. */
  ordered: boolean;
}

export interface DesignApproval {
  id: string;
  item_no: string;
  decision: "approved" | "withdrawn";
  decided_on: string;
  channel: ApprovalChannel;
  client_person: string;
  note: string | null;
  attachment_id: string | null;
  attachment_filename: string | null;
  evidence_attachment_id: string | null;
  evidence_filename: string | null;
  recorded_by_name: string | null;
  recorded_at: string;
}

/** A project's whole design, read at once: the tab draws all three. */
export interface ProjectDesign {
  collections: DesignCollection[];
  rooms: DesignRoom[];
  items: DesignItemView[];
}

export interface DesignItemInput {
  project_code: string;
  collection_code: string;
  room_code: string;
  name: string;
  qty: number;
  origin: DesignOrigin;
  length_mm?: number | null;
  width_mm?: number | null;
  height_mm?: number | null;
  note?: string | null;
  /** Given: corrects that item (it never moves room). Left out: a new one. */
  item_no?: string | null;
}

export interface DesignApprovalInput {
  item_no: string;
  decision: "approved" | "withdrawn";
  decided_on: string;
  channel: ApprovalChannel;
  client_person: string;
  /** The file that was approved — one of the item's own. */
  attachment_id?: string | null;
  /** The proof: a screenshot, a signed print. */
  evidence_attachment_id?: string | null;
  note?: string | null;
}

/* ── Studio Desain: six boxes on every item (0248, S1, D399–D405) ─────────── */

/** What a drafter delivers for an item. A box is filled by doing the work — a
 *  file, a saved specification, a BOM — never by saying so. */
export type DesignBoxKey = "pdf" | "dwg" | "render" | "foto" | "spec" | "bom";

/** Empty, filled, or not needed for this item (D401: nothing is required, so
 *  *not needed* exists only to let an item without a render be complete). */
export type DesignBoxState = "kosong" | "terisi" | "tidak_perlu";

export const DESIGN_BOXES: {
  key: DesignBoxKey;
  /** The file kind a box is filled with; null for the spec and the BOM. */
  kind: "Gambar Kerja" | "DWG" | "Render" | "Gambar Jadi" | null;
  short: string;
  label: string;
  /** What the file picker offers. */
  accept?: string;
}[] = [
  { key: "pdf", kind: "Gambar Kerja", short: "PDF", get label() { return trNow("Working drawing", "Gambar kerja"); }, accept: ".pdf,application/pdf" },
  { key: "dwg", kind: "DWG", short: "DWG", get label() { return trNow("DWG", "DWG"); }, accept: ".dwg,.dxf" },
  { key: "render", kind: "Render", short: "R", get label() { return trNow("Render", "Render"); }, accept: "image/*,.pdf" },
  { key: "foto", kind: "Gambar Jadi", short: "F", get label() { return trNow("Item photo", "Foto item"); }, accept: "image/*,.pdf" },
  { key: "spec", kind: null, short: "S", get label() { return trNow("Specification", "Spesifikasi"); } },
  { key: "bom", kind: null, short: "B", get label() { return trNow("BOM", "BOM"); } },
];

/** One box of one item (`v_design_box`). */
export interface DesignBox {
  item_no: string;
  item_name: string;
  project_code: string;
  collection_code: string;
  collection_name: string;
  room_code: string;
  room_name: string;
  room_sort: number;
  /** Dropped items are left out of progress. */
  dropped: boolean;
  box: DesignBoxKey;
  sort: number;
  state: DesignBoxState;
  /** Files on the box now, or the spec's version count. */
  versions: number;
  /** `B` for a file (its place in filing order, kept when an earlier one is
   *  taken off), `2` for a spec or a BOM revision. The latest is the one that
   *  counts (D399). */
  latest_label: string | null;
  latest_at: string | null;
  latest_by: string | null;
  latest_note: string | null;
  latest_attachment_id: string | null;
  latest_filename: string | null;
  latest_link: string | null;
  spec_body: string | null;
  /** The item's product: made from it (D400) or named on its order line. */
  product_code: string | null;
  bom_rev: number | null;
  bom_draft_rev: number | null;
  /** The released BOM's production cost per unit — what a quotation is priced
   *  from. Not a selling price. */
  bom_cost: number | null;
  skip_note: string | null;
  skip_by: string | null;
  skip_at: string | null;
}

/** One version in a box's history (`v_design_box_version`). */
export interface DesignBoxVersion {
  item_no: string;
  box: DesignBoxKey;
  ordinal: number;
  label: string;
  at: string;
  by_name: string | null;
  note: string | null;
  attachment_id: string | null;
  filename: string | null;
  web_view_link: string | null;
  /** A specification's text. */
  body: string | null;
  /** A file taken off the item: still history, no longer the latest. */
  removed: boolean;
}

/** A project the drafters can work in (`v_design_project`): live, or already
 *  carrying a design. No price in it. */
export interface DesignProject {
  project_code: string;
  project_name: string;
  status: string;
  client_code: string | null;
  client_display: string | null;
  target_date: string | null;
  collection_count: number;
  item_count: number;
}

/** Filled boxes over all boxes, for any set of boxes: an item, a room, a
 *  project. Dropped items do not count. Never stored (A3). */
export function boxProgress(boxes: DesignBox[]): { filled: number; total: number } {
  const live = boxes.filter((b) => !b.dropped);
  return { filled: live.filter((b) => b.state !== "kosong").length, total: live.length };
}
