-- 0270_hr_tap_trace.sql — a phone tap keeps every layer it was seen with
-- (D431).
--
-- ── what the owner asked for ──────────────────────────────────────────────
--
-- *do we also record the IP address and the mac? basically we want to log and
-- store every information we had from each employee when they absence.* Until
-- now a tap (0164/0188/0211) kept who, when, the GPS reading and its verdict,
-- the note and the photo. It kept **nothing about the connection or the
-- device**, so two accounts clocking in from one phone, or a fake-GPS app
-- placing somebody inside the warehouse from home, left no trace at all.
--
-- ── the three parts ───────────────────────────────────────────────────────
--
-- 1. `ops_core.request_trace()`: the network layer, read from the request
--    PostgREST hands the database (`request.headers`), never from a parameter
--    a client can fill in. The browser talks to Supabase directly
--    (`supabaseBrowser()`), so these are the phone's own headers. The address
--    prefers `cf-connecting-ip` (set by Cloudflare in front of Supabase, which
--    a client cannot forge), then `x-real-ip`, then the first hop of
--    `x-forwarded-for` (which a client can prepend to, so it is last). All
--    three are kept raw. **Only named headers are kept**: `authorization`,
--    `apikey` and `cookie` carry the session itself and never reach a table.
-- 2. `ops_hr.scan_traces`, 1:1 with a self tap, beside `scan_locations` for
--    the same reasons that table is a side table (0188): the reader at the
--    door has none of this, and taps stay facts. It holds the address, the
--    user agent, the auth session, and what the phone says about itself —
--    a per-install device id, its own clock, the app build — as **evidence,
--    not proof**: a phone can say anything about itself.
-- 3. A work site may name its **office networks** (`work_sites.networks`,
--    the public addresses of its internet line). A tap whose address is one
--    of them was made on that site's Wi-Fi. That is the corroboration GPS
--    cannot give itself: a fake-GPS app moves the point, not the connection.
--    `set_site_networks` sets them; `my_network` tells HRD, standing on the
--    office Wi-Fi, which address that is.
--
-- `v_located_tap` gains the trace and two readings of it: how many people one
-- device clocked in for within 30 days of the tap (`device_people`), and
-- whether it is that person's first tap from that device (`device_new`). A
-- device shared by two people is **flagged**, beside the location flags. Off
-- the office network is shown and **not** flagged: on mobile data that is
-- most taps, and a flag on most taps is a flag nobody reads.
--
-- ── what this cannot do ───────────────────────────────────────────────────
--
-- **No MAC address.** A browser never exposes one, and an IP packet carries
-- only the MAC of the last router it crossed. The per-install device id is the
-- stand-in; a MAC would need a native app or the office router's own logs.
-- A device id is lost when the browser's storage is cleared, so `device_new`
-- is a lead, never a verdict. On mobile data the address is the carrier's
-- shared one (CGNAT) and places nobody; its value is *office line or not*.
--
-- Collecting never refuses (A6): a request with no headers (a script, the
-- local ladder) or a phone that sends no context writes the tap with those
-- layers empty. Refused attempts (an off-site tap with no note) write no tap
-- and so no trace; the envelope is what the phone already saw.
--
-- `tap_self` gains `p_client` **last**, and the old signature is dropped in
-- this file: two functions that both accept `{p_key}` are an overload
-- PostgREST cannot choose between (0188). The body is 0211's, restated, with
-- the trace written after the location.

/* ── 1. the request, as the server saw it ──────────────────────────────── */
create or replace function ops_core.request_trace()
returns jsonb
language plpgsql stable set search_path = pg_temp as $$
declare
  h jsonb; c jsonb; v_xff text; v_ip text;
begin
  begin
    h := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then h := null;
  end;
  begin
    c := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  exception when others then c := null;
  end;
  h := coalesce(h, '{}'::jsonb);

  v_xff := h ->> 'x-forwarded-for';
  v_ip := coalesce(nullif(btrim(h ->> 'cf-connecting-ip'), ''),
                   nullif(btrim(h ->> 'x-real-ip'), ''),
                   nullif(btrim(split_part(coalesce(v_xff, ''), ',', 1)), ''));
  begin
    perform v_ip::inet;
  exception when others then v_ip := null;
  end;

  return jsonb_strip_nulls(jsonb_build_object(
    'ip',               v_ip,
    'cf_connecting_ip', h ->> 'cf-connecting-ip',
    'x_real_ip',        h ->> 'x-real-ip',
    'x_forwarded_for',  left(v_xff, 512),
    'cf_ipcountry',     h ->> 'cf-ipcountry',
    'user_agent',       left(h ->> 'user-agent', 512),
    'origin',           h ->> 'origin',
    'referer',          left(h ->> 'referer', 512),
    'accept_language',  left(h ->> 'accept-language', 128),
    'session_id',       c ->> 'session_id',
    'aal',              c ->> 'aal',
    'headers_seen',     h <> '{}'::jsonb));
end $$;

comment on function ops_core.request_trace() is
  'The network layer of the current request: client address, forwarded chain, user agent, auth session. '
  'Named headers only — never authorization, apikey or cookie. Empty outside PostgREST. (0270, D431)';

revoke execute on function ops_core.request_trace() from public;
grant execute on function ops_core.request_trace() to authenticated;

/* ── 2. a site's office networks ───────────────────────────────────────── */
alter table ops_hr.work_sites
  add column networks cidr[] not null default '{}';

comment on column ops_hr.work_sites.networks is
  'Public addresses of this site''s internet line. A tap from one of them was made on the site''s network. (0270, D431)';

-- Which site's network an address is on. Any site with networks, active or
-- not: an office line is an office line even while its GPS point is off.
create or replace function ops_hr.match_site_network(p_ip inet, out on_site boolean, out site_code text)
language sql stable security definer set search_path = ops_hr, pg_temp as $$
  select case
           when p_ip is null or not exists (select 1 from ops_hr.work_sites where cardinality(networks) > 0)
             then null
           else m.code is not null
         end,
         m.code
    from (select 1) one
    left join lateral (
      select w.code from ops_hr.work_sites w
       where p_ip is not null and p_ip <<= any (w.networks)
       order by w.active desc, w.code
       limit 1) m on true;
$$;

revoke execute on function ops_hr.match_site_network(inet) from public;
grant execute on function ops_hr.match_site_network(inet) to authenticated;

-- *Which address is this Wi-Fi?* — the caller's own, as the server sees it,
-- and the site it already belongs to. Nothing about anybody else.
create or replace function ops_hr.my_network()
returns jsonb
language plpgsql stable security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare v_req jsonb := ops_core.request_trace(); v_net record;
begin
  v_net := ops_hr.match_site_network((v_req ->> 'ip')::inet);
  return jsonb_build_object('ip', v_req ->> 'ip', 'site_code', v_net.site_code,
                            'user_agent', v_req ->> 'user_agent');
end $$;

revoke execute on function ops_hr.my_network() from public;
grant execute on function ops_hr.my_network() to authenticated;

create or replace function ops_hr.set_site_networks(
  p_code text,
  p_networks text[],
  p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare
  v_replayed jsonb; v_code text := upper(btrim(coalesce(p_code, ''))); v_res jsonb;
  v_raw text; v_net cidr; v_list cidr[] := '{}'; v_site ops_hr.work_sites;
begin
  v_replayed := ops_core.idem_replay('hr','set_site_networks', p_key);
  if v_replayed is not null then return v_replayed; end if;

  if not (ops_core.has_permission('hrd.update') or ops_core.has_permission('it.update')) then
    return ops_core.refused('hr','work_site', v_code,'set_networks',
      'not_permitted','Jaringan kantor diatur oleh HRD atau IT.');
  end if;

  select * into v_site from ops_hr.work_sites where code = v_code;
  if not found then
    return ops_core.not_found('hr','work_site', v_code,'set_networks',
      format('Tidak ada lokasi %s.', v_code));
  end if;

  foreach v_raw in array coalesce(p_networks, '{}') loop
    continue when nullif(btrim(v_raw), '') is null;
    begin
      v_net := btrim(v_raw)::cidr;
    exception when others then
      return ops_core.invalid('hr','work_site', v_code,'set_networks',
        'bad_network', format('"%s" bukan alamat IP atau rentang (mis. 203.0.113.10 atau 203.0.113.0/29).', btrim(v_raw)),
        jsonb_build_object('field','networks','value', btrim(v_raw)));
    end;
    -- A phone's request never reaches Supabase from a private address, so a
    -- router's own LAN address would match nothing, silently.
    if v_net <<= '10.0.0.0/8' or v_net <<= '172.16.0.0/12' or v_net <<= '192.168.0.0/16'
       or v_net <<= '100.64.0.0/10' or v_net <<= '127.0.0.0/8' or v_net <<= 'fc00::/7' then
      return ops_core.invalid('hr','work_site', v_code,'set_networks',
        'private_network',
        format('%s adalah alamat jaringan lokal, bukan alamat internet kantor. Pakai tombol *Pakai jaringan saya sekarang* sambil tersambung ke Wi-Fi kantor.', v_net),
        jsonb_build_object('field','networks','value', v_net::text));
    end if;
    -- Wider than a /24 (or /48) is somebody's whole provider, not an office.
    if (family(v_net) = 4 and masklen(v_net) < 24) or (family(v_net) = 6 and masklen(v_net) < 48) then
      return ops_core.invalid('hr','work_site', v_code,'set_networks',
        'network_too_wide',
        format('%s terlalu luas — itu jaringan penyedia internet, bukan kantor. Paling luas /24.', v_net),
        jsonb_build_object('field','networks','value', v_net::text));
    end if;
    if not v_net = any (v_list) then v_list := v_list || v_net; end if;
  end loop;

  if cardinality(v_list) > 20 then
    return ops_core.invalid('hr','work_site', v_code,'set_networks',
      'too_many_networks','Paling banyak 20 alamat per lokasi.', jsonb_build_object('field','networks','max',20));
  end if;

  update ops_hr.work_sites
     set networks = v_list, updated_by = auth.uid(), updated_at = now()
   where id = v_site.id;

  v_res := ops_core.ok('hr','work_site', v_code,'set_networks',
    jsonb_build_object('code', v_code, 'networks', to_jsonb(array(select n::text from unnest(v_list) n))));
  return ops_core.idem_remember('hr','set_site_networks', p_key, v_res);
end $$;

revoke execute on function ops_hr.set_site_networks(text, text[], text) from public;
grant execute on function ops_hr.set_site_networks(text, text[], text) to authenticated;

/* ── 3. the trace, beside the tap ──────────────────────────────────────── */
create table ops_hr.scan_traces (
  scan_id            uuid primary key references ops_hr.attendance_scans(id),
  -- Read by the server (request_trace). Null when the request had no headers.
  ip                 inet,
  user_agent         text,
  session_id         text,
  -- Said by the phone. Evidence, not proof.
  device_id          text check (device_id ~ '^[A-Za-z0-9_-]{8,64}$'),
  device_at          timestamptz,
  app_build          text,
  -- The address against the sites' networks **at the tap**, kept, because a
  -- network list edited next month must not rewrite what this tap was. Null:
  -- no address, or no site names a network yet. The code, not an id: codes are
  -- fixed (0188), and a removed site must not take the reading with it.
  on_site_network    boolean,
  network_site_code  text,
  -- Every layer, raw: what the server read, and what the phone sent.
  request            jsonb not null default '{}'::jsonb,
  client             jsonb,
  recorded_at        timestamptz not null default now()
);

comment on table ops_hr.scan_traces is
  'Every layer a phone tap was seen with: address, user agent, session, device id, device clock, app build, '
  'office network. 1:1 with a self tap. Personal data: read like scan_locations. (0270, D431)';

create index scan_traces_device_idx on ops_hr.scan_traces (device_id) where device_id is not null;
create index scan_traces_ip_idx on ops_hr.scan_traces (ip) where ip is not null;

alter table ops_hr.scan_traces enable row level security;
-- The same reach as the location (0188): HRD reads all, a person their own.
create policy scan_traces_read on ops_hr.scan_traces for select to authenticated
  using (ops_core.has_permission('hrd.read')
         or exists (select 1 from ops_hr.attendance_scans s
                     where s.id = scan_id and s.employee_id = ops_hr.my_employee_id()));
grant select on ops_hr.scan_traces to authenticated;
-- No insert/update/delete policy: tap_self is the only writer, and a trace is
-- never edited.

analyze ops_hr.scan_traces;

/* ── 4. tap_self writes it ─────────────────────────────────────────────── */
drop function if exists ops_hr.tap_self(double precision, double precision, double precision, text, uuid, text, text);

create or replace function ops_hr.tap_self(
  p_lat double precision default null,
  p_lng double precision default null,
  p_accuracy_m double precision default null,
  p_note text default null,
  p_photo_id uuid default null,
  p_key text default null,
  p_kind text default null,
  p_client jsonb default null)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare
  v_replayed jsonb; v_emp uuid; v_emp_no text; v_id uuid; v_at timestamptz := now(); v_res jsonb;
  v_where jsonb; v_verdict text; v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_tap_no text; v_owner uuid; v_kind text := nullif(btrim(coalesce(p_kind, '')), '');
  v_req jsonb; v_client jsonb; v_ip inet; v_net record; v_device text; v_device_at timestamptz;
begin
  v_replayed := ops_core.idem_replay('hr','tap_self', p_key);
  if v_replayed is not null then return v_replayed; end if;

  v_emp := ops_hr.my_employee_id();
  if v_emp is null then
    return ops_core.refused('hr','attendance', null,'tap_self',
      'no_employee_link',
      'Akun ini belum tertaut ke data karyawan, jadi presensi tidak bisa dicatat sendiri. Minta HRD menautkannya.');
  end if;

  -- What the tap is, if it says (D369). Never refused for its order: the tap
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

  -- Leaving the office says where to (D369), with the same form and the same
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

  -- D431: every layer that was observable, beside the tap. The network layer
  -- is read here from the request, never from a parameter; what the phone says
  -- about itself is kept as it said it. Nothing below can refuse the tap: a
  -- layer that is missing or malformed is stored as missing.
  v_req := ops_core.request_trace();
  v_ip := (v_req ->> 'ip')::inet;
  v_client := case when jsonb_typeof(p_client) = 'object' then p_client end;
  if pg_column_size(v_client) > 4096 then
    v_client := jsonb_build_object('truncated', true, 'bytes', pg_column_size(p_client));
  end if;
  v_device := v_client ->> 'device_id';
  if v_device !~ '^[A-Za-z0-9_-]{8,64}$' then v_device := null; end if;
  begin
    v_device_at := (v_client ->> 'device_at')::timestamptz;
  exception when others then v_device_at := null;
  end;
  v_net := ops_hr.match_site_network(v_ip);

  insert into ops_hr.scan_traces
    (scan_id, ip, user_agent, session_id, device_id, device_at, app_build,
     on_site_network, network_site_code, request, client)
  values (v_id, v_ip, v_req ->> 'user_agent', v_req ->> 'session_id', v_device, v_device_at,
          left(v_client ->> 'app_build', 64), v_net.on_site, v_net.site_code, v_req, v_client);

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

revoke execute on function ops_hr.tap_self(double precision, double precision, double precision, text, uuid, text, text, jsonb) from public;
grant execute on function ops_hr.tap_self(double precision, double precision, double precision, text, uuid, text, text, jsonb) to authenticated;


/* ── 5. HRD's review reads it ──────────────────────────────────────────── */
-- 0211's columns unchanged and in order; the trace appended. `flagged` now
-- also says *one device, more than one person*.
create or replace view ops_hr.v_located_tap with (security_invoker = on) as
select l.tap_no,
       s.id           as scan_id,
       e.employee_no,
       e.full_name,
       e.unit,
       s.at,
       s.work_date,
       l.verdict,
       l.verdict in ('outside','uncertain','no_location') or coalesce(dp.n, 1) > 1 as flagged,
       l.lat, l.lng, l.accuracy_m, l.distance_m, l.radius_m,
       w.code         as site_code,
       w.name         as site_name,
       l.note,
       l.photo_id,
       a.web_view_link as photo_link,
       a.filename     as photo_filename,
       s.kind,
       host(t.ip)     as ip,
       t.user_agent,
       t.device_id,
       t.device_at,
       t.app_build,
       t.on_site_network,
       t.network_site_code,
       dp.n::int      as device_people,
       case when t.device_id is null then null
            else not exists (select 1 from ops_hr.scan_traces t2
                               join ops_hr.attendance_scans s2 on s2.id = t2.scan_id
                              where t2.device_id = t.device_id and s2.employee_id = s.employee_id
                                and s2.at < s.at) end as device_new
  from ops_hr.scan_locations l
  join ops_hr.attendance_scans s on s.id = l.scan_id
  join ops_hr.employees e on e.id = s.employee_id
  left join ops_hr.work_sites w on w.id = l.site_id
  left join ops_core.attachments a on a.id = l.photo_id
  left join ops_hr.scan_traces t on t.scan_id = l.scan_id
  left join lateral (
    select count(distinct s2.employee_id) as n
      from ops_hr.scan_traces t2
      join ops_hr.attendance_scans s2 on s2.id = t2.scan_id
     where t.device_id is not null and t2.device_id = t.device_id
       and s2.at between s.at - interval '30 days' and s.at + interval '30 days') dp on t.device_id is not null;

grant select on ops_hr.v_located_tap to authenticated;
