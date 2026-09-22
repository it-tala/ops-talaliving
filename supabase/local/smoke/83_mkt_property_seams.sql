-- mkt — the file arriving from outside, and the judgements a person makes on
-- what it brought (D143, D184, D187).
--
--   REFUSALS     importing or promoting with a read grant; a file with no
--                rows; a scraped name nobody has; **promoting the same row
--                twice**, answered with the ref it already has; a score of
--                seven; a bare `DISQUALIFIED`; disqualifying with no reason
--   DERIVATIONS  `skipped` is **three different things** and each is counted
--                apart, with the unknown market **named** rather than merely
--                counted; the same hotel twice inside one file is one row;
--                re-running the file adds nothing; a promoted property takes
--                **the next ref the tracker has not already used**; promoting
--                never sets `validated`; validating signs, un-validating
--                unsigns; a disqualification composes its own string
--
-- Worked out first, for the eight rows in the file:
--   added 2 · already here 2 · unknown market 2 · blank 2 · skipped 6

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-000000008301','mkt83@talaliving.com','{"full_name":"Staf Marketing"}'),
  ('ffffffff-0000-0000-0000-000000008302','lihat83@talaliving.com','{"full_name":"Pimpinan"}'),
  ('ffffffff-0000-0000-0000-000000008303','it83@talaliving.com','{"full_name":"Staf IT"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-000000008301','marketing','write'),
  ('ffffffff-0000-0000-0000-000000008302','marketing','read'),
  ('ffffffff-0000-0000-0000-000000008303','it','read');

-- **A sequence is not rolled back.** Everything else in this file disappears
-- at the `rollback` below, and `property_ref_seq` does not: `nextval` is
-- deliberately non-transactional, so the second run of this file would mint
-- `TL-0006` where the first minted `TL-0003` and the assertions below would
-- fail for a reason that has nothing to do with the code. So the file places
-- the sequence itself, before taking the role that may not (F119).
select setval('ops_mkt.property_ref_seq', 1, false);

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000008301';

insert into ops_mkt.markets (code, country_code, country_name, region, city, area_label, currency, timezone)
values ('AU-QLD-GOLDCOAST-SPNORTH','AU','Australia','Queensland','Gold Coast','SP NORTH','AUD','Australia/Brisbane');

-- Two properties that came in from the old tracker **with their own refs**.
-- Nothing minted them, and nothing may hand either number out again.
insert into ops_mkt.properties (ref, market_code, name, score) values
  ('TL-0001','AU-QLD-GOLDCOAST-SPNORTH','Q1 Resort', 4),
  ('TL-0002','AU-QLD-GOLDCOAST-SPNORTH','Soul Surfers', 3);

-- And one scraped name from a run last week, to stand for *already here*.
insert into ops_mkt.scrape_rows (market_code, name) values
  ('AU-QLD-GOLDCOAST-SPNORTH','Hilton Surfers');

/* ── REFUSAL: a read grant may look at the pipeline, not feed it ───────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000008302';
do $$
declare a jsonb; n int;
begin
  a := ops_mkt.import_scrape('scrape.csv', '[{"market_code":"AU-QLD-GOLDCOAST-SPNORTH","name":"X"}]'::jsonb);
  assert a -> 'error' ->> 'code' = 'not_permitted', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');
  a := ops_mkt.promote_scrape_row('AU-QLD-GOLDCOAST-SPNORTH','Hilton Surfers');
  assert a -> 'error' ->> 'code' = 'not_permitted', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');
  a := ops_mkt.validate_property('TL-0001', true);
  assert a -> 'error' ->> 'code' = 'not_permitted', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');
  a := ops_mkt.set_property_status('TL-0001', false,'bukan strata');
  assert a -> 'error' ->> 'code' = 'not_permitted', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');

  select count(*) into n from ops_mkt.scrape_rows;
  assert n = 1, 'nothing was imported on the way to being refused, got ' || n;
  select count(*) into n from ops_mkt.properties;
  assert n = 2, 'and nothing promoted, got ' || n;
end $$;

set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000008301';

/* ── REFUSAL: a file with nothing in it ────────────────────────────────── */
do $$
declare a jsonb;
begin
  a := ops_mkt.import_scrape('kosong.csv', '[]'::jsonb);
  assert a -> 'error' ->> 'code' = 'no_rows', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');
  a := ops_mkt.import_scrape('kosong.csv', null);
  assert a -> 'error' ->> 'code' = 'no_rows', 'a file that would not parse is the same answer';
end $$;

/* ── DERIVATION: skipped is three different things ─────────────────────── */
do $$
declare a jsonb; n int; v_import uuid;
begin
  a := ops_mkt.import_scrape('scrape-26-09-21.csv', $j$[
    {"market_code":"AU-QLD-GOLDCOAST-SPNORTH","name":"Meriton Suites","maps_url":"https://maps/x","enriched":true},
    {"market_code":"AU-QLD-GOLDCOAST-SPNORTH","name":"meriton suites"},
    {"market_code":"AU-QLD-GOLDCOAST-SPNORTH","name":"Peppers Broadbeach"},
    {"market_code":"AU-QLD-BRISBANE-CBD","name":"Emporium"},
    {"market_code":"AU-QLD-BRISBANE-CBD","name":"Fantauzzo"},
    {"market_code":"AU-QLD-GOLDCOAST-SPNORTH","name":"   "},
    {"market_code":"","name":"Tanpa pasar"},
    {"market_code":"AU-QLD-GOLDCOAST-SPNORTH","name":"Hilton Surfers"}
  ]$j$::jsonb, 'k-83-import');
  assert ops_core.said_ok(a), 'got ' || coalesce(a -> 'error' ->> 'code', a::text);

  assert (a -> 'data' ->> 'added')::int = 2,
    'the Meriton and the Peppers, got ' || coalesce(a -> 'data' ->> 'added','(null)');
  -- **One number for all three would be a number somebody has to guess at.**
  assert (a -> 'data' ->> 'blank')::int = 2,
    'a nameless row and a marketless one, got ' || coalesce(a -> 'data' ->> 'blank','(null)');
  assert (a -> 'data' ->> 'unknown_market')::int = 2,
    'two rows for a city nobody has set up, got ' || coalesce(a -> 'data' ->> 'unknown_market','(null)');
  assert (a -> 'data' ->> 'already_here')::int = 2,
    'the Hilton from last week and the Meriton typed twice in this file, got '
    || coalesce(a -> 'data' ->> 'already_here','(null)');
  assert (a -> 'data' ->> 'skipped')::int = 6,
    'and skipped is still their sum, so nothing that reads it breaks, got '
    || coalesce(a -> 'data' ->> 'skipped','(null)');

  -- Named, not merely counted: *two rows we could not place* sends somebody
  -- looking, `AU-QLD-BRISBANE-CBD` sends them somewhere (D187).
  assert a -> 'data' -> 'unknown_markets' = '["AU-QLD-BRISBANE-CBD"]'::jsonb,
    'the code is handed back, once, got ' || coalesce((a -> 'data' -> 'unknown_markets')::text,'(null)');

  -- Nothing was invented for a row that could not be placed.
  select count(*) into n from ops_mkt.scrape_rows where market_code = 'AU-QLD-BRISBANE-CBD';
  assert n = 0, 'no market was conjured for it, got ' || n;
  select count(*) into n from ops_mkt.markets;
  assert n = 1, 'nor a market row, got ' || n;

  -- The same hotel twice **inside one file** is one row, not a unique
  -- violation that throws the whole import away.
  select count(*) into n from ops_mkt.scrape_rows where lower(name) = 'meriton suites';
  assert n = 1, 'got ' || n;

  -- Every row the file added carries the same import, so a re-import is
  -- traceable to the file it came from rather than to a timestamp.
  v_import := (a -> 'data' ->> 'import_id')::uuid;
  select count(*) into n from ops_mkt.scrape_rows where import_id = v_import;
  assert n = 2, 'both new rows carry the import, got ' || n;
end $$;

/* ── DERIVATION: running the same file again adds nothing ──────────────── */
do $$
declare a jsonb; n int;
begin
  a := ops_mkt.import_scrape('scrape-26-09-21.csv', $j$[
    {"market_code":"AU-QLD-GOLDCOAST-SPNORTH","name":"Meriton Suites"},
    {"market_code":"AU-QLD-GOLDCOAST-SPNORTH","name":"meriton suites"},
    {"market_code":"AU-QLD-GOLDCOAST-SPNORTH","name":"Peppers Broadbeach"},
    {"market_code":"AU-QLD-BRISBANE-CBD","name":"Emporium"},
    {"market_code":"AU-QLD-BRISBANE-CBD","name":"Fantauzzo"},
    {"market_code":"AU-QLD-GOLDCOAST-SPNORTH","name":"   "},
    {"market_code":"","name":"Tanpa pasar"},
    {"market_code":"AU-QLD-GOLDCOAST-SPNORTH","name":"Hilton Surfers"}
  ]$j$::jsonb);
  assert (a -> 'data' ->> 'added')::int = 0,
    'the second run is a no-op, got ' || coalesce(a -> 'data' ->> 'added','(null)');
  assert (a -> 'data' ->> 'already_here')::int = 4,
    'four names it has seen, got ' || coalesce(a -> 'data' ->> 'already_here','(null)');
  select count(*) into n from ops_mkt.scrape_rows;
  assert n = 3, 'three scraped names in all, got ' || n;

  -- A retry with the same key is the earlier answer coming back, not a third run.
  a := ops_mkt.import_scrape('scrape-26-09-21.csv','[{"market_code":"AU-QLD-GOLDCOAST-SPNORTH","name":"Baru"}]'::jsonb,
                             'k-83-import');
  assert a ->> 'outcome' = 'duplicate', 'got ' || coalesce(a ->> 'outcome','(null)');
  select count(*) into n from ops_mkt.scrape_rows;
  assert n = 3, 'and nothing was added by the replay, got ' || n;
end $$;

/* ── REFUSAL and DERIVATION: promoting ─────────────────────────────────── */
do $$
declare a jsonb; b jsonb; p record; s record;
begin
  a := ops_mkt.promote_scrape_row('AU-QLD-GOLDCOAST-SPNORTH','Tidak ada');
  assert a -> 'error' ->> 'code' = 'not_found', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');

  a := ops_mkt.promote_scrape_row('AU-QLD-GOLDCOAST-SPNORTH','Peppers Broadbeach','QUALIFIED', null, null, 7);
  assert a -> 'error' ->> 'code' = 'score_out_of_range',
    'nought to five, got ' || coalesce(a -> 'error' ->> 'code','(null)');

  -- The table refuses a bare `DISQUALIFIED` too; said here it names the field.
  a := ops_mkt.promote_scrape_row('AU-QLD-GOLDCOAST-SPNORTH','Peppers Broadbeach','DISQUALIFIED');
  assert a -> 'error' ->> 'code' = 'bad_status', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');

  a := ops_mkt.promote_scrape_row('AU-QLD-GOLDCOAST-SPNORTH','peppers broadbeach','QUALIFIED', 120, 340, 4,
                                  'dekat pantai');
  assert ops_core.said_ok(a), 'the name is matched the way the unique index does, got '
    || coalesce(a -> 'error' ->> 'code', a::text);

  -- **TL-0003.** A sequence knows nothing about the two refs the tracker
  -- already used, so the mint steps over them rather than handing out a
  -- number that is on somebody's screen.
  assert a -> 'data' ->> 'ref' = 'TL-0003', 'got ' || coalesce(a -> 'data' ->> 'ref','(null)');

  select * into p from ops_mkt.v_property where ref = 'TL-0003';
  assert p.name = 'Peppers Broadbeach', 'the scraped name, as scraped, got ' || coalesce(p.name,'(null)');
  assert p.market_code = 'AU-QLD-GOLDCOAST-SPNORTH', 'got ' || coalesce(p.market_code,'(null)');
  assert p.rooms = 120 and p.adr = 340, 'what the person typed came with it';
  assert p.score = 4, 'got ' || coalesce(p.score::text,'(null)');
  -- Promoting is *worth approaching*. Agreeing with the machine's score is a
  -- different act with somebody's name on it (D184), and this is not it.
  assert not p.validated, 'promoting never validates';

  -- The scraped row now points at what it became, which is what makes the
  -- second promotion answerable.
  select * into s from ops_mkt.scrape_rows where lower(name) = 'peppers broadbeach';
  assert s.property_ref = 'TL-0003', 'got ' || coalesce(s.property_ref,'(null)');

  b := ops_mkt.promote_scrape_row('AU-QLD-GOLDCOAST-SPNORTH','Peppers Broadbeach');
  assert b -> 'error' ->> 'code' = 'already_promoted',
    'twice would put one hotel on the list under two refs, got ' || coalesce(b -> 'error' ->> 'code','(null)');
  assert b -> 'error' ->> 'message' like '%TL-0003%',
    'and the answer says which ref it already has, got ' || coalesce(b -> 'error' ->> 'message','(null)');

  -- The next one carries on from there.
  b := ops_mkt.promote_scrape_row('AU-QLD-GOLDCOAST-SPNORTH','Meriton Suites');
  assert b -> 'data' ->> 'ref' = 'TL-0004', 'got ' || coalesce(b -> 'data' ->> 'ref','(null)');
end $$;

/* ── DERIVATION: validating signs, un-validating unsigns ───────────────── */
do $$
declare a jsonb; p ops_mkt.properties;
begin
  a := ops_mkt.validate_property('TL-9999', true);
  assert a -> 'error' ->> 'code' = 'not_found', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');

  a := ops_mkt.validate_property('TL-0003', true,'sudah dicek di Maps, 120 kamar benar');
  assert ops_core.said_ok(a), 'got ' || coalesce(a -> 'error' ->> 'code', a::text);

  select * into p from ops_mkt.properties where ref = 'TL-0003';
  assert p.validated, 'the score is no longer only a machine''s opinion (D184)';
  -- The signature and the claim go on together; `validation_is_signed` says the
  -- same, and this is the only writer that gets it right without being told.
  assert p.validated_by = 'ffffffff-0000-0000-0000-000000008301',
    'with the name of whoever agreed, got ' || coalesce(p.validated_by::text,'(null)');
  assert p.validated_at is not null, 'and when';
  assert p.notes = 'sudah dicek di Maps, 120 kamar benar', 'got ' || coalesce(p.notes,'(null)');

  -- Taking it back takes the signature with it.
  a := ops_mkt.validate_property('TL-0003', false,'ternyata 120 itu unit, bukan kamar');
  assert ops_core.said_ok(a), 'got ' || coalesce(a -> 'error' ->> 'code', a::text);
  select * into p from ops_mkt.properties where ref = 'TL-0003';
  assert not p.validated,           'back to unchecked';
  assert p.validated_by is null,    'and nobody is signed against it';
  assert p.validated_at is null,    'nor a time';
end $$;

/* ── DERIVATION: the disqualification composes its own string ──────────── */
do $$
declare a jsonb; p record;
begin
  a := ops_mkt.set_property_status('TL-0004', false);
  assert a -> 'error' ->> 'code' = 'reason_required',
    'a disqualification with no reason cannot be read a year later, got '
    || coalesce(a -> 'error' ->> 'code','(null)');

  a := ops_mkt.set_property_status('TL-0004', false,'not condo');
  assert ops_core.said_ok(a), 'got ' || coalesce(a -> 'error' ->> 'code', a::text);
  -- Verbatim as the tracker writes it, and composed in one place rather than
  -- by every caller slightly differently.
  assert a -> 'data' ->> 'status' = 'DISQUALIFIED — NOT CONDO',
    'got ' || coalesce(a -> 'data' ->> 'status','(null)');

  select * into p from ops_mkt.v_property where ref = 'TL-0004';
  assert not p.qualified, 'and the view agrees';
  assert p.status = 'DISQUALIFIED — NOT CONDO', 'got ' || coalesce(p.status,'(null)');

  -- Back again, and the reason goes with it: the status holds one claim.
  a := ops_mkt.set_property_status('TL-0004', true);
  assert a -> 'data' ->> 'status' = 'QUALIFIED', 'got ' || coalesce(a -> 'data' ->> 'status','(null)');
end $$;

/* ── DERIVATION: the acts leave a trail ────────────────────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000008303';
do $$
declare n int;
begin
  select count(*) into n from ops_core.audit_log
   where service = 'marketing' and action = 'import' and entity_no = 'scrape-26-09-21.csv'
     and outcome = 'ok';
  assert n = 2, 'the file was run twice and both runs are on the trail, got ' || n;

  -- The two halves of a validation are two different acts on the trail, which
  -- is what makes *who un-validated this, and when* answerable.
  select count(*) into n from ops_core.audit_log
   where service = 'marketing' and action = 'validate' and entity_no = 'TL-0003';
  assert n = 1, 'got ' || n;
  select count(*) into n from ops_core.audit_log
   where service = 'marketing' and action = 'unvalidate' and entity_no = 'TL-0003';
  assert n = 1, 'got ' || n;

  select count(*) into n from ops_core.outbox where event_type = 'marketing.property.promoted';
  assert n = 2, 'two promotions announced, got ' || n;
  select count(*) into n from ops_core.outbox where event_type = 'marketing.scrape.imported';
  assert n = 2, 'and two imports, got ' || n;
end $$;

rollback;
