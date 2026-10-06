-- 0213 — laporan harian: apa yang dikerjakan hari ini, dan dasar penilaian (D371, D372).
--
-- ── the ask ────────────────────────────────────────────────────────────────
--
-- Owner, 2026-10-06:
--
--   *tambahkan juga fitur user dimana dia bisa input apa yang dikerjakan hari
--    ini, progress nya gimana, apakah sesuai task yang diberikan atau task
--    dadakan* — and then: *pastikan ini bisa jadi dasar penilaian performa dan
--    PA (performance advisory).*
--
-- D367 ranked the results the business is after. This is the other half of
-- that loop: what each person **actually** did today, against what was
-- planned. The ranked goals say what should happen; the log says what did,
-- and how much of a day went to *dadakan* instead of the priorities.
--
-- ── what makes a self-written record fit to assess somebody on ─────────────
--
-- A record a person writes about themselves can only carry weight in their
-- review if it cannot be written after the fact. So:
--
--   • **today only.** An entry is dated by the office day it was written on
--     and can be changed or removed only on that day. Yesterday is history
--     (D148). Nobody fills a month of logs the night before a review.
--   • **only by the person.** HRD can read every log and can turn a *dadakan*
--     entry into a task, but cannot write or edit anybody's log. A record the
--     assessor can edit is the assessor's record.
--   • **a task entry points at the person's own task**, open or finished
--     today. *Selesai* in the log does not close the task — closing still
--     takes the hand-over note (D368), so the evidence of delivery stays in
--     one place.
--   • **a dadakan entry names who asked.** Otherwise *dadakan* is a word that
--     excuses anything. With a name it is a fact that can be checked, and it
--     is what shows the leader whose requests are eating the priorities.
--
-- ── what is scored, and what is not (D372) ────────────────────────────────
--
-- One new measure enters the KPI: **Laporan harian terisi** — of the days the
-- person was expected at work, on how many they logged. That is in the
-- person's hands. The **share of dadakan is never scored**: being interrupted
-- is not a failure of the interrupted, and a score that fell when the boss
-- asked for something urgent would teach people to stop writing it down. It
-- is printed beside the score as context and summarised for the review.
--
-- The days counted follow D261's rule that unmeasured is not zero: a working
-- day as payroll defines it (not a rest day of the week pattern, not a
-- tanggal merah, not off on the person's own schedule), minus anything HRD
-- marked (cuti, sakit, izin, libur, mangkir), from the day this feature
-- exists, and never today. Only office accounts owe a log (a login with a
-- module): a person with no account, or a floor worker's `/saya` account, is
-- out of scope (D371), so the measure says so instead of scoring zero.
--
-- ── the review's evidence ─────────────────────────────────────────────────
--
-- `work_evidence()` is the page a performance advisory is written from: days
-- expected and logged, assigned vs dadakan, hours where given, which tasks and
-- goals the days went into, and who the dadakan came from. The person reads
-- the same summary about themselves — the basis of an assessment should be
-- readable by the person assessed.
--
-- And `kpi_board()` gives `/hrd/kinerja` a live road for the first time. Until
-- now the score existed in the demo only (the screen called a function the
-- real client did not have), which would have made *dasar penilaian* a phrase
-- rather than a page.

insert into ops_core.settings (key, value, note) values
  ('kpi.weight_daily_log', '25'::jsonb,
   'Weight of Laporan harian terisi in the combined score (D372).'),
  ('kpi.daily_log_from', '"2026-10-06"'::jsonb,
   'First office day a daily log could exist. Days before it are never expected (D372).');

/* ── the record ───────────────────────────────────────────────────────── */
create table ops_hr.work_log (
  id               uuid primary key default gen_random_uuid(),
  employee_id      uuid not null references ops_hr.employees(id),
  work_date        date not null,
  /* Null is *dadakan*: work nobody assigned through the board. */
  task_id          uuid references ops_hr.tasks(id),
  summary          text not null check (length(btrim(summary)) > 0),
  progress         text not null check (progress in ('lanjut','selesai','tertahan')),
  requested_by     text,
  hours            numeric(4,1) check (hours is null or (hours > 0 and hours <= 16)),
  created_by       uuid not null references ops_core.users(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz,
  promoted_task_id uuid references ops_hr.tasks(id),
  promoted_by      uuid references ops_core.users(id),
  promoted_at      timestamptz,

  constraint dadakan_names_who_asked check (
    task_id is not null or (requested_by is not null and length(btrim(requested_by)) > 0)),
  constraint promotion_is_dadakan check (promoted_task_id is null or task_id is null),
  constraint promotion_is_signed check ((promoted_task_id is null) = (promoted_at is null))
);

create unique index work_log_task_once_a_day on ops_hr.work_log (employee_id, work_date, task_id)
  where task_id is not null;
create index work_log_day_idx on ops_hr.work_log (work_date);
create index work_log_person_idx on ops_hr.work_log (employee_id, work_date);

alter table ops_hr.work_log enable row level security;

/* Read: HRD and payroll every row, a person their own. No write policy at
   all — the seams below are the only road in, so *only the person, only
   today* is a rule in one place rather than a policy and a seam that can
   drift apart. */
create policy work_log_read on ops_hr.work_log for select to authenticated
  using (ops_core.has_permission('hrd.read')
         or ops_core.has_permission('payroll.read')
         or employee_id = ops_hr.my_employee_id());
grant select on ops_hr.work_log to authenticated;

/* ── the log as a person reads it ─────────────────────────────────────── */
create view ops_hr.v_work_log as
select
  w.id, w.work_date, w.employee_id,
  e.employee_no, e.full_name as employee_name,
  case when w.task_id is null then 'dadakan' else 'tugas' end as kind,
  t.task_no, t.title as task_title, t.status as task_status,
  g.goal_no, g.title as goal_title, g.rank as goal_rank,
  w.summary, w.progress, w.requested_by, w.hours,
  w.created_at, w.updated_at,
  (w.work_date = ops_core.office_day() and w.promoted_task_id is null) as editable,
  pt.task_no as promoted_task_no
from ops_hr.work_log w
join ops_hr.employees e on e.id = w.employee_id
left join ops_hr.tasks t on t.id = w.task_id
left join ops_hr.goals g on g.id = t.goal_id
left join ops_hr.tasks pt on pt.id = w.promoted_task_id;

alter view ops_hr.v_work_log set (security_invoker = on);
grant select on ops_hr.v_work_log to authenticated;

/* ── who owes a daily log ─────────────────────────────────────────────────
 *
 *  An office account: a login linked to the employee **and** holding at least
 *  one module. A worker's account with no module (the `/saya` app, D331) is a
 *  floor worker's — out of scope by the owner's word (D371) — and is never
 *  owed a log, so never counted short for not writing one. Definer, because
 *  the reader of a KPI card cannot always read `user_modules`, and the answer
 *  is a boolean about a role, not about anybody's permissions.
 */
create or replace function ops_hr.owes_daily_log(p_employee uuid)
returns boolean
language sql stable security definer set search_path = ops_hr, ops_core, pg_temp as $$
  select exists (
    select 1 from ops_hr.employees e
      join ops_core.user_modules m on m.user_id = e.user_id
     where e.id = p_employee and e.user_id is not null);
$$;

/* ── the days a log was owed ──────────────────────────────────────────────
 *
 *  One definition, used by the KPI measure and by the review's evidence, so
 *  the score and the page it is argued from cannot count different days.
 */
create or replace function ops_hr.daily_log_coverage(p_employee uuid, p_from date, p_to date)
returns table (expected int, logged int, counted_from date, counted_to date)
language plpgsql stable set search_path = ops_hr, ops_core, pg_temp as $$
declare v_from date; v_to date; emp ops_hr.employees%rowtype;
begin
  v_from := greatest(p_from, coalesce(
    (select (value #>> '{}')::date from ops_core.settings where key = 'kpi.daily_log_from'),
    date '2026-10-06'));
  v_to := least(p_to, ops_core.office_day() - 1);
  counted_from := v_from;
  counted_to := v_to;
  select * into emp from ops_hr.employees where id = p_employee;
  if not found or v_to < v_from then
    expected := 0; logged := 0;
    return next;
    return;
  end if;
  /* A working day is what payroll says it is: not a rest day of the week
     pattern or a tanggal merah (`is_rest_day`), and not a day off on the
     person's own schedule. A day HRD marked (cuti, sakit, izin, libur,
     mangkir) is never owed a log, a half day is. `state` is not used: it is
     *off* whenever there are no taps, which says nothing about whether the
     day was a working day. */
  select count(*)::int,
         count(*) filter (where exists (
           select 1 from ops_hr.work_log l
            where l.employee_id = p_employee and l.work_date = d.work_date))::int
    into expected, logged
    from ops_hr.timesheet(p_employee, v_from, v_to) d
   where not ops_hr.is_rest_day(ops_hr.rules_on(d.work_date), d.work_date)
     and not coalesce((ops_hr.schedule_day(ops_hr.pattern_on(emp.schedule_code, emp.unit, d.work_date),
                                           d.work_date) ->> 'off')::boolean, false)
     and (d.mark_kind is null or d.mark_kind = 'half_day');
  return next;
end $$;


/* ── the KPI, with a fourth measure ───────────────────────────────────────
 *
 *  `kpi_measures` is `0186`'s body, unchanged, with **Laporan harian terisi**
 *  appended. `kpi()` is `0064`'s body with two changes: the count of measures
 *  is read from `kpi_measures` rather than written as 3, and the share of
 *  dadakan is added to the notes as context.
 */
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
  lc         record;
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
      -- fact somebody asserted, never one inferred from silence — sakit with a
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
        if ops_hr.late_minutes(d.in_at, d.work_date, v_start, v_grace) > 0 then
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

  -- ── Laporan harian terisi (0213, D371) ─────────────────────────────────
  --
  -- Over the days the person was **expected at work**: a scheduled day, not a
  -- rest day, not covered by a mark (cuti, sakit, izin, libur, mangkir), from
  -- the day the log existed, and never today, which is not over yet. Not
  -- logging on a day of leave is never counted against anybody. What was
  -- logged is measured, not what kind of work it was: an interrupted day is
  -- still a logged day, and the share of dadakan is printed beside the score,
  -- never inside it.
  select * into lc from ops_hr.daily_log_coverage(p_employee, p_from, p_to);
  m.key := 'daily_log';
  m.label := 'Laporan harian terisi';
  m.source := 'Laporan harian · jadwal kerja · tanda hari dari HRD';
  m.weight := coalesce(ops_core.setting_num('kpi.weight_daily_log'), 25);
  if not ops_hr.owes_daily_log(emp.id) then
    m.value := null;
    m.unmeasured_reason := 'Orang ini tidak mengisi laporan harian: belum punya akun kantor (akun pekerja lapangan tanpa modul tidak mengisinya). Tidak terukur, bukan nol.';
    m.basis := 'tidak wajib mengisi';
  elsif lc.expected < min_days then
    m.value := null;
    m.unmeasured_reason := format(
      'Baru %s hari kerja yang wajib dilaporkan (sejak %s, tanpa hari ini), di bawah ambang %s hari.',
      lc.expected, lc.counted_from, min_days);
    m.basis := format('%s dari %s hari kerja ada laporannya', lc.logged, lc.expected);
  else
    m.value := round(lc.logged::numeric / lc.expected * 100)::int;
    m.unmeasured_reason := null;
    m.basis := format('%s dari %s hari kerja ada laporannya · cuti, sakit, izin, libur, mangkir dan hari ini tidak dihitung',
                      lc.logged, lc.expected);
  end if;
  return next m;
end $$;

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
  n_log int; n_dadakan int;
begin
  select * into emp from ops_hr.employees where id = p_employee;
  if not found then return null; end if;
  min_meas := coalesce(ops_core.setting_num('kpi.min_measures'), 2)::int;

  c.employee_id := emp.id; c.employee_no := emp.employee_no; c.full_name := emp.full_name;
  c.period_start := p_from; c.period_end := p_to;

  select count(*),
         count(*) filter (where value is not null),
         coalesce(sum(weight) filter (where value is not null), 0),
         coalesce(sum(value * weight) filter (where value is not null), 0)
    into c.measure_count, n_meas, total_w, weighted
    from ops_hr.kpi_measures(p_employee, p_from, p_to);
  c.measured_count := n_meas;

  /* A score over one axis out of three is that one axis wearing a costume. */
  if n_meas < min_meas or total_w = 0 then
    c.score := null;
    c.score_reason := format(
      'Baru %s dari %s ukuran yang bisa dihitung; nilai gabungan baru ditampilkan mulai %s. Angka gabungan dari satu ukuran hanya ukuran itu sendiri dengan nama lain.',
      n_meas, c.measure_count, min_meas);
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
  /* The share of unplanned work, as context and never as a score (D371): an
     interrupted person is not a worse employee, and the figure is what lets a
     reader see that the priorities leaked rather than that the person did. */
  select count(*), count(*) filter (where l.task_id is null)
    into n_log, n_dadakan
    from ops_hr.work_log l
   where l.employee_id = p_employee and l.work_date between p_from and p_to;
  if n_log > 0 then
    w := w || format('%s dari %s entri laporan harian adalah pekerjaan dadakan — dibaca sebagai konteks, tidak dinilai.',
                     n_dadakan, n_log);
  end if;
  c.notes := w;

  return c;
end $$;

/* ── writing today's log ──────────────────────────────────────────────────
 *
 *  New (`p_entry` null) or a change to one of today's own entries. The
 *  person is `my_employee_id()` and nothing else: there is no parameter to
 *  name somebody, so HRD cannot write a log for anybody.
 */
create or replace function ops_hr.log_work(
  p_summary text, p_progress text,
  p_task_no text default null, p_requested_by text default null,
  p_hours numeric default null, p_entry uuid default null)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare
  v_me uuid := ops_hr.my_employee_id();
  v_today date := ops_core.office_day();
  t ops_hr.tasks%rowtype; w ops_hr.work_log%rowtype;
  v_task uuid; v_asker text; v_id uuid;
begin
  if v_me is null then
    return ops_core.refused('hr','work_log', null, 'log','no_employee_link',
      'Akun ini belum tertaut ke data karyawan, jadi tidak bisa mengisi laporan harian. Minta HRD menautkannya.');
  end if;
  if coalesce(btrim(coalesce(p_summary,'')),'') = '' then
    return ops_core.invalid('hr','work_log', null,'log','summary_required',
      'Apa yang dikerjakan? Satu kalimat yang bisa dibaca orang lain.', jsonb_build_object('field','summary'));
  end if;
  if p_progress is null or p_progress not in ('lanjut','selesai','tertahan') then
    return ops_core.invalid('hr','work_log', null,'log','unknown_progress',
      'Progresnya lanjut, selesai, atau tertahan.', jsonb_build_object('field','progress'));
  end if;
  if p_hours is not null and (p_hours <= 0 or p_hours > 16) then
    return ops_core.invalid('hr','work_log', null,'log','hours_invalid',
      'Jam kerja diisi antara 0,5 dan 16, atau dikosongkan.', jsonb_build_object('field','hours'));
  end if;

  if coalesce(btrim(coalesce(p_task_no,'')),'') <> '' then
    select * into t from ops_hr.tasks where task_no = btrim(p_task_no);
    if not found then
      return ops_core.not_found('hr','work_log', null,'log', format('Tidak ada tugas %s.', p_task_no));
    end if;
    if t.assignee_id <> v_me then
      return ops_core.refused('hr','work_log', null,'log','task_not_yours',
        'Laporan harian hanya untuk tugas Anda sendiri. Pekerjaan untuk tugas orang lain dicatat sebagai dadakan, dengan nama yang meminta.');
    end if;
    if t.status = 'CANCELLED' or (t.status = 'DONE' and ops_core.office_day(t.done_at) <> v_today) then
      return ops_core.conflict('hr','work_log', null,'log','task_closed',
        format('%s sudah %s.', t.task_no, lower(t.status::text)));
    end if;
    v_task := t.id;
    v_asker := null;
  else
    if coalesce(btrim(coalesce(p_requested_by,'')),'') = '' then
      return ops_core.invalid('hr','work_log', null,'log','requested_by_required',
        'Pekerjaan dadakan diminta oleh siapa? Tanpa nama, dadakan tidak bisa diperiksa.',
        jsonb_build_object('field','requested_by'));
    end if;
    v_task := null;
    v_asker := btrim(p_requested_by);
  end if;

  if p_entry is null then
    if v_task is not null and exists (
         select 1 from ops_hr.work_log l
          where l.employee_id = v_me and l.work_date = v_today and l.task_id = v_task) then
      return ops_core.conflict('hr','work_log', null,'log','already_logged',
        'Tugas ini sudah dicatat hari ini. Ubah catatan yang ada, jangan membuat yang kedua.');
    end if;
    insert into ops_hr.work_log
      (employee_id, work_date, task_id, summary, progress, requested_by, hours, created_by)
    values (v_me, v_today, v_task, btrim(p_summary), p_progress, v_asker, p_hours, auth.uid())
    returning id into v_id;
    return ops_core.ok('hr','work_log', v_id::text,'log',
      jsonb_build_object('entry_id', v_id),
      null,
      jsonb_build_object('task', p_task_no, 'progress', p_progress, 'requested_by', v_asker, 'hours', p_hours));
  end if;

  select * into w from ops_hr.work_log where id = p_entry and employee_id = v_me for update;
  if not found then
    return ops_core.not_found('hr','work_log', p_entry::text,'edit', 'Catatan itu tidak ada di laporan Anda.');
  end if;
  if w.work_date <> v_today then
    return ops_core.conflict('hr','work_log', p_entry::text,'edit','past_day',
      format('Catatan %s sudah menjadi riwayat. Laporan hanya bisa diubah pada harinya.', w.work_date));
  end if;
  if w.promoted_task_id is not null then
    return ops_core.conflict('hr','work_log', p_entry::text,'edit','already_promoted',
      'HRD sudah menjadikan catatan ini tugas. Perubahan berikutnya dicatat di tugas itu.');
  end if;
  if v_task is not null and v_task is distinct from w.task_id and exists (
       select 1 from ops_hr.work_log l
        where l.employee_id = v_me and l.work_date = v_today and l.task_id = v_task) then
    return ops_core.conflict('hr','work_log', p_entry::text,'edit','already_logged',
      'Tugas itu sudah punya catatan hari ini.');
  end if;

  update ops_hr.work_log
     set task_id = v_task, summary = btrim(p_summary), progress = p_progress,
         requested_by = v_asker, hours = p_hours, updated_at = now()
   where id = w.id;

  return ops_core.ok('hr','work_log', w.id::text,'edit',
    jsonb_build_object('entry_id', w.id),
    jsonb_build_object('summary', w.summary, 'progress', w.progress,
                       'requested_by', w.requested_by, 'hours', w.hours, 'task_id', w.task_id),
    jsonb_build_object('summary', btrim(p_summary), 'progress', p_progress,
                       'requested_by', v_asker, 'hours', p_hours, 'task', p_task_no));
end $$;

/* Removing one of today's own entries. Yesterday's are history. */
create or replace function ops_hr.remove_work_log(p_entry uuid)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare w ops_hr.work_log%rowtype;
begin
  select * into w from ops_hr.work_log
   where id = p_entry and employee_id = ops_hr.my_employee_id() for update;
  if not found then
    return ops_core.not_found('hr','work_log', p_entry::text,'remove', 'Catatan itu tidak ada di laporan Anda.');
  end if;
  if w.work_date <> ops_core.office_day() then
    return ops_core.conflict('hr','work_log', p_entry::text,'remove','past_day',
      format('Catatan %s sudah menjadi riwayat dan tidak bisa dihapus.', w.work_date));
  end if;
  if w.promoted_task_id is not null then
    return ops_core.conflict('hr','work_log', p_entry::text,'remove','already_promoted',
      'HRD sudah menjadikan catatan ini tugas, jadi catatannya tetap.');
  end if;
  delete from ops_hr.work_log where id = w.id;
  return ops_core.ok('hr','work_log', w.id::text,'remove',
    jsonb_build_object('entry_id', w.id),
    jsonb_build_object('summary', w.summary, 'progress', w.progress, 'task_id', w.task_id,
                       'requested_by', w.requested_by),
    null);
end $$;

/* Dadakan made visible: HRD turns an entry into a task for the same person.
 *
 *  The entry stays dadakan — that it arrived unplanned is the fact the log
 *  exists to keep — and points at the task it became. The task counts as
 *  received and started from the moment the person wrote the entry, because
 *  they did.
 */
create or replace function ops_hr.promote_work_log(
  p_entry uuid, p_due date, p_goal_no text default null)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare w ops_hr.work_log%rowtype; emp ops_hr.employees%rowtype; v_res jsonb; v_no text;
begin
  if not ops_core.has_permission('hrd.create') then
    return ops_core.refused('hr','work_log', p_entry::text,'promote',
      'not_permitted','Menjadikan pekerjaan dadakan sebagai tugas butuh akses HRD.');
  end if;
  select * into w from ops_hr.work_log where id = p_entry for update;
  if not found then
    return ops_core.not_found('hr','work_log', p_entry::text,'promote', 'Catatan itu tidak ada.');
  end if;
  if w.task_id is not null then
    return ops_core.conflict('hr','work_log', p_entry::text,'promote','not_dadakan',
      'Catatan ini sudah untuk sebuah tugas.');
  end if;
  if w.promoted_task_id is not null then
    return ops_core.conflict('hr','work_log', p_entry::text,'promote','already_promoted',
      'Catatan ini sudah dijadikan tugas.');
  end if;
  select * into emp from ops_hr.employees where id = w.employee_id;

  v_res := ops_hr.assign_task(
    emp.employee_no, w.summary, p_due,
    p_detail => format('Dari laporan harian %s — pekerjaan dadakan, diminta oleh %s.', w.work_date, w.requested_by),
    p_goal_no => p_goal_no);
  if v_res ->> 'outcome' <> 'ok' then return v_res; end if;
  v_no := v_res -> 'data' ->> 'task_no';

  update ops_hr.tasks
     set acknowledged_at = w.created_at, started_at = w.created_at
   where task_no = v_no;
  update ops_hr.work_log
     set promoted_task_id = (select id from ops_hr.tasks where task_no = v_no),
         promoted_by = auth.uid(), promoted_at = now()
   where id = w.id;

  return ops_core.ok('hr','work_log', w.id::text,'promote',
    jsonb_build_object('entry_id', w.id, 'task_no', v_no),
    null,
    jsonb_build_object('task_no', v_no, 'due', p_due, 'goal', p_goal_no));
end $$;

/* ── HRD's day: who logged, how much of it was dadakan ────────────────── */
create or replace function ops_hr.work_log_roster(p_date date)
returns table (
  employee_no text, full_name text, unit text, "position" text,
  scheduled boolean, mark_kind text,
  entries int, task_entries int, dadakan_entries int,
  hours numeric, dadakan_hours numeric)
language plpgsql stable security definer set search_path = ops_hr, ops_core, pg_temp as $$
begin
  if not (ops_core.has_permission('hrd.read') or ops_core.has_permission('payroll.read')) then
    raise exception using errcode = '42501',
      message = 'Laporan harian semua orang butuh akses HRD.';
  end if;
  return query
    select e.employee_no, e.full_name, e.unit, e.position,
           not ops_hr.is_rest_day(ops_hr.rules_on(p_date), p_date)
             and not coalesce((ops_hr.schedule_day(ops_hr.pattern_on(e.schedule_code, e.unit, p_date), p_date)
                               ->> 'off')::boolean, false),
           d.mark_kind::text,
           count(l.id)::int,
           count(l.id) filter (where l.task_id is not null)::int,
           count(l.id) filter (where l.task_id is null)::int,
           coalesce(sum(l.hours), 0),
           coalesce(sum(l.hours) filter (where l.task_id is null), 0)
      from ops_hr.employees e
      left join lateral ops_hr.timesheet(e.id, p_date, p_date) d on true
      left join ops_hr.work_log l on l.employee_id = e.id and l.work_date = p_date
     where e.active and ops_hr.owes_daily_log(e.id)
     group by e.id, e.employee_no, e.full_name, e.unit, e.position, e.schedule_code, d.mark_kind
     order by count(l.id) = 0 desc, e.full_name;
end $$;

/* ── the review's evidence ────────────────────────────────────────────────
 *
 *  What a performance advisory is written from, for one person over one
 *  period. Readable by HRD and payroll — and by the person, about
 *  themselves: the basis of an assessment is something the assessed can read.
 */
create or replace function ops_hr.work_evidence(p_employee_no text, p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare emp ops_hr.employees%rowtype; lc record; v jsonb;
begin
  select * into emp from ops_hr.employees where employee_no = p_employee_no;
  if not found then
    raise exception using errcode = 'P0002', message = format('Tidak ada karyawan %s.', p_employee_no);
  end if;
  if not (ops_core.has_permission('hrd.read') or ops_core.has_permission('payroll.read')
          or emp.id = ops_hr.my_employee_id()) then
    raise exception using errcode = '42501',
      message = 'Bukti kinerja orang lain butuh akses HRD atau penggajian.';
  end if;

  select * into lc from ops_hr.daily_log_coverage(emp.id, p_from, p_to);

  with l as (
    select w.*, t.task_no, t.title as task_title, t.status as task_status,
           g.goal_no, g.title as goal_title
      from ops_hr.work_log w
      left join ops_hr.tasks t on t.id = w.task_id
      left join ops_hr.goals g on g.id = t.goal_id
     where w.employee_id = emp.id and w.work_date between p_from and p_to
  )
  select jsonb_build_object(
    'employee_no', emp.employee_no,
    'full_name', emp.full_name,
    'period_start', p_from,
    'period_end', p_to,
    'has_account', ops_hr.owes_daily_log(emp.id),
    'days_expected', lc.expected,
    'days_logged', lc.logged,
    'counted_from', lc.counted_from,
    'coverage', case when lc.expected = 0 then null
                     else round(lc.logged::numeric / lc.expected * 100)::int end,
    'entries', (select count(*) from l),
    'task_entries', (select count(*) from l where task_id is not null),
    'dadakan_entries', (select count(*) from l where task_id is null),
    'dadakan_share', (select case when count(*) = 0 then null
                                  else round(count(*) filter (where task_id is null)::numeric / count(*) * 100)::int end
                        from l),
    'hours_task', (select coalesce(sum(hours), 0) from l where task_id is not null),
    'hours_dadakan', (select coalesce(sum(hours), 0) from l where task_id is null),
    'entries_without_hours', (select count(*) from l where hours is null),
    'promoted', (select count(*) from l where promoted_task_id is not null),
    'first_day', (select min(work_date) from l),
    'last_day', (select max(work_date) from l),
    'tasks', coalesce((
      select jsonb_agg(x order by x.days desc, x.task_no)
        from (select task_no, task_title as title, task_status::text as status, goal_title,
                     count(distinct work_date)::int as days,
                     (array_agg(progress order by work_date desc, created_at desc))[1] as last_progress
                from l where task_id is not null
               group by task_no, task_title, task_status, goal_title) x), '[]'::jsonb),
    'requesters', coalesce((
      select jsonb_agg(x order by x.entries desc, x.requested_by)
        from (select requested_by, count(*)::int as entries
                from l where task_id is null group by requested_by) x), '[]'::jsonb),
    'goals', coalesce((
      select jsonb_agg(x order by x.entries desc, x.goal_no)
        from (select goal_no, goal_title as title, count(*)::int as entries
                from l where goal_no is not null group by goal_no, goal_title) x), '[]'::jsonb)
  ) into v;
  return v;
end $$;

/* ── /hrd/kinerja, live ───────────────────────────────────────────────────
 *
 *  The card the demo has always drawn, assembled from `kpi()` and
 *  `kpi_measures()` so the arithmetic stays in the one place it already
 *  lives. Payroll-level, like the demo: this is the most personal reading
 *  the system produces about anybody.
 */
create or replace function ops_hr.kpi_board(p_from date, p_to date, p_employee_no text default null)
returns jsonb
language plpgsql stable security definer set search_path = ops_hr, ops_core, ops_prod, pg_temp as $$
declare v jsonb;
begin
  if not ops_core.has_permission('payroll.read') then
    raise exception using errcode = '42501',
      message = 'Penilaian kinerja butuh akses penggajian.';
  end if;
  if p_employee_no is not null
     and not exists (select 1 from ops_hr.employees where employee_no = p_employee_no) then
    raise exception using errcode = 'P0002', message = format('Tidak ada karyawan %s.', p_employee_no);
  end if;

  with people as (
    select e.* from ops_hr.employees e
     where (p_employee_no is null and e.active) or e.employee_no = p_employee_no
  ),
  named as (
    select count(*) filter (where p.worked_by_employee_id is not null) as by_emp,
           count(*) filter (where p.worked_by_not_a_person) as by_team,
           count(*) filter (where p.worked_by_employee_id is null and not p.worked_by_not_a_person) as by_unknown,
           count(*) as n
      from ops_prod.progress_entries p
     where p.work_date between p_from and p_to
       and p.worked_by is not null and length(btrim(p.worked_by)) > 0
  ),
  cards as (
    select e.position, e.unit, k.*
      from people e
      cross join lateral ops_hr.kpi(e.id, p_from, p_to) k
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'employee_id', c.employee_id,
      'employee_no', c.employee_no,
      'full_name', c.full_name,
      'position', c.position,
      'unit', c.unit,
      'period_start', p_from,
      'period_end', p_to,
      'measures', (select jsonb_agg(to_jsonb(m)) from ops_hr.kpi_measures(c.employee_id, p_from, p_to) m),
      'score', c.score,
      'measured_count', c.measured_count,
      'measure_count', c.measure_count,
      'score_reason', c.score_reason,
      'overtime_hours', c.overtime_hours,
      'tasks_open', c.tasks_open,
      'tasks_blocked', c.tasks_blocked,
      'work', (
        select case when count(*) = 0 then null else jsonb_build_object(
          'entries', count(*),
          'qty', sum(p.qty),
          'by_stage', (select jsonb_agg(jsonb_build_object('stage', s.stage, 'name', s.stage, 'qty', s.qty) order by s.qty desc)
                         from (select stage, sum(qty) as qty from ops_prod.progress_entries
                                where worked_by_employee_id = c.employee_id and work_date between p_from and p_to
                                group by stage) s),
          'work_orders', (select jsonb_agg(jsonb_build_object('wo_no', o.wo_no, 'product_name', o.product_name, 'qty', o.qty) order by o.qty desc)
                            from (select coalesce(wo.wo_no, pe.wo_id::text) as wo_no,
                                         coalesce(pr.name, wo.product_code, '—') as product_name,
                                         sum(pe.qty) as qty
                                    from ops_prod.progress_entries pe
                                    left join ops_prod.work_orders wo on wo.id = pe.wo_id
                                    left join ops_prod.products pr on pr.product_code = wo.product_code
                                   where pe.worked_by_employee_id = c.employee_id and pe.work_date between p_from and p_to
                                   group by coalesce(wo.wo_no, pe.wo_id::text), coalesce(pr.name, wo.product_code, '—')) o),
          'first', min(p.work_date),
          'last', max(p.work_date)) end
          from ops_prod.progress_entries p
         where p.worked_by_employee_id = c.employee_id and p.work_date between p_from and p_to),
      'work_attribution', (select jsonb_build_object(
          'employee', n.by_emp, 'not_a_person', n.by_team, 'unknown', n.by_unknown,
          'coverage', case when n.n = 0 then 0 else round((n.by_emp + n.by_team)::numeric / n.n * 100)::int end)
        from named n),
      'notes', to_jsonb(coalesce(c.notes, '{}'::text[]))
    ) order by (c.score is null), c.score nulls last, c.full_name), '[]'::jsonb)
    into v
    from cards c;
  return v;
end $$;

/* ── grants, named one at a time (F147) ───────────────────────────────── */
revoke execute on function ops_hr.owes_daily_log(uuid) from public;
revoke execute on function ops_hr.daily_log_coverage(uuid, date, date) from public;
revoke execute on function ops_hr.log_work(text, text, text, text, numeric, uuid) from public;
revoke execute on function ops_hr.remove_work_log(uuid) from public;
revoke execute on function ops_hr.promote_work_log(uuid, date, text) from public;
revoke execute on function ops_hr.work_log_roster(date) from public;
revoke execute on function ops_hr.work_evidence(text, date, date) from public;
revoke execute on function ops_hr.kpi_board(date, date, text) from public;

grant execute on function ops_hr.owes_daily_log(uuid) to authenticated;
grant execute on function ops_hr.daily_log_coverage(uuid, date, date) to authenticated;
grant execute on function ops_hr.log_work(text, text, text, text, numeric, uuid) to authenticated;
grant execute on function ops_hr.remove_work_log(uuid) to authenticated;
grant execute on function ops_hr.promote_work_log(uuid, date, text) to authenticated;
grant execute on function ops_hr.work_log_roster(date) to authenticated;
grant execute on function ops_hr.work_evidence(text, date, date) to authenticated;
grant execute on function ops_hr.kpi_board(date, date, text) to authenticated;

analyze ops_hr.work_log;
