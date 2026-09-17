-- 0013_acct_ledger.sql — accounts, the ledger, and what each payment was for.
--
-- Pulled ahead of procurement's views on purpose. `v_pr_line_status` cannot
-- compute whether a line is PAID without the allocations against it and the VOID
-- status of the transaction behind each one — "a stamp pointing at nothing is
-- not paid" (A10). Written in layer order, procurement's central view would have
-- been unrunnable, and therefore unreviewed, until nine migrations later. The
-- reasoning is in `01-schema.md` under *Per schema, not per layer*.
--
-- This is `acct`'s spine, not the whole of it: the review inbox and the cash
-- calendar are their own migrations, later, and they are nobody's dependency.

create table ops_acct.accounts (
  id              uuid primary key default gen_random_uuid(),
  -- The code IS the name here — "BCA 271" is what everybody in the building
  -- calls it, and inventing an `ACC-003` beside it would create a second
  -- vocabulary for the same five things.
  code            text not null unique,
  name            text not null,
  custody         ops_acct.account_custody_t not null,
  -- Accounting holds three and they pay vendors; leadership holds two and they
  -- never pay a vendor directly — money only enters those via a statement.
  is_paying       boolean not null default false,
  currency        text not null default 'IDR',
  opening_balance numeric not null default 0,
  opened_on       date not null,
  is_active       boolean not null default true
);

-- The five real accounts, spelled exactly as production spells them, plus the
-- USD one. `BCA 064` is leadership's: **locked, not hidden** (D87). Hiding an
-- account from the people who can see every transfer into it is a fiction they
-- can see through; locking it says the true thing, which is that this money is
-- not theirs to pay from.
insert into ops_acct.accounts (code, name, custody, is_paying, currency, opening_balance, opened_on) values
  ('PETTY CASH',  'Kas kecil kantor',      'accounting', true,  'IDR', 0, '2026-01-01'),
  ('BNI 325',     'BNI ...325',            'accounting', true,  'IDR', 0, '2026-01-01'),
  ('BCA 271',     'BCA ...271 (pembayaran)','accounting', true, 'IDR', 0, '2026-01-01'),
  ('JAGO',        'Bank Jago',             'accounting', true,  'IDR', 0, '2026-01-01'),
  ('BCA 064',     'BCA ...064 (pimpinan)', 'leadership', false, 'IDR', 0, '2026-01-01'),
  ('BCA USD 081', 'BCA USD ...081',        'leadership', false, 'USD', 0, '2026-01-01');

-- Thirteen types, carried verbatim and unclassified (Q10). `RECCURING` keeps its
-- doubled C: it is the value in the data, and correcting the spelling here would
-- simply fail to match. `EJO` and `PACKING` are folded into nothing.
create table ops_acct.transaction_types (
  code                text primary key,
  -- Vetoes auto-complete: goods that were bought can still be delivered.
  is_purchase         boolean not null default true,
  -- Ships inert (D26). Fuel and utilities are marked complete by hand for now;
  -- turning the rule on later is a data change, not a code change.
  auto_complete       boolean not null default false,
  creates_catalog_item boolean not null default false
);

-- `is_purchase` false only where money leaves for a reason nobody raises a
-- request for (D83). An **unknown** type defaults to true, deliberately: if an
-- unclassified type were "not expected to name a decision", the way to make
-- spending escape the check would be to type a category that does not exist yet.
insert into ops_acct.transaction_types (code, is_purchase, auto_complete, creates_catalog_item) values
  ('RECCURING - UTILITIES', false, false, false),
  ('CREDIT CARD',           true,  false, false),
  ('PREPAID VENDOR',        true,  false, false),
  ('SUPPLIERS',             true,  false, true),
  ('BANK CHARGES',          false, false, false),
  ('ONLINE',                true,  false, true),
  ('CHINA',                 true,  false, true),
  ('RECCURING - PAYROLL',   false, false, false),
  ('CASHFLOW',              false, false, false),
  ('OTHERS',                true,  false, false),
  ('PRODUCTION',            true,  false, true),
  ('OFFICE',                true,  false, false),
  ('WAREHOUSE',             true,  false, false);

create table ops_acct.transactions (
  id          uuid primary key default gen_random_uuid(),
  trx_no      text not null unique,          -- `trx-26-09-11_014`
  trx_date    date not null,
  account_id  uuid not null references ops_acct.accounts(id),
  direction   ops_acct.direction_t not null,
  -- **Always positive.** Direction lives in its own column, because a signed
  -- amount means every sum in the system has to remember which convention it is
  -- reading, and one of them eventually will not.
  amount_idr  numeric not null check (amount_idr > 0),
  type_code   text not null references ops_acct.transaction_types(code),
  vendor_id   uuid references ops_procure.vendors(id),
  project_id  uuid references ops_procure.projects(id),
  description text not null,
  remark      text,
  status      ops_acct.trx_status_t not null default 'POSTED',
  -- The idempotency claim. A repeat with the same ref is a no-op, not a second
  -- transaction (A4) — the specific failure being prevented is a double tap on a
  -- slow phone becoming two payments.
  source_ref  text not null unique,
  posted_by   uuid not null references ops_core.users(id),
  posted_at   timestamptz not null default now(),
  -- VOID keeps the row and the amount, with a reason beside it (A5, D84). The
  -- correction is a new row; this one stays, saying what was once believed.
  void_reason text,
  void_by     uuid references ops_core.users(id),
  void_at     timestamptz,
  constraint void_is_explained check (
    (status = 'VOID') = (void_reason is not null and void_at is not null))
);

create index trx_account_idx on ops_acct.transactions (account_id, trx_date desc);
create index trx_vendor_idx  on ops_acct.transactions (vendor_id) where vendor_id is not null;
-- Every balance and every coverage sum reads live rows only, so the index that
-- matters is the one that excludes the voided ones.
create index trx_live_idx    on ops_acct.transactions (trx_date desc) where status <> 'VOID';

-- What the money was spent on, itemised. Present only where somebody itemised
-- it: a purchase row carries qty, unit price and vendor so the catalogue learns
-- a real last-paid price (D86), and a payroll transfer carries none of that.
create table ops_acct.transaction_lines (
  id          uuid primary key default gen_random_uuid(),
  trx_id      uuid not null references ops_acct.transactions(id) on delete restrict,
  line_no     int not null check (line_no > 0),
  item_id     uuid references ops_procure.items(id),
  description text not null,
  qty         numeric check (qty is null or qty > 0),
  uom         text references ops_procure.uom(code),
  unit_price  numeric check (unit_price is null or unit_price >= 0),
  amount      numeric not null check (amount >= 0),
  unique (trx_id, line_no)
);

-- **Money actually applied to something.**
--
-- Many rows per line (a line may be settled by several transfers) and many lines
-- per transfer (one round pays a batch). Coverage is the sum where
-- `superseded_by` is null — corrections supersede, never delete (A2).
--
-- Both targets are **public codes, not foreign keys** (ADR-004). `acct` owns this
-- table and must not join into `procure`'s; the code is validated at the seam,
-- which is where a reference to something that does not exist is a refusal
-- somebody can read rather than a constraint violation.
create table ops_acct.payment_allocations (
  id            uuid primary key default gen_random_uuid(),
  trx_id        uuid not null references ops_acct.transactions(id) on delete restrict,
  pr_line_no    text,          -- `pr-26-09-11_03-L02`
  po_no         text,          -- `po-26-09-11_01`
  amount        numeric not null check (amount > 0),
  method        ops_acct.alloc_method_t not null default 'transfer',
  superseded_by uuid references ops_acct.payment_allocations(id),
  allocated_by  uuid not null references ops_core.users(id),
  allocated_at  timestamptz not null default now(),
  -- A payment may settle an order rather than a request line (D106, D107) — the
  -- deposit on a PO answers to no PR — but an allocation pointing at neither is
  -- money applied to nothing, which is the state this table exists to make
  -- impossible.
  constraint allocation_has_target check (
    pr_line_no is not null or po_no is not null),
  constraint supersede_not_self check (superseded_by is null or superseded_by <> id)
);

create index alloc_trx_idx  on ops_acct.payment_allocations (trx_id) where superseded_by is null;
create index alloc_line_idx on ops_acct.payment_allocations (pr_line_no) where superseded_by is null;
create index alloc_po_idx   on ops_acct.payment_allocations (po_no)     where superseded_by is null;

alter table ops_acct.accounts             enable row level security;
alter table ops_acct.transaction_types    enable row level security;
alter table ops_acct.transactions         enable row level security;
alter table ops_acct.transaction_lines    enable row level security;
alter table ops_acct.payment_allocations  enable row level security;

-- The account list is readable by everybody: "which account did this come from"
-- is on every ledger row and on every transfer proof. What it does **not**
-- include is a balance — `v_account_balance` is where the leadership account's
-- figure is gated on `approve_funds` (D87), and it lives with the rest of the
-- accounting views.
create policy accounts_read on ops_acct.accounts
  for select to authenticated using (true);
create policy trx_types_read on ops_acct.transaction_types
  for select to authenticated using (true);

create policy trx_read on ops_acct.transactions
  for select to authenticated using (ops_core.has_permission('accounting.read'));
create policy trx_lines_read on ops_acct.transaction_lines
  for select to authenticated using (ops_core.has_permission('accounting.read'));

-- Allocations are readable with **procurement** read as well as accounting,
-- and that is deliberate: whether a request line has been paid is procurement's
-- most-asked question, and routing it through an accounting permission would
-- mean the board could not colour its own rows.
create policy alloc_read on ops_acct.payment_allocations
  for select to authenticated
  using (ops_core.has_permission('accounting.read') or ops_core.has_permission('procurement.read'));

-- **`post_ledger` or 403.** Not `accounting.create`: posting to the ledger is a
-- named decision, and the person who files documents all day is not necessarily
-- the person who may assert that money moved (D84, D24).
create policy trx_post on ops_acct.transactions
  for insert to authenticated with check (ops_core.has_authority('post_ledger'));
create policy trx_amend on ops_acct.transactions
  for update to authenticated
  using (ops_core.has_authority('post_ledger'))
  with check (ops_core.has_authority('post_ledger'));
create policy trx_lines_post on ops_acct.transaction_lines
  for insert to authenticated with check (ops_core.has_authority('post_ledger'));

create policy alloc_write on ops_acct.payment_allocations
  for insert to authenticated with check (ops_core.has_authority('post_ledger'));
create policy alloc_supersede on ops_acct.payment_allocations
  for update to authenticated
  using (ops_core.has_authority('post_ledger'))
  with check (ops_core.has_authority('post_ledger'));

grant usage on schema ops_acct to authenticated;
grant select on ops_acct.accounts, ops_acct.transaction_types, ops_acct.transactions,
                ops_acct.transaction_lines, ops_acct.payment_allocations to authenticated;
grant insert on ops_acct.transactions, ops_acct.transaction_lines, ops_acct.payment_allocations
  to authenticated;
-- `amount_idr`, `direction` and `trx_no` are absent from the update grant: an
-- amount that can be edited is an amount nobody can rely on, and the correction
-- road is VOID plus a new row (D84).
grant update (status, remark, description, void_reason, void_by, void_at,
              vendor_id, project_id)
  on ops_acct.transactions to authenticated;
grant update (superseded_by) on ops_acct.payment_allocations to authenticated;
