-- 0133 — the two roads to a confirmed order, both in the database (D267, D69).
--
-- The owner, restating the rule: *a PO needs leadership's approval — either
-- leadership writes it and approves it, or staff write it and it goes to
-- leadership's Google Chat*. Checking the live ladder against that sentence
-- found both roads half-built:
--
-- 1. **Leadership writing their own.** The demo confirms it in the same act
--    (D267); `create_po` did not, so in the live system the CEO's own order
--    sat unconfirmed until he asked himself for approval. Now `create_po`
--    confirms it when the author holds `approve_goods`, stores
--    `self_confirmed`, and emits the approval as its own event.
--
-- 2. **Staff writing it, answered from Chat.** `request_po_approval` already
--    picks the approver by authority, mints a token (D72) and emits
--    `procurement.po.approval_requested`. What did not exist was the other
--    half: a seam for the answer. `answer_po_approval` is it, the twin of the
--    demo's `answerPoFromChat` and of `answer_request` for request lines.
--
-- ── who may call the answer ──────────────────────────────────────────────
--
-- **Only the chat worker** (`service_role`), never a browser. D69: the
-- identity on an approval comes from the chat platform's authentication, not
-- from a session — the meeting laptop is logged in as somebody else. So the
-- seam takes the answerer's address as the worker verified it, checks it is
-- the address the card was sent to, and records the decision against *that*
-- account. Leadership in the app still confirm with `approve_po`, which
-- records `auth.uid()`; the two roads meet on the same columns.
--
-- The token is deliberately **not** in the outbox payload: `ops_core.outbox`
-- is readable by signed-in users, and a token is a capability. The worker
-- reads it from the order with its own key when it builds the card.

create or replace function ops_procure.create_po(p_vendor_code text, p_lines jsonb, p_dp_percent numeric DEFAULT NULL::numeric, p_note text DEFAULT NULL::text, p_expected_delivery date DEFAULT NULL::date, p_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'ops_procure', 'ops_core', 'pg_temp'
AS $$
declare
  v ops_procure.vendors; v_po_no text; v_po_id uuid; n int; priceless text;
  replayed jsonb; res jsonb; x record; v_dup text; v_self boolean;
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

  -- ── the request line each order line buys (B7) ─────────────────────────
  -- Optional, because not every order starts from a request (a standing
  -- contract, a repair the vendor quoted on the spot). When one is named it
  -- has to be a line somebody said yes to, it cannot already be on another
  -- live order, and it has to be counted in the same unit — otherwise the
  -- arrivals this order records would move the request line by the wrong
  -- number.
  select l ->> 'pr_line_no' into v_dup
    from jsonb_array_elements(p_lines) l
   where nullif(l ->> 'pr_line_no','') is not null
   group by 1 having count(*) > 1 limit 1;
  if v_dup is not null then
    return ops_core.invalid('procurement','purchase_order', null,'create',
      'line_named_twice', format('%s is named on two lines of this order.', v_dup),
      jsonb_build_object('field','lines'));
  end if;

  for x in
    select l ->> 'pr_line_no' as want, l ->> 'uom' as uom, pl.id, pl.removed_at, pl.uom as pr_uom,
           pl.qty as pr_qty, ap.approved,
           (select p2.po_no from ops_procure.po_lines o
              join ops_procure.purchase_orders p2 on p2.id = o.po_id
             where o.pr_line_id = pl.id and o.superseded_by is null
               and p2.status <> 'CANCELLED' limit 1) as on_po
      from jsonb_array_elements(p_lines) l
      left join ops_procure.pr_lines pl on pl.line_no_full = l ->> 'pr_line_no'
      left join ops_procure.v_line_approval ap on ap.line_id = pl.id and ap.step = 'GOODS'
     where nullif(l ->> 'pr_line_no','') is not null
  loop
    if x.id is null then
      return ops_core.invalid('procurement','purchase_order', null,'create',
        'pr_line_not_found', format('Request line %s does not exist.', x.want),
        jsonb_build_object('field','lines'));
    end if;
    if x.removed_at is not null then
      return ops_core.conflict('procurement','purchase_order', null,'create',
        'line_removed', format('Request line %s has been removed.', x.want));
    end if;
    if x.approved is not true then
      return ops_core.conflict('procurement','purchase_order', null,'create',
        'line_not_approved',
        format('Request line %s has no goods approval. Approving the goods comes before ordering them.', x.want),
        jsonb_build_object('pr_line_no', x.want));
    end if;
    if x.on_po is not null then
      return ops_core.conflict('procurement','purchase_order', null,'create',
        'line_already_ordered',
        format('Request line %s is already ordered on %s.', x.want, x.on_po),
        jsonb_build_object('pr_line_no', x.want, 'po_no', x.on_po));
    end if;
    -- A line with no quantity is a sum of money — a deposit, a lump-sum quote
    -- — and it funds an order through its payment, not by being one of its
    -- lines. Linking it would let arrivals on the order move a line that was
    -- never goods, which is the collapse A1 forbids.
    if x.pr_qty is null then
      return ops_core.invalid('procurement','purchase_order', null,'create',
        'lump_sum_line',
        format('Request line %s has no quantity, so it is money rather than goods. It is paid, not ordered.', x.want),
        jsonb_build_object('field','lines','pr_line_no', x.want));
    end if;
    if x.pr_uom is not null and x.uom is distinct from x.pr_uom then
      return ops_core.invalid('procurement','purchase_order', null,'create',
        'uom_differs',
        format('Request line %s is counted in %s and this order line in %s. Order it in the same unit, or arrivals will move the request by the wrong number.',
               x.want, x.pr_uom, coalesce(x.uom,'nothing')),
        jsonb_build_object('field','lines','pr_line_no', x.want));
    end if;
  end loop;

  v_po_no := ops_core.next_doc_number('po');

  insert into ops_procure.purchase_orders
    (po_no, vendor_id, status, created_by, note, expected_delivery)
  values (v_po_no, v.id, 'DRAFT', auth.uid(), nullif(btrim(p_note), ''), p_expected_delivery)
  returning id into v_po_id;

  insert into ops_procure.po_lines
    (po_id, line_no, item_id, description, qty, uom, unit_price, line_total, pr_line_id)
  select v_po_id, ord,
         nullif(l ->> 'item_id','')::uuid,
         btrim(l ->> 'description'),
         (l ->> 'qty')::numeric,
         l ->> 'uom',
         (l ->> 'unit_price')::numeric,
         round((l ->> 'qty')::numeric * (l ->> 'unit_price')::numeric),
         (select pl.id from ops_procure.pr_lines pl where pl.line_no_full = nullif(l ->> 'pr_line_no',''))
    from jsonb_array_elements(p_lines) with ordinality as t(l, ord);
  get diagnostics n = row_count;

  -- Money that already reached a request line now reached this order too: it
  -- is the same purchase. The allocation is superseded by one that names both,
  -- never edited, so what it said before the order existed stays readable
  -- (A5). Without this a line paid before it was ordered leaves the order
  -- reading UNPAID for money that has already left the bank (B8).
  perform ops_procure.restamp_line_money(pl.line_no_full, v_po_no)
     from ops_procure.po_lines o join ops_procure.pr_lines pl on pl.id = o.pr_line_id
    where o.po_id = v_po_id;

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

  -- ── the first road: leadership writes it, so it is confirmed now (D267) ──
  -- Asking yourself on chat is theatre. The order stays a DRAFT and is still
  -- issued deliberately; what is recorded is that nobody else looked, as its
  -- own event, so the approval trail says so rather than the creation row.
  v_self := ops_core.has_authority('approve_goods');
  if v_self then
    update ops_procure.purchase_orders
       set approved_at = now(), approved_by = auth.uid(), self_confirmed = true
     where id = v_po_id;
    perform ops_core.emit('procurement','procurement.po.approved', v_po_no,
      jsonb_build_object('po_no', v_po_no, 'approved', true, 'self_confirmed', true, 'via', 'create'));
  end if;

  res := ops_core.ok('procurement','purchase_order', v_po_no,'create',
    jsonb_build_object('po_no', v_po_no, 'status','DRAFT','lines', n, 'self_confirmed', v_self));
  return ops_core.idem_remember('procurement','create_po', p_key, res);
end $$;

create or replace function ops_procure.request_po_approval(p_po_no text, p_to text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'ops_procure', 'ops_core', 'pg_temp'
AS $$
declare
  po ops_procure.purchase_orders; n int; total numeric;
  v_to_id uuid; v_to_email text;
begin
  if not ops_core.has_permission('procurement.update') then
    return ops_core.refused('procurement','purchase_order', p_po_no,'request_approval',
      'not_permitted','Asking for confirmation needs procurement access.');
  end if;

  select * into po from ops_procure.purchase_orders where po_no = p_po_no;
  if not found then
    return ops_core.not_found('procurement','purchase_order', p_po_no,'request_approval','No such order.');
  end if;
  if po.status <> 'DRAFT' then
    return ops_core.conflict('procurement','purchase_order', p_po_no,'request_approval',
      'not_a_draft', format('%s is %s — only a draft is confirmed.', p_po_no, po.status));
  end if;
  -- Already confirmed — by its author, who holds the authority (D267), or by
  -- an earlier answer. A card asking again would be a question with no
  -- decision left in it, which is how people learn to tap yes without reading.
  if po.approved_at is not null then
    return ops_core.conflict('procurement','purchase_order', p_po_no,'request_approval',
      'already_approved', format('%s has already been confirmed.', p_po_no));
  end if;

  select count(*), coalesce(sum(line_total), 0) into n, total
    from ops_procure.po_lines where po_id = po.id and superseded_by is null;
  if n = 0 then
    return ops_core.invalid('procurement','purchase_order', p_po_no,'request_approval',
      'lines_required','An order with no lines is not an order.',
      jsonb_build_object('field','lines'));
  end if;

  -- Named, or whoever holds the authority. Asking a specific person who does
  -- **not** hold it is not a smaller mistake than asking nobody: the question
  -- would sit unanswerable in somebody's chat.
  if p_to is not null then
    select u.id, u.email::text into v_to_id, v_to_email
      from ops_core.users u
      join ops_core.user_authorities a on a.user_id = u.id and a.authority = 'approve_goods'
     where u.email = p_to::ops_core.citext and u.is_active;
    if v_to_id is null then
      return ops_core.invalid('procurement','purchase_order', p_po_no,'request_approval',
        'not_an_approver', format('%s does not hold approve_goods.', p_to),
        jsonb_build_object('field','to'));
    end if;
  else
    select u.id, u.email::text into v_to_id, v_to_email
      from ops_core.users u
      join ops_core.user_authorities a on a.user_id = u.id and a.authority = 'approve_goods'
     where u.is_active
     order by u.email
     limit 1;
    if v_to_id is null then
      return ops_core.conflict('procurement','purchase_order', p_po_no,'request_approval',
        'no_approver',
        'Nobody currently holds the authority to approve goods, so there is no one to ask.');
    end if;
  end if;

  update ops_procure.purchase_orders
     set approval_asked_at = now(), approval_asked_by = auth.uid(),
         approval_sent_to  = v_to_email::ops_core.citext,
         approval_token    = ops_core.new_token('potok')
   where id = po.id;

  -- The seam, not a second write path: a worker turns this into the chat card,
  -- exactly as it does for a request batch (ADR-008).
  perform ops_core.emit('procurement','procurement.po.approval_requested', p_po_no,
    jsonb_build_object('po_no', p_po_no, 'vendor_id', po.vendor_id,
                       'to', v_to_email, 'contract_value', total, 'lines', n));

  return ops_core.ok('procurement','purchase_order', p_po_no,'request_approval',
    jsonb_build_object('po_no', p_po_no, 'to', v_to_email,
                       'contract_value', total, 'lines', n));
end $$;

create or replace function ops_procure.answer_po_approval(
  p_token             text,
  p_approved          boolean,
  p_answered_by_email ops_core.citext,
  p_note              text default null,
  p_key               text default null)
returns jsonb language plpgsql security definer
set search_path = ops_procure, ops_core, pg_temp as $$
declare po ops_procure.purchase_orders; v_user uuid; v_note text; replayed jsonb; res jsonb;
begin
  replayed := ops_core.idem_replay('procurement','answer_po_approval:' || coalesce(p_token,'?'), p_key);
  if replayed is not null then return replayed; end if;

  select * into po from ops_procure.purchase_orders where approval_token = p_token;
  if not found then
    return ops_core.not_found('procurement','purchase_order', null,'answer_from_chat',
      'This approval card matches nothing — it may have been answered or withdrawn.');
  end if;

  -- Only the person the card went to. Recording somebody else's yes as theirs
  -- is exactly the mistake this road exists to avoid (D69).
  if p_answered_by_email is distinct from po.approval_sent_to then
    perform ops_core.emit('procurement','procurement.po.answer_refused', po.po_no,
      jsonb_build_object('po_no', po.po_no, 'by', p_answered_by_email, 'sent_to', po.approval_sent_to));
    return ops_core.refused('procurement','purchase_order', po.po_no,'answer_from_chat',
      'not_the_addressee',
      format('This card was sent to %s. An answer from %s is not that person''s decision.',
             po.approval_sent_to, p_answered_by_email));
  end if;

  select u.id into v_user from ops_core.users u
    join ops_core.user_authorities a on a.user_id = u.id and a.authority = 'approve_goods'
   where u.email = p_answered_by_email and u.is_active;
  if v_user is null then
    return ops_core.refused('procurement','purchase_order', po.po_no,'answer_from_chat',
      'authority_required',
      format('%s no longer holds the authority to confirm orders.', p_answered_by_email));
  end if;

  if po.status <> 'DRAFT' then
    return ops_core.conflict('procurement','purchase_order', po.po_no,'answer_from_chat',
      'not_a_draft', format('%s is %s — past this stage.', po.po_no, po.status));
  end if;
  if po.approved_at is not null then
    return ops_core.conflict('procurement','purchase_order', po.po_no,'answer_from_chat',
      'already_answered', format('%s was already confirmed.', po.po_no));
  end if;

  v_note := nullif(btrim(p_note), '');
  if not p_approved and v_note is null then
    return ops_core.invalid('procurement','purchase_order', po.po_no,'answer_from_chat',
      'reason_required',
      'Turning an order down needs a sentence — somebody has to tell the supplier something.',
      jsonb_build_object('field','note'));
  end if;

  update ops_procure.purchase_orders
     set approved_at    = case when p_approved then now() else null end,
         approved_by    = case when p_approved then v_user else null end,
         approval_note  = v_note,
         self_confirmed = false,
         approval_token = null
   where id = po.id;

  perform ops_core.emit('procurement',
    case when p_approved then 'procurement.po.approved' else 'procurement.po.declined' end,
    po.po_no, jsonb_build_object('po_no', po.po_no, 'approved', p_approved, 'note', v_note,
                                 'by', p_answered_by_email, 'via', 'chat'));

  res := ops_core.ok('procurement','purchase_order', po.po_no,
    case when p_approved then 'approve' else 'decline' end,
    jsonb_build_object('po_no', po.po_no, 'approved', p_approved, 'by', p_answered_by_email, 'via', 'chat'));
  return ops_core.idem_remember('procurement','answer_po_approval:' || p_token, p_key, res);
end $$;

revoke execute on function ops_procure.answer_po_approval(text, boolean, ops_core.citext, text, text) from public, authenticated;
-- Usage on the schema and execute on this one function — the shape 0038 chose
-- for the capture worker: the worker can do exactly this, and reading or
-- writing a table directly stays out of its reach.
grant usage on schema ops_procure, ops_core to service_role;
grant execute on function ops_procure.answer_po_approval(text, boolean, ops_core.citext, text, text) to service_role;

comment on function ops_procure.answer_po_approval is
  'Leadership''s answer to a PO approval card, from the chat worker only (service_role). The '
  'answerer must be the addressee and hold approve_goods; the decision is recorded against them, '
  'never against a session. (0133, D69, D267)';

/* What the chat worker puts on the card, read with the one capability it has.
 *
 * `procurement.po.approval_requested` says *which* order; this says what the
 * card shows and carries the token back. A function rather than a table grant,
 * so the worker can read one order's card and nothing else in the schema.
 * Null once the card is spent or withdrawn — a worker retrying late must not
 * resurrect a question that has been answered. */
create or replace function ops_procure.po_approval_card(p_po_no text)
returns jsonb language sql stable security definer
set search_path = ops_procure, ops_core, pg_temp as $$
  select jsonb_build_object(
           'po_no', p.po_no,
           'token', p.approval_token,
           'to', p.approval_sent_to,
           'asked_by', (select u.email from ops_core.users u where u.id = p.approval_asked_by),
           'vendor', v.name,
           'contract_value', s.contract_value,
           'expected_delivery', p.expected_delivery,
           'lines', (select jsonb_agg(jsonb_build_object(
                        'description', l.description, 'qty', l.qty, 'uom', l.uom,
                        'unit_price', l.unit_price, 'line_total', l.line_total,
                        'pr_line_no', (select pl.line_no_full from ops_procure.pr_lines pl where pl.id = l.pr_line_id))
                      order by l.line_no)
                       from ops_procure.po_lines l where l.po_id = p.id and l.superseded_by is null))
    from ops_procure.purchase_orders p
    join ops_procure.vendors v on v.id = p.vendor_id
    join ops_procure.v_po_status s on s.po_id = p.id
   where p.po_no = p_po_no
     and p.status = 'DRAFT' and p.approved_at is null and p.approval_token is not null;
$$;
revoke execute on function ops_procure.po_approval_card(text) from public, authenticated;
grant execute on function ops_procure.po_approval_card(text) to service_role;

