-- 0016_procure_seams.sql — the write functions.
--
-- `02-api.md` says which of the 65 procurement functions land as a view, which
-- as an RPC and which as a handler, and the rule for choosing is short: **a
-- seam that is only a table insert loses the audit row and the refusal** (D84).
-- Everything here writes at least three things in one transaction — the
-- business rows, one `ops_core.audit_log` row, one `ops_core.outbox` row — and all
-- three or none.
--
-- Every one of them returns an envelope rather than raising, for the reason set
-- out in `0003`: a refusal implemented as an exception rolls back its own audit
-- row, and A7 becomes a comment. `ops_core.refused(...)` writes the trail and
-- returns the answer in one call, so recording a refusal is not something a
-- seam can forget to do.
--
-- They are `security definer` because they write `ops_core.audit_log` and
-- `ops_core.outbox`, which no client may write directly. That means **each one
-- checks its own authority**: definer turns the policy off, so the guard the
-- policy would have applied has to be here, in the open, at the top of the
-- function where a reviewer reads it first.

-- Who is acting, by email, for the trail. A seam that recorded only a uuid
-- would leave every approval readable solely by joining, and a trail nobody can
-- read is a trail nobody checks (ADR-004).
create or replace function ops_procure.actor_email()
returns citext language sql stable security definer set search_path = ops_core, pg_temp as $$
  select email from ops_core.users where id = auth.uid()
$$;

/* ═══════════════════════════════════════════════════════════════════════════
   The request chain
   ═══════════════════════════════════════════════════════════════════════════ */

-- Submitting is what puts lines in front of the meeting. A document with no
-- lines is refused rather than submitted empty: an empty request on the board
-- is a row somebody has to open to discover there is nothing in it.
create or replace function ops_procure.submit_pr(p_doc_no text, p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare d ops_procure.pr_documents; n int; replayed jsonb; res jsonb;
begin
  replayed := ops_core.idem_replay('procurement','submit_pr', p_key);
  if replayed is not null then return replayed; end if;

  if not ops_core.has_permission('procurement.update') then
    return ops_core.refused('procurement','pr_document', p_doc_no,'submit',
      'not_permitted','Submitting a request needs procurement access.');
  end if;

  select * into d from ops_procure.pr_documents where doc_no = p_doc_no;
  if not found then
    return ops_core.not_found('procurement','pr_document', p_doc_no,'submit','No such request.');
  end if;
  if d.status <> 'DRAFT' then
    return ops_core.conflict('procurement','pr_document', p_doc_no,'submit',
      'already_submitted', format('%s was already submitted.', p_doc_no));
  end if;

  select count(*) into n from ops_procure.pr_lines
   where doc_id = d.id and removed_at is null;
  if n = 0 then
    return ops_core.invalid('procurement','pr_document', p_doc_no,'submit',
      'no_lines','Add at least one item before submitting.');
  end if;

  update ops_procure.pr_documents
     set status = 'SUBMITTED', submitted_at = now()
   where id = d.id;

  perform ops_core.emit('procurement','pr.submitted', p_doc_no,
    jsonb_build_object('doc_no', p_doc_no, 'lines', n));

  res := ops_core.ok('procurement','pr_document', p_doc_no,'submit',
    jsonb_build_object('doc_no', p_doc_no, 'status','SUBMITTED','lines', n));
  return ops_core.idem_remember('procurement','submit_pr', p_key, res);
end $$;

-- **The seam this schema exists for.**
--
-- `approve_goods` or 403, never a module level (D19, D24). A line with nothing
-- behind it is 422, because approving a figure with nothing to check it against
-- is the habit this system exists to end and the fix takes ten seconds on the
-- line itself (D125). A second yes on a decided line is 409, not an update —
-- the trail is append-only, and "already approved" is a different answer from
-- "approved again".
--
-- Un-approving is never blocked for want of a document: withdrawing a yes must
-- stay possible on a line whose paperwork is a mess.
create or replace function ops_procure.approve_line(
  p_line_no text,
  p_approved boolean,
  p_approved_qty numeric default null,
  p_approved_amount numeric default null,
  p_instructions text default null,
  p_remark text default null,
  p_channel ops_procure.channel_t default 'web',
  p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare
  l ops_procure.pr_lines; already boolean; supported boolean;
  v_qty numeric; v_amount numeric; replayed jsonb; res jsonb;
begin
  replayed := ops_core.idem_replay('procurement','approve_line:' || p_line_no, p_key);
  if replayed is not null then return replayed; end if;

  if not ops_core.has_authority('approve_goods') then
    return ops_core.refused('procurement','pr_line', p_line_no,'approve',
      'authority_required',
      'This decision belongs to the CEO — logged, not applied.',
      jsonb_build_object('required','approve_goods'));
  end if;

  select * into l from ops_procure.pr_lines where line_no_full = p_line_no;
  if not found then
    return ops_core.not_found('procurement','pr_line', p_line_no,'approve',
      format('Line %s not found.', p_line_no));
  end if;
  if l.removed_at is not null then
    return ops_core.conflict('procurement','pr_line', p_line_no,'approve',
      'line_removed', format('Line %s has been removed and cannot be approved.', p_line_no));
  end if;

  if p_approved then
    select coalesce(has_support, false) into supported
      from ops_procure.v_line_evidence where line_id = l.id;
    if not coalesce(supported, false) then
      return ops_core.invalid('procurement','pr_line', p_line_no,'approve',
        'support_required',
        format('%s has nothing behind it. Attach what the price came from — a link to the shop page, an invoice, a bill, or the order — then approve it.', p_line_no),
        jsonb_build_object('field','documents'));
    end if;
  end if;

  select coalesce(approved, false) into already
    from ops_procure.v_line_approval where line_id = l.id and step = 'GOODS';

  if coalesce(already, false) = p_approved then
    return ops_core.conflict('procurement','pr_line', p_line_no,'approve',
      'already_decided',
      format('This line is already %s — nothing changed.',
             case when p_approved then 'approved' else 'not approved' end));
  end if;

  -- Quantity and money move together: approving 40 of the 60 litres asked for
  -- approves two-thirds of the price, and asking somebody to do that arithmetic
  -- in their head is how an approval ends up disagreeing with itself (D65).
  --
  -- **Neither is capped at what was requested** (D76). The old rule said
  -- approval could only reduce, which assumed the request was always the higher
  -- number — but a vendor raises a price between the request and the meeting,
  -- and a leader approving Rp 4.500.000 for something asked at Rp 4.275.000 is
  -- making a real decision, not a mistake. What that leaves behind is a gap
  -- between requested and approved, which the line already reports.
  v_qty    := coalesce(p_approved_qty, l.qty);
  v_amount := coalesce(p_approved_amount, l.item_total);

  insert into ops_procure.pr_approvals
    (line_id, step, approved, approved_qty, approved_amount,
     recorded_by, recorded_by_email, channel)
  values (l.id, 'GOODS', p_approved,
          case when p_approved then v_qty else null end,
          case when p_approved then v_amount else null end,
          auth.uid(), ops_procure.actor_email(), p_channel);

  -- Leadership's own words, recorded with the decision when they write any, as
  -- a note row rather than as columns on the decision (D64).
  if coalesce(btrim(p_instructions), '') <> '' or coalesce(btrim(p_remark), '') <> '' then
    insert into ops_procure.line_notes
      (line_id, instructions, remark, recorded_by, recorded_by_email)
    values (l.id, nullif(btrim(p_instructions), ''), nullif(btrim(p_remark), ''),
            auth.uid(), ops_procure.actor_email());
  end if;

  -- A decision taken here answers the card sitting in chat. Leaving it open
  -- would mean the approver is still being asked for something already settled
  -- — and the answer they then gave would land as a 409 on their own decision.
  update ops_procure.approval_requests
     set answered_at = now(),
         outcome = case when p_approved then 'approved' else 'declined' end::ops_procure.request_outcome_t
   where line_id = l.id and answered_at is null;

  perform ops_core.emit('procurement','procurement.line.approved', p_line_no,
    jsonb_build_object('line_no', p_line_no, 'approved', p_approved, 'amount', v_amount));

  res := ops_core.ok('procurement','pr_line', p_line_no,
    case when p_approved then 'approve' else 'unapprove' end,
    jsonb_build_object('line_no', p_line_no, 'approved', p_approved,
                       'approved_qty', v_qty, 'approved_amount', v_amount));
  return ops_core.idem_remember('procurement','approve_line:' || p_line_no, p_key, res);
end $$;

-- Removal is soft and audited (D29), and **refused once money has reached the
-- line**. A line somebody has paid against is a line with a fact attached to
-- it; taking it off the board would leave the payment pointing at nothing, and
-- an allocation pointing at nothing is the state `v_line_coverage` exists to
-- make visible rather than possible.
create or replace function ops_procure.remove_line(p_line_no text, p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
-- `v_covered`, not `covered`: a PL/pgSQL variable sharing a name with a column
-- in a query below it is ambiguous, and Postgres refuses the query rather than
-- guessing — correctly, and at run time rather than at create time, which is
-- why this was found by the smoke and not by the migration applying.
declare l ops_procure.pr_lines; v_covered numeric; replayed jsonb; res jsonb;
begin
  replayed := ops_core.idem_replay('procurement','remove_line:' || p_line_no, p_key);
  if replayed is not null then return replayed; end if;

  if not ops_core.has_permission('procurement.update') then
    return ops_core.refused('procurement','pr_line', p_line_no,'remove',
      'not_permitted','Removing a line needs procurement access.');
  end if;

  select * into l from ops_procure.pr_lines where line_no_full = p_line_no;
  if not found then
    return ops_core.not_found('procurement','pr_line', p_line_no,'remove','No such line.');
  end if;
  if l.removed_at is not null then
    return ops_core.noop('procurement','pr_line', p_line_no,'remove',
      'already removed', jsonb_build_object('line_no', p_line_no));
  end if;

  select cov.covered into v_covered from ops_procure.v_line_coverage cov where cov.line_id = l.id;
  if coalesce(v_covered, 0) > 0 then
    return ops_core.conflict('procurement','pr_line', p_line_no,'remove',
      'money_has_reached_it',
      format('%s has been paid against and cannot be removed. Void the payment first, or settle it with a reason.', p_line_no),
      jsonb_build_object('covered', v_covered));
  end if;

  update ops_procure.pr_lines
     set removed_at = now(), removed_by = auth.uid()
   where id = l.id;

  perform ops_core.emit('procurement','procurement.line.removed', p_line_no,
    jsonb_build_object('line_no', p_line_no));

  res := ops_core.ok('procurement','pr_line', p_line_no,'remove',
    jsonb_build_object('line_no', p_line_no));
  return ops_core.idem_remember('procurement','remove_line:' || p_line_no, p_key, res);
end $$;

-- A word from leadership on a line. Its own seam rather than a column on the
-- approval, because a note can be left on a line nobody has decided yet —
-- which is exactly when "get another quote" is worth saying.
create or replace function ops_procure.note_line(
  p_line_no text, p_instructions text default null, p_remark text default null)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare l ops_procure.pr_lines;
begin
  if not (ops_core.has_authority('approve_goods') or ops_core.has_authority('approve_funds')) then
    return ops_core.refused('procurement','pr_line', p_line_no,'note',
      'authority_required','An instruction on a line is leadership''s to leave (D64).');
  end if;
  if coalesce(btrim(p_instructions), '') = '' and coalesce(btrim(p_remark), '') = '' then
    return ops_core.invalid('procurement','pr_line', p_line_no,'note',
      'empty_note','Write an instruction or a remark.');
  end if;

  select * into l from ops_procure.pr_lines where line_no_full = p_line_no;
  if not found then
    return ops_core.not_found('procurement','pr_line', p_line_no,'note','No such line.');
  end if;

  insert into ops_procure.line_notes (line_id, instructions, remark, recorded_by, recorded_by_email)
  values (l.id, nullif(btrim(p_instructions), ''), nullif(btrim(p_remark), ''),
          auth.uid(), ops_procure.actor_email());

  perform ops_core.emit('procurement','procurement.line.noted', p_line_no,
    jsonb_build_object('line_no', p_line_no));
  return ops_core.ok('procurement','pr_line', p_line_no,'note',
    jsonb_build_object('line_no', p_line_no));
end $$;

-- Explaining a gap. The amount is frozen at the moment of explanation, so a
-- later payment does not silently rewrite what was being explained.
create or replace function ops_procure.explain_variance(
  p_line_no text, p_reason ops_procure.variance_reason_t, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare l ops_procure.pr_lines; d numeric; mat boolean;
begin
  if not ops_core.has_permission('procurement.update') then
    return ops_core.refused('procurement','pr_line', p_line_no,'explain_variance',
      'not_permitted','Explaining a variance needs procurement access.');
  end if;

  select * into l from ops_procure.pr_lines where line_no_full = p_line_no;
  if not found then
    return ops_core.not_found('procurement','pr_line', p_line_no,'explain_variance','No such line.');
  end if;

  select delta, material into d, mat from ops_procure.v_line_variance where line_id = l.id;
  if not coalesce(mat, false) then
    -- Below the tolerance there is nothing to explain, and recording an
    -- explanation anyway would put a reason on the record for an event that is
    -- arithmetic. Refusing keeps the variance list worth reading.
    return ops_core.invalid('procurement','pr_line', p_line_no,'explain_variance',
      'no_material_variance',
      format('%s has no variance worth explaining.', p_line_no),
      jsonb_build_object('delta', d));
  end if;

  insert into ops_procure.line_variances
    (line_id, reason, note, amount_at_time, recorded_by, recorded_by_email)
  values (l.id, p_reason, nullif(btrim(p_note), ''), d, auth.uid(), ops_procure.actor_email());

  perform ops_core.emit('procurement','procurement.variance.explained', p_line_no,
    jsonb_build_object('line_no', p_line_no, 'reason', p_reason, 'delta', d));
  return ops_core.ok('procurement','pr_line', p_line_no,'explain_variance',
    jsonb_build_object('line_no', p_line_no, 'reason', p_reason, 'amount_at_time', d));
end $$;

/* ═══════════════════════════════════════════════════════════════════════════
   Asking, and answering
   ═══════════════════════════════════════════════════════════════════════════ */

-- The answer coming back from chat.
--
-- **The identity does not come from `auth.uid()`.** It comes from the token
-- plus the email the chat platform authenticated, which is the whole reason the
-- question left the room (D69). A caller holding `approve_goods` in this app is
-- not what makes this valid; the signed webhook that delivered the answer is,
-- and verifying that signature is the handler's job before it calls this.
--
-- A second answer to an answered request is **409, not an update**: the first
-- answer is what happened, and a card answered twice means two people were
-- asked and both replied — which is worth knowing, not worth overwriting.
create or replace function ops_procure.answer_request(
  p_token text, p_approved boolean, p_answered_by_email citext,
  p_instructions text default null, p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare
  r ops_procure.approval_requests; l ops_procure.pr_lines;
  answerer uuid; already boolean; replayed jsonb; res jsonb;
begin
  replayed := ops_core.idem_replay('procurement','answer_request', p_key);
  if replayed is not null then return replayed; end if;

  select * into r from ops_procure.approval_requests where token = p_token;
  if not found then
    return ops_core.not_found('procurement','approval_request', p_token,'answer',
      'That approval card is not one we sent.');
  end if;

  if r.answered_at is not null then
    return ops_core.conflict('procurement','approval_request', p_token,'answer',
      'already_answered',
      format('This was already %s.', r.outcome));
  end if;

  -- The card is addressed, not broadcast. Somebody else's answer on somebody
  -- else's card is not an approval, whatever authority they hold here.
  if lower(p_answered_by_email::text) <> lower(r.sent_to_email::text) then
    return ops_core.refused('procurement','approval_request', p_token,'answer',
      'not_the_approver',
      format('This was asked of %s.', r.sent_to_email),
      jsonb_build_object('expected', r.sent_to_email, 'answered_by', p_answered_by_email));
  end if;

  select * into l from ops_procure.pr_lines where id = r.line_id;

  -- Answered means answered: a line decided in the app leaves the card
  -- standing, and the honest answer to a late reply is that it is stale, not a
  -- second approval row (D69).
  select coalesce(approved, false) into already
    from ops_procure.v_line_approval where line_id = l.id and step = 'GOODS';
  if coalesce(already, false) = p_approved then
    update ops_procure.approval_requests
       set answered_at = now(),
           outcome = case when p_approved then 'approved' else 'declined' end::ops_procure.request_outcome_t
     where id = r.id;
    return ops_core.conflict('procurement','approval_request', p_token,'answer',
      'line_already_decided',
      format('%s was already decided here. The card is closed, and nothing changed.', l.line_no_full));
  end if;

  select id into answerer from ops_core.users where email = p_answered_by_email;

  insert into ops_procure.pr_approvals
    (line_id, step, approved, approved_qty, approved_amount,
     recorded_by, recorded_by_email, channel)
  values (l.id,'GOODS', p_approved,
          case when p_approved then l.qty else null end,
          case when p_approved then l.item_total else null end,
          answerer, p_answered_by_email, r.channel);

  -- The meeting's words prefill the approver's instruction field; sent back
  -- unchanged they become theirs, deliberately and visibly (D127).
  if coalesce(btrim(p_instructions), '') <> '' then
    insert into ops_procure.line_notes (line_id, instructions, recorded_by, recorded_by_email)
    values (l.id, btrim(p_instructions), answerer, p_answered_by_email);
  end if;

  update ops_procure.approval_requests
     set answered_at = now(),
         outcome = case when p_approved then 'approved' else 'declined' end::ops_procure.request_outcome_t
   where id = r.id;

  perform ops_core.emit('procurement','procurement.line.approved', l.line_no_full,
    jsonb_build_object('line_no', l.line_no_full, 'approved', p_approved,
                       'channel', r.channel, 'by', p_answered_by_email));

  res := ops_core.ok('procurement','pr_line', l.line_no_full,
    case when p_approved then 'approve' else 'unapprove' end,
    jsonb_build_object('line_no', l.line_no_full, 'approved', p_approved,
                       'by', p_answered_by_email, 'channel', r.channel));
  return ops_core.idem_remember('procurement','answer_request', p_key, res);
end $$;

/* ═══════════════════════════════════════════════════════════════════════════
   Purchase orders
   ═══════════════════════════════════════════════════════════════════════════ */

create or replace function ops_procure.approve_po(
  p_po_no text, p_note text default null, p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare po ops_procure.purchase_orders; replayed jsonb; res jsonb;
begin
  replayed := ops_core.idem_replay('procurement','approve_po:' || p_po_no, p_key);
  if replayed is not null then return replayed; end if;

  if not ops_core.has_authority('approve_goods') then
    return ops_core.refused('procurement','purchase_order', p_po_no,'approve',
      'authority_required',
      'Confirming an order belongs to the CEO — logged, not applied.',
      jsonb_build_object('required','approve_goods'));
  end if;

  select * into po from ops_procure.purchase_orders where po_no = p_po_no;
  if not found then
    return ops_core.not_found('procurement','purchase_order', p_po_no,'approve','No such order.');
  end if;
  if po.approved_at is not null then
    return ops_core.conflict('procurement','purchase_order', p_po_no,'approve',
      'already_approved', format('%s was already confirmed.', p_po_no));
  end if;

  update ops_procure.purchase_orders
     set approved_at = now(), approved_by = auth.uid(),
         approval_note = nullif(btrim(p_note), '')
   where id = po.id;

  perform ops_core.emit('procurement','procurement.po.approved', p_po_no,
    jsonb_build_object('po_no', p_po_no));
  res := ops_core.ok('procurement','purchase_order', p_po_no,'approve',
    jsonb_build_object('po_no', p_po_no));
  return ops_core.idem_remember('procurement','approve_po:' || p_po_no, p_key, res);
end $$;

-- Issuing is sending the paper. **An order is confirmed before it is sent, not
-- after** (D132) — this is the one place in procurement where warn-don't-block
-- does not apply, because what is at stake is a commitment made to somebody
-- outside the company in its name.
create or replace function ops_procure.issue_po(p_po_no text, p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare po ops_procure.purchase_orders; n int; replayed jsonb; res jsonb;
begin
  replayed := ops_core.idem_replay('procurement','issue_po:' || p_po_no, p_key);
  if replayed is not null then return replayed; end if;

  if not ops_core.has_permission('procurement.update') then
    return ops_core.refused('procurement','purchase_order', p_po_no,'issue',
      'not_permitted','Issuing an order needs procurement access.');
  end if;

  select * into po from ops_procure.purchase_orders where po_no = p_po_no;
  if not found then
    return ops_core.not_found('procurement','purchase_order', p_po_no,'issue','No such order.');
  end if;
  if po.status <> 'DRAFT' then
    return ops_core.conflict('procurement','purchase_order', p_po_no,'issue',
      'already_issued', format('%s has already been issued.', p_po_no));
  end if;
  if po.approved_at is null then
    return ops_core.invalid('procurement','purchase_order', p_po_no,'issue',
      'not_approved',
      format('%s has not been confirmed by leadership. An order is a promise in the company''s name, and it is confirmed before it is sent.', p_po_no));
  end if;

  select count(*) into n from ops_procure.po_lines
   where po_id = po.id and superseded_by is null;
  if n = 0 then
    return ops_core.invalid('procurement','purchase_order', p_po_no,'issue',
      'no_lines','An order with no lines is a blank page with a signature on it.');
  end if;

  update ops_procure.purchase_orders
     set status = 'ISSUED', issued_at = now(), issued_by = auth.uid(),
         sent_revision = revision
   where id = po.id;

  perform ops_core.emit('procurement','procurement.po.issued', p_po_no,
    jsonb_build_object('po_no', p_po_no, 'lines', n, 'revision', po.revision));
  res := ops_core.ok('procurement','purchase_order', p_po_no,'issue',
    jsonb_build_object('po_no', p_po_no, 'status','ISSUED'));
  return ops_core.idem_remember('procurement','issue_po:' || p_po_no, p_key, res);
end $$;

-- An amendment after issue is a **revision**, not an edit (D135). The old line
-- stays, pointing forward; the vendor holds a piece of paper and two of them
-- have to be tellable apart.
create or replace function ops_procure.amend_po_line(
  p_po_no text, p_line_no int,
  p_qty numeric, p_unit_price numeric, p_description text default null,
  p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare
  po ops_procure.purchase_orders; old ops_procure.po_lines; new_id uuid;
  replayed jsonb; res jsonb;
begin
  replayed := ops_core.idem_replay('procurement',
    format('amend_po_line:%s:%s', p_po_no, p_line_no), p_key);
  if replayed is not null then return replayed; end if;

  if not ops_core.has_permission('procurement.update') then
    return ops_core.refused('procurement','purchase_order', p_po_no,'amend',
      'not_permitted','Amending an order needs procurement access.');
  end if;

  select * into po from ops_procure.purchase_orders where po_no = p_po_no;
  if not found then
    return ops_core.not_found('procurement','purchase_order', p_po_no,'amend','No such order.');
  end if;
  if po.status in ('CLOSED','CANCELLED') then
    return ops_core.conflict('procurement','purchase_order', p_po_no,'amend',
      'order_closed', format('%s is %s.', p_po_no, lower(po.status::text)));
  end if;
  if p_qty <= 0 or p_unit_price < 0 then
    return ops_core.invalid('procurement','purchase_order', p_po_no,'amend',
      'bad_values','A quantity is more than nothing and a price is not negative.');
  end if;

  select * into old from ops_procure.po_lines
   where po_id = po.id and line_no = p_line_no and superseded_by is null;
  if not found then
    return ops_core.not_found('procurement','purchase_order', p_po_no,'amend',
      format('Line %s is not on this order.', p_line_no));
  end if;

  -- **Retire the old row first, then create the new one.** The other order
  -- leaves both live for an instant, both claiming the vendor's line number,
  -- and `po_lines_live_no_idx` refuses it — correctly. The id is minted here so
  -- the old row can point at a line that does not exist yet; the foreign key is
  -- `deferrable initially deferred` for exactly this, and it is still checked
  -- before the transaction commits.
  new_id := gen_random_uuid();
  update ops_procure.po_lines set superseded_by = new_id where id = old.id;

  insert into ops_procure.po_lines
    (id, po_id, line_no, item_id, description, qty, uom, unit_price, line_total)
  values (new_id, po.id, old.line_no, old.item_id,
          coalesce(nullif(btrim(p_description), ''), old.description),
          p_qty, old.uom, p_unit_price, round(p_qty * p_unit_price));

  -- Only an issued order's revision moves. Amending a draft is just editing it,
  -- and bumping the number there would tell a vendor their paper is out of date
  -- when they have never been sent one.
  if po.status = 'ISSUED' then
    update ops_procure.purchase_orders set revision = revision + 1 where id = po.id;
  end if;

  perform ops_core.emit('procurement','procurement.po.amended', p_po_no,
    jsonb_build_object('po_no', p_po_no, 'line_no', p_line_no,
                       'from', jsonb_build_object('qty', old.qty, 'unit_price', old.unit_price),
                       'to',   jsonb_build_object('qty', p_qty, 'unit_price', p_unit_price)));

  res := ops_core.ok('procurement','purchase_order', p_po_no,'amend',
    jsonb_build_object('po_no', p_po_no, 'line_no', p_line_no, 'po_line_id', new_id),
    jsonb_build_object('qty', old.qty, 'unit_price', old.unit_price, 'line_total', old.line_total),
    jsonb_build_object('qty', p_qty, 'unit_price', p_unit_price, 'line_total', round(p_qty * p_unit_price)));
  return ops_core.idem_remember('procurement',
    format('amend_po_line:%s:%s', p_po_no, p_line_no), p_key, res);
end $$;

-- Closing refuses while anything is outstanding, **and says which** (D132). A
-- refusal that only says no leaves somebody clicking it again next week; the
-- blockers are the answer to "what do I do about it".
create or replace function ops_procure.close_po(p_po_no text, p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare
  po ops_procure.purchase_orders; s record;
  -- Cast every append: `text[] || 'literal'` leaves Postgres choosing between
  -- array-concat and element-append on an untyped literal, and it picks the
  -- former, which fails at run time rather than at create time.
  blockers text[] := '{}';
  replayed jsonb; res jsonb;
begin
  replayed := ops_core.idem_replay('procurement','close_po:' || p_po_no, p_key);
  if replayed is not null then return replayed; end if;

  if not ops_core.has_authority('approve_funds') then
    return ops_core.refused('procurement','purchase_order', p_po_no,'close',
      'authority_required','Closing an order is Finance''s to do — it says we owe nothing more on it.');
  end if;

  select * into po from ops_procure.purchase_orders where po_no = p_po_no;
  if not found then
    return ops_core.not_found('procurement','purchase_order', p_po_no,'close','No such order.');
  end if;
  if po.status = 'CLOSED' then
    return ops_core.noop('procurement','purchase_order', p_po_no,'close',
      'already closed', jsonb_build_object('po_no', p_po_no));
  end if;
  if po.status = 'DRAFT' then
    blockers := blockers || 'It was never issued — cancel it rather than close it.'::text;
  end if;

  select * into s from ops_procure.v_po_status where po_id = po.id;
  if s.outstanding > 0 then
    blockers := blockers || format('%s of the contract has not been paid.', s.outstanding);
  end if;
  if not s.fully_delivered then
    blockers := blockers || 'Not everything ordered has arrived.'::text;
  end if;

  if array_length(blockers, 1) > 0 then
    return ops_core.invalid('procurement','purchase_order', p_po_no,'close',
      'close_blocked',
      format('%s cannot be closed yet.', p_po_no),
      jsonb_build_object('blockers', to_jsonb(blockers)));
  end if;

  update ops_procure.purchase_orders set status = 'CLOSED' where id = po.id;

  perform ops_core.emit('procurement','procurement.po.closed', p_po_no,
    jsonb_build_object('po_no', p_po_no));
  res := ops_core.ok('procurement','purchase_order', p_po_no,'close',
    jsonb_build_object('po_no', p_po_no, 'status','CLOSED'));
  return ops_core.idem_remember('procurement','close_po:' || p_po_no, p_key, res);
end $$;

/* ═══════════════════════════════════════════════════════════════════════════
   Receiving
   ═══════════════════════════════════════════════════════════════════════════ */

-- Confirming is the accountable half (D131). It is what turns an arrival into
-- value received, so it names who signed for it — the constraint in `0012` makes
-- that unavoidable, and this is where the person is asked for.
create or replace function ops_procure.confirm_receipt(
  p_receipt_no text, p_qc_by uuid default null, p_note text default null,
  p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare r ops_procure.receipts; replayed jsonb; res jsonb;
begin
  replayed := ops_core.idem_replay('procurement','confirm_receipt:' || p_receipt_no, p_key);
  if replayed is not null then return replayed; end if;

  if not ops_core.has_permission('procurement.update') then
    return ops_core.refused('procurement','receipt', p_receipt_no,'confirm',
      'not_permitted',
      'Signing for a delivery is procurement''s — they hold the order and can check what arrived against it.');
  end if;

  select * into r from ops_procure.receipts where receipt_no = p_receipt_no;
  if not found then
    return ops_core.not_found('procurement','receipt', p_receipt_no,'confirm','No such receipt.');
  end if;
  if r.status = 'CONFIRMED' then
    return ops_core.conflict('procurement','receipt', p_receipt_no,'confirm',
      'already_confirmed', format('%s was already signed for.', p_receipt_no));
  end if;

  update ops_procure.receipts
     set status = 'CONFIRMED', confirmed_by = auth.uid(), confirmed_at = now(),
         qc_by = coalesce(p_qc_by, auth.uid()),
         note  = coalesce(nullif(btrim(p_note), ''), note)
   where id = r.id;

  perform ops_core.emit('procurement','procurement.receipt.confirmed', p_receipt_no,
    jsonb_build_object('receipt_no', p_receipt_no, 'qty', r.qty_received,
                       'condition', r.condition));
  res := ops_core.ok('procurement','receipt', p_receipt_no,'confirm',
    jsonb_build_object('receipt_no', p_receipt_no, 'status','CONFIRMED'));
  return ops_core.idem_remember('procurement','confirm_receipt:' || p_receipt_no, p_key, res);
end $$;

/* ═══════════════════════════════════════════════════════════════════════════
   Rounds
   ═══════════════════════════════════════════════════════════════════════════ */

-- Approving freezes the figures, because they are the record of a decision: an
-- OPEN round is recomputed from what is still owed, and once approved it keeps
-- what leadership actually said yes to, whatever the lines do afterwards.
create or replace function ops_procure.approve_round(p_round_no text, p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare r ops_procure.payment_rounds; v_total numeric; replayed jsonb; res jsonb;
begin
  replayed := ops_core.idem_replay('procurement','approve_round:' || p_round_no, p_key);
  if replayed is not null then return replayed; end if;

  if not ops_core.has_authority('approve_funds') then
    return ops_core.refused('procurement','payment_round', p_round_no,'approve',
      'authority_required','Approving money belongs to Finance — logged, not applied.',
      jsonb_build_object('required','approve_funds'));
  end if;

  select * into r from ops_procure.payment_rounds where round_no = p_round_no;
  if not found then
    return ops_core.not_found('procurement','payment_round', p_round_no,'approve','No such round.');
  end if;
  if r.status <> 'OPEN' then
    return ops_core.conflict('procurement','payment_round', p_round_no,'approve',
      'already_approved', format('%s is already %s.', p_round_no, r.status));
  end if;

  -- Freeze each line at what is still owed on it right now.
  update ops_procure.payment_round_lines rl
     set requested_amount = cov.remaining
    from ops_procure.v_line_coverage cov
   where cov.line_id = rl.line_id and rl.round_id = r.id;

  select coalesce(sum(requested_amount), 0) into v_total
    from ops_procure.payment_round_lines where round_id = r.id;

  if v_total <= 0 then
    return ops_core.invalid('procurement','payment_round', p_round_no,'approve',
      'nothing_owed','Every line in this round has already been paid.');
  end if;

  update ops_procure.payment_rounds
     set status = 'APPROVED', approved_at = now(), approved_by = auth.uid()
   where id = r.id;

  perform ops_core.emit('procurement','procurement.round.approved', p_round_no,
    jsonb_build_object('round_no', p_round_no, 'requested_total', v_total));
  res := ops_core.ok('procurement','payment_round', p_round_no,'approve',
    jsonb_build_object('round_no', p_round_no, 'status','APPROVED','requested_total', v_total));
  return ops_core.idem_remember('procurement','approve_round:' || p_round_no, p_key, res);
end $$;

-- Recording an instalment. **A funded round still pays nobody** (A10) — the
-- status moves to TRANSFERRED and not one line becomes PAID, which is the whole
-- of D6 expressed as code rather than as a comment.
create or replace function ops_procure.transfer_round(
  p_round_no text, p_amount numeric, p_trx_no text, p_proof uuid,
  p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare r ops_procure.payment_rounds; v_total numeric; v_requested numeric; replayed jsonb; res jsonb;
begin
  replayed := ops_core.idem_replay('procurement','transfer_round:' || p_round_no, p_key);
  if replayed is not null then return replayed; end if;

  if not ops_core.has_authority('approve_funds') then
    return ops_core.refused('procurement','payment_round', p_round_no,'transfer',
      'authority_required','Recording an instalment belongs to Finance.');
  end if;

  select * into r from ops_procure.payment_rounds where round_no = p_round_no;
  if not found then
    return ops_core.not_found('procurement','payment_round', p_round_no,'transfer','No such round.');
  end if;
  if r.status = 'OPEN' then
    return ops_core.invalid('procurement','payment_round', p_round_no,'transfer',
      'not_approved','Approve the round before funding it.');
  end if;
  if r.status = 'CLOSED' then
    return ops_core.conflict('procurement','payment_round', p_round_no,'transfer',
      'round_closed', format('%s is closed.', p_round_no));
  end if;
  if p_amount is null or p_amount <= 0 then
    return ops_core.invalid('procurement','payment_round', p_round_no,'transfer',
      'bad_amount','An instalment is more than nothing.');
  end if;
  if not exists (select 1 from ops_acct.transactions where trx_no = p_trx_no and status <> 'VOID') then
    -- Validated at the seam, by code, never by a foreign key across the service
    -- boundary (ADR-004).
    return ops_core.invalid('procurement','payment_round', p_round_no,'transfer',
      'no_such_transaction',
      format('%s is not a live ledger row. Book the money in first.', p_trx_no));
  end if;
  if exists (select 1 from ops_procure.round_transfers
              where round_id = r.id and trx_no = p_trx_no) then
    return ops_core.conflict('procurement','payment_round', p_round_no,'transfer',
      'already_recorded',
      format('%s is already recorded against this round.', p_trx_no));
  end if;

  insert into ops_procure.round_transfers
    (round_id, amount, trx_no, proof_attachment_id, recorded_by, recorded_by_email)
  values (r.id, p_amount, p_trx_no, p_proof, auth.uid(), ops_procure.actor_email());

  select coalesce(sum(amount), 0) into v_total
    from ops_procure.round_transfers where round_id = r.id;
  select requested_total into v_requested
    from ops_procure.v_round_summary where round_id = r.id;

  update ops_procure.payment_rounds set status = 'TRANSFERRED' where id = r.id;

  perform ops_core.emit('procurement','procurement.round.transferred', p_round_no,
    jsonb_build_object('round_no', p_round_no, 'amount', p_amount,
                       'transferred_total', v_total, 'requested_total', v_requested));
  res := ops_core.ok('procurement','payment_round', p_round_no,'transfer',
    jsonb_build_object('round_no', p_round_no, 'status','TRANSFERRED',
                       'transferred_total', v_total,
                       'shortfall', greatest(v_requested - v_total, 0)));
  return ops_core.idem_remember('procurement','transfer_round:' || p_round_no, p_key, res);
end $$;

/* ═══════════════════════════════════════════════════════════════════════════
   Reference data
   ═══════════════════════════════════════════════════════════════════════════ */

-- **A merge is a pointer, and never a delete** (D33, D41). The loser row stays,
-- so a PO raised against it in March still resolves and its history stays where
-- it happened; readers follow the pointer. The loser's alternate spellings move
-- to the winner, which is what keeps the extractor able to recognise what people
-- actually write.
create or replace function ops_procure.merge_vendor(p_loser_code text, p_winner_code text)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare loser ops_procure.vendors; winner ops_procure.vendors;
begin
  if not ops_core.has_permission('procurement.update') then
    return ops_core.refused('procurement','vendor', p_loser_code,'merge',
      'not_permitted','Merging vendors needs procurement access.');
  end if;

  select * into loser  from ops_procure.vendors where code = p_loser_code;
  if not found then
    return ops_core.not_found('procurement','vendor', p_loser_code,'merge','No such vendor.');
  end if;
  select * into winner from ops_procure.vendors where code = p_winner_code;
  if not found then
    return ops_core.not_found('procurement','vendor', p_winner_code,'merge','No such vendor.');
  end if;
  if loser.id = winner.id then
    return ops_core.invalid('procurement','vendor', p_loser_code,'merge',
      'merge_into_self','A vendor cannot absorb itself.');
  end if;
  if loser.merged_into is not null then
    return ops_core.conflict('procurement','vendor', p_loser_code,'merge',
      'already_merged', format('%s has already been merged away.', p_loser_code));
  end if;
  -- A points at B and B points at A leaves two rows neither of which resolves.
  if winner.merged_into = loser.id then
    return ops_core.invalid('procurement','vendor', p_loser_code,'merge',
      'circular_merge', format('%s is already pointing at %s.', p_winner_code, p_loser_code));
  end if;

  update ops_procure.vendors
     set aka = (select array_agg(distinct x)
                  from unnest(winner.aka || loser.aka || array[loser.name]) x),
         updated_at = now()
   where id = winner.id;

  update ops_procure.vendors
     set merged_into = winner.id, updated_at = now()
   where id = loser.id;

  perform ops_core.emit('procurement','procurement.vendor.merged', p_loser_code,
    jsonb_build_object('loser', p_loser_code, 'winner', p_winner_code));
  return ops_core.ok('procurement','vendor', p_loser_code,'merge',
    jsonb_build_object('loser', p_loser_code, 'winner', p_winner_code),
    to_jsonb(loser.merged_into), to_jsonb(winner.id));
end $$;

-- Curation is a flag with a name and a date on it, never a gate: an uncurated
-- vendor is usable, because refusing one is how a workshop ends up buying
-- off-system (D30).
create or replace function ops_procure.curate_vendor(p_code text, p_curated boolean)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare v ops_procure.vendors;
begin
  if not ops_core.has_permission('procurement.update') then
    return ops_core.refused('procurement','vendor', p_code,'curate',
      'not_permitted','Curating needs procurement access.');
  end if;
  select * into v from ops_procure.vendors where code = p_code;
  if not found then
    return ops_core.not_found('procurement','vendor', p_code,'curate','No such vendor.');
  end if;
  if v.is_curated = p_curated then
    return ops_core.noop('procurement','vendor', p_code,'curate',
      'already in that state', jsonb_build_object('code', p_code, 'is_curated', p_curated));
  end if;

  update ops_procure.vendors set is_curated = p_curated, updated_at = now() where id = v.id;

  return ops_core.ok('procurement','vendor', p_code,'curate',
    jsonb_build_object('code', p_code, 'is_curated', p_curated),
    to_jsonb(v.is_curated), to_jsonb(p_curated));
end $$;

grant execute on function
  ops_procure.submit_pr(text, text),
  ops_procure.approve_line(text, boolean, numeric, numeric, text, text, ops_procure.channel_t, text),
  ops_procure.remove_line(text, text),
  ops_procure.note_line(text, text, text),
  ops_procure.explain_variance(text, ops_procure.variance_reason_t, text),
  ops_procure.answer_request(text, boolean, citext, text, text),
  ops_procure.approve_po(text, text, text),
  ops_procure.issue_po(text, text),
  ops_procure.amend_po_line(text, int, numeric, numeric, text, text),
  ops_procure.close_po(text, text),
  ops_procure.confirm_receipt(text, uuid, text, text),
  ops_procure.approve_round(text, text),
  ops_procure.transfer_round(text, numeric, text, uuid, text),
  ops_procure.merge_vendor(text, text),
  ops_procure.curate_vendor(text, boolean),
  ops_procure.actor_email()
  to authenticated;
