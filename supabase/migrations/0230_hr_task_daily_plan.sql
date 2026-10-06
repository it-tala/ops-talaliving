-- 0230_hr_task_daily_plan.sql — rencana per hari, per tugas (D384).
--
-- The owner, 2026-10-06: *"di setiap orang, jadikan tampilan task nya bukan
-- hanya berisi daftar tugas — tapi isian free text per hari supaya mereka
-- bisa merencanakan dan menargetkan apa yang bisa mereka lakukan untuk
-- memenuhi tugas dalam tenggat waktu yang diberikan"*.
--
-- A task says what and by when. This says **how the days up to then will be
-- used**, in the holder's own words: one line per working day, from today to
-- the due date. The daily log (0214) is what happened; this is what was
-- meant to happen — the two side by side are the honest conversation about a
-- late task, before it is late.
--
-- Written only by the person holding the task, and only for today onwards:
-- a plan written for yesterday is a log, and that already has its place.
-- HRD reads it; nobody scores it (D261) — a plan that changed is not a
-- failure, it is the plan doing its job.
--
-- Clearing a day sets its target to null rather than deleting the row, so the
-- seam holds no DELETE (F218) and a cleared day still says when it was cleared.

create table ops_hr.task_plans (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references ops_hr.tasks(id),
  plan_date   date not null,
  target      text check (target is null or length(btrim(target)) > 0),
  updated_by  uuid not null references ops_core.users(id),
  updated_at  timestamptz not null default now(),
  constraint task_plan_once unique (task_id, plan_date)
);

create index task_plans_date_idx on ops_hr.task_plans (plan_date) where target is not null;

alter table ops_hr.task_plans enable row level security;

comment on table ops_hr.task_plans is
  'Rencana per hari: what the holder means to do on each working day toward a task (D384). Not scored.';

/* ── who may read a task's plan ─────────────────────────────────────────── */
create or replace function ops_hr.can_read_task_plan(p_task uuid)
returns boolean
language sql stable security definer set search_path = ops_hr, ops_core, pg_temp as $$
  select ops_core.has_permission('hrd.read')
      or exists (select 1 from ops_hr.tasks t
                  where t.id = p_task and t.assignee_id = ops_hr.my_employee_id());
$$;

/* ── one task's days ────────────────────────────────────────────────────────
 *
 *  Every day from the earlier of today and its first planned day, to the due
 *  date: working or not (a day off is shown as one, so the plan is read
 *  against the real calendar), with its target if any. A finished task shows
 *  only the days that carry a target.
 */
create or replace function ops_hr.task_plan(p_task_no text)
returns table (plan_date date, target text, works boolean, editable boolean, updated_at timestamptz)
language plpgsql stable security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare t ops_hr.tasks%rowtype; v_from date; v_mine boolean;
begin
  select * into t from ops_hr.tasks where task_no = p_task_no;
  if not found or not ops_hr.can_read_task_plan(t.id) then
    raise exception using errcode = 'P0002', message = format('Tidak ada tugas %s.', p_task_no);
  end if;
  v_mine := coalesce(t.assignee_id = ops_hr.my_employee_id(), false);
  v_from := least(ops_core.office_day(),
                  coalesce((select min(p.plan_date) from ops_hr.task_plans p where p.task_id = t.id),
                           ops_core.office_day()));
  return query
    select d::date, p.target,
           ops_hr.works_on(t.assignee_id, d::date),
           (v_mine and t.status = 'OPEN' and d::date >= ops_core.office_day()
                   and d::date <= t.due_date),
           p.updated_at
      from generate_series(v_from, greatest(t.due_date, v_from), interval '1 day') d
      left join ops_hr.task_plans p on p.task_id = t.id and p.plan_date = d::date
     where t.status = 'OPEN' or p.target is not null
     order by 1;
end $$;

/* ── the holder writes a day ────────────────────────────────────────────── */
create or replace function ops_hr.save_task_plan(p_task_no text, p_date date, p_target text)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare t ops_hr.tasks%rowtype; v_target text := nullif(btrim(coalesce(p_target,'')),'');
        v_before text;
begin
  select * into t from ops_hr.tasks where task_no = p_task_no;
  if not found then
    return ops_core.not_found('hr','task_plan', p_task_no,'save', format('Tidak ada tugas %s.', p_task_no));
  end if;
  if t.assignee_id is distinct from ops_hr.my_employee_id() then
    return ops_core.refused('hr','task_plan', p_task_no,'save','not_yours',
      'Rencana harian ditulis oleh pemegang tugasnya sendiri.');
  end if;
  if t.status <> 'OPEN' then
    return ops_core.conflict('hr','task_plan', p_task_no,'save','task_closed',
      format('%s sudah %s — rencananya tidak diubah lagi.', t.task_no, lower(t.status::text)));
  end if;
  if p_date is null or p_date < ops_core.office_day() then
    return ops_core.invalid('hr','task_plan', p_task_no,'save','past_day',
      'Rencana untuk hari ini dan seterusnya. Yang sudah lewat dicatat di laporan harian.',
      jsonb_build_object('field','plan_date'));
  end if;
  if p_date > t.due_date then
    return ops_core.invalid('hr','task_plan', p_task_no,'save','after_due',
      format('Jatuh tempo %s. Rencana sesudahnya berarti tugasnya terlambat — bicarakan dengan HRD lewat Tertahan atau minta tanggal baru.',
             to_char(t.due_date, 'DD-MM-YYYY')),
      jsonb_build_object('field','plan_date'));
  end if;
  if v_target is not null and length(v_target) > 500 then
    return ops_core.invalid('hr','task_plan', p_task_no,'save','target_too_long',
      'Satu hari, paling banyak 500 huruf.', jsonb_build_object('field','target'));
  end if;

  select target into v_before from ops_hr.task_plans where task_id = t.id and plan_date = p_date;
  if v_before is not distinct from v_target then
    return ops_core.noop('hr','task_plan', p_task_no,'save','Rencananya sama.');
  end if;

  insert into ops_hr.task_plans (task_id, plan_date, target, updated_by)
  values (t.id, p_date, v_target, auth.uid())
  on conflict (task_id, plan_date)
  do update set target = excluded.target, updated_by = excluded.updated_by, updated_at = now();

  return ops_core.ok('hr','task_plan', p_task_no,'save',
    jsonb_build_object('task_no', t.task_no, 'plan_date', p_date, 'target', v_target),
    jsonb_build_object('target', v_before), jsonb_build_object('plan_date', p_date, 'target', v_target));
end $$;

/* ── the person's day: what they planned, across their tasks ─────────────
 *
 *  For *Hari ini*: the targets the reader set for a day, beside the task
 *  each one is for, so the log can be written against the plan.
 */
create or replace function ops_hr.my_plan(p_date date default null)
returns table (task_no text, title text, due_date date, goal_rank int, target text)
language sql stable security definer set search_path = ops_hr, ops_core, pg_temp as $$
  select t.task_no, t.title, t.due_date, g.rank, p.target
    from ops_hr.task_plans p
    join ops_hr.tasks t on t.id = p.task_id
    left join ops_hr.goals g on g.id = t.goal_id
   where t.assignee_id = ops_hr.my_employee_id()
     and p.plan_date = coalesce(p_date, ops_core.office_day())
     and p.target is not null
   order by g.rank nulls last, t.due_date, t.task_no;
$$;

revoke execute on function ops_hr.can_read_task_plan(uuid) from public;
revoke execute on function ops_hr.task_plan(text) from public;
revoke execute on function ops_hr.save_task_plan(text, date, text) from public;
revoke execute on function ops_hr.my_plan(date) from public;

grant execute on function ops_hr.can_read_task_plan(uuid) to authenticated;
grant execute on function ops_hr.task_plan(text) to authenticated;
grant execute on function ops_hr.save_task_plan(text, date, text) to authenticated;
grant execute on function ops_hr.my_plan(date) to authenticated;

analyze ops_hr.task_plans;
