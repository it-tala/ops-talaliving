-- 239_acct_cashflow.sql — leadership's cashflow (0239, D392).
--
-- Yang dibuktikan:
--   • hanya pemegang `approve_funds` yang membaca dan menulis: staf akuntansi
--     dengan `accounting: admin` ditolak di setiap seam dan tidak melihat satu
--     baris pun (RLS) — modul level bukan pintunya;
--   • baris sendiri: tersimpan, diubah tanpa menggandakan, ditolak bila
--     kelompoknya salah sisi, sekali tanpa tanggal, bulanan tanpa tanggal,
--     pertumbuhan di luar −99..100, berakhir sebelum mulai; dihapus = nonaktif;
--   • tagihan bulanan: perubahan cashflow pada komponen kalender tersimpan
--     sebagai satu baris per tagihan (upsert), komponen kalender TIDAK berubah;
--     tagihan yang tidak ada ditolak;
--   • satu minggu: hanya tanggal 1/8/15/22, wajib alasan, menimpa bukan
--     menambah; tagihan yang belum disesuaikan mendapat barisnya sendiri;
--   • realisasi: hanya pada baris sendiri, tidak di masa depan, satu baris
--     ledger untuk satu realisasi;
--   • saldo awal diketik dan dihapus; pengaturan menolak kategori yang tidak ada;
--   • `cashflow_ledger` memberi saldo tiap rekening pada hari itu (termasuk
--     rekening pimpinan) dan baris ledger di jendelanya, tanpa VOID.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-000000023901','lead239@talaliving.com','{"full_name":"Pimpinan"}'),
  ('ffffffff-0000-0000-0000-000000023902','staff239@talaliving.com','{"full_name":"Staf Akuntansi"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-000000023901','accounting','read'),
  ('ffffffff-0000-0000-0000-000000023902','accounting','admin');
insert into ops_core.user_authorities (user_id, authority) values
  ('ffffffff-0000-0000-0000-000000023901','approve_funds'),
  ('ffffffff-0000-0000-0000-000000023902','post_ledger');

insert into ops_acct.cash_components (id, name, direction, amount, frequency, due_day, type_code, starts_on, created_by)
values ('cccccccc-0000-0000-0000-000000023901', 'Sewa gudang', 'OUT', 6500000, 'monthly', 30,
        'SUPPLIERS', '2026-01', 'ffffffff-0000-0000-0000-000000023902');

insert into ops_acct.transactions (trx_no, trx_date, account_id, direction, amount_idr, type_code, description, source_ref, posted_by, status) values
  ('trx-cf-239-001', '2026-08-30', (select id from ops_acct.accounts where code = 'BCA 064'), 'IN', 100000000, 'OTHERS', 'Termin klien', 'smoke:239:1', 'ffffffff-0000-0000-0000-000000023902', 'COMPLETED'),
  ('trx-cf-239-002', '2026-09-03', (select id from ops_acct.accounts where code = 'BCA 271'), 'OUT', 2500000, 'SUPPLIERS', 'Material', 'smoke:239:2', 'ffffffff-0000-0000-0000-000000023902', 'COMPLETED');
insert into ops_acct.transactions (trx_no, trx_date, account_id, direction, amount_idr, type_code, description, source_ref, posted_by, status, void_reason, void_by, void_at) values
  ('trx-cf-239-003', '2026-09-04', (select id from ops_acct.accounts where code = 'BCA 271'), 'OUT', 999, 'SUPPLIERS', 'Salah ketik', 'smoke:239:3', 'ffffffff-0000-0000-0000-000000023902', 'VOID',
   'Diketik dua kali', 'ffffffff-0000-0000-0000-000000023902', now());

set local role authenticated;

do $$
declare r jsonb; v_line uuid; v_bill uuid; v_rc uuid; n int; v_before numeric;
begin
  /* ── staf akuntansi: admin modul, tanpa approve_funds ─────────────────── */
  set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000023902';
  r := ops_acct.save_cashflow_line('Termin', 'IN', 'client', 'once', 1000, p_due_date => '2026-10-20');
  assert r ->> 'outcome' = 'refused' and (r ->> 'status')::int = 403, format('staff refused: %s', r);
  assert r -> 'error' ->> 'code' = 'authority_required', format('names the authority: %s', r);
  r := ops_acct.cashflow_ledger('2026-09-01', '2026-09-30');
  assert (r ->> 'status')::int = 403, format('staff cannot read the ledger seam: %s', r);
  r := ops_acct.set_cashflow_settings(0, array['CASHFLOW']);
  assert (r ->> 'status')::int = 403, format('staff cannot set settings: %s', r);
  select count(*) into n from ops_acct.cashflow_settings;
  assert n = 0, format('staff sees no settings row (RLS), got %s', n);

  /* ── pimpinan ─────────────────────────────────────────────────────────── */
  set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000023901';
  select count(*) into n from ops_acct.cashflow_settings;
  assert n = 1, 'leadership reads the settings row';

  r := ops_acct.save_cashflow_line('Termin 2 — Hotel Ubud', 'IN', 'client', 'once', 402720000, p_due_date => '2026-10-20');
  assert r ->> 'outcome' = 'ok', format('once: %s', r);
  v_line := (r -> 'data' ->> 'id')::uuid;
  assert (select starts_on from ops_acct.cashflow_lines where id = v_line) = '2026-10', 'a one-off starts in its month';

  r := ops_acct.save_cashflow_line('DP proyek baru', 'IN', 'client', 'monthly', 150000000,
         p_due_day => 12, p_starts_on => '2026-11', p_growth_pct => 5, p_growth_from => '2026-11');
  assert r ->> 'outcome' = 'ok', format('monthly with growth: %s', r);
  assert (select growth_pct from ops_acct.cashflow_lines where id = (r -> 'data' ->> 'id')::uuid) = 5, 'growth stored';

  r := ops_acct.save_cashflow_line('Termin 2 — Hotel Ubud (40%)', 'IN', 'client', 'once', 400000000,
         p_due_date => '2026-10-21', p_id => v_line);
  assert r ->> 'outcome' = 'ok', format('update: %s', r);
  assert (select amount from ops_acct.cashflow_lines where id = v_line) = 400000000, 'amount updated';
  select count(*) into n from ops_acct.cashflow_lines where source_ref is null;
  assert n = 2, format('update adds no row: %s', n);

  -- refusals
  r := ops_acct.save_cashflow_line('Pajak', 'IN', 'tax', 'monthly', 1, p_due_day => 15, p_starts_on => '2026-10');
  assert r -> 'error' ->> 'code' = 'category_invalid', format('tax is not money in: %s', r);
  r := ops_acct.save_cashflow_line('Bonus', 'OUT', 'payroll', 'once', 1);
  assert r -> 'error' ->> 'code' = 'date_required', format('once needs a date: %s', r);
  r := ops_acct.save_cashflow_line('PPh', 'OUT', 'tax', 'monthly', 1, p_starts_on => '2026-10');
  assert r -> 'error' ->> 'code' = 'day_invalid', format('monthly needs a day: %s', r);
  r := ops_acct.save_cashflow_line('PPh', 'OUT', 'tax', 'monthly', 1, p_due_day => 15, p_starts_on => '2026-10', p_growth_pct => 150);
  assert r -> 'error' ->> 'code' = 'growth_invalid', format('growth bounded: %s', r);
  r := ops_acct.save_cashflow_line('Cicilan', 'OUT', 'loan', 'monthly', 1, p_due_day => 25, p_starts_on => '2026-10', p_ends_on => '2026-09');
  assert r -> 'error' ->> 'code' = 'end_before_start', format('ends before it starts: %s', r);
  r := ops_acct.save_cashflow_line('Gaji', 'OUT', 'payroll', 'weekly', 1, p_starts_on => '2026-10');
  assert r -> 'error' ->> 'code' = 'weekday_invalid', format('weekly needs a weekday: %s', r);

  /* ── tagihan bulanan: hanya proyeksi yang berubah ─────────────────────── */
  select amount into v_before from ops_acct.cash_components where id = 'cccccccc-0000-0000-0000-000000023901';
  r := ops_acct.save_cashflow_bill('component:cccccccc-0000-0000-0000-000000023901', 'Sewa gudang', 'bills', 7000000, 2, '2026-11');
  assert r ->> 'outcome' = 'ok', format('bill adjusted: %s', r);
  v_bill := (r -> 'data' ->> 'id')::uuid;
  r := ops_acct.save_cashflow_bill('component:cccccccc-0000-0000-0000-000000023901', 'Sewa gudang', 'bills', null, 0, null, true);
  assert r ->> 'outcome' = 'ok' and (r -> 'data' ->> 'id')::uuid = v_bill, format('upsert, same row: %s', r);
  assert (select hidden and amount is null from ops_acct.cashflow_lines where id = v_bill), 'left out, follows the calendar';
  assert (select amount from ops_acct.cash_components where id = 'cccccccc-0000-0000-0000-000000023901') = v_before,
         'the calendar is untouched';
  r := ops_acct.save_cashflow_bill('component:00000000-0000-0000-0000-000000000000', 'X', 'bills');
  assert (r ->> 'status')::int = 404, format('no such bill: %s', r);
  r := ops_acct.save_cashflow_bill('nonsense', 'X', 'bills');
  assert r -> 'error' ->> 'code' = 'source_invalid', format('not a bill: %s', r);

  /* ── satu minggu ──────────────────────────────────────────────────────── */
  r := ops_acct.set_cashflow_week('2026-10-15', 0, 'Klien minta mundur', p_line_id => v_line);
  assert r ->> 'outcome' = 'ok', format('week set: %s', r);
  r := ops_acct.set_cashflow_week('2026-10-15', null, 'Mundur ke November', p_line_id => v_line);
  assert r ->> 'outcome' = 'ok', format('week reset: %s', r);
  select count(*) into n from ops_acct.cashflow_overrides where line_id = v_line;
  assert n = 1, format('the same week replaces, not adds: %s', n);
  assert (select amount is null from ops_acct.cashflow_overrides where line_id = v_line), 'not this week';
  r := ops_acct.set_cashflow_week('2026-10-03', 1, 'x', p_line_id => v_line);
  assert r -> 'error' ->> 'code' = 'week_invalid', format('weeks start on 1/8/15/22: %s', r);
  r := ops_acct.set_cashflow_week('2026-10-08', 1, '  ', p_line_id => v_line);
  assert r -> 'error' ->> 'code' = 'reason_required', format('a reason: %s', r);
  r := ops_acct.clear_cashflow_week(v_line, '2026-10-15');
  assert r ->> 'outcome' = 'ok', format('cleared: %s', r);
  r := ops_acct.clear_cashflow_week(v_line, '2026-10-15');
  assert r ->> 'outcome' = 'noop', format('clearing twice is a noop: %s', r);

  r := ops_acct.save_cashflow_bill('component:cccccccc-0000-0000-0000-000000023901', 'Sewa gudang', 'bills');
  r := ops_acct.set_cashflow_week('2026-10-22', 9000000, 'Denda telat', p_source_ref => 'component:cccccccc-0000-0000-0000-000000023901');
  assert r ->> 'outcome' = 'ok' and (r -> 'data' ->> 'line_id')::uuid = v_bill, format('by source_ref, the bill''s row: %s', r);

  /* ── realisasi ────────────────────────────────────────────────────────── */
  r := ops_acct.record_cashflow_receipt(v_line, '2026-08-30', 100000000, 'trx-cf-239-001', 'Termin diterima');
  assert r ->> 'outcome' = 'ok', format('receipt: %s', r);
  v_rc := (r -> 'data' ->> 'id')::uuid;
  r := ops_acct.record_cashflow_receipt(v_line, '2026-08-30', 100000000, 'trx-cf-239-001');
  assert (r ->> 'status')::int = 409 and r -> 'error' ->> 'code' = 'trx_already_used', format('one row, one realisation: %s', r);
  r := ops_acct.record_cashflow_receipt(v_line, '2026-08-30', 1, 'trx-nope');
  assert r -> 'error' ->> 'code' = 'no_such_trx', format('no such row: %s', r);
  r := ops_acct.record_cashflow_receipt(v_line, ops_core.office_day() + 3, 1);
  assert r -> 'error' ->> 'code' = 'date_in_future', format('not in the future: %s', r);
  r := ops_acct.record_cashflow_receipt(v_bill, '2026-09-01', 1);
  assert (r ->> 'status')::int = 404, format('a bill is settled on the calendar: %s', r);
  r := ops_acct.remove_cashflow_receipt(v_rc);
  assert r ->> 'outcome' = 'ok', format('receipt removed: %s', r);

  /* ── saldo awal, pengaturan ───────────────────────────────────────────── */
  r := ops_acct.set_cashflow_opening('2026-10', 820000000, 'Cek rekening koran');
  assert r ->> 'outcome' = 'ok', format('opening typed: %s', r);
  assert (select amount from ops_acct.cashflow_openings where month = '2026-10') = 820000000, 'opening stored';
  r := ops_acct.set_cashflow_opening('2026-10', null);
  assert not exists (select 1 from ops_acct.cashflow_openings where month = '2026-10'), 'opening cleared';
  r := ops_acct.set_cashflow_opening('2026-13', 1);
  assert r -> 'error' ->> 'code' = 'month_invalid', format('a real month: %s', r);
  r := ops_acct.set_cashflow_settings(150000000, array['CASHFLOW', ' CASHFLOW ']);
  assert r ->> 'outcome' = 'ok', format('settings: %s', r);
  assert (select transfer_types = array['CASHFLOW'] and min_balance = 150000000 from ops_acct.cashflow_settings), 'trimmed, distinct';
  r := ops_acct.set_cashflow_settings(0, array['NOPE']);
  assert r -> 'error' ->> 'code' = 'no_such_type', format('real categories only: %s', r);

  /* ── the ledger seam ──────────────────────────────────────────────────── */
  r := ops_acct.cashflow_ledger('2026-09-01', '2026-09-30');
  assert r ->> 'outcome' = 'ok', format('ledger read: %s', r);
  assert (select (a ->> 'balance')::numeric from jsonb_array_elements(r -> 'data' -> 'accounts') a where a ->> 'code' = 'BCA 064')
       = (select opening_balance from ops_acct.accounts where code = 'BCA 064') + 100000000,
         'BCA 064 on 1 Sep holds the August termin';
  assert jsonb_array_length(r -> 'data' -> 'rows') = 1, format('one row in September, VOID left out: %s', r -> 'data' -> 'rows');
  assert r -> 'data' -> 'rows' -> 0 ->> 'trx_no' = 'trx-cf-239-002', 'the September row';
  r := ops_acct.cashflow_ledger('2026-09-30', '2026-09-01');
  assert r -> 'error' ->> 'code' = 'window_invalid', format('backwards window refused: %s', r);

  /* ── removing an own line ─────────────────────────────────────────────── */
  r := ops_acct.remove_cashflow_line(v_line);
  assert r ->> 'outcome' = 'ok', format('removed: %s', r);
  assert not (select active from ops_acct.cashflow_lines where id = v_line), 'off, not deleted';
  r := ops_acct.remove_cashflow_line(v_bill);
  assert (r ->> 'status')::int = 404, format('a bill is left out, not removed: %s', r);
end $$;

rollback;
