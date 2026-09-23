-- procure — archiving many items at once (0120).
--
--   REFUSALS     a read grant; no codes
--   DERIVATIONS  only live, unmerged, unarchived items are archived; the
--                reason and the codes land in one audit row; a second call is
--                a noop; one item still restores through archive_item

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-000000009981','rina-ai@talaliving.com','{"full_name":"Rina AI"}'),
  ('ffffffff-0000-0000-0000-000000009982','tamu-ai@talaliving.com','{"full_name":"Tamu AI"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-000000009981','procurement','write'),
  ('ffffffff-0000-0000-0000-000000009982','procurement','read');

insert into ops_procure.items (id, code, name, category_code) values
  ('99810000-0000-0000-0000-000000000001','ZZ-AI-1','Transfer to own account','uncurated'),
  ('99810000-0000-0000-0000-000000000002','ZZ-AI-2','Transfer BCA to BNI','uncurated'),
  ('99810000-0000-0000-0000-000000000003','ZZ-AI-3','Transfer dana','uncurated'),
  ('99810000-0000-0000-0000-000000000004','ZZ-AI-4','Transfer lama','uncurated');
update ops_procure.items set merged_into = '99810000-0000-0000-0000-000000000001' where code = 'ZZ-AI-3';
update ops_procure.items set archived_at = now(), archived_by = 'ffffffff-0000-0000-0000-000000009981' where code = 'ZZ-AI-4';

set local role authenticated;

set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000009982';
do $$
declare r jsonb;
begin
  r := ops_procure.archive_items(array['ZZ-AI-1']);
  assert r -> 'error' ->> 'code' = 'not_permitted', 'read grant refused, got ' || r::text;
end $$;

set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000009981';
do $$
declare r jsonb;
begin
  r := ops_procure.archive_items(array[]::text[]);
  assert r -> 'error' ->> 'code' = 'codes_required', 'no codes, got ' || r::text;

  r := ops_procure.archive_items(array['ZZ-AI-1','ZZ-AI-2','ZZ-AI-3','ZZ-AI-4'], 'Payment descriptions, not items');
  assert r ->> 'outcome' = 'ok' and (r -> 'data' ->> 'archived')::int = 2, 'two archived, got ' || r::text;
  assert (select count(*) from ops_procure.items where code in ('ZZ-AI-1','ZZ-AI-2') and archived_at is not null) = 2, 'both archived';
  assert (select archived_at is null from ops_procure.items where code = 'ZZ-AI-3'), 'merged left alone';

  r := ops_procure.archive_items(array['ZZ-AI-1','ZZ-AI-2']);
  assert r ->> 'outcome' = 'noop', 'second call is a noop, got ' || r::text;

  r := ops_procure.archive_item('ZZ-AI-2', false);
  assert r ->> 'outcome' = 'ok' and (select archived_at is null from ops_procure.items where code = 'ZZ-AI-2'),
    'one restores, got ' || r::text;
end $$;

reset role;

do $$
declare a record;
begin
  select * into a from ops_core.audit_log where entity = 'item' and action = 'archive_many' and outcome = 'ok'
   order by at desc limit 1;
  assert a.reason = 'Payment descriptions, not items' and (a.detail ->> 'count')::int = 2
     and a.detail -> 'codes' @> '["ZZ-AI-1","ZZ-AI-2"]'::jsonb,
    'one audit row with reason and codes, got ' || row_to_json(a)::text;
end $$;

rollback;
