-- acct — one photo filed as several inbox rows, booked as one document (0157).
--
-- The capture worker files one inbox row per slot the extractor read, so a
-- transfer proof with its admin fee arrives as `<event>~x0` and `<event>~x1`,
-- two attachment rows pointing at the same file. Owner 2026-09-24: those are
-- one document with two lines, approved once.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-0000000000c1','group@talaliving.com','{"full_name":"Group Keeper"}');
insert into ops_core.user_authorities (user_id, authority) values
  ('ffffffff-0000-0000-0000-0000000000c1','post_ledger'),
  ('ffffffff-0000-0000-0000-0000000000c1','resolve_inbox');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-0000000000c1','accounting','write');

insert into ops_procure.vendors (id, code, name) values
  ('cccc0000-0000-0000-0000-00000000c101','V-8101','TOKO GROUP');

-- One photo, filed twice (the transfer and its fee); and a different photo.
insert into ops_core.attachments (id, url, filename, source, uploaded_by) values
  ('aaaa0000-0000-0000-0000-00000000c101','https://drive.example/file/d/PHOTO-1','t1.jpg','chat',
   'ffffffff-0000-0000-0000-0000000000c1'),
  ('aaaa0000-0000-0000-0000-00000000c102','https://drive.example/file/d/PHOTO-1','t1.jpg','chat',
   'ffffffff-0000-0000-0000-0000000000c1'),
  ('aaaa0000-0000-0000-0000-00000000c103','https://drive.example/file/d/PHOTO-2','t2.jpg','chat',
   'ffffffff-0000-0000-0000-0000000000c1');
insert into ops_acct.evidence_inbox (ref_id, origin, status, attachment_id, reported_by, extracted) values
  ('ev-c1~x0','chat','PENDING','aaaa0000-0000-0000-0000-00000000c101',
   'ffffffff-0000-0000-0000-0000000000c1','{"amount_idr":700000,"note":"BELANJA"}'::jsonb),
  ('ev-c1~x1','chat','PENDING','aaaa0000-0000-0000-0000-00000000c102',
   'ffffffff-0000-0000-0000-0000000000c1','{"amount_idr":2500,"note":"Transfer admin fee"}'::jsonb),
  ('ev-c2~x0','chat','PENDING','aaaa0000-0000-0000-0000-00000000c103',
   'ffffffff-0000-0000-0000-0000000000c1','{"amount_idr":50000}'::jsonb);

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-0000000000c1';

-- ── 1. Two different photos are not one document ────────────────────────
do $$
declare res jsonb;
begin
  res := ops_acct.book_evidence_group(array['ev-c1~x0','ev-c2~x0'],
    'PETTY CASH','OUT', 750000, 'SUPPLIERS','CAMPUR', '2026-09-24');
  assert res -> 'error' ->> 'code' = 'not_one_document',
    'Two different files were booked as one document: ' || res::text;
end $$;

-- ── 2. The lines still have to add up (book_evidence's rule, not restated) ─
do $$
declare res jsonb; n int;
begin
  res := ops_acct.book_evidence_group(array['ev-c1~x0','ev-c1~x1'],
    'PETTY CASH','OUT', 702500, 'SUPPLIERS','BELANJA', '2026-09-24', 'V-8101', null,
    '[{"description":"BELANJA","qty":1,"unit_price":700000,"amount":700000}]'::jsonb);
  assert res -> 'error' ->> 'code' = 'lines_do_not_add_up',
    'A group whose lines miss the fee was booked: ' || res::text;
  select count(*) into n from ops_acct.evidence_inbox
   where ref_id like 'ev-c1~%' and status = 'PENDING';
  assert n = 2, 'A refused group booking moved rows out of PENDING.';
end $$;

-- ── 3. One booking, two lines, both rows closed against it ─────────────
do $$
declare res jsonb; trx text; n int;
begin
  res := ops_acct.book_evidence_group(array['ev-c1~x0','ev-c1~x1'],
    'PETTY CASH','OUT', 702500, 'SUPPLIERS','BELANJA', '2026-09-24', 'V-8101', null,
    '[{"description":"BELANJA","qty":1,"unit_price":700000,"amount":700000},
      {"description":"Transfer admin fee","qty":1,"unit_price":2500,"amount":2500}]'::jsonb);
  assert res ->> 'outcome' = 'ok', 'The document was refused: ' || res::text;
  trx := res -> 'data' ->> 'trx_no';

  select count(*) into n from ops_acct.transactions where trx_no = trx;
  assert n = 1, 'Expected one ledger row for one photo, saw ' || n;
  select count(*) into n from ops_acct.transaction_lines l
    join ops_acct.transactions t on t.id = l.trx_id where t.trx_no = trx;
  assert n = 2, 'Expected 2 lines, saw ' || n;
  select count(*) into n from ops_acct.evidence_inbox
   where ref_id like 'ev-c1~%' and status = 'CONFIRMED' and produced_trx_no = trx;
  assert n = 2, 'Not every row of the photo points at the booking: ' || n;
  select count(*) into n from ops_core.attachment_links
   where entity = 'transaction' and entity_no = trx;
  assert n = 1, 'The same file was linked ' || n || ' times.';
end $$;

-- ── 4. And not twice ───────────────────────────────────────────────────
do $$
declare res jsonb;
begin
  res := ops_acct.book_evidence_group(array['ev-c1~x0','ev-c1~x1'],
    'PETTY CASH','OUT', 702500, 'SUPPLIERS','BELANJA', '2026-09-24');
  assert res -> 'error' ->> 'code' = 'already_resolved',
    'The same photo was booked a second time: ' || res::text;
end $$;

reset role;
rollback;
