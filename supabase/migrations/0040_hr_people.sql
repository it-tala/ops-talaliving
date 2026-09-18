-- 0040_hr_people.sql — the people, and the rule book their pay is computed under.
--
-- ## Why this starts at 0040 rather than 0023
--
-- Two build sessions are running against one ladder. Accounting and
-- procurement are being taken to production on `main` and own the numbers
-- from `0023`; HR takes `0040` upward. A migration number is a filename, and
-- two sessions choosing the same one is a merge conflict in the one place
-- where the resolution is not obvious — the order the ladder applies in.
-- Leaving a gap costs nothing: `rebuild.sh` applies in lexical order and never
-- asks why 0023 is missing.
--
-- ## What is deliberately not here
--
-- `tasks`, `enrolments` and `contribution_rates` belong to this schema and are
-- absent, because `0001_core_types.sql` has no `contribution_scheme_t`,
-- `task_status_t` or `task_ref_t` in it. Those three enums arrived in the
-- contracts with M50 and M51 and never reached the ladder. They are added with
-- the tables that need them rather than here, so neither migration is a file
-- of loose types waiting for its tables.

create table ops_hr.employees (
  id               uuid primary key default gen_random_uuid(),
  -- The number on the fingerprint reader, and the only key the attendance
  -- export carries. `B-009`, not a uuid: the machine has never heard of us.
  employee_no      text not null unique,
  full_name        text not null,
  position         text,
  unit             text,
  pay_basis        ops_hr.pay_basis_t not null,
  -- POKOK only, per month, day or hour according to `pay_basis` (D250).
  -- Splitting it from the allowance is what makes a missed day cost the right
  -- amount: at full attendance the two together move nobody's total.
  base_rate        bigint not null default 0 check (base_rate >= 0),
  -- TUNJANGAN, per day present, whatever the basis (D250). A day nobody
  -- attended earns none of it, which is the whole reason it is a second field.
  allowance_rate   bigint not null default 0 check (allowance_rate >= 0),
  daily_hours      numeric not null default 8 check (daily_hours > 0),
  joined_on        date,
  -- Per person, because length of service and what was agreed at hiring both
  -- move it, and the owner was explicit that they differ (D144).
  paid_leave_days  int not null default 0 check (paid_leave_days >= 0),
  active           boolean not null default true,
  -- Nobody is deleted: a payslip from March is still a fact in June (A5).
  -- Retiring somebody is this date, and the row stays where every past figure
  -- can still resolve it.
  left_on          date,
  note             text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint left_is_not_active check (left_on is null or not active),
  constraint left_after_joined check (left_on is null or joined_on is null or left_on >= joined_on)
);

create index employees_active_idx on ops_hr.employees (active) where active;

-- ── the rule book ─────────────────────────────────────────────────────────
--
-- The rules are one `jsonb` document rather than forty columns, because the
-- shape changes when a policy gains a step — a third overtime tier, a second
-- grace window — and a schema migration per policy tweak is exactly the
-- deployment this model exists to avoid (D173).
--
-- What is not flexible is the versioning. A row is never updated and never
-- deleted, and a payslip is computed under the version in force when its
-- period opened, so March stays recomputable in June.
create table ops_hr.pay_rule_sets (
  id              uuid primary key default gen_random_uuid(),
  version         int not null unique check (version > 0),
  -- Inclusive, and the period's START is what selects it.
  effective_from  date not null unique,
  -- Required: a pay rule that changed without a sentence is one nobody can
  -- explain to the person whose wage moved.
  note            text not null check (length(btrim(note)) > 0),
  rules           jsonb not null,
  created_by      uuid references ops_core.users(id),
  created_at      timestamptz not null default now()
);

-- Days already worked were worked under a rule somebody could have read at the
-- time, so a version cannot be back-dated.
--
-- A trigger rather than a CHECK, and the difference matters. `check
-- (effective_from >= current_date)` is evaluated again on every restore, so a
-- row that was legal when written stops being legal the moment it is old — and
-- the table becomes one a `pg_restore` cannot reload. A trigger does not fire
-- under `session_replication_role = 'replica'`, which is what a restore runs
-- in, so the rule binds the people writing it and never the backup.
--
-- The design also asks that a version may not land inside an open run's
-- period. That check needs `ops_hr.payroll_runs`, which is a later migration;
-- it belongs with the table it reads, not here as a forward reference.
create or replace function ops_hr.pay_rules_not_backdated()
returns trigger
language plpgsql set search_path = ops_hr, pg_temp as $$
begin
  if new.effective_from < current_date then
    raise exception 'a pay rule takes effect today at the earliest, not %', new.effective_from
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger pay_rules_not_backdated
  before insert on ops_hr.pay_rule_sets
  for each row execute function ops_hr.pay_rules_not_backdated();

-- ── access ────────────────────────────────────────────────────────────────
--
-- The pattern every domain table here follows: read on the module's read
-- permission, insert and update on its create/update permission, **no delete
-- policy and no delete grant** (A2).
alter table ops_hr.employees      enable row level security;
alter table ops_hr.pay_rule_sets  enable row level security;

-- Payroll reads the roll without holding HRD's module: a run that cannot see
-- who is on it is not a run. It is a read, and only a read.
create policy employees_read on ops_hr.employees for select to authenticated
  using (ops_core.has_permission('hrd.read') or ops_core.has_permission('payroll.read'));
create policy employees_new  on ops_hr.employees for insert to authenticated
  with check (ops_core.has_permission('hrd.create'));
create policy employees_edit on ops_hr.employees for update to authenticated
  using (ops_core.has_permission('hrd.update')) with check (ops_core.has_permission('hrd.update'));

-- The book is readable by anybody who can open payroll or HRD — a figure whose
-- rule nobody may read is a figure nobody can check. Writing it is IT's, the
-- same hands that own `/it/aturan-gaji` (D173).
create policy payrules_read on ops_hr.pay_rule_sets for select to authenticated
  using (ops_core.has_permission('hrd.read') or ops_core.has_permission('payroll.read'));
create policy payrules_new  on ops_hr.pay_rule_sets for insert to authenticated
  with check (ops_core.has_permission('it.update'));
-- No update policy and no update grant: a version is written once (D173).

grant usage on schema ops_hr to authenticated;
grant select on all tables in schema ops_hr to authenticated;
grant insert, update on ops_hr.employees to authenticated;
grant insert on ops_hr.pay_rule_sets to authenticated;
