-- inv — an asset nobody had on record, registered where it stands (0292, D448).
--
--   register_found_asset -> AST-…, in the zone, in storage, the photo as its
--     record photo and as the proof of a first check; v_asset_verification
--     reads it as `new`, verified, in that zone
--   a later recheck reads as any other check; applying the found-new check
--     changes nothing (noop)
--   REFUSALS  no permission (inventory read); no name; an unknown category;
--             no or a retired location; no condition; no photo; five photos;
--             the same photo twice; a status that has left the register; a
--             found-new check that is not a match (constraint)

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-0000000e1701','finder-e17@talaliving.com','{"full_name":"Finder E17"}'),
  ('ffffffff-0000-0000-0000-0000000e1702','reader-e17@talaliving.com','{"full_name":"Reader E17"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-0000000e1701','inventory','write'),
  ('ffffffff-0000-0000-0000-0000000e1702','inventory','read');
insert into ops_core.attachments (id, storage_path, filename, uploaded_by)
select ('e1700000-0000-0000-0000-00000000000' || n)::uuid, 'drive/e17-' || n, 'e17-' || n || '.jpg',
       'ffffffff-0000-0000-0000-0000000e1701'
  from generate_series(1, 6) n;
insert into ops_inv.stock_locations (code, name, is_active) values ('E17-OLD', 'Retired rack E17', false);

set local role authenticated;

set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-0000000e1702';
do $$
declare r jsonb;
begin
  r := ops_inv.register_found_asset('Sander, Orbital', 'tool', 'PRD', 'working',
         array['e1700000-0000-0000-0000-000000000001']::uuid[]);
  assert r -> 'error' ->> 'code' = 'not_permitted', 'a reader cannot register, got ' || r::text;
end $$;

set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-0000000e1701';
do $$
declare r jsonb; p uuid[] := array['e1700000-0000-0000-0000-000000000001']::uuid[];
begin
  r := ops_inv.register_found_asset('  ', 'tool', 'PRD', 'working', p);
  assert r -> 'error' ->> 'code' = 'name_required', 'what it is, got ' || r::text;
  r := ops_inv.register_found_asset('Sander', 'nope', 'PRD', 'working', p);
  assert r -> 'error' ->> 'code' = 'category_unknown', 'a real category, got ' || r::text;
  r := ops_inv.register_found_asset('Sander', 'tool', 'E17-OLD', 'working', p);
  assert r -> 'error' ->> 'code' = 'location_required', 'not a retired rack, got ' || r::text;
  r := ops_inv.register_found_asset('Sander', 'tool', null, 'working', p);
  assert r -> 'error' ->> 'code' = 'location_required', 'somewhere, got ' || r::text;
  r := ops_inv.register_found_asset('Sander', 'tool', 'PRD', null, p);
  assert r -> 'error' ->> 'code' = 'condition_required', 'a condition, got ' || r::text;
  r := ops_inv.register_found_asset('Sander', 'tool', 'PRD', 'working', '{}');
  assert r -> 'error' ->> 'code' = 'photo_required', 'the whole thing, photographed, got ' || r::text;
  r := ops_inv.register_found_asset('Sander', 'tool', 'PRD', 'working',
         array(select ('e1700000-0000-0000-0000-00000000000' || n)::uuid from generate_series(1, 5) n));
  assert r -> 'error' ->> 'code' = 'too_many_photos', 'four at most, got ' || r::text;
  r := ops_inv.register_found_asset('Sander', 'tool', 'PRD', 'working', p || p);
  assert r -> 'error' ->> 'code' = 'duplicate_photo', 'the same photo twice, got ' || r::text;
  r := ops_inv.register_found_asset('Sander', 'tool', 'PRD', 'working', p, p_status => 'lost');
  assert r -> 'error' ->> 'code' = 'status_invalid', 'not already gone, got ' || r::text;
  assert not exists (select 1 from ops_inv.assets where name = 'Sander'), 'nothing written by a refusal';
end $$;

do $$
declare r jsonb; v_no text; v_vrf text; row record;
begin
  r := ops_inv.register_found_asset('Sander, Orbital', 'tool', 'PRD', 'working',
         array['e1700000-0000-0000-0000-000000000001','e1700000-0000-0000-0000-000000000002']::uuid[],
         p_brand => 'Makita', p_model => 'BO5030', p_note => 'On the bench by the spray booth');
  assert r ->> 'outcome' = 'ok', 'registered, got ' || r::text;
  v_no := r -> 'data' ->> 'asset_no';
  v_vrf := r -> 'data' ->> 'verification_no';
  assert v_no ~ '^AST-\d{4,}$', 'the register''s own series, got ' || coalesce(v_no, 'null');
  assert v_vrf ~ '^VRF-\d{6}$', 'a first check, got ' || coalesce(v_vrf, 'null');

  assert (select location = 'PRD' and status = 'in_storage' and category_code = 'tool' and brand = 'Makita'
            from ops_inv.assets where asset_no = v_no), 'where it was found, in storage';
  assert (select count(*) from ops_core.attachment_links where entity = 'asset' and entity_no = v_no and kind = 'foto') = 2,
    'its record photos';
  assert (select count(*) from ops_core.attachment_links where entity = 'asset_verification' and entity_no = v_vrf) = 2,
    'and the proof of the first check';
  assert (select found_new and result = 'match' and condition = 'working'
            from ops_inv.asset_verifications where verification_no = v_vrf), 'a found-new match';

  select * into row from ops_inv.v_asset_verification where asset_no = v_no;
  assert row.status = 'new' and row.found_new and row.location = 'PRD' and row.record_photo_count = 2
     and row.verification_photo_count = 2, 'the view: ' || to_jsonb(row)::text;

  -- Applying it changes nothing: what was registered is what was seen.
  r := ops_inv.apply_verification(v_vrf);
  assert r ->> 'outcome' = 'noop', 'nothing to correct, got ' || r::text;

  -- A recheck later reads as any other.
  r := ops_inv.verify_asset(v_no, 'mismatch', 'broken', 'PRD',
         '{"name":{"ok":true},"brand":{"ok":true},"model":{"ok":false,"found":"BO5031"},"qty":{"ok":true}}',
         null, array['e1700000-0000-0000-0000-000000000003']::uuid[]);
  assert r ->> 'outcome' = 'ok', 'a recheck, got ' || r::text;
  assert (select status from ops_inv.v_asset_verification where asset_no = v_no) = 'mismatch', 'the recheck is the status';
  assert (select found_new from ops_inv.v_asset_verification where asset_no = v_no) = false, 'no longer new';
end $$;

reset role;
do $$
begin
  begin
    insert into ops_inv.asset_verifications (asset_id, result, verified_by, found_new, note)
    select id, 'not_found', 'ffffffff-0000-0000-0000-0000000e1701', true, 'x' from ops_inv.assets limit 1;
    raise exception 'a found-new not-found went through';
  exception when check_violation then null;
  end;
end $$;

rollback;
