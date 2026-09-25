-- inv — finished goods on a rack until they ship; the overrun named (0170).
--
--   gudang   inventory write — records, moves, counts
--   lihat    inventory read  — reads, writes nothing
--
-- DERIVATIONS  produced carries the JO's order line, never the form's; a
--              delivery note ships from the rack without a second entry; a
--              delivery before the rack started is not subtracted; a cancelled
--              one is not either; overrun = produced beyond ordered; surplus =
--              on the rack beyond what is still owed; a transfer is two rows
--              that net to zero; an opname stores the difference
-- REFUSALS     produced without a JO; a JO for another product; a cancelled
--              JO; moving more than is there; selling without a sentence; an
--              order line of another product; a reader writing; an opname
--              difference with no reason

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-000000170001','gudang-fg@talaliving.com','{"full_name":"Gudang FG"}'),
  ('ffffffff-0000-0000-0000-000000170002','lihat-fg@talaliving.com','{"full_name":"Lihat FG"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-000000170001','inventory','write'),
  ('ffffffff-0000-0000-0000-000000170002','inventory','read');

insert into ops_prod.products (product_code, name, category, uom) values
  ('FG-CHR','Kursi makan','Kursi','pcs'),
  ('FG-TBL','Meja makan','Meja','pcs');
insert into ops_procure.projects (id, code, name, is_active) values
  ('17000000-0000-0000-0000-0000000000b1','FG-P1','Villa Barang Jadi', true);
insert into ops_procure.project_lines (id, project_id, line_no, product_code, description, qty, uom) values
  ('17000000-0000-0000-0000-0000000000c1','17000000-0000-0000-0000-0000000000b1', 1, 'FG-CHR', 'Kursi makan', 10, 'pcs'),
  ('17000000-0000-0000-0000-0000000000c2','17000000-0000-0000-0000-0000000000b1', 2, 'FG-TBL', 'Meja makan', 2, 'pcs');

insert into ops_prod.work_orders (wo_no, product_code, item_name, qty, uom, route, due_date, project_code, project_line_id, created_by) values
  ('spk-fg-1','FG-CHR','Kursi makan', 10,'pcs','IN_HOUSE', current_date + 5, 'FG-P1',
   '17000000-0000-0000-0000-0000000000c1','ffffffff-0000-0000-0000-000000170001'),
  ('spk-fg-2','FG-TBL','Meja makan', 2,'pcs','IN_HOUSE', current_date + 5, 'FG-P1',
   '17000000-0000-0000-0000-0000000000c2','ffffffff-0000-0000-0000-000000170001'),
  -- made for stock, nobody's order
  ('spk-fg-3','FG-CHR','Kursi stok', 3,'pcs','IN_HOUSE', current_date + 5, null, null,
   'ffffffff-0000-0000-0000-000000170001');
insert into ops_prod.work_orders (wo_no, product_code, item_name, qty, uom, route, due_date, status, cancelled_reason, created_by) values
  ('spk-fg-9','FG-CHR','Kursi batal', 1,'pcs','IN_HOUSE', current_date + 5, 'CANCELLED','dibatalkan klien',
   'ffffffff-0000-0000-0000-000000170001');

-- A delivery made before anybody recorded finished goods: it must not be
-- subtracted from a rack it never added to.
insert into ops_dlv.deliveries (id, delivery_no, project_code, dispatched_on, status, created_at) values
  ('17000000-0000-0000-0000-0000000000d0','krm-fg-old','FG-P1', current_date - 30, 'IN_TRANSIT', now() - interval '30 days');
insert into ops_dlv.delivery_lines (delivery_id, project_line_id, description, qty, uom) values
  ('17000000-0000-0000-0000-0000000000d0','17000000-0000-0000-0000-0000000000c2','Meja lama', 1,'pcs');

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000170001';

do $$
declare r jsonb;
begin
  /* REFUSALS on produced */
  r := ops_inv.move_product('FG-CHR','produced', 5,'GUDANG');
  assert r->'error'->>'code' = 'wo_required', 'no JO, got ' || r::text;
  r := ops_inv.move_product('FG-TBL','produced', 1,'GUDANG', p_wo_no => 'spk-fg-1');
  assert r->'error'->>'code' = 'wo_other_product', 'JO makes chairs, got ' || r::text;
  r := ops_inv.move_product('FG-CHR','produced', 1,'GUDANG', p_wo_no => 'spk-fg-9');
  assert r->'error'->>'code' = 'wo_cancelled', 'cancelled JO, got ' || r::text;

  /* twelve chairs made against an order for ten; the line comes from the JO
     even when the form names another */
  r := ops_inv.move_product('FG-CHR','produced', 12,'FINISHING', p_wo_no => 'spk-fg-1',
                            p_project_line_id => '17000000-0000-0000-0000-0000000000c2', p_key => 'fg-k1');
  assert r->>'outcome' = 'ok', 'produced, got ' || r::text;
  assert r->'data'->>'project_line_id' = '17000000-0000-0000-0000-0000000000c1', 'the JO''s line, got ' || r::text;
  -- replay
  r := ops_inv.move_product('FG-CHR','produced', 12,'FINISHING', p_wo_no => 'spk-fg-1', p_key => 'fg-k1');
  assert (select count(*) from ops_inv.product_moves where wo_no = 'spk-fg-1') = 1, 'replayed, not doubled';

  r := ops_inv.move_product('FG-CHR','produced', 3,'GUDANG', p_wo_no => 'spk-fg-3');
  assert r->>'outcome' = 'ok' and r->'data'->>'project_line_id' is null, 'stock for nobody, got ' || r::text;
  r := ops_inv.move_product('FG-TBL','produced', 2,'GUDANG', p_wo_no => 'spk-fg-2');
  assert r->>'outcome' = 'ok', 'tables, got ' || r::text;

  /* transfer: two rows, nets to zero; refused past what is there */
  r := ops_inv.move_product('FG-CHR','transfer', 13,'FINISHING', p_to_location => 'GUDANG',
                            p_project_line_id => '17000000-0000-0000-0000-0000000000c1');
  assert r->'error'->>'code' = 'insufficient', 'only twelve there, got ' || r::text;
  r := ops_inv.move_product('FG-CHR','transfer', 12,'FINISHING', p_to_location => 'GUDANG',
                            p_project_line_id => '17000000-0000-0000-0000-0000000000c1');
  assert r->>'outcome' = 'ok' and r->'data'->>'transfer_in_no' is not null, 'moved, got ' || r::text;

  /* sold needs a sentence and a real line */
  r := ops_inv.move_product('FG-CHR','sold', 1,'GUDANG');
  assert r->'error'->>'code' = 'reason_required', 'sold says to whom, got ' || r::text;
  r := ops_inv.move_product('FG-CHR','sold', 1,'GUDANG', p_project_line_id => '17000000-0000-0000-0000-0000000000c2',
                            p_reason => 'x');
  assert r->'error'->>'code' = 'line_other_product', 'tables line, got ' || r::text;
  r := ops_inv.move_product('FG-CHR','sold', 1,'GUDANG', p_reason => 'Dijual ke showroom');
  assert r->>'outcome' = 'ok', 'one stock chair sold, got ' || r::text;

  /* opname: difference stored, reason required */
  r := ops_inv.count_product('FG-CHR','GUDANG', 1, null);
  assert r->'error'->>'code' = 'reason_required', 'difference says why, got ' || r::text;
  r := ops_inv.count_product('FG-CHR','GUDANG', 2, null);
  assert r->>'outcome' = 'ok' and (r->'data'->>'diff')::numeric = 0, 'matches, writes nothing, got ' || r::text;
  r := ops_inv.count_product('FG-CHR','GUDANG', 1, 'Satu kursi stok patah kaki');
  assert r->>'outcome' = 'ok' and (r->'data'->>'diff')::numeric = -1, 'one short, got ' || r::text;
end $$;

reset role;

-- Six chairs leave for the site; a cancelled delivery of two changes nothing.
insert into ops_dlv.deliveries (id, delivery_no, project_code, dispatched_on, status, cancelled_reason) values
  ('17000000-0000-0000-0000-0000000000d1','krm-fg-1','FG-P1', current_date, 'IN_TRANSIT', null),
  ('17000000-0000-0000-0000-0000000000d2','krm-fg-2','FG-P1', current_date, 'CANCELLED', 'truk rusak');
insert into ops_dlv.delivery_lines (delivery_id, project_line_id, description, qty, uom) values
  ('17000000-0000-0000-0000-0000000000d1','17000000-0000-0000-0000-0000000000c1','Kursi makan', 6,'pcs'),
  ('17000000-0000-0000-0000-0000000000d2','17000000-0000-0000-0000-0000000000c1','Kursi makan', 2,'pcs');

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000170002';

do $$
declare r jsonb; v jsonb;
begin
  r := ops_inv.move_product('FG-CHR','produced', 1,'GUDANG', p_wo_no => 'spk-fg-1');
  assert r->'error'->>'code' = 'not_permitted', 'a reader writes nothing, got ' || r::text;
  r := ops_inv.count_product('FG-CHR','GUDANG', 5, 'x');
  assert r->'error'->>'code' = 'not_permitted', 'nor counts, got ' || r::text;

  r := ops_inv.product_stock('FG-CHR');
  assert r->>'outcome' = 'ok', 'reads, got ' || r::text;
  assert jsonb_array_length(r->'data') = 2, 'order batch + stock batch, got ' || r::text;

  select x into v from jsonb_array_elements(r->'data') x
   where x->>'project_line_id' = '17000000-0000-0000-0000-0000000000c1';
  assert (v->>'ordered')::numeric = 10 and (v->>'produced')::numeric = 12, 'ordered/produced ' || v::text;
  assert (v->>'shipped')::numeric = 6, 'the cancelled delivery is not shipped ' || v::text;
  assert (v->>'on_hand')::numeric = 6, '12 made - 6 shipped ' || v::text;
  assert (v->>'overrun')::numeric = 2, 'two over the order ' || v::text;
  assert (v->>'still_owed')::numeric = 4 and (v->>'surplus')::numeric = 2, 'owed 4, spare 2 ' || v::text;
  assert v->'by_location' = '{"GUDANG": 6}'::jsonb, 'all moved to the gudang ' || v::text;
  assert v->>'project_code' = 'FG-P1' and v->'wo_nos' = '["spk-fg-1"]'::jsonb, 'traceable ' || v::text;

  select x into v from jsonb_array_elements(r->'data') x where x->>'project_line_id' is null;
  assert (v->>'on_hand')::numeric = 1 and (v->>'surplus')::numeric = 1, '3 made - 1 sold - 1 broken ' || v::text;

  r := ops_inv.product_stock('FG-TBL');
  select x into v from jsonb_array_elements(r->'data') x;
  assert (v->>'shipped')::numeric = 0 and (v->>'on_hand')::numeric = 2,
    'the old delivery predates the rack ' || v::text;
end $$;

reset role;

-- somebody without inventory reads an empty rack
insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-000000170003','luar-fg@talaliving.com','{"full_name":"Luar"}');
set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000170003';
do $$
begin
  assert (ops_inv.product_stock('FG-CHR'))->'error'->>'code' = 'not_permitted', 'refused';
  assert not exists (select 1 from ops_inv.product_ledger('FG-CHR')), 'the ledger returns nothing';
  assert not exists (select 1 from ops_inv.product_moves), 'nor the table';
end $$;

rollback;
