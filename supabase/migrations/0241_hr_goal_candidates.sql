-- 0241_hr_goal_candidates.sql — kandidat sasaran, and goals made from the
-- daftar tunggu (D393).
--
-- The owner, 2026-10-08: *"apakah dari ini bisa diusulkan jadi goals? atau
-- membuat goals baru dengan menyisipkan beberapa item dari waiting list?
-- bagaimana kalau pimpinan punya beberapa project yang mungkin akan
-- dijalankan atau tidak di desember?"* — and the choices: HRD and pimpinan
-- write and decide candidates; the rank is chosen when one is run; staff keep
-- proposing work, not goals.
--
-- **A candidate** is a goal with an estimated start month and a date by which
-- it is decided. It is not ranked, nobody can be given a task in it, and it is
-- in nobody's score: until it is decided it is a possibility, not work. Its
-- parts can be prepared as daftar tunggu items, so a *Jalankan* starts from a
-- list instead of a blank page. *Jalankan* makes it an open goal at the rank
-- chosen there and then; *Tidak jadi* closes it with a reason and takes its
-- waiting items off the list with it.
--
-- **Pimpinan** is who holds `approve_funds`, the same test the leadership
-- cashflow and accounts use (D391, D392). Planning goals is theirs and
-- HRD's (`hrd.update`).

/* ── the table: a candidate is open, not closed ──────────────────────────── */
alter table ops_hr.goals
  add column starts_month  date,
  add column decide_by     date,
  add column decided_at    timestamptz,
  add column decided_by    uuid references ops_core.users(id),
  add column decision_note text;

-- A candidate has not closed, so it carries no closing signature — the rule
-- 0210 wrote for OPEN, now for both.
alter table ops_hr.goals
  drop constraint goal_close_is_signed,
  add constraint goal_close_is_signed check (
    (status in ('OPEN','CANDIDATE') and closed_at is null and closed_by is null)
    or (status not in ('OPEN','CANDIDATE') and closed_at is not null and closed_by is not null)),
  add constraint goal_candidate_has_decision_date check (status <> 'CANDIDATE' or decide_by is not null),
  add constraint goal_starts_on_a_first check (starts_month is null or extract(day from starts_month) = 1);

/* ── who plans goals ──────────────────────────────────────────────────────── */
create or replace function ops_hr.can_plan_goals()
returns boolean
language sql stable security definer set search_path = ops_hr, ops_core, pg_temp as $$
  select ops_core.has_permission('hrd.update') or ops_core.has_authority('approve_funds');
$$;

/* ── the candidates, with what is already prepared for each ───────────── */
create or replace function ops_hr.list_candidate_goals()
returns table (
  id uuid, goal_no text, title text, outcome text, detail text,
  owner_no text, owner_name text, target_date date,
  starts_month date, decide_by date, days_to_decide int,
  created_by_name text, created_at timestamptz,
  items int, item_titles text[])
language plpgsql stable security definer set search_path = ops_hr, ops_core, pg_temp as $$
begin
  if not (ops_hr.can_plan_goals() or ops_core.has_permission('hrd.read')) then
    raise exception using errcode = '42501',
      message = 'Kandidat sasaran dibaca oleh HRD dan pimpinan.';
  end if;
  return query
    select g.id, g.goal_no, g.title, g.outcome, g.detail,
           o.employee_no, o.full_name, g.target_date,
           g.starts_month, g.decide_by, (g.decide_by - ops_core.office_day())::int,
           coalesce(u.full_name, g.created_by::text), g.created_at,
           (select count(*)::int from ops_hr.backlog b
             where b.goal_id = g.id and b.status in ('PROPOSED','OPEN')),
           (select coalesce(array_agg(b.title order by b.sort_key nulls last, b.item_no), '{}')
              from ops_hr.backlog b where b.goal_id = g.id and b.status in ('PROPOSED','OPEN'))
      from ops_hr.goals g
      join ops_hr.employees o on o.id = g.owner_id
      left join ops_core.users u on u.id = g.created_by
     where g.status = 'CANDIDATE'
     order by g.decide_by, g.starts_month nulls last, g.goal_no;
end $$;

/* ── a candidate: new or changed ─────────────────────────────────────────── */
create or replace function ops_hr.save_candidate_goal(
  p_goal_no text, p_title text, p_outcome text, p_owner_no text,
  p_target_date date, p_decide_by date,
  p_starts_month date default null, p_detail text default null)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare g ops_hr.goals%rowtype; emp ops_hr.employees%rowtype;
        v_new boolean := p_goal_no is null; v_no text;
        v_month date := case when p_starts_month is null then null
                             else date_trunc('month', p_starts_month)::date end;
begin
  if not ops_hr.can_plan_goals() then
    return ops_core.refused('hr','goal', p_goal_no, case when v_new then 'create' else 'update' end,
      'not_permitted','Kandidat sasaran ditulis oleh HRD atau pimpinan.');
  end if;
  if not v_new then
    select * into g from ops_hr.goals where goal_no = p_goal_no for update;
    if not found then
      return ops_core.not_found('hr','goal', p_goal_no,'update', format('Tidak ada sasaran %s.', p_goal_no));
    end if;
    if g.status <> 'CANDIDATE' then
      return ops_core.conflict('hr','goal', p_goal_no,'update','not_a_candidate',
        format('%s bukan kandidat lagi — ubah lewat Sasaran & prioritas.', g.goal_no));
    end if;
  end if;
  if coalesce(btrim(coalesce(p_title,'')),'') = '' then
    return ops_core.invalid('hr','goal', p_goal_no,'save','title_required', 'Sasarannya apa?',
      jsonb_build_object('field','title'));
  end if;
  if coalesce(btrim(coalesce(p_outcome,'')),'') = '' then
    return ops_core.invalid('hr','goal', p_goal_no,'save','outcome_required',
      'Seperti apa hasilnya kalau sudah tercapai? Tanpa itu, semua bagian bisa selesai dan tetap tidak ada hasilnya.',
      jsonb_build_object('field','outcome'));
  end if;
  if p_target_date is null then
    return ops_core.invalid('hr','goal', p_goal_no,'save','target_required',
      'Perkiraan tanggal tercapai — kandidat pun butuh, supaya terlihat di roadmap.',
      jsonb_build_object('field','target_date'));
  end if;
  if p_decide_by is null then
    return ops_core.invalid('hr','goal', p_goal_no,'save','decide_by_required',
      'Kapan diputuskan jalan atau tidak? Kandidat tanpa tanggal keputusan menggantung selamanya.',
      jsonb_build_object('field','decide_by'));
  end if;
  if p_decide_by > p_target_date then
    return ops_core.invalid('hr','goal', p_goal_no,'save','decide_after_target',
      'Tanggal keputusan sesudah target — tidak ada waktu untuk mengerjakannya.',
      jsonb_build_object('field','decide_by'));
  end if;
  if v_new and p_decide_by < ops_core.office_day() then
    return ops_core.invalid('hr','goal', p_goal_no,'save','decide_in_past',
      'Tanggal keputusan sudah lewat.', jsonb_build_object('field','decide_by'));
  end if;
  select * into emp from ops_hr.employees where employee_no = p_owner_no;
  if not found then
    return ops_core.not_found('hr','goal', p_goal_no,'save',
      format('Tidak ada karyawan %s.', coalesce(p_owner_no,'(kosong)')));
  end if;
  if not emp.active then
    return ops_core.conflict('hr','goal', p_goal_no,'save','employee_left',
      format('%s sudah tidak aktif.', emp.full_name));
  end if;

  if v_new then
    insert into ops_hr.goals (title, outcome, detail, owner_id, target_date, status, rank,
                              starts_month, decide_by, created_by)
    values (btrim(p_title), btrim(p_outcome), nullif(btrim(coalesce(p_detail,'')),''),
            emp.id, p_target_date, 'CANDIDATE', null, v_month, p_decide_by, auth.uid())
    returning goal_no into v_no;
    return ops_core.ok('hr','goal', v_no,'create',
      jsonb_build_object('goal_no', v_no, 'status', 'CANDIDATE'), null,
      jsonb_build_object('title', btrim(p_title), 'owner', emp.employee_no, 'target', p_target_date,
                         'starts_month', v_month, 'decide_by', p_decide_by, 'status', 'CANDIDATE'));
  end if;

  update ops_hr.goals
     set title = btrim(p_title), outcome = btrim(p_outcome),
         detail = nullif(btrim(coalesce(p_detail,'')),''),
         owner_id = emp.id, target_date = p_target_date,
         starts_month = v_month, decide_by = p_decide_by
   where id = g.id;
  return ops_core.ok('hr','goal', g.goal_no,'update',
    jsonb_build_object('goal_no', g.goal_no, 'status', 'CANDIDATE'),
    jsonb_build_object('title', g.title, 'target', g.target_date, 'starts_month', g.starts_month,
                       'decide_by', g.decide_by),
    jsonb_build_object('title', btrim(p_title), 'target', p_target_date, 'starts_month', v_month,
                       'decide_by', p_decide_by));
end $$;

/* ── the decision ──────────────────────────────────────────────────────────
 *
 *  *Jalankan* places it in the ranked list at `p_rank` (1 = first; empty =
 *  last), moving the goals at and below that place down by one — the order
 *  stays an order. *Tidak jadi* closes it with the reason, and its waiting
 *  items leave the list with the same reason.
 */
create or replace function ops_hr.decide_candidate_goal(
  p_goal_no text, p_run boolean, p_rank int default null, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare g ops_hr.goals%rowtype; v_open int; v_pos int; v_note text := nullif(btrim(coalesce(p_note,'')),'');
        v_dropped int := 0;
begin
  if not ops_hr.can_plan_goals() then
    return ops_core.refused('hr','goal', p_goal_no,'decide','not_permitted',
      'Memutuskan kandidat sasaran butuh akses HRD atau pimpinan.');
  end if;
  select * into g from ops_hr.goals where goal_no = p_goal_no for update;
  if not found then
    return ops_core.not_found('hr','goal', p_goal_no,'decide', format('Tidak ada sasaran %s.', p_goal_no));
  end if;
  if g.status <> 'CANDIDATE' then
    return ops_core.conflict('hr','goal', p_goal_no,'decide','not_a_candidate',
      format('%s sudah diputuskan.', g.goal_no));
  end if;

  if p_run then
    select count(*) into v_open from ops_hr.goals where status = 'OPEN';
    v_pos := least(greatest(coalesce(p_rank, v_open + 1), 1), v_open + 1);
    update ops_hr.goals set rank = rank + 1 where status = 'OPEN' and rank >= v_pos;
    update ops_hr.goals
       set status = 'OPEN', rank = v_pos,
           decided_at = now(), decided_by = auth.uid(), decision_note = v_note
     where id = g.id;
    insert into ops_core.notifications (user_id, kind, title, data, link, entity_no)
    select u.id, 'goal.run', format('Kandidat dijalankan: %s — sekarang #%s', g.title, v_pos),
           jsonb_build_object('goal_no', g.goal_no, 'title', g.title, 'rank', v_pos),
           '/profil?tab=tugas', g.goal_no
      from ops_hr.employees e join ops_core.users u on u.id = e.user_id
     where e.id = g.owner_id and u.is_active and u.id is distinct from auth.uid();
    return ops_core.ok('hr','goal', g.goal_no,'decide',
      jsonb_build_object('goal_no', g.goal_no, 'status', 'OPEN', 'rank', v_pos),
      jsonb_build_object('status','CANDIDATE'), jsonb_build_object('status','OPEN','rank', v_pos, 'note', v_note));
  end if;

  if v_note is null then
    return ops_core.invalid('hr','goal', p_goal_no,'decide','reason_required',
      'Kenapa tidak jadi? Alasannya satu-satunya jejak yang tersisa dari kandidat ini.',
      jsonb_build_object('field','note'));
  end if;
  update ops_hr.goals
     set status = 'CANCELLED', closed_at = now(), closed_by = auth.uid(),
         closed_note = v_note, decided_at = now(), decided_by = auth.uid(), decision_note = v_note
   where id = g.id;
  update ops_hr.backlog
     set status = 'DROPPED', sort_key = null,
         dropped_reason = format('Kandidat %s tidak jadi: %s', g.goal_no, v_note),
         dropped_by = auth.uid(), dropped_at = now()
   where goal_id = g.id and status in ('PROPOSED','OPEN');
  get diagnostics v_dropped = row_count;
  return ops_core.ok('hr','goal', g.goal_no,'decide',
    jsonb_build_object('goal_no', g.goal_no, 'status', 'CANCELLED', 'items_removed', v_dropped),
    jsonb_build_object('status','CANDIDATE'), jsonb_build_object('status','CANCELLED','note', v_note));
end $$;

/* ── items from the daftar tunggu into a goal or candidate ─────────────────
 *  They stay unassigned and on the list; what changes is what they are part
 *  of. Every item named must be waiting (OPEN), or none moves. */
create or replace function ops_hr.attach_backlog_to_goal(p_item_nos text[], p_goal_no text)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare g ops_hr.goals%rowtype; v_bad text[]; n int;
begin
  if not ops_hr.can_plan_goals() then
    return ops_core.refused('hr','backlog', null,'attach','not_permitted',
      'Menyusun sasaran dari daftar tunggu butuh akses HRD atau pimpinan.');
  end if;
  if coalesce(array_length(p_item_nos, 1), 0) = 0 then
    return ops_core.invalid('hr','backlog', null,'attach','items_required',
      'Pilih item daftar tunggu yang akan dimasukkan.', jsonb_build_object('field','item_nos'));
  end if;
  select * into g from ops_hr.goals where goal_no = p_goal_no;
  if not found then
    return ops_core.not_found('hr','backlog', null,'attach', format('Tidak ada sasaran %s.', p_goal_no));
  end if;
  if g.status not in ('OPEN','CANDIDATE') then
    return ops_core.conflict('hr','backlog', null,'attach','goal_closed',
      format('%s sudah ditutup.', g.goal_no));
  end if;
  select array_agg(x) into v_bad
    from unnest(p_item_nos) x
   where not exists (select 1 from ops_hr.backlog b where b.item_no = x and b.status = 'OPEN');
  if v_bad is not null then
    return ops_core.conflict('hr','backlog', null,'attach','not_waiting',
      format('Bukan item daftar tunggu yang terbuka: %s.', array_to_string(v_bad, ', ')),
      jsonb_build_object('items', to_jsonb(v_bad)));
  end if;
  update ops_hr.backlog set goal_id = g.id where item_no = any(p_item_nos);
  get diagnostics n = row_count;
  return ops_core.ok('hr','backlog', null,'attach',
    jsonb_build_object('goal_no', g.goal_no, 'attached', n), null,
    jsonb_build_object('goal', g.goal_no, 'items', to_jsonb(p_item_nos)));
end $$;

/* ── 0220's seams, amended: a candidate takes items, but not tasks ──────── */
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
    -- A candidate takes items too: its parts are prepared before it is decided (D393).
    if g.status not in ('OPEN','CANDIDATE') then
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
  -- A candidate's part waits for the decision: nobody is given work on a
  -- result that may not happen (D393).
  if exists (select 1 from ops_hr.goals g where g.id = b.goal_id and g.status = 'CANDIDATE') then
    return ops_core.conflict('hr','backlog', p_item_no,'assign','goal_is_candidate',
      format('%s bagian dari kandidat sasaran %s — putuskan Jalankan dulu, baru bagian-bagiannya ditugaskan.',
             b.item_no, (select goal_no from ops_hr.goals where id = b.goal_id)));
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

/* ── the day a candidate is due to be decided ───────────────────────────
 *  One bell notice to HRD (write/admin) and pimpinan, on the morning of its
 *  decision date. The morning job runs it after the daily routines. */
create or replace function ops_hr.remind_candidate_goals()
returns int
language plpgsql security invoker set search_path = ops_hr, ops_core, pg_temp as $$
declare n int;
begin
  insert into ops_core.notifications (user_id, kind, title, data, link, entity_no)
  select u.id, 'goal.decide_due',
         format('Hari ini batas keputusan kandidat: %s', g.title),
         jsonb_build_object('goal_no', g.goal_no, 'title', g.title, 'decide_by', g.decide_by,
                            'starts_month', g.starts_month),
         '/hrd/tugas?tab=goals', g.goal_no
    from ops_hr.goals g
    cross join ops_core.users u
   where g.status = 'CANDIDATE' and g.decide_by = ops_core.office_day()
     and u.is_active
     and (exists (select 1 from ops_core.user_modules m where m.user_id = u.id and m.module = 'hrd'
                    and m.level in ('write','admin'))
          or exists (select 1 from ops_core.user_authorities a where a.user_id = u.id
                       and a.authority = 'approve_funds'))
     and not exists (select 1 from ops_core.notifications x
                      where x.user_id = u.id and x.kind = 'goal.decide_due' and x.entity_no = g.goal_no);
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on function ops_hr.can_plan_goals() from public;
revoke execute on function ops_hr.list_candidate_goals() from public;
revoke execute on function ops_hr.save_candidate_goal(text, text, text, text, date, date, date, text) from public;
revoke execute on function ops_hr.decide_candidate_goal(text, boolean, int, text) from public;
revoke execute on function ops_hr.attach_backlog_to_goal(text[], text) from public;
revoke execute on function ops_hr.remind_candidate_goals() from public;

grant execute on function ops_hr.can_plan_goals() to authenticated;
grant execute on function ops_hr.list_candidate_goals() to authenticated;
grant execute on function ops_hr.save_candidate_goal(text, text, text, text, date, date, date, text) to authenticated;
grant execute on function ops_hr.decide_candidate_goal(text, boolean, int, text) to authenticated;
grant execute on function ops_hr.attach_backlog_to_goal(text[], text) to authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('ops-candidate-reminders', '10 22 * * *',
                          'select ops_hr.remind_candidate_goals()');
  end if;
end $$;
