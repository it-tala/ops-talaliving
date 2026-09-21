-- procure curation — the two views the catalogue and supplier screens read.
--
-- `VendorView` and `ItemView` are the contract those screens are written
-- against, and until 0032 the client met it with `as ItemView[]` — a cast,
-- which instructs the compiler to stop checking rather than checking anything.
-- Five columns of one and one column of the other did not exist. A type
-- assertion cannot be tested; a view can, so this asserts the columns are real
-- and carry the right numbers.
--
-- The derivation that matters most is the merge. A duplicate spelling is
-- absorbed by a pointer, never a delete (D33), and the surviving vendor keeps
-- the absorbed row's history (D41). `total_spend` and `absorbed` are new, so
-- there was nothing to get wrong before; what this pins down is that they are
-- right **through** a merge, which is the case nobody writes a test for and
-- which fails in the direction that makes a supplier look cheaper than it is.
--
-- And the refusal: both views run `security_invoker`, so somebody holding a
-- grant in another module sees nothing through them.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('dddddddd-0000-0000-0000-0000000000c1','curator@talaliving.com', '{"full_name":"Curator"}'),
  ('dddddddd-0000-0000-0000-0000000000c2','outsider@talaliving.com','{"full_name":"Outsider"}');

insert into ops_core.user_modules (user_id, module, level) values
  ('dddddddd-0000-0000-0000-0000000000c1','procurement','admin'),
  ('dddddddd-0000-0000-0000-0000000000c1','accounting','admin'),
  -- Holds a grant, but not this one.
  ('dddddddd-0000-0000-0000-0000000000c2','hrd','admin');

-- ── two spellings of one supplier ─────────────────────────────────────────

insert into ops_procure.vendors (id, code, name, supplied_categories) values
  ('dd000000-0000-0000-0000-000000000001','VND-C001','Mahoni Jaya', array['raw-wood','finishing']),
  ('dd000000-0000-0000-0000-000000000002','VND-C002','MAHONI JAYA', '{}');

insert into ops_procure.items (id, code, name, category_code, base_uom) values
  ('dd000000-0000-0000-0000-0000000000a1','ITM-C001','Kayu mahoni 4x6','raw-wood','batang'),
  -- No category row will ever match this: the import lands a code the
  -- catalogue does not carry, and the item must still be visible to be fixed.
  ('dd000000-0000-0000-0000-0000000000a2','ITM-C002','Barang tanpa kategori','uncurated',null);

-- Money spent under BOTH spellings, so the merge below has something to lose.
insert into ops_acct.transactions
  (trx_no, trx_date, account_id, direction, amount_idr, type_code, vendor_id,
   description, source_ref, posted_by)
select * from (values
  ('TRX-C001','2026-08-01'::date, (select id from ops_acct.accounts where code='PETTY CASH'),
   'OUT'::ops_acct.direction_t, 1000000::numeric, 'SUPPLIERS',
   'dd000000-0000-0000-0000-000000000001'::uuid, 'kayu', 'smoke-1',
   'dddddddd-0000-0000-0000-0000000000c1'::uuid),
  ('TRX-C002','2026-08-05'::date, (select id from ops_acct.accounts where code='PETTY CASH'),
   'OUT'::ops_acct.direction_t, 400000::numeric, 'SUPPLIERS',
   'dd000000-0000-0000-0000-000000000002'::uuid, 'kayu lagi', 'smoke-2',
   'dddddddd-0000-0000-0000-0000000000c1'::uuid),
  -- Money coming BACK is not spending on them.
  ('TRX-C003','2026-08-06'::date, (select id from ops_acct.accounts where code='PETTY CASH'),
   'IN'::ops_acct.direction_t, 150000::numeric, 'SUPPLIERS',
   'dd000000-0000-0000-0000-000000000001'::uuid, 'retur', 'smoke-3',
   'dddddddd-0000-0000-0000-0000000000c1'::uuid),
  -- Voided, and therefore not money at all.
  ('TRX-C004','2026-09-01'::date, (select id from ops_acct.accounts where code='PETTY CASH'),
   'OUT'::ops_acct.direction_t, 9000000::numeric, 'SUPPLIERS',
   'dd000000-0000-0000-0000-000000000001'::uuid, 'salah input', 'smoke-4',
   'dddddddd-0000-0000-0000-0000000000c1'::uuid)
) v;

update ops_acct.transactions
   set status = 'VOID', void_reason = 'salah input', void_at = now(),
       void_by = 'dddddddd-0000-0000-0000-0000000000c1'
 where trx_no = 'TRX-C004';

insert into ops_acct.transaction_lines (trx_id, line_no, description, qty, uom, unit_price, amount, item_id)
select t.id, 1, 'Kayu mahoni 4x6', 10, 'batang', 100000, 1000000,
       'dd000000-0000-0000-0000-0000000000a1'
  from ops_acct.transactions t where t.trx_no = 'TRX-C001';
insert into ops_acct.transaction_lines (trx_id, line_no, description, qty, uom, unit_price, amount, item_id)
select t.id, 1, 'Kayu mahoni 4x6', 4, 'batang', 100000, 400000,
       'dd000000-0000-0000-0000-0000000000a1'
  from ops_acct.transactions t where t.trx_no = 'TRX-C002';

set local role authenticated;
set local request.jwt.claim.sub = 'dddddddd-0000-0000-0000-0000000000c1';

-- ── the contract is present, not cast into existence ──────────────────────

do $$
declare r record;
begin
  select * into r from ops_procure.v_vendor_view where code = 'VND-C001';

  assert r.supplied_category_names = array['Timber & panels','Finishing'],
    format('names resolved in order, got %s', r.supplied_category_names);

  -- Two posted rows point here — the payment and the return. The third is
  -- VOID and is not a transaction any more; the fourth belongs to the second
  -- spelling, which is still its own vendor until the merge below.
  assert r.transaction_count = 2, format('expected 2 transactions, got %s', r.transaction_count);
  -- 1.000.000 out, and the 150.000 that came back is not spending.
  assert r.total_spend = 1000000, format('expected 1.000.000 spend, got %s', r.total_spend);
  assert r.last_purchase = '2026-08-06'::date,
    format('newest posted transaction, got %s', r.last_purchase);

  assert jsonb_array_length(r.absorbed) = 0, 'nothing absorbed yet';
  assert jsonb_array_length(r.bought_categories) = 1, 'one category bought so far';
  assert r.bought_categories -> 0 ->> 'name' = 'Timber & panels',
    format('category name, not code, got %s', r.bought_categories -> 0 ->> 'name');
  assert jsonb_array_length(r.items_bought) = 1, 'one item bought';
  assert (r.items_bought -> 0 ->> 'times')::int = 1,
    format('one purchase under this spelling, got %s', r.items_bought -> 0 ->> 'times');
end $$;

-- ── an item with no unit is still an item ─────────────────────────────────
--
-- `0031` made `base_uom` nullable because 587 of the 1.020 legacy items were
-- recorded without one, and the catalogue page is where somebody fills them in.
-- A view that dropped them would hide exactly the rows it exists to surface.
do $$
declare n int; r record;
begin
  select count(*) into n from ops_procure.v_item_view
   where code in ('ITM-C001','ITM-C002');
  assert n = 2, format('both items visible, got %s', n);

  select * into r from ops_procure.v_item_view where code = 'ITM-C002';
  assert r.base_uom is null, 'this one genuinely has no unit';
  assert r.category_name = 'Not yet curated',
    format('category resolved to its name, got %s', r.category_name);
  assert jsonb_array_length(r.sourced_from) = 0,
    'never bought, so no sources — and an empty array, not null';
end $$;

do $$
declare r record;
begin
  select * into r from ops_procure.v_item_view where code = 'ITM-C001';
  assert jsonb_array_length(r.sourced_from) = 2,
    format('bought under two spellings, so two sources, got %s', jsonb_array_length(r.sourced_from));
  assert r.purchase_count = 2, format('two purchase lines, got %s', r.purchase_count);
  assert (r.sourced_from -> 0 ->> 'last_price')::numeric = 100000,
    'the price actually paid, newest first';
end $$;

-- ── the merge, which is the whole reason the fold exists ──────────────────

reset role;
update ops_procure.vendors
   set merged_into = 'dd000000-0000-0000-0000-000000000001'
 where code = 'VND-C002';
set local role authenticated;

do $$
declare r record;
begin
  select * into r from ops_procure.v_vendor_view where code = 'VND-C001';

  -- The absorbed row's spend is now this vendor's spend. The old view lost it.
  assert r.total_spend = 1400000,
    format('the absorbed spelling brings its 400.000 (D41), got %s', r.total_spend);
  assert r.transaction_count = 3,
    format('two of its own plus one absorbed, got %s', r.transaction_count);

  assert jsonb_array_length(r.absorbed) = 1, 'the merged row is kept and named';
  assert r.absorbed -> 0 ->> 'name' = 'MAHONI JAYA',
    format('absorbed row carried whole, got %s', r.absorbed -> 0 ->> 'name');

  -- `v_purchase_facts` folds too, so both purchases now report here.
  assert (r.items_bought -> 0 ->> 'times')::int = 2,
    format('both purchases under the surviving name, got %s', r.items_bought -> 0 ->> 'times');
end $$;

-- The absorbed row is still readable and still points at its winner: a merge
-- moves nothing, so every reference to it stays valid (D33).
do $$
declare r record;
begin
  select * into r from ops_procure.v_vendor_view where code = 'VND-C002';
  assert r.merged_into = 'dd000000-0000-0000-0000-000000000001',
    'the loser keeps its own row and points home';
end $$;

-- An item is sourced from the surviving vendor only, once the spellings are one.
do $$
declare r record;
begin
  select * into r from ops_procure.v_item_view where code = 'ITM-C001';
  assert jsonb_array_length(r.sourced_from) = 1,
    format('one supplier after the merge, got %s', jsonb_array_length(r.sourced_from));
  assert (r.sourced_from -> 0 ->> 'times')::int = 2, 'with both purchases behind it';
end $$;

-- ── the refusal ───────────────────────────────────────────────────────────

-- `set local role` as well as the claim: `postgres` carries `bypassrls`, so a
-- refusal asserted as the owner is a refusal that never had to happen. This is
-- the one assertion in this file that would pass for the wrong reason without
-- it, which is exactly the kind that matters.
set local role authenticated;
set local request.jwt.claim.sub = 'dddddddd-0000-0000-0000-0000000000c2';
do $$
declare n int;
begin
  select count(*) into n from ops_procure.v_vendor_view;
  assert n = 0, format('hrd.admin is not procurement.read (D24), saw %s vendors', n);
  select count(*) into n from ops_procure.v_item_view;
  assert n = 0, format('and no items either, saw %s', n);
end $$;
reset role;

rollback;
