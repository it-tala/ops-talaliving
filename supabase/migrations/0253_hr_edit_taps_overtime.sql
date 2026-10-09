-- 0253 — ubah tap yang sudah masuk; ubah jam lembur yang sudah disetujui
-- (D410).
--
-- ── the owner's ask (2026-10-09) ─────────────────────────────────────────
--
--   *berikan keleluasaan untuk bisa edit tap yang sudah masuk*, then *cek,
--   salah input tap dan overtime tidak bisa diubah*. Until now HRD could add
--   a tap and take back one it typed (D398) — not change a time, not touch
--   the machine's or the phone's — and an approved evening could only be
--   cancelled and approved again by hand.
--
--   * `scan_edits` + `edit_scan`: any tap, whoever recorded it, gets a new
--     time and/or a new kind, with a reason. The row is updated in place and
--     becomes HRD's (`source = 'manual'`, the reason on it); what it was —
--     time, kind, source, reason — is kept in `scan_edits` with who and why.
--   * `void_scan` restated: any tap can be taken out, not only one HRD typed;
--     the row still moves to `voided_scans` with who and why.
--   * `person_day_scans`: every tap of a person's days for the drawer, with
--     where it came from, what it said it was, and the time it had before
--     HRD changed it.
--   * `revise_day_overtime`: a new start and finish for an evening HRD
--     approved — the old sheet is turned off (*Diubah: …*) and a new one
--     approved in one transaction, so a refusal leaves the old one paid.
--   * `person_day_overtime_times`: each sheet's start and finish, so the
--     drawer can open the change on the times already approved.

/* ── a tap changed, and what it was ───────────────────────────────────── */
create table ops_hr.scan_edits (
  id             uuid primary key default gen_random_uuid(),
  -- Not a reference: the tap may later be taken out (`voided_scans`).
  scan_id        uuid not null,
  employee_id    uuid not null references ops_hr.employees(id),
  old_work_date  date not null,
  old_at         timestamptz not null,
  old_kind       text,
  old_source     ops_hr.scan_source_t not null,
  old_reason     text,
  new_work_date  date not null,
  new_at         timestamptz not null,
  new_kind       text,
  reason         text not null check (length(btrim(reason)) > 0),
  by             uuid not null references ops_core.users(id),
  at             timestamptz not null default now()
);
create index scan_edits_scan on ops_hr.scan_edits (scan_id, at);
alter table ops_hr.scan_edits enable row level security;
create policy scan_edits_read on ops_hr.scan_edits for select to authenticated
  using (ops_core.has_permission('hrd.read') or ops_core.has_permission('payroll.read'));
grant select on ops_hr.scan_edits to authenticated;
analyze ops_hr.scan_edits;

/* A new time, a new kind, or both — for any tap. `p_kind` null or '' leaves
   the tap saying nothing, read by the clock (D369). */
create or replace function ops_hr.edit_scan(
  p_scan_id uuid, p_at timestamptz, p_kind text, p_reason text, p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare v_replayed jsonb; s ops_hr.attendance_scans; v_res jsonb; v_no text;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_kind text := nullif(btrim(coalesce(p_kind, '')), '');
  v_day date;
begin
  v_replayed := ops_core.idem_replay('hr','edit_scan', p_key);
  if v_replayed is not null then return v_replayed; end if;
  if not ops_core.has_permission('hrd.update') then
    return ops_core.refused('hr','attendance', null,'edit_scan',
      'not_permitted','Mengubah tap dilakukan HRD.');
  end if;
  if v_reason = '' then
    return ops_core.invalid('hr','attendance', null,'edit_scan',
      'reason_required','Kenapa tap ini diubah? Kalimatnya disimpan bersama jam yang lama.',
      jsonb_build_object('field','reason'));
  end if;
  if p_at is null then
    return ops_core.invalid('hr','attendance', null,'edit_scan',
      'time_required','Jam tap yang benar belum diisi.', jsonb_build_object('field','at'));
  end if;
  if v_kind is not null and v_kind not in ('in','break_out','break_in','out','ot_start','ot_end','away_out','away_back') then
    return ops_core.invalid('hr','attendance', null,'edit_scan',
      'bad_kind', format('Jenis tap %s tidak dikenal.', v_kind), jsonb_build_object('field','kind'));
  end if;
  select * into s from ops_hr.attendance_scans where id = p_scan_id;
  if not found then
    return ops_core.not_found('hr','attendance', null,'edit_scan', 'Tap itu tidak ada.');
  end if;
  select employee_no into v_no from ops_hr.employees where id = s.employee_id;
  if s.at = p_at and s.kind is not distinct from v_kind then
    return ops_core.conflict('hr','attendance', v_no,'edit_scan',
      'unchanged', 'Jam dan jenis tapnya sama dengan yang tercatat.');
  end if;
  if exists (select 1 from ops_hr.attendance_scans x
              where x.employee_id = s.employee_id and x.at = p_at and x.id <> s.id) then
    return ops_core.conflict('hr','attendance', v_no,'edit_scan',
      'already_recorded', 'Sudah ada tap lain di jam itu.');
  end if;

  -- The office day, as `add_scan` reads it (F17, F39, F102).
  v_day := ops_core.office_day(p_at);
  insert into ops_hr.scan_edits (scan_id, employee_id, old_work_date, old_at, old_kind, old_source,
                                 old_reason, new_work_date, new_at, new_kind, reason, "by")
  values (s.id, s.employee_id, s.work_date, s.at, s.kind, s.source, s.reason,
          v_day, p_at, v_kind, v_reason, auth.uid());
  update ops_hr.attendance_scans
     set at = p_at, work_date = v_day, kind = v_kind,
         source = 'manual', verify = 'MANUAL', reason = v_reason,
         recorded_by = auth.uid(), recorded_at = now()
   where id = s.id;

  v_res := ops_core.ok('hr','attendance', v_no,'edit_scan',
    jsonb_build_object('employee_no', v_no, 'scan_id', s.id, 'work_date', v_day,
                       'at', p_at, 'kind', v_kind, 'reason', v_reason),
    jsonb_build_object('at', s.at, 'kind', s.kind, 'source', s.source),
    jsonb_build_object('at', p_at, 'kind', v_kind, 'source', 'manual'));
  return ops_core.idem_remember('hr','edit_scan', p_key, v_res);
end $$;
revoke execute on function ops_hr.edit_scan(uuid, timestamptz, text, text, text) from public;
grant execute on function ops_hr.edit_scan(uuid, timestamptz, text, text, text) to authenticated;

/* Every tap of a person's days, for the drawer: where it came from, what it
   said it was, and the time it had before HRD last changed it. */
create or replace function ops_hr.person_day_scans(p_employee_no text, p_from date, p_to date)
returns table (id uuid, work_date date, at timestamptz, source ops_hr.scan_source_t,
               kind text, reason text, edited_from timestamptz)
language sql stable security definer set search_path = ops_hr, ops_core, pg_temp as $$
  select s.id, s.work_date, s.at, s.source, s.kind, s.reason,
         (select x.old_at from ops_hr.scan_edits x where x.scan_id = s.id order by x.at limit 1)
    from ops_hr.attendance_scans s join ops_hr.employees e on e.id = s.employee_id
   where e.employee_no = p_employee_no and s.work_date between p_from and p_to
     and (ops_core.has_permission('hrd.read') or ops_core.has_permission('payroll.read'))
   order by s.at
$$;
revoke execute on function ops_hr.person_day_scans(text, date, date) from public;
grant execute on function ops_hr.person_day_scans(text, date, date) to authenticated;

/* ── a tap taken out — restated from 0246 ─────────────────────────────────
   0253 (D410): any tap, not only one HRD typed. Moved, not erased: the row as
   it was, and who took it out and why. */
create or replace function ops_hr.void_scan(p_scan_id uuid, p_reason text, p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare v_replayed jsonb; s ops_hr.attendance_scans; v_res jsonb; v_no text;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  v_replayed := ops_core.idem_replay('hr','void_scan', p_key);
  if v_replayed is not null then return v_replayed; end if;
  if not ops_core.has_permission('hrd.update') then
    return ops_core.refused('hr','attendance', null,'void_scan',
      'not_permitted','Menghapus tap dilakukan HRD.');
  end if;
  if v_reason = '' then
    return ops_core.invalid('hr','attendance', null,'void_scan',
      'reason_required','Kenapa tap ini dihapus?', jsonb_build_object('field','reason'));
  end if;
  select * into s from ops_hr.attendance_scans where id = p_scan_id;
  if not found then
    return ops_core.not_found('hr','attendance', null,'void_scan', 'Tap itu tidak ada.');
  end if;
  select employee_no into v_no from ops_hr.employees where id = s.employee_id;
  insert into ops_hr.voided_scans (id, employee_id, work_date, at, source, reason, recorded_by,
                                   recorded_at, scan, voided_by, void_reason)
  values (s.id, s.employee_id, s.work_date, s.at, s.source, s.reason, s.recorded_by,
          s.recorded_at, to_jsonb(s), auth.uid(), v_reason);
  delete from ops_hr.attendance_scans where id = s.id;
  v_res := ops_core.ok('hr','attendance', v_no,'void_scan',
    jsonb_build_object('employee_no', v_no, 'work_date', s.work_date,
                       'at', s.at, 'source', s.source, 'reason', v_reason));
  return ops_core.idem_remember('hr','void_scan', p_key, v_res);
end $$;
revoke execute on function ops_hr.void_scan(uuid, text, text) from public;
grant execute on function ops_hr.void_scan(uuid, text, text) to authenticated;

/* ── an approved evening, at new times ──────────────────────────────────
   The sheet HRD approved from the payroll is turned off (*Diubah: …*, kept
   as it was) and a new one approved by the clock, in one transaction: when
   the new one is refused, the old one stays paid. */
create or replace function ops_hr.revise_day_overtime(
  p_sheet_no text, p_from_minutes int, p_until_minutes int, p_reason text, p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare v_replayed jsonb; v_sheet ops_hr.overtime_sheets; v_no text; v_res jsonb;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  v_replayed := ops_core.idem_replay('hr','revise_day_overtime', p_key);
  if v_replayed is not null then return v_replayed; end if;
  if not ops_core.has_permission('hrd.update') then
    return ops_core.refused('hr','overtime_sheet', p_sheet_no,'revise_day',
      'not_permitted','Mengubah lembur dilakukan HRD.');
  end if;
  if v_reason = '' then
    return ops_core.invalid('hr','overtime_sheet', p_sheet_no,'revise_day',
      'reason_required','Diubah karena apa? Kalimatnya tercetak di slip.',
      jsonb_build_object('field','reason'));
  end if;
  if p_from_minutes is null or p_until_minutes is null then
    return ops_core.invalid('hr','overtime_sheet', p_sheet_no,'revise_day',
      'time_required','Jam mulai dan selesai lembur yang benar belum diisi.',
      jsonb_build_object('field','from_minutes'));
  end if;
  select * into v_sheet from ops_hr.overtime_sheets s where s.sheet_no = p_sheet_no;
  if not found then
    return ops_core.not_found('hr','overtime_sheet', p_sheet_no,'revise_day',
      format('No sheet %s.', p_sheet_no));
  end if;
  if v_sheet.kind <> 'staff' or v_sheet.via <> 'hrd' then
    return ops_core.conflict('hr','overtime_sheet', p_sheet_no,'revise_day',
      'not_hrd_session',
      format('%s bukan lembur yang dicatat HRD — ubah di layar Lembur.', p_sheet_no));
  end if;
  if not v_sheet.paid then
    return ops_core.conflict('hr','overtime_sheet', p_sheet_no,'revise_day',
      'already_unpaid', format('%s sudah tidak dibayar — setujui lembur baru saja.', p_sheet_no));
  end if;
  select e.employee_no into v_no
    from ops_hr.overtime_lines l join ops_hr.employees e on e.id = l.employee_id
   where l.sheet_id = v_sheet.id limit 1;

  begin
    update ops_hr.overtime_sheets
       set paid = false, unpaid_reason = 'Diubah: ' || v_reason
     where id = v_sheet.id;
    v_res := ops_hr.approve_day_overtime(v_no, v_sheet.work_date, null, v_reason, null,
                                         p_from_minutes, p_until_minutes);
    if not ops_core.said_ok(v_res) then
      raise exception using errcode = 'P0001', message = v_res::text;
    end if;
  exception when raise_exception then
    -- The old sheet is paid again: the change never happened.
    return sqlerrm::jsonb;
  end;

  v_res := v_res || jsonb_build_object('replaced', p_sheet_no);
  return ops_core.idem_remember('hr','revise_day_overtime', p_key, v_res);
end $$;
revoke execute on function ops_hr.revise_day_overtime(text, int, int, text, text) from public;
grant execute on function ops_hr.revise_day_overtime(text, int, int, text, text) to authenticated;

/* Each of a person's sheets' start and finish, beside `person_day_overtime`. */
create or replace function ops_hr.person_day_overtime_times(p_employee_no text, p_from date, p_to date)
returns table (sheet_no text, from_minutes int, until_minutes int)
language sql stable security definer set search_path = ops_hr, ops_core, pg_temp as $$
  select s.sheet_no, l.from_minutes, l.until_minutes
    from ops_hr.overtime_lines l
    join ops_hr.overtime_sheets s on s.id = l.sheet_id
    join ops_hr.employees e on e.id = l.employee_id
   where e.employee_no = p_employee_no
     and s.work_date between p_from and p_to
     and (ops_core.has_permission('hrd.read') or ops_core.has_permission('payroll.read'))
   order by s.work_date, s.created_at
$$;
revoke execute on function ops_hr.person_day_overtime_times(text, date, date) from public;
grant execute on function ops_hr.person_day_overtime_times(text, date, date) to authenticated;
