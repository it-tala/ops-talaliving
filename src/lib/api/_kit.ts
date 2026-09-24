/** Shared machinery for the real services.
 *
 *  The twin of `src/demo/api/_kit.ts`, and deliberately the same shape: the
 *  screens handle one envelope, so both implementations have to produce it. The
 *  difference is where the refusal comes from. In the demo a function checks an
 *  array and decides; here the **database** decides, and this file's only job is
 *  to carry its answer across without inventing anything.
 *
 *  Three kinds of answer arrive, and all three land on `Result<T>`:
 *
 *  1. **A seam's envelope.** Every `security definer` function in the ladder
 *     returns `{outcome, status, data, error}` — built by `core.say()` in
 *     `0003_core_audit.sql`. Rule 4: refusals are values, not exceptions. It is
 *     already the right shape; `fromSeam` unwraps it.
 *  2. **A PostgREST error.** A select that RLS refused, a unique index that
 *     fired, a check constraint. These arrive as `PostgrestError` and are
 *     mapped below, by SQLSTATE.
 *  3. **Rows.** A view answered. `fromRows` wraps them.
 */
import { stripRefs } from "@/lib/refs";
import {
  ok, refused, conflict, invalid, notFound, replay, noop,
  type Result, type ServiceName,
} from "@/services/_shared/envelope";

export { ok, refused, conflict, invalid, notFound, replay, noop };
export type { Result, ServiceName };

/** What PostgREST hands back when the database says no. Declared structurally
 *  rather than imported so this file does not depend on the SDK's type surface
 *  staying still across a minor version. */
export interface PostgrestLikeError {
  code?: string | null;
  message: string;
  details?: string | null;
  hint?: string | null;
}

/** The envelope a seam returns, as it comes off `rpc()`. */
interface SeamEnvelope {
  outcome?: "ok" | "refused" | "duplicate" | "noop";
  status?: number;
  data?: unknown;
  error?: {
    code?: string;
    message?: string;
    status?: number;
    detail?: Record<string, unknown>;
  };
}

/** SQLSTATE → the envelope's status, for errors that never reached a seam.
 *
 *  Only the codes the schema actually produces are listed. A code nobody has
 *  thought about becomes a 500, which is the honest answer — mapping the
 *  unknown onto 422 would tell a person their input was wrong when the truth is
 *  that something broke.
 */
export function fail(service: ServiceName, e: PostgrestLikeError): Result<never> {
  const code = e.code ?? "";
  switch (code) {
    /* insufficient_privilege, and PostgREST's own code for a row that RLS
       refused to return or to write. The database refused; say so as 403 and
       keep the message, which names what was required. */
    case "42501":
    case "PGRST301":
      return refused(service, "not_permitted", stripRefs(e.message), { sqlstate: code });

    /* unique_violation. Already there — and the client must keep its
       idempotency claim, because the thing it asked for has happened. */
    case "23505":
      return conflict(service, "already_exists", stripRefs(e.message), { sqlstate: code });

    /* foreign_key_violation and check_violation are the schema saying the
       values are wrong: a vendor that does not exist, a quantity below zero. */
    case "23503":
    case "23514":
    case "23502":  // not_null_violation
      return invalid(service, "constraint", stripRefs(e.message), {
        sqlstate: code, detail: e.details ?? undefined,
      });

    /* PGRST116: "JSON object requested, multiple (or no) rows returned" — a
       `.single()` that found nothing. */
    case "P0002":
    case "PGRST116":
      return notFound(service, "not_found", stripRefs(e.message));

    default:
      return {
        error: {
          code: code || "database_error",
          message: stripRefs(e.message),
          outcome: "refused",
          status: 500,
          detail: { sqlstate: code, hint: e.hint ?? undefined },
        },
        meta: { request_id: "", service, version: "1", outcome: "refused" },
      };
  }
}

/** Unwrap what a seam returned into the envelope the screens read.
 *
 *  The seam has already decided, already written its audit row and already
 *  chosen a status. Nothing here second-guesses it: a refusal stays a refusal
 *  with the database's own wording, because that wording names who the decision
 *  belongs to and a generic "Forbidden" does not (A7).
 */
export function fromSeam<T>(
  service: ServiceName,
  payload: unknown,
  error: PostgrestLikeError | null,
): Result<T> {
  /* A seam that raised rather than returned — the bootstrap function, or a
     genuine fault. Mapped by SQLSTATE like any other database error. */
  if (error) return fail(service, error);

  const env = (payload ?? {}) as SeamEnvelope;

  if (env.outcome === "ok") return ok(service, env.data as T);
  if (env.outcome === "noop") return noop(service, env.data as T);

  if (env.outcome === "duplicate") {
    /* Two different things wear this outcome, and telling them apart matters:
       a 409 is "somebody already did this, keep your claim", while a replay is
       "you already did this, here is the same answer again". */
    if (env.status === 200) return replay(service, env.data as T);
    return conflict(
      service,
      env.error?.code ?? "duplicate",
      stripRefs(env.error?.message) ?? "This has already been done.",
      env.error?.detail,
    );
  }

  if (env.outcome === "refused") {
    const status = env.error?.status ?? env.status ?? 403;
    const code = env.error?.code ?? "refused";
    const message = stripRefs(env.error?.message) ?? "Refused.";
    if (status === 404) return notFound(service, code, message);
    if (status === 422) return invalid(service, code, message, env.error?.detail);
    return refused(service, code, message, env.error?.detail);
  }

  /* No outcome at all. A seam that answers in a shape this file does not know
     is a bug in the seam, and reporting it as a 500 is right: pretending it
     succeeded would let a write that may not have happened look like one that
     did. */
  return {
    error: {
      code: "malformed_envelope",
      message: "The database answered in a shape this client does not recognise.",
      outcome: "refused",
      status: 500,
      detail: { payload },
    },
    meta: { request_id: "", service, version: "1", outcome: "refused" },
  };
}

/** A view answered. */
export function fromRows<T>(
  service: ServiceName,
  rows: T | null,
  error: PostgrestLikeError | null,
): Result<T> {
  if (error) return fail(service, error);
  return ok(service, rows as T);
}

/** A paged view answered. `count` comes from PostgREST's `count: "exact"`, so
 *  a screen can say "page 2 of 9" rather than "next" into the dark. */
export function fromPage<T>(
  service: ServiceName,
  rows: T[] | null,
  count: number | null,
  error: PostgrestLikeError | null,
  limit: number,
  offset: number,
): Result<T[]> {
  if (error) return fail(service, error);
  const list = rows ?? [];
  const total = count ?? list.length;
  const more = offset + limit < total;
  return ok(service, list, {
    limit,
    cursor: more ? String(offset + limit) : null,
    has_more: more,
    total,
  });
}
