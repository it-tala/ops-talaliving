-- hr, the reading — six slots, and what happens when they do not fit.
--
-- This is the half of HR that decides money without anybody deciding
-- anything: a day's taps read against the rule, and a `review` the moment the
-- reading fails. The assertions below are the 48-days-out-of-227 case (F40,
-- D141) written down — a day the rule cannot place is worth nothing until a
-- person looks at it, and it must never be quietly worth a full day.
--
--   REFUSAL      the reading runs as the reader, so somebody with no HR grant
--                gets no rows rather than somebody else's hours
--   DERIVATIONS  an ordinary day; a night with lembur; two taps inside two
--                minutes that are one arrival; a day with no pulang; a tap the
--                rule cannot place; a break past its allowance (a note, never
--                an issue); a marked day whose hours stop counting; tanggal
--                merah, where the hours become overtime and the day itself is
--                worth nothing

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-0000000000c1','wulan@talaliving.com','{"full_name":"Wulan Sari"}'),
  ('ffffffff-0000-0000-0000-0000000000c2','tamu@talaliving.com','{"full_name":"Tamu Lewat"}');

insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-0000000000c1','hrd','write'),
  ('ffffffff-0000-0000-0000-0000000000c1','it','write'),
  ('ffffffff-0000-0000-0000-0000000000c2','dashboard','read');

insert into ops_hr.employees (id, employee_no, full_name, unit, schedule_code, pay_basis, base_rate, paid_leave_days)
values ('aaaa0000-0000-0000-0000-00000000d001','B-201','Agus Salim','Produksi','produksi','daily',180000,2);

insert into ops_core.attachments (id, storage_path, filename, uploaded_by) values
  ('44440000-0000-0000-0000-0000000000c1','a/x.jpg','x.jpg','ffffffff-0000-0000-0000-0000000000c1');

-- The book. Produksi is 07.30–16.30 with 45 minutes of break, the office
-- 08.00–17.15 with an hour, and Friday is longer for both (Q44, D274).
insert into ops_hr.pay_rule_sets (version, effective_from, note, rules, created_by) values
 (1, current_date, 'versi uji', '{
   "week_pattern": "6day",
   "day_starts_minutes": 480,
   "schedules": [
     {"code":"produksi","name":"Produksi","start_minutes":450,"end_minutes":990,
      "break_minutes":45,"friday_break_minutes":90,"note":null},
     {"code":"kantor","name":"Kantor","start_minutes":480,"end_minutes":1035,
      "break_minutes":60,"friday_break_minutes":90,"note":null}
   ],
   "schedule_by_unit": {"Produksi":"produksi","Kantor":"kantor"}
 }'::jsonb, 'ffffffff-0000-0000-0000-0000000000c1');

set local role authenticated;

/* ── REFUSAL: the reading runs as the reader ───────────────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-0000000000c2';
do $$
declare n int;
begin
  assert not ops_core.has_permission('hrd.read'), 'a dashboard grant is not HR';
  select count(*) into n from ops_hr.read_day('aaaa0000-0000-0000-0000-00000000d001','2026-08-24');
  assert n = 0, 'somebody with no HR grant reads no hours, got ' || n;
  select count(*) into n from ops_hr.v_timesheet_day;
  assert n = 0, 'and the view is empty for them too, got ' || n;
end $$;

set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-0000000000c1';

/* ── DERIVATION: an ordinary day, and the four slots ───────────────────── */
do $$
declare d ops_hr.day_reading; imp uuid;
begin
  insert into ops_hr.attendance_imports (filename, rows_seen, imported_by)
  values ('agustus.dat', 20,'ffffffff-0000-0000-0000-0000000000c1') returning id into imp;

  insert into ops_hr.attendance_scans (employee_id, work_date, at, source, import_id, recorded_by)
  select 'aaaa0000-0000-0000-0000-00000000d001','2026-08-24', t, 'import', imp,
         'ffffffff-0000-0000-0000-0000000000c1'
    from unnest(array['2026-08-24 07:28+08','2026-08-24 12:05+08',
                      '2026-08-24 12:50+08','2026-08-24 17:02+08']::timestamptz[]) t;

  select * into d from ops_hr.read_day('aaaa0000-0000-0000-0000-00000000d001','2026-08-24');
  assert d.taps = 4,            'four taps, got ' || d.taps;
  assert d.unplaced = 0,        'all of them placed, got ' || d.unplaced;
  assert d.break_hours = 0.75,  'istirahat 45 menit, got ' || d.break_hours;
  assert d.work_hours = 8.82,   '9,57 jam kotor kurang istirahat, got ' || d.work_hours;
  assert d.state = 'complete',  'a day the rule read fine is complete, got ' || d.state;
  assert d.day_value = 1,       'and worth a full day, got ' || d.day_value;
  assert d.notes = '{}',        'exactly at the 45-minute allowance is not over it';
end $$;

/* ── DERIVATION: lembur is the pair after pulang ───────────────────────── */
do $$
declare d ops_hr.day_reading;
begin
  insert into ops_hr.attendance_scans (employee_id, work_date, at, source, reason, recorded_by)
  select 'aaaa0000-0000-0000-0000-00000000d001','2026-08-25', t, 'manual','uji lembur',
         'ffffffff-0000-0000-0000-0000000000c1'
    from unnest(array['2026-08-25 07:30+08','2026-08-25 12:00+08','2026-08-25 12:45+08',
                      '2026-08-25 17:00+08','2026-08-25 18:00+08','2026-08-25 20:30+08']::timestamptz[]) t;

  select * into d from ops_hr.read_day('aaaa0000-0000-0000-0000-00000000d001','2026-08-25');
  assert d.taps = 6,               'six taps on a lembur night, got ' || d.taps;
  assert d.overtime_hours = 2.5,   'two and a half hours past pulang, got ' || d.overtime_hours;
  assert d.state = 'complete',     'still a complete day, got ' || d.state;
  -- Shown on the machine is not the same as claimed and approved (D138).
  assert d.day_value = 1,          'the day itself is one day, got ' || d.day_value;
end $$;

/* ── DERIVATION: two taps inside two minutes are one arrival (D141) ────── */
do $$
declare d ops_hr.day_reading;
begin
  insert into ops_hr.attendance_scans (employee_id, work_date, at, source, reason, recorded_by)
  select 'aaaa0000-0000-0000-0000-00000000d001','2026-08-26', t, 'manual','uji dedupe',
         'ffffffff-0000-0000-0000-0000000000c1'
    from unnest(array['2026-08-26 07:28+08','2026-08-26 07:28:40+08',
                      '2026-08-26 12:00+08','2026-08-26 12:45+08','2026-08-26 17:00+08']::timestamptz[]) t;

  select * into d from ops_hr.read_day('aaaa0000-0000-0000-0000-00000000d001','2026-08-26');
  assert d.taps = 4,          'the finger that did not take the first time is one arrival, got ' || d.taps;
  assert d.unplaced = 0,      'and nothing is left over, got ' || d.unplaced;
  assert d.state = 'complete','so the day reads fine, got ' || d.state;
end $$;

/* ── DERIVATION: a day with no pulang is read by a person, not guessed ─── */
do $$
declare d ops_hr.day_reading;
begin
  insert into ops_hr.attendance_scans (employee_id, work_date, at, source, reason, recorded_by)
  select 'aaaa0000-0000-0000-0000-00000000d001','2026-08-27', t, 'manual','uji tanpa pulang',
         'ffffffff-0000-0000-0000-0000000000c1'
    from unnest(array['2026-08-27 07:30+08','2026-08-27 12:00+08','2026-08-27 12:45+08']::timestamptz[]) t;

  select * into d from ops_hr.read_day('aaaa0000-0000-0000-0000-00000000d001','2026-08-27');
  assert d.state = 'review',  'no pulang is a day somebody must read, got ' || d.state;
  assert d.day_value = 0,     'and it is worth nothing until they do, got ' || d.day_value;
  assert 'No pulang — the day has no end' = any(d.issues), 'and it says which, got ' || d.issues::text;
end $$;

/* ── DERIVATION: a tap the rule cannot place is the loudest signal ─────── */
do $$
declare d ops_hr.day_reading;
begin
  insert into ops_hr.attendance_scans (employee_id, work_date, at, source, reason, recorded_by)
  select 'aaaa0000-0000-0000-0000-00000000d001','2026-08-29', t, 'manual','uji tap nyasar',
         'ffffffff-0000-0000-0000-0000000000c1'
    from unnest(array['2026-08-29 07:30+08','2026-08-29 09:15+08']::timestamptz[]) t;

  select * into d from ops_hr.read_day('aaaa0000-0000-0000-0000-00000000d001','2026-08-29');
  assert d.unplaced = 1,     'the 09:15 tap fits no slot, got ' || d.unplaced;
  assert d.state = 'review', 'so the day is unread, got ' || d.state;
  assert d.issues[1] like '%09:15%', 'and the time is named, got ' || d.issues[1];
end $$;

/* ── DERIVATION: a long break is reported, never deducted ──────────────── */
do $$
declare d ops_hr.day_reading;
begin
  -- 60 minutes against produksi's 45 (Monday, so not Friday's longer rule).
  insert into ops_hr.attendance_scans (employee_id, work_date, at, source, reason, recorded_by)
  select 'aaaa0000-0000-0000-0000-00000000d001','2026-08-31', t, 'manual','uji istirahat',
         'ffffffff-0000-0000-0000-0000000000c1'
    from unnest(array['2026-08-31 07:30+08','2026-08-31 12:00+08',
                      '2026-08-31 13:00+08','2026-08-31 17:00+08']::timestamptz[]) t;

  select * into d from ops_hr.read_day('aaaa0000-0000-0000-0000-00000000d001','2026-08-31');
  assert d.break_hours = 1,     'an hour of break, got ' || d.break_hours;
  assert d.state = 'complete',  'over the allowance is not a broken reading, got ' || d.state;
  assert d.day_value = 1,       'and nothing is deducted for it, got ' || d.day_value;
  assert d.issues = '{}',       'it is never an issue';
  assert d.notes[1] like '%lewat 15 menit dari jatah 45 menit%', 'the note says by how much, got ' || coalesce(d.notes[1],'(none)');
end $$;

/* ── DERIVATION: a marked day stops counting hours (D142) ──────────────── */
do $$
declare d ops_hr.day_reading;
begin
  insert into ops_hr.attendance_scans (employee_id, work_date, at, source, reason, recorded_by)
  select 'aaaa0000-0000-0000-0000-00000000d001','2026-09-01', t, 'manual','uji sakit',
         'ffffffff-0000-0000-0000-0000000000c1'
    from unnest(array['2026-09-01 07:30+08','2026-09-01 12:00+08',
                      '2026-09-01 12:45+08','2026-09-01 17:00+08']::timestamptz[]) t;
  insert into ops_hr.day_marks (employee_id, work_date, kind, reason, marked_by)
  values ('aaaa0000-0000-0000-0000-00000000d001','2026-09-01','sick','demam','ffffffff-0000-0000-0000-0000000000c1');

  select * into d from ops_hr.read_day('aaaa0000-0000-0000-0000-00000000d001','2026-09-01');
  assert d.state = 'marked',   'a mark is a decision with a person behind it, got ' || d.state;
  assert d.taps = 4,           'the taps are untouched — it is the counting that stops, got ' || d.taps;
  assert d.work_hours = 0,     'and no hours are counted, got ' || d.work_hours;
  assert d.day_value = 0,      'sakit with no letter is unpaid, got ' || d.day_value;
  assert d.why like '%tanpa surat dokter%', 'and says why, got ' || d.why;
end $$;

/* ── DERIVATION: tanggal merah — the hours are overtime, the day is not ── */
do $$
declare d ops_hr.day_reading;
begin
  insert into ops_hr.attendance_scans (employee_id, work_date, at, source, reason, recorded_by)
  select 'aaaa0000-0000-0000-0000-00000000d001','2026-08-30', t, 'manual','uji tanggal merah',
         'ffffffff-0000-0000-0000-0000000000c1'
    from unnest(array['2026-08-30 08:00+08','2026-08-30 12:00+08',
                      '2026-08-30 12:45+08','2026-08-30 15:00+08']::timestamptz[]) t;
  insert into ops_hr.day_marks (employee_id, work_date, kind, reason, marked_by)
  values (null,'2026-08-30','holiday','Libur nasional','ffffffff-0000-0000-0000-0000000000c1');

  select * into d from ops_hr.read_day('aaaa0000-0000-0000-0000-00000000d001','2026-08-30');
  assert d.day_value = 0,       'the day itself is not a working day, got ' || d.day_value;
  assert d.work_hours = 0,      'so it holds no ordinary hours, got ' || d.work_hours;
  assert d.overtime_hours > 6,  'being there at all is overtime, got ' || d.overtime_hours;
  assert d.why like '%lembur%', 'and the sentence says so, got ' || d.why;
end $$;

/* ── DERIVATION: the period includes the days with nothing on them ─────── */
do $$
declare n_off int; n_all int;
begin
  select count(*) into n_all from ops_hr.timesheet('aaaa0000-0000-0000-0000-00000000d001','2026-08-24','2026-09-01');
  assert n_all = 9, 'nine days in the period, got ' || n_all;

  select count(*) into n_off from ops_hr.timesheet('aaaa0000-0000-0000-0000-00000000d001','2026-08-24','2026-09-01')
   where state = 'off';
  assert n_off = 1, '28 Aug has neither tap nor mark and is still a fact, got ' || n_off;

  -- The view holds only the days with something on them: an `off` day exists
  -- relative to a period somebody asked about, and a view has no period.
  select count(*) into n_all from ops_hr.v_timesheet_day
   where employee_id = 'aaaa0000-0000-0000-0000-00000000d001';
  assert n_all = 8, 'eight days have a tap or a mark, got ' || n_all;
end $$;

rollback;
