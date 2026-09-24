/** `@/demo/api` in a live build — the real clients and nothing else.
 *
 *  `next.config.mjs` aliases `@/demo/api` to this file when the build is
 *  pointed at a database (`NEXT_PUBLIC_USE_SUPABASE=1` with both keys), so the
 *  demo's store, fixtures and second implementation of every service never
 *  reach the browser. The service names and envelopes are the switchboard's,
 *  line for line: `src/demo/api/index.ts` is still the file that says which
 *  service is swapped, and this one must list the same, with the same
 *  `ServiceName` each refusal carries.
 *
 *  Types come from the demo modules as type-only imports, which are erased —
 *  a screen is checked against the same surface either way.
 */
import { liveOnly } from "@/demo/api/_swap";

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

type Api = typeof import("@/demo/api");

export const identity = liveOnly<Api["identity"]>("identity", liveIdentity);
export const procurement = liveOnly<Api["procurement"]>("procurement", liveProcurement);
export const accounting = liveOnly<Api["accounting"]>("accounting", liveAccounting);
export const documents = liveOnly<Api["documents"]>("documents", liveDocuments);
export const inventory = liveOnly<Api["inventory"]>("inventory", liveInventory);
export const production = liveOnly<Api["production"]>("production", liveProduction);
export const hr = liveOnly<Api["hr"]>("hr", liveHr);
export const marketing = liveOnly<Api["marketing"]>("marketing", {});
export const delivery = liveOnly<Api["delivery"]>("production", liveDelivery);
export const quotation = liveOnly<Api["quotation"]>("procurement", liveQuotation);
export const crm = liveOnly<Api["crm"]>("procurement", liveCrm);
export const assistant = liveOnly<Api["assistant"]>("procurement", liveAssistant);

/* A service added to the switchboard and forgotten here is a live build where
   that import is `undefined`. This makes it a compile error instead. */
const everyService: Record<Exclude<keyof Api, "isOk">, unknown> = {
  identity, procurement, accounting, documents, inventory, production, hr,
  marketing, delivery, quotation, crm, assistant,
};
void everyService;

export { isOk } from "@/services/_shared/envelope";
export type { Result, ApiError, Outcome } from "@/services/_shared/envelope";
