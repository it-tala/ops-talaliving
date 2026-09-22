-- 0054_hr_overtime_seams.sql — the sheet, the names on it, the paper form it
-- often arrives as, and the two signatures that decide it.
--
-- `0043` built the tables and `v_overtime_stage`, which already knows the
-- whole machine: a production sheet goes `waiting_hrd` → `waiting_surat` →
-- `waiting_leader` → `approved`, a staff session goes to `paid_default` or
-- `paid_checked` or `unpaid`, and either can be `declined`. Nothing could
-- **move** a sheet along it. This is that.
--
-- ## Two kinds, and the kind decides who signs
--
-- A **production** sheet is one night with many names on it; a **staff** sheet
-- is one session with one name and that person's own report (D146). The kind
-- is chosen when the sheet is opened, because it decides who has to sign and
-- that is not a thing to discover at the end. The table already refuses a
-- leader's signature on a staff sheet; this refuses the *attempt*, with the
-- sentence that says why.
--
-- ## What the leader is actually signing
--
-- The surat. Not the hours — HRD checked those — so a leader's approval with
-- no `surat_lembur` attached is refused: without the paper, what was approved
-- is a number (D147). The link lives in `ops_core.attachment_links` and
-- `v_overtime_stage` already reads it.
--
-- **Which is why there is no `attach_overtime_doc` here.** Filing evidence is
-- one road and it is the documents seam (ADR-010, D91–D92). A second road
-- through `ops_hr` would be a second place a surat can be linked and a second
-- place it can be forgotten.
--
-- ## The event, and D147's second door
--
-- An approved production sheet announces what was made that night — the work
-- order, the stage, the quantity — because `0062` lets `approve_overtime` post
-- a progress entry whose source is that sheet, without the poster holding the
-- production module. The signature is the authority. The same sheet posted
-- twice adds nothing, which `progress_entries` enforces on `source_ref`.

-- ── opening a sheet ───────────────────────────────────────────────────────
create or replace function ops_hr.create_overtime_sheet(
  p_kind      ops_hr.overtime_kind_t,
  p_work_date date,
  p_purpose   text,
  p_key       text default null)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare v_replayed jsonb; v_no text; v_res jsonb;
begin
  v_replayed := ops_core.idem_replay('hr','create_overtime_sheet', p_key);
  if v_replayed is not null then return v_replayed; end if;

  if not ops_core.has_permission('hrd.create') then
    return ops_core.refused('hr','overtime_sheet', null,'create',
      'not_permitted','Opening an overtime sheet needs HR access.');
  end if;
  if coalesce(btrim(coalesce(p_purpose,'')), '') = '' then
    return ops_core.invalid('hr','overtime_sheet', null,'create',
      'purpose_required',
      'Kenapa ada lembur malam itu? Lembur tanpa alasan adalah kebiasaan, bukan keputusan.',
      jsonb_build_object('field','purpose'));
  end if;

  insert into ops_hr.overtime_sheets (kind, work_date, purpose, created_by)
  values (p_kind, p_work_date, btrim(p_purpose), auth.uid())
  returning sheet_no into v_no;

  v_res := ops_core.ok('hr','overtime_sheet', v_no,'create',
    jsonb_build_object('sheet_no', v_no, 'kind', p_kind, 'work_date', p_work_date,
                       'stage', (select stage from ops_hr.v_overtime_stage where sheet_no = v_no)));
  return ops_core.idem_remember('hr','create_overtime_sheet', p_key, v_res);
end $$;

-- ── a signed sheet is closed ──────────────────────────────────────────────
--
-- Shared by the two roads onto a sheet, because the rule is about the sheet
-- and not about how a name reached it: adding a name to a sheet somebody has
-- already signed means the signature no longer points at what was signed.
create or replace function ops_hr.sheet_is_open(p_sheet ops_hr.overtime_sheets)
returns boolean
language sql immutable as $$
  select p_sheet.hrd_checked_at is null and p_sheet.leader_approved_at is null
$$;

-- ── adding a name ─────────────────────────────────────────────────────────
--
-- On a production sheet the line also carries **what was made**: the work
-- order, the stage and how many. Those three are the production report for
-- that night, typed once rather than twice, because two copies of one fact
-- start disagreeing the week after (D147).
create or replace function ops_hr.add_overtime_line(
  p_sheet_no    text,
  p_employee_no text,
  p_hours       numeric,
  p_task        text,
  p_wo_no       text default null,
  p_stage       text default null,
  p_qty_done    numeric default null,
  p_form_amount numeric default null,
  p_key         text default null)
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
    (sheet_id, employee_id, hours, task, wo_no, stage, qty_done, form_amount)
  values (v_sheet.id, v_emp.id, p_hours, btrim(p_task),
          nullif(btrim(coalesce(p_wo_no,'')), ''), nullif(btrim(coalesce(p_stage,'')), ''),
          p_qty_done, p_form_amount);

  v_res := ops_core.ok('hr','overtime_sheet', p_sheet_no,'add_line',
    jsonb_build_object('sheet_no', p_sheet_no, 'employee_no', p_employee_no,
                       'hours', p_hours, 'wo_no', nullif(btrim(coalesce(p_wo_no,'')), '')));
  return ops_core.idem_remember('hr','add_overtime_line', p_key, v_res);
end $$;

-- ── the company's own paper form ──────────────────────────────────────────
--
-- *FORM LEMBUR KARYAWAN PT TALAHOME*, with NO · NAMA · DESCRIPTION · GAJI ·
-- JAM · TTD and twenty numbered rows. The paper already exists, so the system
-- reads that rather than asking anybody to retype it into a different shape
-- (D154).
--
-- People are matched **by name**, which is the only identifier the form
-- carries — normalised for case and spacing, because it is filled in by hand
-- and the capitalisation is nobody's fault.
--
-- Three ways a row does not become a line, counted apart because they are
-- three different things to do about it:
--
--   **unknown** — no employee of that name. Reported, never created.
--   **ambiguous** — *two* employees of that name. The demo's map silently kept
--   the last one; a join here would have made two lines and doubled the night.
--   Two people called Sumiati is a question for HRD, not something an importer
--   resolves.
--   **no hours** — the JAM column is blank. The demo wrote `0`, which this
--   table refuses and should: *lembur nol jam bukan lembur* is its own rule
--   one function up, and an import must not be the road around it.
create or replace function ops_hr.import_overtime_form(
  p_sheet_no text,
  p_filename text,
  p_rows     jsonb,
  p_key      text default null)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare
  v_replayed  jsonb;
  v_sheet     ops_hr.overtime_sheets;
  v_added     int;
  v_dup       int;
  v_unknown   jsonb;
  v_ambiguous jsonb;
  v_nohours   jsonb;
  v_res       jsonb;
begin
  v_replayed := ops_core.idem_replay('hr','import_overtime_form', p_key);
  if v_replayed is not null then return v_replayed; end if;

  if not ops_core.has_permission('hrd.create') then
    return ops_core.refused('hr','overtime_sheet', p_sheet_no,'import_form',
      'not_permitted','Reading the form needs HR access.');
  end if;

  select s.* into v_sheet from ops_hr.overtime_sheets s where s.sheet_no = p_sheet_no;
  if not found then
    return ops_core.not_found('hr','overtime_sheet', p_sheet_no,'import_form',
      format('No sheet %s.', p_sheet_no));
  end if;
  if not ops_hr.sheet_is_open(v_sheet) then
    return ops_core.conflict('hr','overtime_sheet', p_sheet_no,'import_form',
      'sheet_closed', format('%s sudah diperiksa — form baru masuk lembar baru.', p_sheet_no));
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    return ops_core.invalid('hr','overtime_sheet', p_sheet_no,'import_form',
      'empty_form','Tidak ada baris berisi nama dan jam di form itu.',
      jsonb_build_object('field','rows'));
  end if;

  with raw as (
    select
      btrim(coalesce(r ->> 'name',''))                         as name,
      lower(regexp_replace(btrim(coalesce(r ->> 'name','')), '\s+', ' ', 'g')) as norm,
      nullif(btrim(coalesce(r ->> 'description','')), '')      as description,
      nullif(r ->> 'jam','')::numeric                          as jam,
      nullif(r ->> 'gaji','')::numeric                         as gaji,
      ord
    from jsonb_array_elements(p_rows) with ordinality as t(r, ord)
  ),
  counted as (
    select w.*,
      (select count(*) from ops_hr.employees e
        where lower(regexp_replace(e.full_name, '\s+', ' ', 'g')) = w.norm) as matches,
      (select e.id from ops_hr.employees e
        where lower(regexp_replace(e.full_name, '\s+', ' ', 'g')) = w.norm limit 1) as employee_id
    from raw w
  ),
  classified as (
    select c.*,
      case
        when c.matches = 0 then 'unknown'
        when c.matches > 1 then 'ambiguous'
        when coalesce(c.jam, 0) <= 0 then 'no_hours'
        when exists (select 1 from ops_hr.overtime_lines l
                      where l.sheet_id = v_sheet.id and l.employee_id = c.employee_id) then 'duplicate'
        else 'new'
      end as verdict,
      row_number() over (partition by c.employee_id order by c.ord) as rn
    from counted c
  ),
  ins as (
    insert into ops_hr.overtime_lines (sheet_id, employee_id, hours, task, form_amount)
    select v_sheet.id, c.employee_id, c.jam, coalesce(c.description,'—'), c.gaji
      from classified c where c.verdict = 'new' and c.rn = 1
    returning 1
  )
  select
    (select count(*) from ins)::int,
    count(*) filter (where c.verdict = 'duplicate' or (c.verdict = 'new' and c.rn > 1))::int,
    coalesce(jsonb_agg(distinct c.name) filter (where c.verdict = 'unknown'), '[]'::jsonb),
    coalesce(jsonb_agg(distinct c.name) filter (where c.verdict = 'ambiguous'), '[]'::jsonb),
    coalesce(jsonb_agg(distinct c.name) filter (where c.verdict = 'no_hours'), '[]'::jsonb)
  into v_added, v_dup, v_unknown, v_ambiguous, v_nohours
  from classified c;

  v_res := ops_core.ok('hr','overtime_sheet', p_sheet_no,'import_form',
    jsonb_build_object(
      'sheet_no',  p_sheet_no,
      'filename',  p_filename,
      'added',     v_added,
      -- Kept, and equal to the four below added together.
      'skipped',   v_dup + jsonb_array_length(v_unknown) + jsonb_array_length(v_ambiguous)
                   + jsonb_array_length(v_nohours),
      'duplicate', v_dup,
      'unknown',   v_unknown,
      'ambiguous', v_ambiguous,
      'no_hours',  v_nohours));
  return ops_core.idem_remember('hr','import_overtime_form', p_key, v_res);
end $$;

-- ── the two signatures ────────────────────────────────────────────────────
--
-- One function for both steps, because they are one decision made twice and
-- splitting them would put the ordering rule — *the leader signs after HRD,
-- not instead of* — in two places.
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

grant execute on function
  ops_hr.sheet_is_open(ops_hr.overtime_sheets),
  ops_hr.create_overtime_sheet(ops_hr.overtime_kind_t, date, text, text),
  ops_hr.add_overtime_line(text, text, numeric, text, text, text, numeric, numeric, text),
  ops_hr.import_overtime_form(text, text, jsonb, text),
  ops_hr.decide_overtime_sheet(text, text, boolean, text, text)
  to authenticated;
