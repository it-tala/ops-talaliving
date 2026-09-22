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
  /* Procurement is clear, and so is every accounting function but this one.
     `coverageFor`, `linkPayment`, `listComponents` (`0090` added the
     `scheme_codes` column the table never had), `listStatements`,
     `paymentsForVendor` (`0088` added the proof-attachment columns
     `v_vendor_payment` never carried), `setOverride` (`0089` added the
     `p_due_day` parameter the seam never took) are gone from both files —
     see `findings.md`.

     `getCashPlan` takes `from?`, answers rows; the contract is
     `() => CashPlan`. Not a shape mismatch a view can close: the demo's
     `cashPlan()` (`src/demo/derive.ts`) is ~150 lines computing twelve
     months forward from `cash_components` — occurrence dates per frequency,
     an override on a weekly line spread across its runs with the remainder on
     the last one, fuzzy matching of ledger rows to planned occurrences within
     a tolerance window, the running balance, the first month it goes negative
     and by how much, and undated obligations held apart rather than spread to
     make the chart look even. Every migration in this ladder puts a
     derivation like this behind a view (A3) precisely so the real and the
     demo client can't compute it two different ways and disagree — so this
     has to be ported to SQL as one piece, not approximated, and it is the one
     screen in this codebase's own findings log that most reliably found real
     business mistakes by being asked a question it had to get exactly right
     (`docs/plan/checkpoints/2026-09-23.md`). Money-path logic this load-
     bearing is not a fix to land inside a larger batch; it wants its own
     migration, its own smoke file proving the month-by-month arithmetic
     against seeded data, and a second pair of eyes before `swap()` ever
     points a leadership screen at it. */
  "accounting.getCashPlan",
];

/** `service.function` → is it pending? */
export function isPendingParity(service: string, fn: string): boolean {
  return PENDING_PARITY.includes(`${service}.${fn}`);
}
