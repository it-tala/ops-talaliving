-- mkt — the three acts that move an agent, and the one that makes them a
-- representative (D183, D185).
--
--   REFUSALS     moving an agent with a read grant; a slot nobody is in; a
--                **DEAL with no representative**, as a sentence rather than a
--                constraint name; giving up without saying why; moving on from
--                an agent who already agreed; a commission of nought or of
--                twenty-five; onboarding the same agent twice
--   DERIVATIONS  the seam hands back what the **trigger** decided, so a caller
--                who asked to move a stage is told what that did to the clock;
--                moving on is **both acts or neither**; the next agent is the
--                next one still **queued**, not the next slot; running out is
--                an outcome, not an error; onboarding takes the market from
--                the property and **does not** move the agent to DEAL; the
--                same key twice is one representative
--
-- Worked out first:  today + 7 is the chase date on every first message.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-000000008201','mkt82@talaliving.com','{"full_name":"Staf Marketing"}'),
  ('ffffffff-0000-0000-0000-000000008202','tukang82@talaliving.com','{"full_name":"Tukang Kayu"}'),
  ('ffffffff-0000-0000-0000-000000008203','lihat82@talaliving.com','{"full_name":"Pimpinan"}'),
  ('ffffffff-0000-0000-0000-000000008204','it82@talaliving.com','{"full_name":"Staf IT"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-000000008201','marketing','write'),
  ('ffffffff-0000-0000-0000-000000008202','production','write'),
  -- May look at the pipeline and may not touch it.
  ('ffffffff-0000-0000-0000-000000008203','marketing','read'),
  -- The audit log and the outbox are IT's to read (`0003`), not the module's.
  ('ffffffff-0000-0000-0000-000000008204','it','read');

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000008201';

insert into ops_mkt.markets (code, country_code, country_name, region, city, area_label, currency, timezone)
values ('AU-QLD-GOLDCOAST-SPNORTH','AU','Australia','Queensland','Gold Coast','SP NORTH','AUD','Australia/Brisbane');

insert into ops_mkt.properties (id, ref, market_code, name, score) values
  ('dddd8200-0000-0000-0000-0000000000c1','TL-0101','AU-QLD-GOLDCOAST-SPNORTH','Meriton Suites', 5),
  ('dddd8200-0000-0000-0000-0000000000c2','TL-0102','AU-QLD-GOLDCOAST-SPNORTH','Oracle Boulevard', 4),
  ('dddd8200-0000-0000-0000-0000000000c3','TL-0103','AU-QLD-GOLDCOAST-SPNORTH','Peppers Broadbeach', 3),
  ('dddd8200-0000-0000-0000-0000000000c4','TL-0104','AU-QLD-GOLDCOAST-SPNORTH','Circle on Cavill', 4);

insert into ops_mkt.property_agents (property_id, slot, name, agency, phone, stage, sent_on, remark) values
  ('dddd8200-0000-0000-0000-0000000000c1', 1,'Alice Tan','Ray White','0400 111','QUEUED', null, null),
  ('dddd8200-0000-0000-0000-0000000000c1', 2,'Ben Cooper','LJ Hooker','0400 222','QUEUED', null, null),
  ('dddd8200-0000-0000-0000-0000000000c1', 3,'Cara Lim','Ray White','0400 333','QUEUED', null, null),
  -- Slot 2 was ruled out months ago. The move-on must step over it.
  ('dddd8200-0000-0000-0000-0000000000c2', 1,'Dan Price','Century 21',null,'MSG SENT',
   ops_core.office_day() - 10, null),
  ('dddd8200-0000-0000-0000-0000000000c2', 2,'Ella Nguyen','Century 21',null,'SKIP', null,'nomor tidak aktif'),
  ('dddd8200-0000-0000-0000-0000000000c2', 3,'Finn Walsh','Kollosche',null,'QUEUED', null, null),
  -- The last one there is.
  ('dddd8200-0000-0000-0000-0000000000c3', 1,'Gita Sari','Ray White',null,'MSG SENT',
   ops_core.office_day() - 10, null),
  ('dddd8200-0000-0000-0000-0000000000c4', 1,'Hari Putra','Kollosche','0400 444','QUEUED', null, null);

/* ── REFUSAL: a read grant may look at the pipeline, not move it ───────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000008203';
do $$
declare a jsonb; n int;
begin
  assert ops_core.has_permission('marketing.read'), 'the boss may read it';
  assert not ops_core.has_permission('marketing.update'), 'and may not move it';

  a := ops_mkt.set_agent_stage('TL-0101', 1,'MSG SENT');
  assert a -> 'error' ->> 'code' = 'not_permitted',
    'got ' || coalesce(a -> 'error' ->> 'code','(null)');
  a := ops_mkt.move_to_next_agent('TL-0102', 1,'tidak balas');
  assert a -> 'error' ->> 'code' = 'not_permitted',
    'got ' || coalesce(a -> 'error' ->> 'code','(null)');
  a := ops_mkt.onboard_rep('TL-0104', 1, 2.5);
  assert a -> 'error' ->> 'code' = 'not_permitted',
    'got ' || coalesce(a -> 'error' ->> 'code','(null)');

  -- And nothing moved on the way to being refused.
  select count(*) into n from ops_mkt.property_agents where stage <> 'QUEUED'
     and stage not in ('MSG SENT','SKIP');
  assert n = 0, 'the board is where it was, got ' || n;
  assert (select count(*) from ops_mkt.sales_reps) = 0, 'and nobody was onboarded';
end $$;

set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000008201';

/* ── DERIVATION: the seam hands back what the trigger decided ──────────── */
do $$
declare a jsonb;
begin
  a := ops_mkt.set_agent_stage('TL-0101', 1,'MSG SENT');
  assert ops_core.said_ok(a), 'got ' || coalesce(a -> 'error' ->> 'code', a::text);
  -- A caller who asked to move a stage should not have to re-read the row to
  -- find out that a clock started.
  assert (a -> 'data' ->> 'sent_on')::date = ops_core.office_day(),
    'the clock started, and the answer says so, got ' || coalesce(a -> 'data' ->> 'sent_on','(null)');
  assert (a -> 'data' ->> 'next_action_on')::date = ops_core.office_day() + 7,
    'chase in seven days, got ' || coalesce(a -> 'data' ->> 'next_action_on','(null)');
  assert a -> 'data' ->> 'agent' = 'Alice Tan', 'got ' || coalesce(a -> 'data' ->> 'agent','(null)');

  -- A reply stops it, wherever on the ladder the answer arrives.
  a := ops_mkt.set_agent_stage('TL-0101', 1,'CALL SET');
  assert (a -> 'data' ->> 'replied_on')::date = ops_core.office_day(),
    'the reply is stamped, got ' || coalesce(a -> 'data' ->> 'replied_on','(null)');
  assert a -> 'data' ->> 'next_action_on' is null, 'and the chase ends';

  -- *Chase this one on Friday instead.* **A date a person typed beats the one
  -- the trigger computed** — the default is only a default, and a seam that
  -- silently discarded the typed date would be the worst of both.
  a := ops_mkt.set_agent_stage('TL-0101', 3,'MSG SENT', null, ops_core.office_day() + 2);
  assert (a -> 'data' ->> 'sent_on')::date = ops_core.office_day(),
    'the clock still started, got ' || coalesce(a -> 'data' ->> 'sent_on','(null)');
  assert (a -> 'data' ->> 'next_action_on')::date = ops_core.office_day() + 2,
    'but the chase is when the person said, not seven days out, got '
    || coalesce(a -> 'data' ->> 'next_action_on','(null)');
end $$;

/* ── REFUSAL: a slot nobody is in; a deal with nobody behind it ────────── */
do $$
declare a jsonb;
begin
  a := ops_mkt.set_agent_stage('TL-0103', 2,'MSG SENT');
  assert a -> 'error' ->> 'code' = 'not_found',
    'there is no second agent there, got ' || coalesce(a -> 'error' ->> 'code','(null)');

  -- The constraint would refuse this too. The point of asking here is that the
  -- answer is a sentence somebody can act on rather than the name of a check.
  a := ops_mkt.set_agent_stage('TL-0101', 1,'DEAL');
  assert a -> 'error' ->> 'code' = 'rep_required',
    'got ' || coalesce(a -> 'error' ->> 'code','(null)');
  assert a -> 'error' ->> 'message' like '%komisi%',
    'and it says what is missing, got ' || coalesce(a -> 'error' ->> 'message','(null)');
  assert a -> 'error' -> 'detail' ->> 'field' = 'commission_percent',
    'naming the field a form should ask for';

  -- Giving up says why, and the seam asks for it by name.
  a := ops_mkt.set_agent_stage('TL-0101', 2,'RECYCLED');
  assert a -> 'error' ->> 'code' = 'reason_required',
    'got ' || coalesce(a -> 'error' ->> 'code','(null)');
  assert (select stage from ops_mkt.property_agents a2
           join ops_mkt.properties p on p.id = a2.property_id
          where p.ref = 'TL-0101' and a2.slot = 2) = 'QUEUED',
    'and nothing moved';
end $$;

/* ── DERIVATION: moving on is both acts, or neither ────────────────────── */
do $$
declare a jsonb; v record;
begin
  a := ops_mkt.move_to_next_agent('TL-0102', 1,'tidak pernah balas, coba tahun depan');
  assert ops_core.said_ok(a), 'got ' || coalesce(a -> 'error' ->> 'code', a::text);
  assert a -> 'data' ->> 'recycled' = 'Dan Price', 'got ' || coalesce(a -> 'data' ->> 'recycled','(null)');
  -- **Not slot 2.** Ella was ruled out months ago, and messaging somebody the
  -- team has already skipped is worse than messaging nobody.
  assert a -> 'data' ->> 'next_agent' = 'Finn Walsh',
    'the next one still queued, not the next slot, got ' || coalesce(a -> 'data' ->> 'next_agent','(null)');
  assert (a -> 'data' ->> 'next_slot')::int = 3, 'got ' || coalesce(a -> 'data' ->> 'next_slot','(null)');
  assert not (a -> 'data' ->> 'exhausted')::boolean, 'there was somebody left';

  -- Both halves landed, in one transaction. Half of this move is the stall the
  -- queue exists to surface.
  select * into v from ops_mkt.v_property_agent where property_ref = 'TL-0102' and slot = 1;
  assert v.stage = 'RECYCLED',  'got ' || coalesce(v.stage::text,'(null)');
  assert v.remark = 'tidak pernah balas, coba tahun depan', 'with the reason on the row';
  assert not v.move_on,         'and out of the queue';

  select * into v from ops_mkt.v_property_agent where property_ref = 'TL-0102' and slot = 3;
  assert v.stage = 'MSG SENT',  'the next one was messaged, got ' || coalesce(v.stage::text,'(null)');
  assert v.sent_on = ops_core.office_day(), 'today, got ' || coalesce(v.sent_on::text,'(null)');
  assert v.next_action_on = ops_core.office_day() + 7, 'chased in seven, got '
    || coalesce(v.next_action_on::text,'(null)');

  -- The skipped one was not touched on the way past.
  select * into v from ops_mkt.v_property_agent where property_ref = 'TL-0102' and slot = 2;
  assert v.stage = 'SKIP', 'got ' || coalesce(v.stage::text,'(null)');
end $$;

/* ── DERIVATION: running out is an outcome, not an error ───────────────── */
do $$
declare a jsonb; p record;
begin
  a := ops_mkt.move_to_next_agent('TL-0103', 1,'nomor mati');
  assert ops_core.said_ok(a), 'three approached and three gone is ordinary, got '
    || coalesce(a -> 'error' ->> 'code', '(ok)');
  assert a -> 'data' ->> 'next_agent' is null, 'and there is nobody left';
  assert (a -> 'data' ->> 'exhausted')::boolean, 'which the answer says outright';

  select * into p from ops_mkt.v_property where ref = 'TL-0103';
  assert p.exhausted, 'the property goes back on the pile';
end $$;

/* ── REFUSAL: an empty reason, and an agent who already agreed ─────────── */
do $$
declare a jsonb;
begin
  a := ops_mkt.move_to_next_agent('TL-0101', 3,'   ');
  assert a -> 'error' ->> 'code' = 'reason_required',
    'whitespace is not a reason, got ' || coalesce(a -> 'error' ->> 'code','(null)');
  assert (select stage from ops_mkt.property_agents a2
           join ops_mkt.properties p on p.id = a2.property_id
          where p.ref = 'TL-0101' and a2.slot = 3) = 'MSG SENT',
    'and neither agent moved';
end $$;

/* ── REFUSAL and DERIVATION: onboarding ────────────────────────────────── */
do $$
declare a jsonb; b jsonb; r record; v record; n int;
begin
  a := ops_mkt.onboard_rep('TL-0104', 1, 0);
  assert a -> 'error' ->> 'code' = 'commission_out_of_range',
    'a rep without a rate is not a rep, got ' || coalesce(a -> 'error' ->> 'code','(null)');
  a := ops_mkt.onboard_rep('TL-0104', 1, 25);
  assert a -> 'error' ->> 'code' = 'commission_out_of_range',
    'above twenty is a typo far more often than a deal, got ' || coalesce(a -> 'error' ->> 'code','(null)');
  a := ops_mkt.onboard_rep('TL-9999', 1, 2.5);
  assert a -> 'error' ->> 'code' = 'not_found', 'got ' || coalesce(a -> 'error' ->> 'code','(null)');

  a := ops_mkt.onboard_rep('TL-0104', 1, 2.5, null, null,'k-82-onboard');
  assert ops_core.said_ok(a), 'got ' || coalesce(a -> 'error' ->> 'code', a::text);
  -- `agn-…`, which is what the tracker prints today and what the team says out
  -- loud. Not `rep-…`, however much tidier that would have been.
  assert a -> 'data' ->> 'rep_no' like 'agn-%',
    'the number keeps the shape the team reads, got ' || coalesce(a -> 'data' ->> 'rep_no','(null)');

  select * into r from ops_mkt.v_rep where rep_no = a -> 'data' ->> 'rep_no';
  assert r.name = 'Hari Putra',           'got ' || coalesce(r.name,'(null)');
  assert r.agency = 'Kollosche',          'carried from the agent, got ' || coalesce(r.agency,'(null)');
  assert r.commission_percent = 2.5,      'got ' || coalesce(r.commission_percent::text,'(null)');
  -- Taken from the property, not asked for: a field somebody fills in by hand
  -- is a field that will disagree with how it actually happened.
  assert r.market_code = 'AU-QLD-GOLDCOAST-SPNORTH',
    'the market they were recruited in, got ' || coalesce(r.market_code,'(null)');
  assert r.note = 'Dari TL-0104 Circle on Cavill.',
    'and where they came from, in words, got ' || coalesce(r.note,'(null)');
  assert r.referrals = 0,                 'they have introduced nobody yet';

  select * into v from ops_mkt.v_property_agent where property_ref = 'TL-0104' and slot = 1;
  assert v.rep_id is not null, 'the agent now points at the representative';
  -- **Onboarding is not the deal.** D185 joins the two funnels at one point; it
  -- does not merge them, and a board that cannot say which of the two happened
  -- is a board nobody trusts.
  assert v.stage = 'QUEUED', 'and the ladder did not move on its own, got ' || coalesce(v.stage::text,'(null)');

  -- Now the deal is allowed, and only now.
  b := ops_mkt.set_agent_stage('TL-0104', 1,'DEAL');
  assert ops_core.said_ok(b), 'got ' || coalesce(b -> 'error' ->> 'code', b::text);

  -- Twice would mint a second rep with a second rate, and the referrals
  -- already counted against the first would keep counting against it.
  b := ops_mkt.onboard_rep('TL-0104', 1, 3);
  assert b -> 'error' ->> 'code' = 'already_onboarded',
    'got ' || coalesce(b -> 'error' ->> 'code','(null)');
  select count(*) into n from ops_mkt.sales_reps;
  assert n = 1, 'one representative, got ' || n;

  -- A retry is the earlier answer coming back, not a second thing happening.
  b := ops_mkt.onboard_rep('TL-0104', 1, 2.5, null, null,'k-82-onboard');
  assert b ->> 'outcome' = 'duplicate', 'got ' || coalesce(b ->> 'outcome','(null)');
  assert b -> 'data' ->> 'rep_no' = a -> 'data' ->> 'rep_no', 'and the same representative';
  select count(*) into n from ops_mkt.sales_reps;
  assert n = 1, 'still one, got ' || n;
end $$;

/* ── REFUSAL: an agent who agreed is not somebody to move on from ──────── */
do $$
declare a jsonb;
begin
  a := ops_mkt.move_to_next_agent('TL-0104', 1,'iseng');
  assert a -> 'error' ->> 'code' = 'agent_agreed',
    'recycling a DEAL would orphan the representative it created, got '
    || coalesce(a -> 'error' ->> 'code','(null)');
  assert (select stage from ops_mkt.property_agents a2
           join ops_mkt.properties p on p.id = a2.property_id
          where p.ref = 'TL-0104' and a2.slot = 1) = 'DEAL', 'and the deal stands';
end $$;

/* ── DERIVATION: the acts leave a trail ────────────────────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000008204';
do $$
declare n int;
begin
  select count(*) into n from ops_core.outbox
   where event_type = 'marketing.rep.onboarded';
  assert n = 1, 'onboarding is announced once, got ' || n;
  select count(*) into n from ops_core.outbox where event_type = 'marketing.agent.deal';
  assert n = 1, 'and so is the deal, got ' || n;
  select count(*) into n from ops_core.outbox where event_type = 'marketing.agent.moved_on';
  assert n = 2, 'two move-ons, got ' || n;

  -- Written by the seam, against the reference a person would search for.
  select count(*) into n from ops_core.audit_log
   where service = 'marketing' and action = 'move_on' and entity_no = 'TL-0102'
     and outcome = 'ok';
  assert n = 1, 'the trail names the property, got ' || n;

  -- **And the refusal is on it too.** The boss tried this same move and was
  -- turned away; a trail that only records what succeeded cannot answer *who
  -- has been trying to do this*, which is the question it gets asked.
  select count(*) into n from ops_core.audit_log
   where service = 'marketing' and action = 'move_on' and entity_no = 'TL-0102'
     and outcome = 'refused';
  assert n = 1, 'the attempt that was refused is recorded, got ' || n;
end $$;

rollback;
