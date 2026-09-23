-- 0093_acct_complete_transaction.sql — the third status transition the ledger
-- never had a seam for.
--
-- `accounting.markComplete` (`src/demo/api/accounting.ts`) moves a row from
-- whatever it was to `COMPLETED`, guarded only by `post_ledger` and *not
-- already complete* — the same two-check shape `void_transaction` (`0021`)
-- already has for its own transition, read top to bottom against it rather
-- than invented: same authority, same not-found, same already-there conflict,
-- same before/after in the audit trail, same idempotency key. `/accounting/
-- ledger` was on `PENDING_PARITY`'s route list for exactly this — the screen
-- called a function that did not exist.
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

  update ops_acct.transactions set status = 'COMPLETED' where id = t.id;

  perform ops_core.emit('accounting','accounting.transaction.completed', p_trx_no,
    jsonb_build_object('trx_no', p_trx_no, 'status_before', t.status, 'status_after', 'COMPLETED'));

  res := ops_core.ok('accounting','transaction', p_trx_no,'complete',
    jsonb_build_object('trx_no', p_trx_no, 'status','COMPLETED'),
    jsonb_build_object('status', t.status),
    jsonb_build_object('status','COMPLETED'));
  return ops_core.idem_remember('accounting','complete:' || p_trx_no, p_key, res);
end $$;

grant execute on function ops_acct.complete_transaction(text, text) to authenticated;
