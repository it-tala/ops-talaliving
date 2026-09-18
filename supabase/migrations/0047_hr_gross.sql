-- 0047_hr_gross.sql — what a person is owed for a period, computed on read.
--
-- The transcription of `payrollLine`. **Contributions are not here and that is
-- not a gap**: the demo's gross is
--
--     base + allowance + overtime − undertime − lateness
--
-- and BPJS is a deduction taken *after* it, reported beside it and never
-- inside it. So the gross is complete without the enrolment pair that is still
-- waiting on `contribution_scheme_t`, and the pair goes in 0048 where it
-- belongs — a deduction of its own, gated on Q30, which blocks handing over a
-- payslip rather than computing one.
--
-- Nothing in here is stored. A gross that was right when it was written is a
-- gross that disagrees with the marks behind it the first time a surat dokter
-- arrives late (A3, D139).

-- The tunjangan a day loses because HRD said so (D250).
--
-- Presence earns the allowance; taking it away is a separate decision with its
-- own sentence. Putting it back is a **second** decision rather than an
-- erasure, which is why `restored_*` is here and no row is ever deleted (A5).
create table ops_hr.allowance_withholdings (
  id               uuid primary key default gen_random_uuid(),
  employee_id      uuid not null references ops_hr.employees(id),
  work_date        date not null,
  reason           text not null check (length(btrim(reason)) > 0),
  by               uuid not null references ops_core.users(id),
  at               timestamptz not null default now(),
  restored_by      uuid references ops_core.users(id),
  restored_at      timestamptz,
  restored_reason  text,
  constraint withheld_once unique (employee_id, work_date),
  -- Restoring says who, when and why, or it is not a decision anybody can read
  -- back in six months.
  constraint restore_complete check (
    (restored_by is null and restored_at is null and restored_reason is null)
    or (restored_by is not null and restored_at is not null
        and restored_reason is not null and length(btrim(restored_reason)) > 0))
);

alter table ops_hr.allowance_withholdings enable row level security;
create policy withheld_read on ops_hr.allowance_withholdings for select to authenticated
  using (ops_core.has_permission('hrd.read') or ops_core.has_permission('payroll.read'));
create policy withheld_new  on ops_hr.allowance_withholdings for insert to authenticated
  with check (ops_core.has_permission('hrd.create'));
create policy withheld_edit on ops_hr.allowance_withholdings for update to authenticated
  using (ops_core.has_permission('hrd.update')) with check (ops_core.has_permission('hrd.update'));
grant select on ops_hr.allowance_withholdings to authenticated;
grant insert, update on ops_hr.allowance_withholdings to authenticated;

-- ── an hour of somebody's time ────────────────────────────────────────────
--
-- Two answers, and the rule book says which one the payslip uses (D249).
-- `company` is the owner's own arithmetic — a year of pay divided by the days
-- this business actually works divided by the hours in its day. `statutory` is
-- 1/173 of a month, the figure the overtime ladder is written against.
--
-- The statutory divisor only means anything against a **monthly** wage: for
-- somebody paid by the day or the hour there is no month to divide, so the two
-- answers are the same answer. Said here rather than left as a coincidence.
create type ops_hr.hourly_rate_t as (
  hourly bigint, basis text, company bigint, statutory bigint,
  annual bigint, includes_allowance boolean
);

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
    select r.*,
      case when r.with_allow then p_employee.allowance_rate else 0 end as allow_day
    from r
  ),
  y as (
    select a.*,
      /* A year of this person's pay, however their pokok is quoted. The
         allowance is per day (D250), so it enters the year multiplied by the
         days the business works and never by twelve. */
      case p_employee.pay_basis
        when 'monthly' then p_employee.base_rate * 12 + a.allow_day * a.days
        when 'daily'   then (p_employee.base_rate + a.allow_day) * a.days
        else                p_employee.base_rate * a.hpd * a.days + a.allow_day * a.days
      end as annual
    from a
  ),
  c as (
    select y.*, round(y.annual / y.days / y.hpd) as company from y
  ),
  s as (
    select c.*,
      case when p_employee.pay_basis = 'monthly'
        then round((p_employee.base_rate + (c.allow_day * c.days) / 12) / c.divisor)
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

-- A rest day takes the steeper ladder, and a tanggal merah counts as one
-- (D173). `6day` means Sunday alone; `5day` adds Saturday.
create or replace function ops_hr.is_rest_day(p_rules jsonb, p_date date)
returns boolean
language sql stable set search_path = ops_hr, pg_temp as $$
  select ops_hr.office_closed(p_date)
      or case when coalesce(p_rules->>'week_pattern','6day') = '5day'
              then extract(isodow from p_date) >= 6
              else extract(isodow from p_date) = 7 end
$$;

-- The ladder, applied to one night's hours.
--
-- Returns the parts rather than a total, because the total is the thing nobody
-- can check: *3 jam lembur = Rp 91.000* invites an argument, while *jam ke-1 ×
-- 1,5 + 2 jam × 2* ends one (D173). A loop, because each rung starts where the
-- previous one stopped.
create or replace function ops_hr.tier_parts(p_hours numeric, p_tiers jsonb)
returns table (part_hours numeric, multiplier numeric, from_hour numeric)
language plpgsql immutable set search_path = ops_hr, pg_temp as $$
declare
  ladder numeric[][];
  n int; i int;
  v_from numeric; v_to numeric; slice numeric; taken numeric := 0;
  rungs jsonb;
begin
  select jsonb_agg(t order by (t->>'after_hours')::numeric) into rungs
    from jsonb_array_elements(coalesce(p_tiers, '[]'::jsonb)) t;
  if rungs is null then return; end if;

  n := jsonb_array_length(rungs);
  i := 0;
  while i < n and taken < p_hours loop
    v_from := (rungs->i->>'after_hours')::numeric;
    v_to   := case when i + 1 < n then (rungs->(i+1)->>'after_hours')::numeric else p_hours end;
    slice  := least(p_hours, v_to) - greatest(taken, v_from);
    if slice > 0 then
      part_hours := round(slice, 2);
      multiplier := (rungs->i->>'multiplier')::numeric;
      from_hour  := v_from;
      return next;
      taken := greatest(taken, v_from) + slice;
    end if;
    i := i + 1;
  end loop;
end $$;

-- Overtime, night by night and tier by tier. Three rules meet here and the
-- order matters:
--
--   1. **The paper wins where it speaks.** A GAJI figure written on the form is
--      what the man signed for and is paid as written (D154) — no ladder, no
--      recomputation. A system that quietly pays a different number because
--      its own multiplication came out differently is wrong even when its
--      arithmetic is right.
--   2. Otherwise the ladder applies **per night**, because "the first hour" is
--      the first hour of that night and not of the fortnight.
--   3. A rest day takes the steeper ladder.
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
begin
  select * into emp from ops_hr.employees where id = p_employee;
  if not found then return; end if;
  v_rules := ops_hr.rules_on(p_from);
  rate    := ops_hr.hourly_rate(emp, v_rules);
  mode    := coalesce(v_rules->>'overtime_mode', 'tiered');
  roundm  := coalesce((v_rules->>'overtime_rounding_minutes')::numeric, 0);

  for ln in
    select l.hours as h, l.form_amount, c.sheet_no as sno, c.work_date as wd
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
    tiers := case
      when mode = 'flat' then jsonb_build_array(jsonb_build_object(
        'after_hours', 0, 'multiplier', coalesce((v_rules->>'flat_multiplier')::numeric, 1.5)))
      when rest then coalesce(v_rules->'restday_tiers', '[]'::jsonb)
      else           coalesce(v_rules->'workday_tiers', '[]'::jsonb)
    end;

    for pt in select * from ops_hr.tier_parts(hrs, tiers) loop
      sheet_no := ln.sno; work_date := ln.wd; hours := pt.part_hours;
      multiplier := pt.multiplier; hourly := rate.hourly;
      amount := round(pt.part_hours * pt.multiplier * rate.hourly)::bigint;
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

-- ── the line ──────────────────────────────────────────────────────────────
create type ops_hr.payroll_figures as (
  run_no                  text,
  employee_id             uuid,
  employee_no             text,
  full_name               text,
  worked_days             numeric,
  open_days               int,
  days_present            numeric,
  days_sick_paid          int,
  days_leave_paid         int,
  days_unpaid             int,
  normal_hours            numeric,
  overtime_hours          numeric,
  hourly                  bigint,
  hourly_basis            text,
  base_pay                bigint,
  allowance_days          int,
  allowance_withheld_days int,
  allowance_pay           bigint,
  overtime_pay            bigint,
  undertime_hours         numeric,
  undertime_amount        bigint,
  late_minutes            int,
  late_priced             bigint,
  late_deduction          bigint,
  adjustment_total        numeric,
  gross                   bigint,
  warnings                text[]
);

create or replace function ops_hr.payroll_line(p_employee uuid, p_run_no text)
returns ops_hr.payroll_figures
language plpgsql stable set search_path = ops_hr, pg_temp as $$
declare
  emp       ops_hr.employees%rowtype;
  run       ops_hr.payroll_runs%rowtype;
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
begin
  select * into emp from ops_hr.employees where id = p_employee;
  if not found then return null; end if;
  select * into run from ops_hr.payroll_runs where run_no = p_run_no;
  if not found then return null; end if;

  /* The book in force **when the period opened**, which is the whole reason
     the rule book is dated (D173). */
  v_rules  := ops_hr.rules_on(run.period_start);
  rate     := ops_hr.hourly_rate(emp, v_rules);
  sc       := ops_hr.schedule_of(v_rules, emp.schedule_code, emp.unit);
  day_start := coalesce((sc->>'start_minutes')::int, (v_rules->>'day_starts_minutes')::int);
  grace    := coalesce((v_rules->>'late_grace_minutes')::int, 0);
  ut_mode  := coalesce(v_rules->>'undertime_mode', 'off');
  ut_grace := coalesce((v_rules->>'undertime_grace_minutes')::numeric, 0) / 60;

  out_row.run_no := run.run_no;
  out_row.employee_id := emp.id;
  out_row.employee_no := emp.employee_no;
  out_row.full_name := emp.full_name;
  out_row.worked_days := 0; out_row.open_days := 0;
  out_row.days_present := 0; out_row.days_sick_paid := 0;
  out_row.days_leave_paid := 0; out_row.days_unpaid := 0;
  out_row.normal_hours := 0;
  out_row.late_minutes := 0;

  for d in select * from ops_hr.timesheet(emp.id, run.period_start, run.period_end) loop
    out_row.worked_days := out_row.worked_days + d.day_value;
    if d.state = 'review' then out_row.open_days := out_row.open_days + 1; end if;
    if d.day_value > 0 then out_row.normal_hours := out_row.normal_hours + d.work_hours; end if;
    shown_ot := shown_ot + d.overtime_hours;

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
    if d.in_at is not null and d.mark_kind is null and day_start is not null then
      late_one := greatest(ops_hr.wita_minutes(d.in_at) - day_start - grace, 0);
      out_row.late_minutes := out_row.late_minutes + late_one;
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

  out_row.normal_hours := round(out_row.normal_hours, 2);
  out_row.worked_days  := round(out_row.worked_days, 2);
  out_row.hourly       := rate.hourly;
  out_row.hourly_basis := rate.basis;

  /* Monthly staff are paid the month whatever the machine says; a daily or
     hourly person is paid for what they were here for. That difference is the
     only place `pay_basis` is used, and it is why it exists. */
  out_row.base_pay := case emp.pay_basis
    when 'monthly' then emp.base_rate
    when 'daily'   then round(out_row.worked_days * emp.base_rate)
    else                round(out_row.normal_hours * emp.base_rate)
  end::bigint;

  out_row.allowance_days := n_present;
  out_row.allowance_withheld_days := n_withheld;
  out_row.allowance_pay := (n_present::bigint * emp.allowance_rate);

  select coalesce(sum(amount), 0), coalesce(sum(hours), 0)
    into out_row.overtime_pay, out_row.overtime_hours
    from ops_hr.overtime_parts(emp.id, run.period_start, run.period_end);

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
   where a.run_no = run.run_no and a.employee_id = emp.id;

  out_row.gross := out_row.base_pay + out_row.allowance_pay + out_row.overtime_pay
                 - out_row.undertime_amount - out_row.late_deduction;

  /* The sentences a payslip needs, because a figure nobody can take apart is a
     figure somebody argues with at the counter. */
  if out_row.open_days > 0 then
    w := w || format('%s hari belum dibaca — belum bernilai sampai ada yang membacanya', out_row.open_days);
  end if;
  select coalesce(sum(c.hours), 0) into pending_ot from ops_hr.v_overtime_claim c
    join ops_hr.overtime_lines l on l.sheet_id = c.id
   where l.employee_id = emp.id and c.work_date between run.period_start and run.period_end
     and c.stage in ('waiting_hrd','waiting_surat','waiting_leader');
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
  if emp.pay_basis <> 'monthly' and out_row.worked_days = 0 then
    w := w || 'Tidak ada hari yang terhitung pada periode ini'::text;
  end if;
  out_row.warnings := w;

  return out_row;
end $$;

-- Every person on every run. The period comes from the run, which is why this
-- one can be a view where `timesheet` could not.
create or replace view ops_hr.v_payroll_line as
select l.*
  from ops_hr.payroll_runs r
  cross join ops_hr.employees e
  cross join lateral (select (ops_hr.payroll_line(e.id, r.run_no)).*) l
 where e.active or e.left_on >= r.period_start;

alter view ops_hr.v_payroll_line set (security_invoker = on);
grant select on ops_hr.v_payroll_line to authenticated;
