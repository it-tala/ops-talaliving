-- 0268_acct_running_balance.sql — every ledger row shows the account's
-- balance before and after it (D429).
--
-- Owner, 2026-10-12: *di tabel ledger pastikan ada kolom balance_before
-- balance after … gunanya untuk cek transaksi-nya apakah valid atau salah
-- input angka.* The spreadsheet the business ran on has a balance column per
-- account on every row, and that is how a wrong figure was found: the row
-- where the balance stops agreeing with the bank.
--
-- ── computed, never stored ────────────────────────────────────────────────
--
-- A stored `balance_after` is a copy of a sum, and every copy goes stale the
-- moment anything before it changes. Here that is ordinary, not rare: a row
-- posted late with last week's date, an amount corrected with Edit (0101), a
-- row moved to another account (0204), a VOID. Each one would leave every
-- stored balance below it wrong — which is exactly the spreadsheet's failure,
-- one bad cell poisoning every row beneath it — or need a rewrite of the rest
-- of the account's history, which the audit would then record as thousands of
-- edits nobody made. So it is a window over the rows, like `v_account_balance`
-- (D9: the database owns every number), and the last row's `balance_after`
-- is that view's `balance` by construction.
--
-- ── the order ──────────────────────────────────────────────────────────────
--
-- `trx_date`, then `trx_no` — the order a bank statement has them and the one
-- the demo already uses (`byLedgerOrder`). `trx_no` is minted in posting order,
-- so two rows on one day keep the order they were posted in.
--
-- VOID rows count for nothing and get no balance (null): a voided row did
-- not move money, and printing the balance beside it would read as if it did.
--
-- ── from today, not backwards ──────────────────────────────────────────────
--
-- Owner, the same day: *untuk transaksi lama jika belum pernah ada saldo
-- tersimpan maka biarkan kosong, mulai dari transaksi baru per hari ini.*
-- Rows dated before `ledger_balance_from` (setting, 2026-10-12) show no
-- balance. They still **count**: the first new row starts from the account's
-- balance with every old row in it, so the last row stays equal to
-- `v_account_balance` — only the figure beside the old rows is left empty,
-- because nobody ever checked them against a bank and printing one would
-- claim they had been. The cut is on `trx_date`, the order the ledger is read
-- in, so the empty rows are one block at the bottom rather than scattered.
--
-- *Edit nilai juga meng-edit nilai balance di setiap transaksi di atasnya*
-- holds by construction: nothing is stored, so correcting an amount moves the
-- balance of every later row the next time the ledger is read.
--
-- ── cost ───────────────────────────────────────────────────────────────────
--
-- The window runs over the whole table on every read, because no filter can
-- be pushed beneath it without changing the sum. At this business's volume
-- (a few thousand rows a year) that is milliseconds; it is written down so the
-- day it is not, the fix is a materialised checkpoint, not a stored column.

insert into ops_core.settings (key, value, note) values
  ('ledger_balance_from', '"2026-10-12"'::jsonb,
   'The first trx_date that shows a balance before/after in the ledger (D429). Older rows count '
   'towards it but show none: nobody checked them against a bank. Move it to widen or narrow.')
on conflict (key) do nothing;

create or replace function ops_acct.ledger_balance_from()
returns date
language sql stable security definer set search_path = ops_core, pg_temp as $$
  select coalesce((select (value #>> '{}')::date from ops_core.settings
                    where key = 'ledger_balance_from'), '2026-10-12'::date)
$$;
comment on function ops_acct.ledger_balance_from() is
  'ops_core.settings.ledger_balance_from as a date: rows dated before it show no running balance (D429).';
revoke execute on function ops_acct.ledger_balance_from() from public;
grant  execute on function ops_acct.ledger_balance_from() to authenticated;

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
    rb.balance_after
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

comment on column ops_acct.v_transaction.balance_before is
  'The account''s balance just before this row: opening + every earlier non-void row, '
  'by trx_date then trx_no. Null on a VOID row and on a row dated before '
  'ledger_balance_from(). Computed, never stored (D429).';
comment on column ops_acct.v_transaction.balance_after is
  'balance_before ± this row. The last row on an account equals v_account_balance.balance.';

-- `v_transaction_detail` is `v.*` plus three columns, and `*` is expanded when
-- a view is created: the new columns would land in the middle of it, which
-- `create or replace` refuses. Nothing reads it but the API, so it is made
-- again as it was (0020).
drop view ops_acct.v_transaction_detail;
create view ops_acct.v_transaction_detail as
  select v.*,
         coalesce(li.lines, '[]'::jsonb)       as lines,
         coalesce(ac.allocations, '[]'::jsonb) as allocations,
         coalesce(dc.documents, '[]'::jsonb)   as documents
    from ops_acct.v_transaction v
    left join lateral (
      select jsonb_agg(jsonb_build_object(
               'line_no', l.line_no, 'item_id', l.item_id,
               'description', l.description, 'qty', l.qty, 'uom', l.uom,
               'unit_price', l.unit_price, 'amount', l.amount)
             order by l.line_no) as lines
        from ops_acct.transaction_lines l where l.trx_id = v.id
    ) li on true
    left join lateral (
      select jsonb_agg(jsonb_build_object(
               'pr_line_no', a.pr_line_no, 'po_no', a.po_no,
               'amount', a.amount, 'method', a.method,
               'allocated_by', a.allocated_by_name, 'allocated_at', a.allocated_at,
               'line_description', a.line_description, 'line_status', a.line_status)
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

-- `create or replace` clears a view's options, so both are set again (0238
-- did the same): a view that runs as its owner would read past RLS.
alter view ops_acct.v_transaction        set (security_invoker = on);
alter view ops_acct.v_transaction_detail set (security_invoker = on);
grant select on ops_acct.v_transaction, ops_acct.v_transaction_detail to authenticated;
