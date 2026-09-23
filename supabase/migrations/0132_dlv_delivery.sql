-- 0132_dlv_delivery.sql — the last leg: crates, surat jalan, installation,
-- snags and the BAST (D209–D212, D262).
--
-- Procurement owns what the client ordered; production owns what came off the
-- floor. What happens after that — a lorry, a site, a crew, a snag list and a
-- signature — had no record at all. The question this schema answers is the
-- one no other board can: **how much of what the client bought has actually
-- reached them.** Made is not delivered, delivered is not arrived, arrived is
-- not installed, installed is not handed over.
--
-- Four things hold it up, all from `02-database.md`:
--
--   **Nothing stores a quantity delivered or installed.** They are sums over
--   the line tables, filtered by the parent's status — and *delivered* (left
--   the yard) and *arrived* (signed for) are different filters over the same
--   rows (F62), because a crew sent to fit something still on the road is the
--   expensive version of that mistake.
--
--   **Made comes from the Job Orders made from the line** (0130). Where a
--   project predates that link, the Job Orders for its project and product
--   stand in. No Job Order at all is null, never zero (F60).
--
--   **Three refusals**: nothing is sent that has not been made, nothing is
--   fitted that has not arrived, and a handover refuses without its signed
--   BAST (D211). Everything else warns.
--
--   **The handover freezes its open snags** (D212). A BAST signed with three
--   notes open stays signed with three notes open, however quickly they are
--   fixed afterwards.
--
-- And two that are this business's own (owner, 2026-09-23): the first surat
-- jalan moves the project to SHIPPED, the BAST moves it to DONE — both logged,
-- the same way the first Job Order moves it to IN_PRODUCTION. Access is the
-- `delivery` module (0131), except the BAST, which is `project.handover`: it is
-- a claim about what the client agreed to, and it closes the project.

create schema if not exists ops_dlv;
grant usage on schema ops_dlv to authenticated;

insert into ops_core.permission_catalog (module, action, admin_only) values
  ('delivery','read',false), ('delivery','create',false), ('delivery','update',false)
on conflict do nothing;

insert into ops_core.doc_prefixes (prefix, what) values
  ('krm',  'delivery / surat jalan'),
  ('kol',  'packing box'),
  ('pas',  'installation visit'),
  ('tmn',  'snag'),
  ('bast', 'handover')
on conflict (prefix) do nothing;

insert into ops_core.doc_kind_labels (kind, label) values
  ('bast',               'BAST'),
  ('surat_jalan_keluar', 'Surat Jalan Keluar'),
  ('foto_lokasi',        'Foto Lokasi')
on conflict (kind) do nothing;

insert into ops_core.doc_kind_drive (kind, slug, rationale) values
  ('bast',               'project', 'The client''s signature on the finished job.'),
  ('surat_jalan_keluar', 'project', 'Our own delivery paper, signed at the site — not the vendor''s, which is `surat_jalan`.'),
  ('foto_lokasi',        'project', 'A crate, a wall, a snag: what the site looked like.')
on conflict (kind) do nothing;

create type ops_dlv.delivery_status_t     as enum ('DRAFT','IN_TRANSIT','ARRIVED','CANCELLED');
create type ops_dlv.box_status_t          as enum ('PACKED','IN_TRANSIT','ON_SITE','INSTALLED','PROBLEM');
create type ops_dlv.installation_status_t as enum ('SCHEDULED','DONE','CANCELLED');
create type ops_dlv.snag_severity_t       as enum ('minor','major');
create type ops_dlv.snag_status_t         as enum ('OPEN','FIXED');

-- ── the consignment ───────────────────────────────────────────────────────
create table ops_dlv.deliveries (
  id                         uuid primary key default gen_random_uuid(),
  delivery_no                text not null unique default ops_core.next_doc_number('krm'),
  -- The public code at the seam (ADR-004).
  project_code               text not null,
  dispatched_on              date not null,
  vehicle                    text,
  driver                     text,
  status                     ops_dlv.delivery_status_t not null default 'IN_TRANSIT',
  received_by                text,
  received_at                timestamptz,
  surat_jalan_attachment_id  uuid references ops_core.attachments(id),
  photo_attachment_id        uuid references ops_core.attachments(id),
  note                       text,
  cancelled_reason           text,
  created_by                 uuid references ops_core.users(id),
  created_at                 timestamptz not null default now(),
  -- Both halves of the evidence or it has not arrived (D101's rule).
  constraint arrived_has_evidence check (
    status <> 'ARRIVED' or (received_by is not null and received_at is not null
                            and surat_jalan_attachment_id is not null)),
  constraint cancel_says_why check (
    status <> 'CANCELLED' or (cancelled_reason is not null and length(btrim(cancelled_reason)) > 0))
);
create index deliveries_project_idx on ops_dlv.deliveries (project_code);

create table ops_dlv.delivery_lines (
  id               uuid primary key default gen_random_uuid(),
  delivery_id      uuid not null references ops_dlv.deliveries(id),
  project_line_id  uuid not null references ops_procure.project_lines(id),
  -- What the note said, in the words used on the day.
  description      text not null,
  qty              numeric not null check (qty > 0),
  uom              text not null,
  note             text
);
create index delivery_lines_line_idx on ops_dlv.delivery_lines (project_line_id);
create index delivery_lines_parent_idx on ops_dlv.delivery_lines (delivery_id);

-- ── the crate (D262) ──────────────────────────────────────────────────────
create table ops_dlv.packing_boxes (
  id            uuid primary key default gen_random_uuid(),
  box_no        text not null unique default ops_core.next_doc_number('kol'),
  project_code  text not null,
  -- Null while it is packed and waiting: a crate is labelled before anybody
  -- books a lorry, and that is a state the workshop is in every day.
  delivery_id   uuid references ops_dlv.deliveries(id),
  -- Where it goes **inside the building**. The whole reason the table exists.
  destination   text not null check (length(btrim(destination)) > 0),
  packed_by     uuid references ops_core.users(id),
  packed_at     timestamptz not null default now(),
  status        ops_dlv.box_status_t not null default 'PACKED',
  scanned_by    uuid references ops_core.users(id),
  scanned_at    timestamptz,
  problem_note  text,
  note          text,
  constraint problem_says_what check (
    status <> 'PROBLEM' or (problem_note is not null and length(btrim(problem_note)) > 0))
);
create index boxes_project_idx on ops_dlv.packing_boxes (project_code);
create index boxes_delivery_idx on ops_dlv.packing_boxes (delivery_id);

create table ops_dlv.box_lines (
  id               uuid primary key default gen_random_uuid(),
  box_id           uuid not null references ops_dlv.packing_boxes(id),
  -- Null for a bag of handles and screws: it belongs to no line by name, and
  -- forcing it onto one would make a fitted count wrong.
  project_line_id  uuid references ops_procure.project_lines(id),
  description      text not null,
  qty              numeric not null check (qty > 0),
  uom              text not null
);
create index box_lines_box_idx on ops_dlv.box_lines (box_id);

-- ── the visit ─────────────────────────────────────────────────────────────
create table ops_dlv.installations (
  id                uuid primary key default gen_random_uuid(),
  install_no        text not null unique default ops_core.next_doc_number('pas'),
  project_code      text not null,
  visit_date        date not null,
  -- Free text: a subcontracted crew is a normal answer.
  crew              text,
  status            ops_dlv.installation_status_t not null default 'DONE',
  note              text,
  cancelled_reason  text,
  created_by        uuid references ops_core.users(id),
  created_at        timestamptz not null default now()
);
create index installations_project_idx on ops_dlv.installations (project_code);

create table ops_dlv.installation_lines (
  id               uuid primary key default gen_random_uuid(),
  installation_id  uuid not null references ops_dlv.installations(id),
  project_line_id  uuid not null references ops_procure.project_lines(id),
  qty              numeric not null check (qty > 0),
  note             text
);
create index installation_lines_line_idx on ops_dlv.installation_lines (project_line_id);

-- ── what was found wrong ──────────────────────────────────────────────────
create table ops_dlv.snags (
  id                   uuid primary key default gen_random_uuid(),
  snag_no              text not null unique default ops_core.next_doc_number('tmn'),
  project_code         text not null,
  project_line_id      uuid references ops_procure.project_lines(id),
  raised_on            date not null default ops_core.office_day(),
  raised_by            text not null check (length(btrim(raised_by)) > 0),
  description          text not null check (length(btrim(description)) > 0),
  severity             ops_dlv.snag_severity_t not null default 'minor',
  status               ops_dlv.snag_status_t not null default 'OPEN',
  photo_attachment_id  uuid references ops_core.attachments(id),
  fixed_on             date,
  fixed_by             text,
  fix_note             text,
  created_by           uuid references ops_core.users(id),
  created_at           timestamptz not null default now(),
  constraint fixed_says_how check (
    status <> 'FIXED' or (fixed_on is not null and fix_note is not null and length(btrim(fix_note)) > 0))
);
create index snags_project_idx on ops_dlv.snags (project_code, status);

-- ── the signature (D211, D212) ────────────────────────────────────────────
create table ops_dlv.handovers (
  id                      uuid primary key default gen_random_uuid(),
  handover_no             text not null unique default ops_core.next_doc_number('bast'),
  -- One per project.
  project_code            text not null unique,
  handed_on               date not null,
  client_rep              text not null check (length(btrim(client_rep)) > 0),
  our_rep                 text not null check (length(btrim(our_rep)) > 0),
  -- The only evidence column in this schema that is NOT NULL: it backs a
  -- claim about what somebody else agreed to.
  bast_attachment_id      uuid not null references ops_core.attachments(id),
  -- Stored, not derived (D212).
  open_snags_at_handover  int not null default 0,
  open_snag_nos           text[] not null default '{}',
  note                    text,
  created_by              uuid references ops_core.users(id),
  created_at              timestamptz not null default now()
);

-- ── reading ───────────────────────────────────────────────────────────────
alter table ops_dlv.deliveries         enable row level security;
alter table ops_dlv.delivery_lines     enable row level security;
alter table ops_dlv.packing_boxes      enable row level security;
alter table ops_dlv.box_lines          enable row level security;
alter table ops_dlv.installations      enable row level security;
alter table ops_dlv.installation_lines enable row level security;
alter table ops_dlv.snags              enable row level security;
alter table ops_dlv.handovers          enable row level security;

-- Read by the crew and by whoever runs the project. Every write is a seam
-- below: no insert or update grant exists on any of these tables.
create or replace function ops_dlv.can_read()
returns boolean language sql stable set search_path = ops_core, pg_temp as $$
  select ops_core.has_permission('delivery.read') or ops_core.has_permission('project.read')
$$;

create policy deliveries_read on ops_dlv.deliveries         for select to authenticated using (ops_dlv.can_read());
create policy dlines_read      on ops_dlv.delivery_lines     for select to authenticated using (ops_dlv.can_read());
create policy boxes_read       on ops_dlv.packing_boxes      for select to authenticated using (ops_dlv.can_read());
create policy blines_read      on ops_dlv.box_lines          for select to authenticated using (ops_dlv.can_read());
create policy installs_read    on ops_dlv.installations      for select to authenticated using (ops_dlv.can_read());
create policy ilines_read      on ops_dlv.installation_lines for select to authenticated using (ops_dlv.can_read());
create policy snags_read       on ops_dlv.snags              for select to authenticated using (ops_dlv.can_read());
create policy handovers_read   on ops_dlv.handovers          for select to authenticated using (ops_dlv.can_read());

grant select on all tables in schema ops_dlv to authenticated;
grant execute on function ops_dlv.can_read() to authenticated;

-- The crew reads the order lines and the project it is delivering, without
-- holding the project module: the same additive, scoped policy 0063 gave the
-- workshop over vendors.
create policy projects_read_delivery on ops_procure.projects for select to authenticated
  using (ops_core.has_permission('delivery.read'));
create policy plines_read_delivery on ops_procure.project_lines for select to authenticated
  using (ops_core.has_permission('delivery.read'));

-- ── one order line, from what they bought to what they have ───────────────
create or replace view ops_dlv.v_fulfilment_line as
select
  p.code                                      as project_code,
  l.id                                        as project_line_id,
  l.line_no,
  l.product_code,
  l.description,
  l.uom,
  l.qty                                       as ordered,
  j.made,
  coalesce(d.delivered, 0)                    as delivered,
  coalesce(d.arrived, 0)                      as arrived,
  coalesce(i.installed, 0)                    as installed,
  case when j.made is null then null
       else greatest(j.made - coalesce(d.delivered, 0), 0) end            as ready_to_ship,
  greatest(coalesce(d.arrived, 0) - coalesce(i.installed, 0), 0)          as on_site,
  j.at_vendor,
  coalesce(j.at_vendor_where, '{}')           as at_vendor_where,
  -- Nothing to build: a service, a fee.
  (l.product_code is null and coalesce(d.delivered, 0) = 0)               as is_service
from ops_procure.project_lines l
join ops_procure.projects p on p.id = l.project_id
left join lateral (
  -- The Job Orders made from this line (0130), or — for a project that
  -- predates the link — those for its project and product that name no line.
  select case when count(*) = 0 then null else sum(coalesce(w.completed, 0)) end as made,
         case when count(*) = 0 then null else sum(coalesce(w.at_vendor_qty, 0)) end as at_vendor,
         (select array_agg(format('%s untuk %s di %s%s',
                   vl.outstanding, vl.process_name, coalesce(vl.vendor_name, vl.vendor_code),
                   case when vl.overdue_days is not null then format(', lewat janji %s hari', vl.overdue_days) else '' end))
            from ops_prod.v_vendor_leg vl
           where vl.returned_on is null
             and vl.wo_id = any(array_agg(wo.id)))                            as at_vendor_where
    from ops_prod.work_orders wo
    join ops_prod.v_work_order w on w.id = wo.id
   where wo.status <> 'CANCELLED'
     and (wo.project_line_id = l.id
          or (wo.project_line_id is null and wo.project_code = p.code
              and l.product_code is not null and wo.product_code = l.product_code))
) j on true
left join lateral (
  select sum(dl.qty)                                          as delivered,
         sum(dl.qty) filter (where dv.status = 'ARRIVED')     as arrived
    from ops_dlv.delivery_lines dl
    join ops_dlv.deliveries dv on dv.id = dl.delivery_id
   where dl.project_line_id = l.id and dv.status <> 'CANCELLED'
) d on true
left join lateral (
  select sum(il.qty) as installed
    from ops_dlv.installation_lines il
    join ops_dlv.installations ins on ins.id = il.installation_id
   where il.project_line_id = l.id and ins.status = 'DONE'
) i on true;

create or replace view ops_dlv.v_delivery as
select
  d.*,
  p.name                                   as project_name,
  coalesce(c.name, p.client_name)          as client_name,
  p.location,
  coalesce((select sum(qty) from ops_dlv.delivery_lines x where x.delivery_id = d.id), 0) as total_qty
from ops_dlv.deliveries d
left join ops_procure.projects p on p.code = d.project_code
left join ops_procure.clients c on c.id = p.client_id;

create or replace view ops_dlv.v_delivery_line as
select dl.*, coalesce(pl.line_no, 0) as line_no
from ops_dlv.delivery_lines dl
left join ops_procure.project_lines pl on pl.id = dl.project_line_id;

create or replace view ops_dlv.v_installation as
select
  i.*,
  p.name      as project_name,
  p.location,
  coalesce((select sum(qty) from ops_dlv.installation_lines x where x.installation_id = i.id), 0) as total_qty,
  (select count(*)::int from ops_dlv.snags s
    where s.project_code = i.project_code and s.raised_on = i.visit_date) as snags_found
from ops_dlv.installations i
left join ops_procure.projects p on p.code = i.project_code;

create or replace view ops_dlv.v_installation_line as
select il.*, coalesce(pl.description, il.project_line_id::text) as description,
       coalesce(pl.uom, '') as uom, coalesce(pl.line_no, 0) as line_no
from ops_dlv.installation_lines il
left join ops_procure.project_lines pl on pl.id = il.project_line_id;

create or replace view ops_dlv.v_snag as
select
  s.*,
  p.name              as project_name,
  pl.description      as line_description,
  (coalesce(s.fixed_on, ops_core.office_day()) - s.raised_on)::int as age_days
from ops_dlv.snags s
left join ops_procure.projects p on p.code = s.project_code
left join ops_procure.project_lines pl on pl.id = s.project_line_id;

-- *3 dari 12* is computed, never stored: it changes the moment another crate
-- joins the lorry, and a number on a label that is no longer true is worse
-- than none.
create or replace view ops_dlv.v_box as
select
  b.*,
  d.delivery_no,
  d.status                                   as delivery_status,
  p.name                                     as project_name,
  coalesce(pu.full_name, b.packed_by::text, '') as packed_by_name,
  su.full_name                               as scanned_by_name,
  coalesce((select sum(qty) from ops_dlv.box_lines x where x.box_id = b.id), 0) as piece_count,
  case when b.delivery_id is null then null
       else format('%s dari %s',
              row_number() over (partition by b.delivery_id order by b.box_no),
              count(*) over (partition by b.delivery_id)) end as position
from ops_dlv.packing_boxes b
left join ops_dlv.deliveries d on d.id = b.delivery_id
left join ops_procure.projects p on p.code = b.project_code
left join ops_core.users pu on pu.id = b.packed_by
left join ops_core.users su on su.id = b.scanned_by;

alter view ops_dlv.v_fulfilment_line   set (security_invoker = on);
alter view ops_dlv.v_delivery          set (security_invoker = on);
alter view ops_dlv.v_delivery_line     set (security_invoker = on);
alter view ops_dlv.v_installation      set (security_invoker = on);
alter view ops_dlv.v_installation_line set (security_invoker = on);
alter view ops_dlv.v_snag              set (security_invoker = on);
alter view ops_dlv.v_box               set (security_invoker = on);
grant select on all tables in schema ops_dlv to authenticated;

-- ── helpers the seams share ───────────────────────────────────────────────

-- A file the seam is about to point at, filed against the row it proves.
create or replace function ops_dlv.file_evidence(
  p_attachment_id uuid, p_entity text, p_entity_no text, p_kind text)
returns void
language plpgsql security definer set search_path = ops_core, pg_temp as $$
begin
  if p_attachment_id is null then return; end if;
  insert into ops_core.attachment_links (attachment_id, entity, entity_no, kind, linked_by)
  select p_attachment_id, p_entity::ops_core.link_entity_t, p_entity_no, p_kind::ops_core.doc_kind_t, auth.uid()
   where not exists (
     select 1 from ops_core.attachment_links
      where attachment_id = p_attachment_id and entity = p_entity::ops_core.link_entity_t
        and entity_no = p_entity_no and kind = p_kind::ops_core.doc_kind_t and unlinked_at is null);
end $$;

-- The project moves forward, never back, and says why (0111's log).
create or replace function ops_dlv.move_project(p_code text, p_to text, p_from text[], p_reason text)
returns boolean
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare pr ops_procure.projects;
begin
  select * into pr from ops_procure.projects where code = p_code;
  if pr.id is null or not (pr.status::text = any(p_from)) then return false; end if;
  update ops_procure.projects
     set status = p_to::ops_procure.project_status_t, status_changed_at = now(), updated_at = now(),
         is_active = p_to not in ('DONE','CANCELLED')
   where id = pr.id;
  insert into ops_procure.project_status_log (project_id, from_status, to_status, reason, changed_by)
  values (pr.id, pr.status, p_to::ops_procure.project_status_t, p_reason, auth.uid());
  return true;
end $$;

-- ── the crate ─────────────────────────────────────────────────────────────
create or replace function ops_dlv.pack_box(
  p_project_code text, p_destination text, p_lines jsonb,
  p_delivery_no text default null, p_note text default null, p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_dlv, ops_procure, ops_core, pg_temp as $$
declare pr ops_procure.projects; d ops_dlv.deliveries; b ops_dlv.packing_boxes; x jsonb; n int := 0;
        res jsonb; replayed jsonb;
begin
  replayed := ops_core.idem_replay('delivery', 'pack_box', p_key);
  if replayed is not null then return replayed; end if;
  if not ops_core.has_permission('delivery.create') then
    return ops_core.refused('delivery','packing_box', null,'pack',
      'not_permitted','Mengemas peti butuh akses pengiriman (create).');
  end if;
  select * into pr from ops_procure.projects where code = p_project_code;
  if not found then
    return ops_core.not_found('delivery','packing_box', null,'pack', format('Tidak ada proyek %s.', p_project_code));
  end if;
  if coalesce(btrim(p_destination), '') = '' then
    return ops_core.invalid('delivery','packing_box', null,'pack', 'destination_required',
      'Peti ini untuk ruangan mana? Tanpa itu, label ini tidak menolong siapa pun di lokasi.',
      jsonb_build_object('field','destination'));
  end if;
  for x in select * from jsonb_array_elements(coalesce(p_lines, '[]')) loop
    if coalesce(btrim(x->>'description'), '') <> '' and coalesce((x->>'qty')::numeric, 0) > 0 then n := n + 1; end if;
    if nullif(x->>'project_line_id', '') is not null and not exists (
         select 1 from ops_procure.project_lines where id = (x->>'project_line_id')::uuid and project_id = pr.id) then
      return ops_core.invalid('delivery','packing_box', null,'pack', 'line_not_found',
        'Baris pesanan itu bukan milik proyek ini.', jsonb_build_object('field','lines'));
    end if;
  end loop;
  if n = 0 then
    return ops_core.invalid('delivery','packing_box', null,'pack', 'contents_required',
      'Tulis isi petinya. Label tanpa isi hanya memindahkan pekerjaan membuka peti ke lokasi.',
      jsonb_build_object('field','lines'));
  end if;
  if nullif(btrim(p_delivery_no), '') is not null then
    select * into d from ops_dlv.deliveries where delivery_no = btrim(p_delivery_no);
    if not found then
      return ops_core.not_found('delivery','packing_box', null,'pack', format('Tidak ada pengiriman %s.', p_delivery_no));
    end if;
    if d.project_code <> pr.code then
      return ops_core.conflict('delivery','packing_box', null,'pack', 'wrong_project',
        format('Pengiriman %s untuk proyek %s, bukan %s.', d.delivery_no, d.project_code, pr.code));
    end if;
  end if;

  insert into ops_dlv.packing_boxes (project_code, delivery_id, destination, packed_by, status, note)
  values (pr.code, d.id, btrim(p_destination), auth.uid(),
          case when d.id is not null and d.status <> 'DRAFT' then 'IN_TRANSIT'::ops_dlv.box_status_t else 'PACKED' end,
          nullif(btrim(p_note), ''))
  returning * into b;
  insert into ops_dlv.box_lines (box_id, project_line_id, description, qty, uom)
  select b.id, nullif(e->>'project_line_id', '')::uuid, btrim(e->>'description'), (e->>'qty')::numeric,
         coalesce(nullif(btrim(e->>'uom'), ''), 'unit')
    from jsonb_array_elements(p_lines) e
   where coalesce(btrim(e->>'description'), '') <> '' and coalesce((e->>'qty')::numeric, 0) > 0;

  res := ops_core.ok('delivery','packing_box', b.box_no,'pack', jsonb_build_object('box_no', b.box_no));
  return ops_core.idem_remember('delivery', 'pack_box', p_key, res);
end $$;

-- Loading crates onto a consignment. Shared by `create_delivery`.
create or replace function ops_dlv.load_boxes(p_delivery_no text, p_box_nos text[])
returns jsonb
language plpgsql security definer set search_path = ops_dlv, ops_core, pg_temp as $$
declare d ops_dlv.deliveries; v_missing text; v_wrong text; v_gone text;
begin
  if not ops_core.has_permission('delivery.update') and not ops_core.has_permission('delivery.create') then
    return ops_core.refused('delivery','delivery', p_delivery_no,'load',
      'not_permitted','Memuat peti butuh akses pengiriman.');
  end if;
  select * into d from ops_dlv.deliveries where delivery_no = p_delivery_no;
  if not found then
    return ops_core.not_found('delivery','delivery', p_delivery_no,'load', format('Tidak ada pengiriman %s.', p_delivery_no));
  end if;
  if d.status = 'CANCELLED' then
    return ops_core.conflict('delivery','delivery', p_delivery_no,'load', 'cancelled', 'Pengiriman ini dibatalkan.');
  end if;
  select string_agg(n, ', ') into v_missing from unnest(coalesce(p_box_nos, '{}')) n
   where not exists (select 1 from ops_dlv.packing_boxes b where b.box_no = btrim(n));
  if v_missing is not null then
    return ops_core.not_found('delivery','delivery', p_delivery_no,'load', format('Tidak ada peti: %s.', v_missing));
  end if;
  select string_agg(b.box_no, ', ') into v_wrong from ops_dlv.packing_boxes b
   where b.box_no = any(p_box_nos) and b.project_code <> d.project_code;
  if v_wrong is not null then
    return ops_core.conflict('delivery','delivery', p_delivery_no,'load', 'wrong_project',
      format('Peti %s bukan untuk proyek %s.', v_wrong, d.project_code));
  end if;
  select string_agg(b.box_no, ', ') into v_gone from ops_dlv.packing_boxes b
   where b.box_no = any(p_box_nos) and b.delivery_id is not null and b.delivery_id <> d.id;
  if v_gone is not null then
    return ops_core.conflict('delivery','delivery', p_delivery_no,'load', 'already_loaded',
      format('Peti %s sudah ikut pengiriman lain.', v_gone));
  end if;
  update ops_dlv.packing_boxes
     set delivery_id = d.id,
         status = case when status = 'PACKED' and d.status <> 'DRAFT' then 'IN_TRANSIT' else status end
   where box_no = any(p_box_nos);
  return ops_core.ok('delivery','delivery', p_delivery_no,'load',
    jsonb_build_object('delivery_no', d.delivery_no, 'boxes', coalesce(array_length(p_box_nos, 1), 0)));
end $$;

-- *It is here.* One tap after the scan. Already on site, fitted or flagged:
-- the scan adds nothing and must not undo the more specific fact.
create or replace function ops_dlv.scan_box(p_box_no text, p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_dlv, ops_core, pg_temp as $$
declare b ops_dlv.packing_boxes; res jsonb; replayed jsonb;
begin
  replayed := ops_core.idem_replay('delivery', 'scan_box', p_key);
  if replayed is not null then return replayed; end if;
  if not ops_core.has_permission('delivery.update') then
    return ops_core.refused('delivery','packing_box', p_box_no,'scan',
      'not_permitted','Scan peti butuh akses pengiriman (update).');
  end if;
  select * into b from ops_dlv.packing_boxes where box_no = btrim(p_box_no);
  if not found then
    return ops_core.not_found('delivery','packing_box', p_box_no,'scan', format('Tidak ada peti dengan kode %s.', p_box_no));
  end if;
  if b.status in ('ON_SITE','INSTALLED','PROBLEM') then
    return ops_core.noop('delivery','packing_box', b.box_no,'scan','Sudah tercatat.', jsonb_build_object('box_no', b.box_no));
  end if;
  update ops_dlv.packing_boxes set status = 'ON_SITE', scanned_by = auth.uid(), scanned_at = now() where id = b.id;
  res := ops_core.ok('delivery','packing_box', b.box_no,'scan', jsonb_build_object('box_no', b.box_no));
  return ops_core.idem_remember('delivery', 'scan_box', p_key, res);
end $$;

-- The one refusal on a crate: nobody has seen it yet.
create or replace function ops_dlv.mark_box_installed(p_box_no text, p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_dlv, ops_core, pg_temp as $$
declare b ops_dlv.packing_boxes; res jsonb; replayed jsonb;
begin
  replayed := ops_core.idem_replay('delivery', 'mark_box_installed', p_key);
  if replayed is not null then return replayed; end if;
  if not ops_core.has_permission('delivery.update') then
    return ops_core.refused('delivery','packing_box', p_box_no,'install',
      'not_permitted','Menandai peti terpasang butuh akses pengiriman (update).');
  end if;
  select * into b from ops_dlv.packing_boxes where box_no = btrim(p_box_no);
  if not found then
    return ops_core.not_found('delivery','packing_box', p_box_no,'install', format('Tidak ada peti dengan kode %s.', p_box_no));
  end if;
  if b.status = 'INSTALLED' then
    return ops_core.noop('delivery','packing_box', b.box_no,'install','Sudah terpasang.', jsonb_build_object('box_no', b.box_no));
  end if;
  if b.scanned_at is null then
    return ops_core.conflict('delivery','packing_box', b.box_no,'install', 'not_on_site',
      'Peti ini belum ada yang scan di lokasi. Scan dulu sebagai tanda barangnya benar-benar sampai, baru tandai terpasang.');
  end if;
  update ops_dlv.packing_boxes set status = 'INSTALLED' where id = b.id;
  res := ops_core.ok('delivery','packing_box', b.box_no,'install', jsonb_build_object('box_no', b.box_no));
  return ops_core.idem_remember('delivery', 'mark_box_installed', p_key, res);
end $$;

create or replace function ops_dlv.flag_box_problem(p_box_no text, p_problem_note text, p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_dlv, ops_core, pg_temp as $$
declare b ops_dlv.packing_boxes; res jsonb; replayed jsonb;
begin
  replayed := ops_core.idem_replay('delivery', 'flag_box_problem', p_key);
  if replayed is not null then return replayed; end if;
  if not ops_core.has_permission('delivery.update') then
    return ops_core.refused('delivery','packing_box', p_box_no,'flag_problem',
      'not_permitted','Menandai peti bermasalah butuh akses pengiriman (update).');
  end if;
  select * into b from ops_dlv.packing_boxes where box_no = btrim(p_box_no);
  if not found then
    return ops_core.not_found('delivery','packing_box', p_box_no,'flag_problem', format('Tidak ada peti dengan kode %s.', p_box_no));
  end if;
  if coalesce(btrim(p_problem_note), '') = '' then
    return ops_core.invalid('delivery','packing_box', b.box_no,'flag_problem', 'problem_note_required',
      'Tulis apa yang salah. Tanda merah tanpa keterangan tidak bisa ditindaklanjuti siapa pun di workshop.',
      jsonb_build_object('field','problem_note'));
  end if;
  -- Flagging is also a sighting: the crate is in somebody's hands.
  update ops_dlv.packing_boxes
     set status = 'PROBLEM', problem_note = btrim(p_problem_note),
         scanned_by = coalesce(scanned_by, auth.uid()), scanned_at = coalesce(scanned_at, now())
   where id = b.id;
  res := ops_core.ok('delivery','packing_box', b.box_no,'flag_problem', jsonb_build_object('box_no', b.box_no));
  return ops_core.idem_remember('delivery', 'flag_box_problem', p_key, res);
end $$;

-- ── the surat jalan ───────────────────────────────────────────────────────
-- Refuses to promise more than exists (D210): a delivery note for goods still
-- on the floor is a promise somebody drives to a site to discover is empty.
-- A line with nothing matchable behind it (a service, an uncatalogued piece)
-- has no figure to refuse against, and goes.
create or replace function ops_dlv.create_delivery(
  p_project_code text, p_dispatched_on date, p_lines jsonb,
  p_vehicle text default null, p_driver text default null, p_note text default null,
  p_box_nos text[] default null, p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_dlv, ops_procure, ops_core, pg_temp as $$
declare pr ops_procure.projects; f ops_dlv.v_fulfilment_line; x record; d ops_dlv.deliveries;
        r jsonb; res jsonb; replayed jsonb; v_moved boolean;
begin
  replayed := ops_core.idem_replay('delivery', 'create_delivery', p_key);
  if replayed is not null then return replayed; end if;
  if not ops_core.has_permission('delivery.create') then
    return ops_core.refused('delivery','delivery', null,'dispatch',
      'not_permitted','Membuat surat jalan butuh akses pengiriman (create).');
  end if;
  select * into pr from ops_procure.projects where code = p_project_code;
  if not found then
    return ops_core.not_found('delivery','delivery', null,'dispatch', format('Tidak ada proyek %s.', p_project_code));
  end if;
  if p_dispatched_on is null then
    return ops_core.invalid('delivery','delivery', null,'dispatch', 'date_required',
      'Tanggal berangkatnya kapan?', jsonb_build_object('field','dispatched_on'));
  end if;
  if jsonb_array_length(coalesce(p_lines, '[]')) = 0 then
    return ops_core.invalid('delivery','delivery', null,'dispatch', 'no_lines',
      'Surat jalan tanpa barang bukan surat jalan.', jsonb_build_object('field','lines'));
  end if;

  -- Summed per line, so the same line twice cannot slip past the check.
  for x in
    select (e->>'project_line_id')::uuid as line_id, sum((e->>'qty')::numeric) as qty
      from jsonb_array_elements(p_lines) e group by 1
  loop
    select * into f from ops_dlv.v_fulfilment_line v where v.project_line_id = x.line_id and v.project_code = pr.code;
    if f.project_line_id is null then
      return ops_core.not_found('delivery','delivery', null,'dispatch', 'Baris pesanan itu bukan milik proyek ini.');
    end if;
    if x.qty is null or x.qty <= 0 then
      return ops_core.invalid('delivery','delivery', null,'dispatch', 'qty_required',
        'Berapa yang dikirim?', jsonb_build_object('field','qty'));
    end if;
    if f.ready_to_ship is not null and x.qty > f.ready_to_ship then
      return ops_core.conflict('delivery','delivery', null,'dispatch', 'not_enough_made',
        format('Baris %s: siap kirim %s %s, diminta %s. Yang sudah dibuat %s, sudah terkirim %s. Surat jalan untuk barang yang belum jadi adalah janji yang ketahuan di lokasi.',
               f.line_no, f.ready_to_ship, f.uom, x.qty, f.made, f.delivered),
        jsonb_build_object('ready_to_ship', f.ready_to_ship, 'asked', x.qty, 'made', f.made, 'delivered', f.delivered));
    end if;
  end loop;

  insert into ops_dlv.deliveries (project_code, dispatched_on, vehicle, driver, status, note, created_by)
  values (pr.code, p_dispatched_on, nullif(btrim(p_vehicle), ''), nullif(btrim(p_driver), ''),
          'IN_TRANSIT', nullif(btrim(p_note), ''), auth.uid())
  returning * into d;
  insert into ops_dlv.delivery_lines (delivery_id, project_line_id, description, qty, uom, note)
  select d.id, pl.id, pl.description, (e->>'qty')::numeric, pl.uom, nullif(btrim(e->>'note'), '')
    from jsonb_array_elements(p_lines) e
    join ops_procure.project_lines pl on pl.id = (e->>'project_line_id')::uuid;

  if coalesce(array_length(p_box_nos, 1), 0) > 0 then
    r := ops_dlv.load_boxes(d.delivery_no, p_box_nos);
    if not ops_core.said_ok(r) then
      raise exception 'crates refused after the surat jalan was written: %', r->'error'->>'message'
        using errcode = 'check_violation';
    end if;
  end if;

  v_moved := ops_dlv.move_project(pr.code, 'SHIPPED', array['INQUIRY','QUOTATION_SENT','DEAL','IN_PRODUCTION'],
                                  format('Surat jalan %s berangkat', d.delivery_no));

  res := ops_core.ok('delivery','delivery', d.delivery_no,'dispatch',
    jsonb_build_object('delivery_no', d.delivery_no, 'project_moved', v_moved));
  return ops_core.idem_remember('delivery', 'create_delivery', p_key, res);
end $$;

-- Both halves of the evidence or neither (D101).
create or replace function ops_dlv.mark_arrived(
  p_delivery_no text, p_received_by text, p_surat_jalan_attachment_id uuid,
  p_photo_attachment_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = ops_dlv, ops_core, pg_temp as $$
declare d ops_dlv.deliveries;
begin
  if not ops_core.has_permission('delivery.update') then
    return ops_core.refused('delivery','delivery', p_delivery_no,'arrive',
      'not_permitted','Mencatat barang sampai butuh akses pengiriman (update).');
  end if;
  select * into d from ops_dlv.deliveries where delivery_no = p_delivery_no;
  if not found then
    return ops_core.not_found('delivery','delivery', p_delivery_no,'arrive', format('Tidak ada pengiriman %s.', p_delivery_no));
  end if;
  if d.status = 'ARRIVED' then
    return ops_core.conflict('delivery','delivery', p_delivery_no,'arrive', 'already_arrived', 'Pengiriman ini sudah tercatat sampai.');
  end if;
  if d.status = 'CANCELLED' then
    return ops_core.conflict('delivery','delivery', p_delivery_no,'arrive', 'cancelled', 'Pengiriman ini dibatalkan.');
  end if;
  if coalesce(btrim(p_received_by), '') = '' then
    return ops_core.invalid('delivery','delivery', p_delivery_no,'arrive', 'receiver_required',
      'Siapa yang menerima di lokasi? Tanpa nama, tidak ada yang bisa ditanya tiga minggu lagi.',
      jsonb_build_object('field','received_by'));
  end if;
  if p_surat_jalan_attachment_id is null
     or not exists (select 1 from ops_core.attachments where id = p_surat_jalan_attachment_id) then
    return ops_core.invalid('delivery','delivery', p_delivery_no,'arrive', 'surat_jalan_required',
      'Lampirkan surat jalan yang ditandatangani. Itu satu-satunya bukti bahwa barangnya diakui diterima.',
      jsonb_build_object('field','surat_jalan_attachment_id'));
  end if;
  update ops_dlv.deliveries
     set status = 'ARRIVED', received_by = btrim(p_received_by), received_at = now(),
         surat_jalan_attachment_id = p_surat_jalan_attachment_id,
         photo_attachment_id = coalesce(p_photo_attachment_id, photo_attachment_id)
   where id = d.id;
  perform ops_dlv.file_evidence(p_surat_jalan_attachment_id, 'delivery', d.delivery_no, 'surat_jalan_keluar');
  perform ops_dlv.file_evidence(p_photo_attachment_id, 'delivery', d.delivery_no, 'foto_lokasi');
  return ops_core.ok('delivery','delivery', p_delivery_no,'arrive',
    jsonb_build_object('delivery_no', d.delivery_no, 'received_by', btrim(p_received_by)));
end $$;

-- ── the visit ─────────────────────────────────────────────────────────────
-- Refuses to fit more than has arrived (D210): the same rule one step later,
-- and the more expensive one, because a crew is already there.
create or replace function ops_dlv.record_installation(
  p_project_code text, p_visit_date date, p_lines jsonb,
  p_crew text default null, p_note text default null, p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_dlv, ops_procure, ops_core, pg_temp as $$
declare pr ops_procure.projects; f ops_dlv.v_fulfilment_line; x record; i ops_dlv.installations;
        res jsonb; replayed jsonb;
begin
  replayed := ops_core.idem_replay('delivery', 'record_installation', p_key);
  if replayed is not null then return replayed; end if;
  if not ops_core.has_permission('delivery.create') then
    return ops_core.refused('delivery','installation', null,'install',
      'not_permitted','Mencatat pemasangan butuh akses pengiriman (create).');
  end if;
  select * into pr from ops_procure.projects where code = p_project_code;
  if not found then
    return ops_core.not_found('delivery','installation', null,'install', format('Tidak ada proyek %s.', p_project_code));
  end if;
  if jsonb_array_length(coalesce(p_lines, '[]')) = 0 then
    return ops_core.invalid('delivery','installation', null,'install', 'no_lines',
      'Kunjungan tanpa barang terpasang dicatat sebagai dijadwalkan, bukan selesai.', jsonb_build_object('field','lines'));
  end if;
  for x in
    select (e->>'project_line_id')::uuid as line_id, sum((e->>'qty')::numeric) as qty
      from jsonb_array_elements(p_lines) e group by 1
  loop
    select * into f from ops_dlv.v_fulfilment_line v where v.project_line_id = x.line_id and v.project_code = pr.code;
    if f.project_line_id is null then
      return ops_core.not_found('delivery','installation', null,'install', 'Baris pesanan itu bukan milik proyek ini.');
    end if;
    if x.qty is null or x.qty <= 0 then
      return ops_core.invalid('delivery','installation', null,'install', 'qty_required',
        'Berapa yang terpasang?', jsonb_build_object('field','qty'));
    end if;
    if x.qty > f.on_site then
      return ops_core.conflict('delivery','installation', null,'install', 'not_enough_on_site',
        format('Baris %s: di lokasi ada %s %s yang belum terpasang, dilaporkan %s. Sudah berangkat %s, tercatat sampai %s, terpasang %s. Kalau barangnya memang ada di sana, pengirimannya yang belum dicatat sampai.',
               f.line_no, f.on_site, f.uom, x.qty, f.delivered, f.arrived, f.installed),
        jsonb_build_object('on_site', f.on_site, 'asked', x.qty));
    end if;
  end loop;

  insert into ops_dlv.installations (project_code, visit_date, crew, status, note, created_by)
  values (pr.code, coalesce(p_visit_date, ops_core.office_day()), nullif(btrim(p_crew), ''), 'DONE',
          nullif(btrim(p_note), ''), auth.uid())
  returning * into i;
  insert into ops_dlv.installation_lines (installation_id, project_line_id, qty, note)
  select i.id, (e->>'project_line_id')::uuid, (e->>'qty')::numeric, nullif(btrim(e->>'note'), '')
    from jsonb_array_elements(p_lines) e;

  res := ops_core.ok('delivery','installation', i.install_no,'install', jsonb_build_object('install_no', i.install_no));
  return ops_core.idem_remember('delivery', 'record_installation', p_key, res);
end $$;

-- ── what was found wrong ──────────────────────────────────────────────────
create or replace function ops_dlv.raise_snag(
  p_project_code text, p_description text, p_raised_by text,
  p_severity text default 'minor', p_project_line_id uuid default null,
  p_photo_attachment_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = ops_dlv, ops_procure, ops_core, pg_temp as $$
declare pr ops_procure.projects; s ops_dlv.snags; v_sev ops_dlv.snag_severity_t;
begin
  if not ops_core.has_permission('delivery.create') then
    return ops_core.refused('delivery','snag', null,'raise',
      'not_permitted','Mencatat temuan butuh akses pengiriman (create).');
  end if;
  select * into pr from ops_procure.projects where code = p_project_code;
  if not found then
    return ops_core.not_found('delivery','snag', null,'raise', format('Tidak ada proyek %s.', p_project_code));
  end if;
  if coalesce(btrim(p_description), '') = '' then
    return ops_core.invalid('delivery','snag', null,'raise', 'description_required',
      'Apa yang salah? Catatan tanpa isi tidak bisa diperbaiki siapa pun.', jsonb_build_object('field','description'));
  end if;
  if coalesce(btrim(p_raised_by), '') = '' then
    return ops_core.invalid('delivery','snag', null,'raise', 'raiser_required',
      'Siapa yang menemukan? Klien dan tim kita menuntut tindak lanjut yang berbeda.', jsonb_build_object('field','raised_by'));
  end if;
  begin
    v_sev := coalesce(nullif(btrim(p_severity), ''), 'minor')::ops_dlv.snag_severity_t;
  exception when invalid_text_representation then
    return ops_core.invalid('delivery','snag', null,'raise', 'unknown_severity',
      format('Tingkat %s tidak dikenal.', p_severity), jsonb_build_object('field','severity'));
  end;
  if p_project_line_id is not null and not exists (
       select 1 from ops_procure.project_lines where id = p_project_line_id and project_id = pr.id) then
    return ops_core.invalid('delivery','snag', null,'raise', 'line_not_found',
      'Baris pesanan itu bukan milik proyek ini.', jsonb_build_object('field','project_line_id'));
  end if;
  insert into ops_dlv.snags (project_code, project_line_id, raised_by, description, severity, photo_attachment_id, created_by)
  values (pr.code, p_project_line_id, btrim(p_raised_by), btrim(p_description), v_sev, p_photo_attachment_id, auth.uid())
  returning * into s;
  perform ops_dlv.file_evidence(p_photo_attachment_id, 'snag', s.snag_no, 'foto_lokasi');
  return ops_core.ok('delivery','snag', s.snag_no,'raise', jsonb_build_object('snag_no', s.snag_no));
end $$;

create or replace function ops_dlv.close_snag(p_snag_no text, p_fix_note text, p_fixed_by text default null)
returns jsonb
language plpgsql security definer set search_path = ops_dlv, ops_core, pg_temp as $$
declare s ops_dlv.snags;
begin
  if not ops_core.has_permission('delivery.update') then
    return ops_core.refused('delivery','snag', p_snag_no,'fix',
      'not_permitted','Menutup temuan butuh akses pengiriman (update).');
  end if;
  select * into s from ops_dlv.snags where snag_no = p_snag_no;
  if not found then
    return ops_core.not_found('delivery','snag', p_snag_no,'fix', format('Tidak ada catatan %s.', p_snag_no));
  end if;
  if s.status = 'FIXED' then
    return ops_core.conflict('delivery','snag', p_snag_no,'fix', 'already_fixed', 'Catatan ini sudah ditutup.');
  end if;
  if coalesce(btrim(p_fix_note), '') = '' then
    return ops_core.invalid('delivery','snag', p_snag_no,'fix', 'fix_note_required',
      'Apa yang dikerjakan? Catatan yang ditutup tanpa keterangan akan dibuka lagi oleh orang yang sama.',
      jsonb_build_object('field','fix_note'));
  end if;
  update ops_dlv.snags
     set status = 'FIXED', fixed_on = ops_core.office_day(), fix_note = btrim(p_fix_note),
         fixed_by = coalesce(nullif(btrim(p_fixed_by), ''), (select full_name from ops_core.users where id = auth.uid()))
   where id = s.id;
  return ops_core.ok('delivery','snag', p_snag_no,'fix', jsonb_build_object('snag_no', s.snag_no));
end $$;

-- ── the signature ─────────────────────────────────────────────────────────
create or replace function ops_dlv.record_handover(
  p_project_code text, p_handed_on date, p_client_rep text, p_our_rep text,
  p_bast_attachment_id uuid, p_note text default null, p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_dlv, ops_procure, ops_core, pg_temp as $$
declare pr ops_procure.projects; h ops_dlv.handovers; v_open text[]; v_delivered numeric; v_installed numeric;
        res jsonb; replayed jsonb;
begin
  replayed := ops_core.idem_replay('delivery', 'record_handover', p_key);
  if replayed is not null then return replayed; end if;
  if not ops_core.has_permission('project.handover') then
    return ops_core.refused('delivery','handover', null,'hand_over',
      'not_permitted','Serah terima butuh akses proyek (handover) — ia menutup proyeknya.');
  end if;
  select * into pr from ops_procure.projects where code = p_project_code;
  if not found then
    return ops_core.not_found('delivery','handover', null,'hand_over', format('Tidak ada proyek %s.', p_project_code));
  end if;
  select * into h from ops_dlv.handovers where project_code = pr.code;
  if found then
    return ops_core.conflict('delivery','handover', h.handover_no,'hand_over', 'already_handed_over',
      format('Proyek ini sudah diserahterimakan %s (%s).', h.handed_on, h.handover_no),
      jsonb_build_object('handover_no', h.handover_no));
  end if;
  if p_bast_attachment_id is null
     or not exists (select 1 from ops_core.attachments where id = p_bast_attachment_id) then
    return ops_core.invalid('delivery','handover', null,'hand_over', 'bast_required',
      'Lampirkan BAST yang sudah ditandatangani. Serah terima tanpa dokumennya adalah klaim bahwa klien menerima pekerjaan ini — dan klien satu-satunya pihak yang tidak bisa mengoreksi catatan kita.',
      jsonb_build_object('field','bast_attachment_id'));
  end if;
  if coalesce(btrim(p_client_rep), '') = '' or coalesce(btrim(p_our_rep), '') = '' then
    return ops_core.invalid('delivery','handover', null,'hand_over', 'reps_required',
      'Siapa yang tanda tangan di kedua sisi? Itu yang tertulis di kertasnya.', jsonb_build_object('field','client_rep'));
  end if;
  select coalesce(sum(delivered), 0), coalesce(sum(installed), 0) into v_delivered, v_installed
    from ops_dlv.v_fulfilment_line where project_code = pr.code;
  if v_delivered = 0 and v_installed = 0 then
    return ops_core.conflict('delivery','handover', null,'hand_over', 'nothing_delivered',
      'Belum ada satu pun barang yang tercatat terkirim atau terpasang di proyek ini. Kalau pekerjaannya memang selesai, pengiriman dan pemasangannya yang belum dicatat.');
  end if;

  select coalesce(array_agg(snag_no order by snag_no), '{}') into v_open
    from ops_dlv.snags where project_code = pr.code and status = 'OPEN';
  insert into ops_dlv.handovers (project_code, handed_on, client_rep, our_rep, bast_attachment_id,
                                 open_snags_at_handover, open_snag_nos, note, created_by)
  values (pr.code, coalesce(p_handed_on, ops_core.office_day()), btrim(p_client_rep), btrim(p_our_rep),
          p_bast_attachment_id, coalesce(array_length(v_open, 1), 0), v_open, nullif(btrim(p_note), ''), auth.uid())
  returning * into h;
  perform ops_dlv.file_evidence(p_bast_attachment_id, 'handover', h.handover_no, 'bast');
  perform ops_dlv.move_project(pr.code, 'DONE',
    array['INQUIRY','QUOTATION_SENT','DEAL','IN_PRODUCTION','SHIPPED'],
    format('BAST %s ditandatangani', h.handover_no));

  res := ops_core.ok('delivery','handover', h.handover_no,'hand_over',
    jsonb_build_object('handover_no', h.handover_no, 'project_code', pr.code,
                       'open_snags_at_handover', h.open_snags_at_handover));
  return ops_core.idem_remember('delivery', 'record_handover', p_key, res);
end $$;

revoke execute on function ops_dlv.file_evidence(uuid, text, text, text) from public;
revoke execute on function ops_dlv.move_project(text, text, text[], text) from public;

grant execute on function
  ops_dlv.pack_box(text, text, jsonb, text, text, text),
  ops_dlv.load_boxes(text, text[]),
  ops_dlv.scan_box(text, text),
  ops_dlv.mark_box_installed(text, text),
  ops_dlv.flag_box_problem(text, text, text),
  ops_dlv.create_delivery(text, date, jsonb, text, text, text, text[], text),
  ops_dlv.mark_arrived(text, text, uuid, uuid),
  ops_dlv.record_installation(text, date, jsonb, text, text, text),
  ops_dlv.raise_snag(text, text, text, text, uuid, uuid),
  ops_dlv.close_snag(text, text, text),
  ops_dlv.record_handover(text, date, text, text, uuid, text, text)
  to authenticated;

-- Signed-in callers only (`core_execute_grants`).
revoke execute on function
  ops_dlv.pack_box(text, text, jsonb, text, text, text),
  ops_dlv.load_boxes(text, text[]),
  ops_dlv.scan_box(text, text),
  ops_dlv.mark_box_installed(text, text),
  ops_dlv.flag_box_problem(text, text, text),
  ops_dlv.create_delivery(text, date, jsonb, text, text, text, text[], text),
  ops_dlv.mark_arrived(text, text, uuid, uuid),
  ops_dlv.record_installation(text, date, jsonb, text, text, text),
  ops_dlv.raise_snag(text, text, text, text, uuid, uuid),
  ops_dlv.close_snag(text, text, text),
  ops_dlv.record_handover(text, date, text, text, uuid, text, text)
  from public;
