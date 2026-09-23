-- 0113 — Friday has a finishing time of its own, not only a longer break.
--
-- Q44 gave the business five working patterns and a **longer Friday break**,
-- and `friday_break_minutes` was built to hold exactly that. It was not
-- enough, and the owner said so the first time he read a real week off the
-- screen: the office works 08.00–17.15 from Monday to Thursday and **goes
-- home at 16.30 on Friday**, keeping the same 90-minute break.
--
-- With only a break to work with, a seven-hour Friday for the office forces a
-- 135-minute break — a number nobody has ever taken, invented purely so the
-- total would come out right. That is the failure this ladder keeps meeting:
-- a shape that can only express the new fact by lying about an old one (F91,
-- and now F139). The honest fix is the missing column.
--
-- **Null means Friday is an ordinary day**, and it means that separately for
-- each of the two fields. A Friday that differs in its finish still takes the
-- ordinary break, and the other way round — so each falls back on its own
-- rather than one blanking the other. This is deliberately *not* D274's
-- nullability, where null means *nobody has said* and the figures refuse to
-- compute: there, a schedule with no `end_minutes` genuinely has no day. Here
-- the fallback is a real answer, because "Friday is like every other day" is
-- what most patterns actually do and the seed says so by leaving it null.
--
-- Nothing about money moves. The schedule's finishing time has never driven a
-- rupiah: overtime is read from its own tap pair (`0048`), never from the gap
-- between a clock on the wall and a row in the rule book. This changes the
-- **planning** figures — the week and the month HR was promised in Q53 — and
-- `break_allowance()` is left exactly as it was, because a break is a break.

-- ── the week and the month, with Friday counted properly ──────────────────
--
-- Restated whole rather than patched: the Friday arithmetic appears three
-- times in here (the day, the week, the month) and a partial edit is how two
-- of the three end up agreeing.
create or replace function ops_hr.schedule_roll()
returns jsonb
language sql stable set search_path = ops_hr, pg_temp as $$
  with rules as (select ops_hr.rules_on(ops_core.office_day()) as r),
  days as (
    select case when (select r ->> 'week_pattern' from rules) = '5day' then 5 else 6 end as n
  ),
  sc as (
    select s.value as j, s.value ->> 'code' as code
      from rules, jsonb_array_elements(coalesce(rules.r -> 'schedules','[]'::jsonb)) s
  ),
  people as (
    select e.employee_no, e.full_name, e.unit, e.schedule_code,
           -- The pattern actually in force: what HR linked, else what the unit
           -- defaults to, else nothing at all.
           coalesce(e.schedule_code,
                    (select r -> 'schedule_by_unit' ->> e.unit from rules)) as effective
      from ops_hr.employees e where e.active
  ),
  hours as (
    select sc.code, sc.j,
      (sc.j ->> 'start_minutes')::int         as st,
      (sc.j ->> 'end_minutes')::int           as en,
      (sc.j ->> 'break_minutes')::int         as br,
      (sc.j ->> 'friday_break_minutes')::int  as fbr,
      (sc.j ->> 'friday_end_minutes')::int    as fen
    from sc
  ),
  figured as (
    select h.code, h.j,
      case when h.st is null or h.en is null or h.br is null then null
           else round(((h.en - h.st) - h.br) / 60.0, 2) end as daily,
      -- Friday differs if either field says so, and each missing half falls
      -- back to the ordinary day rather than to nothing.
      case when h.st is null or h.en is null or h.br is null then null
           when h.fbr is null and h.fen is null then null
           else round((coalesce(h.fen, h.en) - h.st - coalesce(h.fbr, h.br)) / 60.0, 2)
      end as friday,
      -- What is stopping the figures, in words. A schedule nobody has finished
      -- describing is not a schedule of zero hours.
      nullif(concat_ws(', ',
        case when h.st  is null then 'jam masuk' end,
        case when h.en  is null then 'jam pulang' end,
        case when h.br  is null then 'istirahat' end), '') as missing
    from hours h
  )
  select jsonb_build_object(
    'week_pattern', (select r ->> 'week_pattern' from rules),
    'schedules', coalesce((
      select jsonb_agg(jsonb_build_object(
        'code', f.code,
        'name', f.j ->> 'name',
        'start_minutes', (f.j ->> 'start_minutes')::int,
        'end_minutes', (f.j ->> 'end_minutes')::int,
        'break_minutes', (f.j ->> 'break_minutes')::int,
        'friday_break_minutes', (f.j ->> 'friday_break_minutes')::int,
        'friday_end_minutes', (f.j ->> 'friday_end_minutes')::int,
        'note', f.j ->> 'note',
        'hours', jsonb_build_object(
          'daily_hours', f.daily,
          'friday_hours', f.friday,
          'days_per_week', (select n from days),
          'weekly_hours', case when f.daily is null then null
            when f.friday is null then round(f.daily * (select n from days), 2)
            else round(f.daily * ((select n from days) - 1) + f.friday, 2) end,
          'monthly_hours', case when f.daily is null then null
            else round((case when f.friday is null then f.daily * (select n from days)
                             else f.daily * ((select n from days) - 1) + f.friday end)
                       * 52 / 12.0, 2) end,
          'blocked_by', case when f.missing is null then null
                             else 'Belum ada ' || f.missing || ' — jamnya belum bisa dihitung.' end),
        -- Linked **by name**, which is a decision somebody took.
        'assigned', (select count(*) from people p where p.schedule_code = f.code),
        -- On it by assumption only.
        'inherited', (select count(*) from people p
                       where p.schedule_code is null and p.effective = f.code),
        'units', coalesce((select jsonb_agg(u.key order by u.key)
                             from rules, jsonb_each_text(coalesce(rules.r -> 'schedule_by_unit','{}'::jsonb)) u
                            where u.value = f.code), '[]'::jsonb)))
      from figured f), '[]'::jsonb),
    'unlinked', coalesce((
      select jsonb_agg(jsonb_build_object('employee_no', p.employee_no,
                                          'full_name', p.full_name, 'unit', p.unit)
                       order by p.employee_no)
        from people p where p.effective is null), '[]'::jsonb),
    'inherited', coalesce((
      select jsonb_agg(jsonb_build_object('employee_no', p.employee_no,
                                          'full_name', p.full_name, 'unit', p.unit,
                                          'schedule_code', p.effective)
                       order by p.employee_no)
        from people p where p.schedule_code is null and p.effective is not null), '[]'::jsonb))
$$;
