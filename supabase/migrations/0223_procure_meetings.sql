-- 0223_procure_meetings.sql — a meeting recorded in full: who was there, what
-- was decided, what the client asked to change, who does what next, and its
-- files (P3, kajian F224 §4.2, G5, G12).
--
-- The client log (0134) stays the one log of contact with a client. A meeting
-- or a site visit was one line of `summary` in it — so "the client asked for
-- the coffee table lower" could not be found again, nor pointed at by the
-- drawing that answered it. This adds, to any entry of that log:
--
--   meeting_attendees  who was there: TALA's people as accounts, the client's
--                      and third parties' as names (meetings and visits only)
--   meeting_points     the minutes as lines — a decision, a revision request,
--                      an action, or a note — a revision request or action
--                      optionally pointing at the design item it is about
--                      (P4) and at the person who does it, by a date; closed
--                      once done, with what came of it
--
-- and files filed against the entry (0222), in a folder of the meeting:
-- `<client>/<project>/04 MEETING/<date> <kind>` in PROJECT MANAGER for the
-- minutes, survey photos and brief; `<client>/<project>/00 DARI KLIEN/<date>
-- <kind>` in DRAFTING for the client's drawings and references.
--
-- Append-only like the log itself: a point is never edited, and more points
-- can be added after the meeting — minutes are often written the day after.
-- Closing a point is the one change, once, with who and when.
--
-- Who: the log is the sellers' (`may_sell`, D375). Points are also read and
-- closed by the drafters (`may_design`, 0221): a revision request is their
-- work. They read the point and its item, not the rest of the sales log.
--
-- For the production tool (F226): no drops, and no function body here removes
-- rows.

-- ── 1. the tables ─────────────────────────────────────────────────────────

create table ops_procure.meeting_attendees (
  id           uuid primary key default gen_random_uuid(),
  activity_id  uuid not null references ops_procure.client_activities(id),
  seq          int  not null,
  side         text not null check (side in ('tala','client','third_party')),
  user_id      uuid references ops_core.users(id),
  name         text,
  role         text,
  constraint attendee_is_someone check (
    (side = 'tala' and user_id is not null)
    or (side <> 'tala' and name is not null and length(btrim(name)) > 0)),
  unique (activity_id, seq)
);
create unique index meeting_attendees_user_once
  on ops_procure.meeting_attendees (activity_id, user_id) where user_id is not null;

create table ops_procure.meeting_points (
  id              uuid primary key default gen_random_uuid(),
  activity_id     uuid not null references ops_procure.client_activities(id),
  -- Copied from the entry once, so the drafters read where and when a point
  -- was raised without reading the sales log. The log is append-only, so
  -- neither can drift.
  project_id      uuid references ops_procure.projects(id),
  happened_on     date not null,
  seq             int  not null,
  kind            text not null check (kind in ('decision','revision','action','note')),
  body            text not null check (length(btrim(body)) > 0),
  design_item_id  uuid references ops_procure.design_items(id),
  owner_id        uuid references ops_core.users(id),
  due_on          date,
  closed_at       timestamptz,
  closed_by       uuid references ops_core.users(id),
  closed_note     text,
  created_by      uuid references ops_core.users(id),
  -- clock_timestamp, not now(): points written in one call keep their order
  -- (F227).
  created_at      timestamptz not null default clock_timestamp(),
  constraint only_work_closes check (closed_at is null or kind in ('revision','action')),
  constraint due_after_meeting check (due_on is null or due_on >= happened_on),
  unique (activity_id, seq)
);
create index meeting_points_item_idx    on ops_procure.meeting_points (design_item_id) where design_item_id is not null;
create index meeting_points_project_idx on ops_procure.meeting_points (project_id, created_at desc);
create index meeting_points_open_idx    on ops_procure.meeting_points (due_on)
  where closed_at is null and kind in ('revision','action');

alter table ops_procure.meeting_attendees enable row level security;
alter table ops_procure.meeting_points    enable row level security;
create policy meeting_attendees_read on ops_procure.meeting_attendees for select to authenticated
  using (ops_procure.may_sell('read'));
create policy meeting_points_read on ops_procure.meeting_points for select to authenticated
  using (ops_procure.may_design('read'));
grant select on ops_procure.meeting_attendees, ops_procure.meeting_points to authenticated;

-- ── 2. who can be named as TALA's side ────────────────────────────────────

-- Every active account: a meeting is attended by whoever went — the owner, a
-- drafter, the site supervisor — not only by the people who may sell.
create or replace function ops_procure.meeting_people()
returns table (id uuid, full_name text, email text)
language sql stable security definer set search_path = ops_procure, ops_core, pg_temp as $$
  select u.id, coalesce(u.full_name, u.email), u.email
    from ops_core.users u
   where u.is_active and ops_procure.may_design('read')
   order by coalesce(u.full_name, u.email);
$$;
revoke all on function ops_procure.meeting_people() from public;
grant execute on function ops_procure.meeting_people() to authenticated;

-- ── 3. writing a meeting's lines ──────────────────────────────────────────

-- The two helpers below are not security definer: they run with the rights
-- of whoever calls them, so called from a seam they write, and called by a
-- signed-in account directly they cannot (it has select only).

-- Checks every attendee and point against the entry before anything is
-- written; null when all are fine, else the envelope that says which is not.
create or replace function ops_procure.meeting_lines_invalid(
  a ops_procure.client_activities, p_attendees jsonb, p_points jsonb)
returns jsonb
language plpgsql stable set search_path = ops_procure, ops_core, pg_temp as $$
declare x jsonb; n int := 0; v_side text; v_kind text; v_item ops_procure.design_items; v_project uuid;
begin
  if p_attendees is not null and jsonb_typeof(p_attendees) <> 'array' then
    return ops_core.invalid('project','client_activity', a.id::text,'meeting', 'bad_attendees',
      'Peserta dikirim sebagai daftar.', jsonb_build_object('field','attendees'));
  end if;
  if p_points is not null and jsonb_typeof(p_points) <> 'array' then
    return ops_core.invalid('project','client_activity', a.id::text,'meeting', 'bad_points',
      'Butir notulen dikirim sebagai daftar.', jsonb_build_object('field','points'));
  end if;

  if jsonb_array_length(coalesce(p_attendees, '[]')) > 0 and a.kind not in ('meeting','visit') then
    return ops_core.invalid('project','client_activity', a.id::text,'meeting', 'attendees_meeting_only',
      'Peserta hanya dicatat untuk meeting dan kunjungan.', jsonb_build_object('field','attendees'));
  end if;
  for x in select * from jsonb_array_elements(coalesce(p_attendees, '[]')) loop
    n := n + 1;
    v_side := lower(btrim(coalesce(x->>'side', '')));
    if v_side not in ('tala','client','third_party') then
      return ops_core.invalid('project','client_activity', a.id::text,'meeting', 'unknown_side',
        format('Peserta %s: dari pihak TALA, klien, atau pihak ketiga?', n), jsonb_build_object('field','attendees', 'index', n));
    end if;
    if v_side = 'tala' then
      if nullif(x->>'user_id', '') is null
         or not exists (select 1 from ops_core.users u where u.id = (x->>'user_id')::uuid and u.is_active) then
        return ops_core.invalid('project','client_activity', a.id::text,'meeting', 'attendee_unknown',
          format('Peserta %s dari TALA harus akun yang aktif.', n), jsonb_build_object('field','attendees', 'index', n));
      end if;
    elsif coalesce(btrim(x->>'name'), '') = '' then
      return ops_core.invalid('project','client_activity', a.id::text,'meeting', 'attendee_name_required',
        format('Peserta %s: siapa namanya?', n), jsonb_build_object('field','attendees', 'index', n));
    end if;
  end loop;

  n := 0;
  for x in select * from jsonb_array_elements(coalesce(p_points, '[]')) loop
    n := n + 1;
    v_kind := lower(btrim(coalesce(x->>'kind', '')));
    if v_kind not in ('decision','revision','action','note') then
      return ops_core.invalid('project','client_activity', a.id::text,'meeting', 'unknown_point_kind',
        format('Butir %s: keputusan, permintaan revisi, tindakan, atau catatan?', n), jsonb_build_object('field','points', 'index', n));
    end if;
    if coalesce(btrim(x->>'body'), '') = '' then
      return ops_core.invalid('project','client_activity', a.id::text,'meeting', 'point_body_required',
        format('Butir %s kosong.', n), jsonb_build_object('field','points', 'index', n));
    end if;
    if nullif(btrim(x->>'item_no'), '') is not null then
      select * into v_item from ops_procure.design_items where item_no = btrim(x->>'item_no');
      if not found then
        return ops_core.invalid('project','client_activity', a.id::text,'meeting', 'item_unknown',
          format('Butir %s: tidak ada item %s.', n, x->>'item_no'), jsonb_build_object('field','points', 'index', n));
      end if;
      select dc.project_id into v_project
        from ops_procure.design_rooms dr join ops_procure.design_collections dc on dc.id = dr.collection_id
       where dr.id = v_item.room_id;
      if a.project_id is null or v_project <> a.project_id then
        return ops_core.invalid('project','client_activity', a.id::text,'meeting', 'item_other_project',
          format('Butir %s: item %s bukan item proyek yang dibicarakan.', n, v_item.item_no),
          jsonb_build_object('field','points', 'index', n));
      end if;
    end if;
    if nullif(x->>'owner_id', '') is not null
       and not exists (select 1 from ops_core.users u where u.id = (x->>'owner_id')::uuid and u.is_active) then
      return ops_core.invalid('project','client_activity', a.id::text,'meeting', 'owner_unknown',
        format('Butir %s: penanggung jawabnya harus akun yang aktif.', n), jsonb_build_object('field','points', 'index', n));
    end if;
    if nullif(x->>'due_on', '') is not null and (x->>'due_on')::date < a.happened_on then
      return ops_core.invalid('project','client_activity', a.id::text,'meeting', 'due_before_meeting',
        format('Butir %s: tenggatnya sebelum meeting.', n), jsonb_build_object('field','points', 'index', n));
    end if;
  end loop;
  return null;
end $$;
revoke all on function ops_procure.meeting_lines_invalid(ops_procure.client_activities, jsonb, jsonb) from public;

-- Writes them, after the above said they are fine. Points are numbered after
-- the entry's last, so minutes added the next day follow on.
create or replace function ops_procure.meeting_lines_write(
  a ops_procure.client_activities, p_attendees jsonb, p_points jsonb)
returns int
language plpgsql set search_path = ops_procure, ops_core, pg_temp as $$
declare x jsonb; v_seq int; v_n int := 0;
begin
  select coalesce(max(seq), 0) into v_seq from ops_procure.meeting_attendees where activity_id = a.id;
  for x in select * from jsonb_array_elements(coalesce(p_attendees, '[]')) loop
    -- The same account twice is one attendee.
    if lower(btrim(x->>'side')) = 'tala' and exists (
         select 1 from ops_procure.meeting_attendees m
          where m.activity_id = a.id and m.user_id = (x->>'user_id')::uuid) then
      continue;
    end if;
    v_seq := v_seq + 1;
    insert into ops_procure.meeting_attendees (activity_id, seq, side, user_id, name, role)
    values (a.id, v_seq, lower(btrim(x->>'side')),
            case when lower(btrim(x->>'side')) = 'tala' then (x->>'user_id')::uuid end,
            case when lower(btrim(x->>'side')) <> 'tala' then btrim(x->>'name') end,
            nullif(btrim(x->>'role'), ''));
  end loop;

  select coalesce(max(seq), 0) into v_seq from ops_procure.meeting_points where activity_id = a.id;
  for x in select * from jsonb_array_elements(coalesce(p_points, '[]')) loop
    v_seq := v_seq + 1;
    v_n := v_n + 1;
    insert into ops_procure.meeting_points (activity_id, project_id, happened_on, seq, kind, body,
                                            design_item_id, owner_id, due_on, created_by)
    values (a.id, a.project_id, a.happened_on, v_seq, lower(btrim(x->>'kind')), btrim(x->>'body'),
            (select i.id from ops_procure.design_items i where i.item_no = nullif(btrim(x->>'item_no'), '')),
            nullif(x->>'owner_id', '')::uuid, nullif(x->>'due_on', '')::date, auth.uid());
  end loop;
  return v_n;
end $$;
revoke all on function ops_procure.meeting_lines_write(ops_procure.client_activities, jsonb, jsonb) from public;

-- ── 4. the seams ──────────────────────────────────────────────────────────

-- A contact with its attendees and minutes, in one go. The entry is written
-- by `log_client_activity` (its rules, its refusals); the lines are checked
-- against it, and if one is wrong the entry is taken back with them, so a
-- refused meeting leaves nothing half-written.
create or replace function ops_procure.log_meeting(
  p_client_code text, p_kind text, p_summary text,
  p_project_code text default null, p_quote_no text default null, p_happened_on date default null,
  p_follow_up_on date default null, p_next_action text default null,
  p_attendees jsonb default null, p_points jsonb default null, p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare replayed jsonb; res jsonb; v_bad jsonb; a ops_procure.client_activities; v_points int;
begin
  replayed := ops_core.idem_replay('project', 'log_meeting', p_key);
  if replayed is not null then return replayed; end if;

  begin
    res := ops_procure.log_client_activity(p_client_code, p_kind, p_summary, p_project_code, p_quote_no,
                                           p_happened_on, p_follow_up_on, p_next_action, null);
    if not ops_core.said_ok(res) then
      return res;
    end if;
    select * into a from ops_procure.client_activities where id = (res->'data'->>'id')::uuid;
    v_bad := ops_procure.meeting_lines_invalid(a, p_attendees, p_points);
    if v_bad is not null then
      raise exception 'meeting_lines_invalid';
    end if;
    v_points := ops_procure.meeting_lines_write(a, p_attendees, p_points);
  exception when raise_exception then
    if v_bad is not null then
      return v_bad;
    end if;
    raise;
  end;

  res := ops_core.ok('project','client_activity', a.id::text,'meeting',
    jsonb_build_object('id', a.id, 'points', v_points));
  return ops_core.idem_remember('project', 'log_meeting', p_key, res);
end $$;
revoke all on function ops_procure.log_meeting(text, text, text, text, text, date, date, text, jsonb, jsonb, text) from public;
grant execute on function ops_procure.log_meeting(text, text, text, text, text, date, date, text, jsonb, jsonb, text) to authenticated;

-- More minutes, or somebody forgotten, after the meeting. Nothing already
-- written changes.
create or replace function ops_procure.add_meeting_lines(
  p_activity_id uuid, p_attendees jsonb default null, p_points jsonb default null)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare a ops_procure.client_activities; v_bad jsonb; v_points int;
begin
  if not ops_procure.may_sell('update') then
    return ops_core.refused('project','client_activity', p_activity_id::text,'meeting',
      'not_permitted','Menambah notulen butuh akses proyek atau marketing (update).');
  end if;
  select * into a from ops_procure.client_activities where id = p_activity_id;
  if not found then
    return ops_core.not_found('project','client_activity', p_activity_id::text,'meeting', 'Catatan kontak itu tidak ada.');
  end if;
  if jsonb_array_length(coalesce(p_attendees, '[]')) + jsonb_array_length(coalesce(p_points, '[]')) = 0 then
    return ops_core.noop('project','client_activity', a.id::text,'meeting', 'Tidak ada yang ditambahkan.',
      jsonb_build_object('id', a.id));
  end if;
  v_bad := ops_procure.meeting_lines_invalid(a, p_attendees, p_points);
  if v_bad is not null then return v_bad; end if;
  v_points := ops_procure.meeting_lines_write(a, p_attendees, p_points);
  return ops_core.ok('project','client_activity', a.id::text,'meeting',
    jsonb_build_object('id', a.id, 'points', v_points));
end $$;
revoke all on function ops_procure.add_meeting_lines(uuid, jsonb, jsonb) from public;
grant execute on function ops_procure.add_meeting_lines(uuid, jsonb, jsonb) to authenticated;

-- A revision request or an action done, with what came of it. Once.
create or replace function ops_procure.close_meeting_point(p_point_id uuid, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare pt ops_procure.meeting_points;
begin
  if not ops_procure.may_design('update') then
    return ops_core.refused('project','meeting_point', p_point_id::text,'close',
      'not_permitted','Menutup butir notulen butuh akses proyek, marketing, atau produksi (update).');
  end if;
  select * into pt from ops_procure.meeting_points where id = p_point_id;
  if not found then
    return ops_core.not_found('project','meeting_point', p_point_id::text,'close', 'Butir notulen itu tidak ada.');
  end if;
  if pt.kind not in ('revision','action') then
    return ops_core.invalid('project','meeting_point', pt.id::text,'close', 'not_closable',
      'Hanya permintaan revisi dan tindakan yang ditutup; keputusan dan catatan cukup dicatat.',
      jsonb_build_object('field','kind'));
  end if;
  if pt.closed_at is not null then
    return ops_core.noop('project','meeting_point', pt.id::text,'close', 'Sudah ditutup.',
      jsonb_build_object('id', pt.id));
  end if;
  update ops_procure.meeting_points
     set closed_at = now(), closed_by = auth.uid(), closed_note = nullif(btrim(p_note), '')
   where id = pt.id;
  return ops_core.ok('project','meeting_point', pt.id::text,'close', jsonb_build_object('id', pt.id));
end $$;
revoke all on function ops_procure.close_meeting_point(uuid, text) from public;
grant execute on function ops_procure.close_meeting_point(uuid, text) to authenticated;

-- ── 5. what the screens read ──────────────────────────────────────────────

create or replace view ops_procure.v_meeting_attendee as
select m.id, m.activity_id, m.seq, m.side, m.user_id,
       coalesce(u.full_name, u.email, m.name) as name, m.role
  from ops_procure.meeting_attendees m
  left join ops_core.users u on u.id = m.user_id;
alter view ops_procure.v_meeting_attendee set (security_invoker = on);
grant select on ops_procure.v_meeting_attendee to authenticated;

create or replace view ops_procure.v_meeting_point as
select
  p.id, p.activity_id, p.seq, p.kind, p.body, p.happened_on,
  pr.code as project_code, pr.name as project_name,
  i.item_no, i.name as item_name,
  p.owner_id, coalesce(o.full_name, o.email) as owner_name,
  p.due_on,
  case
    when p.kind not in ('revision','action') then 'noted'
    when p.closed_at is not null              then 'done'
    when p.due_on < ops_core.office_day()     then 'overdue'
    else 'open'
  end as state,
  p.closed_at, coalesce(c.full_name, c.email) as closed_by_name, p.closed_note,
  coalesce(w.full_name, w.email) as created_by_name, p.created_at
from ops_procure.meeting_points p
left join ops_procure.projects pr on pr.id = p.project_id
left join ops_procure.design_items i on i.id = p.design_item_id
left join ops_core.users o on o.id = p.owner_id
left join ops_core.users c on c.id = p.closed_by
left join ops_core.users w on w.id = p.created_by;
alter view ops_procure.v_meeting_point set (security_invoker = on);
grant select on ops_procure.v_meeting_point to authenticated;

-- The log, as before, and what each entry now carries — appended at the end,
-- so every reader of the old columns reads the same thing.
create or replace view ops_procure.v_client_activity as
select
  a.id, a.kind, a.happened_on, a.summary,
  a.follow_up_on, a.next_action, a.follow_up_done_at, a.follow_up_result,
  case when a.follow_up_on is null then 'none'
       when a.follow_up_done_at is not null then 'done'
       when a.follow_up_on < ops_core.office_day() then 'overdue'
       when a.follow_up_on = ops_core.office_day() then 'today'
       else 'upcoming' end                         as follow_up_state,
  c.code  as client_code, c.name as client_name, c.contact_name as client_contact, c.phone as client_phone,
  p.code  as project_code, p.name as project_name,
  q.quote_no, q.status::text as quote_status,
  coalesce(u.full_name, u.email)                   as created_by_name,
  coalesce(d.full_name, d.email)                   as follow_up_done_by_name,
  a.created_at,
  (select count(*) from ops_procure.meeting_attendees m where m.activity_id = a.id)::int as attendee_count,
  (select count(*) from ops_procure.meeting_points mp where mp.activity_id = a.id)::int  as point_count,
  (select count(*) from ops_procure.meeting_points mp
    where mp.activity_id = a.id and mp.kind in ('revision','action') and mp.closed_at is null)::int as open_points,
  (select count(*) from ops_core.attachment_links l
    where l.entity = 'client_activity' and l.entity_no = a.id::text and l.unlinked_at is null)::int as file_count
from ops_procure.client_activities a
join ops_procure.clients c on c.id = a.client_id
left join ops_procure.projects p on p.id = a.project_id
left join ops_procure.quotations q on q.id = a.quotation_id
left join ops_core.users u on u.id = a.created_by
left join ops_core.users d on d.id = a.follow_up_done_by;
-- `create or replace view` drops the view's options: say it again, or the log
-- is read with the owner's rights and every row is anybody's.
alter view ops_procure.v_client_activity set (security_invoker = on);

-- ── 6. a meeting's files, in a folder of the meeting ──────────────────────

create or replace function ops_procure.drive_context(p_entity text, p_entity_no text)
returns table (client_folder text, project_folder text)
language sql stable security definer set search_path = ops_procure, ops_core, pg_temp as $$
  with p as (
    select pr.code, pr.name, pr.client_id, pr.client_name
      from ops_procure.projects pr
     where (p_entity = 'project' and pr.code = btrim(p_entity_no))
        or (p_entity = 'quotation' and pr.id = (select q.project_id from ops_procure.quotations q
                                                  where q.quote_no = btrim(p_entity_no)))
        or (p_entity = 'design_item' and pr.id = (select dc.project_id from ops_procure.design_items di
                                                     join ops_procure.design_rooms dr on dr.id = di.room_id
                                                     join ops_procure.design_collections dc on dc.id = dr.collection_id
                                                    where di.item_no = btrim(p_entity_no)))
        or (p_entity = 'design_collection' and pr.id = (select dc.project_id from ops_procure.design_collections dc
                                                           join ops_procure.projects x on x.id = dc.project_id
                                                          where x.code || '-' || dc.code = btrim(p_entity_no)))
        or (p_entity = 'client_activity' and pr.id = (select a.project_id from ops_procure.client_activities a
                                                         where a.id::text = btrim(p_entity_no)))
  )
  select coalesce(ops_core.drive_segment(c.code || ' ' || c.name),
                  ops_core.drive_segment(p.client_name),
                  'TANPA KLIEN'),
         ops_core.drive_segment(p.code || ' ' || p.name)
    from p
    left join ops_procure.clients c on c.id = p.client_id
  union all
  select ops_core.drive_segment(c.code || ' ' || c.name), '00 UMUM'
    from ops_procure.clients c
   where p_entity = 'client' and c.code = btrim(p_entity_no)
  union all
  -- A contact about the client in general, no project named.
  select ops_core.drive_segment(c.code || ' ' || c.name), '00 UMUM'
    from ops_procure.client_activities a
    join ops_procure.clients c on c.id = a.client_id
   where p_entity = 'client_activity' and a.id::text = btrim(p_entity_no) and a.project_id is null;
$$;

-- `2026-10-02 MEETING`: the day and the kind, which is how people look for it.
create or replace function ops_procure.drive_context_meeting(p_entity text, p_entity_no text)
returns text
language sql stable set search_path = ops_procure, ops_core, pg_temp as $$
  select ops_core.drive_segment(to_char(a.happened_on, 'YYYY-MM-DD') || ' ' || upper(a.kind))
    from ops_procure.client_activities a
   where p_entity = 'client_activity' and a.id::text = btrim(p_entity_no);
$$;
revoke all on function ops_procure.drive_context_meeting(text, text) from public;

create or replace function ops_core.drive_path_for_record(
  p_kind ops_core.doc_kind_t, p_entity text, p_entity_no text, p_day date default null)
returns text
language plpgsql stable security definer set search_path = ops_core, pg_temp as $$
declare v_path text; v_client text; v_project text; v_coll text; v_room text; v_item text; v_meeting text;
begin
  v_path := ops_core.drive_path_for(p_kind, p_entity, p_day);
  if v_path !~ '\{(CLIENT|PROJECT|COLLECTION|ROOM|ITEM|MEETING)\}' then
    return v_path;
  end if;
  if p_entity_no is not null then
    select x.client_folder, x.project_folder into v_client, v_project
      from ops_procure.drive_context(p_entity, p_entity_no) x
     limit 1;
    if v_path ~ '\{(COLLECTION|ROOM|ITEM)\}' then
      select x.collection_folder, x.room_folder, x.item_folder into v_coll, v_room, v_item
        from ops_procure.drive_context_design(p_entity, p_entity_no) x
       limit 1;
    end if;
    if v_path ~ '\{MEETING\}' then
      v_meeting := ops_procure.drive_context_meeting(p_entity, p_entity_no);
    end if;
  end if;
  return replace(replace(replace(replace(replace(replace(v_path,
    '{CLIENT}',     coalesce(v_client,  'TANPA KLIEN')),
    '{PROJECT}',    coalesce(v_project, 'TANPA PROYEK')),
    '{COLLECTION}', coalesce(v_coll,    'TANPA KOLEKSI')),
    '{ROOM}',       coalesce(v_room,    'TANPA RUANGAN')),
    '{ITEM}',       coalesce(v_item,    'TANPA ITEM')),
    '{MEETING}',    coalesce(v_meeting, 'TANPA MEETING'));
end $$;

comment on function ops_core.drive_path_for_record(ops_core.doc_kind_t, text, text, date) is
  'drive_path_for, with {CLIENT}, {PROJECT}, {COLLECTION}, {ROOM}, {ITEM} and {MEETING} read from the record '
  'the file is filed against (TANPA … where it says nothing). (0217, 0221, 0223)';

insert into ops_core.drive_paths (kind, entity, path, note) values
  -- PROJECT MANAGER: the meeting's own paper.
  ('notulen',         'client_activity', '{CLIENT}/{PROJECT}/04 MEETING/{MEETING}', 'A meeting''s files, in a folder of the meeting (P3).'),
  ('foto_survei',     'client_activity', '{CLIENT}/{PROJECT}/04 MEETING/{MEETING}', null),
  ('brief',           'client_activity', '{CLIENT}/{PROJECT}/04 MEETING/{MEETING}', null),
  -- DRAFTING: what the client brought to it, beside the rest of theirs.
  ('gambar_klien',    'client_activity', '{CLIENT}/{PROJECT}/00 DARI KLIEN/{MEETING}', null),
  ('referensi_klien', 'client_activity', '{CLIENT}/{PROJECT}/00 DARI KLIEN/{MEETING}', null)
on conflict (kind, entity) do nothing;

analyze ops_procure.meeting_attendees;
analyze ops_procure.meeting_points;
