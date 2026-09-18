/** The service clients, as screens see them — the real ones.
 *
 *  The mirror of `src/demo/api/index.ts`, exporting the same module names with
 *  the same function signatures. A screen imports one or the other and cannot
 *  tell which it got, which is the entire design of the swap (ADR-009).
 *
 *  ## How the swap actually happens
 *
 *  Screens import from `@/demo/api` today. Making them import from here instead
 *  is **one line in `src/demo/api/index.ts`** — re-export from this module when
 *  the flag is on — and that file belongs to the design session, so the change
 *  travels through the contract protocol in `docs/plan/phase-2/README.md` rather
 *  than being made here. The build session does not edit screens or `src/demo`.
 *
 *  It is deliberately not a per-screen change and deliberately not a find and
 *  replace across 52 files: those are 52 chances to swap one screen and forget
 *  another, and a half-swapped app is one where two screens disagree about the
 *  same number with no obvious reason.
 *
 *  ## Demo mode survives
 *
 *  `src/demo` is not deleted when this lands. It is the guided tour, the offline
 *  sandbox, and the thing that makes a screen reviewable without a database —
 *  and it is the only place `actAs` can exist, because impersonation against a
 *  real database is not a feature with a guard missing, it is the absence of
 *  authentication.
 */
export * as identity from "./identity";
export * as procurement from "./procurement";
export * as accounting from "./accounting";
/* Reading and writing are here; `upload` and `uploadToInbox` are not, and wait
   on B6. Listing the service is still right: the check script counts functions,
   so every screen that needs an upload stays dark and says which call it is
   waiting for, while the screens that only read evidence open. */
export * as documents from "./documents";

export { isOk } from "@/services/_shared/envelope";
export type { Result, ApiError, Outcome } from "@/services/_shared/envelope";

export { isConfigured, isRealApi } from "@/lib/supabase/env";
