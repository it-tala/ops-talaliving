-- 0280 — who said yes, and for which project, on the ledger row (L7, kajian §6.5).
--
-- A payment that names a request line already points at the people behind
-- it: the line was approved by somebody, on some day, through some door
-- (`pr_approvals`, D19). The drawer never showed that hop, so *disetujui
-- Evin 3 Okt via chat, Rp 1.250.000; dibayar Rp 1.250.000* took opening the
-- request. `v_allocation` now carries the line's **current** GOODS decision
-- (`v_line_approval`: the latest row, D28), and `v_transaction_detail`
-- relays it per allocation. Readable by whoever can read the approval
-- trail (`procurement.read`, the view is security invoker): a reader
-- without it still sees the allocation, with the approval blank, exactly as
-- `line_description` already behaves.
--
-- And the project by name, not only by code: `v_transaction.project_name`,
-- so the ledger table's new column and the drawer's facts say *Rumah Pak
-- Budi* rather than `PRJ-25007`.

-- ── the allocation knows who approved its line ───────────────────────────
-- 0238's body plus the approval. `create or replace` may only append, so the
-- new columns come last.
create or replace view ops_acct.v_allocation as
 SELECT a.id,
    a.trx_id,
    t.trx_no,
    a.pr_line_no,
    a.po_no,
    a.amount,
    a.method,
    a.superseded_by,
    a.allocated_by,
    u.full_name AS allocated_by_name,
    a.allocated_at,
    pl.description AS line_description,
    st.status AS line_status,
    ap.approved,
    ap.approved_amount,
    ap.recorded_by_email AS approved_by,
    ap.recorded_at AS approved_at,
    ap.channel AS approval_channel
   FROM ops_acct.payment_allocations a
     JOIN ops_acct.transactions t ON t.id = a.trx_id
     JOIN ops_acct.accounts acc ON acc.id = t.account_id
     LEFT JOIN ops_core.users u ON u.id = a.allocated_by
     LEFT JOIN ops_procure.pr_lines pl ON pl.line_no_full = a.pr_line_no
     LEFT JOIN ops_procure.v_pr_line_status st ON st.line_id = pl.id
     LEFT JOIN ops_procure.v_line_approval ap ON ap.line_id = pl.id AND ap.step = 'GOODS'
  WHERE ops_acct.account_rows_readable(acc.custody);
alter view ops_acct.v_allocation set (security_invoker = on);
grant select on ops_acct.v_allocation to authenticated;
comment on column ops_acct.v_allocation.approved_by is
  'The e-mail of whoever gave the line''s current GOODS decision (v_line_approval, D19), with '
  'approved_at, approved_amount and approval_channel beside it. Null when the allocation names '
  'a PO, the line was never decided, or the reader cannot read the approval trail (0280, L7).';

-- ── the ledger row names its project ─────────────────────────────────────
-- 0274's body with `project_name` appended.
create or replace view ops_acct.v_transaction as
 SELECT t.id,
    t.trx_no,
    t.trx_date,
    t.account_id,
    acc.code AS account_code,
    t.direction,
    t.amount_idr,
    t.type_code,
    t.vendor_id,
    v.name AS vendor_name,
    t.project_id,
    p.code AS project_code,
    t.description,
    t.remark,
    t.status,
    t.source_ref,
    t.posted_by,
    pu.full_name AS posted_by_name,
    t.posted_at,
    t.void_reason,
    t.void_at,
    COALESCE(al.allocated_total, 0::numeric) AS allocated_total,
    t.amount_idr - COALESCE(al.allocated_total, 0::numeric) AS unallocated,
    COALESCE(ev.evidence_count, 0::bigint) AS evidence_count,
    COALESCE(ev.has_payment_proof, false) AS has_payment_proof,
    COALESCE(ev.has_receipt_doc, false) AS has_receipt_doc,
    COALESCE(ln.pr_line_nos, '{}'::text[]) AS pr_line_nos,
    COALESCE(ln.po_nos, '{}'::text[]) AS po_nos,
    t.direction = 'OUT'::ops_acct.direction_t AND COALESCE(ty.is_purchase, true) AS expects_allocation,
    rb.balance_after - rb.signed_amount AS balance_before,
    rb.balance_after,
    COALESCE(t.category_override, ty.category, 'overhead'::ops_acct.category_t) AS category,
    t.category_override,
    p.name AS project_name
   FROM ops_acct.transactions t
     JOIN ops_acct.accounts acc ON acc.id = t.account_id
     LEFT JOIN ops_acct.transaction_types ty ON ty.code = t.type_code
     LEFT JOIN ops_procure.vendors v ON v.id = t.vendor_id
     LEFT JOIN ops_procure.projects p ON p.id = t.project_id
     LEFT JOIN ops_core.users pu ON pu.id = t.posted_by
     LEFT JOIN ops_acct.v_allocated al ON al.trx_id = t.id
     LEFT JOIN LATERAL ( SELECT count(*) AS evidence_count,
            bool_or(k.kind = 'transfer_proof'::ops_core.doc_kind_t) AS has_payment_proof,
            bool_or(k.kind = ANY (ARRAY['nota'::ops_core.doc_kind_t, 'rekening_koran'::ops_core.doc_kind_t])) AS has_receipt_doc
           FROM ops_core.attachment_links k
          WHERE k.entity = 'transaction'::ops_core.link_entity_t AND k.entity_no = t.trx_no AND k.unlinked_at IS NULL) ev ON true
     LEFT JOIN LATERAL ( SELECT array_agg(DISTINCT a.pr_line_no) FILTER (WHERE a.pr_line_no IS NOT NULL) AS pr_line_nos,
            array_agg(DISTINCT a.po_no) FILTER (WHERE a.po_no IS NOT NULL) AS po_nos
           FROM ops_acct.payment_allocations a
          WHERE a.trx_id = t.id AND a.superseded_by IS NULL) ln ON true
     LEFT JOIN ( SELECT r.id,
            r.signed_amount,
            ra.opening_balance + sum(r.signed_amount) OVER (
              PARTITION BY r.account_id ORDER BY r.trx_date, r.trx_no
              ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS balance_after
           FROM ( SELECT x.id, x.account_id, x.trx_date, x.trx_no,
                    CASE WHEN x.direction = 'IN'::ops_acct.direction_t THEN x.amount_idr ELSE - x.amount_idr END AS signed_amount
                   FROM ops_acct.transactions x
                  WHERE x.status <> 'VOID'::ops_acct.trx_status_t) r
             JOIN ops_acct.accounts ra ON ra.id = r.account_id) rb
       ON rb.id = t.id AND t.trx_date >= ops_acct.ledger_balance_from()
  WHERE ops_acct.account_rows_readable(acc.custody);
alter view ops_acct.v_transaction set (security_invoker = on);
grant select on ops_acct.v_transaction to authenticated;

-- ── the detail relays both ───────────────────────────────────────────────
-- 0279's body: `project_name` on the row, the approval on each allocation.
create or replace view ops_acct.v_transaction_detail as
  select v.id, v.trx_no, v.trx_date, v.account_id, v.account_code, v.direction, v.amount_idr,
         v.type_code, v.vendor_id, v.vendor_name, v.project_id, v.project_code, v.description,
         v.remark, v.status, v.source_ref, v.posted_by, v.posted_by_name, v.posted_at,
         v.void_reason, v.void_at, v.allocated_total, v.unallocated, v.evidence_count,
         v.has_payment_proof, v.has_receipt_doc, v.pr_line_nos, v.po_nos, v.expects_allocation,
         v.balance_before, v.balance_after,
         coalesce(li.lines, '[]'::jsonb)       as lines,
         coalesce(ac.allocations, '[]'::jsonb) as allocations,
         coalesce(dc.documents, '[]'::jsonb)   as documents,
         t.billed_currency,
         t.billed_amount,
         t.lines_reviewed_at,
         rb.full_name as lines_reviewed_by_name,
         v.category,
         v.category_override,
         v.project_name
    from ops_acct.v_transaction v
    join ops_acct.transactions t on t.id = v.id
    left join ops_core.users rb on rb.id = t.lines_reviewed_by
    left join lateral (
      select jsonb_agg(jsonb_build_object(
               'id', l.id, 'trx_id', l.trx_id,
               'line_no', l.line_no, 'kind', l.kind, 'item_id', l.item_id,
               'item_code', i.code, 'item_name', i.name,
               'attachment_id', l.attachment_id,
               'description', l.description, 'qty', l.qty, 'uom', l.uom,
               'unit_price', l.unit_price, 'amount', l.amount)
             order by l.line_no) as lines
        from ops_acct.transaction_lines l
        left join ops_procure.items i on i.id = l.item_id
       where l.trx_id = v.id
    ) li on true
    left join lateral (
      select jsonb_agg(jsonb_build_object(
               'pr_line_no', a.pr_line_no, 'po_no', a.po_no,
               'amount', a.amount, 'method', a.method,
               'allocated_by', a.allocated_by_name, 'allocated_at', a.allocated_at,
               'line_description', a.line_description, 'line_status', a.line_status,
               'approved', a.approved, 'approved_amount', a.approved_amount,
               'approved_by', a.approved_by, 'approved_at', a.approved_at,
               'approval_channel', a.approval_channel)
             order by a.allocated_at) as allocations
        from ops_acct.v_allocation a
       where a.trx_id = v.id and a.superseded_by is null
    ) ac on true
    left join lateral (
      select jsonb_agg(jsonb_build_object(
               'attachment_id', at.id, 'filename', at.filename, 'url', at.url,
               'kind', k.kind, 'linked_at', k.linked_at)
             order by k.linked_at) as documents
        from ops_core.attachment_links k
        join ops_core.attachments at on at.id = k.attachment_id
       where k.entity = 'transaction' and k.entity_no = v.trx_no
         and k.unlinked_at is null
    ) dc on true;
alter view ops_acct.v_transaction_detail set (security_invoker = on);
grant select on ops_acct.v_transaction_detail to authenticated;
