-- 0251_procure_collection_gallery.sql — a gallery link on every design
-- collection, for the team and for the client (D406).
--
-- The owner (2026-10-09): *selain gambar untuk tiap item kita butuh gambar
-- render untuk tiap koleksi set … mungkin berupa galeri? … atau sederhanakan
-- dengan melampirkan link ke Google Photos supaya klien bisa lihat juga? Mana
-- yang paling cepat.* Answer: *link A* — one shared-album link per collection.
--
-- The album lives in Google Photos, where the client can open it without an
-- account here; ops keeps the link, who set it and when (the audit row), and
-- shows it wherever the collection is read. Nothing is copied or checked: the
-- link is whatever the person pasted, as long as it is a web address.
--
-- Applying to production: no drops, nothing removed. `v_design_collection`
-- keeps every column it had, in the same order, and gains `gallery_url` last.

alter table ops_procure.design_collections
  add column if not exists gallery_url text
    constraint gallery_url_is_web check (gallery_url is null or gallery_url ~* '^https?://\S+$');

comment on column ops_procure.design_collections.gallery_url is
  'The collection''s shared gallery (a Google Photos album, usually) — renders of the whole set, for the team and the client. (0251, D406)';

-- Set, change or clear (null / blank) the link.
create or replace function ops_procure.set_design_collection_gallery(
  p_project_code text, p_code text, p_url text)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare c ops_procure.design_collections; v_url text := nullif(btrim(coalesce(p_url, '')), '');
        v_ref text := btrim(coalesce(p_project_code, '')) || '-' || upper(btrim(coalesce(p_code, '')));
begin
  if not ops_procure.may_design('update') then
    return ops_core.refused('project','design_collection', v_ref,'set_gallery',
      'not_permitted','Mengubah desain butuh akses proyek, marketing, atau produksi (update).');
  end if;
  select dc.* into c from ops_procure.design_collections dc
    join ops_procure.projects p on p.id = dc.project_id
   where p.code = btrim(coalesce(p_project_code, '')) and dc.code = upper(btrim(coalesce(p_code, '')));
  if not found then
    return ops_core.not_found('project','design_collection', v_ref,'set_gallery', format('Tidak ada koleksi %s.', v_ref));
  end if;
  if v_url is not null and v_url !~* '^https?://\S+$' then
    return ops_core.invalid('project','design_collection', v_ref,'set_gallery', 'bad_url',
      'Tempel link lengkap yang diawali https://, mis. link album Google Photos.', jsonb_build_object('field','url'));
  end if;
  if c.gallery_url is not distinct from v_url then
    return ops_core.noop('project','design_collection', v_ref,'set_gallery', 'Link-nya sama.',
      jsonb_build_object('gallery_url', v_url));
  end if;
  update ops_procure.design_collections set gallery_url = v_url, updated_at = now() where id = c.id;
  return ops_core.ok('project','design_collection', v_ref,'set_gallery',
    jsonb_build_object('gallery_url', v_url),
    jsonb_build_object('gallery_url', c.gallery_url), jsonb_build_object('gallery_url', v_url));
end $$;
revoke all on function ops_procure.set_design_collection_gallery(text, text, text) from public;
grant execute on function ops_procure.set_design_collection_gallery(text, text, text) to authenticated;

create or replace view ops_procure.v_design_collection as
select c.id, c.code, c.name, c.note, c.created_at, p.code as project_code, p.name as project_name,
       (select count(*) from ops_procure.design_rooms r where r.collection_id = c.id)::int as room_count,
       (select count(*) from ops_procure.v_design_item i
         where i.project_code = p.code and i.collection_code = c.code and i.status <> 'DROPPED')::int as item_count,
       (select count(*) from ops_procure.v_design_item i
         where i.project_code = p.code and i.collection_code = c.code and i.status <> 'DROPPED'
           and i.approval_decision = 'approved')::int as approved_count,
       c.gallery_url
  from ops_procure.design_collections c
  join ops_procure.projects p on p.id = c.project_id;
alter view ops_procure.v_design_collection set (security_invoker = on);
grant select on ops_procure.v_design_collection to authenticated;
