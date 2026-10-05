-- 0212 — payroll you can steer: who is on a run, which components it pays,
-- and a monthly salary that is a month only when somebody worked the month.
--
-- Numbered 0211 when it was written and applied: production carries it as
-- `0211_hr_payroll_flexible_*` (2026-10-05), in parts, with the three
-- superseded overloads renamed `*_retired_0211` rather than dropped (see the
-- README board, D370). Renumbered 0212 because `0211_hr_tap_kind` reached main
-- first under the same number; the two touch disjoint functions.
--
-- ── what was wrong (F220) ─────────────────────────────────────────────────
--
-- Owner, 2026-10-05: *kenapa monthly dapat full gaji padahal cuma masuk
-- beberapa hari*. `payroll_line_for` paid `base_rate` to anybody on
-- `pay_basis = 'monthly'`, whatever the run's length, the person's start date
-- or the days HRD marked alpa. Production's `pyr-26-10-01_01` covers 28–30
-- September — three days — and paid eleven monthly people Rp 30,9 juta of
-- pokok between them, Rp 4.500.000 of it to somebody who joins on 1 October.
--
-- Two more things made it worse, and both are the run rather than the sum:
--
--   * a run was **everybody**. `period_lines` took every employee in the
--     period, so the workshop's weekly run paid office staff a month, and
--     nothing let HRD say *this person is not paid in this run*;
--   * runs could not overlap **at all** (`periods_do_not_overlap`, 0055), so a
--     September monthly run and a September weekly run could not both exist —
--     although D243 says both periods run.
--
-- ── the owner's answers (D370) ────────────────────────────────────────────
--
--   1. *Prorata hari kerja.* Pokok × paid working days ÷ the month's working
--      days, month by month, where a working day is the person's pattern and
--      the company calendar (`is_workday_for`). A whole month with nothing
--      deducted is exactly `base_rate`, never a rounding of it.
--   2. *Yang mengurangi: alpa ditandai HRD.* Days before `joined_on` or after
--      `left_on` are not paid (that is (1), not a deduction), and a working day
--      HRD marked unpaid — alpa, izin, sakit tanpa surat, cuti di luar jatah,
--      the marks `read_day` already values at 0 — is taken off. **Taps never
--      are**: office staff do not use the reader (F72), so no taps is not
--      absence. A half day is not deducted from a monthly salary (Q63, default).
--   3. *Kelompok + centang.* A run has a `pay_group` — weekly (daily and
--      hourly pay), monthly, all, or custom (nobody until HRD adds them) — and
--      opening it writes **who is on it** into `payroll_run_members`. HRD takes
--      people off or puts them on, with a sentence.
--   4. *Komponen per run + per orang.* A run carries switches for seven
--      components, and a person's own switches override the run's, with a
--      sentence. Off means *not paid in this run* and the slip says what it
--      would have been.
--
-- ── the same day is still never paid twice ────────────────────────────────
--
-- The rule `periods_do_not_overlap` kept is kept, at the grain it was always
-- about: **a person**, not the calendar. A trigger on `payroll_run_members`
-- refuses anybody already on another run covering one of the same days, and
-- opening a run of the same group over an overlapping one is still refused
-- with the old `period_overlaps`, as is a run every one of whose people is
-- already paid elsewhere. Somebody covered by a run of another group is
-- put on the new run as *not included*, with the run that pays them named.
--
-- ── signed figures ────────────────────────────────────────────────────────
--
-- Payroll figures are derived when read (A3), so changing the monthly sum
-- changes every run it reads. Production had **no** APPROVED or PAID run when
-- this was written (two DRAFTs: 7–11 Sep and 28–30 Sep), so no signed figure
-- moves. The two drafts become `all` runs with exactly the people the old
-- scope put on them, so HRD sees them as they were and can take the monthly
-- staff off.

/* ── the seven components, and the shape of a switch set ─────────────── */

-- `{"overtime": false}` — a key that is absent is on. Only these keys, only
-- booleans: a typo that switched nothing off would look like it had.
create or replace function ops_hr.pay_components()
returns text[] language sql immutable as $$
  select array['base','allowance','overtime','absence','late','undertime','contributions']
$$;

create or replace function ops_hr.components_ok(p jsonb)
returns boolean language sql immutable set search_path = ops_hr, pg_temp as $$
  select p is not null and jsonb_typeof(p) = 'object'
     and not exists (
       select 1 from jsonb_each(p) kv
        where kv.key <> all (ops_hr.pay_components())
           or jsonb_typeof(kv.value) <> 'boolean')
$$;

create or replace function ops_hr.components_any_off(p jsonb)
returns boolean language sql immutable set search_path = ops_hr, pg_temp as $$
  select exists (select 1 from jsonb_each(coalesce(p, '{}'::jsonb)) kv
                  where jsonb_typeof(kv.value) = 'boolean' and not kv.value::text::boolean)
$$;

/* Which group a pay basis belongs to. Weekly is the workshop's day and hour
   wage, monthly the salary (D243). */
create or replace function ops_hr.in_pay_group(p_basis text, p_group text)
returns boolean language sql immutable as $$
  select case coalesce(p_group, 'all')
           when 'all'     then true
           when 'weekly'  then p_basis <> 'monthly'
           when 'monthly' then p_basis = 'monthly'
           else false end
$$;

/* ── a working day, for one person ─────────────────────────────────────

   Not a tanggal merah, and a day the person's pattern works. A pattern with
   its own weekdays (D340) says so day by day — off, or a premium day such as
   a Saturday at 2×, which is not part of the month a salary pays for; a
   weekday it does not mention is worked, which is how `read_day` reads it
   (the guard's Saturday). A pattern with no weekdays of its own follows the
   rule book's `week_pattern`, as `is_rest_day` always has. */
create or replace function ops_hr.is_workday_for(p_rules jsonb, p_sc jsonb, p_date date)
returns boolean
language sql stable set search_path = ops_hr, pg_temp as $$
  with x as (
    select p_sc -> 'days' as days,
           p_sc -> 'days' -> (extract(isodow from p_date)::int)::text as dv
  )
  select not ops_hr.office_closed(p_date) and case
    when jsonb_typeof(x.dv) = 'object' then
      not coalesce((x.dv ->> 'off')::boolean, false)
      and coalesce(case when jsonb_typeof(x.dv -> 'pay_multiplier') = 'number'
                        then (x.dv ->> 'pay_multiplier')::numeric end, 1) <= 1
    when jsonb_typeof(x.days) = 'object' and x.days <> '{}'::jsonb then true
    else not ops_hr.is_rest_day(p_rules, p_date)
  end
  from x
$$;

/* ── a monthly salary over a period ────────────────────────────────────

   Month by month, because a run of 28 September – 4 October is three
   September days of a September salary and two October days of an October
   one, and the two months do not have the same number of working days.

     amount = base_rate × paid working days ÷ the month's working days

   *paid* = the period's working days, less those outside employment, less
   (when `p_absence`) those HRD marked unpaid. A month paid whole is exactly
   `base_rate`, not the division. */
create or replace function ops_hr.monthly_base(
  p_rate numeric, p_rules jsonb, p_sc jsonb, p_joined date, p_left date,
  p_from date, p_to date, p_unpaid date[], p_absence boolean)
returns jsonb
language plpgsql stable set search_path = ops_hr, pg_temp as $$
declare
  m date; m_end date; s date; e date; d date;
  n_work int; n_in int; n_out int; n_abs int; n_paid int;
  amt bigint; total bigint := 0; months jsonb := '[]'::jsonb;
begin
  m := date_trunc('month', p_from)::date;
  while m <= p_to loop
    m_end := (m + interval '1 month' - interval '1 day')::date;
    s := greatest(m, p_from); e := least(m_end, p_to);
    n_work := 0; n_in := 0; n_out := 0; n_abs := 0;
    for d in select g::date from generate_series(m, m_end, interval '1 day') g loop
      if ops_hr.is_workday_for(p_rules, p_sc, d) then
        n_work := n_work + 1;
        if d between s and e then
          n_in := n_in + 1;
          if (p_joined is not null and d < p_joined) or (p_left is not null and d > p_left) then
            n_out := n_out + 1;
          elsif p_absence and d = any(coalesce(p_unpaid, '{}'::date[])) then
            n_abs := n_abs + 1;
          end if;
        end if;
      end if;
    end loop;
    n_paid := n_in - n_out - n_abs;
    amt := case when n_work = 0 then 0
                when n_paid = n_work then round(p_rate)
                else round(p_rate * n_paid / n_work) end;
    total := total + amt;
    months := months || jsonb_build_object(
      'month', to_char(m, 'YYYY-MM'),
      'workdays', n_work, 'period_days', n_in,
      'outside_days', n_out, 'absent_days', n_abs,
      'paid_days', n_paid, 'amount', amt);
    m := (m + interval '1 month')::date;
  end loop;
  return jsonb_build_object('amount', total, 'months', months);
end $$;

grant execute on function
  ops_hr.pay_components(), ops_hr.components_ok(jsonb), ops_hr.components_any_off(jsonb),
  ops_hr.in_pay_group(text, text), ops_hr.is_workday_for(jsonb, jsonb, date),
  ops_hr.monthly_base(numeric, jsonb, jsonb, date, date, date, date, date[], boolean)
  to authenticated;

/* ── the run: a group, and its switches ──────────────────────────────── */

alter table ops_hr.payroll_runs
  add column pay_group text not null default 'all'
    constraint pay_group_known check (pay_group in ('weekly','monthly','all','custom')),
  add column components jsonb not null default '{}'::jsonb
    constraint run_components_shape check (ops_hr.components_ok(components)),
  -- Why something is off for the whole run. Printed on every slip it touches.
  add column components_note text,
  add constraint run_components_explained check (
    not ops_hr.components_any_off(components)
    or length(btrim(coalesce(components_note, ''))) > 0);

-- The calendar-wide rule gives way to the per-person one below.
alter table ops_hr.payroll_runs drop constraint periods_do_not_overlap;
alter table ops_hr.payroll_runs drop constraint period_once;

/* ── who is on a run ─────────────────────────────────────────────────── */

create table ops_hr.payroll_run_members (
  run_no      text not null references ops_hr.payroll_runs(run_no),
  employee_id uuid not null references ops_hr.employees(id),
  -- On the run and paid by it. A row with `false` is somebody the group would
  -- have put here and who is not — kept, so the screen can say why.
  included    boolean not null default true,
  -- This person's own switches, over the run's. Same shape.
  components  jsonb not null default '{}'::jsonb
    constraint member_components_shape check (ops_hr.components_ok(components)),
  note        text,
  -- Written by opening the run, not by a person deciding.
  auto        boolean not null default false,
  set_by      uuid references ops_core.users(id),
  set_at      timestamptz not null default now(),
  primary key (run_no, employee_id),
  -- Taking somebody off, or a component off them, says why. A slip with a
  -- figure missing and no sentence is the one people come to the counter with.
  constraint member_explained check (
    (included and not ops_hr.components_any_off(components))
    or length(btrim(coalesce(note, ''))) > 0)
);

create index payroll_run_members_emp_idx on ops_hr.payroll_run_members (employee_id) where included;

-- The two drafts that exist become `all` runs with the people the old scope
-- put on them — everybody employed during the period — so nothing on them
-- moves except the monthly sum this migration is about.
insert into ops_hr.payroll_run_members (run_no, employee_id, included, auto, set_at)
select r.run_no, e.id, true, true, r.created_at
  from ops_hr.payroll_runs r
  join ops_hr.employees e
    on (e.active or e.left_on >= r.period_start)
   and (e.joined_on is null or e.joined_on <= r.period_end)
on conflict do nothing;

/* A member row moves only while its run is a draft, and nobody is on two runs
   that cover the same day. Definer, because the clash it looks for may be on a
   run the caller's own policies do not show. */
create or replace function ops_hr.run_member_guard()
returns trigger
language plpgsql security definer set search_path = ops_hr, pg_temp as $$
declare r ops_hr.payroll_runs; clash text;
begin
  select * into r from ops_hr.payroll_runs where run_no = new.run_no;
  -- The rows a run is born with go in whatever its status (a run inserted as
  -- already approved, in a test or an import); a person's change never does.
  if r.status is distinct from 'DRAFT' and not (tg_op = 'INSERT' and new.auto) then
    raise exception 'run % is %, and who is on it may only change while it is DRAFT', new.run_no, r.status
      using errcode = 'check_violation';
  end if;
  if new.included then
    -- Two openings at once cannot both pass the check below.
    perform pg_advisory_xact_lock(hashtext('ops_hr.run_member:' || new.employee_id::text));
    select o.run_no into clash
      from ops_hr.payroll_run_members m
      join ops_hr.payroll_runs o on o.run_no = m.run_no
     where m.employee_id = new.employee_id and m.included
       and m.run_no <> new.run_no
       and daterange(o.period_start, o.period_end, '[]') && daterange(r.period_start, r.period_end, '[]')
     limit 1;
    if clash is not null then
      raise exception 'employee % is already paid for these days in %', new.employee_id, clash
        using errcode = 'exclusion_violation';
    end if;
  end if;
  return new;
end $$;

create trigger run_member_guard
  before insert or update on ops_hr.payroll_run_members
  for each row execute function ops_hr.run_member_guard();

/* A run is born with its people, whichever road it arrived by — the seam, or
   a direct insert under `runs_new`. Everybody the group puts here; anybody
   already paid for one of these days by another run, written off with that
   run's number. `custom` starts empty. */
create or replace function ops_hr.run_born_with_members()
returns trigger
language plpgsql security definer set search_path = ops_hr, pg_temp as $$
begin
  if new.pay_group = 'custom' then return null; end if;
  insert into ops_hr.payroll_run_members (run_no, employee_id, included, note, auto, set_by)
  select new.run_no, e.id, c.run_no is null,
         case when c.run_no is not null
              then format('Sudah dibayar di %s (%s – %s)', c.run_no, c.period_start, c.period_end) end,
         true, new.created_by
    from ops_hr.employees e
    left join lateral (
      select o.run_no, o.period_start, o.period_end
        from ops_hr.payroll_run_members m
        join ops_hr.payroll_runs o on o.run_no = m.run_no
       where m.employee_id = e.id and m.included and o.run_no <> new.run_no
         and daterange(o.period_start, o.period_end, '[]')
             && daterange(new.period_start, new.period_end, '[]')
       limit 1) c on true
   where (e.active or e.left_on >= new.period_start)
     and (e.joined_on is null or e.joined_on <= new.period_end)
     and ops_hr.in_pay_group(e.pay_basis::text, new.pay_group);
  return null;
end $$;

create trigger run_born_with_members
  after insert on ops_hr.payroll_runs
  for each row execute function ops_hr.run_born_with_members();

revoke execute on function ops_hr.run_member_guard() from public;
revoke execute on function ops_hr.run_born_with_members() from public;
grant execute on function ops_hr.run_member_guard(), ops_hr.run_born_with_members() to authenticated;

/* Moving a run's dates is held to the same rule: nobody it pays may end up
   on two runs over one day. The calendar-wide constraint used to catch this
   for free. */
create or replace function ops_hr.run_period_guard()
returns trigger
language plpgsql security definer set search_path = ops_hr, pg_temp as $$
declare clash text;
begin
  if (new.period_start, new.period_end) is distinct from (old.period_start, old.period_end) then
    select o.run_no into clash
      from ops_hr.payroll_run_members m
      join ops_hr.payroll_run_members om on om.employee_id = m.employee_id and om.included
                                        and om.run_no <> m.run_no
      join ops_hr.payroll_runs o on o.run_no = om.run_no
     where m.run_no = new.run_no and m.included
       and daterange(o.period_start, o.period_end, '[]') && daterange(new.period_start, new.period_end, '[]')
     limit 1;
    if clash is not null then
      raise exception 'run % would pay somebody % already pays', new.run_no, clash
        using errcode = 'exclusion_violation';
    end if;
  end if;
  return new;
end $$;

create trigger run_period_guard
  before update of period_start, period_end on ops_hr.payroll_runs
  for each row execute function ops_hr.run_period_guard();

revoke execute on function ops_hr.run_period_guard() from public;
grant execute on function ops_hr.run_period_guard() to authenticated;

alter table ops_hr.payroll_run_members enable row level security;

-- Payroll and HRD read the list; a person reads their own row once the run is
-- signed — the same line `runs_read_own` (0166) draws for the run itself.
create policy members_read on ops_hr.payroll_run_members for select to authenticated
  using (ops_core.has_permission('payroll.read') or ops_core.has_permission('hrd.read'));
create policy members_read_own on ops_hr.payroll_run_members for select to authenticated
  using (employee_id = ops_hr.my_employee_id()
         and exists (select 1 from ops_hr.payroll_runs r
                      where r.run_no = payroll_run_members.run_no
                        and r.status in ('APPROVED','PAID')));

-- Written by payroll, as the run itself is (`runs_new`, `runs_edit`). The seams
-- below are the road the screen takes; the trigger and the checks hold for
-- any road.
create policy members_new on ops_hr.payroll_run_members for insert to authenticated
  with check (ops_core.has_permission('payroll.run'));
create policy members_edit on ops_hr.payroll_run_members for update to authenticated
  using (ops_core.has_permission('payroll.run')) with check (ops_core.has_permission('payroll.run'));

grant select, insert, update on ops_hr.payroll_run_members to authenticated;

analyze ops_hr.payroll_run_members;

/* ── what a line carries now ─────────────────────────────────────────── */
alter type ops_hr.payroll_figures
  -- The pokok before proration: a month's salary, or what the days came to.
  add attribute base_full       bigint cascade,
  -- Per month: working days, the period's share, outside employment, alpa,
  -- paid, amount. Empty for anybody not on a salary.
  add attribute proration       jsonb  cascade,
  -- Each component switched off: what it would have been, whose switch, why.
  add attribute components_off  jsonb  cascade;

/* ── one person's line — restated from 0206 ──────────────────────────────

   Four changes, each marked 0212: the run's and the person's switches are
   read; unpaid marked days are collected as the loop already walks them; a
   salary is prorated by `monthly_base`; and the monthly tunjangan stops at the
   edges of employment. Everything else is 0206's, word for word. */
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
      is_present := case when d.mark_kind is not null then d.mark_kind = 'half_day'
                         else not ops_hr.is_rest_day(v_rules, d.work_date) end;
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
      select exists (
        select 1 from ops_hr.allowance_withholdings aw
         where aw.employee_id = emp.id and aw.work_date = d.work_date
           and aw.restored_by is null
      ) into withheld;
      if withheld then n_withheld := n_withheld + 1;
      else
        n_present := n_present + 1;
        allow_units := allow_units + case when d.day_value > 0 then d.day_value else 1 end;
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
  end if;

  out_row.allowance_days := n_present;
  out_row.allowance_withheld_days := n_withheld;
  out_row.allowance_pay := case when allow_byval
    then round(allow_units * emp.allowance_rate)::bigint
    else (n_present::bigint * emp.allowance_rate) end;
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

/* ── who a period is computed for ───────────────────────────────────────

   A run is its members. A period with no run is everybody employed during it
   in the group asked for — the weekly screen asks for `weekly`, and stops
   showing the office a month's salary for a week (D370). Employed means
   started by the period's end as well as not gone before its start: somebody
   who joins on 1 October is not on 28–30 September.

   The filter sits under the function, so nobody outside it is computed. Same
   shape as 0194: the function in `FROM`, called once per person. */
drop function if exists ops_hr.payroll_totals(date, date, text);
drop function if exists ops_hr.period_lines(date, date, text);

create or replace function ops_hr.period_lines(
  p_from date, p_to date, p_run_no text default null, p_group text default null)
returns setof ops_hr.payroll_figures
language sql stable set search_path = ops_hr, pg_temp as $$
  select l.*
    from (select e.id from ops_hr.employees e
           where case when p_run_no is not null then
                   exists (select 1 from ops_hr.payroll_run_members m
                            where m.run_no = p_run_no and m.employee_id = e.id and m.included)
                 else (e.active or e.left_on >= p_from)
                      and (e.joined_on is null or e.joined_on <= p_to)
                      and ops_hr.in_pay_group(e.pay_basis::text, p_group)
                 end) e
    cross join lateral ops_hr.payroll_line_for(e.id, p_from, p_to, p_run_no) l
   order by l.employee_no
$$;

create or replace function ops_hr.run_lines(p_run_no text)
returns setof ops_hr.payroll_figures
language sql stable set search_path = ops_hr, pg_temp as $$
  select l.* from ops_hr.payroll_runs r
   cross join lateral ops_hr.period_lines(r.period_start, r.period_end, r.run_no) l
   where r.run_no = p_run_no
$$;

-- Pending overtime is the lines' own now, so a run's header counts only the
-- people on it.
create or replace function ops_hr.payroll_totals(
  p_from date, p_to date, p_run_no text default null, p_group text default null)
returns ops_hr.payroll_totals_t
language sql stable set search_path = ops_hr, pg_temp as $$
  select (
    count(*)::int,
    coalesce(sum(l.gross), 0)::bigint,
    coalesce(sum(l.adjustment_total), 0)::numeric,
    (coalesce(sum(l.gross), 0) + coalesce(sum(l.adjustment_total), 0))::bigint,
    coalesce(sum(l.open_days), 0)::int,
    coalesce(sum(l.overtime_pending_hours), 0)::numeric
  )::ops_hr.payroll_totals_t
  from ops_hr.period_lines(p_from, p_to, p_run_no, p_group) l
$$;

grant execute on function ops_hr.period_lines(date, date, text, text),
                          ops_hr.run_lines(text),
                          ops_hr.payroll_totals(date, date, text, text)
  to authenticated;

/* ── who is on a run, as the screen lists it ─────────────────────────── */
create or replace function ops_hr.run_members(p_run_no text)
returns table (
  employee_id uuid, employee_no text, full_name text, "position" text,
  pay_basis text, included boolean, components jsonb, note text, auto boolean,
  set_by_name text, set_at timestamptz)
language sql stable set search_path = ops_hr, pg_temp as $$
  select m.employee_id, e.employee_no, e.full_name, e.position, e.pay_basis::text,
         m.included, m.components, m.note, m.auto,
         u.full_name, m.set_at
    from ops_hr.payroll_run_members m
    join ops_hr.employees e on e.id = m.employee_id
    left join ops_core.users u on u.id = m.set_by
   where m.run_no = p_run_no
   order by m.included desc, e.employee_no
$$;

grant execute on function ops_hr.run_members(text) to authenticated;

/* ── opening a run — restated from 0055, with a group and its switches ──

   Opening writes who is on it: everybody employed during the period in the
   group, except anybody another run already pays for one of these days — they
   are written *not included*, with that run named. The same group over an
   overlapping period is still refused as `period_overlaps`, as is a run that
   would pay nobody because every one of them is paid elsewhere. */
drop function if exists ops_hr.open_payroll_run(date, date, text, text);

create or replace function ops_hr.open_payroll_run(
  p_period_start date,
  p_period_end   date,
  p_note         text  default null,
  p_key          text  default null,
  p_group        text  default 'all',
  p_components   jsonb default '{}'::jsonb,
  p_components_note text default null)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare
  v_replayed jsonb; v_clash ops_hr.payroll_runs; v_no text; v_res jsonb;
  v_group text := coalesce(nullif(btrim(p_group), ''), 'all');
  v_comp jsonb := coalesce(p_components, '{}'::jsonb);
  n_in int; n_out int;
begin
  v_replayed := ops_core.idem_replay('hr','open_payroll_run', p_key);
  if v_replayed is not null then return v_replayed; end if;

  if not ops_core.has_permission('payroll.run') then
    return ops_core.refused('hr','payroll', null,'open',
      'not_permitted','Opening a payroll run needs payroll access.');
  end if;
  if p_period_end < p_period_start then
    return ops_core.invalid('hr','payroll', null,'open',
      'period_invalid','Periodenya berakhir sebelum dimulai.',
      jsonb_build_object('field','period_end'));
  end if;
  if v_group not in ('weekly','monthly','all','custom') then
    return ops_core.invalid('hr','payroll', null,'open',
      'group_invalid','Kelompoknya mingguan, bulanan, semua, atau pilih sendiri.',
      jsonb_build_object('field','pay_group'));
  end if;
  if not ops_hr.components_ok(v_comp) then
    return ops_core.invalid('hr','payroll', null,'open',
      'components_invalid', format('Komponen yang dikenal: %s, masing-masing ya/tidak.',
                                   array_to_string(ops_hr.pay_components(), ', ')),
      jsonb_build_object('field','components'));
  end if;
  if ops_hr.components_any_off(v_comp) and length(btrim(coalesce(p_components_note, ''))) = 0 then
    return ops_core.invalid('hr','payroll', null,'open',
      'reason_required','Komponen yang tidak dibayar di run ini perlu alasan — tercetak di slip.',
      jsonb_build_object('field','components_note'));
  end if;

  -- **Overlap within a group** is still the old refusal, with the run named.
  -- Across groups the rule is the person's: an `all` draft that still holds
  -- the office must not stop the monthly run from opening once HRD has taken
  -- the office off it — and anybody it still pays is written off the new run,
  -- with it named.
  select r.* into v_clash from ops_hr.payroll_runs r
   where daterange(r.period_start, r.period_end, '[]')
      && daterange(p_period_start, p_period_end, '[]')
     and r.pay_group = v_group and v_group <> 'custom'
   limit 1;
  if found then
    return ops_core.conflict('hr','payroll', v_clash.run_no,'open',
      'period_overlaps',
      format('%s sudah mencakup %s sampai %s. Hari yang sama tidak dibayar dua kali.',
             v_clash.run_no, v_clash.period_start, v_clash.period_end));
  end if;

  insert into ops_hr.payroll_runs (period_start, period_end, note, created_by,
                                   pay_group, components, components_note)
  values (p_period_start, p_period_end, nullif(btrim(coalesce(p_note,'')), ''), auth.uid(),
          v_group, v_comp, nullif(btrim(coalesce(p_components_note, '')), ''))
  returning run_no into v_no;

  -- Its people were written by `run_born_with_members` as the row went in.

  select count(*) filter (where included), count(*) filter (where not included)
    into n_in, n_out
    from ops_hr.payroll_run_members where run_no = v_no;

  -- A run of a group that pays nobody, because another run already pays every
  -- one of them, is the overlap by another road.
  if v_group <> 'custom' and n_in = 0 and n_out > 0 then
    raise exception using errcode = 'P0001', message = 'ops_hr:everyone_paid_elsewhere';
  end if;

  v_res := ops_core.ok('hr','payroll', v_no,'open',
    jsonb_build_object('run_no', v_no, 'period_start', p_period_start,
                       'period_end', p_period_end, 'status', 'DRAFT',
                       'pay_group', v_group, 'members', n_in, 'not_included', n_out));
  return ops_core.idem_remember('hr','open_payroll_run', p_key, v_res);
exception
  when raise_exception then
    if sqlerrm = 'ops_hr:everyone_paid_elsewhere' then
      return ops_core.conflict('hr','payroll', null,'open',
        'period_overlaps',
        'Semua orang di kelompok ini sudah dibayar untuk hari-hari itu di run lain. Hari yang sama tidak dibayar dua kali.');
    end if;
    raise;
end $$;

revoke execute on function ops_hr.open_payroll_run(date, date, text, text, text, jsonb, text) from public;
grant execute on function ops_hr.open_payroll_run(date, date, text, text, text, jsonb, text) to authenticated;

/* ── putting somebody on a run, or taking them off ─────────────────────── */
create or replace function ops_hr.set_payroll_member(
  p_run_no      text,
  p_employee_no text,
  p_included    boolean,
  p_components  jsonb default '{}'::jsonb,
  p_note        text  default null,
  p_key         text  default null)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare
  v_replayed jsonb; v_run ops_hr.payroll_runs; v_emp ops_hr.employees;
  v_before ops_hr.payroll_run_members; v_comp jsonb := coalesce(p_components, '{}'::jsonb);
  v_note text := nullif(btrim(coalesce(p_note, '')), ''); v_res jsonb; v_clash text;
begin
  v_replayed := ops_core.idem_replay('hr','set_payroll_member', p_key);
  if v_replayed is not null then return v_replayed; end if;

  if not ops_core.has_permission('payroll.run') then
    return ops_core.refused('hr','payroll', p_run_no,'set_member',
      'not_permitted','Who is on a payroll run is payroll''s to change.');
  end if;
  select r.* into v_run from ops_hr.payroll_runs r where r.run_no = p_run_no;
  if not found then
    return ops_core.not_found('hr','payroll', p_run_no,'set_member',
      format('No payroll run %s.', p_run_no));
  end if;
  if not ops_hr.run_is_open(v_run) then
    return ops_core.conflict('hr','payroll', p_run_no,'set_member',
      'run_not_draft',
      format('%s sudah %s. Yang sudah ditandatangani tidak diubah — perubahannya masuk run berikutnya.',
             p_run_no, v_run.status));
  end if;
  select e.* into v_emp from ops_hr.employees e where e.employee_no = p_employee_no;
  if not found then
    return ops_core.not_found('hr','payroll', p_run_no,'set_member',
      format('No employee %s.', p_employee_no));
  end if;
  if p_included is null then
    return ops_core.invalid('hr','payroll', p_run_no,'set_member',
      'included_required','Ikut run ini atau tidak?', jsonb_build_object('field','included'));
  end if;
  if not ops_hr.components_ok(v_comp) then
    return ops_core.invalid('hr','payroll', p_run_no,'set_member',
      'components_invalid', format('Komponen yang dikenal: %s, masing-masing ya/tidak.',
                                   array_to_string(ops_hr.pay_components(), ', ')),
      jsonb_build_object('field','components'));
  end if;
  if (not p_included or ops_hr.components_any_off(v_comp)) and v_note is null then
    return ops_core.invalid('hr','payroll', p_run_no,'set_member',
      'reason_required',
      'Mengeluarkan orang dari run, atau tidak membayar satu komponennya, perlu alasan — tercetak di slip.',
      jsonb_build_object('field','note'));
  end if;
  if p_included then
    select o.run_no into v_clash
      from ops_hr.payroll_run_members m
      join ops_hr.payroll_runs o on o.run_no = m.run_no
     where m.employee_id = v_emp.id and m.included and m.run_no <> p_run_no
       and daterange(o.period_start, o.period_end, '[]')
           && daterange(v_run.period_start, v_run.period_end, '[]')
     limit 1;
    if v_clash is not null then
      return ops_core.conflict('hr','payroll', p_run_no,'set_member',
        'paid_elsewhere',
        format('%s sudah dibayar untuk sebagian hari ini di %s. Keluarkan dari sana dulu — hari yang sama tidak dibayar dua kali.',
               v_emp.full_name, v_clash));
    end if;
  end if;

  select m.* into v_before from ops_hr.payroll_run_members m
   where m.run_no = p_run_no and m.employee_id = v_emp.id;

  insert into ops_hr.payroll_run_members (run_no, employee_id, included, components, note, auto, set_by, set_at)
  values (p_run_no, v_emp.id, p_included, v_comp, v_note, false, auth.uid(), now())
  on conflict (run_no, employee_id) do update
    set included = excluded.included, components = excluded.components,
        note = excluded.note, auto = false, set_by = excluded.set_by, set_at = excluded.set_at;

  v_res := ops_core.ok('hr','payroll', p_run_no,'set_member',
    jsonb_build_object('run_no', p_run_no, 'employee_no', v_emp.employee_no,
                       'included', p_included, 'components', v_comp, 'note', v_note),
    case when v_before.run_no is null then null
         else jsonb_build_object('included', v_before.included, 'components', v_before.components,
                                 'note', v_before.note) end,
    jsonb_build_object('included', p_included, 'components', v_comp, 'note', v_note));
  return ops_core.idem_remember('hr','set_payroll_member', p_key, v_res);
end $$;

revoke execute on function ops_hr.set_payroll_member(text, text, boolean, jsonb, text, text) from public;
grant execute on function ops_hr.set_payroll_member(text, text, boolean, jsonb, text, text) to authenticated;

/* ── the run's switches ──────────────────────────────────────────────── */
create or replace function ops_hr.set_payroll_components(
  p_run_no     text,
  p_components jsonb,
  p_note       text default null,
  p_key        text default null)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare
  v_replayed jsonb; v_run ops_hr.payroll_runs; v_res jsonb;
  v_comp jsonb := coalesce(p_components, '{}'::jsonb);
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  v_replayed := ops_core.idem_replay('hr','set_payroll_components', p_key);
  if v_replayed is not null then return v_replayed; end if;

  if not ops_core.has_permission('payroll.run') then
    return ops_core.refused('hr','payroll', p_run_no,'set_components',
      'not_permitted','What a payroll run pays is payroll''s to change.');
  end if;
  select r.* into v_run from ops_hr.payroll_runs r where r.run_no = p_run_no;
  if not found then
    return ops_core.not_found('hr','payroll', p_run_no,'set_components',
      format('No payroll run %s.', p_run_no));
  end if;
  if not ops_hr.run_is_open(v_run) then
    return ops_core.conflict('hr','payroll', p_run_no,'set_components',
      'run_not_draft',
      format('%s sudah %s. Yang sudah ditandatangani tidak diubah.', p_run_no, v_run.status));
  end if;
  if not ops_hr.components_ok(v_comp) then
    return ops_core.invalid('hr','payroll', p_run_no,'set_components',
      'components_invalid', format('Komponen yang dikenal: %s, masing-masing ya/tidak.',
                                   array_to_string(ops_hr.pay_components(), ', ')),
      jsonb_build_object('field','components'));
  end if;
  if ops_hr.components_any_off(v_comp) and v_note is null then
    return ops_core.invalid('hr','payroll', p_run_no,'set_components',
      'reason_required','Komponen yang tidak dibayar di run ini perlu alasan — tercetak di slip.',
      jsonb_build_object('field','note'));
  end if;

  update ops_hr.payroll_runs
     set components = v_comp, components_note = v_note
   where run_no = p_run_no;

  v_res := ops_core.ok('hr','payroll', p_run_no,'set_components',
    jsonb_build_object('run_no', p_run_no, 'components', v_comp, 'note', v_note),
    jsonb_build_object('components', v_run.components, 'note', v_run.components_note),
    jsonb_build_object('components', v_comp, 'note', v_note));
  return ops_core.idem_remember('hr','set_payroll_components', p_key, v_res);
end $$;

revoke execute on function ops_hr.set_payroll_components(text, jsonb, text, text) from public;
grant execute on function ops_hr.set_payroll_components(text, jsonb, text, text) to authenticated;
