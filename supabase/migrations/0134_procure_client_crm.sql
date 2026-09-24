-- 0134_procure_client_crm.sql — what was said to a client, and what to do next.
--
-- The client master (0111) says who to call. It does not say that somebody
-- called, what the client answered, or that the quotation sent last Tuesday is
-- due a nudge on Friday — and that is the part a sale is lost on. So:
--
--   `client_activities` — one row per contact with a client: a call, a
--   WhatsApp, a meeting, a site visit, a note. Optionally about one project
--   and one quotation. Optionally with a **follow-up**: a date and what to do,
--   ticked off once done with what came of it.
--
-- Append-only by design: a log that can be edited is a log nobody trusts. A
-- follow-up that moves is closed with its result and a new one logged.
--
--   REFUSALS  no summary; an unknown kind; a date in the future; a follow-up
--             before the contact it follows; a project of a different client;
--             a quotation of a different project; closing a follow-up twice;
--             a reader writing
--
-- Reading follows the quotation: `project.read`. Writing is `project.update`,
-- the people who run the sale.

create table ops_procure.client_activities (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid not null references ops_procure.clients(id),
  project_id        uuid references ops_procure.projects(id),
  quotation_id      uuid references ops_procure.quotations(id),
  kind              text not null check (kind in ('call','whatsapp','email','meeting','visit','note')),
  happened_on       date not null,
  summary           text not null check (length(btrim(summary)) > 0),
  follow_up_on      date,
  next_action       text,
  follow_up_done_at timestamptz,
  follow_up_done_by uuid references ops_core.users(id),
  follow_up_result  text,
  created_by        uuid references ops_core.users(id),
  created_at        timestamptz not null default now(),
  constraint follow_up_after_contact check (follow_up_on is null or follow_up_on >= happened_on),
  constraint done_needs_follow_up check (follow_up_done_at is null or follow_up_on is not null)
);
create index client_activities_client_idx on ops_procure.client_activities (client_id, happened_on desc);
create index client_activities_open_idx on ops_procure.client_activities (follow_up_on)
  where follow_up_on is not null and follow_up_done_at is null;

alter table ops_procure.client_activities enable row level security;
create policy client_activities_read on ops_procure.client_activities for select to authenticated
  using (ops_core.has_permission('project.read'));
grant select on ops_procure.client_activities to authenticated;

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
  a.created_at
from ops_procure.client_activities a
join ops_procure.clients c on c.id = a.client_id
left join ops_procure.projects p on p.id = a.project_id
left join ops_procure.quotations q on q.id = a.quotation_id
left join ops_core.users u on u.id = a.created_by
left join ops_core.users d on d.id = a.follow_up_done_by;

alter view ops_procure.v_client_activity set (security_invoker = on);
grant select on ops_procure.v_client_activity to authenticated;

-- ── the seams ────────────────────────────────────────────────────────────

create or replace function ops_procure.log_client_activity(
  p_client_code text, p_kind text, p_summary text,
  p_project_code text default null, p_quote_no text default null,
  p_happened_on date default null, p_follow_up_on date default null, p_next_action text default null,
  p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare c ops_procure.clients; pr ops_procure.projects; qt ops_procure.quotations;
        v_on date := coalesce(p_happened_on, ops_core.office_day()); v_id uuid; res jsonb; replayed jsonb;
begin
  replayed := ops_core.idem_replay('project', 'log_client_activity', p_key);
  if replayed is not null then return replayed; end if;

  if not ops_core.has_permission('project.update') then
    return ops_core.refused('project','client_activity', p_client_code,'create',
      'not_permitted','Mencatat aktivitas klien butuh akses proyek (update).');
  end if;
  if coalesce(p_kind, '') not in ('call','whatsapp','email','meeting','visit','note') then
    return ops_core.invalid('project','client_activity', p_client_code,'create', 'bad_kind',
      'Jenisnya telepon, WhatsApp, email, meeting, kunjungan, atau catatan.', jsonb_build_object('field','kind'));
  end if;
  if coalesce(btrim(p_summary), '') = '' then
    return ops_core.invalid('project','client_activity', p_client_code,'create', 'summary_required',
      'Apa yang dibicarakan? Satu kalimat cukup.', jsonb_build_object('field','summary'));
  end if;
  if v_on > ops_core.office_day() then
    return ops_core.invalid('project','client_activity', p_client_code,'create', 'in_future',
      'Aktivitas dicatat setelah terjadi. Untuk rencana, pakai follow-up.', jsonb_build_object('field','happened_on'));
  end if;
  if p_follow_up_on is not null and p_follow_up_on < v_on then
    return ops_core.invalid('project','client_activity', p_client_code,'create', 'follow_up_before',
      'Follow-up tidak bisa sebelum aktivitasnya.', jsonb_build_object('field','follow_up_on'));
  end if;

  -- The quotation names its project; the project names its client. Each one
  -- given must agree with the one above it.
  if nullif(btrim(p_quote_no), '') is not null then
    select * into qt from ops_procure.quotations where quote_no = btrim(p_quote_no);
    if not found then
      return ops_core.not_found('project','client_activity', p_quote_no,'create', format('Tidak ada quotation %s.', p_quote_no));
    end if;
  end if;
  if nullif(btrim(p_project_code), '') is not null then
    select * into pr from ops_procure.projects where code = btrim(p_project_code);
    if not found then
      return ops_core.not_found('project','client_activity', p_project_code,'create', format('Tidak ada proyek %s.', p_project_code));
    end if;
    if qt.id is not null and qt.project_id <> pr.id then
      return ops_core.invalid('project','client_activity', p_quote_no,'create', 'quote_other_project',
        format('%s bukan quotation proyek %s.', qt.quote_no, pr.code), jsonb_build_object('field','quote_no'));
    end if;
  elsif qt.id is not null then
    select * into pr from ops_procure.projects where id = qt.project_id;
  end if;

  if nullif(btrim(p_client_code), '') is not null then
    select * into c from ops_procure.clients where code = btrim(p_client_code);
    if not found then
      return ops_core.not_found('project','client_activity', p_client_code,'create', format('Tidak ada klien %s.', p_client_code));
    end if;
    if pr.id is not null and pr.client_id is distinct from c.id then
      return ops_core.invalid('project','client_activity', pr.code,'create', 'project_other_client',
        format('Proyek %s bukan milik %s.', pr.code, c.name), jsonb_build_object('field','project_code'));
    end if;
  elsif pr.id is not null then
    select * into c from ops_procure.clients where id = pr.client_id;
    if not found then
      return ops_core.invalid('project','client_activity', pr.code,'create', 'no_client',
        format('Proyek %s belum punya klien. Pilih kliennya di proyek dulu.', pr.code), jsonb_build_object('field','client_code'));
    end if;
  else
    return ops_core.invalid('project','client_activity', null,'create', 'client_required',
      'Dengan klien siapa?', jsonb_build_object('field','client_code'));
  end if;

  insert into ops_procure.client_activities (client_id, project_id, quotation_id, kind, happened_on, summary,
                                             follow_up_on, next_action, created_by)
  values (c.id, pr.id, qt.id, p_kind, v_on, btrim(p_summary),
          p_follow_up_on, nullif(btrim(p_next_action), ''), auth.uid())
  returning id into v_id;
  res := ops_core.ok('project','client_activity', c.code,'create', jsonb_build_object('id', v_id));
  return ops_core.idem_remember('project', 'log_client_activity', p_key, res);
end $$;

create or replace function ops_procure.complete_follow_up(p_activity_id uuid, p_result text default null)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare a ops_procure.client_activities;
begin
  if not ops_core.has_permission('project.update') then
    return ops_core.refused('project','client_activity', null,'follow_up',
      'not_permitted','Menutup follow-up butuh akses proyek (update).');
  end if;
  select * into a from ops_procure.client_activities where id = p_activity_id;
  if not found then
    return ops_core.not_found('project','client_activity', null,'follow_up', 'Aktivitas itu tidak ada.');
  end if;
  if a.follow_up_on is null then
    return ops_core.invalid('project','client_activity', null,'follow_up', 'no_follow_up',
      'Aktivitas ini tidak punya follow-up.', jsonb_build_object('field','follow_up_on'));
  end if;
  if a.follow_up_done_at is not null then
    return ops_core.noop('project','client_activity', null,'follow_up', 'Sudah ditutup.', jsonb_build_object('id', a.id));
  end if;
  update ops_procure.client_activities
     set follow_up_done_at = now(), follow_up_done_by = auth.uid(), follow_up_result = nullif(btrim(p_result), '')
   where id = a.id;
  return ops_core.ok('project','client_activity', null,'follow_up', jsonb_build_object('id', a.id));
end $$;

grant execute on function
  ops_procure.log_client_activity(text, text, text, text, text, date, date, text, text),
  ops_procure.complete_follow_up(uuid, text)
  to authenticated;
revoke execute on function
  ops_procure.log_client_activity(text, text, text, text, text, date, date, text, text),
  ops_procure.complete_follow_up(uuid, text)
  from public;
