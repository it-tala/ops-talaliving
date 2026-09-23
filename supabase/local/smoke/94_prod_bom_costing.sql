-- prod — what one unit costs to make (0108, 0109).
--
--   REFUSALS     a labour line with no rate; releasing with an unpriced line;
--                releasing a draft identical to the last release; a
--                sub-assembly that contains its parent; somebody without
--                production access
--   DERIVATIONS  materials + labour + miskalkulasi = production cost; an
--                unpriced line making the cost null, not smaller; a manual
--                rate beating the catalogue; release freezing catalogue rates
--                so a later price change does not move a released cost; the
--                next draft following today's price again; a sub-assembly
--                costed at its own released production cost
--
-- Worked out first, per unit of PRD-T1:
--   kayu    0,1 m³ × 5.000.000   = 500.000   (standard price)
--   cat     1 liter ×    80.000  =  80.000   (last paid)
--   baut    8 pcs  ×     2.000   =  16.000   (manual rate)
--   tukang  1,5 hari × 150.000   = 225.000   (labour)
--   subtotal                       821.000
--   miskalkulasi 10%                82.100
--   biaya produksi                 903.100

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-00000000bb01','desainer@talaliving.com','{"full_name":"Desainer"}'),
  ('ffffffff-0000-0000-0000-00000000bb02','kasir@talaliving.com','{"full_name":"Kasir"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-00000000bb01','production','write');

insert into ops_procure.items (code, name, category_code, base_uom, standard_price, last_price) values
  ('T-KAYU','Kayu jati kering','raw-wood','m3', 5000000, 4200000),
  ('T-CAT','Cat PU clear','finishing','ltr', null, 80000),
  ('T-BAUT','Baut 8x50','hardware','pcs', null, null);

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-00000000bb01';

do $$
declare r jsonb; c ops_prod.v_product_cost; v_line uuid;
begin
  r := ops_prod.save_product('prd-t1', 'Meja uji', 'Meja', 'unit');
  assert ops_core.said_ok(r), 'create product: ' || r::text;
  assert exists (select 1 from ops_prod.products where product_code = 'PRD-T1'), 'code is upper-cased';

  r := ops_prod.save_bom_line('PRD-T1', null, 'material', 'T-KAYU', null, 0.1, 'm3');
  assert ops_core.said_ok(r), 'kayu: ' || r::text;
  r := ops_prod.save_bom_line('PRD-T1', null, 'material', 'T-CAT', null, 1, 'ltr');
  assert ops_core.said_ok(r), 'cat: ' || r::text;

  /* REFUSAL: labour is a name and a rate */
  r := ops_prod.save_bom_line('PRD-T1', null, 'labour', null, 'Tukang finishing', 1.5, 'hari');
  assert r->'error'->>'code' = 'rate_required', 'labour without a rate: ' || r::text;
  r := ops_prod.save_bom_line('PRD-T1', null, 'labour', null, 'Tukang finishing', 1.5, 'hari', 150000);
  assert ops_core.said_ok(r), 'labour: ' || r::text;

  r := ops_prod.save_bom_line('PRD-T1', null, 'material', 'T-BAUT', null, 8, 'pcs');
  assert ops_core.said_ok(r), 'baut: ' || r::text;
  r := ops_prod.set_bom_miscalc('PRD-T1', 10);
  assert ops_core.said_ok(r), 'miscalc: ' || r::text;

  /* DERIVATION: one unpriced line makes the cost unknown, not smaller */
  select * into c from ops_prod.v_product_cost where product_code = 'PRD-T1' and rev = 1;
  assert c.unpriced = 1, 'baut is unpriced, got ' || c.unpriced;
  assert c.production_cost is null, 'cost with a hole is null, got ' || coalesce(c.production_cost::text, 'null');
  assert c.priced_subtotal = 805000, 'priced part 805.000, got ' || c.priced_subtotal;

  /* REFUSAL: a release with a hole in it */
  r := ops_prod.release_bom('PRD-T1', 'rev awal');
  assert r->'error'->>'code' = 'unpriced_lines', 'unpriced release: ' || r::text;

  select id into v_line from ops_prod.bom_components where ref_code = 'T-BAUT';
  r := ops_prod.save_bom_line('PRD-T1', v_line, 'material', 'T-BAUT', null, 8, 'pcs', 2000);
  assert ops_core.said_ok(r), 'manual rate: ' || r::text;

  select * into c from ops_prod.v_product_cost where product_code = 'PRD-T1' and rev = 1;
  assert c.material_cost = 596000, 'materials 596.000, got ' || c.material_cost;
  assert c.labour_cost = 225000, 'labour 225.000, got ' || c.labour_cost;
  assert c.miscalc_amount = 82100, 'miskalkulasi 82.100, got ' || c.miscalc_amount;
  assert c.production_cost = 903100, 'production cost 903.100, got ' || c.production_cost;
  assert (select price_source from ops_prod.v_product_bom where ref_code = 'T-CAT') = 'last_paid',
    'cat priced from last paid';

  r := ops_prod.release_bom('PRD-T1', 'rev awal dari gambar kerja A');
  assert ops_core.said_ok(r), 'release: ' || r::text;
  assert (r->'data'->>'production_cost')::numeric = 903100, 'release reports the cost';
  assert (select rate_source from ops_prod.bom_components where ref_code = 'T-KAYU' and rev = 1) = 'standard',
    'the frozen rate says where it came from';
end $$;

/* DERIVATION: a price change after release does not move the released cost */
reset role;
update ops_procure.items set standard_price = 6000000 where code = 'T-KAYU';
set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-00000000bb01';

do $$
declare r jsonb; c ops_prod.v_product_cost; v_line uuid;
begin
  select * into c from ops_prod.v_product_cost where product_code = 'PRD-T1' and rev = 1;
  assert c.production_cost = 903100, 'released cost is frozen, got ' || c.production_cost;

  /* editing a released line opens the draft and edits the copy */
  select id into v_line from ops_prod.bom_components where ref_code = 'T-CAT' and rev = 1;
  r := ops_prod.save_bom_line('PRD-T1', v_line, 'material', 'T-CAT', null, 1.2, 'ltr');
  assert ops_core.said_ok(r), 'edit from released: ' || r::text;
  assert (r->'data'->>'rev')::int = 2, 'landed in rev 2';
  assert (select qty from ops_prod.bom_components where ref_code = 'T-CAT' and rev = 1) = 1,
    'rev 1 untouched';

  -- rev 2: kayu follows today's price (600.000), cat 1,2 × 80.000 = 96.000,
  -- baut keeps its manual 16.000, labour 225.000 → 937.000 + 93.700
  select * into c from ops_prod.v_product_cost where product_code = 'PRD-T1' and rev = 2;
  assert c.production_cost = 1030700, 'rev 2 follows today''s prices, got ' || c.production_cost;
  assert (select rate_source from ops_prod.bom_components where ref_code = 'T-BAUT' and rev = 2) = 'manual',
    'a manual rate is carried into the draft';
  assert (select unit_rate from ops_prod.bom_components where ref_code = 'T-KAYU' and rev = 2) is null,
    'a frozen catalogue rate is let go in the draft';

  /* put it back as it was: identical to rev 1 except kayu's price */
  select id into v_line from ops_prod.bom_components where ref_code = 'T-CAT' and rev = 2;
  r := ops_prod.save_bom_line('PRD-T1', v_line, 'material', 'T-CAT', null, 1, 'ltr');
  select id into v_line from ops_prod.bom_components where ref_code = 'T-KAYU' and rev = 2;
  r := ops_prod.save_bom_line('PRD-T1', v_line, 'material', 'T-KAYU', null, 0.1, 'm3', 5000000);

  /* REFUSAL: nothing changed */
  r := ops_prod.release_bom('PRD-T1', 'tidak ada apa-apa');
  assert r->'error'->>'code' = 'nothing_changed', 'identical release: ' || r::text;

  r := ops_prod.discard_bom_draft('PRD-T1');
  assert ops_core.said_ok(r), 'discard: ' || r::text;
  assert not exists (select 1 from ops_prod.bom_revisions r2
                       join ops_prod.products p on p.id = r2.product_id
                      where p.product_code = 'PRD-T1' and r2.released_at is null), 'draft gone';

  /* DERIVATION: a sub-assembly at its own released production cost */
  r := ops_prod.save_product('PRD-SUB', 'Laci uji', 'Sub-rakitan', 'pcs');
  r := ops_prod.save_bom_line('PRD-SUB', null, 'labour', null, 'Rakit laci', 1, 'unit', 50000);
  r := ops_prod.release_bom('PRD-SUB', 'laci');
  assert ops_core.said_ok(r), 'sub release: ' || r::text;

  r := ops_prod.save_bom_line('PRD-T1', null, 'product', 'PRD-SUB', null, 2, 'pcs');
  assert ops_core.said_ok(r), 'sub-assembly line: ' || r::text;
  assert (select unit_price from ops_prod.v_product_bom where ref_code = 'PRD-SUB') = 50000,
    'sub-assembly rate is its production cost';
  assert (select price_source from ops_prod.v_product_bom where ref_code = 'PRD-SUB') = 'sub_assembly',
    'and says so';

  /* REFUSAL: a loop */
  r := ops_prod.save_bom_line('PRD-SUB', null, 'product', 'PRD-T1', null, 1, 'pcs');
  assert r->'error'->>'code' = 'bom_cycle', 'cycle: ' || r::text;

  /* the catalogue summary reads the draft */
  assert (select draft_rev from ops_prod.v_product_summary where product_code = 'PRD-T1') = 2,
    'summary shows the open draft — a discarded draft gives its number back';

  /* a new item from the BOM goes into the items database */
  r := ops_prod.create_bom_item('Engsel sendok 35mm', 'hardware', 'pcs', 'goods', 12000);
  assert ops_core.said_ok(r), 'new item: ' || r::text;
  assert exists (select 1 from ops_procure.items where name = 'Engsel sendok 35mm'
                   and not is_curated and standard_price = 12000), 'item is in procurement, uncurated';
  r := ops_prod.create_bom_item('engsel sendok 35MM', 'hardware', 'pcs');
  assert r->>'outcome' = 'noop' and (r->'data'->>'existing')::boolean, 'same name hands back the existing one: ' || r::text;
end $$;

/* REFUSAL: no production access */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-00000000bb02';
do $$
declare r jsonb;
begin
  r := ops_prod.save_bom_line('PRD-T1', null, 'material', 'T-KAYU', null, 1, 'm3');
  assert r->'error'->>'code' = 'not_permitted', 'outsider edit: ' || r::text;
  r := ops_prod.create_bom_item('Apa saja', 'hardware', 'pcs');
  assert r->'error'->>'code' = 'not_permitted', 'outsider item: ' || r::text;
end $$;

rollback;
