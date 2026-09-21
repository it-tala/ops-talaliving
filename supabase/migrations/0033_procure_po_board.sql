-- 0033_procure_po_board.sql — the order board, in one row per order.
--
-- ── Why not `v_po_detail` ─────────────────────────────────────────────────
--
-- `listPo` answered `PoDetail[]` in the real client and `PoView[]` in the demo,
-- and `_pending.ts` recorded the mismatch as *two different shapes with
-- confusingly similar names*. They are not a naming accident. They are a
-- drawer and a board, and the difference is a page of data per row:
--
--   `PoDetail` — every line with every receipt behind it, the payment terms
--                with their BLOCKED guard, the amendments, the payments, the
--                documents, the close blockers. What one order needs when
--                somebody opens it.
--   `PoView`   — the order, its lines, the vendor's name, how late it is, and
--                the money summary. What forty orders need in a table.
--
-- Serving the board from `v_po_detail` is what the real client did, and it is
-- the kind of wrong that never shows up in review: the screen renders, the
-- numbers are right, and every row carries its receipts and terms across the
-- wire to be discarded. On a catalogue of forty open orders that is the
-- difference between a list and a wait.
--
-- ── `status_view` nested rather than flattened ────────────────────────────
--
-- `PoView.status_view` is an object, because `PoStatusView` is a thing the
-- contract names and four screens pass around whole. Flattening it into
-- nineteen sibling columns would make this view marginally simpler and every
-- caller reassemble it, which is the trade the wrong way round.

-- ── three columns `PurchaseOrder` declares and the table never had ───────
--
-- First in the file, and the order matters twice: `v_po_board` below selects
-- `po.*`, which expands at definition time, and `request_po_approval` further
-- down writes two of them. Defined after either one, they would simply be
-- absent from the board — silently, since `po.*` does not complain about what
-- it cannot see.

alter table ops_procure.purchase_orders
  add column if not exists approval_sent_to ops_core.citext
    references ops_core.users(email);

alter table ops_procure.purchase_orders
  add column if not exists approval_token text;

-- **Recorded, not derived**, and `contracts.ts` says why in as many words:
--
--   *Approved by Evin* and *created and approved by Evin in one act* are
--   different facts about how a decision was taken, and the second is the one
--   an auditor asks about — deriving it later from `created_by = approved_by`
--   would be a guess about history.
--
-- The first draft of this migration derived it from `approval_asked_at is
-- null`, which is the same guess wearing a different column. It is written at
-- the moment of the decision instead, by `approve_po`, where the fact is
-- actually known.
alter table ops_procure.purchase_orders
  add column if not exists self_confirmed boolean not null default false;

comment on column ops_procure.purchase_orders.approval_sent_to is
  'Who the confirmation question went out to. The other half of D267: the question names '
  'a person and the answer comes back from that person''s own account, because a leadership '
  'meeting runs on one laptop and ticking a box there records the wrong person. Null means '
  'nobody was asked — the order was confirmed in one act by somebody who already held the '
  'authority, which v_po_detail.self_confirmed reports. (0033)';

comment on column ops_procure.purchase_orders.approval_token is
  'Lets the named approver answer from chat as themselves (D267), the same way a request '
  'batch works (D69). Minted when the question is asked and cleared when it is answered, '
  'so a spent token is not a second way in. (0033)';

comment on column ops_procure.purchase_orders.self_confirmed is
  'True where the order was written and confirmed in one act by somebody who already held '
  'approve_goods — the one case where nobody else saw it before it went to a supplier. '
  'Written when the decision is taken, never inferred afterwards. (0033)';

create or replace view ops_procure.v_po_board as
  select
    po.*,

    v.name as vendor_name,

    -- The same expression as `v_po_detail`, deliberately identical: a board
    -- that calls an order late and a drawer that does not, for the same order
    -- on the same afternoon, is the kind of disagreement that costs an hour to
    -- track down and all of somebody's confidence in the figure.
    --
    -- Null rather than zero when it is not late. *0 days late* and *not late*
    -- are different statements, and a screen showing the first for the second
    -- reports a problem that does not exist (D134).
    case
      when po.expected_delivery is null then null
      when po.status in ('CLOSED','CANCELLED') then null
      when s.fully_delivered then null
      when ops_core.office_day() > po.expected_delivery
        then (ops_core.office_day() - po.expected_delivery)
      else null
    end as days_late,

    jsonb_build_object(
      'po_id',          s.po_id,
      'contract_value', s.contract_value,
      'paid_to_date',   s.paid_to_date,
      'outstanding',    s.outstanding,
      'value_received', s.value_received,
      'exposure',       s.exposure,
      'payment_state',  s.payment_state,
      'delivery_state', s.delivery_state
    ) as status_view,

    -- Superseded lines excluded, as the board shows what the order says now.
    -- What it used to say is an amendment, and amendments live in the drawer
    -- (D129) — a board that showed both would show every amended order twice.
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'id',            l.id,
               'po_id',         l.po_id,
               'line_no',       l.line_no,
               'item_id',       l.item_id,
               'description',   l.description,
               'qty',           l.qty,
               'uom',           l.uom,
               'unit_price',    l.unit_price,
               'line_total',    l.line_total,
               'superseded_by', l.superseded_by) order by l.line_no)
        from ops_procure.po_lines l
       where l.po_id = po.id and l.superseded_by is null
    ), '[]'::jsonb) as lines

  from ops_procure.purchase_orders po
  join ops_procure.vendors v on v.id = po.vendor_id
  -- `left join`: `v_po_status` aggregates over lines and receipts, and an
  -- order written a minute ago with no lines yet has no row there. A draft
  -- that vanishes from the board is a draft nobody can finish.
  left join ops_procure.v_po_status s on s.po_id = po.id;

alter view ops_procure.v_po_board set (security_invoker = on);
grant select on ops_procure.v_po_board to authenticated;

comment on view ops_procure.v_po_board is
  'One row per order, as the board reads it: the order, its current lines, the vendor name, '
  'how late it is, and the money summary nested as PoStatusView. Deliberately NOT v_po_detail, '
  'which carries receipts, terms, amendments and payments per row — a drawer, not a list. (0033)';

-- ── four seams that could not say what the screens have to say ────────────
--
-- Transcribing the PO family from the demo found four gaps that are not shape
-- mismatches. The contract asks for something the database has no way to
-- record, and in each case the missing thing is the *reason* — which is the
-- half a system like this exists to keep.
--
--   `approve_po`          could only say yes. There was no way to decline.
--   `amend_po_line`       took no reason. D135 makes an amendment a revision
--                         the vendor holds paper for; *why* is the whole
--                         point.
--   `close_po`            refused flatly while anything was outstanding, so an
--                         order written off at 80% delivered could never be
--                         closed at all.
--   `request_po_approval` could not say who was being asked.
--
-- ### Each drops its old signature first
--
-- `create or replace function` matches on name **and argument types**, so a
-- new defaulted parameter creates a *second* function and every existing
-- two-argument call then matches both — `function … is not unique`, at run
-- time, through PostgREST. `0032` learned this the expensive way and
-- `00_no_overloads.sql` now refuses it. The drops below are spelled with full
-- argument lists so they fail loudly if a signature is not what this file
-- thinks it is.

drop function if exists ops_procure.approve_po(text, text, text);
drop function if exists ops_procure.amend_po_line(text, int, numeric, numeric, text, text);
drop function if exists ops_procure.close_po(text, text);
drop function if exists ops_procure.request_po_approval(text);

-- ── leadership's answer, which may be no ──────────────────────────────────
--
-- The old seam set `approved_at` and returned. An approver who wanted to turn
-- an order down had no button, and the only record of the decision was its
-- absence — indistinguishable from nobody having looked yet.
--
-- Declining is therefore a first-class outcome: it clears the approval, writes
-- `decline` to the trail, and **requires a note**. Somebody has to tell the
-- supplier something, and *no* with no sentence attached is a message
-- procurement cannot pass on.
create or replace function ops_procure.approve_po(
  p_po_no text, p_approved boolean default true,
  p_note text default null, p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare po ops_procure.purchase_orders; replayed jsonb; res jsonb; v_note text;
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
  -- Only a draft is answered. Once it is issued the vendor has the paper, and
  -- un-approving it afterwards would leave the company's own record disagreeing
  -- with the document somebody is holding.
  if po.status <> 'DRAFT' then
    return ops_core.conflict('procurement','purchase_order', p_po_no,'approve',
      'not_a_draft', format('%s is %s — it has already been sent.', p_po_no, po.status));
  end if;
  if p_approved and po.approved_at is not null then
    return ops_core.conflict('procurement','purchase_order', p_po_no,'approve',
      'already_approved', format('%s was already confirmed.', p_po_no));
  end if;

  v_note := nullif(btrim(p_note), '');
  if not p_approved and v_note is null then
    return ops_core.invalid('procurement','purchase_order', p_po_no,'decline',
      'reason_required',
      'Turning an order down needs a sentence — somebody has to tell the supplier something.',
      jsonb_build_object('field','note'));
  end if;

  update ops_procure.purchase_orders
     set approved_at   = case when p_approved then now()        else null end,
         approved_by   = case when p_approved then auth.uid()   else null end,
         approval_note = v_note,
         -- Confirmed with no question ever asked: somebody who already held the
         -- authority wrote it and confirmed it in the same act. Recorded here,
         -- where it is known, rather than guessed at from timestamps later.
         self_confirmed = (p_approved and po.approval_asked_at is null),
         -- Answered, so the token is spent. Leaving it live would be a second
         -- way to answer a decision that has already been taken.
         approval_token = null
   where id = po.id;

  perform ops_core.emit('procurement',
    case when p_approved then 'procurement.po.approved' else 'procurement.po.declined' end,
    p_po_no, jsonb_build_object('po_no', p_po_no, 'approved', p_approved, 'note', v_note));

  res := ops_core.ok('procurement','purchase_order', p_po_no,
    case when p_approved then 'approve' else 'decline' end,
    jsonb_build_object('po_no', p_po_no, 'approved', p_approved),
    jsonb_build_object('approved_at', po.approved_at, 'approval_note', po.approval_note),
    jsonb_build_object('approved_at', case when p_approved then now() end, 'approval_note', v_note));
  return ops_core.idem_remember('procurement','approve_po:' || p_po_no, p_key, res);
end $$;

-- ── an amendment, with the reason it happened ─────────────────────────────
--
-- Unchanged in mechanism: the old row is retired pointing forward, the new one
-- takes its line number, and only an issued order's revision moves (D135).
--
-- Two things are new. `p_reason` is **required** — an amendment is a change to
-- a document somebody outside the company is holding, and *qty 10 → 8* with no
-- sentence is a row nobody can explain next quarter. And `p_qty` /
-- `p_unit_price` are nullable, meaning *leave this one alone*: the drawer
-- amends a quantity without restating a price, and making it resend the old
-- price is how a stale number gets written back over a fresh one.
create or replace function ops_procure.amend_po_line(
  p_po_no text, p_line_no int, p_reason text,
  p_qty numeric default null, p_unit_price numeric default null,
  p_description text default null, p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare
  po ops_procure.purchase_orders; old ops_procure.po_lines; new_id uuid;
  v_qty numeric; v_price numeric; v_reason text;
  replayed jsonb; res jsonb;
begin
  replayed := ops_core.idem_replay('procurement',
    format('amend_po_line:%s:%s', p_po_no, p_line_no), p_key);
  if replayed is not null then return replayed; end if;

  if not ops_core.has_permission('procurement.update') then
    return ops_core.refused('procurement','purchase_order', p_po_no,'amend',
      'not_permitted','Amending an order needs procurement access.');
  end if;

  v_reason := nullif(btrim(p_reason), '');
  if v_reason is null then
    return ops_core.invalid('procurement','purchase_order', p_po_no,'amend',
      'reason_required',
      'An amendment changes a document the vendor is holding. Say what changed and why.',
      jsonb_build_object('field','reason'));
  end if;

  select * into po from ops_procure.purchase_orders where po_no = p_po_no;
  if not found then
    return ops_core.not_found('procurement','purchase_order', p_po_no,'amend','No such order.');
  end if;
  if po.status in ('CLOSED','CANCELLED') then
    return ops_core.conflict('procurement','purchase_order', p_po_no,'amend',
      'order_closed', format('%s is %s.', p_po_no, lower(po.status::text)));
  end if;

  select * into old from ops_procure.po_lines
   where po_id = po.id and line_no = p_line_no and superseded_by is null;
  if not found then
    return ops_core.not_found('procurement','purchase_order', p_po_no,'amend',
      format('Line %s is not on this order.', p_line_no));
  end if;

  -- Resolved against the line as it stands, so *unchanged* is a value rather
  -- than a special case, and the validation below sees what will be written.
  v_qty   := coalesce(p_qty, old.qty);
  v_price := coalesce(p_unit_price, old.unit_price);

  if v_qty <= 0 or v_price < 0 then
    return ops_core.invalid('procurement','purchase_order', p_po_no,'amend',
      'bad_values','A quantity is more than nothing and a price is not negative.');
  end if;
  -- Nothing to record is not an amendment, and writing one would bump the
  -- revision and tell a vendor their paper is out of date when it is not.
  if v_qty = old.qty and v_price = old.unit_price
     and coalesce(nullif(btrim(p_description), ''), old.description) = old.description then
    return ops_core.noop('procurement','purchase_order', p_po_no,'amend',
      'nothing changed on that line',
      jsonb_build_object('po_no', p_po_no, 'line_no', p_line_no));
  end if;

  new_id := gen_random_uuid();
  update ops_procure.po_lines set superseded_by = new_id where id = old.id;

  insert into ops_procure.po_lines
    (id, po_id, line_no, item_id, description, qty, uom, unit_price, line_total)
  values (new_id, po.id, old.line_no, old.item_id,
          coalesce(nullif(btrim(p_description), ''), old.description),
          v_qty, old.uom, v_price, round(v_qty * v_price));

  if po.status = 'ISSUED' then
    update ops_procure.purchase_orders set revision = revision + 1 where id = po.id;
  end if;

  perform ops_core.emit('procurement','procurement.po.amended', p_po_no,
    jsonb_build_object('po_no', p_po_no, 'line_no', p_line_no, 'reason', v_reason,
                       'from', jsonb_build_object('qty', old.qty, 'unit_price', old.unit_price),
                       'to',   jsonb_build_object('qty', v_qty, 'unit_price', v_price)));

  res := ops_core.ok('procurement','purchase_order', p_po_no,'amend',
    jsonb_build_object('po_no', p_po_no, 'line_no', p_line_no,
                       'po_line_id', new_id, 'reason', v_reason),
    jsonb_build_object('qty', old.qty, 'unit_price', old.unit_price, 'line_total', old.line_total),
    jsonb_build_object('qty', v_qty, 'unit_price', v_price, 'line_total', round(v_qty * v_price)));
  return ops_core.idem_remember('procurement',
    format('amend_po_line:%s:%s', p_po_no, p_line_no), p_key, res);
end $$;

-- ── closing, including the orders that never finish ───────────────────────
--
-- The old seam refused while anything was outstanding, full stop. That is the
-- right default and the wrong absolute: orders are written off. Eight of ten
-- crates arrive, the supplier stops answering, and somebody decides the
-- company is not chasing the remaining two — and under the old rule that order
-- stays open on the board forever, which is how a board stops being read.
--
-- So the blockers are split. Two are **fatal** and no reason overrides them: an
-- order already closed, and one never issued (which is a cancellation, a
-- different act with a different meaning to the vendor). The rest — money
-- outstanding, goods undelivered — are settleable **by saying why**, and that
-- sentence is what somebody reads in six months. It is required, it is stored,
-- and the audit row carries what was still open at the moment it was waived.
create or replace function ops_procure.close_po(
  p_po_no text, p_settle_reason text default null, p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare
  po ops_procure.purchase_orders; s record;
  -- Cast every append: `text[] || 'literal'` leaves Postgres choosing between
  -- array-concat and element-append on an untyped literal, and it picks the
  -- former, which fails at run time rather than at create time.
  blockers text[] := '{}';
  v_reason text; replayed jsonb; res jsonb;
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
  -- Fatal, and deliberately checked before the settleable ones: no reason
  -- turns a draft into something that can be closed.
  if po.status = 'DRAFT' then
    return ops_core.conflict('procurement','purchase_order', p_po_no,'close',
      'never_issued','It was never issued — cancel it rather than close it.');
  end if;

  select * into s from ops_procure.v_po_status where po_id = po.id;
  if s.outstanding > 0 then
    blockers := blockers || format('%s of the contract has not been paid.', s.outstanding);
  end if;
  if not coalesce(s.fully_delivered, false) then
    blockers := blockers || 'Not everything ordered has arrived.'::text;
  end if;

  v_reason := nullif(btrim(p_settle_reason), '');
  if array_length(blockers, 1) > 0 and v_reason is null then
    return ops_core.invalid('procurement','purchase_order', p_po_no,'close',
      'close_refused',
      format('%s is not finished: %s Close it anyway by saying why — that reason is what somebody reads in six months.',
             p_po_no, array_to_string(blockers, ' ')),
      jsonb_build_object('field','settle_reason','blockers', to_jsonb(blockers)));
  end if;

  update ops_procure.purchase_orders set status = 'CLOSED' where id = po.id;

  perform ops_core.emit('procurement','procurement.po.closed', p_po_no,
    jsonb_build_object('po_no', p_po_no,
                       'settled_early', array_length(blockers, 1) > 0,
                       'reason', v_reason));
  res := ops_core.ok('procurement','purchase_order', p_po_no,'close',
    jsonb_build_object('po_no', p_po_no, 'status','CLOSED',
                       'settled_early', array_length(blockers, 1) > 0,
                       -- What was still open when somebody waived it. The
                       -- figure matters more than the decision: *closed with
                       -- 4.200.000 unpaid* is a sentence an auditor can act on.
                       'blockers', to_jsonb(blockers),
                       'outstanding', s.outstanding,
                       'reason', v_reason));
  return ops_core.idem_remember('procurement','close_po:' || p_po_no, p_key, res);
end $$;

-- ── asking, of somebody in particular ─────────────────────────────────────
--
-- The other half of D267: the question goes out to a named person and the
-- answer comes back from **their own account**. A leadership meeting runs on
-- one laptop, and ticking a box there records the wrong person — the same rule
-- a request batch already follows (D69).
create or replace function ops_procure.request_po_approval(
  p_po_no text, p_to text default null)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
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

grant execute on function ops_procure.approve_po(text, boolean, text, text) to authenticated;
grant execute on function ops_procure.amend_po_line(
  text, int, text, numeric, numeric, text, text) to authenticated;
grant execute on function ops_procure.close_po(text, text, text) to authenticated;
grant execute on function ops_procure.request_po_approval(text, text) to authenticated;



-- ── three columns the drawer reads and the view never had ─────────────────
--
-- `PoDetail` promises `status_view`, `self_confirmed` and `approval_sent_to`.
-- `v_po_detail` returned none of them, and `getPoDetail` met the contract with
-- `data as unknown as PoDetail` — the same cast `0032` found on the two
-- curation views, in the same shape, one file over.
--
-- This one was worse, and it is worth being exact about why: **`/procurement/
-- po/[po]/print` was already in `LIVE_ROUTES`.** It calls `getPoDetail` and
-- renders `d.status_view.contract_value`, so in live mode that page threw on
-- `undefined` — a route the guard declared safe, shipped, reading a column that
-- has never existed in any environment.
--
-- The guard was not wrong. It checks that every function a route reaches is
-- *implemented*, which `getPoDetail` is. What no guard here can check is
-- whether the row the database sends back carries the fields the type claims —
-- and a cast is precisely the instruction to stop checking. Two of these in two
-- days is a pattern rather than an accident: **`as unknown as T` over a view is
-- the place to look.**
--
-- The whole definition is restated below rather than patched. `create or
-- replace view` takes a complete select list — there is no way to append one
-- column — so the alternative was editing `0018`, and a migration that has been
-- applied is not a file anybody may edit.


-- Rewritten to set the column above, which did not exist when the body earlier
-- in this file was defined.
create or replace view ops_procure.v_po_detail as
  select
    po.po_no,
    po.vendor_id,
    v.name      as vendor_name,
    v.pic_name  as vendor_pic,
    coalesce(v.pic_phone, v.phone) as vendor_phone,
    po.status,
    po.expected_delivery,
    -- Days late, once everything was supposed to be here and is not. Null
    -- rather than zero when it is not late: "0 days late" and "not late" are
    -- different statements, and a screen showing the first for the second is
    -- reporting a problem that does not exist (D134).
    case
      when po.expected_delivery is null then null
      when po.status in ('CLOSED','CANCELLED') then null
      when s.fully_delivered then null
      when ops_core.office_day() > po.expected_delivery
        then (ops_core.office_day() - po.expected_delivery)
      else null
    end as days_late,
    po.revision, po.sent_revision,
    po.approval_asked_at,
    asked.full_name as approval_asked_by_name,
    po.approved_at,
    appr.full_name  as approved_by_name,
    po.approval_note,
    po.note,
    po.created_at,
    po.issued_at,
    iss.full_name   as issued_by_name,

    s.contract_value, s.paid_to_date, s.outstanding, s.value_received,
    s.exposure, s.credit, s.payment_state, s.delivery_state, s.dp_percent,
    j.billable_now,

    -- The lines, each with what arrived against it and every receipt behind
    -- that — including who took delivery and who checked it, two people or the
    -- same one named twice (D101).
    coalesce(ln.lines, '[]'::jsonb) as lines,
    coalesce(tm.terms, '[]'::jsonb) as terms,

    -- The share of the contract that may be asked for right now: the terms
    -- that are PAYABLE or PARTIAL, less what has already reached them.
    coalesce(tm.payable_now, 0) as payable_now,

    -- What this order used to say. An issued obligation only moves by
    -- supersession, so the old rows are still here and worth reading — "who
    -- changed the quantity after we agreed it" is a real question (D129).
    coalesce(am.amendments, '[]'::jsonb) as amendments,
    coalesce(pm.payments, '[]'::jsonb)   as payments,
    coalesce(dc.documents, '[]'::jsonb)  as documents,

    -- Why this order cannot be closed yet, empty when it can. The same three
    -- reasons `ops_procure.close_po()` refuses on, computed in one place so the
    -- button's tooltip and the seam's refusal cannot say different things.
    (select coalesce(jsonb_agg(b), '[]'::jsonb) from (
       select 'It is already closed.' as b where po.status = 'CLOSED'
       union all
       select 'It was never issued — cancel it rather than close it.' where po.status = 'DRAFT'
       union all
       select format('%s of the contract has not been paid.', s.outstanding)
        where s.outstanding > 0
       union all
       select 'Not everything ordered has arrived.' where not s.fully_delivered
     ) blockers) as close_blockers,

    -- ── added by 0033 ──────────────────────────────────────────────────────
    --
    -- The same object `v_po_board` nests, built from the columns this view
    -- already carries flat. Deliberately not recomputed: the board and the
    -- drawer reading different `contract_value`s for one order is the
    -- disagreement this whole project keeps designing out.
    jsonb_build_object(
      'po_id',          s.po_id,
      'contract_value', s.contract_value,
      'paid_to_date',   s.paid_to_date,
      'outstanding',    s.outstanding,
      'value_received', s.value_received,
      'exposure',       s.exposure,
      'payment_state',  s.payment_state,
      'delivery_state', s.delivery_state
    ) as status_view,

    -- D267, the two roads. Read, not derived — see the column's comment above:
    -- how a decision was taken is a fact, and reconstructing it from timestamps
    -- afterwards is a guess that gets more wrong the more the row is edited.
    po.self_confirmed,

    po.approval_sent_to::text as approval_sent_to

  from ops_procure.purchase_orders po
  join ops_procure.vendors v        on v.id = po.vendor_id
  join ops_procure.v_po_status s    on s.po_id = po.id
  join ops_procure.v_po_journey j   on j.po_id = po.id
  left join ops_core.users asked on asked.id = po.approval_asked_by
  left join ops_core.users appr  on appr.id  = po.approved_by
  left join ops_core.users iss   on iss.id   = po.issued_by

  left join lateral (
    select jsonb_agg(jsonb_build_object(
             'po_line_id', d.po_line_id, 'line_no', d.line_no,
             'description', d.description, 'qty', d.qty, 'uom', d.uom,
             'unit_price', d.unit_price, 'line_total', d.line_total,
             'received', d.received, 'reported', d.reported, 'over', d.over,
             'condition', d.condition,
             'receipts', coalesce(rc.receipts, '[]'::jsonb))
           order by d.line_no) as lines
      from ops_procure.v_po_line_delivery d
      left join lateral (
        select jsonb_agg(jsonb_build_object(
                 'receipt_no', r.receipt_no, 'qty', r.qty_received,
                 'condition', r.condition, 'at', r.received_at,
                 'by', coalesce(rb.full_name, '—'),
                 'qc_by', coalesce(qb.full_name, '—'),
                 'note', r.note, 'status', r.status,
                 -- Both halves of the evidence, tracked apart: the photo of
                 -- what arrived, and the signed tanda terima.
                 --
                 -- **Ids, not booleans** (D268). A chip reading *photo of the
                 -- goods* that nobody could open is a label about evidence
                 -- rather than a way to it. Presence is derived from the id
                 -- where it is rendered, so the chip and the link cannot
                 -- disagree about whether there is a file.
                 'photo_attachment_id', (select k.attachment_id
                                           from ops_core.attachment_links k
                                          where k.entity = 'receipt' and k.entity_no = r.receipt_no
                                            and k.kind = 'goods_photo' and k.unlinked_at is null
                                          order by k.linked_at limit 1),
                 'delivery_note_attachment_id', (select k.attachment_id
                                           from ops_core.attachment_links k
                                          where k.entity = 'receipt' and k.entity_no = r.receipt_no
                                            and k.kind = 'delivery_note' and k.unlinked_at is null
                                          order by k.linked_at limit 1))
               order by r.received_at) as receipts
          from ops_procure.receipts r
          left join ops_core.users rb on rb.id = r.received_by
          left join ops_core.users qb on qb.id = r.qc_by
         where r.po_line_id = d.po_line_id
      ) rc on true
     where d.po_id = po.id
  ) ln on true

  left join lateral (
    select jsonb_agg(jsonb_build_object(
             'term_no', t.term_no, 'kind', t.kind, 'basis', t.basis,
             'basis_value', t.basis_value, 'due_rule', t.due_rule,
             'due_date', t.due_date, 'amount', t.amount, 'covered', t.covered,
             'state', t.state, 'blocked_by', t.blocked_by, 'trigger', t.trigger)
           order by t.term_no) as terms,
           sum(greatest(t.amount - t.covered, 0))
             filter (where t.state in ('PAYABLE','PARTIAL')) as payable_now
      from ops_procure.v_po_terms t where t.po_id = po.id
  ) tm on true

  left join lateral (
    select jsonb_agg(jsonb_build_object(
             'line_no', old.line_no,
             'from', old.qty || ' ' || old.uom || ' × ' || old.unit_price,
             'to', case when new_l.id is null then 'removed'
                        else new_l.qty || ' ' || new_l.uom || ' × ' || new_l.unit_price end,
             'at', '')
           order by old.line_no desc) as amendments
      from ops_procure.po_lines old
      left join ops_procure.po_lines new_l on new_l.id = old.superseded_by
     where old.po_id = po.id and old.superseded_by is not null
  ) am on true

  left join lateral (
    select jsonb_agg(jsonb_build_object(
             'trx_no', t.trx_no, 'trx_date', t.trx_date,
             'amount', al.amount, 'description', t.description)
           order by t.trx_date) as payments
      from ops_acct.payment_allocations al
      join ops_acct.transactions t on t.id = al.trx_id
     where al.po_no = po.po_no and al.superseded_by is null and t.status <> 'VOID'
  ) pm on true

  left join lateral (
    select jsonb_agg(jsonb_build_object(
             'attachment_id', a.id, 'filename', a.filename, 'url', a.url,
             'kind', k.kind, 'linked_at', k.linked_at)
           order by k.linked_at) as documents
      from ops_core.attachment_links k
      join ops_core.attachments a on a.id = k.attachment_id
     where k.entity = 'purchase_order' and k.entity_no = po.po_no
       and k.unlinked_at is null
  ) dc on true;

-- ── the vendor block, whole ───────────────────────────────────────────────
--
-- `VendorJourney.pos` is a `PoJourney[]` — every order with this supplier, each
-- with its lines and each line with its receipts. `v_vendor_journey` returned
-- the totals and not the orders, and `listVendorJourneys` cast the gap away.
--
-- That one was about to ship. `/procurement/tracker` renders `journey.pos.map`
-- and `v.headline`, and it enters `LIVE_ROUTES` in this same change because
-- `createPo` was transcribed. Caught by `check-view-contracts.mjs`, which was
-- written the same afternoon after `v_po_detail` turned out to have the same
-- fault — the third instance in two days, and the first one found before
-- anybody met it rather than after.
--
-- ### The lines are a view now, not a third copy of the same lateral
--
-- `v_po_detail` builds the same nested shape inline. Rather than paste it, it
-- becomes `v_po_line_journey` — and `14_procure_po_board.sql` asserts the two
-- agree for the same order, so a change to one that is not a change to the
-- other fails rather than drifts. (`v_po_detail` keeps its own lateral for now:
-- it is restated verbatim from `0018` above, and rewriting its internals in the
-- same migration that restates it is two changes wearing one diff.)

create or replace view ops_procure.v_po_line_journey as
  select d.po_id,
         jsonb_agg(jsonb_build_object(
           'po_line_id', d.po_line_id, 'line_no', d.line_no,
           'description', d.description, 'qty', d.qty, 'uom', d.uom,
           'unit_price', d.unit_price, 'line_total', d.line_total,
           'received', d.received, 'reported', d.reported, 'over', d.over,
           'condition', d.condition,
           'receipts', coalesce(rc.receipts, '[]'::jsonb))
         order by d.line_no) as lines
    from ops_procure.v_po_line_delivery d
    left join lateral (
      select jsonb_agg(jsonb_build_object(
               'receipt_no', r.receipt_no, 'qty', r.qty_received,
               'condition', r.condition, 'at', r.received_at,
               'by', coalesce(rb.full_name, '—'),
               'qc_by', coalesce(qb.full_name, '—'),
               'note', r.note, 'status', r.status,
               -- Ids, not booleans (D268): a chip reading *photo of the goods*
               -- that nobody could open is a label about evidence rather than a
               -- way to it.
               'photo_attachment_id', (select k.attachment_id
                                         from ops_core.attachment_links k
                                        where k.entity = 'receipt' and k.entity_no = r.receipt_no
                                          and k.kind = 'goods_photo' and k.unlinked_at is null
                                        order by k.linked_at limit 1),
               'delivery_note_attachment_id', (select k.attachment_id
                                         from ops_core.attachment_links k
                                        where k.entity = 'receipt' and k.entity_no = r.receipt_no
                                          and k.kind = 'delivery_note' and k.unlinked_at is null
                                        order by k.linked_at limit 1))
             order by r.received_at) as receipts
        from ops_procure.receipts r
        left join ops_core.users rb on rb.id = r.received_by
        left join ops_core.users qb on qb.id = r.qc_by
       where r.po_line_id = d.po_line_id
    ) rc on true
   group by d.po_id;

alter view ops_procure.v_po_line_journey set (security_invoker = on);
grant select on ops_procure.v_po_line_journey to authenticated;

drop view if exists ops_procure.v_vendor_journey;

create or replace view ops_procure.v_vendor_journey as
  select v.id as vendor_id, v.name as vendor_name,
         count(j.po_id)                        as orders,
         coalesce(sum(j.contract_value), 0)    as contract_value,
         coalesce(sum(j.paid_to_date), 0)      as paid,
         greatest(coalesce(sum(j.contract_value), 0)
                  - coalesce(sum(j.paid_to_date), 0), 0) as outstanding,
         coalesce(sum(j.value_received), 0)    as value_received,
         coalesce(sum(j.billable_now), 0)      as billable_now,
         coalesce(sum(j.credit), 0)            as credit,

         -- Every order with this supplier, ordered the way the screen reads
         -- them. A vendor with three open orders and one transfer covering all
         -- three cannot be read order by order (D97), which is the whole reason
         -- this view exists — and why returning the totals without the orders
         -- was only half of it.
         coalesce(jsonb_agg(jsonb_build_object(
           'po_no',          j.po_no,
           'status',         j.status,
           'issued_at',      j.issued_at,
           'note',           j.note,
           'dp_percent',     j.dp_percent,
           'contract_value', j.contract_value,
           -- `paid`, not `paid_to_date`: `PoJourney` names it the shorter way,
           -- and a rename is the only work a client of this project may do.
           -- Doing it here means no client has to.
           'paid',           j.paid_to_date,
           'value_received', j.value_received,
           'billable_now',   j.billable_now,
           'credit',         j.credit,
           'payment_state',  j.payment_state,
           'delivery_state', j.delivery_state,
           'lines',          coalesce(ln.lines, '[]'::jsonb))
           order by j.po_no) filter (where j.po_id is not null), '[]'::jsonb) as pos

    from ops_procure.vendors v
    left join ops_procure.v_po_journey j
      on j.vendor_id = v.id and j.status <> 'CANCELLED'
    left join ops_procure.v_po_line_journey ln on ln.po_id = j.po_id
   group by v.id, v.name;

alter view ops_procure.v_vendor_journey set (security_invoker = on);
grant select on ops_procure.v_vendor_journey to authenticated;

comment on view ops_procure.v_vendor_journey is
  'Everything one vendor has going with us: the totals, and every order behind them with '
  'its lines and receipts. `headline` is NOT here — it is a locale-formatted sentence, so '
  'it is composed by whichever client is answering (see check-view-contracts.mjs). (0033)';
