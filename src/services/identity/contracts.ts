/** Identity contracts — cut to `docs/plan/02-database.md`, schema `core`.
 *
 *  Field names are snake_case on purpose: in Phase 2 these types are replaced
 *  by `supabase gen types typescript`, and the names have to match already or
 *  the swap stops being a swap.
 *
 *  Ids are `string` here and `uuid` in Phase 2. The demo uses readable ids so
 *  fixtures can be read by a human.
 */
import { bilingual, type Message } from "@/lib/i18n";

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
  /** The last leg: crates, surat jalan, installation, snags (0131). Its own
   *  module because the people who pack and fit are not the people who change
   *  a client's order — the BAST stays `project.handover`. */
  | "delivery"
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
  "marketing", "project", "production", "delivery", "it", "settings",
];

export const MODULE_LABELS: Record<ModuleName, Message> = {
  dashboard: { en: "Dashboard", id: "Dasbor" },
  hrd: { en: "HR", id: "SDM" },
  payroll: { en: "Payroll", id: "Penggajian" },
  procurement: { en: "Procurement", id: "Pengadaan" },
  inventory: { en: "Inventory", id: "Persediaan" },
  accounting: { en: "Accounting", id: "Akuntansi" },
  marketing: { en: "Marketing", id: "Pemasaran" },
  project: { en: "Projects", id: "Proyek" },
  production: { en: "Production", id: "Produksi" },
  delivery: { en: "Delivery", id: "Pengiriman" },
  it: { en: "IT", id: "IT" },
  settings: { en: "Settings", id: "Pengaturan" },
};
export const MODULE_LABEL = bilingual(MODULE_LABELS);

export const AUTHORITIES: Authority[] = [
  "approve_goods",
  "approve_funds",
  "approve_overtime",
  "post_ledger",
  "resolve_inbox",
];

export const AUTHORITY_LABELS: Record<Authority, Message> = {
  approve_goods: { en: "Approve goods (CEO)", id: "Menyetujui barang (CEO)" },
  approve_funds: { en: "Approve funds", id: "Menyetujui dana" },
  approve_overtime: { en: "Approve overtime (leadership)", id: "Menyetujui lembur (pimpinan)" },
  post_ledger: { en: "Post to the ledger", id: "Membukukan ke buku besar" },
  resolve_inbox: { en: "Resolve unparented documents", id: "Menautkan dokumen tanpa induk" },
};
export const AUTHORITY_LABEL = bilingual(AUTHORITY_LABELS);

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
 *  frontend `can()` reads — derived, never stored. Empty for an account that
 *  has been switched off, whatever it still holds (0183). */
export interface Session extends UserAccess {
  permissions: string[];
}

/* ── Managing people (D325) ───────────────────────────────────────────────
 *
 *  `/it/pengguna` granted modules and authorities from the start; these are
 *  the rest of an account — adding one, correcting a name, switching one off,
 *  sending a link to set a password.
 */

/** Three answers to the question IT asks of a row, derived on read (A3):
 *
 *  - `inactive` — switched off; holds nothing, whatever it still lists.
 *  - `pending`  — has never signed in. Invited and not arrived, or made by
 *                 hand and never used; the next step is a link, not a grant.
 *  - `active`   — everybody else. */
export type AccountStatus = "active" | "pending" | "inactive";

export const ACCOUNT_STATUS_LABELS: Record<AccountStatus, Message> = {
  active: { en: "Active", id: "Aktif" },
  pending: { en: "Not signed in yet", id: "Belum pernah masuk" },
  inactive: { en: "Switched off", id: "Nonaktif" },
};
export const ACCOUNT_STATUS_LABEL = bilingual(ACCOUNT_STATUS_LABELS);

/** One row of the IT directory: a session's shape plus the account's life,
 *  most of it read from GoTrue's own record rather than kept twice. */
export interface UserDirectoryRow extends Session {
  status: AccountStatus;
  created_at: string;
  invited_at: string | null;
  last_sign_in_at: string | null;
  left_on: string | null;
  /** GoTrue's ban, read rather than assumed: an account can be switched off
   *  here and still able to sign in, if the server had no key that day. */
  sign_in_blocked: boolean;
}

/** A link was sent: the invitation (again), or a recovery link. Which one is
 *  the database's choice, from whether the address was ever confirmed. */
export interface UserLinkSent {
  user_id: string;
  email: string;
  kind: "invite" | "recovery";
}

/** An account switched on or off, and what happened to its sign-in.
 *
 *  Two facts, because they can differ. `is_active` is ours and is what takes
 *  access away. `sign_in` is GoTrue's: `blocked`/`allowed` when the server
 *  applied it, `not_configured` when this deployment has no key to ask with,
 *  `failed` when GoTrue said no — and in the last two the screen says the
 *  person can still reach the sign-in page, and see nothing behind it. */
export interface UserActiveChange {
  user_id: string;
  is_active: boolean;
  sign_in: "blocked" | "allowed" | "not_configured" | "failed";
  sign_in_detail: string | null;
}

/** A password the server generated and GoTrue now holds (D329): a new
 *  account's first one, or a replacement. **Shown to IT once**, from this
 *  answer, and kept nowhere else — not in a table, the trail, the activity
 *  log or the browser's storage. */
export interface UserPasswordIssued {
  user_id: string;
  email: string;
  full_name: string;
  password: string;
  kind: "created" | "reset";
}

/** An address under `.local` is a username, not a mailbox (D329): the
 *  convention for people with no work email. Nothing is ever sent to it, so
 *  the screen offers a new password instead of a link. */
export function isUsernameOnly(email: string): boolean {
  return email.trim().toLowerCase().endsWith(".local");
}

/** Somebody a question can be addressed to, and the authority that makes them
 *  the right person for it.
 *
 *  **Not a `User`, on purpose.** It carries a name and an address and nothing
 *  else — no id, no modules, no other authority — because that is the whole of
 *  what `ops_core.approvers()` answers, and the shape is the contract: a screen
 *  that wanted more would have to widen the seam, where widening it is an
 *  argument about who may read the authority map rather than a field added in
 *  passing (0159).
 */
export interface Approver {
  email: string;
  full_name: string;
  authority: Authority;
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
 *  - the detail is kept **120 days** (D283, superseding D188's 30);
 *  - every day is rolled up into a **per-person recap**, kept **120 rows per
 *    person** — six months in the owner's own arithmetic, *6 bulan itu
 *    maksudnya 120 hari kerja*;
 *  - after that, both are gone.
 *
 *  The recap is counted **per person, not by date**, so somebody away for three
 *  weeks comes back to their history rather than to a hole.
 *
 *  The recap is **stored, not derived** — one of the two places in this system
 *  where that is right (the other is `activity_daily`, the machine record),
 *  because it has to outlive the rows it was computed from.
 */

/** One thing somebody did. Coarse on purpose: a screen opened, a document
 *  printed, a file exported. Keystroke-level detail would be surveillance
 *  nobody asked for. */
export interface ActivityEvent {
  id: string;
  at: string;
  actor_id: string;
  actor_email: string;
  /** `view`, `export`, `print`, `reveal`, `sign_in`, `sign_out`. */
  kind: string;
  /** The screen or object: `/hrd/payroll/pyr-26-09-06_01`. */
  target: string;
  /** A short human label, so a recap reads as sentences rather than paths. */
  label: string;
}

/** One of the reader's own rows in the profile screen's activity feed (W7).
 *
 *  Deliberately a narrower object than `ActivityEvent`, not the same one
 *  filtered: D190 refused a person their own row in the IT-grade trail —
 *  granular `view`/`export`/`print` telemetry stays closed, because seeing
 *  exactly what is logged is a way to learn exactly what is not. This is a
 *  different, safer object — the account's own security-relevant actions
 *  (signed in, changed a password, clocked in, asked for leave) — so there is
 *  no actor to name here; the actor is always the reader. */
export interface MyActivityEvent {
  id: string;
  at: string;
  /** `sign_in` · `sign_out` · `update` · `attendance_tap` ·
   *  `leave_requested` · `overtime_requested` · `task_acknowledged`. */
  kind: string;
  target: string;
  label: string;
}

/** One line in the reader's bell — `ops_core.notifications` (0215, D374).
 *
 *  Written by the database when something reaches this person, never by a
 *  screen: a task given to them, or a task handed over to HRD. `data` carries
 *  what the bell needs to say it in either language; `title` is the Indonesian
 *  sentence for a kind this screen does not know yet. */
export type NotificationKind = "task.assigned" | "task.delivered" | "task.github_pr";

export interface AppNotification {
  id: number;
  kind: NotificationKind | string;
  title: string;
  data: Record<string, unknown>;
  /** A path inside the app (`/profil?tab=tugas`), never a full URL. */
  link: string | null;
  entity_no: string | null;
  created_at: string;
  read_at: string | null;
}

/** One person, one day, in numbers. Written at the end of the day and kept
 *  120 working days per person — long after the events behind it are gone. */
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
  /** The two rules as the owner set them (Q22, D283). The first is a horizon
   *  in days; the second is a **count per person**, not a date. */
  detail_days: number;
  recap_rows: number;
  events_total: number;
  /** Events past the detail horizon: due to be deleted, and still here. */
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

export const SETTING_REACH_LABELS: Record<SettingReach, Message> = {
  display: { en: "Display only", id: "Tampilan saja" },
  forward: { en: "Applies going forward", id: "Berlaku ke depan" },
  retroactive: { en: "Changes past figures", id: "Mengubah angka lama" },
};
export const SETTING_REACH_LABEL = bilingual(SETTING_REACH_LABELS);

export type SettingKind = "text" | "number" | "choice";

export type SettingGroup = "identity" | "format" | "operations" | "retention";

export const SETTING_GROUP_LABELS: Record<SettingGroup, Message> = {
  identity: { en: "Identity", id: "Identitas" },
  format: { en: "Format & language", id: "Format & bahasa" },
  operations: { en: "Operational thresholds", id: "Ambang batas operasional" },
  retention: { en: "Time, retention, and rules not changed from here", id: "Waktu, retensi, dan aturan yang tidak diubah dari sini" },
};
export const SETTING_GROUP_LABEL = bilingual(SETTING_GROUP_LABELS);

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

/* ── GitHub (0226, D382) ──────────────────────────────────────────────── */

/** One line of IT's map: which GitHub login is which ops account. A PR moves
 *  a task only when its author's login is mapped to the task holder. */
export interface GithubAccount {
  /** Lower case, no `@`. */
  github_login: string;
  user_id: string;
  email: string;
  full_name: string;
  employee_no: string | null;
  linked_at: string;
  linked_by_name: string | null;
}

/** What one webhook delivery did, per task it named. `did` is one of
 *  `started` · `delivered` · `recorded` · `held_not_holder` · `held_unmapped`
 *  · `merged_not_default` · `task_already_done` · `task_already_cancelled`. */
export interface GithubPrOutcome {
  tasks: { task_no: string; did: string }[];
  /** Task numbers the PR named that do not exist. */
  unknown: string[];
}

export interface GithubDelivery {
  delivery_id: string;
  event: string;
  action: string | null;
  repo: string | null;
  pr_number: number | null;
  received_at: string;
  result: Partial<GithubPrOutcome> & { ignored?: string; author?: string; mapped?: boolean };
}

export interface GithubSyncError {
  task_no: string;
  title: string;
  error: string;
  attempts: number;
  at: string;
}

/** `/it/github`: is GitHub talking to us, and is the board up to date. */
export interface GithubStatus {
  accounts: number;
  last_delivery_at: string | null;
  deliveries: GithubDelivery[];
  linked_prs: number;
  items_synced: number;
  last_synced_at: string | null;
  sync_errors: GithubSyncError[];
}

/** A pretend `pull_request` webhook — the demo's way to walk the flow
 *  without GitHub. The live client refuses it: there, only GitHub's signed
 *  webhook reaches the seam. */
export interface GithubPrSimulation {
  action: "opened" | "closed";
  merged: boolean;
  repo: string;
  number: number;
  title: string;
  body: string;
  author: string;
  base: string;
  default_branch: string;
}
