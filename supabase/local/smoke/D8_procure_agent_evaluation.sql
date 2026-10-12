-- procure — the evaluation boards: factories, QC people, projects (0266, O9,
-- kajian F255 §5.9).
--
-- DERIVATIONS  a factory's orders this year, its price ordered against its
--              own quoted price (+10%), shipped against its promise (first
--              container 3 days late), findings per container before shipping,
--              claims after arrival, orders rejected; a QC's days with a report
--              out of days on the job, containers out while watching, findings
--              raised, claims that reached the client on their orders; a
--              project's stage durations from the logged moves and deliveries
-- ACCESS       prices only for procurement and project.update; QC only for
--              those who see every assignment; projects for project readers,
--              margin only with project.update; marketing alone sees none

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('aaaa0000-0000-0000-0000-0000000d8001','proc-ev@talaliving.com','{"full_name":"Andi Evaluasi"}'),
  ('aaaa0000-0000-0000-0000-0000000d8002','pm-ev@talaliving.com','{"full_name":"PM Evaluasi"}'),
  ('aaaa0000-0000-0000-0000-0000000d8003','read-ev@talaliving.com','{"full_name":"Pembaca Evaluasi"}'),
  ('aaaa0000-0000-0000-0000-0000000d8004','koord-ev@talaliving.com','{"full_name":"Koordinator Evaluasi"}'),
  ('aaaa0000-0000-0000-0000-0000000d8005','yudi-ev@gmail.com','{"full_name":"Yudi Evaluasi"}'),
  ('aaaa0000-0000-0000-0000-0000000d8006','log-ev@talaliving.com','{"full_name":"Logistik Evaluasi"}'),
  ('aaaa0000-0000-0000-0000-0000000d8007','mkt-ev@talaliving.com','{"full_name":"Rina Evaluasi"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('aaaa0000-0000-0000-0000-0000000d8001','procurement','write'),
  ('aaaa0000-0000-0000-0000-0000000d8002','project','write'),
  ('aaaa0000-0000-0000-0000-0000000d8003','project','read'),
  ('aaaa0000-0000-0000-0000-0000000d8004','qc','admin'),
  ('aaaa0000-0000-0000-0000-0000000d8006','delivery','write'),
  ('aaaa0000-0000-0000-0000-0000000d8007','marketing','write');

insert into ops_procure.clients (id, code, name) values
  ('d8000000-0000-0000-0000-0000000000c1','CL-0998','PT Contoh Evaluasi');
insert into ops_procure.projects (id, code, name, client_id, status, created_at) values
  ('d8000000-0000-0000-0000-0000000000d1','26998','Resort Evaluasi','d8000000-0000-0000-0000-0000000000c1','IN_PRODUCTION',
   now() - interval '60 days');
insert into ops_procure.project_status_log (project_id, from_status, to_status, changed_at) values
  ('d8000000-0000-0000-0000-0000000000d1','QUOTATION_SENT','DEAL', now() - interval '50 days'),
  ('d8000000-0000-0000-0000-0000000000d1','DEAL','IN_PRODUCTION', now() - interval '40 days');
insert into ops_procure.vendors (id, code, name, kind) values
  ('d8000000-0000-0000-0000-0000000000f1','V-EV1','PT Pabrik Evaluasi','factory');
insert into ops_core.attachments (id, storage_path, filename, uploaded_by) values
  ('d8000000-0000-0000-0000-0000000000a1','drive-sj-ev','surat-jalan.pdf','aaaa0000-0000-0000-0000-0000000d8006');

set local role authenticated;
set local request.jwt.claim.sub = 'aaaa0000-0000-0000-0000-0000000d8002';
do $$
begin
  perform ops_procure.save_design_collection('26998', 'A', 'Villa');
  perform ops_procure.save_design_room('26998', 'A', 'LR', 'Living room');
  perform ops_procure.save_design_item('26998', 'A', 'LR', 'Sofa', 10, 'tala');
end $$;
reset role;

insert into ops_procure.project_lines (id, project_id, line_no, description, qty, uom, route, design_item_id) values
  ('d8000000-0000-0000-0000-0000000001a1','d8000000-0000-0000-0000-0000000000d1',1,'Sofa',10,'pcs','FACTORY',
   (select di.id from ops_procure.design_items di
      join ops_procure.design_rooms dr on dr.id = di.room_id
      join ops_procure.design_collections dc on dc.id = dr.collection_id
     where dc.project_id = 'd8000000-0000-0000-0000-0000000000d1' limit 1)),
  ('d8000000-0000-0000-0000-0000000001a2','d8000000-0000-0000-0000-0000000000d1',2,'Table',5,'pcs','FACTORY',null);
-- The factory quoted Rp 2.000.000 for the sofa.
insert into ops_procure.factory_quotes (id, fq_no, project_id, vendor_id, currency, quoted_on) values
  ('d8000000-0000-0000-0000-0000000000e1','fq-ev-1','d8000000-0000-0000-0000-0000000000d1','d8000000-0000-0000-0000-0000000000f1','IDR', current_date - 45);
insert into ops_procure.factory_quote_lines (quote_id, design_item_id, unit_price) values
  ('d8000000-0000-0000-0000-0000000000e1',
   (select design_item_id from ops_procure.project_lines where id = 'd8000000-0000-0000-0000-0000000001a1'), 2000000);
set local role authenticated;

-- Ordered at Rp 2.200.000: ten per cent over the quote.
do $$
declare r jsonb;
begin
  perform set_config('request.jwt.claim.sub', 'aaaa0000-0000-0000-0000-0000000d8001', true);
  r := ops_procure.create_factory_order('26998', 'V-EV1', '[{"line_no":1,"unit_price":2200000},{"line_no":2,"unit_price":900000}]');
  assert r->>'outcome' = 'ok', 'factory order: ' || r::text;
  perform set_config('test.po', r->'data'->>'po_no', true);
end $$;

-- Issued thirty days ago, promised five days ago.
reset role;
update ops_procure.purchase_orders
   set status = 'ISSUED', issued_at = now() - interval '30 days', issued_by = 'aaaa0000-0000-0000-0000-0000000d8001',
       approved_at = now() - interval '30 days', approved_by = 'aaaa0000-0000-0000-0000-0000000d8001',
       expected_delivery = ops_core.office_day() - 5
 where po_no = current_setting('test.po');
set local role authenticated;

do $$
declare r jsonb; po text := current_setting('test.po'); asg text; d1 text; d2 text;
begin
  -- ── QC on the order ─────────────────────────────────────────────────────
  perform set_config('request.jwt.claim.sub', 'aaaa0000-0000-0000-0000-0000000d8004', true);
  r := ops_qc.save_qc_person(null, 'Yudi Evaluasi', null, 'Jepara', null, 'yudi-ev@gmail.com');
  r := ops_qc.assign_qc(r->'data'->>'code', po, ops_core.office_day() - 20);
  assert r->>'outcome' = 'ok', 'assigned: ' || r::text;
  asg := r->'data'->>'assign_no';

  perform set_config('request.jwt.claim.sub', 'aaaa0000-0000-0000-0000-0000000d8005', true);
  r := ops_qc.submit_qc_report(asg, ops_core.office_day() - 10, 'construction', '[{"line_no":1,"passed":5}]');
  assert r->>'outcome' = 'ok', 'report 1: ' || r::text;
  r := ops_qc.submit_qc_report(asg, ops_core.office_day() - 3, 'packing', '[{"line_no":1,"passed":10},{"line_no":2,"passed":5}]');
  assert r->>'outcome' = 'ok', 'report 2: ' || r::text;
  r := ops_qc.raise_qc_finding(po, 'production', 'defect', 'major', 'Retak di kaki sofa', 1);
  assert r->>'outcome' = 'ok', 'finding: ' || r::text;

  -- ── two containers, three days past the promise; both arrive ────────────
  perform set_config('request.jwt.claim.sub', 'aaaa0000-0000-0000-0000-0000000d8006', true);
  r := ops_dlv.create_container('26998', ops_core.office_day() - 2, '[{"project_line_id":"d8000000-0000-0000-0000-0000000001a1","qty":6}]',
         'MSKU1234565', null, '40HC', po);
  assert r->>'outcome' = 'ok', 'container 1: ' || r::text;
  d1 := r->'data'->>'delivery_no';
  r := ops_dlv.create_container('26998', ops_core.office_day() - 1, '[{"project_line_id":"d8000000-0000-0000-0000-0000000001a1","qty":4}]',
         'CSQU3054383', null, '20', po);
  assert r->>'outcome' = 'ok', 'container 2: ' || r::text;
  d2 := r->'data'->>'delivery_no';
  r := ops_dlv.mark_arrived(d1, 'Pak Site', 'd8000000-0000-0000-0000-0000000000a1');
  r := ops_dlv.mark_arrived(d2, 'Pak Site', 'd8000000-0000-0000-0000-0000000000a1');
  assert r->>'outcome' = 'ok', 'arrived: ' || r::text;

  -- ── the client's claim and decision ─────────────────────────────────────
  perform set_config('request.jwt.claim.sub', 'aaaa0000-0000-0000-0000-0000000d8002', true);
  r := ops_qc.raise_qc_finding(po, 'after_arrival', 'damaged', 'major', 'Klien: dua meja tergores');
  assert r->>'outcome' = 'ok', 'claim: ' || r::text;
  r := ops_procure.record_client_verdict(po, 'REJECTED', ops_core.office_day(), 'Ibu Klien', 'Meja tergores');
  assert r->>'outcome' = 'ok', 'rejected: ' || r::text;
end $$;

do $$
declare st text; yr int := extract(year from ops_core.office_day(now() - interval '30 days'))::int;
begin
  -- ── who sees which board ────────────────────────────────────────────────
  perform set_config('request.jwt.claim.sub', 'aaaa0000-0000-0000-0000-0000000d8007', true);
  assert (select count(*) from ops_procure.eval_factories()) = 0
     and (select count(*) from ops_procure.eval_qc_people()) = 0
     and (select count(*) from ops_procure.eval_projects()) = 0, 'marketing alone sees no board';
  perform set_config('request.jwt.claim.sub', 'aaaa0000-0000-0000-0000-0000000d8003', true);
  assert (select count(*) from ops_procure.eval_factories()) = 0, 'a project reader sees no prices';
  assert (select count(*) from ops_procure.eval_qc_people()) = 0, 'nor the QC board';

  -- ── the project ─────────────────────────────────────────────────────────
  select concat_ws('/', days_to_deal, days_to_production, days_to_ship, days_to_arrive, factory_orders, orders_rejected, claims,
                   coalesce(margin_pct::text, '-'))
    into st from ops_procure.eval_projects() where project_code = '26998';
  assert st = '10/10/38/2/1/1/1/-', 'stages, decisions, claims; no margin for a reader: ' || coalesce(st, 'none');
  assert (select shipped_on = ops_core.office_day() - 2 and arrived_on = ops_core.office_day()
            from ops_procure.eval_projects() where project_code = '26998'), 'first shipped, all arrived';

  -- ── the factory ─────────────────────────────────────────────────────────
  perform set_config('request.jwt.claim.sub', 'aaaa0000-0000-0000-0000-0000000d8001', true);
  select concat_ws('/', orders, orders_in_year, priced_lines, price_diff_pct, promised_shipped, shipped_on_time, avg_days_late,
                   containers, findings_before, findings_serious, findings_per_container, claims, orders_accepted, orders_rejected)
    into st from ops_procure.eval_factories(yr) where vendor_code = 'V-EV1';
  assert st = '1/1/1/10.0/1/0/3.0/2/1/1/0.50/1/0/1',
    'orders, +10% over the quote, 3 days late, findings per container, claim, rejected: ' || coalesce(st, 'none');
  assert (select orders_in_year from ops_procure.eval_factories(yr - 1) where vendor_code = 'V-EV1') = 0, 'none the year before';
  assert (select count(*) from ops_procure.eval_qc_people()) >= 1, 'procurement sees every assignment, so the QC board too';

  -- ── the QC person ───────────────────────────────────────────────────────
  perform set_config('request.jwt.claim.sub', 'aaaa0000-0000-0000-0000-0000000d8004', true);
  select concat_ws('/', assignments, orders, active_days, report_days, report_rate, reports, last_report_on = ops_core.office_day() - 3,
                   containers_while_watching, findings_raised, findings_serious, claims_on_orders, orders_accepted, orders_rejected)
    into st from ops_procure.eval_qc_people() where person_name = 'Yudi Evaluasi';
  assert st = '1/1/21/2/10/2/t/2/1/1/1/0/1',
    'days on the job vs days reported, containers while watching, findings, the claim that got through: ' || coalesce(st, 'none');

  -- ── whoever runs the project ────────────────────────────────────────────
  perform set_config('request.jwt.claim.sub', 'aaaa0000-0000-0000-0000-0000000d8002', true);
  assert (select count(*) from ops_procure.eval_factories() where vendor_code = 'V-EV1') = 1, 'project.update sees the factory board';
  assert (select margin_pct from ops_procure.eval_projects() where project_code = '26998') is null,
    'no accepted quotation, no margin — not a guess';
end $$;

rollback;
