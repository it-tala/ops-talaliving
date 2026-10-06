/** The client log (0134): what was said to a client, and what to do next.
 *
 *  One row per contact — a call, a WhatsApp, a meeting, a site visit, a note —
 *  optionally about one project and one quotation, optionally carrying a
 *  **follow-up**: a date and what to do, closed once done with what came of
 *  it. Append-only: a follow-up that moves is closed with its result and a new
 *  one logged.
 */
import { trNow, type Message } from "@/lib/i18n";

export type ActivityKind = "call" | "whatsapp" | "email" | "meeting" | "visit" | "note";

export const ACTIVITY_KIND_LABELS: Record<ActivityKind, Message> = {
  call: { en: "Call", id: "Telepon" },
  whatsapp: { en: "WhatsApp", id: "WhatsApp" },
  email: { en: "Email", id: "Email" },
  meeting: { en: "Meeting", id: "Meeting" },
  visit: { en: "Visit", id: "Kunjungan" },
  note: { en: "Note", id: "Catatan" },
};

export const ACTIVITY_KINDS: { code: ActivityKind; label: string }[] =
  (Object.keys(ACTIVITY_KIND_LABELS) as ActivityKind[]).map((code) => ({
    code,
    get label() { return trNow(ACTIVITY_KIND_LABELS[code].en, ACTIVITY_KIND_LABELS[code].id); },
  }));

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
  /** What the entry carries (0223, P3): who was there, the minutes as lines,
   *  how many of those are still to be done, and its files. */
  attendee_count: number;
  point_count: number;
  open_points: number;
  file_count: number;
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

/* ── a meeting in full (0223, P3) ─────────────────────────────────────────── */

/** Whose side an attendee was on. TALA's people are accounts; everybody else
 *  is a name. */
export type MeetingSide = "tala" | "client" | "third_party";

export const MEETING_SIDE_LABELS: Record<MeetingSide, Message> = {
  tala: { en: "TALA", id: "TALA" },
  client: { en: "Client", id: "Klien" },
  third_party: { en: "Third party", id: "Pihak ketiga" },
};

/** Attendees are recorded for these kinds only. */
export const MEETING_KINDS: readonly ActivityKind[] = ["meeting", "visit"];

export interface MeetingAttendeeInput {
  side: MeetingSide;
  /** TALA's side: the account. */
  user_id?: string | null;
  /** The client's or a third party's side: the name. */
  name?: string | null;
  role?: string | null;
}

export interface MeetingAttendee {
  id: string;
  activity_id: string;
  seq: number;
  side: MeetingSide;
  user_id: string | null;
  name: string;
  role: string | null;
}

/** A line of the minutes. A revision request and an action are work — open
 *  until closed; a decision and a note are only recorded. */
export type MeetingPointKind = "decision" | "revision" | "action" | "note";

export const MEETING_POINT_KINDS: { code: MeetingPointKind; label: Message; tone: "brand" | "amber" | "violet" | "slate" }[] = [
  { code: "decision", label: { en: "Decision", id: "Keputusan" }, tone: "brand" },
  { code: "revision", label: { en: "Revision request", id: "Permintaan revisi" }, tone: "amber" },
  { code: "action", label: { en: "Action", id: "Tindakan" }, tone: "violet" },
  { code: "note", label: { en: "Note", id: "Catatan" }, tone: "slate" },
];

export type MeetingPointState = "noted" | "open" | "overdue" | "done";

export interface MeetingPointInput {
  kind: MeetingPointKind;
  body: string;
  /** The design item it is about — one of the project's own (P4). */
  item_no?: string | null;
  /** Who does it. */
  owner_id?: string | null;
  due_on?: string | null;
}

/** `v_meeting_point`. Readable by the drafters as well as the sellers: a
 *  revision request is their work. */
export interface MeetingPointView {
  id: string;
  activity_id: string;
  seq: number;
  kind: MeetingPointKind;
  body: string;
  happened_on: string;
  project_code: string | null;
  project_name: string | null;
  item_no: string | null;
  item_name: string | null;
  owner_id: string | null;
  owner_name: string | null;
  due_on: string | null;
  state: MeetingPointState;
  closed_at: string | null;
  closed_by_name: string | null;
  closed_note: string | null;
  created_by_name: string | null;
  created_at: string;
}

export interface MeetingPointFilter {
  activity_id?: string;
  project_code?: string;
  item_no?: string;
  /** Only revision requests and actions still to be done. */
  open?: boolean;
}

/** A contact logged with its attendees and minutes at once. */
export interface MeetingInput extends ActivityInput {
  attendees?: MeetingAttendeeInput[];
  points?: MeetingPointInput[];
}

/** Somebody who can be named as attending for TALA. */
export interface MeetingPerson {
  id: string;
  full_name: string;
  email: string;
}

/** A contact as stored — `ops_procure.meeting_attendees`. */
export interface MeetingAttendeeRow {
  id: string;
  activity_id: string;
  seq: number;
  side: MeetingSide;
  user_id: string | null;
  name: string | null;
  role: string | null;
}

/** `ops_procure.meeting_points`. */
export interface MeetingPointRow {
  id: string;
  activity_id: string;
  project_id: string | null;
  happened_on: string;
  seq: number;
  kind: MeetingPointKind;
  body: string;
  design_item_id: string | null;
  owner_id: string | null;
  due_on: string | null;
  closed_at: string | null;
  closed_by: string | null;
  closed_note: string | null;
  created_by: string | null;
  created_at: string;
}
