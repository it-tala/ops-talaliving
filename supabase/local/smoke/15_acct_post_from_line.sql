-- acct — paying a request line, and the send that asked for it.
--
-- `post_from_line` is the function `/procurement/pr` and `/procurement/meeting`
-- were both dark for, and it did not exist: paying an approved request was a
-- thing the database could not do at all. It composes `post_transaction` and
-- `allocate_payment` rather than repeating either, so what is proved here is
-- the part only it can know — the line, and the refusals that need it.
--
-- Refusals:
--   * without `post_ledger` — 403, and the money does not move (D24)
--   * without proof — 422, naming the receipt (D85)
--   * against a removed line — 409
--   * the same line, amount and day twice — 409 from `source_ref`, which is
--     what protects two laptops where an idempotency key protects one tap
--
-- Derivations:
--   * the ledger row carries the vendor, the project and the itemisation, so
--     it reads without opening the PR (D86)
--   * the line's coverage moves by exactly what was paid
--   * `v_approval_batch` totals what was asked, said yes to, and what actually
--     has to leave the bank — which are three different numbers

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('bbbb0000-0000-0000-0000-00000000f11a','rina@talaliving.com','{"full_name":"Rina Kartika"}'),
  ('bbbb0000-0000-0000-0000-00000000ce00','evin@talaliving.com','{"full_name":"Evin Jonathan"}'),
  ('bbbb0000-0000-0000-0000-00000000a11d','andi@talaliving.com','{"full_name":"Andi Prasetyo"}');

insert into ops_core.user_authorities (user_id, authority) values
  ('bbbb0000-0000-0000-0000-00000000f11a','post_ledger'),
  ('bbbb0000-0000-0000-0000-00000000ce00','approve_goods');
insert into ops_core.user_modules (user_id, module, level) values
  ('bbbb0000-0000-0000-0000-00000000f11a','accounting','write'),
  ('bbbb0000-0000-0000-0000-00000000f11a','procurement','write'),
  ('bbbb0000-0000-0000-0000-00000000ce00','procurement','write'),
  ('bbbb0000-0000-0000-0000-00000000a11d','procurement','admin'),
  -- Andi may write requests and may not touch the ledger. That is the
  -- distinction the first refusal below exists for.
  ('bbbb0000-0000-0000-0000-00000000a11d','accounting','read');

insert into ops_procure.vendors (id, code, name, is_curated) values
  ('bb110000-0000-0000-0000-000000000001','V-6001','CV BAYAR', true);
insert into ops_procure.projects (id, code, name) values
  ('bb440000-0000-0000-0000-000000000001','PRJ-6001','Uji bayar');
insert into ops_procure.items (id, code, name, category_code, base_uom) values
  ('bb220000-0000-0000-0000-000000000001','I-6001','Lem putih','finishing','can');

insert into ops_core.attachments (id, url, filename, uploaded_by) values
  ('bb330000-0000-0000-0000-000000000001','https://drive.example/quote','penawaran.pdf',
   'bbbb0000-0000-0000-0000-00000000a11d'),
  ('bb330000-0000-0000-0000-000000000002','https://drive.example/transfer','bukti-transfer.jpg',
   'bbbb0000-0000-0000-0000-00000000f11a');

insert into ops_procure.pr_documents (id, doc_no, status, requested_by, project_id) values
  ('bb550000-0000-0000-0000-000000000001','pr-26-09-21_01','DRAFT',
   'bbbb0000-0000-0000-0000-00000000a11d','bb440000-0000-0000-0000-000000000001');

insert into ops_procure.pr_lines
  (id, doc_id, doc_no, line_no, item_id, description, qty, uom, unit_price, item_total, vendor_id) values
  ('bb660000-0000-0000-0000-000000000001','bb550000-0000-0000-0000-000000000001','pr-26-09-21_01',1,
   'bb220000-0000-0000-0000-000000000001','Lem putih 5kg',4,'can',250000,1000000,
   'bb110000-0000-0000-0000-000000000001'),
  ('bb660000-0000-0000-0000-000000000002','bb550000-0000-0000-0000-000000000001','pr-26-09-21_01',2,
   'bb220000-0000-0000-0000-000000000001','Lem putih 1kg',2,'can',80000,160000,
   'bb110000-0000-0000-0000-000000000001');

-- Something stands behind L01, so it can be asked about at all (D125).
insert into ops_core.attachment_links (attachment_id, entity, entity_no, kind, linked_by) values
  ('bb330000-0000-0000-0000-000000000001','pr_line','pr-26-09-21_01-L01','quotation',
   'bbbb0000-0000-0000-0000-00000000a11d');

set local role authenticated;

/* ── the send, and the three totals it reads back ──────────────────────── */

set local request.jwt.claim.sub = 'bbbb0000-0000-0000-0000-00000000a11d';
do $$
declare r jsonb;
begin
  r := ops_procure.submit_pr('pr-26-09-21_01');
  assert ops_core.said_ok(r), format('got %s', r);

  -- L02 has nothing behind it, so a send carrying it is refused whole. Sending
  -- a bare number to somebody's phone is worse than sending nothing: they
  -- cannot check it there (D125).
  r := ops_procure.request_approval(
    p_line_nos => array['pr-26-09-21_01-L01','pr-26-09-21_01-L02']);
  assert r ->> 'outcome' = 'refused', format('a bare line must not be askable, got %s', r);

  r := ops_procure.request_approval(p_line_nos => array['pr-26-09-21_01-L01']);
  assert ops_core.said_ok(r), format('the supported line sends, got %s', r);
end $$;

do $$
declare b record;
begin
  select * into b from ops_procure.v_approval_batch order by sent_at desc limit 1;

  assert jsonb_array_length(b.items) = 1, format('one item in the send, got %s', b.items);
  assert b.requested_total = 1000000, format('asked for, got %s', b.requested_total);
  -- Nobody has answered yet, so nothing is approved and nothing has to leave
  -- the bank. Three numbers, and at this moment two of them are zero.
  assert b.approved_total = 0, format('nothing decided yet, got %s', b.approved_total);
  assert b.to_pay_total = 0, format('and nothing to pay, got %s', b.to_pay_total);
  assert b.pending = 1 and b.answered = 0, 'one waiting';
  assert b.items -> 0 ->> 'line_no_full' = 'pr-26-09-21_01-L01', 'named';
  assert not (b.items -> 0 ->> 'line_decided')::boolean, 'and not yet decided';
end $$;

set local request.jwt.claim.sub = 'bbbb0000-0000-0000-0000-00000000ce00';
do $$
declare r jsonb;
begin
  -- Approved for less than was asked: the room settled on 900.000.
  r := ops_procure.approve_line('pr-26-09-21_01-L01', true, null, 900000, null, null);
  assert ops_core.said_ok(r), format('got %s', r);
end $$;

do $$
declare b record;
begin
  select * into b from ops_procure.v_approval_batch order by sent_at desc limit 1;
  assert b.requested_total = 1000000, 'what was asked does not move';
  assert b.approved_total = 900000, format('what was said yes to, got %s', b.approved_total);
  -- Nothing has been paid against it yet, so all of it still has to leave.
  assert b.to_pay_total = 900000, format('and all of it is still to pay, got %s', b.to_pay_total);
  assert (b.items -> 0 ->> 'line_decided')::boolean, 'the card is now stale';
end $$;

/* ── REFUSAL: procurement may not post to the ledger ───────────────────── */

set local request.jwt.claim.sub = 'bbbb0000-0000-0000-0000-00000000a11d';
do $$
declare r jsonb; n int;
begin
  r := ops_acct.post_from_line(
    p_line_no       => 'pr-26-09-21_01-L01',
    p_amount        => 900000,
    p_account_code  => 'BCA 271',
    p_type_code     => 'SUPPLIERS',
    p_attachment_id => 'bb330000-0000-0000-0000-000000000002');
  assert r ->> 'outcome' = 'refused', format('procurement must not post, got %s', r);
  assert r -> 'error' ->> 'code' = 'authority_required', format('got %s', r);

  select count(*) into n from ops_acct.transactions;
  assert n = 0, format('and nothing moved, saw %s rows', n);
end $$;

/* ── REFUSAL: no proof, no payment (D85) ───────────────────────────────── */

set local request.jwt.claim.sub = 'bbbb0000-0000-0000-0000-00000000f11a';
do $$
declare r jsonb;
begin
  r := ops_acct.post_from_line(
    p_line_no       => 'pr-26-09-21_01-L01',
    p_amount        => 900000,
    p_account_code  => 'BCA 271',
    p_type_code     => 'SUPPLIERS',
    p_attachment_id => null);
  assert r ->> 'outcome' = 'refused', format('a payment needs its proof, got %s', r);
  assert r -> 'error' ->> 'code' = 'evidence_required', format('got %s', r);
  -- The message names the thing the person is being asked for, not "documents".
  assert r -> 'error' ->> 'message' like '%transfer receipt%',
    format('and says which, got %s', r -> 'error' ->> 'message');
end $$;

/* ── the label is a kind, and so is the code ───────────────────────────── */
--
-- `post_transaction` used to compare `kind` against four **codes**, while every
-- screen passes the `DocKind` *label*. Against the real database that refused
-- every posting with `evidence_required` — a money path failing closed with the
-- nota attached. `ops_core.doc_kind_of` is now the one definition both seams
-- read, and this is the assertion that keeps it that way.
do $$
begin
  assert ops_core.doc_kind_of('Payment Proof') = 'transfer_proof',
    format('the label resolves, got %s', ops_core.doc_kind_of('Payment Proof'));
  assert ops_core.doc_kind_of('transfer_proof') = 'transfer_proof', 'and so does the code';
  assert ops_core.doc_kind_of('Bukti Transfer') is null, 'and nothing else does';
end $$;

do $$
declare r jsonb;
begin
  -- A kind nobody has heard of is named back, rather than becoming a cast
  -- error somewhere deeper.
  r := ops_acct.post_transaction(
    p_account_code => 'BCA 271', p_direction => 'OUT', p_amount => 1000,
    p_type_code => 'SUPPLIERS', p_description => 'uji',
    p_documents => '[{"attachment_id":"bb330000-0000-0000-0000-000000000002","kind":"Bukti Transfer"}]'::jsonb);
  assert r -> 'error' ->> 'code' = 'unknown_kind', format('got %s', r);
end $$;

/* ── the payment ───────────────────────────────────────────────────────── */

do $$
declare r jsonb; t record; v_trx text; n int;
begin
  r := ops_acct.post_from_line(
    p_line_no       => 'pr-26-09-21_01-L01',
    p_amount        => 900000,
    p_account_code  => 'BCA 271',
    p_type_code     => 'SUPPLIERS',
    p_attachment_id => 'bb330000-0000-0000-0000-000000000002',
    p_trx_date      => '2026-09-21');
  assert ops_core.said_ok(r), format('the payment posts, got %s', r);
  v_trx := r -> 'data' ->> 'trx_no';

  select * into t from ops_acct.transactions where trx_no = v_trx;
  assert t.direction = 'OUT', 'money out';
  assert t.amount_idr = 900000, format('got %s', t.amount_idr);
  -- Filled in from the line, which is the whole reason this seam exists rather
  -- than the screen calling `post_transaction` with what it happens to hold.
  assert t.vendor_id  = 'bb110000-0000-0000-0000-000000000001', 'the vendor came from the line';
  assert t.project_id = 'bb440000-0000-0000-0000-000000000001', 'and the project';
  assert t.description like '%pr-26-09-21_01-L01%',
    format('the ledger reads on its own (D86), got %s', t.description);

  -- Itemised, so the row can be read without opening the PR.
  select count(*) into n from ops_acct.transaction_lines where trx_id = t.id;
  assert n = 1, format('one line, got %s', n);

  -- And the proof is linked to the transaction, not left floating.
  select count(*) into n from ops_core.attachment_links
   where entity = 'transaction' and entity_no = v_trx;
  assert n = 1, format('the proof is on the row, saw %s', n);
end $$;

-- The two facts, separately recorded: the money left, and it was counted
-- against this line. They can come apart, so collapsing them into one row
-- would make the second unanswerable.
set local role postgres;
do $$
declare n int;
begin
  select count(*) into n from ops_core.audit_log
   where entity = 'transaction' and action in ('post','allocate','post_from_line');
  assert n >= 2, format('the posting and the allocation are both recorded, saw %s', n);
end $$;
set local role authenticated;

-- What the board now reads: approved 900.000, all of it paid, nothing left.
do $$
declare b record; cov record;
begin
  select * into b from ops_procure.v_approval_batch order by sent_at desc limit 1;
  assert b.approved_total = 900000, 'what was approved does not move when it is paid';
  assert b.to_pay_total = 0,
    format('and nothing is left to pay (D125), got %s', b.to_pay_total);

  select coverage_covered, coverage_remaining into cov
    from ops_procure.v_pr_line where line_no_full = 'pr-26-09-21_01-L01';
  assert cov.coverage_covered = 900000, format('the line is covered, got %s', cov.coverage_covered);
  assert cov.coverage_remaining = 0, format('and nothing remains, got %s', cov.coverage_remaining);
end $$;

/* ── REFUSAL: the same line, amount and day twice ──────────────────────── */

do $$
declare r jsonb;
begin
  -- No idempotency key at all, which is the case that matters: two people on
  -- two laptops. `source_ref` is what refuses it.
  r := ops_acct.post_from_line(
    p_line_no       => 'pr-26-09-21_01-L01',
    p_amount        => 900000,
    p_account_code  => 'BCA 271',
    p_type_code     => 'SUPPLIERS',
    p_attachment_id => 'bb330000-0000-0000-0000-000000000002',
    p_trx_date      => '2026-09-21');
  assert r ->> 'outcome' = 'duplicate',
    format('paying the same line twice on one day is a duplicate, got %s', r);
end $$;

/* ── REFUSAL: a removed line is not payable ────────────────────────────── */

set local role postgres;
update ops_procure.pr_lines
   set removed_at = now(), removed_by = 'bbbb0000-0000-0000-0000-00000000a11d'
 where id = 'bb660000-0000-0000-0000-000000000002';
set local role authenticated;

do $$
declare r jsonb;
begin
  r := ops_acct.post_from_line(
    p_line_no       => 'pr-26-09-21_01-L02',
    p_amount        => 160000,
    p_account_code  => 'BCA 271',
    p_type_code     => 'SUPPLIERS',
    p_attachment_id => 'bb330000-0000-0000-0000-000000000002');
  assert r ->> 'outcome' = 'duplicate', format('got %s', r);
  assert r -> 'error' ->> 'code' = 'line_removed', format('got %s', r);
end $$;

-- A line nobody has heard of is a 422 naming the field, not a 500.
do $$
declare r jsonb;
begin
  r := ops_acct.post_from_line(
    p_line_no       => 'pr-26-09-21_01-L99',
    p_amount        => 1000,
    p_account_code  => 'BCA 271',
    p_type_code     => 'SUPPLIERS',
    p_attachment_id => 'bb330000-0000-0000-0000-000000000002');
  assert r -> 'error' ->> 'code' = 'pr_line_not_found', format('got %s', r);
  assert (r -> 'error' ->> 'status')::int = 422, format('422, got %s', r);
end $$;

rollback;
