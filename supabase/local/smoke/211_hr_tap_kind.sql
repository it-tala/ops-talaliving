-- 211_hr_tap_kind.sql — a tap from the phone says what it is (0211, D369).
--
-- DERIVATIONS  slot reading: a tap that says *mulai istirahat* at 10.30 is the
--              break going out, though the clock would never place it there;
--              keluar/kembali kantor are neither arrival, break nor pulang —
--              the day reads complete and says *Di luar kantor 14:00–15:10*,
--              and the time out is not deducted; a reader tap and a phone tap
--              a few seconds apart are one tap that keeps what the phone said,
--              but two phone taps saying different things a minute apart are
--              two;
--              a second *mulai istirahat* is left over (review); keluar with no
--              kembali is a note, not a problem;
--              in_out reading: pulang is the tap that says pulang, not the last
--              one, and the lembur shown is the pair the person tapped;
--              tap_self stores the kind, the label says it, v_located_tap
--              shows it, a replayed key writes nothing twice
-- REFUSALS     an unknown kind; keluar kantor without a note (invalid, carries
--              the verdict like an off-site tap, writes nothing); no overload
--              of tap_self remains

begin;

set local timezone = 'UTC';

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-000000021001','hrd210@talaliving.com','{"full_name":"HRD"}'),
  ('ffffffff-0000-0000-0000-000000021002','tap210@talaliving.com','{"full_name":"Karyawan tap"}'),
  ('ffffffff-0000-0000-0000-000000021003','brk210@talaliving.com','{"full_name":"Istirahat"}'),
  ('ffffffff-0000-0000-0000-000000021004','old210@talaliving.com','{"full_name":"Tanpa jenis"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-000000021001','hrd','admin');

-- v1 (1 Aug): the slot reading (no `day_reading`). v2 (1 Sep): datang & pulang.
insert into ops_hr.pay_rule_sets (version, effective_from, note, rules, created_by) values
 (1, '2026-08-01', 'uji D369 slots', '{
   "week_pattern":"5day","late_grace_minutes":15,"late_mode":"manual","undertime_mode":"off",
   "schedules":[
     {"code":"PRODUKSI","name":"Produksi","start_minutes":450,"end_minutes":990,
      "break_minutes":45,"note":null}],
   "schedule_by_unit":{"Workshop":"PRODUKSI"}
 }'::jsonb, 'ffffffff-0000-0000-0000-000000021001'),
 (2, '2026-09-01', 'uji D369 in_out', '{
   "week_pattern":"5day","late_grace_minutes":15,"late_mode":"manual","undertime_mode":"off",
   "day_reading":"in_out","hours_rounding_minutes":15,
   "schedules":[
     {"code":"PRODUKSI","name":"Produksi","start_minutes":450,"end_minutes":990,
      "break_minutes":45,"note":null}],
   "schedule_by_unit":{"Workshop":"PRODUKSI"}
 }'::jsonb, 'ffffffff-0000-0000-0000-000000021001');

insert into ops_hr.employees
  (id, employee_no, full_name, position, unit, pay_basis, base_rate, allowance_rate,
   daily_hours, joined_on, user_id, paid_leave_days)
values
  ('aaaa2100-0000-0000-0000-000000000001','B-2101','Tap berjenis','Tukang','Workshop',
   'daily', 130000, 0, 8, '2025-01-01', 'ffffffff-0000-0000-0000-000000021002', 0),
  ('aaaa2100-0000-0000-0000-000000000003','B-2103','Istirahat','Tukang','Workshop',
   'daily', 130000, 0, 8, '2025-01-01', 'ffffffff-0000-0000-0000-000000021003', 0),
  ('aaaa2100-0000-0000-0000-000000000004','B-2104','Tanpa jenis','Tukang','Workshop',
   'daily', 130000, 0, 8, '2025-01-01', 'ffffffff-0000-0000-0000-000000021004', 0);

-- Phone taps, written as `tap_self` writes them but at chosen moments.
insert into ops_hr.attendance_scans (employee_id, work_date, at, verify, source, recorded_by, kind)
select 'aaaa2100-0000-0000-0000-000000000001', ops_core.office_day(t), t, 'app', 'self',
       'ffffffff-0000-0000-0000-000000021002', k
  from (values
    -- Mon 10/8: everything said, a break the clock would not place, a trip out
    ('2026-08-10 08:00:00','in'), ('2026-08-10 10:30:00','break_out'),
    ('2026-08-10 11:00:00','break_in'), ('2026-08-10 14:00:00','away_out'),
    ('2026-08-10 15:10:00','away_back'), ('2026-08-10 16:00:00','out'),
    -- Tue 11/8: the phone names the reader's 13.59 tap a few seconds later
    ('2026-08-11 14:00:00','break_out'), ('2026-08-11 14:45:00','break_in'),
    -- Wed 12/8: mulai istirahat twice
    ('2026-08-12 08:00:00','in'), ('2026-08-12 12:00:00','break_out'),
    ('2026-08-12 12:10:00','break_out'), ('2026-08-12 13:00:00','break_in'),
    ('2026-08-12 17:00:00','out'),
    -- Fri 14/8: masuk and mulai istirahat a minute apart are two taps
    ('2026-08-14 08:00:00','in'), ('2026-08-14 08:01:00','break_out'),
    ('2026-08-14 08:30:00','break_in'), ('2026-08-14 17:00:00','out'),
    -- Thu 13/8: keluar and never back
    ('2026-08-13 08:00:00','in'), ('2026-08-13 09:00:00','away_out'),
    ('2026-08-13 12:00:00','break_out'), ('2026-08-13 12:45:00','break_in'),
    ('2026-08-13 17:00:00','out'),
    -- Mon 14/9 (in_out): pulang said, lembur said, a trip out in the morning
    ('2026-09-14 07:30:00','in'), ('2026-09-14 10:00:00','away_out'),
    ('2026-09-14 11:00:00','away_back'), ('2026-09-14 16:30:00','out'),
    ('2026-09-14 17:00:00','ot_start'), ('2026-09-14 19:00:00','ot_end')
  ) v(ts, k)
  cross join lateral (select v.ts::timestamp at time zone ops_core.office_tz() as t) x;

-- The reader's own taps on Tue 11/8, saying only when.
insert into ops_hr.attendance_scans (employee_id, work_date, at, verify, source, reason)
select 'aaaa2100-0000-0000-0000-000000000001', ops_core.office_day(t), t, 'FP', 'manual', 'uji D369'
  from unnest(array['2026-08-11 08:00:00','2026-08-11 13:59:30','2026-08-11 17:00:00']::timestamp[]) s(ts)
  cross join lateral (select s.ts at time zone ops_core.office_tz() as t) x;

create temp table t210 (who text, res jsonb) on commit drop;
grant all on t210 to authenticated;

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000021001';

/* ── the slot reading believes what a tap says ───────────────────────────── */
do $$
declare
  d ops_hr.day_reading; e uuid := 'aaaa2100-0000-0000-0000-000000000001';
begin
  select * into d from ops_hr.read_day(e, '2026-08-10');
  assert d.state = 'complete', 'every tap said what it was: ' || d.state || ' — ' || coalesce(array_to_string(d.issues, '; '), '');
  assert d.break_out_at = '2026-08-10 10:30'::timestamp at time zone ops_core.office_tz(),
    'mulai istirahat at 10.30 is the break, got ' || coalesce(d.break_out_at::text, 'null');
  assert d.break_in_at = '2026-08-10 11:00'::timestamp at time zone ops_core.office_tz(), 'selesai istirahat';
  assert d.out_at = '2026-08-10 16:00'::timestamp at time zone ops_core.office_tz(),
    'pulang is the tap that says so, not keluar kantor at 14.00';
  assert d.taps = 4 and d.unplaced = 0, format('keluar/kembali are not read as taps: %s taps, %s unplaced', d.taps, d.unplaced);
  assert d.work_hours = 7.5, 'eight hours less the half-hour break, the trip out not deducted; got ' || d.work_hours;
  assert 'Di luar kantor 14:00–15:10 (70 menit)' = any(d.notes),
    'the trip out is said: ' || coalesce(array_to_string(d.notes, '; '), '');

  select * into d from ops_hr.read_day(e, '2026-08-11');
  assert d.taps = 4, 'reader 13.59.30 and phone 14.00 are one tap; got ' || d.taps;
  assert d.break_out_at = '2026-08-11 13:59:30'::timestamp at time zone ops_core.office_tz(),
    'the one tap keeps what the phone said (break out), got ' || coalesce(d.break_out_at::text, 'null');
  assert d.break_in_at = '2026-08-11 14:45'::timestamp at time zone ops_core.office_tz(), 'selesai istirahat 14.45';
  assert d.out_at = '2026-08-11 17:00'::timestamp at time zone ops_core.office_tz(), 'the reader''s 17.00 is still placed by the clock';
  assert d.state = 'complete', 'mixed reader and phone taps read complete: ' || coalesce(array_to_string(d.issues, '; '), '');

  select * into d from ops_hr.read_day(e, '2026-08-12');
  assert d.state = 'review', 'a second mulai istirahat is left over';
  assert d.break_out_at = '2026-08-12 12:00'::timestamp at time zone ops_core.office_tz(), 'the first one is the break';
  assert d.unplaced = 1, 'one left over, got ' || d.unplaced;
  assert exists (select 1 from unnest(d.issues) i where i like '%could not place: 12:10%'),
    'the issue names it: ' || coalesce(array_to_string(d.issues, '; '), '');

  select * into d from ops_hr.read_day(e, '2026-08-14');
  assert d.taps = 4 and d.break_out_at = '2026-08-14 08:01'::timestamp at time zone ops_core.office_tz(),
    format('two different buttons a minute apart are two taps: %s taps, break out %s', d.taps, d.break_out_at);

  select * into d from ops_hr.read_day(e, '2026-08-13');
  assert d.state = 'complete', 'keluar without kembali is not a problem for the day: ' || coalesce(array_to_string(d.issues, '; '), '');
  assert 'Keluar kantor 09:00, belum kembali' = any(d.notes), coalesce(array_to_string(d.notes, '; '), '');

  /* in_out: pulang is the tap that says so; lembur is the pair tapped. */
  select * into d from ops_hr.read_day(e, '2026-09-14');
  assert d.out_at = '2026-09-14 16:30'::timestamp at time zone ops_core.office_tz(),
    'pulang 16.30, not the last tap at 19.00; got ' || coalesce(d.out_at::text, 'null');
  assert d.work_hours = 8.25, 'the schedule''s hours, got ' || d.work_hours;
  assert d.ot_start_at = '2026-09-14 17:00'::timestamp at time zone ops_core.office_tz()
     and d.ot_end_at = '2026-09-14 19:00'::timestamp at time zone ops_core.office_tz(), 'the lembur pair tapped';
  assert d.overtime_hours = 2, 'lembur 17.00–19.00 is 2 hours, got ' || d.overtime_hours;
  assert d.state = 'complete', d.state || ' — ' || coalesce(array_to_string(d.issues, '; '), '');
  assert 'Di luar kantor 10:00–11:00 (60 menit)' = any(d.notes), coalesce(array_to_string(d.notes, '; '), '');
end $$;

/* ── the tap itself ──────────────────────────────────────────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000021002';
do $$
declare a jsonb; b jsonb;
begin
  a := ops_hr.tap_self(null, null, null, null, null, null, 'lunch');
  assert a -> 'error' ->> 'code' = 'bad_kind', a::text;

  -- No site is set in this file, so the tap is `no_site`: one press — except
  -- keluar kantor, which says where to.
  a := ops_hr.tap_self(-8.6, 115.2, 15, null, null, null, 'away_out');
  assert a -> 'error' ->> 'code' = 'away_needs_note', a::text;
  assert a -> 'error' -> 'detail' ->> 'verdict' = 'no_site', 'the form gets the verdict: ' || a::text;
  assert (select count(*) from ops_hr.attendance_scans
           where employee_id = 'aaaa2100-0000-0000-0000-000000000001'
             and work_date = ops_core.office_day(now())) = 0,
    'a refused keluar kantor still wrote a tap';

  a := ops_hr.tap_self(-8.6, 115.2, 15, 'Ambil kayu di pemasok', null, 'k210-away', 'away_out');
  assert a ->> 'outcome' = 'ok', a::text;
  assert a -> 'data' ->> 'kind' = 'away_out', a::text;
  b := ops_hr.tap_self(-8.6, 115.2, 15, 'Ambil kayu di pemasok', null, 'k210-away', 'away_out');
  assert b -> 'data' ->> 'id' = a -> 'data' ->> 'id', 'a replayed key wrote a second tap';
  insert into t210 values ('away', a);
end $$;

-- One tap per person: a transaction has one `now()`, and a tap is who and when.
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000021003';
do $$
declare a jsonb;
begin
  a := ops_hr.tap_self(-8.6, 115.2, 15, null, null, null, 'break_out');
  assert a ->> 'outcome' = 'ok', 'mulai istirahat needs no note: ' || a::text;
  insert into t210 values ('break', a);
end $$;

-- An old caller with no kind still taps, saying only when.
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000021004';
do $$
declare a jsonb;
begin
  a := ops_hr.tap_self(-8.6, 115.2, 15, null, null, null);
  assert a ->> 'outcome' = 'ok' and a -> 'data' ->> 'kind' is null, a::text;
end $$;

reset role;

do $$
declare v_label text; v_kind text;
begin
  select s.kind into v_kind from ops_hr.attendance_scans s
   where s.id = (select (res -> 'data' ->> 'id')::uuid from t210 where who = 'break');
  assert v_kind = 'break_out', 'the kind is stored, got ' || coalesce(v_kind, 'null');

  select l.kind into v_kind from ops_hr.v_located_tap l
   where l.tap_no = (select res -> 'data' ->> 'tap_no' from t210 where who = 'away');
  assert v_kind = 'away_out', 'HRD''s review shows the kind, got ' || coalesce(v_kind, 'null');

  select label into v_label from ops_core.activity_events
   where actor_id = 'ffffffff-0000-0000-0000-000000021003' and kind = 'attendance_tap'
     and label like 'Tap mulai istirahat pukul %';
  assert v_label is not null, 'the activity label says what the tap was';
  assert exists (select 1 from ops_core.activity_events
                  where actor_id = 'ffffffff-0000-0000-0000-000000021004'
                    and label like 'Tap presensi pukul %'), 'a tap with no kind keeps the old label';

  assert (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'ops_hr' and p.proname = 'tap_self') = 1,
    'tap_self is overloaded — PostgREST cannot choose between them';
  assert not has_function_privilege('anon',
    'ops_hr.tap_self(double precision,double precision,double precision,text,uuid,text,text)', 'execute'),
    'anon can call tap_self';
end $$;

rollback;
