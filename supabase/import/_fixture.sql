-- _fixture.sql — a legacy system small enough to test an import against.
--
-- **Never run against `john-lau-v01`.** It creates tables in `public`, which on
-- the real project is the running legacy system. This exists so
-- `01_reference.sql` can be proved on the scratch cluster, where `public` is
-- empty and there is nothing to collide with. `test.sh` refuses any non-local
-- host for exactly that reason.
--
-- The columns are the real ones, read from `john-lau-v01` on 2026-09-18. The
-- rows are not the real data — they are the shapes that make the import hard,
-- one of each:
--
--   a project with no code            the refusal the import must produce
--   a vendor with `aka`               jsonb here, text[] there
--   an inactive vendor and project    `active` must survive, not be reset
--   a vendor with blank contact text  '' must become null, not ''
--   an account code we do not have    the refusal on the ledger's own keys
--
-- A fixture that only holds easy rows proves the easy path, which is the path
-- that was never in doubt.

-- Notices about dropping tables that do not exist are the expected first run.
set client_min_messages = warning;

create schema if not exists public;

drop table if exists public.accounts cascade;
create table public.accounts (
  code text primary key, label text, bank text, currency text, custody text,
  is_paying boolean, sheet_balance_column text, sort_order integer,
  active boolean, note text, created_at timestamptz default now()
);

drop table if exists public.projects cascade;
create table public.projects (
  project_id uuid primary key default gen_random_uuid(),
  name text, active boolean, created_at timestamptz default now(), code text
);

drop table if exists public.vendors cascade;
create table public.vendors (
  vendor_id uuid primary key default gen_random_uuid(),
  name text, aka jsonb, default_transaction_type text, active boolean,
  created_at timestamptz default now(),
  address text, phone text, bank_account text
);

-- Five the ladder seeds, plus one it does not: `BRI 900` is the refusal.
insert into public.accounts (code, label, custody, currency, is_paying, active, sort_order) values
  ('PETTY CASH', 'Petty Cash',   'accounting', 'IDR', true,  true, 1),
  ('BNI 325',    'BNI 325',      'accounting', 'IDR', true,  true, 2),
  ('BCA 271',    'BCA 271',      'accounting', 'IDR', true,  true, 3),
  ('BCA 064',    'BCA 064',      'leadership', 'IDR', false, true, 4),
  ('BRI 900',    'BRI 900 baru', 'accounting', 'IDR', true,  true, 9);

insert into public.projects (project_id, name, active, code, created_at) values
  ('0726a7b1-0805-437e-a652-12a8bb66fa5a', 'BABY ISLAND',       true,  '25007', '2026-01-02'),
  ('1f192138-addd-479b-a03d-8ec276327880', 'CHAIR PHILIPHINES', false, '25006', '2026-01-03'),
  -- No code. The import must refuse this and say why.
  ('794d7b02-89f8-4245-a230-74f1023a36da', 'FAIRMONT',          true,  null,    '2026-01-04');

insert into public.vendors (vendor_id, name, aka, active, created_at, address, phone, bank_account) values
  ('aaaa0000-0000-0000-0000-000000000001', 'UD SUMBER REJEKI',
     '["Sumber Rejeki","UD SR"]'::jsonb, true,  '2026-01-02', 'Jl. Melati 3', '0812111', '1234567'),
  ('aaaa0000-0000-0000-0000-000000000002', 'TOKO BESI JAYA',
     null, false, '2026-01-03', null, '', ''),
  ('aaaa0000-0000-0000-0000-000000000003', '  CV ANUGERAH  ',
     '[]'::jsonb, true, '2026-01-04', null, null, null);

drop table if exists public.items cascade;
create table public.items (
  item_id uuid primary key default gen_random_uuid(),
  name text, category text, unit text, aka jsonb, active boolean,
  created_at timestamptz default now(), details text,
  last_price numeric, last_vendor text, last_purchase date,
  price numeric, kind text
);

-- One of each shape the unit mapping has to handle, and one the category
-- mapping has to: a unit that matches once lower-cased, one that folds onto an
-- existing code, one that needs a code `0031` added, one that names two units
-- at once, and one that is simply absent.
insert into public.items
  (item_id, name, category, unit, aka, kind, created_at, last_vendor, price) values
  ('bbbb0000-0000-0000-0000-000000000001', 'SEKRUP 3 INCI', 'hardware', 'PCS',
     '["skrup 3"]'::jsonb, 'goods', '2026-01-02', 'UD SUMBER REJEKI', 1500),
  ('bbbb0000-0000-0000-0000-000000000002', 'TINER SUPER',   'finishing', 'Liter',
     null, 'goods', '2026-01-03', null, 32000),
  ('bbbb0000-0000-0000-0000-000000000003', 'TUKANG AMPLAS', 'service',  'orang',
     null, 'service', '2026-01-04', null, 150000),
  ('bbbb0000-0000-0000-0000-000000000004', 'CAT DASAR',     'non-item', 'pail/drum',
     null, 'goods', '2026-01-05', 'VENDOR YANG TIDAK ADA', 890000),
  ('bbbb0000-0000-0000-0000-000000000005', 'PAKU BETON',    'hardware', null,
     null, 'goods', '2026-01-06', null, 25000);

-- ── the ledger, for 03 ───────────────────────────────────────────────────
--
-- Twelve transactions, and every one of them is a shape that made `03_ledger`
-- hard to write:
--
--   an author the old system recorded         must be recovered, not flattened
--   no event at all                           falls back to shared@
--   an event from somebody not a chat user    falls back too
--   amount 0                                  refused — `amount_idr > 0`
--   no direction                              refused — not a ledger entry
--   an account we do not have                 refused, and visible in the
--                                             reconciliation as an account with
--                                             movement and no counterpart
--   a type with no code anywhere              refused
--   no type at all                            filed OTHERS, and noted
--   no status                                 posted
--   a vendor name that resolves               → vendor_id
--   a vendor name that does not               → null, text kept, never created
--   a project name spelled differently        → null. `CHAIR PHILIPPINES` here
--                                             against `CHAIR PHILIPHINES` in
--                                             the project table is not invented
--                                             for the test: it is what the two
--                                             live systems actually say.
--
-- The two people are inserted into `auth.users`, which is what
-- `provision_user` needs to give them a profile — the same constraint
-- `README.md` describes for importing the nine chat users.

insert into auth.users (id, email, raw_user_meta_data) values
  ('5ade0000-0000-0000-0000-00000000da7a', 'shared@talaliving.com', '{"full_name":"Shared"}'),
  ('5ade0000-0000-0000-0000-00000000e100', 'evin@talaliving.com',   '{"full_name":"Evin"}')
on conflict (id) do nothing;

drop table if exists public.chat_users cascade;
create table public.chat_users (
  user_id text primary key, display_name text, role text,
  active boolean, created_at timestamptz default now(), email text
);

insert into public.chat_users (user_id, display_name, role, active, email) values
  ('users/1001', 'Evin',  'admin', true, 'evin@talaliving.com'),
  -- Known to chat, unknown to this system. Its transaction falls back.
  ('users/9999', 'Winda', 'staff', true, 'winda@talaliving.com');

drop table if exists public.raw_events cascade;
create table public.raw_events (
  event_id uuid primary key, source text, source_ref text, space_id text,
  sender text, message_text text, payload jsonb, received_at timestamptz default now()
);

insert into public.raw_events (event_id, source, sender) values
  ('eee00000-0000-0000-0000-000000000001', 'chat', 'users/1001'),
  ('eee00000-0000-0000-0000-000000000002', 'chat', 'users/9999');

drop table if exists public.transactions cascade;
create table public.transactions (
  trx_id text primary key, line_id text not null, push_id uuid not null,
  event_id uuid, trx_date date, project text, description text, remark text,
  vendor text, type_of_transaction text, account text, in_out text,
  idr_amount numeric, drive_link text, status text, sheet_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  currency text not null default 'IDR', original_amount numeric, fx_rate numeric,
  edited_at timestamptz, edited_by text, edit_reason text, edit_count integer not null default 0
);

insert into public.transactions
  (trx_id, line_id, push_id, event_id, trx_date, project, description, vendor,
   type_of_transaction, account, in_out, idr_amount, status, created_at) values
  -- author recovered from the chat event
  ('trx-26-01-02_001','l1',gen_random_uuid(),'eee00000-0000-0000-0000-000000000001',
   '2026-01-02','BABY ISLAND','BELI SEKRUP','UD SUMBER REJEKI',
   'SUPPLIERS','PETTY CASH','OUT',100000,'COMPLETED','2026-01-02 09:00+07'),
  -- no event at all → shared@
  ('trx-26-01-03_002','l2',gen_random_uuid(),null,
   '2026-01-03',null,'SETOR MODAL',null,
   'CASHFLOW','BNI 325','IN',5000000,'COMPLETED','2026-01-03 09:00+07'),
  -- a type 0042 added, and a vendor name that resolves to nothing
  ('trx-26-01-04_003','l3',gen_random_uuid(),null,
   '2026-01-04',null,'BENSIN GRAND MAX','VENDOR YANG TIDAK ADA',
   'TRANSPORT','BCA 271','OUT',250000,'UNTRACKED','2026-01-04 09:00+07'),
  -- the project spelling the two systems disagree about
  ('trx-26-01-05_004','l4',gen_random_uuid(),null,
   '2026-01-05','CHAIR PHILIPPINES','SERVIS SEPEDA EJO',null,
   'EJO','BCA 064','OUT',750000,'COMPLETED','2026-01-05 09:00+07'),
  -- refused: nothing
  ('trx-26-01-06_005','l5',gen_random_uuid(),null,
   '2026-01-06',null,'void',null,
   'SUPPLIERS','PETTY CASH','OUT',0,'UNTRACKED','2026-01-06 09:00+07'),
  -- refused: which way?
  ('trx-26-01-07_006','l6',gen_random_uuid(),null,
   '2026-01-07',null,'ENTRI TANPA ARAH',null,
   'SUPPLIERS','PETTY CASH',null,50000,'UNTRACKED','2026-01-07 09:00+07'),
  -- refused: an account this system does not have
  ('trx-26-01-08_007','l7',gen_random_uuid(),null,
   '2026-01-08',null,'TARIK TUNAI BRI',null,
   'CASHFLOW','BRI 900','OUT',123000,'COMPLETED','2026-01-08 09:00+07'),
  -- refused: a type with no code anywhere
  ('trx-26-01-09_008','l8',gen_random_uuid(),null,
   '2026-01-09',null,'KATERING RAPAT',null,
   'KATERING','BNI 325','OUT',42000,'COMPLETED','2026-01-09 09:00+07'),
  -- no type → OTHERS, and noted
  ('trx-26-01-10_009','l9',gen_random_uuid(),null,
   '2026-01-10',null,'ADMIN FEE AIR MINUM GALON',null,
   null,'PETTY CASH','OUT',17500,'UNTRACKED','2026-01-10 09:00+07'),
  -- no status → posted
  ('trx-26-01-11_010','l10',gen_random_uuid(),null,
   '2026-01-11',null,'TF MASUK',null,
   'CASHFLOW','BCA 271','IN',1000000,null,'2026-01-11 09:00+07'),
  -- an event from somebody chat knows and this system does not → shared@
  ('trx-26-01-12_011','l11',gen_random_uuid(),'eee00000-0000-0000-0000-000000000002',
   '2026-01-12',null,'BELI LEM',null,
   'SUPPLIERS','BNI 325','OUT',60000,'COMPLETED','2026-01-12 09:00+07'),
  -- another type 0042 added
  ('trx-26-01-13_012','l12',gen_random_uuid(),null,
   '2026-01-13',null,'UANG MAKAN LEMBUR',null,
   'RECCURING - OVERTIME','PETTY CASH','OUT',25000,'COMPLETED','2026-01-13 09:00+07');
