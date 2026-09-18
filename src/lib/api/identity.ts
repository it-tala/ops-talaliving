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
  ActivityEvent, ActivityDaily, RetentionStatus,
} from "@/services/identity/contracts";
import { supabaseBrowser } from "@/lib/supabase/client";
import { fail, fromRows, fromSeam, invalid, notFound, ok, type Result } from "./_kit";

const SERVICE = "identity" as const;

/** Every object this module reads or calls lives in `ops_core`, and PostgREST
 *  has to be told so on **every request**.
 *
 *  `.from("x")` and `.rpc("y")` resolve against the schema the request names —
 *  its `Accept-Profile` / `Content-Profile` header. With none, PostgREST uses
 *  the first of its exposed schemas, which is `public`, and ours holds nothing.
 *  The symptom is exact, and was seen in production: *Could not find the table
 *  'public.v_my_access' in the schema cache*.
 *
 *  **Supabase's "Extra search path" does not fix this, and believing it did cost
 *  a deploy.** That setting adds schemas to the search_path so objects *inside*
 *  an exposed schema can reference them unqualified; PostgREST is explicit that
 *  those schemas get no API endpoints of their own. Exposing a schema says it
 *  may be addressed; naming it on the request is what addresses it.
 *
 *  `.schema()` rather than a second client: a client per schema is an auth
 *  listener and a token-refresh timer per schema, and those racing is how a
 *  session appears to end halfway through a form. This is a query builder bound
 *  to one schema, from the one client.
 *
 *  Called `db` and not `q` because several functions here already open with
 *  `let q = …` to build a filter chain, and a helper of the same name would be
 *  shadowed by it — silently, in exactly the branches that filter.
 */
const db = () => supabaseBrowser().schema("ops_core");

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

  /* **Asked before the query, not inferred from it.** Signed out, `auth.uid()`
     is null, `v_my_access` returns no row, and the read below is
     indistinguishable from an account that authenticated and has no profile.
     They are not the same thing and they do not lead to the same place: one
     person needs the sign-in screen, the other needs to ask IT. Guessing
     between them is how somebody ends up staring at *ask IT* about an account
     they never signed into. */
  const { data: auth } = await sb.auth.getSession();
  if (!auth.session) {
    return {
      error: {
        code: "not_signed_in",
        message: "Nobody is signed in.",
        outcome: "refused",
        status: 401,
      },
      meta: { request_id: "", service: SERVICE, version: "1", outcome: "refused" },
    };
  }

  const { data, error } = await db().from("v_my_access").select("*").maybeSingle();
  if (error) return fail(SERVICE, error);
  if (!data) {
    /* Authenticated by Supabase and unknown to `ops_core.users`. Provisioning in
       `0007`, and the self-healing sign-in in `0029`, make this close to
       impossible — and "close to" is why it is handled: a 500 here would be a
       blank screen with nothing to act on. */
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
  const { error } = await db().rpc("record_sign_in");
  if (error) console.warn("sign-in not recorded:", error.message);
}

export async function listUsers(): Promise<Result<Session[]>> {
  const sb = supabaseBrowser();
  const { data, error } = await db().from("v_user_access").select("*").order("full_name");
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
  const { data, error } = await db().rpc("set_modules", {
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
  const { data, error } = await db().rpc("set_authorities", {
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
  const { data, error } = await db()
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
  let q = db().from("v_audit").select("*");

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
/* The activity log                                                    */
/* ------------------------------------------------------------------ */

/** The detail: who opened what.
 *
 *  Two things this does **not** do, and both are the database's job rather
 *  than an omission here.
 *
 *  It does not check a permission. `activity_events` is readable only under
 *  `it.read` (D190), and the policy is on the table — so a person without the
 *  grant gets an empty list from PostgREST rather than a refusal invented in
 *  the browser. Inventing it here would put the rule in two places, and the
 *  one that mattered would be the one nobody could see.
 *
 *  And it does not filter *out* the caller's own rows. Unlike the machine
 *  record in `activity_daily`, nobody reads their own here — a person who can
 *  see exactly what was logged about them knows precisely what was not.
 */
export async function listActivity(
  opts: { actor?: string; day?: string; limit?: number } = {},
): Promise<Result<ActivityEvent[]>> {
  const sb = supabaseBrowser();
  let q = db().from("v_activity_event").select("*");

  /* `actor` is one box on the screen and two columns here, the same way the
     audit filter works: somebody types a name or part of an address, never a
     uuid they have never seen. */
  if (opts.actor) q = q.ilike("actor_email", `%${opts.actor}%`);
  /* The office day is WITA, and `at` is a timestamptz — so a day is the window
     between its two boundaries, not a `date()` of a UTC instant, which would
     cut the workshop's afternoon in half (F17, F63). */
  if (opts.day) {
    const next = new Date(`${opts.day}T00:00:00+08:00`);
    next.setUTCDate(next.getUTCDate() + 1);
    q = q.gte("at", `${opts.day}T00:00:00+08:00`).lt("at", next.toISOString());
  }

  const { data, error } = await q
    .order("at", { ascending: false })
    .limit(opts.limit ?? 200);

  return fromRows<ActivityEvent[]>(SERVICE, data as ActivityEvent[] | null, error);
}

/** The recaps: one row per person per day. */
export async function listActivityDaily(
  opts: { actor?: string; limit?: number } = {},
): Promise<Result<ActivityDaily[]>> {
  let q = db().from("v_activity_recap").select("*");
  if (opts.actor) q = q.ilike("actor_email", `%${opts.actor}%`);

  const { data, error } = await q
    .order("day", { ascending: false })
    .order("full_name", { ascending: true })
    .limit(opts.limit ?? 200);

  return fromRows<ActivityDaily[]>(SERVICE, data as ActivityDaily[] | null, error);
}

/** The two horizons, what is held against them, and the gap that would lose a
 *  day entirely.
 *
 *  A one-row view, so `.single()`. The numbers come from `ops_core.settings`
 *  rather than from a constant, because the screen prints them as *the rule* —
 *  and a screen that states a policy it is not reading is a screen that will
 *  state the wrong one the first time somebody changes it.
 */
export async function getRetention(): Promise<Result<RetentionStatus>> {
  const { data, error } = await db().from("v_activity_log_retention").select("*").single();
  return fromRows<RetentionStatus>(SERVICE, data as RetentionStatus | null, error);
}

/** Roll a day up into the per-person recap.
 *
 *  A write, not a read: leadership's `it: read` does not reach it (D190). The
 *  seam enforces that and this does not re-check — the refusal it returns names
 *  what was required, which a check here could not.
 *
 *  **Recomputes rather than skips.** A day already rolled up is written again,
 *  so a late event corrects its day instead of being lost to a row that
 *  happened to exist first. `skipped` is therefore always 0, and the field
 *  stays only because the screen and the demo share one shape.
 */
export async function rollUpActivity(
  input: { day?: string } = {},
  idempotencyKey?: string,
): Promise<Result<{ day: string; written: number; skipped: number }>> {
  const { data, error } = await db().rpc("roll_up_activity_log", {
    p_from: input.day ?? null,
    p_to: input.day ?? null,
    p_key: idempotencyKey ?? null,
  });
  return fromSeam<{ day: string; written: number; skipped: number }>(SERVICE, data, error);
}

/** The sweep.
 *
 *  The only deletion in the system, and the only call here that destroys
 *  anything. It is a rule rather than a correction (A2): a business record is
 *  never deleted because somebody might need it; a log about a *person* is
 *  deleted because keeping it for ever was never agreed to (Q22, D188).
 *
 *  `blocked_days` is the part worth reading. A day whose detail is about to
 *  expire with no recap behind it would vanish entirely, so the seam skips it
 *  and names it rather than reporting a clean sweep that quietly lost a
 *  fortnight (D189).
 */
export async function purgeActivity(
  idempotencyKey?: string,
): Promise<Result<{ events_removed: number; recaps_removed: number; blocked_days: string[] }>> {
  const { data, error } = await db().rpc("purge_activity_log", {
    p_key: idempotencyKey ?? null,
  });
  return fromSeam<{ events_removed: number; recaps_removed: number; blocked_days: string[] }>(
    SERVICE, data, error);
}

/** Record one thing somebody did.
 *
 *  **The answer is meant to be ignored, and the caller is what ignores it.** A
 *  screen that could not log the fact it was opened must still open: refusing
 *  the page because the trail is unavailable turns an observability feature
 *  into an outage.
 *
 *  That is a rule about the **call site**, not about this signature. The first
 *  version of this returned `void` and swallowed everything, which made it a
 *  different function from the demo's under the same name — so the swap in
 *  `src/demo/api/index.ts` would not type, and a screen would have got one
 *  shape in demo mode and another against the database. The envelope comes
 *  back; whoever calls it drops it.
 */
export async function recordActivity(
  input: { kind: string; target: string; label: string },
): Promise<Result<{ id: string }>> {
  const { data, error } = await db().rpc("record_activity_event", {
    p_kind: input.kind, p_target: input.target, p_label: input.label,
  });
  return fromSeam<{ id: string }>(SERVICE, data, error);
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

/* ------------------------------------------------------------------ */
/* Passwords                                                           */
/* ------------------------------------------------------------------ */

/** Send a recovery link to an address.
 *
 *  ## The gap this closes
 *
 *  The sign-in form said *lupa kata sandi — hubungi IT*, which was honest about
 *  who decides and silent about what IT could actually do. The answer was
 *  nothing: Supabase's dashboard can send a recovery mail, but the link it
 *  sends lands wherever **Site URL** points, and on a project set up for local
 *  development that is `http://localhost:3000` — a machine the person reading
 *  the mail is not sitting at. The first real administrator account could not
 *  be given a password by any route the application offered.
 *
 *  So the link has to come from the application, and it has to land on a page
 *  the application serves. `redirectTo` is that page.
 *
 *  ## Why it always answers ok
 *
 *  Same reason `signIn` uses one message for a wrong password and an unknown
 *  address: *no account with that address* is a fact about somebody else's
 *  workspace, and handing it to whoever types a box is how a list of real
 *  addresses gets built. GoTrue behaves the same way on its side; this keeps
 *  the screen from undoing that.
 *
 *  A transport failure is different — that is this deployment being broken, not
 *  a statement about the address — so it is returned.
 */
export async function requestPasswordReset(email: string): Promise<Result<null>> {
  const sb = supabaseBrowser();
  const { error } = await sb.auth.resetPasswordForEmail(email.trim(), {
    /* Not a constant: the same build serves the preview deployment and
       production, and a link back to the wrong origin is the bug this function
       exists to fix. */
    redirectTo: `${window.location.origin}/set-password`,
  });
  if (error && error.status && error.status >= 500) {
    return {
      error: {
        code: "mail_failed",
        message:
          "Surat pemulihan tidak bisa dikirim dari server. Ini masalah deployment, "
          + "bukan alamat Anda — beri tahu IT.",
        outcome: "refused",
        status: 500,
        detail: { from: error.message },
      },
      meta: { request_id: "", service: SERVICE, version: "1", outcome: "refused" },
    };
  }
  return ok(SERVICE, null);
}

/** Set the password of whoever is signed in right now.
 *
 *  Two callers, one function, and that is deliberate: somebody who arrived on a
 *  recovery link and somebody changing a password they know are, to GoTrue, the
 *  same request. A recovery link **is** a session — a short-lived one that the
 *  client establishes from the URL — so there is no second code path for "reset"
 *  and no token to pass around by hand.
 *
 *  It refuses when there is no session, rather than asking GoTrue and relaying
 *  whatever it says. A person who opened `/set-password` from a bookmark, or
 *  whose link has expired, needs to be told to ask for a new one; *Auth session
 *  missing* is a true sentence that tells them nothing to do.
 */
export async function setPassword(password: string): Promise<Result<null>> {
  const sb = supabaseBrowser();
  const { data: auth } = await sb.auth.getSession();
  if (!auth.session) {
    return {
      error: {
        code: "no_recovery_session",
        message:
          "Tautan ini sudah dipakai atau kedaluwarsa. Minta tautan baru dari "
          + "halaman masuk, lalu buka dari email yang sama.",
        outcome: "refused",
        status: 401,
      },
      meta: { request_id: "", service: SERVICE, version: "1", outcome: "refused" },
    };
  }

  const { error } = await sb.auth.updateUser({ password });
  /* GoTrue's own wording, kept. It is the one that names the rule that was
     broken — too short, too common, same as the old one — and a sentence this
     file invented would be a second description of a rule it does not own. */
  if (error) return invalid(SERVICE, "password_rejected", error.message);

  /* The trail. A password change nobody can ask about later is the kind of
     event that only matters after it mattered. */
  await db().rpc("record_activity_event", {
    p_kind: "update", p_target: "session", p_label: "Mengganti kata sandi",
  });
  return ok(SERVICE, null);
}
