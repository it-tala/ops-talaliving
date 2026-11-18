-- 0290_inv_asset_verification.sql — checking what is on record against the real thing.
--
-- Production has stopped and the company is recapping everything it owns
-- (owner, 2026-11-18, D447). The flow is one sentence: go to a zone, open an
-- asset already on record, check each field against the machine in front of
-- you, record its condition, where it is and a photo, save, next. Anything
-- that does not match collects in one list, where somebody corrects the
-- record on purpose.
--
--   1. **Legacy columns** on `assets` for the 2013 machine register: its code
--      (`S2-14`), its floor-grid area, its department and what the 2013
--      analysis already knows is wrong with the row. Old identifiers stay
--      searchable and are never keys (D347). `legacy_code` is indexed, not
--      unique: C1-07 is one line for two machines, imported as two assets,
--      because one asset is one physical unit.
--   2. **A `machine` category** ("Machines") beside `tool`, for the register
--      (owner, step 1 answer 1).
--   3. **`asset_verifications`, append-only.** A recheck is a new row and the
--      latest row per asset is its status. The only change a row ever takes
--      is the one-time stamp of a correction applied from it; a trigger holds
--      that even for the definer seams.
--   4. **Two seams.** `verify_asset` records a check and links its photos;
--      `apply_verification` is the only way a check changes the asset — the
--      found name, brand, model and location, or `lost` for an asset that was
--      not found (step 1 answer 8). Both need `inventory.update` (answers 4, 9).
--   5. **`v_asset_verification`**, one row per asset with its latest check,
--      which feeds the list, the zone counts and the summary.
--   6. **The photos' folder**: `INVENTORY/ASSET VERIFICATION/<asset_no>` (D313,
--      D320), through a new `{ASSET}` placeholder.

-- ── 1. legacy columns ────────────────────────────────────────────────────
alter table ops_inv.assets
  add column if not exists legacy_code       text,
  add column if not exists legacy_area       text,
  add column if not exists legacy_department text,
  add column if not exists legacy_notes      text;

create index if not exists assets_legacy_code_idx on ops_inv.assets (legacy_code) where legacy_code is not null;

comment on column ops_inv.assets.legacy_code is
  'The 2013 register''s code (S2-14). Searchable, never a key; not unique, since one 2013 line can be two units (0290).';
comment on column ops_inv.assets.legacy_area is
  'The 2013 floor-grid code, normalised (M16). The old layout: it does not match today''s zones (0290).';
comment on column ops_inv.assets.legacy_department is
  'The 2013 department, cleaned (0290).';
comment on column ops_inv.assets.legacy_notes is
  'What the 2013 analysis knows is wrong with the row: typos, a shared photo, a disagreeing placard (0290).';

-- `create_asset` / `update_asset` (0116) never name these columns: they are
-- written only by the import and read through `v_asset_verification`.
-- `v_asset` was expanded to its columns when it was created, so it does not
-- carry them, and is left as it is.

-- ── 2. the machines category ─────────────────────────────────────────────
insert into ops_inv.asset_categories (code, name, description) values
  ('machine', 'Machines', 'Production machines: saws, sanders, planers, compressors, sewing machines')
on conflict (code) do nothing;

-- ── 3. the verifications ─────────────────────────────────────────────────
do $$ begin
  create type ops_inv.verification_result_t as enum ('match','mismatch','not_found');
exception when duplicate_object then null; end $$;
do $$ begin
  create type ops_inv.asset_condition_t as enum ('working','broken','untested');
exception when duplicate_object then null; end $$;

create sequence if not exists ops_inv.verification_no_seq;

create table if not exists ops_inv.asset_verifications (
  id               uuid primary key default gen_random_uuid(),
  -- The public code files are linked by (ADR-004). Its own series; asset
  -- numbering is untouched (D347).
  verification_no  text not null unique
                   default 'VRF-' || lpad(nextval('ops_inv.verification_no_seq')::text, 6, '0'),
  asset_id         uuid not null references ops_inv.assets(id),
  result           ops_inv.verification_result_t not null,
  condition        ops_inv.asset_condition_t,
  -- Where it was found: one of the shared locations (D347).
  location         text references ops_inv.stock_locations(code),
  -- {"name":{"ok":true},"brand":{"ok":false,"found":"HUA HUA"},...}
  checks           jsonb not null default '{}'::jsonb,
  note             text,
  verified_by      uuid not null references ops_core.users(id),
  verified_at      timestamptz not null default now(),
  applied_by       uuid references ops_core.users(id),
  applied_at       timestamptz,
  constraint verification_found_has_state check (
    (result =  'not_found' and condition is null     and location is null) or
    (result <> 'not_found' and condition is not null and location is not null)),
  constraint verification_not_found_says_why check (
    result <> 'not_found' or nullif(btrim(note), '') is not null),
  constraint verification_checks_object check (jsonb_typeof(checks) = 'object'),
  constraint verification_applied_has_who check ((applied_at is null) = (applied_by is null))
);

create index if not exists asset_verifications_asset_idx
  on ops_inv.asset_verifications (asset_id, verified_at desc, verification_no desc);

comment on table ops_inv.asset_verifications is
  'One check of an asset against the real thing (0290, D447). Append-only: a recheck is a new row, the latest '
  'row per asset is its status, and the only change a row takes is the one-time applied_* stamp.';

-- Append-only, held below the seams. Postgres has no column grant that binds
-- the table owner, so a trigger it is.
create or replace function ops_inv.asset_verification_append_only()
returns trigger
language plpgsql set search_path = ops_inv, pg_temp as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = 'check_violation',
      message = format('Verification %s cannot be deleted. A recheck is a new verification.', old.verification_no);
  end if;
  if old.applied_at is null and new.applied_at is not null
     and (to_jsonb(new) - 'applied_at' - 'applied_by') = (to_jsonb(old) - 'applied_at' - 'applied_by') then
    return new;
  end if;
  raise exception using errcode = 'check_violation',
    message = format('Verification %s cannot be changed. A recheck is a new verification.', old.verification_no);
end $$;

drop trigger if exists asset_verification_append_only on ops_inv.asset_verifications;
create trigger asset_verification_append_only
  before update or delete on ops_inv.asset_verifications
  for each row execute function ops_inv.asset_verification_append_only();

alter table ops_inv.asset_verifications enable row level security;
drop policy if exists asset_verifications_read on ops_inv.asset_verifications;
create policy asset_verifications_read on ops_inv.asset_verifications for select to authenticated
  using ((select ops_core.has_permission('inventory.read')));
grant select on ops_inv.asset_verifications to authenticated;

-- ── 4. the photos' folder ────────────────────────────────────────────────
-- `{ASSET}` is the asset's number. The photos are uploaded before the
-- verification exists (as an item's are before the item, 0168), so the screen
-- files them with the asset's number; once linked, the verification's number
-- answers the same folder.
create or replace function ops_core.drive_path_for_record(
  p_kind ops_core.doc_kind_t, p_entity text, p_entity_no text, p_day date default null)
returns text
language plpgsql stable security definer set search_path = ops_core, pg_temp as $$
declare v_path text; v_client text; v_project text; v_coll text; v_room text; v_item text; v_meeting text;
        v_asset text;
begin
  v_path := ops_core.drive_path_for(p_kind, p_entity, p_day);
  if v_path !~ '\{(CLIENT|PROJECT|COLLECTION|ROOM|ITEM|MEETING|ASSET)\}' then
    return v_path;
  end if;
  if p_entity_no is not null then
    if v_path ~ '\{(CLIENT|PROJECT)\}' then
      select x.client_folder, x.project_folder into v_client, v_project
        from ops_procure.drive_context(p_entity, p_entity_no) x
       limit 1;
    end if;
    if v_path ~ '\{(COLLECTION|ROOM|ITEM)\}' then
      select x.collection_folder, x.room_folder, x.item_folder into v_coll, v_room, v_item
        from ops_procure.drive_context_design(p_entity, p_entity_no) x
       limit 1;
    end if;
    if v_path ~ '\{MEETING\}' then
      v_meeting := ops_procure.drive_context_meeting(p_entity, p_entity_no);
    end if;
    if v_path ~ '\{ASSET\}' then
      select a.asset_no into v_asset
        from ops_inv.assets a
       where a.asset_no = btrim(p_entity_no)
          or a.id = (select av.asset_id from ops_inv.asset_verifications av
                      where av.verification_no = btrim(p_entity_no))
       limit 1;
    end if;
  end if;
  return replace(replace(replace(replace(replace(replace(replace(v_path,
    '{CLIENT}',     coalesce(v_client,  'TANPA KLIEN')),
    '{PROJECT}',    coalesce(v_project, 'TANPA PROYEK')),
    '{COLLECTION}', coalesce(v_coll,    'TANPA KOLEKSI')),
    '{ROOM}',       coalesce(v_room,    'TANPA RUANGAN')),
    '{ITEM}',       coalesce(v_item,    'TANPA ITEM')),
    '{MEETING}',    coalesce(v_meeting, 'TANPA MEETING')),
    '{ASSET}',      coalesce(v_asset,   'TANPA ASET'));
end $$;
comment on function ops_core.drive_path_for_record(ops_core.doc_kind_t, text, text, date) is
  'drive_path_for, with {CLIENT}, {PROJECT}, {COLLECTION}, {ROOM}, {ITEM}, {MEETING} and {ASSET} read from the record '
  'the file is filed against (TANPA … where it says nothing). (0217, 0222, 0224, 0290)';
revoke all on function ops_core.drive_path_for_record(ops_core.doc_kind_t, text, text, date) from public;
grant execute on function ops_core.drive_path_for_record(ops_core.doc_kind_t, text, text, date) to authenticated;

insert into ops_core.drive_paths (kind, entity, path, note) values
  ('foto', 'asset_verification', 'INVENTORY/ASSET VERIFICATION/{ASSET}',
   'Photos taken at an asset verification, one folder per asset (0290, D447).')
on conflict (kind, entity) do nothing;

-- ── 5. the field checks ──────────────────────────────────────────────────
-- Null when the checks agree with the result; otherwise the refusal. The four
-- fields are the ones the screen checks; a key outside them is a typo, not an
-- extension, until a migration says otherwise.
create or replace function ops_inv.verification_checks_invalid(
  p_asset_no text, p_result text, p_checks jsonb)
returns jsonb
language plpgsql stable security invoker set search_path = ops_inv, ops_core, pg_temp as $$
declare v_key text; v_val jsonb; v_found text; n_bad int := 0;
begin
  if p_checks is null or jsonb_typeof(p_checks) <> 'object' then
    return ops_core.invalid('inventory','asset_verification', p_asset_no,'verify',
      'checks_required','Check each field: name, brand, model and quantity.', jsonb_build_object('field','checks'));
  end if;
  for v_key, v_val in select key, value from jsonb_each(p_checks) loop
    if v_key not in ('name','brand','model','qty') then
      return ops_core.invalid('inventory','asset_verification', p_asset_no,'verify',
        'check_unknown', format('"%s" is not a field a verification checks.', v_key),
        jsonb_build_object('field','checks','key', v_key));
    end if;
    if jsonb_typeof(v_val) <> 'object' or jsonb_typeof(v_val -> 'ok') <> 'boolean' then
      return ops_core.invalid('inventory','asset_verification', p_asset_no,'verify',
        'check_malformed', format('Say whether %s matches.', v_key),
        jsonb_build_object('field','checks','key', v_key));
    end if;
    if not (v_val ->> 'ok')::boolean then
      n_bad := n_bad + 1;
      v_found := nullif(btrim(v_val ->> 'found'), '');
      if v_found is null then
        return ops_core.invalid('inventory','asset_verification', p_asset_no,'verify',
          'found_required', format('%s is different: say what it should be.', initcap(v_key)),
          jsonb_build_object('field','checks','key', v_key));
      end if;
      if v_key = 'qty' and v_found !~ '^\d+$' then
        return ops_core.invalid('inventory','asset_verification', p_asset_no,'verify',
          'qty_invalid','A quantity found is a whole number.', jsonb_build_object('field','checks','key', v_key));
      end if;
    end if;
  end loop;
  if (select count(*) from jsonb_object_keys(p_checks)) < 4 then
    return ops_core.invalid('inventory','asset_verification', p_asset_no,'verify',
      'checks_incomplete','Check all four fields — name, brand, model and quantity — before saving.',
      jsonb_build_object('field','checks',
        'missing', (select jsonb_agg(k) from unnest(array['name','brand','model','qty']) k where not p_checks ? k)));
  end if;
  if p_result = 'match' and n_bad > 0 then
    return ops_core.invalid('inventory','asset_verification', p_asset_no,'verify',
      'result_disagrees','A field is marked different, so this is a mismatch, not a match.',
      jsonb_build_object('field','result'));
  end if;
  if p_result = 'mismatch' and n_bad = 0 then
    return ops_core.invalid('inventory','asset_verification', p_asset_no,'verify',
      'result_disagrees','Every field matches, so this is a match, not a mismatch.',
      jsonb_build_object('field','result'));
  end if;
  return null;
end $$;
revoke all on function ops_inv.verification_checks_invalid(text, text, jsonb) from public;

-- ── 6. recording a check ─────────────────────────────────────────────────
create or replace function ops_inv.verify_asset(
  p_asset_no  text,
  p_result    text,
  p_condition text    default null,
  p_location  text    default null,
  p_checks    jsonb   default '{}'::jsonb,
  p_note      text    default null,
  p_photo_ids uuid[]  default '{}',
  p_key       text    default null)
returns jsonb
language plpgsql security definer set search_path = ops_inv, ops_core, pg_temp as $$
declare
  a          ops_inv.assets;
  bad        jsonb;
  v_no       text;
  v_note     text   := nullif(btrim(p_note), '');
  v_loc      text   := nullif(btrim(p_location), '');
  v_photos   uuid[] := coalesce(p_photo_ids, '{}');
  v_n_photos int;
  v_photo    uuid;
  v_checks   jsonb;
  res        jsonb;
  replayed   jsonb;
begin
  replayed := ops_core.idem_replay('inventory','verify_asset', p_key);
  if replayed is not null then return replayed; end if;

  if not ops_core.has_permission('inventory.update') then
    return ops_core.refused('inventory','asset_verification', p_asset_no,'verify',
      'not_permitted','Verifying an asset needs inventory write access.');
  end if;
  select * into a from ops_inv.assets where asset_no = btrim(p_asset_no);
  if not found then
    return ops_core.not_found('inventory','asset_verification', p_asset_no,'verify','No such asset.');
  end if;
  if a.ended_on is not null then
    return ops_core.conflict('inventory','asset_verification', a.asset_no,'verify',
      'asset_gone', format('%s left the register (%s on %s). Bring it back before verifying it.',
                           a.asset_no, a.status, a.ended_on),
      jsonb_build_object('status', a.status, 'ended_on', a.ended_on));
  end if;
  if p_result is null or p_result not in ('match','mismatch','not_found') then
    return ops_core.invalid('inventory','asset_verification', a.asset_no,'verify',
      'result_invalid','A verification is a match, a mismatch, or not found.', jsonb_build_object('field','result'));
  end if;

  v_n_photos := coalesce(array_length(v_photos, 1), 0);
  if v_n_photos > 4 then
    return ops_core.invalid('inventory','asset_verification', a.asset_no,'verify',
      'too_many_photos','At most four photos per verification.', jsonb_build_object('field','photos','given', v_n_photos));
  end if;
  if (select count(distinct x) from unnest(v_photos) x) <> v_n_photos then
    return ops_core.invalid('inventory','asset_verification', a.asset_no,'verify',
      'duplicate_photo','The same photo was sent twice.', jsonb_build_object('field','photos'));
  end if;
  if exists (select 1 from unnest(v_photos) x
              where not exists (select 1 from ops_core.attachments t where t.id = x)) then
    return ops_core.not_found('inventory','asset_verification', a.asset_no,'verify','One of the photos was not found.');
  end if;

  if p_result = 'not_found' then
    if v_note is null then
      return ops_core.invalid('inventory','asset_verification', a.asset_no,'verify',
        'note_required','Say where you looked, so the next person does not look there again.',
        jsonb_build_object('field','note'));
    end if;
    -- Nothing was there to check: no condition, no place, no field checks.
    v_checks := '{}'::jsonb;
    v_loc := null;
  else
    if p_condition is null or p_condition not in ('working','broken','untested') then
      return ops_core.invalid('inventory','asset_verification', a.asset_no,'verify',
        'condition_required','Say whether it works, is broken, or could not be tested.',
        jsonb_build_object('field','condition'));
    end if;
    if v_loc is null or not exists (select 1 from ops_inv.stock_locations l where l.code = v_loc and l.is_active) then
      return ops_core.invalid('inventory','asset_verification', a.asset_no,'verify',
        'location_required','Pick where it is now from the location list.', jsonb_build_object('field','location'));
    end if;
    bad := ops_inv.verification_checks_invalid(a.asset_no, p_result, p_checks);
    if bad is not null then return bad; end if;
    -- The whole machine, photographed at this check (as D309 holds item photos).
    if v_n_photos < 1 then
      return ops_core.invalid('inventory','asset_verification', a.asset_no,'verify',
        'photo_required','A photo of the whole machine is required.', jsonb_build_object('field','photos'));
    end if;
    v_checks := p_checks;
  end if;

  insert into ops_inv.asset_verifications (asset_id, result, condition, location, checks, note, verified_by)
  values (a.id, p_result::ops_inv.verification_result_t,
          case when p_result = 'not_found' then null else p_condition::ops_inv.asset_condition_t end,
          v_loc, v_checks, v_note, auth.uid())
  returning verification_no into v_no;

  foreach v_photo in array v_photos loop
    insert into ops_core.attachment_links (attachment_id, entity, entity_no, kind, linked_by)
    values (v_photo, 'asset_verification', v_no, 'foto', auth.uid());
  end loop;

  res := ops_core.ok('inventory','asset_verification', v_no,'verify',
    jsonb_build_object('verification_no', v_no, 'asset_no', a.asset_no, 'result', p_result, 'photos', v_n_photos),
    null,
    jsonb_build_object('asset_no', a.asset_no, 'result', p_result, 'condition', p_condition,
                       'location', v_loc, 'checks', v_checks, 'note', v_note));
  return ops_core.idem_remember('inventory','verify_asset', p_key, res);
end $$;

-- ── 7. applying a check to the asset ─────────────────────────────────────
-- The only road from a verification to the asset. A mismatch writes the found
-- name, brand and model, and moves the asset to where it was found; a match
-- moves it only; not found marks it lost, dated the day it was looked for.
-- A quantity found cannot be applied — an asset is one unit — and is said so.
create or replace function ops_inv.apply_verification(p_verification_no text)
returns jsonb
language plpgsql security definer set search_path = ops_inv, ops_core, pg_temp as $$
declare
  v        ops_inv.asset_verifications;
  a        ops_inv.assets;
  v_latest text;
  v_before jsonb;
  v_after  jsonb;
  v_name   text;
  v_brand  text;
  v_model  text;
  v_skip   jsonb := '[]'::jsonb;
begin
  if not ops_core.has_permission('inventory.update') then
    return ops_core.refused('inventory','asset_verification', p_verification_no,'apply',
      'not_permitted','Applying a correction needs inventory write access.');
  end if;
  select * into v from ops_inv.asset_verifications where verification_no = btrim(p_verification_no);
  if not found then
    return ops_core.not_found('inventory','asset_verification', p_verification_no,'apply','No such verification.');
  end if;
  if v.applied_at is not null then
    return ops_core.conflict('inventory','asset_verification', v.verification_no,'apply',
      'already_applied', format('%s was already applied on %s.', v.verification_no,
                                to_char(v.applied_at at time zone ops_core.office_tz(), 'YYYY-MM-DD HH24:MI')),
      jsonb_build_object('applied_at', v.applied_at));
  end if;
  select * into a from ops_inv.assets where id = v.asset_id for update;
  select x.verification_no into v_latest from ops_inv.asset_verifications x
   where x.asset_id = v.asset_id order by x.verified_at desc, x.verification_no desc limit 1;
  if v_latest <> v.verification_no then
    return ops_core.conflict('inventory','asset_verification', v.verification_no,'apply',
      'superseded', format('%s has a newer check, %s. Apply that one instead.', a.asset_no, v_latest),
      jsonb_build_object('latest', v_latest));
  end if;
  if a.ended_on is not null then
    return ops_core.conflict('inventory','asset_verification', v.verification_no,'apply',
      'asset_gone', format('%s already left the register (%s).', a.asset_no, a.status),
      jsonb_build_object('status', a.status));
  end if;

  v_before := to_jsonb(a) - 'id' - 'created_by' - 'created_at' - 'updated_at';

  if v.result = 'not_found' then
    update ops_inv.assets set
      status     = 'lost',
      ended_on   = ops_core.office_day(v.verified_at),
      updated_at = now()
    where id = a.id;
  else
    if v.checks -> 'name' ->> 'ok' = 'false' then v_name := btrim(v.checks -> 'name' ->> 'found'); end if;
    if v.checks -> 'brand' ->> 'ok' = 'false' then v_brand := btrim(v.checks -> 'brand' ->> 'found'); end if;
    if v.checks -> 'model' ->> 'ok' = 'false' then v_model := btrim(v.checks -> 'model' ->> 'found'); end if;
    if v.checks -> 'qty' ->> 'ok' = 'false' then v_skip := v_skip || '"qty"'::jsonb; end if;
    update ops_inv.assets set
      name       = coalesce(v_name, name),
      brand      = coalesce(v_brand, brand),
      model      = coalesce(v_model, model),
      location   = coalesce(v.location, location),
      updated_at = now()
    where id = a.id;
  end if;

  select to_jsonb(x) - 'id' - 'created_by' - 'created_at' - 'updated_at' into v_after
    from ops_inv.assets x where x.id = a.id;

  if v_after = v_before then
    update ops_inv.assets set updated_at = a.updated_at where id = a.id;
    return ops_core.noop('inventory','asset_verification', v.verification_no,'apply',
      'The asset already says what this check found.',
      jsonb_build_object('verification_no', v.verification_no, 'asset_no', a.asset_no, 'not_applied', v_skip));
  end if;

  update ops_inv.asset_verifications set applied_at = now(), applied_by = auth.uid() where id = v.id;

  -- On the asset's own trail, so its history reads "corrected from VRF-…".
  perform ops_core.write_audit('inventory','asset', a.asset_no,'apply_verification','ok',
    format('Corrected from %s', v.verification_no), v_before, v_after,
    jsonb_build_object('verification_no', v.verification_no, 'result', v.result));

  return ops_core.ok('inventory','asset_verification', v.verification_no,'apply',
    jsonb_build_object('verification_no', v.verification_no, 'asset_no', a.asset_no, 'not_applied', v_skip),
    (select jsonb_object_agg(k, v_before -> k) from jsonb_object_keys(v_after) k where v_before -> k is distinct from v_after -> k),
    (select jsonb_object_agg(k, v_after -> k)  from jsonb_object_keys(v_after) k where v_before -> k is distinct from v_after -> k));
end $$;

-- Closed to PUBLIC (and so to anon, whose key ships in the browser), open to
-- the signed-in, who are then judged inside (0125).
revoke execute on function
  ops_inv.verify_asset(text, text, text, text, jsonb, text, uuid[], text),
  ops_inv.apply_verification(text)
  from public;
grant execute on function
  ops_inv.verify_asset(text, text, text, text, jsonb, text, uuid[], text),
  ops_inv.apply_verification(text)
  to authenticated;

-- ── 8. the view the screens read ─────────────────────────────────────────
-- One row per asset still on the register, with its latest check. `status`
-- is computed, never stored: unverified until somebody checks it.
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
         coalesce(lv.result::text, 'unverified')    as status,
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
             and k.unlinked_at is null), 0)::int                          as verification_photo_count
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

alter view ops_inv.v_asset_verification set (security_invoker = on);
grant select on ops_inv.v_asset_verification to authenticated;

comment on view ops_inv.v_asset_verification is
  'One row per asset on the register (and the lost ones a check found missing), with its latest verification; '
  'status is unverified until somebody checks it (0290, D447).';

analyze ops_inv.asset_verifications;
analyze ops_inv.assets;
