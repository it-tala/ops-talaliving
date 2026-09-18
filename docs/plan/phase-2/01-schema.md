# The schema, table by table, in the order it has to be built

`02-database.md` is the reasoning — why a tap is a row, why an approval carries
the identity that answered it, why a variance is a row and not a note. This
file is the **build order**, and it is the only place the ladder is complete
and current as of M26.

Everything here is derived from `src/services/*/contracts.ts` and
`src/demo/state.ts`, which are the running shape — not from an earlier plan.

---

## Conventions, applied to every table without restating them

| Rule | How it looks |
|---|---|
| Primary key | `uuid … default gen_random_uuid()` |
| Public identity | a `*_no` / `code` text column, unique, minted by `core.next_doc_number()` (ADR-005) |
| Time | `timestamptz`, always. Dates that mean an office day are `date` and computed with `core.office_day()` (F17) |
| Money | `numeric`, whole rupiah. Never `float` |
| Deletion | none. No `DELETE` policy and no `DELETE` grant. Supersession, VOID, `left_on`, `merged_into`, `unlinked_at` (A2, A5) |
| Audit | every write seam calls `core.write_audit(…)` and `core.emit(…)` in the same transaction |
| RLS | on for every table. Read on `module.read`, write on `module.create` / `module.update`, decisions on `core.has_authority(…)` |
| Cross-schema references | by public code as `text`, never a foreign key across a service seam (ADR-004) |

The pattern is written out once, in `0006_procure_reference.sql`. Every later
migration repeats it; where one deviates, the deviation carries a comment
saying why.

---

## The ladder

`0001`–`0022` exist and apply from nothing; `core`, `procure` and most of
`acct` are built. The rest are specified here and not yet written.

| # | File | Tables | Notes that decide the shape |
|---|---|---|---|
| 0001 | `core_types` | — | every enum, six of the seven schemas (`ops_mkt` arrives with 0080). **Done**, and **corrected at B1** — see *Enums the contracts corrected* below |
| 0002 | `core_identity` | `users`, `user_modules`, `user_authorities`, `permission_catalog`, `v_my_access` | `has_permission()` / `has_authority()` — the only two functions a policy calls. **Done** |
| 0003 | `core_audit` | `audit_log`, `outbox`, `settings` | `write_audit()`, `emit()`. **Done** |
| 0004 | `core_numbers` | `doc_numbers`, `doc_prefixes` | `next_doc_number()`, ten prefixes. **Done** |
| 0005 | `core_files` | `attachments`, `attachment_links`, `doc_kind_labels` | file **or** link (D125); unlink is an update. **Done** |
| 0006 | `procure_reference` | `vendors`, `uom`, `uom_conversions`, `item_categories`, `items`, `projects`, `project_lines` | merge is a pointer; uncurated rows are allowed in (D30–D33). **Done**, and the units, conversions and categories are now **seeded** — they are foreign keys, so without them nothing could be inserted into the schema at all |
| 0007 | `core_auth` | — | **B5. Done.** Provisioning on sign-up, the sign-in trail, `set_modules()` / `set_authorities()`, `v_user_access`, `bootstrap_admin()`. `actAs` has nowhere to land |
| 0008 | `procure_pr` | `pr_documents`, `pr_lines`, `pr_approvals`, `line_notes`, `line_variances` | an approval carries **who answered and through which door** (F16, D19); a revision supersedes, never edits (A2); a variance is a row (F13, D98) |
| 0009 | `procure_requests` | `approval_batches`, `approval_requests` | one question, one answer, one channel — chat answers land here (D75–D79) |
| 0010 | `procure_rounds` | `payment_rounds`, `payment_round_lines`, `round_transfers`, `line_settlements` | TRANSFERRED ≠ PAID (D6); a round funds in instalments (D107) |
| 0011 | `procure_po` | `purchase_orders`, `po_lines`, `po_schedule` | terms with a guard, amendment by supersession (D132–D135); deposit earned on issue (F27, D99) |
| 0012 | `procure_receipts` | `receipts` | two documents, a receiver **and** a checker (D101); report and confirmation are separate acts (D131) |
| 0013 | `acct_ledger` | `accounts`, `transaction_types`, `transactions`, `transaction_lines`, `payment_allocations` | the five real accounts seeded; the leadership account is *locked*, not hidden (D87). **No document, no row** (D85); VOID never DELETE. Pulled forward from 0012–0014 because procurement's money views read it — see *Per schema, not per layer* |
| 0014 | `procure_views` | every procurement `v_*` | **Done.** The ladder, coverage, the meeting quadrant, the variance, the round, the PO's two axes with terms and the BLOCKED guard, the vendor journey, purchase facts |
| 0015 | `core_idempotency` | `core.idempotency_keys` | **Done.** `(service, endpoint, key) → response`. `ok`/`noop`/409 stored; 403/422/5xx not — storing a 422 would make a corrected resubmission return the old complaint for ever. Pulled forward from 0027: a seam written without it has to be opened again and threaded through |
| 0016 | `procure_seams` | procurement's write functions | **Done**, for the fifteen that carry a decision: `submit_pr`, `approve_line`, `remove_line`, `note_line`, `explain_variance`, `answer_request`, `approve_po`, `issue_po`, `amend_po_line`, `close_po`, `confirm_receipt`, `approve_round`, `transfer_round`, `merge_vendor`, `curate_vendor`. The creation seams are listed as outstanding in `02-api.md` |
| 0017 | `procure_create_seams` | procurement's creating functions | **Done.** `create_pr`, `quick_add_line`, `add_draft_line`, `update_line`, `request_approval`, `sync_round`, `close_round`, `create_po`, `request_po_approval`, `set_expected_delivery`, `mark_po_resent`, `create_receipt`, `create_vendor`, `create_item`, `curate_item`, `update_vendor_contact` |
| 0018 | `procure_detail_views` | `v_po_detail`, `v_pr_document` | **Done.** One row each, nested parts as jsonb — a drawer that needs three calls is one that renders in three stages |
| 0019 | `acct_review` | `evidence_inbox`, `bank_statements`, `statement_lines` | **Done.** Five roads out, none of them delete (F26, D94). For the two leadership accounts a statement is not a check on typed rows — it is the only way their rows exist (D180) |
| 0020 | `acct_views` | `v_account_balance`, `v_transaction`, `v_transaction_detail`, `v_allocation`, `v_vendor_payment`, `v_inbox_health`, `v_bank_statement`, `v_statement_suggestion` | **Done.** The database owns the balance (D9); the leadership figure is *locked, not hidden* (D87) |
| 0021 | `acct_seams` | `post_transaction`, `void_transaction`, `allocate_payment`, `supersede_allocation`, `resolve_inbox` | **Done.** The two money seams (ADR-006), `post_ledger` or 403 |
| 0022 | `acct_calendar` | `cash_components`, `cash_overrides`, `cash_settlements`, `cash_events()`, `v_cash_cell`, `v_cash_row`, `v_cash_position`, `v_cash_unplanned` | **Done.** Three tables and **no projection stored** (D109–D115). The engine is a set-returning function rather than a view, because claiming is sequential — see below |
| 0040 | `hr_people` | `employees`, `pay_rule_sets` | **Done.** `paid_leave_days` per person (D144); nobody is deleted, `left_on` retires. The rule book came here rather than into its own file because `employees` is the only table that reads it and a version is written once |
| 0041 | `hr_attendance` | `attendance_imports`, `attendance_scans`, `day_marks` | **Done.** One row per **tap** (D141); a mark never overrides a scan (D142); re-upload is a no-op (D143). `day_marks` gained `mark_no` — see C11 |
| 0042 | `hr_views` | `v_leave_used`, `v_day_mark_value` | **Done.** Where the marks reach the money (D144): the letter pays the day the moment it is linked, the entitlement is spent in date order, and neither is a column |
| 0043 | `hr_overtime` | `overtime_sheets`, `overtime_lines`, `v_overtime_stage`, `v_overtime_claim` | **Done.** Two kinds of sheet (D146); leadership signs **after** HRD (D145); `form_amount` is the GAJI column of the paper (D154). The stage is derived from the two signatures and the linked `surat_lembur`, never stored beside them |
| 0044 | `hr_payroll` | `payroll_runs`, `payroll_adjustments`, `v_payroll_overtime`, `v_payroll_run` | **Done, except the gross.** Payroll lines are **not a table** (A3); adjustments are typed, signed, reasoned and frozen once the run leaves DRAFT (D155). Also closes the half of D173 that `0040` could not: a rule version may not land inside a run's period. **`v_payroll_line` is not here** — see 0045 |
| 0045 | `hr_timesheet` | `ops_hr.day_reading`, `rules_on()`, `schedule_of()`, `break_allowance()`, `read_day()`, `timesheet()`, `v_timesheet_day` | **Done.** The six slots, the two-minute tap dedupe, the break allowance per schedule, and `review` the moment the reading fails. `read_day` is a function rather than a view for the reason `cash_events()` is: the slot rule is sequential, each slot taking the first remaining tap that fits |
| 0046 | `hr_holiday_rule` | redefines `read_day()`, `v_leave_used`, `v_day_mark_value`; adds `office_closed()` | **Done.** The owner's answer to F101 (D285). A closed day is closed for everybody, and — the part that is not in the sentence — it spends nobody's leave entitlement. A correcting migration rather than an edit to 0045, because the ladder is the record of what the system did before somebody asked |
| 0047 | `hr_gross` | `allowance_withholdings`, `hourly_rate()`, `is_rest_day()`, `tier_parts()`, `overtime_parts()`, `payroll_line()`, `v_payroll_line` | **Done.** The gross is `base + allowance + overtime − undertime − lateness`, and BPJS is not in it — it is a deduction taken after, so the gross needed no enrolment table. The paper beats the ladder where it speaks (D154); lateness is priced and applied only when the book says so (D251) |
| 0048 | `hr_contributions` | `contribution_scheme_t`, `contribution_rates`, `enrolments`, `rate_for()`, `enrolled_in()`, `contribution_base()`, `contribution_lines()`, `v_payroll_contribution`, `v_enrolment` | **Done.** The statutory half. `PPH21` is in the enum and never computed (D140, Q50). The rate is dated like the rule book; no rate for a month is **no figure rather than a zero**; the ceiling reports what it capped from; a part-month is billed whole with a sentence, because BPJS charges the month (D259). Membership numbers are masked on every read (D196) |
| 0049 | `hr_tasks` | `task_status_t`, `task_ref_t`, `tasks`, `v_task` | **Done.** The last two enums the contracts carried and the ladder never did. **Blocked is not overdue** (D261) — the single load-bearing rule of the module, computed in the view rather than left to whoever is reading. A reference is a kind and a code together or neither (ADR-004); cancelling says why; there is no DELETE, because that is how a delivery figure improves by forgetting |
| 0060 | `prod_master` | `bom_ref_t`, `products`, `bom_revisions`, `bom_components`, `v_product_bom`, `v_product_cost` | **Done.** Products are *made*, items are *bought* — different tables (D149); size is three numbers (D150); an unpriced component makes the total **null, never zero**. The BOM is versioned (D256), and writing is bounded to the **draft** in the policy: a blanket grant would have let a released revision be edited by deletion, which is the pinning D256 exists for. `bom_components` is unique on `(product_id, rev, ref_code)`, not `(product_id, ref_code)` as `02-database.md` still said — that key predates revisions. Adds one additive policy to `ops_procure.items`, see F104 |
| 0061 | `prod_orders` | `route_t`, `process_stages`, `stage_sources`, `retired_stages`, `routes`, `route_stages`, `work_orders`, `v_work_order_stage` | **Done.** Four stages, not seven. Three seeded tables rather than one, because the roll-up needs the old codes: the four, every code that counts towards one of them (each stage its own source, F74), and the retired ones that count towards none. `bom_rev` pins to a **released** revision, enforced by trigger because neither half of that is a foreign key |
| 0062 | `prod_progress` | `progress_source_t`, `progress_entries`, `v_wo_stage_progress`, `v_wo_retired_work`, `v_work_order` | **Done, minus the legs.** Append-only, no UPDATE and no DELETE **grant** — so an edit is a hard refusal rather than `UPDATE 0`, which a caller can read as *nothing matched*. The roll-up is a **minimum over the sources that spoke**, never a sum (F74), and `recorded` is kept apart from `done = 0` (F92). More of a stage than the order has pieces is refused; so is a correction past zero, on the same argument. D147's second door: `approve_overtime` may post an `overtime_sheet` entry without holding the production module, and the same sheet twice adds nothing. **`v_work_order` carries no `at_vendor`, `days_at_vendor` or `subcon_overdue`** — see 0063 |
| 0063 | `prod_vendor_legs` | `vendor_process_t`, `vendor_processes`, `vendor_legs`, `v_vendor_leg`, and `v_work_order` completed | **Done.** A row per trip (W6, D280), because four columns could describe one. Vendor processes are **their own vocabulary**, not the four stages — `JOK` is not a stage and `BARANG_MENTAH` happens before the first one. What came back is a **quantity, not a tick**; late is measured only against a promise (D134); and `goods_on_site` is a quantity too, so six of twelve away leaves six to work on (F75). D255's refusal is enforceable at last, and only against positive entries — a correction is how somebody fixes a figure recorded before the pieces left. Second additive policy on `ops_procure`, this time `vendors` (F104) |
| 0064 | `hr_kpi` | `kpi_measure_t`, `kpi_card_t`, `kpi_measures()`, `kpi()`, `v_kpi_run` | **Done, and not at 0050.** The ladder reserved 0050 inside HR's block; the card reads `ops_prod.progress_entries`, which 0062 creates. It *would* have applied at 0050 without complaining — the function is PL/pgSQL, so the name is not resolved until something calls it — and a migration that needs a later one is wrong even when Postgres lets it through. Three measures, each carrying its own basis in words; a thin one is null rather than confidently 100%; the score is withheld below `kpi.min_measures` (D261). Production work is shown, attributed and never scored (D264). See F109 |
| 0065 | `prod_bom_explode` | `released_rev()`, `start_rev()`, `bom_exploded_line`, `explode_bom()`, `bom_explosion_t`, `explode_summary()` | **Done, and not at 0063** — the ladder gave it a number 0063 already had. The recursive walk (D257): waste **compounds**, so ten per cent more drawer boxes is ten per cent more of the plywood inside each one; the same material reached by two routes is **one line with both routes named**, because *why do I need a hundred and forty-eight screws* is the next question; a sub-assembly with no released revision **stays in the list as itself**, named as unexploded, rather than being dropped; and a **cycle is reported** rather than walked, because a recursion that simply stops leaves the list short with no reason given. The revision is read two ways on purpose: the product being asked about at its **draft**, every sub-assembly beneath it at its **released** (D175). No new policy — it reads through the door 0060 opened, which is what the reader without it sees, F112 |
| 0066 | `prod_purchase_request` | `wo_requirements()`, `request_materials()`, `v_wo_materials`, `v_project_cost` | **Done.** The button D238 confirmed and nothing had built. Its point is not convenience but D151: the BOM says what a run **should** need, the request raised from it is what somebody **went out to buy**, and `pr_lines.source_wo_no` — a column procurement has carried all along and nothing ever wrote to — is what makes the two sums comparable. A **draft**, never submitted: a bill of material is a requirement, not a decision to spend money. The quantities come from the revision the order was **pinned** to, never today's newest release. **One road**: the seam assembles lines and hands them to `create_pr`, so the authority stays procurement's and a foreman who should raise his own is granted it — see Q54. A looped BOM is the one warning that is a refusal, because a request built from it looks exactly like a correct one. No fifth additive policy (F111): what the reader may not see is **withheld as null**, with `procurement_visible` and `ledger_visible` saying so, rather than summed to a nought that reads as *nobody has asked yet* |
| 0070 | `inv_timber` | `log_purchases`, `log_pieces`, `sawn_boards`, `log_volume_m3()`, `v_log_purchase`, `v_timber_by_vendor` | **Done.** Inventory takes the 0070 block. Two volumes with a saw between them (D153); the seller's claim kept **beside** ours and never resolved into one figure; yield and `cost_per_sawn_m3` over the logs **actually sawn** and over their share of the invoice, because the whole-load reading gives 34% where the sawyer is getting 57% and prices the wood half again too high; vendors compared **within a species**. Round and square are 21% apart (Q39), so `measure` is on the purchase and never assumed. The nota arrives on the evidence road, not on a column — C14. Third additive policy on `ops_procure.vendors` (F104) |
| 0071 | `inv_stock` | `stock_move_kind_t`, `stock_locations`, `stocked_categories`, `stock_settings`, `stock_moves`, `v_stock_by_location`, `v_stock_item` | **Done.** **No quantity column anywhere** — on-hand is `sum(qty)` over the moves (A3, D170). Append-only: a mistake is another move with a reason. The average is over **priced incoming** moves only and issues are not valued at all (Q43, D172); an unpriced arrival is counted and left out of the value rather than valued at nought. An unstated minimum is not a satisfied one. Which categories sit on a rack is **data**, not a constant — see F110. Fourth additive policy on procurement, F111 |
| 0080 | `mkt_referrals` | **new schema `ops_mkt`**; `referral_status_t`, `sales_reps`, `referrals`, `v_referral`, `v_rep`, and `v_project_cost` completed | **Done.** The seventh schema, and only the half of the Package programme that has money in it (D185, D186) — the outreach funnel is a migration of its own and nothing here needs it. Commission is **derived on every read** from the **project's** contract value, not from a copy beside the referral: C15, and the first time D186's *a contract that exists* could actually be checked rather than trusted to whoever typed it. `WON` needs a project code and a value behind it; one project pays once; a rate that has been paid against is frozen, because moving it restates commissions the ledger has settled (F114). Completes `v_project_cost` with what the job was **sold** for and what its introduction **costs**, and **deliberately no margin column** — subtracting a materials projection from a contract value is D151's category error one column further on. One read policy, written once, naming marketing **and** accounting: F111's lesson applied before the fact rather than after four of them |
| 0081 | `mkt_outreach` | `outreach_stage_t`, `stage_rank()`, `markets`, `properties`, `property_agents`, `scrape_rows`, `v_market`, `v_property_agent`, `v_property`, `v_followup_queue`, `v_scrape_by_market`, `pipeline()`, `funnel()` | **Done.** The other half of the Package programme (D183). **MOVE ON is not a column** — seven silent days since `sent_on` is a predicate, and the seven is a *setting*, so moving it moves today's queue and rewrites no history. The clock is **stamped in a trigger, not typed**: the first message starts it, a reply stops it wherever on the ladder the answer arrives, and a chase does not restart it. A property is at the **furthest** stage one of its agents reached and at no other, so the funnel adds up to the properties. `RECYCLED` and `SKIP` are **exits, not rungs** — see F115, the reason rank is a function rather than the enum's own order. A market code is `COUNTRY[-REGION]-CITY-AREA` and every filter is a **prefix** of it, enforced rather than hoped for (D187); a time zone is checked against Postgres, because *what time is it there* is the one question a list of names cannot answer. No reply rate over nought messages. `properties.ref` is **not** minted here and that is not an ADR-005 breach: `TL-0001` is an outside reference, like a vendor's invoice number |

Production takes **0060 upward**, leaving 0050–0059 for HR's remaining rows,
so the two can be picked up in either order. HR starts at **0040**, not 0023. Two build sessions are running against one
ladder — accounting and procurement are being taken to production and own the
numbers from 0023 — and two sessions choosing one filename is a merge conflict
in the single place where the resolution is not obvious: the order the ladder
applies in. `rebuild.sh` applies in lexical order and never asks why 0023 is
missing, so the gap costs nothing.

**Smoke files had the same problem and now have the same fix.** HR's first two
landed as `08_hr` and `09_hr_payroll` against `main`'s `08_core_files` and
`09_acct_statement`; renumbering them to 11 and 12 collided again one merge
later, with `11_core_activity_log`. Git says nothing either time — the
filenames differ, so there is nothing for it to conflict on — and `smoke.sh`
runs whatever is in the folder, so a duplicate prefix costs no failure and
buys real confusion about what ran in what order.

Taking the next free number at merge time is what produced the second
collision, so the rule is the one the migrations already use: **HR's smokes
have their own block, `40`–`44`, mirroring `0040`+.** A block cannot collide
with a sequence, and neither session has to look at the other's directory
before pushing.

**Three HR tables are still unbuildable, and it is not a design gap.**
`tasks`, `enrolments` and `contribution_rates` need `task_status_t`,
`task_ref_t` and `contribution_scheme_t`. All three are in
`src/services/hr/contracts.ts`, none is in `0001_core_types.sql`: they arrived
with M50 and M51, after the ladder's type file was written. They are added
with the tables that need them, so neither migration is a file of loose types
waiting for its tables.

The numbers past `0019` are left open on purpose. Each remaining schema takes
its tables, its views and its seams together, and how many files that is depends
on the schema — HR's payroll view is a migration on its own; inventory's whole
surface is smaller than that.

### Per schema, not per layer

The first cut of this table ended with `0025 views` and `0026 seams`: every view
in the system in one migration, every write function in the next. That is the
horizontal order, and `03-estimate.md` had already argued against it in its own
*Suggested order* — *finish `procure` end to end before starting `acct`; a
vertical slice proves the pattern, four horizontal layers prove nothing until
the last one lands.*

Building it settled the argument. Three things only show up vertically:

- **A view needs tables from the next schema down.** `v_pr_line_status` cannot
  compute coverage without `acct.payment_allocations` and the VOID status of the
  transaction behind it. Written in layer order, procurement's central view
  would have been unrunnable until accounting's tables landed nine migrations
  later — which means unreviewed, and un-smoke-tested, for most of the build.
- **The definition of done is per schema.** "Its schema has a `smoke.sql` that
  proves a refusal and a derivation" cannot be satisfied by a schema whose
  derivations live in a migration that does not exist yet.
- **Idempotency is not a late layer.** `0027` in the first cut; a seam written
  without it has to be opened again and threaded through, and a seam opened
  twice is a seam whose audit and outbox rows get rearranged by somebody who has
  forgotten why they were in that order.

So `0013` (`acct_ledger`) is pulled forward ahead of procurement's views, and
`0016` (idempotency) ahead of its seams. Both are dependencies, not preferences.

---

## Enums the contracts corrected

`0001` was written against `02-database.md`; the running shape is
`src/services/*/contracts.ts`. Eleven enums had drifted, and every one of them
would have surfaced as a failed insert on the day the matching screen was
swapped — the most expensive moment to find it, because by then the screen, the
view and the seam are all suspects.

| Enum | `0001` said | The contracts say | Why the contracts win |
|---|---|---|---|
| `procure.line_status_t` | 10 values incl. `REQUESTED`, `HOLD`, `REJECTED`, `APPROVED_UNPAID` | 7: `DRAFT`, `WAITING FOR APPROVAL`, `APPROVED`, `PAID`, `PARTIAL`, `COMPLETED`, `REMOVED` | `HELD`/`REJECTED` went in D28, `WAITING FOR PAYMENT` in D126. `APPROVED_UNPAID` and `PAID_UNAPPROVED` were never statuses — they are the meeting quadrant, now its own `meeting_state_t` |
| `procure.channel_t` | `app`, `chat`, `meeting` | `web`, `chat`, `sheet`, `script`, `api` | a meeting is a room, not a channel. What the record must carry is which system authenticated the person who said yes (D69, F16) |
| `procure.receipt_condition_t` | 4 | 7, spaces and all | `PARTIALLY DAMAGED` and `RETURN TO SENDER` are conditions the running system records, and only two of the seven count toward completion (A18) |
| `procure.receipt_status_t` | + `DISPUTED` | `REPORTED`, `CONFIRMED` | a dispute is a *condition* on the receipt. A status as well would give one fact two homes |
| `procure.po_status_t` | + `PARTIAL` | `DRAFT`, `ISSUED`, `CLOSED`, `CANCELLED` | how much has arrived is the other axis, computed and never stored (A1) |
| `procure.item_kind_t` | `material`, `consumable`, `service`, `asset` | `goods`, `service` | the only distinction that changes behaviour is whether anything was ever going to be delivered (D25). The rest is what `item_categories` is for |
| `procure.due_rule_t` | + `days_after_delivery`, `fixed_date` | `on_issue`, `on_delivery`, `date` | two rules nobody wrote a screen for |
| `acct.direction_t` | `in`, `out` | `IN`, `OUT` | it is what the rows say. Lower case fails on the first real insert and on every imported row |
| `acct.trx_status_t` | `DRAFT`, `POSTED`, `VOID`, `INCOMPLETE` | `POSTED`, `COMPLETED`, `UNTRACKED`, `VOID` | no document, no row (D85), so there is no DRAFT. `UNTRACKED` is money that legitimately names no request (D83) |
| `acct.alloc_method_t` | `line`, `order`, `round`, `manual` | `transfer`, `cash`, `other` | those were the allocation's *target*, which `pr_line_no`/`po_no` already carry. Storing it twice is storing a disagreement |
| `acct.inbox_origin_t` / `_status_t` | `upload/chat/email/bank`; no `CANCELLED` | `chat/web`; `CANCELLED` | two doors exist, not four. And withdrawing a document is not the same act as accounting rejecting it — the difference is who to ask about it |
| `prod.work_order_status_t` | + `IN_PROGRESS` | `OPEN`, `DONE`, `CANCELLED` | how far along it is comes from the progress entries (A3) |
| `core.doc_kind_t` | 13 | 14 | `laporan_lembur` was missing; a staff session's own report is a kind the screens already file (D146), and a kind the database cannot store is evidence that lands under `other` |

### Link entities the later schemas will need

`ops_core.link_entity_t` covers what `core`, `procure` and `acct` attach to.
M32–M57 added screens that file evidence against parents whose schemas do not
exist yet — `design_task`, `packing_box`, `delivery`, `snag`, `installation`,
`handover`, `enrolment`, `statement_line`, `employee_document`,
`leave_request`, `bom`, `board_move`, `stock_move`.

Each belongs with the migration that creates its table, not here: an enum value
for a parent that cannot exist is a value nothing can point at. The session
that builds `hr`, `prod`, `delivery` or `marketing` adds its own.

**Most of what looks like a link entity is not one.** `activity`, `session`,
`setting`, `user`, `vendor`, `item` and thirty others are
`ops_core.audit_log.entity`, which is `text` and deliberately unconstrained —
the trail has to be able to name anything that happened, including a thing
whose table was dropped afterwards.

### The one derivation that is a function, not a view

Everything derived in this system is a view, with one exception: the payment
calendar's `acct.cash_events()`.

The reason is **claiming**. A ledger row may be counted once, and which planned
line gets it depends on how specific that line is — a dated one-off takes its
own payment before the standing line for that category sweeps it up (D110).
That is a loop with state: each line claims, and the next sees a smaller pool.
A pure SQL view could be made to produce something similar with window
functions, and it would be a *reimplementation* of the rule rather than a port
of it — which is the one thing `0014`'s header says not to do.

It is still computed on read. A3 is about not storing a derived figure, not
about which language derives it.

### The shadowing rule, and why it is a script

Five separate times this session, a PL/pgSQL local shared a name with a column
— `covered`, `code`, `round_no`, `trx_no` — and Postgres refused the query as
ambiguous. It is right to refuse; the problem is **when**. The migration
applies, the function is created, and the failure waits for whichever branch
reaches that line. Two of the five were found by a smoke test; the others would
have been found by a user.

Five of those is not five mistakes, it is a missing check. So:

- **every local is prefixed `v_`, every argument `p_`**, and
- `supabase/local/check_shadowing.sh` reads the `declare` blocks out of the
  migrations, compares them against every column in the seven schemas, and fails.
  `smoke.sh` runs it first, before any assertion.

It found twelve more that nothing had reached yet.

### Three bugs the smoke found that reading would not have

Worth recording, because each one applies cleanly and fails only when exercised
— which is the argument for a smoke file over a careful review:

- **`amend_po_line` inserted the new line before retiring the old one.** Both
  were live for an instant, both claiming the vendor's line number, and
  `po_lines_live_no_idx` refused it — correctly. The supersession foreign key is
  now `deferrable initially deferred`, so the old row can point at a line that
  does not exist yet; the check still runs before commit, so a dangling pointer
  is impossible and merely allowed to be momentary.
- **A PL/pgSQL variable named `covered` shadowed a column of that name.**
  Postgres refuses the query rather than guessing, at run time.
- **`text[] || 'a literal'`** resolves to array-concatenation, not
  element-append, and fails when the branch is finally reached — which for a
  close-blocker message is the first time an order is genuinely unclosable.

Two more corrections, both found the same way:

- **`0006` seeded nothing.** `items.base_uom` and `items.category_code` are
  foreign keys, so a schema with no `uom` and no `item_categories` rows is one
  that accepts no items at all. The eighteen units, four conversions and ten
  categories are now in the migration.
- **`00_shim.sql` used `create if not exists` and `rebuild.sh` never dropped
  `auth`.** So an edit to the shim did nothing on a cluster that had already run
  once, which made the shim the single part of the ladder that only worked
  against yesterday's database — the exact failure `rebuild.sh` exists to
  prevent. It drops and recreates its own schema now.

---

## The derivations — the real work of Phase 2

Phase 1 computes on read, in TypeScript. **2.583 lines** of it:

| File | Lines | What moves where |
|---|---|---|
| `src/demo/derive.ts` | 1.588 | line status, PR coverage, round summaries, PO journeys, vendor journeys, ledger allocations, the cash plan, inbox health → `v_pr_line_status`, `v_po_line_status`, `v_round_summary`, `v_vendor_journey`, `v_cash_plan`, `v_inbox_health` |
| `src/demo/hr-derive.ts` | 533 | the six slots from taps, day state and `day_value`, the payroll line, the payslip week, lateness → `v_timesheet_day`, `v_payroll_line`, `v_payslip_day` |
| `src/demo/production-derive.ts` | 275 | stage progress, work-order state, BOM material cost → `v_work_order`, `v_bom_cost` |
| `src/demo/inventory-derive.ts` | 187 | log m³ by convention, yield over sawn logs only, Rp/m³ per vendor **per species** → `v_log_purchase`, `v_timber_vendor` |

Two rules for the port, both learned the hard way in Phase 1:

- **A view may return a missing figure. It may not return a wrong one.** Where
  the demo marks a total *belum lengkap* (an unpriced BOM component, a partly
  sawn load), the view returns `null` plus a count — never a silent zero.
- **Port the test with the logic.** Each derivation view gets rows in
  `smoke.sql` that reproduce a number this project already argued about: Kayu
  Manis at Rp 34,6 juta/m³ papan (F46), Karjo's 1,5 paid days out of five days
  with hours on them (F48), a round marked TRANSFERRED that is still not PAID.

---

## Seeds

| Seed | Source of truth | Why it is a seed and not a form |
|---|---|---|
| `core.permission_catalog` | `src/lib/roles.ts` | adding a verb should be a reviewable diff, not a row somebody types (D24) |
| `core.doc_prefixes`, `core.doc_kind_labels` | `src/services/documents/contracts.ts` | the label a screen prints, beside the code the database stores |
| `acct.accounts` | the five real accounts | PETTY CASH · BNI 325 · BCA 271 · JAGO · BCA 064 (D87) |
| `acct.transaction_types` | the running system, `EJO` included | carried verbatim and unclassified, never folded into OTHERS (Q10) |
| `procure.uom` + conversions | `src/demo/fixtures/reference.ts` | including the log→board yield, which is a different kind of number from a factor |
| `prod.process_stages` | seven stages | data, so reordering is a seed diff (Q35) |

---

## Contract changes the schema forces

The build session appends here; the design session applies them to
`src/services/*/contracts.ts` in its own commit (see the protocol in
`README.md`).

| # | Contract today | Schema | Why the schema wins |
|---|---|---|---|
| C1 | `DocKind` is a display string: `"Receipt / Invoice / Nota"` | `core.doc_kind_t` is a code: `nota` | a stored value should not change when somebody rewords a label. `core.doc_kind_labels` holds the wording, and the UI reads it from there |
| C2 | ids are readable strings (`emp_04`, `lbr_03`) | `uuid` | the demo's ids are for humans reading fixtures. The swap is mechanical; nothing outside `src/demo` depends on their shape |
| C3 | `ModuleGrant[]` on the session | `core.user_modules` rows + `v_my_access` | the permission list stays **derived** on read, not stored (A3) |
| C4 | `AttendanceScan.import_id` optional | `hr.attendance_imports.id`, NOT NULL for `source='import'` | a tap that came from a file should always name the file, or a re-upload cannot be proved to be a no-op (D143) |
| C5 | `NewLineInput` is declared inside `src/demo/api/procurement.ts` | it is a **request shape**, not a demo detail | both clients take it, and `src/lib/api` must not import from `src/demo` or the two stop being swappable. It is duplicated in `src/lib/api/procurement.ts` today; move it to `src/services/procurement/contracts.ts` and let both read it |
| C6 | `createPr` and `quickAddLine` take `project_id` | the seams take `project_code` | the code is what crosses every seam (ADR-004) and what a caller already has. `project_id` stays accepted by the demo; the real client sends the code |
| C7 | `createPo` takes `vendor_id` | `procure.create_po()` takes `vendor_code` | same reason. Also the reason `mergeVendor` now takes two codes rather than two uuids |
| C8 | `createReceipt` takes `DocKind` display strings | `core.doc_kind_t` codes — `goods_photo`, `delivery_note` | C1, applied at the one call site that passes kinds in rather than reading them out |
| C9 | `attachment_links` fixtures write `entity: "overtime"` | `ops_core.link_entity_t` says `overtime_sheet` | every other value in that enum names its table — `pr_line`, `receipt`, `purchase_order`. `overtime` is the one outlier, and two names for one parent is how a strip ends up half empty. Nothing breaks today: `hr` is not built yet |
| C10 | `LinkEntity` lists `"po"` and `"overtime"` | the code writes `purchase_order` (12×) and `overtime_sheet` (5×) | the **type** is stale against its own call sites, not the schema. No schema change; the type is what needs correcting |
| C11 | `DayMark` has an `id` and no public code; the demo links a `Surat Dokter` with `entity_no: mark.id` | `ops_hr.day_marks.mark_no`, `dmk-26-09-18_01`, from `next_doc_number()` | `attachment_links.entity_no` is a **public code, never a uuid** (ADR-004). In the demo `dmk_03` is both; against a database they are different things, and a mark that can be paid has to carry the code. `rcv` was added to `doc_prefixes` for exactly this reason. The audit trail keeps writing `work_date/employee_no` — that is a key for people to read, and a different job |
| C12 | `VendorLeg.vendor_id`, described as *a public vendor id* | `ops_prod.vendor_legs.vendor_code`, holding `ops_procure.vendors.code` | C11 again, and the third time the demo's ids have been both things at once. An id is readable and quotable in fixtures, so *public code* and *primary key* are the same string there and only come apart against a database. Every cross-service reference here is a code (ADR-004) |
| C13 | `ContributionRate.confirmed`, and `ContributionLine.total` | `ops_hr.contribution_rates.rate_confirmed` and `total_amount` | not the schema winning an argument — `check_shadowing` compares locals against **every column name in all six schemas**, so these two turned locals in an *applied* procurement migration into findings, and since 0028 an applied migration may not be edited. The unapplied side yields. F108 |
| C14 | `LogPurchase.nota_attachment_id`, a uuid on the row | a link in `core.attachment_links` with `entity = 'log_purchase'`, `kind = 'nota'` | **one road for evidence, and no second one** (ADR-010, D91–D92). The enum already carried `log_purchase`, so the road was designed for this and the column is the demo's shortcut. `v_log_purchase.has_nota` reports it; nothing refuses a load for want of paper (A6, D201) |
| C15 | `Referral.contract_value`, typed in beside `project_code` | read from `ops_procure.projects.contract_value`; the column is **dropped** | two places holding one number, and the first contract revision makes them disagree — the commission is then computed off the stale one with nothing saying so (A3). The referral names the project by code and the value comes from the project. It also makes D186's refusal real: *a contract that exists* was a sentence the seam trusted the typist for, and is now a trigger |
| C16 | the demo reads the follow-up line from setting `ops.agent_move_on_days` | `mkt.agent_move_on_days` | `ops` is the **legacy system's own schema**, and `check_schema_isolation.sh` reads schema-qualified names out of a migration — so a settings key beginning `ops.` reads as a reference to it and the file is refused. The guard is what makes sharing one Supabase project with the running legacy system safe, so the key moved rather than the guard. `kpi.` set the precedent (F116) |
