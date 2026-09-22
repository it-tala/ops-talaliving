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
 *  screen would meet rather than a reviewer. Twenty-nine are left of 104:
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
 *  Three came off together for the evidence inbox — `listInbox`,
 *  `listInboxAll` and `resolveInbox` — because they are one screen and it is
 *  the screen the capture pipeline ends at. `listInbox` and `listInboxAll`
 *  were `select("*")` answering `unknown[]`; they now map the row, which is
 *  not decoration: the column is `produced_trx_no` and the contract reads
 *  `produced_trx_id`, so a cast would have rendered a blank where a ledger
 *  reference belongs. `resolveInbox` took a `status` and answered a receipt,
 *  where the screen names a *road* and redraws the row — so it maps the five
 *  roads onto the four statuses and re-reads. That one needed `0039` first:
 *  the screen has always passed `pr_line_no` and the seam had nowhere to put
 *  it, so `produced_pr_line_no` had never once been written.
 *
 *  `coverageForDocument` and `coverageForTransaction` were never on this list
 *  because they did not exist at all; they do now, and `/accounting/verifikasi`
 *  is live as a result.
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
];

/* Empty as of `0091`. `getCashPlan` was the last name here — the twelve-month
   cash projection, ported to `ops_acct.cash_plan()` as its own migration with
   its own smoke file (`86_acct_cash_plan.sql`) proving the occurrence dates,
   the weekly-override spread (D114), the settlement link beating a category
   guess, the running balance, and the month it goes negative — rather than
   folded into the batch that closed everything else. Every name that was
   ever on this list, and what closed it, is `findings.md`'s to keep now that
   this file's job — being the thing CI checks so the list cannot rot in
   either direction — is done for the fifty-two functions this codebase
   started with. The check stays: `check-api-parity.mjs` still fails if a
   future function drifts from its demo counterpart, it simply has nothing to
   list today. */

/** `service.function` → is it pending? */
export function isPendingParity(service: string, fn: string): boolean {
  return PENDING_PARITY.includes(`${service}.${fn}`);
}
