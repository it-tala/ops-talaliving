-- 0215 — a monthly allowance is a month (D378).
--
-- ── the owner's ask (2026-10-06) ──────────────────────────────────────────
--
--   *HR saya upload gaji dan allowance, tapi salah. allowance yang diminta per
--   hari yang di input per bulan. ini kesalahan rancangan desain. harusnya
--   setiap onboarding baru, ada keterangan gaji pokok berapa dan allowance
--   berapa tiap bulannya. baru setelah input keluar perhitungan allowance per
--   hari, gaji per jam.*
--
-- Since D250 `employees.allowance_rate` was a figure **per day present** for
-- everybody, whatever the pokok was quoted in. HR is handed a salary as
-- *pokok + tunjangan per bulan* (ADZKIA 3.150.000 + 1.350.000 = 4.500.000)
-- and typed it that way into a field that multiplied it by every working day.
-- The form was wrong, not HR.
--
-- From here `allowance_rate` is quoted **in the same unit as the pay**, as
-- `base_rate` always was: a month for a salary, a day for a day wage — and a
-- day for an hour wage, whose allowance is still for coming in. Everything
-- else is derived, never typed:
--
--   * a day of a monthly allowance = the month's allowance ÷ that month's
--     working days for this person (`month_workdays`, the same days the
--     salary is prorated over, 0212), paid per day present as before;
--     a whole month with nothing marked pays exactly the month's allowance;
--   * the hour (`hourly_rate`) takes the allowance as a month for a salary:
--     (pokok + tunjangan) × 12 ÷ days a year ÷ hours a day, or ÷ 173;
--   * BPJS's base (`contribution_base`) is pokok + tunjangan for a salary;
--   * the withheld-allowance list prices a day the same way;
--   * the contract check reads *tunjangan … / month* for a salary;
--   * each payroll line carries `allowance_daily`;
--   * `pay_preview` gives the employee form the derived figures before
--     anything is saved.
--
-- No data is converted here: the two salaries that still carried a per-day
-- figure in production (5.000) are restated by hand, with the decision
-- (D378). No DROP, so it applies through the tool (F220).

/* ── a month's working days, for one person ─────────────────────────────── */
create or replace function ops_hr.month_workdays(p_rules jsonb, p_sc jsonb, p_date date)
returns int
language sql stable set search_path = ops_hr, pg_temp as $$
  select count(*)::int
    from generate_series(date_trunc('month', p_date)::date,
                         (date_trunc('month', p_date) + interval '1 month - 1 day')::date,
                         interval '1 day') g
   where ops_hr.is_workday_for(p_rules, p_sc, g::date)
$$;
grant execute on function ops_hr.month_workdays(jsonb, jsonb, date) to authenticated;

/* ── a day of somebody's allowance, on a date ─────────────────────────────

   Definer, because it reads the rule book for the date; it says nothing about
   a person the caller did not already pass in. */
create or replace function ops_hr.allowance_day(p_employee ops_hr.employees, p_date date)
returns bigint
language plpgsql stable security definer set search_path = ops_hr, pg_temp as $$
declare v_rules jsonb; v_n int;
begin
  if p_employee.pay_basis <> 'monthly' then return p_employee.allowance_rate; end if;
  v_rules := ops_hr.rules_on(p_date);
  v_n := ops_hr.month_workdays(v_rules,
           ops_hr.schedule_of(v_rules, p_employee.schedule_code, p_employee.unit), p_date);
  return case when v_n > 0 then round(p_employee.allowance_rate::numeric / v_n) else 0 end;
end $$;
revoke execute on function ops_hr.allowance_day(ops_hr.employees, date) from public;
grant execute on function ops_hr.allowance_day(ops_hr.employees, date) to authenticated;

/* ── an hour of somebody's time — restated from 0050 ──────────────────────

   One change: for a salary the allowance is a month, so it enters the year
   twelve times and the statutory month as itself. A day wage's allowance is
   still a day. */
create or replace function ops_hr.hourly_rate(p_employee ops_hr.employees, p_rules jsonb)
returns ops_hr.hourly_rate_t
language sql stable set search_path = ops_hr, pg_temp as $$
  with r as (
    select
      greatest(coalesce((p_rules->>'effective_days_per_year')::numeric, 300), 1) as days,
      greatest(p_employee.daily_hours, 1)                                         as hpd,
      coalesce((p_rules->>'hourly_includes_allowance')::boolean, true)            as with_allow,
      greatest(coalesce((p_rules->>'monthly_divisor')::numeric, 173), 1)          as divisor,
      coalesce(p_rules->>'hourly_basis', 'company')                               as basis
  ),
  a as (
    -- In the pay's own unit (D378): a month for a salary, a day otherwise.
    select r.*,
      case when r.with_allow then p_employee.allowance_rate else 0 end as allow
    from r
  ),
  y as (
    select a.*,
      case p_employee.pay_basis
        when 'monthly' then (p_employee.base_rate + a.allow) * 12
        when 'daily'   then (p_employee.base_rate + a.allow) * a.days
        else                p_employee.base_rate * a.hpd * a.days + a.allow * a.days
      end as annual
    from a
  ),
  c as (
    select y.*, round(y.annual / y.days / y.hpd) as company from y
  ),
  s as (
    select c.*,
      case when p_employee.pay_basis = 'monthly'
        then round((p_employee.base_rate + c.allow) / c.divisor)
        else c.company
      end as statutory
    from c
  )
  select (
    (case when basis = 'statutory' then statutory else company end)::bigint,
    basis, company::bigint, statutory::bigint, round(annual)::bigint, with_allow
  )::ops_hr.hourly_rate_t
  from s
$$;

/* ── what a contribution is computed on — restated from 0051 ──────────── */
create or replace function ops_hr.contribution_base(p_employee ops_hr.employees, p_month date)
returns bigint
language sql stable set search_path = ops_hr, pg_temp as $$
  select round(
    case p_employee.pay_basis
      -- Pokok + tunjangan, both a month (D378).
      when 'monthly' then p_employee.base_rate + p_employee.allowance_rate
      when 'daily'   then (p_employee.base_rate + p_employee.allowance_rate) * d
      else                p_employee.base_rate * p_employee.daily_hours * d + p_employee.allowance_rate * d
    end)::bigint
  from (
    select greatest(coalesce(
      (ops_hr.rules_on(date_trunc('month', p_month)::date)->>'effective_days_per_year')::numeric, 300), 1) / 12 as d
  ) r
$$;

/* ── what a line carries now ─────────────────────────────────────────── */
alter type ops_hr.payroll_figures
  add attribute allowance_daily bigint cascade;

/* ── one person's line — restated from 0213 ──────────────────────────────

   Three changes, each marked 0215: a monthly person is present on the days
   their pattern works (`is_workday_for`, as their salary is), each present
   day earns its own share of the allowance, and the line says what a day of
   the allowance is. Everything else is 0213's, word for word. */
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
  allow_units numeric := 0;
  allow_byval boolean;
  -- 0202 (D357)
  v_proj     boolean;
  v_ot_from  date;
  v_ot_to    date;
  v_assumed  boolean;
  n_assumed  int := 0;
  -- 0212 (D370)
  v_run      ops_hr.payroll_runs%rowtype;
  c_run      jsonb := '{}'::jsonb;
  c_person   jsonb := '{}'::jsonb;
  v_pnote    text;
  v_unpaid   date[] := '{}';
  v_employed boolean;
  v_mb       jsonb;
  v_off      jsonb := '[]'::jsonb;
  v_cut      bigint;
  v_k        text;
  -- 0213 (D373)
  v_late_day int;
  v_mb_full  jsonb;
  v_adj_pos  numeric := 0;
  v_adj_neg  numeric := 0;
  -- 0215 (D378)
  v_aday         numeric := 0;
  v_amonth       date;
  v_amonth_days  int := 0;
  v_allow_amt    numeric := 0;
  v_withheld_amt numeric := 0;
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
  -- 0195: a half day earns half the allowance, as the sheet pays it
  -- (`insentif × SUM(Senin..Jumat)`), rather than a whole one (D272).
  allow_byval := coalesce((v_rules->>'allowance_by_day_value')::boolean, false);
  /* 0202 (D357): the pay week is approved on its last day, before that day is
     over. For somebody paid by the day or hour, that last day counts as the
     schedule says it should — a full day — and the overtime this line pays is
     the week moved back by one day, so the last day's overtime is paid with
     the week after. A monthly salary is a month and is not projected. */
  v_proj    := emp.pay_basis <> 'monthly' and ops_hr.pay_week_projected(v_rules, p_from, p_to);
  v_ot_from := case when v_proj then p_from - 1 else p_from end;
  v_ot_to   := case when v_proj then p_to - 1 else p_to end;

  /* 0212 (D370): the run's switches, and this person's own over them. A run
     nobody opened has none, and every component is paid. */
  if p_run_no is not null then
    select * into v_run from ops_hr.payroll_runs where run_no = p_run_no;
    if found then
      c_run := coalesce(v_run.components, '{}'::jsonb);
      select m.components, m.note into c_person, v_pnote
        from ops_hr.payroll_run_members m
       where m.run_no = p_run_no and m.employee_id = emp.id;
      c_person := coalesce(c_person, '{}'::jsonb);
    end if;
  end if;

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
    v_late_day := 0;
    /* 0202 (D357): the last day of a projected week, unless HRD marked it, is
       the full day the schedule says — whatever the machine has so far. Its
       taps and its overtime are left for the week after. */
    v_assumed := v_proj and d.work_date = p_to and d.mark_kind is null
                 and d.scheduled_hours is not null
                 -- Never a day somebody was not employed on.
                 and (emp.left_on is null or emp.left_on >= p_to)
                 and (emp.joined_on is null or emp.joined_on <= p_to);
    if v_assumed then
      d.state := 'complete'; d.day_value := 1;
      d.work_hours := round(d.scheduled_hours, 2);
      d.overtime_hours := 0; d.in_at := null; d.out_at := null;
      n_assumed := n_assumed + 1;
    end if;
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
      'assumed', v_assumed,
      'shift', d.shift_code,
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
        -- 0212: what a salary loses — alpa, izin, sakit tanpa surat, cuti di
        -- luar jatah. A half day is not on the list (Q63).
        v_unpaid := v_unpaid || d.work_date;
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
      /* 0215 (D378): a day the person's pattern works — the same days the
         monthly allowance is divided by, so a month with nothing marked pays
         exactly the month's allowance. */
      is_present := case when d.mark_kind is not null then d.mark_kind = 'half_day'
                         else ops_hr.is_workday_for(v_rules, sc, d.work_date) end;
      /* 0212: never a day before somebody started or after they left — the
         business working that day is not this person coming in. */
      v_employed := (emp.joined_on is null or d.work_date >= emp.joined_on)
                and (emp.left_on is null or d.work_date <= emp.left_on);
      if not v_employed then is_present := false; end if;
    else
      is_present := case when d.mark_kind is not null then d.mark_kind = 'half_day'
                         else d.day_value > 0 end;
      if not allow_prem and coalesce(d.pay_multiplier, 1) > 1 then is_present := false; end if;
    end if;

    if is_present then
      /* 0215 (D378): what this day's allowance is worth. A monthly allowance
         is a month, divided by that month's working days for this person; a
         day wage's allowance is already a day. Kept unrounded and rounded
         once, so 22 days of 1.350.000 ÷ 22 is 1.350.000, not 1.349.998. */
      if emp.pay_basis = 'monthly' then
        if v_amonth is distinct from date_trunc('month', d.work_date)::date then
          v_amonth := date_trunc('month', d.work_date)::date;
          v_amonth_days := ops_hr.month_workdays(v_rules, sc, d.work_date);
        end if;
        v_aday := case when v_amonth_days > 0
                       then emp.allowance_rate::numeric / v_amonth_days else 0 end;
      else
        v_aday := emp.allowance_rate;
      end if;
      select exists (
        select 1 from ops_hr.allowance_withholdings aw
         where aw.employee_id = emp.id and aw.work_date = d.work_date
           and aw.restored_by is null
      ) into withheld;
      if withheld then
        n_withheld := n_withheld + 1;
        v_withheld_amt := v_withheld_amt + v_aday;
      else
        n_present := n_present + 1;
        allow_units := allow_units + case when d.day_value > 0 then d.day_value else 1 end;
        v_allow_amt := v_allow_amt + v_aday * case when allow_byval and d.day_value > 0
                                                   then d.day_value else 1 end;
      end if;
    end if;

    /* Minutes late past the grace the owner set (Q41, D251). Nobody has said
       when this person's day starts, so nothing about it is late — not zero
       because they were punctual, zero because there is no threshold, and
       inventing one puts minutes on a payslip (D274). */
    /* 0195: late against **this weekday's** start — Saturday begins at 08.00
       where Monday begins at 07.30. */
    /* 0206 (D364): somebody on shifts is late against the shift they worked —
       17.00 for Shift 2, not the pattern's 07.00. */
    v_dstart := null;
    if d.shift_code is not null then
      select ops_hr.minutes_of(x -> 'start_minutes') into v_dstart
        from jsonb_array_elements(ops_hr.pattern_on(emp.schedule_code, emp.unit, d.work_date) -> 'shifts') x
       where x ->> 'code' = d.shift_code limit 1;
    end if;
    v_dstart := coalesce(v_dstart,
                         ops_hr.minutes_of(ops_hr.schedule_day(sc, d.work_date) -> 'start_minutes'), day_start);
    if d.in_at is not null and d.mark_kind is null and v_dstart is not null then
      late_one := greatest(ops_hr.late_minutes(d.in_at, d.work_date, v_dstart, grace), 0);
      out_row.late_minutes := out_row.late_minutes + late_one;
      v_late_day := late_one;
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

    /* 0213 (D373): the day's lateness on the day's own line, so the sheet can
       show duration, lateness and overtime side by side. */
    v_days := jsonb_set(v_days, array[(jsonb_array_length(v_days) - 1)::text, 'late_minutes'],
                        to_jsonb(v_late_day));
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
  /* 0212 (D370): a salary is the month only when the month was worked. The
     share of each month's working days the period covers, inside employment,
     less the days HRD marked unpaid — unless the run or the person has the
     `absence` switch off. */
  out_row.base_pay := case emp.pay_basis
    when 'monthly' then emp.base_rate
    when 'daily'   then round(paid_units * emp.base_rate)
    else                round(paid_hours * emp.base_rate)
  end::bigint;
  out_row.base_full := out_row.base_pay;
  out_row.proration := '[]'::jsonb;
  if emp.pay_basis = 'monthly' then
    v_mb := ops_hr.monthly_base(emp.base_rate, v_rules, sc, emp.joined_on, emp.left_on,
              p_from, p_to, v_unpaid,
              coalesce((c_person ->> 'absence')::boolean, (c_run ->> 'absence')::boolean, true));
    out_row.base_pay  := (v_mb ->> 'amount')::bigint;
    out_row.proration := v_mb -> 'months';
    /* 0213 (D373): what the alpa took, apart from what the calendar did —
       the salary with nothing marked, less the salary as paid. Zero when the
       `absence` switch is off, because then nothing was taken. */
    v_mb_full := ops_hr.monthly_base(emp.base_rate, v_rules, sc, emp.joined_on, emp.left_on,
                   p_from, p_to, v_unpaid, false);
    out_row.absence_deduction := (v_mb_full ->> 'amount')::bigint - (v_mb ->> 'amount')::bigint;
  else
    out_row.absence_deduction := 0;
  end if;

  /* 0213 (D373): a day of this person's pay — the salary over the first
     month's working days, the day wage, or the hour wage over a contracted
     day. The hour beside it is `hourly`, the one overtime is priced at. */
  out_row.daily_rate := case emp.pay_basis
    when 'monthly' then case when coalesce((v_mb -> 'months' -> 0 ->> 'workdays')::int, 0) > 0
                             then round(emp.base_rate / (v_mb -> 'months' -> 0 ->> 'workdays')::numeric)
                        end
    when 'daily'   then emp.base_rate
    else                round(emp.base_rate * coalesce(emp.daily_hours, 0))
  end::bigint;

  out_row.allowance_days := n_present;
  out_row.allowance_withheld_days := n_withheld;
  /* 0215 (D378): the sum of each day's worth, above — for a day wage the
     same figure as before, for a salary the month's allowance shared over its
     working days. */
  out_row.allowance_pay := round(v_allow_amt)::bigint;
  -- What the withheld days would have paid, and **who decided each one**. A
  -- deduction with no name against it is the kind a payslip cannot defend.
  out_row.allowance_withheld_amount := round(v_withheld_amt)::bigint;
  /* 0215 (D378): a day of the allowance, beside a day of the pay — for a
     salary, the allowance over the first month's working days. */
  out_row.allowance_daily := case
    when emp.pay_basis <> 'monthly' then emp.allowance_rate
    when coalesce((v_mb -> 'months' -> 0 ->> 'workdays')::int, 0) > 0
      then round(emp.allowance_rate / (v_mb -> 'months' -> 0 ->> 'workdays')::numeric)
  end::bigint;
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
    from ops_hr.overtime_parts(emp.id, v_ot_from, v_ot_to);

  /* The rungs, not just the total. *3 jam lembur = Rp 91.000* invites an
     argument; *jam ke-1 × 1,5 + 2 jam × 2* ends one (D173) — and the function
     that produces them was already being called for the total. */
  select coalesce(jsonb_agg(jsonb_build_object(
           'source', op.sheet_no, 'work_date', op.work_date, 'hours', op.hours,
           'multiplier', op.multiplier, 'hourly', op.hourly,
           'amount', op.amount, 'label', op.label)
           order by op.work_date, op.multiplier), '[]'::jsonb)
    into out_row.overtime_parts
    from ops_hr.overtime_parts(emp.id, v_ot_from, v_ot_to) op;

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

  /* 0212 (D370): the switches. Each component that is off is zero on this
     line, and listed with what it would have been and whose decision it was —
     the person's own switch over the run's. */
  foreach v_k in array ops_hr.pay_components() loop
    if coalesce((c_person ->> v_k)::boolean, (c_run ->> v_k)::boolean, true) then
      continue;
    end if;
    v_cut := case v_k
      when 'base'      then out_row.base_pay
      when 'allowance' then out_row.allowance_pay
      when 'overtime'  then out_row.overtime_pay
      when 'late'      then out_row.late_deduction
      when 'undertime' then out_row.undertime_amount
      else 0 end;
    case v_k
      when 'base'      then out_row.base_pay := 0;
      when 'allowance' then out_row.allowance_pay := 0;
      when 'overtime'  then out_row.overtime_pay := 0;
      when 'late'      then out_row.late_deduction := 0;
      when 'undertime' then out_row.undertime_amount := 0;
      else null;
    end case;
    -- `absence` and `contributions` are priced where they are applied. For
    -- the three deductions the amount is the deduction *not* taken.
    if v_k = 'absence' then
      v_cut := case when emp.pay_basis = 'monthly'
        -- The deduction not taken: the salary without it, less with it.
        then (v_mb ->> 'amount')::bigint
             - (ops_hr.monthly_base(emp.base_rate, v_rules, sc,
                  emp.joined_on, emp.left_on, p_from, p_to, v_unpaid, true) ->> 'amount')::bigint
        else 0 end;
    end if;
    v_off := v_off || jsonb_build_object(
      'component', v_k,
      'amount', coalesce(v_cut, 0),
      'scope', case when (c_person ->> v_k) is not null then 'person' else 'run' end,
      'reason', coalesce(case when (c_person ->> v_k) is not null then v_pnote
                              else v_run.components_note end, ''));
  end loop;

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

  if not coalesce((c_person ->> 'contributions')::boolean, (c_run ->> 'contributions')::boolean, true) then
    v_off := (select coalesce(jsonb_agg(case when x ->> 'component' = 'contributions'
                                         then x || jsonb_build_object('amount', out_row.contribution_total)
                                         else x end), '[]'::jsonb)
                from jsonb_array_elements(v_off) x);
    out_row.contributions := '[]'::jsonb;
    out_row.contribution_total := 0;
  end if;
  out_row.components_off := v_off;

  out_row.take_home := out_row.net - out_row.contribution_total;

  /* 0213 (D373): the two columns of the sheet. What is added — pokok,
     tunjangan, lembur, every addition typed by hand — and what is taken —
     lateness, short hours, BPJS, every deduction typed by hand. Their
     difference is `take_home`, by construction; the alpa is already inside
     the pokok and is shown beside it, not taken twice. */
  select coalesce(sum(a.amount) filter (where a.amount > 0), 0),
         coalesce(-sum(a.amount) filter (where a.amount < 0), 0)
    into v_adj_pos, v_adj_neg
    from ops_hr.payroll_adjustments a
   where a.run_no = p_run_no and a.employee_id = emp.id and a.withdrawn_at is null;
  out_row.additions_total := (out_row.base_pay + out_row.allowance_pay + out_row.overtime_pay
                              + v_adj_pos)::bigint;
  out_row.deductions_total := (out_row.late_deduction + out_row.undertime_amount
                               + out_row.contribution_total + v_adj_neg)::bigint;

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
   where l.employee_id = emp.id and c.work_date between v_ot_from and v_ot_to
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
  if n_assumed > 0 then
    w := w || format('%s dihitung hadir penuh sesuai jadwal (asumsi saat persetujuan) — tidak masuk atau pulang cepat hari itu dikoreksi HRD minggu depan; lembur hari itu dibayar minggu depan',
                     to_char(p_to, 'DD/MM'));
  end if;
  if v_proj then
    w := w || format('Lembur yang dibayar di sini: %s s.d. %s', to_char(v_ot_from, 'DD/MM'), to_char(v_ot_to, 'DD/MM'));
  end if;
  if emp.pay_basis <> 'monthly' and out_row.worked_days = 0 then
    w := w || 'Tidak ada hari yang terhitung pada periode ini'::text;
  end if;
  /* 0212 (D370) */
  if emp.pay_basis = 'monthly' and (v_mb ->> 'amount')::bigint <> emp.base_rate
     and jsonb_array_length(coalesce(out_row.proration, '[]'::jsonb)) > 0 then
    w := w || (select format('Gaji bulanan diprorata: %s', string_agg(
                 format('%s dari %s hari kerja %s%s%s', x ->> 'paid_days', x ->> 'workdays', x ->> 'month',
                        case when (x ->> 'outside_days')::int > 0
                             then format(' (%s hari di luar masa kerja)', x ->> 'outside_days') else '' end,
                        case when (x ->> 'absent_days')::int > 0
                             then format(' (−%s hari tidak dibayar)', x ->> 'absent_days') else '' end),
                 '; '))
                 from jsonb_array_elements(out_row.proration) x);
  end if;
  -- Only what moves money here, or the person's own switch: a run with
  -- overtime off says nothing on the slip of somebody who had none.
  if exists (select 1 from jsonb_array_elements(v_off) x
              where (x ->> 'amount')::numeric <> 0 or x ->> 'scope' = 'person') then
    w := w || (select format('Tidak dibayar/dipotong di run ini: %s', string_agg(
                 format('%s%s', x ->> 'component',
                        case when coalesce(x ->> 'reason', '') <> '' then ' — ' || (x ->> 'reason') else '' end),
                 ', '))
                 from jsonb_array_elements(v_off) x
                where (x ->> 'amount')::numeric <> 0 or x ->> 'scope' = 'person');
  end if;
  out_row.warnings := w;

  return out_row;
end $$;

/* ── the withheld-allowance list — restated from 0057 ─────────────────── */
create or replace view ops_hr.v_allowance_withholding as
select
  w.id,
  w.employee_id,
  e.employee_no,
  e.full_name,
  w.work_date,
  w.reason,
  w.by,
  coalesce(u.full_name, u.email)   as by_name,
  w.at,
  w.restored_at,
  w.restored_by,
  coalesce(r.full_name, r.email)   as restored_by_name,
  w.restored_reason,
  -- What it costs that day. The rate is the person's, read now: a copy stored
  -- at the moment of withholding would be a second figure to keep in step
  -- (A3), and the decision is about a day, not about an amount.
  -- 0215 (D378): a day of it — for a salary, the month's share for that day.
  ops_hr.allowance_day(e, w.work_date) as amount,
  w.restored_at is null            as live
from ops_hr.allowance_withholdings w
join ops_hr.employees e on e.id = w.employee_id
left join ops_core.users u on u.id = w.by
left join ops_core.users r on r.id = w.restored_by;

alter view ops_hr.v_allowance_withholding set (security_invoker = on);

/* ── a contract against the record — restated from 0058 ───────────────── */
create or replace function ops_hr.contract_conflicts(p_contract_no text default null)
returns setof ops_hr.clause_conflict_row
language sql stable set search_path = ops_hr, pg_temp as $$
  with live as (
    select c.contract_no, e.employee_no, e.full_name, e.id as employee_id,
           e.base_rate, e.pay_basis, e.allowance_rate, e.paid_leave_days,
           e.schedule_code, c.kind as contract_kind,
           ops_hr.rules_on(ops_core.office_day()) as rules
      from ops_hr.employment_contracts c
      join ops_hr.employees e on e.id = c.employee_id
     where c.status = 'active'
       and (p_contract_no is null or c.contract_no = p_contract_no)
  ),
  said as (
    select l.*, cl.kind, cl.value, cl.quote, k.bears_on
      from live l
      join ops_hr.contract_clauses cl on cl.contract_no = l.contract_no
      join ops_hr.clause_checklist k on k.kind = cl.kind
     -- Hanya yang sudah dikonfirmasi. Bacaan mesin yang belum ditandatangani
     -- siapa pun bukan dasar untuk mengatakan sistem salah.
     where cl.confirmed_at is not null
  ),
  compared as (
    select s.*,
      case s.kind
        when 'gaji_pokok'    then (s.value ->> 'amount') || ' / ' || (s.value ->> 'per')
        when 'tunjangan'     then (s.value ->> 'amount') || ' / ' || (s.value ->> 'per')
        when 'cuti'          then (s.value ->> 'days') || ' hari'
        when 'jam_kerja'     then s.value ->> 'schedule_code'
        when 'jangka_waktu'  then s.value ->> 'kind'
        when 'keterlambatan' then s.value ->> 'mode'
        when 'potongan'      then s.value ->> 'mode'
        when 'lembur'        then s.value ->> 'mode'
        end as says,
      case s.kind
        when 'gaji_pokok'    then s.base_rate::text || ' / ' ||
                                  (case s.pay_basis when 'monthly' then 'month'
                                                    when 'daily'   then 'day'
                                                    else 'hour' end)
        -- 0215 (D378): a month for a salary, a day otherwise.
        when 'tunjangan'     then s.allowance_rate::text || ' / ' ||
                                  (case s.pay_basis when 'monthly' then 'month' else 'day' end)
        when 'cuti'          then s.paid_leave_days::text || ' hari'
        when 'jam_kerja'     then s.schedule_code
        when 'jangka_waktu'  then s.contract_kind::text
        when 'keterlambatan' then coalesce(s.rules ->> 'late_mode', 'manual')
        when 'potongan'      then coalesce(s.rules ->> 'undertime_mode', 'off')
        when 'lembur'        then coalesce(s.rules ->> 'overtime_mode', 'statutory')
        end as runs
    from said s
  )
  select
    c.contract_no, c.employee_no, c.full_name, c.kind,
    c.says, c.runs,
    c.says is not null,
    -- Sebuah klausul yang tidak bisa dibandingkan tidak pernah "berbeda":
    -- kedua sisinya null, dan `null is distinct from null` adalah false. Tidak
    -- ada penjaga tambahan di sini, karena penjaga yang tidak bisa gagal adalah
    -- penjaga yang tidak pernah diuji (F95).
    c.says is distinct from c.runs,
    c.bears_on, c.quote
  from compared c
  order by c.contract_no, c.kind
$$;

/* ── what the employee form shows before anything is saved ────────────────

   The owner's order: pokok and tunjangan are typed as they are agreed, then
   *keluar perhitungan allowance per hari, gaji per jam*. The same functions
   payroll uses, on a row that is not saved — nothing here is a second copy of
   the arithmetic. Invoker: it reads only the rule book. */
create or replace function ops_hr.pay_preview(
  p_pay_basis ops_hr.pay_basis_t, p_base_rate bigint, p_allowance_rate bigint,
  p_daily_hours numeric default 8, p_schedule_code text default null,
  p_unit text default null, p_on date default null)
returns table (
  month text, workdays int, daily_rate bigint, allowance_daily bigint,
  hourly bigint, hourly_basis text, monthly_total bigint)
language plpgsql stable set search_path = ops_hr, pg_temp as $$
declare
  v_on date := coalesce(p_on, ops_core.office_day());
  v_rules jsonb := ops_hr.rules_on(v_on);
  v_emp ops_hr.employees;
  v_n int;
  v_rate ops_hr.hourly_rate_t;
begin
  v_emp := jsonb_populate_record(null::ops_hr.employees, jsonb_build_object(
    'pay_basis', p_pay_basis, 'base_rate', coalesce(p_base_rate, 0),
    'allowance_rate', coalesce(p_allowance_rate, 0),
    'daily_hours', coalesce(p_daily_hours, 8),
    'schedule_code', p_schedule_code, 'unit', coalesce(p_unit, 'Workshop')));
  v_n := ops_hr.month_workdays(v_rules,
           ops_hr.schedule_of(v_rules, v_emp.schedule_code, v_emp.unit), v_on);
  v_rate := ops_hr.hourly_rate(v_emp, v_rules);
  return query select
    to_char(v_on, 'YYYY-MM'),
    v_n,
    (case p_pay_basis
       when 'monthly' then case when v_n > 0 then round(v_emp.base_rate::numeric / v_n) end
       when 'daily'   then v_emp.base_rate
       else                round(v_emp.base_rate * v_emp.daily_hours) end)::bigint,
    (case when p_pay_basis = 'monthly'
       then case when v_n > 0 then round(v_emp.allowance_rate::numeric / v_n) end
       else v_emp.allowance_rate end)::bigint,
    v_rate.hourly,
    v_rate.basis,
    -- A full month of it, said the same way for everybody: a salary is itself,
    -- a day wage is the month's working days of it.
    (case p_pay_basis
       when 'monthly' then v_emp.base_rate + v_emp.allowance_rate
       when 'daily'   then (v_emp.base_rate + v_emp.allowance_rate) * v_n
       else round(v_emp.base_rate * v_emp.daily_hours * v_n) + v_emp.allowance_rate * v_n end)::bigint;
end $$;
grant execute on function ops_hr.pay_preview(ops_hr.pay_basis_t, bigint, bigint, numeric, text, text, date) to authenticated;

comment on column ops_hr.employees.allowance_rate is
  'Tunjangan, in the unit of the pay (D378): per month for a monthly salary, per day present for a day or hour wage. A day of a monthly allowance is derived: ÷ the month''s working days (month_workdays).';
