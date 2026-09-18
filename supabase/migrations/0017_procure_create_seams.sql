-- 0017_procure_create_seams.sql — the seams that bring rows into existence.
--
-- `0016` covers the decisions; this covers the creating. Both halves are seams
-- for the same reason (D84): a plain insert through a policy would get the row
-- written and lose the audit row, the outbox row, the document number and the
-- refusal — and the refusals here are not decoration. A receiving report with
-- no photograph and an order with no price are the two ways this system used to
-- accumulate rows that nobody could check.
--
-- Everything mints its own public code through `ops_core.next_doc_number()`
-- (ADR-005). No caller supplies one, because a number somebody can choose is a
-- number two callers can choose the same value for.

-- ── requests ──────────────────────────────────────────────────────────────
-- A document is a submission batch, not a subject: these lines arrived together
-- on a day from a person. It carries no purpose of its own, because a request
-- can hold items for three jobs from three suppliers, and one "purpose" on the
-- container would be a lie about at least two of them.
--
-- `p_lines` is a jsonb array so a whole request arrives in one transaction.
-- Building it line by line over several calls would leave half-written requests
-- behind every time a phone lost signal mid-form.
create or replace function ops_procure.create_pr(
  p_lines jsonb,
  p_project_code text default null,
  p_doc_type ops_procure.pr_doc_type_t default 'PR',
  p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare
  v_doc_no text; v_doc_id uuid; proj uuid; n int;
  replayed jsonb; res jsonb;
begin
  replayed := ops_core.idem_replay('procurement','create_pr', p_key);
  if replayed is not null then return replayed; end if;

  if not ops_core.has_permission('procurement.create') then
    return ops_core.refused('procurement','pr_document', null,'create',
      'not_permitted','Raising a request needs procurement access.');
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    return ops_core.invalid('procurement','pr_document', null,'create',
      'lines_required','A purchase request needs at least one line.',
      jsonb_build_object('field','lines'));
  end if;

  -- By **code**, never by id: another service knows the code and nothing else
  -- (ADR-004). A project code that names nothing is a 404 rather than a silent
  -- null, because a request filed against the wrong job is worse than one
  -- filed against none.
  if p_project_code is not null then
    select id into proj from ops_procure.projects where code = p_project_code;
    if not found then
      return ops_core.not_found('procurement','pr_document', null,'create',
        format('No project %s.', p_project_code));
    end if;
  end if;

  v_doc_no := ops_core.next_doc_number('pr');

  insert into ops_procure.pr_documents (doc_no, doc_type, status, requested_by, project_id)
  values (v_doc_no, p_doc_type, 'DRAFT', auth.uid(), proj)
  returning id into v_doc_id;

  insert into ops_procure.pr_lines
    (doc_id, doc_no, line_no, item_id, description, qty, uom, unit_price,
     item_total, vendor_id, category, purpose, need_by, source_wo_no)
  select v_doc_id, v_doc_no, ord,
         nullif(l ->> 'item_id','')::uuid,
         l ->> 'description',
         nullif(l ->> 'qty','')::numeric,
         nullif(l ->> 'uom',''),
         nullif(l ->> 'unit_price','')::numeric,
         -- The amount is quantity × price when there is a quantity and a price,
         -- and whatever the caller says otherwise. Plenty of real lines have
         -- neither — a service, a delivery charge, a lump sum the vendor quoted
         -- — and deriving those from a missing quantity would silently zero the
         -- one number that mattered (D75).
         coalesce(
           nullif(l ->> 'item_total','')::numeric,
           round(coalesce(nullif(l ->> 'qty','')::numeric, 0)
               * coalesce(nullif(l ->> 'unit_price','')::numeric, 0))),
         nullif(l ->> 'vendor_id','')::uuid,
         nullif(l ->> 'category','')::ops_procure.pr_category_t,
         nullif(l ->> 'purpose',''),
         nullif(l ->> 'need_by','')::date,
         nullif(l ->> 'source_wo_no','')
    from jsonb_array_elements(p_lines) with ordinality as t(l, ord);

  get diagnostics n = row_count;

  perform ops_core.emit('procurement','procurement.pr.created', v_doc_no,
    jsonb_build_object('doc_no', v_doc_no, 'lines', n));

  res := ops_core.ok('procurement','pr_document', v_doc_no,'create',
    jsonb_build_object('doc_no', v_doc_no, 'status','DRAFT','lines', n));
  return ops_core.idem_remember('procurement','create_pr', p_key, res);
end $$;

-- One item, asked for and submitted in a single act.
--
-- For the meeting itself: somebody says "we also need thinner", and the item has
-- to be on the list before the conversation moves on. Going through the full
-- create-then-submit form loses the room.
--
-- It is a real purchase request, not a lighter kind — same document, same
-- numbering, same queue. The only thing skipped is the draft stage, which exists
-- for the case where somebody is still assembling a list (D73).
create or replace function ops_procure.quick_add_line(
  p_line jsonb, p_project_code text default null, p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare created jsonb; submitted jsonb; v_doc_no text; replayed jsonb; res jsonb;
begin
  replayed := ops_core.idem_replay('procurement','quick_add_line', p_key);
  if replayed is not null then return replayed; end if;

  if coalesce(btrim(p_line ->> 'description'), '') = '' then
    return ops_core.invalid('procurement','pr_line', null,'quick_add',
      'description_required','An item needs a name before anyone can decide it.',
      jsonb_build_object('field','description'));
  end if;

  created := ops_procure.create_pr(jsonb_build_array(p_line), p_project_code);
  if not ops_core.said_ok(created) then return created; end if;

  v_doc_no := created -> 'data' ->> 'doc_no';
  submitted := ops_procure.submit_pr(v_doc_no);
  if not ops_core.said_ok(submitted) then return submitted; end if;

  res := ops_core.ok('procurement','pr_line', v_doc_no || '-L01','quick_add',
    jsonb_build_object('doc_no', v_doc_no, 'line_no', v_doc_no || '-L01'));
  return ops_core.idem_remember('procurement','quick_add_line', p_key, res);
end $$;

create or replace function ops_procure.add_draft_line(p_doc_no text, p_line jsonb)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare d ops_procure.pr_documents; nxt int; v_code text;
begin
  if not ops_core.has_permission('procurement.create') then
    return ops_core.refused('procurement','pr_document', p_doc_no,'add_line',
      'not_permitted','Adding a line needs procurement access.');
  end if;
  if coalesce(btrim(p_line ->> 'description'), '') = '' then
    return ops_core.invalid('procurement','pr_document', p_doc_no,'add_line',
      'description_required','An item needs a name before anyone can decide it.');
  end if;

  select * into d from ops_procure.pr_documents where doc_no = p_doc_no;
  if not found then
    return ops_core.not_found('procurement','pr_document', p_doc_no,'add_line','No such request.');
  end if;
  if d.status in ('CLOSED','CANCELLED') then
    return ops_core.conflict('procurement','pr_document', p_doc_no,'add_line',
      'document_closed', format('%s is %s.', p_doc_no, lower(d.status::text)));
  end if;

  -- `max + 1`, not `count + 1`: a removed line keeps its number, so counting
  -- live rows would hand the next line a number already in use.
  select coalesce(max(line_no), 0) + 1 into nxt from ops_procure.pr_lines where doc_id = d.id;

  insert into ops_procure.pr_lines
    (doc_id, doc_no, line_no, item_id, description, qty, uom, unit_price,
     item_total, vendor_id, category, purpose, need_by, source_wo_no)
  values (d.id, d.doc_no, nxt,
          nullif(p_line ->> 'item_id','')::uuid,
          p_line ->> 'description',
          nullif(p_line ->> 'qty','')::numeric,
          nullif(p_line ->> 'uom',''),
          nullif(p_line ->> 'unit_price','')::numeric,
          coalesce(nullif(p_line ->> 'item_total','')::numeric,
                   round(coalesce(nullif(p_line ->> 'qty','')::numeric, 0)
                       * coalesce(nullif(p_line ->> 'unit_price','')::numeric, 0))),
          nullif(p_line ->> 'vendor_id','')::uuid,
          nullif(p_line ->> 'category','')::ops_procure.pr_category_t,
          nullif(p_line ->> 'purpose',''),
          nullif(p_line ->> 'need_by','')::date,
          nullif(p_line ->> 'source_wo_no',''))
  returning line_no_full into v_code;

  return ops_core.ok('procurement','pr_line', v_code,'add_line',
    jsonb_build_object('line_no', v_code, 'doc_no', p_doc_no));
end $$;

-- Editing what was asked for — and the three points past which it is not an
-- edit any more.
--
-- Approved: editing now would rewrite what the approver said yes to, so the
-- honest road is to un-approve it or ask again. Paid: past that point the words
-- are return, credit or void. Removed: ask for it again rather than editing it
-- back to life.
create or replace function ops_procure.update_line(p_line_no text, p_patch jsonb)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare l ops_procure.pr_lines; v_approved boolean; v_covered numeric; v_before jsonb; v_after jsonb;
begin
  if not ops_core.has_permission('procurement.update') then
    return ops_core.refused('procurement','pr_line', p_line_no,'edit_line',
      'not_permitted','Editing a line needs procurement access.');
  end if;

  select * into l from ops_procure.pr_lines where line_no_full = p_line_no;
  if not found then
    return ops_core.not_found('procurement','pr_line', p_line_no,'edit_line','No such line.');
  end if;
  if l.removed_at is not null then
    return ops_core.conflict('procurement','pr_line', p_line_no,'edit_line',
      'line_removed',
      format('%s has been removed. Ask for it again rather than editing it back to life.', p_line_no));
  end if;

  select coalesce(a.approved, false) into v_approved
    from ops_procure.v_line_approval a where a.line_id = l.id and a.step = 'GOODS';
  if coalesce(v_approved, false) then
    return ops_core.conflict('procurement','pr_line', p_line_no,'edit_line',
      'already_approved',
      format('%s has been v_approved. Editing it now would rewrite what the approver said yes to — ask the CEO to un-approve it first, or remove it and ask again.', p_line_no));
  end if;

  select cov.covered into v_covered from ops_procure.v_line_coverage cov where cov.line_id = l.id;
  if coalesce(v_covered, 0) > 0 then
    return ops_core.conflict('procurement','pr_line', p_line_no,'edit_line',
      'already_paid',
      format('%s has already been paid against. Past that point the words are return, credit or void — never an edit.', p_line_no),
      jsonb_build_object('covered', v_covered));
  end if;

  v_before := jsonb_build_object(
    'description', l.description, 'qty', l.qty, 'uom', l.uom,
    'unit_price', l.unit_price, 'item_total', l.item_total,
    'vendor_id', l.vendor_id, 'category', l.category,
    'purpose', l.purpose, 'need_by', l.need_by);

  update ops_procure.pr_lines set
    description = coalesce(p_patch ->> 'description', description),
    qty         = coalesce(nullif(p_patch ->> 'qty','')::numeric, qty),
    uom         = coalesce(nullif(p_patch ->> 'uom',''), uom),
    unit_price  = coalesce(nullif(p_patch ->> 'unit_price','')::numeric, unit_price),
    vendor_id   = coalesce(nullif(p_patch ->> 'vendor_id','')::uuid, vendor_id),
    item_id     = coalesce(nullif(p_patch ->> 'item_id','')::uuid, item_id),
    category    = coalesce(nullif(p_patch ->> 'category','')::ops_procure.pr_category_t, category),
    purpose     = coalesce(nullif(p_patch ->> 'purpose',''), purpose),
    need_by     = coalesce(nullif(p_patch ->> 'need_by','')::date, need_by)
  where id = l.id;

  -- Recomputed only where both halves exist, and never when the caller named
  -- the total outright. Same reason as in `create_pr`.
  update ops_procure.pr_lines set
    item_total = case
      when p_patch ? 'item_total' then nullif(p_patch ->> 'item_total','')::numeric
      when qty is not null and unit_price is not null then round(qty * unit_price)
      else item_total end
  where id = l.id;

  select jsonb_build_object(
    'description', description, 'qty', qty, 'uom', uom,
    'unit_price', unit_price, 'item_total', item_total,
    'vendor_id', vendor_id, 'category', category,
    'purpose', purpose, 'need_by', need_by)
    into v_after from ops_procure.pr_lines where id = l.id;

  -- The old values, not just the fact that something changed: "who changed the
  -- quantity, and from what" is the question asked six months later.
  return ops_core.ok('procurement','pr_line', p_line_no,'edit_line',
    jsonb_build_object('line_no', p_line_no), v_before, v_after);
end $$;

-- ── asking leadership ─────────────────────────────────────────────────────
-- Whoever holds `approve_goods` is who the question goes to. **Not a name in a
-- config file**: if the authority moves, the notification follows it (D19).
--
-- A bare number is refused before it is sent, not after. Sending one to
-- somebody's phone is worse than sending nothing: they cannot check it there,
-- so they either say yes blind or put the phone down (D125).
create or replace function ops_procure.request_approval(
  p_line_nos text[], p_to_email ops_core.citext default null,
  p_notes jsonb default '{}'::jsonb, p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare
  approver ops_core.users; v_batch_no text; v_batch_id uuid; batch_tok text;
  bare text[] := '{}'; fresh text[] := '{}';
  ln text; l ops_procure.pr_lines; v_approved boolean; supported boolean;
  replayed jsonb; res jsonb;
begin
  replayed := ops_core.idem_replay('procurement','request_approval', p_key);
  if replayed is not null then return replayed; end if;

  if not ops_core.has_permission('procurement.update') then
    return ops_core.refused('procurement','approval_batch', null,'request',
      'not_permitted','Sending a request for approval needs procurement access.');
  end if;

  if p_to_email is not null then
    select * into approver from ops_core.users where email = p_to_email;
  else
    select u.* into approver from ops_core.users u
      join ops_core.user_authorities ua on ua.user_id = u.id
     where ua.authority = 'approve_goods' and u.is_active and u.left_on is null
     order by u.full_name limit 1;
  end if;
  if not found then
    return ops_core.conflict('procurement','approval_batch', null,'request',
      'no_approver',
      'Nobody currently holds the authority to approve goods, so there is no one to ask.');
  end if;

  foreach ln in array coalesce(p_line_nos, '{}') loop
    select * into l from ops_procure.pr_lines where line_no_full = ln;
    continue when not found or l.removed_at is not null;

    select coalesce(a.approved, false) into v_approved
      from ops_procure.v_line_approval a where a.line_id = l.id and a.step = 'GOODS';
    continue when coalesce(v_approved, false);
    -- Already asked. Asking twice is nagging, not a record — and the partial
    -- unique index in `0009` would refuse the second card anyway.
    continue when exists (select 1 from ops_procure.v_pending_request r where r.line_id = l.id);

    select coalesce(e.has_support, false) into supported
      from ops_procure.v_line_evidence e where e.line_id = l.id;
    if coalesce(supported, false) then
      fresh := fresh || ln;
    else
      bare := bare || ln;
    end if;
  end loop;

  if array_length(bare, 1) > 0 then
    return ops_core.invalid('procurement','approval_batch', null,'request',
      'support_required',
      format('%s of these have nothing behind them — %s. Attach the shop link, the invoice or the bill before asking anybody to decide.',
             array_length(bare, 1), array_to_string(bare, ', ')),
      jsonb_build_object('field','documents','lines', to_jsonb(bare)));
  end if;

  if coalesce(array_length(fresh, 1), 0) = 0 then
    return ops_core.conflict('procurement','approval_batch', null,'request',
      'nothing_to_ask',
      'Nothing to send — every one of those is already decided or already waiting for an answer.');
  end if;

  v_batch_no := ops_core.next_doc_number('ask');
  -- Unguessable and **never derived from the batch number**. The token is what
  -- the chat card carries back, so a predictable one would let anybody who can
  -- guess a document number answer somebody else's list — and two sends
  -- deriving the same token would answer each other's.
  batch_tok := ops_core.new_token();

  insert into ops_procure.approval_batches
    (batch_no, token, sent_to, sent_to_email, sent_by, sent_by_email, channel)
  values (v_batch_no, batch_tok, approver.full_name, approver.email,
          auth.uid(), ops_procure.actor_email(), 'chat')
  returning id into v_batch_id;

  insert into ops_procure.approval_requests
    (line_id, batch_id, token, sent_to, sent_to_email, sent_by, sent_by_email,
     channel, meeting_note)
  select pl.id, v_batch_id, ops_core.new_token(),
         approver.full_name, approver.email, auth.uid(), ops_procure.actor_email(),
         'chat', nullif(p_notes ->> pl.line_no_full, '')
    from ops_procure.pr_lines pl
   where pl.line_no_full = any(fresh);

  perform ops_core.emit('procurement','procurement.approval.requested', v_batch_no,
    jsonb_build_object('batch_no', v_batch_no, 'to', approver.email,
                       'lines', to_jsonb(fresh)));

  res := ops_core.ok('procurement','approval_batch', v_batch_no,'request',
    jsonb_build_object('batch_no', v_batch_no, 'token', batch_tok,
                       'sent_to', approver.email, 'lines', to_jsonb(fresh)));
  return ops_core.idem_remember('procurement','request_approval', p_key, res);
end $$;

-- ── rounds ────────────────────────────────────────────────────────────────
-- Roll everything still owed into the open round, opening one if there is none.
--
-- A line in a **closed** round that is still owed comes back; a line in a round
-- that has frozen its numbers stays where it is. Nothing to roll is a `noop`,
-- not an error — a successful nothing-happened is better than a silent 200 that
-- looks like work.
create or replace function ops_procure.sync_round()
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare r ops_procure.payment_rounds; v_round_no text; added int := 0; opened boolean := false;
begin
  if not ops_core.has_permission('procurement.update') then
    return ops_core.refused('procurement','payment_round', null,'sync',
      'not_permitted','Rolling up a round needs procurement access.');
  end if;

  select * into r from ops_procure.payment_rounds where status = 'OPEN'
   order by opened_at limit 1;

  if r.id is null and not exists (select 1 from ops_procure.v_round_eligible) then
    return ops_core.noop('procurement','payment_round', null,'sync',
      'nothing approved and unpaid', jsonb_build_object('added', 0));
  end if;

  if r.id is null then
    v_round_no := ops_core.next_doc_number('fund');
    insert into ops_procure.payment_rounds (round_no, status, opened_by)
    values (v_round_no, 'OPEN', auth.uid())
    returning * into r;
    opened := true;
  else
    v_round_no := r.round_no;
  end if;

  insert into ops_procure.payment_round_lines (round_id, line_id, requested_amount)
  select r.id, e.line_id, e.remaining from ops_procure.v_round_eligible e
  -- `line_id` is uniquely indexed across every round: a line belongs to one
  -- round at a time, and two rounds each expecting to fund the same line is how
  -- a line gets paid twice.
  on conflict (line_id) do nothing;

  get diagnostics added = row_count;

  if added = 0 and not opened then
    return ops_core.noop('procurement','payment_round', v_round_no,'sync',
      'nothing new to roll in',
      jsonb_build_object('round_no', v_round_no, 'added', 0));
  end if;

  perform ops_core.emit('procurement','procurement.round.synced', v_round_no,
    jsonb_build_object('round_no', v_round_no, 'added', added));
  return ops_core.ok('procurement','payment_round', v_round_no,'sync',
    jsonb_build_object('round_no', v_round_no, 'added', added, 'opened', opened));
end $$;

-- Closing a round says the batch is finished. Lines still owed inside it are
-- **not** an error: they come back into the next round through `sync_round`,
-- which is how a line that could not be paid this week stays somebody's problem
-- without anybody having to carry it forward by hand.
create or replace function ops_procure.close_round(p_round_no text, p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare r ops_procure.payment_rounds; unpaid int; replayed jsonb; res jsonb;
begin
  replayed := ops_core.idem_replay('procurement','close_round:' || p_round_no, p_key);
  if replayed is not null then return replayed; end if;

  if not ops_core.has_authority('approve_funds') then
    return ops_core.refused('procurement','payment_round', p_round_no,'close',
      'authority_required','Closing a round belongs to Finance.');
  end if;

  select * into r from ops_procure.payment_rounds where round_no = p_round_no;
  if not found then
    return ops_core.not_found('procurement','payment_round', p_round_no,'close','No such round.');
  end if;
  if r.status = 'CLOSED' then
    return ops_core.noop('procurement','payment_round', p_round_no,'close',
      'already closed', jsonb_build_object('round_no', p_round_no));
  end if;
  if r.status = 'OPEN' then
    return ops_core.invalid('procurement','payment_round', p_round_no,'close',
      'never_approved','An open round has not been decided. Approve it or leave it open.');
  end if;

  select count(*) into unpaid
    from ops_procure.payment_round_lines rl
    join ops_procure.v_line_coverage cov on cov.line_id = rl.line_id
   where rl.round_id = r.id and not cov.settled;

  update ops_procure.payment_rounds
     set status = 'CLOSED', closed_at = now(), closed_by = auth.uid()
   where id = r.id;

  perform ops_core.emit('procurement','procurement.round.closed', p_round_no,
    jsonb_build_object('round_no', p_round_no, 'still_owed', unpaid));

  res := ops_core.ok('procurement','payment_round', p_round_no,'close',
    jsonb_build_object('round_no', p_round_no, 'status','CLOSED',
                       'still_owed', unpaid));
  return ops_core.idem_remember('procurement','close_round:' || p_round_no, p_key, res);
end $$;

-- ── orders ────────────────────────────────────────────────────────────────
-- Always a DRAFT. An order is a promise made to a supplier in the company's
-- name, so leadership confirms it before it is sent — which means creating one
-- cannot also send it (D132, narrowing D100).
create or replace function ops_procure.create_po(
  p_vendor_code text, p_lines jsonb,
  p_dp_percent numeric default null, p_note text default null,
  p_expected_delivery date default null, p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare
  v ops_procure.vendors; v_po_no text; v_po_id uuid; n int; priceless text;
  replayed jsonb; res jsonb;
begin
  replayed := ops_core.idem_replay('procurement','create_po', p_key);
  if replayed is not null then return replayed; end if;

  if not ops_core.has_permission('procurement.create') then
    return ops_core.refused('procurement','purchase_order', null,'create',
      'not_permitted','Raising an order needs procurement access.');
  end if;

  select * into v from ops_procure.vendors where code = p_vendor_code;
  if not found then
    return ops_core.invalid('procurement','purchase_order', null,'create',
      'vendor_required','An order is placed with somebody. Choose the vendor first.',
      jsonb_build_object('field','vendor_code'));
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    return ops_core.invalid('procurement','purchase_order', null,'create',
      'lines_required','An order with no lines is not an order.',
      jsonb_build_object('field','lines'));
  end if;

  -- A contract value nobody agreed is not a contract. Refused rather than
  -- warned, because this figure is what the vendor will invoice against.
  select l ->> 'description' into priceless
    from jsonb_array_elements(p_lines) l
   where coalesce(nullif(l ->> 'unit_price','')::numeric, 0) <= 0
   limit 1;
  if priceless is not null then
    return ops_core.invalid('procurement','purchase_order', null,'create',
      'price_required',
      format('"%s" has no unit price. A contract value nobody agreed is not a contract.', priceless),
      jsonb_build_object('field','lines'));
  end if;

  if p_dp_percent is not null and (p_dp_percent < 0 or p_dp_percent > 100) then
    return ops_core.invalid('procurement','purchase_order', null,'create',
      'dp_out_of_range','A deposit is between 0 and 100 per cent.',
      jsonb_build_object('field','dp_percent'));
  end if;

  v_po_no := ops_core.next_doc_number('po');

  insert into ops_procure.purchase_orders
    (po_no, vendor_id, status, created_by, note, expected_delivery)
  values (v_po_no, v.id, 'DRAFT', auth.uid(), nullif(btrim(p_note), ''), p_expected_delivery)
  returning id into v_po_id;

  insert into ops_procure.po_lines
    (po_id, line_no, item_id, description, qty, uom, unit_price, line_total)
  select v_po_id, ord,
         nullif(l ->> 'item_id','')::uuid,
         btrim(l ->> 'description'),
         (l ->> 'qty')::numeric,
         l ->> 'uom',
         (l ->> 'unit_price')::numeric,
         round((l ->> 'qty')::numeric * (l ->> 'unit_price')::numeric)
    from jsonb_array_elements(p_lines) with ordinality as t(l, ord);
  get diagnostics n = row_count;

  -- Two terms or none. A deposit with no matching balance term would leave the
  -- rest of the order owed against nothing, and `v_po_terms` would report the
  -- order as fully payable once 30% had been paid.
  if p_dp_percent is not null and p_dp_percent > 0 then
    insert into ops_procure.po_schedule (po_id, term_no, kind, basis, basis_value, due_rule) values
      (v_po_id, v_po_no || '-M01','DP',   'percent', p_dp_percent,       'on_issue'),
      (v_po_id, v_po_no || '-M02','FINAL','percent', 100 - p_dp_percent, 'on_delivery');
  end if;

  perform ops_core.emit('procurement','procurement.po.created', v_po_no,
    jsonb_build_object('po_no', v_po_no, 'vendor', p_vendor_code, 'lines', n));

  res := ops_core.ok('procurement','purchase_order', v_po_no,'create',
    jsonb_build_object('po_no', v_po_no, 'status','DRAFT','lines', n));
  return ops_core.idem_remember('procurement','create_po', p_key, res);
end $$;

create or replace function ops_procure.request_po_approval(p_po_no text)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare po ops_procure.purchase_orders;
begin
  if not ops_core.has_permission('procurement.update') then
    return ops_core.refused('procurement','purchase_order', p_po_no,'request_approval',
      'not_permitted','Asking for confirmation needs procurement access.');
  end if;
  select * into po from ops_procure.purchase_orders where po_no = p_po_no;
  if not found then
    return ops_core.not_found('procurement','purchase_order', p_po_no,'request_approval','No such order.');
  end if;
  if po.approved_at is not null then
    return ops_core.conflict('procurement','purchase_order', p_po_no,'request_approval',
      'already_approved', format('%s is already confirmed.', p_po_no));
  end if;

  update ops_procure.purchase_orders
     set approval_asked_at = now(), approval_asked_by = auth.uid()
   where id = po.id;

  perform ops_core.emit('procurement','procurement.po.approval_requested', p_po_no,
    jsonb_build_object('po_no', p_po_no));
  return ops_core.ok('procurement','purchase_order', p_po_no,'request_approval',
    jsonb_build_object('po_no', p_po_no));
end $$;

-- The date the vendor gave, and the only thing that makes a delivery *late*
-- rather than merely absent (D134).
create or replace function ops_procure.set_expected_delivery(p_po_no text, p_date date)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare po ops_procure.purchase_orders;
begin
  if not ops_core.has_permission('procurement.update') then
    return ops_core.refused('procurement','purchase_order', p_po_no,'set_expected',
      'not_permitted','Setting the expected date needs procurement access.');
  end if;
  select * into po from ops_procure.purchase_orders where po_no = p_po_no;
  if not found then
    return ops_core.not_found('procurement','purchase_order', p_po_no,'set_expected','No such order.');
  end if;

  update ops_procure.purchase_orders set expected_delivery = p_date where id = po.id;
  return ops_core.ok('procurement','purchase_order', p_po_no,'set_expected',
    jsonb_build_object('po_no', p_po_no, 'expected_delivery', p_date),
    to_jsonb(po.expected_delivery), to_jsonb(p_date));
end $$;

-- The vendor has been sent the current revision. Until this is recorded, the
-- paper in their hand is out of date and the screen says so (D135).
create or replace function ops_procure.mark_po_resent(p_po_no text)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare po ops_procure.purchase_orders;
begin
  if not ops_core.has_permission('procurement.update') then
    return ops_core.refused('procurement','purchase_order', p_po_no,'mark_resent',
      'not_permitted','Recording a resend needs procurement access.');
  end if;
  select * into po from ops_procure.purchase_orders where po_no = p_po_no;
  if not found then
    return ops_core.not_found('procurement','purchase_order', p_po_no,'mark_resent','No such order.');
  end if;
  if po.sent_revision = po.revision then
    return ops_core.noop('procurement','purchase_order', p_po_no,'mark_resent',
      'the vendor already has this revision',
      jsonb_build_object('po_no', p_po_no, 'revision', po.revision));
  end if;

  update ops_procure.purchase_orders set sent_revision = revision where id = po.id;
  return ops_core.ok('procurement','purchase_order', p_po_no,'mark_resent',
    jsonb_build_object('po_no', p_po_no, 'sent_revision', po.revision),
    to_jsonb(po.sent_revision), to_jsonb(po.revision));
end $$;

-- ── receiving ─────────────────────────────────────────────────────────────
-- **The photograph is always required.** Without it there is no evidence
-- anything arrived at all, and it is the one thing the person standing there
-- can always produce.
--
-- The signed tanda terima is required to **confirm**, not to report (D131,
-- superseding half of D101). Goods from outside arrive at night, when the
-- people with the app open are asleep; refusing the report until the paper
-- exists does not produce the paper, it loses the arrival. So a report without
-- it is recorded as REPORTED and counts for nothing until procurement completes
-- it — which is exactly what `ops_procure.receipt_counts()` enforces downstream.
create or replace function ops_procure.create_receipt(
  p_qty numeric,
  p_condition ops_procure.receipt_condition_t,
  p_documents jsonb,                       -- [{"attachment_id":…,"kind":"goods_photo"}]
  p_line_no text default null,
  p_po_line_id uuid default null,
  p_qc_by uuid default null,
  p_note text default null,
  p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare
  l ops_procure.pr_lines; rcv_no text; rcv_id uuid;
  has_photo boolean; has_note boolean; v_confirmed boolean; notified boolean;
  replayed jsonb; res jsonb;
begin
  replayed := ops_core.idem_replay('procurement',
    format('create_receipt:%s:%s', coalesce(p_line_no, p_po_line_id::text), p_qty), p_key);
  if replayed is not null then return replayed; end if;

  if not (ops_core.has_permission('procurement.create') or ops_core.has_permission('inventory.create')) then
    return ops_core.refused('procurement','receipt', null,'report',
      'not_permitted','Recording an arrival needs procurement or inventory access.');
  end if;

  if (p_line_no is null) = (p_po_line_id is null) then
    return ops_core.invalid('procurement','receipt', null,'report',
      'anchor_required','A receiving report must point at a PR line or a PO line, and at exactly one.',
      jsonb_build_object('field','line_no'));
  end if;
  if p_qty is null or p_qty <= 0 then
    return ops_core.invalid('procurement','receipt', null,'report',
      'bad_qty','Nothing arriving is not an arrival.');
  end if;

  select bool_or(d ->> 'kind' = 'goods_photo'),
         bool_or(d ->> 'kind' = 'delivery_note')
    into has_photo, has_note
    from jsonb_array_elements(coalesce(p_documents, '[]'::jsonb)) d;

  if not coalesce(has_photo, false) then
    return ops_core.invalid('procurement','receipt', null,'report',
      'photo_required',
      'A photograph of what arrived is required — it is the one thing whoever is there can always produce.',
      jsonb_build_object('field','documents'));
  end if;

  if p_line_no is not null then
    select * into l from ops_procure.pr_lines where line_no_full = p_line_no;
    if not found then
      return ops_core.not_found('procurement','receipt', null,'report',
        format('Line %s not found.', p_line_no));
    end if;
  elsif not exists (select 1 from ops_procure.po_lines where id = p_po_line_id) then
    return ops_core.not_found('procurement','receipt', null,'report','No such order line.');
  end if;

  v_confirmed := coalesce(has_note, false);
  notified  := ops_procure.receipt_is_problem(p_condition);
  rcv_no    := ops_core.next_doc_number('rcv');

  insert into ops_procure.receipts
    (receipt_no, line_id, po_line_id, qty_received, condition,
     received_by, qc_by, note, status, confirmed_by, confirmed_at)
  values (rcv_no, l.id, p_po_line_id, p_qty, p_condition,
          auth.uid(),
          case when v_confirmed then coalesce(p_qc_by, auth.uid()) else null end,
          nullif(btrim(p_note), ''),
          case when v_confirmed then 'CONFIRMED' else 'REPORTED' end::ops_procure.receipt_status_t,
          case when v_confirmed then auth.uid() else null end,
          case when v_confirmed then now() else null end)
  returning id into rcv_id;

  insert into ops_core.attachment_links (attachment_id, entity, entity_no, kind, linked_by)
  select (d ->> 'attachment_id')::uuid, 'receipt', rcv_no,
         (d ->> 'kind')::ops_core.doc_kind_t, auth.uid()
    from jsonb_array_elements(p_documents) d;

  perform ops_core.emit('procurement','procurement.receipt.recorded', rcv_no,
    jsonb_build_object('receipt_no', rcv_no, 'condition', p_condition,
                       'notified', notified,
                       'status', case when v_confirmed then 'CONFIRMED' else 'REPORTED' end));

  res := ops_core.ok('procurement','receipt', rcv_no,
    case when v_confirmed then 'receive' else 'report' end,
    jsonb_build_object('receipt_no', rcv_no, 'qty', p_qty,
                       'condition', p_condition, 'notified', notified,
                       'status', case when v_confirmed then 'CONFIRMED' else 'REPORTED' end));
  return ops_core.idem_remember('procurement',
    format('create_receipt:%s:%s', coalesce(p_line_no, p_po_line_id::text), p_qty), p_key, res);
end $$;

-- ── reference data ────────────────────────────────────────────────────────
-- **An uncurated vendor is allowed in.** A name a human types is always
-- accepted; refusing it is how a workshop ends up buying off-system (D30). The
-- code is minted here rather than typed, so two people adding the same shop on
-- the same morning get two rows to merge rather than a unique-violation neither
-- of them can act on.
create or replace function ops_procure.create_vendor(p_name text, p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
-- `v_code`, not `code`: a variable sharing a name with a column makes every
-- query below it ambiguous, and Postgres refuses rather than guessing — at run
-- time, which is why only the smoke finds it.
declare v_code text; n int; replayed jsonb; res jsonb;
begin
  replayed := ops_core.idem_replay('procurement','create_vendor', p_key);
  if replayed is not null then return replayed; end if;

  if not ops_core.has_permission('procurement.create') then
    return ops_core.refused('procurement','vendor', null,'create',
      'not_permitted','Adding a vendor needs procurement access.');
  end if;
  if coalesce(btrim(p_name), '') = '' then
    return ops_core.invalid('procurement','vendor', null,'create',
      'name_required','A vendor needs a name.');
  end if;

  select count(*) + 1 into n from ops_procure.vendors;
  v_code := 'V-' || lpad(n::text, 4, '0');
  while exists (select 1 from ops_procure.vendors v where v.code = v_code) loop
    n := n + 1;
    v_code := 'V-' || lpad(n::text, 4, '0');
  end loop;

  insert into ops_procure.vendors (code, name, is_curated, created_by)
  values (v_code, btrim(p_name), false, auth.uid());

  res := ops_core.ok('procurement','vendor', v_code,'create',
    jsonb_build_object('code', v_code, 'name', btrim(p_name), 'is_curated', false));
  return ops_core.idem_remember('procurement','create_vendor', p_key, res);
end $$;

create or replace function ops_procure.create_item(
  p_name text, p_category_code text default 'uncurated',
  p_base_uom text default 'pcs', p_kind ops_procure.item_kind_t default 'goods',
  p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare v_code text; n int; replayed jsonb; res jsonb;
begin
  replayed := ops_core.idem_replay('procurement','create_item', p_key);
  if replayed is not null then return replayed; end if;

  if not ops_core.has_permission('procurement.create') then
    return ops_core.refused('procurement','item', null,'create',
      'not_permitted','Adding an item needs procurement access.');
  end if;
  if coalesce(btrim(p_name), '') = '' then
    return ops_core.invalid('procurement','item', null,'create','name_required','An item needs a name.');
  end if;
  if not exists (select 1 from ops_procure.item_categories where code = p_category_code) then
    return ops_core.invalid('procurement','item', null,'create',
      'no_such_category', format('There is no category %s.', p_category_code));
  end if;
  if not exists (select 1 from ops_procure.uom where code = p_base_uom) then
    return ops_core.invalid('procurement','item', null,'create',
      'no_such_uom', format('There is no unit %s.', p_base_uom));
  end if;

  select count(*) + 1 into n from ops_procure.items;
  v_code := 'I-' || lpad(n::text, 4, '0');
  while exists (select 1 from ops_procure.items i where i.code = v_code) loop
    n := n + 1;
    v_code := 'I-' || lpad(n::text, 4, '0');
  end loop;

  insert into ops_procure.items (code, name, category_code, base_uom, kind, is_curated, created_by)
  values (v_code, btrim(p_name), p_category_code, p_base_uom, p_kind, false, auth.uid());

  res := ops_core.ok('procurement','item', v_code,'create',
    jsonb_build_object('code', v_code, 'name', btrim(p_name), 'is_curated', false));
  return ops_core.idem_remember('procurement','create_item', p_key, res);
end $$;

create or replace function ops_procure.curate_item(p_code text, p_curated boolean)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare i ops_procure.items;
begin
  if not ops_core.has_permission('procurement.update') then
    return ops_core.refused('procurement','item', p_code,'curate',
      'not_permitted','Curating needs procurement access.');
  end if;
  select * into i from ops_procure.items where code = p_code;
  if not found then
    return ops_core.not_found('procurement','item', p_code,'curate','No such item.');
  end if;
  if i.is_curated = p_curated then
    return ops_core.noop('procurement','item', p_code,'curate','already in that state',
      jsonb_build_object('code', p_code, 'is_curated', p_curated));
  end if;

  update ops_procure.items set is_curated = p_curated where id = i.id;
  return ops_core.ok('procurement','item', p_code,'curate',
    jsonb_build_object('code', p_code, 'is_curated', p_curated),
    to_jsonb(i.is_curated), to_jsonb(p_curated));
end $$;

-- A vendor is a person before it is a company — "call Toko Amplas" is not an
-- instruction anyone can follow. Both bank accounts are on record because some
-- vendors invoice from one and collect on another, and paying into the wrong
-- one is a week of chasing.
create or replace function ops_procure.update_vendor_contact(
  p_code text,
  p_pic_name text default null, p_pic_phone text default null,
  p_phone text default null, p_address text default null,
  p_bank_account text default null, p_bank_account_secondary text default null,
  p_npwp text default null)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare v ops_procure.vendors; v_before jsonb; v_after jsonb;
begin
  if not ops_core.has_permission('procurement.update') then
    return ops_core.refused('procurement','vendor', p_code,'update_contact',
      'not_permitted','Editing a vendor needs procurement access.');
  end if;
  select * into v from ops_procure.vendors where code = p_code;
  if not found then
    return ops_core.not_found('procurement','vendor', p_code,'update_contact','No such vendor.');
  end if;

  v_before := jsonb_build_object('pic_name', v.pic_name, 'pic_phone', v.pic_phone,
    'phone', v.phone, 'address', v.address, 'bank_account', v.bank_account,
    'bank_account_secondary', v.bank_account_secondary, 'npwp', v.npwp);

  update ops_procure.vendors set
    pic_name  = coalesce(nullif(btrim(p_pic_name), ''), pic_name),
    pic_phone = coalesce(nullif(btrim(p_pic_phone), ''), pic_phone),
    phone     = coalesce(nullif(btrim(p_phone), ''), phone),
    address   = coalesce(nullif(btrim(p_address), ''), address),
    bank_account = coalesce(nullif(btrim(p_bank_account), ''), bank_account),
    bank_account_secondary =
      coalesce(nullif(btrim(p_bank_account_secondary), ''), bank_account_secondary),
    npwp      = coalesce(nullif(btrim(p_npwp), ''), npwp),
    updated_at = now()
  where id = v.id;

  select jsonb_build_object('pic_name', pic_name, 'pic_phone', pic_phone,
    'phone', phone, 'address', address, 'bank_account', bank_account,
    'bank_account_secondary', bank_account_secondary, 'npwp', npwp)
    into v_after from ops_procure.vendors where id = v.id;

  return ops_core.ok('procurement','vendor', p_code,'update_contact',
    jsonb_build_object('code', p_code), v_before, v_after);
end $$;

grant execute on function
  ops_procure.create_pr(jsonb, text, ops_procure.pr_doc_type_t, text),
  ops_procure.quick_add_line(jsonb, text, text),
  ops_procure.add_draft_line(text, jsonb),
  ops_procure.update_line(text, jsonb),
  ops_procure.request_approval(text[], ops_core.citext, jsonb, text),
  ops_procure.sync_round(),
  ops_procure.close_round(text, text),
  ops_procure.create_po(text, jsonb, numeric, text, date, text),
  ops_procure.request_po_approval(text),
  ops_procure.set_expected_delivery(text, date),
  ops_procure.mark_po_resent(text),
  ops_procure.create_receipt(numeric, ops_procure.receipt_condition_t, jsonb, text, uuid, uuid, text, text),
  ops_procure.create_vendor(text, text),
  ops_procure.create_item(text, text, text, ops_procure.item_kind_t, text),
  ops_procure.curate_item(text, boolean),
  ops_procure.update_vendor_contact(text, text, text, text, text, text, text, text)
  to authenticated;
