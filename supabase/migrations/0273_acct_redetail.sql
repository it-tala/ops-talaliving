-- 0273_acct_redetail.sql — re-detailing a row that was booked as one lump
-- (L12, D434, D435 point 6, D436, D437).
--
-- The owner's rule (D434): every row in the ledger is reviewed once and
-- split to its smallest honest parts — the thing, the admin fee, the tax,
-- the courier, the voucher — with the letters a/b as line numbers (D436),
-- for the whole of 2026, newest first (D435 point 6). Two pieces:
--
--   1. **`set_transaction_lines(p_trx_no, p_lines, p_reason)`** replaces the
--      whole detail of one row: kinds, items, quantities, prices, amounts.
--      The same rules as posting (`0271`): kinds sent or guessed, amounts
--      positive, a discount counted minus, Σ lines = the row's amount — the
--      amount itself never changes here (that is `edit_transaction`), nor
--      the date, account, vendor or documents. `post_ledger`; refused on a
--      VOID row and on a row matched to a bank statement line. The old
--      detail goes into the audit trail's `before`, the new into `after`,
--      and `lines_reviewed_at/by` is stamped. **`p_lines` null** stamps the
--      row reviewed without touching it — *sudah benar*, one click.
--   2. **`v_redetail_queue`**: the rows still to look at — money out, not
--      void, with a document, dated 2026, not yet reviewed, and looking
--      lumped: one line or none, an amount ending in …2.500 / …5.000 /
--      …6.500 (a transfer fee folded in), or a purchase type. The screen
--      orders it newest first; a row leaves the queue when it is stamped.
--
-- `v_transaction_line` is the ledger table's own read: every line with its
-- row's number, so the a/b rows can sit under their parent (D437) without a
-- detail call per row. `v_transaction_detail` gains the review stamp at the
-- end — the only change `create or replace view` allows.

-- ── 1. the stamp ───────────────────────────────────────────────────────────

alter table ops_acct.transactions
  add column if not exists lines_reviewed_at timestamptz,
  add column if not exists lines_reviewed_by uuid references ops_core.users(id);
comment on column ops_acct.transactions.lines_reviewed_at is
  'When somebody last confirmed or rewrote this row''s detail through set_transaction_lines (0273, D434). '
  'Null = still in the re-detailing queue if the row qualifies.';

-- ── 2. the seam ────────────────────────────────────────────────────────────

create or replace function ops_acct.set_transaction_lines(
  p_trx_no text,
  p_lines jsonb default null,     -- null: confirm the detail as it is
  p_reason text default null,
  p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_acct, ops_core, ops_procure, pg_temp as $$
declare
  t ops_acct.transactions; ty ops_acct.transaction_types;
  n_lines int; n_items int; lines_total numeric; any_negative boolean; missing text;
  v_before jsonb; v_after jsonb; v_reason text; replayed jsonb; res jsonb;
begin
  replayed := ops_core.idem_replay('accounting','set_lines:' || p_trx_no, p_key);
  if replayed is not null then return replayed; end if;

  if not ops_core.has_authority('post_ledger') then
    return ops_core.refused('accounting','transaction', p_trx_no,'set_lines',
      'authority_required','Rewriting a ledger row''s detail belongs to whoever may post one.');
  end if;

  select * into t from ops_acct.transactions where trx_no = p_trx_no;
  if not found then
    return ops_core.not_found('accounting','transaction', p_trx_no,'set_lines','No such transaction.');
  end if;
  if t.status = 'VOID' then
    return ops_core.conflict('accounting','transaction', p_trx_no,'set_lines',
      'transaction_void', format('%s is VOID — a void row is not re-detailed.', p_trx_no));
  end if;
  if exists (select 1 from ops_acct.statement_lines
              where trx_no = p_trx_no and status in ('matched','booked')) then
    return ops_core.conflict('accounting','transaction', p_trx_no,'set_lines',
      'statement_matched',
      'This row is matched to a bank statement line. Unmatch it first, then re-detail it.');
  end if;
  select * into ty from ops_acct.transaction_types where code = t.type_code;

  select coalesce(jsonb_agg(jsonb_build_object(
           'line_no', l.line_no, 'kind', l.kind, 'item_id', l.item_id,
           'description', l.description, 'qty', l.qty, 'uom', l.uom,
           'unit_price', l.unit_price, 'amount', l.amount) order by l.line_no), '[]'::jsonb)
    into v_before
    from ops_acct.transaction_lines l where l.trx_id = t.id;
  v_reason := nullif(btrim(p_reason), '');

  /* ── sudah benar: the stamp alone ─────────────────────────────────────── */
  if p_lines is null then
    update ops_acct.transactions
       set lines_reviewed_at = now(), lines_reviewed_by = auth.uid()
     where id = t.id;
    res := ops_core.say('accounting','transaction', p_trx_no,'set_lines','ok', 200,
      null, coalesce(v_reason, 'confirmed as is'),
      jsonb_build_object('trx_no', p_trx_no, 'lines', jsonb_array_length(v_before), 'changed', false),
      jsonb_build_object('confirmed', true), v_before, v_before);
    return ops_core.idem_remember('accounting','set_lines:' || p_trx_no, p_key, res);
  end if;

  /* ── the new detail, read the way post_transaction reads it (0271) ──── */
  select count(*),
         coalesce(sum(case when x.kind = 'discount' then -x.amount else x.amount end), 0),
         count(*) filter (where x.kind = 'item'),
         coalesce(bool_or(x.amount < 0), false),
         string_agg(x.raw_kind, ', ') filter (where x.kind is null)
    into n_lines, lines_total, n_items, any_negative, missing
    from (select l ->> 'kind' as raw_kind,
                 ops_acct.line_kind_of(l ->> 'kind', l ->> 'description') as kind,
                 coalesce((l ->> 'amount')::numeric, 0) as amount
            from jsonb_array_elements(p_lines) l) x;

  if coalesce(n_lines, 0) = 0 then
    return ops_core.invalid('accounting','transaction', p_trx_no,'set_lines',
      'detail_required','Re-detailing a row means at least one line. To confirm it as it is, send no lines.',
      jsonb_build_object('field','lines'));
  end if;
  if missing is not null then
    return ops_core.invalid('accounting','transaction', p_trx_no,'set_lines',
      'unknown_line_kind',
      format('"%s" is not a kind of line. A line is item, fee, tax, shipping, discount or other.', missing),
      jsonb_build_object('field','lines','given', missing));
  end if;
  if any_negative then
    return ops_core.invalid('accounting','transaction', p_trx_no,'set_lines',
      'line_amount_negative',
      'A line''s amount is always positive. A voucher or a refund netted in is a discount line — the kind carries the sign.',
      jsonb_build_object('field','lines'));
  end if;
  if exists (select 1 from jsonb_array_elements(p_lines) l
              where coalesce(btrim(l ->> 'description'), '') = '') then
    return ops_core.invalid('accounting','transaction', p_trx_no,'set_lines',
      'line_description_required','Every line says what it is.',
      jsonb_build_object('field','lines'));
  end if;
  if coalesce(ty.is_purchase, false) then
    select l ->> 'description' into missing
      from jsonb_array_elements(p_lines) l
     where ops_acct.line_kind_of(l ->> 'kind', l ->> 'description') = 'item'
       and (nullif(l ->> 'qty','') is null or nullif(l ->> 'unit_price','') is null)
     limit 1;
    if missing is not null then
      return ops_core.invalid('accounting','transaction', p_trx_no,'set_lines',
        'line_detail_required',
        format('"%s" has no quantity or no unit price. Both are what make a price comparable to the next one.', missing),
        jsonb_build_object('field','lines'));
    end if;
  end if;
  -- The money does not move here. The lines are the explanation of a figure
  -- that is already the bank's, so they add up to it or they are wrong.
  if lines_total <> t.amount_idr then
    return ops_core.invalid('accounting','transaction', p_trx_no,'set_lines',
      'lines_do_not_add_up',
      format('The detail adds up to %s but the transaction is %s. The amount is corrected with Edit, not here.',
             lines_total, t.amount_idr),
      jsonb_build_object('field','lines','lines_total', lines_total,'amount', t.amount_idr));
  end if;
  if exists (select 1 from jsonb_array_elements(p_lines) l
              where nullif(l ->> 'item_id','') is not null
                and not exists (select 1 from ops_procure.items i where i.id = (l ->> 'item_id')::uuid)) then
    return ops_core.invalid('accounting','transaction', p_trx_no,'set_lines',
      'no_such_item','A line names a catalogue item that does not exist.',
      jsonb_build_object('field','lines'));
  end if;

  /* ── replace. The old detail is in the trail; nothing about the row's
     money, date, account, vendor or documents is touched. ─────────────── */
  delete from ops_acct.transaction_lines where trx_id = t.id;
  insert into ops_acct.transaction_lines
    (trx_id, line_no, kind, item_id, description, qty, uom, unit_price, amount)
  select t.id, ord,
         ops_acct.line_kind_of(l ->> 'kind', l ->> 'description'),
         nullif(l ->> 'item_id','')::uuid,
         btrim(l ->> 'description'),
         nullif(l ->> 'qty','')::numeric,
         nullif(l ->> 'uom',''),
         nullif(l ->> 'unit_price','')::numeric,
         (l ->> 'amount')::numeric
    from jsonb_array_elements(p_lines) with ordinality as x(l, ord);

  update ops_acct.transactions
     set lines_reviewed_at = now(), lines_reviewed_by = auth.uid()
   where id = t.id;

  select jsonb_agg(jsonb_build_object(
           'line_no', l.line_no, 'kind', l.kind, 'item_id', l.item_id,
           'description', l.description, 'qty', l.qty, 'uom', l.uom,
           'unit_price', l.unit_price, 'amount', l.amount) order by l.line_no)
    into v_after
    from ops_acct.transaction_lines l where l.trx_id = t.id;

  perform ops_core.emit('accounting','accounting.transaction.redetailed', p_trx_no,
    jsonb_build_object('trx_no', p_trx_no, 'lines', n_lines, 'item_lines', n_items, 'reason', v_reason));

  res := ops_core.say('accounting','transaction', p_trx_no,'set_lines','ok', 200,
    null, v_reason,
    jsonb_build_object('trx_no', p_trx_no, 'lines', n_lines, 'changed', true),
    jsonb_build_object('lines_before', jsonb_array_length(v_before), 'lines_after', n_lines),
    v_before, v_after);
  return ops_core.idem_remember('accounting','set_lines:' || p_trx_no, p_key, res);
end $$;

revoke execute on function ops_acct.set_transaction_lines(text, jsonb, text, text) from public;
grant  execute on function ops_acct.set_transaction_lines(text, jsonb, text, text) to authenticated;
comment on function ops_acct.set_transaction_lines(text, jsonb, text, text) is
  'Replaces a ledger row''s whole detail (kinds, items, qty, prices, amounts; Σ = the row''s amount, '
  'which never changes here) and stamps lines_reviewed_at/by; p_lines null stamps the row as '
  'confirmed without touching it. Old and new detail in the audit trail. Refused on VOID and on a '
  'statement-matched row. (0273, L12)';

-- ── 3. every line with its row's number, for the ledger table ──────────────

create or replace view ops_acct.v_transaction_line as
  select l.id, l.trx_id, t.trx_no, l.line_no, l.kind, l.item_id,
         i.code as item_code, i.name as item_name,
         l.description, l.qty, l.uom, l.unit_price, l.amount
    from ops_acct.transaction_lines l
    join ops_acct.transactions t on t.id = l.trx_id
    join ops_acct.accounts acc on acc.id = t.account_id
    left join ops_procure.items i on i.id = l.item_id
   where ops_acct.account_rows_readable(acc.custody);
alter view ops_acct.v_transaction_line set (security_invoker = on);
grant select on ops_acct.v_transaction_line to authenticated;
comment on view ops_acct.v_transaction_line is
  'Every ledger line with its row''s trx_no and its catalogue item, under the same row visibility as '
  'v_transaction — the a/b rows under their parent in the ledger table (0273, D437).';

-- ── 4. the queue ───────────────────────────────────────────────────────────

create or replace view ops_acct.v_redetail_queue as
  select v.id, v.trx_no, v.trx_date, v.account_code, v.type_code, v.vendor_name,
         v.description, v.amount_idr, v.evidence_count,
         coalesce(ln.n, 0)::int as line_count,
         coalesce(ln.n, 0) <= 1 as single_line,
         (v.amount_idr % 10000) in (2500, 5000, 6500) as fee_tail,
         coalesce(ty.is_purchase, false) as is_purchase,
         (v.type_code = 'ONLINE'
          or coalesce(v.vendor_name, '') ~* 'shopee|tokopedia|lazada|blibli|tiktok shop'
          or v.description ~* '\mshopee\M|\mtokopedia\M|\mlazada\M|\mblibli\M') as is_ecommerce
    from ops_acct.v_transaction v
    join ops_acct.transactions t on t.id = v.id
    left join ops_acct.transaction_types ty on ty.code = v.type_code
    left join lateral (select count(*) as n from ops_acct.transaction_lines l where l.trx_id = v.id) ln on true
   where v.direction = 'OUT'
     and v.status <> 'VOID'
     and v.trx_date >= date '2026-01-01'
     and t.lines_reviewed_at is null
     and v.evidence_count > 0
     and (coalesce(ln.n, 0) <= 1
          or (v.amount_idr % 10000) in (2500, 5000, 6500)
          or coalesce(ty.is_purchase, false));
alter view ops_acct.v_redetail_queue set (security_invoker = on);
grant select on ops_acct.v_redetail_queue to authenticated;
comment on view ops_acct.v_redetail_queue is
  'Rows still to re-detail (D434, D435 point 6): money out, not void, with a document, dated 2026, '
  'not yet stamped by set_transaction_lines, and looking lumped — one line or none, an amount ending '
  'in a transfer fee, or a purchase type. Newest first is the screen''s order. (0273)';

-- ── 5. the detail view carries the stamp ───────────────────────────────────

create or replace view ops_acct.v_transaction_detail as
  select v.*,
         coalesce(li.lines, '[]'::jsonb)       as lines,
         coalesce(ac.allocations, '[]'::jsonb) as allocations,
         coalesce(dc.documents, '[]'::jsonb)   as documents,
         t.billed_currency,
         t.billed_amount,
         t.lines_reviewed_at,
         rb.full_name as lines_reviewed_by_name
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

alter view ops_acct.v_transaction_detail set (security_invoker = on);
grant select on ops_acct.v_transaction_detail to authenticated;

analyze ops_acct.transactions;
