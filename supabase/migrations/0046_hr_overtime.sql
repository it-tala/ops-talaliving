-- 0046_hr_overtime.sql — two shapes of night, because the paper has two.
--
-- A **production** sheet is checked by HRD, has its signed form attached, and
-- is then signed by leadership. Nothing is paid until all three (D145, D146).
-- A **staff** sheet is HRD's alone and ships `paid`: the person already stayed
-- and their report is attached, so the decision HRD takes is whether to turn
-- it off, not whether to turn it on.
--
-- Where a sheet has got to is never a column beside the signatures. It is
-- derived from them and from the attached paper, so a status cannot disagree
-- with what is under it (A3) — `v_overtime_stage` below.

create table ops_hr.overtime_sheets (
  id                  uuid primary key default gen_random_uuid(),
  sheet_no            text not null unique default ops_core.next_doc_number('lbr'),
  kind                ops_hr.overtime_kind_t not null,
  -- One sheet, one night. The paper form is a night's worth of names.
  work_date           date not null,
  purpose             text,
  hrd_checked_by      uuid references ops_core.users(id),
  hrd_checked_at      timestamptz,
  -- Production only. A staff session never waits on leadership (D146).
  leader_approved_by  uuid references ops_core.users(id),
  leader_approved_at  timestamptz,
  -- Ships true. Turning it off is a decision, and a decision says why.
  paid                boolean not null default true,
  unpaid_reason       text,
  declined_by         uuid references ops_core.users(id),
  declined_reason     text,
  created_by          uuid references ops_core.users(id),
  created_at          timestamptz not null default now(),

  -- Leadership signs **after** HRD, not instead of it (D145). Without this the
  -- two signatures are independent and a sheet can be approved by somebody who
  -- never saw the hours checked.
  constraint leader_signs_after_hrd
    check (leader_approved_at is null or hrd_checked_at is not null),
  -- A staff session never reaches leadership at all (D146).
  constraint staff_needs_no_leader
    check (kind <> 'staff' or leader_approved_at is null),
  -- Turning off a default-paid session says why.
  constraint unpaid_says_why
    check (paid or (unpaid_reason is not null and length(btrim(unpaid_reason)) > 0)),
  -- A signature is a person and a moment together, or it is neither.
  constraint hrd_sig_complete
    check ((hrd_checked_at is null) = (hrd_checked_by is null)),
  constraint leader_sig_complete
    check ((leader_approved_at is null) = (leader_approved_by is null)),
  constraint decline_complete
    check ((declined_reason is null) = (declined_by is null))
);

create index ot_sheets_date_idx on ops_hr.overtime_sheets (work_date);

create table ops_hr.overtime_lines (
  id           uuid primary key default gen_random_uuid(),
  sheet_id     uuid not null references ops_hr.overtime_sheets(id),
  employee_id  uuid not null references ops_hr.employees(id),
  hours        numeric not null check (hours > 0),
  task         text,
  -- Production: the work order these hours advanced, as a public code and
  -- validated at the seam, never as a uuid across a service boundary
  -- (ADR-004).
  wo_no        text,
  stage        text,
  qty_done     numeric check (qty_done is null or qty_done >= 0),
  -- The GAJI column of the paper form (D154). Nullable on purpose: most nights
  -- have no figure written on them, and a nought here would read as *worked
  -- for free* rather than *not stated*.
  form_amount  numeric check (form_amount is null or form_amount >= 0),

  -- One line per person per sheet. A second entry for the same night is a
  -- second sheet, not a second row.
  constraint one_line_per_person unique (sheet_id, employee_id),
  -- A production line names the stage it advanced (D147): hours against a work
  -- order that cannot say which step they moved are hours nobody can post.
  constraint wo_names_its_stage
    check (wo_no is null or (stage is not null and length(btrim(stage)) > 0))
);

create index ot_lines_emp_idx on ops_hr.overtime_lines (employee_id);

-- ── where a sheet has got to ──────────────────────────────────────────────
--
-- Transcribed from `overtimeStage` in `src/demo/hr-derive.ts`, including the
-- order of the tests: a declined sheet is declined whatever else is true of
-- it, and the staff branch is taken before any signature is looked at.
--
-- The production branch is the one that earns the enum's eight values. Between
-- *HRD has checked it* and *leadership has signed it* sits a state that is
-- neither, and it is the one HRD acts on: `waiting_surat` means the hours are
-- agreed and the signed paper is not attached yet. Collapsing it into
-- `waiting_leader` would put a sheet in leadership's queue that leadership
-- cannot act on.
create or replace view ops_hr.v_overtime_stage as
select
  s.id,
  s.sheet_no,
  s.kind,
  s.work_date,
  (case
     when s.declined_reason is not null then 'declined'
     when s.kind = 'staff' then
       case when not s.paid                    then 'unpaid'
            when s.hrd_checked_at is not null  then 'paid_checked'
            else                                    'paid_default' end
     when s.hrd_checked_at is null              then 'waiting_hrd'
     when s.leader_approved_at is not null      then 'approved'
     when surat.entity_no is not null           then 'waiting_leader'
     else                                            'waiting_surat'
   end)::ops_hr.overtime_stage_t as stage
from ops_hr.overtime_sheets s
left join lateral (
  -- The signed form, on the same evidence road as every nota and receiving
  -- photo (ADR-010). A live link only: withdrawing the paper must put the
  -- sheet back in front of HRD.
  select l.entity_no
    from ops_core.attachment_links l
   where l.entity = 'overtime_sheet'
     and l.entity_no = s.sheet_no
     and l.kind = 'surat_lembur'
     and l.unlinked_at is null
   limit 1
) surat on true;

-- Do these hours reach a payslip as things stand, and how many are there.
create or replace view ops_hr.v_overtime_claim as
select
  v.id,
  v.sheet_no,
  v.kind,
  v.work_date,
  v.stage,
  v.stage in ('approved','paid_default','paid_checked') as payable,
  coalesce(sum(l.hours), 0)::numeric as hours,
  count(l.id)::int                   as people
from ops_hr.v_overtime_stage v
left join ops_hr.overtime_lines l on l.sheet_id = v.id
group by v.id, v.sheet_no, v.kind, v.work_date, v.stage;

-- ── access ────────────────────────────────────────────────────────────────
alter table ops_hr.overtime_sheets enable row level security;
alter table ops_hr.overtime_lines  enable row level security;

create policy ot_sheets_read on ops_hr.overtime_sheets for select to authenticated
  using (ops_core.has_permission('hrd.read') or ops_core.has_permission('payroll.read'));
create policy ot_sheets_new  on ops_hr.overtime_sheets for insert to authenticated
  with check (ops_core.has_permission('hrd.create'));
-- HRD updates a sheet; leadership's signature is an authority, asked with its
-- own function so a module level can never answer it by accident.
create policy ot_sheets_edit on ops_hr.overtime_sheets for update to authenticated
  using (ops_core.has_permission('hrd.update') or ops_core.has_authority('approve_overtime'))
  with check (ops_core.has_permission('hrd.update') or ops_core.has_authority('approve_overtime'));

create policy ot_lines_read on ops_hr.overtime_lines for select to authenticated
  using (ops_core.has_permission('hrd.read') or ops_core.has_permission('payroll.read'));
create policy ot_lines_write on ops_hr.overtime_lines for all to authenticated
  using (ops_core.has_permission('hrd.update')) with check (ops_core.has_permission('hrd.create'));

alter view ops_hr.v_overtime_stage set (security_invoker = on);
alter view ops_hr.v_overtime_claim set (security_invoker = on);

grant select on all tables in schema ops_hr to authenticated;
grant insert, update on ops_hr.overtime_sheets, ops_hr.overtime_lines to authenticated;
