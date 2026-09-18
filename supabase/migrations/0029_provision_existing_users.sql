-- 0029_provision_existing_users.sql — the accounts that predate the trigger,
-- and a refusal message that sent people down a road with no end.
--
-- ── What happened ────────────────────────────────────────────────────────
--
-- `bootstrap_admin('shared@talaliving.com')` refused with `user_not_found`
-- against an address that is plainly in `auth.users`. Three accounts are —
-- created 26–28 August 2026, three weeks before this ladder was applied on
-- 18 September.
--
-- `provision_user` is `after insert on auth.users`. It fires for **new** rows
-- and there is no such thing as a retrospective insert, so every account that
-- existed before the ladder has no row in `ops_core.users` and never will get
-- one by waiting.
--
-- ── The part that was worse than the gap ─────────────────────────────────
--
-- The refusal said *must sign in once before being made administrator*. That is
-- **false**, and confidently so. Signing in does not insert into `auth.users`,
-- so it does not fire the trigger; `record_sign_in()` even had a branch
-- recognising exactly this case — *authenticated, but no profile row exists* —
-- and it wrote an audit row and returned, leaving the person no better off than
-- before. The message named an action that could be repeated for ever without
-- changing anything.
--
-- A refusal that names the wrong remedy is worse than one that names none: it
-- spends somebody's afternoon proving the system right about something it was
-- wrong about (A7 is about naming who can act; this is the same duty about
-- *what* to do).
--
-- ── Two fixes, and why both ──────────────────────────────────────────────
--
-- **The backfill** closes it for the three accounts that exist. It is a plain
-- one-time insert, idempotent, and it grants nothing: every row lands with no
-- modules and no authorities, which is the same nothing a new sign-up gets
-- (D24). Being *known* and being *allowed* stay separate, which is the whole
-- reason provisioning is not a grant.
--
-- **Self-healing sign-in** makes the message true rather than deleting it.
-- `record_sign_in()` already detected the case and merely complained about it;
-- now it provisions and carries on. That matters beyond these three: an account
-- made from the dashboard, restored from a backup, or created in any window
-- where the trigger was absent lands in the same hole, and the next person to
-- find it should not need this file.

-- ── the backfill ──────────────────────────────────────────────────────────

insert into ops_core.users (id, email, full_name)
select u.id,
       u.email,
       coalesce(
         nullif(u.raw_user_meta_data ->> 'full_name', ''),
         nullif(u.raw_user_meta_data ->> 'name', ''),
         split_part(u.email, '@', 1))
  from auth.users u
 where u.email is not null
on conflict (id) do nothing;

-- ── sign-in provisions, rather than reporting that it cannot ──────────────

create or replace function ops_core.record_sign_in()
returns void
language plpgsql security definer set search_path = ops_core, pg_temp as $$
declare u ops_core.users;
begin
  select * into u from ops_core.users where id = auth.uid();

  if not found then
    -- Authenticated by Supabase, unknown here: an account older than the
    -- trigger, or made in some window where it was not there. **Provisioned
    -- now**, because the alternative is what this function used to do — write
    -- a refusal and return, leaving somebody to sign in again and again
    -- against a message that promised it would help.
    --
    -- This grants nothing. The row arrives with no modules and no authorities,
    -- exactly as a new sign-up does; somebody holding `it.manage_roles` still
    -- has to decide what they may open (D24).
    if auth.uid() is null then
      return;                      -- nobody is signed in; nothing to record
    end if;

    insert into ops_core.users (id, email, full_name)
    select a.id,
           a.email,
           coalesce(
             nullif(a.raw_user_meta_data ->> 'full_name', ''),
             nullif(a.raw_user_meta_data ->> 'name', ''),
             split_part(a.email, '@', 1))
      from auth.users a
     where a.id = auth.uid() and a.email is not null
    on conflict (id) do nothing;

    select * into u from ops_core.users where id = auth.uid();
    if not found then
      -- Authenticated with no email at all — a phone-only or SSO identity that
      -- `ops_core.users` cannot describe, since `email` is `not null`. Recorded
      -- rather than raised: refusing the sign-in would lock out the one person
      -- who could fix it, and this is now the only branch that leaves without a
      -- profile.
      perform ops_core.write_audit('identity','session', null, 'sign_in',
        'refused', 'authenticated, but the account has no email address');
      return;
    end if;

    perform ops_core.write_audit('identity','session', u.email, 'sign_in',
      'ok', 'provisioned on first sign-in — the account predates the trigger');
    return;
  end if;

  perform ops_core.write_audit('identity','session', u.email, 'sign_in', 'ok');
end $$;

-- ── and the refusal stops naming a remedy that does nothing ───────────────

create or replace function ops_core.bootstrap_admin(p_email ops_core.citext)
returns uuid
language plpgsql security definer set search_path = ops_core, pg_temp as $$
declare uid uuid;
begin
  if exists (select 1 from ops_core.user_modules where module = 'it' and level = 'admin') then
    raise insufficient_privilege using
      message = 'bootstrap_closed: an administrator already exists; grants are made through the IT screen';
  end if;

  select id into uid from ops_core.users where email = p_email;
  if uid is null then
    -- The old wording here said *must sign in once*, which was not true: a
    -- sign-in fires no trigger, so it could be repeated for ever. Now that
    -- `record_sign_in()` provisions, it is true — and this names the other
    -- possibility as well, because an address nobody has ever registered is
    -- the likelier mistake of the two.
    raise exception 'user_not_found: % has no profile. Sign in to the app once with that '
                    'address (the profile is created on first sign-in), or check it is the '
                    'address the account was registered with.', p_email
      using errcode = 'P0002';
  end if;

  insert into ops_core.user_modules (user_id, module, level)
  values (uid, 'it', 'admin')
  on conflict (user_id, module) do update set level = 'admin';

  perform ops_core.write_audit('identity','user', p_email::text, 'bootstrap_admin', 'ok',
    'first administrator; the bootstrap closes behind itself');

  return uid;
end $$;
