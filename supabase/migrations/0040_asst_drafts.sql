-- 0040_asst_drafts.sql — the writes John Lau prepares and does not perform.
--
-- ── What a draft is, and what it is not ──────────────────────────────────
--
-- A draft is **not a pending write**. Nothing is queued, nothing is reserved,
-- and abandoning one costs nothing — because nothing had started. It is a
-- sentence turned into a form, with the blanks visible as blanks.
--
-- D220: nothing is written without a second yes, **on the exact payload, not a
-- summary of it**. The confirmation screen renders every field and the confirm
-- call carries those fields back, so what was confirmed is what is written. A
-- confirmation of a summary is a confirmation of the summary.
--
-- ── Where the write actually happens ─────────────────────────────────────
--
-- Not here. `0039` explains why the tools are run by the client, as the
-- person, through the same PostgREST calls the screens make; a confirmed draft
-- is that same thing with a form in front of it. `procurement.quick_add_line`
-- writes the line, under its own rules, with its own audit row and its own
-- idempotency key.
--
-- So this table is the **record**, not the gate:
--
--   * what was drafted, from which sentence
--   * what the person actually confirmed, field by field
--   * what it produced, or that it was abandoned
--
-- The one thing it does enforce is that a draft is settled **once**. Two taps
-- on a slow connection is one purchase request (A4), and while the seam's own
-- idempotency key is what makes that true of the write, a second settlement
-- row would make the record say it happened twice.

create type ops_asst.draft_outcome_t as enum ('confirmed','abandoned');

create table ops_asst.drafts (
  id                uuid primary key default gen_random_uuid(),
  -- One draft per turn. A second draft against the same sentence would mean
  -- two forms claiming to be what was asked for.
  turn_id           uuid not null unique references ops_asst.turns(id),
  actor_id          uuid not null references ops_core.users(id),
  tool              text not null references ops_asst.tools(name),
  -- The crumbs the router pulled out of the sentence — never more than that.
  -- Everything else is a blank the person fills and sees themselves fill.
  args              jsonb not null default '{}'::jsonb,
  -- Carried to the seam that performs the write, so a double tap is one row.
  idempotency_key   text not null unique,
  created_at        timestamptz not null default now(),

  outcome           ops_asst.draft_outcome_t,
  decided_at        timestamptz,
  -- **What was confirmed, verbatim.** The reason this column exists rather
  -- than re-reading `args`: the person edits the form, and the argument three
  -- weeks later is about what they pressed yes on, not what the sentence
  -- happened to contain.
  confirmed_payload jsonb,
  produced_ref      text,

  constraint decided_together
    check ((outcome is null) = (decided_at is null)),
  constraint confirmed_says_what
    check (outcome is distinct from 'confirmed' or confirmed_payload is not null),
  -- An abandoned draft produced nothing, by definition. A row saying otherwise
  -- would be a document with nobody's yes behind it.
  constraint abandoned_produces_nothing
    check (outcome is distinct from 'abandoned' or produced_ref is null)
);

create index drafts_actor_idx on ops_asst.drafts (actor_id, created_at desc);

comment on table ops_asst.drafts is
  'A write John Lau prepared and did not perform. The record, not the gate — the write itself '
  'goes through the seam that owns it, as the person. (0040)';

comment on column ops_asst.drafts.confirmed_payload is
  'What the person pressed yes on, field by field. Not re-derivable from `args`: they edit the '
  'form, and that edit is the thing an argument three weeks later is about (D220). (0040)';

-- Yours only, for the same reason as `turns` (0039): what somebody asked for
-- and then thought better of is nobody else's business. What they *did* go
-- through with is a purchase request with their name on it, and that is
-- readable exactly where purchase requests are.
alter table ops_asst.drafts enable row level security;

create policy drafts_own on ops_asst.drafts
  for select to authenticated using (actor_id = auth.uid());

grant select on ops_asst.drafts to authenticated;

-- ── opening one ──────────────────────────────────────────────────────────

create or replace function ops_asst.open_draft(
  p_turn_id uuid,
  p_tool text,
  p_args jsonb default '{}'::jsonb,
  p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_asst, ops_core, pg_temp as $$
declare v_turn ops_asst.turns; v_tool ops_asst.tools; v_row ops_asst.drafts; v_key text;
begin
  if auth.uid() is null then
    return ops_core.refused('assistant','draft', null,'open',
      'not_signed_in','A draft belongs to somebody, and nobody is signed in.');
  end if;

  select * into v_turn from ops_asst.turns where id = p_turn_id;
  if not found or v_turn.actor_id <> auth.uid() then
    -- Deliberately the same answer either way. *That turn is somebody else's*
    -- would confirm the id belonged to a real conversation.
    return ops_core.not_found('assistant','draft', p_turn_id::text,'open',
      'There is no such turn in your conversation.');
  end if;

  select * into v_tool from ops_asst.tools where name = p_tool;
  if not found then
    return ops_core.not_found('assistant','draft', p_tool,'open',
      format('There is no tool called %s.', p_tool));
  end if;

  -- The gate, again, at the moment of drafting. `may_run` already said yes
  -- before the sentence became a form, and a grant can be taken away between
  -- the two — but more to the point, a draft against a blocked tool must be
  -- impossible to construct at all, not merely impossible to confirm.
  if v_tool.reach = 'blocked' then
    return ops_core.refused('assistant','draft', v_tool.name,'open',
      'closed', v_tool.blocked_reason_id,
      jsonb_build_object('refused_because','closed','instead_at', v_tool.instead_at));
  end if;
  if v_tool.effect <> 'write' then
    return ops_core.invalid('assistant','draft', v_tool.name,'open',
      'not_a_write', format('%s does not write anything, so there is nothing to confirm.', v_tool.name),
      jsonb_build_object('field','tool','effect', v_tool.effect));
  end if;
  if not ops_asst.holds_grant(v_tool.module, v_tool.level) then
    return ops_core.refused('assistant','draft', v_tool.name,'open',
      'permission_required',
      format('Yang ini menulis di modul %s, dan akses Anda di sana belum sampai %s.',
             v_tool.module, v_tool.level),
      jsonb_build_object('refused_because','permission','instead_at', v_tool.instead_at));
  end if;

  v_key := coalesce(nullif(btrim(p_key),''), gen_random_uuid()::text);

  insert into ops_asst.drafts (turn_id, actor_id, tool, args, idempotency_key)
  values (p_turn_id, auth.uid(), p_tool, coalesce(p_args,'{}'::jsonb), v_key)
  returning * into v_row;

  return ops_core.ok('assistant','draft', v_row.id::text,'open', to_jsonb(v_row));
exception when unique_violation then
  -- The same turn drafted twice: a double submit, not a second intention.
  -- Answering the draft that exists is the correct reply, and it keeps the
  -- client's idempotency key pointing at one row.
  select * into v_row from ops_asst.drafts where turn_id = p_turn_id;
  return ops_core.noop('assistant','draft', v_row.id::text,'open',
    'this turn already has a draft', to_jsonb(v_row));
end $$;

grant execute on function ops_asst.open_draft(uuid, text, jsonb, text) to authenticated;

-- ── the second yes, or the change of mind ────────────────────────────────

/* **Settled once.**
 *
 * A second confirm is answered `duplicate` with the row as it stands, and the
 * client must keep its idempotency claim: the thing it asked for has already
 * happened, and retrying would do it twice (0003).
 *
 * A confirm that names nothing produced is not an error. Issuing a purchase
 * order is an obligation to a vendor and stops at a draft document on purpose
 * (D220) — the person finishes it on the PO screen, where the lines and the
 * deposit are in front of them.
 */
create or replace function ops_asst.settle_draft(
  p_draft_id uuid,
  p_outcome text,
  p_payload jsonb default null,
  p_produced_ref text default null)
returns jsonb
language plpgsql security definer set search_path = ops_asst, ops_core, pg_temp as $$
declare v_row ops_asst.drafts; v_outcome ops_asst.draft_outcome_t;
begin
  if p_outcome not in ('confirmed','abandoned') then
    return ops_core.invalid('assistant','draft', p_draft_id::text,'settle',
      'bad_outcome','A draft is either confirmed or abandoned.',
      jsonb_build_object('field','outcome','given', p_outcome));
  end if;
  v_outcome := p_outcome::ops_asst.draft_outcome_t;

  select * into v_row from ops_asst.drafts where id = p_draft_id;
  if not found or v_row.actor_id <> auth.uid() then
    return ops_core.not_found('assistant','draft', p_draft_id::text,'settle',
      'There is no such draft in your conversation.');
  end if;

  if v_row.outcome is not null then
    return ops_core.conflict('assistant','draft', p_draft_id::text,'settle',
      'already_settled',
      format('This draft was already %s.', v_row.outcome),
      to_jsonb(v_row));
  end if;

  if v_outcome = 'confirmed' and p_payload is null then
    -- The payload is the confirmation. Without it there is nothing to say
    -- what was agreed to, and the row would claim a yes to an unknown thing.
    return ops_core.invalid('assistant','draft', p_draft_id::text,'settle',
      'payload_required',
      'A confirmation records what was confirmed, field by field.',
      jsonb_build_object('field','payload'));
  end if;

  update ops_asst.drafts
     set outcome = v_outcome,
         decided_at = now(),
         confirmed_payload = case when v_outcome = 'confirmed' then p_payload else null end,
         produced_ref = case when v_outcome = 'confirmed' then p_produced_ref else null end
   where id = p_draft_id and outcome is null
  returning * into v_row;

  if not found then
    -- Two confirms landing together. The other one won; say so rather than
    -- reporting a success that did not happen.
    select * into v_row from ops_asst.drafts where id = p_draft_id;
    return ops_core.conflict('assistant','draft', p_draft_id::text,'settle',
      'already_settled', format('This draft was already %s.', v_row.outcome), to_jsonb(v_row));
  end if;

  return ops_core.ok('assistant','draft', p_draft_id::text,'settle', to_jsonb(v_row));
end $$;

grant execute on function ops_asst.settle_draft(uuid, text, jsonb, text) to authenticated;

comment on function ops_asst.settle_draft(uuid, text, jsonb, text) is
  'The second yes, or the change of mind. Settled once: a second confirm answers `duplicate` '
  'with the row as it stands, because the thing asked for has already happened. (0040)';

-- ── one correction to 0039 ───────────────────────────────────────────────
--
-- `turns.facts` was documented as carrying either a number or a string, and
-- the live client now does exactly that — but the comment implied the client
-- might format the number itself. It does not, and it must not: `formatIDR`
-- in `src/lib/format.ts` follows a locale the person chooses, so a figure
-- formatted anywhere else is a figure that disagrees with the screen it is
-- supposed to be checkable against (D217).

comment on column ops_asst.turns.facts is
  'One figure John Lau said, and where it came from: `[{label, value, amount, unit, source, '
  'href}]`. A number goes in `amount` + `unit` and is formatted by the client with the same '
  'helper the screens use; `value` carries anything that is not a number. Never both — a figure '
  'formatted in two places is a figure that disagrees with itself. (0039, restated 0040)';
