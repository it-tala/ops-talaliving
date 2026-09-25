-- inv — a delivery signed for through confirm_receipt puts stock on the rack (0169).
--
-- DERIVATIONS  signing puts the quantity on the item's home rack, priced from
--              the line; a box-bought line lands converted into pieces; a
--              zero-priced line lands unpriced, never free (D172)
-- REFUSALS     (things that must NOT become stock) a WRONG ITEM delivery; an
--              uncounted category; a line whose unit has no conversion; the
--              same receipt stocked twice
-- And the person signing holds procurement only — no inventory grant at all.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-000000002601','anggun@talaliving.com','{"full_name":"Anggun"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-000000002601','procurement','write');

insert into ops_procure.uom (code, name, dimension) values
  ('box-uji','Box (uji)','count'), ('roll-uji','Roll (uji)','count')
  on conflict (code) do nothing;
insert into ops_procure.uom_conversions (from_uom, to_uom, factor) values ('box-uji','pcs', 50);

insert into ops_procure.vendors (id, code, name) values
  ('11110000-0000-0000-0000-000000002601','V-8601','Toko Baut Uji');
insert into ops_procure.items (id, code, name, category_code, base_uom, kind) values
  ('22220000-0000-0000-0000-000000002601','I-8601','Screw 4x30','hardware','pcs','goods'),
  ('22220000-0000-0000-0000-000000002602','I-8602','Office paper','office','pcs','goods'),
  ('22220000-0000-0000-0000-000000002603','I-8603','Grass cutting','service','pcs','service');
insert into ops_inv.stock_settings (item_code, home_location) values ('I-8601','BENGKEL');

insert into ops_procure.pr_documents (id, doc_no, status, requested_by, submitted_at) values
  ('55550000-0000-0000-0000-000000002601','pr-26-09-25_61','SUBMITTED','ffffffff-0000-0000-0000-000000002601', now());
insert into ops_procure.pr_lines (id, doc_id, doc_no, line_no, item_id, description, qty, uom, unit_price, item_total, vendor_id) values
  -- L1 pieces, priced          L2 boxes of 50               L3 no conversion
  ('66660000-0000-0000-0000-000000002601','55550000-0000-0000-0000-000000002601','pr-26-09-25_61',1,
   '22220000-0000-0000-0000-000000002601','Screw 4x30', 200,'pcs', 150, 30000,'11110000-0000-0000-0000-000000002601'),
  ('66660000-0000-0000-0000-000000002602','55550000-0000-0000-0000-000000002601','pr-26-09-25_61',2,
   '22220000-0000-0000-0000-000000002601','Screw 4x30 per box', 2,'box-uji', 5000, 10000,'11110000-0000-0000-0000-000000002601'),
  ('66660000-0000-0000-0000-000000002603','55550000-0000-0000-0000-000000002601','pr-26-09-25_61',3,
   '22220000-0000-0000-0000-000000002601','Screw 4x30 per roll', 1,'roll-uji', 9000, 9000,'11110000-0000-0000-0000-000000002601'),
  -- L4 wrong item              L5 service (not counted)      L6 free sample
  ('66660000-0000-0000-0000-000000002604','55550000-0000-0000-0000-000000002601','pr-26-09-25_61',4,
   '22220000-0000-0000-0000-000000002601','Screw 4x30 — wrong ones', 100,'pcs', 150, 15000,'11110000-0000-0000-0000-000000002601'),
  ('66660000-0000-0000-0000-000000002605','55550000-0000-0000-0000-000000002601','pr-26-09-25_61',5,
   '22220000-0000-0000-0000-000000002603','Grass', 1,'pcs', 100000, 100000,'11110000-0000-0000-0000-000000002601'),
  ('66660000-0000-0000-0000-000000002606','55550000-0000-0000-0000-000000002601','pr-26-09-25_61',6,
   '22220000-0000-0000-0000-000000002601','Screw sample', 10,'pcs', 0, 0,'11110000-0000-0000-0000-000000002601');

insert into ops_procure.receipts (receipt_no, line_id, qty_received, condition, received_by) values
  ('rcv-uji-1','66660000-0000-0000-0000-000000002601',200,'GOOD',       'ffffffff-0000-0000-0000-000000002601'),
  ('rcv-uji-2','66660000-0000-0000-0000-000000002602',  2,'GOOD',       'ffffffff-0000-0000-0000-000000002601'),
  ('rcv-uji-3','66660000-0000-0000-0000-000000002603',  1,'GOOD',       'ffffffff-0000-0000-0000-000000002601'),
  ('rcv-uji-4','66660000-0000-0000-0000-000000002604',100,'WRONG ITEM', 'ffffffff-0000-0000-0000-000000002601'),
  ('rcv-uji-5','66660000-0000-0000-0000-000000002605',  1,'GOOD',       'ffffffff-0000-0000-0000-000000002601'),
  ('rcv-uji-6','66660000-0000-0000-0000-000000002606', 10,'DAMAGED',    'ffffffff-0000-0000-0000-000000002601');

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000002601';

do $$
declare r jsonb; n int;
begin
  foreach n in array array[1,2,3,4,5,6] loop
    r := ops_procure.confirm_receipt('rcv-uji-' || n);
    assert r->>'outcome' = 'ok', 'procurement signs rcv-uji-' || n || ', got ' || r::text;
  end loop;
end $$;

reset role;

do $$
declare m record;
begin
  select * into m from ops_inv.stock_moves where ref_no = 'rcv-uji-1';
  assert m.kind = 'receipt' and m.qty = 200 and m.uom = 'pcs', 'pieces as bought, got ' || m.qty;
  assert m.location = 'BENGKEL', 'the item''s home rack, got ' || m.location;
  assert m.unit_cost = 150, 'priced from the line, got ' || coalesce(m.unit_cost::text,'(null)');
  assert m.moved_by = 'ffffffff-0000-0000-0000-000000002601', 'the signer moved it';

  select * into m from ops_inv.stock_moves where ref_no = 'rcv-uji-2';
  assert m.qty = 100 and m.uom = 'pcs', 'two boxes of fifty, got ' || m.qty || ' ' || m.uom;
  assert m.unit_cost = 100, '5.000 a box is 100 a piece, got ' || m.unit_cost;

  select * into m from ops_inv.stock_moves where ref_no = 'rcv-uji-6';
  assert m.qty = 10 and m.unit_cost is null, 'damaged is in the building; a zero price is unpriced (D172)';

  assert not exists (select 1 from ops_inv.stock_moves where ref_no = 'rcv-uji-3'), 'no conversion, no stock';
  assert not exists (select 1 from ops_inv.stock_moves where ref_no = 'rcv-uji-4'), 'wrong item is not kept';
  assert not exists (select 1 from ops_inv.stock_moves where ref_no = 'rcv-uji-5'), 'a service is not stock';

  assert (select count(*) from ops_core.outbox
           where event_type = 'inventory.receipt.not_stocked' and entity_no like 'rcv-uji-%') = 3,
    'each receipt that stocks nothing says why';

  assert (select on_hand from ops_inv.v_stock_item where item_code = 'I-8601') = 310,
    '200 + 100 + 10 on the rack';
end $$;

-- Confirming twice is refused by the seam; the trigger itself is idempotent
-- too — flipping the status back and forth writes no second move.
update ops_procure.receipts set status = 'REPORTED', confirmed_by = null, confirmed_at = null where receipt_no = 'rcv-uji-1';
update ops_procure.receipts set status = 'CONFIRMED', confirmed_by = 'ffffffff-0000-0000-0000-000000002601',
                                confirmed_at = now() where receipt_no = 'rcv-uji-1';
do $$
begin
  assert (select count(*) from ops_inv.stock_moves where ref_no = 'rcv-uji-1') = 1, 'stocked once';
end $$;

rollback;
