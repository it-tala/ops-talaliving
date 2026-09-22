-- 0052_hr_tasks.sql — the tracker, and the rule that makes it worth having.
--
-- The last two enums the contracts carried and the ladder never did.
-- `task_status_t` and `task_ref_t` arrived with M51, after `0001_core_types`
-- was written, so they are created here beside the table that needs them —
-- the same shape as `contribution_scheme_t` in 0048.
--
-- **A blocked task never counts against the assignee**, and that is the single
-- load-bearing rule of this module (D261). A tracker that punishes people for
-- reporting blockers is a tracker that stops being told about blockers, and
-- then it measures nothing at all. The rule lives in `v_task` below, where
-- `overdue` is computed, rather than in whoever happens to be reading.
create type ops_hr.task_status_t as enum ('OPEN','DONE','CANCELLED');
create type ops_hr.task_ref_t as enum ('none','work_order','project','purchase_request');

insert into ops_core.doc_prefixes (prefix, what) values ('tgs', 'task');

create table ops_hr.tasks (
  id               uuid primary key default gen_random_uuid(),
  task_no          text not null unique default ops_core.next_doc_number('tgs'),
  title            text not null check (length(btrim(title)) > 0),
  detail           text,
  -- A **real** employee link, and required: a task with no owner is a note.
  -- Production work links beside the name instead, because a subcontractor is
  -- a legitimate answer to *who did it* there and is not one here (D264).
  assignee_id      uuid not null references ops_hr.employees(id),
  assigned_by      uuid not null references ops_core.users(id),
  assigned_at      timestamptz not null default now(),
  -- Required. A task that cannot be late is one nobody can tell is late — the
  -- same rule the work order carries (D148).
  due_date         date not null,
  ref_kind         ops_hr.task_ref_t not null default 'none',
  -- A public code, validated at the seam and never joined across a service
  -- boundary (ADR-004): `spk-26-08-20_01`, not a uuid into `ops_prod`.
  ref_no           text,
  status           ops_hr.task_status_t not null default 'OPEN',
  done_at          timestamptz,
  done_by          uuid references ops_core.users(id),
  -- Waiting on something outside this person's hands, and on what.
  blocked_reason   text,
  blocked_at       timestamptz,
  cancelled_reason text,

  -- A reference is a kind and a code together, or it is neither. `none` with a
  -- code is a reference nobody can resolve; a kind with no code is a promise
  -- the row does not keep.
  constraint ref_is_complete check (
    (ref_kind = 'none' and ref_no is null)
    or (ref_kind <> 'none' and ref_no is not null and length(btrim(ref_no)) > 0)),
  -- Finishing is a person and a moment together (A5): a `done_at` with nobody
  -- behind it cannot answer *who said so* in a review six months later.
  constraint done_is_signed check (
    (status <> 'DONE' and done_at is null and done_by is null)
    or (status = 'DONE' and done_at is not null and done_by is not null)),
  -- Cancelling says why, or the tracker fills up with rows nobody can account
  -- for and the delivery figure quietly improves.
  constraint cancel_says_why check (
    status <> 'CANCELLED' or (cancelled_reason is not null and length(btrim(cancelled_reason)) > 0)),
  constraint blocked_is_complete check ((blocked_reason is null) = (blocked_at is null))
);

create index tasks_assignee_idx on ops_hr.tasks (assignee_id, due_date);
create index tasks_open_idx on ops_hr.tasks (due_date) where status = 'OPEN';

-- ── the tracker as a person reads it ──────────────────────────────────────
--
-- Transcribed from `taskView`. Three derived facts and one ordering, and none
-- of them is a column: `overdue` depends on today, and a stored one would be
-- wrong every morning until something wrote to the row.
create or replace view ops_hr.v_task as
select
  t.*,
  e.full_name    as assignee_name,
  e.employee_no  as assignee_no,
  coalesce(u.full_name, t.assigned_by::text) as assigned_by_name,
  (t.due_date - ops_core.office_day())::int  as days_left,
  -- **Blocked is not overdue.** A task waiting on somebody else has not been
  -- failed by the person holding it (D261).
  (t.status = 'OPEN' and t.blocked_reason is null
     and t.due_date < ops_core.office_day())                     as overdue,
  (t.status = 'DONE' and ops_core.office_day(t.done_at) > t.due_date) as late,
  case when t.done_at is null then null
       else (t.due_date - ops_core.office_day(t.done_at))::int end as days_early,
  -- What somebody has to deal with, first: overdue, then blocked, then by
  -- date. The same ordering the production board uses, for the same reason.
  (case
     when t.status <> 'OPEN' then 3
     when t.blocked_reason is null and t.due_date < ops_core.office_day() then 0
     when t.blocked_reason is not null then 1
     else 2
   end)::int as queue_rank
from ops_hr.tasks t
join ops_hr.employees e on e.id = t.assignee_id
left join ops_core.users u on u.id = t.assigned_by;

-- ── access ────────────────────────────────────────────────────────────────
alter table ops_hr.tasks enable row level security;

-- HRD owns the tracker. Everybody with an HR read sees it, because *what am I
-- meant to be doing* is the question it exists to answer.
create policy tasks_read on ops_hr.tasks for select to authenticated
  using (ops_core.has_permission('hrd.read'));
create policy tasks_new  on ops_hr.tasks for insert to authenticated
  with check (ops_core.has_permission('hrd.create'));
create policy tasks_edit on ops_hr.tasks for update to authenticated
  using (ops_core.has_permission('hrd.update')) with check (ops_core.has_permission('hrd.update'));
-- No delete policy and no delete grant: a cancelled task with its reason is
-- the record, and deleting it is how a delivery figure improves by forgetting
-- (A2, D261).

alter view ops_hr.v_task set (security_invoker = on);

grant select on all tables in schema ops_hr to authenticated;
grant insert, update on ops_hr.tasks to authenticated;
