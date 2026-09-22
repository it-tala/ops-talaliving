-- 0098_acct_confirm_incoming.sql — the second road out of the inbox that
-- `src/lib/api/accounting.ts` never had a seam for.
--
-- `resolveInbox` (`0039`) closes an OUT-direction row: somebody bought first,
-- and the document is matched to a request already in the system. A transfer
-- proof dropped in chat by leadership is the other direction (D81) — nothing
-- to match it to, because the money coming IN is the whole event. Booking it
-- is the same shape as `post_transaction` (`0021`) — one ledger row, one
-- proof attached — plus the inbox row's own bookkeeping, so it is its own
-- seam rather than a second caller squeezed through `post_transaction`'s
-- purchase-shaped validation (a vendor, lines that add up) none of which
-- applies to money arriving.
--
-- `confirm_incoming`, to match `src/demo/api/accounting.ts`'s `confirmIncoming`
-- function-for-function: same refusals (`already_resolved` before
-- `already_posted` — the inbox row is the first thing checked, because it is
-- the more specific answer), same `source_ref` shape (`inbox-in:<ref_id>`),
-- same fallback description order (typed, then the AI's own reading, then a
-- plain sentence).
create or replace function ops_acct.confirm_incoming(
  p_ref_id       text,
  p_account_code text,
  p_trx_date     date,
  p_amount       numeric,
  p_description  text default null,
  p_key          text default null)
returns jsonb
language plpgsql security definer set search_path = ops_acct, ops_core, pg_temp as $$
declare
  row        ops_acct.evidence_inbox;
  acc        ops_acct.accounts;
  v_trx_no   text;
  v_desc     text;
  v_filename text;
  src        text;
  replayed   jsonb;
  res        jsonb;
begin
  replayed := ops_core.idem_replay('accounting', 'confirm_incoming:' || p_ref_id, p_key);
  if replayed is not null then return replayed; end if;

  if not ops_core.has_authority('post_ledger') then
    return ops_core.refused('accounting', 'inbox', p_ref_id, 'confirm_incoming',
      'authority_required', 'Posting to the ledger belongs to Accounting — logged, not applied.',
      jsonb_build_object('required', 'post_ledger'));
  end if;

  select * into row from ops_acct.evidence_inbox where ref_id = p_ref_id;
  if not found then
    return ops_core.not_found('accounting', 'inbox', p_ref_id, 'confirm_incoming',
      format('Row %s not found.', p_ref_id));
  end if;
  if row.status <> 'PENDING' then
    return ops_core.conflict('accounting', 'inbox', p_ref_id, 'confirm_incoming',
      'already_resolved', format('This row is already %s — nothing changed.', row.status));
  end if;
  if p_amount is null or p_amount <= 0 then
    return ops_core.invalid('accounting', 'inbox', p_ref_id, 'confirm_incoming',
      'amount_positive', 'Amount must be greater than zero.', jsonb_build_object('field', 'amount_idr'));
  end if;

  select * into acc from ops_acct.accounts where code = p_account_code;
  if not found then
    return ops_core.invalid('accounting', 'inbox', p_ref_id, 'confirm_incoming',
      'no_such_account', format('There is no account %s.', p_account_code),
      jsonb_build_object('field', 'account_code'));
  end if;

  -- Belt and braces beside `decided_is_signed`: the row's own status already
  -- guards this in the ordinary run, but the source_ref is the ledger's own
  -- idempotency claim (A4) and stays the true guard against a second row.
  src := 'inbox-in:' || p_ref_id;
  select trx_no into v_trx_no from ops_acct.transactions where source_ref = src;
  if v_trx_no is not null then
    return ops_core.conflict('accounting', 'inbox', p_ref_id, 'confirm_incoming',
      'already_posted', format('Already booked as %s — nothing changed.', v_trx_no),
      jsonb_build_object('trx_no', v_trx_no));
  end if;

  v_desc := coalesce(nullif(btrim(p_description), ''), nullif(btrim(row.extracted ->> 'note'), ''),
                      'Money in, confirmed from chat');
  v_trx_no := ops_core.next_doc_number('trx');

  insert into ops_acct.transactions
    (trx_no, trx_date, account_id, direction, amount_idr, type_code,
     description, status, source_ref, posted_by)
  values (v_trx_no, p_trx_date, acc.id, 'IN', p_amount, 'CASHFLOW',
          v_desc, 'POSTED', src, auth.uid());

  -- The proof follows the money onto the ledger row, so the transaction can
  -- be read on its own without going back to the inbox.
  insert into ops_core.attachment_links (attachment_id, entity, entity_no, kind, linked_by)
  values (row.attachment_id, 'transaction', v_trx_no, 'transfer_proof', auth.uid());

  update ops_acct.evidence_inbox
     set status = 'CONFIRMED', produced_trx_no = v_trx_no,
         resolved_by = auth.uid(), resolved_at = now()
   where ref_id = p_ref_id;

  perform ops_core.emit('accounting', 'accounting.transaction.posted', v_trx_no,
    jsonb_build_object('trx_no', v_trx_no, 'amount', p_amount, 'direction', 'IN'));

  select filename into v_filename from ops_core.attachments where id = row.attachment_id;

  res := ops_core.ok('accounting', 'inbox', p_ref_id, 'confirm_incoming',
    jsonb_build_object(
      'trx_no', v_trx_no, 'trx_date', p_trx_date, 'account_code', p_account_code,
      'amount_idr', p_amount, 'description', v_desc,
      'proof_attachment_id', row.attachment_id, 'proof_filename', v_filename));
  return ops_core.idem_remember('accounting', 'confirm_incoming:' || p_ref_id, p_key, res);
end $$;

grant execute on function
  ops_acct.confirm_incoming(text, text, date, numeric, text, text)
  to authenticated;
