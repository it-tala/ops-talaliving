-- 0279 — the document a line was read from (L11, kajian §6.7).
--
-- A row's evidence stays the row's: the nota, the transfer proof and the
-- goods photo hang on the transaction (`attachment_links`), never on a line.
-- What a line can say is **which** of those papers it came from —
-- `transaction_lines.attachment_id`, nullable, and only ever one of the
-- documents already attached to its row (the seam checks). Booking from
-- the inbox fills it by itself: the lines of a captured document point at
-- that document. Anyone who posts the ledger can point lines by hand from
-- the drawer or the re-detailing screen. No new link entity, no new
-- evidence road: a pointer, checked, nothing more.

alter table ops_acct.transaction_lines
  add column if not exists attachment_id uuid references ops_core.attachments(id);
comment on column ops_acct.transaction_lines.attachment_id is
  'The document this line was read from — one of the row''s own attachments (set_line_evidence '
  'refuses any other), or null. The evidence itself stays on the transaction (0279, L11).';
create index if not exists trx_lines_attachment_idx on ops_acct.transaction_lines (attachment_id)
  where attachment_id is not null;

-- ── the seam: point lines at the row's documents ─────────────────────────
-- `p_pointers`: [{"line_no": 1, "attachment_id": "<uuid>" | null}, …]. A
-- line not named keeps what it has; null clears. The row's money, lines
-- and documents are untouched — a pointer is the one thing that changes.
create or replace function ops_acct.set_line_evidence(
  p_trx_no   text,
  p_pointers jsonb,
  p_key      text default null)
returns jsonb
language plpgsql security definer set search_path = ops_acct, ops_core, pg_temp as $$
declare
  t ops_acct.transactions; v_bad text; v_before jsonb; v_after jsonb; v_n int := 0;
  replayed jsonb; res jsonb; v_p jsonb; v_att uuid; v_line_no int;
begin
  replayed := ops_core.idem_replay('accounting', 'set_line_evidence:' || coalesce(p_trx_no, ''), p_key);
  if replayed is not null then return replayed; end if;

  if not ops_core.has_authority('post_ledger') then
    return ops_core.refused('accounting','transaction', p_trx_no,'set_line_evidence',
      'authority_required','Pointing a line at its document belongs to whoever posts the ledger.');
  end if;
  select * into t from ops_acct.transactions where trx_no = p_trx_no;
  if not found then
    return ops_core.not_found('accounting','transaction', p_trx_no,'set_line_evidence','No such transaction.');
  end if;
  if t.status = 'VOID' then
    return ops_core.conflict('accounting','transaction', p_trx_no,'set_line_evidence',
      'transaction_void','A void row is history; its lines are not pointed anywhere.');
  end if;
  if p_pointers is null or jsonb_typeof(p_pointers) <> 'array' or jsonb_array_length(p_pointers) = 0 then
    return ops_core.invalid('accounting','transaction', p_trx_no,'set_line_evidence',
      'pointers_required','Say which line points at which document.',
      jsonb_build_object('field','pointers'));
  end if;

  -- every line named exists on this row
  select string_agg(p ->> 'line_no', ', ') into v_bad
    from jsonb_array_elements(p_pointers) p
   where nullif(p ->> 'line_no', '') is null
      or not exists (select 1 from ops_acct.transaction_lines l
                      where l.trx_id = t.id and l.line_no = (p ->> 'line_no')::int);
  if v_bad is not null then
    return ops_core.invalid('accounting','transaction', p_trx_no,'set_line_evidence',
      'no_such_line', format('%s has no line %s.', p_trx_no, v_bad),
      jsonb_build_object('field','pointers','line_no', v_bad));
  end if;
  -- every document named is one of the row's own live attachments
  select string_agg(p ->> 'attachment_id', ', ') into v_bad
    from jsonb_array_elements(p_pointers) p
   where nullif(p ->> 'attachment_id', '') is not null
     and not exists (select 1 from ops_core.attachment_links k
                      where k.entity = 'transaction' and k.entity_no = p_trx_no
                        and k.attachment_id = (p ->> 'attachment_id')::uuid and k.unlinked_at is null);
  if v_bad is not null then
    return ops_core.invalid('accounting','transaction', p_trx_no,'set_line_evidence',
      'document_not_attached',
      'A line can only point at a document that is attached to its own row. Attach the file first.',
      jsonb_build_object('field','pointers','attachment_id', v_bad));
  end if;

  select jsonb_object_agg(l.line_no, l.attachment_id) into v_before
    from ops_acct.transaction_lines l where l.trx_id = t.id;

  for v_p in select * from jsonb_array_elements(p_pointers) loop
    v_line_no := (v_p ->> 'line_no')::int;
    v_att := nullif(v_p ->> 'attachment_id', '')::uuid;
    update ops_acct.transaction_lines
       set attachment_id = v_att
     where trx_id = t.id and line_no = v_line_no and attachment_id is distinct from v_att;
    if found then v_n := v_n + 1; end if;
  end loop;

  select jsonb_object_agg(l.line_no, l.attachment_id) into v_after
    from ops_acct.transaction_lines l where l.trx_id = t.id;

  if v_n = 0 then
    return ops_core.noop('accounting','transaction', p_trx_no,'set_line_evidence','Nothing changed.',
      jsonb_build_object('trx_no', p_trx_no, 'changed', 0));
  end if;
  res := ops_core.ok('accounting','transaction', p_trx_no,'set_line_evidence',
    jsonb_build_object('trx_no', p_trx_no, 'changed', v_n), v_before, v_after);
  return ops_core.idem_remember('accounting', 'set_line_evidence:' || p_trx_no, p_key, res);
end $$;
revoke execute on function ops_acct.set_line_evidence(text, jsonb, text) from public;
grant  execute on function ops_acct.set_line_evidence(text, jsonb, text) to authenticated;
comment on function ops_acct.set_line_evidence(text, jsonb, text) is
  'Points a row''s lines at the row''s own documents (0279, L11): [{line_no, attachment_id|null}]. '
  'post_ledger. 409 transaction_void; 422 pointers_required, no_such_line, document_not_attached.';

-- ── booking from the inbox fills it by itself ────────────────────────────
-- 0276's body with one statement after the post: the lines of a captured
-- document point at that document.
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
  -- The lines came from this document: every one points at it (0279, L11).
  update ops_acct.transaction_lines l
     set attachment_id = row.attachment_id
    from ops_acct.transactions t
   where t.trx_no = trx and l.trx_id = t.id and l.attachment_id is null;

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

-- ── the views carry it ───────────────────────────────────────────────────
create or replace view ops_acct.v_transaction_line as
  select l.id, l.trx_id, t.trx_no, l.line_no, l.kind, l.item_id,
         i.code as item_code, i.name as item_name,
         l.description, l.qty, l.uom, l.unit_price, l.amount,
         l.attachment_id
    from ops_acct.transaction_lines l
    join ops_acct.transactions t on t.id = l.trx_id
    join ops_acct.accounts acc on acc.id = t.account_id
    left join ops_procure.items i on i.id = l.item_id
   where ops_acct.account_rows_readable(acc.custody);
alter view ops_acct.v_transaction_line set (security_invoker = on);
grant select on ops_acct.v_transaction_line to authenticated;

-- 0274's body; `lines[]` gains `attachment_id`.
create or replace view ops_acct.v_transaction_detail as
  select v.id, v.trx_no, v.trx_date, v.account_id, v.account_code, v.direction, v.amount_idr,
         v.type_code, v.vendor_id, v.vendor_name, v.project_id, v.project_code, v.description,
         v.remark, v.status, v.source_ref, v.posted_by, v.posted_by_name, v.posted_at,
         v.void_reason, v.void_at, v.allocated_total, v.unallocated, v.evidence_count,
         v.has_payment_proof, v.has_receipt_doc, v.pr_line_nos, v.po_nos, v.expects_allocation,
         v.balance_before, v.balance_after,
         coalesce(li.lines, '[]'::jsonb)       as lines,
         coalesce(ac.allocations, '[]'::jsonb) as allocations,
         coalesce(dc.documents, '[]'::jsonb)   as documents,
         t.billed_currency,
         t.billed_amount,
         t.lines_reviewed_at,
         rb.full_name as lines_reviewed_by_name,
         v.category,
         v.category_override
    from ops_acct.v_transaction v
    join ops_acct.transactions t on t.id = v.id
    left join ops_core.users rb on rb.id = t.lines_reviewed_by
    left join lateral (
      select jsonb_agg(jsonb_build_object(
               'id', l.id, 'trx_id', l.trx_id,
               'line_no', l.line_no, 'kind', l.kind, 'item_id', l.item_id,
               'item_code', i.code, 'item_name', i.name,
               'attachment_id', l.attachment_id,
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

grant execute on function
  ops_acct.book_evidence(text, text, ops_acct.direction_t, numeric, text, text, date, text, text, jsonb, text, text)
  to authenticated;

analyze ops_acct.transaction_lines;
