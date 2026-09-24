-- People and reference data for the procurement walk (scripts/e2e/walk-procurement.mjs).
-- Applied on top of a fresh ladder; the walk creates everything else through
-- the screens. Same three people as the SQL walk, with the grants their roles carry.
insert into auth.users (id, email, raw_user_meta_data) values
  ('e2e00000-0000-0000-0000-00000000a11d','andi@talaliving.com','{"full_name":"Andi Prasetyo"}'),
  ('e2e00000-0000-0000-0000-00000000ce00','evin@talaliving.com','{"full_name":"Evin Jonathan"}'),
  ('e2e00000-0000-0000-0000-00000000f11a','rina@talaliving.com','{"full_name":"Rina Kartika"}')
on conflict do nothing;
insert into ops_core.user_modules (user_id, module, level) values
  ('e2e00000-0000-0000-0000-00000000a11d','procurement','write'),
  ('e2e00000-0000-0000-0000-00000000ce00','procurement','write'),
  ('e2e00000-0000-0000-0000-00000000f11a','procurement','write'),
  ('e2e00000-0000-0000-0000-00000000f11a','accounting','write')
on conflict do nothing;
insert into ops_core.user_authorities (user_id, authority) values
  ('e2e00000-0000-0000-0000-00000000ce00','approve_goods'),
  ('e2e00000-0000-0000-0000-00000000f11a','approve_funds'),
  ('e2e00000-0000-0000-0000-00000000f11a','post_ledger'),
  ('e2e00000-0000-0000-0000-00000000f11a','resolve_inbox')
on conflict do nothing;
insert into ops_procure.projects (code, name) values ('25777','HOTEL SIMULASI') on conflict do nothing;
insert into ops_procure.vendors (code, name, is_curated) values ('V-E2E1','CV SIMULASI KAYU', true) on conflict do nothing;
