/** The switchboard: which implementation a screen actually gets.
 *
 *  ## What this replaces
 *
 *  `src/lib/api/index.ts` has said since it was written that the swap is *one
 *  line in `src/demo/api/index.ts`* — re-export from the real client when the
 *  flag is on. It was never made, so until now **every screen called the demo,
 *  including the thirteen routes `LIVE_ROUTES` lists as live.** The gate was
 *  real and the client behind it was not connected to anything.
 *
 *  ## Why it is not `isRealApi() ? live : demo`
 *
 *  Because the two modules are not the same size, and they are not supposed to
 *  be. The demo implements 154 functions; the real client implements the ones
 *  B1–B3 have transcribed. `accounting` alone has fifteen functions in the demo
 *  with no counterpart yet.
 *
 *  A straight swap breaks two ways. It **fails to compile**, because the screens
 *  that call the other fifteen reference properties the live module does not
 *  have. And if it were forced past the compiler it would fail worse at run
 *  time: `accounting.listDue` would be `undefined`, and a screen would take the
 *  page down with a TypeError rather than say anything a person could act on.
 *
 *  ## Why the missing ones refuse rather than fall through to the demo
 *
 *  Falling through is the tempting version — every name resolves, nothing
 *  crashes, the app keeps working. It is also the single worst outcome
 *  available, and `isRealApi()` was written with a note about exactly it:
 *
 *      Demo mode is a mode somebody chooses, never a fallback for a
 *      misconfigured deployment.
 *
 *  A business booking real money against a screen quietly serving fixtures has
 *  no way to find out. The numbers are plausible, the writes appear to succeed,
 *  and nothing anywhere says *this is not your data*. A refusal naming the
 *  function is loud, it is correct, and it is recoverable.
 *
 *  So in live mode every function name still exists — which keeps the types
 *  honest and the compiler useful — and the ones with no implementation behind
 *  them return a 501 that says which call is missing.
 *
 *  ## What stops anybody meeting one of those refusals
 *
 *  `isRouteLive()`, which is derived rather than kept: `check-live-routes.mjs`
 *  walks each route's import graph and lists a route only when **every**
 *  `service.function` it can reach is exported by `src/lib/api`. A screen that
 *  would hit a gap is dark before it renders, and says which call it is waiting
 *  for.
 *
 *  These refusals are therefore the second line, not the first. They exist
 *  because "unreachable by construction" is a claim that rots the first time
 *  somebody adds an import, and a claim that rots silently is the kind this
 *  project keeps finding.
 */
import { type ServiceName, type Result } from "@/services/_shared/envelope";
import { isRealApi } from "@/lib/supabase/env";
import { isPendingParity } from "@/lib/api/_pending";
import { withCache } from "@/lib/api-cache";

/** 501. Not a refusal about *this person* — a statement about this deployment,
 *  and the distinction matters to whoever reads it: nothing they can be granted
 *  will make this work, so the message names the call rather than an authority
 *  to go and ask for. */
export function notImplemented(service: ServiceName, fn: string) {
  return {
    error: {
      code: "not_implemented" as const,
      message:
        `\`${service}.${fn}\` belum ada di klien database — layar ini masih menunggu `
        + `bagian backend-nya. Datanya tidak kosong; yang belum ada adalah caranya membaca.`,
      outcome: "refused" as const,
      status: 501 as const,
      detail: { service, function: fn },
    },
    meta: { request_id: "", service, version: "1", outcome: "refused" as const },
  };
}

/** Pick the implementation for one service.
 *
 *  `demo` is the shape — it is the complete list by construction, because it is
 *  what the screens import. `live` overrides every name it implements. Names it
 *  does not implement become the 501 above, and **non-function exports are
 *  carried across unchanged**: `RETENTION` and `MAX_BYTES` are constants the
 *  screens read, not calls, and there is nothing to refuse about a number.
 *
 *  The return type is the demo module's, which is the point: a screen cannot
 *  tell which it got, and TypeScript still checks every call site against the
 *  full surface.
 *
 *  **`live` is untyped here, and the reason is `_pending.ts`.** Typing it
 *  `Partial<T>` would be the natural thing and would make this file refuse to
 *  compile whenever the two drift — but it cannot, because the whole point of
 *  the pending list is that thirty-seven of them are *already* drifted, and
 *  TypeScript has no way to learn a runtime array. So the guarantee moves to
 *  `scripts/check-api-parity.mjs`, which is the stricter guard anyway: it
 *  compares all 98 shared functions in one pass and fails CI on any mismatch
 *  that is not listed, and on any listed one that has since been fixed. A type
 *  error here would have reported them one at a time.
 */
export function swap<T extends object>(
  service: ServiceName,
  demo: T,
  live: Record<string, unknown> = {},
): T {
  if (!isRealApi()) return demo;

  const out: Record<string, unknown> = {};
  for (const key of Object.keys(demo) as (keyof T & string)[]) {
    /* Exported, and wrong. A function whose answer does not match the contract
       is not an implementation — it is the same gap as a missing one, wearing a
       name that makes it look closed. `_pending.ts` says which, and why. */
    const fromLive = isPendingParity(service, key) ? undefined : live[key];
    if (fromLive !== undefined) { out[key] = cachedIfCall(service, key, fromLive); continue; }

    const fromDemo = (demo as Record<string, unknown>)[key];
    if (typeof fromDemo !== "function") { out[key] = fromDemo; continue; }

    /* Async, because every service function is: a screen awaits the answer, and
       a refusal thrown synchronously from an `await`ed call would land in a
       `catch` nobody wrote instead of in the envelope everybody handles. */
    out[key] = async () => notImplemented(service, key);
  }

  /* Anything the real client exports that the demo does not. There should be
     nothing here — the demo is the contract — but dropping it silently would
     hide a genuine divergence, and a name the screens cannot call costs
     nothing. */
  for (const key of Object.keys(live)) {
    if (!(key in out)) out[key] = cachedIfCall(service, key, live[key]);
  }

  return out as T;
}

/** The live build's half of `swap`, with no demo module to read the shape
 *  from.
 *
 *  A deployment that talks to the database has no use for the fixtures, and
 *  shipping them anyway put the whole demo — its store, its seed data, and a
 *  second implementation of every service — into the bundle of every screen.
 *  `next.config.mjs` points `@/demo/api` at `src/live/api.ts` for a live build,
 *  and this is what that file builds each service from.
 *
 *  Without the demo there is no list of names to walk, so the 501 is handed
 *  out on demand: any name the real client does not export, or exports but
 *  `_pending.ts` says is still wrong, answers with the same refusal `swap`
 *  gives it. What a screen can call is still checked against the demo's types
 *  at compile time — the alias only changes what is bundled.
 */
export function liveOnly<T extends object>(
  service: ServiceName,
  live: Record<string, unknown>,
): T {
  const stubs = new Map<string, () => Promise<ReturnType<typeof notImplemented>>>();
  const wrapped = new Map<string, unknown>();
  return new Proxy({} as T, {
    get(_target, key) {
      /* Not service calls: a symbol, or the names a promise, JSON or React
         probe any object for. Answering those with a function would make the
         module look like something it is not. */
      if (typeof key !== "string" || key === "then" || key === "toJSON" || key === "$$typeof") {
        return undefined;
      }
      const fromLive = isPendingParity(service, key) ? undefined : live[key];
      if (fromLive !== undefined) {
        /* One wrapper per name, so a screen that keeps a service function in
           a dependency list sees the same function every time. */
        if (!wrapped.has(key)) wrapped.set(key, cachedIfCall(service, key, fromLive));
        return wrapped.get(key);
      }
      let stub = stubs.get(key);
      if (!stub) {
        stub = async () => notImplemented(service, key);
        stubs.set(key, stub);
      }
      return stub;
    },
    has(_target, key) {
      return typeof key === "string";
    },
  });
}

/** A live service function, remembered by `src/lib/api-cache.ts` — reads kept,
 *  writes forgetting. Anything that is not a function passes through. */
function cachedIfCall(service: ServiceName, key: string, value: unknown): unknown {
  if (typeof value !== "function") return value;
  return withCache(service, key, value as (...args: never[]) => Promise<Result<unknown>>);
}
