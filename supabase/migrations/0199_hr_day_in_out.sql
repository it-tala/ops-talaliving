-- 0199 — tap datang dan pulang saja; jam sesuai jadwal; kurang = merah (D353).
--
-- Owner, looking at the week's attendance full of amber *1 tap / 3 tap* cells
-- and hours like 8,89 on an 8,25-hour schedule:
--
--   *Sederhanakan pekerjaan HR — tap wajib hanya di jam datang dan pulang.
--    Jam otomatis sesuai kuota — misal di jadwal 8,25 maka dihitung segitu.
--    Merah jika kurang.*
--
-- A third way to read a day, `day_reading: "in_out"`, beside `slots` (0186)
-- and `schedule` (0195). It is `schedule`'s reading with pulang made strict:
--
--   masuk   the first tap;
--   pulang  the **last** tap. Only one tap is a day with no pulang, and that
--           day waits for HRD (*Tidak ada tap pulang — tap datang dan pulang
--           wajib*). Break taps are neither needed nor counted: the pattern's
--           break is deducted whether or not anybody tapped for it;
--   hours   min(pulang, jadwal pulang) − max(masuk, jadwal masuk) − istirahat,
--           rounded to `hours_rounding_minutes` (15). On time both ends is
--           the schedule's hours exactly, 8,25 on an 8,25 day, and never
--           more; arriving late or leaving early is less, and the reading says
--           by how much (*Kurang 0,5 jam dari jadwal 8,25 jam*). The screen
--           draws that day red;
--   lembur  pulang past the scheduled end, shown and never paid from here —
--           only an approved overtime sheet pays (D138).
--
-- `schedule` keeps 0195's reading exactly: a pulang near the end or the end
-- itself, which is what the September sheets were matched with (D340). Night
-- shifts keep the slot reading in both. Nothing changes until a rule-book
-- version says `in_out`.

/* ── one day, read — restated from 0195, with the in-and-out reading ── */
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
  if n_taps > 0 and v_mode in ('schedule', 'in_out') and not v_night then
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
      if v_mode = 'in_out' then
        /* 0199 (D353): *tap wajib hanya di jam datang dan pulang*. Pulang is
           the last tap, whenever it is — leaving early is a short day, not a
           missing tap — and a day with only one tap has no pulang. */
        v_out := v_last;
      else
        select t into pick from unnest(kept[2:]) t
          where abs(extract(epoch from t - v_end_at)) <= v_win * 60
          order by abs(extract(epoch from t - v_end_at)), t limit 1;
        if pick is not null then v_out := pick; pick := null; end if;
      end if;
      v_hours_to := coalesce(v_out, v_end_at);
      v_work := greatest(extract(epoch from least(v_hours_to, v_end_at)
                                 - greatest(v_in, v_start_at)) / 60 - b_min, 0);
      v_work := case when v_roundm > 0 then round(v_work / v_roundm) * v_roundm else v_work end / 60.0;
      if v_mode = 'in_out' then
        /* Past the scheduled end is shown as lembur and never paid from here
           (D138); the day itself is the schedule's hours at most. */
        if v_out is not null and v_out > v_end_at then
          v_ots := v_end_at; v_ote := v_out;
          v_ot  := extract(epoch from v_out - v_end_at) / 60;
          v_ot  := case when v_roundm > 0 then round(v_ot / v_roundm) * v_roundm else v_ot end / 60.0;
        end if;
      elsif v_last is not null and v_last > v_hours_to then
        v_ots := v_hours_to; v_ote := v_last;
        v_ot  := extract(epoch from v_last - v_hours_to) / 60;
        v_ot  := case when v_roundm > 0 then round(v_ot / v_roundm) * v_roundm else v_ot end / 60.0;
      end if;
      if v_out is null and v_mode = 'in_out' then
        v_issues := v_issues || 'Tidak ada tap pulang — tap datang dan pulang wajib'::text;
      elsif v_out is null then
        v_notes := v_notes || format('Tidak ada tap pulang dekat %s — jam pulang dibaca sesuai jadwal',
                                     ops_hr.clock_face(e_min));
      elsif v_mode = 'in_out'
            and v_work < (case when v_roundm > 0 then round(v_sched * 60 / v_roundm) * v_roundm / 60.0
                               else v_sched end) then
        /* Short of the schedule (compared rounded as the hours are, so a
           7,33-hour day read on time is not short by its own rounding): what
           the screen draws red (D353). */
        v_notes := v_notes || format('Kurang %s jam dari jadwal %s jam',
                                     round(v_sched - v_work, 2), round(v_sched, 2));
      end if;
    else
      /* A weekday the pattern has no hours for, or nobody on a pattern: the
         hours are what the taps span, less the break, rounded the same way. */
      v_out  := v_last;
      v_work := greatest(extract(epoch from coalesce(v_last, v_in) - v_in) / 60 - b_min, 0);
      v_work := case when v_roundm > 0 then round(v_work / v_roundm) * v_roundm else v_work end / 60.0;
      if v_mode = 'in_out' and v_out is null then
        v_issues := v_issues || 'Tidak ada tap pulang — tap datang dan pulang wajib'::text;
      end if;
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
