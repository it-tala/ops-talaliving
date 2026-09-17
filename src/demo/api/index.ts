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

/* ------------------------------------------------------------------------ *
 *  The swap point, and the one fact that follows from it
 * ------------------------------------------------------------------------ */

/** Is a real database answering?
 *
 *  **This is where the swap happens** — the single line `src/lib/api/index.ts`
 *  describes, in the file it says it belongs to. Today it is a literal `false`
 *  and not `useRealApi()`, because the real client is **43 values short** of what
 *  the screens above call (F94, `npm run check:api`, backlog S2). Reading the
 *  flag now would mean an environment variable could put the app into a state
 *  that breaks at the first click. A flag that can select a broken mode is not a
 *  flag, it is a trap.
 *
 *  When `check:api` reports zero, this becomes `useRealApi()` and the
 *  `export * as` lines above become a choice between the two implementations.
 *  Both halves change in one edit, which is the point of them being one
 *  constant.
 */
const REAL = false as boolean;

/** What the screens are showing, derived from what answered.
 *
 *  The shell has to say whether the numbers on screen are real, and until now it
 *  said so by **holding its own opinion**: a hardcoded amber badge reading
 *  *Demo · data is not real*, with nothing connecting it to the data. It was
 *  right by coincidence — the only client that has ever answered is the demo —
 *  and it would have gone on being displayed, unchanged, over a live database
 *  (F95).
 *
 *  Which is the worse failure of the two. A demo labelled demo is honest; a
 *  production system labelled *not real* teaches everybody who uses it that the
 *  label means nothing, and the lesson holds on the day the label is the only
 *  thing standing between somebody and a decision made on fixtures.
 *
 *  So it is derived here, beside the decision it describes, rather than asserted
 *  in a component that cannot see it. If two things must agree, one of them has
 *  to come from the other.
 */
export const DATA_MODE: "demo" | "live" = REAL ? "live" : "demo";

/** Demo-only affordances: reset, and acting as somebody else.
 *
 *  Named rather than checked inline, because `DATA_MODE === "demo"` scattered
 *  through the shell is three independent chances to forget one — and the one
 *  most easily forgotten is the grant picker, which is impersonation. Against a
 *  real database that is "not a feature with a guard missing, it is the absence
 *  of authentication" (`src/lib/api/index.ts`).
 */
export const DEMO_AFFORDANCES = DATA_MODE === "demo";
