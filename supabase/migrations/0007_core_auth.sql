-- 0007_core_auth.sql — B5. Who is asking, according to Supabase Auth.
--
-- `0002` built the grant tables and the two functions every policy calls, but
-- it left the row in `ops_core.users` to be conjured by somebody. This migration
-- closes that: signing in **provisions**, granting is an audited seam, and
-- `actAs` — the demo's persona picker — has nowhere left to land.
--
-- The order in `03-estimate.md` puts this first for a reason worth repeating:
-- every refusal in every other schema is theatre until the database knows who
-- is asking. A policy that reads `auth.uid()` when `auth.uid()` is always the
-- same developer proves nothing at all.

-- ── provisioning ──────────────────────────────────────────────────────────
-- A person exists in two places: `auth.users`, which Supabase owns and which
-- holds the password and the session, and `ops_core.users`, which we own and which
-- holds the name, the grants and the trail. The second must never be created by
-- hand — a sign-in that finds no profile row is a user who can authenticate and
-- do nothing, and the support call that follows is unanswerable.
--
-- **Nobody arrives with access.** A new row gets zero modules and zero
-- authorities, and somebody holding `it.manage_roles` grants them. That is the
-- opposite of the old system, where a new account inherited whatever the role
-- string implied, and it is the reason a leaver is a `left_on` date rather than
-- a deletion (A5).
create or replace function ops_core.provision_user()
returns trigger
language plpgsql security definer set search_path = ops_core, pg_temp as $$
begin
  insert into ops_core.users (id, email, full_name)
  values (
    new.id,
    new.email,
    -- What the identity provider knows us as, falling back to the local part of
    -- the address. A blank name on an approval trail is worse than a rough one.
    coalesce(
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      nullif(new.raw_user_meta_data ->> 'name', ''),
      split_part(new.email, '@', 1)))
  -- Re-provisioning is a no-op, never an overwrite: a second sign-up attempt on
  -- an existing address must not reset the name somebody corrected by hand.
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists provision_user on auth.users;
create trigger provision_user
  after insert on auth.users
  for each row execute function ops_core.provision_user();

-- ── the sign-in trail ─────────────────────────────────────────────────────
-- An access trail with no session events cannot answer "who was in the system
-- at the time", which is the first question anybody asks it. The demo recorded
-- its act-as for exactly this reason; the real one records the sign-in.
--
-- Called by `src/lib/api/identity.ts` after Supabase returns a session. It is
-- deliberately not a trigger on `auth.sessions`: that table is Supabase's, and
-- hanging our audit off somebody else's schema is a thing that breaks silently
-- on their upgrade.
create or replace function ops_core.record_sign_in()
returns void
language plpgsql security definer set search_path = ops_core, pg_temp as $$
declare u ops_core.users;
begin
  select * into u from ops_core.users where id = auth.uid();
  if not found then
    -- Authenticated by Supabase, unknown here. Possible when a row was created
    -- before the trigger existed. Recorded rather than raised: refusing the
    -- sign-in would lock out the one person who can fix it.
    perform ops_core.write_audit('identity','session', null, 'sign_in',
      'refused', 'authenticated, but no profile row exists');
    return;
  end if;
  perform ops_core.write_audit('identity','session', u.email, 'sign_in', 'ok');
end $$;

-- ── granting ──────────────────────────────────────────────────────────────
-- `setModules` and `setAuthorities` from `02-api.md`. Both are `security
-- definer` because they write the trail in the same transaction as the rows
-- (rule 3) — a grant with no audit row is a grant nobody can account for.
--
-- The refusals are the point of the file:
--
--   1. `it.manage_roles` or 403. A module level never implies it (D24).
--   2. **Never self-service**, even holding the permission. Somebody who can
--      raise their own authorities is somebody with every authority, and the
--      fact that they had to ask a second person is the whole control.
--
-- Both are written as a replace of the whole set rather than add/remove verbs:
-- the screen shows a list of checkboxes and saves it, and two verbs would make
-- "what does this person hold" a question about the order of the calls.
create or replace function ops_core.set_modules(
  p_user_id uuid,
  p_modules jsonb          -- [{"module":"procurement","level":"write"}, ...]
) returns jsonb
language plpgsql security definer set search_path = ops_core, pg_temp as $$
declare
  target ops_core.users;
  v_before jsonb;
  v_after  jsonb;
begin
  if not ops_core.has_permission('it.manage_roles') then
    return ops_core.refused('identity','user', p_user_id::text, 'modules.set',
      'authority_required',
      'Granting access belongs to IT — logged, not applied.',
      jsonb_build_object('required','it.manage_roles'));
  end if;

  if p_user_id = auth.uid() then
    return ops_core.refused('identity','user', p_user_id::text, 'modules.set',
      'self_service_refused',
      'Ask somebody else to change your own access.');
  end if;

  select * into target from ops_core.users where id = p_user_id;
  if not found then
    return ops_core.not_found('identity','user', p_user_id::text, 'modules.set',
      'No such user.');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('module', module, 'level', level) order by module), '[]'::jsonb)
    into v_before from ops_core.user_modules where user_id = p_user_id;

  -- The only DELETE in this system, and it is on a grant rather than on a fact.
  -- Nothing is deleted (A2) applies to what happened; what somebody may open
  -- today is a current state, and keeping every revoked row would make
  -- `has_permission` a question about timestamps. The trail below is what
  -- carries the history, with the before and after set out in full.
  delete from ops_core.user_modules where user_id = p_user_id;

  insert into ops_core.user_modules (user_id, module, level, granted_by)
  select p_user_id,
         (m ->> 'module')::ops_core.module_t,
         (m ->> 'level')::ops_core.module_level_t,
         auth.uid()
    from jsonb_array_elements(coalesce(p_modules, '[]'::jsonb)) m;

  select coalesce(jsonb_agg(jsonb_build_object('module', module, 'level', level) order by module), '[]'::jsonb)
    into v_after from ops_core.user_modules where user_id = p_user_id;

  perform ops_core.emit('identity','access.changed', target.email,
    jsonb_build_object('user_id', p_user_id, 'modules', v_after));

  return ops_core.ok('identity','user', target.email, 'modules.set',
    jsonb_build_object('user_id', p_user_id, 'modules', v_after), v_before, v_after);
end $$;

create or replace function ops_core.set_authorities(
  p_user_id uuid,
  p_authorities text[]
) returns jsonb
language plpgsql security definer set search_path = ops_core, pg_temp as $$
declare
  target ops_core.users;
  v_before jsonb;
  v_after  jsonb;
begin
  if not ops_core.has_permission('it.manage_roles') then
    return ops_core.refused('identity','user', p_user_id::text, 'authorities.set',
      'authority_required',
      'Granting a decision belongs to IT — logged, not applied.',
      jsonb_build_object('required','it.manage_roles'));
  end if;

  -- The refusal that matters most in this file. `approve_funds` is the
  -- signature on money leaving the company; a person who can add it to their
  -- own row has removed the only thing standing between them and the bank.
  if p_user_id = auth.uid() then
    return ops_core.refused('identity','user', p_user_id::text, 'authorities.set',
      'self_service_refused',
      'An authority is granted by somebody else, always.');
  end if;

  select * into target from ops_core.users where id = p_user_id;
  if not found then
    return ops_core.not_found('identity','user', p_user_id::text, 'authorities.set',
      'No such user.');
  end if;

  select coalesce(jsonb_agg(authority order by authority), '[]'::jsonb)
    into v_before from ops_core.user_authorities where user_id = p_user_id;

  delete from ops_core.user_authorities where user_id = p_user_id;

  insert into ops_core.user_authorities (user_id, authority, granted_by)
  select p_user_id, a::ops_core.authority_t, auth.uid()
    from unnest(coalesce(p_authorities, '{}')) a;

  select coalesce(jsonb_agg(authority order by authority), '[]'::jsonb)
    into v_after from ops_core.user_authorities where user_id = p_user_id;

  perform ops_core.emit('identity','access.changed', target.email,
    jsonb_build_object('user_id', p_user_id, 'authorities', v_after));

  return ops_core.ok('identity','user', target.email, 'authorities.set',
    jsonb_build_object('user_id', p_user_id, 'authorities', v_after), v_before, v_after);
end $$;

-- ── the directory ─────────────────────────────────────────────────────────
-- What `listUsers` reads. `v_my_access` answers for one person; the IT screen
-- needs the same shape for everybody, and building it by joining three tables
-- in the client is how two screens end up disagreeing about what somebody
-- holds. RLS on `user_modules` would hide other people's grants from a
-- non-admin, so this view is `security_invoker = off` — and its own policy is
-- the permission check, done once, below.
create or replace view ops_core.v_user_access
  with (security_invoker = off) as
  select u.id, u.email, u.full_name, u.is_active, u.left_on,
         (select coalesce(jsonb_agg(jsonb_build_object('module', g.module, 'level', g.level) order by g.module), '[]'::jsonb)
            from ops_core.user_modules g where g.user_id = u.id) as modules,
         (select coalesce(jsonb_agg(ua.authority order by ua.authority), '[]'::jsonb)
            from ops_core.user_authorities ua where ua.user_id = u.id) as authorities,
         (select coalesce(jsonb_agg(distinct g.module || '.' || c.action), '[]'::jsonb)
            from ops_core.user_modules g
            join ops_core.permission_catalog c on c.module = g.module
           where g.user_id = u.id
             and (c.action = 'read'
                  or (c.admin_only and g.level = 'admin')
                  or (not c.admin_only and g.level in ('write','admin')))) as permissions
    from ops_core.users u
   -- The directory is `it.read`. Everyone signed in may read `ops_core.users` for a
   -- name against an approval (0002) — that is not the same as reading what
   -- everybody in the company is allowed to approve.
   where ops_core.has_permission('it.read');

-- ── the bootstrap problem ─────────────────────────────────────────────────
-- Granting needs `it.manage_roles`, and on a fresh database nobody holds it.
-- Somebody has to be first, and the honest ways to do it are all ugly; this is
-- the least ugly. It runs as the postgres/service role, names the person in the
-- audit trail like any other grant, and **refuses once anybody holds
-- `it` admin** — so it is a bootstrap, not a back door that stays open.
--
-- This is the only function in the schema that raises rather than returning a
-- refusal, and the exception is deliberate. It is not a seam: no screen calls
-- it and no envelope carries its answer. It is typed into psql by somebody
-- setting up a database, and for them a loud error is the right answer — a JSON
-- object saying `refused` scrolling past in a deployment log is not.
create or replace function ops_core.bootstrap_admin(p_email citext)
returns uuid
language plpgsql security definer set search_path = ops_core, pg_temp as $$
declare uid uuid;
begin
  if exists (select 1 from ops_core.user_modules where module = 'it' and level = 'admin') then
    raise exception 'bootstrap_closed: this database already has an IT administrator'
      using errcode = '42501';
  end if;

  select id into uid from ops_core.users where email = p_email;
  if not found then
    raise exception 'user_not_found: % must sign in once before being made administrator', p_email
      using errcode = 'P0002';
  end if;

  insert into ops_core.user_modules (user_id, module, level) values (uid, 'it', 'admin')
    on conflict (user_id, module) do update set level = 'admin';

  perform ops_core.write_audit('identity','user', p_email::text, 'bootstrap_admin',
    'ok', 'first administrator on an empty database');
  return uid;
end $$;

-- Never `authenticated`: the bootstrap runs from a deployment step or a
-- psql session, by somebody who already has the keys to the database.
revoke execute on function ops_core.bootstrap_admin(citext) from public;

grant select on ops_core.v_user_access to authenticated;
grant execute on function ops_core.record_sign_in() to authenticated;
grant execute on function ops_core.set_modules(uuid, jsonb) to authenticated;
grant execute on function ops_core.set_authorities(uuid, text[]) to authenticated;
