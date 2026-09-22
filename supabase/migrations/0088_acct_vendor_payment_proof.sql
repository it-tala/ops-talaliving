-- 0088_acct_vendor_payment_proof.sql — the vendor payment history without a
-- receipt to point at.
--
-- `VendorPayment` (`src/services/accounting/contracts.ts`) has always
-- declared `proof_attachment_id` / `proof_filename` — the same "a claim
-- nothing opened" shape D268 already fixed once for receiving (F88). The demo
-- resolves them by finding the transaction's `Payment Proof` attachment link;
-- this view never carried them, so `accounting.paymentsForVendor` could only
-- ever answer a row that could not be checked.
--
-- Appended at the end, not restated among the existing columns — a view can
-- add columns but not reorder the ones already there.
create or replace view ops_acct.v_vendor_payment as
  select t.trx_no, t.trx_date, t.vendor_id, t.amount_idr as amount,
         t.description, t.status,
         coalesce(ap.applies_to, '[]'::jsonb) as applies_to,
         proof.attachment_id as proof_attachment_id,
         proof.filename      as proof_filename
    from ops_acct.transactions t
    left join lateral (
      select jsonb_agg(jsonb_build_object('po_no', a.po_no, 'amount', a.amount)
             order by a.po_no) as applies_to
        from ops_acct.payment_allocations a
       where a.trx_id = t.id and a.superseded_by is null and a.po_no is not null
    ) ap on true
    left join lateral (
      select al.attachment_id, att.filename
        from ops_core.attachment_links al
        join ops_core.attachments att on att.id = al.attachment_id
       where al.entity = 'transaction' and al.entity_no = t.trx_no
         and al.kind = 'transfer_proof' and al.unlinked_at is null
       order by al.linked_at desc
       limit 1
    ) proof on true
   where t.direction = 'OUT' and t.vendor_id is not null;

alter view ops_acct.v_vendor_payment set (security_invoker = on);
