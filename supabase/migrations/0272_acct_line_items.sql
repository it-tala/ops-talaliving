-- 0272_acct_line_items.sql — the item travels with the payment (L5, D86).
--
-- `transaction_lines.item_id` has existed since 0013 and no live path ever
-- wrote it (kajian 14 Oct, §3, §6.3): `post_from_line` read the request line
-- and dropped its item; `post_to_po` wrote one generic line however many
-- itemised lines the order had; the two forms had no picker. So since the
-- import stopped, the catalogue learned no price from money that actually
-- left — `item_purchases`, `v_purchase_facts` and *terakhir dibayar* were
-- read from nothing. Three places, one direction:
--
--   1. **`post_from_line`** carries `pr_lines.item_id` onto the ledger line,
--      as `kind = 'item'`. Nothing else about it changes.
--   2. **`post_to_po`** writes one ledger line per live order line — item,
--      qty, unit, price — when the payment is the whole contract on an order
--      nothing has been paid on yet. Rounding or a discount against the
--      contract becomes its own `other` or `discount` line, so the lines
--      still add up to what left the bank. A term payment (less than the
--      contract, or a later instalment) stays one generic line, now
--      `kind = 'other'`: a deposit is money, not goods (A1), and splitting
--      it across items would invent prices nobody paid.
--   3. The forms (Verifikasi, Entri baru) get an item picker per `item`
--      line and send `item_id` through `post_transaction`, which already
--      stores it (0034). A line without an item stays allowed — *tidak di
--      katalog* — and the type's `creates_catalog_item` finally does
--      something: the picker offers *tambahkan ke katalog*.
--
-- `v_transaction_detail.lines[]` carries `item_code` and `item_name` so the
-- drawer can say which catalogue entry a line bought without a second call.
-- Same columns, same order: the jsonb grows, the view does not.
--
-- Function signatures are unchanged, so `create or replace` is enough: no
-- old overload to drop (00_no_overloads), nothing for the Supabase tool to
-- hold (F-0211).

-- ── 1. post_from_line: the request line's item ─────────────────────────────

create or replace function ops_acct.post_from_line(p_line_no text, p_amount numeric, p_account_code text, p_type_code text, p_attachment_id uuid, p_trx_date date DEFAULT NULL::date, p_document_kind text DEFAULT 'Payment Proof'::text, p_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'ops_acct', 'ops_core', 'ops_procure', 'pg_temp'
AS $$
declare
  l record; v_ven text; v_proj text; v_src text;
  posted jsonb; allocated jsonb; v_trx_no text;
  replayed jsonb; res jsonb;
begin
  replayed := ops_core.idem_replay('accounting','post_from_line:' || p_line_no, p_key);
  if replayed is not null then return replayed; end if;

  if not ops_core.has_authority('post_ledger') then
    return ops_core.refused('accounting','transaction', p_line_no,'post_from_line',
      'authority_required',
      'Posting to the ledger belongs to Accounting — logged, not applied.',
      jsonb_build_object('required','post_ledger','attempted_amount', p_amount));
  end if;

  -- The project hangs off the document; the supplier is the line's own or
  -- the order's (B11, D297); the item is the line's (0272).
  select pl.id, pl.line_no_full, pl.description, pl.qty, pl.uom, pl.unit_price,
         pl.removed_at, pl.item_id,
         coalesce(v.code, (select ov.code from ops_procure.purchase_orders op
                             join ops_procure.vendors ov on ov.id = op.vendor_id
                            where op.po_no = ops_procure.order_of_line(pl.line_no_full))) as vendor_code,
         pj.code as project_code
    into l
    from ops_procure.pr_lines pl
    join ops_procure.pr_documents d on d.id = pl.doc_id
    left join ops_procure.vendors  v  on v.id  = pl.vendor_id
    left join ops_procure.projects pj on pj.id = d.project_id
   where pl.line_no_full = p_line_no;

  if not found then
    return ops_core.invalid('accounting','transaction', p_line_no,'post_from_line',
      'pr_line_not_found', format('Line %s does not exist in procurement.', p_line_no),
      jsonb_build_object('field','line_no'));
  end if;
  if l.removed_at is not null then
    return ops_core.conflict('accounting','transaction', p_line_no,'post_from_line',
      'line_removed', format('Line %s has been removed.', p_line_no));
  end if;

  if p_attachment_id is null then
    return ops_core.invalid('accounting','transaction', p_line_no,'post_from_line',
      'evidence_required',
      'A payment needs its proof. Attach the transfer receipt or the nota before recording it.',
      jsonb_build_object('field','attachment_id'));
  end if;

  v_src := format('pr-line:%s:%s:%s', p_line_no,
                  coalesce(p_trx_date, ops_core.office_day()), p_amount);

  posted := ops_acct.post_transaction(
    p_account_code => p_account_code,
    p_direction    => 'OUT',
    p_amount       => p_amount,
    p_type_code    => p_type_code,
    p_description  => format('%s — %s', l.description, p_line_no),
    p_documents    => jsonb_build_array(jsonb_build_object(
                        'attachment_id', p_attachment_id,
                        'kind', coalesce(nullif(btrim(p_document_kind), ''), 'Payment Proof'))),
    p_trx_date     => p_trx_date,
    p_vendor_code  => l.vendor_code,
    p_project_code => l.project_code,
    -- What was bought, how many, at what price — and **which catalogue
    -- entry** (0272), so the catalogue learns the price that was really
    -- paid (D86). A lump-sum line is 1 lot at the amount paid (D298, B9).
    p_lines        => jsonb_build_array(jsonb_build_object(
                        'kind',        'item',
                        'item_id',     l.item_id,
                        'description', l.description,
                        'qty',         coalesce(l.qty, 1),
                        'uom',         case when l.qty is null then 'lot' else l.uom end,
                        'unit_price',  case when l.qty is null then p_amount else l.unit_price end,
                        'amount',      p_amount)),
    p_source_ref   => v_src,
    p_key          => null);

  if posted ->> 'outcome' <> 'ok' then
    return posted;
  end if;
  v_trx_no := posted -> 'data' ->> 'trx_no';

  allocated := ops_acct.allocate_payment(
    p_trx_no      => v_trx_no,
    p_amount      => p_amount,
    p_pr_line_no  => p_line_no,
    p_method      => 'transfer',
    p_key         => null);

  if allocated ->> 'outcome' <> 'ok' then
    return ops_core.conflict('accounting','transaction', v_trx_no,'post_from_line',
      'allocation_failed',
      format('%s was posted, but could not be counted against %s: %s',
             v_trx_no, p_line_no, allocated -> 'error' ->> 'message'),
      jsonb_build_object('trx_no', v_trx_no, 'pr_line_no', p_line_no,
                         'from', allocated -> 'error'));
  end if;

  res := ops_core.ok('accounting','transaction', v_trx_no,'post_from_line',
    jsonb_build_object('trx_no', v_trx_no, 'pr_line_no', p_line_no,
                       'amount', p_amount, 'account', p_account_code,
                       'type', p_type_code,
                       'document', coalesce(nullif(btrim(p_document_kind), ''), 'Payment Proof')));
  return ops_core.idem_remember('accounting','post_from_line:' || p_line_no, p_key, res);
end $$;

comment on function ops_acct.post_from_line(text, numeric, text, text, uuid, date, text, text) is
  'Paying an approved request line in one act: post_transaction + allocate_payment + the proof. '
  'Since 0272 the ledger line carries the request line''s item_id, kind item. (0034, 0141, 0145, 0272)';

-- ── 2. post_to_po: the order's lines when the whole contract is paid ────────

create or replace function ops_acct.post_to_po(
  p_po_no         text,
  p_amount        numeric,
  p_account_code  text,
  p_type_code     text,
  p_attachment_id uuid,
  p_trx_date      date default null,
  p_document_kind text default 'Payment Proof',
  p_key           text default null)
returns jsonb language plpgsql security definer
set search_path = ops_acct, ops_core, ops_procure, pg_temp as $$
declare
  po record; posted jsonb; v_trx_no text; v_trx_id uuid; v_src text;
  x record; share numeric; spent numeric := 0; shares jsonb := '[]'::jsonb;
  v_lines jsonb; v_lines_total numeric; v_full boolean;
  replayed jsonb; res jsonb;
begin
  replayed := ops_core.idem_replay('accounting','post_to_po:' || coalesce(p_po_no,'?'), p_key);
  if replayed is not null then return replayed; end if;

  if not ops_core.has_authority('post_ledger') then
    return ops_core.refused('accounting','transaction', p_po_no,'post_to_po',
      'authority_required',
      'Posting to the ledger belongs to Accounting — logged, not applied.',
      jsonb_build_object('required','post_ledger','attempted_amount', p_amount));
  end if;

  select p.id, p.po_no, p.status, v.code as vendor_code, s.contract_value, s.outstanding, s.paid_to_date
    into po
    from ops_procure.purchase_orders p
    join ops_procure.vendors v on v.id = p.vendor_id
    join ops_procure.v_po_status s on s.po_id = p.id
   where p.po_no = p_po_no;
  if not found then
    return ops_core.invalid('accounting','transaction', p_po_no,'post_to_po',
      'po_not_found', format('Order %s does not exist.', p_po_no), jsonb_build_object('field','po_no'));
  end if;
  if po.status = 'DRAFT' then
    return ops_core.conflict('accounting','transaction', p_po_no,'post_to_po',
      'not_issued', format('%s has not been issued — nothing is owed on an order the vendor has not received.', p_po_no));
  end if;
  if po.status in ('CLOSED','CANCELLED') then
    return ops_core.conflict('accounting','transaction', p_po_no,'post_to_po',
      'order_closed', format('%s is %s.', p_po_no, lower(po.status::text)));
  end if;
  if p_amount is null or p_amount <= 0 then
    return ops_core.invalid('accounting','transaction', p_po_no,'post_to_po',
      'amount_positive','A payment is more than nothing.', jsonb_build_object('field','amount'));
  end if;
  if p_amount > po.outstanding + ops_core.money_tolerance() then
    return ops_core.invalid('accounting','transaction', p_po_no,'post_to_po',
      'over_contract',
      format('Only %s is still outstanding on %s. Money beyond the contract is a question for the vendor, not a payment on this order.',
             po.outstanding, p_po_no),
      jsonb_build_object('field','amount','outstanding', po.outstanding));
  end if;
  if p_attachment_id is null then
    return ops_core.invalid('accounting','transaction', p_po_no,'post_to_po',
      'evidence_required',
      'A payment needs its proof. Attach the transfer receipt before recording it.',
      jsonb_build_object('field','attachment_id'));
  end if;

  v_src := format('po:%s:%s:%s', p_po_no, coalesce(p_trx_date, ops_core.office_day()), p_amount);

  /* ── the lines (0272) ──────────────────────────────────────────────────
   *
   * The whole contract, on an order nothing has been paid on: one ledger
   * line per live order line, with its item, so each price paid is a price
   * the catalogue can learn. The difference between the lines and the money
   * — rounding, a discount the vendor gave at payment — is its own line,
   * so Σ lines = amount still holds. Anything else is a term payment: one
   * generic `other` line, because a deposit is money, not goods (A1). */
  v_full := coalesce(po.paid_to_date, 0) <= 0
            and abs(p_amount - po.contract_value) <= ops_core.money_tolerance()
            and po.contract_value > 0;
  if v_full then
    select jsonb_agg(jsonb_build_object(
             'kind', 'item', 'item_id', o.item_id,
             'description', o.description, 'qty', o.qty, 'uom', o.uom,
             'unit_price', o.unit_price, 'amount', o.line_total)
           order by o.line_no),
           sum(o.line_total)
      into v_lines, v_lines_total
      from ops_procure.po_lines o
     where o.po_id = po.id and o.superseded_by is null;
    if p_amount > v_lines_total then
      v_lines := v_lines || jsonb_build_object('kind','other',
        'description', format('Selisih pembayaran %s', p_po_no), 'amount', p_amount - v_lines_total);
    elsif p_amount < v_lines_total then
      v_lines := v_lines || jsonb_build_object('kind','discount',
        'description', format('Potongan atas %s', p_po_no), 'amount', v_lines_total - p_amount);
    end if;
  else
    v_lines := jsonb_build_array(jsonb_build_object(
                 'kind', 'other',
                 'description', format('Pembayaran %s', p_po_no),
                 'qty', 1, 'uom', 'unit', 'unit_price', p_amount, 'amount', p_amount));
  end if;

  posted := ops_acct.post_transaction(
    p_account_code => p_account_code,
    p_direction    => 'OUT',
    p_amount       => p_amount,
    p_type_code    => p_type_code,
    p_description  => format('Pembayaran %s', p_po_no),
    p_documents    => jsonb_build_array(jsonb_build_object(
                        'attachment_id', p_attachment_id,
                        'kind', coalesce(nullif(btrim(p_document_kind), ''), 'Payment Proof'))),
    p_trx_date     => p_trx_date,
    p_vendor_code  => po.vendor_code,
    p_project_code => null,
    p_lines        => v_lines,
    p_source_ref   => v_src,
    p_key          => null);
  if posted ->> 'outcome' <> 'ok' then
    return posted;
  end if;
  v_trx_no := posted -> 'data' ->> 'trx_no';
  select id into v_trx_id from ops_acct.transactions where trx_no = v_trx_no;

  -- The split: each linked line takes its share of the contract (0139).
  if po.contract_value > 0 then
    for x in
      select l.line_no_full, o.line_total
        from ops_procure.po_lines o
        join ops_procure.pr_lines l on l.id = o.pr_line_id
       where o.po_id = po.id and o.superseded_by is null
       order by o.line_no
    loop
      share := least(round(p_amount * x.line_total / po.contract_value), p_amount - spent);
      if share > 0 then
        insert into ops_acct.payment_allocations (trx_id, pr_line_no, po_no, amount, method, allocated_by)
        values (v_trx_id, x.line_no_full, p_po_no, share, 'transfer', auth.uid());
        spent := spent + share;
        shares := shares || jsonb_build_object('pr_line_no', x.line_no_full, 'amount', share);
      end if;
    end loop;
  end if;
  if p_amount - spent > 0 then
    insert into ops_acct.payment_allocations (trx_id, pr_line_no, po_no, amount, method, allocated_by)
    values (v_trx_id, null, p_po_no, p_amount - spent, 'transfer', auth.uid());
  end if;

  perform ops_core.emit('accounting','accounting.allocation.recorded', p_po_no,
    jsonb_build_object('trx_no', v_trx_no, 'po_no', p_po_no, 'amount', p_amount, 'lines', shares,
                       'itemised', v_full));

  res := ops_core.ok('accounting','transaction', v_trx_no,'post_to_po',
    jsonb_build_object('trx_no', v_trx_no, 'po_no', p_po_no, 'amount', p_amount,
                       'account', p_account_code, 'type', p_type_code, 'lines', shares,
                       'itemised', v_full));
  return ops_core.idem_remember('accounting','post_to_po:' || p_po_no, p_key, res);
end $$;

comment on function ops_acct.post_to_po is
  'Paying an issued order: post_transaction + one allocation per linked request line, by share of '
  'the contract. Since 0272 a payment of the whole contract on an unpaid order writes one ledger line '
  'per order line (item, qty, price) with a rounding/discount line when needed; a term payment stays '
  'one `other` line. (0139, 0272)';

-- ── 3. the detail view names the item on each line ─────────────────────────

create or replace view ops_acct.v_transaction_detail as
  select v.*,
         coalesce(li.lines, '[]'::jsonb)       as lines,
         coalesce(ac.allocations, '[]'::jsonb) as allocations,
         coalesce(dc.documents, '[]'::jsonb)   as documents,
         t.billed_currency,
         t.billed_amount
    from ops_acct.v_transaction v
    join ops_acct.transactions t on t.id = v.id
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

alter view ops_acct.v_transaction_detail set (security_invoker = on);
grant select on ops_acct.v_transaction_detail to authenticated;
comment on view ops_acct.v_transaction_detail is
  'One ledger row with its lines (kind since 0271; item_code/item_name since 0272), allocations, '
  'documents, and the bill in another currency when there was one.';

analyze ops_acct.transaction_lines;
