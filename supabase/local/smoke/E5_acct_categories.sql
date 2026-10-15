-- acct — categories on the ledger (0274, L9, D433/D435).
--
--   every type carries a category; a row can carry its own (override)
--   v_transaction.category = coalesce(override, type's)
--   v_category_part: a fee line counts to bank, a tax line to tax, the rest
--     to the row's category; Σ parts = the row's amount; a row whose lines
--     do not add up counts whole
--   v_category_month / v_project_spend / v_vendor_spend / v_transfer_month
--   v_funding: a transfer in, its window, what was spent, the mirror leg
--   set_type_category · set_transaction_category (clears with '', refuses
--     an unknown category, a VOID row, a reader)
--   recategorise_2026: dry run counts, apply moves types and overrides with
--     an audit row each; a second run finds nothing

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-00000000e274','rina-ct@talaliving.com','{"full_name":"Rina Ct"}'),
  ('ffffffff-0000-0000-0000-00000000e27d','andi-ct@talaliving.com','{"full_name":"Andi Ct"}');
insert into ops_core.user_authorities (user_id, authority) values
  ('ffffffff-0000-0000-0000-00000000e274','post_ledger'),
  ('ffffffff-0000-0000-0000-00000000e274','approve_funds');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-00000000e274','accounting','write'),
  -- vendors are procurement's: their names on the summaries come through
  -- the vendors' own RLS, so leadership holds procurement.read too
  ('ffffffff-0000-0000-0000-00000000e274','procurement','read'),
  ('ffffffff-0000-0000-0000-00000000e27d','accounting','read');

insert into ops_procure.vendors (id, code, name, is_curated) values
  ('11110000-0000-0000-0000-00000000e274','V-7274','TOKO CT UJI', true),
  ('11110000-0000-0000-0000-00000000e275','V-7275','SARIPAN HOUSE', true);
insert into ops_procure.projects (id, code, name, contract_value) values
  ('33330000-0000-0000-0000-00000000e274','PRJ-CT','Proyek uji kategori', 50000000);

insert into ops_acct.transactions (id, trx_no, trx_date, account_id, direction, amount_idr,
                                   type_code, vendor_id, project_id, description, source_ref, posted_by)
select v.id::uuid, v.no, v.d::date, a.id, v.dir::ops_acct.direction_t, v.amt, v.ty,
       v.vendor::uuid, v.project::uuid, v.descr, v.no, 'ffffffff-0000-0000-0000-00000000e274'
  from (values
    -- the funding: leadership sends 10 jt on the 1st, mirror leg on BCA 064
    ('55550000-0000-0000-0000-000000027401','trx-ct-1','2026-10-01','BCA 271','IN', 10000000,'CASHFLOW', null, null, 'TF FROM BCA 064'),
    ('55550000-0000-0000-0000-000000027402','trx-ct-2','2026-10-01','BCA 064','OUT',10000000,'CASHFLOW', null, null, 'TF TO BCA 271'),
    -- a purchase with a fee tail, on the project
    ('55550000-0000-0000-0000-000000027403','trx-ct-3','2026-10-02','BCA 271','OUT', 1002500,'SUPPLIERS','11110000-0000-0000-0000-00000000e274','33330000-0000-0000-0000-00000000e274','ENGSEL 100 PCS'),
    -- wrong type: a transfer booked on UTILITIES (rule 1)
    ('55550000-0000-0000-0000-000000027404','trx-ct-4','2026-10-03','BCA 271','OUT',  300000,'RECCURING - UTILITIES', null, null, 'TF TO PETTY CASH'),
    -- fuel on SUPPLIERS (rule 2)
    ('55550000-0000-0000-0000-000000027405','trx-ct-5','2026-10-03','BCA 271','OUT',  150000,'SUPPLIERS', null, null, 'BENSIN MOBIL GRANDMAX'),
    -- the household's rent on UTILITIES (rule 7a)
    ('55550000-0000-0000-0000-000000027406','trx-ct-6','2026-10-04','BCA 271','OUT', 2000000,'RECCURING - UTILITIES','11110000-0000-0000-0000-00000000e275', null, 'SEWA RUMAH OKTOBER'),
    -- money in from a client on CASHFLOW (rule 9a)
    ('55550000-0000-0000-0000-000000027407','trx-ct-7','2026-10-05','BCA 271','IN',  5000000,'CASHFLOW', null, null, 'E-BANKING CR TALA HOME DP'),
    -- an admin fee named PAYROLL stays bank (rule 3 must not take it)
    ('55550000-0000-0000-0000-000000027408','trx-ct-8','2026-10-05','BCA 271','OUT',    6500,'BANK CHARGES', null, null, 'ADMIN FEE PAYROLL'),
    -- the next funding closes the first window
    ('55550000-0000-0000-0000-000000027409','trx-ct-9','2026-10-08','BCA 271','IN',  4000000,'CASHFLOW', null, null, 'TF FROM BCA 064'),
    -- a 2025 row: left alone by the move
    ('55550000-0000-0000-0000-000000027410','trx-ct-10','2025-12-20','BCA 271','OUT', 400000,'SUPPLIERS', null, null, 'TF TO PETTY CASH')
  ) v(id, no, d, acc, dir, amt, ty, vendor, project, descr)
  join ops_acct.accounts a on a.code = v.acc;
insert into ops_acct.transaction_lines (trx_id, line_no, kind, description, qty, uom, unit_price, amount) values
  ('55550000-0000-0000-0000-000000027403', 1, 'item', 'ENGSEL', 100, 'pcs', 10000, 1000000),
  ('55550000-0000-0000-0000-000000027403', 2, 'fee',  'ADMIN FEE', null, null, null, 2500),
  -- lines that do not add up (an old import): the row counts whole
  ('55550000-0000-0000-0000-000000027405', 1, 'item', 'BENSIN', 1, 'pcs', 100000, 100000);

-- ── seams, as leadership ──────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-00000000e274';
do $$
declare r jsonb;
begin
  r := ops_acct.set_transaction_category('trx-ct-7', 'income');
  assert r ->> 'outcome' = 'ok', format('override, got %s', r);
  assert (select category from ops_acct.v_transaction where trx_no = 'trx-ct-7') = 'income', 'effective = override';
  assert (select category_override from ops_acct.v_transaction where trx_no = 'trx-ct-7') = 'income', 'and shown as one';
  r := ops_acct.set_transaction_category('trx-ct-7', 'income');
  assert r ->> 'outcome' = 'noop', format('same again, got %s', r);
  r := ops_acct.set_transaction_category('trx-ct-7', 'transfer');
  assert r ->> 'outcome' = 'ok' and (r -> 'data' ->> 'category_override') is null, format('equal to the type = no override, got %s', r);
  r := ops_acct.set_transaction_category('trx-ct-7', 'income');
  r := ops_acct.set_transaction_category('trx-ct-7', '');
  assert r ->> 'outcome' = 'ok' and (select category_override from ops_acct.transactions where trx_no = 'trx-ct-7') is null, format('cleared, got %s', r);
  r := ops_acct.set_transaction_category('trx-ct-7', 'hobby');
  assert r -> 'error' ->> 'code' = 'unknown_category', format('got %s', r);
  r := ops_acct.set_transaction_category('trx-ct-99', 'income');
  assert r ->> 'status' = '404', format('got %s', r);
  -- left as income for the views below: money in from a client
  r := ops_acct.set_transaction_category('trx-ct-7', 'income');
  assert r ->> 'outcome' = 'ok', format('got %s', r);

  r := ops_acct.set_type_category('OFFICE', 'fixed');
  assert r ->> 'outcome' = 'ok', format('type, got %s', r);
  assert (select category from ops_acct.transaction_types where code = 'OFFICE') = 'fixed', 'moved';
  r := ops_acct.set_type_category('OFFICE', 'overhead');
  r := ops_acct.set_type_category('OFFICE', 'hobby');
  assert r -> 'error' ->> 'code' = 'unknown_category', format('got %s', r);
end $$;

-- a reader may not
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-00000000e27d';
do $$
declare r jsonb;
begin
  r := ops_acct.set_transaction_category('trx-ct-7', 'income');
  assert r -> 'error' ->> 'code' = 'authority_required', format('got %s', r);
  r := ops_acct.set_type_category('OFFICE', 'fixed');
  assert r -> 'error' ->> 'code' = 'not_permitted', format('got %s', r);
end $$;

-- ── the views, as leadership (trx-ct-7 is income by its override) ─────────
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-00000000e274';
do $$
declare v_n numeric; r record;
begin
  assert (select category from ops_acct.transaction_types where code = 'SUPPLIERS') = 'vendor', 'type category seeded';
  assert (select category from ops_acct.transaction_types where code = 'BANK CHARGES') = 'bank', 'bank';
  assert (select category from ops_acct.v_transaction where trx_no = 'trx-ct-3') = 'vendor', 'effective = type';
  assert (select category from ops_acct.v_transaction where trx_no = 'trx-ct-1') = 'transfer', 'CASHFLOW is transfer';
  assert (select category from ops_acct.v_transaction where trx_no = 'trx-ct-7') = 'income', 'the override wins';

  -- parts: 1.000.000 vendor + 2.500 bank
  select sum(amount) into v_n from ops_acct.v_category_part where trx_no = 'trx-ct-3';
  assert v_n = 1002500, format('Σ parts = amount, got %s', v_n);
  assert (select amount from ops_acct.v_category_part where trx_no = 'trx-ct-3' and part_category = 'bank') = 2500, 'fee → bank';
  assert (select amount from ops_acct.v_category_part where trx_no = 'trx-ct-3' and part_category = 'vendor') = 1000000, 'body → vendor';
  -- lines that do not add up: one whole part
  assert (select count(*) from ops_acct.v_category_part where trx_no = 'trx-ct-5') = 1, 'one part';
  assert (select amount from ops_acct.v_category_part where trx_no = 'trx-ct-5') = 150000, 'counted whole';

  -- month × category
  assert (select amount from ops_acct.v_category_month where month = '2026-10' and direction = 'OUT' and category = 'bank') = 9000,
    'bank in October = 2.500 fee + 6.500 admin';
  assert (select n from ops_acct.v_category_month where month = '2026-10' and direction = 'OUT' and category = 'bank') = 2, 'two rows';

  -- per project, with the contract beside it
  select * into r from ops_acct.v_project_spend where project_code = 'PRJ-CT' and category = 'vendor';
  assert r.amount = 1000000 and r.contract_value = 50000000, format('project, got %s', r);
  -- per vendor
  assert (select amount from ops_acct.v_vendor_spend where vendor_name = 'TOKO CT UJI' and month = '2026-10' and category = 'vendor') = 1000000, 'vendor';
  -- transfers: BCA 271 received 14 jt, BCA 064 sent 10 jt
  assert (select transfer_in from ops_acct.v_transfer_month where month = '2026-10' and account_code = 'BCA 271') = 14000000, 'in';
  assert (select transfer_out from ops_acct.v_transfer_month where month = '2026-10' and account_code = 'BCA 064') = 10000000, 'out';

  -- funding: 10 jt landed on the 1st, the window closed on the 8th
  select * into r from ops_acct.v_funding where trx_no = 'trx-ct-1';
  assert r.from_account_code = 'BCA 064', format('mirror leg, got %s', r.from_account_code);
  assert r.next_funding_no = 'trx-ct-9' and r.window_end = '2026-10-08', 'window';
  assert r.spent = 1002500 + 300000 + 150000 + 2000000 + 6500, format('spent in the window, got %s', r.spent);
  assert r.remaining = 10000000 - r.spent and r.beyond = 0 and r.consumed_on is null, 'not spent through';
  assert r.undecided = 1002500 + 150000, format('undecided = the purchases with no decision, got %s', r.undecided);
  assert not r.is_open, 'closed';
  assert (select is_open from ops_acct.v_funding where trx_no = 'trx-ct-9'), 'the last one is open';
  assert not exists (select 1 from ops_acct.v_funding where trx_no = 'trx-ct-7'), 'income is not a funding';
end $$;

-- ── the one-time move ─────────────────────────────────────────────────────
set local role postgres;
-- trx-ct-7 is given back to the rule, so rule 9a has something to find
update ops_acct.transactions set category_override = null where trx_no = 'trx-ct-7';
do $$
declare r jsonb; a record;
begin
  r := ops_acct.recategorise_2026(false);
  assert not (r ->> 'applied')::boolean, 'dry run';
  assert (r -> 'rules' -> '1' ->> 'n')::int = 1 and r -> 'rules' -> '1' ->> 'to_type' = 'CASHFLOW', format('rule 1, got %s', r);
  assert (r -> 'rules' -> '2' ->> 'n')::int = 1, format('rule 2, got %s', r);
  assert (r -> 'rules' -> '7a' ->> 'n')::int = 1, format('rule 7a, got %s', r);
  assert (r -> 'rules' -> '9a' ->> 'n')::int = 1, format('rule 9a, got %s', r);
  assert r -> 'rules' -> '3' is null, format('the admin fee named PAYROLL is not wages, got %s', r);
  assert (select type_code from ops_acct.transactions where trx_no = 'trx-ct-4') = 'RECCURING - UTILITIES', 'nothing moved yet';

  r := ops_acct.recategorise_2026(true);
  assert (r ->> 'rows')::int = 4, format('four rows, got %s', r);
  assert (select type_code from ops_acct.transactions where trx_no = 'trx-ct-4') = 'CASHFLOW', 'rule 1 moved the type';
  assert (select category from ops_acct.v_transaction where trx_no = 'trx-ct-4') = 'transfer', 'and the category follows';
  assert (select type_code from ops_acct.transactions where trx_no = 'trx-ct-5') = 'TRANSPORT', 'rule 2';
  assert (select category_override from ops_acct.transactions where trx_no = 'trx-ct-6') = 'saripan', 'rule 7a';
  assert (select category_override from ops_acct.transactions where trx_no = 'trx-ct-7') = 'income', 'rule 9a';
  assert (select type_code from ops_acct.transactions where trx_no = 'trx-ct-10') = 'SUPPLIERS', '2025 is left alone';
  assert (select type_code from ops_acct.transactions where trx_no = 'trx-ct-8') = 'BANK CHARGES', 'the fee stays';

  select * into a from ops_core.audit_log where entity_no = 'trx-ct-4' and action = 'recategorise';
  assert a.before ->> 'type_code' = 'RECCURING - UTILITIES' and a.after ->> 'type_code' = 'CASHFLOW', format('trail, got %s / %s', a.before, a.after);
  assert a.detail ->> 'rule' = '1', 'the rule is named';

  r := ops_acct.recategorise_2026(false);
  assert (r ->> 'rows')::int = 0, format('a second run finds nothing, got %s', r);
end $$;

rollback;
