-- 0014_procure_views.sql — every derived fact in procurement, computed on read.
--
-- This file is the port of `src/demo/derive.ts`, and it is the migration that
-- decides whether the swap is honest. The demo computes these numbers in
-- TypeScript, in a browser, from fixtures; the screens have been read against
-- them for 26 milestones and the owner has argued about several of them by
-- name. **The view has to produce the same number, or the swap is a rewrite
-- wearing the same function signatures.**
--
-- Two rules for the port, both learned in Phase 1:
--
--   * **A view may return a missing figure. It may not return a wrong one.**
--     Where the demo marks a total incomplete, the view returns null plus a
--     count — never a silent zero.
--   * **Port the test with the logic.** `smoke/03_procure.sql` reproduces
--     numbers this project has already argued about.
--
-- Nothing here is stored. Status, coverage, the meeting quadrant, the variance,
-- what a vendor could invoice today — all of it is computed from the rows, every
-- time, because a stored status is one that disagrees with the rows behind it
-- (A3). That is also why these views are long: the arithmetic has to live
-- somewhere, and the alternative is a column somebody has to remember to update.

-- ── the current decision ──────────────────────────────────────────────────
-- Approval is append-only (D28), so the current answer is the latest row.
-- `distinct on` with an explicit tiebreak: two approvals can share a timestamp
-- when a batch is answered in one transaction, and without the id in the sort a
-- tie would resolve differently between two runs of the same query.
create or replace view ops_procure.v_line_approval as
  select distinct on (a.line_id, a.step)
         a.line_id, a.step, a.approved, a.approved_qty, a.approved_amount,
         a.recorded_by, a.recorded_by_email, a.recorded_at, a.channel, a.id
    from ops_procure.pr_approvals a
   order by a.line_id, a.step, a.recorded_at desc, a.id desc;

create or replace view ops_procure.v_line_note as
  select distinct on (n.line_id)
         n.line_id, n.id, n.instructions, n.remark,
         n.recorded_by, n.recorded_by_email, n.recorded_at
    from ops_procure.line_notes n
   order by n.line_id, n.recorded_at desc, n.id desc;

-- Sent to the approver and not answered. Answered means answered — a line the
-- approver decided in the app instead leaves the card standing, and the chat
-- screen marks it stale rather than pretending the question is still open (D69).
create or replace view ops_procure.v_pending_request as
  select distinct on (r.line_id)
         r.line_id, r.id, r.batch_id, r.token, r.sent_to, r.sent_to_email,
         r.sent_by, r.sent_by_email, r.sent_at, r.channel, r.meeting_note
    from ops_procure.approval_requests r
   where r.answered_at is null
   order by r.line_id, r.sent_at desc, r.id desc;

-- ── money that actually reached a line ────────────────────────────────────
-- Allocations count only while the transaction behind them still exists and has
-- not been voided. "A stamp pointing at nothing is not paid" (A10), and a voided
-- payment must pull its coverage back with it — which is the whole reason this
-- is a join to `ops_acct.transactions` and not a sum over the allocation table.
create or replace view ops_procure.v_line_funding as
  select al.pr_line_no,
         sum(al.amount)                                   as covered,
         array_agg(t.trx_no order by t.trx_date, t.trx_no) as trx_nos
    from ops_acct.payment_allocations al
    join ops_acct.transactions t on t.id = al.trx_id
   where al.superseded_by is null
     and al.pr_line_no is not null
     and t.status <> 'VOID'
   group by al.pr_line_no;

create or replace view ops_procure.v_line_coverage as
  select l.id as line_id,
         l.line_no_full,
         -- The fallback is load-bearing. A line with no approved amount is
         -- covered against what was ASKED, so an unapproved line never looks
         -- settled — which is exactly the corner `paid_unapproved` lives in.
         case when ap.approved is true
              then coalesce(ap.approved_amount, l.item_total, 0)
              else coalesce(l.item_total, 0)
         end as approved,
         coalesce(f.covered, 0) as covered,
         greatest(
           case when ap.approved is true
                then coalesce(ap.approved_amount, l.item_total, 0)
                else coalesce(l.item_total, 0)
           end - coalesce(f.covered, 0), 0) as remaining,
         -- Settled by payment, **or** by a named human decision with a mandatory
         -- reason. Never by a silent tolerance (A12).
         (case when ap.approved is true
               then coalesce(ap.approved_amount, l.item_total, 0)
               else coalesce(l.item_total, 0)
          end > 0
          and coalesce(f.covered, 0)
              >= (case when ap.approved is true
                       then coalesce(ap.approved_amount, l.item_total, 0)
                       else coalesce(l.item_total, 0)
                  end) - ops_core.money_tolerance())
         or s.line_id is not null as settled,
         coalesce(f.trx_nos, '{}') as trx_nos
    from ops_procure.pr_lines l
    left join ops_procure.v_line_approval ap on ap.line_id = l.id and ap.step = 'GOODS'
    left join ops_procure.v_line_funding  f  on f.pr_line_no = l.line_no_full
    left join ops_procure.line_settlements s on s.line_id = l.id;

-- ── receiving ─────────────────────────────────────────────────────────────
-- Two tests, and both have to pass, in one definition used everywhere a receipt
-- becomes money — because two definitions would disagree within a month.
--
--   condition — only GOOD and the received part of PARTIALLY DAMAGED count;
--               everything else leaves the line open (A18)
--   status    — only CONFIRMED counts. An arrival reported at night and not yet
--               acknowledged in writing is a fact worth recording and not yet a
--               thing we owe for (D131)
create or replace function ops_procure.receipt_counts(
  p_condition ops_procure.receipt_condition_t,
  p_status    ops_procure.receipt_status_t)
returns boolean language sql immutable as $$
  select p_status = 'CONFIRMED' and p_condition in ('GOOD','PARTIALLY DAMAGED')
$$;

create or replace function ops_procure.receipt_is_problem(p_condition ops_procure.receipt_condition_t)
returns boolean language sql immutable as $$
  select p_condition in ('WRONG ITEM','RETURN TO SENDER','DAMAGED','MISSING PARTS')
$$;

create or replace view ops_procure.v_line_receiving as
  select r.line_id,
         sum(r.qty_received) filter (
           where ops_procure.receipt_counts(r.condition, r.status))          as received_qty,
         -- Reported against this line and not yet confirmed — shown, never
         -- counted. "It is here but the paperwork has not caught up" is a real
         -- state somebody has to chase every morning.
         sum(r.qty_received) filter (where r.status = 'REPORTED')        as reported_qty,
         bool_or(ops_procure.receipt_is_problem(r.condition))                as has_problem
    from ops_procure.receipts r
   where r.line_id is not null
   group by r.line_id;

-- ── evidence ──────────────────────────────────────────────────────────────
-- Evidence reaches a line two ways: attached to the line itself, or attached to
-- a transaction that funded it. The second path is what makes a receiving photo
-- visible on every ledger row that paid for the line, and a payment proof
-- visible on the line it settled.
create or replace view ops_procure.v_line_evidence as
  with direct as (
    select l.id as line_id, k.kind, 1 as counts_as_own
      from ops_procure.pr_lines l
      join ops_core.attachment_links k
        on k.entity = 'pr_line' and k.entity_no = l.line_no_full
       and k.unlinked_at is null
  ), via_money as (
    select l.id as line_id, k.kind, 0 as counts_as_own
      from ops_procure.pr_lines l
      join ops_acct.payment_allocations al
        on al.pr_line_no = l.line_no_full and al.superseded_by is null
      join ops_acct.transactions t on t.id = al.trx_id and t.status <> 'VOID'
      join ops_core.attachment_links k
        on k.entity = 'transaction' and k.entity_no = t.trx_no
       and k.unlinked_at is null
  ), all_kinds as (
    select * from direct union all select * from via_money
  )
  select line_id,
         array_agg(distinct kind) as kinds,
         -- The strip on the row counts what is filed **on the line**; the kinds
         -- above include what is filed on the money, because that is what
         -- answers "is this paid for". Two questions, two numbers.
         count(*) filter (where counts_as_own = 1) as evidence_count,
         bool_or(kind = 'transfer_proof')          as has_payment_proof,
         -- Does anything stand behind this request — a shop link, an invoice, a
         -- bill, an order? Nobody should be asked to approve a number with
         -- nothing behind it (D125).
         bool_or(kind in ('quotation','nota','purchase_order','other')) as has_support
    from all_kinds
   group by line_id;

-- ── the one ladder ────────────────────────────────────────────────────────
-- COMPLETED means the FULL chain exists: request, approval, payment, payment
-- proof, and — for goods — a receiving report. Missing any piece and it is not
-- completed. This is the anti-fraud line (A11).
--
-- A **service** line completes on payment proof alone (D25): mowing the grass
-- and the electricity bill never get delivered, and they used to sit at PAID for
-- ever because the model had no way to say so.
--
-- A line with no quantity that is not a service — a PO deposit, say — cannot
-- reach COMPLETED here at all, and should not: the goods arrive against the
-- purchase order, whose two axes carry delivery separately (A1).
create or replace view ops_procure.v_pr_line_status as
  select l.id as line_id,
         l.line_no_full,
         case
           when d.status = 'DRAFT' then 'DRAFT'
           when l.removed_at is not null then 'REMOVED'
           when cov.settled
            and ev.has_payment_proof
            and not coalesce(rc.has_problem, false)
            and (i.kind = 'service'
                 or (l.qty is not null and l.qty > 0
                     and coalesce(rc.received_qty, 0) >= l.qty))
             then 'COMPLETED'
           when coalesce(rc.received_qty, 0) > 0 then 'PARTIAL'
           when cov.settled then 'PAID'
           -- One value for approved-and-unpaid, whether or not a round has money
           -- in it for this line. TRANSFERRED never meant a vendor was paid
           -- (A10) — and it never meant the money was reserved either, which is
           -- why the second status was removed rather than renamed (D126).
           when ap.approved is true then 'APPROVED'
           else 'WAITING FOR APPROVAL'
         end::ops_procure.line_status_t as status,
         -- Approved-or-not against paid-or-not: two independent facts, four
         -- combinations. The interesting one is the corner where money moved
         -- without a yes, which a single "in progress" status would hide (A1).
         case
           when ap.approved is true and cov.covered > 0 then 'settled'
           when ap.approved is true                     then 'approved_unpaid'
           when cov.covered > 0                         then 'paid_unapproved'
           else 'neither'
         end::ops_procure.meeting_state_t as meeting_state
    from ops_procure.pr_lines l
    join ops_procure.pr_documents d on d.id = l.doc_id
    join ops_procure.v_line_coverage cov on cov.line_id = l.id
    left join ops_procure.v_line_approval  ap on ap.line_id = l.id and ap.step = 'GOODS'
    left join ops_procure.v_line_receiving rc on rc.line_id = l.id
    left join ops_procure.v_line_evidence  ev on ev.line_id = l.id
    left join ops_procure.items i on i.id = l.item_id;

-- ── the variance ──────────────────────────────────────────────────────────
-- Three numbers that are allowed to differ, and the two gaps between them.
--
-- requested → approved is a DECISION: the CEO cut it, and money may only shrink
-- on the way through approval (A8). That is not a variance and is not reported
-- as one.
--
-- approved → paid is the gap leadership is asking about. Under means still owed,
-- or settled cheaper. **Over means money left beyond the yes** — the direction
-- that matters, and the one a "paid" flag would have hidden entirely.
create or replace view ops_procure.v_line_variance as
  select l.id as line_id,
         l.item_total as requested,
         cov.approved,
         cov.covered as paid,
         cov.covered - cov.approved as delta,
         case
           when cov.covered - cov.approved = 0 then 'none'
           when cov.covered - cov.approved > 0 then 'over'
           else 'under'
         end::ops_procure.variance_kind_t as kind,
         -- Below the tolerance it is rounding, not a variance. Reporting
         -- arithmetic as an exception is how people learn to ignore exceptions.
         (cov.covered > 0
          and abs(cov.covered - cov.approved) > ops_core.money_tolerance()) as material,
         v.id          as explanation_id,
         v.reason      as explanation_reason,
         v.note        as explanation_note,
         v.amount_at_time as explanation_amount_at_time,
         v.recorded_by_email as explanation_by,
         v.recorded_at as explanation_at
    from ops_procure.pr_lines l
    join ops_procure.v_line_coverage cov on cov.line_id = l.id
    left join lateral (
      select * from ops_procure.line_variances lv
       where lv.line_id = l.id
       order by lv.recorded_at desc, lv.id desc limit 1
    ) v on true;

-- ── the round a line sits in ──────────────────────────────────────────────
create or replace view ops_procure.v_line_round as
  select rl.line_id, r.round_no, r.status as round_status
    from ops_procure.payment_round_lines rl
    join ops_procure.payment_rounds r on r.id = rl.round_id;

-- ── the board ─────────────────────────────────────────────────────────────
-- What `listOpenLines`, `listAllLines` and the approval queue all read. One
-- object per line with everything derived already on it, so nothing is computed
-- twice and no screen can compute it differently.
create or replace view ops_procure.v_pr_line as
  select l.id, l.doc_id, l.line_no, l.line_no_full, l.item_id, l.description,
         l.qty, l.uom, l.unit_price, l.item_total, l.vendor_id, l.po_line_id,
         l.category, l.purpose, l.need_by, l.source_wo_no,
         l.removed_at, l.removed_by,

         st.status, st.meeting_state,
         d.doc_no, d.submitted_at, d.status as doc_status,
         u.full_name as requested_by_name,
         p.code      as project_code,
         ven.name    as vendor_name,
         it.name     as item_name,

         cov.approved as coverage_approved,
         cov.covered  as coverage_covered,
         cov.remaining as coverage_remaining,
         cov.settled  as coverage_settled,
         cov.trx_nos,

         coalesce(rc.received_qty, 0)  as received_qty,
         coalesce(rc.reported_qty, 0)  as reported_qty,
         coalesce(rc.has_problem, false) as has_problem_receipt,

         coalesce(ev.evidence_count, 0)    as evidence_count,
         coalesce(ev.has_payment_proof, false) as has_payment_proof,
         coalesce(ev.has_support, false)   as has_support,

         var.requested as variance_requested,
         var.approved  as variance_approved,
         var.paid      as variance_paid,
         var.delta     as variance_delta,
         var.kind      as variance_kind,
         var.material  as variance_material,
         var.explanation_id, var.explanation_reason, var.explanation_note,
         var.explanation_amount_at_time, var.explanation_by, var.explanation_at,

         note.id           as note_id,
         note.instructions as note_instructions,
         note.remark       as note_remark,
         note.recorded_by  as note_by_id,
         note.recorded_by_email as note_by,
         note.recorded_at  as note_at,

         req.id       as pending_request_id,
         req.batch_id as pending_request_batch_id,
         req.token    as pending_request_token,
         req.sent_to  as pending_request_sent_to_name,
         req.sent_to_email as pending_request_sent_to,
         req.sent_by  as pending_request_sent_by_id,
         req.sent_by_email as pending_request_sent_by,
         req.sent_at  as pending_request_sent_at,
         req.channel  as pending_request_channel,
         req.meeting_note as pending_request_meeting_note,

         rnd.round_no, rnd.round_status,

         ap.id             as approval_id,
         ap.approved       as approval_approved,
         ap.approved_qty   as approval_qty,
         ap.approved_amount as approval_amount,
         ap.recorded_by    as approval_by_id,
         ap.recorded_by_email as approval_by,
         ap.recorded_at    as approval_at,
         ap.channel        as approval_channel
    from ops_procure.pr_lines l
    join ops_procure.pr_documents d on d.id = l.doc_id
    join ops_procure.v_pr_line_status st on st.line_id = l.id
    join ops_procure.v_line_coverage cov on cov.line_id = l.id
    join ops_procure.v_line_variance var on var.line_id = l.id
    join ops_core.users u on u.id = d.requested_by
    left join ops_procure.projects p   on p.id = d.project_id
    left join ops_procure.vendors ven  on ven.id = l.vendor_id
    left join ops_procure.items it     on it.id = l.item_id
    left join ops_procure.v_line_receiving rc on rc.line_id = l.id
    left join ops_procure.v_line_evidence  ev on ev.line_id = l.id
    left join ops_procure.v_line_note    note on note.line_id = l.id
    left join ops_procure.v_pending_request req on req.line_id = l.id
    left join ops_procure.v_line_round    rnd on rnd.line_id = l.id
    left join ops_procure.v_line_approval ap on ap.line_id = l.id and ap.step = 'GOODS';

-- Every line that is still someone's problem, across every document.
--
-- This is the view the whole redefinition turns on. A line does not belong to
-- the meeting it first appeared in — it stays here until it is settled or
-- removed, so "it comes back at the next meeting" needs no machinery at all.
--
-- The last predicate is the one worth reading twice: a line that paid more than
-- was approved and carries nobody's explanation is **not finished**, whatever
-- its status ladder says. Letting it drop off the board because the goods
-- arrived is precisely how an overpayment stops being anyone's problem.
create or replace view ops_procure.v_open_lines as
  select * from ops_procure.v_pr_line
   where doc_status not in ('DRAFT','CANCELLED')
     and removed_at is null
     and (status <> 'COMPLETED'
          or (variance_material and explanation_id is null));

-- The standing queue (D21): every submitted line that is neither approved nor
-- removed. Nothing ages out, nothing is prioritised — the CEO reads the whole
-- list either way, which is why there is no urgency column. Oldest first, so a
-- line that has waited a week is not below one filed this morning just because
-- the list happens to be built in table order.
create or replace view ops_procure.v_approval_queue as
  select * from ops_procure.v_pr_line
   where doc_status not in ('DRAFT','CANCELLED')
     and removed_at is null
     and approval_approved is distinct from true;

-- ── rounds ────────────────────────────────────────────────────────────────
create or replace view ops_procure.v_round_summary as
  select r.id as round_id, r.round_no, r.status, r.opened_at,
         -- An OPEN round is recomputed from what is still owed; an APPROVED one
         -- keeps the numbers it froze, because they are the record of a
         -- decision and the lines behind them have moved on since.
         case when r.status = 'OPEN'
              then coalesce((select sum(cov.remaining)
                               from ops_procure.payment_round_lines rl
                               join ops_procure.v_line_coverage cov on cov.line_id = rl.line_id
                              where rl.round_id = r.id), 0)
              else coalesce((select sum(rl.requested_amount)
                               from ops_procure.payment_round_lines rl
                              where rl.round_id = r.id), 0)
         end as requested_total,
         coalesce(tr.transferred_total, 0) as transferred_total,
         coalesce(lc.line_count, 0)        as line_count,
         -- What is still to come IN, not what is still owed to suppliers: a
         -- round can be half funded and fully approved at the same time.
         greatest(
           case when r.status = 'OPEN'
                then coalesce((select sum(cov.remaining)
                                 from ops_procure.payment_round_lines rl
                                 join ops_procure.v_line_coverage cov on cov.line_id = rl.line_id
                                where rl.round_id = r.id), 0)
                else coalesce((select sum(rl.requested_amount)
                                 from ops_procure.payment_round_lines rl
                                where rl.round_id = r.id), 0)
           end - coalesce(tr.transferred_total, 0), 0) as transfer_shortfall
    from ops_procure.payment_rounds r
    left join (
      select round_id, sum(amount) as transferred_total
        from ops_procure.round_transfers group by round_id
    ) tr on tr.round_id = r.id
    left join (
      select round_id, count(*) as line_count
        from ops_procure.payment_round_lines group by round_id
    ) lc on lc.round_id = r.id;

-- Which lines belong in a payment round: approved, not settled, and not
-- already sitting in a round that is still live.
--
-- A line in a **closed** round that is still owed comes back; a line in a round
-- that has frozen its numbers stays where it is. That rule is a derivation, so
-- it lives here rather than inside `sync_round()` — which means the screen can
-- show what the next round *would* pick up before anybody presses the button.
create or replace view ops_procure.v_round_eligible as
  select l.id as line_id, l.line_no_full, cov.remaining
    from ops_procure.pr_lines l
    join ops_procure.v_line_coverage cov on cov.line_id = l.id
    join ops_procure.v_line_approval  ap on ap.line_id = l.id and ap.step = 'GOODS'
   where l.removed_at is null
     and ap.approved is true
     and not cov.settled
     and not exists (
       select 1 from ops_procure.payment_round_lines rl
         join ops_procure.payment_rounds r on r.id = rl.round_id
        where rl.line_id = l.id and r.status <> 'CLOSED');

-- ── purchase orders: two axes, never collapsed ────────────────────────────
create or replace view ops_procure.v_po_line_delivery as
  select pl.id as po_line_id, pl.po_id, pl.line_no, pl.description,
         pl.qty, pl.uom, pl.unit_price, pl.line_total,
         coalesce(rc.received, 0) as received,
         coalesce(rc.reported, 0) as reported,
         -- received − ordered when the vendor sent more than was asked for.
         -- Kept visible rather than trimmed: two extra sheets are a credit, not
         -- a rounding error (D98).
         greatest(coalesce(rc.received, 0) - pl.qty, 0) as over,
         case
           when coalesce(rc.has_problem, false) then 'PROBLEM'
           when coalesce(rc.received, 0) = 0    then 'NOT ARRIVED'
           when coalesce(rc.received, 0) > pl.qty then 'OVER'
           when coalesce(rc.received, 0) < pl.qty then 'PARTIAL'
           else 'GOOD'
         end::ops_procure.po_line_condition_t as condition,
         -- Capped at what was ordered. A vendor who ships two sheets more than
         -- the order has given us a credit, not sold us more — we owe for what
         -- we asked for, and the extra is theirs to apply to a later order
         -- (D98). Counting it here would quietly turn an unasked-for delivery
         -- into money they can invoice.
         least(coalesce(rc.received, 0), pl.qty) * pl.unit_price as value_received
    from ops_procure.po_lines pl
    left join (
      select r.po_line_id,
             sum(r.qty_received) filter (
               where ops_procure.receipt_counts(r.condition, r.status)) as received,
             sum(r.qty_received) filter (where r.status = 'REPORTED') as reported,
             bool_or(ops_procure.receipt_is_problem(r.condition))        as has_problem
        from ops_procure.receipts r
       where r.po_line_id is not null
       group by r.po_line_id
    ) rc on rc.po_line_id = pl.id
   where pl.superseded_by is null;

-- Payment and delivery are computed apart and stay apart. "Everything follows
-- from refusing to collapse them" — a PO can be fully paid and empty, or full
-- and unpaid, and one progress bar says neither (A1).
create or replace view ops_procure.v_po_status as
  select po.id as po_id, po.po_no, po.status, po.vendor_id, po.issued_at,
         po.expected_delivery, po.revision, po.sent_revision, po.note,
         coalesce(ln.contract_value, 0) as contract_value,
         coalesce(pd.paid_to_date, 0)   as paid_to_date,
         greatest(coalesce(ln.contract_value, 0) - coalesce(pd.paid_to_date, 0), 0)
           as outstanding,
         coalesce(ln.value_received, 0) as value_received,
         -- Positive means we are carrying the vendor's risk; negative means we
         -- owe them for goods already delivered.
         coalesce(pd.paid_to_date, 0) - coalesce(ln.value_received, 0) as exposure,
         -- Priced over-delivery: what the vendor sent beyond the order. A credit
         -- with them, never billable and never ours to spend (D98).
         coalesce(ln.credit, 0) as credit,
         case
           when coalesce(pd.paid_to_date, 0) <= 0 then 'UNPAID'
           when coalesce(pd.paid_to_date, 0)
                >= coalesce(ln.contract_value, 0) - ops_core.money_tolerance() then 'SETTLED'
           else 'PARTIAL'
         end::ops_procure.po_payment_state_t as payment_state,
         case
           when coalesce(ln.value_received, 0) <= 0 then 'PENDING'
           when coalesce(ln.fully_delivered, false) then 'COMPLETE'
           else 'PARTIAL'
         end::ops_procure.po_delivery_state_t as delivery_state,
         coalesce(ln.fully_delivered, false) as fully_delivered,
         coalesce(ln.any_delivered, false)   as any_delivered,
         dp.basis_value as dp_percent
    from ops_procure.purchase_orders po
    left join (
      select po_id,
             sum(line_total)    as contract_value,
             sum(value_received) as value_received,
             sum(over * unit_price) as credit,
             bool_and(received >= qty) as fully_delivered,
             bool_or(received > 0)     as any_delivered
        from ops_procure.v_po_line_delivery
       group by po_id
    ) ln on ln.po_id = po.id
    left join (
      select al.po_no, sum(al.amount) as paid_to_date
        from ops_acct.payment_allocations al
        join ops_acct.transactions t on t.id = al.trx_id
       where al.superseded_by is null and al.po_no is not null and t.status <> 'VOID'
       group by al.po_no
    ) pd on pd.po_no = po.po_no
    left join ops_procure.po_schedule dp
      on dp.po_id = po.id and dp.kind = 'DP' and dp.basis = 'percent';

-- What a vendor could honestly invoice today.
--
-- Two things are earned at different moments. A **deposit** is earned when the
-- order is issued — that is what a deposit is. Everything else is earned as
-- goods arrive, in proportion to their value:
--
--     earned       = contract × dp%  +  value_received × (1 − dp%)
--     billable now = earned − already paid, floored at zero
--
-- The floor matters. Paying ahead of delivery is a real thing that happens, and
-- it is reported as `exposure` on the order rather than as a negative number
-- here. This figure has one job — *what is safe to send money for next* — and a
-- negative answer to that question is not a smaller number, it is a different
-- conversation (D99).
--
-- A DRAFT order is a document nobody has sent, so nothing on it is billable,
-- however large the contract.
create or replace view ops_procure.v_po_journey as
  select s.*,
         greatest(round(
           case when s.issued_at is null then 0
                else s.contract_value * (coalesce(s.dp_percent, 0) / 100.0)
                   + s.value_received * (1 - coalesce(s.dp_percent, 0) / 100.0)
           end - s.paid_to_date), 0) as billable_now
    from ops_procure.v_po_status s;

-- The payment schedule, with the money that reached this order applied to it in
-- order (D128).
--
-- Nothing in a transfer says which term it was for, so coverage runs oldest term
-- first — both the only defensible reading and how the terms were meant to run.
-- What falls out of it is the guard: a term whose trigger has fired while an
-- earlier one is still unpaid is BLOCKED, and the view **names the term holding
-- it up** rather than saying "not allowed". That guard is the reason somebody
-- once paid a final instalment on an order whose deposit had never gone out.
create or replace view ops_procure.v_po_terms as
  with ordered as (
    select t.*, s.contract_value, s.paid_to_date, s.status as po_status,
           s.fully_delivered, s.any_delivered,
           case when t.basis = 'percent'
                then round(s.contract_value * t.basis_value / 100.0)
                else t.basis_value
           end as amount,
           row_number() over (partition by t.po_id order by t.term_no) as seq
      from ops_procure.po_schedule t
      join ops_procure.v_po_status s on s.po_id = t.po_id
  ), running as (
    select o.*,
           -- What the money covers before this term: the sum of every earlier
           -- term's amount. `covered` is then whatever is left over, clamped.
           coalesce(sum(o.amount) over (
             partition by o.po_id order by o.seq
             rows between unbounded preceding and 1 preceding), 0) as claimed_before
      from ordered o
  ), stated as (
    select r.*,
           least(greatest(r.paid_to_date - r.claimed_before, 0), r.amount) as covered,
           case r.due_rule
             when 'on_issue'    then r.po_status in ('ISSUED','CLOSED')
             when 'on_delivery' then case when r.kind = 'FINAL'
                                          then r.fully_delivered
                                          else r.any_delivered end
             else r.due_date is not null
                  and r.due_date <= ops_core.office_day()
           end as fired
      from running r
  )
  select s.id, s.po_id, s.term_no, s.kind, s.basis, s.basis_value,
         s.due_rule, s.due_date, s.amount, s.covered, s.fired,
         case
           when s.amount > 0 and s.covered >= s.amount - ops_core.money_tolerance() then 'PAID'
           when s.covered > 0 then 'PARTIAL'
           when not s.fired   then 'NOT DUE'
           -- Blocked by the first earlier term that is not fully paid. Computed
           -- over the same window rather than carried in a loop variable, which
           -- is what the TypeScript did; the answer is identical and this one
           -- cannot depend on the order rows happen to arrive in.
           when exists (
             select 1 from stated e
              where e.po_id = s.po_id and e.seq < s.seq
                and e.covered < e.amount - ops_core.money_tolerance()
           ) then 'BLOCKED'
           else 'PAYABLE'
         end::ops_procure.po_term_state_t as state,
         (select e.term_no from stated e
           where e.po_id = s.po_id and e.seq < s.seq
             and e.covered < e.amount - ops_core.money_tolerance()
           order by e.seq limit 1) as blocked_by,
         -- Why the trigger has or has not fired, in words. On the row because
         -- "NOT DUE" on its own sends somebody to ask a person what it is
         -- waiting for.
         case s.due_rule
           when 'on_issue' then case when s.fired then 'the order has been issued'
                                     else 'not until the order is issued' end
           when 'on_delivery' then case
             when s.fired and s.kind = 'FINAL' then 'everything ordered has arrived'
             when s.fired                      then 'goods have started arriving'
             when s.kind = 'FINAL'             then 'not until everything has arrived'
             else 'not until something arrives' end
           else case when s.fired then 'due since ' || s.due_date
                     else 'due on ' || s.due_date end
         end as trigger
    from stated s;

-- Everything one vendor has going with us, in one block.
--
-- The question this answers is the one nobody could answer from the sheet:
-- *where are we with this supplier* — how much is contracted, how much has been
-- paid, what has actually arrived, and what they could invoice next. A vendor
-- with three open orders and one transfer covering all three cannot be read
-- order by order (D97).
create or replace view ops_procure.v_vendor_journey as
  select v.id as vendor_id, v.name as vendor_name,
         count(j.po_id)                        as orders,
         coalesce(sum(j.contract_value), 0)    as contract_value,
         coalesce(sum(j.paid_to_date), 0)      as paid,
         greatest(coalesce(sum(j.contract_value), 0)
                  - coalesce(sum(j.paid_to_date), 0), 0) as outstanding,
         coalesce(sum(j.value_received), 0)    as value_received,
         coalesce(sum(j.billable_now), 0)      as billable_now,
         coalesce(sum(j.credit), 0)            as credit
    from ops_procure.vendors v
    left join ops_procure.v_po_journey j
      on j.vendor_id = v.id and j.status <> 'CANCELLED'
   group by v.id, v.name;

-- ── purchase facts ────────────────────────────────────────────────────────
-- Every "we bought this item from that vendor" we can establish, gathered from
-- both places it is recorded: requested lines, and itemised ledger rows.
--
-- Both directions of the sourcing question read from here, so the vendor page
-- and the catalogue page can never disagree about what was bought from whom. A
-- declared category on a vendor record is a claim; this is what happened.
--
-- A merged vendor's history stays on its own row (D41), and readers follow the
-- pointer — so the fact is reported under the surviving name while the row it
-- came from is unchanged.
create or replace view ops_procure.v_purchase_facts as
  select l.item_id,
         i.name as item_name,
         i.category_code,
         coalesce(v.merged_into, v.id) as vendor_id,
         coalesce(vm.name, v.name)     as vendor_name,
         l.unit_price,
         l.uom,
         coalesce(d.submitted_at, d.created_at) as at,
         'pr'::text as source
    from ops_procure.pr_lines l
    join ops_procure.pr_documents d on d.id = l.doc_id
    join ops_procure.items   i on i.id = l.item_id
    join ops_procure.vendors v on v.id = l.vendor_id
    left join ops_procure.vendors vm on vm.id = v.merged_into
   where l.removed_at is null
  union all
  select tl.item_id,
         i.name, i.category_code,
         coalesce(v.merged_into, v.id),
         coalesce(vm.name, v.name),
         tl.unit_price, tl.uom,
         t.posted_at,
         'ledger'
    from ops_acct.transaction_lines tl
    join ops_acct.transactions t on t.id = tl.trx_id and t.status <> 'VOID'
    join ops_procure.items   i on i.id = tl.item_id
    join ops_procure.vendors v on v.id = t.vendor_id
    left join ops_procure.vendors vm on vm.id = v.merged_into;

-- Who we buy an item from, newest first. The answer to "we need thinner — where
-- do we get it?", derived rather than maintained.
create or replace view ops_procure.v_item_sources as
  select f.item_id, f.vendor_id, f.vendor_name,
         v.is_curated, v.pic_name, v.pic_phone,
         (array_agg(f.unit_price order by f.at desc))[1] as last_price,
         (array_agg(f.uom        order by f.at desc))[1] as uom,
         max(f.at) as last_date,
         count(*)  as times
    from ops_procure.v_purchase_facts f
    join ops_procure.vendors v on v.id = f.vendor_id
   group by f.item_id, f.vendor_id, f.vendor_name, v.is_curated, v.pic_name, v.pic_phone;

create or replace view ops_procure.v_vendor_view as
  select v.*,
         coalesce(f.transaction_count, 0) as transaction_count,
         f.last_purchase,
         coalesce(op.open_pr_lines, 0)    as open_pr_lines
    from ops_procure.vendors v
    left join (
      select vendor_id, count(*) as transaction_count, max(at) as last_purchase
        from ops_procure.v_purchase_facts group by vendor_id
    ) f on f.vendor_id = v.id
    left join (
      select l.vendor_id, count(*) as open_pr_lines
        from ops_procure.v_pr_line l
       where l.removed_at is null and l.status <> 'COMPLETED'
         and l.doc_status not in ('DRAFT','CANCELLED')
       group by l.vendor_id
    ) op on op.vendor_id = v.id;

create or replace view ops_procure.v_item_view as
  select i.*,
         c.name as category_name,
         lv.name as last_vendor_name,
         -- What a form would prefill: the curated price if there is one,
         -- otherwise the last price paid. A hint, never a price list.
         coalesce(i.standard_price, i.last_price) as suggested_price,
         coalesce(pf.purchase_count, 0) as purchase_count
    from ops_procure.items i
    join ops_procure.item_categories c on c.code = i.category_code
    left join ops_procure.vendors lv on lv.id = i.last_vendor_id
    left join (
      select item_id, count(*) as purchase_count
        from ops_procure.v_purchase_facts group by item_id
    ) pf on pf.item_id = i.id;

-- Views run with the caller's rights by default in Postgres 15+, which is what
-- we want everywhere here: every one of them reads tables whose policies already
-- say who may see the rows, and a `security definer` view would quietly hand a
-- reader past them. Stated rather than assumed, because the default changed and
-- somebody reading this on an older server should not have to guess.
alter view ops_procure.v_line_approval    set (security_invoker = on);
alter view ops_procure.v_line_note        set (security_invoker = on);
alter view ops_procure.v_pending_request  set (security_invoker = on);
alter view ops_procure.v_line_funding     set (security_invoker = on);
alter view ops_procure.v_line_coverage    set (security_invoker = on);
alter view ops_procure.v_line_receiving   set (security_invoker = on);
alter view ops_procure.v_line_evidence    set (security_invoker = on);
alter view ops_procure.v_pr_line_status   set (security_invoker = on);
alter view ops_procure.v_line_variance    set (security_invoker = on);
alter view ops_procure.v_line_round       set (security_invoker = on);
alter view ops_procure.v_pr_line          set (security_invoker = on);
alter view ops_procure.v_open_lines       set (security_invoker = on);
alter view ops_procure.v_approval_queue   set (security_invoker = on);
alter view ops_procure.v_round_summary    set (security_invoker = on);
alter view ops_procure.v_round_eligible   set (security_invoker = on);
alter view ops_procure.v_po_line_delivery set (security_invoker = on);
alter view ops_procure.v_po_status        set (security_invoker = on);
alter view ops_procure.v_po_journey       set (security_invoker = on);
alter view ops_procure.v_po_terms         set (security_invoker = on);
alter view ops_procure.v_vendor_journey   set (security_invoker = on);
alter view ops_procure.v_purchase_facts   set (security_invoker = on);
alter view ops_procure.v_item_sources     set (security_invoker = on);
alter view ops_procure.v_vendor_view      set (security_invoker = on);
alter view ops_procure.v_item_view        set (security_invoker = on);

grant select on all tables in schema ops_procure to authenticated;
grant execute on function ops_procure.receipt_counts(ops_procure.receipt_condition_t, ops_procure.receipt_status_t),
                          ops_procure.receipt_is_problem(ops_procure.receipt_condition_t)
  to authenticated;
