-- 0259_dlv_containers.sql — a container is a delivery of its own kind (O5,
-- kajian F255 §5.6, D417).
--
-- TALA's agent work ships by the container, not the truck (§1: *ukuran
-- pekerjaannya kontainer*). Until now a delivery was a lorry: a driver, a
-- plate, a surat jalan. What a container needs on top — its number, its seal,
-- its size, the factory order it was loaded from, the ship's dates, the bill
-- of lading — had nowhere to go (G6).
--
--   deliveries.delivery_mode    truck (default — every delivery so far) or
--                               container.
--   deliveries.po_id            the factory order it was loaded from (O3).
--   deliveries.container_no     ISO 6346: four letters, seven digits. The
--                               check digit is checked and *warned*, not
--                               refused (A6) — a number copied from a photo of
--                               the door is more often right than the rule.
--   deliveries.seal_no, container_size (20 · 40 · 40HC), etd, eta, bl_no.
--
-- A container's lines are the same `delivery_lines` a lorry has: what is in
-- it, per order line. It is created through `create_container`, which runs
-- `create_delivery` (0132) for everything a consignment already does — the
-- lines checked against what is ready, the project moved to SHIPPED — and then
-- records the container on it. Arrival is `mark_arrived`, unchanged. The
-- number of containers is counted from these rows; nobody types it (D414).
--
-- Its papers — packing list and B/L — are uploaded against the delivery and
-- filed in PROJECT MANAGER › ops-talaliving › PENGIRIMAN/{CLIENT}/{PROJECT}
-- (D313, D320); `file_container_doc` links each to its container.
--
-- `v_delivery` keeps its columns and gains the container's last.
-- Applying to production: no drops, and no function body here removes rows.

-- ── 1. the container on the delivery ──────────────────────────────────────

alter table ops_dlv.deliveries
  add column if not exists delivery_mode text not null default 'truck'
    constraint delivery_mode_known check (delivery_mode in ('truck','container')),
  add column if not exists po_id uuid references ops_procure.purchase_orders(id),
  add column if not exists container_no text,
  add column if not exists seal_no text,
  add column if not exists container_size text
    constraint container_size_known check (container_size is null or container_size in ('20','40','40HC')),
  add column if not exists etd date,
  add column if not exists eta date,
  add column if not exists bl_no text;

-- A container cannot be on two ships at once. It can be on many over the
-- years — the shipping line reuses it — so only the live ones are unique.
create unique index if not exists deliveries_live_container_uq
  on ops_dlv.deliveries (container_no)
  where container_no is not null and status in ('DRAFT','IN_TRANSIT');
create index if not exists deliveries_po_idx on ops_dlv.deliveries (po_id) where po_id is not null;

-- A container number as people type it: spaces, dashes and case dropped.
create or replace function ops_dlv.container_no_clean(p_no text)
returns text
language sql immutable as $$
  select nullif(upper(regexp_replace(coalesce(p_no, ''), '[^A-Za-z0-9]', '', 'g')), '')
$$;
grant execute on function ops_dlv.container_no_clean(text) to authenticated;

-- ISO 6346's check digit for the first ten characters of a clean number:
-- letters A=10 … Z=38 skipping 11, 22 and 33, each character weighted 2^i,
-- the sum mod 11, mod 10. Only meaningful for a number of the right shape.
create or replace function ops_dlv.container_check_digit(p_no text)
returns int
language sql immutable as $$
  select (sum(
           case when i <= 4
                then (array[10,12,13,14,15,16,17,18,19,20,21,23,24,25,26,27,28,29,30,31,32,34,35,36,37,38])
                       [ascii(substr(p_no, i, 1)) - 64]
                else substr(p_no, i, 1)::int end
           * (2 ^ (i - 1))::int) % 11) % 10
    from generate_series(1, 10) i
   where p_no ~ '^[A-Z]{4}[0-9]{7}$'
$$;
grant execute on function ops_dlv.container_check_digit(text) to authenticated;

-- ── 2. its papers, filed (D313, D320) ─────────────────────────────────────

insert into ops_core.doc_kind_labels (kind, label) values
  ('packing_list',   'Packing List'),
  ('bill_of_lading', 'Bill of Lading')
on conflict (kind) do nothing;
insert into ops_core.doc_kind_drive (kind, slug, rationale) values
  ('packing_list',   'project', 'What is in a container, carton by carton — filed with the delivery it describes, beside the surat jalan keluar (O5).'),
  ('bill_of_lading', 'project', 'The shipping line''s receipt for a container and the title to its goods (O5).')
on conflict (kind) do nothing;
insert into ops_core.drive_paths (kind, entity, path, note) values
  ('packing_list',   'delivery', 'PENGIRIMAN/{CLIENT}/{PROJECT}', 'A container''s papers, per client and project (O5, D313).'),
  ('bill_of_lading', 'delivery', 'PENGIRIMAN/{CLIENT}/{PROJECT}', null),
  ('packing_list',   null,       'PENGIRIMAN',                    null),
  ('bill_of_lading', null,       'PENGIRIMAN',                    null)
on conflict (kind, entity) do nothing;

-- drive_context (0224): a delivery's files go under its project's client and
-- project, as a quotation's and a design item's do.
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

-- ── 3. seams ──────────────────────────────────────────────────────────────

-- The container's own fields, checked the same way on the way in and on every
-- correction. Answers null when they are fine, else the refusal.
create or replace function ops_dlv.container_fields_refusal(
  p_delivery_no text, p_action text, p_container_no text, p_size text, p_etd date, p_eta date)
returns jsonb
language plpgsql volatile
set search_path = ops_dlv, ops_core, pg_temp
as $$
declare v_clash text;
begin
  if p_container_no is null then
    return ops_core.invalid('delivery','delivery', p_delivery_no, p_action, 'container_no_required',
      'Nomor kontainernya berapa? Tertulis di pintu kontainer: empat huruf, tujuh angka.',
      jsonb_build_object('field','container_no'));
  end if;
  if p_container_no !~ '^[A-Z]{3}[UJZ][0-9]{7}$' then
    return ops_core.invalid('delivery','delivery', p_delivery_no, p_action, 'bad_container_no',
      format('%s bukan nomor kontainer: empat huruf (yang keempat U, J atau Z) lalu tujuh angka, mis. MSKU1234565.', p_container_no),
      jsonb_build_object('field','container_no'));
  end if;
  if p_size is not null and p_size not in ('20','40','40HC') then
    return ops_core.invalid('delivery','delivery', p_delivery_no, p_action, 'bad_size',
      format('Ukuran %s tidak dikenal: 20, 40 atau 40HC.', p_size), jsonb_build_object('field','container_size'));
  end if;
  if p_etd is not null and p_eta is not null and p_eta < p_etd then
    return ops_core.invalid('delivery','delivery', p_delivery_no, p_action, 'eta_before_etd',
      'ETA tidak bisa sebelum ETD.', jsonb_build_object('field','eta'));
  end if;
  select d.delivery_no into v_clash
    from ops_dlv.deliveries d
   where d.container_no = p_container_no and d.status in ('DRAFT','IN_TRANSIT')
     and d.delivery_no is distinct from p_delivery_no
   limit 1;
  if v_clash is not null then
    return ops_core.conflict('delivery','delivery', p_delivery_no, p_action, 'container_in_use',
      format('Kontainer %s masih dalam perjalanan di %s. Satu kontainer tidak bisa di dua kapal.', p_container_no, v_clash),
      jsonb_build_object('delivery_no', v_clash));
  end if;
  return null;
end $$;

-- A container loaded for a project: what is in it per order line, the
-- container's number, seal and size, the factory order it came from, and the
-- ship's dates. Everything a consignment does is `create_delivery`'s.
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

-- The container's details as they become known: the seal at loading, the B/L
-- a week later, an ETA that moves. Every value is the one the screen holds —
-- null clears. Until it arrives; after that it is the record of a voyage.
create or replace function ops_dlv.update_container(
  p_delivery_no text, p_container_no text, p_seal_no text, p_container_size text,
  p_etd date, p_eta date, p_bl_no text)
returns jsonb
language plpgsql security definer
set search_path = ops_dlv, ops_core, pg_temp
as $$
declare d ops_dlv.deliveries; v_no text; v_size text; v_bad jsonb; v_warn jsonb := '[]'::jsonb;
begin
  if not ops_core.has_permission('delivery.update') then
    return ops_core.refused('delivery','delivery', p_delivery_no,'update_container',
      'not_permitted','Mengubah data kontainer butuh akses pengiriman (update).');
  end if;
  select * into d from ops_dlv.deliveries where delivery_no = p_delivery_no;
  if not found then
    return ops_core.not_found('delivery','delivery', p_delivery_no,'update_container', format('Tidak ada pengiriman %s.', p_delivery_no));
  end if;
  if d.delivery_mode <> 'container' then
    return ops_core.invalid('delivery','delivery', p_delivery_no,'update_container', 'not_a_container',
      format('%s adalah pengiriman truk, bukan kontainer.', p_delivery_no));
  end if;
  if d.status in ('ARRIVED','CANCELLED') then
    return ops_core.conflict('delivery','delivery', p_delivery_no,'update_container', 'closed',
      format('%s sudah %s; datanya tidak diubah lagi.', p_delivery_no, case d.status when 'ARRIVED' then 'sampai' else 'dibatalkan' end));
  end if;
  v_no := ops_dlv.container_no_clean(p_container_no);
  v_size := nullif(upper(btrim(coalesce(p_container_size, ''))), '');
  v_bad := ops_dlv.container_fields_refusal(p_delivery_no, 'update_container', v_no, v_size, p_etd, p_eta);
  if v_bad is not null then return v_bad; end if;

  if v_no = d.container_no and v_size is not distinct from d.container_size
     and nullif(upper(btrim(p_seal_no)), '') is not distinct from d.seal_no
     and p_etd is not distinct from d.etd and p_eta is not distinct from d.eta
     and nullif(upper(btrim(p_bl_no)), '') is not distinct from d.bl_no then
    return ops_core.noop('delivery','delivery', p_delivery_no,'update_container', 'tidak ada yang berubah', '{}'::jsonb);
  end if;

  update ops_dlv.deliveries
     set container_no = v_no, seal_no = nullif(upper(btrim(p_seal_no)), ''), container_size = v_size,
         etd = p_etd, eta = p_eta, bl_no = nullif(upper(btrim(p_bl_no)), '')
   where id = d.id;

  if ops_dlv.container_check_digit(v_no) <> right(v_no, 1)::int then
    v_warn := v_warn || to_jsonb(format('Angka terakhir %s tidak cocok dengan rumus ISO (seharusnya %s). Cek lagi foto pintu kontainernya.',
                                        v_no, ops_dlv.container_check_digit(v_no)));
  end if;
  perform ops_core.emit('delivery','delivery.container.updated', p_delivery_no,
    jsonb_build_object('delivery_no', p_delivery_no,
                       'from', jsonb_build_object('container_no', d.container_no, 'etd', d.etd, 'eta', d.eta, 'bl_no', d.bl_no),
                       'to',   jsonb_build_object('container_no', v_no, 'etd', p_etd, 'eta', p_eta, 'bl_no', nullif(upper(btrim(p_bl_no)), ''))));
  return ops_core.ok('delivery','delivery', p_delivery_no,'update_container',
    jsonb_build_object('delivery_no', p_delivery_no, 'warnings', v_warn));
end $$;
revoke all on function ops_dlv.update_container(text, text, text, text, date, date, text) from public;
grant execute on function ops_dlv.update_container(text, text, text, text, date, date, text) to authenticated;

-- A packing list or B/L, uploaded against the delivery, linked to it. The
-- upload put it in the right folder already; this says which container it is.
create or replace function ops_dlv.file_container_doc(p_delivery_no text, p_kind text, p_attachment_id uuid)
returns jsonb
language plpgsql security definer
set search_path = ops_dlv, ops_core, pg_temp
as $$
declare d ops_dlv.deliveries; v_kind text;
begin
  if not ops_core.has_permission('delivery.update') then
    return ops_core.refused('delivery','delivery', p_delivery_no,'file_doc',
      'not_permitted','Melampirkan dokumen kontainer butuh akses pengiriman (update).');
  end if;
  select * into d from ops_dlv.deliveries where delivery_no = p_delivery_no;
  if not found then
    return ops_core.not_found('delivery','delivery', p_delivery_no,'file_doc', format('Tidak ada pengiriman %s.', p_delivery_no));
  end if;
  if d.delivery_mode <> 'container' then
    return ops_core.invalid('delivery','delivery', p_delivery_no,'file_doc', 'not_a_container',
      format('%s adalah pengiriman truk; packing list dan B/L milik kontainer.', p_delivery_no));
  end if;
  v_kind := case lower(btrim(coalesce(p_kind, '')))
              when 'packing_list' then 'packing_list' when 'packing list' then 'packing_list'
              when 'bill_of_lading' then 'bill_of_lading' when 'bill of lading' then 'bill_of_lading'
              when 'bl' then 'bill_of_lading' when 'b/l' then 'bill_of_lading' end;
  if v_kind is null then
    return ops_core.invalid('delivery','delivery', p_delivery_no,'file_doc', 'unknown_kind',
      'Dokumen kontainer adalah packing list atau B/L.', jsonb_build_object('field','kind'));
  end if;
  if p_attachment_id is null or not exists (select 1 from ops_core.attachments where id = p_attachment_id) then
    return ops_core.invalid('delivery','delivery', p_delivery_no,'file_doc', 'no_such_file',
      'File itu tidak ada. Unggah dulu.', jsonb_build_object('field','attachment_id'));
  end if;
  perform ops_dlv.file_evidence(p_attachment_id, 'delivery', d.delivery_no, v_kind);
  return ops_core.ok('delivery','delivery', p_delivery_no,'file_doc',
    jsonb_build_object('delivery_no', d.delivery_no, 'kind', v_kind, 'attachment_id', p_attachment_id));
end $$;
revoke all on function ops_dlv.file_container_doc(text, text, uuid) from public;
grant execute on function ops_dlv.file_container_doc(text, text, uuid) to authenticated;

-- ── 4. views ──────────────────────────────────────────────────────────────

-- The number of the factory order a container was loaded from, for whoever
-- reads deliveries — logistics does not read purchase orders, and the number
-- is all it needs (definer, nothing else of the order).
create or replace function ops_dlv.po_no_of(p_po_id uuid)
returns text
language sql stable security definer
set search_path = ops_dlv, ops_core, pg_temp
as $$
  select p.po_no from ops_procure.purchase_orders p
   where p.id = p_po_id and ops_dlv.can_read()
$$;
revoke all on function ops_dlv.po_no_of(uuid) from public;
grant execute on function ops_dlv.po_no_of(uuid) to authenticated;

-- v_delivery (0132): the container's fields, its factory order, its papers,
-- and how far past its ETA it is while it has not arrived.
create or replace view ops_dlv.v_delivery with (security_invoker = on) as
select b.*,
       d.delivery_mode,
       ops_dlv.po_no_of(d.po_id) as po_no,
       d.container_no,
       d.seal_no,
       d.container_size,
       d.etd,
       d.eta,
       d.bl_no,
       coalesce((select jsonb_agg(jsonb_build_object('attachment_id', a.id, 'kind', k.kind, 'filename', a.filename,
                                                     'url', coalesce(a.web_view_link, a.url), 'linked_at', k.linked_at)
                                  order by k.linked_at)
                   from ops_core.attachment_links k
                   join ops_core.attachments a on a.id = k.attachment_id
                  where k.entity = 'delivery' and k.entity_no = d.delivery_no and k.unlinked_at is null
                    and k.kind in ('packing_list','bill_of_lading')), '[]'::jsonb) as container_docs,
       case when d.delivery_mode = 'container' and d.eta is not null and d.status = 'IN_TRANSIT'
                 and ops_core.office_day() > d.eta
            then ops_core.office_day() - d.eta end as days_past_eta
  from (
    SELECT d.id,
        d.delivery_no,
        d.project_code,
        d.dispatched_on,
        d.vehicle,
        d.driver,
        d.status,
        d.received_by,
        d.received_at,
        d.surat_jalan_attachment_id,
        d.photo_attachment_id,
        d.note,
        d.cancelled_reason,
        d.created_by,
        d.created_at,
        p.name AS project_name,
        COALESCE(c.name, p.client_name) AS client_name,
        p.location,
        COALESCE(( SELECT sum(x.qty) AS sum
               FROM ops_dlv.delivery_lines x
              WHERE x.delivery_id = d.id), 0::numeric) AS total_qty
       FROM ops_dlv.deliveries d
         LEFT JOIN ops_procure.projects p ON p.code = d.project_code
         LEFT JOIN ops_procure.clients c ON c.id = p.client_id
       ) b
  join ops_dlv.deliveries d on d.id = b.id;

analyze ops_dlv.deliveries;
