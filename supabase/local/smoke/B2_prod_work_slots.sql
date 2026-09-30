-- prod — the timeslot: who worked on what, for how long (0198, D352).
--
--   REFUSALS     no activity; nobody on it; one person twice; an employee who
--                does not exist; half a span; no duration at all; a quantity
--                with no stage; a stage the product does not have; pieces the
--                order cannot hold (the slot is refused whole); a closed Job
--                Order; a lembur slot without its line; cancelling without a
--                reason; somebody without production access; a negative count
--                against a slot that is not cancelled
--   DERIVATIONS  a slot with no pieces posts nothing; a crew's pieces post one
--                entry that is *not one person*, a single person's is linked;
--                minutes come from the span; a lembur sheet posts per person
--                and a line twice is a no-op; cancelling takes the pieces back
--                with the reason; a day's hundredth number is not its tenth

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-0000000b2001','mandor-slot@talaliving.com','{"full_name":"Mandor Slot"}'),
  ('ffffffff-0000-0000-0000-0000000b2002','tamu-slot@talaliving.com','{"full_name":"Tamu"}'),
  ('ffffffff-0000-0000-0000-0000000b2003','direktur-slot@talaliving.com','{"full_name":"Direktur"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-0000000b2001','production','write'),
  ('ffffffff-0000-0000-0000-0000000b2002','production','read');
insert into ops_core.user_authorities (user_id, authority) values
  ('ffffffff-0000-0000-0000-0000000b2003','approve_overtime');

insert into ops_hr.employees
  (id, employee_no, full_name, position, unit, pay_basis, base_rate, allowance_rate, daily_hours, joined_on)
values
  ('b2000000-0000-0000-0000-0000000000e1','B-2001','Karjo','Tukang','Produksi','daily', 140000, 15000, 8, '2026-01-01'),
  ('b2000000-0000-0000-0000-0000000000e2','B-2002','Toha','Tukang','Produksi','daily', 140000, 15000, 8, '2026-01-01');

insert into ops_prod.products (id, product_code, name, category, uom, stages) values
  ('b2000000-0000-0000-0000-0000000000a1','AA-02','Pintu AA-02','Pintu','pcs', array['AMPLAS','FINISHING','PACKING']);

-- A day's hundredth number is `_100`, not `_10` (lpad truncated, 0198).
do $$
declare v text;
begin
  for i in 1..100 loop v := ops_core.next_doc_number('jo', now() - interval '400 days'); end loop;
  assert v like '%\_100', 'hundredth: ' || v;
  assert ops_core.next_doc_number('tsl', now() - interval '400 days') like '%\_001', 'tsl is three wide';
end $$;

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-0000000b2001';

do $$
declare
  r jsonb; jo text; s1 text; s2 text; s3 text; v jsonb;
  d  date := ops_core.office_day() - 1;
  tz text := ops_core.office_tz();
  karjo jsonb := '{"employee_id":"b2000000-0000-0000-0000-0000000000e1"}';
  toha  jsonb := '{"employee_id":"b2000000-0000-0000-0000-0000000000e2"}';
  at0730 timestamptz; at0930 timestamptz; at1130 timestamptz;
begin
  at0730 := (d + time '07:30') at time zone tz;
  at0930 := (d + time '09:30') at time zone tz;
  at1130 := (d + time '11:30') at time zone tz;

  r := ops_prod.create_work_order('Pintu AA-02', 100, 'pcs', ops_core.office_day() + 30, 'AA-02');
  assert ops_core.said_ok(r), 'jo: ' || r::text;
  jo := r->'data'->>'wo_no';

  /* REFUSALS */
  r := ops_prod.record_work_slot(jo, '  ', jsonb_build_array(karjo), d, at0730, at0930);
  assert r->'error'->>'code' = 'activity_required', 'no activity: ' || r::text;
  r := ops_prod.record_work_slot(jo, 'rakit pintu', '[]', d, at0730, at0930);
  assert r->'error'->>'code' = 'workers_required', 'nobody: ' || r::text;
  r := ops_prod.record_work_slot(jo, 'rakit pintu', jsonb_build_array(karjo, '{"name":"karjo"}'::jsonb), d, at0730, at0930);
  assert r->'error'->>'code' = 'worker_twice', 'twice by name: ' || r::text;
  r := ops_prod.record_work_slot(jo, 'rakit pintu', '[{"employee_id":"b2000000-0000-0000-0000-00000000dead"}]', d, at0730, at0930);
  assert r->'error'->>'code' = 'employee_not_found', 'ghost: ' || r::text;
  r := ops_prod.record_work_slot(jo, 'rakit pintu', jsonb_build_array(karjo), d, at0730, null);
  assert r->'error'->>'code' = 'span_half', 'half: ' || r::text;
  r := ops_prod.record_work_slot(jo, 'rakit pintu', jsonb_build_array(karjo), d);
  assert r->'error'->>'code' = 'duration_required', 'no duration: ' || r::text;
  r := ops_prod.record_work_slot(jo, 'rakit pintu', jsonb_build_array(karjo), d, at0730, at0930, p_qty => 3);
  assert r->'error'->>'code' = 'stage_required', 'qty without stage: ' || r::text;
  r := ops_prod.record_work_slot(jo, 'pasang lampu', jsonb_build_array(karjo), d, at0730, at0930, p_stage => 'MACHINERY');
  assert r->'error'->>'code' = 'stage_not_on_product', 'no lamps in a door: ' || r::text;
  r := ops_prod.record_work_slot(jo, 'amplas', jsonb_build_array(karjo), d, at0730, at0930, p_stage => 'AMPLAS', p_qty => 101);
  assert r->'error'->>'code' = 'over_order', 'over order: ' || r::text;
  r := ops_prod.record_work_slot(jo, 'lembur', jsonb_build_array(karjo), d, p_minutes => 120,
         p_source => 'overtime_sheet', p_source_ref => 'lbr-x');
  assert r->'error'->>'code' = 'sheet_line_required', 'sheet without line: ' || r::text;
  assert not exists (select 1 from ops_prod.work_slots s join ops_prod.work_orders w on w.id = s.wo_id where w.wo_no = jo),
    'no refusal wrote a slot';
  assert not exists (select 1 from ops_prod.progress_entries e join ops_prod.work_orders w on w.id = e.wo_id where w.wo_no = jo),
    'no refusal wrote a count';

  /* DERIVATIONS — the owner's own example */
  r := ops_prod.record_work_slot(jo, 'rakit pintu', jsonb_build_array(karjo, toha), d, at0730, at0930);
  assert ops_core.said_ok(r) and not (r->'data'->>'posted')::boolean, 'crew, no pieces: ' || r::text;
  s1 := r->'data'->>'slot_no';
  assert s1 like 'tsl-%', 'numbered: ' || s1;
  assert (select minutes from ops_prod.work_slots where slot_no = s1) = 120, 'minutes from the span';
  assert (select string_agg(worked_by, ', ' order by seq) from ops_prod.work_slot_workers x
            join ops_prod.work_slots s on s.id = x.slot_id where s.slot_no = s1) = 'Karjo, Toha', 'names from the employees';
  assert not exists (select 1 from ops_prod.progress_entries where slot_id = (select id from ops_prod.work_slots where slot_no = s1)),
    'no pieces, no count';

  r := ops_prod.record_work_slot(jo, 'tambah engsel', jsonb_build_array(karjo), d, at0930, at1130,
         p_stage => 'AMPLAS', p_qty => 10);
  assert ops_core.said_ok(r) and (r->'data'->>'posted')::boolean, 'one person, ten pieces: ' || r::text;
  s2 := r->'data'->>'slot_no';
  select to_jsonb(e) into v from ops_prod.progress_entries e
   where e.slot_id = (select id from ops_prod.work_slots where slot_no = s2);
  assert v->>'worked_by' = 'Karjo' and v->>'worked_by_employee_id' = 'b2000000-0000-0000-0000-0000000000e1'
     and not (v->>'worked_by_not_a_person')::boolean and (v->>'qty')::numeric = 10
     and (v->>'started_at') is not null, 'linked entry: ' || v::text;

  r := ops_prod.record_work_slot(jo, 'finishing coat 1', jsonb_build_array(karjo, toha), d, at0930, at1130,
         p_stage => 'FINISHING', p_qty => 2);
  assert ops_core.said_ok(r), 'crew pieces: ' || r::text;
  s3 := r->'data'->>'slot_no';
  select to_jsonb(e) into v from ops_prod.progress_entries e
   where e.slot_id = (select id from ops_prod.work_slots where slot_no = s3);
  assert v->>'worked_by' = 'Karjo, Toha' and v->>'worked_by_employee_id' is null
     and (v->>'worked_by_not_a_person')::boolean, 'a crew is not one person: ' || v::text;

  -- The project manager's line: 12 sanded, 2 finished → 10 waiting after sanding.
  assert (select done from ops_prod.v_wo_stage_progress where wo_no = jo and stage_code = 'AMPLAS') = 10
     and (select done from ops_prod.v_wo_stage_progress where wo_no = jo and stage_code = 'FINISHING') = 2,
    'the board counts slot pieces';

  /* REFUSAL: a slot's count is taken back only by cancelling it */
  r := ops_prod.record_progress(jo, 'AMPLAS', -10, d, p_note => 'salah', p_slot_id => (select id from ops_prod.work_slots where slot_no = s2));
  assert r->'error'->>'code' = 'slot_not_voided', 'negative against a live slot: ' || r::text;
  r := ops_prod.record_progress(jo, 'AMPLAS', 10, d, p_slot_id => (select id from ops_prod.work_slots where slot_no = s2));
  assert r->>'outcome' = 'noop', 'slot posts once: ' || r::text;

  /* cancelling */
  r := ops_prod.void_work_slot(s2, '');
  assert r->'error'->>'code' = 'reason_required', 'void without reason: ' || r::text;
  r := ops_prod.void_work_slot(s2, 'jumlahnya milik Job Order lain');
  assert ops_core.said_ok(r) and (r->'data'->>'taken_back')::numeric = 10, 'void: ' || r::text;
  assert (select done from ops_prod.v_wo_stage_progress where wo_no = jo and stage_code = 'AMPLAS') = 0, 'pieces taken back';
  assert (select count(*) from ops_prod.progress_entries e join ops_prod.work_slots s on s.id = e.slot_id
           where s.slot_no = s2 and e.qty = -10 and e.note like '%jumlahnya milik%') = 1, 'the correction carries the reason';
  r := ops_prod.void_work_slot(s2, 'lagi');
  assert r->>'outcome' = 'noop', 'void twice: ' || r::text;
end $$;

/* REFUSAL: reading production is not writing it */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-0000000b2002';
do $$
declare r jsonb;
begin
  r := ops_prod.record_work_slot((select wo_no from ops_prod.work_orders where product_code = 'AA-02'),
         'rakit', '[{"name":"Karjo"}]', ops_core.office_day() - 1, p_minutes => 60);
  assert r->'error'->>'code' = 'not_permitted', 'reader: ' || r::text;
end $$;

/* DERIVATION: the lembur sheet posts per person, on the signature's authority */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-0000000b2003';
do $$
declare r jsonb; jo text := (select wo_no from ops_prod.work_orders where product_code = 'AA-02');
        d date := ops_core.office_day() - 1;
begin
  r := ops_prod.record_work_slot(jo, 'amplas lembur', '[{"employee_id":"b2000000-0000-0000-0000-0000000000e1"}]', d,
         p_minutes => 180, p_stage => 'AMPLAS', p_qty => 4,
         p_source => 'overtime_sheet', p_source_ref => 'lbr-slot-1', p_source_line => 'line-karjo');
  assert ops_core.said_ok(r), 'karjo lembur: ' || r::text;
  r := ops_prod.record_work_slot(jo, 'amplas lembur', '[{"employee_id":"b2000000-0000-0000-0000-0000000000e2"}]', d,
         p_minutes => 180, p_stage => 'AMPLAS', p_qty => 3,
         p_source => 'overtime_sheet', p_source_ref => 'lbr-slot-1', p_source_line => 'line-toha');
  assert ops_core.said_ok(r), 'toha lembur, same sheet, same stage: ' || r::text;
  r := ops_prod.record_work_slot(jo, 'amplas lembur', '[{"employee_id":"b2000000-0000-0000-0000-0000000000e2"}]', d,
         p_minutes => 180, p_stage => 'AMPLAS', p_qty => 3,
         p_source => 'overtime_sheet', p_source_ref => 'lbr-slot-1', p_source_line => 'line-toha');
  assert r->>'outcome' = 'noop', 'a line twice: ' || r::text;
  assert (select count(*) from ops_prod.progress_entries where source_ref = 'lbr-slot-1' and source = 'overtime_sheet') = 2,
    'two people, two entries';
  assert (select string_agg(worked_by, ',' order by worked_by) from ops_prod.progress_entries
           where source_ref = 'lbr-slot-1') = 'Karjo,Toha', 'each under their own name';
  assert (select done from ops_prod.v_wo_stage_progress where wo_no = jo and stage_code = 'AMPLAS') = 7, 'the night counted once';
end $$;

/* REFUSAL: a closed Job Order takes no more slots */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-0000000b2001';
do $$
declare r jsonb; jo text := (select wo_no from ops_prod.work_orders where product_code = 'AA-02');
begin
  r := ops_prod.close_work_order(jo, 'klien batal sebagian');
  assert ops_core.said_ok(r), 'close: ' || r::text;
  r := ops_prod.record_work_slot(jo, 'rapikan', '[{"name":"Karjo"}]', ops_core.office_day() - 1, p_minutes => 30);
  assert r->'error'->>'code' = 'wo_not_open', 'closed: ' || r::text;
end $$;

/* REFUSAL: the table, for a write round the seam */
reset role;
do $$
declare v_wo uuid := (select id from ops_prod.work_orders where product_code = 'AA-02');
begin
  begin
    insert into ops_prod.work_slots (wo_id, work_date, started_at, finished_at, minutes, activity)
    values (v_wo, ops_core.office_day() - 1, now() - interval '3 hours', now() - interval '1 hour', 30, 'x');
    assert false, 'minutes that disagree with the span stored';
  exception when check_violation then null;
  end;
  begin
    insert into ops_prod.work_slots (wo_id, work_date, minutes, activity, qty)
    values (v_wo, ops_core.office_day() - 1, 30, 'x', 2);
    assert false, 'pieces without a stage stored';
  exception when check_violation then null;
  end;
end $$;

rollback;
