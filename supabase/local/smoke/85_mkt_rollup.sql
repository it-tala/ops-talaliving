-- mkt — the scrape's numbers at whichever altitude was asked for (D181, D187).
--
--   DERIVATIONS  one filter, **three altitudes** — a prefix of the market code
--                serves country, city and district, and the grouping is the
--                database's rather than the reader's; a group that **spans two
--                currencies says so**, because a mean across dollars and
--                rupiah is not a number and nothing here invents a rate
--
-- Worked out first:  AU 6 scraped · ID 2 · Gold Coast 4 · Sydney 2

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-000000008501','mkt85@talaliving.com','{"full_name":"Staf Marketing"}'),
  ('ffffffff-0000-0000-0000-000000008502','tukang85@talaliving.com','{"full_name":"Tukang"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-000000008501','marketing','write'),
  ('ffffffff-0000-0000-0000-000000008502','production','write');

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000008501';

insert into ops_mkt.markets (code, country_code, country_name, region, city, area_label, currency, timezone) values
  ('AU-QLD-GOLDCOAST-SPNORTH', 'AU','Australia','Queensland','Gold Coast','SP NORTH', 'AUD','Australia/Brisbane'),
  ('AU-QLD-GOLDCOAST-SPMIDDLE','AU','Australia','Queensland','Gold Coast','SP MIDDLE','AUD','Australia/Brisbane'),
  ('AU-NSW-SYDNEY-CBD',        'AU','Australia','New South Wales','Sydney','CBD',      'AUD','Australia/Sydney'),
  ('ID-BALI-SEMINYAK',         'ID','Indonesia', null,      'Bali','Seminyak',         'IDR','Asia/Makassar'),
  -- The resorts here quote in dollars, which is ordinary and is exactly why
  -- the currency rides on the market rather than on the row.
  ('ID-BALI-NUSADUA',          'ID','Indonesia', null,      'Bali','Nusa Dua',         'USD','Asia/Makassar');

insert into ops_mkt.properties (ref, market_code, name) values
  ('TL-8501','AU-QLD-GOLDCOAST-SPNORTH','Meriton Suites');

insert into ops_mkt.scrape_rows (market_code, name, enriched, property_ref) values
  ('AU-QLD-GOLDCOAST-SPNORTH','Meriton Suites',   true,'TL-8501'),
  ('AU-QLD-GOLDCOAST-SPNORTH','Peppers Broadbeach', true, null),
  ('AU-QLD-GOLDCOAST-SPNORTH','Hilton Surfers',   false, null),
  ('AU-QLD-GOLDCOAST-SPMIDDLE','Oracle Boulevard',false, null),
  ('AU-NSW-SYDNEY-CBD','Meriton World Tower',     true, null),
  ('AU-NSW-SYDNEY-CBD','The Star Residences',     false, null),
  ('ID-BALI-SEMINYAK','Villa Kayu',               true, null),
  ('ID-BALI-NUSADUA','Kayon Resort',              false, null);

/* ── DERIVATION: one filter, three altitudes ───────────────────────────── */
do $$
declare r record; n int;
begin
  select count(*) into n from ops_mkt.scrape_rollup(null,'area');
  assert n = 5, 'one row per district, got ' || n;

  select * into r from ops_mkt.scrape_rollup(null,'area') where key = 'AU-QLD-GOLDCOAST-SPNORTH';
  assert r.scraped = 3,   'got ' || coalesce(r.scraped::text,'(null)');
  assert r.enriched = 2,  'the enrichment run has been through two, got ' || coalesce(r.enriched::text,'(null)');
  assert r.converted = 1, 'and one became a property, got ' || coalesce(r.converted::text,'(null)');
  assert r.label = 'Australia · Queensland · Gold Coast · SP NORTH', 'got ' || coalesce(r.label,'(null)');

  -- A city is two districts added up, and the reader never had to know which.
  select count(*) into n from ops_mkt.scrape_rollup(null,'city');
  assert n = 3, 'Gold Coast, Sydney, Bali, got ' || n;
  select * into r from ops_mkt.scrape_rollup(null,'city') where key = 'AU|Gold Coast';
  assert r.scraped = 4,  'three in SP NORTH and one in SP MIDDLE, got ' || coalesce(r.scraped::text,'(null)');
  assert r.label = 'Australia · Gold Coast', 'got ' || coalesce(r.label,'(null)');

  select count(*) into n from ops_mkt.scrape_rollup(null,'country');
  assert n = 2, 'got ' || n;
  select * into r from ops_mkt.scrape_rollup(null,'country') where key = 'AU';
  assert r.scraped = 6,  'got ' || coalesce(r.scraped::text,'(null)');
  assert r.enriched = 3, 'got ' || coalesce(r.enriched::text,'(null)');
end $$;

/* ── DERIVATION: the scope is a prefix of the code ─────────────────────── */
do $$
declare r record; n int;
begin
  select count(*) into n from ops_mkt.scrape_rollup('AU','city');
  assert n = 2, 'two Australian cities, got ' || n;

  -- The same filter, one altitude down, and Sydney disappears without anybody
  -- having to know it was a different state.
  select count(*) into n from ops_mkt.scrape_rollup('AU-QLD-GOLDCOAST','city');
  assert n = 1, 'got ' || n;
  select * into r from ops_mkt.scrape_rollup('AU-QLD-GOLDCOAST','city');
  assert r.scraped = 4, 'got ' || coalesce(r.scraped::text,'(null)');

  select count(*) into n from ops_mkt.scrape_rollup('AU-QLD-GOLDCOAST-SPNORTH','area');
  assert n = 1, 'one district, got ' || n;

  -- A scope nobody has scraped is no rows, not a row of noughts: *we have not
  -- looked here* and *we looked and found nothing* are different answers.
  select count(*) into n from ops_mkt.scrape_rollup('NZ','country');
  assert n = 0, 'got ' || n;
end $$;

/* ── DERIVATION: a group that spans two currencies says so ─────────────── */
do $$
declare r record;
begin
  select * into r from ops_mkt.scrape_rollup(null,'area') where key = 'ID-BALI-NUSADUA';
  assert r.currencies = array['USD'], 'one district, one currency, got '
    || coalesce(array_to_string(r.currencies,'/'),'(null)');

  -- **Bali is quoted in two.** Nothing in this module adds them together and no
  -- rate is invented to make it possible (D181), so the figure that could be
  -- misread carries the reason it must not be — rather than leaving whoever
  -- draws the tile to find out from a customer.
  select * into r from ops_mkt.scrape_rollup(null,'city') where key = 'ID|Bali';
  assert r.scraped = 2, 'got ' || coalesce(r.scraped::text,'(null)');
  assert cardinality(r.currencies) = 2, 'got ' || coalesce(cardinality(r.currencies)::text,'(null)');
  assert r.currencies = array['IDR','USD'], 'named, and in a stable order, got '
    || coalesce(array_to_string(r.currencies,'/'),'(null)');

  select * into r from ops_mkt.scrape_rollup(null,'country') where key = 'AU';
  assert r.currencies = array['AUD'], 'and a country that is all one currency says that too, got '
    || coalesce(array_to_string(r.currencies,'/'),'(null)');
end $$;

/* ── REFUSAL: the roll-up is over rows the reader can see ──────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000008502';
do $$
declare n int;
begin
  select count(*) into n from ops_mkt.scrape_rollup(null,'country');
  assert n = 0, 'the outreach half is marketing''s alone, got ' || n;
end $$;

rollback;
