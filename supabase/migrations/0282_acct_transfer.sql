-- 0282 — one input, two legs: moving money between our own accounts (L15).
--
-- Owner 2026-10-15: *ketika transfer internal antar 2 rekening bank, cukup
-- dimasukan sumber dana dari mana, misal BCA 271 ke Jenius, maka otomatis
-- tercatat 2 transaksi IN dan OUT.* Until now a transfer was two rows typed
-- separately (D79), and the book shows what that costs: in 2026 BNI 325 has
-- 179 cash-withdrawal OUTs against 66 matching INs on Petty Cash, and
-- nothing links the halves that do exist.
--
-- `post_transfer` writes the OUT on the source, the IN on the destination
-- and, when there is one, the bank's fee as its own BANK CHARGES row on the
-- source — all with one `transfer_id`, the same proof on every row, in one
-- act or not at all. Each row is still an ordinary ledger row posted through
-- `post_transaction`, so every rule about money, evidence and accounts holds
-- unchanged, and each bank statement still reconciles leg by leg.
--
-- Leadership accounts (owner: *catat apa adanya*): a transfer that touches
-- one still gets both legs, because both ends are known — the leg on the
-- leadership account is written by the seam and read only by `approve_funds`
-- (D87, D391), the same as any row there. Nothing else on those accounts is
-- expected to be complete. BCA USD 081 is one account whose balance is in
-- dollars: a transfer out of it carries the dollar amount as the billed
-- currency (0271), so the rate is computed, never typed. Jenius Cards has
-- its own balance and is its own account; a top-up is an ordinary transfer.
-- Old rows stay as they are.

alter table ops_acct.transactions
  add column if not exists transfer_id uuid;
comment on column ops_acct.transactions.transfer_id is
  'Set on every row post_transfer wrote in one act — the OUT, the IN and the fee (0282, L15). '
  'Null on every row posted any other way, old transfers included.';
create index if not exists trx_transfer_idx on ops_acct.transactions (transfer_id)
  where transfer_id is not null;

create or replace function ops_acct.post_transfer(
  p_from_account_code text,
  p_to_account_code   text,
  p_amount            numeric,
  p_documents         jsonb,
  p_trx_date          date    default null,
  p_description       text    default null,
  p_fee               numeric default null,
  p_billed_currency   text    default null,
  p_billed_amount     numeric default null,
  p_key               text    default null)
returns jsonb
language plpgsql security definer set search_path = ops_acct, ops_core, pg_temp as $$
declare
  acc_from ops_acct.accounts; acc_to ops_acct.accounts;
  v_id uuid := gen_random_uuid(); v_desc text; v_day date;
  r_out jsonb; r_in jsonb; r_fee jsonb; replayed jsonb; res jsonb;
begin
  replayed := ops_core.idem_replay('accounting','post_transfer', p_key);
  if replayed is not null then return replayed; end if;

  if not ops_core.has_authority('post_ledger') then
    return ops_core.refused('accounting','transfer', null,'post_transfer',
      'authority_required','Posting to the ledger belongs to Accounting — logged, not applied.',
      jsonb_build_object('required','post_ledger','attempted_amount', p_amount));
  end if;
  if p_amount is null or p_amount <= 0 then
    return ops_core.invalid('accounting','transfer', null,'post_transfer',
      'amount_positive','Amount must be greater than zero.', jsonb_build_object('field','amount_idr'));
  end if;
  if p_fee is not null and p_fee < 0 then
    return ops_core.invalid('accounting','transfer', null,'post_transfer',
      'fee_negative','A transfer fee is zero or more.', jsonb_build_object('field','fee'));
  end if;
  select * into acc_from from ops_acct.accounts where code = p_from_account_code;
  if not found then
    return ops_core.invalid('accounting','transfer', null,'post_transfer',
      'no_such_account', format('There is no account %s.', p_from_account_code),
      jsonb_build_object('field','from_account_code'));
  end if;
  select * into acc_to from ops_acct.accounts where code = p_to_account_code;
  if not found then
    return ops_core.invalid('accounting','transfer', null,'post_transfer',
      'no_such_account', format('There is no account %s.', p_to_account_code),
      jsonb_build_object('field','to_account_code'));
  end if;
  if acc_from.id = acc_to.id then
    return ops_core.invalid('accounting','transfer', null,'post_transfer',
      'same_account','A transfer moves money between two different accounts.',
      jsonb_build_object('field','to_account_code'));
  end if;

  v_day  := coalesce(p_trx_date, ops_core.office_day());
  v_desc := coalesce(nullif(btrim(p_description), ''),
                     format('Transfer %s → %s', acc_from.code, acc_to.code));

  -- The three rows, each through the one write seam. The first refusal is
  -- relayed whole and nothing is written; a refusal after the first row is
  -- raised so the whole act rolls back — a transfer with one leg is exactly
  -- the row this function exists to stop.
  r_out := ops_acct.post_transaction(
    p_account_code => acc_from.code, p_direction => 'OUT', p_amount => p_amount,
    p_type_code => 'CASHFLOW', p_description => v_desc, p_documents => p_documents,
    p_trx_date => v_day, p_source_ref => format('transfer:%s:out', v_id),
    p_billed_currency => p_billed_currency, p_billed_amount => p_billed_amount);
  if not ops_core.said_ok(r_out) then
    return r_out;
  end if;
  r_in := ops_acct.post_transaction(
    p_account_code => acc_to.code, p_direction => 'IN', p_amount => p_amount,
    p_type_code => 'CASHFLOW', p_description => v_desc, p_documents => p_documents,
    p_trx_date => v_day, p_source_ref => format('transfer:%s:in', v_id));
  if not ops_core.said_ok(r_in) then
    raise exception 'post_transfer: the receiving leg was refused — %', r_in -> 'error' ->> 'message'
      using errcode = 'P0001';
  end if;
  if coalesce(p_fee, 0) > 0 then
    r_fee := ops_acct.post_transaction(
      p_account_code => acc_from.code, p_direction => 'OUT', p_amount => p_fee,
      p_type_code => 'BANK CHARGES',
      p_description => format('Biaya transfer %s → %s', acc_from.code, acc_to.code),
      p_documents => p_documents, p_trx_date => v_day,
      p_source_ref => format('transfer:%s:fee', v_id));
    if not ops_core.said_ok(r_fee) then
      raise exception 'post_transfer: the fee row was refused — %', r_fee -> 'error' ->> 'message'
        using errcode = 'P0001';
    end if;
  end if;

  update ops_acct.transactions set transfer_id = v_id
   where source_ref in (format('transfer:%s:out', v_id), format('transfer:%s:in', v_id), format('transfer:%s:fee', v_id));

  res := ops_core.ok('accounting','transfer', v_id::text,'post_transfer',
    jsonb_build_object('transfer_id', v_id,
                       'from_account', acc_from.code, 'to_account', acc_to.code,
                       'amount', p_amount, 'fee', coalesce(p_fee, 0), 'trx_date', v_day,
                       'out_trx_no', r_out -> 'data' ->> 'trx_no',
                       'in_trx_no',  r_in  -> 'data' ->> 'trx_no',
                       'fee_trx_no', r_fee -> 'data' ->> 'trx_no'));
  return ops_core.idem_remember('accounting','post_transfer', p_key, res);
end $$;
revoke execute on function ops_acct.post_transfer(text, text, numeric, jsonb, date, text, numeric, text, numeric, text) from public;
grant  execute on function ops_acct.post_transfer(text, text, numeric, jsonb, date, text, numeric, text, numeric, text) to authenticated;
comment on function ops_acct.post_transfer(text, text, numeric, jsonb, date, text, numeric, text, numeric, text) is
  'Money between two of our own accounts in one act (0282, L15): OUT on the source, IN on the destination, '
  'the fee as its own BANK CHARGES row, one transfer_id, the same proof on each. post_ledger; post_transaction''s '
  'rules on every row. 422 same_account, no_such_account, amount_positive, fee_negative, evidence_required.';

-- ── the views carry it ───────────────────────────────────────────────────
-- 0280's bodies; `transfer_id` on the row, and on the detail the other legs.
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
         v.project_name,
         v.transfer_id,
         coalesce(tl.transfer_legs, '[]'::jsonb) as transfer_legs
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
    ) dc on true
    -- The other legs of the same transfer (0282): read through
    -- `v_transaction`, so a leg on a leadership account stays hidden from a
    -- reader who may not see that account's rows (D391).
    left join lateral (
      select jsonb_agg(jsonb_build_object(
               'trx_no', o.trx_no, 'account_code', o.account_code, 'direction', o.direction,
               'amount_idr', o.amount_idr, 'type_code', o.type_code, 'status', o.status)
             order by o.amount_idr desc, o.trx_no) as transfer_legs
        from ops_acct.v_transaction o
       where v.transfer_id is not null and o.transfer_id = v.transfer_id and o.id <> v.id
    ) tl on true;
alter view ops_acct.v_transaction_detail set (security_invoker = on);
grant select on ops_acct.v_transaction_detail to authenticated;

analyze ops_acct.transactions;
