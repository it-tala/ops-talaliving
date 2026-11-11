-- 0287_acct_resolve_inbox_argument_order.sql — production's resolve_inbox
-- reads its arguments in the order 0039 was written to forbid.
--
-- ── What was found (2026-11-11) ──────────────────────────────────────────
--
-- `0039` appended `p_pr_line_no` LAST and spent a page of its header saying
-- why: a defaulted parameter slotted in beside `p_trx_no` reassigns every
-- positional call after it. CI caught that draft within the minute. The
-- ladder has the fixed version. **Production does not**: it carries
--
--     resolve_inbox(p_ref_id, p_status, p_trx_no, p_pr_line_no, p_note, p_key)
--
-- — the draft CI refused, applied on 2026-09-21 before the fix landed and
-- never replaced, because the fix kept the same file and the same version.
--
-- It stayed invisible for seven weeks because every caller in the app and in
-- the database passes arguments **by name** (`src/lib/api/accounting.ts`,
-- `dismiss_draft` in `0286`). It surfaced the first time somebody called it
-- positionally against production: the ledger cross-check of 11 Nov tried to
-- mark seven balance screenshots NOTED with
--
--     resolve_inbox(ref_id, 'NOTED', null, 'Screenshot saldo rekening …', key)
--
-- and all seven came back `refused`, `no_such_line: There is no request line
-- …` — the exact message `0039`'s header quotes as the thing it prevented.
--
-- ── Dropped and created, not replaced ────────────────────────────────────
--
-- Both orders have the same argument TYPES (text, status, text×4), so they
-- are one function to Postgres, and `create or replace` cannot rename an
-- input parameter. Drop, create, grant again (a drop takes the grant with it).
-- On the local ladder, where `0039` already made the right order, this is a
-- no-op rebuild of the same function. The body is `0039`'s, unchanged.

drop function if exists ops_acct.resolve_inbox(text, ops_acct.inbox_status_t, text, text, text, text);

create function ops_acct.resolve_inbox(
  p_ref_id     text,
  p_status     ops_acct.inbox_status_t,
  p_trx_no     text default null,
  p_note       text default null,
  p_key        text default null,
  -- Appended, not slotted in beside `p_trx_no`. See the header.
  p_pr_line_no text default null)
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
    insert into ops_core.attachment_links (attachment_id, entity, entity_no, kind, linked_by)
    values (row.attachment_id, 'transaction', p_trx_no,
            coalesce((row.extracted ->> 'doc_kind')::ops_core.doc_kind_t, 'nota'), auth.uid())
    on conflict do nothing;
  end if;

  -- A line number that names no line is worse than none: it reads as an answer.
  if coalesce(btrim(p_pr_line_no), '') <> ''
     and not exists (select 1 from ops_procure.pr_lines l
                      where l.line_no_full = btrim(p_pr_line_no)) then
    return ops_core.invalid('accounting','inbox', p_ref_id,'resolve',
      'no_such_line', format('There is no request line %s.', p_pr_line_no),
      jsonb_build_object('field','pr_line_no'));
  end if;

  if p_status in ('REJECTED','NOTED') and coalesce(btrim(p_note), '') = '' then
    return ops_core.invalid('accounting','inbox', p_ref_id,'resolve',
      'reason_required',
      case p_status
        when 'REJECTED' then 'Say why it is not ours, so whoever sent it knows what to do.'
        else 'Say what this is. A note with no words is a file in a drawer.'
      end,
      jsonb_build_object('field','note'));
  end if;

  update ops_acct.evidence_inbox
     set status = p_status,
         produced_trx_no = p_trx_no,
         produced_pr_line_no = nullif(btrim(coalesce(p_pr_line_no, '')), ''),
         resolved_by = auth.uid(), resolved_at = now(),
         resolve_note = nullif(btrim(p_note), '')
   where id = row.id;

  perform ops_core.emit('accounting','accounting.inbox.resolved', p_ref_id,
    jsonb_build_object('ref_id', p_ref_id, 'status', p_status,
                       'trx_no', p_trx_no, 'pr_line_no', p_pr_line_no));

  res := ops_core.ok('accounting','inbox', p_ref_id,'resolve',
    jsonb_build_object('ref_id', p_ref_id, 'status', p_status,
                       'trx_no', p_trx_no, 'pr_line_no', p_pr_line_no),
    to_jsonb(row.status), to_jsonb(p_status));
  return ops_core.idem_remember('accounting','resolve_inbox:' || p_ref_id, p_key, res);
end $$;

grant execute on function
  ops_acct.resolve_inbox(text, ops_acct.inbox_status_t, text, text, text, text)
  to authenticated;

revoke execute on function
  ops_acct.resolve_inbox(text, ops_acct.inbox_status_t, text, text, text, text)
  from public;

comment on function
  ops_acct.resolve_inbox(text, ops_acct.inbox_status_t, text, text, text, text) is
  'Resolve one evidence_inbox row. Argument order is (ref_id, status, trx_no, note, key, '
  'pr_line_no): pr_line_no is LAST so positional callers keep their meaning (0039, 0287).';
