-- 0286 — documents from Chat are grouped into one draft per transaction and
-- confirmed on the ledger (D445).
--
-- Owner, 2026-10-19: *setiap dokumen baru yang diupload diolah secara batch.
-- 1 transaksi biasanya memiliki beberapa dokumen sekaligus. sistem akan
-- mengelompokannya berdasarkan nilai transaksi … akunting tidak lagi
-- konfirmasi satu-satu lewat purchase verification, tapi sistem otomatis
-- mencatat sebagai draft ledger … accounting tinggal click centang untuk
-- konfirmasi atau silang untuk membatalkan.*
--
-- ── Where the grouping lives, and what is stored ─────────────────────────
--
-- The grouping is a **proposal**, recomputed on every read from the inbox
-- rows still PENDING (`src/services/accounting/drafts.ts`, one function both
-- API layers call). Nothing about a draft is stored until somebody decides
-- it, for two reasons:
--
--   * capture must never fail because a proposal could not be computed
--     (john-lau rule 5, A6) — so no trigger on `evidence_inbox`;
--   * a stored proposal goes stale the moment the next photo arrives, and a
--     stale draft is the thing the person would then confirm.
--
-- What **is** stored, append-only:
--
--   * `draft_decisions` — every ✓ and ✕, with the score, level and reasons
--     the person was shown, the amount and account the grouping proposed,
--     and what was actually booked. *Why was this green* is answerable
--     months later, from the row, not from today's version of the rules.
--   * `draft_apart` — *these two documents are not one transaction*, said by
--     a person (✕ → pengelompokan salah, or one document taken out of a
--     draft). The grouping never puts that pair together again.
--
-- ── The seams ─────────────────────────────────────────────────────────────
--
-- `confirm_draft` books the head document through the road the draft names
-- (`book_evidence_group`, `book_evidence_to_transfer`, `book_evidence_to_line`)
-- or links every document to a row that already exists (`link_evidence`),
-- then files every other document of the draft against the same row. One
-- act: a refusal anywhere rolls back everything before it (a sub-block with
-- its own exception), so a draft is never half booked. Every rule about
-- money stays in the seams it calls; none is restated here.
--
-- `dismiss_draft` closes every document with `resolve_inbox` as REJECTED or
-- NOTED, with the reason. `split_draft` records the pairs apart. Neither
-- deletes anything (A16).

-- ── 1. the decisions ─────────────────────────────────────────────────────
create table if not exists ops_acct.draft_decisions (
  id           uuid primary key default gen_random_uuid(),
  draft_key    text not null,
  decision     text not null check (decision in ('confirmed','linked','rejected','noted','split','detached')),
  road         text check (road in ('transaction','transfer','pay_line','link')),
  ref_ids      text[] not null check (cardinality(ref_ids) > 0),
  level        text check (level in ('hi','mid','lo','loose')),
  score        int  check (score between 0 and 100),
  reasons      jsonb not null default '[]'::jsonb,
  proposed     jsonb not null default '{}'::jsonb,
  booked       jsonb not null default '{}'::jsonb,
  trx_no       text,
  note         text,
  decided_by   uuid not null references ops_core.users(id),
  decided_at   timestamptz not null default now()
);
comment on table ops_acct.draft_decisions is
  'Every decision on a ledger draft (0286, D445): the documents, the level/score/reasons the '
  'person was shown, what the grouping proposed and what was booked. Append-only.';
create index if not exists draft_decisions_at_idx on ops_acct.draft_decisions (decided_at desc);
create index if not exists draft_decisions_trx_idx on ops_acct.draft_decisions (trx_no) where trx_no is not null;

-- ── 2. pairs a person said are not one transaction ───────────────────────
-- Keyed by the file, the same expression `book_evidence_group` compares
-- (`coalesce(url, storage_path, id)`), ordered so a pair is stored once.
create table if not exists ops_acct.draft_apart (
  id          uuid primary key default gen_random_uuid(),
  file_a      text not null,
  file_b      text not null,
  decision_id uuid not null references ops_acct.draft_decisions(id),
  decided_by  uuid not null references ops_core.users(id),
  decided_at  timestamptz not null default now(),
  constraint draft_apart_ordered check (file_a < file_b),
  constraint draft_apart_once unique (file_a, file_b)
);
comment on table ops_acct.draft_apart is
  'Two documents a person said are not one transaction (0286, D445). The grouping never puts '
  'the pair in one draft again. Append-only.';

alter table ops_acct.draft_decisions enable row level security;
alter table ops_acct.draft_apart     enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'ops_acct' and policyname = 'draft_decisions_read') then
    create policy draft_decisions_read on ops_acct.draft_decisions
      for select to authenticated using (ops_core.has_permission('accounting.read'));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'ops_acct' and policyname = 'draft_apart_read') then
    create policy draft_apart_read on ops_acct.draft_apart
      for select to authenticated using (ops_core.has_permission('accounting.read'));
  end if;
end $$;
grant select on ops_acct.draft_decisions, ops_acct.draft_apart to authenticated;

-- ── 3. helpers ───────────────────────────────────────────────────────────
-- The documents of a draft arrive as `[[ref, ref], [ref], …]`: each inner
-- array is one file (the rows of one photo, 0161). Refs blanked and repeated
-- are dropped; a document left empty is dropped.
create or replace function ops_acct.draft_docs_clean(p_docs jsonb)
returns jsonb
language sql immutable set search_path = ops_acct, pg_temp as $$
  select coalesce(jsonb_agg(d.refs order by d.ord), '[]'::jsonb)
    from (select o.ord,
                 (select jsonb_agg(distinct btrim(r))
                    from jsonb_array_elements_text(o.doc) r
                   where coalesce(btrim(r), '') <> '') as refs
            from jsonb_array_elements(case when jsonb_typeof(p_docs) = 'array' then p_docs else '[]'::jsonb end)
                 with ordinality as o(doc, ord)
           where jsonb_typeof(o.doc) = 'array') d
   where d.refs is not null
$$;
revoke all on function ops_acct.draft_docs_clean(jsonb) from public;

create or replace function ops_acct.draft_refs(p_docs jsonb)
returns text[]
language sql immutable set search_path = ops_acct, pg_temp as $$
  select coalesce(array_agg(r), '{}')
    from jsonb_array_elements(ops_acct.draft_docs_clean(p_docs)) d,
         jsonb_array_elements_text(d) r
$$;
revoke all on function ops_acct.draft_refs(jsonb) from public;

-- Refuses unless every ref exists and is PENDING, and each document is one
-- file. Null when all is well, else the envelope to return.
create or replace function ops_acct.draft_check_docs(p_key text, p_action text, p_docs jsonb)
returns jsonb
language plpgsql stable set search_path = ops_acct, ops_core, pg_temp as $$
declare refs text[]; n_found int; n_pending int; bad int;
begin
  refs := ops_acct.draft_refs(p_docs);
  if cardinality(refs) = 0 then
    return ops_core.invalid('accounting','draft', p_key, p_action,
      'docs_required','Say which documents this draft is.', jsonb_build_object('field','docs'));
  end if;
  select count(*), count(*) filter (where status = 'PENDING') into n_found, n_pending
    from ops_acct.evidence_inbox where ref_id = any(refs);
  if n_found <> cardinality(refs) then
    return ops_core.not_found('accounting','draft', p_key, p_action,
      format('%s of the %s documents named do not exist.', cardinality(refs) - n_found, cardinality(refs)));
  end if;
  if n_pending <> n_found then
    return ops_core.conflict('accounting','draft', p_key, p_action,
      'already_resolved',
      format('%s of the %s documents of this draft were already decided elsewhere — nothing changed. '
             || 'Reload the ledger; the draft is grouped again without them.', n_found - n_pending, n_found));
  end if;
  select count(*) into bad
    from jsonb_array_elements(ops_acct.draft_docs_clean(p_docs)) d
   where (select count(distinct coalesce(a.url, a.storage_path, a.id::text))
            from ops_acct.evidence_inbox i join ops_core.attachments a on a.id = i.attachment_id
           where i.ref_id in (select jsonb_array_elements_text(d))) > 1;
  if bad > 0 then
    return ops_core.invalid('accounting','draft', p_key, p_action,
      'not_one_document','One document of this draft names rows of different files.',
      jsonb_build_object('field','docs'));
  end if;
  return null;
end $$;
revoke all on function ops_acct.draft_check_docs(text, text, jsonb) from public;

-- ── 4. ✓ — book the draft ────────────────────────────────────────────────
-- `p_docs[0]` is the head: the document the ledger row's `source_ref` and
-- the booking road are taken from — the payment proof when there is one,
-- because its amount is what left the bank (review §3). Lines may carry
-- `"doc": <index into p_docs>`; after booking they point at that document
-- (0279), so a nota's items point at the nota and not at the transfer.
create or replace function ops_acct.confirm_draft(
  p_draft_key     text,
  p_docs          jsonb,
  p_road          text,
  p_account_code  text,
  p_amount        numeric,
  p_trx_date      date    default null,
  p_direction     ops_acct.direction_t default 'OUT',
  p_type_code     text    default 'SUPPLIERS',
  p_description   text    default null,
  p_vendor_code   text    default null,
  p_project_code  text    default null,
  p_lines         jsonb   default '[]'::jsonb,
  p_remark        text    default null,
  p_to_account    text    default null,
  p_fee           numeric default null,
  p_line_no       text    default null,
  p_link_trx_no   text    default null,
  p_shown         jsonb   default '{}'::jsonb,
  p_key           text    default null)
returns jsonb
language plpgsql security definer set search_path = ops_acct, ops_core, pg_temp as $$
declare
  docs jsonb; refs text[]; head text[]; bad jsonb; replayed jsonb; res jsonb;
  posted jsonb; trx text; i int; v_lines jsonb; v_ptrs jsonb; v_atts uuid[];
  v_detail text; v_id uuid; v_decision text;
begin
  replayed := ops_core.idem_replay('accounting','confirm_draft:' || coalesce(p_draft_key,''), p_key);
  if replayed is not null then return replayed; end if;

  if not ops_core.has_authority('post_ledger') then
    return ops_core.refused('accounting','draft', p_draft_key,'confirm',
      'authority_required','Booking a draft into the ledger belongs to Accounting.',
      jsonb_build_object('required','post_ledger'));
  end if;
  if not ops_core.has_authority('resolve_inbox') then
    return ops_core.refused('accounting','draft', p_draft_key,'confirm',
      'authority_required','This also decides what the documents belong to, which belongs to Accounting.',
      jsonb_build_object('required','resolve_inbox'));
  end if;
  if coalesce(p_road, '') not in ('transaction','transfer','pay_line','link') then
    return ops_core.invalid('accounting','draft', p_draft_key,'confirm',
      'road_required','Say how the draft is booked: transaction, transfer, pay_line or link.',
      jsonb_build_object('field','road'));
  end if;

  docs := ops_acct.draft_docs_clean(p_docs);
  refs := ops_acct.draft_refs(docs);
  perform 1 from ops_acct.evidence_inbox where ref_id = any(refs) order by ref_id for update;
  bad := ops_acct.draft_check_docs(p_draft_key, 'confirm', docs);
  if bad is not null then return bad; end if;

  select array_agg(r) into head from jsonb_array_elements_text(docs -> 0) r;
  v_lines := coalesce((select jsonb_agg(l - 'doc' order by o)
                         from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) with ordinality t(l, o)),
                      '[]'::jsonb);

  begin
    if p_road = 'link' then
      if coalesce(btrim(p_link_trx_no), '') = '' then
        return ops_core.invalid('accounting','draft', p_draft_key,'confirm',
          'trx_required','Which ledger row are these documents the proof of?',
          jsonb_build_object('field','link_trx_no'));
      end if;
      trx := btrim(p_link_trx_no);
      posted := ops_core.ok('accounting','draft', p_draft_key,'confirm', jsonb_build_object('trx_no', trx));
      i := 0;
    elsif p_road = 'transfer' then
      posted := ops_acct.book_evidence_to_transfer(
        p_ref_id => head[1], p_from_account_code => p_account_code, p_to_account_code => p_to_account,
        p_amount => p_amount, p_trx_date => p_trx_date, p_fee => p_fee, p_description => p_description,
        p_also_ref_ids => head[2:]);
      trx := posted -> 'data' ->> 'out_trx_no';
      i := 1;
    elsif p_road = 'pay_line' then
      posted := ops_acct.book_evidence_to_line(
        p_ref_id => head[1], p_line_no => p_line_no, p_account_code => p_account_code,
        p_amount => p_amount, p_trx_date => p_trx_date, p_type_code => coalesce(p_type_code, 'SUPPLIERS'),
        p_also_ref_ids => head[2:]);
      trx := posted -> 'data' ->> 'trx_no';
      i := 1;
    else
      posted := ops_acct.book_evidence_group(
        p_ref_ids => head, p_account_code => p_account_code, p_direction => coalesce(p_direction, 'OUT'),
        p_amount => p_amount, p_type_code => coalesce(p_type_code, 'SUPPLIERS'),
        p_description => coalesce(nullif(btrim(p_description), ''), 'Draft ' || p_draft_key),
        p_trx_date => p_trx_date, p_vendor_code => p_vendor_code, p_project_code => p_project_code,
        p_lines => v_lines, p_remark => p_remark);
      trx := posted -> 'data' ->> 'trx_no';
      i := 1;
    end if;
    if not ops_core.said_ok(posted) then
      raise exception using errcode = 'DR001', detail = posted::text;
    end if;

    /* Every other document of the draft is the proof of the same row. */
    while i < jsonb_array_length(docs) loop
      posted := ops_acct.link_evidence(
        array(select jsonb_array_elements_text(docs -> i)), array[trx]);
      if not ops_core.said_ok(posted) then
        raise exception using errcode = 'DR001', detail = posted::text;
      end if;
      i := i + 1;
    end loop;

    /* A line read from the nota points at the nota (0279). */
    if p_road = 'transaction' then
      select array_agg(attachment_id order by o) into v_atts
        from (select o, (select attachment_id from ops_acct.evidence_inbox
                          where ref_id = (d ->> 0)) as attachment_id
                from jsonb_array_elements(docs) with ordinality t(d, o)) x;
      select jsonb_agg(jsonb_build_object('line_no', o, 'attachment_id', v_atts[(l ->> 'doc')::int + 1]))
        into v_ptrs
        from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) with ordinality t(l, o)
       where (l ->> 'doc') ~ '^\d+$' and (l ->> 'doc')::int between 1 and cardinality(v_atts) - 1;
      if v_ptrs is not null then
        posted := ops_acct.set_line_evidence(trx, v_ptrs);
        if not ops_core.said_ok(posted) and posted ->> 'outcome' <> 'noop' then
          raise exception using errcode = 'DR001', detail = posted::text;
        end if;
      end if;
    end if;
  exception when sqlstate 'DR001' then
    get stacked diagnostics v_detail = pg_exception_detail;
    return v_detail::jsonb;
  end;

  v_decision := case when p_road = 'link' then 'linked' else 'confirmed' end;
  insert into ops_acct.draft_decisions
    (draft_key, decision, road, ref_ids, level, score, reasons, proposed, booked, trx_no, note, decided_by)
  values
    (p_draft_key, v_decision, p_road, refs,
     nullif(p_shown ->> 'level', ''),
     case when (p_shown ->> 'score') ~ '^\d+$' then (p_shown ->> 'score')::int end,
     coalesce(p_shown -> 'reasons', '[]'::jsonb),
     coalesce(p_shown -> 'proposed', '{}'::jsonb),
     jsonb_strip_nulls(jsonb_build_object('account', p_account_code, 'amount', p_amount,
       'trx_date', p_trx_date, 'to_account', p_to_account, 'fee', p_fee, 'line_no', p_line_no)),
     trx, nullif(btrim(p_remark), ''), auth.uid())
  returning id into v_id;

  perform ops_core.emit('accounting','accounting.draft.' || v_decision, p_draft_key,
    jsonb_build_object('draft_key', p_draft_key, 'trx_no', trx, 'road', p_road, 'ref_ids', to_jsonb(refs)));

  res := ops_core.ok('accounting','draft', p_draft_key,'confirm',
    jsonb_build_object('trx_no', trx, 'road', p_road, 'documents', jsonb_array_length(docs),
                       'ref_ids', to_jsonb(refs), 'decision_id', v_id));
  return ops_core.idem_remember('accounting','confirm_draft:' || p_draft_key, p_key, res);
end $$;
revoke execute on function ops_acct.confirm_draft(text, jsonb, text, text, numeric, date, ops_acct.direction_t,
  text, text, text, text, jsonb, text, text, numeric, text, text, jsonb, text) from public;
grant  execute on function ops_acct.confirm_draft(text, jsonb, text, text, numeric, date, ops_acct.direction_t,
  text, text, text, text, jsonb, text, text, numeric, text, text, jsonb, text) to authenticated;
comment on function ops_acct.confirm_draft(text, jsonb, text, text, numeric, date, ops_acct.direction_t,
  text, text, text, text, jsonb, text, text, numeric, text, text, jsonb, text) is
  'Books a ledger draft (0286, D445): the head document through book_evidence_group, '
  'book_evidence_to_transfer or book_evidence_to_line (or link to an existing row), every other '
  'document linked to the same row, lines pointed at their document — all or nothing — and the '
  'decision recorded with what the person was shown.';

-- ── 5. ✕ — not ours, or not a transaction ────────────────────────────────
create or replace function ops_acct.dismiss_draft(
  p_draft_key text,
  p_docs      jsonb,
  p_road      text,
  p_reason    text,
  p_shown     jsonb default '{}'::jsonb,
  p_key       text  default null)
returns jsonb
language plpgsql security definer set search_path = ops_acct, ops_core, pg_temp as $$
declare
  docs jsonb; refs text[]; bad jsonb; replayed jsonb; res jsonb; r text; posted jsonb;
  v_detail text; v_status ops_acct.inbox_status_t;
begin
  replayed := ops_core.idem_replay('accounting','dismiss_draft:' || coalesce(p_draft_key,''), p_key);
  if replayed is not null then return replayed; end if;
  if not ops_core.has_authority('resolve_inbox') then
    return ops_core.refused('accounting','draft', p_draft_key,'dismiss',
      'authority_required','Deciding what a document is belongs to Accounting.',
      jsonb_build_object('required','resolve_inbox'));
  end if;
  if coalesce(p_road, '') not in ('reject','note') then
    return ops_core.invalid('accounting','draft', p_draft_key,'dismiss',
      'road_required','Say whether the documents are not ours (reject) or not a transaction (note).',
      jsonb_build_object('field','road'));
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    return ops_core.invalid('accounting','draft', p_draft_key,'dismiss',
      'reason_required','Say why — a document nobody explained is a document nobody can review.',
      jsonb_build_object('field','reason'));
  end if;
  docs := ops_acct.draft_docs_clean(p_docs);
  refs := ops_acct.draft_refs(docs);
  perform 1 from ops_acct.evidence_inbox where ref_id = any(refs) order by ref_id for update;
  bad := ops_acct.draft_check_docs(p_draft_key, 'dismiss', docs);
  if bad is not null then return bad; end if;

  v_status := case when p_road = 'reject' then 'REJECTED' else 'NOTED' end;
  begin
    foreach r in array refs loop
      posted := ops_acct.resolve_inbox(p_ref_id => r, p_status => v_status, p_note => btrim(p_reason));
      if not ops_core.said_ok(posted) then
        raise exception using errcode = 'DR001', detail = posted::text;
      end if;
    end loop;
  exception when sqlstate 'DR001' then
    get stacked diagnostics v_detail = pg_exception_detail;
    return v_detail::jsonb;
  end;

  insert into ops_acct.draft_decisions
    (draft_key, decision, ref_ids, level, score, reasons, proposed, note, decided_by)
  values
    (p_draft_key, case when p_road = 'reject' then 'rejected' else 'noted' end, refs,
     nullif(p_shown ->> 'level', ''),
     case when (p_shown ->> 'score') ~ '^\d+$' then (p_shown ->> 'score')::int end,
     coalesce(p_shown -> 'reasons', '[]'::jsonb), coalesce(p_shown -> 'proposed', '{}'::jsonb),
     btrim(p_reason), auth.uid());

  res := ops_core.ok('accounting','draft', p_draft_key,'dismiss',
    jsonb_build_object('status', v_status, 'ref_ids', to_jsonb(refs)));
  return ops_core.idem_remember('accounting','dismiss_draft:' || p_draft_key, p_key, res);
end $$;
revoke execute on function ops_acct.dismiss_draft(text, jsonb, text, text, jsonb, text) from public;
grant  execute on function ops_acct.dismiss_draft(text, jsonb, text, text, jsonb, text) to authenticated;
comment on function ops_acct.dismiss_draft(text, jsonb, text, text, jsonb, text) is
  'Closes every document of a ledger draft through resolve_inbox as REJECTED (reject) or NOTED '
  '(note), with the reason, and records the decision (0286, D445). Nothing is deleted.';

-- ── 6. ✕ — the grouping was wrong ────────────────────────────────────────
-- `p_detach` null: every pair of documents in the draft is apart (the draft
-- falls back to loose documents). `p_detach` = an index into `p_docs`: only
-- that document is apart from the others (taken out of the draft).
create or replace function ops_acct.split_draft(
  p_draft_key text,
  p_docs      jsonb,
  p_detach    int   default null,
  p_note      text  default null,
  p_shown     jsonb default '{}'::jsonb)
returns jsonb
language plpgsql security definer set search_path = ops_acct, ops_core, pg_temp as $$
declare docs jsonb; refs text[]; bad jsonb; v_files text[]; v_id uuid; n int;
begin
  if not ops_core.has_authority('resolve_inbox') then
    return ops_core.refused('accounting','draft', p_draft_key,'split',
      'authority_required','Deciding what documents belong together belongs to Accounting.',
      jsonb_build_object('required','resolve_inbox'));
  end if;
  docs := ops_acct.draft_docs_clean(p_docs);
  refs := ops_acct.draft_refs(docs);
  bad := ops_acct.draft_check_docs(p_draft_key, 'split', docs);
  if bad is not null then return bad; end if;
  if jsonb_array_length(docs) < 2 then
    return ops_core.invalid('accounting','draft', p_draft_key,'split',
      'nothing_to_split','A draft of one document has nothing to take apart.',
      jsonb_build_object('field','docs'));
  end if;
  if p_detach is not null and (p_detach < 0 or p_detach >= jsonb_array_length(docs)) then
    return ops_core.invalid('accounting','draft', p_draft_key,'split',
      'no_such_document','That document is not in this draft.', jsonb_build_object('field','detach'));
  end if;

  select array_agg(f order by o) into v_files
    from (select o, (select coalesce(a.url, a.storage_path, a.id::text)
                       from ops_acct.evidence_inbox i join ops_core.attachments a on a.id = i.attachment_id
                      where i.ref_id = (d ->> 0)) as f
            from jsonb_array_elements(docs) with ordinality t(d, o)) x;

  insert into ops_acct.draft_decisions
    (draft_key, decision, ref_ids, level, score, reasons, proposed, note, decided_by)
  values
    (p_draft_key, case when p_detach is null then 'split' else 'detached' end, refs,
     nullif(p_shown ->> 'level', ''),
     case when (p_shown ->> 'score') ~ '^\d+$' then (p_shown ->> 'score')::int end,
     coalesce(p_shown -> 'reasons', '[]'::jsonb), coalesce(p_shown -> 'proposed', '{}'::jsonb),
     nullif(btrim(p_note), ''), auth.uid())
  returning id into v_id;

  insert into ops_acct.draft_apart (file_a, file_b, decision_id, decided_by)
  select least(a.f, b.f), greatest(a.f, b.f), v_id, auth.uid()
    from unnest(v_files) with ordinality a(f, ia)
    join unnest(v_files) with ordinality b(f, ib) on a.ia < b.ib
   where a.f <> b.f
     and (p_detach is null or a.ia = p_detach + 1 or b.ib = p_detach + 1)
  on conflict (file_a, file_b) do nothing;
  get diagnostics n = row_count;

  return ops_core.ok('accounting','draft', p_draft_key,'split',
    jsonb_build_object('pairs', n, 'decision_id', v_id,
                       'detached', case when p_detach is null then null else docs -> p_detach end));
end $$;
revoke execute on function ops_acct.split_draft(text, jsonb, int, text, jsonb) from public;
grant  execute on function ops_acct.split_draft(text, jsonb, int, text, jsonb) to authenticated;
comment on function ops_acct.split_draft(text, jsonb, int, text, jsonb) is
  'Records that documents of a ledger draft are not one transaction (0286, D445): every pair, or '
  'one document against the rest. The grouping never pairs them again. Nothing is resolved.';

analyze ops_acct.draft_decisions;
analyze ops_acct.draft_apart;
