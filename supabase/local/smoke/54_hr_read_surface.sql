-- hr — the four reads the screens make and the database did not answer
-- (D158, D279, Q53, ADR-009).
--
--   REFUSALS     a surat dokter on a day marked anything but sakit; on a mark
--                nobody made; with a read grant
--   DERIVATIONS  **a week is costed without opening a run** and the same week
--                costs the same once a run is opened; the totals a screen shows
--                come from one read rather than a browser summing money; the
--                working patterns say who is on one **by name**, who is on one
--                **by assumption**, and who is on none at all; a schedule
--                nobody has finished describing has no hours rather than zero
--                hours; a surat dokter turns an unpaid sick day into a paid one

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-000000005701','hrd57@talaliving.com','{"full_name":"Staf HRD"}'),
  ('ffffffff-0000-0000-0000-000000005702','lihat57@talaliving.com','{"full_name":"Pembaca"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-000000005701','hrd','write'),
  ('ffffffff-0000-0000-0000-000000005701','payroll','write'),
  ('ffffffff-0000-0000-0000-000000005702','hrd','read');

insert into ops_hr.pay_rule_sets (version, effective_from, note, rules, created_by) values
 (1, current_date, 'versi uji', '{
   "week_pattern": "6day",
   "day_starts_minutes": 480,
   "schedules": [
     {"code":"produksi","name":"Produksi","start_minutes":450,"end_minutes":990,
      "break_minutes":45,"friday_break_minutes":90,"note":null},
     {"code":"kantor","name":"Kantor","start_minutes":480,"end_minutes":1035,
      "break_minutes":60,"friday_break_minutes":null,"note":null},
     {"code":"shift-malam","name":"Shift malam","start_minutes":null,"end_minutes":null,
      "break_minutes":null,"friday_break_minutes":null,"note":"belum dipastikan"}
   ],
   "schedule_by_unit": {"Produksi":"produksi","Kantor":"kantor"}
 }'::jsonb, 'ffffffff-0000-0000-0000-000000005701'),
 -- **A second version, in force from the middle of the week below.** The
 -- payroll reads the book in force when the period *opened*, which is the whole
 -- reason the book is dated (D173) — so this one must change nothing about the
 -- week that starts today, and the assertions below are how we know it did not.
 (2, ops_core.office_day() + 3, 'basis jam pindah ke statutori', '{
   "week_pattern": "6day",
   "hourly_basis": "statutory",
   "schedules": []
 }'::jsonb, 'ffffffff-0000-0000-0000-000000005701');

insert into ops_core.attachments (id, storage_path, filename, mime, bytes, source, uploaded_by)
values ('bbbb5700-0000-0000-0000-0000000000f1','drive/surat-dokter.jpg','surat-dokter.jpg',
        'image/jpeg', 90000,'web','ffffffff-0000-0000-0000-000000005701');

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000005701';

insert into ops_hr.employees (id, employee_no, full_name, unit, schedule_code, pay_basis,
                              base_rate, allowance_rate, paid_leave_days)
values
  -- Linked by name: a decision somebody took.
  ('aaaa5700-0000-0000-0000-0000000000e1','B-0012','Joko','Produksi','produksi','monthly', 4500000, 25000, 12),
  -- On a pattern only because the unit defaults to it: an assumption.
  ('aaaa5700-0000-0000-0000-0000000000e2','B-0007','Siti','Kantor', null,'daily', 180000, 20000, 12),
  -- Nobody linked her and her unit has no default: no clock at all to judge
  -- her against, which is the gap HR is asked to close (F70).
  ('aaaa5700-0000-0000-0000-0000000000e3','B-0044','Rina','Gudang', null,'daily', 170000, 20000, 12),
  -- Left in the middle of the week below. Still owed the days he worked.
  ('aaaa5700-0000-0000-0000-0000000000e4','B-0055','Bambang','Produksi','produksi','daily', 170000, 20000, 12),
  -- Left in August, and still on a pattern in the rule book. Neither the roll
  -- nor the period should count him.
  ('aaaa5700-0000-0000-0000-0000000000e5','B-0066','Hendra','Produksi','produksi','daily', 170000, 20000, 12);
update ops_hr.employees set active = false, left_on = ops_core.office_day() + 2
 where employee_no = 'B-0055';
update ops_hr.employees set active = false, left_on = '2026-08-30'
 where employee_no = 'B-0066';

/* ── DERIVATION: the working patterns, and the three states ─────────────── */
do $$
declare j jsonb; s jsonb;
begin
  j := ops_hr.schedule_roll();
  assert j ->> 'week_pattern' = '6day', 'got ' || coalesce(j ->> 'week_pattern','(null)');
  assert jsonb_array_length(j -> 'schedules') = 3, 'got ' || jsonb_array_length(j -> 'schedules');

  select value into s from jsonb_array_elements(j -> 'schedules')
   where value ->> 'code' = 'produksi';
  -- 07:30 to 16:30 less 45 minutes.
  assert (s -> 'hours' ->> 'daily_hours')::numeric = 8.25, 'got ' || (s -> 'hours' ->> 'daily_hours');
  -- **Friday counted at its own length.** A longer break on one day of six is
  -- not a rounding difference, it is most of an hour a week.
  assert (s -> 'hours' ->> 'friday_hours')::numeric = 7.5, 'got ' || (s -> 'hours' ->> 'friday_hours');
  assert (s -> 'hours' ->> 'weekly_hours')::numeric = 48.75,
    'five ordinary days and a Friday, got ' || (s -> 'hours' ->> 'weekly_hours');
  -- Joko, by name. **Not Bambang or Hendra**: somebody who has left is not on a
  -- working pattern, whatever the column still says.
  assert (s ->> 'assigned')::int = 1, 'Joko, by name, got ' || (s ->> 'assigned');
  assert (s ->> 'inherited')::int = 0, 'got ' || (s ->> 'inherited');
  assert s -> 'units' = '["Produksi"]'::jsonb, 'got ' || coalesce((s -> 'units')::text,'(null)');

  select value into s from jsonb_array_elements(j -> 'schedules') where value ->> 'code' = 'kantor';
  assert (s -> 'hours' ->> 'friday_hours') is null, 'no separate Friday rule stated';
  -- 08:00 to 17:15 less an hour, six days: no Friday rule, so every day is
  -- the same length.
  assert (s -> 'hours' ->> 'weekly_hours')::numeric = 49.5, 'got ' || (s -> 'hours' ->> 'weekly_hours');
  assert (s -> 'hours' ->> 'monthly_hours')::numeric = 214.5,
    'the week times fifty-two over twelve, got ' || (s -> 'hours' ->> 'monthly_hours');
  assert (s ->> 'assigned')::int = 0, 'nobody chose it, got ' || (s ->> 'assigned');
  assert (s ->> 'inherited')::int = 1, 'Siti is on it by assumption, got ' || (s ->> 'inherited');

  -- A pattern nobody has finished describing has **no** hours, not nought
  -- hours, and says what is missing.
  select value into s from jsonb_array_elements(j -> 'schedules') where value ->> 'code' = 'shift-malam';
  assert (s -> 'hours' ->> 'daily_hours') is null, 'got ' || coalesce(s -> 'hours' ->> 'daily_hours','(null)');
  assert s -> 'hours' ->> 'blocked_by' like 'Belum ada jam masuk, jam pulang, istirahat%',
    'got ' || coalesce(s -> 'hours' ->> 'blocked_by','(null)');
  assert (s -> 'hours' ->> 'days_per_week')::int = 6, 'the week is still six days long';

  -- Named, not just counted: *setiap karyawan punya jadwal tertaut* is not yet
  -- true and the screen says who it is not true of.
  assert jsonb_array_length(j -> 'unlinked') = 1, 'got ' || jsonb_array_length(j -> 'unlinked');
  assert j -> 'unlinked' -> 0 ->> 'employee_no' = 'B-0044', 'got '
    || coalesce(j -> 'unlinked' -> 0 ->> 'employee_no','(null)');
  assert jsonb_array_length(j -> 'inherited') = 1, 'got ' || jsonb_array_length(j -> 'inherited');
  assert j -> 'inherited' -> 0 ->> 'schedule_code' = 'kantor', 'and which one it assumed';
end $$;

/* ── DERIVATION: a week is costed before anybody opens a run (D158) ─────── */
do $$
declare t ops_hr.payroll_totals_t; n int; a jsonb; v_no text; f ops_hr.payroll_figures;
  v_from date := ops_core.office_day(); v_to date := ops_core.office_day() + 6;
begin
  select count(*) into n from ops_hr.period_lines(v_from, v_to);
  -- Three still here, plus Bambang, who leaves on Wednesday and is owed the two
  -- days before it. Not Hendra, who left in August.
  assert n = 4, 'got ' || n;
  assert exists (select 1 from ops_hr.period_lines(v_from, v_to) l where l.employee_no = 'B-0055'),
    'somebody who leaves mid-period is still owed the days they worked';
  assert not exists (select 1 from ops_hr.period_lines(v_from, v_to) l where l.employee_no = 'B-0066'),
    'and somebody who left before it started is not on it';

  -- **The book in force when the period opened** (D173). Version 2 lands on the
  -- Thursday and moves the hourly basis; this week is still costed under
  -- version 1, and would read `statutory` if the period's end picked the book.
  f := ops_hr.payroll_line_for('aaaa5700-0000-0000-0000-0000000000e1', v_from, v_to);
  assert f.hourly_basis = 'company',
    'the week is costed under the book it opened under, got ' || coalesce(f.hourly_basis,'(null)');

  t := ops_hr.payroll_totals(v_from, v_to);
  assert t.people = 4, 'got ' || t.people;
  assert t.gross_total > 0, 'a monthly salary is owed whether or not anybody opened a run';
  assert t.adjustment_total = 0, 'and nothing has been moved by hand, got ' || t.adjustment_total;
  assert t.net_total = t.gross_total, 'so the net is the gross';

  -- **Overtime nobody has signed is counted apart** — those hours are not in
  -- the figures and land on the next run, and a payroll screen that did not say
  -- so would be quietly short (A6).
  a := ops_hr.create_overtime_sheet('production', v_from + 1,'kejar kirim');
  assert ops_core.said_ok(a), 'got ' || coalesce(a -> 'error' ->> 'code', a::text);
  a := ops_hr.add_overtime_line(a -> 'data' ->> 'sheet_no','B-0012', 3,'amplas');
  assert ops_core.said_ok(a), 'got ' || coalesce(a -> 'error' ->> 'code', a::text);
  t := ops_hr.payroll_totals(v_from, v_to);
  assert t.pending_overtime_hours = 3,
    'three hours waiting for a signature, got ' || t.pending_overtime_hours;

  -- Open the run over the same week. **The same figures**: opening a run adds a
  -- document, not a calculation (A3).
  a := ops_hr.open_payroll_run(v_from, v_to);
  v_no := a -> 'data' ->> 'run_no';
  assert (ops_hr.payroll_totals(v_from, v_to, v_no)).gross_total = t.gross_total,
    'opening a run is a document, not a calculation';

  -- And an adjustment moves the net and leaves the gross alone.
  a := ops_hr.add_adjustment(v_no,'B-0012','bonus', 150000,'lembur borongan');
  assert ops_core.said_ok(a), 'got ' || coalesce(a -> 'error' ->> 'code', a::text);
  select * into t from ops_hr.payroll_totals(v_from, v_to, v_no) t;
  assert t.adjustment_total = 150000, 'got ' || t.adjustment_total;
  assert t.net_total = t.gross_total + 150000, 'got ' || t.net_total;

  -- Read without the run number, the same week carries none of it: an
  -- adjustment belongs to the run, not to the week (D155).
  assert (ops_hr.payroll_totals(v_from, v_to)).adjustment_total = 0,
    'an adjustment is the run''s, not the week''s';
end $$;

/* ── DERIVATION: the old name still answers, through the new body ───────── */
do $$
declare f ops_hr.payroll_figures; v_no text;
begin
  select run_no into v_no from ops_hr.payroll_runs;
  f := ops_hr.payroll_line('aaaa5700-0000-0000-0000-0000000000e1', v_no);
  assert f.run_no = v_no, 'got ' || coalesce(f.run_no,'(null)');
  assert f.adjustment_total = 150000, 'and the wrapper carries the run through, got '
    || f.adjustment_total;
  -- A period with no run carries an empty run number rather than inventing one:
  -- a payslip must not be printable for a run that does not exist.
  f := ops_hr.payroll_line_for('aaaa5700-0000-0000-0000-0000000000e1',
                               ops_core.office_day() + 30, ops_core.office_day() + 36);
  assert f.run_no = '', 'got "' || coalesce(f.run_no,'(null)') || '"';
end $$;

/* ── REFUSAL and DERIVATION: the surat dokter ───────────────────────────── */
do $$
declare a jsonb; v_sick text; v_izin text; d ops_hr.day_reading;
begin
  a := ops_hr.mark_day('2026-09-16','sick','demam','B-0012');
  assert ops_core.said_ok(a), 'got ' || coalesce(a -> 'error' ->> 'code', a::text);
  v_sick := a -> 'data' ->> 'mark_no';
  a := ops_hr.mark_day('2026-09-17','permit','urusan keluarga','B-0012');
  v_izin := a -> 'data' ->> 'mark_no';

  a := ops_hr.attach_surat_dokter('dmk-99-99-99_01','bbbb5700-0000-0000-0000-0000000000f1');
  assert a -> 'error' ->> 'code' = 'not_found', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');

  -- The rule this seam exists for. `read_day` looks for the letter only on a
  -- sick mark, so one filed against an izin would change nothing and say
  -- nothing — the worst of the three possible behaviours.
  a := ops_hr.attach_surat_dokter(v_izin,'bbbb5700-0000-0000-0000-0000000000f1');
  assert a -> 'error' ->> 'code' = 'not_a_sick_day', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');

  -- Sick with no letter is recorded and not paid.
  select * into d from ops_hr.read_day('aaaa5700-0000-0000-0000-0000000000e1','2026-09-16');
  assert d.day_value = 0, 'got ' || d.day_value;

  a := ops_hr.attach_surat_dokter(v_sick,'bbbb5700-0000-0000-0000-0000000000f1','k-57-surat');
  assert ops_core.said_ok(a), 'got ' || coalesce(a -> 'error' ->> 'code', a::text);
  assert (a -> 'data' ->> 'day_value')::numeric = 1,
    'the letter is what makes the day paid (D144), got ' || coalesce(a -> 'data' ->> 'day_value','(null)');

  select * into d from ops_hr.read_day('aaaa5700-0000-0000-0000-0000000000e1','2026-09-16');
  assert d.day_value = 1, 'and the timesheet agrees, got ' || d.day_value;

  -- One road: the link is on the evidence road, filed by the documents seam.
  assert exists (select 1 from ops_core.attachment_links l
                  where l.entity = 'day_mark' and l.entity_no = v_sick
                    and l.kind = 'surat_dokter' and l.unlinked_at is null),
    'the file went on the one road there is';

  -- A replay files one letter, not two.
  a := ops_hr.attach_surat_dokter(v_izin,'bbbb5700-0000-0000-0000-0000000000f1','k-57-surat');
  assert a ->> 'outcome' = 'duplicate', 'got ' || coalesce(a ->> 'outcome','(null)');
  assert a -> 'data' ->> 'mark_no' = v_sick, 'the remembered answer, got '
    || coalesce(a -> 'data' ->> 'mark_no','(null)');
end $$;

/* ── DERIVATION: a day, and whether anybody can still change the answer ─── */
do $$
declare r ops_hr.timesheet_row; n int; a jsonb;
begin
  a := ops_hr.mark_day('2026-09-17','sick','batuk','B-0007');
  assert ops_core.said_ok(a), 'got ' || coalesce(a -> 'error' ->> 'code', a::text);

  -- Sick with no letter is unpaid **and fixable**: saying so while the letter
  -- can still arrive is the difference between a screen and a receipt (D144).
  select * into r from ops_hr.timesheet_rows('2026-09-17','2026-09-17', null,'B-0007');
  assert r.day_value = 0, 'got ' || r.day_value;
  assert r.fixable like 'Surat dokter belum ada%', 'got ' || coalesce(r.fixable,'(null)');

  -- The day the letter reached is not fixable, because there is nothing left
  -- to fix.
  select * into r from ops_hr.timesheet_rows('2026-09-16','2026-09-16', null,'B-0012');
  assert r.day_value = 1, 'got ' || r.day_value;
  assert r.fixable is null, 'got ' || coalesce(r.fixable,'(null)');

  -- An ordinary day nobody marked says nothing either.
  select * into r from ops_hr.timesheet_rows('2026-09-18','2026-09-18', null,'B-0012');
  assert r.fixable is null, 'got ' || coalesce(r.fixable,'(null)');

  -- **Somebody who has left is not on the timesheet.** Their days are settled;
  -- a screen that kept drawing empty rows for them would have HRD reading
  -- absence as absence.
  select count(*) into n from ops_hr.timesheet_rows('2026-09-14','2026-09-20')
   where employee_no = 'B-0066';
  assert n = 0, 'got ' || n;
  -- One row per person per day, and the unit narrows it.
  select count(*) into n from ops_hr.timesheet_rows('2026-09-14','2026-09-20','Kantor');
  assert n = 7, 'seven days for the one person in Kantor, got ' || n;
end $$;

/* ── DERIVATION: the allowance a day did not earn ───────────────────────── */
do $$
declare a jsonb; w ops_hr.v_allowance_withholding%rowtype;
begin
  a := ops_hr.withhold_allowance('B-0012','2026-09-18','tidak pakai sepatu safety');
  assert ops_core.said_ok(a), 'got ' || coalesce(a -> 'error' ->> 'code', a::text);

  select * into w from ops_hr.v_allowance_withholding where employee_no = 'B-0012';
  assert w.full_name = 'Joko', 'got ' || coalesce(w.full_name,'(null)');
  assert w.by_name = 'Staf HRD', 'who decided, by name, got ' || coalesce(w.by_name,'(null)');
  assert w.amount = 25000, 'what it costs that day, got ' || w.amount;
  assert w.live, 'and it is still withheld';
  assert w.restored_by_name is null, 'nobody has put it back';
  a := ops_hr.restore_allowance('B-0012','2026-09-18','sepatunya ternyata rusak, sudah diganti');
  assert ops_core.said_ok(a), 'got ' || coalesce(a -> 'error' ->> 'code', a::text);

  select * into w from ops_hr.v_allowance_withholding where employee_no = 'B-0012';
  -- **The row stays** (A2) — *kenapa tunjangan saya dipotong minggu lalu* is
  -- asked afterwards — and it stops being live.
  assert not w.live, 'a restored withholding is not withheld any more';
  assert w.restored_by_name = 'Staf HRD', 'got ' || coalesce(w.restored_by_name,'(null)');
  assert w.restored_reason like 'sepatunya%', 'and says why';
end $$;

/* ── REFUSAL: a read grant files nothing ────────────────────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000005702';
do $$
declare a jsonb; v_mark text;
begin
  select mark_no into v_mark from ops_hr.day_marks where kind = 'permit';
  a := ops_hr.attach_surat_dokter(v_mark,'bbbb5700-0000-0000-0000-0000000000f1');
  assert a -> 'error' ->> 'code' = 'not_permitted', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');
end $$;

rollback;
