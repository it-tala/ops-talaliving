-- 0244 — lembur dibayar menurut jam: istirahat lembur dipotong, lewat 22.00
-- tarifnya sendiri, setiap rentang jam tercetak (D396).
--
-- ── the owner's ask (2026-10-08) ──────────────────────────────────────────
--
--   RIAN 21/09, taps 07.51 and 22.44, approved from the payroll as 5,5 jam
--   and paid *1×1,5 + 4,5×2*: *ini kebalik, harusnya 4,5 dihitung 1,5x lalu
--   1 jam 2x tambahkan detil per jamnya jadi*
--
--     21/09 17:15–17:30  0,25  LOADING CONTAINER STD 4
--     21/09 18:30–22:00  3,5   LOADING CONTAINER STD 4
--     21/09 22:00–22:44  0,75  LOADING CONTAINER STD 4
--
--   Asked to choose (the statutory ladder of PP 35/2021 pays more), the owner
--   kept his rule: 1,5× until 22.00, 2× after; overtime starts at the
--   schedule's end; 17.30–18.30 is an unpaid overtime break; each range is
--   rounded to the nearest 15 minutes.
--
-- Two things were wrong, and only one of them is the rule book's:
--
--   * the hours. 5,5 was the machine's 17.15–22.44 with the break inside it;
--     an approval that stores **hours** cannot leave a break out, so a line
--     now stores **when** it started and finished (`from_minutes`, beside
--     0195's `until_minutes`) and is cut by the clock (`ot_segments`): the
--     overtime break (`overtime_break_from_minutes` / `_to_minutes`, new rule
--     keys) left out, the part past `overtime_night_after_minutes` at
--     `overtime_night_multiplier`, the rest on the day's ladder, each range
--     rounded by `overtime_rounding_minutes`;
--   * the multipliers — the rule book's ladder, which the owner sets in a new
--     version (workday 1,5× flat, 2× after 22.00), not this file.
--
-- `overtime_parts` returns one row per clock range with the range as its
-- label, so the slip prints *17.15–17.30 · 0,25 jam* rather than *jam ke-1*.
-- A line without clock times (every sheet before this) is read as before.
-- `approve_day_overtime` takes the start and finish (defaulting to the
-- schedule's end and the last tap) and derives the hours;
-- `overtime_preview` shows HRD the ranges and the money before approving.

/* ── when an overtime line started ─────────────────────────────────────── */
alter table ops_hr.overtime_lines
  add column if not exists from_minutes int
    check (from_minutes is null or (from_minutes >= 0 and from_minutes <= 1440));
comment on column ops_hr.overtime_lines.from_minutes is
  'Jam mulai lembur (menit dari tengah malam, jam kantor). Dengan until_minutes, lembur dibayar per rentang jam (0244, D396).';

/* ── an evening, cut by the clock ──────────────────────────────────────────

   From `p_from` to `p_until` (past midnight when the finish is not after the
   start), less the overtime break, cut at the night line. Each range is
   rounded on its own; the ranges before the night line climb the day's
   ladder together, the ones past it are paid at the night multiplier (0195).
   Pure: the rule book is passed in. */
create or replace function ops_hr.ot_segments(p_rules jsonb, p_rest boolean, p_from int, p_until int)
returns table (seg_from int, seg_until int, hours numeric, multiplier numeric)
language plpgsql immutable set search_path = ops_hr, pg_temp as $$
declare
  v_mode      text := coalesce(p_rules->>'overtime_mode', 'tiered');
  roundm      numeric := coalesce((p_rules->>'overtime_rounding_minutes')::numeric, 0);
  night_after int := (p_rules->>'overtime_night_after_minutes')::int;
  night_mult  numeric := (p_rules->>'overtime_night_multiplier')::numeric;
  bf          int := (p_rules->>'overtime_break_from_minutes')::int;
  bt          int := (p_rules->>'overtime_break_to_minutes')::int;
  tiers       jsonb;
  s int; e int; k int; i int; a int; b int;
  pts int[];
  m numeric; h numeric; cum numeric := 0;
  t record; lo numeric; hi numeric;
begin
  if p_from is null or p_until is null then return; end if;
  s := p_from; e := p_until;
  if e <= s then e := e + 1440; end if;
  if night_after is null or night_mult is null then night_after := null; end if;
  if bf is null or bt is null or bt <= bf then bf := null; bt := null; end if;

  pts := array[s, e];
  for k in 0 .. 1 loop
    if night_after is not null and night_after + 1440 * k > s and night_after + 1440 * k < e then
      pts := pts || (night_after + 1440 * k);
    end if;
    if bf is not null then
      if bf + 1440 * k > s and bf + 1440 * k < e then pts := pts || (bf + 1440 * k); end if;
      if bt + 1440 * k > s and bt + 1440 * k < e then pts := pts || (bt + 1440 * k); end if;
    end if;
  end loop;
  select array_agg(distinct x order by x) into pts from unnest(pts) x;

  tiers := case
    when v_mode = 'flat' then jsonb_build_array(jsonb_build_object(
      'after_hours', 0, 'multiplier', coalesce((p_rules->>'flat_multiplier')::numeric, 1.5)))
    when p_rest then coalesce(p_rules->'restday_tiers', '[]'::jsonb)
    else             coalesce(p_rules->'workday_tiers', '[]'::jsonb)
  end;

  for i in 1 .. array_length(pts, 1) - 1 loop
    a := pts[i]; b := pts[i + 1];
    -- The overtime break is nobody's paid time.
    if bf is not null and ((a >= bf and b <= bt) or (a >= bf + 1440 and b <= bt + 1440)) then
      continue;
    end if;
    m := b - a;
    if roundm > 0 then m := round(m / roundm) * roundm; end if;
    if m <= 0 then continue; end if;
    h := m / 60.0;

    if night_after is not null and a >= night_after then
      seg_from := a % 1440; seg_until := b % 1440;
      hours := round(h, 2); multiplier := night_mult;
      return next;
      continue;
    end if;

    -- The day's ladder, over every hour before the night line so far.
    for t in
      select (x->>'after_hours')::numeric as af, (x->>'multiplier')::numeric as mu,
             lead((x->>'after_hours')::numeric) over (order by (x->>'after_hours')::numeric) as nx
        from jsonb_array_elements(tiers) x
       order by 1
    loop
      lo := greatest(cum, t.af);
      hi := least(cum + h, coalesce(t.nx, cum + h));
      if hi > lo then
        seg_from := (a + round((lo - cum) / h * (b - a)))::int % 1440;
        seg_until := (a + round((hi - cum) / h * (b - a)))::int % 1440;
        hours := round(hi - lo, 2); multiplier := t.mu;
        return next;
      end if;
    end loop;
    cum := cum + h;
  end loop;
end $$;
grant execute on function ops_hr.ot_segments(jsonb, boolean, int, int) to authenticated;

/* ── a person's evening, as the machine saw it ─────────────────────────────

   Where overtime on a day starts and ends by default: the end of that
   weekday's schedule (the first tap on a day off), and the last tap. Null
   where the day says neither. */
create or replace function ops_hr.day_overtime_window(p_employee uuid, p_date date,
  out from_minutes int, out until_minutes int)
language plpgsql stable set search_path = ops_hr, pg_temp as $$
declare emp ops_hr.employees; d ops_hr.day_reading; v_sd jsonb; v_last timestamptz;
begin
  select * into emp from ops_hr.employees where id = p_employee;
  if not found then return; end if;
  select * into d from ops_hr.read_day(p_employee, p_date);
  v_sd := ops_hr.schedule_day(ops_hr.pattern_on(emp.schedule_code, emp.unit, p_date), p_date);
  if v_sd is not null and not coalesce((v_sd->>'off')::boolean, false) then
    from_minutes := ops_hr.minutes_of(v_sd -> 'end_minutes');
  end if;
  if from_minutes is null and d.in_at is not null then
    from_minutes := (extract(hour from d.in_at at time zone ops_core.office_tz()) * 60
                     + extract(minute from d.in_at at time zone ops_core.office_tz()))::int;
  end if;
  v_last := greatest(d.out_at, d.ot_end_at);
  if v_last is not null then
    until_minutes := (extract(hour from v_last at time zone ops_core.office_tz()) * 60
                      + extract(minute from v_last at time zone ops_core.office_tz()))::int;
  end if;
end $$;
grant execute on function ops_hr.day_overtime_window(uuid, date) to authenticated;

/* ── what approving would pay, before approving ─────────────────────────── */
create or replace function ops_hr.overtime_preview(
  p_employee_no text, p_work_date date, p_from_minutes int default null, p_until_minutes int default null)
returns table (from_minutes int, until_minutes int, seg_from int, seg_until int,
               hours numeric, multiplier numeric, hourly bigint, amount bigint)
language plpgsql stable security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare emp ops_hr.employees; v_rules jsonb; rate ops_hr.hourly_rate_t; w record; exact numeric; seg record;
begin
  if not (ops_core.has_permission('hrd.read') or ops_core.has_permission('payroll.read')) then return; end if;
  select * into emp from ops_hr.employees e where e.employee_no = p_employee_no;
  if not found then return; end if;
  v_rules := ops_hr.rules_on(p_work_date);
  rate := ops_hr.hourly_rate(emp, v_rules);
  exact := case when coalesce((v_rules->>'overtime_exact_hourly')::boolean, false)
                then rate.annual::numeric
                     / greatest(coalesce((v_rules->>'effective_days_per_year')::numeric, 300), 1)
                     / greatest(emp.daily_hours, 1) end;
  select * into w from ops_hr.day_overtime_window(emp.id, p_work_date);
  from_minutes := coalesce(p_from_minutes, w.from_minutes);
  until_minutes := coalesce(p_until_minutes, w.until_minutes);
  if from_minutes is null or until_minutes is null then
    seg_from := null; seg_until := null; hours := null; multiplier := null; hourly := rate.hourly; amount := null;
    return next; return;
  end if;
  for seg in select * from ops_hr.ot_segments(v_rules, ops_hr.is_rest_day(v_rules, p_work_date),
                                              from_minutes, until_minutes) loop
    seg_from := seg.seg_from; seg_until := seg.seg_until; hours := seg.hours;
    multiplier := seg.multiplier; hourly := rate.hourly;
    amount := round(seg.hours * seg.multiplier * coalesce(exact, rate.hourly))::bigint;
    return next;
  end loop;
end $$;
revoke execute on function ops_hr.overtime_preview(text, date, int, int) from public;
grant execute on function ops_hr.overtime_preview(text, date, int, int) to authenticated;

/* ── approving by the clock — restated from 0243 ───────────────────────── */
drop function if exists ops_hr.approve_day_overtime(text, date, numeric, text, text);

create or replace function ops_hr.approve_day_overtime(
  p_employee_no text, p_work_date date, p_hours numeric, p_reason text, p_key text default null,
  p_from_minutes int default null, p_until_minutes int default null)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare
  v_replayed jsonb; v_emp ops_hr.employees; v_live record; v_id uuid; v_no text; v_res jsonb;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_from int := p_from_minutes; v_until int := p_until_minutes; v_hours numeric := p_hours; w record;
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
  if (v_from is not null and (v_from < 0 or v_from > 1440))
     or (v_until is not null and (v_until < 0 or v_until > 1440)) then
    return ops_core.invalid('hr','overtime_sheet', p_employee_no,'approve_day',
      'bad_time','Jam mulai dan selesai ditulis sebagai jam kantor.', jsonb_build_object('field','from_minutes'));
  end if;
  select * into v_emp from ops_hr.employees e where e.employee_no = p_employee_no;
  if not found then
    return ops_core.not_found('hr','overtime_sheet', p_employee_no,'approve_day',
      format('No employee %s.', p_employee_no));
  end if;

  /* 0244 (D396): by the clock wherever it can be — what was typed, else the
     schedule's end and the last tap — and the hours are the clock's, less
     the overtime break, rounded as the rule book says. Hours alone only when
     the day gives no clock at all. */
  if v_hours is null or v_from is not null or v_until is not null then
    select * into w from ops_hr.day_overtime_window(v_emp.id, p_work_date);
    v_from := coalesce(v_from, w.from_minutes);
    v_until := coalesce(v_until, w.until_minutes);
    if v_from is null or v_until is null then
      return ops_core.invalid('hr','overtime_sheet', p_employee_no,'approve_day',
        'time_required','Jam mulai dan selesai lembur belum diketahui — tulis keduanya.',
        jsonb_build_object('field','from_minutes'));
    end if;
    select coalesce(sum(s.hours), 0) into v_hours
      from ops_hr.ot_segments(ops_hr.rules_on(p_work_date),
                              ops_hr.is_rest_day(ops_hr.rules_on(p_work_date), p_work_date),
                              v_from, v_until) s;
  end if;
  if v_hours is null or v_hours <= 0 or v_hours > 12 then
    return ops_core.invalid('hr','overtime_sheet', p_employee_no,'approve_day',
      'hours_out_of_range','Jam lembur lebih dari nol dan sampai 12.',
      jsonb_build_object('field','hours'));
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
  insert into ops_hr.overtime_lines (sheet_id, employee_id, hours, task, from_minutes, until_minutes)
  values (v_id, v_emp.id, v_hours, v_reason, v_from, v_until);

  v_res := ops_core.ok('hr','overtime_sheet', v_no,'approve_day',
    jsonb_build_object('sheet_no', v_no, 'employee_no', p_employee_no,
                       'work_date', p_work_date, 'hours', v_hours, 'reason', v_reason,
                       'from_minutes', v_from, 'until_minutes', v_until));
  return ops_core.idem_remember('hr','approve_day_overtime', p_key, v_res);
end $$;
revoke execute on function ops_hr.approve_day_overtime(text, date, numeric, text, text, int, int) from public;
grant execute on function ops_hr.approve_day_overtime(text, date, numeric, text, text, int, int) to authenticated;

/* ── overtime, range by range — restated from 0195 ─────────────────────── */
create or replace function ops_hr.overtime_parts(p_employee uuid, p_from date, p_to date)
returns table (sheet_no text, work_date date, hours numeric, multiplier numeric,
               hourly bigint, amount bigint, label text)
language plpgsql stable set search_path = ops_hr, pg_temp as $$
declare
  emp    ops_hr.employees%rowtype;
  v_rules jsonb;
  rate   ops_hr.hourly_rate_t;
  mode   text;
  roundm numeric;
  ln     record;
  rest   boolean;
  tiers  jsonb;
  hrs    numeric;
  pt     record;
  -- 0195 (D340)
  night_after int;
  night_mult  numeric;
  night_hrs   numeric;
  exact       numeric;
  -- 0244 (D396)
  seg         record;
begin
  select * into emp from ops_hr.employees where id = p_employee;
  if not found then return; end if;
  v_rules := ops_hr.rules_on(p_from);
  rate    := ops_hr.hourly_rate(emp, v_rules);
  mode    := coalesce(v_rules->>'overtime_mode', 'tiered');
  roundm  := coalesce((v_rules->>'overtime_rounding_minutes')::numeric, 0);
  /* 0195: the hours past 22.00 are paid at their own rate (the sheet's
     *lembur di atas 22.00*, 2×), and the ladder applies to the rest. */
  night_after := (v_rules->>'overtime_night_after_minutes')::int;
  night_mult  := (v_rules->>'overtime_night_multiplier')::numeric;
  /* The hour **before** rounding to the rupiah, so 3,5 jam × 1,5 × 170.500/8
     is 111.891 as the sheet has it, not 3,5 × 1,5 × 21.313. Opt-in. */
  exact := case when coalesce((v_rules->>'overtime_exact_hourly')::boolean, false)
                then rate.annual::numeric
                     / greatest(coalesce((v_rules->>'effective_days_per_year')::numeric, 300), 1)
                     / greatest(emp.daily_hours, 1)
           end;

  for ln in
    select l.hours as h, l.form_amount, l.until_minutes as um, l.from_minutes as fm,
           c.sheet_no as sno, c.work_date as wd
      from ops_hr.v_overtime_claim c
      join ops_hr.overtime_lines l on l.sheet_id = c.id
     where c.payable and l.employee_id = p_employee
       and c.work_date between p_from and p_to
     order by c.work_date, c.sheet_no
  loop
    if ln.form_amount is not null then
      sheet_no := ln.sno; work_date := ln.wd; hours := ln.h; multiplier := 0;
      hourly := rate.hourly; amount := round(ln.form_amount)::bigint;
      label := 'Sesuai form lembur';
      return next;
      continue;
    end if;

    if mode = 'form_only' then
      sheet_no := ln.sno; work_date := ln.wd; hours := ln.h; multiplier := 0;
      hourly := rate.hourly; amount := 0;
      label := 'Tidak ada angka di form — tidak dibayar';
      return next;
      continue;
    end if;

    /* 0244 (D396): a line that says when it started and finished is paid by
       the clock — the overtime break left out, the part past
       `overtime_night_after_minutes` at its own rate, each range on its own
       row with the range as its label. */
    if ln.fm is not null and ln.um is not null then
      for seg in select * from ops_hr.ot_segments(v_rules, ops_hr.is_rest_day(v_rules, ln.wd), ln.fm, ln.um) loop
        sheet_no := ln.sno; work_date := ln.wd; hours := seg.hours;
        multiplier := seg.multiplier; hourly := rate.hourly;
        amount := round(seg.hours * seg.multiplier * coalesce(exact, rate.hourly))::bigint;
        label := ops_hr.clock_face(seg.seg_from) || '–' || ops_hr.clock_face(seg.seg_until);
        return next;
      end loop;
      continue;
    end if;

    hrs := case when roundm = 0 then ln.h
                else round(ln.h / (roundm/60)) * (roundm/60) end;
    rest := ops_hr.is_rest_day(v_rules, ln.wd);

    /* The part past 22.00, when the line says when it finished. A finish
       before noon is the next morning. */
    night_hrs := 0;
    if night_after is not null and night_mult is not null and ln.um is not null then
      night_hrs := least(hrs, greatest(
        (case when ln.um < 720 then ln.um + 1440 else ln.um end - night_after) / 60.0, 0));
      hrs := hrs - night_hrs;
      if night_hrs > 0 then
        sheet_no := ln.sno; work_date := ln.wd; hours := round(night_hrs, 2);
        multiplier := night_mult; hourly := rate.hourly;
        amount := round(night_hrs * night_mult * coalesce(exact, rate.hourly))::bigint;
        label := format('Lembur lewat %s', ops_hr.clock_face(night_after));
        return next;
      end if;
    end if;
    tiers := case
      when mode = 'flat' then jsonb_build_array(jsonb_build_object(
        'after_hours', 0, 'multiplier', coalesce((v_rules->>'flat_multiplier')::numeric, 1.5)))
      when rest then coalesce(v_rules->'restday_tiers', '[]'::jsonb)
      else           coalesce(v_rules->'workday_tiers', '[]'::jsonb)
    end;

    for pt in select * from ops_hr.tier_parts(hrs, tiers) loop
      sheet_no := ln.sno; work_date := ln.wd; hours := pt.part_hours;
      multiplier := pt.multiplier; hourly := rate.hourly;
      amount := round(pt.part_hours * pt.multiplier * coalesce(exact, rate.hourly))::bigint;
      label := case when mode = 'flat'
        then format('Tarif rata %s×', pt.multiplier)
        else format('%s · jam %s', case when rest then 'Hari libur' else 'Hari kerja' end,
                    case when pt.part_hours <= 1 then format('ke-%s', round(pt.from_hour + 1))
                         else format('%s–%s', round(pt.from_hour + 1), round(pt.from_hour + pt.part_hours)) end)
      end;
      return next;
    end loop;
  end loop;
end $$;

