/** The client log (0134): what was said to a client, and what to do next.
 *
 *  One row per contact — a call, a WhatsApp, a meeting, a site visit, a note —
 *  optionally about one project and one quotation, optionally carrying a
 *  **follow-up**: a date and what to do, closed once done with what came of
 *  it. Append-only: a follow-up that moves is closed with its result and a new
 *  one logged.
 */

export type ActivityKind = "call" | "whatsapp" | "email" | "meeting" | "visit" | "note";

export const ACTIVITY_KINDS: { code: ActivityKind; label: string }[] = [
  { code: "call", label: "Telepon" },
  { code: "whatsapp", label: "WhatsApp" },
  { code: "email", label: "Email" },
  { code: "meeting", label: "Meeting" },
  { code: "visit", label: "Kunjungan" },
  { code: "note", label: "Catatan" },
];

export const ACTIVITY_KIND_LABEL = (k: ActivityKind): string =>
  ACTIVITY_KINDS.find((x) => x.code === k)?.label ?? k;

/** Where a follow-up stands, against today in the office's time zone. */
export type FollowUpState = "none" | "overdue" | "today" | "upcoming" | "done";

/** One contact as the screens read it — `v_client_activity`. */
export interface ClientActivityView {
  id: string;
  kind: ActivityKind;
  happened_on: string;
  summary: string;
  follow_up_on: string | null;
  next_action: string | null;
  follow_up_done_at: string | null;
  follow_up_result: string | null;
  follow_up_state: FollowUpState;
  client_code: string;
  client_name: string;
  client_contact: string | null;
  client_phone: string | null;
  project_code: string | null;
  project_name: string | null;
  quote_no: string | null;
  quote_status: string | null;
  created_by_name: string | null;
  follow_up_done_by_name: string | null;
  created_at: string;
}

export interface ActivityFilter {
  client_code?: string;
  project_code?: string;
  quote_no?: string;
  /** Only follow-ups still to be done. */
  open_follow_ups?: boolean;
}

export interface ActivityInput {
  /** Optional when the project or quotation names the client. */
  client_code?: string | null;
  project_code?: string | null;
  quote_no?: string | null;
  kind: ActivityKind;
  summary: string;
  /** Defaults to today. Never in the future. */
  happened_on?: string | null;
  follow_up_on?: string | null;
  next_action?: string | null;
}

/** The client-facing figures of a set of quotations — what the sales summary
 *  reads. Only the revision still in play counts for an open quotation, so a
 *  revised offer is not counted twice. */
export interface SalesSummary {
  drafts: number;
  open_count: number;
  open_value: number;
  accepted_count: number;
  accepted_value: number;
  rejected_count: number;
  rejected_value: number;
  /** Accepted ÷ decided, or null before anything was decided. */
  win_rate: number | null;
  /** Rejection reasons, most frequent first. */
  reasons: { reason: string; count: number }[];
}

/** A contact as stored — `ops_procure.client_activities`. */
export interface ClientActivity {
  id: string;
  client_id: string;
  project_id: string | null;
  quotation_id: string | null;
  kind: ActivityKind;
  happened_on: string;
  summary: string;
  follow_up_on: string | null;
  next_action: string | null;
  follow_up_done_at: string | null;
  follow_up_done_by: string | null;
  follow_up_result: string | null;
  created_by: string | null;
  created_at: string;
}
