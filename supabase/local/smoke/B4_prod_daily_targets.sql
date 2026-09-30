-- prod — daily targets per Job Order, day and stage (0201, D356).
--
--   REFUSALS     somebody with none of production, HRD or leadership; a stage
--                the product does not go through; a negative target; more in
--                a day than the whole order; a day that has already ended; a
--                change without a reason; a closed Job Order; a write round
--                the seam
--   DERIVATIONS  production, HRD and leadership may each set one; the target
--                in force is the latest, the history is kept with who and
--                why; the same target again is a no-op; the view reads the
--                day's actual count beside it

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-0000000b4001','admin-target@talaliving.com','{"full_name":"Admin Produksi"}'),
  ('ffffffff-0000-0000-0000-0000000b4002','hrd-target@talaliving.com','{"full_name":"HRD Target"}'),
  ('ffffffff-0000-0000-0000-0000000b4003','pimpinan-target@talaliving.com','{"full_name":"Pimpinan"}'),
  ('ffffffff-0000-0000-0000-0000000b4004','gudang-target@talaliving.com','{"full_name":"Gudang"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-0000000b4001','production','write'),
  ('ffffffff-0000-0000-0000-0000000b4002','hrd','write'),
  ('ffffffff-0000-0000-0000-0000000b4004','inventory','write');
insert into ops_core.user_authorities (user_id, authority) values
  ('ffffffff-0000-0000-0000-0000000b4003','approve_funds');

insert into ops_prod.products (id, product_code, name, category, uom, stages) values
  ('b4000000-0000-0000-0000-0000000000a1','TG-02','Pintu target','Pintu','pcs', array['AMPLAS','FINISHING','PACKING']);

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-0000000b4001';

do $$
declare r jsonb; jo text; today date := ops_core.office_day(); v jsonb;
begin
  r := ops_prod.create_work_order('Pintu target', 100, 'pcs', today + 30, 'TG-02');
  assert ops_core.said_ok(r), 'jo: ' || r::text;
  jo := r->'data'->>'wo_no';

  /* REFUSALS */
  r := ops_prod.set_daily_target(jo, today, 'MACHINERY', 10);
  assert r->'error'->>'code' = 'stage_not_on_product', 'no lamps in a door: ' || r::text;
  r := ops_prod.set_daily_target(jo, today, 'AMPLAS', -1);
  assert r->'error'->>'code' = 'qty_required', 'negative: ' || r::text;
  r := ops_prod.set_daily_target(jo, today, 'AMPLAS', 101);
  assert r->'error'->>'code' = 'over_order', 'more than the order: ' || r::text;
  r := ops_prod.set_daily_target(jo, today - 1, 'AMPLAS', 10);
  assert r->'error'->>'code' = 'day_passed', 'yesterday: ' || r::text;

  /* DERIVATIONS */
  r := ops_prod.set_daily_target(jo, today, 'AMPLAS', 15);
  assert ops_core.said_ok(r), 'first target, no reason needed: ' || r::text;
  r := ops_prod.set_daily_target(jo, today, 'AMPLAS', 15);
  assert r->>'outcome' = 'noop', 'the same again: ' || r::text;
  r := ops_prod.set_daily_target(jo, today, 'AMPLAS', 12);
  assert r->'error'->>'code' = 'reason_required' and (r->'error'->'detail'->>'current')::numeric = 15,
    'a change says why: ' || r::text;
  r := ops_prod.set_daily_target(jo, today, 'AMPLAS', 12, 'dua orang cuti');
  assert ops_core.said_ok(r) and (r->'data'->>'before')::numeric = 15, 'changed: ' || r::text;
  r := ops_prod.set_daily_target(jo, today + 1, 'AMPLAS', 0);
  assert ops_core.said_ok(r), 'zero is a statement: ' || r::text;

  r := ops_prod.record_progress(jo, 'AMPLAS', 7, today, 'Karjo');
  assert ops_core.said_ok(r), 'progress: ' || r::text;

  select to_jsonb(t) into v from ops_prod.v_daily_target t where t.wo_no = jo and t.work_date = today and t.stage = 'AMPLAS';
  assert (v->>'target')::numeric = 12 and (v->>'actual')::numeric = 7 and (v->>'revisions')::int = 2
     and v->>'reason' = 'dua orang cuti' and v->>'set_by_name' = 'Admin Produksi',
    'target in force beside the day''s count: ' || v::text;
  assert (select count(*) from ops_prod.daily_targets t join ops_prod.work_orders w on w.id = t.wo_id
           where w.wo_no = jo and t.work_date = today) = 2, 'history kept';
end $$;

/* HRD and leadership may set one too */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-0000000b4002';
do $$
declare r jsonb; jo text := (select wo_no from ops_prod.work_orders where product_code = 'TG-02');
begin
  r := ops_prod.set_daily_target(jo, ops_core.office_day(), 'FINISHING', 5);
  assert ops_core.said_ok(r), 'hrd: ' || r::text;
end $$;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-0000000b4003';
do $$
declare r jsonb; jo text := (select wo_no from ops_prod.work_orders where product_code = 'TG-02');
begin
  r := ops_prod.set_daily_target(jo, ops_core.office_day(), 'PACKING', 3);
  assert ops_core.said_ok(r), 'leadership: ' || r::text;
end $$;

/* REFUSAL: the warehouse does not set production targets */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-0000000b4004';
do $$
declare r jsonb; jo text := (select wo_no from ops_prod.work_orders where product_code = 'TG-02');
begin
  r := ops_prod.set_daily_target(jo, ops_core.office_day(), 'PACKING', 9);
  assert r->'error'->>'code' = 'not_permitted', 'warehouse: ' || r::text;
  begin
    insert into ops_prod.daily_targets (wo_id, work_date, stage, qty)
    values ((select id from ops_prod.work_orders where wo_no = jo), ops_core.office_day(), 'PACKING', 9);
    assert false, 'wrote round the seam';
  exception when insufficient_privilege then null;
  end;
end $$;

/* REFUSAL: a closed Job Order */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-0000000b4001';
do $$
declare r jsonb; jo text := (select wo_no from ops_prod.work_orders where product_code = 'TG-02');
begin
  r := ops_prod.close_work_order(jo, 'selesai lebih awal');
  assert ops_core.said_ok(r), 'close: ' || r::text;
  r := ops_prod.set_daily_target(jo, ops_core.office_day() + 2, 'AMPLAS', 10);
  assert r->'error'->>'code' = 'wo_not_open', 'closed: ' || r::text;
end $$;

rollback;
