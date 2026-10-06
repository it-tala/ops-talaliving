-- 0215_core_task_notifications.sql — tell people about their tasks (D374).
--
-- The owner, 2026-10-06: *"tambahkan fitur untuk kirim notifikasi via google
-- chat setiap dapat tugas baru dan setiap tugas ter kirim ke HR dan notifikasi
-- web ops."*
--
-- Two moments, two roads each:
--
--   • a task reaches a person (assigned, raised by a routine, made from a
--     dadakan line, or moved to them)  → the assignee;
--   • a task is closed with its hand-over note → HRD (write or admin on the
--     hrd module) and whoever assigned it.
--
-- Roads: a row in `ops_core.notifications` for the bell on the web app, and
-- an `ops_core.outbox` event for Google Chat. This database never calls Google
-- (ADR-008): john-lau's `ops notify` step carries live outbox events into a
-- DM, and `delivery_rules` below is what makes these two events live.
--
-- ── why a trigger, not four more lines in four seams ─────────────────────
--
-- A task reaches somebody through `assign_task`, `edit_task` (moving it),
-- `roll_task_routines` and `promote_work_log` — and the next door somebody
-- writes. A notification added to each seam is one the fifth seam forgets.
-- The trigger is on the row, so *a task was given to you* is said whenever it
-- becomes true, by whichever road. The seams are left exactly as they are,
-- which also means nothing here has to be dropped and recreated.
--
-- Nobody is told about what they did themselves: assigning a task to yourself,
-- or HRD closing a task it also assigned, notifies nobody about it.

/* ── the bell ─────────────────────────────────────────────────────────────
 *
 *  One row per person per event. `data` carries what the screen needs to say
 *  it in either language, `title` is the Indonesian sentence for a kind the
 *  screen does not know yet — a bell that shows a blank line is worse than one
 *  that shows the sentence in one language.
 */
create table ops_core.notifications (
  id          bigserial primary key,
  user_id     uuid not null references ops_core.users(id) on delete cascade,
  kind        text not null,
  title       text not null check (length(btrim(title)) > 0),
  data        jsonb not null default '{}'::jsonb,
  -- A path inside the app, never a full URL: the same row is right on the
  -- demo, on a preview and on ops.talaliving.com.
  link        text check (link is null or link like '/%'),
  entity_no   text,
  created_at  timestamptz not null default now(),
  read_at     timestamptz
);

create index notifications_user_idx on ops_core.notifications (user_id, created_at desc);
create index notifications_unread_idx on ops_core.notifications (user_id) where read_at is null;

alter table ops_core.notifications enable row level security;

-- Your own, and only to read. Writing is the trigger's; marking read is a seam.
create policy notifications_own on ops_core.notifications
  for select to authenticated using (user_id = auth.uid());

grant select on ops_core.notifications to authenticated;

comment on table ops_core.notifications is
  'The web app''s bell: one row per person per event, read by its owner only (D374).';

/* ── who hears about a delivered task ─────────────────────────────────────
 *
 *  HRD that can act on the task (write or admin — read-only HRD is somebody
 *  watching, not somebody the hand-over is addressed to), and the person who
 *  assigned it. One place, so the bell and the Chat message cannot disagree
 *  about who was told. Invoker: it answers with people's addresses, so it runs
 *  with the rights of whoever calls it — the trigger, which owns the tables.
 */
create or replace function ops_hr.task_delivery_recipients(p_task uuid)
returns table (user_id uuid, email text, full_name text)
language sql stable security invoker set search_path = ops_hr, ops_core, pg_temp as $$
  select u.id, u.email::text, u.full_name
    from ops_core.users u
   where u.is_active
     and (u.id = (select t.assigned_by from ops_hr.tasks t where t.id = p_task)
          or exists (select 1 from ops_core.user_modules m
                      where m.user_id = u.id and m.module = 'hrd'
                        and m.level in ('write','admin')));
$$;

/* ── the trigger ──────────────────────────────────────────────────────────── */
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
  r        record;
begin
  select * into v_emp from ops_hr.employees where id = new.assignee_id;
  select * into v_goal from ops_hr.goals where id = new.goal_id;
  select * into v_wait from ops_hr.tasks where id = new.waits_on;

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
        'routine', new.routine_id is not null,
        'moved', tg_op = 'UPDATE');

      insert into ops_core.notifications (user_id, kind, title, data, link, entity_no)
      values (v_user.id, 'task.assigned',
              format('Tugas baru dari %s: %s — jatuh tempo %s', v_by, new.title,
                     to_char(new.due_date, 'DD-MM-YYYY')),
              v_data, '/profil?tab=tugas', new.task_no);

      perform ops_core.emit('hr', 'hr.task.assigned', new.task_no,
        v_data || jsonb_build_object('to', v_user.email::text,
                                     'to_name', v_user.full_name,
                                     'link', '/profil?tab=tugas'));
    end if;
  end if;

  /* ── a task was handed over ── */
  if tg_op = 'UPDATE' and new.status = 'DONE' and old.status <> 'DONE' then
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

create trigger tasks_notify
  after insert or update of assignee_id, status on ops_hr.tasks
  for each row execute function ops_hr.task_notify();

/* ── the seams the bell reads with ────────────────────────────────────────
 *
 *  Plain answers, not envelopes: reading your bell and marking it read are not
 *  decisions anybody audits, and an envelope writes an audit row every time
 *  the bell polls.
 */
create or replace function ops_core.my_notifications(p_limit int default 30)
returns table (id bigint, kind text, title text, data jsonb, link text,
               entity_no text, created_at timestamptz, read_at timestamptz)
language sql stable security definer set search_path = ops_core, pg_temp as $$
  select n.id, n.kind, n.title, n.data, n.link, n.entity_no, n.created_at, n.read_at
    from ops_core.notifications n
   where n.user_id = auth.uid()
   order by n.created_at desc, n.id desc
   limit greatest(1, least(coalesce(p_limit, 30), 100));
$$;

create or replace function ops_core.unread_notifications()
returns int
language sql stable security definer set search_path = ops_core, pg_temp as $$
  select count(*)::int from ops_core.notifications
   where user_id = auth.uid() and read_at is null;
$$;

-- Null marks every unread one. Somebody else's ids are simply not theirs to
-- mark — the predicate is the whole check.
create or replace function ops_core.mark_notifications_read(p_ids bigint[] default null)
returns int
language plpgsql volatile security definer set search_path = ops_core, pg_temp as $$
declare n int;
begin
  update ops_core.notifications
     set read_at = now()
   where user_id = auth.uid()
     and read_at is null
     and (p_ids is null or id = any(p_ids));
  get diagnostics n = row_count;
  return n;
end $$;

/* ── Chat: the two events are live ───────────────────────────────────────
 *
 *  One day, like the default: a task notice from yesterday is still news this
 *  morning, a week-old one is not. john-lau's renderers for both must be
 *  deployed before these rows go live in production — a live rule with no
 *  renderer fails its five attempts in under half an hour and stops.
 */
insert into ops_core.delivery_rules (event_type, channel, is_live, max_age, note) values
  ('hr.task.assigned', 'chat', true, interval '1 day',
   'Live, by instruction (D374): every task that reaches a person — assigned, raised by a '
   'routine, made from a dadakan line, or moved to them — is sent to that person in a Chat DM.'),
  ('hr.task.delivered', 'chat', true, interval '1 day',
   'Live, by instruction (D374): a task closed with its hand-over note is sent to HRD (write '
   'or admin) and to whoever assigned it. Never to the person who closed it.');

revoke execute on function ops_hr.task_delivery_recipients(uuid) from public;
revoke execute on function ops_hr.task_notify() from public;

-- A trigger function cannot be called as a function — Postgres refuses it
-- outside a trigger — so the grant opens nothing; it is here because A2 asks
-- every definer function to be reachable and to decide inside.
grant execute on function ops_hr.task_notify() to authenticated;
revoke execute on function ops_core.my_notifications(int) from public;
revoke execute on function ops_core.unread_notifications() from public;
revoke execute on function ops_core.mark_notifications_read(bigint[]) from public;

grant execute on function ops_core.my_notifications(int) to authenticated;
grant execute on function ops_core.unread_notifications() to authenticated;
grant execute on function ops_core.mark_notifications_read(bigint[]) to authenticated;

analyze ops_core.notifications;
