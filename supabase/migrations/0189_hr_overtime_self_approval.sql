-- 0189_hr_overtime_self_approval.sql — overtime the person asks for, with
-- what it is for, approved by HRD or by leadership (D333).
--
-- Owner, answer 3 of D326: *untuk staff bisa diajukan sendiri, di approve
-- HR/pimpinan ditambahkan form / kolom deliverable.*
--
-- ## Two roads onto a staff sheet, and they no longer mean the same thing
--
-- D146 made a staff sheet **paid unless HRD says otherwise**: HRD keyed the
-- session from the paper, the report was attached, and the only decision left
-- was whether to take the money away. That road is unchanged — `via = 'hrd'`,
-- the default, and every sheet `create_overtime_sheet` opens.
--
-- A sheet the employee sends from `/saya` or `/profil` is a different act: it
-- is an **ask**, and the owner says an ask is approved. So `via = 'self'` is
-- read by `v_overtime_stage` before the staff branch: undecided, it is
-- `waiting_hrd` (a waiting stage, so payroll counts it as *pending* and never
-- as pay); approved, it is `approved`; declined, `declined`. Payroll still
-- derives from `v_overtime_claim.payable` alone (A3) — not one line of the
-- payroll ladder changes, and only approved hours reach a payslip.
--
-- `via` is a column, not the `purpose` sentence 0165 happened to write. A
-- stage that depends on the wording of a heading is a stage somebody breaks
-- by fixing a typo. Production had no overtime sheets when this was written
-- (checked 2026-09-29), so the backfill below is a formality.
--
-- ## Deliverable and result, and which one is asked for first
--
-- `deliverable` is what the overtime is **for** — what will exist afterwards
-- that did not before. `result_note` (0165) is what was **actually** done.
-- They answer different questions and both stay:
--
--   - **deliverable is required when the ask is sent.** It is the thing the
--     approver weighs — *is this worth staying for* — and it is known before
--     the night starts, so a person can ask on the evening itself;
--   - **result_note may follow**, through `add_overtime_result_self`, while
--     the sheet is undecided. A result is written after the work, and making
--     it a condition of asking forced people to ask afterwards or to invent
--     one. But **approval refuses without it**: paying for hours whose result
--     nobody wrote down is paying for a number.
--
-- ## Who decides, and in which capacity
--
-- Either HRD (`hrd.update`, the permission that already decides staff
-- sheets) or leadership (the `approve_overtime` authority, the same one that
-- signs production sheets and that `approvers()`-style reads treat as a
-- person's standing, never a module level — D24). One decision, not two
-- signatures: whichever of them looks first decides. `decided_as` records the
-- capacity, because a person holding both must be able to say which hat they
-- wore, and a trail that says only *who* cannot answer *on what authority*.
--
-- **Nobody decides their own.** The sheet's line is the caller's own employee,
-- or the caller opened the sheet — either way it is refused, whatever grants
-- the caller holds. A Direktur's own overtime is decided by HRD, and HRD's by
-- the Direktur.

-- ── columns ───────────────────────────────────────────────────────────────
alter table ops_hr.overtime_sheets
  add column via text not null default 'hrd',
  add column decided_by uuid references ops_core.users(id),
  add column decided_at timestamptz,
  add column decided_as text,
  add column decision_note text;

alter table ops_hr.overtime_sheets
  add constraint via_known check (via in ('hrd','self')),
  add constraint decided_as_known check (decided_as is null or decided_as in ('hrd','leader')),
  -- A decision is a person, a moment and a capacity together, or none of them.
  add constraint decision_complete check (
    (decided_at is null) = (decided_by is null)
    and (decided_at is null) = (decided_as is null)),
  -- Only an ask is decided this way; the HRD road keeps its own signatures.
  add constraint decision_only_self check (via = 'self' or decided_at is null);

comment on column ops_hr.overtime_sheets.via is
  'hrd: keyed by HRD (D146, paid unless turned off). self: asked for by the employee (D333), paid only once HRD or leadership approves.';
comment on column ops_hr.overtime_sheets.decided_as is
  'The capacity a self-submitted sheet was decided in: hrd (hrd.update) or leader (approve_overtime). (D333)';

update ops_hr.overtime_sheets s
   set via = 'self'
 where s.kind = 'staff' and s.purpose = 'Diajukan sendiri lewat profil';

alter table ops_hr.overtime_lines add column deliverable text;
comment on column ops_hr.overtime_lines.deliverable is
  'What the overtime is for — what it will deliver. Asked for up front on the self road (D333); result_note is what was actually done.';

-- ── where a sheet has got to ──────────────────────────────────────────────
--
-- The 0046 view with one branch added, ahead of the staff branch: an ask is
-- not paid by default.
create or replace view ops_hr.v_overtime_stage as
select
  s.id,
  s.sheet_no,
  s.kind,
  s.work_date,
  (case
     when s.declined_reason is not null then 'declined'
     when s.via = 'self' then
       case when s.decided_at is null then 'waiting_hrd'
            else                           'approved' end
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
  select l.entity_no
    from ops_core.attachment_links l
   where l.entity = 'overtime_sheet'
     and l.entity_no = s.sheet_no
     and l.kind = 'surat_lembur'
     and l.unlinked_at is null
   limit 1
) surat on true;

alter view ops_hr.v_overtime_stage set (security_invoker = on);

-- ── asking ────────────────────────────────────────────────────────────────
drop function ops_hr.report_overtime_self(date, numeric, text, text, text);

create function ops_hr.report_overtime_self(
  p_work_date   date,
  p_hours       numeric,
  p_result_note text default null,
  p_task        text default null,
  p_key         text default null,
  p_deliverable text default null)
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
  -- Today is allowed: the deliverable is known before the night starts, so
  -- the ask can go in that evening. Tomorrow is not — that is a plan, and a
  -- plan is not overtime yet.
  if p_work_date > ops_core.office_day() then
    return ops_core.invalid('hr','overtime_sheet', null,'report_self',
      'date_in_future',
      'Lembur diajukan untuk hari ini atau malam yang sudah dijalani, bukan yang akan datang.',
      jsonb_build_object('field','work_date'));
  end if;
  if p_hours is null or p_hours <= 0 or p_hours > 12 then
    return ops_core.invalid('hr','overtime_sheet', null,'report_self',
      'hours_out_of_range','Durasi lembur ditulis dalam jam, lebih dari nol dan sampai 12.',
      jsonb_build_object('field','hours'));
  end if;
  if coalesce(btrim(coalesce(p_deliverable,'')),'') = '' then
    return ops_core.invalid('hr','overtime_sheet', null,'report_self',
      'deliverable_required',
      'Lembur ini untuk menghasilkan apa? HRD atau pimpinan menyetujui dari kalimat ini.',
      jsonb_build_object('field','deliverable'));
  end if;

  -- One ask per person per night. A declined ask frees the night: asking
  -- again with a better reason is the honest response to a *no*.
  if exists (
    select 1 from ops_hr.overtime_sheets s
      join ops_hr.overtime_lines l on l.sheet_id = s.id
     where s.kind = 'staff' and s.work_date = p_work_date
       and l.employee_id = v_emp and s.declined_reason is null
  ) then
    return ops_core.conflict('hr','overtime_sheet', null,'report_self',
      'already_reported', format('Lembur tanggal %s sudah pernah diajukan.', p_work_date));
  end if;

  insert into ops_hr.overtime_sheets (kind, work_date, purpose, created_by, via)
  values ('staff', p_work_date, 'Diajukan sendiri lewat profil', auth.uid(), 'self')
  returning id, sheet_no into v_sheet_id, v_sheet_no;

  insert into ops_hr.overtime_lines (sheet_id, employee_id, hours, task, result_note, deliverable)
  values (v_sheet_id, v_emp, p_hours, nullif(btrim(coalesce(p_task,'')),''),
          nullif(btrim(coalesce(p_result_note,'')),''), btrim(p_deliverable));

  perform ops_core.record_activity_event('overtime_requested','overtime_sheet',
    format('Mengajukan lembur %s jam pada %s', p_hours, p_work_date));

  v_res := ops_core.ok('hr','overtime_sheet', v_sheet_no,'report_self',
    jsonb_build_object('sheet_no', v_sheet_no, 'work_date', p_work_date,
                       'hours', p_hours, 'via','self',
                       'stage', (select stage from ops_hr.v_overtime_stage where sheet_no = v_sheet_no)),
    null,
    jsonb_build_object('via','self','hours', p_hours, 'deliverable', btrim(p_deliverable),
                       'result_note', nullif(btrim(coalesce(p_result_note,'')),'')));
  return ops_core.idem_remember('hr','report_overtime_self', p_key, v_res);
end $$;

revoke execute on function ops_hr.report_overtime_self(date, numeric, text, text, text, text) from public;
grant execute on function ops_hr.report_overtime_self(date, numeric, text, text, text, text) to authenticated;

-- ── the result, afterwards ────────────────────────────────────────────────
create or replace function ops_hr.add_overtime_result_self(
  p_sheet_no    text,
  p_result_note text,
  p_key         text default null)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare
  v_replayed jsonb; v_emp uuid; v_sheet ops_hr.overtime_sheets; v_res jsonb;
begin
  v_replayed := ops_core.idem_replay('hr','add_overtime_result_self', p_key);
  if v_replayed is not null then return v_replayed; end if;

  v_emp := ops_hr.my_employee_id();
  if v_emp is null then
    return ops_core.refused('hr','overtime_sheet', p_sheet_no,'result_self',
      'no_employee_link',
      'Akun ini belum tertaut ke data karyawan. Minta HRD menautkannya.');
  end if;

  -- Somebody else's sheet answers exactly as a sheet that does not exist:
  -- this road must not become a way to learn which numbers are real.
  select s.* into v_sheet
    from ops_hr.overtime_sheets s
   where s.sheet_no = p_sheet_no and s.via = 'self'
     and exists (select 1 from ops_hr.overtime_lines l
                  where l.sheet_id = s.id and l.employee_id = v_emp);
  if not found then
    return ops_core.not_found('hr','overtime_sheet', p_sheet_no,'result_self',
      format('Tidak ada pengajuan lembur %s milik Anda.', p_sheet_no));
  end if;
  if v_sheet.decided_at is not null or v_sheet.declined_reason is not null then
    return ops_core.conflict('hr','overtime_sheet', p_sheet_no,'result_self',
      'already_decided',
      'Lembur ini sudah diputuskan. Hasil yang ditulis sekarang tidak lagi dibaca orang yang memutuskan.');
  end if;
  if coalesce(btrim(coalesce(p_result_note,'')),'') = '' then
    return ops_core.invalid('hr','overtime_sheet', p_sheet_no,'result_self',
      'result_required','Apa yang selesai?', jsonb_build_object('field','result_note'));
  end if;

  update ops_hr.overtime_lines
     set result_note = btrim(p_result_note)
   where sheet_id = v_sheet.id and employee_id = v_emp;

  v_res := ops_core.ok('hr','overtime_sheet', p_sheet_no,'result_self',
    jsonb_build_object('sheet_no', p_sheet_no, 'result_note', btrim(p_result_note)));
  return ops_core.idem_remember('hr','add_overtime_result_self', p_key, v_res);
end $$;

revoke execute on function ops_hr.add_overtime_result_self(text, text, text) from public;
grant execute on function ops_hr.add_overtime_result_self(text, text, text) to authenticated;

-- ── deciding an ask ───────────────────────────────────────────────────────
create or replace function ops_hr.decide_overtime_self(
  p_sheet_no text,
  p_approved boolean,
  p_note     text default null,
  p_as       text default null,
  p_key      text default null)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare
  v_replayed jsonb;
  v_hrd      boolean := ops_core.has_permission('hrd.update');
  v_leader   boolean := ops_core.has_authority('approve_overtime');
  v_as       text;
  v_sheet    ops_hr.overtime_sheets;
  v_line     ops_hr.overtime_lines;
  v_res      jsonb;
begin
  v_replayed := ops_core.idem_replay('hr','decide_overtime_self', p_key);
  if v_replayed is not null then return v_replayed; end if;

  if p_as is not null and p_as not in ('hrd','leader') then
    return ops_core.invalid('hr','overtime_sheet', p_sheet_no,'decide_self',
      'bad_step','Yang memutuskan adalah HRD atau pimpinan.',
      jsonb_build_object('field','as'));
  end if;
  -- The capacity asked for has to be held; with none named, HRD's is taken
  -- first because it is the one whose everyday job this is.
  v_as := case
            when p_as = 'hrd'    and v_hrd    then 'hrd'
            when p_as = 'leader' and v_leader then 'leader'
            when p_as is null and v_hrd       then 'hrd'
            when p_as is null and v_leader    then 'leader'
          end;
  if v_as is null then
    return ops_core.refused('hr','overtime_sheet', p_sheet_no,'decide_self',
      'not_permitted',
      'Menyetujui lembur yang diajukan sendiri butuh akses HRD atau wewenang approve_overtime (pimpinan).');
  end if;

  select s.* into v_sheet from ops_hr.overtime_sheets s where s.sheet_no = p_sheet_no;
  if not found then
    return ops_core.not_found('hr','overtime_sheet', p_sheet_no,'decide_self',
      format('No sheet %s.', p_sheet_no));
  end if;
  if v_sheet.via <> 'self' then
    return ops_core.invalid('hr','overtime_sheet', p_sheet_no,'decide_self',
      'not_self_submitted',
      format('%s dibuat HRD, bukan diajukan sendiri — diputuskan lewat lembarnya (D146).', p_sheet_no),
      jsonb_build_object('field','sheet_no'));
  end if;

  select l.* into v_line from ops_hr.overtime_lines l where l.sheet_id = v_sheet.id limit 1;

  -- Before any state is looked at: whatever the sheet's state, one's own
  -- overtime is never one's own to decide.
  if v_sheet.created_by = auth.uid()
     or (v_line.employee_id is not null and v_line.employee_id = ops_hr.my_employee_id()) then
    return ops_core.refused('hr','overtime_sheet', p_sheet_no,'decide_self',
      'own_overtime',
      'Lembur sendiri tidak bisa disetujui sendiri. HRD atau pimpinan yang lain yang memutuskan.');
  end if;

  if v_sheet.decided_at is not null or v_sheet.declined_reason is not null then
    return ops_core.conflict('hr','overtime_sheet', p_sheet_no,'decide_self',
      'already_decided', format('%s sudah diputuskan.', p_sheet_no));
  end if;
  if not coalesce(p_approved, false)
     and coalesce(btrim(coalesce(p_note,'')), '') = '' then
    return ops_core.invalid('hr','overtime_sheet', p_sheet_no,'decide_self',
      'reason_required','Menolak lembur butuh satu kalimat — orangnya membaca alasan ini.',
      jsonb_build_object('field','note'));
  end if;
  if coalesce(p_approved, false)
     and coalesce(btrim(coalesce(v_line.result_note,'')), '') = '' then
    return ops_core.invalid('hr','overtime_sheet', p_sheet_no,'decide_self',
      'result_required',
      'Hasil kerjanya belum ditulis. Yang disetujui adalah hasilnya, bukan jamnya saja.',
      jsonb_build_object('field','result_note'));
  end if;

  if coalesce(p_approved, false) then
    update ops_hr.overtime_sheets
       set decided_by = auth.uid(), decided_at = now(), decided_as = v_as,
           decision_note = nullif(btrim(coalesce(p_note,'')), ''),
           paid = true, unpaid_reason = null
     where id = v_sheet.id;
    perform ops_core.emit('hr','overtime.approved', p_sheet_no,
      jsonb_build_object('sheet_no', p_sheet_no, 'kind', v_sheet.kind,
                         'work_date', v_sheet.work_date, 'via', 'self',
                         'decided_as', v_as, 'production', '[]'::jsonb));
  else
    update ops_hr.overtime_sheets
       set decided_by = auth.uid(), decided_at = now(), decided_as = v_as,
           decision_note = btrim(p_note),
           declined_by = auth.uid(), declined_reason = btrim(p_note)
     where id = v_sheet.id;
  end if;

  v_res := ops_core.ok('hr','overtime_sheet', p_sheet_no,'decide_self',
    jsonb_build_object('sheet_no', p_sheet_no, 'approved', coalesce(p_approved, false),
                       'decided_as', v_as,
                       'stage', (select stage from ops_hr.v_overtime_stage where sheet_no = p_sheet_no)),
    jsonb_build_object('stage', 'waiting_hrd'),
    jsonb_build_object('stage', (select stage from ops_hr.v_overtime_stage where sheet_no = p_sheet_no),
                       'decided_as', v_as, 'note', nullif(btrim(coalesce(p_note,'')), '')));
  return ops_core.idem_remember('hr','decide_overtime_self', p_key, v_res);
end $$;

revoke execute on function ops_hr.decide_overtime_self(text, boolean, text, text, text) from public;
grant execute on function ops_hr.decide_overtime_self(text, boolean, text, text, text) to authenticated;

-- ── the queue both deciders read ──────────────────────────────────────────
--
-- Definer, because leadership holds an authority and usually no HR module, so
-- `employees` and `overtime_lines` are closed to it under RLS — and a queue
-- that shows a leader sheet numbers without names is a queue nobody can
-- decide from. It answers the self road only, and only to a caller who could
-- decide it: HRD reading, or the `approve_overtime` authority. `mine` marks
-- the rows the caller may not decide, so the screen can say why rather than
-- offer a button the seam refuses.
create or replace function ops_hr.self_overtime_queue()
returns table (
  sheet_no        text,
  work_date       date,
  created_at      timestamptz,
  employee_no     text,
  full_name       text,
  hours           numeric,
  task            text,
  deliverable     text,
  result_note     text,
  stage           ops_hr.overtime_stage_t,
  payable         boolean,
  decided_by_name text,
  decided_as      text,
  decided_at      timestamptz,
  decision_note   text,
  mine            boolean)
language sql stable security definer set search_path = ops_hr, ops_core, pg_temp as $$
  select s.sheet_no, s.work_date, s.created_at,
         e.employee_no, e.full_name,
         l.hours, l.task, l.deliverable, l.result_note,
         c.stage, c.payable,
         u.full_name, s.decided_as, s.decided_at, s.decision_note,
         (s.created_by = auth.uid() or l.employee_id = ops_hr.my_employee_id()) as mine
    from ops_hr.overtime_sheets s
    join ops_hr.overtime_lines l on l.sheet_id = s.id
    join ops_hr.employees e on e.id = l.employee_id
    join ops_hr.v_overtime_claim c on c.id = s.id
    left join ops_core.users u on u.id = s.decided_by
   where s.via = 'self'
     and (ops_core.has_permission('hrd.read') or ops_core.has_authority('approve_overtime'))
   order by (c.stage = 'waiting_hrd') desc, s.work_date desc, s.created_at desc
$$;

revoke execute on function ops_hr.self_overtime_queue() from public;
grant execute on function ops_hr.self_overtime_queue() to authenticated;

-- ── HRD's own road learns the column ──────────────────────────────────────
drop function ops_hr.add_overtime_line(text, text, numeric, text, text, text, numeric, numeric, text);

create function ops_hr.add_overtime_line(
  p_sheet_no    text,
  p_employee_no text,
  p_hours       numeric,
  p_task        text,
  p_wo_no       text default null,
  p_stage       text default null,
  p_qty_done    numeric default null,
  p_form_amount numeric default null,
  p_key         text default null,
  p_deliverable text default null)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare v_replayed jsonb; v_sheet ops_hr.overtime_sheets; v_emp ops_hr.employees; v_res jsonb;
begin
  v_replayed := ops_core.idem_replay('hr','add_overtime_line', p_key);
  if v_replayed is not null then return v_replayed; end if;

  if not ops_core.has_permission('hrd.create') then
    return ops_core.refused('hr','overtime_sheet', p_sheet_no,'add_line',
      'not_permitted','Adding a name needs HR access.');
  end if;

  select s.* into v_sheet from ops_hr.overtime_sheets s where s.sheet_no = p_sheet_no;
  if not found then
    return ops_core.not_found('hr','overtime_sheet', p_sheet_no,'add_line',
      format('No sheet %s.', p_sheet_no));
  end if;
  if not ops_hr.sheet_is_open(v_sheet) then
    return ops_core.conflict('hr','overtime_sheet', p_sheet_no,'add_line',
      'sheet_closed',
      format('%s sudah diperiksa. Nama baru masuk lembar baru — menambah nama ke '
             'lembar yang sudah ditandatangani berarti tanda tangannya tidak lagi '
             'menunjuk apa yang ditandatangani.', p_sheet_no));
  end if;
  -- An ask is one person's, and its one line is theirs (D333).
  if v_sheet.via = 'self' then
    return ops_core.conflict('hr','overtime_sheet', p_sheet_no,'add_line',
      'self_submitted', format('%s diajukan sendiri oleh karyawannya — satu nama, miliknya.', p_sheet_no));
  end if;

  select e.* into v_emp from ops_hr.employees e where e.employee_no = p_employee_no;
  if not found then
    return ops_core.not_found('hr','overtime_sheet', p_sheet_no,'add_line',
      format('No employee %s.', p_employee_no));
  end if;
  if coalesce(p_hours, 0) <= 0 then
    return ops_core.invalid('hr','overtime_sheet', p_sheet_no,'add_line',
      'hours_required','Lembur nol jam bukan lembur.', jsonb_build_object('field','hours'));
  end if;
  if coalesce(btrim(coalesce(p_task,'')), '') = '' then
    return ops_core.invalid('hr','overtime_sheet', p_sheet_no,'add_line',
      'task_required','Apa yang dikerjakan?', jsonb_build_object('field','task'));
  end if;
  if exists (select 1 from ops_hr.overtime_lines l
              where l.sheet_id = v_sheet.id and l.employee_id = v_emp.id) then
    return ops_core.conflict('hr','overtime_sheet', p_sheet_no,'add_line',
      'already_on_sheet', format('%s sudah ada di lembar ini.', v_emp.full_name));
  end if;

  insert into ops_hr.overtime_lines
    (sheet_id, employee_id, hours, task, wo_no, stage, qty_done, form_amount, deliverable)
  values (v_sheet.id, v_emp.id, p_hours, btrim(p_task),
          nullif(btrim(coalesce(p_wo_no,'')), ''), nullif(btrim(coalesce(p_stage,'')), ''),
          p_qty_done, p_form_amount, nullif(btrim(coalesce(p_deliverable,'')), ''));

  v_res := ops_core.ok('hr','overtime_sheet', p_sheet_no,'add_line',
    jsonb_build_object('sheet_no', p_sheet_no, 'employee_no', p_employee_no,
                       'hours', p_hours, 'wo_no', nullif(btrim(coalesce(p_wo_no,'')), ''),
                       'deliverable', nullif(btrim(coalesce(p_deliverable,'')), '')));
  return ops_core.idem_remember('hr','add_overtime_line', p_key, v_res);
end $$;

revoke execute on function
  ops_hr.add_overtime_line(text, text, numeric, text, text, text, numeric, numeric, text, text) from public;
grant execute on function
  ops_hr.add_overtime_line(text, text, numeric, text, text, text, numeric, numeric, text, text) to authenticated;

-- ── the two signatures learn about the ask ────────────────────────────────
--
-- `decide_overtime_sheet` as 0054 wrote it, with one branch: a self-submitted
-- sheet is handed to `decide_overtime_self` in the capacity the step names.
-- Without it HRD's *hrd* step would write a check signature that the stage no
-- longer reads for an ask, and the sheet would sit *waiting* with a signature
-- on it.
create or replace function ops_hr.decide_overtime_sheet(
  p_sheet_no text,
  p_step     text,
  p_approved boolean,
  p_reason   text default null,
  p_key      text default null)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare
  v_replayed jsonb;
  v_sheet    ops_hr.overtime_sheets;
  v_before   ops_hr.overtime_stage_t;
  v_lines    int;
  v_res      jsonb;
begin
  v_replayed := ops_core.idem_replay('hr','decide_overtime_sheet', p_key);
  if v_replayed is not null then return v_replayed; end if;

  if p_step not in ('hrd','leader') then
    return ops_core.invalid('hr','overtime_sheet', p_sheet_no,'decide',
      'bad_step','Yang menandatangani adalah HRD atau pimpinan.',
      jsonb_build_object('field','step'));
  end if;

  -- **Two different authorities, and the difference is the point.** HRD checks
  -- the hours with a module grant; the leader signs with the `approve_overtime`
  -- authority, which is granted on its own and never implied by a level (D24,
  -- D147). A leader who happens to hold `hrd.update` still cannot sign as the
  -- leader without it.
  if p_step = 'hrd' and not ops_core.has_permission('hrd.update') then
    return ops_core.refused('hr','overtime_sheet', p_sheet_no,'decide',
      'not_permitted','Checking the hours needs HR access.');
  end if;
  if p_step = 'leader' and not ops_core.has_authority('approve_overtime') then
    return ops_core.refused('hr','overtime_sheet', p_sheet_no,'decide',
      'not_permitted',
      'Tanda tangan pimpinan butuh wewenang approve_overtime, bukan akses modul.');
  end if;

  select s.* into v_sheet from ops_hr.overtime_sheets s where s.sheet_no = p_sheet_no;
  if not found then
    return ops_core.not_found('hr','overtime_sheet', p_sheet_no,'decide',
      format('No sheet %s.', p_sheet_no));
  end if;
  select stage into v_before from ops_hr.v_overtime_stage where sheet_no = p_sheet_no;

  -- An ask the employee sent is decided once, by HRD or leadership (D333),
  -- not signed twice. Both steps land on the one seam that knows that — so
  -- this drawer and the queue cannot decide the same ask two ways.
  if v_sheet.via = 'self' then
    return ops_hr.decide_overtime_self(p_sheet_no, p_approved, p_reason, p_step, p_key);
  end if;

  if p_step = 'leader' and v_sheet.kind = 'staff' then
    return ops_core.invalid('hr','overtime_sheet', p_sheet_no,'decide',
      'no_leader_needed',
      'Lembur staff tidak perlu tanda tangan pimpinan — HRD yang memutuskan (D146).',
      jsonb_build_object('field','step'));
  end if;
  if v_sheet.declined_reason is not null then
    return ops_core.conflict('hr','overtime_sheet', p_sheet_no,'decide',
      'already_decided', format('%s sudah ditolak.', p_sheet_no));
  end if;
  if not coalesce(p_approved, false)
     and coalesce(btrim(coalesce(p_reason,'')), '') = '' then
    return ops_core.invalid('hr','overtime_sheet', p_sheet_no,'decide',
      'reason_required','Menolak lembur yang sudah dikerjakan butuh satu kalimat.',
      jsonb_build_object('field','reason'));
  end if;

  select count(*) into v_lines from ops_hr.overtime_lines l where l.sheet_id = v_sheet.id;
  if v_lines = 0 then
    return ops_core.invalid('hr','overtime_sheet', p_sheet_no,'decide',
      'empty_sheet','Lembar ini belum ada namanya.', jsonb_build_object('field','lines'));
  end if;

  if p_step = 'hrd' and v_sheet.hrd_checked_at is not null then
    return ops_core.conflict('hr','overtime_sheet', p_sheet_no,'decide',
      'already_decided','HRD sudah memeriksa lembar ini.');
  end if;

  if p_step = 'leader' then
    if v_sheet.hrd_checked_at is null then
      return ops_core.conflict('hr','overtime_sheet', p_sheet_no,'decide',
        'hrd_first',
        'HRD belum memeriksa jamnya. Pimpinan menandatangani setelah HRD, bukan menggantikannya.');
    end if;
    if v_sheet.leader_approved_at is not null then
      return ops_core.conflict('hr','overtime_sheet', p_sheet_no,'decide',
        'already_decided','Pimpinan sudah menandatangani lembar ini.');
    end if;
    -- **What the leader signs is the surat.** HRD checked the hours; without
    -- the paper, what is being approved is a number (D147). The link is
    -- `ops_core.attachment_links`, filed by the documents seam — this only
    -- asks whether it is there.
    if coalesce(p_approved, false)
       and not exists (select 1 from ops_core.attachment_links l
                        where l.entity = 'overtime_sheet' and l.entity_no = p_sheet_no
                          and l.kind = 'surat_lembur' and l.unlinked_at is null) then
      return ops_core.invalid('hr','overtime_sheet', p_sheet_no,'decide',
        'surat_required',
        'Surat lembur belum dilampirkan. Pimpinan menandatangani suratnya — tanpa itu '
        'yang disetujui hanya angka.', jsonb_build_object('field','surat_lembur'));
    end if;
  end if;

  if p_step = 'hrd' then
    update ops_hr.overtime_sheets
       set hrd_checked_by = auth.uid(), hrd_checked_at = now(),
           -- A staff session is decided here and nowhere else: `paid` is what
           -- HRD's answer means on that kind of sheet.
           paid = case when kind = 'staff' then coalesce(p_approved, false) else paid end,
           unpaid_reason = case when kind = 'staff' and not coalesce(p_approved, false)
                                then btrim(p_reason) end,
           -- A production sheet HRD turns down is declined outright; there is
           -- nothing for the leader to sign afterwards.
           declined_by = case when kind = 'production' and not coalesce(p_approved, false)
                              then auth.uid() end,
           declined_reason = case when kind = 'production' and not coalesce(p_approved, false)
                                  then btrim(p_reason) end
     where sheet_no = p_sheet_no;
  elsif coalesce(p_approved, false) then
    update ops_hr.overtime_sheets
       set leader_approved_by = auth.uid(), leader_approved_at = now()
     where sheet_no = p_sheet_no;
  else
    update ops_hr.overtime_sheets
       set declined_by = auth.uid(), declined_reason = btrim(p_reason)
     where sheet_no = p_sheet_no;
  end if;

  -- An approved sheet announces what was made. `0062` lets `approve_overtime`
  -- post a progress entry whose `source_ref` is this number without holding
  -- the production module — the signature is the authority (D147) — and the
  -- same sheet posted twice adds nothing.
  --
  -- `overtime.approved`, not `hr.overtime.approved`: `hr` is a legacy schema
  -- name and a dotted string starting with it trips the isolation guard (F122).
  if coalesce(p_approved, false)
     and (p_step = 'leader' or v_sheet.kind = 'staff') then
    perform ops_core.emit('hr','overtime.approved', p_sheet_no,
      jsonb_build_object(
        'sheet_no', p_sheet_no, 'kind', v_sheet.kind, 'work_date', v_sheet.work_date,
        'production', coalesce((
          select jsonb_agg(jsonb_build_object('wo_no', l.wo_no, 'stage', l.stage, 'qty', l.qty_done))
            from ops_hr.overtime_lines l
           where l.sheet_id = v_sheet.id and l.wo_no is not null and l.qty_done is not null),
          '[]'::jsonb)));
  end if;

  v_res := ops_core.ok('hr','overtime_sheet', p_sheet_no,'decide',
    jsonb_build_object('sheet_no', p_sheet_no, 'step', p_step,
                       'approved', coalesce(p_approved, false),
                       'stage', (select stage from ops_hr.v_overtime_stage where sheet_no = p_sheet_no)),
    jsonb_build_object('stage', v_before),
    jsonb_build_object('stage', (select stage from ops_hr.v_overtime_stage where sheet_no = p_sheet_no)));
  return ops_core.idem_remember('hr','decide_overtime_sheet', p_key, v_res);
end $$;

grant execute on function ops_hr.decide_overtime_sheet(text, text, boolean, text, text) to authenticated;
