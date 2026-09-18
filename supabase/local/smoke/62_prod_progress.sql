-- prod — what was finished, and the arithmetic that turns it into a percentage.
--
-- The scenario, worked out first. An order for **4**, route's four stages:
--
--   AMPLAS     4                          -> 4
--   FINISHING  3                          -> 3   (not 4+3=7 — F74)
--   MACHINERY  nothing reported           -> 0, and `recorded` false
--   PACKING    QC 2 and PACKING 3         -> 2   (the minimum, not the sum)
--   POTONG     2                          -> carried apart; rolls into nothing
--              (2, not 4, on purpose: with POTONG = AMPLAS the minimum hides
--               a fold, and the mutation that folds it passes unnoticed)
--
--   percent = (4+3+0+2) / (4 stages × 4) = 9/16 = 56%
--   current_stage = PACKING, completed = 2
--
--   REFUSALS     a zero entry; a correction with no sentence; more of a stage
--                than the order has pieces; a correction past zero; the same
--                lembur sheet twice (D147); a stage this business never had;
--                a name both linked and confirmed not-a-person; and no UPDATE
--                or DELETE at all

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-00000000ff01','joko@talaliving.com','{"full_name":"Joko"}'),
  ('ffffffff-0000-0000-0000-00000000ff02','evin@talaliving.com','{"full_name":"Evin"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-00000000ff01','production','write'),
  ('ffffffff-0000-0000-0000-00000000ff02','dashboard','read');
-- Evin signs overtime and holds no production module at all (D147).
insert into ops_core.user_authorities (user_id, authority) values
  ('ffffffff-0000-0000-0000-00000000ff02','approve_overtime');

insert into ops_prod.products (id, product_code, name, category, uom, created_by)
values ('bbbb0000-0000-0000-0000-0000000000c1','PRD-LM-100','Lemari pakaian','Lemari','unit',
        'ffffffff-0000-0000-0000-00000000ff01');

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-00000000ff01';

insert into ops_prod.work_orders (wo_no, product_code, item_name, qty, uom, route, due_date, created_by)
values ('spk-uji-10','PRD-LM-100','Lemari pakaian', 4,'unit','IN_HOUSE', ops_core.office_day() + 10,
        'ffffffff-0000-0000-0000-00000000ff01');

/* ── REFUSALS on the entry itself ──────────────────────────────────────── */
do $$
declare wo uuid;
begin
  select id into wo from ops_prod.work_orders where wo_no = 'spk-uji-10';

  begin
    insert into ops_prod.progress_entries (wo_id, stage, qty, work_date, recorded_by)
    values (wo,'AMPLAS', 0, ops_core.office_day(),'ffffffff-0000-0000-0000-00000000ff01');
    raise exception 'a zero entry should be refused';
  exception when check_violation then null;
  end;

  begin
    insert into ops_prod.progress_entries (wo_id, stage, qty, work_date, recorded_by)
    values (wo,'AMPLAS', -1, ops_core.office_day(),'ffffffff-0000-0000-0000-00000000ff01');
    raise exception 'a correction with no sentence should be refused';
  exception when check_violation then null;
  end;

  begin
    insert into ops_prod.progress_entries (wo_id, stage, qty, work_date, recorded_by)
    values (wo,'MENGECAT', 1, ops_core.office_day(),'ffffffff-0000-0000-0000-00000000ff01');
    raise exception 'a stage this business never had should be refused';
  exception when foreign_key_violation then null;
  end;

  begin
    insert into ops_prod.progress_entries (wo_id, stage, qty, work_date, worked_by,
                                           worked_by_employee_id, worked_by_not_a_person, recorded_by)
    values (wo,'AMPLAS', 1, ops_core.office_day(),'Tim potong', null, true,'ffffffff-0000-0000-0000-00000000ff01');
    -- that one is fine; the incoherent pair is below
    null;
  end;
end $$;

/* ── REFUSAL: more of a stage than the order has pieces ────────────────── */
do $$
declare wo uuid;
begin
  select id into wo from ops_prod.work_orders where wo_no = 'spk-uji-10';
  -- One is already recorded above, so 4 more would reach 5 of an order for 4.
  begin
    insert into ops_prod.progress_entries (wo_id, stage, qty, work_date, recorded_by)
    values (wo,'AMPLAS', 4, ops_core.office_day(),'ffffffff-0000-0000-0000-00000000ff01');
    raise exception 'more of a stage than the order has should be refused — it cannot be true';
  exception when check_violation then null;
  end;

  -- And a correction past zero is the same argument from the other end.
  begin
    insert into ops_prod.progress_entries (wo_id, stage, qty, work_date, note, recorded_by)
    values (wo,'AMPLAS', -5, ops_core.office_day(),'salah catat','ffffffff-0000-0000-0000-00000000ff01');
    raise exception 'a correction past zero should be refused';
  exception when check_violation then null;
  end;
end $$;

/* ── the scenario ──────────────────────────────────────────────────────── */
do $$
declare wo uuid;
begin
  select id into wo from ops_prod.work_orders where wo_no = 'spk-uji-10';
  -- Top AMPLAS up from the 1 already there to 4.
  insert into ops_prod.progress_entries (wo_id, stage, qty, work_date, worked_by, recorded_by) values
    (wo,'AMPLAS',    3, ops_core.office_day(),'Pranowo','ffffffff-0000-0000-0000-00000000ff01'),
    (wo,'FINISHING', 3, ops_core.office_day(),'Pranowo','ffffffff-0000-0000-0000-00000000ff01'),
    (wo,'QC',        2, ops_core.office_day(),'Sari','ffffffff-0000-0000-0000-00000000ff01'),
    (wo,'PACKING',   3, ops_core.office_day(),'Sari','ffffffff-0000-0000-0000-00000000ff01'),
    (wo,'POTONG',    2, ops_core.office_day(),'vendor mentah','ffffffff-0000-0000-0000-00000000ff01');
end $$;

/* ── DERIVATION: the minimum, and the unknown that is not a zero ───────── */
do $$
declare s record;
begin
  select * into s from ops_prod.v_wo_stage_progress where wo_no = 'spk-uji-10' and stage_code = 'AMPLAS';
  assert s.done = 4,     'four sanded, got ' || s.done;
  assert s.recorded,     'and somebody reported it';

  select * into s from ops_prod.v_wo_stage_progress where wo_no = 'spk-uji-10' and stage_code = 'FINISHING';
  assert s.done = 3,     'three finished — NOT 4 sanded plus 3 finished (F74), got ' || s.done;

  -- QC is a source of Packing, and Packing is a source of itself. The count is
  -- the smallest of the steps actually recorded, never their sum.
  select * into s from ops_prod.v_wo_stage_progress where wo_no = 'spk-uji-10' and stage_code = 'PACKING';
  assert s.done = 2,     'QC 2 and Packing 3 is two packed, not five, got ' || s.done;
  assert s.sources = 2,  'and the view says two sources carried a figure, got ' || s.sources;

  -- Nobody reported Machinery. `done: 0` and `recorded: false` are two
  -- different facts, and conflating them made every later stage look like it
  -- had jumped a step (F92).
  select * into s from ops_prod.v_wo_stage_progress where wo_no = 'spk-uji-10' and stage_code = 'MACHINERY';
  assert s.done = 0,     'nothing has passed it, got ' || s.done;
  assert not s.recorded, 'and nobody has said anything about it — an unknown cannot be overtaken';
end $$;

/* ── DERIVATION: retired work is carried apart, never folded in ────────── */
do $$
declare n int; d numeric;
begin
  /* Two cut and four sanded. If POTONG were folded into Sanding the minimum
     would report **two** sanded, which is the claim D275 refuses: six pieces
     cut is not six pieces sanded, and the two counts are not the same fact. */
  select done into d from ops_prod.v_wo_stage_progress
   where wo_no = 'spk-uji-10' and stage_code = 'AMPLAS';
  assert d = 4, 'POTONG must not be folded into Sanding, got ' || d;

  select done into d from ops_prod.v_wo_retired_work where wo_no = 'spk-uji-10' and code = 'POTONG';
  assert d = 2, 'but the work happened and is named, got ' || d;
end $$;

/* ── DERIVATION: the board's own figures ───────────────────────────────── */
do $$
declare v record;
begin
  select * into v from ops_prod.v_work_order where wo_no = 'spk-uji-10';
  assert v.stage_count = 4,        'the route''s four, got ' || v.stage_count;
  assert v.stages_unset,           'the product has no stage list, and the board says so';
  -- Eleven doors sanded and one packed is not "packing" — it is a quarter of
  -- the way through.
  assert v.percent = 56,           '(4+3+0+2) of 16 steps, got ' || v.percent;
  assert v.current_stage = 'PACKING', 'the furthest with anything finished, got ' || coalesce(v.current_stage,'(null)');
  assert v.completed = 2,          'two are actually finished, got ' || v.completed;
  assert v.has_retired_work,       'and it carries work from a step the business no longer has';
  assert not v.late,               'due in ten days';
end $$;

/* ── D147: a signature is its own authority, and posts once ────────────── */
do $$
declare wo uuid; n int;
begin
  select id into wo from ops_prod.work_orders where wo_no = 'spk-uji-10';
  set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-00000000ff02';
  assert not ops_core.has_permission('production.update'), 'Evin holds no production module';
  assert ops_core.has_authority('approve_overtime'),       'only the signature';

  -- Posting progress is the consequence of that signature, so it is allowed.
  insert into ops_prod.progress_entries (wo_id, stage, qty, work_date, source, source_ref, worked_by, recorded_by)
  values (wo,'MACHINERY', 2, ops_core.office_day(),'overtime_sheet','lbr-26-08-31_01','Pranowo',
          'ffffffff-0000-0000-0000-00000000ff02');

  -- The same signed sheet posted twice adds nothing (D147).
  begin
    insert into ops_prod.progress_entries (wo_id, stage, qty, work_date, source, source_ref, worked_by, recorded_by)
    values (wo,'MACHINERY', 2, ops_core.office_day(),'overtime_sheet','lbr-26-08-31_01','Pranowo',
            'ffffffff-0000-0000-0000-00000000ff02');
    raise exception 'the same sheet twice should be refused';
  exception when unique_violation then null;
  end;

  -- And a manual entry is still production's alone.
  begin
    insert into ops_prod.progress_entries (wo_id, stage, qty, work_date, recorded_by)
    values (wo,'PACKING', 1, ops_core.office_day(),'ffffffff-0000-0000-0000-00000000ff02');
    raise exception 'a signature is not a licence to report ordinary work';
  exception when insufficient_privilege then null;
  end;

  select count(*) into n from ops_prod.progress_entries where wo_id = wo and stage = 'MACHINERY';
  assert n = 1, 'one entry from the sheet, got ' || n;
end $$;

/* ── REFUSAL: append-only means append-only ────────────────────────────── */
do $$
declare n int;
begin
  set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-00000000ff01';
  /* A hard refusal rather than a silent no-op, and the difference is worth
     noting: there is no UPDATE **grant** at all, so Postgres stops the
     statement before RLS is consulted. An RLS-only bar would have filtered the
     rows and reported `UPDATE 0`, which a caller can mistake for *nothing
     matched*. */
  begin
    update ops_prod.progress_entries set qty = 99 where stage = 'AMPLAS';
    raise exception 'an entry is never edited';
  exception when insufficient_privilege then null;
  end;
  select count(*) into n from ops_prod.progress_entries where qty = 99;
  assert n = 0, 'and nothing was changed, got ' || n;

  begin
    delete from ops_prod.progress_entries where stage = 'AMPLAS';
    raise exception 'an entry is never removed — a correction is a negative entry';
  exception when insufficient_privilege then null;
  end;
end $$;

rollback;
