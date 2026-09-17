-- core — the access model, and that it actually refuses.
--
-- The failure mode this whole design exists to avoid is a screen that shows a
-- button the database then refuses, or worse, allows (§3.3). So the assertions
-- below are mostly negative: `has_permission` saying **no** is the load-bearing
-- half, and it is the half that can rot without anybody noticing.
--
--   psql -h /tmp -p 5433 -U postgres -f supabase/local/smoke/01_core_access.sql

begin;

-- Two people arrive the way people actually arrive: through Supabase Auth. The
-- row in `ops_core.users` is provisioned by the trigger in `0007`, never typed —
-- which is itself the first thing worth proving.
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111','wulan@talaliving.com', '{"full_name":"Wulan Sari"}'),
  ('22222222-2222-2222-2222-222222222222','evin@talaliving.com',  '{"full_name":"Evin Jonathan"}');

do $$
declare n int; nm text;
begin
  select count(*) into n from ops_core.users;
  assert n = 2, format('signing up should provision a profile row, saw %s', n);

  select full_name into nm from ops_core.users where email = 'wulan@talaliving.com';
  assert nm = 'Wulan Sari', format('the provider''s name should survive provisioning, got %s', nm);

  -- Nobody arrives with access. This is the opposite of the old system, where a
  -- new account inherited whatever its role string implied.
  select count(*) into n from ops_core.user_modules;
  assert n = 0, format('a new account should hold nothing, held %s grants', n);
end $$;

-- HRD: may open HR and run payroll, holds no authority.
insert into ops_core.user_modules (user_id, module, level) values
  ('11111111-1111-1111-1111-111111111111','hrd','write'),
  ('11111111-1111-1111-1111-111111111111','payroll','write');

-- The Direktur: approves, but administers nothing.
insert into ops_core.user_modules (user_id, module, level) values
  ('22222222-2222-2222-2222-222222222222','procurement','read');
insert into ops_core.user_authorities (user_id, authority) values
  ('22222222-2222-2222-2222-222222222222','approve_goods'),
  ('22222222-2222-2222-2222-222222222222','approve_funds');

set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

do $$ begin
  assert ops_core.has_permission('hrd.read'),        'HRD should read HR';
  assert ops_core.has_permission('payroll.run'),     'HRD should run payroll';
  assert not ops_core.has_permission('it.manage_users'),
         'write is not admin — manage_users is admin-only';
  assert not ops_core.has_permission('procurement.create'),
         'a module nobody granted opens nothing';
  assert not ops_core.has_authority('approve_funds'),
         'an authority is never implied by a module level (D24)';
end $$;

set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

do $$ begin
  assert ops_core.has_authority('approve_goods'), 'the Direktur approves goods';
  assert not ops_core.has_permission('procurement.update'),
         'read is read: approving is not editing';
  assert not ops_core.has_permission('payroll.read'),
         'approving funds does not open payroll';
end $$;

-- RLS itself, not only the function: the grant tables are readable by their
-- owner and by whoever administers access, and by nobody else.
do $$
declare n int;
begin
  select count(*) into n from ops_core.user_modules;
  assert n = 1, format('the Direktur should see only their own grant, saw %s', n);
end $$;

-- And the numbering seam still mints in order under a real role.
do $$
declare a text; b text;
begin
  a := ops_core.next_doc_number('spk');
  b := ops_core.next_doc_number('spk');
  assert right(a, 2)::int + 1 = right(b, 2)::int, 'document numbers must not collide';
end $$;

rollback;
