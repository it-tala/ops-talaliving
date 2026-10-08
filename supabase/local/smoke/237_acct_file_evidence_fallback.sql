-- 0237 — a captured document is never lost because the sender's profile is.
--
-- Derivation: a name that matches nobody active (unknown, or a deactivated
-- account) files the document under `capture_fallback_reporter`, with the name
-- as given in `extracted.reported_as`. A name that does match files under that
-- person, with no `reported_as`.
-- Refusals: no name and no caller; a name matching two active people; the
-- fallback missing or inactive — each still `reporter_unresolved` /
-- `reporter_ambiguous`, as before 0237.
begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('23700000-0000-0000-0000-000000000001','shared237@talaliving.com','{"full_name":"shared"}'),
  ('23700000-0000-0000-0000-000000000002','it237@talaliving.com',    '{"full_name":"Tala IT 237"}'),
  ('23700000-0000-0000-0000-000000000003','putri237@talaliving.com', '{"full_name":"Putri 237"}'),
  ('23700000-0000-0000-0000-000000000004','kembar1@talaliving.com',  '{"full_name":"Kembar 237"}'),
  ('23700000-0000-0000-0000-000000000005','kembar2@talaliving.com',  '{"full_name":"Kembar 237"}');
update ops_core.users set is_active = false where id = '23700000-0000-0000-0000-000000000002';

update ops_core.settings set value = '"shared237@talaliving.com"'::jsonb
 where key = 'capture_fallback_reporter';

do $$
declare r jsonb; row_ ops_acct.evidence_inbox;
begin
  assert exists (select 1 from ops_core.settings where key = 'capture_fallback_reporter'),
    '0237 must seed the fallback setting';

  -- ── 1. a deactivated sender: filed under the fallback, name kept ─────────
  r := ops_acct.file_evidence('237-a', 'gcp.png', 'https://drive.example/237-a', 'chat', 'Tala IT 237',
         p_extracted => '{"amount_idr":400000}'::jsonb);
  assert r->>'outcome' = 'ok', 'an inactive sender must not lose the document: ' || r::text;
  select * into row_ from ops_acct.evidence_inbox where ref_id = '237-a';
  assert row_.reported_by = '23700000-0000-0000-0000-000000000001',
    'filed under the fallback account';
  assert row_.extracted->>'reported_as' = 'Tala IT 237' and (row_.extracted->>'amount_idr')::int = 400000,
    'the given name is kept beside the reading: ' || row_.extracted::text;

  -- ── 2. a name nobody has: same road ──────────────────────────────────────
  r := ops_acct.file_evidence('237-b', 'x.png', 'https://drive.example/237-b', 'chat', 'Orang Asing 237');
  assert r->>'outcome' = 'ok' and r->'data'->>'reported_as' = 'Orang Asing 237', r::text;

  -- ── 3. a known sender: their own row, nothing added ──────────────────────
  r := ops_acct.file_evidence('237-c', 'y.png', 'https://drive.example/237-c', 'chat', 'putri 237');
  select * into row_ from ops_acct.evidence_inbox where ref_id = '237-c';
  assert row_.reported_by = '23700000-0000-0000-0000-000000000003'
     and not (row_.extracted ? 'reported_as'),
    'a resolved sender is filed as themselves: ' || row_.extracted::text;

  -- ── 4. refusals that stay ────────────────────────────────────────────────
  r := ops_acct.file_evidence('237-d', 'z.png', 'https://drive.example/237-d', 'chat', null);
  assert r->'error'->>'code' = 'reporter_unresolved', 'no name, no caller: ' || r::text;

  r := ops_acct.file_evidence('237-e', 'z.png', 'https://drive.example/237-e', 'chat', 'Kembar 237');
  assert r->'error'->>'code' = 'reporter_ambiguous', 'two people of one name: ' || r::text;

  update ops_core.users set is_active = false where id = '23700000-0000-0000-0000-000000000001';
  r := ops_acct.file_evidence('237-f', 'z.png', 'https://drive.example/237-f', 'chat', 'Orang Asing 237');
  assert r->'error'->>'code' = 'reporter_unresolved', 'an inactive fallback is no fallback: ' || r::text;

  delete from ops_core.settings where key = 'capture_fallback_reporter';
  update ops_core.users set is_active = true where id = '23700000-0000-0000-0000-000000000001';
  r := ops_acct.file_evidence('237-g', 'z.png', 'https://drive.example/237-g', 'chat', 'Orang Asing 237');
  assert r->'error'->>'code' = 'reporter_unresolved', 'no setting restores the refusal: ' || r::text;

  assert not exists (select 1 from ops_acct.evidence_inbox where ref_id in ('237-d','237-e','237-f','237-g')),
    'a refusal files nothing';
end $$;

rollback;
