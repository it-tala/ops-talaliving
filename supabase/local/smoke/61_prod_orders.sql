-- prod — the four stages, the route, and the order that pins to a BOM.
--
--   REFUSALS     an order with no date, which is an order nobody can tell is
--                late; a cancellation with no reason; a pin to a **draft**
--                revision; a pin with no product behind it; no DELETE
--   DERIVATIONS  the stage vocabulary — `QC` rolls into Packing and the
--                retired codes roll into nothing (D275, F74); and which stages
--                an order goes through: the **product's own** where somebody
--                has set them, the route's where nobody has, with the view
--                saying which of the two it is (D278)

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-00000000ee01','joko@talaliving.com','{"full_name":"Joko Widodo"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-00000000ee01','production','write');

-- A dining table, with its own three stages: no lamps or cables in it.
-- And a wardrobe nobody has set up, which is a different fact from "all four".
insert into ops_prod.products (id, product_code, name, category, uom, stages, created_by) values
  ('bbbb0000-0000-0000-0000-0000000000b1','PRD-MJ-220','Meja makan 220','Meja','unit',
   array['AMPLAS','FINISHING','PACKING'],'ffffffff-0000-0000-0000-00000000ee01'),
  ('bbbb0000-0000-0000-0000-0000000000b2','PRD-LM-100','Lemari pakaian','Lemari','unit',
   null,'ffffffff-0000-0000-0000-00000000ee01');

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-00000000ee01';

/* ── DERIVATION: the vocabulary, old codes and all ─────────────────────── */
do $$
declare n int; s text;
begin
  select count(*) into n from ops_prod.process_stages;
  assert n = 4, 'the owner named four (D275), got ' || n;

  -- A stage is a source of itself. Without that, an entry reading FINISHING
  -- could not be told from a rolled-up one and the same pieces counted twice
  -- (F74).
  select stage_code into s from ops_prod.stage_sources where source_code = 'FINISHING';
  assert s = 'FINISHING', 'a stage is a source of itself, got ' || s;

  -- QC is not one of the four, and its entries must not vanish: a stage
  -- leaving the list is not the same as the work never having happened (A5).
  select stage_code into s from ops_prod.stage_sources where source_code = 'QC';
  assert s = 'PACKING', 'QC rolls into the step it always preceded, got ' || s;

  -- Potong, serut and rakit roll into NOTHING. Folding them into Sanding would
  -- claim six pieces were sanded because six were cut.
  select count(*) into n from ops_prod.stage_sources where source_code in ('POTONG','SERUT','RAKIT','PEMBUATAN');
  assert n = 0, 'retired codes are not a roll-up target, got ' || n;
  select count(*) into n from ops_prod.retired_stages;
  assert n = 4, 'but they keep their names so August still reads, got ' || n;
end $$;

/* ── REFUSAL: an order nobody can tell is late ─────────────────────────── */
do $$
begin
  begin
    insert into ops_prod.work_orders (item_name, qty, uom, route, created_by)
    values ('Meja tanpa tanggal', 4,'unit','IN_HOUSE','ffffffff-0000-0000-0000-00000000ee01');
    raise exception 'a work order with no due date should be refused';
  exception when not_null_violation then null;
  end;

  begin
    insert into ops_prod.work_orders (item_name, qty, uom, route, due_date, created_by)
    values ('Meja nol', 0,'unit','IN_HOUSE', current_date + 7,'ffffffff-0000-0000-0000-00000000ee01');
    raise exception 'an order for nothing should be refused';
  exception when check_violation then null;
  end;
end $$;

/* ── REFUSAL: a pin points at a released revision, never a draft ───────── */
do $$
begin
  -- A draft exists, and an order may not pin to it: a draft is still being
  -- edited, so what the order was written against would keep changing.
  insert into ops_prod.bom_revisions (product_id, rev, created_by)
  values ('bbbb0000-0000-0000-0000-0000000000b1', 1,'ffffffff-0000-0000-0000-00000000ee01');

  begin
    insert into ops_prod.work_orders (product_code, item_name, qty, uom, route, due_date, bom_rev, created_by)
    values ('PRD-MJ-220','Meja makan 220', 4,'unit','IN_HOUSE', current_date + 14, 1,
            'ffffffff-0000-0000-0000-00000000ee01');
    raise exception 'pinning to a draft should be refused';
  exception when check_violation then null;
  end;

  -- A pin with no product behind it names a revision of nothing.
  begin
    insert into ops_prod.work_orders (item_name, qty, uom, route, due_date, bom_rev, created_by)
    values ('Meja satuan', 1,'unit','IN_HOUSE', current_date + 14, 1,
            'ffffffff-0000-0000-0000-00000000ee01');
    raise exception 'a pin with no product_code should be refused';
  exception when check_violation then null;
  end;

  update ops_prod.bom_revisions
     set released_at = now(), released_by = 'ffffffff-0000-0000-0000-00000000ee01',
         note = 'rev awal'
   where product_id = 'bbbb0000-0000-0000-0000-0000000000b1';
end $$;

/* ── DERIVATION: which stages this order actually goes through (D278) ──── */
do $$
declare codes text[]; src text; n int;
begin
  -- The table: its product names three, and Machinery is not one of them.
  insert into ops_prod.work_orders (wo_no, product_code, item_name, qty, uom, route, due_date, bom_rev, created_by)
  values ('spk-uji-01','PRD-MJ-220','Meja makan 220', 4,'unit','IN_HOUSE', current_date + 14, 1,
          'ffffffff-0000-0000-0000-00000000ee01');

  select array_agg(stage_code order by seq), min(stages_from) into codes, src
    from ops_prod.v_work_order_stage where wo_no = 'spk-uji-01';
  assert codes = array['AMPLAS','FINISHING','PACKING'],
    'the product names its own, and Machinery is absent rather than empty — got ' || codes::text;
  assert src = 'product', 'and the view says where they came from, got ' || src;

  -- The wardrobe: nobody has set it up. **Null is not "all four"** — it falls
  -- back to the route and says that is what happened.
  insert into ops_prod.work_orders (wo_no, product_code, item_name, qty, uom, route, due_date, created_by)
  values ('spk-uji-02','PRD-LM-100','Lemari pakaian', 2,'unit','SUBCON', current_date + 20,
          'ffffffff-0000-0000-0000-00000000ee01');

  select array_agg(stage_code order by seq), min(stages_from) into codes, src
    from ops_prod.v_work_order_stage where wo_no = 'spk-uji-02';
  assert codes = array['AMPLAS','FINISHING','MACHINERY','PACKING'],
    'the route''s four, got ' || codes::text;
  assert src = 'route', 'and it is named as a fall-back, not as a decision, got ' || src;

  -- A one-off nobody has catalogued: no product at all, so the route again.
  insert into ops_prod.work_orders (wo_no, item_name, qty, uom, route, due_date, created_by)
  values ('spk-uji-03','Rak pesanan khusus', 1,'unit','IN_HOUSE', current_date + 30,
          'ffffffff-0000-0000-0000-00000000ee01');
  select count(*) into n from ops_prod.v_work_order_stage where wo_no = 'spk-uji-03';
  assert n = 4, 'a one-off still has a route, got ' || n;
end $$;

/* ── REFUSAL: cancelling says why, and nothing is deleted ──────────────── */
do $$
declare n int;
begin
  begin
    update ops_prod.work_orders set status = 'CANCELLED' where wo_no = 'spk-uji-03';
    raise exception 'cancelling with no reason should be refused';
  exception when check_violation then null;
  end;

  update ops_prod.work_orders set status = 'CANCELLED', cancelled_reason = 'klien membatalkan'
   where wo_no = 'spk-uji-03';

  begin
    delete from ops_prod.work_orders where wo_no = 'spk-uji-03';
    raise exception 'deleting a work order should be refused — the cancellation is the record';
  exception when insufficient_privilege then null;
  end;
  select count(*) into n from ops_prod.work_orders where wo_no = 'spk-uji-03';
  assert n = 1, 'and it is still there with its reason, got ' || n;
end $$;

rollback;
