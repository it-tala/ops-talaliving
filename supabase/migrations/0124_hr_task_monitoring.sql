-- 0124 — tugas rutin, periode, penagihan, deliverable.
--
-- ── the failure this is built against ─────────────────────────────────────
--
-- The owner described the failure precisely, and it is not a missing table:
--
--   *karyawan meeting dengan pimpinan, pimpinan assign tugas baik rutin maupun
--    tugas tambahan baru. Pimpinan lupa. Karyawan tidak mengerjakan.*
--
-- Three separate breakages in one sentence, and `0052`'s tracker answers none
-- of them. It records that a task exists and when it is due. But the task was
-- spoken in a meeting, so nobody can show it was heard; it was described in a
-- sentence, so nobody agrees what *finished* looks like; it recurs every month,
-- so somebody has to remember to raise it; and nobody is ever reminded to ask
-- for it, so the only thing that surfaces it again is the leader's memory —
-- which is the thing that failed.
--
-- So this migration adds four things, one per breakage, and each is a column or
-- a row rather than a habit:
--
--   **periode pengerjaan** — `period_start`/`period_end`. A due date says when
--   it is late. A period says what stretch of work the thing covers, which is
--   what a monthly report or a weekly stock count actually is. Without it two
--   months of the same routine are indistinguishable rows with different dates.
--
--   **kapan ditagih** — `chase_date`, and a recorded chase beside it. This is
--   the direct answer to *pimpinan lupa*: the system, not the leader, holds the
--   date on which somebody must ask. `v_task_chase` is the list, and
--   `chase_task()` is how asking is written down, so the list shrinks when the
--   asking happens rather than when the leader feels finished.
--
--   **deliverable** — `deliverable`, what has to be handed over, and
--   `delivered_note`, what actually was. *Finished* becomes a thing two people
--   can check against the same sentence instead of two memories of a meeting.
--   Handing the file itself in through the app is W7 in the backlog and needs a
--   storage road HR does not have; this is the half that can be built honestly
--   today, and the half that makes the other half worth building.
--
--   **tugas rutin** — `ops_hr.task_routines`, the standing definition, plus a
--   generator that turns it into dated tasks. A routine is not a task: it has
--   no due date, cannot be done, and outlives every row it raises.
--
-- And one more, because *kami ingin memastikan tugas disampaikan dengan jelas*
-- is a fifth requirement and not a restatement of the other four:
-- **`acknowledged_at`**. A task is assigned by one person and *received* by
-- another, and until the second happens there is no evidence it was heard. The
-- board prints **belum dibaca** rather than assuming. This is deliberately not
-- a blocker on anything — an unacknowledged task is still due, still late when
-- it is late (A6) — because a rule that let people escape a deadline by not
-- clicking would be a worse tracker than no acknowledgement at all. It is
-- evidence for the argument afterwards, on both sides: the leader can see the
-- task never landed, and the employee can show they were never told.
--
-- ── what this deliberately does not do ────────────────────────────────────
--
-- It does not score anything new. `0064`'s `task_delivery` measure keeps
-- counting exactly what it counted — tasks due in the period, on time or not —
-- and a missed chase, an unacknowledged task and an empty `delivered_note` all
-- stay out of anybody's number. Every one of them is at least as much the
-- leader's failure as the assignee's, and a score that cannot tell the
-- difference is a score that punishes the wrong person (D261). They are
-- printed, not weighed.

/* ── the routine: a standing expectation, not a task ──────────────────────
 *
 *  Cadence is an enum and not a cron string on purpose. A cron field can
 *  hold `every 7th day` and nobody can say what period that covers, whereas
 *  every value here has an obvious first and last day — which is the whole
 *  point of a period. Five cadences cover what the office actually runs;
 *  a sixth is a migration, and one worth arguing about.
 */
create type ops_hr.task_cadence_t as enum
  ('WEEKLY','MONTHLY','QUARTERLY','SEMESTER','ANNUAL');

insert into ops_core.doc_prefixes (prefix, what) values ('rtn', 'task routine');

create table ops_hr.task_routines (
  id              uuid primary key default gen_random_uuid(),
  routine_no      text not null unique default ops_core.next_doc_number('rtn'),
  title           text not null check (length(btrim(title)) > 0),
  detail          text,
  -- Required here, unlike on a one-off task, and that is the point of the
  -- table: a standing expectation whose deliverable nobody wrote down is the
  -- thing that gets argued about every single period, forever.
  deliverable     text not null check (length(btrim(deliverable)) > 0),
  assignee_id     uuid not null references ops_hr.employees(id),
  cadence         ops_hr.task_cadence_t not null,
  -- Days after the period ends that the work is due. 0 means the last day of
  -- the period itself; a monthly report due on the 5th is `4`.
  due_offset_days int not null default 0 check (due_offset_days between 0 and 60),
  -- Days **before** the due date on which somebody should ask for it. Zero is
  -- allowed and means *ask on the day*, which is honest but usually too late
  -- to help — the screen suggests two.
  chase_lead_days int not null default 0 check (chase_lead_days between 0 and 60),
  starts_on       date not null,
  -- Null while it is still expected. Ending a routine never touches the tasks
  -- it already raised: those are history and stay due (A2).
  ends_on         date,
  ended_reason    text,
  created_by      uuid not null references ops_core.users(id),
  created_at      timestamptz not null default now(),

  constraint routine_window check (ends_on is null or ends_on >= starts_on),
  -- Stopping says why, for the same reason cancelling a task does: in six
  -- months *why did we stop doing the monthly stock count* is a real question.
  constraint routine_end_says_why check (
    (ends_on is null and ended_reason is null)
    or (ends_on is not null and length(btrim(coalesce(ended_reason,''))) > 0))
);

create index task_routines_live_idx on ops_hr.task_routines (assignee_id)
  where ends_on is null;

/* ── the four columns the task was missing ─────────────────────────────── */
alter table ops_hr.tasks
  add column period_start    date,
  add column period_end      date,
  add column chase_date      date,
  add column deliverable     text,
  add column delivered_note  text,
  add column acknowledged_at timestamptz,
  add column chased_at       timestamptz,
  add column chased_by       uuid references ops_core.users(id),
  add column chase_note      text,
  add column routine_id      uuid references ops_hr.task_routines(id);

-- A period is two dates or neither. One date is a range nobody can read.
alter table ops_hr.tasks add constraint period_is_a_range check (
  (period_start is null and period_end is null)
  or (period_start is not null and period_end is not null and period_end >= period_start));
-- Work cannot be due before the stretch it covers has finished — that would be
-- asking for a monthly report in the middle of the month and calling the
-- person late for the half that had not happened yet.
alter table ops_hr.tasks add constraint due_after_period check (
  period_end is null or due_date >= period_end);
-- Chasing before the task was assigned, or after it was due, is not chasing.
-- Late is a different signal and `overdue` already carries it.
alter table ops_hr.tasks add constraint chase_before_due check (
  chase_date is null or chase_date <= due_date);
alter table ops_hr.tasks add constraint chase_is_signed check (
  (chased_at is null) = (chased_by is null));

/* One task per routine per period, and the database says so rather than the
 * generator remembering. This is what makes `roll_task_routines()` safe to run
 * twice, safe to run from two screens at once, and safe to run after somebody
 * raised this month's row by hand. A unique index, not a check in code, because
 * the generator is not the only thing that inserts.
 */
create unique index tasks_routine_period_uq
  on ops_hr.tasks (routine_id, period_start)
  where routine_id is not null;

create index tasks_chase_idx on ops_hr.tasks (chase_date)
  where status = 'OPEN' and chased_at is null;

/* ── the account behind the employee ──────────────────────────────────────
 *
 *  `ops_hr.employees` has never known which login belongs to which person, and
 *  until now nothing needed it to: HRD typed everything and HRD read
 *  everything. The moment a task has to be *received* rather than merely
 *  recorded, that gap becomes load-bearing — `acknowledged_at` with no way to
 *  tell whose click it was is a timestamp, not evidence, and *karyawan tidak
 *  mengerjakan* cannot be answered by a tracker the karyawan cannot open.
 *
 *  So one column, and only one. The profile screen the owner asked for on the
 *  same day is **W7 in the backlog and deliberately not built here** — but it
 *  rests on exactly this link, and building the link badly now to avoid
 *  touching it would make that screen worse later.
 *
 *  Nullable, because most employees have no account and that is normal: a
 *  production worker with no email is still an employee, still assignable, and
 *  their tasks are still chased the old way, by a person. Unique, because two
 *  employees sharing a login would let each of them acknowledge the other's
 *  work.
 */
alter table ops_hr.employees add column user_id uuid unique references ops_core.users(id);

comment on column ops_hr.employees.user_id is
  'The login this person uses, when they have one. Null is normal.';

/* Definer, and it has to be: the caller may be an employee with no `hrd.read`
 * at all, and this is the function that decides whether they may see their own
 * row. Under the caller's own RLS it would answer null for exactly the people
 * it exists to serve — the same shape as F135, met at a fourth door.
 *
 * It answers about `auth.uid()` and nothing else. There is no parameter to
 * pass somebody else's id into, which is what keeps a definer function that
 * bypasses RLS from becoming a way to ask *who is B-009?*.
 */
create or replace function ops_hr.my_employee_id()
returns uuid
language sql stable security definer set search_path = ops_hr, ops_core, pg_temp as $$
  select id from ops_hr.employees where user_id = auth.uid();
$$;

revoke execute on function ops_hr.my_employee_id() from public;
grant execute on function ops_hr.my_employee_id() to authenticated;

/* ── periods, as arithmetic rather than as a convention ───────────────────
 *
 *  Both immutable and both total: every date has exactly one period of each
 *  cadence, and the two functions agree on its edges. That matters more than it
 *  looks — `tasks_routine_period_uq` is a unique index over `period_start`, so
 *  a period boundary that moved between two runs of the generator would not
 *  collide with itself and the same month would be raised twice.
 *
 *  Weeks start Monday (`date_trunc('week')`, ISO), which is also what
 *  `is_rest_day` assumes when it reads `isodow`. One definition of a week.
 */
create or replace function ops_hr.task_period_start(p_cadence ops_hr.task_cadence_t, p_on date)
returns date
language sql immutable as $$
  select case p_cadence
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
    when 'WEEKLY'    then interval '7 days'
    when 'MONTHLY'   then interval '1 month'
    when 'QUARTERLY' then interval '3 months'
    when 'SEMESTER'  then interval '6 months'
    when 'ANNUAL'    then interval '1 year'
  end - interval '1 day')::date;
$$;

/* A period as a person says it out loud. `Sep 2026`, not `2026-09-01 →
 * 2026-09-30`, because the second one is read twice and the first one once. */
create or replace function ops_hr.task_period_label(p_cadence ops_hr.task_cadence_t, p_start date)
returns text
language sql immutable as $$
  select case p_cadence
    when 'WEEKLY'    then 'Minggu ' || to_char(p_start, 'IW/IYYY')
    when 'MONTHLY'   then to_char(p_start, 'Mon YYYY')
    when 'QUARTERLY' then 'TW' || to_char(p_start, 'Q YYYY')
    when 'SEMESTER'  then 'Smt ' || (case when extract(month from p_start) <= 6 then '1' else '2' end)
                          || ' ' || to_char(p_start, 'YYYY')
    when 'ANNUAL'    then to_char(p_start, 'YYYY')
  end;
$$;

/* ── the tracker, restated ────────────────────────────────────────────────
 *
 *  Dropped and rebuilt rather than replaced, because `0052` selected `t.*` and
 *  ten new columns land in the middle of that expansion — `create or replace
 *  view` refuses a column list that changed anywhere but the end. So the
 *  columns are **named** this time. That is not tidiness either: the next
 *  `alter table` on `ops_hr.tasks` will now leave this view alone instead of
 *  silently widening every contract cast against it.
 */
drop view if exists ops_hr.v_task;

create view ops_hr.v_task as
select
  t.id, t.task_no, t.title, t.detail,
  t.assignee_id, t.assigned_by, t.assigned_at, t.due_date,
  t.ref_kind, t.ref_no, t.status,
  t.done_at, t.done_by,
  t.blocked_reason, t.blocked_at, t.cancelled_reason,
  t.period_start, t.period_end, t.chase_date,
  t.deliverable, t.delivered_note,
  t.acknowledged_at, t.chased_at, t.chased_by, t.chase_note,
  t.routine_id,
  e.full_name    as assignee_name,
  e.employee_no  as assignee_no,
  coalesce(u.full_name, t.assigned_by::text) as assigned_by_name,
  coalesce(c.full_name, t.chased_by::text)   as chased_by_name,
  r.routine_no,
  r.cadence      as routine_cadence,
  (t.due_date - ops_core.office_day())::int  as days_left,
  -- **Blocked is not overdue.** A task waiting on somebody else has not been
  -- failed by the person holding it (D261).
  (t.status = 'OPEN' and t.blocked_reason is null
     and t.due_date < ops_core.office_day())                     as overdue,
  (t.status = 'DONE' and ops_core.office_day(t.done_at) > t.due_date) as late,
  case when t.done_at is null then null
       else (t.due_date - ops_core.office_day(t.done_at))::int end as days_early,
  -- Was it ever received? Not a rule, an observation — an unacknowledged task
  -- is still due and still late when it is late (A6). It is here so that the
  -- argument afterwards has a fact in it.
  (t.acknowledged_at is not null) as acknowledged,
  /* **Due to be asked for, today.** The one column this whole migration exists
     for. Open, not blocked — chasing somebody for work that is waiting on
     somebody else is how a tracker teaches people to stop reporting blockers
     (D261) — its chase date reached, and nobody has asked yet. It stops being
     true the moment somebody records that they asked, not when the work
     arrives, because those are two different events and only one of them is
     the leader's. */
  (t.status = 'OPEN' and t.blocked_reason is null
     and t.chase_date is not null and t.chased_at is null
     and t.chase_date <= ops_core.office_day())                  as chase_due,
  case when t.chase_date is null then null
       else (t.chase_date - ops_core.office_day())::int end      as days_to_chase,
  case when t.period_start is null then null
       when r.cadence is not null then ops_hr.task_period_label(r.cadence, t.period_start)
       else to_char(t.period_start, 'DD Mon') || ' – ' || to_char(t.period_end, 'DD Mon YYYY')
  end as period_label,
  -- What somebody has to deal with, first: overdue, then what must be asked
  -- for today, then blocked, then by date. Chasing sits **above** blocked and
  -- below overdue on purpose — a blocked task needs somebody else to move, and
  -- a chase is the one thing on this list the reader can do right now.
  (case
     when t.status <> 'OPEN' then 4
     when t.blocked_reason is null and t.due_date < ops_core.office_day() then 0
     when t.status = 'OPEN' and t.blocked_reason is null
          and t.chase_date is not null and t.chased_at is null
          and t.chase_date <= ops_core.office_day() then 1
     when t.blocked_reason is not null then 2
     else 3
   end)::int as queue_rank
from ops_hr.tasks t
join ops_hr.employees e on e.id = t.assignee_id
left join ops_core.users u on u.id = t.assigned_by
left join ops_core.users c on c.id = t.chased_by
left join ops_hr.task_routines r on r.id = t.routine_id;

alter view ops_hr.v_task set (security_invoker = on);

/* ── the routines, as a person reads them ─────────────────────────────── */
create or replace view ops_hr.v_task_routine as
select
  r.id, r.routine_no, r.title, r.detail, r.deliverable,
  r.assignee_id, r.cadence, r.due_offset_days, r.chase_lead_days,
  r.starts_on, r.ends_on, r.ended_reason, r.created_by, r.created_at,
  e.full_name   as assignee_name,
  e.employee_no as assignee_no,
  (r.ends_on is null or r.ends_on >= ops_core.office_day()) as live,
  -- The period this routine is in right now, and what it would raise for it.
  -- Shown beside the definition so `setiap tanggal 5` can be checked against a
  -- real date before anybody commits to it, rather than discovered next month.
  ops_hr.task_period_start(r.cadence, ops_core.office_day())  as current_period_start,
  ops_hr.task_period_label(r.cadence,
    ops_hr.task_period_start(r.cadence, ops_core.office_day())) as current_period,
  (ops_hr.task_period_end(r.cadence,
     ops_hr.task_period_start(r.cadence, ops_core.office_day())) + r.due_offset_days) as current_due,
  (select count(*) from ops_hr.tasks t where t.routine_id = r.id)::int as raised_count,
  (select count(*) from ops_hr.tasks t
    where t.routine_id = r.id and t.status = 'OPEN')::int as open_count
from ops_hr.task_routines r
join ops_hr.employees e on e.id = r.assignee_id;

alter view ops_hr.v_task_routine set (security_invoker = on);

/* ── access ───────────────────────────────────────────────────────────── */
alter table ops_hr.task_routines enable row level security;

create policy task_routines_read on ops_hr.task_routines for select to authenticated
  using (ops_core.has_permission('hrd.read'));
create policy task_routines_new on ops_hr.task_routines for insert to authenticated
  with check (ops_core.has_permission('hrd.create'));
create policy task_routines_edit on ops_hr.task_routines for update to authenticated
  using (ops_core.has_permission('hrd.update')) with check (ops_core.has_permission('hrd.update'));
-- No delete, for the reason `tasks` has none: a routine that was run for two
-- years and then stopped is history, and `ends_on` is how it stops (A2).

/* **A person may read their own tasks.** The second half of *karyawan tidak
   mengerjakan*: a tracker only HRD can open is a tracker the person doing the
   work has never seen. Own rows only, by the account-to-employee link above
   and nothing else — no permission is implied, no colleague's row is reachable,
   and an employee with no account matches nothing because `my_employee_id()`
   answers null and `assignee_id = null` is never true. */
create policy tasks_read_own on ops_hr.tasks for select to authenticated
  using (assignee_id = ops_hr.my_employee_id());

/* And the row the task points at, or the first one buys nothing. `v_task`
   joins `ops_hr.employees` to print the assignee's name, and an inner join a
   reader cannot see returns no rows at all — the policy above would let an
   employee read a task through the base table and still show them an empty
   screen. Own row, by the same link, and nobody else's: what it opens is this
   person's own name, unit and pay, which are theirs to know. It is not the
   profile screen (W7) and it is not a wider `employees_read` — `hrd.read` and
   `payroll.read` still decide who sees the roster. */
create policy employees_read_own on ops_hr.employees for select to authenticated
  using (user_id = auth.uid());

-- `v_task` was dropped and rebuilt above, and a dropped view takes its grants
-- with it — `0052`'s blanket `grant select on all tables in schema ops_hr` ran
-- once, in 2026, and does not reach a view created today. Named, one line each,
-- for the reason the function grants below are named (F147).
grant select on ops_hr.v_task to authenticated;
grant select on ops_hr.v_task_routine to authenticated;
grant select on ops_hr.task_routines to authenticated;

/* ── asking somebody to do something ──────────────────────────────────── */
create or replace function ops_hr.assign_task(
  p_assignee_no text, p_title text, p_due date,
  p_detail text default null, p_deliverable text default null,
  p_period_start date default null, p_period_end date default null,
  p_chase_date date default null,
  p_ref_kind ops_hr.task_ref_t default 'none', p_ref_no text default null,
  p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare
  v_replayed jsonb; emp ops_hr.employees%rowtype; v_no text; v_res jsonb;
begin
  v_replayed := ops_core.idem_replay('hr','assign_task', p_key);
  if v_replayed is not null then return v_replayed; end if;

  if not ops_core.has_permission('hrd.create') then
    return ops_core.refused('hr','task', null,'assign',
      'not_permitted','Memberi tugas butuh akses HRD.');
  end if;

  select * into emp from ops_hr.employees where employee_no = p_assignee_no;
  if not found then
    return ops_core.not_found('hr','task', p_assignee_no,'assign',
      format('Tidak ada karyawan %s.', p_assignee_no));
  end if;
  if not emp.active then
    return ops_core.conflict('hr','task', null,'assign',
      'employee_left', format('%s sudah tidak aktif.', emp.full_name));
  end if;
  if coalesce(btrim(coalesce(p_title,'')),'') = '' then
    return ops_core.invalid('hr','task', null,'assign',
      'title_required','Tugasnya apa?', jsonb_build_object('field','title'));
  end if;
  if p_due is null then
    return ops_core.invalid('hr','task', null,'assign','due_date_required',
      'Tugas tanpa tanggal tidak bisa terlambat, yang berarti tidak ada yang bisa tahu kapan ia terlambat.',
      jsonb_build_object('field','due_date'));
  end if;
  /* Refused rather than shrugged at, because the two halves of a period are
     typed on the same screen and one of them missing is a slip, not a choice.
     The constraint underneath would refuse it too; this is the version with a
     sentence in it (A7). */
  if (p_period_start is null) <> (p_period_end is null) then
    return ops_core.invalid('hr','task', null,'assign','period_incomplete',
      'Periode pengerjaan diisi dua-duanya atau tidak sama sekali — satu tanggal saja bukan periode.',
      jsonb_build_object('field', case when p_period_start is null then 'period_start' else 'period_end' end));
  end if;
  if p_period_end is not null and p_period_end < p_period_start then
    return ops_core.invalid('hr','task', null,'assign','period_backwards',
      'Periode selesai mendahului periode mulai.', jsonb_build_object('field','period_end'));
  end if;
  if p_period_end is not null and p_due < p_period_end then
    return ops_core.invalid('hr','task', null,'assign','due_inside_period',
      format('Jatuh tempo %s jatuh sebelum periodenya selesai (%s). Pekerjaan tidak bisa ditagih untuk bagian yang belum terjadi.',
             p_due, p_period_end),
      jsonb_build_object('field','due_date'));
  end if;
  if p_chase_date is not null and p_chase_date > p_due then
    return ops_core.invalid('hr','task', null,'assign','chase_after_due',
      'Tanggal penagihan lewat dari jatuh tempo. Menagih setelah telat bukan menagih — itu sudah terlambat, dan papan sudah menandainya sendiri.',
      jsonb_build_object('field','chase_date'));
  end if;
  if (p_ref_kind = 'none') <> (coalesce(btrim(coalesce(p_ref_no,'')),'') = '') then
    return ops_core.invalid('hr','task', null,'assign','ref_incomplete',
      'Rujukan itu jenis dan nomor sekaligus, atau tidak ada dua-duanya.',
      jsonb_build_object('field','ref_no'));
  end if;

  insert into ops_hr.tasks
    (title, detail, assignee_id, assigned_by, due_date,
     ref_kind, ref_no, deliverable, period_start, period_end, chase_date)
  values (btrim(p_title), nullif(btrim(coalesce(p_detail,'')),''), emp.id, auth.uid(), p_due,
          p_ref_kind, nullif(btrim(coalesce(p_ref_no,'')),''),
          nullif(btrim(coalesce(p_deliverable,'')),''),
          p_period_start, p_period_end, p_chase_date)
  returning task_no into v_no;

  v_res := ops_core.ok('hr','task', v_no,'assign',
    jsonb_build_object('task_no', v_no, 'assignee_no', emp.employee_no,
                       'due_date', p_due, 'chase_date', p_chase_date),
    null,
    jsonb_build_object('assignee', emp.employee_no, 'due', p_due,
                       'chase', p_chase_date, 'deliverable', nullif(btrim(coalesce(p_deliverable,'')),''),
                       'period', case when p_period_start is null then null
                                      else p_period_start::text || '..' || p_period_end::text end));
  return ops_core.idem_remember('hr','assign_task', p_key, v_res);
end $$;

/* ── received, asked for, finished ────────────────────────────────────── */
--
-- `acknowledge_task` is the only seam in HR a person with **no HRD permission
-- at all** may call, and it is deliberately the smallest possible one: it sets
-- a timestamp on a row already addressed to them, and can do nothing else. A
-- leader with `hrd.update` may also set it, which is how a task agreed in a
-- meeting by somebody with no account gets recorded — the audit row says which
-- of the two happened, so *he said he never got it* has an answer either way.
create or replace function ops_hr.acknowledge_task(p_task_no text)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare t ops_hr.tasks%rowtype; v_mine boolean;
begin
  select * into t from ops_hr.tasks where task_no = p_task_no;
  if not found then
    return ops_core.not_found('hr','task', p_task_no,'acknowledge',
      format('Tidak ada tugas %s.', p_task_no));
  end if;

  v_mine := t.assignee_id = ops_hr.my_employee_id();
  if not (v_mine or ops_core.has_permission('hrd.update')) then
    return ops_core.refused('hr','task', p_task_no,'acknowledge',
      'not_permitted','Hanya yang diberi tugas, atau HRD, yang bisa menandai tugas ini diterima.');
  end if;
  if t.acknowledged_at is not null then
    return ops_core.noop('hr','task', p_task_no,'acknowledge',
      format('%s sudah ditandai diterima.', p_task_no));
  end if;

  update ops_hr.tasks set acknowledged_at = now() where id = t.id;

  return ops_core.ok('hr','task', t.task_no,'acknowledge',
    jsonb_build_object('task_no', t.task_no, 'acknowledged_at', now()),
    null,
    jsonb_build_object('by', case when v_mine then 'assignee' else 'hrd' end));
end $$;

/* Writing down that somebody was asked.
 *
 * This is the whole answer to *pimpinan lupa*, and it is one `update`. The
 * value is not in the column — it is in what the column removes the row from:
 * `chase_due` goes false, so the next person to open the board is not shown a
 * task that was already chased an hour ago by somebody else. Asking twice is
 * allowed and overwrites the timestamp; every individual asking is in the audit
 * log with its note, which is the one road evidence travels (ADR-010).
 */
create or replace function ops_hr.chase_task(p_task_no text, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare t ops_hr.tasks%rowtype;
begin
  if not ops_core.has_permission('hrd.update') then
    return ops_core.refused('hr','task', p_task_no,'chase',
      'not_permitted','Menagih tugas butuh akses HRD.');
  end if;
  select * into t from ops_hr.tasks where task_no = p_task_no;
  if not found then
    return ops_core.not_found('hr','task', p_task_no,'chase',
      format('Tidak ada tugas %s.', p_task_no));
  end if;
  if t.status <> 'OPEN' then
    return ops_core.conflict('hr','task', p_task_no,'chase','task_closed',
      format('%s sudah %s — tidak ada yang perlu ditagih.', t.task_no, lower(t.status::text)));
  end if;

  update ops_hr.tasks
     set chased_at = now(), chased_by = auth.uid(),
         chase_note = nullif(btrim(coalesce(p_note,'')),'')
   where id = t.id;

  return ops_core.ok('hr','task', t.task_no,'chase',
    jsonb_build_object('task_no', t.task_no, 'chased_at', now()),
    null,
    jsonb_build_object('note', nullif(btrim(coalesce(p_note,'')),''),
                       'due', t.due_date, 'chase_date', t.chase_date));
end $$;

/* Done, blocked, unblocked or cancelled — the four things that happen to a
 * task, each carrying what it needs.
 *
 * `p_delivered` is new and is **not** required, on purpose. A task whose
 * `deliverable` says *laporan stok dalam bentuk excel* and whose
 * `delivered_note` says nothing is a weaker record than one that says *dikirim
 * via WA 3 Sep*, and the screen says so — but refusing to let somebody mark
 * their own work finished because they did not fill a text box is how a
 * tracker stops being used (A6). Money refuses; this warns.
 */
create or replace function ops_hr.update_task(
  p_task_no text, p_action text, p_reason text default null,
  p_delivered text default null, p_done_on date default null)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare t ops_hr.tasks%rowtype;
begin
  if not ops_core.has_permission('hrd.update') then
    return ops_core.refused('hr','task', p_task_no, p_action,
      'not_permitted','Mengubah tugas butuh akses HRD.');
  end if;
  if p_action not in ('done','block','unblock','cancel') then
    return ops_core.invalid('hr','task', p_task_no, coalesce(p_action,'update'),
      'unknown_action', format('Tidak ada tindakan %s.', coalesce(p_action,'(kosong)')),
      jsonb_build_object('field','action'));
  end if;

  select * into t from ops_hr.tasks where task_no = p_task_no;
  if not found then
    return ops_core.not_found('hr','task', p_task_no, p_action,
      format('Tidak ada tugas %s.', p_task_no));
  end if;
  if t.status <> 'OPEN' and p_action <> 'done' then
    return ops_core.conflict('hr','task', p_task_no, p_action,'task_closed',
      format('%s sudah %s.', t.task_no, lower(t.status::text)));
  end if;
  if p_action in ('block','cancel') and coalesce(btrim(coalesce(p_reason,'')),'') = '' then
    return ops_core.invalid('hr','task', p_task_no, p_action,'reason_required',
      case when p_action = 'block'
        then 'Tertahan menunggu apa? Tugas yang tertahan dikeluarkan dari penilaian orangnya — yang menghapus beban harus menyebut alasannya, dan kalimat ini juga yang dibaca pihak yang menahannya.'
        else 'Kenapa dibatalkan? Tugas yang dibatalkan tidak dihitung sebagai berhasil maupun gagal, jadi alasannya adalah satu-satunya jejak yang tersisa.' end,
      jsonb_build_object('field','reason'));
  end if;
  if p_action = 'unblock' and t.blocked_reason is null then
    return ops_core.noop('hr','task', p_task_no,'unblock',
      format('%s memang tidak sedang tertahan.', t.task_no));
  end if;
  if p_action = 'done' and t.status = 'DONE' then
    return ops_core.noop('hr','task', p_task_no,'done',
      format('%s sudah selesai.', t.task_no));
  end if;

  if p_action = 'done' then
    update ops_hr.tasks
       set status = 'DONE',
           -- The day it was finished, not the day it was typed (D148).
           done_at = case when p_done_on is null then now()
                          else (p_done_on::text || ' 12:00:00+08')::timestamptz end,
           done_by = auth.uid(),
           delivered_note = coalesce(nullif(btrim(coalesce(p_delivered,'')),''), delivered_note),
           blocked_reason = null, blocked_at = null
     where id = t.id;
  elsif p_action = 'block' then
    update ops_hr.tasks set blocked_reason = btrim(p_reason), blocked_at = now() where id = t.id;
  elsif p_action = 'unblock' then
    update ops_hr.tasks set blocked_reason = null, blocked_at = null where id = t.id;
  else
    update ops_hr.tasks set status = 'CANCELLED', cancelled_reason = btrim(p_reason) where id = t.id;
  end if;

  return ops_core.ok('hr','task', t.task_no, p_action,
    jsonb_build_object('task_no', t.task_no, 'action', p_action),
    null,
    jsonb_build_object('reason', nullif(btrim(coalesce(p_reason,'')),''),
                       'delivered', nullif(btrim(coalesce(p_delivered,'')),''),
                       'deliverable_asked', t.deliverable));
end $$;

/* ── the standing expectations ────────────────────────────────────────── */
--
-- One seam for new and for changed, the same shape `save_pay_rules` uses: null
-- `routine_no` creates. What it will **not** change is the cadence, and that
-- refusal is the interesting part of this function. `tasks_routine_period_uq`
-- is keyed on `(routine_id, period_start)`, so turning a monthly routine into a
-- weekly one re-cuts every period boundary: September's raised task keeps
-- `period_start = 1 Sep`, the weekly generator asks for 1 Sep as well, and the
-- collision is silent — one week of September quietly never gets raised, every
-- month, forever. Ending the routine and starting another is one extra click
-- and leaves both histories readable.
create or replace function ops_hr.save_task_routine(
  p_routine_no text, p_title text, p_deliverable text, p_assignee_no text,
  p_cadence ops_hr.task_cadence_t, p_due_offset_days int default 0,
  p_chase_lead_days int default 2, p_starts_on date default null,
  p_detail text default null, p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare
  v_replayed jsonb; emp ops_hr.employees%rowtype; r ops_hr.task_routines%rowtype;
  v_no text; v_new boolean; v_res jsonb; v_start date;
begin
  v_replayed := ops_core.idem_replay('hr','save_task_routine', p_key);
  if v_replayed is not null then return v_replayed; end if;

  v_new := coalesce(btrim(coalesce(p_routine_no,'')),'') = '';
  if not ops_core.has_permission(case when v_new then 'hrd.create' else 'hrd.update' end) then
    return ops_core.refused('hr','task_routine', p_routine_no,'save',
      'not_permitted','Mengatur tugas rutin butuh akses HRD.');
  end if;
  if coalesce(btrim(coalesce(p_title,'')),'') = '' then
    return ops_core.invalid('hr','task_routine', p_routine_no,'save',
      'title_required','Tugas rutinnya apa?', jsonb_build_object('field','title'));
  end if;
  if coalesce(btrim(coalesce(p_deliverable,'')),'') = '' then
    return ops_core.invalid('hr','task_routine', p_routine_no,'save','deliverable_required',
      'Apa yang harus diserahkan? Tugas rutin tanpa hasil yang disebutkan adalah yang diperdebatkan ulang setiap periode.',
      jsonb_build_object('field','deliverable'));
  end if;
  if p_due_offset_days is null or p_due_offset_days < 0 or p_due_offset_days > 60
     or p_chase_lead_days is null or p_chase_lead_days < 0 or p_chase_lead_days > 60 then
    return ops_core.invalid('hr','task_routine', p_routine_no,'save','offset_out_of_range',
      'Tenggat dan penagihan dihitung dalam hari, 0 sampai 60.',
      jsonb_build_object('field','due_offset_days'));
  end if;

  select * into emp from ops_hr.employees where employee_no = p_assignee_no;
  if not found then
    return ops_core.not_found('hr','task_routine', p_assignee_no,'save',
      format('Tidak ada karyawan %s.', p_assignee_no));
  end if;
  if not emp.active then
    return ops_core.conflict('hr','task_routine', p_routine_no,'save','employee_left',
      format('%s sudah tidak aktif — tugas rutin baru tidak bisa ditujukan ke sana.', emp.full_name));
  end if;

  if v_new then
    v_start := coalesce(p_starts_on, ops_core.office_day());
    insert into ops_hr.task_routines
      (title, detail, deliverable, assignee_id, cadence,
       due_offset_days, chase_lead_days, starts_on, created_by)
    values (btrim(p_title), nullif(btrim(coalesce(p_detail,'')),''), btrim(p_deliverable),
            emp.id, p_cadence, p_due_offset_days, p_chase_lead_days, v_start, auth.uid())
    returning routine_no into v_no;
  else
    select * into r from ops_hr.task_routines where routine_no = p_routine_no;
    if not found then
      return ops_core.not_found('hr','task_routine', p_routine_no,'save',
        format('Tidak ada tugas rutin %s.', p_routine_no));
    end if;
    if r.ends_on is not null then
      return ops_core.conflict('hr','task_routine', p_routine_no,'save','routine_ended',
        format('%s sudah dihentikan %s. Yang sudah berhenti tidak diubah — buat yang baru.',
               r.routine_no, r.ends_on));
    end if;
    if r.cadence <> p_cadence then
      return ops_core.conflict('hr','task_routine', p_routine_no,'save','cadence_is_fixed',
        format('%s sudah berjalan %s. Mengganti iramanya memotong ulang setiap periode dan membuat periode yang sudah terbit bertabrakan dengan yang baru — hentikan yang ini, lalu buat tugas rutin baru.',
               r.routine_no, lower(r.cadence::text)));
    end if;
    update ops_hr.task_routines
       set title = btrim(p_title), detail = nullif(btrim(coalesce(p_detail,'')),''),
           deliverable = btrim(p_deliverable), assignee_id = emp.id,
           due_offset_days = p_due_offset_days, chase_lead_days = p_chase_lead_days,
           starts_on = coalesce(p_starts_on, r.starts_on)
     where id = r.id;
    v_no := r.routine_no;
  end if;

  v_res := ops_core.ok('hr','task_routine', v_no, case when v_new then 'create' else 'update' end,
    jsonb_build_object('routine_no', v_no, 'assignee_no', emp.employee_no, 'cadence', p_cadence),
    null,
    jsonb_build_object('title', btrim(p_title), 'assignee', emp.employee_no,
                       'cadence', p_cadence, 'due_offset_days', p_due_offset_days,
                       'chase_lead_days', p_chase_lead_days));
  return ops_core.idem_remember('hr','save_task_routine', p_key, v_res);
end $$;

-- Stopping. Never deletes and never touches the tasks already raised: last
-- month's report is still owed even if the routine that asked for it has been
-- discontinued (A2).
create or replace function ops_hr.end_task_routine(
  p_routine_no text, p_reason text, p_on date default null)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare r ops_hr.task_routines%rowtype; v_on date; v_open int;
begin
  if not ops_core.has_permission('hrd.update') then
    return ops_core.refused('hr','task_routine', p_routine_no,'end',
      'not_permitted','Menghentikan tugas rutin butuh akses HRD.');
  end if;
  select * into r from ops_hr.task_routines where routine_no = p_routine_no;
  if not found then
    return ops_core.not_found('hr','task_routine', p_routine_no,'end',
      format('Tidak ada tugas rutin %s.', p_routine_no));
  end if;
  if r.ends_on is not null then
    return ops_core.noop('hr','task_routine', p_routine_no,'end',
      format('%s sudah dihentikan %s.', r.routine_no, r.ends_on));
  end if;
  if coalesce(btrim(coalesce(p_reason,'')),'') = '' then
    return ops_core.invalid('hr','task_routine', p_routine_no,'end','reason_required',
      'Kenapa dihentikan? Enam bulan lagi pertanyaannya bukan apakah dihentikan, tapi kenapa.',
      jsonb_build_object('field','reason'));
  end if;

  v_on := coalesce(p_on, ops_core.office_day());
  if v_on < r.starts_on then
    return ops_core.invalid('hr','task_routine', p_routine_no,'end','ends_before_start',
      format('Tanggal berhenti mendahului tanggal mulai (%s).', r.starts_on),
      jsonb_build_object('field','ends_on'));
  end if;

  update ops_hr.task_routines
     set ends_on = v_on, ended_reason = btrim(p_reason) where id = r.id;

  select count(*) into v_open from ops_hr.tasks
   where routine_id = r.id and status = 'OPEN';

  return ops_core.ok('hr','task_routine', r.routine_no,'end',
    jsonb_build_object('routine_no', r.routine_no, 'ends_on', v_on,
                       -- Named back, not cancelled. Whoever stops the routine
                       -- should see what it still has outstanding.
                       'still_open', v_open),
    null,
    jsonb_build_object('reason', btrim(p_reason), 'still_open', v_open));
end $$;

/* ── turning routines into dated tasks ────────────────────────────────────
 *
 *  Run it as often as you like. Every insert is protected by
 *  `tasks_routine_period_uq`, so a second run in the same minute, two screens
 *  opening at once, and a run after somebody raised this month's row by hand
 *  all produce the same database. The skipped ones are **counted and named
 *  back**, not swallowed: a generator that reports "0 created" when it meant
 *  "0 needed" and a generator that reports it when it meant "the insert failed"
 *  are indistinguishable to the person reading, and only one of them is fine.
 *
 *  **`p_backfill_days` is the argument worth arguing about.** Raising only the
 *  period that contains today is the obvious rule and it is wrong: a routine
 *  nobody rolled for five weeks would silently never raise last month's report,
 *  which is precisely the failure this module was asked to fix. Back-filling
 *  from `starts_on` is the other obvious rule and it is also wrong: a weekly
 *  routine dated January would drop thirty-five instantly-overdue rows on
 *  somebody in September, and a board that opens with thirty-five red rows is a
 *  board nobody reads again. So: one month by default, adjustable, capped at a
 *  year, and the caller is told how many periods it covered.
 */
create or replace function ops_hr.roll_task_routines(
  p_through date default null, p_backfill_days int default 31)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare
  v_through date; v_from date; r record; v_pstart date; v_pend date;
  v_due date; v_chase date; v_no text;
  v_made int := 0; v_had int := 0; v_list jsonb := '[]'::jsonb;
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

  v_through := coalesce(p_through, ops_core.office_day());
  v_from    := v_through - p_backfill_days;

  for r in
    select * from ops_hr.task_routines
     where starts_on <= v_through
       and (ends_on is null or ends_on >= v_from)
     order by routine_no
  loop
    -- Every period of this cadence that begins in the window, plus the one the
    -- window opens inside. `generate_series` cannot step by "one quarter of the
    -- calendar", so the periods are walked.
    v_pstart := ops_hr.task_period_start(r.cadence, greatest(v_from, r.starts_on));
    while v_pstart <= v_through loop
      v_pend := ops_hr.task_period_end(r.cadence, v_pstart);
      -- A routine that started mid-period does not owe the part before it
      -- existed, and one that ended mid-period does not owe the part after.
      if v_pend >= r.starts_on and (r.ends_on is null or v_pstart <= r.ends_on) then
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
          -- Already raised. The only expected exception here, and it is the
          -- whole idempotency guarantee — caught narrowly so a real constraint
          -- failure still surfaces instead of being counted as "had it".
          v_had := v_had + 1;
        end;
      end if;
      v_pstart := ops_hr.task_period_start(r.cadence, v_pend + 1);
    end loop;
  end loop;

  return ops_core.ok('hr','task_routine', null,'roll',
    jsonb_build_object('through', v_through, 'from', v_from,
                       'created', v_made, 'already_there', v_had, 'tasks', v_list),
    null,
    jsonb_build_object('through', v_through, 'backfill_days', p_backfill_days,
                       'created', v_made, 'already_there', v_had));
end $$;

/* ── grants ───────────────────────────────────────────────────────────────
 *
 *  Named one at a time. A `grant execute on all functions in schema ops_hr`
 *  would be shorter and would have handed `my_employee_id()` to PUBLIC on the
 *  next migration that ran it — the same shape as F147, where a blanket table
 *  grant re-opened `employee_documents` four migrations after `0056` revoked
 *  it. Six lines is cheap.
 */
grant execute on function ops_hr.task_period_start(ops_hr.task_cadence_t, date) to authenticated;
grant execute on function ops_hr.task_period_end(ops_hr.task_cadence_t, date) to authenticated;
grant execute on function ops_hr.task_period_label(ops_hr.task_cadence_t, date) to authenticated;
grant execute on function ops_hr.assign_task(text, text, date, text, text, date, date, date, ops_hr.task_ref_t, text, text) to authenticated;
grant execute on function ops_hr.acknowledge_task(text) to authenticated;
grant execute on function ops_hr.chase_task(text, text) to authenticated;
grant execute on function ops_hr.update_task(text, text, text, text, date) to authenticated;
grant execute on function ops_hr.save_task_routine(text, text, text, text, ops_hr.task_cadence_t, int, int, date, text, text) to authenticated;
grant execute on function ops_hr.end_task_routine(text, text, date) to authenticated;
grant execute on function ops_hr.roll_task_routines(date, int) to authenticated;
