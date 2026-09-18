/** Implements `/api/v1/identity` against the database.
 *
 *  Same names and same signatures as `src/demo/api/identity.ts` — that is the
 *  whole swap — with one function missing on purpose.
 *
 *  **`actAs` is gone.** In the demo it switches which person is acting so that
 *  permissions can be shown working rather than described; against a real
 *  database it would be an endpoint that lets anybody become anybody, which is
 *  not a feature with a guard missing, it is the absence of authentication. Who
 *  is acting now comes from Supabase Auth and from nowhere else. The persona
 *  picker keeps working in demo mode, where there is nothing to impersonate.
 */
import type {
  Session, Authority, ModuleName, ModuleLevel, ModuleGrant, AuditRowView,
} from "@/services/identity/contracts";
import { supabaseBrowser } from "@/lib/supabase/client";
import { fail, fromRows, fromSeam, notFound, ok, type Result } from "./_kit";

const SERVICE = "identity" as const;

/** The row shape of `core.v_my_access` / `core.v_user_access`. `permissions` is
 *  expanded in the view, on read, never stored (A3, C3) — so this is a mapping
 *  of names, not a computation. If it were a computation, the frontend's `can()`
 *  and the database's `has_permission()` could disagree, which is the bug the
 *  whole access model exists to prevent. */
interface AccessRow {
  id: string;
  email: string;
  full_name: string;
  is_active: boolean;
  modules: ModuleGrant[];
  authorities: Authority[];
  permissions: string[];
}

function toSession(row: AccessRow): Session {
  return {
    user: {
      id: row.id, email: row.email,
      full_name: row.full_name, is_active: row.is_active,
    },
    modules: row.modules ?? [],
    authorities: row.authorities ?? [],
    permissions: row.permissions ?? [],
  };
}

/** `GET /identity/me`.
 *
 *  Returns 401 through `notFound`'s sibling when nobody is signed in — the
 *  screens already branch on the envelope, so an unauthenticated read is an
 *  answer rather than a thrown error that takes the page down.
 */
export async function me(): Promise<Result<Session>> {
  const sb = supabaseBrowser();
  const { data, error } = await sb.from("v_my_access").select("*").maybeSingle();
  if (error) return fail(SERVICE, error);
  if (!data) {
    /* Authenticated by Supabase and unknown to `core.users`. Provisioning in
       `0007` makes this close to impossible, and "close to" is why it is
       handled: a 500 here would be a blank screen with nothing to act on. */
    return notFound(SERVICE, "no_profile",
      "You are signed in, but this workspace has no profile for your account. Ask IT.");
  }
  return ok(SERVICE, toSession(data as AccessRow));
}

/** Record the sign-in, once, after Supabase hands back a session.
 *
 *  An access trail with no session events cannot answer "who was in the system
 *  at the time", which is usually the first question anybody asks it. Called by
 *  the sign-in screen; failure is logged and swallowed, because a person who
 *  authenticated correctly must not be turned away by a missing audit row.
 */
export async function recordSignIn(): Promise<void> {
  const sb = supabaseBrowser();
  const { error } = await sb.rpc("record_sign_in");
  if (error) console.warn("sign-in not recorded:", error.message);
}

export async function listUsers(): Promise<Result<Session[]>> {
  const sb = supabaseBrowser();
  const { data, error } = await sb.from("v_user_access").select("*").order("full_name");
  if (error) return fail(SERVICE, error);
  return ok(SERVICE, (data as AccessRow[]).map(toSession));
}

/** `it.manage_roles`, and never self-service. Both refusals are the database's
 *  (`core.set_modules`), which is the point: this function cannot be the place
 *  the rule is enforced, because a second caller would then have to remember
 *  it. */
export async function setModules(
  userId: string,
  modules: { module: ModuleName; level: ModuleLevel }[],
): Promise<Result<Session>> {
  const sb = supabaseBrowser();
  const { data, error } = await sb.rpc("set_modules", {
    p_user_id: userId,
    p_modules: modules,
  });
  const res = fromSeam<unknown>(SERVICE, data, error);
  if (res.error) return res;
  return readBack(userId);
}

export async function setAuthorities(
  userId: string,
  authorities: Authority[],
): Promise<Result<Session>> {
  const sb = supabaseBrowser();
  const { data, error } = await sb.rpc("set_authorities", {
    p_user_id: userId,
    p_authorities: authorities,
  });
  const res = fromSeam<unknown>(SERVICE, data, error);
  if (res.error) return res;
  return readBack(userId);
}

/** The seam returns what it wrote; the screen wants the whole session, with
 *  `permissions` expanded. Reading it back through the view rather than
 *  rebuilding it here keeps one definition of what a grant unlocks. */
async function readBack(userId: string): Promise<Result<Session>> {
  const sb = supabaseBrowser();
  const { data, error } = await sb
    .from("v_user_access").select("*").eq("id", userId).maybeSingle();
  if (error) return fail(SERVICE, error);
  if (!data) return notFound(SERVICE, "user_not_found", "User not found.");
  return ok(SERVICE, toSession(data as AccessRow));
}

/* ------------------------------------------------------------------ */
/* The trail                                                           */
/* ------------------------------------------------------------------ */

/** `GET /identity/audit`. Every filter is applied by the database.
 *
 *  The demo filters an array it already holds; doing the same here would mean
 *  fetching the whole trail to show three rows of it. These are the same five
 *  filters the screen offers, pushed down to `ops_core.v_audit` — and the
 *  refusal for somebody without `it.read` is the base table's policy, not a
 *  check repeated here. This function cannot be where that rule lives, because
 *  a second caller would then have to remember it.
 *
 *  `entity_no` and `actor` match on a substring, case-insensitively, because
 *  that is what the boxes above them do: somebody types `pr-26` or part of an
 *  address, not an exact key.
 */
export async function listAudit(
  opts: {
    entity_no?: string; actor?: string; outcome?: string;
    action?: string; service?: string; limit?: number;
  } = {},
): Promise<Result<AuditRowView[]>> {
  const sb = supabaseBrowser();
  let q = sb.from("v_audit").select("*");

  if (opts.entity_no) q = q.ilike("entity_no", `%${opts.entity_no}%`);
  if (opts.actor) q = q.ilike("actor_email", `%${opts.actor}%`);
  if (opts.outcome) q = q.eq("outcome", opts.outcome);
  if (opts.action) q = q.eq("action", opts.action);
  if (opts.service) q = q.eq("service", opts.service);

  /* Newest first, and capped. The same 300 the demo settles on: a trail is
     read by scrolling back from now, never by paging to the beginning. */
  const { data, error } = await q
    .order("at", { ascending: false })
    .limit(opts.limit ?? 300);

  return fromRows<AuditRowView[]>(SERVICE, data as AuditRowView[] | null, error);
}

/* ------------------------------------------------------------------ */
/* Sessions                                                            */
/* ------------------------------------------------------------------ */

/** Sign in with an email and a password.
 *
 *  Kept in this module rather than in a screen because the audit row belongs
 *  with it: a sign-in that is not recorded is a sign-in nobody can ask about,
 *  and leaving that call to whoever writes the form is leaving it to be
 *  forgotten.
 */
export async function signIn(email: string, password: string): Promise<Result<Session>> {
  const sb = supabaseBrowser();
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) {
    /* Deliberately the same message for a wrong password and an unknown
       address. Telling them apart tells somebody probing which addresses are
       real, and it helps nobody who genuinely mistyped. */
    return {
      error: {
        code: "sign_in_failed",
        message: "That email and password do not match an account here.",
        outcome: "refused",
        status: 401,
      },
      meta: { request_id: "", service: SERVICE, version: "1", outcome: "refused" },
    };
  }
  await recordSignIn();
  return me();
}

export async function signOut(): Promise<Result<null>> {
  const sb = supabaseBrowser();
  const { error } = await sb.auth.signOut();
  if (error) return fail(SERVICE, error);
  return ok(SERVICE, null);
}
