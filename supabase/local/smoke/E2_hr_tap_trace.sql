-- E2_hr_tap_trace.sql — a phone tap keeps every layer it was seen with
-- (0270, D431).
--
-- DERIVATIONS  the address is read from the request (cf-connecting-ip before
--              x-real-ip before the first x-forwarded-for hop), with the user
--              agent and the auth session; authorization/apikey/cookie never
--              reach the table; what the phone says (device id, its clock,
--              build) is kept as sent; a request with no headers and a phone
--              that sends nothing still tap, with those layers empty; a
--              malformed device id or clock is stored as missing; an address
--              on a site's network says so, one off it says not, and before
--              any site names a network it says nothing; one device for two
--              people in 30 days is flagged; a person's first tap from a
--              device is `device_new`; my_network names the caller's address
-- REFUSALS     networks set without HRD/IT; not an address; a private (LAN)
--              address; a range wider than /24; an unknown site; an employee
--              reads their own trace and not a colleague's; one tap_self,
--              not executable by anon

begin;

set local timezone = 'UTC';

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-0000000e2001','hrd-e2@talaliving.com','{"full_name":"HRD"}'),
  ('ffffffff-0000-0000-0000-0000000e2002','a-e2@talaliving.com','{"full_name":"A"}'),
  ('ffffffff-0000-0000-0000-0000000e2003','b-e2@talaliving.com','{"full_name":"B"}'),
  ('ffffffff-0000-0000-0000-0000000e2004','c-e2@talaliving.com','{"full_name":"C"}'),
  ('ffffffff-0000-0000-0000-0000000e2005','d-e2@talaliving.com','{"full_name":"D"}'),
  ('ffffffff-0000-0000-0000-0000000e2006','e-e2@talaliving.com','{"full_name":"E"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-0000000e2001','hrd','write');

insert into ops_hr.employees
  (id, employee_no, full_name, position, unit, pay_basis, base_rate, allowance_rate,
   daily_hours, joined_on, user_id, paid_leave_days)
select ('aaaae200-0000-0000-0000-00000000000' || n)::uuid, 'B-E2' || n, 'Karyawan ' || n, 'Tukang', 'Produksi',
       'daily', 180000, 25000, 8, '2025-01-01', ('ffffffff-0000-0000-0000-0000000e200' || n)::uuid, 12
  from generate_series(2, 6) n;

create temp table te2 (who text, res jsonb) on commit drop;
grant all on te2 to authenticated;

set local role authenticated;

/* ── HRD sets the warehouse point; no network named yet ──────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-0000000e2001';
do $$
declare a jsonb;
begin
  a := ops_hr.save_work_site('GUDANG','Gudang', -8.65, 115.216667, 150);
  assert a ->> 'outcome' = 'ok', a::text;
end $$;

/* ── no headers, no context: still a tap, layers empty ───────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-0000000e2005';
do $$
declare a jsonb; t ops_hr.scan_traces;
begin
  a := ops_hr.tap_self(-8.65, 115.216667, 10);
  assert a ->> 'outcome' = 'ok', 'a request with nothing to trace must still tap: ' || a::text;
  select * into t from ops_hr.scan_traces where scan_id = (a -> 'data' ->> 'id')::uuid;
  assert found, 'a tap with no layers wrote no trace row';
  assert t.ip is null and t.user_agent is null and t.device_id is null and t.client is null, row_to_json(t)::text;
  assert t.on_site_network is null, 'no network named anywhere: the reading must say nothing';
  assert (t.request ->> 'headers_seen')::boolean = false, t.request::text;
end $$;

/* ── a phone on the office line, with its context ────────────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-0000000e2002';
set local request.jwt.claims = '{"sub":"ffffffff-0000-0000-0000-0000000e2002","session_id":"sess-e2-a","aal":"aal1"}';
set local request.headers = '{"cf-connecting-ip":"203.0.113.10","x-real-ip":"198.51.100.7","x-forwarded-for":"6.6.6.6, 203.0.113.10","user-agent":"Mozilla/5.0 (Linux; Android 14) E2","authorization":"Bearer SECRET","apikey":"KEY","cookie":"sb=SECRET"}';
do $$
declare a jsonb; t ops_hr.scan_traces;
begin
  -- Before any network is named, the address is kept and the reading is null.
  a := ops_hr.tap_self(-8.65, 115.216667, 10, null, null, 'ke2-a', null,
         '{"device_id":"dev-shared-0001","device_at":"2026-10-14T07:59:58+08:00","app_build":"abc1234-x","display_mode":"standalone","timezone":"Asia/Makassar"}');
  assert a ->> 'outcome' = 'ok', a::text;
  select * into t from ops_hr.scan_traces where scan_id = (a -> 'data' ->> 'id')::uuid;
  assert host(t.ip) = '203.0.113.10', format('cf-connecting-ip first, got %s', t.ip);
  assert t.user_agent = 'Mozilla/5.0 (Linux; Android 14) E2', t.user_agent;
  assert t.session_id = 'sess-e2-a', t.session_id;
  assert t.device_id = 'dev-shared-0001' and t.app_build = 'abc1234-x', row_to_json(t)::text;
  assert t.device_at = '2026-10-13T23:59:58Z'::timestamptz, t.device_at::text;
  assert t.client ->> 'display_mode' = 'standalone', 'the phone''s context is kept as sent';
  assert t.request ->> 'x_forwarded_for' = '6.6.6.6, 203.0.113.10', 'the forwarded chain is kept raw';
  assert t.request::text not like '%SECRET%' and t.request::text not like '%KEY%',
    'a session credential reached the table: ' || t.request::text;
  assert t.on_site_network is null, 'no network named yet';
end $$;

/* ── naming the office network ───────────────────────────────────────────── */
do $$
declare a jsonb;
begin
  -- Not HRD.
  a := ops_hr.set_site_networks('GUDANG', array['203.0.113.10']);
  assert a -> 'error' ->> 'code' = 'not_permitted', a::text;
end $$;

set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-0000000e2001';
set local request.jwt.claims = '{"sub":"ffffffff-0000-0000-0000-0000000e2001"}';
do $$
declare a jsonb;
begin
  a := ops_hr.set_site_networks('GUDANG', array['kantor']);
  assert a -> 'error' ->> 'code' = 'bad_network', a::text;
  a := ops_hr.set_site_networks('GUDANG', array['192.168.1.1']);
  assert a -> 'error' ->> 'code' = 'private_network', a::text;
  a := ops_hr.set_site_networks('GUDANG', array['203.0.0.0/16']);
  assert a -> 'error' ->> 'code' = 'network_too_wide', a::text;
  a := ops_hr.set_site_networks('NOWHERE', array['203.0.113.10']);
  assert a -> 'error' ->> 'code' = 'not_found', a::text;

  -- HRD on the office Wi-Fi asks which address it is.
  a := ops_hr.my_network();
  assert a ->> 'ip' = '203.0.113.10' and a ->> 'site_code' is null, a::text;

  a := ops_hr.set_site_networks('gudang', array[' 203.0.113.10 ', '', '203.0.113.10', '2001:db8:1::/48'], 'ke2-net');
  assert a ->> 'outcome' = 'ok', a::text;
  assert a -> 'data' -> 'networks' = '["203.0.113.10/32", "2001:db8:1::/48"]'::jsonb,
    'blank and repeated entries must collapse: ' || a::text;
  a := ops_hr.my_network();
  assert a ->> 'site_code' = 'GUDANG', a::text;
end $$;

/* ── on the line, off the line; one device for two people ────────────────── */
-- B taps from A's phone, on the office line.
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-0000000e2003';
set local request.jwt.claims = '{"sub":"ffffffff-0000-0000-0000-0000000e2003"}';
do $$
declare a jsonb; t ops_hr.scan_traces;
begin
  a := ops_hr.tap_self(-8.65, 115.216667, 10, null, null, null, null,
         '{"device_id":"dev-shared-0001","device_at":"not a time"}');
  assert a ->> 'outcome' = 'ok', a::text;
  select * into t from ops_hr.scan_traces where scan_id = (a -> 'data' ->> 'id')::uuid;
  assert t.on_site_network and t.network_site_code = 'GUDANG', row_to_json(t)::text;
  assert t.device_at is null, 'a clock that is not a time is stored as missing';
  insert into te2 values ('b', a);
end $$;

-- C on mobile data, with a device id that is not one, and context that is
-- not an object.
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-0000000e2004';
set local request.jwt.claims = '{"sub":"ffffffff-0000-0000-0000-0000000e2004"}';
set local request.headers = '{"x-forwarded-for":"114.10.20.30, 10.0.0.1","user-agent":"E2 mobile"}';
do $$
declare a jsonb; t ops_hr.scan_traces;
begin
  a := ops_hr.tap_self(-8.65, 115.216667, 10, null, null, null, null, '{"device_id":"x; drop"}');
  assert a ->> 'outcome' = 'ok', a::text;
  select * into t from ops_hr.scan_traces where scan_id = (a -> 'data' ->> 'id')::uuid;
  assert host(t.ip) = '114.10.20.30', format('first forwarded hop when nothing better, got %s', t.ip);
  assert t.on_site_network = false and t.network_site_code is null, row_to_json(t)::text;
  assert t.device_id is null, 'a malformed device id is stored as missing';

end $$;

-- E sends context that is not an object at all.
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-0000000e2006';
do $$
declare a jsonb;
begin
  a := ops_hr.tap_self(-8.65, 115.216667, 10, null, null, null, null, '["not","an","object"]');
  assert a ->> 'outcome' = 'ok', 'context that is not an object must not refuse a tap: ' || a::text;
  assert (select client from ops_hr.scan_traces where scan_id = (a -> 'data' ->> 'id')::uuid) is null,
    'context that is not an object is stored as missing';
end $$;

reset role;

-- A's earlier tap from the same phone, yesterday: today's is not new to A.
insert into ops_hr.attendance_scans (id, employee_id, work_date, at, verify, source, recorded_by)
values ('e2e2e2e2-0000-0000-0000-000000000001', 'aaaae200-0000-0000-0000-000000000002',
        current_date - 1, now() - interval '1 day', 'app', 'self', 'ffffffff-0000-0000-0000-0000000e2002');
insert into ops_hr.scan_locations (scan_id, tap_no, verdict)
values ('e2e2e2e2-0000-0000-0000-000000000001', 'B-E22/earlier', 'no_site');
insert into ops_hr.scan_traces (scan_id, device_id)
values ('e2e2e2e2-0000-0000-0000-000000000001', 'dev-shared-0001');

set local role authenticated;

/* ── HRD's review ────────────────────────────────────────────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-0000000e2001';
do $$
declare r record;
begin
  select * into r from ops_hr.v_located_tap where employee_no = 'B-E23';
  assert r.device_people = 2 and r.flagged, format('one phone for A and B must be flagged: %s', row_to_json(r));
  assert r.device_new, 'B''s first tap from that phone is new to B';
  assert r.ip = '203.0.113.10' and r.on_site_network, row_to_json(r)::text;

  select * into r from ops_hr.v_located_tap where employee_no = 'B-E22' and tap_no <> 'B-E22/earlier';
  assert r.device_people = 2 and r.flagged, row_to_json(r)::text;
  assert not r.device_new, 'A tapped from this phone yesterday';

  select * into r from ops_hr.v_located_tap where employee_no = 'B-E24' order by at limit 1;
  assert r.device_people is null and r.device_new is null, row_to_json(r)::text;
  assert r.on_site_network = false and not r.flagged,
    'off the office line is shown, not flagged: ' || row_to_json(r)::text;
end $$;

/* ── an employee reads their own trace, not a colleague's ────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-0000000e2004';
do $$
begin
  assert (select count(*) from ops_hr.scan_traces) >= 1, 'C cannot read their own trace';
  assert (select count(*) from ops_hr.scan_traces t join ops_hr.attendance_scans s on s.id = t.scan_id
           where s.employee_id <> 'aaaae200-0000-0000-0000-000000000004') = 0,
    'C read somebody else''s address and device';
  -- C's view of their own row cannot count A and B through RLS.
  assert (select count(*) from ops_hr.v_located_tap where employee_no <> 'B-E24') = 0;
end $$;

reset role;

/* ── one tap_self, granted; the new seams are not anon's ─────────────────── */
do $$
begin
  assert (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'ops_hr' and p.proname = 'tap_self') = 1,
    'tap_self is overloaded — PostgREST cannot choose between them';
  assert not has_function_privilege('anon',
    'ops_hr.tap_self(double precision,double precision,double precision,text,uuid,text,text,jsonb)','execute');
  assert not has_function_privilege('anon', 'ops_hr.set_site_networks(text,text[],text)','execute');
  assert not has_function_privilege('anon', 'ops_hr.my_network()','execute');
  assert has_function_privilege('authenticated', 'ops_hr.set_site_networks(text,text[],text)','execute');
  assert has_function_privilege('authenticated', 'ops_hr.my_network()','execute');
end $$;

rollback;
