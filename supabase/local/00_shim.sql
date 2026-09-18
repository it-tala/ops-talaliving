-- Local only — NEVER applied to Supabase.
--
-- Supabase gives every project an `auth` schema, an `auth.uid()` and the three
-- roles the policies name. A bare Postgres has none of them, so this shim
-- creates just enough of that surface for `psql -f` to run the real migrations
-- unchanged. If a migration needs anything else from Supabase, it belongs
-- here — not weakened in the migration.

-- Dropped and rebuilt, not `if not exists`-ed into place. `rebuild.sh` drops
-- the six application schemas and left `auth` standing, so an edit to this file
-- did nothing on a cluster that had already run once — and the shim became the
-- one thing in the ladder that only worked against yesterday's database, which
-- is the exact failure the rebuild script exists to prevent. Found the honest
-- way: adding `raw_user_meta_data` here for `0007` and watching the trigger
-- fail anyway.
drop schema if exists auth cascade;
create schema auth;

-- `raw_user_meta_data` is where Supabase puts whatever the identity provider
-- said about the person — the display name, mostly. `0007` provisions
-- `ops_core.users` from it, so the shim has to carry the column or the trigger
-- cannot be exercised locally, which would leave the one piece of auth wiring
-- that runs on every sign-in as the one piece nothing tests.
create table if not exists auth.users (
  id                  uuid primary key default gen_random_uuid(),
  email               text unique,
  raw_user_meta_data  jsonb not null default '{}'::jsonb
);

-- The signed-in user, as the API sets it. Supabase reads a JWT claim; locally
-- a session GUC does the same job, which is also how a test impersonates
-- somebody.
-- **Copied from the running project, verbatim** (2026-09-18). It reads the
-- identity from two places, and the second is the one that matters: PostgREST
-- sets `request.jwt.claims` as a JSON object and has done for years, while the
-- per-claim `request.jwt.claim.sub` GUC is the older form.
--
-- The shim used to read only the older one. Nothing in the ladder noticed,
-- because every migration goes through `auth.uid()` and never touches the
-- setting directly — checked, 14 files, zero direct reads. But it meant the
-- whole smoke suite exercised a branch production may never take, and a
-- harness that models the easy half of reality is a harness that agrees with
-- you for the wrong reason. `12_auth_claims.sql` now proves both forms give
-- the same answer.
create or replace function auth.uid() returns uuid
language sql stable as $$
  select
  coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

-- All three roles may reach `auth.uid()` on a real project — checked against
-- `john-lau-v01`, 2026-09-18, where `has_schema_privilege` and
-- `has_function_privilege` are true for every one of them.
--
-- The shim did not grant it, and that went unnoticed for eleven smoke files
-- because every one of them reaches `auth.uid()` from *inside* a `security
-- definer` seam, which runs as the owner. The first test to call it directly
-- as `authenticated` — the way a policy does — failed with *permission denied
-- for schema auth*, against a harness where nothing was actually wrong.
--
-- A harness that is stricter than production makes a passing test meaningless
-- in one direction and a failing one meaningless in the other. It matches now.
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
