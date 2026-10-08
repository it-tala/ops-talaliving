-- 0243 — lembur disetujui dari lembar payroll, dengan alasan (D395).
--
-- ── the owner's ask (2026-10-08) ──────────────────────────────────────────
--
--   *tambahkan approval overtime nya beserta alasan dan tambahkan ke additions
--   ke salary* — on the payroll drawer's day editor, beside a day the machine
--   shows 3,75 jam lembur and the sheet shows 0 approved.
--
-- Overtime is paid only from a sheet (D138): the machine's hours are evidence,
-- never pay. So approving it from the payroll is **an HRD sheet for that
-- person and night, already checked**, kept by one seam so the three steps
-- (open, name, check) cannot stop halfway:
--
--   * `approve_day_overtime(employee_no, work_date, hours, reason)` — a staff
--     sheet (one person, D146) opened by HRD with the reason as its purpose
--     and the line's task, checked by HRD at once: stage `paid_checked`,
--     payable, so `overtime_parts` prices it on the person's ladder and the
--     payroll line puts it in Penambahan with no other change;
--   * refused while the person already has a live line that night on any
--     sheet — a production sheet waiting for its signatures, an ask from
--     `/saya`, a staff session — so a night is never paid twice; that sheet is
--     decided where it is;
--   * `withdraw_day_overtime(sheet_no, reason)` turns such a sheet off
--     (`paid = false`, the reason kept, D146), never deletes it.
--
-- HRD's (`hrd.update`). No DROP and no UPDATE outside a function body.

create or replace function ops_hr.approve_day_overtime(
  p_employee_no text, p_work_date date, p_hours numeric, p_reason text, p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare
  v_replayed jsonb; v_emp ops_hr.employees; v_live record; v_id uuid; v_no text; v_res jsonb;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  v_replayed := ops_core.idem_replay('hr','approve_day_overtime', p_key);
  if v_replayed is not null then return v_replayed; end if;
  if not ops_core.has_permission('hrd.update') then
    return ops_core.refused('hr','overtime_sheet', p_employee_no,'approve_day',
      'not_permitted','Menyetujui lembur dari payroll dilakukan HRD.');
  end if;
  if v_reason = '' then
    return ops_core.invalid('hr','overtime_sheet', p_employee_no,'approve_day',
      'reason_required','Lembur ini disetujui karena apa? Kalimatnya tercetak di slip.',
      jsonb_build_object('field','reason'));
  end if;
  if p_work_date is null or p_work_date > ops_core.office_day() then
    return ops_core.invalid('hr','overtime_sheet', p_employee_no,'approve_day',
      'date_in_future','Lembur disetujui untuk malam yang sudah dijalani.',
      jsonb_build_object('field','work_date'));
  end if;
  if p_hours is null or p_hours <= 0 or p_hours > 12 then
    return ops_core.invalid('hr','overtime_sheet', p_employee_no,'approve_day',
      'hours_out_of_range','Jam lembur lebih dari nol dan sampai 12.',
      jsonb_build_object('field','hours'));
  end if;
  select * into v_emp from ops_hr.employees e where e.employee_no = p_employee_no;
  if not found then
    return ops_core.not_found('hr','overtime_sheet', p_employee_no,'approve_day',
      format('No employee %s.', p_employee_no));
  end if;

  -- One night is paid from one sheet. A line still alive elsewhere is decided
  -- there — the paper, the signature or the ask it belongs to.
  select s.sheet_no, v.stage into v_live
    from ops_hr.overtime_sheets s
    join ops_hr.overtime_lines l on l.sheet_id = s.id
    join ops_hr.v_overtime_stage v on v.id = s.id
   where l.employee_id = v_emp.id and s.work_date = p_work_date
     and v.stage not in ('declined','unpaid')
   order by s.created_at limit 1;
  if v_live.sheet_no is not null then
    return ops_core.conflict('hr','overtime_sheet', v_live.sheet_no,'approve_day',
      'already_claimed',
      format('Lembur %s tanggal %s sudah ada di %s (%s) — putuskan di layar Lembur, supaya malam itu tidak dibayar dua kali.',
             v_emp.full_name, to_char(p_work_date, 'DD/MM'), v_live.sheet_no, v_live.stage),
      jsonb_build_object('sheet_no', v_live.sheet_no, 'stage', v_live.stage));
  end if;

  insert into ops_hr.overtime_sheets (kind, work_date, purpose, created_by, hrd_checked_by, hrd_checked_at)
  values ('staff', p_work_date, v_reason, auth.uid(), auth.uid(), now())
  returning id, sheet_no into v_id, v_no;
  insert into ops_hr.overtime_lines (sheet_id, employee_id, hours, task)
  values (v_id, v_emp.id, p_hours, v_reason);

  v_res := ops_core.ok('hr','overtime_sheet', v_no,'approve_day',
    jsonb_build_object('sheet_no', v_no, 'employee_no', p_employee_no,
                       'work_date', p_work_date, 'hours', p_hours, 'reason', v_reason));
  return ops_core.idem_remember('hr','approve_day_overtime', p_key, v_res);
end $$;
revoke execute on function ops_hr.approve_day_overtime(text, date, numeric, text, text) from public;
grant execute on function ops_hr.approve_day_overtime(text, date, numeric, text, text) to authenticated;

/* Taking it back: the sheet stays, unpaid, with why (D146). Only a staff
   sheet HRD keyed — a production night or an ask has its own road. */
create or replace function ops_hr.withdraw_day_overtime(
  p_sheet_no text, p_reason text, p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare v_replayed jsonb; v_sheet ops_hr.overtime_sheets; v_res jsonb;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  v_replayed := ops_core.idem_replay('hr','withdraw_day_overtime', p_key);
  if v_replayed is not null then return v_replayed; end if;
  if not ops_core.has_permission('hrd.update') then
    return ops_core.refused('hr','overtime_sheet', p_sheet_no,'withdraw_day',
      'not_permitted','Membatalkan lembur dilakukan HRD.');
  end if;
  if v_reason = '' then
    return ops_core.invalid('hr','overtime_sheet', p_sheet_no,'withdraw_day',
      'reason_required','Dibatalkan karena apa?', jsonb_build_object('field','reason'));
  end if;
  select * into v_sheet from ops_hr.overtime_sheets s where s.sheet_no = p_sheet_no;
  if not found then
    return ops_core.not_found('hr','overtime_sheet', p_sheet_no,'withdraw_day',
      format('No sheet %s.', p_sheet_no));
  end if;
  if v_sheet.kind <> 'staff' or v_sheet.via <> 'hrd' then
    return ops_core.conflict('hr','overtime_sheet', p_sheet_no,'withdraw_day',
      'not_hrd_session',
      format('%s bukan lembur yang dicatat HRD — putuskan di layar Lembur.', p_sheet_no));
  end if;
  if not v_sheet.paid then
    return ops_core.conflict('hr','overtime_sheet', p_sheet_no,'withdraw_day',
      'already_unpaid', format('%s sudah tidak dibayar.', p_sheet_no));
  end if;
  update ops_hr.overtime_sheets
     set paid = false, unpaid_reason = v_reason
   where id = v_sheet.id;
  v_res := ops_core.ok('hr','overtime_sheet', p_sheet_no,'withdraw_day',
    jsonb_build_object('sheet_no', p_sheet_no, 'reason', v_reason),
    jsonb_build_object('paid', true), jsonb_build_object('paid', false));
  return ops_core.idem_remember('hr','withdraw_day_overtime', p_key, v_res);
end $$;
revoke execute on function ops_hr.withdraw_day_overtime(text, text, text) from public;
grant execute on function ops_hr.withdraw_day_overtime(text, text, text) to authenticated;

/* One person's overtime over a period, night by night — what the drawer's day
   editor shows beside the machine's hours: which sheet, where it has got to,
   and the reason. HRD's and payroll's only. */
create or replace function ops_hr.person_day_overtime(p_employee_no text, p_from date, p_to date)
returns table (sheet_no text, work_date date, kind ops_hr.overtime_kind_t, via text,
               stage ops_hr.overtime_stage_t, payable boolean, hours numeric, reason text)
language sql stable security definer set search_path = ops_hr, ops_core, pg_temp as $$
  select s.sheet_no, s.work_date, s.kind, s.via, v.stage,
         v.stage in ('approved','paid_default','paid_checked'),
         l.hours,
         coalesce(nullif(btrim(coalesce(s.unpaid_reason, s.declined_reason, '')), ''),
                  nullif(btrim(coalesce(l.deliverable, '')), ''), s.purpose)
    from ops_hr.overtime_lines l
    join ops_hr.overtime_sheets s on s.id = l.sheet_id
    join ops_hr.v_overtime_stage v on v.id = s.id
    join ops_hr.employees e on e.id = l.employee_id
   where e.employee_no = p_employee_no
     and s.work_date between p_from and p_to
     and (ops_core.has_permission('hrd.read') or ops_core.has_permission('payroll.read'))
   order by s.work_date, s.created_at
$$;
revoke execute on function ops_hr.person_day_overtime(text, date, date) from public;
grant execute on function ops_hr.person_day_overtime(text, date, date) to authenticated;
