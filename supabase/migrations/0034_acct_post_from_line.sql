-- 0034_acct_post_from_line.sql — paying a request line.
--
-- ── The screen that has no way to pay ─────────────────────────────────────
--
-- `/procurement/pr` is *the working surface — asking, correcting, documenting,
-- paying* (D74), and `/procurement/meeting` is where the room decides. Both are
-- dark in live mode, and between them they were waiting on two functions. One
-- of them, `accounting.postFromLine`, had **no seam, no client function and no
-- row anywhere**: paying an approved request was a thing the database could not
-- do at all.
--
-- ── It composes; it does not re-implement ─────────────────────────────────
--
-- Everything this needs exists. `post_transaction` writes the ledger row with
-- its documents and its itemisation and refuses without `post_ledger` (D85);
-- `allocate_payment` ties money to what it paid for. A third money path that
-- did both again would be a second definition of *what a posting is*, and the
-- two would disagree the first time either was corrected.
--
-- So this reads the line, fills in what the line knows, and calls them in
-- order. What it adds is the part neither could know on its own: **which
-- procurement line this money is for**, and the refusals that only make sense
-- with that line in hand.
--
-- ── Why the trail gets two rows ───────────────────────────────────────────
--
-- `post_transaction` writes `post` and `allocate_payment` writes `allocate`, so
-- one click leaves two audit rows. That is not noise. They are two facts — the
-- money left the account, and it was counted against this line — and they can
-- come apart: a payment can be posted and allocated wrongly, or allocated later
-- by somebody else. Collapsing them into one row would make the second
-- unanswerable.


-- ── one vocabulary for what a document is called ─────────────────────────
--
-- `ops_core.doc_kind_labels` maps *"Payment Proof"* to `transfer_proof`, and
-- `attach_link` has resolved through it since `0024`: **the label, to the
-- code. One vocabulary, and this is where it is enforced.**
--
-- `post_transaction` did not. It compared `d ->> 'kind'` against four codes
-- directly — and the TypeScript `DocKind` that every screen passes is the
-- *label*. So `accounting.postTransaction` against the real database refused
-- every posting it made, with a nota attached, saying there was no evidence.
-- A money path, failing closed, in a function `check-api-parity.mjs` counts as
-- matching because its signature is right.
--
-- Nobody has met it: `/accounting/ledger` is dark waiting on `documents.upload`.
-- That is the fourth time in three days that a live-client call has been wrong
-- in a way only a real request could reveal, and the third that a dark route
-- is all that stood between it and somebody's afternoon.
--
-- So the resolution becomes a function, both seams call it, and neither can
-- drift. It answers null for a kind nobody has heard of — a caller that wants
-- to refuse says so in its own words, which is what each of them does.

create or replace function ops_core.doc_kind_of(p_kind text)
returns ops_core.doc_kind_t
language plpgsql immutable set search_path = ops_core, pg_temp as $$
declare v_kind ops_core.doc_kind_t;
begin
  if p_kind is null then return null; end if;
  select kind into v_kind from ops_core.doc_kind_labels where label = p_kind;
  if v_kind is not null then return v_kind; end if;
  begin
    return p_kind::ops_core.doc_kind_t;   -- a code is accepted too
  exception when invalid_text_representation then
    return null;
  end;
end $$;

grant execute on function ops_core.doc_kind_of(text) to authenticated;

comment on function ops_core.doc_kind_of(text) is
  'The label or the code, to the code — null for neither. One definition, so attach_link and '
  'post_transaction cannot disagree about what a kind of document is called. (0034)';

-- Restated whole, because `create or replace function` takes a complete body
-- and `0021` has been applied. Two lines differ; they are marked below.

create or replace function ops_acct.post_transaction(
  p_account_code text,
  p_direction ops_acct.direction_t,
  p_amount numeric,
  p_type_code text,
  p_description text,
  p_documents jsonb,                   -- [{"attachment_id":…,"kind":"nota"}]
  p_trx_date date default null,
  p_vendor_code text default null,
  p_project_code text default null,
  p_lines jsonb default '[]'::jsonb,   -- [{"description":…,"qty":…,"unit_price":…,"amount":…}]
  p_remark text default null,
  p_source_ref text default null,
  p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_acct, ops_core, ops_procure, pg_temp as $$
declare
  acc ops_acct.accounts; ty ops_acct.transaction_types;
  ven uuid; proj uuid; v_trx_no text; v_trx_id uuid;
  has_primary boolean; n_lines int; lines_total numeric; missing text;
  src text; existing text; replayed jsonb; res jsonb;
begin
  replayed := ops_core.idem_replay('accounting','post_transaction', p_key);
  if replayed is not null then return replayed; end if;

  if not ops_core.has_authority('post_ledger') then
    return ops_core.refused('accounting','transaction', p_source_ref,'post',
      'authority_required',
      'Posting to the ledger belongs to Accounting — logged, not applied.',
      jsonb_build_object('required','post_ledger','attempted_amount', p_amount));
  end if;

  if p_amount is null or p_amount <= 0 then
    return ops_core.invalid('accounting','transaction', p_source_ref,'post',
      'amount_positive',
      'Amount must be greater than zero. Direction lives in the IN/OUT column.',
      jsonb_build_object('field','amount_idr'));
  end if;
  if coalesce(btrim(p_description), '') = '' then
    return ops_core.invalid('accounting','transaction', p_source_ref,'post',
      'description_required','Description is required.',
      jsonb_build_object('field','description'));
  end if;

  select * into acc from ops_acct.accounts where code = p_account_code;
  if not found then
    return ops_core.invalid('accounting','transaction', p_source_ref,'post',
      'no_such_account', format('There is no account %s.', p_account_code),
      jsonb_build_object('field','account_code'));
  end if;
  select * into ty from ops_acct.transaction_types where code = p_type_code;
  if not found then
    return ops_core.invalid('accounting','transaction', p_source_ref,'post',
      'no_such_type', format('There is no transaction type %s.', p_type_code),
      jsonb_build_object('field','type_code'));
  end if;

  -- The evidence rule. Supporting documents — a delivery note, the PO — are
  -- welcome and cannot stand alone: none of them says *this money moved for
  -- this reason*. A row with no primary document is a number somebody typed.
  -- **Through `doc_kind_of`, not against raw strings.** This used to compare
  -- `d ->> 'kind'` to four codes, and the TypeScript `DocKind` is the *label* —
  -- "Payment Proof", not `transfer_proof`. So the live client refused every
  -- posting it made, with a nota attached, saying there was no evidence.
  -- `attach_link` has always accepted both; now one function decides, and the
  -- two seams cannot disagree about what a kind is called. (0034)
  select bool_or(ops_core.doc_kind_of(d ->> 'kind')
                   in ('nota','transfer_proof','goods_photo','rekening_koran'))
    into has_primary
    from jsonb_array_elements(coalesce(p_documents, '[]'::jsonb)) d;

  select string_agg(d ->> 'kind', ', ') into missing
    from jsonb_array_elements(coalesce(p_documents, '[]'::jsonb)) d
   where ops_core.doc_kind_of(d ->> 'kind') is null;
  if missing is not null then
    return ops_core.invalid('accounting','transaction', p_source_ref,'post',
      'unknown_kind',
      format('"%s" is not a kind of document this system files.', missing),
      jsonb_build_object('field','documents','given', missing));
  end if;
  if not coalesce(has_primary, false) then
    return ops_core.invalid('accounting','transaction', p_source_ref,'post',
      'evidence_required',
      'A ledger row needs at least one nota, transfer proof, bank statement or photo of what arrived. Supporting documents are welcome, but they cannot stand alone.',
      jsonb_build_object('field','documents'));
  end if;

  select count(*), sum((l ->> 'amount')::numeric)
    into n_lines, lines_total
    from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) l;

  if ty.is_purchase then
    if coalesce(n_lines, 0) = 0 then
      return ops_core.invalid('accounting','transaction', p_source_ref,'post',
        'detail_required',
        format('%s is a purchase: it needs what was bought, how many and at what price. An amount on its own cannot be checked against a delivery, a quote or next month.', p_type_code),
        jsonb_build_object('field','lines'));
    end if;
    select l ->> 'description' into missing
      from jsonb_array_elements(p_lines) l
     where nullif(l ->> 'qty','') is null or nullif(l ->> 'unit_price','') is null
     limit 1;
    if missing is not null then
      return ops_core.invalid('accounting','transaction', p_source_ref,'post',
        'line_detail_required',
        format('"%s" has no quantity or no unit price. Both are what make a price comparable to the next one.', missing),
        jsonb_build_object('field','lines'));
    end if;
    if p_vendor_code is null then
      return ops_core.invalid('accounting','transaction', p_source_ref,'post',
        'vendor_required',
        'A purchase has somebody it was bought from. Without it the question "where do we buy this" has no answer.',
        jsonb_build_object('field','vendor_code'));
    end if;
  end if;

  -- The detail and the total are two statements about the same event, and
  -- **the ledger will not guess which one is wrong.**
  if coalesce(n_lines, 0) > 0 and lines_total <> p_amount then
    return ops_core.invalid('accounting','transaction', p_source_ref,'post',
      'lines_do_not_add_up',
      format('The detail adds up to %s but the transaction is %s. One of the two is wrong, and the ledger will not guess which.',
             lines_total, p_amount),
      jsonb_build_object('field','lines','lines_total', lines_total,'amount', p_amount));
  end if;

  if p_vendor_code is not null then
    select id into ven from ops_procure.vendors where code = p_vendor_code;
    if not found then
      return ops_core.invalid('accounting','transaction', p_source_ref,'post',
        'no_such_vendor', format('There is no vendor %s.', p_vendor_code),
        jsonb_build_object('field','vendor_code'));
    end if;
  end if;
  if p_project_code is not null then
    select id into proj from ops_procure.projects where code = p_project_code;
    if not found then
      return ops_core.invalid('accounting','transaction', p_source_ref,'post',
        'no_such_project', format('There is no project %s.', p_project_code),
        jsonb_build_object('field','project_code'));
    end if;
  end if;

  -- The idempotency claim on the row itself (A4), separate from the seam's
  -- key: a repeat with the same `source_ref` is the same event arriving twice
  -- — from a re-run import, a retried webhook — and must be a no-op whether or
  -- not the caller remembered to pass a key.
  src := coalesce(nullif(btrim(p_source_ref), ''), ops_core.new_token('src'));
  select t.trx_no into existing from ops_acct.transactions t where t.source_ref = src;
  if existing is not null then
    return ops_core.conflict('accounting','transaction', existing,'post',
      'already_posted', format('Already booked as %s — nothing changed.', existing),
      jsonb_build_object('trx_no', existing));
  end if;

  v_trx_no := ops_core.next_doc_number('trx');

  insert into ops_acct.transactions
    (trx_no, trx_date, account_id, direction, amount_idr, type_code,
     vendor_id, project_id, description, remark, status, source_ref, posted_by)
  values (v_trx_no, coalesce(p_trx_date, ops_core.office_day()), acc.id, p_direction,
          p_amount, p_type_code, ven, proj, btrim(p_description),
          nullif(btrim(p_remark), ''), 'POSTED', src, auth.uid())
  returning id into v_trx_id;

  if coalesce(n_lines, 0) > 0 then
    insert into ops_acct.transaction_lines
      (trx_id, line_no, item_id, description, qty, uom, unit_price, amount)
    select v_trx_id, ord,
           nullif(l ->> 'item_id','')::uuid,
           l ->> 'description',
           nullif(l ->> 'qty','')::numeric,
           nullif(l ->> 'uom',''),
           nullif(l ->> 'unit_price','')::numeric,
           (l ->> 'amount')::numeric
      from jsonb_array_elements(p_lines) with ordinality as t(l, ord);
  end if;

  insert into ops_core.attachment_links (attachment_id, entity, entity_no, kind, linked_by)
  select (d ->> 'attachment_id')::uuid, 'transaction', v_trx_no,
         ops_core.doc_kind_of(d ->> 'kind'), auth.uid()
    from jsonb_array_elements(p_documents) d;

  perform ops_core.emit('accounting','accounting.transaction.posted', v_trx_no,
    jsonb_build_object('trx_no', v_trx_no, 'amount', p_amount,
                       'direction', p_direction, 'account', p_account_code));

  res := ops_core.ok('accounting','transaction', v_trx_no,'post',
    jsonb_build_object('trx_no', v_trx_no, 'amount', p_amount,
                       'direction', p_direction, 'status','POSTED'));
  return ops_core.idem_remember('accounting','post_transaction', p_key, res);
end $$;

create or replace function ops_acct.post_from_line(
  p_line_no text,
  p_amount numeric,
  p_account_code text,
  p_type_code text,
  p_attachment_id uuid,
  p_trx_date date default null,
  p_document_kind text default 'Payment Proof',
  p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_acct, ops_core, ops_procure, pg_temp as $$
declare
  l record; v_ven text; v_proj text; v_src text;
  posted jsonb; allocated jsonb; v_trx_no text;
  replayed jsonb; res jsonb;
begin
  replayed := ops_core.idem_replay('accounting','post_from_line:' || p_line_no, p_key);
  if replayed is not null then return replayed; end if;

  -- **The authority is checked here as well as inside `post_transaction`.**
  -- Not belt and braces: the refusal below names the line, which is what the
  -- person is looking at, and it happens before anything is read about a line
  -- they may not be allowed to see either.
  if not ops_core.has_authority('post_ledger') then
    return ops_core.refused('accounting','transaction', p_line_no,'post_from_line',
      'authority_required',
      'Posting to the ledger belongs to Accounting — logged, not applied.',
      jsonb_build_object('required','post_ledger','attempted_amount', p_amount));
  end if;

  -- The project hangs off the **document**, not the line: a request is raised
  -- for one project and its lines inherit it. Reading it from the line would
  -- find no column, which is how the first draft of this seam failed.
  select pl.id, pl.line_no_full, pl.description, pl.qty, pl.uom, pl.unit_price,
         pl.removed_at, v.code as vendor_code, pj.code as project_code
    into l
    from ops_procure.pr_lines pl
    join ops_procure.pr_documents d on d.id = pl.doc_id
    left join ops_procure.vendors  v  on v.id  = pl.vendor_id
    left join ops_procure.projects pj on pj.id = d.project_id
   where pl.line_no_full = p_line_no;

  if not found then
    return ops_core.invalid('accounting','transaction', p_line_no,'post_from_line',
      'pr_line_not_found', format('Line %s does not exist in procurement.', p_line_no),
      jsonb_build_object('field','line_no'));
  end if;
  -- Removed, not deleted (A2/A5). The row is still there and still readable,
  -- and paying against it is the thing that must not happen.
  if l.removed_at is not null then
    return ops_core.conflict('accounting','transaction', p_line_no,'post_from_line',
      'line_removed', format('Line %s has been removed.', p_line_no));
  end if;

  -- **No proof, no payment** (D85). Stated here rather than left to
  -- `post_transaction`'s document check, because the message a person needs at
  -- this screen names the transfer receipt, not "documents".
  if p_attachment_id is null then
    return ops_core.invalid('accounting','transaction', p_line_no,'post_from_line',
      'evidence_required',
      'A payment needs its proof. Attach the transfer receipt or the nota before recording it.',
      jsonb_build_object('field','attachment_id'));
  end if;

  -- The same `source_ref` the demo builds, and it is load-bearing: two people
  -- paying the same line for the same amount on the same day is a duplicate,
  -- and `post_transaction` refuses a repeated `source_ref` with the number of
  -- the row that already exists. An idempotency key protects one double tap;
  -- this protects two laptops.
  v_src := format('pr-line:%s:%s:%s', p_line_no,
                  coalesce(p_trx_date, ops_core.office_day()), p_amount);

  posted := ops_acct.post_transaction(
    p_account_code => p_account_code,
    p_direction    => 'OUT',
    p_amount       => p_amount,
    p_type_code    => p_type_code,
    -- The line number lives in the description too, so the ledger reads
    -- correctly on its own without opening the request.
    p_description  => format('%s — %s', l.description, p_line_no),
    p_documents    => jsonb_build_array(jsonb_build_object(
                        'attachment_id', p_attachment_id,
                        'kind', coalesce(nullif(btrim(p_document_kind), ''), 'Payment Proof'))),
    p_trx_date     => p_trx_date,
    p_vendor_code  => l.vendor_code,
    p_project_code => l.project_code,
    -- What was bought, how many, at what price — so the ledger row can be read
    -- without opening the PR (D86).
    p_lines        => jsonb_build_array(jsonb_build_object(
                        'description', l.description,
                        'qty',         l.qty,
                        'uom',         l.uom,
                        'unit_price',  l.unit_price,
                        'amount',      p_amount)),
    p_source_ref   => v_src,
    p_key          => null);

  -- Its refusal, verbatim. Rewording it here would be a second description of a
  -- rule this function does not own (A7) — and `post_transaction` refuses for
  -- reasons this one cannot see, such as a type code that does not exist.
  if posted ->> 'outcome' <> 'ok' then
    return posted;
  end if;
  v_trx_no := posted -> 'data' ->> 'trx_no';

  allocated := ops_acct.allocate_payment(
    p_trx_no      => v_trx_no,
    p_amount      => p_amount,
    p_pr_line_no  => p_line_no,
    p_method      => 'transfer',
    p_key         => null);

  -- **The posting stands even if the allocation does not.** The money has left
  -- the account; saying otherwise would be a lie, and re-posting to "fix" it is
  -- how a supplier gets paid twice. The refusal names the transaction that
  -- exists, so somebody can allocate it by hand.
  if allocated ->> 'outcome' <> 'ok' then
    return ops_core.conflict('accounting','transaction', v_trx_no,'post_from_line',
      'allocation_failed',
      format('%s was posted, but could not be counted against %s: %s',
             v_trx_no, p_line_no, allocated -> 'error' ->> 'message'),
      jsonb_build_object('trx_no', v_trx_no, 'pr_line_no', p_line_no,
                         'from', allocated -> 'error'));
  end if;

  res := ops_core.ok('accounting','transaction', v_trx_no,'post_from_line',
    jsonb_build_object('trx_no', v_trx_no, 'pr_line_no', p_line_no,
                       'amount', p_amount, 'account', p_account_code,
                       'type', p_type_code,
                       'document', coalesce(nullif(btrim(p_document_kind), ''), 'Payment Proof')));
  return ops_core.idem_remember('accounting','post_from_line:' || p_line_no, p_key, res);
end $$;

grant execute on function ops_acct.post_from_line(
  text, numeric, text, text, uuid, date, text, text) to authenticated;

comment on function ops_acct.post_from_line(
  text, numeric, text, text, uuid, date, text, text) is
  'Pay an approved request line: posts the ledger row and counts it against the line, by '
  'composing post_transaction and allocate_payment rather than repeating either. Refuses '
  'without post_ledger, without proof (D85), and against a removed line. (0034)';

-- ── the send, as the meeting board reads it back ──────────────────────────
--
-- `requestApproval` answers `ApprovalBatchView` — the batch with its items and
-- three totals — because the screen puts the result straight into a toast
-- naming what was sent and to whom, and then into its list. The seam answers a
-- receipt, which is right for the trail and not enough to redraw with.
--
-- No view existed for it. `listApprovalBatches` is also waiting on one, so this
-- is the shape both read.
--
-- ### Three totals, and why `to_pay_total` is not `approved_total`
--
-- Approving something already paid for commits no new money. `to_pay` is what
-- actually has to leave the bank — approved, less whatever has already reached
-- the line — and a total that ignores that is a total nobody can act on at the
-- moment of deciding.

create or replace view ops_procure.v_approval_request as
  select r.id, r.line_id, r.batch_id, r.token,
         r.sent_to, r.sent_to_email, r.sent_by, r.sent_by_email,
         r.sent_at, r.channel, r.meeting_note, r.answered_at, r.outcome,

         l.line_no_full, l.description, l.purpose,
         l.qty, l.uom, l.unit_price, l.item_total,
         l.vendor_name, l.requested_by_name, l.project_code,

         -- Decided by **any** route, not only by answering this card: the
         -- meeting may have settled it in the room. The screen says the card is
         -- stale rather than offering a button that will 409.
         (l.approval_id is not null and l.approval_approved) as line_decided,

         case when l.approval_id is not null and l.approval_approved
              then coalesce(l.approval_amount, l.item_total)
         end as approved_amount,

         greatest(
           coalesce(case when l.approval_id is not null and l.approval_approved
                         then coalesce(l.approval_amount, l.item_total) end, 0)
           - coalesce(l.coverage_covered, 0), 0) as to_pay

    from ops_procure.approval_requests r
    join ops_procure.v_pr_line l on l.id = r.line_id;

alter view ops_procure.v_approval_request set (security_invoker = on);
grant select on ops_procure.v_approval_request to authenticated;

create or replace view ops_procure.v_approval_batch as
  select b.id, b.batch_no, b.token,
         b.sent_to, b.sent_to_email, b.sent_by, b.sent_by_email,
         b.sent_at, b.channel,

         coalesce(i.items, '[]'::jsonb)   as items,
         coalesce(i.requested_total, 0)   as requested_total,
         coalesce(i.approved_total, 0)    as approved_total,
         coalesce(i.to_pay_total, 0)      as to_pay_total,
         coalesce(i.answered, 0)          as answered,
         coalesce(i.pending, 0)           as pending

    from ops_procure.approval_batches b
    left join lateral (
      select jsonb_agg(to_jsonb(r) order by r.line_no_full)        as items,
             sum(r.item_total)                                      as requested_total,
             sum(coalesce(r.approved_amount, 0))                    as approved_total,
             sum(r.to_pay)                                          as to_pay_total,
             count(*) filter (where r.answered_at is not null)      as answered,
             count(*) filter (where r.answered_at is null)          as pending
        from ops_procure.v_approval_request r
       where r.batch_id = b.id
    ) i on true;

alter view ops_procure.v_approval_batch set (security_invoker = on);
grant select on ops_procure.v_approval_batch to authenticated;

comment on view ops_procure.v_approval_batch is
  'One send, as the meeting board reads it back: the batch, its items, and the three totals '
  'a person needs at the moment of deciding — asked for, said yes to, and what actually has '
  'to leave the bank. (0034)';
