-- 0292_inv_found_asset.sql — an asset nobody had on record, registered where it stands.
--
-- The recap (D447) checks what is on record. Walking the zones finds the rest:
-- a sander nobody registered, power tools bought since 2013 (owner,
-- 2026-11-18, D448). The handoff's *Baru* mockup is the screen for it — photo
-- first, what it is, where it is — and this is its seam.
--
--   1. **`asset_verifications.found_new`.** A found asset is checked the moment
--      it is registered: the same person is standing in front of it. So the
--      seam records one verification for it, all four fields matching, flagged
--      as *found new*, and the asset counts as verified in its zone (owner,
--      answer 3). The flag is what lets the summary list "found during the
--      recap" apart from "matched the record".
--   2. **`register_found_asset`.** Creates the asset (`AST-` from the same
--      sequence, D347) in the zone it was found, links its photos as the
--      record photo **and** as the proof of that first check, and records the
--      verification. One to four photos, the first of the whole thing.
--      `inventory.create`, the authority *Register asset* already answers to
--      (answer 5). Status `in_storage` unless said otherwise: production is
--      stopped (D447 answer 3).
--   3. **`v_asset_verification.status` reads `new`** for an asset whose latest
--      check is that first one; a later recheck reads as any other.
--
-- Counted things — materials, consumables, hand tools in bulk — are not here:
-- they are counted with *Input stock* (`input_stock`, D348) at the zone, and a
-- name the catalogue lacks is registered with `register_item` (0168). Nothing
-- new is needed in the schema for them (answers 1 and 4).

alter table ops_inv.asset_verifications
  add column if not exists found_new boolean not null default false;

comment on column ops_inv.asset_verifications.found_new is
  'The first check of an asset registered during the recap because it was not on record (0292, D448).';

-- A found-new check is a full match by definition: what was registered is what
-- was seen.
alter table ops_inv.asset_verifications drop constraint if exists verification_found_new_matches;
alter table ops_inv.asset_verifications add constraint verification_found_new_matches
  check (not found_new or result = 'match');

-- ── the seam ─────────────────────────────────────────────────────────────
create or replace function ops_inv.register_found_asset(
  p_name          text,
  p_category_code text,
  p_location      text,
  p_condition     text,
  p_photo_ids     uuid[],
  p_brand         text default null,
  p_model         text default null,
  p_note          text default null,
  p_status        text default 'in_storage',
  p_key           text default null)
returns jsonb
language plpgsql security definer set search_path = ops_inv, ops_core, pg_temp as $$
declare
  v_photos   uuid[] := coalesce(p_photo_ids, '{}');
  v_n        int;
  v_loc      text   := nullif(btrim(p_location), '');
  v_name     text   := nullif(btrim(p_name), '');
  v_id       uuid;
  v_no       text;
  v_vrf      text;
  v_photo    uuid;
  res        jsonb;
  replayed   jsonb;
begin
  replayed := ops_core.idem_replay('inventory','register_found_asset', p_key);
  if replayed is not null then return replayed; end if;

  if not ops_core.has_permission('inventory.create') then
    return ops_core.refused('inventory','asset', null,'register_found',
      'not_permitted','Registering an asset needs inventory write access.');
  end if;
  if v_name is null then
    return ops_core.invalid('inventory','asset', null,'register_found',
      'name_required','Say what it is.', jsonb_build_object('field','name'));
  end if;
  if not exists (select 1 from ops_inv.asset_categories c where c.code = p_category_code and c.is_active) then
    return ops_core.invalid('inventory','asset', null,'register_found',
      'category_unknown', format('No asset category %s.', coalesce(p_category_code, '(none)')),
      jsonb_build_object('field','category_code'));
  end if;
  if v_loc is null or not exists (select 1 from ops_inv.stock_locations l where l.code = v_loc and l.is_active) then
    return ops_core.invalid('inventory','asset', null,'register_found',
      'location_required','Pick where it is from the location list.', jsonb_build_object('field','location'));
  end if;
  if p_condition is null or p_condition not in ('working','broken','untested') then
    return ops_core.invalid('inventory','asset', null,'register_found',
      'condition_required','Say whether it works, is broken, or could not be tested.',
      jsonb_build_object('field','condition'));
  end if;
  if coalesce(p_status, 'in_storage') not in ('in_use','in_storage','under_repair') then
    return ops_core.invalid('inventory','asset', null,'register_found',
      'status_invalid','A found asset is in use, in storage or under repair.', jsonb_build_object('field','status'));
  end if;
  v_n := coalesce(array_length(v_photos, 1), 0);
  if v_n < 1 then
    return ops_core.invalid('inventory','asset', null,'register_found',
      'photo_required','A photo of the whole thing is required.', jsonb_build_object('field','photos'));
  end if;
  if v_n > 4 then
    return ops_core.invalid('inventory','asset', null,'register_found',
      'too_many_photos','At most four photos.', jsonb_build_object('field','photos','given', v_n));
  end if;
  if (select count(distinct x) from unnest(v_photos) x) <> v_n then
    return ops_core.invalid('inventory','asset', null,'register_found',
      'duplicate_photo','The same photo was sent twice.', jsonb_build_object('field','photos'));
  end if;
  if exists (select 1 from unnest(v_photos) x
              where not exists (select 1 from ops_core.attachments t where t.id = x)) then
    return ops_core.not_found('inventory','asset', null,'register_found','One of the photos was not found.');
  end if;

  insert into ops_inv.assets (name, category_code, brand, model, location, status, notes, created_by)
  values (v_name, p_category_code, nullif(btrim(p_brand), ''), nullif(btrim(p_model), ''), v_loc,
          coalesce(p_status, 'in_storage')::ops_inv.asset_status_t,
          'Found during the inventory recap' || coalesce(' — ' || nullif(btrim(p_note), ''), ''),
          auth.uid())
  returning id, asset_no into v_id, v_no;

  insert into ops_inv.asset_verifications (asset_id, result, condition, location, checks, note, verified_by, found_new)
  values (v_id, 'match', p_condition::ops_inv.asset_condition_t, v_loc,
          '{"name":{"ok":true},"brand":{"ok":true},"model":{"ok":true},"qty":{"ok":true}}'::jsonb,
          nullif(btrim(p_note), ''), auth.uid(), true)
  returning verification_no into v_vrf;

  foreach v_photo in array v_photos loop
    insert into ops_core.attachment_links (attachment_id, entity, entity_no, kind, linked_by)
    values (v_photo, 'asset', v_no, 'foto', auth.uid());
    insert into ops_core.attachment_links (attachment_id, entity, entity_no, kind, linked_by)
    values (v_photo, 'asset_verification', v_vrf, 'foto', auth.uid());
  end loop;

  res := ops_core.ok('inventory','asset', v_no,'register_found',
    jsonb_build_object('asset_no', v_no, 'verification_no', v_vrf, 'photos', v_n),
    null,
    jsonb_build_object('name', v_name, 'category_code', p_category_code, 'location', v_loc,
                       'condition', p_condition, 'verification_no', v_vrf));
  return ops_core.idem_remember('inventory','register_found_asset', p_key, res);
end $$;

revoke execute on function ops_inv.register_found_asset(text, text, text, text, uuid[], text, text, text, text, text) from public;
grant execute on function ops_inv.register_found_asset(text, text, text, text, uuid[], text, text, text, text, text) to authenticated;

-- ── the view: `new`, and the flag at the end ─────────────────────────────
create or replace view ops_inv.v_asset_verification as
  select a.asset_no,
         a.name,
         a.category_code,
         c.name                                     as category_name,
         a.brand,
         a.model,
         a.status                                   as asset_status,
         a.location                                 as asset_location,
         a.legacy_code,
         a.legacy_area,
         a.legacy_department,
         a.legacy_notes,
         case when lv.found_new then 'new' else coalesce(lv.result::text, 'unverified') end as status,
         lv.verification_no,
         lv.condition,
         lv.location                                as verified_location,
         coalesce(lv.location, a.location)          as location,
         l.name                                     as location_name,
         lv.checks,
         lv.note,
         lv.verified_by,
         u.full_name                                as verified_by_name,
         lv.verified_at,
         lv.applied_at,
         lv.applied_by,
         (select count(*) from ops_inv.asset_verifications x where x.asset_id = a.id)::int as verification_count,
         rp.attachment_id                           as record_photo_id,
         (select count(*) from ops_core.attachment_links k
           where k.entity = 'asset' and k.entity_no = a.asset_no
             and k.kind = 'foto' and k.unlinked_at is null)::int          as record_photo_count,
         coalesce((select count(*) from ops_core.attachment_links k
           where k.entity = 'asset_verification' and k.entity_no = lv.verification_no
             and k.unlinked_at is null), 0)::int                          as verification_photo_count,
         coalesce(lv.found_new, false)              as found_new
    from ops_inv.assets a
    join ops_inv.asset_categories c on c.code = a.category_code
    left join lateral (
      select x.* from ops_inv.asset_verifications x
       where x.asset_id = a.id
       order by x.verified_at desc, x.verification_no desc
       limit 1) lv on true
    left join ops_inv.stock_locations l on l.code = coalesce(lv.location, a.location)
    left join ops_core.users u on u.id = lv.verified_by
    left join lateral (
      select k.attachment_id from ops_core.attachment_links k
       where k.entity = 'asset' and k.entity_no = a.asset_no
         and k.kind = 'foto' and k.unlinked_at is null
       order by k.linked_at, k.id
       limit 1) rp on true
   where a.ended_on is null
      or lv.result = 'not_found';

-- `create or replace view` resets the view's options: without this it would
-- run as its owner and hand every row past RLS (17_core_view_invoker).
alter view ops_inv.v_asset_verification set (security_invoker = on);
grant select on ops_inv.v_asset_verification to authenticated;

comment on view ops_inv.v_asset_verification is
  'One row per asset on the register (and the lost ones a check found missing), with its latest verification; '
  'status is unverified until somebody checks it, and new for an asset registered during the recap (0290, 0292, D447, D448).';

analyze ops_inv.asset_verifications;
