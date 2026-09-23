-- 0059_hr_pay_rules.sql — the rule book, writable from the screen that owns it.
--
-- `/it/aturan-gaji` is 694 lines of screen against three client functions that
-- were never written, so it has been dark since it was built. Turning it on is
-- what lets the business change its own pay scheme without a migration — which
-- matters more than it sounds, because the owner expects a new scheme this
-- month and waiting for a release to publish it is not a plan.
--
-- Three things had to be settled first, and two of them are contradictions
-- between what the ladder enforces and what a decision already recorded.
--
-- ## A correction shares the date of the version it corrects (D270)
--
-- D270 is explicit: *the new version is dated to the day v3 began, not to
-- today*, because the workshop always started at 07.30 and dating the fix from
-- today *would have the system assert something false about September*. It
-- names the tie that makes it work — `rules_on` orders by `effective_from
-- desc, version desc` — and the demo's own fixture carries v3 and v4 sharing
-- 2026-09-01.
--
-- The table refused all of it. `effective_from` was **unique**, so the second
-- version could never be written; the trigger refused any date before today;
-- and the demo seam refused `effective_from <= latest`. Three guards against
-- one recorded decision, and the tie-break in `rules_on` was a branch that
-- could not fire.
--
-- **What actually makes back-dating safe is not the calendar.** D270 says so
-- itself: *what makes the backdating safe is `late_mode: "manual"` — not one
-- rupiah has ever been computed from this rule*. That is the test, and it is
-- checkable: a version may land on or before today only while **no run that
-- has left DRAFT covers any day from that date onward**. Approved is somebody's
-- signature and PAID is money that moved; rewriting the book under either is
-- the one thing a pay system must not do quietly. A DRAFT run has paid nobody.
--
-- The mid-period rule from `0047` stays exactly as it was, and for its own
-- reason: payroll picks the book in force when a period **opened**, so a
-- version dated inside any run's period would look applied and change nothing
-- — the worst of the three possible behaviours.
--
-- ## Preview cannot read anything, and must read everything
--
-- The screen will not let anybody save without previewing first — *Save blind*
-- is the failure it was built against — and a preview is the whole payroll
-- computed twice, under the book in force and under a book **that has not been
-- saved**. `payroll_line_for` calls `rules_on(p_from)` inside itself, so there
-- was no way to hand it a candidate.
--
-- The cheap answer would be a fourth copy of that two-hundred-line body taking
-- an extra argument. F126's rule says what a field costs is how much code must
-- be re-emitted to carry it, and the answer here is: restate `rules_on`, which
-- is nine lines, and let it consult a **transaction-local** setting that only
-- `preview_pay_rules` ever sets. Action at a distance, named in one place and
-- reachable from one caller, against two hundred lines copied a fourth time.
--
-- And the reader is IT, who holds none of HR's permissions: `period_lines`
-- walks every employee's timesheet under RLS, and an IT user would preview an
-- empty company. So the preview is `security definer` and asks for `it.update`
-- itself — the same shape `employee_documents_of` uses in `0056`.
--
-- ## IT could not read the book it owns
--
-- `payrules_read` in `0043` admits `hrd.read` or `payroll.read`. The screen
-- that writes the rules is reached with `it.update` (`src/lib/nav.ts`), so the
-- one role D173 puts in charge of the rule book could not list it. Added
-- rather than replaced: a policy is an OR of the ones that exist.

/* ── the correction D270 asked for ────────────────────────────────────── */
alter table ops_hr.pay_rule_sets drop constraint pay_rule_sets_effective_from_key;

-- **`security definer`, and that is a fix rather than a flourish.** This
-- function reads `ops_hr.payroll_runs` to decide, and as a plain trigger it read
-- it **under the caller's RLS** — so for the one role allowed to write a rule
-- book, IT, which holds no `payroll.read`, the guard saw zero runs and waved
-- everything through. The seam above never noticed because it is a definer
-- itself; it is the direct write to the table, which `0043` grants to
-- `it.update`, that went unguarded. `0047`'s mid-period check has been blind
-- the same way since it was written. A guard that cannot see what it guards
-- against is not a guard (F135).
create or replace function ops_hr.pay_rules_not_backdated()
returns trigger
language plpgsql security definer set search_path = ops_hr, pg_temp as $$
declare clash text; spent text;
begin
  /* Money already computed under the book this would displace. Not the
     calendar: a date in the past is only dangerous once somebody has been paid
     against it, and that is exactly what D270 reasoned about. */
  select run_no into spent
    from ops_hr.payroll_runs
   where status <> 'DRAFT' and period_end >= new.effective_from
   order by period_start
   limit 1;
  if spent is not null then
    raise exception
      'run % has already been signed for a period ending %; a rule version cannot reach back past money that has been paid',
      spent, new.effective_from
      using errcode = 'check_violation';
  end if;

  /* Unchanged from 0047, and for its own reason: the payroll picks the book in
     force when the period opened, so a version dated inside a period would
     look applied and do nothing. */
  select run_no into clash
    from ops_hr.payroll_runs
   where new.effective_from > period_start
     and new.effective_from <= period_end
   limit 1;
  if clash is not null then
    raise exception 'run % already covers %; a rule version lands between periods, never inside one', clash, new.effective_from
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

/* ── the book in force, or the one being tried on ─────────────────────── */
--
-- The `order by effective_from desc, version desc` is now load-bearing rather
-- than defensive: two versions may share a date, and the later one is the
-- correction (D270).
create or replace function ops_hr.rules_on(p_date date)
returns jsonb
language sql stable set search_path = ops_hr, pg_temp as $$
  select coalesce(
    -- A candidate somebody is previewing, set for this transaction only by
    -- `preview_pay_rules` and by nothing else. `true` on current_setting is
    -- *missing_ok*: unset is the ordinary case, not an error.
    nullif(current_setting('ops_hr.preview_rules', true), '')::jsonb,
    (select rules from ops_hr.pay_rule_sets
      where effective_from <= p_date
      order by effective_from desc, version desc limit 1),
    (select rules from ops_hr.pay_rule_sets
      order by effective_from asc, version asc limit 1)
  )
$$;

/* ── the book, as the screen lists it ─────────────────────────────────── */
create or replace view ops_hr.v_pay_rule_set as
select
  r.id, r.version, r.effective_from, r.note, r.rules, r.created_by, r.created_at,
  coalesce(u.full_name, u.email, '—') as created_by_name,
  -- The version a run opened today would use. Derived, because *which one is
  -- in force* changes with the calendar and a stored flag would be wrong the
  -- morning after (A3).
  r.id = (select r2.id from ops_hr.pay_rule_sets r2
           where r2.effective_from <= ops_core.office_day()
           order by r2.effective_from desc, r2.version desc limit 1) as is_current
from ops_hr.pay_rule_sets r
left join ops_core.users u on u.id = r.created_by;

alter view ops_hr.v_pay_rule_set set (security_invoker = on);

-- D173 puts IT in charge of the book; `0043`'s read policy did not let them see
-- it. Added beside the existing one rather than replacing it.
create policy payrules_read_it on ops_hr.pay_rule_sets for select to authenticated
  using (ops_core.has_permission('it.read') or ops_core.has_permission('it.update'));

-- `+25.000` / `-4.500`, the same shape the screen has always printed. Its own
-- function because five call sites above would otherwise carry five copies of
-- a format string.
create or replace function ops_hr.signed_delta(p_before numeric, p_after numeric)
returns text language sql immutable as $$
  select case when coalesce(p_after,0) - coalesce(p_before,0) > 0 then '+' else '' end
      || replace(to_char(coalesce(p_after,0) - coalesce(p_before,0), 'FM999G999G999G990'), ',', '.')
$$;

/* ── what a candidate book would do to a real period ──────────────────── */
create or replace function ops_hr.preview_pay_rules(
  p_rules jsonb, p_from date, p_to date)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare
  before_row  ops_hr.payroll_figures;
  after_row   ops_hr.payroll_figures;
  emp         record;
  v_lines       jsonb := '[]'::jsonb;
  n_before    bigint := 0;
  n_after     bigint := 0;
  v_notes       text[];
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
      'lines', v_lines));
end $$;


/* ── publishing a version ─────────────────────────────────────────────── */
--
-- HRD knows the numbers and IT writes them (D173): a pay rule is the one piece
-- of configuration that reaches every payslip at once, and the people whose pay
-- it computes should not be the people who can change it on their own.
create or replace function ops_hr.save_pay_rules(
  p_effective_from date,
  p_note           text,
  p_rules          jsonb,
  p_key            text default null)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare
  v_replayed jsonb; v_version int; v_id uuid; v_spent text; v_clash text; v_res jsonb;
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

grant select on ops_hr.v_pay_rule_set to authenticated;
grant execute on function
  ops_hr.signed_delta(numeric, numeric),
  ops_hr.preview_pay_rules(jsonb, date, date),
  ops_hr.save_pay_rules(date, text, jsonb, text)
  to authenticated;
