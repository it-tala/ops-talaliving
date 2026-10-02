-- 208_acct_subscriptions.sql — daftar langganan, pembayarannya, dan kurs rencana.
--
-- Yang dibuktikan:
--   • langganan bulanan USD (tetap), tahunan dan dua-tahunan (rupiah), dan
--     pay-as-you-go tersimpan; nomornya SUB-nnnn berurut;
--   • pembayaran mencatat rupiah yang keluar, dan kurs yang sebenarnya
--     DIHITUNG (rupiah ÷ dolar), tidak diketik; mencatat bulan yang sama lagi
--     mengoreksi, bukan menambah;
--   • kurs rencana (19.000 bawaan) hanya bisa diubah oleh yang punya
--     `accounting.plan_cash` (admin);
--   • penolakannya: bukan accounting, siklus/jenis/mata uang/jumlah yang salah,
--     berakhir sebelum mulai, rekening yang tidak ada, dolar pada langganan
--     rupiah, periode yang salah, menghapus pembayaran yang tidak ada;
--   • orang tanpa akses accounting tidak melihat satu baris pun (RLS).

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-000000020801','acc-write208@talaliving.com','{"full_name":"Acc Write"}'),
  ('ffffffff-0000-0000-0000-000000020802','acc-admin208@talaliving.com','{"full_name":"Acc Admin"}'),
  ('ffffffff-0000-0000-0000-000000020803','hrd208@talaliving.com','{"full_name":"HRD"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-000000020801','accounting','write'),
  ('ffffffff-0000-0000-0000-000000020802','accounting','admin'),
  ('ffffffff-0000-0000-0000-000000020803','hrd','admin');

set local role authenticated;

do $$
declare r jsonb; v_id uuid; v_yearly uuid; v_idr uuid; n int; v_rate numeric; v_first int;
begin
  set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000020801';

  /* ── disimpan ──────────────────────────────────────────────────────── */
  r := ops_acct.save_subscription('Supabase', 'monthly', 'fixed', 'USD', 25, '2026-09-03',
                                  'BCA 271', 'it@talaliving.com', 'Supabase');
  assert r ->> 'outcome' = 'ok', format('monthly USD: %s', r);
  v_id := (r -> 'data' ->> 'id')::uuid;
  -- A sequence is not rolled back with the transaction, so the number is
  -- asserted by shape and order, never as SUB-0001.
  assert r -> 'data' ->> 'sub_no' ~ '^SUB-\d{4,}$', format('number shape: %s', r);
  v_first := (substring(r -> 'data' ->> 'sub_no' from 5))::int;

  r := ops_acct.save_subscription('Domain talaliving.com', 'yearly', 'fixed', 'IDR', 250000, '2026-11-15');
  assert r ->> 'outcome' = 'ok', format('yearly IDR: %s', r);
  v_yearly := (r -> 'data' ->> 'id')::uuid;
  assert (substring(r -> 'data' ->> 'sub_no' from 5))::int = v_first + 1, format('second number follows: %s', r);

  r := ops_acct.save_subscription('Google Cloud', 'biennial', 'payg', 'IDR', 1900000, '2026-10-02');
  assert r ->> 'outcome' = 'ok', format('biennial payg: %s', r);
  v_idr := (r -> 'data' ->> 'id')::uuid;

  select count(*) into n from ops_acct.subscriptions;
  assert n = 3, format('three rows, got %s', n);
  assert (select account_id from ops_acct.subscriptions where id = v_id)
       = (select id from ops_acct.accounts where code = 'BCA 271'), 'payment account stored';

  /* ── diubah, bukan digandakan ──────────────────────────────────────── */
  r := ops_acct.save_subscription('Supabase Pro', 'monthly', 'fixed', 'USD', 27.5, '2026-09-03',
                                  p_id => v_id);
  assert r ->> 'outcome' = 'ok', format('update: %s', r);
  assert (select amount from ops_acct.subscriptions where id = v_id) = 27.5, 'amount updated';
  assert (select count(*) from ops_acct.subscriptions) = 3, 'update adds no row';

  /* ── pembayaran: kurs dihitung ─────────────────────────────────────── */
  r := ops_acct.record_subscription_payment(v_id, '2026-09', '2026-09-03', 461790, 25);
  assert r ->> 'outcome' = 'ok', format('pay: %s', r);
  select fx_rate into v_rate from ops_acct.subscription_payments
   where subscription_id = v_id and period = '2026-09';
  assert v_rate = 18471.60, format('rate = idr / usd, got %s', v_rate);

  r := ops_acct.record_subscription_payment(v_id, '2026-09', '2026-09-04', 470000, 25);
  assert r ->> 'outcome' = 'ok', format('correct: %s', r);
  select count(*) into n from ops_acct.subscription_payments where subscription_id = v_id and period = '2026-09';
  assert n = 1, format('the same month corrects, not adds: %s rows', n);
  assert (select amount_idr from ops_acct.subscription_payments where subscription_id = v_id) = 470000,
         'corrected figure kept';

  r := ops_acct.record_subscription_payment(v_yearly, '2026-11', '2026-11-15', 250000);
  assert r ->> 'outcome' = 'ok', format('IDR pay: %s', r);
  assert (select fx_rate from ops_acct.subscription_payments where subscription_id = v_yearly) is null,
         'a rupiah payment has no rate';

  r := ops_acct.remove_subscription_payment(v_yearly, '2026-11');
  assert r ->> 'outcome' = 'ok', format('remove: %s', r);
  r := ops_acct.remove_subscription_payment(v_yearly, '2026-11');
  assert r -> 'error' ->> 'code' is not null and r ->> 'outcome' <> 'ok', format('remove twice: %s', r);

  /* ── penolakan ─────────────────────────────────────────────────────── */
  r := ops_acct.save_subscription('X', 'weekly', 'fixed', 'USD', 1, '2026-01-01');
  assert r -> 'error' ->> 'code' = 'cycle_invalid', format('cycle: %s', r);
  r := ops_acct.save_subscription('X', 'monthly', 'sometimes', 'USD', 1, '2026-01-01');
  assert r -> 'error' ->> 'code' = 'amount_kind_invalid', format('kind: %s', r);
  r := ops_acct.save_subscription('X', 'monthly', 'fixed', 'EUR', 1, '2026-01-01');
  assert r -> 'error' ->> 'code' = 'currency_invalid', format('currency: %s', r);
  r := ops_acct.save_subscription('X', 'monthly', 'fixed', 'USD', 0, '2026-01-01');
  assert r -> 'error' ->> 'code' = 'amount_required', format('amount: %s', r);
  r := ops_acct.save_subscription('  ', 'monthly', 'fixed', 'USD', 1, '2026-01-01');
  assert r -> 'error' ->> 'code' = 'name_required', format('name: %s', r);
  r := ops_acct.save_subscription('X', 'monthly', 'fixed', 'USD', 1, '2026-02-01', p_ends_on => '2026-01-01');
  assert r -> 'error' ->> 'code' = 'end_before_start', format('dates: %s', r);
  r := ops_acct.save_subscription('X', 'monthly', 'fixed', 'USD', 1, '2026-01-01', 'NO SUCH');
  assert r -> 'error' ->> 'code' = 'no_such_account', format('account: %s', r);
  r := ops_acct.record_subscription_payment(v_yearly, '2026-11', '2026-11-15', 250000, 14);
  assert r -> 'error' ->> 'code' = 'usd_on_idr', format('dollars on rupiah: %s', r);
  r := ops_acct.record_subscription_payment(v_id, '2026-13', '2026-11-15', 250000, 14);
  assert r -> 'error' ->> 'code' = 'period_invalid', format('period: %s', r);
  r := ops_acct.record_subscription_payment(v_id, '2026-10', '2026-10-15', 0, 14);
  assert r -> 'error' ->> 'code' = 'amount_required', format('idr: %s', r);

  /* ── jeda / berhenti ───────────────────────────────────────────────── */
  r := ops_acct.set_subscription_status(v_idr, 'paused');
  assert r ->> 'outcome' = 'ok' and (select status from ops_acct.subscriptions where id = v_idr) = 'paused',
         format('pause: %s', r);
  r := ops_acct.set_subscription_status(v_idr, 'forever');
  assert r -> 'error' ->> 'code' = 'status_invalid', format('status: %s', r);

  /* ── kurs rencana: accounting.write tidak boleh, admin boleh ───────── */
  assert (select usd_idr from ops_acct.subscription_settings) = 19000, 'default rate is 19.000';
  r := ops_acct.set_subscription_fx(18500);
  assert r -> 'error' ->> 'code' = 'not_permitted', format('write may not set the rate: %s', r);

  set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000020802';
  r := ops_acct.set_subscription_fx(18500);
  assert r ->> 'outcome' = 'ok', format('admin sets the rate: %s', r);
  assert (select usd_idr from ops_acct.subscription_settings) = 18500, 'rate stored';
  r := ops_acct.set_subscription_fx(0);
  assert r -> 'error' ->> 'code' = 'rate_invalid', format('rate: %s', r);

  /* ── bukan accounting ──────────────────────────────────────────────── */
  set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000020803';
  r := ops_acct.save_subscription('Y', 'monthly', 'fixed', 'USD', 1, '2026-01-01');
  assert r -> 'error' ->> 'code' = 'not_permitted', format('hrd may not save: %s', r);
  r := ops_acct.record_subscription_payment(v_id, '2026-10', '2026-10-03', 460000, 25);
  assert r -> 'error' ->> 'code' = 'not_permitted', format('hrd may not pay: %s', r);
  assert (select count(*) from ops_acct.subscriptions) = 0, 'RLS: hrd sees no subscription';
  assert (select count(*) from ops_acct.subscription_payments) = 0, 'RLS: hrd sees no payment';
  assert (select count(*) from ops_acct.subscription_settings) = 0, 'RLS: hrd sees no rate';
end $$;

rollback;
