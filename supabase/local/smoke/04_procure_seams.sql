-- procure seams — the write functions, and what each of them refuses.
--
-- The views in `03_procure.sql` prove the arithmetic. This proves the guards,
-- and it is the half that rots silently: a view that breaks returns a wrong
-- number somebody eventually notices, a guard that stops guarding returns the
-- right number to the wrong person and nothing looks unusual at all.
--
-- Refusals proved here:
--   * approve_line without approve_goods — 403 (D19, D24)
--   * approving a line with nothing behind it — 422 (D125)
--   * approving an approved line — 409, not an update (D28)
--   * removing a line money has reached — 409 (D29)
--   * issuing an order leadership never confirmed — 422 (D132)
--   * closing an order with money or goods outstanding — 422, naming which
--   * answering somebody else's approval card — 403 (D69)
--   * answering the same card twice — 409
--
-- And the contract that makes a double tap one decision: a repeat with the same
-- idempotency key returns the first answer, marked, and changes nothing.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('dddddddd-0000-0000-0000-00000000ce00','evin@talaliving.com','{"full_name":"Evin Jonathan"}'),
  ('dddddddd-0000-0000-0000-00000000f11a','rina@talaliving.com','{"full_name":"Rina Kartika"}'),
  ('dddddddd-0000-0000-0000-00000000a11d','andi@talaliving.com','{"full_name":"Andi Prasetyo"}');

insert into ops_core.user_authorities (user_id, authority) values
  ('dddddddd-0000-0000-0000-00000000ce00','approve_goods'),
  ('dddddddd-0000-0000-0000-00000000f11a','approve_funds'),
  ('dddddddd-0000-0000-0000-00000000f11a','post_ledger');
insert into ops_core.user_modules (user_id, module, level) values
  ('dddddddd-0000-0000-0000-00000000ce00','procurement','write'),
  ('dddddddd-0000-0000-0000-00000000f11a','procurement','write'),
  ('dddddddd-0000-0000-0000-00000000f11a','accounting','write'),
  ('dddddddd-0000-0000-0000-00000000a11d','procurement','admin');

insert into ops_procure.vendors (id, code, name, is_curated) values
  ('11110000-0000-0000-0000-0000000000a1','V-8001','TOKO LAMA', true),
  ('11110000-0000-0000-0000-0000000000a2','V-8002','TOKO LAMA (2)', false);
insert into ops_procure.items (id, code, name, category_code, base_uom) values
  ('22220000-0000-0000-0000-0000000000a1','I-8001','Sekrup 5cm','hardware','box');
insert into ops_core.attachments (id, url, filename, uploaded_by) values
  ('44440000-0000-0000-0000-0000000000a1','https://toko.example/sekrup','tokopedia-sekrup',
   'dddddddd-0000-0000-0000-00000000a11d');

insert into ops_procure.pr_documents (id, doc_no, status, requested_by) values
  ('55550000-0000-0000-0000-0000000000a1','pr-26-09-12_01','DRAFT','dddddddd-0000-0000-0000-00000000a11d'),
  ('55550000-0000-0000-0000-0000000000a2','pr-26-09-12_02','DRAFT','dddddddd-0000-0000-0000-00000000a11d');

insert into ops_procure.pr_lines (id, doc_id, doc_no, line_no, item_id, description, qty, uom, unit_price, item_total, vendor_id) values
  -- L01 has a shop link behind it. L02 has nothing.
  ('66660000-0000-0000-0000-0000000000a1','55550000-0000-0000-0000-0000000000a1','pr-26-09-12_01',1,
   '22220000-0000-0000-0000-0000000000a1','Sekrup 5cm — with a link',2,'box',150000,300000,'11110000-0000-0000-0000-0000000000a1'),
  ('66660000-0000-0000-0000-0000000000a2','55550000-0000-0000-0000-0000000000a1','pr-26-09-12_01',2,
   '22220000-0000-0000-0000-0000000000a1','Sekrup 5cm — nothing behind it',2,'box',150000,300000,'11110000-0000-0000-0000-0000000000a1');

insert into ops_core.attachment_links (attachment_id, entity, entity_no, kind, linked_by) values
  ('44440000-0000-0000-0000-0000000000a1','pr_line','pr-26-09-12_01-L01','quotation',
   'dddddddd-0000-0000-0000-00000000a11d');

set local role authenticated;

/* ── submitting ────────────────────────────────────────────────────────── */
set local request.jwt.claim.sub = 'dddddddd-0000-0000-0000-00000000a11d';

do $$
declare r jsonb;
begin
  -- An empty request on the board is a row somebody has to open to discover
  -- there is nothing in it.
  r := ops_procure.submit_pr('pr-26-09-12_02');
  assert r ->> 'outcome' = 'refused', format('an empty request must not submit, got %s', r);
  assert r -> 'error' ->> 'code' = 'no_lines', format('got %s', r);

  r := ops_procure.submit_pr('pr-26-09-12_01');
  assert ops_core.said_ok(r), format('a request with lines submits, got %s', r);

  r := ops_procure.submit_pr('pr-26-09-12_01');
  assert r ->> 'outcome' = 'duplicate', format('submitting twice is 409, got %s', r);
end $$;

/* ── REFUSAL: approving is not a module level (D19, D24) ───────────────── */
-- Andi holds `procurement.admin`, the highest grant the module has.
do $$
declare r jsonb; n int;
begin
  r := ops_procure.approve_line('pr-26-09-12_01-L01', true);
  assert r ->> 'outcome' = 'refused',
         format('procurement.admin must not approve goods, got %s', r);
  assert r -> 'error' ->> 'code' = 'authority_required', format('got %s', r);
  assert (r -> 'error' ->> 'status')::int = 403, format('403, got %s', r);

  select count(*) into n from ops_procure.pr_approvals where line_id = '66660000-0000-0000-0000-0000000000a1';
  assert n = 0, 'and nothing was written';

  -- Andi cannot read the trail either: `ops_core.audit_log` is `it.read` (0003).
  -- The refusal is checked below, as the owner — reading it from here would
  -- have been a test that passed only because the reader was over-privileged.
end $$;

set local role postgres;
do $$
declare n int;
begin
  -- A7: a refusal is recorded, not silent. This is the assertion that catches a
  -- seam rewritten to `raise` instead of returning — the exception would roll
  -- its own audit row back, and the trail would go quiet exactly where somebody
  -- was being told no.
  select count(*) into n from ops_core.audit_log
   where entity_no = 'pr-26-09-12_01-L01' and action = 'approve' and outcome = 'refused';
  assert n = 1, format('the refusal belongs in the trail, saw %s rows', n);
end $$;
set local role authenticated;

/* ── the CEO, and what he is still refused ─────────────────────────────── */
set local request.jwt.claim.sub = 'dddddddd-0000-0000-0000-00000000ce00';

do $$
declare r jsonb;
begin
  -- 422, not 403. Nothing stands behind this number: no link, no invoice, no
  -- order. The owner's rule, and it is refused rather than warned about because
  -- the fix takes ten seconds on the line itself (D125).
  r := ops_procure.approve_line('pr-26-09-12_01-L02', true);
  assert r ->> 'outcome' = 'refused', format('a bare number must not be approvable, got %s', r);
  assert r -> 'error' ->> 'code' = 'support_required', format('got %s', r);
  assert (r -> 'error' ->> 'status')::int = 422, format('422, got %s', r);

  -- L01 has a shop link on it, which is exactly what the rule asks for.
  r := ops_procure.approve_line('pr-26-09-12_01-L01', true, null, 300000,
                            'Nego dulu sebelum bayar.', null);
  assert ops_core.said_ok(r), format('a supported line approves, got %s', r);

  -- Append-only: a second yes is 409, never an update (D28).
  r := ops_procure.approve_line('pr-26-09-12_01-L01', true);
  assert r ->> 'outcome' = 'duplicate', format('a second yes is 409, got %s', r);
  assert r -> 'error' ->> 'code' = 'already_decided', format('got %s', r);
end $$;

do $$
declare s text; instr text;
begin
  select status, note_instructions into s, instr
    from ops_procure.v_pr_line where line_no_full = 'pr-26-09-12_01-L01';
  assert s = 'APPROVED', format('approved and unpaid, got %s', s);
  assert instr = 'Nego dulu sebelum bayar.',
         format('leadership''s words land as a note row, got %s', instr);
end $$;

-- Three things in one transaction — the business rows, one audit row, one
-- outbox row — and all three or none. The outbox is the third-party seam
-- (ADR-008): nothing calls an external service inside a business transaction,
-- so a notification that has to go out is a row here rather than an HTTP call
-- holding a lock open.
set local role postgres;
do $$
declare n int;
begin
  select count(*) into n from ops_core.outbox
   where event_type = 'procurement.line.approved' and entity_no = 'pr-26-09-12_01-L01';
  assert n = 1, format('one outbox row per decision, saw %s', n);

  select count(*) into n from ops_core.audit_log
   where entity_no = 'pr-26-09-12_01-L01' and action = 'approve' and outcome = 'ok';
  assert n = 1, format('and one audit row, saw %s', n);
end $$;
set local role authenticated;
set local request.jwt.claim.sub = 'dddddddd-0000-0000-0000-00000000ce00';

/* ── idempotency: a double tap is one decision ─────────────────────────── */
-- L02 gets a yes on the record without one, which is not a contrivance: it is
-- what a line looks like after somebody unlinks the document it was approved
-- against. Withdrawing that yes must stay possible — a line whose paperwork is
-- a mess is exactly the line somebody needs to un-approve.
insert into ops_procure.pr_approvals (line_id, step, approved, approved_amount, recorded_by, recorded_by_email)
values ('66660000-0000-0000-0000-0000000000a2','GOODS',true,300000,
        'dddddddd-0000-0000-0000-00000000ce00','evin@talaliving.com');

do $$
declare a jsonb; b jsonb; n int;
begin
  a := ops_procure.approve_line('pr-26-09-12_01-L02', false, null, null, null, null, 'web', 'tap-0001');
  assert ops_core.said_ok(a), format('un-approving is never blocked for want of a document, got %s', a);

  -- The same key again — the phone was slow and the button was pressed twice.
  b := ops_procure.approve_line('pr-26-09-12_01-L02', false, null, null, null, null, 'web', 'tap-0001');
  assert b ->> 'outcome' = 'duplicate', format('a repeat is marked, got %s', b);
  assert (b ->> 'status')::int = 200, format('and it is not an error, got %s', b);
  assert b -> 'data' = a -> 'data', 'a replay returns the first answer, unchanged';

  -- Two rows: the yes that was already there, and the one no. Not three.
  select count(*) into n from ops_procure.pr_approvals where line_id = '66660000-0000-0000-0000-0000000000a2';
  assert n = 2, format('and writes nothing the second time — saw %s approval rows', n);
end $$;

-- A refused call does NOT hold its claim: the caller is expected to fix the
-- value and try again with the same key. Storing the 422 would make a corrected
-- resubmission return the old complaint for ever.
do $$
declare a jsonb;
begin
  a := ops_procure.approve_line('pr-26-09-12_01-L02', true, null, null, null, null, 'web', 'tap-0002');
  assert a -> 'error' ->> 'code' = 'support_required', format('got %s', a);
end $$;

-- Read as the owner: `ops_core.idempotency_keys` has RLS on and **no policy at
-- all**, because a client that could read it could read other people's
-- responses, and one that could write it could make a seam return an answer it
-- never gave. Only the seams touch it, and they run as definer.
set local role postgres;
do $$
declare n int;
begin
  select count(*) into n from ops_core.idempotency_keys where key = 'tap-0002';
  assert n = 0, '422 releases the claim — a corrected retry must be able to reuse the key';

  select count(*) into n from ops_core.idempotency_keys where key = 'tap-0001';
  assert n = 1, 'and a successful call keeps it';
end $$;
set local role authenticated;
set local request.jwt.claim.sub = 'dddddddd-0000-0000-0000-00000000ce00';

/* ── REFUSAL: money has reached it (D29) ───────────────────────────────── */
set local role postgres;
insert into ops_acct.transactions (id, trx_no, trx_date, account_id, direction, amount_idr, type_code, description, source_ref, posted_by) values
  ('77770000-0000-0000-0000-0000000000a1','trx-26-09-12_001', current_date,
   (select id from ops_acct.accounts where code='BCA 271'),'OUT',300000,'SUPPLIERS','bayar sekrup','ref-a1',
   'dddddddd-0000-0000-0000-00000000f11a');
insert into ops_acct.payment_allocations (trx_id, pr_line_no, amount, allocated_by) values
  ('77770000-0000-0000-0000-0000000000a1','pr-26-09-12_01-L01',300000,'dddddddd-0000-0000-0000-00000000f11a');
set local role authenticated;
set local request.jwt.claim.sub = 'dddddddd-0000-0000-0000-00000000a11d';

do $$
declare r jsonb; removed timestamptz;
begin
  r := ops_procure.remove_line('pr-26-09-12_01-L01');
  assert r ->> 'outcome' = 'duplicate',
         format('a line money has reached cannot be removed, got %s', r);
  assert r -> 'error' ->> 'code' = 'money_has_reached_it', format('got %s', r);

  select removed_at into removed from ops_procure.pr_lines where line_no_full = 'pr-26-09-12_01-L01';
  assert removed is null, 'and the line is still on the board';

  -- L02 has nothing against it and comes off cleanly. Soft, and audited.
  r := ops_procure.remove_line('pr-26-09-12_01-L02');
  assert ops_core.said_ok(r), format('an untouched line removes, got %s', r);

  select removed_at into removed from ops_procure.pr_lines where line_no_full = 'pr-26-09-12_01-L02';
  assert removed is not null, 'removal is a stamp, not a delete (A2)';

  -- Removing it again changed nothing, and says so rather than erroring.
  r := ops_procure.remove_line('pr-26-09-12_01-L02');
  assert r ->> 'outcome' = 'noop', format('a second removal is a no-op, got %s', r);
end $$;

/* ── REFUSAL: an order is confirmed before it is sent (D132) ───────────── */
set local role postgres;
insert into ops_procure.purchase_orders (id, po_no, vendor_id, status, created_by) values
  ('99990000-0000-0000-0000-0000000000a1','po-26-09-12_01','11110000-0000-0000-0000-0000000000a1',
   'DRAFT','dddddddd-0000-0000-0000-00000000a11d');
insert into ops_procure.po_lines (id, po_id, line_no, description, qty, uom, unit_price, line_total) values
  ('aaaa0000-0000-0000-0000-0000000000a1','99990000-0000-0000-0000-0000000000a1',1,
   'Kursi jati',4,'unit',2000000,8000000);
set local role authenticated;

do $$
declare r jsonb; st text;
begin
  r := ops_procure.issue_po('po-26-09-12_01');
  assert r ->> 'outcome' = 'refused',
         format('an unconfirmed order must not be sent to a vendor, got %s', r);
  assert r -> 'error' ->> 'code' = 'not_approved', format('got %s', r);

  select status into st from ops_procure.purchase_orders where po_no = 'po-26-09-12_01';
  assert st = 'DRAFT', 'and it is still a draft';

  -- Procurement cannot confirm it either. Confirming is the CEO's (D19).
  --
  -- **Named arguments, from here down.** `0033` added `p_approved` and
  -- `p_reason` to these seams, and a positional call is a call whose meaning
  -- changes when a parameter is inserted ahead of one it already passed. Here
  -- it failed loudly — a sentence where a boolean was expected — which was
  -- luck: insert a `text` parameter before `p_note` and both still type-check,
  -- and the note lands in the wrong column with nothing to notice it.
  r := ops_procure.approve_po(p_po_no => 'po-26-09-12_01');
  assert r ->> 'outcome' = 'refused', format('procurement must not confirm its own order, got %s', r);
end $$;

set local request.jwt.claim.sub = 'dddddddd-0000-0000-0000-00000000ce00';
do $$
declare r jsonb; st text; rev int; sent int;
begin
  r := ops_procure.approve_po(p_po_no => 'po-26-09-12_01', p_note => 'Setuju, kirim.');
  assert ops_core.said_ok(r), format('the CEO confirms it, got %s', r);

  r := ops_procure.issue_po('po-26-09-12_01');
  assert ops_core.said_ok(r), format('and then it can be sent, got %s', r);

  select status, revision, sent_revision into st, rev, sent
    from ops_procure.purchase_orders where po_no = 'po-26-09-12_01';
  assert st = 'ISSUED', format('got %s', st);
  assert rev = sent, 'the vendor holds the revision we just sent';
end $$;

-- An amendment after issue is a revision, not an edit. The old row stays and
-- the number moves, so the two pieces of paper can be told apart (D135).
do $$
declare r jsonb; rev int; sent int; n int; live numeric;
begin
  r := ops_procure.amend_po_line(p_po_no => 'po-26-09-12_01', p_line_no => 1,
                                 p_reason => 'Vendor hanya sanggup enam batang.',
                                 p_qty => 6, p_unit_price => 2000000);
  assert ops_core.said_ok(r), format('amending an issued order, got %s', r);

  select revision, sent_revision into rev, sent
    from ops_procure.purchase_orders where po_no = 'po-26-09-12_01';
  assert rev = 2, format('the revision moves, got %s', rev);
  assert sent = 1, 'and the paper in the vendor''s hand is now out of date';

  select count(*) into n from ops_procure.po_lines where po_id = '99990000-0000-0000-0000-0000000000a1';
  assert n = 2, format('the old line stays, pointing forward — saw %s rows', n);

  select contract_value into live from ops_procure.v_po_status where po_no = 'po-26-09-12_01';
  assert live = 12000000, format('and only the live line counts, got %s', live);
end $$;

/* ── REFUSAL: closing says WHICH thing is outstanding ──────────────────── */
set local request.jwt.claim.sub = 'dddddddd-0000-0000-0000-00000000f11a';
do $$
declare r jsonb; b jsonb;
begin
  r := ops_procure.close_po(p_po_no => 'po-26-09-12_01');
  assert r ->> 'outcome' = 'refused', format('nothing has arrived or been paid, got %s', r);
  -- `close_refused` rather than `close_blocked`: the demo's code, because a
  -- screen must not be able to tell the two implementations apart (ADR-009).
  assert r -> 'error' ->> 'code' = 'close_refused', format('got %s', r);

  b := r -> 'error' -> 'detail' -> 'blockers';
  -- A refusal that only says no leaves somebody clicking it again next week.
  assert jsonb_array_length(b) = 2, format('two things are outstanding, got %s', b);
  assert b::text like '%has not been paid%', format('it names the money, got %s', b);
  assert b::text like '%arrived%', format('and the goods, got %s', b);
end $$;

/* ── REFUSAL: the card is addressed, not broadcast (D69) ───────────────── */
set local role postgres;
insert into ops_procure.approval_batches (id, batch_no, token, sent_to, sent_to_email, sent_by, sent_by_email) values
  ('bbbb0000-0000-0000-0000-0000000000a1','ask-26-09-12_01','batch-tok-1','Evin Jonathan',
   'evin@talaliving.com','dddddddd-0000-0000-0000-00000000a11d','andi@talaliving.com');
insert into ops_procure.pr_lines (id, doc_id, doc_no, line_no, description, item_total, vendor_id) values
  ('66660000-0000-0000-0000-0000000000a3','55550000-0000-0000-0000-0000000000a1','pr-26-09-12_01',3,
   'Lem putih 2 pail — laminating meja HOTEL UBUD',450000,'11110000-0000-0000-0000-0000000000a1');
insert into ops_procure.approval_requests (line_id, batch_id, token, sent_to, sent_to_email, sent_by, sent_by_email, meeting_note) values
  ('66660000-0000-0000-0000-0000000000a3','bbbb0000-0000-0000-0000-0000000000a1','tok-line-1',
   'Evin Jonathan','evin@talaliving.com','dddddddd-0000-0000-0000-00000000a11d','andi@talaliving.com',
   'Rapat: pakai supplier Denpasar kalau bisa.');
set local role authenticated;

-- `answer_request` is the chat worker's, not a browser's (0157). It trusts its
-- caller for the answerer's address, so the caller has to be one that verified
-- it. These assertions are about the ARGUMENT — whose name is on the card — so
-- they are made as the worker, which is who makes the call in production.
set local role service_role;

do $$
declare r jsonb;
begin
  -- Andi holds procurement.admin here. It does not make him the approver, and
  -- since 0157 it does not even let him ask — the address is an argument the
  -- worker supplies, and the worker is the only caller.
  r := ops_procure.answer_request('tok-line-1', true, 'andi@talaliving.com');
  assert r ->> 'outcome' = 'refused',
         format('somebody else''s answer on somebody else''s card is not an approval, got %s', r);
  assert r -> 'error' ->> 'code' = 'not_the_approver', format('got %s', r);

  -- The identity comes from the chat platform, not from auth.uid(). This call
  -- is made while Andi is the signed-in user and it approves as Evin, because
  -- the signed webhook said Evin answered — which is the whole reason the
  -- question left the room.
  r := ops_procure.answer_request('tok-line-1', true, 'evin@talaliving.com',
                              'Rapat: pakai supplier Denpasar kalau bisa.');
  assert ops_core.said_ok(r), format('the addressed approver answers, got %s', r);
  assert r -> 'data' ->> 'channel' = 'chat', format('and the channel is on the record, got %s', r);

  r := ops_procure.answer_request('tok-line-1', false, 'evin@talaliving.com');
  assert r ->> 'outcome' = 'duplicate', format('a second answer is 409, got %s', r);
end $$;

set local role authenticated;

do $$
declare who text; ch text; instr text;
begin
  select approval_by, approval_channel, note_instructions into who, ch, instr
    from ops_procure.v_pr_line where line_no_full = 'pr-26-09-12_01-L03';
  -- `chat · evin@talaliving.com` — what actually happened, not who was logged in.
  assert who = 'evin@talaliving.com', format('the record names the approver, got %s', who);
  assert ch = 'chat', format('and the door they came through, got %s', ch);
  assert instr = 'Rapat: pakai supplier Denpasar kalau bisa.',
         'sent back unchanged, the meeting''s words become the approver''s own (D127)';
end $$;

/* ── a merge is a pointer, never a delete (D33) ────────────────────────── */
set local request.jwt.claim.sub = 'dddddddd-0000-0000-0000-00000000a11d';
do $$
declare r jsonb; n int; ak text[]; ptr uuid;
begin
  r := ops_procure.merge_vendor('V-8002','V-8001');
  assert ops_core.said_ok(r), format('merging, got %s', r);

  select count(*) into n from ops_procure.vendors where code = 'V-8002';
  assert n = 1, 'the loser row stays, so a PO raised against it in March still resolves';

  select merged_into into ptr from ops_procure.vendors where code = 'V-8002';
  assert ptr is not null, 'it points at the survivor';

  select aka into ak from ops_procure.vendors where code = 'V-8001';
  assert 'TOKO LAMA (2)' = any(ak),
         format('and the absorbed spelling moves to the winner, got %s', ak);

  r := ops_procure.merge_vendor('V-8002','V-8001');
  assert r ->> 'outcome' = 'duplicate', format('merging twice is 409, got %s', r);
end $$;

rollback;
