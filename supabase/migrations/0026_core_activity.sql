-- 0026_core_activity.sql — what the office machines report, and the two
-- horizons it is kept for.
--
-- Transcribed rather than designed: `john-lau` has been collecting this since
-- August into `public.activity_intervals` and `public.daily_summary`, and the
-- shape below is theirs. 13.214 intervals across 23 days from 3 machines —
-- about **826 rows a day**, or 275 per machine. At twenty machines and the
-- retention decided below that is roughly 660.000 rows, which is a number
-- Postgres does not notice and an index strategy does.
--
-- ── Two horizons, decided by the owner 2026-09-18 ────────────────────────
--
--   the minute-by-minute record   120 days
--   the daily recap               120 working days per person (six months)
--
-- The recap is expressed as **rows per person, not a date**, because that is
-- how it was asked for and because it is the more honest rule: somebody who
-- was away for a month should not lose a month of their history to the
-- calendar.
--
-- ── Why a stored recap is not an A3 violation ────────────────────────────
--
-- A3 says derived state is never stored, and a daily total computed from
-- intervals is derived state. It is stored here anyway, and the reason is the
-- retention above: **the recap outlives the rows it was derived from.** After
-- 120 days the intervals are gone and the recap is the only record there is,
-- so it is not a cache of something still computable — it is the surviving
-- fact. A view over purged rows would return zeroes, which is worse than
-- wrong: it reads as "this person did nothing in March".
--
-- ── Why deleting is right here, of all places ────────────────────────────
--
-- Rule 1 of this project is that nothing is deleted. This is the one table
-- where keeping everything is the problem rather than the protection: it is a
-- minute-by-minute record of what named people had on their screens, and an
-- indefinite one is a liability to them and to the business. So the purge is
-- deliberate, it is gated on `it.purge_activity`, and the fact that it ran is
-- itself written to the audit trail — which is not deleted.

-- ── first, two permissions the database never knew about ─────────────────
--
-- `src/lib/roles.ts` lists 35 permissions; `ops_core.permission_catalog` holds
-- 33. Both missing entries are admin-only, and both were silently dead:
--
--   `it.purge_activity`     — this migration's own purge needs it, and
--                             `has_permission` returned false for everybody,
--                             admin included, because the row was not there.
--   `accounting.plan_cash`  — used by `/accounting/calendar` through `can()`.
--                             `permissions` is expanded from *this* catalogue
--                             (`v_my_access`), so the cash estimates were
--                             read-only for every person in the company, with
--                             no error and no refusal — just buttons that were
--                             never drawn. Found by the same comparison; fixed
--                             here because leaving a known dead permission in
--                             place to keep a migration tidy is how it stays
--                             dead.
--
-- Two catalogues of the same thing will drift again. What stops that is a
-- check that compares them, in the shape of `scripts/check-live-routes.mjs` —
-- named here so the next person does not have to find this twice.

insert into ops_core.permission_catalog (module, action, admin_only) values
  ('it',        'purge_activity', true),
  ('accounting','plan_cash',      true)
on conflict do nothing;

create table ops_core.activity_intervals (
  id            bigserial primary key,
  user_id       uuid not null references ops_core.users(id),
  device_id     text not null,
  -- What was in front of them. All three are nullable because an agent that
  -- could not read the foreground window should say so rather than guess, and
  -- because a locked machine has no window at all.
  exe           text,
  title         text,
  url           text,
  is_idle       boolean not null default false,
  is_locked     boolean not null default false,
  started_at    timestamptz not null,
  ended_at      timestamptz not null,
  duration_sec  int not null check (duration_sec >= 0),
  -- The agent's own idea of "this interval, once". An agent that retries after
  -- a dropped connection sends the same interval again, and a monitoring
  -- record that double-counts a morning is worse than one with a gap.
  dedup_key     text not null unique,
  mac           text,
  created_at    timestamptz not null default now(),
  constraint interval_forward check (ended_at >= started_at)
);

-- Reading is always "this person, this window of days" — the screen shows one
-- person's day and the roll-up walks a date range.
create index activity_user_day_idx on ops_core.activity_intervals (user_id, started_at desc);
-- And the purge walks time alone, across everybody.
create index activity_started_idx on ops_core.activity_intervals (started_at);

create table ops_core.activity_daily (
  user_id        uuid not null references ops_core.users(id),
  day            date not null,
  active_sec     int not null default 0,
  idle_sec       int not null default 0,
  locked_sec     int not null default 0,
  first_activity timestamptz,
  last_activity  timestamptz,
  distinct_apps  int not null default 0,
  interval_count int not null default 0,
  -- `[{"exe":"chrome.exe","sec":12400}, …]`, longest first. A list rather than
  -- columns because "the top five" is a question whose answer changes shape,
  -- and because nothing joins to it.
  top_apps       jsonb not null default '[]'::jsonb,
  top_domains    jsonb not null default '[]'::jsonb,
  last_device    text,
  rolled_at      timestamptz not null default now(),
  primary key (user_id, day)
);

alter table ops_core.activity_intervals enable row level security;
alter table ops_core.activity_daily     enable row level security;

-- Who may look. Everybody may see their own; IT may see everybody's.
--
-- Your own is not a courtesy — a monitoring record somebody cannot inspect is
-- one they cannot correct, and the first argument about it will be about a day
-- they were never shown.
create policy activity_read on ops_core.activity_intervals
  for select to authenticated
  using (user_id = auth.uid() or ops_core.has_permission('it.read'));
create policy activity_daily_read on ops_core.activity_daily
  for select to authenticated
  using (user_id = auth.uid() or ops_core.has_permission('it.read'));

grant select on ops_core.activity_intervals, ops_core.activity_daily to authenticated;

-- ── what the agent on each machine sends ──────────────────────────────────

-- A batch of intervals, from the machine the person is sitting at.
--
-- **The rows are recorded against `auth.uid()`, never against a user named in
-- the payload.** The agent runs in the person's own session, so who is
-- reporting is something the database already knows — and taking it from the
-- payload instead would mean a monitoring record anybody could write into
-- somebody else's name. Of everything in this schema, that is the row most
-- worth being unable to forge.
--
-- Conflicts on `dedup_key` are skipped rather than refused. An agent that
-- retries after a dropped connection is doing the right thing, and the answer
-- to "I already have that one" is to say so and carry on — the batch reports
-- how many landed and how many were already there.
create or replace function ops_core.record_activity(
  p_rows jsonb,
  p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_core, pg_temp as $$
declare n_sent int; n_new int; res jsonb; replayed jsonb;
begin
  replayed := ops_core.idem_replay('identity','record_activity', p_key);
  if replayed is not null then return replayed; end if;

  if auth.uid() is null then
    return ops_core.refused('identity','activity', null,'record',
      'not_signed_in','An activity report says who was at the machine, and nobody is.');
  end if;

  n_sent := coalesce(jsonb_array_length(p_rows), 0);
  if n_sent = 0 then
    return ops_core.noop('identity','activity', null,'record',
      'An empty batch is nothing to record.', jsonb_build_object('sent', 0, 'recorded', 0));
  end if;

  insert into ops_core.activity_intervals
    (user_id, device_id, exe, title, url, is_idle, is_locked,
     started_at, ended_at, duration_sec, dedup_key, mac)
  select auth.uid(),
         r ->> 'device_id',
         nullif(r ->> 'exe',''), nullif(r ->> 'title',''), nullif(r ->> 'url',''),
         coalesce((r ->> 'is_idle')::boolean, false),
         coalesce((r ->> 'is_locked')::boolean, false),
         (r ->> 'started_at')::timestamptz,
         (r ->> 'ended_at')::timestamptz,
         (r ->> 'duration_sec')::int,
         r ->> 'dedup_key',
         nullif(r ->> 'mac','')
    from jsonb_array_elements(p_rows) r
  on conflict (dedup_key) do nothing;

  get diagnostics n_new = row_count;

  res := ops_core.ok('identity','activity', null,'record',
    jsonb_build_object('sent', n_sent, 'recorded', n_new, 'already_had', n_sent - n_new));
  return ops_core.idem_remember('identity','record_activity', p_key, res);
end $$;

-- ── the roll-up ───────────────────────────────────────────────────────────

-- Recompute the recap for a range of days.
--
-- Idempotent by construction: it recomputes whole days and replaces them, so
-- running it twice is running it once, and running it after a late-arriving
-- interval corrects the day rather than adding to it. That matters because an
-- agent on a laptop that was closed at 18:00 uploads yesterday this morning.
create or replace function ops_core.roll_up_activity(
  p_from date default null,
  p_to date default null,
  p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_core, pg_temp as $$
declare v_from date; v_to date; n int; res jsonb; replayed jsonb;
begin
  replayed := ops_core.idem_replay('identity','roll_up_activity', p_key);
  if replayed is not null then return replayed; end if;

  if not ops_core.has_permission('it.read') then
    return ops_core.refused('identity','activity', null,'roll_up',
      'permission_required','Rolling up activity belongs to IT.');
  end if;

  -- Yesterday and today by default: today because the day is still running,
  -- yesterday because a machine that was closed overnight reports late.
  v_from := coalesce(p_from, ops_core.office_day() - 1);
  v_to   := coalesce(p_to,   ops_core.office_day());
  if v_to < v_from then
    return ops_core.invalid('identity','activity', null,'roll_up',
      'range_backwards','A range does not end before it begins.',
      jsonb_build_object('field','to'));
  end if;

  with day_rows as (
    select i.user_id,
           i.started_at::date as day,
           sum(i.duration_sec) filter (where not i.is_idle and not i.is_locked) as active_sec,
           sum(i.duration_sec) filter (where i.is_idle)   as idle_sec,
           sum(i.duration_sec) filter (where i.is_locked) as locked_sec,
           min(i.started_at) as first_activity,
           max(i.ended_at)   as last_activity,
           count(distinct i.exe) filter (where i.exe is not null) as distinct_apps,
           count(*) as interval_count,
           (array_agg(i.device_id order by i.ended_at desc))[1] as last_device
      from ops_core.activity_intervals i
     where i.started_at::date between v_from and v_to
     group by i.user_id, i.started_at::date
  ),
  -- One row per app per person per day, then folded into a list. The first
  -- cut aggregated over the *interval* rows with a lateral, which gave one
  -- entry per interval rather than per app — `chrome.exe` seen fifty times was
  -- fifty identical entries in a field whose whole purpose is "the five things
  -- they were in".
  apps as (
    select user_id, day,
           jsonb_agg(jsonb_build_object('exe', exe, 'sec', sec) order by sec desc)
             filter (where rn <= 10) as top_apps
      from (
        select user_id, started_at::date as day, exe, sum(duration_sec) as sec,
               row_number() over (partition by user_id, started_at::date
                                  order by sum(duration_sec) desc) as rn
          from ops_core.activity_intervals
         where started_at::date between v_from and v_to and exe is not null
         group by user_id, started_at::date, exe
      ) p
     group by user_id, day
  ),
  -- The host, not the address. A full URL is a record of what somebody read;
  -- the domain is a record of where they were, and the second is what a
  -- monthly recap is for.
  domains as (
    select user_id, day,
           jsonb_agg(jsonb_build_object('domain', host, 'sec', sec) order by sec desc)
             filter (where rn <= 10) as top_domains
      from (
        select user_id, started_at::date as day,
               substring(url from '^https?://([^/?#]+)') as host,
               sum(duration_sec) as sec,
               row_number() over (partition by user_id, started_at::date
                                  order by sum(duration_sec) desc) as rn
          from ops_core.activity_intervals
         where started_at::date between v_from and v_to
           and url is not null
           and substring(url from '^https?://([^/?#]+)') is not null
         group by user_id, started_at::date, substring(url from '^https?://([^/?#]+)')
      ) p
     group by user_id, day
  )
  insert into ops_core.activity_daily as d
    (user_id, day, active_sec, idle_sec, locked_sec, first_activity, last_activity,
     distinct_apps, interval_count, top_apps, top_domains, last_device, rolled_at)
  select r.user_id, r.day,
         coalesce(r.active_sec, 0), coalesce(r.idle_sec, 0), coalesce(r.locked_sec, 0),
         r.first_activity, r.last_activity,
         r.distinct_apps, r.interval_count,
         coalesce(a.top_apps, '[]'::jsonb), coalesce(dm.top_domains, '[]'::jsonb),
         r.last_device, now()
    from day_rows r
    left join apps a on a.user_id = r.user_id and a.day = r.day
    left join domains dm on dm.user_id = r.user_id and dm.day = r.day
  on conflict (user_id, day) do update set
    active_sec = excluded.active_sec, idle_sec = excluded.idle_sec,
    locked_sec = excluded.locked_sec, first_activity = excluded.first_activity,
    last_activity = excluded.last_activity, distinct_apps = excluded.distinct_apps,
    interval_count = excluded.interval_count, top_apps = excluded.top_apps,
    top_domains = excluded.top_domains,
    last_device = excluded.last_device, rolled_at = now();

  get diagnostics n = row_count;

  res := ops_core.ok('identity','activity', null,'roll_up',
    jsonb_build_object('days', jsonb_build_object('from', v_from, 'to', v_to), 'rows', n));
  return ops_core.idem_remember('identity','roll_up_activity', p_key, res);
end $$;

-- ── the purge ─────────────────────────────────────────────────────────────

-- What is kept, as numbers a screen can print rather than a rule somebody
-- remembers. Settings, so the answer to "why is March gone" is changeable by
-- whoever is asked it.
insert into ops_core.settings (key, value, note) values
  ('activity.interval_days', '120'::jsonb,
   'How many days of minute-by-minute activity are kept before the purge removes them.'),
  ('activity.recap_days', '120'::jsonb,
   'How many daily recap rows are kept per person — working days, so roughly six months.')
on conflict (key) do nothing;

-- Both horizons, enforced.
--
-- The recap is trimmed **per person by count**, not by date: somebody away for
-- a month should not lose a month of their history to the calendar, and the
-- owner asked for it in rows.
create or replace function ops_core.purge_activity(p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_core, pg_temp as $$
declare v_days int; v_keep int; n_int int; n_day int; res jsonb; replayed jsonb;
begin
  replayed := ops_core.idem_replay('identity','purge_activity', p_key);
  if replayed is not null then return replayed; end if;

  -- Not `it.read`. Looking at the record and destroying it are different
  -- things, and the catalogue already says so (`it.purge_activity`).
  if not ops_core.has_permission('it.purge_activity') then
    return ops_core.refused('identity','activity', null,'purge',
      'permission_required','Purging the activity record belongs to IT.');
  end if;

  v_days := coalesce(ops_core.setting_num('activity.interval_days'), 120);
  v_keep := coalesce(ops_core.setting_num('activity.recap_days'), 120);

  delete from ops_core.activity_intervals
   where started_at < (now() - make_interval(days => v_days));
  get diagnostics n_int = row_count;

  with ranked as (
    select user_id, day,
           row_number() over (partition by user_id order by day desc) as rn
      from ops_core.activity_daily
  )
  delete from ops_core.activity_daily d
   using ranked r
   where r.user_id = d.user_id and r.day = d.day and r.rn > v_keep;
  get diagnostics n_day = row_count;

  -- The purge itself is not purged. `audit_log` keeps the fact that on this
  -- day somebody removed this much, which is the one record that must outlive
  -- the thing it describes.
  res := ops_core.ok('identity','activity', null,'purge',
    jsonb_build_object('intervals_removed', n_int, 'recap_rows_removed', n_day,
                       'interval_days', v_days, 'recap_days', v_keep));
  return ops_core.idem_remember('identity','purge_activity', p_key, res);
end $$;

-- What the retention screen reads: the policy, and what is actually there
-- against it. Both, because a policy nobody checks against the data is a
-- sentence in a document.
create or replace view ops_core.v_activity_retention as
  select coalesce(ops_core.setting_num('activity.interval_days'), 120)::int as interval_days,
         coalesce(ops_core.setting_num('activity.recap_days'), 120)::int    as recap_days,
         (select count(*) from ops_core.activity_intervals)                 as interval_rows,
         (select min(started_at) from ops_core.activity_intervals)          as oldest_interval,
         (select count(*) from ops_core.activity_daily)                     as recap_rows,
         (select min(day) from ops_core.activity_daily)                     as oldest_recap,
         -- Rows already past the horizon: what the next purge would take.
         (select count(*) from ops_core.activity_intervals
           where started_at < now() - make_interval(
             days => coalesce(ops_core.setting_num('activity.interval_days'), 120)::int))
                                                                            as intervals_overdue;

alter view ops_core.v_activity_retention set (security_invoker = on);
grant select on ops_core.v_activity_retention to authenticated;

grant execute on function
  ops_core.record_activity(jsonb, text),
  ops_core.roll_up_activity(date, date, text),
  ops_core.purge_activity(text)
  to authenticated;
