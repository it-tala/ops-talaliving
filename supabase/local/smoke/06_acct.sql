-- acct — the two money seams, and the seven ways they say no.
--
-- This is the schema where a missing guard costs cash rather than tidiness, so
-- the refusals outnumber the derivations:
--
--   post_ledger or 403, never accounting.create (D24)
--   no document, no row (D85)
--   a purchase with no detail — no qty, no price, no vendor (D86)
--   detail that does not add up to the total — the ledger will not guess (A9)
--   the same source_ref twice — one event, one row (A4)
--   a transaction funding more than it moved (A9)
--   a VOID row funding anything at all (A10)
--   a loose document rejected with no reason (D94)
--
-- And the derivations: the balance the database owns (D9), what a row still has
-- room to fund, and whether this kind of spending was expected to name a
-- decision at all (D83).

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-00000000f11a','rina@talaliving.com','{"full_name":"Rina Kartika"}'),
  ('ffffffff-0000-0000-0000-00000000c1e2','dewi@talaliving.com','{"full_name":"Dewi Lestari"}'),
  ('ffffffff-0000-0000-0000-00000000ce00','evin@talaliving.com','{"full_name":"Evin Jonathan"}');

-- Rina posts to the ledger. Dewi files documents all day and may not assert
-- that money moved — the distinction D24 exists for.
insert into ops_core.user_authorities (user_id, authority) values
  ('ffffffff-0000-0000-0000-00000000f11a','post_ledger'),
  ('ffffffff-0000-0000-0000-00000000f11a','resolve_inbox'),
  ('ffffffff-0000-0000-0000-00000000ce00','approve_funds');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-00000000f11a','accounting','write'),
  ('ffffffff-0000-0000-0000-00000000f11a','procurement','write'),
  ('ffffffff-0000-0000-0000-00000000c1e2','accounting','admin'),
  ('ffffffff-0000-0000-0000-00000000ce00','accounting','read');

insert into ops_procure.vendors (id, code, name, is_curated) values
  ('11110000-0000-0000-0000-0000000000b1','V-7001','CV UJI LEDGER', true);
insert into ops_procure.items (id, code, name, category_code, base_uom) values
  ('22220000-0000-0000-0000-0000000000b1','I-7001','Cat duco 5kg','finishing','kg');
insert into ops_core.attachments (id, storage_path, filename, uploaded_by) values
  ('44440000-0000-0000-0000-0000000000b1','a/nota.jpg','nota-cat.jpg','ffffffff-0000-0000-0000-00000000f11a'),
  ('44440000-0000-0000-0000-0000000000b2','a/sj.pdf','surat-jalan.pdf','ffffffff-0000-0000-0000-00000000f11a'),
  ('44440000-0000-0000-0000-0000000000b3','a/loose.jpg','foto-chat.jpg','ffffffff-0000-0000-0000-00000000f11a');

set local role authenticated;

/* ── REFUSAL: posting is an authority, not a module level (D24) ────────── */
-- Dewi holds `accounting.admin` — the highest grant the module has.
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-00000000c1e2';
do $$
declare r jsonb; n int;
begin
  assert ops_core.has_permission('accounting.create'), 'admin can create';
  assert not ops_core.has_authority('post_ledger'),
         'and still may not assert that money moved';

  r := ops_acct.post_transaction('BCA 271','OUT', 500000,'SUPPLIERS','bayar cat',
        jsonb_build_array(jsonb_build_object(
          'attachment_id','44440000-0000-0000-0000-0000000000b1','kind','nota')));
  assert r ->> 'outcome' = 'refused', format('got %s', r);
  assert r -> 'error' ->> 'code' = 'authority_required', format('got %s', r);

  select count(*) into n from ops_acct.transactions;
  assert n = 0, 'and nothing was written';
end $$;

set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-00000000f11a';

/* ── REFUSAL: no document, no row (D85) ───────────────────────────────── */
do $$
declare r jsonb;
begin
  r := ops_acct.post_transaction('BCA 271','OUT', 500000,'OTHERS','bayar sesuatu',
        '[]'::jsonb);
  assert r -> 'error' ->> 'code' = 'evidence_required', format('got %s', r);

  -- A supporting document cannot stand alone: a surat jalan says goods moved,
  -- not that money did.
  r := ops_acct.post_transaction('BCA 271','OUT', 500000,'OTHERS','bayar sesuatu',
        jsonb_build_array(jsonb_build_object(
          'attachment_id','44440000-0000-0000-0000-0000000000b2','kind','delivery_note')));
  assert r -> 'error' ->> 'code' = 'evidence_required',
         format('supporting is not primary, got %s', r);
end $$;

/* ── REFUSAL: a purchase needs to be checkable (D86) ───────────────────── */
do $$
declare r jsonb; nota jsonb;
begin
  nota := jsonb_build_array(jsonb_build_object(
    'attachment_id','44440000-0000-0000-0000-0000000000b1','kind','nota'));

  r := ops_acct.post_transaction('BCA 271','OUT', 500000,'SUPPLIERS','bayar cat', nota);
  assert r -> 'error' ->> 'code' = 'detail_required',
         format('an amount on its own cannot be checked, got %s', r);

  r := ops_acct.post_transaction('BCA 271','OUT', 500000,'SUPPLIERS','bayar cat', nota,
        null, null, null,
        jsonb_build_array(jsonb_build_object('description','Cat duco','amount',500000)));
  assert r -> 'error' ->> 'code' = 'line_detail_required',
         format('qty and price are what make a price comparable, got %s', r);
  assert r -> 'error' ->> 'message' like '%Cat duco%', 'and it names the line';

  r := ops_acct.post_transaction('BCA 271','OUT', 500000,'SUPPLIERS','bayar cat', nota,
        null, null, null,
        jsonb_build_array(jsonb_build_object('description','Cat duco','qty',10,
          'unit_price',50000,'amount',500000)));
  assert r -> 'error' ->> 'code' = 'vendor_required',
         format('"where do we buy this" needs an answer, got %s', r);

  -- The detail and the total are two statements about one event.
  r := ops_acct.post_transaction('BCA 271','OUT', 500000,'SUPPLIERS','bayar cat', nota,
        null, 'V-7001', null,
        jsonb_build_array(jsonb_build_object('description','Cat duco','qty',10,
          'unit_price',50000,'amount',480000)));
  assert r -> 'error' ->> 'code' = 'lines_do_not_add_up', format('got %s', r);
  assert r -> 'error' ->> 'message' like '%will not guess%', format('got %s', r);
end $$;

/* ── the row that is allowed through ───────────────────────────────────── */
do $$
declare r jsonb; trx text; bal numeric; n int;
begin
  r := ops_acct.post_transaction('BCA 271','OUT', 500000,'SUPPLIERS','Bayar cat duco',
        jsonb_build_array(jsonb_build_object(
          'attachment_id','44440000-0000-0000-0000-0000000000b1','kind','nota')),
        null, 'V-7001', null,
        jsonb_build_array(jsonb_build_object('description','Cat duco 5kg','qty',10,
          'unit_price',50000,'amount',500000,
          'item_id','22220000-0000-0000-0000-0000000000b1')),
        null, 'nota-2609-001');
  assert ops_core.said_ok(r), format('got %s', r);
  trx := r -> 'data' ->> 'trx_no';

  -- A repeat of the same event — a re-run import, a retried webhook — is one
  -- row, whether or not the caller remembered an idempotency key (A4).
  r := ops_acct.post_transaction('BCA 271','OUT', 500000,'SUPPLIERS','Bayar cat duco',
        jsonb_build_array(jsonb_build_object(
          'attachment_id','44440000-0000-0000-0000-0000000000b1','kind','nota')),
        null, 'V-7001', null,
        jsonb_build_array(jsonb_build_object('description','Cat duco 5kg','qty',10,
          'unit_price',50000,'amount',500000)),
        null, 'nota-2609-001');
  assert r ->> 'outcome' = 'duplicate', format('got %s', r);
  assert r -> 'error' ->> 'code' = 'already_posted', format('got %s', r);

  select count(*) into n from ops_acct.transactions;
  assert n = 1, format('one event, one row — saw %s', n);

  -- The database owns the balance (D9).
  select balance into bal from ops_acct.v_account_balance where code = 'BCA 271';
  assert bal = -500000, format('opening 0, out 500.000, got %s', bal);
end $$;

/* ── DERIVATION: is this row expected to name a decision? (D83) ────────── */
do $$
declare r jsonb; expects boolean;
begin
  select expects_allocation into expects from ops_acct.v_transaction
   where type_code = 'SUPPLIERS';
  assert expects, 'a supplier payment should name what it was for';

  r := ops_acct.post_transaction('BCA 271','OUT', 12000000,'RECCURING - PAYROLL','Gaji minggu 37',
        jsonb_build_array(jsonb_build_object(
          'attachment_id','44440000-0000-0000-0000-0000000000b1','kind','transfer_proof')),
        null, null, null, '[]'::jsonb, null, 'payroll-w37');
  assert ops_core.said_ok(r), format('payroll needs no line detail, got %s', r);

  select expects_allocation into expects from ops_acct.v_transaction
   where type_code = 'RECCURING - PAYROLL';
  assert not expects,
         'payroll is money leaving for a reason nobody raises a request for — flagging it would drown the rows that matter';
end $$;

/* ── allocating, and the ceiling (A9) ──────────────────────────────────── */
set local role postgres;
insert into ops_procure.pr_documents (id, doc_no, status, requested_by, submitted_at) values
  ('55550000-0000-0000-0000-0000000000b1','pr-26-09-13_01','SUBMITTED',
   'ffffffff-0000-0000-0000-00000000f11a', now());
insert into ops_procure.pr_lines (id, doc_id, doc_no, line_no, description, qty, uom, unit_price, item_total, vendor_id) values
  ('66660000-0000-0000-0000-0000000000b1','55550000-0000-0000-0000-0000000000b1','pr-26-09-13_01',1,
   'Cat duco 5kg',10,'kg',50000,500000,'11110000-0000-0000-0000-0000000000b1'),
  ('66660000-0000-0000-0000-0000000000b2','55550000-0000-0000-0000-0000000000b1','pr-26-09-13_01',2,
   'Kuas', 5,'pcs',20000,100000,'11110000-0000-0000-0000-0000000000b1');
set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-00000000f11a';

do $$
declare r jsonb; trx text; unalloc numeric;
begin
  select trx_no into trx from ops_acct.transactions where source_ref = 'nota-2609-001';

  r := ops_acct.allocate_payment(trx, 500000, 'pr-26-09-13_01-L99');
  assert r -> 'error' ->> 'code' = 'pr_line_not_found',
         format('a code that names nothing is refused at the seam (ADR-004), got %s', r);

  r := ops_acct.allocate_payment(trx, 400000, 'pr-26-09-13_01-L01');
  assert ops_core.said_ok(r), format('got %s', r);
  assert (r -> 'data' ->> 'unallocated')::numeric = 100000, format('got %s', r);

  -- The ceiling. This transaction moved 500.000 and 400.000 is spoken for.
  r := ops_acct.allocate_payment(trx, 200000, 'pr-26-09-13_01-L02');
  assert r -> 'error' ->> 'code' = 'over_allocated',
         format('a transaction never funds more than it moved, got %s', r);
  assert r -> 'error' ->> 'message' like '%never funds more than it moved%';

  -- The remainder fits.
  r := ops_acct.allocate_payment(trx, 100000, 'pr-26-09-13_01-L02');
  assert ops_core.said_ok(r), format('got %s', r);

  select unallocated into unalloc from ops_acct.v_transaction where trx_no = trx;
  assert unalloc = 0, format('fully applied, got %s', unalloc);
end $$;

/* ── a correction supersedes, never deletes (A2) ───────────────────────── */
do $$
declare r jsonb; aid uuid; n int; live numeric;
begin
  select a.id into aid from ops_acct.payment_allocations a
   where a.pr_line_no = 'pr-26-09-13_01-L01';

  r := ops_acct.supersede_allocation(aid, 350000);
  assert ops_core.said_ok(r), format('got %s', r);

  select count(*) into n from ops_acct.payment_allocations where pr_line_no = 'pr-26-09-13_01-L01';
  assert n = 2, format('the old row stays — saw %s', n);

  select sum(amount) into live from ops_acct.payment_allocations
   where pr_line_no = 'pr-26-09-13_01-L01' and superseded_by is null;
  assert live = 350000, format('and only the live one counts, got %s', live);

  r := ops_acct.supersede_allocation(aid, 300000);
  assert r -> 'error' ->> 'code' = 'already_superseded', format('got %s', r);
end $$;

/* ── REFUSAL: a VOID row funds nothing (A10) ───────────────────────────── */
do $$
declare r jsonb; trx text; bal numeric; cov numeric;
begin
  select trx_no into trx from ops_acct.transactions where source_ref = 'nota-2609-001';

  r := ops_acct.void_transaction(trx, '');
  assert r -> 'error' ->> 'code' = 'reason_required',
         format('a void with no reason is a deletion wearing a hat, got %s', r);

  r := ops_acct.void_transaction(trx, 'Salah rekening — diulang dari BNI.');
  assert ops_core.said_ok(r), format('got %s', r);

  -- The row and its amount are still there; the balance is not.
  select balance into bal from ops_acct.v_account_balance where code = 'BCA 271';
  assert bal = -12000000, format('only payroll remains against the account, got %s', bal);

  assert (select amount_idr from ops_acct.transactions where trx_no = trx) = 500000,
         'VOID keeps the amount, with a reason beside it (D84)';

  -- And the coverage it carried falls away by itself, because the view reads
  -- live transactions rather than live allocations.
  select covered into cov from ops_procure.v_line_coverage
   where line_no_full = 'pr-26-09-13_01-L01';
  assert cov = 0, format('a stamp pointing at a voided row is not paid, got %s', cov);

  r := ops_acct.allocate_payment(trx, 10000, 'pr-26-09-13_01-L02');
  assert r -> 'error' ->> 'code' = 'transaction_void', format('got %s', r);

  r := ops_acct.void_transaction(trx, 'lagi');
  assert r -> 'error' ->> 'code' = 'already_void', format('got %s', r);
end $$;

/* ── the exception road: five ways out, none of them delete (D94) ──────── */
set local role postgres;
insert into ops_acct.evidence_inbox (ref_id, origin, attachment_id, reported_by, extracted, money_direction) values
  ('inb-001','chat','44440000-0000-0000-0000-0000000000b3','ffffffff-0000-0000-0000-00000000f11a',
   '{"vendor_name":"CV UJI LEDGER","amount_idr":250000,"confidence":0.4,"doc_kind":"nota"}', 'OUT'),
  ('inb-002','web','44440000-0000-0000-0000-0000000000b3','ffffffff-0000-0000-0000-00000000f11a',
   '{}', null);
set local role authenticated;

-- Evin holds approve_funds and accounting.read. Neither resolves an inbox row.
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-00000000ce00';
do $$
declare r jsonb;
begin
  r := ops_acct.resolve_inbox('inb-001','NOTED');
  assert r -> 'error' ->> 'code' = 'authority_required',
         format('resolving is its own authority (D24), got %s', r);
end $$;

set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-00000000f11a';
do $$
declare r jsonb; n int; att int;
begin
  r := ops_acct.resolve_inbox('inb-001','CONFIRMED');
  assert r -> 'error' ->> 'code' = 'trx_required',
         format('confirmed against what? got %s', r);

  r := ops_acct.resolve_inbox('inb-001','CONFIRMED','trx-99-99-99_999');
  assert r -> 'error' ->> 'code' = 'no_such_transaction', format('got %s', r);

  -- Rejecting without a reason leaves whoever sent it with nothing to act on,
  -- which is how a document comes back three times.
  r := ops_acct.resolve_inbox('inb-002','REJECTED');
  assert r -> 'error' ->> 'code' = 'reason_required', format('got %s', r);

  r := ops_acct.resolve_inbox('inb-002','REJECTED','','Ini struk pribadi, bukan punya kantor.');
  assert ops_core.said_ok(r), format('got %s', r);

  -- Resolving attaches the document to the record, which is the whole point:
  -- it stops being loose.
  r := ops_acct.resolve_inbox('inb-001','ATTACHED',
        (select trx_no from ops_acct.transactions where source_ref = 'payroll-w37'));
  assert ops_core.said_ok(r), format('got %s', r);

  select count(*) into att from ops_core.attachment_links
   where entity = 'transaction' and attachment_id = '44440000-0000-0000-0000-0000000000b3';
  assert att = 1, format('the loose document is now evidence on a row, saw %s', att);

  r := ops_acct.resolve_inbox('inb-001','NOTED');
  assert r -> 'error' ->> 'code' = 'already_resolved', format('got %s', r);

  -- Nothing left the table. Five roads out, and every one of them keeps the row.
  select count(*) into n from ops_acct.evidence_inbox;
  assert n = 2, format('nothing is deleted, saw %s rows', n);
end $$;

/* ── DERIVATION: the road's health ─────────────────────────────────────── */
do $$
declare h record;
begin
  select * into h from ops_acct.v_inbox_health;
  assert h.arrived = 2, format('two arrived this week, got %s', h.arrived);
  assert h.unresolved = 0, format('both dealt with, got %s', h.unresolved);
  assert h.from_chat = 1 and h.from_web = 1,
         format('one each door, got chat %s web %s', h.from_chat, h.from_web);
  -- Not decoration: if this grows, people are routing around the normal road
  -- and the reason is worth finding (ADR-010).
end $$;

/* ── DERIVATION: locked, not hidden (D87) ──────────────────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-00000000f11a';
do $$
declare locked boolean; n int;
begin
  select balance_locked into locked from ops_acct.v_account_balance where code = 'BCA 064';
  assert locked, 'Rina has no approve_funds, so leadership''s figure is locked to her';

  select count(*) into n from ops_acct.v_account_balance;
  assert n = 6, format('and all six accounts are still visible — locked, not hidden, saw %s', n);
end $$;

set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-00000000ce00';
do $$
declare locked boolean;
begin
  select balance_locked into locked from ops_acct.v_account_balance where code = 'BCA 064';
  assert not locked, 'Evin holds approve_funds and sees it';
end $$;

rollback;
