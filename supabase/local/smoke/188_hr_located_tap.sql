-- 188_hr_located_tap.sql — a phone tap says where it was made, checked
-- against the warehouse (0188, D332).
--
-- DERIVATIONS  no site set → one press, stored as `no_site`; inside the radius
--              (whole accuracy circle) → one press; outside with a note →
--              written and flagged, photo linked to the tap in the HRD drive's
--              PRESENSI LUAR AREA; no location with a note → written and
--              flagged; a circle straddling the edge → `uncertain`; the label
--              is the office clock (WIB since D334) and says *di luar area*;
--              a replayed key writes nothing twice
-- REFUSALS     outside without a note (invalid, carries the verdict, writes
--              no tap); no location without a note; half a point; a photo
--              somebody else uploaded; setting the site without HRD/IT; a
--              radius out of range; no overload of tap_self remains; an
--              employee reads their own reading and not a colleague's

begin;

set local timezone = 'UTC';

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-000000018801','hrd188@talaliving.com','{"full_name":"HRD"}'),
  ('ffffffff-0000-0000-0000-000000018802','in188@talaliving.com','{"full_name":"Di gudang"}'),
  ('ffffffff-0000-0000-0000-000000018803','out188@talaliving.com','{"full_name":"Di luar"}'),
  ('ffffffff-0000-0000-0000-000000018804','noloc188@talaliving.com','{"full_name":"Tanpa lokasi"}'),
  ('ffffffff-0000-0000-0000-000000018805','edge188@talaliving.com','{"full_name":"Di tepi"}'),
  ('ffffffff-0000-0000-0000-000000018806','early188@talaliving.com','{"full_name":"Sebelum titik"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-000000018801','hrd','write');

insert into ops_hr.employees
  (id, employee_no, full_name, position, unit, pay_basis, base_rate, allowance_rate,
   daily_hours, joined_on, user_id, paid_leave_days)
select ('aaaa1880-0000-0000-0000-00000000000' || n)::uuid, 'B-188' || n, 'Karyawan ' || n, 'Tukang', 'Produksi',
       'daily', 180000, 25000, 8, '2025-01-01', ('ffffffff-0000-0000-0000-00000001880' || n)::uuid, 12
  from generate_series(2, 6) n;

-- A photo uploaded by the outside tapper, and one by somebody else. The upload
-- route is not SQL.
insert into ops_core.attachments (id, storage_path, filename, uploaded_by) values
  ('55550000-0000-0000-0000-000000018801','d/selfie.jpg','selfie.jpg','ffffffff-0000-0000-0000-000000018803'),
  ('55550000-0000-0000-0000-000000018802','d/other.jpg','other.jpg','ffffffff-0000-0000-0000-000000018802');

create temp table t188 (who text, res jsonb) on commit drop;
grant all on t188 to authenticated;

set local role authenticated;

/* ── no site set yet: one press, stored, not flagged ──────────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000018806';
do $$
declare a jsonb;
begin
  a := ops_hr.tap_self(-8.6, 115.2, 15);
  assert a ->> 'outcome' = 'ok', 'no site set must not block a tap: ' || a::text;
  assert a -> 'data' -> 'location' ->> 'verdict' = 'no_site', a::text;
  -- Setting the site is HRD's or IT's, not an employee's.
  a := ops_hr.save_work_site('GUDANG','Gudang', -8.65, 115.216667, 150);
  assert a -> 'error' ->> 'code' = 'not_permitted', a::text;
end $$;

/* ── HRD sets the warehouse ───────────────────────────────────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000018801';
do $$
declare a jsonb;
begin
  a := ops_hr.save_work_site('GUDANG','Gudang', -8.65, 115.216667, 5000);
  assert a -> 'error' ->> 'code' = 'bad_radius', a::text;
  a := ops_hr.save_work_site('GUDANG','Gudang', null, null, 150);
  assert a -> 'error' ->> 'code' = 'point_required', a::text;
  a := ops_hr.save_work_site('gudang','Gudang', -8.65, 115.216667, 150);
  assert a ->> 'outcome' = 'ok', a::text;
  assert a -> 'data' ->> 'code' = 'GUDANG', a::text;
  -- Saving again is the same row.
  a := ops_hr.save_work_site('GUDANG','Gudang utama', -8.65, 115.216667, 150);
  assert (select count(*) from ops_hr.work_sites) = 1, 'a second save made a second site';
  -- Judged from the settings screen: 12 m out with ±10 m is inside.
  a := ops_hr.judge_location(-8.65 + 12 / 111195.0, 115.216667, 10);
  assert a ->> 'verdict' = 'inside', a::text;
  assert abs((a ->> 'distance_m')::numeric - 12) < 1, a::text;
end $$;

/* ── inside: one press ────────────────────────────────────────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000018802';
do $$
declare a jsonb; b jsonb;
begin
  a := ops_hr.tap_self(-8.65, 115.216667, 12, null, null, 'k188-in');
  assert a ->> 'outcome' = 'ok', a::text;
  assert a -> 'data' -> 'location' ->> 'verdict' = 'inside', a::text;
  -- A retried request with the same key is the same tap.
  b := ops_hr.tap_self(-8.65, 115.216667, 12, null, null, 'k188-in');
  assert b -> 'data' ->> 'id' = a -> 'data' ->> 'id', 'a replayed key wrote a second tap';
  -- Somebody else's photo cannot ride on my tap.
  b := ops_hr.tap_self(-8.60, 115.216667, 12, 'x', '55550000-0000-0000-0000-000000018801');
  assert b -> 'error' ->> 'code' = 'photo_not_yours', b::text;
  insert into t188 values ('in', a);
end $$;

/* ── outside: refused without a note, written and flagged with one ────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000018803';
do $$
declare a jsonb;
begin
  -- ~1.1 km north of the warehouse.
  a := ops_hr.tap_self(-8.64, 115.216667, 20);
  assert a ->> 'outcome' = 'refused', a::text;
  assert a -> 'error' ->> 'code' = 'off_site_needs_note', a::text;
  assert a -> 'error' -> 'detail' ->> 'verdict' = 'outside', a::text;
  assert (select count(*) from ops_hr.attendance_scans
           where employee_id = 'aaaa1880-0000-0000-0000-000000000003') = 0,
    'a refused off-site tap still wrote a tap';

  a := ops_hr.tap_self(-8.64, 115.216667, 20, '   ');
  assert a -> 'error' ->> 'code' = 'off_site_needs_note', 'a blank note passed: ' || a::text;

  a := ops_hr.tap_self(-8.64, 115.216667, 20, 'Ambil kayu di pemasok',
                       '55550000-0000-0000-0000-000000018801');
  assert a ->> 'outcome' = 'ok', a::text;
  assert a -> 'data' -> 'location' ->> 'verdict' = 'outside', a::text;
  insert into t188 values ('out', a);

  -- Half a point is a client bug, not a place.
  a := ops_hr.tap_self(-8.64, null, 20, 'x');
  assert a -> 'error' ->> 'code' = 'bad_location', a::text;
end $$;

/* ── no location (permission denied) ─────────────────────────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000018804';
do $$
declare a jsonb;
begin
  a := ops_hr.tap_self();
  assert a -> 'error' ->> 'code' = 'off_site_needs_note', a::text;
  assert a -> 'error' -> 'detail' ->> 'verdict' = 'no_location', a::text;
  a := ops_hr.tap_self(null, null, null, 'Izin lokasi ditolak di HP');
  assert a ->> 'outcome' = 'ok', a::text;
  assert a -> 'data' -> 'location' ->> 'verdict' = 'no_location', a::text;
end $$;

/* ── a circle across the edge: uncertain, needs a note ───────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000018805';
do $$
declare a jsonb;
begin
  -- 140 m out, ±30 m: could be either side of 150 m.
  a := ops_hr.tap_self(-8.65 + 140 / 111195.0, 115.216667, 30);
  assert a -> 'error' -> 'detail' ->> 'verdict' = 'uncertain', a::text;
  a := ops_hr.tap_self(-8.65 + 140 / 111195.0, 115.216667, 30, 'Di pos satpam');
  assert a ->> 'outcome' = 'ok', a::text;

  -- An employee reads their own reading, not a colleague's.
  assert (select count(*) from ops_hr.scan_locations) = 1,
    format('an employee sees %s readings, expected their own one', (select count(*) from ops_hr.scan_locations));
  assert (select count(*) from ops_hr.v_located_tap where employee_no <> 'B-1885') = 0,
    'an employee reads a colleague''s located tap';
end $$;

/* ── HRD's review ─────────────────────────────────────────────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000018801';
do $$
declare r record; v_n int;
begin
  select count(*) into v_n from ops_hr.v_located_tap;
  assert v_n = 5, format('HRD should read all 5 located taps, got %s', v_n);
  select count(*) into v_n from ops_hr.v_located_tap where flagged;
  assert v_n = 3, format('outside, no-location and uncertain are flagged: got %s', v_n);
  assert not (select flagged from ops_hr.v_located_tap where verdict = 'no_site'),
    'a tap before the site was set is flagged';

  select * into r from ops_hr.v_located_tap where employee_no = 'B-1883';
  assert r.verdict = 'outside' and r.note = 'Ambil kayu di pemasok', r::text;
  assert r.distance_m between 1100 and 1125, r::text;
  assert r.photo_id = '55550000-0000-0000-0000-000000018801', r::text;
  assert r.site_name = 'Gudang utama', r::text;
end $$;

reset role;

/* ── the photo: on the tap, in the HRD drive's folder ────────────────────── */
do $$
declare v_tap text;
begin
  select res -> 'data' ->> 'tap_no' into v_tap from t188 where who = 'out';
  assert exists (select 1 from ops_core.attachment_links
                  where entity = 'attendance_scan' and entity_no = v_tap and kind = 'foto_presensi'
                    and attachment_id = '55550000-0000-0000-0000-000000018801'),
    'the off-site photo is not linked to its tap';
  assert (select slug from ops_core.doc_kind_drive where kind = 'foto_presensi') = 'hrd',
    'a clock-in photo is not filed in the HRD drive (personal data, 0035)';
  assert ops_core.drive_path_for('foto_presensi', 'attendance_scan') = 'PRESENSI LUAR AREA',
    ops_core.drive_path_for('foto_presensi', 'attendance_scan');
end $$;

/* ── the label is the office clock (WIB since D334), and says off-site ──── */
do $$
declare v_at timestamptz; v_label text;
begin
  select (res -> 'data' ->> 'at')::timestamptz into v_at from t188 where who = 'out';
  select label into v_label from ops_core.activity_events
   where actor_id = 'ffffffff-0000-0000-0000-000000018803' and kind = 'attendance_tap';
  assert v_label = 'Tap presensi pukul ' || to_char(v_at at time zone 'Asia/Jakarta', 'HH24:MI') || ' · di luar area',
    format('label should read the WIB clock and say off-site, got %s', v_label);
  assert to_char(v_at at time zone 'Asia/Jakarta', 'HH24:MI') <> to_char(v_at, 'HH24:MI'),
    'the session is not on UTC, so this proves nothing';

  select label into v_label from ops_core.activity_events
   where actor_id = 'ffffffff-0000-0000-0000-000000018802' and kind = 'attendance_tap';
  assert v_label = 'Tap presensi pukul ' || to_char(v_at at time zone 'Asia/Jakarta', 'HH24:MI'), v_label;

  -- D141 unchanged: a self tap, recorded by its caller, no slot decided.
  assert (select count(*) from ops_hr.attendance_scans s join ops_hr.scan_locations l on l.scan_id = s.id
           where s.source::text <> 'self' or s.recorded_by is null) = 0,
    'a located tap is not a plain self tap';
end $$;

/* ── one tap_self, granted as before ─────────────────────────────────────── */
do $$
begin
  assert (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'ops_hr' and p.proname = 'tap_self') = 1,
    'tap_self is overloaded — PostgREST cannot choose between them';
  assert has_function_privilege('authenticated',
    'ops_hr.tap_self(double precision,double precision,double precision,text,uuid,text,text,jsonb)','execute'),
    'authenticated cannot call tap_self';
  assert not has_function_privilege('anon',
    'ops_hr.tap_self(double precision,double precision,double precision,text,uuid,text,text,jsonb)','execute'),
    'anon can call tap_self';
  assert has_function_privilege('authenticated',
    'ops_hr.save_work_site(text,text,double precision,double precision,integer,boolean,text)','execute'),
    'authenticated cannot call save_work_site';
end $$;

rollback;
