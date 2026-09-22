-- 0053_hr_attendance_seams.sql — the writes the attendance half does every
-- day, and the one the demo does by deleting.
--
-- `0040`–`0049` built HR's thirteen tables and twelve views and **not one
-- seam**. Every other schema got its writing side: `ops_procure` has
-- thirty-two, `ops_acct` fourteen, `ops_mkt` twelve. HR has none, which means
-- there is no road into the tables that mints a document number, writes the
-- audit row, or turns a refusal into a sentence rather than an exception — and
-- that is what a real client needs before any HR screen can open (B4).
--
-- This is the daily half: a file off the fingerprint machine, a tap somebody
-- types in because the machine missed it, what HRD says about a day the reader
-- cannot describe, and the allowance withheld for it. The overtime sheets, the
-- payroll runs and the enrolments are their own rows in the ladder.
--
-- ## The one the demo gets wrong, and it is worth the column
--
-- `unmarkDay` **deletes the row**. It cannot here: `day_marks` has no DELETE
-- grant, by the rule that nothing is deleted (A2) — and the rule is right about
-- this one in particular. *Why was the fourteenth marked sick and then not* is
-- exactly the question asked when somebody queries a payslip three months
-- later, and a deleted mark answers it with silence. So a mark is
-- **withdrawn**, with a reason, and both the marking and the withdrawing stay.
--
-- The unique index has to move with it: one mark per person per day was right
-- while marks were forever, and becomes wrong the moment a withdrawn one is
-- still sitting there. It is the live ones that must be unique.

alter table ops_hr.day_marks
  add column withdrawn_at     timestamptz,
  add column withdrawn_by     uuid references ops_core.users(id),
  add column withdrawn_reason text,
  add constraint withdrawal_is_signed check (
    (withdrawn_at is null) = (withdrawn_by is null)
    and (withdrawn_at is null) = (withdrawn_reason is null)
    and (withdrawn_reason is null or length(btrim(withdrawn_reason)) > 0));

alter table ops_hr.day_marks drop constraint mark_once;
-- `nulls not distinct`, as the constraint it replaces had: an office-wide mark
-- carries no employee, and two of those on one day is the same clash as two
-- for one person.
create unique index mark_once on ops_hr.day_marks (work_date, employee_id)
  nulls not distinct where withdrawn_at is null;

-- ── and the four things that read a mark ──────────────────────────────────
--
-- `office_closed`, `read_day`, `v_leave_used` and `v_day_mark_value` were all
-- written when a mark could not be taken back, so every one of them asks for
-- the row and would find a withdrawn one — a day taken back would still spend
-- somebody's leave entitlement and still show on the timesheet.
--
-- They are restated here **verbatim from `0046` with one predicate added to
-- each**, which is the cost of the column and is worth naming: a nullable flag
-- on a table four things read is four places that must learn about it, and the
-- only moment they can all be found is the moment the flag is added. A second
-- table for withdrawn marks would have cost nothing today and made *was this
-- day ever marked* a two-place question for ever.
create or replace function ops_hr.office_closed(p_date date)
returns boolean
language sql stable set search_path = ops_hr, pg_temp as $$
  select exists (
    select 1 from ops_hr.day_marks
     where work_date = p_date and employee_id is null and kind = 'holiday'
       and withdrawn_at is null)
$$;

create or replace function ops_hr.read_day(p_employee uuid, p_date date)
returns setof ops_hr.day_reading
language plpgsql stable set search_path = ops_hr, pg_temp as $$
declare
  emp           ops_hr.employees%rowtype;
  v_rules       jsonb;
  tap           record;
  kept          timestamptz[] := '{}';
  prev          timestamptz;
  rest          timestamptz[];
  v_in          timestamptz; v_bout timestamptz; v_bin timestamptz;
  v_out         timestamptz; v_ots  timestamptz; v_ote timestamptz;
  pick          timestamptz;
  n_taps        int;
  v_issues      text[] := '{}';
  v_notes       text[] := '{}';
  v_break       numeric := 0;
  v_work        numeric := 0;
  v_ot          numeric := 0;
  allowed       int;
  mk            record;
  v_value       numeric := 0;
  v_state       ops_hr.day_state_t;
  v_why         text;
  taken_before  int;
  has_letter    boolean;
  leftover      text;
begin
  select * into emp from ops_hr.employees where id = p_employee;
  if not found then return; end if;
  v_rules := ops_hr.rules_on(p_date);

  /* The taps, de-duplicated. A reader scanned twice inside two minutes is one
     arrival, not two — the real export has 29 of them. Two minutes is long
     enough to swallow a finger that did not take the first time and short
     enough to keep a genuine second tap eleven minutes later, which is a
     different event somebody has to look at (D141). */
  for tap in
    select s.at from ops_hr.attendance_scans s
     where s.employee_id = p_employee and s.work_date = p_date
     order by s.at
  loop
    if prev is null or tap.at - prev >= interval '2 minutes' then
      kept := kept || tap.at;
      prev := tap.at;
    end if;
  end loop;

  n_taps := coalesce(array_length(kept, 1), 0);
  rest := kept;

  /* Each slot takes the first remaining tap that fits, and removes it. The
     windows are the reading, and they are written here rather than buried
     because every reading can be wrong. */
  if n_taps > 0 then
    v_in := rest[1];
    rest := rest[2:];

    select t into pick from unnest(rest) t
      where ops_hr.wita_minutes(t) >= 11*60 and ops_hr.wita_minutes(t) < 13*60+30
      order by t limit 1;
    if pick is not null then v_bout := pick; rest := array_remove(rest, pick); pick := null; end if;

    select t into pick from unnest(rest) t
      where ops_hr.wita_minutes(t) >= 11*60+30 and ops_hr.wita_minutes(t) < 14*60+30
      order by t limit 1;
    if pick is not null then v_bin := pick; rest := array_remove(rest, pick); pick := null; end if;

    select t into pick from unnest(rest) t
      where ops_hr.wita_minutes(t) >= 14*60+30
      order by t limit 1;
    if pick is not null then v_out := pick; rest := array_remove(rest, pick); pick := null; end if;

    if v_out is not null then
      select t into pick from unnest(rest) t where t > v_out order by t limit 1;
      if pick is not null then v_ots := pick; rest := array_remove(rest, pick); pick := null; end if;
    end if;

    if v_ots is not null then
      select t into pick from unnest(rest) t where t > v_ots order by t limit 1;
      if pick is not null then v_ote := pick; rest := array_remove(rest, pick); pick := null; end if;
    end if;
  end if;

  v_break := ops_hr.span_hours(v_bout, v_bin);
  v_work  := greatest(round(ops_hr.span_hours(v_in, v_out) - v_break, 2), 0);
  v_ot    := ops_hr.span_hours(v_ots, v_ote);

  /* Anything the rule could not place. Left-over taps are the loudest signal
     that a day needs a person: they are real events nobody has explained. */
  if coalesce(array_length(rest, 1), 0) > 0 then
    select string_agg(to_char(t at time zone 'Asia/Makassar', 'HH24:MI'), ', ' order by t)
      into leftover from unnest(rest) t;
    v_issues := v_issues || format('%s tap(s) the rule could not place: %s', array_length(rest,1), leftover);
  end if;

  if n_taps > 0 then
    if v_out is null then v_issues := v_issues || 'No pulang — the day has no end'::text; end if;
    if v_bout is null or v_bin is null then v_issues := v_issues || 'Istirahat incomplete'::text; end if;
    if v_ots is not null and v_ote is null then v_issues := v_issues || 'Lembur started and never finished'::text; end if;

    /* A break that ran past its allowance is **reported, never deducted** — it
       is a fact about a day, and turning it into money is the same decision
       lateness has been waiting on since D251. */
    allowed := ops_hr.break_allowance(v_rules, emp.schedule_code, emp.unit, p_date);
    if allowed is not null and v_break * 60 > allowed then
      v_notes := v_notes || format('Istirahat %s menit, lewat %s menit dari jatah %s menit',
        round(v_break*60), round(v_break*60) - allowed, allowed);
    end if;
  end if;

  /* The mark, if there is one, and **the office-wide one wins** (F101, the
     owner's ruling of 2026-09-18). 0045 had it the other way round on my own
     reading of specific-over-general; the owner's answer is that a closed day
     is closed for everybody — *kantor tutup, artinya kita tidak membayar
     siapapun, di luar jadwal kerja* — so a personal mark on it is neither an
     absence nor a permit, and it takes nothing from anybody's entitlement. */
  select m.mark_no, m.kind, m.work_date into mk
    from ops_hr.day_marks m
   where m.work_date = p_date
     and (m.employee_id = p_employee or m.employee_id is null)
     and m.withdrawn_at is null
   order by (m.employee_id is null) desc
   limit 1;

  if mk.mark_no is not null then
    v_state := 'marked';
    case mk.kind
      when 'half_day' then
        v_value := 0.5; v_why := 'Setengah hari — dibayar 0,5 hari.';
      when 'holiday' then
        v_value := 0;
        v_why := case when v_work > 0
          then 'Tanggal merah — jam yang dikerjakan dihitung lembur, harinya sendiri tidak.'
          else 'Tanggal merah — bukan hari kerja.' end;
      when 'sick' then
        select exists (
          select 1 from ops_core.attachment_links l
           where l.entity = 'day_mark' and l.entity_no = mk.mark_no
             and l.kind = 'surat_dokter' and l.unlinked_at is null
        ) into has_letter;
        v_value := case when has_letter then 1 else 0 end;
        v_why := case when has_letter
          then 'Sakit dengan surat dokter — dibayar penuh.'
          else 'Sakit tanpa surat dokter — tidak dibayar.' end;
      when 'leave' then
        select count(*) into taken_before from ops_hr.day_marks m2
         where m2.kind = 'leave' and m2.employee_id = p_employee
           and m2.withdrawn_at is null
           and extract(year from m2.work_date) = extract(year from p_date)
           and m2.work_date < p_date
           and not ops_hr.office_closed(m2.work_date);
        if emp.paid_leave_days - taken_before > 0 then
          v_value := 1;
          v_why := format('Cuti berbayar — sisa hak cuti %s hari sebelum hari ini, dari %s.',
                          emp.paid_leave_days - taken_before, emp.paid_leave_days);
        else
          v_value := 0;
          v_why := format('Cuti di luar hak — jatah %s hari tahun ini sudah habis.', emp.paid_leave_days);
        end if;
      when 'permit' then
        v_value := 0; v_why := 'Izin — tercatat, tidak dibayar.';
      else
        v_value := 0; v_why := 'Tidak masuk tanpa keterangan — tidak dibayar.';
    end case;

    if mk.kind = 'holiday' then
      /* Tanggal merah: being here at all is overtime (owner). The day itself
         is not a working day, so it adds no day_value — the hours do. */
      v_ot := case when v_work > 0 then v_work else v_ot end;
      v_work := 0;
    elsif mk.kind <> 'half_day' then
      /* Away is away: no hours are counted for a day somebody did not work,
         whether or not it is paid. The taps themselves stay untouched — it is
         the counting that stops, not the record (D142). */
      v_work := 0; v_break := 0; v_ot := 0;
    end if;

  elsif n_taps = 0 then
    v_state := 'off'; v_value := 0;
    v_why := 'Tidak ada absensi sama sekali pada hari ini.';
  elsif array_length(v_issues, 1) > 0 then
    v_state := 'review'; v_value := 0;
    v_why := 'Belum dibaca — absensi hari ini tidak lengkap, jadi belum bernilai.';
  else
    v_state := 'complete'; v_value := 1;
    v_why := 'Hari kerja penuh.';
  end if;

  return query select
    p_employee, p_date, v_in, v_bout, v_bin, v_out, v_ots, v_ote,
    n_taps, coalesce(array_length(rest,1), 0),
    v_work, v_break, v_ot, v_value, v_state,
    mk.mark_no, mk.kind, v_why, v_issues, v_notes;
end $$;

-- ── the two views that count an entitlement ───────────────────────────────
--
-- Both are from 0042 and both counted every `leave` mark. Under the ruling a
-- day the office was shut was never that person's to spend, so it does not
-- come off their days — and the *nth* day of the entitlement is counted the
-- same way, or the cap would be spent by days that cost nothing.

create or replace view ops_hr.v_leave_used as
select
  m.employee_id,
  e.employee_no,
  e.full_name,
  extract(year from m.work_date)::int              as year,
  count(*)::int                                    as leave_days_taken,
  e.paid_leave_days                                as entitlement,
  least(count(*), e.paid_leave_days)::int          as leave_days_paid,
  greatest(e.paid_leave_days - count(*), 0)::int   as leave_days_left
from ops_hr.day_marks m
join ops_hr.employees e on e.id = m.employee_id
where m.kind = 'leave'
  and m.withdrawn_at is null
  and not ops_hr.office_closed(m.work_date)
group by m.employee_id, e.employee_no, e.full_name,
         extract(year from m.work_date), e.paid_leave_days;

create or replace view ops_hr.v_day_mark_value as
with leave_nth as (
  select id,
         row_number() over (
           partition by employee_id, extract(year from work_date)
           order by work_date, mark_no
         ) as nth
  from ops_hr.day_marks
  where kind = 'leave' and employee_id is not null
    and withdrawn_at is null
    and not ops_hr.office_closed(work_date)
),
sick_letter as (
  select distinct entity_no
  from ops_core.attachment_links
  where entity = 'day_mark' and kind = 'surat_dokter' and unlinked_at is null
)
select
  m.id,
  m.mark_no,
  m.employee_id,
  m.work_date,
  m.kind,
  m.reason,
  case
    -- The office was shut. Nobody is paid for it and nobody spends anything on
    -- it, whatever their own mark says (F101, owner 2026-09-18).
    when m.employee_id is not null and ops_hr.office_closed(m.work_date) then 0
    when m.kind = 'half_day' then 0.5
    when m.kind = 'sick'     then case when sl.entity_no is not null then 1 else 0 end
    when m.kind = 'leave'    then case when ln.nth <= e.paid_leave_days then 1 else 0 end
    else 0
  end::numeric as day_value,
  case
    when m.employee_id is not null and ops_hr.office_closed(m.work_date)
      then 'kantor tutup — tidak dihitung dan tidak memotong jatah'
    when m.kind = 'half_day' then 'setengah hari'
    when m.kind = 'sick'     then case when sl.entity_no is not null
                                   then 'sakit, surat dokter ada'
                                   else 'sakit, surat dokter belum ada' end
    when m.kind = 'leave'    then case when ln.nth <= e.paid_leave_days
                                   then 'cuti, hari ke-' || ln.nth || ' dari ' || e.paid_leave_days
                                   else 'cuti, melewati jatah ' || e.paid_leave_days || ' hari' end
    when m.kind = 'holiday'  then 'tanggal merah'
    when m.kind = 'permit'   then 'izin, tidak dibayar'
    when m.kind = 'absent'   then 'alpa'
  end as why
from ops_hr.day_marks m
left join ops_hr.employees e on e.id = m.employee_id
left join leave_nth   ln on ln.id = m.id
left join sick_letter sl on sl.entity_no = m.mark_no
where m.withdrawn_at is null;


alter view ops_hr.v_leave_used      set (security_invoker = on);
alter view ops_hr.v_day_mark_value  set (security_invoker = on);

-- ── the file off the machine ──────────────────────────────────────────────
--
-- The import rule for the fifth time (D143, D154): a tap already here is
-- skipped rather than doubled, and **nothing is invented for a row that cannot
-- be placed**. A number the machine printed that matches no employee is
-- counted, named, and left for a person — usually it is a finger registered
-- under an old number, and guessing which one is how a day lands on the wrong
-- payslip.
--
-- The refs are compared with the prefix stripped off both sides. The machine
-- prints `12`; the catalogue says `B-0012`; they are the same person and
-- nothing in either system says so.
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

  -- One statement, so the counts are taken against the same snapshot the
  -- insert reads: a tap cannot be counted as a duplicate of itself.
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
    select w.*, e.id as employee_id
      from raw w
      left join ops_hr.employees e
        on regexp_replace(e.employee_no, '^[A-Za-z]-0*', '') = regexp_replace(w.ref, '^0+', '')
  ),
  classified as (
    select m.*,
      case
        when m.employee_id is null then 'unknown'
        when exists (select 1 from ops_hr.attendance_scans s
                      where s.employee_id = m.employee_id and s.at = m.at) then 'duplicate'
        else 'new'
      end as verdict,
      -- The same tap twice inside one file is the same duplicate as the same
      -- tap across two uploads, and `scan_once` would refuse the whole import.
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
    -- Named and counted, because *four rows we could not place* sends somebody
    -- looking and `0012 · 4 taps` sends them to a person.
    coalesce((select jsonb_agg(jsonb_build_object('ref', u.ref, 'count', u.n) order by u.ref)
                from (select c2.ref, count(*)::int as n from classified c2
                       where c2.verdict = 'unknown' group by c2.ref) u), '[]'::jsonb)
  into v_seen, v_added, v_dup, v_unknown
  from classified c;

  update ops_hr.attendance_imports
     set rows_seen = v_seen, rows_added = v_added,
         rows_duplicate = v_dup, unknown_refs = v_unknown
   where id = v_import;

  -- `attendance.imported`, not `hr.attendance.imported`. `hr` is one of the
  -- **legacy system's own schema names**, so a dotted string starting with it
  -- reads as a reference to that schema and `check_schema_isolation.sh`
  -- refuses the file — rightly, since the guard that keeps us out of the
  -- running system's schemas is not one to make cleverer (F116). `identity`
  -- had already solved this without saying so: it emits `access.changed`. The
  -- service is its own column on the outbox row, so the prefix was decoration
  -- (F122).
  perform ops_core.emit('hr','attendance.imported', p_filename,
    jsonb_build_object('filename', p_filename, 'import_id', v_import,
                       'added', v_added, 'unknown', v_unknown));

  v_res := ops_core.ok('hr','attendance_import', p_filename,'import',
    jsonb_build_object('import_id', v_import, 'seen', v_seen, 'added', v_added,
                       'duplicates', v_dup, 'unknown', v_unknown));
  return ops_core.idem_remember('hr','import_scans', p_key, v_res);
end $$;

-- ── a tap the machine missed ──────────────────────────────────────────────
--
-- Typed in by a person, and therefore **saying why**. A time with no reason is
-- indistinguishable from a tap on the reader, and the whole value of
-- `source = 'manual'` is that a payroll dispute can tell them apart.
create or replace function ops_hr.add_scan(
  p_employee_no text,
  p_at          timestamptz,
  p_reason      text,
  p_key         text default null)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare v_replayed jsonb; v_emp ops_hr.employees; v_res jsonb;
begin
  v_replayed := ops_core.idem_replay('hr','add_scan', p_key);
  if v_replayed is not null then return v_replayed; end if;

  if not ops_core.has_permission('hrd.create') then
    return ops_core.refused('hr','attendance', p_employee_no,'add_scan',
      'not_permitted','Adding a tap needs HR access.');
  end if;
  if coalesce(btrim(coalesce(p_reason,'')), '') = '' then
    return ops_core.invalid('hr','attendance', p_employee_no,'add_scan',
      'reason_required','A time somebody typed needs to say why the machine missed it.',
      jsonb_build_object('field','reason'));
  end if;

  select e.* into v_emp from ops_hr.employees e where e.employee_no = p_employee_no;
  if not found then
    return ops_core.not_found('hr','attendance', p_employee_no,'add_scan',
      format('No employee %s.', p_employee_no));
  end if;

  if exists (select 1 from ops_hr.attendance_scans s
              where s.employee_id = v_emp.id and s.at = p_at) then
    return ops_core.conflict('hr','attendance', p_employee_no,'add_scan',
      'already_recorded','Tap itu sudah tercatat.');
  end if;

  insert into ops_hr.attendance_scans
    (employee_id, work_date, at, verify, source, reason, recorded_by)
  -- **The office day, not the server's** (F17, F39, F102). A tap at 08:05 in
  -- Makassar belongs to that morning and UTC has not caught up.
  values (v_emp.id, ops_core.office_day(p_at), p_at,'MANUAL','manual',
          btrim(p_reason), auth.uid());

  v_res := ops_core.ok('hr','attendance', p_employee_no,'add_scan',
    jsonb_build_object('employee_no', p_employee_no,
                       'work_date', ops_core.office_day(p_at), 'at', p_at));
  return ops_core.idem_remember('hr','add_scan', p_key, v_res);
end $$;

-- ── what HRD says about a day the reader cannot describe ──────────────────
--
-- A public holiday, an afternoon the power went, somebody off sick. **Marking
-- is not editing**: the taps stay exactly as they were, and a mark for
-- everybody carries no employee at all (D142).
create or replace function ops_hr.mark_day(
  p_work_date   date,
  p_kind        ops_hr.day_mark_t,
  p_reason      text,
  p_employee_no text default null,
  p_key         text default null)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare v_replayed jsonb; v_emp ops_hr.employees; v_no text; v_clash ops_hr.day_marks; v_res jsonb;
begin
  v_replayed := ops_core.idem_replay('hr','mark_day', p_key);
  if v_replayed is not null then return v_replayed; end if;

  if not ops_core.has_permission('hrd.create') then
    return ops_core.refused('hr','day_mark', null,'mark',
      'not_permitted','Marking a day needs HR access.');
  end if;
  if coalesce(btrim(coalesce(p_reason,'')), '') = '' then
    return ops_core.invalid('hr','day_mark', null,'mark',
      'reason_required',
      'Say what happened. *Setengah hari* with no reason is a decision nobody '
      'can check in six months.', jsonb_build_object('field','reason'));
  end if;

  if p_employee_no is not null then
    select e.* into v_emp from ops_hr.employees e where e.employee_no = p_employee_no;
    if not found then
      return ops_core.not_found('hr','day_mark', null,'mark',
        format('No employee %s.', p_employee_no));
    end if;
  end if;

  select m.* into v_clash from ops_hr.day_marks m
   where m.work_date = p_work_date
     and m.employee_id is not distinct from v_emp.id
     and m.withdrawn_at is null;
  if found then
    return ops_core.conflict('hr','day_mark', v_clash.mark_no,'mark',
      'already_marked',
      format('%s is already marked as %s %s.', p_work_date, v_clash.kind,
             coalesce('for ' || v_emp.full_name, 'for everybody')));
  end if;

  insert into ops_hr.day_marks (employee_id, work_date, kind, reason, marked_by)
  values (v_emp.id, p_work_date, p_kind, btrim(p_reason), auth.uid())
  returning mark_no into v_no;

  v_res := ops_core.ok('hr','day_mark', v_no,'mark',
    jsonb_build_object('mark_no', v_no, 'work_date', p_work_date, 'kind', p_kind,
                       'employee_no', p_employee_no,
                       'office_wide', p_employee_no is null));
  return ops_core.idem_remember('hr','mark_day', p_key, v_res);
end $$;

-- ── taking a mark back, which is not deleting it ──────────────────────────
create or replace function ops_hr.withdraw_mark(
  p_mark_no text, p_reason text, p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare v_replayed jsonb; v_mark ops_hr.day_marks; v_res jsonb;
begin
  v_replayed := ops_core.idem_replay('hr','withdraw_mark', p_key);
  if v_replayed is not null then return v_replayed; end if;

  if not ops_core.has_permission('hrd.update') then
    return ops_core.refused('hr','day_mark', p_mark_no,'withdraw',
      'not_permitted','Withdrawing a mark needs HR access.');
  end if;
  if coalesce(btrim(coalesce(p_reason,'')), '') = '' then
    return ops_core.invalid('hr','day_mark', p_mark_no,'withdraw',
      'reason_required',
      'Tulis kenapa ditarik. *Kenapa tanggal itu ditandai sakit lalu tidak* '
      'adalah pertanyaan yang muncul ketika slip gajinya dipersoalkan.',
      jsonb_build_object('field','reason'));
  end if;

  select m.* into v_mark from ops_hr.day_marks m where m.mark_no = p_mark_no;
  if not found then
    return ops_core.not_found('hr','day_mark', p_mark_no,'withdraw',
      format('No mark %s.', p_mark_no));
  end if;
  if v_mark.withdrawn_at is not null then
    return ops_core.conflict('hr','day_mark', p_mark_no,'withdraw',
      'already_withdrawn','Tanda itu sudah ditarik.');
  end if;

  update ops_hr.day_marks
     set withdrawn_at = now(), withdrawn_by = auth.uid(), withdrawn_reason = btrim(p_reason)
   where mark_no = p_mark_no;

  v_res := ops_core.ok('hr','day_mark', p_mark_no,'withdraw',
    jsonb_build_object('mark_no', p_mark_no, 'work_date', v_mark.work_date,
                       'was', v_mark.kind),
    jsonb_build_object('withdrawn', false),
    jsonb_build_object('withdrawn', true));
  return ops_core.idem_remember('hr','withdraw_mark', p_key, v_res);
end $$;

-- ── the allowance for a day, withheld and restored ────────────────────────
--
-- Withholding is priced by `0047` and applied by the payroll line; what
-- happens here is only the decision, which is a person's and says why. The
-- pair is not an update in place: `restored_*` sits beside the withholding, so
-- the payslip can show that a deduction was made **and** taken back rather
-- than showing neither (A5).
create or replace function ops_hr.withhold_allowance(
  p_employee_no text, p_work_date date, p_reason text, p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare v_replayed jsonb; v_emp ops_hr.employees; v_res jsonb;
begin
  v_replayed := ops_core.idem_replay('hr','withhold_allowance', p_key);
  if v_replayed is not null then return v_replayed; end if;

  if not ops_core.has_permission('hrd.update') then
    return ops_core.refused('hr','allowance', p_employee_no,'withhold',
      'not_permitted','Withholding an allowance needs HR access.');
  end if;
  if coalesce(btrim(coalesce(p_reason,'')), '') = '' then
    return ops_core.invalid('hr','allowance', p_employee_no,'withhold',
      'reason_required','Uang makan yang dipotong tanpa alasan adalah potongan yang tidak bisa dijelaskan.',
      jsonb_build_object('field','reason'));
  end if;

  select e.* into v_emp from ops_hr.employees e where e.employee_no = p_employee_no;
  if not found then
    return ops_core.not_found('hr','allowance', p_employee_no,'withhold',
      format('No employee %s.', p_employee_no));
  end if;
  if exists (select 1 from ops_hr.allowance_withholdings w
              where w.employee_id = v_emp.id and w.work_date = p_work_date) then
    return ops_core.conflict('hr','allowance', p_employee_no,'withhold',
      'already_withheld',
      format('Uang makan %s pada %s sudah dipotong.', v_emp.full_name, p_work_date));
  end if;

  insert into ops_hr.allowance_withholdings (employee_id, work_date, reason, "by")
  values (v_emp.id, p_work_date, btrim(p_reason), auth.uid());

  v_res := ops_core.ok('hr','allowance', p_employee_no,'withhold',
    jsonb_build_object('employee_no', p_employee_no, 'work_date', p_work_date));
  return ops_core.idem_remember('hr','withhold_allowance', p_key, v_res);
end $$;

create or replace function ops_hr.restore_allowance(
  p_employee_no text, p_work_date date, p_reason text, p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare v_replayed jsonb; v_emp ops_hr.employees; v_row ops_hr.allowance_withholdings; v_res jsonb;
begin
  v_replayed := ops_core.idem_replay('hr','restore_allowance', p_key);
  if v_replayed is not null then return v_replayed; end if;

  if not ops_core.has_permission('hrd.update') then
    return ops_core.refused('hr','allowance', p_employee_no,'restore',
      'not_permitted','Restoring an allowance needs HR access.');
  end if;
  if coalesce(btrim(coalesce(p_reason,'')), '') = '' then
    return ops_core.invalid('hr','allowance', p_employee_no,'restore',
      'reason_required','Dikembalikan karena apa? Itu yang dibaca di slip gajinya.',
      jsonb_build_object('field','reason'));
  end if;

  select e.* into v_emp from ops_hr.employees e where e.employee_no = p_employee_no;
  if not found then
    return ops_core.not_found('hr','allowance', p_employee_no,'restore',
      format('No employee %s.', p_employee_no));
  end if;

  select w.* into v_row from ops_hr.allowance_withholdings w
   where w.employee_id = v_emp.id and w.work_date = p_work_date;
  if not found then
    return ops_core.not_found('hr','allowance', p_employee_no,'restore',
      format('Tidak ada potongan uang makan %s pada %s.', p_employee_no, p_work_date));
  end if;
  if v_row.restored_at is not null then
    return ops_core.conflict('hr','allowance', p_employee_no,'restore',
      'already_restored','Potongan itu sudah dikembalikan.');
  end if;

  update ops_hr.allowance_withholdings
     set restored_by = auth.uid(), restored_at = now(), restored_reason = btrim(p_reason)
   where id = v_row.id;

  v_res := ops_core.ok('hr','allowance', p_employee_no,'restore',
    jsonb_build_object('employee_no', p_employee_no, 'work_date', p_work_date));
  return ops_core.idem_remember('hr','restore_allowance', p_key, v_res);
end $$;

-- The seams are the road in. `0041` granted insert and update directly, from
-- before there was one; those grants stay because a migration that takes a
-- grant away from a table another session may already be writing to is not a
-- change to make from here — but every caller should come through the
-- functions above, which is where the number, the trail and the refusal are.
grant execute on function
  ops_hr.import_scans(text, jsonb, text),
  ops_hr.add_scan(text, timestamptz, text, text),
  ops_hr.mark_day(date, ops_hr.day_mark_t, text, text, text),
  ops_hr.withdraw_mark(text, text, text),
  ops_hr.withhold_allowance(text, date, text, text),
  ops_hr.restore_allowance(text, date, text, text)
  to authenticated;
