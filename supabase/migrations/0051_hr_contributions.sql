-- 0051_hr_contributions.sql — the statutory half, and the enum that held it up.
--
-- The last HR tables, and the reason they waited: `contribution_scheme_t` is
-- in `src/services/hr/contracts.ts` and never reached `0001_core_types.sql`.
-- It arrived with M50, after the ladder's type file was written, so it is
-- created here beside the tables that need it rather than in a file of loose
-- types (the note in `01-schema.md` says the same of `task_status_t` and
-- `task_ref_t`, which are still outstanding).
--
-- **`PPH21` is a member of the enum and is never computed.** It is recorded —
-- who has an NPWP, which bracket — because knowing who is enrolled is useful
-- and deriving the figure is not ours to do: PPh 21 is progressive over TER
-- tables nobody has given us (D140, Q50 answered *tidak*). A missing deduction
-- is obvious on a payslip; a wrong one is found by an employee who is short.
create type ops_hr.contribution_scheme_t as enum (
  'BPJS_KESEHATAN','JHT','JP','JKK','JKM','PPH21');

-- The five this system will compute. `PPH21` is deliberately not among them,
-- and every view below reads this function rather than repeating the list.
create or replace function ops_hr.computed_schemes()
returns ops_hr.contribution_scheme_t[]
language sql immutable as $$
  select array['BPJS_KESEHATAN','JHT','JP','JKK','JKM']::ops_hr.contribution_scheme_t[]
$$;

-- One dated version of a scheme's rate, for the same reason the pay rules are
-- dated (D173): a contribution recomputed for March must use March's
-- percentage.
create table ops_hr.contribution_rates (
  id                uuid primary key default gen_random_uuid(),
  scheme            ops_hr.contribution_scheme_t not null,
  effective_from    date not null,
  employer_percent  numeric not null check (employer_percent >= 0),
  employee_percent  numeric not null check (employee_percent >= 0),
  -- NULL means no ceiling. BPJS resets these annually, which is why the rate
  -- is a dated row and not a constant.
  wage_ceiling      bigint check (wage_ceiling is null or wage_ceiling > 0),
  -- **false = a stand-in this system chose, not a checked figure** (Q49). The
  -- percentages are public; the risk class behind JKK is not — BPJS sets it
  -- per employer between 0,24% and 1,74%, and a plausible number presented as
  -- fact is worse than one wearing a badge that says it is unconfirmed.
  -- Renamed from `confirmed`. `check_shadowing` compares PL/pgSQL locals
  -- against **every column name in all six schemas**, so a column called
  -- `confirmed` turns a local of that name in an applied procurement
  -- migration into a finding — and since 2026-09-18 an applied migration is
  -- not editable (0028). The unapplied side yields. See C13 and F108.
  rate_confirmed    boolean not null default false,
  -- Required: where the number came from. A rate nobody can source is one
  -- nobody can defend when the invoice disagrees with it.
  note              text not null check (length(btrim(note)) > 0),
  created_by        uuid references ops_core.users(id),
  created_at        timestamptz not null default now(),
  constraint rate_version_once unique (scheme, effective_from)
);

-- Who is registered, and since when. **The row never goes** (A5): ending an
-- enrolment is a date and a reason, because the name is still on next month's
-- bill and somebody will ask why.
create table ops_hr.enrolments (
  id             uuid primary key default gen_random_uuid(),
  employee_id    uuid not null references ops_hr.employees(id),
  scheme         ops_hr.contribution_scheme_t not null,
  -- Masked on read (D196) — see `v_enrolment`. Held here because HRD types it
  -- off the card and the card is the only place it exists.
  member_no      text,
  enrolled_on    date not null,
  ended_on       date,
  ended_reason   text,
  -- The wage BPJS was registered against, where it differs from the pay
  -- record. NULL means *use what we pay them*, which is the ordinary case.
  declared_base  bigint check (declared_base is null or declared_base > 0),
  by             uuid references ops_core.users(id),
  created_at     timestamptz not null default now(),
  constraint ended_says_why check (
    ended_on is null or (ended_reason is not null and length(btrim(ended_reason)) > 0)),
  constraint ended_after_enrolled check (ended_on is null or ended_on >= enrolled_on)
);

-- One live enrolment per person per scheme. A second one while the first is
-- open would bill twice; a second one after it ended is a re-enrolment and is
-- allowed, which is why this is partial rather than a plain unique.
create unique index enrolment_live_idx on ops_hr.enrolments (employee_id, scheme)
  where ended_on is null;

-- ── reading them ──────────────────────────────────────────────────────────

-- The rate in force for a month. Dated like the rule book, and **no rate means
-- no figure rather than a figure of zero** — every caller below treats a
-- missing rate as "not computed" and says so.
create or replace function ops_hr.rate_for(p_scheme ops_hr.contribution_scheme_t, p_month date)
returns ops_hr.contribution_rates
language sql stable set search_path = ops_hr, pg_temp as $$
  select r.* from ops_hr.contribution_rates r
   where r.scheme = p_scheme
     and r.effective_from <= date_trunc('month', p_month)::date
   order by r.effective_from desc
   limit 1
$$;

-- Was this person in the scheme **at any point** in the month?
--
-- At any point, not on the first: BPJS charges the month, so somebody who
-- joined on the 20th is on that month's invoice. The line says which case it
-- is rather than leaving a full month's charge looking like a full month's
-- cover.
create or replace function ops_hr.enrolled_in(p_month date, p_enrolled_on date, p_ended_on date)
returns boolean
language sql immutable as $$
  select p_enrolled_on <= (date_trunc('month', p_month) + interval '1 month - 1 day')::date
     and (p_ended_on is null or p_ended_on >= date_trunc('month', p_month)::date)
$$;

-- What a contribution is computed on: the declared wage where one was
-- registered, otherwise the pay record — **pokok + tunjangan** (D250),
-- converted to a month for people paid by the day, so a daily worker and a
-- salaried one are measured the same way.
create or replace function ops_hr.contribution_base(p_employee ops_hr.employees, p_month date)
returns bigint
language sql stable set search_path = ops_hr, pg_temp as $$
  select round(
    case p_employee.pay_basis
      when 'monthly' then p_employee.base_rate + p_employee.allowance_rate * d
      when 'daily'   then (p_employee.base_rate + p_employee.allowance_rate) * d
      else                p_employee.base_rate * p_employee.daily_hours * d + p_employee.allowance_rate * d
    end)::bigint
  from (
    select greatest(coalesce(
      (ops_hr.rules_on(date_trunc('month', p_month)::date)->>'effective_days_per_year')::numeric, 300), 1) / 12 as d
  ) r
$$;

-- One scheme, one month, name by name — the owner's own audit: *daftar nama
-- terdaftar × biaya per orang* (D259).
--
-- A function rather than a view because a month is a parameter and there is no
-- table of months; `v_payroll_contribution` below is the view, and it gets its
-- month from the run.
create or replace function ops_hr.contribution_lines(
  p_scheme ops_hr.contribution_scheme_t, p_month date)
returns table (
  employee_id uuid, employee_no text, full_name text,
  scheme ops_hr.contribution_scheme_t, member_no_masked text,
  base bigint, base_source text, capped_from bigint,
  employer bigint, employee bigint, total_amount bigint,
  rate_confirmed boolean, partial_month text
)
language sql stable set search_path = ops_hr, pg_temp as $$
  with r as (select * from ops_hr.rate_for(p_scheme, p_month))
  select
    e.id, e.employee_no, e.full_name, en.scheme,
    -- Every digit and letter replaced, separators kept: enough to say whether
    -- the reading is plausible without showing one character of it (D196).
    case when en.member_no is null then null
         else regexp_replace(en.member_no, '[0-9A-Za-z]', '•', 'g') end,
    least(coalesce(en.declared_base, ops_hr.contribution_base(e, p_month)),
          coalesce(r.wage_ceiling, 9223372036854775807))::bigint,
    case when en.declared_base is not null then 'declared' else 'pay_record' end,
    case when r.wage_ceiling is not null
          and coalesce(en.declared_base, ops_hr.contribution_base(e, p_month)) > r.wage_ceiling
         then coalesce(en.declared_base, ops_hr.contribution_base(e, p_month))::bigint
         else null end,
    -- No rate for the month means no figure, not a figure of zero.
    case when r.id is null then 0 else round(
      least(coalesce(en.declared_base, ops_hr.contribution_base(e, p_month)),
            coalesce(r.wage_ceiling, 9223372036854775807))
      * r.employer_percent / 100) end::bigint,
    case when r.id is null then 0 else round(
      least(coalesce(en.declared_base, ops_hr.contribution_base(e, p_month)),
            coalesce(r.wage_ceiling, 9223372036854775807))
      * r.employee_percent / 100) end::bigint,
    case when r.id is null then 0 else round(
      least(coalesce(en.declared_base, ops_hr.contribution_base(e, p_month)),
            coalesce(r.wage_ceiling, 9223372036854775807))
      * (r.employer_percent + r.employee_percent) / 100) end::bigint,
    coalesce(r.rate_confirmed, false),
    -- BPJS charges the month whole, so a part-month is a full charge with a
    -- sentence rather than a pro-rated figure nobody agreed to.
    case
      when date_trunc('month', en.enrolled_on) = date_trunc('month', p_month)
        then format('Masuk %s — iuran tetap sebulan penuh.', en.enrolled_on)
      when en.ended_on is not null
       and date_trunc('month', en.ended_on) = date_trunc('month', p_month)
        then format('Berhenti %s — bulan ini masih ditagih penuh.', en.ended_on)
      else null
    end
  from ops_hr.enrolments en
  join ops_hr.employees e on e.id = en.employee_id
  left join r on true
  where en.scheme = p_scheme
    and ops_hr.enrolled_in(p_month, en.enrolled_on, en.ended_on)
  order by e.full_name
$$;

-- The employee half, per run, per person, per scheme — what a payslip prints
-- under the gross.
--
-- **Only the schemes somebody is actually enrolled in.** A person with no
-- enrolment row gets no deduction, and that is the gate: nothing appears on
-- anybody's payslip because software was updated (D140, D259).
create or replace view ops_hr.v_payroll_contribution as
select
  r.run_no,
  s.scheme,
  l.employee_id, l.employee_no, l.full_name,
  l.member_no_masked, l.base, l.base_source, l.capped_from,
  l.employer, l.employee, l.total_amount, l.rate_confirmed, l.partial_month
from ops_hr.payroll_runs r
cross join unnest(ops_hr.computed_schemes()) s(scheme)
cross join lateral ops_hr.contribution_lines(s.scheme, r.period_start) l;

-- Masked, always. The raw column stays on the table for the one screen that
-- types it in; nothing reads it back out through here (D196).
create or replace view ops_hr.v_enrolment as
select
  en.id, en.employee_id, e.employee_no, e.full_name, en.scheme,
  case when en.member_no is null then null
       else regexp_replace(en.member_no, '[0-9A-Za-z]', '•', 'g') end as member_no_masked,
  en.member_no is not null as has_member_no,
  en.enrolled_on, en.ended_on, en.ended_reason, en.declared_base,
  en.scheme = any(ops_hr.computed_schemes()) as computed
from ops_hr.enrolments en
join ops_hr.employees e on e.id = en.employee_id;

-- ── access ────────────────────────────────────────────────────────────────
alter table ops_hr.contribution_rates enable row level security;
alter table ops_hr.enrolments         enable row level security;

-- The rates are public figures and everybody who can open HR or payroll needs
-- to see which one was applied. Writing them is IT's, beside the pay rules.
create policy rates_read on ops_hr.contribution_rates for select to authenticated
  using (ops_core.has_permission('hrd.read') or ops_core.has_permission('payroll.read'));
create policy rates_new  on ops_hr.contribution_rates for insert to authenticated
  with check (ops_core.has_permission('it.update'));
create policy rates_edit on ops_hr.contribution_rates for update to authenticated
  using (ops_core.has_permission('it.update')) with check (ops_core.has_permission('it.update'));

create policy enrol_read on ops_hr.enrolments for select to authenticated
  using (ops_core.has_permission('hrd.read') or ops_core.has_permission('payroll.read'));
create policy enrol_new  on ops_hr.enrolments for insert to authenticated
  with check (ops_core.has_permission('hrd.create'));
create policy enrol_edit on ops_hr.enrolments for update to authenticated
  using (ops_core.has_permission('hrd.update')) with check (ops_core.has_permission('hrd.update'));

alter view ops_hr.v_payroll_contribution set (security_invoker = on);
alter view ops_hr.v_enrolment            set (security_invoker = on);

grant select on all tables in schema ops_hr to authenticated;
grant insert, update on ops_hr.contribution_rates, ops_hr.enrolments to authenticated;
