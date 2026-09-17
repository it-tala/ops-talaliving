/** Shared machinery for the demo services.
 *
 *  Three things here are not conveniences, they are the contract:
 *  latency, so pending states get exercised; idempotency, so a double tap on a
 *  slow phone is one decision; and authority checks, so a refusal is a real
 *  refusal rather than a screen that quietly succeeds.
 */
import {
  ok, refused, conflict, replay, type Result, type ServiceName,
} from "@/services/_shared/envelope";
import type { Authority, ModuleLevel } from "@/services/identity/contracts";
import { getState, apply } from "../store";
import type { DemoState, DemoUser } from "../state";

/** 150–400 ms. Long enough that a disabled button and a spinner are real, short
 *  enough that walking the flow on a phone is not a chore. */
export function latency(): Promise<void> {
  const ms = 150 + Math.floor(Math.random() * 250);
  return new Promise((r) => setTimeout(r, ms));
}

export function actingUser(state: DemoState = getState()): DemoUser {
  const found = state.users.find((u) => u.id === state.session_user_id);
  if (!found) throw new Error("demo session user missing");
  return found;
}

const AUTHORITY_HOLDER: Record<Authority, string> = {
  approve_goods: "the CEO",
  approve_funds: "Finance",
  approve_overtime: "leadership",
  post_ledger: "Accounting",
  resolve_inbox: "Accounting",
};

/** 403 with a message that names who *may* act. "Forbidden" tells a person
 *  nothing; this tells them who to ask (A7). */
export function requireAuthority(service: ServiceName, authority: Authority) {
  const user = actingUser();
  if (user.authorities.includes(authority)) return null;
  return refused(
    service,
    "authority_required",
    `This decision belongs to ${AUTHORITY_HOLDER[authority]} — logged, not applied.`,
    { required: authority, acting_as: user.email },
  );
}

/** The same check, but at a level.
 *
 *  `requireModule` asks only whether a door is open at all, which is the right
 *  question almost everywhere. It is the wrong one for the IT module: the
 *  owner's answer to Q22 is that **IT and leadership may read it** — read, not
 *  administer. Leadership holding `it: read` must not be able to purge the
 *  activity log because the guard never looked past the module name.
 */
export function requireLevel(service: ServiceName, module: string, level: ModuleLevel) {
  const user = actingUser();
  const held = user.modules.find((m) => m.module === module);
  const rank = { read: 0, write: 1, admin: 2 } as const;
  if (held && rank[held.level] >= rank[level]) return null;
  return refused(
    service,
    held ? "level_required" : "module_required",
    held
      ? `This needs ${level} access to ${module}; your account has ${held.level}.`
      : `Your account has no access to the ${module} module.`,
    { required: module, required_level: level, held: held?.level ?? null, acting_as: user.email },
  );
}

export function requireModule(service: ServiceName, module: string) {
  const user = actingUser();
  if (user.modules.some((m) => m.module === module)) return null;
  return refused(
    service,
    "module_required",
    `Your account has no access to the ${module} module.`,
    { required: module, acting_as: user.email },
  );
}

/** A repeat with the same key returns the first answer, marked `duplicate`,
 *  and changes nothing. The UI makes the key when a form opens, not when it is
 *  submitted, so a double tap is one decision — `card_clicks` dedupe in API
 *  form, after three real twin-card incidents. */
export function replayed<T>(service: ServiceName, endpoint: string, key: string | undefined): Result<T> | null {
  if (!key) return null;
  const stored = getState().idempotency[`${service}:${endpoint}:${key}`];
  return stored === undefined ? null : replay(service, stored as T);
}

export function remember(service: ServiceName, endpoint: string, key: string | undefined, value: unknown) {
  if (!key) return;
  apply((draft) => {
    draft.idempotency[`${service}:${endpoint}:${key}`] = value;
  });
}

export function paged<T>(service: ServiceName, rows: T[], limit = 50, offset = 0) {
  const slice = rows.slice(offset, offset + limit);
  return ok(service, slice, {
    limit,
    cursor: offset + limit < rows.length ? String(offset + limit) : null,
    has_more: offset + limit < rows.length,
    total: rows.length,
  });
}

export { ok, refused, conflict };
