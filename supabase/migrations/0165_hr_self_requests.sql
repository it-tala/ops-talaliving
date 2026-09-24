-- 0165_hr_self_requests.sql — asking for overtime pay and asking for leave,
-- from the person the ask is about.
--
-- ── overtime: a fourth road onto a table that already has three ──────────
--
-- `create_overtime_sheet` + `add_overtime_line` is HRD keying a night's paper
-- form (D154). What is missing is the road the form itself started from: the
-- person staying late reporting it before HRD ever sees paper. This is a new
-- seam rather than a widened one because `overtime_lines` has no "which
-- fields may a non-HRD caller set" boundary yet, and a single function that
-- inserts exactly one line for exactly the caller is that boundary made
-- concrete — the same shape `tap_self` and `acknowledge_task` already are.
--
-- It ships `kind = 'staff'`, which is D146's own rule and not a new one: a
-- staff session never needed leadership, only HRD's decision on whether to
-- turn `paid` off. Evidence — *bukti tangkapan layar dan hasil kerja* — is
-- deliberately not a column here. `laporan_lembur` already exists as a
-- document kind (`0001`) and `attach_url`/`attach_file` + `attach_link` are
-- already callable by any authenticated person (`0024`'s grants say so) —
-- the screenshot is a file like every other file in this system, attached
-- from the record it belongs to (ADR-010), never a base64 blob living beside
-- the hours. `result_note` is the one new column, because "hasil kerja" is a
-- sentence HRD reads to decide whether the night was worth paying for, and a
-- sentence is not evidence — it is the claim the evidence is attached to.
--
-- ── leave: one function learns a second way to resolve "who" ─────────────
--
-- `request_leave` already exists and is already live. The HRD path — an
-- explicit `p_employee_no`, gated on `hrd.create` — is untouched, in the
-- exact order it ran in before: permission checked before the name is even
-- looked up, so a caller with no HRD access learns nothing about whether an
-- employee number exists. The new branch fires only when `p_employee_no` is
-- omitted, and resolves to the caller's own linked employee instead — the
-- same `my_employee_id()` gate as everything else in this file. Passing your
-- own employee number explicitly still takes the HRD branch and is refused
-- for someone without `hrd.create`; the screen this is built for simply never
-- sends one.
--
-- `decide_leave` is untouched. Asking and deciding stay two different
-- authorities held by two different people, same as before — a person can
-- ask for their own leave and can never approve it.

alter table ops_hr.overtime_lines add column result_note text;
comment on column ops_hr.overtime_lines.result_note is
  'What was actually done during the overtime. Read by HRD when deciding whether the night is paid — the sentence the attached evidence backs up, not the evidence itself.';

/* Own overtime, by the same link-through-the-line shape `employees_read_own`
   already uses to reach through `v_task`'s join (0152). Reading the sheet
   without the line would show an empty screen for exactly the person it is
   meant to serve. */
create policy ot_lines_read_own on ops_hr.overtime_lines for select to authenticated
  using (employee_id = ops_hr.my_employee_id());

create policy ot_sheets_read_own on ops_hr.overtime_sheets for select to authenticated
  using (exists (
    select 1 from ops_hr.overtime_lines l
     where l.sheet_id = overtime_sheets.id and l.employee_id = ops_hr.my_employee_id()
  ));

create or replace function ops_hr.report_overtime_self(
  p_work_date date, p_hours numeric, p_result_note text,
  p_task text default null, p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare
  v_replayed jsonb; v_emp uuid; v_sheet_id uuid; v_sheet_no text; v_res jsonb;
begin
  v_replayed := ops_core.idem_replay('hr','report_overtime_self', p_key);
  if v_replayed is not null then return v_replayed; end if;

  v_emp := ops_hr.my_employee_id();
  if v_emp is null then
    return ops_core.refused('hr','overtime_sheet', null,'report_self',
      'no_employee_link',
      'Akun ini belum tertaut ke data karyawan, jadi lembur tidak bisa diajukan sendiri. Minta HRD menautkannya.');
  end if;
  if p_work_date is null then
    return ops_core.invalid('hr','overtime_sheet', null,'report_self',
      'work_date_required','Lembur tanggal berapa?', jsonb_build_object('field','work_date'));
  end if;
  if p_work_date > ops_core.office_day() then
    return ops_core.invalid('hr','overtime_sheet', null,'report_self',
      'date_in_future',
      'Lembur diajukan untuk malam yang sudah dijalani, bukan yang akan datang.',
      jsonb_build_object('field','work_date'));
  end if;
  if p_hours is null or p_hours <= 0 or p_hours > 12 then
    return ops_core.invalid('hr','overtime_sheet', null,'report_self',
      'hours_out_of_range','Durasi lembur ditulis dalam jam, lebih dari nol dan sampai 12.',
      jsonb_build_object('field','hours'));
  end if;
  if coalesce(btrim(coalesce(p_result_note,'')),'') = '' then
    return ops_core.invalid('hr','overtime_sheet', null,'report_self',
      'result_required',
      'Apa yang dikerjakan selama lembur ini? HRD memutuskan dari kalimat ini, bukan dari jam saja.',
      jsonb_build_object('field','result_note'));
  end if;

  -- One self-reported sheet per person per night. A second report for the
  -- same night is a correction to the first, not a second claim on it — the
  -- person edits by asking HRD, the same as any other figure in this system
  -- that only a decision may change (A2).
  if exists (
    select 1 from ops_hr.overtime_sheets s
      join ops_hr.overtime_lines l on l.sheet_id = s.id
     where s.kind = 'staff' and s.work_date = p_work_date
       and l.employee_id = v_emp and s.declined_reason is null
  ) then
    return ops_core.conflict('hr','overtime_sheet', null,'report_self',
      'already_reported', format('Lembur tanggal %s sudah pernah diajukan.', p_work_date));
  end if;

  insert into ops_hr.overtime_sheets (kind, work_date, purpose, created_by)
  values ('staff', p_work_date, 'Diajukan sendiri lewat profil', auth.uid())
  returning id, sheet_no into v_sheet_id, v_sheet_no;

  insert into ops_hr.overtime_lines (sheet_id, employee_id, hours, task, result_note)
  values (v_sheet_id, v_emp, p_hours, nullif(btrim(coalesce(p_task,'')),''), btrim(p_result_note));

  perform ops_core.record_activity_event('overtime_requested','overtime_sheet',
    format('Mengajukan lembur %s jam pada %s', p_hours, p_work_date));

  v_res := ops_core.ok('hr','overtime_sheet', v_sheet_no,'report_self',
    jsonb_build_object('sheet_no', v_sheet_no, 'work_date', p_work_date,
                       'hours', p_hours, 'via','self'),
    null,
    jsonb_build_object('via','self','hours', p_hours, 'result_note', btrim(p_result_note)));
  return ops_core.idem_remember('hr','report_overtime_self', p_key, v_res);
end $$;

revoke execute on function ops_hr.report_overtime_self(date, numeric, text, text, text) from public;
grant execute on function ops_hr.report_overtime_self(date, numeric, text, text, text) to authenticated;

/* Own leave requests, and their own quota is already served for free —
   `leave_balances()` is invoker-rights over `ops_hr.employees` (0152's
   `employees_read_own`) and now over `day_marks` (0164's `marks_read_own`);
   the one table in that chain with no self policy yet is this one, needed
   for the `future`/`booked` half of the balance and for the request list
   itself. */
create policy leave_read_own on ops_hr.leave_requests for select to authenticated
  using (employee_id = ops_hr.my_employee_id());

create or replace function ops_hr.request_leave(
  p_employee_no text, p_kind ops_hr.leave_kind_t,
  p_from date, p_to date, p_reason text, p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare
  v_replayed jsonb; emp ops_hr.employees%rowtype; v_no text; v_res jsonb; v_clash text;
  v_via text;
begin
  v_replayed := ops_core.idem_replay('hr','request_leave', p_key);
  if v_replayed is not null then return v_replayed; end if;

  if coalesce(btrim(coalesce(p_employee_no,'')), '') = '' then
    -- Self-service path: no permission needed beyond the account-to-employee
    -- link, the same gate every other self seam in this build uses.
    v_via := 'self';
    select * into emp from ops_hr.employees where id = ops_hr.my_employee_id();
    if not found then
      return ops_core.refused('hr','leave_request', null,'request',
        'no_employee_link',
        'Akun ini belum tertaut ke data karyawan, jadi cuti/izin tidak bisa diajukan sendiri. Minta HRD menautkannya.');
    end if;
  else
    -- HRD path, byte-for-byte the check order this function has always had:
    -- permission before the name is even looked up, so a caller without
    -- `hrd.create` learns nothing about whether that employee number exists.
    v_via := 'hrd';
    if not ops_core.has_permission('hrd.create') then
      return ops_core.refused('hr','leave_request', null,'request',
        'not_permitted','Mengajukan cuti untuk orang lain butuh akses HRD.');
    end if;
    select * into emp from ops_hr.employees where employee_no = p_employee_no;
    if not found then
      return ops_core.not_found('hr','leave_request', p_employee_no,'request',
        format('Tidak ada karyawan %s.', p_employee_no));
    end if;
  end if;

  if p_to < p_from then
    return ops_core.invalid('hr','leave_request', null,'request',
      'range_invalid','Tanggal selesai mendahului tanggal mulai.',
      jsonb_build_object('field','to_date'));
  end if;
  if coalesce(btrim(p_reason),'') = '' then
    return ops_core.invalid('hr','leave_request', null,'request',
      'reason_required','Tulis alasannya — itu yang dibaca saat diputuskan.',
      jsonb_build_object('field','reason'));
  end if;

  select request_no into v_clash from ops_hr.leave_requests
   where employee_id = emp.id and status in ('PENDING','APPROVED')
     and from_date <= p_to and to_date >= p_from
   limit 1;
  if v_clash is not null then
    return ops_core.conflict('hr','leave_request', null,'request',
      'overlaps_existing',
      format('%s sudah menutupi tanggal itu untuk orang yang sama.', v_clash));
  end if;

  insert into ops_hr.leave_requests
    (employee_id, kind, from_date, to_date, reason, requested_by)
  values (emp.id, p_kind, p_from, p_to, btrim(p_reason), auth.uid())
  returning request_no into v_no;

  if v_via = 'self' then
    perform ops_core.record_activity_event('leave_requested','leave_request',
      format('Mengajukan %s %s s/d %s', p_kind, p_from, p_to));
  end if;

  v_res := ops_core.ok('hr','leave_request', v_no,'request',
    jsonb_build_object('request_no', v_no, 'employee_no', emp.employee_no,
                       'kind', p_kind, 'from_date', p_from, 'to_date', p_to, 'via', v_via),
    null,
    jsonb_build_object('via', v_via, 'employee', emp.employee_no, 'kind', p_kind,
                       'from', p_from, 'to', p_to, 'reason', btrim(p_reason)));
  return ops_core.idem_remember('hr','request_leave', p_key, v_res);
end $$;
