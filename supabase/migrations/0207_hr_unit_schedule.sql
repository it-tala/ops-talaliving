-- 0207 — HRD sets a unit's default working pattern from /hrd/jadwal (D365).
--
-- Until now a unit's default pattern (`rules.schedule_by_unit`) was edited
-- only in IT's full rule-book editor (`/it/aturan-gaji`), while everything
-- else about patterns had moved to `/hrd/jadwal` (D330, D335, D340, D364).
-- The owner asked why schedules appeared in two places and chose to move the
-- unit defaults to HRD as well: *which unit works which pattern* is the same
-- knowledge as *which patterns exist*. Removing a pattern stays with IT
-- (people can be on it — `schedules_in_use_lost`).
--
-- The seam writes one entry, the same way `set_schedule_hours` does: a **new
-- dated version** of the book in force on the chosen date, every other rule
-- copied untouched. An empty code removes the unit's default; the people who
-- were following it then have no pattern and are named on the screen as
-- unlinked (D279), which is why the answer carries how many that is.
--
-- It refuses what the other schedule seams refuse, with the same sentences —
-- not HRD, no reason, no book on that date, a later version that would undo
-- it, the shape (`schedule_problem`), money already paid, a date inside a run
-- — plus a pattern code that is not in the book.
--
-- `schedule_roll` is restated verbatim from 0206 with one key added:
-- `unit_defaults`, every unit with its default and who it reaches.

create or replace function ops_hr.set_unit_schedule(
  p_unit           text,
  p_code           text,
  p_effective_from date,
  p_note           text,
  p_key            text default null)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare
  v_replayed jsonb; v_res jsonb; v_from date; v_unit text; v_code text; v_old text;
  v_base ops_hr.pay_rule_sets; v_later ops_hr.pay_rule_sets;
  v_map jsonb; v_rules jsonb; v_problem jsonb;
  v_spent text; v_clash text; v_version int; v_following int;
begin
  v_replayed := ops_core.idem_replay('hr','set_unit_schedule', p_key);
  if v_replayed is not null then return v_replayed; end if;

  v_unit := btrim(coalesce(p_unit, ''));
  v_code := nullif(btrim(coalesce(p_code, '')), '');

  if not ops_core.has_permission('hrd.update') then
    return ops_core.refused('hr','unit_schedule', nullif(v_unit, ''),'set',
      'not_permitted','Mengubah pola bawaan unit butuh akses HRD.');
  end if;
  if v_unit = '' then
    return ops_core.invalid('hr','unit_schedule', null,'set',
      'unit_required','Pilih unitnya.', jsonb_build_object('field','unit'));
  end if;
  if coalesce(btrim(coalesce(p_note,'')), '') = '' then
    return ops_core.invalid('hr','unit_schedule', v_unit,'set',
      'note_required',
      'Tulis alasannya. Jam satu unit yang berubah tanpa keterangan tidak bisa dijelaskan ke orang-orang di unit itu.',
      jsonb_build_object('field','note'));
  end if;

  v_from := coalesce(p_effective_from, ops_core.office_day());

  select * into v_base from ops_hr.pay_rule_sets
   where effective_from <= v_from
   order by effective_from desc, version desc limit 1;
  if not found then
    return ops_core.conflict('hr','unit_schedule', v_unit,'set',
      'no_rule_book',
      format('Belum ada buku aturan gaji yang berlaku pada %s. IT menerbitkannya dulu.', v_from));
  end if;

  select * into v_later from ops_hr.pay_rule_sets
   where effective_from > v_from
   order by effective_from, version limit 1;
  if found then
    return ops_core.conflict('hr','unit_schedule', v_unit,'set',
      'later_version_exists',
      format('Versi %s berlaku mulai %s, sesudah tanggal ini, dan tidak memuat perubahan ini — '
             'pola unitnya akan kembali pada tanggal itu. Pilih tanggal mulai %s atau sesudahnya.',
             v_later.version, v_later.effective_from, v_later.effective_from));
  end if;

  if v_code is not null and not exists (
       select 1 from jsonb_array_elements(coalesce(v_base.rules -> 'schedules','[]'::jsonb)) s
        where s.value ->> 'code' = v_code) then
    return ops_core.not_found('hr','unit_schedule', v_unit,'set',
      format('Tidak ada jadwal kerja bernama %s di buku aturan yang berlaku.', v_code));
  end if;

  v_map := coalesce(v_base.rules -> 'schedule_by_unit', '{}'::jsonb);
  v_old := v_map ->> v_unit;
  v_map := case when v_code is null then v_map - v_unit
                else v_map || jsonb_build_object(v_unit, v_code) end;
  v_rules := jsonb_set(v_base.rules, '{schedule_by_unit}', v_map);

  if v_old is not distinct from v_code then
    return ops_core.noop('hr','unit_schedule', v_unit,'set',
      'Pola bawaan unit itu sudah itu.',
      jsonb_build_object('unit', v_unit, 'version', v_base.version));
  end if;

  v_problem := ops_hr.schedule_problem(v_rules);
  if v_problem is not null then
    return ops_core.invalid('hr','unit_schedule', v_unit,'set',
      v_problem ->> 'code', v_problem ->> 'message',
      jsonb_build_object('field','schedule_by_unit'));
  end if;

  select run_no into v_spent from ops_hr.payroll_runs
   where status <> 'DRAFT' and period_end >= v_from
   order by period_start limit 1;
  if v_spent is not null then
    return ops_core.conflict('hr','unit_schedule', v_unit,'set',
      'already_paid',
      format('%s sudah ditandatangani untuk periode yang berakhir %s atau sesudahnya. '
             'Aturan tidak bisa mundur melewati uang yang sudah dibayarkan — '
             'terbitkan yang baru berlaku setelahnya.', v_spent, v_from));
  end if;

  select run_no into v_clash from ops_hr.payroll_runs
   where v_from > period_start and v_from <= period_end
   limit 1;
  if v_clash is not null then
    return ops_core.conflict('hr','unit_schedule', v_unit,'set',
      'inside_existing_run',
      format('%s mencakup tanggal itu, dan periode itu dihitung dengan aturan yang berlaku '
             'saat dibuka. Pilih tanggal di luar periode yang sudah ada.', v_clash));
  end if;

  -- Who the change reaches: active people in the unit with no pattern of
  -- their own. A pattern HR set on the person wins over any unit default.
  select count(*) into v_following from ops_hr.employees e
   where e.active and e.unit = v_unit and e.schedule_code is null;

  select coalesce(max(version), 0) + 1 into v_version from ops_hr.pay_rule_sets;
  insert into ops_hr.pay_rule_sets (version, effective_from, note, rules, created_by)
  values (v_version, v_from, btrim(p_note), v_rules, auth.uid());

  v_res := ops_core.ok('hr','unit_schedule', v_unit,'set',
    jsonb_build_object('unit', v_unit, 'schedule_code', v_code, 'following', v_following,
                       'version', v_version, 'effective_from', v_from),
    jsonb_build_object('schedule_code', v_old),
    jsonb_build_object('schedule_code', v_code, 'version', v_version, 'effective_from', v_from));
  return ops_core.idem_remember('hr','set_unit_schedule', p_key, v_res);
end $$;

revoke execute on function ops_hr.set_unit_schedule(text, text, date, text, text) from public;
grant execute on function ops_hr.set_unit_schedule(text, text, date, text, text) to authenticated;


/* ── the week and the month — restated from 0206, with the unit defaults ── */
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
           else round((ops_hr.shift_minutes(h.st, h.en) - h.br) / 60.0, 2) end as daily,
      -- Friday differs if either field says so, and each missing half falls
      -- back to the ordinary day rather than to nothing.
      case when h.st is null or h.en is null or h.br is null then null
           when h.fbr is null and h.fen is null then null
           else round((ops_hr.shift_minutes(h.st, coalesce(h.fen, h.en)) - coalesce(h.fbr, h.br)) / 60.0, 2)
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
        'hours_unconfirmed', coalesce((f.j ->> 'hours_unconfirmed')::boolean, false),
        'overnight', ops_hr.is_overnight(f.j),
        'day_boundary_minutes', ops_hr.day_boundary_minutes(f.j),
        -- 0195 (D340): the pattern's own weekdays, and the seven days as the
        -- reading will see them — each weekday's hours and what it is worth.
        'days', coalesce(f.j -> 'days', '{}'::jsonb),
        -- 0206 (D364): the shifts somebody on it may work.
        'shifts', coalesce(f.j -> 'shifts', '[]'::jsonb),
        'week', (select jsonb_agg(jsonb_build_object(
                   'isodow', g.d,
                   'start_minutes', ops_hr.minutes_of(x.sd -> 'start_minutes'),
                   'end_minutes', ops_hr.minutes_of(x.sd -> 'end_minutes'),
                   'break_minutes', ops_hr.minutes_of(x.sd -> 'break_minutes'),
                   'pay_multiplier', coalesce((x.sd ->> 'pay_multiplier')::numeric, 1),
                   'off', coalesce((x.sd ->> 'off')::boolean, false),
                   'own', (f.j -> 'days') ? g.d::text,
                   'hours', case when coalesce((x.sd ->> 'off')::boolean, false)
                                   or ops_hr.minutes_of(x.sd -> 'start_minutes') is null
                                   or ops_hr.minutes_of(x.sd -> 'end_minutes') is null then null
                              else round((ops_hr.shift_minutes(ops_hr.minutes_of(x.sd -> 'start_minutes'),
                                                               ops_hr.minutes_of(x.sd -> 'end_minutes'))
                                          - coalesce(ops_hr.minutes_of(x.sd -> 'break_minutes'), 0)) / 60.0, 2) end)
                   order by g.d)
                   from generate_series(1, 7) g(d)
                   -- 2026-09-07 is a Monday: g.d days after the Sunday before.
                   cross join lateral (select ops_hr.schedule_day(f.j, date '2026-09-06' + g.d) as sd) x),
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
    -- 0207 (D365): every unit, the pattern it defaults to, and who that
    -- default actually reaches. The units are the ones people are in plus
    -- the ones the book names, so a default nobody is in still shows.
    'unit_defaults', coalesce((
      select jsonb_agg(jsonb_build_object(
               'unit', un.unit,
               'schedule_code', (select r -> 'schedule_by_unit' ->> un.unit from rules),
               'people', (select count(*) from people p where p.unit = un.unit),
               -- On a pattern of their own, which wins over the unit's.
               'own', (select count(*) from people p
                        where p.unit = un.unit and p.schedule_code is not null),
               'following', (select count(*) from people p
                              where p.unit = un.unit and p.schedule_code is null
                                and p.effective is not null))
             order by un.unit collate "C")
        from (select p.unit from people p where p.unit is not null
              union
              select u.key from rules, jsonb_each_text(coalesce(rules.r -> 'schedule_by_unit','{}'::jsonb)) u
             ) un(unit)), '[]'::jsonb),
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
