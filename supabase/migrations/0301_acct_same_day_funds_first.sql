-- 0301 — Same-day money in comes before that day's money out (D459).
--
-- A ledger row's number is given when the row is *recorded*, not when the
-- money moved. A transfer into BCA 271 recorded four days late
-- (trx-26-09-01_016, dated 2026-08-27) therefore sorted after the payments it
-- paid for that same day, and the running balance printed −8.6M in between.
-- On BCA 271 that happened on 25 rows; no day ever *ended* below zero
-- (F-same-day). Ordering a day's IN rows before its OUT rows removes every one
-- of them, so on a running account the order is now (trx_date, IN first,
-- trx_no) — D429's "same day: posting order" still holds inside each side.
--
-- Three readers change, nothing is stored:
--   1. `v_transaction` — the running balance of a `running` account. An
--      `anchored` account keeps (trx_date, trx_no): its readings name the row
--      they come after (`after_trx_no`, D456), so its order is the bank's.
--   2. `v_funding` — a fund's window is the days from its date up to the next
--      fund's date. A payment on the fund's own day belongs to that fund, not
--      to the one before; two funds on one day leave the first an empty window.
--   3. `ledger_sheet_rows()` — the GL OPS sheet lists rows in the order their
--      balances were counted.

-- ── 1. the running balance ────────────────────────────────────────────────
-- 0298's body; only the window's ORDER BY changes.

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
    CASE acc.balance_mode
      WHEN 'running'  THEN rb.balance_after - rb.signed_amount
      WHEN 'anchored' THEN an.balance_after - an.signed_amount
    END AS balance_before,
    CASE acc.balance_mode
      WHEN 'running'  THEN rb.balance_after
      WHEN 'anchored' THEN an.balance_after
    END AS balance_after,
    COALESCE(t.category_override, ty.category, 'overhead'::ops_acct.category_t) AS category,
    t.category_override,
    p.name AS project_name,
    t.transfer_id
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
              PARTITION BY r.account_id ORDER BY r.trx_date, r.signed_amount < 0::numeric, r.trx_no
              ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS balance_after
           FROM ( SELECT x.id, x.account_id, x.trx_date, x.trx_no,
                    CASE WHEN x.direction = 'IN'::ops_acct.direction_t THEN x.amount_idr ELSE - x.amount_idr END AS signed_amount
                   FROM ops_acct.transactions x
                  WHERE x.status <> 'VOID'::ops_acct.trx_status_t) r
             JOIN ops_acct.accounts ra ON ra.id = r.account_id) rb
       ON rb.id = t.id AND t.trx_date >= ops_acct.ledger_balance_from()
     LEFT JOIN LATERAL (
       SELECT CASE WHEN t.direction = 'IN'::ops_acct.direction_t THEN t.amount_idr ELSE - t.amount_idr END AS signed_amount,
              st.balance + COALESCE((
                SELECT sum(CASE WHEN x.direction = 'IN'::ops_acct.direction_t THEN x.amount_idr ELSE - x.amount_idr END)
                  FROM ops_acct.transactions x
                 WHERE x.account_id = t.account_id AND x.status <> 'VOID'::ops_acct.trx_status_t
                   AND ops_acct.row_after_state(x.trx_date, x.trx_no, st.as_of, st.after_trx_no)
                   AND NOT ops_acct.row_after_state(x.trx_date, x.trx_no, t.trx_date, t.trx_no)), 0::numeric) AS balance_after
         FROM ops_acct.state_before_row(t.account_id, t.trx_date, t.trx_no) st
        WHERE st.id IS NOT NULL) an
       ON acc.balance_mode = 'anchored' AND t.status <> 'VOID'::ops_acct.trx_status_t
  WHERE ops_acct.account_rows_readable(acc.custody);
alter view ops_acct.v_transaction set (security_invoker = on);
grant select on ops_acct.v_transaction to authenticated;

-- ── 2. a fund's window ────────────────────────────────────────────────────
-- 0274's body; only the window bounds change.

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
         coalesce(s.spent, 0)     as spent_total,
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
             and x.trx_date >= f.trx_date
             and (f.next_funding_no is null or x.trx_date < f.window_end)
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
alter view ops_acct.v_funding set (security_invoker = on);
grant select on ops_acct.v_funding to authenticated;

-- ── 3. the GL OPS sheet ───────────────────────────────────────────────────
-- 0298's body; the balance window, the account's balance mode and the order.

create or replace function ops_acct.ledger_sheet_rows()
returns jsonb language plpgsql security definer
set search_path = ops_acct, ops_core, pg_temp as $$
declare
  v    ops_acct.ledger_sheet_settings;
  v_rows jsonb;
begin
  if not ops_core.has_authority('post_ledger') then
    return ops_core.refused('accounting', 'ledger_sheet', null, 'rows', 'forbidden',
      'Memperbarui sheet ledger butuh wewenang post_ledger.');
  end if;
  select * into v from ops_acct.ledger_sheet_settings where id;
  if not found then
    return ops_core.refused('accounting', 'ledger_sheet', null, 'rows', 'not_configured',
      'Sheet ledger belum disiapkan: IT mengisi ops_acct.ledger_sheet_settings.');
  end if;

  with live as (
    select x.id, x.account_id, x.trx_date, x.trx_no,
           case when x.direction = 'IN' then x.amount_idr else -x.amount_idr end as signed
      from ops_acct.transactions x
     where x.status <> 'VOID'
  ),
  -- The same running balance as `v_transaction` (0301), without its RLS filter.
  rb as (
    select l.id, l.signed,
           a.opening_balance + sum(l.signed) over (
             partition by l.account_id order by l.trx_date, l.signed < 0, l.trx_no
             rows between unbounded preceding and current row) as balance_after
      from live l join ops_acct.accounts a on a.id = l.account_id
  ),
  docs as (
    select k.entity_no as trx_no, k.attachment_id,
           k.kind::text as kind,
           coalesce(a.web_view_link, a.url,
                    'https://drive.google.com/file/d/' || coalesce(a.drive_file_id, a.storage_path) || '/view') as href,
           k.linked_at
      from ops_core.attachment_links k
      join ops_core.attachments a on a.id = k.attachment_id
     where k.entity = 'transaction' and k.unlinked_at is null
  ),
  trx as (
    select t.id, t.trx_no, t.trx_date, t.description, t.remark, t.type_code, t.direction::text as direction,
           t.amount_idr, t.status::text as status, acc.code as account_code, acc.currency, acc.balance_mode::text as balance_mode,
           p.code as project_code, vd.name as vendor_name, pu.full_name as posted_by_name,
           coalesce(t.category_override, ty.category, 'overhead')::text as category,
           case acc.balance_mode
             when 'running'  then case when t.trx_date >= ops_acct.ledger_balance_from() then rb.balance_after end
             when 'anchored' then an.balance_after
           end as balance_after,
           case acc.balance_mode
             when 'running'  then case when t.trx_date >= ops_acct.ledger_balance_from() then rb.balance_after - rb.signed end
             when 'anchored' then an.balance_after - rb.signed
           end as balance_before,
           (select coalesce(jsonb_agg(jsonb_build_object('kind', d.kind, 'href', d.href, 'att', d.attachment_id)
                                      order by d.linked_at), '[]')
              from docs d where d.trx_no = t.trx_no) as docs,
           (select coalesce(array_agg(distinct a.pr_line_no) filter (where a.pr_line_no is not null), '{}')
              from ops_acct.payment_allocations a where a.trx_id = t.id and a.superseded_by is null) as pr_line_nos,
           (select coalesce(array_agg(distinct a.po_no) filter (where a.po_no is not null), '{}')
              from ops_acct.payment_allocations a where a.trx_id = t.id and a.superseded_by is null) as po_nos
      from ops_acct.transactions t
      join ops_acct.accounts acc on acc.id = t.account_id
      left join ops_acct.transaction_types ty on ty.code = t.type_code
      left join ops_procure.projects p on p.id = t.project_id
      left join ops_procure.vendors vd on vd.id = t.vendor_id
      left join ops_core.users pu on pu.id = t.posted_by
      left join rb on rb.id = t.id
      -- An anchored account: the reading before the row + the rows between.
      left join lateral (
        select st.balance + coalesce((
                 select sum(case when x.direction = 'IN' then x.amount_idr else -x.amount_idr end)
                   from ops_acct.transactions x
                  where x.account_id = t.account_id and x.status <> 'VOID'
                    and ops_acct.row_after_state(x.trx_date, x.trx_no, st.as_of, st.after_trx_no)
                    and not ops_acct.row_after_state(x.trx_date, x.trx_no, t.trx_date, t.trx_no)), 0) as balance_after
          from ops_acct.state_before_row(t.account_id, t.trx_date, t.trx_no) st
         where st.id is not null
      ) an on acc.balance_mode = 'anchored'
     where t.status <> 'VOID'
       and t.trx_date >= make_date(v.year, 1, 1)
       and t.trx_date <  make_date(v.year + 1, 1, 1)
  ),
  sheet_rows as (
    select t.*, ln.line_pos, ln.line_count, ln.line_desc, ln.line_kind, ln.line_amount, ln.line_att, ln.cum
      from trx t
      left join lateral (
        select row_number() over (order by l.line_no) as line_pos, count(*) over () as line_count, l.description as line_desc, l.kind as line_kind,
               l.amount as line_amount, l.attachment_id as line_att,
               sum(l.amount) over (order by l.line_no rows between unbounded preceding and current row) as cum
          from ops_acct.transaction_lines l where l.trx_id = t.id
      ) ln on true
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'trx_no',      r.trx_no,
           'line',        case when r.line_count > 1 then chr(96 + least(r.line_pos, 26)::int) end,
           'trx_date',    r.trx_date,
           -- What the money was for, as the ledger says it; a split transaction's
           -- line adds its own item after it (the item alone, e.g. "Pertalite",
           -- does not say who or what it was for).
           'description', case when r.line_count > 1 and r.line_desc is not null
                                 and r.line_desc is distinct from r.description
                               then r.description || ' — ' || r.line_desc
                               else r.description end,
           'trx_description', r.description,
           'remark',      r.remark,
           'type',        case when r.line_kind = 'fee' then 'BANK CHARGES' else r.type_code end,
           'project',     r.project_code,
           'account',     r.account_code,
           'currency',    r.currency,
           'direction',   r.direction,
           'amount',      coalesce(r.line_amount, r.amount_idr),
           -- The account's balance after this row: the line's share of the
           -- transaction, and the transaction's own balance on its last line.
           'balance',     case
                            when r.balance_after is null then null
                            when r.line_pos is null or r.line_pos = r.line_count then r.balance_after
                            else r.balance_before
                                 + case when r.direction = 'IN' then r.cum else -r.cum end
                          end,
           'vendor',      r.vendor_name,
           'docs',        case when r.line_att is null then r.docs
                               else (select coalesce(jsonb_agg(e), '[]') from jsonb_array_elements(r.docs) e
                                      where e->>'att' is distinct from r.line_att::text
                                        and not exists (select 1 from jsonb_array_elements(r.docs) f
                                                         where f->>'att' = r.line_att::text and f->>'kind' = e->>'kind'))
                                    || coalesce((select jsonb_agg(f) from jsonb_array_elements(r.docs) f
                                                  where f->>'att' = r.line_att::text), '[]')
                          end,
           'pr_line_nos', to_jsonb(r.pr_line_nos),
           'po_nos',      to_jsonb(r.po_nos),
           'status',      r.status,
           'category',    r.category,
           'posted_by',   r.posted_by_name
         ) order by r.trx_date, (r.balance_mode = 'running' and r.direction = 'OUT'), r.trx_no, r.line_pos), '[]')
    into v_rows
    from sheet_rows r;

  return ops_core.ok('accounting', 'ledger_sheet', v.tab, 'rows', jsonb_build_object(
    'spreadsheet_id', v.spreadsheet_id,
    'tab',            v.tab,
    'year',           v.year,
    'enabled',        v.enabled,
    'balance_from',   ops_acct.ledger_balance_from(),
    'rows',           v_rows));
end $$;

revoke execute on function ops_acct.ledger_sheet_rows() from public;

revoke execute on function ops_acct.ledger_sheet_rows() from public;
grant  execute on function ops_acct.ledger_sheet_rows() to authenticated;
