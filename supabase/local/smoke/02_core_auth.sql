-- core auth (B5) — granting, and the two ways it refuses.
--
-- One refusal and one derivation, as the definition of done asks:
--
--   refusal    — `set_authorities` says no to a person granting themselves
--                `approve_funds`, and no to somebody without `it.manage_roles`
--   derivation — `v_my_access.permissions` is expanded from the grants on read,
--                and matches `expandPermissions()` in `src/lib/roles.ts`
--
-- The self-service refusal is the one worth writing a test for. Somebody who
-- can raise their own authorities is somebody with every authority, and the
-- only control that ever stood in front of the bank is that they had to ask a
-- second person.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('aaaaaaaa-0000-0000-0000-000000000001','it@talaliving.com',    '{"full_name":"IT Admin"}'),
  ('aaaaaaaa-0000-0000-0000-000000000002','budi@talaliving.com',  '{"full_name":"Budi Santoso"}'),
  ('aaaaaaaa-0000-0000-0000-000000000003','sari@talaliving.com',  '{"full_name":"Sari Dewi"}');

-- ── the bootstrap ─────────────────────────────────────────────────────────
-- **Called with the address in a different case, on purpose.** `email` is
-- `ops_core.citext` and the seam looks somebody up with `where email =
-- p_email`, so this asserts the case-insensitive comparison actually happens
-- *inside a function that pins `search_path = ops_core, pg_temp`*.
--
-- It is written this way because the other arrangement fails silently. With
-- the extension installed anywhere off that path — `extensions`, which is
-- where Supabase keeps pgcrypto and where the obvious `with schema` would put
-- it — Postgres does not raise. It compares the two values as text instead,
-- so this returns *no such user* about a user sitting in the table, and the
-- first administrator cannot be created. Measured before the ladder was first
-- applied to Supabase; `0001` carries the reasoning.
do $$
declare uid uuid;
begin
  uid := ops_core.bootstrap_admin('IT@TalaLiving.com');
  assert uid = 'aaaaaaaa-0000-0000-0000-000000000001',
         'the bootstrap should name the person it promoted — and find them '
         'whatever case the address was typed in';
end $$;

-- And then closes. A bootstrap that stays open is a back door.
do $$
begin
  begin
    perform ops_core.bootstrap_admin('budi@talaliving.com');
    assert false, 'the bootstrap must refuse once an administrator exists';
  exception when insufficient_privilege then
    null;  -- correct
  end;
end $$;

-- ── granting, as IT ───────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';

do $$
declare r jsonb;
begin
  r := ops_core.set_modules('aaaaaaaa-0000-0000-0000-000000000002',
    '[{"module":"procurement","level":"write"},{"module":"accounting","level":"read"}]'::jsonb);
  assert ops_core.said_ok(r), format('IT should be allowed to grant, got %s', r);
  assert jsonb_array_length(r -> 'data' -> 'modules') = 2, 'two grants were asked for';

  r := ops_core.set_authorities('aaaaaaaa-0000-0000-0000-000000000002',
    array['approve_goods']);
  assert ops_core.said_ok(r), format('IT should be allowed to grant, got %s', r);
  assert r -> 'data' -> 'authorities' = '["approve_goods"]'::jsonb,
         format('expected approve_goods, got %s', r);
end $$;

-- The trail carries the before and the after, so "what did this person hold in
-- March" is answerable from the audit log rather than from a revoked row.
do $$
declare before_v jsonb; after_v jsonb;
begin
  select before, after into before_v, after_v
    from ops_core.audit_log
   where entity_no = 'budi@talaliving.com' and action = 'modules.set' and outcome = 'ok'
   order by id desc limit 1;
  assert before_v = '[]'::jsonb, format('Budi held nothing before, log says %s', before_v);
  assert jsonb_array_length(after_v) = 2, 'the after-set belongs in the trail';
end $$;

-- ── refusal 1: never self-service ─────────────────────────────────────────
-- IT holds `it.manage_roles`. It still may not grant itself an authority.
do $$
declare r jsonb;
begin
  r := ops_core.set_authorities('aaaaaaaa-0000-0000-0000-000000000001',
    array['approve_funds']);
  assert r ->> 'outcome' = 'refused',
         format('a person must never grant themselves an authority, got %s', r);
  assert (r -> 'error' ->> 'status')::int = 403, format('403, got %s', r);
  assert r -> 'error' ->> 'code' = 'self_service_refused', format('got %s', r);
end $$;

do $$
declare n int;
begin
  select count(*) into n from ops_core.user_authorities
   where user_id = 'aaaaaaaa-0000-0000-0000-000000000001';
  assert n = 0, 'the refused grant must not have been written';

  -- A refusal is recorded, not silent (A7). This is the row that answers
  -- "has anybody been trying?".
  select count(*) into n from ops_core.audit_log
   where action = 'authorities.set' and outcome = 'refused';
  assert n = 1, format('the refusal should be in the trail once, saw %s', n);
end $$;

-- ── refusal 2: it.manage_roles or nothing ─────────────────────────────────
-- Budi holds procurement.write and approve_goods. Neither one lets him hand
-- out access, and `approve_goods` certainly does not imply it (D24).
set local request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000002';

do $$
declare r jsonb;
begin
  r := ops_core.set_modules('aaaaaaaa-0000-0000-0000-000000000003',
    '[{"module":"it","level":"admin"}]'::jsonb);
  assert r ->> 'outcome' = 'refused',
         format('granting without it.manage_roles must refuse, got %s', r);
  assert r -> 'error' ->> 'code' = 'authority_required', format('got %s', r);
end $$;

do $$
declare n int;
begin
  select count(*) into n from ops_core.user_modules
   where user_id = 'aaaaaaaa-0000-0000-0000-000000000003';
  assert n = 0, 'Sari must still hold nothing';
end $$;

-- ── the derivation ────────────────────────────────────────────────────────
-- `permissions` is expanded on read from the grants, never stored (A3, C3).
-- The expected list is exactly what `expandPermissions()` produces in
-- `src/lib/roles.ts` for the same two grants — the port is only honest if the
-- two agree, so the test names them one by one.
do $$
declare perms jsonb; mods jsonb;
begin
  select permissions, modules into perms, mods from ops_core.v_my_access;

  assert mods @> '[{"module":"procurement","level":"write"}]'::jsonb,
         format('the grant should be on the session, got %s', mods);

  assert perms @> '["procurement.read","procurement.create","procurement.update"]'::jsonb,
         format('write expands to read+create+update, got %s', perms);
  assert perms @> '["accounting.read"]'::jsonb,
         format('read expands to read alone, got %s', perms);
  assert not perms @> '["accounting.create"]'::jsonb,
         'read must not expand to create';
  assert jsonb_array_length(perms) = 4,
         format('four permissions, no more: got %s', perms);

  -- Derived, so it moves when the grant moves. A stored list is one that
  -- disagrees with the rows behind it.
  assert (select authorities from ops_core.v_my_access) = '["approve_goods"]'::jsonb,
         'the authority list is read from the grant table';
end $$;

-- ── the directory ─────────────────────────────────────────────────────────
-- `listUsers` is `it.read`. Budi has procurement and accounting; he may read
-- names (a name against an approval is not a secret) and not the access list.
do $$
declare n int;
begin
  select count(*) into n from ops_core.v_user_access;
  assert n = 0, format('the access directory is it.read; Budi saw %s rows', n);

  select count(*) into n from ops_core.users;
  assert n = 3, format('names stay readable to everybody signed in, saw %s', n);
end $$;

set local request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';

do $$
declare n int;
begin
  select count(*) into n from ops_core.v_user_access;
  assert n = 3, format('IT should see all three, saw %s', n);
end $$;

rollback;
