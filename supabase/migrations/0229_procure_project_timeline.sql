-- 0229_procure_project_timeline.sql — a project read from its first contact to
-- its handover, and the pipeline's numbers read from what was recorded (P7,
-- kajian F224 §4.6).
--
-- Nothing here is stored. Every row of the timeline is a row somebody already
-- wrote — a status change, a call, a meeting line closed, a quotation sent or
-- answered, a file filed, a client's approval, a design item added or taken
-- out, a drawing released, a Job Order, a delivery, an installation visit,
-- the BAST — put side by side in time (A3). Each reader sees the events their
-- own access lets them read: the view is `security_invoker`, so a drafter
-- sees the design and the floor, not the sales log (D375).
--
--   v_project_timeline   one row per event: project, when, kind, what, who
--   v_project_outcome    one row per project: who sells it, where it came
--                        from, when it opened, reached the deal or was lost,
--                        how long that took, and the offer's value — what
--                        the pipeline's win rate and ages are counted from
--
-- D164 stands: values here are offers, never receivables or profit.
--
-- Numbered 0229: another branch (daily routines) holds 0227 and 0228.
--
-- For the production tool (F226): no drops, and no function body here removes
-- rows.

-- ── 1. the timeline ───────────────────────────────────────────────────────

create or replace view ops_procure.v_project_timeline as
with prj as (
  select p.id, p.code from ops_procure.projects p
),
items as (
  select di.id, di.item_no, di.name, di.created_at, di.created_by, di.dropped_at, di.dropped_by, di.drop_reason,
         p.code as project_code
    from ops_procure.design_items di
    join ops_procure.design_rooms dr on dr.id = di.room_id
    join ops_procure.design_collections dc on dc.id = dr.collection_id
    join ops_procure.projects p on p.id = dc.project_id
),
ev as (
  -- the project's own moves
  select prj.code as project_code, l.changed_at as at, ops_core.office_day(l.changed_at) as day,
         'status'::text as kind, l.to_status::text as title,
         nullif(concat_ws(' — ', l.reason_code, l.reason), '') as detail, null::text as ref, l.changed_by as actor_id
    from ops_procure.project_status_log l join prj on prj.id = l.project_id
  union all
  -- contact with the client: a call, a message, a meeting, a visit
  select prj.code, a.created_at, a.happened_on,
         case when a.kind in ('meeting','visit') then 'meeting' else 'contact' end, a.kind, a.summary, a.id::text, a.created_by
    from ops_procure.client_activities a join prj on prj.id = a.project_id
  union all
  -- a meeting's revision request or action done
  select prj.code, mp.closed_at, ops_core.office_day(mp.closed_at), 'point_closed', mp.kind,
         concat_ws(' → ', mp.body, mp.closed_note), (select i.item_no from ops_procure.design_items i where i.id = mp.design_item_id),
         mp.closed_by
    from ops_procure.meeting_points mp join prj on prj.id = mp.project_id
   where mp.closed_at is not null
  union all
  -- a quotation sent, and the client's answer
  select prj.code, q.sent_at, ops_core.office_day(q.sent_at), 'quote_sent', format('%s · rev %s', q.quote_no, q.rev),
         null, q.quote_no, q.sent_by
    from ops_procure.quotations q join prj on prj.id = q.project_id
   where q.sent_at is not null
  union all
  select prj.code, q.decided_at, ops_core.office_day(q.decided_at),
         case q.status when 'ACCEPTED' then 'quote_accepted' else 'quote_rejected' end,
         format('%s · rev %s', q.quote_no, q.rev), q.decision_reason, q.quote_no, q.decided_by
    from ops_procure.quotations q join prj on prj.id = q.project_id
   where q.decided_at is not null and q.status in ('ACCEPTED','REJECTED')
  union all
  -- a file filed against the project, its quotations, its meetings, its design
  select coalesce(prj.code, qp.code, ap.code, ip.project_code, cp.code), l.linked_at, ops_core.office_day(l.linked_at),
         'file', coalesce(lb.label, l.kind::text), f.filename, l.entity_no, l.linked_by
    from ops_core.attachment_links l
    join ops_core.attachments f on f.id = l.attachment_id
    left join ops_core.doc_kind_labels lb on lb.kind = l.kind
    left join prj on l.entity = 'project' and prj.code = l.entity_no
    left join lateral (select p.code from ops_procure.quotations q join ops_procure.projects p on p.id = q.project_id
                        where l.entity = 'quotation' and q.quote_no = l.entity_no) qp on true
    left join lateral (select p.code from ops_procure.client_activities a join ops_procure.projects p on p.id = a.project_id
                        where l.entity = 'client_activity' and a.id::text = l.entity_no) ap on true
    left join items ip on l.entity = 'design_item' and ip.item_no = l.entity_no
    left join lateral (select p.code from ops_procure.design_collections dc join ops_procure.projects p on p.id = dc.project_id
                        where l.entity = 'design_collection' and p.code || '-' || dc.code = l.entity_no) cp on true
   where l.unlinked_at is null
     and l.entity in ('project','quotation','client_activity','design_item','design_collection')
  union all
  -- the design: items added and taken out, the client's word on them
  select it.project_code, it.created_at, ops_core.office_day(it.created_at), 'design_item', it.name, null, it.item_no, it.created_by
    from items it
  union all
  select it.project_code, it.dropped_at, ops_core.office_day(it.dropped_at), 'design_dropped', it.name, it.drop_reason, it.item_no, it.dropped_by
    from items it where it.dropped_at is not null
  union all
  select it.project_code, ap.recorded_at, ap.decided_on, 'approval', ap.decision,
         concat_ws(' · ', ap.client_person, ap.channel, ap.note), it.item_no, ap.recorded_by
    from ops_procure.design_approvals ap join items it on it.id = ap.item_id
  union all
  -- a drawing released to the workshop (0226)
  select it.project_code, r.released_at, ops_core.office_day(r.released_at), 'drawing_released',
         format('%s rev %s', t.kind, r.rev), r.note, it.item_no, r.released_by
    from ops_prod.design_revisions r
    join ops_prod.design_tasks t on t.id = r.task_id
    join items it on it.item_no = t.item_no
   where r.released_at is not null
  union all
  -- the floor and the site, by the project's code (ADR-004)
  select w.project_code, w.created_at, ops_core.office_day(w.created_at), 'job_order', w.wo_no, w.item_name, w.wo_no, w.created_by
    from ops_prod.work_orders w where w.project_code is not null
  union all
  select d.project_code, d.created_at, d.dispatched_on, 'delivery', d.delivery_no, d.status::text, d.delivery_no, d.created_by
    from ops_dlv.deliveries d
  union all
  select d.project_code, d.received_at, ops_core.office_day(d.received_at), 'delivery_received', d.delivery_no, d.received_by, d.delivery_no, null
    from ops_dlv.deliveries d where d.received_at is not null
  union all
  select i.project_code, i.created_at, i.visit_date, 'installation', i.install_no, concat_ws(' · ', i.crew, i.note), i.install_no, i.created_by
    from ops_dlv.installations i
  union all
  select h.project_code, h.created_at, h.handed_on, 'handover', h.handover_no,
         concat_ws(' · ', h.client_rep, case when h.open_snags_at_handover > 0 then format('%s snag terbuka', h.open_snags_at_handover) end),
         h.handover_no, h.created_by
    from ops_dlv.handovers h
)
select ev.project_code, ev.at, ev.day, ev.kind, ev.title, ev.detail, ev.ref,
       coalesce(u.full_name, u.email) as actor_name
  from ev
  left join ops_core.users u on u.id = ev.actor_id
 where ev.project_code is not null
   and ops_procure.may_design('read');
alter view ops_procure.v_project_timeline set (security_invoker = on);
grant select on ops_procure.v_project_timeline to authenticated;

-- ── 2. what the pipeline counts ───────────────────────────────────────────

-- Won: the project reached the deal (a cancelled order still did). Lost: it
-- closed as LOST. Open: neither yet. Value: the accepted offer, else the
-- offer in play, else the estimate, else the contract.
create or replace view ops_procure.v_project_outcome as
select
  v.code as project_code, v.name as project_name, v.client_display, v.status::text as status,
  v.sales_pic, v.sales_pic_name, v.source_note,
  coalesce(acc.total, v.current_quote_total, v.expected_value, v.contract_value) as value,
  ops_core.office_day(v.created_at) as opened_on,
  -- The logged move to the deal; for a project that was already past it before
  -- moves were logged, the day it reached its current status — the deal was
  -- no later than that.
  coalesce(ops_core.office_day(lg.deal_at),
           case when v.status in ('DEAL','IN_PRODUCTION','SHIPPED','DONE','CANCELLED')
                then ops_core.office_day(v.status_changed_at) end) as deal_on,
  case when v.status = 'LOST' then ops_core.office_day(v.closed_at) end as lost_on,
  case when lg.deal_at is not null or v.status in ('DEAL','IN_PRODUCTION','SHIPPED','DONE','CANCELLED') then 'won'
       when v.status = 'LOST' then 'lost'
       else 'open' end as outcome,
  -- Only from a logged deal: an approximate date is not a duration.
  ops_core.office_day(lg.deal_at) - ops_core.office_day(v.created_at) as days_to_deal,
  v.days_in_status,
  v.closing_reason_code
from ops_procure.v_project v
left join lateral (
  select q.grand_total as total from ops_procure.v_quotation q
   where q.project_id = v.id and q.status = 'ACCEPTED'
   order by q.decided_at desc limit 1
) acc on true
left join lateral (
  select min(l.changed_at) as deal_at
    from ops_procure.project_status_log l
   where l.project_id = v.id and l.to_status in ('DEAL','IN_PRODUCTION','SHIPPED','DONE')
) lg on true
where ops_procure.may_sell('read');
alter view ops_procure.v_project_outcome set (security_invoker = on);
grant select on ops_procure.v_project_outcome to authenticated;
