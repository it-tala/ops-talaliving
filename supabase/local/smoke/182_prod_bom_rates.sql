-- prod — the BOM rate list and the *komponen* on a line (0182, D324).
--
--   REFUSALS     a rate with no name, a negative rate, an unknown group, a
--                linked item that does not exist, two active rates with one
--                name; a line naming a rate that does not exist; a rate on a
--                sub-assembly; the same material twice for the same part;
--                somebody without production access changing the list
--   DERIVATIONS  a line priced from the list, and says so; the same material
--                on two parts is two lines; a labour line priced from a
--                labour rate with no typed figure; a rate picked for a
--                material with a linked item points the line at the item; a
--                rate change moving a draft and not a released revision;
--                release freezing `rate` as the source; the next draft
--                following the list again; the part copied into the draft;
--                moving a material between parts is a change worth a release;
--                a rate-only material named and priced in the purchase walk
--
-- Worked out first, per unit of PRD-R1 (a side table):
--   Kaki-kaki  kayu mindi A   0,04 m³ × 6.000.000 = 240.000   (rate RT-0001)
--   Top        kayu mindi A   0,03 m³ × 6.000.000 = 180.000   (rate RT-0001)
--   Finishing  finishing PU   1,2 m²  ×    85.000 = 102.000   (rate RT-0002, no item)
--   Rakit      tukang kayu    1 hari  ×   175.000 = 175.000   (labour rate RT-0003)
--   subtotal                                        697.000

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-00000000cd01','estimator@talaliving.com','{"full_name":"Estimator"}'),
  ('ffffffff-0000-0000-0000-00000000cd02','gudang@talaliving.com','{"full_name":"Gudang"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-00000000cd01','production','write'),
  ('ffffffff-0000-0000-0000-00000000cd02','production','read');

insert into ops_procure.items (code, name, category_code, base_uom, standard_price, last_price) values
  ('R-MINDI','Kayu mindi grade A (item)','raw-wood','m3', 5500000, null);

-- This file is written against an empty rate list: the first rate saved is
-- RT-0001, and every BOM line below names its rate by that code. 0200 seeds
-- the PLV rate card as data, so on a fresh ladder RT-0001..RT-0026 are already
-- taken. Nothing references them yet, and the whole file rolls back, so they
-- are set aside here rather than every code below being made relative.
delete from ops_prod.bom_rates;

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-00000000cd01';

do $$
declare r jsonb; c ops_prod.v_product_cost; b record;
begin
  /* REFUSALS on the list itself */
  r := ops_prod.save_bom_rate(null, '  ', 'kayu', 'm3', 1000);
  assert r->'error'->>'code' = 'name_required', 'blank name: ' || r::text;
  r := ops_prod.save_bom_rate(null, 'Kayu mindi grade A', 'kayu', 'm3', -1);
  assert r->'error'->>'code' = 'negative_rate', 'negative: ' || r::text;
  r := ops_prod.save_bom_rate(null, 'Kayu mindi grade A', 'kayoo', 'm3', 1000);
  assert r->'error'->>'code' = 'unknown_group', 'group: ' || r::text;
  r := ops_prod.save_bom_rate(null, 'Kayu mindi grade A', 'kayu', 'm3', 1000, 'NO-SUCH-ITEM');
  assert r->'error'->>'code' = 'no_such_item', 'item link: ' || r::text;

  r := ops_prod.save_bom_rate(null, 'Kayu mindi grade A', 'kayu', 'm3', 6000000, 'r-mindi');
  assert ops_core.said_ok(r), 'mindi: ' || r::text;
  assert r->'data'->>'code' = 'RT-0001', 'first code RT-0001, got ' || coalesce(r->'data'->>'code', 'null');
  assert (select item_code from ops_prod.bom_rates where code = 'RT-0001') = 'R-MINDI', 'item code upper-cased';
  r := ops_prod.save_bom_rate(null, 'Finishing PU melamine', 'finishing', 'm2', 85000);
  assert r->'data'->>'code' = 'RT-0002', 'finishing: ' || r::text;
  r := ops_prod.save_bom_rate(null, 'Tukang kayu', 'labour', 'hari', 175000);
  assert r->'data'->>'code' = 'RT-0003', 'labour: ' || r::text;

  r := ops_prod.save_bom_rate(null, 'kayu MINDI grade a', 'kayu', 'm3', 1);
  assert r->'error'->>'code' = 'rate_name_taken', 'twin name: ' || r::text;

  /* the lines */
  r := ops_prod.save_product('prd-r1', 'Meja samping uji', 'Meja', 'unit');
  assert ops_core.said_ok(r), 'product: ' || r::text;

  r := ops_prod.save_bom_line('PRD-R1', null, 'material', null, null, 0.04, null, null, 0, null, 'Kaki-kaki', 'RT-0001');
  assert ops_core.said_ok(r), 'legs: ' || r::text;
  assert r->'data'->>'ref_code' = 'R-MINDI', 'a rate with an item points the line at the item: ' || r::text;
  r := ops_prod.save_bom_line('PRD-R1', null, 'material', null, null, 0.03, null, null, 0, null, 'Top', 'RT-0001');
  assert ops_core.said_ok(r), 'the same material for another part is another line: ' || r::text;
  r := ops_prod.save_bom_line('PRD-R1', null, 'material', null, null, 0.05, null, null, 0, null, 'kaki-KAKI', 'RT-0001');
  assert r->'error'->>'code' = 'already_on_bom', 'same material, same part: ' || r::text;
  r := ops_prod.save_bom_line('PRD-R1', null, 'material', null, null, 1.2, null, null, 0, null, 'Finishing', 'RT-0002');
  assert ops_core.said_ok(r), 'finishing: ' || r::text;
  assert r->'data'->>'ref_code' = 'RT-0002', 'a rate with no item is its own material code';
  r := ops_prod.save_bom_line('PRD-R1', null, 'labour', null, null, 1, 'hari', null, 0, null, 'Rakit', 'RT-0003');
  assert ops_core.said_ok(r), 'labour from the list, no typed rate: ' || r::text;

  r := ops_prod.save_bom_line('PRD-R1', null, 'material', null, null, 1, null, null, 0, null, null, 'RT-9999');
  assert r->'error'->>'code' = 'unknown_rate', 'unknown rate: ' || r::text;
  r := ops_prod.save_bom_line('PRD-R1', null, 'product', 'PRD-X', null, 1, null, null, 0, null, null, 'RT-0001');
  assert r->'error'->>'code' = 'rate_on_sub_assembly', 'rate on a sub-assembly: ' || r::text;

  select * into b from ops_prod.v_product_bom where product_code = 'PRD-R1' and part = 'Kaki-kaki';
  assert b.unit_price = 6000000, 'the list beats the catalogue, got ' || coalesce(b.unit_price::text, 'null');
  assert b.price_source = 'rate', 'and says so, got ' || coalesce(b.price_source, 'null');
  assert b.uom = 'm3', 'the unit comes from the rate when none is typed, got ' || coalesce(b.uom, 'null');
  assert b.rate_name = 'Kayu mindi grade A', 'the rate is named beside the line';
  assert b.catalogue_price = 6000000, 'catalogue_price is the list figure for a line that follows one';
  select * into b from ops_prod.v_product_bom where product_code = 'PRD-R1' and part = 'Finishing';
  assert b.ref_name = 'Finishing PU melamine', 'a rate-only material is named from the list, got ' || coalesce(b.ref_name, 'null');
  select * into b from ops_prod.v_product_bom where product_code = 'PRD-R1' and kind = 'labour';
  assert b.ref_name = 'Tukang kayu' and b.unit_price = 175000, 'labour named and priced from its rate';

  select * into c from ops_prod.v_product_cost where product_code = 'PRD-R1' and rev = 1;
  assert c.unpriced = 0, 'everything priced, got ' || c.unpriced;
  assert c.production_cost = 697000, 'production cost 697.000, got ' || coalesce(c.production_cost::text, 'null');

  /* DERIVATION: a rate change moves the draft */
  r := ops_prod.save_bom_rate('RT-0001', 'Kayu mindi grade A', 'kayu', 'm3', 6500000, 'R-MINDI');
  assert ops_core.said_ok(r), 'rate change: ' || r::text;
  select * into c from ops_prod.v_product_cost where product_code = 'PRD-R1' and rev = 1;
  assert c.production_cost = 732000, 'the draft follows the list, got ' || coalesce(c.production_cost::text, 'null');
  assert (select used_by from ops_prod.v_bom_rate where code = 'RT-0001') = 1, 'used by one product';

  r := ops_prod.release_bom('PRD-R1', 'rev awal dari gambar kerja');
  assert ops_core.said_ok(r), 'release: ' || r::text;
  assert (select rate_source from ops_prod.bom_components c2 join ops_prod.products p on p.id = c2.product_id
           where p.product_code = 'PRD-R1' and c2.part = 'Top') = 'rate', 'frozen as `rate`';

  /* and not the released revision */
  r := ops_prod.save_bom_rate('RT-0001', 'Kayu mindi grade A', 'kayu', 'm3', 7000000, 'R-MINDI');
  select * into c from ops_prod.v_product_cost where product_code = 'PRD-R1' and rev = 1;
  assert c.production_cost = 732000, 'released cost is frozen, got ' || coalesce(c.production_cost::text, 'null');

  /* editing a released line: the copy for the same part, following the list again */
  select c2.id into b from ops_prod.bom_components c2 join ops_prod.products p on p.id = c2.product_id
   where p.product_code = 'PRD-R1' and c2.part = 'Top' and c2.rev = 1;
  r := ops_prod.save_bom_line('PRD-R1', b.id, 'material', 'R-MINDI', null, 0.035, 'm3', null, 0, null, 'Top', 'RT-0001');
  assert ops_core.said_ok(r) and (r->'data'->>'rev')::int = 2, 'edit lands in rev 2: ' || r::text;
  assert (select qty from ops_prod.bom_components c2 join ops_prod.products p on p.id = c2.product_id
           where p.product_code = 'PRD-R1' and c2.part = 'Kaki-kaki' and c2.rev = 2) = 0.04,
    'the other part is copied untouched';
  assert (select unit_price from ops_prod.v_product_bom where product_code = 'PRD-R1' and rev = 2 and part = 'Kaki-kaki') = 7000000,
    'the draft follows today''s list, not the frozen figure';
  assert (select count(*) from ops_prod.bom_components c2 join ops_prod.products p on p.id = c2.product_id
           where p.product_code = 'PRD-R1' and c2.rev = 2 and c2.kind = 'labour' and c2.unit_rate is null and c2.rate_code = 'RT-0003') = 1,
    'a labour line from the list goes back to following it';

  /* the Top is smaller now, and the list moved: rev 2 is a change worth releasing */
  r := ops_prod.release_bom('PRD-R1', 'harga mindi naik');
  assert ops_core.said_ok(r), 'a rate that moved is a change worth a revision: ' || r::text;

  /* DERIVATION: moving a material between parts is a change on its own */
  select c2.id into b from ops_prod.bom_components c2 join ops_prod.products p on p.id = c2.product_id
   where p.product_code = 'PRD-R1' and c2.part = 'Finishing' and c2.rev = 2;
  r := ops_prod.save_bom_line('PRD-R1', b.id, 'material', 'RT-0002', null, 1.2, 'm2', null, 0, null, 'Finishing top', 'RT-0002');
  assert ops_core.said_ok(r), 'rename the part: ' || r::text;
  r := ops_prod.release_bom('PRD-R1', 'finishing hanya di top');
  assert ops_core.said_ok(r), 'a part renamed is a change, not nothing_changed: ' || r::text;

  /* removing a released line removes the copy for the same part */
  select c2.id into b from ops_prod.bom_components c2 join ops_prod.products p on p.id = c2.product_id
   where p.product_code = 'PRD-R1' and c2.part = 'Top' and c2.rev = 3;
  r := ops_prod.remove_bom_line('PRD-R1', b.id);
  assert ops_core.said_ok(r), 'remove: ' || r::text;
  assert exists (select 1 from ops_prod.bom_components c2 join ops_prod.products p on p.id = c2.product_id
                  where p.product_code = 'PRD-R1' and c2.rev = 4 and c2.part = 'Kaki-kaki'),
    'the legs stay in the draft';
  assert not exists (select 1 from ops_prod.bom_components c2 join ops_prod.products p on p.id = c2.product_id
                  where p.product_code = 'PRD-R1' and c2.rev = 4 and c2.part = 'Top'),
    'only the top is gone';

  /* DERIVATION: the purchase walk merges both parts and names a rate-only material */
  select * into b from ops_prod.explode_bom('PRD-R1', 2, 3) where ref_code = 'R-MINDI';
  assert b.qty = 0.15, 'legs + top for two units, got ' || coalesce(b.qty::text, 'null');
  select * into b from ops_prod.explode_bom('PRD-R1', 2, 3) where ref_code = 'RT-0002';
  assert b.ref_name = 'Finishing PU melamine' and b.unit_price = 85000 and b.price_source = 'rate',
    'a rate-only material is named and priced in the walk';
end $$;

/* REFUSAL: reading is for everybody, changing is not */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-00000000cd02';
do $$
declare r jsonb;
begin
  assert (select count(*) from ops_prod.v_bom_rate) = 3, 'a reader sees the list';
  r := ops_prod.save_bom_rate(null, 'Karton 5 lapis', 'packing', 'm2', 12000);
  assert r->'error'->>'code' = 'not_permitted', 'reader adds a rate: ' || r::text;
  r := ops_prod.save_bom_rate('RT-0001', 'Kayu mindi grade A', 'kayu', 'm3', 1);
  assert r->'error'->>'code' = 'not_permitted', 'reader changes a rate: ' || r::text;
  assert (select unit_rate from ops_prod.bom_rates where code = 'RT-0001') = 7000000, 'and nothing moved';
end $$;

/* REFUSAL: no road around the seam */
do $$
begin
  begin
    insert into ops_prod.bom_rates (code, name, rate_group, uom, unit_rate) values ('RT-0099', 'Pintu belakang', 'lain', 'unit', 1);
    raise exception 'a direct insert should be refused — the list changes through save_bom_rate';
  exception when insufficient_privilege then null;
  end;
end $$;

rollback;
