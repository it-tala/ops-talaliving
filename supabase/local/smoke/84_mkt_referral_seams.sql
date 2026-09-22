-- mkt — defining a market, and the introductions that turn into money
-- (D186, D187).
--
--   REFUSALS     any of it with a read grant; a country code of three letters;
--                a currency of two; **a market code its own country filter
--                would never find**; a code with no city in it; a time zone
--                Postgres has never heard of; defining the same market twice;
--                an introduction with no owner, against a representative
--                nobody onboarded, or pointing at a unit that does not exist;
--                `WON` with no project, a project that does not exist, or a
--                contract nobody has valued; `LOST` with no reason; a
--                commission paid twice; **and, once paid, moving the status
--                back, re-pointing the project, or rewriting which row paid**
--   DERIVATIONS  the code is upper-cased on the way in; the answer hands back
--                what the introduction is now **worth**, not just its status;
--                an inactive representative is **warned about, not refused**;
--                `commission_unpaid` falls to nought when the ledger row is
--                recorded
--
-- Worked out first:  500.000.000 × 2,5% = 12.500.000

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-000000008401','mkt84@talaliving.com','{"full_name":"Staf Marketing"}'),
  ('ffffffff-0000-0000-0000-000000008402','lihat84@talaliving.com','{"full_name":"Pimpinan"}'),
  ('ffffffff-0000-0000-0000-000000008403','it84@talaliving.com','{"full_name":"Staf IT"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-000000008401','marketing','write'),
  ('ffffffff-0000-0000-0000-000000008402','marketing','read'),
  ('ffffffff-0000-0000-0000-000000008403','it','read');

insert into ops_procure.projects (code, name, contract_value) values
  ('PRJ-84','Astoria PH-1', 500000000),
  -- A real job nobody has valued yet, and the reason `WON` asks twice.
  ('PRJ-85','Astoria PH-2', null),
  ('PRJ-86','Astoria PH-3', 900000000);

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000008402';

/* ── REFUSAL: a read grant may look at the pipeline, not define it ─────── */
do $$
declare a jsonb;
begin
  a := ops_mkt.create_market('AU-QLD-GOLDCOAST-SPNORTH','AU','Australia','Gold Coast','SP NORTH','AUD','Australia/Brisbane');
  assert a -> 'error' ->> 'code' = 'not_permitted', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');
  a := ops_mkt.add_referral('agn-x','Pak Hadi');
  assert a -> 'error' ->> 'code' = 'not_permitted', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');
  assert (select count(*) from ops_mkt.markets) = 0, 'and nothing was defined';
end $$;

set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000008401';

/* ── REFUSAL: a market nobody could filter, and a clock nobody could read ─ */
do $$
declare a jsonb;
begin
  a := ops_mkt.create_market('AUS-QLD-GC-X','AUS','Australia','Gold Coast','X','AUD','Australia/Brisbane');
  assert a -> 'error' ->> 'code' = 'bad_country_code', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');

  a := ops_mkt.create_market('AU-QLD-GC-X','AU','Australia','Gold Coast','X','AU','Australia/Brisbane');
  assert a -> 'error' ->> 'code' = 'bad_currency', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');

  -- Not refused for being untidy: a code that does not begin with its own
  -- country is missing from every country roll-up and nothing raises (D187).
  a := ops_mkt.create_market('QLD-GOLDCOAST-SPNORTH','AU','Australia','Gold Coast','SP NORTH','AUD','Australia/Brisbane');
  assert a -> 'error' ->> 'code' = 'code_must_start_with_country', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');
  assert a -> 'error' ->> 'message' like '%laporan negaranya%',
    'and the message says what would go wrong, not which constraint fired';

  a := ops_mkt.create_market('AU-QLD','AU','Australia','Gold Coast','SP NORTH','AUD','Australia/Brisbane');
  assert a -> 'error' ->> 'code' = 'code_too_short', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');

  a := ops_mkt.create_market('AU-QLD-GC-X','AU','Australia','Gold Coast','X','AUD','Australia/Gold_Coast');
  assert a -> 'error' ->> 'code' = 'bad_timezone', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');

  assert (select count(*) from ops_mkt.markets) = 0, 'five refusals and no rows';
end $$;

/* ── DERIVATION: the code is upper-cased on the way in ─────────────────── */
do $$
declare a jsonb; m record;
begin
  -- Typed in lower case, as somebody will. The prefix rule is a string
  -- comparison and would quietly fail for the rest of time.
  a := ops_mkt.create_market('au-qld-goldcoast-spnorth','au','Australia','Gold Coast','SP NORTH',
                             'aud','Australia/Brisbane','Queensland');
  assert ops_core.said_ok(a), 'got ' || coalesce(a -> 'error' ->> 'code', a::text);
  assert a -> 'data' ->> 'code' = 'AU-QLD-GOLDCOAST-SPNORTH', 'got ' || coalesce(a -> 'data' ->> 'code','(null)');
  assert a -> 'data' ->> 'currency' = 'AUD', 'got ' || coalesce(a -> 'data' ->> 'currency','(null)');

  select * into m from ops_mkt.v_market where code = 'AU-QLD-GOLDCOAST-SPNORTH';
  assert m.full_path = 'Australia · Queensland · Gold Coast · SP NORTH', 'got ' || coalesce(m.full_path,'(null)');
  assert m.local_time is not null, 'and it knows its own clock';

  -- A country with no level worth carrying between it and the city.
  a := ops_mkt.create_market('ID-BALI-SEMINYAK','ID','Indonesia','Bali','Seminyak','IDR','Asia/Makassar');
  assert ops_core.said_ok(a), 'got ' || coalesce(a -> 'error' ->> 'code', a::text);
  select * into m from ops_mkt.v_market where code = 'ID-BALI-SEMINYAK';
  assert m.full_path = 'Indonesia · Bali · Seminyak', 'no gap where the region would be, got '
    || coalesce(m.full_path,'(null)');

  a := ops_mkt.create_market('AU-QLD-GOLDCOAST-SPNORTH','AU','Australia','Gold Coast','SP NORTH','AUD','Australia/Brisbane');
  assert a -> 'error' ->> 'code' = 'market_exists', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');
end $$;

/* ── DERIVATION: retiring a market keeps everything it found ───────────── */
do $$
declare a jsonb; n int;
begin
  insert into ops_mkt.scrape_rows (market_code, name) values ('ID-BALI-SEMINYAK','Villa Kayu');

  a := ops_mkt.set_market_active('ID-BALI-UBUD', false);
  assert a -> 'error' ->> 'code' = 'not_found', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');

  a := ops_mkt.set_market_active('ID-BALI-SEMINYAK', false);
  assert ops_core.said_ok(a), 'got ' || coalesce(a -> 'error' ->> 'code', a::text);
  assert not (a -> 'data' ->> 'active')::boolean, 'retired';
  -- A property scraped in Seminyak last year is still a fact about Seminyak
  -- (A5). `active` keeps it off the list of places to scrape next, and takes
  -- nothing away.
  select count(*) into n from ops_mkt.scrape_rows where market_code = 'ID-BALI-SEMINYAK';
  assert n = 1, 'what it found stays, got ' || n;
end $$;

insert into ops_mkt.sales_reps (id, rep_no, name, market_code, commission_percent, created_by) values
  ('cccc8400-0000-0000-0000-0000000000b1','agn-84-01','Budi Santoso','AU-QLD-GOLDCOAST-SPNORTH', 2.5,
   'ffffffff-0000-0000-0000-000000008401'),
  -- Somebody we have stopped working with.
  ('cccc8400-0000-0000-0000-0000000000b2','agn-84-02','Sari Dewi','AU-QLD-GOLDCOAST-SPNORTH', 3,
   'ffffffff-0000-0000-0000-000000008401');
update ops_mkt.sales_reps set active = false where rep_no = 'agn-84-02';

insert into ops_mkt.properties (ref, market_code, name) values
  ('TL-8401','AU-QLD-GOLDCOAST-SPNORTH','Meriton Suites');

/* ── REFUSAL and DERIVATION: an introduction ───────────────────────────── */
do $$
declare a jsonb; v record;
begin
  a := ops_mkt.add_referral('agn-84-01','   ');
  assert a -> 'error' ->> 'code' = 'owner_required', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');

  a := ops_mkt.add_referral('agn-hantu','Pak Hadi');
  assert a -> 'error' ->> 'code' = 'not_found',
    'an introduction against a rep nobody onboarded is a commission nobody can compute, got '
    || coalesce(a -> 'error' ->> 'code','(null)');

  -- A code that names nothing is a 404, not a silent null: an introduction
  -- filed against the wrong unit is worse than one filed against none.
  a := ops_mkt.add_referral('agn-84-01','Pak Hadi','PH-1','TL-9999');
  assert a -> 'error' ->> 'code' = 'not_found', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');

  a := ops_mkt.add_referral('agn-84-01','Pak Hadi','PH-1','TL-8401','0812-1111', null,'k-84-add');
  assert ops_core.said_ok(a), 'got ' || coalesce(a -> 'error' ->> 'code', a::text);
  assert a -> 'data' ->> 'referral_no' like 'lead-%',
    'the number keeps the shape the team reads, got ' || coalesce(a -> 'data' ->> 'referral_no','(null)');
  assert a -> 'data' ->> 'status' = 'LEAD', 'every introduction starts as one';
  assert (a -> 'data' ->> 'rep_active')::boolean, 'and this rep is working';

  select * into v from ops_mkt.v_referral where referral_no = a -> 'data' ->> 'referral_no';
  assert v.owner_name = 'Pak Hadi',   'got ' || coalesce(v.owner_name,'(null)');
  assert v.rep_no = 'agn-84-01',      'got ' || coalesce(v.rep_no,'(null)');
  assert v.commission_amount is null, 'nothing is owed on a lead';

  -- **Warned, not refused** (A6): recording an introduction against somebody we
  -- have stopped working with is odd rather than impossible, and the screen is
  -- where that conversation happens.
  a := ops_mkt.add_referral('agn-84-02','Bu Ratna');
  assert ops_core.said_ok(a), 'got ' || coalesce(a -> 'error' ->> 'code', a::text);
  assert not (a -> 'data' ->> 'rep_active')::boolean, 'but the answer says so';

  -- A retry is the earlier answer, not a second introduction.
  a := ops_mkt.add_referral('agn-84-01','Pak Hadi','PH-1','TL-8401','0812-1111', null,'k-84-add');
  assert a ->> 'outcome' = 'duplicate', 'got ' || coalesce(a ->> 'outcome','(null)');
  assert (select count(*) from ops_mkt.referrals where owner_name = 'Pak Hadi') = 1, 'one Pak Hadi';
end $$;

/* ── REFUSAL: what `WON` needs before it means anything ────────────────── */
do $$
declare a jsonb; v_no text;
begin
  select referral_no into v_no from ops_mkt.referrals where owner_name = 'Pak Hadi';

  a := ops_mkt.set_referral_status(v_no,'WON');
  assert a -> 'error' ->> 'code' = 'project_required',
    'a percentage of a hoped-for size is a figure the agent quotes back at us (D186), got '
    || coalesce(a -> 'error' ->> 'code','(null)');

  a := ops_mkt.set_referral_status(v_no,'WON','PRJ-HANTU');
  assert a -> 'error' ->> 'code' = 'not_found', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');

  -- A real job nobody has valued. The trigger from 0080 refuses this too; here
  -- it says which figure is missing and where to go and put it.
  a := ops_mkt.set_referral_status(v_no,'WON','PRJ-85');
  assert a -> 'error' ->> 'code' = 'value_required', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');
  assert a -> 'error' ->> 'message' like '%PRJ-85%', 'naming the project, got '
    || coalesce(a -> 'error' ->> 'message','(null)');

  a := ops_mkt.set_referral_status(v_no,'LOST');
  assert a -> 'error' ->> 'code' = 'reason_required', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');

  assert (select status from ops_mkt.referrals where referral_no = v_no) = 'LEAD',
    'four refusals and it has not moved';
end $$;

/* ── DERIVATION: what it is now worth, handed back ─────────────────────── */
do $$
declare a jsonb; v_no text; r record;
begin
  select referral_no into v_no from ops_mkt.referrals where owner_name = 'Pak Hadi';

  a := ops_mkt.set_referral_status(v_no,'QUOTED');
  assert ops_core.said_ok(a), 'got ' || coalesce(a -> 'error' ->> 'code', a::text);
  assert a -> 'data' ->> 'commission_amount' is null,
    'a quote is work, not revenue, and owes nobody anything (D186)';

  a := ops_mkt.set_referral_status(v_no,'WON','PRJ-84');
  assert ops_core.said_ok(a), 'got ' || coalesce(a -> 'error' ->> 'code', a::text);
  -- The caller moved a status; what they want to know is what it is worth.
  assert (a -> 'data' ->> 'commission_amount')::bigint = 12500000,
    '500 juta × 2,5%, got ' || coalesce(a -> 'data' ->> 'commission_amount','(null)');
  assert (a -> 'data' ->> 'contract_value')::bigint = 500000000,
    'read from the project, never copied beside it (C15), got '
    || coalesce(a -> 'data' ->> 'contract_value','(null)');

  select * into r from ops_mkt.v_rep where rep_no = 'agn-84-01';
  assert r.commission_unpaid = 12500000, 'the number that matters, got '
    || coalesce(r.commission_unpaid::text,'(null)');
end $$;

/* ── REFUSAL and DERIVATION: which ledger row paid it ──────────────────── */
do $$
declare a jsonb; v_no text; v_other text; r record;
begin
  select referral_no into v_no    from ops_mkt.referrals where owner_name = 'Pak Hadi';
  select referral_no into v_other from ops_mkt.referrals where owner_name = 'Bu Ratna';

  a := ops_mkt.record_commission_paid(v_no,'  ');
  assert a -> 'error' ->> 'code' = 'trx_required', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');

  a := ops_mkt.record_commission_paid(v_other,'trx-26-09-21_001');
  assert a -> 'error' ->> 'code' = 'not_won',
    'nothing is owed on an introduction that has not become a job, got '
    || coalesce(a -> 'error' ->> 'code','(null)');

  a := ops_mkt.record_commission_paid(v_no,'trx-26-09-21_001');
  assert ops_core.said_ok(a), 'got ' || coalesce(a -> 'error' ->> 'code', a::text);
  assert (a -> 'data' ->> 'amount')::bigint = 12500000, 'got ' || coalesce(a -> 'data' ->> 'amount','(null)');

  select * into r from ops_mkt.v_rep where rep_no = 'agn-84-01';
  assert r.commission_paid = 12500000,  'got ' || coalesce(r.commission_paid::text,'(null)');
  assert r.commission_unpaid = 0,       'and nothing is outstanding, got ' || coalesce(r.commission_unpaid::text,'(null)');

  a := ops_mkt.record_commission_paid(v_no,'trx-26-09-21_002');
  assert a -> 'error' ->> 'code' = 'already_paid', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');
end $$;

/* ── REFUSAL: a settled commission is finished ─────────────────────────── */
do $$
declare a jsonb; v_no text; n int;
begin
  select referral_no into v_no from ops_mkt.referrals where owner_name = 'Pak Hadi';

  a := ops_mkt.set_referral_status(v_no,'QUOTED');
  assert a -> 'error' ->> 'code' = 'already_paid',
    'the status cannot go back behind a payment, got ' || coalesce(a -> 'error' ->> 'code','(null)');

  -- **The other factor in the multiplication.** 0080 froze the rate once
  -- something had been paid against it; the project was left open, and
  -- re-pointing a settled referral at a 900-juta contract grows the commission
  -- past what the bank actually sent (F118).
  begin
    a := ops_mkt.set_referral_status(v_no,'WON','PRJ-86');
    raise exception 're-pointing a paid referral should be refused, got %', coalesce(a::text,'(null)');
  exception when check_violation then
    assert sqlerrm like '%cannot be changed to PRJ-86%', 'got ' || sqlerrm;
  end;

  -- And which row paid is a fact, not a field: a correction is another entry.
  begin
    update ops_mkt.referrals set commission_trx_no = 'trx-26-09-21_009' where referral_no = v_no;
    raise exception 'rewriting which row paid should be refused';
  exception when check_violation then null;
  end;

  select count(*) into n from ops_mkt.referrals
   where referral_no = v_no and project_code = 'PRJ-84' and commission_trx_no = 'trx-26-09-21_001';
  assert n = 1, 'and the settled figures are where they were, got ' || n;
end $$;

/* ── DERIVATION: the acts leave a trail ────────────────────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000008403';
do $$
declare n int;
begin
  select count(*) into n from ops_core.outbox where event_type = 'marketing.referral.won';
  assert n = 1, 'got ' || n;
  select count(*) into n from ops_core.outbox where event_type = 'marketing.commission.paid';
  assert n = 1, 'got ' || n;
  select count(*) into n from ops_core.audit_log
   where service = 'marketing' and action = 'create' and entity = 'market' and outcome = 'ok';
  assert n = 2, 'two markets defined, got ' || n;
  -- Every refusal above is on it too, which is what makes *who has been trying
  -- to change this* answerable.
  select count(*) into n from ops_core.audit_log
   where service = 'marketing' and entity = 'market' and outcome <> 'ok';
  assert n = 8, 'and eight attempts that were turned away — a read grant, five malformed '
                'markets, one already defined and one that does not exist, got ' || n;
end $$;

rollback;
