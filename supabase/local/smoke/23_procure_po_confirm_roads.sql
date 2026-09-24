-- procure — the two roads to a confirmed order (0143, D267, D69).
--
--   Leadership writes it   → confirmed in the same act, self_confirmed, and
--                            asking chat about it again is refused.
--   Staff write it         → request_po_approval picks the approver; the answer
--                            arrives from the chat worker (service_role) and is
--                            recorded against the addressee — never anybody else,
--                            never from a browser, never without a reason to decline.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('23230000-0000-0000-0000-00000000a11d','andi@talaliving.com','{"full_name":"Andi"}'),
  ('23230000-0000-0000-0000-00000000ce00','evin@talaliving.com','{"full_name":"Evin"}'),
  ('23230000-0000-0000-0000-00000000f11a','rina@talaliving.com','{"full_name":"Rina"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('23230000-0000-0000-0000-00000000a11d','procurement','write'),
  ('23230000-0000-0000-0000-00000000ce00','procurement','write'),
  ('23230000-0000-0000-0000-00000000f11a','procurement','write');
insert into ops_core.user_authorities (user_id, authority) values
  ('23230000-0000-0000-0000-00000000ce00','approve_goods');

create temp table t_ctx (k text primary key, v text) on commit drop;
grant all on t_ctx to authenticated, service_role;

set local role authenticated;

-- ── road one: the CEO writes his own ──────────────────────────────────────
set local request.jwt.claim.sub = '23230000-0000-0000-0000-00000000ce00';
do $$
declare r jsonb; v text; po record;
begin
  r := ops_procure.create_vendor('CV JALAN UJI'); v := r->'data'->>'code';
  insert into t_ctx values ('vendor', v);
  r := ops_procure.create_po(v, jsonb_build_array(jsonb_build_object('description','Meja','qty',1,'uom','unit','unit_price',1000000)));
  assert ops_core.said_ok(r) and (r->'data'->>'self_confirmed')::boolean, format('%s', r);
  select * into po from ops_procure.purchase_orders where po_no = r->'data'->>'po_no';
  assert po.status = 'DRAFT', 'still a draft — issuing is its own act';
  assert po.approved_at is not null and po.self_confirmed, 'confirmed by its author, and it says so';

  r := ops_procure.request_po_approval(p_po_no => po.po_no);
  assert r->'error'->>'code' = 'already_approved', format('no card for a decision already taken, got %s', r);
  assert ops_core.said_ok(ops_procure.issue_po(po.po_no)), 'and it can be issued straight away';
end $$;

-- ── road two: staff write it, leadership answer from chat ─────────────────
set local request.jwt.claim.sub = '23230000-0000-0000-0000-00000000a11d';
do $$
declare r jsonb; po text;
begin
  r := ops_procure.create_po((select v from t_ctx where k='vendor'),
        jsonb_build_array(jsonb_build_object('description','Kursi','qty',4,'uom','unit','unit_price',500000)));
  assert ops_core.said_ok(r) and not (r->'data'->>'self_confirmed')::boolean, format('%s', r);
  po := r->'data'->>'po_no';
  insert into t_ctx values ('po', po);
  assert ops_procure.issue_po(po)->'error'->>'code' = 'not_approved', 'staff cannot send it unconfirmed';

  r := ops_procure.request_po_approval(p_po_no => po);
  assert ops_core.said_ok(r) and r->'data'->>'to' = 'evin@talaliving.com', format('the card goes to the approver, got %s', r);
  assert not exists (select 1 from ops_core.outbox where entity_no = po and payload::text like '%potok%'),
    'the token is a capability and never travels in the readable outbox';

  -- A browser cannot answer for the CEO, whatever address it types.
  begin
    perform ops_procure.answer_po_approval('x', true, 'evin@talaliving.com');
    assert false, 'answering is the chat worker''s, not a session''s';
  exception when insufficient_privilege then null;
  end;
end $$;

-- The chat worker, holding the platform-verified address.
set local role service_role;
do $$
declare r jsonb; po text := (select v from t_ctx where k='po'); tok text; row record;
begin
  -- The card, as the worker builds it: one order, with the lines the CEO is
  -- deciding on and the token that carries the answer back.
  tok := ops_procure.po_approval_card(po) ->> 'token';
  assert tok like 'potok%', format('the card carries its token, got %s', ops_procure.po_approval_card(po));
  assert jsonb_array_length(ops_procure.po_approval_card(po) -> 'lines') = 1, 'and what is being decided';

  r := ops_procure.answer_po_approval(tok, true, 'rina@talaliving.com');
  assert r->'error'->>'code' = 'not_the_addressee', format('only the person the card went to, got %s', r);

  r := ops_procure.answer_po_approval(tok, false, 'evin@talaliving.com');
  assert r->'error'->>'code' = 'reason_required', format('declining needs a sentence, got %s', r);

  r := ops_procure.answer_po_approval(tok, true, 'evin@talaliving.com', 'OK');
  assert ops_core.said_ok(r), format('%s', r);
  assert ops_procure.po_approval_card(po) is null, 'an answered card is gone';
  set local role postgres;
  select * into row from ops_procure.purchase_orders where po_no = po;
  set local role service_role;
  assert row.approved_by = '23230000-0000-0000-0000-00000000ce00', 'recorded against the answerer, not the worker';
  assert not row.self_confirmed and row.approval_token is null, 'a second pair of eyes, and the card is spent';

  r := ops_procure.answer_po_approval(tok, true, 'evin@talaliving.com');
  assert (r->'error'->>'status')::int = 404, format('a spent card answers nothing, got %s', r);
end $$;

set local role authenticated;
set local request.jwt.claim.sub = '23230000-0000-0000-0000-00000000a11d';
do $$
begin
  assert ops_core.said_ok(ops_procure.issue_po((select v from t_ctx where k='po'))), 'confirmed from chat, so staff can send it';
end $$;

rollback;
