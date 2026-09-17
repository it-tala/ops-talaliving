-- 0015_core_idempotency.sql — a repeat is one decision, not two.
--
-- Pulled a long way forward from the plan's `0027`, and the reason is the same
-- one that moved `acct_ledger`: a seam written without this has to be opened
-- again and threaded through, and a seam opened twice is one whose audit and
-- outbox rows get rearranged by somebody who has forgotten why they were in
-- that order.
--
-- The failure this prevents is concrete and has happened three times in this
-- project's history: a double tap on a slow phone becoming two approvals, or
-- two payments. The UI makes the key when a **form opens**, not when it is
-- submitted, so both taps carry the same key and the second one is answered
-- with the first one's answer.
--
-- **What is stored and what is not** is rule 4 of `03-api.md`, and it is the
-- subtle half:
--
--   ok, noop, 409   stored. The thing happened (or had already happened), so a
--                   repeat must return the same answer and change nothing.
--   403, 422, 5xx   NOT stored — the claim is released. The caller is expected
--                   to grant the authority, fix the value or try again, and
--                   they will reuse the key when they do. Storing a 422 would
--                   make a corrected resubmission return the old complaint for
--                   ever, which is a bug that looks exactly like the validation
--                   being wrong.

create table ops_core.idempotency_keys (
  service     text not null,
  endpoint    text not null,
  key         text not null,
  -- The whole envelope, as the seam returned it. Storing the answer rather than
  -- "this happened" means the replay is indistinguishable from the original to
  -- everything downstream — including the screen, which gets the same row back
  -- and renders the same way.
  response    jsonb not null,
  actor_id    uuid references ops_core.users(id),
  created_at  timestamptz not null default now(),
  primary key (service, endpoint, key)
);

-- Claims are worth keeping for as long as a retry is plausible and no longer;
-- the index is here so a sweep can find the old ones without a sequential scan
-- over a table that only ever grows.
create index idem_created_idx on ops_core.idempotency_keys (created_at);

alter table ops_core.idempotency_keys enable row level security;
-- No policy at all. This table is written and read only by the seams, which run
-- as definer. A client that could read it could read other people's responses,
-- and a client that could write it could make a seam return an answer it never
-- gave.

-- Returns the stored answer, marked, or null if this key has not been seen.
--
-- A stored `ok` comes back as `duplicate` with status 200, which
-- `src/lib/api/_kit.ts` turns into `replay()` — "you already did this, here is
-- the same answer again". A stored 409 comes back unchanged, because it was
-- already the right answer and re-labelling it would lose its status.
create or replace function ops_core.idem_replay(
  p_service text, p_endpoint text, p_key text)
returns jsonb
language plpgsql security definer set search_path = ops_core, pg_temp as $$
declare stored jsonb;
begin
  if p_key is null or p_key = '' then return null; end if;

  select response into stored
    from ops_core.idempotency_keys
   where service = p_service and endpoint = p_endpoint and key = p_key;

  if stored is null then return null; end if;
  if (stored ->> 'outcome') = 'duplicate' then return stored; end if;

  return jsonb_set(
    jsonb_set(stored, '{outcome}', '"duplicate"'::jsonb),
    '{status}', '200'::jsonb);
end $$;

create or replace function ops_core.idem_remember(
  p_service text, p_endpoint text, p_key text, p_response jsonb)
returns jsonb
language plpgsql security definer set search_path = ops_core, pg_temp as $$
declare oc text := p_response ->> 'outcome';
begin
  if p_key is null or p_key = '' then return p_response; end if;
  if oc not in ('ok','noop','duplicate') then return p_response; end if;

  insert into ops_core.idempotency_keys (service, endpoint, key, response, actor_id)
  values (p_service, p_endpoint, p_key, p_response, auth.uid())
  -- Two requests racing with the same key: the first one to commit wins and
  -- the second's insert is a no-op. Both callers get a correct answer, and the
  -- row is never overwritten by whichever finished last.
  on conflict (service, endpoint, key) do nothing;

  return p_response;
end $$;

revoke execute on function ops_core.idem_replay(text, text, text) from public;
revoke execute on function ops_core.idem_remember(text, text, text, jsonb) from public;
