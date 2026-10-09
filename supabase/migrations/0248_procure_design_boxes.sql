-- 0248_procure_design_boxes.sql — six boxes on every design item: what the
-- drafters have delivered, read rather than reported (Studio Desain S1,
-- D399–D405, kajian F247).
--
-- ── What the owner asked ──────────────────────────────────────────────────
--
-- *Intinya track progress dan track kelengkapan hasil kerja. Datanya seakurat
-- mungkin, kerjanya sesedikit mungkin* (2026-10-09), then: no Final, only the
-- latest version (D399); nothing required, so nothing errors (D401).
--
-- So an item has six boxes, and each is **empty**, **filled** or **not
-- needed**:
--
--   pdf     the working drawing        a `gambar_kerja` file on the item
--   dwg     its source                 a `dwg` file on the item (0247)
--   render  the render                 a `render` file on the item
--   foto    the item's picture         a `gambar_jadi` file on the item —
--                                      the finished-piece picture D150 asked
--                                      every product to carry
--   spec    the specification          a version in `design_item_specs`
--   bom     the bill of material       the item's product has a BOM revision
--
-- A box is filled by doing the work, never by saying so: an upload, a saved
-- specification, a BOM. **Uploading again is the next version** (A, B, C, by
-- the order the files were filed — a version keeps its letter even if a later
-- one is taken off); the latest is the one that counts (D399). Nothing here
-- refuses a quotation, an order or a Job Order for an empty box (D401).
--
-- *Not needed* is one tap, the note optional, and it counts as filled — a
-- design the client drew has no render, and without it the item could never
-- be complete (D403). It is a row, never an edit; *needed again* is another.
--
-- ── What this adds ────────────────────────────────────────────────────────
--
--   design_item_specs        the specification, versioned (append-only)
--   design_box_skips         *not needed* / *needed again* (append-only)
--   products.design_item_no  a product made from a design item before it is
--                            ordered (D400): inactive, so the catalogue does
--                            not show it, until an order line names it
--   save_design_spec, set_design_box_skip, product_from_design_item
--   v_design_box             one row per item and box: its state and latest
--   v_design_box_version     every version of every box, the box's history
--   v_design_project         the projects a drafter can work in, with their
--                            item count
--
-- ── Applying this to production ───────────────────────────────────────────
--
-- After `0247` (its own transaction). No drops; no function body removes a
-- row (F226). Every function is new.

-- ── 1. the DWG: label, drive, folder ──────────────────────────────────────

insert into ops_core.doc_kind_labels (kind, label) values ('dwg', 'DWG')
on conflict (kind) do nothing;
insert into ops_core.doc_kind_drive (kind, slug, rationale) values
  ('dwg', 'drafting', 'The drafter''s source file, kept beside the PDF it is plotted to (D399).')
on conflict (kind) do nothing;
insert into ops_core.drive_paths (kind, entity, path, note) values
  ('dwg', 'design_item', '{CLIENT}/{PROJECT}/{COLLECTION}/{ROOM}/{ITEM}', 'Beside the item''s PDF (Studio Desain S1).')
on conflict (kind, entity) do nothing;

-- A version's letter is the order its file was filed in. `now()` is the
-- transaction's start, so two files filed in one call would tie and their
-- letters would depend on uuids; the clock keeps them in order (F228).
alter table ops_core.attachment_links alter column linked_at set default clock_timestamp();

-- ── 2. the tables ─────────────────────────────────────────────────────────

create table ops_procure.design_item_specs (
  id          uuid primary key default gen_random_uuid(),
  item_id     uuid not null references ops_procure.design_items(id),
  version     int  not null check (version > 0),
  body        text not null check (length(btrim(body)) > 0),
  note        text,
  written_by  uuid references ops_core.users(id),
  written_at  timestamptz not null default clock_timestamp(),
  constraint spec_version_once unique (item_id, version)
);

create table ops_procure.design_box_skips (
  id       uuid primary key default gen_random_uuid(),
  item_id  uuid not null references ops_procure.design_items(id),
  box      text not null check (box in ('pdf','dwg','render','foto','spec','bom')),
  skipped  boolean not null,
  note     text,
  set_by   uuid references ops_core.users(id),
  -- The clock: the latest row is the one that counts, and two in one
  -- transaction must still have an order (F228).
  set_at   timestamptz not null default clock_timestamp()
);
create index design_box_skips_item_idx on ops_procure.design_box_skips (item_id, box, set_at desc);

alter table ops_procure.design_item_specs enable row level security;
alter table ops_procure.design_box_skips  enable row level security;
create policy design_item_specs_read on ops_procure.design_item_specs for select to authenticated
  using (ops_procure.may_design('read'));
create policy design_box_skips_read on ops_procure.design_box_skips for select to authenticated
  using (ops_procure.may_design('read'));
grant select on ops_procure.design_item_specs, ops_procure.design_box_skips to authenticated;

alter table ops_prod.products add column if not exists design_item_no text;
comment on column ops_prod.products.design_item_no is
  'Made from this design item before it was ordered (D400). Inactive until an order line names it. (0248)';

-- ── 3. the seams ──────────────────────────────────────────────────────────

-- The specification, as a new version. The same text again is not a version.
create or replace function ops_procure.save_design_spec(
  p_item_no text, p_body text, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare i ops_procure.design_items; last ops_procure.design_item_specs;
        v_body text := btrim(coalesce(p_body, '')); v_next int;
begin
  if not ops_procure.may_design('update') then
    return ops_core.refused('project','design_item', p_item_no,'save_spec',
      'not_permitted','Mengubah desain butuh akses proyek, marketing, atau produksi (update).');
  end if;
  select * into i from ops_procure.design_items where item_no = btrim(coalesce(p_item_no, ''));
  if not found then
    return ops_core.not_found('project','design_item', p_item_no,'save_spec', format('Tidak ada item %s.', p_item_no));
  end if;
  if v_body = '' then
    return ops_core.invalid('project','design_item', i.item_no,'save_spec', 'spec_empty',
      'Spesifikasinya masih kosong. Kotak ini boleh dibiarkan kosong, atau ditandai tidak perlu.',
      jsonb_build_object('field','body'));
  end if;
  select * into last from ops_procure.design_item_specs where item_id = i.id order by version desc limit 1;
  if last.id is not null and last.body = v_body then
    return ops_core.noop('project','design_item', i.item_no,'save_spec',
      'Sama dengan versi terakhir; tidak ada versi baru.', jsonb_build_object('item_no', i.item_no, 'version', last.version));
  end if;
  v_next := coalesce(last.version, 0) + 1;
  insert into ops_procure.design_item_specs (item_id, version, body, note, written_by)
  values (i.id, v_next, v_body, nullif(btrim(p_note), ''), auth.uid());
  return ops_core.ok('project','design_item', i.item_no,'save_spec',
    jsonb_build_object('item_no', i.item_no, 'version', v_next),
    case when last.id is null then null else jsonb_build_object('version', last.version, 'body', last.body) end,
    jsonb_build_object('version', v_next, 'body', v_body));
end $$;
revoke all on function ops_procure.save_design_spec(text, text, text) from public;
grant execute on function ops_procure.save_design_spec(text, text, text) to authenticated;

-- A box is not needed for this item, or needed again. The note is optional.
create or replace function ops_procure.set_design_box_skip(
  p_item_no text, p_box text, p_skip boolean, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare i ops_procure.design_items; v_box text := lower(btrim(coalesce(p_box, ''))); v_now boolean;
begin
  if not ops_procure.may_design('update') then
    return ops_core.refused('project','design_item', p_item_no,'skip_box',
      'not_permitted','Mengubah desain butuh akses proyek, marketing, atau produksi (update).');
  end if;
  if v_box not in ('pdf','dwg','render','foto','spec','bom') then
    return ops_core.invalid('project','design_item', p_item_no,'skip_box', 'unknown_box',
      'Kotaknya: pdf, dwg, render, foto, spec, atau bom.', jsonb_build_object('field','box'));
  end if;
  if p_skip is null then
    return ops_core.invalid('project','design_item', p_item_no,'skip_box', 'skip_required',
      'Tidak perlu, atau perlu lagi?', jsonb_build_object('field','skip'));
  end if;
  select * into i from ops_procure.design_items where item_no = btrim(coalesce(p_item_no, ''));
  if not found then
    return ops_core.not_found('project','design_item', p_item_no,'skip_box', format('Tidak ada item %s.', p_item_no));
  end if;
  select s.skipped into v_now from ops_procure.design_box_skips s
   where s.item_id = i.id and s.box = v_box order by s.set_at desc limit 1;
  if coalesce(v_now, false) = p_skip then
    return ops_core.noop('project','design_item', i.item_no,'skip_box',
      case when p_skip then 'Sudah ditandai tidak perlu.' else 'Kotak ini memang diperlukan.' end,
      jsonb_build_object('item_no', i.item_no, 'box', v_box, 'skipped', p_skip));
  end if;
  insert into ops_procure.design_box_skips (item_id, box, skipped, note, set_by)
  values (i.id, v_box, p_skip, nullif(btrim(p_note), ''), auth.uid());
  return ops_core.ok('project','design_item', i.item_no,'skip_box',
    jsonb_build_object('item_no', i.item_no, 'box', v_box, 'skipped', p_skip),
    jsonb_build_object('box', v_box, 'skipped', coalesce(v_now, false)),
    jsonb_build_object('box', v_box, 'skipped', p_skip, 'note', nullif(btrim(p_note), '')));
end $$;
revoke all on function ops_procure.set_design_box_skip(text, text, boolean, text) from public;
grant execute on function ops_procure.set_design_box_skip(text, text, boolean, text) to authenticated;

-- A product (and so a BOM) for an item before it is ordered, so the quotation
-- can be priced from it (D400). The code defaults to the item's number; an
-- existing product is linked rather than copied. Made inactive and marked with
-- the item, so the catalogue does not list it until an order line names it.
create or replace function ops_procure.product_from_design_item(
  p_item_no text, p_product_code text default null, p_category text default null)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_prod, ops_core, pg_temp as $$
declare i ops_procure.design_items; v_existing ops_prod.products;
        v_code text := upper(btrim(coalesce(nullif(btrim(p_product_code), ''), p_item_no, '')));
begin
  if not ops_core.has_permission('production.create') then
    return ops_core.refused('production','product', v_code,'from_design_item',
      'not_permitted','Membuat produk dan BOM butuh akses produksi (create) — minta drafter atau kepala produksi.');
  end if;
  select * into i from ops_procure.design_items where item_no = btrim(coalesce(p_item_no, ''));
  if not found then
    return ops_core.not_found('production','product', v_code,'from_design_item', format('Tidak ada item %s.', p_item_no));
  end if;
  if i.product_code is not null then
    return ops_core.conflict('production','product', i.product_code,'from_design_item', 'already_product',
      format('Item %s sudah punya produk %s. BOM-nya diubah di /produksi/bom.', i.item_no, i.product_code),
      jsonb_build_object('product_code', i.product_code));
  end if;
  if v_code = '' then
    return ops_core.invalid('production','product', null,'from_design_item', 'code_required',
      'Kode produknya apa? Kode ini dipakai di gambar, BOM dan SPK.', jsonb_build_object('field','product_code'));
  end if;

  select * into v_existing from ops_prod.products where product_code = v_code;
  if v_existing.id is null then
    insert into ops_prod.products (product_code, name, category, uom, length_mm, width_mm, height_mm,
                                   active, design_item_no, note, created_by)
    values (v_code, i.name, coalesce(nullif(btrim(p_category), ''), 'Belum dikategorikan'), 'pcs',
            round(i.length_mm)::int, round(i.width_mm)::int, round(i.height_mm)::int,
            false, i.item_no, format('Dari desain %s, belum dipesan.', i.item_no), auth.uid());
  end if;
  update ops_procure.design_items set product_code = v_code, updated_at = now() where id = i.id;

  return ops_core.ok('production','product', v_code,'from_design_item',
    jsonb_build_object('product_code', v_code, 'item_no', i.item_no, 'existing', v_existing.id is not null));
end $$;
revoke all on function ops_procure.product_from_design_item(text, text, text) from public;
grant execute on function ops_procure.product_from_design_item(text, text, text) to authenticated;

-- Ordered: a product made from a design is a catalogue product from now on.
create or replace function ops_procure.activate_design_product()
returns trigger
language plpgsql security definer set search_path = ops_procure, ops_prod, ops_core, pg_temp as $$
begin
  if new.product_code is not null then
    update ops_prod.products set active = true, updated_at = now()
     where product_code = new.product_code and design_item_no is not null and not active;
  end if;
  return new;
end $$;
revoke all on function ops_procure.activate_design_product() from public;
grant execute on function ops_procure.activate_design_product() to authenticated;

create trigger project_line_activates_design_product
  after insert or update of product_code on ops_procure.project_lines
  for each row execute function ops_procure.activate_design_product();

-- ── 4. what the screens read ──────────────────────────────────────────────

create or replace view ops_procure.v_design_box as
with it as (
  select i.id as item_id, i.item_no, i.name as item_name, i.dropped_at is not null as dropped,
         r.code as room_code, r.name as room_name, r.sort as room_sort,
         c.code as collection_code, c.name as collection_name, p.code as project_code,
         coalesce(i.product_code, (select max(pl.product_code) from ops_procure.project_lines pl
                                    where pl.design_item_id = i.id)) as product_code
    from ops_procure.design_items i
    join ops_procure.design_rooms r on r.id = i.room_id
    join ops_procure.design_collections c on c.id = r.collection_id
    join ops_procure.projects p on p.id = c.project_id
),
boxes (box, sort, kind) as (
  values ('pdf', 1, 'gambar_kerja'::ops_core.doc_kind_t), ('dwg', 2, 'dwg'::ops_core.doc_kind_t),
         ('render', 3, 'render'::ops_core.doc_kind_t), ('foto', 4, 'gambar_jadi'::ops_core.doc_kind_t),
         ('spec', 5, null::ops_core.doc_kind_t), ('bom', 6, null::ops_core.doc_kind_t)
),
cell as (
  select it.*, b.box, b.sort,
         f.versions as file_versions, f.ordinal, f.linked_at, f.by_name as file_by, f.note as file_note,
         f.attachment_id, f.filename, f.web_view_link,
         s.version as spec_version, s.body as spec_body, s.written_at, s.by_name as spec_by, s.note as spec_note,
         pr.current_rev, pr.draft_rev, pr.production_cost,
         sk.skipped, sk.note as skip_note, sk.set_at as skip_at, sk.by_name as skip_by
    from it cross join boxes b
    left join lateral (
      -- A version's letter is its place among every file ever filed in the box,
      -- so B stays B when A is taken off.
      select x.* from (
        select l.linked_at, l.note, l.unlinked_at, a.id::text as attachment_id, a.filename, a.web_view_link,
               coalesce(u.full_name, u.email) as by_name,
               row_number() over (order by l.linked_at, l.id) as ordinal,
               count(*) filter (where l.unlinked_at is null) over () as versions
          from ops_core.attachment_links l
          join ops_core.attachments a on a.id = l.attachment_id
          left join ops_core.users u on u.id = l.linked_by
         where b.kind is not null and l.entity = 'design_item' and l.entity_no = it.item_no and l.kind = b.kind
      ) x where x.unlinked_at is null order by x.ordinal desc limit 1
    ) f on true
    left join lateral (
      select v.version, v.body, v.written_at, v.note, coalesce(u.full_name, u.email) as by_name
        from ops_procure.design_item_specs v left join ops_core.users u on u.id = v.written_by
       where b.box = 'spec' and v.item_id = it.item_id order by v.version desc limit 1
    ) s on true
    left join lateral (
      select ps.current_rev, ps.draft_rev, ps.production_cost
        from ops_prod.v_product_summary ps where b.box = 'bom' and ps.product_code = it.product_code
    ) pr on true
    left join lateral (
      select k.skipped, k.note, k.set_at, coalesce(u.full_name, u.email) as by_name
        from ops_procure.design_box_skips k left join ops_core.users u on u.id = k.set_by
       where k.item_id = it.item_id and k.box = b.box order by k.set_at desc limit 1
    ) sk on true
)
select
  item_no, item_name, project_code, collection_code, collection_name, room_code, room_name, room_sort,
  dropped, box, sort,
  case
    when coalesce(file_versions, 0) > 0 or spec_version is not null
         or coalesce(current_rev, draft_rev) is not null       then 'terisi'
    when coalesce(skipped, false)                               then 'tidak_perlu'
    else 'kosong'
  end as state,
  coalesce(file_versions::int, spec_version, 0) as versions,
  case
    when box = 'spec' then spec_version::text
    when box = 'bom' then coalesce(current_rev, draft_rev)::text
    when ordinal is null then null
    when ordinal <= 26 then chr(64 + ordinal::int)
    else 'Z' || (ordinal - 25)::text
  end as latest_label,
  coalesce(linked_at, written_at) as latest_at,
  coalesce(file_by, spec_by) as latest_by,
  coalesce(file_note, spec_note) as latest_note,
  attachment_id as latest_attachment_id,
  filename as latest_filename,
  web_view_link as latest_link,
  spec_body,
  product_code,
  current_rev as bom_rev,
  draft_rev as bom_draft_rev,
  production_cost as bom_cost,
  case when coalesce(skipped, false) then skip_note end as skip_note,
  case when coalesce(skipped, false) then skip_by end as skip_by,
  case when coalesce(skipped, false) then skip_at end as skip_at
from cell;
alter view ops_procure.v_design_box set (security_invoker = on);

-- The projects a drafter works in: live ones, and any that already has a
-- design. Read by whoever designs; no price in it.
create or replace view ops_procure.v_design_project as
select p.code as project_code, p.name as project_name, p.status::text as status,
       cl.code as client_code, coalesce(cl.name, p.client_name) as client_display,
       p.target_date,
       (select count(*) from ops_procure.design_collections c where c.project_id = p.id)::int as collection_count,
       (select count(*) from ops_procure.design_items i
          join ops_procure.design_rooms r on r.id = i.room_id
          join ops_procure.design_collections c on c.id = r.collection_id
         where c.project_id = p.id and i.dropped_at is null)::int as item_count
  from ops_procure.projects p
  left join ops_procure.clients cl on cl.id = p.client_id
 where ops_procure.may_design('read')
   and (p.status::text not in ('LOST','CANCELLED','DONE')
        or exists (select 1 from ops_procure.design_collections c where c.project_id = p.id));
alter view ops_procure.v_design_project set (security_invoker = on);

-- Every version of every box of an item, newest first: the box's history.
-- Files keep their letter by filing order; a file taken off stays listed as
-- removed. Specifications are numbered.
create or replace view ops_procure.v_design_box_version as
select i.item_no,
       case l.kind when 'gambar_kerja' then 'pdf' when 'dwg' then 'dwg'
                   when 'render' then 'render' else 'foto' end as box,
       row_number() over w as ordinal,
       case when row_number() over w <= 26 then chr(64 + (row_number() over w)::int)
            else 'Z' || (row_number() over w - 25)::text end as label,
       l.linked_at as at, coalesce(u.full_name, u.email) as by_name, l.note,
       a.id::text as attachment_id, a.filename, a.web_view_link,
       null::text as body,
       l.unlinked_at is not null as removed
  from ops_procure.design_items i
  join ops_core.attachment_links l
    on l.entity = 'design_item' and l.entity_no = i.item_no
   and l.kind in ('gambar_kerja','dwg','render','gambar_jadi')
  join ops_core.attachments a on a.id = l.attachment_id
  left join ops_core.users u on u.id = l.linked_by
window w as (partition by i.item_no, l.kind order by l.linked_at, l.id)
union all
select i.item_no, 'spec', v.version, v.version::text, v.written_at, coalesce(u.full_name, u.email), v.note,
       null, null, null, v.body, false
  from ops_procure.design_item_specs v
  join ops_procure.design_items i on i.id = v.item_id
  left join ops_core.users u on u.id = v.written_by;
alter view ops_procure.v_design_box_version set (security_invoker = on);

grant select on ops_procure.v_design_box, ops_procure.v_design_project,
                ops_procure.v_design_box_version to authenticated;

comment on view ops_procure.v_design_box is
  'One row per design item and box (pdf, dwg, render, foto, spec, bom): kosong · terisi · tidak_perlu, '
  'and the latest version. Filled by the work itself; nothing is typed. (0248, D399–D403)';

analyze ops_procure.design_item_specs;
analyze ops_procure.design_box_skips;
