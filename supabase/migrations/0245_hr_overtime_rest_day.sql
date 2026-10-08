-- 0245 — lembur hari libur dari tap pertama; jam selesai sebelum jam mulai
-- bukan lembur semalaman (D397).
--
-- ── the owner's question (2026-10-08) ─────────────────────────────────────
--
--   *kenapa putri sabtu minggu tidak dihitung sebagai lembur 2x?* — PUTRI
--   tapped Saturday 12/09 08.00–16.00 and 19/09 09.19–14.17.
--
-- Not paid because nobody approved them: overtime is never inferred from
-- taps (D138). But approving them from the payroll would have gone wrong:
--
--   * `day_overtime_window` started overtime at the pattern's end (17.15),
--     because KANTOR's Saturday is not `off` in the pattern — the five-day
--     week is the rule book's (`is_rest_day`), not the pattern's. On a rest
--     day overtime now starts at the first tap;
--   * `ot_segments` read 17.15 → 16.00 as overnight: 22 hours. A finish
--     before the start is the next morning only before noon (0195's own
--     rule for `until_minutes`); otherwise there is no overtime.
--
-- The rest-day ladder (2× hours 1–8, 3× the 9th, 4× after) was always right.

/* ── restated from 0244 ── */
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

create or replace function ops_hr.day_overtime_window(p_employee uuid, p_date date,
  out from_minutes int, out until_minutes int)
language plpgsql stable set search_path = ops_hr, pg_temp as $$
declare emp ops_hr.employees; d ops_hr.day_reading; v_sd jsonb; v_last timestamptz;
begin
  select * into emp from ops_hr.employees where id = p_employee;
  if not found then return; end if;
  select * into d from ops_hr.read_day(p_employee, p_date);
  v_sd := ops_hr.schedule_day(ops_hr.pattern_on(emp.schedule_code, emp.unit, p_date), p_date);
  /* 0245 (D397): a rest day by the rule book (Sabtu, Minggu on a five-day
     week) is overtime from the first tap — the pattern's own Saturday hours
     say nothing about a day nobody is scheduled. */
  if v_sd is not null and not coalesce((v_sd->>'off')::boolean, false)
     and not ops_hr.is_rest_day(ops_hr.rules_on(p_date), p_date) then
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
