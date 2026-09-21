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

/* ## `marketing` is written and is deliberately not exported here yet
 *
 *  `src/lib/api/marketing.ts` exists, type-checks, and matches the demo on all
 *  fifteen functions with nothing on the pending list — `check-api-parity.mjs`
 *  covers it. What is missing is not code.
 *
 *  Exporting a service from this file is what makes its routes live:
 *  `check-live-routes.mjs` reads this module to decide. The marketing screens
 *  read `ops_mkt`, and **`ops_mkt` has no tables in the live project**: the
 *  ladder there stops in the 0030s, and 0080–0085 have only ever been applied
 *  to the throwaway cluster. Turning the screens on today would give every one
 *  of them *Could not find the table `ops_mkt.v_market`* — which is the exact
 *  failure this file and `live.ts` exist to make impossible.
 *
 *  So the line that would add it is not here. Adding it is the whole of the
 *  remaining work, and it becomes correct the moment the marketing block of
 *  the ladder is applied to the project — after which
 *  `node scripts/check-live-routes.mjs --write` regenerates `LIVE_ROUTES` and
 *  the eight marketing screens open. Applying migrations to a project another
 *  session is mid-cutover on is not a decision this file gets to make.
 */

export { isOk } from "@/services/_shared/envelope";
export type { Result, ApiError, Outcome } from "@/services/_shared/envelope";

export { isConfigured, isRealApi } from "@/lib/supabase/env";
