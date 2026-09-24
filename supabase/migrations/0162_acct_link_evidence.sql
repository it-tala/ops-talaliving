-- 0162_acct_link_evidence.sql — one proof, several ledger rows, one act.
--
-- ── The question ────────────────────────────────────────────────────────
--
-- Owner, 2026-09-24: *sekarang ada 5 baris di ledger dari satu nota. Tapi
-- pembayarannya itu juga satu dokumen. Bagaimana menghubungkan ke 5 baris itu
-- sekaligus?*
--
-- The rows exist: the legacy sheet booked one ledger row per item, so a
-- single nota from TOKO YUSUF on 15/09 is `trx-26-09-17_111` … `_116` plus its
-- admin fee `_117`, paid by one transfer. The transfer proof arrives in the
-- inbox as one document. *Link to a row* could point it at one of them — and
-- that resolved the inbox row, so the photo left the queue and the other five
-- or six rows could only get their proof by uploading the same file again.
--
-- ── What this does ──────────────────────────────────────────────────────
--
-- Files the document against every named ledger row, and marks every inbox
-- row of the photo ATTACHED, in one transaction. No money moves: every row
-- already exists, which is the whole meaning of *link*.
--
-- The screen shows the selected rows' sum against the document's amount, and
-- **warns** rather than blocks when they differ (A6). Unlike `book_evidence`,
-- nothing new is being asserted about money here, and a proof legitimately
-- covering part of a nota — or a nota plus last week's balance — is ordinary.
--
-- ── Why `resolve_inbox` alone was not enough ────────────────────────────
--
-- `produced_trx_no` is one text column and `resolve_inbox` takes one row. The
-- links are what actually carry the relation (`attachment_links` is
-- many-to-many and always was), so `produced_trx_no` keeps the first row and
-- `resolve_note` lists all of them for whoever reads the history.

create or replace function ops_acct.link_evidence(
  p_ref_ids  text[],
  p_trx_nos  text[],
  p_key      text default null)
returns jsonb
language plpgsql security definer set search_path = ops_acct, ops_core, pg_temp as $$
declare
  refs      text[];
  trxs      text[];
  head      text;
  n_found   int;
  n_pending int;
  n_urls    int;
  missing   text[];
  att       uuid;
  v_kind    ops_core.doc_kind_t;
  ext       jsonb;
  total     numeric;
  replayed  jsonb;
  res       jsonb;
begin
  /* Blanks and repeats dropped, order kept: the first of each is what the
     single-valued columns remember. */
  select coalesce(array_agg(r order by ord), '{}') into refs
    from (select distinct on (btrim(r)) btrim(r) as r, ord
            from unnest(coalesce(p_ref_ids, '{}')) with ordinality as u(r, ord)
           where coalesce(btrim(r), '') <> ''
           order by btrim(r), ord) d;
  select coalesce(array_agg(t order by ord), '{}') into trxs
    from (select distinct on (btrim(t)) btrim(t) as t, ord
            from unnest(coalesce(p_trx_nos, '{}')) with ordinality as u(t, ord)
           where coalesce(btrim(t), '') <> ''
           order by btrim(t), ord) d;

  head := refs[1];

  replayed := ops_core.idem_replay('accounting','link_evidence:' || coalesce(head,''), p_key);
  if replayed is not null then return replayed; end if;

  if not ops_core.has_authority('resolve_inbox') then
    return ops_core.refused('accounting','inbox', head,'link',
      'authority_required',
      'Deciding what a loose document belongs to belongs to Accounting.',
      jsonb_build_object('required','resolve_inbox'));
  end if;

  if cardinality(refs) = 0 then
    return ops_core.invalid('accounting','inbox', null,'link',
      'ref_required', 'Say which inbox document this is.',
      jsonb_build_object('field','ref_ids'));
  end if;
  if cardinality(trxs) = 0 then
    return ops_core.invalid('accounting','inbox', head,'link',
      'trx_required', 'Which ledger rows is this the proof of? Pick at least one.',
      jsonb_build_object('field','trx_nos'));
  end if;

  perform 1 from ops_acct.evidence_inbox
   where ref_id = any(refs) order by ref_id for update;

  select count(*),
         count(*) filter (where i.status = 'PENDING'),
         count(distinct coalesce(a.url, a.storage_path, a.id::text))
    into n_found, n_pending, n_urls
    from ops_acct.evidence_inbox i
    join ops_core.attachments a on a.id = i.attachment_id
   where i.ref_id = any(refs);

  if n_found <> cardinality(refs) then
    return ops_core.not_found('accounting','inbox', head,'link',
      format('%s of the %s inbox rows named do not exist.',
             cardinality(refs) - n_found, cardinality(refs)));
  end if;
  if n_pending <> n_found then
    return ops_core.conflict('accounting','inbox', head,'link',
      'already_resolved',
      format('%s of the %s rows of this document are already decided — nothing changed. '
             || 'Reload the queue.', n_found - n_pending, n_found));
  end if;
  if n_urls > 1 then
    return ops_core.invalid('accounting','inbox', head,'link',
      'not_one_document',
      'These inbox rows are different files. Only rows of the same photo can be linked as one document.',
      jsonb_build_object('field','ref_ids','files',n_urls));
  end if;

  /* Every row named must exist, and the refusal names the ones that do not —
     a typo in one of seven is found by reading the message, not by retrying. */
  select array_agg(t order by t) into missing
    from unnest(trxs) t
   where not exists (select 1 from ops_acct.transactions x where x.trx_no = t);
  if missing is not null then
    return ops_core.invalid('accounting','inbox', head,'link',
      'no_such_transaction',
      format('There is no ledger row %s.', array_to_string(missing, ', ')),
      jsonb_build_object('field','trx_nos','missing',to_jsonb(missing)));
  end if;

  select attachment_id, extracted into att, ext
    from ops_acct.evidence_inbox where ref_id = head;

  /* What kind of paper this is on those rows. The reading's own `doc_kind`
     when it gave a valid one; a payment proof is a transfer proof; anything
     else is the nota it most often is. */
  v_kind := case
    when (ext ->> 'doc_kind') in (select e.enumlabel from pg_enum e
                                   join pg_type ty on ty.oid = e.enumtypid
                                   join pg_namespace n on n.oid = ty.typnamespace
                                  where n.nspname = 'ops_core' and ty.typname = 'doc_kind_t')
      then (ext ->> 'doc_kind')::ops_core.doc_kind_t
    when coalesce(ext ->> 'doc_type', '') ~* '(payment|transfer|bukti)'
      then 'transfer_proof'::ops_core.doc_kind_t
    else 'nota'::ops_core.doc_kind_t
  end;

  insert into ops_core.attachment_links (attachment_id, entity, entity_no, kind, linked_by)
  select att, 'transaction', t, v_kind, auth.uid()
    from unnest(trxs) t
  on conflict do nothing;

  select coalesce(sum(amount_idr), 0) into total
    from ops_acct.transactions where trx_no = any(trxs);

  update ops_acct.evidence_inbox
     set status          = 'ATTACHED',
         produced_trx_no = trxs[1],
         resolved_by     = auth.uid(),
         resolved_at     = now(),
         resolve_note    = case when cardinality(trxs) = 1 then null
                                else format('Proof of %s ledger rows: %s',
                                            cardinality(trxs), array_to_string(trxs, ', '))
                           end
   where ref_id = any(refs);

  perform ops_core.emit('accounting','accounting.inbox.resolved', head,
    jsonb_build_object('ref_id', head, 'ref_ids', to_jsonb(refs), 'status', 'ATTACHED',
                       'trx_no', trxs[1], 'trx_nos', to_jsonb(trxs)));

  res := ops_core.ok('accounting','inbox', head,'link',
    jsonb_build_object('ref_ids', to_jsonb(refs), 'trx_nos', to_jsonb(trxs),
                       'rows', cardinality(trxs), 'rows_total', total),
    to_jsonb('PENDING'::text), to_jsonb('ATTACHED'::text));
  return ops_core.idem_remember('accounting','link_evidence:' || head, p_key, res);
end $$;

comment on function ops_acct.link_evidence(text[], text[], text) is
  'One proof, several ledger rows: files the document against every named row and '
  'marks every inbox row of the photo ATTACHED, in one act. No money moves. Refuses '
  'unless the rows exist, the inbox rows are PENDING and one file. (0162)';

revoke execute on function ops_acct.link_evidence(text[], text[], text) from public;
grant execute on function ops_acct.link_evidence(text[], text[], text) to authenticated;
