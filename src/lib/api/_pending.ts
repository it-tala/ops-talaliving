/** Functions the real client exports but has **not** correctly implemented yet.
 *
 *  ## What this list is
 *
 *  `src/lib/api/*` and `src/demo/api/*` are supposed to be interchangeable: the
 *  same names, the same arguments, the same answers, so a screen cannot tell
 *  which one it got. That is the whole of ADR-009, and it is the only reason the
 *  swap in `src/demo/api/index.ts` is one file rather than fifty-two edits.
 *
 *  They are not interchangeable today. Putting the two modules side by side for
 *  the first time — which the swap does, and nothing before it did — showed
 *  **37 of the 98 shared functions disagreeing**, and they disagree in ways a
 *  screen would meet rather than a reviewer. Thirty-two are left of 102:
 *
 *  - **A receipt where the contract promises the thing.** `approvePo` answers
 *    `Result<unknown>`; the screen expects the `PoDetail` it is about to redraw.
 *    Most of this list is this, and it is one pattern: the real client was
 *    written write-shaped, the screens were written entity-shaped.
 *  - **Different arguments.** `transferRound(roundNo, input)` against
 *    `transferRound({round_no, …})`; `curateVendor(code, …)` against
 *    `curateVendor(id, …)` — a uuid and a public code are both `string`, so
 *    nothing would have complained until a seam refused every call.
 *  - **A widened enum.** `createItem` takes `base_uom?: string` here and one of
 *    eighteen `UomCode`s there. The narrow one is right; `string` lets a typo
 *    reach the database.
 *
 *  ## Why a list rather than thirty-seven fixes in one go
 *
 *  Because most of them are write paths and several move money. When this list
 *  was written there was also no database to test them against; there is now —
 *  the ladder is applied, and `supabase/local/` replays it from nothing — so
 *  the reason has narrowed to the one that never goes away: rewriting
 *  thirty-seven money-path functions in one change is how a fortnight of quiet
 *  breakage gets introduced. They come off in families, each with the smoke
 *  file that earns it.
 *
 *  Five came off together in `0032` — the curation family, `curateVendor`,
 *  `mergeVendor`, `updateVendorContact`, `createItem`, `curateItem` — because
 *  they are one screenful of decisions and because the import is about to land
 *  296 vendors and 1.020 items for somebody to curate. That change also had to
 *  fix `v_vendor_view` and `v_item_view` first: `listVendorViews` and
 *  `listItemViews` were **never on this list**, since their signatures matched,
 *  and both met the contract with `as ItemView[]` over a view missing six of
 *  its columns. A cast is not an implementation, and a matching signature is
 *  not a matching answer — which is the limit of what this file can catch.
 *
 *  So each one is **named, refused and counted** instead:
 *
 *  1. `swap()` gives every name here the same 501 as a function that does not
 *     exist at all, because a function that answers the wrong shape is not
 *     implemented — it is worse, since it looks like it worked.
 *  2. `check-live-routes.mjs` treats them as missing, so a route that reaches
 *     one **drops out of `LIVE_ROUTES`**. That correction is the point: the app
 *     listed thirteen routes as ready for a business booking real money, and
 *     some of them reached functions that would have answered the wrong shape.
 *  3. `scripts/check-api-parity.mjs` fails CI if this list is wrong in either
 *     direction — a name here that now matches, or a mismatch not listed. So it
 *     cannot rot, and it cannot be quietly grown.
 *
 *  **This list only ever shrinks.** Removing a line is the unit of progress for
 *  finishing B2/B3, and the removal has to come with the fix that earns it.
 */
export const PENDING_PARITY: readonly string[] = [
  /* Answers a receipt; the contract promises `LineCoverage`. */
  "accounting.coverageFor",
  /* Takes `from?`, answers rows; the contract is `() => CashPlan`. */
  "accounting.getCashPlan",
  /* `unknown[]` where the screen reads `AuditRow[]`. */
  "accounting.historyFor",
  "accounting.linkPayment",
  "accounting.listComponents",
  "accounting.listInbox",
  "accounting.listInboxAll",
  "accounting.listStatements",
  "accounting.paymentsForVendor",
  "accounting.resolveInbox",
  "accounting.setOverride",

  /* Procurement: the same pattern, at scale. Every one of these answers what
     the seam returned rather than the row the screen is about to draw. The
     curation five are gone from here — see the note above. */
  "procurement.amendPoLine",
  "procurement.answerFromChat",
  "procurement.approvePo",
  "procurement.approveRound",
  "procurement.closePo",
  "procurement.closeRound",
  "procurement.confirmReceipt",
  /* Takes `vendor_code`; the screen holds `vendor_id`. */
  "procurement.createPo",
  "procurement.createReceipt",
  /* Answers `PoDetail`; the contract is `PoView`. Two different shapes with
     confusingly similar names — worth resolving in the contract, not here. */
  "procurement.getPo",
  "procurement.getRound",
  "procurement.issuePo",
  "procurement.listPo",
  "procurement.listReported",
  "procurement.listRounds",
  "procurement.markPoResent",
  "procurement.requestApproval",
  "procurement.requestPoApproval",
  "procurement.setExpectedDelivery",
  "procurement.syncRound",
  /* Positional against object arguments. */
  "procurement.transferRound",
];

/** `service.function` → is it pending? */
export function isPendingParity(service: string, fn: string): boolean {
  return PENDING_PARITY.includes(`${service}.${fn}`);
}
