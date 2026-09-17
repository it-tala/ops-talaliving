-- procure — the ladder, the money, and the approval nobody but the CEO may give.
--
-- The definition of done asks each schema for a refusal and a derivation. This
-- schema is where both halves are load-bearing, so it proves several of each,
-- and every derivation below reproduces a number this project has already
-- argued about by name:
--
--   * TRANSFERRED is not PAID (D6, A10)
--   * money that moved before anybody said yes — `paid_unapproved` (A1)
--   * a service line completes on payment proof alone (D25)
--   * a Rp 500 gap is arithmetic; Rp 180.000 is a variance (A12)
--   * an over-delivery is a credit, and `value_received` is capped (D98)
--   * a deposit is earned on issue; everything else as goods arrive (D99)
--   * a term whose predecessor is unpaid is BLOCKED, and says which (D128)
--   * a voided payment pulls its coverage back with it (A10)
--
-- And the refusal the whole access model was built for: **`procurement.admin`
-- cannot approve goods.**

begin;

-- ── people ────────────────────────────────────────────────────────────────
insert into auth.users (id, email, raw_user_meta_data) values
  ('cccccccc-0000-0000-0000-00000000ce00','evin@talaliving.com', '{"full_name":"Evin Jonathan"}'),
  ('cccccccc-0000-0000-0000-00000000f11a','rina@talaliving.com', '{"full_name":"Rina Kartika"}'),
  ('cccccccc-0000-0000-0000-00000000a11d','andi@talaliving.com', '{"full_name":"Andi Prasetyo"}');

-- The CEO approves goods and nothing else.
insert into ops_core.user_authorities (user_id, authority) values
  ('cccccccc-0000-0000-0000-00000000ce00','approve_goods'),
  ('cccccccc-0000-0000-0000-00000000f11a','approve_funds'),
  ('cccccccc-0000-0000-0000-00000000f11a','post_ledger');
insert into ops_core.user_modules (user_id, module, level) values
  ('cccccccc-0000-0000-0000-00000000ce00','procurement','read'),
  ('cccccccc-0000-0000-0000-00000000f11a','accounting','write'),
  ('cccccccc-0000-0000-0000-00000000f11a','procurement','read'),
  -- Andi holds the **highest** procurement grant there is. He can create every
  -- line on the board, edit them all and remove them. He still may not approve
  -- one, and proving that is the point of this file.
  ('cccccccc-0000-0000-0000-00000000a11d','procurement','admin');

-- ── reference ─────────────────────────────────────────────────────────────
insert into ops_procure.vendors (id, code, name, is_curated) values
  ('11110000-0000-0000-0000-000000000001','V-9001','CV KAYU UJI', true);
insert into ops_procure.items (id, code, name, category_code, base_uom, kind) values
  ('22220000-0000-0000-0000-000000000001','I-9001','Plywood 18mm','raw-wood','lembar','goods'),
  ('22220000-0000-0000-0000-000000000002','I-9002','Potong rumput','service','unit','service');
insert into ops_procure.projects (id, code, name) values
  ('33330000-0000-0000-0000-000000000001','25099','HOTEL UJI');

insert into ops_core.attachments (id, storage_path, filename, uploaded_by) values
  ('44440000-0000-0000-0000-000000000001','p/proof1.jpg','bukti-transfer.jpg','cccccccc-0000-0000-0000-00000000f11a'),
  ('44440000-0000-0000-0000-000000000002','p/proof2.jpg','bukti-transfer-2.jpg','cccccccc-0000-0000-0000-00000000f11a'),
  ('44440000-0000-0000-0000-000000000003','p/proof3.jpg','bukti-transfer-3.jpg','cccccccc-0000-0000-0000-00000000f11a');

-- ── the requests ──────────────────────────────────────────────────────────
insert into ops_procure.pr_documents (id, doc_no, status, requested_by, project_id, submitted_at) values
  ('55550000-0000-0000-0000-000000000001','pr-26-09-11_01','SUBMITTED',
   'cccccccc-0000-0000-0000-00000000a11d','33330000-0000-0000-0000-000000000001', now()),
  ('55550000-0000-0000-0000-000000000009','pr-26-09-11_09','DRAFT',
   'cccccccc-0000-0000-0000-00000000a11d', null, null);

insert into ops_procure.pr_lines (id, doc_id, doc_no, line_no, item_id, description, qty, uom, unit_price, item_total, vendor_id) values
  -- L01 the full chain          L02 no proof              L03 nobody approved
  ('66660000-0000-0000-0000-000000000001','55550000-0000-0000-0000-000000000001','pr-26-09-11_01',1,
   '22220000-0000-0000-0000-000000000001','Plywood 18mm — full chain', 10,'lembar',100000,1000000,'11110000-0000-0000-0000-000000000001'),
  ('66660000-0000-0000-0000-000000000002','55550000-0000-0000-0000-000000000001','pr-26-09-11_01',2,
   '22220000-0000-0000-0000-000000000001','Plywood 18mm — no payment proof', 10,'lembar',100000,1000000,'11110000-0000-0000-0000-000000000001'),
  ('66660000-0000-0000-0000-000000000003','55550000-0000-0000-0000-000000000001','pr-26-09-11_01',3,
   '22220000-0000-0000-0000-000000000001','Plywood 18mm — paid, nobody said yes', 5,'lembar',100000,500000,'11110000-0000-0000-0000-000000000001'),
  -- L04 a service               L05 in a TRANSFERRED round, unpaid
  ('66660000-0000-0000-0000-000000000004','55550000-0000-0000-0000-000000000001','pr-26-09-11_01',4,
   '22220000-0000-0000-0000-000000000002','Potong rumput halaman', 1,'unit',300000,300000,'11110000-0000-0000-0000-000000000001'),
  ('66660000-0000-0000-0000-000000000005','55550000-0000-0000-0000-000000000001','pr-26-09-11_01',5,
   '22220000-0000-0000-0000-000000000001','Plywood — approved, round funded, vendor unpaid', 4,'lembar',100000,400000,'11110000-0000-0000-0000-000000000001'),
  -- L06 Rp 500 over             L07 Rp 180.000 over, delivered, unexplained
  ('66660000-0000-0000-0000-000000000006','55550000-0000-0000-0000-000000000001','pr-26-09-11_01',6,
   '22220000-0000-0000-0000-000000000001','Plywood — Rp 500 rounding', 10,'lembar',100000,1000000,'11110000-0000-0000-0000-000000000001'),
  ('66660000-0000-0000-0000-000000000007','55550000-0000-0000-0000-000000000001','pr-26-09-11_01',7,
   '22220000-0000-0000-0000-000000000001','Plywood — Rp 180.000 left beyond the yes', 10,'lembar',100000,1000000,'11110000-0000-0000-0000-000000000001'),
  -- L08 paid by a transaction that is then voided
  ('66660000-0000-0000-0000-000000000008','55550000-0000-0000-0000-000000000001','pr-26-09-11_01',8,
   '22220000-0000-0000-0000-000000000001','Plywood — payment voided', 3,'lembar',100000,300000,'11110000-0000-0000-0000-000000000001'),
  -- L09 sits in a DRAFT document
  ('66660000-0000-0000-0000-000000000009','55550000-0000-0000-0000-000000000009','pr-26-09-11_09',1,
   '22220000-0000-0000-0000-000000000001','Plywood — still a draft', 2,'lembar',100000,200000,'11110000-0000-0000-0000-000000000001');

-- The generated public code, before anything else is asserted: if this is wrong
-- every cross-service reference in the system is wrong.
do $$
declare code text;
begin
  select line_no_full into code from ops_procure.pr_lines
   where id = '66660000-0000-0000-0000-000000000003';
  assert code = 'pr-26-09-11_01-L03', format('expected pr-26-09-11_01-L03, got %s', code);
end $$;

-- ── approvals ─────────────────────────────────────────────────────────────
-- Everything except L03 (paid without a yes) and L09 (a draft).
insert into ops_procure.pr_approvals (line_id, step, approved, approved_amount, recorded_by, recorded_by_email, channel) values
  ('66660000-0000-0000-0000-000000000001','GOODS',true,1000000,'cccccccc-0000-0000-0000-00000000ce00','evin@talaliving.com','web'),
  ('66660000-0000-0000-0000-000000000002','GOODS',true,1000000,'cccccccc-0000-0000-0000-00000000ce00','evin@talaliving.com','web'),
  ('66660000-0000-0000-0000-000000000004','GOODS',true, 300000,'cccccccc-0000-0000-0000-00000000ce00','evin@talaliving.com','chat'),
  ('66660000-0000-0000-0000-000000000005','GOODS',true, 400000,'cccccccc-0000-0000-0000-00000000ce00','evin@talaliving.com','chat'),
  ('66660000-0000-0000-0000-000000000006','GOODS',true,1000000,'cccccccc-0000-0000-0000-00000000ce00','evin@talaliving.com','web'),
  ('66660000-0000-0000-0000-000000000007','GOODS',true,1000000,'cccccccc-0000-0000-0000-00000000ce00','evin@talaliving.com','web'),
  ('66660000-0000-0000-0000-000000000008','GOODS',true, 300000,'cccccccc-0000-0000-0000-00000000ce00','evin@talaliving.com','web');

-- Append-only: L02 was ticked, un-ticked and re-ticked. The current answer is
-- the last row, and the middle one stays readable in the trail (D28).
insert into ops_procure.pr_approvals (line_id, step, approved, approved_amount, recorded_by, recorded_by_email, recorded_at) values
  ('66660000-0000-0000-0000-000000000002','GOODS',false,null,'cccccccc-0000-0000-0000-00000000ce00','evin@talaliving.com', now() + interval '1 minute'),
  ('66660000-0000-0000-0000-000000000002','GOODS',true,1000000,'cccccccc-0000-0000-0000-00000000ce00','evin@talaliving.com', now() + interval '2 minutes');

-- ── the money ─────────────────────────────────────────────────────────────
insert into ops_acct.transactions (id, trx_no, trx_date, account_id, direction, amount_idr, type_code, description, source_ref, posted_by) values
  ('77770000-0000-0000-0000-000000000001','trx-26-09-11_001', current_date,
   (select id from ops_acct.accounts where code='BCA 271'),'OUT',1000000,'SUPPLIERS','bayar L01','ref-001','cccccccc-0000-0000-0000-00000000f11a'),
  ('77770000-0000-0000-0000-000000000002','trx-26-09-11_002', current_date,
   (select id from ops_acct.accounts where code='BCA 271'),'OUT',1000000,'SUPPLIERS','bayar L02','ref-002','cccccccc-0000-0000-0000-00000000f11a'),
  ('77770000-0000-0000-0000-000000000003','trx-26-09-11_003', current_date,
   (select id from ops_acct.accounts where code='BCA 271'),'OUT', 500000,'SUPPLIERS','bayar L03','ref-003','cccccccc-0000-0000-0000-00000000f11a'),
  ('77770000-0000-0000-0000-000000000004','trx-26-09-11_004', current_date,
   (select id from ops_acct.accounts where code='BCA 271'),'OUT', 300000,'SUPPLIERS','bayar L04','ref-004','cccccccc-0000-0000-0000-00000000f11a'),
  ('77770000-0000-0000-0000-000000000006','trx-26-09-11_006', current_date,
   (select id from ops_acct.accounts where code='BCA 271'),'OUT',1000500,'SUPPLIERS','bayar L06','ref-006','cccccccc-0000-0000-0000-00000000f11a'),
  ('77770000-0000-0000-0000-000000000007','trx-26-09-11_007', current_date,
   (select id from ops_acct.accounts where code='BCA 271'),'OUT',1180000,'SUPPLIERS','bayar L07','ref-007','cccccccc-0000-0000-0000-00000000f11a'),
  ('77770000-0000-0000-0000-000000000008','trx-26-09-11_008', current_date,
   (select id from ops_acct.accounts where code='BCA 271'),'OUT', 300000,'SUPPLIERS','bayar L08','ref-008','cccccccc-0000-0000-0000-00000000f11a'),
  -- The instalment funding the round. Money IN to the paying account — which
  -- pays nobody.
  ('77770000-0000-0000-0000-00000000000f','trx-26-09-11_015', current_date,
   (select id from ops_acct.accounts where code='BCA 271'),'IN', 400000,'CASHFLOW','isi ronde','ref-015','cccccccc-0000-0000-0000-00000000f11a');

insert into ops_acct.payment_allocations (trx_id, pr_line_no, amount, allocated_by) values
  ('77770000-0000-0000-0000-000000000001','pr-26-09-11_01-L01',1000000,'cccccccc-0000-0000-0000-00000000f11a'),
  ('77770000-0000-0000-0000-000000000002','pr-26-09-11_01-L02',1000000,'cccccccc-0000-0000-0000-00000000f11a'),
  ('77770000-0000-0000-0000-000000000003','pr-26-09-11_01-L03', 500000,'cccccccc-0000-0000-0000-00000000f11a'),
  ('77770000-0000-0000-0000-000000000004','pr-26-09-11_01-L04', 300000,'cccccccc-0000-0000-0000-00000000f11a'),
  ('77770000-0000-0000-0000-000000000006','pr-26-09-11_01-L06',1000500,'cccccccc-0000-0000-0000-00000000f11a'),
  ('77770000-0000-0000-0000-000000000007','pr-26-09-11_01-L07',1180000,'cccccccc-0000-0000-0000-00000000f11a'),
  ('77770000-0000-0000-0000-000000000008','pr-26-09-11_01-L08', 300000,'cccccccc-0000-0000-0000-00000000f11a');

-- Payment proof on every paid line except L02 — which is the whole of L02's job.
insert into ops_core.attachment_links (attachment_id, entity, entity_no, kind, linked_by) values
  ('44440000-0000-0000-0000-000000000001','transaction','trx-26-09-11_001','transfer_proof','cccccccc-0000-0000-0000-00000000f11a'),
  ('44440000-0000-0000-0000-000000000001','transaction','trx-26-09-11_003','transfer_proof','cccccccc-0000-0000-0000-00000000f11a'),
  ('44440000-0000-0000-0000-000000000002','transaction','trx-26-09-11_004','transfer_proof','cccccccc-0000-0000-0000-00000000f11a'),
  ('44440000-0000-0000-0000-000000000002','transaction','trx-26-09-11_007','transfer_proof','cccccccc-0000-0000-0000-00000000f11a'),
  ('44440000-0000-0000-0000-000000000003','transaction','trx-26-09-11_008','transfer_proof','cccccccc-0000-0000-0000-00000000f11a');

-- ── what arrived ──────────────────────────────────────────────────────────
insert into ops_procure.receipts (receipt_no, line_id, qty_received, condition, received_by, qc_by, status, confirmed_by, confirmed_at) values
  ('rcp-001','66660000-0000-0000-0000-000000000001',10,'GOOD','cccccccc-0000-0000-0000-00000000a11d','cccccccc-0000-0000-0000-00000000a11d','CONFIRMED','cccccccc-0000-0000-0000-00000000a11d', now()),
  ('rcp-002','66660000-0000-0000-0000-000000000002',10,'GOOD','cccccccc-0000-0000-0000-00000000a11d','cccccccc-0000-0000-0000-00000000a11d','CONFIRMED','cccccccc-0000-0000-0000-00000000a11d', now()),
  ('rcp-007','66660000-0000-0000-0000-000000000007',10,'GOOD','cccccccc-0000-0000-0000-00000000a11d','cccccccc-0000-0000-0000-00000000a11d','CONFIRMED','cccccccc-0000-0000-0000-00000000a11d', now()),
  -- Reported at night and not yet signed for. Shown, never counted (D131).
  ('rcp-003','66660000-0000-0000-0000-000000000003', 5,'GOOD','cccccccc-0000-0000-0000-00000000a11d', null,'REPORTED', null, null);

-- ── the round ─────────────────────────────────────────────────────────────
insert into ops_procure.payment_rounds (id, round_no, status, opened_by, approved_by, approved_at) values
  ('88880000-0000-0000-0000-000000000001','fund-26-09-11_01','TRANSFERRED',
   'cccccccc-0000-0000-0000-00000000a11d','cccccccc-0000-0000-0000-00000000f11a', now());
insert into ops_procure.payment_round_lines (round_id, line_id, requested_amount) values
  ('88880000-0000-0000-0000-000000000001','66660000-0000-0000-0000-000000000005',400000);
insert into ops_procure.round_transfers (round_id, amount, trx_no, proof_attachment_id, recorded_by, recorded_by_email) values
  ('88880000-0000-0000-0000-000000000001',400000,'trx-26-09-11_015',
   '44440000-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-00000000f11a','rina@talaliving.com');

/* ═══════════════════════════════════════════════════════════════════════════
   DERIVATION 1 — the ladder, seven ways
   ═════════════════════════════════════════════════════════════════════════ */
do $$
declare s text; m text;
begin
  select status into s from ops_procure.v_pr_line_status where line_no_full = 'pr-26-09-11_01-L01';
  assert s = 'COMPLETED', format('L01 has the whole chain, got %s', s);

  -- The anti-fraud line (A11). L02 is identical to L01 — approved, paid in
  -- full, all ten sheets delivered and signed for — except that nobody filed
  -- the proof that the money left. It must not read COMPLETED.
  --
  -- It reads PARTIAL, not PAID, and that is the demo's own order rather than an
  -- accident of the port: the ladder asks "has anything arrived?" before "is it
  -- paid?", so a line carrying a delivery lands on PARTIAL whatever its money
  -- says. Worth an assertion of its own precisely because it is surprising —
  -- somebody porting this later will read PARTIAL, assume a bug, and "fix" the
  -- order into disagreeing with every screen built on it since M12.
  select status into s from ops_procure.v_pr_line_status where line_no_full = 'pr-26-09-11_01-L02';
  assert s = 'PARTIAL', format('L02 has no payment proof, so never COMPLETED — got %s', s);

  -- Money moved before anybody said yes. The corner a single "in progress"
  -- status hides, and the reason the quadrant exists at all (A1).
  select status, meeting_state into s, m
    from ops_procure.v_pr_line_status where line_no_full = 'pr-26-09-11_01-L03';
  assert m = 'paid_unapproved', format('L03: money moved without a yes, got %s', m);
  assert s = 'PAID', format('L03 is paid and its delivery is only reported, got %s', s);

  -- D25: mowing the grass never gets delivered. A service line completes on
  -- payment proof alone, and used to sit at PAID for ever.
  select status into s from ops_procure.v_pr_line_status where line_no_full = 'pr-26-09-11_01-L04';
  assert s = 'COMPLETED', format('a service line completes without a receipt (D25), got %s', s);

  select status into s from ops_procure.v_pr_line_status where line_no_full = 'pr-26-09-11_09-L01';
  assert s = 'DRAFT', format('a line in a draft document is DRAFT, got %s', s);

  select meeting_state into m from ops_procure.v_pr_line_status where line_no_full = 'pr-26-09-11_01-L05';
  assert m = 'approved_unpaid', format('L05 was approved and nobody has been paid, got %s', m);
end $$;

/* ═══════════════════════════════════════════════════════════════════════════
   DERIVATION 2 — TRANSFERRED is not PAID (D6, A10)
   The one john-lau got wrong most expensively. The round has its money, with
   proof, and the vendor has still not been paid.
   ═════════════════════════════════════════════════════════════════════════ */
do $$
declare s text; rs text; transferred numeric; requested numeric; short numeric;
begin
  select status, round_status into s, rs
    from ops_procure.v_pr_line where line_no_full = 'pr-26-09-11_01-L05';
  assert rs = 'TRANSFERRED', format('the round is funded, got %s', rs);
  assert s = 'APPROVED',
         format('a funded round pays nobody — the line must not be PAID, got %s', s);

  select requested_total, transferred_total, transfer_shortfall
    into requested, transferred, short
    from ops_procure.v_round_summary where round_no = 'fund-26-09-11_01';
  assert requested = 400000, format('an approved round keeps its frozen figure, got %s', requested);
  assert transferred = 400000, format('one instalment of 400.000 landed, got %s', transferred);
  assert short = 0, format('fully funded, got a shortfall of %s', short);
end $$;

/* ═══════════════════════════════════════════════════════════════════════════
   DERIVATION 3 — a variance is rounding, or it is a question (A12)
   ═════════════════════════════════════════════════════════════════════════ */
do $$
declare d numeric; mat boolean; k text;
begin
  select delta, material into d, mat
    from ops_procure.v_line_variance v
    join ops_procure.pr_lines l on l.id = v.line_id
   where l.line_no_full = 'pr-26-09-11_01-L06';
  assert d = 500, format('L06 paid Rp 500 over, got %s', d);
  assert not mat, 'Rp 500 is arithmetic, not a variance — reporting it teaches people to ignore exceptions';

  -- The direction that matters. Money left **beyond the yes** — which is the
  -- one a simple "paid" flag would have hidden entirely (A1).
  select delta, material, kind into d, mat, k
    from ops_procure.v_line_variance v
    join ops_procure.pr_lines l on l.id = v.line_id
   where l.line_no_full = 'pr-26-09-11_01-L07';
  assert d = 180000, format('L07 paid Rp 180.000 beyond what was approved, got %s', d);
  assert mat, 'Rp 180.000 is a variance worth explaining';
  assert k = 'over', format('more money moved than was authorised, got %s', k);
end $$;

-- And a difference outlives the line. L07 is approved, paid, fully delivered
-- with a proof on file — COMPLETED by the ladder — and it stays on the open
-- board because nobody has explained the gap. Letting it drop off because the
-- goods arrived is precisely how an overpayment stops being anyone's problem.
do $$
declare s text; n int;
begin
  select status into s from ops_procure.v_pr_line_status where line_no_full = 'pr-26-09-11_01-L07';
  assert s = 'COMPLETED', format('L07 has the whole chain, got %s', s);

  select count(*) into n from ops_procure.v_open_lines where line_no_full = 'pr-26-09-11_01-L07';
  assert n = 1, 'a COMPLETED line with an unexplained material variance stays on the board';

  select count(*) into n from ops_procure.v_open_lines where line_no_full = 'pr-26-09-11_01-L01';
  assert n = 0, 'L01 is finished and settled — it leaves the board';
end $$;

-- Explaining it takes it off. Not because the money came back, but because
-- somebody has answered for it, on the record, with a reason from a closed list.
insert into ops_procure.line_variances (line_id, reason, note, amount_at_time, recorded_by, recorded_by_email) values
  ('66660000-0000-0000-0000-000000000007','price_changed','Harga vendor naik di nota akhir.',180000,
   'cccccccc-0000-0000-0000-00000000a11d','andi@talaliving.com');

do $$
declare n int; r text;
begin
  select count(*) into n from ops_procure.v_open_lines where line_no_full = 'pr-26-09-11_01-L07';
  assert n = 0, 'once explained, the line leaves the board';

  select explanation_reason into r from ops_procure.v_pr_line where line_no_full = 'pr-26-09-11_01-L07';
  assert r = 'price_changed', format('the explanation is on the line, got %s', r);
end $$;

/* ═══════════════════════════════════════════════════════════════════════════
   DERIVATION 4 — a stamp pointing at nothing is not paid (A10)
   Voiding the transaction pulls its coverage back with it.
   ═════════════════════════════════════════════════════════════════════════ */
do $$
declare s text; c numeric;
begin
  select status into s from ops_procure.v_pr_line_status where line_no_full = 'pr-26-09-11_01-L08';
  assert s = 'PAID', format('L08 starts paid, got %s', s);

  update ops_acct.transactions
     set status = 'VOID', void_reason = 'salah rekening', void_at = now(),
         void_by = 'cccccccc-0000-0000-0000-00000000f11a'
   where trx_no = 'trx-26-09-11_008';

  select status into s from ops_procure.v_pr_line_status where line_no_full = 'pr-26-09-11_01-L08';
  assert s = 'APPROVED', format('a voided payment stops covering the line, got %s', s);

  select coverage_covered into c from ops_procure.v_pr_line where line_no_full = 'pr-26-09-11_01-L08';
  assert c = 0, format('coverage goes back to zero, got %s', c);
end $$;

-- The other road to settled, and the one that must never be silent. A line can
-- be finished with less money against it than was approved — but only because a
-- **named person said so, on a date, for a reason** (A12). There is no
-- tolerance that does this quietly; the reason column is `not null` and checked
-- non-empty precisely so that a thousand small write-offs cannot accumulate
-- into a number nobody can explain.
insert into ops_procure.line_settlements (line_id, shortfall, reason, decided_by) values
  ('66660000-0000-0000-0000-000000000008',300000,
   'Vendor membatalkan; DP tidak jadi dikirim. Ditutup atas keputusan Finance 11/09.',
   'cccccccc-0000-0000-0000-00000000f11a');

do $$
declare s text; settled boolean;
begin
  select status into s from ops_procure.v_pr_line_status where line_no_full = 'pr-26-09-11_01-L08';
  assert s = 'PAID', format('a settled line leaves the unpaid state, got %s', s);

  select coverage_settled into settled
    from ops_procure.v_pr_line where line_no_full = 'pr-26-09-11_01-L08';
  assert settled, 'settled by decision, with nobody having paid anything';
end $$;

/* ═══════════════════════════════════════════════════════════════════════════
   DERIVATION 5 — the order: two axes, a credit, and what may be billed
   ═════════════════════════════════════════════════════════════════════════ */
insert into ops_procure.purchase_orders
  (id, po_no, vendor_id, status, created_by, approved_at, approved_by, issued_at, issued_by)
values
  ('99990000-0000-0000-0000-000000000001','po-26-09-11_01','11110000-0000-0000-0000-000000000001',
   'ISSUED','cccccccc-0000-0000-0000-00000000a11d', now(),'cccccccc-0000-0000-0000-00000000ce00',
   now(),'cccccccc-0000-0000-0000-00000000a11d');

insert into ops_procure.po_lines (id, po_id, line_no, description, qty, uom, unit_price, line_total) values
  ('aaaa0000-0000-0000-0000-000000000001','99990000-0000-0000-0000-000000000001',1,'Meja jati 180cm',10,'unit',1000000,10000000);

insert into ops_procure.po_schedule (po_id, term_no, kind, basis, basis_value, due_rule) values
  ('99990000-0000-0000-0000-000000000001','po-26-09-11_01-M01','DP','percent',30,'on_issue'),
  ('99990000-0000-0000-0000-000000000001','po-26-09-11_01-M02','FINAL','percent',70,'on_delivery');

-- The vendor sent twelve where ten were ordered.
insert into ops_procure.receipts (receipt_no, po_line_id, qty_received, condition, received_by, qc_by, status, confirmed_by, confirmed_at) values
  ('rcp-po-1','aaaa0000-0000-0000-0000-000000000001',12,'GOOD',
   'cccccccc-0000-0000-0000-00000000a11d','cccccccc-0000-0000-0000-00000000a11d','CONFIRMED',
   'cccccccc-0000-0000-0000-00000000a11d', now());

do $$
declare vr numeric; cr numeric; ovr numeric; cond text; ds text;
begin
  select value_received, over, condition into vr, ovr, cond
    from ops_procure.v_po_line_delivery where po_line_id = 'aaaa0000-0000-0000-0000-000000000001';
  -- Capped at what was ordered. A vendor who ships two more has given us a
  -- credit, not sold us more (D98). Counting the extra would quietly turn an
  -- unasked-for delivery into money they can invoice.
  assert vr = 10000000, format('value received is capped at the order, got %s', vr);
  assert ovr = 2, format('two over, got %s', ovr);
  assert cond = 'OVER', format('the line says so on its face, got %s', cond);

  select credit, delivery_state into cr, ds
    from ops_procure.v_po_status where po_no = 'po-26-09-11_01';
  assert cr = 2000000, format('the credit is priced and kept visible, got %s', cr);
  assert ds = 'COMPLETE', format('everything ordered arrived, got %s', ds);
end $$;

-- Nothing paid yet. A deposit is earned when the order is issued — that is what
-- a deposit is — and the rest as goods arrive (D99).
do $$
declare b numeric; ps text;
begin
  select billable_now, payment_state into b, ps
    from ops_procure.v_po_journey where po_no = 'po-26-09-11_01';
  -- 10.000.000 × 30%  +  10.000.000 × 70%  −  0
  assert b = 10000000, format('issued and fully delivered: all of it is billable, got %s', b);
  assert ps = 'UNPAID', format('and none of it is paid, got %s', ps);
end $$;

/* ═══════════════════════════════════════════════════════════════════════════
   DERIVATION 6 — BLOCKED, and which term is holding it up (D128)
   The guard the old system never had, and the reason somebody once paid a final
   instalment on an order whose deposit had never gone out.
   ═════════════════════════════════════════════════════════════════════════ */
do $$
declare s1 text; s2 text; bb text; a1 numeric;
begin
  select amount, state into a1, s1
    from ops_procure.v_po_terms where term_no = 'po-26-09-11_01-M01';
  assert a1 = 3000000, format('30%% of 10 juta, got %s', a1);
  assert s1 = 'PAYABLE', format('the order is issued, so the deposit is payable, got %s', s1);

  select state, blocked_by into s2, bb
    from ops_procure.v_po_terms where term_no = 'po-26-09-11_01-M02';
  assert s2 = 'BLOCKED',
         format('everything has arrived, but the deposit was never paid — got %s', s2);
  assert bb = 'po-26-09-11_01-M01',
         format('and the view names the term holding it up, got %s', bb);
end $$;

/* ═══════════════════════════════════════════════════════════════════════════
   REFUSALS — the access model, in anger
   ═════════════════════════════════════════════════════════════════════════ */
set local role authenticated;

-- Andi holds `procurement.admin`: the highest grant this module has.
set local request.jwt.claim.sub = 'cccccccc-0000-0000-0000-00000000a11d';

do $$ begin
  assert ops_core.has_permission('procurement.create'), 'admin can create';
  assert ops_core.has_permission('procurement.update'), 'admin can edit';
  assert not ops_core.has_authority('approve_goods'),
         'an authority is never implied by a module level, however high (D24)';
end $$;

-- **The refusal this whole access model was built for.** He can create every
-- line on the board and edit them all. He cannot approve one. Approving goods
-- belongs to the CEO (D19), and in `john-lau` this was a role string the screen
-- could read and the bridge disagreed with.
do $$
begin
  begin
    insert into ops_procure.pr_approvals (line_id, step, approved, approved_amount, recorded_by_email)
    values ('66660000-0000-0000-0000-000000000005','GOODS',true,400000,'andi@talaliving.com');
    assert false, 'procurement.admin must not be able to approve goods';
  exception when insufficient_privilege then
    null;  -- correct
  end;
end $$;

-- Nor settle a line short: writing off a difference is a money decision.
do $$
begin
  begin
    insert into ops_procure.line_settlements (line_id, shortfall, reason, decided_by)
    values ('66660000-0000-0000-0000-000000000007',180000,'sudah cukup',
            'cccccccc-0000-0000-0000-00000000a11d');
    assert false, 'settling short must need approve_funds';
  exception when insufficient_privilege then
    null;  -- correct
  end;
end $$;

-- Nothing is deleted. No DELETE policy and no DELETE grant, anywhere in the
-- schema — a correction is a supersession, a VOID or a stamp (A2, A5).
do $$
begin
  begin
    delete from ops_procure.pr_lines where id = '66660000-0000-0000-0000-000000000009';
    assert false, 'nothing in this system is deleted';
  exception when insufficient_privilege then
    null;  -- correct
  end;
end $$;

-- The CEO approves goods. He does not approve funds — they are different
-- decisions and the people holding them will not always be the same (D19, D24).
set local request.jwt.claim.sub = 'cccccccc-0000-0000-0000-00000000ce00';

do $$
begin
  insert into ops_procure.pr_approvals (line_id, step, approved, approved_amount, recorded_by_email)
  values ('66660000-0000-0000-0000-000000000009','GOODS',true,200000,'evin@talaliving.com');

  begin
    insert into ops_procure.pr_approvals (line_id, step, approved, approved_amount, recorded_by_email)
    values ('66660000-0000-0000-0000-000000000009','FUNDS',true,200000,'evin@talaliving.com');
    assert false, 'approve_goods is not approve_funds';
  exception when insufficient_privilege then
    null;  -- correct
  end;
end $$;

-- And a person with no procurement grant at all sees no lines — not an empty
-- board, which would be a lie, but nothing, because RLS answered first.
set local request.jwt.claim.sub = 'cccccccc-0000-0000-0000-00000000f11a';
do $$
declare n int;
begin
  select count(*) into n from ops_procure.v_pr_line;
  assert n > 0, 'Finance holds procurement.read and should see the board';
end $$;

rollback;
