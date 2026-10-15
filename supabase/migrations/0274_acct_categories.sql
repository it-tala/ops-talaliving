-- 0274 — categories on the ledger (L9; D433, D435; kajian §6.8, §10).
--
-- Leadership's question (K5) is *how much went where*, and the transaction
-- type never answered it: a type says which sheet a row came from, and the
-- same sheet carried transfers, payroll and the electricity bill side by
-- side (kajian §10). So every type now carries a **category** — ten of them,
-- named in English as the owner asked (D435): `transfer · income · vendor ·
-- payroll · fixed · overhead · bank · tax · ejo · saripan` — and a row can
-- carry one of its own (`transactions.category_override`) for the two cases a
-- type cannot decide: money in from outside on the transfer type, and the
-- leadership household paid through an ordinary type (§10.3 rules 7 and 9).
-- Effective category = `coalesce(override, type.category)`; a `fee` line
-- counts to `bank` and a `tax` line to `tax` whatever the row's category
-- (§6.8), which is what the summary views below do.
--
-- Four summary views feed `/accounting/ringkasan` (month × category, per
-- project, top vendors, transfers between accounts) and one, `v_funding`,
-- brings the liquidation report (D106) to the real side. Two seams change
-- what the views read. And one function — `recategorise_2026`, not granted to
-- anyone — carries the one-time, audited move of the rows the kajian found
-- in the wrong type (§10.3), with before/after on every row it touches.

-- ── 1. the categories ─────────────────────────────────────────────────────
create type ops_acct.category_t as enum
  ('transfer','income','vendor','payroll','fixed','overhead','bank','tax','ejo','saripan');

comment on type ops_acct.category_t is
  'What a ledger row was for, as leadership reads it (D433, D435). transfer: between our own '
  'accounts, cash withdrawals, USD conversion · income: money from outside · vendor: goods and '
  'services for production, projects and stock · payroll · fixed: rent, utilities, subscriptions, '
  'monthly consultants · overhead: fuel, office and warehouse supplies, meals · bank: admin fees, '
  'card interest · tax: payments to the state · ejo and saripan: the leadership household, reported '
  'apart and outside the burn.';

alter table ops_acct.transaction_types
  add column if not exists category ops_acct.category_t not null default 'overhead';
comment on column ops_acct.transaction_types.category is
  'The category every row of this type gets unless the row says otherwise '
  '(transactions.category_override). A type nobody has classified is overhead, which is '
  'at least counted in the burn rather than hidden from it.';

-- Kajian §10.1, with the owner''s answers (§10.5): EJO and CREDIT CARD keep
-- their codes. Types the ladder does not seed (added in master data, imported
-- with the ledger) are matched by code and simply absent on a fresh database.
update ops_acct.transaction_types t set category = c.category::ops_acct.category_t
  from (values
    ('CASHFLOW',                    'transfer'),
    ('CREDIT CARD',                 'transfer'),
    ('SUPPLIERS',                   'vendor'),
    ('PREPAID VENDOR',              'vendor'),
    ('PRODUCTION',                  'vendor'),
    ('CHINA',                       'vendor'),
    ('ONLINE',                      'vendor'),
    ('RECCURING - PAYROLL',         'payroll'),
    ('RECCURING - PAYROLL MONTHLY', 'payroll'),
    ('RECCURING - PAYROLL WEEKLY',  'payroll'),
    ('RECCURING - OVERTIME',        'payroll'),
    ('RECCURING - UTILITIES',       'fixed'),
    ('SUBSCRIPTION',                'fixed'),
    ('OTHERS',                      'overhead'),
    ('TRANSPORT',                   'overhead'),
    ('WAREHOUSE',                   'overhead'),
    ('OFFICE',                      'overhead'),
    ('BANK CHARGES',                'bank'),
    ('EJO',                         'ejo')
  ) c(code, category)
 where t.code = c.code;

alter table ops_acct.transactions
  add column if not exists category_override ops_acct.category_t;
comment on column ops_acct.transactions.category_override is
  'A category for this row alone, beating the type''s (§10.3 rules 7 and 9): money in from '
  'outside booked on CASHFLOW is income, not transfer; the household''s rent on UTILITIES is '
  'saripan, not fixed. Null means the type decides. Set through set_transaction_category.';

-- ── 2. v_transaction carries the effective category ──────────────────────
-- The body is 0268's with two columns at the end: `category` (effective) and
-- `category_override`. `create or replace` accepts columns appended.
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
    t.category_override
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

comment on column ops_acct.v_transaction.category is
  'coalesce(category_override, the type''s category). What the summaries count the row as — '
  'except its fee lines (bank) and tax lines (tax), see v_category_part.';

-- `v_transaction_detail` is `v.*` plus columns, and `*` was expanded when
-- 0273 created it, so the two new columns are not in it. Rather than drop
-- and remake it (0268 did; production holds a DROP for confirmation that
-- never arrives, F-0211), it is replaced with its columns named in the
-- order it already has, and the two new ones appended — which `create or
-- replace` accepts.
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
         v.category_override
    from ops_acct.v_transaction v
    join ops_acct.transactions t on t.id = v.id
    left join ops_core.users rb on rb.id = t.lines_reviewed_by
    left join lateral (
      select jsonb_agg(jsonb_build_object(
               'id', l.id, 'trx_id', l.trx_id,
               'line_no', l.line_no, 'kind', l.kind, 'item_id', l.item_id,
               'item_code', i.code, 'item_name', i.name,
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

alter view ops_acct.v_transaction        set (security_invoker = on);
alter view ops_acct.v_transaction_detail set (security_invoker = on);
grant select on ops_acct.v_transaction, ops_acct.v_transaction_detail to authenticated;

-- ── 3. what each row counts as, in parts ─────────────────────────────────
-- One row per transaction, plus one for its admin-fee lines (→ bank) and
-- one for its tax lines (→ tax), when the row has them and its lines add up
-- to its amount. A row whose lines do not add up (an old import) counts as
-- one part at its category: the summary never invents or loses a rupiah.
create or replace view ops_acct.v_category_part as
  with split as (
    select v.id, v.trx_no, v.trx_date, to_char(v.trx_date, 'YYYY-MM') as month,
           v.direction, v.category, v.type_code, v.account_id, v.account_code,
           v.vendor_id, v.vendor_name, v.project_id, v.project_code, v.amount_idr,
           case when ls.total = v.amount_idr then coalesce(ls.fee, 0) else 0 end as fee,
           case when ls.total = v.amount_idr then coalesce(ls.tax, 0) else 0 end as tax
      from ops_acct.v_transaction v
      left join (
        select l.trx_id,
               sum(case when l.kind = 'discount' then -l.amount else l.amount end) as total,
               sum(l.amount) filter (where l.kind = 'fee') as fee,
               sum(l.amount) filter (where l.kind = 'tax') as tax
          from ops_acct.transaction_lines l
         group by l.trx_id
      ) ls on ls.trx_id = v.id
     where v.status <> 'VOID'
  )
  select id, trx_no, trx_date, month, direction, type_code, account_id, account_code,
         vendor_id, vendor_name, project_id, project_code, amount_idr,
         category                 as part_category, amount_idr - fee - tax as amount
    from split
  union all
  select id, trx_no, trx_date, month, direction, type_code, account_id, account_code,
         vendor_id, vendor_name, project_id, project_code, amount_idr,
         'bank'::ops_acct.category_t, fee
    from split where fee > 0
  union all
  select id, trx_no, trx_date, month, direction, type_code, account_id, account_code,
         vendor_id, vendor_name, project_id, project_code, amount_idr,
         'tax'::ops_acct.category_t, tax
    from split where tax > 0;

comment on view ops_acct.v_category_part is
  'Every non-void ledger row split into what it counts as: its category for the body, bank for '
  'its fee lines, tax for its tax lines (§6.8). Σ amount over a row = its amount_idr. The '
  'summary views below group this; nothing else should.';

-- Month × category, both directions. Twelve months × ten columns on screen.
create or replace view ops_acct.v_category_month as
  select month, direction, part_category as category,
         count(distinct id) as n, sum(amount) as amount
    from ops_acct.v_category_part
   group by month, direction, part_category;

-- Spending per project, by category: every project with a row on it, not
-- only those with a work order (§6.8); the contract value beside it when
-- the project has one, so cost can be read against it.
create or replace view ops_acct.v_project_spend as
  select p.project_id, p.project_code, pr.name as project_name, pr.contract_value,
         p.month, p.part_category as category, count(distinct p.id) as n, sum(p.amount) as amount,
         max(p.trx_date) as last_date
    from ops_acct.v_category_part p
    join ops_procure.projects pr on pr.id = p.project_id
   where p.direction = 'OUT'
   group by p.project_id, p.project_code, pr.name, pr.contract_value, p.month, p.part_category;

-- Money out per vendor per month. The screen ranks the year and shows the
-- months; the view stays one shape whichever window is asked for.
create or replace view ops_acct.v_vendor_spend as
  select vendor_id, vendor_name, month, part_category as category,
         count(distinct id) as n, sum(amount) as amount, max(trx_date) as last_date
    from ops_acct.v_category_part
   where direction = 'OUT' and vendor_id is not null
   group by vendor_id, vendor_name, month, part_category;

-- Transfers between our own accounts, per month and account: what left and
-- what landed. Σ out − Σ in across all accounts for a month is money on the
-- way, or a leg that was never booked (F29: nothing ties the two legs).
create or replace view ops_acct.v_transfer_month as
  select p.month, p.account_id, p.account_code, a.custody,
         sum(p.amount) filter (where p.direction = 'OUT') as transfer_out,
         sum(p.amount) filter (where p.direction = 'IN')  as transfer_in,
         count(distinct p.id) filter (where p.direction = 'OUT') as n_out,
         count(distinct p.id) filter (where p.direction = 'IN')  as n_in
    from ops_acct.v_category_part p
    join ops_acct.accounts a on a.id = p.account_id
   where p.part_category = 'transfer'
   group by p.month, p.account_id, p.account_code, a.custody;

-- ── 4. liquidation on the real side (D106) ───────────────────────────────
-- One transfer into an operating account, and the window until the next
-- one into the same account. The money that left in that window is compared
-- with what was sent; nothing traces individual rupiah (see FundingView).
-- A funding is money *in*, of category transfer, on an accounting-custody
-- account: income from a client is not leadership's transfer, and a transfer
-- landing on leadership's own account has not been given to the business.
create or replace view ops_acct.v_funding as
  with f as (
    select v.id, v.trx_no, v.trx_date, v.account_id, v.account_code,
           v.amount_idr as amount, v.description, v.balance_before,
           lead(v.trx_no)   over w as next_funding_no,
           lead(v.trx_date) over w as window_end
      from ops_acct.v_transaction v
      join ops_acct.accounts a on a.id = v.account_id
     where v.direction = 'IN' and v.status <> 'VOID'
       and a.custody = 'accounting' and v.category = 'transfer'
    window w as (partition by v.account_id order by v.trx_date, v.trx_no)
  )
  select f.id, f.trx_no, f.trx_date, f.account_id, f.account_code, f.amount, f.description,
         f.balance_before, f.next_funding_no, f.window_end,
         coalesce(s.spent, 0)     as spent,
         s.consumed_on,
         case when s.consumed_on is null then null else s.consumed_on - f.trx_date end as days_lasted,
         greatest(f.amount - coalesce(s.spent, 0), 0) as remaining,
         greatest(coalesce(s.spent, 0) - f.amount, 0) as beyond,
         coalesce(s.decided, 0)   as decided,
         coalesce(s.undecided, 0) as undecided,
         f.next_funding_no is null as is_open,
         m.account_code as from_account_code,
         pf.filename as proof_filename
    from f
    left join lateral (
      select sum(o.amount_idr) as spent,
             sum(o.amount_idr) filter (where o.decided) as decided,
             sum(o.amount_idr) filter (where not o.decided and o.expects_allocation) as undecided,
             min(o.trx_date) filter (where o.running >= f.amount) as consumed_on
        from (
          select x.amount_idr, x.trx_date, x.expects_allocation,
                 (cardinality(x.pr_line_nos) > 0 or cardinality(x.po_nos) > 0) as decided,
                 sum(x.amount_idr) over (order by x.trx_date, x.trx_no) as running
            from ops_acct.v_transaction x
           where x.account_id = f.account_id and x.direction = 'OUT' and x.status <> 'VOID'
             and (x.trx_date, x.trx_no) > (f.trx_date, f.trx_no)
             and (f.next_funding_no is null or (x.trx_date, x.trx_no) < (f.window_end, f.next_funding_no))
        ) o
    ) s on true
    -- the mirror leg: same day, same amount, leaving a leadership account —
    -- a match on what is there, used only to name where it came from (F29)
    left join lateral (
      select m.account_code
        from ops_acct.v_transaction m
        join ops_acct.accounts ma on ma.id = m.account_id
       where m.direction = 'OUT' and m.status <> 'VOID' and m.trx_date = f.trx_date
         and m.amount_idr = f.amount and m.account_id <> f.account_id and ma.custody = 'leadership'
       order by m.trx_no limit 1
    ) m on true
    left join lateral (
      select at.filename
        from ops_core.attachment_links k
        join ops_core.attachments at on at.id = k.attachment_id
       where k.entity = 'transaction' and k.entity_no = f.trx_no
         and k.unlinked_at is null and k.kind = 'transfer_proof'
       order by k.linked_at limit 1
    ) pf on true;

alter view ops_acct.v_category_part  set (security_invoker = on);
alter view ops_acct.v_category_month set (security_invoker = on);
alter view ops_acct.v_project_spend  set (security_invoker = on);
alter view ops_acct.v_vendor_spend   set (security_invoker = on);
alter view ops_acct.v_transfer_month set (security_invoker = on);
alter view ops_acct.v_funding        set (security_invoker = on);
grant select on ops_acct.v_category_part, ops_acct.v_category_month, ops_acct.v_project_spend,
                ops_acct.v_vendor_spend, ops_acct.v_transfer_month, ops_acct.v_funding
  to authenticated;

-- ── 5. seams ─────────────────────────────────────────────────────────────
create or replace function ops_acct.set_type_category(p_code text, p_category text)
returns jsonb
language plpgsql security definer set search_path = ops_acct, ops_core, pg_temp as $$
declare t ops_acct.transaction_types; v_cat ops_acct.category_t;
begin
  if not ops_core.has_permission('accounting.update') then
    return ops_core.refused('accounting','transaction_type', p_code,'set_category',
      'not_permitted','Editing transaction types needs accounting write access.');
  end if;
  select * into t from ops_acct.transaction_types where code = p_code;
  if not found then
    return ops_core.not_found('accounting','transaction_type', p_code,'set_category','No such transaction type.');
  end if;
  begin
    v_cat := p_category::ops_acct.category_t;
  exception when invalid_text_representation then
    return ops_core.invalid('accounting','transaction_type', p_code,'set_category',
      'unknown_category', format('%s is not a category.', p_category), jsonb_build_object('field','category'));
  end;
  if v_cat = t.category then
    return ops_core.noop('accounting','transaction_type', p_code,'set_category','Nothing changed.',
      jsonb_build_object('code', p_code, 'category', v_cat));
  end if;
  update ops_acct.transaction_types set category = v_cat where code = t.code;
  return ops_core.ok('accounting','transaction_type', p_code,'set_category',
    jsonb_build_object('code', p_code, 'category', v_cat),
    jsonb_build_object('category', t.category), jsonb_build_object('category', v_cat));
end $$;

-- A row's own category. `''` or null clears the override and the type
-- decides again. post_ledger, like every other edit of a booked row (0101);
-- a VOID row is history and keeps what it has.
create or replace function ops_acct.set_transaction_category(p_trx_no text, p_category text)
returns jsonb
language plpgsql security definer set search_path = ops_acct, ops_core, pg_temp as $$
declare t ops_acct.transactions; v_cat ops_acct.category_t; v_type ops_acct.category_t;
        v_before ops_acct.category_t; v_after ops_acct.category_t;
begin
  if not ops_core.has_authority('post_ledger') then
    return ops_core.refused('accounting','transaction', p_trx_no,'set_category',
      'authority_required','Changing a row''s category belongs to whoever posts the ledger.');
  end if;
  select * into t from ops_acct.transactions where trx_no = p_trx_no;
  if not found then
    return ops_core.not_found('accounting','transaction', p_trx_no,'set_category','No such transaction.');
  end if;
  if t.status = 'VOID' then
    return ops_core.conflict('accounting','transaction', p_trx_no,'set_category',
      'transaction_void','A void row keeps its category.');
  end if;
  if nullif(btrim(coalesce(p_category, '')), '') is not null then
    begin
      v_cat := btrim(p_category)::ops_acct.category_t;
    exception when invalid_text_representation then
      return ops_core.invalid('accounting','transaction', p_trx_no,'set_category',
        'unknown_category', format('%s is not a category.', p_category), jsonb_build_object('field','category'));
    end;
  end if;
  select category into v_type from ops_acct.transaction_types where code = t.type_code;
  -- an override equal to the type's own category is no override
  if v_cat = v_type then v_cat := null; end if;
  if v_cat is not distinct from t.category_override then
    return ops_core.noop('accounting','transaction', p_trx_no,'set_category','Nothing changed.',
      jsonb_build_object('trx_no', p_trx_no, 'category', coalesce(v_cat, v_type)));
  end if;
  v_before := coalesce(t.category_override, v_type);
  v_after  := coalesce(v_cat, v_type);
  update ops_acct.transactions set category_override = v_cat where id = t.id;
  return ops_core.ok('accounting','transaction', p_trx_no,'set_category',
    jsonb_build_object('trx_no', p_trx_no, 'category', v_after, 'category_override', v_cat),
    jsonb_build_object('category', v_before, 'category_override', t.category_override),
    jsonb_build_object('category', v_after,  'category_override', v_cat));
end $$;

revoke execute on function
  ops_acct.set_type_category(text, text),
  ops_acct.set_transaction_category(text, text)
  from public;
grant execute on function
  ops_acct.set_type_category(text, text),
  ops_acct.set_transaction_category(text, text)
  to authenticated;

-- ── 6. the one-time move (§10.3), audited row by row ─────────────────────
-- Nine rules read the description (upper-cased) and the vendor's name, the
-- way the people typing them always wrote *TF FROM*, *BENSIN*, *PAYROLL*.
-- Rules 1–6 move a row's **type**; 7–9 set its **override** where it has
-- none. VOID rows, rows before 2026 and rows matched to a bank statement are
-- left alone. Every row it changes gets an audit row with before and after
-- and the rule that moved it, so the move reads like any other edit.
--
-- Not granted to anyone, and not a definer: it is run once, by the
-- migration (a no-op on the ladder, which has no 2026 ledger) and by hand on
-- production after its dry run (`p_apply = false`) has been read. The dry
-- run answers with the counts per rule and per source type.
create or replace function ops_acct.recategorise_2026(p_apply boolean default false)
returns jsonb
-- security *invoker*, on purpose: it rewrites the ledger directly and is a
-- tool for the migration and the SQL editor, which own the tables. A
-- signed-in person has no update right on ops_acct.transactions, so even
-- if called it moves nothing. It is also not granted (A2 checks definers).
language plpgsql set search_path = ops_acct, ops_core, pg_temp as $$
declare
  c_tf  constant text := '\m(TF FROM|TF TO|TRANSFER FROM|TRANSFER TO|WITHDRAWAL|TARIK TUNAI|TOP ?UP|SETOR|KE PETTY|CASH WITHDRAWAL|MOVING TO|BNI IN|TRF/PAY)';
  c_fee constant text := '(ADMIN FEE|BIAYA ADMIN|\mADM\M|\mFEE\M)';
  r record; v_counts jsonb; v_run int;
begin
  -- One scratch table for the transaction, one `run` per call: a dry run
  -- and the apply that follows it in the same transaction (the smoke does
  -- that) must not see each other's rows. Nothing here removes the table or
  -- empties it, not even at commit: production holds such words for a
  -- confirmation that never arrives (F-0211); the session's end takes it.
  create temp table if not exists _recat (
    run int, id uuid, trx_no text, type_code text, description text,
    rule text, to_type text, to_category ops_acct.category_t,
    primary key (run, id)
  );
  v_run := coalesce((select max(run) from _recat), 0) + 1;

  -- rules 1–6: the type moves
  insert into _recat (run, id, trx_no, type_code, description, rule, to_type)
  select v_run, t.id, t.trx_no, t.type_code, t.description, x.rule,
         case x.rule
           when '1' then 'CASHFLOW' when '2' then 'TRANSPORT'
           when '3' then 'RECCURING - PAYROLL' when '4' then 'RECCURING - PAYROLL WEEKLY'
           when '5' then 'OFFICE' when '6' then 'RECCURING - PAYROLL' end
    from ops_acct.transactions t
    cross join lateral (
      select case
        -- 1. an internal transfer booked on another type
        when t.direction = 'OUT' and t.type_code not in ('CASHFLOW','BANK CHARGES')
             and upper(t.description) ~ c_tf and upper(t.description) !~ c_fee
          then '1'
        -- 2. fuel
        when t.direction = 'OUT' and t.type_code not in ('TRANSPORT','BANK CHARGES','CASHFLOW')
             and upper(t.description) ~ '\m(BENSIN|PERTALITE|PERTAMAX|SOLAR|SPBU)\M'
          then '2'
        -- 3. wages booked on another type
        when t.direction = 'OUT' and t.type_code not like 'RECCURING - PAYROLL%'
             and t.type_code not in ('RECCURING - OVERTIME','BANK CHARGES')
             and upper(t.description) ~ '\m(PAYROLL|GAJI|UPAH|PESANGON|THR)\M'
             and upper(t.description) !~ c_tf and upper(t.description) !~ c_fee
          then '3'
        -- 4. the weekly run booked as monthly
        when t.type_code = 'RECCURING - PAYROLL MONTHLY'
             and upper(t.description) ~ '\m(DAILY PAYROLL|WEEKLY)\M'
          then '4'
        -- 5. office supplies booked as payroll
        when t.type_code = 'RECCURING - PAYROLL MONTHLY'
             and upper(t.description) ~ '\m(KEBERSIHAN|MASKER|ATK)\M'
          then '5'
        -- 6. BPJS is payroll
        when t.direction = 'OUT' and t.type_code not like 'RECCURING - PAYROLL%'
             and t.type_code <> 'BANK CHARGES'
             and upper(t.description) ~ '\mBPJS\M'
          then '6'
        end as rule
    ) x
   where t.status <> 'VOID' and t.trx_date >= '2026-01-01'
     and x.rule is not null
     and not exists (select 1 from ops_acct.statement_lines s
                      where s.trx_no = t.trx_no and s.status in ('matched','booked'))
     -- a target type the database does not have (the ladder) is nothing to move to
     and exists (select 1 from ops_acct.transaction_types ty where ty.code = case x.rule
           when '1' then 'CASHFLOW' when '2' then 'TRANSPORT'
           when '3' then 'RECCURING - PAYROLL' when '4' then 'RECCURING - PAYROLL WEEKLY'
           when '5' then 'OFFICE' when '6' then 'RECCURING - PAYROLL' end);

  -- rules 7–9: an override, on rows that have none, read after the moves above
  insert into _recat (run, id, trx_no, type_code, description, rule, to_type, to_category)
  select v_run, t.id, t.trx_no, t.type_code, t.description, x.rule, null,
         case x.rule
           when '7a' then 'saripan' when '7b' then 'ejo' when '8' then 'tax'
           when '9a' then 'income' when '9b' then 'transfer' end::ops_acct.category_t
    from ops_acct.transactions t
    left join _recat m on m.id = t.id and m.run = v_run
    left join ops_procure.vendors v on v.id = t.vendor_id
    left join ops_acct.transaction_types ty on ty.code = coalesce(m.to_type, t.type_code)
    cross join lateral (
      select case
        -- 7a. the Saripan house
        when coalesce(v.name, '') ~* 'saripan' or upper(t.description) ~ '\mSARIPAN\M'
          then '7a'
        -- 7b. the leadership household paid through an ordinary type
        when t.direction = 'OUT' and ty.category <> 'ejo'
             and (coalesce(v.name, '') ~* '(warung kembar|\mejo\M)' or upper(t.description) ~ '\mEJO\M')
          then '7b'
        -- 8. a tax payment to the state (not the consultant's fee)
        when t.direction = 'OUT' and ty.category <> 'tax'
             and upper(t.description) ~ '(PAJAK TERMIN|TAX .*20\d\d|\mSPT\M|SETORAN PAJAK)'
             and upper(t.description) !~ '(KONSULTAN|CONSULT)'
          then '8'
        -- 9a. money in that is not a transfer between our accounts
        when t.direction = 'IN' and upper(t.description) !~ c_tf and ty.category <> 'income'
          then '9a'
        -- 9b. money in that is one, booked on a type whose category is not transfer
        when t.direction = 'IN' and upper(t.description) ~ c_tf and ty.category <> 'transfer'
          then '9b'
        end as rule
    ) x
   where t.status <> 'VOID' and t.trx_date >= '2026-01-01'
     and t.category_override is null
     and x.rule is not null
     and not exists (select 1 from ops_acct.statement_lines s
                      where s.trx_no = t.trx_no and s.status in ('matched','booked'))
  on conflict (run, id) do update
    set rule = _recat.rule || '+' || excluded.rule, to_category = excluded.to_category;

  -- the answer: rows and rupiah per rule, and the source types behind each
  select coalesce(jsonb_object_agg(k.rule, k.body), '{}'::jsonb) into v_counts
    from (
      select rc.rule,
             jsonb_build_object(
               'n', count(*), 'amount', sum(t.amount_idr),
               'to_type', max(rc.to_type), 'to_category', max(rc.to_category::text),
               'from', (select jsonb_object_agg(ft.type_code, ft.n)
                          from (select r2.type_code, count(*) as n from _recat r2
                                 where r2.run = v_run and r2.rule = rc.rule group by r2.type_code) ft)) as body
        from _recat rc join ops_acct.transactions t on t.id = rc.id
       where rc.run = v_run
       group by rc.rule
    ) k;

  if p_apply then
    for r in select x.*, t.category_override as was_override, t.type_code as was_type, t.amount_idr
               from _recat x join ops_acct.transactions t on t.id = x.id
              where x.run = v_run
              order by t.trx_date, t.trx_no
    loop
      update ops_acct.transactions
         set type_code = coalesce(r.to_type, type_code),
             category_override = coalesce(r.to_category, category_override)
       where id = r.id;
      perform ops_core.write_audit('accounting', 'transaction', r.trx_no, 'recategorise', 'ok',
        'Rekategorisasi satu kali dari deskripsi dan vendor (D433, D435; kajian §10.3 aturan ' || r.rule || ')',
        jsonb_build_object('type_code', r.was_type, 'category_override', r.was_override),
        jsonb_build_object('type_code', coalesce(r.to_type, r.was_type),
                           'category_override', coalesce(r.to_category, r.was_override)),
        jsonb_build_object('rule', r.rule, 'amount_idr', r.amount_idr, 'description', r.description));
    end loop;
  end if;

  return jsonb_build_object('applied', p_apply, 'rules', v_counts,
                            'rows', (select count(*) from _recat where run = v_run));
end $$;

revoke execute on function ops_acct.recategorise_2026(boolean) from public, authenticated;

-- The ladder has no 2026 ledger: this answers `{"rows": 0}` and moves nothing.
-- Production runs it by hand after reading the dry run (RUNLOG).
select ops_acct.recategorise_2026(true);

analyze ops_acct.transaction_types;
analyze ops_acct.transactions;
