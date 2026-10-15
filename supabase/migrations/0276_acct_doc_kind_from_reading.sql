-- 0276 — the kind of paper a Chat capture is, read once (L3, F272).
--
-- John-lau's `file_document` says `doc_type` — *Payment Proof*, *Receiving
-- Item*, *Receipt / Invoice / Nota*, *Others*. `link_evidence` (0162) read
-- it; `book_evidence` (0124), written a month earlier, read a key called
-- `doc_kind` that never arrived and filed every document booked from Chat
-- since 2 September as a nota — 78 transfer proofs among them. One mapping,
-- named, that both seams call (F272's rule), and the 102 booked rows put
-- right from the inbox's own reading, link by link, with a trail.

-- ── 1. the one mapping ───────────────────────────────────────────────────
-- An explicit `doc_kind` that names a kind this system files wins; else the
-- bot's `doc_type` by its words; else the nota it most often is.
create or replace function ops_core.doc_kind_from_reading(p_extracted jsonb)
returns ops_core.doc_kind_t
language sql stable set search_path = ops_core, pg_temp as $$
  select case
    when (p_extracted ->> 'doc_kind') in (select e.enumlabel from pg_enum e
                                           join pg_type ty on ty.oid = e.enumtypid
                                           join pg_namespace n on n.oid = ty.typnamespace
                                          where n.nspname = 'ops_core' and ty.typname = 'doc_kind_t')
      then (p_extracted ->> 'doc_kind')::ops_core.doc_kind_t
    when coalesce(p_extracted ->> 'doc_type', '') ~* '(payment|transfer|bukti)'
      then 'transfer_proof'::ops_core.doc_kind_t
    when coalesce(p_extracted ->> 'doc_type', '') ~* '(receiving|goods|barang|item)'
      then 'goods_photo'::ops_core.doc_kind_t
    when coalesce(p_extracted ->> 'doc_type', '') ~* '^\s*(others?|lain)'
      then 'other'::ops_core.doc_kind_t
    else 'nota'::ops_core.doc_kind_t
  end
$$;
revoke all on function ops_core.doc_kind_from_reading(jsonb) from public;
grant execute on function ops_core.doc_kind_from_reading(jsonb) to authenticated;
comment on function ops_core.doc_kind_from_reading(jsonb) is
  'What kind of document a capture is, from the inbox row''s reading: an explicit doc_kind, '
  'else the bot''s doc_type by its words, else nota. The one place both booking seams read it (F272).';

-- ── 2. the seams read it ─────────────────────────────────────────────────
-- Bodies as written (0124, 0162); the one change in each is the mapping.
create or replace function ops_acct.book_evidence(
  p_ref_id        text,
  p_account_code  text,
  p_direction     ops_acct.direction_t,
  p_amount        numeric,
  p_type_code     text,
  p_description   text,
  p_trx_date      date    default null,
  p_vendor_code   text    default null,
  p_project_code  text    default null,
  p_lines         jsonb   default '[]'::jsonb,
  p_remark        text    default null,
  p_key           text    default null)
returns jsonb
language plpgsql security definer set search_path = ops_acct, ops_core, pg_temp as $$
declare
  row       ops_acct.evidence_inbox;
  replayed  jsonb;
  posted    jsonb;
  trx       text;
  line_sum  numeric;
  n_lines   int;
begin
  replayed := ops_core.idem_replay('accounting','book_evidence:' || coalesce(p_ref_id,''), p_key);
  if replayed is not null then return replayed; end if;

  if not ops_core.has_authority('post_ledger') then
    return ops_core.refused('accounting','inbox', p_ref_id,'book',
      'authority_required',
      'Booking a document into the ledger belongs to Accounting.',
      jsonb_build_object('required','post_ledger'));
  end if;
  if not ops_core.has_authority('resolve_inbox') then
    return ops_core.refused('accounting','inbox', p_ref_id,'book',
      'authority_required',
      'This also decides what the document belongs to, which belongs to Accounting.',
      jsonb_build_object('required','resolve_inbox'));
  end if;

  select * into row from ops_acct.evidence_inbox where ref_id = p_ref_id;
  if not found then
    return ops_core.not_found('accounting','inbox', p_ref_id,'book','No such inbox row.');
  end if;
  if row.status <> 'PENDING' then
    return ops_core.conflict('accounting','inbox', p_ref_id,'book',
      'already_resolved', format('This document is already %s — nothing changed.', row.status));
  end if;

  /* The net §14 asks for. Counted before anything is written, and the message
     carries both numbers because *they disagree* is not actionable and
     *2.500 against 15.850.000* is. */
  select count(*), coalesce(sum((l ->> 'amount')::numeric), 0)
    into n_lines, line_sum
    from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) l;

  if n_lines > 0 and line_sum <> p_amount then
    return ops_core.invalid('accounting','inbox', p_ref_id,'book',
      'lines_do_not_add_up',
      /* Grouped with `.`, not with whatever the server's locale happens to
         use. `to_char`'s `G` gave `500,000` here, and to an Indonesian reader
         that is five hundred and a decimal — the one kind of ambiguity a
         message about money cannot afford. Caught by the smoke file, which
         asserts the figures rather than the wording. */
      format('The document says %s and its %s line(s) add up to %s — a difference of %s. '
             || 'Add a line for the rest, or correct one, before booking it.',
             ops_acct.rupiah(p_amount),
             n_lines,
             ops_acct.rupiah(line_sum),
             ops_acct.rupiah(line_sum - p_amount)),
      jsonb_build_object('field','lines','amount',p_amount,
                         'lines_total',line_sum,'difference',line_sum - p_amount));
  end if;

  /* One act: the ledger row, its lines, and this document filed against it.
     `post_transaction` owns every rule about money — the account, the type,
     the vendor, the direction — and none of them is restated here. A second
     copy of those rules is a second answer to the same question. */
  posted := ops_acct.post_transaction(
    p_account_code => p_account_code,
    p_direction    => p_direction,
    p_amount       => p_amount,
    p_type_code    => p_type_code,
    p_description  => p_description,
    p_documents    => jsonb_build_array(jsonb_build_object(
                        'attachment_id', row.attachment_id,
                        'kind', ops_core.doc_kind_from_reading(row.extracted)::text)),
    p_trx_date     => p_trx_date,
    p_vendor_code  => p_vendor_code,
    p_project_code => p_project_code,
    p_lines        => coalesce(p_lines, '[]'::jsonb),
    p_remark       => p_remark,
    p_source_ref   => 'inbox:' || p_ref_id);

  /* Relayed whole, not summarised. Its refusals name the account that does
     not exist or the vendor that does not resolve, and those are the words
     the person needs. Nothing has been written at this point. */
  if not ops_core.said_ok(posted) then
    return posted;
  end if;

  trx := posted -> 'data' ->> 'trx_no';

  update ops_acct.evidence_inbox
     set status          = 'CONFIRMED',
         produced_trx_no = trx,
         resolved_by     = auth.uid(),
         resolved_at     = now()
   where ref_id = p_ref_id;

  return ops_core.idem_remember('accounting','book_evidence:' || p_ref_id, p_key,
    ops_core.ok('accounting','inbox', p_ref_id,'book',
      jsonb_build_object('trx_no', trx, 'lines', n_lines, 'amount', p_amount),
      to_jsonb(row),
      jsonb_build_object('status','CONFIRMED','trx_no',trx)));
end $$;

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
  v_kind := ops_core.doc_kind_from_reading(ext);

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

-- ── 3. the 102 rows already booked, put right from their own reading ─────
-- The link made by `book_evidence` for an inbox-booked row carries the kind
-- the reading says. Where the row already has a live link of that kind on
-- the same file (three, from a hand correction), the nota link is closed
-- instead of becoming a twin. A no-op on the ladder; 77 links on production.
do $$
declare r record; v_want ops_core.doc_kind_t; v_n int := 0;
begin
  for r in
    select k.id as link_id, k.kind, k.linked_by, k.attachment_id, k.entity_no, t.trx_no, i.ref_id, i.extracted
      from ops_acct.transactions t
      join ops_acct.evidence_inbox i on 'inbox:' || i.ref_id = t.source_ref
      join ops_core.attachment_links k
        on k.entity = 'transaction' and k.entity_no = t.trx_no
       and k.attachment_id = i.attachment_id and k.unlinked_at is null
     where t.source_ref like 'inbox:%'
     order by t.trx_no
  loop
    v_want := ops_core.doc_kind_from_reading(r.extracted);
    continue when v_want = r.kind;
    if exists (select 1 from ops_core.attachment_links s
                where s.attachment_id = r.attachment_id and s.entity = 'transaction'
                  and s.entity_no = r.trx_no and s.kind = v_want and s.unlinked_at is null) then
      update ops_core.attachment_links set unlinked_at = now(), unlinked_by = r.linked_by where id = r.link_id;
    else
      update ops_core.attachment_links set kind = v_want where id = r.link_id;
    end if;
    perform ops_core.write_audit('documents', 'attachment_link', r.link_id::text, 'rekind', 'ok',
      'Jenis dokumen dari pembacaan inbox, bukan nota bawaan (0276, F272)',
      jsonb_build_object('kind', r.kind, 'trx_no', r.trx_no, 'ref_id', r.ref_id),
      jsonb_build_object('kind', v_want),
      jsonb_build_object('doc_type', r.extracted ->> 'doc_type'));
    v_n := v_n + 1;
  end loop;
  raise notice '0276: % links re-kinded', v_n;
end $$;

grant execute on function
  ops_acct.book_evidence(text, text, ops_acct.direction_t, numeric, text, text, date, text, text, jsonb, text, text),
  ops_acct.link_evidence(text[], text[], text)
  to authenticated;

analyze ops_core.attachment_links;
