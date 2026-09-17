-- 0020_acct_views.sql — the balance, the ledger row, and the exception road's
-- health.
--
-- **The database owns the balance** (D9). No screen recomputes it, and a screen
-- that cannot load it shows an em dash rather than a substitute — a client-side
-- stand-in is how a page ends up disagreeing with the books.

-- opening + in − out, VOID excluded. Voided rows keep their amount (A5, D84)
-- and contribute nothing, which is the whole reason the filter is here rather
-- than the amount being zeroed.
create or replace view ops_acct.v_account_balance as
  select a.id as account_id, a.code, a.name, a.custody, a.currency,
         a.is_paying, a.opening_balance, a.opened_on, a.is_active,
         coalesce(m.total_in, 0)  as total_in,
         coalesce(m.total_out, 0) as total_out,
         a.opening_balance + coalesce(m.total_in, 0) - coalesce(m.total_out, 0) as balance,
         -- **Locked, not hidden** (D87). Leadership's accounts are visible to
         -- everybody who can read accounting — hiding an account from people
         -- who can see every transfer into it is a fiction they see through.
         -- What is gated is the figure, and the flag says which is which so a
         -- screen can print "locked" rather than an unexplained blank.
         (a.custody = 'leadership' and not ops_core.has_authority('approve_funds'))
           as balance_locked
    from ops_acct.accounts a
    left join (
      select account_id,
             sum(amount_idr) filter (where direction = 'IN')  as total_in,
             sum(amount_idr) filter (where direction = 'OUT') as total_out
        from ops_acct.transactions where status <> 'VOID'
       group by account_id
    ) m on m.account_id = a.id;

create or replace view ops_acct.v_allocated as
  select trx_id, sum(amount) as allocated_total
    from ops_acct.payment_allocations
   where superseded_by is null
   group by trx_id;

create or replace view ops_acct.v_transaction as
  select t.id, t.trx_no, t.trx_date, t.account_id, acc.code as account_code,
         t.direction, t.amount_idr, t.type_code, t.vendor_id,
         v.name as vendor_name, t.project_id, p.code as project_code,
         t.description, t.remark, t.status, t.source_ref,
         t.posted_by, pu.full_name as posted_by_name, t.posted_at,
         t.void_reason, t.void_at,

         coalesce(al.allocated_total, 0) as allocated_total,
         -- A transaction never funds more than it moved (A9). The seam
         -- enforces it; this is where a screen reads how much room is left.
         t.amount_idr - coalesce(al.allocated_total, 0) as unallocated,

         coalesce(ev.evidence_count, 0)        as evidence_count,
         coalesce(ev.has_payment_proof, false) as has_payment_proof,
         coalesce(ev.has_receipt_doc, false)   as has_receipt_doc,
         coalesce(ln.pr_line_nos, '{}')        as pr_line_nos,
         coalesce(ln.po_nos, '{}')             as po_nos,

         -- Is this kind of spending expected to name the decision behind it?
         --
         -- A purchase is. Payroll and the electricity bill are not (D83) —
         -- flagging them would drown the rows that matter, and people learn to
         -- ignore a flag that fires two thirds of the time. An **unknown**
         -- type counts as expected, deliberately: if it did not, the way to
         -- make spending escape the check would be to type a category that
         -- does not exist yet.
         (t.direction = 'OUT' and coalesce(ty.is_purchase, true)) as expects_allocation
    from ops_acct.transactions t
    join ops_acct.accounts acc on acc.id = t.account_id
    left join ops_acct.transaction_types ty on ty.code = t.type_code
    left join ops_procure.vendors  v on v.id = t.vendor_id
    left join ops_procure.projects p on p.id = t.project_id
    left join ops_core.users      pu on pu.id = t.posted_by
    left join ops_acct.v_allocated al on al.trx_id = t.id
    left join lateral (
      select count(*)                                        as evidence_count,
             bool_or(k.kind = 'transfer_proof')               as has_payment_proof,
             bool_or(k.kind in ('nota','rekening_koran'))     as has_receipt_doc
        from ops_core.attachment_links k
       where k.entity = 'transaction' and k.entity_no = t.trx_no
         and k.unlinked_at is null
    ) ev on true
    left join lateral (
      select array_agg(distinct a.pr_line_no) filter (where a.pr_line_no is not null) as pr_line_nos,
             array_agg(distinct a.po_no)      filter (where a.po_no is not null)      as po_nos
        from ops_acct.payment_allocations a
       where a.trx_id = t.id and a.superseded_by is null
    ) ln on true;

-- One allocation with enough of the line to read it without a second call.
create or replace view ops_acct.v_allocation as
  select a.id, a.trx_id, t.trx_no, a.pr_line_no, a.po_no, a.amount, a.method,
         a.superseded_by, a.allocated_by, u.full_name as allocated_by_name,
         a.allocated_at,
         pl.description as line_description,
         st.status      as line_status
    from ops_acct.payment_allocations a
    join ops_acct.transactions t on t.id = a.trx_id
    left join ops_core.users u on u.id = a.allocated_by
    left join ops_procure.pr_lines pl on pl.line_no_full = a.pr_line_no
    left join ops_procure.v_pr_line_status st on st.line_id = pl.id;

-- Everything a ledger row is made of, in one call: what it bought, what it
-- funded, and what proves it.
create or replace view ops_acct.v_transaction_detail as
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

-- One payment to a vendor, and what it settled.
--
-- `applies_to` is a list because one transfer really does close three orders,
-- and recording that as three payments would say the bank moved money three
-- times. The bank saw one payment; the vendor closed three orders; both are
-- true and both are kept (D97).
create or replace view ops_acct.v_vendor_payment as
  select t.trx_no, t.trx_date, t.vendor_id, t.amount_idr as amount,
         t.description, t.status,
         coalesce(ap.applies_to, '[]'::jsonb) as applies_to
    from ops_acct.transactions t
    left join lateral (
      select jsonb_agg(jsonb_build_object('po_no', a.po_no, 'amount', a.amount)
             order by a.po_no) as applies_to
        from ops_acct.payment_allocations a
       where a.trx_id = t.id and a.superseded_by is null and a.po_no is not null
    ) ap on true
   where t.direction = 'OUT' and t.vendor_id is not null;

-- ── the exception road's health ───────────────────────────────────────────
-- Not decoration. If this number grows, people are routing around the normal
-- road — attaching from the record — and the reason is worth finding
-- (ADR-010). A count nobody looks at is a road nobody notices closing.
create or replace view ops_acct.v_inbox_health as
  select (ops_core.office_day() - 7)                                   as week_start,
         count(*) filter (where reported_at >= now() - interval '7 days') as arrived,
         count(*) filter (where status = 'PENDING')                as unresolved,
         count(*) filter (where origin = 'chat'
                            and reported_at >= now() - interval '7 days') as from_chat,
         count(*) filter (where origin = 'web'
                            and reported_at >= now() - interval '7 days') as from_web,
         -- The oldest thing nobody has dealt with. An average age hides the one
         -- document that has been sitting there since March, which is the only
         -- one anybody needs to know about.
         min(reported_at) filter (where status = 'PENDING')        as oldest_pending_at
    from ops_acct.evidence_inbox;

-- ── the statement, whole ──────────────────────────────────────────────────
create or replace view ops_acct.v_bank_statement as
  select s.id, s.account_id, a.code as account_code, a.name as account_name,
         s.period_start, s.period_end, s.opening_balance, s.closing_balance,
         s.currency, s.filename, s.status, s.attachment_id, s.note,
         s.uploaded_by, u.full_name as uploaded_by_name, s.uploaded_at,
         coalesce(l.movement, 0) as movement,
         s.opening_balance + coalesce(l.movement, 0) as computed_closing,
         -- What the bank printed against what its own lines add up to. They
         -- disagree when the file is partial, and that is worth **refusing to
         -- hide** (D182) — a statement that does not balance is the one case
         -- where the evidence itself is in question.
         abs(s.opening_balance + coalesce(l.movement, 0) - s.closing_balance)
           <= ops_core.money_tolerance() as balance_ok,
         coalesce(l.unmatched, 0) as unmatched,
         coalesce(l.matched, 0)   as matched,
         coalesce(l.booked, 0)    as booked,
         coalesce(l.ignored, 0)   as ignored,
         -- Lines in a foreign currency with no rate typed yet. They cannot
         -- reach the ledger, and the screen says how many rather than quietly
         -- leaving them out (D181).
         coalesce(l.awaiting_rate, 0) as awaiting_rate
    from ops_acct.bank_statements s
    join ops_acct.accounts a on a.id = s.account_id
    left join ops_core.users u on u.id = s.uploaded_by
    left join lateral (
      select sum(case when direction = 'IN' then amount else -amount end) as movement,
             count(*) filter (where status = 'unmatched') as unmatched,
             count(*) filter (where status = 'matched')   as matched,
             count(*) filter (where status = 'booked')    as booked,
             count(*) filter (where status = 'ignored')   as ignored,
             count(*) filter (where amount_idr is null and status <> 'ignored')
               as awaiting_rate
        from ops_acct.statement_lines where statement_id = s.id
    ) l on true;

-- A ledger row that looks like this statement line — same account, same
-- direction, same amount, near the same day. **A suggestion, never applied by
-- itself** (D180): the view proposes and a person decides, which is why this is
-- a view and not a column on the line.
create or replace view ops_acct.v_statement_suggestion as
  select sl.id as statement_line_id,
         t.trx_no, t.trx_date, t.description, t.amount_idr,
         abs(t.trx_date - sl.value_date) as days_apart
    from ops_acct.statement_lines sl
    join ops_acct.bank_statements s on s.id = sl.statement_id
    join ops_acct.transactions t
      on t.account_id = s.account_id
     and t.direction  = sl.direction
     and t.status <> 'VOID'
     and abs(t.amount_idr - coalesce(sl.amount_idr, sl.amount)) <= ops_core.money_tolerance()
     -- A bank posting a couple of days late is normal and worth showing; a
     -- fortnight apart is a coincidence of amount, not a match.
     and abs(t.trx_date - sl.value_date) <= 3
   where sl.status = 'unmatched';

alter view ops_acct.v_account_balance      set (security_invoker = on);
alter view ops_acct.v_allocated            set (security_invoker = on);
alter view ops_acct.v_transaction          set (security_invoker = on);
alter view ops_acct.v_allocation           set (security_invoker = on);
alter view ops_acct.v_transaction_detail   set (security_invoker = on);
alter view ops_acct.v_vendor_payment       set (security_invoker = on);
alter view ops_acct.v_inbox_health         set (security_invoker = on);
alter view ops_acct.v_bank_statement       set (security_invoker = on);
alter view ops_acct.v_statement_suggestion set (security_invoker = on);

grant select on ops_acct.v_account_balance, ops_acct.v_allocated, ops_acct.v_transaction,
                ops_acct.v_allocation, ops_acct.v_transaction_detail,
                ops_acct.v_vendor_payment, ops_acct.v_inbox_health,
                ops_acct.v_bank_statement, ops_acct.v_statement_suggestion
  to authenticated;
