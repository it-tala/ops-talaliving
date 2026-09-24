-- prod — the Job Order and its seams (0130).
--
--   REFUSALS     a Job Order with no date; an unknown product; a stage the
--                product does not go through; more of a stage than the order
--                holds; a correction with no reason; reporting on goods that
--                are all at the vendor; sending more than the order; closing
--                short without a reason; moving the BOM once work is reported;
--                deleting an order line the workshop is building; somebody
--                without production access
--   DERIVATIONS  jo- numbers; a Job Order from an order line takes the line's
--                product, name, unit and project, pins the released BOM, and
--                moves a DEAL project to IN_PRODUCTION with a log row; the
--                order line counts its Job Orders and what is finished; a
--                signed sheet posted twice is a no-op; a leg back short

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-0000000a0001','mandor-jo@talaliving.com','{"full_name":"Mandor JO"}'),
  ('ffffffff-0000-0000-0000-0000000a0002','luar-jo@talaliving.com','{"full_name":"Orang Luar"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-0000000a0001','production','write'),
  ('ffffffff-0000-0000-0000-0000000a0001','project','write'),
  ('ffffffff-0000-0000-0000-0000000a0001','inventory','write'),
  ('ffffffff-0000-0000-0000-0000000a0002','inventory','write');

insert into ops_procure.items (code, name, category_code, base_uom) values
  ('JO-LEM','Lem kayu JO','hardware','pcs');
insert into ops_procure.vendors (id, code, name) values
  ('0a000000-0000-0000-0000-000000000001','V-JO1','Jok Pak Made');

-- A chair with a released BOM (rev 1), and only three stages: no lamps in it.
insert into ops_prod.products (id, product_code, name, category, uom, stages) values
  ('0a000000-0000-0000-0000-0000000000a1','JO-CHAIR','Kursi makan jati','Kursi','pcs',
   array['AMPLAS','FINISHING','PACKING']);
insert into ops_prod.bom_revisions (product_id, rev, released_at, released_by, note) values
  ('0a000000-0000-0000-0000-0000000000a1', 1, now(), 'ffffffff-0000-0000-0000-0000000a0001', 'rilis pertama');

insert into ops_procure.projects (id, code, name, is_active, status) values
  ('0a000000-0000-0000-0000-0000000000b1','JO-P1','Villa JO', true, 'DEAL');
insert into ops_procure.project_lines (id, project_id, line_no, product_code, description, qty, uom) values
  ('0a000000-0000-0000-0000-0000000000c1','0a000000-0000-0000-0000-0000000000b1', 1,
   'JO-CHAIR', 'Kursi makan jati', 6, 'pcs');

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-0000000a0001';

do $$
declare r jsonb; jo text; jo2 text; leg text; v jsonb;
begin
  /* REFUSALS at creation */
  r := ops_prod.create_work_order('Kursi', 2, 'pcs', null);
  assert r->'error'->>'code' = 'due_date_required', 'no date: ' || r::text;
  r := ops_prod.create_work_order('Kursi', 2, 'pcs', current_date + 10, 'NOPE-1');
  assert r->'error'->>'code' = 'product_not_found', 'unknown product: ' || r::text;

  /* DERIVATION: from the order line */
  r := ops_prod.create_work_order(null, 6, null, current_date + 14,
         p_project_line_id => '0a000000-0000-0000-0000-0000000000c1', p_key => 'jo-smoke-1');
  assert ops_core.said_ok(r), 'from line: ' || r::text;
  jo := r->'data'->>'wo_no';
  assert jo like 'jo-%', 'jo number, got ' || jo;
  assert (r->'data'->>'project_moved')::boolean, 'project moved';
  assert (select product_code || '|' || item_name || '|' || uom || '|' || project_code || '|' || bom_rev
            from ops_prod.work_orders where wo_no = jo) = 'JO-CHAIR|Kursi makan jati|pcs|JO-P1|1',
    'line filled the order';
  assert (select status from ops_procure.projects where code = 'JO-P1') = 'IN_PRODUCTION', 'deal → in production';
  assert exists (select 1 from ops_procure.project_status_log l join ops_procure.projects p on p.id = l.project_id
                  where p.code = 'JO-P1' and l.reason like 'Job Order %'), 'move logged';

  /* the same tap twice is the same Job Order */
  r := ops_prod.create_work_order(null, 6, null, current_date + 14,
         p_project_line_id => '0a000000-0000-0000-0000-0000000000c1', p_key => 'jo-smoke-1');
  assert r->'data'->>'wo_no' = jo, 'replayed';
  assert (select count(*) from ops_prod.work_orders where project_line_id = '0a000000-0000-0000-0000-0000000000c1') = 1,
    'one Job Order';

  /* progress */
  r := ops_prod.record_progress(jo, 'MACHINERY', 1, current_date);
  assert r->'error'->>'code' = 'stage_not_on_product', 'machinery on a chair: ' || r::text;
  r := ops_prod.record_progress(jo, 'POTONG', 1, current_date);
  assert r->'error'->>'code' = 'unknown_stage' and (r->'error'->'detail'->>'retired')::boolean, 'retired stage: ' || r::text;
  r := ops_prod.record_progress(jo, 'AMPLAS', 6, current_date, 'Wayan');
  assert ops_core.said_ok(r), 'amplas: ' || r::text;
  r := ops_prod.record_progress(jo, 'AMPLAS', 1, current_date);
  assert r->'error'->>'code' = 'over_order', 'seven of six: ' || r::text;
  r := ops_prod.record_progress(jo, 'AMPLAS', -1, current_date);
  assert r->'error'->>'code' = 'reason_required', 'silent correction: ' || r::text;
  r := ops_prod.record_progress(jo, 'FINISHING', 4, current_date, p_source => 'overtime_sheet', p_source_ref => 'lbr-1');
  assert ops_core.said_ok(r), 'sheet: ' || r::text;
  r := ops_prod.record_progress(jo, 'FINISHING', 4, current_date, p_source => 'overtime_sheet', p_source_ref => 'lbr-1');
  assert r->>'outcome' = 'noop', 'sheet twice: ' || r::text;
  r := ops_prod.record_progress(jo, 'PACKING', 4, current_date);
  assert ops_core.said_ok(r), 'packing: ' || r::text;

  /* DERIVATION: the order line counts it */
  select to_jsonb(x) into v from ops_procure.v_project_line x where id = '0a000000-0000-0000-0000-0000000000c1';
  assert (v->>'job_order_count')::int = 1 and (v->>'job_order_qty')::numeric = 6
     and (v->>'job_order_completed')::numeric = 4 and (v->>'job_order_open')::int = 1,
    'line rollup: ' || v::text;

  /* REFUSAL: the BOM cannot move under work already reported */
  insert into ops_prod.bom_revisions (product_id, rev, released_at, released_by, note)
  values ('0a000000-0000-0000-0000-0000000000a1', 2, now(), 'ffffffff-0000-0000-0000-0000000a0001', 'kaki diganti');
  r := ops_prod.repin_bom(jo, 'ikut rev baru');
  assert r->'error'->>'code' = 'already_started', 'repin after work: ' || r::text;

  /* REFUSAL: closing short says why */
  r := ops_prod.close_work_order(jo);
  assert r->'error'->>'code' = 'reason_required', 'close short: ' || r::text;
  r := ops_prod.close_work_order(jo, 'klien ambil 4 dulu');
  assert ops_core.said_ok(r), 'close: ' || r::text;
  r := ops_prod.record_progress(jo, 'PACKING', 1, current_date);
  assert r->'error'->>'code' = 'wo_not_open', 'closed: ' || r::text;

  /* material out, in one piece */
  r := ops_inv.issue_for_work_order(jo, 'GUDANG', '[{"item_code":"JO-LEM","qty":2},{"item_code":"NOPE","qty":1}]');
  assert r->'error'->>'code' = 'not_stocked', 'half a trip: ' || r::text;
  assert not exists (select 1 from ops_inv.stock_moves where ref_no = jo), 'nothing written';
  r := ops_inv.issue_for_work_order(jo, 'GUDANG', '[{"item_code":"JO-LEM","qty":2},{"item_code":"JO-LEM","qty":0}]');
  assert ops_core.said_ok(r) and (r->'data'->>'issued')::int = 1
     and jsonb_array_length(r->'data'->'negative') = 1, 'issued, below zero flagged: ' || r::text;

  /* REFUSAL: the line has a Job Order behind it */
  r := ops_procure.remove_project_line('JO-P1', '0a000000-0000-0000-0000-0000000000c1');
  assert r->'error'->>'code' = 'has_job_orders', 'remove built line: ' || r::text;

  /* a subcontracted one: all at the vendor, then back short */
  r := ops_prod.create_work_order('Kursi jok', 3, 'pcs', current_date + 7, 'JO-CHAIR', p_route => 'SUBCON');
  assert ops_core.said_ok(r), 'subcon: ' || r::text;
  jo2 := r->'data'->>'wo_no';
  assert (select bom_rev from ops_prod.work_orders where wo_no = jo2) = 2, 'pins the newest released';
  r := ops_prod.send_to_vendor(jo2, 'V-JO1', 'JOK', 4);
  assert r->'error'->>'code' = 'over_order', 'send four of three: ' || r::text;
  r := ops_prod.send_to_vendor(jo2, '0a000000-0000-0000-0000-000000000001', 'JOK', 3, current_date + 3);
  assert ops_core.said_ok(r), 'send by id: ' || r::text;
  leg := r->'data'->>'leg_no';
  r := ops_prod.record_progress(jo2, 'AMPLAS', 1, current_date);
  assert r->'error'->>'code' = 'still_at_vendor', 'all away: ' || r::text;
  r := ops_prod.receive_from_vendor(leg, 2);
  assert ops_core.said_ok(r) and (r->'data'->>'short_by')::numeric = 1, 'back short: ' || r::text;
  r := ops_prod.record_progress(jo2, 'AMPLAS', 2, current_date);
  assert ops_core.said_ok(r), 'two on the bench: ' || r::text;
  assert (select on_site_qty from ops_prod.v_work_order where wo_no = jo2) = 2, 'one never came back';
end $$;

/* REFUSAL: no production access */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-0000000a0002';
do $$
declare r jsonb;
begin
  r := ops_prod.create_work_order('Diam-diam', 1, 'pcs', current_date);
  assert r->'error'->>'code' = 'not_permitted', 'outsider create: ' || r::text;
  r := ops_prod.record_progress((select wo_no from ops_prod.work_orders limit 1), 'AMPLAS', 1, current_date);
  assert r->'error'->>'code' = 'not_permitted', 'outsider progress: ' || r::text;
end $$;

rollback;
