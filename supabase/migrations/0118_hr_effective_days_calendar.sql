-- 0118 — hari kerja efektif, dihitung dari kalender yang sudah ada, bukan
--        dikarang dan bukan ditebak.
--
-- ── Q45 was closed on the wrong half of its own question ──────────────────
--
-- Q45 asked *what is this business's own hari kerja efektif*. It was marked
-- answered on 13 September with D271, which settled **who types the figure**
-- (IT) and that the monthly average is derived from it rather than stored
-- beside it. Both true, and neither of them the number. So 288 went to
-- production as if it were the owner's, carried out of a demo fixture (F138),
-- and 240 replaced it this morning as a better convention — still a
-- convention, still nobody's decision.
--
-- The figure is not an opinion. `hourly_rate()` divides a year's pay by it:
-- `setahun ÷ hari_efektif ÷ jam_sehari`. Twenty days of error there moves
-- every overtime rupiah by eight per cent. A number that reaches pay should
-- be checkable, and this one always could have been — the business's calendar
-- is already in the database.
--
-- ── what this counts, and what it cannot ──────────────────────────────────
--
-- Working days in a year = days that are neither a weekly rest day under the
-- rule book's own `week_pattern` nor a day the office is shut. Both halves
-- are already decided elsewhere and are **not restated here**:
-- `ops_hr.is_rest_day()` is the authority, and the three figures this returns
-- decompose it so the arithmetic can be read rather than trusted. `59`'s
-- sibling smoke file asserts the decomposition adds back up to `is_rest_day`,
-- because two ways of counting the same thing is how they come to disagree.
--
-- **It cannot invent a tanggal merah.** `office_closed()` answers from
-- `day_marks` — holidays somebody recorded — so on a calendar where nobody has
-- entered any, this counts every weekday as worked and says 261. That is not
-- a defect to hide behind a rounder number; it is the honest state of the
-- calendar, and the screen prints `holidays_recorded` beside the total so the
-- gap between 261 and whatever is typed is a **list of days nobody has
-- entered** rather than a mystery. Today, in production, that list is empty
-- and the gap is twenty-one days.
--
-- ── definer, and why that is not optional ─────────────────────────────────
--
-- `office_closed()` reads `day_marks` under the caller's RLS, and the caller
-- here is IT, who publishes the rule book and has **no `hrd.read`**. Called
-- plainly, it would find no holidays for exactly the person this screen is
-- for, and answer 261 on a calendar that has fifteen tanggal merah in it — a
-- guard that cannot see what it counts, which is F135 arriving at a third
-- door. So this is definer, and it checks the permission itself: the same
-- pair the screen opens on (D271), `payroll.read` to read or `it.update` to
-- change. Null where neither holds; the screen shows nothing rather than a
-- number somebody was not meant to see.

create or replace function ops_hr.effective_days_calendar(p_rules jsonb, p_year int)
returns jsonb
language plpgsql stable security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare
  d0 date; d1 date;
  v_calendar int; v_rest int; v_holidays int; v_working int;
  v_recorded int; v_list jsonb;
begin
  if not (ops_core.has_permission('payroll.read') or ops_core.has_permission('it.update')) then
    return null;
  end if;
  if p_year is null or p_year < 1900 or p_year > 2999 then
    return null;
  end if;

  d0 := make_date(p_year, 1, 1);
  d1 := make_date(p_year, 12, 31);

  with days as (select generate_series(d0, d1, interval '1 day')::date as d)
  select
    count(*),
    -- The weekly pattern alone, with no holiday in it.
    count(*) filter (
      where case when coalesce(p_rules->>'week_pattern','6day') = '5day'
                 then extract(isodow from d) >= 6
                 else extract(isodow from d) = 7 end),
    -- A tanggal merah that falls on a Sunday costs the business nothing, so
    -- only the ones landing on a working day are subtracted.
    count(*) filter (
      where ops_hr.office_closed(d)
        and not case when coalesce(p_rules->>'week_pattern','6day') = '5day'
                     then extract(isodow from d) >= 6
                     else extract(isodow from d) = 7 end),
    -- The authority, counted once: everything above only explains this.
    count(*) filter (where not ops_hr.is_rest_day(p_rules, d))
  into v_calendar, v_rest, v_holidays, v_working
  from days;

  select count(*), coalesce(jsonb_agg(jsonb_build_object(
           'work_date', m.work_date, 'reason', m.reason) order by m.work_date), '[]'::jsonb)
    into v_recorded, v_list
    from ops_hr.day_marks m
   where m.employee_id is null and m.kind = 'holiday' and m.withdrawn_at is null
     and m.work_date between d0 and d1;

  return jsonb_build_object(
    'year', p_year,
    'week_pattern', coalesce(p_rules->>'week_pattern','6day'),
    'days_per_week', case when coalesce(p_rules->>'week_pattern','6day') = '5day' then 5 else 6 end,
    'calendar_days', v_calendar,
    'weekly_rest_days', v_rest,
    'holidays_recorded', v_recorded,
    'holidays_on_workdays', v_holidays,
    'working_days', v_working,
    -- What the book says, beside what the calendar counts. The screen shows
    -- both and never silently prefers one: IT types the figure (D271), and
    -- this is the evidence they type it against.
    'typed', (p_rules->>'effective_days_per_year')::int,
    'difference', (p_rules->>'effective_days_per_year')::int - v_working,
    'holidays', v_list);
end $$;

-- Safe to offer: it answers with dates the whole company shares and counts of
-- them, never with a person. The permission check inside is what gates it, so
-- the grant is not the gate (contrast `schedules_in_use_lost`, which answers
-- with names and is revoked outright — F141).
grant execute on function ops_hr.effective_days_calendar(jsonb, int) to authenticated;
