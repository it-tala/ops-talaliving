-- 0122_procure_line_closures.sql — a line declared finished, by somebody, for a reason.
--
-- `v_pr_line_status` reaches COMPLETED only when a line is settled, has a
-- transfer proof on file and has been received in full. That is the right
-- default, and it cannot describe history: the lines carried in from the PR
-- recap sheet (import 08) were bought, paid and used weeks ago, and nobody is
-- going to write a receiving report for a July box of sandpaper now.
--
-- The two ways to make them read COMPLETED without this table are both lies:
-- a receiving report nobody made, or a document labelled as a transfer proof
-- that is not one. Either would then feed stock and evidence screens that
-- trust them.
--
-- So a closure is its own row, the same shape as `line_settlements`: one per
-- line, never overwritten, with who decided and why. The status view reads it
-- after REMOVED and before everything else, so a closed line is COMPLETED
-- whatever its receipts say — and the receipts, proofs and coverage it does or
-- does not have stay exactly as they were, readable beside the decision.
--
-- Closing is not paying. A line closed while money is still owed on it keeps
-- its coverage and its gap; writing that gap off is a settlement, which is a
-- separate row and a separate authority (`approve_funds`, 0010).

create table ops_procure.line_closures (
  id         uuid primary key default gen_random_uuid(),
  line_id    uuid not null references ops_procure.pr_lines(id) on delete restrict,
  reason     text not null check (length(btrim(reason)) > 0),
  decided_by uuid not null references ops_core.users(id),
  decided_at timestamptz not null default now(),
  -- Closed once. A second closure is a duplicate or a second opinion, and
  -- neither should overwrite the first quietly.
  unique (line_id)
);

alter table ops_procure.line_closures enable row level security;

create policy closures_read on ops_procure.line_closures
  for select to authenticated using (ops_core.has_permission('procurement.read'));
-- Declaring a line done is leadership's word on the goods, the same authority
-- that approved it.
create policy closures_new on ops_procure.line_closures
  for insert to authenticated with check (ops_core.has_authority('approve_goods'));

grant select, insert on ops_procure.line_closures to authenticated;

create or replace view ops_procure.v_pr_line_status as
  select l.id as line_id,
         l.line_no_full,
         case
           when d.status = 'DRAFT' then 'DRAFT'
           when l.removed_at is not null then 'REMOVED'
           when cl.line_id is not null then 'COMPLETED'
           when cov.settled
            and ev.has_payment_proof
            and not coalesce(rc.has_problem, false)
            and (i.kind = 'service'
                 or (l.qty is not null and l.qty > 0
                     and coalesce(rc.received_qty, 0) >= l.qty))
             then 'COMPLETED'
           when coalesce(rc.received_qty, 0) > 0 then 'PARTIAL'
           when cov.settled then 'PAID'
           when ap.approved is true then 'APPROVED'
           else 'WAITING FOR APPROVAL'
         end::ops_procure.line_status_t as status,
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
    left join ops_procure.line_closures    cl on cl.line_id = l.id
    left join ops_procure.items i on i.id = l.item_id;

alter view ops_procure.v_pr_line_status set (security_invoker = on);
