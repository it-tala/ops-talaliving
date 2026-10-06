-- 0228_hr_task_daily_routines.sql — tugas rutin harian (D383).
--
-- The owner, 2026-10-06: *"tambahkan tugas rutin setiap hari juga"*.
--
-- A daily routine raises one task per **working day of the person holding
-- it**: not on a rest day of the week or a tanggal merah (`is_rest_day`), not
-- on a day off in their own schedule, and not on a day HRD marked for them
-- (cuti, sakit, izin, libur, mangkir — a half day still works). A task owed
-- on a day nobody was meant to work is a late task nobody could have done
-- (D261).
--
-- Raised **every morning by the database** (`pg_cron`, 05:05 WIB), because a
-- daily task that waits for somebody to press *Terbitkan periode* is not
-- daily. The button still raises it too. A daily routine is **never
-- backfilled**: yesterday's task raised today would be late on arrival.
--
-- The bell rings for each one; Chat does not (0215's trigger, amended here),
-- and its hand-over is not announced — a notice per person per morning is
-- the kind people learn to ignore.

/* ── periods: a day is its own period ─────────────────────────────────── */
create or replace function ops_hr.task_period_start(p_cadence ops_hr.task_cadence_t, p_on date)
returns date
language sql immutable as $$
  select case p_cadence
    when 'DAILY'     then p_on
    when 'WEEKLY'    then (date_trunc('week',    p_on::timestamp))::date
    when 'MONTHLY'   then (date_trunc('month',   p_on::timestamp))::date
    when 'QUARTERLY' then (date_trunc('quarter', p_on::timestamp))::date
    when 'SEMESTER'  then make_date(extract(year from p_on)::int,
                                    case when extract(month from p_on) <= 6 then 1 else 7 end, 1)
    when 'ANNUAL'    then (date_trunc('year',    p_on::timestamp))::date
  end;
$$;

create or replace function ops_hr.task_period_end(p_cadence ops_hr.task_cadence_t, p_start date)
returns date
language sql immutable as $$
  select (p_start + case p_cadence
    when 'DAILY'     then interval '1 day'
    when 'WEEKLY'    then interval '7 days'
    when 'MONTHLY'   then interval '1 month'
    when 'QUARTERLY' then interval '3 months'
    when 'SEMESTER'  then interval '6 months'
    when 'ANNUAL'    then interval '1 year'
  end - interval '1 day')::date;
$$;

create or replace function ops_hr.task_period_label(p_cadence ops_hr.task_cadence_t, p_start date)
returns text
language sql immutable as $$
  select case p_cadence
    when 'DAILY'     then to_char(p_start, 'DD-MM-YYYY')
    when 'WEEKLY'    then 'Minggu ' || to_char(p_start, 'IW/IYYY')
    when 'MONTHLY'   then to_char(p_start, 'Mon YYYY')
    when 'QUARTERLY' then 'TW' || to_char(p_start, 'Q YYYY')
    when 'SEMESTER'  then 'Smt ' || (case when extract(month from p_start) <= 6 then '1' else '2' end)
                          || ' ' || to_char(p_start, 'YYYY')
    when 'ANNUAL'    then to_char(p_start, 'YYYY')
  end;
$$;

/* ── is this a working day for this person ────────────────────────────── *
 *  The same definition the daily log is owed on (0214), read for one day. */
create or replace function ops_hr.works_on(p_employee uuid, p_day date)
returns boolean
language sql stable set search_path = ops_hr, ops_core, pg_temp as $$
  select coalesce((
    select not ops_hr.is_rest_day(ops_hr.rules_on(p_day), p_day)
       and not coalesce((ops_hr.schedule_day(ops_hr.pattern_on(e.schedule_code, e.unit, p_day), p_day)
                         ->> 'off')::boolean, false)
       and not exists (select 1 from ops_hr.day_marks m
                        where m.work_date = p_day
                          and (m.employee_id = e.id or m.employee_id is null)
                          and m.withdrawn_at is null
                          and m.kind <> 'half_day')
      from ops_hr.employees e
     where e.id = p_employee and e.active), false);
$$;

/* ── raising, with no permission of its own ───────────────────────────────
 *
 *  The body of 0152's `roll_task_routines`, moved here so that the morning
 *  job and the button run the same code. Invoker and granted to nobody:
 *  the button reaches it through `roll_task_routines`, which checks HRD
 *  first, and the job runs as the owner. `p_cadence` narrows the run — the
 *  morning job raises daily routines only, so the monthly report still
 *  appears when HRD raises it, as before.
 */
create or replace function ops_hr.raise_routine_tasks(
  p_through date, p_backfill_days int, p_cadence ops_hr.task_cadence_t default null)
returns jsonb
language plpgsql security invoker set search_path = ops_hr, ops_core, pg_temp as $$
declare
  v_through date; v_from date; r record; v_pstart date; v_pend date;
  v_due date; v_chase date; v_no text;
  v_made int := 0; v_had int := 0; v_skipped int := 0; v_list jsonb := '[]'::jsonb;
begin
  v_through := coalesce(p_through, ops_core.office_day());
  v_from    := v_through - coalesce(p_backfill_days, 0);

  for r in
    select * from ops_hr.task_routines
     where starts_on <= v_through
       and (ends_on is null or ends_on >= v_from)
       and (p_cadence is null or cadence = p_cadence)
     order by routine_no
  loop
    -- A daily routine is never backfilled: only the day itself.
    v_pstart := ops_hr.task_period_start(r.cadence,
                  greatest(case when r.cadence = 'DAILY' then v_through else v_from end, r.starts_on));
    while v_pstart <= v_through loop
      v_pend := ops_hr.task_period_end(r.cadence, v_pstart);
      if v_pend >= r.starts_on and (r.ends_on is null or v_pstart <= r.ends_on) then
        if r.cadence = 'DAILY' and not ops_hr.works_on(r.assignee_id, v_pstart) then
          v_skipped := v_skipped + 1;
        else
          v_due   := v_pend + r.due_offset_days;
          v_chase := greatest(v_due - r.chase_lead_days, v_pstart);
          begin
            insert into ops_hr.tasks
              (title, detail, assignee_id, assigned_by, due_date,
               deliverable, period_start, period_end, chase_date, routine_id)
            values (r.title, r.detail, r.assignee_id, coalesce(auth.uid(), r.created_by), v_due,
                    r.deliverable, v_pstart, v_pend, v_chase, r.id)
            returning task_no into v_no;
            v_made := v_made + 1;
            v_list := v_list || jsonb_build_object(
              'task_no', v_no, 'routine_no', r.routine_no,
              'period', ops_hr.task_period_label(r.cadence, v_pstart),
              'due_date', v_due, 'chase_date', v_chase);
          exception when unique_violation then
            v_had := v_had + 1;
          end;
        end if;
      end if;
      v_pstart := ops_hr.task_period_start(r.cadence, v_pend + 1);
    end loop;
  end loop;

  return jsonb_build_object('through', v_through, 'from', v_from,
                            'created', v_made, 'already_there', v_had,
                            'not_a_working_day', v_skipped, 'tasks', v_list);
end $$;

create or replace function ops_hr.roll_task_routines(
  p_through date default null, p_backfill_days int default 31)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare v_res jsonb;
begin
  if not ops_core.has_permission('hrd.create') then
    return ops_core.refused('hr','task_routine', null,'roll',
      'not_permitted','Menerbitkan tugas rutin butuh akses HRD.');
  end if;
  if p_backfill_days is null or p_backfill_days < 0 or p_backfill_days > 365 then
    return ops_core.invalid('hr','task_routine', null,'roll','backfill_out_of_range',
      'Penarikan mundur dihitung dalam hari, 0 sampai 365.',
      jsonb_build_object('field','backfill_days'));
  end if;

  v_res := ops_hr.raise_routine_tasks(p_through, p_backfill_days);

  return ops_core.ok('hr','task_routine', null,'roll', v_res, null,
    jsonb_build_object('through', v_res -> 'through', 'backfill_days', p_backfill_days,
                       'created', v_res -> 'created', 'already_there', v_res -> 'already_there',
                       'not_a_working_day', v_res -> 'not_a_working_day'));
end $$;

/* The morning job's entry: today's daily routines, nothing else. */
create or replace function ops_hr.raise_daily_routines()
returns jsonb
language sql security invoker set search_path = ops_hr, ops_core, pg_temp as $$
  select ops_hr.raise_routine_tasks(ops_core.office_day(), 0, 'DAILY');
$$;

/* ── 0215's trigger: bell only for daily routine tasks ─────────────────── */
create or replace function ops_hr.task_notify()
returns trigger
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare
  v_actor  uuid := auth.uid();
  v_user   ops_core.users%rowtype;
  v_emp    ops_hr.employees%rowtype;
  v_goal   ops_hr.goals%rowtype;
  v_wait   ops_hr.tasks%rowtype;
  v_by     text;
  v_data   jsonb;
  v_late   boolean;
  v_daily  boolean;
  r        record;
begin
  select * into v_emp from ops_hr.employees where id = new.assignee_id;
  select * into v_goal from ops_hr.goals where id = new.goal_id;
  select * into v_wait from ops_hr.tasks where id = new.waits_on;
  -- A task raised by a daily routine rings the bell but sends no Chat DM:
  -- the same message every working morning is the one people learn to
  -- ignore, and then they ignore the ones that matter too (D383).
  v_daily := coalesce((select rt.cadence = 'DAILY' from ops_hr.task_routines rt
                        where rt.id = new.routine_id), false);

  /* ── a task reached somebody ── */
  if new.status = 'OPEN'
     and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id) then
    select * into v_user from ops_core.users
     where id = v_emp.user_id and is_active;
    -- No account, nobody to tell: a floor worker's tasks are read to them by
    -- their supervisor. Yourself, nobody to tell either.
    if v_user.id is not null and v_user.id is distinct from v_actor then
      v_by := coalesce((select full_name from ops_core.users where id = new.assigned_by), 'HRD');
      v_data := jsonb_build_object(
        'task_no', new.task_no, 'title', new.title, 'detail', new.detail,
        'due_date', new.due_date, 'deliverable', new.deliverable,
        'assigned_by', v_by,
        'goal_no', v_goal.goal_no, 'goal_title', v_goal.title, 'goal_rank', v_goal.rank,
        'waits_on_no', v_wait.task_no, 'waits_on_title', v_wait.title,
        'routine', new.routine_id is not null, 'daily', v_daily,
        'moved', tg_op = 'UPDATE');

      insert into ops_core.notifications (user_id, kind, title, data, link, entity_no)
      values (v_user.id, 'task.assigned',
              format('Tugas baru dari %s: %s — jatuh tempo %s', v_by, new.title,
                     to_char(new.due_date, 'DD-MM-YYYY')),
              v_data, '/profil?tab=tugas', new.task_no);

      if not v_daily then
        perform ops_core.emit('hr', 'hr.task.assigned', new.task_no,
          v_data || jsonb_build_object('to', v_user.email::text,
                                       'to_name', v_user.full_name,
                                       'link', '/profil?tab=tugas'));
      end if;
    end if;
  end if;

  /* ── a task was handed over ── */
  -- A daily routine's hand-over is not announced: HRD reads that row on the
  -- Roadmap, one strip per routine, not one notice per person per morning.
  if tg_op = 'UPDATE' and new.status = 'DONE' and old.status <> 'DONE' and not v_daily then
    v_by := coalesce((select full_name from ops_core.users where id = new.done_by), v_emp.full_name);
    v_late := ops_core.office_day(new.done_at) > new.due_date;
    v_data := jsonb_build_object(
      'task_no', new.task_no, 'title', new.title,
      'assignee', v_emp.full_name, 'assignee_no', v_emp.employee_no,
      'deliverable', new.deliverable, 'delivered_note', new.delivered_note,
      'due_date', new.due_date, 'done_on', ops_core.office_day(new.done_at),
      'late', v_late,
      'done_by', v_by,
      'by_assignee', new.done_by is not distinct from v_emp.user_id,
      'goal_no', v_goal.goal_no, 'goal_title', v_goal.title, 'goal_rank', v_goal.rank);

    for r in select * from ops_hr.task_delivery_recipients(new.id) loop
      continue when r.user_id is not distinct from v_actor
                 or r.user_id is not distinct from v_emp.user_id;

      insert into ops_core.notifications (user_id, kind, title, data, link, entity_no)
      values (r.user_id, 'task.delivered',
              format('%s menyerahkan tugas: %s%s', v_emp.full_name, new.title,
                     case when v_late then ' (terlambat)' else '' end),
              v_data, '/hrd/tugas?tab=all', new.task_no);

      perform ops_core.emit('hr', 'hr.task.delivered', new.task_no,
        v_data || jsonb_build_object('to', r.email, 'to_name', r.full_name,
                                     'link', '/hrd/tugas?tab=all'));
    end loop;
  end if;

  return null;
end $$;

revoke execute on function ops_hr.works_on(uuid, date) from public;
revoke execute on function ops_hr.raise_routine_tasks(date, int, ops_hr.task_cadence_t) from public;
revoke execute on function ops_hr.raise_daily_routines() from public;
grant execute on function ops_hr.works_on(uuid, date) to authenticated;

/* ── every morning ─────────────────────────────────────────────────────────
 *
 *  05:05 WIB is 22:05 UTC the evening before; `pg_cron` reads UTC. The job
 *  computes the office day itself, so the hour only has to be after
 *  midnight at the office. Scheduled only where `pg_cron` is installed —
 *  the project, not the local ladder. `cron.schedule` with a name replaces
 *  the job, so running this twice is harmless.
 */
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('ops-daily-routines', '5 22 * * *',
                          'select ops_hr.raise_daily_routines()');
  end if;
end $$;
