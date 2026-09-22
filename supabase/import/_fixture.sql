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

-- ── what was bought, for 04 ──────────────────────────────────────────────
--
-- Five purchase lines, and each one is a shape `04_lines.sql` has to get right:
--
--   a line on an imported transaction     the ordinary case
--   two lines on one transaction          `line_no` 1 and 2, in order
--   a unit that folds                     `liter` → `ltr`, through `_units.sql`
--   a unit nobody here can read           `slop` → no unit, text kept
--   no quantity and no price              a service line; both are nullable
--   `item_raw` blank                      falls back to the item's own name
--   a line on a REFUSED transaction       refused, naming the transaction
--   lines that do not sum to the amount   imported as they are, and reported
--
-- The last one matters most. Six of the 1.188 real transactions with lines do
-- not add up, and the temptation is to make them. A line adjusted so an
-- arithmetic check passes is a fact replaced by a preference.

drop table if exists public.item_purchases cascade;
create table public.item_purchases (
  purchase_id uuid primary key default gen_random_uuid(),
  push_id uuid, trx_id text, item_id uuid, item_raw text, vendor text,
  qty numeric, unit text, price numeric, idr_amount numeric,
  trx_date date, created_at timestamptz default now()
);

insert into public.item_purchases
  (purchase_id, trx_id, item_id, item_raw, vendor, qty, unit, price, idr_amount, trx_date, created_at) values
  -- the ordinary case, and `item_raw` is what was typed rather than what the
  -- catalogue ended up calling it
  ('ccc00000-0000-0000-0000-000000000001','trx-26-01-02_001',
   'bbbb0000-0000-0000-0000-000000000001','SEKRUP 3" GALVANIS','UD SUMBER REJEKI',
   100,'PCS',1000,100000,'2026-01-02','2026-01-02 09:01+07'),

  -- two lines on one transaction, summing to it exactly. The first folds its
  -- unit; the second has none this system knows, no quantity and no price, and
  -- a blank `item_raw` that must fall back to the item's name.
  ('ccc00000-0000-0000-0000-000000000002','trx-26-01-04_003',
   'bbbb0000-0000-0000-0000-000000000002','TINER',null,
   5,'liter',32000,160000,'2026-01-04','2026-01-04 09:01+07'),
  ('ccc00000-0000-0000-0000-000000000003','trx-26-01-04_003',
   'bbbb0000-0000-0000-0000-000000000004','','VENDOR YANG TIDAK ADA',
   null,'slop',null,90000,'2026-01-04','2026-01-04 09:02+07'),

  -- a line whose total is not its transaction's. Imported as it stands and
  -- reported, because which of the two is wrong is a question for somebody with
  -- the documents.
  ('ccc00000-0000-0000-0000-000000000004','trx-26-01-13_012',
   'bbbb0000-0000-0000-0000-000000000003','TUKANG AMPLAS 1 HARI',null,
   1,'hari',30000,30000,'2026-01-13','2026-01-13 09:01+07'),

  -- and a line on a transaction `03_ledger.sql` refused. A line on something
  -- that does not exist is not a line.
  ('ccc00000-0000-0000-0000-000000000005','trx-26-01-06_005',
   'bbbb0000-0000-0000-0000-000000000005','PAKU BETON',null,
   10,'kg',2500,25000,'2026-01-06','2026-01-06 09:01+07');

-- ── the documents behind the money, for 05 ───────────────────────────────
--
-- Four `transaction_docs` rows over **three** files, because that difference is
-- the whole design: one transfer proof covering two purchases is how this
-- business pays, and an import that made two copies of it would erase the fact.
--
--   two doc rows, one file        one attachment, two links
--   a typed document              `Payment Proof` resolves verbatim
--   no type at all                filed `Others`, and noted
--   a doc on a REFUSED transaction  refused, naming the transaction
--   a blob nothing points at      ignored — not every file is evidence
--   a file already filed          resolved, not duplicated

drop table if exists public.blobs cascade;
create table public.blobs (
  blob_id uuid primary key default gen_random_uuid(),
  event_id uuid, sha256 text, drive_file_id text, drive_link text,
  mime_type text, size_bytes bigint, created_at timestamptz default now(),
  duplicate_suspect boolean default false
);

insert into public.blobs
  (blob_id, event_id, sha256, drive_file_id, drive_link, mime_type, size_bytes, created_at) values
  -- the shared one: two transactions cite it
  ('b10b0000-0000-0000-0000-000000000001','eee00000-0000-0000-0000-000000000001',
   'a1b2c3','1SharedProofAAA','https://drive.google.com/file/d/1SharedProofAAA/view',
   'image/jpeg', 184320, '2026-01-02 09:05+07'),
  ('b10b0000-0000-0000-0000-000000000002',null,
   'd4e5f6','1NotaBBB','https://drive.google.com/file/d/1NotaBBB/view',
   'application/pdf', 91022, '2026-01-04 09:05+07'),
  ('b10b0000-0000-0000-0000-000000000003',null,
   null,'1UntypedCCC','https://drive.google.com/file/d/1UntypedCCC/view',
   'image/webp', 44100, '2026-01-06 09:05+07'),
  -- pointed at only by a document on a refused transaction, so it must not
  -- become an attachment either.
  ('b10b0000-0000-0000-0000-000000000004',null,
   'z9y8x7','1OrphanDDD','https://drive.google.com/file/d/1OrphanDDD/view',
   'image/png', 12345, '2026-01-07 09:05+07');

drop table if exists public.transaction_docs cascade;
create table public.transaction_docs (
  doc_id uuid primary key default gen_random_uuid(),
  trx_id text not null, line_id text, push_id uuid, event_id uuid,
  drive_link text, caption text, sheet_ref text,
  created_at timestamptz default now(), doc_type text
);

insert into public.transaction_docs
  (doc_id, trx_id, event_id, drive_link, caption, doc_type, created_at) values
  -- one file, two transactions
  ('d0c00000-0000-0000-0000-000000000001','trx-26-01-02_001','eee00000-0000-0000-0000-000000000001',
   'https://drive.google.com/file/d/1SharedProofAAA/view','Payment of SEKRUP + TINER',
   'Payment Proof','2026-01-02 09:06+07'),
  ('d0c00000-0000-0000-0000-000000000002','trx-26-01-04_003','eee00000-0000-0000-0000-000000000001',
   'https://drive.google.com/file/d/1SharedProofAAA/view','Payment of SEKRUP + TINER',
   'Payment Proof','2026-01-04 09:06+07'),
  -- a typed one of its own
  ('d0c00000-0000-0000-0000-000000000003','trx-26-01-04_003',null,
   'https://drive.google.com/file/d/1NotaBBB/view','Nota TINER',
   'Receipt / Invoice / Nota','2026-01-04 09:07+07'),
  -- no type at all: filed `Others`, and noted
  ('d0c00000-0000-0000-0000-000000000004','trx-26-01-10_009',null,
   'https://drive.google.com/file/d/1UntypedCCC/view',null,
   null,'2026-01-10 09:06+07'),
  -- on a transaction `03_ledger.sql` refused. The document is refused — and so
  -- is its file, because a file whose only mention is on a transaction that
  -- does not exist would arrive as an attachment nothing points at.
  ('d0c00000-0000-0000-0000-000000000005','trx-26-01-06_005',null,
   'https://drive.google.com/file/d/1OrphanDDD/view','bukti yang tidak jadi',
   'Payment Proof','2026-01-06 09:06+07'),
  -- the same claim as d3, made twice: same file, same transaction, same kind.
  -- Eleven of the 237 real rows do this. One claim, and the map says why.
  ('d0c00000-0000-0000-0000-000000000006','trx-26-01-04_003',null,
   'https://drive.google.com/file/d/1NotaBBB/view','Nota TINER (lagi)',
   'Receipt / Invoice / Nota','2026-01-04 09:08+07');
