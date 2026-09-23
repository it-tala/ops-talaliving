-- 0117 — working patterns become something a person types, so the database
--        has to start refusing what a person can type.
--
-- Until now `rules.schedules` was seeded by a migration and shown read-only on
-- `/it/aturan-gaji`. Nothing checked it because nothing could write it except
-- somebody already writing SQL. Making the rows editable moves that: a code
-- becomes typing, and a code is a **key**.
--
-- ── the key with no foreign key ───────────────────────────────────────────
--
-- `ops_hr.employees.schedule_code` points at a pattern by text, and so does
-- `rules.schedule_by_unit`. Neither can be a foreign key, because the thing
-- they point into is a **jsonb document versioned by date** (D173) — there is
-- no table to reference and there must not be one, since last March's book has
-- to keep saying what it said. ADR-004's rule (codes across seams, never
-- uuids) reached here without ADR-004's safety net.
--
-- So the integrity is a check at the seam, and the one that matters most
-- cannot live in the pure function: **a pattern people are on may not
-- disappear.** Delete `PRODUKSI` while three people carry it and they do not
-- fall back to anything — `schedule_of()` finds no row, `break_allowance()`
-- goes null, and `schedule_roll()` stops listing them altogether, because
-- their `schedule_code` is neither null (so they are not *unlinked*) nor
-- matched (so they are in no pattern's count). Three people vanish from the
-- screen whose whole job is to show that nobody is missing. That is D279's
-- argument arriving through a door D279 did not lock.
--
-- ── two statements of one rule, and how they are held level ───────────────
--
-- The shape rules are stated here and in `src/services/hr/schedule-rules.ts`,
-- because the demo client has to refuse identically (ADR-009). Two statements
-- of one rule is exactly the drift `check-clause-fields.mjs` was built for, so
-- this pair gets the same treatment: `check-schedule-rules.mjs` runs the
-- shared `SCHEDULE_CASES` battery through both and refuses any disagreement,
-- on the code **and** on the sentence — a demo that says something different
-- about the same form is two systems disagreeing about the form.
--
-- The messages are therefore transcriptions, not paraphrases. Change one and
-- both change, or the checker says so.
--
-- ── why the trigger as well as the envelope ───────────────────────────────
--
-- `save_pay_rules` answers with a sentence, which is what a person needs. The
-- trigger answers with an exception, which is what a *migration* needs — and
-- migrations are how every rule book in production got there so far, including
-- the four written today. A guard that only exists on the road the screen
-- takes is not guarding the road the data actually arrived by (ADR-002).

/* ── three helpers, so the rule reads as the rule ─────────────────────── */
--
-- Minutes from midnight as a clock face. Only ever called with a value the
-- range check has already accepted, so it has no opinion about null.
create or replace function ops_hr.clock_face(p_minutes int)
returns text
language sql immutable set search_path = pg_temp as $$
  select lpad((p_minutes / 60)::text, 2, '0') || '.' || lpad((p_minutes % 60)::text, 2, '0')
$$;

-- A stated number, or null. An absent key and a JSON null are the same answer
-- here — *nobody has said* — and neither is a zero (D274).
create or replace function ops_hr.minutes_of(p_value jsonb)
returns int
language sql immutable set search_path = pg_temp as $$
  select case when p_value is null or jsonb_typeof(p_value) <> 'number'
              then null else (p_value)::numeric::int end
$$;

-- Null is an answer, so only a stated value is checked. Anything that is not a
-- whole number of minutes inside one day is refused — including a fraction,
-- which would otherwise round somewhere downstream and read as a clock nobody
-- typed.
create or replace function ops_hr.bad_minutes(p_value jsonb)
returns boolean
language sql immutable set search_path = pg_temp as $$
  select case
    when p_value is null or jsonb_typeof(p_value) = 'null' then false
    when jsonb_typeof(p_value) <> 'number' then true
    else (p_value)::numeric <> trunc((p_value)::numeric)
         or (p_value)::numeric < 0 or (p_value)::numeric > 1440
  end
$$;

/* ── what a candidate set of patterns may say ─────────────────────────── */
--
-- Returns the **first** problem as `{code, message}`, or null. First rather
-- than all, and in a fixed order — row by row, then the unit map — because the
-- demo returns the first too, and two systems that report different first
-- problems for the same form disagree about the form (ADR-009).
--
-- Within a row the order runs from *is it identifiable* to *does its
-- arithmetic work*: naming the row is useless if the row's name is the broken
-- part, and comparing two clocks is useless if one of them is 1441.
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
  u record;
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

    if st is not null and en is not null and en <= st then
      return jsonb_build_object('code','end_before_start',
        'message', v_where || ': pulang ' || ops_hr.clock_face(en)
                || ' tidak sesudah masuk ' || ops_hr.clock_face(st) || '.');
    end if;

    -- A break that eats the whole day leaves nought hours, and nought hours is
    -- not a schedule — it is a row that quietly values every day at zero for
    -- whoever is on it.
    if st is not null and en is not null and br is not null and en > st and br >= en - st then
      return jsonb_build_object('code','break_too_long',
        'message', v_where || ': istirahat ' || br || ' menit menghabiskan seluruh hari kerja '
                || ops_hr.clock_face(st) || '–' || ops_hr.clock_face(en) || '.');
    end if;

    if st is not null and fen is not null and fen <= st then
      return jsonb_build_object('code','friday_end_before_start',
        'message', v_where || ': pulang Jumat ' || ops_hr.clock_face(fen)
                || ' tidak sesudah masuk ' || ops_hr.clock_face(st) || '.');
    end if;

    -- Friday's two halves fall back independently (D289), so its arithmetic is
    -- checked on the pair it will actually be computed from — an ordinary
    -- break can be too long for a Friday that finishes early.
    f_end   := coalesce(fen, en);
    f_break := coalesce(fbr, br);
    if st is not null and f_end is not null and f_break is not null
       and f_end > st and f_break >= f_end - st then
      return jsonb_build_object('code','friday_break_too_long',
        'message', v_where || ': istirahat Jumat ' || f_break || ' menit menghabiskan seluruh hari Jumat '
                || ops_hr.clock_face(st) || '–' || ops_hr.clock_face(f_end) || '.');
    end if;
  end loop;

  /* A unit pointing at a pattern that is not there is worse than a unit
     pointing at nothing: nothing falls back to the company clock and says so,
     while a dangling code resolves to no schedule at all and reads as
     *belum ditetapkan* for everybody in that unit, with no sign of why. */
  /* `collate "C"` is load-bearing, not tidiness. The demo reports the first
     problem too, and it sorts with JavaScript's code-unit order; this database
     collates `en_US.UTF-8`, which puts `office` before `Workshop` where
     JavaScript puts `Workshop` first. With two dangling units the two seams
     would name different ones — and no test would ever have said so, because
     the scratch cluster and the CI container both happen to collate like `C`.
     A parity gate whose environments agree with one side is blind to exactly
     this (F143). */
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

/* ── who would lose their pattern ─────────────────────────────────────── */
--
-- The rule the pure function cannot hold, because it has to read the roster.
-- `security definer`: IT publishes the rule book and IT has no `hrd.read`, so
-- under the caller's RLS this would count zero employees and wave everything
-- through — F135's exact failure, and the reason that finding is worth having
-- been written down.
create or replace function ops_hr.schedules_in_use_lost(p_rules jsonb)
returns text
language sql stable security definer set search_path = ops_hr, pg_temp as $$
  with kept as (
    select s.value ->> 'code' as code
      from jsonb_array_elements(coalesce(p_rules -> 'schedules', '[]'::jsonb)) s
  ),
  lost as (
    select e.schedule_code, count(*) as n,
           -- Same reason as `schedule_problem`'s unit loop: the demo builds
           -- this sentence with a code-unit sort, so the order is pinned to
           -- one that does not move with the database's locale (F143).
           string_agg(e.full_name, ', ' order by e.employee_no collate "C") as names
      from ops_hr.employees e
     where e.active
       and e.schedule_code is not null
       and e.schedule_code not in (select code from kept where code is not null)
     group by e.schedule_code
  )
  select string_agg(
           format('%s (%s orang: %s)', l.schedule_code, l.n, l.names),
           '; ' order by l.schedule_code collate "C")
    from lost l
$$;

/* ── the two seams, restated with the check ───────────────────────────── */
--
-- Restated rather than wrapped: `00_no_overloads` means a second signature is
-- not available, and a wrapper under a new name would leave the old one
-- reachable and unguarded.
create or replace function ops_hr.preview_pay_rules(
  p_rules jsonb, p_from date, p_to date)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare
  before_row  ops_hr.payroll_figures;
  after_row   ops_hr.payroll_figures;
  emp         record;
  v_lines     jsonb := '[]'::jsonb;
  n_before    bigint := 0;
  n_after     bigint := 0;
  v_notes     text[];
  v_problem   jsonb;
begin
  if not ops_core.has_permission('it.update') then
    return ops_core.refused('hr','pay_rules', null,'preview',
      'not_permitted','Mencoba aturan gaji butuh akses IT.');
  end if;
  if p_rules is null or jsonb_typeof(p_rules) <> 'object' then
    return ops_core.invalid('hr','pay_rules', null,'preview',
      'rules_required','Tidak ada aturan yang dicoba.', jsonb_build_object('field','rules'));
  end if;
  if p_to < p_from then
    return ops_core.invalid('hr','pay_rules', null,'preview',
      'period_invalid','Periodenya berakhir sebelum dimulai.',
      jsonb_build_object('field','period_end'));
  end if;

  /* Checked before anything is computed, because a broken pattern does not
     produce a wrong preview — it produces a preview that silently leaves
     people out, which is the worst kind to show somebody about to press save. */
  v_problem := ops_hr.schedule_problem(p_rules);
  if v_problem is not null then
    return ops_core.invalid('hr','pay_rules', null,'preview',
      v_problem ->> 'code', v_problem ->> 'message',
      jsonb_build_object('field','schedules'));
  end if;

  for emp in
    select e.id, e.employee_no, e.full_name from ops_hr.employees e
     where e.active or e.left_on >= p_from
     order by e.employee_no
  loop
    -- The book in force, with no override set.
    perform set_config('ops_hr.preview_rules', '', true);
    before_row := ops_hr.payroll_line_for(emp.id, p_from, p_to);

    -- The same period again, under the candidate.
    perform set_config('ops_hr.preview_rules', p_rules::text, true);
    after_row := ops_hr.payroll_line_for(emp.id, p_from, p_to);
    perform set_config('ops_hr.preview_rules', '', true);

    n_before := n_before + coalesce(before_row.gross, 0);
    n_after  := n_after  + coalesce(after_row.gross, 0);

    /* Named one by one rather than rolled into a single delta: *your wage
       changed* is not a sentence anybody can check, and these five are exactly
       what people argue about. */
    v_notes := '{}';
    if after_row.overtime_pay is distinct from before_row.overtime_pay then
      v_notes := v_notes || ('lembur ' || ops_hr.signed_delta(before_row.overtime_pay, after_row.overtime_pay));
    end if;
    if after_row.undertime_amount is distinct from before_row.undertime_amount then
      v_notes := v_notes || ('undertime ' || ops_hr.signed_delta(-before_row.undertime_amount, -after_row.undertime_amount));
    end if;
    if after_row.allowance_pay is distinct from before_row.allowance_pay then
      v_notes := v_notes || ('tunjangan ' || ops_hr.signed_delta(before_row.allowance_pay, after_row.allowance_pay));
    end if;
    if after_row.late_deduction is distinct from before_row.late_deduction then
      v_notes := v_notes || ('potongan terlambat ' || ops_hr.signed_delta(-before_row.late_deduction, -after_row.late_deduction));
    end if;
    if after_row.hourly is distinct from before_row.hourly then
      v_notes := v_notes || ('upah/jam ' || ops_hr.signed_delta(before_row.hourly, after_row.hourly));
    end if;

    /* Only the people it moves. The totals above count everybody, because
       *what does this cost the business* is a question about the payroll and
       not about the rows that happen to differ. */
    if before_row.gross is distinct from after_row.gross then
      v_lines := v_lines || jsonb_build_object(
        'employee_no', emp.employee_no, 'full_name', emp.full_name,
        'before', before_row.gross, 'after', after_row.gross,
        'note', coalesce(nullif(array_to_string(v_notes, ' · '), ''), 'tidak berubah'));
    end if;
  end loop;

  return ops_core.ok('hr','pay_rules', null,'preview',
    jsonb_build_object(
      'period', p_from::text || ' → ' || p_to::text,
      'before_total', n_before,
      'after_total', n_after,
      -- Said on the preview rather than only at save, because moving somebody
      -- off a pattern is work the screen should ask for before the version is
      -- written, not after it is refused.
      'schedules_lost', ops_hr.schedules_in_use_lost(p_rules),
      'lines', v_lines));
end $$;

create or replace function ops_hr.save_pay_rules(
  p_effective_from date,
  p_note           text,
  p_rules          jsonb,
  p_key            text default null)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare
  v_replayed jsonb; v_version int; v_id uuid; v_spent text; v_clash text; v_res jsonb;
  v_problem jsonb; v_lost text;
begin
  v_replayed := ops_core.idem_replay('hr','save_pay_rules', p_key);
  if v_replayed is not null then return v_replayed; end if;

  if not ops_core.has_permission('it.update') then
    return ops_core.refused('hr','pay_rules', null,'save',
      'not_permitted','Mengubah aturan gaji butuh akses IT. Angkanya dari HRD; tangannya IT (D173).');
  end if;
  if coalesce(btrim(coalesce(p_note,'')), '') = '' then
    return ops_core.invalid('hr','pay_rules', null,'save',
      'note_required',
      'Tulis alasannya. Aturan gaji yang berubah tanpa keterangan adalah aturan yang tidak bisa dijelaskan ke karyawan.',
      jsonb_build_object('field','note'));
  end if;
  if p_rules is null or jsonb_typeof(p_rules) <> 'object' then
    return ops_core.invalid('hr','pay_rules', null,'save',
      'rules_required','Tidak ada aturan yang disimpan.', jsonb_build_object('field','rules'));
  end if;

  v_problem := ops_hr.schedule_problem(p_rules);
  if v_problem is not null then
    return ops_core.invalid('hr','pay_rules', null,'save',
      v_problem ->> 'code', v_problem ->> 'message',
      jsonb_build_object('field','schedules'));
  end if;

  /* Nobody is dropped off a pattern by a version that simply forgets to carry
     it. Refused rather than warned (A6's exception: this reaches pay), and
     named with the people, because *move them first* is only actionable if you
     know who they are. */
  v_lost := ops_hr.schedules_in_use_lost(p_rules);
  if v_lost is not null then
    return ops_core.conflict('hr','pay_rules', null,'save',
      'schedule_in_use',
      format('Buku baru tidak memuat pola yang masih dipakai: %s. Orangnya tidak jatuh '
             'ke jadwal lain — mereka berhenti punya jam sama sekali dan hilang dari '
             'layar jadwal. Pindahkan dulu, lalu terbitkan versinya.', v_lost));
  end if;

  /* The two the trigger underneath also refuses, asked here so the answer is a
     sentence rather than an exception. Money first, because it is the one that
     surprises people: a date in the past is allowed, and only until somebody
     has been paid against it (D270). */
  select run_no into v_spent from ops_hr.payroll_runs
   where status <> 'DRAFT' and period_end >= p_effective_from
   order by period_start limit 1;
  if v_spent is not null then
    return ops_core.conflict('hr','pay_rules', null,'save',
      'already_paid',
      format('%s sudah ditandatangani untuk periode yang berakhir %s atau sesudahnya. '
             'Aturan tidak bisa mundur melewati uang yang sudah dibayarkan — '
             'terbitkan yang baru berlaku setelahnya.', v_spent, p_effective_from));
  end if;

  select run_no into v_clash from ops_hr.payroll_runs
   where p_effective_from > period_start and p_effective_from <= period_end
   limit 1;
  if v_clash is not null then
    return ops_core.conflict('hr','pay_rules', null,'save',
      'inside_existing_run',
      format('%s mencakup tanggal itu, dan periode itu dihitung dengan aturan yang berlaku '
             'saat dibuka. Pilih tanggal di luar periode yang sudah ada.', v_clash));
  end if;

  select coalesce(max(version), 0) + 1 into v_version from ops_hr.pay_rule_sets;

  insert into ops_hr.pay_rule_sets (version, effective_from, note, rules, created_by)
  values (v_version, p_effective_from, btrim(p_note), p_rules, auth.uid())
  returning id into v_id;

  v_res := ops_core.ok('hr','pay_rules', v_version::text,'save',
    jsonb_build_object('id', v_id, 'version', v_version,
                       'effective_from', p_effective_from,
                       -- A correction sits on the same date as what it corrects
                       -- (D270), so the screen can say which it is.
                       'corrects', (select r.version from ops_hr.pay_rule_sets r
                                     where r.effective_from = p_effective_from
                                       and r.version < v_version
                                     order by r.version desc limit 1)),
    null,
    jsonb_build_object('version', v_version, 'effective_from', p_effective_from));
  return ops_core.idem_remember('hr','save_pay_rules', p_key, v_res);
end $$;

/* ── and the same rule on the road migrations take ────────────────────── */
--
-- Every rule book in production so far arrived by migration, not by the
-- screen. A shape check that only runs inside `save_pay_rules` would have been
-- looking at the one road nobody used.
create or replace function ops_hr.pay_rules_schedules_valid()
returns trigger
language plpgsql set search_path = ops_hr, pg_temp as $$
declare v_problem jsonb;
begin
  v_problem := ops_hr.schedule_problem(new.rules);
  if v_problem is not null then
    raise exception 'jadwal kerja tidak sah: %', v_problem ->> 'message'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists pay_rules_schedules_valid on ops_hr.pay_rule_sets;
create trigger pay_rules_schedules_valid
  before insert or update on ops_hr.pay_rule_sets
  for each row execute function ops_hr.pay_rules_schedules_valid();

-- The shape rules are pure — no table, no roster, nothing to leak — so a
-- client may ask them directly.
grant execute on function
  ops_hr.clock_face(int),
  ops_hr.minutes_of(jsonb),
  ops_hr.bad_minutes(jsonb),
  ops_hr.schedule_problem(jsonb)
  to authenticated;

-- `schedules_in_use_lost` is **not** among them, and the revoke is the point:
-- Postgres grants EXECUTE to PUBLIC on a new function by default, so leaving
-- it alone is a grant. It is `security definer` and it answers with employee
-- **names**, which means anybody holding any account at all could have asked
-- it for the roster — a pattern list is not a secret, but *who is on it* is
-- (D196's reasoning, in a function rather than a column). It is reached only
-- from `save_pay_rules` and `preview_pay_rules`, which are definer themselves
-- and already decide who may ask.
revoke execute on function ops_hr.schedules_in_use_lost(jsonb) from public;
