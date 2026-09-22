-- hr — three measures, and the score this refuses to print.
--
-- Worked out first, over an eleven-day window:
--
--   Joko   6 hari tap, 2 terlambat            -> 4/6  = 67%
--          8 hari tercatat, 1 mangkir         -> 7/8  = 88%
--          3 tugas dihitung, 2 tepat waktu    -> 2/3  = 67%
--          (67x25 + 88x25 + 67x50) / 100      -> 72
--
--   Satpam jam masuknya belum ditetapkan      -> null, BUKAN 100% (F109)
--          1 dari 3 ukuran                    -> tidak ada nilai gabungan
--
-- The whole file is D261: a figure nobody can check is worse than no figure,
-- so every measure carries its basis, a thin one is null rather than
-- confidently 100%, and one axis of three never becomes a score.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-000000001101','wulan@talaliving.com','{"full_name":"Wulan"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-000000001101','hrd','write'),
  ('ffffffff-0000-0000-0000-000000001101','payroll','admin'),
  ('ffffffff-0000-0000-0000-000000001101','it','write'),
  ('ffffffff-0000-0000-0000-000000001101','production','write');

insert into ops_hr.employees (id, employee_no, full_name, unit, schedule_code, pay_basis, base_rate) values
  ('aaaa0000-0000-0000-0000-000000001101','B-701','Joko Susilo','Produksi','produksi','daily',180000),
  ('aaaa0000-0000-0000-0000-000000001102','B-702','Slamet','Satpam',null,'monthly',3500000);

-- **No `day_starts_minutes`.** The guard has no schedule and the book states no
-- company-wide start either, so there is no threshold to judge him by — which
-- is the case F109 is about and the reason this fixture omits it.
insert into ops_hr.pay_rule_sets (version, effective_from, note, rules, created_by) values
 (1, current_date, 'versi uji kpi', '{
   "week_pattern": "6day",
   "late_grace_minutes": 15,
   "schedules": [{"code":"produksi","name":"Produksi","start_minutes":450,"end_minutes":990,
                  "break_minutes":45,"friday_break_minutes":90,"note":null}],
   "schedule_by_unit": {"Produksi":"produksi"}
 }'::jsonb, 'ffffffff-0000-0000-0000-000000001101');

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000001101';

-- Joko: six days with a tap. Two of them at 08.00, which is past 07.30 plus
-- the fifteen minutes the owner set.
insert into ops_hr.attendance_scans (employee_id, work_date, at, source, reason, recorded_by)
select 'aaaa0000-0000-0000-0000-000000001101', ops_core.office_day() - n,
       ((ops_core.office_day() - n) + case when n in (7,6) then time '08:00' else time '07:28' end)
         at time zone 'Asia/Makassar',
       'manual','uji kpi','ffffffff-0000-0000-0000-000000001101'
  from generate_series(5, 10) n;

-- Two marked days: one mangkir, one sakit. Only the first counts against him.
insert into ops_hr.day_marks (employee_id, work_date, kind, reason, marked_by) values
  ('aaaa0000-0000-0000-0000-000000001101', ops_core.office_day() - 4,'absent','tidak ada kabar','ffffffff-0000-0000-0000-000000001101'),
  ('aaaa0000-0000-0000-0000-000000001101', ops_core.office_day() - 3,'sick','demam','ffffffff-0000-0000-0000-000000001101');

-- Slamet: six days with a tap and nothing else.
insert into ops_hr.attendance_scans (employee_id, work_date, at, source, reason, recorded_by)
select 'aaaa0000-0000-0000-0000-000000001102', ops_core.office_day() - n,
       ((ops_core.office_day() - n) + time '19:00') at time zone 'Asia/Makassar',
       'manual','uji kpi','ffffffff-0000-0000-0000-000000001101'
  from generate_series(5, 10) n;

-- Four tasks for Joko: two done on time, one done late, one blocked.
insert into ops_hr.tasks (title, assignee_id, assigned_by, due_date, status, done_at, done_by) values
  ('Rekap absensi','aaaa0000-0000-0000-0000-000000001101','ffffffff-0000-0000-0000-000000001101',
   ops_core.office_day() - 8,'DONE', (ops_core.office_day() - 9)::timestamptz,'ffffffff-0000-0000-0000-000000001101'),
  ('Setor laporan','aaaa0000-0000-0000-0000-000000001101','ffffffff-0000-0000-0000-000000001101',
   ops_core.office_day() - 7,'DONE', (ops_core.office_day() - 7)::timestamptz,'ffffffff-0000-0000-0000-000000001101'),
  ('Kirim sampel','aaaa0000-0000-0000-0000-000000001101','ffffffff-0000-0000-0000-000000001101',
   ops_core.office_day() - 6,'DONE', (ops_core.office_day() - 2)::timestamptz,'ffffffff-0000-0000-0000-000000001101');
insert into ops_hr.tasks (title, assignee_id, assigned_by, due_date, blocked_reason, blocked_at) values
  ('Tutup PO mahoni','aaaa0000-0000-0000-0000-000000001101','ffffffff-0000-0000-0000-000000001101',
   ops_core.office_day() - 5,'menunggu nota vendor', now());

/* ── DERIVATION: the three measures ────────────────────────────────────── */
do $$
declare m ops_hr.kpi_measure_t; f date := ops_core.office_day() - 10; t date := ops_core.office_day();
begin
  select * into m from ops_hr.kpi_measures('aaaa0000-0000-0000-0000-000000001101', f, t)
   where key = 'punctuality';
  assert m.value = 67,  'four of six on time, got ' || coalesce(m.value::text,'(null)');
  assert m.basis like '%masuk 07.30+15m%', 'the threshold is part of the basis, got ' || m.basis;

  select * into m from ops_hr.kpi_measures('aaaa0000-0000-0000-0000-000000001101', f, t)
   where key = 'attendance';
  -- Sakit is never mangkir. Only a day HRD **marked** absent counts, which is
  -- a fact somebody asserted rather than one inferred from silence.
  assert m.value = 88,  'seven of eight recorded days, got ' || coalesce(m.value::text,'(null)');

  select * into m from ops_hr.kpi_measures('aaaa0000-0000-0000-0000-000000001101', f, t)
   where key = 'task_delivery';
  -- Blocked is not the person's, and leaves the arithmetic (D261).
  assert m.value = 67,  'two of the three that count, got ' || coalesce(m.value::text,'(null)');
  assert m.basis like '%1 tertahan, tidak dihitung%', 'and the basis names it, got ' || m.basis;
end $$;

/* ── DERIVATION: the score, weighted ───────────────────────────────────── */
do $$
declare c ops_hr.kpi_card_t;
begin
  c := ops_hr.kpi('aaaa0000-0000-0000-0000-000000001101',
                  ops_core.office_day() - 10, ops_core.office_day());
  assert c.measured_count = 3, 'all three can be computed, got ' || c.measured_count;
  assert c.score = 72,         '(67x25 + 88x25 + 67x50)/100, got ' || coalesce(c.score::text,'(null)');
  assert c.score_reason is null, 'and nothing is being withheld';
  assert c.tasks_blocked = 1,  'one task is waiting on somebody else, got ' || c.tasks_blocked;
  assert exists (select 1 from unnest(c.notes) x where x like '%tidak dihitung sebagai kegagalan%'),
         'and the card says it is not held against him: ' || array_to_string(c.notes,' | ');
end $$;

/* ── F109: no threshold is not a hundred per cent ──────────────────────── */
do $$
declare m ops_hr.kpi_measure_t; c ops_hr.kpi_card_t;
begin
  select * into m from ops_hr.kpi_measures('aaaa0000-0000-0000-0000-000000001102',
    ops_core.office_day() - 10, ops_core.office_day()) where key = 'punctuality';
  -- Six days of taps and not one of them judgeable. Dividing by the tapped
  -- days would have scored him 100% for a rule nobody has written down.
  assert m.value is null, 'a guard on an unstated shift is not punctual, he is unmeasured — got ' || m.value;
  assert m.unmeasured_reason like '%Belum ada jam masuk%',
         'and it says which, got ' || coalesce(m.unmeasured_reason,'(null)');
  assert m.basis = '6 hari dengan tap, 0 bisa dinilai', 'with the working shown, got ' || m.basis;

  -- Attendance still works for him: taps are a record even when no threshold
  -- exists to judge them against.
  select * into m from ops_hr.kpi_measures('aaaa0000-0000-0000-0000-000000001102',
    ops_core.office_day() - 10, ops_core.office_day()) where key = 'attendance';
  assert m.value = 100, 'nothing marked against him, got ' || coalesce(m.value::text,'(null)');

  -- One measure of three, so no combined score. A score over one axis is that
  -- axis wearing a costume.
  c := ops_hr.kpi('aaaa0000-0000-0000-0000-000000001102',
                  ops_core.office_day() - 10, ops_core.office_day());
  assert c.measured_count = 1, 'only attendance, got ' || c.measured_count;
  assert c.score is null,      'so no score, got ' || c.score;
  assert c.score_reason like '%Baru 1 dari 3 ukuran%', 'and it explains itself: ' || c.score_reason;
end $$;

/* ── DERIVATION: production work is shown, attributed, never scored ────── */
do $$
declare c ops_hr.kpi_card_t; wo uuid;
begin
  insert into ops_prod.products (id, product_code, name, category, uom, created_by)
  values ('bbbb0000-0000-0000-0000-000000001101','PRD-NK-001','Nakas','Lemari','unit',
          'ffffffff-0000-0000-0000-000000001101');
  insert into ops_prod.work_orders (wo_no, item_name, qty, uom, route, due_date, created_by)
  values ('spk-kpi-01','Nakas', 10,'unit','IN_HOUSE', ops_core.office_day() + 5,
          'ffffffff-0000-0000-0000-000000001101') returning id into wo;

  -- Three entries: one linked to Joko, one confirmed a crew, one nobody has
  -- resolved. Coverage is a property of the **record**, not of the person.
  insert into ops_prod.progress_entries (wo_id, stage, qty, work_date, worked_by,
                                         worked_by_employee_id, worked_by_not_a_person, recorded_by) values
    (wo,'AMPLAS', 4, ops_core.office_day() - 6,'Joko Susilo','aaaa0000-0000-0000-0000-000000001101', false,'ffffffff-0000-0000-0000-000000001101'),
    (wo,'FINISHING', 3, ops_core.office_day() - 6,'Tim finishing', null, true,'ffffffff-0000-0000-0000-000000001101'),
    (wo,'PACKING', 2, ops_core.office_day() - 6,'Pranowo', null, false,'ffffffff-0000-0000-0000-000000001101');

  c := ops_hr.kpi('aaaa0000-0000-0000-0000-000000001101',
                  ops_core.office_day() - 10, ops_core.office_day());
  assert c.work_pieces = 4,    'four pieces carry his link, got ' || c.work_pieces;
  assert c.work_unknown = 1,   'and one entry is still nobody in particular, got ' || c.work_unknown;
  assert c.work_coverage = 67, 'two of three entries are resolved, got ' || coalesce(c.work_coverage::text,'(null)');
  -- **A piece is not a unit**: eight nakas and four wardrobes do not add up,
  -- so the figure is evidence and never a score (D264).
  assert c.score = 72,         'and none of it moved the score, got ' || coalesce(c.score::text,'(null)');
  assert exists (select 1 from unnest(c.notes) x where x like '%bukan ukuran kinerja%'),
         'the card says so in words: ' || array_to_string(c.notes,' | ');
end $$;

rollback;
