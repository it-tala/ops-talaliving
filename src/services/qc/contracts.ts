/** Field QC contracts — schema `ops_qc` (0261, O6, kajian F255 §5.7, D418).
 *
 *  TALA's partner factories are watched by an outsourced QC team, not staff.
 *  The coordinator keeps the team and sends people to factory orders; each QC
 *  signs in with their own account and sees only what they were sent to watch
 *  — the order, its factory and project, its lines and working drawings, never
 *  a price (Q88). Reports, findings and progress are O7.
 */

import { bilingual, type Message } from "@/lib/i18n";
import type { PoStatus } from "@/services/procurement/contracts";

export interface QcPerson {
  id: string;
  /** `QC-001`, made by the database. */
  code: string;
  name: string;
  phone: string | null;
  city: string | null;
  is_active: boolean;
  inactive_reason: string | null;
  note: string | null;
  /** The ops account they sign in with, when one is linked. */
  account_email: string | null;
  /** What that account holds in `qc` — `write` once linked (0261). */
  account_qc_level: "read" | "write" | "admin" | null;
  active_assignments: number;
  total_assignments: number;
}

export interface QcPersonInput {
  /** Absent for a new person. */
  code?: string | null;
  name: string;
  phone?: string | null;
  city?: string | null;
  note?: string | null;
  /** The account to link; empty unlinks. Linking grants `qc: write` when the
   *  account holds nothing in `qc` yet. */
  user_email?: string | null;
}

/** PLANNED starts later · ACTIVE · ENDED past its end · CANCELLED with a
 *  reason, kept for the evaluation (O9). */
export type QcAssignmentState = "PLANNED" | "ACTIVE" | "ENDED" | "CANCELLED";

export const QC_ASSIGNMENT_STATE_LABELS: Record<QcAssignmentState, Message> = {
  PLANNED: { en: "Planned", id: "Terjadwal" },
  ACTIVE: { en: "Active", id: "Berjalan" },
  ENDED: { en: "Ended", id: "Selesai" },
  CANCELLED: { en: "Cancelled", id: "Dibatalkan" },
};
export const QC_ASSIGNMENT_STATE_LABEL = bilingual(QC_ASSIGNMENT_STATE_LABELS);

export interface QcAssignment {
  id: string;
  /** `qca-26-10-12_01`. */
  assign_no: string;
  starts_on: string;
  ends_on: string | null;
  note: string | null;
  created_at: string;
  cancelled_at: string | null;
  cancel_reason: string | null;
  person_code: string;
  person_name: string;
  person_phone: string | null;
  person_city: string | null;
  /** The signed-in account is this person. */
  is_mine: boolean;
  /** The factory order, as a QC may read it — number, state, factory,
   *  project, promised date, how many lines and containers; never a price. */
  po_no: string | null;
  po_status: PoStatus | null;
  vendor_name: string | null;
  vendor_address: string | null;
  project_code: string | null;
  project_name: string | null;
  client_name: string | null;
  expected_delivery: string | null;
  issued_at: string | null;
  line_count: number;
  container_count: number;
  state: QcAssignmentState;
}

export interface QcAssignmentInput {
  person_code: string;
  po_no: string;
  starts_on: string;
  ends_on?: string | null;
  note?: string | null;
}

/** What a QC checks on an assignment: one line of the factory order, the
 *  client's order line it makes, and the newest working drawing of its design
 *  item. Quantities, never prices. */
export interface QcAssignmentLine {
  line_no: number;
  description: string;
  qty: number;
  uom: string;
  project_line_no: number | null;
  design_item_no: string | null;
  product_code: string | null;
  drawing_attachment_id: string | null;
  drawing_filename: string | null;
  drawing_url: string | null;
}

export interface QcAssignResult {
  assign_no: string;
  /** False while the person has no account — they cannot see it yet. */
  account_linked: boolean;
  /** Who else watches this order, named rather than refused (D414). */
  others_on_order: string | null;
}

/** A factory order a coordinator can send somebody to, with who already
 *  watches it (0261's `assignable_orders`) — no price. */
export interface QcAssignableOrder {
  po_no: string;
  po_status: PoStatus;
  vendor_name: string;
  project_code: string;
  project_name: string;
  expected_delivery: string | null;
  line_count: number;
  qc_names: string | null;
}
