-- dlv — the last leg: crates, surat jalan, installation, snags, BAST (0131, 0132).
--
--   kirim  delivery write + production write — packs, sends, fits
--   pm     project write                      — signs the BAST
--   luar   inventory write                    — none of this
--
--   REFUSALS     a crate with no room; sending more than was made; arriving
--                without the signed surat jalan; fitting more than arrived;
--                fitting a crate nobody scanned; a problem with no sentence;
--                closing a snag without saying how; a BAST without the file;
--                a second BAST; the crew signing the BAST; the PM sending a
--                lorry; somebody from inventory
--   DERIVATIONS  made from the Job Order made from the line; a line with no
--                Job Order is null, not zero; delivered and arrived as two
--                filters over the same rows; the first surat jalan moves the
--                project to SHIPPED and the BAST to DONE, both logged; crates
--                loaded with the surat jalan go in transit and number 1 dari 2;
--                the BAST freezes the snags open on the day

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-0000000d0001','kirim-dlv@talaliving.com','{"full_name":"Tim Kirim"}'),
  ('ffffffff-0000-0000-0000-0000000d0002','pm-dlv@talaliving.com','{"full_name":"PM Proyek"}'),
  ('ffffffff-0000-0000-0000-0000000d0003','luar-dlv@talaliving.com','{"full_name":"Orang Gudang"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-0000000d0001','delivery','write'),
  ('ffffffff-0000-0000-0000-0000000d0001','production','write'),
  ('ffffffff-0000-0000-0000-0000000d0002','project','write'),
  ('ffffffff-0000-0000-0000-0000000d0003','inventory','write');

insert into ops_core.attachments (id, storage_path, filename, uploaded_by) values
  ('0d000000-0000-0000-0000-00000000f001','drive/sj.jpg','sj.jpg','ffffffff-0000-0000-0000-0000000d0001'),
  ('0d000000-0000-0000-0000-00000000f002','drive/bast.pdf','bast.pdf','ffffffff-0000-0000-0000-0000000d0002');

insert into ops_prod.products (product_code, name, category, uom, stages) values
  ('DLV-TBL','Meja makan','Meja','pcs', array['AMPLAS','PACKING']);
insert into ops_procure.projects (id, code, name, is_active, status) values
  ('0d000000-0000-0000-0000-0000000000b1','DLV-P1','Villa Kirim', true, 'IN_PRODUCTION');
insert into ops_procure.project_lines (id, project_id, line_no, product_code, description, qty, uom) values
  ('0d000000-0000-0000-0000-0000000000c1','0d000000-0000-0000-0000-0000000000b1', 1, 'DLV-TBL', 'Meja makan', 4, 'pcs'),
  ('0d000000-0000-0000-0000-0000000000c2','0d000000-0000-0000-0000-0000000000b1', 2, 'DLV-TBL', 'Meja teras', 2, 'pcs'),
  ('0d000000-0000-0000-0000-0000000000c3','0d000000-0000-0000-0000-0000000000b1', 3, null, 'Ongkos pasang', 1, 'lot');

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-0000000d0001';

do $$
declare r jsonb; jo text; dn text; b1 text; b2 text; v jsonb; sn text;
begin
  /* the workshop finishes three of four on line 1 */
  r := ops_prod.create_work_order(null, 4, null, current_date + 5, p_project_line_id => '0d000000-0000-0000-0000-0000000000c1');
  jo := r->'data'->>'wo_no';
  r := ops_prod.record_progress(jo, 'AMPLAS', 3, current_date);
  r := ops_prod.record_progress(jo, 'PACKING', 3, current_date);

  /* DERIVATION: made from the line's own Job Order; line 2 has none */
  select to_jsonb(x) into v from ops_dlv.v_fulfilment_line x where project_line_id = '0d000000-0000-0000-0000-0000000000c1';
  assert (v->>'made')::numeric = 3 and (v->>'ready_to_ship')::numeric = 3, 'line 1 made: ' || v::text;
  select to_jsonb(x) into v from ops_dlv.v_fulfilment_line x where project_line_id = '0d000000-0000-0000-0000-0000000000c2';
  assert v->>'made' is null and v->>'ready_to_ship' is null, 'no Job Order is null, not zero: ' || v::text;
  assert (select is_service from ops_dlv.v_fulfilment_line where project_line_id = '0d000000-0000-0000-0000-0000000000c3'), 'fee is a service';

  /* crates */
  r := ops_dlv.pack_box('DLV-P1', '  ', '[{"description":"Meja","qty":1,"uom":"pcs"}]');
  assert r->'error'->>'code' = 'destination_required', 'no room: ' || r::text;
  r := ops_dlv.pack_box('DLV-P1', 'Ruang makan', '[{"project_line_id":"0d000000-0000-0000-0000-0000000000c1","description":"Daun meja","qty":2,"uom":"pcs"}]');
  assert ops_core.said_ok(r), 'box 1: ' || r::text;
  b1 := r->'data'->>'box_no';
  r := ops_dlv.pack_box('DLV-P1', 'Ruang makan', '[{"description":"Kaki meja","qty":8,"uom":"pcs"}]');
  b2 := r->'data'->>'box_no';
  assert (select status from ops_dlv.packing_boxes where box_no = b1) = 'PACKED', 'waiting in the yard';

  /* REFUSAL: four of three made */
  r := ops_dlv.create_delivery('DLV-P1', current_date, '[{"project_line_id":"0d000000-0000-0000-0000-0000000000c1","qty":4}]');
  assert r->'error'->>'code' = 'not_enough_made', 'four of three: ' || r::text;
  /* the same line twice cannot slip past */
  r := ops_dlv.create_delivery('DLV-P1', current_date,
         '[{"project_line_id":"0d000000-0000-0000-0000-0000000000c1","qty":2},{"project_line_id":"0d000000-0000-0000-0000-0000000000c1","qty":2}]');
  assert r->'error'->>'code' = 'not_enough_made', 'split line: ' || r::text;

  /* DERIVATION: the surat jalan, crates aboard, project moves */
  r := ops_dlv.create_delivery('DLV-P1', current_date,
         '[{"project_line_id":"0d000000-0000-0000-0000-0000000000c1","qty":3},{"project_line_id":"0d000000-0000-0000-0000-0000000000c2","qty":1}]',
         p_vehicle => 'DK 1234 XX', p_box_nos => array[b1, b2], p_key => 'dlv-1');
  assert ops_core.said_ok(r) and (r->'data'->>'project_moved')::boolean, 'dispatch: ' || r::text;
  dn := r->'data'->>'delivery_no';
  assert dn like 'krm-%', 'krm number';
  assert (select status from ops_procure.projects where code = 'DLV-P1') = 'SHIPPED', 'in production → shipped';
  assert (select status from ops_dlv.packing_boxes where box_no = b1) = 'IN_TRANSIT', 'crate on the lorry';
  assert (select position from ops_dlv.v_box where box_no = b1) = '1 dari 2', 'position: ' || (select position from ops_dlv.v_box where box_no = b1);
  select to_jsonb(x) into v from ops_dlv.v_fulfilment_line x where project_line_id = '0d000000-0000-0000-0000-0000000000c1';
  assert (v->>'delivered')::numeric = 3 and (v->>'arrived')::numeric = 0 and (v->>'ready_to_ship')::numeric = 0,
    'left, not arrived: ' || v::text;

  /* REFUSAL: fitting what is on the road */
  r := ops_dlv.record_installation('DLV-P1', current_date, '[{"project_line_id":"0d000000-0000-0000-0000-0000000000c1","qty":1}]');
  assert r->'error'->>'code' = 'not_enough_on_site', 'on the road: ' || r::text;

  /* crates on site */
  r := ops_dlv.mark_box_installed(b1);
  assert r->'error'->>'code' = 'not_on_site', 'unseen crate: ' || r::text;
  r := ops_dlv.scan_box(b1);
  assert ops_core.said_ok(r), 'scan: ' || r::text;
  r := ops_dlv.scan_box(b1);
  assert r->>'outcome' = 'noop', 'scan twice';
  r := ops_dlv.flag_box_problem(b2, ' ');
  assert r->'error'->>'code' = 'problem_note_required', 'silent red flag: ' || r::text;
  r := ops_dlv.flag_box_problem(b2, 'satu kaki patah');
  assert ops_core.said_ok(r) and (select scanned_at is not null from ops_dlv.packing_boxes where box_no = b2), 'flag is a sighting';

  /* REFUSAL: arriving without the signed paper */
  r := ops_dlv.mark_arrived(dn, 'Pak Wayan', null);
  assert r->'error'->>'code' = 'surat_jalan_required', 'no paper: ' || r::text;
  r := ops_dlv.mark_arrived(dn, 'Pak Wayan', '0d000000-0000-0000-0000-00000000f001');
  assert ops_core.said_ok(r), 'arrived: ' || r::text;
  assert exists (select 1 from ops_core.attachment_links where entity = 'delivery' and entity_no = dn and kind = 'surat_jalan_keluar'),
    'surat jalan filed against the delivery';

  /* installation */
  r := ops_dlv.record_installation('DLV-P1', current_date, '[{"project_line_id":"0d000000-0000-0000-0000-0000000000c1","qty":4}]');
  assert r->'error'->>'code' = 'not_enough_on_site', 'four of three: ' || r::text;
  r := ops_dlv.record_installation('DLV-P1', current_date, '[{"project_line_id":"0d000000-0000-0000-0000-0000000000c1","qty":3}]', 'Tim Made');
  assert ops_core.said_ok(r), 'install: ' || r::text;
  r := ops_dlv.mark_box_installed(b1);
  assert ops_core.said_ok(r), 'crate fitted: ' || r::text;

  /* snags */
  r := ops_dlv.raise_snag('DLV-P1', 'Goresan di daun meja', 'Klien', 'major', '0d000000-0000-0000-0000-0000000000c1');
  assert ops_core.said_ok(r), 'snag: ' || r::text;
  sn := r->'data'->>'snag_no';
  r := ops_dlv.raise_snag('DLV-P1', 'Dinding kotor', 'Tim Made');
  r := ops_dlv.close_snag(r->'data'->>'snag_no', '');
  assert r->'error'->>'code' = 'fix_note_required', 'closed without how: ' || r::text;
  r := ops_dlv.close_snag((select snag_no from ops_dlv.snags where description = 'Dinding kotor'), 'dibersihkan');
  assert ops_core.said_ok(r), 'fixed: ' || r::text;

  /* REFUSAL: the crew does not sign the BAST */
  r := ops_dlv.record_handover('DLV-P1', current_date, 'Bu Sari', 'Ryan', '0d000000-0000-0000-0000-00000000f002');
  assert r->'error'->>'code' = 'not_permitted', 'crew signing: ' || r::text;
end $$;

/* the PM: signs, and cannot send a lorry */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-0000000d0002';
do $$
declare r jsonb; h text;
begin
  r := ops_dlv.create_delivery('DLV-P1', current_date, '[{"project_line_id":"0d000000-0000-0000-0000-0000000000c3","qty":1}]');
  assert r->'error'->>'code' = 'not_permitted', 'PM dispatching: ' || r::text;
  assert (select count(*) from ops_dlv.v_fulfilment_line where project_code = 'DLV-P1') = 3, 'the PM reads the board';

  r := ops_dlv.record_handover('DLV-P1', current_date, 'Bu Sari', 'Ryan', null);
  assert r->'error'->>'code' = 'bast_required', 'no BAST: ' || r::text;
  r := ops_dlv.record_handover('DLV-P1', current_date, 'Bu Sari', 'Ryan', '0d000000-0000-0000-0000-00000000f002');
  assert ops_core.said_ok(r), 'handover: ' || r::text;
  h := r->'data'->>'handover_no';
  assert (r->'data'->>'open_snags_at_handover')::int = 1, 'one open on the day';
  assert (select open_snag_nos from ops_dlv.handovers where handover_no = h)
         = (select array_agg(snag_no) from ops_dlv.snags where description like 'Goresan%'), 'which one';
  assert (select status from ops_procure.projects where code = 'DLV-P1') = 'DONE', 'shipped → done';
  assert (select count(*) from ops_procure.project_status_log l join ops_procure.projects p on p.id = l.project_id
           where p.code = 'DLV-P1' and (l.reason like 'Surat jalan %' or l.reason like 'BAST %')) = 2, 'both moves logged';
  r := ops_dlv.record_handover('DLV-P1', current_date, 'Bu Sari', 'Ryan', '0d000000-0000-0000-0000-00000000f002');
  assert r->'error'->>'code' = 'already_handed_over', 'second BAST: ' || r::text;
end $$;

/* the snag fixed afterwards does not rewrite the BAST (D212) */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-0000000d0001';
do $$
declare r jsonb;
begin
  r := ops_dlv.close_snag((select snag_no from ops_dlv.snags where description like 'Goresan%'), 'dipoles ulang');
  assert ops_core.said_ok(r), 'late fix: ' || r::text;
  assert (select open_snags_at_handover from ops_dlv.handovers where project_code = 'DLV-P1') = 1, 'still signed with one open';
end $$;

/* REFUSAL: somebody from inventory */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-0000000d0003';
do $$
declare r jsonb;
begin
  r := ops_dlv.pack_box('DLV-P1', 'Dapur', '[{"description":"x","qty":1}]');
  assert r->'error'->>'code' = 'not_permitted', 'outsider pack: ' || r::text;
  assert (select count(*) from ops_dlv.deliveries) = 0, 'and cannot read the lorries';
end $$;

rollback;
