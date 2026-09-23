-- prod — the catalogue, and what a released bill of material is for.
--
--   REFUSALS     a product_code changed after the drawings quote it; a labour
--                cost with no working; a second draft; un-releasing a release;
--                **editing or deleting a line of a released revision**, which
--                is the pinning D256 exists for; a product inside itself
--   DERIVATIONS  standard price beating last price paid and saying which; an
--                unpriced component making the total **null rather than
--                zero**; qty with waste; a code procurement has never heard of
--                reported rather than refused
--
-- Worked out first:  kayu 2 × 1,10 × 150.000 = 330.000
--                    sekrup 20 × 1,00 ×   500 =  10.000

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-00000000cc01','joko@talaliving.com','{"full_name":"Joko Widodo"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-00000000cc01','production','write');

insert into ops_procure.items (code, name, category_code, base_uom, standard_price, last_price) values
  ('KAYU-01','Papan jati 3cm','raw-wood','lembar', 150000, 120000),
  ('SEKRUP-01','Sekrup 4x40','hardware','pcs',        null,    500),
  ('CAT-01','Cat duco putih','finishing','kg',        null,   null);

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-00000000cc01';

/* ── REFUSAL: a labour cost with no working behind it (D239) ───────────── */
do $$
begin
  assert ops_core.has_permission('production.create'), 'the workshop may catalogue';
  begin
    insert into ops_prod.products (product_code, name, category, uom, labour_cost)
    values ('PRD-X','Uji','Meja','unit', 250000);
    raise exception 'a labour cost with no note should be refused';
  exception when check_violation then null;
  end;

  -- An empty stage list is a different claim from null, and a meaningless one.
  begin
    insert into ops_prod.products (product_code, name, category, uom, stages)
    values ('PRD-Y','Uji','Meja','unit', '{}');
    raise exception 'an empty stages array should be refused';
  exception when check_violation then null;
  end;
end $$;

insert into ops_prod.products
  (id, product_code, name, category, uom, length_mm, width_mm, height_mm, stages, labour_cost, labour_note, created_by)
values ('bbbb0000-0000-0000-0000-0000000000a1','PRD-MJ-220','Meja makan 220','Meja','unit',
        2200, 900, 750, array['sanding','finishing','packing'], 400000,
        'dua tukang × 2 hari × 100.000','ffffffff-0000-0000-0000-00000000cc01'),
       ('bbbb0000-0000-0000-0000-0000000000a2','PRD-LC-001','Laci kecil','Lemari','unit',
        400, 300, 150, null, null, null,'ffffffff-0000-0000-0000-00000000cc01');

/* ── REFUSAL: the code is on the drawings and cannot move ──────────────── */
do $$
begin
  begin
    update ops_prod.products set product_code = 'PRD-MJ-221' where product_code = 'PRD-MJ-220';
    raise exception 'changing a product_code should be refused';
  exception when check_violation then null;
  end;
end $$;

/* ── the draft, and one draft only ─────────────────────────────────────── */
insert into ops_prod.bom_revisions (product_id, rev, created_by)
values ('bbbb0000-0000-0000-0000-0000000000a1', 1, 'ffffffff-0000-0000-0000-00000000cc01');

do $$
begin
  begin
    insert into ops_prod.bom_revisions (product_id, rev, created_by)
    values ('bbbb0000-0000-0000-0000-0000000000a1', 2, 'ffffffff-0000-0000-0000-00000000cc01');
    raise exception 'a second draft should be refused — which one would a work order pin to?';
  exception when unique_violation then null;
  end;
end $$;

insert into ops_prod.bom_components (product_id, rev, kind, ref_code, qty, uom, waste_percent) values
  ('bbbb0000-0000-0000-0000-0000000000a1', 1, 'material','KAYU-01',    2,'lembar', 10),
  ('bbbb0000-0000-0000-0000-0000000000a1', 1, 'material','SEKRUP-01', 20,'pcs',     0),
  ('bbbb0000-0000-0000-0000-0000000000a1', 1, 'material','CAT-01',     1,'kg',      5),
  ('bbbb0000-0000-0000-0000-0000000000a1', 1, 'material','RANGKA-BESI',1,'unit',    0),
  ('bbbb0000-0000-0000-0000-0000000000a1', 1, 'product', 'PRD-LC-001', 2,'unit',    0);

/* ── REFUSAL: a product cannot be a component of itself ────────────────── */
do $$
begin
  begin
    insert into ops_prod.bom_components (product_id, rev, kind, ref_code, qty, uom)
    values ('bbbb0000-0000-0000-0000-0000000000a1', 1, 'product','PRD-MJ-220', 1, 'unit');
    raise exception 'a product inside itself should be refused';
  exception when check_violation then null;
  end;
end $$;

/* ── DERIVATION: the price, which one it is, and the waste ─────────────── */
do $$
declare b record;
begin
  /* Every message here is `coalesce`d. `'got ' || null` is null, so an
     assertion that fails on a missing value prints nothing at all — which is
     the one moment the message was for (seen while mutation-testing this). */
  select * into b from ops_prod.v_product_bom where ref_code = 'KAYU-01';
  assert b.unit_price = 150000,        'the catalogue price wins, got ' || coalesce(b.unit_price::text,'(null — can the reader see ops_procure.items?)');
  assert b.price_source = 'standard',  'and the view says which, got ' || coalesce(b.price_source,'(null)');
  assert b.qty_with_waste = 2.2,       '2 lembar plus 10% susut, got ' || coalesce(b.qty_with_waste::text,'(null)');
  assert b.subtotal = 330000,          '2,2 × 150.000, got ' || coalesce(b.subtotal::text,'(null)');
  assert b.ref_name = 'Papan jati 3cm','resolved by code at the seam, got ' || coalesce(b.ref_name,'(null)');

  select * into b from ops_prod.v_product_bom where ref_code = 'SEKRUP-01';
  assert b.unit_price = 500,           'no catalogue price, so the last one paid, got ' || coalesce(b.unit_price::text,'(null)');
  assert b.price_source = 'last_paid', 'and it says so rather than hiding it, got ' || coalesce(b.price_source,'(null)');

  select * into b from ops_prod.v_product_bom where ref_code = 'CAT-01';
  assert b.unit_price is null, 'a price nobody has set is missing, not zero';
  assert b.subtotal is null,   'so the line has no subtotal at all';

  -- A code procurement has never heard of: shown, not refused (A6). The
  -- workshop knows it needs a steel frame before anybody has catalogued one.
  select * into b from ops_prod.v_product_bom where ref_code = 'RANGKA-BESI';
  assert b.ref_name is null,   'unresolved, and reported as such';
  assert b.unit_price is null, 'and unpriced';

  -- A sub-assembly resolves its name from the catalogue, not from items.
  select * into b from ops_prod.v_product_bom where ref_code = 'PRD-LC-001';
  assert b.ref_name = 'Laci kecil', 'a product component names itself, got ' || coalesce(b.ref_name,'(null)');
end $$;

/* ── DERIVATION: an unpriced line makes the total null, never zero ─────── */
do $$
declare c record;
begin
  select * into c from ops_prod.v_product_cost where product_code = 'PRD-MJ-220';
  assert c.components = 5,        'five lines, got ' || c.components;
  assert c.unpriced = 3,          'cat, rangka and the sub-assembly, got ' || c.unpriced;
  assert c.unresolved = 1,        'only the steel frame has no name, got ' || c.unresolved;
  assert c.material_cost is null, 'a total that omits three lines is the number somebody quotes from';
  assert c.priced_subtotal = 340000, '330.000 + 10.000 of what IS priced, got ' || c.priced_subtotal;
  -- Labour is BOM lines since 0106; the typed product figure is no longer
  -- read for a cost, and a revision with no labour line says so with a null.
  assert c.labour_cost is null,   'no labour line on this revision, got ' || coalesce(c.labour_cost::text,'(null)');
end $$;

/* ── release, and what a release makes impossible ──────────────────────── */
do $$
begin
  -- Releasing says why.
  begin
    update ops_prod.bom_revisions set released_at = now(), released_by = 'ffffffff-0000-0000-0000-00000000cc01'
     where product_id = 'bbbb0000-0000-0000-0000-0000000000a1';
    raise exception 'releasing with no note should be refused';
  exception when check_violation then null;
  end;

  update ops_prod.bom_revisions
     set released_at = now(), released_by = 'ffffffff-0000-0000-0000-00000000cc01',
         note = 'rev awal, dirilis untuk SPK Astoria'
   where product_id = 'bbbb0000-0000-0000-0000-0000000000a1';

  -- A released revision is frozen for ever (A5).
  begin
    update ops_prod.bom_revisions set released_at = null, released_by = null
     where product_id = 'bbbb0000-0000-0000-0000-0000000000a1';
    raise exception 'un-releasing should be refused';
  exception when check_violation then null;
  end;
end $$;

/* ── REFUSAL: a released line is what June's wardrobe was made of ──────── */
do $$
declare n int;
begin
  -- Silent, because RLS filters rather than raises: the row is simply not
  -- visible to the write, so nothing happens. Counting is how you tell.
  update ops_prod.bom_components set qty = 99 where ref_code = 'KAYU-01';
  select count(*) into n from ops_prod.bom_components where ref_code = 'KAYU-01' and qty = 99;
  assert n = 0, 'a released line cannot be edited, got ' || n || ' changed';

  delete from ops_prod.bom_components where ref_code = 'CAT-01';
  select count(*) into n from ops_prod.bom_components where ref_code = 'CAT-01';
  assert n = 1, 'nor deleted — that is the pinning D256 exists for, got ' || n || ' left';
end $$;

rollback;
