-- procure — a gallery link on a design collection (0251, D407).
--
-- DERIVATIONS  the collection reads its link (v_design_collection.gallery_url);
--              the same link again is a no-op; a blank one clears it; the
--              drafters set it too
-- REFUSALS     something that is not a web address; a collection that is not
--              there; somebody with neither sales nor production access

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('aaaa0000-0000-0000-0000-0000000c9001','sales-c9@talaliving.com','{"full_name":"Rina C9"}'),
  ('aaaa0000-0000-0000-0000-0000000c9002','drafter-c9@talaliving.com','{"full_name":"Made C9"}'),
  ('aaaa0000-0000-0000-0000-0000000c9003','gudang-c9@talaliving.com','{"full_name":"Gudang C9"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('aaaa0000-0000-0000-0000-0000000c9001','marketing','write'),
  ('aaaa0000-0000-0000-0000-0000000c9002','production','write'),
  ('aaaa0000-0000-0000-0000-0000000c9003','inventory','write');
insert into ops_procure.projects (id, code, name) values
  ('c9000000-0000-0000-0000-0000000000d1','26991','Villa Galeri');

set local role authenticated;
set local request.jwt.claim.sub = 'aaaa0000-0000-0000-0000-0000000c9001';
do $$
declare r jsonb;
begin
  perform ops_procure.save_design_collection('26991', 'A', 'Type 2BR');
  r := ops_procure.set_design_collection_gallery('26991', 'A', 'album keluarga');
  assert r->'error'->>'code' = 'bad_url', 'a web address: ' || r::text;
  r := ops_procure.set_design_collection_gallery('26991', 'Z', 'https://photos.app.goo.gl/abc');
  assert r->'error'->>'code' = 'not_found', 'no such collection: ' || r::text;
  r := ops_procure.set_design_collection_gallery('26991', 'a', ' https://photos.app.goo.gl/abc123 ');
  assert ops_core.said_ok(r), 'set: ' || r::text;
  assert (select gallery_url from ops_procure.v_design_collection where project_code = '26991' and code = 'A')
       = 'https://photos.app.goo.gl/abc123', 'the collection reads its link';
  r := ops_procure.set_design_collection_gallery('26991', 'A', 'https://photos.app.goo.gl/abc123');
  assert r->>'outcome' = 'noop', 'the same link: ' || r::text;
end $$;

set local request.jwt.claim.sub = 'aaaa0000-0000-0000-0000-0000000c9002';
do $$
declare r jsonb;
begin
  r := ops_procure.set_design_collection_gallery('26991', 'A', 'https://photos.google.com/share/xyz');
  assert ops_core.said_ok(r), 'a drafter changes it: ' || r::text;
  r := ops_procure.set_design_collection_gallery('26991', 'A', '  ');
  assert ops_core.said_ok(r) and (select gallery_url from ops_procure.v_design_collection where project_code = '26991') is null,
    'blank clears it: ' || r::text;
end $$;

set local request.jwt.claim.sub = 'aaaa0000-0000-0000-0000-0000000c9003';
do $$
declare r jsonb;
begin
  r := ops_procure.set_design_collection_gallery('26991', 'A', 'https://photos.app.goo.gl/x');
  assert r->'error'->>'code' = 'not_permitted', 'outsider: ' || r::text;
end $$;

rollback;
