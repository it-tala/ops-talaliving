-- 0210 — sasaran berperingkat: tugas yang disusun menjadi hasil (D367, D368).
--
-- ── the message this is built against ─────────────────────────────────────
--
-- Pimpinan, 2026-10-05:
--
--   *we need to set up the taskflow for all staff so we can allocate work by
--    priorities which are changing rapidly. we need the team to work in a
--    coordinated way so we can get results. otherwise we end up with a lot of
--    parts but no result. we have to put the parts together.*
--
-- `0152` answered a different failure — *pimpinan lupa, karyawan tidak
-- mengerjakan* — and answered it per task: one person, one thing, received,
-- chased, handed over. Every one of those tasks can be done on time and the
-- business can still have nothing to show, because nothing in `ops_hr.tasks`
-- knows which result a task is a part of, which part waits on which, or which
-- result matters most this week. That is the *parts but no result* sentence,
-- and it is a missing level, not a missing column.
--
-- So this migration adds the level above the task, and three things that only
-- make sense once it exists:
--
--   **sasaran** — `ops_hr.goals`: a result, what *done* looks like for it
--   (`outcome`), one person accountable for putting the parts together
--   (`owner_id`), and a target date. Tasks point at it (`tasks.goal_id`).
--
--   **urutan peringkat** — `goals.rank`, 1 = most important. The owner chose a
--   ranked order over levels (D367): with levels, five things become *P1* the
--   week priorities move, and a list where everything is first says nothing.
--   A rank cannot tie, so moving one goal up is moving another one down, which
--   is the conversation the leader actually has to have. Only open goals are
--   ranked; the order is replaced whole (`rank_goals`) so that a screen holding
--   last week's order is refused instead of quietly overwriting this week's.
--
--   **urutan kerja** — `tasks.waits_on`: this part starts from that one (the
--   drawing before the BOM, the BOM before the PR). Inside one goal only. It
--   is information for the board, not a rule on anybody's score: a person
--   whose task waits on an unfinished one still reports that as *tertahan*,
--   with a reason, the way D261 already counts it out.
--
--   **staf menggerakkan tugasnya sendiri** — until now the assignee could only
--   press *Terima*; finishing, blocking and starting all went through HRD,
--   which made HRD the operator of everybody's day and left the person holding
--   the work with no way to say *I am waiting on X*. `update_task` now takes
--   `start`, `done`, `block` and `unblock` from the assignee. Finishing one's
--   own task needs the hand-over note (there is no HRD witness to it), and is
--   stamped today — a person cannot backdate their own completion. `cancel`
--   and the new `reopen` stay with whoever gives tasks.
--
--   **rencana bisa digeser** — `edit_task` moves a task's due date, owner,
--   goal, predecessor and chase date without cancelling and re-creating it,
--   because *priorities which are changing rapidly* means exactly this
--   happening weekly. A due date can be moved later or earlier, but not into
--   the past: that would make somebody late retroactively, by somebody else's
--   hand (D261).
--
-- ── who sees what (D367) ─────────────────────────────────────────────────
--
-- Whoever holds HRD gives tasks and orders the goals — unchanged: `hrd.create`
-- to create, `hrd.update` to change. A person sees **every task in a goal they
-- are part of** — the drafter sees the IT staff's BOM update in the same goal,
-- and the other way round — and nothing outside it. That reach is given by
-- definer functions that return named, safe columns (`goal_board`,
-- `list_goals`, `task_waits`), not by widening RLS on `ops_hr.tasks`: a
-- colleague's row carries HRD's own `chase_note`, and the table is reachable
-- column-for-column through PostgREST. The base-table policies stay exactly as
-- `0152` left them.
--
-- ── what this deliberately does not do ───────────────────────────────────
--
-- It scores nothing new. Rank, waiting and the goal's progress are printed,
-- not weighed — `task_delivery` (0064/0186) counts what it counted. Production
-- workers on the floor are out of scope by the owner's word (they will have a
-- supervisor of their own); they have no accounts and nothing here needs one.

insert into ops_core.doc_prefixes (prefix, what) values ('ssr', 'goal (sasaran)');

create type ops_hr.goal_status_t as enum ('OPEN','DONE','CANCELLED');

/* ── the result ───────────────────────────────────────────────────────── */
create table ops_hr.goals (
  id            uuid primary key default gen_random_uuid(),
  goal_no       text not null unique default ops_core.next_doc_number('ssr'),
  title         text not null check (length(btrim(title)) > 0),
  /* What *done* looks like for the whole thing — `sample sofa ABC lolos QC dan
     siap kirim`, not `sofa ABC`. Required for the reason `deliverable` is
     required on a routine: a result nobody wrote down is the one argued about
     at the end. */
  outcome       text not null check (length(btrim(outcome)) > 0),
  detail        text,
  /* One person who puts the parts together. A goal with nobody accountable
     for assembling it is how a business ends up with every part and no
     result — the exact failure this table is for. */
  owner_id      uuid not null references ops_hr.employees(id),
  target_date   date not null,
  status        ops_hr.goal_status_t not null default 'OPEN',
  rank          int,
  created_by    uuid not null references ops_core.users(id),
  created_at    timestamptz not null default now(),
  closed_at     timestamptz,
  closed_by     uuid references ops_core.users(id),
  closed_note   text,

  constraint goal_rank_only_open check ((status = 'OPEN') = (rank is not null)),
  constraint goal_rank_positive check (rank is null or rank >= 1),
  constraint goal_close_is_signed check (
    (status = 'OPEN' and closed_at is null and closed_by is null)
    or (status <> 'OPEN' and closed_at is not null and closed_by is not null)),
  constraint goal_cancel_says_why check (
    status <> 'CANCELLED' or (closed_note is not null and length(btrim(closed_note)) > 0))
);

/* No two open goals share a place. Deferred to the end of the transaction,
   because re-ordering is a permutation and every permutation passes through a
   moment where two rows hold the same number. A btree exclusion on `=` is a
   unique index that can be deferred, which a partial unique index cannot. */
alter table ops_hr.goals add constraint goal_rank_unique
  exclude using btree (rank with =) where (status = 'OPEN')
  deferrable initially deferred;

create index goals_owner_idx on ops_hr.goals (owner_id);

comment on table ops_hr.goals is
  'Sasaran: a result several tasks are parts of, ranked by priority among the open ones (D367).';
comment on column ops_hr.goals.rank is
  '1 = most important. Open goals only, never tied; replaced whole by rank_goals().';

/* ── the task, placed ─────────────────────────────────────────────────── */
alter table ops_hr.tasks
  add column goal_id    uuid references ops_hr.goals(id),
  add column waits_on   uuid references ops_hr.tasks(id),
  add column started_at timestamptz;

alter table ops_hr.tasks add constraint waits_on_needs_goal check (
  waits_on is null or goal_id is not null);
alter table ops_hr.tasks add constraint waits_on_not_self check (
  waits_on is null or waits_on <> id);

create index tasks_goal_idx on ops_hr.tasks (goal_id) where goal_id is not null;
create index tasks_waits_on_idx on ops_hr.tasks (waits_on) where waits_on is not null;

/* ── who may see a goal ───────────────────────────────────────────────────
 *
 *  HRD; the person who owns the goal; anybody with a task in it, open or
 *  closed. Definer, because the third test reads `ops_hr.tasks` across
 *  assignees and a staff member's own RLS would only show them their own rows
 *  — which is the right answer for *is one of these mine* and is all this
 *  function asks.
 *
 *  It answers about `auth.uid()` and the goal named, nothing else, and it
 *  returns a boolean: there is nothing in its answer to enumerate.
 */
create or replace function ops_hr.can_see_goal(p_goal uuid)
returns boolean
language sql stable security definer set search_path = ops_hr, ops_core, pg_temp as $$
  select p_goal is not null and (
       ops_core.has_permission('hrd.read')
    or exists (select 1 from ops_hr.goals g
                where g.id = p_goal and g.owner_id = ops_hr.my_employee_id())
    or exists (select 1 from ops_hr.tasks t
                where t.goal_id = p_goal and t.assignee_id = ops_hr.my_employee_id()));
$$;

alter table ops_hr.goals enable row level security;

create policy goals_read on ops_hr.goals for select to authenticated
  using (ops_hr.can_see_goal(id));
-- Writes go through the seams below and nowhere else: no insert or update
-- policy, so a direct PostgREST write is refused by RLS rather than by a rule
-- somebody has to remember to restate.
grant select on ops_hr.goals to authenticated;

/* The task this one starts from, as anybody allowed to see the goal may read
 * it. Called per row by `v_task` through a lateral join: under the reader's
 * own RLS a staff member could not read a colleague's row, and the predecessor
 * would vanish from their task for no reason they could see. Four fields, no
 * chase note, no detail. */
create or replace function ops_hr.task_waits(p_task uuid)
returns table (task_no text, title text, assignee_name text, status ops_hr.task_status_t)
language sql stable security definer set search_path = ops_hr, ops_core, pg_temp as $$
  select t.task_no, t.title, e.full_name, t.status
    from ops_hr.tasks t
    join ops_hr.employees e on e.id = t.assignee_id
   where t.id = p_task
     and ops_hr.can_see_goal(t.goal_id);
$$;

/* ── the tracker, restated again ──────────────────────────────────────────
 *
 *  `create or replace`, with every column of `0152`'s view in the same place
 *  and the new ones at the end — which is what `0152` named its columns for.
 *  Its grant survives a replace, unlike a drop.
 */
create or replace view ops_hr.v_task as
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
  (t.status = 'OPEN' and t.blocked_reason is null
     and t.due_date < ops_core.office_day())                     as overdue,
  (t.status = 'DONE' and ops_core.office_day(t.done_at) > t.due_date) as late,
  case when t.done_at is null then null
       else (t.due_date - ops_core.office_day(t.done_at))::int end as days_early,
  (t.acknowledged_at is not null) as acknowledged,
  (t.status = 'OPEN' and t.blocked_reason is null
     and t.chase_date is not null and t.chased_at is null
     and t.chase_date <= ops_core.office_day())                  as chase_due,
  case when t.chase_date is null then null
       else (t.chase_date - ops_core.office_day())::int end      as days_to_chase,
  case when t.period_start is null then null
       when r.cadence is not null then ops_hr.task_period_label(r.cadence, t.period_start)
       else to_char(t.period_start, 'DD Mon') || ' – ' || to_char(t.period_end, 'DD Mon YYYY')
  end as period_label,
  (case
     when t.status <> 'OPEN' then 4
     when t.blocked_reason is null and t.due_date < ops_core.office_day() then 0
     when t.status = 'OPEN' and t.blocked_reason is null
          and t.chase_date is not null and t.chased_at is null
          and t.chase_date <= ops_core.office_day() then 1
     when t.blocked_reason is not null then 2
     else 3
   end)::int as queue_rank,
  -- ── 0210 ──
  t.goal_id, t.waits_on, t.started_at,
  g.goal_no,
  g.title        as goal_title,
  -- The goal's place in the order, while it has one. A closed goal has no rank
  -- (and its tasks are closed too, by `close_goal`'s own refusal).
  g.rank         as goal_rank,
  w.task_no      as waits_on_no,
  w.title        as waits_on_title,
  w.assignee_name as waits_on_assignee,
  -- This part cannot honestly start yet: the one it starts from is still open.
  -- Printed, never scored (D368).
  (t.status = 'OPEN' and coalesce(w.status = 'OPEN', false)) as waiting,
  (t.started_at is not null) as has_started
from ops_hr.tasks t
join ops_hr.employees e on e.id = t.assignee_id
left join ops_core.users u on u.id = t.assigned_by
left join ops_core.users c on c.id = t.chased_by
left join ops_hr.task_routines r on r.id = t.routine_id
left join ops_hr.goals g on g.id = t.goal_id
left join lateral ops_hr.task_waits(t.waits_on) w on true;

alter view ops_hr.v_task set (security_invoker = on);
grant select on ops_hr.v_task to authenticated;

/* ── reading goals: one road for HRD and for staff ────────────────────────
 *
 *  A function and not a view, for the reason `task_waits` is one: the progress
 *  counts are over **everybody's** tasks in the goal, and under a staff
 *  member's RLS a view would count only their own and report a goal of six
 *  parts as a goal of one. HRD and staff read the same function, so the two
 *  screens cannot disagree about how far along a result is.
 */
create or replace function ops_hr.list_goals(p_include_closed boolean default false)
returns table (
  id uuid, goal_no text, title text, outcome text, detail text,
  owner_no text, owner_name text, target_date date,
  status ops_hr.goal_status_t, rank int,
  created_at timestamptz, created_by_name text,
  closed_at timestamptz, closed_note text,
  days_left int, late boolean,
  tasks_total int, tasks_done int, tasks_open int,
  tasks_blocked int, tasks_overdue int, tasks_waiting int, tasks_unacknowledged int,
  my_open int, is_owner boolean)
language sql stable security definer set search_path = ops_hr, ops_core, pg_temp as $$
  with me as (select ops_hr.my_employee_id() as emp)
  select g.id, g.goal_no, g.title, g.outcome, g.detail,
         o.employee_no, o.full_name, g.target_date,
         g.status, g.rank,
         g.created_at, coalesce(u.full_name, g.created_by::text),
         g.closed_at, g.closed_note,
         (g.target_date - ops_core.office_day())::int,
         (g.status = 'OPEN' and g.target_date < ops_core.office_day()),
         count(t.id) filter (where t.status <> 'CANCELLED')::int,
         count(t.id) filter (where t.status = 'DONE')::int,
         count(t.id) filter (where t.status = 'OPEN')::int,
         count(t.id) filter (where t.status = 'OPEN' and t.blocked_reason is not null)::int,
         count(t.id) filter (where t.status = 'OPEN' and t.blocked_reason is null
                               and t.due_date < ops_core.office_day())::int,
         count(t.id) filter (where t.status = 'OPEN' and p.status = 'OPEN')::int,
         count(t.id) filter (where t.status = 'OPEN' and t.acknowledged_at is null)::int,
         count(t.id) filter (where t.status = 'OPEN' and t.assignee_id = (select emp from me))::int,
         coalesce(g.owner_id = (select emp from me), false)
    from ops_hr.goals g
    join ops_hr.employees o on o.id = g.owner_id
    left join ops_core.users u on u.id = g.created_by
    left join ops_hr.tasks t on t.goal_id = g.id
    left join ops_hr.tasks p on p.id = t.waits_on
   where ops_hr.can_see_goal(g.id)
     and (p_include_closed or g.status = 'OPEN')
   group by g.id, o.employee_no, o.full_name, u.full_name
   -- The ranked list first, in its order; closed results after, newest first.
   order by (g.status <> 'OPEN'), g.rank nulls last, g.closed_at desc nulls last, g.goal_no;
$$;

/* Every part of one goal, for anybody allowed to see it.
 *
 *  The columns are chosen, not inherited: title, what is to be handed over and
 *  what was, whose it is and its state. Not `chase_note` or `chased_at` — those
 *  are HRD's notes about a person, and a colleague in the same goal has no
 *  business reading them. An unknown goal and a goal the caller may not see
 *  both return nothing; telling them apart would tell a stranger which goal
 *  numbers exist.
 */
create or replace function ops_hr.goal_board(p_goal_no text)
returns table (
  task_no text, title text, detail text, deliverable text, delivered_note text,
  assignee_no text, assignee_name text,
  due_date date, days_left int, status ops_hr.task_status_t,
  started_at timestamptz, done_at timestamptz,
  blocked_reason text, acknowledged boolean, overdue boolean,
  waits_on_no text, waits_on_title text, waiting boolean,
  is_mine boolean)
language sql stable security definer set search_path = ops_hr, ops_core, pg_temp as $$
  select t.task_no, t.title, t.detail, t.deliverable, t.delivered_note,
         e.employee_no, e.full_name,
         t.due_date, (t.due_date - ops_core.office_day())::int, t.status,
         t.started_at, t.done_at,
         t.blocked_reason, (t.acknowledged_at is not null),
         (t.status = 'OPEN' and t.blocked_reason is null
            and t.due_date < ops_core.office_day()),
         p.task_no, p.title,
         (t.status = 'OPEN' and coalesce(p.status = 'OPEN', false)),
         coalesce(t.assignee_id = ops_hr.my_employee_id(), false)
    from ops_hr.goals g
    join ops_hr.tasks t on t.goal_id = g.id
    join ops_hr.employees e on e.id = t.assignee_id
    left join ops_hr.tasks p on p.id = t.waits_on
   where g.goal_no = p_goal_no
     and ops_hr.can_see_goal(g.id)
   -- Open parts before closed, then in the order the work runs: a part that
   -- waits on nothing before a part that waits, then by date.
   order by (t.status <> 'OPEN'), (t.waits_on is not null), t.due_date, t.task_no;
$$;

/* ── a goal: created, changed ─────────────────────────────────────────────
 *
 *  One seam for new and changed, the shape `save_task_routine` uses. A new goal
 *  goes to the **bottom** of the order: putting something new at the top is a
 *  decision, and it is made with `rank_goals`, where moving it up visibly moves
 *  everything else down.
 */
create or replace function ops_hr.save_goal(
  p_goal_no text, p_title text, p_outcome text, p_owner_no text,
  p_target_date date, p_detail text default null, p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare
  v_replayed jsonb; emp ops_hr.employees%rowtype; g ops_hr.goals%rowtype;
  v_no text; v_new boolean := p_goal_no is null; v_res jsonb; v_rank int;
begin
  v_replayed := ops_core.idem_replay('hr','save_goal', p_key);
  if v_replayed is not null then return v_replayed; end if;

  if not ops_core.has_permission(case when v_new then 'hrd.create' else 'hrd.update' end) then
    return ops_core.refused('hr','goal', p_goal_no, case when v_new then 'create' else 'update' end,
      'not_permitted','Menyusun sasaran butuh akses HRD.');
  end if;

  if not v_new then
    select * into g from ops_hr.goals where goal_no = p_goal_no;
    if not found then
      return ops_core.not_found('hr','goal', p_goal_no,'update',
        format('Tidak ada sasaran %s.', p_goal_no));
    end if;
    if g.status <> 'OPEN' then
      return ops_core.conflict('hr','goal', p_goal_no,'update','goal_closed',
        format('%s sudah %s — sasaran yang ditutup adalah sejarah.', g.goal_no, lower(g.status::text)));
    end if;
  end if;

  if coalesce(btrim(coalesce(p_title,'')),'') = '' then
    return ops_core.invalid('hr','goal', p_goal_no, 'save','title_required',
      'Sasarannya apa?', jsonb_build_object('field','title'));
  end if;
  if coalesce(btrim(coalesce(p_outcome,'')),'') = '' then
    return ops_core.invalid('hr','goal', p_goal_no, 'save','outcome_required',
      'Seperti apa hasilnya kalau sudah tercapai? Tanpa itu, semua bagian bisa selesai dan tetap tidak ada hasilnya.',
      jsonb_build_object('field','outcome'));
  end if;
  if p_target_date is null then
    return ops_core.invalid('hr','goal', p_goal_no, 'save','target_required',
      'Sasaran tanpa tanggal tidak bisa terlambat, dan tidak ada yang tahu kapan harus ditanyakan.',
      jsonb_build_object('field','target_date'));
  end if;

  select * into emp from ops_hr.employees where employee_no = p_owner_no;
  if not found then
    return ops_core.not_found('hr','goal', p_goal_no, 'save',
      format('Tidak ada karyawan %s.', coalesce(p_owner_no,'(kosong)')));
  end if;
  if not emp.active then
    return ops_core.conflict('hr','goal', p_goal_no, 'save','employee_left',
      format('%s sudah tidak aktif.', emp.full_name));
  end if;

  if v_new then
    select coalesce(max(rank), 0) + 1 into v_rank from ops_hr.goals where status = 'OPEN';
    insert into ops_hr.goals (title, outcome, detail, owner_id, target_date, rank, created_by)
    values (btrim(p_title), btrim(p_outcome), nullif(btrim(coalesce(p_detail,'')),''),
            emp.id, p_target_date, v_rank, auth.uid())
    returning goal_no into v_no;
    v_res := ops_core.ok('hr','goal', v_no,'create',
      jsonb_build_object('goal_no', v_no, 'rank', v_rank),
      null,
      jsonb_build_object('title', btrim(p_title), 'owner', emp.employee_no,
                         'target', p_target_date, 'rank', v_rank));
  else
    update ops_hr.goals
       set title = btrim(p_title), outcome = btrim(p_outcome),
           detail = nullif(btrim(coalesce(p_detail,'')),''),
           owner_id = emp.id, target_date = p_target_date
     where id = g.id;
    v_no := g.goal_no;
    v_res := ops_core.ok('hr','goal', v_no,'update',
      jsonb_build_object('goal_no', v_no, 'rank', g.rank),
      jsonb_build_object('title', g.title, 'outcome', g.outcome,
                         'owner', (select employee_no from ops_hr.employees where id = g.owner_id),
                         'target', g.target_date),
      jsonb_build_object('title', btrim(p_title), 'outcome', btrim(p_outcome),
                         'owner', emp.employee_no, 'target', p_target_date));
  end if;
  return ops_core.idem_remember('hr','save_goal', p_key, v_res);
end $$;

/* The order of the open goals, replaced whole.
 *
 *  The caller sends every open goal, most important first. Anything else — a
 *  goal missing, one added, a closed one, a repeat — is refused with
 *  `order_stale`, because it means the screen was built from a list somebody
 *  has since changed, and applying it would undo their move without either
 *  person knowing. Reload and move again is one tap; a silently reverted
 *  priority is a week of the wrong work.
 */
create or replace function ops_hr.rank_goals(p_goal_nos text[])
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare v_before jsonb; v_open text[]; v_sent text[];
begin
  if not ops_core.has_permission('hrd.update') then
    return ops_core.refused('hr','goal', null,'rank',
      'not_permitted','Mengurutkan sasaran butuh akses HRD.');
  end if;

  select coalesce(array_agg(goal_no order by goal_no), '{}') into v_open
    from ops_hr.goals where status = 'OPEN';
  select coalesce(array_agg(x order by x), '{}') into v_sent
    from unnest(coalesce(p_goal_nos, '{}')) x;

  if v_sent is distinct from v_open then
    return ops_core.conflict('hr','goal', null,'rank','order_stale',
      'Daftar sasaran sudah berubah sejak layar ini dibuka (ada yang ditambah, ditutup, atau diurutkan orang lain). Muat ulang, lalu urutkan lagi.',
      jsonb_build_object('open', to_jsonb(v_open), 'sent', to_jsonb(coalesce(p_goal_nos, '{}'))));
  end if;

  select coalesce(jsonb_agg(goal_no order by rank), '[]') into v_before
    from ops_hr.goals where status = 'OPEN';
  if v_before = to_jsonb(coalesce(p_goal_nos, '{}')) then
    return ops_core.noop('hr','goal', null,'rank','Urutannya sama dengan yang sudah tersimpan.');
  end if;

  update ops_hr.goals g
     set rank = x.ord::int
    from unnest(p_goal_nos) with ordinality as x(goal_no, ord)
   where g.goal_no = x.goal_no;

  return ops_core.ok('hr','goal', null,'rank',
    jsonb_build_object('order', to_jsonb(p_goal_nos)),
    jsonb_build_object('order', v_before),
    jsonb_build_object('order', to_jsonb(p_goal_nos)));
end $$;

/* Closing a goal: tercapai, or dibatalkan.
 *
 *  **Refused while any of its parts is still open**, either way. *Done* with a
 *  part outstanding is the sentence *parts but no result* turned inside out —
 *  a result declared over a missing part. *Cancelled* with parts still open
 *  would leave people working on something nobody wants any more, still owed
 *  on their task list. Each open part is finished, cancelled or moved first,
 *  by somebody, on purpose. The remaining goals close ranks behind it.
 */
create or replace function ops_hr.close_goal(
  p_goal_no text, p_action text, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare g ops_hr.goals%rowtype; v_open int;
begin
  if not ops_core.has_permission('hrd.update') then
    return ops_core.refused('hr','goal', p_goal_no, coalesce(p_action,'close'),
      'not_permitted','Menutup sasaran butuh akses HRD.');
  end if;
  if p_action is null or p_action not in ('done','cancel') then
    return ops_core.invalid('hr','goal', p_goal_no, coalesce(p_action,'close'),
      'unknown_action', format('Tidak ada tindakan %s.', coalesce(p_action,'(kosong)')),
      jsonb_build_object('field','action'));
  end if;

  select * into g from ops_hr.goals where goal_no = p_goal_no for update;
  if not found then
    return ops_core.not_found('hr','goal', p_goal_no, p_action,
      format('Tidak ada sasaran %s.', p_goal_no));
  end if;
  if g.status <> 'OPEN' then
    return ops_core.conflict('hr','goal', p_goal_no, p_action,'goal_closed',
      format('%s sudah %s.', g.goal_no, lower(g.status::text)));
  end if;
  if p_action = 'cancel' and coalesce(btrim(coalesce(p_note,'')),'') = '' then
    return ops_core.invalid('hr','goal', p_goal_no,'cancel','reason_required',
      'Kenapa dibatalkan? Alasannya adalah satu-satunya jejak yang tersisa dari sasaran ini.',
      jsonb_build_object('field','note'));
  end if;

  select count(*) into v_open from ops_hr.tasks where goal_id = g.id and status = 'OPEN';
  if v_open > 0 then
    return ops_core.conflict('hr','goal', p_goal_no, p_action,'parts_still_open',
      format('%s masih punya %s tugas terbuka. Selesaikan, batalkan, atau pindahkan dulu — '
             || 'sasaran tidak ditutup di atas bagian yang belum ada.', g.goal_no, v_open),
      jsonb_build_object('open_tasks', v_open));
  end if;

  update ops_hr.goals
     set status = case when p_action = 'done' then 'DONE' else 'CANCELLED' end::ops_hr.goal_status_t,
         rank = null, closed_at = now(), closed_by = auth.uid(),
         closed_note = nullif(btrim(coalesce(p_note,'')),'')
   where id = g.id;

  -- Close ranks: 1, 2, 4 becomes 1, 2, 3. The deferred exclusion lets the
  -- renumbering pass through its own intermediate states.
  update ops_hr.goals o
     set rank = n.new_rank
    from (select id, row_number() over (order by rank)::int as new_rank
            from ops_hr.goals where status = 'OPEN') n
   where o.id = n.id and o.rank <> n.new_rank;

  return ops_core.ok('hr','goal', g.goal_no, p_action,
    jsonb_build_object('goal_no', g.goal_no, 'action', p_action),
    jsonb_build_object('rank', g.rank),
    jsonb_build_object('note', nullif(btrim(coalesce(p_note,'')),'')));
end $$;

/* ── placing a task: goal and predecessor, checked in one place ───────────
 *
 *  Used by `assign_task` and `edit_task` alike, so the two cannot disagree
 *  about what a valid placement is. `o_refusal` is null when the placement is
 *  fine, or the refusal envelope. `p_task` is null for a task not yet created.
 *
 *  Invoker, volatile, and executable by nobody but its owner: it is a piece of
 *  the two definer seams above it and runs with their rights, and a refusal
 *  envelope writes an audit row, which a `stable` function may not do.
 */
create or replace function ops_hr.check_task_place(
  p_task uuid, p_task_no text, p_action text, p_goal_no text, p_waits_on_no text,
  out o_goal uuid, out o_waits uuid, out o_refusal jsonb)
language plpgsql set search_path = ops_hr, ops_core, pg_temp as $$
declare g ops_hr.goals%rowtype; w ops_hr.tasks%rowtype; v_cur uuid; v_hops int := 0;
begin
  if coalesce(btrim(coalesce(p_goal_no,'')),'') <> '' then
    select * into g from ops_hr.goals where goal_no = btrim(p_goal_no);
    if not found then
      o_refusal := ops_core.not_found('hr','task', p_task_no, p_action,
        format('Tidak ada sasaran %s.', p_goal_no));
      return;
    end if;
    if g.status <> 'OPEN' then
      o_refusal := ops_core.conflict('hr','task', p_task_no, p_action,'goal_closed',
        format('%s sudah %s — tugas baru tidak bisa ditaruh di sasaran yang sudah ditutup.',
               g.goal_no, lower(g.status::text)));
      return;
    end if;
    o_goal := g.id;
  end if;

  if coalesce(btrim(coalesce(p_waits_on_no,'')),'') = '' then return; end if;

  if o_goal is null then
    o_refusal := ops_core.invalid('hr','task', p_task_no, p_action,'waits_on_needs_goal',
      'Urutan kerja hanya ada di dalam satu sasaran. Pilih sasarannya dulu.',
      jsonb_build_object('field','waits_on_no'));
    return;
  end if;
  select * into w from ops_hr.tasks where task_no = btrim(p_waits_on_no);
  if not found then
    o_refusal := ops_core.not_found('hr','task', p_task_no, p_action,
      format('Tidak ada tugas %s.', p_waits_on_no));
    return;
  end if;
  if p_task is not null and w.id = p_task then
    o_refusal := ops_core.invalid('hr','task', p_task_no, p_action,'waits_on_self',
      'Tugas tidak bisa menunggu dirinya sendiri.', jsonb_build_object('field','waits_on_no'));
    return;
  end if;
  if w.goal_id is distinct from o_goal then
    o_refusal := ops_core.invalid('hr','task', p_task_no, p_action,'waits_on_other_goal',
      format('%s ada di sasaran lain. Urutan kerja hanya antar bagian dari sasaran yang sama.', w.task_no),
      jsonb_build_object('field','waits_on_no'));
    return;
  end if;
  if w.status = 'CANCELLED' then
    o_refusal := ops_core.conflict('hr','task', p_task_no, p_action,'waits_on_cancelled',
      format('%s sudah dibatalkan — tidak ada yang bisa ditunggu darinya.', w.task_no));
    return;
  end if;
  -- A circle never finishes: A waits on B waits on A. Walk up from the
  -- predecessor; reaching this task means the new link would close a loop.
  if p_task is not null then
    v_cur := w.waits_on;
    while v_cur is not null and v_hops < 200 loop
      if v_cur = p_task then
        o_refusal := ops_core.invalid('hr','task', p_task_no, p_action,'waits_on_cycle',
          format('%s sudah (lewat rantainya) menunggu tugas ini. Saling menunggu berarti tidak ada yang mulai.', w.task_no),
          jsonb_build_object('field','waits_on_no'));
        return;
      end if;
      select t.waits_on into v_cur from ops_hr.tasks t where t.id = v_cur;
      v_hops := v_hops + 1;
    end loop;
  end if;
  o_waits := w.id;
end $$;

/* ── asking somebody to do something, now as part of something ───────── */
drop function ops_hr.assign_task(text, text, date, text, text, date, date, date, ops_hr.task_ref_t, text, text);

create function ops_hr.assign_task(
  p_assignee_no text, p_title text, p_due date,
  p_detail text default null, p_deliverable text default null,
  p_period_start date default null, p_period_end date default null,
  p_chase_date date default null,
  p_ref_kind ops_hr.task_ref_t default 'none', p_ref_no text default null,
  p_key text default null,
  p_goal_no text default null, p_waits_on_no text default null)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare
  v_replayed jsonb; emp ops_hr.employees%rowtype; v_no text; v_res jsonb;
  pl record;
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

  select * into pl from ops_hr.check_task_place(null, null, 'assign', p_goal_no, p_waits_on_no);
  if pl.o_refusal is not null then return pl.o_refusal; end if;

  insert into ops_hr.tasks
    (title, detail, assignee_id, assigned_by, due_date,
     ref_kind, ref_no, deliverable, period_start, period_end, chase_date,
     goal_id, waits_on)
  values (btrim(p_title), nullif(btrim(coalesce(p_detail,'')),''), emp.id, auth.uid(), p_due,
          p_ref_kind, nullif(btrim(coalesce(p_ref_no,'')),''),
          nullif(btrim(coalesce(p_deliverable,'')),''),
          p_period_start, p_period_end, p_chase_date,
          pl.o_goal, pl.o_waits)
  returning task_no into v_no;

  v_res := ops_core.ok('hr','task', v_no,'assign',
    jsonb_build_object('task_no', v_no, 'assignee_no', emp.employee_no,
                       'due_date', p_due, 'chase_date', p_chase_date),
    null,
    jsonb_build_object('assignee', emp.employee_no, 'due', p_due,
                       'chase', p_chase_date, 'deliverable', nullif(btrim(coalesce(p_deliverable,'')),''),
                       'period', case when p_period_start is null then null
                                      else p_period_start::text || '..' || p_period_end::text end,
                       'goal', nullif(btrim(coalesce(p_goal_no,'')),''),
                       'waits_on', nullif(btrim(coalesce(p_waits_on_no,'')),'')));
  return ops_core.idem_remember('hr','assign_task', p_key, v_res);
end $$;

/* ── moving the plan without cancelling the work ──────────────────────────
 *
 *  Full state, not a patch: the caller sends what the task should be planned
 *  as — due date, person, goal, predecessor, chase date — and a null means
 *  *none*, never *unchanged*. A patch would need a second way to say *remove
 *  the goal*, and two ways to say a thing is how the wrong one gets sent.
 *
 *  What moving a task does to the evidence around it:
 *    • **a new person** has not received it — `acknowledged_at`, `started_at`
 *      and the chase are cleared, so the board says *belum dibaca* about the
 *      person who actually holds it now. The old values are in the audit row.
 *    • **a due date** may move later or earlier, but not into the past: that
 *      would make somebody late by somebody else's hand (D261). A date already
 *      in the past may stay where it is.
 *    • **leaving the goal** is refused while another part waits on this one,
 *      because the link would then cross goals.
 */
create or replace function ops_hr.edit_task(
  p_task_no text, p_due date, p_assignee_no text,
  p_goal_no text default null, p_waits_on_no text default null,
  p_chase_date date default null)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare
  t ops_hr.tasks%rowtype; emp ops_hr.employees%rowtype; pl record;
  v_dependents text; v_moved_person boolean; v_before jsonb; v_after jsonb;
begin
  if not ops_core.has_permission('hrd.update') then
    return ops_core.refused('hr','task', p_task_no,'edit',
      'not_permitted','Mengatur ulang tugas butuh akses HRD.');
  end if;
  select * into t from ops_hr.tasks where task_no = p_task_no for update;
  if not found then
    return ops_core.not_found('hr','task', p_task_no,'edit',
      format('Tidak ada tugas %s.', p_task_no));
  end if;
  if t.status <> 'OPEN' then
    return ops_core.conflict('hr','task', p_task_no,'edit','task_closed',
      format('%s sudah %s — rencananya tidak bisa digeser lagi.', t.task_no, lower(t.status::text)));
  end if;

  if p_due is null then
    return ops_core.invalid('hr','task', p_task_no,'edit','due_date_required',
      'Tugas tanpa tanggal tidak bisa terlambat.', jsonb_build_object('field','due_date'));
  end if;
  if p_due <> t.due_date and p_due < ops_core.office_day() then
    return ops_core.invalid('hr','task', p_task_no,'edit','due_in_past',
      format('Jatuh tempo tidak bisa dipindah ke tanggal yang sudah lewat (%s) — itu membuat orangnya terlambat oleh tangan orang lain.', p_due),
      jsonb_build_object('field','due_date'));
  end if;
  if t.period_end is not null and p_due < t.period_end then
    return ops_core.invalid('hr','task', p_task_no,'edit','due_inside_period',
      format('Jatuh tempo %s jatuh sebelum periodenya selesai (%s).', p_due, t.period_end),
      jsonb_build_object('field','due_date'));
  end if;
  if p_chase_date is not null and p_chase_date > p_due then
    return ops_core.invalid('hr','task', p_task_no,'edit','chase_after_due',
      'Tanggal penagihan lewat dari jatuh tempo.', jsonb_build_object('field','chase_date'));
  end if;

  select * into emp from ops_hr.employees where employee_no = p_assignee_no;
  if not found then
    return ops_core.not_found('hr','task', p_task_no,'edit',
      format('Tidak ada karyawan %s.', coalesce(p_assignee_no,'(kosong)')));
  end if;
  if not emp.active and emp.id <> t.assignee_id then
    return ops_core.conflict('hr','task', p_task_no,'edit','employee_left',
      format('%s sudah tidak aktif.', emp.full_name));
  end if;

  select * into pl from ops_hr.check_task_place(t.id, t.task_no, 'edit', p_goal_no, p_waits_on_no);
  if pl.o_refusal is not null then return pl.o_refusal; end if;

  if pl.o_goal is distinct from t.goal_id then
    select string_agg(d.task_no, ', ' order by d.task_no) into v_dependents
      from ops_hr.tasks d where d.waits_on = t.id and d.status = 'OPEN';
    if v_dependents is not null then
      return ops_core.conflict('hr','task', p_task_no,'edit','has_dependents',
        format('%s masih ditunggu oleh %s. Lepaskan urutan kerja itu dulu sebelum memindahkan tugas ini ke sasaran lain.',
               t.task_no, v_dependents),
        jsonb_build_object('waiting', v_dependents));
    end if;
  end if;

  v_moved_person := emp.id <> t.assignee_id;
  v_before := jsonb_build_object(
    'due', t.due_date,
    'assignee', (select employee_no from ops_hr.employees where id = t.assignee_id),
    'goal', (select goal_no from ops_hr.goals where id = t.goal_id),
    'waits_on', (select task_no from ops_hr.tasks where id = t.waits_on),
    'chase', t.chase_date,
    'acknowledged_at', t.acknowledged_at, 'started_at', t.started_at);
  v_after := jsonb_build_object(
    'due', p_due, 'assignee', emp.employee_no,
    'goal', (select goal_no from ops_hr.goals where id = pl.o_goal),
    'waits_on', (select task_no from ops_hr.tasks where id = pl.o_waits),
    'chase', p_chase_date);

  if v_before - 'acknowledged_at' - 'started_at' = v_after then
    return ops_core.noop('hr','task', p_task_no,'edit','Tidak ada yang berubah.');
  end if;

  update ops_hr.tasks
     set due_date = p_due, assignee_id = emp.id,
         goal_id = pl.o_goal, waits_on = pl.o_waits,
         chase_date = p_chase_date,
         -- A chase recorded against the old date or the old person was about
         -- a different plan — the new one is asked for afresh.
         chased_at = case when v_moved_person or p_chase_date is distinct from t.chase_date
                          then null else chased_at end,
         chased_by = case when v_moved_person or p_chase_date is distinct from t.chase_date
                          then null else chased_by end,
         chase_note = case when v_moved_person or p_chase_date is distinct from t.chase_date
                           then null else chase_note end,
         acknowledged_at = case when v_moved_person then null else acknowledged_at end,
         started_at = case when v_moved_person then null else started_at end
   where id = t.id;

  return ops_core.ok('hr','task', t.task_no,'edit',
    jsonb_build_object('task_no', t.task_no, 'reassigned', v_moved_person),
    v_before, v_after);
end $$;

/* ── the person holding the work moves it ─────────────────────────────────
 *
 *  `0190`'s body, with two doors instead of one. HRD may do everything it
 *  could. The assignee — by the account link and nothing else — may `start`,
 *  `done`, `block` and `unblock` their own task, and that is the second half
 *  of D261: a rule that blocked work is not held against anybody only works if
 *  the person who is blocked can say so.
 *
 *  Two differences for the assignee, both because there is nobody else in the
 *  room: finishing needs the hand-over note (`delivered_required` — for HRD it
 *  stays optional, A6), and is stamped today (`done_on_self` refuses a back
 *  date). `cancel` and `reopen` stay with whoever gives tasks: dropping work
 *  and saying *this was not actually finished* are the giver's decisions.
 */
create or replace function ops_hr.update_task(
  p_task_no text, p_action text, p_reason text default null,
  p_delivered text default null, p_done_on date default null)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare t ops_hr.tasks%rowtype; v_found boolean; v_hrd boolean; v_mine boolean;
begin
  if p_action is null or p_action not in ('start','done','block','unblock','cancel','reopen') then
    return ops_core.invalid('hr','task', p_task_no, coalesce(p_action,'update'),
      'unknown_action', format('Tidak ada tindakan %s.', coalesce(p_action,'(kosong)')),
      jsonb_build_object('field','action'));
  end if;

  select * into t from ops_hr.tasks where task_no = p_task_no;
  v_found := found;
  v_hrd := ops_core.has_permission('hrd.update');
  v_mine := v_found and coalesce(t.assignee_id = ops_hr.my_employee_id(), false);

  if not v_hrd and not v_mine then
    return ops_core.refused('hr','task', p_task_no, p_action,
      'not_permitted','Mengubah tugas ini butuh akses HRD, atau tugas ini harus milik Anda sendiri.');
  end if;
  if not v_found then
    return ops_core.not_found('hr','task', p_task_no, p_action,
      format('Tidak ada tugas %s.', p_task_no));
  end if;
  if not v_hrd and p_action in ('cancel','reopen') then
    return ops_core.refused('hr','task', p_task_no, p_action,'not_permitted',
      case when p_action = 'cancel'
        then 'Membatalkan tugas adalah keputusan pemberi tugas (HRD). Kalau tugas ini tidak bisa dikerjakan, tandai tertahan dan tulis alasannya.'
        else 'Membuka lagi tugas yang sudah selesai adalah keputusan pemberi tugas (HRD).' end);
  end if;

  if p_action = 'reopen' then
    if t.status <> 'DONE' then
      return ops_core.conflict('hr','task', p_task_no,'reopen','task_not_done',
        format('%s tidak sedang selesai — tidak ada yang dibuka lagi.', t.task_no));
    end if;
    if coalesce(btrim(coalesce(p_reason,'')),'') = '' then
      return ops_core.invalid('hr','task', p_task_no,'reopen','reason_required',
        'Kenapa dibuka lagi? Yang diserahkan kurang apa? Kalimat ini yang dibaca orangnya.',
        jsonb_build_object('field','reason'));
    end if;
    if exists (select 1 from ops_hr.goals g where g.id = t.goal_id and g.status <> 'OPEN') then
      return ops_core.conflict('hr','task', p_task_no,'reopen','goal_closed',
        'Sasarannya sudah ditutup — bagiannya tidak bisa dibuka lagi.');
    end if;
    update ops_hr.tasks
       set status = 'OPEN', done_at = null, done_by = null
     where id = t.id;
    return ops_core.ok('hr','task', t.task_no,'reopen',
      jsonb_build_object('task_no', t.task_no, 'action', 'reopen'),
      jsonb_build_object('done_at', t.done_at, 'delivered', t.delivered_note),
      jsonb_build_object('reason', btrim(p_reason)));
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
  if p_action = 'start' and t.started_at is not null then
    return ops_core.noop('hr','task', p_task_no,'start',
      format('%s sudah ditandai mulai dikerjakan.', t.task_no));
  end if;
  if p_action = 'done' and not v_hrd then
    if coalesce(btrim(coalesce(p_delivered,'')),'') = '' then
      return ops_core.invalid('hr','task', p_task_no,'done','delivered_required',
        coalesce('Apa yang diserahkan, dan ke mana? Yang diminta: ' || t.deliverable || '.',
                 'Apa yang diserahkan, dan ke mana?')
        || ' Tanpa catatan ini tidak ada yang bisa memeriksa bahwa tugasnya memang selesai.',
        jsonb_build_object('field','delivered'));
    end if;
    if p_done_on is not null and p_done_on <> ops_core.office_day() then
      return ops_core.invalid('hr','task', p_task_no,'done','done_on_self',
        'Tugas sendiri ditandai selesai hari ini. Tanggal selesai yang lain dicatat oleh HRD.',
        jsonb_build_object('field','done_on'));
    end if;
  end if;

  if p_action = 'done' then
    update ops_hr.tasks
       set status = 'DONE',
           -- The day it was finished, not the day it was typed (D148).
           done_at = case when p_done_on is null then now()
                          else (p_done_on + time '12:00') at time zone ops_core.office_tz() end,
           done_by = auth.uid(),
           started_at = coalesce(started_at, now()),
           delivered_note = coalesce(nullif(btrim(coalesce(p_delivered,'')),''), delivered_note),
           blocked_reason = null, blocked_at = null
     where id = t.id;
  elsif p_action = 'start' then
    update ops_hr.tasks set started_at = now() where id = t.id;
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
                       'deliverable_asked', t.deliverable,
                       'by', case when v_mine and not v_hrd then 'assignee' else 'hrd' end));
end $$;

/* ── grants, named one at a time (F147) ───────────────────────────────── */
revoke execute on function ops_hr.can_see_goal(uuid) from public;
revoke execute on function ops_hr.task_waits(uuid) from public;
revoke execute on function ops_hr.list_goals(boolean) from public;
revoke execute on function ops_hr.goal_board(text) from public;
revoke execute on function ops_hr.save_goal(text, text, text, text, date, text, text) from public;
revoke execute on function ops_hr.rank_goals(text[]) from public;
revoke execute on function ops_hr.close_goal(text, text, text) from public;
revoke execute on function ops_hr.check_task_place(uuid, text, text, text, text) from public;
revoke execute on function ops_hr.assign_task(text, text, date, text, text, date, date, date, ops_hr.task_ref_t, text, text, text, text) from public;
revoke execute on function ops_hr.edit_task(text, date, text, text, text, date) from public;
revoke execute on function ops_hr.update_task(text, text, text, text, date) from public;

grant execute on function ops_hr.can_see_goal(uuid) to authenticated;
grant execute on function ops_hr.task_waits(uuid) to authenticated;
grant execute on function ops_hr.list_goals(boolean) to authenticated;
grant execute on function ops_hr.goal_board(text) to authenticated;
grant execute on function ops_hr.save_goal(text, text, text, text, date, text, text) to authenticated;
grant execute on function ops_hr.rank_goals(text[]) to authenticated;
grant execute on function ops_hr.close_goal(text, text, text) to authenticated;
grant execute on function ops_hr.assign_task(text, text, date, text, text, date, date, date, ops_hr.task_ref_t, text, text, text, text) to authenticated;
grant execute on function ops_hr.edit_task(text, date, text, text, text, date) to authenticated;
grant execute on function ops_hr.update_task(text, text, text, text, date) to authenticated;

analyze ops_hr.goals;
analyze ops_hr.tasks;
