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
export * as hr from "./hr";
export * as procurement from "./procurement";
export * as accounting from "./accounting";
/* Reading and writing are here; `upload` and `uploadToInbox` are not, and wait
   on B6. Listing the service is still right: the check script counts functions,
   so every screen that needs an upload stays dark and says which call it is
   waiting for, while the screens that only read evidence open. */
export * as documents from "./documents";
/* John Lau. The catalogue, the gate and the router are in `ops_asst` (0038,
   0039, 0040); this module runs the tools by making the same calls the screens
   make, as the person, so RLS applies exactly as it does there. */
export * as assistant from "./assistant";

/* Material stock (`0071`) only — `listStock`, `getStockItem`,
   `listStockLocations`, `listStockMoves`, `issueStock`, `returnStock`,
   `adjustStock`, `transferStock`, `setStockMinimum`, `stockFromReceipt`.
   Timber (`0070`) and the board rack (no migration yet) are not written here
   yet; a screen that calls one of those names still gets the same 501 as a
   function that does not exist at all (this file's own header), so exporting
   the module now is safe — it lights up `/inventory/material` and
   `/inventory/penyesuaian` and leaves `/inventory/log` dark until timber
   lands. */
export * as inventory from "./inventory";

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

/* ## `hr` is exported, and six of its fourteen screens open
 *
 *  The HR block of the ladder — `0043`–`0058` — was applied to the live project
 *  on 2026-09-23, and `ops_hr` went from zero tables to 17 tables, 13 views and
 *  61 functions. The condition the previous version of this comment set is met,
 *  so the line is here.
 *
 *  **Six screens, not fourteen, and the arithmetic is the guard's not mine.**
 *  `check-live-routes.mjs` lists a route only when every `service.function` it
 *  can reach is exported from here, so `/hrd/lembur`, the four payroll screens,
 *  `/hrd/iuran`, `/hrd/kinerja` and `/hrd/cuti` stay dark on their own: 33 of
 *  the demo's 61 functions have no counterpart written yet. What opens is the
 *  chain HRD actually works — the person, their berkas, their contract, the
 *  machine's file and the marks on it.
 *
 *  Two of those are not merely unwritten. **Payroll's seam is unfinished**:
 *  `PayrollLine` carries `take_home`, `contributions`, `overtime_parts` and
 *  sixteen other fields `ops_hr.payroll_figures` does not have (C20), so the
 *  payroll functions are absent rather than wrong. And **`/hrd/cuti` has no
 *  database at all** — there is no leave-request table in `ops_hr`, only
 *  `v_leave_used`, which counts balances out of `day_marks`. Nobody has
 *  specified who asks and who decides, and inventing that is not this file's
 *  to do.
 *
 *  A function that is missing answers 501 by name rather than crashing (see
 *  `src/demo/api/_swap.ts`), which is the second line. `isRouteLive()` is the
 *  first.
 */

export { isOk } from "@/services/_shared/envelope";
export type { Result, ApiError, Outcome } from "@/services/_shared/envelope";

export { isConfigured, isRealApi } from "@/lib/supabase/env";
