-- 0057_hr_read_surface.sql — the reads the HR screens actually make, so the
-- client can assemble rather than compute.
--
-- `B4` is a real client for HR, and writing one against `0053`–`0056` turned up
-- four questions the database could answer and did not, each of which the demo
-- answers by computing in TypeScript. A figure computed in the browser is a
-- figure the two implementations can disagree about (ADR-009), so they move
-- here.
--
-- ## A period is readable without a run (D158)
--
-- *What does this week look like* is the question HRD asks; *what does run
-- pyr-26-09-06_01 look like* is not. `payroll_line` took a `run_no` and read
-- the run only for its two dates, so a week nobody had opened could not be
-- costed at all — and opening a run to find out what it would say is exactly
-- the button D158 exists to avoid.
--
-- So the body takes the **period**, and `payroll_line(employee, run_no)`
-- becomes the two-line wrapper that looks the dates up. Overloading is not
-- available (`00_no_overloads`), hence the second name.
--
-- **This is the third copy of those two hundred lines and the last.** F126 said
-- a restatement should be mechanical — a slice with one substitution rather
-- than a retyping nobody can diff — and this one is: seven substitutions, all
-- of them `run.period_start` → `p_from`. After it there is one body, and
-- `0055`'s copy is superseded by this file the way `0055` superseded `0050`'s.
--
-- ## A surat dokter belongs to a day marked sakit
--
-- `attach_surat_dokter` looks like the seam `0054` deliberately did **not**
-- write, and the difference is the rule. There was nothing HR-specific about
-- attaching a surat lembur — the leader's signature checks that one is there,
-- and a second entry point bought nothing but a second place to forget. Here
-- there is a rule: `read_day` only looks for a `surat_dokter` on a **sick**
-- mark, so one filed against an izin does nothing at all, silently. That rule
-- is HR's and has to live in `ops_hr`; the filing itself still goes through
-- `ops_core.attach_link`, which is what keeps it one road (ADR-010).
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

  out_row.run_no := coalesce(p_run_no, '');
  out_row.employee_id := emp.id;
  out_row.employee_no := emp.employee_no;
  out_row.full_name := emp.full_name;
  out_row.worked_days := 0; out_row.open_days := 0;
  out_row.days_present := 0; out_row.days_sick_paid := 0;
  out_row.days_leave_paid := 0; out_row.days_unpaid := 0;
  out_row.normal_hours := 0;
  out_row.late_minutes := 0;

  for d in select * from ops_hr.timesheet(emp.id, p_from, p_to) loop
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
    from ops_hr.overtime_parts(emp.id, p_from, p_to);

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

  out_row.gross := out_row.base_pay + out_row.allowance_pay + out_row.overtime_pay
                 - out_row.undertime_amount - out_row.late_deduction;

  /* The sentences a payslip needs, because a figure nobody can take apart is a
     figure somebody argues with at the counter. */
  if out_row.open_days > 0 then
    w := w || format('%s hari belum dibaca — belum bernilai sampai ada yang membacanya', out_row.open_days);
  end if;
  select coalesce(sum(c.hours), 0) into pending_ot from ops_hr.v_overtime_claim c
    join ops_hr.overtime_lines l on l.sheet_id = c.id
   where l.employee_id = emp.id and c.work_date between p_from and p_to
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

-- The old name, kept because every caller and `v_payroll_line` use it: a run
-- is a period with a number on it.
create or replace function ops_hr.payroll_line(p_employee uuid, p_run_no text)
returns ops_hr.payroll_figures
language sql stable set search_path = ops_hr, pg_temp as $$
  select ops_hr.payroll_line_for(p_employee, r.period_start, r.period_end, r.run_no)
    from ops_hr.payroll_runs r where r.run_no = p_run_no
$$;

-- ── who is on a period ────────────────────────────────────────────────────
--
-- One definition of the scope, which `run_lines` now borrows: everybody still
-- here, plus anybody who left during it, because they are owed the days they
-- worked.
create or replace function ops_hr.period_lines(
  p_from date, p_to date, p_run_no text default null)
returns setof ops_hr.payroll_figures
language sql stable set search_path = ops_hr, pg_temp as $$
  select l.*
    from ops_hr.employees e
    cross join lateral (select (ops_hr.payroll_line_for(e.id, p_from, p_to, p_run_no)).*) l
   where e.active or e.left_on >= p_from
   order by l.employee_no
$$;

create or replace function ops_hr.run_lines(p_run_no text)
returns setof ops_hr.payroll_figures
language sql stable set search_path = ops_hr, pg_temp as $$
  select l.* from ops_hr.payroll_runs r
   cross join lateral ops_hr.period_lines(r.period_start, r.period_end, r.run_no) l
   where r.run_no = p_run_no
$$;

-- ── what a period comes to ────────────────────────────────────────────────
--
-- Every figure on the payroll screen's header, in one read. The client used to
-- have to sum the lines it had just been handed, which is arithmetic in a
-- browser over money — and two implementations doing that arithmetic is two
-- chances to round it differently.
create type ops_hr.payroll_totals_t as (
  people                 int,
  gross_total            bigint,
  adjustment_total       numeric,
  -- **Gross plus everything moved by hand**, which is what the contract calls
  -- the net today. It is not what reaches a bank account — `0051` made an
  -- employee's BPJS half a deduction from it — and Q56 is that argument.
  net_total              bigint,
  open_days              int,
  pending_overtime_hours numeric
);

create or replace function ops_hr.payroll_totals(
  p_from date, p_to date, p_run_no text default null)
returns ops_hr.payroll_totals_t
language sql stable set search_path = ops_hr, pg_temp as $$
  select (
    count(*)::int,
    coalesce(sum(l.gross), 0)::bigint,
    coalesce(sum(l.adjustment_total), 0)::numeric,
    (coalesce(sum(l.gross), 0) + coalesce(sum(l.adjustment_total), 0))::bigint,
    coalesce(sum(l.open_days), 0)::int,
    coalesce((select sum(c.hours) from ops_hr.v_overtime_claim c
               where c.work_date between p_from and p_to
                 and c.stage in ('waiting_hrd','waiting_surat','waiting_leader')), 0)::numeric
  )::ops_hr.payroll_totals_t
  from ops_hr.period_lines(p_from, p_to, p_run_no) l
$$;

-- ── the working patterns, and who is on one ───────────────────────────────
--
-- *Setiap karyawan akan punya jadwal kerja tertaut* (Q53). Two halves, and the
-- second is what keeps it honest: HR **assigns**, so the unassigned are counted
-- and named, because a person with no pattern is a person whose punctuality
-- cannot be measured and a silent fall-back onto the office clock is what Q44
-- was raised about (F70, D279).
--
-- `inherited` is the third state and the one worth having: on a pattern only
-- because their unit defaults to it. An assumption, not a decision, and the
-- screen can ask somebody to confirm it in one click.
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
      (sc.j ->> 'start_minutes')::int   as st,
      (sc.j ->> 'end_minutes')::int     as en,
      (sc.j ->> 'break_minutes')::int   as br,
      (sc.j ->> 'friday_break_minutes')::int as fbr
    from sc
  ),
  figured as (
    select h.code, h.j,
      case when h.st is null or h.en is null or h.br is null then null
           else round(((h.en - h.st) - h.br) / 60.0, 2) end as daily,
      case when h.st is null or h.en is null or h.fbr is null then null
           else round(((h.en - h.st) - h.fbr) / 60.0, 2) end as friday,
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
        'note', f.j ->> 'note',
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

-- ── the surat dokter ──────────────────────────────────────────────────────
create or replace function ops_hr.attach_surat_dokter(
  p_mark_no text, p_attachment_id uuid, p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare v_replayed jsonb; v_mark ops_hr.day_marks; v_linked jsonb; v_res jsonb;
begin
  v_replayed := ops_core.idem_replay('hr','attach_surat_dokter', p_key);
  if v_replayed is not null then return v_replayed; end if;

  if not ops_core.has_permission('hrd.create') then
    return ops_core.refused('hr','day_mark', p_mark_no,'attach_surat_dokter',
      'not_permitted','Filing a surat dokter needs HR access.');
  end if;

  select m.* into v_mark from ops_hr.day_marks m
   where m.mark_no = p_mark_no and m.withdrawn_at is null;
  if not found then
    return ops_core.not_found('hr','day_mark', p_mark_no,'attach_surat_dokter',
      format('Tidak ada tanda hari %s.', p_mark_no));
  end if;

  -- **The rule this seam exists for.** `read_day` looks for a surat dokter only
  -- on a sick mark, so one filed against an izin changes nothing and says
  -- nothing — the worst of the three possible behaviours.
  if v_mark.kind <> 'sick' then
    return ops_core.invalid('hr','day_mark', p_mark_no,'attach_surat_dokter',
      'not_a_sick_day',
      'Surat dokter melekat pada hari yang ditandai sakit. Hari ini ditandai lain.',
      jsonb_build_object('field','mark_no','kind', v_mark.kind));
  end if;

  v_linked := ops_core.attach_link(p_attachment_id,'day_mark', p_mark_no,'surat_dokter');
  if not ops_core.said_ok(v_linked) then return v_linked; end if;

  v_res := ops_core.ok('hr','day_mark', p_mark_no,'attach_surat_dokter',
    jsonb_build_object('mark_no', p_mark_no, 'attachment_id', p_attachment_id,
                       -- The day is paid now, and saying so is the point of the
                       -- letter (D144).
                       'day_value', (select d.day_value from ops_hr.read_day(v_mark.employee_id, v_mark.work_date) d)));
  return ops_core.idem_remember('hr','attach_surat_dokter', p_key, v_res);
end $$;

grant execute on function
  ops_hr.payroll_line_for(uuid, date, date, text),
  ops_hr.period_lines(date, date, text),
  ops_hr.payroll_totals(date, date, text),
  ops_hr.schedule_roll(),
  ops_hr.attach_surat_dokter(text, uuid, text)
  to authenticated;

-- ── the allowance a day did not earn ──────────────────────────────────────
--
-- `0050` built the table and no way to read it with names on it. The screen
-- lists *whose allowance, which day, why, and who decided* — four questions,
-- three of them joins.
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
  e.allowance_rate                 as amount,
  w.restored_at is null            as live
from ops_hr.allowance_withholdings w
join ops_hr.employees e on e.id = w.employee_id
left join ops_core.users u on u.id = w.by
left join ops_core.users r on r.id = w.restored_by;

alter view ops_hr.v_allowance_withholding set (security_invoker = on);

-- ── a day, with the one thing the reading does not say ────────────────────
--
-- `read_day` answers what a day is worth and why. What the screen also needs is
-- whether that is **still fixable**: a sick day with no surat dokter is unpaid
-- today and paid the moment the letter arrives, and saying so while it can
-- still be done is the difference between a screen and a receipt (D144).
--
-- Not an attribute on `day_reading`: that type is returned by `read_day`,
-- `timesheet` and `v_timesheet_day`, and adding one would restate two hundred
-- lines of `0049` for a sentence. F126's rule — what a field costs is how much
-- code must be re-emitted to carry it — says to put it beside the reading.
create type ops_hr.timesheet_row as (
  employee_id    uuid,
  employee_no    text,
  full_name      text,
  work_date      date,
  in_at          timestamptz,
  break_out_at   timestamptz,
  break_in_at    timestamptz,
  out_at         timestamptz,
  ot_start_at    timestamptz,
  ot_end_at      timestamptz,
  work_hours     numeric,
  break_hours    numeric,
  overtime_hours numeric,
  day_value      numeric,
  state          ops_hr.day_state_t,
  mark_no        text,
  mark_kind      ops_hr.day_mark_t,
  why            text,
  -- Null unless somebody can still change the answer.
  fixable        text,
  issues         text[],
  notes          text[]
);

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
      -- The letter is what makes it paid, and it can still arrive.
      when d.mark_kind = 'sick'  and d.day_value = 0
        then 'Surat dokter belum ada — dengan suratnya, hari ini dibayar penuh.'
      -- Past the entitlement is not fixable by paperwork, and still worth a
      -- sentence: it is why the day is unpaid.
      when d.mark_kind = 'leave' and d.day_value = 0
        then 'Jatah cuti tahun ini sudah habis — hari ini tercatat, tidak dibayar.'
      end,
    d.issues, d.notes
  from ops_hr.employees e
  cross join lateral generate_series(p_from, p_to, interval '1 day') g(day)
  cross join lateral ops_hr.read_day(e.id, g.day::date) d
  where e.active
    and (p_unit is null or e.unit = p_unit)
    and (p_employee_no is null or e.employee_no = p_employee_no)
  order by e.employee_no, d.work_date
$$;

grant execute on function ops_hr.timesheet_rows(date, date, text, text) to authenticated;
grant select on ops_hr.v_allowance_withholding to authenticated;
