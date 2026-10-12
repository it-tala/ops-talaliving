-- 0262_procure_design_flat.sql — a design is collection → item; rooms leave
-- the screens, and a client's item keeps the client's own code (D419).
--
-- ── What the owner asked ──────────────────────────────────────────────────
--
-- *lebih baik kita sederhanakan, tidak perlu ada pembagian per ruangan, cukup
-- per koleksi gambar saja, dan kode item jangan digenerate otomatis jika dari
-- desain client* (2026-10-12), looking at project 25009, where a catalogue
-- item from the client (Living Ikon's `LV232-B01 Queen Bed`) had become
-- `25009-LV232-B-01` — a number we made up for a thing that already had one —
-- and where nothing typed wrong could be put right from the board.
--
-- ── What this changes ─────────────────────────────────────────────────────
--
--   design_items.client_item_code   the client's own code for the item, typed,
--                                   never generated. Required when the client
--                                   designed it; optional otherwise. Unique in
--                                   the project. It names the item on every
--                                   screen and its Drive folder.
--   one room per collection         `design_rooms` stays, because twelve views
--                                   and functions join through it, but the
--                                   screens no longer show it: every
--                                   collection has one room, code `00`, named
--                                   after the collection, made with it.
--                                   Existing items move into it (their numbers
--                                   do not change — files and tasks are filed
--                                   by number). A new item is numbered
--                                   `<project>-<collection>-<nn>`, without a
--                                   room. `save_design_room` and an explicit
--                                   room code still work for what already
--                                   calls them.
--   save_design_item                gains `p_client_item_code`; the room code
--                                   may be left out.
--   remove_design_item              an item typed by mistake is removed — only
--                                   while nothing hangs on it (a file, an
--                                   approval, a quotation or order line, a
--                                   factory price, a spec, a task, a meeting
--                                   point). Anything else is dropped with a
--                                   reason, as before: once it was offered it
--                                   is part of the sale's record.
--   Drive                           an item's folder is
--                                   `<client>/<project>/KOLEKSI …/<code> <name>`
--                                   — no room level.
--
-- ── Applying this to production ───────────────────────────────────────────
--
-- `remove_design_item` deletes one row, and only an item nothing refers to;
-- the Supabase connector holds any statement with that word for confirmation
-- (F226). The data step moves items between rooms and touches no number.

-- ── 1. the client's code ──────────────────────────────────────────────────

alter table ops_procure.design_items
  add column client_item_code text
    check (client_item_code is null or length(btrim(client_item_code)) between 1 and 40);

comment on column ops_procure.design_items.client_item_code is
  'The client''s own code for the item (LV232-B01), typed — required when origin = client. Unique in the project. (0262, D419)';

-- ── 2. one room per collection ────────────────────────────────────────────

-- The collection's room: code 00, named after the collection. Made on first
-- use, so a collection from before this migration gets one too.
create or replace function ops_procure.collection_room(p_collection_id uuid)
returns uuid
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare v_id uuid;
begin
  select r.id into v_id from ops_procure.design_rooms r
   where r.collection_id = p_collection_id and r.code = '00';
  if v_id is null then
    insert into ops_procure.design_rooms (collection_id, code, name, sort, created_by)
    select c.id, '00', c.name, 0, auth.uid() from ops_procure.design_collections c where c.id = p_collection_id
    returning id into v_id;
  end if;
  return v_id;
end $$;
revoke all on function ops_procure.collection_room(uuid) from public;
grant execute on function ops_procure.collection_room(uuid) to authenticated;

comment on function ops_procure.collection_room(uuid) is
  'The one room of a collection (code 00), made on first use. Rooms are not shown on any screen. (0262, D419)';

-- Every existing item into its collection's room, numbered after what is
-- already there. Item numbers stay: files and tasks are filed by them.
do $$
declare c record; v_room uuid;
begin
  for c in select id from ops_procure.design_collections loop
    v_room := ops_procure.collection_room(c.id);
    with moving as (
      select i.id, row_number() over (order by r.sort, r.code, i.seq) as n
        from ops_procure.design_items i
        join ops_procure.design_rooms r on r.id = i.room_id
       where r.collection_id = c.id and r.id <> v_room
    ), base as (
      select coalesce(max(seq), 0) as top from ops_procure.design_items where room_id = v_room
    )
    update ops_procure.design_items i
       set room_id = v_room, seq = base.top + moving.n
      from moving, base
     where i.id = moving.id;
  end loop;
end $$;

-- ── 3. a collection: made with its room, renamed with it ──────────────────

create or replace function ops_procure.save_design_collection(
  p_project_code text, p_code text, p_name text, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare pr ops_procure.projects; c ops_procure.design_collections; v_id uuid;
        v_code text := upper(btrim(coalesce(p_code, ''))); v_name text := btrim(coalesce(p_name, ''));
begin
  if not ops_procure.may_design('update') then
    return ops_core.refused('project','design_collection', p_project_code,'save',
      'not_permitted','Mengubah desain butuh akses proyek, marketing, atau produksi (update).');
  end if;
  select * into pr from ops_procure.projects where code = btrim(coalesce(p_project_code, ''));
  if not found then
    return ops_core.not_found('project','design_collection', p_project_code,'save', format('Tidak ada proyek %s.', p_project_code));
  end if;
  if v_code !~ '^[A-Z0-9]{1,6}$' then
    return ops_core.invalid('project','design_collection', pr.code,'save', 'bad_code',
      'Kode koleksi 1–6 huruf atau angka, mis. A, B, LV232. Kode ini masuk ke nomor setiap item.',
      jsonb_build_object('field','code'));
  end if;
  if v_name = '' then
    return ops_core.invalid('project','design_collection', pr.code,'save', 'name_required',
      'Koleksinya dinamai apa? mis. LEXI COLLECTION.', jsonb_build_object('field','name'));
  end if;

  select * into c from ops_procure.design_collections where project_id = pr.id and code = v_code;
  if found then
    update ops_procure.design_collections
       set name = v_name, note = nullif(btrim(p_note), ''), updated_at = now()
     where id = c.id;
    update ops_procure.design_rooms set name = v_name, updated_at = now()
     where id = ops_procure.collection_room(c.id);
    return ops_core.ok('project','design_collection', pr.code || '-' || v_code,'update',
      jsonb_build_object('project_code', pr.code, 'code', v_code),
      jsonb_build_object('name', c.name, 'note', c.note),
      jsonb_build_object('name', v_name, 'note', nullif(btrim(p_note), '')));
  end if;
  insert into ops_procure.design_collections (project_id, code, name, note, created_by)
  values (pr.id, v_code, v_name, nullif(btrim(p_note), ''), auth.uid())
  returning id into v_id;
  perform ops_procure.collection_room(v_id);
  return ops_core.ok('project','design_collection', pr.code || '-' || v_code,'create',
    jsonb_build_object('project_code', pr.code, 'code', v_code));
end $$;
revoke all on function ops_procure.save_design_collection(text, text, text, text) from public;
grant execute on function ops_procure.save_design_collection(text, text, text, text) to authenticated;

-- ── 4. an item: in its collection, named by the client's code ─────────────

drop function ops_procure.save_design_item(text, text, text, text, numeric, text, numeric, numeric, numeric, text, text);

-- Created in a collection (the room code may be left out: it goes in the
-- collection's room and is numbered <project>-<collection>-<nn>), or corrected
-- by its number. The client's code is typed; it is never made up.
create or replace function ops_procure.save_design_item(
  p_project_code text, p_collection_code text, p_room_code text,
  p_name text, p_qty numeric, p_origin text,
  p_length_mm numeric default null, p_width_mm numeric default null, p_height_mm numeric default null,
  p_note text default null, p_item_no text default null, p_client_item_code text default null)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare r ops_procure.design_rooms; i ops_procure.design_items; v_seq int; v_no text;
        v_coll uuid; v_project uuid; v_taken text;
        v_name text := btrim(coalesce(p_name, '')); v_origin text := lower(btrim(coalesce(p_origin, '')));
        v_ccode text := nullif(btrim(coalesce(p_client_item_code, '')), '');
        v_room_code text := upper(btrim(coalesce(p_room_code, '')));
        v_ref text := coalesce(nullif(btrim(p_item_no), ''),
                               btrim(coalesce(p_project_code, '')) || '-' || upper(btrim(coalesce(p_collection_code, ''))));
begin
  if not ops_procure.may_design('update') then
    return ops_core.refused('project','design_item', v_ref,'save',
      'not_permitted','Mengubah desain butuh akses proyek, marketing, atau produksi (update).');
  end if;
  if v_name = '' then
    return ops_core.invalid('project','design_item', v_ref,'save', 'name_required',
      'Itemnya apa? mis. Queen Bed.', jsonb_build_object('field','name'));
  end if;
  if p_qty is null or p_qty <= 0 then
    return ops_core.invalid('project','design_item', v_ref,'save', 'qty_required',
      'Berapa unit?', jsonb_build_object('field','qty'));
  end if;
  if v_origin not in ('tala','client','adapted') then
    return ops_core.invalid('project','design_item', v_ref,'save', 'unknown_origin',
      'Siapa yang mendesain: tala, client, atau adapted (dari referensi klien)?', jsonb_build_object('field','origin'));
  end if;
  if v_origin = 'client' and v_ccode is null then
    return ops_core.invalid('project','design_item', v_ref,'save', 'client_code_required',
      'Desain dari klien memakai kode item klien, mis. LV232-B01. Kodenya tidak dibuat sistem.',
      jsonb_build_object('field','client_item_code'));
  end if;
  if length(coalesce(v_ccode, '')) > 40 then
    return ops_core.invalid('project','design_item', v_ref,'save', 'bad_client_code',
      'Kode item klien paling panjang 40 huruf.', jsonb_build_object('field','client_item_code'));
  end if;
  if coalesce(p_length_mm, 1) <= 0 or coalesce(p_width_mm, 1) <= 0 or coalesce(p_height_mm, 1) <= 0 then
    return ops_core.invalid('project','design_item', v_ref,'save', 'bad_size',
      'Ukuran dalam mm, lebih dari nol — atau kosongkan.', jsonb_build_object('field','length_mm'));
  end if;

  if nullif(btrim(p_item_no), '') is not null then
    select * into i from ops_procure.design_items where item_no = btrim(p_item_no);
    if not found then
      return ops_core.not_found('project','design_item', p_item_no,'update', format('Tidak ada item %s.', p_item_no));
    end if;
    select dc.project_id into v_project from ops_procure.design_rooms dr
      join ops_procure.design_collections dc on dc.id = dr.collection_id where dr.id = i.room_id;
  else
    select dc.id, dc.project_id into v_coll, v_project from ops_procure.design_collections dc
      join ops_procure.projects p on p.id = dc.project_id
     where p.code = btrim(coalesce(p_project_code, ''))
       and dc.code = upper(btrim(coalesce(p_collection_code, '')));
    if v_coll is null then
      return ops_core.not_found('project','design_item', v_ref,'create', format('Tidak ada koleksi %s.', v_ref));
    end if;
  end if;

  -- The client's code names one item in the project.
  if v_ccode is not null then
    select x.item_no into v_taken from ops_procure.design_items x
      join ops_procure.design_rooms dr on dr.id = x.room_id
      join ops_procure.design_collections dc on dc.id = dr.collection_id
     where dc.project_id = v_project and upper(x.client_item_code) = upper(v_ccode)
       and x.id is distinct from i.id
     limit 1;
    if v_taken is not null then
      return ops_core.conflict('project','design_item', v_ref,'save', 'client_code_taken',
        format('Kode %s sudah dipakai item lain di proyek ini.', v_ccode),
        jsonb_build_object('field','client_item_code', 'item_no', v_taken));
    end if;
  end if;

  if i.id is not null then
    update ops_procure.design_items set
      name = v_name, qty = p_qty, origin = v_origin, client_item_code = v_ccode,
      length_mm = p_length_mm, width_mm = p_width_mm, height_mm = p_height_mm,
      note = nullif(btrim(p_note), ''), updated_at = now()
    where id = i.id;
    return ops_core.ok('project','design_item', i.item_no,'update', jsonb_build_object('item_no', i.item_no),
      to_jsonb(i), (select to_jsonb(x) from ops_procure.design_items x where x.id = i.id));
  end if;

  if v_room_code = '' then
    select * into r from ops_procure.design_rooms where id = ops_procure.collection_room(v_coll);
    select coalesce(max(seq), 0) + 1 into v_seq from ops_procure.design_items where room_id = r.id;
    v_no := v_ref || '-' || lpad(v_seq::text, 2, '0');
    -- An older item (from before rooms left the screen) can hold the number.
    while exists (select 1 from ops_procure.design_items where item_no = v_no) loop
      v_seq := v_seq + 1;
      v_no := v_ref || '-' || lpad(v_seq::text, 2, '0');
    end loop;
  else
    select * into r from ops_procure.design_rooms where collection_id = v_coll and code = v_room_code;
    if not found then
      return ops_core.not_found('project','design_item', v_ref || '-' || v_room_code,'create',
        format('Tidak ada ruangan %s.', v_ref || '-' || v_room_code));
    end if;
    select coalesce(max(seq), 0) + 1 into v_seq from ops_procure.design_items where room_id = r.id;
    v_no := v_ref || '-' || v_room_code || '-' || lpad(v_seq::text, 2, '0');
  end if;
  insert into ops_procure.design_items (item_no, room_id, seq, name, qty, length_mm, width_mm, height_mm,
                                        origin, client_item_code, note, created_by)
  values (v_no, r.id, v_seq, v_name, p_qty, p_length_mm, p_width_mm, p_height_mm,
          v_origin, v_ccode, nullif(btrim(p_note), ''), auth.uid());
  return ops_core.ok('project','design_item', v_no,'create', jsonb_build_object('item_no', v_no));
end $$;
revoke all on function ops_procure.save_design_item(text, text, text, text, numeric, text, numeric, numeric, numeric, text, text, text) from public;
grant execute on function ops_procure.save_design_item(text, text, text, text, numeric, text, numeric, numeric, numeric, text, text, text) to authenticated;

-- ── 5. an item typed by mistake ───────────────────────────────────────────

-- Removed only while nothing refers to it. What it carries is named, so the
-- person knows to drop it instead.
create or replace function ops_procure.remove_design_item(p_item_no text)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare i ops_procure.design_items; v_uses text[];
begin
  if not ops_procure.may_design('update') then
    return ops_core.refused('project','design_item', p_item_no,'remove',
      'not_permitted','Mengubah desain butuh akses proyek, marketing, atau produksi (update).');
  end if;
  select * into i from ops_procure.design_items where item_no = btrim(coalesce(p_item_no, ''));
  if not found then
    return ops_core.not_found('project','design_item', p_item_no,'remove', format('Tidak ada item %s.', p_item_no));
  end if;
  v_uses := array_remove(array[
    case when exists (select 1 from ops_core.attachment_links l
                       where l.entity = 'design_item' and l.entity_no = i.item_no) then 'file' end,
    case when exists (select 1 from ops_procure.design_approvals a where a.item_id = i.id) then 'persetujuan klien' end,
    case when exists (select 1 from ops_procure.quotation_lines q where q.design_item_id = i.id) then 'quotation' end,
    case when exists (select 1 from ops_procure.project_lines q where q.design_item_id = i.id) then 'baris order' end,
    case when exists (select 1 from ops_procure.factory_quote_lines q where q.design_item_id = i.id) then 'harga pabrik' end,
    case when exists (select 1 from ops_procure.meeting_points q where q.design_item_id = i.id) then 'butir meeting' end,
    case when exists (select 1 from ops_procure.design_item_specs q where q.item_id = i.id)
           or exists (select 1 from ops_procure.design_box_skips q where q.item_id = i.id) then 'kotak Studio Desain' end,
    case when exists (select 1 from ops_prod.design_tasks t where t.item_no = i.item_no)
           or exists (select 1 from ops_hr.tasks t where t.ref_kind = 'design_item' and t.ref_no = i.item_no) then 'tugas' end
  ], null);
  if cardinality(v_uses) > 0 then
    return ops_core.conflict('project','design_item', i.item_no,'remove', 'item_in_use',
      format('Item ini sudah punya %s, jadi tidak bisa dihapus. Keluarkan dari desain dengan alasan.',
             array_to_string(v_uses, ', ')),
      jsonb_build_object('uses', to_jsonb(v_uses)));
  end if;
  delete from ops_procure.design_items where id = i.id;
  return ops_core.ok('project','design_item', i.item_no,'remove', jsonb_build_object('item_no', i.item_no),
    to_jsonb(i), null);
end $$;
revoke all on function ops_procure.remove_design_item(text) from public;
grant execute on function ops_procure.remove_design_item(text) to authenticated;

-- ── 6. Drive: no room level, the client's code on the folder ──────────────

create or replace function ops_procure.drive_context_design(p_entity text, p_entity_no text)
returns table (collection_folder text, room_folder text, item_folder text)
language sql stable security definer set search_path = ops_procure, ops_core, pg_temp as $$
  select ops_core.drive_segment('KOLEKSI ' || dc.code || ' ' || dc.name),
         ops_core.drive_segment(dr.name),
         ops_core.drive_segment(coalesce(di.client_item_code, di.item_no) || ' ' || di.name)
    from ops_procure.design_items di
    join ops_procure.design_rooms dr on dr.id = di.room_id
    join ops_procure.design_collections dc on dc.id = dr.collection_id
   where p_entity = 'design_item' and di.item_no = btrim(p_entity_no)
  union all
  select ops_core.drive_segment('KOLEKSI ' || dc.code || ' ' || dc.name), null, null
    from ops_procure.design_collections dc
    join ops_procure.projects x on x.id = dc.project_id
   where p_entity = 'design_collection' and x.code || '-' || dc.code = btrim(p_entity_no);
$$;
revoke all on function ops_procure.drive_context_design(text, text) from public;
grant execute on function ops_procure.drive_context_design(text, text) to authenticated;

update ops_core.drive_paths
   set path = replace(path, '/{ROOM}', '')
 where entity = 'design_item' and path like '%/{ROOM}/%';

-- ── 7. what the screens read ──────────────────────────────────────────────

-- `create or replace view` drops the view's options (F229).
create or replace view ops_procure.v_design_item as
 SELECT i.id,
    i.item_no,
    i.seq,
    i.name,
    i.qty,
    i.length_mm,
    i.width_mm,
    i.height_mm,
    i.origin,
    COALESCE(i.product_code, od.product_code) AS product_code,
    i.note,
    i.dropped_at,
    i.drop_reason,
    i.created_at,
    i.updated_at,
    r.code AS room_code,
    r.name AS room_name,
    r.sort AS room_sort,
    c.code AS collection_code,
    c.name AS collection_name,
    p.code AS project_code,
    p.name AS project_name,
    cl.code AS client_code,
    COALESCE(cl.name, p.client_name) AS client_display,
    COALESCE(f.design_files, 0) AS design_files,
    COALESCE(f.client_files, 0) AS client_files,
    COALESCE(f.all_files, 0) AS all_files,
    ap.decision AS approval_decision,
    ap.decided_on AS approval_on,
    ap.channel AS approval_channel,
    ap.client_person AS approval_by,
        CASE
            WHEN (i.dropped_at IS NOT NULL) THEN 'DROPPED'::text
            WHEN od.ordered THEN 'ORDERED'::text
            WHEN (qt.quote_no IS NOT NULL) THEN 'QUOTED'::text
            WHEN (ap.decision = 'approved'::text) THEN 'APPROVED'::text
            WHEN (COALESCE(f.drawn, 0) > 0) THEN 'DRAWN'::text
            ELSE 'CONCEPT'::text
        END AS status,
    qt.quote_no,
    qt.quote_status,
    qt.unit_price AS quoted_unit_price,
    COALESCE(od.ordered, false) AS ordered,
        CASE
            WHEN ops_procure.may_price_factory('read'::text) THEN fo.fq_no
            ELSE NULL::text
        END AS factory_quote_no,
        CASE
            WHEN ops_procure.may_price_factory('read'::text) THEN fo.vendor_name
            ELSE NULL::text
        END AS factory_vendor_name,
        CASE
            WHEN ops_procure.may_price_factory('read'::text) THEN fo.unit_price
            ELSE NULL::numeric
        END AS factory_unit_price,
        CASE
            WHEN ops_procure.may_price_factory('read'::text) THEN fo.currency
            ELSE NULL::text
        END AS factory_currency,
        CASE
            WHEN ops_procure.may_price_factory('read'::text) THEN fo.lead_time_days
            ELSE NULL::integer
        END AS factory_lead_time_days,
        CASE
            WHEN ops_procure.may_price_factory('read'::text) THEN COALESCE(fc.offers, 0)
            ELSE 0
        END AS factory_offers,
    i.client_item_code
   FROM ((((((((((ops_procure.design_items i
     JOIN ops_procure.design_rooms r ON ((r.id = i.room_id)))
     JOIN ops_procure.design_collections c ON ((c.id = r.collection_id)))
     JOIN ops_procure.projects p ON ((p.id = c.project_id)))
     LEFT JOIN ops_procure.clients cl ON ((cl.id = p.client_id)))
     LEFT JOIN LATERAL ( SELECT (count(*) FILTER (WHERE (l.kind = ANY (ARRAY['render'::ops_core.doc_kind_t, 'moodboard'::ops_core.doc_kind_t, 'layout'::ops_core.doc_kind_t, 'gambar_kerja'::ops_core.doc_kind_t, 'gambar_jadi'::ops_core.doc_kind_t]))))::integer AS design_files,
            (count(*) FILTER (WHERE (l.kind = ANY (ARRAY['gambar_klien'::ops_core.doc_kind_t, 'referensi_klien'::ops_core.doc_kind_t]))))::integer AS client_files,
            (count(*))::integer AS all_files,
            (count(*) FILTER (WHERE (l.kind = ANY (ARRAY['render'::ops_core.doc_kind_t, 'layout'::ops_core.doc_kind_t, 'gambar_kerja'::ops_core.doc_kind_t, 'gambar_jadi'::ops_core.doc_kind_t, 'gambar_klien'::ops_core.doc_kind_t]))))::integer AS drawn
           FROM ops_core.attachment_links l
          WHERE ((l.entity = 'design_item'::ops_core.link_entity_t) AND (l.entity_no = i.item_no) AND (l.unlinked_at IS NULL))) f ON (true))
     LEFT JOIN LATERAL ( SELECT a.decision,
            a.decided_on,
            a.channel,
            a.client_person
           FROM ops_procure.design_approvals a
          WHERE (a.item_id = i.id)
          ORDER BY a.recorded_at DESC
         LIMIT 1) ap ON (true))
     LEFT JOIN LATERAL ( SELECT q.quote_no,
            (q.status)::text AS quote_status,
            ql.frozen_unit_price AS unit_price
           FROM (ops_procure.quotation_lines ql
             JOIN ops_procure.quotations q ON ((q.id = ql.quotation_id)))
          WHERE ((ql.design_item_id = i.id) AND (q.status <> 'DRAFT'::ops_procure.quotation_status_t))
          ORDER BY q.sent_at DESC NULLS LAST
         LIMIT 1) qt ON (true))
     LEFT JOIN LATERAL ( SELECT true AS ordered,
            max(pl.product_code) AS product_code
           FROM ops_procure.project_lines pl
          WHERE (pl.design_item_id = i.id)
         HAVING (count(*) > 0)) od ON (true))
     LEFT JOIN LATERAL ( SELECT fq.fq_no,
            fv.name AS vendor_name,
            fl.unit_price,
            fq.currency,
            fl.lead_time_days
           FROM ((ops_procure.factory_quote_lines fl
             JOIN ops_procure.factory_quotes fq ON ((fq.id = fl.quote_id)))
             LEFT JOIN ops_procure.vendors fv ON ((fv.id = fq.vendor_id)))
          WHERE ((fl.id = i.factory_line_id) AND (fq.voided_at IS NULL))) fo ON (true))
     LEFT JOIN LATERAL ( SELECT (count(*))::integer AS offers
           FROM (ops_procure.factory_quote_lines fl
             JOIN ops_procure.factory_quotes fq ON ((fq.id = fl.quote_id)))
          WHERE ((fl.design_item_id = i.id) AND (fq.voided_at IS NULL))) fc ON (true));
alter view ops_procure.v_design_item set (security_invoker = on);
grant select on ops_procure.v_design_item to authenticated;

-- A quotation names a client's item by the client's code (the print goes to
-- the client).
create or replace view ops_procure.v_quotation_line as
 SELECT x.id,
    x.quotation_id,
    b.quote_no,
    b.status,
    x.line_no,
    x.product_code,
    x.description,
    x.qty,
    x.uom,
    COALESCE(x.lead_time_days, b.product_lead_time_days) AS lead_time_days,
    b.product_exists,
    x.note,
    (x.manual_unit_cost IS NOT NULL) AS cost_is_manual,
    (b.unit_cost IS NULL) AS cost_missing,
    ops_core.has_permission('project.update'::text) AS cost_visible,
        CASE
            WHEN ops_core.has_permission('project.update'::text) THEN b.unit_cost
            ELSE NULL::numeric
        END AS unit_cost,
        CASE
            WHEN ops_core.has_permission('project.update'::text) THEN b.cost_source
            ELSE NULL::text
        END AS cost_source,
        CASE
            WHEN (b.status = 'DRAFT'::ops_procure.quotation_status_t) THEN b.bom_rev_now
            ELSE x.frozen_bom_rev
        END AS bom_rev,
        CASE
            WHEN ops_core.has_permission('project.update'::text) THEN
            CASE
                WHEN (b.status = 'DRAFT'::ops_procure.quotation_status_t) THEN b.eff_marketing_pct
                ELSE x.frozen_marketing_pct
            END
            ELSE NULL::numeric
        END AS marketing_pct,
        CASE
            WHEN ops_core.has_permission('project.update'::text) THEN
            CASE
                WHEN (b.status = 'DRAFT'::ops_procure.quotation_status_t) THEN b.eff_overhead_pct
                ELSE x.frozen_overhead_pct
            END
            ELSE NULL::numeric
        END AS overhead_pct,
        CASE
            WHEN ops_core.has_permission('project.update'::text) THEN
            CASE
                WHEN (b.status = 'DRAFT'::ops_procure.quotation_status_t) THEN b.eff_margin_pct
                ELSE x.frozen_margin_pct
            END
            ELSE NULL::numeric
        END AS margin_pct,
    ((x.marketing_pct IS NOT NULL) OR (x.overhead_pct IS NOT NULL) OR (x.margin_pct IS NOT NULL)) AS pct_overridden,
    x.lead_time_days AS line_lead_time_days,
        CASE
            WHEN ops_core.has_permission('project.update'::text) THEN x.manual_unit_cost
            ELSE NULL::numeric
        END AS manual_unit_cost,
        CASE
            WHEN ops_core.has_permission('project.update'::text) THEN x.marketing_pct
            ELSE NULL::numeric
        END AS line_marketing_pct,
        CASE
            WHEN ops_core.has_permission('project.update'::text) THEN x.overhead_pct
            ELSE NULL::numeric
        END AS line_overhead_pct,
        CASE
            WHEN ops_core.has_permission('project.update'::text) THEN x.margin_pct
            ELSE NULL::numeric
        END AS line_margin_pct,
        CASE
            WHEN ops_core.has_permission('project.update'::text) THEN ops_procure.quote_price_in(b.unit_cost, b.eff_marketing_pct, b.eff_overhead_pct, b.eff_margin_pct, b.currency)
            ELSE NULL::numeric
        END AS computed_unit_price,
    x.unit_price_override,
        CASE
            WHEN (b.status = 'DRAFT'::ops_procure.quotation_status_t) THEN COALESCE(x.unit_price_override, ops_procure.quote_price_in(b.unit_cost, b.eff_marketing_pct, b.eff_overhead_pct, b.eff_margin_pct, b.currency))
            ELSE x.frozen_unit_price
        END AS unit_price,
    di.item_no AS design_item_no,
    di.name AS design_item_name,
    dc.code AS collection_code,
    dc.name AS collection_name,
    dr.code AS room_code,
    dr.name AS room_name,
    dr.sort AS room_sort,
    x.design_file_id AS line_design_file_id,
    d.eff_file AS design_file_id,
    fa.filename AS design_file_name,
    d.latest_file AS latest_design_file_id,
    ((d.eff_file IS NOT NULL) AND (d.latest_file IS NOT NULL) AND (d.latest_file <> d.eff_file)) AS design_changed,
    b.currency,
    b.fx_rate,
        CASE
            WHEN ops_core.has_permission('project.update'::text) THEN b.cost_currency
            ELSE NULL::text
        END AS cost_currency,
        CASE
            WHEN ops_core.has_permission('project.update'::text) THEN b.cost_original
            ELSE NULL::numeric
        END AS cost_original,
        CASE
            WHEN ops_core.has_permission('project.update'::text) THEN b.factory_line_id
            ELSE NULL::uuid
        END AS factory_line_id,
        CASE
            WHEN ops_core.has_permission('project.update'::text) THEN b.factory_quote_no
            ELSE NULL::text
        END AS factory_quote_no,
        CASE
            WHEN ops_core.has_permission('project.update'::text) THEN b.factory_vendor_name
            ELSE NULL::text
        END AS factory_vendor_name,
    b.cost_needs_rate,
    di.client_item_code AS design_client_code
   FROM (((((((ops_procure.quotation_lines x
     JOIN ops_procure.v_quotation_line_basis b ON ((b.id = x.id)))
     CROSS JOIN LATERAL ( SELECT ops_procure.latest_design_file(x.design_item_id) AS latest_file) lf)
     CROSS JOIN LATERAL ( SELECT
                CASE
                    WHEN (b.status = 'DRAFT'::ops_procure.quotation_status_t) THEN COALESCE(x.design_file_id, lf.latest_file)
                    ELSE x.frozen_design_file_id
                END AS eff_file,
            lf.latest_file) d)
     LEFT JOIN ops_procure.design_items di ON ((di.id = x.design_item_id)))
     LEFT JOIN ops_procure.design_rooms dr ON ((dr.id = di.room_id)))
     LEFT JOIN ops_procure.design_collections dc ON ((dc.id = dr.collection_id)))
     LEFT JOIN ops_core.attachments fa ON ((fa.id = d.eff_file)));
alter view ops_procure.v_quotation_line set (security_invoker = on);
grant select on ops_procure.v_quotation_line to authenticated;

analyze ops_procure.design_items;
analyze ops_procure.design_rooms;
