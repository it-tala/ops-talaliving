-- 0009_procure_requests.sql — asking for an approval through a channel that
-- knows who answers.
--
-- The problem this exists for is in `0008`'s comment on `recorded_by_email`, and
-- this is the machinery that solves it. A leadership meeting runs on whoever's
-- laptop is open. If procurement ticks the box while the CEO says yes across
-- the table, the record says procurement approved it — false, in the one place
-- the system is supposed to be trustworthy.
--
-- So **the yes leaves the room.** The line is sent to the approver in Google
-- Chat, they answer there, and the identity on the record comes from the chat
-- platform's own authentication rather than from whoever is logged in here
-- (D69). The metadata then reads what actually happened:
-- `chat · evin@talaliving.com · 14:00`.

-- One send: a list, a total, and one answer session — because that is how a
-- meeting works (D70). A card per line would ask the approver to add up fifteen
-- numbers in their head to know what they have just committed the company to.
create table ops_procure.approval_batches (
  id            uuid primary key default gen_random_uuid(),
  batch_no      text not null unique,
  -- Identifies the SEND, never the person. In Phase 2 the answer arrives as a
  -- signed webhook from Google and the identity comes from that signature; a
  -- token that carried an identity would be a password anybody who saw the card
  -- could reuse.
  token         text not null unique,
  sent_to       text not null,
  sent_to_email citext not null,
  -- Whoever pressed send — usually not the approver. Kept because "who chased
  -- this" is a different question from "who decided it".
  sent_by       uuid not null references ops_core.users(id),
  sent_by_email citext not null,
  sent_at       timestamptz not null default now(),
  channel       ops_procure.channel_t not null default 'chat'
);

create table ops_procure.approval_requests (
  id            uuid primary key default gen_random_uuid(),
  line_id       uuid not null references ops_procure.pr_lines(id) on delete restrict,
  batch_id      uuid not null references ops_procure.approval_batches(id) on delete restrict,
  token         text not null unique,
  sent_to       text not null,
  sent_to_email citext not null,
  sent_by       uuid not null references ops_core.users(id),
  sent_by_email citext not null,
  sent_at       timestamptz not null default now(),
  channel       ops_procure.channel_t not null default 'chat',

  -- What the room said about this item when it was sent.
  --
  -- Not leadership's instruction — that is a `line_note`, and only somebody
  -- holding the authority may write one (D64). This is the meeting's own words
  -- travelling with the question, so the approver reading it on a phone has the
  -- context the room had. It prefills their instruction field; if they send it
  -- back unchanged it becomes theirs, deliberately and visibly (D127).
  meeting_note  text,

  answered_at   timestamptz,
  outcome       ops_procure.request_outcome_t,

  -- One question, one answer. A request is either open or it is decided, and a
  -- half-decided one — answered with no outcome, or an outcome with no time —
  -- is a row nothing can read.
  constraint answered_together check ((answered_at is null) = (outcome is null))
);

create index approval_requests_line_idx  on ops_procure.approval_requests (line_id, sent_at desc);
create index approval_requests_batch_idx on ops_procure.approval_requests (batch_id);

-- **One open question per line.** A second card for a line somebody is already
-- being asked about is how the same item gets approved twice by two people who
-- each thought they were the only one asked. Enforced here rather than in the
-- seam, because a unique index cannot be forgotten under concurrency and a
-- `select ... if not exists` can.
create unique index approval_requests_one_open_idx
  on ops_procure.approval_requests (line_id) where answered_at is null;

alter table ops_procure.approval_batches  enable row level security;
alter table ops_procure.approval_requests enable row level security;

create policy batches_read on ops_procure.approval_batches
  for select to authenticated using (ops_core.has_permission('procurement.read'));
create policy requests_read on ops_procure.approval_requests
  for select to authenticated using (ops_core.has_permission('procurement.read'));

-- Sending is chasing, not deciding: procurement asks, leadership answers. So
-- `procurement.update` sends and the authority is checked when the answer lands
-- in `pr_approvals` (0008). Conflating the two would mean only the CEO could
-- put a question to themselves.
create policy batches_new on ops_procure.approval_batches
  for insert to authenticated with check (ops_core.has_permission('procurement.update'));
create policy requests_new on ops_procure.approval_requests
  for insert to authenticated with check (ops_core.has_permission('procurement.update'));

-- Answering stamps `answered_at` and `outcome`. The update is column-scoped in
-- the grant below, so the thing that was asked cannot be edited after the fact —
-- a question whose text can change after it is answered is not a record of
-- anything. Writing the approval row itself still needs the authority.
create policy requests_answer on ops_procure.approval_requests
  for update to authenticated
  using (ops_core.has_permission('procurement.update')
         or ops_core.has_authority('approve_goods'))
  with check (ops_core.has_permission('procurement.update')
              or ops_core.has_authority('approve_goods'));

grant select on ops_procure.approval_batches, ops_procure.approval_requests to authenticated;
grant insert on ops_procure.approval_batches, ops_procure.approval_requests to authenticated;
grant update (answered_at, outcome) on ops_procure.approval_requests to authenticated;
