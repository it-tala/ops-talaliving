-- core/auth-claims — the identity arrives in two shapes, and the seams must not
-- be able to tell them apart.
--
-- ── Why this file exists ─────────────────────────────────────────────────
--
-- The ladder was applied to `john-lau-v01` on 2026-09-18, and the first thing
-- worth checking afterwards was whether the harness had been modelling the
-- right thing. It had not, quite.
--
-- Supabase's real `auth.uid()` reads the signed-in user from **either** of two
-- settings:
--
--   `request.jwt.claim.sub`   one GUC per claim — the older form
--   `request.jwt.claims`      the whole JWT payload as JSON — what PostgREST
--                             actually sets, and has for years
--
-- `00_shim.sql` read only the first. Every one of the eleven smoke files sets
-- only the first. So the suite had never once exercised the shape production
-- uses — it agreed with the seams for a reason that does not hold in the place
-- the seams actually run.
--
-- Nothing in the ladder was wrong: all 14 migrations that need an identity go
-- through `auth.uid()` and none reads the setting directly, so both shapes
-- always resolved. But "nothing was wrong" was luck rather than evidence, and
-- this file turns it into evidence.
--
-- What is proved here:
--
--   the JSON form alone identifies the caller — no `claim.sub` set at all
--   the two forms produce the same actor, and the same row
--   a claims blob with no `sub` is nobody, and the seam refuses
--   a signed-out caller is refused, whichever setting is absent
--   RLS reaches the same verdict under the JSON form as under the other
--
-- `record_activity_event` is the seam under test because it is the cheapest one
-- that carries a real refusal: it records against `auth.uid()` and nothing
-- else, and it answers `not_signed_in` when there is nobody. Any seam would do;
-- this one costs a row.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('cccc3333-0000-0000-0000-000000000001','budi@talaliving.com','{"full_name":"Budi"}'),
  ('cccc3333-0000-0000-0000-00000000000f','fitri@talaliving.com','{"full_name":"Fitri IT"}');

insert into ops_core.user_modules (user_id, module, level) values
  ('cccc3333-0000-0000-0000-00000000000f','it','admin');

set local role authenticated;

-- ── the JSON form, on its own ────────────────────────────────────────────
-- Deliberately without `request.jwt.claim.sub`. This is what PostgREST sets,
-- and until now nothing in this suite ever ran this way.
do $$
declare r jsonb;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"cccc3333-0000-0000-0000-000000000001","role":"authenticated"}', true);

  assert auth.uid() = 'cccc3333-0000-0000-0000-000000000001',
         format('the JSON claims alone must identify the caller, saw %s', auth.uid());

  r := ops_core.record_activity_event('view','/procurement/tracker','Pelacakan');
  assert r ->> 'outcome' = 'ok', format('got %s', r);
  -- Whose row it is gets checked further down, as IT. Budi may not read this
  -- trail at all — not even his own line of it (D190) — so asserting it here
  -- would be asserting the policy, not the identity.
end $$;

-- ── the older form, same person, same answer ─────────────────────────────
do $$
declare r jsonb;
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', 'cccc3333-0000-0000-0000-000000000001', true);

  assert auth.uid() = 'cccc3333-0000-0000-0000-000000000001',
         format('and so must the per-claim GUC, saw %s', auth.uid());

  r := ops_core.record_activity_event('view','/accounting/tagihan','Tagihan');
  assert r ->> 'outcome' = 'ok', format('got %s', r);
end $$;

-- ── a claims blob with no `sub` is nobody ────────────────────────────────
-- The shape a misconfigured gateway produces: a JWT arrived, it was parsed, and
-- it says nothing about who. Answering *anonymous* here would be the worst of
-- the three possible answers, because every RLS policy would then evaluate
-- against a null actor rather than refusing.
do $$
declare r jsonb;
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '{"role":"authenticated"}', true);

  assert auth.uid() is null, format('a claims blob with no sub is nobody, saw %s', auth.uid());

  r := ops_core.record_activity_event('view','/dashboard','Dasbor');
  assert r #>> '{error,code}' = 'not_signed_in', format('got %s', r);
end $$;

-- ── neither setting at all ───────────────────────────────────────────────
do $$
declare r jsonb;
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);

  assert auth.uid() is null, 'nobody is signed in';
  r := ops_core.record_activity_event('view','/dashboard','Dasbor');
  assert r #>> '{error,code}' = 'not_signed_in', format('got %s', r);
end $$;

-- ── RLS reaches the same verdict under the JSON form ─────────────────────
-- The identity is only half of it: the policies have to read the same person.
-- `activity_events` is `it.read` and nothing else (D190), so Budi sees none of
-- his own and Fitri sees all of them — the same split `11_core_activity_log`
-- proves under the other setting.
do $$
declare mine int;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"cccc3333-0000-0000-0000-000000000001","role":"authenticated"}', true);
  select count(*) into mine from ops_core.activity_events;
  assert mine = 0, format('not even his own, under JSON claims — saw %s', mine);
end $$;

do $$
declare all_rows int; mine int;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"cccc3333-0000-0000-0000-00000000000f","role":"authenticated"}', true);

  select count(*) into all_rows from ops_core.activity_events;
  assert all_rows = 2, format('IT reads everybody''s, under JSON claims — saw %s', all_rows);

  -- And both acts landed on the same person, which is the whole point: the two
  -- claim shapes named one caller, not two.
  select count(*) into mine from ops_core.activity_events
   where actor_id = 'cccc3333-0000-0000-0000-000000000001';
  assert mine = 2,
         format('both forms identified the same person — saw %s of 2', mine);
end $$;

rollback;
