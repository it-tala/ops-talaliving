-- 0090_asst_turns.sql — what John Lau was asked, what it answered, and which
-- document the answer turned into.
--
-- The assistant itself is not in here and never will be. The dispatcher is a
-- keyword matcher today and a language model later (D221), the tool catalogue
-- is **code** because a list of what an assistant may reach is a security
-- boundary and a boundary stored as rows is a boundary with an UPDATE
-- statement in it (D218), and every figure it says comes from a tool that is
-- somebody else's view. What is left for a schema is the **record**, and the
-- record turns out to carry more weight than it looks.
--
-- ## Three things the assistant does, and what each one needs from here
--
--   **It explains the system.** Steps with a screen attached, so the panel can
--   stay open while somebody walks to the page it describes (D223). Stored so
--   the walkthrough survives a refresh mid-task.
--
--   **It answers from the database, with the asker's own rights.** The rights
--   are not enforced here — RLS enforces them, on the tables the tools read,
--   as the person. What is stored is the **figures apart from the prose**, and
--   that separation is a constraint rather than a convention, below.
--
--   **It writes, on a second yes, instead of the person filling in a form.**
--   This is the one that changes what this table is. A turn that produced a
--   purchase request line is not a chat log — it is the **provenance of a
--   write**, and provenance that can be edited afterwards is not provenance.
--   So a turn is append-only but for one transition, and there is a view that
--   answers *where did this line come from* without handing over what people
--   ask.
--
-- ## Who may read what
--
-- Your own conversation, and nobody else's: somebody asking about salaries has
-- done nothing wrong, and a permanent record of the question, readable by
-- their manager, would be a worse trail than no trail. The audit log already
-- records that a boundary held, without the prompt.
--
-- But a **write** through the prompt is not private, and pretending otherwise
-- would make the assistant the one input path with no oversight. So
-- `v_turn_provenance` shows IT the tool, the fields confirmed and the document
-- produced — and never the prompt. Two different questions, two different
-- answers, rather than one setting somebody has to get right.

create schema if not exists ops_asst;  -- John Lau: what was asked, and what it did

insert into ops_core.doc_prefixes (prefix, what) values
  ('jl', 'assistant turn');

create type ops_asst.turn_kind_t as enum ('answer','guide','draft','refused','unknown');

-- Rendering these two the same way was the first version's mistake (F64). The
-- second is fixed by asking IT for a grant and the first never is, so a header
-- reading *not through the prompt* over a permission problem sends somebody to
-- argue with the wrong person.
create type ops_asst.refusal_t as enum ('closed','permission');

create table ops_asst.assistant_turns (
  id              uuid primary key default gen_random_uuid(),
  turn_no         text not null unique default ops_core.next_doc_number('jl'),
  actor_id        uuid not null references ops_core.users(id),
  asked_at        timestamptz not null default now(),
  -- **Verbatim.** Not normalised, not lower-cased, not trimmed of the thing
  -- that made the matcher fail: the sentence that did not work is the only
  -- evidence for why it did not.
  prompt          text not null check (length(btrim(prompt)) > 0),
  kind            ops_asst.turn_kind_t not null,
  -- What it thought was asked, echoed back so a wrong reading is visible
  -- before anybody acts on it.
  understood_as   text,
  -- The prose half of the reply, and **no figure may be in it** — see the
  -- constraint below, which is the one rule in this file worth arguing about.
  body            text not null default '',
  -- `[{label, value, source, href}]`. Every number the reply contains, each
  -- carrying the tool that produced it and the screen showing the same figure.
  facts           jsonb not null default '[]'::jsonb,
  -- `[{text, href, rule}]`.
  steps           jsonb not null default '[]'::jsonb,
  -- The tools it actually ran, in order. **Not validated against a catalogue**,
  -- deliberately: validating it would need the catalogue in here, and the
  -- catalogue being code is the whole of D218. What this column is for is the
  -- trail, and a name that matches nothing is itself worth seeing.
  tools_used      text[] not null default '{}',
  refused_because ops_asst.refusal_t,
  -- `{headline, fields:[{label,value}], warnings, args, idempotency_key}`,
  -- carried whole. A confirmation that shows a summary is a confirmation of
  -- the summary (D220), so the summary is not what is stored.
  draft           jsonb,
  draft_outcome   text check (draft_outcome in ('confirmed','abandoned')),
  -- The document the confirmation produced, by its **public code** (ADR-004).
  produced_ref    text,
  -- Where the person can go on reading while they work.
  route           text,

  -- ── the figures are not in the sentence ────────────────────────────────
  --
  -- The rule `02-database.md` asks for: a number cannot be paraphrased on its
  -- way into prose, because the paraphrase is what a person quotes and the
  -- fact is what they could have checked.
  --
  -- It catches **money**, which is the failure that actually happens — *total
  -- hutang vendor Rp 12.500.000* written into a sentence instead of into
  -- `facts`. It does not pretend to catch every digit: `Berkas 201` is the
  -- name of a file, `pr-26-09-11_03` is a reference, and refusing those would
  -- teach whoever hits it to work around the check rather than to use `facts`.
  constraint no_money_in_the_prose check (
    body !~* '(rp|idr)[[:space:]]*[0-9]'
    and body !~ '[0-9]{1,3}([.,][0-9]{3})+'),

  -- ── a turn says one thing ──────────────────────────────────────────────
  constraint refusal_says_which_kind check ((kind = 'refused') = (refused_because is not null)),
  constraint draft_belongs_to_a_draft check ((kind = 'draft') = (draft is not null)),
  constraint facts_belong_to_an_answer check (kind = 'answer' or facts = '[]'::jsonb),
  constraint steps_belong_to_a_guide  check (kind = 'guide'  or steps = '[]'::jsonb),
  constraint outcome_needs_a_draft    check (draft_outcome is null or draft is not null),
  -- Nothing was produced by a draft that was abandoned, and nothing is
  -- produced by one nobody has decided yet.
  constraint produced_needs_a_yes     check (produced_ref is null or draft_outcome = 'confirmed')
);

create index turns_mine_idx on ops_asst.assistant_turns (actor_id, asked_at desc);
create index turns_produced_idx on ops_asst.assistant_turns (produced_ref)
  where produced_ref is not null;

-- ── a turn is evidence, so only one thing about it may change ─────────────
--
-- Append-only but for the second yes. The prompt, what it understood, the
-- figures it gave and the tools it ran are what somebody relied on when they
-- acted, and a record that can be tidied up afterwards is not a record. The
-- draft's outcome is the one field that is *supposed* to move, once, from
-- nothing to decided.
create or replace function ops_asst.turn_is_evidence()
returns trigger
language plpgsql set search_path = ops_asst, pg_temp as $$
begin
  if new.prompt is distinct from old.prompt
     or new.kind is distinct from old.kind
     or new.body is distinct from old.body
     or new.facts is distinct from old.facts
     or new.steps is distinct from old.steps
     or new.tools_used is distinct from old.tools_used
     or new.understood_as is distinct from old.understood_as
     or new.refused_because is distinct from old.refused_because
     or new.draft is distinct from old.draft
     or new.actor_id is distinct from old.actor_id
     or new.asked_at is distinct from old.asked_at then
    raise exception 'turn % is what somebody read before they acted; only the draft''s outcome may change',
      old.turn_no using errcode = 'check_violation';
  end if;
  if old.draft_outcome is not null
     and new.draft_outcome is distinct from old.draft_outcome then
    raise exception 'turn % was already %; a draft is decided once',
      old.turn_no, old.draft_outcome using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger turn_is_evidence
  before update on ops_asst.assistant_turns
  for each row execute function ops_asst.turn_is_evidence();

-- ── asking ────────────────────────────────────────────────────────────────
--
-- A seam rather than an insert through a policy, for the usual reason (D84) —
-- and one particular to this table: a **refusal** has to reach the audit log
-- without the prompt reaching it. `core.say` would write the message, and the
-- message here is the refusal's own wording; the prompt stays in the turn,
-- which only its author can read.
create or replace function ops_asst.record_turn(
  p_prompt          text,
  p_kind            ops_asst.turn_kind_t,
  p_understood_as   text default null,
  p_body            text default '',
  p_facts           jsonb default '[]'::jsonb,
  p_steps           jsonb default '[]'::jsonb,
  p_tools_used      text[] default '{}',
  p_refused_because ops_asst.refusal_t default null,
  p_draft           jsonb default null,
  p_route           text default null,
  p_key             text default null)
returns jsonb
language plpgsql security definer set search_path = ops_asst, ops_core, pg_temp as $$
declare v_replayed jsonb; v_no text; v_res jsonb;
begin
  v_replayed := ops_core.idem_replay('assistant','record_turn', p_key);
  if v_replayed is not null then return v_replayed; end if;

  -- Not a module grant: the assistant is reachable by anybody with an account,
  -- and **what it can then do is decided per tool**, by the RLS on the tables
  -- those tools read, as the person (D219). A check here would be a fourth
  -- gate nobody asked for and a second place for the rules to disagree.
  if auth.uid() is null then
    return ops_core.refused('assistant','turn', null,'ask',
      'not_signed_in','Nobody is signed in.');
  end if;

  if coalesce(btrim(coalesce(p_prompt,'')), '') = '' then
    return ops_core.invalid('assistant','turn', null,'ask',
      'empty_prompt','Tulis pertanyaannya dulu.', jsonb_build_object('field','prompt'));
  end if;

  insert into ops_asst.assistant_turns
    (actor_id, prompt, kind, understood_as, body, facts, steps, tools_used,
     refused_because, draft, route)
  values (auth.uid(), p_prompt, p_kind, p_understood_as, coalesce(p_body,''),
          coalesce(p_facts,'[]'::jsonb), coalesce(p_steps,'[]'::jsonb),
          coalesce(p_tools_used,'{}'), p_refused_because, p_draft, p_route)
  returning turn_no into v_no;

  -- A refusal is announced; an answer is not. Somebody asking about salaries
  -- has done nothing wrong, and the interesting fact is that the boundary
  -- held — **which tool, not which question**.
  if p_kind = 'refused' then
    perform ops_core.emit('assistant','assistant.refused', v_no,
      jsonb_build_object('turn_no', v_no, 'because', p_refused_because,
                         'tools', to_jsonb(coalesce(p_tools_used,'{}'))));
  end if;

  v_res := ops_core.ok('assistant','turn', v_no,'ask',
    jsonb_build_object('turn_no', v_no, 'kind', p_kind));
  return ops_core.idem_remember('assistant','record_turn', p_key, v_res);
end $$;

-- ── the second yes, and what it produced ──────────────────────────────────
create or replace function ops_asst.close_draft(
  p_turn_no      text,
  p_outcome      text,
  p_produced_ref text default null,
  p_key          text default null)
returns jsonb
language plpgsql security definer set search_path = ops_asst, ops_core, pg_temp as $$
declare v_replayed jsonb; v_turn ops_asst.assistant_turns; v_res jsonb;
begin
  v_replayed := ops_core.idem_replay('assistant','close_draft', p_key);
  if v_replayed is not null then return v_replayed; end if;

  select t.* into v_turn from ops_asst.assistant_turns t where t.turn_no = p_turn_no;
  if not found then
    return ops_core.not_found('assistant','turn', p_turn_no,'close_draft',
      format('No turn %s.', p_turn_no));
  end if;

  -- Somebody else's draft is not yours to confirm, whatever you hold. The
  -- second yes is the *same person's* yes — that is the whole of D220.
  if v_turn.actor_id <> auth.uid() then
    return ops_core.refused('assistant','turn', p_turn_no,'close_draft',
      'not_yours','Rancangan ini milik percakapan orang lain.');
  end if;

  if v_turn.draft is null then
    return ops_core.invalid('assistant','turn', p_turn_no,'close_draft',
      'not_a_draft','Giliran ini tidak membuat rancangan apa pun.');
  end if;
  if v_turn.draft_outcome is not null then
    return ops_core.conflict('assistant','turn', p_turn_no,'close_draft',
      'already_decided',
      format('Rancangan ini sudah %s.', v_turn.draft_outcome));
  end if;
  if p_outcome not in ('confirmed','abandoned') then
    return ops_core.invalid('assistant','turn', p_turn_no,'close_draft',
      'bad_outcome','Sebuah rancangan dikonfirmasi atau dibatalkan.',
      jsonb_build_object('field','outcome'));
  end if;

  -- A confirmation with nothing to show for it is the shape of a write that
  -- half happened. The caller performs the write first and brings back its
  -- code; if there is none, this did not confirm anything.
  if p_outcome = 'confirmed'
     and coalesce(btrim(coalesce(p_produced_ref,'')), '') = '' then
    return ops_core.invalid('assistant','turn', p_turn_no,'close_draft',
      'produced_required',
      'Konfirmasi tanpa dokumen yang dihasilkan adalah tulisan yang setengah jadi.',
      jsonb_build_object('field','produced_ref'));
  end if;

  update ops_asst.assistant_turns
     set draft_outcome = p_outcome,
         produced_ref  = case when p_outcome = 'confirmed' then btrim(p_produced_ref) end
   where turn_no = p_turn_no;

  if p_outcome = 'confirmed' then
    -- **This one is announced with everything on it.** A write through the
    -- prompt is the one path with no form behind it, so the trail carries the
    -- tool, the document and the fields that were confirmed.
    perform ops_core.emit('assistant','assistant.draft.confirmed', p_turn_no,
      jsonb_build_object('turn_no', p_turn_no, 'tool', v_turn.draft ->> 'tool',
                         'produced_ref', btrim(p_produced_ref),
                         'fields', v_turn.draft -> 'fields'));
  end if;

  v_res := ops_core.ok('assistant','turn', p_turn_no,'close_draft',
    jsonb_build_object('turn_no', p_turn_no, 'outcome', p_outcome,
                       'produced_ref', case when p_outcome = 'confirmed' then btrim(p_produced_ref) end),
    jsonb_build_object('draft_outcome', null),
    jsonb_build_object('draft_outcome', p_outcome));
  return ops_core.idem_remember('assistant','close_draft', p_key, v_res);
end $$;

-- ── what the assistant wrote, without what anybody asked ──────────────────
--
-- The question *where did this purchase request line come from* has to be
-- answerable, or the assistant becomes the one input path with no oversight.
-- The question *what has Budi been asking John Lau* must not be, or nobody
-- will ask it anything worth asking.
--
-- Both are served by leaving the prompt out. Everything here is about a write
-- that happened: who, which tool, which fields, which document.
create or replace view ops_asst.v_turn_provenance as
select
  t.turn_no,
  t.asked_at,
  t.actor_id,
  u.full_name                     as actor_name,
  t.draft ->> 'tool'              as tool,
  t.draft ->> 'headline'          as headline,
  t.draft -> 'fields'             as fields,
  t.draft_outcome,
  t.produced_ref
from ops_asst.assistant_turns t
join ops_core.users u on u.id = t.actor_id
-- **The gate is in the view**, because the view is what crosses the line the
-- table's policy draws. It runs as its owner — the only one in the ladder that
-- does — so this predicate is not decoration: without it, every signed-in
-- account could read every draft anybody ever confirmed.
where t.draft is not null
  and ops_core.has_permission('it.read');

-- ── access ────────────────────────────────────────────────────────────────
alter table ops_asst.assistant_turns enable row level security;

-- Your own conversation, and nobody else's. Not an oversight gap: the audit
-- log records that a boundary held and `v_turn_provenance` records what was
-- written, and neither of them carries the question.
create policy turns_read on ops_asst.assistant_turns for select to authenticated
  using (actor_id = auth.uid());

-- No INSERT or UPDATE policy and no INSERT or UPDATE grant: both roads are the
-- seams above, which is what keeps the turn number minted and the refusal
-- announced. No DELETE anywhere (A2) — a turn somebody acted on is a fact, and
-- the one thing a person might want to erase is the one thing worth keeping.

-- `security_invoker = off` — **the only view in the ladder that runs as its
-- owner**, and deliberately, because its whole job is to cross the boundary
-- `turns_read` draws: it reads rows the caller may not read and hands back the
-- part of them that is not private. Every other view in this system carries
-- the reader's rights and should; this one carries the reason it does not, in
-- the `where` clause above.
alter view ops_asst.v_turn_provenance set (security_invoker = off);

grant usage on schema ops_asst to authenticated;
grant select on ops_asst.assistant_turns, ops_asst.v_turn_provenance to authenticated;
grant execute on function
  ops_asst.record_turn(text, ops_asst.turn_kind_t, text, text, jsonb, jsonb, text[],
                       ops_asst.refusal_t, jsonb, text, text),
  ops_asst.close_draft(text, text, text, text)
  to authenticated;
