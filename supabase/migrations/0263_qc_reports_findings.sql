-- 0263_qc_reports_findings.sql — what a QC sends from the factory: the daily
-- report with its photos and counts, the findings, the check at loading; and
-- what is read from it — the factory's progress on the project board, the
-- days a QC has not reported, whether an order is ready to load (O7, kajian
-- F255 §5.7, D419).
--
--   qc_reports       one visit: the day, the stage (material · construction ·
--                    finishing · packing · loading), a note, photos; at loading,
--                    the container it checked (O5). Withdrawn with a reason,
--                    never deleted.
--   qc_report_lines  per line of the factory order: how many have **passed so
--                    far** and how many were rejected on this visit. Passed is
--                    a running count, not a day's increment, so two QCs on one
--                    order and a re-check do not add up to more than was made
--                    (D419). The latest report is the factory's progress.
--   qc_findings      a defect, a wrong material, a delay, damage, bad packing:
--                    its phase (production · loading · after_arrival — the last
--                    is the client's claim, O8), severity, photos, and OPEN →
--                    RESOLVED with what was done.
--
-- Read, not typed (§5.7):
--   * progress per line = passed at the latest report ÷ ordered; it is the
--     factory's `made` on the project board (0257 left it null for O7);
--   * days without a report on a live assignment — said, not blocked;
--   * ready to load = every line passed in full and no major/critical finding
--     open — a warning when a container is recorded from the order, never a
--     refusal (no-blocking, §6).
--
-- Access, as in 0261 (Q88, F259): a QC reads and writes the reports of **their
-- own** assignment; the findings of an order they watch (they check the fix);
-- the coordinator, leadership and procurement read everything. Lines and
-- progress come through definer functions, because a QC does not read
-- purchase orders — quantities, never prices.
--
-- Photos are uploaded against the assignment, so they land in PROJECT MANAGER
-- `{CLIENT}/{PROJECT}/QC/{YYYY-MM-DD}` (D313, D320), then linked to the report
-- or finding they show.

insert into ops_core.doc_prefixes (prefix, what) values
  ('qcr', 'QC report (laporan QC)'),
  ('qcf', 'QC finding (temuan QC)')
on conflict (prefix) do nothing;

-- ── 1. photos, filed (D313, D320) ─────────────────────────────────────────

insert into ops_core.doc_kind_labels (kind, label) values
  ('foto_qc', 'Foto QC')
on conflict (kind) do nothing;
insert into ops_core.doc_kind_drive (kind, slug, rationale) values
  ('foto_qc', 'project', 'A QC''s photo from the factory — filed with the project the factory is making, by day (O7, §5.7).')
on conflict (kind) do nothing;
insert into ops_core.drive_paths (kind, entity, path, note) values
  ('foto_qc', 'qc_assignment', '{CLIENT}/{PROJECT}/QC/{YYYY-MM-DD}', 'A QC''s photos, per project and day (O7, D313).'),
  ('foto_qc', 'project',       '{CLIENT}/{PROJECT}/QC/{YYYY-MM-DD}', 'A client''s claim photographed after arrival (O8).'),
  ('foto_qc', null,            'QC',                                  null)
on conflict (kind, entity) do nothing;

-- drive_context (0259): a QC assignment's files go under its order's project.
CREATE OR REPLACE FUNCTION ops_procure.drive_context(p_entity text, p_entity_no text)
 RETURNS TABLE(client_folder text, project_folder text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'ops_procure', 'ops_core', 'pg_temp'
AS $function$
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
        or (p_entity = 'delivery' and pr.code = (select d.project_code from ops_dlv.deliveries d
                                                   where d.delivery_no = btrim(p_entity_no)))
        or (p_entity = 'qc_assignment' and pr.id = (select po.project_id from ops_qc.qc_assignments qa
                                                      join ops_procure.purchase_orders po on po.id = qa.po_id
                                                     where qa.assign_no = btrim(p_entity_no)))
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
$function$;

-- ── 2. tables ─────────────────────────────────────────────────────────────

create table if not exists ops_qc.qc_reports (
  id             uuid primary key default gen_random_uuid(),
  report_no      text not null unique,
  assignment_id  uuid not null references ops_qc.qc_assignments(id),
  report_date    date not null,
  stage          text not null check (stage in ('material','construction','finishing','packing','loading')),
  -- The container a loading check was made on (O5). Only at loading.
  delivery_id    uuid references ops_dlv.deliveries(id),
  note           text,
  created_by     uuid,
  created_at     timestamptz not null default now(),
  cancelled_at   timestamptz,
  cancelled_by   uuid,
  cancel_reason  text,
  constraint qc_report_container_at_loading check (delivery_id is null or stage = 'loading')
);
create index if not exists qc_reports_assignment_idx on ops_qc.qc_reports (assignment_id, report_date desc);

-- A line of the factory order by its number: an amended line keeps its
-- number (0016), so progress survives an amendment.
create table if not exists ops_qc.qc_report_lines (
  report_id  uuid not null references ops_qc.qc_reports(id),
  line_no    int not null,
  passed     numeric not null check (passed >= 0),
  rejected   numeric not null default 0 check (rejected >= 0),
  primary key (report_id, line_no)
);

create table if not exists ops_qc.qc_findings (
  id             uuid primary key default gen_random_uuid(),
  finding_no     text not null unique,
  po_id          uuid not null references ops_procure.purchase_orders(id),
  -- Who found it, when a QC did; null for a coordinator's or a client's claim.
  assignment_id  uuid references ops_qc.qc_assignments(id),
  report_id      uuid references ops_qc.qc_reports(id),
  delivery_id    uuid references ops_dlv.deliveries(id),
  line_no        int,
  phase          text not null check (phase in ('production','loading','after_arrival')),
  finding_kind   text not null check (finding_kind in ('defect','spec_mismatch','late','damaged','packing','other')),
  severity       text not null check (severity in ('minor','major','critical')),
  description    text not null check (btrim(description) <> ''),
  status         text not null default 'OPEN' check (status in ('OPEN','RESOLVED')),
  resolution     text,
  resolved_at    timestamptz,
  resolved_by    uuid,
  created_by     uuid,
  created_at     timestamptz not null default now(),
  constraint qc_finding_resolved check ((status = 'RESOLVED') = (resolved_at is not null))
);
create index if not exists qc_findings_po_idx on ops_qc.qc_findings (po_id, status);

-- ── 3. who reads what ─────────────────────────────────────────────────────

-- Is this assignment the signed-in QC's own (or may they see every one)?
create or replace function ops_qc.my_assignment(p_assignment_id uuid)
returns boolean
language sql stable security definer
set search_path = ops_qc, pg_temp
as $$
  select ops_qc.sees_all()
      or exists (select 1 from ops_qc.qc_assignments a
                  where a.id = p_assignment_id and a.cancelled_at is null
                    and a.person_id = ops_qc.my_person_id())
$$;
revoke all on function ops_qc.my_assignment(uuid) from public;
grant execute on function ops_qc.my_assignment(uuid) to authenticated;

alter table ops_qc.qc_reports enable row level security;
alter table ops_qc.qc_report_lines enable row level security;
alter table ops_qc.qc_findings enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'ops_qc' and policyname = 'qc_reports_read') then
    create policy qc_reports_read on ops_qc.qc_reports for select
      using (ops_qc.my_assignment(assignment_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'ops_qc' and policyname = 'qc_report_lines_read') then
    create policy qc_report_lines_read on ops_qc.qc_report_lines for select
      using (exists (select 1 from ops_qc.qc_reports r where r.id = report_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'ops_qc' and policyname = 'qc_findings_read') then
    create policy qc_findings_read on ops_qc.qc_findings for select
      using (ops_qc.may_see_order(po_id));
  end if;
end $$;

grant select on ops_qc.qc_reports, ops_qc.qc_report_lines, ops_qc.qc_findings to authenticated;

-- A QC's hands on the order: the coordinator, or a QC with a live assignment
-- on it. Returns that assignment (null for the coordinator).
create or replace function ops_qc.watching(p_po_id uuid)
returns uuid
language sql stable security definer
set search_path = ops_qc, pg_temp
as $$
  select a.id from ops_qc.qc_assignments a
   where a.po_id = p_po_id and a.cancelled_at is null and a.person_id = ops_qc.my_person_id()
   order by a.starts_on desc
   limit 1
$$;
revoke all on function ops_qc.watching(uuid) from public;
grant execute on function ops_qc.watching(uuid) to authenticated;

-- Link the photos to the record they show. Each must be an uploaded file.
-- Not a definer: it runs inside the seams, as they do, and nowhere else.
create or replace function ops_qc.link_photos(p_ids uuid[], p_entity text, p_entity_no text)
returns int
language plpgsql
set search_path = ops_core, pg_temp
as $$
declare v_n int := 0; v_id uuid;
begin
  foreach v_id in array coalesce(p_ids, '{}') loop
    insert into ops_core.attachment_links (attachment_id, entity, entity_no, kind, linked_by)
    select v_id, p_entity::ops_core.link_entity_t, p_entity_no, 'foto_qc'::ops_core.doc_kind_t, auth.uid()
     where not exists (select 1 from ops_core.attachment_links k
                        where k.attachment_id = v_id and k.entity = p_entity::ops_core.link_entity_t
                          and k.entity_no = p_entity_no and k.unlinked_at is null);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke all on function ops_qc.link_photos(uuid[], text, text) from public;

-- Which of these ids are not uploaded files (null when all are).
create or replace function ops_qc.missing_photo(p_ids uuid[])
returns uuid
language sql stable security definer
set search_path = ops_core, pg_temp
as $$
  select u.want from unnest(coalesce(p_ids, '{}')) u(want)
   where not exists (select 1 from ops_core.attachments t where t.id = u.want)
   limit 1
$$;
revoke all on function ops_qc.missing_photo(uuid[]) from public;
grant execute on function ops_qc.missing_photo(uuid[]) to authenticated;

-- ── 4. what is read ───────────────────────────────────────────────────────

-- Every live line of a factory order with how far QC says it is: passed at
-- the latest report that counted it, what stage that was, rejects over all
-- reports, open findings on the line. Quantities, never prices.
create or replace function ops_qc.line_progress(p_po_id uuid)
returns table (line_no int, description text, qty numeric, uom text,
               passed numeric, qc_stage text, reported_on date, report_no text,
               rejected_total numeric, open_findings int)
language sql stable security definer
set search_path = ops_qc, ops_procure, pg_temp
as $$
  select o.line_no, o.description, o.qty, o.uom,
         lr.passed, lr.stage, lr.report_date, lr.report_no,
         coalesce((select sum(x.rejected) from ops_qc.qc_report_lines x
                     join ops_qc.qc_reports r on r.id = x.report_id
                     join ops_qc.qc_assignments a on a.id = r.assignment_id
                    where a.po_id = o.po_id and x.line_no = o.line_no and r.cancelled_at is null), 0),
         (select count(*)::int from ops_qc.qc_findings f
           where f.po_id = o.po_id and f.line_no = o.line_no and f.status = 'OPEN')
    from ops_procure.po_lines o
    left join lateral (
      select x.passed, r.stage, r.report_date, r.report_no
        from ops_qc.qc_report_lines x
        join ops_qc.qc_reports r on r.id = x.report_id
        join ops_qc.qc_assignments a on a.id = r.assignment_id
       where a.po_id = o.po_id and x.line_no = o.line_no and r.cancelled_at is null
       order by r.report_date desc, r.created_at desc
       limit 1) lr on true
   where o.po_id = p_po_id and o.superseded_by is null
     and (ops_qc.may_see_order(p_po_id)
          or ops_core.has_permission('project.read') or ops_core.has_permission('procurement.read')
          or ops_core.has_permission('production.read') or ops_core.has_permission('delivery.read'))
   order by o.line_no
$$;
revoke all on function ops_qc.line_progress(uuid) from public;
grant execute on function ops_qc.line_progress(uuid) to authenticated;

-- The same, by the assignment a QC holds — the screen knows the assignment,
-- not the order's id.
create or replace function ops_qc.assignment_progress(p_assign_no text)
returns table (line_no int, description text, qty numeric, uom text,
               passed numeric, qc_stage text, reported_on date, report_no text,
               rejected_total numeric, open_findings int)
language sql stable security definer
set search_path = ops_qc, pg_temp
as $$
  select g.* from ops_qc.qc_assignments a
   cross join lateral ops_qc.line_progress(a.po_id) g
   where a.assign_no = btrim(p_assign_no) and ops_qc.my_assignment(a.id)
   order by g.line_no
$$;
revoke all on function ops_qc.assignment_progress(text) from public;
grant execute on function ops_qc.assignment_progress(text) to authenticated;

-- The same, for one client order line on the project board (0257): the
-- factory order it is on, and QC's count there.
create or replace function ops_qc.project_line_qc(p_project_line_id uuid)
returns table (passed numeric, qc_stage text, reported_on date, open_findings int)
language sql stable security definer
set search_path = ops_qc, ops_procure, ops_core, pg_temp
as $$
  select g.passed, g.qc_stage, g.reported_on, g.open_findings
    from ops_procure.po_lines o
    join ops_procure.purchase_orders p on p.id = o.po_id
    cross join lateral ops_qc.line_progress(p.id) g
   where o.project_line_id = p_project_line_id and o.superseded_by is null
     and p.status <> 'CANCELLED' and g.line_no = o.line_no
     and (ops_core.has_permission('project.read') or ops_core.has_permission('procurement.read')
          or ops_core.has_permission('production.read') or ops_core.has_permission('delivery.read')
          or ops_qc.sees_all())
   order by p.created_at desc
   limit 1
$$;
revoke all on function ops_qc.project_line_qc(uuid) from public;
grant execute on function ops_qc.project_line_qc(uuid) to authenticated;

-- What stands between an order and loading (§5.7): lines not passed in full,
-- major or critical findings still open. Said when a container is recorded
-- from the order — only when QC watches it, since without QC there is nothing
-- to say. Definer: logistics does not read QC.
create or replace function ops_qc.load_warnings(p_po_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = ops_qc, ops_procure, pg_temp
as $$
declare v_short text; v_open int; v_warn jsonb := '[]'::jsonb; v_po text;
begin
  if not exists (select 1 from ops_qc.qc_assignments a where a.po_id = p_po_id and a.cancelled_at is null) then
    return v_warn;
  end if;
  select po_no into v_po from ops_procure.purchase_orders where id = p_po_id;
  select string_agg(format('baris %s: %s dari %s', o.line_no, coalesce(lr.passed, 0)::text, o.qty::text), '; ' order by o.line_no)
    into v_short
    from ops_procure.po_lines o
    left join lateral (
      select x.passed from ops_qc.qc_report_lines x
        join ops_qc.qc_reports r on r.id = x.report_id
        join ops_qc.qc_assignments a on a.id = r.assignment_id
       where a.po_id = o.po_id and x.line_no = o.line_no and r.cancelled_at is null
       order by r.report_date desc, r.created_at desc
       limit 1) lr on true
   where o.po_id = p_po_id and o.superseded_by is null and coalesce(lr.passed, 0) < o.qty;
  if v_short is not null then
    v_warn := v_warn || to_jsonb(format('QC belum melaporkan semua baris %s lolos penuh (%s).', v_po, v_short));
  end if;
  select count(*) into v_open from ops_qc.qc_findings f
   where f.po_id = p_po_id and f.status = 'OPEN' and f.severity in ('major','critical');
  if v_open > 0 then
    v_warn := v_warn || to_jsonb(format('Masih ada %s temuan QC major/kritis yang terbuka di %s.', v_open, v_po));
  end if;
  return v_warn;
end $$;
revoke all on function ops_qc.load_warnings(uuid) from public;
grant execute on function ops_qc.load_warnings(uuid) to authenticated;

-- The containers loaded from the order an assignment watches, for the loading
-- check — a QC does not read deliveries.
create or replace function ops_qc.order_containers(p_assign_no text)
returns table (delivery_no text, container_no text, container_size text, loaded_on date, status text)
language sql stable security definer
set search_path = ops_qc, ops_dlv, pg_temp
as $$
  select d.delivery_no, d.container_no, d.container_size, d.dispatched_on, d.status::text
    from ops_qc.qc_assignments a
    join ops_dlv.deliveries d on d.po_id = a.po_id and d.delivery_mode = 'container' and d.status <> 'CANCELLED'
   where a.assign_no = btrim(p_assign_no) and ops_qc.my_assignment(a.id)
   order by d.dispatched_on desc, d.delivery_no desc
$$;
revoke all on function ops_qc.order_containers(text) from public;
grant execute on function ops_qc.order_containers(text) to authenticated;

-- The lines of one report, with what the order asked for.
create or replace function ops_qc.report_lines(p_report_no text)
returns table (line_no int, description text, qty numeric, uom text, passed numeric, rejected numeric)
language sql stable security definer
set search_path = ops_qc, ops_procure, pg_temp
as $$
  select x.line_no, o.description, o.qty, o.uom, x.passed, x.rejected
    from ops_qc.qc_reports r
    join ops_qc.qc_assignments a on a.id = r.assignment_id
    join ops_qc.qc_report_lines x on x.report_id = r.id
    left join ops_procure.po_lines o on o.po_id = a.po_id and o.line_no = x.line_no and o.superseded_by is null
   where r.report_no = btrim(p_report_no) and ops_qc.my_assignment(r.assignment_id)
   order by x.line_no
$$;
revoke all on function ops_qc.report_lines(text) from public;
grant execute on function ops_qc.report_lines(text) to authenticated;

-- A delivery's container number, for a reader of QC who may not read
-- deliveries — gated by the order it was loaded from.
create or replace function ops_qc.container_label(p_delivery_id uuid)
returns text
language sql stable security definer
set search_path = ops_qc, ops_dlv, pg_temp
as $$
  select coalesce(d.container_no, d.delivery_no) from ops_dlv.deliveries d
   where d.id = p_delivery_id and d.po_id is not null and ops_qc.may_see_order(d.po_id)
$$;
revoke all on function ops_qc.container_label(uuid) from public;
grant execute on function ops_qc.container_label(uuid) to authenticated;

-- One line's description, for a finding that names it.
create or replace function ops_qc.line_label(p_po_id uuid, p_line_no int)
returns text
language sql stable security definer
set search_path = ops_qc, ops_procure, pg_temp
as $$
  select o.description from ops_procure.po_lines o
   where o.po_id = p_po_id and o.line_no = p_line_no and o.superseded_by is null
     and ops_qc.may_see_order(p_po_id)
$$;
revoke all on function ops_qc.line_label(uuid, int) from public;
grant execute on function ops_qc.line_label(uuid, int) to authenticated;

-- ── 5. seams ──────────────────────────────────────────────────────────────

-- One visit's report, from the QC's phone. Lines are [{line_no, passed,
-- rejected}]: passed is how many have passed **so far**, rejected is this
-- visit's. A report may carry no lines — the material check is photos and a
-- note.
create or replace function ops_qc.submit_qc_report(
  p_assign_no text, p_report_date date, p_stage text, p_lines jsonb default '[]'::jsonb,
  p_note text default null, p_delivery_no text default null, p_photo_ids uuid[] default null,
  p_key text default null)
returns jsonb
language plpgsql security definer
set search_path = ops_qc, ops_procure, ops_core, pg_temp
as $$
declare
  a ops_qc.qc_assignments; v_stage text; v_dlv uuid; v_no text; v_rid uuid; v_bad text;
  v_warn jsonb := '[]'::jsonb; v_lines jsonb := coalesce(p_lines, '[]'::jsonb); res jsonb; replayed jsonb;
begin
  replayed := ops_core.idem_replay('qc','submit_qc_report', p_key);
  if replayed is not null then return replayed; end if;
  select * into a from ops_qc.qc_assignments where assign_no = btrim(p_assign_no);
  if not found then
    return ops_core.not_found('qc','qc_report', null,'submit', format('Tidak ada penugasan %s.', p_assign_no));
  end if;
  if not (ops_qc.is_coordinator() or a.person_id is not distinct from ops_qc.my_person_id()) then
    return ops_core.refused('qc','qc_report', null,'submit',
      'not_permitted','Laporan QC dikirim oleh QC yang ditugaskan atau koordinator QC.');
  end if;
  if a.cancelled_at is not null then
    return ops_core.conflict('qc','qc_report', null,'submit', 'assignment_cancelled', 'Penugasan ini sudah dibatalkan.');
  end if;
  if p_report_date is null then
    return ops_core.invalid('qc','qc_report', null,'submit', 'date_required', 'Laporan tanggal berapa?',
      jsonb_build_object('field','report_date'));
  end if;
  if p_report_date > ops_core.office_day() then
    return ops_core.invalid('qc','qc_report', null,'submit', 'date_in_future', 'Laporan tidak bisa untuk hari yang belum datang.',
      jsonb_build_object('field','report_date'));
  end if;
  if p_report_date < a.starts_on or (a.ends_on is not null and p_report_date > a.ends_on) then
    return ops_core.invalid('qc','qc_report', null,'submit', 'outside_assignment',
      format('Penugasan ini %s sampai %s.', a.starts_on, coalesce(a.ends_on::text, 'sekarang')),
      jsonb_build_object('field','report_date'));
  end if;
  v_stage := lower(btrim(coalesce(p_stage, '')));
  if v_stage not in ('material','construction','finishing','packing','loading') then
    return ops_core.invalid('qc','qc_report', null,'submit', 'unknown_stage',
      'Tahapnya bahan, konstruksi, finishing, packing, atau muat.', jsonb_build_object('field','stage'));
  end if;
  if jsonb_typeof(v_lines) <> 'array' then
    return ops_core.invalid('qc','qc_report', null,'submit', 'bad_lines', 'Baris laporan tidak terbaca.',
      jsonb_build_object('field','lines'));
  end if;

  -- Every line: of this order, once, passed within what was ordered.
  select format('baris %s', e->>'line_no') into v_bad
    from jsonb_array_elements(v_lines) e
   where (e->>'line_no') !~ '^[0-9]+$'
      or not exists (select 1 from ops_procure.po_lines o
                      where o.po_id = a.po_id and o.superseded_by is null and o.line_no = (e->>'line_no')::int)
   limit 1;
  if v_bad is not null then
    return ops_core.invalid('qc','qc_report', null,'submit', 'line_not_on_order',
      format('%s tidak ada di order ini.', initcap(v_bad)), jsonb_build_object('field','lines'));
  end if;
  if (select count(*) from jsonb_array_elements(v_lines)) <> (select count(distinct e->>'line_no') from jsonb_array_elements(v_lines) e) then
    return ops_core.invalid('qc','qc_report', null,'submit', 'line_twice', 'Satu baris dilaporkan sekali per laporan.',
      jsonb_build_object('field','lines'));
  end if;
  select format('Baris %s', e->>'line_no') into v_bad
    from jsonb_array_elements(v_lines) e
   where coalesce(e->>'passed', '0') !~ '^[0-9]+(\.[0-9]+)?$' or coalesce(e->>'rejected', '0') !~ '^[0-9]+(\.[0-9]+)?$'
   limit 1;
  if v_bad is not null then
    return ops_core.invalid('qc','qc_report', null,'submit', 'bad_count',
      format('%s: jumlah lolos dan ditolak adalah angka, tidak negatif.', v_bad), jsonb_build_object('field','lines'));
  end if;
  select format('Baris %s: lolos %s, dipesan %s.', o.line_no, (e->>'passed'), o.qty) into v_bad
    from jsonb_array_elements(v_lines) e
    join ops_procure.po_lines o on o.po_id = a.po_id and o.superseded_by is null and o.line_no = (e->>'line_no')::int
   where coalesce((e->>'passed')::numeric, 0) > o.qty
   limit 1;
  if v_bad is not null then
    return ops_core.invalid('qc','qc_report', null,'submit', 'passed_over_ordered',
      v_bad || ' Lolos adalah jumlah yang sudah lolos sampai hari ini, tidak lebih dari yang dipesan.',
      jsonb_build_object('field','lines'));
  end if;

  if nullif(btrim(p_delivery_no), '') is not null then
    if v_stage <> 'loading' then
      return ops_core.invalid('qc','qc_report', null,'submit', 'container_only_at_loading',
        'Kontainer disebut pada laporan tahap muat.', jsonb_build_object('field','delivery_no'));
    end if;
    select d.id into v_dlv from ops_dlv.deliveries d
     where d.delivery_no = btrim(p_delivery_no) and d.po_id = a.po_id
       and d.delivery_mode = 'container' and d.status <> 'CANCELLED';
    if v_dlv is null then
      return ops_core.invalid('qc','qc_report', null,'submit', 'container_not_this_order',
        format('%s bukan kontainer dari order ini.', btrim(p_delivery_no)), jsonb_build_object('field','delivery_no'));
    end if;
  elsif v_stage = 'loading' then
    v_warn := v_warn || to_jsonb('Laporan muat tanpa kontainer — sebutkan kontainernya setelah logistik mencatatnya.'::text);
  end if;
  if ops_qc.missing_photo(p_photo_ids) is not null then
    return ops_core.invalid('qc','qc_report', null,'submit', 'no_such_file', 'Ada foto yang belum terunggah. Unggah lagi.',
      jsonb_build_object('field','photo_ids'));
  end if;
  if coalesce(cardinality(p_photo_ids), 0) = 0 then
    v_warn := v_warn || to_jsonb('Laporan tanpa foto. Foto bisa ditambahkan sesudahnya.'::text);
  end if;
  if exists (select 1 from jsonb_array_elements(v_lines) e
              cross join lateral ops_qc.line_progress(a.po_id) g
             where g.line_no = (e->>'line_no')::int and g.qc_stage = v_stage
               and coalesce((e->>'passed')::numeric, 0) < g.passed) then
    v_warn := v_warn || to_jsonb('Ada baris yang lolosnya lebih kecil dari laporan sebelumnya di tahap yang sama — lolos adalah jumlah sampai hari ini, bukan tambahan hari ini.'::text);
  end if;

  v_no := ops_core.next_doc_number('qcr');
  insert into ops_qc.qc_reports (report_no, assignment_id, report_date, stage, delivery_id, note, created_by)
  values (v_no, a.id, p_report_date, v_stage, v_dlv, nullif(btrim(p_note), ''), auth.uid())
  returning id into v_rid;
  insert into ops_qc.qc_report_lines (report_id, line_no, passed, rejected)
  select v_rid, (e->>'line_no')::int, coalesce((e->>'passed')::numeric, 0), coalesce((e->>'rejected')::numeric, 0)
    from jsonb_array_elements(v_lines) e;
  perform ops_qc.link_photos(p_photo_ids, 'qc_report', v_no);

  perform ops_core.emit('qc','qc.report.submitted', v_no,
    jsonb_build_object('report_no', v_no, 'assign_no', a.assign_no, 'report_date', p_report_date, 'stage', v_stage,
                       'lines', jsonb_array_length(v_lines), 'photos', coalesce(cardinality(p_photo_ids), 0)));
  res := ops_core.ok('qc','qc_report', v_no,'submit',
    jsonb_build_object('report_no', v_no, 'warnings', v_warn));
  return ops_core.idem_remember('qc','submit_qc_report', p_key, res);
end $$;
revoke all on function ops_qc.submit_qc_report(text, date, text, jsonb, text, text, uuid[], text) from public;
grant execute on function ops_qc.submit_qc_report(text, date, text, jsonb, text, text, uuid[], text) to authenticated;

-- More photos on a report already sent — the signal was bad at the factory.
create or replace function ops_qc.add_qc_report_photos(p_report_no text, p_photo_ids uuid[])
returns jsonb
language plpgsql security definer
set search_path = ops_qc, ops_core, pg_temp
as $$
declare r ops_qc.qc_reports; a ops_qc.qc_assignments; v_n int;
begin
  select * into r from ops_qc.qc_reports where report_no = btrim(p_report_no);
  if not found then
    return ops_core.not_found('qc','qc_report', p_report_no,'add_photos', format('Tidak ada laporan %s.', p_report_no));
  end if;
  select * into a from ops_qc.qc_assignments where id = r.assignment_id;
  if not (ops_qc.is_coordinator() or a.person_id is not distinct from ops_qc.my_person_id()) then
    return ops_core.refused('qc','qc_report', r.report_no,'add_photos',
      'not_permitted','Foto laporan ditambahkan oleh QC yang ditugaskan atau koordinator QC.');
  end if;
  if r.cancelled_at is not null then
    return ops_core.conflict('qc','qc_report', r.report_no,'add_photos', 'report_cancelled', 'Laporan ini sudah ditarik.');
  end if;
  if coalesce(cardinality(p_photo_ids), 0) = 0 then
    return ops_core.invalid('qc','qc_report', r.report_no,'add_photos', 'no_photos', 'Foto mana?',
      jsonb_build_object('field','photo_ids'));
  end if;
  if ops_qc.missing_photo(p_photo_ids) is not null then
    return ops_core.invalid('qc','qc_report', r.report_no,'add_photos', 'no_such_file', 'Ada foto yang belum terunggah. Unggah lagi.',
      jsonb_build_object('field','photo_ids'));
  end if;
  v_n := ops_qc.link_photos(p_photo_ids, 'qc_report', r.report_no);
  perform ops_core.emit('qc','qc.report.photos', r.report_no, jsonb_build_object('report_no', r.report_no, 'photos', v_n));
  return ops_core.ok('qc','qc_report', r.report_no,'add_photos', jsonb_build_object('report_no', r.report_no, 'photos', v_n));
end $$;
revoke all on function ops_qc.add_qc_report_photos(text, uuid[]) from public;
grant execute on function ops_qc.add_qc_report_photos(text, uuid[]) to authenticated;

-- A wrong report withdrawn with a reason — kept, and no longer counted.
create or replace function ops_qc.cancel_qc_report(p_report_no text, p_reason text)
returns jsonb
language plpgsql security definer
set search_path = ops_qc, ops_core, pg_temp
as $$
declare r ops_qc.qc_reports; a ops_qc.qc_assignments;
begin
  select * into r from ops_qc.qc_reports where report_no = btrim(p_report_no);
  if not found then
    return ops_core.not_found('qc','qc_report', p_report_no,'cancel', format('Tidak ada laporan %s.', p_report_no));
  end if;
  select * into a from ops_qc.qc_assignments where id = r.assignment_id;
  if not (ops_qc.is_coordinator() or a.person_id is not distinct from ops_qc.my_person_id()) then
    return ops_core.refused('qc','qc_report', r.report_no,'cancel',
      'not_permitted','Laporan ditarik oleh QC yang mengirimnya atau koordinator QC.');
  end if;
  if r.cancelled_at is not null then
    return ops_core.conflict('qc','qc_report', r.report_no,'cancel', 'already_cancelled', 'Laporan ini sudah ditarik.');
  end if;
  if nullif(btrim(p_reason), '') is null then
    return ops_core.invalid('qc','qc_report', r.report_no,'cancel', 'reason_required', 'Kenapa ditarik?',
      jsonb_build_object('field','reason'));
  end if;
  update ops_qc.qc_reports set cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = btrim(p_reason)
   where id = r.id;
  perform ops_core.emit('qc','qc.report.cancelled', r.report_no,
    jsonb_build_object('report_no', r.report_no, 'reason', btrim(p_reason)));
  return ops_core.ok('qc','qc_report', r.report_no,'cancel', jsonb_build_object('report_no', r.report_no));
end $$;
revoke all on function ops_qc.cancel_qc_report(text, text) from public;
grant execute on function ops_qc.cancel_qc_report(text, text) to authenticated;

-- A finding on a factory order. At production and loading: a QC watching the
-- order, or the coordinator. After arrival (the client's claim, O8): the
-- coordinator or whoever runs the project.
create or replace function ops_qc.raise_qc_finding(
  p_po_no text, p_phase text, p_kind text, p_severity text, p_description text,
  p_line_no int default null, p_report_no text default null, p_delivery_no text default null,
  p_photo_ids uuid[] default null, p_key text default null)
returns jsonb
language plpgsql security definer
set search_path = ops_qc, ops_procure, ops_core, pg_temp
as $$
declare
  po ops_procure.purchase_orders; v_phase text; v_kind text; v_sev text; v_asg uuid; v_rid uuid; v_dlv uuid;
  v_no text; res jsonb; replayed jsonb;
begin
  replayed := ops_core.idem_replay('qc','raise_qc_finding', p_key);
  if replayed is not null then return replayed; end if;
  select * into po from ops_procure.purchase_orders where po_no = btrim(p_po_no);
  if not found or po.project_id is null then
    return ops_core.invalid('qc','qc_finding', null,'raise', 'order_unknown',
      format('Tidak ada order pabrik %s.', coalesce(p_po_no, '—')), jsonb_build_object('field','po_no'));
  end if;
  v_phase := lower(btrim(coalesce(p_phase, '')));
  if v_phase not in ('production','loading','after_arrival') then
    return ops_core.invalid('qc','qc_finding', null,'raise', 'unknown_phase',
      'Fasenya produksi, muat, atau setelah sampai.', jsonb_build_object('field','phase'));
  end if;
  v_asg := ops_qc.watching(po.id);
  if v_phase = 'after_arrival' then
    if not (ops_qc.is_coordinator() or ops_core.has_permission('project.update')) then
      return ops_core.refused('qc','qc_finding', null,'raise',
        'not_permitted','Klaim klien dicatat oleh koordinator QC atau pengelola proyek.');
    end if;
  elsif not (ops_qc.is_coordinator() or v_asg is not null) then
    return ops_core.refused('qc','qc_finding', null,'raise',
      'not_permitted','Temuan dicatat oleh QC yang memantau order ini atau koordinator QC.');
  end if;
  v_kind := lower(btrim(coalesce(p_kind, '')));
  if v_kind not in ('defect','spec_mismatch','late','damaged','packing','other') then
    return ops_core.invalid('qc','qc_finding', null,'raise', 'unknown_kind',
      'Jenisnya cacat, bahan/spek tidak sesuai, telat, rusak, packing, atau lainnya.', jsonb_build_object('field','kind'));
  end if;
  v_sev := lower(btrim(coalesce(p_severity, '')));
  if v_sev not in ('minor','major','critical') then
    return ops_core.invalid('qc','qc_finding', null,'raise', 'unknown_severity',
      'Tingkatnya minor, major, atau kritis.', jsonb_build_object('field','severity'));
  end if;
  if nullif(btrim(p_description), '') is null then
    return ops_core.invalid('qc','qc_finding', null,'raise', 'description_required', 'Apa temuannya?',
      jsonb_build_object('field','description'));
  end if;
  if p_line_no is not null and not exists (select 1 from ops_procure.po_lines o
                                            where o.po_id = po.id and o.superseded_by is null and o.line_no = p_line_no) then
    return ops_core.invalid('qc','qc_finding', null,'raise', 'line_not_on_order',
      format('Baris %s tidak ada di %s.', p_line_no, po.po_no), jsonb_build_object('field','line_no'));
  end if;
  if nullif(btrim(p_report_no), '') is not null then
    select r.id into v_rid from ops_qc.qc_reports r join ops_qc.qc_assignments a on a.id = r.assignment_id
     where r.report_no = btrim(p_report_no) and a.po_id = po.id;
    if v_rid is null then
      return ops_core.invalid('qc','qc_finding', null,'raise', 'report_not_this_order',
        format('%s bukan laporan order ini.', btrim(p_report_no)), jsonb_build_object('field','report_no'));
    end if;
  end if;
  if nullif(btrim(p_delivery_no), '') is not null then
    select d.id into v_dlv from ops_dlv.deliveries d
     where d.delivery_no = btrim(p_delivery_no) and d.po_id = po.id and d.delivery_mode = 'container';
    if v_dlv is null then
      return ops_core.invalid('qc','qc_finding', null,'raise', 'container_not_this_order',
        format('%s bukan kontainer dari order ini.', btrim(p_delivery_no)), jsonb_build_object('field','delivery_no'));
    end if;
  end if;
  if ops_qc.missing_photo(p_photo_ids) is not null then
    return ops_core.invalid('qc','qc_finding', null,'raise', 'no_such_file', 'Ada foto yang belum terunggah. Unggah lagi.',
      jsonb_build_object('field','photo_ids'));
  end if;

  v_no := ops_core.next_doc_number('qcf');
  insert into ops_qc.qc_findings (finding_no, po_id, assignment_id, report_id, delivery_id, line_no, phase,
                                  finding_kind, severity, description, created_by)
  values (v_no, po.id, v_asg, v_rid, v_dlv, p_line_no, v_phase, v_kind, v_sev, btrim(p_description), auth.uid());
  perform ops_qc.link_photos(p_photo_ids, 'qc_finding', v_no);

  perform ops_core.emit('qc','qc.finding.raised', v_no,
    jsonb_build_object('finding_no', v_no, 'po_no', po.po_no, 'phase', v_phase, 'kind', v_kind,
                       'severity', v_sev, 'line_no', p_line_no));
  res := ops_core.ok('qc','qc_finding', v_no,'raise', jsonb_build_object('finding_no', v_no, 'po_no', po.po_no));
  return ops_core.idem_remember('qc','raise_qc_finding', p_key, res);
end $$;
revoke all on function ops_qc.raise_qc_finding(text, text, text, text, text, int, text, text, uuid[], text) from public;
grant execute on function ops_qc.raise_qc_finding(text, text, text, text, text, int, text, text, uuid[], text) to authenticated;

-- Closed with what was done about it — reworked, replaced, accepted by the
-- client. Kept: the evaluation (O9) reads findings before shipping against
-- claims after arrival.
create or replace function ops_qc.resolve_qc_finding(p_finding_no text, p_resolution text)
returns jsonb
language plpgsql security definer
set search_path = ops_qc, ops_core, pg_temp
as $$
declare f ops_qc.qc_findings;
begin
  select * into f from ops_qc.qc_findings where finding_no = btrim(p_finding_no);
  if not found then
    return ops_core.not_found('qc','qc_finding', p_finding_no,'resolve', format('Tidak ada temuan %s.', p_finding_no));
  end if;
  if not (ops_qc.is_coordinator() or ops_qc.watching(f.po_id) is not null
          or (f.phase = 'after_arrival' and ops_core.has_permission('project.update'))) then
    return ops_core.refused('qc','qc_finding', f.finding_no,'resolve',
      'not_permitted','Temuan ditutup oleh QC yang memantau order ini atau koordinator QC.');
  end if;
  if f.status = 'RESOLVED' then
    return ops_core.conflict('qc','qc_finding', f.finding_no,'resolve', 'already_resolved', 'Temuan ini sudah selesai.');
  end if;
  if nullif(btrim(p_resolution), '') is null then
    return ops_core.invalid('qc','qc_finding', f.finding_no,'resolve', 'resolution_required',
      'Apa tindakannya — diperbaiki, diganti, diterima klien?', jsonb_build_object('field','resolution'));
  end if;
  update ops_qc.qc_findings
     set status = 'RESOLVED', resolution = btrim(p_resolution), resolved_at = now(), resolved_by = auth.uid()
   where id = f.id;
  perform ops_core.emit('qc','qc.finding.resolved', f.finding_no,
    jsonb_build_object('finding_no', f.finding_no, 'resolution', btrim(p_resolution)));
  return ops_core.ok('qc','qc_finding', f.finding_no,'resolve', jsonb_build_object('finding_no', f.finding_no));
end $$;
revoke all on function ops_qc.resolve_qc_finding(text, text) from public;
grant execute on function ops_qc.resolve_qc_finding(text, text) to authenticated;

-- A container recorded from a factory order QC watches says what QC has not
-- passed yet (§5.7). 0259's body, plus the readiness warnings.
create or replace function ops_dlv.create_container(
  p_project_code text, p_loaded_on date, p_lines jsonb, p_container_no text,
  p_seal_no text default null, p_container_size text default null, p_po_no text default null,
  p_etd date default null, p_eta date default null, p_bl_no text default null,
  p_note text default null, p_key text default null)
returns jsonb
language plpgsql security definer
set search_path = ops_dlv, ops_procure, ops_core, pg_temp
as $$
declare
  v_no text; v_size text; po ops_procure.purchase_orders; pr ops_procure.projects;
  v_bad jsonb; v_off text; r jsonb; v_dno text; res jsonb; replayed jsonb; v_warn jsonb := '[]'::jsonb;
begin
  replayed := ops_core.idem_replay('delivery','create_container', p_key);
  if replayed is not null then return replayed; end if;
  if not ops_core.has_permission('delivery.create') then
    return ops_core.refused('delivery','delivery', null,'load_container',
      'not_permitted','Mencatat kontainer butuh akses pengiriman (create).');
  end if;
  select * into pr from ops_procure.projects where code = p_project_code;
  if not found then
    return ops_core.not_found('delivery','delivery', null,'load_container', format('Tidak ada proyek %s.', p_project_code));
  end if;

  v_no := ops_dlv.container_no_clean(p_container_no);
  v_size := nullif(upper(btrim(coalesce(p_container_size, ''))), '');
  v_bad := ops_dlv.container_fields_refusal(null, 'load_container', v_no, v_size, p_etd, p_eta);
  if v_bad is not null then return v_bad; end if;

  -- The factory order it was loaded from: this project's, and live. The lines
  -- it carries are that order's lines.
  if nullif(btrim(p_po_no), '') is not null then
    select * into po from ops_procure.purchase_orders where po_no = btrim(p_po_no);
    if not found or po.project_id is distinct from pr.id then
      return ops_core.invalid('delivery','delivery', null,'load_container', 'po_not_this_project',
        format('%s bukan order pabrik proyek %s.', btrim(p_po_no), pr.code), jsonb_build_object('field','po_no'));
    end if;
    if po.status = 'CANCELLED' then
      return ops_core.conflict('delivery','delivery', null,'load_container', 'po_cancelled',
        format('%s sudah dibatalkan.', po.po_no));
    end if;
    select pl.line_no::text into v_off
      from jsonb_array_elements(coalesce(p_lines, '[]')) e
      join ops_procure.project_lines pl on pl.id = case when (e->>'project_line_id') ~ '^[0-9a-f-]{36}$'
                                                        then (e->>'project_line_id')::uuid end
     where not exists (select 1 from ops_procure.po_lines o
                        where o.po_id = po.id and o.superseded_by is null and o.project_line_id = pl.id)
     limit 1;
    if v_off is not null then
      return ops_core.invalid('delivery','delivery', null,'load_container', 'line_not_on_order',
        format('Baris %s tidak ada di %s. Kontainer dari satu order pabrik memuat baris order itu.', v_off, po.po_no),
        jsonb_build_object('field','lines'));
    end if;
  end if;

  r := ops_dlv.create_delivery(pr.code, p_loaded_on, p_lines, null, null, p_note, null, null);
  if not ops_core.said_ok(r) then return r; end if;
  v_dno := r->'data'->>'delivery_no';

  update ops_dlv.deliveries
     set delivery_mode = 'container', po_id = po.id, container_no = v_no,
         seal_no = nullif(upper(btrim(p_seal_no)), ''), container_size = v_size,
         etd = p_etd, eta = p_eta, bl_no = nullif(upper(btrim(p_bl_no)), '')
   where delivery_no = v_dno;

  if ops_dlv.container_check_digit(v_no) <> right(v_no, 1)::int then
    v_warn := v_warn || to_jsonb(format('Angka terakhir %s tidak cocok dengan rumus ISO (seharusnya %s). Cek lagi foto pintu kontainernya.',
                                        v_no, ops_dlv.container_check_digit(v_no)));
  end if;
  -- Ready to load? Said, never refused (§5.7, O7).
  if po.id is not null then
    v_warn := v_warn || ops_qc.load_warnings(po.id);
  end if;

  perform ops_core.emit('delivery','delivery.container.loaded', v_dno,
    jsonb_build_object('delivery_no', v_dno, 'project_code', pr.code, 'container_no', v_no,
                       'po_no', po.po_no, 'etd', p_etd, 'eta', p_eta));
  res := ops_core.ok('delivery','delivery', v_dno,'load_container',
    jsonb_build_object('delivery_no', v_dno, 'container_no', v_no,
                       'project_moved', (r->'data'->>'project_moved')::boolean, 'warnings', v_warn));
  return ops_core.idem_remember('delivery','create_container', p_key, res);
end $$;
revoke all on function ops_dlv.create_container(text, date, jsonb, text, text, text, text, date, date, text, text, text) from public;
grant execute on function ops_dlv.create_container(text, date, jsonb, text, text, text, text, date, date, text, text, text) to authenticated;

-- ── 6. views ──────────────────────────────────────────────────────────────

-- Every report a reader may see: its assignment's person and order, its
-- counts and photos.
create or replace view ops_qc.v_qc_report with (security_invoker = on) as
select r.id, r.report_no, r.report_date, r.stage, r.note, r.created_at,
       r.cancelled_at, r.cancel_reason,
       a.assign_no, p.code as person_code, p.name as person_name,
       p.user_id = auth.uid() as is_mine,
       o.po_no, o.vendor_name, o.project_code, o.project_name,
       ops_qc.container_label(r.delivery_id) as container_no,
       (select count(*)::int from ops_qc.qc_report_lines x where x.report_id = r.id) as line_count,
       (select coalesce(sum(x.passed), 0) from ops_qc.qc_report_lines x where x.report_id = r.id) as passed_total,
       (select coalesce(sum(x.rejected), 0) from ops_qc.qc_report_lines x where x.report_id = r.id) as rejected_total,
       (select count(*)::int from ops_core.attachment_links k
         where k.entity = 'qc_report' and k.entity_no = r.report_no and k.unlinked_at is null) as photo_count
  from ops_qc.qc_reports r
  join ops_qc.qc_assignments a on a.id = r.assignment_id
  join ops_qc.qc_people p on p.id = a.person_id
  left join lateral ops_qc.order_of(a.po_id) o on true;

-- Every finding a reader may see.
--   phase     production · loading · after_arrival
--   kind      defect · spec_mismatch · late · damaged · packing · other
--   severity  minor · major · critical
create or replace view ops_qc.v_qc_finding with (security_invoker = on) as
select f.id, f.finding_no, f.phase, f.finding_kind, f.severity, f.description, f.status,
       f.resolution, f.resolved_at, f.created_at,
       f.line_no, ops_qc.line_label(f.po_id, f.line_no) as line_description,
       o.po_no, o.vendor_name, o.project_code, o.project_name,
       r.report_no,
       ops_qc.container_label(f.delivery_id) as container_no,
       coalesce(qp.name, u.full_name) as raised_by_name,
       ru.full_name as resolved_by_name,
       (select count(*)::int from ops_core.attachment_links k
         where k.entity = 'qc_finding' and k.entity_no = f.finding_no and k.unlinked_at is null) as photo_count
  from ops_qc.qc_findings f
  left join lateral ops_qc.order_of(f.po_id) o on true
  left join ops_qc.qc_reports r on r.id = f.report_id
  left join ops_qc.qc_assignments qa on qa.id = f.assignment_id
  left join ops_qc.qc_people qp on qp.id = qa.person_id
  left join ops_core.users u on u.id = f.created_by
  left join ops_core.users ru on ru.id = f.resolved_by;

-- 0261's assignments, with when each last reported and what is open on its
-- order. Columns appended; the rest unchanged.
--   days_without_report  on a live assignment: today − the last report's day
--                        (or the day before it started). Said, not blocked.
create or replace view ops_qc.v_qc_assignment with (security_invoker = on) as
select a.id, a.assign_no, a.starts_on, a.ends_on, a.note, a.created_at,
       a.cancelled_at, a.cancel_reason,
       p.code as person_code, p.name as person_name, p.phone as person_phone, p.city as person_city,
       p.user_id = auth.uid() as is_mine,
       o.po_no, o.po_status, o.vendor_name, o.vendor_address, o.project_code, o.project_name, o.client_name,
       o.expected_delivery, o.issued_at, o.line_count, o.container_count,
       case when a.cancelled_at is not null then 'CANCELLED'
            when a.starts_on > ops_core.office_day() then 'PLANNED'
            when a.ends_on is not null and a.ends_on < ops_core.office_day() then 'ENDED'
            else 'ACTIVE' end as state,
       lr.last_report_on,
       coalesce(lr.report_count, 0) as report_count,
       case when a.cancelled_at is null and a.starts_on <= ops_core.office_day()
                 and (a.ends_on is null or a.ends_on >= ops_core.office_day())
            then ops_core.office_day() - coalesce(lr.last_report_on, a.starts_on - 1) end as days_without_report,
       (select count(*)::int from ops_qc.qc_findings f where f.po_id = a.po_id and f.status = 'OPEN') as open_findings
  from ops_qc.qc_assignments a
  join ops_qc.qc_people p on p.id = a.person_id
  left join lateral ops_qc.order_of(a.po_id) o on true
  left join lateral (
    select max(r.report_date) as last_report_on, count(*)::int as report_count
      from ops_qc.qc_reports r
     where r.assignment_id = a.id and r.cancelled_at is null) lr on true;

grant select on ops_qc.v_qc_report, ops_qc.v_qc_finding, ops_qc.v_qc_assignment to authenticated;

-- 0257's board per project: a factory line's `made` is now QC's passed count,
-- and its stage MADE once QC has passed it in full. Columns appended.
create or replace view ops_procure.v_project_production with (security_invoker = on) as
select pl.project_code,
       p.name as project_name,
       p.status as project_status,
       p.is_active as project_is_active,
       pl.id as project_line_id,
       pl.line_no,
       pl.product_code,
       pl.description,
       pl.qty,
       pl.uom,
       pl.delivery_date,
       pl.route,
       pl.design_item_no,
       pl.job_order_count,
       pl.job_order_open,
       case when pl.route = 'WORKSHOP' then f.made else q.passed end as made,
       pl.factory_po_no,
       pl.factory_po_status,
       pl.factory_vendor_name,
       pl.factory_expected_delivery,
       coalesce(f.delivered, 0::numeric) as delivered,
       coalesce(f.arrived, 0::numeric) as arrived,
       coalesce(f.installed, 0::numeric) as installed,
       case
         when coalesce(f.arrived, 0) >= pl.qty then 'ARRIVED'
         when coalesce(f.delivered, 0) >= pl.qty then 'SHIPPED'
         when pl.route = 'WORKSHOP' then
           case when pl.job_order_count = 0 and f.made is null then 'NO_JOB_ORDER'
                when coalesce(f.made, 0) >= pl.qty then 'MADE'
                else 'IN_WORK' end
         when pl.factory_po_no is null then 'NO_FACTORY_ORDER'
         when pl.factory_po_status = 'DRAFT' then 'ORDER_DRAFT'
         when coalesce(q.passed, 0) >= pl.qty then 'MADE'
         else 'AT_FACTORY'
       end as stage,
       case
         when pl.route = 'FACTORY' and pl.factory_expected_delivery is not null
              and pl.factory_po_status = 'ISSUED'
              and coalesce(f.delivered, 0) < pl.qty
              and ops_core.office_day() > pl.factory_expected_delivery
         then ops_core.office_day() - pl.factory_expected_delivery
       end as factory_days_late,
       case when pl.route = 'FACTORY' then q.qc_stage end as qc_stage,
       case when pl.route = 'FACTORY' then q.reported_on end as qc_reported_on,
       case when pl.route = 'FACTORY' then coalesce(q.open_findings, 0) end as qc_open_findings
  from ops_procure.v_project_line pl
  join ops_procure.projects p on p.id = pl.project_id
  left join ops_dlv.v_fulfilment_line f on f.project_line_id = pl.id
  left join lateral ops_qc.project_line_qc(pl.id) q on pl.route = 'FACTORY';

grant select on ops_procure.v_project_production to authenticated;

analyze ops_qc.qc_reports;
analyze ops_qc.qc_report_lines;
analyze ops_qc.qc_findings;
