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
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
