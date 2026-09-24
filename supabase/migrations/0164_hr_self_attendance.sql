-- 0164_hr_self_attendance.sql — a tap from the person's own phone, not the
-- machine at the door.
--
-- ── why this is a new source, not a new function on top of `add_scan` ─────
--
-- `manual` already means "a tap the machine missed" — HRD typing a time in
-- because somebody's finger did not register, and `manual_says_why` requires
-- a reason for exactly that: a time nobody's own device produced needs a
-- sentence explaining where it came from. A self-tap is not that. It is
-- evidence with a different machine behind it (D141's own distinction,
-- carried one door further) — the person's own signed-in session, at the
-- moment they pressed the button — and it needs no reason any more than the
-- fingerprint reader's own taps do. Collapsing it into `manual` would either
-- force a reason nobody has, or quietly exempt self-taps from `manual`'s
-- guard by loosening the constraint for everybody.
--
-- ── what this deliberately does not do ────────────────────────────────────
--
-- It does not decide *masuk* or *pulang*. Nothing does, at write time — D141
-- is unchanged: a tap is a tap, and the six slots are a **reading**, computed
-- on read from however many taps a day has. A self-tap button that labelled
-- itself "Clock in" would be asserting a fact the system does not actually
-- have until `read_day` looks at the whole day, so the client decides what to
-- call the button by reading today's shape first — the same thing a person
-- glancing at the machine's light does.
--
-- ── why the read side needs three new policies and not a new function ─────
--
-- `read_day`, `timesheet`, `kpi_measures` and `leave_balances` are all
-- `security invoker` (never `definer`) and already resolve to "just me" the
-- moment `ops_hr.employees` only shows the caller their own row — `0152`
-- built that. They touch `attendance_scans` and `day_marks` too, and those
-- two tables have never had a self policy, so the same functions that already
-- work for HRD would silently return nothing for a self caller — not refused,
-- just empty, which is worse because it looks like an honest zero. Composing
-- RLS is what makes the derivation the same derivation for both readers,
-- rather than a second implementation with its own chance to disagree (A3).

alter type ops_hr.scan_source_t add value 'self';

alter table ops_hr.attendance_scans
  add constraint self_is_the_caller check (source <> 'self' or recorded_by is not null);

/* Own taps, own marks — the same shape as `tasks_read_own`/`employees_read_own`
   in `0152`: the account-to-employee link and nothing else. An employee with
   no account (most of the production floor) matches nothing, which is
   correct — there is no "own" to read. `day_marks` also lets a self caller
   see an office-wide holiday, because that row explains their own timesheet
   too and `employee_id is null` is never mistaken for somebody else's row. */
create policy scans_read_own on ops_hr.attendance_scans for select to authenticated
  using (employee_id = ops_hr.my_employee_id());

create policy marks_read_own on ops_hr.day_marks for select to authenticated
  using (employee_id = ops_hr.my_employee_id() or employee_id is null);

/* The self-tap itself. Deliberately the smallest possible seam, the same size
   as `acknowledge_task`: it can insert exactly one row, for exactly the
   caller, with no field the caller controls beyond the moment they pressed
   the button. `p_key` guards a flaky retry double-submitting the same tap —
   it does not, and should not, stop two real taps a minute apart, which is
   an ordinary and correctly recorded shape of day (D141). */
create or replace function ops_hr.tap_self(p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare
  v_replayed jsonb; v_emp uuid; v_id uuid; v_at timestamptz := now(); v_res jsonb;
begin
  v_replayed := ops_core.idem_replay('hr','tap_self', p_key);
  if v_replayed is not null then return v_replayed; end if;

  v_emp := ops_hr.my_employee_id();
  if v_emp is null then
    return ops_core.refused('hr','attendance', null,'tap_self',
      'no_employee_link',
      'Akun ini belum tertaut ke data karyawan, jadi presensi tidak bisa dicatat sendiri. Minta HRD menautkannya.');
  end if;

  insert into ops_hr.attendance_scans
    (employee_id, work_date, at, verify, source, recorded_by)
  values (v_emp, ops_core.office_day(v_at), v_at, 'app', 'self', auth.uid())
  returning id into v_id;

  perform ops_core.record_activity_event('attendance_tap','attendance',
    format('Tap presensi pukul %s', to_char(v_at, 'HH24:MI')));

  v_res := ops_core.ok('hr','attendance', v_id::text,'tap_self',
    jsonb_build_object('id', v_id, 'at', v_at, 'work_date', ops_core.office_day(v_at)));
  return ops_core.idem_remember('hr','tap_self', p_key, v_res);
end $$;

revoke execute on function ops_hr.tap_self(text) from public;
grant execute on function ops_hr.tap_self(text) to authenticated;
