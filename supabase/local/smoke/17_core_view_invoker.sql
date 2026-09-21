-- core — every view reads with the reader's rights, except the two that must
-- not.
--
-- ── The guard this file is ───────────────────────────────────────────────
--
-- A view with no `security_invoker` runs with its **owner's** rights, and the
-- owner here is `postgres`, which has `bypassrls`. So such a view hands every
-- row of every table it touches to anybody who may select from it, whatever the
-- policies say.
--
-- `0014` claimed the opposite — *views run with the caller's rights by default
-- in Postgres 15+* — and on the strength of that claim twenty views were given
-- the setting "for clarity" and three were missed. One of the three,
-- `v_po_detail`, is read by two live routes and was safe only because its inner
-- joins happen to be invoker views (0037).
--
-- The claim is measured here rather than repeated, and then the rule is
-- enforced over every view in the ladder, so the next one cannot be missed.

begin;

/* ── the default, measured ─────────────────────────────────────────────── */

insert into auth.users (id, email, raw_user_meta_data) values
  ('cafe0000-0000-0000-0000-00000000dead','out@talaliving.com','{"full_name":"Out"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('cafe0000-0000-0000-0000-00000000dead','hrd','admin');
insert into ops_procure.vendors (id, code, name) values
  ('ca110000-0000-0000-0000-000000000009','V-PROBE','Rahasia');

create view ops_procure.v_leak_probe as select code, name from ops_procure.vendors;
grant select on ops_procure.v_leak_probe to authenticated;

do $$
declare o text;
begin
  select coalesce(reloptions::text, '(none)') into o
    from pg_class where relname = 'v_leak_probe';
  assert o = '(none)',
    format('a view is created with no security option, got %s', o);
end $$;

set local role authenticated;
set local request.jwt.claim.sub = 'cafe0000-0000-0000-0000-00000000dead';

do $$
declare direct int; through int;
begin
  -- Holds `hrd.admin` and nothing in procurement, so the policy on `vendors`
  -- says no.
  select count(*) into direct from ops_procure.vendors;
  assert direct = 0, format('RLS refuses the table, got %s rows', direct);

  -- And the same rows arrive anyway through a view that never said whose
  -- rights it runs with. **This is the whole finding.**
  select count(*) into through from ops_procure.v_leak_probe;
  assert through = 1,
    format('a view with no option reads past RLS — if this is 0, the default '
           'changed and 0014''s comment has become true; got %s', through);
end $$;

set local role postgres;
drop view ops_procure.v_leak_probe;
set local role authenticated;

/* ── the rule, over every view in the ladder ───────────────────────────── */

do $$
declare v_strays text;
begin
  select string_agg(n.nspname || '.' || c.relname, ', ' order by c.relname)
    into v_strays
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname like 'ops\_%'
     and c.relkind = 'v'
     and not coalesce(c.reloptions::text like '%security_invoker=on%', false)
     -- The two that read past RLS on purpose: they are how somebody is told
     -- what they may open, which cannot itself be gated on what they may open.
     and (n.nspname, c.relname) not in (
           ('ops_core','v_my_access'),
           ('ops_core','v_user_access'));

  assert v_strays is null,
    format('these views run with the OWNER''s rights and hand every row past '
           'RLS: %s — add `alter view … set (security_invoker = on)`, or list '
           'it above with the reason it must not be', v_strays);
end $$;

-- And the two exceptions are still exactly two: this fails if somebody adds a
-- third by putting a name in the list above rather than fixing the view.
do $$
declare n int;
begin
  select count(*) into n
    from pg_class c join pg_namespace n2 on n2.oid = c.relnamespace
   where n2.nspname like 'ops\_%' and c.relkind = 'v'
     and not coalesce(c.reloptions::text like '%security_invoker=on%', false);
  assert n = 2, format('two views read past RLS on purpose, found %s', n);
end $$;

/* ── and the one that used to be third ─────────────────────────────────── */

do $$
declare o text;
begin
  select reloptions::text into o
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'ops_procure' and c.relname = 'v_po_detail';
  assert o like '%security_invoker=on%',
    format('v_po_detail is read by two live routes, got %s', o);
end $$;

rollback;
