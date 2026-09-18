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
import * as demoAssistant from "./assistant";

import * as liveIdentity from "@/lib/api/identity";
import * as liveProcurement from "@/lib/api/procurement";
import * as liveAccounting from "@/lib/api/accounting";
import * as liveDocuments from "@/lib/api/documents";

export const identity = swap("identity", demoIdentity, liveIdentity);
export const procurement = swap("procurement", demoProcurement, liveProcurement);
export const accounting = swap("accounting", demoAccounting, liveAccounting);
export const documents = swap("documents", demoDocuments, liveDocuments);

/* The four services B1–B3 have not reached. No `src/lib/api` module exists for
   any of them, so in live mode every one of their functions refuses with the
   name of the call — which is what `swap` does when handed nothing to swap in.
   Listing them here rather than exporting the demo directly is the whole point:
   the alternative is six services quietly serving fixtures to a business
   booking real money. */
export const hr = swap("hr", demoHr);
export const production = swap("production", demoProduction);
export const inventory = swap("inventory", demoInventory);
export const marketing = swap("marketing", demoMarketing);
/* `delivery` and `assistant` are modules, not services: they already stamp
   their own envelopes `production` and `procurement` respectively, so the
   refusal carries the same name their successes would. Inventing two more
   `ServiceName` values to make this line read nicely would put a name in the
   audit trail that no envelope anywhere else uses. */
export const delivery = swap("production", demoDelivery);
export const assistant = swap("procurement", demoAssistant);

export { isOk } from "@/services/_shared/envelope";
export type { Result, ApiError, Outcome } from "@/services/_shared/envelope";
