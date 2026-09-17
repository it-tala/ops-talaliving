/** The access catalogue.
 *
 *  Access is TWO things, and conflating them is the bug this model exists to
 *  avoid (D24):
 *
 *  1. **Module grants** — which screens open, and how far you can go inside
 *     them. A user holds several: procurement + accounting + HR is normal
 *     (D23). Levels are `read` < `write` < `admin`.
 *
 *  2. **Authorities** — the handful of named decisions. Granted on their own,
 *     never implied by a module level. `approve_goods` belongs to the CEO
 *     alone (D19) whether or not anyone else can open Procurement.
 *
 *  Why they are separate: in `john-lau` the confirm button showed for anyone
 *  with `finance`, `director` or `it_admin`, and the bridge then refused it
 *  based on an environment variable the screen could not read. The user saw an
 *  enabled button and got a 403. Here the screen and the guard read the same
 *  grant.
 *
 *  This file is the SEED SOURCE, deliberately in code rather than as rows a
 *  human types: a fresh database can be bootstrapped without anyone guessing
 *  what should exist, and adding a module shows up as a reviewable diff. In
 *  Phase 2 it generates the migration; the database is what enforces.
 */
import type { ModuleName, ModuleLevel, Authority } from "@/services/identity/contracts";

export { MODULES, MODULE_LABEL, AUTHORITIES, AUTHORITY_LABEL } from "@/services/identity/contracts";
export type { ModuleName, ModuleLevel, Authority } from "@/services/identity/contracts";

/** What each module offers. **Access verbs only** — approving, posting and
 *  resolving are authorities and appear nowhere in this catalogue. */
export const PERMISSION_CATALOG: Record<ModuleName, readonly string[]> = {
  dashboard: ["read"],
  hrd: ["read", "create", "update"],
  payroll: ["read", "run"],
  procurement: ["read", "create", "update"],
  inventory: ["read", "create", "update", "adjust"],
  accounting: ["read", "create", "update", "plan_cash"],
  marketing: ["read", "create", "update"],
  project: ["read", "create", "update", "handover"],
  production: ["read", "create", "update", "schedule"],
  it: ["read", "update", "manage_users", "manage_roles", "purge_activity"],
  settings: ["read", "update"],
} as const;

/** Reserved for `admin`. Everything else a module offers comes with `write`.
 *
 *  `plan_cash` is here because of Q24 (D233): the estimates on the twelve-month
 *  cash calendar belong to leadership alone. Accounting keeps `write`, which is
 *  every other thing accounting does — reading the plan included, and booking
 *  the real payments that land against it. Moving the *estimate* is the one
 *  verb it does not carry. */
const ADMIN_ONLY = new Set(["manage_users", "manage_roles", "purge_activity", "plan_cash"]);

export const LEVELS: ModuleLevel[] = ["read", "write", "admin"];

export const LEVEL_LABEL: Record<ModuleLevel, string> = {
  read: "Read",
  write: "Read & edit",
  admin: "Full",
};

export interface ModuleGrant {
  module: ModuleName;
  level: ModuleLevel;
}

/** The flattened union a screen's `can()` reads. Derived on every call, never
 *  stored — the same rule the database follows for status (A3). */
export function expandPermissions(grants: readonly ModuleGrant[]): string[] {
  const out = new Set<string>();
  for (const g of grants) {
    const actions = PERMISSION_CATALOG[g.module] ?? [];
    for (const action of actions) {
      if (action === "read") { out.add(`${g.module}.read`); continue; }
      if (ADMIN_ONLY.has(action)) {
        if (g.level === "admin") out.add(`${g.module}.${action}`);
        continue;
      }
      if (g.level === "write" || g.level === "admin") out.add(`${g.module}.${action}`);
    }
  }
  return [...out];
}

/** Who may open the IT module at all — the owner's answer to Q22, kept as one
 *  sentence in one place so the screens that show it cannot drift from each
 *  other.
 *
 *  It is **stated, not enforced by a flag on the user**, and that is a choice:
 *  the only honest way to enforce it would be to decide in code who counts as
 *  leadership, and the two candidates for deriving that — holding
 *  `approve_funds` or `approve_goods` — are exactly what D24 forbids. A
 *  stand-in appointed to approve payments for a week would silently gain the
 *  right to read everyone's activity log. So the grant remains the only door,
 *  and this sentence sits beside it where the grant is made.
 *
 *  What *is* enforced is the verb the owner used: **baca**. Leadership holds
 *  `it: read` and administration stays at `admin` — see `requireLevel`.
 */
export const IT_ACCESS_RULE =
  "Modul IT hanya boleh dibuka IT dan pimpinan. Pimpinan membaca (read); mengelola pengguna, peran, dan menghapus log aktivitas tetap di IT (admin).";

export function hasPermission(permissions: readonly string[], code?: string): boolean {
  if (!code) return true;
  return permissions.includes(code);
}

/** What a grant unlocks, in words, for the grant picker.
 *
 *  Derived from `expandPermissions` rather than described separately, so the
 *  sentence a person reads and the permissions they actually get cannot say
 *  different things. Written for the person choosing, not the developer.
 */
const VERB_LABEL: Record<string, string> = {
  create: "create",
  update: "edit",
  adjust: "adjust stock",
  schedule: "schedule",
  run: "run payroll",
  handover: "hand over",
  manage_users: "manage users",
  manage_roles: "manage roles",
  purge_activity: "purge the activity log",
  plan_cash: "set the cash estimates",
};

export function describeGrant(module: ModuleName, level: ModuleLevel): string {
  const verbs = expandPermissions([{ module, level }])
    .map((p) => p.slice(p.indexOf(".") + 1))
    .filter((a) => a !== "read")
    .map((a) => VERB_LABEL[a] ?? a);
  if (verbs.length === 0) return "View only";
  if (verbs.length === 1) return `View and ${verbs[0]}`;
  return `View, ${verbs.slice(0, -1).join(", ")} and ${verbs[verbs.length - 1]}`;
}
