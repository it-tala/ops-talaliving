-- 0250_procure_design_tasks.sql — a drafter's room (or item) given out from
-- Design as an HRD task that closes itself when every box is filled (Studio
-- Desain S2, D402, D403, kajian F247).
--
-- ── What the owner decided ────────────────────────────────────────────────
--
--   D402  HRD only monitors. The task is made and given from Design — one room
--         to one drafter with one due date (an item, when a room is shared) —
--         and it is an ordinary `ops_hr.tasks` row, so the bell and Chat
--         (D374), the daily plan (D384), the daily log (D371), *tertahan*
--         (D367), the Roadmap (D382) and the KPI all apply.
--   D403  It is finished when every box in it is filled (or not needed). The
--         day it finished is the day the last box was filled, so on-time is
--         read without anybody pressing *done*. A new version afterwards only
--         adds history; the task is not reopened.
--
-- ── What this adds ────────────────────────────────────────────────────────
--
--   design_scope_boxes(kind, ref)   filled / total for a room or an item
--   assign_design_task(…)           give a room or an item to a drafter, or
--                                   move the open task to another person or
--                                   date; refused for a scope already complete
--   settle_design_tasks(item_no)    close every open task the item belongs to
--                                   once its scope is complete
--   five triggers that settle       a file on the item, a spec, *not needed*,
--                                   a BOM revision on its product, an item
--                                   dropped from the room
--   a guard on ops_hr.tasks         nobody marks a design task done by hand:
--                                   the boxes are the delivery
--   design_assignments(project)     the tasks, for the Design screen (drafters
--                                   cannot read ops_hr.tasks directly)
--   ops_hr.design_task_progress()   filled / total per design task, for HRD
--                                   and the person holding it
--
-- ── Applying this to production ───────────────────────────────────────────
--
-- After `0249` (its own transaction). No drops; no function body removes a
-- row (F226).

-- ── 1. how complete a room or an item is ──────────────────────────────────

-- A room is named `<project>-<collection>-<room>` (26003-A-LR); an item by its
-- number. Dropped items are not counted. An empty room has total 0.
create or replace function ops_procure.design_scope_boxes(p_kind text, p_ref text)
returns table (filled int, total int)
language sql stable security definer set search_path = ops_procure, ops_core, pg_temp as $$
  select count(*) filter (where b.state <> 'kosong')::int, count(*)::int
    from ops_procure.v_design_box b
   where not b.dropped
     and case p_kind
           when 'room' then b.project_code || '-' || b.collection_code || '-' || b.room_code = p_ref
           when 'item' then b.item_no = p_ref
           else false
         end;
$$;
revoke all on function ops_procure.design_scope_boxes(text, text) from public;
grant execute on function ops_procure.design_scope_boxes(text, text) to authenticated;

-- ── 2. give a room or an item to a drafter ────────────────────────────────

create or replace function ops_procure.assign_design_task(
  p_scope text, p_ref text, p_assignee_no text, p_due date, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_hr, ops_core, pg_temp as $$
declare v_scope text := lower(btrim(coalesce(p_scope, ''))); v_ref text := upper(btrim(coalesce(p_ref, '')));
        v_kind ops_hr.task_ref_t; v_emp ops_hr.employees; v_open ops_hr.tasks; v_title text;
        v_room ops_procure.design_rooms; v_item ops_procure.design_items; v_count int;
        v_filled int; v_total int; v_no text;
begin
  if not ops_procure.may_design('update') then
    return ops_core.refused('project','design_task', v_ref,'assign',
      'not_permitted','Menugaskan pekerjaan desain butuh akses proyek, marketing, atau produksi (update).');
  end if;
  if auth.uid() is null then
    return ops_core.refused('project','design_task', v_ref,'assign',
      'not_permitted','Tugas diberikan oleh orang yang masuk dengan akunnya.');
  end if;
  if v_scope not in ('room','item') then
    return ops_core.invalid('project','design_task', v_ref,'assign', 'unknown_scope',
      'Yang ditugaskan: room (ruangan) atau item.', jsonb_build_object('field','scope'));
  end if;

  if v_scope = 'room' then
    v_kind := 'design_room';
    select r.* into v_room from ops_procure.design_rooms r
      join ops_procure.design_collections c on c.id = r.collection_id
      join ops_procure.projects p on p.id = c.project_id
     where p.code || '-' || c.code || '-' || r.code = v_ref;
    if not found then
      return ops_core.not_found('project','design_task', v_ref,'assign', format('Tidak ada ruangan %s.', v_ref));
    end if;
    select count(*) into v_count from ops_procure.design_items where room_id = v_room.id and dropped_at is null;
    v_title := format('Desain %s %s — %s item', v_ref, v_room.name, v_count);
  else
    v_kind := 'design_item';
    select * into v_item from ops_procure.design_items where item_no = v_ref;
    if not found then
      return ops_core.not_found('project','design_task', v_ref,'assign', format('Tidak ada item %s.', v_ref));
    end if;
    if v_item.dropped_at is not null then
      return ops_core.invalid('project','design_task', v_ref,'assign', 'item_dropped',
        'Item ini sudah dikeluarkan dari desain.', jsonb_build_object('field','ref'));
    end if;
    v_title := format('Desain %s %s', v_ref, v_item.name);
  end if;

  select * into v_emp from ops_hr.employees where employee_no = btrim(coalesce(p_assignee_no, '')) and active;
  if not found then
    return ops_core.invalid('project','design_task', v_ref,'assign', 'assignee_unknown',
      'Siapa drafternya? Pilih karyawan yang masih aktif.', jsonb_build_object('field','assignee_no'));
  end if;
  if p_due is null then
    return ops_core.invalid('project','design_task', v_ref,'assign', 'due_required',
      'Tenggatnya kapan?', jsonb_build_object('field','due_date'));
  end if;
  if p_due < ops_core.office_day() then
    return ops_core.invalid('project','design_task', v_ref,'assign', 'due_in_past',
      'Tenggat tidak boleh sebelum hari ini.', jsonb_build_object('field','due_date'));
  end if;

  select * into v_open from ops_hr.tasks
   where ref_kind = v_kind and ref_no = v_ref and status = 'OPEN'
   order by assigned_at desc limit 1;

  if v_open.id is not null then
    -- Moving the open task: another drafter, another date. One record, so the
    -- Design screen and HRD can never disagree about who holds it.
    if v_open.assignee_id = v_emp.id and v_open.due_date = p_due then
      return ops_core.noop('project','design_task', v_open.task_no,'assign',
        'Sudah dipegang orang yang sama dengan tenggat yang sama.',
        jsonb_build_object('task_no', v_open.task_no));
    end if;
    update ops_hr.tasks
       set assignee_id = v_emp.id, due_date = p_due, title = v_title,
           detail = coalesce(nullif(btrim(p_note), ''), detail),
           chase_date = case when chase_date > p_due then null else chase_date end,
           acknowledged_at = case when assignee_id = v_emp.id then acknowledged_at end
     where id = v_open.id;
    return ops_core.ok('project','design_task', v_open.task_no,'reassign',
      jsonb_build_object('task_no', v_open.task_no, 'scope', v_scope, 'ref', v_ref),
      jsonb_build_object('assignee_id', v_open.assignee_id, 'due_date', v_open.due_date),
      jsonb_build_object('assignee_id', v_emp.id, 'due_date', p_due));
  end if;

  select s.filled, s.total into v_filled, v_total from ops_procure.design_scope_boxes(v_scope, v_ref) s;
  if v_total = 0 then
    return ops_core.invalid('project','design_task', v_ref,'assign', 'nothing_to_do',
      'Belum ada item di sini. Tambah itemnya dulu, lalu tugaskan.', jsonb_build_object('field','ref'));
  end if;
  if v_filled = v_total then
    return ops_core.invalid('project','design_task', v_ref,'assign', 'already_complete',
      format('Semua kotak sudah terisi (%s/%s) — tidak ada yang perlu dikerjakan.', v_filled, v_total),
      jsonb_build_object('field','ref'));
  end if;

  insert into ops_hr.tasks (title, detail, assignee_id, assigned_by, due_date, ref_kind, ref_no, deliverable)
  values (v_title, nullif(btrim(p_note), ''), v_emp.id, auth.uid(), p_due, v_kind, v_ref,
          'Semua kotak terisi: gambar kerja PDF, DWG, render, foto item, spesifikasi, BOM — atau ditandai tidak perlu. Selesai sendiri.')
  returning task_no into v_no;

  return ops_core.ok('project','design_task', v_no,'assign',
    jsonb_build_object('task_no', v_no, 'scope', v_scope, 'ref', v_ref,
                       'filled', v_filled, 'total', v_total));
end $$;
revoke all on function ops_procure.assign_design_task(text, text, text, date, text) from public;
grant execute on function ops_procure.assign_design_task(text, text, text, date, text) to authenticated;

-- ── 3. closing itself ─────────────────────────────────────────────────────

-- Every open task the item belongs to — its room's and its own — closes once
-- its scope has no empty box. The finishing date is now: the last box was just
-- filled. Signed by whoever filled it, else by whoever gave the task out.
create or replace function ops_procure.settle_design_tasks(p_item_no text)
returns int
language plpgsql security definer set search_path = ops_procure, ops_hr, ops_core, pg_temp as $$
declare v_room text; t ops_hr.tasks; v_filled int; v_total int; n int := 0;
begin
  select p.code || '-' || c.code || '-' || r.code into v_room
    from ops_procure.design_items i
    join ops_procure.design_rooms r on r.id = i.room_id
    join ops_procure.design_collections c on c.id = r.collection_id
    join ops_procure.projects p on p.id = c.project_id
   where i.item_no = p_item_no;
  if v_room is null then return 0; end if;

  for t in select * from ops_hr.tasks
            where status = 'OPEN'
              and ((ref_kind = 'design_room' and ref_no = v_room)
                or (ref_kind = 'design_item' and ref_no = p_item_no))
  loop
    select s.filled, s.total into v_filled, v_total
      from ops_procure.design_scope_boxes(case when t.ref_kind = 'design_room' then 'room' else 'item' end, t.ref_no) s;
    continue when v_total = 0 or v_filled < v_total;
    perform set_config('ops.design_settle', 'on', true);
    update ops_hr.tasks
       set status = 'DONE', done_at = clock_timestamp(), done_by = coalesce(auth.uid(), assigned_by),
           delivered_note = format('Semua kotak terisi (%s/%s) — selesai sendiri dari Desain.', v_filled, v_total)
     where id = t.id;
    perform set_config('ops.design_settle', 'off', true);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function ops_procure.settle_design_tasks(text) from public;
grant execute on function ops_procure.settle_design_tasks(text) to authenticated;

-- What can fill the last box, each settling the item it belongs to.
create or replace function ops_procure.settle_on_design_link()
returns trigger
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
begin
  if new.entity = 'design_item' and new.unlinked_at is null then
    perform ops_procure.settle_design_tasks(new.entity_no);
  end if;
  return new;
end $$;

create or replace function ops_procure.settle_on_design_row()
returns trigger
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
begin
  perform ops_procure.settle_design_tasks((select item_no from ops_procure.design_items where id = new.item_id));
  return new;
end $$;

create or replace function ops_procure.settle_on_design_item()
returns trigger
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
begin
  -- An item taken out of the room can leave the rest of the room complete.
  if new.dropped_at is not null and old.dropped_at is null then
    perform ops_procure.settle_design_tasks(i.item_no)
       from ops_procure.design_items i
      where i.room_id = new.room_id and i.dropped_at is null;
  end if;
  return new;
end $$;

create or replace function ops_procure.settle_on_bom_revision()
returns trigger
language plpgsql security definer set search_path = ops_procure, ops_prod, ops_core, pg_temp as $$
declare v_code text;
begin
  select product_code into v_code from ops_prod.products where id = new.product_id;
  perform ops_procure.settle_design_tasks(i.item_no)
     from ops_procure.design_items i
    where i.product_code = v_code
       or exists (select 1 from ops_procure.project_lines pl where pl.design_item_id = i.id and pl.product_code = v_code);
  return new;
end $$;

revoke all on function ops_procure.settle_on_design_link() from public;
revoke all on function ops_procure.settle_on_design_row() from public;
revoke all on function ops_procure.settle_on_design_item() from public;
revoke all on function ops_procure.settle_on_bom_revision() from public;
grant execute on function ops_procure.settle_on_design_link() to authenticated;
grant execute on function ops_procure.settle_on_design_row() to authenticated;
grant execute on function ops_procure.settle_on_design_item() to authenticated;
grant execute on function ops_procure.settle_on_bom_revision() to authenticated;

create trigger design_link_settles_tasks
  after insert on ops_core.attachment_links
  for each row execute function ops_procure.settle_on_design_link();
create trigger design_spec_settles_tasks
  after insert on ops_procure.design_item_specs
  for each row execute function ops_procure.settle_on_design_row();
create trigger design_skip_settles_tasks
  after insert on ops_procure.design_box_skips
  for each row execute function ops_procure.settle_on_design_row();
create trigger design_item_drop_settles_tasks
  after update of dropped_at on ops_procure.design_items
  for each row execute function ops_procure.settle_on_design_item();
create trigger bom_revision_settles_design_tasks
  after insert on ops_prod.bom_revisions
  for each row execute function ops_procure.settle_on_bom_revision();

-- Nobody marks a design task done by hand — not the drafter, not HRD (D402):
-- the boxes are the delivery, and a task closed over empty boxes would say a
-- room was drawn that was not. Reopening, blocking and moving stay as they are.
create or replace function ops_hr.design_task_closes_itself()
returns trigger
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
begin
  if new.ref_kind in ('design_room','design_item') and new.status = 'DONE' and old.status <> 'DONE'
     and coalesce(current_setting('ops.design_settle', true), '') <> 'on' then
    raise exception 'Tugas desain selesai sendiri saat semua kotaknya terisi — unggah atau tandai tidak perlu di Produksi › Desain.'
      using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function ops_hr.design_task_closes_itself() from public;
grant execute on function ops_hr.design_task_closes_itself() to authenticated;

create trigger design_task_closes_itself
  before update of status on ops_hr.tasks
  for each row execute function ops_hr.design_task_closes_itself();

-- ── 4. what the screens read ──────────────────────────────────────────────

-- The tasks given out from Design, for the Design screen. A function rather
-- than a view: drafters may read the design but not ops_hr.tasks, and only
-- these columns are theirs to see — no chase notes, no other task.
create or replace function ops_procure.design_assignments(p_project_code text default null)
returns table (task_no text, scope text, ref_no text, project_code text, collection_code text,
               room_code text, item_no text, assignee_no text, assignee_name text, due_date date,
               status text, assigned_at timestamptz, done_at timestamptz, blocked_reason text,
               filled int, total int)
language plpgsql stable security definer set search_path = ops_procure, ops_hr, ops_core, pg_temp as $$
begin
  if not ops_procure.may_design('read') then return; end if;
  return query
    select t.task_no,
           case t.ref_kind when 'design_room' then 'room' else 'item' end,
           t.ref_no,
           split_part(t.ref_no, '-', 1), split_part(t.ref_no, '-', 2), split_part(t.ref_no, '-', 3),
           case when t.ref_kind = 'design_item' then t.ref_no end,
           e.employee_no, e.full_name, t.due_date, t.status::text, t.assigned_at, t.done_at, t.blocked_reason,
           s.filled, s.total
      from ops_hr.tasks t
      join ops_hr.employees e on e.id = t.assignee_id
      cross join lateral ops_procure.design_scope_boxes(
        case t.ref_kind when 'design_room' then 'room' else 'item' end, t.ref_no) s
     where t.ref_kind in ('design_room','design_item')
       and t.status <> 'CANCELLED'
       and (p_project_code is null or split_part(t.ref_no, '-', 1) = p_project_code)
     order by t.status = 'DONE', t.due_date, t.task_no;
end $$;
revoke all on function ops_procure.design_assignments(text) from public;
grant execute on function ops_procure.design_assignments(text) to authenticated;

-- Filled / total for each design task, for HRD's list and the holder's own:
-- HRD monitors (D402), so the progress comes to them rather than them going
-- to the design.
create or replace function ops_hr.design_task_progress()
returns table (task_no text, ref_kind text, ref_no text, filled int, total int)
language plpgsql stable security definer set search_path = ops_hr, ops_procure, ops_core, pg_temp as $$
declare v_me uuid := ops_hr.my_employee_id(); v_all boolean := ops_core.has_permission('hrd.read') or ops_procure.may_design('read');
begin
  return query
    select t.task_no, t.ref_kind::text, t.ref_no, s.filled, s.total
      from ops_hr.tasks t
      cross join lateral ops_procure.design_scope_boxes(
        case t.ref_kind when 'design_room' then 'room' else 'item' end, t.ref_no) s
     where t.ref_kind in ('design_room','design_item')
       and (v_all or t.assignee_id = v_me);
end $$;
revoke all on function ops_hr.design_task_progress() from public;
grant execute on function ops_hr.design_task_progress() to authenticated;

comment on function ops_procure.assign_design_task(text, text, text, date, text) is
  'Give a design room (26003-A-LR) or item to a drafter as an HRD task, or move the open one. Closes itself when every box is filled (D402, D403). (0250)';
