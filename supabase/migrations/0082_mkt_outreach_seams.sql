-- 0082_mkt_outreach_seams.sql — the three acts that move an agent, and the one
-- that turns them into a representative.
--
-- `0081` built the funnel and the derivations over it. This is the writing
-- side, and it is a seam rather than three policies for the reason `0016` gave
-- (D84): a plain update through a policy gets the row written and loses the
-- audit row, the outbox row, the idempotency record and — here especially —
-- the **second half of the act**.
--
-- That second half is what makes `move_to_next_agent` worth a function at all.
-- Recycling one agent and messaging the next are two writes, and doing only
-- the first is exactly how a property stalls with nobody chasing anybody
-- (D183). One call, one transaction, or the tracker's own failure mode is
-- reproduced faithfully in a database.
--
-- ## Addressed by property and slot, never by id
--
-- Every seam in this system takes public references — `p_doc_no`, `p_line_no`,
-- `p_wo_no`, `p_leg_no`. An agent has no public code of its own, and it does
-- not need one: **`TL-0001` slot 2** is how the team says it out loud and is
-- already the natural key. The contract passes `property_ref` *and* a uuid
-- `agent_id`, which is the demo's fixture ids leaking into a signature — C17.

-- ── moving one agent along the ladder ─────────────────────────────────────
--
-- The stamping — the clock starting, a reply stopping it — is **not** here. It
-- is a trigger in `0081`, so it holds for a correction typed straight into the
-- table as much as for this call. What belongs here is the refusal the
-- constraint can only make as an error: a `DEAL` with nobody behind it needs
-- to come back as a sentence somebody can act on, not as
-- *violates check constraint "deal_names_a_rep"*.
create or replace function ops_mkt.set_agent_stage(
  p_property_ref text,
  p_slot         int,
  p_stage        ops_mkt.outreach_stage_t,
  p_remark       text default null,
  p_key          text default null)
returns jsonb
language plpgsql security definer set search_path = ops_mkt, ops_core, pg_temp as $$
declare
  v_replayed jsonb;
  v_agent    ops_mkt.property_agents;
  v_before   ops_mkt.outreach_stage_t;
  v_res      jsonb;
begin
  v_replayed := ops_core.idem_replay('marketing','set_agent_stage', p_key);
  if v_replayed is not null then return v_replayed; end if;

  if not ops_core.has_permission('marketing.update') then
    return ops_core.refused('marketing','property_agent', p_property_ref,'set_stage',
      'not_permitted','Moving an agent along the ladder needs marketing access.');
  end if;

  select a.* into v_agent
    from ops_mkt.property_agents a
    join ops_mkt.properties p on p.id = a.property_id
   where p.ref = p_property_ref and a.slot = p_slot;
  if not found then
    return ops_core.not_found('marketing','property_agent', p_property_ref,'set_stage',
      format('No agent in slot %s of %s.', p_slot, p_property_ref));
  end if;
  v_before := v_agent.stage;

  -- A deal against nobody is a commission nobody can compute (D185). The
  -- constraint says the same thing; this says it in words, before the write.
  if p_stage = 'DEAL' and v_agent.rep_id is null then
    return ops_core.invalid('marketing','property_agent', p_property_ref,'set_stage',
      'rep_required',
      'Agen yang deal harus di-onboarding dulu sebagai sales representative — beserta '
      'persentase komisinya. Tanpa itu tidak ada yang tahu berapa yang harus dibayar.',
      jsonb_build_object('field','commission_percent','slot', p_slot));
  end if;

  -- Giving up says why, and the constraint would refuse it anyway. Asking here
  -- means the caller is told which field is missing rather than which
  -- constraint fired.
  if p_stage = 'RECYCLED'
     and coalesce(btrim(coalesce(p_remark, v_agent.remark)), '') = '' then
    return ops_core.invalid('marketing','property_agent', p_property_ref,'set_stage',
      'reason_required',
      'Tulis alasannya — ini yang dibaca kalau agen ini didekati lagi tahun depan.',
      jsonb_build_object('field','remark'));
  end if;

  update ops_mkt.property_agents
     set stage  = p_stage,
         remark = coalesce(nullif(btrim(coalesce(p_remark,'')), ''), remark)
   where id = v_agent.id
  returning * into v_agent;

  if p_stage = 'DEAL' then
    perform ops_core.emit('marketing','marketing.agent.deal', p_property_ref,
      jsonb_build_object('property_ref', p_property_ref, 'slot', p_slot,
                         'agent', v_agent.name, 'rep_id', v_agent.rep_id));
  end if;

  v_res := ops_core.ok('marketing','property_agent', p_property_ref,'set_stage',
    jsonb_build_object(
      'property_ref',   p_property_ref,
      'slot',           p_slot,
      'agent',          v_agent.name,
      'stage',          v_agent.stage,
      -- What the trigger decided, handed back rather than left for a re-read:
      -- the caller asked to move a stage and got told what that did to the clock.
      'sent_on',        v_agent.sent_on,
      'replied_on',     v_agent.replied_on,
      'next_action_on', v_agent.next_action_on),
    jsonb_build_object('stage', v_before),
    jsonb_build_object('stage', v_agent.stage));
  return ops_core.idem_remember('marketing','set_agent_stage', p_key, v_res);
end $$;

-- ── giving up on one, and starting on the next ────────────────────────────
--
-- **Both acts, or neither.** This is the move the seven-day rule exists to
-- prompt, and half of it is worse than none: an agent marked RECYCLED with
-- nobody started behind them leaves the property in the funnel with no next
-- action, which is precisely the stall the queue is supposed to surface.
--
-- Running out of agents is **not** a refusal. Three approached and three gone
-- is an ordinary outcome — the property is `exhausted` and goes back on the
-- pile — so the answer says `next_agent: null` and the caller can see it.
create or replace function ops_mkt.move_to_next_agent(
  p_property_ref text,
  p_slot         int,
  p_reason       text,
  p_key          text default null)
returns jsonb
language plpgsql security definer set search_path = ops_mkt, ops_core, pg_temp as $$
declare
  v_replayed jsonb;
  v_agent    ops_mkt.property_agents;
  v_next     ops_mkt.property_agents;
  v_res      jsonb;
begin
  v_replayed := ops_core.idem_replay('marketing','move_to_next_agent', p_key);
  if v_replayed is not null then return v_replayed; end if;

  if not ops_core.has_permission('marketing.update') then
    return ops_core.refused('marketing','property_agent', p_property_ref,'move_on',
      'not_permitted','Moving on from an agent needs marketing access.');
  end if;

  if coalesce(btrim(coalesce(p_reason,'')), '') = '' then
    return ops_core.invalid('marketing','property_agent', p_property_ref,'move_on',
      'reason_required',
      'Tulis alasannya — ini yang dibaca kalau agen ini didekati lagi tahun depan.',
      jsonb_build_object('field','reason'));
  end if;

  select a.* into v_agent
    from ops_mkt.property_agents a
    join ops_mkt.properties p on p.id = a.property_id
   where p.ref = p_property_ref and a.slot = p_slot;
  if not found then
    return ops_core.not_found('marketing','property_agent', p_property_ref,'move_on',
      format('No agent in slot %s of %s.', p_slot, p_property_ref));
  end if;

  -- An agent who agreed is not somebody to move on from, and recycling them
  -- would orphan the representative their deal created.
  if v_agent.stage = 'DEAL' then
    return ops_core.invalid('marketing','property_agent', p_property_ref,'move_on',
      'agent_agreed',
      format('%s sudah deal. Tidak ada yang perlu dilanjutkan ke agen berikutnya.', v_agent.name),
      jsonb_build_object('slot', p_slot));
  end if;

  update ops_mkt.property_agents
     set stage = 'RECYCLED', remark = btrim(p_reason)
   where id = v_agent.id;

  -- The next one **still queued**, by slot. Not simply `slot + 1`: slot 2 may
  -- have been skipped as unreachable months ago, and messaging somebody the
  -- team has already ruled out is worse than messaging nobody.
  update ops_mkt.property_agents
     set stage = 'MSG SENT'
   where id = (select a.id
                 from ops_mkt.property_agents a
                where a.property_id = v_agent.property_id
                  and a.slot > v_agent.slot
                  and a.stage = 'QUEUED'
                order by a.slot limit 1)
  returning * into v_next;

  perform ops_core.emit('marketing','marketing.agent.moved_on', p_property_ref,
    jsonb_build_object('property_ref', p_property_ref,
                       'from', v_agent.name, 'to', v_next.name));

  v_res := ops_core.ok('marketing','property_agent', p_property_ref,'move_on',
    jsonb_build_object(
      'property_ref',    p_property_ref,
      'recycled',        v_agent.name,
      'recycled_slot',   p_slot,
      -- Null when there was nobody left. An ordinary outcome, reported.
      'next_agent',      v_next.name,
      'next_slot',       v_next.slot,
      'next_action_on',  v_next.next_action_on,
      'exhausted',       v_next.id is null));
  return ops_core.idem_remember('marketing','move_to_next_agent', p_key, v_res);
end $$;

-- ── the agent said yes ────────────────────────────────────────────────────
--
-- From here they are a representative with a rate, and everything they
-- introduce is counted against it (D185). The rate is the whole point of the
-- act: onboarding without one would leave a `DEAL` that no commission can be
-- computed from, which is the row that quietly stops the programme working.
create or replace function ops_mkt.onboard_rep(
  p_property_ref       text,
  p_slot               int,
  p_commission_percent numeric,
  p_email              text default null,
  p_note               text default null,
  p_key                text default null)
returns jsonb
language plpgsql security definer set search_path = ops_mkt, ops_core, pg_temp as $$
declare
  v_replayed jsonb;
  v_prop     ops_mkt.properties;
  v_agent    ops_mkt.property_agents;
  v_rep_no   text;
  v_rep_id   uuid;
  v_res      jsonb;
begin
  v_replayed := ops_core.idem_replay('marketing','onboard_rep', p_key);
  if v_replayed is not null then return v_replayed; end if;

  if not ops_core.has_permission('marketing.create') then
    return ops_core.refused('marketing','sales_rep', p_property_ref,'onboard',
      'not_permitted','Onboarding a representative needs marketing access.');
  end if;

  -- The table's own check says the same. Said here it names the field and the
  -- reason, which is what a form can show.
  if p_commission_percent is null
     or p_commission_percent <= 0 or p_commission_percent > 20 then
    return ops_core.invalid('marketing','sales_rep', p_property_ref,'onboard',
      'commission_out_of_range',
      'Persentase komisi harus antara 0 dan 20. Angka di luar itu hampir pasti salah '
      'ketik, dan ini angka yang akan dibayar berkali-kali.',
      jsonb_build_object('field','commission_percent'));
  end if;

  select p.* into v_prop from ops_mkt.properties p where p.ref = p_property_ref;
  if not found then
    return ops_core.not_found('marketing','property', p_property_ref,'onboard',
      format('No property %s.', p_property_ref));
  end if;

  select a.* into v_agent from ops_mkt.property_agents a
   where a.property_id = v_prop.id and a.slot = p_slot;
  if not found then
    return ops_core.not_found('marketing','property_agent', p_property_ref,'onboard',
      format('No agent in slot %s of %s.', p_slot, p_property_ref));
  end if;

  -- Twice would mint a second rep with a second rate, and the referrals
  -- already counted against the first would keep counting against it while
  -- new ones went to the other. A conflict, not an error: the first one stands.
  if v_agent.rep_id is not null then
    return ops_core.conflict('marketing','sales_rep',
      (select s.rep_no from ops_mkt.sales_reps s where s.id = v_agent.rep_id),'onboard',
      'already_onboarded',
      format('%s sudah terdaftar sebagai representative.', v_agent.name));
  end if;

  v_rep_no := ops_core.next_doc_number('agn');

  insert into ops_mkt.sales_reps
    (rep_no, name, agency, phone, email, market_code, commission_percent, note, created_by)
  values (v_rep_no, v_agent.name, v_agent.agency, v_agent.phone,
          coalesce(nullif(btrim(coalesce(p_email,'')), ''), v_agent.email),
          -- The market they were recruited in, taken from the property rather
          -- than asked for: it is a fact about how this happened, and a field
          -- somebody fills in by hand is a field that will disagree with it.
          v_prop.market_code,
          p_commission_percent,
          coalesce(nullif(btrim(coalesce(p_note,'')), ''),
                   format('Dari %s %s.', v_prop.ref, v_prop.name)),
          auth.uid())
  returning id into v_rep_id;

  update ops_mkt.property_agents set rep_id = v_rep_id where id = v_agent.id;

  perform ops_core.emit('marketing','marketing.rep.onboarded', v_rep_no,
    jsonb_build_object('rep_no', v_rep_no, 'name', v_agent.name,
                       'commission_percent', p_commission_percent,
                       'property_ref', v_prop.ref));

  v_res := ops_core.ok('marketing','sales_rep', v_rep_no,'onboard',
    jsonb_build_object(
      'rep_no',             v_rep_no,
      'name',               v_agent.name,
      'commission_percent', p_commission_percent,
      'market_code',        v_prop.market_code,
      'property_ref',       v_prop.ref,
      'slot',               p_slot,
      -- **Not moved to DEAL here.** Onboarding is *this agent agreed to
      -- represent us*; the deal is a separate act with its own audit row, and
      -- collapsing the two would make the funnel unable to say which happened
      -- (D185 joins the funnels at one point — it does not merge them).
      'stage',              v_agent.stage));
  return ops_core.idem_remember('marketing','onboard_rep', p_key, v_res);
end $$;

grant execute on function
  ops_mkt.set_agent_stage(text, int, ops_mkt.outreach_stage_t, text, text),
  ops_mkt.move_to_next_agent(text, int, text, text),
  ops_mkt.onboard_rep(text, int, numeric, text, text, text)
  to authenticated;
