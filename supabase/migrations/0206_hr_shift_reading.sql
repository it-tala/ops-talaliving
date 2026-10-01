-- 0206 — shift kerja Satpam: Shift 1 07.00–17.00, Shift 2 17.00–07.00 (D364).
--
-- Owner: *bagaimana dengan jam kerja dengan sistem shift? Khusus untuk
-- satpam, ada 2 shift: Shift 1 07.00–17.00, Shift 2 17.00–07.00.* Asked how
-- the shifts are given out, how they are paid and whether there is a break:
--
--   * **tidak tentu, tiap hari bisa beda** — nobody writes a roster, so the
--     shift is read off the taps; where the taps cannot say, HRD picks it;
--   * **1 shift = 1 hari upah**, whichever shift;
--   * **tidak ada istirahat**.
--
-- A pattern may now carry `shifts`: a list of `{code, name, start_minutes,
-- end_minutes, break_minutes?}`. A shift whose end is not after its start ends
-- the next morning. Somebody on such a pattern is read by the shift:
--
--   * the machine says *when*, never *in or out*, and both shifts tap at about
--     07.00 and 17.00 — so the taps are read as a chain (`shift_reading`):
--     neighbouring taps that fit one shift's start and end (four hours either
--     side) are paired from the start of each run of them. A missing tap ends
--     a run; the run after it starts afresh. A tap left without a partner is
--     a day HRD reads, and settles by picking the shift (`pick_shift`), which
--     also re-reads the days around it;
--   * a shift belongs to the day it **starts**: Shift 2 of Monday is Monday
--     17.00 to Tuesday 07.00;
--   * hours are the shift's at most, less its break, as `in_out` reads an
--     ordinary day (D353): late in or early out is short and says so; past the
--     end is lembur, shown and never paid from here (D138);
--   * lateness is against the shift's own start.
--
-- Nothing changes for a pattern without `shifts`. HRD sets them on
-- /hrd/jadwal (`set_schedule_shifts`, a new rule-book version like
-- `set_schedule_days`).

/* ── the reading says which shift ─────────────────────────────────────── */
alter type ops_hr.day_reading
  add attribute shift_code text cascade,
  add attribute shift_name text cascade;

alter type ops_hr.timesheet_row
  add attribute shift_code text cascade,
  add attribute shift_name text cascade;

/* ── a shift's own clock ──────────────────────────────────────────────── */
-- When shift `p_shift` (one element of a pattern's `shifts`) starts and ends
-- for the working day `p_day`. A shift whose end is not after its start ends
-- on the next calendar day — Shift 2, 17.00–07.00.
create or replace function ops_hr.shift_start_at(p_day date, p_shift jsonb)
returns timestamptz
language sql stable set search_path = ops_hr, ops_core, pg_temp as $$
  select (p_day::timestamp + make_interval(mins => (p_shift ->> 'start_minutes')::int))
         at time zone ops_core.office_tz()
$$;

create or replace function ops_hr.shift_end_at(p_day date, p_shift jsonb)
returns timestamptz
language sql stable set search_path = ops_hr, ops_core, pg_temp as $$
  select ((p_day + case when (p_shift ->> 'end_minutes')::int <= (p_shift ->> 'start_minutes')::int
                        then 1 else 0 end)::timestamp
          + make_interval(mins => (p_shift ->> 'end_minutes')::int))
         at time zone ops_core.office_tz()
$$;

-- Whether two taps are one shift: `p_a` within four hours of a shift's start
-- and `p_b` within four hours of the same shift's end, later than `p_a`. The
-- closest fit wins. Null when no shift fits — the two taps are not a shift.
create or replace function ops_hr.shift_link(p_shifts jsonb, p_a timestamptz, p_b timestamptz)
returns jsonb
language sql stable set search_path = ops_hr, ops_core, pg_temp as $$
  select jsonb_build_object('code', s ->> 'code', 'day', ops_core.office_day(p_a) + k)
    from jsonb_array_elements(p_shifts) s
    cross join generate_series(-1, 1) k
   where p_b > p_a
     and abs(extract(epoch from p_a - ops_hr.shift_start_at(ops_core.office_day(p_a) + k, s))) <= 4 * 3600
     and abs(extract(epoch from p_b - ops_hr.shift_end_at(ops_core.office_day(p_a) + k, s))) <= 4 * 3600
   order by abs(extract(epoch from p_a - ops_hr.shift_start_at(ops_core.office_day(p_a) + k, s)))
          + abs(extract(epoch from p_b - ops_hr.shift_end_at(ops_core.office_day(p_a) + k, s)))
   limit 1
$$;

-- What one tap on its own most likely is: the start of a shift (preferred —
-- 07.00 is both Shift 1's start and Shift 2's end, and a lone 07.00 is read
-- as somebody arriving), else the end of one. Null when it is near neither.
create or replace function ops_hr.shift_role(p_shifts jsonb, p_a timestamptz)
returns jsonb
language sql stable set search_path = ops_hr, ops_core, pg_temp as $$
  select c.x from (
    select jsonb_build_object('code', s ->> 'code', 'day', ops_core.office_day(p_a) + k, 'role', 'in') as x,
           0 as pref,
           abs(extract(epoch from p_a - ops_hr.shift_start_at(ops_core.office_day(p_a) + k, s))) as dist
      from jsonb_array_elements(p_shifts) s cross join generate_series(-1, 1) k
    union all
    select jsonb_build_object('code', s ->> 'code', 'day', ops_core.office_day(p_a) + k, 'role', 'out'),
           1,
           abs(extract(epoch from p_a - ops_hr.shift_end_at(ops_core.office_day(p_a) + k, s)))
      from jsonb_array_elements(p_shifts) s cross join generate_series(-1, 1) k
  ) c
  where c.dist <= 4 * 3600
  order by c.pref, c.dist
  limit 1
$$;

/* ── HRD says which shift a day was ───────────────────────────────────── */
create table if not exists ops_hr.shift_picks (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid not null references ops_hr.employees(id),
  work_date   date not null,
  shift_code  text not null,
  reason      text,
  picked_by   uuid references ops_core.users(id),
  picked_at   timestamptz not null default now(),
  constraint shift_pick_once unique (employee_id, work_date)
);

comment on table ops_hr.shift_picks is
  'Shift yang dipilih HRD untuk satu hari seseorang (D364). Menang atas pembacaan otomatis tap; dibaca oleh shift_reading().';

alter table ops_hr.shift_picks enable row level security;
-- Read by who reads the timesheet: HRD, payroll, and the person themself
-- (their own week on /profil goes through read_day under their own rights).
create policy shift_picks_read on ops_hr.shift_picks for select to authenticated
  using (ops_core.has_permission('hrd.read') or ops_core.has_permission('payroll.read')
         or employee_id = ops_hr.my_employee_id());
-- No write policy and no write grant: `pick_shift` is the only door.
grant select on ops_hr.shift_picks to authenticated;

analyze ops_hr.shift_picks;

/* ── one day of somebody on shifts, read ──────────────────────────────── */
--
-- The machine says *when*, never *in or out*, and both shifts tap at about
-- 07.00 and 17.00 — so a guard's taps are read as a chain, not one day at a
-- time:
--
--   1. Taps within an hour of each other are one tap (a finger tried twice).
--   2. HRD's picks first: for a picked day, the tap nearest the shift's start
--      is masuk and the one nearest its end is pulang.
--   3. The rest form **runs**: consecutive taps in which every neighbouring
--      pair fits some shift (masuk ±4 h of its start, pulang ±4 h of its end).
--      A missing tap, a rest day or a tap at an odd hour ends a run.
--   4. Each run is paired **from its start**: (1,2), (3,4), … A run with an
--      odd number of taps leaves its last one alone — *open* when it is the
--      latest tap and its shift has not yet ended, otherwise *lone*, a day
--      HRD reads (and can settle by picking the shift).
--
-- A shift belongs to the day it starts: Shift 2 of Monday is Monday 17.00 to
-- Tuesday 07.00. Twenty-one days back and three ahead are read, so a run that
-- began last week is paired from where it began.
create or replace function ops_hr.shift_reading(p_employee uuid, p_date date)
returns table (sh_code text, sh_name text, sh_in timestamptz, sh_out timestamptz,
               sh_start timestamptz, sh_end timestamptz, sh_taps timestamptz[],
               sh_status text, sh_extra int, sh_picked boolean)
language plpgsql stable set search_path = ops_hr, ops_core, pg_temp as $$
declare
  emp ops_hr.employees%rowtype;
  v_sc jsonb; v_shifts jsonb; s jsonb; lk jsonb; r jsonb;
  kept timestamptz[] := '{}'; prev timestamptz; t record; pk record;
  n int; i int; j int; k int; m int; idx int; g int;
  o_day date[]; o_code text[]; o_role text[];
  run int[];
  st timestamptz; en timestamptz;
  v_code text; v_in timestamptz; v_out timestamptz; v_taps timestamptz[] := '{}';
  v_status text := 'none'; v_extra int := 0; v_picked boolean := false;
begin
  select * into emp from ops_hr.employees where id = p_employee;
  if not found then return; end if;
  v_sc := ops_hr.pattern_on(emp.schedule_code, emp.unit, p_date);
  v_shifts := v_sc -> 'shifts';
  if jsonb_typeof(v_shifts) is distinct from 'array' or jsonb_array_length(v_shifts) = 0 then return; end if;

  for t in
    select a.at from ops_hr.attendance_scans a
     where a.employee_id = p_employee and a.work_date between p_date - 21 and p_date + 3
     order by a.at
  loop
    if prev is null or t.at - prev >= interval '60 minutes' then
      kept := kept || t.at; prev := t.at;
    end if;
  end loop;
  n := coalesce(array_length(kept, 1), 0);
  if n > 0 then
    o_day := array_fill(null::date, array[n]);
    o_code := array_fill(null::text, array[n]);
    o_role := array_fill(null::text, array[n]);
  end if;

  /* HRD's picks first. */
  for pk in
    select p.work_date, p.shift_code from ops_hr.shift_picks p
     where p.employee_id = p_employee and p.work_date between p_date - 21 and p_date + 2
     order by p.work_date
  loop
    s := null;
    select x into s from jsonb_array_elements(v_shifts) x where x ->> 'code' = pk.shift_code;
    continue when s is null;
    if pk.work_date = p_date then v_picked := true; v_code := pk.shift_code; end if;
    continue when n = 0;
    st := ops_hr.shift_start_at(pk.work_date, s);
    en := ops_hr.shift_end_at(pk.work_date, s);
    i := null; j := null;
    select q into i from generate_subscripts(kept, 1) q
     where o_day[q] is null and abs(extract(epoch from kept[q] - st)) <= 4 * 3600
     order by abs(extract(epoch from kept[q] - st)) limit 1;
    select q into j from generate_subscripts(kept, 1) q
     where o_day[q] is null and q is distinct from i
       and (i is null or kept[q] > kept[i])
       and abs(extract(epoch from kept[q] - en)) <= 4 * 3600
     order by abs(extract(epoch from kept[q] - en)) limit 1;
    if i is not null then o_day[i] := pk.work_date; o_code[i] := pk.shift_code; o_role[i] := 'in'; end if;
    if j is not null then o_day[j] := pk.work_date; o_code[j] := pk.shift_code; o_role[j] := 'out'; end if;
  end loop;

  /* The rest, run by run, paired from the start. */
  i := 1;
  while i <= n loop
    if o_day[i] is not null then i := i + 1; continue; end if;
    run := array[i]; k := i;
    while k + 1 <= n and o_day[k + 1] is null
          and ops_hr.shift_link(v_shifts, kept[k], kept[k + 1]) is not null loop
      k := k + 1; run := run || k;
    end loop;
    m := array_length(run, 1); idx := 1;
    while idx + 1 <= m loop
      lk := ops_hr.shift_link(v_shifts, kept[run[idx]], kept[run[idx + 1]]);
      o_day[run[idx]] := (lk ->> 'day')::date; o_code[run[idx]] := lk ->> 'code'; o_role[run[idx]] := 'in';
      o_day[run[idx + 1]] := (lk ->> 'day')::date; o_code[run[idx + 1]] := lk ->> 'code'; o_role[run[idx + 1]] := 'out';
      idx := idx + 2;
    end loop;
    if idx = m then
      r := ops_hr.shift_role(v_shifts, kept[run[m]]);
      o_day[run[m]] := coalesce((r ->> 'day')::date, ops_core.office_day(kept[run[m]]));
      o_code[run[m]] := r ->> 'code';
      s := null;
      select x into s from jsonb_array_elements(v_shifts) x where x ->> 'code' = r ->> 'code';
      o_role[run[m]] := case
        when r ->> 'role' = 'in' and run[m] = n and s is not null
             and now() < ops_hr.shift_end_at((r ->> 'day')::date, s) + interval '4 hours'
        then 'open' else 'lone' end;
    end if;
    i := k + 1;
  end loop;

  /* What fell on the day asked about: a paired masuk and pulang first — the
     picked shift's before any other — and a tap on its own only when the day
     has neither. Anything else on the day is counted, not read. */
  for g in 1 .. n loop
    continue when o_day[g] is distinct from p_date;
    v_taps := v_taps || kept[g];
  end loop;
  for g in
    select q from generate_subscripts(kept, 1) q
     where o_day[q] = p_date and o_role[q] in ('in', 'out')
     order by (v_picked and o_code[q] = v_code) desc, q
  loop
    if o_role[g] = 'in' and v_in is null and (v_code is null or o_code[g] = v_code) then
      v_in := kept[g]; v_code := coalesce(v_code, o_code[g]);
    elsif o_role[g] = 'out' and v_out is null and (v_code is null or o_code[g] = v_code) then
      v_out := kept[g]; v_code := coalesce(v_code, o_code[g]);
    end if;
  end loop;
  if v_in is null and v_out is null then
    for g in
      select q from generate_subscripts(kept, 1) q
       where o_day[q] = p_date and o_role[q] in ('open', 'lone')
       order by q limit 1
    loop
      v_in := kept[g]; v_code := coalesce(v_code, o_code[g]);
      if o_role[g] = 'open' then v_status := 'open'; end if;
    end loop;
  end if;
  v_extra := coalesce(array_length(v_taps, 1), 0)
           - (case when v_in is not null then 1 else 0 end)
           - (case when v_out is not null then 1 else 0 end);

  if v_in is not null and v_out is not null then v_status := 'paired';
  elsif v_status = 'open' then null;
  elsif v_in is not null or v_out is not null then v_status := 'lone';
  end if;

  s := null;
  if v_code is not null then
    select x into s from jsonb_array_elements(v_shifts) x where x ->> 'code' = v_code;
  end if;
  if s is not null then
    st := ops_hr.shift_start_at(p_date, s); en := ops_hr.shift_end_at(p_date, s);
  else
    st := null; en := null;
  end if;
  return query select v_code, s ->> 'name', v_in, v_out, st, en, v_taps, v_status, v_extra, v_picked;
end $$;


/* ── one day, read — restated from 0199, with the shift reading ── */
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
  v_sc          jsonb;
  v_night       boolean;
  v_from        timestamptz;
  v_to          timestamptz;
  v_out_from    timestamptz;
  -- 0195: the reading by the schedule (D340).
  v_mode        text;
  v_sd          jsonb;
  v_mult        numeric := 1;
  v_sched       numeric;
  s_min int; e_min int; b_min int;
  v_start_at    timestamptz;
  v_end_at      timestamptz;
  v_hours_to    timestamptz;
  v_last        timestamptz;
  v_win         int;
  v_roundm      numeric;
  v_hol_mult    numeric;
  v_read        boolean := false;
  -- 0206: the shift reading (D364).
  sr            record;
  v_shifts      jsonb;
  v_shj         jsonb;
  v_shift       boolean := false;
  v_shift_code  text;
  v_shift_name  text;
begin
  select * into emp from ops_hr.employees where id = p_employee;
  if not found then return; end if;
  v_rules := ops_hr.rules_on(p_date);
  v_sc    := ops_hr.pattern_on(emp.schedule_code, emp.unit, p_date);
  v_night := ops_hr.is_overnight(v_sc);
  v_from  := ops_hr.day_begins(p_employee, p_date);
  v_to    := ops_hr.day_begins(p_employee, p_date + 1);

  /* 0195 (D340). What this weekday is on the person's pattern — its own hours
     and what a day of it is worth — and how the day is read. */
  v_mode  := coalesce(v_rules ->> 'day_reading', 'slots');
  v_sd    := ops_hr.schedule_day(v_sc, p_date);
  v_mult  := coalesce((v_sd ->> 'pay_multiplier')::numeric, 1);
  s_min   := ops_hr.minutes_of(v_sd -> 'start_minutes');
  e_min   := ops_hr.minutes_of(v_sd -> 'end_minutes');
  b_min   := coalesce(ops_hr.minutes_of(v_sd -> 'break_minutes'), 0);
  if coalesce((v_sd ->> 'off')::boolean, false) or s_min is null or e_min is null then
    v_sched := null;
  else
    v_sched := greatest(ops_hr.shift_minutes(s_min, e_min) - b_min, 0) / 60.0;
  end if;

  /* The taps, de-duplicated. A reader scanned twice inside two minutes is one
     arrival, not two — the real export has 29 of them. Two minutes is long
     enough to swallow a finger that did not take the first time and short
     enough to keep a genuine second tap eleven minutes later, which is a
     different event somebody has to look at (D141).

     The `work_date` pair is only there so the index is used: the window never
     reaches outside the day and the one after it. */
  for tap in
    select s.at from ops_hr.attendance_scans s
     where s.employee_id = p_employee
       and s.work_date between p_date and p_date + 1
       and s.at >= v_from and s.at < v_to
     order by s.at
  loop
    if prev is null or tap.at - prev >= interval '2 minutes' then
      kept := kept || tap.at;
      prev := tap.at;
    end if;
  end loop;

  n_taps := coalesce(array_length(kept, 1), 0);
  rest := kept;

  /* 0206 (D364): a pattern with shifts — Satpam's 07.00–17.00 and 17.00–07.00,
     worked in no fixed order — is read as a chain of taps, not one calendar
     day at a time (`shift_reading`). The day is the shift that **starts** on
     it, its taps are the ones that shift took, and its window is theirs. */
  v_shifts := v_sc -> 'shifts';
  if jsonb_typeof(v_shifts) = 'array' and jsonb_array_length(v_shifts) > 0 then
    select * into sr from ops_hr.shift_reading(p_employee, p_date);
    if found then
      v_shift := true;
      kept    := coalesce(sr.sh_taps, '{}');
      n_taps  := coalesce(array_length(kept, 1), 0);
      rest    := '{}';
      v_shift_code := sr.sh_code;
      v_shift_name := sr.sh_name;
      if n_taps > 0 then
        v_from := kept[1];
        -- A finger tried twice is one tap (an hour, in `shift_reading`); the
        -- window reaches that far past the last so the screen lists it too.
        v_to   := kept[n_taps] + interval '60 minutes';
      end if;
      if sr.sh_code is not null then
        select x into v_shj from jsonb_array_elements(v_shifts) x where x ->> 'code' = sr.sh_code;
        v_night := sr.sh_end::date <> sr.sh_start::date
                   or ops_hr.minutes_of(v_shj -> 'end_minutes') <= ops_hr.minutes_of(v_shj -> 'start_minutes');
      else
        v_night := false;
      end if;
    end if;
  end if;

  /* Each slot takes the first remaining tap that fits, and removes it. The
     windows are the reading, and they are written here rather than buried
     because every reading can be wrong. */
  if n_taps > 0 and v_shift then
    /* ── read by the shift (D364) ─────────────────────────────────────────
       Masuk and pulang are the two taps `shift_reading` paired; the hours are
       the shift's, never more: min(pulang, shift end) − max(masuk, shift
       start) − the shift's break (none for Satpam), rounded to
       `hours_rounding_minutes`. Past the end is lembur, shown and never paid
       from here (D138). One shift is one day of pay, whichever it is. */
    v_read   := true;
    v_roundm := coalesce((v_rules ->> 'hours_rounding_minutes')::numeric, 15);
    v_in     := sr.sh_in;
    v_out    := sr.sh_out;
    if v_shj is not null then
      b_min   := coalesce(ops_hr.minutes_of(v_shj -> 'break_minutes'), 0);
      v_sched := greatest(extract(epoch from sr.sh_end - sr.sh_start) / 60 - b_min, 0) / 60.0;
    end if;

    if sr.sh_status = 'paired' then
      v_work := greatest(extract(epoch from least(v_out, sr.sh_end)
                                 - greatest(v_in, sr.sh_start)) / 60 - b_min, 0);
      v_work := case when v_roundm > 0 then round(v_work / v_roundm) * v_roundm else v_work end / 60.0;
      if v_out > sr.sh_end then
        v_ots := sr.sh_end; v_ote := v_out;
        v_ot  := extract(epoch from v_out - sr.sh_end) / 60;
        v_ot  := case when v_roundm > 0 then round(v_ot / v_roundm) * v_roundm else v_ot end / 60.0;
      end if;
      if v_work < (case when v_roundm > 0 then round(v_sched * 60 / v_roundm) * v_roundm / 60.0
                        else v_sched end) then
        v_notes := v_notes || format('Kurang %s jam dari jadwal %s jam',
                                     round(v_sched - v_work, 2), round(v_sched, 2));
      end if;
    elsif sr.sh_status = 'open' then
      v_issues := v_issues || format('%s sedang berjalan — belum ada tap pulang', sr.sh_name);
    elsif sr.sh_code is null then
      v_issues := v_issues || 'Tap di luar jam shift mana pun — pilih shift-nya di laci hari'::text;
    elsif sr.sh_picked then
      v_issues := v_issues || format('%s dipilih, tapi tap %s belum ada — lengkapi tapnya',
                                     sr.sh_name, case when v_out is null then 'pulang' else 'datang' end);
    else
      v_issues := v_issues || 'Satu tap tanpa pasangan — pilih shift-nya di laci hari, atau lengkapi tap yang hilang'::text;
    end if;
    if sr.sh_picked then
      v_notes := v_notes || format('Shift dipilih HRD: %s', coalesce(sr.sh_name, sr.sh_code));
    end if;
    if sr.sh_extra > 0 then
      v_notes := v_notes || format('%s tap lain di shift ini tidak dihitung', sr.sh_extra);
    end if;
    v_break := b_min / 60.0;

  elsif n_taps > 0 and v_mode in ('schedule', 'in_out') and not v_night then
    /* ── read by the schedule (D340) ──────────────────────────────────────
       The owner: *tap yang lebih/kurang tidak perlu dipermasalahkan, asal
       total jam kerja yang terbaca normal*. So a day with any tap on it is a
       day present, and its hours are read against **this weekday's** pattern,
       the way the payroll sheet has always read them:

         masuk   the first tap; arriving early does not add hours;
         pulang  the tap nearest the scheduled end, within `out_window_minutes`
                 (30) either side — and when there is none, the scheduled end
                 itself: a missing pulang is a missing tap, not a short day;
         hours   min(pulang, end) − max(masuk, start) − the pattern's break,
                 rounded to `hours_rounding_minutes` (15);
         lembur  the last tap past pulang, rounded the same way. Shown, and
                 never paid from here: only an approved overtime sheet pays
                 (D138).

       Break taps are placed for the screen only; the break deducted is the
       pattern's, whether or not anybody tapped out for it. */
    v_read   := true;
    v_win    := coalesce((v_rules ->> 'out_window_minutes')::int, 30);
    v_roundm := coalesce((v_rules ->> 'hours_rounding_minutes')::numeric, 15);
    v_in     := kept[1];
    v_last   := case when n_taps > 1 then kept[n_taps] end;

    select t into pick from unnest(kept[2:]) t
      where ops_hr.wita_minutes(t) >= 11*60 and ops_hr.wita_minutes(t) < 13*60+30
      order by t limit 1;
    if pick is not null then v_bout := pick; pick := null; end if;
    select t into pick from unnest(kept[2:]) t
      where ops_hr.wita_minutes(t) >= 11*60+30 and ops_hr.wita_minutes(t) < 14*60+30
        and (v_bout is null or t > v_bout)
      order by t limit 1;
    if pick is not null then v_bin := pick; pick := null; end if;

    if v_sched is not null then
      v_start_at := (p_date::timestamp + make_interval(mins => s_min)) at time zone ops_core.office_tz();
      v_end_at   := (p_date::timestamp + make_interval(mins => e_min)) at time zone ops_core.office_tz();
      if v_mode = 'in_out' then
        /* 0199 (D353): *tap wajib hanya di jam datang dan pulang*. Pulang is
           the last tap, whenever it is — leaving early is a short day, not a
           missing tap — and a day with only one tap has no pulang. */
        v_out := v_last;
      else
        select t into pick from unnest(kept[2:]) t
          where abs(extract(epoch from t - v_end_at)) <= v_win * 60
          order by abs(extract(epoch from t - v_end_at)), t limit 1;
        if pick is not null then v_out := pick; pick := null; end if;
      end if;
      v_hours_to := coalesce(v_out, v_end_at);
      v_work := greatest(extract(epoch from least(v_hours_to, v_end_at)
                                 - greatest(v_in, v_start_at)) / 60 - b_min, 0);
      v_work := case when v_roundm > 0 then round(v_work / v_roundm) * v_roundm else v_work end / 60.0;
      if v_mode = 'in_out' then
        /* Past the scheduled end is shown as lembur and never paid from here
           (D138); the day itself is the schedule's hours at most. */
        if v_out is not null and v_out > v_end_at then
          v_ots := v_end_at; v_ote := v_out;
          v_ot  := extract(epoch from v_out - v_end_at) / 60;
          v_ot  := case when v_roundm > 0 then round(v_ot / v_roundm) * v_roundm else v_ot end / 60.0;
        end if;
      elsif v_last is not null and v_last > v_hours_to then
        v_ots := v_hours_to; v_ote := v_last;
        v_ot  := extract(epoch from v_last - v_hours_to) / 60;
        v_ot  := case when v_roundm > 0 then round(v_ot / v_roundm) * v_roundm else v_ot end / 60.0;
      end if;
      if v_out is null and v_mode = 'in_out' then
        v_issues := v_issues || 'Tidak ada tap pulang — tap datang dan pulang wajib'::text;
      elsif v_out is null then
        v_notes := v_notes || format('Tidak ada tap pulang dekat %s — jam pulang dibaca sesuai jadwal',
                                     ops_hr.clock_face(e_min));
      elsif v_mode = 'in_out'
            and v_work < (case when v_roundm > 0 then round(v_sched * 60 / v_roundm) * v_roundm / 60.0
                               else v_sched end) then
        /* Short of the schedule (compared rounded as the hours are, so a
           7,33-hour day read on time is not short by its own rounding): what
           the screen draws red (D353). */
        v_notes := v_notes || format('Kurang %s jam dari jadwal %s jam',
                                     round(v_sched - v_work, 2), round(v_sched, 2));
      end if;
    else
      /* A weekday the pattern has no hours for, or nobody on a pattern: the
         hours are what the taps span, less the break, rounded the same way. */
      v_out  := v_last;
      v_work := greatest(extract(epoch from coalesce(v_last, v_in) - v_in) / 60 - b_min, 0);
      v_work := case when v_roundm > 0 then round(v_work / v_roundm) * v_roundm else v_work end / 60.0;
      if v_mode = 'in_out' and v_out is null then
        v_issues := v_issues || 'Tidak ada tap pulang — tap datang dan pulang wajib'::text;
      end if;
    end if;
    v_break := b_min / 60.0;
    rest := '{}';

  elsif n_taps > 0 and not v_night then
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

  elsif n_taps > 0 then
    /* The night, read against its own clock. Pulang is the first tap in the
       last stretch of the shift — its final three hours, or its second half
       if it is shorter than six — which is where the day reading's 14:30 sits
       for an office that finishes at 17:15. A guard who leaves at 02:00 has no
       pulang and goes to review, rather than being read as a short night
       nobody looked at. Anything between masuk and that stretch is the break
       going out and coming back. */
    v_out_from := ((p_date + 1)::timestamp
                   + make_interval(mins => ops_hr.minutes_of(v_sc -> 'end_minutes')))
                  at time zone ops_core.office_tz()
                  - make_interval(mins => least(180,
                      ops_hr.shift_minutes(ops_hr.minutes_of(v_sc -> 'start_minutes'),
                                           ops_hr.minutes_of(v_sc -> 'end_minutes')) / 2));
    v_in := rest[1];
    rest := rest[2:];

    select t into pick from unnest(rest) t where t < v_out_from order by t limit 1;
    if pick is not null then v_bout := pick; rest := array_remove(rest, pick); pick := null; end if;

    select t into pick from unnest(rest) t where t < v_out_from order by t limit 1;
    if pick is not null then v_bin := pick; rest := array_remove(rest, pick); pick := null; end if;

    select t into pick from unnest(rest) t where t >= v_out_from order by t limit 1;
    if pick is not null then v_out := pick; rest := array_remove(rest, pick); pick := null; end if;
  end if;

  if v_out is not null and not v_read then
    select t into pick from unnest(rest) t where t > v_out order by t limit 1;
    if pick is not null then v_ots := pick; rest := array_remove(rest, pick); pick := null; end if;
  end if;

  if v_ots is not null and not v_read then
    select t into pick from unnest(rest) t where t > v_ots order by t limit 1;
    if pick is not null then v_ote := pick; rest := array_remove(rest, pick); pick := null; end if;
  end if;

  if not v_read then
    v_break := ops_hr.span_hours(v_bout, v_bin);
    v_work  := greatest(round(ops_hr.span_hours(v_in, v_out) - v_break, 2), 0);
    v_ot    := ops_hr.span_hours(v_ots, v_ote);
  end if;

  /* Anything the rule could not place. Left-over taps are the loudest signal
     that a day needs a person: they are real events nobody has explained. */
  if coalesce(array_length(rest, 1), 0) > 0 then
    select string_agg(to_char(t at time zone ops_core.office_tz(), 'HH24:MI'), ', ' order by t)
      into leftover from unnest(rest) t;
    v_issues := v_issues || format('%s tap(s) the rule could not place: %s', array_length(rest,1), leftover);
  end if;

  if n_taps > 0 and not v_read then
    if v_out is null then v_issues := v_issues || 'No pulang — the day has no end'::text; end if;
    /* A guard on post does not go out to eat, so a night with no break taps
       at all is a whole night, not an incomplete one. Half a break is still
       half a break. */
    if (not v_night and (v_bout is null or v_bin is null))
       or (v_night and v_bout is not null and v_bin is null) then
      v_issues := v_issues || 'Istirahat incomplete'::text;
    end if;
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
        v_hol_mult := (v_rules ->> 'holiday_pay_multiplier')::numeric;
        v_why := case when v_hol_mult is not null and n_taps > 0
          then format('Tanggal merah — masuk, dibayar %s× sehari.', v_hol_mult)
          when v_work > 0
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

    if mk.kind = 'holiday' and v_hol_mult is not null and n_taps > 0 then
      /* 0195 (D340): *Sabtu, Minggu, tanggal merah hitung 2×*. Somebody who
         came in on a red day worked a day, worth `holiday_pay_multiplier`
         of one; the hours stay hours. */
      v_value := 1; v_mult := v_hol_mult;
    elsif mk.kind = 'holiday' then
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
    v_why := case when v_mult <> 1
      then format('Hari kerja — dibayar %s× sehari menurut jadwal hari ini.', v_mult)
      else 'Hari kerja penuh.' end;
  end if;

  /* A marked day is worth what the mark says; only a day somebody worked
     takes the weekday's multiplier (a half day is still half of that day). */
  if mk.mark_no is not null and not (mk.kind = 'holiday' and v_hol_mult is not null and n_taps > 0)
     and mk.kind <> 'half_day' then
    v_mult := 1;
  end if;

  return query select
    p_employee, p_date, v_in, v_bout, v_bin, v_out, v_ots, v_ote,
    n_taps, coalesce(array_length(rest,1), 0),
    v_work, v_break, v_ot, v_value, v_state,
    mk.mark_no, mk.kind, v_why, v_issues, v_notes,
    v_from, v_to, v_night, v_mult, v_sched, v_shift_code, v_shift_name;
end $$;


create or replace view ops_hr.v_timesheet_day as
select e.employee_no, e.full_name, d.*
  from ops_hr.employees e
  join lateral (
    select distinct ops_hr.shift_day(e.id, s.at) as work_date
      from ops_hr.attendance_scans s where s.employee_id = e.id
    union
    select distinct m.work_date from ops_hr.day_marks m
     where m.employee_id = e.id or m.employee_id is null
  ) days on true
  cross join lateral ops_hr.read_day(e.id, days.work_date) d;

alter view ops_hr.v_timesheet_day set (security_invoker = on);

/* ── the timesheet rows — restated from 0195; the shift is new ── */
create or replace function ops_hr.timesheet_rows(
  p_from date, p_to date, p_unit text default null, p_employee_no text default null)
returns setof ops_hr.timesheet_row
language sql stable set search_path = ops_hr, pg_temp as $$
  select
    d.employee_id, e.employee_no, e.full_name, d.work_date,
    d.in_at, d.break_out_at, d.break_in_at, d.out_at, d.ot_start_at, d.ot_end_at,
    d.work_hours, d.break_hours, d.overtime_hours, d.day_value, d.state,
    d.mark_no, d.mark_kind, d.why,
    case
      when d.mark_kind = 'sick'  and d.day_value = 0
        then 'Surat dokter belum ada — dengan suratnya, hari ini dibayar penuh.'
      when d.mark_kind = 'leave' and d.day_value = 0
        then 'Jatah cuti tahun ini sudah habis — hari ini tercatat, tidak dibayar.'
      end,
    d.issues, d.notes,
    d.window_from, d.window_to, d.overnight,
    d.pay_multiplier, d.scheduled_hours,
    d.shift_code, d.shift_name
  from ops_hr.employees e
  cross join lateral generate_series(p_from, p_to, interval '1 day') g(day)
  cross join lateral ops_hr.read_day(e.id, g.day::date) d
  where e.active
    and (p_unit is null or e.unit = p_unit)
    and (p_employee_no is null or e.employee_no = p_employee_no)
  order by e.employee_no, d.work_date
$$;


/* ── what a pattern may say — restated from 0195, with the shifts ── */
create or replace function ops_hr.schedule_problem(p_rules jsonb)
returns jsonb
language plpgsql immutable set search_path = ops_hr, pg_temp as $$
declare
  sc      jsonb;
  i       int := 0;
  v_code  text;
  v_where text;
  seen    text[] := '{}';
  st int; en int; br int; fen int; fbr int;
  f_end int; f_break int;
  span int; f_span int;
  -- 0195: the days of the week (D340)
  dk record; dv jsonb; d_where text; d_st int; d_en int; d_br int; d_span int; d_mult numeric;
  night boolean;
  u record;
  -- 0206: the shifts (D364)
  shj jsonb; sj int; s_code text; s_where text; s_seen text[]; s_st int; s_en int; s_br int; s_span int;
begin
  -- No patterns at all is a valid book — it was the answer until M57 — and a
  -- missing key is not a malformed one.
  if p_rules is null or jsonb_typeof(p_rules -> 'schedules') is distinct from 'array' then
    return null;
  end if;

  for sc in select value from jsonb_array_elements(p_rules -> 'schedules') loop
    i := i + 1;
    v_code := btrim(coalesce(sc ->> 'code', ''));
    v_where := case when v_code = '' then 'Pola ke-' || i else 'Pola ' || v_code end;

    if v_code = '' then
      return jsonb_build_object('code','code_required',
        'message', v_where || ' belum punya kode.');
    elsif v_code !~ '^[A-Z][A-Z0-9_-]*$' then
      return jsonb_build_object('code','code_shape',
        'message', v_where || ': kode dipakai sebagai kunci di data karyawan, '
                || 'jadi hanya huruf besar, angka, garis bawah dan tanda hubung, diawali huruf.');
    elsif v_code = any(seen) then
      return jsonb_build_object('code','code_duplicate',
        'message', v_where || ' muncul dua kali. Dua pola dengan kode sama berarti '
                || 'orang yang terpasang padanya bisa terbaca sebagai salah satu dari keduanya.');
    end if;
    seen := seen || v_code;

    if btrim(coalesce(sc ->> 'name', '')) = '' then
      return jsonb_build_object('code','name_required',
        'message', v_where || ' belum punya nama.');
    end if;

    if ops_hr.bad_minutes(sc -> 'start_minutes') then
      return jsonb_build_object('code','minutes_range',
        'message', v_where || ': jam masuk harus menit dalam sehari (0–1440) atau dikosongkan.');
    end if;
    if ops_hr.bad_minutes(sc -> 'end_minutes') then
      return jsonb_build_object('code','minutes_range',
        'message', v_where || ': jam pulang harus menit dalam sehari (0–1440) atau dikosongkan.');
    end if;
    if ops_hr.bad_minutes(sc -> 'break_minutes') then
      return jsonb_build_object('code','minutes_range',
        'message', v_where || ': istirahat harus menit dalam sehari (0–1440) atau dikosongkan.');
    end if;
    if ops_hr.bad_minutes(sc -> 'friday_break_minutes') then
      return jsonb_build_object('code','minutes_range',
        'message', v_where || ': istirahat Jumat harus menit dalam sehari (0–1440) atau dikosongkan.');
    end if;
    if ops_hr.bad_minutes(sc -> 'friday_end_minutes') then
      return jsonb_build_object('code','minutes_range',
        'message', v_where || ': jam pulang Jumat harus menit dalam sehari (0–1440) atau dikosongkan.');
    end if;

    st  := ops_hr.minutes_of(sc -> 'start_minutes');
    en  := ops_hr.minutes_of(sc -> 'end_minutes');
    br  := ops_hr.minutes_of(sc -> 'break_minutes');
    fen := ops_hr.minutes_of(sc -> 'friday_end_minutes');
    fbr := ops_hr.minutes_of(sc -> 'friday_break_minutes');

    if st is not null and en is not null and en = st then
      return jsonb_build_object('code','end_before_start',
        'message', v_where || ': pulang ' || ops_hr.clock_face(en)
                || ' tidak sesudah masuk ' || ops_hr.clock_face(st) || '.');
    end if;

    night := st is not null and en is not null and en < st;
    span  := ops_hr.shift_minutes(st, en);

    -- A break that eats the whole day leaves nought hours, and nought hours is
    -- not a schedule — it is a row that quietly values every day at zero for
    -- whoever is on it.
    if span is not null and br is not null and br >= span then
      return jsonb_build_object('code','break_too_long',
        'message', v_where || ': istirahat ' || br || ' menit menghabiskan seluruh hari kerja '
                || ops_hr.clock_face(st) || '–' || ops_hr.clock_face(en) || '.');
    end if;

    if night and fen is not null then
      return jsonb_build_object('code','overnight_friday_end',
        'message', v_where || ': shift ini melewati tengah malam, jadi jam pulang Jumat '
                || 'belum bisa diatur — kosongkan; shift Jumat malam pulang pada jam pulang biasa.');
    end if;

    if not night and st is not null and fen is not null and fen <= st then
      return jsonb_build_object('code','friday_end_before_start',
        'message', v_where || ': pulang Jumat ' || ops_hr.clock_face(fen)
                || ' tidak sesudah masuk ' || ops_hr.clock_face(st) || '.');
    end if;

    -- Friday's two halves fall back independently (D289), so its arithmetic is
    -- checked on the pair it will actually be computed from — an ordinary
    -- break can be too long for a Friday that finishes early.
    f_end   := coalesce(fen, en);
    f_break := coalesce(fbr, br);
    f_span  := case when night then span
                    when st is not null and f_end is not null and f_end > st then f_end - st end;
    if f_span is not null and f_break is not null and f_break >= f_span then
      return jsonb_build_object('code','friday_break_too_long',
        'message', v_where || ': istirahat Jumat ' || f_break || ' menit menghabiskan seluruh hari Jumat '
                || ops_hr.clock_face(st) || '–' || ops_hr.clock_face(f_end) || '.');
    end if;

    /* 0195 (D340): each weekday may carry its own hours and what a day of it
       is worth. Keys are ISO weekdays, 1 Senin … 7 Minggu; a day not listed
       takes the pattern's own hours (and Friday's where set). Checked in key
       order, and each day from *is it a day* to *does its arithmetic work*.
       The sentences are `schedule-rules.ts`'s. */
    if jsonb_typeof(sc -> 'days') = 'object' then
      for dk in select key, value from jsonb_each(sc -> 'days') order by key collate "C" loop
        if dk.key !~ '^[1-7]$' then
          return jsonb_build_object('code','day_key',
            'message', v_where || ': hari "' || dk.key || '" tidak dikenal — pakai 1 (Senin) sampai 7 (Minggu).');
        end if;
        dv := dk.value;
        d_where := ops_hr.weekday_name(dk.key::int);
        if jsonb_typeof(dv) is distinct from 'object' then
          return jsonb_build_object('code','day_shape',
            'message', v_where || ': ' || d_where || ' harus berisi jam masuk, jam pulang dan istirahat, atau libur.');
        end if;
        if coalesce((dv ->> 'off')::boolean, false) then continue; end if;
        if ops_hr.bad_minutes(dv -> 'start_minutes') then
          return jsonb_build_object('code','minutes_range',
            'message', v_where || ': jam masuk ' || d_where || ' harus menit dalam sehari (0–1440) atau dikosongkan.');
        end if;
        if ops_hr.bad_minutes(dv -> 'end_minutes') then
          return jsonb_build_object('code','minutes_range',
            'message', v_where || ': jam pulang ' || d_where || ' harus menit dalam sehari (0–1440) atau dikosongkan.');
        end if;
        if ops_hr.bad_minutes(dv -> 'break_minutes') then
          return jsonb_build_object('code','minutes_range',
            'message', v_where || ': istirahat ' || d_where || ' harus menit dalam sehari (0–1440) atau dikosongkan.');
        end if;
        if dv ? 'pay_multiplier' and dv -> 'pay_multiplier' <> 'null'::jsonb then
          d_mult := case when jsonb_typeof(dv -> 'pay_multiplier') = 'number'
                         then (dv ->> 'pay_multiplier')::numeric end;
          if d_mult is null or d_mult <= 0 or d_mult > 5 then
            return jsonb_build_object('code','day_multiplier',
              'message', v_where || ': pengali upah ' || d_where || ' harus angka lebih dari 0 dan paling banyak 5.');
          end if;
        end if;
        d_st := coalesce(ops_hr.minutes_of(dv -> 'start_minutes'), st);
        d_en := coalesce(ops_hr.minutes_of(dv -> 'end_minutes'),
                         case when dk.key = '5' then coalesce(fen, en) else en end);
        d_br := coalesce(ops_hr.minutes_of(dv -> 'break_minutes'),
                         case when dk.key = '5' then coalesce(fbr, br) else br end);
        if d_st is not null and d_en is not null and d_en = d_st then
          return jsonb_build_object('code','day_end_before_start',
            'message', v_where || ': pulang ' || d_where || ' ' || ops_hr.clock_face(d_en)
                    || ' tidak sesudah masuk ' || ops_hr.clock_face(d_st) || '.');
        end if;
        d_span := ops_hr.shift_minutes(d_st, d_en);
        if d_span is not null and d_br is not null and d_br >= d_span then
          return jsonb_build_object('code','day_break_too_long',
            'message', v_where || ': istirahat ' || d_where || ' ' || d_br || ' menit menghabiskan seluruh hari '
                    || ops_hr.clock_face(d_st) || '–' || ops_hr.clock_face(d_en) || '.');
        end if;
      end loop;
    elsif sc ? 'days' and sc -> 'days' <> 'null'::jsonb then
      return jsonb_build_object('code','days_shape',
        'message', v_where || ': jadwal per hari harus berupa daftar hari 1 (Senin) sampai 7 (Minggu).');
    end if;

    /* 0206 (D364): the shifts somebody on this pattern may work, read off
       their taps — Satpam's Shift 1 07.00–17.00 and Shift 2 17.00–07.00.
       Checked in list order, each from *is it a shift* to *does its
       arithmetic work*. The sentences are `schedule-rules.ts`'s. */
    if jsonb_typeof(sc -> 'shifts') = 'array' then
      if jsonb_array_length(sc -> 'shifts') > 6 then
        return jsonb_build_object('code','shifts_too_many',
          'message', v_where || ': paling banyak 6 shift dalam satu pola.');
      end if;
      s_seen := '{}'; sj := 0;
      for shj in select value from jsonb_array_elements(sc -> 'shifts') loop
        sj := sj + 1;
        if jsonb_typeof(shj) is distinct from 'object' then
          return jsonb_build_object('code','shift_shape',
            'message', v_where || ': shift ke-' || sj || ' harus berisi kode, nama, jam masuk dan jam pulang.');
        end if;
        s_code := btrim(coalesce(shj ->> 'code', ''));
        s_where := case when s_code = '' then 'shift ke-' || sj else 'shift ' || s_code end;
        if s_code = '' then
          return jsonb_build_object('code','shift_code',
            'message', v_where || ': shift ke-' || sj || ' belum punya kode.');
        elsif s_code !~ '^[A-Z0-9][A-Z0-9_-]*$' then
          return jsonb_build_object('code','shift_code',
            'message', v_where || ': kode shift ' || s_code || ' hanya huruf besar, angka, garis bawah dan tanda hubung.');
        elsif s_code = any(s_seen) then
          return jsonb_build_object('code','shift_code_duplicate',
            'message', v_where || ': shift ' || s_code || ' muncul dua kali.');
        end if;
        s_seen := s_seen || s_code;
        if btrim(coalesce(shj ->> 'name', '')) = '' then
          return jsonb_build_object('code','shift_name',
            'message', v_where || ': ' || s_where || ' belum punya nama.');
        end if;
        if ops_hr.minutes_of(shj -> 'start_minutes') is null or ops_hr.bad_minutes(shj -> 'start_minutes')
           or ops_hr.minutes_of(shj -> 'end_minutes') is null or ops_hr.bad_minutes(shj -> 'end_minutes') then
          return jsonb_build_object('code','shift_minutes',
            'message', v_where || ': jam masuk dan jam pulang ' || s_where || ' harus menit dalam sehari (0–1440).');
        end if;
        if ops_hr.bad_minutes(shj -> 'break_minutes') then
          return jsonb_build_object('code','minutes_range',
            'message', v_where || ': istirahat ' || s_where || ' harus menit dalam sehari (0–1440) atau dikosongkan.');
        end if;
        s_st := ops_hr.minutes_of(shj -> 'start_minutes');
        s_en := ops_hr.minutes_of(shj -> 'end_minutes');
        s_br := ops_hr.minutes_of(shj -> 'break_minutes');
        if s_en = s_st then
          return jsonb_build_object('code','shift_end_before_start',
            'message', v_where || ': pulang ' || s_where || ' ' || ops_hr.clock_face(s_en)
                    || ' tidak sesudah masuk ' || ops_hr.clock_face(s_st) || '.');
        end if;
        s_span := ops_hr.shift_minutes(s_st, s_en);
        if s_br is not null and s_br >= s_span then
          return jsonb_build_object('code','shift_break',
            'message', v_where || ': istirahat ' || s_where || ' ' || s_br || ' menit menghabiskan seluruh shift '
                    || ops_hr.clock_face(s_st) || '–' || ops_hr.clock_face(s_en) || '.');
        end if;
      end loop;
    elsif sc ? 'shifts' and sc -> 'shifts' <> 'null'::jsonb then
      return jsonb_build_object('code','shifts_shape',
        'message', v_where || ': daftar shift harus berupa daftar.');
    end if;
  end loop;

  /* A unit pointing at a pattern that is not there is worse than a unit
     pointing at nothing: nothing falls back to the company clock and says so,
     while a dangling code resolves to no schedule at all and reads as
     *belum ditetapkan* for everybody in that unit, with no sign of why.
     `collate "C"`: see 0117 and F143. */
  for u in
    select key, value from jsonb_each_text(coalesce(p_rules -> 'schedule_by_unit', '{}'::jsonb))
    order by key collate "C"
  loop
    if not (u.value = any(seen)) then
      return jsonb_build_object('code','unit_unknown_code',
        'message', 'Unit ' || u.key || ' dipasang ke pola ' || u.value
                || ', dan pola itu tidak ada di daftar.');
    end if;
  end loop;

  return null;
end $$;


/* ── a payroll line — restated from 0202, late against the shift ── */
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
    out_row.worked_days := out_row.worked_days + d.day_value;
    if d.state = 'review' then out_row.open_days := out_row.open_days + 1; end if;
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
      'open', d.state = 'review');

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
      is_present := case when d.mark_kind is not null then d.mark_kind = 'half_day'
                         else not ops_hr.is_rest_day(v_rules, d.work_date) end;
    else
      is_present := case when d.mark_kind is not null then d.mark_kind = 'half_day'
                         else d.day_value > 0 end;
      if not allow_prem and coalesce(d.pay_multiplier, 1) > 1 then is_present := false; end if;
    end if;

    if is_present then
      select exists (
        select 1 from ops_hr.allowance_withholdings aw
         where aw.employee_id = emp.id and aw.work_date = d.work_date
           and aw.restored_by is null
      ) into withheld;
      if withheld then n_withheld := n_withheld + 1;
      else
        n_present := n_present + 1;
        allow_units := allow_units + case when d.day_value > 0 then d.day_value else 1 end;
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
       and d.mark_kind is null and d.state = 'complete' then
      gap := emp.daily_hours - d.work_hours;
      if gap > ut_grace then
        short := short + gap;
        if gap > emp.daily_hours / 2 then half_days := half_days + 1; end if;
      end if;
    end if;
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
  out_row.base_pay := case emp.pay_basis
    when 'monthly' then emp.base_rate
    when 'daily'   then round(paid_units * emp.base_rate)
    else                round(paid_hours * emp.base_rate)
  end::bigint;

  out_row.allowance_days := n_present;
  out_row.allowance_withheld_days := n_withheld;
  out_row.allowance_pay := case when allow_byval
    then round(allow_units * emp.allowance_rate)::bigint
    else (n_present::bigint * emp.allowance_rate) end;
  -- What the withheld days would have paid, and **who decided each one**. A
  -- deduction with no name against it is the kind a payslip cannot defend.
  out_row.allowance_withheld_amount := (n_withheld::bigint * emp.allowance_rate);
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

  out_row.take_home := out_row.net - out_row.contribution_total;

  -- The contract's spellings for two figures that already exist under another
  -- name. Assigned from the originals so the pair cannot drift.
  out_row.days_worked := out_row.worked_days;
  out_row.days_open   := out_row.open_days;

  /* The sentences a payslip needs, because a figure nobody can take apart is a
     figure somebody argues with at the counter. */
  if out_row.open_days > 0 then
    w := w || format('%s hari belum dibaca — belum bernilai sampai ada yang membacanya', out_row.open_days);
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
  out_row.warnings := w;

  return out_row;
end $$;


/* ── the week and the month — restated from 0195, with the shifts ── */
create or replace function ops_hr.schedule_roll()
returns jsonb
language sql stable set search_path = ops_hr, pg_temp as $$
  with rules as (select ops_hr.rules_on(ops_core.office_day()) as r),
  days as (
    select case when (select r ->> 'week_pattern' from rules) = '5day' then 5 else 6 end as n
  ),
  sc as (
    select s.value as j, s.value ->> 'code' as code
      from rules, jsonb_array_elements(coalesce(rules.r -> 'schedules','[]'::jsonb)) s
  ),
  people as (
    select e.employee_no, e.full_name, e.unit, e.schedule_code,
           -- The pattern actually in force: what HR linked, else what the unit
           -- defaults to, else nothing at all.
           coalesce(e.schedule_code,
                    (select r -> 'schedule_by_unit' ->> e.unit from rules)) as effective
      from ops_hr.employees e where e.active
  ),
  hours as (
    select sc.code, sc.j,
      (sc.j ->> 'start_minutes')::int         as st,
      (sc.j ->> 'end_minutes')::int           as en,
      (sc.j ->> 'break_minutes')::int         as br,
      (sc.j ->> 'friday_break_minutes')::int  as fbr,
      (sc.j ->> 'friday_end_minutes')::int    as fen
    from sc
  ),
  figured as (
    select h.code, h.j,
      case when h.st is null or h.en is null or h.br is null then null
           else round((ops_hr.shift_minutes(h.st, h.en) - h.br) / 60.0, 2) end as daily,
      -- Friday differs if either field says so, and each missing half falls
      -- back to the ordinary day rather than to nothing.
      case when h.st is null or h.en is null or h.br is null then null
           when h.fbr is null and h.fen is null then null
           else round((ops_hr.shift_minutes(h.st, coalesce(h.fen, h.en)) - coalesce(h.fbr, h.br)) / 60.0, 2)
      end as friday,
      -- What is stopping the figures, in words. A schedule nobody has finished
      -- describing is not a schedule of zero hours.
      nullif(concat_ws(', ',
        case when h.st  is null then 'jam masuk' end,
        case when h.en  is null then 'jam pulang' end,
        case when h.br  is null then 'istirahat' end), '') as missing
    from hours h
  )
  select jsonb_build_object(
    'week_pattern', (select r ->> 'week_pattern' from rules),
    'schedules', coalesce((
      select jsonb_agg(jsonb_build_object(
        'code', f.code,
        'name', f.j ->> 'name',
        'start_minutes', (f.j ->> 'start_minutes')::int,
        'end_minutes', (f.j ->> 'end_minutes')::int,
        'break_minutes', (f.j ->> 'break_minutes')::int,
        'friday_break_minutes', (f.j ->> 'friday_break_minutes')::int,
        'friday_end_minutes', (f.j ->> 'friday_end_minutes')::int,
        'note', f.j ->> 'note',
        'hours_unconfirmed', coalesce((f.j ->> 'hours_unconfirmed')::boolean, false),
        'overnight', ops_hr.is_overnight(f.j),
        'day_boundary_minutes', ops_hr.day_boundary_minutes(f.j),
        -- 0195 (D340): the pattern's own weekdays, and the seven days as the
        -- reading will see them — each weekday's hours and what it is worth.
        'days', coalesce(f.j -> 'days', '{}'::jsonb),
        -- 0206 (D364): the shifts somebody on it may work.
        'shifts', coalesce(f.j -> 'shifts', '[]'::jsonb),
        'week', (select jsonb_agg(jsonb_build_object(
                   'isodow', g.d,
                   'start_minutes', ops_hr.minutes_of(x.sd -> 'start_minutes'),
                   'end_minutes', ops_hr.minutes_of(x.sd -> 'end_minutes'),
                   'break_minutes', ops_hr.minutes_of(x.sd -> 'break_minutes'),
                   'pay_multiplier', coalesce((x.sd ->> 'pay_multiplier')::numeric, 1),
                   'off', coalesce((x.sd ->> 'off')::boolean, false),
                   'own', (f.j -> 'days') ? g.d::text,
                   'hours', case when coalesce((x.sd ->> 'off')::boolean, false)
                                   or ops_hr.minutes_of(x.sd -> 'start_minutes') is null
                                   or ops_hr.minutes_of(x.sd -> 'end_minutes') is null then null
                              else round((ops_hr.shift_minutes(ops_hr.minutes_of(x.sd -> 'start_minutes'),
                                                               ops_hr.minutes_of(x.sd -> 'end_minutes'))
                                          - coalesce(ops_hr.minutes_of(x.sd -> 'break_minutes'), 0)) / 60.0, 2) end)
                   order by g.d)
                   from generate_series(1, 7) g(d)
                   -- 2026-09-07 is a Monday: g.d days after the Sunday before.
                   cross join lateral (select ops_hr.schedule_day(f.j, date '2026-09-06' + g.d) as sd) x),
        'hours', jsonb_build_object(
          'daily_hours', f.daily,
          'friday_hours', f.friday,
          'days_per_week', (select n from days),
          'weekly_hours', case when f.daily is null then null
            when f.friday is null then round(f.daily * (select n from days), 2)
            else round(f.daily * ((select n from days) - 1) + f.friday, 2) end,
          'monthly_hours', case when f.daily is null then null
            else round((case when f.friday is null then f.daily * (select n from days)
                             else f.daily * ((select n from days) - 1) + f.friday end)
                       * 52 / 12.0, 2) end,
          'blocked_by', case when f.missing is null then null
                             else 'Belum ada ' || f.missing || ' — jamnya belum bisa dihitung.' end),
        -- Linked **by name**, which is a decision somebody took.
        'assigned', (select count(*) from people p where p.schedule_code = f.code),
        -- On it by assumption only.
        'inherited', (select count(*) from people p
                       where p.schedule_code is null and p.effective = f.code),
        'units', coalesce((select jsonb_agg(u.key order by u.key)
                             from rules, jsonb_each_text(coalesce(rules.r -> 'schedule_by_unit','{}'::jsonb)) u
                            where u.value = f.code), '[]'::jsonb)))
      from figured f), '[]'::jsonb),
    'unlinked', coalesce((
      select jsonb_agg(jsonb_build_object('employee_no', p.employee_no,
                                          'full_name', p.full_name, 'unit', p.unit)
                       order by p.employee_no)
        from people p where p.effective is null), '[]'::jsonb),
    'inherited', coalesce((
      select jsonb_agg(jsonb_build_object('employee_no', p.employee_no,
                                          'full_name', p.full_name, 'unit', p.unit,
                                          'schedule_code', p.effective)
                       order by p.employee_no)
        from people p where p.schedule_code is null and p.effective is not null), '[]'::jsonb))
$$;


/* ── HRD sets a pattern's shifts ──────────────────────────────────────── */
--
-- Written into a new rule-book version, like `set_schedule_days` (0195) — the
-- same refusals, in the same order, because a pattern's shifts are part of the
-- book every payslip after them is read from. An empty list takes them away.
create or replace function ops_hr.set_schedule_shifts(
  p_code           text,
  p_shifts         jsonb,
  p_effective_from date,
  p_note           text,
  p_key            text default null)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare
  v_replayed jsonb; v_res jsonb; v_from date; v_base ops_hr.pay_rule_sets;
  v_later ops_hr.pay_rule_sets; v_old jsonb; v_rules jsonb; v_problem jsonb;
  v_spent text; v_clash text; v_version int; v_id uuid;
begin
  v_replayed := ops_core.idem_replay('hr','set_schedule_shifts', p_key);
  if v_replayed is not null then return v_replayed; end if;

  if not ops_core.has_permission('hrd.update') then
    return ops_core.refused('hr','schedule', p_code,'set_shifts',
      'not_permitted','Mengubah shift pola kerja butuh akses HRD.');
  end if;
  if coalesce(btrim(coalesce(p_note,'')), '') = '' then
    return ops_core.invalid('hr','schedule', p_code,'set_shifts',
      'note_required',
      'Tulis alasannya. Jam kerja yang berubah tanpa keterangan tidak bisa dijelaskan ke orang yang jamnya berubah.',
      jsonb_build_object('field','note'));
  end if;

  v_from := coalesce(p_effective_from, ops_core.office_day());

  select * into v_base from ops_hr.pay_rule_sets
   where effective_from <= v_from
   order by effective_from desc, version desc limit 1;
  if not found then
    return ops_core.conflict('hr','schedule', p_code,'set_shifts',
      'no_rule_book',
      format('Belum ada buku aturan gaji yang berlaku pada %s. IT menerbitkannya dulu.', v_from));
  end if;

  select * into v_later from ops_hr.pay_rule_sets
   where effective_from > v_from
   order by effective_from, version limit 1;
  if found then
    return ops_core.conflict('hr','schedule', p_code,'set_shifts',
      'later_version_exists',
      format('Versi %s berlaku mulai %s, sesudah tanggal ini, dan tidak memuat perubahan ini — '
             'shiftnya akan kembali pada tanggal itu. Pilih tanggal mulai %s atau sesudahnya.',
             v_later.version, v_later.effective_from, v_later.effective_from));
  end if;

  select s.value into v_old
    from jsonb_array_elements(coalesce(v_base.rules -> 'schedules','[]'::jsonb)) s
   where s.value ->> 'code' = p_code;
  if v_old is null then
    return ops_core.not_found('hr','schedule', p_code,'set_shifts',
      format('Tidak ada jadwal kerja bernama %s di buku aturan yang berlaku.', p_code));
  end if;

  v_rules := jsonb_set(v_base.rules, '{schedules}', (
    select jsonb_agg(
             case when s.value ->> 'code' = p_code
               then case when p_shifts is null or p_shifts = '[]'::jsonb
                      then s.value - 'shifts'
                      else s.value || jsonb_build_object('shifts', p_shifts) end
               else s.value end
             order by s.ord)
      from jsonb_array_elements(v_base.rules -> 'schedules') with ordinality s(value, ord)));

  if v_rules = v_base.rules then
    return ops_core.noop('hr','schedule', p_code,'set_shifts',
      'Shift-nya sudah itu.', jsonb_build_object('code', p_code, 'version', v_base.version));
  end if;

  v_problem := ops_hr.schedule_problem(v_rules);
  if v_problem is not null then
    return ops_core.invalid('hr','schedule', p_code,'set_shifts',
      v_problem ->> 'code', v_problem ->> 'message',
      jsonb_build_object('field','shifts'));
  end if;

  select run_no into v_spent from ops_hr.payroll_runs
   where status <> 'DRAFT' and period_end >= v_from
   order by period_start limit 1;
  if v_spent is not null then
    return ops_core.conflict('hr','schedule', p_code,'set_shifts',
      'already_paid',
      format('%s sudah ditandatangani untuk periode yang berakhir %s atau sesudahnya. '
             'Aturan tidak bisa mundur melewati uang yang sudah dibayarkan — '
             'terbitkan yang baru berlaku setelahnya.', v_spent, v_from));
  end if;

  select run_no into v_clash from ops_hr.payroll_runs
   where v_from > period_start and v_from <= period_end
   limit 1;
  if v_clash is not null then
    return ops_core.conflict('hr','schedule', p_code,'set_shifts',
      'inside_existing_run',
      format('%s mencakup tanggal itu, dan periode itu dihitung dengan aturan yang berlaku '
             'saat dibuka. Pilih tanggal di luar periode yang sudah ada.', v_clash));
  end if;

  select coalesce(max(version), 0) + 1 into v_version from ops_hr.pay_rule_sets;
  insert into ops_hr.pay_rule_sets (version, effective_from, note, rules, created_by)
  values (v_version, v_from, btrim(p_note), v_rules, auth.uid())
  returning id into v_id;

  v_res := ops_core.ok('hr','schedule', p_code,'set_shifts',
    jsonb_build_object('code', p_code, 'version', v_version, 'effective_from', v_from),
    jsonb_build_object('shifts', coalesce(v_old -> 'shifts', '[]'::jsonb)),
    jsonb_build_object('shifts', coalesce(p_shifts, '[]'::jsonb), 'version', v_version,
                       'effective_from', v_from));
  return ops_core.idem_remember('hr','set_schedule_shifts', p_key, v_res);
end $$;

revoke execute on function ops_hr.set_schedule_shifts(text, jsonb, date, text, text) from public;
grant execute on function ops_hr.set_schedule_shifts(text, jsonb, date, text, text) to authenticated;

/* ── HRD says which shift a day was ───────────────────────────────────── */
--
-- For the day the taps cannot settle: one tap with no partner, a tap at an
-- hour no shift is near, or a run read from the wrong end. The pick wins over
-- the reading for that day, and the days around it are read again from it.
-- A null shift takes the pick away. Not on a day already paid.
create or replace function ops_hr.pick_shift(
  p_employee_no text,
  p_work_date   date,
  p_shift_code  text,
  p_reason      text,
  p_key         text default null)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare
  v_replayed jsonb; v_res jsonb; emp ops_hr.employees%rowtype; v_sc jsonb; v_shift jsonb;
  v_old ops_hr.shift_picks; v_paid text; v_ref text;
begin
  v_replayed := ops_core.idem_replay('hr','pick_shift', p_key);
  if v_replayed is not null then return v_replayed; end if;
  v_ref := p_employee_no || '/' || coalesce(p_work_date::text, '');

  if not ops_core.has_permission('hrd.update') then
    return ops_core.refused('hr','shift_pick', v_ref,'pick',
      'not_permitted','Memilih shift butuh akses HRD.');
  end if;
  select * into emp from ops_hr.employees where employee_no = p_employee_no;
  if not found then
    return ops_core.not_found('hr','shift_pick', v_ref,'pick',
      format('Tidak ada karyawan bernomor %s.', p_employee_no));
  end if;
  if p_work_date is null then
    return ops_core.invalid('hr','shift_pick', v_ref,'pick',
      'date_required','Tanggalnya belum ada.', jsonb_build_object('field','work_date'));
  end if;
  if p_shift_code is not null and coalesce(btrim(coalesce(p_reason,'')), '') = '' then
    return ops_core.invalid('hr','shift_pick', v_ref,'pick',
      'reason_required',
      'Tulis alasannya — misalnya dari mana HRD tahu shift-nya.',
      jsonb_build_object('field','reason'));
  end if;

  if p_shift_code is not null then
    v_sc := ops_hr.pattern_on(emp.schedule_code, emp.unit, p_work_date);
    select x into v_shift from jsonb_array_elements(coalesce(v_sc -> 'shifts', '[]'::jsonb)) x
     where x ->> 'code' = p_shift_code;
    if v_shift is null then
      return ops_core.invalid('hr','shift_pick', v_ref,'pick',
        'shift_unknown',
        format('Pola kerja %s pada %s tidak punya shift %s.',
               coalesce(v_sc ->> 'code', '(tanpa pola)'), p_work_date, p_shift_code),
        jsonb_build_object('field','shift_code'));
    end if;
  end if;

  -- The day is read from its neighbours as well, so the period that is paid
  -- is judged by the day on either side too.
  select run_no into v_paid from ops_hr.payroll_runs
   where status <> 'DRAFT' and p_work_date between period_start - 1 and period_end + 1
   order by period_start limit 1;
  if v_paid is not null then
    return ops_core.conflict('hr','shift_pick', v_ref,'pick',
      'already_paid',
      format('%s sudah ditandatangani untuk tanggal itu. Koreksinya lewat penyesuaian di periode berikutnya.', v_paid));
  end if;

  select * into v_old from ops_hr.shift_picks
   where employee_id = emp.id and work_date = p_work_date;

  if p_shift_code is null then
    if v_old.id is null then
      return ops_core.noop('hr','shift_pick', v_ref,'unpick',
        'Tidak ada shift yang dipilih untuk hari itu.', jsonb_build_object('shift_code', null));
    end if;
    delete from ops_hr.shift_picks where id = v_old.id;
  elsif v_old.id is not null and v_old.shift_code = p_shift_code then
    return ops_core.noop('hr','shift_pick', v_ref,'pick',
      'Shift itu sudah dipilih untuk hari itu.', jsonb_build_object('shift_code', p_shift_code));
  else
    insert into ops_hr.shift_picks (employee_id, work_date, shift_code, reason, picked_by)
    values (emp.id, p_work_date, p_shift_code, btrim(p_reason), auth.uid())
    on conflict (employee_id, work_date) do update
      set shift_code = excluded.shift_code, reason = excluded.reason,
          picked_by = excluded.picked_by, picked_at = now();
  end if;

  v_res := ops_core.ok('hr','shift_pick', v_ref, case when p_shift_code is null then 'unpick' else 'pick' end,
    jsonb_build_object('employee_no', p_employee_no, 'work_date', p_work_date, 'shift_code', p_shift_code),
    jsonb_build_object('shift_code', v_old.shift_code),
    jsonb_build_object('shift_code', p_shift_code, 'reason', nullif(btrim(coalesce(p_reason,'')), '')));
  return ops_core.idem_remember('hr','pick_shift', p_key, v_res);
end $$;

revoke execute on function ops_hr.pick_shift(text, date, text, text, text) from public;
grant execute on function ops_hr.pick_shift(text, date, text, text, text) to authenticated;

grant execute on function
  ops_hr.shift_start_at(date, jsonb),
  ops_hr.shift_end_at(date, jsonb),
  ops_hr.shift_link(jsonb, timestamptz, timestamptz),
  ops_hr.shift_role(jsonb, timestamptz),
  ops_hr.shift_reading(uuid, date)
  to authenticated;
