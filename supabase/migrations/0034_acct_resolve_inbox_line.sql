-- 0034_acct_resolve_inbox_line.sql — the road that writes a request line can
-- finally say which one.
--
-- ── What was missing ─────────────────────────────────────────────────────
--
-- `evidence_inbox.produced_pr_line_no` has existed since `0019` and nothing
-- has ever written it. `resolve_inbox` takes a `trx_no` and no line number, so
-- the `retro_pr_line` road — somebody bought first, a request line is written
-- after the fact, then it is paid — records the transaction and forgets the
-- line. The screen has been passing `pr_line_no` all along
-- (`accounting/verifikasi/page.tsx`); it had nowhere to go.
--
-- The cost is not theoretical. *Which line did that photo become?* is the
-- question the inbox history exists to answer, and `retro_pr_line` is the one
-- road where the answer is not obvious from anywhere else: the line was
-- created for this document and nothing else points back at it.
--
-- ── Dropped and recreated, not `create or replace` ───────────────────────
--
-- Adding a parameter changes the signature, and `create or replace` with a new
-- argument list creates a *second* function rather than replacing the first.
-- Both would then match a named-argument call, and PostgREST would answer
-- `PGRST203` — could not choose the best candidate — for every resolve. So the
-- old one goes first, and its grant is written again below, because dropping a
-- function drops its grants with it.
--
-- ── `NOTED` now needs its words too ──────────────────────────────────────
--
-- `0021` required a reason for `REJECTED` and not for `NOTED`, while the demo
-- has required both since D94. That is a parity gap, and the demo is right:
-- *this is not a company transaction* with no explanation is a file in a
-- drawer, and it is read months later by somebody who was not in the room.
--
-- Safe to tighten now — the inbox holds 38 rows and every one of them is
-- PENDING, so no existing row was resolved under the looser rule.

drop function if exists ops_acct.resolve_inbox(text, ops_acct.inbox_status_t, text, text, text);

create function ops_acct.resolve_inbox(
  p_ref_id     text,
  p_status     ops_acct.inbox_status_t,
  p_trx_no     text default null,
  p_pr_line_no text default null,
  p_note       text default null,
  p_key        text default null)
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
