-- procure PO board — the four things the seams could not say, and the view the
-- board reads.
--
-- `04_procure_seams.sql` proves the happy path and the guards that already
-- existed. This proves what `0033` added, and every one of them is a *reason*
-- rather than a mechanism:
--
--   * leadership can say **no**, and the no is recorded rather than absent
--   * a no with no sentence is refused — somebody has to tell the supplier
--   * an amendment carries why it happened (D135)
--   * an order nobody will finish can be closed **by saying so**, and the audit
--     row keeps what was still outstanding when it was waived
--   * the approval question names who was asked, and refuses somebody who does
--     not hold the authority
--
-- And the derivation: `v_po_board` gives the board its row — current lines
-- only, the vendor's name, the money summary nested, and `days_late` computed
-- exactly as the drawer computes it.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('eeee0000-0000-0000-0000-00000000cece','ceo@talaliving.com',  '{"full_name":"Evin"}'),
  ('eeee0000-0000-0000-0000-00000000f1f1','fin@talaliving.com',  '{"full_name":"Rina"}'),
  ('eeee0000-0000-0000-0000-00000000d1d1','proc@talaliving.com', '{"full_name":"Andi"}');

insert into ops_core.user_authorities (user_id, authority) values
  ('eeee0000-0000-0000-0000-00000000cece','approve_goods'),
  ('eeee0000-0000-0000-0000-00000000f1f1','approve_funds');
insert into ops_core.user_modules (user_id, module, level) values
  ('eeee0000-0000-0000-0000-00000000cece','procurement','write'),
  ('eeee0000-0000-0000-0000-00000000f1f1','procurement','write'),
  ('eeee0000-0000-0000-0000-00000000f1f1','accounting','write'),
  ('eeee0000-0000-0000-0000-00000000d1d1','procurement','admin');

insert into ops_procure.vendors (id, code, name, is_curated) values
  ('ee110000-0000-0000-0000-000000000001','V-9001','Kayu Sejahtera', true);
insert into ops_procure.items (id, code, name, category_code, base_uom) values
  ('ee220000-0000-0000-0000-000000000001','I-9001','Papan jati','raw-wood','batang');

set local role authenticated;
set local request.jwt.claim.sub = 'eeee0000-0000-0000-0000-00000000d1d1';

do $$
declare r jsonb;
begin
  r := ops_procure.create_po(
    p_vendor_code => 'V-9001',
    p_lines => '[{"description":"Papan jati 4x6","qty":10,"uom":"batang","unit_price":500000}]'::jsonb,
    p_expected_delivery => (ops_core.office_day() - 3)::text::date);
  assert ops_core.said_ok(r), format('a draft order is written, got %s', r);
end $$;

-- The po_no is generated, so everything below reaches for it rather than
-- hard-coding one: a test that knows the counter is a test that breaks when
-- somebody else's fixture increments it first.
create temporary table po_under_test as
  select po_no from ops_procure.purchase_orders where po_no like 'po-%'
   and vendor_id = 'ee110000-0000-0000-0000-000000000001';

/* ── asking: of somebody who actually holds the authority ──────────────── */

do $$
declare r jsonb; po text;
begin
  select po_no into po from po_under_test;

  -- Finance holds approve_funds, not approve_goods. Asking them is not a
  -- smaller mistake than asking nobody: the question would sit unanswerable.
  r := ops_procure.request_po_approval(p_po_no => po, p_to => 'fin@talaliving.com');
  assert r ->> 'outcome' = 'refused', format('fin does not approve goods, got %s', r);
  assert r -> 'error' ->> 'code' = 'not_an_approver', format('got %s', r);

  r := ops_procure.request_po_approval(p_po_no => po, p_to => 'ceo@talaliving.com');
  assert ops_core.said_ok(r), format('the CEO can be asked, got %s', r);
  assert r -> 'data' ->> 'to' = 'ceo@talaliving.com',
    format('and the answer names who was asked, got %s', r -> 'data');
  assert (r -> 'data' ->> 'contract_value')::numeric = 5000000,
    format('with what is being committed, got %s', r -> 'data');
end $$;

/* ── leadership says no, and the no is a record ────────────────────────── */

set local request.jwt.claim.sub = 'eeee0000-0000-0000-0000-00000000cece';
do $$
declare r jsonb; po text; appr timestamptz;
begin
  select po_no into po from po_under_test;

  -- A refusal with no sentence attached is a message procurement cannot pass
  -- on. This is the one thing declining adds beyond a boolean.
  r := ops_procure.approve_po(p_po_no => po, p_approved => false);
  assert r ->> 'outcome' = 'refused', format('no must come with a reason, got %s', r);
  assert r -> 'error' ->> 'code' = 'reason_required', format('got %s', r);

  r := ops_procure.approve_po(p_po_no => po, p_approved => false,
                              p_note => 'Harga di atas pasaran, cari pembanding.');
  assert ops_core.said_ok(r), format('a reasoned no is accepted, got %s', r);

  select approved_at into appr from ops_procure.purchase_orders where po_no = po;
  assert appr is null, 'a declined order is not approved';
end $$;

set local role postgres;
do $$
declare n int; reason text;
begin
  -- The decision is in the trail as its own action. Before `0033` the only
  -- trace of a no was `approved_at` staying null — indistinguishable from
  -- nobody having looked yet, which is the whole problem.
  select count(*) into n from ops_core.audit_log
   where entity = 'purchase_order' and action = 'decline' and outcome = 'ok';
  assert n = 1, format('the no is recorded as a decision, saw %s rows', n);
end $$;
set local role authenticated;

-- And it can still be confirmed afterwards: a no is an answer, not a state the
-- order is stuck in. The supplier comes back with a better price.
set local request.jwt.claim.sub = 'eeee0000-0000-0000-0000-00000000cece';
do $$
declare r jsonb; po text;
begin
  select po_no into po from po_under_test;
  r := ops_procure.approve_po(p_po_no => po, p_note => 'Sudah turun, lanjut.');
  assert ops_core.said_ok(r), format('and then confirmed, got %s', r);
end $$;

set local request.jwt.claim.sub = 'eeee0000-0000-0000-0000-00000000d1d1';
do $$
declare r jsonb; po text;
begin
  select po_no into po from po_under_test;
  r := ops_procure.issue_po(p_po_no => po);
  assert ops_core.said_ok(r), format('and sent, got %s', r);
end $$;

/* ── the amendment, and the reason it happened ─────────────────────────── */

do $$
declare r jsonb; po text; q numeric; p numeric;
begin
  select po_no into po from po_under_test;

  r := ops_procure.amend_po_line(p_po_no => po, p_line_no => 1, p_reason => '   ',
                                 p_qty => 8);
  assert r ->> 'outcome' = 'refused', format('an amendment needs a reason, got %s', r);
  assert r -> 'error' ->> 'code' = 'reason_required', format('got %s', r);

  -- Quantity alone. The price is not restated, and must not be rewritten from
  -- whatever the drawer happened to be holding.
  r := ops_procure.amend_po_line(p_po_no => po, p_line_no => 1,
                                 p_reason => 'Vendor hanya punya delapan.',
                                 p_qty => 8);
  assert ops_core.said_ok(r), format('quantity alone amends, got %s', r);
  assert r -> 'data' ->> 'reason' = 'Vendor hanya punya delapan.',
    format('and the reason is carried, got %s', r -> 'data');

  select qty, unit_price into q, p from ops_procure.po_lines
   where po_id = (select id from ops_procure.purchase_orders where po_no = po)
     and superseded_by is null;
  assert q = 8, format('the quantity moved, got %s', q);
  assert p = 500000, format('the price did not, got %s', p);

  -- Nothing to record is not an amendment: writing one would bump the revision
  -- and tell a vendor their paper is stale when it is not.
  r := ops_procure.amend_po_line(p_po_no => po, p_line_no => 1,
                                 p_reason => 'iseng', p_qty => 8);
  assert r ->> 'outcome' = 'noop', format('an amendment that changes nothing is a noop, got %s', r);
end $$;

/* ── the board ─────────────────────────────────────────────────────────── */

do $$
declare r record; po text;
begin
  select po_no into po from po_under_test;
  select * into r from ops_procure.v_po_board where po_no = po;

  assert r.vendor_name = 'Kayu Sejahtera', format('got %s', r.vendor_name);

  -- One live line, not two. The superseded row is an amendment and belongs in
  -- the drawer (D129); a board showing both would show this order twice.
  assert jsonb_array_length(r.lines) = 1,
    format('the board shows the order as it stands, got %s', r.lines);
  assert (r.lines -> 0 ->> 'qty')::numeric = 8, 'and shows the amended quantity';

  assert (r.status_view ->> 'contract_value')::numeric = 4000000,
    format('8 × 500.000, got %s', r.status_view ->> 'contract_value');
  assert r.status_view ->> 'payment_state' is not null, 'the money summary is nested whole';

  -- Promised three days ago, nothing delivered, not closed.
  assert r.days_late = 3, format('three days past the promise, got %s', r.days_late);
end $$;

/* ── the vendor block, and the two places its lines are built ──────────── */

do $$
declare r record; po text; from_detail jsonb; from_view jsonb;
begin
  select po_no into po from po_under_test;
  select * into r from ops_procure.v_vendor_journey
   where vendor_id = 'ee110000-0000-0000-0000-000000000001';

  assert r.orders = 1, format('one order with this supplier, got %s', r.orders);
  assert jsonb_array_length(r.pos) = 1,
    format('and the order itself is in the block, got %s', r.pos);
  assert r.pos -> 0 ->> 'po_no' = po, 'named';
  -- `paid`, not `paid_to_date`: `PoJourney` names it the shorter way, and the
  -- view does the rename so no client has to.
  assert r.pos -> 0 ? 'paid', format('PoJourney names it `paid`, got %s', r.pos -> 0);
  assert jsonb_array_length(r.pos -> 0 -> 'lines') = 1, 'with its lines';

  -- `v_po_line_journey` and `v_po_detail`'s own lateral build the same nested
  -- shape. This is the assertion that stops them drifting: change one without
  -- the other and it fails here rather than six weeks later, when a receipt
  -- shows on the drawer and not on the tracker.
  select lines into from_view from ops_procure.v_po_line_journey
   where po_id = (select id from ops_procure.purchase_orders where po_no = po);
  select lines into from_detail from ops_procure.v_po_detail where po_no = po;
  assert from_view = from_detail,
    format('the drawer and the tracker must build one shape%s  view: %s%s  detail: %s',
           E'\n', from_view, E'\n', from_detail);
end $$;

-- An order nobody has ordered from still has no block: `listVendorJourneys`
-- filters on `orders > 0`, and a vendor with an empty `pos` would be a row the
-- tracker draws a heading for and nothing under.
do $$
declare r record;
begin
  select * into r from ops_procure.v_vendor_journey
   where vendor_id <> 'ee110000-0000-0000-0000-000000000001' limit 1;
  if found then
    assert r.orders = 0, 'a vendor with no orders reports none';
    assert r.pos = '[]'::jsonb, format('and an empty array, not a null, got %s', r.pos);
  end if;
end $$;

/* ── closing an order that will never finish ───────────────────────────── */

set local request.jwt.claim.sub = 'eeee0000-0000-0000-0000-00000000d1d1';
do $$
declare r jsonb; po text;
begin
  select po_no into po from po_under_test;
  -- Closing says we owe nothing more on it, which is Finance's to say.
  r := ops_procure.close_po(p_po_no => po, p_settle_reason => 'Sudah tidak dikejar.');
  assert r ->> 'outcome' = 'refused', format('procurement does not close orders, got %s', r);
  assert r -> 'error' ->> 'code' = 'authority_required', format('got %s', r);
end $$;

set local request.jwt.claim.sub = 'eeee0000-0000-0000-0000-00000000f1f1';
do $$
declare r jsonb; po text; st text;
begin
  select po_no into po from po_under_test;

  r := ops_procure.close_po(p_po_no => po);
  assert r ->> 'outcome' = 'refused', format('nothing arrived or was paid, got %s', r);
  assert r -> 'error' ->> 'code' = 'close_refused', format('got %s', r);
  -- A refusal that only says no leaves somebody clicking it again next week.
  assert jsonb_array_length(r -> 'error' -> 'detail' -> 'blockers') = 2,
    format('it names both, got %s', r -> 'error' -> 'detail' -> 'blockers');

  -- The whole point of `0033`: an order can be written off, by saying so.
  r := ops_procure.close_po(p_po_no => po,
         p_settle_reason => 'Supplier berhenti menjawab; sisa dua batang direlakan.');
  assert ops_core.said_ok(r), format('a settled close is accepted, got %s', r);
  assert (r -> 'data' ->> 'settled_early')::boolean,
    'and it is marked as settled early rather than completed';
  assert (r -> 'data' ->> 'outstanding')::numeric = 4000000,
    format('with what was still owed when it was waived, got %s', r -> 'data' ->> 'outstanding');

  select status into st from ops_procure.purchase_orders where po_no = po;
  assert st = 'CLOSED', format('got %s', st);

  -- And `days_late` stops: a closed order is not late, it is finished with.
  assert (select days_late from ops_procure.v_po_board where po_no = po) is null,
    'a closed order is no longer counted late';
end $$;

/* ── REFUSAL: a draft is cancelled, never closed ───────────────────────── */

set local role postgres;
insert into ops_procure.purchase_orders (id, po_no, vendor_id, status, created_by)
values ('ee330000-0000-0000-0000-000000000001','po-26-09-21_99',
        'ee110000-0000-0000-0000-000000000001','DRAFT',
        'eeee0000-0000-0000-0000-00000000d1d1');
set local role authenticated;

do $$
declare r jsonb;
begin
  -- Fatal, and no reason overrides it. Cancelling and closing mean different
  -- things to a vendor, and only one of them was ever sent a piece of paper.
  r := ops_procure.close_po(p_po_no => 'po-26-09-21_99',
                            p_settle_reason => 'tetap saja tutup');
  assert r ->> 'outcome' = 'duplicate', format('a draft cannot be closed, got %s', r);
  assert r -> 'error' ->> 'code' = 'never_issued', format('got %s', r);
end $$;

-- A draft with no lines still appears on the board. `v_po_status` aggregates
-- over lines, so an order written a minute ago has no row there — and a draft
-- that vanishes is a draft nobody can finish.
do $$
declare n int;
begin
  select count(*) into n from ops_procure.v_po_board where po_no = 'po-26-09-21_99';
  assert n = 1, format('an empty draft is still on the board, saw %s', n);
end $$;

rollback;
