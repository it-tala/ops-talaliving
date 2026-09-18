-- core/activity-log — what a person was shown, its recap, and the purge that
-- refuses to destroy a day nobody summarised.
--
-- This is the trail `/it/aktivitas` reads, and it is not `10`'s. That one is
-- what the machines report — `exe`, window title, idle. This one is what the
-- application was asked to do: a screen opened, a payslip printed, an identity
-- number revealed. The two share a word and nothing else, and proving them in
-- one file would have hidden exactly that.
--
-- What is proved here:
--
--   an event is recorded against whoever is signed in, never against a name
--     in the payload
--   an unsigned caller is refused, and a blank kind or target is invalid
--   the recap counts `changes` and `refusals` from the **audit log**, not from
--     here, so the two trails cannot disagree
--   `reveals` comes from here, because a reveal changes nothing and the audit
--     log never sees it
--   `top_screens` has one entry per screen, not one per visit — `10` found
--     that bug in the other roll-up and it is the same shape of mistake
--   rolling up twice is rolling up once, and a late event corrects its day
--   a day with nothing on it answers `nothing_to_roll`, never `ok` with zero
--   the two reading views carry the name the screen prints, and are
--     `security_invoker` — a view is not a way past the policy
--   **nobody reads their own**, unlike `10` — this trail is IT's and
--     leadership's, and that difference is deliberate (D190)
--   rolling up is `it.update`, purging is `it.purge_activity`, and reading is
--     neither
--   the purge **skips a day with no recap** and names it, rather than
--     reporting a clean sweep that quietly lost a fortnight (D189)
--   the recap is trimmed per person by count, so a quiet colleague loses
--     nothing

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('bbbb2222-0000-0000-0000-000000000001','budi@talaliving.com','{"full_name":"Budi"}'),
  ('bbbb2222-0000-0000-0000-000000000002','sari@talaliving.com','{"full_name":"Sari"}'),
  ('bbbb2222-0000-0000-0000-00000000000f','fitri@talaliving.com','{"full_name":"Fitri IT"}');

-- Fitri administers IT. Budi holds procurement, so he can act — and therefore
-- write audit rows — without being able to read this trail at all.
insert into ops_core.user_modules (user_id, module, level) values
  ('bbbb2222-0000-0000-0000-00000000000f','it','admin'),
  ('bbbb2222-0000-0000-0000-000000000001','procurement','write');

set local role authenticated;

-- ── recording ────────────────────────────────────────────────────────────
set local request.jwt.claim.sub = 'bbbb2222-0000-0000-0000-000000000001';
do $$
declare r jsonb; n int;
begin
  r := ops_core.record_activity_event('view','/procurement/tracker','Pelacakan');
  assert r ->> 'outcome' = 'ok', format('got %s', r);
  assert (r #>> '{data,event_id}') is not null, format('it says which row, got %s', r);

  -- Blank is not an act.
  r := ops_core.record_activity_event('view','   ','Kosong');
  assert r #>> '{error,code}' = 'kind_and_target_required', format('got %s', r);

  -- The label falls back to the target rather than to nothing: a recap that
  -- prints an empty string is a recap nobody can read. Checked below rather
  -- than here, because Budi may not read this trail at all — which is itself
  -- the point, and is asserted on its own further down.
  r := ops_core.record_activity_event('view','/accounting/tagihan','');
  assert r ->> 'outcome' = 'ok', format('got %s', r);
end $$;

set local request.jwt.claim.sub = 'bbbb2222-0000-0000-0000-00000000000f';
do $$
declare n int;
begin
  select count(*) into n from ops_core.activity_events
   where target = '/accounting/tagihan' and label = '/accounting/tagihan';
  assert n = 1, format('a blank label falls back to the target, saw %s', n);
end $$;

-- ── a signed-out caller ──────────────────────────────────────────────────
reset request.jwt.claim.sub;
do $$
declare r jsonb;
begin
  r := ops_core.record_activity_event('view','/dashboard','Dasbor');
  assert r #>> '{error,code}' = 'not_signed_in', format('got %s', r);
end $$;

-- ── the day itself ───────────────────────────────────────────────────────
-- Staged as the owner: `authenticated` has no insert on this table, and the
-- seam stamps `now()`, so a yesterday cannot be made through it.
reset role;
insert into ops_core.activity_events (at, actor_id, kind, target, label) values
  ('2026-09-16 09:00+07','bbbb2222-0000-0000-0000-000000000001','view','/procurement/tracker','Pelacakan'),
  ('2026-09-16 09:20+07','bbbb2222-0000-0000-0000-000000000001','view','/procurement/tracker','Pelacakan'),
  ('2026-09-16 09:40+07','bbbb2222-0000-0000-0000-000000000001','view','/procurement/tracker','Pelacakan'),
  ('2026-09-16 10:00+07','bbbb2222-0000-0000-0000-000000000001','view','/accounting/tagihan','Tagihan'),
  ('2026-09-16 11:00+07','bbbb2222-0000-0000-0000-000000000001','print','/hrd/payroll/pyr-1','Slip gaji'),
  ('2026-09-16 11:30+07','bbbb2222-0000-0000-0000-000000000001','reveal','/hrd/karyawan/emp-1','NIK Budi'),
  ('2026-09-16 11:40+07','bbbb2222-0000-0000-0000-000000000001','reveal','/hrd/karyawan/emp-2','NIK Sari'),
  ('2026-09-16 09:00+07','bbbb2222-0000-0000-0000-000000000002','view','/dashboard','Dasbor');

-- Two writes and a refusal, in the audit log where they belong. The recap must
-- read them from there; counting them here would be a second number.
insert into ops_core.audit_log (at, actor_id, service, entity, action, outcome) values
  ('2026-09-16 09:10+07','bbbb2222-0000-0000-0000-000000000001','procurement','pr','create','ok'),
  ('2026-09-16 09:50+07','bbbb2222-0000-0000-0000-000000000001','procurement','pr','approve','ok'),
  ('2026-09-16 10:10+07','bbbb2222-0000-0000-0000-000000000001','accounting','payment','post','refused');

set local role authenticated;

-- ── rolling up is a write ────────────────────────────────────────────────
set local request.jwt.claim.sub = 'bbbb2222-0000-0000-0000-000000000001';
do $$
declare r jsonb;
begin
  r := ops_core.roll_up_activity_log('2026-09-16','2026-09-16');
  assert r #>> '{error,code}' = 'permission_required', format('got %s', r);
end $$;

set local request.jwt.claim.sub = 'bbbb2222-0000-0000-0000-00000000000f';
do $$
declare r jsonb; c ops_core.activity_recap;
begin
  r := ops_core.roll_up_activity_log('2026-09-16','2026-09-16');
  assert r ->> 'outcome' = 'ok', format('got %s', r);

  select * into c from ops_core.activity_recap
   where actor_id = 'bbbb2222-0000-0000-0000-000000000001' and day = '2026-09-16';

  assert c.events = 7, format('seven acts, saw %s', c.events);
  assert c.first_at = '2026-09-16 09:00+07', format('got %s', c.first_at);
  assert c.last_at  = '2026-09-16 11:40+07', format('got %s', c.last_at);

  -- From the audit log, not from the events above.
  assert c.changes  = 2, format('two writes, saw %s', c.changes);
  assert c.refusals = 1, format('one refusal, saw %s', c.refusals);

  -- From here, because the audit log never sees a reveal.
  assert c.reveals = 2, format('two reveals, saw %s', c.reveals);

  -- One entry per screen, not one per visit — `10` found this exact bug in the
  -- other roll-up, through a lateral join that counted intervals.
  assert jsonb_array_length(c.top_screens) = 5,
         format('five distinct screens, saw %s in %s', jsonb_array_length(c.top_screens), c.top_screens);
  assert c.top_screens -> 0 ->> 'label' = 'Pelacakan', format('most-used first, got %s', c.top_screens);
  assert (c.top_screens -> 0 ->> 'count')::int = 3,
         format('and its three visits are summed, got %s', c.top_screens -> 0);

  -- Sari did one thing and wrote nothing.
  select * into c from ops_core.activity_recap
   where actor_id = 'bbbb2222-0000-0000-0000-000000000002' and day = '2026-09-16';
  assert c.events = 1 and c.changes = 0 and c.refusals = 0 and c.reveals = 0,
         format('got %s', to_jsonb(c));
end $$;

-- ── twice is once, and a late event corrects the day ─────────────────────
do $$
declare r jsonb; before_rows int; after_rows int; c ops_core.activity_recap;
begin
  select count(*) into before_rows from ops_core.activity_recap where day = '2026-09-16';
  r := ops_core.roll_up_activity_log('2026-09-16','2026-09-16');
  select count(*) into after_rows from ops_core.activity_recap where day = '2026-09-16';
  assert before_rows = after_rows,
         format('rolling up twice must not add rows: %s then %s', before_rows, after_rows);

  select * into c from ops_core.activity_recap
   where actor_id = 'bbbb2222-0000-0000-0000-000000000001' and day = '2026-09-16';
  assert c.events = 7, format('nor double a figure, saw %s', c.events);
end $$;

reset role;
insert into ops_core.activity_events (at, actor_id, kind, target, label) values
  ('2026-09-16 16:00+07','bbbb2222-0000-0000-0000-000000000001','export','/accounting/tagihan','Tagihan');
set local role authenticated;
set local request.jwt.claim.sub = 'bbbb2222-0000-0000-0000-00000000000f';

do $$
declare r jsonb; c ops_core.activity_recap;
begin
  r := ops_core.roll_up_activity_log('2026-09-16','2026-09-16');
  select * into c from ops_core.activity_recap
   where actor_id = 'bbbb2222-0000-0000-0000-000000000001' and day = '2026-09-16';
  assert c.events = 8, format('a late event corrects its day, saw %s', c.events);
  assert c.last_at = '2026-09-16 16:00+07', format('and moves the last, got %s', c.last_at);
end $$;

-- ── a range that ends before it begins ───────────────────────────────────
do $$
declare r jsonb;
begin
  r := ops_core.roll_up_activity_log('2026-09-16','2026-09-01');
  assert r #>> '{error,code}' = 'range_backwards', format('got %s', r);
end $$;

-- ── a day nobody worked ──────────────────────────────────────────────────
-- Not `ok` with zero. The screen reads `data.written`, so an `ok` with no data
-- is the outcome that throws — and *0 orang direkap* printed green is how a
-- recorder that stopped a fortnight ago goes unnoticed.
do $$
declare r jsonb;
begin
  r := ops_core.roll_up_activity_log('2026-01-05','2026-01-05');
  assert r #>> '{error,code}' = 'nothing_to_roll', format('got %s', r);
end $$;

-- ── the shape the screen reads ───────────────────────────────────────────
do $$
declare r jsonb; v record;
begin
  r := ops_core.roll_up_activity_log('2026-09-16');
  assert r ->> 'outcome' = 'ok', format('got %s', r);
  -- `p_to` defaults to `p_from`: the ordinary call is one day.
  assert r #>> '{data,day}' = '2026-09-16', format('got %s', r);
  assert r #>> '{data,to}'  = '2026-09-16', format('got %s', r);
  assert (r #>> '{data,written}')::int = 2, format('two people, saw %s', r);

  -- The views carry the name the screen prints; the tables carry only the id,
  -- because a name copied onto every row goes stale the day somebody marries.
  select * into v from ops_core.v_activity_recap
   where actor_id = 'bbbb2222-0000-0000-0000-000000000001' and day = '2026-09-16';
  assert v.actor_email = 'budi@talaliving.com', format('got %s', v.actor_email);
  assert v.full_name = 'Budi', format('got %s', v.full_name);

  select * into v from ops_core.v_activity_event
   where target = '/hrd/karyawan/emp-1' limit 1;
  assert v.actor_email = 'budi@talaliving.com', format('got %s', v.actor_email);
  assert v.kind = 'reveal', format('got %s', v.kind);
end $$;

-- The views are `security_invoker`, so they are the policy and not a way past
-- it — the failure that would hand the whole trail to anybody who could name
-- a view.
set local request.jwt.claim.sub = 'bbbb2222-0000-0000-0000-000000000001';
do $$
declare n int;
begin
  select count(*) into n from ops_core.v_activity_event;
  assert n = 0, format('a view is not a back door, saw %s', n);
  select count(*) into n from ops_core.v_activity_recap;
  assert n = 0, format('nor the recap view, saw %s', n);
end $$;
set local request.jwt.claim.sub = 'bbbb2222-0000-0000-0000-00000000000f';

-- ── who may look: not the person themselves ──────────────────────────────
-- The difference from `10` is on purpose. There, somebody may read their own
-- record, because a record they cannot inspect is one they cannot correct.
-- Here they may not: this trail exists to be read by IT and leadership, and a
-- person who can see exactly what was logged about them knows what was not.
set local request.jwt.claim.sub = 'bbbb2222-0000-0000-0000-000000000001';
do $$
declare mine int; recaps int;
begin
  select count(*) into mine from ops_core.activity_events
   where actor_id = 'bbbb2222-0000-0000-0000-000000000001';
  assert mine = 0, format('not even their own, saw %s', mine);

  select count(*) into recaps from ops_core.activity_recap;
  assert recaps = 0, format('nor the recap, saw %s', recaps);
end $$;

set local request.jwt.claim.sub = 'bbbb2222-0000-0000-0000-00000000000f';
do $$
declare n int;
begin
  select count(*) into n from ops_core.activity_events;
  assert n > 0, 'IT reads everybody''s';
end $$;

-- ── purging is not reading, and not rolling up ───────────────────────────
set local request.jwt.claim.sub = 'bbbb2222-0000-0000-0000-000000000001';
do $$
declare r jsonb;
begin
  r := ops_core.purge_activity_log();
  assert r #>> '{error,code}' = 'permission_required', format('got %s', r);
end $$;

-- Two expired days. One was rolled up; the other never was, and must survive.
reset role;
insert into ops_core.activity_events (at, actor_id, kind, target, label) values
  (now() - interval '200 days','bbbb2222-0000-0000-0000-000000000001','view','/dashboard','Dasbor'),
  (now() - interval '200 days','bbbb2222-0000-0000-0000-000000000001','view','/dashboard','Dasbor'),
  (now() - interval '190 days','bbbb2222-0000-0000-0000-000000000001','view','/dashboard','Dasbor');

-- A stack of recap rows to trim, for Budi only.
insert into ops_core.activity_recap (day, actor_id, events)
select d::date, 'bbbb2222-0000-0000-0000-000000000001', 1
  from generate_series(date '2025-01-01', date '2025-06-30', interval '1 day') d
on conflict do nothing;

set local role authenticated;
set local request.jwt.claim.sub = 'bbbb2222-0000-0000-0000-00000000000f';

do $$
declare r jsonb; unrolled int; kept_day date;
begin
  -- Roll up the 200-day-old day and leave the 190-day-old one alone.
  kept_day := ops_core.office_day(now() - interval '190 days');
  r := ops_core.roll_up_activity_log(
         ops_core.office_day(now() - interval '200 days'),
         ops_core.office_day(now() - interval '200 days'));
  assert r ->> 'outcome' = 'ok', format('got %s', r);

  select days_unrolled into unrolled from ops_core.v_activity_log_retention;
  assert unrolled > 0, 'the retention panel counts the day that has detail and no recap';
end $$;

do $$
declare r jsonb; n int; blocked jsonb; oldest date;
begin
  r := ops_core.purge_activity_log();
  assert r ->> 'outcome' = 'ok', format('got %s', r);

  -- The rolled-up day's two events go; the unrolled day's one stays.
  assert (r #>> '{data,events_removed}')::int = 2,
         format('two expired events with a recap behind them, saw %s', r #>> '{data,events_removed}');

  blocked := r #> '{data,blocked_days}';
  assert jsonb_array_length(blocked) = 1,
         format('one day is named as skipped, got %s', blocked);

  select count(*) into n from ops_core.activity_events
   where at < now() - interval '150 days';
  assert n = 1, format('and it is still here — D189 refuses to destroy an unsummarised day, saw %s', n);

  -- Trimmed per person by count: exactly the horizon survives, newest first.
  select count(*) into n from ops_core.activity_recap
   where actor_id = 'bbbb2222-0000-0000-0000-000000000001';
  assert n = 120, format('120 recap rows kept, saw %s', n);

  select min(day) into oldest from ops_core.activity_recap
   where actor_id = 'bbbb2222-0000-0000-0000-000000000001';
  assert oldest > date '2025-01-01', format('the oldest went first, oldest is now %s', oldest);

  -- Sari was never near the horizon.
  select count(*) into n from ops_core.activity_recap
   where actor_id = 'bbbb2222-0000-0000-0000-000000000002';
  assert n = 1, format('a quiet colleague loses nothing, saw %s', n);
end $$;

rollback;
