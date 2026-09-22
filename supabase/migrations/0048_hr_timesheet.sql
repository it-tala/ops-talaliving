-- 0048_hr_timesheet.sql — reading a day's taps, and what the reading is worth.
--
-- This is the transcription of `timesheetDay` in `src/demo/hr-derive.ts`, and
-- it is the largest single derivation in HR. What it produces is not a number
-- but a **reading**: the first tap is masuk, a tap in the middle of the day is
-- the break going out and coming back, the first tap after mid-afternoon is
-- pulang, and a pair after that is the lembur.
--
-- What matters more than the rule is what happens when it does not fit.
-- Anything left over, or any slot the rule cannot fill, makes the day
-- `review` — never a guess. On the export this was built against that is 48
-- days out of 227, and each of them is somebody's wages (D141).
--
-- `v_payroll_line` is NOT here, and writing this is what showed why. It needs
-- `allowance_withholdings` (D250) and the contributions pair (D259), and none
-- of the three is in the ladder: the first was never in `02-database.md`'s
-- migration list, and the other two are still waiting on
-- `contribution_scheme_t`. They go in 0046 with the gross figure that reads
-- them.

-- The working pattern this person is on (Q44/Q53, D274, D279). Never in the
-- design's ER diagram — it arrived in the contracts with M58, after that
-- section was written, and `scheduleFor` has read it ever since. Null means
-- **nobody has linked one**, which is a gap HR is asked to close and never an
-- assumption: a person assumed onto the office clock is the mistake Q44 was
-- raised about (F70).
alter table ops_hr.employees add column schedule_code text;

-- Minutes from midnight **in WITA**, not UTC and not the reader's locale
-- (F17, F39). The slot windows are clock times somebody in Makassar would
-- recognise, so they have to be compared against the same clock.
create or replace function ops_hr.wita_minutes(p_at timestamptz)
returns int
language sql immutable as $$
  select (extract(hour from p_at at time zone 'Asia/Makassar')::int) * 60
       + (extract(minute from p_at at time zone 'Asia/Makassar')::int)
$$;

-- Hours between two stamps, to two decimals, never negative.
create or replace function ops_hr.span_hours(p_from timestamptz, p_to timestamptz)
returns numeric
language sql immutable as $$
  select case when p_from is null or p_to is null then 0
              else greatest(round(extract(epoch from (p_to - p_from))::numeric / 3600, 2), 0) end
$$;

-- ── the rule book in force ────────────────────────────────────────────────
--
-- Ordered by date **and then by version**. By date alone the winner depends on
-- the order rows happen to come back in, which is fine until two books share
-- an effective date — and one does, because v4 corrects v3 from the day v3
-- itself began rather than changing policy from today (D270).
--
-- Before the first version there is no policy, and the honest fallback is the
-- earliest one somebody wrote down rather than an invented default.
create or replace function ops_hr.rules_on(p_date date)
returns jsonb
language sql stable set search_path = ops_hr, pg_temp as $$
  select coalesce(
    (select rules from ops_hr.pay_rule_sets
      where effective_from <= p_date
      order by effective_from desc, version desc limit 1),
    (select rules from ops_hr.pay_rule_sets
      order by effective_from asc, version asc limit 1)
  )
$$;

-- Person first, then their unit, then nothing — and *nothing* is a real answer
-- rather than a default. Every reader has to decide what to do about somebody
-- whose hours nobody has written down; the one thing none of them may do is
-- assume the office clock.
create or replace function ops_hr.schedule_of(p_rules jsonb, p_schedule_code text, p_unit text)
returns jsonb
language sql immutable set search_path = ops_hr, pg_temp as $$
  select coalesce(
    (select sc from jsonb_array_elements(coalesce(p_rules->'schedules','[]'::jsonb)) sc
      where p_schedule_code is not null and sc->>'code' = p_schedule_code),
    (select sc from jsonb_array_elements(coalesce(p_rules->'schedules','[]'::jsonb)) sc
      where p_unit is not null
        and sc->>'code' = (p_rules->'schedule_by_unit'->>p_unit))
  )
$$;

-- The break this schedule allows on this date — Friday differs here (Q44,
-- D274). Null means nobody has set one, which is not a break of zero, so
-- nothing is said at all rather than every day reading as over its allowance.
create or replace function ops_hr.break_allowance(p_rules jsonb, p_schedule_code text, p_unit text, p_date date)
returns int
language sql immutable set search_path = ops_hr, pg_temp as $$
  select case
    when sc is null then null
    when extract(isodow from p_date) = 5
      then coalesce((sc->>'friday_break_minutes')::int, (sc->>'break_minutes')::int)
    else (sc->>'break_minutes')::int
  end
  from ops_hr.schedule_of(p_rules, p_schedule_code, p_unit) sc
$$;

-- ── one day, read ─────────────────────────────────────────────────────────
--
-- A function rather than a view, for the reason `ops_acct.cash_events()` is
-- one: the slot rule is **sequential**. Each slot takes the first remaining
-- tap that fits and removes it, so the fifth answer depends on the first four,
-- and that is a loop rather than a projection.
-- The shape of one day's reading. A named type rather than an inline
-- `returns table`, so `timesheet()` below can return the same rows without
-- restating twenty columns and letting the two drift apart.
create type ops_hr.day_reading as (
  employee_id     uuid,
  work_date       date,
  in_at           timestamptz,
  break_out_at    timestamptz,
  break_in_at     timestamptz,
  out_at          timestamptz,
  ot_start_at     timestamptz,
  ot_end_at       timestamptz,
  taps            int,
  unplaced        int,
  work_hours      numeric,
  break_hours     numeric,
  overtime_hours  numeric,
  day_value       numeric,
  state           ops_hr.day_state_t,
  mark_no         text,
  mark_kind       ops_hr.day_mark_t,
  why             text,
  issues          text[],
  notes           text[]
);

create or replace function ops_hr.read_day(p_employee uuid, p_date date)
returns setof ops_hr.day_reading
language plpgsql stable set search_path = ops_hr, pg_temp as $$
declare
  emp           ops_hr.employees%rowtype;
  v_rules       jsonb;
  tap           record;
  kept          timestamptz[] := '{}';
  prev          timestamptz;
  rest          timestamptz[];
  v_in          timestamptz; v_bout timestamptz; v_bin timestamptz;
  v_out         timestamptz; v_ots  timestamptz; v_ote timestamptz;
  pick          timestamptz;
  n_taps        int;
  v_issues      text[] := '{}';
  v_notes       text[] := '{}';
  v_break       numeric := 0;
  v_work        numeric := 0;
  v_ot          numeric := 0;
  allowed       int;
  mk            record;
  v_value       numeric := 0;
  v_state       ops_hr.day_state_t;
  v_why         text;
  taken_before  int;
  has_letter    boolean;
  leftover      text;
begin
  select * into emp from ops_hr.employees where id = p_employee;
  if not found then return; end if;
  v_rules := ops_hr.rules_on(p_date);

  /* The taps, de-duplicated. A reader scanned twice inside two minutes is one
     arrival, not two — the real export has 29 of them. Two minutes is long
     enough to swallow a finger that did not take the first time and short
     enough to keep a genuine second tap eleven minutes later, which is a
     different event somebody has to look at (D141). */
  for tap in
    select s.at from ops_hr.attendance_scans s
     where s.employee_id = p_employee and s.work_date = p_date
     order by s.at
  loop
    if prev is null or tap.at - prev >= interval '2 minutes' then
      kept := kept || tap.at;
      prev := tap.at;
    end if;
  end loop;

  n_taps := coalesce(array_length(kept, 1), 0);
  rest := kept;

  /* Each slot takes the first remaining tap that fits, and removes it. The
     windows are the reading, and they are written here rather than buried
     because every reading can be wrong. */
  if n_taps > 0 then
    v_in := rest[1];
    rest := rest[2:];

    select t into pick from unnest(rest) t
      where ops_hr.wita_minutes(t) >= 11*60 and ops_hr.wita_minutes(t) < 13*60+30
      order by t limit 1;
    if pick is not null then v_bout := pick; rest := array_remove(rest, pick); pick := null; end if;

    select t into pick from unnest(rest) t
      where ops_hr.wita_minutes(t) >= 11*60+30 and ops_hr.wita_minutes(t) < 14*60+30
      order by t limit 1;
    if pick is not null then v_bin := pick; rest := array_remove(rest, pick); pick := null; end if;

    select t into pick from unnest(rest) t
      where ops_hr.wita_minutes(t) >= 14*60+30
      order by t limit 1;
    if pick is not null then v_out := pick; rest := array_remove(rest, pick); pick := null; end if;

    if v_out is not null then
      select t into pick from unnest(rest) t where t > v_out order by t limit 1;
      if pick is not null then v_ots := pick; rest := array_remove(rest, pick); pick := null; end if;
    end if;

    if v_ots is not null then
      select t into pick from unnest(rest) t where t > v_ots order by t limit 1;
      if pick is not null then v_ote := pick; rest := array_remove(rest, pick); pick := null; end if;
    end if;
  end if;

  v_break := ops_hr.span_hours(v_bout, v_bin);
  v_work  := greatest(round(ops_hr.span_hours(v_in, v_out) - v_break, 2), 0);
  v_ot    := ops_hr.span_hours(v_ots, v_ote);

  /* Anything the rule could not place. Left-over taps are the loudest signal
     that a day needs a person: they are real events nobody has explained. */
  if coalesce(array_length(rest, 1), 0) > 0 then
    select string_agg(to_char(t at time zone 'Asia/Makassar', 'HH24:MI'), ', ' order by t)
      into leftover from unnest(rest) t;
    v_issues := v_issues || format('%s tap(s) the rule could not place: %s', array_length(rest,1), leftover);
  end if;

  if n_taps > 0 then
    if v_out is null then v_issues := v_issues || 'No pulang — the day has no end'::text; end if;
    if v_bout is null or v_bin is null then v_issues := v_issues || 'Istirahat incomplete'::text; end if;
    if v_ots is not null and v_ote is null then v_issues := v_issues || 'Lembur started and never finished'::text; end if;

    /* A break that ran past its allowance is **reported, never deducted** — it
       is a fact about a day, and turning it into money is the same decision
       lateness has been waiting on since D251. */
    allowed := ops_hr.break_allowance(v_rules, emp.schedule_code, emp.unit, p_date);
    if allowed is not null and v_break * 60 > allowed then
      v_notes := v_notes || format('Istirahat %s menit, lewat %s menit dari jatah %s menit',
        round(v_break*60), round(v_break*60) - allowed, allowed);
    end if;
  end if;

  /* The mark, if there is one. A person's own mark wins over an office-wide
     one: the demo picks whichever its array happens to hold first, which is
     not a decision anybody made — see F101. */
  select m.mark_no, m.kind, m.work_date into mk
    from ops_hr.day_marks m
   where m.work_date = p_date
     and (m.employee_id = p_employee or m.employee_id is null)
   order by (m.employee_id is null)
   limit 1;

  if mk.mark_no is not null then
    v_state := 'marked';
    case mk.kind
      when 'half_day' then
        v_value := 0.5; v_why := 'Setengah hari — dibayar 0,5 hari.';
      when 'holiday' then
        v_value := 0;
        v_why := case when v_work > 0
          then 'Tanggal merah — jam yang dikerjakan dihitung lembur, harinya sendiri tidak.'
          else 'Tanggal merah — bukan hari kerja.' end;
      when 'sick' then
        select exists (
          select 1 from ops_core.attachment_links l
           where l.entity = 'day_mark' and l.entity_no = mk.mark_no
             and l.kind = 'surat_dokter' and l.unlinked_at is null
        ) into has_letter;
        v_value := case when has_letter then 1 else 0 end;
        v_why := case when has_letter
          then 'Sakit dengan surat dokter — dibayar penuh.'
          else 'Sakit tanpa surat dokter — tidak dibayar.' end;
      when 'leave' then
        select count(*) into taken_before from ops_hr.day_marks m2
         where m2.kind = 'leave' and m2.employee_id = p_employee
           and extract(year from m2.work_date) = extract(year from p_date)
           and m2.work_date < p_date;
        if emp.paid_leave_days - taken_before > 0 then
          v_value := 1;
          v_why := format('Cuti berbayar — sisa hak cuti %s hari sebelum hari ini, dari %s.',
                          emp.paid_leave_days - taken_before, emp.paid_leave_days);
        else
          v_value := 0;
          v_why := format('Cuti di luar hak — jatah %s hari tahun ini sudah habis.', emp.paid_leave_days);
        end if;
      when 'permit' then
        v_value := 0; v_why := 'Izin — tercatat, tidak dibayar.';
      else
        v_value := 0; v_why := 'Tidak masuk tanpa keterangan — tidak dibayar.';
    end case;

    if mk.kind = 'holiday' then
      /* Tanggal merah: being here at all is overtime (owner). The day itself
         is not a working day, so it adds no day_value — the hours do. */
      v_ot := case when v_work > 0 then v_work else v_ot end;
      v_work := 0;
    elsif mk.kind <> 'half_day' then
      /* Away is away: no hours are counted for a day somebody did not work,
         whether or not it is paid. The taps themselves stay untouched — it is
         the counting that stops, not the record (D142). */
      v_work := 0; v_break := 0; v_ot := 0;
    end if;

  elsif n_taps = 0 then
    v_state := 'off'; v_value := 0;
    v_why := 'Tidak ada absensi sama sekali pada hari ini.';
  elsif array_length(v_issues, 1) > 0 then
    v_state := 'review'; v_value := 0;
    v_why := 'Belum dibaca — absensi hari ini tidak lengkap, jadi belum bernilai.';
  else
    v_state := 'complete'; v_value := 1;
    v_why := 'Hari kerja penuh.';
  end if;

  return query select
    p_employee, p_date, v_in, v_bout, v_bin, v_out, v_ots, v_ote,
    n_taps, coalesce(array_length(rest,1), 0),
    v_work, v_break, v_ot, v_value, v_state,
    mk.mark_no, mk.kind, v_why, v_issues, v_notes;
end $$;

-- ── a period, read ────────────────────────────────────────────────────────
--
-- Every day of a period for one person, **including the days with nothing on
-- them** — a day nobody scanned is a fact too, and it is the one that reads
-- `off` and asks somebody to say what it was.
create or replace function ops_hr.timesheet(p_employee uuid, p_from date, p_to date)
returns setof ops_hr.day_reading
language sql stable set search_path = ops_hr, pg_temp as $$
  select d.*
    from generate_series(p_from, p_to, interval '1 day') g(day)
   cross join lateral ops_hr.read_day(p_employee, g.day::date) d
$$;

-- The days that have something on them, for every active person. The `off`
-- days are deliberately not here: a day with no tap and no mark only exists
-- relative to a period somebody asked about, and a view has no period. That is
-- what `ops_hr.timesheet(employee, from, to)` is for.
create or replace view ops_hr.v_timesheet_day as
select e.employee_no, e.full_name, d.*
  from ops_hr.employees e
  join lateral (
    select distinct s.work_date from ops_hr.attendance_scans s where s.employee_id = e.id
    union
    select distinct m.work_date from ops_hr.day_marks m
     where m.employee_id = e.id or m.employee_id is null
  ) days on true
  cross join lateral ops_hr.read_day(e.id, days.work_date) d;

alter view ops_hr.v_timesheet_day set (security_invoker = on);

grant select on ops_hr.v_timesheet_day to authenticated;
