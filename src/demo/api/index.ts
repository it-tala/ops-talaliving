/** The service clients, as screens see them.
 *
 *  A screen imports from here and never from `../store`. In Phase 2 each of
 *  these modules is replaced by a `fetch` against `/api/v1/<service>` and no
 *  screen changes, which is the whole reason the demo implements the envelope
 *  and the refusal codes rather than just returning data.
 */
export * as identity from "./identity";
export * as procurement from "./procurement";
export * as accounting from "./accounting";
export * as documents from "./documents";
export { isOk } from "@/services/_shared/envelope";
export type { Result, ApiError, Outcome } from "@/services/_shared/envelope";

export * as hr from "./hr";
export * as production from "./production";
export * as inventory from "./inventory";
export * as marketing from "./marketing";
export * as delivery from "./delivery";
export * as assistant from "./assistant";
