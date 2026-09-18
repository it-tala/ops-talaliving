-- core/activity — the monitoring record, its roll-up, and the two horizons.
--
-- What is proved here:
--
--   an agent that retries does not double-count a morning (`dedup_key`)
--   idle and locked time are counted apart from active time
--   `top_apps` has one entry per app, not one per interval
--   the roll-up is idempotent: running it twice is running it once
--   a late interval corrects its day rather than adding to it
--   somebody may read their own record and not anybody else's
--   purging is `it.purge_activity`, not `it.read` — looking and destroying
--     are different things
--   the recap is trimmed **per person by count**, so a month away does not
--     cost a month of history
--
-- The `top_apps` assertion is not decoration. The first version of the roll-up
-- aggregated over interval rows through a lateral join, which produced one
-- entry per interval rather than per app: `chrome.exe` seen fifty times was
-- fifty identical entries in the field whose entire purpose is "the five
-- things they were in".

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('aaaa1111-0000-0000-0000-000000000001','budi@talaliving.com','{"full_name":"Budi"}'),
  ('aaaa1111-0000-0000-0000-000000000002','sari@talaliving.com','{"full_name":"Sari"}'),
  ('aaaa1111-0000-0000-0000-00000000000f','fitri@talaliving.com','{"full_name":"Fitri IT"}');

-- Fitri administers; nobody else holds IT at all.
insert into ops_core.user_modules (user_id, module, level) values
  ('aaaa1111-0000-0000-0000-00000000000f','it','admin');

-- Two machines, one day. Budi is in Chrome twice and in Excel once — the
-- repeated app is the case the roll-up got wrong.
insert into ops_core.activity_intervals
  (user_id, device_id, exe, title, url, is_idle, is_locked, started_at, ended_at, duration_sec, dedup_key)
values
  ('aaaa1111-0000-0000-0000-000000000001','PC-01','chrome.exe','Tokopedia',
   'https://tokopedia.com/p/amplas', false,false,'2026-09-16 09:00+07','2026-09-16 09:30+07', 1800,'b-1'),
  ('aaaa1111-0000-0000-0000-000000000001','PC-01','excel.exe','anggaran.xlsx',
   null, false,false,'2026-09-16 09:30+07','2026-09-16 10:00+07', 1800,'b-2'),
  ('aaaa1111-0000-0000-0000-000000000001','PC-01','chrome.exe','Tokopedia keranjang',
   'https://tokopedia.com/cart', false,false,'2026-09-16 10:00+07','2026-09-16 10:45+07', 2700,'b-3'),
  ('aaaa1111-0000-0000-0000-000000000001','PC-01',null,null,null,
   true, false,'2026-09-16 10:45+07','2026-09-16 11:00+07',  900,'b-4'),
  ('aaaa1111-0000-0000-0000-000000000001','PC-01',null,null,null,
   false,true, '2026-09-16 12:00+07','2026-09-16 13:00+07', 3600,'b-5'),
  ('aaaa1111-0000-0000-0000-000000000002','PC-02','figma.exe','Kabinet',
   null, false,false,'2026-09-16 09:00+07','2026-09-16 11:00+07', 7200,'s-1');

-- Past the horizon, and a stack of recap rows to trim. Written here, as the
-- owner, because `authenticated` has no insert on these tables — the only way
-- in is `record_activity`, and that is the point of the next assertion but
-- makes a fixture from 200 days ago awkward to stage.
insert into ops_core.activity_intervals
  (user_id, device_id, exe, is_idle, is_locked, started_at, ended_at, duration_sec, dedup_key)
values ('aaaa1111-0000-0000-0000-000000000001','PC-01','chrome.exe', false,false,
        now() - interval '200 days', now() - interval '200 days' + interval '10 min', 600,'b-old');

insert into ops_core.activity_daily (user_id, day, active_sec)
select 'aaaa1111-0000-0000-0000-000000000001', d::date, 60
  from generate_series(date '2025-01-01', date '2025-06-30', interval '1 day') d
on conflict do nothing;

-- ── the agent retried ────────────────────────────────────────────────────
do $$
declare failed boolean := false;
begin
  begin
    insert into ops_core.activity_intervals
      (user_id, device_id, exe, is_idle, is_locked, started_at, ended_at, duration_sec, dedup_key)
    values ('aaaa1111-0000-0000-0000-000000000001','PC-01','chrome.exe',
            false,false,'2026-09-16 09:00+07','2026-09-16 09:30+07', 1800,'b-1');
  exception when unique_violation then failed := true;
  end;
  assert failed, 'the same interval twice must be refused — a double-counted morning is worse than a gap';
end $$;

set local role authenticated;

-- ── rolling up ───────────────────────────────────────────────────────────
set local request.jwt.claim.sub = 'aaaa1111-0000-0000-0000-00000000000f';
do $$
declare r jsonb; d ops_core.activity_daily; n int;
begin
  r := ops_core.roll_up_activity('2026-09-16','2026-09-16');
  assert r ->> 'outcome' = 'ok', format('got %s', r);

  select * into d from ops_core.activity_daily
   where user_id = 'aaaa1111-0000-0000-0000-000000000001' and day = '2026-09-16';

  -- 1800 + 1800 + 2700 active; 900 idle; 3600 locked. Counted apart, because
  -- "at the machine" and "working" are different claims.
  assert d.active_sec = 6300, format('active, saw %s', d.active_sec);
  assert d.idle_sec   =  900, format('idle, saw %s', d.idle_sec);
  assert d.locked_sec = 3600, format('locked, saw %s', d.locked_sec);
  assert d.interval_count = 5, format('intervals, saw %s', d.interval_count);
  assert d.distinct_apps = 2, format('chrome and excel, saw %s', d.distinct_apps);

  -- The one the first version got wrong: entries per app, not per interval.
  select jsonb_array_length(d.top_apps) into n;
  assert n = 2, format('one entry per app, not per interval — saw %s', n);
  assert d.top_apps -> 0 ->> 'exe' = 'chrome.exe', 'longest first';
  assert (d.top_apps -> 0 ->> 'sec')::int = 4500,
         format('and chrome''s two sittings are summed, saw %s', d.top_apps -> 0 ->> 'sec');

  -- The host, not the address.
  assert jsonb_array_length(d.top_domains) = 1, 'two tokopedia URLs are one domain';
  assert d.top_domains -> 0 ->> 'domain' = 'tokopedia.com',
         format('got %s', d.top_domains -> 0 ->> 'domain');
end $$;

-- ── running it twice, and a late interval ────────────────────────────────
do $$
declare r jsonb; before_rows int; after_rows int; d ops_core.activity_daily;
begin
  select count(*) into before_rows from ops_core.activity_daily where day = '2026-09-16';
  r := ops_core.roll_up_activity('2026-09-16','2026-09-16');
  select count(*) into after_rows from ops_core.activity_daily where day = '2026-09-16';
  assert before_rows = after_rows,
         format('rolling up twice must not add rows: %s then %s', before_rows, after_rows);

  -- The laptop that was shut at 18:00 uploads this morning — through the seam,
  -- the way the agent does. Budi's own session, so it lands under Budi.
  set local request.jwt.claim.sub = 'aaaa1111-0000-0000-0000-000000000001';
  r := ops_core.record_activity(jsonb_build_array(jsonb_build_object(
         'device_id','PC-01','exe','word.exe','is_idle',false,'is_locked',false,
         'started_at','2026-09-16 16:00+07','ended_at','2026-09-16 16:30+07',
         'duration_sec',1800,'dedup_key','b-late')));
  assert r ->> 'outcome' = 'ok', format('got %s', r);
  assert (r #>> '{data,recorded}')::int = 1, format('got %s', r);

  -- Sent again, as a retry. Already had it; nothing is double-counted.
  r := ops_core.record_activity(jsonb_build_array(jsonb_build_object(
         'device_id','PC-01','exe','word.exe','is_idle',false,'is_locked',false,
         'started_at','2026-09-16 16:00+07','ended_at','2026-09-16 16:30+07',
         'duration_sec',1800,'dedup_key','b-late')));
  assert (r #>> '{data,recorded}')::int = 0, format('a retry records nothing, got %s', r);
  assert (r #>> '{data,already_had}')::int = 1, format('and says so, got %s', r);

  set local request.jwt.claim.sub = 'aaaa1111-0000-0000-0000-00000000000f';

  r := ops_core.roll_up_activity('2026-09-16','2026-09-16');
  select * into d from ops_core.activity_daily
   where user_id = 'aaaa1111-0000-0000-0000-000000000001' and day = '2026-09-16';

  -- Corrected, not added to: 6300 + 1800, and three apps now.
  assert d.active_sec = 8100, format('a late interval corrects the day, saw %s', d.active_sec);
  assert d.distinct_apps = 3, format('saw %s', d.distinct_apps);
end $$;

-- ── a report cannot be filed in somebody else's name ─────────────────────
set local request.jwt.claim.sub = 'aaaa1111-0000-0000-0000-000000000002';
do $$
declare r jsonb; n int;
begin
  -- Sari's agent sends a row naming Budi. The seam ignores the name and
  -- records against whoever is signed in, which is Sari.
  r := ops_core.record_activity(jsonb_build_array(jsonb_build_object(
         'user_id','aaaa1111-0000-0000-0000-000000000001',
         'device_id','PC-02','exe','forged.exe','is_idle',false,'is_locked',false,
         'started_at','2026-09-16 14:00+07','ended_at','2026-09-16 14:10+07',
         'duration_sec',600,'dedup_key','forge-1')));
  assert r ->> 'outcome' = 'ok', format('got %s', r);

  select count(*) into n from ops_core.activity_intervals
   where dedup_key = 'forge-1' and user_id = 'aaaa1111-0000-0000-0000-000000000002';
  assert n = 1, 'the row belongs to whoever was signed in, not to the name in the payload';
end $$;

-- ── who may look ─────────────────────────────────────────────────────────
set local request.jwt.claim.sub = 'aaaa1111-0000-0000-0000-000000000001';
do $$
declare mine int; theirs int;
begin
  select count(*) into mine from ops_core.activity_intervals
   where user_id = 'aaaa1111-0000-0000-0000-000000000001';
  assert mine > 0, 'somebody must be able to see their own record — one they cannot inspect is one they cannot correct';

  select count(*) into theirs from ops_core.activity_intervals
   where user_id = 'aaaa1111-0000-0000-0000-000000000002';
  assert theirs = 0, format('and not a colleague''s, saw %s', theirs);
end $$;

-- ── purging is not reading ───────────────────────────────────────────────
do $$
declare r jsonb;
begin
  -- Budi holds no IT at all.
  r := ops_core.purge_activity();
  assert r #>> '{error,code}' = 'permission_required', format('got %s', r);
end $$;

set local request.jwt.claim.sub = 'aaaa1111-0000-0000-0000-00000000000f';
do $$
declare r jsonb; n int; oldest date;
begin
  select count(*) into n from ops_core.activity_daily
   where user_id = 'aaaa1111-0000-0000-0000-000000000001';
  assert n > 120, format('set up more than the horizon, saw %s', n);

  r := ops_core.purge_activity();
  assert r ->> 'outcome' = 'ok', format('got %s', r);
  assert (r #>> '{data,intervals_removed}')::int = 1,
         format('the 200-day-old interval goes, saw %s', r #>> '{data,intervals_removed}');

  -- Trimmed by count per person, not by date: exactly the horizon survives.
  select count(*) into n from ops_core.activity_daily
   where user_id = 'aaaa1111-0000-0000-0000-000000000001';
  assert n = 120, format('120 recap rows kept, saw %s', n);

  -- And the newest are the ones kept.
  select min(day) into oldest from ops_core.activity_daily
   where user_id = 'aaaa1111-0000-0000-0000-000000000001';
  assert oldest > date '2025-01-01', format('the oldest went first, oldest is now %s', oldest);

  -- Sari was never near the horizon and keeps everything she had.
  select count(*) into n from ops_core.activity_daily
   where user_id = 'aaaa1111-0000-0000-0000-000000000002';
  assert n = 1, format('a quiet colleague loses nothing, saw %s', n);
end $$;

-- ── the retention screen reads the policy and the data together ──────────
do $$
declare v record;
begin
  select * into v from ops_core.v_activity_retention;
  assert v.interval_days = 120, format('saw %s', v.interval_days);
  assert v.recap_days = 120, format('saw %s', v.recap_days);
  assert v.intervals_overdue = 0, 'nothing is overdue right after a purge';
  assert v.recap_rows > 0, 'and the recap is still there';
end $$;

rollback;
