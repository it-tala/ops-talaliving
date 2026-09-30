-- prod — a piece of work says when, to the hour (0197, D348).
--
--   REFUSALS     half a span; a span that runs backwards; more than sixteen
--                hours; a start on another day than the work date; a finish
--                that has not happened yet; the table's own constraints for a
--                write that goes round the seam
--   DERIVATIONS  a timed entry keeps both ends and its day; an untimed one
--                keeps neither (the lembur sheet's shape); a span with no date
--                files itself under the day it started; an overnight span
--                belongs to the evening it began

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-0000000b1001','mandor-jam@talaliving.com','{"full_name":"Mandor Jam"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-0000000b1001','production','write');

insert into ops_prod.products (id, product_code, name, category, uom, stages) values
  ('0b100000-0000-0000-0000-0000000000a1','JAM-CHAIR','Kursi jam','Kursi','pcs', array['AMPLAS','FINISHING','PACKING']);

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-0000000b1001';

do $$
declare
  r jsonb; jo text;
  -- Yesterday on the office clock, so no hour in it is still in the future
  -- whenever the suite runs.
  d  date := ops_core.office_day() - 1;
  tz text := ops_core.office_tz();
  at0730 timestamptz; at0830 timestamptz; at0930 timestamptz; at2200 timestamptz; at0100 timestamptz;
begin
  at0730 := (d + time '07:30') at time zone tz;
  at0830 := (d + time '08:30') at time zone tz;
  at0930 := (d + time '09:30') at time zone tz;
  at2200 := (d + time '22:00') at time zone tz;
  at0100 := (d + 1 + time '01:00') at time zone tz;

  r := ops_prod.create_work_order('Kursi jam', 20, 'pcs', ops_core.office_day() + 14, 'JAM-CHAIR');
  assert ops_core.said_ok(r), 'jo: ' || r::text;
  jo := r->'data'->>'wo_no';

  /* REFUSALS */
  r := ops_prod.record_progress(jo, 'AMPLAS', 2, d, 'Sumiati', p_started_at => at0730);
  assert r->'error'->>'code' = 'span_half' and r->'error'->'detail'->>'field' = 'finished_at', 'half: ' || r::text;
  r := ops_prod.record_progress(jo, 'AMPLAS', 2, d, 'Sumiati', p_finished_at => at0830);
  assert r->'error'->>'code' = 'span_half' and r->'error'->'detail'->>'field' = 'started_at', 'other half: ' || r::text;
  r := ops_prod.record_progress(jo, 'AMPLAS', 2, d, 'Sumiati', p_started_at => at0830, p_finished_at => at0730);
  assert r->'error'->>'code' = 'span_backwards', 'backwards: ' || r::text;
  r := ops_prod.record_progress(jo, 'AMPLAS', 2, d, 'Sumiati', p_started_at => at0730, p_finished_at => at0730);
  assert r->'error'->>'code' = 'span_backwards', 'zero length: ' || r::text;
  r := ops_prod.record_progress(jo, 'AMPLAS', 2, d, 'Sumiati', p_started_at => at0730, p_finished_at => at0730 + interval '17 hours');
  assert r->'error'->>'code' = 'span_too_long', 'seventeen hours: ' || r::text;
  r := ops_prod.record_progress(jo, 'AMPLAS', 2, d - 1, 'Sumiati', p_started_at => at0730, p_finished_at => at0830);
  assert r->'error'->>'code' = 'span_other_day', 'other day: ' || r::text;
  r := ops_prod.record_progress(jo, 'AMPLAS', 2, ops_core.office_day(), 'Sumiati',
         p_started_at => now() + interval '1 hour', p_finished_at => now() + interval '2 hours');
  assert r->'error'->>'code' = 'span_in_future', 'future: ' || r::text;
  assert not exists (select 1 from ops_prod.progress_entries e join ops_prod.work_orders w on w.id = e.wo_id
                      where w.wo_no = jo), 'nothing written by a refusal';

  /* DERIVATIONS */
  r := ops_prod.record_progress(jo, 'AMPLAS', 3, d, 'Sumiati', p_started_at => at0730, p_finished_at => at0830);
  assert ops_core.said_ok(r), 'timed: ' || r::text;
  r := ops_prod.record_progress(jo, 'AMPLAS', 4, null, 'Karjo', p_started_at => at0830, p_finished_at => at0930);
  assert ops_core.said_ok(r), 'dated by its start: ' || r::text;
  assert (select work_date from ops_prod.progress_entries e join ops_prod.work_orders w on w.id = e.wo_id
           where w.wo_no = jo and e.worked_by = 'Karjo') = d, 'no date → the start''s day';
  r := ops_prod.record_progress(jo, 'AMPLAS', 1, d, 'Trisno', p_started_at => at2200, p_finished_at => at0100);
  assert ops_core.said_ok(r), 'overnight: ' || r::text;
  r := ops_prod.record_progress(jo, 'FINISHING', 2, d, 'Sakirin, Karjo',
         p_source => 'overtime_sheet', p_source_ref => 'lbr-jam-1');
  assert ops_core.said_ok(r), 'untimed sheet: ' || r::text;

  assert (select count(*) from ops_prod.progress_entries e join ops_prod.work_orders w on w.id = e.wo_id
           where w.wo_no = jo and e.started_at is not null and e.finished_at > e.started_at) = 3, 'three timed';
  assert (select count(*) from ops_prod.progress_entries e join ops_prod.work_orders w on w.id = e.wo_id
           where w.wo_no = jo and e.started_at is null and e.finished_at is null) = 1, 'one untimed';
  assert (select done from ops_prod.v_wo_stage_progress s where s.wo_no = jo and s.stage_code = 'AMPLAS') = 8,
    'the board still counts pieces, not hours';
end $$;

/* REFUSAL: the table itself, for a write that goes round the seam. */
reset role;
do $$
declare v_wo uuid;
begin
  select id into v_wo from ops_prod.work_orders where product_code = 'JAM-CHAIR';
  begin
    insert into ops_prod.progress_entries (wo_id, stage, qty, work_date, started_at)
    values (v_wo, 'AMPLAS', 1, ops_core.office_day() - 1, now() - interval '3 hours');
    assert false, 'half a span stored';
  exception when check_violation then null;
  end;
  begin
    insert into ops_prod.progress_entries (wo_id, stage, qty, work_date, started_at, finished_at)
    values (v_wo, 'AMPLAS', 1, ops_core.office_day() - 1, now() - interval '3 hours', now() - interval '4 hours');
    assert false, 'backwards span stored';
  exception when check_violation then null;
  end;
end $$;

rollback;
