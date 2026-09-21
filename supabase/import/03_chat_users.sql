-- 03_chat_users.sql — step 1, the one that was held back.
--
-- `README.md` beside this file says why it waited: `ops_core.users.id` is a
-- foreign key to `auth.users(id)`, so importing the nine `chat_users` is not an
-- `insert … select` — it is **creating authentication accounts**, which is a
-- decision about people rather than about data. The owner made it on
-- 2026-09-21: finish all nine.
--
-- ── Being known is not being allowed ─────────────────────────────────────
--
-- This is what makes the step safe to run at all. `ops_core.provision_user()`
-- lands a profile with **no modules and no authorities** (D24), and the legacy
-- `core.fn_sync_auth_user()` — which also fires, because both systems hang a
-- trigger off `auth.users` — lands one with no role either. Nine people can
-- sign in afterwards and see nothing until somebody holding `it.manage_roles`
-- decides what they may open.
--
-- So this script grants nothing, in either system, on purpose. The grants are a
-- second decision and they belong on the IT screen, where they are audited.
--
-- ── No password is set, by anybody ───────────────────────────────────────
--
-- Each account is created with a 32-byte random password that is hashed
-- immediately and **never recorded anywhere** — not here, not in a log, not in
-- a message. Nobody holds it, which means there is no shared secret to leak and
-- no "temporary password" that stays in a chat thread for a year.
--
-- The way in is the way the application already provides: `requestPasswordReset`
-- from the sign-in screen, then `/set-password`. `email_confirmed_at` is set so
-- that road is open immediately; leaving it null would refuse the reset and
-- strand everybody.
--
-- This also means the script sends nothing. Nine people have accounts and do
-- not know it until somebody tells them, which is the correct order — an
-- invitation that arrives before the grant is an invitation to an empty app.
--
-- ── The shape is copied from the accounts that already work ──────────────
--
-- `auth.users` is GoTrue's table and writing it by hand is how people end up
-- with an account that exists and cannot sign in. Rather than trusting a
-- remembered field list, every column here mirrors the three accounts created
-- through the dashboard in August and used since: the zero `instance_id`, the
-- empty-string token columns (not null), `aud` and `role` both `authenticated`,
-- `$2a$` bcrypt, and a matching `auth.identities` row whose `provider_id` is
-- the user id and whose `identity_data` carries `sub`.
--
-- ── Idempotent, like every file here ─────────────────────────────────────
--
-- Gated on `ops_core.legacy_map` and on the address not already being in
-- `auth.users`. Putri's account exists from August; she is mapped, not
-- recreated. Run it twice and the second run creates nobody.
--
-- That gate is also what makes an *undone* account stay undone. Rifki and
-- Winda were created by the first run and removed the same day on the owner's
-- decision; their `legacy_map` rows remain, now `skipped` with the reason, so
-- this script passes over them. Re-creating either is a deliberate act —
-- delete their map row first — rather than something the next run does quietly.
--
-- ── Undoing one, if it comes to that ─────────────────────────────────────
--
-- `ops_core.users.id → auth.users(id)` is **ON DELETE RESTRICT**, not cascade.
-- Deleting the account first therefore fails; the order is profile, then the
-- legacy `core.users` row (which has no foreign key to auth at all and so is
-- neither blocked nor cascaded — it is simply left behind if you forget it),
-- then `auth.users`, whose `auth.identities` row does cascade.

\set ON_ERROR_STOP on

begin;

do $provision$
declare
  r       record;
  new_id  uuid;
  run     constant uuid := gen_random_uuid();
  n_made  int := 0;
  n_map   int := 0;
begin
  for r in
    select c.user_id, c.display_name, lower(btrim(c.email)) as email, c.role, c.active
      from public.chat_users c
     where coalesce(btrim(c.email), '') <> ''
       and not exists (select 1 from ops_core.legacy_map m
                        where m.source_table = 'public.chat_users'
                          and m.source_id = c.user_id)
     order by c.display_name
  loop
    -- Somebody who already has an account keeps it. The August three were made
    -- from the dashboard and one of them is in this list.
    select id into new_id from auth.users where lower(email) = r.email;

    if new_id is null then
      new_id := gen_random_uuid();

      insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password,
        email_confirmed_at, confirmation_token, recovery_token,
        email_change_token_new, email_change,
        raw_app_meta_data, raw_user_meta_data,
        created_at, updated_at
      ) values (
        '00000000-0000-0000-0000-000000000000', new_id,
        'authenticated', 'authenticated', r.email,
        -- Random, hashed, and discarded in the same expression.
        extensions.crypt(encode(extensions.gen_random_bytes(32), 'base64'),
                         extensions.gen_salt('bf')),
        now(), '', '', '', '',
        '{"provider":"email","providers":["email"]}'::jsonb,
        jsonb_build_object('full_name', r.display_name, 'email_verified', true),
        now(), now()
      );

      -- `email` is deliberately not in this list: it is a generated column,
      -- derived from `identity_data ->> 'email'`, and naming it is an error
      -- rather than a redundancy. The address still has to be inside
      -- `identity_data`, which is where GoTrue reads it from.
      insert into auth.identities (
        provider_id, user_id, identity_data, provider,
        last_sign_in_at, created_at, updated_at
      ) values (
        new_id::text, new_id,
        jsonb_build_object('sub', new_id::text, 'email', r.email, 'email_verified', true),
        'email', null, now(), now()
      );

      n_made := n_made + 1;
    end if;

    -- The profile rows are the triggers' work, not ours: `provision_user` in
    -- ops_core and `fn_sync_auth_user` in the legacy `core`. Both are
    -- `on conflict do nothing` / `do update set email`, so an account that
    -- already existed is not disturbed.

    insert into ops_core.legacy_map
      (source_table, source_id, target_table, target_id, outcome, note, run_id)
    values (
      'public.chat_users', r.user_id, 'ops_core.users', new_id,
      case when r.active then 'imported' else 'skipped' end,
      nullif(concat_ws('; ',
        case when not r.active then 'inactive in the legacy system — account not created' end,
        case when r.role is null
             then 'no role recorded in chat_users; granted nothing, which is what a new '
                  'account gets anyway — the grant is a separate decision (D24)'
             else 'legacy role ' || quote_literal(r.role)
                  || ' carried as a note only; grants are made on the IT screen' end,
        case when r.user_id like 'pending:%'
             then 'legacy id was a placeholder — this person never signed in to the old chat' end
      ), ''),
      run
    );
    n_map := n_map + 1;
  end loop;

  raise notice 'created % account(s); mapped % chat_user(s)', n_made, n_map;
end
$provision$;

commit;

\echo ''
\echo '── who can sign in now, and what they may open ─────────────────────'
select u.full_name, u.email,
       (select count(*) from ops_core.user_modules m where m.user_id = u.id)     as modules,
       (select count(*) from ops_core.user_authorities a where a.user_id = u.id) as authorities,
       a.last_sign_in_at
  from ops_core.users u
  join auth.users a on a.id = u.id
 order by u.full_name;

\echo ''
\echo '── step 1, reconciled ──────────────────────────────────────────────'
select outcome, count(*) as rows
  from ops_core.legacy_map
 where source_table = 'public.chat_users'
 group by outcome order by outcome;
