-- procure — what became of a factory order after it arrived (0265, O8,
-- kajian F255 §5.8, D412, D422).
--
-- DERIVATIONS  the work state is read: ORDER_DRAFT, IN_PRODUCTION, SHIPPED
--              (a container, not all arrived), ARRIVED (all arrived), then the
--              client's ACCEPTED or REJECTED; the reminder is the last arrival
--              + 3 months and an undecided order past it needs confirmation;
--              a later decision replaces the last, both kept; a container
--              still at sea is said, not refused; findings before shipping and
--              client claims are counted apart; a project reader sees all of
--              it without reading purchase orders
-- REFUSALS     a decision without project.update; an unknown order, a supplier
--              PO, a cancelled order; nothing arrived yet; an unknown verdict;
--              no day, a day in the future or before the first arrival; no
--              person on the client's side; a rejection without a reason; the
--              same decision again is a noop

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('aaaa0000-0000-0000-0000-0000000d7001','pm-fo@talaliving.com','{"full_name":"PM Hasil"}'),
  ('aaaa0000-0000-0000-0000-0000000d7002','proc-fo@talaliving.com','{"full_name":"Andi Hasil"}'),
  ('aaaa0000-0000-0000-0000-0000000d7003','log-fo@talaliving.com','{"full_name":"Logistik Hasil"}'),
  ('aaaa0000-0000-0000-0000-0000000d7004','view-fo@talaliving.com','{"full_name":"Pembaca Hasil"}'),
  ('aaaa0000-0000-0000-0000-0000000d7005','mkt-fo@talaliving.com','{"full_name":"Rina Hasil"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('aaaa0000-0000-0000-0000-0000000d7001','project','write'),
  ('aaaa0000-0000-0000-0000-0000000d7002','procurement','write'),
  ('aaaa0000-0000-0000-0000-0000000d7003','delivery','write'),
  ('aaaa0000-0000-0000-0000-0000000d7004','project','read'),
  ('aaaa0000-0000-0000-0000-0000000d7005','marketing','write');

insert into ops_procure.clients (id, code, name) values
  ('d7000000-0000-0000-0000-0000000000c1','CL-0997','PT Contoh Hasil');
insert into ops_procure.projects (id, code, name, client_id, status) values
  ('d7000000-0000-0000-0000-0000000000d1','26997','Resort Hasil','d7000000-0000-0000-0000-0000000000c1','IN_PRODUCTION');
insert into ops_procure.vendors (id, code, name, kind) values
  ('d7000000-0000-0000-0000-0000000000f1','V-FO1','PT Pabrik Hasil','factory'),
  ('d7000000-0000-0000-0000-0000000000f2','V-FO2','PT Pabrik Kedua','factory'),
  ('d7000000-0000-0000-0000-0000000000f3','V-FO3','Toko Bahan Hasil','supplier');
insert into ops_procure.project_lines (id, project_id, line_no, description, qty, uom, route) values
  ('d7000000-0000-0000-0000-0000000001a1','d7000000-0000-0000-0000-0000000000d1',1,'Sofa',10,'pcs','FACTORY'),
  ('d7000000-0000-0000-0000-0000000001a2','d7000000-0000-0000-0000-0000000000d1',2,'Table',5,'pcs','FACTORY');
insert into ops_core.attachments (id, storage_path, filename, uploaded_by) values
  ('d7000000-0000-0000-0000-0000000000a1','drive-sj-1','surat-jalan.pdf','aaaa0000-0000-0000-0000-0000000d7003');
set local role authenticated;

do $$
declare r jsonb;
begin
  perform set_config('request.jwt.claim.sub', 'aaaa0000-0000-0000-0000-0000000d7002', true);
  r := ops_procure.create_factory_order('26997', 'V-FO1', '[{"line_no":1,"unit_price":2000000}]');
  assert r->>'outcome' = 'ok', 'factory order 1: ' || r::text;
  perform set_config('test.po1', r->'data'->>'po_no', true);
  r := ops_procure.create_factory_order('26997', 'V-FO2', '[{"line_no":2,"unit_price":900000}]');
  assert r->>'outcome' = 'ok', 'factory order 2: ' || r::text;
  perform set_config('test.po2', r->'data'->>'po_no', true);
  r := ops_procure.create_po('V-FO3', '[{"description":"Lem","qty":1,"uom":"pcs","unit_price":10000}]');
  perform set_config('test.po3', r->'data'->>'po_no', true);
end $$;

-- Order 1 issued, as the factory works only on an issued order; order 2 stays a draft.
reset role;
update ops_procure.purchase_orders
   set status = 'ISSUED', issued_at = now(), issued_by = 'aaaa0000-0000-0000-0000-0000000d7002',
       approved_at = now(), approved_by = 'aaaa0000-0000-0000-0000-0000000d7002'
 where po_no = current_setting('test.po1');
set local role authenticated;

do $$
declare r jsonb; po1 text := current_setting('test.po1'); po2 text := current_setting('test.po2'); po3 text := current_setting('test.po3');
        st text; d1 text; d2 text;
begin
  -- ── the work state, read ────────────────────────────────────────────────
  perform set_config('request.jwt.claim.sub', 'aaaa0000-0000-0000-0000-0000000d7004', true);
  assert (select count(*) from ops_procure.purchase_orders) = 0, 'a project reader reads no purchase orders';
  select string_agg(po_no || ':' || work_state, ' ' order by po_no) into st from ops_procure.factory_outcomes('26997');
  assert st = po1 || ':IN_PRODUCTION ' || po2 || ':ORDER_DRAFT', 'issued and draft, and no supplier PO: ' || coalesce(st, 'none');
  perform set_config('request.jwt.claim.sub', 'aaaa0000-0000-0000-0000-0000000d7005', true);
  assert (select count(*) from ops_procure.factory_outcomes('26997')) = 0, 'marketing alone reads nothing here';

  -- ── refusals before anything arrived ────────────────────────────────────
  r := ops_procure.record_client_verdict(po1, 'ACCEPTED', ops_core.office_day(), 'Ibu Klien');
  assert r->'error'->>'code' = 'not_permitted', 'marketing records no verdict: ' || r::text;
  perform set_config('request.jwt.claim.sub', 'aaaa0000-0000-0000-0000-0000000d7001', true);
  r := ops_procure.record_client_verdict('po-nope', 'ACCEPTED', ops_core.office_day(), 'Ibu Klien');
  assert r->'error'->>'code' = 'order_unknown', 'an order that exists: ' || r::text;
  r := ops_procure.record_client_verdict(po3, 'ACCEPTED', ops_core.office_day(), 'Ibu Klien');
  assert r->'error'->>'code' = 'order_unknown', 'a factory order, not a supplier PO: ' || r::text;
  r := ops_procure.record_client_verdict(po1, 'ACCEPTED', ops_core.office_day(), 'Ibu Klien');
  assert r->'error'->>'code' = 'not_arrived', 'nothing arrived yet: ' || r::text;

  -- ── two containers; one arrives ─────────────────────────────────────────
  perform set_config('request.jwt.claim.sub', 'aaaa0000-0000-0000-0000-0000000d7003', true);
  r := ops_dlv.create_container('26997', ops_core.office_day(), '[{"project_line_id":"d7000000-0000-0000-0000-0000000001a1","qty":6}]',
         'MSKU1234565', null, '40HC', po1);
  assert r->>'outcome' = 'ok', 'container 1: ' || r::text;
  d1 := r->'data'->>'delivery_no';
  r := ops_dlv.create_container('26997', ops_core.office_day(), '[{"project_line_id":"d7000000-0000-0000-0000-0000000001a1","qty":4}]',
         'CSQU3054383', null, '20', po1);
  assert r->>'outcome' = 'ok', 'container 2: ' || r::text;
  d2 := r->'data'->>'delivery_no';
  perform set_config('test.d2', d2, true);
  perform set_config('request.jwt.claim.sub', 'aaaa0000-0000-0000-0000-0000000d7004', true);
  assert (select work_state || '/' || container_count || '/' || containers_arrived from ops_procure.factory_outcomes('26997') where po_no = po1)
         = 'SHIPPED/2/0', 'shipped, nothing arrived';
  perform set_config('request.jwt.claim.sub', 'aaaa0000-0000-0000-0000-0000000d7003', true);
  r := ops_dlv.mark_arrived(d1, 'Pak Site', 'd7000000-0000-0000-0000-0000000000a1');
  assert r->>'outcome' = 'ok', 'container 1 arrived: ' || r::text;
  perform set_config('request.jwt.claim.sub', 'aaaa0000-0000-0000-0000-0000000d7004', true);
  assert (select work_state || '/' || containers_arrived || '/' || coalesce(last_arrived_on::text, '-') from ops_procure.factory_outcomes('26997') where po_no = po1)
         = 'SHIPPED/1/-', 'one of two arrived: still shipped, no reminder yet';

  -- ── the decision ────────────────────────────────────────────────────────
  perform set_config('request.jwt.claim.sub', 'aaaa0000-0000-0000-0000-0000000d7001', true);
  r := ops_procure.record_client_verdict(po1, 'MAYBE', ops_core.office_day(), 'Ibu Klien');
  assert r->'error'->>'code' = 'unknown_verdict', 'accepted or rejected: ' || r::text;
  r := ops_procure.record_client_verdict(po1, 'ACCEPTED', null, 'Ibu Klien');
  assert r->'error'->>'code' = 'date_required', 'a day: ' || r::text;
  r := ops_procure.record_client_verdict(po1, 'ACCEPTED', ops_core.office_day() + 1, 'Ibu Klien');
  assert r->'error'->>'code' = 'date_in_future', 'not tomorrow: ' || r::text;
  r := ops_procure.record_client_verdict(po1, 'ACCEPTED', ops_core.office_day() - 1, 'Ibu Klien');
  assert r->'error'->>'code' = 'before_arrival', 'not before it arrived: ' || r::text;
  r := ops_procure.record_client_verdict(po1, 'ACCEPTED', ops_core.office_day(), ' ');
  assert r->'error'->>'code' = 'client_person_required', 'who on their side: ' || r::text;
  r := ops_procure.record_client_verdict(po1, 'REJECTED', ops_core.office_day(), 'Ibu Klien');
  assert r->'error'->>'code' = 'reason_required', 'why rejected: ' || r::text;
  assert (select count(*) from ops_procure.factory_order_verdicts) = 0, 'nothing written by a refusal';

  r := ops_procure.record_client_verdict(po1, 'REJECTED', ops_core.office_day(), 'Ibu Klien', 'Finishing kusam di 3 sofa');
  assert r->>'outcome' = 'ok' and jsonb_array_length(r->'data'->'warnings') = 1, 'rejected, one container still at sea is said: ' || r::text;
  r := ops_procure.record_client_verdict(po1, 'REJECTED', ops_core.office_day(), 'Ibu Klien', 'Finishing kusam di 3 sofa');
  assert r->>'outcome' = 'noop', 'the same decision again: ' || r::text;

  -- A claim after arrival, and a finding before it, counted apart.
  r := ops_qc.raise_qc_finding(po1, 'after_arrival', 'defect', 'major', 'Klien: finishing kusam di 3 sofa');
  assert r->>'outcome' = 'ok', 'the project manager records the claim: ' || r::text;
  r := ops_qc.raise_qc_finding(po1, 'production', 'packing', 'minor', 'Plastik tipis');
  assert r->'error'->>'code' = 'not_permitted', 'but not a production finding: ' || r::text;

  r := ops_procure.record_client_verdict(po1, 'ACCEPTED', ops_core.office_day(), 'Ibu Klien', null, 'Diterima setelah finishing diulang');
  assert r->>'outcome' = 'ok' and r->'data'->>'warnings' like '%Menggantikan keputusan sebelumnya%', 'a later decision replaces, and says so: ' || r::text;

  perform set_config('request.jwt.claim.sub', 'aaaa0000-0000-0000-0000-0000000d7004', true);
  assert (select work_state || '/' || verdict_client_person || '/' || verdict_recorded_by || '/' || claims_total || '/' || claims_open || '/' || findings_before
            from ops_procure.factory_outcomes('26997') where po_no = po1)
         = 'ACCEPTED/Ibu Klien/PM Hasil/1/1/0', 'the decision, who recorded it, the claim counted apart';
  assert (select string_agg(verdict, ' ') from ops_procure.factory_verdict_history(po1)) = 'ACCEPTED REJECTED',
    'both decisions kept';
end $$;

-- The second container arrived four months ago — as if the decision above
-- were still to come for a second order. Rewound in time as the owner.
reset role;
update ops_dlv.deliveries set status = 'ARRIVED', received_by = 'Pak Site', received_at = now() - interval '4 months',
       surat_jalan_attachment_id = 'd7000000-0000-0000-0000-0000000000a1'
 where delivery_no = current_setting('test.d2');
update ops_dlv.deliveries set received_at = now() - interval '4 months' where po_id = (select id from ops_procure.purchase_orders where po_no = current_setting('test.po1'));
delete from ops_procure.factory_order_verdicts;
set local role authenticated;

do $$
declare po1 text := current_setting('test.po1');
begin
  perform set_config('request.jwt.claim.sub', 'aaaa0000-0000-0000-0000-0000000d7004', true);
  assert (select work_state || '/' || containers_arrived || '/' || needs_confirmation
            from ops_procure.factory_outcomes('26997') where po_no = po1) = 'ARRIVED/2/true',
    'all arrived four months ago, undecided: needs confirmation';
  assert (select reminder_on = (last_arrived_on + interval '3 months')::date and days_to_reminder < 0
            from ops_procure.factory_outcomes('26997') where po_no = po1), 'the reminder is three months after the last arrival';
  assert (select count(*) from ops_procure.factory_outcomes(null) where needs_confirmation) >= 1, 'listed across projects';
end $$;

rollback;
