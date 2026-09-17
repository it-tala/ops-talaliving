-- 0003_core_audit.sql — the audit trail, the outbox, and settings.
--
-- Every mutation writes three things in one transaction: the business rows,
-- one audit row, one outbox row. All three or none (03-api.md). The audit row
-- carries **what changed**, field by field — "who touched the ledger this
-- month" is not the question anybody asks; "what happened to *this* row" is,
-- and it is asked while looking at it (D84).

create table ops_core.audit_log (
  id          bigserial primary key,
  at          timestamptz not null default now(),
  actor_id    uuid references ops_core.users(id),
  service     text not null,
  entity      text not null,
  -- The public code, not the uuid: `pr-26-09-11_03`. A trail nobody can read
  -- is a trail nobody checks (ADR-004).
  entity_no   text,
  action      text not null,
  -- ok · refused · duplicate · noop. A refusal is recorded, not silent (A7).
  outcome     text not null check (outcome in ('ok','refused','duplicate','noop')),
  reason      text,
  before      jsonb,
  after       jsonb,
  detail      jsonb
);

create index audit_entity_idx on ops_core.audit_log (entity, entity_no, at desc);
create index audit_actor_idx  on ops_core.audit_log (actor_id, at desc);

-- The third-party seam (ADR-008). Chat notifications, future webhooks and the
-- reporting feed all read from here; nothing calls an external service inside
-- a business transaction.
create table ops_core.outbox (
  id            bigserial primary key,
  service       text not null,             -- 'procurement'
  event_type    text not null,             -- 'line.approved'
  entity_no     text,
  payload       jsonb not null,
  occurred_at   timestamptz not null default now(),
  delivered_at  timestamptz,
  -- Delivery is a retry loop, and a loop that cannot say why it failed is one
  -- nobody can fix at 7pm on a Friday.
  attempts      int not null default 0,
  last_error    text
);

create index outbox_undelivered_idx on ops_core.outbox (occurred_at) where delivered_at is null;

-- One home for a tolerance, so a number nobody can find is not hard-coded in
-- three services (02-database.md §Settings).
create table ops_core.settings (
  key         text primary key,
  value       jsonb not null,
  note        text not null,
  updated_by  uuid references ops_core.users(id),
  updated_at  timestamptz not null default now()
);

insert into ops_core.settings (key, value, note) values
  ('receipt_tolerance_pct', '2'::jsonb,
   'How far a delivered quantity may differ before the receipt is a variance (F13).'),
  ('late_after_minutes', '480'::jsonb,
   'The office day starts at 08:00; a tap past this is late. What a late minute COSTS is not set here — that is a decision, typed by a person with a reason (D155, Q41).'),
  ('duplicate_window_days', '7'::jsonb,
   'How far back a similar transaction is looked for before the screen warns. Warns, never blocks (A6).'),
  ('payment_tolerance_idr', '1000'::jsonb,
   'Below this, a gap between what was approved and what was paid is arithmetic, not a variance. Reporting rounding as an exception is how people learn to ignore exceptions. One home for it, because john-lau ended up with three different tolerances in three files.');

-- Read by every view that compares two amounts. `stable` so Postgres evaluates
-- it once per statement rather than once per row, which is the difference
-- between a lookup and a join nobody wrote.
create or replace function ops_core.setting_num(p_key text)
returns numeric
language sql stable security definer set search_path = ops_core, pg_temp as $$
  select (value #>> '{}')::numeric from ops_core.settings where key = p_key
$$;

-- Named, because `ops_core.setting_num('payment_tolerance_idr')` inside six views is
-- six chances to mistype the key into a silent null — and a null tolerance makes
-- every comparison false, which reads as "nothing is ever settled".
create or replace function ops_core.money_tolerance()
returns numeric
language sql stable security definer set search_path = ops_core, pg_temp as $$
  select coalesce(ops_core.setting_num('payment_tolerance_idr'), 1000)
$$;

alter table ops_core.audit_log enable row level security;
alter table ops_core.outbox    enable row level security;
alter table ops_core.settings  enable row level security;

-- Reading the trail is `it.read`; writing it is nobody's — rows arrive through
-- the service functions, which run as definer.
create policy audit_read on ops_core.audit_log
  for select to authenticated using (ops_core.has_permission('it.read'));
create policy outbox_read on ops_core.outbox
  for select to authenticated using (ops_core.has_permission('it.read'));
create policy settings_read on ops_core.settings
  for select to authenticated using (true);
create policy settings_write on ops_core.settings
  for update to authenticated
  using (ops_core.has_permission('settings.update'))
  with check (ops_core.has_permission('settings.update'));

-- The one way a business function writes its trail. Called inside the same
-- transaction as the rows it describes; there is no second road.
create or replace function ops_core.write_audit(
  p_service text, p_entity text, p_entity_no text, p_action text,
  p_outcome text default 'ok', p_reason text default null,
  p_before jsonb default null, p_after jsonb default null, p_detail jsonb default null
) returns bigint
language sql security definer set search_path = ops_core, pg_temp as $$
  insert into ops_core.audit_log (actor_id, service, entity, entity_no, action, outcome, reason, before, after, detail)
  values (auth.uid(), p_service, p_entity, p_entity_no, p_action, p_outcome, p_reason, p_before, p_after, p_detail)
  returning id
$$;

create or replace function ops_core.emit(
  p_service text, p_event_type text, p_entity_no text, p_payload jsonb)
returns bigint
language sql security definer set search_path = ops_core, pg_temp as $$
  insert into ops_core.outbox (service, event_type, entity_no, payload)
  values (p_service, p_event_type, p_entity_no, p_payload)
  returning id
$$;

-- ── the envelope, in SQL ──────────────────────────────────────────────────
-- `03-api.md` rule 4: **refusals are values, not exceptions.** Every seam in
-- this database returns one of the shapes below, and `src/lib/api/_kit.ts`
-- turns it into the same `Result<T>` the screens already handle.
--
-- It is not only a style choice, and the reason is worth writing down because
-- it was found the hard way. A seam that refuses by `raise exception` **rolls
-- back its own audit row**: the write_audit call and the raise are in one
-- transaction, so the trail of the refusal disappears with the refusal. A7 says
-- a refusal is recorded, not silent — and implemented as an exception it is
-- silent by construction, whatever the code appears to say.
--
-- So every wrapper here writes the trail *and* returns the answer, which makes
-- "record the refusal" impossible to forget rather than merely required. The
-- statuses match `src/services/_shared/envelope.ts` exactly:
--
--   ok        200  outcome ok
--   noop      200  outcome noop       nothing needed doing
--   refused   403  outcome refused    signed in, but this decision is not yours
--   invalid   422  outcome refused    the values are wrong
--   conflict  409  outcome duplicate  already decided; the client KEEPS its claim
--   not_found 404  outcome refused
create or replace function ops_core.say(
  p_service text, p_entity text, p_entity_no text, p_action text,
  p_outcome text, p_status int, p_code text, p_message text,
  p_data jsonb default null, p_detail jsonb default null,
  p_before jsonb default null, p_after jsonb default null
) returns jsonb
language plpgsql security definer set search_path = ops_core, pg_temp as $$
begin
  perform ops_core.write_audit(p_service, p_entity, p_entity_no, p_action,
    p_outcome, p_message, p_before, p_after, p_detail);
  return jsonb_strip_nulls(jsonb_build_object(
    'outcome', p_outcome,
    'status',  p_status,
    'data',    p_data,
    'error',   case when p_code is null then null else jsonb_build_object(
                 'code', p_code, 'message', p_message,
                 'outcome', p_outcome, 'status', p_status,
                 'detail', p_detail) end));
end $$;

create or replace function ops_core.ok(
  p_service text, p_entity text, p_entity_no text, p_action text,
  p_data jsonb default null, p_before jsonb default null, p_after jsonb default null
) returns jsonb language sql security definer set search_path = ops_core, pg_temp as $$
  select ops_core.say(p_service, p_entity, p_entity_no, p_action, 'ok', 200,
                  null, null, p_data, null, p_before, p_after)
$$;

-- Not an error: `/rounds/sync` with nothing to roll up is a successful no-op,
-- and saying so is better than a silent 200 that looks like work happened.
create or replace function ops_core.noop(
  p_service text, p_entity text, p_entity_no text, p_action text,
  p_reason text, p_data jsonb default null
) returns jsonb language sql security definer set search_path = ops_core, pg_temp as $$
  select ops_core.say(p_service, p_entity, p_entity_no, p_action, 'noop', 200,
                  null, p_reason, p_data)
$$;

-- 403. The message names who the decision *does* belong to, because "Forbidden"
-- tells a person nothing and leaves them with nobody to ask (A7).
create or replace function ops_core.refused(
  p_service text, p_entity text, p_entity_no text, p_action text,
  p_code text, p_message text, p_detail jsonb default null
) returns jsonb language sql security definer set search_path = ops_core, pg_temp as $$
  select ops_core.say(p_service, p_entity, p_entity_no, p_action, 'refused', 403,
                  p_code, p_message, null, p_detail)
$$;

create or replace function ops_core.invalid(
  p_service text, p_entity text, p_entity_no text, p_action text,
  p_code text, p_message text, p_detail jsonb default null
) returns jsonb language sql security definer set search_path = ops_core, pg_temp as $$
  select ops_core.say(p_service, p_entity, p_entity_no, p_action, 'refused', 422,
                  p_code, p_message, null, p_detail)
$$;

-- 409, and the client must NOT release its idempotency claim on this one: the
-- thing it asked for has already happened, so retrying would do it twice.
create or replace function ops_core.conflict(
  p_service text, p_entity text, p_entity_no text, p_action text,
  p_code text, p_message text, p_detail jsonb default null
) returns jsonb language sql security definer set search_path = ops_core, pg_temp as $$
  select ops_core.say(p_service, p_entity, p_entity_no, p_action, 'duplicate', 409,
                  p_code, p_message, null, p_detail)
$$;

create or replace function ops_core.not_found(
  p_service text, p_entity text, p_entity_no text, p_action text,
  p_message text
) returns jsonb language sql security definer set search_path = ops_core, pg_temp as $$
  select ops_core.say(p_service, p_entity, p_entity_no, p_action, 'refused', 404,
                  'not_found', p_message)
$$;

-- Did a seam say yes? Written once so the smoke files and the seams that call
-- other seams ask the question the same way.
create or replace function ops_core.said_ok(p_answer jsonb)
returns boolean language sql immutable as $$
  select coalesce(p_answer ->> 'outcome', '') = 'ok'
$$;

grant select on ops_core.audit_log, ops_core.outbox, ops_core.settings to authenticated;
grant execute on function ops_core.setting_num(text), ops_core.money_tolerance(),
                          ops_core.said_ok(jsonb) to authenticated;
-- The envelope wrappers are NOT granted to `authenticated`. They write audit
-- rows, and a client that could call `ops_core.ok(...)` directly could forge a trail
-- saying anything it liked. They are reachable only from inside the seams, which
-- run as definer and are granted one by one.
