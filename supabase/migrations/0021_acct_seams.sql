-- 0021_acct_seams.sql — the two money seams, and the five roads out of the
-- inbox.
--
-- ADR-006: **money has one write seam per concept.** Posting a transaction,
-- allocating a payment. Not two roads, one guarded — because the second road
-- is always the one somebody adds in a hurry, and it is always the one missing
-- the check.
--
-- Every function here needs `post_ledger`, and that is not `accounting.create`
-- (D24). The person who files documents all day is not necessarily the person
-- who may assert that money moved.

-- ── posting ───────────────────────────────────────────────────────────────
-- **No document, no row** (D85). The old system let a number be typed and the
-- paperwork follow "later", and later is where the unexplained rows live.
--
-- A purchase needs more than an amount: what was bought, how many, at what
-- price, from whom (D86). An amount on its own cannot be checked against a
-- delivery, a quote, or next month — which makes the catalogue's "what did we
-- last pay for this" unanswerable, and that question is half the reason the
-- catalogue exists.
create or replace function ops_acct.post_transaction(
  p_account_code text,
  p_direction ops_acct.direction_t,
  p_amount numeric,
  p_type_code text,
  p_description text,
  p_documents jsonb,                   -- [{"attachment_id":…,"kind":"nota"}]
  p_trx_date date default null,
  p_vendor_code text default null,
  p_project_code text default null,
  p_lines jsonb default '[]'::jsonb,   -- [{"description":…,"qty":…,"unit_price":…,"amount":…}]
  p_remark text default null,
  p_source_ref text default null,
  p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_acct, ops_core, ops_procure, pg_temp as $$
declare
  acc ops_acct.accounts; ty ops_acct.transaction_types;
  ven uuid; proj uuid; v_trx_no text; v_trx_id uuid;
  has_primary boolean; n_lines int; lines_total numeric; missing text;
  src text; existing text; replayed jsonb; res jsonb;
begin
  replayed := ops_core.idem_replay('accounting','post_transaction', p_key);
  if replayed is not null then return replayed; end if;

  if not ops_core.has_authority('post_ledger') then
    return ops_core.refused('accounting','transaction', p_source_ref,'post',
      'authority_required',
      'Posting to the ledger belongs to Accounting — logged, not applied.',
      jsonb_build_object('required','post_ledger','attempted_amount', p_amount));
  end if;

  if p_amount is null or p_amount <= 0 then
    return ops_core.invalid('accounting','transaction', p_source_ref,'post',
      'amount_positive',
      'Amount must be greater than zero. Direction lives in the IN/OUT column.',
      jsonb_build_object('field','amount_idr'));
  end if;
  if coalesce(btrim(p_description), '') = '' then
    return ops_core.invalid('accounting','transaction', p_source_ref,'post',
      'description_required','Description is required.',
      jsonb_build_object('field','description'));
  end if;

  select * into acc from ops_acct.accounts where code = p_account_code;
  if not found then
    return ops_core.invalid('accounting','transaction', p_source_ref,'post',
      'no_such_account', format('There is no account %s.', p_account_code),
      jsonb_build_object('field','account_code'));
  end if;
  select * into ty from ops_acct.transaction_types where code = p_type_code;
  if not found then
    return ops_core.invalid('accounting','transaction', p_source_ref,'post',
      'no_such_type', format('There is no transaction type %s.', p_type_code),
      jsonb_build_object('field','type_code'));
  end if;

  -- The evidence rule. Supporting documents — a delivery note, the PO — are
  -- welcome and cannot stand alone: none of them says *this money moved for
  -- this reason*. A row with no primary document is a number somebody typed.
  select bool_or((d ->> 'kind') in ('nota','transfer_proof','goods_photo','rekening_koran'))
    into has_primary
    from jsonb_array_elements(coalesce(p_documents, '[]'::jsonb)) d;
  if not coalesce(has_primary, false) then
    return ops_core.invalid('accounting','transaction', p_source_ref,'post',
      'evidence_required',
      'A ledger row needs at least one nota, transfer proof, bank statement or photo of what arrived. Supporting documents are welcome, but they cannot stand alone.',
      jsonb_build_object('field','documents'));
  end if;

  select count(*), sum((l ->> 'amount')::numeric)
    into n_lines, lines_total
    from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) l;

  if ty.is_purchase then
    if coalesce(n_lines, 0) = 0 then
      return ops_core.invalid('accounting','transaction', p_source_ref,'post',
        'detail_required',
        format('%s is a purchase: it needs what was bought, how many and at what price. An amount on its own cannot be checked against a delivery, a quote or next month.', p_type_code),
        jsonb_build_object('field','lines'));
    end if;
    select l ->> 'description' into missing
      from jsonb_array_elements(p_lines) l
     where nullif(l ->> 'qty','') is null or nullif(l ->> 'unit_price','') is null
     limit 1;
    if missing is not null then
      return ops_core.invalid('accounting','transaction', p_source_ref,'post',
        'line_detail_required',
        format('"%s" has no quantity or no unit price. Both are what make a price comparable to the next one.', missing),
        jsonb_build_object('field','lines'));
    end if;
    if p_vendor_code is null then
      return ops_core.invalid('accounting','transaction', p_source_ref,'post',
        'vendor_required',
        'A purchase has somebody it was bought from. Without it the question "where do we buy this" has no answer.',
        jsonb_build_object('field','vendor_code'));
    end if;
  end if;

  -- The detail and the total are two statements about the same event, and
  -- **the ledger will not guess which one is wrong.**
  if coalesce(n_lines, 0) > 0 and lines_total <> p_amount then
    return ops_core.invalid('accounting','transaction', p_source_ref,'post',
      'lines_do_not_add_up',
      format('The detail adds up to %s but the transaction is %s. One of the two is wrong, and the ledger will not guess which.',
             lines_total, p_amount),
      jsonb_build_object('field','lines','lines_total', lines_total,'amount', p_amount));
  end if;

  if p_vendor_code is not null then
    select id into ven from ops_procure.vendors where code = p_vendor_code;
    if not found then
      return ops_core.invalid('accounting','transaction', p_source_ref,'post',
        'no_such_vendor', format('There is no vendor %s.', p_vendor_code),
        jsonb_build_object('field','vendor_code'));
    end if;
  end if;
  if p_project_code is not null then
    select id into proj from ops_procure.projects where code = p_project_code;
    if not found then
      return ops_core.invalid('accounting','transaction', p_source_ref,'post',
        'no_such_project', format('There is no project %s.', p_project_code),
        jsonb_build_object('field','project_code'));
    end if;
  end if;

  -- The idempotency claim on the row itself (A4), separate from the seam's
  -- key: a repeat with the same `source_ref` is the same event arriving twice
  -- — from a re-run import, a retried webhook — and must be a no-op whether or
  -- not the caller remembered to pass a key.
  src := coalesce(nullif(btrim(p_source_ref), ''), ops_core.new_token('src'));
  select t.trx_no into existing from ops_acct.transactions t where t.source_ref = src;
  if existing is not null then
    return ops_core.conflict('accounting','transaction', existing,'post',
      'already_posted', format('Already booked as %s — nothing changed.', existing),
      jsonb_build_object('trx_no', existing));
  end if;

  v_trx_no := ops_core.next_doc_number('trx');

  insert into ops_acct.transactions
    (trx_no, trx_date, account_id, direction, amount_idr, type_code,
     vendor_id, project_id, description, remark, status, source_ref, posted_by)
  values (v_trx_no, coalesce(p_trx_date, ops_core.office_day()), acc.id, p_direction,
          p_amount, p_type_code, ven, proj, btrim(p_description),
          nullif(btrim(p_remark), ''), 'POSTED', src, auth.uid())
  returning id into v_trx_id;

  if coalesce(n_lines, 0) > 0 then
    insert into ops_acct.transaction_lines
      (trx_id, line_no, item_id, description, qty, uom, unit_price, amount)
    select v_trx_id, ord,
           nullif(l ->> 'item_id','')::uuid,
           l ->> 'description',
           nullif(l ->> 'qty','')::numeric,
           nullif(l ->> 'uom',''),
           nullif(l ->> 'unit_price','')::numeric,
           (l ->> 'amount')::numeric
      from jsonb_array_elements(p_lines) with ordinality as t(l, ord);
  end if;

  insert into ops_core.attachment_links (attachment_id, entity, entity_no, kind, linked_by)
  select (d ->> 'attachment_id')::uuid, 'transaction', v_trx_no,
         (d ->> 'kind')::ops_core.doc_kind_t, auth.uid()
    from jsonb_array_elements(p_documents) d;

  perform ops_core.emit('accounting','accounting.transaction.posted', v_trx_no,
    jsonb_build_object('trx_no', v_trx_no, 'amount', p_amount,
                       'direction', p_direction, 'account', p_account_code));

  res := ops_core.ok('accounting','transaction', v_trx_no,'post',
    jsonb_build_object('trx_no', v_trx_no, 'amount', p_amount,
                       'direction', p_direction, 'status','POSTED'));
  return ops_core.idem_remember('accounting','post_transaction', p_key, res);
end $$;

-- **VOID keeps the row and the amount, with a reason beside it** (A5, D84).
-- The correction is a new row; this one stays, saying what was once believed.
-- Deleting it would leave every document that pointed at it pointing at
-- nothing, and every balance it was part of unexplainable.
create or replace function ops_acct.void_transaction(
  p_trx_no text, p_reason text, p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_acct, ops_core, pg_temp as $$
declare t ops_acct.transactions; replayed jsonb; res jsonb;
begin
  replayed := ops_core.idem_replay('accounting','void:' || p_trx_no, p_key);
  if replayed is not null then return replayed; end if;

  if not ops_core.has_authority('post_ledger') then
    return ops_core.refused('accounting','transaction', p_trx_no,'void',
      'authority_required','Voiding a ledger row belongs to Accounting.');
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    return ops_core.invalid('accounting','transaction', p_trx_no,'void',
      'reason_required','A reason is required to void.',
      jsonb_build_object('field','reason'));
  end if;

  select * into t from ops_acct.transactions where trx_no = p_trx_no;
  if not found then
    return ops_core.not_found('accounting','transaction', p_trx_no,'void','No such transaction.');
  end if;
  if t.status = 'VOID' then
    return ops_core.conflict('accounting','transaction', p_trx_no,'void',
      'already_void', format('%s is already VOID — nothing changed.', p_trx_no));
  end if;

  update ops_acct.transactions
     set status = 'VOID', void_reason = btrim(p_reason),
         void_at = now(), void_by = auth.uid()
   where id = t.id;

  perform ops_core.emit('accounting','accounting.transaction.voided', p_trx_no,
    jsonb_build_object('trx_no', p_trx_no, 'amount', t.amount_idr,
                       'reason', btrim(p_reason)));

  -- Amount-before and amount-after in the trail (D84). The allocations are
  -- left standing on purpose: `v_line_funding` already ignores them because
  -- the transaction is VOID, so the coverage falls away by itself and the
  -- record of what somebody once applied where is not rewritten.
  res := ops_core.ok('accounting','transaction', p_trx_no,'void',
    jsonb_build_object('trx_no', p_trx_no, 'status','VOID'),
    jsonb_build_object('status', t.status, 'amount_idr', t.amount_idr),
    jsonb_build_object('status','VOID', 'amount_idr', t.amount_idr,
                       'reason', btrim(p_reason)));
  return ops_core.idem_remember('accounting','void:' || p_trx_no, p_key, res);
end $$;

-- ── allocating ────────────────────────────────────────────────────────────
-- The second money seam. What a payment was *for*.
--
-- **A transaction never funds more than it moved** (A9), and the target is by
-- public code, validated here — never a foreign key across the service seam
-- (ADR-004). A payment may settle an order rather than a request line (D106):
-- the deposit on a PO answers to no PR.
create or replace function ops_acct.allocate_payment(
  p_trx_no text,
  p_amount numeric,
  p_pr_line_no text default null,
  p_po_no text default null,
  p_method ops_acct.alloc_method_t default 'transfer',
  p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_acct, ops_core, ops_procure, pg_temp as $$
declare
  t ops_acct.transactions; l ops_procure.pr_lines; already numeric;
  target text; replayed jsonb; res jsonb;
begin
  target := coalesce(p_pr_line_no, p_po_no);
  replayed := ops_core.idem_replay('accounting','allocate:' || coalesce(target, '?'), p_key);
  if replayed is not null then return replayed; end if;

  if not ops_core.has_authority('post_ledger') then
    return ops_core.refused('accounting','allocation', target,'allocate',
      'authority_required','Applying money to a decision belongs to Accounting.');
  end if;

  if (p_pr_line_no is null) = (p_po_no is null) then
    return ops_core.invalid('accounting','allocation', target,'allocate',
      'target_required',
      'An allocation points at a request line or at an order, and at exactly one.',
      jsonb_build_object('field','pr_line_no'));
  end if;
  if p_amount is null or p_amount <= 0 then
    return ops_core.invalid('accounting','allocation', target,'allocate',
      'amount_positive','Allocation amount must be greater than zero.',
      jsonb_build_object('field','amount'));
  end if;

  select * into t from ops_acct.transactions where trx_no = p_trx_no;
  if not found then
    return ops_core.not_found('accounting','allocation', target,'allocate',
      format('Transaction %s not found.', p_trx_no));
  end if;
  if t.status = 'VOID' then
    return ops_core.conflict('accounting','allocation', target,'allocate',
      'transaction_void', format('%s is VOID and cannot fund anything.', p_trx_no));
  end if;

  if p_pr_line_no is not null then
    select * into l from ops_procure.pr_lines where line_no_full = p_pr_line_no;
    if not found then
      return ops_core.invalid('accounting','allocation', target,'allocate',
        'pr_line_not_found',
        format('Line %s does not exist in procurement.', p_pr_line_no),
        jsonb_build_object('field','pr_line_no'));
    end if;
    if l.removed_at is not null then
      return ops_core.conflict('accounting','allocation', target,'allocate',
        'line_removed', format('Line %s has been removed.', p_pr_line_no));
    end if;
  elsif not exists (select 1 from ops_procure.purchase_orders where po_no = p_po_no) then
    return ops_core.invalid('accounting','allocation', target,'allocate',
      'po_not_found', format('Order %s does not exist in procurement.', p_po_no),
      jsonb_build_object('field','po_no'));
  end if;

  select coalesce(allocated_total, 0) into already
    from ops_acct.v_allocated where trx_id = t.id;

  if coalesce(already, 0) + p_amount > t.amount_idr then
    return ops_core.invalid('accounting','allocation', target,'allocate',
      'over_allocated',
      format('This transaction only moved %s; %s is already allocated. A transaction never funds more than it moved.',
             t.amount_idr, coalesce(already, 0)),
      jsonb_build_object('field','amount','moved', t.amount_idr,
                         'already', coalesce(already, 0), 'attempted', p_amount));
  end if;

  insert into ops_acct.payment_allocations
    (trx_id, pr_line_no, po_no, amount, method, allocated_by)
  values (t.id, p_pr_line_no, p_po_no, p_amount, p_method, auth.uid());

  perform ops_core.emit('accounting','accounting.allocation.recorded', target,
    jsonb_build_object('trx_no', p_trx_no, 'pr_line_no', p_pr_line_no,
                       'po_no', p_po_no, 'amount', p_amount));

  res := ops_core.ok('accounting','allocation', target,'allocate',
    jsonb_build_object('trx_no', p_trx_no, 'pr_line_no', p_pr_line_no,
                       'po_no', p_po_no, 'amount', p_amount,
                       'unallocated', t.amount_idr - coalesce(already, 0) - p_amount));
  return ops_core.idem_remember('accounting','allocate:' || coalesce(target, '?'), p_key, res);
end $$;

-- A correction supersedes; it never deletes (A2). The old row stays, so "who
-- applied this money where, and who changed their mind" is still readable.
create or replace function ops_acct.supersede_allocation(
  p_allocation_id uuid, p_new_amount numeric default null)
returns jsonb
language plpgsql security definer set search_path = ops_acct, ops_core, pg_temp as $$
declare a ops_acct.payment_allocations; t ops_acct.transactions; new_id uuid;
begin
  if not ops_core.has_authority('post_ledger') then
    return ops_core.refused('accounting','allocation', p_allocation_id::text,'supersede',
      'authority_required','Correcting an allocation belongs to Accounting.');
  end if;

  select * into a from ops_acct.payment_allocations where id = p_allocation_id;
  if not found then
    return ops_core.not_found('accounting','allocation', p_allocation_id::text,'supersede',
      'No such allocation.');
  end if;
  if a.superseded_by is not null then
    return ops_core.conflict('accounting','allocation', p_allocation_id::text,'supersede',
      'already_superseded','That allocation has already been corrected.');
  end if;

  select * into t from ops_acct.transactions where id = a.trx_id;

  if p_new_amount is null then
    -- Withdrawn entirely. It points at itself: the row is retired without a
    -- replacement, and `superseded_by is null` — the live-row predicate every
    -- coverage view uses — stops being true for it.
    update ops_acct.payment_allocations set superseded_by = a.id where id = a.id;
    return ops_core.ok('accounting','allocation', coalesce(a.pr_line_no, a.po_no),'supersede',
      jsonb_build_object('withdrawn', a.amount),
      to_jsonb(a.amount), 'null'::jsonb);
  end if;

  if p_new_amount <= 0 then
    return ops_core.invalid('accounting','allocation', p_allocation_id::text,'supersede',
      'amount_positive','A corrected amount is more than nothing. To withdraw it, pass no amount.');
  end if;

  insert into ops_acct.payment_allocations
    (trx_id, pr_line_no, po_no, amount, method, allocated_by)
  values (a.trx_id, a.pr_line_no, a.po_no, p_new_amount, a.method, auth.uid())
  returning id into new_id;

  update ops_acct.payment_allocations set superseded_by = new_id where id = a.id;

  return ops_core.ok('accounting','allocation', coalesce(a.pr_line_no, a.po_no),'supersede',
    jsonb_build_object('allocation_id', new_id, 'amount', p_new_amount),
    to_jsonb(a.amount), to_jsonb(p_new_amount));
end $$;

-- ── the exception road out ────────────────────────────────────────────────
-- Five roads, **none of which delete** (F26, D94). A document that reached the
-- inbox and left it without a trace is the failure this whole road exists to
-- prevent: somebody sent it, and "we never got it" must never be the answer.
--
--   confirmed  it produced a ledger row
--   attached   it belonged to a row that already existed
--   rejected   accounting says it is not ours — with a reason
--   cancelled  whoever sent it withdrew it
--   noted      real, filed, and touching no ledger (owner, 2026-08-27)
create or replace function ops_acct.resolve_inbox(
  p_ref_id text,
  p_status ops_acct.inbox_status_t,
  p_trx_no text default null,
  p_note text default null,
  p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_acct, ops_core, pg_temp as $$
declare row ops_acct.evidence_inbox; replayed jsonb; res jsonb;
begin
  replayed := ops_core.idem_replay('accounting','resolve_inbox:' || p_ref_id, p_key);
  if replayed is not null then return replayed; end if;

  if not ops_core.has_authority('resolve_inbox') then
    return ops_core.refused('accounting','inbox', p_ref_id,'resolve',
      'authority_required',
      'Deciding what a loose document belongs to belongs to Accounting.',
      jsonb_build_object('required','resolve_inbox'));
  end if;
  if p_status = 'PENDING' then
    return ops_core.invalid('accounting','inbox', p_ref_id,'resolve',
      'not_a_road','PENDING is where it starts, not somewhere to send it.');
  end if;

  select * into row from ops_acct.evidence_inbox where ref_id = p_ref_id;
  if not found then
    return ops_core.not_found('accounting','inbox', p_ref_id,'resolve','No such inbox row.');
  end if;
  if row.status <> 'PENDING' then
    return ops_core.conflict('accounting','inbox', p_ref_id,'resolve',
      'already_resolved', format('This row is already %s — nothing changed.', row.status));
  end if;

  if p_status in ('CONFIRMED','ATTACHED') then
    if coalesce(btrim(p_trx_no), '') = '' then
      return ops_core.invalid('accounting','inbox', p_ref_id,'resolve',
        'trx_required','Which ledger row does this belong to?',
        jsonb_build_object('field','trx_no'));
    end if;
    if not exists (select 1 from ops_acct.transactions where trx_no = p_trx_no) then
      return ops_core.invalid('accounting','inbox', p_ref_id,'resolve',
        'no_such_transaction', format('There is no ledger row %s.', p_trx_no),
        jsonb_build_object('field','trx_no'));
    end if;
    -- The whole point of resolving: the document stops being loose and becomes
    -- evidence on a record.
    insert into ops_core.attachment_links (attachment_id, entity, entity_no, kind, linked_by)
    values (row.attachment_id, 'transaction', p_trx_no,
            coalesce((row.extracted ->> 'doc_kind')::ops_core.doc_kind_t, 'nota'), auth.uid())
    on conflict do nothing;
  end if;

  -- Rejecting says this is not ours. Saying so without a reason leaves whoever
  -- sent it with nothing to act on, which is how a document comes back three
  -- times.
  if p_status = 'REJECTED' and coalesce(btrim(p_note), '') = '' then
    return ops_core.invalid('accounting','inbox', p_ref_id,'resolve',
      'reason_required','Say why it is not ours, so whoever sent it knows what to do.',
      jsonb_build_object('field','note'));
  end if;

  update ops_acct.evidence_inbox
     set status = p_status, produced_trx_no = p_trx_no,
         resolved_by = auth.uid(), resolved_at = now(),
         resolve_note = nullif(btrim(p_note), '')
   where id = row.id;

  perform ops_core.emit('accounting','accounting.inbox.resolved', p_ref_id,
    jsonb_build_object('ref_id', p_ref_id, 'status', p_status, 'trx_no', p_trx_no));

  res := ops_core.ok('accounting','inbox', p_ref_id,'resolve',
    jsonb_build_object('ref_id', p_ref_id, 'status', p_status, 'trx_no', p_trx_no),
    to_jsonb(row.status), to_jsonb(p_status));
  return ops_core.idem_remember('accounting','resolve_inbox:' || p_ref_id, p_key, res);
end $$;

grant execute on function
  ops_acct.post_transaction(text, ops_acct.direction_t, numeric, text, text, jsonb, date,
                        text, text, jsonb, text, text, text),
  ops_acct.void_transaction(text, text, text),
  ops_acct.allocate_payment(text, numeric, text, text, ops_acct.alloc_method_t, text),
  ops_acct.supersede_allocation(uuid, numeric),
  ops_acct.resolve_inbox(text, ops_acct.inbox_status_t, text, text, text)
  to authenticated;
