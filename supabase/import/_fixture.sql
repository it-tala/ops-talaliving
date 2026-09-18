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
