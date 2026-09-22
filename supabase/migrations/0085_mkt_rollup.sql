-- 0085_mkt_rollup.sql — the scrape's numbers at whichever altitude was asked
-- for, which is the one thing `pipeline()` does not answer.
--
-- `0081` gave the pipeline its totals and `v_scrape_by_market` the per-market
-- breakdown. Between them sits the question the screen actually asks: *how is
-- the scrape doing in Australia*, then *in Gold Coast*, then *in SP NORTH* —
-- one filter and three altitudes (D187).
--
-- It belongs in SQL rather than in whoever is reading, for the reason the
-- grouping itself does: `AU` is a country, `AU-QLD-GOLDCOAST` a city and the
-- whole code a district, and a client that reimplements that rule is a client
-- that will disagree with the database about which rows are in Queensland.
--
-- **The currency travels with the group.** Nothing in this module adds two of
-- them together and no rate is invented to make it possible (D181), so a group
-- that spans currencies says so in the row rather than leaving whoever draws
-- the tile to find out later.
create or replace function ops_mkt.scrape_rollup(
  p_scope text default null,
  p_level text default 'area')
returns table (
  key        text,
  label      text,
  scraped    int,
  enriched   int,
  converted  int,
  currencies text[])
language sql stable set search_path = ops_mkt, pg_temp as $$
  with scoped as (
    select s.*, m.country_code, m.country_name, m.city, m.code, m.full_path, m.currency
      from ops_mkt.scrape_rows s
      join ops_mkt.v_market m on m.code = s.market_code
     where p_scope is null or s.market_code = p_scope
        or s.market_code like p_scope || '-%'
  ),
  grouped as (
    select
      case p_level
        when 'country' then country_code
        when 'city'    then country_code || '|' || city
        else code
      end as key,
      case p_level
        when 'country' then country_name
        when 'city'    then country_name || ' · ' || city
        else full_path
      end as label,
      enriched, property_ref, currency
    from scoped
  )
  select
    g.key,
    min(g.label),
    count(*)::int                                       as scraped,
    count(*) filter (where g.enriched)::int             as enriched,
    count(*) filter (where g.property_ref is not null)::int as converted,
    array_agg(distinct g.currency order by g.currency)  as currencies
  from grouped g
  group by g.key
  order by min(g.label)
$$;

grant execute on function ops_mkt.scrape_rollup(text, text) to authenticated;
