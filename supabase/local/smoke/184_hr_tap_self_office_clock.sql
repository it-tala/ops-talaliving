-- 184_hr_tap_self_office_clock.sql — a self-tap's activity label is the office
-- clock (0184, D327; WIB since 0190, D334).
--
--   derivation — the label `tap_self` writes is the tap's own moment on the
--                office clock (Asia/Jakarta since D334), whatever the session's time
--                zone is; with the session on UTC (Supabase's default) it is
--                seven hours away from the UTC rendering `0164` wrote
--   refusal    — an account with no employee link is still refused, and
--                writes no label; the grants are unchanged
--
-- The session is pinned to UTC on purpose: that is what production runs,
-- and it is the only setting under which the old label was wrong.

begin;

set local timezone = 'UTC';

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-000000018401','tap184@talaliving.com','{"full_name":"Tap"}'),
  ('ffffffff-0000-0000-0000-000000018402','none184@talaliving.com','{"full_name":"Tanpa tautan"}');

insert into ops_hr.employees
  (id, employee_no, full_name, position, unit, pay_basis, base_rate, allowance_rate,
   daily_hours, joined_on, user_id, paid_leave_days)
values
  ('aaaa1840-0000-0000-0000-000000000001','B-1841','Tap','Tukang','Produksi',
   'daily', 180000, 25000, 8, '2025-01-01','ffffffff-0000-0000-0000-000000018401', 12);

create temp table t184 (res jsonb) on commit drop;
grant all on t184 to authenticated;

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000018401';

do $$
declare a jsonb;
begin
  a := ops_hr.tap_self();
  assert a ->> 'outcome' = 'ok', a::text;
  insert into t184 values (a);
end $$;

set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000018402';
do $$
declare a jsonb;
begin
  a := ops_hr.tap_self();
  assert a -> 'error' ->> 'code' = 'no_employee_link', a::text;
end $$;

reset role;

-- ── derivation: the label is the office clock ─────────────────────────────
do $$
declare v_at timestamptz; v_label text; v_office text; v_utc text; v_n int;
begin
  select (res -> 'data' ->> 'at')::timestamptz into v_at from t184;
  assert v_at is not null, 'tap_self returned no `at`';

  select label into v_label from ops_core.activity_events
   where actor_id = 'ffffffff-0000-0000-0000-000000018401' and kind = 'attendance_tap';

  v_office := to_char(v_at at time zone 'Asia/Jakarta', 'HH24:MI');
  v_utc  := to_char(v_at, 'HH24:MI');   -- what 0164 wrote, on a UTC session

  assert v_label = 'Tap presensi pukul ' || v_office,
    format('label should read the WIB clock %s, got %s', v_office, v_label);
  assert v_office <> v_utc, 'WIB and UTC render the same — the session is not on UTC';
  assert v_label <> 'Tap presensi pukul ' || v_utc, 'label still reads the UTC clock';

  -- The work day is the office day too (unchanged from 0164, pinned here so
  -- D332's rewrite keeps it).
  assert (select work_date from ops_hr.attendance_scans
           where employee_id = 'aaaa1840-0000-0000-0000-000000000001')
         = (v_at at time zone 'Asia/Jakarta')::date,
    'the tap was filed under a day that is not the office day';

  -- The refused account wrote no label.
  select count(*) into v_n from ops_core.activity_events
   where actor_id = 'ffffffff-0000-0000-0000-000000018402' and kind = 'attendance_tap';
  assert v_n = 0, 'a refused tap still wrote an activity label';
end $$;

-- ── grants are the same as 0164 ───────────────────────────────────────────
do $$
begin
  assert not has_function_privilege('public','ops_hr.tap_self(double precision,double precision,double precision,text,uuid,text,text,jsonb)','execute'),
    'tap_self() opened to PUBLIC';
  assert has_function_privilege('authenticated','ops_hr.tap_self(double precision,double precision,double precision,text,uuid,text,text,jsonb)','execute'),
    'authenticated cannot call tap_self()';
  assert not has_function_privilege('anon','ops_hr.tap_self(double precision,double precision,double precision,text,uuid,text,text,jsonb)','execute'),
    'anon can call tap_self()';
end $$;

rollback;
