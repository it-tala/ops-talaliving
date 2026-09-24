-- ops_core outbox delivery (`0126`) — a door that opens for the worker, for the
-- events the catalogue allows, while they are still news.
--
-- ── What this file is actually guarding ──────────────────────────────────
--
-- The outbox held 180 undelivered events for three days and nothing was wrong
-- with the outbox. What was missing was the decision about **which** events may
-- leave, and a deliverer with no such decision has two settings, both wrong:
-- send nothing, or send everything — and everything includes 26 rows of "who
-- can see what".
--
-- So the risks here are not "does the HTTP call work". They are:
--
--   a notification fires for an event nobody agreed to send
--   turning one rule on floods somebody's phone with last week
--   the record says an event went out when it did not
--   one bad event stops every later one
--
-- Each has an assertion below, and the last two are the ones that would be
-- believed for months if they were wrong, because both fail silently.

begin;

-- `occurred_at` is written explicitly throughout: every assertion here is about
-- age or ordering, and `now()` is the transaction's clock (F146), so a fixture
-- that leans on the default would be asserting against one instant.
insert into ops_core.outbox (service, event_type, entity_no, payload, occurred_at) values
  ('procurement','procurement.approval.requested','ask-smoke-1',
   '{"batch_no":"ask-smoke-1","to":"evin@talaliving.com"}', now() - interval '1 hour'),
  ('procurement','procurement.approval.requested','ask-smoke-2',
   '{"batch_no":"ask-smoke-2","to":"alika@talaliving.com"}', now() - interval '30 minutes'),
  -- Past its rule's two days: real, recorded, and no longer news.
  ('procurement','procurement.approval.requested','ask-smoke-stale',
   '{"batch_no":"ask-smoke-stale"}', now() - interval '9 days'),
  -- In the catalogue and deliberately not live.
  ('core','access.changed','user-smoke',
   '{"user":"somebody"}', now() - interval '5 minutes'),
  -- Not in the catalogue at all.
  ('procurement','procurement.vendor.merged','v-smoke',
   '{"code":"V-1"}', now() - interval '5 minutes');

/* ── 1. the catalogue decides, and today it says one thing ──────────────── */
--
-- This assertion is **meant to be edited**, by whoever turns the next rule on.
-- That is the point: "siapkan dulu saja" produced six rules that are off, and a
-- seventh going live should cost one line here as well as one line in a
-- migration. A guard that silently accepts a new live notification is a guard
-- that lets a channel fill up with things nobody chose.
do $$
declare live text; n int;
begin
  select count(*), string_agg(event_type, ', ' order by event_type)
    into n, live
    from ops_core.delivery_rules where is_live;

  assert n = 1 and live = 'procurement.approval.requested',
    n || ' rule(s) are live: ' || coalesce(live, '(none)')
    || '. The owner asked for exactly one — leadership being asked to decide a PR — and '
    || 'everything else prepared but off. Turning one on is a decision to write down here too.';

  -- Off is a decision, so it carries its reason. A blank note is a rule
  -- somebody added without saying why, and in six months nobody can tell
  -- whether it is off on purpose.
  assert not exists (select 1 from ops_core.delivery_rules where btrim(note) = ''),
    'every delivery rule has to say why it is on or off';
end $$;

/* ── 2. what the worker is offered ──────────────────────────────────────── */
do $$
declare got text; n int;
begin
  -- No `order by` in the aggregate, deliberately: this reads the order the
  -- function emitted, so one assertion covers both *which* events are due and
  -- *in what order*. Oldest first matters — an approval sent an hour ago is
  -- more overdue than one sent thirty minutes ago, and a deliverer that sends
  -- newest-first makes people answer the wrong one.
  select count(*), string_agg(entity_no, ', ')
    into n, got
    from ops_core.outbox_due(50);

  assert n = 2 and got = 'ask-smoke-1, ask-smoke-2',
    'expected the two fresh approval requests, oldest first, and nothing else — got '
    || n || ': ' || coalesce(got, '(none)')
    || '. A rule that is off, a rule that is absent, and an event past its age must all '
    || 'stay put; the outbox keeps the record either way.';
end $$;

/* ── 3. claiming counts an attempt, so nothing can loop forever ─────────── */
do $$
declare a int;
begin
  select attempts into a from ops_core.outbox where entity_no = 'ask-smoke-1';
  assert a = 1, format('one claim, one attempt, got %s', a);

  perform ops_core.outbox_due(50);
  select attempts into a from ops_core.outbox where entity_no = 'ask-smoke-1';
  assert a = 2, format('a second claim counts again, got %s', a);

  -- The ceiling. A row that kills the deliverer has to stop being offered on
  -- its own, or one poisonous event costs every later notification.
  update ops_core.outbox set attempts = 5, last_error = 'chat said no'
   where entity_no = 'ask-smoke-1';

  assert not exists (select 1 from ops_core.outbox_due(50) d
                      where d.entity_no = 'ask-smoke-1'),
    'five attempts is a ceiling — the row stays here with last_error for somebody to read, '
    || 'it does not keep being retried';
end $$;

/* ── 4. the record is true, which is the whole point of the outbox ──────── */
do $$
declare
  v_id bigint; res jsonb; first_at timestamptz;
begin
  select id into v_id from ops_core.outbox where entity_no = 'ask-smoke-2';

  res := ops_core.outbox_delivered(v_id, 'spaces/AAA/messages/BBB');
  assert (res ->> 'outcome') = 'ok', format('got %s', res);
  select delivered_at into first_at from ops_core.outbox where id = v_id;
  assert first_at is not null, 'delivered means a timestamp';

  -- A second ack for the same row must NOT move the timestamp. At-least-once
  -- delivery means duplicate acks are normal, and a record that drifts forward
  -- on each one stops saying when the thing actually went out.
  perform pg_sleep(0.01);
  res := ops_core.outbox_delivered(v_id, 'spaces/AAA/messages/CCC');
  assert (res ->> 'outcome') = 'ok', format('got %s', res);
  assert (res -> 'data' ->> 'already_delivered')::boolean, format('got %s', res);
  assert (select delivered_at from ops_core.outbox where id = v_id) = first_at,
    'the second ack moved delivered_at; the outbox now lies about when this went out';

  -- And a delivered event is not offered again.
  assert not exists (select 1 from ops_core.outbox_due(50) d where d.id = v_id),
    'a delivered event must not come back round';

  -- Failing something already delivered is a bug in the caller, not a state to
  -- accept quietly: accepting it would let a late failure erase a real success.
  res := ops_core.outbox_failed(v_id, 'timeout');
  assert (res -> 'error' ->> 'code') = 'unknown_event', format('got %s', res);
  assert (select delivered_at from ops_core.outbox where id = v_id) = first_at,
    'a refused failure must not touch the row';
end $$;

/* ── 5. a failure has to say why ────────────────────────────────────────── */
do $$
declare v_id bigint; res jsonb;
begin
  select id into v_id from ops_core.outbox where entity_no = 'ask-smoke-stale';

  res := ops_core.outbox_failed(v_id, '   ');
  assert (res -> 'error' ->> 'code') = 'reason_required', format('got %s', res);
  assert (select last_error from ops_core.outbox where id = v_id) is null,
    'a refused failure writes nothing';

  res := ops_core.outbox_failed(v_id, 'chat api 403: bot not in space');
  assert (res ->> 'outcome') = 'ok', format('got %s', res);
  assert (select last_error from ops_core.outbox where id = v_id)
         = 'chat api 403: bot not in space', 'the reason is kept verbatim';

  res := ops_core.outbox_failed(999999999, 'nope');
  assert (res -> 'error' ->> 'code') = 'unknown_event', format('got %s', res);

  res := ops_core.outbox_delivered(999999999);
  assert (res -> 'error' ->> 'code') = 'unknown_event', format('got %s', res);
end $$;

/* ── 6. turning a rule on does not flush the backlog ────────────────────── */
--
-- The failure this prevents is the one that would end the experiment: somebody
-- switches on `accounting.inbox.resolved`, and thirty-eight decisions from the
-- last three days arrive at once. `max_age` is what makes a rule safe to turn
-- on in the middle of a Tuesday.
do $$
declare n int;
begin
  update ops_core.delivery_rules set is_live = true
   where event_type = 'access.changed';

  select count(*) into n from ops_core.outbox_due(50);
  assert n = 1, format('only the five-minute-old access event becomes due, got %s', n);

  update ops_core.delivery_rules set max_age = interval '1 minute'
   where event_type = 'access.changed';
  select count(*) into n from ops_core.outbox_due(50);
  assert n = 0, format('shortening the window closes it immediately, got %s', n);
end $$;

rollback;
