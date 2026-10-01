-- procure — completing a reported arrival applies the daylight count (0205,
-- F213, D361).
--
--   REFUSALS     confirming with procurement read only; a corrected quantity
--                of zero or less (and the row is left as reported); confirming
--                twice (and the second one's quantity is not applied); the new
--                signature open to PUBLIC or anon
--   DERIVATIONS  a corrected quantity and condition land on the row in the
--                same statement as the signature, so the rack gets the
--                corrected quantity, not the night's; the audit row carries
--                before and after; the outbox event carries the corrected
--                figures; a correction to WRONG ITEM puts nothing on the rack;
--                no correction = the reported figure stands (0086's callers)

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('b6000000-0000-0000-0000-0000000000a1','pagi-b6@talaliving.com','{"full_name":"Pagi Uji"}'),
  ('b6000000-0000-0000-0000-0000000000a2','lihat-b6@talaliving.com','{"full_name":"Lihat Uji"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('b6000000-0000-0000-0000-0000000000a1','procurement','write'),
  ('b6000000-0000-0000-0000-0000000000a2','procurement','read');

insert into ops_procure.vendors (id, code, name) values
  ('b6000000-0000-0000-0000-00000000ee01','V-B6','Toko Uji B6');
insert into ops_procure.items (id, code, name, category_code, base_uom, kind) values
  ('b6000000-0000-0000-0000-00000000aa01','I-9B6','Lem B6','production','kg','goods');
insert into ops_inv.stock_settings (item_code, home_location) values ('I-9B6','BENGKEL');
insert into ops_procure.pr_documents (id, doc_no, status, requested_by, submitted_at) values
  ('b6000000-0000-0000-0000-00000000dd01','pr-b6','SUBMITTED','b6000000-0000-0000-0000-0000000000a1', now());
insert into ops_procure.pr_lines (id, doc_id, doc_no, line_no, item_id, description, qty, uom, unit_price, item_total, vendor_id)
select ('b6000000-0000-0000-0000-00000000cc0' || n)::uuid, 'b6000000-0000-0000-0000-00000000dd01', 'pr-b6', n,
       'b6000000-0000-0000-0000-00000000aa01', 'Lem ' || n, 10, 'kg', 45000, 450000,
       'b6000000-0000-0000-0000-00000000ee01'
  from generate_series(1, 3) n;

create temp table t_b6 (k text primary key, v text) on commit drop;
grant all on t_b6 to authenticated;

-- ── the night: three arrivals reported with a photo only ──────────────────
set local role authenticated;
set local request.jwt.claim.sub = 'b6000000-0000-0000-0000-0000000000a1';

do $$
declare r jsonb; ph uuid; sj uuid; n int; ln text;
begin
  ph := (ops_core.attach_file('t/b6-ph.jpg','ph.jpg','image/jpeg',1,null,'upload')->'data'->>'attachment_id')::uuid;
  sj := (ops_core.attach_file('t/b6-sj.jpg','sj.jpg','image/jpeg',1,null,'upload')->'data'->>'attachment_id')::uuid;
  insert into t_b6 values ('sj', sj::text);
  foreach n in array array[1,2,3] loop
    select line_no_full into ln from ops_procure.pr_lines
     where id = ('b6000000-0000-0000-0000-00000000cc0' || n)::uuid;
    r := ops_procure.create_receipt(10, 'GOOD', jsonb_build_array(
           jsonb_build_object('attachment_id', ph, 'kind','Receiving Item')), ln);
    assert r->'data'->>'status' = 'REPORTED', format('photo only is reported, got %s', r);
    insert into t_b6 values ('rcv' || n, r->'data'->>'receipt_no');
  end loop;
end $$;

-- ── refusals ──────────────────────────────────────────────────────────────
set local request.jwt.claim.sub = 'b6000000-0000-0000-0000-0000000000a2';
do $$
declare r jsonb;
begin
  r := ops_procure.confirm_receipt((select v from t_b6 where k = 'rcv1'), p_qty => 8);
  assert r->'error'->>'code' = 'not_permitted' and (r->>'status')::int = 403,
    format('procurement read cannot sign, got %s', r);
end $$;

set local request.jwt.claim.sub = 'b6000000-0000-0000-0000-0000000000a1';
do $$
declare r jsonb; q numeric;
begin
  foreach q in array array[0, -3] loop
    r := ops_procure.confirm_receipt((select v from t_b6 where k = 'rcv1'), p_qty => q);
    assert r->'error'->>'code' = 'bad_qty' and (r->>'status')::int = 422,
      format('qty %s is refused, got %s', q, r);
  end loop;
end $$;

reset role;
do $$
begin
  assert (select status = 'REPORTED' and qty_received = 10 from ops_procure.receipts
           where receipt_no = (select v from t_b6 where k = 'rcv1')), 'a refusal leaves the row as reported';
  assert not exists (select 1 from ops_inv.stock_moves where ref_no = (select v from t_b6 where k = 'rcv1')),
    'and nothing on the rack';
end $$;

-- ── the morning: counted in daylight, 8 not 10, two of them dented ────────
set local role authenticated;
set local request.jwt.claim.sub = 'b6000000-0000-0000-0000-0000000000a1';
do $$
declare r jsonb;
begin
  r := ops_procure.confirm_receipt((select v from t_b6 where k = 'rcv1'),
         p_delivery_note_attachment_id => (select v from t_b6 where k = 'sj')::uuid,
         p_qty => 8, p_condition => 'PARTIALLY DAMAGED');
  assert ops_core.said_ok(r), format('confirmed, got %s', r);
  assert (r->'data'->>'qty_received')::numeric = 8 and r->'data'->>'condition' = 'PARTIALLY DAMAGED',
    format('the answer carries the corrected figures, got %s', r);

  -- Signing twice is refused, and the second count is not applied.
  r := ops_procure.confirm_receipt((select v from t_b6 where k = 'rcv1'), p_qty => 3);
  assert r->'error'->>'code' = 'already_confirmed' and (r->>'status')::int = 409,
    format('signed once, got %s', r);

  -- Corrected to WRONG ITEM: signed for, not kept.
  r := ops_procure.confirm_receipt((select v from t_b6 where k = 'rcv2'), p_condition => 'WRONG ITEM');
  assert ops_core.said_ok(r), format('wrong item confirmed, got %s', r);

  -- No correction: the reported figure stands, as before 0205.
  r := ops_procure.confirm_receipt((select v from t_b6 where k = 'rcv3'));
  assert ops_core.said_ok(r), format('plain confirm, got %s', r);
end $$;

reset role;

do $$
declare rc ops_procure.receipts; m record; a record; e record; no1 text; no2 text; no3 text;
begin
  select v into no1 from t_b6 where k = 'rcv1';
  select v into no2 from t_b6 where k = 'rcv2';
  select v into no3 from t_b6 where k = 'rcv3';

  select * into rc from ops_procure.receipts where receipt_no = no1;
  assert rc.status = 'CONFIRMED' and rc.qty_received = 8 and rc.condition = 'PARTIALLY DAMAGED',
    format('the row holds the daylight count, got %s %s %s', rc.status, rc.qty_received, rc.condition);
  assert rc.confirmed_by = 'b6000000-0000-0000-0000-0000000000a1', 'signed by the person confirming';

  select * into m from ops_inv.stock_moves where ref_no = no1;
  assert m.qty = 8 and m.location = 'BENGKEL',
    format('the rack gets the corrected 8, not the night''s 10, got %s', coalesce(m.qty::text, '(nothing)'));
  assert (select count(*) from ops_inv.stock_moves where ref_no = no1) = 1, 'stocked once';

  select * into a from ops_core.audit_log
   where entity = 'receipt' and entity_no = no1 and action = 'confirm' and outcome = 'ok';
  assert a.before = '{"qty": 10, "status": "REPORTED", "condition": "GOOD"}'::jsonb,
    format('audit before, got %s', a.before);
  assert a.after = '{"qty": 8, "status": "CONFIRMED", "condition": "PARTIALLY DAMAGED"}'::jsonb,
    format('audit after, got %s', a.after);
  assert a.actor_id = 'b6000000-0000-0000-0000-0000000000a1', 'audit names who corrected it';

  select * into e from ops_core.outbox
   where event_type = 'procurement.receipt.confirmed' and entity_no = no1;
  assert (e.payload->>'qty')::numeric = 8 and e.payload->>'condition' = 'PARTIALLY DAMAGED',
    format('the event carries the corrected figures, got %s', e.payload);

  assert exists (select 1 from ops_core.attachment_links
                  where entity = 'receipt' and entity_no = no1 and kind = 'delivery_note'),
    'the tanda terima is linked in the same call';

  assert (select condition from ops_procure.receipts where receipt_no = no2) = 'WRONG ITEM', 'corrected to wrong item';
  assert not exists (select 1 from ops_inv.stock_moves where ref_no = no2), 'a wrong item is not kept';
  assert exists (select 1 from ops_core.outbox where event_type = 'inventory.receipt.not_stocked'
                   and entity_no = no2), 'and it says why';

  assert (select qty_received from ops_procure.receipts where receipt_no = no3) = 10, 'uncorrected stays 10';
  assert (select qty from ops_inv.stock_moves where ref_no = no3) = 10, 'and 10 is stocked';
  assert (select after->>'qty' from ops_core.audit_log
           where entity = 'receipt' and entity_no = no3 and action = 'confirm' and outcome = 'ok') = '10',
    'its audit row says nothing changed but the status';

  assert (select on_hand from ops_inv.v_stock_item where item_code = 'I-9B6') = 18, '8 + 10';
end $$;

-- ── the new signature is not open to the browser key ─────────────────────
do $$
declare f regprocedure := 'ops_procure.confirm_receipt(text, uuid, text, text, uuid, numeric, ops_procure.receipt_condition_t)';
begin
  assert not has_function_privilege('public', f, 'EXECUTE'), 'not PUBLIC';
  assert not has_function_privilege('anon', f, 'EXECUTE'), 'not anon';
  assert has_function_privilege('authenticated', f, 'EXECUTE'), 'authenticated may call it';
  assert (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'ops_procure' and p.proname = 'confirm_receipt') = 1,
    'one confirm_receipt, not an overload beside the old one';
end $$;

rollback;
