-- 0283 — the seventh road out of verification: a transfer proof from Chat
-- books as a transfer between our own accounts, in one act (L16).
--
-- L15 (0282) made a transfer one input: source, destination, amount, fee,
-- proof. The proof usually arrives from Chat first — since September 111 of
-- the 173 confirmed inbox documents were payment proofs, 34 of them worded
-- as a transfer or a cash withdrawal — and until now the person booked it
-- as an ordinary transaction, one leg, and typed the other leg later or
-- never. This seam is `post_transfer` with the inbox document as the proof
-- and the inbox row(s) of the photo closed CONFIRMED with the OUT leg as
-- `produced_trx_no`, the same shape as `book_evidence_to_line` (0281).

create or replace function ops_acct.book_evidence_to_transfer(
  p_ref_id            text,
  p_from_account_code text,
  p_to_account_code   text,
  p_amount            numeric,
  p_trx_date          date    default null,
  p_fee               numeric default null,
  p_description       text    default null,
  p_billed_currency   text    default null,
  p_billed_amount     numeric default null,
  p_also_ref_ids      text[]  default null,
  p_key               text    default null)
returns jsonb
language plpgsql security definer set search_path = ops_acct, ops_core, pg_temp as $$
declare
  row ops_acct.evidence_inbox; refs text[]; n_found int; n_pending int;
  replayed jsonb; posted jsonb; trx text;
begin
  replayed := ops_core.idem_replay('accounting','book_evidence_to_transfer:' || coalesce(p_ref_id,''), p_key);
  if replayed is not null then return replayed; end if;

  if not ops_core.has_authority('post_ledger') then
    return ops_core.refused('accounting','inbox', p_ref_id,'book_to_transfer',
      'authority_required','Booking a document into the ledger belongs to Accounting.',
      jsonb_build_object('required','post_ledger'));
  end if;
  if not ops_core.has_authority('resolve_inbox') then
    return ops_core.refused('accounting','inbox', p_ref_id,'book_to_transfer',
      'authority_required','This also decides what the document belongs to, which belongs to Accounting.',
      jsonb_build_object('required','resolve_inbox'));
  end if;

  select coalesce(array_agg(r order by ord), '{}') into refs
    from (select distinct on (btrim(r)) btrim(r) as r, ord
            from unnest(array[p_ref_id] || coalesce(p_also_ref_ids, '{}')) with ordinality as u(r, ord)
           where coalesce(btrim(r), '') <> ''
           order by btrim(r), ord) d;
  perform 1 from ops_acct.evidence_inbox where ref_id = any(refs) order by ref_id for update;

  select * into row from ops_acct.evidence_inbox where ref_id = p_ref_id;
  if not found then
    return ops_core.not_found('accounting','inbox', p_ref_id,'book_to_transfer','No such inbox row.');
  end if;
  select count(*), count(*) filter (where status = 'PENDING') into n_found, n_pending
    from ops_acct.evidence_inbox where ref_id = any(refs);
  if n_found <> cardinality(refs) then
    return ops_core.not_found('accounting','inbox', p_ref_id,'book_to_transfer',
      format('%s of the %s inbox rows named do not exist.', cardinality(refs) - n_found, cardinality(refs)));
  end if;
  if n_pending <> n_found then
    return ops_core.conflict('accounting','inbox', p_ref_id,'book_to_transfer',
      'already_resolved', format('This document is already %s — nothing changed.', row.status));
  end if;

  -- One act: both legs and the fee through post_transfer, this document as
  -- the proof on each. Its refusals are relayed whole; nothing is written.
  posted := ops_acct.post_transfer(
    p_from_account_code => p_from_account_code,
    p_to_account_code   => p_to_account_code,
    p_amount            => p_amount,
    p_documents         => jsonb_build_array(jsonb_build_object(
                             'attachment_id', row.attachment_id,
                             'kind', ops_core.doc_kind_from_reading(row.extracted)::text)),
    p_trx_date          => p_trx_date,
    p_description       => p_description,
    p_fee               => p_fee,
    p_billed_currency   => p_billed_currency,
    p_billed_amount     => p_billed_amount,
    p_key               => null);
  if not ops_core.said_ok(posted) then
    return posted;
  end if;
  trx := posted -> 'data' ->> 'out_trx_no';

  update ops_acct.evidence_inbox
     set status          = 'CONFIRMED',
         produced_trx_no = trx,
         resolved_by     = auth.uid(),
         resolved_at     = now()
   where ref_id = any(refs);

  return ops_core.idem_remember('accounting','book_evidence_to_transfer:' || p_ref_id, p_key,
    ops_core.ok('accounting','inbox', p_ref_id,'book_to_transfer',
      (posted -> 'data') || jsonb_build_object('rows', cardinality(refs)),
      to_jsonb(row),
      jsonb_build_object('status','CONFIRMED','trx_no', trx,
                         'transfer_id', posted -> 'data' ->> 'transfer_id')));
end $$;
revoke execute on function ops_acct.book_evidence_to_transfer(text, text, text, numeric, date, numeric, text, text, numeric, text[], text) from public;
grant  execute on function ops_acct.book_evidence_to_transfer(text, text, text, numeric, date, numeric, text, text, numeric, text[], text) to authenticated;
comment on function ops_acct.book_evidence_to_transfer(text, text, text, numeric, date, numeric, text, text, numeric, text[], text) is
  'Verification''s seventh road (0283, L16): a transfer between our own accounts booked from the inbox '
  'document that proves it — post_transfer with the document on every row, then the inbox row(s) CONFIRMED '
  'with the OUT leg as produced_trx_no. post_ledger + resolve_inbox. 409 already_resolved; post_transfer''s refusals relayed.';
