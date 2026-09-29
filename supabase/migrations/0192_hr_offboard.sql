-- 0192 — offboarding somebody, and a biometric file that never refuses the people it knows (D337).
--
-- ── what was missing ──────────────────────────────────────────────────────
--
-- `employees.active` and `left_on` have existed since 0043, and every reader
-- already honours them — payroll, the timesheet and the KPI take `e.active or
-- e.left_on >= period_start`, so a leaver stays on every period they worked.
-- But **nothing wrote them**. `save_employee` never touches either column, so
-- the only way to say *Padi left on 11 September* was SQL, and HRD's list of
-- people kept growing with nobody ever leaving it.
--
-- ── offboard_employee / reinstate_employee ───────────────────────────────
--
-- Offboarding is a date and a sentence. The row stays (A5): a payslip from
-- March is still a fact in June, and a tap already on file is never deleted.
-- The reason goes on the audit row, because *why did Roni stop being paid* is
-- asked months later by someone who was not in the room.
--
-- Reinstating is the undo, for the wrong person or the wrong date, and for the
-- worker who comes back. It says why too.
--
-- ── import_scans: the file is never refused for the people it does not know ─
--
-- The owner's instruction (D337): *kalau di file biometrik ada karyawan yang
-- tidak terdata, tetap masukkan yang ada saja*. The import already skipped
-- unknown machine numbers rather than failing; two things are added.
--
--   1. **A tap after somebody left is set aside, not filed.** The machine keeps
--      a leaver's fingerprint until someone deletes it, and the September file
--      carries taps for two numbers the payroll ended in July. Filing them
--      would put a leaver back on a timesheet; refusing the file would lose
--      everybody else's week. They are counted and named in `after_left`, the
--      same way unknown numbers are, so HRD sees *113 · MIFTAH · keluar
--      2026-07-03 · 5 tap* and can decide whether the number was reused. The
--      day compared is the **working** day (`shift_day`, 0186): a guard's night
--      that began on his last day ends the next morning and still counts.
--
--   2. **Matching forgives leading zeros and a letter prefix on both sides.**
--      0053 stripped `B-00` from the stored number and zeros from the file's,
--      so an employee typed as `019` never matched the machine's `19`. Both
--      sides are now reduced to the bare number the machine prints.
--
-- Nothing else in the import moves: re-uploading still adds nothing, unknown
-- numbers are still reported and never created (D143).

-- ── 1. where the import says what it set aside ───────────────────────────
alter table ops_hr.attendance_imports
  add column if not exists after_left_refs jsonb not null default '[]'::jsonb;

comment on column ops_hr.attendance_imports.after_left_refs is
  'Taps for somebody whose left_on is before the tap''s working day: set aside, not filed, and named '
  'with the date they left so a reused machine number can be spotted (D337). (0192)';

-- ── 2. the bare machine number ────────────────────────────────────────────
-- `B-0012`, `012` and `12` are the same finger. Empty stays empty rather than
-- becoming a match for every other empty.
create or replace function ops_hr.machine_no(p_no text)
returns text
language sql immutable set search_path = pg_temp as $$
  select case
           when x.s = '' then null
           when x.s ~ '^[0-9]+$' then coalesce(nullif(ltrim(x.s, '0'), ''), '0')
           else x.s
         end
    from (select regexp_replace(btrim(coalesce(p_no, '')), '^[A-Za-z]+-', '') as s) x
$$;

revoke all on function ops_hr.machine_no(text) from public;
grant execute on function ops_hr.machine_no(text) to authenticated;

-- ── 3. offboarding ───────────────────────────────────────────────────────
create or replace function ops_hr.offboard_employee(
  p_employee_no text,
  p_left_on     date,
  p_reason      text,
  p_key         text default null)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare
  v_replayed jsonb; v_emp ops_hr.employees; v_left date; v_after int; v_res jsonb;
begin
  v_replayed := ops_core.idem_replay('hr','offboard_employee', p_key);
  if v_replayed is not null then return v_replayed; end if;

  if not ops_core.has_permission('hrd.update') then
    return ops_core.refused('hr','employee', p_employee_no,'offboard',
      'not_permitted','Mengeluarkan karyawan butuh akses HRD.');
  end if;
  if coalesce(btrim(coalesce(p_reason,'')), '') = '' then
    return ops_core.invalid('hr','employee', p_employee_no,'offboard',
      'reason_required',
      'Tulis alasannya — resign, kontrak selesai, tidak kembali. Yang keluar tanpa kalimat tidak bisa dijelaskan saat slip gajinya ditanyakan.',
      jsonb_build_object('field','reason'));
  end if;

  select e.* into v_emp from ops_hr.employees e where e.employee_no = btrim(coalesce(p_employee_no,''));
  if not found then
    return ops_core.not_found('hr','employee', p_employee_no,'offboard',
      format('Tidak ada karyawan %s.', p_employee_no));
  end if;
  if not v_emp.active then
    return ops_core.conflict('hr','employee', v_emp.employee_no,'offboard',
      'already_left',
      format('%s sudah keluar per %s.', v_emp.full_name, coalesce(v_emp.left_on::text, '—')));
  end if;

  v_left := coalesce(p_left_on, ops_core.office_day());
  if v_emp.joined_on is not null and v_left < v_emp.joined_on then
    return ops_core.invalid('hr','employee', v_emp.employee_no,'offboard',
      'left_before_joined',
      format('Tanggal keluar %s sebelum tanggal masuknya (%s). Kalau tanggal masuknya yang salah, betulkan dulu di data karyawan.',
             v_left, v_emp.joined_on),
      jsonb_build_object('field','left_on'));
  end if;

  -- Taps after the last day are kept — they are what the machine saw — and
  -- counted, so a date set too early is noticed now rather than on a payslip.
  select count(*)::int into v_after from ops_hr.attendance_scans s
   where s.employee_id = v_emp.id and ops_hr.shift_day(s.employee_id, s.at) > v_left;

  update ops_hr.employees
     set active = false, left_on = v_left, updated_at = now()
   where id = v_emp.id;

  v_res := ops_core.ok('hr','employee', v_emp.employee_no,'offboard',
    jsonb_build_object('employee_no', v_emp.employee_no, 'full_name', v_emp.full_name,
                       'left_on', v_left, 'taps_after', v_after),
    jsonb_build_object('active', true, 'left_on', null),
    jsonb_build_object('active', false, 'left_on', v_left,
                       'reason', btrim(p_reason), 'taps_after', v_after));
  return ops_core.idem_remember('hr','offboard_employee', p_key, v_res);
end $$;

create or replace function ops_hr.reinstate_employee(
  p_employee_no text,
  p_reason      text,
  p_key         text default null)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare v_replayed jsonb; v_emp ops_hr.employees; v_res jsonb;
begin
  v_replayed := ops_core.idem_replay('hr','reinstate_employee', p_key);
  if v_replayed is not null then return v_replayed; end if;

  if not ops_core.has_permission('hrd.update') then
    return ops_core.refused('hr','employee', p_employee_no,'reinstate',
      'not_permitted','Mengaktifkan kembali karyawan butuh akses HRD.');
  end if;
  if coalesce(btrim(coalesce(p_reason,'')), '') = '' then
    return ops_core.invalid('hr','employee', p_employee_no,'reinstate',
      'reason_required',
      'Tulis alasannya — salah orang, salah tanggal, atau kembali bekerja.',
      jsonb_build_object('field','reason'));
  end if;

  select e.* into v_emp from ops_hr.employees e where e.employee_no = btrim(coalesce(p_employee_no,''));
  if not found then
    return ops_core.not_found('hr','employee', p_employee_no,'reinstate',
      format('Tidak ada karyawan %s.', p_employee_no));
  end if;
  if v_emp.active then
    return ops_core.conflict('hr','employee', v_emp.employee_no,'reinstate',
      'already_active', format('%s masih aktif.', v_emp.full_name));
  end if;

  update ops_hr.employees
     set active = true, left_on = null, updated_at = now()
   where id = v_emp.id;

  v_res := ops_core.ok('hr','employee', v_emp.employee_no,'reinstate',
    jsonb_build_object('employee_no', v_emp.employee_no, 'full_name', v_emp.full_name),
    jsonb_build_object('active', false, 'left_on', v_emp.left_on),
    jsonb_build_object('active', true, 'left_on', null, 'reason', btrim(p_reason)));
  return ops_core.idem_remember('hr','reinstate_employee', p_key, v_res);
end $$;

revoke all on function ops_hr.offboard_employee(text, date, text, text) from public;
revoke all on function ops_hr.reinstate_employee(text, text, text) from public;
grant execute on function ops_hr.offboard_employee(text, date, text, text) to authenticated;
grant execute on function ops_hr.reinstate_employee(text, text, text) to authenticated;

-- ── 4. the import ────────────────────────────────────────────────────────
-- 0053's body with the match through `machine_no` and a fourth verdict,
-- `after_left`. Everything else is unchanged, in the same order.
create or replace function ops_hr.import_scans(
  p_filename text,
  p_rows     jsonb,
  p_key      text default null)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare
  v_replayed jsonb;
  v_import   uuid;
  v_seen     int;
  v_added    int;
  v_dup      int;
  v_unknown  jsonb;
  v_left     jsonb;
  v_res      jsonb;
begin
  v_replayed := ops_core.idem_replay('hr','import_scans', p_key);
  if v_replayed is not null then return v_replayed; end if;

  if not ops_core.has_permission('hrd.create') then
    return ops_core.refused('hr','attendance_import', p_filename,'import',
      'not_permitted','Importing attendance needs HR access.');
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    return ops_core.invalid('hr','attendance_import', p_filename,'import',
      'empty_file','That file has no scans in it.', jsonb_build_object('field','rows'));
  end if;

  insert into ops_hr.attendance_imports (filename, imported_by)
  values (p_filename, auth.uid()) returning id into v_import;

  with raw as (
    select
      btrim(coalesce(r ->> 'employee_ref','')) as ref,
      (r ->> 'at')::timestamptz                as at,
      nullif(btrim(coalesce(r ->> 'verify','')), '')   as verify,
      nullif(btrim(coalesce(r ->> 'location','')), '') as location,
      ord
    from jsonb_array_elements(p_rows) with ordinality as t(r, ord)
  ),
  matched as (
    select w.*, e.id as employee_id, e.full_name, e.left_on
      from raw w
      left join ops_hr.employees e
        on ops_hr.machine_no(e.employee_no) = ops_hr.machine_no(w.ref)
  ),
  classified as (
    select m.*,
      case
        when m.employee_id is null then 'unknown'
        when m.left_on is not null
         and ops_hr.shift_day(m.employee_id, m.at) > m.left_on then 'after_left'
        when exists (select 1 from ops_hr.attendance_scans s
                      where s.employee_id = m.employee_id and s.at = m.at) then 'duplicate'
        else 'new'
      end as verdict,
      row_number() over (partition by m.employee_id, m.at order by m.ord) as rn
    from matched m
  ),
  ins as (
    insert into ops_hr.attendance_scans
      (employee_id, work_date, at, verify, location, source, import_id)
    select c.employee_id, ops_core.office_day(c.at), c.at,
           coalesce(c.verify,'FP'), c.location, 'import', v_import
      from classified c where c.verdict = 'new' and c.rn = 1
    returning 1
  )
  select
    count(*)::int,
    (select count(*) from ins)::int,
    count(*) filter (where c.verdict = 'duplicate' or (c.verdict = 'new' and c.rn > 1))::int,
    coalesce((select jsonb_agg(jsonb_build_object('ref', u.ref, 'count', u.n) order by u.ref)
                from (select c2.ref, count(*)::int as n from classified c2
                       where c2.verdict = 'unknown' group by c2.ref) u), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('ref', l.ref, 'name', l.full_name,
                                                  'left_on', l.left_on, 'count', l.n) order by l.ref)
                from (select c3.ref, c3.full_name, c3.left_on, count(*)::int as n from classified c3
                       where c3.verdict = 'after_left' group by 1, 2, 3) l), '[]'::jsonb)
  into v_seen, v_added, v_dup, v_unknown, v_left
  from classified c;

  update ops_hr.attendance_imports
     set rows_seen = v_seen, rows_added = v_added,
         rows_duplicate = v_dup, unknown_refs = v_unknown, after_left_refs = v_left
   where id = v_import;

  perform ops_core.emit('hr','attendance.imported', p_filename,
    jsonb_build_object('filename', p_filename, 'import_id', v_import,
                       'added', v_added, 'unknown', v_unknown, 'after_left', v_left));

  v_res := ops_core.ok('hr','attendance_import', p_filename,'import',
    jsonb_build_object('import_id', v_import, 'seen', v_seen, 'added', v_added,
                       'duplicates', v_dup, 'unknown', v_unknown, 'after_left', v_left));
  return ops_core.idem_remember('hr','import_scans', p_key, v_res);
end $$;

grant execute on function ops_hr.import_scans(text, jsonb, text) to authenticated;

analyze ops_hr.attendance_imports;
