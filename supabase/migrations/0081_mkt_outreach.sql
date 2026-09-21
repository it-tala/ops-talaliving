-- 0081_mkt_outreach.sql — the first funnel: finding an agent who will say yes.
--
-- `0080` built the half with money in it and left this one named as a
-- migration of its own. A property is scraped from the map, enriched and
-- scored; up to three agents are found for it; the first is approached, and if
-- seven days pass in silence the next one is, until somebody agrees or the
-- property goes back on the pile (D183).
--
-- ## Three things the spreadsheet cannot do for itself
--
--   **MOVE ON is not a column.** Seven silent days since `sent_on` is a
--   predicate, computed on read. The tracker's own MOVE ON column is one
--   somebody has to maintain, and a column somebody has to maintain is wrong
--   by Friday. The seven is a **setting**, so moving it moves today's queue
--   rather than rewriting any history.
--
--   **The clock is stamped, never typed.** The first message sets the date it
--   runs from and a reply stops it, both in a trigger — so they hold whichever
--   road the row came in by, not only the one the screen uses.
--
--   **A property is at one stage, the furthest any of its agents reached.** A
--   property with one agent at DEAL is not also a property at QUEUED, and
--   counting it in both is how a funnel stops adding up.
--
-- ## The vocabulary is the owner's, verbatim
--
-- `MSG SENT`, `FORM BACK`, `SP NORTH`, `TL-0001`. Translating it would be the
-- one change guaranteed to make the screen unusable by the people who use the
-- sheet today (D183).

-- ── the ladder, and the two values that are not on it ─────────────────────
--
-- `RECYCLED` and `SKIP` are **exits**, not rungs. Postgres orders an enum by
-- declaration, so `stage >= 'REPLIED'` would quietly sweep both of them in —
-- and *gave up on this agent* would count as *this agent replied*. So the
-- comparison never touches the enum: rank is its own function and answers
-- **null** for an exit, which every `>=` then answers false to.
create type ops_mkt.outreach_stage_t as enum (
  'QUEUED','MSG SENT','REPLIED','CALL SET','FORM BACK','PRESENTATION','DEAL',
  'RECYCLED','SKIP');

create or replace function ops_mkt.stage_rank(p_stage ops_mkt.outreach_stage_t)
returns int
language sql immutable as $$
  select case p_stage
           when 'QUEUED'       then 0
           when 'MSG SENT'     then 1
           when 'REPLIED'      then 2
           when 'CALL SET'     then 3
           when 'FORM BACK'    then 4
           when 'PRESENTATION' then 5
           when 'DEAL'         then 6
         end
$$;

-- `mkt.`, not the demo's `ops.` (C16). `check_schema_isolation.sh` reads
-- schema-qualified names out of a migration and `ops` is the legacy system's
-- own schema, so a settings key beginning `ops.` reads as a reference to it and
-- the guard refuses the file. The guard is right to be blunt — it is what makes
-- sharing one Supabase project with the running legacy system safe — and the
-- key is the thing that should move. `kpi.` set the precedent.
insert into ops_core.settings (key, value, note) values
  ('mkt.agent_move_on_days', '7'::jsonb,
   'Silent days after the first message before an agent is past the move-on line and the next of the three is approached (D183). A setting rather than a constant, so moving it moves today''s queue and rewrites no history.');

-- ── where in the world ────────────────────────────────────────────────────
--
-- `SP NORTH` is a district of one city on one coast, and it only reads as a
-- location because everybody in the room shares a country. A flat `area`
-- column becomes a list nobody can group, compare or spell consistently the
-- moment the scrape runs anywhere else (D187).
--
-- Two things ride on the market rather than on the property, because they are
-- properties of the **place** and getting them per row wrong is expensive:
-- the **currency** an ADR is quoted in, and the **time zone**, which is the
-- one question a list of names cannot answer.
create table ops_mkt.markets (
  id            uuid primary key default gen_random_uuid(),
  -- `AU-QLD-GOLDCOAST-SPNORTH`. Every filter in this module is a **prefix** of
  -- it, which is what lets one query serve country, city and district.
  code          text not null unique,
  country_code  text not null check (country_code ~ '^[A-Z]{2}$'),
  country_name  text not null check (length(btrim(country_name)) > 0),
  -- State, province, prefecture. Null where a country has none worth carrying.
  region        text,
  city          text not null check (length(btrim(city)) > 0),
  -- The local label, verbatim: `SP NORTH`, `Seminyak`, `Downtown`.
  area_label    text not null check (length(btrim(area_label)) > 0),
  currency      text not null check (currency ~ '^[A-Z]{3}$'),
  -- IANA. Validated by the trigger below, because a typo here makes *what time
  -- is it there* unanswerable and nothing else would notice.
  timezone      text not null,
  language      text not null default 'en',
  active        boolean not null default true,
  created_at    timestamptz not null default now(),

  -- The prefix rule, enforced rather than hoped for: a code that does not
  -- start with its own country cannot be found by a country filter, and the
  -- row would simply be missing from every roll-up.
  constraint code_starts_with_its_country check (code like country_code || '-%'),
  constraint code_is_upper check (code = upper(code))
);

create or replace function ops_mkt.timezone_is_real()
returns trigger
language plpgsql set search_path = ops_mkt, pg_temp as $$
begin
  begin
    perform now() at time zone new.timezone;
  exception when others then
    raise exception '% is not a time zone Postgres knows; "what time is it there" is the one question a list of names cannot answer',
      new.timezone using errcode = 'check_violation';
  end;
  return new;
end $$;

create trigger timezone_is_real
  before insert or update on ops_mkt.markets
  for each row execute function ops_mkt.timezone_is_real();

-- ── the properties ────────────────────────────────────────────────────────
create table ops_mkt.properties (
  id            uuid primary key default gen_random_uuid(),
  -- `TL-0001`, the tracker's own numbering. **Not minted here**, and not a
  -- breach of ADR-005: that rule governs the numbers this system issues. This
  -- is an outside reference, like a vendor's invoice number — it arrives with
  -- the row and is kept because it is what people say to each other.
  ref           text not null unique check (length(btrim(ref)) > 0),
  -- A foreign key, unlike every other `_code` in this system: both sides are
  -- in `ops_mkt`, so no service seam is crossed and ADR-004 has nothing to say.
  market_code   text not null references ops_mkt.markets(code),
  name          text not null check (length(btrim(name)) > 0),
  maps_url      text,
  address       text,
  -- `QUALIFIED`, or `DISQUALIFIED — <reason>` exactly as the tracker writes
  -- it. A boolean and a separate note would let the reason go missing, and
  -- *why did we drop this one* is the question asked a year later.
  status        text not null default 'QUALIFIED'
    check (status = 'QUALIFIED' or status ~ '^DISQUALIFIED — .+$'),
  -- Strata / condo-titled, which is what makes individual owners the customer
  -- rather than a hotel group. Null is *nobody has looked*, which is not `false`.
  is_condo      boolean,
  rooms         int check (rooms is null or rooms > 0),
  -- In the currency **the market** quotes, never a column here (D181).
  adr           numeric check (adr is null or adr > 0),
  -- `CHECK` when the figure came from one source and looked implausible.
  adr_flag      text,
  chain         text,
  reno_signal   text,
  reno_source   text,
  review_note   text,
  rating        numeric check (rating is null or (rating >= 0 and rating <= 5)),
  -- 0–5 from the enrichment. **Zero means unscored, not bad**, which is why
  -- nothing here treats it as a floor.
  score         int not null default 0 check (score between 0 and 5),
  -- A score is a machine's opinion until a person agrees with it (D184). The
  -- team acts on unvalidated rows — waiting would stall the week — and must
  -- never mistake them for checked ones, so the row says which it is and who.
  validated     boolean not null default false,
  validated_by  uuid references ops_core.users(id),
  validated_at  timestamptz,
  notes         text,
  -- The import that brought it in, so a re-import is a no-op (D143's shape).
  import_id     uuid,
  created_at    timestamptz not null default now(),

  constraint validation_is_signed check (
    validated = (validated_by is not null) and validated = (validated_at is not null))
);

create index properties_market_idx on ops_mkt.properties (market_code);
create index properties_score_idx  on ops_mkt.properties (score desc) where status = 'QUALIFIED';

-- ── three agents, in order ────────────────────────────────────────────────
create table ops_mkt.property_agents (
  id             uuid primary key default gen_random_uuid(),
  property_id    uuid not null references ops_mkt.properties(id),
  -- 1, 2, 3 — the order they are approached in, and the order the move-on rule
  -- walks. Not a timestamp: which one is *next* has to be decidable before
  -- anybody has been messaged.
  slot           int not null check (slot between 1 and 3),
  name           text not null check (length(btrim(name)) > 0),
  agency         text,
  phone          text,
  email          text,
  profile_url    text,
  suburb         text,
  stage          ops_mkt.outreach_stage_t not null default 'QUEUED',
  -- The clock starts here and stops here. Both stamped by the trigger below.
  sent_on        date,
  replied_on     date,
  -- When to chase. Null once they have replied — a reply ends the chase — and
  -- null on an exit.
  next_action_on date,
  remark         text,
  -- Set when this agent said yes and became a representative (D185).
  rep_id         uuid references ops_mkt.sales_reps(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint agent_once_per_slot unique (property_id, slot),
  -- A deal against nobody is a commission nobody can compute (D185).
  constraint deal_names_a_rep check (stage <> 'DEAL' or rep_id is not null),
  -- You cannot answer a message that was never sent.
  constraint replied_after_sent check (
    replied_on is null or (sent_on is not null and replied_on >= sent_on)),
  -- Giving up says why. It is what the next person reads when this agent is
  -- approached again a year later.
  constraint recycling_says_why check (
    stage <> 'RECYCLED' or (remark is not null and length(btrim(remark)) > 0))
);

create index agents_property_idx on ops_mkt.property_agents (property_id, slot);

-- ── the clock, stamped rather than typed ──────────────────────────────────
--
-- In a trigger and not in a seam, deliberately. A date somebody has to
-- remember to fill in is the column that is wrong by Friday (D183), and a
-- stamp that only happens on one code path is the same thing with extra steps.
create or replace function ops_mkt.stamp_the_clock()
returns trigger
language plpgsql set search_path = ops_mkt, pg_temp as $$
declare v_today date := ops_core.office_day();
begin
  -- The clock starts when the message goes out, and only the first time: a row
  -- re-marked `MSG SENT` after a chase must not restart the seven days.
  if new.stage = 'MSG SENT' and new.sent_on is null then
    new.sent_on := v_today;
    new.next_action_on := v_today + coalesce(ops_core.setting_num('mkt.agent_move_on_days'), 7)::int;
  end if;

  -- And stops when they answer, wherever on the ladder the answer arrives:
  -- somebody who books a call has replied, whether or not anybody clicked
  -- REPLIED on the way past.
  --
  -- **Only if there was a message to answer.** An agent met at an event and
  -- signed the same week never sat in silence, and stamping a reply for them
  -- writes a date against a message that does not exist — which
  -- `replied_after_sent` then refuses, correctly. Nothing here invents the
  -- missing send date either (D150): the row says a deal happened and says
  -- nobody recorded messaging them, both of which are true.
  if new.sent_on is not null
     and ops_mkt.stage_rank(new.stage) >= ops_mkt.stage_rank('REPLIED')
     and new.replied_on is null then
    new.replied_on := v_today;
    -- A reply ends the chase. What happens next is a person's move, not a date.
    new.next_action_on := null;
  end if;

  -- An exit is not chased.
  if new.stage in ('RECYCLED','SKIP') then
    new.next_action_on := null;
  end if;

  new.updated_at := now();
  return new;
end $$;

create trigger stamp_the_clock
  before insert or update on ops_mkt.property_agents
  for each row execute function ops_mkt.stamp_the_clock();

-- ── the scrape, before it is anything ─────────────────────────────────────
create table ops_mkt.scrape_rows (
  id           uuid primary key default gen_random_uuid(),
  market_code  text not null references ops_mkt.markets(code),
  name         text not null check (length(btrim(name)) > 0),
  maps_url     text,
  -- The enrichment run has been through it.
  enriched     boolean not null default false,
  -- Became a property, by ref. Null while it is still a name on a list.
  property_ref text references ops_mkt.properties(ref),
  scraped_on   date not null default ops_core.office_day(),
  import_id    uuid,
  created_at   timestamptz not null default now()
);

-- Re-importing the scrape adds nothing. The same hotel arriving twice under
-- the same name in the same market is one row, which is what makes the import
-- safe to run again after it half-failed (D143).
create unique index scrape_once_per_market on ops_mkt.scrape_rows (market_code, lower(name));

-- ── views ─────────────────────────────────────────────────────────────────
create or replace view ops_mkt.v_market as
select
  m.code,
  m.country_code,
  m.country_name,
  m.region,
  m.city,
  m.area_label,
  m.currency,
  m.timezone,
  m.language,
  m.active,
  -- One line to say where, and a whole path for a drawer.
  m.city || ' · ' || m.area_label                                     as label,
  array_to_string(array_remove(
    array[m.country_name, m.region, m.city, m.area_label], null), ' · ') as full_path,
  -- What time it is there, which is the one thing that decides whether to ring.
  (now() at time zone m.timezone)                                     as local_time,
  (select count(*) from ops_mkt.properties p  where p.market_code  = m.code)::int as properties,
  (select count(*) from ops_mkt.scrape_rows s where s.market_code = m.code)::int as scraped
from ops_mkt.markets m;

-- Per agent: how long they have been silent, and whether that is past the
-- line. Both **computed**, and the line itself is a setting.
create or replace view ops_mkt.v_property_agent as
select
  a.id,
  a.property_id,
  p.ref                                     as property_ref,
  p.name                                    as property_name,
  p.market_code,
  a.slot,
  a.name,
  a.agency,
  a.phone,
  a.email,
  a.profile_url,
  a.suburb,
  a.stage,
  ops_mkt.stage_rank(a.stage)               as stage_rank,
  a.sent_on,
  a.replied_on,
  a.next_action_on,
  a.remark,
  a.rep_id,
  -- Silence, in days. Null once they answer: waiting stops being a number the
  -- moment it stops being true.
  case when a.sent_on is not null and a.replied_on is null
       then ops_core.office_day() - a.sent_on end                     as waiting_days,
  -- Past the move-on line. An exit is not waiting, and a deal is not waiting.
  (a.sent_on is not null and a.replied_on is null
   and ops_core.office_day() - a.sent_on
       >= coalesce(ops_core.setting_num('mkt.agent_move_on_days'), 7)
   and a.stage not in ('RECYCLED','SKIP','DEAL'))                     as move_on,
  (a.next_action_on is not null and a.next_action_on <= ops_core.office_day()
   and a.stage not in ('RECYCLED','SKIP','DEAL'))                     as due
from ops_mkt.property_agents a
join ops_mkt.properties p on p.id = a.property_id;

create or replace view ops_mkt.v_property as
select
  p.ref,
  p.market_code,
  mk.label                                  as market_label,
  mk.full_path                              as market_path,
  mk.currency,
  mk.timezone,
  p.name,
  p.maps_url,
  p.address,
  p.status,
  (p.status = 'QUALIFIED')                  as qualified,
  p.is_condo,
  p.rooms,
  p.adr,
  p.adr_flag,
  p.chain,
  p.reno_signal,
  p.reno_source,
  p.rating,
  p.score,
  p.validated,
  p.notes,
  coalesce(ag.agents, 0)                    as agents,
  -- **The furthest any agent reached**, and the property is at that stage and
  -- no other. `QUEUED` where nobody has been approached yet, which is a real
  -- answer rather than a missing one.
  coalesce(ag.best_stage, 'QUEUED')         as best_stage,
  ag.next_agent,
  ag.next_slot,
  coalesce(ag.move_on, 0)                   as agents_past_the_line,
  -- Everybody approached, nobody agreed: the property goes back on the pile
  -- rather than sitting in the funnel for ever.
  coalesce(ag.agents, 0) > 0 and coalesce(ag.in_play, 0) = 0  as exhausted
from ops_mkt.properties p
join ops_mkt.v_market mk on mk.code = p.market_code
left join lateral (
  select
    count(*)::int                                                    as agents,
    count(*) filter (where v.stage not in ('RECYCLED','SKIP'))::int  as in_play,
    count(*) filter (where v.move_on)::int                           as move_on,
    (select v2.stage from ops_mkt.v_property_agent v2
      where v2.property_id = p.id and ops_mkt.stage_rank(v2.stage) is not null
      order by ops_mkt.stage_rank(v2.stage) desc limit 1)            as best_stage,
    -- Who to chase: the first agent still in play, by slot.
    (select v3.name from ops_mkt.v_property_agent v3
      where v3.property_id = p.id and v3.stage not in ('RECYCLED','SKIP')
      order by v3.slot limit 1)                                      as next_agent,
    (select v4.slot from ops_mkt.v_property_agent v4
      where v4.property_id = p.id and v4.stage not in ('RECYCLED','SKIP')
      order by v4.slot limit 1)                                      as next_slot
  from ops_mkt.v_property_agent v where v.property_id = p.id
) ag on true;

-- What to do today, already late first.
create or replace view ops_mkt.v_followup_queue as
select
  v.property_ref,
  v.property_name,
  v.market_code,
  mk.label      as market_label,
  mk.timezone,
  mk.local_time,
  v.id          as agent_id,
  v.name        as agent_name,
  v.slot,
  v.stage,
  case when v.move_on then 'move_on' else 'due' end as kind,
  v.waiting_days,
  v.next_action_on
from ops_mkt.v_property_agent v
join ops_mkt.v_market mk on mk.code = v.market_code
where v.move_on or v.due
order by (case when v.move_on then 0 else 1 end), v.waiting_days desc nulls last, v.property_ref;

-- ── the numbers, at whichever altitude ────────────────────────────────────
--
-- `p_scope` is a **prefix of the market code**: `AU` is a country,
-- `AU-QLD-GOLDCOAST` a city, the whole code one district. One filter, three
-- altitudes, and no screen has to know which is which (D187).
create type ops_mkt.pipeline_t as (
  properties  int,
  qualified   int,
  validated   int,
  messaged    int,
  replied     int,
  reply_rate  numeric,
  forms_back  int,
  deals       int
);

create or replace function ops_mkt.pipeline(p_scope text default null)
returns ops_mkt.pipeline_t
language sql stable set search_path = ops_mkt, pg_temp as $$
  with props as (
    select * from ops_mkt.v_property p
     where p_scope is null or p.market_code = p_scope or p.market_code like p_scope || '-%'
  ),
  ag as (
    select v.* from ops_mkt.v_property_agent v
     join props p on p.ref = v.property_ref
  ),
  counted as (
    select
      (select count(*) from props)::int                                     as properties,
      (select count(*) from props where qualified)::int                     as qualified,
      (select count(*) from props where qualified and validated)::int       as validated,
      -- **Events, not rungs.** `messaged` is *a message went out* and
      -- `replied` is *somebody we messaged answered* — which is what a reply
      -- rate is a rate of. Counting rungs instead gets both ends wrong: an
      -- agent you gave up on is above `MSG SENT` whether or not one was ever
      -- sent, and an agent met at an event and signed the same week is above
      -- `REPLIED` having never been messaged at all. That second case can put
      -- somebody in the numerator and not the denominator, and a reply rate
      -- over a hundred per cent is how you find out (F117).
      (select count(*) from ag where sent_on is not null)::int                as messaged,
      (select count(*) from ag where replied_on is not null)::int             as replied,
      (select count(*) from ag
        where ops_mkt.stage_rank(stage) >= ops_mkt.stage_rank('FORM BACK'))::int as forms_back,
      (select count(*) from ag where stage = 'DEAL')::int                    as deals
  )
  select (
    c.properties, c.qualified, c.validated, c.messaged, c.replied,
    -- **No rate over nothing.** Nought messages is not a nought per cent reply
    -- rate; it is no rate at all, and a zero on that tile would be read as bad
    -- outreach rather than as no outreach.
    case when c.messaged > 0 then round(c.replied * 100.0 / c.messaged, 1) end,
    c.forms_back, c.deals)::ops_mkt.pipeline_t
  from counted c
$$;

-- One row per rung, counting **properties at that rung and no other**.
create or replace function ops_mkt.funnel(p_scope text default null)
returns table (stage ops_mkt.outreach_stage_t, rank int, properties int)
language sql stable set search_path = ops_mkt, pg_temp as $$
  select s.stage, ops_mkt.stage_rank(s.stage),
         (select count(*)::int from ops_mkt.v_property p
           where p.best_stage = s.stage
             and (p_scope is null or p.market_code = p_scope
                  or p.market_code like p_scope || '-%'))
    from (select unnest(enum_range(null::ops_mkt.outreach_stage_t)) as stage) s
   where ops_mkt.stage_rank(s.stage) is not null
   order by ops_mkt.stage_rank(s.stage)
$$;

-- What the scrape has turned into, per market, **with the currency named**.
-- Nothing in this module adds two currencies together and no rate is invented
-- to make it possible (D181), so the figure that could be misread carries the
-- reason it must not be.
create or replace view ops_mkt.v_scrape_by_market as
select
  m.code            as market_code,
  m.full_path,
  m.currency,
  count(s.*)::int                                        as scraped,
  count(*) filter (where s.enriched)::int                as enriched,
  count(*) filter (where s.property_ref is not null)::int as converted
from ops_mkt.v_market m
left join ops_mkt.scrape_rows s on s.market_code = m.code
group by m.code, m.full_path, m.currency;

-- ── access ────────────────────────────────────────────────────────────────
alter table ops_mkt.markets         enable row level security;
alter table ops_mkt.properties      enable row level security;
alter table ops_mkt.property_agents enable row level security;
alter table ops_mkt.scrape_rows     enable row level security;

-- The outreach half has no money in it, so unlike `referrals` it is
-- marketing's alone.
create policy markets_read    on ops_mkt.markets         for select to authenticated
  using (ops_core.has_permission('marketing.read'));
create policy properties_read on ops_mkt.properties      for select to authenticated
  using (ops_core.has_permission('marketing.read'));
create policy agents_read     on ops_mkt.property_agents for select to authenticated
  using (ops_core.has_permission('marketing.read'));
create policy scrape_read     on ops_mkt.scrape_rows     for select to authenticated
  using (ops_core.has_permission('marketing.read'));

create policy markets_new     on ops_mkt.markets for insert to authenticated
  with check (ops_core.has_permission('marketing.create'));
create policy markets_edit    on ops_mkt.markets for update to authenticated
  using (ops_core.has_permission('marketing.update'))
  with check (ops_core.has_permission('marketing.update'));
create policy properties_new  on ops_mkt.properties for insert to authenticated
  with check (ops_core.has_permission('marketing.create'));
create policy properties_edit on ops_mkt.properties for update to authenticated
  using (ops_core.has_permission('marketing.update'))
  with check (ops_core.has_permission('marketing.update'));
create policy agents_new      on ops_mkt.property_agents for insert to authenticated
  with check (ops_core.has_permission('marketing.create'));
create policy agents_edit     on ops_mkt.property_agents for update to authenticated
  using (ops_core.has_permission('marketing.update'))
  with check (ops_core.has_permission('marketing.update'));
create policy scrape_new      on ops_mkt.scrape_rows for insert to authenticated
  with check (ops_core.has_permission('marketing.create'));
create policy scrape_edit     on ops_mkt.scrape_rows for update to authenticated
  using (ops_core.has_permission('marketing.update'))
  with check (ops_core.has_permission('marketing.update'));

-- No DELETE, as everywhere (A2). An agent who was approached and said no is
-- `RECYCLED` with a reason, and that reason is the whole value of having
-- approached them.

alter view ops_mkt.v_market           set (security_invoker = on);
alter view ops_mkt.v_property_agent   set (security_invoker = on);
alter view ops_mkt.v_property         set (security_invoker = on);
alter view ops_mkt.v_followup_queue   set (security_invoker = on);
alter view ops_mkt.v_scrape_by_market set (security_invoker = on);

grant select on all tables in schema ops_mkt to authenticated;
grant insert, update on ops_mkt.markets, ops_mkt.properties,
                        ops_mkt.property_agents, ops_mkt.scrape_rows to authenticated;
grant execute on function ops_mkt.stage_rank(ops_mkt.outreach_stage_t),
                          ops_mkt.pipeline(text), ops_mkt.funnel(text) to authenticated;
