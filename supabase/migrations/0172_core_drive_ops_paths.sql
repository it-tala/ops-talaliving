-- 0172_core_drive_ops_paths.sql — every file in the OPS folder, in a folder for its task.
--
-- The owner (2026-09-25), to be remembered for every session after this one:
--
--   *folder OPS untuk menampung semua file yang dipakai di web apps
--   ops.talaliving, dan harus buat per folder untuk tugas tertentu. misal
--   Procurement shared Drive: OPS / INVENTORY / FINISHED GOODS,
--   OPS / RECEIVING REPORT.*
--
-- Two corrections to how `0035`/`0036` filed things (D313):
--
--   1. **The recorded folder is the OPS folder.** `0036` read the ids the owner
--      gave as the module folders and had the upload route create an `ops`
--      folder inside each — so everything would have landed in `OPS/ops`.
--      DRAFTING's id is itself a folder named `OPS`, and the owner confirmed
--      it for procurement. The route now checks the recorded folder's name
--      (`src/lib/drive.ts`). Nothing had been uploaded yet: every
--      `drive_folders.folder_id` was still null in production.
--
--   2. **A task folder under OPS.** `ops_core.drive_paths` says which folder a
--      file goes in, by kind **and** by the record it is filed against — a
--      photo of a catalogue item is not a photo of a finished product, and
--      both are kind `foto`. Where no row says otherwise the folder is the
--      kind's own name (`purchase_order` → `PURCHASE ORDER`), so nothing ever
--      lands loose in OPS. Segments are created on first use by the route.
--
-- The drive is still decided by `doc_kind_drive` alone — the personal-data
-- boundary (0035) does not move: a path only chooses a folder **inside** the
-- drive the kind already resolves to.

create table ops_core.drive_paths (
  id       uuid primary key default gen_random_uuid(),
  kind     ops_core.doc_kind_t not null,
  -- The record the file is filed against; null = any.
  entity   ops_core.link_entity_t,
  -- Folders under OPS, `/`-separated, as a person reads them in Drive.
  path     text not null check (path ~ '^[^/[:space:]][^/]*(/[^/[:space:]][^/]*)*$' and path = btrim(path)),
  note     text,
  -- One row per kind and record; null counts as a value (one catch-all per kind).
  constraint drive_paths_one unique nulls not distinct (kind, entity)
);

insert into ops_core.drive_paths (kind, entity, path, note) values
  -- PROCUREMENT / OPS
  ('foto',             'item',     'INVENTORY/ITEMS',          'Photos of a catalogue item, taken at the rack (D309).'),
  ('foto',             'product',  'INVENTORY/FINISHED GOODS', 'Photos of a finished product (D311).'),
  ('foto',             'asset',    'INVENTORY/ASSETS',         null),
  ('receiving_report', null,       'RECEIVING REPORT',         'The owner''s own example.'),
  ('goods_photo',      null,       'RECEIVING REPORT',         'Goods photographed as they arrive.'),
  ('delivery_note',    null,       'RECEIVING REPORT',         'The vendor''s paper that comes with the goods.'),
  ('surat_jalan',      null,       'RECEIVING REPORT',         'The vendor''s own delivery paper.'),
  ('other',            null,       'LAIN-LAIN',                null);

alter table ops_core.drive_paths enable row level security;
create policy drive_paths_read on ops_core.drive_paths for select to authenticated using (true);
create policy drive_paths_new on ops_core.drive_paths for insert to authenticated
  with check ((select ops_core.has_permission('it.update')));
create policy drive_paths_edit on ops_core.drive_paths for update to authenticated
  using ((select ops_core.has_permission('it.update'))) with check ((select ops_core.has_permission('it.update')));
grant select, insert, update on ops_core.drive_paths to authenticated;

comment on table ops_core.drive_paths is
  'Which task folder under a drive''s OPS folder a file goes in, by kind and by the record it is '
  'filed against. No row = the kind''s own name. Never chooses the drive (0035). (0172)';

-- The path for a kind and record, always one: the specific row, the kind's
-- row, or the kind's own name.
create or replace function ops_core.drive_path_for(p_kind ops_core.doc_kind_t, p_entity text)
returns text
language sql stable security definer set search_path = ops_core, pg_temp as $$
  select coalesce(
    (select p.path from ops_core.drive_paths p where p.kind = p_kind and p.entity::text = p_entity),
    (select p.path from ops_core.drive_paths p where p.kind = p_kind and p.entity is null),
    upper(replace(p_kind::text, '_', ' ')));
$$;
revoke all on function ops_core.drive_path_for(ops_core.doc_kind_t, text) from public;
grant execute on function ops_core.drive_path_for(ops_core.doc_kind_t, text) to authenticated;

-- 0036's body, plus the record the file is for and the path it resolves to.
-- One argument still works — the entity is optional — so the smoke files and
-- any caller written before this keep their meaning.
drop function if exists ops_core.drive_folder_for(text);
create or replace function ops_core.drive_folder_for(p_kind text, p_entity text default null)
returns jsonb
language plpgsql stable security definer set search_path = ops_core, pg_temp as $$
declare v_kind ops_core.doc_kind_t; f record;
begin
  v_kind := ops_core.doc_kind_of(p_kind);
  if v_kind is null then
    return ops_core.invalid('documents','attachment', null,'file',
      'unknown_kind', format('"%s" is not a kind of document this system files.', p_kind),
      jsonb_build_object('field','kind','given', p_kind));
  end if;
  if p_entity is not null
     and not exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
                      where t.typname = 'link_entity_t' and e.enumlabel = p_entity) then
    return ops_core.invalid('documents','attachment', null,'file',
      'unknown_entity', format('"%s" is not a record a document can be filed against.', p_entity),
      jsonb_build_object('field','entity','given', p_entity));
  end if;

  select d.slug, df.label, df.drive_id, df.folder_id, df.parent_folder_id
    into f
    from ops_core.doc_kind_drive d
    join ops_core.drive_folders df on df.slug = d.slug
   where d.kind = v_kind;

  if not found then
    return ops_core.invalid('documents','attachment', null,'file',
      'no_drive_for_kind',
      format('Nothing says which shared drive a %s belongs in.', v_kind),
      jsonb_build_object('field','kind','kind', v_kind));
  end if;

  if f.parent_folder_id is null and f.folder_id is null then
    return ops_core.invalid('documents','attachment', null,'file',
      'drive_not_configured',
      format('The %s shared drive has no folder recorded yet, so a %s cannot be filed. IT sets it in ops_core.drive_folders.',
             f.label, v_kind),
      jsonb_build_object('field','kind','slug', f.slug, 'label', f.label));
  end if;

  return ops_core.ok('documents','attachment', null,'file',
    jsonb_build_object('kind', v_kind, 'slug', f.slug, 'label', f.label,
                       'drive_id', f.drive_id,
                       'parent_folder_id', f.parent_folder_id,
                       -- The OPS folder once located; null until the first upload.
                       'folder_id', f.folder_id,
                       -- The task folder under OPS (0172).
                       'path', ops_core.drive_path_for(v_kind, p_entity)));
end $$;

revoke all on function ops_core.drive_folder_for(text, text) from public;
grant execute on function ops_core.drive_folder_for(text, text) to authenticated;

comment on column ops_core.drive_folders.parent_folder_id is
  'The OPS folder of the module''s shared drive, as the owner gave it (D313: not a parent of one). '
  'Set by hand, once. (0036, 0172)';
comment on column ops_core.drive_folders.folder_id is
  'The OPS folder as the upload route located it — the same folder as parent_folder_id when that '
  'is named OPS. Filled in on first upload; changed thereafter only by IT. (0036, 0172)';

analyze ops_core.drive_paths;
