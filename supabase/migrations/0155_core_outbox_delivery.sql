-- 0155_core_outbox_delivery.sql — the outbox gets a door out, and a list of
-- what is allowed through it.
--
-- ── Why 180 events have never left the building ──────────────────────────
--
-- `ops_core.outbox` has been the third-party seam since `0003` (ADR-008): a
-- money seam never calls Google, it writes a row here and something else
-- carries it. That something else was never written. As of 2026-09-24 the table
-- holds 180 rows, every one of them undelivered, across nine event types.
--
-- The missing piece was never the HTTP call. It was the sentence nobody had
-- written down: **which events may reach a chat channel at all.** Without it a
-- deliverer has two settings, both wrong — send nothing, or send everything,
-- and everything includes `access.changed` (26 rows, who can see what) and
-- `procurement.vendor.merged` (33 rows of housekeeping nobody wants pinged
-- about). A notification channel is trusted exactly as long as everything in it
-- was worth reading.
--
-- So delivery is a **catalogue**, the same shape as the permission catalogue
-- (D218): a row has to exist before an event can go anywhere, and `is_live`
-- decides whether it does. Nothing is delivered by default, including events
-- that do not appear here at all.
--
-- ── One live rule, by instruction ────────────────────────────────────────
--
-- Owner, 2026-09-24: *kirim notifikasi ke google chat dari web app hanya untuk
-- konfirmasi approve PR dari pimpinan. selain itu gunakan notifikasi hanya untuk
-- yang penting … (saya belum tentukan, siapkan dulu saja).*
--
-- So `procurement.approval.requested` goes live and everything else is seeded
-- off, with the reason written next to it. Turning one on later is a one-line
-- migration — deliberate, reviewed, and recorded in the ladder, which is what
-- "yang penting" deserves. It is not a toggle table anybody can flip, because a
-- channel people mute is worse than a channel that is quiet.
--
-- ── Two of the owner's own examples cannot be built yet, and that is the ──
-- ── useful thing this migration found ────────────────────────────────────
--
-- *"notifikasi ke user ada yang belum absen"* — there is no event. Absence is
-- the **absence** of an event, so nothing is emitted when somebody fails to
-- clock in. It needs a scheduled check that emits, not a delivery rule; a rule
-- here would wait forever for a row that is never written.
--
-- *"perubahan rate gaji"* — there is no event either. `payroll.approved` and
-- `overtime.approved` exist; a pay-rate change emits nothing.
--
-- *"perubahan data PO yang sudah issued"* — the event exists
-- (`procurement.po.amended`) but **its payload does not say whether the PO was
-- issued**. Both emitters (`0016`, `0033`) bump `revision` only when
-- `status = 'ISSUED'` and then emit the same event either way, carrying
-- `po_no`, `line_no`, `from` and `to`. Delivering it today would ping the
-- channel for edits to drafts nobody has seen — which is how the second
-- notification gets ignored. The emitters have to carry the status first.
--
-- A delivery rule cannot deliver an event nobody emits. Naming that here is
-- cheaper than three rules that look configured and never fire.

create table ops_core.delivery_rules (
  event_type text primary key,
  channel    text    not null default 'chat',
  -- Off is the default and the safe answer: a rule that exists but is not live
  -- is a decision somebody has thought about and declined, which is worth more
  -- than an absent row (that is merely a gap).
  is_live    boolean not null default false,
  -- A notification is only useful while it is news. Anything older than this is
  -- left in the outbox undelivered — the record stays complete, the channel
  -- does not get a Tuesday alert on Friday. This is what stops turning a rule
  -- on from flushing a backlog into somebody's phone.
  max_age    interval not null default interval '1 day',
  note       text    not null,
  changed_at timestamptz not null default now()
);

comment on table ops_core.delivery_rules is
  'Which outbox events may reach which channel, and whether they currently do. '
  'No row means never delivered; is_live false means deliberately not delivered.';

alter table ops_core.delivery_rules enable row level security;

-- Readable by anybody signed in: knowing which notifications exist is not a
-- secret, and a screen that cannot say "this one is switched off" leaves people
-- guessing why nothing arrived. Writable by nobody — changing it is a migration.
create policy delivery_rules_read on ops_core.delivery_rules
  for select to authenticated using (true);

grant select on ops_core.delivery_rules to authenticated;

insert into ops_core.delivery_rules (event_type, channel, is_live, max_age, note) values
  ('procurement.approval.requested', 'chat', true, interval '2 days',
   'Live, by instruction: leadership is asked to decide a list of PR lines. The batch already '
   'carries an unguessable token for the card to answer with (0017), so this is the one event '
   'whose whole purpose is to reach a person somewhere other than the web app. Two days, not '
   'one: a request sent on Friday evening is still worth delivering on Saturday.'),

  ('accounting.inbox.resolved', 'chat', false, interval '1 day',
   'Candidate. Closes the loop to whoever photographed the nota — booked, or rejected and why. '
   'Off until the owner asks: 38 rows are waiting and the first run would send all of the last '
   'day of them at once.'),

  ('accounting.transaction.voided', 'chat', false, interval '1 day',
   'Candidate, and the strongest one nobody has asked for: money already in the books being '
   'unwound is exactly the kind of thing that should not be discoverable only by opening a screen.'),

  ('procurement.po.amended', 'chat', false, interval '1 day',
   'Asked for as "perubahan data PO yang sudah issued" and NOT buildable yet: the payload does '
   'not say whether the PO was issued, so this would also fire for drafts. Fix the emitters in '
   '0016 and 0033 to carry the status before turning this on.'),

  ('procurement.po.issued', 'chat', false, interval '1 day',
   'Candidate. A PO going to a vendor is a commitment leaving the company.'),

  ('payroll.approved', 'chat', false, interval '1 day',
   'Candidate. The nearest existing event to the owner''s "perubahan rate gaji", which has no '
   'event of its own — approving a run is not the same as changing somebody''s rate.'),

  ('access.changed', 'chat', false, interval '1 day',
   'Deliberately off, and worth keeping off: 26 rows in three days. Who can see what is a '
   'security record, and a channel that carries it teaches people to scroll past it.');

-- ── The door ──────────────────────────────────────────────────────────────
--
-- Three verbs, and the worker gets all three and nothing else. It claims, then
-- it says what happened. Claiming counts an attempt whether or not the send
-- works, because a row that kills the deliverer has to stop being offered on
-- its own — at-least-once with a ceiling, not at-least-once forever.

create or replace function ops_core.outbox_due(
  p_limit int default 20, p_channel text default 'chat')
returns table (id bigint, service text, event_type text, entity_no text,
               payload jsonb, occurred_at timestamptz, attempts int)
language sql volatile security definer set search_path = ops_core, pg_temp as $$
  with picked as (
    select o.id
      from ops_core.outbox o
      join ops_core.delivery_rules r on r.event_type = o.event_type
     where o.delivered_at is null
       and r.is_live
       and r.channel = p_channel
       -- News, not history. See `max_age` on the catalogue.
       and o.occurred_at >= now() - r.max_age
       -- Five is a ceiling, not a retry policy: after five the row stays here
       -- with `last_error` saying why, for somebody to read.
       and o.attempts < 5
     order by o.occurred_at
     limit greatest(1, least(coalesce(p_limit, 20), 100))
     -- Two deliverers running at once must not both send the same card, and
     -- neither should wait for the other.
     for update of o skip locked
  )
  update ops_core.outbox o
     set attempts = o.attempts + 1
    from picked p
   where o.id = p.id
  returning o.id, o.service, o.event_type, o.entity_no, o.payload,
            o.occurred_at, o.attempts;
$$;

comment on function ops_core.outbox_due(int, text) is
  'Claim up to p_limit undelivered events whose type is live for this channel. '
  'Counts an attempt on claim, skips rows past five attempts, and never returns '
  'an event older than its rule allows.';

create or replace function ops_core.outbox_delivered(
  p_id bigint, p_ref text default null)
returns jsonb language plpgsql volatile security definer
set search_path = ops_core, pg_temp as $$
declare n int;
begin
  -- `delivered_at is null` in the predicate, not just the id: a second ack for
  -- the same row must not move the timestamp, or the record stops saying when
  -- the thing actually went out.
  update ops_core.outbox
     set delivered_at = now(),
         last_error = null
   where id = p_id and delivered_at is null;
  get diagnostics n = row_count;

  if n = 0 then
    if exists (select 1 from ops_core.outbox where id = p_id) then
      return ops_core.ok('core','outbox', p_id::text,'delivered',
        jsonb_build_object('id', p_id, 'already_delivered', true));
    end if;
    return ops_core.invalid('core','outbox', p_id::text,'delivered',
      'unknown_event', format('No outbox row %s.', p_id),
      jsonb_build_object('field','id','value',p_id));
  end if;

  return ops_core.ok('core','outbox', p_id::text,'delivered',
    jsonb_build_object('id', p_id, 'ref', nullif(btrim(coalesce(p_ref,'')), '')));
end $$;

create or replace function ops_core.outbox_failed(p_id bigint, p_error text)
returns jsonb language plpgsql volatile security definer
set search_path = ops_core, pg_temp as $$
declare n int;
begin
  if coalesce(btrim(p_error), '') = '' then
    -- A failure with no reason is the failure this column exists to prevent.
    return ops_core.invalid('core','outbox', p_id::text,'failed',
      'reason_required',
      'Say what went wrong. A retry loop that cannot say why it failed is one nobody can fix.',
      jsonb_build_object('field','error'));
  end if;

  update ops_core.outbox
     set last_error = left(btrim(p_error), 2000)
   where id = p_id and delivered_at is null;
  get diagnostics n = row_count;

  if n = 0 then
    return ops_core.invalid('core','outbox', p_id::text,'failed',
      'unknown_event',
      format('No undelivered outbox row %s — it is delivered, or it does not exist.', p_id),
      jsonb_build_object('field','id','value',p_id));
  end if;

  return ops_core.ok('core','outbox', p_id::text,'failed',
    jsonb_build_object('id', p_id));
end $$;

-- ── The grant, written down rather than added in passing ──────────────────
--
-- `0038` said the worker's entire reach is one verb and `A2` has been asserting
-- it since. `0143` made it three; this makes it six, and the sentence has to
-- change with it: the worker may **file a document it captured**, **answer a PO
-- approval card** and **carry an event it did not choose**.
-- Every one of the six takes validated arguments and none of them can read a
-- table — `service_role` still has no table privilege anywhere in `ops_*`, and
-- `A2` still asserts that, which is the half of the claim that matters most
-- because that role carries `rolbypassrls`.
--
-- `outbox_due` cannot be pointed at an event type the catalogue has not made
-- live, so widening the worker's reach did not widen what it can say.

revoke execute on function ops_core.outbox_due(int, text) from public;
revoke execute on function ops_core.outbox_delivered(bigint, text) from public;
revoke execute on function ops_core.outbox_failed(bigint, text) from public;

grant execute on function ops_core.outbox_due(int, text)            to service_role;
grant execute on function ops_core.outbox_delivered(bigint, text)   to service_role;
grant execute on function ops_core.outbox_failed(bigint, text)      to service_role;
