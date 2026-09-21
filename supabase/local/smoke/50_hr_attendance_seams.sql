-- hr — the writes the attendance half does every day (D142, D143, F17).
--
--   REFUSALS     any of it with a read grant; a file with no scans; a typed
--                tap with no reason and one already recorded; a mark with no
--                reason, for an employee nobody has, or on a day already
--                marked; **withdrawing without saying why**, and withdrawing
--                twice; withholding an allowance twice and restoring one that
--                was never withheld
--   DERIVATIONS  a tap already here is skipped rather than doubled and a
--                number the machine printed that matches nobody is **named**;
--                the same tap twice inside one file is one row; the office day
--                decides which morning a tap belongs to, not UTC; **a
--                withdrawn mark stops counting everywhere** — the timesheet,
--                the leave entitlement and the mark list — and the day can be
--                marked again
--
-- Worked out first: six rows in the file → 3 added · 1 duplicate · 2 unknown

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-000000005001','hrd50@talaliving.com','{"full_name":"Staf HRD"}'),
  ('ffffffff-0000-0000-0000-000000005002','lihat50@talaliving.com','{"full_name":"Pimpinan"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-000000005001','hrd','write'),
  ('ffffffff-0000-0000-0000-000000005002','hrd','read');

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000005001';

insert into ops_hr.employees (id, employee_no, full_name, pay_basis, base_rate, allowance_rate, paid_leave_days)
values ('aaaa5000-0000-0000-0000-0000000000e1','B-0012','Joko Widodo','monthly', 4500000, 25000, 12),
       ('aaaa5000-0000-0000-0000-0000000000e2','B-0007','Siti Aminah','daily',     180000, 20000, 12);

/* ── REFUSAL: a read grant may look at attendance, not write it ────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000005002';
do $$
declare a jsonb; n int;
begin
  a := ops_hr.import_scans('mesin.csv','[{"employee_ref":"12","at":"2026-09-14T08:05:00+08"}]'::jsonb);
  assert a -> 'error' ->> 'code' = 'not_permitted', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');
  a := ops_hr.add_scan('B-0012','2026-09-14T08:05:00+08','lupa tap');
  assert a -> 'error' ->> 'code' = 'not_permitted', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');
  a := ops_hr.mark_day('2026-09-14','sick','demam','B-0012');
  assert a -> 'error' ->> 'code' = 'not_permitted', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');
  a := ops_hr.withhold_allowance('B-0012','2026-09-14','tidak masuk');
  assert a -> 'error' ->> 'code' = 'not_permitted', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');

  select count(*) into n from ops_hr.attendance_scans;
  assert n = 0, 'and nothing was written on the way to being refused, got ' || n;
end $$;

set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000005001';

/* ── DERIVATION: the file off the machine ──────────────────────────────── */
do $$
declare a jsonb; n int; v_import uuid;
begin
  a := ops_hr.import_scans('kosong.csv','[]'::jsonb);
  assert a -> 'error' ->> 'code' = 'empty_file', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');

  -- The machine prints `12`; the catalogue says `B-0012`. They are the same
  -- person and nothing in either system says so, so the refs are compared with
  -- the prefix off both sides.
  a := ops_hr.import_scans('mesin-14.csv', $j$[
    {"employee_ref":"0012","at":"2026-09-14T08:05:00+08","verify":"FP"},
    {"employee_ref":"12",  "at":"2026-09-14T17:02:00+08","verify":"FP"},
    {"employee_ref":"12",  "at":"2026-09-14T17:02:00+08","verify":"FP"},
    {"employee_ref":"7",   "at":"2026-09-14T07:58:00+08","verify":"FP"},
    {"employee_ref":"99",  "at":"2026-09-14T08:01:00+08","verify":"FP"},
    {"employee_ref":"99",  "at":"2026-09-14T17:30:00+08","verify":"FP"}
  ]$j$::jsonb,'k-50-import');
  assert ops_core.said_ok(a), 'got ' || coalesce(a -> 'error' ->> 'code', a::text);

  assert (a -> 'data' ->> 'seen')::int = 6,       'got ' || coalesce(a -> 'data' ->> 'seen','(null)');
  assert (a -> 'data' ->> 'added')::int = 3,      'two for Joko and one for Siti, got '
    || coalesce(a -> 'data' ->> 'added','(null)');
  -- The same tap twice **inside one file** is the same duplicate as the same
  -- tap across two uploads, and `scan_once` would have refused the whole file.
  assert (a -> 'data' ->> 'duplicates')::int = 1, 'got ' || coalesce(a -> 'data' ->> 'duplicates','(null)');
  -- Named, not merely counted: usually it is a finger registered under an old
  -- number, and guessing which one is how a day lands on the wrong payslip.
  assert a -> 'data' -> 'unknown' = '[{"ref":"99","count":2}]'::jsonb,
    'got ' || coalesce((a -> 'data' -> 'unknown')::text,'(null)');

  select count(*) into n from ops_hr.employees where employee_no like '%99%';
  assert n = 0, 'and no employee was conjured for it, got ' || n;

  -- The import row carries the same four figures, so *what did Tuesday''s file
  -- do* is answerable without replaying it.
  v_import := (a -> 'data' ->> 'import_id')::uuid;
  assert (select rows_added from ops_hr.attendance_imports where id = v_import) = 3, 'the row agrees';
  assert (select unknown_refs from ops_hr.attendance_imports where id = v_import)
         = '[{"ref":"99","count":2}]'::jsonb, 'and remembers who it could not place';

  -- **The office day, not the server''s** (F17, F39, F102). Siti tapped at
  -- 07:58 WITA, which is 23:58 the previous day in UTC — so this is the row
  -- that tells the two apart, and a tap at 08:05 would not have.
  assert (select work_date from ops_hr.attendance_scans
           where at = '2026-09-14T07:58:00+08') = '2026-09-14',
    'a tap before eight belongs to that morning, not to the night before, got '
    || coalesce((select work_date::text from ops_hr.attendance_scans
                  where at = '2026-09-14T07:58:00+08'),'(null)');

  -- Running the file again adds nothing.
  a := ops_hr.import_scans('mesin-14.csv', $j$[
    {"employee_ref":"0012","at":"2026-09-14T08:05:00+08"},
    {"employee_ref":"12",  "at":"2026-09-14T17:02:00+08"}
  ]$j$::jsonb);
  assert (a -> 'data' ->> 'added')::int = 0, 'got ' || coalesce(a -> 'data' ->> 'added','(null)');
  select count(*) into n from ops_hr.attendance_scans;
  assert n = 3, 'still three taps, got ' || n;

  -- And a retry with the key is the earlier answer, not a third run.
  a := ops_hr.import_scans('mesin-14.csv','[{"employee_ref":"12","at":"2026-09-15T08:00:00+08"}]'::jsonb,
                           'k-50-import');
  assert a ->> 'outcome' = 'duplicate', 'got ' || coalesce(a ->> 'outcome','(null)');
  select count(*) into n from ops_hr.attendance_scans;
  assert n = 3, 'and the replay added nothing, got ' || n;
end $$;

/* ── REFUSAL and DERIVATION: a tap the machine missed ──────────────────── */
do $$
declare a jsonb; s record;
begin
  a := ops_hr.add_scan('B-0012','2026-09-15T07:30:00+08','   ');
  assert a -> 'error' ->> 'code' = 'reason_required',
    'the whole value of source=manual is that a dispute can tell it from a tap, got '
    || coalesce(a -> 'error' ->> 'code','(null)');

  a := ops_hr.add_scan('B-9999','2026-09-15T07:30:00+08','lupa');
  assert a -> 'error' ->> 'code' = 'not_found', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');

  -- 07:30 WITA is 23:30 the night before in UTC, so this one crosses too.
  a := ops_hr.add_scan('B-0012','2026-09-15T07:30:00+08','mesin mati pagi itu');
  assert ops_core.said_ok(a), 'got ' || coalesce(a -> 'error' ->> 'code', a::text);

  select * into s from ops_hr.attendance_scans where at = '2026-09-15T07:30:00+08';
  assert s.work_date = '2026-09-15', 'the office day again, got ' || coalesce(s.work_date::text,'(null)');
  assert s.source = 'manual', 'got ' || coalesce(s.source::text,'(null)');
  assert s.reason = 'mesin mati pagi itu', 'and it says why';
  assert s.recorded_by = 'ffffffff-0000-0000-0000-000000005001', 'and who';

  a := ops_hr.add_scan('B-0012','2026-09-15T07:30:00+08','lagi');
  assert a -> 'error' ->> 'code' = 'already_recorded', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');
end $$;

/* ── REFUSAL and DERIVATION: marking a day ─────────────────────────────── */
do $$
declare a jsonb; v_no text; m record;
begin
  a := ops_hr.mark_day('2026-09-16','half_day','','B-0012');
  assert a -> 'error' ->> 'code' = 'reason_required',
    '*Setengah hari* with no reason is a decision nobody can check in six months, got '
    || coalesce(a -> 'error' ->> 'code','(null)');

  a := ops_hr.mark_day('2026-09-16','sick','demam','B-9999');
  assert a -> 'error' ->> 'code' = 'not_found', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');

  a := ops_hr.mark_day('2026-09-16','sick','demam, ada surat','B-0012');
  assert ops_core.said_ok(a), 'got ' || coalesce(a -> 'error' ->> 'code', a::text);
  v_no := a -> 'data' ->> 'mark_no';
  assert v_no like 'dmk-%', 'a mark is citable (F99, C11), got ' || coalesce(v_no,'(null)');
  assert not (a -> 'data' ->> 'office_wide')::boolean, 'this one is for a person';

  a := ops_hr.mark_day('2026-09-16','permit','izin keluarga','B-0012');
  assert a -> 'error' ->> 'code' = 'already_marked', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');

  -- A mark for everybody carries no employee at all (D142), and that is a
  -- different row from a personal one on the same day.
  a := ops_hr.mark_day('2026-09-16','holiday','maulid nabi');
  assert ops_core.said_ok(a), 'an office-wide mark is not a clash with a personal one, got '
    || coalesce(a -> 'error' ->> 'code', a::text);
  assert (a -> 'data' ->> 'office_wide')::boolean, 'and says so';
  assert ops_hr.office_closed('2026-09-16'), 'the office is shut that day';

  -- Marking is not editing: the taps are exactly where they were.
  assert (select count(*) from ops_hr.attendance_scans) = 4, 'the taps are untouched';
end $$;

/* ── DERIVATION: taking a mark back, which is not deleting it ──────────── */
do $$
declare a jsonb; v_no text; n int;
begin
  select mark_no into v_no from ops_hr.day_marks
   where work_date = '2026-09-16' and employee_id is not null;

  a := ops_hr.withdraw_mark(v_no,'  ');
  assert a -> 'error' ->> 'code' = 'reason_required',
    '*why was it marked sick and then not* is the question a payslip query asks, got '
    || coalesce(a -> 'error' ->> 'code','(null)');

  a := ops_hr.withdraw_mark(v_no,'salah orang, yang sakit adiknya');
  assert ops_core.said_ok(a), 'got ' || coalesce(a -> 'error' ->> 'code', a::text);

  -- **Not deleted.** Both the marking and the withdrawing stay, which is the
  -- whole difference from the demo (A2).
  select count(*) into n from ops_hr.day_marks where mark_no = v_no;
  assert n = 1, 'the row is still there, got ' || n;
  assert (select withdrawn_reason from ops_hr.day_marks where mark_no = v_no)
         = 'salah orang, yang sakit adiknya', 'with the reason on it';
  assert (select withdrawn_by from ops_hr.day_marks where mark_no = v_no)
         = 'ffffffff-0000-0000-0000-000000005001', 'and who took it back';

  a := ops_hr.withdraw_mark(v_no,'lagi');
  assert a -> 'error' ->> 'code' = 'already_withdrawn', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');

  -- And the day is free again, which is the operational point: a day marked
  -- by mistake must be markable correctly.
  a := ops_hr.mark_day('2026-09-16','permit','izin, tidak dibayar','B-0012');
  assert ops_core.said_ok(a), 'the day can be marked again, got '
    || coalesce(a -> 'error' ->> 'code', a::text);
end $$;

/* ── DERIVATION: a withdrawn mark stops counting everywhere ────────────── */
do $$
declare a jsonb; v_no text; n int; d record;
begin
  -- Four days of leave in one year, then one of them taken back. The
  -- entitlement has to follow, or somebody loses a day of leave to a
  -- correction.
  a := ops_hr.mark_day('2026-03-02','leave','cuti tahunan','B-0007');
  a := ops_hr.mark_day('2026-03-03','leave','cuti tahunan','B-0007');
  a := ops_hr.mark_day('2026-03-04','leave','cuti tahunan','B-0007');
  a := ops_hr.mark_day('2026-03-05','leave','cuti tahunan','B-0007');
  select v.leave_days_taken into n from ops_hr.v_leave_used v
   where v.employee_no = 'B-0007' and v.year = 2026;
  assert n = 4, 'four days spent, got ' || coalesce(n::text,'(null)');

  select mark_no into v_no from ops_hr.day_marks
   where work_date = '2026-03-05' and employee_id = 'aaaa5000-0000-0000-0000-0000000000e2';
  a := ops_hr.withdraw_mark(v_no,'ternyata masuk, tap-nya gagal');
  assert ops_core.said_ok(a), 'got ' || coalesce(a -> 'error' ->> 'code', a::text);

  select v.leave_days_taken into n from ops_hr.v_leave_used v
   where v.employee_no = 'B-0007' and v.year = 2026;
  assert n = 3, 'and the entitlement follows, got ' || coalesce(n::text,'(null)');

  -- The mark list too, and the timesheet through `read_day`.
  select count(*) into n from ops_hr.v_day_mark_value where mark_no = v_no;
  assert n = 0, 'a withdrawn mark is off the list, got ' || n;

  select * into d from ops_hr.v_timesheet_day
   where employee_no = 'B-0007' and work_date = '2026-03-05';
  assert d.state is distinct from 'marked',
    'and off the timesheet, got ' || coalesce(d.state,'(null)');
end $$;

/* ── REFUSAL and DERIVATION: the allowance for a day ───────────────────── */
do $$
declare a jsonb; w record;
begin
  a := ops_hr.withhold_allowance('B-0012','2026-09-17','');
  assert a -> 'error' ->> 'code' = 'reason_required', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');

  a := ops_hr.restore_allowance('B-0012','2026-09-17','salah');
  assert a -> 'error' ->> 'code' = 'not_found',
    'nothing to give back if nothing was taken, got ' || coalesce(a -> 'error' ->> 'code','(null)');

  a := ops_hr.withhold_allowance('B-0012','2026-09-17','tidak masuk tanpa kabar');
  assert ops_core.said_ok(a), 'got ' || coalesce(a -> 'error' ->> 'code', a::text);

  a := ops_hr.withhold_allowance('B-0012','2026-09-17','lagi');
  assert a -> 'error' ->> 'code' = 'already_withheld', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');

  a := ops_hr.restore_allowance('B-0012','2026-09-17','ternyata ada kabar, sakit');
  assert ops_core.said_ok(a), 'got ' || coalesce(a -> 'error' ->> 'code', a::text);

  -- **Beside, not instead of.** The payslip can show that a deduction was made
  -- and taken back, rather than showing neither (A5).
  select * into w from ops_hr.allowance_withholdings
   where employee_id = 'aaaa5000-0000-0000-0000-0000000000e1' and work_date = '2026-09-17';
  assert w.reason = 'tidak masuk tanpa kabar', 'the withholding is still readable';
  assert w.restored_reason = 'ternyata ada kabar, sakit', 'and so is the reversal';

  a := ops_hr.restore_allowance('B-0012','2026-09-17','sekali lagi');
  assert a -> 'error' ->> 'code' = 'already_restored', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');
end $$;

rollback;
