/** The service clients, as screens see them.
 *
 *  A screen imports from here and never from `../store`. Which implementation
 *  it gets is decided here and nowhere else: `swap()` returns the demo module
 *  in demo mode, and in live mode the real client from `src/lib/api` with a 501
 *  standing in for every function that has no database behind it yet.
 *
 *  That is the swap `ADR-009` and `src/lib/api/index.ts` both describe, and the
 *  reason it is one file rather than fifty-two is unchanged: fifty-two edits are
 *  fifty-two chances to convert one screen and forget another, and a half-swapped
 *  app is one where two screens disagree about the same number with no visible
 *  reason.
 *
 *  **Demo mode survives.** `src/demo` is not deleted by this: it is the guided
 *  tour, the offline sandbox, and the only place `actAs` can exist — impersonation
 *  against a real database is not a feature with a guard missing, it is the
 *  absence of authentication.
 */
import { swap } from "./_swap";

import * as demoIdentity from "./identity";
import * as demoProcurement from "./procurement";
import * as demoAccounting from "./accounting";
import * as demoDocuments from "./documents";
import * as demoHr from "./hr";
import * as demoProduction from "./production";
import * as demoInventory from "./inventory";
import * as demoMarketing from "./marketing";
import * as demoDelivery from "./delivery";
import * as demoQuotation from "./quotation";
import * as demoCrm from "./crm";
import * as demoDesign from "./design";
import * as demoAssistant from "./assistant";

import * as liveIdentity from "@/lib/api/identity";
import * as liveProcurement from "@/lib/api/procurement";
import * as liveAccounting from "@/lib/api/accounting";
import * as liveDocuments from "@/lib/api/documents";
import * as liveInventory from "@/lib/api/inventory";
import * as liveProduction from "@/lib/api/production";
import * as liveAssistant from "@/lib/api/assistant";
import * as liveHr from "@/lib/api/hr";
import * as liveDelivery from "@/lib/api/delivery";
import * as liveQuotation from "@/lib/api/quotation";
import * as liveCrm from "@/lib/api/crm";
import * as liveDesign from "@/lib/api/design";
import * as liveMarketing from "@/lib/api/marketing";

export const identity = swap("identity", demoIdentity, liveIdentity);
export const procurement = swap("procurement", demoProcurement, liveProcurement);
export const accounting = swap("accounting", demoAccounting, liveAccounting);
export const documents = swap("documents", demoDocuments, liveDocuments);
export const inventory = swap("inventory", demoInventory, liveInventory);
/* The catalogue and BOM half of production (`0109`). Every other production
   function is absent from the live module and refuses with its own name. */
export const production = swap("production", demoProduction, liveProduction);

/* `hr` is swapped for real since the HR ladder reached the live project
   (2026-09-23). It is the **partial** case this file was built for: 31 of the
   demo's 64 functions are written, and the other 33 — payroll, lembur, iuran,
   kinerja, cuti — become the 501 above rather than falling through to a
   fixture. Nobody meets one, because `isRouteLive()` keeps those nine screens
   dark; the refusal is the second line, for the day somebody adds an import. */
export const hr = swap("hr", demoHr, liveHr);

/* `marketing` was the last service here with no live module handed to `swap`.
   It moved up with its export, the same day (D316): `inventory` once sat in
   this spot for weeks after its real client existed, serving every screen the
   501 stub, because `check-live-routes.mjs` reads `src/lib/api/index.ts` and
   nothing re-checked this file. That check now reads the switchboard too. */
export const marketing = swap("marketing", demoMarketing, liveMarketing);
/* `delivery` and `assistant` are modules, not services: they already stamp
   their own envelopes `production` and `procurement` respectively, so the
   refusal carries the same name their successes would. Inventing two more
   `ServiceName` values to make this line read nicely would put a name in the
   audit trail that no envelope anywhere else uses. */
export const delivery = swap("production", demoDelivery, liveDelivery);
/* The quotation is the project's, like the order it turns into. */
export const quotation = swap("procurement", demoQuotation, liveQuotation);
/* The client log sits with the clients it is about. */
export const crm = swap("procurement", demoCrm, liveCrm);
/* A project's design (0221): collections, rooms, items, approvals. Stamped
   `procurement`, where projects live. */
export const design = swap("procurement", demoDesign, liveDesign);
export const assistant = swap("procurement", demoAssistant, liveAssistant);

export { isOk } from "@/services/_shared/envelope";
export type { Result, ApiError, Outcome } from "@/services/_shared/envelope";
