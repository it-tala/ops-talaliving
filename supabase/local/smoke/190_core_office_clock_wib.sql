-- 190_core_office_clock_wib.sql — the office clock is WIB, and the machine's
-- taps keep the time the machine printed (0190, D334, F191).
--
--   derivation — `office_day` and `wita_minutes` read Asia/Jakarta; the
--                `tap_self` label reads WIB; no `ops_*` function or view names
--                Asia/Makassar or a `+08` literal any more
--   derivation — the data step, run on rows shaped like production's: an
--                imported tap and an HRD tap written as 07:25 `+08` read 07:25
--                WIB afterwards, on the same day; a self tap keeps its instant
--                and is re-filed only when WIB puts it on another day; a self
--                tap inside an APPROVED run is counted, not hidden
--   guard      — running the file a second time moves nothing
--   one tap    — `tap_self` has one signature: `0190` leaves it to the
--                sweep rather than bring `tap_self(text)` back beside `0188`'s
--   refusal    — an account with no employee link is still refused by
--                `tap_self`; `tap_self`/`update_task` stay closed to PUBLIC
--
-- The session is pinned to UTC, as production is: under any other zone a
-- rendering bug can hide behind the session's own offset (F184).

begin;

set local timezone = 'UTC';

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-000000019001','tap190@talaliving.com','{"full_name":"Tap WIB"}'),
  ('ffffffff-0000-0000-0000-000000019002','none190@talaliving.com','{"full_name":"Tanpa tautan"}');

insert into ops_hr.employees
  (id, employee_no, full_name, position, unit, pay_basis, base_rate, allowance_rate,
   daily_hours, joined_on, user_id, paid_leave_days)
values
  ('aaaa1900-0000-0000-0000-000000000001','B-1901','Tap WIB','Tukang','Produksi',
   'daily', 180000, 25000, 8, '2025-01-01','ffffffff-0000-0000-0000-000000019001', 12);

-- ── the zone, stated once ─────────────────────────────────────────────────
do $$
declare left_over text;
begin
  assert ops_core.office_tz() = 'Asia/Jakarta', 'office_tz is ' || ops_core.office_tz();

  -- 16:30 UTC is 23:30 WIB (still the 29th) and 00:30 WITA (already the 30th).
  assert ops_core.office_day('2026-09-29 16:30:00+00') = '2026-09-29',
    'office_day still reads WITA: ' || ops_core.office_day('2026-09-29 16:30:00+00');
  -- 17:30 UTC is 00:30 WIB on the 30th.
  assert ops_core.office_day('2026-09-29 17:30:00+00') = '2026-09-30', 'the WIB day turns at 17:00 UTC';
  -- 07:25 WIB is 00:25 UTC.
  assert ops_hr.wita_minutes('2026-09-29 00:25:00+00') = 7*60 + 25,
    'minutes of day: ' || ops_hr.wita_minutes('2026-09-29 00:25:00+00');

  select string_agg(n.nspname || '.' || p.proname, ', ') into left_over
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname like 'ops\_%'
     and (p.prosrc like '%Asia/Makassar%' or p.prosrc ~ '\+08(:00)?''');
  assert left_over is null, 'still on WITA: ' || left_over;

  select string_agg(schemaname || '.' || viewname, ', ') into left_over
    from pg_views where schemaname like 'ops\_%' and definition like '%Asia/Makassar%';
  assert left_over is null, 'a view still on WITA: ' || left_over;
end $$;

-- ── the data step, on rows shaped like production's ───────────────────────
--
-- Written the way the old importer and the old manual form wrote them: the
-- machine's wall clock with `+08` glued on. The self tap is a real instant.
insert into ops_hr.attendance_imports (id, filename, rows_seen, rows_added, imported_by) values
  ('19000000-0000-0000-0000-000000000001','mesin-190.xlsx', 1, 1,'ffffffff-0000-0000-0000-000000019001');

insert into ops_hr.attendance_scans (id, employee_id, work_date, at, verify, source, import_id, reason, recorded_by) values
  -- the machine printed 07:25 on the 28th
  ('19000000-0000-0000-0000-00000000000a','aaaa1900-0000-0000-0000-000000000001','2026-09-28',
   '2026-09-28 07:25:00+08','FP','import','19000000-0000-0000-0000-000000000001', null, null),
  -- exactly an hour later: the pair that would collide half-way through a
  -- row-by-row update if `scan_once` stayed in place
  ('19000000-0000-0000-0000-00000000000b','aaaa1900-0000-0000-0000-000000000001','2026-09-28',
   '2026-09-28 08:25:00+08','FP','import','19000000-0000-0000-0000-000000000001', null, null),
  -- HRD typed 16:40 off a note
  ('19000000-0000-0000-0000-00000000000c','aaaa1900-0000-0000-0000-000000000001','2026-09-28',
   '2026-09-28 16:40:00+08','MANUAL','manual', null,'jari tidak terbaca','ffffffff-0000-0000-0000-000000019001'),
  -- a phone tap at 16:30 UTC on the 26th: 00:30 WITA on the 27th, filed there;
  -- 23:30 WIB on the 26th, which is where it belongs
  ('19000000-0000-0000-0000-00000000000d','aaaa1900-0000-0000-0000-000000000001','2026-09-27',
   '2026-09-26 16:30:00+00','app','self', null, null,'ffffffff-0000-0000-0000-000000019001');

-- An approved run over the self tap's day: its reading of that tap moves, and
-- the migration has to say so.
insert into ops_hr.payroll_runs (run_no, period_start, period_end, status, approved_by, approved_at)
values ('pyr-190', '2026-09-21', '2026-09-27', 'APPROVED', 'ffffffff-0000-0000-0000-000000019001', now());

-- Production has not had the marker yet; the ladder already wrote it.
delete from ops_core.settings where key = 'office_tz';

\ir ../../migrations/0190_core_office_clock_wib.sql

do $$
declare s record; v jsonb;
begin
  select * into s from ops_hr.attendance_scans where id = '19000000-0000-0000-0000-00000000000a';
  assert to_char(s.at at time zone 'Asia/Jakarta', 'YYYY-MM-DD HH24:MI') = '2026-09-28 07:25',
    'the machine''s 07:25 must still read 07:25, now WIB; got ' || to_char(s.at at time zone 'Asia/Jakarta', 'YYYY-MM-DD HH24:MI');
  assert s.at = '2026-09-28 00:25:00+00', 'stored instant ' || s.at;
  assert s.work_date = '2026-09-28', 'same day, got ' || s.work_date;

  select * into s from ops_hr.attendance_scans where id = '19000000-0000-0000-0000-00000000000b';
  assert to_char(s.at at time zone 'Asia/Jakarta', 'HH24:MI') = '08:25', 'the second tap reads 08:25';

  select * into s from ops_hr.attendance_scans where id = '19000000-0000-0000-0000-00000000000c';
  assert to_char(s.at at time zone 'Asia/Jakarta', 'HH24:MI') = '16:40',
    'HRD''s 16:40 must still read 16:40; got ' || to_char(s.at at time zone 'Asia/Jakarta', 'HH24:MI');

  select * into s from ops_hr.attendance_scans where id = '19000000-0000-0000-0000-00000000000d';
  assert s.at = '2026-09-26 16:30:00+00', 'a self tap is a real instant and is not shifted; got ' || s.at;
  assert s.work_date = '2026-09-26', 'and WIB files it under the 26th; got ' || s.work_date;

  select value into v from ops_core.settings where key = 'office_tz';
  assert v ->> 'zone' = 'Asia/Jakarta', 'marker ' || coalesce(v::text, '(none)');
  assert (v ->> 'shifted_scans')::int >= 3, 'marker counts the shifted taps: ' || v::text;
  assert (v ->> 'self_taps_in_closed_runs')::int = 1, 'the self tap inside pyr-190 is counted: ' || v::text;
end $$;

-- ── guard: the second run moves nothing ───────────────────────────────────
\ir ../../migrations/0190_core_office_clock_wib.sql

do $$
begin
  assert (select at from ops_hr.attendance_scans where id = '19000000-0000-0000-0000-00000000000a')
         = '2026-09-28 00:25:00+00', 'a second run moved the machine tap again';
  assert (select at from ops_hr.attendance_scans where id = '19000000-0000-0000-0000-00000000000c')
         = '2026-09-28 09:40:00+00', 'a second run moved the HRD tap again';
end $$;

-- ── the self tap's label reads WIB ────────────────────────────────────────
create temp table t190 (res jsonb) on commit drop;
grant all on t190 to authenticated;

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000019001';
do $$
declare a jsonb;
begin
  a := ops_hr.tap_self();
  assert a ->> 'outcome' = 'ok', a::text;
  insert into t190 values (a);
end $$;

-- refusal: no employee link, no tap
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000019002';
do $$
declare a jsonb;
begin
  a := ops_hr.tap_self();
  assert a -> 'error' ->> 'code' = 'no_employee_link', a::text;
end $$;
reset role;

do $$
declare v_at timestamptz; v_label text; v_wib text; v_wita text;
begin
  select (res -> 'data' ->> 'at')::timestamptz into v_at from t190;
  select label into v_label from ops_core.activity_events
   where actor_id = 'ffffffff-0000-0000-0000-000000019001' and kind = 'attendance_tap';
  v_wib  := to_char(v_at at time zone 'Asia/Jakarta', 'HH24:MI');
  v_wita := to_char(v_at at time zone 'Asia/Makassar', 'HH24:MI');
  assert v_label = 'Tap presensi pukul ' || v_wib, format('label should read WIB %s, got %s', v_wib, v_label);
  assert v_label <> 'Tap presensi pukul ' || v_wita, 'label still reads WITA';
  assert (select work_date from ops_hr.attendance_scans
           where employee_id = 'aaaa1900-0000-0000-0000-000000000001' and at = v_at)
         = (v_at at time zone 'Asia/Jakarta')::date, 'the tap is filed under the WIB day';

  -- One tap_self: 0188 dropped tap_self(text), and nothing here may bring it
  -- back as an overload PostgREST cannot choose between.
  assert (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'ops_hr' and p.proname = 'tap_self') = 1, 'tap_self has an overload';
  assert not has_function_privilege('public','ops_hr.tap_self(double precision,double precision,double precision,text,uuid,text,text)','execute'),
    'tap_self() opened to PUBLIC';
  assert has_function_privilege('authenticated','ops_hr.tap_self(double precision,double precision,double precision,text,uuid,text,text)','execute'),
    'authenticated cannot tap';
  assert not has_function_privilege('public','ops_hr.update_task(text,text,text,text,date)','execute'),
    'update_task() opened to PUBLIC';
  assert has_function_privilege('authenticated','ops_hr.update_task(text,text,text,text,date)','execute'),
    'authenticated cannot update a task';
end $$;

rollback;
