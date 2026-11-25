-- acct — a single row on a non-rupiah account must say its amount is in that
-- currency (0300, D458). The 18/11 mistake: a USD → IDR conversion booked
-- from Verifikasi as two plain rows, 081 OUT "109.374.000" and 064 IN. Now
-- the 081 row is refused and names the road (Catat konversi); a transfer leg
-- and a conversion are unchanged; a rupiah account books as before.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-00000000a300','lead300@talaliving.com','{"full_name":"Lead Funds"}');
insert into ops_core.user_authorities (user_id, authority) values
  ('ffffffff-0000-0000-0000-00000000a300','post_ledger'),
  ('ffffffff-0000-0000-0000-00000000a300','resolve_inbox'),
  ('ffffffff-0000-0000-0000-00000000a300','approve_funds');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-00000000a300','accounting','write');
insert into ops_core.attachments (id, storage_path, filename, source, uploaded_by) values
  ('55560000-0000-0000-0000-000000000001','drive-300-1','advice-6000.png','chat','ffffffff-0000-0000-0000-00000000a300'),
  ('55560000-0000-0000-0000-000000000002','drive-300-2','advice-2000.png','chat','ffffffff-0000-0000-0000-00000000a300');
insert into ops_acct.evidence_inbox (ref_id, origin, status, attachment_id, reported_by, extracted) values
  ('m300~advice','chat','PENDING','55560000-0000-0000-0000-000000000001','ffffffff-0000-0000-0000-00000000a300',
   '{"doc_type":"Payment Proof","amount_idr":109374000,"caption":"CHANGE USD 6000 @ 18229"}'::jsonb),
  ('m301~advice','chat','PENDING','55560000-0000-0000-0000-000000000002','ffffffff-0000-0000-0000-00000000a300',
   '{"doc_type":"Payment Proof","amount_idr":36056000,"caption":"USD=IDR1 @2000 @ 18028"}'::jsonb);

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-00000000a300';

/* ── REFUSAL: the 18/11 mistake, from the inbox ────────────────────────── */
do $$
declare r jsonb;
begin
  r := ops_acct.book_evidence('m300~advice','BCA USD 081','OUT', 109374000, 'CASHFLOW',
        'CHANGE USD 6000 USD - IDR 1', '2026-11-18');
  assert r -> 'error' ->> 'code' = 'foreign_account', format('a rupiah amount on the USD account, got %s', r);
  assert r -> 'error' ->> 'message' like '%Record conversion%', format('the refusal names the road, got %s', r);
  assert r -> 'error' -> 'detail' ->> 'currency' = 'USD' or r::text like '%"currency": "USD"%', format('got %s', r);
  assert (select status from ops_acct.evidence_inbox where ref_id = 'm300~advice') = 'PENDING', 'the document waits';
  assert not exists (select 1 from ops_acct.transactions t join ops_acct.accounts a on a.id = t.account_id
                      where a.code = 'BCA USD 081'), 'nothing written on 081';
end $$;

/* ── REFUSAL: the form's own post, no currency stated or a different one ─ */
do $$
declare r jsonb; docs jsonb := jsonb_build_array(jsonb_build_object(
  'attachment_id','55560000-0000-0000-0000-000000000002','kind','transfer_proof'));
begin
  r := ops_acct.post_transaction('BCA USD 081','OUT', 6000, 'CASHFLOW','USD out', docs, '2026-11-18');
  assert r -> 'error' ->> 'code' = 'foreign_account', format('no currency stated, got %s', r);
  r := ops_acct.post_transaction('BCA USD 081','OUT', 6000, 'CASHFLOW','USD out', docs, '2026-11-18',
        p_billed_currency => 'SGD', p_billed_amount => 6000);
  assert r -> 'error' ->> 'code' = 'foreign_account', format('another currency, got %s', r);
  r := ops_acct.post_transaction('BCA USD 081','OUT', 109374000, 'CASHFLOW','USD out', docs, '2026-11-18',
        p_billed_currency => 'USD', p_billed_amount => 6000);
  assert r -> 'error' ->> 'code' = 'foreign_account', format('the amount is not the dollars stated, got %s', r);

  -- Stated: a row of its own in dollars is written.
  r := ops_acct.post_transaction('BCA USD 081','IN', 8000.87, 'CASHFLOW','LIANLIAN WITHDRAWAL', docs, '2026-10-30',
        p_billed_currency => 'usd', p_billed_amount => 8000.87);
  assert ops_core.said_ok(r), format('a stated USD row, got %s', r);
end $$;

/* ── unchanged: a rupiah account, the transfer legs, the conversion ────── */
do $$
declare r jsonb; o record; i record; docs jsonb := jsonb_build_array(jsonb_build_object(
  'attachment_id','55560000-0000-0000-0000-000000000002','kind','transfer_proof'));
begin
  r := ops_acct.post_transaction('BCA 064','IN', 109374000, 'CASHFLOW','IDR in', docs, '2026-11-18');
  assert ops_core.said_ok(r), format('a rupiah account books as before, got %s', r);

  r := ops_acct.post_transfer('BCA USD 081','BCA 064', 36056000, docs, '2026-10-22',
        p_billed_currency => 'USD', p_billed_amount => 2000);
  assert ops_core.said_ok(r), format('a transfer leg on 081 is settled by post_transfer, got %s', r);
  select * into o from ops_acct.transactions where trx_no = r -> 'data' ->> 'out_trx_no';
  assert o.amount_idr = 2000, format('the 081 leg is in dollars, got %s', o.amount_idr);

  r := ops_acct.record_conversion('2026-11-18', 10211.01, 6000, 109374000, 18229, null, 'm300~advice');
  assert ops_core.said_ok(r), format('a conversion from the inbox, got %s', r);
  select * into o from ops_acct.transactions where trx_no = r -> 'data' ->> 'out_trx_no';
  select * into i from ops_acct.transactions where trx_no = r -> 'data' ->> 'in_trx_no';
  assert o.amount_idr = 6000 and i.amount_idr = 109374000, format('got %s / %s', o.amount_idr, i.amount_idr);
end $$;

rollback;
