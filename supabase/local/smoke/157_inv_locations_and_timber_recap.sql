-- inv — locations addable by inventory.update, and a month's timber total (0157).
--
-- REFUSALS     a read-level user cannot add or rename a location; deleting one
--              is still not a policy anywhere (no delete policy exists at all)
-- DERIVATIONS  a new location is usable the same request; retiring one leaves
--              its past moves readable; v_timber_by_month sums two loads
--              across two species without inventing a rate

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-000000002401','budi@talaliving.com','{"full_name":"Budi"}'),
  ('ffffffff-0000-0000-0000-000000002402','sinta@talaliving.com','{"full_name":"Sinta"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-000000002401','inventory','read'),
  ('ffffffff-0000-0000-0000-000000002402','inventory','write');
insert into ops_procure.vendors (code, name) values ('V-8003','Kayu Manis');
-- Reference-table setup for the stock-move check below, done here (as the
-- connecting role, not `authenticated`) because `stocked_categories` has no
-- insert policy at all — nobody writes it from a screen, only a migration.
insert into ops_procure.item_categories (code, name) values ('raw-wood-uji','Kayu (uji)')
  on conflict (code) do nothing;
insert into ops_inv.stocked_categories (category_code) values ('raw-wood-uji')
  on conflict do nothing;
insert into ops_procure.items (code, name, category_code, base_uom) values
  ('ITM-8003','Amplas uji','raw-wood-uji','lembar');

/* ── REFUSAL: read-level cannot add or rename a location ───────────────────
 *
 * An INSERT whose WITH CHECK fails raises (42501, `insufficient_privilege`).
 * An UPDATE whose USING clause hides the row does not — it matches **zero
 * rows** and returns normally, so refusal is proven by row count, not by
 * catching an exception (the ambiguity `updateStockLocation` in
 * `src/lib/api/inventory.ts` exists specifically to resolve). */
set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000002401';
do $$
declare hit int;
begin
  begin
    insert into ops_inv.stock_locations (code, name) values ('OPNAME-A','Area A opname');
    raise exception 'a read-level user should not be able to add a rack';
  exception when insufficient_privilege then null;
  end;

  update ops_inv.stock_locations set name = 'Diganti' where code = 'GUDANG';
  get diagnostics hit = row_count;
  assert hit = 0, 'a read-level user''s rename should touch zero rows under RLS, touched ' || hit;
end $$;
reset role;

/* ── DERIVATION: write-level adds a rack, and it counts the same day ─────── */
set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000002402';

insert into ops_inv.stock_locations (code, name) values ('OPNAME-A','Area A opname');

do $$
declare loc record;
begin
  select * into loc from ops_inv.stock_locations where code = 'OPNAME-A';
  assert loc.name = 'Area A opname' and loc.is_active, 'a fresh rack starts active';
end $$;

insert into ops_inv.stock_moves (item_code, location, kind, qty, uom, moved_by)
values ('ITM-8003','OPNAME-A','receipt', 10, 'lembar', 'ffffffff-0000-0000-0000-000000002402');

/* Retiring the rack is a rename of its flag, not a delete — the move above
   must stay readable afterwards (A5). */
update ops_inv.stock_locations set is_active = false where code = 'OPNAME-A';

do $$
declare mv record;
begin
  select * into mv from ops_inv.stock_moves where location = 'OPNAME-A';
  assert mv.qty = 10, 'a retired rack does not erase what was ever counted there';
end $$;

do $$
begin
  begin
    delete from ops_inv.stock_locations where code = 'OPNAME-A';
    raise exception 'there is no delete policy on stock_locations at all';
  exception when insufficient_privilege then null;
  end;
end $$;

/* ── DERIVATION: two loads, two species, one month — totals, no blended rate ── */
insert into ops_inv.log_purchases (purchase_no, vendor_code, received_on, species, total_cost, measure)
values ('kyu-bm-01','V-8003', date_trunc('month', current_date)::date + 2, 'Jati',   10000000,'round'),
       ('kyu-bm-02','V-8003', date_trunc('month', current_date)::date + 5, 'Mahoni',  4000000,'round');

insert into ops_inv.log_pieces (purchase_id, tag, diameter_cm, length_cm, sawn_on)
select p.id, 'A' || n, 30, 300, current_date
  from ops_inv.log_purchases p, generate_series(1, 3) n where p.purchase_no = 'kyu-bm-01';
insert into ops_inv.log_pieces (purchase_id, tag, diameter_cm, length_cm, sawn_on)
select p.id, 'B' || n, 30, 300, current_date
  from ops_inv.log_purchases p, generate_series(1, 2) n where p.purchase_no = 'kyu-bm-02';

insert into ops_inv.sawn_boards (purchase_id, thickness_mm, width_mm, length_mm, qty, sawn_on)
select id, 30, 200, 3000, 12, current_date from ops_inv.log_purchases where purchase_no = 'kyu-bm-01';
insert into ops_inv.sawn_boards (purchase_id, thickness_mm, width_mm, length_mm, qty, sawn_on)
select id, 30, 200, 3000, 6, current_date from ops_inv.log_purchases where purchase_no = 'kyu-bm-02';

insert into ops_inv.log_costs (purchase_id, kind, amount, incurred_on)
select id, 'angkut', 500000, current_date from ops_inv.log_purchases where purchase_no = 'kyu-bm-01';

do $$
declare m record;
begin
  select * into m from ops_inv.v_timber_by_month where month = date_trunc('month', current_date)::date;
  assert m.loads = 2,               'both loads land in the same month, got ' || m.loads;
  assert m.vendors = 1,             'one vendor this month, got ' || m.vendors;
  assert m.species_count = 2,       'jati and mahoni, got ' || m.species_count;
  assert m.wood_cost = 14000000,    'the two invoices, got ' || m.wood_cost;
  assert m.extra_cost = 500000,     'one truck nota, got ' || m.extra_cost;
  assert m.landed_cost = 14500000,  'invoices plus the truck, got ' || m.landed_cost;
end $$;

reset role;

rollback;
