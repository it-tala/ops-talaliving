-- 0103_acct_complete_needs_document.sql — COMPLETED means a document is on it.
--
-- The owner's reading of the status (2026-09-23): a COMPLETED row is one whose
-- paperwork is done. Until now `complete_transaction` (`0093`) checked only
-- `post_ledger` and *not already complete*, so a row could be marked complete
-- with nothing attached — 846 of the 847 COMPLETED rows today arrived that way
-- from the old system, and only 30 of them carry a nota or a transfer proof.
--
-- The rule, as given: **at least one** live link of kind `nota`
-- (Receipt / Invoice / Nota) or `transfer_proof` (Payment Proof) on the row.
-- Anything else — an invoice, a photo, a receiving report — is welcome but
-- does not by itself make a row complete.
--
-- Rows already COMPLETED are left as they are: this is a rule for the button,
-- not a rewrite of history.
create or replace function ops_acct.complete_transaction(
  p_trx_no text, p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_acct, ops_core, pg_temp as $$
declare t ops_acct.transactions; replayed jsonb; res jsonb;
begin
  replayed := ops_core.idem_replay('accounting','complete:' || p_trx_no, p_key);
  if replayed is not null then return replayed; end if;

  if not ops_core.has_authority('post_ledger') then
    return ops_core.refused('accounting','transaction', p_trx_no,'complete',
      'authority_required','Completing a ledger row belongs to Accounting.');
  end if;

  select * into t from ops_acct.transactions where trx_no = p_trx_no;
  if not found then
    return ops_core.not_found('accounting','transaction', p_trx_no,'complete','No such transaction.');
  end if;
  if t.status = 'COMPLETED' then
    return ops_core.conflict('accounting','transaction', p_trx_no,'complete',
      'already_complete', format('%s is already COMPLETED — nothing changed.', p_trx_no));
  end if;
  if t.status = 'VOID' then
    return ops_core.conflict('accounting','transaction', p_trx_no,'complete',
      'transaction_void', format('%s is VOID and cannot be completed.', p_trx_no));
  end if;

  if not exists (select 1 from ops_core.attachment_links l
                  where l.entity = 'transaction' and l.entity_no = p_trx_no
                    and l.unlinked_at is null
                    and l.kind in ('nota','transfer_proof')) then
    return ops_core.invalid('accounting','transaction', p_trx_no,'complete',
      'document_required',
      'Attach a receipt / nota or a payment proof before marking this row completed.',
      jsonb_build_object('field','documents','needs', jsonb_build_array('nota','transfer_proof')));
  end if;

  update ops_acct.transactions set status = 'COMPLETED' where id = t.id;

  perform ops_core.emit('accounting','accounting.transaction.completed', p_trx_no,
    jsonb_build_object('trx_no', p_trx_no, 'status_before', t.status, 'status_after', 'COMPLETED'));

  res := ops_core.say('accounting','transaction', p_trx_no,'complete','ok', 200,
    null, null,
    jsonb_build_object('trx_no', p_trx_no, 'status','COMPLETED'),
    jsonb_build_object('status_before', t.status, 'status_after', 'COMPLETED'),
    jsonb_build_object('status', t.status),
    jsonb_build_object('status','COMPLETED'));
  return ops_core.idem_remember('accounting','complete:' || p_trx_no, p_key, res);
end $$;
