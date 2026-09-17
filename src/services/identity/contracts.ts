/** Identity contracts — cut to `docs/plan/02-database.md`, schema `core`.
 *
 *  Field names are snake_case on purpose: in Phase 2 these types are replaced
 *  by `supabase gen types typescript`, and the names have to match already or
 *  the swap stops being a swap.
 *
 *  Ids are `string` here and `uuid` in Phase 2. The demo uses readable ids so
 *  fixtures can be read by a human.
 */

/** Access is two separate things (D22–D24). Modules say which screens open.
 *
 *  This union is the definition; `src/lib/roles.ts` types its catalogue against
 *  it, so the two cannot drift without a compile error. In Phase 2 it becomes a
 *  Postgres enum and this file is generated from it. */
export type ModuleName =
  | "dashboard"
  | "hrd"
  | "payroll"
  | "procurement"
  | "inventory"
  | "accounting"
  | "marketing"
  | "project"
  | "production"
  | "it"
  | "settings";

export type ModuleLevel = "read" | "write" | "admin";

/** Authorities say which decisions you may take. Granted on their own, never
 *  implied by a module level — fusing the two is how `john-lau` ended up
 *  showing a confirm button the bridge then refused. */
export type Authority =
  | "approve_goods"
  | "approve_funds"
  /** Leadership's yes to overtime, after HRD has checked the hours and the
   *  surat lembur is attached (D145). Its own authority rather than a reuse of
   *  `approve_goods`: approving that a table arrived and approving that a man
   *  is paid for four extra hours are different decisions, and the people who
   *  should hold them will not always be the same. */
  | "approve_overtime"
  | "post_ledger"
  | "resolve_inbox";

export const MODULES: ModuleName[] = [
  "dashboard", "hrd", "payroll", "procurement", "inventory", "accounting",
  "marketing", "project", "production", "it", "settings",
];

export const MODULE_LABEL: Record<ModuleName, string> = {
  dashboard: "Dashboard",
  hrd: "HR",
  payroll: "Payroll",
  procurement: "Procurement",
  inventory: "Inventory",
  accounting: "Accounting",
  marketing: "Marketing",
  project: "Projects",
  production: "Production",
  it: "IT",
  settings: "Settings",
};

export const AUTHORITIES: Authority[] = [
  "approve_goods",
  "approve_funds",
  "approve_overtime",
  "post_ledger",
  "resolve_inbox",
];

export const AUTHORITY_LABEL: Record<Authority, string> = {
  approve_goods: "Approve goods (CEO)",
  approve_funds: "Approve funds",
  approve_overtime: "Approve overtime (leadership)",
  post_ledger: "Post to the ledger",
  resolve_inbox: "Resolve unparented documents",
};

export interface User {
  id: string;
  email: string;
  full_name: string;
  is_active: boolean;
}

export interface ModuleGrant {
  module: ModuleName;
  level: ModuleLevel;
}

export interface UserAccess {
  user: User;
  modules: ModuleGrant[];
  authorities: Authority[];
}

/** What `GET /identity/me` returns. `permissions` is the flattened union the
 *  frontend `can()` reads — derived, never stored. */
export interface Session extends UserAccess {
  permissions: string[];
}

/* Permission expansion lives in `src/lib/roles.ts`, which owns the catalogue
 * of what each module actually offers. Keeping it there means the list a human
 * reviews and the list the code expands are the same list. */


/* ── What people did: the audit trail, and the activity log ───────────────
 *
 *  Two different questions, deliberately two different records (D188).
 *
 *  **Audit** answers *what happened to this row* — who approved it, what the
 *  amount was before and after, which refusal was logged and why. It is
 *  evidence about **records**, it is written by every mutation in the system,
 *  and it is never deleted (A5, D84).
 *
 *  **Activity** answers *what did this person do today* — which screens they
 *  opened, what they looked at. It is evidence about **people**, and that is
 *  why it does not live for ever (owner, answering Q22):
 *
 *  - the detail is kept **30 days**;
 *  - every day is rolled up into a **per-person recap**, kept **6 months**;
 *  - after that, both are gone.
 *
 *  The recap is **stored, not derived** — the one place in this system where
 *  that is right, because it has to outlive the rows it was computed from.
 */

/** One thing somebody did. Coarse on purpose: a screen opened, a document
 *  printed, a file exported. Keystroke-level detail would be surveillance
 *  nobody asked for. */
export interface ActivityEvent {
  id: string;
  at: string;
  actor_id: string;
  actor_email: string;
  /** `view`, `export`, `print`, `sign_in`, `sign_out`. */
  kind: string;
  /** The screen or object: `/hrd/payroll/pyr-26-09-06_01`. */
  target: string;
  /** A short human label, so a recap reads as sentences rather than paths. */
  label: string;
}

/** One person, one day, in numbers. Written at the end of the day and kept
 *  six months — long after the events behind it are gone. */
export interface ActivityDaily {
  id: string;
  day: string;
  actor_id: string;
  actor_email: string;
  full_name: string;
  events: number;
  /** First and last thing they did, in office time. */
  first_at: string | null;
  last_at: string | null;
  /** The screens they spent the day in, most-used first. */
  top_screens: { label: string; count: number }[];
  /** How many of their acts changed something, taken from the audit trail —
   *  the difference between a day of reading and a day of deciding. */
  changes: number;
  /** Refusals they ran into. A person hitting three 403s in a day is either
   *  missing a grant or doing somebody else's job. */
  refusals: number;
  /** Identity numbers they opened — a KTP, a KK, an NPWP, a BPJS number.
   *
   *  Counted **apart from `changes`**, because a reveal changes nothing and
   *  folding it in would have quietly inflated every recap the day the eye
   *  button shipped (D197). It is also the number worth looking at on its own:
   *  one is somebody doing their job, fourteen in an afternoon is a question. */
  reveals: number;
}

export interface RetentionStatus {
  /** The two rules, in days, as the owner set them (Q22). */
  detail_days: number;
  recap_months: number;
  events_total: number;
  /** Events past the 30-day line: due to be deleted, and still here. */
  events_expiring: number;
  oldest_event: string | null;
  recaps_total: number;
  recaps_expiring: number;
  oldest_recap: string | null;
  /** Days that have events but no recap yet — the gap that would lose the day
   *  entirely once its events expire. */
  days_unrolled: number;
}

export interface AuditRowView {
  id: string;
  at: string;
  actor_email: string;
  service: string;
  entity: string;
  entity_no: string;
  action: string;
  outcome: "ok" | "refused" | "duplicate" | "noop";
  reason: string | null;
  detail: Record<string, unknown> | null;
}


/* ── Settings: the numbers somebody might think are theirs to change ──────
 *
 *  A settings screen is usually a drawer of knobs. This one is an **inventory
 *  with a straight answer attached to each entry**, because the interesting
 *  question about a setting is not what it does — it is *what it does to
 *  figures that already exist* (D214).
 *
 *  Three reaches, and the third is why this screen is shaped the way it is:
 *
 *  - `display` — only how something is shown. Change it freely.
 *  - `forward` — only things that happen after the change. Change it freely.
 *  - `retroactive` — **figures already printed, already paid against, already
 *    argued over, read differently afterwards.** A free-text box for one of
 *    these is how a payslip from March quietly becomes a different payslip.
 *
 *  Retroactive settings are shown here, with what would move, and changed
 *  somewhere that can handle a version — or not changed at all, with the
 *  reason said out loud. A settings page that hides the distinction is worse
 *  than one that does not exist, because it makes the dangerous change look
 *  exactly like the safe one.
 */
export type SettingReach = "display" | "forward" | "retroactive";

export const SETTING_REACH_LABEL: Record<SettingReach, string> = {
  display: "Tampilan saja",
  forward: "Berlaku ke depan",
  retroactive: "Mengubah angka lama",
};

export type SettingKind = "text" | "number" | "choice";

export type SettingGroup = "identity" | "format" | "operations" | "retention";

export const SETTING_GROUP_LABEL: Record<SettingGroup, string> = {
  identity: "Identitas",
  format: "Format & bahasa",
  operations: "Ambang batas operasional",
  retention: "Waktu, retensi, dan aturan yang tidak diubah dari sini",
};

export interface AppSetting {
  key: string;
  group: SettingGroup;
  label: string;
  /** What it does, in one sentence somebody who is not a developer can act on. */
  help: string;
  kind: SettingKind;
  value: string;
  default_value: string;
  unit: string | null;
  choices: string[] | null;
  reach: SettingReach;
  /** **Null means editable here.** Otherwise a sentence saying why not — and
   *  it is always a reason about the data, never "ask IT". */
  locked_reason: string | null;
  /** Where the change is actually made, when it is made somewhere else. */
  managed_at: string | null;
  /** What it would move, for a retroactive one. Empty for the rest. */
  affects: string[];
  updated_by: string | null;
  updated_at: string | null;
}
