-- 0041_hr_attendance.sql — the taps, and the marks that are not taps.
--
-- Two kinds of statement about a day, kept apart on purpose (D142). A scan is
-- evidence with a machine behind it; a mark is a decision with a person behind
-- it. Neither overrides the other and neither is rewritten to express the
-- other, because destroying either loses the only record of what happened.

create table ops_hr.attendance_imports (
  id             uuid primary key default gen_random_uuid(),
  filename       text not null,
  rows_seen      int not null default 0 check (rows_seen >= 0),
  rows_added     int not null default 0 check (rows_added >= 0),
  rows_duplicate int not null default 0 check (rows_duplicate >= 0),
  -- Machine numbers nobody is registered under. Kept rather than dropped: an
  -- unknown reference is usually a new hire HRD has not entered yet, and a
  -- silent skip is how somebody works a month for nothing.
  unknown_refs   jsonb not null default '[]'::jsonb,
  imported_by    uuid not null references ops_core.users(id),
  imported_at    timestamptz not null default now(),
  constraint counts_add_up check (rows_added + rows_duplicate <= rows_seen)
);

-- One row per **tap**, not one per day (D141).
--
-- The real export is a stream of moments — four on a good day, six with
-- lembur, and 48 days out of 227 that are neither (F40). A `check_in` /
-- `check_out` pair cannot hold that file without discarding the rows somebody
-- has to look at. The six slots are computed on read, never stored.
create table ops_hr.attendance_scans (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid not null references ops_hr.employees(id),
  -- The office day this tap belongs to, in WITA — not UTC and not the
  -- browser's (F17, F39). `ops_core.office_day()` is what computes it.
  work_date     date not null,
  at            timestamptz not null,
  -- Carried verbatim from the machine. We do not interpret it; it is the only
  -- thing that distinguishes a face scan from a finger on a bad morning.
  verify        text,
  location      text,
  source        ops_hr.scan_source_t not null default 'import',
  import_id     uuid references ops_hr.attendance_imports(id),
  -- A time somebody typed says why the machine missed it (D137).
  reason        text,
  recorded_by   uuid references ops_core.users(id),
  recorded_at   timestamptz not null default now(),
  -- Re-uploading the same export is a no-op. A tap is who and when, to the
  -- second (D143).
  constraint scan_once unique (employee_id, at),
  constraint manual_says_why check (source <> 'manual' or (reason is not null and length(btrim(reason)) > 0)),
  constraint import_scan_has_import check (source <> 'import' or import_id is not null)
);

create index scans_day_idx on ops_hr.attendance_scans (employee_id, work_date);

-- ── the marks ─────────────────────────────────────────────────────────────
--
-- `mark_no` is not in the design's diagram, and building the evidence road
-- found that it has to be. A `Surat Dokter` is linked through
-- `ops_core.attachment_links`, whose `entity_no` is a **public code, never a
-- uuid** (ADR-004) — so a mark that can be paid has to have one. The demo
-- links on the fixture's own id (`dmk_03`), which is a public code there and a
-- uuid here; the prefix below is what makes the same road work against a
-- database. `rcv` was added to `doc_prefixes` for exactly this reason, and the
-- comment there says why: a prefix nobody has registered is a number nobody
-- recognises.
insert into ops_core.doc_prefixes (prefix, what) values ('dmk', 'day mark');

create table ops_hr.day_marks (
  id           uuid primary key default gen_random_uuid(),
  mark_no      text not null unique default ops_core.next_doc_number('dmk'),
  -- NULL means the whole office: a public holiday is not marked person by
  -- person, and writing it 60 times would make removing it 60 decisions.
  employee_id  uuid references ops_hr.employees(id),
  work_date    date not null,
  kind         ops_hr.day_mark_t not null,
  -- *setengah hari* with no reason is a decision nobody can check in six
  -- months (D142).
  reason       text not null check (length(btrim(reason)) > 0),
  marked_by    uuid not null references ops_core.users(id),
  marked_at    timestamptz not null default now(),
  -- One mark per person per day, and one office-wide mark per day. Postgres
  -- treats NULLs as distinct by default, which would let the same holiday be
  -- declared any number of times.
  constraint mark_once unique nulls not distinct (work_date, employee_id),
  -- An office-wide mark is a holiday or nothing. *sakit* for everybody is not
  -- a thing that happens; it is a mis-click that silently pays a whole day.
  constraint office_wide_is_holiday check (employee_id is not null or kind = 'holiday')
);

create index marks_day_idx on ops_hr.day_marks (work_date);
create index marks_emp_idx on ops_hr.day_marks (employee_id, work_date);

-- ── access ────────────────────────────────────────────────────────────────
alter table ops_hr.attendance_imports enable row level security;
alter table ops_hr.attendance_scans   enable row level security;
alter table ops_hr.day_marks          enable row level security;

create policy imports_read on ops_hr.attendance_imports for select to authenticated
  using (ops_core.has_permission('hrd.read'));
create policy imports_new  on ops_hr.attendance_imports for insert to authenticated
  with check (ops_core.has_permission('hrd.create'));

-- Payroll reads the taps for the same reason it reads the roll: the days are
-- the figure. It never writes one.
create policy scans_read on ops_hr.attendance_scans for select to authenticated
  using (ops_core.has_permission('hrd.read') or ops_core.has_permission('payroll.read'));
create policy scans_new  on ops_hr.attendance_scans for insert to authenticated
  with check (ops_core.has_permission('hrd.create'));
-- No update policy: a tap is not edited. A wrong one is answered with a manual
-- scan that says why, beside it (D137, A5).

create policy marks_read on ops_hr.day_marks for select to authenticated
  using (ops_core.has_permission('hrd.read') or ops_core.has_permission('payroll.read'));
create policy marks_new  on ops_hr.day_marks for insert to authenticated
  with check (ops_core.has_permission('hrd.create'));
create policy marks_edit on ops_hr.day_marks for update to authenticated
  using (ops_core.has_permission('hrd.update')) with check (ops_core.has_permission('hrd.update'));

grant select on all tables in schema ops_hr to authenticated;
grant insert on ops_hr.attendance_imports, ops_hr.attendance_scans to authenticated;
grant insert, update on ops_hr.day_marks to authenticated;
