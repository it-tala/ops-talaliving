-- acct calendar — twelve months, planned against actual.
--
-- The arithmetic here is where a wrong number hides best: everything looks
-- plausible, and a month underestimated by one payroll run only shows up when
-- the money is not there. So the derivations are checked by the figures this
-- project argued about:
--
--   * a weekly line costs more in a five-payday month (D113)
--   * an override on a weekly line is the MONTH's total, and the difference
--     lands on the last run — the THR is one payday, not four (D114)
--   * the most specific claim goes first, so the one-off takes its own payment
--     before the standing line sweeps it up (D110)
--   * one ledger row is claimed once, by one line, ever
--   * a skipped month is a fact, not a deletion
--   * the 31st in February is the 28th, not an occurrence that disappears
--
-- The whole file is pinned to a fixed date, because "twelve months from now"
-- is not a thing a test can assert against.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('a1a1a1a1-0000-0000-0000-00000000f11a','rina@talaliving.com','{"full_name":"Rina Kartika"}');
insert into ops_core.user_authorities (user_id, authority) values
  ('a1a1a1a1-0000-0000-0000-00000000f11a','post_ledger');
insert into ops_core.user_modules (user_id, module, level) values
  ('a1a1a1a1-0000-0000-0000-00000000f11a','accounting','write');
insert into ops_procure.vendors (id, code, name, is_curated) values
  ('11110000-0000-0000-0000-0000000000c1','V-6001','PLN', true);

-- ── the lines ─────────────────────────────────────────────────────────────
-- Payroll every Friday, the electricity bill on the 20th, and a one-off
-- settlement of the credit card in November.
insert into ops_acct.cash_components
  (id, name, direction, amount, frequency, due_weekday, due_day, due_date,
   type_code, vendor_id, starts_on, created_by)
values
  ('c0c0c0c0-0000-0000-0000-000000000001','Gaji mingguan','OUT', 30000000,'weekly',
   5, null, null, 'RECCURING - PAYROLL', null, '2026-01', 'a1a1a1a1-0000-0000-0000-00000000f11a'),
  ('c0c0c0c0-0000-0000-0000-000000000002','Listrik PLN','OUT', 4500000,'monthly',
   null, 20, null, 'RECCURING - UTILITIES','11110000-0000-0000-0000-0000000000c1',
   '2026-01', 'a1a1a1a1-0000-0000-0000-00000000f11a'),
  ('c0c0c0c0-0000-0000-0000-000000000003','Pelunasan kartu kredit','OUT', 25000000,'once',
   null, null, '2026-11-10', 'CREDIT CARD', null, '2026-01',
   'a1a1a1a1-0000-0000-0000-00000000f11a'),
  -- The 31st, so February has to clamp it.
  ('c0c0c0c0-0000-0000-0000-000000000004','Sewa gudang','OUT', 8000000,'monthly',
   null, 31, null, 'WAREHOUSE', null, '2026-01', 'a1a1a1a1-0000-0000-0000-00000000f11a');

/* ── DERIVATION: four paydays in most months, five in some (D113) ──────── */
do $$
declare sep_n int; oct_n int; sep_p numeric; oct_p numeric;
begin
  select count(*), sum(planned) into sep_n, sep_p
    from ops_acct.cash_events('2026-09-01'::date)
   where component_id = 'c0c0c0c0-0000-0000-0000-000000000001' and month = '2026-09';
  select count(*), sum(planned) into oct_n, oct_p
    from ops_acct.cash_events('2026-09-01'::date)
   where component_id = 'c0c0c0c0-0000-0000-0000-000000000001' and month = '2026-10';

  assert sep_n = 4, format('September 2026 has four Fridays, got %s', sep_n);
  assert oct_n = 5, format('October 2026 has five, got %s', oct_n);
  assert sep_p = 120000000, format('4 × 30 juta, got %s', sep_p);
  -- The difference the old one-figure-per-month model could not say.
  assert oct_p = 150000000, format('5 × 30 juta, got %s', oct_p);
end $$;

/* ── DERIVATION: the 31st in February is the 28th ──────────────────────── */
do $$
declare d date; n int;
begin
  select due_date, count(*) over () into d, n
    from ops_acct.cash_events('2027-02-01'::date)
   where component_id = 'c0c0c0c0-0000-0000-0000-000000000004' and month = '2027-02';
  assert d = '2027-02-28'::date,
         format('the 31st clamps to the end of the month rather than vanishing, got %s', d);

  select due_date into d from ops_acct.cash_events('2027-02-01'::date)
   where component_id = 'c0c0c0c0-0000-0000-0000-000000000004' and month = '2027-03';
  assert d = '2027-03-31'::date, format('and March still gets the 31st, got %s', d);
end $$;

/* ── DERIVATION: the THR lands on one payday, not four (D114) ──────────── */
-- December's payroll is 170 juta, not 4 × 30. The override is the MONTH's
-- total and the difference goes on the last run.
insert into ops_acct.cash_overrides (component_id, month, amount, reason, recorded_by)
values ('c0c0c0c0-0000-0000-0000-000000000001','2026-12', 170000000,
        'THR dibayar bersama gaji terakhir.','a1a1a1a1-0000-0000-0000-00000000f11a');

do $$
declare n int; total numeric; last_amt numeric; first_amt numeric; carries boolean;
begin
  select count(*), sum(planned) into n, total
    from ops_acct.cash_events('2026-09-01'::date)
   where component_id = 'c0c0c0c0-0000-0000-0000-000000000001' and month = '2026-12';
  assert total = 170000000, format('the month totals what was overridden, got %s', total);

  select planned, carries_override into last_amt, carries
    from ops_acct.cash_events('2026-09-01'::date)
   where component_id = 'c0c0c0c0-0000-0000-0000-000000000001' and month = '2026-12'
   order by due_date desc limit 1;
  select planned into first_amt
    from ops_acct.cash_events('2026-09-01'::date)
   where component_id = 'c0c0c0c0-0000-0000-0000-000000000001' and month = '2026-12'
   order by due_date limit 1;

  assert first_amt = 30000000, format('the early runs are ordinary, got %s', first_amt);
  assert last_amt = 170000000 - 30000000 * (n - 1),
         format('and the THR is on the last one, got %s', last_amt);
  assert carries, 'and the row says which run carries it';
end $$;

/* ── DERIVATION: a skipped month is a fact, not a deletion ─────────────── */
insert into ops_acct.cash_overrides (component_id, month, amount, reason, recorded_by)
values ('c0c0c0c0-0000-0000-0000-000000000002','2026-10', null,
        'Dibayar di muka bulan lalu.','a1a1a1a1-0000-0000-0000-00000000f11a');

do $$
declare st text; p numeric; r text;
begin
  select state, planned, reason into st, p, r
    from ops_acct.cash_events('2026-09-01'::date)
   where component_id = 'c0c0c0c0-0000-0000-0000-000000000002' and month = '2026-10';
  assert st = 'SKIPPED', format('got %s', st);
  assert p = 0, format('nothing planned, got %s', p);
  assert r = 'Dibayar di muka bulan lalu.',
         'and the reason is on the cell — a skip nobody explained is a gap';

  -- The line is still there in every other month.
  select planned into p from ops_acct.cash_events('2026-09-01'::date)
   where component_id = 'c0c0c0c0-0000-0000-0000-000000000002' and month = '2026-11';
  assert p = 4500000, format('November is ordinary again, got %s', p);
end $$;

/* ── DERIVATION: most specific claim first (D110) ──────────────────────── */
-- The failure this ordering prevents: a monthly credit-card line would sweep
-- up November's one-off settlement, and the plan would show the routine amount
-- twice while the 25-juta settlement read as unpaid.
insert into ops_acct.cash_components
  (id, name, direction, amount, frequency, due_day, type_code, starts_on, created_by)
values ('c0c0c0c0-0000-0000-0000-000000000005','Tagihan kartu kredit bulanan','OUT',
        3000000,'monthly', 10, 'CREDIT CARD','2026-01','a1a1a1a1-0000-0000-0000-00000000f11a');

set local role authenticated;
set local request.jwt.claim.sub = 'a1a1a1a1-0000-0000-0000-00000000f11a';

set local role postgres;
insert into ops_core.attachments (id, storage_path, filename, uploaded_by) values
  ('44440000-0000-0000-0000-0000000000c1','a/tf.jpg','bukti.jpg','a1a1a1a1-0000-0000-0000-00000000f11a');
insert into ops_acct.transactions (trx_no, trx_date, account_id, direction, amount_idr, type_code, description, source_ref, posted_by) values
  -- The settlement, on the day the one-off expects it.
  ('trx-26-11-10_001','2026-11-10',(select id from ops_acct.accounts where code='BCA 271'),
   'OUT',25000000,'CREDIT CARD','Pelunasan kartu kredit','cc-settle','a1a1a1a1-0000-0000-0000-00000000f11a'),
  -- And the ordinary bill, the same month.
  ('trx-26-11-10_002','2026-11-10',(select id from ops_acct.accounts where code='BCA 271'),
   'OUT',3000000,'CREDIT CARD','Tagihan bulanan','cc-monthly','a1a1a1a1-0000-0000-0000-00000000f11a');

do $$
declare once_actual numeric; once_rows text[]; monthly_actual numeric; monthly_rows text[];
begin
  select actual, trx_nos into once_actual, once_rows
    from ops_acct.cash_events('2026-11-01'::date)
   where component_id = 'c0c0c0c0-0000-0000-0000-000000000003' and month = '2026-11';
  select actual, trx_nos into monthly_actual, monthly_rows
    from ops_acct.cash_events('2026-11-01'::date)
   where component_id = 'c0c0c0c0-0000-0000-0000-000000000005' and month = '2026-11';

  -- The one-off is the narrowest claim there is, so it goes first.
  assert once_actual = 25000000,
         format('the settlement takes its own payment, got %s', once_actual);
  assert once_rows = array['trx-26-11-10_001'], format('got %s', once_rows);

  -- And the standing line gets what is left, not the settlement as well.
  assert monthly_actual = 3000000,
         format('the monthly bill takes only the monthly payment, got %s', monthly_actual);
  assert monthly_rows = array['trx-26-11-10_002'], format('got %s', monthly_rows);
end $$;

/* ── one row is claimed once, by one line, ever ────────────────────────── */
do $$
declare dupes int;
begin
  select count(*) into dupes from (
    select u.trx_no
      from ops_acct.cash_events('2026-11-01'::date) e,
           lateral unnest(e.trx_nos) u(trx_no)
     group by u.trx_no having count(*) > 1
  ) x;
  assert dupes = 0, format('%s ledger rows were counted twice', dupes);
end $$;

/* ── somebody's link beats the guess ───────────────────────────────────── */
set local role postgres;
insert into ops_acct.transactions (trx_no, trx_date, account_id, direction, amount_idr, type_code, description, source_ref, posted_by) values
  -- Paid four days late and under a category the line does not name, so no
  -- guess would find it.
  ('trx-26-09-24_001','2026-09-24',(select id from ops_acct.accounts where code='BCA 271'),
   'OUT',4500000,'OTHERS','Listrik September (transfer manual)','pln-sep',
   'a1a1a1a1-0000-0000-0000-00000000f11a');
set local role authenticated;

do $$
declare r jsonb; st text; m text; a numeric;
begin
  -- Read from the 30th: the bill was due on the 20th and nothing has been
  -- found for it, so the month is overdue rather than merely planned.
  select state, matched_by, actual into st, m, a
    from ops_acct.cash_events('2026-09-30'::date)
   where component_id = 'c0c0c0c0-0000-0000-0000-000000000002' and month = '2026-09';
  assert a = 0, format('no guess reaches it, got %s', a);
  assert st = 'OVERDUE', format('the 20th is past and nothing paid it, got %s', st);

  r := ops_acct.link_cash_payment('c0c0c0c0-0000-0000-0000-000000000002','2026-09','trx-26-09-24_001');
  assert ops_core.said_ok(r), format('got %s', r);

  select state, matched_by, actual into st, m, a
    from ops_acct.cash_events('2026-09-30'::date)
   where component_id = 'c0c0c0c0-0000-0000-0000-000000000002' and month = '2026-09';
  assert a = 4500000, format('somebody said so, got %s', a);
  assert m = 'linked', format('and the screen can say it was not a guess, got %s', m);
  assert st = 'PAID', format('got %s', st);

  -- One row, one bill.
  r := ops_acct.link_cash_payment('c0c0c0c0-0000-0000-0000-000000000005','2026-09','trx-26-09-24_001');
  assert r -> 'error' ->> 'code' = 'already_linked', format('got %s', r);
end $$;

/* ── REFUSALS on the calendar's own writes ─────────────────────────────── */
do $$
declare r jsonb;
begin
  r := ops_acct.save_cash_component('', 1000000, 'monthly', 'OUT', 5);
  assert r -> 'error' ->> 'code' = 'name_required', format('got %s', r);

  r := ops_acct.save_cash_component('Sesuatu', 0, 'monthly', 'OUT', 5);
  assert r -> 'error' ->> 'code' = 'amount_required',
         format('an estimate of zero plans nothing, got %s', r);

  r := ops_acct.save_cash_component('Sesuatu', 100000, 'weekly', 'OUT');
  assert r -> 'error' ->> 'code' = 'weekday_required',
         format('a weekly line that cannot be dated never falls due, got %s', r);

  r := ops_acct.save_cash_component('Sesuatu', 100000, 'monthly', 'OUT', 45);
  assert r -> 'error' ->> 'code' = 'due_day_out_of_range', format('got %s', r);

  r := ops_acct.set_cash_override('c0c0c0c0-0000-0000-0000-000000000002','2026-13', 100);
  assert r -> 'error' ->> 'code' = 'month_invalid', format('got %s', r);

  r := ops_acct.link_cash_payment('c0c0c0c0-0000-0000-0000-000000000002','2026-09','trx-nope');
  assert (r -> 'error' ->> 'status')::int = 404, format('got %s', r);
end $$;

-- A voided payment settles nothing.
set local role postgres;
update ops_acct.transactions set status = 'VOID', void_reason = 'salah', void_at = now(),
       void_by = 'a1a1a1a1-0000-0000-0000-00000000f11a'
 where trx_no = 'trx-26-11-10_002';
set local role authenticated;

do $$
declare a numeric; r jsonb;
begin
  select actual into a from ops_acct.cash_events('2026-11-01'::date)
   where component_id = 'c0c0c0c0-0000-0000-0000-000000000005' and month = '2026-11';
  assert a = 0, format('a voided payment pays no bill, got %s', a);

  r := ops_acct.link_cash_payment('c0c0c0c0-0000-0000-0000-000000000004','2026-11','trx-26-11-10_002');
  assert r -> 'error' ->> 'code' = 'transaction_void', format('got %s', r);
end $$;

/* ── the position, and what nothing planned for ────────────────────────── */
do $$
declare cash numeric; n int;
begin
  -- Leadership's accounts are not in it: money sitting there has not been
  -- given to operations, and counting it would make every month look
  -- survivable.
  select opening_cash into cash from ops_acct.v_cash_position;
  -- 25 juta settlement + 4,5 juta listrik. The 3 juta card bill was voided
  -- and does not count; leadership's accounts are not in the sum at all.
  assert cash = -29500000,
         format('only the paying accounts, and only live rows, got %s', cash);

  select count(*) into n from ops_acct.v_cash_cell where month = '2026-09';
  assert n > 0, 'the cells aggregate the events';
end $$;

rollback;
