/** Field QC contracts — schema `ops_qc` (0261, O6, kajian F255 §5.7, D418).
 *
 *  TALA's partner factories are watched by an outsourced QC team, not staff.
 *  The coordinator keeps the team and sends people to factory orders; each QC
 *  signs in with their own account and sees only what they were sent to watch
 *  — the order, its factory and project, its lines and working drawings, never
 *  a price (Q88). From the factory they send reports — photos, a stage, how
 *  many have passed so far — and findings; the latest report is the factory's
 *  progress on the project board (0264, O7, D420).
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
  /** The day of the latest live report on this assignment (0264). */
  last_report_on: string | null;
  report_count: number;
  /** On a live assignment: days since the last report (or since the day
   *  before it started). Said, never blocked. Null when not live. */
  days_without_report: number | null;
  /** Open findings on this assignment's order, whoever raised them. */
  open_findings: number;
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

/* ── reports and findings (0264, O7, D420) ──────────────────────────────── */

/** Where the work is when the QC looks at it. `loading` is the check at the
 *  container door, and names the container. */
export type QcStage = "material" | "construction" | "finishing" | "packing" | "loading";
export const QC_STAGES: QcStage[] = ["material", "construction", "finishing", "packing", "loading"];
export const QC_STAGE_LABELS: Record<QcStage, Message> = {
  material: { en: "Material", id: "Bahan" },
  construction: { en: "Construction", id: "Konstruksi" },
  finishing: { en: "Finishing", id: "Finishing" },
  packing: { en: "Packing", id: "Packing" },
  loading: { en: "Loading", id: "Muat" },
};
export const QC_STAGE_LABEL = bilingual(QC_STAGE_LABELS);

/** One visit's report, as a reader may see it. */
export interface QcReport {
  id: string;
  /** `qcr-26-10-12_01`. */
  report_no: string;
  report_date: string;
  stage: QcStage;
  note: string | null;
  created_at: string;
  cancelled_at: string | null;
  cancel_reason: string | null;
  assign_no: string;
  person_code: string;
  person_name: string;
  is_mine: boolean;
  po_no: string | null;
  vendor_name: string | null;
  project_code: string | null;
  project_name: string | null;
  /** The container a loading check was made on. */
  container_no: string | null;
  line_count: number;
  passed_total: number;
  rejected_total: number;
  photo_count: number;
}

/** A line as the QC counts it: `passed` is how many have passed **so far**,
 *  not today's increment, so two QCs and a re-check never add up to more than
 *  was made (D420); `rejected` is this visit's. */
export interface QcReportLineInput {
  line_no: number;
  passed: number;
  rejected?: number;
}

export interface QcReportInput {
  assign_no: string;
  report_date: string;
  stage: QcStage;
  lines: QcReportLineInput[];
  note?: string | null;
  /** At loading: the container checked (`delivery_no`). */
  delivery_no?: string | null;
  /** Photos uploaded against the assignment (`Foto QC`), linked to the report. */
  photo_ids?: string[];
}

export interface QcReportLine {
  line_no: number;
  description: string | null;
  qty: number | null;
  uom: string | null;
  passed: number;
  rejected: number;
}

/** A line of the factory order with how far QC says it is: passed at the
 *  latest report that counted it ÷ ordered. Quantities, never prices. */
export interface QcLineProgress {
  line_no: number;
  description: string;
  qty: number;
  uom: string;
  passed: number | null;
  qc_stage: QcStage | null;
  reported_on: string | null;
  report_no: string | null;
  rejected_total: number;
  open_findings: number;
}

/** A container loaded from the order, for the loading check to name. */
export interface QcOrderContainer {
  delivery_no: string;
  container_no: string | null;
  container_size: string | null;
  loaded_on: string;
  status: string;
}

/** production · loading · after_arrival — the last is the client's claim (O8). */
export type QcFindingPhase = "production" | "loading" | "after_arrival";
export type QcFindingKind = "defect" | "spec_mismatch" | "late" | "damaged" | "packing" | "other";
export type QcSeverity = "minor" | "major" | "critical";
export type QcFindingStatus = "OPEN" | "RESOLVED";

export const QC_FINDING_PHASE_LABELS: Record<QcFindingPhase, Message> = {
  production: { en: "Production", id: "Produksi" },
  loading: { en: "Loading", id: "Muat" },
  after_arrival: { en: "After arrival", id: "Setelah sampai" },
};
export const QC_FINDING_KIND_LABELS: Record<QcFindingKind, Message> = {
  defect: { en: "Defect", id: "Cacat" },
  spec_mismatch: { en: "Material/spec mismatch", id: "Bahan/spek tidak sesuai" },
  late: { en: "Late", id: "Telat" },
  damaged: { en: "Damaged", id: "Rusak" },
  packing: { en: "Packing", id: "Packing" },
  other: { en: "Other", id: "Lainnya" },
};
export const QC_SEVERITY_LABELS: Record<QcSeverity, Message> = {
  minor: { en: "Minor", id: "Minor" },
  major: { en: "Major", id: "Major" },
  critical: { en: "Critical", id: "Kritis" },
};
export const QC_FINDING_PHASE_LABEL = bilingual(QC_FINDING_PHASE_LABELS);
export const QC_FINDING_KIND_LABEL = bilingual(QC_FINDING_KIND_LABELS);
export const QC_SEVERITY_LABEL = bilingual(QC_SEVERITY_LABELS);

export interface QcFinding {
  id: string;
  /** `qcf-26-10-12_01`. */
  finding_no: string;
  phase: QcFindingPhase;
  finding_kind: QcFindingKind;
  severity: QcSeverity;
  description: string;
  status: QcFindingStatus;
  resolution: string | null;
  resolved_at: string | null;
  created_at: string;
  line_no: number | null;
  line_description: string | null;
  po_no: string | null;
  vendor_name: string | null;
  project_code: string | null;
  project_name: string | null;
  report_no: string | null;
  container_no: string | null;
  raised_by_name: string | null;
  resolved_by_name: string | null;
  photo_count: number;
}

export interface QcFindingInput {
  po_no: string;
  phase: QcFindingPhase;
  kind: QcFindingKind;
  severity: QcSeverity;
  description: string;
  line_no?: number | null;
  report_no?: string | null;
  delivery_no?: string | null;
  photo_ids?: string[];
}
