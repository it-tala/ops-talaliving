-- 0049_hr_holiday_rule.sql — the owner's answer to F101.
--
-- F101 asked which mark decides a day when somebody is marked *sakit* on a day
-- the whole office is shut. 0045 shipped with my own reading — the personal
-- mark wins, specific over general — and said in the finding that it was my
-- decision and not the design's.
--
-- The owner answered on 2026-09-18, and the other way: *seseorang ditandai
-- sakit pada hari kantor tutup maka tidak perlu dihitung absen ataupun ijin.
-- karena kantor tutup, artinya kita tidak membayar siapapun, di luar jadwal
-- kerja.*
--
-- **A closed day is closed for everybody.** That is one line in an ORDER BY
-- and three consequences that are not:
--
--   1. the office-wide mark wins, so the day is worth nothing to anybody
--   2. a *cuti* mark on a closed day takes nothing from that person's
--      entitlement — the day was never theirs to spend
--   3. a *sakit* mark on a closed day needs no surat dokter, because it is not
--      being paid and not being counted either
--
-- (2) is the one that would have been missed by reading the sentence and
-- changing the sort. An entitlement silently spent on a day nobody worked is a
-- paid day the person loses later in the year, and the loss is invisible:
-- every figure on the screen still adds up.
--
-- A correcting migration rather than an edit to 0045, because the ladder is
-- the record. 0045 is what the system did before somebody asked; this is what
-- it does after, and the two are worth being able to tell apart.

-- Is the office shut on this date? An office-wide mark is a holiday or nothing
-- (`office_wide_is_holiday` in 0041), so this is the whole of the question.
create or replace function ops_hr.office_closed(p_date date)
returns boolean
language sql stable set search_path = ops_hr, pg_temp as $$
  select exists (
    select 1 from ops_hr.day_marks
     where work_date = p_date and employee_id is null and kind = 'holiday'
  )
$$;

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
   order by (m.employee_id is null) desc
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

-- ── the two views that count an entitlement ───────────────────────────────
--
-- Both are from 0042 and both counted every `leave` mark. Under the ruling a
-- day the office was shut was never that person's to spend, so it does not
-- come off their days — and the *nth* day of the entitlement is counted the
-- same way, or the cap would be spent by days that cost nothing.

create or replace view ops_hr.v_leave_used as
select
  m.employee_id,
  e.employee_no,
  e.full_name,
  extract(year from m.work_date)::int              as year,
  count(*)::int                                    as leave_days_taken,
  e.paid_leave_days                                as entitlement,
  least(count(*), e.paid_leave_days)::int          as leave_days_paid,
  greatest(e.paid_leave_days - count(*), 0)::int   as leave_days_left
from ops_hr.day_marks m
join ops_hr.employees e on e.id = m.employee_id
where m.kind = 'leave'
  and not ops_hr.office_closed(m.work_date)
group by m.employee_id, e.employee_no, e.full_name,
         extract(year from m.work_date), e.paid_leave_days;

create or replace view ops_hr.v_day_mark_value as
with leave_nth as (
  select id,
         row_number() over (
           partition by employee_id, extract(year from work_date)
           order by work_date, mark_no
         ) as nth
  from ops_hr.day_marks
  where kind = 'leave' and employee_id is not null
    and not ops_hr.office_closed(work_date)
),
sick_letter as (
  select distinct entity_no
  from ops_core.attachment_links
  where entity = 'day_mark' and kind = 'surat_dokter' and unlinked_at is null
)
select
  m.id,
  m.mark_no,
  m.employee_id,
  m.work_date,
  m.kind,
  m.reason,
  case
    -- The office was shut. Nobody is paid for it and nobody spends anything on
    -- it, whatever their own mark says (F101, owner 2026-09-18).
    when m.employee_id is not null and ops_hr.office_closed(m.work_date) then 0
    when m.kind = 'half_day' then 0.5
    when m.kind = 'sick'     then case when sl.entity_no is not null then 1 else 0 end
    when m.kind = 'leave'    then case when ln.nth <= e.paid_leave_days then 1 else 0 end
    else 0
  end::numeric as day_value,
  case
    when m.employee_id is not null and ops_hr.office_closed(m.work_date)
      then 'kantor tutup — tidak dihitung dan tidak memotong jatah'
    when m.kind = 'half_day' then 'setengah hari'
    when m.kind = 'sick'     then case when sl.entity_no is not null
                                   then 'sakit, surat dokter ada'
                                   else 'sakit, surat dokter belum ada' end
    when m.kind = 'leave'    then case when ln.nth <= e.paid_leave_days
                                   then 'cuti, hari ke-' || ln.nth || ' dari ' || e.paid_leave_days
                                   else 'cuti, melewati jatah ' || e.paid_leave_days || ' hari' end
    when m.kind = 'holiday'  then 'tanggal merah'
    when m.kind = 'permit'   then 'izin, tidak dibayar'
    when m.kind = 'absent'   then 'alpa'
  end as why
from ops_hr.day_marks m
left join ops_hr.employees e on e.id = m.employee_id
left join leave_nth   ln on ln.id = m.id
left join sick_letter sl on sl.entity_no = m.mark_no;

alter view ops_hr.v_leave_used      set (security_invoker = on);
alter view ops_hr.v_day_mark_value  set (security_invoker = on);
