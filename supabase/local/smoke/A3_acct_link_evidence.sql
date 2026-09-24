-- acct — one proof, several ledger rows, one act (0158).
--
-- Owner 2026-09-24: five ledger rows came from one nota, and the payment for
-- it is one transfer proof. It must reach all five without being uploaded
-- five times.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-0000000000d1','linker@talaliving.com','{"full_name":"Link Keeper"}'),
  ('ffffffff-0000-0000-0000-0000000000d2','reader@talaliving.com','{"full_name":"Only Reads"}');
insert into ops_core.user_authorities (user_id, authority) values
  ('ffffffff-0000-0000-0000-0000000000d1','post_ledger'),
  ('ffffffff-0000-0000-0000-0000000000d1','resolve_inbox');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-0000000000d1','accounting','write'),
  ('ffffffff-0000-0000-0000-0000000000d2','accounting','write');
insert into ops_procure.vendors (id, code, name) values
  ('cccc0000-0000-0000-0000-00000000d101','V-8201','TOKO LINK');

-- The transfer proof, filed as two slots of one photo (the transfer and its fee).
insert into ops_core.attachments (id, url, filename, source, uploaded_by) values
  ('aaaa0000-0000-0000-0000-00000000d101','https://drive.example/file/d/PROOF-1','tf.jpg','chat',
   'ffffffff-0000-0000-0000-0000000000d1'),
  ('aaaa0000-0000-0000-0000-00000000d102','https://drive.example/file/d/PROOF-1','tf.jpg','chat',
   'ffffffff-0000-0000-0000-0000000000d1'),
  -- The nota the five rows were booked from.
  ('aaaa0000-0000-0000-0000-00000000d103','https://drive.example/file/d/NOTA-1','nota.jpg','chat',
   'ffffffff-0000-0000-0000-0000000000d1');
insert into ops_acct.evidence_inbox (ref_id, origin, status, attachment_id, reported_by, extracted) values
  ('ev-d1~x0','chat','PENDING','aaaa0000-0000-0000-0000-00000000d101',
   'ffffffff-0000-0000-0000-0000000000d1','{"amount_idr":300000,"doc_type":"Payment Proof"}'::jsonb),
  ('ev-d1~x1','chat','PENDING','aaaa0000-0000-0000-0000-00000000d102',
   'ffffffff-0000-0000-0000-0000000000d1','{"amount_idr":2500,"doc_type":"Payment Proof"}'::jsonb);

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-0000000000d1';

-- Five ledger rows of one nota, booked the old way: one row per item.
create temp table five (trx_no text) on commit drop;
grant all on five to authenticated;
do $$
declare res jsonb; i int;
begin
  for i in 1..5 loop
    res := ops_acct.post_transaction(
      p_account_code => 'PETTY CASH', p_direction => 'OUT', p_amount => 60000,
      p_type_code => 'SUPPLIERS', p_description => 'ITEM ' || i, p_documents => '[{"attachment_id":"aaaa0000-0000-0000-0000-00000000d103","kind":"nota"}]'::jsonb,
      p_trx_date => '2026-09-15', p_vendor_code => 'V-8201',
      p_lines => jsonb_build_array(jsonb_build_object('description','ITEM ' || i,
                   'qty',1,'uom','pcs','unit_price',60000,'amount',60000)));
    assert res ->> 'outcome' = 'ok', 'Could not set up row ' || i || ': ' || res::text;
    insert into five values (res -> 'data' ->> 'trx_no');
  end loop;
end $$;

-- ── 1. Nobody without resolve_inbox ────────────────────────────────────
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-0000000000d2';
do $$
declare res jsonb;
begin
  res := ops_acct.link_evidence(array['ev-d1~x0'], (select array_agg(trx_no) from five));
  assert res -> 'error' ->> 'code' = 'authority_required',
    'Somebody without resolve_inbox linked a document: ' || res::text;
end $$;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-0000000000d1';

-- ── 2. A row that does not exist is named, and nothing is written ──────
do $$
declare res jsonb; n int;
begin
  res := ops_acct.link_evidence(array['ev-d1~x0','ev-d1~x1'],
    (select array_agg(trx_no) from five) || array['trx-00-00-00_999']);
  assert res -> 'error' ->> 'code' = 'no_such_transaction',
    'A missing ledger row was not refused: ' || res::text;
  assert res -> 'error' ->> 'message' like '%trx-00-00-00_999%',
    'The refusal must name the row that does not exist: ' || res::text;
  select count(*) into n from ops_core.attachment_links
   where attachment_id = 'aaaa0000-0000-0000-0000-00000000d101';
  assert n = 0, 'A refused link left ' || n || ' link(s) behind.';
end $$;

-- ── 3. One act: five rows proven, both inbox rows closed ───────────────
do $$
declare res jsonb; n int;
begin
  res := ops_acct.link_evidence(array['ev-d1~x0','ev-d1~x1'],
    (select array_agg(trx_no order by trx_no) from five));
  assert res ->> 'outcome' = 'ok', 'Linking one proof to five rows was refused: ' || res::text;
  assert (res -> 'data' ->> 'rows')::int = 5, 'Expected 5 rows in the answer: ' || res::text;
  assert (res -> 'data' ->> 'rows_total')::numeric = 300000,
    'The answer must carry what the rows add up to: ' || res::text;

  select count(*) into n from ops_core.attachment_links l
   where l.attachment_id = 'aaaa0000-0000-0000-0000-00000000d101'
     and l.entity = 'transaction' and l.entity_no in (select trx_no from five)
     and l.kind = 'transfer_proof';
  assert n = 5, 'Expected the proof on all 5 rows as a transfer proof, saw ' || n;

  select count(*) into n from ops_acct.evidence_inbox
   where ref_id like 'ev-d1~%' and status = 'ATTACHED'
     and produced_trx_no in (select trx_no from five);
  assert n = 2, 'Not every row of the photo was closed against the rows: ' || n;
end $$;

-- ── 4. And not twice ───────────────────────────────────────────────────
do $$
declare res jsonb;
begin
  res := ops_acct.link_evidence(array['ev-d1~x0'], (select array_agg(trx_no) from five));
  assert res -> 'error' ->> 'code' = 'already_resolved',
    'The same document was linked a second time: ' || res::text;
end $$;

reset role;
rollback;
