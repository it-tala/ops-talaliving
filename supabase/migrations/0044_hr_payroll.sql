-- 0044_hr_payroll.sql — the run, and the only rows a person adds to it by hand.
--
-- **Payroll lines are not a table.** A line is days and approved overtime read
-- through the rule book in force when the period opened, and storing it would
-- be storing a figure that disagrees with the marks behind it the first time
-- a Surat Dokter arrives late (A3, D139). What IS stored is the run itself and
-- the adjustments — because those are decisions somebody took, not
-- derivations, and the system computes none of them (D155).

create table ops_hr.payroll_runs (
  id            uuid primary key default gen_random_uuid(),
  run_no        text not null unique default ops_core.next_doc_number('pyr'),
  period_start  date not null,
  period_end    date not null,
  status        ops_hr.payroll_status_t not null default 'DRAFT',
  approved_by   uuid references ops_core.users(id),
  approved_at   timestamptz,
  -- The ledger row that paid it — a public code, never a uuid into another
  -- schema (ADR-004). `acct` owns the money; this only says which movement.
  paid_trx_no   text,
  note          text,
  created_by    uuid references ops_core.users(id),
  created_at    timestamptz not null default now(),

  constraint period_forwards check (period_end >= period_start),
  -- The same week is not run twice by accident.
  constraint period_once unique (period_start, period_end),
  constraint approval_complete check ((approved_at is null) = (approved_by is null)),
  -- A run that says it is APPROVED and names nobody is a signature with no
  -- signatory; one that says PAID and names no transaction is a payment
  -- nobody can find in the ledger.
  constraint approved_is_signed check (status = 'DRAFT' or approved_at is not null),
  constraint paid_names_its_row  check (status <> 'PAID' or (paid_trx_no is not null and length(btrim(paid_trx_no)) > 0))
);

-- What a person adds to or takes off a payslip by hand (D155).
--
-- Typed, signed, reasoned — and frozen once the run leaves DRAFT. The system
-- computes none of these: it does not know what a minute of lateness costs
-- here (Q41), and a plausible invented number is a wage dispute.
create table ops_hr.payroll_adjustments (
  id           uuid primary key default gen_random_uuid(),
  -- Belongs to the run, not to the week: re-running a period does not inherit
  -- last run's corrections.
  run_no       text not null references ops_hr.payroll_runs(run_no),
  employee_id  uuid not null references ops_hr.employees(id),
  kind         ops_hr.adjustment_kind_t not null,
  -- Signed: negative takes money off.
  amount       numeric not null,
  -- Printed on the payslip verbatim. A deduction an employee cannot read is
  -- one they cannot dispute (D155).
  reason       text not null check (length(btrim(reason)) > 0),
  created_by   uuid not null references ops_core.users(id),
  created_at   timestamptz not null default now(),

  -- A zero adjustment is a row that says nothing and prints a line on a
  -- payslip anyway.
  constraint adjustment_moves_something check (amount <> 0)
);

create index adj_run_idx on ops_hr.payroll_adjustments (run_no);

-- ── the run freezes ───────────────────────────────────────────────────────
--
-- An approved run is a figure somebody signed; moving money inside it
-- afterwards is a new run, not an edit (D155). A trigger rather than a policy,
-- because a policy binds `authenticated` and a `security definer` seam runs
-- past it — and the rule has to hold for the seam most of all, since that is
-- where the writing will happen once B3 lands.
create or replace function ops_hr.adjustment_run_is_draft()
returns trigger
language plpgsql set search_path = ops_hr, pg_temp as $$
declare s ops_hr.payroll_status_t;
begin
  select status into s from ops_hr.payroll_runs where run_no = new.run_no;
  if s is distinct from 'DRAFT' then
    raise exception 'run % is %, and an adjustment may only be written while it is DRAFT', new.run_no, s
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger adjustment_run_is_draft
  before insert or update on ops_hr.payroll_adjustments
  for each row execute function ops_hr.adjustment_run_is_draft();

-- A run moves DRAFT → APPROVED → PAID and never back. Reopening an approved
-- run would let the adjustments unfreeze, which is the rule above undone by
-- the other end.
create or replace function ops_hr.payroll_run_moves_forward()
returns trigger
language plpgsql set search_path = ops_hr, pg_temp as $$
declare rank_old int; rank_new int;
begin
  rank_old := array_position(array['DRAFT','APPROVED','PAID'], old.status::text);
  rank_new := array_position(array['DRAFT','APPROVED','PAID'], new.status::text);
  if rank_new < rank_old then
    raise exception 'a payroll run does not go back from % to %', old.status, new.status
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger payroll_run_moves_forward
  before update on ops_hr.payroll_runs
  for each row execute function ops_hr.payroll_run_moves_forward();

-- ── the rule left open in 0040 ────────────────────────────────────────────
--
-- `0040` could only enforce half of D173: a version may not be back-dated. The
-- other half — a version may not land **inside a run's period** — needed
-- `payroll_runs`, which did not exist yet. The payroll picks the rule in force
-- when the period *opened*, so a version dated mid-period would look applied
-- on the screen and change nothing in the figures, which is the worst of the
-- three possible behaviours.
create or replace function ops_hr.pay_rules_not_backdated()
returns trigger
language plpgsql set search_path = ops_hr, pg_temp as $$
declare clash text;
begin
  if new.effective_from < current_date then
    raise exception 'a pay rule takes effect today at the earliest, not %', new.effective_from
      using errcode = 'check_violation';
  end if;

  select run_no into clash
    from ops_hr.payroll_runs
   where new.effective_from > period_start
     and new.effective_from <= period_end
   limit 1;

  if clash is not null then
    raise exception 'run % already covers %; a rule version lands between periods, never inside one', clash, new.effective_from
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

-- ── what can be derived without the timesheet ─────────────────────────────
--
-- `v_payroll_line` — the gross figure per person — is deliberately NOT here.
-- It needs `v_timesheet_day`: the six slots a day's taps are read into, the
-- break allowance per schedule, and the rule book's overtime tiers. That is
-- ~140 lines of TypeScript to transcribe and `01-schema.md` already says HR's
-- payroll view is a migration of its own. Writing a partial one that returns a
-- number would be worse than none: a gross figure missing its overtime is
-- still a number somebody can read off a screen.
--
-- These two are the parts that stand on their own.

-- Approved overtime falling inside a run's period, per person. "Twice-approved"
-- is what `payable` means for a production sheet — HRD and leadership both.
create or replace view ops_hr.v_payroll_overtime as
select
  r.run_no,
  l.employee_id,
  e.employee_no,
  e.full_name,
  sum(l.hours)::numeric                                       as overtime_hours,
  sum(coalesce(l.form_amount, 0))::numeric                    as form_amount_total,
  count(*) filter (where l.form_amount is null)::int          as lines_without_form_amount
from ops_hr.payroll_runs r
join ops_hr.v_overtime_claim c
  on c.payable and c.work_date between r.period_start and r.period_end
join ops_hr.overtime_lines l on l.sheet_id = c.id
join ops_hr.employees e      on e.id = l.employee_id
group by r.run_no, l.employee_id, e.employee_no, e.full_name;

-- The run, with the two figures that do not need the timesheet: what people
-- moved by hand, and what is still sitting unapproved in the period it covers.
create or replace view ops_hr.v_payroll_run as
select
  r.id,
  r.run_no,
  r.period_start,
  r.period_end,
  r.status,
  r.paid_trx_no,
  coalesce(adj.total, 0)::numeric        as adjustment_total,
  coalesce(adj.rows_n, 0)::int           as adjustment_rows,
  coalesce(ot.approved_hours, 0)::numeric as approved_overtime_hours,
  coalesce(ot.pending_hours, 0)::numeric  as pending_overtime_hours
from ops_hr.payroll_runs r
left join lateral (
  select sum(a.amount) as total, count(*) as rows_n
    from ops_hr.payroll_adjustments a
   where a.run_no = r.run_no
) adj on true
left join lateral (
  select
    sum(c.hours) filter (where c.payable) as approved_hours,
    -- The waiting stages, named. Not `not payable and not declined`: a staff
    -- sheet HRD turned off is `unpaid`, which is a decision and not a queue,
    -- and a negative definition swept it into the figure that tells payroll
    -- what is still outstanding. Listing the three waiting states means a
    -- ninth stage added later cannot land here by default — it has to be put
    -- here on purpose.
    sum(c.hours) filter (where c.stage in ('waiting_hrd','waiting_surat','waiting_leader'))
      as pending_hours
    from ops_hr.v_overtime_claim c
   where c.work_date between r.period_start and r.period_end
) ot on true;

-- ── access ────────────────────────────────────────────────────────────────
alter table ops_hr.payroll_runs        enable row level security;
alter table ops_hr.payroll_adjustments enable row level security;

create policy runs_read on ops_hr.payroll_runs for select to authenticated
  using (ops_core.has_permission('payroll.read'));
create policy runs_new  on ops_hr.payroll_runs for insert to authenticated
  with check (ops_core.has_permission('payroll.run'));
create policy runs_edit on ops_hr.payroll_runs for update to authenticated
  using (ops_core.has_permission('payroll.run')) with check (ops_core.has_permission('payroll.run'));

-- An adjustment is payroll's, not HRD's: it moves money on a payslip. HRD
-- reads it, because HRD is who the person asks about it.
create policy adj_read  on ops_hr.payroll_adjustments for select to authenticated
  using (ops_core.has_permission('payroll.read') or ops_core.has_permission('hrd.read'));
create policy adj_new   on ops_hr.payroll_adjustments for insert to authenticated
  with check (ops_core.has_permission('payroll.run'));
create policy adj_edit  on ops_hr.payroll_adjustments for update to authenticated
  using (ops_core.has_permission('payroll.run')) with check (ops_core.has_permission('payroll.run'));

alter view ops_hr.v_payroll_overtime set (security_invoker = on);
alter view ops_hr.v_payroll_run      set (security_invoker = on);

grant select on all tables in schema ops_hr to authenticated;
grant insert, update on ops_hr.payroll_runs, ops_hr.payroll_adjustments to authenticated;
