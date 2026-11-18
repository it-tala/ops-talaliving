-- inv — asset verification: a check against the real thing, and the one road
-- from a check to the asset (0289, 0290, 0291, D447).
--
--   a mismatch with a photo -> verify_asset -> VRF-…, the photo filed against
--     the verification; v_asset_verification shows it as the asset's status
--   apply_verification -> the found brand and the place written to the asset,
--     the asset's own trail says "Corrected from VRF-…"; a quantity found is
--     reported as not applied
--   not found -> apply -> the asset is lost, dated the day it was looked for,
--     and still listed; it cannot be verified again until brought back
--   a recheck is a new row: the older one is superseded
--   REFUSALS  no permission (verify, apply); no photo; three fields checked;
--             different without "should be"; a key that is not a field; the
--             result disagreeing with the checks; no or retired location;
--             not found without a note; applied twice; an update or a delete
--             of a verification, even by the table's owner
--   noop      a match where the asset already says it all
--   DERIVATIONS  zones on the location list beside the old rows; the machines
--             category; the photos' folder per asset

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-0000000e1601','checker-e16@talaliving.com','{"full_name":"Checker E16"}'),
  ('ffffffff-0000-0000-0000-0000000e1602','reader-e16@talaliving.com','{"full_name":"Reader E16"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-0000000e1601','inventory','write'),
  ('ffffffff-0000-0000-0000-0000000e1602','inventory','read');
insert into ops_core.attachments (id, storage_path, filename, uploaded_by)
select ('e1600000-0000-0000-0000-00000000000' || n)::uuid, 'drive/e16-' || n, 'e16-' || n || '.jpg',
       'ffffffff-0000-0000-0000-0000000e1601'
  from generate_series(1, 6) n;
insert into ops_inv.stock_locations (code, name, is_active) values ('E16-OLD', 'Retired rack E16', false);
insert into ops_inv.assets (asset_no, name, category_code, brand, model, status, legacy_code, legacy_notes) values
  ('AST-E161', 'Sander, Wide Belt', 'machine', 'MAS',     'SR-RP1300', 'in_storage', 'S2-01', null),
  ('AST-E162', 'Air Compressor',    'machine', 'BENWELL', 'B50',       'in_storage', 'A1-01', null),
  ('AST-E163', 'Glue Spreader',     'machine', null,      null,        'in_storage', 'G1-01', 'Brand missing in 2013'),
  ('AST-E164', 'Clamp Carrier',     'machine', 'V HOLD',  'CC-20',     'in_storage', 'C1-07', 'Unit 1 of 2'),
  ('AST-E165', 'Clamp Carrier',     'machine', 'V HOLD',  'CC-20',     'in_storage', 'C1-07', 'Unit 2 of 2');

/* ── what 0290/0291 put in place ─────────────────────────────────────────── */
do $$
begin
  assert (select count(*) from ops_inv.stock_locations
           where code in ('PRD','FN1','FN2','OVN','GD1','GD2','GD3','GD4','PKG','LOG',
                          'B1','B2','B3','KT1','KT2','R06','MES')) = 17, 'the 17 zones that hold things';
  assert not exists (select 1 from ops_inv.stock_locations where code in ('HD1','HD2','HB','PK1','PK2')),
    'yards and parking are not locations';
  assert exists (select 1 from ops_inv.stock_locations where code = 'GUDANG' and name = 'Gudang utama'),
    'the old rows stay as they were';
  assert exists (select 1 from ops_inv.asset_categories where code = 'machine'), 'the machines category';
  assert (select count(*) from ops_inv.assets where legacy_code = 'C1-07' and asset_no like 'AST-E16%') = 2,
    'one 2013 line, two units';
  assert ops_core.drive_path_for_record('foto', 'asset_verification', 'AST-E161')
         = 'INVENTORY/ASSET VERIFICATION/AST-E161', 'uploaded before the check: the asset''s folder';
  assert ops_core.drive_path_for_record('foto', 'asset', 'AST-E161') = 'INVENTORY/ASSETS',
    'the record photo keeps its folder';
end $$;

set local role authenticated;

/* ── refusals before anything is written ─────────────────────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-0000000e1602';
do $$
declare r jsonb;
begin
  r := ops_inv.verify_asset('AST-E161', 'match', 'working', 'PRD',
         '{"name":{"ok":true},"brand":{"ok":true},"model":{"ok":true},"qty":{"ok":true}}',
         null, array['e1600000-0000-0000-0000-000000000001']::uuid[]);
  assert r -> 'error' ->> 'code' = 'not_permitted', 'a reader cannot verify, got ' || r::text;
end $$;

set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-0000000e1601';
do $$
declare r jsonb; v_all jsonb := '{"name":{"ok":true},"brand":{"ok":true},"model":{"ok":true},"qty":{"ok":true}}';
        p uuid[] := array['e1600000-0000-0000-0000-000000000001']::uuid[];
begin
  r := ops_inv.verify_asset('AST-NOPE', 'match', 'working', 'PRD', v_all, null, p);
  assert r ->> 'status' = '404', 'no such asset, got ' || r::text;

  r := ops_inv.verify_asset('AST-E161', 'match', 'working', 'PRD', v_all, null, '{}');
  assert r -> 'error' ->> 'code' = 'photo_required', 'the whole machine, photographed, got ' || r::text;

  r := ops_inv.verify_asset('AST-E161', 'match', 'working', 'PRD',
         '{"name":{"ok":true},"brand":{"ok":true},"model":{"ok":true}}', null, p);
  assert r -> 'error' ->> 'code' = 'checks_incomplete', 'all four fields, got ' || r::text;
  assert r -> 'error' -> 'detail' -> 'missing' = '["qty"]', 'naming the one left';

  r := ops_inv.verify_asset('AST-E161', 'mismatch', 'working', 'PRD',
         '{"name":{"ok":true},"brand":{"ok":false},"model":{"ok":true},"qty":{"ok":true}}', null, p);
  assert r -> 'error' ->> 'code' = 'found_required', 'different needs "should be", got ' || r::text;

  r := ops_inv.verify_asset('AST-E161', 'match', 'working', 'PRD', v_all || '{"colour":{"ok":true}}', null, p);
  assert r -> 'error' ->> 'code' = 'check_unknown', 'not a field, got ' || r::text;

  r := ops_inv.verify_asset('AST-E161', 'mismatch', 'working', 'PRD', v_all, null, p);
  assert r -> 'error' ->> 'code' = 'result_disagrees', 'all match is not a mismatch, got ' || r::text;

  r := ops_inv.verify_asset('AST-E161', 'match', 'working', 'PRD',
         '{"name":{"ok":true},"brand":{"ok":false,"found":"X"},"model":{"ok":true},"qty":{"ok":true}}', null, p);
  assert r -> 'error' ->> 'code' = 'result_disagrees', 'a different field is not a match, got ' || r::text;

  r := ops_inv.verify_asset('AST-E161', 'match', 'working', 'E16-OLD', v_all, null, p);
  assert r -> 'error' ->> 'code' = 'location_required', 'a retired rack is not a place, got ' || r::text;
  r := ops_inv.verify_asset('AST-E161', 'match', 'working', null, v_all, null, p);
  assert r -> 'error' ->> 'code' = 'location_required', 'somewhere, got ' || r::text;

  r := ops_inv.verify_asset('AST-E161', 'match', null, 'PRD', v_all, null, p);
  assert r -> 'error' ->> 'code' = 'condition_required', 'working, broken or untested, got ' || r::text;

  r := ops_inv.verify_asset('AST-E161', 'not_found', null, null, '{}', '  ', '{}');
  assert r -> 'error' ->> 'code' = 'note_required', 'where you looked, got ' || r::text;

  r := ops_inv.verify_asset('AST-E161', 'match', 'working', 'PRD', v_all, null,
         array['e1600000-0000-0000-0000-000000000001','e1600000-0000-0000-0000-000000000001']::uuid[]);
  assert r -> 'error' ->> 'code' = 'duplicate_photo', 'the same photo twice, got ' || r::text;

  assert not exists (select 1 from ops_inv.asset_verifications), 'nothing written by a refusal';
end $$;

/* ── a mismatch, recorded and applied ────────────────────────────────────── */
do $$
declare r jsonb; v_no text; row record;
begin
  r := ops_inv.verify_asset('AST-E161', 'mismatch', 'broken', 'PRD',
         '{"name":{"ok":true},"brand":{"ok":false,"found":"HUA HUA"},"model":{"ok":true},"qty":{"ok":false,"found":"2"}}',
         'Belt torn', array['e1600000-0000-0000-0000-000000000001','e1600000-0000-0000-0000-000000000002']::uuid[]);
  assert r ->> 'outcome' = 'ok', 'a mismatch with a photo, got ' || r::text;
  v_no := r -> 'data' ->> 'verification_no';
  assert v_no ~ '^VRF-\d{6}$', 'its own series, got ' || coalesce(v_no, 'null');
  assert (select count(*) from ops_core.attachment_links
           where entity = 'asset_verification' and entity_no = v_no and kind = 'foto') = 2, 'both photos filed against it';
  assert ops_core.drive_path_for_record('foto', 'asset_verification', v_no)
         = 'INVENTORY/ASSET VERIFICATION/AST-E161', 'the verification answers the asset''s folder';

  select * into row from ops_inv.v_asset_verification where asset_no = 'AST-E161';
  assert row.status = 'mismatch' and row.condition = 'broken' and row.location = 'PRD'
     and row.verification_photo_count = 2 and row.verified_by_name = 'Checker E16'
     and row.legacy_code = 'S2-01', 'the view: ' || to_jsonb(row)::text;
  assert (select brand from ops_inv.assets where asset_no = 'AST-E161') = 'MAS', 'recording changes nothing on the asset';
  assert (select status from ops_inv.v_asset_verification where asset_no = 'AST-E162') = 'unverified', 'unverified until checked';

  -- A reader cannot apply.
  perform set_config('request.jwt.claim.sub', 'ffffffff-0000-0000-0000-0000000e1602', true);
  r := ops_inv.apply_verification(v_no);
  assert r -> 'error' ->> 'code' = 'not_permitted', 'a reader cannot apply, got ' || r::text;
  perform set_config('request.jwt.claim.sub', 'ffffffff-0000-0000-0000-0000000e1601', true);

  r := ops_inv.apply_verification(v_no);
  assert r ->> 'outcome' = 'ok', 'applied, got ' || r::text;
  assert r -> 'data' -> 'not_applied' = '["qty"]', 'a quantity is said, not written';
  assert (select brand from ops_inv.assets where asset_no = 'AST-E161') = 'HUA HUA', 'the found brand';
  assert (select location from ops_inv.assets where asset_no = 'AST-E161') = 'PRD', 'where it was found';
  assert (select name from ops_inv.assets where asset_no = 'AST-E161') = 'Sander, Wide Belt', 'a matching field untouched';
  assert (select applied_at is not null and applied_by = 'ffffffff-0000-0000-0000-0000000e1601'
            from ops_inv.asset_verifications where verification_no = v_no), 'stamped once';
  r := ops_inv.apply_verification(v_no);
  assert r -> 'error' ->> 'code' = 'already_applied', 'not twice, got ' || r::text;
end $$;

/* ── a recheck is a new row; the older one is superseded ─────────────────── */
do $$
declare r jsonb; v_first text; v_second text;
begin
  r := ops_inv.verify_asset('AST-E162', 'mismatch', 'working', 'GD1',
         '{"name":{"ok":true},"brand":{"ok":true},"model":{"ok":false,"found":"B60"},"qty":{"ok":true}}',
         null, array['e1600000-0000-0000-0000-000000000003']::uuid[]);
  v_first := r -> 'data' ->> 'verification_no';
  r := ops_inv.verify_asset('AST-E162', 'match', 'working', 'GD1',
         '{"name":{"ok":true},"brand":{"ok":true},"model":{"ok":true},"qty":{"ok":true}}',
         'Read the plate again: B50', array['e1600000-0000-0000-0000-000000000004']::uuid[]);
  v_second := r -> 'data' ->> 'verification_no';
  assert (select count(*) from ops_inv.asset_verifications v join ops_inv.assets a on a.id = v.asset_id
           where a.asset_no = 'AST-E162') = 2, 'two rows, nothing overwritten';
  assert (select status from ops_inv.v_asset_verification where asset_no = 'AST-E162') = 'match', 'the latest is the status';
  assert (select verification_count from ops_inv.v_asset_verification where asset_no = 'AST-E162') = 2, 'counted';

  r := ops_inv.apply_verification(v_first);
  assert r -> 'error' ->> 'code' = 'superseded', 'an older check is not applied, got ' || r::text;
  assert r -> 'error' -> 'detail' ->> 'latest' = v_second, 'naming the newer one';

  -- A match moves it to where it was found.
  r := ops_inv.apply_verification(v_second);
  assert r ->> 'outcome' = 'ok', 'a match moves it, got ' || r::text;
  assert (select location from ops_inv.assets where asset_no = 'AST-E162') = 'GD1', 'moved';
  assert (select model from ops_inv.assets where asset_no = 'AST-E162') = 'B50', 'the model untouched';
end $$;

/* ── a match where the asset already says it all ─────────────────────────── */
do $$
declare r jsonb; v_no text;
begin
  r := ops_inv.verify_asset('AST-E164', 'match', 'untested', 'PRD',
         '{"name":{"ok":true},"brand":{"ok":true},"model":{"ok":true},"qty":{"ok":true}}',
         null, array['e1600000-0000-0000-0000-000000000005']::uuid[]);
  v_no := r -> 'data' ->> 'verification_no';
  r := ops_inv.apply_verification(v_no);
  assert r ->> 'outcome' = 'ok', 'the first apply moves it to PRD, got ' || r::text;
  r := ops_inv.verify_asset('AST-E164', 'match', 'untested', 'PRD',
         '{"name":{"ok":true},"brand":{"ok":true},"model":{"ok":true},"qty":{"ok":true}}',
         null, array['e1600000-0000-0000-0000-000000000006']::uuid[]);
  r := ops_inv.apply_verification(r -> 'data' ->> 'verification_no');
  assert r ->> 'outcome' = 'noop', 'nothing to change, got ' || r::text;
end $$;

/* ── not found, followed up ──────────────────────────────────────────────── */
do $$
declare r jsonb; v_no text;
begin
  r := ops_inv.verify_asset('AST-E163', 'not_found', 'working', 'PRD', '{"name":{"ok":true}}',
         'Looked in PRD, FN1 and GD1', '{}');
  assert r ->> 'outcome' = 'ok', 'not found needs only a note, got ' || r::text;
  v_no := r -> 'data' ->> 'verification_no';
  assert (select condition is null and location is null and checks = '{}'
            from ops_inv.asset_verifications where verification_no = v_no), 'nothing was there to check';
  assert (select status from ops_inv.assets where asset_no = 'AST-E163') = 'in_storage', 'not found changes nothing by itself';

  r := ops_inv.apply_verification(v_no);
  assert r ->> 'outcome' = 'ok', 'followed up, got ' || r::text;
  assert (select status = 'lost' and ended_on is not null from ops_inv.assets where asset_no = 'AST-E163'), 'lost, dated';
  assert (select status from ops_inv.v_asset_verification where asset_no = 'AST-E163') = 'not_found', 'still listed';

  r := ops_inv.verify_asset('AST-E163', 'not_found', null, null, '{}', 'again', '{}');
  assert r -> 'error' ->> 'code' = 'asset_gone', 'a lost asset is brought back first, got ' || r::text;
end $$;

/* ── append-only, below the seams ────────────────────────────────────────── */
reset role;
do $$
declare v_no text := (select min(verification_no) from ops_inv.asset_verifications);
begin
  -- The trail is IT's to read (audit_read, 0003), so it is checked as the owner.
  assert exists (select 1 from ops_core.audit_log
                  where entity = 'asset' and entity_no = 'AST-E161' and action = 'apply_verification'
                    and reason = 'Corrected from ' || v_no
                    and actor_id = 'ffffffff-0000-0000-0000-0000000e1601'
                    and before ->> 'brand' = 'MAS' and after ->> 'brand' = 'HUA HUA'), 'on the asset''s own trail';
  begin
    update ops_inv.asset_verifications set note = 'rewritten' where verification_no = v_no;
    raise exception 'an update went through';
  exception when check_violation then null;
  end;
  begin
    delete from ops_inv.asset_verifications where verification_no = v_no;
    raise exception 'a delete went through';
  exception when check_violation then null;
  end;
  begin
    update ops_inv.asset_verifications set applied_at = now() where verification_no = v_no;
    raise exception 'a second stamp went through';
  exception when check_violation then null;
  end;
end $$;

rollback;
