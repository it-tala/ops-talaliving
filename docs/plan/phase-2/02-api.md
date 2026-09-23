# The API surface, function by function

`03-api.md` is the contract — envelope, status codes, idempotency, auth. This
file is the **inventory**: all 154 service functions the screens call today,
where each one lands in Phase 2, and what it is allowed to refuse.

Three kinds of landing, and choosing right is most of the work:

| Landing | When | Cost of getting it wrong |
|---|---|---|
| **View** — `select` through PostgREST or a thin handler | a pure read over derived state | none, if it is genuinely derived |
| **RPC** — `security definer` function | anything that writes money, decides, or must be idempotent | a write seam that is only a table insert loses the audit row and the refusal (D84) |
| **Handler** — Next.js route | multi-step work with a file, an external call, or a response shape no view gives | logic ends up split between SQL and TS, which is how two versions of a rule appear |

`src/lib/api/*.ts` keeps the **same function names and signatures** as
`src/demo/api/*.ts`. That is the whole swap: no screen changes.

---

## `identity` — 5 functions

| Function | Lands as | Guard |
|---|---|---|
| `me` | view `core.v_my_access` | signed in |
| `listUsers` | view | `it.read` |
| `actAs` | **demo only** — deleted in Phase 2; Supabase Auth replaces it | — |
| `setModules` | RPC `core.set_modules()` | `it.manage_roles` |
| `setAuthorities` | RPC `core.set_authorities()` | `it.manage_roles`, and never self-service |

---

## `documents` — 7 functions

| Function | Lands as | Guard / refusal |
|---|---|---|
| `upload` | handler (signed URL → storage → row) | any module `create`. Computes sha256; duplicate is **advisory** (A6) |
| `uploadToInbox` | handler | a file with no record yet — the exception road (D94) |
| `link`, `addLink` | RPC `core.link_attachment()` | 409 when the same file is already on that record for that kind |
| `unlink` | RPC — stamps `unlinked_at`, never deletes | `documents.update` |
| `byEntity`, `listAttachments` | views | read of the owning module |

---

## `procurement` — 65 functions

**Reference data (12).** `listVendors` `createVendor` `listItems` `listUom`
`listCategories` `listVendorViews` `getVendor` `curateVendor` `mergeVendor`
`listItemViews` `createItem` `curateItem` `updateVendorContact` `whereToBuy`
→ views over `procure.*` plus three RPCs: create (uncurated is allowed),
curate (sets the flag and audits who), **merge** (writes `merged_into`, never
deletes — D33).

**Projects (7).** `listProjects` `getProject` `saveProject` `listProjectLines`
`saveProjectLine` `removeProjectLine` `listLinesForWorkOrder` → views + RPCs.
`removeProjectLine` is a supersession, and the project **code is immutable**
once created: every other service quotes it as text (D149).

**The PR chain (16).** `listPr` `getPr` `createPr` `quickAddLine`
`addDraftLine` `updateLine` `submitPr` `listOpenLines` `listAllLines`
`lineHistory` `noteLine` `removeLine` `decidedLines` `queue` `lineForPosting`
`listVariances` `explainVariance`

| Rule | Where it lives in Phase 2 |
|---|---|
| line status is never stored | `v_pr_line_status` (D6) |
| an edit after submission supersedes | RPC `revise_line()`, new row, old one kept |
| `HOLD` does not leave the approval queue | `v_approval_queue` predicate (Q4) |
| a variance is a row with a reason | `procure.line_variances` (F13) |

**Approving (6).** `approveLine` `requestApproval` `listApprovalBatches`
`answerFromChat` `answerBatch` → RPC `approve_line()` and
`answer_request()`. **`core.has_authority('approve_goods')` or 403**, never a
module level (D19, D24). The approval row records the **channel** — app, chat
or meeting — because "who said yes and where" is the question asked six months
later (F16). A second answer to an answered request is **409, not an update**.

**Rounds (6).** `listRounds` `getRound` `syncRound` `approveRound`
`transferRound` `closeRound` → `v_round_summary` + RPCs.
`approve_funds` for approve and close. **TRANSFERRED does not make a line
PAID** — that ladder is in the view, not in a column (D6).

**Purchase orders (12).** `createPo` `listPo` `getPo` `getPoDetail` `issuePo`
`amendPoLine` `closePo` `requestPoApproval` `approvePo`
`setExpectedDelivery` `markPoResent` `getVendorJourney` `listVendorJourneys`
→ `v_po_line_status`, `v_po_journey`, `v_vendor_journey` + RPCs. An amendment
after issue is a **revision** (D135); a close with undelivered lines refuses
and says which (D132).

**Receiving (4).** `createReceipt` `confirmReceipt` `listReported`
`paymentsForVendor` → RPC `report_receipt()` / `confirm_receipt()`. Two
documents, a receiver and a checker (D101); over-delivery becomes a credit and
`value_received` is capped (F27, D98).

---

## `accounting` — 30 functions

| Group | Functions | Lands as |
|---|---|---|
| Reference | `listAccounts` `listAccountRows` `listTypeRows` | views; the leadership account's balance is visible only to `approve_funds` and marked **locked, not hidden** (D87) |
| Ledger | `listTransactions` `getTransaction` `historyFor` `coverageFor` | `v_transaction`, `v_allocations_public` |
| Writes | `postTransaction` `postFromLine` `voidTransaction` `markComplete` `allocate` | **RPC `post_transaction()` and `allocate_payment()` — the two seams (ADR-006)**. `post_ledger` authority or 403. No document → 422 (D85). VOID writes amount-before and amount-after (D84) |
| Inbox | `listInbox` `listInboxAll` `getInboxHealth` `resolveInbox` | `v_inbox_health` + RPC with five roads, none of which delete (D94). `resolve_inbox` authority |
| Incoming | `listIncoming` `listIncomingReview` `confirmIncoming` `listFundings` `getFunding` | views + RPC |
| Calendar | `getCashPlan` `listDue` `listComponents` `addComponent` `updateComponent` `setOverride` `linkPayment` `getMonthDetail` | **`v_cash_plan` computes twelve months from three tables; no projection is stored** (D109–D115) |

---

## `hr` — 26 functions

| Group | Functions | Lands as |
|---|---|---|
| People | `listEmployees` `getEmployee` `saveEmployee` | view + RPC. `hrd.*`; salary columns readable only with `payroll.read` |
| Attendance | `attendanceFor` `getTimesheet` `getDay` `importScans` `addScan` `markDay` `unmarkDay` | `v_timesheet_day` (the six slots, the day state, `day_value`) + RPCs. A manual tap carries a reason (D137); an unknown machine number is **reported, never created** (D143); re-upload is a no-op |
| Overtime | `listOvertimeSheets` `getOvertimeSheet` `createOvertimeSheet` `addOvertimeLine` `attachOvertimeDoc` `decideOvertimeSheet` `importOvertimeForm` | RPC. Leadership signs **after** HRD and only with the surat attached → 422 (D145); a staff session never waits on leadership (D146); signing a production sheet **posts progress** (D147) |
| Payroll | `listPayrollRuns` `getPayroll` `previewPayroll` `openPayroll` `approvePayroll` | `v_payroll_line` + `v_payslip_day`; **nothing stored** (A3). `previewPayroll` reads any period, run or not (D158). Approve refuses while a day is unread → 422 (D139), and needs `approve_funds` |
| Kontrak kerja | `listClauseChecklist` `listContracts` `getContract` `registerContract` `proposeClause` `confirmClause` `activateContract` `endContract` | `v_contract` + `contract_coverage()` + `contract_conflicts()`; klausul **tidak menulis apa pun** (A3). Yang dihasilkan adalah selisih terhadap `employees` dan buku aturan, dan menerapkannya lewat `saveEmployee` (D155). `proposeClause` adalah jalan untuk mesin: tidak pernah lahir terkonfirmasi, dan ditolak di atas klausul yang sudah ditandatangani. Kontrak yang berjalan boleh dilengkapi, tidak boleh diubah |
| Adjustments | `listAdjustments` `saveAdjustment` `removeAdjustment` | RPC. Reason required → 422; run not DRAFT → 403 (D155) |
| Evidence | `attachSuratDokter` | RPC — makes a sick day paid (D144) |

---

## `production` — 14 functions · `inventory` — 7 functions

| Function | Lands as | Note |
|---|---|---|
| `listStages` | seeded table | stages are data (Q35) |
| `listWorkOrders` `getWorkOrder` `listProgress` | `v_work_order` | late first, computed |
| `createWorkOrder` `recordProgress` `closeWorkOrder` | RPC | progress is append-only; a correction is a negative entry. `recordProgress` also accepts `approve_overtime` when the source is a signed sheet (D147) |
| `listProducts` `getProduct` `saveProduct` `saveBomComponent` `removeBomComponent` `materialsFor` `attachProductDrawing` | views + RPC | an unpriced component leaves the cost **incomplete**, never zero (D149) |
| `listLogPurchases` `getLogPurchase` `receiveLogs` `addLog` `reportBoards` `markLogSawn` | `v_log_purchase` + RPC | yield and Rp/m³ over **sawn logs only**; the seller's claim is kept beside ours (F46) |
| `timberByVendor` | `v_timber_vendor` | keyed by vendor **and species** — averaging mahoni into jati made the cheap species look like a cheap supplier |

---

## What the swap actually looks like

```ts
// src/lib/api/hr.ts — same name, same signature, same envelope
export async function getPayroll(runNo: string): Promise<Result<PayrollView>> {
  const { data, error } = await supabase
    .from("v_payroll_run").select("*").eq("run_no", runNo).single();
  if (error) return fail("hr", error);          // maps PostgREST → 403/409/422
  return ok("hr", data as PayrollView);
}
```

The envelope helpers (`ok`, `fail`, `refused`, `duplicate`) move out of
`src/demo/api/_kit.ts` into `src/lib/api/_kit.ts` unchanged — they already
produce the shape `03-api.md` specifies, which is why the screens do not care
which implementation answers.

**Order of the swap, one service at a time**, each behind the same flag:
`identity` → `documents` → `procurement` → `accounting` → `hr` →
`production` → `inventory`. Identity first because everything else's refusals
are meaningless until the database knows who is asking.

---

## Where the swap stands

`src/lib/api/` exists and typechecks against the same contracts the screens
read. What is in it:

| Module | Reads | Writes | Notes |
|---|---|---|---|
| `identity` | `me`, `listUsers` | `setModules`, `setAuthorities`, `signIn`, `signOut`, `recordSignIn` | **`actAs` is gone.** Against a real database it is an endpoint that lets anybody become anybody — not a feature with a guard missing, the absence of authentication. It stays in `src/demo`, where there is nothing to impersonate |
| `procurement` | the board (`listOpenLines`, `listAllLines`, `queue`, `decidedLines`, `listVariances`, `listLinesForWorkOrder`, `lineHistory`), the documents (`listPr`, `getPr`, `getPo`, `listPo`, `getPoDetail`), reference (`listVendors`, `listVendorViews`, `listItems`, `listItemViews`, `listUom`, `listCategories`, `listProjects`), money (`listRounds`, `getRound`, `roundEligible`, `listVendorJourneys`, `getVendorJourney`, `listReported`) | deciding (`approveLine`, `noteLine`, `explainVariance`, `answerFromChat`, `requestApproval`), the chain (`createPr`, `quickAddLine`, `addDraftLine`, `updateLine`, `submitPr`, `removeLine`), rounds (`syncRound`, `approveRound`, `transferRound`, `closeRound`), orders (`createPo`, `requestPoApproval`, `approvePo`, `issuePo`, `amendPoLine`, `closePo`, `setExpectedDelivery`, `markPoResent`), receiving (`createReceipt`, `confirmReceipt`), reference (`createVendor`, `curateVendor`, `mergeVendor`, `createItem`, `curateItem`, `updateVendorContact`) | every refusal is the database's; nothing is computed or reworded in TypeScript |

**`procurement` is now ported end to end.** Every function in `02-api.md`'s
inventory that carries a decision or creates a row has a seam, and every read
has a view. What remains unported is the small tail that needs another service
first: `paymentsForVendor` and `lineForPosting` want `acct`'s views, and
`saveProject` / `listProjectLines` / `saveProjectLine` / `removeProjectLine`
belong to `project` rather than to procurement's own chain.

`whereToBuy` reads `v_item_sources`, which exists; it needs a search predicate
rather than a seam, and that is a one-liner on the client when a screen asks
for it.

### The one line this cannot change itself

Screens import from `@/demo/api`. Pointing them here is **one re-export** in
`src/demo/api/index.ts`, guarded by `isRealApi()` — and that file belongs to
the design session. Per the protocol in `README.md`, the build session does not
edit it; this is the request:

```ts
// src/demo/api/index.ts
import { isRealApi } from "@/lib/api";
export * as procurement from isRealApi() ? "@/lib/api/procurement" : "./procurement";
```

— written as a real conditional rather than that pseudo-import, since ES modules
have no conditional export. The shape that works is a small re-export module
that picks at call time, or a build-time alias in `tsconfig.json`. Either is a
design-session change, and it is deliberately **not** 52 per-screen edits: those
are 52 chances to swap one screen and forget another, and a half-swapped app is
one where two screens disagree about the same number with no visible reason.
