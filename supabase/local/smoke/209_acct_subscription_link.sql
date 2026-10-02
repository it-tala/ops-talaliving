-- 209_acct_subscription_link.sql — satu tagihan langganan dilunasi baris ledger.
--
-- Yang dibuktikan:
--   • menautkan baris ledger mengisi pembayaran dengan angka dan hari milik
--     baris itu (rupiah, tanggal, tanpa dolar/kurs) dan mencatat `trx_no`;
--   • satu baris ledger hanya melunasi satu tagihan: langganan lain DAN
--     komponen kalender sama-sama ditolak (`already_linked`), dan sebaliknya
--     baris yang sudah di komponen kalender ditolak oleh langganan;
--   • pembayaran yang tertaut tidak bisa diketik ulang (`linked_to_ledger`)
--     sampai tautannya dilepas; melepas = menghapus pembayarannya;
--   • penolakannya: baris tidak ada, VOID, uang masuk, periode salah, bukan
--     accounting.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-000000020901','acc-write209@talaliving.com','{"full_name":"Acc Write"}'),
  ('ffffffff-0000-0000-0000-000000020902','hrd209@talaliving.com','{"full_name":"HRD"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-000000020901','accounting','write'),
  ('ffffffff-0000-0000-0000-000000020902','hrd','admin');

insert into ops_acct.transactions (trx_no, trx_date, account_id, direction, amount_idr,
                                   type_code, description, source_ref, posted_by)
select x.no, x.d::date, a.id, x.dir::ops_acct.direction_t, x.amt, 'OFFICE', x.no, x.no,
       'ffffffff-0000-0000-0000-000000020901'
  from ops_acct.accounts a,
       (values ('trx-sub-1','2026-10-03','OUT',461790),
               ('trx-sub-2','2026-10-04','OUT',458549),
               ('trx-sub-in','2026-10-05','IN',100000),
               ('trx-sub-void','2026-10-06','OUT',50000)) as x(no, d, dir, amt)
 where a.code = 'BCA 271';
update ops_acct.transactions set status = 'VOID', void_reason = 'salah catat', void_at = now() where trx_no = 'trx-sub-void';

set local role authenticated;

do $$
declare r jsonb; v_a uuid; v_b uuid; v_comp uuid; p ops_acct.subscription_payments;
begin
  set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000020901';

  v_a := (ops_acct.save_subscription('Supabase', 'monthly', 'fixed', 'USD', 25, '2026-09-03') -> 'data' ->> 'id')::uuid;
  v_b := (ops_acct.save_subscription('Timelines AI', 'monthly', 'fixed', 'USD', 25, '2026-09-04') -> 'data' ->> 'id')::uuid;

  /* ── tertaut: angka milik ledger ───────────────────────────────────── */
  r := ops_acct.link_subscription_payment(v_a, '2026-10', 'trx-sub-1');
  assert r ->> 'outcome' = 'ok', format('link: %s', r);
  select * into p from ops_acct.subscription_payments where subscription_id = v_a and period = '2026-10';
  assert p.trx_no = 'trx-sub-1' and p.amount_idr = 461790 and p.paid_on = '2026-10-03',
         format('the ledger row''s own figures: %s', to_jsonb(p));
  assert p.amount_usd is null and p.fx_rate is null, 'no dollars come from a ledger row';

  /* ── satu baris, satu tagihan ──────────────────────────────────────── */
  r := ops_acct.link_subscription_payment(v_b, '2026-10', 'trx-sub-1');
  assert r -> 'error' ->> 'code' = 'already_linked', format('another subscription: %s', r);

  set local role postgres;
  insert into ops_acct.cash_components (name, amount, frequency, due_day, starts_on, created_by)
  values ('Sewa', 458549, 'monthly', 4, '2026-10', 'ffffffff-0000-0000-0000-000000020901')
  returning id into v_comp;
  set local role authenticated;

  r := ops_acct.link_cash_payment(v_comp, '2026-10', 'trx-sub-1');
  assert r -> 'error' ->> 'code' = 'already_linked', format('a component may not take it: %s', r);

  r := ops_acct.link_cash_payment(v_comp, '2026-10', 'trx-sub-2');
  assert r ->> 'outcome' = 'ok', format('component links its own row: %s', r);
  r := ops_acct.link_subscription_payment(v_b, '2026-10', 'trx-sub-2');
  assert r -> 'error' ->> 'code' = 'already_linked', format('a subscription may not take a component''s: %s', r);

  /* ── tertaut tidak diketik ulang; melepas = menghapus ──────────────── */
  r := ops_acct.record_subscription_payment(v_a, '2026-10', '2026-10-03', 470000, 25);
  assert r -> 'error' ->> 'code' = 'linked_to_ledger', format('retype: %s', r);
  r := ops_acct.remove_subscription_payment(v_a, '2026-10');
  assert r ->> 'outcome' = 'ok', format('unlink: %s', r);
  r := ops_acct.record_subscription_payment(v_a, '2026-10', '2026-10-03', 470000, 25);
  assert r ->> 'outcome' = 'ok', format('typed once unlinked: %s', r);
  assert (select trx_no from ops_acct.subscription_payments where subscription_id = v_a) is null, 'typed payment has no link';

  -- the freed row can be taken by another billing
  r := ops_acct.link_subscription_payment(v_b, '2026-10', 'trx-sub-1');
  assert r ->> 'outcome' = 'ok', format('freed row is takeable: %s', r);

  /* ── penolakan ─────────────────────────────────────────────────────── */
  r := ops_acct.link_subscription_payment(v_a, '2026-11', 'no-such-row');
  assert r ->> 'outcome' <> 'ok' and r -> 'error' ->> 'code' is not null, format('missing row: %s', r);
  r := ops_acct.link_subscription_payment(v_a, '2026-11', 'trx-sub-void');
  assert r -> 'error' ->> 'code' = 'transaction_void', format('void: %s', r);
  r := ops_acct.link_subscription_payment(v_a, '2026-11', 'trx-sub-in');
  assert r -> 'error' ->> 'code' = 'not_a_payment', format('money in: %s', r);
  r := ops_acct.link_subscription_payment(v_a, '2026-13', 'trx-sub-1');
  assert r -> 'error' ->> 'code' = 'period_invalid', format('period: %s', r);

  set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000020902';
  r := ops_acct.link_subscription_payment(v_a, '2026-11', 'trx-sub-1');
  assert r -> 'error' ->> 'code' = 'not_permitted', format('hrd: %s', r);
end $$;

rollback;
