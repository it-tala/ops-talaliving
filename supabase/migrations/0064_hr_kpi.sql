-- 0064_hr_kpi.sql — three measures of a person, and the score this refuses to
-- print.
--
-- ## Why this is 0064 and not 0050
--
-- The ladder reserved `0050` for it, inside HR's block. It cannot live there:
-- the card reads `ops_prod.progress_entries`, which `0062` creates, and the
-- ladder applies in lexical order. It **would** have applied at 0050 without
-- complaining — `ops_hr.kpi()` is PL/pgSQL, so the name is not resolved until
-- something calls it — and that is exactly the kind of pass that hides an
-- ordering bug until a rebuild stops halfway. A migration that needs a later
-- one is wrong even when Postgres lets it through.
--
-- So HR's reserved block ends at 0049, and the one file that reaches across
-- into production sits after what it reaches for.
--
-- Everything here is shaped by one rule (D261): **a figure nobody can check is
-- worse than no figure.** So every measure carries its own `basis` in words, a
-- measure with too little behind it is `null` rather than confidently 100%,
-- and the combined score is withheld until at least two of the three can be
-- computed — a score over one axis of three is that axis wearing a costume.

-- Thresholds and weights, so moving them is a settings change rather than a
-- deployment. Defaults match the demo's fall-backs.
insert into ops_core.settings (key, value, note) values
  ('kpi.min_days_recorded', '5'::jsonb,
   'Days of record a measure needs before it is a percentage at all. A figure over two days is not the same claim as one over thirty (D261).'),
  ('kpi.min_measures', '2'::jsonb,
   'Measures that must be computable before a combined score is shown. One axis of three is that axis under another name.'),
  ('kpi.weight_punctuality', '25'::jsonb, 'Weight of Ketepatan waktu masuk in the combined score.'),
  ('kpi.weight_attendance',  '25'::jsonb, 'Weight of Hadir tanpa mangkir in the combined score.'),
  ('kpi.weight_tasks',       '50'::jsonb, 'Weight of Tugas selesai tepat waktu in the combined score.');

create type ops_hr.kpi_measure_t as (
  key                text,
  label              text,
  value              int,
  unmeasured_reason  text,
  basis              text,
  source             text,
  weight             numeric
);

create or replace function ops_hr.kpi_measures(p_employee uuid, p_from date, p_to date)
returns setof ops_hr.kpi_measure_t
language plpgsql stable set search_path = ops_hr, pg_temp as $$
declare
  emp        ops_hr.employees%rowtype;
  d          ops_hr.day_reading;
  v_rules    jsonb;
  v_start    int;
  v_grace    int;
  tapped     int := 0;   -- days with a tap and no mark
  judgeable  int := 0;   -- of those, days whose schedule has a start time
  late_days  int := 0;
  v_recorded   int := 0;   -- days carrying a tap OR a mark
  unexplained int := 0;
  starts     text[] := '{}';
  one_start  text;
  min_days   int;
  m          ops_hr.kpi_measure_t;
  t_due int := 0; t_counted int := 0; t_ontime int := 0; t_blocked int := 0;
begin
  select * into emp from ops_hr.employees where id = p_employee;
  if not found then return; end if;
  min_days := coalesce(ops_core.setting_num('kpi.min_days_recorded'), 5)::int;

  for d in select * from ops_hr.timesheet(p_employee, p_from, p_to) loop
    /* Each day against **the book in force on that day**, not the one in force
       when the window opens. A reader can pick a range that spans a rule
       change, and judging a September day by August's start time is one value
       doing a job it was never asked to do (F89). */
    v_rules := ops_hr.rules_on(d.work_date);
    v_grace := coalesce((v_rules->>'late_grace_minutes')::int, 0);
    v_start := coalesce(
      (ops_hr.schedule_of(v_rules, emp.schedule_code, emp.unit)->>'start_minutes')::int,
      (v_rules->>'day_starts_minutes')::int);

    -- Attendance is measured over **the days the system has a record for**,
    -- not over a calendar. The office does not use the fingerprint reader, so
    -- dividing by scheduled days rated every office worker at 4% present —
    -- F72 again, in the one module where it would have landed in somebody's
    -- review (F81). No taps is not evidence of absence.
    if d.in_at is not null or d.mark_kind is not null then
      v_recorded := v_recorded + 1;
      -- Only a day HRD **marked** as absent counts against anybody. That is a
      -- fact somebody asserted, never one inferred from silence; sakit with a
      -- letter and cuti are not mangkir and never count here.
      if d.mark_kind = 'absent' then unexplained := unexplained + 1; end if;
    end if;

    if d.in_at is not null and d.mark_kind is null then
      tapped := tapped + 1;
      /* A day whose schedule has no start time **cannot be judged**, so it
         leaves the arithmetic entirely rather than counting as punctual: a
         guard on an unstated shift must not score 100% (D261, F109). */
      if v_start is not null then
        judgeable := judgeable + 1;
        if ops_hr.wita_minutes(d.in_at) - v_start - v_grace > 0 then
          late_days := late_days + 1;
        end if;
        -- The thresholds actually applied across the window: usually one, and
        -- **named as several** when the window spans a change rather than
        -- quietly averaged.
        one_start := format('%s.%s+%sm', lpad((v_start / 60)::text, 2, '0'),
                            lpad((v_start % 60)::text, 2, '0'), v_grace);
        if not (one_start = any(starts)) then starts := starts || one_start; end if;
      end if;
    end if;
  end loop;

  -- ── Ketepatan waktu masuk ───────────────────────────────────────────────
  m.key := 'punctuality';
  m.label := 'Ketepatan waktu masuk';
  m.source := 'Mesin absensi · aturan penggajian yang berlaku';
  m.weight := coalesce(ops_core.setting_num('kpi.weight_punctuality'), 25);
  if judgeable < min_days then
    m.value := null;
    m.unmeasured_reason := case
      when tapped = 0 then
        'Tidak ada satu pun tap mesin absensi pada periode ini. Mesinnya alat bengkel; staf kantor tidak memakainya, dan tidak terukur bukan berarti seratus persen.'
      when judgeable = 0 then
        'Belum ada jam masuk yang ditetapkan untuk orang ini, jadi tidak ada ambang untuk menilai terlambat. Bukan tepat waktu — belum terukur.'
      else format('Baru %s hari yang bisa dinilai, di bawah ambang %s hari.', judgeable, min_days) end;
    m.basis := format('%s hari dengan tap, %s bisa dinilai', tapped, judgeable);
  else
    m.value := round((judgeable - late_days)::numeric / judgeable * 100)::int;
    m.unmeasured_reason := null;
    -- The start time is part of the basis, not a constant behind it: with two
    -- schedules in one business *tepat waktu* means a different clock for the
    -- workshop and the office, and a figure whose threshold is invisible
    -- cannot be argued with (D261, D270).
    m.basis := format('%s dari %s hari tepat waktu (masuk %s)',
                      judgeable - late_days, judgeable, array_to_string(starts, ' dan '));
  end if;
  return next m;

  -- ── Hadir tanpa mangkir ─────────────────────────────────────────────────
  m.key := 'attendance';
  m.label := 'Hadir tanpa mangkir';
  m.source := 'Timesheet · tanda hari dari HRD';
  m.weight := coalesce(ops_core.setting_num('kpi.weight_attendance'), 25);
  if v_recorded < min_days then
    m.value := null;
    m.unmeasured_reason := case when v_recorded = 0
      then 'Tidak ada satu hari pun pada periode ini yang punya catatan — tidak ada tap mesin dan tidak ada tanda hari dari HRD. Tidak ada catatan bukan berarti tidak masuk.'
      else format('Baru %s hari yang punya catatan, di bawah ambang %s hari. Persentase atas dua hari bukan persentase yang sama dengan atas tiga puluh.', v_recorded, min_days) end;
    m.basis := format('%s hari tercatat', v_recorded);
  else
    m.value := round((v_recorded - unexplained)::numeric / v_recorded * 100)::int;
    m.unmeasured_reason := null;
    m.basis := format('%s dari %s hari yang tercatat · hanya hari yang ditandai HRD sebagai mangkir yang dihitung; sakit bersurat dan cuti tidak pernah',
                      v_recorded - unexplained, v_recorded);
  end if;
  return next m;

  -- ── Tugas selesai tepat waktu ───────────────────────────────────────────
  --
  -- Cancelled is neither a success nor a failure, and **blocked is not the
  -- person's** (D261). Both leave the arithmetic rather than landing on one
  -- side of it.
  select
    count(*),
    count(*) filter (where t.status <> 'CANCELLED' and t.blocked_reason is null),
    count(*) filter (where t.status = 'DONE' and t.blocked_reason is null
                       and ops_core.office_day(t.done_at) <= t.due_date),
    count(*) filter (where t.blocked_reason is not null)
    into t_due, t_counted, t_ontime, t_blocked
    from ops_hr.tasks t
   where t.assignee_id = p_employee and t.due_date between p_from and p_to;

  m.key := 'task_delivery';
  m.label := 'Tugas selesai tepat waktu';
  m.source := 'Task tracker';
  m.weight := coalesce(ops_core.setting_num('kpi.weight_tasks'), 50);
  if t_counted = 0 then
    m.value := null;
    m.unmeasured_reason := case when t_due = 0
      then 'Tidak ada tugas yang jatuh tempo pada periode ini. Tidak ada tugas bukan nilai nol — tidak ada yang diukur.'
      else 'Semua tugas periode ini dibatalkan atau tertahan menunggu pihak lain, jadi tidak ada yang bisa dinilai.' end;
    m.basis := format('%s tugas jatuh tempo, tidak ada yang dihitung', t_due);
  else
    m.value := round(t_ontime::numeric / t_counted * 100)::int;
    m.unmeasured_reason := null;
    m.basis := format('%s dari %s tugas%s', t_ontime, t_counted,
                      case when t_blocked > 0
                        then format(' · %s tertahan, tidak dihitung', t_blocked) else '' end);
  end if;
  return next m;
end $$;

-- ── the card ──────────────────────────────────────────────────────────────
create type ops_hr.kpi_card_t as (
  employee_id      uuid,
  employee_no      text,
  full_name        text,
  period_start     date,
  period_end       date,
  score            int,
  score_reason     text,
  measured_count   int,
  measure_count    int,
  overtime_hours   numeric,
  tasks_open       int,
  tasks_blocked    int,
  work_pieces      numeric,
  work_coverage    int,
  work_unknown     int,
  notes            text[]
);

create or replace function ops_hr.kpi(p_employee uuid, p_from date, p_to date)
returns ops_hr.kpi_card_t
language plpgsql stable set search_path = ops_hr, pg_temp as $$
declare
  emp       ops_hr.employees%rowtype;
  c         ops_hr.kpi_card_t;
  n_meas    int; total_w numeric; weighted numeric; min_meas int;
  w         text[] := '{}';
  v_tapped  int;
  a_emp int; a_team int; a_unknown int; a_all int;
begin
  select * into emp from ops_hr.employees where id = p_employee;
  if not found then return null; end if;
  min_meas := coalesce(ops_core.setting_num('kpi.min_measures'), 2)::int;

  c.employee_id := emp.id; c.employee_no := emp.employee_no; c.full_name := emp.full_name;
  c.period_start := p_from; c.period_end := p_to;
  c.measure_count := 3;

  select count(*) filter (where value is not null),
         coalesce(sum(weight) filter (where value is not null), 0),
         coalesce(sum(value * weight) filter (where value is not null), 0)
    into n_meas, total_w, weighted
    from ops_hr.kpi_measures(p_employee, p_from, p_to);
  c.measured_count := n_meas;

  /* A score over one axis out of three is that one axis wearing a costume. */
  if n_meas < min_meas or total_w = 0 then
    c.score := null;
    c.score_reason := format(
      'Baru %s dari %s ukuran yang bisa dihitung; nilai gabungan baru ditampilkan mulai %s. Angka gabungan dari satu ukuran hanya ukuran itu sendiri dengan nama lain.',
      n_meas, 3, min_meas);
  else
    c.score := round(weighted / total_w)::int;
    c.score_reason := null;
  end if;

  select coalesce(sum(d.overtime_hours), 0), count(*) filter (where d.in_at is not null and d.mark_kind is null)
    into c.overtime_hours, v_tapped
    from ops_hr.timesheet(p_employee, p_from, p_to) d;
  c.overtime_hours := round(c.overtime_hours, 1);

  select count(*) filter (where status = 'OPEN'),
         count(*) filter (where status = 'OPEN' and blocked_reason is not null)
    into c.tasks_open, c.tasks_blocked
    from ops_hr.tasks where assignee_id = p_employee;

  /* Production work is **shown, attributed, and deliberately not scored**
     (D264). A piece is not a unit: eight nakas and four wardrobes do not add
     up, and dividing them by anything produces a number that looks like a
     performance figure and is not one.

     Coverage is a property of the **record**, not of the person: nobody can
     tell whether an unresolved entry belongs to somebody, so an empty column
     reads as *this person made nothing* when the truth is *nobody wrote down
     who made it*. Every card carries the period's coverage beside the
     figure. */
  select coalesce(sum(e.qty) filter (where e.worked_by_employee_id = p_employee), 0)
    into c.work_pieces
    from ops_prod.progress_entries e
   where e.work_date between p_from and p_to and e.qty > 0;

  select count(*), count(*) filter (where worked_by_employee_id is not null),
         count(*) filter (where worked_by_not_a_person),
         count(*) filter (where worked_by_employee_id is null and not worked_by_not_a_person)
    into a_all, a_emp, a_team, a_unknown
    from ops_prod.progress_entries
   where work_date between p_from and p_to and qty > 0;
  c.work_unknown := a_unknown;
  c.work_coverage := case when a_all = 0 then null
                          else round((a_emp + a_team)::numeric / a_all * 100)::int end;

  if v_tapped = 0 then
    w := w || 'Tidak ada data absensi mesin untuk orang ini pada periode ini.'::text;
  end if;
  if c.tasks_blocked > 0 then
    w := w || format('%s tugas tertahan menunggu pihak lain — tidak dihitung sebagai kegagalan orang ini.', c.tasks_blocked);
  end if;
  if c.work_pieces = 0 and a_unknown > 0 then
    w := w || format('Tidak ada pekerjaan produksi yang tertaut ke orang ini — dan %s entri periode ini masih atas nama yang belum ditautkan, jadi kosong di sini belum tentu berarti tidak mengerjakan apa pun.', a_unknown);
  elsif c.work_pieces = 0 then
    w := w || 'Tidak ada pekerjaan produksi atas nama orang ini pada periode ini.'::text;
  else
    w := w || 'Hasil produksi ditampilkan sebagai bukti, bukan sebagai nilai: satu lemari dan satu nakas tidak bisa dijumlahkan, jadi jumlah potong bukan ukuran kinerja.'::text;
  end if;
  c.notes := w;

  return c;
end $$;

-- Every person on every run, for the screen that reads a period somebody
-- already defined.
create or replace view ops_hr.v_kpi_run as
select r.run_no, k.*
  from ops_hr.payroll_runs r
  cross join ops_hr.employees e
  cross join lateral (select (ops_hr.kpi(e.id, r.period_start, r.period_end)).*) k
 where e.active or e.left_on >= r.period_start;

alter view ops_hr.v_kpi_run set (security_invoker = on);
grant select on ops_hr.v_kpi_run to authenticated;
