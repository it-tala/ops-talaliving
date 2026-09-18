-- 0027_core_activity_log.sql — what a person did with their day, inside the
-- application.
--
-- ── This is not `0026`, and the difference is the whole point ────────────
--
-- `0026` records what the *machines* report: `exe`, window title, idle, locked.
-- This records what the *application* was asked to do: a screen opened, a
-- payslip printed, an identity number revealed. They share a word and nothing
-- else, and `/it/aktivitas` reads this one.
--
-- ── Three trails, and why none of them can share a rule ──────────────────
--
--   `audit_log`   what **changed**. Never deleted (D188), because a figure
--                 nobody can explain is worse than one nobody can see.
--   this          what was **looked at**. Kept 120 days of detail (D283,
--                 superseding D188's 30) and 120 daily recap rows per person,
--                 because it is useful for a season and becomes surveillance
--                 for a decade.
--   `activity_daily` (0026)  what the machine showed.
--
-- The recap below breaks derive-on-read (A3, D63) deliberately and for the
-- reason D188 gave: the detail is gone at day 121, so a recap computed on read
-- would return zero for every day older than that — a figure that is not
-- missing but **wrong**, which is the one thing this project forbids.
--
-- ── Why `changes`, `refusals` and `reveals` are not columns on the event ──
--
-- They are counted in the recap from two sources. `changes` and `refusals`
-- come from `audit_log` — a write that succeeded and a write that was refused
-- are already recorded there, and copying them here would be a second number
-- that can disagree with the first. `reveals` is this table's own: a reveal
-- changes nothing, so the audit log never sees it, and folding it into
-- `changes` would have quietly inflated every recap the day the eye button
-- shipped (D197).

create table ops_core.activity_events (
  id         bigserial primary key,
  at         timestamptz not null default now(),
  actor_id   uuid not null references ops_core.users(id),
  -- `view` `export` `print` `reveal` `sign_in` `sign_out`. Text rather than an
  -- enum: a new kind of act is a thing the frontend learns to send, and a
  -- migration to add `download` would be a migration nobody should need.
  kind       text not null,
  -- The screen or the object: `/hrd/payroll/pyr-26-09-06_01`.
  target     text not null,
  -- What a recap prints. Derived from the path by whoever sends it, because
  -- the frontend is the only thing that knows a route's human name.
  label      text not null
);

-- Reading is "this person, this day" and "this day, everybody" — the screen
-- offers both, and the purge walks time alone.
create index activity_events_actor_idx on ops_core.activity_events (actor_id, at desc);
create index activity_events_at_idx    on ops_core.activity_events (at);

create table ops_core.activity_recap (
  id             bigserial primary key,
  day            date not null,
  actor_id       uuid not null references ops_core.users(id),
  events         int not null default 0,
  first_at       timestamptz,
  last_at        timestamptz,
  -- `[{"label":"Payroll","count":12}, …]`, most-used first.
  top_screens    jsonb not null default '[]'::jsonb,
  changes        int not null default 0,
  refusals       int not null default 0,
  reveals        int not null default 0,
  rolled_at      timestamptz not null default now(),
  unique (day, actor_id)
);

alter table ops_core.activity_events enable row level security;
alter table ops_core.activity_recap  enable row level security;

-- **`it: read` and nothing else** (D190). Leadership holds the grant rather
-- than deriving it from an authority: the two candidates, `approve_goods` and
-- `approve_funds`, are exactly what D24 forbids, and a stand-in appointed to
-- approve payments while the Direktur travels would silently gain the right to
-- read everyone's activity for that week.
--
-- Unlike `0026`, somebody may **not** read their own: this trail exists to be
-- read by IT and leadership, and a person who can see exactly what was logged
-- about them is a person who knows precisely what is not.
create policy activity_events_read on ops_core.activity_events
  for select to authenticated using (ops_core.has_permission('it.read'));
create policy activity_recap_read on ops_core.activity_recap
  for select to authenticated using (ops_core.has_permission('it.read'));

grant select on ops_core.activity_events, ops_core.activity_recap to authenticated;

-- ── recording ─────────────────────────────────────────────────────────────

-- Against `auth.uid()`, never against a name in the payload — the same rule
-- and the same reason as `0026.record_activity`.
--
-- **Failure here is never the caller's problem.** A screen that could not log
-- the fact it was opened must still open: refusing the page because the trail
-- is unavailable turns an observability feature into an outage. So this
-- returns `ok` with what it wrote and the client ignores the answer.
create or replace function ops_core.record_activity_event(
  p_kind text,
  p_target text,
  p_label text)
returns jsonb
language plpgsql security definer set search_path = ops_core, pg_temp as $$
declare v_id bigint;
begin
  if auth.uid() is null then
    return ops_core.refused('identity','activity_event', null,'record',
      'not_signed_in','An activity event says who acted, and nobody is.');
  end if;
  if coalesce(btrim(p_kind), '') = '' or coalesce(btrim(p_target), '') = '' then
    return ops_core.invalid('identity','activity_event', null,'record',
      'kind_and_target_required','An event names what was done and to what.',
      jsonb_build_object('field','kind'));
  end if;

  insert into ops_core.activity_events (actor_id, kind, target, label)
  values (auth.uid(), btrim(p_kind), btrim(p_target),
          coalesce(nullif(btrim(p_label), ''), btrim(p_target)))
  returning id into v_id;

  -- Deliberately no audit row and no outbox. This *is* a trail; writing a
  -- trail of writing the trail is how a table grows without ever being read.
  return jsonb_build_object('outcome','ok','status',200,
                            'data', jsonb_build_object('event_id', v_id));
end $$;

-- ── the recap ─────────────────────────────────────────────────────────────

-- Recompute whole days, so running it twice is running it once and a late
-- event corrects its day rather than adding to it.
create or replace function ops_core.roll_up_activity_log(
  p_from date default null,
  p_to date default null,
  p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_core, pg_temp as $$
-- `v_rows` rather than `n`: a plpgsql variable outranks a column of the same
-- name inside the statement below, and the `screens` CTE has a count called
-- `n`. Postgres refuses it as ambiguous rather than picking one, which is the
-- right call and worth not re-learning.
declare v_from date; v_to date; v_rows int; res jsonb; replayed jsonb;
begin
  replayed := ops_core.idem_replay('identity','roll_up_activity_log', p_key);
  if replayed is not null then return replayed; end if;

  -- Rolling a day up is a write, not a read (D190).
  if not ops_core.has_permission('it.update') then
    return ops_core.refused('identity','activity', null,'roll_up',
      'permission_required','Rolling a day up belongs to IT.');
  end if;

  -- Yesterday, and only yesterday, when nobody says otherwise. Today is still
  -- being lived: rolling it up writes a recap that is wrong by the afternoon,
  -- and the next run would correct it — which works, and means the figure on
  -- the screen is provisional without ever saying so. A day is summarised once
  -- it is over. `p_to` defaults to `p_from` so the ordinary call is one day.
  v_from := coalesce(p_from, ops_core.office_day() - 1);
  v_to   := coalesce(p_to,   v_from);
  if v_to < v_from then
    return ops_core.invalid('identity','activity', null,'roll_up',
      'range_backwards','A range does not end before it begins.',
      jsonb_build_object('field','to'));
  end if;

  with ev as (
    select actor_id, ops_core.office_day(at) as day,
           count(*) as events,
           min(at) as first_at, max(at) as last_at,
           count(*) filter (where kind = 'reveal') as reveals
      from ops_core.activity_events
     where ops_core.office_day(at) between v_from and v_to
     group by actor_id, ops_core.office_day(at)
  ),
  screens as (
    select actor_id, day,
           jsonb_agg(jsonb_build_object('label', label, 'count', n) order by n desc)
             filter (where rn <= 8) as top_screens
      from (
        select actor_id, ops_core.office_day(at) as day, label, count(*) as n,
               row_number() over (partition by actor_id, ops_core.office_day(at)
                                  order by count(*) desc) as rn
          from ops_core.activity_events
         where ops_core.office_day(at) between v_from and v_to
         group by actor_id, ops_core.office_day(at), label
      ) p
     group by actor_id, day
  ),
  -- From the audit log, not from here. A write that succeeded and a write that
  -- was refused are already facts there; counting them again in this table
  -- would be a second number free to disagree with the first.
  aud as (
    select actor_id, ops_core.office_day(at) as day,
           count(*) filter (where outcome = 'ok')      as changes,
           count(*) filter (where outcome = 'refused') as refusals
      from ops_core.audit_log
     where actor_id is not null
       and ops_core.office_day(at) between v_from and v_to
     group by actor_id, ops_core.office_day(at)
  )
  insert into ops_core.activity_recap as r
    (day, actor_id, events, first_at, last_at, top_screens, changes, refusals, reveals, rolled_at)
  select e.day, e.actor_id, e.events, e.first_at, e.last_at,
         coalesce(s.top_screens, '[]'::jsonb),
         coalesce(a.changes, 0), coalesce(a.refusals, 0), e.reveals, now()
    from ev e
    left join screens s on s.actor_id = e.actor_id and s.day = e.day
    left join aud a     on a.actor_id = e.actor_id and a.day = e.day
  on conflict (day, actor_id) do update set
    events = excluded.events, first_at = excluded.first_at, last_at = excluded.last_at,
    top_screens = excluded.top_screens, changes = excluded.changes,
    refusals = excluded.refusals, reveals = excluded.reveals, rolled_at = now();

  get diagnostics v_rows = row_count;

  -- A day nobody worked is not a failure, but it is not a success either, and
  -- saying *0 orang direkap* as a green toast is how a broken recorder goes
  -- unnoticed for a fortnight.
  --
  -- **`invalid` rather than `noop`, and the reason is the caller.** `noop`
  -- carries an `ok` envelope with no data, and the screen reads
  -- `res.data.written` — so the honest-looking outcome is the one that throws.
  -- The demo has answered `nothing_to_roll` here since the screen was built;
  -- this is the same answer from the other side of the seam.
  if v_rows = 0 then
    res := ops_core.invalid('identity','activity', null,'roll_up',
      'nothing_to_roll','No activity was recorded on that day — nothing to summarise.',
      jsonb_build_object('field','day'));
    return ops_core.idem_remember('identity','roll_up_activity_log', p_key, res);
  end if;

  -- `written` counts rows the recap now holds, whether this run inserted them
  -- or corrected them. There is no `skipped`: a day already rolled up is
  -- **recomputed**, because a late event must correct its day rather than be
  -- lost to a row that happened to exist first.
  res := ops_core.ok('identity','activity', null,'roll_up',
    jsonb_build_object('day', v_from, 'to', v_to, 'written', v_rows, 'skipped', 0));
  return ops_core.idem_remember('identity','roll_up_activity_log', p_key, res);
end $$;

-- ── the purge ─────────────────────────────────────────────────────────────

-- Six months, counted the way the owner counts it: *6 bulan itu maksudnya 120
-- hari kerja*. So the recap is trimmed **per person by count**, not by date —
-- the same rule and the same number as `0026`, because somebody away for three
-- weeks should come back to their history rather than to a hole, and because
-- two activity trails with two different arithmetics for one sentence in D188
-- is a drift waiting to be discovered by whoever has to explain a gap.
insert into ops_core.settings (key, value, note) values
  ('activity_log.detail_days', '120'::jsonb,
   'How many days of the in-app activity trail are kept in detail (D283, superseding D188''s 30).'),
  ('activity_log.recap_rows', '120'::jsonb,
   'How many daily recap rows are kept per person — working days, so roughly six months (D188).')
on conflict (key) do nothing;

-- **A day whose events expire with no recap behind them is the one failure
-- this design can have**: the detail goes and nothing is left. So the purge
-- refuses to take a day that has not been rolled up, and says which — it is
-- the only refusal here, and it is the whole reason `days_unrolled` exists on
-- the retention screen.
create or replace function ops_core.purge_activity_log(p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_core, pg_temp as $$
declare v_days int; v_keep int; n_ev int; n_rc int; blocked date[];
        res jsonb; replayed jsonb;
begin
  replayed := ops_core.idem_replay('identity','purge_activity_log', p_key);
  if replayed is not null then return replayed; end if;

  if not ops_core.has_permission('it.purge_activity') then
    return ops_core.refused('identity','activity', null,'purge',
      'permission_required','Purging the activity trail belongs to IT.');
  end if;

  v_days   := coalesce(ops_core.setting_num('activity_log.detail_days'), 120)::int;
  v_keep   := coalesce(ops_core.setting_num('activity_log.recap_rows'), 120)::int;

  -- Days past the horizon that nobody rolled up. Skipped, not deleted, and
  -- named in the answer so the screen can say so rather than report a clean
  -- purge that quietly lost a fortnight.
  select coalesce(array_agg(distinct d order by d), '{}')
    into blocked
    from (
      select ops_core.office_day(e.at) as d
        from ops_core.activity_events e
       where e.at < now() - make_interval(days => v_days)
    ) x
   where not exists (
     select 1 from ops_core.activity_recap r where r.day = x.d);

  delete from ops_core.activity_events e
   where e.at < now() - make_interval(days => v_days)
     and ops_core.office_day(e.at) <> all (blocked);
  get diagnostics n_ev = row_count;

  delete from ops_core.activity_recap r
   using (
     select id, row_number() over (partition by actor_id order by day desc) as rn
       from ops_core.activity_recap
   ) ranked
   where ranked.id = r.id and ranked.rn > v_keep;
  get diagnostics n_rc = row_count;

  res := ops_core.ok('identity','activity', null,'purge',
    jsonb_build_object('events_removed', n_ev, 'recaps_removed', n_rc,
                       'blocked_days', to_jsonb(blocked),
                       'detail_days', v_days, 'recap_rows', v_keep));
  return ops_core.idem_remember('identity','purge_activity_log', p_key, res);
end $$;

-- What the retention panel reads: the policy, what is here against it, and the
-- gap that would lose a day entirely.
create or replace view ops_core.v_activity_log_retention as
  select coalesce(ops_core.setting_num('activity_log.detail_days'), 120)::int  as detail_days,
         coalesce(ops_core.setting_num('activity_log.recap_rows'), 120)::int  as recap_rows,
         (select count(*) from ops_core.activity_events)                       as events_total,
         (select count(*) from ops_core.activity_events
           where at < now() - make_interval(
             days => coalesce(ops_core.setting_num('activity_log.detail_days'), 120)::int))
                                                                               as events_expiring,
         (select min(at) from ops_core.activity_events)                        as oldest_event,
         (select count(*) from ops_core.activity_recap)                        as recaps_total,
         (select count(*) from (
            select row_number() over (partition by actor_id order by day desc) as rn
              from ops_core.activity_recap) q
           where q.rn > coalesce(ops_core.setting_num('activity_log.recap_rows'), 120)::int)
                                                                               as recaps_expiring,
         (select min(day) from ops_core.activity_recap)                        as oldest_recap,
         -- The one failure this design can have, counted.
         (select count(*) from (
            select distinct ops_core.office_day(e.at) as d, e.actor_id
              from ops_core.activity_events e
          ) x
          where not exists (
            select 1 from ops_core.activity_recap r
             where r.day = x.d and r.actor_id = x.actor_id))                   as days_unrolled;

alter view ops_core.v_activity_log_retention set (security_invoker = on);
grant select on ops_core.v_activity_log_retention to authenticated;

grant execute on function
  ops_core.record_activity_event(text, text, text),
  ops_core.roll_up_activity_log(date, date, text),
  ops_core.purge_activity_log(text)
  to authenticated;

-- ── what the screen reads ─────────────────────────────────────────────────

-- The tables carry `actor_id` and nothing else about the person, because a
-- name copied onto every row is a name that goes stale the day somebody
-- marries (A3). The screen needs one to print, so the join happens here.
--
-- `security_invoker` on both: the policies above are the gate, and a view that
-- ran as its owner would hand the whole trail to anybody who could name it.
create or replace view ops_core.v_activity_event as
  select e.id, e.at, e.actor_id,
         coalesce(u.email, 'system')                          as actor_email,
         coalesce(nullif(btrim(u.full_name), ''), u.email, '—') as full_name,
         e.kind, e.target, e.label
    from ops_core.activity_events e
    left join ops_core.users u on u.id = e.actor_id;

create or replace view ops_core.v_activity_recap as
  select r.id, r.day, r.actor_id,
         coalesce(u.email, 'system')                          as actor_email,
         coalesce(nullif(btrim(u.full_name), ''), u.email, '—') as full_name,
         r.events, r.first_at, r.last_at, r.top_screens,
         r.changes, r.refusals, r.reveals, r.rolled_at
    from ops_core.activity_recap r
    left join ops_core.users u on u.id = r.actor_id;

alter view ops_core.v_activity_event set (security_invoker = on);
alter view ops_core.v_activity_recap set (security_invoker = on);
grant select on ops_core.v_activity_event, ops_core.v_activity_recap to authenticated;
