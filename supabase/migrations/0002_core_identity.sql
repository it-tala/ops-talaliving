-- 0002_core_identity.sql — who somebody is, what they may open, what they may
-- decide, and the one function every policy calls.
--
-- ADR-002: enforcement lives in the database. A user without a permission gets
-- a 403 from Postgres, not from a service that may or may not have been asked.
-- That is the whole reason this file exists before any business table.

create table ops_core.users (
  id          uuid primary key references auth.users(id) on delete restrict,
  email       citext not null unique,
  full_name   text not null,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  -- Nobody is deleted: a payslip from March is still a fact in June (A5).
  left_on     date
);

-- Which screens open, and how far inside them. A user holds several (D23).
create table ops_core.user_modules (  -- named as in 02-database.md
  user_id  uuid not null references ops_core.users(id) on delete cascade,
  module   ops_core.module_t not null,
  level    ops_core.module_level_t not null,
  granted_by uuid references ops_core.users(id),
  granted_at timestamptz not null default now(),
  primary key (user_id, module)
);

-- The named decisions. Granted on their own, never implied by a level (D24).
create table ops_core.user_authorities (
  user_id    uuid not null references ops_core.users(id) on delete cascade,
  authority  ops_core.authority_t not null,
  granted_by uuid references ops_core.users(id),
  granted_at timestamptz not null default now(),
  primary key (user_id, authority)
);

-- What each module offers, as rows rather than as a `case` inside a function:
-- adding a verb is a seed diff somebody can review, and the list the app shows
-- is the list the database expands. Mirrors `src/lib/roles.ts` (D24).
create table ops_core.permission_catalog (
  module      ops_core.module_t not null,
  action      text not null,
  -- Reserved for `admin`; everything else a module offers comes with `write`.
  admin_only  boolean not null default false,
  primary key (module, action)
);

insert into ops_core.permission_catalog (module, action, admin_only) values
  ('dashboard','read',false),
  ('hrd','read',false),('hrd','create',false),('hrd','update',false),
  ('payroll','read',false),('payroll','run',false),
  ('procurement','read',false),('procurement','create',false),('procurement','update',false),
  ('inventory','read',false),('inventory','create',false),('inventory','update',false),('inventory','adjust',false),
  ('accounting','read',false),('accounting','create',false),('accounting','update',false),
  ('marketing','read',false),('marketing','create',false),('marketing','update',false),
  ('project','read',false),('project','create',false),('project','update',false),('project','handover',false),
  ('production','read',false),('production','create',false),('production','update',false),('production','schedule',false),
  ('it','read',false),('it','update',false),('it','manage_users',true),('it','manage_roles',true),
  ('settings','read',false),('settings','update',false);

-- ── the one function every policy calls ───────────────────────────────────
-- `security definer` so a policy can read the grant tables without the user
-- needing to; `stable` so it is evaluated once per statement, not per row.
create or replace function ops_core.has_permission(code text)
returns boolean
language sql stable security definer set search_path = ops_core, pg_temp as $$
  select exists (
    select 1
      from ops_core.user_modules g
      join ops_core.permission_catalog c on c.module = g.module
     where g.user_id = auth.uid()
       and g.module::text = split_part(code, '.', 1)
       and c.action     = split_part(code, '.', 2)
       and (
            c.action = 'read'
         or (c.admin_only and g.level = 'admin')
         or (not c.admin_only and g.level in ('write','admin'))
       )
  )
$$;

-- An authority is its own question, asked with its own function, so a policy
-- can never answer it with a module level by accident.
create or replace function ops_core.has_authority(a ops_core.authority_t)
returns boolean
language sql stable security definer set search_path = ops_core, pg_temp as $$
  select exists (
    select 1 from ops_core.user_authorities ua
     where ua.user_id = auth.uid() and ua.authority = a
  )
$$;

-- What `GET /identity/me` reads. The permission list is derived on every call,
-- never stored — the same rule the rest of the system follows for status (A3).
create or replace view ops_core.v_my_access as
  select u.id, u.email, u.full_name, u.is_active,
         (select coalesce(jsonb_agg(jsonb_build_object('module', g.module, 'level', g.level)), '[]'::jsonb)
            from ops_core.user_modules g where g.user_id = u.id) as modules,
         (select coalesce(jsonb_agg(ua.authority), '[]'::jsonb)
            from ops_core.user_authorities ua where ua.user_id = u.id) as authorities,
         (select coalesce(jsonb_agg(distinct g.module || '.' || c.action), '[]'::jsonb)
            from ops_core.user_modules g
            join ops_core.permission_catalog c on c.module = g.module
           where g.user_id = u.id
             and (c.action = 'read'
                  or (c.admin_only and g.level = 'admin')
                  or (not c.admin_only and g.level in ('write','admin')))) as permissions
    from ops_core.users u
   where u.id = auth.uid();

alter table ops_core.users            enable row level security;
alter table ops_core.user_modules    enable row level security;
alter table ops_core.user_authorities enable row level security;
alter table ops_core.permission_catalog enable row level security;

-- Everybody signed in may read the directory: a name against an approval is
-- not a secret, and hiding it makes every trail unreadable.
create policy users_read on ops_core.users
  for select to authenticated using (true);
create policy catalog_read on ops_core.permission_catalog
  for select to authenticated using (true);

-- Grants are readable by their owner and by whoever administers access.
create policy grants_read on ops_core.user_modules
  for select to authenticated
  using (user_id = auth.uid() or ops_core.has_permission('it.manage_roles'));
create policy authorities_read on ops_core.user_authorities
  for select to authenticated
  using (user_id = auth.uid() or ops_core.has_permission('it.manage_roles'));

-- Granting is `it.manage_roles`, and never self-service.
create policy grants_write on ops_core.user_modules
  for all to authenticated
  using (ops_core.has_permission('it.manage_roles'))
  with check (ops_core.has_permission('it.manage_roles'));
create policy authorities_write on ops_core.user_authorities
  for all to authenticated
  using (ops_core.has_permission('it.manage_roles'))
  with check (ops_core.has_permission('it.manage_roles'));
create policy users_write on ops_core.users
  for all to authenticated
  using (ops_core.has_permission('it.manage_users'))
  with check (ops_core.has_permission('it.manage_users'));

grant usage on schema ops_core to authenticated;
grant select on ops_core.users, ops_core.permission_catalog, ops_core.user_modules,
                ops_core.user_authorities, ops_core.v_my_access to authenticated;
