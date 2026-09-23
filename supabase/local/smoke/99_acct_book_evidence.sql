-- acct — one nota, one confirmation, several lines (0118).
--
-- ── What is being proved, and why row-by-row was the bug ────────────────
--
-- Two items sat at SEGERA in john-lau's backlog — *uang bisa tercatat salah,
-- atau sesuatu hilang tanpa ada yang tahu* — and they are one mistake seen
-- twice. §21: a single transfer proof became four queue rows, hand-patched
-- twice, and confirming all four books the same money four times. §14: a nota
-- was read as three items of five and no layer could tell.
--
-- Both are about the **unit of review**. This file asserts the unit is now the
-- document: one confirmation writes one ledger row with N lines and files the
-- photo against it, or it writes nothing at all.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-0000000000be','book@talaliving.com','{"full_name":"Book Keeper"}'),
  ('ffffffff-0000-0000-0000-0000000000bf','halfway@talaliving.com','{"full_name":"Half Way"}');
insert into ops_core.user_authorities (user_id, authority) values
  ('ffffffff-0000-0000-0000-0000000000be','post_ledger'),
  ('ffffffff-0000-0000-0000-0000000000be','resolve_inbox'),
  -- Holds one of the two. The seam does both things, so it must refuse.
  ('ffffffff-0000-0000-0000-0000000000bf','post_ledger');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-0000000000be','accounting','write'),
  ('ffffffff-0000-0000-0000-0000000000bf','accounting','write');

insert into ops_procure.vendors (id, code, name) values
  ('cccc0000-0000-0000-0000-00000000be01','V-8001','TOKO NOTA');

-- Two documents, filed the way the capture worker files them.
insert into ops_core.attachments (id, storage_path, filename, source, uploaded_by) values
  ('aaaa0000-0000-0000-0000-00000000be01','drive-be-1','nota-paku.jpg','chat',
   'ffffffff-0000-0000-0000-0000000000be'),
  ('aaaa0000-0000-0000-0000-00000000be02','drive-be-2','nota-cat.jpg','chat',
   'ffffffff-0000-0000-0000-0000000000be');
insert into ops_acct.evidence_inbox (ref_id, origin, status, attachment_id, reported_by, extracted) values
  ('inb-be-1','chat','PENDING','aaaa0000-0000-0000-0000-00000000be01',
   'ffffffff-0000-0000-0000-0000000000be','{"doc_kind":"nota"}'::jsonb),
  ('inb-be-2','chat','PENDING','aaaa0000-0000-0000-0000-00000000be02',
   'ffffffff-0000-0000-0000-0000000000be','{"doc_kind":"nota"}'::jsonb);

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-0000000000be';

-- ── 1. §14's net: a nota read as 3 of 5 cannot be booked as whole ───────
--
-- The document says 500.000; the lines read add up to 300.000. Row by row
-- this passes — each line is individually plausible. Per document it cannot,
-- and the refusal names both figures, because *they disagree* is not
-- actionable and *300.000 against 500.000* is.
do $$
declare res jsonb;
begin
  res := ops_acct.book_evidence(
    'inb-be-1','PETTY CASH','OUT', 500000, 'SUPPLIERS','BELI PAKU DAN CAT',
    '2026-09-23', 'V-8001', null,
    '[{"description":"PAKU 3 INCI","qty":10,"unit_price":20000,"amount":200000},
      {"description":"AMPLAS","qty":5,"unit_price":20000,"amount":100000}]'::jsonb);

  assert res ->> 'outcome' = 'refused' or res -> 'error' ->> 'code' = 'lines_do_not_add_up',
    'A nota read as part of itself was booked as though whole: ' || res::text;
  assert res -> 'error' ->> 'code' = 'lines_do_not_add_up',
    'Refused, but not for the reason that helps: ' || res::text;
  assert res -> 'error' ->> 'message' like '%500.000%'
     and res -> 'error' ->> 'message' like '%300.000%',
    'The refusal must carry BOTH figures — a person holding the photo fixes it '
    || 'from the numbers, not from the word mismatch: ' || (res -> 'error' ->> 'message');
end $$;

-- Nothing was written by the refusal.
do $$
declare n int;
begin
  select count(*) into n from ops_acct.transactions where source_ref = 'inbox:inb-be-1';
  assert n = 0, 'A refused booking left ' || n || ' ledger row(s) behind.';
  select count(*) into n from ops_acct.evidence_inbox
    where ref_id = 'inb-be-1' and status = 'PENDING';
  assert n = 1, 'A refused booking moved the document out of PENDING.';
end $$;

-- ── 2. The whole nota, in one act ──────────────────────────────────────
do $$
declare res jsonb; trx text; n int;
begin
  res := ops_acct.book_evidence(
    'inb-be-1','PETTY CASH','OUT', 500000, 'SUPPLIERS','BELI PAKU DAN CAT',
    '2026-09-23', 'V-8001', null,
    '[{"description":"PAKU 3 INCI","qty":10,"uom":"pcs","unit_price":20000,"amount":200000},
      {"description":"AMPLAS","qty":5,"uom":"pcs","unit_price":20000,"amount":100000},
      {"description":"CAT TEMBOK","qty":2,"uom":"ltr","unit_price":100000,"amount":200000}]'::jsonb);

  assert res ->> 'outcome' = 'ok', 'The whole nota was refused: ' || res::text;
  trx := res -> 'data' ->> 'trx_no';
  assert trx is not null, 'Booked, but the answer does not say which ledger row.';

  -- One header, three lines — the shape the owner described.
  select count(*) into n from ops_acct.transaction_lines l
    join ops_acct.transactions t on t.id = l.trx_id where t.trx_no = trx;
  assert n = 3, 'Expected 3 lines on one transaction, saw ' || n;

  -- And they add up, which is now true by construction rather than by luck.
  select count(*) into n from ops_acct.transactions t
   where t.trx_no = trx
     and t.amount_idr = (select sum(l.amount) from ops_acct.transaction_lines l
                          where l.trx_id = t.id);
  assert n = 1, 'The booked row does not agree with its own lines.';

  -- The photo is filed against the row, in the same act. A document booked
  -- but not attached is evidence nobody can find from the ledger.
  select count(*) into n from ops_core.attachment_links
   where entity = 'transaction' and entity_no = trx
     and attachment_id = 'aaaa0000-0000-0000-0000-00000000be01';
  assert n = 1, 'The document was not filed against the row it produced.';

  -- And the inbox says where it went.
  select count(*) into n from ops_acct.evidence_inbox
   where ref_id = 'inb-be-1' and status = 'CONFIRMED' and produced_trx_no = trx;
  assert n = 1, 'The inbox row does not point at the ledger row it became.';
end $$;

-- ── 3. §21: the same document cannot be booked twice ───────────────────
--
-- The bug was four queue rows from one proof; confirm all four and the money
-- is booked four times. Per document that shape cannot arise — but a second
-- confirmation is still a thing two people can do from two screens, so it is
-- refused rather than left to chance.
do $$
declare res jsonb; n int;
begin
  res := ops_acct.book_evidence(
    'inb-be-1','PETTY CASH','OUT', 500000, 'SUPPLIERS','BELI PAKU DAN CAT',
    '2026-09-23', 'V-8001', null,
    '[{"description":"PAKU 3 INCI","qty":10,"unit_price":20000,"amount":500000}]'::jsonb);

  assert res -> 'error' ->> 'code' = 'already_resolved',
    'A document was booked a second time: ' || res::text;

  select count(*) into n from ops_acct.transactions where source_ref = 'inbox:inb-be-1';
  assert n = 1, 'The same document produced ' || n || ' ledger rows.';
end $$;

-- ── 4. A document with no lines at all is still bookable ───────────────
--
-- Not every payment is itemised — a bank charge is one number. The sum check
-- applies only when lines are given, or this door would refuse the simplest
-- thing it does.
do $$
declare res jsonb;
begin
  res := ops_acct.book_evidence(
    'inb-be-2','PETTY CASH','OUT', 2500, 'BANK CHARGES','BIAYA ADMIN TRANSFER',
    '2026-09-23', null, null, '[]'::jsonb);
  assert res ->> 'outcome' = 'ok', 'An unitemised document was refused: ' || res::text;
end $$;

reset role;

-- ── 5. It does both things, so it needs both authorities ───────────────
set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-0000000000bf';
do $$
declare res jsonb;
begin
  res := ops_acct.book_evidence(
    'inb-be-2','PETTY CASH','OUT', 2500, 'BANK CHARGES','BIAYA ADMIN', '2026-09-23');
  assert res -> 'error' ->> 'code' = 'authority_required',
    'Somebody holding only post_ledger resolved an inbox document: ' || res::text;
  assert res -> 'error' -> 'detail' ->> 'required' = 'resolve_inbox',
    'The refusal must name WHICH authority is missing, or it is a dead end: ' || res::text;
end $$;
reset role;

rollback;
