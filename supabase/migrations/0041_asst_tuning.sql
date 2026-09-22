-- 0041_asst_tuning.sql — the list the turns were kept for.
--
-- ── What this is the payoff of ──────────────────────────────────────────
--
-- The owner's answer, asked whether John Lau should use a language model, was
-- *kata kunci dulu, LLM nanti* — keywords first, decide about a model after
-- seeing what people actually type. `0039` stored every turn on the strength
-- of that, including the ones that matched nothing, and then left the list
-- unreachable: a definer function with no screen in front of it.
--
-- A record nobody can read is a record nobody can act on, so the decision it
-- was collected for cannot be made. This finishes it.
--
-- ── Grouped, because that is what makes it a list rather than a log ─────
--
-- Grouped by `normalise()` — the same function the router compares against —
-- so two sentences the router would treat identically are one row here. That
-- is not tidiness: *stoknya menipis* and *stok menipis* are the same question
-- to the matcher, and F64 is the day they were not. Seventeen people asking
-- one thing is a rule worth writing; seventeen different things asked once
-- each is not, and an ungrouped log makes those look the same.
--
-- ── Still nothing about who ─────────────────────────────────────────────
--
-- `actor_id` is not returned, not aggregated, and not filterable. The question
-- is *what did we fail to understand*; adding a name turns it into a different
-- question, and `it.audit` is blocked from the prompt precisely so that
-- question stays hard to ask (D218, D190).
--
-- Which is why these are functions rather than views: RLS withholds rows, and
-- what has to be withheld here is a column.

-- The shape changes, so the old one goes first. `create or replace` may not
-- change a function's return type, and a `cannot change return type` failure
-- mid-ladder is a migration that applied on a fresh database and not on a real
-- one.
drop function if exists ops_asst.unmatched(int);

create or replace function ops_asst.unmatched(p_limit int default 200)
returns table (
  normalised text,
  example    text,
  times      bigint,
  langs      text[],
  first_at   timestamptz,
  last_at    timestamptz)
language plpgsql security definer set search_path = ops_asst, ops_core, pg_temp as $$
begin
  if not ops_core.has_permission('it.read') then
    raise exception 'The tuning list is IT''s — it is everybody''s prompts in one place.'
      using errcode = 'insufficient_privilege';
  end if;

  return query
    select ops_asst.normalise(t.prompt)                       as normalised,
           -- The most recent one as it was typed, punctuation and all. The
           -- normalised form is what the router sees; the raw one is what a
           -- person reads when deciding whether a rule would have helped.
           (array_agg(t.prompt order by t.at desc))[1]        as example,
           count(*)                                           as times,
           array_agg(distinct t.lang)                         as langs,
           min(t.at)                                          as first_at,
           max(t.at)                                          as last_at
      from ops_asst.turns t
     where t.kind = 'unknown'
     group by ops_asst.normalise(t.prompt)
     -- Most asked first, then most recent. A phrasing typed ten times this
     -- week is the one worth a rule, and it will not be the newest.
     order by count(*) desc, max(t.at) desc
     limit greatest(1, least(coalesce(p_limit, 200), 1000));
end $$;

grant execute on function ops_asst.unmatched(int) to authenticated;

comment on function ops_asst.unmatched(int) is
  'The questions the router did not understand, grouped the way the router itself compares them, '
  'without who typed them. A function rather than a view because what must be withheld is a '
  'column, and RLS withholds rows. (0039, regrouped 0041)';

-- ── is it working at all ────────────────────────────────────────────────

/* One row of counts, and nothing that could be traced to a person.
 *
 * It exists because *should we put a model behind this* is not answerable from
 * the unmatched list alone. A hundred unmatched prompts beside four hundred
 * answered ones is a router doing its job on the questions people repeat; a
 * hundred beside a hundred and ten is one that mostly fails.
 *
 * The two refusal counts are kept apart for the reason they always are: a
 * `closed` refusal is the boundary holding and is a good number to see;
 * a `permission` refusal is somebody who needs a grant they have not got, and
 * a rising one of those is an IT job rather than a router one (F64).
 *
 * No prompts, no actors, no dates beyond the first turn ever recorded.
 */
create or replace function ops_asst.router_health()
returns table (
  turns              bigint,
  answered           bigint,
  guided             bigint,
  drafted            bigint,
  unknown            bigint,
  refused_closed     bigint,
  refused_permission bigint,
  since              timestamptz)
language plpgsql security definer set search_path = ops_asst, ops_core, pg_temp as $$
begin
  if not ops_core.has_permission('it.read') then
    raise exception 'These are everybody''s questions counted together, so they are IT''s.'
      using errcode = 'insufficient_privilege';
  end if;

  return query
    select count(*),
           count(*) filter (where t.kind = 'answer'),
           count(*) filter (where t.kind = 'guide'),
           count(*) filter (where t.kind = 'draft'),
           count(*) filter (where t.kind = 'unknown'),
           count(*) filter (where t.refused_because = 'closed'),
           count(*) filter (where t.refused_because = 'permission'),
           min(t.at)
      from ops_asst.turns t;
end $$;

grant execute on function ops_asst.router_health() to authenticated;

comment on function ops_asst.router_health() is
  'Counts only — no prompts, no actors. *Should a model go behind this* is not answerable from '
  'the unmatched list alone: a hundred unmatched beside four hundred answered is a router doing '
  'its job, a hundred beside a hundred and ten is one that mostly fails. (0041)';
