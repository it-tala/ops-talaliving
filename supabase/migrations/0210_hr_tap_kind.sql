-- 0210 — a tap from the phone says what it is (D367).
--
-- Owner: *update attendance modul dari sisi user, tidak hanya tap clock in dan
-- clock out, tapi juga tap ketika break in dan break out, overtime in,
-- overtime out dan absensi sedang di luar kantor dan kembali ke kantor.*
--
-- Until now a tap said only *when* (D307): the phone's button read the day to
-- decide its own label, and `read_day` placed every tap by the clock (D141).
-- The person on the phone knows more than the clock does — that 12.05 is the
-- start of the break and not an early pulang, that 15.30 is a trip to the
-- supplier and not the end of the day. So a tap from `/saya` now carries
-- **what it is**:
--
--   in · break_out · break_in · out · ot_start · ot_end   the six slots
--   away_out · away_back                                   keluar kantor /
--                                                          kembali ke kantor
--
-- What changes, and what does not:
--
--   * `attendance_scans.kind` is nullable. The machine's export and HRD's
--     typed taps say nothing (null) and are read exactly as before. Old phone
--     taps are null too.
--   * **A tap that says what it is fills its own slot** in `read_day`; the
--     clock windows place only the taps that say nothing, into the slots
--     still empty. A second tap of the same kind is left over, as any tap the
--     rule cannot place (the slot reading sends the day to review; the
--     schedule readings ignore it, as they ignore extra taps).
--   * A finger tried twice is still one tap (two minutes, D141): when the
--     reader and the phone both took the same moment, the one tap keeps what
--     the phone said. Two taps that say *different* things are two events,
--     however close — the person pressed two different buttons.
--   * **Keluar kantor / kembali ke kantor are not slots.** They are taken out
--     of the reading before anything is placed — neither an arrival, a break
--     nor a pulang, and never "a tap the rule could not place". The day says
--     them as a note (*Di luar kantor 10.12–11.40 (88 menit)*), and the time
--     is **not deducted**: it is work done somewhere else. Default taken,
--     reversible.
--   * Keluar kantor needs a note — where to and why — refused without one the
--     same way an off-site tap is (`away_needs_note`, carrying the location
--     verdict so the phone shows the same form). Default taken, reversible.
--   * Nothing is refused for its order. A *selesai istirahat* with no *mulai*
--     is written and the reading says what is missing — the tap is a fact
--     (D307); the screen only offers the buttons that make sense next.
--   * Lembur taps are shown, never paid from here (D138): only an approved
--     overtime claim pays (D333).
--   * The shift reading (D364) still pairs a guard's taps by the clock; it only
--     stops counting keluar/kembali as ends of a shift.
--
-- `tap_self` gains `p_kind` as its **last** argument, so every positional call
-- keeps working, and the old signature is dropped (one function, no overload
-- for PostgREST — 0188). `v_located_tap` gains `kind` at the end.

/* ── the column ───────────────────────────────────────────────────────── */
alter table ops_hr.attendance_scans add column if not exists kind text;
alter table ops_hr.attendance_scans drop constraint if exists scan_kind_known;
alter table ops_hr.attendance_scans add constraint scan_kind_known check (
  kind is null or kind in ('in','break_out','break_in','out','ot_start','ot_end','away_out','away_back'));

comment on column ops_hr.attendance_scans.kind is
  'Apa tap ini menurut orang yang menekannya (D367): slot (in, break_out, break_in, out, ot_start, ot_end) atau keluar/kembali kantor (away_out, away_back). Null = tap hanya menyebut kapan (mesin, HRD, tap HP lama) dan dibaca oleh jam (D141).';

analyze ops_hr.attendance_scans;

/* ── two small words ──────────────────────────────────────────────────── */
create or replace function ops_hr.is_away_tap(p_kind text)
returns boolean
language sql immutable set search_path = ops_hr, pg_temp as $$
  select coalesce(p_kind in ('away_out','away_back'), false)
$$;

-- The same words as the buttons on `/saya` (`TAP_KIND_LABELS`).
create or replace function ops_hr.tap_kind_label(p_kind text)
returns text
language sql immutable set search_path = ops_hr, pg_temp as $$
  select case p_kind
    when 'in'        then 'Masuk'
    when 'break_out' then 'Mulai istirahat'
    when 'break_in'  then 'Selesai istirahat'
    when 'out'       then 'Pulang'
    when 'ot_start'  then 'Mulai lembur'
    when 'ot_end'    then 'Selesai lembur'
    when 'away_out'  then 'Keluar kantor'
    when 'away_back' then 'Kembali ke kantor'
  end
$$;

grant execute on function ops_hr.is_away_tap(text) to authenticated;
grant execute on function ops_hr.tap_kind_label(text) to authenticated;


/* ── the shift reading — restated from 0206; keluar/kembali left out ── */
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
       -- 0210 (D366): leaving the office and coming back is neither end of a shift.
       and not ops_hr.is_away_tap(a.kind)
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


/* ── one day, read — restated from 0206, with the kind a tap says ── */
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
  -- 0210: what a tap says it is (D367).
  v_kinds       text[] := '{}';
  extra         timestamptz[] := '{}';
  d_ot          boolean := false;
  i             int;
  aw            record;
  a_out         timestamptz;
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
     reaches outside the day and the one after it.

     0210 (D367): keluar kantor / kembali ke kantor are not read here at all —
     they are said as a note further down. When the reader and the phone took
     the same moment, the one tap keeps what the phone said it was; two taps
     that say different things (masuk, then mulai istirahat a minute later)
     are two taps. */
  for tap in
    select s.at, s.kind from ops_hr.attendance_scans s
     where s.employee_id = p_employee
       and s.work_date between p_date and p_date + 1
       and s.at >= v_from and s.at < v_to
       and not ops_hr.is_away_tap(s.kind)
     order by s.at, (s.kind is null)
  loop
    if prev is null or tap.at - prev >= interval '2 minutes'
       -- Two taps that say different things are two events, however close.
       or tap.kind <> v_kinds[array_length(v_kinds, 1)] then
      kept  := kept || tap.at;
      v_kinds := v_kinds || tap.kind;
      prev  := tap.at;
    elsif tap.kind is not null and v_kinds[array_length(v_kinds, 1)] is null then
      v_kinds[array_length(v_kinds, 1)] := tap.kind;
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

  /* 0210 (D367): a tap that says what it is fills its own slot — the first of
     each kind; a second of the same kind is left over. Only the taps that say
     nothing go on to be placed by the clock, into the slots still empty. The
     shift reading pairs by the clock and is left as it is. */
  if not v_shift then
    for i in 1 .. n_taps loop
      if    v_kinds[i] = 'in'        and v_in   is null then v_in   := kept[i];
      elsif v_kinds[i] = 'break_out' and v_bout is null then v_bout := kept[i];
      elsif v_kinds[i] = 'break_in'  and v_bin  is null then v_bin  := kept[i];
      elsif v_kinds[i] = 'out'       and v_out  is null then v_out  := kept[i];
      elsif v_kinds[i] = 'ot_start'  and v_ots  is null then v_ots  := kept[i];
      elsif v_kinds[i] = 'ot_end'    and v_ote  is null then v_ote  := kept[i];
      elsif v_kinds[i] is not null then extra := extra || kept[i];
      end if;
    end loop;
    d_ot := v_ots is not null or v_ote is not null;
    select coalesce(array_agg(kept[q] order by q), '{}') into rest
      from generate_subscripts(kept, 1) q where v_kinds[q] is null;
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

         masuk   the first tap (or the one that says it is masuk, D367);
                 arriving early does not add hours;
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
    -- `rest` is the taps that say nothing (D367); with none of those, the
    -- first tap of all stands for masuk, as it always has.
    v_in     := coalesce(v_in, rest[1], kept[1]);
    select max(t) into v_last from unnest(rest) t where t > v_in;

    if v_bout is null then
      select t into pick from unnest(rest) t
        where t > v_in and ops_hr.wita_minutes(t) >= 11*60 and ops_hr.wita_minutes(t) < 13*60+30
        order by t limit 1;
      if pick is not null then v_bout := pick; pick := null; end if;
    end if;
    if v_bin is null then
      select t into pick from unnest(rest) t
        where t > v_in and ops_hr.wita_minutes(t) >= 11*60+30 and ops_hr.wita_minutes(t) < 14*60+30
          and (v_bout is null or t > v_bout)
        order by t limit 1;
      if pick is not null then v_bin := pick; pick := null; end if;
    end if;

    if v_sched is not null then
      v_start_at := (p_date::timestamp + make_interval(mins => s_min)) at time zone ops_core.office_tz();
      v_end_at   := (p_date::timestamp + make_interval(mins => e_min)) at time zone ops_core.office_tz();
      if v_mode = 'in_out' then
        /* 0199 (D353): *tap wajib hanya di jam datang dan pulang*. Pulang is
           the last tap, whenever it is — leaving early is a short day, not a
           missing tap — and a day with only one tap has no pulang. */
        v_out := coalesce(v_out, v_last);
      elsif v_out is null then
        select t into pick from unnest(rest) t
          where t > v_in and abs(extract(epoch from t - v_end_at)) <= v_win * 60
          order by abs(extract(epoch from t - v_end_at)), t limit 1;
        if pick is not null then v_out := pick; pick := null; end if;
      end if;
      v_hours_to := coalesce(v_out, v_end_at);
      v_work := greatest(extract(epoch from least(v_hours_to, v_end_at)
                                 - greatest(v_in, v_start_at)) / 60 - b_min, 0);
      v_work := case when v_roundm > 0 then round(v_work / v_roundm) * v_roundm else v_work end / 60.0;
      if d_ot then
        /* 0210 (D367): the person said when lembur began and ended, so that is
           the lembur shown — still never paid from here (D138). */
        if v_ots is not null and v_ote is not null then
          v_ot := greatest(extract(epoch from v_ote - v_ots) / 60, 0);
          v_ot := case when v_roundm > 0 then round(v_ot / v_roundm) * v_roundm else v_ot end / 60.0;
        end if;
      elsif v_mode = 'in_out' then
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
      v_out  := coalesce(v_out, v_last);
      v_work := greatest(extract(epoch from coalesce(v_out, v_in) - v_in) / 60 - b_min, 0);
      v_work := case when v_roundm > 0 then round(v_work / v_roundm) * v_roundm else v_work end / 60.0;
      if v_mode = 'in_out' and v_out is null then
        v_issues := v_issues || 'Tidak ada tap pulang — tap datang dan pulang wajib'::text;
      end if;
    end if;
    v_break := b_min / 60.0;
    /* A lembur that began and was never said to end: shown, not a problem for
       the day's pay (lembur is never paid from here). */
    if v_ots is not null and v_ote is null then
      v_notes := v_notes || format('Mulai lembur %s, belum ada tap selesai lembur',
                                   to_char(v_ots at time zone ops_core.office_tz(), 'HH24:MI'));
    end if;
    rest := '{}';
    extra := '{}';

  elsif n_taps > 0 and not v_night then
    /* 0210 (D367): every slot below fills only if no tap said it was that. */
    if v_in is null then
      v_in := rest[1];
      rest := rest[2:];
    end if;

    if v_bout is null then
      select t into pick from unnest(rest) t
        where ops_hr.wita_minutes(t) >= 11*60 and ops_hr.wita_minutes(t) < 13*60+30
        order by t limit 1;
      if pick is not null then v_bout := pick; rest := array_remove(rest, pick); pick := null; end if;
    end if;

    if v_bin is null then
      select t into pick from unnest(rest) t
        where ops_hr.wita_minutes(t) >= 11*60+30 and ops_hr.wita_minutes(t) < 14*60+30
        order by t limit 1;
      if pick is not null then v_bin := pick; rest := array_remove(rest, pick); pick := null; end if;
    end if;

    if v_out is null then
      select t into pick from unnest(rest) t
        where ops_hr.wita_minutes(t) >= 14*60+30
          and (v_ots is null or t < v_ots)
        order by t limit 1;
      if pick is not null then v_out := pick; rest := array_remove(rest, pick); pick := null; end if;
    end if;

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
    if v_in is null then
      v_in := rest[1];
      rest := rest[2:];
    end if;

    if v_bout is null then
      select t into pick from unnest(rest) t where t < v_out_from order by t limit 1;
      if pick is not null then v_bout := pick; rest := array_remove(rest, pick); pick := null; end if;
    end if;

    if v_bin is null then
      select t into pick from unnest(rest) t
        where t < v_out_from and (v_bout is null or t > v_bout) order by t limit 1;
      if pick is not null then v_bin := pick; rest := array_remove(rest, pick); pick := null; end if;
    end if;

    if v_out is null then
      select t into pick from unnest(rest) t
        where t >= v_out_from and (v_ots is null or t < v_ots) order by t limit 1;
      if pick is not null then v_out := pick; rest := array_remove(rest, pick); pick := null; end if;
    end if;
  end if;

  if v_out is not null and v_ots is null and not v_read then
    select t into pick from unnest(rest) t where t > v_out order by t limit 1;
    if pick is not null then v_ots := pick; rest := array_remove(rest, pick); pick := null; end if;
  end if;

  if v_ots is not null and v_ote is null and not v_read then
    select t into pick from unnest(rest) t where t > v_ots order by t limit 1;
    if pick is not null then v_ote := pick; rest := array_remove(rest, pick); pick := null; end if;
  end if;

  /* A second tap of a kind already filled is left over like any other (D367). */
  if not v_read then
    select coalesce(array_agg(t order by t), '{}') into rest from unnest(rest || extra) t;
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
    -- Only possible when every tap said what it was and none said masuk (D367).
    if v_in is null then v_issues := v_issues || 'Tidak ada tap masuk'::text; end if;
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

  /* 0210 (D367): time out of the office, said and never deducted — it is work
     done somewhere else. Paired in order; one without the other is said too,
     and is not a problem for the day: the reading above never saw them. */
  for aw in
    select s.at, s.kind from ops_hr.attendance_scans s
     where s.employee_id = p_employee
       and s.work_date between p_date - 1 and p_date + 1
       and s.at >= v_from and s.at < v_to
       and ops_hr.is_away_tap(s.kind)
     order by s.at
  loop
    if aw.kind = 'away_out' then
      if a_out is not null then
        v_notes := v_notes || format('Keluar kantor %s, tanpa tap kembali',
                                     to_char(a_out at time zone ops_core.office_tz(), 'HH24:MI'));
      end if;
      a_out := aw.at;
    elsif a_out is null then
      v_notes := v_notes || format('Kembali ke kantor %s, tanpa tap keluar',
                                   to_char(aw.at at time zone ops_core.office_tz(), 'HH24:MI'));
    else
      v_notes := v_notes || format('Di luar kantor %s–%s (%s menit)',
                                   to_char(a_out at time zone ops_core.office_tz(), 'HH24:MI'),
                                   to_char(aw.at at time zone ops_core.office_tz(), 'HH24:MI'),
                                   round(extract(epoch from aw.at - a_out) / 60));
      a_out := null;
    end if;
  end loop;
  if a_out is not null then
    v_notes := v_notes || format('Keluar kantor %s, belum kembali',
                                 to_char(a_out at time zone ops_core.office_tz(), 'HH24:MI'));
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


/* ── the tap says what it is — restated from 0188, `p_kind` last ─────── */
drop function if exists ops_hr.tap_self(double precision, double precision, double precision, text, uuid, text);

create or replace function ops_hr.tap_self(
  p_lat double precision default null,
  p_lng double precision default null,
  p_accuracy_m double precision default null,
  p_note text default null,
  p_photo_id uuid default null,
  p_key text default null,
  p_kind text default null)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare
  v_replayed jsonb; v_emp uuid; v_emp_no text; v_id uuid; v_at timestamptz := now(); v_res jsonb;
  v_where jsonb; v_verdict text; v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_tap_no text; v_owner uuid; v_kind text := nullif(btrim(coalesce(p_kind, '')), '');
begin
  v_replayed := ops_core.idem_replay('hr','tap_self', p_key);
  if v_replayed is not null then return v_replayed; end if;

  v_emp := ops_hr.my_employee_id();
  if v_emp is null then
    return ops_core.refused('hr','attendance', null,'tap_self',
      'no_employee_link',
      'Akun ini belum tertaut ke data karyawan, jadi presensi tidak bisa dicatat sendiri. Minta HRD menautkannya.');
  end if;

  -- What the tap is, if it says (D367). Never refused for its order: the tap
  -- is a fact and the reading says what is missing (D307).
  if v_kind is not null and ops_hr.tap_kind_label(v_kind) is null then
    return ops_core.invalid('hr','attendance', null,'tap_self',
      'bad_kind','Jenis tap tidak dikenal.', jsonb_build_object('field','kind'));
  end if;

  -- A reading is a point, or nothing. Half a point is a client bug, not a place.
  if (p_lat is null) <> (p_lng is null)
     or p_lat not between -90 and 90 or p_lng not between -180 and 180
     or p_accuracy_m < 0 then
    return ops_core.invalid('hr','attendance', null,'tap_self',
      'bad_location','Lokasi dari HP tidak utuh atau tidak masuk akal.',
      jsonb_build_object('field','lat'));
  end if;

  v_where := ops_hr.judge_location(p_lat, p_lng, p_accuracy_m);
  v_verdict := v_where ->> 'verdict';

  -- Off-site is recorded, never refused (D326, answer 1) — but it says why.
  -- This refusal is the phone's cue to show the form, so it carries the verdict.
  if (v_where ->> 'needs_note')::boolean and v_note is null then
    return ops_core.invalid('hr','attendance', null,'tap_self',
      'off_site_needs_note',
      case v_verdict
        when 'outside' then format('Anda di luar area %s (%s m dari titiknya). Tulis keterangan, lalu tap lagi.',
                                   v_where ->> 'site_name', round((v_where ->> 'distance_m')::numeric))
        when 'uncertain' then 'Lokasi HP kurang tepat untuk memastikan Anda di area. Tulis keterangan, lalu tap lagi.'
        else 'Lokasi tidak terbaca. Tulis keterangan, lalu tap lagi.'
      end,
      v_where || jsonb_build_object('field','note'));
  end if;

  -- Leaving the office says where to (D367), with the same form and the same
  -- verdict, so the phone needs no second way of asking.
  if v_kind = 'away_out' and v_note is null then
    return ops_core.invalid('hr','attendance', null,'tap_self',
      'away_needs_note',
      'Tulis keperluan keluar kantor — ke mana dan untuk apa — lalu tap lagi.',
      v_where || jsonb_build_object('field','note'));
  end if;

  if p_photo_id is not null then
    select a.uploaded_by into v_owner from ops_core.attachments a where a.id = p_photo_id;
    if not found then
      return ops_core.invalid('hr','attendance', null,'tap_self',
        'photo_not_found','Foto tidak ditemukan. Unggah ulang.', jsonb_build_object('field','photo_id'));
    end if;
    if v_owner is distinct from auth.uid() then
      return ops_core.refused('hr','attendance', null,'tap_self',
        'photo_not_yours','Foto presensi harus diunggah dari akun yang sama.');
    end if;
  end if;

  insert into ops_hr.attendance_scans
    (employee_id, work_date, at, verify, source, recorded_by, kind)
  values (v_emp, ops_core.office_day(v_at), v_at, 'app', 'self', auth.uid(), v_kind)
  returning id into v_id;

  select e.employee_no into v_emp_no from ops_hr.employees e where e.id = v_emp;
  v_tap_no := format('%s/%s', v_emp_no, to_char(v_at at time zone ops_core.office_tz(), 'YYYY-MM-DD"T"HH24:MI:SS.US'));

  insert into ops_hr.scan_locations
    (scan_id, tap_no, site_id, lat, lng, accuracy_m, distance_m, radius_m, verdict, note, photo_id)
  values (v_id, v_tap_no, (v_where ->> 'site_id')::uuid, p_lat, p_lng,
          (v_where ->> 'accuracy_m')::numeric, (v_where ->> 'distance_m')::numeric,
          (v_where ->> 'radius_m')::integer, v_verdict, v_note, p_photo_id);

  -- The photo on the evidence road, filed against this tap, so it is found
  -- from the tap and not only from the drive folder.
  if p_photo_id is not null then
    insert into ops_core.attachment_links (attachment_id, entity, entity_no, kind, note, linked_by)
    values (p_photo_id, 'attendance_scan', v_tap_no, 'foto_presensi', v_note, auth.uid())
    on conflict do nothing;
  end if;

  -- D327: the office clock, not the session's. The label says what the tap was.
  perform ops_core.record_activity_event('attendance_tap','attendance',
    format('Tap %s pukul %s%s',
           coalesce(lower(ops_hr.tap_kind_label(v_kind)), 'presensi'),
           to_char(v_at at time zone ops_core.office_tz(), 'HH24:MI'),
           case when (v_where ->> 'needs_note')::boolean then ' · di luar area' else '' end));

  v_res := ops_core.ok('hr','attendance', v_tap_no,'tap_self',
    jsonb_build_object('id', v_id, 'at', v_at, 'work_date', ops_core.office_day(v_at),
                       'tap_no', v_tap_no, 'kind', v_kind, 'location', v_where - 'site_id'));
  return ops_core.idem_remember('hr','tap_self', p_key, v_res);
end $$;

revoke execute on function ops_hr.tap_self(double precision, double precision, double precision, text, uuid, text, text) from public;
grant execute on function ops_hr.tap_self(double precision, double precision, double precision, text, uuid, text, text) to authenticated;


/* ── HRD's review of phone taps says what each one was ────────────────── */
create or replace view ops_hr.v_located_tap with (security_invoker = on) as
select l.tap_no,
       s.id           as scan_id,
       e.employee_no,
       e.full_name,
       e.unit,
       s.at,
       s.work_date,
       l.verdict,
       l.verdict in ('outside','uncertain','no_location') as flagged,
       l.lat, l.lng, l.accuracy_m, l.distance_m, l.radius_m,
       w.code         as site_code,
       w.name         as site_name,
       l.note,
       l.photo_id,
       a.web_view_link as photo_link,
       a.filename     as photo_filename,
       s.kind
  from ops_hr.scan_locations l
  join ops_hr.attendance_scans s on s.id = l.scan_id
  join ops_hr.employees e on e.id = s.employee_id
  left join ops_hr.work_sites w on w.id = l.site_id
  left join ops_core.attachments a on a.id = l.photo_id;

grant select on ops_hr.v_located_tap to authenticated;
