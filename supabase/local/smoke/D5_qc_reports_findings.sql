-- qc — reports, findings and the loading check from the factory (0262/0263,
-- O7, kajian F255 §5.7, D419).
--
-- DERIVATIONS  a report's passed count is a running count: the latest report
--              is the factory's progress, whichever QC sent it, and the
--              project board reads it as a factory line's `made` (MADE once in
--              full); a withdrawn report stops counting; days without a report
--              on a live assignment; photos uploaded against the assignment
--              land in {CLIENT}/{PROJECT}/QC/{day} and link to the report; a
--              container recorded from a watched order says what QC has not
--              passed and which serious findings are open — and says nothing
--              once all is passed and resolved; a QC sees the findings of the
--              order they watch, their own reports only, never a price
-- REFUSALS     a report by anyone but the assigned QC or the coordinator; on a
--              cancelled assignment; a day in the future or outside the
--              assignment; an unknown stage; a line not on the order, twice,
--              negative, or passed over what was ordered; a container outside
--              loading or from another order; a photo never uploaded;
--              withdrawing without a reason or twice; a finding by somebody
--              not watching the order; a client's claim by a QC; an unknown
--              phase, kind or severity; no description; resolving without
--              saying what was done, or twice

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('aaaa0000-0000-0000-0000-0000000d5001','koord-qr@talaliving.com','{"full_name":"Koordinator QR"}'),
  ('aaaa0000-0000-0000-0000-0000000d5002','yudi-qr@gmail.com','{"full_name":"Yudi QR"}'),
  ('aaaa0000-0000-0000-0000-0000000d5003','sari-qr@gmail.com','{"full_name":"Sari QR"}'),
  ('aaaa0000-0000-0000-0000-0000000d5004','proc-qr@talaliving.com','{"full_name":"Andi QR"}'),
  ('aaaa0000-0000-0000-0000-0000000d5005','log-qr@talaliving.com','{"full_name":"Logistik QR"}'),
  ('aaaa0000-0000-0000-0000-0000000d5006','pm-qr@talaliving.com','{"full_name":"PM QR"}'),
  ('aaaa0000-0000-0000-0000-0000000d5007','dodi-qr@gmail.com','{"full_name":"Dodi QR"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('aaaa0000-0000-0000-0000-0000000d5001','qc','admin'),
  ('aaaa0000-0000-0000-0000-0000000d5004','procurement','write'),
  ('aaaa0000-0000-0000-0000-0000000d5005','delivery','write'),
  ('aaaa0000-0000-0000-0000-0000000d5006','project','write');

insert into ops_procure.clients (id, code, name) values
  ('d5000000-0000-0000-0000-0000000000c1','CL-0992','PT Contoh Laporan');
insert into ops_procure.projects (id, code, name, client_id, status) values
  ('d5000000-0000-0000-0000-0000000000d1','26992','Resort Laporan','d5000000-0000-0000-0000-0000000000c1','IN_PRODUCTION');
insert into ops_procure.vendors (id, code, name, kind) values
  ('d5000000-0000-0000-0000-0000000000f1','V-QR1','PT Pabrik Laporan','factory');
insert into ops_procure.project_lines (id, project_id, line_no, description, qty, uom, route) values
  ('d5000000-0000-0000-0000-0000000001a1','d5000000-0000-0000-0000-0000000000d1',1,'Sofa',10,'pcs','FACTORY'),
  ('d5000000-0000-0000-0000-0000000001a2','d5000000-0000-0000-0000-0000000000d1',2,'Table',5,'pcs','FACTORY');
insert into ops_core.attachments (id, storage_path, filename, uploaded_by) values
  ('d5000000-0000-0000-0000-0000000000a1','drive-qc-1','pabrik-1.jpg','aaaa0000-0000-0000-0000-0000000d5002'),
  ('d5000000-0000-0000-0000-0000000000a2','drive-qc-2','pabrik-2.jpg','aaaa0000-0000-0000-0000-0000000d5002'),
  ('d5000000-0000-0000-0000-0000000000a3','drive-qc-3','retak.jpg','aaaa0000-0000-0000-0000-0000000d5002');
set local role authenticated;

do $$
declare r jsonb;
begin
  perform set_config('request.jwt.claim.sub', 'aaaa0000-0000-0000-0000-0000000d5004', true);
  r := ops_procure.create_factory_order('26992', 'V-QR1',
         '[{"line_no":1,"unit_price":2000000},{"line_no":2,"unit_price":900000}]');
  assert r->>'outcome' = 'ok', 'factory order: ' || r::text;
  perform set_config('test.po', r->'data'->>'po_no', true);
  perform set_config('test.po_id', (select id::text from ops_procure.purchase_orders where po_no = r->'data'->>'po_no'), true);

  perform set_config('request.jwt.claim.sub', 'aaaa0000-0000-0000-0000-0000000d5001', true);
  r := ops_qc.save_qc_person(null, 'Yudi Laporan', null, 'Jepara', null, 'yudi-qr@gmail.com');
  perform set_config('test.yudi', r->'data'->>'code', true);
  r := ops_qc.save_qc_person(null, 'Sari Laporan', null, 'Jepara', null, 'sari-qr@gmail.com');
  perform set_config('test.sari', r->'data'->>'code', true);
  r := ops_qc.save_qc_person(null, 'Dodi Laporan', null, 'Jepara', null, 'dodi-qr@gmail.com');
  perform set_config('test.dodi', r->'data'->>'code', true);
  r := ops_qc.assign_qc(current_setting('test.yudi'), current_setting('test.po'), ops_core.office_day() - 5, ops_core.office_day() + 30);
  assert r->>'outcome' = 'ok', 'Yudi: ' || r::text;
  perform set_config('test.a1', r->'data'->>'assign_no', true);
  r := ops_qc.assign_qc(current_setting('test.sari'), current_setting('test.po'), ops_core.office_day() - 5);
  perform set_config('test.a2', r->'data'->>'assign_no', true);
  r := ops_qc.assign_qc(current_setting('test.dodi'), current_setting('test.po'), ops_core.office_day() - 5);
  perform set_config('test.a3', r->'data'->>'assign_no', true);
  r := ops_qc.cancel_qc_assignment(current_setting('test.a3'), 'Salah orang');
end $$;
-- Issued, as the factory works only on an issued order.
reset role;
update ops_procure.purchase_orders set status = 'ISSUED', issued_at = now(), issued_by = 'aaaa0000-0000-0000-0000-0000000d5004',
       approved_at = now(), approved_by = 'aaaa0000-0000-0000-0000-0000000d5004' where id = current_setting('test.po_id')::uuid;
set local role authenticated;

do $$
declare r jsonb; po text := current_setting('test.po'); a1 text := current_setting('test.a1');
        a2 text := current_setting('test.a2'); a3 text := current_setting('test.a3');
        r1 text; r2 text; r3 text; f1 text; f2 text; dno text;
begin
  -- ── where the photos go ─────────────────────────────────────────────────
  assert ops_core.drive_path_for_record('foto_qc', 'qc_assignment', a1)
         = 'CL-0992 PT CONTOH LAPORAN/26992 RESORT LAPORAN/QC/' || to_char(ops_core.office_day(), 'YYYY-MM-DD'),
    'a QC photo is filed with the project, by day: ' || ops_core.drive_path_for_record('foto_qc', 'qc_assignment', a1);

  -- ── who reports ─────────────────────────────────────────────────────────
  perform set_config('request.jwt.claim.sub', 'aaaa0000-0000-0000-0000-0000000d5003', true);
  r := ops_qc.submit_qc_report(a1, ops_core.office_day(), 'construction', '[{"line_no":1,"passed":2}]');
  assert r->'error'->>'code' = 'not_permitted', 'Sari does not report on Yudi''s assignment: ' || r::text;
  perform set_config('request.jwt.claim.sub', 'aaaa0000-0000-0000-0000-0000000d5004', true);
  r := ops_qc.submit_qc_report(a1, ops_core.office_day(), 'construction', '[{"line_no":1,"passed":2}]');
  assert r->'error'->>'code' = 'not_permitted', 'nor procurement: ' || r::text;
  perform set_config('request.jwt.claim.sub', 'aaaa0000-0000-0000-0000-0000000d5001', true);
  r := ops_qc.submit_qc_report(a3, ops_core.office_day(), 'construction', '[]');
  assert r->'error'->>'code' = 'assignment_cancelled', 'not on a cancelled assignment: ' || r::text;

  perform set_config('request.jwt.claim.sub', 'aaaa0000-0000-0000-0000-0000000d5002', true);
  r := ops_qc.submit_qc_report(a1, ops_core.office_day() + 1, 'construction', '[]');
  assert r->'error'->>'code' = 'date_in_future', 'not tomorrow: ' || r::text;
  r := ops_qc.submit_qc_report(a1, ops_core.office_day() - 6, 'construction', '[]');
  assert r->'error'->>'code' = 'outside_assignment', 'not before it started: ' || r::text;
  r := ops_qc.submit_qc_report(a1, ops_core.office_day(), 'painting', '[]');
  assert r->'error'->>'code' = 'unknown_stage', 'a stage it knows: ' || r::text;
  r := ops_qc.submit_qc_report(a1, ops_core.office_day(), 'construction', '[{"line_no":9,"passed":1}]');
  assert r->'error'->>'code' = 'line_not_on_order', 'a line of the order: ' || r::text;
  r := ops_qc.submit_qc_report(a1, ops_core.office_day(), 'construction', '[{"line_no":1,"passed":1},{"line_no":1,"passed":2}]');
  assert r->'error'->>'code' = 'line_twice', 'once: ' || r::text;
  r := ops_qc.submit_qc_report(a1, ops_core.office_day(), 'construction', '[{"line_no":1,"passed":-1}]');
  assert r->'error'->>'code' = 'bad_count', 'not negative: ' || r::text;
  r := ops_qc.submit_qc_report(a1, ops_core.office_day(), 'construction', '[{"line_no":2,"passed":6}]');
  assert r->'error'->>'code' = 'passed_over_ordered', 'not more than ordered: ' || r::text;
  r := ops_qc.submit_qc_report(a1, ops_core.office_day(), 'construction', '[]', null, null,
         array['d5000000-0000-0000-0000-0000000000ff']::uuid[]);
  assert r->'error'->>'code' = 'no_such_file', 'a photo that was uploaded: ' || r::text;
  assert (select count(*) from ops_qc.qc_reports) = 0, 'nothing written by a refusal';

  assert (select days_without_report from ops_qc.v_qc_assignment where assign_no = a1) = 6,
    'six days on the job, no report: ' || (select days_without_report from ops_qc.v_qc_assignment where assign_no = a1);

  -- ── reports, as the factory gets on ─────────────────────────────────────
  r := ops_qc.submit_qc_report(a1, ops_core.office_day() - 2, 'material', '[]', 'Kayu jati sudah datang');
  assert r->>'outcome' = 'ok' and jsonb_array_length(r->'data'->'warnings') = 1, 'photos and a note, no lines — warned, no photo: ' || r::text;
  r1 := r->'data'->>'report_no';
  r := ops_qc.submit_qc_report(a1, ops_core.office_day() - 1, 'construction',
         '[{"line_no":1,"passed":4,"rejected":1},{"line_no":2,"passed":2}]', null, null,
         array['d5000000-0000-0000-0000-0000000000a1','d5000000-0000-0000-0000-0000000000a2']::uuid[]);
  assert r->>'outcome' = 'ok' and jsonb_array_length(r->'data'->'warnings') = 0, 'construction, with photos: ' || r::text;
  r2 := r->'data'->>'report_no';
  assert (select count(*) from ops_core.attachment_links where entity = 'qc_report' and entity_no = r2 and kind = 'foto_qc') = 2,
    'the photos are linked to the report';
  assert (select days_without_report from ops_qc.v_qc_assignment where assign_no = a1) = 1, 'reported yesterday';

  -- Sari, on the same order, counts the same pieces: a running count does not double.
  perform set_config('request.jwt.claim.sub', 'aaaa0000-0000-0000-0000-0000000d5003', true);
  r := ops_qc.submit_qc_report(a2, ops_core.office_day(), 'construction', '[{"line_no":1,"passed":3}]');
  assert r->>'outcome' = 'ok' and r->'data'->'warnings' @> '["Laporan tanpa foto. Foto bisa ditambahkan sesudahnya."]'::jsonb
     and jsonb_array_length(r->'data'->'warnings') = 2, 'fewer than before at the same stage is said: ' || r::text;
  r3 := r->'data'->>'report_no';
  assert (select string_agg(line_no || ':' || coalesce(passed::text, '-') || ':' || rejected_total, ' ' order by line_no)
            from ops_qc.line_progress(current_setting('test.po_id')::uuid)) = '1:3:1 2:2:0',
    'the latest report is the progress: ' || (select string_agg(line_no || ':' || coalesce(passed::text, '-') || ':' || rejected_total, ' ' order by line_no)
            from ops_qc.line_progress(current_setting('test.po_id')::uuid));
  r := ops_qc.cancel_qc_report(r3, ' ');
  assert r->'error'->>'code' = 'reason_required', 'why: ' || r::text;
  r := ops_qc.cancel_qc_report(r3, 'Salah hitung');
  assert r->>'outcome' = 'ok', 'withdrawn: ' || r::text;
  r := ops_qc.cancel_qc_report(r3, 'lagi');
  assert r->'error'->>'code' = 'already_cancelled', 'once: ' || r::text;
  assert (select passed from ops_qc.line_progress(current_setting('test.po_id')::uuid) where line_no = 1) = 4,
    'a withdrawn report stops counting';

  -- What a QC reads: their own reports, the order's findings, never a price.
  assert (select count(*) from ops_qc.v_qc_report) = 1 and (select report_no from ops_qc.v_qc_report) = r3, 'Sari reads her own report only';
  perform set_config('request.jwt.claim.sub', 'aaaa0000-0000-0000-0000-0000000d5002', true);
  assert (select count(*) from ops_qc.v_qc_report) = 2, 'Yudi reads his two';
  assert (select photo_count || '/' || passed_total || '/' || rejected_total from ops_qc.v_qc_report where report_no = r2) = '2/6/1',
    'counts and photos: ' || (select photo_count || '/' || passed_total || '/' || rejected_total from ops_qc.v_qc_report where report_no = r2);
  assert (select string_agg(line_no || ':' || description || ':' || passed, ' ' order by line_no) from ops_qc.report_lines(r2))
         = '1:Sofa:4 2:Table:2', 'the report''s lines, against the order';
  assert (select count(*) from ops_qc.report_lines(r3)) = 0, 'not Sari''s';
  assert (select string_agg(line_no || ':' || passed, ' ' order by line_no) from ops_qc.assignment_progress(a1)) = '1:4 2:2',
    'his order''s progress, by his assignment';
  assert (select count(*) from ops_qc.assignment_progress(a2)) = 0, 'not by Sari''s';
  assert (select count(*) from ops_procure.purchase_orders) = 0, 'and he reads no purchase orders';
  r := ops_qc.add_qc_report_photos(r1, array['d5000000-0000-0000-0000-0000000000a3']::uuid[]);
  assert r->>'outcome' = 'ok', 'a photo added later: ' || r::text;

  -- ── findings ────────────────────────────────────────────────────────────
  perform set_config('request.jwt.claim.sub', 'aaaa0000-0000-0000-0000-0000000d5004', true);
  r := ops_qc.raise_qc_finding(po, 'production', 'defect', 'major', 'Retak');
  assert r->'error'->>'code' = 'not_permitted', 'procurement does not raise findings: ' || r::text;
  perform set_config('request.jwt.claim.sub', 'aaaa0000-0000-0000-0000-0000000d5002', true);
  r := ops_qc.raise_qc_finding(po, 'after_arrival', 'damaged', 'major', 'Klien bilang rusak');
  assert r->'error'->>'code' = 'not_permitted', 'a client''s claim is not a QC''s: ' || r::text;
  r := ops_qc.raise_qc_finding(po, 'shipping', 'defect', 'major', 'Retak');
  assert r->'error'->>'code' = 'unknown_phase', 'a phase: ' || r::text;
  r := ops_qc.raise_qc_finding(po, 'production', 'crack', 'major', 'Retak');
  assert r->'error'->>'code' = 'unknown_kind', 'a kind: ' || r::text;
  r := ops_qc.raise_qc_finding(po, 'production', 'defect', 'huge', 'Retak');
  assert r->'error'->>'code' = 'unknown_severity', 'a severity: ' || r::text;
  r := ops_qc.raise_qc_finding(po, 'production', 'defect', 'major', ' ');
  assert r->'error'->>'code' = 'description_required', 'what: ' || r::text;
  r := ops_qc.raise_qc_finding(po, 'production', 'defect', 'major', 'Retak', 9);
  assert r->'error'->>'code' = 'line_not_on_order', 'a line of the order: ' || r::text;

  r := ops_qc.raise_qc_finding(po, 'production', 'defect', 'major', 'Retak di kaki sofa', 1, r2, null,
         array['d5000000-0000-0000-0000-0000000000a3']::uuid[]);
  assert r->>'outcome' = 'ok', 'Yudi raises a major defect: ' || r::text;
  f1 := r->'data'->>'finding_no';
  r := ops_qc.raise_qc_finding(po, 'production', 'packing', 'minor', 'Plastik tipis');
  f2 := r->'data'->>'finding_no';
  assert (select line_description || '/' || report_no || '/' || raised_by_name || '/' || photo_count from ops_qc.v_qc_finding where finding_no = f1)
         = 'Sofa/' || r2 || '/Yudi Laporan/1', 'the finding names its line, report, finder and photo';
  perform set_config('request.jwt.claim.sub', 'aaaa0000-0000-0000-0000-0000000d5003', true);
  assert (select count(*) from ops_qc.v_qc_finding) = 2, 'Sari, on the same order, sees its findings';
  assert (select open_findings from ops_qc.v_qc_assignment where assign_no = a2) = 2, 'two open on her order';

  -- ── the project board reads QC ──────────────────────────────────────────
  perform set_config('request.jwt.claim.sub', 'aaaa0000-0000-0000-0000-0000000d5006', true);
  assert (select string_agg(line_no || ':' || coalesce(made::text, '-') || ':' || stage || ':' || coalesce(qc_stage, '-') || ':' || qc_open_findings,
                            ' ' order by line_no) from ops_procure.v_project_production where project_code = '26992')
         = '1:4:AT_FACTORY:construction:1 2:2:AT_FACTORY:construction:0',
    'factory progress on the board: ' || (select string_agg(line_no || ':' || coalesce(made::text, '-') || ':' || stage || ':' || coalesce(qc_stage, '-') || ':' || qc_open_findings,
                            ' ' order by line_no) from ops_procure.v_project_production where project_code = '26992');

  -- ── loading: what is not ready is said, not refused ─────────────────────
  perform set_config('request.jwt.claim.sub', 'aaaa0000-0000-0000-0000-0000000d5005', true);
  r := ops_dlv.create_container('26992', ops_core.office_day(), '[{"project_line_id":"d5000000-0000-0000-0000-0000000001a1","qty":4}]',
         'MSKU1234565', null, '40HC', po);
  assert r->>'outcome' = 'ok', 'loaded anyway: ' || r::text;
  assert jsonb_array_length(r->'data'->'warnings') = 2
     and r->'data'->>'warnings' like '%baris 1: 4 dari 10%' and r->'data'->>'warnings' like '%1 temuan QC major/kritis%',
    'not passed in full, a major finding open: ' || r::text;
  dno := r->'data'->>'delivery_no';

  perform set_config('request.jwt.claim.sub', 'aaaa0000-0000-0000-0000-0000000d5002', true);
  r := ops_qc.submit_qc_report(a1, ops_core.office_day(), 'packing', '[]', null, dno);
  assert r->'error'->>'code' = 'container_only_at_loading', 'a container at loading only: ' || r::text;
  r := ops_qc.submit_qc_report(a1, ops_core.office_day(), 'loading', '[]', null, 'krm-nope');
  assert r->'error'->>'code' = 'container_not_this_order', 'a container of this order: ' || r::text;
  assert (select count(*) from ops_qc.order_containers(a1)) = 1, 'the containers of his order, to pick from';
  r := ops_qc.resolve_qc_finding(f1, '');
  assert r->'error'->>'code' = 'resolution_required', 'what was done: ' || r::text;
  r := ops_qc.resolve_qc_finding(f1, 'Kaki diganti, dicek ulang');
  assert r->>'outcome' = 'ok', 'resolved: ' || r::text;
  r := ops_qc.resolve_qc_finding(f1, 'lagi');
  assert r->'error'->>'code' = 'already_resolved', 'once: ' || r::text;
  r := ops_qc.submit_qc_report(a1, ops_core.office_day(), 'loading',
         '[{"line_no":1,"passed":10},{"line_no":2,"passed":5}]', 'Muat kontainer pertama', dno,
         array['d5000000-0000-0000-0000-0000000000a2']::uuid[]);
  assert r->>'outcome' = 'ok', 'the loading check, on the container: ' || r::text;
  assert (select container_no from ops_qc.v_qc_report where report_no = r->'data'->>'report_no') = 'MSKU1234565',
    'the report names the container';

  perform set_config('request.jwt.claim.sub', 'aaaa0000-0000-0000-0000-0000000d5006', true);
  assert (select string_agg(stage, ' ' order by line_no) from ops_procure.v_project_production where project_code = '26992')
         = 'MADE MADE', 'passed in full: MADE';
  assert ops_qc.load_warnings(current_setting('test.po_id')::uuid) = '[]'::jsonb,
    'all passed, nothing serious open: nothing to say';

  -- ── a client's claim, after arrival (O8) ────────────────────────────────
  r := ops_qc.raise_qc_finding(po, 'after_arrival', 'damaged', 'critical', 'Klien: dua meja tergores');
  assert r->>'outcome' = 'ok', 'the project manager records the claim: ' || r::text;
  assert (select raised_by_name from ops_qc.v_qc_finding where finding_no = r->'data'->>'finding_no') = 'PM QR', 'by whom';
end $$;

rollback;
