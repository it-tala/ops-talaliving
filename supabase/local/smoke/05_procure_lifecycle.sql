-- procure — one request and one order, from nothing, through the seams only.
--
-- The other files reach into tables to set a scene and then test one rule. This
-- one touches **no table directly after the people exist**: every row is
-- created by the seam that owns it, in the order a real week happens in. That
-- is a different kind of test, and it catches a different kind of bug — a seam
-- whose output the next seam cannot consume, a document number that does not
-- round-trip, a view that is right about rows nobody can actually create.
--
-- It also proves the refusals that only exist at creation time:
--   * a request with no lines (422)
--   * an order line with no price — a contract value nobody agreed (422)
--   * a receiving report with no photograph (422)
--   * asking leadership to approve a bare number (422, naming the lines)
--   * nobody holding approve_goods, so there is nobody to ask (409)

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('eeeeeeee-0000-0000-0000-00000000ce00','evin@talaliving.com','{"full_name":"Evin Jonathan"}'),
  ('eeeeeeee-0000-0000-0000-00000000f11a','rina@talaliving.com','{"full_name":"Rina Kartika"}'),
  ('eeeeeeee-0000-0000-0000-00000000a11d','andi@talaliving.com','{"full_name":"Andi Prasetyo"}');
insert into ops_core.user_authorities (user_id, authority) values
  ('eeeeeeee-0000-0000-0000-00000000f11a','approve_funds'),
  ('eeeeeeee-0000-0000-0000-00000000f11a','post_ledger');
insert into ops_core.user_modules (user_id, module, level) values
  ('eeeeeeee-0000-0000-0000-00000000ce00','procurement','read'),
  ('eeeeeeee-0000-0000-0000-00000000f11a','procurement','write'),
  ('eeeeeeee-0000-0000-0000-00000000f11a','accounting','write'),
  ('eeeeeeee-0000-0000-0000-00000000a11d','procurement','write');
insert into ops_procure.projects (code, name) values ('25099','HOTEL UJI');

set local role authenticated;
set local request.jwt.claim.sub = 'eeeeeeee-0000-0000-0000-00000000a11d';

-- ── reference data, created the way a person creates it ───────────────────
-- Uncurated, and usable immediately. Refusing a name somebody typed is how a
-- workshop ends up buying off-system (D30).
do $$
declare r jsonb; vcode text; icode text; curated boolean;
begin
  r := ops_procure.create_vendor('TOKO BARU SUMBER JAYA');
  assert ops_core.said_ok(r), format('a name a human types is always accepted, got %s', r);
  vcode := r -> 'data' ->> 'code';
  assert (r -> 'data' ->> 'is_curated')::boolean = false,
         'and it arrives uncurated — visible in lists, absent from dropdowns';

  r := ops_procure.create_item('Plywood 18mm','raw-wood','lembar');
  assert ops_core.said_ok(r), format('got %s', r);
  icode := r -> 'data' ->> 'code';
  -- Five digits, like the imported catalogue (I-00001 … I-01045), not four (0112).
  assert icode ~ '^I-\d{5}$', format('item code has five digits, got %s', icode);

  -- Curation is a flag with a name on it, never a gate.
  r := ops_procure.curate_vendor(vcode, true);
  assert ops_core.said_ok(r), format('got %s', r);
  select is_curated into curated from ops_procure.vendors where code = vcode;
  assert curated, 'curating sets the flag';

  r := ops_procure.curate_vendor(vcode, true);
  assert r ->> 'outcome' = 'noop', format('curating twice changes nothing, got %s', r);

  r := ops_procure.create_item('Sekrup','nonexistent-category');
  assert r -> 'error' ->> 'code' = 'no_such_category',
         format('a category nobody defined is refused, got %s', r);
end $$;

-- ── the request ───────────────────────────────────────────────────────────
do $$
declare r jsonb;
begin
  r := ops_procure.create_pr('[]'::jsonb);
  assert r -> 'error' ->> 'code' = 'lines_required',
         format('a request with no lines is not a request, got %s', r);

  r := ops_procure.create_pr(
    jsonb_build_array(jsonb_build_object('description','x')), 'NOPE');
  assert (r -> 'error' ->> 'status')::int = 404,
         format('a project code that names nothing is a 404, got %s', r);
end $$;

do $$
declare r jsonb; doc text; v uuid; i uuid; total numeric;
begin
  select id into v from ops_procure.vendors where name = 'TOKO BARU SUMBER JAYA';
  select id into i from ops_procure.items where name = 'Plywood 18mm';

  r := ops_procure.create_pr(jsonb_build_array(
        jsonb_build_object('description','Plywood 18mm — meja HOTEL UBUD',
          'qty', 10, 'uom','lembar','unit_price',100000,
          'vendor_id', v, 'item_id', i, 'category','RAW MATERIAL',
          'purpose','Laminating meja rapat'),
        -- No quantity and no price: a lump sum the vendor quoted. Plenty of
        -- real lines look like this, and deriving the total from a missing
        -- quantity would silently zero the one number that mattered (D75).
        jsonb_build_object('description','Ongkos kirim ke Ubud',
          'item_total', 250000, 'vendor_id', v)
      ), '25099');
  assert ops_core.said_ok(r), format('got %s', r);
  doc := r -> 'data' ->> 'doc_no';
  assert (r -> 'data' ->> 'lines')::int = 2, format('got %s', r);

  -- The generated public code round-trips: the seam minted the document
  -- number, and the line carries it without anybody assembling a string.
  assert exists (select 1 from ops_procure.pr_lines where line_no_full = doc || '-L02'),
         'the second line is L02 of that document';

  select item_total into total from ops_procure.pr_lines where line_no_full = doc || '-L01';
  assert total = 1000000, format('10 × 100.000, computed, got %s', total);

  select item_total into total from ops_procure.pr_lines where line_no_full = doc || '-L02';
  assert total = 250000, format('a lump sum survives having no qty, got %s', total);
end $$;

-- Editing before anybody has decided. `max + 1` for the added line, not
-- `count + 1` — a removed line keeps its number.
do $$
declare r jsonb; doc text; q numeric; total numeric;
begin
  select doc_no into doc from ops_procure.pr_documents order by created_at desc limit 1;

  r := ops_procure.update_line(doc || '-L01', '{"qty": 12}'::jsonb);
  assert ops_core.said_ok(r), format('got %s', r);
  select qty, item_total into q, total from ops_procure.pr_lines where line_no_full = doc || '-L01';
  assert q = 12 and total = 1200000,
         format('the total follows the quantity, got %s at %s', q, total);
  assert r -> 'data' is not null and (r -> 'error') is null, 'ok carries no error';

  r := ops_procure.add_draft_line(doc, jsonb_build_object('description','Amplas 240', 'qty', 5, 'uom','lembar','unit_price',12000));
  assert ops_core.said_ok(r), format('got %s', r);
  assert r -> 'data' ->> 'line_no' = doc || '-L03', format('got %s', r);
end $$;

-- ── nobody to ask ─────────────────────────────────────────────────────────
-- Nobody in this fixture holds `approve_goods` yet. Asking is a 409 that says
-- so, rather than a card sent into the dark.
do $$
declare r jsonb; doc text;
begin
  select doc_no into doc from ops_procure.pr_documents order by created_at desc limit 1;
  perform ops_procure.submit_pr(doc);

  r := ops_procure.request_approval(array[doc || '-L01']);
  assert r -> 'error' ->> 'code' = 'no_approver',
         format('with nobody holding the authority there is nobody to ask, got %s', r);
end $$;

-- As the owner: granting an authority is `it.manage_roles`, and Andi holds
-- procurement.write. That the fixture cannot do this from where it stands is
-- the access model working, not the test being awkward.
set local role postgres;
insert into ops_core.user_authorities (user_id, authority)
  values ('eeeeeeee-0000-0000-0000-00000000ce00','approve_goods');
set local role authenticated;
set local request.jwt.claim.sub = 'eeeeeeee-0000-0000-0000-00000000a11d';

-- ── a bare number is refused before it is sent ────────────────────────────
-- Sending one to somebody's phone is worse than sending nothing: they cannot
-- check it there, so they either say yes blind or put the phone down (D125).
do $$
declare r jsonb; doc text; lines jsonb;
begin
  select doc_no into doc from ops_procure.pr_documents order by created_at desc limit 1;

  r := ops_procure.request_approval(array[doc || '-L01', doc || '-L02']);
  assert r -> 'error' ->> 'code' = 'support_required',
         format('nothing stands behind either line, got %s', r);
  lines := r -> 'error' -> 'detail' -> 'lines';
  assert jsonb_array_length(lines) = 2, format('and it names them, got %s', lines);
end $$;

-- Attach the shop link the price came from, and it goes.
do $$
declare r jsonb; doc text; att uuid; tok text; n int;
begin
  select doc_no into doc from ops_procure.pr_documents order by created_at desc limit 1;

  insert into ops_core.attachments (url, filename, uploaded_by)
  values ('https://toko.example/plywood','tokopedia-plywood',
          'eeeeeeee-0000-0000-0000-00000000a11d')
  returning id into att;
  insert into ops_core.attachment_links (attachment_id, entity, entity_no, kind, linked_by)
  values (att, 'pr_line', doc || '-L01', 'quotation', 'eeeeeeee-0000-0000-0000-00000000a11d');

  r := ops_procure.request_approval(array[doc || '-L01', doc || '-L02']);
  assert r -> 'error' ->> 'code' = 'support_required',
         format('L02 still has nothing, so the send still refuses, got %s', r);

  -- One supported line on its own sends. The question goes to whoever holds
  -- the authority — not to a name in a config file (D19).
  r := ops_procure.request_approval(array[doc || '-L01']);
  assert ops_core.said_ok(r), format('got %s', r);
  assert r -> 'data' ->> 'sent_to' = 'evin@talaliving.com',
         format('it found the approver by their authority, got %s', r);

  select count(*) into n from ops_procure.approval_requests where answered_at is null;
  assert n = 1, format('one card outstanding, saw %s', n);

  -- Asking twice is nagging, not a record.
  r := ops_procure.request_approval(array[doc || '-L01']);
  assert r -> 'error' ->> 'code' = 'nothing_to_ask',
         format('already waiting for an answer, got %s', r);
end $$;

-- ── the answer, from chat ─────────────────────────────────────────────────
do $$
declare r jsonb; tok text; st text;
begin
  select token into tok from ops_procure.approval_requests where answered_at is null;

  -- Andi is still the signed-in user. The approval is Evin's, because the
  -- signed webhook said so — that is the whole reason the question left the
  -- room (D69).
  r := ops_procure.answer_request(tok, true, 'evin@talaliving.com');
  assert ops_core.said_ok(r), format('got %s', r);
  assert r -> 'data' ->> 'by' = 'evin@talaliving.com', format('got %s', r);

  select status into st from ops_procure.v_pr_line_status
   where line_no_full = r -> 'data' ->> 'line_no';
  assert st = 'APPROVED', format('approved and unpaid, got %s', st);
end $$;

-- ── the round rolls it up ─────────────────────────────────────────────────
do $$
declare r jsonb; rno text; total numeric;
begin
  r := ops_procure.sync_round();
  assert ops_core.said_ok(r), format('one approved unpaid line to roll in, got %s', r);
  assert (r -> 'data' ->> 'added')::int = 1, format('got %s', r);
  assert (r -> 'data' ->> 'opened')::boolean, 'and it opened the round to hold it';
  rno := r -> 'data' ->> 'round_no';

  -- Running it again with nothing new is a successful nothing-happened, not an
  -- error and not a silent 200.
  r := ops_procure.sync_round();
  assert r ->> 'outcome' = 'noop', format('got %s', r);

  select requested_total into total from ops_procure.v_round_summary v where v.round_no = rno;
  assert total = 1200000, format('an OPEN round recomputes what is still owed, got %s', total);
end $$;

set local request.jwt.claim.sub = 'eeeeeeee-0000-0000-0000-00000000f11a';
do $$
declare r jsonb; rno text; st text;
begin
  select v.round_no into rno from ops_procure.v_round_summary v limit 1;

  r := ops_procure.close_round(rno);
  assert r -> 'error' ->> 'code' = 'never_approved',
         format('an open round has not been decided, got %s', r);

  r := ops_procure.approve_round(rno);
  assert ops_core.said_ok(r), format('got %s', r);
  assert (r -> 'data' ->> 'requested_total')::numeric = 1200000, format('got %s', r);

  -- Closing with a line still owed is allowed and reported, not refused: the
  -- line comes back into the next round through sync_round, which is how it
  -- stays somebody's problem without anybody carrying it forward by hand.
  r := ops_procure.close_round(rno);
  assert ops_core.said_ok(r), format('got %s', r);
  assert (r -> 'data' ->> 'still_owed')::int = 1,
         format('and it says what is still owed, got %s', r);
end $$;

-- ── the order ─────────────────────────────────────────────────────────────
set local request.jwt.claim.sub = 'eeeeeeee-0000-0000-0000-00000000a11d';
do $$
declare r jsonb;
begin
  r := ops_procure.create_po('NOPE', '[]'::jsonb);
  assert r -> 'error' ->> 'code' = 'vendor_required', format('got %s', r);

  r := ops_procure.create_po('V-0001', jsonb_build_array(
        jsonb_build_object('description','Meja jati','qty',4,'uom','unit','unit_price',0)));
  assert r -> 'error' ->> 'code' = 'price_required',
         format('a contract value nobody agreed is not a contract, got %s', r);
  assert r -> 'error' ->> 'message' like '%Meja jati%',
         format('and it names which line, got %s', r);
end $$;

do $$
declare r jsonb; po text; st text; n int; dp numeric;
begin
  r := ops_procure.create_po('V-0001', jsonb_build_array(
        jsonb_build_object('description','Meja jati 180cm','qty',4,'uom','unit','unit_price',2500000)),
        30, 'Termin 30/70.', (ops_core.office_day() + 14));
  assert ops_core.said_ok(r), format('got %s', r);
  po := r -> 'data' ->> 'po_no';

  select status into st from ops_procure.purchase_orders where po_no = po;
  assert st = 'DRAFT', format('always a draft — creating cannot also send (D132), got %s', st);

  -- Two terms or none. A deposit with no balance term would leave the rest of
  -- the order owed against nothing.
  select count(*) into n from ops_procure.po_schedule s
    join ops_procure.purchase_orders p on p.id = s.po_id where p.po_no = po;
  assert n = 2, format('a 30%% deposit implies a 70%% balance, saw %s terms', n);

  r := ops_procure.request_po_approval(p_po_no => po);
  assert ops_core.said_ok(r), format('got %s', r);

  r := ops_procure.issue_po(po);
  assert r -> 'error' ->> 'code' = 'not_approved',
         format('asking is not being confirmed, got %s', r);
end $$;

set local request.jwt.claim.sub = 'eeeeeeee-0000-0000-0000-00000000ce00';
do $$
declare r jsonb; po text;
begin
  select po_no into po from ops_procure.purchase_orders order by created_at desc limit 1;
  -- Named, per `0033`: `p_approved` now sits between the order and the note.
  r := ops_procure.approve_po(p_po_no => po, p_note => 'Setuju.');
  assert ops_core.said_ok(r), format('got %s', r);
end $$;

set local request.jwt.claim.sub = 'eeeeeeee-0000-0000-0000-00000000a11d';
do $$
declare r jsonb; po text;
begin
  select po_no into po from ops_procure.purchase_orders order by created_at desc limit 1;
  r := ops_procure.issue_po(po);
  assert ops_core.said_ok(r), format('got %s', r);
end $$;

-- ── receiving ─────────────────────────────────────────────────────────────
do $$
declare r jsonb; pol uuid; att1 uuid; att2 uuid; rcv text; st text;
begin
  select l.id into pol from ops_procure.po_lines l
    join ops_procure.purchase_orders p on p.id = l.po_id
   order by p.created_at desc limit 1;

  insert into ops_core.attachments (storage_path, filename, uploaded_by)
  values ('r/foto.jpg','foto-barang.jpg','eeeeeeee-0000-0000-0000-00000000a11d')
  returning id into att1;
  insert into ops_core.attachments (storage_path, filename, uploaded_by)
  values ('r/tt.pdf','tanda-terima.pdf','eeeeeeee-0000-0000-0000-00000000a11d')
  returning id into att2;

  -- The photograph is the one thing whoever is standing there can always
  -- produce, so it is the one thing always required.
  r := ops_procure.create_receipt(4, 'GOOD', '[]'::jsonb, null, pol);
  assert r -> 'error' ->> 'code' = 'photo_required', format('got %s', r);

  r := ops_procure.create_receipt(4, 'GOOD',
        jsonb_build_array(jsonb_build_object('attachment_id', att1, 'kind','goods_photo')),
        null, pol);
  assert ops_core.said_ok(r), format('got %s', r);
  -- Arrived at night with no signed paper: recorded, and counting for nothing.
  assert r -> 'data' ->> 'status' = 'REPORTED',
         format('no tanda terima yet, so it is reported and not received, got %s', r);
  rcv := r -> 'data' ->> 'receipt_no';

  assert (select value_received from ops_procure.v_po_status
           where po_id = (select po_id from ops_procure.po_lines where id = pol)) = 0,
         'and a reported arrival is worth nothing until somebody signs for it (D131)';

  -- Morning. Procurement signs for it. Confirming is a person's act, not a
  -- document's — no tanda terima is required to do it (the assertion below,
  -- on the drawer, is the test that pins that down). `att2` stays available
  -- for the next report, which confirms with one in hand (0086).
  r := ops_procure.confirm_receipt(rcv);
  assert ops_core.said_ok(r), format('got %s', r);

  assert (select value_received from ops_procure.v_po_status
           where po_id = (select po_id from ops_procure.po_lines where id = pol)) = 10000000,
         'now it is value received';
end $$;

-- ── the drawer opens with one row ─────────────────────────────────────────
do $$
declare d record;
begin
  select * into d from ops_procure.v_po_detail order by created_at desc limit 1;

  assert d.status = 'ISSUED', format('got %s', d.status);
  assert d.contract_value = 10000000, format('got %s', d.contract_value);
  assert d.delivery_state = 'COMPLETE', format('everything ordered arrived, got %s', d.delivery_state);
  assert d.payment_state = 'UNPAID', format('and none of it is paid, got %s', d.payment_state);
  assert d.days_late is null, 'not late: expected in fourteen days and already here';
  assert jsonb_array_length(d.lines) = 1, format('got %s', d.lines);
  assert jsonb_array_length(d.terms) = 2, format('got %s', d.terms);
  assert jsonb_array_length(d.lines -> 0 -> 'receipts') = 1, 'the receipt is on the line';
  -- An id, not a boolean (D268): the chip is a way to the file, not a label
  -- about it.
  assert (d.lines -> 0 -> 'receipts' -> 0 ->> 'photo_attachment_id') is not null,
         'with a photo somebody can open';
  assert (d.lines -> 0 -> 'receipts' -> 0 ->> 'delivery_note_attachment_id') is null,
         'and no tanda terima — confirmed by a person, not by a document';

  -- Nothing paid, so the deposit is payable and the balance is blocked behind
  -- it. `payable_now` is the deposit alone.
  assert d.payable_now = 3000000, format('got %s', d.payable_now);
  assert jsonb_array_length(d.close_blockers) = 1,
         format('only the money is outstanding, got %s', d.close_blockers);
  assert d.close_blockers::text like '%has not been paid%', format('got %s', d.close_blockers);
end $$;

-- ── and the request reads as a document too ───────────────────────────────
do $$
declare d record;
begin
  select * into d from ops_procure.v_pr_document order by created_at desc limit 1;
  assert d.line_count = 3, format('three lines on it, got %s', d.line_count);
  assert d.requested_total = 1510000,
         format('1.200.000 + 250.000 + 60.000, got %s', d.requested_total);
  assert d.open_lines = 3, format('none of them finished, got %s', d.open_lines);
  assert d.project_code = '25099', format('got %s', d.project_code);
end $$;

rollback;
