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
   `adjustStock`, `transferStock`, `setStockMinimum` (stock from a receipt is
   `0169`'s trigger, not a client call).
   Timber (`0070`) and the board rack (no migration yet) are not written here
   yet; a screen that calls one of those names still gets the same 501 as a
   function that does not exist at all (this file's own header), so exporting
   the module now is safe — it lights up `/inventory/material` and
   `/inventory/penyesuaian` and leaves `/inventory/log` dark until timber
   lands. */
export * as inventory from "./inventory";

/* The product catalogue and its bill of materials (`0060`, `0106`) — and
   nothing else of production yet. Work orders, progress, vendor legs and the
   drafting queue are not written here, so the check script keeps their
   screens dark and opens `/produksi/bom` alone. */
export * as production from "./production";

/* The last leg (`ops_dlv`, 0131–0132): crates, surat jalan, installation,
   snags and the BAST. A module, not a service — its envelopes say
   `production`, the same as the demo's. */
export * as delivery from "./delivery";

/* The quotation (0133): a released BOM priced for the client, sent, revised
   and accepted into the order. A module of `project`, stamped `procurement`. */
export * as quotation from "./quotation";

/* The client log (0134): contacts and follow-ups, per client, project and
   quotation. Stamped `procurement`, checked against `project`. */
export * as crm from "./crm";

/* A project's design (0222): collections, rooms, items and the client's
   approval. Stamped `procurement`, checked against `may_design`. */
export * as design from "./design";
/* The field QC team (0261, O6). */
export * as qc from "./qc";

/* ## `marketing` is exported (D316)
 *
 *  The line waited on two things, and both are now true. The Marketing block
 *  of the ladder, `0080`–`0085`, was applied to the live project on 2026-09-25
 *  and fingerprinted identical to a local rebuild (D315, F167). `ops_mkt` was
 *  added to the project's *Exposed schemas* on 2026-09-28. PostgREST's schema
 *  cache went from 381 to 394 relations, the thirteen `ops_mkt` has.
 *  Every RPC this client calls matches its function's argument names.
 *
 *  **The tables are empty.** No screen here creates a market
 *  (`ops_mkt.create_market` exists and nothing calls it), and a scrape import
 *  counts every row as `unknown_market` until one exists. So the screens open
 *  onto an honest empty state, not onto fixtures.
 */
export * as marketing from "./marketing";

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
