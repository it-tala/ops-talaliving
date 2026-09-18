-- acct/statement — the rekening koran road, and the six ways it says no.
--
-- This screen exists to find the disagreement between what the bank says and
-- what the books say. Every refusal below protects that purpose:
--
--   the same period twice — one movement booked twice is the expensive one
--   a statement that ends before it begins
--   a foreign line with no rate typed, matching or booking (D181)
--   a match against a different amount — the disagreement is the finding
--   a match against the wrong direction, or a VOID row (A10)
--   a line left out with no reason — indistinguishable from one nobody got to
--
-- And the derivations: the number minted with the `rkk` prefix, `balance_ok`
-- against what the bank printed, and `awaiting_rate` counting only lines that
-- are still somebody's to decide.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('eeee0000-0000-0000-0000-00000000aa01','rina@talaliving.com','{"full_name":"Rina Kartika"}');

insert into ops_core.user_authorities (user_id, authority) values
  ('eeee0000-0000-0000-0000-00000000aa01','post_ledger');
insert into ops_core.user_modules (user_id, module, level) values
  ('eeee0000-0000-0000-0000-00000000aa01','accounting','write');

insert into ops_core.attachments (id, storage_path, filename, uploaded_by) values
  ('eeee0000-0000-0000-0000-0000000000cc', 'a/rk.pdf','rk-sept.pdf',
   'eeee0000-0000-0000-0000-00000000aa01');

set local role authenticated;
set local request.jwt.claim.sub = 'eeee0000-0000-0000-0000-00000000aa01';

-- ── importing, and the period that is already there ──────────────────────
do $$
declare r jsonb; no1 text; n int;
begin
  r := ops_acct.import_statement('BCA 271','2026-09-01','2026-09-30',
        1000000, 1400000, 'IDR','rk-sept.pdf',
        jsonb_build_array(
          jsonb_build_object('value_date','2026-09-05','direction','IN',
                             'amount', 600000,'raw_description','TRSF E-BANKING CR'),
          jsonb_build_object('value_date','2026-09-09','direction','OUT',
                             'amount', 200000,'raw_description','BIAYA ADM')),
        'eeee0000-0000-0000-0000-0000000000cc');
  assert r ->> 'outcome' = 'ok', format('a clean import should work, got %s', r);
  no1 := r #>> '{data,statement_no}';

  -- The number is minted like every other document, with its own prefix.
  assert no1 like 'rkk-%', format('a statement gets a public number, got %s', no1);

  select count(*) into n from ops_acct.statement_lines;
  assert n = 2, format('both rows should land, saw %s', n);

  -- The same period again. This is a re-upload, and booking one movement
  -- twice is the most expensive mistake this screen offers.
  r := ops_acct.import_statement('BCA 271','2026-09-01','2026-09-30',
        1000000, 1400000, 'IDR','rk-sept-again.pdf',
        jsonb_build_array(jsonb_build_object('value_date','2026-09-05','direction','IN',
                          'amount', 600000,'raw_description','TRSF E-BANKING CR')));
  assert r ->> 'outcome' = 'duplicate', format('a re-upload is a conflict, got %s', r ->> 'outcome');
  assert r #>> '{error,code}' = 'period_already_uploaded', format('got %s', r #>> '{error,code}');
  assert r #>> '{error,message}' like '%' || no1 || '%',
         'and the message names the statement that already covers it';

  r := ops_acct.import_statement('BCA 271','2026-10-31','2026-10-01',
        0, 0, 'IDR','backwards.pdf',
        jsonb_build_array(jsonb_build_object('value_date','2026-10-05','direction','IN',
                          'amount', 1,'raw_description','x')));
  assert r #>> '{error,code}' = 'period_backwards', format('got %s', r #>> '{error,code}');

  r := ops_acct.import_statement('BCA 271','2026-11-01','2026-11-30',
        0, 0, 'IDR','empty.pdf', '[]'::jsonb);
  assert r #>> '{error,code}' = 'no_rows', format('got %s', r #>> '{error,code}');

  r := ops_acct.import_statement('NOPE','2026-12-01','2026-12-31',
        0, 0, 'IDR','x.pdf',
        jsonb_build_array(jsonb_build_object('value_date','2026-12-05','direction','IN',
                          'amount', 1,'raw_description','x')));
  assert (r ->> 'status')::int = 404 and r #>> '{error,code}' = 'not_found',
         format('an unknown account is a 404, got %s', r);
  assert r #>> '{error,message}' like '%NOPE%', 'and the message names it';
end $$;

-- ── the derivations the screen reads ─────────────────────────────────────
do $$
declare ok_ boolean; mv numeric; comp numeric; await int;
begin
  select balance_ok, movement, computed_closing, awaiting_rate
    into ok_, mv, comp, await
    from ops_acct.v_bank_statement where period_start = '2026-09-01';

  assert mv = 400000, format('600k in less 200k out, saw %s', mv);
  assert comp = 1400000, format('opening plus movement, saw %s', comp);
  assert ok_, 'and it agrees with what the bank printed';
  assert await = 0, format('a rupiah statement waits for no rate, saw %s', await);
end $$;

-- ── a foreign line cannot reach the ledger without a rate (D181) ─────────
do $$
declare r jsonb; usd_line uuid; await int;
begin
  r := ops_acct.import_statement('BCA 271','2026-08-01','2026-08-31',
        0, 0, 'USD','rk-usd.pdf',
        jsonb_build_array(jsonb_build_object('value_date','2026-08-10','direction','OUT',
                          'amount', 100,'raw_description','WIRE OUT')));
  assert r ->> 'outcome' = 'ok', format('got %s', r);

  select sl.id into usd_line from ops_acct.statement_lines sl
    join ops_acct.bank_statements s on s.id = sl.statement_id
   where s.currency = 'USD';

  assert (select amount_idr from ops_acct.statement_lines where id = usd_line) is null,
         'a foreign amount is not converted by inference';

  select awaiting_rate into await from ops_acct.v_bank_statement where currency = 'USD';
  assert await = 1, format('and the screen says how many are waiting, saw %s', await);

  r := ops_acct.match_statement_line(usd_line, 'trx-does-not-matter');
  assert r #>> '{error,code}' = 'rate_required',
         format('matching without a rate must be refused, got %s', r #>> '{error,code}');

  r := ops_acct.book_statement_line(usd_line, 'BANK CHARGES', 'wire fee');
  assert r #>> '{error,code}' = 'rate_required',
         format('and so must booking, got %s', r #>> '{error,code}');

  r := ops_acct.set_statement_rate(usd_line, 0);
  assert r #>> '{error,code}' = 'rate_invalid', format('got %s', r #>> '{error,code}');

  r := ops_acct.set_statement_rate(usd_line, 16000);
  assert r ->> 'outcome' = 'ok', format('got %s', r);
  assert (select amount_idr from ops_acct.statement_lines where id = usd_line) = 1600000,
         'the rate converts, and the rate that produced it stays on the row';

  select awaiting_rate into await from ops_acct.v_bank_statement where currency = 'USD';
  assert await = 0, format('nothing waiting now, saw %s', await);
end $$;

-- ── matching: the amount is the finding, not a detail ────────────────────
do $$
declare r jsonb; line_in uuid; v_trx text;
begin
  select sl.id into line_in from ops_acct.statement_lines sl
    join ops_acct.bank_statements s on s.id = sl.statement_id
   where s.currency = 'IDR' and sl.direction = 'IN';

  -- A ledger row that is close but not the same number.
  r := ops_acct.post_transaction('BCA 271','IN', 590000,'CASHFLOW','setoran',
        jsonb_build_array(jsonb_build_object(
          'attachment_id','eeee0000-0000-0000-0000-0000000000cc','kind','rekening_koran')),
        '2026-09-05');
  assert r ->> 'outcome' = 'ok', format('got %s', r);
  v_trx := r #>> '{data,trx_no}';

  r := ops_acct.match_statement_line(line_in, v_trx);
  assert r #>> '{error,code}' = 'amount_differs',
         format('600k against 590k must be refused, got %s', r #>> '{error,code}');
  assert r #>> '{error,message}' like '%590000%',
         'and the message carries both figures, so somebody can see which is wrong';

  r := ops_acct.match_statement_line(line_in, 'trx-26-01-01_999');
  assert r ->> 'outcome' = 'refused', format('an unknown row is a 404, got %s', r);
end $$;

-- ── booking goes through the one money seam, and records what came back ──
do $$
declare r jsonb; line_out uuid; v_trx text; st text; n int;
begin
  select sl.id into line_out from ops_acct.statement_lines sl
    join ops_acct.bank_statements s on s.id = sl.statement_id
   where s.currency = 'IDR' and sl.direction = 'OUT';

  r := ops_acct.book_statement_line(line_out, 'BANK CHARGES', 'biaya administrasi');
  assert r ->> 'outcome' = 'ok', format('booking should work, got %s', r);
  v_trx := r #>> '{data,trx_no}';

  select status, trx_no into st, v_trx from ops_acct.statement_lines where id = line_out;
  assert st = 'booked', format('the line is booked, saw %s', st);
  assert v_trx is not null, 'and it names the row it became';

  -- The ledger row is a real one, posted by `post_transaction` rather than
  -- written here: one seam for money (ADR-006).
  select count(*) into n from ops_acct.transactions where trx_no = v_trx;
  assert n = 1, 'the row exists in the ledger';

  -- The statement is the evidence (D180), attached as `rekening_koran`.
  select count(*) into n from ops_core.attachment_links
   where entity = 'transaction' and entity_no = v_trx and kind = 'rekening_koran';
  assert n = 1, format('the statement should be the document behind it, saw %s', n);

  -- Deciding it again changes nothing.
  r := ops_acct.book_statement_line(line_out, 'BANK CHARGES', 'again');
  assert r ->> 'outcome' = 'noop', format('a decided line is a no-op, got %s', r ->> 'outcome');
end $$;

-- ── a statement nobody attached the file to has no evidence to give ──────
--
-- `post_transaction` would refuse this anyway (D85), but in its own words,
-- about notas and photographs — to somebody whose actual problem is that the
-- PDF was never uploaded. The USD statement above was imported without one.
do $$
declare r jsonb; usd_line uuid;
begin
  select sl.id into usd_line from ops_acct.statement_lines sl
    join ops_acct.bank_statements s on s.id = sl.statement_id
   where s.currency = 'USD';

  r := ops_acct.book_statement_line(usd_line, 'BANK CHARGES', 'wire fee');
  assert r #>> '{error,code}' = 'statement_not_filed',
         format('got %s', r #>> '{error,code}');
  assert r #>> '{error,message}' like '%Attach the PDF%',
         'and the refusal says what to do next';
end $$;

-- ── leaving a line out needs a reason (D182) ─────────────────────────────
do $$
declare r jsonb; line_in uuid; st text; nt text;
begin
  select sl.id into line_in from ops_acct.statement_lines sl
    join ops_acct.bank_statements s on s.id = sl.statement_id
   where s.currency = 'IDR' and sl.direction = 'IN';

  r := ops_acct.ignore_statement_line(line_in, '   ');
  assert r #>> '{error,code}' = 'reason_required',
         format('a blank reason must be refused, got %s', r #>> '{error,code}');

  r := ops_acct.ignore_statement_line(line_in, 'setoran pribadi, bukan kas perusahaan');
  assert r ->> 'outcome' = 'ok', format('got %s', r);

  select status, note into st, nt from ops_acct.statement_lines where id = line_in;
  assert st = 'ignored', format('saw %s', st);
  assert nt = 'setoran pribadi, bukan kas perusahaan', 'and the reason is kept';

  r := ops_acct.ignore_statement_line(line_in, 'again');
  assert r ->> 'outcome' = 'noop', format('a decided line is a no-op, got %s', r ->> 'outcome');
end $$;

rollback;
