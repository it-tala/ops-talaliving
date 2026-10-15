-- acct — the ledger row says who approved what it paid for, and which
-- project it was for (0280, L7; kajian §6.5).
--
-- The same shape as `15_acct_post_from_line`: a request, a send, a decision
-- through chat for less than was asked, and a payment against the line.
-- What is proved here is the hop the drawer never showed — that the
-- allocation carries the decision, by whom, when, through which door — and
-- that it is blank, not refused, for a reader who may not read approvals.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('bbbb0000-0000-0000-0000-00000000f280','rina@talaliving.com','{"full_name":"Rina Kartika"}'),
  ('bbbb0000-0000-0000-0000-00000000c280','evin@talaliving.com','{"full_name":"Evin Jonathan"}'),
  ('bbbb0000-0000-0000-0000-00000000a280','andi@talaliving.com','{"full_name":"Andi Prasetyo"}'),
  ('bbbb0000-0000-0000-0000-00000000d280','dewi@talaliving.com','{"full_name":"Dewi"}');

insert into ops_core.user_authorities (user_id, authority) values
  ('bbbb0000-0000-0000-0000-00000000f280','post_ledger'),
  ('bbbb0000-0000-0000-0000-00000000c280','approve_goods');
insert into ops_core.user_modules (user_id, module, level) values
  ('bbbb0000-0000-0000-0000-00000000f280','accounting','write'),
  ('bbbb0000-0000-0000-0000-00000000f280','procurement','write'),
  ('bbbb0000-0000-0000-0000-00000000c280','procurement','write'),
  ('bbbb0000-0000-0000-0000-00000000a280','procurement','admin'),
  -- Dewi reads the ledger and nothing of procurement: the reader the
  -- approval must stay blank for, not refused.
  ('bbbb0000-0000-0000-0000-00000000d280','accounting','read');

insert into ops_procure.vendors (id, code, name, is_curated) values
  ('bb110000-0000-0000-0000-000000000280','V-6280','CV SETUJU', true);
insert into ops_procure.projects (id, code, name) values
  ('bb440000-0000-0000-0000-000000000280','PRJ-6280','Rumah Pak Budi');
insert into ops_procure.items (id, code, name, category_code, base_uom) values
  ('bb220000-0000-0000-0000-000000000280','I-6280','Lem kuning','finishing','can');

insert into ops_core.attachments (id, url, filename, uploaded_by) values
  ('bb330000-0000-0000-0000-000000000281','https://drive.example/quote-280','penawaran.pdf',
   'bbbb0000-0000-0000-0000-00000000a280'),
  ('bb330000-0000-0000-0000-000000000282','https://drive.example/transfer-280','bukti-transfer.jpg',
   'bbbb0000-0000-0000-0000-00000000f280');

insert into ops_procure.pr_documents (id, doc_no, status, requested_by, project_id) values
  ('bb550000-0000-0000-0000-000000000280','pr-26-10-15_80','DRAFT',
   'bbbb0000-0000-0000-0000-00000000a280','bb440000-0000-0000-0000-000000000280');

insert into ops_procure.pr_lines
  (id, doc_id, doc_no, line_no, item_id, description, qty, uom, unit_price, item_total, vendor_id) values
  ('bb660000-0000-0000-0000-000000000280','bb550000-0000-0000-0000-000000000280','pr-26-10-15_80',1,
   'bb220000-0000-0000-0000-000000000280','Lem kuning 5kg',5,'can',250000,1250000,
   'bb110000-0000-0000-0000-000000000280');

insert into ops_core.attachment_links (attachment_id, entity, entity_no, kind, linked_by) values
  ('bb330000-0000-0000-0000-000000000281','pr_line','pr-26-10-15_80-L01','quotation',
   'bbbb0000-0000-0000-0000-00000000a280');

set local role authenticated;

/* ── ask, decide through chat, pay ─────────────────────────────────────── */

set local request.jwt.claim.sub = 'bbbb0000-0000-0000-0000-00000000a280';
do $$
declare r jsonb;
begin
  r := ops_procure.submit_pr('pr-26-10-15_80');
  assert ops_core.said_ok(r), format('got %s', r);
  r := ops_procure.request_approval(p_line_nos => array['pr-26-10-15_80-L01']);
  assert ops_core.said_ok(r), format('got %s', r);
end $$;

set local request.jwt.claim.sub = 'bbbb0000-0000-0000-0000-00000000c280';
do $$
declare r jsonb;
begin
  -- Said yes across the table, recorded as a chat answer, for less than asked.
  r := ops_procure.approve_line('pr-26-10-15_80-L01', true, null, 1200000, null, null, 'chat');
  assert ops_core.said_ok(r), format('got %s', r);
end $$;

set local request.jwt.claim.sub = 'bbbb0000-0000-0000-0000-00000000f280';
do $$
declare r jsonb;
begin
  r := ops_acct.post_from_line(
    p_line_no       => 'pr-26-10-15_80-L01',
    p_amount        => 1200000,
    p_account_code  => 'BCA 271',
    p_type_code     => 'SUPPLIERS',
    p_attachment_id => 'bb330000-0000-0000-0000-000000000282');
  assert ops_core.said_ok(r), format('got %s', r);
end $$;

/* ── the allocation carries the decision ───────────────────────────────── */

do $$
declare a record; d record;
begin
  select * into a from ops_acct.v_allocation where pr_line_no = 'pr-26-10-15_80-L01';
  assert found, 'the payment names the line';
  assert a.approved, format('and the line was approved, got %s', a.approved);
  assert a.approved_by = 'evin@talaliving.com', format('by Evin, got %s', a.approved_by);
  assert a.approval_channel = 'chat', format('through chat, got %s', a.approval_channel);
  assert a.approved_amount = 1200000, format('for 1.200.000, got %s', a.approved_amount);
  assert a.approved_at is not null, 'on a day';
  assert a.amount = 1200000, format('and paid 1.200.000, got %s', a.amount);

  -- The drawer reads one row: the project by name, and the approval on the
  -- allocation it relays.
  select * into d from ops_acct.v_transaction_detail where trx_no = a.trx_no;
  assert d.project_name = 'Rumah Pak Budi', format('the project by name, got %s', d.project_name);
  assert d.project_code = 'PRJ-6280', 'and still by code';
  assert d.allocations -> 0 ->> 'approved_by' = 'evin@talaliving.com',
    format('the allocation says who, got %s', d.allocations -> 0);
  assert d.allocations -> 0 ->> 'approval_channel' = 'chat', 'and how';
  assert (d.allocations -> 0 ->> 'approved_amount')::numeric = 1200000, 'and how much';
  assert d.allocations -> 0 ->> 'approved_at' is not null, 'and when';
end $$;

/* ── a re-decision moves it: the current word, not the first ───────────── */
-- Evin decides; Rina reads. Evin holds no accounting module, so the ledger
-- views are empty for him — the decision is his, the row is hers.

-- One transaction, one `now()`: every approval row here shares a timestamp,
-- and `v_line_approval` would then pick by id. Outside a smoke file the rows
-- are minutes apart; here the earlier ones are pushed back an hour so the
-- order is the one the trail would really have.
reset role;
update ops_procure.pr_approvals set recorded_at = recorded_at - interval '1 hour'
 where line_id = 'bb660000-0000-0000-0000-000000000280';
set local role authenticated;

set local request.jwt.claim.sub = 'bbbb0000-0000-0000-0000-00000000c280';
do $$
declare r jsonb;
begin
  -- Un-ticked: the trail keeps every row (D28); the allocation shows the last.
  r := ops_procure.approve_line('pr-26-10-15_80-L01', false, null, null, null, 'hold it', 'web');
  assert ops_core.said_ok(r), format('got %s', r);
end $$;

set local request.jwt.claim.sub = 'bbbb0000-0000-0000-0000-00000000f280';
do $$
declare a record;
begin
  select * into a from ops_acct.v_allocation where pr_line_no = 'pr-26-10-15_80-L01';
  assert found, 'the allocation is still there';
  assert a.approved = false, format('the payment now stands against a refused line, got %s', a.approved);
end $$;

reset role;
update ops_procure.pr_approvals set recorded_at = recorded_at - interval '1 hour'
 where line_id = 'bb660000-0000-0000-0000-000000000280';
set local role authenticated;

set local request.jwt.claim.sub = 'bbbb0000-0000-0000-0000-00000000c280';
do $$
declare r jsonb;
begin
  r := ops_procure.approve_line('pr-26-10-15_80-L01', true, null, 1250000, null, 'the full amount after all', 'web');
  assert ops_core.said_ok(r), format('got %s', r);
end $$;

set local request.jwt.claim.sub = 'bbbb0000-0000-0000-0000-00000000f280';
do $$
declare a record;
begin
  select * into a from ops_acct.v_allocation where pr_line_no = 'pr-26-10-15_80-L01';
  assert a.approved, 'approved again';
  assert a.approved_amount = 1250000, format('the latest decision, got %s', a.approved_amount);
  assert a.approval_channel = 'web', format('and its door, got %s', a.approval_channel);
end $$;

/* ── a reader without the approval trail sees the row, not the approval ── */

set local request.jwt.claim.sub = 'bbbb0000-0000-0000-0000-00000000d280';
do $$
declare a record; d record;
begin
  select * into a from ops_acct.v_allocation where pr_line_no = 'pr-26-10-15_80-L01';
  assert found, 'the allocation is still a ledger fact';
  assert a.approved_by is null, format('but who approved is procurement''s to show, got %s', a.approved_by);
  assert a.line_description is null, 'the same way the line''s words already are';
  select * into d from ops_acct.v_transaction_detail where trx_no = a.trx_no;
  assert d.project_name = 'Rumah Pak Budi', 'the project is not behind that door';
end $$;

rollback;
