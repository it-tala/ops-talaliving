/** The response envelope every service speaks.
 *
 *  Defined once, in `_shared`, because `03-api.md` makes it the contract that
 *  survives Phase 2: today `src/demo/api/*` produces these values from a
 *  browser store, later a `fetch` produces them from Postgres. A screen that
 *  handles this shape handles both.
 *
 *  `outcome` is the part that matters. §2.2 of the recap records a run of
 *  incidents where a refused button reported success, a stuck claim made a row
 *  unbookable, and a sweep discarded documents without a word. The rule that
 *  came out of it was an explicit outcome on every answer — so it lives in the
 *  envelope, where it cannot be forgotten.
 */

export type Outcome = "ok" | "refused" | "duplicate" | "noop";

export type ServiceName =
  | "identity"
  | "procurement"
  | "accounting"
  /** The sixth service (D136). Kept out of `identity` deliberately: one says
   *  who may open a screen, the other says what somebody is owed. */
  | "hr"
  /** The seventh (D148): what is being made, how far it got, and by when.
   *  Overtime references it by work-order number at the seam, never by
   *  reaching into its tables (ADR-004). */
  | "production"
  /** The eighth (D153): timber bought as logs, used as boards, and the gap
   *  between the two that no invoice shows. */
  | "inventory"
  /** The ninth (D183): the Package programme. Recruiting agents who introduce
   *  condo owners, and then working with the ones who agreed — two funnels
   *  joined at the point where an agent becomes a representative. */
  | "marketing"
  | "documents"
  | "events";

export interface Page {
  limit: number;
  cursor: string | null;
  has_more: boolean;
  /** How many rows there are in total, so a screen can say "page 2 of 9"
   *  rather than "next" into the dark. */
  total: number;
}

export interface Meta {
  request_id: string;
  service: ServiceName;
  version: "1";
  outcome: Outcome;
  page?: Page;
}

/** HTTP status is carried in the value so the demo layer and a real fetch
 *  client can be handled by the same code. */
export interface ApiError {
  code: string;
  message: string;
  outcome: Exclude<Outcome, "ok">;
  status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500;
  detail?: Record<string, unknown>;
}

export interface Ok<T> {
  data: T;
  meta: Meta;
  error?: undefined;
}

export interface Err {
  data?: undefined;
  error: ApiError;
  meta: Meta;
}

export type Result<T> = Ok<T> | Err;

export function isOk<T>(r: Result<T>): r is Ok<T> {
  return r.error === undefined;
}

let counter = 0;
export function requestId(): string {
  counter += 1;
  return `req_${Date.now().toString(36)}${counter.toString(36).padStart(3, "0")}`;
}

function meta(service: ServiceName, outcome: Outcome, page?: Page): Meta {
  return { request_id: requestId(), service, version: "1", outcome, page };
}

export function ok<T>(service: ServiceName, data: T, page?: Page): Ok<T> {
  return { data, meta: meta(service, "ok", page) };
}

/** Nothing needed doing. Not an error — `/rounds/sync` with nothing to roll up
 *  is a successful no-op, and saying so is better than a silent 200. */
export function noop<T>(service: ServiceName, data: T): Ok<T> {
  return { data, meta: meta(service, "noop") };
}

/** A replay of an idempotent call: the original answer, marked. */
export function replay<T>(service: ServiceName, data: T): Ok<T> {
  return { data, meta: meta(service, "duplicate") };
}

function err(
  service: ServiceName,
  status: ApiError["status"],
  outcome: Exclude<Outcome, "ok">,
  code: string,
  message: string,
  detail?: Record<string, unknown>,
): Err {
  return { error: { code, message, outcome, status, detail }, meta: meta(service, outcome) };
}

/** 403 — signed in, but this decision is not yours. The message names who it
 *  belongs to, because "Forbidden" tells a person nothing (A7). */
export function refused(
  service: ServiceName,
  code: string,
  message: string,
  detail?: Record<string, unknown>,
): Err {
  return err(service, 403, "refused", code, message, detail);
}

/** 409 — already decided, already posted, slot taken. The client must NOT
 *  release its idempotency claim on this. */
export function conflict(
  service: ServiceName,
  code: string,
  message: string,
  detail?: Record<string, unknown>,
): Err {
  return err(service, 409, "duplicate", code, message, detail);
}

/** 422 — the values are wrong. Field errors go in `detail`. */
export function invalid(
  service: ServiceName,
  code: string,
  message: string,
  detail?: Record<string, unknown>,
): Err {
  return err(service, 422, "refused", code, message, detail);
}

export function notFound(service: ServiceName, code: string, message: string): Err {
  return err(service, 404, "refused", code, message);
}

export function unauthenticated(service: ServiceName): Err {
  return err(service, 401, "refused", "not_signed_in", "Please sign in first.");
}
