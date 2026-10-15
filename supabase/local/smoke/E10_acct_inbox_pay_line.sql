-- acct — the sixth road: a document from Chat pays an approved request line
-- (0281, L6; kajian §6.4).
--
-- `15_acct_post_from_line`'s request, send and decision, then a transfer
-- proof arrives in the inbox naming the line in its message. What is proved:
--   * the candidates are ranked — the named line first, then the vendor's
--     lines, and a reading with no vendor still gets a list
--   * one call pays the line, files the proof, and closes the inbox row with
--     `produced_pr_line_no`; the ledger row carries vendor, project and the
--     allocation without anybody retyping them
--   * a second confirmation is refused, and a person holding one of the two
--     authorities is refused before anything is read

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('bbbb0000-0000-0000-0000-00000000f281','rina@talaliving.com','{"full_name":"Rina Kartika"}'),
  ('bbbb0000-0000-0000-0000-00000000c281','evin@talaliving.com','{"full_name":"Evin Jonathan"}'),
  ('bbbb0000-0000-0000-0000-00000000a281','andi@talaliving.com','{"full_name":"Andi Prasetyo"}'),
  ('bbbb0000-0000-0000-0000-00000000e281','half@talaliving.com','{"full_name":"Half Way"}');

insert into ops_core.user_authorities (user_id, authority) values
  ('bbbb0000-0000-0000-0000-00000000f281','post_ledger'),
  ('bbbb0000-0000-0000-0000-00000000f281','resolve_inbox'),
  ('bbbb0000-0000-0000-0000-00000000c281','approve_goods'),
  -- Holds one of the two. The seam does both things, so it must refuse.
  ('bbbb0000-0000-0000-0000-00000000e281','post_ledger');
insert into ops_core.user_modules (user_id, module, level) values
  ('bbbb0000-0000-0000-0000-00000000f281','accounting','write'),
  ('bbbb0000-0000-0000-0000-00000000f281','procurement','write'),
  ('bbbb0000-0000-0000-0000-00000000c281','procurement','write'),
  ('bbbb0000-0000-0000-0000-00000000a281','procurement','admin'),
  ('bbbb0000-0000-0000-0000-00000000e281','accounting','write');

insert into ops_procure.vendors (id, code, name, is_curated) values
  ('bb110000-0000-0000-0000-000000000281','V-6281','CV BAYAR LAGI', true),
  ('bb110000-0000-0000-0000-000000000282','V-6282','TOKO LAIN', true);
insert into ops_procure.projects (id, code, name) values
  ('bb440000-0000-0000-0000-000000000281','PRJ-6281','Uji jalan keenam');
insert into ops_procure.items (id, code, name, category_code, base_uom) values
  ('bb220000-0000-0000-0000-000000000281','I-6281','Lem merah','finishing','can');

insert into ops_core.attachments (id, url, filename, uploaded_by) values
  ('bb330000-0000-0000-0000-000000000283','https://drive.example/quote-281','penawaran.pdf',
   'bbbb0000-0000-0000-0000-00000000a281');
-- Two proofs from Chat: one names the line in its message, one only the vendor.
insert into ops_core.attachments (id, storage_path, filename, source, uploaded_by) values
  ('bb330000-0000-0000-0000-000000000284','drive-281-a','bukti-transfer-a.jpg','chat',
   'bbbb0000-0000-0000-0000-00000000f281'),
  ('bb330000-0000-0000-0000-000000000285','drive-281-b','bukti-transfer-b.jpg','chat',
   'bbbb0000-0000-0000-0000-00000000f281');
insert into ops_acct.evidence_inbox (ref_id, origin, status, attachment_id, reported_by, extracted) values
  ('inb-281-a','chat','PENDING','bb330000-0000-0000-0000-000000000284','bbbb0000-0000-0000-0000-00000000f281',
   '{"doc_type":"Payment Proof","vendor_name":"TOKO LAIN","amount_idr":900000,"note":"transfer lem PR-26-10-15_81-l01"}'::jsonb),
  ('inb-281-b','chat','PENDING','bb330000-0000-0000-0000-000000000285','bbbb0000-0000-0000-0000-00000000f281',
   '{"doc_type":"Payment Proof","vendor_name":"cv bayar lagi","amount_idr":160000}'::jsonb);

insert into ops_procure.pr_documents (id, doc_no, status, requested_by, project_id) values
  ('bb550000-0000-0000-0000-000000000281','pr-26-10-15_81','DRAFT',
   'bbbb0000-0000-0000-0000-00000000a281','bb440000-0000-0000-0000-000000000281');
insert into ops_procure.pr_lines
  (id, doc_id, doc_no, line_no, item_id, description, qty, uom, unit_price, item_total, vendor_id) values
  ('bb660000-0000-0000-0000-000000000281','bb550000-0000-0000-0000-000000000281','pr-26-10-15_81',1,
   'bb220000-0000-0000-0000-000000000281','Lem merah 5kg',4,'can',250000,1000000,
   'bb110000-0000-0000-0000-000000000281'),
  ('bb660000-0000-0000-0000-000000000282','bb550000-0000-0000-0000-000000000281','pr-26-10-15_81',2,
   'bb220000-0000-0000-0000-000000000281','Lem merah 1kg',2,'can',80000,160000,
   'bb110000-0000-0000-0000-000000000281'),
  -- A line nobody has approved: never a candidate.
  ('bb660000-0000-0000-0000-000000000283','bb550000-0000-0000-0000-000000000281','pr-26-10-15_81',3,
   'bb220000-0000-0000-0000-000000000281','Lem merah 20kg',1,'can',700000,700000,
   'bb110000-0000-0000-0000-000000000282');
insert into ops_core.attachment_links (attachment_id, entity, entity_no, kind, linked_by) values
  ('bb330000-0000-0000-0000-000000000283','pr_line','pr-26-10-15_81-L01','quotation','bbbb0000-0000-0000-0000-00000000a281'),
  ('bb330000-0000-0000-0000-000000000283','pr_line','pr-26-10-15_81-L02','quotation','bbbb0000-0000-0000-0000-00000000a281');

set local role authenticated;

set local request.jwt.claim.sub = 'bbbb0000-0000-0000-0000-00000000a281';
do $$
declare r jsonb;
begin
  r := ops_procure.submit_pr('pr-26-10-15_81');
  assert ops_core.said_ok(r), format('got %s', r);
  r := ops_procure.request_approval(p_line_nos => array['pr-26-10-15_81-L01','pr-26-10-15_81-L02']);
  assert ops_core.said_ok(r), format('got %s', r);
end $$;

set local request.jwt.claim.sub = 'bbbb0000-0000-0000-0000-00000000c281';
do $$
declare r jsonb;
begin
  r := ops_procure.approve_line('pr-26-10-15_81-L01', true, null, 900000, null, null, 'chat');
  assert ops_core.said_ok(r), format('got %s', r);
  r := ops_procure.approve_line('pr-26-10-15_81-L02', true, null, null, null, null, 'chat');
  assert ops_core.said_ok(r), format('got %s', r);
end $$;

/* ── REFUSAL: one of the two authorities is not enough ─────────────────── */

set local request.jwt.claim.sub = 'bbbb0000-0000-0000-0000-00000000e281';
do $$
declare r jsonb;
begin
  r := ops_acct.inbox_line_candidates('inb-281-a');
  assert r ->> 'outcome' = 'refused', format('reading candidates needs resolve_inbox, got %s', r);
  r := ops_acct.book_evidence_to_line('inb-281-a','pr-26-10-15_81-L01','BCA 271', 900000);
  assert r ->> 'outcome' = 'refused' and r -> 'error' ->> 'code' = 'authority_required', format('got %s', r);
  assert r -> 'error' -> 'detail' ->> 'required' = 'resolve_inbox', format('and names the missing one, got %s', r -> 'error');
end $$;

/* ── the candidates, ranked ────────────────────────────────────────────── */

set local request.jwt.claim.sub = 'bbbb0000-0000-0000-0000-00000000f281';
do $$
declare r jsonb; c jsonb;
begin
  -- Message names L01 (in the wrong case), the reading says another vendor:
  -- the named line is first anyway, and the vendor's lines are not offered
  -- because the reading's vendor matched a line of its own (L03 — unapproved,
  -- so it is not there either).
  r := ops_acct.inbox_line_candidates('inb-281-a');
  assert ops_core.said_ok(r), format('got %s', r);
  assert r -> 'data' ->> 'caption_line' = 'pr-26-10-15_81-L01',
    format('the message names the line, case fixed, got %s', r -> 'data' ->> 'caption_line');
  c := r -> 'data' -> 'candidates';
  assert c -> 0 ->> 'line_no' = 'pr-26-10-15_81-L01', format('the named line is first, got %s', c);
  assert (c -> 0 ->> 'caption_match')::boolean, 'and says why';
  assert (c -> 0 ->> 'remaining')::numeric = 900000, format('owed what was approved, got %s', c -> 0);
  assert (c -> 0 ->> 'amount_match')::boolean, 'the amount read matches what is owed';
  assert c -> 0 ->> 'approved_by' = 'evin@talaliving.com' and c -> 0 ->> 'approval_channel' = 'chat',
    format('with the decision beside it, got %s', c -> 0);
  assert c -> 0 ->> 'project_name' = 'Uji jalan keenam', 'and the project';
  assert not exists (select 1 from jsonb_array_elements(c) x where x ->> 'line_no' = 'pr-26-10-15_81-L03'),
    format('an unapproved line is never offered, got %s', c);

  -- No line named; the vendor read (in lower case) matches both approved
  -- lines; the amount read picks L02 to the top.
  r := ops_acct.inbox_line_candidates('inb-281-b');
  assert ops_core.said_ok(r), format('got %s', r);
  assert r -> 'data' ->> 'caption_line' is null, 'nothing named';
  c := r -> 'data' -> 'candidates';
  assert jsonb_array_length(c) = 2, format('the vendor''s two approved lines, got %s', c);
  assert c -> 0 ->> 'line_no' = 'pr-26-10-15_81-L02', format('the one the amount fits first, got %s', c);
  assert (c -> 0 ->> 'vendor_match')::boolean and (c -> 0 ->> 'amount_match')::boolean, 'both reasons shown';
  assert (c -> 1 ->> 'vendor_match')::boolean and not (c -> 1 ->> 'amount_match')::boolean, 'the other by vendor only';
end $$;

/* ── paying the line with the document ─────────────────────────────────── */

do $$
declare r jsonb; i record; t record; a record; n int;
begin
  r := ops_acct.book_evidence_to_line('inb-281-a','pr-26-10-15_81-L01','BCA 271', 900000, '2026-10-15', null, null, 'k-281-a');
  assert ops_core.said_ok(r), format('got %s', r);
  assert r -> 'data' ->> 'pr_line_no' = 'pr-26-10-15_81-L01', format('names the line, got %s', r -> 'data');

  select * into i from ops_acct.evidence_inbox where ref_id = 'inb-281-a';
  assert i.status = 'CONFIRMED', format('the inbox row is closed, got %s', i.status);
  assert i.produced_trx_no = r -> 'data' ->> 'trx_no', 'pointing at the row it made';
  assert i.produced_pr_line_no = 'pr-26-10-15_81-L01', format('and the line it paid, got %s', i.produced_pr_line_no);
  assert i.resolved_by = 'bbbb0000-0000-0000-0000-00000000f281', 'signed';

  -- The ledger row carries what the line knew (D86) and the proof it came with.
  select * into t from ops_acct.v_transaction_detail where trx_no = i.produced_trx_no;
  assert t.vendor_name = 'CV BAYAR LAGI', format('vendor from the line, got %s', t.vendor_name);
  assert t.project_code = 'PRJ-6281', format('project from the request, got %s', t.project_code);
  assert t.amount_idr = 900000 and t.direction = 'OUT', 'the money as paid';
  assert t.evidence_count = 1 and t.has_payment_proof, format('the proof is a transfer proof, got %s', t.documents);
  assert t.allocations -> 0 ->> 'pr_line_no' = 'pr-26-10-15_81-L01', 'allocated to the line';
  assert t.allocations -> 0 ->> 'approved_by' = 'evin@talaliving.com', 'with the decision (0280)';
  assert jsonb_array_length(t.lines) = 1 and t.lines -> 0 ->> 'item_id' = 'bb220000-0000-0000-0000-000000000281',
    format('one item line from the request, got %s', t.lines);

  -- The line is settled, so it is no longer a candidate for anything.
  select * into a from ops_procure.v_line_coverage where line_no_full = 'pr-26-10-15_81-L01';
  assert a.remaining = 0 and a.settled, format('the line is paid, got %s / %s', a.remaining, a.settled);
  r := ops_acct.inbox_line_candidates('inb-281-b');
  select count(*) into n from jsonb_array_elements(r -> 'data' -> 'candidates') x where x ->> 'line_no' = 'pr-26-10-15_81-L01';
  assert n = 0, format('a settled line is not offered again, got %s', r -> 'data' -> 'candidates');
end $$;

/* ── REFUSAL: the same document twice ──────────────────────────────────── */

do $$
declare r jsonb; n int;
begin
  -- The same key replays the same answer; a fresh call meets the inbox.
  r := ops_acct.book_evidence_to_line('inb-281-a','pr-26-10-15_81-L01','BCA 271', 900000, '2026-10-15', null, null, 'k-281-a');
  assert r ->> 'outcome' = 'duplicate' and r -> 'data' ->> 'pr_line_no' = 'pr-26-10-15_81-L01',
    format('a replay answers what it answered, marked as such, got %s', r);
  r := ops_acct.book_evidence_to_line('inb-281-a','pr-26-10-15_81-L02','BCA 271', 160000);
  assert r -> 'error' ->> 'code' = 'already_resolved', format('a closed document pays nothing twice, got %s', r);
  select count(*) into n from ops_acct.transactions;
  assert n = 1, format('and no second row, saw %s', n);

  -- A line the seam does not know: post_from_line's refusal, relayed whole,
  -- and the inbox row untouched.
  r := ops_acct.book_evidence_to_line('inb-281-b','pr-26-10-15_81-L99','BCA 271', 160000);
  assert r -> 'error' ->> 'code' = 'pr_line_not_found', format('got %s', r);
  select count(*) into n from ops_acct.evidence_inbox where ref_id = 'inb-281-b' and status = 'PENDING';
  assert n = 1, 'a refused booking moves nothing';
end $$;

rollback;
