-- 0101_acct_edit_transaction.sql — correcting a ledger row in place, on the
-- record.
--
-- Until now the only correction was VOID and post again (A5). The owner's
-- instruction (2026-09-23): the ledger must let Accounting fix a row's amount
-- and its description directly. **An amount change carries a remark**, and
-- every edit lands in the IT audit log with the value before and after.
--
-- What stays refused, and why:
--   * a VOID row: it already says what was once believed, and editing it
--     would rewrite that;
--   * an amount below what the row has already been applied to (A9: a
--     transaction never funds more than it moved);
--   * an amount change on a row matched or booked against a bank statement
--     line: there the bank's number is the record, so the match is undone
--     first rather than contradicted.

-- ── 1. the receiving report's label and drive ────────────────────────────
-- The enum value arrived in `0100`. Every kind has a label (`0005`) and a
-- drive (`0035`); a receiving report is filed with the goods photos and
-- delivery notes, in Procurement's drive.
insert into ops_core.doc_kind_labels (kind, label)
values ('receiving_report', 'Receiving Report')
on conflict (kind) do nothing;

insert into ops_core.doc_kind_drive (kind, slug, rationale)
values ('receiving_report', 'procurement', 'What arrived, signed at the door — filed with the goods photos and delivery notes.')
on conflict (kind) do nothing;

-- ── 2. the edit seam ─────────────────────────────────────────────────────
--
-- Either field may be left null to keep it. The remark goes into the audit
-- row's `reason` — the same column a void's reason goes to — and the change
-- itself into `detail`, which is what the ledger drawer's History and IT's
-- Audit Log both read. `before`/`after` carry the full pair as well.
--
-- A row itemised as a single line whose amount equals the old total has that
-- line moved with it (1216 of the 1217 itemised rows, 2026-09-23), and its
-- unit price re-derived when it had one, so the line never silently
-- disagrees with its own row. Any other shape keeps its lines, and the audit
-- detail says so.
create or replace function ops_acct.edit_transaction(
  p_trx_no text,
  p_amount numeric default null,
  p_description text default null,
  p_reason text default null,
  p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_acct, ops_core, pg_temp as $$
declare
  t ops_acct.transactions; l ops_acct.transaction_lines;
  v_amount numeric; v_desc text; v_reason text; v_alloc numeric;
  v_lines int; v_synced boolean := false;
  v_before jsonb := '{}'::jsonb; v_after jsonb := '{}'::jsonb; v_detail jsonb := '{}'::jsonb;
  replayed jsonb; res jsonb;
begin
  replayed := ops_core.idem_replay('accounting','edit:' || p_trx_no, p_key);
  if replayed is not null then return replayed; end if;

  if not ops_core.has_authority('post_ledger') then
    return ops_core.refused('accounting','transaction', p_trx_no,'edit',
      'authority_required','Editing a ledger row belongs to Accounting.');
  end if;

  select * into t from ops_acct.transactions where trx_no = p_trx_no;
  if not found then
    return ops_core.not_found('accounting','transaction', p_trx_no,'edit','No such transaction.');
  end if;
  if t.status = 'VOID' then
    return ops_core.conflict('accounting','transaction', p_trx_no,'edit',
      'transaction_void', format('%s is VOID — a void row is not edited. Post a new one.', p_trx_no));
  end if;

  if p_description is not null and btrim(p_description) = '' then
    return ops_core.invalid('accounting','transaction', p_trx_no,'edit',
      'description_required','The description cannot be empty.',
      jsonb_build_object('field','description'));
  end if;
  if p_amount is not null and p_amount <= 0 then
    return ops_core.invalid('accounting','transaction', p_trx_no,'edit',
      'amount_positive','The amount must be greater than zero. Direction is its own field.',
      jsonb_build_object('field','amount'));
  end if;

  v_amount := coalesce(p_amount, t.amount_idr);
  v_desc   := coalesce(btrim(p_description), t.description);
  v_reason := nullif(btrim(p_reason), '');

  if v_amount = t.amount_idr and v_desc = t.description then
    return ops_core.noop('accounting','transaction', p_trx_no,'edit',
      'Nothing changed.', jsonb_build_object('trx_no', p_trx_no));
  end if;

  if v_amount <> t.amount_idr then
    if v_reason is null then
      return ops_core.invalid('accounting','transaction', p_trx_no,'edit',
        'reason_required','A remark is required when the amount changes — say why the number was wrong.',
        jsonb_build_object('field','reason'));
    end if;

    select coalesce(sum(amount), 0) into v_alloc
      from ops_acct.payment_allocations
     where trx_id = t.id and superseded_by is null;
    if v_alloc > v_amount then
      return ops_core.conflict('accounting','transaction', p_trx_no,'edit',
        'below_allocated',
        format('Rp %s of this row is already applied to requests; the amount cannot go below that.',
               to_char(v_alloc, 'FM999G999G999G999')),
        jsonb_build_object('field','amount','allocated', v_alloc, 'attempted', v_amount));
    end if;

    if exists (select 1 from ops_acct.statement_lines
                where trx_no = p_trx_no and status in ('matched','booked')) then
      return ops_core.conflict('accounting','transaction', p_trx_no,'edit',
        'statement_matched',
        'This row is matched to a bank statement line, so the bank''s amount is the record. Unmatch it first.',
        jsonb_build_object('field','amount'));
    end if;

    select count(*) into v_lines from ops_acct.transaction_lines where trx_id = t.id;
    if v_lines = 1 then
      select * into l from ops_acct.transaction_lines where trx_id = t.id;
      if l.amount = t.amount_idr then
        update ops_acct.transaction_lines
           set amount = v_amount,
               unit_price = case when l.qty is not null and l.unit_price is not null
                                 then round(v_amount / l.qty, 2) else l.unit_price end
         where id = l.id;
        v_synced := true;
      end if;
    end if;

    v_before := v_before || jsonb_build_object('amount_idr', t.amount_idr);
    v_after  := v_after  || jsonb_build_object('amount_idr', v_amount);
    v_detail := v_detail || jsonb_build_object(
      'amount_before', t.amount_idr, 'amount_after', v_amount,
      'lines', case when v_lines = 0 then 'none'
                    when v_synced then 'updated' else 'unchanged' end);
  end if;

  if v_desc <> t.description then
    v_before := v_before || jsonb_build_object('description', t.description);
    v_after  := v_after  || jsonb_build_object('description', v_desc);
    v_detail := v_detail || jsonb_build_object(
      'description_before', t.description, 'description_after', v_desc);
  end if;

  update ops_acct.transactions
     set amount_idr = v_amount, description = v_desc
   where id = t.id;

  perform ops_core.emit('accounting','accounting.transaction.edited', p_trx_no,
    jsonb_build_object('trx_no', p_trx_no, 'before', v_before, 'after', v_after,
                       'reason', v_reason));

  res := ops_core.say('accounting','transaction', p_trx_no,'edit','ok', 200,
    null, v_reason,
    jsonb_build_object('trx_no', p_trx_no, 'amount_idr', v_amount, 'description', v_desc),
    v_detail, v_before, v_after);
  return ops_core.idem_remember('accounting','edit:' || p_trx_no, p_key, res);
end $$;

grant execute on function ops_acct.edit_transaction(text, numeric, text, text, text) to authenticated;

-- ── 3. attaching and detaching say *what* ────────────────────────────────
--
-- `0024`'s two seams already wrote an audit row, but an empty one: the trail
-- said a document was linked, not which one or as what. Same bodies, with the
-- entity, the kind and the file name in `detail`, so "a nota was taken off
-- this row" can be read from the log without joining anything.
create or replace function ops_core.attach_link(
  p_attachment_id uuid,
  p_entity text,
  p_entity_no text,
  p_kind text,
  p_note text default null,
  p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_core, pg_temp as $$
declare v_entity ops_core.link_entity_t; v_kind ops_core.doc_kind_t;
        v_id uuid; v_file text; res jsonb; replayed jsonb;
begin
  replayed := ops_core.idem_replay('documents',
    'attach_link:' || coalesce(p_attachment_id::text,'') || ':' || coalesce(p_entity_no,''), p_key);
  if replayed is not null then return replayed; end if;

  select filename into v_file from ops_core.attachments where id = p_attachment_id;
  if not found then
    return ops_core.not_found('documents','attachment', p_attachment_id::text,'attach_link',
      'File not found.');
  end if;

  begin
    v_entity := (case p_entity
                   when 'po' then 'purchase_order'
                   when 'overtime' then 'overtime_sheet'
                   else p_entity
                 end)::ops_core.link_entity_t;
  exception when invalid_text_representation then
    return ops_core.invalid('documents','attachment', p_entity_no,'attach_link',
      'unknown_entity', format('Nothing here is attached to a %s.', p_entity),
      jsonb_build_object('field','entity','given', p_entity));
  end;

  select kind into v_kind from ops_core.doc_kind_labels where label = p_kind;
  if v_kind is null then
    begin
      v_kind := p_kind::ops_core.doc_kind_t;
    exception when invalid_text_representation then
      return ops_core.invalid('documents','attachment', p_entity_no,'attach_link',
        'unknown_kind', format('"%s" is not a kind of document this system files.', p_kind),
        jsonb_build_object('field','kind','given', p_kind));
    end;
  end if;

  insert into ops_core.attachment_links (attachment_id, entity, entity_no, kind, note, linked_by)
  values (p_attachment_id, v_entity, btrim(p_entity_no), v_kind, nullif(btrim(p_note), ''), auth.uid())
  on conflict do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from ops_core.attachment_links
     where attachment_id = p_attachment_id and entity = v_entity
       and entity_no = btrim(p_entity_no) and kind = v_kind and unlinked_at is null;
    return ops_core.noop('documents','attachment', p_entity_no,'attach_link',
      'That document is already on this record under the same kind.',
      jsonb_build_object('link_id', v_id, 'attachment_id', p_attachment_id));
  end if;

  perform ops_core.emit('documents','documents.attachment.linked', btrim(p_entity_no),
    jsonb_build_object('link_id', v_id, 'attachment_id', p_attachment_id,
                       'entity', v_entity, 'kind', v_kind));

  res := ops_core.say('documents','attachment', btrim(p_entity_no),'attach_link','ok', 200,
    null, null,
    jsonb_build_object('link_id', v_id, 'attachment_id', p_attachment_id),
    jsonb_build_object('entity', v_entity, 'kind', v_kind, 'file', v_file));
  return ops_core.idem_remember('documents',
    'attach_link:' || p_attachment_id::text || ':' || coalesce(p_entity_no,''), p_key, res);
end $$;

create or replace function ops_core.attach_unlink(
  p_link_id uuid,
  p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_core, pg_temp as $$
declare l ops_core.attachment_links; v_file text; res jsonb; replayed jsonb;
begin
  replayed := ops_core.idem_replay('documents','attach_unlink:' || coalesce(p_link_id::text,''), p_key);
  if replayed is not null then return replayed; end if;

  select * into l from ops_core.attachment_links where id = p_link_id;
  if not found then
    return ops_core.not_found('documents','attachment', p_link_id::text,'attach_unlink',
      'That document is not attached here.');
  end if;
  if l.unlinked_at is not null then
    return ops_core.noop('documents','attachment', l.entity_no,'attach_unlink',
      'That document was already taken off this record.',
      jsonb_build_object('link_id', l.id));
  end if;

  update ops_core.attachment_links
     set unlinked_at = now(), unlinked_by = auth.uid()
   where id = p_link_id;

  select filename into v_file from ops_core.attachments where id = l.attachment_id;

  perform ops_core.emit('documents','documents.attachment.unlinked', l.entity_no,
    jsonb_build_object('link_id', l.id, 'attachment_id', l.attachment_id,
                       'entity', l.entity, 'kind', l.kind));

  res := ops_core.say('documents','attachment', l.entity_no,'attach_unlink','ok', 200,
    null, null,
    jsonb_build_object('link_id', l.id),
    jsonb_build_object('entity', l.entity, 'kind', l.kind, 'file', v_file));
  return ops_core.idem_remember('documents','attach_unlink:' || p_link_id::text, p_key, res);
end $$;
