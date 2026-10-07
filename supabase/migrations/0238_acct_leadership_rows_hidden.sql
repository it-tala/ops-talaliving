-- 0238_acct_leadership_rows_hidden.sql — a leadership account's rows are read
-- by `approve_funds` only, like its balance (D391).
--
-- Owner, 2026-10-07: *di module accounting, hanya pimpinan dan superadmin yang
-- bisa baca transaksi yang menggunakan account leadership. jumlah balance sudah
-- benar tidak ditampilkan tapi transaksinya tetap terlihat. sembunyikan.*
--
-- D87 locked the **figure** of a leadership account (BCA 064, BCA USD 081, BNI
-- CC, MANDIRI CC) and kept every row on it in the ledger, on the reasoning that
-- hiding an account from people who see every transfer into it is a fiction.
-- The owner has now read the screen that reasoning produced: the balance is
-- gone, and anybody with accounting read can still add up the rows beneath
-- it. The rows go the way of the figure.
--
-- ── who reads them ────────────────────────────────────────────────────────
--
-- The same test as `v_account_balance.balance_locked`: custody `leadership`
-- and no `approve_funds`. On the day this was written the active holders are
-- exactly the two the owner named — leadership and superadmin@ — and keeping
-- one test for both means the balance and the rows cannot disagree about who
-- is allowed to see an account.
--
-- ── where, and why not the table's policy ─────────────────────────────────
--
-- In the accounting views, not in `trx_read`. `ops_procure.v_line_funding`,
-- `v_line_evidence`, `v_po_status`, `v_po_detail`, `v_purchase_facts`,
-- `v_vendor_view` and `ops_prod.v_project_cost` all run as the caller and
-- join `ops_acct.transactions` to decide whether a line is **paid**. A policy
-- on the table would turn a line leadership paid from BCA 064 into an unpaid
-- line on the procurement board for everybody else — a wrong fact, which is
-- worse than the leak it closes. Those views keep counting the money; only
-- the accounting module's own lists stop showing the rows. This is the same
-- level D87 gated the balance at (a view, not the table), and it is written
-- down as F239 rather than assumed.
--
-- Nothing is written differently. Staff with `post_ledger` still record the
-- out leg of a round's funding from the leadership account (D78); they get
-- the trx_no back from the seam and the row is then leadership's to read.

create or replace function ops_acct.account_rows_readable(p_custody ops_acct.account_custody_t)
returns boolean
language sql stable set search_path = ops_acct, pg_temp as $$
  select p_custody <> 'leadership' or ops_core.has_authority('approve_funds')
$$;
comment on function ops_acct.account_rows_readable(ops_acct.account_custody_t) is
  'Whether the caller may read rows on an account of this custody: everybody for accounting''s, '
  '`approve_funds` for leadership''s (D87 for the balance, D391 for the rows).';
grant execute on function ops_acct.account_rows_readable(ops_acct.account_custody_t) to authenticated;

-- ── the ledger row ────────────────────────────────────────────────────────
-- `v_transaction_detail` reads this view, so the drawer goes with it.
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
    t.direction = 'OUT'::ops_acct.direction_t AND COALESCE(ty.is_purchase, true) AS expects_allocation
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
  WHERE ops_acct.account_rows_readable(acc.custody);

-- ── what a row paid for ───────────────────────────────────────────────────
-- An allocation names its transaction and amount, so it is the row again.
-- Coverage on the board is `v_line_funding`'s and is not touched.
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
    st.status AS line_status
   FROM ops_acct.payment_allocations a
     JOIN ops_acct.transactions t ON t.id = a.trx_id
     JOIN ops_acct.accounts acc ON acc.id = t.account_id
     LEFT JOIN ops_core.users u ON u.id = a.allocated_by
     LEFT JOIN ops_procure.pr_lines pl ON pl.line_no_full = a.pr_line_no
     LEFT JOIN ops_procure.v_pr_line_status st ON st.line_id = pl.id
  WHERE ops_acct.account_rows_readable(acc.custody);

-- ── a vendor's payments ───────────────────────────────────────────────────
-- D180's own example is a payment leadership made straight to a timber
-- vendor out of BCA 064 — exactly the row this hides from the vendor page.
create or replace view ops_acct.v_vendor_payment as
 SELECT t.trx_no,
    t.trx_date,
    t.vendor_id,
    t.amount_idr AS amount,
    t.description,
    t.status,
    COALESCE(ap.applies_to, '[]'::jsonb) AS applies_to,
    proof.attachment_id AS proof_attachment_id,
    proof.filename AS proof_filename
   FROM ops_acct.transactions t
     JOIN ops_acct.accounts acc ON acc.id = t.account_id
     LEFT JOIN LATERAL ( SELECT jsonb_agg(jsonb_build_object('po_no', a.po_no, 'amount', a.amount) ORDER BY a.po_no) AS applies_to
           FROM ops_acct.payment_allocations a
          WHERE a.trx_id = t.id AND a.superseded_by IS NULL AND a.po_no IS NOT NULL) ap ON true
     LEFT JOIN LATERAL ( SELECT al.attachment_id,
            att.filename
           FROM ops_core.attachment_links al
             JOIN ops_core.attachments att ON att.id = al.attachment_id
          WHERE al.entity = 'transaction'::ops_core.link_entity_t AND al.entity_no = t.trx_no AND al.kind = 'transfer_proof'::ops_core.doc_kind_t AND al.unlinked_at IS NULL
          ORDER BY al.linked_at DESC
         LIMIT 1) proof ON true
  WHERE t.direction = 'OUT'::ops_acct.direction_t AND t.vendor_id IS NOT NULL
    AND ops_acct.account_rows_readable(acc.custody);

-- ── the rekening koran ────────────────────────────────────────────────────
-- For the leadership accounts the statement is how their rows come to exist
-- (D180): every line on it is a ledger row, with the bank's own description
-- and the running balance printed beside it. Hiding the ledger and leaving
-- the statement open would hide nothing.
create or replace view ops_acct.v_bank_statement as
 SELECT s.id,
    s.statement_no,
    s.account_id,
    a.code AS account_code,
    a.name AS account_name,
    s.period_start,
    s.period_end,
    s.opening_balance,
    s.closing_balance,
    s.currency,
    s.filename,
    s.status,
    s.attachment_id,
    s.note,
    s.uploaded_by,
    u.full_name AS uploaded_by_name,
    s.uploaded_at,
    COALESCE(l.movement, 0::numeric) AS movement,
    s.opening_balance + COALESCE(l.movement, 0::numeric) AS computed_closing,
    abs(s.opening_balance + COALESCE(l.movement, 0::numeric) - s.closing_balance) <= ops_core.money_tolerance() AS balance_ok,
    COALESCE(l.unmatched, 0::bigint) AS unmatched,
    COALESCE(l.matched, 0::bigint) AS matched,
    COALESCE(l.booked, 0::bigint) AS booked,
    COALESCE(l.ignored, 0::bigint) AS ignored,
    COALESCE(l.awaiting_rate, 0::bigint) AS awaiting_rate
   FROM ops_acct.bank_statements s
     JOIN ops_acct.accounts a ON a.id = s.account_id
     LEFT JOIN ops_core.users u ON u.id = s.uploaded_by
     LEFT JOIN LATERAL ( SELECT sum(
                CASE
                    WHEN statement_lines.direction = 'IN'::ops_acct.direction_t THEN statement_lines.amount
                    ELSE - statement_lines.amount
                END) AS movement,
            count(*) FILTER (WHERE statement_lines.status = 'unmatched'::text) AS unmatched,
            count(*) FILTER (WHERE statement_lines.status = 'matched'::text) AS matched,
            count(*) FILTER (WHERE statement_lines.status = 'booked'::text) AS booked,
            count(*) FILTER (WHERE statement_lines.status = 'ignored'::text) AS ignored,
            count(*) FILTER (WHERE statement_lines.amount_idr IS NULL AND statement_lines.status <> 'ignored'::text) AS awaiting_rate
           FROM ops_acct.statement_lines
          WHERE statement_lines.statement_id = s.id) l ON true
  WHERE ops_acct.account_rows_readable(a.custody);

create or replace view ops_acct.v_statement_line as
 SELECT sl.id,
    sl.statement_id,
    s.statement_no,
    sl.line_no,
    sl.value_date,
    sl.direction,
    sl.amount,
    sl.amount_idr,
    sl.fx_rate,
    sl.raw_description,
    sl.balance_after,
    sl.status,
    sl.trx_no,
    sl.note,
    COALESCE(u.email, ''::ops_core.citext) AS decided_by,
    sl.decided_at
   FROM ops_acct.statement_lines sl
     JOIN ops_acct.bank_statements s ON s.id = sl.statement_id
     JOIN ops_acct.accounts a ON a.id = s.account_id
     LEFT JOIN ops_core.users u ON u.id = sl.decided_by
  WHERE ops_acct.account_rows_readable(a.custody);

create or replace view ops_acct.v_statement_suggestion as
 SELECT sl.id AS statement_line_id,
    t.trx_no,
    t.trx_date,
    t.description,
    t.amount_idr,
    abs(t.trx_date - sl.value_date) AS days_apart
   FROM ops_acct.statement_lines sl
     JOIN ops_acct.bank_statements s ON s.id = sl.statement_id
     JOIN ops_acct.accounts a ON a.id = s.account_id
     JOIN ops_acct.transactions t ON t.account_id = s.account_id AND t.direction = sl.direction AND t.status <> 'VOID'::ops_acct.trx_status_t AND abs(t.amount_idr - COALESCE(sl.amount_idr, sl.amount)) <= ops_core.money_tolerance() AND abs(t.trx_date - sl.value_date) <= 3
  WHERE sl.status = 'unmatched'::text
    AND ops_acct.account_rows_readable(a.custody);

-- `create or replace view` keeps reloptions, and these were already invoker
-- (`0020`); stated again so the file says so on its own.
alter view ops_acct.v_transaction          set (security_invoker = on);
alter view ops_acct.v_allocation           set (security_invoker = on);
alter view ops_acct.v_vendor_payment       set (security_invoker = on);
alter view ops_acct.v_bank_statement       set (security_invoker = on);
alter view ops_acct.v_statement_line       set (security_invoker = on);
alter view ops_acct.v_statement_suggestion set (security_invoker = on);
