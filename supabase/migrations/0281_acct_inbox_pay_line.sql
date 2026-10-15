-- 0281 — the sixth road out of verification: pay an approved request line
-- with the document that just arrived (L6, kajian §6.4).
--
-- The busiest path to the ledger is a transfer proof from Chat, and until
-- now it left verification by one of five roads, none of which named the
-- request behind it: the person booked a transaction and the PR line stayed
-- "approved, unpaid" until somebody allocated by hand — 1 of 86 Chat
-- payments in production pointed at a request (kajian §3). The road that
-- was missing is the obvious one: *this proof pays that approved line*.
--
-- Two functions, nothing new to store:
--
--   * `inbox_line_candidates(ref_id)` — the approved lines still owed money
--     (`v_line_coverage.remaining > 0`), ranked for this document: a line
--     named in the message (`pr-…-Lxx` in `extracted.caption` or `.note`)
--     first, then the reading's vendor, then an amount within tolerance,
--     newest decision first. Only a read; the person chooses.
--   * `book_evidence_to_line(ref_id, line_no, …)` — `post_from_line` with
--     the inbox document as the proof, and the inbox row(s) closed
--     CONFIRMED with `produced_trx_no` and `produced_pr_line_no`, in one
--     act. Vendor, project, item and the allocation come from the line
--     (0272); nothing is retyped.
--
-- D94 stands: buying first is still allowed, and the other five roads are
-- untouched. This one just makes the right thing the short thing.

-- ── which lines this document could be paying ────────────────────────────
create or replace function ops_acct.inbox_line_candidates(p_ref_id text, p_limit int default 20)
returns jsonb
language plpgsql security definer set search_path = ops_acct, ops_core, ops_procure, pg_temp as $$
declare
  row ops_acct.evidence_inbox;
  v_vendor text; v_amount numeric; v_text text; v_line text; v_rows jsonb;
begin
  if not ops_core.has_authority('resolve_inbox') then
    return ops_core.refused('accounting','inbox', p_ref_id,'line_candidates',
      'authority_required','Deciding what a document pays for belongs to Accounting.',
      jsonb_build_object('required','resolve_inbox'));
  end if;
  select * into row from ops_acct.evidence_inbox where ref_id = p_ref_id;
  if not found then
    return ops_core.not_found('accounting','inbox', p_ref_id,'line_candidates','No such inbox row.');
  end if;

  v_vendor := nullif(btrim(row.extracted ->> 'vendor_name'), '');
  v_amount := case when jsonb_typeof(row.extracted -> 'amount_idr') = 'number'
                   then (row.extracted ->> 'amount_idr')::numeric end;
  -- The message's own words: john-lau forwards the caption as
  -- `extracted.caption` (J1); until it does, the reading's `note` is what
  -- there is. A line number in either picks that line first.
  v_text := concat_ws(' ', row.extracted ->> 'caption', row.extracted ->> 'note');
  v_line := (regexp_match(v_text, '(pr-\d{2}-\d{2}-\d{2}_\d+-L\d{2})', 'i'))[1];
  if v_line is not null then
    v_line := regexp_replace(lower(v_line), '-l(\d{2})$', '-L\1');
  end if;

  with cand as (
    select l.line_no_full, l.description, d.doc_no,
           l.vendor_id, ven.name as vendor_name, pj.code as project_code, pj.name as project_name,
           cov.approved as approved_amount, cov.covered, cov.remaining,
           ap.recorded_by_email as approved_by, ap.recorded_at as approved_at, ap.channel as approval_channel,
           (v_line is not null and l.line_no_full = v_line) as caption_match,
           (v_vendor is not null and ven.name is not null
              and (ven.name ilike '%' || v_vendor || '%' or v_vendor ilike '%' || ven.name || '%')) as vendor_match,
           (v_amount is not null
              and abs(cov.remaining - v_amount) <= greatest(ops_core.money_tolerance(), v_amount * 0.02)) as amount_match
      from ops_procure.pr_lines l
      join ops_procure.pr_documents d on d.id = l.doc_id
      join ops_procure.v_line_approval ap on ap.line_id = l.id and ap.step = 'GOODS' and ap.approved
      join ops_procure.v_line_coverage cov on cov.line_id = l.id
      left join ops_procure.vendors  ven on ven.id = l.vendor_id
      left join ops_procure.projects pj  on pj.id = d.project_id
     where l.removed_at is null and cov.remaining > 0
  ), flagged as (
    -- When the reading's vendor matches any line, only those lines (and the
    -- one the caption names) are offered; when it matches none, or no vendor
    -- was read, every approved line still owed money is, newest first.
    select c.*, bool_or(c.vendor_match) over () as any_vendor from cand c
  ), picked as (
    select * from flagged f
     where f.caption_match or f.vendor_match or not f.any_vendor
     order by f.caption_match desc, f.vendor_match desc, f.amount_match desc, f.approved_at desc nulls last
     limit greatest(coalesce(p_limit, 20), 1)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'line_no', p.line_no_full, 'description', p.description, 'doc_no', p.doc_no,
           'vendor_id', p.vendor_id, 'vendor_name', p.vendor_name,
           'project_code', p.project_code, 'project_name', p.project_name,
           'approved_amount', p.approved_amount, 'covered', p.covered, 'remaining', p.remaining,
           'approved_by', p.approved_by, 'approved_at', p.approved_at, 'approval_channel', p.approval_channel,
           'caption_match', p.caption_match, 'vendor_match', p.vendor_match, 'amount_match', p.amount_match)
           order by p.caption_match desc, p.vendor_match desc, p.amount_match desc, p.approved_at desc nulls last), '[]'::jsonb)
    into v_rows
    from picked p;

  return ops_core.ok('accounting','inbox', p_ref_id,'line_candidates',
    jsonb_build_object('candidates', v_rows, 'caption_line', v_line,
                       'vendor_read', v_vendor, 'amount_read', v_amount));
end $$;
revoke execute on function ops_acct.inbox_line_candidates(text, int) from public;
grant  execute on function ops_acct.inbox_line_candidates(text, int) to authenticated;
comment on function ops_acct.inbox_line_candidates(text, int) is
  'The approved request lines still owed money, ranked for one inbox document (0281, L6): a '
  'line named in the caption/note first, then the reading''s vendor, then an amount within '
  'tolerance, newest decision first. resolve_inbox. A read; it decides nothing.';

-- ── paying the line with this document ───────────────────────────────────
create or replace function ops_acct.book_evidence_to_line(
  p_ref_id        text,
  p_line_no       text,
  p_account_code  text,
  p_amount        numeric,
  p_trx_date      date    default null,
  p_type_code     text    default 'SUPPLIERS',
  p_also_ref_ids  text[]  default null,
  p_key           text    default null)
returns jsonb
language plpgsql security definer set search_path = ops_acct, ops_core, ops_procure, pg_temp as $$
declare
  row ops_acct.evidence_inbox; refs text[]; n_found int; n_pending int;
  replayed jsonb; posted jsonb; trx text;
begin
  replayed := ops_core.idem_replay('accounting','book_evidence_to_line:' || coalesce(p_ref_id,''), p_key);
  if replayed is not null then return replayed; end if;

  if not ops_core.has_authority('post_ledger') then
    return ops_core.refused('accounting','inbox', p_ref_id,'book_to_line',
      'authority_required','Booking a document into the ledger belongs to Accounting.',
      jsonb_build_object('required','post_ledger'));
  end if;
  if not ops_core.has_authority('resolve_inbox') then
    return ops_core.refused('accounting','inbox', p_ref_id,'book_to_line',
      'authority_required','This also decides what the document belongs to, which belongs to Accounting.',
      jsonb_build_object('required','resolve_inbox'));
  end if;
  if coalesce(btrim(p_line_no), '') = '' then
    return ops_core.invalid('accounting','inbox', p_ref_id,'book_to_line',
      'line_required','Say which approved request line this document pays.',
      jsonb_build_object('field','line_no'));
  end if;

  -- The head row and the other rows of the same photo (0161), locked so two
  -- screens cannot both get past the PENDING check.
  select coalesce(array_agg(r order by ord), '{}') into refs
    from (select distinct on (btrim(r)) btrim(r) as r, ord
            from unnest(array[p_ref_id] || coalesce(p_also_ref_ids, '{}')) with ordinality as u(r, ord)
           where coalesce(btrim(r), '') <> ''
           order by btrim(r), ord) d;
  perform 1 from ops_acct.evidence_inbox where ref_id = any(refs) order by ref_id for update;

  select * into row from ops_acct.evidence_inbox where ref_id = p_ref_id;
  if not found then
    return ops_core.not_found('accounting','inbox', p_ref_id,'book_to_line','No such inbox row.');
  end if;
  select count(*), count(*) filter (where status = 'PENDING') into n_found, n_pending
    from ops_acct.evidence_inbox where ref_id = any(refs);
  if n_found <> cardinality(refs) then
    return ops_core.not_found('accounting','inbox', p_ref_id,'book_to_line',
      format('%s of the %s inbox rows named do not exist.', cardinality(refs) - n_found, cardinality(refs)));
  end if;
  if n_pending <> n_found then
    return ops_core.conflict('accounting','inbox', p_ref_id,'book_to_line',
      'already_resolved', format('This document is already %s — nothing changed.', row.status));
  end if;

  -- One act: the ledger row, its line from the request, the allocation, and
  -- this document as the proof. `post_from_line` owns every rule about the
  -- line and the money (0141, 0272); its refusals are relayed whole.
  posted := ops_acct.post_from_line(
    p_line_no       => p_line_no,
    p_amount        => p_amount,
    p_account_code  => p_account_code,
    p_type_code     => coalesce(nullif(btrim(p_type_code), ''), 'SUPPLIERS'),
    p_attachment_id => row.attachment_id,
    p_trx_date      => p_trx_date,
    p_document_kind => ops_core.doc_kind_from_reading(row.extracted)::text,
    p_key           => null);
  if not ops_core.said_ok(posted) then
    return posted;
  end if;
  trx := posted -> 'data' ->> 'trx_no';

  update ops_acct.evidence_inbox
     set status              = 'CONFIRMED',
         produced_trx_no     = trx,
         produced_pr_line_no = p_line_no,
         resolved_by         = auth.uid(),
         resolved_at         = now()
   where ref_id = any(refs);

  return ops_core.idem_remember('accounting','book_evidence_to_line:' || p_ref_id, p_key,
    ops_core.ok('accounting','inbox', p_ref_id,'book_to_line',
      jsonb_build_object('trx_no', trx, 'pr_line_no', p_line_no, 'amount', p_amount,
                         'rows', cardinality(refs)),
      to_jsonb(row),
      jsonb_build_object('status','CONFIRMED','trx_no', trx, 'pr_line_no', p_line_no)));
end $$;
revoke execute on function ops_acct.book_evidence_to_line(text, text, text, numeric, date, text, text[], text) from public;
grant  execute on function ops_acct.book_evidence_to_line(text, text, text, numeric, date, text, text[], text) to authenticated;
comment on function ops_acct.book_evidence_to_line(text, text, text, numeric, date, text, text[], text) is
  'Verification''s sixth road (0281, L6): pay an approved request line with this inbox document as '
  'the proof — post_from_line, then the inbox row(s) CONFIRMED with produced_trx_no and '
  'produced_pr_line_no. post_ledger + resolve_inbox. 409 already_resolved; post_from_line''s own refusals relayed.';
