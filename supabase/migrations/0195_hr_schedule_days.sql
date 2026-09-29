-- 0195 — a pattern with its own hours per weekday, a day read by the schedule,
-- and a Saturday worth two (D340, F197).
--
-- ── what the owner asked for ──────────────────────────────────────────────
--
-- Evaluating September's biometric upload against the payroll sheet, the
-- owner answered the difference point by point (D340):
--
--   1. *Sabtu, Minggu, tanggal merah hitung 2×.*
--   3. *Tap yang lebih/kurang tidak perlu dipermasalahkan. Asal total jam kerja
--      yang terbaca normal — 7 jam untuk Jumat, 8,25 jam untuk Senin–Kamis
--      berdasarkan jadwal. Jangan di-hardcode, buat itu terhubung berdasarkan
--      jadwal. Di jadwal harusnya bisa di-setting per harinya.*
--   6. *Sesuaikan dengan sheets* — insentif and tunjangan Senin–Jumat only,
--      lembur 1,5× and 2× past 22.00, both on the day rate.
--
-- ── what this migration adds, all of it opt-in by the rule book ───────────
--
-- Nothing below changes a single figure until a rule-book version says so; a
-- book without the new keys reads and pays exactly as `0186` did. That is
-- what lets the whole ladder and every smoke test stand unchanged.
--
-- 1. **`days` on a pattern.** `{"1": {...}, …, "7": {...}}`, ISO weekdays,
--    each with `start_minutes`, `end_minutes`, `break_minutes`,
--    `pay_multiplier` and `off`. A weekday not listed takes the pattern's own
--    hours, and Friday its Friday ones, as before. `schedule_day()` is that
--    rule, stated once; `break_allowance`, `read_day` and the payroll's
--    lateness read through it.
-- 2. **`day_reading: "schedule"`.** A day with any tap is a day present, its
--    hours read against the weekday's pattern (masuk = first tap, pulang = the
--    tap nearest the scheduled end or the scheduled end itself, less the
--    pattern's break, rounded to 15 minutes). No day goes to review for a tap
--    too many or too few. `slots`, the default, is `0186`'s reading unchanged.
-- 3. **`pay_multiplier`.** A day's pay for a daily or hourly person is
--    `day_value × multiplier`. `holiday_pay_multiplier` does the same for a
--    tanggal merah somebody came in on. The monthly salary is untouched.
-- 4. **`allowance_on_premium_days: false`** keeps tunjangan off days paid at
--    more than one.
-- 5. **Overtime past 22.00** (`overtime_night_after_minutes`,
--    `overtime_night_multiplier`) for lines that say when they finished
--    (`overtime_lines.until_minutes`), and **`overtime_exact_hourly`**, which
--    prices an hour before rounding it to the rupiah, as the sheet does.
-- 6. **`set_schedule_days`**, HRD's seam for (1), shaped like
--    `set_schedule_hours`.
--
-- The office clock is `ops_core.office_tz()` (0190, D334) throughout.

/* ── the weekday's own hours ──────────────────────────────────────────── */

create or replace function ops_hr.weekday_name(p_isodow int)
returns text
language sql immutable set search_path = pg_temp as $$
  select (array['Senin','Selasa','Rabu','Kamis','Jumat','Sabtu','Minggu'])[p_isodow]
$$;

-- What one weekday is on a pattern: its start, end and break, what a day of it
-- is worth, and whether it is a day off. Null for no pattern.
create or replace function ops_hr.schedule_day(p_sc jsonb, p_date date)
returns jsonb
language sql immutable set search_path = ops_hr, pg_temp as $$
  select case when p_sc is null then null else
    jsonb_build_object(
      'isodow', extract(isodow from p_date)::int,
      'start_minutes', p_sc -> 'start_minutes',
      'end_minutes', case when extract(isodow from p_date) = 5
                          then coalesce(nullif(p_sc -> 'friday_end_minutes', 'null'::jsonb), p_sc -> 'end_minutes')
                          else p_sc -> 'end_minutes' end,
      'break_minutes', case when extract(isodow from p_date) = 5
                          then coalesce(nullif(p_sc -> 'friday_break_minutes', 'null'::jsonb), p_sc -> 'break_minutes')
                          else p_sc -> 'break_minutes' end,
      'pay_multiplier', 1,
      'off', false)
    || coalesce(jsonb_strip_nulls(p_sc -> 'days' -> (extract(isodow from p_date)::int)::text), '{}'::jsonb)
  end
$$;

grant execute on function ops_hr.weekday_name(int), ops_hr.schedule_day(jsonb, date) to authenticated;

-- Restated from `0048`: the break of the weekday, read through `schedule_day`.
create or replace function ops_hr.break_allowance(p_rules jsonb, p_schedule_code text, p_unit text, p_date date)
returns int
language sql immutable set search_path = ops_hr, pg_temp as $$
  select case when sc is null then null
              when coalesce((ops_hr.schedule_day(sc, p_date) ->> 'off')::boolean, false) then null
              else ops_hr.minutes_of(ops_hr.schedule_day(sc, p_date) -> 'break_minutes') end
  from ops_hr.schedule_of(p_rules, p_schedule_code, p_unit) sc
$$;

/* ── when an overtime line finished ───────────────────────────────────── */
alter table ops_hr.overtime_lines
  add column if not exists until_minutes int
    check (until_minutes is null or (until_minutes >= 0 and until_minutes <= 1440));
comment on column ops_hr.overtime_lines.until_minutes is
  'Jam selesai lembur (menit dari tengah malam, jam kantor). Hanya dipakai untuk bagian lewat overtime_night_after_minutes (0195).';

/* ── the reading carries what the day is worth ────────────────────────── */
alter type ops_hr.day_reading
  add attribute pay_multiplier  numeric cascade,
  add attribute scheduled_hours numeric cascade;

alter type ops_hr.timesheet_row
  add attribute pay_multiplier  numeric cascade,
  add attribute scheduled_hours numeric cascade;

/* ── one day, read — restated from 0186 (0190's clock), with the schedule reading ── */
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
  v_sc          jsonb;
  v_night       boolean;
  v_from        timestamptz;
  v_to          timestamptz;
  v_out_from    timestamptz;
  -- 0195: the reading by the schedule (D340).
  v_mode        text;
  v_sd          jsonb;
  v_mult        numeric := 1;
  v_sched       numeric;
  s_min int; e_min int; b_min int;
  v_start_at    timestamptz;
  v_end_at      timestamptz;
  v_hours_to    timestamptz;
  v_last        timestamptz;
  v_win         int;
  v_roundm      numeric;
  v_hol_mult    numeric;
  v_read        boolean := false;
begin
  select * into emp from ops_hr.employees where id = p_employee;
  if not found then return; end if;
  v_rules := ops_hr.rules_on(p_date);
  v_sc    := ops_hr.pattern_on(emp.schedule_code, emp.unit, p_date);
  v_night := ops_hr.is_overnight(v_sc);
  v_from  := ops_hr.day_begins(p_employee, p_date);
  v_to    := ops_hr.day_begins(p_employee, p_date + 1);

  /* 0195 (D340). What this weekday is on the person's pattern — its own hours
     and what a day of it is worth — and how the day is read. */
  v_mode  := coalesce(v_rules ->> 'day_reading', 'slots');
  v_sd    := ops_hr.schedule_day(v_sc, p_date);
  v_mult  := coalesce((v_sd ->> 'pay_multiplier')::numeric, 1);
  s_min   := ops_hr.minutes_of(v_sd -> 'start_minutes');
  e_min   := ops_hr.minutes_of(v_sd -> 'end_minutes');
  b_min   := coalesce(ops_hr.minutes_of(v_sd -> 'break_minutes'), 0);
  if coalesce((v_sd ->> 'off')::boolean, false) or s_min is null or e_min is null then
    v_sched := null;
  else
    v_sched := greatest(ops_hr.shift_minutes(s_min, e_min) - b_min, 0) / 60.0;
  end if;

  /* The taps, de-duplicated. A reader scanned twice inside two minutes is one
     arrival, not two — the real export has 29 of them. Two minutes is long
     enough to swallow a finger that did not take the first time and short
     enough to keep a genuine second tap eleven minutes later, which is a
     different event somebody has to look at (D141).

     The `work_date` pair is only there so the index is used: the window never
     reaches outside the day and the one after it. */
  for tap in
    select s.at from ops_hr.attendance_scans s
     where s.employee_id = p_employee
       and s.work_date between p_date and p_date + 1
       and s.at >= v_from and s.at < v_to
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
  if n_taps > 0 and v_mode = 'schedule' and not v_night then
    /* ── read by the schedule (D340) ──────────────────────────────────────
       The owner: *tap yang lebih/kurang tidak perlu dipermasalahkan, asal
       total jam kerja yang terbaca normal*. So a day with any tap on it is a
       day present, and its hours are read against **this weekday's** pattern,
       the way the payroll sheet has always read them:

         masuk   the first tap; arriving early does not add hours;
         pulang  the tap nearest the scheduled end, within `out_window_minutes`
                 (30) either side — and when there is none, the scheduled end
                 itself: a missing pulang is a missing tap, not a short day;
         hours   min(pulang, end) − max(masuk, start) − the pattern's break,
                 rounded to `hours_rounding_minutes` (15);
         lembur  the last tap past pulang, rounded the same way. Shown, and
                 never paid from here: only an approved overtime sheet pays
                 (D138).

       Break taps are placed for the screen only; the break deducted is the
       pattern's, whether or not anybody tapped out for it. */
    v_read   := true;
    v_win    := coalesce((v_rules ->> 'out_window_minutes')::int, 30);
    v_roundm := coalesce((v_rules ->> 'hours_rounding_minutes')::numeric, 15);
    v_in     := kept[1];
    v_last   := case when n_taps > 1 then kept[n_taps] end;

    select t into pick from unnest(kept[2:]) t
      where ops_hr.wita_minutes(t) >= 11*60 and ops_hr.wita_minutes(t) < 13*60+30
      order by t limit 1;
    if pick is not null then v_bout := pick; pick := null; end if;
    select t into pick from unnest(kept[2:]) t
      where ops_hr.wita_minutes(t) >= 11*60+30 and ops_hr.wita_minutes(t) < 14*60+30
        and (v_bout is null or t > v_bout)
      order by t limit 1;
    if pick is not null then v_bin := pick; pick := null; end if;

    if v_sched is not null then
      v_start_at := (p_date::timestamp + make_interval(mins => s_min)) at time zone ops_core.office_tz();
      v_end_at   := (p_date::timestamp + make_interval(mins => e_min)) at time zone ops_core.office_tz();
      select t into pick from unnest(kept[2:]) t
        where abs(extract(epoch from t - v_end_at)) <= v_win * 60
        order by abs(extract(epoch from t - v_end_at)), t limit 1;
      if pick is not null then v_out := pick; pick := null; end if;
      v_hours_to := coalesce(v_out, v_end_at);
      v_work := greatest(extract(epoch from least(v_hours_to, v_end_at)
                                 - greatest(v_in, v_start_at)) / 60 - b_min, 0);
      v_work := case when v_roundm > 0 then round(v_work / v_roundm) * v_roundm else v_work end / 60.0;
      if v_last is not null and v_last > v_hours_to then
        v_ots := v_hours_to; v_ote := v_last;
        v_ot  := extract(epoch from v_last - v_hours_to) / 60;
        v_ot  := case when v_roundm > 0 then round(v_ot / v_roundm) * v_roundm else v_ot end / 60.0;
      end if;
      if v_out is null then
        v_notes := v_notes || format('Tidak ada tap pulang dekat %s — jam pulang dibaca sesuai jadwal',
                                     ops_hr.clock_face(e_min));
      end if;
    else
      /* A weekday the pattern has no hours for, or nobody on a pattern: the
         hours are what the taps span, less the break, rounded the same way. */
      v_out  := v_last;
      v_work := greatest(extract(epoch from coalesce(v_last, v_in) - v_in) / 60 - b_min, 0);
      v_work := case when v_roundm > 0 then round(v_work / v_roundm) * v_roundm else v_work end / 60.0;
    end if;
    v_break := b_min / 60.0;
    rest := '{}';

  elsif n_taps > 0 and not v_night then
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

  elsif n_taps > 0 then
    /* The night, read against its own clock. Pulang is the first tap in the
       last stretch of the shift — its final three hours, or its second half
       if it is shorter than six — which is where the day reading's 14:30 sits
       for an office that finishes at 17:15. A guard who leaves at 02:00 has no
       pulang and goes to review, rather than being read as a short night
       nobody looked at. Anything between masuk and that stretch is the break
       going out and coming back. */
    v_out_from := ((p_date + 1)::timestamp
                   + make_interval(mins => ops_hr.minutes_of(v_sc -> 'end_minutes')))
                  at time zone ops_core.office_tz()
                  - make_interval(mins => least(180,
                      ops_hr.shift_minutes(ops_hr.minutes_of(v_sc -> 'start_minutes'),
                                           ops_hr.minutes_of(v_sc -> 'end_minutes')) / 2));
    v_in := rest[1];
    rest := rest[2:];

    select t into pick from unnest(rest) t where t < v_out_from order by t limit 1;
    if pick is not null then v_bout := pick; rest := array_remove(rest, pick); pick := null; end if;

    select t into pick from unnest(rest) t where t < v_out_from order by t limit 1;
    if pick is not null then v_bin := pick; rest := array_remove(rest, pick); pick := null; end if;

    select t into pick from unnest(rest) t where t >= v_out_from order by t limit 1;
    if pick is not null then v_out := pick; rest := array_remove(rest, pick); pick := null; end if;
  end if;

  if v_out is not null and not v_read then
    select t into pick from unnest(rest) t where t > v_out order by t limit 1;
    if pick is not null then v_ots := pick; rest := array_remove(rest, pick); pick := null; end if;
  end if;

  if v_ots is not null and not v_read then
    select t into pick from unnest(rest) t where t > v_ots order by t limit 1;
    if pick is not null then v_ote := pick; rest := array_remove(rest, pick); pick := null; end if;
  end if;

  if not v_read then
    v_break := ops_hr.span_hours(v_bout, v_bin);
    v_work  := greatest(round(ops_hr.span_hours(v_in, v_out) - v_break, 2), 0);
    v_ot    := ops_hr.span_hours(v_ots, v_ote);
  end if;

  /* Anything the rule could not place. Left-over taps are the loudest signal
     that a day needs a person: they are real events nobody has explained. */
  if coalesce(array_length(rest, 1), 0) > 0 then
    select string_agg(to_char(t at time zone ops_core.office_tz(), 'HH24:MI'), ', ' order by t)
      into leftover from unnest(rest) t;
    v_issues := v_issues || format('%s tap(s) the rule could not place: %s', array_length(rest,1), leftover);
  end if;

  if n_taps > 0 and not v_read then
    if v_out is null then v_issues := v_issues || 'No pulang — the day has no end'::text; end if;
    /* A guard on post does not go out to eat, so a night with no break taps
       at all is a whole night, not an incomplete one. Half a break is still
       half a break. */
    if (not v_night and (v_bout is null or v_bin is null))
       or (v_night and v_bout is not null and v_bin is null) then
      v_issues := v_issues || 'Istirahat incomplete'::text;
    end if;
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

  /* The mark, if there is one, and **the office-wide one wins** (F101, the
     owner's ruling of 2026-09-18). 0045 had it the other way round on my own
     reading of specific-over-general; the owner's answer is that a closed day
     is closed for everybody — *kantor tutup, artinya kita tidak membayar
     siapapun, di luar jadwal kerja* — so a personal mark on it is neither an
     absence nor a permit, and it takes nothing from anybody's entitlement. */
  select m.mark_no, m.kind, m.work_date into mk
    from ops_hr.day_marks m
   where m.work_date = p_date
     and (m.employee_id = p_employee or m.employee_id is null)
     and m.withdrawn_at is null
   order by (m.employee_id is null) desc
   limit 1;

  if mk.mark_no is not null then
    v_state := 'marked';
    case mk.kind
      when 'half_day' then
        v_value := 0.5; v_why := 'Setengah hari — dibayar 0,5 hari.';
      when 'holiday' then
        v_value := 0;
        v_hol_mult := (v_rules ->> 'holiday_pay_multiplier')::numeric;
        v_why := case when v_hol_mult is not null and n_taps > 0
          then format('Tanggal merah — masuk, dibayar %s× sehari.', v_hol_mult)
          when v_work > 0
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
           and m2.withdrawn_at is null
           and extract(year from m2.work_date) = extract(year from p_date)
           and m2.work_date < p_date
           and not ops_hr.office_closed(m2.work_date);
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

    if mk.kind = 'holiday' and v_hol_mult is not null and n_taps > 0 then
      /* 0195 (D340): *Sabtu, Minggu, tanggal merah hitung 2×*. Somebody who
         came in on a red day worked a day, worth `holiday_pay_multiplier`
         of one; the hours stay hours. */
      v_value := 1; v_mult := v_hol_mult;
    elsif mk.kind = 'holiday' then
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
    v_why := case when v_mult <> 1
      then format('Hari kerja — dibayar %s× sehari menurut jadwal hari ini.', v_mult)
      else 'Hari kerja penuh.' end;
  end if;

  /* A marked day is worth what the mark says; only a day somebody worked
     takes the weekday's multiplier (a half day is still half of that day). */
  if mk.mark_no is not null and not (mk.kind = 'holiday' and v_hol_mult is not null and n_taps > 0)
     and mk.kind <> 'half_day' then
    v_mult := 1;
  end if;

  return query select
    p_employee, p_date, v_in, v_bout, v_bin, v_out, v_ots, v_ote,
    n_taps, coalesce(array_length(rest,1), 0),
    v_work, v_break, v_ot, v_value, v_state,
    mk.mark_no, mk.kind, v_why, v_issues, v_notes,
    v_from, v_to, v_night, v_mult, v_sched;
end $$;


/* ── the days that have something on them ─────────────────────────────── */
create or replace view ops_hr.v_timesheet_day as
select e.employee_no, e.full_name, d.*
  from ops_hr.employees e
  join lateral (
    select distinct ops_hr.shift_day(e.id, s.at) as work_date
      from ops_hr.attendance_scans s where s.employee_id = e.id
    union
    select distinct m.work_date from ops_hr.day_marks m
     where m.employee_id = e.id or m.employee_id is null
  ) days on true
  cross join lateral ops_hr.read_day(e.id, days.work_date) d;

alter view ops_hr.v_timesheet_day set (security_invoker = on);

/* ── the timesheet rows — restated from 0186; the last two columns are new ── */
create or replace function ops_hr.timesheet_rows(
  p_from date, p_to date, p_unit text default null, p_employee_no text default null)
returns setof ops_hr.timesheet_row
language sql stable set search_path = ops_hr, pg_temp as $$
  select
    d.employee_id, e.employee_no, e.full_name, d.work_date,
    d.in_at, d.break_out_at, d.break_in_at, d.out_at, d.ot_start_at, d.ot_end_at,
    d.work_hours, d.break_hours, d.overtime_hours, d.day_value, d.state,
    d.mark_no, d.mark_kind, d.why,
    case
      when d.mark_kind = 'sick'  and d.day_value = 0
        then 'Surat dokter belum ada — dengan suratnya, hari ini dibayar penuh.'
      when d.mark_kind = 'leave' and d.day_value = 0
        then 'Jatah cuti tahun ini sudah habis — hari ini tercatat, tidak dibayar.'
      end,
    d.issues, d.notes,
    d.window_from, d.window_to, d.overnight,
    d.pay_multiplier, d.scheduled_hours
  from ops_hr.employees e
  cross join lateral generate_series(p_from, p_to, interval '1 day') g(day)
  cross join lateral ops_hr.read_day(e.id, g.day::date) d
  where e.active
    and (p_unit is null or e.unit = p_unit)
    and (p_employee_no is null or e.employee_no = p_employee_no)
  order by e.employee_no, d.work_date
$$;

/* ── what a pattern may say — restated from 0186, with the weekdays ── */
create or replace function ops_hr.schedule_problem(p_rules jsonb)
returns jsonb
language plpgsql immutable set search_path = ops_hr, pg_temp as $$
declare
  sc      jsonb;
  i       int := 0;
  v_code  text;
  v_where text;
  seen    text[] := '{}';
  st int; en int; br int; fen int; fbr int;
  f_end int; f_break int;
  span int; f_span int;
  -- 0195: the days of the week (D340)
  dk record; dv jsonb; d_where text; d_st int; d_en int; d_br int; d_span int; d_mult numeric;
  night boolean;
  u record;
begin
  -- No patterns at all is a valid book — it was the answer until M57 — and a
  -- missing key is not a malformed one.
  if p_rules is null or jsonb_typeof(p_rules -> 'schedules') is distinct from 'array' then
    return null;
  end if;

  for sc in select value from jsonb_array_elements(p_rules -> 'schedules') loop
    i := i + 1;
    v_code := btrim(coalesce(sc ->> 'code', ''));
    v_where := case when v_code = '' then 'Pola ke-' || i else 'Pola ' || v_code end;

    if v_code = '' then
      return jsonb_build_object('code','code_required',
        'message', v_where || ' belum punya kode.');
    elsif v_code !~ '^[A-Z][A-Z0-9_-]*$' then
      return jsonb_build_object('code','code_shape',
        'message', v_where || ': kode dipakai sebagai kunci di data karyawan, '
                || 'jadi hanya huruf besar, angka, garis bawah dan tanda hubung, diawali huruf.');
    elsif v_code = any(seen) then
      return jsonb_build_object('code','code_duplicate',
        'message', v_where || ' muncul dua kali. Dua pola dengan kode sama berarti '
                || 'orang yang terpasang padanya bisa terbaca sebagai salah satu dari keduanya.');
    end if;
    seen := seen || v_code;

    if btrim(coalesce(sc ->> 'name', '')) = '' then
      return jsonb_build_object('code','name_required',
        'message', v_where || ' belum punya nama.');
    end if;

    if ops_hr.bad_minutes(sc -> 'start_minutes') then
      return jsonb_build_object('code','minutes_range',
        'message', v_where || ': jam masuk harus menit dalam sehari (0–1440) atau dikosongkan.');
    end if;
    if ops_hr.bad_minutes(sc -> 'end_minutes') then
      return jsonb_build_object('code','minutes_range',
        'message', v_where || ': jam pulang harus menit dalam sehari (0–1440) atau dikosongkan.');
    end if;
    if ops_hr.bad_minutes(sc -> 'break_minutes') then
      return jsonb_build_object('code','minutes_range',
        'message', v_where || ': istirahat harus menit dalam sehari (0–1440) atau dikosongkan.');
    end if;
    if ops_hr.bad_minutes(sc -> 'friday_break_minutes') then
      return jsonb_build_object('code','minutes_range',
        'message', v_where || ': istirahat Jumat harus menit dalam sehari (0–1440) atau dikosongkan.');
    end if;
    if ops_hr.bad_minutes(sc -> 'friday_end_minutes') then
      return jsonb_build_object('code','minutes_range',
        'message', v_where || ': jam pulang Jumat harus menit dalam sehari (0–1440) atau dikosongkan.');
    end if;

    st  := ops_hr.minutes_of(sc -> 'start_minutes');
    en  := ops_hr.minutes_of(sc -> 'end_minutes');
    br  := ops_hr.minutes_of(sc -> 'break_minutes');
    fen := ops_hr.minutes_of(sc -> 'friday_end_minutes');
    fbr := ops_hr.minutes_of(sc -> 'friday_break_minutes');

    if st is not null and en is not null and en = st then
      return jsonb_build_object('code','end_before_start',
        'message', v_where || ': pulang ' || ops_hr.clock_face(en)
                || ' tidak sesudah masuk ' || ops_hr.clock_face(st) || '.');
    end if;

    night := st is not null and en is not null and en < st;
    span  := ops_hr.shift_minutes(st, en);

    -- A break that eats the whole day leaves nought hours, and nought hours is
    -- not a schedule — it is a row that quietly values every day at zero for
    -- whoever is on it.
    if span is not null and br is not null and br >= span then
      return jsonb_build_object('code','break_too_long',
        'message', v_where || ': istirahat ' || br || ' menit menghabiskan seluruh hari kerja '
                || ops_hr.clock_face(st) || '–' || ops_hr.clock_face(en) || '.');
    end if;

    if night and fen is not null then
      return jsonb_build_object('code','overnight_friday_end',
        'message', v_where || ': shift ini melewati tengah malam, jadi jam pulang Jumat '
                || 'belum bisa diatur — kosongkan; shift Jumat malam pulang pada jam pulang biasa.');
    end if;

    if not night and st is not null and fen is not null and fen <= st then
      return jsonb_build_object('code','friday_end_before_start',
        'message', v_where || ': pulang Jumat ' || ops_hr.clock_face(fen)
                || ' tidak sesudah masuk ' || ops_hr.clock_face(st) || '.');
    end if;

    -- Friday's two halves fall back independently (D289), so its arithmetic is
    -- checked on the pair it will actually be computed from — an ordinary
    -- break can be too long for a Friday that finishes early.
    f_end   := coalesce(fen, en);
    f_break := coalesce(fbr, br);
    f_span  := case when night then span
                    when st is not null and f_end is not null and f_end > st then f_end - st end;
    if f_span is not null and f_break is not null and f_break >= f_span then
      return jsonb_build_object('code','friday_break_too_long',
        'message', v_where || ': istirahat Jumat ' || f_break || ' menit menghabiskan seluruh hari Jumat '
                || ops_hr.clock_face(st) || '–' || ops_hr.clock_face(f_end) || '.');
    end if;

    /* 0195 (D340): each weekday may carry its own hours and what a day of it
       is worth. Keys are ISO weekdays, 1 Senin … 7 Minggu; a day not listed
       takes the pattern's own hours (and Friday's where set). Checked in key
       order, and each day from *is it a day* to *does its arithmetic work*.
       The sentences are `schedule-rules.ts`'s. */
    if jsonb_typeof(sc -> 'days') = 'object' then
      for dk in select key, value from jsonb_each(sc -> 'days') order by key collate "C" loop
        if dk.key !~ '^[1-7]$' then
          return jsonb_build_object('code','day_key',
            'message', v_where || ': hari "' || dk.key || '" tidak dikenal — pakai 1 (Senin) sampai 7 (Minggu).');
        end if;
        dv := dk.value;
        d_where := ops_hr.weekday_name(dk.key::int);
        if jsonb_typeof(dv) is distinct from 'object' then
          return jsonb_build_object('code','day_shape',
            'message', v_where || ': ' || d_where || ' harus berisi jam masuk, jam pulang dan istirahat, atau libur.');
        end if;
        if coalesce((dv ->> 'off')::boolean, false) then continue; end if;
        if ops_hr.bad_minutes(dv -> 'start_minutes') then
          return jsonb_build_object('code','minutes_range',
            'message', v_where || ': jam masuk ' || d_where || ' harus menit dalam sehari (0–1440) atau dikosongkan.');
        end if;
        if ops_hr.bad_minutes(dv -> 'end_minutes') then
          return jsonb_build_object('code','minutes_range',
            'message', v_where || ': jam pulang ' || d_where || ' harus menit dalam sehari (0–1440) atau dikosongkan.');
        end if;
        if ops_hr.bad_minutes(dv -> 'break_minutes') then
          return jsonb_build_object('code','minutes_range',
            'message', v_where || ': istirahat ' || d_where || ' harus menit dalam sehari (0–1440) atau dikosongkan.');
        end if;
        if dv ? 'pay_multiplier' and dv -> 'pay_multiplier' <> 'null'::jsonb then
          d_mult := case when jsonb_typeof(dv -> 'pay_multiplier') = 'number'
                         then (dv ->> 'pay_multiplier')::numeric end;
          if d_mult is null or d_mult <= 0 or d_mult > 5 then
            return jsonb_build_object('code','day_multiplier',
              'message', v_where || ': pengali upah ' || d_where || ' harus angka lebih dari 0 dan paling banyak 5.');
          end if;
        end if;
        d_st := coalesce(ops_hr.minutes_of(dv -> 'start_minutes'), st);
        d_en := coalesce(ops_hr.minutes_of(dv -> 'end_minutes'),
                         case when dk.key = '5' then coalesce(fen, en) else en end);
        d_br := coalesce(ops_hr.minutes_of(dv -> 'break_minutes'),
                         case when dk.key = '5' then coalesce(fbr, br) else br end);
        if d_st is not null and d_en is not null and d_en = d_st then
          return jsonb_build_object('code','day_end_before_start',
            'message', v_where || ': pulang ' || d_where || ' ' || ops_hr.clock_face(d_en)
                    || ' tidak sesudah masuk ' || ops_hr.clock_face(d_st) || '.');
        end if;
        d_span := ops_hr.shift_minutes(d_st, d_en);
        if d_span is not null and d_br is not null and d_br >= d_span then
          return jsonb_build_object('code','day_break_too_long',
            'message', v_where || ': istirahat ' || d_where || ' ' || d_br || ' menit menghabiskan seluruh hari '
                    || ops_hr.clock_face(d_st) || '–' || ops_hr.clock_face(d_en) || '.');
        end if;
      end loop;
    elsif sc ? 'days' and sc -> 'days' <> 'null'::jsonb then
      return jsonb_build_object('code','days_shape',
        'message', v_where || ': jadwal per hari harus berupa daftar hari 1 (Senin) sampai 7 (Minggu).');
    end if;
  end loop;

  /* A unit pointing at a pattern that is not there is worse than a unit
     pointing at nothing: nothing falls back to the company clock and says so,
     while a dangling code resolves to no schedule at all and reads as
     *belum ditetapkan* for everybody in that unit, with no sign of why.
     `collate "C"`: see 0117 and F143. */
  for u in
    select key, value from jsonb_each_text(coalesce(p_rules -> 'schedule_by_unit', '{}'::jsonb))
    order by key collate "C"
  loop
    if not (u.value = any(seen)) then
      return jsonb_build_object('code','unit_unknown_code',
        'message', 'Unit ' || u.key || ' dipasang ke pola ' || u.value
                || ', dan pola itu tidak ada di daftar.');
    end if;
  end loop;

  return null;
end $$;

/* ── overtime, night by night — restated from 0050, with the part past 22.00 ── */
create or replace function ops_hr.overtime_parts(p_employee uuid, p_from date, p_to date)
returns table (sheet_no text, work_date date, hours numeric, multiplier numeric,
               hourly bigint, amount bigint, label text)
language plpgsql stable set search_path = ops_hr, pg_temp as $$
declare
  emp    ops_hr.employees%rowtype;
  v_rules jsonb;
  rate   ops_hr.hourly_rate_t;
  mode   text;
  roundm numeric;
  ln     record;
  rest   boolean;
  tiers  jsonb;
  hrs    numeric;
  pt     record;
  -- 0195 (D340)
  night_after int;
  night_mult  numeric;
  night_hrs   numeric;
  exact       numeric;
begin
  select * into emp from ops_hr.employees where id = p_employee;
  if not found then return; end if;
  v_rules := ops_hr.rules_on(p_from);
  rate    := ops_hr.hourly_rate(emp, v_rules);
  mode    := coalesce(v_rules->>'overtime_mode', 'tiered');
  roundm  := coalesce((v_rules->>'overtime_rounding_minutes')::numeric, 0);
  /* 0195: the hours past 22.00 are paid at their own rate (the sheet's
     *lembur di atas 22.00*, 2×), and the ladder applies to the rest. */
  night_after := (v_rules->>'overtime_night_after_minutes')::int;
  night_mult  := (v_rules->>'overtime_night_multiplier')::numeric;
  /* The hour **before** rounding to the rupiah, so 3,5 jam × 1,5 × 170.500/8
     is 111.891 as the sheet has it, not 3,5 × 1,5 × 21.313. Opt-in. */
  exact := case when coalesce((v_rules->>'overtime_exact_hourly')::boolean, false)
                then rate.annual::numeric
                     / greatest(coalesce((v_rules->>'effective_days_per_year')::numeric, 300), 1)
                     / greatest(emp.daily_hours, 1)
           end;

  for ln in
    select l.hours as h, l.form_amount, l.until_minutes as um, c.sheet_no as sno, c.work_date as wd
      from ops_hr.v_overtime_claim c
      join ops_hr.overtime_lines l on l.sheet_id = c.id
     where c.payable and l.employee_id = p_employee
       and c.work_date between p_from and p_to
     order by c.work_date, c.sheet_no
  loop
    if ln.form_amount is not null then
      sheet_no := ln.sno; work_date := ln.wd; hours := ln.h; multiplier := 0;
      hourly := rate.hourly; amount := round(ln.form_amount)::bigint;
      label := 'Sesuai form lembur';
      return next;
      continue;
    end if;

    if mode = 'form_only' then
      sheet_no := ln.sno; work_date := ln.wd; hours := ln.h; multiplier := 0;
      hourly := rate.hourly; amount := 0;
      label := 'Tidak ada angka di form — tidak dibayar';
      return next;
      continue;
    end if;

    hrs := case when roundm = 0 then ln.h
                else round(ln.h / (roundm/60)) * (roundm/60) end;
    rest := ops_hr.is_rest_day(v_rules, ln.wd);

    /* The part past 22.00, when the line says when it finished. A finish
       before noon is the next morning. */
    night_hrs := 0;
    if night_after is not null and night_mult is not null and ln.um is not null then
      night_hrs := least(hrs, greatest(
        (case when ln.um < 720 then ln.um + 1440 else ln.um end - night_after) / 60.0, 0));
      hrs := hrs - night_hrs;
      if night_hrs > 0 then
        sheet_no := ln.sno; work_date := ln.wd; hours := round(night_hrs, 2);
        multiplier := night_mult; hourly := rate.hourly;
        amount := round(night_hrs * night_mult * coalesce(exact, rate.hourly))::bigint;
        label := format('Lembur lewat %s', ops_hr.clock_face(night_after));
        return next;
      end if;
    end if;
    tiers := case
      when mode = 'flat' then jsonb_build_array(jsonb_build_object(
        'after_hours', 0, 'multiplier', coalesce((v_rules->>'flat_multiplier')::numeric, 1.5)))
      when rest then coalesce(v_rules->'restday_tiers', '[]'::jsonb)
      else           coalesce(v_rules->'workday_tiers', '[]'::jsonb)
    end;

    for pt in select * from ops_hr.tier_parts(hrs, tiers) loop
      sheet_no := ln.sno; work_date := ln.wd; hours := pt.part_hours;
      multiplier := pt.multiplier; hourly := rate.hourly;
      amount := round(pt.part_hours * pt.multiplier * coalesce(exact, rate.hourly))::bigint;
      label := case when mode = 'flat'
        then format('Tarif rata %s×', pt.multiplier)
        else format('%s · jam %s', case when rest then 'Hari libur' else 'Hari kerja' end,
                    case when pt.part_hours <= 1 then format('ke-%s', round(pt.from_hour + 1))
                         else format('%s–%s', round(pt.from_hour + 1), round(pt.from_hour + pt.part_hours)) end)
      end;
      return next;
    end loop;
  end loop;
end $$;

/* ── the line — restated from 0186, with the weekday's worth ── */
create or replace function ops_hr.payroll_line_for(
  p_employee uuid, p_from date, p_to date, p_run_no text default null)
returns ops_hr.payroll_figures
language plpgsql stable set search_path = ops_hr, pg_temp as $$
declare
  emp       ops_hr.employees%rowtype;
  v_rules   jsonb;
  rate      ops_hr.hourly_rate_t;
  d         ops_hr.day_reading;
  out_row   ops_hr.payroll_figures;
  sc        jsonb;
  day_start int;
  grace     int;
  ut_mode   text;
  ut_grace  numeric;
  short     numeric := 0;
  half_days int := 0;
  gap       numeric;
  is_present boolean;
  withheld  boolean;
  n_present int := 0;
  n_withheld int := 0;
  shown_ot  numeric := 0;
  pending_ot numeric := 0;
  no_letter int := 0;
  over_leave int := 0;
  late_one  int;
  w         text[] := '{}';
  v_days    jsonb := '[]'::jsonb;
  -- 0195 (D340)
  v_mult     numeric;
  paid_units numeric := 0;
  paid_hours numeric := 0;
  prem_days  numeric := 0;
  prem_extra numeric := 0;
  allow_prem boolean;
  v_dstart   int;
begin
  select * into emp from ops_hr.employees where id = p_employee;
  if not found then return null; end if;
  /* The book in force **when the period opened**, which is the whole reason
     the rule book is dated (D173). */
  v_rules  := ops_hr.rules_on(p_from);
  rate     := ops_hr.hourly_rate(emp, v_rules);
  sc       := ops_hr.schedule_of(v_rules, emp.schedule_code, emp.unit);
  day_start := coalesce((sc->>'start_minutes')::int, (v_rules->>'day_starts_minutes')::int);
  grace    := coalesce((v_rules->>'late_grace_minutes')::int, 0);
  ut_mode  := coalesce(v_rules->>'undertime_mode', 'off');
  ut_grace := coalesce((v_rules->>'undertime_grace_minutes')::numeric, 0) / 60;
  -- 0195: whether a day paid at more than one day's rate also earns the
  -- allowance. The sheet pays insentif and tunjangan Senin–Jumat only.
  allow_prem := coalesce((v_rules->>'allowance_on_premium_days')::boolean, true);

  out_row.run_no := coalesce(p_run_no, '');
  out_row.employee_id := emp.id;
  out_row.employee_no := emp.employee_no;
  out_row.full_name := emp.full_name;
  -- Who this is, which a payslip prints and the contract has always asked for.
  out_row.position := emp.position;
  out_row.pay_basis := emp.pay_basis;
  out_row.base_rate := emp.base_rate;
  out_row.allowance_rate := emp.allowance_rate;
  out_row.worked_days := 0; out_row.open_days := 0;
  out_row.days_present := 0; out_row.days_sick_paid := 0;
  out_row.days_leave_paid := 0; out_row.days_unpaid := 0;
  out_row.normal_hours := 0;
  out_row.late_minutes := 0;
  out_row.late_days := 0;

  for d in select * from ops_hr.timesheet(emp.id, p_from, p_to) loop
    out_row.worked_days := out_row.worked_days + d.day_value;
    if d.state = 'review' then out_row.open_days := out_row.open_days + 1; end if;
    if d.day_value > 0 then out_row.normal_hours := out_row.normal_hours + d.work_hours; end if;
    shown_ot := shown_ot + d.overtime_hours;

    /* 0195 (D340): what the day is worth in days of pay. Sabtu, Minggu and a
       tanggal merah somebody came in on are worth their multiplier; the
       monthly salary is a month and does not move. */
    v_mult := coalesce(d.pay_multiplier, 1);
    paid_units := paid_units + d.day_value * v_mult;
    if d.day_value > 0 then paid_hours := paid_hours + d.work_hours * v_mult; end if;
    if v_mult > 1 and d.day_value > 0 then
      prem_days  := prem_days + d.day_value;
      prem_extra := prem_extra + d.day_value * (v_mult - 1);
    end if;

    /* The slip's own line for this day, built where the day is already in
       hand. `open` is carried rather than dropped: a day with hours beside it
       that adds nothing to the total is the one worth asking about (D156). */
    v_days := v_days || jsonb_build_object(
      'work_date', d.work_date,
      'weekday', extract(isodow from d.work_date)::int,
      'in_at', d.in_at,
      'out_at', d.out_at,
      'work_hours', d.work_hours,
      'overtime_hours', d.overtime_hours,
      'mark', case d.mark_kind
                when 'holiday'  then 'merah'
                when 'sick'     then 'sakit'
                when 'leave'    then 'cuti'
                when 'half_day' then 'setengah'
                when 'absent'   then 'alpa'
                else d.mark_kind::text end,
      'day_value', d.day_value,
      'multiplier', coalesce(d.pay_multiplier, 1),
      'scheduled_hours', d.scheduled_hours,
      'open', d.state = 'review');

    /* What the paid days are made of, so a payslip can say it rather than
       showing one total nobody can take apart (D144). */
    if d.mark_kind is null then
      if d.day_value > 0 then out_row.days_present := out_row.days_present + d.day_value; end if;
    else
      case d.mark_kind
        when 'half_day' then out_row.days_present := out_row.days_present + d.day_value;
        when 'sick'  then
          if d.day_value > 0 then out_row.days_sick_paid := out_row.days_sick_paid + 1;
          else no_letter := no_letter + 1; end if;
        when 'leave' then
          if d.day_value > 0 then out_row.days_leave_paid := out_row.days_leave_paid + 1;
          else over_leave := over_leave + 1; end if;
        else null;
      end case;
      if d.day_value = 0 and d.mark_kind <> 'holiday' then
        out_row.days_unpaid := out_row.days_unpaid + 1;
      end if;
    end if;

    /* Tunjangan is paid for **coming in**. A monthly person earns it on the
       days the business works, because the fingerprint reader is a workshop
       device and the office does not use it — making it depend on taps for
       everybody paid five office staff Rp 600.000 a month less than the day
       before (F72). No taps is not evidence of absence.

       A half day is presence, and since Q46 that is the owner's ruling rather
       than our reading of one (D272). Sakit, cuti and tanggal merah are not. */
    if emp.pay_basis = 'monthly' then
      is_present := case when d.mark_kind is not null then d.mark_kind = 'half_day'
                         else not ops_hr.is_rest_day(v_rules, d.work_date) end;
    else
      is_present := case when d.mark_kind is not null then d.mark_kind = 'half_day'
                         else d.day_value > 0 end;
      if not allow_prem and coalesce(d.pay_multiplier, 1) > 1 then is_present := false; end if;
    end if;

    if is_present then
      select exists (
        select 1 from ops_hr.allowance_withholdings aw
         where aw.employee_id = emp.id and aw.work_date = d.work_date
           and aw.restored_by is null
      ) into withheld;
      if withheld then n_withheld := n_withheld + 1; else n_present := n_present + 1; end if;
    end if;

    /* Minutes late past the grace the owner set (Q41, D251). Nobody has said
       when this person's day starts, so nothing about it is late — not zero
       because they were punctual, zero because there is no threshold, and
       inventing one puts minutes on a payslip (D274). */
    /* 0195: late against **this weekday's** start — Saturday begins at 08.00
       where Monday begins at 07.30. */
    v_dstart := coalesce(ops_hr.minutes_of(ops_hr.schedule_day(sc, d.work_date) -> 'start_minutes'), day_start);
    if d.in_at is not null and d.mark_kind is null and v_dstart is not null then
      late_one := greatest(ops_hr.late_minutes(d.in_at, d.work_date, v_dstart, grace), 0);
      out_row.late_minutes := out_row.late_minutes + late_one;
      -- **How many days**, beside how many minutes. Ninety minutes is a
      -- different conversation once across a month than nine minutes on ten
      -- mornings, and one number cannot tell those apart.
      if late_one > 0 then out_row.late_days := out_row.late_days + 1; end if;
    end if;

    /* Hours short of the contracted day. Only for people paid by the day: an
       hourly person is already paid for the hours they were here and a monthly
       salary is a month. A marked day is not a short day, it is a different
       day, and counting it here would deduct twice (D174). */
    if ut_mode <> 'off' and emp.pay_basis = 'daily'
       and d.mark_kind is null and d.state = 'complete' then
      gap := emp.daily_hours - d.work_hours;
      if gap > ut_grace then
        short := short + gap;
        if gap > emp.daily_hours / 2 then half_days := half_days + 1; end if;
      end if;
    end if;
  end loop;

  out_row.days := v_days;

  out_row.normal_hours := round(out_row.normal_hours, 2);
  out_row.worked_days  := round(out_row.worked_days, 2);
  out_row.hourly       := rate.hourly;
  out_row.hourly_basis := rate.basis;
  -- Both sums the rule book offers, and the year they come from. The screen
  -- shows the one not chosen beside the one that was, which is the only way
  -- *why is my hour worth this* has an answer (D249).
  out_row.company_hourly   := rate.company;
  out_row.statutory_hourly := rate.statutory;
  out_row.annual_pay       := rate.annual;

  /* Monthly staff are paid the month whatever the machine says; a daily or
     hourly person is paid for what they were here for. That difference is the
     only place `pay_basis` is used, and it is why it exists. */
  out_row.base_pay := case emp.pay_basis
    when 'monthly' then emp.base_rate
    when 'daily'   then round(paid_units * emp.base_rate)
    else                round(paid_hours * emp.base_rate)
  end::bigint;

  out_row.allowance_days := n_present;
  out_row.allowance_withheld_days := n_withheld;
  out_row.allowance_pay := (n_present::bigint * emp.allowance_rate);
  -- What the withheld days would have paid, and **who decided each one**. A
  -- deduction with no name against it is the kind a payslip cannot defend.
  out_row.allowance_withheld_amount := (n_withheld::bigint * emp.allowance_rate);
  select coalesce(jsonb_agg(jsonb_build_object(
           'work_date', aw.work_date,
           'reason', aw.reason,
           'by_name', coalesce(u.full_name, '')) order by aw.work_date), '[]'::jsonb)
    into out_row.allowance_withheld
    from ops_hr.allowance_withholdings aw
    left join ops_core.users u on u.id = aw."by"
   where aw.employee_id = emp.id
     and aw.work_date between p_from and p_to
     and aw.restored_by is null;

  select coalesce(sum(amount), 0), coalesce(sum(hours), 0)
    into out_row.overtime_pay, out_row.overtime_hours
    from ops_hr.overtime_parts(emp.id, p_from, p_to);

  /* The rungs, not just the total. *3 jam lembur = Rp 91.000* invites an
     argument; *jam ke-1 × 1,5 + 2 jam × 2* ends one (D173) — and the function
     that produces them was already being called for the total. */
  select coalesce(jsonb_agg(jsonb_build_object(
           'source', op.sheet_no, 'work_date', op.work_date, 'hours', op.hours,
           'multiplier', op.multiplier, 'hourly', op.hourly,
           'amount', op.amount, 'label', op.label)
           order by op.work_date, op.multiplier), '[]'::jsonb)
    into out_row.overtime_parts
    from ops_hr.overtime_parts(emp.id, p_from, p_to) op;

  out_row.undertime_hours := round(short, 2);
  out_row.undertime_amount := case
    when ut_mode = 'half_day_step' then round(half_days * (emp.base_rate / 2.0))
    when ut_mode = 'off' then 0
    else round(short * rate.hourly) end::bigint;

  /* What the hours would cost — *potongannya jam saja* (D251). Computed
     whatever the mode and **applied only when the mode says so**, so the rule
     book can price it before anybody switches it on and a payslip can show
     what is not being deducted rather than leaving the minutes looking free. */
  out_row.late_priced := round((out_row.late_minutes / 60.0) * rate.hourly)::bigint;
  out_row.late_deduction := case when coalesce(v_rules->>'late_mode','manual') = 'pro_rata'
                                 then out_row.late_priced else 0 end;

  select coalesce(sum(amount), 0) into out_row.adjustment_total
    from ops_hr.payroll_adjustments a
   where a.run_no = p_run_no and a.employee_id = emp.id
     and a.withdrawn_at is null;

  /* Each one named, with the sentence somebody typed beside it. A payslip that
     says *penyesuaian −150.000* and nothing else is the reason people come to
     the counter (D155).

     No `label`: there is no such column, and there should not be. The word for
     a `kind` is presentation and it already lives in `ADJUSTMENT_LABEL` on the
     client — storing it beside the kind would be the same string in two places
     with a migration needed to reword it. */
  select coalesce(jsonb_agg(jsonb_build_object(
           'kind', a.kind, 'amount', a.amount,
           'reason', coalesce(a.reason, '')) order by a.created_at), '[]'::jsonb)
    into out_row.adjustments
    from ops_hr.payroll_adjustments a
   where a.run_no = p_run_no and a.employee_id = emp.id
     and a.withdrawn_at is null;

  out_row.gross := out_row.base_pay + out_row.allowance_pay + out_row.overtime_pay
                 - out_row.undertime_amount - out_row.late_deduction;
  -- Gross plus everything moved by hand. **Not** what reaches a bank account:
  -- `0051` makes an employee's share of BPJS a deduction from it, and Q56 is
  -- that argument. `take_home` below is the figure that does.
  out_row.net := (out_row.gross + out_row.adjustment_total)::bigint;

  /* The statutory half, and only for schemes this person is actually enrolled
     in (D259). Nothing is invented: no enrolment row means no deduction, and
     PPh 21 is recorded rather than computed (D140, D277). Read per scheme
     because the rate table is monthly and `contribution_lines` is where that
     lives — restating its rule here to save a few rows would be the second
     copy this ladder keeps learning not to make. The label is left to the
     client: it is presentation, and `SCHEME_LABEL` already holds it. */
  select coalesce(jsonb_agg(jsonb_build_object(
           'scheme', cl.scheme, 'base', cl.base,
           'employee', cl.employee, 'employer', cl.employer)
           order by cl.scheme), '[]'::jsonb),
         coalesce(sum(cl.employee), 0)
    into out_row.contributions, out_row.contribution_total
    from (select distinct en.scheme from ops_hr.enrolments en
           where en.employee_id = emp.id) s
    cross join lateral ops_hr.contribution_lines(
      s.scheme, date_trunc('month', p_from)::date) cl
   where cl.employee_id = emp.id;

  out_row.take_home := out_row.net - out_row.contribution_total;

  -- The contract's spellings for two figures that already exist under another
  -- name. Assigned from the originals so the pair cannot drift.
  out_row.days_worked := out_row.worked_days;
  out_row.days_open   := out_row.open_days;

  /* The sentences a payslip needs, because a figure nobody can take apart is a
     figure somebody argues with at the counter. */
  if out_row.open_days > 0 then
    w := w || format('%s hari belum dibaca — belum bernilai sampai ada yang membacanya', out_row.open_days);
  end if;
  select coalesce(sum(c.hours), 0) into pending_ot from ops_hr.v_overtime_claim c
    join ops_hr.overtime_lines l on l.sheet_id = c.id
   where l.employee_id = emp.id and c.work_date between p_from and p_to
     and c.stage in ('waiting_hrd','waiting_surat','waiting_leader');
  -- Hours claimed and not yet signed for. It was already being counted for the
  -- warning below and thrown away; the contract has always asked for it,
  -- because *what is still coming* is a different question from *what this
  -- period pays* and a payslip is read by somebody who wants both.
  out_row.overtime_pending_hours := pending_ot;
  if pending_ot > 0 then
    w := w || format('%s jam lembur di lembar yang belum selesai ditandatangani — tidak masuk angka ini', pending_ot);
  end if;
  if shown_ot > out_row.overtime_hours + pending_ot then
    w := w || format('%s jam lewat jam kerja di mesin yang belum diklaim siapa pun',
                     round(shown_ot - out_row.overtime_hours - pending_ot, 1));
  end if;
  if no_letter > 0 then
    w := w || format('%s hari sakit tanpa surat dokter — tercatat, tidak dibayar. Suratnya membuatnya dibayar', no_letter);
  end if;
  if over_leave > 0 then
    w := w || format('%s hari cuti melewati jatah %s hari — tercatat, tidak dibayar', over_leave, emp.paid_leave_days);
  end if;
  if n_withheld > 0 and emp.allowance_rate > 0 then
    w := w || format('%s hari tanpa tunjangan — keputusan HRD, alasannya tercetak di slip', n_withheld);
  end if;
  if out_row.late_minutes > 0 and coalesce(v_rules->>'late_mode','manual') = 'manual' then
    w := w || format('%s menit terlambat di luar toleransi — belum dipotong; Rp %s kalau aturannya dinyalakan',
                     out_row.late_minutes, out_row.late_priced);
  end if;
  if emp.pay_basis <> 'monthly' and prem_days > 0 then
    w := w || format('%s hari Sabtu/Minggu/tanggal merah dibayar lebih dari sehari — tambahan %s hari upah (Rp %s)',
                     prem_days, prem_extra, round(prem_extra * case when emp.pay_basis = 'daily' then emp.base_rate else emp.base_rate * emp.daily_hours end));
  end if;
  if emp.pay_basis <> 'monthly' and out_row.worked_days = 0 then
    w := w || 'Tidak ada hari yang terhitung pada periode ini'::text;
  end if;
  out_row.warnings := w;

  return out_row;
end $$;


/* ── HRD sets a pattern's weekdays ────────────────────────────────────── */
--
-- `set_schedule_hours` (0186) for the seven days at once: the whole `days`
-- object is replaced, and an empty one removes it (every weekday back to the
-- pattern's own hours). Same refusals, same new dated version of the book,
-- same *a later version would undo it* conflict.
create or replace function ops_hr.set_schedule_days(
  p_code           text,
  p_days           jsonb,
  p_effective_from date,
  p_note           text,
  p_key            text default null)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare
  v_replayed jsonb; v_res jsonb; v_from date; v_base ops_hr.pay_rule_sets;
  v_later ops_hr.pay_rule_sets; v_old jsonb; v_rules jsonb; v_problem jsonb;
  v_spent text; v_clash text; v_version int; v_id uuid;
begin
  v_replayed := ops_core.idem_replay('hr','set_schedule_days', p_key);
  if v_replayed is not null then return v_replayed; end if;

  if not ops_core.has_permission('hrd.update') then
    return ops_core.refused('hr','schedule', p_code,'set_days',
      'not_permitted','Mengubah jam pola kerja butuh akses HRD.');
  end if;
  if coalesce(btrim(coalesce(p_note,'')), '') = '' then
    return ops_core.invalid('hr','schedule', p_code,'set_days',
      'note_required',
      'Tulis alasannya. Jam kerja yang berubah tanpa keterangan tidak bisa dijelaskan ke orang yang jamnya berubah.',
      jsonb_build_object('field','note'));
  end if;

  v_from := coalesce(p_effective_from, ops_core.office_day());

  select * into v_base from ops_hr.pay_rule_sets
   where effective_from <= v_from
   order by effective_from desc, version desc limit 1;
  if not found then
    return ops_core.conflict('hr','schedule', p_code,'set_days',
      'no_rule_book',
      format('Belum ada buku aturan gaji yang berlaku pada %s. IT menerbitkannya dulu.', v_from));
  end if;

  select * into v_later from ops_hr.pay_rule_sets
   where effective_from > v_from
   order by effective_from, version limit 1;
  if found then
    return ops_core.conflict('hr','schedule', p_code,'set_days',
      'later_version_exists',
      format('Versi %s berlaku mulai %s, sesudah tanggal ini, dan tidak memuat perubahan ini — '
             'jamnya akan kembali pada tanggal itu. Pilih tanggal mulai %s atau sesudahnya.',
             v_later.version, v_later.effective_from, v_later.effective_from));
  end if;

  select s.value into v_old
    from jsonb_array_elements(coalesce(v_base.rules -> 'schedules','[]'::jsonb)) s
   where s.value ->> 'code' = p_code;
  if v_old is null then
    return ops_core.not_found('hr','schedule', p_code,'set_days',
      format('Tidak ada jadwal kerja bernama %s di buku aturan yang berlaku.', p_code));
  end if;

  v_rules := jsonb_set(v_base.rules, '{schedules}', (
    select jsonb_agg(
             case when s.value ->> 'code' = p_code
               then case when p_days is null or p_days = '{}'::jsonb
                      then s.value - 'days'
                      else s.value || jsonb_build_object('days', p_days) end
               else s.value end
             order by s.ord)
      from jsonb_array_elements(v_base.rules -> 'schedules') with ordinality s(value, ord)));

  if v_rules = v_base.rules then
    return ops_core.noop('hr','schedule', p_code,'set_days',
      'Jadwal per harinya sudah itu.', jsonb_build_object('code', p_code, 'version', v_base.version));
  end if;

  v_problem := ops_hr.schedule_problem(v_rules);
  if v_problem is not null then
    return ops_core.invalid('hr','schedule', p_code,'set_days',
      v_problem ->> 'code', v_problem ->> 'message',
      jsonb_build_object('field','schedules'));
  end if;

  select run_no into v_spent from ops_hr.payroll_runs
   where status <> 'DRAFT' and period_end >= v_from
   order by period_start limit 1;
  if v_spent is not null then
    return ops_core.conflict('hr','schedule', p_code,'set_days',
      'already_paid',
      format('%s sudah ditandatangani untuk periode yang berakhir %s atau sesudahnya. '
             'Aturan tidak bisa mundur melewati uang yang sudah dibayarkan — '
             'terbitkan yang baru berlaku setelahnya.', v_spent, v_from));
  end if;

  select run_no into v_clash from ops_hr.payroll_runs
   where v_from > period_start and v_from <= period_end
   limit 1;
  if v_clash is not null then
    return ops_core.conflict('hr','schedule', p_code,'set_days',
      'inside_existing_run',
      format('%s mencakup tanggal itu, dan periode itu dihitung dengan aturan yang berlaku '
             'saat dibuka. Pilih tanggal di luar periode yang sudah ada.', v_clash));
  end if;

  select coalesce(max(version), 0) + 1 into v_version from ops_hr.pay_rule_sets;
  insert into ops_hr.pay_rule_sets (version, effective_from, note, rules, created_by)
  values (v_version, v_from, btrim(p_note), v_rules, auth.uid())
  returning id into v_id;

  v_res := ops_core.ok('hr','schedule', p_code,'set_days',
    jsonb_build_object('code', p_code, 'version', v_version, 'effective_from', v_from),
    jsonb_build_object('days', coalesce(v_old -> 'days', '{}'::jsonb)),
    jsonb_build_object('days', coalesce(p_days, '{}'::jsonb), 'version', v_version,
                       'effective_from', v_from));
  return ops_core.idem_remember('hr','set_schedule_days', p_key, v_res);
end $$;

revoke execute on function ops_hr.set_schedule_days(text, jsonb, date, text, text) from public;
grant execute on function ops_hr.set_schedule_days(text, jsonb, date, text, text) to authenticated;

/* ── the week and the month — restated from 0186, with the weekdays ───── */
create or replace function ops_hr.schedule_roll()
returns jsonb
language sql stable set search_path = ops_hr, pg_temp as $$
  with rules as (select ops_hr.rules_on(ops_core.office_day()) as r),
  days as (
    select case when (select r ->> 'week_pattern' from rules) = '5day' then 5 else 6 end as n
  ),
  sc as (
    select s.value as j, s.value ->> 'code' as code
      from rules, jsonb_array_elements(coalesce(rules.r -> 'schedules','[]'::jsonb)) s
  ),
  people as (
    select e.employee_no, e.full_name, e.unit, e.schedule_code,
           -- The pattern actually in force: what HR linked, else what the unit
           -- defaults to, else nothing at all.
           coalesce(e.schedule_code,
                    (select r -> 'schedule_by_unit' ->> e.unit from rules)) as effective
      from ops_hr.employees e where e.active
  ),
  hours as (
    select sc.code, sc.j,
      (sc.j ->> 'start_minutes')::int         as st,
      (sc.j ->> 'end_minutes')::int           as en,
      (sc.j ->> 'break_minutes')::int         as br,
      (sc.j ->> 'friday_break_minutes')::int  as fbr,
      (sc.j ->> 'friday_end_minutes')::int    as fen
    from sc
  ),
  figured as (
    select h.code, h.j,
      case when h.st is null or h.en is null or h.br is null then null
           else round((ops_hr.shift_minutes(h.st, h.en) - h.br) / 60.0, 2) end as daily,
      -- Friday differs if either field says so, and each missing half falls
      -- back to the ordinary day rather than to nothing.
      case when h.st is null or h.en is null or h.br is null then null
           when h.fbr is null and h.fen is null then null
           else round((ops_hr.shift_minutes(h.st, coalesce(h.fen, h.en)) - coalesce(h.fbr, h.br)) / 60.0, 2)
      end as friday,
      -- What is stopping the figures, in words. A schedule nobody has finished
      -- describing is not a schedule of zero hours.
      nullif(concat_ws(', ',
        case when h.st  is null then 'jam masuk' end,
        case when h.en  is null then 'jam pulang' end,
        case when h.br  is null then 'istirahat' end), '') as missing
    from hours h
  )
  select jsonb_build_object(
    'week_pattern', (select r ->> 'week_pattern' from rules),
    'schedules', coalesce((
      select jsonb_agg(jsonb_build_object(
        'code', f.code,
        'name', f.j ->> 'name',
        'start_minutes', (f.j ->> 'start_minutes')::int,
        'end_minutes', (f.j ->> 'end_minutes')::int,
        'break_minutes', (f.j ->> 'break_minutes')::int,
        'friday_break_minutes', (f.j ->> 'friday_break_minutes')::int,
        'friday_end_minutes', (f.j ->> 'friday_end_minutes')::int,
        'note', f.j ->> 'note',
        'hours_unconfirmed', coalesce((f.j ->> 'hours_unconfirmed')::boolean, false),
        'overnight', ops_hr.is_overnight(f.j),
        'day_boundary_minutes', ops_hr.day_boundary_minutes(f.j),
        -- 0195 (D340): the pattern's own weekdays, and the seven days as the
        -- reading will see them — each weekday's hours and what it is worth.
        'days', coalesce(f.j -> 'days', '{}'::jsonb),
        'week', (select jsonb_agg(jsonb_build_object(
                   'isodow', g.d,
                   'start_minutes', ops_hr.minutes_of(x.sd -> 'start_minutes'),
                   'end_minutes', ops_hr.minutes_of(x.sd -> 'end_minutes'),
                   'break_minutes', ops_hr.minutes_of(x.sd -> 'break_minutes'),
                   'pay_multiplier', coalesce((x.sd ->> 'pay_multiplier')::numeric, 1),
                   'off', coalesce((x.sd ->> 'off')::boolean, false),
                   'own', (f.j -> 'days') ? g.d::text,
                   'hours', case when coalesce((x.sd ->> 'off')::boolean, false)
                                   or ops_hr.minutes_of(x.sd -> 'start_minutes') is null
                                   or ops_hr.minutes_of(x.sd -> 'end_minutes') is null then null
                              else round((ops_hr.shift_minutes(ops_hr.minutes_of(x.sd -> 'start_minutes'),
                                                               ops_hr.minutes_of(x.sd -> 'end_minutes'))
                                          - coalesce(ops_hr.minutes_of(x.sd -> 'break_minutes'), 0)) / 60.0, 2) end)
                   order by g.d)
                   from generate_series(1, 7) g(d)
                   -- 2026-09-07 is a Monday: g.d days after the Sunday before.
                   cross join lateral (select ops_hr.schedule_day(f.j, date '2026-09-06' + g.d) as sd) x),
        'hours', jsonb_build_object(
          'daily_hours', f.daily,
          'friday_hours', f.friday,
          'days_per_week', (select n from days),
          'weekly_hours', case when f.daily is null then null
            when f.friday is null then round(f.daily * (select n from days), 2)
            else round(f.daily * ((select n from days) - 1) + f.friday, 2) end,
          'monthly_hours', case when f.daily is null then null
            else round((case when f.friday is null then f.daily * (select n from days)
                             else f.daily * ((select n from days) - 1) + f.friday end)
                       * 52 / 12.0, 2) end,
          'blocked_by', case when f.missing is null then null
                             else 'Belum ada ' || f.missing || ' — jamnya belum bisa dihitung.' end),
        -- Linked **by name**, which is a decision somebody took.
        'assigned', (select count(*) from people p where p.schedule_code = f.code),
        -- On it by assumption only.
        'inherited', (select count(*) from people p
                       where p.schedule_code is null and p.effective = f.code),
        'units', coalesce((select jsonb_agg(u.key order by u.key)
                             from rules, jsonb_each_text(coalesce(rules.r -> 'schedule_by_unit','{}'::jsonb)) u
                            where u.value = f.code), '[]'::jsonb)))
      from figured f), '[]'::jsonb),
    'unlinked', coalesce((
      select jsonb_agg(jsonb_build_object('employee_no', p.employee_no,
                                          'full_name', p.full_name, 'unit', p.unit)
                       order by p.employee_no)
        from people p where p.effective is null), '[]'::jsonb),
    'inherited', coalesce((
      select jsonb_agg(jsonb_build_object('employee_no', p.employee_no,
                                          'full_name', p.full_name, 'unit', p.unit,
                                          'schedule_code', p.effective)
                       order by p.employee_no)
        from people p where p.schedule_code is null and p.effective is not null), '[]'::jsonb))
$$;
