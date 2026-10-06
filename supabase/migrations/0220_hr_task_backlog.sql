-- 0220_hr_task_backlog.sql — daftar tunggu: work that is known, not urgent,
-- and has nobody yet (D381).
--
-- The owner, 2026-10-06: *"bagaimana ini bisa memberi tahu daftar apa yang
-- harus dikerjakan, namun tidak urgent sehingga cukup di kumpulkan sebagai
-- daftar tugas nantinya akan di assign ketika ada resource nya"* — and, the
-- same day, *"tidak bisa assign sebagai team"*.
--
-- A task needs one person and a due date (0052), and that is right: a task
-- with neither is one nobody can be late on. So the list of work-not-yet-given
-- is its own table, not a task with the two columns made optional — every
-- KPI, every board and every late flag reads `tasks` and none of them should
-- learn to skip half-tasks.
--
-- An item becomes a task in one step (*Tugaskan*): HRD picks **one person**
-- and a due date, `assign_task` writes the task, and the 0215 trigger tells
-- that person. Until then nobody is late on it and it is in nobody's score.
--
-- `unit` (bidang — IT, Drafting, Procurement) is a label to filter by when
-- somebody in that field comes free. It is never an assignee: the owner's
-- rule is one task, one person.
--
-- Staff may **propose** items (the owner chose it over HRD-only): a proposal
-- waits, marked, until HRD accepts it into the ordered list or drops it with
-- a reason. Work somebody noticed is not lost because they were not HRD.

insert into ops_core.doc_prefixes (prefix, what) values ('blg', 'backlog item (daftar tunggu)');

create table ops_hr.backlog (
  id            uuid primary key default gen_random_uuid(),
  item_no       text not null unique default ops_core.next_doc_number('blg'),
  title         text not null check (length(btrim(title)) > 0),
  detail        text,
  deliverable   text,
  unit          text,
  goal_id       uuid references ops_hr.goals(id),
  status        text not null default 'OPEN'
                check (status in ('PROPOSED','OPEN','ASSIGNED','DROPPED')),
  -- Place among the OPEN items. Only an open item has one: a proposal has not
  -- been placed by anybody, and a given or dropped item has left the list.
  sort_key      int,
  proposed      boolean not null default false,
  created_by    uuid not null references ops_core.users(id),
  created_at    timestamptz not null default now(),
  accepted_by   uuid references ops_core.users(id),
  accepted_at   timestamptz,
  task_id       uuid unique references ops_hr.tasks(id),
  assigned_by   uuid references ops_core.users(id),
  assigned_at   timestamptz,
  dropped_reason text,
  dropped_by    uuid references ops_core.users(id),
  dropped_at    timestamptz,

  constraint backlog_open_has_place check ((status = 'OPEN') = (sort_key is not null)),
  constraint backlog_assigned_has_task check ((status = 'ASSIGNED') = (task_id is not null)),
  constraint backlog_dropped_says_why check (
    status <> 'DROPPED' or (dropped_reason is not null and length(btrim(dropped_reason)) > 0))
);

create index backlog_open_idx on ops_hr.backlog (sort_key) where status = 'OPEN';
create index backlog_goal_idx on ops_hr.backlog (goal_id) where goal_id is not null;

-- Read and written only through the seams below.
alter table ops_hr.backlog enable row level security;

comment on table ops_hr.backlog is
  'Daftar tunggu: known work with no person and no due date yet. Becomes a task through assign_backlog_item (D381).';

/* ── who hears about a proposal, and its author about the answer ──────── */
create or replace function ops_hr.backlog_notify(
  p_kind text, p_title text, p_data jsonb, p_item_no text, p_to uuid default null)
returns void
-- Invoker: it runs with the rights of the seam that calls it (the owner).
-- Called directly by a signed-in person it has no insert on notifications,
-- so nobody can ring somebody else's bell with it.
language sql security invoker set search_path = ops_hr, ops_core, pg_temp as $$
  insert into ops_core.notifications (user_id, kind, title, data, link, entity_no)
  select u.id, p_kind, p_title, p_data,
         case when p_to is null then '/hrd/tugas?tab=backlog' else '/profil?tab=tugas' end,
         p_item_no
    from ops_core.users u
   where u.is_active
     and u.id is distinct from auth.uid()
     and ((p_to is null and exists (select 1 from ops_core.user_modules m
                                     where m.user_id = u.id and m.module = 'hrd'
                                       and m.level in ('write','admin')))
          or u.id = p_to);
$$;

/* ── the list ─────────────────────────────────────────────────────────────
 *
 *  HRD reads everything. Anybody with an employee link reads the open list —
 *  *what is waiting to be done* is worth knowing before you are handed it —
 *  and their own proposals. Nobody else reads anything.
 */
create or replace function ops_hr.list_backlog(p_include_closed boolean default false)
returns table (
  id uuid, item_no text, title text, detail text, deliverable text, unit text,
  goal_no text, goal_title text, goal_rank int, goal_open boolean,
  status text, "position" int, proposed boolean,
  created_by_name text, created_at timestamptz, accepted_at timestamptz,
  task_no text, assignee_name text, assigned_at timestamptz,
  dropped_reason text, dropped_at timestamptz,
  is_mine boolean)
language plpgsql stable security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare v_hrd boolean := ops_core.has_permission('hrd.read');
begin
  if not v_hrd and ops_hr.my_employee_id() is null then
    raise exception using errcode = '42501',
      message = 'Daftar tunggu dibaca oleh HRD dan staf yang punya data karyawan.';
  end if;
  return query
    select b.id, b.item_no, b.title, b.detail, b.deliverable, b.unit,
           g.goal_no, g.title, g.rank, (g.status = 'OPEN'),
           b.status, b.sort_key, b.proposed,
           coalesce(u.full_name, b.created_by::text), b.created_at, b.accepted_at,
           t.task_no, e.full_name, b.assigned_at,
           b.dropped_reason, b.dropped_at,
           (b.created_by = auth.uid())
      from ops_hr.backlog b
      left join ops_hr.goals g on g.id = b.goal_id
      left join ops_core.users u on u.id = b.created_by
      left join ops_hr.tasks t on t.id = b.task_id
      left join ops_hr.employees e on e.id = t.assignee_id
     where (p_include_closed or b.status in ('PROPOSED','OPEN'))
       and (v_hrd or b.status = 'OPEN' or b.created_by = auth.uid())
     -- Proposals first (they want an answer), then the list in its order,
     -- then what has left it, newest first.
     order by case b.status when 'PROPOSED' then 0 when 'OPEN' then 1 else 2 end,
              b.sort_key nulls last,
              coalesce(b.assigned_at, b.dropped_at, b.created_at) desc,
              b.item_no;
end $$;

/* ── an item: new or changed ──────────────────────────────────────────────
 *
 *  HRD's new item joins the **bottom** of the list, for the reason a new goal
 *  does (0210): putting it higher is a decision made with `rank_backlog`.
 *  Anybody else's new item is a proposal, and HRD is told.
 */
create or replace function ops_hr.save_backlog_item(
  p_item_no text, p_title text, p_deliverable text default null,
  p_detail text default null, p_unit text default null, p_goal_no text default null)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare
  b ops_hr.backlog%rowtype; g ops_hr.goals%rowtype;
  v_new boolean := p_item_no is null;
  v_hrd boolean; v_no text; v_status text; v_place int; v_by text;
begin
  v_hrd := ops_core.has_permission(case when v_new then 'hrd.create' else 'hrd.update' end);

  if not v_new then
    select * into b from ops_hr.backlog where item_no = p_item_no for update;
    if not found then
      return ops_core.not_found('hr','backlog', p_item_no,'update',
        format('Tidak ada item %s di daftar tunggu.', p_item_no));
    end if;
    if b.status not in ('PROPOSED','OPEN') then
      return ops_core.conflict('hr','backlog', p_item_no,'update','backlog_closed',
        format('%s sudah %s.', b.item_no,
               case b.status when 'ASSIGNED' then 'dijadikan tugas' else 'dikeluarkan dari daftar' end));
    end if;
    if not v_hrd and not (b.status = 'PROPOSED' and b.created_by = auth.uid()) then
      return ops_core.refused('hr','backlog', p_item_no,'update','not_permitted',
        'Item daftar tunggu diubah oleh HRD; usulan Anda sendiri bisa diubah selama belum diterima.');
    end if;
  elsif not v_hrd and ops_hr.my_employee_id() is null then
    return ops_core.refused('hr','backlog', null,'create','not_permitted',
      'Mengusulkan pekerjaan butuh akun yang tertaut ke data karyawan.');
  end if;

  if coalesce(btrim(coalesce(p_title,'')),'') = '' then
    return ops_core.invalid('hr','backlog', p_item_no,'save','title_required',
      'Pekerjaannya apa?', jsonb_build_object('field','title'));
  end if;

  if nullif(btrim(coalesce(p_goal_no,'')),'') is not null then
    select * into g from ops_hr.goals where goal_no = btrim(p_goal_no);
    if not found or not ops_hr.can_see_goal(g.id) then
      return ops_core.invalid('hr','backlog', p_item_no,'save','unknown_goal',
        format('Tidak ada sasaran %s.', btrim(p_goal_no)), jsonb_build_object('field','goal_no'));
    end if;
    if g.status <> 'OPEN' then
      return ops_core.conflict('hr','backlog', p_item_no,'save','goal_closed',
        format('%s sudah ditutup — pekerjaan baru tidak masuk ke sasaran yang sudah selesai.', g.goal_no));
    end if;
  end if;

  if v_new then
    v_status := case when v_hrd then 'OPEN' else 'PROPOSED' end;
    if v_hrd then
      select coalesce(max(sort_key), 0) + 1 into v_place from ops_hr.backlog where status = 'OPEN';
    end if;
    insert into ops_hr.backlog (title, detail, deliverable, unit, goal_id, status, sort_key,
                                proposed, created_by, accepted_by, accepted_at)
    values (btrim(p_title), nullif(btrim(coalesce(p_detail,'')),''),
            nullif(btrim(coalesce(p_deliverable,'')),''), nullif(btrim(coalesce(p_unit,'')),''),
            g.id, v_status, v_place, not v_hrd, auth.uid(),
            case when v_hrd then auth.uid() end, case when v_hrd then now() end)
    returning item_no into v_no;

    if not v_hrd then
      v_by := coalesce((select full_name from ops_core.users where id = auth.uid()), 'Staf');
      perform ops_hr.backlog_notify('backlog.proposed',
        format('%s mengusulkan pekerjaan: %s', v_by, btrim(p_title)),
        jsonb_build_object('item_no', v_no, 'title', btrim(p_title), 'by', v_by,
                           'unit', nullif(btrim(coalesce(p_unit,'')),''), 'goal_title', g.title),
        v_no);
    end if;

    return ops_core.ok('hr','backlog', v_no,'create',
      jsonb_build_object('item_no', v_no, 'status', v_status, 'position', v_place),
      null,
      jsonb_build_object('title', btrim(p_title), 'unit', nullif(btrim(coalesce(p_unit,'')),''),
                         'goal', g.goal_no, 'status', v_status));
  end if;

  update ops_hr.backlog
     set title = btrim(p_title),
         detail = nullif(btrim(coalesce(p_detail,'')),''),
         deliverable = nullif(btrim(coalesce(p_deliverable,'')),''),
         unit = nullif(btrim(coalesce(p_unit,'')),''),
         goal_id = g.id
   where id = b.id;

  return ops_core.ok('hr','backlog', b.item_no,'update',
    jsonb_build_object('item_no', b.item_no, 'status', b.status, 'position', b.sort_key),
    jsonb_build_object('title', b.title, 'deliverable', b.deliverable, 'unit', b.unit,
                       'goal', (select goal_no from ops_hr.goals where id = b.goal_id)),
    jsonb_build_object('title', btrim(p_title), 'deliverable', nullif(btrim(coalesce(p_deliverable,'')),''),
                       'unit', nullif(btrim(coalesce(p_unit,'')),''), 'goal', g.goal_no));
end $$;

/* A proposal accepted: it joins the bottom of the list, and its author hears. */
create or replace function ops_hr.accept_backlog_item(p_item_no text)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare b ops_hr.backlog%rowtype; v_place int;
begin
  if not ops_core.has_permission('hrd.update') then
    return ops_core.refused('hr','backlog', p_item_no,'accept','not_permitted',
      'Menerima usulan butuh akses HRD.');
  end if;
  select * into b from ops_hr.backlog where item_no = p_item_no for update;
  if not found then
    return ops_core.not_found('hr','backlog', p_item_no,'accept',
      format('Tidak ada item %s di daftar tunggu.', p_item_no));
  end if;
  if b.status <> 'PROPOSED' then
    return ops_core.conflict('hr','backlog', p_item_no,'accept','not_a_proposal',
      format('%s bukan usulan yang menunggu jawaban.', b.item_no));
  end if;

  select coalesce(max(sort_key), 0) + 1 into v_place from ops_hr.backlog where status = 'OPEN';
  update ops_hr.backlog
     set status = 'OPEN', sort_key = v_place, accepted_by = auth.uid(), accepted_at = now()
   where id = b.id;

  perform ops_hr.backlog_notify('backlog.accepted',
    format('Usulan Anda masuk daftar tunggu: %s', b.title),
    jsonb_build_object('item_no', b.item_no, 'title', b.title, 'position', v_place),
    b.item_no, b.created_by);

  return ops_core.ok('hr','backlog', b.item_no,'accept',
    jsonb_build_object('item_no', b.item_no, 'position', v_place),
    jsonb_build_object('status','PROPOSED'), jsonb_build_object('status','OPEN','position', v_place));
end $$;

/* Out of the list, with a reason. HRD for any waiting item; the author may
 *  withdraw their own proposal. A dropped proposal tells its author why. */
create or replace function ops_hr.drop_backlog_item(p_item_no text, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare b ops_hr.backlog%rowtype; v_hrd boolean := ops_core.has_permission('hrd.update');
        v_reason text := nullif(btrim(coalesce(p_reason,'')),'');
        v_own boolean;
begin
  select * into b from ops_hr.backlog where item_no = p_item_no for update;
  if not found then
    return ops_core.not_found('hr','backlog', p_item_no,'drop',
      format('Tidak ada item %s di daftar tunggu.', p_item_no));
  end if;
  v_own := b.status = 'PROPOSED' and b.created_by = auth.uid();
  if not v_hrd and not v_own then
    return ops_core.refused('hr','backlog', p_item_no,'drop','not_permitted',
      'Mengeluarkan item dari daftar tunggu butuh akses HRD; usulan Anda sendiri bisa ditarik.');
  end if;
  if b.status not in ('PROPOSED','OPEN') then
    return ops_core.conflict('hr','backlog', p_item_no,'drop','backlog_closed',
      format('%s sudah tidak di daftar tunggu.', b.item_no));
  end if;
  if v_reason is null then
    if v_own then
      v_reason := 'Ditarik oleh pengusul.';
    else
      return ops_core.invalid('hr','backlog', p_item_no,'drop','reason_required',
        'Kenapa dikeluarkan? Alasannya dibaca oleh yang mengusulkan, dan oleh siapa pun yang bertanya nanti.',
        jsonb_build_object('field','reason'));
    end if;
  end if;

  update ops_hr.backlog
     set status = 'DROPPED', sort_key = null,
         dropped_reason = v_reason, dropped_by = auth.uid(), dropped_at = now()
   where id = b.id;

  if b.proposed and b.created_by is distinct from auth.uid() then
    perform ops_hr.backlog_notify('backlog.dropped',
      format('Usulan Anda tidak masuk daftar tunggu: %s', b.title),
      jsonb_build_object('item_no', b.item_no, 'title', b.title, 'reason', v_reason),
      b.item_no, b.created_by);
  end if;

  return ops_core.ok('hr','backlog', b.item_no,'drop',
    jsonb_build_object('item_no', b.item_no),
    jsonb_build_object('status', b.status), jsonb_build_object('status','DROPPED','reason', v_reason));
end $$;

/* The order of the open list, replaced whole — `rank_goals`'s rule (0210):
 *  anything but exactly the open items is `order_stale`. */
create or replace function ops_hr.rank_backlog(p_item_nos text[])
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare v_before jsonb; v_open text[]; v_sent text[];
begin
  if not ops_core.has_permission('hrd.update') then
    return ops_core.refused('hr','backlog', null,'rank','not_permitted',
      'Mengurutkan daftar tunggu butuh akses HRD.');
  end if;

  select coalesce(array_agg(item_no order by item_no), '{}') into v_open
    from ops_hr.backlog where status = 'OPEN';
  select coalesce(array_agg(x order by x), '{}') into v_sent
    from unnest(coalesce(p_item_nos, '{}')) x;
  if v_sent is distinct from v_open then
    return ops_core.conflict('hr','backlog', null,'rank','order_stale',
      'Daftar tunggu sudah berubah sejak layar ini dibuka. Muat ulang, lalu urutkan lagi.',
      jsonb_build_object('open', to_jsonb(v_open), 'sent', to_jsonb(coalesce(p_item_nos, '{}'))));
  end if;

  select coalesce(jsonb_agg(item_no order by sort_key), '[]') into v_before
    from ops_hr.backlog where status = 'OPEN';
  if v_before = to_jsonb(coalesce(p_item_nos, '{}')) then
    return ops_core.noop('hr','backlog', null,'rank','Urutannya sama dengan yang sudah tersimpan.');
  end if;

  update ops_hr.backlog b
     set sort_key = x.ord::int
    from unnest(p_item_nos) with ordinality as x(item_no, ord)
   where b.item_no = x.item_no;

  return ops_core.ok('hr','backlog', null,'rank',
    jsonb_build_object('order', to_jsonb(p_item_nos)),
    jsonb_build_object('order', v_before), jsonb_build_object('order', to_jsonb(p_item_nos)));
end $$;

/* *Tugaskan*: one person, a due date — and it is a task.
 *
 *  Written through `assign_task`, so every rule of a task holds (a goal still
 *  open, a person still working here, a chase date before the due date) and
 *  the 0215 trigger tells the person. The item keeps pointing at the task. */
create or replace function ops_hr.assign_backlog_item(
  p_item_no text, p_assignee_no text, p_due date, p_chase_date date default null)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare b ops_hr.backlog%rowtype; v_res jsonb; v_no text; v_detail text;
begin
  if not ops_core.has_permission('hrd.create') then
    return ops_core.refused('hr','backlog', p_item_no,'assign','not_permitted',
      'Memberi tugas butuh akses HRD.');
  end if;
  select * into b from ops_hr.backlog where item_no = p_item_no for update;
  if not found then
    return ops_core.not_found('hr','backlog', p_item_no,'assign',
      format('Tidak ada item %s di daftar tunggu.', p_item_no));
  end if;
  if b.status <> 'OPEN' then
    return ops_core.conflict('hr','backlog', p_item_no,'assign','not_open',
      case b.status when 'PROPOSED' then format('%s masih usulan — terima dulu ke daftar tunggu.', b.item_no)
                    when 'ASSIGNED' then format('%s sudah dijadikan tugas.', b.item_no)
                    else format('%s sudah dikeluarkan dari daftar.', b.item_no) end);
  end if;
  if p_due is null then
    return ops_core.invalid('hr','backlog', p_item_no,'assign','due_required',
      'Tugas butuh jatuh tempo — itulah bedanya dengan daftar tunggu.', jsonb_build_object('field','due_date'));
  end if;

  v_detail := concat_ws(E'\n\n', b.detail, format('Dari daftar tunggu %s.', b.item_no));
  v_res := ops_hr.assign_task(
    p_assignee_no, b.title, p_due,
    p_detail => v_detail, p_deliverable => b.deliverable,
    p_chase_date => p_chase_date,
    p_goal_no => (select goal_no from ops_hr.goals where id = b.goal_id));
  if v_res ->> 'outcome' <> 'ok' then return v_res; end if;
  v_no := v_res -> 'data' ->> 'task_no';

  update ops_hr.backlog
     set status = 'ASSIGNED', sort_key = null,
         task_id = (select id from ops_hr.tasks where task_no = v_no),
         assigned_by = auth.uid(), assigned_at = now()
   where id = b.id;

  return ops_core.ok('hr','backlog', b.item_no,'assign',
    jsonb_build_object('item_no', b.item_no, 'task_no', v_no,
                       'assignee_name', (select full_name from ops_hr.employees where employee_no = p_assignee_no)),
    jsonb_build_object('status','OPEN'),
    jsonb_build_object('status','ASSIGNED','task_no', v_no, 'assignee', p_assignee_no, 'due', p_due));
end $$;

revoke execute on function ops_hr.backlog_notify(text, text, jsonb, text, uuid) from public;
revoke execute on function ops_hr.list_backlog(boolean) from public;
revoke execute on function ops_hr.save_backlog_item(text, text, text, text, text, text) from public;
revoke execute on function ops_hr.accept_backlog_item(text) from public;
revoke execute on function ops_hr.drop_backlog_item(text, text) from public;
revoke execute on function ops_hr.rank_backlog(text[]) from public;
revoke execute on function ops_hr.assign_backlog_item(text, text, date, date) from public;

grant execute on function ops_hr.list_backlog(boolean) to authenticated;
grant execute on function ops_hr.save_backlog_item(text, text, text, text, text, text) to authenticated;
grant execute on function ops_hr.accept_backlog_item(text) to authenticated;
grant execute on function ops_hr.drop_backlog_item(text, text) to authenticated;
grant execute on function ops_hr.rank_backlog(text[]) to authenticated;
grant execute on function ops_hr.assign_backlog_item(text, text, date, date) to authenticated;

analyze ops_hr.backlog;
