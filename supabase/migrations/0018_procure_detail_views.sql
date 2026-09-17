-- 0018_procure_detail_views.sql — the two views a drawer opens with.
--
-- `PoDetail` and `PrDocumentView` in `src/services/procurement/contracts.ts`
-- are deliberately fat: *"a drawer that needs three calls is a drawer that
-- renders in three stages"*. Assembling them client-side would mean three
-- round trips, three loading states, and three chances for one of them to fail
-- and leave the drawer half-drawn.
--
-- So they are assembled here, in one row each, with the nested parts as jsonb.
-- That is not a convenience: it is the same rule as everywhere else — the
-- figure and the thing it is derived from are computed together, once, so they
-- cannot disagree.

-- ── the order, whole ──────────────────────────────────────────────────────
create or replace view ops_procure.v_po_detail as
  select
    po.po_no,
    po.vendor_id,
    v.name      as vendor_name,
    v.pic_name  as vendor_pic,
    coalesce(v.pic_phone, v.phone) as vendor_phone,
    po.status,
    po.expected_delivery,
    -- Days late, once everything was supposed to be here and is not. Null
    -- rather than zero when it is not late: "0 days late" and "not late" are
    -- different statements, and a screen showing the first for the second is
    -- reporting a problem that does not exist (D134).
    case
      when po.expected_delivery is null then null
      when po.status in ('CLOSED','CANCELLED') then null
      when s.fully_delivered then null
      when ops_core.office_day() > po.expected_delivery
        then (ops_core.office_day() - po.expected_delivery)
      else null
    end as days_late,
    po.revision, po.sent_revision,
    po.approval_asked_at,
    asked.full_name as approval_asked_by_name,
    po.approved_at,
    appr.full_name  as approved_by_name,
    po.approval_note,
    po.note,
    po.created_at,
    po.issued_at,
    iss.full_name   as issued_by_name,

    s.contract_value, s.paid_to_date, s.outstanding, s.value_received,
    s.exposure, s.credit, s.payment_state, s.delivery_state, s.dp_percent,
    j.billable_now,

    -- The lines, each with what arrived against it and every receipt behind
    -- that — including who took delivery and who checked it, two people or the
    -- same one named twice (D101).
    coalesce(ln.lines, '[]'::jsonb) as lines,
    coalesce(tm.terms, '[]'::jsonb) as terms,

    -- The share of the contract that may be asked for right now: the terms
    -- that are PAYABLE or PARTIAL, less what has already reached them.
    coalesce(tm.payable_now, 0) as payable_now,

    -- What this order used to say. An issued obligation only moves by
    -- supersession, so the old rows are still here and worth reading — "who
    -- changed the quantity after we agreed it" is a real question (D129).
    coalesce(am.amendments, '[]'::jsonb) as amendments,
    coalesce(pm.payments, '[]'::jsonb)   as payments,
    coalesce(dc.documents, '[]'::jsonb)  as documents,

    -- Why this order cannot be closed yet, empty when it can. The same three
    -- reasons `ops_procure.close_po()` refuses on, computed in one place so the
    -- button's tooltip and the seam's refusal cannot say different things.
    (select coalesce(jsonb_agg(b), '[]'::jsonb) from (
       select 'It is already closed.' as b where po.status = 'CLOSED'
       union all
       select 'It was never issued — cancel it rather than close it.' where po.status = 'DRAFT'
       union all
       select format('%s of the contract has not been paid.', s.outstanding)
        where s.outstanding > 0
       union all
       select 'Not everything ordered has arrived.' where not s.fully_delivered
     ) blockers) as close_blockers

  from ops_procure.purchase_orders po
  join ops_procure.vendors v        on v.id = po.vendor_id
  join ops_procure.v_po_status s    on s.po_id = po.id
  join ops_procure.v_po_journey j   on j.po_id = po.id
  left join ops_core.users asked on asked.id = po.approval_asked_by
  left join ops_core.users appr  on appr.id  = po.approved_by
  left join ops_core.users iss   on iss.id   = po.issued_by

  left join lateral (
    select jsonb_agg(jsonb_build_object(
             'po_line_id', d.po_line_id, 'line_no', d.line_no,
             'description', d.description, 'qty', d.qty, 'uom', d.uom,
             'unit_price', d.unit_price, 'line_total', d.line_total,
             'received', d.received, 'reported', d.reported, 'over', d.over,
             'condition', d.condition,
             'receipts', coalesce(rc.receipts, '[]'::jsonb))
           order by d.line_no) as lines
      from ops_procure.v_po_line_delivery d
      left join lateral (
        select jsonb_agg(jsonb_build_object(
                 'receipt_no', r.receipt_no, 'qty', r.qty_received,
                 'condition', r.condition, 'at', r.received_at,
                 'by', coalesce(rb.full_name, '—'),
                 'qc_by', coalesce(qb.full_name, '—'),
                 'note', r.note, 'status', r.status,
                 -- Both halves of the evidence, tracked apart: the photo of
                 -- what arrived, and the signed tanda terima.
                 --
                 -- **Ids, not booleans** (D268). A chip reading *photo of the
                 -- goods* that nobody could open is a label about evidence
                 -- rather than a way to it. Presence is derived from the id
                 -- where it is rendered, so the chip and the link cannot
                 -- disagree about whether there is a file.
                 'photo_attachment_id', (select k.attachment_id
                                           from ops_core.attachment_links k
                                          where k.entity = 'receipt' and k.entity_no = r.receipt_no
                                            and k.kind = 'goods_photo' and k.unlinked_at is null
                                          order by k.linked_at limit 1),
                 'delivery_note_attachment_id', (select k.attachment_id
                                           from ops_core.attachment_links k
                                          where k.entity = 'receipt' and k.entity_no = r.receipt_no
                                            and k.kind = 'delivery_note' and k.unlinked_at is null
                                          order by k.linked_at limit 1))
               order by r.received_at) as receipts
          from ops_procure.receipts r
          left join ops_core.users rb on rb.id = r.received_by
          left join ops_core.users qb on qb.id = r.qc_by
         where r.po_line_id = d.po_line_id
      ) rc on true
     where d.po_id = po.id
  ) ln on true

  left join lateral (
    select jsonb_agg(jsonb_build_object(
             'term_no', t.term_no, 'kind', t.kind, 'basis', t.basis,
             'basis_value', t.basis_value, 'due_rule', t.due_rule,
             'due_date', t.due_date, 'amount', t.amount, 'covered', t.covered,
             'state', t.state, 'blocked_by', t.blocked_by, 'trigger', t.trigger)
           order by t.term_no) as terms,
           sum(greatest(t.amount - t.covered, 0))
             filter (where t.state in ('PAYABLE','PARTIAL')) as payable_now
      from ops_procure.v_po_terms t where t.po_id = po.id
  ) tm on true

  left join lateral (
    select jsonb_agg(jsonb_build_object(
             'line_no', old.line_no,
             'from', old.qty || ' ' || old.uom || ' × ' || old.unit_price,
             'to', case when new_l.id is null then 'removed'
                        else new_l.qty || ' ' || new_l.uom || ' × ' || new_l.unit_price end,
             'at', '')
           order by old.line_no desc) as amendments
      from ops_procure.po_lines old
      left join ops_procure.po_lines new_l on new_l.id = old.superseded_by
     where old.po_id = po.id and old.superseded_by is not null
  ) am on true

  left join lateral (
    select jsonb_agg(jsonb_build_object(
             'trx_no', t.trx_no, 'trx_date', t.trx_date,
             'amount', al.amount, 'description', t.description)
           order by t.trx_date) as payments
      from ops_acct.payment_allocations al
      join ops_acct.transactions t on t.id = al.trx_id
     where al.po_no = po.po_no and al.superseded_by is null and t.status <> 'VOID'
  ) pm on true

  left join lateral (
    select jsonb_agg(jsonb_build_object(
             'attachment_id', a.id, 'filename', a.filename, 'url', a.url,
             'kind', k.kind, 'linked_at', k.linked_at)
           order by k.linked_at) as documents
      from ops_core.attachment_links k
      join ops_core.attachments a on a.id = k.attachment_id
     where k.entity = 'purchase_order' and k.entity_no = po.po_no
       and k.unlinked_at is null
  ) dc on true;

-- ── the request, as a document ────────────────────────────────────────────
-- The board is line-first (D48) and this is the other reading: what arrived
-- together, from whom, on what day. Both totals are here because a request is
-- read twice — once as "what did they ask for" and once as "what did we agree".
create or replace view ops_procure.v_pr_document as
  select d.id, d.doc_no, d.doc_type, d.status,
         d.requested_by, u.full_name as requested_by_name,
         d.project_id, p.code as project_code, p.name as project_name,
         d.created_at, d.submitted_at,
         coalesce(l.line_count, 0)      as line_count,
         coalesce(l.requested_total, 0) as requested_total,
         coalesce(l.approved_total, 0)  as approved_total,
         coalesce(l.paid_total, 0)      as paid_total,
         -- A document is finished when every line on it is. Derived, because a
         -- stored one would disagree with the lines the moment a single line
         -- moved (A3).
         coalesce(l.open_lines, 0)      as open_lines
    from ops_procure.pr_documents d
    join ops_core.users u on u.id = d.requested_by
    left join ops_procure.projects p on p.id = d.project_id
    left join lateral (
      select count(*)                                  as line_count,
             sum(pl.item_total)                        as requested_total,
             sum(cov.approved)                         as approved_total,
             sum(cov.covered)                          as paid_total,
             count(*) filter (where st.status not in ('COMPLETED','REMOVED')) as open_lines
        from ops_procure.pr_lines pl
        join ops_procure.v_line_coverage cov  on cov.line_id = pl.id
        join ops_procure.v_pr_line_status st  on st.line_id = pl.id
       where pl.doc_id = d.id and pl.removed_at is null
    ) l on true;

alter view ops_procure.v_po_detail   set (security_invoker = on);
alter view ops_procure.v_pr_document set (security_invoker = on);

grant select on ops_procure.v_po_detail, ops_procure.v_pr_document to authenticated;
