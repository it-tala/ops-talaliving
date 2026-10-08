-- 0246 — hari dibayar menurut jam; istirahat bisa tidak dipotong; tap salah
-- ketik bisa dihapus (D398).
--
-- ── the owner's ask (2026-10-08) ──────────────────────────────────────────
--
--   DEWI 16/09, taps 08.00 and 12.00, read 3 jam: *setengah hari sebelum jam
--   istirahat tapi sudah dikurangi 1 jam. perhitungan masih pakai per hari
--   masuk, bukan jam. bagaimana kalau HRD salah input jam tap nya? … kalau
--   bekerja sampai jam 14.00 lalu pulang? tidak bisa disebut setengah hari …
--   berikan juga opsi jika tetap bekerja di jam istirahat, baik ketika
--   overtime ataupun jam makan siang biasa, atau di hari sabtu dan minggu.*
--
-- Asked, the owner answered: a short day is paid **in proportion to its
-- hours**, salary and allowance alike, with no tolerance; the break is not
-- placed on the clock — HRD **ticks a day** when the break was worked (or not
-- taken) and the deduction goes; on Sabtu/Minggu the lunch break is taken off
-- too unless ticked.
--
--   * `payroll_line_for`: a complete, unmarked working day worth less than
--     its schedule is worth `work_hours ÷ scheduled_hours` of a day — the day
--     wage times that, the salary's share of the day times that, the
--     allowance of the day times that. Shown per day (`fraction`) and in a
--     warning; for a salary the shortfall sits in `absence_deduction` beside
--     the alpa. A half-day mark keeps its own rule (0,5; D272).
--   * `break_waivers` + `keep_break`: *istirahat tidak dipotong* for a person
--     and a day, with a reason. The day's hours get the break back; the
--     evening's overtime keeps 17.30–18.30; a rest day's overtime keeps its
--     lunch.
--   * A rest day's overtime (from the first tap, 0245) now loses the
--     pattern's break after four hours of work (`rest_break_minutes` into
--     `ot_segments`), unless the day is ticked.
--   * `voided_scans` + `void_scan`: a tap HRD typed (`source = 'manual'`) is
--     moved out of the record with who, when and why — the reading never sees
--     it again. The machine's and the phone's taps are facts and stay.

/* ── istirahat tidak dipotong ──────────────────────────────────────────── */
create table ops_hr.break_waivers (
  id               uuid primary key default gen_random_uuid(),
  employee_id      uuid not null references ops_hr.employees(id),
  work_date        date not null,
  reason           text not null check (length(btrim(reason)) > 0),
  by               uuid not null references ops_core.users(id),
  at               timestamptz not null default now(),
  withdrawn_by     uuid references ops_core.users(id),
  withdrawn_at     timestamptz,
  withdrawn_reason text,
  constraint waiver_withdraw_complete check (
    (withdrawn_by is null and withdrawn_at is null and withdrawn_reason is null)
    or (withdrawn_by is not null and withdrawn_at is not null
        and withdrawn_reason is not null and length(btrim(withdrawn_reason)) > 0))
);
create unique index break_waived_once on ops_hr.break_waivers (employee_id, work_date)
  where withdrawn_at is null;
alter table ops_hr.break_waivers enable row level security;
create policy break_waivers_read on ops_hr.break_waivers for select to authenticated
  using (ops_core.has_permission('hrd.read') or ops_core.has_permission('payroll.read'));
grant select on ops_hr.break_waivers to authenticated;
analyze ops_hr.break_waivers;

create or replace function ops_hr.break_kept(p_employee uuid, p_date date)
returns boolean
language sql stable set search_path = ops_hr, pg_temp as $$
  select exists (select 1 from ops_hr.break_waivers w
                  where w.employee_id = p_employee and w.work_date = p_date and w.withdrawn_at is null)
$$;
grant execute on function ops_hr.break_kept(uuid, date) to authenticated;

create or replace function ops_hr.keep_break(
  p_employee_no text, p_work_date date, p_keep boolean, p_reason text, p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare v_replayed jsonb; v_emp ops_hr.employees; v_id uuid; v_res jsonb;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  v_replayed := ops_core.idem_replay('hr','keep_break', p_key);
  if v_replayed is not null then return v_replayed; end if;
  if not ops_core.has_permission('hrd.update') then
    return ops_core.refused('hr','attendance', p_employee_no,'keep_break',
      'not_permitted','Istirahat yang tidak dipotong diatur HRD.');
  end if;
  if v_reason = '' then
    return ops_core.invalid('hr','attendance', p_employee_no,'keep_break',
      'reason_required','Kenapa istirahatnya tidak dipotong? Kalimatnya yang dibaca kalau hari itu dipertanyakan.',
      jsonb_build_object('field','reason'));
  end if;
  select * into v_emp from ops_hr.employees e where e.employee_no = p_employee_no;
  if not found then
    return ops_core.not_found('hr','attendance', p_employee_no,'keep_break',
      format('No employee %s.', p_employee_no));
  end if;
  select w.id into v_id from ops_hr.break_waivers w
   where w.employee_id = v_emp.id and w.work_date = p_work_date and w.withdrawn_at is null;
  if coalesce(p_keep, false) then
    if v_id is not null then
      return ops_core.conflict('hr','attendance', p_employee_no,'keep_break',
        'already_kept', 'Istirahat hari itu sudah tidak dipotong.');
    end if;
    insert into ops_hr.break_waivers (employee_id, work_date, reason, "by")
    values (v_emp.id, p_work_date, v_reason, auth.uid());
  else
    if v_id is null then
      return ops_core.conflict('hr','attendance', p_employee_no,'keep_break',
        'not_kept', 'Istirahat hari itu memang dipotong.');
    end if;
    update ops_hr.break_waivers
       set withdrawn_by = auth.uid(), withdrawn_at = now(), withdrawn_reason = v_reason
     where id = v_id;
  end if;
  v_res := ops_core.ok('hr','attendance', p_employee_no,'keep_break',
    jsonb_build_object('employee_no', p_employee_no, 'work_date', p_work_date,
                       'kept', coalesce(p_keep, false), 'reason', v_reason));
  return ops_core.idem_remember('hr','keep_break', p_key, v_res);
end $$;
revoke execute on function ops_hr.keep_break(text, date, boolean, text, text) from public;
grant execute on function ops_hr.keep_break(text, date, boolean, text, text) to authenticated;

/* ── a tap HRD typed wrong ─────────────────────────────────────────────── */
create table ops_hr.voided_scans (
  id           uuid primary key,
  employee_id  uuid not null references ops_hr.employees(id),
  work_date    date not null,
  at           timestamptz not null,
  source       ops_hr.scan_source_t not null,
  reason       text,
  recorded_by  uuid references ops_core.users(id),
  recorded_at  timestamptz not null,
  scan         jsonb not null,
  voided_by    uuid not null references ops_core.users(id),
  voided_at    timestamptz not null default now(),
  void_reason  text not null check (length(btrim(void_reason)) > 0)
);
alter table ops_hr.voided_scans enable row level security;
create policy voided_scans_read on ops_hr.voided_scans for select to authenticated
  using (ops_core.has_permission('hrd.read') or ops_core.has_permission('payroll.read'));
grant select on ops_hr.voided_scans to authenticated;
analyze ops_hr.voided_scans;

/* Moved, not erased: the row as it was, and who took it out and why. Only a
   time HRD typed — the machine's and the phone's taps are what happened. */
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
  if s.source <> 'manual' then
    return ops_core.conflict('hr','attendance', v_no,'void_scan',
      'not_manual',
      'Hanya tap yang diketik HRD yang bisa dihapus. Tap dari mesin atau HP adalah kejadian — kalau hari itu salah dibaca, tandai harinya.');
  end if;
  insert into ops_hr.voided_scans (id, employee_id, work_date, at, source, reason, recorded_by,
                                   recorded_at, scan, voided_by, void_reason)
  values (s.id, s.employee_id, s.work_date, s.at, s.source, s.reason, s.recorded_by,
          s.recorded_at, to_jsonb(s), auth.uid(), v_reason);
  delete from ops_hr.attendance_scans where id = s.id;
  v_res := ops_core.ok('hr','attendance', v_no,'void_scan',
    jsonb_build_object('employee_no', v_no, 'work_date', s.work_date,
                       'at', s.at, 'reason', v_reason));
  return ops_core.idem_remember('hr','void_scan', p_key, v_res);
end $$;
revoke execute on function ops_hr.void_scan(uuid, text, text) from public;
grant execute on function ops_hr.void_scan(uuid, text, text) to authenticated;

/* What the drawer's day editor needs beside the marks: the days whose break
   is kept, and the taps HRD typed (the ones it can take back). */
create or replace function ops_hr.person_day_extras(p_employee_no text, p_from date, p_to date)
returns table (kind text, id uuid, work_date date, at timestamptz, reason text)
language sql stable security definer set search_path = ops_hr, ops_core, pg_temp as $$
  select 'break_kept', w.id, w.work_date, w.at, w.reason
    from ops_hr.break_waivers w join ops_hr.employees e on e.id = w.employee_id
   where e.employee_no = p_employee_no and w.work_date between p_from and p_to
     and w.withdrawn_at is null
     and (ops_core.has_permission('hrd.read') or ops_core.has_permission('payroll.read'))
  union all
  select 'manual_scan', s.id, s.work_date, s.at, s.reason
    from ops_hr.attendance_scans s join ops_hr.employees e on e.id = s.employee_id
   where e.employee_no = p_employee_no and s.work_date between p_from and p_to
     and s.source = 'manual'
     and (ops_core.has_permission('hrd.read') or ops_core.has_permission('payroll.read'))
   order by 3, 4
$$;
revoke execute on function ops_hr.person_day_extras(text, date, date) from public;
grant execute on function ops_hr.person_day_extras(text, date, date) to authenticated;

/* ── an evening's rules, for one person and one day ───────────────────────

   The rule book, with the day's own facts folded in: a kept break keeps the
   overtime break too; a rest day loses the pattern's break after four hours
   unless the break is kept. */
create or replace function ops_hr.ot_rules_for(p_rules jsonb, p_employee uuid, p_date date)
returns jsonb
language plpgsql stable set search_path = ops_hr, pg_temp as $$
declare emp ops_hr.employees; v_pat jsonb; v_b int;
begin
  if ops_hr.break_kept(p_employee, p_date) then
    return p_rules - 'overtime_break_from_minutes' - 'overtime_break_to_minutes';
  end if;
  if ops_hr.is_rest_day(p_rules, p_date) then
    select * into emp from ops_hr.employees where id = p_employee;
    v_pat := ops_hr.pattern_on(emp.schedule_code, emp.unit, p_date);
    v_b := coalesce(ops_hr.minutes_of(ops_hr.schedule_day(v_pat, p_date) -> 'break_minutes'),
                    ops_hr.minutes_of(v_pat -> 'break_minutes'));
    if coalesce(v_b, 0) > 0 then
      return p_rules || jsonb_build_object('rest_break_minutes', v_b);
    end if;
  end if;
  return p_rules;
end $$;
grant execute on function ops_hr.ot_rules_for(jsonb, uuid, date) to authenticated;

/* ── restated from 0245 ── */
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
  -- 0246 (D398): a rest day's lunch, after four hours of work.
  rb int := (p_rules->>'rest_break_minutes')::int;
  rbf int; rbt int;
begin
  if p_from is null or p_until is null then return; end if;
  s := p_from; e := p_until;
  /* 0245 (D397): a finish before the start is the next morning only when it
     is before noon (0195's reading of `until_minutes`); 17.15 → 16.00 on the
     same day is no overtime at all, not twenty-two hours of it. */
  if e = s then return; end if;
  if e < s then
    if p_until >= 720 then return; end if;
    e := e + 1440;
  end if;
  if night_after is null or night_mult is null then night_after := null; end if;
  if bf is null or bt is null or bt <= bf then bf := null; bt := null; end if;

  if p_rest and coalesce(rb, 0) > 0 and e - s > 240 then
    rbf := s + 240; rbt := s + 240 + rb;
  end if;

  pts := array[s, e];
  if rbf is not null then
    if rbf < e then pts := pts || rbf; end if;
    if rbt < e then pts := pts || rbt; end if;
  end if;
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
    -- Nor a rest day's lunch (0246).
    if rbf is not null and a >= rbf and b <= rbt then
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

/* ── restated from 0244 ── */
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
      -- 0246 (D398): the day's own rules — a kept break, a rest day's lunch.
      for seg in select * from ops_hr.ot_segments(ops_hr.ot_rules_for(v_rules, p_employee, ln.wd),
                                                  ops_hr.is_rest_day(v_rules, ln.wd), ln.fm, ln.um) loop
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
  for seg in select * from ops_hr.ot_segments(ops_hr.ot_rules_for(v_rules, emp.id, p_work_date),
                                              ops_hr.is_rest_day(v_rules, p_work_date),
                                              from_minutes, until_minutes) loop
    seg_from := seg.seg_from; seg_until := seg.seg_until; hours := seg.hours;
    multiplier := seg.multiplier; hourly := rate.hourly;
    amount := round(seg.hours * seg.multiplier * coalesce(exact, rate.hourly))::bigint;
    return next;
  end loop;
end $$;
revoke execute on function ops_hr.overtime_preview(text, date, int, int) from public;
grant execute on function ops_hr.overtime_preview(text, date, int, int) to authenticated;

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
      from ops_hr.ot_segments(ops_hr.ot_rules_for(ops_hr.rules_on(p_work_date), v_emp.id, p_work_date),
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

/* ── what a line carries now ── */
alter type ops_hr.payroll_figures
  add attribute days_short int cascade;

/* ── the payroll line — restated from 0242 ──────────────────────────────
   Changes are marked 0246 (D398). */
create or replace function ops_hr.payroll_line_for(
  p_employee uuid, p_from date, p_to date, p_run_no text default null)
returns ops_hr.payroll_figures
language plpgsql stable set search_path = ops_hr, pg_temp as $$
declare
  emp       ops_hr.employees%rowtype;
  v_rules   jsonb;
  rate      ops_hr.hourly_rate_t;
  d         ops_hr.day_reading;
  out_row   ops_hr.payroll_figures;
  sc        jsonb;
  day_start int;
  grace     int;
  ut_mode   text;
  ut_grace  numeric;
  short     numeric := 0;
  half_days int := 0;
  gap       numeric;
  is_present boolean;
  withheld  boolean;
  n_present int := 0;
  n_withheld int := 0;
  shown_ot  numeric := 0;
  pending_ot numeric := 0;
  no_letter int := 0;
  over_leave int := 0;
  late_one  int;
  w         text[] := '{}';
  v_days    jsonb := '[]'::jsonb;
  -- 0195 (D340)
  v_mult     numeric;
  paid_units numeric := 0;
  paid_hours numeric := 0;
  prem_days  numeric := 0;
  prem_extra numeric := 0;
  allow_prem boolean;
  v_dstart   int;
  allow_units numeric := 0;
  allow_byval boolean;
  -- 0202 (D357)
  v_proj     boolean;
  v_ot_from  date;
  v_ot_to    date;
  v_assumed  boolean;
  n_assumed  int := 0;
  -- 0212 (D370)
  v_run      ops_hr.payroll_runs%rowtype;
  c_run      jsonb := '{}'::jsonb;
  c_person   jsonb := '{}'::jsonb;
  v_pnote    text;
  v_unpaid   date[] := '{}';
  v_employed boolean;
  v_mb       jsonb;
  v_off      jsonb := '[]'::jsonb;
  v_cut      bigint;
  v_k        text;
  -- 0213 (D373)
  v_late_day int;
  v_mb_full  jsonb;
  v_adj_pos  numeric := 0;
  v_adj_neg  numeric := 0;
  -- 0230 (D386)
  v_aday         numeric := 0;
  v_amonth       date;
  v_amonth_days  int := 0;
  v_allow_amt    numeric := 0;
  v_withheld_amt numeric := 0;
  -- 0242 (D394)
  v_today        date := ops_core.office_day();
  v_unconf       boolean;
  v_conf         boolean;
  n_unconf       int := 0;
  -- 0246 (D398)
  v_frac         numeric;
  v_kept         boolean;
  n_short        int := 0;
  v_short_days   numeric := 0;
  v_short_amt    numeric := 0;
  v_smonth       date;
  v_mdays        int := 0;
  v_absence_on   boolean;
begin
  select * into emp from ops_hr.employees where id = p_employee;
  if not found then return null; end if;
  /* The book in force **when the period opened**, which is the whole reason
     the rule book is dated (D173). */
  v_rules  := ops_hr.rules_on(p_from);
  rate     := ops_hr.hourly_rate(emp, v_rules);
  sc       := ops_hr.schedule_of(v_rules, emp.schedule_code, emp.unit);
  day_start := coalesce((sc->>'start_minutes')::int, (v_rules->>'day_starts_minutes')::int);
  grace    := coalesce((v_rules->>'late_grace_minutes')::int, 0);
  ut_mode  := coalesce(v_rules->>'undertime_mode', 'off');
  ut_grace := coalesce((v_rules->>'undertime_grace_minutes')::numeric, 0) / 60;
  -- 0195: whether a day paid at more than one day's rate also earns the
  -- allowance. The sheet pays insentif and tunjangan Senin–Jumat only.
  allow_prem := coalesce((v_rules->>'allowance_on_premium_days')::boolean, true);
  -- 0195: a half day earns half the allowance, as the sheet pays it
  -- (`insentif × SUM(Senin..Jumat)`), rather than a whole one (D272).
  allow_byval := coalesce((v_rules->>'allowance_by_day_value')::boolean, false);
  /* 0202 (D357): the pay week is approved on its last day, before that day is
     over. For somebody paid by the day or hour, that last day counts as the
     schedule says it should — a full day — and the overtime this line pays is
     the week moved back by one day, so the last day's overtime is paid with
     the week after. A monthly salary is a month and is not projected. */
  v_proj    := emp.pay_basis <> 'monthly' and ops_hr.pay_week_projected(v_rules, p_from, p_to);
  v_ot_from := case when v_proj then p_from - 1 else p_from end;
  v_ot_to   := case when v_proj then p_to - 1 else p_to end;

  /* 0212 (D370): the run's switches, and this person's own over them. A run
     nobody opened has none, and every component is paid. */
  if p_run_no is not null then
    select * into v_run from ops_hr.payroll_runs where run_no = p_run_no;
    if found then
      c_run := coalesce(v_run.components, '{}'::jsonb);
      select m.components, m.note into c_person, v_pnote
        from ops_hr.payroll_run_members m
       where m.run_no = p_run_no and m.employee_id = emp.id;
      c_person := coalesce(c_person, '{}'::jsonb);
    end if;
  end if;

  out_row.run_no := coalesce(p_run_no, '');
  out_row.employee_id := emp.id;
  out_row.employee_no := emp.employee_no;
  out_row.full_name := emp.full_name;
  -- Who this is, which a payslip prints and the contract has always asked for.
  out_row.position := emp.position;
  out_row.pay_basis := emp.pay_basis;
  out_row.base_rate := emp.base_rate;
  out_row.allowance_rate := emp.allowance_rate;
  out_row.worked_days := 0; out_row.open_days := 0;
  out_row.days_present := 0; out_row.days_sick_paid := 0;
  out_row.days_leave_paid := 0; out_row.days_unpaid := 0;
  out_row.normal_hours := 0;
  out_row.late_minutes := 0;
  out_row.late_days := 0;

  for d in select * from ops_hr.timesheet(emp.id, p_from, p_to) loop
    v_late_day := 0;
    /* 0202 (D357): the last day of a projected week, unless HRD marked it, is
       the full day the schedule says — whatever the machine has so far. Its
       taps and its overtime are left for the week after. */
    v_assumed := v_proj and d.work_date = p_to and d.mark_kind is null
                 and d.scheduled_hours is not null
                 -- Never a day somebody was not employed on.
                 and (emp.left_on is null or emp.left_on >= p_to)
                 and (emp.joined_on is null or emp.joined_on <= p_to);
    if v_assumed then
      d.state := 'complete'; d.day_value := 1;
      d.work_hours := round(d.scheduled_hours, 2);
      d.overtime_hours := 0; d.in_at := null; d.out_at := null;
      n_assumed := n_assumed + 1;
    end if;
    /* 0246 (D398): a day is worth its hours. HRD's *istirahat tidak
       dipotong* gives the day its break back first; then a complete, unmarked
       working day short of its schedule is worth work ÷ schedule of a day —
       no tolerance, as the owner asked. A half-day mark keeps its 0,5 (D272);
       a rest day, an assumed day, a shift or a night (D364) and a day outside
       employment are not cut. */
    v_frac := null;
    v_kept := d.taps > 0 and ops_hr.break_kept(emp.id, d.work_date);
    if v_kept and d.mark_kind is null then
      d.work_hours := d.work_hours + coalesce(d.break_hours, 0);
    end if;
    if emp.pay_basis in ('monthly','daily') and d.mark_kind is null and d.state = 'complete'
       and not coalesce(v_assumed, false) and coalesce(d.scheduled_hours, 0) > 0
       -- A shift or a night is one day of pay, whichever it was (D364).
       and d.shift_code is null and not coalesce(d.overnight, false)
       and d.work_hours < d.scheduled_hours
       and ops_hr.is_workday_for(v_rules, sc, d.work_date)
       and (emp.joined_on is null or d.work_date >= emp.joined_on)
       and (emp.left_on is null or d.work_date <= emp.left_on) then
      v_frac := round(greatest(d.work_hours, 0) / d.scheduled_hours, 4);
      d.day_value := v_frac;
      n_short := n_short + 1;
      v_short_days := v_short_days + (1 - v_frac);
      if emp.pay_basis = 'monthly' then
        if v_smonth is distinct from date_trunc('month', d.work_date)::date then
          v_smonth := date_trunc('month', d.work_date)::date;
          v_mdays := ops_hr.month_workdays(v_rules, sc, d.work_date);
        end if;
        if v_mdays > 0 then
          v_short_amt := v_short_amt + emp.base_rate::numeric / v_mdays * (1 - v_frac);
        end if;
      end if;
    end if;

    out_row.worked_days := out_row.worked_days + d.day_value;
    if d.state = 'review' then out_row.open_days := out_row.open_days + 1; end if;

    /* 0242 (D394): a salaried person's working day with **no tap and no mark**
       is not presence any more — it is a day nobody has accounted for, and it
       waits for HRD the way an unread day does (*wajib dicek dulu*). HRD
       answers it: hadir tanpa tap (a confirmation), or any mark (alpa, izin,
       sakit, cuti). Somebody HRD exempted from attendance — a leader who does
       not tap — is present on it as before (F72). Never a day still to come,
       nor one outside employment. */
    v_unconf := false; v_conf := false;
    if emp.pay_basis = 'monthly' and d.mark_kind is null and d.taps = 0
       and d.work_date <= v_today
       and (emp.joined_on is null or d.work_date >= emp.joined_on)
       and (emp.left_on is null or d.work_date <= emp.left_on)
       and ops_hr.is_workday_for(v_rules, sc, d.work_date) then
      v_conf := exists (select 1 from ops_hr.presence_confirmations pc
                         where pc.employee_id = emp.id and pc.work_date = d.work_date
                           and pc.withdrawn_at is null);
      if not v_conf and not ops_hr.attendance_exempt_on(emp.id, d.work_date) then
        v_unconf := true;
        n_unconf := n_unconf + 1;
        out_row.open_days := out_row.open_days + 1;
        -- Not paid until somebody says it was worked: the salary's share of
        -- the day comes off the way an unpaid mark's does.
        v_unpaid := v_unpaid || d.work_date;
      end if;
    end if;
    if d.day_value > 0 then out_row.normal_hours := out_row.normal_hours + d.work_hours; end if;
    shown_ot := shown_ot + d.overtime_hours;

    /* 0195 (D340): what the day is worth in days of pay. Sabtu, Minggu and a
       tanggal merah somebody came in on are worth their multiplier; the
       monthly salary is a month and does not move. */
    v_mult := coalesce(d.pay_multiplier, 1);
    paid_units := paid_units + d.day_value * v_mult;
    if d.day_value > 0 then paid_hours := paid_hours + d.work_hours * v_mult; end if;
    if v_mult > 1 and d.day_value > 0 then
      prem_days  := prem_days + d.day_value;
      prem_extra := prem_extra + d.day_value * (v_mult - 1);
    end if;

    /* The slip's own line for this day, built where the day is already in
       hand. `open` is carried rather than dropped: a day with hours beside it
       that adds nothing to the total is the one worth asking about (D156). */
    v_days := v_days || jsonb_build_object(
      'work_date', d.work_date,
      'weekday', extract(isodow from d.work_date)::int,
      'in_at', d.in_at,
      'out_at', d.out_at,
      'work_hours', d.work_hours,
      'overtime_hours', d.overtime_hours,
      'mark', case d.mark_kind
                when 'holiday'  then 'merah'
                when 'sick'     then 'sakit'
                when 'leave'    then 'cuti'
                when 'half_day' then 'setengah'
                when 'absent'   then 'alpa'
                else d.mark_kind::text end,
      'day_value', d.day_value,
      'multiplier', coalesce(d.pay_multiplier, 1),
      'scheduled_hours', d.scheduled_hours,
      'assumed', v_assumed,
      'shift', d.shift_code,
      'open', d.state = 'review' or v_unconf,
      -- 0242 (D394): no tap, no mark, nobody has said; and HRD said hadir.
      'unconfirmed', v_unconf,
      'confirmed', v_conf,
      -- 0246 (D398): what share of a day its hours are worth, and whether
      -- HRD kept the break.
      'fraction', v_frac,
      'break_kept', v_kept);

    /* What the paid days are made of, so a payslip can say it rather than
       showing one total nobody can take apart (D144). */
    if d.mark_kind is null then
      if d.day_value > 0 then out_row.days_present := out_row.days_present + d.day_value; end if;
    else
      case d.mark_kind
        when 'half_day' then out_row.days_present := out_row.days_present + d.day_value;
        when 'sick'  then
          if d.day_value > 0 then out_row.days_sick_paid := out_row.days_sick_paid + 1;
          else no_letter := no_letter + 1; end if;
        when 'leave' then
          if d.day_value > 0 then out_row.days_leave_paid := out_row.days_leave_paid + 1;
          else over_leave := over_leave + 1; end if;
        else null;
      end case;
      if d.day_value = 0 and d.mark_kind <> 'holiday' then
        out_row.days_unpaid := out_row.days_unpaid + 1;
        -- 0212: what a salary loses — alpa, izin, sakit tanpa surat, cuti di
        -- luar jatah. A half day is not on the list (Q63).
        v_unpaid := v_unpaid || d.work_date;
      end if;
    end if;

    /* Tunjangan is paid for **coming in**. A monthly person earns it on the
       days the business works, because the fingerprint reader is a workshop
       device and the office does not use it — making it depend on taps for
       everybody paid five office staff Rp 600.000 a month less than the day
       before (F72). No taps is not evidence of absence.

       A half day is presence, and since Q46 that is the owner's ruling rather
       than our reading of one (D272). Sakit, cuti and tanggal merah are not. */
    if emp.pay_basis = 'monthly' then
      /* 0230 (D386): a day the person's pattern works — the same days the
         monthly allowance is divided by, so a month with nothing marked pays
         exactly the month's allowance. */
      is_present := case when d.mark_kind is not null then d.mark_kind = 'half_day'
                         else ops_hr.is_workday_for(v_rules, sc, d.work_date) end;
      -- 0242 (D394): not until somebody accounts for it.
      if v_unconf then is_present := false; end if;
      /* 0212: never a day before somebody started or after they left — the
         business working that day is not this person coming in. */
      v_employed := (emp.joined_on is null or d.work_date >= emp.joined_on)
                and (emp.left_on is null or d.work_date <= emp.left_on);
      if not v_employed then is_present := false; end if;
    else
      is_present := case when d.mark_kind is not null then d.mark_kind = 'half_day'
                         else d.day_value > 0 end;
      if not allow_prem and coalesce(d.pay_multiplier, 1) > 1 then is_present := false; end if;
    end if;

    if is_present then
      /* 0230 (D386): what this day's allowance is worth. A monthly allowance
         is a month, divided by that month's working days for this person; a
         day wage's allowance is already a day. Kept unrounded and rounded
         once, so 22 days of 1.350.000 ÷ 22 is 1.350.000, not 1.349.998. */
      if emp.pay_basis = 'monthly' then
        if v_amonth is distinct from date_trunc('month', d.work_date)::date then
          v_amonth := date_trunc('month', d.work_date)::date;
          v_amonth_days := ops_hr.month_workdays(v_rules, sc, d.work_date);
        end if;
        v_aday := case when v_amonth_days > 0
                       then emp.allowance_rate::numeric / v_amonth_days else 0 end;
      else
        v_aday := emp.allowance_rate;
      end if;
      select exists (
        select 1 from ops_hr.allowance_withholdings aw
         where aw.employee_id = emp.id and aw.work_date = d.work_date
           and aw.restored_by is null
      ) into withheld;
      if withheld then
        n_withheld := n_withheld + 1;
        v_withheld_amt := v_withheld_amt + v_aday;
      else
        n_present := n_present + 1;
        allow_units := allow_units + case when d.day_value > 0 then d.day_value else 1 end;
        -- 0246 (D398): a short day earns the allowance in proportion too.
        v_allow_amt := v_allow_amt + v_aday * case when v_frac is not null then v_frac
                                                   when allow_byval and d.day_value > 0
                                                   then d.day_value else 1 end;
      end if;
    end if;

    /* Minutes late past the grace the owner set (Q41, D251). Nobody has said
       when this person's day starts, so nothing about it is late — not zero
       because they were punctual, zero because there is no threshold, and
       inventing one puts minutes on a payslip (D274). */
    /* 0195: late against **this weekday's** start — Saturday begins at 08.00
       where Monday begins at 07.30. */
    /* 0206 (D364): somebody on shifts is late against the shift they worked —
       17.00 for Shift 2, not the pattern's 07.00. */
    v_dstart := null;
    if d.shift_code is not null then
      select ops_hr.minutes_of(x -> 'start_minutes') into v_dstart
        from jsonb_array_elements(ops_hr.pattern_on(emp.schedule_code, emp.unit, d.work_date) -> 'shifts') x
       where x ->> 'code' = d.shift_code limit 1;
    end if;
    v_dstart := coalesce(v_dstart,
                         ops_hr.minutes_of(ops_hr.schedule_day(sc, d.work_date) -> 'start_minutes'), day_start);
    if d.in_at is not null and d.mark_kind is null and v_dstart is not null then
      late_one := greatest(ops_hr.late_minutes(d.in_at, d.work_date, v_dstart, grace), 0);
      out_row.late_minutes := out_row.late_minutes + late_one;
      v_late_day := late_one;
      -- **How many days**, beside how many minutes. Ninety minutes is a
      -- different conversation once across a month than nine minutes on ten
      -- mornings, and one number cannot tell those apart.
      if late_one > 0 then out_row.late_days := out_row.late_days + 1; end if;
    end if;

    /* Hours short of the contracted day. Only for people paid by the day: an
       hourly person is already paid for the hours they were here and a monthly
       salary is a month. A marked day is not a short day, it is a different
       day, and counting it here would deduct twice (D174). */
    if ut_mode <> 'off' and emp.pay_basis = 'daily'
       and d.mark_kind is null and d.state = 'complete' and v_frac is null then
      gap := emp.daily_hours - d.work_hours;
      if gap > ut_grace then
        short := short + gap;
        if gap > emp.daily_hours / 2 then half_days := half_days + 1; end if;
      end if;
    end if;

    /* 0213 (D373): the day's lateness on the day's own line, so the sheet can
       show duration, lateness and overtime side by side. */
    v_days := jsonb_set(v_days, array[(jsonb_array_length(v_days) - 1)::text, 'late_minutes'],
                        to_jsonb(v_late_day));
  end loop;

  out_row.days := v_days;

  out_row.normal_hours := round(out_row.normal_hours, 2);
  out_row.worked_days  := round(out_row.worked_days, 2);
  out_row.hourly       := rate.hourly;
  out_row.hourly_basis := rate.basis;
  -- Both sums the rule book offers, and the year they come from. The screen
  -- shows the one not chosen beside the one that was, which is the only way
  -- *why is my hour worth this* has an answer (D249).
  out_row.company_hourly   := rate.company;
  out_row.statutory_hourly := rate.statutory;
  out_row.annual_pay       := rate.annual;

  /* Monthly staff are paid the month whatever the machine says; a daily or
     hourly person is paid for what they were here for. That difference is the
     only place `pay_basis` is used, and it is why it exists. */
  /* 0212 (D370): a salary is the month only when the month was worked. The
     share of each month's working days the period covers, inside employment,
     less the days HRD marked unpaid — unless the run or the person has the
     `absence` switch off. */
  out_row.base_pay := case emp.pay_basis
    when 'monthly' then emp.base_rate
    when 'daily'   then round(paid_units * emp.base_rate)
    else                round(paid_hours * emp.base_rate)
  end::bigint;
  out_row.base_full := out_row.base_pay;
  out_row.proration := '[]'::jsonb;
  if emp.pay_basis = 'monthly' then
    v_mb := ops_hr.monthly_base(emp.base_rate, v_rules, sc, emp.joined_on, emp.left_on,
              p_from, p_to, v_unpaid,
              coalesce((c_person ->> 'absence')::boolean, (c_run ->> 'absence')::boolean, true));
    out_row.base_pay  := (v_mb ->> 'amount')::bigint;
    out_row.proration := v_mb -> 'months';
    /* 0246 (D398): the short days' shortfall, beside the alpa — under the
       same `absence` switch. */
    v_absence_on := coalesce((c_person ->> 'absence')::boolean, (c_run ->> 'absence')::boolean, true);
    if v_absence_on then
      out_row.base_pay := out_row.base_pay - round(v_short_amt)::bigint;
    end if;
    /* 0213 (D373): what the alpa took, apart from what the calendar did —
       the salary with nothing marked, less the salary as paid. Zero when the
       `absence` switch is off, because then nothing was taken. */
    v_mb_full := ops_hr.monthly_base(emp.base_rate, v_rules, sc, emp.joined_on, emp.left_on,
                   p_from, p_to, v_unpaid, false);
    out_row.absence_deduction := (v_mb_full ->> 'amount')::bigint - (v_mb ->> 'amount')::bigint
                                 + case when v_absence_on then round(v_short_amt)::bigint else 0 end;
  else
    out_row.absence_deduction := 0;
  end if;

  /* 0213 (D373): a day of this person's pay — the salary over the first
     month's working days, the day wage, or the hour wage over a contracted
     day. The hour beside it is `hourly`, the one overtime is priced at. */
  out_row.daily_rate := case emp.pay_basis
    when 'monthly' then case when coalesce((v_mb -> 'months' -> 0 ->> 'workdays')::int, 0) > 0
                             then round(emp.base_rate / (v_mb -> 'months' -> 0 ->> 'workdays')::numeric)
                        end
    when 'daily'   then emp.base_rate
    else                round(emp.base_rate * coalesce(emp.daily_hours, 0))
  end::bigint;

  out_row.allowance_days := n_present;
  out_row.allowance_withheld_days := n_withheld;
  /* 0230 (D386): the sum of each day's worth, above — for a day wage the
     same figure as before, for a salary the month's allowance shared over its
     working days. */
  out_row.allowance_pay := round(v_allow_amt)::bigint;
  -- What the withheld days would have paid, and **who decided each one**. A
  -- deduction with no name against it is the kind a payslip cannot defend.
  out_row.allowance_withheld_amount := round(v_withheld_amt)::bigint;
  /* 0230 (D386): a day of the allowance, beside a day of the pay — for a
     salary, the allowance over the first month's working days. */
  out_row.allowance_daily := case
    when emp.pay_basis <> 'monthly' then emp.allowance_rate
    when coalesce((v_mb -> 'months' -> 0 ->> 'workdays')::int, 0) > 0
      then round(emp.allowance_rate / (v_mb -> 'months' -> 0 ->> 'workdays')::numeric)
  end::bigint;
  select coalesce(jsonb_agg(jsonb_build_object(
           'work_date', aw.work_date,
           'reason', aw.reason,
           'by_name', coalesce(u.full_name, '')) order by aw.work_date), '[]'::jsonb)
    into out_row.allowance_withheld
    from ops_hr.allowance_withholdings aw
    left join ops_core.users u on u.id = aw."by"
   where aw.employee_id = emp.id
     and aw.work_date between p_from and p_to
     and aw.restored_by is null;

  select coalesce(sum(amount), 0), coalesce(sum(hours), 0)
    into out_row.overtime_pay, out_row.overtime_hours
    from ops_hr.overtime_parts(emp.id, v_ot_from, v_ot_to);

  /* The rungs, not just the total. *3 jam lembur = Rp 91.000* invites an
     argument; *jam ke-1 × 1,5 + 2 jam × 2* ends one (D173) — and the function
     that produces them was already being called for the total. */
  select coalesce(jsonb_agg(jsonb_build_object(
           'source', op.sheet_no, 'work_date', op.work_date, 'hours', op.hours,
           'multiplier', op.multiplier, 'hourly', op.hourly,
           'amount', op.amount, 'label', op.label)
           order by op.work_date, op.multiplier), '[]'::jsonb)
    into out_row.overtime_parts
    from ops_hr.overtime_parts(emp.id, v_ot_from, v_ot_to) op;

  out_row.undertime_hours := round(short, 2);
  out_row.undertime_amount := case
    when ut_mode = 'half_day_step' then round(half_days * (emp.base_rate / 2.0))
    when ut_mode = 'off' then 0
    else round(short * rate.hourly) end::bigint;

  /* What the hours would cost — *potongannya jam saja* (D251). Computed
     whatever the mode and **applied only when the mode says so**, so the rule
     book can price it before anybody switches it on and a payslip can show
     what is not being deducted rather than leaving the minutes looking free. */
  out_row.late_priced := round((out_row.late_minutes / 60.0) * rate.hourly)::bigint;
  out_row.late_deduction := case when coalesce(v_rules->>'late_mode','manual') = 'pro_rata'
                                 then out_row.late_priced else 0 end;

  select coalesce(sum(amount), 0) into out_row.adjustment_total
    from ops_hr.payroll_adjustments a
   where a.run_no = p_run_no and a.employee_id = emp.id
     and a.withdrawn_at is null;

  /* Each one named, with the sentence somebody typed beside it. A payslip that
     says *penyesuaian −150.000* and nothing else is the reason people come to
     the counter (D155).

     No `label`: there is no such column, and there should not be. The word for
     a `kind` is presentation and it already lives in `ADJUSTMENT_LABEL` on the
     client — storing it beside the kind would be the same string in two places
     with a migration needed to reword it. */
  select coalesce(jsonb_agg(jsonb_build_object(
           'kind', a.kind, 'amount', a.amount,
           'reason', coalesce(a.reason, '')) order by a.created_at), '[]'::jsonb)
    into out_row.adjustments
    from ops_hr.payroll_adjustments a
   where a.run_no = p_run_no and a.employee_id = emp.id
     and a.withdrawn_at is null;

  /* 0212 (D370): the switches. Each component that is off is zero on this
     line, and listed with what it would have been and whose decision it was —
     the person's own switch over the run's. */
  foreach v_k in array ops_hr.pay_components() loop
    if coalesce((c_person ->> v_k)::boolean, (c_run ->> v_k)::boolean, true) then
      continue;
    end if;
    v_cut := case v_k
      when 'base'      then out_row.base_pay
      when 'allowance' then out_row.allowance_pay
      when 'overtime'  then out_row.overtime_pay
      when 'late'      then out_row.late_deduction
      when 'undertime' then out_row.undertime_amount
      else 0 end;
    case v_k
      when 'base'      then out_row.base_pay := 0;
      when 'allowance' then out_row.allowance_pay := 0;
      when 'overtime'  then out_row.overtime_pay := 0;
      when 'late'      then out_row.late_deduction := 0;
      when 'undertime' then out_row.undertime_amount := 0;
      else null;
    end case;
    -- `absence` and `contributions` are priced where they are applied. For
    -- the three deductions the amount is the deduction *not* taken.
    if v_k = 'absence' then
      v_cut := case when emp.pay_basis = 'monthly'
        -- The deduction not taken: the salary without it, less with it.
        then (v_mb ->> 'amount')::bigint
             - (ops_hr.monthly_base(emp.base_rate, v_rules, sc,
                  emp.joined_on, emp.left_on, p_from, p_to, v_unpaid, true) ->> 'amount')::bigint
             + round(v_short_amt)::bigint
        else 0 end;
    end if;
    v_off := v_off || jsonb_build_object(
      'component', v_k,
      'amount', coalesce(v_cut, 0),
      'scope', case when (c_person ->> v_k) is not null then 'person' else 'run' end,
      'reason', coalesce(case when (c_person ->> v_k) is not null then v_pnote
                              else v_run.components_note end, ''));
  end loop;

  out_row.gross := out_row.base_pay + out_row.allowance_pay + out_row.overtime_pay
                 - out_row.undertime_amount - out_row.late_deduction;
  -- Gross plus everything moved by hand. **Not** what reaches a bank account:
  -- `0051` makes an employee's share of BPJS a deduction from it, and Q56 is
  -- that argument. `take_home` below is the figure that does.
  out_row.net := (out_row.gross + out_row.adjustment_total)::bigint;

  /* The statutory half, and only for schemes this person is actually enrolled
     in (D259). Nothing is invented: no enrolment row means no deduction, and
     PPh 21 is recorded rather than computed (D140, D277). Read per scheme
     because the rate table is monthly and `contribution_lines` is where that
     lives — restating its rule here to save a few rows would be the second
     copy this ladder keeps learning not to make. The label is left to the
     client: it is presentation, and `SCHEME_LABEL` already holds it. */
  select coalesce(jsonb_agg(jsonb_build_object(
           'scheme', cl.scheme, 'base', cl.base,
           'employee', cl.employee, 'employer', cl.employer)
           order by cl.scheme), '[]'::jsonb),
         coalesce(sum(cl.employee), 0)
    into out_row.contributions, out_row.contribution_total
    from (select distinct en.scheme from ops_hr.enrolments en
           where en.employee_id = emp.id) s
    cross join lateral ops_hr.contribution_lines(
      s.scheme, date_trunc('month', p_from)::date) cl
   where cl.employee_id = emp.id;

  if not coalesce((c_person ->> 'contributions')::boolean, (c_run ->> 'contributions')::boolean, true) then
    v_off := (select coalesce(jsonb_agg(case when x ->> 'component' = 'contributions'
                                         then x || jsonb_build_object('amount', out_row.contribution_total)
                                         else x end), '[]'::jsonb)
                from jsonb_array_elements(v_off) x);
    out_row.contributions := '[]'::jsonb;
    out_row.contribution_total := 0;
  end if;
  out_row.components_off := v_off;

  out_row.take_home := out_row.net - out_row.contribution_total;

  /* 0213 (D373): the two columns of the sheet. What is added — pokok,
     tunjangan, lembur, every addition typed by hand — and what is taken —
     lateness, short hours, BPJS, every deduction typed by hand. Their
     difference is `take_home`, by construction; the alpa is already inside
     the pokok and is shown beside it, not taken twice. */
  select coalesce(sum(a.amount) filter (where a.amount > 0), 0),
         coalesce(-sum(a.amount) filter (where a.amount < 0), 0)
    into v_adj_pos, v_adj_neg
    from ops_hr.payroll_adjustments a
   where a.run_no = p_run_no and a.employee_id = emp.id and a.withdrawn_at is null;
  out_row.additions_total := (out_row.base_pay + out_row.allowance_pay + out_row.overtime_pay
                              + v_adj_pos)::bigint;
  out_row.deductions_total := (out_row.late_deduction + out_row.undertime_amount
                               + out_row.contribution_total + v_adj_neg)::bigint;

  -- The contract's spellings for two figures that already exist under another
  -- name. Assigned from the originals so the pair cannot drift.
  out_row.days_worked := out_row.worked_days;
  out_row.days_open   := out_row.open_days;
  -- 0242 (D394)
  out_row.days_unconfirmed := n_unconf;
  out_row.days_short := n_short;
  out_row.attendance_exempt := exists (
    select 1 from ops_hr.attendance_exemptions x
     where x.employee_id = emp.id
       and (x.starts_on is null or x.starts_on <= p_to)
       and (x.ends_on is null or x.ends_on >= p_from));

  /* The sentences a payslip needs, because a figure nobody can take apart is a
     figure somebody argues with at the counter. */
  if out_row.open_days - n_unconf > 0 then
    w := w || format('%s hari belum dibaca — belum bernilai sampai ada yang membacanya', out_row.open_days - n_unconf);
  end if;
  if n_short > 0 then
    w := w || format('%s hari kurang jam — dibayar sebanding jam kerjanya (kurang %s hari)',
                     n_short, round(v_short_days, 2));
  end if;
  if n_unconf > 0 then
    w := w || format('%s hari kerja tanpa tap dan tanpa keterangan — belum dibayar sampai HRD mengonfirmasi hadir atau menandainya', n_unconf);
  end if;
  select coalesce(sum(c.hours), 0) into pending_ot from ops_hr.v_overtime_claim c
    join ops_hr.overtime_lines l on l.sheet_id = c.id
   where l.employee_id = emp.id and c.work_date between v_ot_from and v_ot_to
     and c.stage in ('waiting_hrd','waiting_surat','waiting_leader');
  -- Hours claimed and not yet signed for. It was already being counted for the
  -- warning below and thrown away; the contract has always asked for it,
  -- because *what is still coming* is a different question from *what this
  -- period pays* and a payslip is read by somebody who wants both.
  out_row.overtime_pending_hours := pending_ot;
  if pending_ot > 0 then
    w := w || format('%s jam lembur di lembar yang belum selesai ditandatangani — tidak masuk angka ini', pending_ot);
  end if;
  if shown_ot > out_row.overtime_hours + pending_ot then
    w := w || format('%s jam lewat jam kerja di mesin yang belum diklaim siapa pun',
                     round(shown_ot - out_row.overtime_hours - pending_ot, 1));
  end if;
  if no_letter > 0 then
    w := w || format('%s hari sakit tanpa surat dokter — tercatat, tidak dibayar. Suratnya membuatnya dibayar', no_letter);
  end if;
  if over_leave > 0 then
    w := w || format('%s hari cuti melewati jatah %s hari — tercatat, tidak dibayar', over_leave, emp.paid_leave_days);
  end if;
  if n_withheld > 0 and emp.allowance_rate > 0 then
    w := w || format('%s hari tanpa tunjangan — keputusan HRD, alasannya tercetak di slip', n_withheld);
  end if;
  if out_row.late_minutes > 0 and coalesce(v_rules->>'late_mode','manual') = 'manual' then
    w := w || format('%s menit terlambat di luar toleransi — belum dipotong; Rp %s kalau aturannya dinyalakan',
                     out_row.late_minutes, out_row.late_priced);
  end if;
  if emp.pay_basis <> 'monthly' and prem_days > 0 then
    w := w || format('%s hari Sabtu/Minggu/tanggal merah dibayar lebih dari sehari — tambahan %s hari upah (Rp %s)',
                     prem_days, prem_extra, round(prem_extra * case when emp.pay_basis = 'daily' then emp.base_rate else emp.base_rate * emp.daily_hours end));
  end if;
  if n_assumed > 0 then
    w := w || format('%s dihitung hadir penuh sesuai jadwal (asumsi saat persetujuan) — tidak masuk atau pulang cepat hari itu dikoreksi HRD minggu depan; lembur hari itu dibayar minggu depan',
                     to_char(p_to, 'DD/MM'));
  end if;
  if v_proj then
    w := w || format('Lembur yang dibayar di sini: %s s.d. %s', to_char(v_ot_from, 'DD/MM'), to_char(v_ot_to, 'DD/MM'));
  end if;
  if emp.pay_basis <> 'monthly' and out_row.worked_days = 0 then
    w := w || 'Tidak ada hari yang terhitung pada periode ini'::text;
  end if;
  /* 0212 (D370) */
  if emp.pay_basis = 'monthly' and (v_mb ->> 'amount')::bigint <> emp.base_rate
     and jsonb_array_length(coalesce(out_row.proration, '[]'::jsonb)) > 0 then
    w := w || (select format('Gaji bulanan diprorata: %s', string_agg(
                 format('%s dari %s hari kerja %s%s%s', x ->> 'paid_days', x ->> 'workdays', x ->> 'month',
                        case when (x ->> 'outside_days')::int > 0
                             then format(' (%s hari di luar masa kerja)', x ->> 'outside_days') else '' end,
                        case when (x ->> 'absent_days')::int > 0
                             then format(' (−%s hari tidak dibayar)', x ->> 'absent_days') else '' end),
                 '; '))
                 from jsonb_array_elements(out_row.proration) x);
  end if;
  -- Only what moves money here, or the person's own switch: a run with
  -- overtime off says nothing on the slip of somebody who had none.
  if exists (select 1 from jsonb_array_elements(v_off) x
              where (x ->> 'amount')::numeric <> 0 or x ->> 'scope' = 'person') then
    w := w || (select format('Tidak dibayar/dipotong di run ini: %s', string_agg(
                 format('%s%s', x ->> 'component',
                        case when coalesce(x ->> 'reason', '') <> '' then ' — ' || (x ->> 'reason') else '' end),
                 ', '))
                 from jsonb_array_elements(v_off) x
                where (x ->> 'amount')::numeric <> 0 or x ->> 'scope' = 'person');
  end if;
  out_row.warnings := w;

  return out_row;
end $$;
